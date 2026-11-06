// Clause tests — batch seed-05. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-05`. Expectations come from each card's
// PRINTED text and RULES.md / the Comprehensive Rules; engine data (ability ids,
// target declaration ids, choice kinds) is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
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
import { clause, declineAll, drain, printing, refused, flipUpNow, holdFlipUp } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fight, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, pending, tokensOn, zoneOf } from "./_board.js";
import { developResource, endTurn, factionOf, developOffers } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ---------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;
type IdOf = (key: string) => CardInstanceId;

/** Staple resources for `owner`, e.g. `res({ elitism: 2, greed: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

const handOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].discard;
const ready = (engine: SpoilsEngine, player: PlayerId = P1) => engine.getAvailableResourceCount(player);
const influenceOf = (engine: SpoilsEngine, player: PlayerId = P1) => engine.state.players[player].influence;
const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;

/** `n` vanilla characters in `owner`'s zone, keyed `<prefix>0..n-1` (a deck's first key is its top card). */
function cards(prefix: string, n: number, owner: PlayerId, zone: "deck" | "hand" | "discard" | "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone }));
}

/** The default test faction restores depleted non-resource cards at the start of its controller's turn; this one does not, so a restore the card under test performs is visible. */
function holdFaction(): CardDefinition {
  const faction = developFaction();
  faction.faction!.turn.restore.restoreNonResources = false;
  return faction;
}

/** Answers the open pending choice (asserting its kind and who answers it), then drains response windows. */
function answerBy(engine: SpoilsEngine, kind: string, playerId: PlayerId, choice: Record<string, unknown>): void {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}`);
  assert.equal(pc.kind, kind, "pending choice kind");
  assert.equal(pc.playerId, playerId, `${kind} must be answered by ${playerId}`);
  answerPending(engine, kind, choice);
}

/** Resolves the open `chooserSelectsTarget` with `selected` — no draining, for use under `refused`. */
const tryPick = (engine: SpoilsEngine, playerId: PlayerId, selected: CardInstanceId[]) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);

/** Answers every `chooserSelectsTarget` with `ids`, accepts nothing else (`declineAll`). */
const picking = (ids: CardInstanceId[]) => (pc: PendingChoiceLike) =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc);

/** Accepts every `mayPay`, declines everything else. */
const payYes = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc));

/** Answers `chooserSelectsOption` prompts by label (the "may" prompts of this set offer "Decline" and an action). */
const optionIndex = (pc: PendingChoiceLike, accept: boolean): number => {
  const labels = (pc.options as Array<{ label: string }>).map((o) => o.label);
  return accept ? labels.findIndex((l) => l !== "Decline") : labels.indexOf("Decline");
};

/** Drains pending choices with `answer`, returning everything asked as "<player>:<kind>". */
function drainRecording(engine: SpoilsEngine, answer: (pc: PendingChoiceLike) => unknown): string[] {
  const seen: string[] = [];
  drain(engine, (pc) => {
    seen.push(`${pc.playerId}:${pc.kind}`);
    return answer(pc);
  });
  return seen;
}

/** The OTHER player ends their turn, so it is `player`'s turn that starts; every prompt of that turn start is answered with `answer` and recorded. */
function startTurnOf(engine: SpoilsEngine, player: PlayerId, answer: (pc: PendingChoiceLike) => unknown = declineAll): string[] {
  endTurn(engine, other(player));
  assert.equal(engine.state.activePlayerId, player, "the turn has changed hands");
  return drainRecording(engine, answer);
}

/** The ids of every character in play `player` controls. */
function charactersOf(engine: SpoilsEngine, player: PlayerId): CardInstanceId[] {
  return engine.state.players[player].play.filter(
    (cardId) => engine.state.cards[cardId].controllerId === player && engine.getCardTypes(cardId).includes("character") && !engine.state.cards[cardId].faceDown
  );
}

/** Synthetic helper cards -------------------------------------------------------- */

/** A free tactic that destroys one chosen card in play (id `kill`, declaration `t`). */
const killAny = (type: "character" | "item" | "location" | "resource" = "character"): CardDefinition =>
  tactic({
    name: `Kill ${type}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

/** A free tactic that puts one chosen character into its owner's hand (id `b`, declaration `t`). */
const bounceChar = (): CardDefinition =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        { id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }
      ]
    }
  });

/** A free tactic that removes one chosen character from the game (id `r`, declaration `t`). */
const exileChar = (): CardDefinition =>
  tactic({
    name: "Exile",
    cost: 0,
    behavior: {
      abilities: [
        { id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

/** A free tactic that turns one chosen character face-down (id `f`, declaration `t`). */
const flipDownChar = (): CardDefinition =>
  tactic({
    name: "Flip Down",
    cost: 0,
    behavior: {
      abilities: [
        { id: "f", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

/** A free tactic that takes control of one chosen card in play for its controller (id `s`, declaration `t`). */
const stealChar = (): CardDefinition =>
  tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        { id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }
      ]
    }
  });

/** A free tactic that gives one chosen character COVERT this turn (id `g`, declaration `t`). */
const grantCovert = (): CardDefinition =>
  tactic({
    name: "Grant Covert",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "g",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

/** An item with a cost-`cost` threshold-`threshold` requirement and no text (a gate for threshold checks). */
const gate = (threshold: string, cost = 0): CardDefinition => item({ name: `Gate ${threshold}`, cost, threshold });

/** All of an engine's token Micromajig characters under `player`'s control. */
function micromajigs(engine: SpoilsEngine, player: PlayerId): CardInstanceId[] {
  return engine.state.players[player].play.filter(
    (cardId) => engine.state.cards[cardId].controllerId === player && engine.getDefinition(cardId).name === "Micromajig"
  );
}

/** Asserts the card is a proper Micromajig token (CR 409.3c: a Gearsmith character, majig subtype, 1 strength / 1 life / 3 speed). */
function assertMicromajig(engine: SpoilsEngine, cardId: CardInstanceId, controller: PlayerId): void {
  const def = engine.getDefinition(cardId);
  assert.equal(def.name, "Micromajig");
  assert.equal(def.type, "character", "a Micromajig is a character");
  assert.equal(def.trade, "gearsmith", "a Micromajig is a Gearsmith card (CR 409.3c)");
  assert.ok(def.subtype.includes("majig"), "a Micromajig has the majig subtype (CR 409.3c)");
  assert.equal(engine.getStat(cardId, "strength"), 1);
  assert.equal(engine.getStat(cardId, "life"), 1);
  assert.equal(engine.getStat(cardId, "speed"), 3);
  assert.equal(engine.state.cards[cardId].controllerId, controller);
  assert.equal(engine.state.cards[cardId].zone, "play");
}

/**
 * Deploy basics for a card with no extra cost: it is refused with no resources, refused one resource short of its
 * printed cost, refused when the cost is covered but the threshold's icons are not, and with exactly the cost +
 * threshold it enters play paying exactly `cost`. Also refused on the opponent's turn (characters / items /
 * locations only deploy on their controller's own turn). Pending "may pay" prompts after entering are declined.
 */
function deployChecks(printingId: string, o: { cost: number; icon: StapleIcon; icons: number; type: "character" | "item" | "location" }): void {
  const board = (resources: Icons, turn?: { n: number; active: PlayerId }) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: turn?.n,
      activePlayerId: turn?.active,
      cards: [{ key: "subject", def: printing(printingId), owner: P1, zone: "hand" }, ...res(resources)]
    });
  const exactCount = Math.max(o.cost, o.icons);
  const exact = board({ [o.icon]: exactCount } as Icons);
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("subject"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("subject")), "play", "deployed");
  assert.equal(before - ready(exact.engine), o.cost, `the printed cost of ${o.cost} is paid`);
  assert.equal(exact.engine.getDefinition(exact.id("subject")).type, o.type);

  const none = board({});
  if (o.cost > 0 || o.icons > 0) {
    refused(() => playRaw(none.engine, P1, none.id("subject")), "no resources at all");
    assert.equal(zoneOf(none.engine, none.id("subject")), "hand");
  }
  if (o.cost > 1 && exactCount - 1 >= o.icons) {
    const short = board({ [o.icon]: exactCount - 1 } as Icons);
    refused(() => playRaw(short.engine, P1, short.id("subject")), "one resource short of the cost");
    assert.equal(zoneOf(short.engine, short.id("subject")), "hand");
    assert.equal(ready(short.engine), exactCount - 1, "nothing was paid by the refused attempt");
  }
  const wrongIcon: StapleIcon = o.icon === "rage" ? "greed" : "rage";
  const noThreshold = board({ [wrongIcon]: exactCount + 3 } as Icons);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("subject")), "plenty of resources but none with the threshold's icon");
  if (o.icons > 1) {
    const oneIcon = board({ [o.icon]: o.icons - 1, [wrongIcon]: exactCount + 3 } as Icons);
    refused(() => playRaw(oneIcon.engine, P1, oneIcon.id("subject")), "one icon short of the threshold");
  }
  const oppTurn = board({ [o.icon]: exactCount + 2 } as Icons, { n: 2, active: P2 });
  refused(() => playRaw(oppTurn.engine, P1, oppTurn.id("subject")), "not on the opponent's turn");
  assert.equal(zoneOf(oppTurn.engine, oppTurn.id("subject")), "hand");
}

/** A character in play has the printed strength / life / speed. */
function statsAre(printingId: string, strength: number, life: number, speed: number): void {
  const { engine, id } = buildGame({ cards: [{ key: "subject", def: printing(printingId), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("subject"), "strength"), strength, "strength");
  assert.equal(engine.getStat(id("subject"), "life"), life, "life");
  assert.equal(engine.getStat(id("subject"), "speed"), speed, "speed");
}

// =================================================================================
// Arrogance
// This card provides - [E][E]
// When this card enters play, your faction loses 1 influence.
// Resource (Gearsmith), cost 0.
// =================================================================================

const ARROGANCE = "1e955cf5-ecf5-4f28-82dc-ab10179b2bba";

const arrogance = (key = "arr", zone: CardPlacement["zone"] = "hand", owner: PlayerId = P1, faceDown?: boolean): CardPlacement => ({
  key,
  def: printing(ARROGANCE),
  owner,
  zone,
  faceDown
});

/** A free tactic that plays one chosen card from its controller's hand as a resource (face-up if it is a real resource, else face-down). */
const playAsResource = (): CardDefinition =>
  tactic({
    name: "Play As Resource",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pr",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }],
          effects: [{ type: "playResource", target: { type: "selected", id: "t" }, faceDown: "auto" }]
        }
      ]
    }
  });

/** A free tactic that puts one chosen resource from its controller's discard pile into play (it is "put into play", not "played"). */
const putResourceIntoPlay = (): CardDefinition =>
  tactic({
    name: "Put Resource Into Play",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pip",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "resource" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

function gateBoard(placements: CardPlacement[], threshold: string) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "gate", def: gate(threshold), owner: P1, zone: "hand" }, ...placements]
  });
}

const stapleElitism = (key: string): CardPlacement[] => bank("elitism", 1, P1).map((p) => ({ ...p, key }));

clause(ARROGANCE, "0:rule", "face-up in play it provides exactly two Elitism icons and no other icon", () => {
  const { engine } = buildGame({ cards: [arrogance("arr", "play")] });
  const thresholds = engine.getThresholds(P1);
  assert.equal(thresholds.elitism, 2, "two [E]");
  for (const icon of ["rage", "greed", "deception", "obsession", "volition"] as const) assert.equal(thresholds[icon] ?? 0, 0, `no ${icon}`);
});

clause(ARROGANCE, "0:rule", "its icons are its controller's only: the opponent gets none from it", () => {
  const { engine } = buildGame({ cards: [arrogance("arr", "play")] });
  assert.equal(engine.getThresholds(P2).elitism ?? 0, 0);
  const theirs = buildGame({ cards: [arrogance("arr", "play", P2)] });
  assert.equal(theirs.engine.getThresholds(P2).elitism, 2, "the opponent's own copy provides to them");
  assert.equal(theirs.engine.getThresholds(P1).elitism ?? 0, 0);
});

clause(ARROGANCE, "0:rule", "in the hand or the discard pile it provides nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine } = buildGame({ cards: [arrogance("arr", zone)] });
    assert.equal(engine.getThresholds(P1).elitism ?? 0, 0, zone);
    assert.equal(ready(engine), 0, `${zone}: not a resource in play`);
  }
});

clause(ARROGANCE, "0:rule", "it is ONE resource for paying numeric costs (it provides two icons but pays 1): it pays a cost-1 card but cannot pay a cost-2 card", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [arrogance("arr", "play"), { key: "one", def: item({ name: "CostOne", cost: 1 }), owner: P1, zone: "hand" }, { key: "two", def: item({ name: "CostTwo", cost: 2 }), owner: P1, zone: "hand" }]
  });
  assert.equal(ready(engine), 1, "one resource");
  refused(() => playRaw(engine, P1, id("two")), "two icons do not pay a numeric cost of 2", /Costs cannot be paid/);
  assert.equal(zoneOf(engine, id("two")), "hand");
  play(engine, P1, id("one"));
  assert.equal(zoneOf(engine, id("one")), "play");
  assert.equal(ready(engine), 0, "the single resource was attached to pay");
});

for (const [threshold, others, ok] of [
  ["e", {}, true],
  ["ee", {}, true],
  ["eee", {}, false],
  ["eee", { elitism: 1 }, true],
  ["eeee", { elitism: 1 }, false],
  ["eeee", { elitism: 2 }, true],
  ["ee", { rage: 4, greed: 4 }, true],
  ["r", {}, false],
  ["g", {}, false],
  ["d", {}, false],
  ["o", {}, false],
  ["v", {}, false],
  ["er", {}, false]
] as const) {
  clause(ARROGANCE, "0:rule", `threshold [${threshold.toUpperCase().split("").join("][")}] with Arrogance and ${JSON.stringify(others)} is ${ok ? "met" : "NOT met"}`, () => {
    const { engine, id } = gateBoard([arrogance("arr", "play"), ...res(others as Icons)], threshold);
    if (ok) {
      play(engine, P1, id("gate"));
      assert.equal(zoneOf(engine, id("gate")), "play");
    } else {
      refused(() => playRaw(engine, P1, id("gate")), `threshold ${threshold}`);
      assert.equal(zoneOf(engine, id("gate")), "hand");
    }
  });
}

clause(ARROGANCE, "0:rule", "two Arrogances provide four [E] between them: threshold [E][E][E][E] is met, five is not", () => {
  const four = gateBoard([arrogance("arr", "play"), arrogance("arr2", "play")], "eeee");
  assert.equal(four.engine.getThresholds(P1).elitism, 4);
  play(four.engine, P1, four.id("gate"));
  assert.equal(zoneOf(four.engine, four.id("gate")), "play");
  const five = gateBoard([arrogance("arr", "play"), arrogance("arr2", "play")], "eeeee");
  refused(() => playRaw(five.engine, P1, five.id("gate")), "four icons are not five");
});

clause(ARROGANCE, "0:rule", "icons are a gate, never spent: paying with Arrogance leaves its icons providing, and it can meet the same threshold again", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      arrogance("arr", "play"),
      { key: "a", def: item({ name: "A", cost: 1, threshold: "ee" }), owner: P1, zone: "hand" },
      { key: "b", def: item({ name: "B", cost: 0, threshold: "ee" }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("a"));
  assert.equal(ready(engine), 0, "Arrogance itself was attached to pay for A");
  assert.equal(engine.getThresholds(P1).elitism, 2, "...but it still provides [E][E]");
  play(engine, P1, id("b"));
  assert.equal(zoneOf(engine, id("b")), "play", "so a second [E][E] card still deploys");
});

clause(ARROGANCE, "0:rule", "played face-down it provides only one Volition and none of its [E][E] (CR 203.4a, 411.1)", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction() }, cards: [arrogance("arr", "hand")] });
  developResource(engine, P1, id("arr"), true);
  assert.equal(engine.state.cards[id("arr")].faceDown, true);
  const thresholds = engine.getThresholds(P1);
  assert.equal(thresholds.volition, 1, "one Volition");
  assert.equal(thresholds.elitism ?? 0, 0, "no [E]");
});

clause(ARROGANCE, "0:rule", "when it leaves play it stops providing [E][E]", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [arrogance("arr", "play"), { key: "kill", def: killAny("resource"), owner: P1, zone: "hand" }]
  });
  assert.equal(engine.getThresholds(P1).elitism, 2);
  play(engine, P1, id("kill"), { selected: { t: [id("arr")] } });
  assert.equal(zoneOf(engine, id("arr")), "discard");
  assert.equal(engine.getThresholds(P1).elitism ?? 0, 0);
});

// --- When this card enters play, your faction loses 1 influence ------------------

clause(ARROGANCE, "1:rule", "played as a resource through the Develop Rule, it costs its controller exactly 1 influence and the opponent none", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, cards: [arrogance()] });
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  developResource(engine, P1, id("arr"), false);
  assert.equal(zoneOf(engine, id("arr")), "play");
  assert.equal(engine.state.cards[id("arr")].faceDown, false);
  assert.equal(influenceOf(engine, P1), mine - 1, "exactly 1 influence lost, not 2");
  assert.equal(influenceOf(engine, P2), theirs, "the opponent's influence is untouched");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ARROGANCE, "1:rule", "played as a resource by a card's effect it costs exactly 1 influence", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [arrogance(), { key: "pr", def: playAsResource(), owner: P1, zone: "hand" }]
  });
  const mine = influenceOf(engine, P1);
  play(engine, P1, id("pr"), { selected: { t: [id("arr")] } });
  assert.equal(zoneOf(engine, id("arr")), "play");
  assert.equal(engine.state.cards[id("arr")].faceDown, false, "a real resource is played face-up");
  assert.equal(influenceOf(engine, P1), mine - 1);
});

clause(ARROGANCE, "1:rule", "put into play from the discard pile by an effect (not 'played') it still 'enters play': exactly 1 influence is lost", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [arrogance("arr", "discard"), { key: "pip", def: putResourceIntoPlay(), owner: P1, zone: "hand" }]
  });
  const mine = influenceOf(engine, P1);
  play(engine, P1, id("pip"), { selected: { t: [id("arr")] } });
  assert.equal(zoneOf(engine, id("arr")), "play");
  assert.equal(engine.state.cards[id("arr")].faceDown, false);
  assert.equal(influenceOf(engine, P1), mine - 1);
});

clause(ARROGANCE, "1:rule", "'your faction' is its controller's: when the opponent plays their own Arrogance THEY lose the influence and I do not", () => {
  const { engine, id } = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [arrogance("arr", "hand", P2)]
  });
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  developResource(engine, P2, id("arr"), false);
  assert.equal(influenceOf(engine, P2), theirs - 1);
  assert.equal(influenceOf(engine, P1), mine);
});

clause(ARROGANCE, "1:rule", "played face-down it has no rules text (CR 411.1): no influence is lost", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction() }, cards: [arrogance()] });
  const mine = influenceOf(engine, P1);
  developResource(engine, P1, id("arr"), true);
  assert.equal(influenceOf(engine, P1), mine);
});

clause(ARROGANCE, "1:rule", "put into play face-down by an effect: no influence is lost", () => {
  const faceDownPut = tactic({
    name: "Put Face-Down",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pf",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller", faceDown: true }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [arrogance("arr", "discard"), { key: "pf", def: faceDownPut, owner: P1, zone: "hand" }]
  });
  const mine = influenceOf(engine, P1);
  play(engine, P1, id("pf"), { selected: { t: [id("arr")] } });
  assert.equal(zoneOf(engine, id("arr")), "play");
  assert.equal(engine.state.cards[id("arr")].faceDown, true);
  assert.equal(influenceOf(engine, P1), mine);
});

clause(ARROGANCE, "1:rule", "only 'this card' counts: another resource entering play while Arrogance is already in play costs nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [arrogance("arr", "play"), { key: "staple", def: resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "hand" }]
  });
  const mine = influenceOf(engine, P1);
  developResource(engine, P1, id("staple"), false);
  assert.equal(zoneOf(engine, id("staple")), "play");
  assert.equal(influenceOf(engine, P1), mine);
});

clause(ARROGANCE, "1:rule", "nothing is lost for merely having copies in hand or deck, nor when a copy leaves play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      arrogance("inHand", "hand"),
      arrogance("onDeck", "deck"),
      arrogance("inPlay", "play"),
      { key: "kill", def: killAny("resource"), owner: P1, zone: "hand" }
    ]
  });
  const mine = influenceOf(engine, P1);
  play(engine, P1, id("kill"), { selected: { t: [id("inPlay")] } });
  assert.equal(zoneOf(engine, id("inPlay")), "discard");
  assert.equal(influenceOf(engine, P1), mine, "leaving play costs nothing");
});

clause(ARROGANCE, "1:rule", "each Arrogance entering play costs 1: two of them cost 2", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [arrogance("a1"), arrogance("a2"), { key: "pr", def: playAsResource(), owner: P1, zone: "hand" }]
  });
  const mine = influenceOf(engine, P1);
  developResource(engine, P1, id("a1"), false);
  assert.equal(influenceOf(engine, P1), mine - 1);
  play(engine, P1, id("pr"), { selected: { t: [id("a2")] } });
  assert.equal(influenceOf(engine, P1), mine - 2);
});

clause(ARROGANCE, "1:rule", "with 2 influence left it drops to 1 and the game goes on", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction(), influence: 2 }, cards: [arrogance()] });
  developResource(engine, P1, id("arr"), false);
  assert.equal(influenceOf(engine, P1), 1);
  assert.equal(engine.state.winner, undefined);
});

clause(ARROGANCE, "1:rule", "with 1 influence left it drops to 0 and its controller loses the game (CR 102)", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction(), influence: 1 }, cards: [arrogance()] });
  developResource(engine, P1, id("arr"), false);
  assert.equal(influenceOf(engine, P1), 0);
  assert.equal(engine.state.winner, P2);
});

clause(ARROGANCE, "1:rule", "the loss is an influence loss, not damage: the opponent's faction and characters are untouched, and nothing is dealt to my faction card", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [arrogance(), { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" }]
  });
  developResource(engine, P1, id("arr"), false);
  assert.equal(engine.state.cards[id("foe")].damage, 0);
  assert.equal(engine.state.cards[factionOf(engine, P1)].damage ?? 0, 0, "a faction carries no damage markers");
});

// =================================================================================
// Assistant Mud Whisperer
// At the start of your opponent's turn, you may pick a character. If you do, restore it.
// Character (mud whisperer, 31f), cost 5, [E], 3 strength / 2 speed / 4 life.
// =================================================================================

const AMW = "cf55d22c-3b57-4e63-bad2-4ec8ea6478d6";

interface AmwOpts {
  /** Where the Mud Whisperer is. */
  zone?: "play" | "hand" | "discard";
  faceDown?: boolean;
  /** Who controls it (owner is always P1). */
  controller?: PlayerId;
  /** Whose turn it is on the built board (the turn that STARTS next is the other player's). */
  active?: PlayerId;
  copies?: number;
  extra?: CardPlacement[];
}

/** P1 owns the Mud Whisperer. Depleted: mineDep, mineDep2, foeDep, thingDep (item), placeDep (location). Ready: mineReady, foeReady. */
function amwBoard(o: AmwOpts = {}) {
  return buildGame({
    playerA: { faction: holdFaction() },
    playerB: { faction: holdFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "amw", def: printing(AMW), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown, controller: o.controller },
      ...(o.copies && o.copies > 1 ? [{ key: "amw2", def: printing(AMW), owner: P1, zone: "play" as const }] : []),
      { key: "mineDep", def: character({ name: "MineDep" }), owner: P1, zone: "play", depleted: true },
      { key: "mineDep2", def: character({ name: "MineDep2" }), owner: P1, zone: "play", depleted: true },
      { key: "mineReady", def: character({ name: "MineReady" }), owner: P1, zone: "play" },
      { key: "foeDep", def: character({ name: "FoeDep" }), owner: P2, zone: "play", depleted: true },
      { key: "foeReady", def: character({ name: "FoeReady" }), owner: P2, zone: "play" },
      { key: "thingDep", def: item({ name: "ThingDep" }), owner: P1, zone: "play", depleted: true },
      { key: "placeDep", def: location({ name: "PlaceDep" }), owner: P1, zone: "play", depleted: true },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...(o.extra ?? [])
    ]
  });
}

clause(AMW, "0:rule", "deploys for exactly its printed cost of 5 and threshold [E]", () => deployChecks(AMW, { cost: 5, icon: "elitism", icons: 1, type: "character" }));

clause(AMW, "0:rule", "has its printed stats: 3 strength, 4 life, 2 speed", () => statsAre(AMW, 3, 4, 2));

clause(AMW, "0:rule", "at the start of the opponent's turn its controller (not the opponent) is offered a pick of a character", () => {
  const { engine } = amwBoard();
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the opponent's turn has started");
  const pc = pending(engine);
  assert.ok(pc, "a pick is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Mud Whisperer's controller picks");
});

clause(AMW, "0:rule", "picking one of my depleted characters restores it, and ONLY it", () => {
  const { engine, id } = amwBoard();
  assert.equal(isDepleted(engine, id("mineDep")), true, "precondition: depleted");
  const seen = startTurnOf(engine, P2, picking([id("mineDep")]));
  assert.ok(seen.includes("p1:chooserSelectsTarget"), "seen.includes(\"p1:chooserSelectsTarget\")");
  assert.equal(isDepleted(engine, id("mineDep")), false, "restored");
  for (const key of ["mineDep2", "foeDep", "thingDep", "placeDep"]) assert.equal(isDepleted(engine, id(key)), true, `${key} stays depleted`);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(AMW, "0:rule", "the pick may be an opponent's character: their depleted character is restored", () => {
  const { engine, id } = amwBoard();
  startTurnOf(engine, P2, picking([id("foeDep")]));
  assert.equal(isDepleted(engine, id("foeDep")), false);
  assert.equal(isDepleted(engine, id("mineDep")), true, "mine is not restored");
});

clause(AMW, "0:rule", "the pick may be the Mud Whisperer itself", () => {
  const { engine, id } = amwBoard({ extra: [] });
  engine.state.cards[id("amw")].depleted = true;
  startTurnOf(engine, P2, picking([id("amw")]));
  assert.equal(isDepleted(engine, id("amw")), false);
});

clause(AMW, "0:rule", "picking a character that is not depleted is legal and changes nothing", () => {
  const { engine, id } = amwBoard();
  startTurnOf(engine, P2, picking([id("mineReady")]));
  assert.equal(isDepleted(engine, id("mineReady")), false);
  for (const key of ["mineDep", "mineDep2", "foeDep"]) assert.equal(isDepleted(engine, id(key)), true, `${key} unaffected`);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(AMW, "0:rule", "'you may': declining restores nothing (the opponent's faction here does not restore characters either)", () => {
  const { engine, id } = amwBoard();
  const seen = startTurnOf(engine, P2, declineAll);
  assert.deepEqual(seen, ["p1:chooserSelectsTarget"], "offered once, to me");
  for (const key of ["mineDep", "mineDep2", "foeDep", "thingDep", "placeDep"]) assert.equal(isDepleted(engine, id(key)), true, `${key} still depleted`);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.activePlayerId, P2);
});

clause(AMW, "0:rule", "'pick a character': an item, a location, a faction, a face-down card and characters in a hand or discard pile cannot be picked", () => {
  const { engine, id } = amwBoard();
  endTurn(engine, P1);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  refused(tryPick(engine, P1, [id("thingDep")]), "an item");
  refused(tryPick(engine, P1, [id("placeDep")]), "a location");
  refused(tryPick(engine, P1, [factionOf(engine, P1)]), "my faction");
  refused(tryPick(engine, P1, [factionOf(engine, P2)]), "their faction");
  refused(tryPick(engine, P1, [id("fd")]), "a face-down card is only a resource");
  refused(tryPick(engine, P1, [id("inHand")]), "a character in my hand");
  refused(tryPick(engine, P1, [id("inDiscard")]), "a character in my discard pile");
  assert.equal(isDepleted(engine, id("thingDep")), true, "the refused item pick restored nothing");
  assert.equal(isDepleted(engine, id("placeDep")), true);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mineDep")] });
  assert.equal(isDepleted(engine, id("mineDep")), false, "control: a character in play is accepted");
});

clause(AMW, "0:rule", "it is a single pick: two characters are refused", () => {
  const { engine, id } = amwBoard();
  endTurn(engine, P1);
  refused(tryPick(engine, P1, [id("mineDep"), id("mineDep2")]), "two picks");
  assert.equal(isDepleted(engine, id("mineDep")), true);
  assert.equal(isDepleted(engine, id("mineDep2")), true);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mineDep")] });
  assert.equal(isDepleted(engine, id("mineDep")), false);
  assert.equal(isDepleted(engine, id("mineDep2")), true);
});

clause(AMW, "0:rule", "it is the OPPONENT's turn start that triggers it: at the start of my own turn nothing is offered", () => {
  const { engine, id } = amwBoard({ active: P2 });
  const seen = startTurnOf(engine, P1, declineAll);
  assert.deepEqual(seen, [], "nothing is asked at the start of my own turn");
  assert.equal(engine.state.activePlayerId, P1);
  for (const key of ["mineDep", "mineDep2", "foeDep"]) assert.equal(isDepleted(engine, id(key)), true, `${key} unchanged`);
});

clause(AMW, "0:rule", "it triggers at the start of EVERY opponent turn, not just the next one", () => {
  const { engine, id } = amwBoard();
  startTurnOf(engine, P2, picking([id("mineDep")]));
  assert.equal(isDepleted(engine, id("mineDep")), false);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "my own turn: nothing offered");
  assert.equal(engine.state.pendingChoice, undefined);
  engine.state.cards[id("mineDep")].depleted = true;
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the opponent's second turn has started");
  const pc = pending(engine);
  assert.ok(pc, "offered again");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mineDep")] });
  assert.equal(isDepleted(engine, id("mineDep")), false);
});

clause(AMW, "0:rule", "it only works while it is in play: in my hand or my discard pile nothing is offered", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = amwBoard({ zone });
    const seen = startTurnOf(engine, P2, picking([id("mineDep")]));
    assert.deepEqual(seen, [], `Mud Whisperer in ${zone}`);
    assert.equal(isDepleted(engine, id("mineDep")), true, zone);
  }
});

clause(AMW, "0:rule", "a face-down Mud Whisperer is just a resource with no rules text (CR 411.1): nothing is offered", () => {
  const { engine, id } = amwBoard({ faceDown: true });
  const seen = startTurnOf(engine, P2, picking([id("mineDep")]));
  assert.deepEqual(seen, []);
  assert.equal(isDepleted(engine, id("mineDep")), true);
});

clause(AMW, "0:rule", "'your opponent' is relative to its CONTROLLER: a Mud Whisperer I own but the opponent controls triggers for them at the start of MY turn, and not at the start of theirs", () => {
  const { engine, id } = amwBoard({ controller: P2, active: P2 });
  const atMyTurn = startTurnOf(engine, P1, picking([id("foeDep")]));
  assert.deepEqual(atMyTurn, ["p2:chooserSelectsTarget"], "its controller P2 is the one asked at the start of P1's turn");
  assert.equal(isDepleted(engine, id("foeDep")), false);
  endTurn(engine, P1);
  const atTheirTurn = drainRecording(engine, declineAll);
  assert.deepEqual(atTheirTurn, [], "nothing at the start of its controller's own turn");
});

clause(AMW, "0:rule", "two Mud Whisperers each trigger: each gets its own pick, and both picks are restored", () => {
  const { engine, id } = amwBoard({ copies: 2 });
  const queue = [id("mineDep"), id("mineDep2")];
  endTurn(engine, P1);
  const seen = drainRecording(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [queue.shift()!] };
    return declineAll(pc);
  });
  assert.equal(seen.filter((entry) => entry === "p1:chooserSelectsTarget").length, 2, "two picks were offered");
  assert.equal(isDepleted(engine, id("mineDep")), false);
  assert.equal(isDepleted(engine, id("mineDep2")), false);
  assert.equal(isDepleted(engine, id("foeDep")), true);
});

clause(AMW, "0:rule", "the restore is real: a depleted character of mine that was restored can block the opponent's attack, one that was not cannot", () => {
  const { engine, id } = amwBoard({ extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" }] });
  startTurnOf(engine, P2, picking([id("mineDep")]));
  declareAttackBy(engine, P2, [id("atk")]);
  refused(() => declareBlockers(engine, P1, [id("mineDep2")]), "still depleted: cannot block");
  declareBlockers(engine, P1, [id("mineDep")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("mineDep")], "the restored character blocks");
});

// =================================================================================
// B14nd P3pp3r
// ATTACH TO CHARACTER
// The attached character gains 1 strength and 1 life.
// SPIT OUT -- COST: Destroy this card. Pick a character.
//          -- EFFECT: This turn, the character gains 1 strength and 1 life.
// Item (gear), cost 1, [E].
//
// H07 P3pp3r
// ATTACH TO CHARACTER
// The attached character gains 2 strength and 2 life.
// SPIT OUT -- COST: Destroy this card. Pick 2 or fewer characters.
//          -- EFFECT: Restore the characters.
// Item (gear), cost 4, [E].
//
// The two share one set of attach / buff / cost checks (parametrised bodies below);
// each printing still gets its own clause() calls.
// =================================================================================

const BLAND_PEPPER = "cf351c97-aab8-46a2-bbe2-450bcde65738";
const HOT_PEPPER = "63913bf7-a277-4eda-970c-b0f060d46d23";

interface Pepper {
  id: string;
  name: string;
  cost: number;
  /** Strength and life the attached character gains. */
  bonus: number;
  /** The ability's target declaration id. */
  decl: string;
}

const BLAND: Pepper = { id: BLAND_PEPPER, name: "B14nd P3pp3r", cost: 1, bonus: 1, decl: "c" };
const HOT: Pepper = { id: HOT_PEPPER, name: "H07 P3pp3r", cost: 4, bonus: 2, decl: "cs" };

interface PepperOpts {
  pepper?: "hand" | "play" | "discard";
  host?: string;
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  second?: boolean;
  extra?: CardPlacement[];
}

/**
 * P1: mine, mine2 (2 strength / 3 life / 2 speed), P2: foe, foe2 (same), thing (item), place (location),
 * fd (face-down), mh / oc (characters in hands), inDiscard (character in P1's discard pile).
 */
function pepperBoard(p: Pepper, o: PepperOpts = {}) {
  const zone = o.pepper ?? "hand";
  const inPlay = zone === "play";
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pep", def: printing(p.id), owner: P1, zone, attachedToKey: inPlay ? (o.host ?? "mine") : undefined },
      ...(o.second ? [{ key: "pep2", def: printing(p.id), owner: P1, zone: "play" as const, attachedToKey: o.host ?? "mine" }] : []),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OppHandChar" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...res(o.icons ?? { elitism: p.cost + 3 }),
      ...(o.extra ?? [])
    ]
  });
}

/** A free tactic dealing `amount` damage to one chosen character (id `zap`, declaration `t`). */
const zapChar = (amount: number): CardDefinition =>
  tactic({
    name: `Zap ${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }
      ]
    }
  });

const deployPepper = (engine: SpoilsEngine, id: IdOf, host: CardInstanceId) => play(engine, P1, id("pep"), { selected: { attachTo: [host] } });
const spit = (engine: SpoilsEngine, id: IdOf, p: Pepper, picks: CardInstanceId[], player: PlayerId = P1, key = "pep") =>
  engine.perform({ type: "activateAbility", playerId: player, cardId: id(key), abilityId: "spit", selected: { [p.decl]: picks }, variables: {} } as never);
const spitDone = (engine: SpoilsEngine, id: IdOf, p: Pepper, picks: CardInstanceId[], player: PlayerId = P1, key = "pep") => {
  spit(engine, id, p, picks, player, key);
  resolvePendingResponses(engine);
};

// --- ATTACH TO CHARACTER ---------------------------------------------------------

const attachDeploys = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p);
  const before = ready(engine);
  deployPepper(engine, id, id("mine"));
  assert.equal(zoneOf(engine, id("pep")), "play", "the item enters play");
  assert.equal(engine.state.cards[id("pep")].attachedTo, id("mine"), "attached to the picked character");
  assert.equal(before - ready(engine), p.cost, `the printed cost of ${p.cost} is paid`);
  assert.equal(engine.state.cards[id("mine2")].attachedTo, undefined, "no other character gets it");
  assert.equal(engine.state.cards[id("pep")].controllerId, P1);
  assert.equal(engine.getDefinition(id("pep")).type, "item");
  assert.ok(engine.getDefinition(id("pep")).subtype.includes("gear"), "gear");
};

const attachToOpposing = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p);
  deployPepper(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("pep")), "play");
  assert.equal(engine.state.cards[id("pep")].attachedTo, id("foe"), "ATTACH TO CHARACTER names no controller: an opposing character is a legal host");
  assert.equal(engine.state.cards[id("pep")].controllerId, P1, "I still control the item");
};

const attachRefusals = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p);
  const attempt = (host: CardInstanceId) => () => playRaw(engine, P1, id("pep"), { selected: { attachTo: [host] } });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(attempt(factionOf(engine, P1)), "my faction");
  refused(attempt(id("fd")), "a face-down card (only a resource)");
  refused(attempt(id("mh")), "a character in my hand");
  refused(attempt(id("oc")), "a character in the opponent's hand");
  refused(attempt(id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(engine, id("pep")), "hand", "nothing was played");
  assert.equal(ready(engine), p.cost + 3, "nothing was paid by the refused attempts");
  attempt(id("mine"))();
  assert.ok(engine.state.responseWindow, "control: a character in play is accepted");
};

const attachNeedsOneHost = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p);
  refused(() => playRaw(engine, P1, id("pep"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(engine, P1, id("pep"), { selected: {} }), "no host declared");
  refused(() => playRaw(engine, P1, id("pep"), { selected: { attachTo: [id("mine"), id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(engine, id("pep")), "hand");
  assert.equal(ready(engine), p.cost + 3);
};

const attachNeedsACharacter = (p: Pepper) => () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "pep", def: printing(p.id), owner: P1, zone: "hand" }, ...res({ elitism: p.cost + 3 })]
  });
  refused(() => playRaw(engine, P1, id("pep"), { selected: { attachTo: [] } }), "no character in play to attach to");
  assert.equal(zoneOf(engine, id("pep")), "hand");
  assert.equal(ready(engine), p.cost + 3);
};

const attachHostGoneInResponse = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { extra: [{ key: "kill", def: killAny("character"), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("pep"), { selected: { attachTo: [id("foe")] } });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("foe")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard", "the host was destroyed in response");
  assert.equal(zoneOf(engine, id("pep")), "discard", "no host left: the item goes to its owner's discard pile (CR 507.2c)");
  assert.ok(discardOf(engine, P1).includes(id("pep")), "discardOf(engine, P1).includes(id(\"pep\"))");
  assert.equal(engine.state.cards[id("pep")].attachedTo, undefined);
};

const hostDestroyedLater = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "kill", def: killAny("character"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("pep")), "discard", "attached cards leave play with their host (CR 301.4)");
  assert.ok(discardOf(engine, P1).includes(id("pep")), "in its owner's discard pile");
};

const hostBouncedPepperFollows = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "bounce", def: bounceChar(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.equal(zoneOf(engine, id("pep")), "hand", "the attached card leaves play the same way as its host: into its owner's hand (CR 301.4a)");
  assert.ok(handOf(engine, P1).includes(id("pep")), "handOf(engine, P1).includes(id(\"pep\"))");
};

const hostExiledPepperFollows = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "exile", def: exileChar(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("exile"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "removed");
  assert.equal(zoneOf(engine, id("pep")), "removed", "the attached card is removed from the game the same way as its host (CR 301.4a)");
};

const hostStopsBeingCharacter = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "flip", def: flipDownChar(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("flip"), { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].faceDown, true, "the host is a face-down resource now");
  assert.equal(zoneOf(engine, id("pep")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(engine.state.cards[id("pep")].faceDown, true, "...and is flipped face-down along with its host");
};

const attachCostAndThreshold = (p: Pepper) => () => {
  const exact = pepperBoard(p, { icons: { elitism: p.cost } });
  deployPepper(exact.engine, exact.id, exact.id("mine"));
  assert.equal(zoneOf(exact.engine, exact.id("pep")), "play", "exactly the cost with [E] is enough");
  assert.equal(ready(exact.engine), 0);
  if (p.cost > 1) {
    const short = pepperBoard(p, { icons: { elitism: p.cost - 1 } });
    refused(() => playRaw(short.engine, P1, short.id("pep"), { selected: { attachTo: [short.id("mine")] } }), "one resource short");
    assert.equal(zoneOf(short.engine, short.id("pep")), "hand");
  } else {
    const none = pepperBoard(p, { icons: {} });
    refused(() => playRaw(none.engine, P1, none.id("pep"), { selected: { attachTo: [none.id("mine")] } }), "no resources");
  }
  const noThreshold = pepperBoard(p, { icons: { rage: p.cost + 5 } });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("pep"), { selected: { attachTo: [noThreshold.id("mine")] } }), "plenty of resources but no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("pep")), "hand");
  const one = pepperBoard(p, { icons: { elitism: 1, rage: p.cost + 3 } });
  deployPepper(one.engine, one.id, one.id("mine"));
  assert.equal(zoneOf(one.engine, one.id("pep")), "play", "a single [E] among other resources is enough");
};

const attachOwnTurnOnly = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("pep"), { selected: { attachTo: [id("foe")] } }), "the opponent's turn");
  assert.equal(zoneOf(engine, id("pep")), "hand");
};

clause(BLAND_PEPPER, "0:attach", "deploys for exactly 1 and enters play attached to the picked character (one of mine); it is a gear item", attachDeploys(BLAND));
clause(BLAND_PEPPER, "0:attach", "it can attach to an opposing character: I still control the item", attachToOpposing(BLAND));
clause(BLAND_PEPPER, "0:attach", "a host that is not a character in play is refused: item, location, factions, face-down card, cards in hands and discard piles", attachRefusals(BLAND));
clause(BLAND_PEPPER, "0:attach", "exactly one host must be picked: none or two are refused", attachNeedsOneHost(BLAND));
clause(BLAND_PEPPER, "0:attach", "with no character in play at all it cannot be deployed", attachNeedsACharacter(BLAND));
clause(BLAND_PEPPER, "0:attach", "if the picked host is destroyed in response the item never enters play: it goes to its owner's discard pile (CR 507.2c)", attachHostGoneInResponse(BLAND));
clause(BLAND_PEPPER, "0:attach", "when the host is destroyed later the item leaves play with it, into its owner's discard pile (CR 301.4)", hostDestroyedLater(BLAND));
clause(BLAND_PEPPER, "0:attach", "when the host is put into its owner's hand the item follows it to its owner's hand (CR 301.4a), not to the discard pile", hostBouncedPepperFollows(BLAND));
clause(BLAND_PEPPER, "0:attach", "when the host is removed from the game the item is removed from the game too (CR 301.4a)", hostExiledPepperFollows(BLAND));
clause(BLAND_PEPPER, "0:attach", "if the host stops being a character (turned face-down into a resource) the item is flipped face-down with it", hostStopsBeingCharacter(BLAND));
clause(BLAND_PEPPER, "0:attach", "needs [E] and exactly 1 resource: refused with none, refused without [E], accepted with one [E]", attachCostAndThreshold(BLAND));
clause(BLAND_PEPPER, "0:attach", "an item is deployed on its controller's own turn only", attachOwnTurnOnly(BLAND));

clause(HOT_PEPPER, "0:attach", "deploys for exactly 4 and enters play attached to the picked character (one of mine); it is a gear item", attachDeploys(HOT));
clause(HOT_PEPPER, "0:attach", "it can attach to an opposing character: I still control the item", attachToOpposing(HOT));
clause(HOT_PEPPER, "0:attach", "a host that is not a character in play is refused: item, location, factions, face-down card, cards in hands and discard piles", attachRefusals(HOT));
clause(HOT_PEPPER, "0:attach", "exactly one host must be picked: none or two are refused", attachNeedsOneHost(HOT));
clause(HOT_PEPPER, "0:attach", "with no character in play at all it cannot be deployed", attachNeedsACharacter(HOT));
clause(HOT_PEPPER, "0:attach", "if the picked host is destroyed in response the item never enters play: it goes to its owner's discard pile (CR 507.2c)", attachHostGoneInResponse(HOT));
clause(HOT_PEPPER, "0:attach", "when the host is destroyed later the item leaves play with it, into its owner's discard pile (CR 301.4)", hostDestroyedLater(HOT));
clause(HOT_PEPPER, "0:attach", "when the host is put into its owner's hand the item follows it to its owner's hand (CR 301.4a), not to the discard pile", hostBouncedPepperFollows(HOT));
clause(HOT_PEPPER, "0:attach", "when the host is removed from the game the item is removed from the game too (CR 301.4a)", hostExiledPepperFollows(HOT));
clause(HOT_PEPPER, "0:attach", "if the host stops being a character (turned face-down into a resource) the item is flipped face-down with it", hostStopsBeingCharacter(HOT));
clause(HOT_PEPPER, "0:attach", "needs [E] and exactly 4 resources: refused one short, refused without [E], accepted with one [E] among others", attachCostAndThreshold(HOT));
clause(HOT_PEPPER, "0:attach", "an item is deployed on its controller's own turn only", attachOwnTurnOnly(HOT));

// --- The attached character gains N strength and N life ---------------------------

const buffExact = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play" });
  assert.equal(engine.getStat(id("mine"), "strength"), 2 + p.bonus, `+${p.bonus} strength`);
  assert.equal(engine.getStat(id("mine"), "life"), 3 + p.bonus, `+${p.bonus} life`);
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "speed is untouched");
};

const buffOnlyHost = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play" });
  for (const key of ["mine2", "foe", "foe2"]) {
    assert.equal(engine.getStat(id(key), "strength"), 2, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), 3, `${key} life`);
  }
};

const buffOnOpposingHost = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", host: "foe" });
  assert.equal(engine.getStat(id("foe"), "strength"), 2 + p.bonus, "the opposing host gets the bonus, whoever controls the item");
  assert.equal(engine.getStat(id("foe"), "life"), 3 + p.bonus);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "my characters get nothing");
  assert.equal(engine.getStat(id("mine"), "life"), 3);
};

const buffStacks = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", second: true });
  assert.equal(engine.getStat(id("mine"), "strength"), 2 + 2 * p.bonus, "two copies stack");
  assert.equal(engine.getStat(id("mine"), "life"), 3 + 2 * p.bonus);
};

const buffEndsWhenItemLeaves = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "kill", def: killAny("item"), owner: P1, zone: "hand" }] });
  assert.equal(engine.getStat(id("mine"), "strength"), 2 + p.bonus);
  play(engine, P1, id("kill"), { selected: { t: [id("pep")] } });
  assert.equal(zoneOf(engine, id("pep")), "discard");
  assert.equal(zoneOf(engine, id("mine")), "play", "the host survives");
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "the bonus is gone with the item");
  assert.equal(engine.getStat(id("mine"), "life"), 3);
};

const buffNotFromHandOrDiscard = (p: Pepper) => () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = pepperBoard(p, { pepper: zone });
    assert.equal(engine.getStat(id("mine"), "strength"), 2, `${zone}: no bonus`);
    assert.equal(engine.getStat(id("mine"), "life"), 3, `${zone}: no bonus`);
  }
};

const buffLifeIsReal = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, {
    pepper: "play",
    extra: [
      { key: "zapMost", def: zapChar(2 + p.bonus), owner: P1, zone: "hand" },
      { key: "zapLast", def: zapChar(1), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zapMost"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "play", `${2 + p.bonus} damage does not kill a ${3 + p.bonus}-life character`);
  assert.equal(engine.state.cards[id("mine")].damage, 2 + p.bonus);
  play(engine, P1, id("zapLast"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard", `${3 + p.bonus} damage kills it`);
};

const buffLifeLostWithItem = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, {
    pepper: "play",
    extra: [
      { key: "zap3", def: zapChar(3), owner: P1, zone: "hand" },
      { key: "kill", def: killAny("item"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zap3"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "play", "survives 3 damage with the extra life");
  play(engine, P1, id("kill"), { selected: { t: [id("pep")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard", "without the item its life is back to 3 and 3 damage destroys it");
};

const buffStrengthIsReal = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", turn: 2 });
  const influence = influenceOf(engine, P2);
  fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - influenceOf(engine, P2), 2 + p.bonus, "the bonus strength is dealt as battle damage");
};

clause(BLAND_PEPPER, "1:rule", "the attached character gains exactly 1 strength and 1 life (speed is untouched)", buffExact(BLAND));
clause(BLAND_PEPPER, "1:rule", "only the attached character is affected", buffOnlyHost(BLAND));
clause(BLAND_PEPPER, "1:rule", "an opposing character it is attached to gets the bonus, not mine", buffOnOpposingHost(BLAND));
clause(BLAND_PEPPER, "1:rule", "two copies on the same character stack", buffStacks(BLAND));
clause(BLAND_PEPPER, "1:rule", "the bonus ends when the item leaves play; the host stays", buffEndsWhenItemLeaves(BLAND));
clause(BLAND_PEPPER, "1:rule", "in the hand or discard pile it gives nothing", buffNotFromHandOrDiscard(BLAND));
clause(BLAND_PEPPER, "1:rule", "the extra life is real: the host survives 3 damage and dies to the 4th", buffLifeIsReal(BLAND));
clause(BLAND_PEPPER, "1:rule", "a host holding 3 damage is destroyed the moment the item leaves play", buffLifeLostWithItem(BLAND));
clause(BLAND_PEPPER, "1:rule", "the extra strength is real in battle: an unblocked 2-strength attacker deals 3 to the faction", buffStrengthIsReal(BLAND));

clause(HOT_PEPPER, "1:rule", "the attached character gains exactly 2 strength and 2 life (speed is untouched)", buffExact(HOT));
clause(HOT_PEPPER, "1:rule", "only the attached character is affected", buffOnlyHost(HOT));
clause(HOT_PEPPER, "1:rule", "an opposing character it is attached to gets the bonus, not mine", buffOnOpposingHost(HOT));
clause(HOT_PEPPER, "1:rule", "two copies on the same character stack", buffStacks(HOT));
clause(HOT_PEPPER, "1:rule", "the bonus ends when the item leaves play; the host stays", buffEndsWhenItemLeaves(HOT));
clause(HOT_PEPPER, "1:rule", "in the hand or discard pile it gives nothing", buffNotFromHandOrDiscard(HOT));
clause(HOT_PEPPER, "1:rule", "the extra life is real: the host survives 4 damage and dies to the 5th", buffLifeIsReal(HOT));
clause(HOT_PEPPER, "1:rule", "a host holding 3 damage is destroyed the moment the item leaves play", buffLifeLostWithItem(HOT));
clause(HOT_PEPPER, "1:rule", "the extra strength is real in battle: an unblocked 2-strength attacker deals 4 to the faction", buffStrengthIsReal(HOT));

// --- SPIT OUT: cost ------------------------------------------------------------------

const spitCostDestroysItem = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play" });
  spitDone(engine, id, p, [id("mine2")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "the item is destroyed as the cost");
  assert.ok(discardOf(engine, P1).includes(id("pep")), "into its owner's discard pile");
  assert.equal(zoneOf(engine, id("mine")), "play", "its former host survives");
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "the host lost the item's bonus");
};

const spitNeedsAPick = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play" });
  refused(() => spit(engine, id, p, []), "the pick is part of the cost");
  assert.equal(zoneOf(engine, id("pep")), "play", "nothing was destroyed by the refused attempt");
  assert.equal(engine.state.cards[id("pep")].attachedTo, id("mine"));
  refused(() => spit(engine, id, p, [id("thing")]), "an item");
  refused(() => spit(engine, id, p, [id("place")]), "a location");
  refused(() => spit(engine, id, p, [factionOf(engine, P1)]), "my faction");
  refused(() => spit(engine, id, p, [factionOf(engine, P2)]), "their faction");
  refused(() => spit(engine, id, p, [id("fd")]), "a face-down card");
  refused(() => spit(engine, id, p, [id("mh")]), "a character in my hand");
  refused(() => spit(engine, id, p, [id("oc")]), "a character in the opponent's hand");
  refused(() => spit(engine, id, p, [id("inDiscard")]), "a character in a discard pile");
  assert.equal(zoneOf(engine, id("pep")), "play", "no refused attempt destroyed the item");
  spit(engine, id, p, [id("foe")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "control: a character in play is accepted and the cost is paid");
};

const spitOnlyController = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", turn: 2, active: P2 });
  refused(() => spit(engine, id, p, [id("foe")], P2), "only the item's controller may use it");
  assert.equal(zoneOf(engine, id("pep")), "play");
};

const spitNeedsToBeInPlay = (p: Pepper) => () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = pepperBoard(p, { pepper: zone });
    refused(() => spit(engine, id, p, [id("foe")]), `the item is in the ${zone}`);
  }
};

const spitByControllerOfOpposingHost = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", host: "foe" });
  spitDone(engine, id, p, [id("mine")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "I control the item attached to an opposing character, so I can use it");
};

const spitPickGoneInResponse = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "kill", def: killAny("character"), owner: P2, zone: "hand" }] });
  spit(engine, id, p, [id("foe")]);
  engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("foe")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("pep")), "discard", "the cost was paid when the ability was used");
  assert.equal(engine.state.pendingChoice, undefined);
};

clause(BLAND_PEPPER, "2:ability:spit", "the cost destroys the item itself (into its owner's discard pile); its former host stays in play without the bonus", spitCostDestroysItem(BLAND));
clause(BLAND_PEPPER, "2:ability:spit", "a character must be picked as part of the cost: none, an item, a location, factions, a face-down card, or cards outside play are refused and cost nothing", spitNeedsAPick(BLAND));
clause(BLAND_PEPPER, "2:ability:spit", "only the item's controller may use it", spitOnlyController(BLAND));
clause(BLAND_PEPPER, "2:ability:spit", "it can only be used while the item is in play", spitNeedsToBeInPlay(BLAND));
clause(BLAND_PEPPER, "2:ability:spit", "an item I control attached to an opposing character can be spat out by me", spitByControllerOfOpposingHost(BLAND));
clause(BLAND_PEPPER, "2:ability:spit", "if the picked character is destroyed in response the cost stays paid and nothing breaks", spitPickGoneInResponse(BLAND));

clause(HOT_PEPPER, "2:ability:spit", "the cost destroys the item itself (into its owner's discard pile); its former host stays in play without the bonus", spitCostDestroysItem(HOT));
clause(HOT_PEPPER, "2:ability:spit", "characters must be picked as part of the cost: an item, a location, factions, a face-down card, or cards outside play are refused and cost nothing", () => {
  const { engine, id } = pepperBoard(HOT, { pepper: "play" });
  refused(() => spit(engine, id, HOT, [id("thing")]), "an item");
  refused(() => spit(engine, id, HOT, [id("place")]), "a location");
  refused(() => spit(engine, id, HOT, [factionOf(engine, P1)]), "my faction");
  refused(() => spit(engine, id, HOT, [factionOf(engine, P2)]), "their faction");
  refused(() => spit(engine, id, HOT, [id("fd")]), "a face-down card");
  refused(() => spit(engine, id, HOT, [id("mh")]), "a character in my hand");
  refused(() => spit(engine, id, HOT, [id("oc")]), "a character in the opponent's hand");
  refused(() => spit(engine, id, HOT, [id("inDiscard")]), "a character in a discard pile");
  refused(() => spit(engine, id, HOT, [id("foe"), id("thing")]), "a legal pick next to an illegal one");
  assert.equal(zoneOf(engine, id("pep")), "play", "no refused attempt destroyed the item");
  spit(engine, id, HOT, [id("foe")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "control: a character in play is accepted and the cost is paid");
});
clause(HOT_PEPPER, "2:ability:spit", "only the item's controller may use it", spitOnlyController(HOT));
clause(HOT_PEPPER, "2:ability:spit", "it can only be used while the item is in play", spitNeedsToBeInPlay(HOT));
clause(HOT_PEPPER, "2:ability:spit", "an item I control attached to an opposing character can be spat out by me", spitByControllerOfOpposingHost(HOT));
clause(HOT_PEPPER, "2:ability:spit", "if the picked character is destroyed in response the cost stays paid and nothing breaks", spitPickGoneInResponse(HOT));

// --- SPIT OUT: B14nd P3pp3r's effect ----------------------------------------------------

function blandSpit() {
  return pepperBoard(BLAND, { pepper: "play" });
}

clause(BLAND_PEPPER, "2:ability:spit", "the picked character gains exactly 1 strength and 1 life this turn; nobody else does", () => {
  const { engine, id } = blandSpit();
  spitDone(engine, id, BLAND, [id("mine2")]);
  assert.equal(engine.getStat(id("mine2"), "strength"), 3);
  assert.equal(engine.getStat(id("mine2"), "life"), 4);
  assert.equal(engine.getStat(id("mine2"), "speed"), 2, "speed is untouched");
  for (const key of ["foe", "foe2"]) {
    assert.equal(engine.getStat(id(key), "strength"), 2, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), 3, `${key} life`);
  }
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "the former host only lost the item's bonus");
});

clause(BLAND_PEPPER, "2:ability:spit", "an opposing character can be picked and gains the bonus", () => {
  const { engine, id } = blandSpit();
  spitDone(engine, id, BLAND, [id("foe")]);
  assert.equal(engine.getStat(id("foe"), "strength"), 3);
  assert.equal(engine.getStat(id("foe"), "life"), 4);
  assert.equal(engine.getStat(id("foe2"), "strength"), 2);
});

clause(BLAND_PEPPER, "2:ability:spit", "picking the former host itself: it keeps +1/+1 for the turn (the item's bonus becomes the this-turn bonus)", () => {
  const { engine, id } = blandSpit();
  spitDone(engine, id, BLAND, [id("mine")]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  assert.equal(engine.getStat(id("mine"), "life"), 4);
});

clause(BLAND_PEPPER, "2:ability:spit", "the bonus lasts this turn only", () => {
  const { engine, id } = blandSpit();
  spitDone(engine, id, BLAND, [id("mine")]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "back to the printed 2 when the turn ends");
  assert.equal(engine.getStat(id("mine"), "life"), 3);
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "and it does not come back");
});

clause(BLAND_PEPPER, "2:ability:spit", "the extra life is real: a character with 3 damage survives it, and dies when it wears off at 3 life", () => {
  const { engine, id } = pepperBoard(BLAND, { pepper: "play", extra: [{ key: "zap2", def: zapChar(2), owner: P1, zone: "hand" }, { key: "zap1", def: zapChar(1), owner: P1, zone: "hand" }] });
  spitDone(engine, id, BLAND, [id("mine2")]);
  play(engine, P1, id("zap2"), { selected: { t: [id("mine2")] } });
  play(engine, P1, id("zap1"), { selected: { t: [id("mine2")] } });
  assert.equal(zoneOf(engine, id("mine2")), "play", "3 damage on a 4-life character");
  assert.equal(engine.state.cards[id("mine2")].damage, 3);
});

clause(BLAND_PEPPER, "2:ability:spit", "the extra strength is real in battle: a 2-strength attacker deals 3 to the faction", () => {
  const { engine, id } = pepperBoard(BLAND, { pepper: "play", turn: 2 });
  spitDone(engine, id, BLAND, [id("mine2")]);
  const influence = influenceOf(engine, P2);
  fight(engine, P1, [id("mine2")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - influenceOf(engine, P2), 3);
});

clause(BLAND_PEPPER, "2:ability:spit", "it can be used in response on the opponent's turn: the blocker gains the bonus before damage", () => {
  const { engine, id } = pepperBoard(BLAND, {
    pepper: "play",
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  spit(engine, id, BLAND, [id("mine2")]);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("pep")), "discard");
  assert.equal(engine.getStat(id("mine2"), "strength"), 3, "gained this turn (the opponent's turn)");
  assert.equal(engine.getStat(id("mine2"), "life"), 4);
});

clause(BLAND_PEPPER, "2:ability:spit", "two items can be spat out on the same character: the bonuses stack (+2/+2)", () => {
  const { engine, id } = pepperBoard(BLAND, { pepper: "play", second: true });
  spitDone(engine, id, BLAND, [id("mine2")], P1, "pep");
  spitDone(engine, id, BLAND, [id("mine2")], P1, "pep2");
  assert.equal(engine.getStat(id("mine2"), "strength"), 4);
  assert.equal(engine.getStat(id("mine2"), "life"), 5);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "both items are gone from the former host");
});

// --- SPIT OUT: H07 P3pp3r's effect ---------------------------------------------------------

function hotSpit(depleted: string[] = ["mine", "mine2", "foe", "foe2"]) {
  const game = pepperBoard(HOT, { pepper: "play" });
  for (const key of depleted) game.engine.state.cards[game.id(key)].depleted = true;
  return game;
}

clause(HOT_PEPPER, "2:ability:spit", "picking two depleted characters restores both, and only those", () => {
  const { engine, id } = hotSpit();
  spitDone(engine, id, HOT, [id("mine2"), id("foe")]);
  assert.equal(isDepleted(engine, id("mine2")), false);
  assert.equal(isDepleted(engine, id("foe")), false, "an opposing character can be picked");
  assert.equal(isDepleted(engine, id("mine")), true, "unpicked");
  assert.equal(isDepleted(engine, id("foe2")), true, "unpicked");
  assert.equal(zoneOf(engine, id("pep")), "discard");
});

clause(HOT_PEPPER, "2:ability:spit", "'2 or fewer': picking just one restores just that one", () => {
  const { engine, id } = hotSpit();
  spitDone(engine, id, HOT, [id("mine2")]);
  assert.equal(isDepleted(engine, id("mine2")), false);
  for (const key of ["mine", "foe", "foe2"]) assert.equal(isDepleted(engine, id(key)), true, `${key} stays depleted`);
});

clause(HOT_PEPPER, "2:ability:spit", "'2 or fewer': picking none is legal, the item is still destroyed and nothing is restored", () => {
  const { engine, id } = hotSpit();
  spitDone(engine, id, HOT, []);
  assert.equal(zoneOf(engine, id("pep")), "discard");
  for (const key of ["mine", "mine2", "foe", "foe2"]) assert.equal(isDepleted(engine, id(key)), true, `${key} stays depleted`);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(HOT_PEPPER, "2:ability:spit", "'2 or fewer': three characters are refused and the item is not destroyed", () => {
  const { engine, id } = hotSpit();
  refused(() => spit(engine, id, HOT, [id("mine"), id("mine2"), id("foe")]), "three picks");
  assert.equal(zoneOf(engine, id("pep")), "play");
  for (const key of ["mine", "mine2", "foe"]) assert.equal(isDepleted(engine, id(key)), true, `${key} unchanged`);
  spit(engine, id, HOT, [id("mine"), id("mine2")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "control: two picks are accepted");
});

clause(HOT_PEPPER, "2:ability:spit", "the same character cannot be picked twice", () => {
  const { engine, id } = hotSpit();
  refused(() => spit(engine, id, HOT, [id("mine2"), id("mine2")]), "the same card twice");
  assert.equal(zoneOf(engine, id("pep")), "play");
  spit(engine, id, HOT, [id("mine2"), id("foe")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "control: two different characters are accepted");
});

clause(HOT_PEPPER, "2:ability:spit", "characters that are not depleted may be picked: nothing happens to them", () => {
  const { engine, id } = hotSpit(["mine2"]);
  spitDone(engine, id, HOT, [id("mine2"), id("foe")]);
  assert.equal(isDepleted(engine, id("mine2")), false);
  assert.equal(isDepleted(engine, id("foe")), false);
});

clause(HOT_PEPPER, "2:ability:spit", "the former host can be picked and restored too", () => {
  const { engine, id } = hotSpit(["mine"]);
  spitDone(engine, id, HOT, [id("mine")]);
  assert.equal(isDepleted(engine, id("mine")), false);
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(HOT_PEPPER, "2:ability:spit", "the restore is real: a restored character can block, an unpicked depleted one cannot", () => {
  const { engine, id } = pepperBoard(HOT, {
    pepper: "play",
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  engine.state.cards[id("mine2")].depleted = true;
  engine.state.cards[id("mine")].depleted = true;
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  spit(engine, id, HOT, [id("mine2")]);
  resolvePendingResponses(engine);
  refused(() => declareBlockers(engine, P1, [id("mine")]), "still depleted");
  declareBlockers(engine, P1, [id("mine2")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("mine2")]);
});

// --- the two peppers together ----------------------------------------------------------

/** One B14nd P3pp3r and one H07 P3pp3r attached to the same character ("mine"). */
function bothPeppers() {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "bland", def: printing(BLAND_PEPPER), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "hot", def: printing(HOT_PEPPER), owner: P1, zone: "play", attachedToKey: "mine" }
    ]
  });
}

clause(BLAND_PEPPER, "1:rule", "alongside an H07 P3pp3r on the same character the bonuses add up: +3 strength and +3 life", () => {
  const { engine, id } = bothPeppers();
  assert.equal(engine.getStat(id("mine"), "strength"), 2 + 1 + 2);
  assert.equal(engine.getStat(id("mine"), "life"), 3 + 1 + 2);
});

clause(HOT_PEPPER, "1:rule", "alongside a B14nd P3pp3r on the same character the bonuses add up: +3 strength and +3 life", () => {
  const { engine, id } = bothPeppers();
  assert.equal(engine.getStat(id("mine"), "strength"), 5);
  assert.equal(engine.getStat(id("mine"), "life"), 6);
  assert.equal(engine.getStat(id("mine"), "speed"), 2);
});

clause(BLAND_PEPPER, "2:ability:spit", "spitting out one of two peppers on a character leaves the other one's bonus in place", () => {
  const { engine, id } = bothPeppers();
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bland"), abilityId: "spit", selected: { c: [id("mine")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("bland")), "discard");
  assert.equal(zoneOf(engine, id("hot")), "play");
  assert.equal(engine.getStat(id("mine"), "strength"), 2 + 2 + 1, "H07's +2 plus the this-turn +1");
});

clause(HOT_PEPPER, "2:ability:spit", "spitting out one of two peppers on a character leaves the other one's bonus in place", () => {
  const { engine, id } = bothPeppers();
  engine.state.cards[id("mine")].depleted = true;
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("hot"), abilityId: "spit", selected: { cs: [id("mine")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("hot")), "discard");
  assert.equal(zoneOf(engine, id("bland")), "play");
  assert.equal(isDepleted(engine, id("mine")), false, "the host was restored");
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "only B14nd's +1 is left");
});

// =================================================================================
// Brilliant Insight
// You may play up to 2 resources.
// Tactic, cost 4, [E][E].
// =================================================================================

const BRILLIANT = "fb828bc8-bc8d-463b-89c4-8d31488a5bbc";

interface BiOpts {
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/** P1's hand: bi, arr (Arrogance), staple (a real Elitism resource card), c1, c2 (characters). */
function biBoard(o: BiOpts = {}) {
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bi", def: printing(BRILLIANT), owner: P1, zone: "hand" },
      { key: "arr", def: printing(ARROGANCE), owner: P1, zone: "hand" },
      { key: "staple", def: resourceCard({ name: "Elitism Staple", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "hand" },
      { key: "c1", def: character({ name: "Card One" }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "Card Two" }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "oppCard", def: character({ name: "Opp Hand Card" }), owner: P2, zone: "hand" },
      ...res(o.icons ?? { elitism: 4 }),
      ...(o.extra ?? [])
    ]
  });
}

const resourcesInPlay = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].play.filter((cardId) => engine.isResource(cardId));

/** Answers "play a resource" offers per `accept` (by offer number) and card prompts with the next card of `queue`. */
function biPolicy(accept: (offerNumber: number) => boolean, queue: CardInstanceId[]) {
  let offers = 0;
  return (pc: PendingChoiceLike): unknown => {
    // each "you may play a resource" offer is an optional pick of a card from hand: pick = accept, no pick = decline
    if (pc.kind === "chooserSelectsTarget") {
      const next = accept(offers++) ? queue.shift() : undefined;
      return { kind: "chooserSelectsTarget", selected: next ? [next] : [] };
    }
    return declineAll(pc);
  };
}

clause(BRILLIANT, "0:rule", "pays exactly 4: refused with 3 resources, refused without two [E] (one [E] among many other resources, or none), accepted with four [E]", () => {
  const exact = biBoard({ icons: { elitism: 4 } });
  const before = ready(exact.engine);
  playRaw(exact.engine, P1, exact.id("bi"));
  assert.equal(before - ready(exact.engine), 4, "the printed cost of 4 is paid");
  const short = biBoard({ icons: { elitism: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("bi")), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("bi")), "hand");
  const oneIcon = biBoard({ icons: { elitism: 1, rage: 5 } });
  refused(() => playRaw(oneIcon.engine, P1, oneIcon.id("bi")), "one [E] is not [E][E]");
  const noIcon = biBoard({ icons: { rage: 6 } });
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("bi")), "no [E]");
  const two = biBoard({ icons: { elitism: 2, rage: 2 } });
  playRaw(two.engine, P1, two.id("bi"));
  assert.ok(two.engine.state.responseWindow, "two [E] among four resources is enough");
});

clause(BRILLIANT, "0:rule", "it is a tactic: it can be played in response on the opponent's turn (and not before any response window opens)", () => {
  const { engine, id } = biBoard({ turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("bi")), "nothing to respond to yet");
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  playRaw(engine, P1, id("bi"));
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the first 'may play a resource' offer (an optional pick from hand) opens");
  assert.equal(pending(engine)?.playerId, P1);
});

clause(BRILLIANT, "0:rule", "'you may': its controller is offered up to two plays, one after the other, each with a decline", () => {
  const { engine, id } = biBoard();
  play(engine, P1, id("bi"));
  const seen: string[] = [];
  drain(engine, (pc) => {
    seen.push(`${pc.playerId}:${pc.kind}`);
    assert.equal((pc as unknown as { declaration?: { optional?: boolean } }).declaration?.optional, true, "every offer can be declined (the pick is optional)");
    return { kind: "chooserSelectsTarget", selected: [] };
  });
  assert.deepEqual(seen, ["p1:chooserSelectsTarget", "p1:chooserSelectsTarget"], "exactly two offers, both to me");
});

clause(BRILLIANT, "0:rule", "declining both offers plays nothing: no card leaves my hand, no resource enters play, and the tactic ends in my discard pile", () => {
  const { engine, id } = biBoard();
  const handBefore = [...handOf(engine, P1)].filter((c) => c !== id("bi"));
  const resourcesBefore = resourcesInPlay(engine, P1).length;
  const influenceBefore = influenceOf(engine, P1);
  play(engine, P1, id("bi"));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("bi")), "discard");
  assert.deepEqual([...handOf(engine, P1)].sort(), handBefore.sort(), "the hand is unchanged");
  assert.equal(resourcesInPlay(engine, P1).length, resourcesBefore, "no resource was played (the cost resources were only attached)");
  assert.equal(influenceOf(engine, P1), influenceBefore, "no Arrogance entered play");
});

clause(BRILLIANT, "0:rule", "using the Develop Rule first does not stop it: the card is still playable afterwards and still offers two plays", () => {
  const { engine, id } = biBoard();
  developResource(engine, P1, id("staple"), false);
  play(engine, P1, id("bi"));
  const seen = drainRecording(engine, () => ({ kind: "chooserSelectsTarget", selected: [] }));
  assert.deepEqual(seen, ["p1:chooserSelectsTarget", "p1:chooserSelectsTarget"]);
  assert.equal(zoneOf(engine, id("bi")), "discard");
});

clause(BRILLIANT, "0:rule", "accepting the first offer plays one resource from my hand: a real resource card enters play face-up and provides its icon", () => {
  const { engine, id } = biBoard();
  play(engine, P1, id("bi"));
  drain(engine, biPolicy((n) => n === 0, [id("staple")]));
  assert.equal(zoneOf(engine, id("staple")), "play", "the resource card was played");
  assert.equal(engine.state.cards[id("staple")].faceDown, false, "a real resource card is played face-up");
  assert.ok(engine.isResource(id("staple")), "engine.isResource(id(\"staple\"))");
  assert.equal(engine.getThresholds(P1).elitism, 5, "its [E] joins the four [E] I paid with");
});

clause(BRILLIANT, "0:rule", "any card can be played as a face-down resource: a character from my hand enters play face-down and provides one Volition", () => {
  const { engine, id } = biBoard();
  const volitionBefore = engine.getThresholds(P1).volition ?? 0;
  play(engine, P1, id("bi"));
  drain(engine, biPolicy((n) => n === 0, [id("c1")]));
  assert.equal(zoneOf(engine, id("c1")), "play", "the character was played as a resource");
  assert.equal(engine.state.cards[id("c1")].faceDown, true, "a non-resource card is played face-down");
  assert.equal(engine.getThresholds(P1).volition, volitionBefore + 1, "it provides one Volition");
});

clause(BRILLIANT, "0:rule", "accepting both offers plays two resources, and the other cards in hand stay in hand ('up to 2', never 3)", () => {
  const { engine, id } = biBoard();
  const resourcesBefore = resourcesInPlay(engine, P1).length;
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("bi"));
  drain(engine, biPolicy(() => true, [id("staple"), id("c1"), id("c2")]));
  assert.equal(resourcesInPlay(engine, P1).length - resourcesBefore, 2, "exactly two resources were played");
  assert.equal(zoneOf(engine, id("staple")), "play");
  assert.equal(zoneOf(engine, id("c1")), "play");
  assert.equal(zoneOf(engine, id("c2")), "hand", "a third card is never played");
  assert.equal(zoneOf(engine, id("arr")), "hand");
  assert.deepEqual(handOf(engine, P2), oppHand, "the opponent's hand is untouched");
  assert.equal(resourcesInPlay(engine, P2).length, 0, "and so are their resources");
});

clause(BRILLIANT, "0:rule", "'up to 2': accepting the first offer and declining the second plays exactly one resource", () => {
  const { engine, id } = biBoard();
  const resourcesBefore = resourcesInPlay(engine, P1).length;
  play(engine, P1, id("bi"));
  drain(engine, biPolicy((n) => n === 0, [id("staple"), id("c1")]));
  assert.equal(resourcesInPlay(engine, P1).length - resourcesBefore, 1);
  assert.equal(zoneOf(engine, id("staple")), "play");
  assert.equal(zoneOf(engine, id("c1")), "hand");
});

clause(BRILLIANT, "0:rule", "'up to 2': declining the first offer and accepting the second plays exactly one resource", () => {
  const { engine, id } = biBoard();
  const resourcesBefore = resourcesInPlay(engine, P1).length;
  play(engine, P1, id("bi"));
  drain(engine, biPolicy((n) => n === 1, [id("staple"), id("c1")]));
  assert.equal(resourcesInPlay(engine, P1).length - resourcesBefore, 1);
  assert.equal(zoneOf(engine, id("staple")), "play");
});

clause(BRILLIANT, "0:rule", "the resources played are new, unspent resources: they raise my ready resource count by the number played", () => {
  const { engine, id } = biBoard({ icons: { elitism: 6 } });
  play(engine, P1, id("bi"));
  const afterCost = ready(engine);
  assert.equal(afterCost, 2, "6 resources minus the 4 paid");
  drain(engine, biPolicy(() => true, [id("staple"), id("c1")]));
  assert.equal(ready(engine), afterCost + 2, "two new resources are available");
});

clause(BRILLIANT, "0:rule", "playing resources with it is not the Develop Rule: the Develop Rule is still available afterwards", () => {
  const { engine, id } = biBoard();
  play(engine, P1, id("bi"));
  drain(engine, biPolicy(() => true, [id("staple"), id("c1")]));
  assert.equal(zoneOf(engine, id("staple")), "play", "(it played a resource)");
  assert.ok(developOffers(engine, P1).length > 0, "my Develop Rule is untouched");
});

clause(BRILLIANT, "0:rule", "a resource it plays 'enters play' like any other: Arrogance played with it costs 1 influence and provides its [E][E]", () => {
  const { engine, id } = biBoard();
  const influenceBefore = influenceOf(engine, P1);
  play(engine, P1, id("bi"));
  drain(engine, biPolicy((n) => n === 0, [id("arr")]));
  assert.equal(zoneOf(engine, id("arr")), "play");
  assert.equal(influenceOf(engine, P1), influenceBefore - 1);
  assert.equal(engine.getThresholds(P1).elitism, 4 + 2, "its [E][E] join the four [E] I paid with");
});

// =================================================================================
// Claywork Compendium
// RESEARCH -- COST: Deplete this card.
//          -- EFFECT: Reduce the next numeric cost you pay this turn by 2.
// FLIP UP: 5 [E][E]
// Item, cost 6, [E][E].
// =================================================================================

const CLAYWORK = "60bc13df-5cc4-49a6-b6a4-8b986c4cbbfc";

interface CcOpts {
  cc?: "play" | "faceDown" | "hand";
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  second?: boolean;
  extra?: CardPlacement[];
}

/** P1: cc (+ cc2), hand: big (item cost 5), small (item cost 2), one (item cost 1), zero (item cost 0). P2: foe, oppBig (item cost 5 in hand). */
function ccBoard(o: CcOpts = {}) {
  const where = o.cc ?? "play";
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cc", def: printing(CLAYWORK), owner: P1, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined },
      ...(o.second ? [{ key: "cc2", def: printing(CLAYWORK), owner: P1, zone: "play" as const }] : []),
      { key: "big", def: item({ name: "Big Five", cost: 5 }), owner: P1, zone: "hand" },
      { key: "big2", def: item({ name: "Big Five Again", cost: 5 }), owner: P1, zone: "hand" },
      { key: "small", def: item({ name: "Small Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "small2", def: item({ name: "Small Two Again", cost: 2 }), owner: P1, zone: "hand" },
      { key: "one", def: item({ name: "Cheap One", cost: 1 }), owner: P1, zone: "hand" },
      { key: "zero", def: item({ name: "Free Zero", cost: 0 }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "oppBig", def: item({ name: "Their Five", cost: 5 }), owner: P2, zone: "hand" },
      ...res(o.icons ?? { elitism: 12 }),
      ...res(o.oppIcons ?? { elitism: 12 }, P2),
      ...(o.extra ?? [])
    ]
  });
}

const research = (engine: SpoilsEngine, id: IdOf, key = "cc") => activate(engine, P1, id(key), "research");

/** Plays `key` and returns how many resources it cost. */
function paid(engine: SpoilsEngine, id: IdOf, key: string): number {
  const before = ready(engine);
  play(engine, P1, id(key));
  assert.equal(zoneOf(engine, id(key)), "play", `${key} was deployed`);
  return before - ready(engine);
}

const flipCc = (engine: SpoilsEngine, id: IdOf, player: PlayerId = P1) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId: id("cc"), selected: {}, variables: {} });

// --- RESEARCH --------------------------------------------------------------------

clause(CLAYWORK, "0:ability:research", "the cost is only 'deplete this card': no resource is spent, the Compendium is depleted and stays in play", () => {
  const { engine, id } = ccBoard();
  const before = ready(engine);
  assert.equal(isDepleted(engine, id("cc")), false);
  research(engine, id);
  assert.equal(isDepleted(engine, id("cc")), true, "depleted by its own cost");
  assert.equal(ready(engine), before, "no resource was paid");
  assert.equal(zoneOf(engine, id("cc")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(CLAYWORK, "0:ability:research", "the next numeric cost I pay is reduced by exactly 2: a cost-5 item costs 3", () => {
  const { engine, id } = ccBoard();
  research(engine, id);
  assert.equal(paid(engine, id, "big"), 3);
});

clause(CLAYWORK, "0:ability:research", "...without research the same item costs its full 5 (control)", () => {
  const { engine, id } = ccBoard();
  assert.equal(paid(engine, id, "big"), 5);
});

clause(CLAYWORK, "0:ability:research", "a numeric cost can never go below 0 (CR 406.6): cost 2 and cost 1 items become free, and a cost-0 item stays free", () => {
  for (const key of ["small", "one", "zero"]) {
    const { engine, id } = ccBoard();
    research(engine, id);
    assert.equal(paid(engine, id, key), 0, `${key} is free`);
  }
});

clause(CLAYWORK, "0:ability:research", "only the NEXT cost is reduced: after the first card the second pays full price", () => {
  const { engine, id } = ccBoard();
  research(engine, id);
  assert.equal(paid(engine, id, "big"), 3, "the first card gets the reduction");
  assert.equal(paid(engine, id, "big2"), 5, "the second does not");
});

clause(CLAYWORK, "0:ability:research", "the reduction is used up by the next cost even when that cost is smaller than the reduction: a cost-1 card absorbs it entirely", () => {
  const { engine, id } = ccBoard();
  research(engine, id);
  assert.equal(paid(engine, id, "one"), 0);
  assert.equal(paid(engine, id, "big"), 5, "nothing is left over for the next card");
});

clause(CLAYWORK, "0:ability:research", "'this turn': an unused reduction is gone when the turn is over", () => {
  const { engine, id } = ccBoard();
  research(engine, id);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("cc")), false, "the Compendium was restored at the start of my turn");
  assert.equal(paid(engine, id, "big"), 5, "the old reduction did not carry over");
});

clause(CLAYWORK, "0:ability:research", "it cannot be used while the Compendium is depleted (the cost cannot be paid); once restored it can be used again", () => {
  const { engine, id } = ccBoard();
  research(engine, id);
  refused(() => activate(engine, P1, id("cc"), "research"), "already depleted");
  assert.equal(paid(engine, id, "big"), 3, "still only one reduction was applied");
  endTurn(engine, P1);
  endTurn(engine, P2);
  research(engine, id);
  assert.equal(paid(engine, id, "big2"), 3, "usable again after being restored");
});

clause(CLAYWORK, "0:ability:research", "'you pay': the opponent's costs are not reduced", () => {
  const { engine, id } = ccBoard();
  research(engine, id);
  assert.equal(engine.getCardPlayability(P2, id("oppBig")).numericCost, 5, "their cost-5 item still costs 5");
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 3, "mine costs 3");
});

clause(CLAYWORK, "0:ability:research", "two Compendiums used together both apply to the one 'next numeric cost': it is reduced by 4 (CR 410.3)", () => {
  const { engine, id } = ccBoard({ second: true });
  research(engine, id, "cc");
  research(engine, id, "cc2");
  assert.equal(paid(engine, id, "big"), 1);
});

clause(CLAYWORK, "0:ability:research", "the reduction is for the numeric cost only: the card's threshold must still be met", () => {
  const { engine, id } = ccBoard({ extra: [{ key: "gated", def: item({ name: "Gated", cost: 2, threshold: "g" }), owner: P1, zone: "hand" }] });
  research(engine, id);
  refused(() => playRaw(engine, P1, id("gated")), "no [G] among the twelve [E]");
  assert.equal(zoneOf(engine, id("gated")), "hand");
});

/** An item whose ability (no 'pay' in its cost, so no numeric cost of its own, CR 406.4) destroys one chosen item in play. */
const shredder = (): CardDefinition =>
  item({
    name: "Shredder",
    cost: 0,
    behavior: {
      abilities: [
        { id: "shred", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

clause(CLAYWORK, "0:ability:research", "it still applies after the Compendium has left play (an ability resolves as written when it was used, CR 502.4)", () => {
  const { engine, id } = ccBoard({ extra: [{ key: "shredder", def: shredder(), owner: P1, zone: "play" }] });
  research(engine, id);
  activate(engine, P1, id("shredder"), "shred", { selected: { t: [id("cc")] } });
  assert.equal(zoneOf(engine, id("cc")), "discard");
  assert.equal(paid(engine, id, "big"), 3, "the reduction is still waiting for my next numeric cost");
});

clause(CLAYWORK, "0:ability:research", "an ability with no 'pay' in its cost has no numeric cost (CR 406.4), so using one does not use the reduction up", () => {
  const { engine, id } = ccBoard({ extra: [{ key: "shredder", def: shredder(), owner: P1, zone: "play" }, { key: "junk", def: item({ name: "Junk" }), owner: P1, zone: "play" }] });
  research(engine, id);
  activate(engine, P1, id("shredder"), "shred", { selected: { t: [id("junk")] } });
  assert.equal(zoneOf(engine, id("junk")), "discard");
  assert.equal(paid(engine, id, "big"), 3, "the reduction is still waiting");
});

clause(CLAYWORK, "0:ability:research", "every card has a numeric cost (CR 406.2: 0 if none is printed), so the next card played absorbs the reduction even when it is free: a later costly card pays full price", () => {
  const { engine, id } = ccBoard({ extra: [{ key: "freeTactic", def: zapChar(1), owner: P1, zone: "hand" }] });
  research(engine, id);
  play(engine, P1, id("freeTactic"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("freeTactic")), "discard");
  assert.equal(paid(engine, id, "big"), 5, "the free tactic was the next numeric cost");
});

clause(CLAYWORK, "0:ability:research", "it can be used in response on the opponent's turn: the reduction then applies to my costs that turn", () => {
  const { engine, id } = ccBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cc"), abilityId: "research", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(isDepleted(engine, id("cc")), true);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 3, "the next cost I pay on their turn is reduced");
});

clause(CLAYWORK, "0:ability:research", "'pay N' is a numeric cost (CR 406.5): the reduction lowers the cost of an ability that says 'pay 3' to 1", () => {
  const gadget = item({
    name: "Pay Three Gadget",
    cost: 0,
    behavior: { abilities: [{ id: "go", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = ccBoard({ extra: [{ key: "gadget", def: gadget, owner: P1, zone: "play" }, ...cards("d", 3, P1, "deck")] });
  research(engine, id);
  const before = ready(engine);
  activate(engine, P1, id("gadget"), "go");
  assert.equal(before - ready(engine), 1, "pay 3 reduced by 2 is pay 1");
});

clause(CLAYWORK, "0:ability:research", "a face-down Compendium is only a resource with no rules text (CR 411.1): RESEARCH cannot be used", () => {
  const { engine, id } = ccBoard({ cc: "faceDown" });
  refused(() => activate(engine, P1, id("cc"), "research"), "face-down");
  assert.equal(paid(engine, id, "big"), 5);
});

clause(CLAYWORK, "0:ability:research", "deploys for exactly its printed cost of 6 and needs [E][E]", () => deployChecks(CLAYWORK, { cost: 6, icon: "elitism", icons: 2, type: "item" }));

// --- FLIP UP: 5 [E][E] ------------------------------------------------------------------

clause(CLAYWORK, "1:flipUp", "face-down in play it is a resource: one Volition, in the resource pool, with no rules text", () => {
  const { engine, id } = ccBoard({ cc: "faceDown", icons: { elitism: 2 } });
  assert.equal(engine.isResource(id("cc")), true);
  assert.equal(ready(engine), 3, "two [E] plus the face-down Compendium");
  assert.equal(engine.getThresholds(P1).volition, 1);
});

clause(CLAYWORK, "1:flipUp", "flipping it up puts the item into play face-up, ready (not depleted), as a real card", () => {
  const { engine, id } = ccBoard({ cc: "faceDown", icons: { elitism: 8 } });
  flipCc(engine, id);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cc")), "play");
  assert.equal(engine.state.cards[id("cc")].faceDown, false);
  assert.equal(engine.isResource(id("cc")), false, "it is an item now, not a resource");
  assert.equal(isDepleted(engine, id("cc")), false, "it enters ready");
  assert.equal(engine.state.cards[id("cc")].controllerId, P1);
});

clause(CLAYWORK, "1:flipUp", "it pays the FLIP UP cost of 5, not the printed cost of 6", () => {
  const { engine, id } = ccBoard({ cc: "faceDown", icons: { elitism: 8 } });
  const before = ready(engine);
  assert.equal(before, 9, "eight [E] plus the face-down Compendium");
  flipCc(engine, id);
  resolvePendingResponses(engine);
  const after = ready(engine);
  // The card stops being a resource (-1) and 5 resources are paid; the paid ones may include the card itself (CR 507.4b), so 3 or 4 remain.
  assert.ok(after === 3 || after === 4, `expected 3 or 4 resources left (5 paid), got ${after}`);
});

clause(CLAYWORK, "1:flipUp", "the cost is exactly 5: four [E] plus the card itself (5 resources) is enough, 3 [E] plus itself (4) is refused", () => {
  const enough = ccBoard({ cc: "faceDown", icons: { elitism: 4 } });
  flipCc(enough.engine, enough.id);
  resolvePendingResponses(enough.engine);
  assert.equal(zoneOf(enough.engine, enough.id("cc")), "play");
  assert.equal(enough.engine.state.cards[enough.id("cc")].faceDown, false, "the card paid for its own FLIP UP (CR 507.4b)");
  const short = ccBoard({ cc: "faceDown", icons: { elitism: 3 } });
  refused(() => flipCc(short.engine, short.id), "four resources for a cost of 5");
  assert.equal(short.engine.state.cards[short.id("cc")].faceDown, true, "still face-down");
  assert.equal(ready(short.engine), 4, "nothing was paid by the refused attempt");
});

clause(CLAYWORK, "1:flipUp", "FLIP UP needs [E][E]: one [E] among many resources is refused, so is none, two are accepted", () => {
  const one = ccBoard({ cc: "faceDown", icons: { elitism: 1, rage: 8 } });
  refused(() => flipCc(one.engine, one.id), "one [E]");
  assert.equal(one.engine.state.cards[one.id("cc")].faceDown, true);
  assert.equal(ready(one.engine), 10, "nothing was paid");
  const none = ccBoard({ cc: "faceDown", icons: { rage: 9 } });
  refused(() => flipCc(none.engine, none.id), "no [E]");
  const two = ccBoard({ cc: "faceDown", icons: { elitism: 2, rage: 6 } });
  flipCc(two.engine, two.id);
  resolvePendingResponses(two.engine);
  assert.equal(two.engine.state.cards[two.id("cc")].faceDown, false);
});

clause(CLAYWORK, "1:flipUp", "the card's own Volition is not [E], and the opponent's [E] do not count", () => {
  const onlyVolition = ccBoard({ cc: "faceDown", icons: { greed: 6 }, oppIcons: { elitism: 8 } });
  refused(() => flipCc(onlyVolition.engine, onlyVolition.id), "no [E] of my own");
  assert.equal(onlyVolition.engine.state.cards[onlyVolition.id("cc")].faceDown, true);
});

clause(CLAYWORK, "1:flipUp", "it is a real item once flipped: RESEARCH works at once", () => {
  const { engine, id } = ccBoard({ cc: "faceDown", icons: { elitism: 9 } });
  flipCc(engine, id);
  resolvePendingResponses(engine);
  research(engine, id);
  assert.equal(isDepleted(engine, id("cc")), true);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 3);
});

clause(CLAYWORK, "1:flipUp", "an item is only deployed on its controller's turn, and FLIP UP does not change that (CR 507.4d): refused on the opponent's turn, even in a response window", () => {
  const { engine, id } = ccBoard({ cc: "faceDown", icons: { elitism: 9 }, turn: 2, active: P2 });
  refused(() => flipCc(engine, id), "no window at all");
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  refused(() => flipCc(engine, id), "an item cannot be played in a response window");
  assert.equal(engine.state.cards[id("cc")].faceDown, true);
  assert.equal(ready(engine), 10, "nothing was paid");
});

clause(CLAYWORK, "1:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const theirs = ccBoard({ cc: "faceDown", icons: { elitism: 9 }, oppIcons: { elitism: 9 } });
  refused(() => flipCc(theirs.engine, theirs.id, P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("cc")].faceDown, true);
  const inHand = ccBoard({ cc: "hand", icons: { elitism: 9 } });
  refused(() => flipCc(inHand.engine, inHand.id), "in my hand it is not a face-down resource");
  const faceUp = ccBoard({ cc: "play", icons: { elitism: 9 } });
  refused(() => flipCc(faceUp.engine, faceUp.id), "already face-up");
});

clause(CLAYWORK, "1:flipUp", "a flipped-up card is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it enters play", () => {
  const { engine, id } = ccBoard({ cc: "faceDown", icons: { elitism: 9 } });
  holdFlipUp(() => flipCc(engine, id));
  assert.ok(engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("cc")), "deploying", "the item is being deployed, it has not entered play yet");
});

// =================================================================================
// Cowering Golem
// While this card is in a battle, it loses 1 strength and 1 life for each member of the opposing party.
// Character (golem), cost 4, [E], 5 strength / 3 speed / 5 life.
// =================================================================================

const COWERING = "89471657-b806-44ed-a481-d0374566828d";

interface CgOpts {
  /** P1 is the active player (golem attacks) unless this says P2. */
  active?: PlayerId;
  foeStrength?: number;
  foeLife?: number;
  foeSpeed?: number;
  extra?: CardPlacement[];
}

/**
 * P1: g (the Cowering Golem), ally (2/3/2). P2: f0..f5 (strength foeStrength, life foeLife, speed foeSpeed; default 0 / 9 / 1) -
 * the blocking party when P1 attacks and the attacking party when P2 attacks.
 */
function cgBoard(o: CgOpts = {}) {
  const active = o.active ?? P1;
  return buildGame({
    turn: 2,
    activePlayerId: active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "g", def: printing(COWERING), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...Array.from({ length: 6 }, (_, i) => ({
        key: `f${i}`,
        def: character({ name: `Foe${i}`, strength: o.foeStrength ?? 0, life: o.foeLife ?? 9, speed: o.foeSpeed ?? 1 }),
        owner: P2,
        zone: "play" as const
      })),
      ...(o.extra ?? [])
    ]
  });
}

const foes = (id: IdOf, n: number): CardInstanceId[] => Array.from({ length: n }, (_, i) => id(`f${i}`));
const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => ({
  strength: engine.getStat(cardId, "strength"),
  life: engine.getStat(cardId, "life"),
  speed: engine.getStat(cardId, "speed")
});

/** P1's golem attacks and the first `n` of P2's characters block it. */
function golemAttackedBy(n: number, o: CgOpts = {}) {
  const game = cgBoard(o);
  declareAttackBy(game.engine, P1, [game.id("g")]);
  if (n > 0) declareBlockers(game.engine, P2, foes(game.id, n));
  return game;
}

clause(COWERING, "0:rule", "deploys for exactly its printed cost of 4 and threshold [E]", () => deployChecks(COWERING, { cost: 4, icon: "elitism", icons: 1, type: "character" }));

clause(COWERING, "0:rule", "outside a battle it has its full printed 5 strength, 5 life and 3 speed", () => {
  const { engine, id } = cgBoard();
  assert.deepEqual(stats(engine, id("g")), { strength: 5, life: 5, speed: 3 });
});

for (const n of [1, 2, 3, 4]) {
  clause(COWERING, "0:rule", `attacking into a blocking party of ${n}, it loses exactly ${n} strength and ${n} life (speed is untouched)`, () => {
    const { engine, id } = golemAttackedBy(n);
    assert.deepEqual(battleOf(engine)?.blockingParty, foes(id, n), "the blocking party formed");
    assert.deepEqual(stats(engine, id("g")), { strength: 5 - n, life: 5 - n, speed: 3 });
  });
}

for (const n of [1, 2, 3, 4]) {
  clause(COWERING, "0:rule", `blocking an attacking party of ${n}, it loses exactly ${n} strength and ${n} life`, () => {
    const { engine, id } = cgBoard({ active: P2 });
    declareAttackBy(engine, P2, foes(id, n));
    declareBlockers(engine, P1, [id("g")]);
    assert.deepEqual(battleOf(engine)?.attackingParty, foes(id, n));
    assert.deepEqual(stats(engine, id("g")), { strength: 5 - n, life: 5 - n, speed: 3 });
  });
}

clause(COWERING, "0:rule", "the opposing party is empty until blockers are declared: right after it attacks it is still at full strength and life", () => {
  const { engine, id } = golemAttackedBy(0);
  assert.ok(battleOf(engine), "a battle is under way");
  assert.deepEqual(stats(engine, id("g")), { strength: 5, life: 5, speed: 3 });
});

clause(COWERING, "0:rule", "unblocked (no blockers declared), it keeps full strength and deals 5 battle damage to the faction", () => {
  const { engine, id } = cgBoard();
  const influence = influenceOf(engine, P2);
  fight(engine, P1, [id("g")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - influenceOf(engine, P2), 5);
  assert.equal(zoneOf(engine, id("g")), "play");
});

clause(COWERING, "0:rule", "the strength loss is real: blocked by two characters it deals only 3 damage (split as the controller assigns)", () => {
  const { engine, id } = cgBoard();
  fight(engine, P1, [id("g")], { type: "faction", playerId: P2 }, [id("f0"), id("f1")]);
  const dealt = engine.state.cards[id("f0")].damage + engine.state.cards[id("f1")].damage;
  assert.equal(dealt, 3, "5 strength minus 2 blockers");
});

clause(COWERING, "0:rule", "the life loss is real: two 2-strength blockers (4 damage) destroy it, though 4 damage would not destroy a 5-life character", () => {
  const { engine, id } = cgBoard({ foeStrength: 2 });
  fight(engine, P1, [id("g")], { type: "faction", playerId: P2 }, [id("f0"), id("f1")]);
  assert.equal(zoneOf(engine, id("g")), "discard", "3 life against 4 damage");
});

clause(COWERING, "0:rule", "control for the life test: a single 4-strength blocker leaves it alive (4 life against 4 damage destroys it, 3 damage does not)", () => {
  const survive = cgBoard({ foeStrength: 3 });
  fight(survive.engine, P1, [survive.id("g")], { type: "faction", playerId: P2 }, [survive.id("f0")]);
  assert.equal(zoneOf(survive.engine, survive.id("g")), "play", "4 life against 3 damage");
  const die = cgBoard({ foeStrength: 4 });
  fight(die.engine, P1, [die.id("g")], { type: "faction", playerId: P2 }, [die.id("f0")]);
  assert.equal(zoneOf(die.engine, die.id("g")), "discard", "4 life against 4 damage");
});

clause(COWERING, "0:rule", "as a blocker the loss is real too: against 3 attackers of 1 strength (3 damage) it is destroyed at 2 life", () => {
  const { engine, id } = cgBoard({ active: P2, foeStrength: 1, foeSpeed: 1 });
  declareAttackBy(engine, P2, foes(id, 3));
  declareBlockers(engine, P1, [id("g")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("g")), "discard", "2 life against 3 damage; with full life 5 it would have survived");
});

clause(COWERING, "0:rule", "when the battle is over it is back to its printed stats", () => {
  const { engine, id } = cgBoard({ foeStrength: 1 });
  fight(engine, P1, [id("g")], { type: "faction", playerId: P2 }, [id("f0"), id("f1")]);
  assert.equal(engine.state.battle, undefined, "the battle is over");
  assert.equal(zoneOf(engine, id("g")), "play");
  assert.deepEqual(stats(engine, id("g")), { strength: 5, life: 5, speed: 3 });
  assert.equal(engine.state.cards[id("g")].damage, 2, "it keeps the damage it took this turn");
});

clause(COWERING, "0:rule", "only this card is affected: an ally attacking in the same party keeps its stats", () => {
  const { engine, id } = cgBoard();
  declareAttackBy(engine, P1, [id("g"), id("ally")]);
  declareBlockers(engine, P2, foes(id, 3));
  assert.deepEqual(stats(engine, id("ally")), { strength: 2, life: 3, speed: 2 }, "the ally is not the Cowering Golem");
  assert.deepEqual(stats(engine, id("g")), { strength: 2, life: 2, speed: 3 });
  for (const key of ["f0", "f1", "f2"]) assert.deepEqual(stats(engine, id(key)), { strength: 0, life: 9, speed: 1 }, `${key} is unaffected`);
});

clause(COWERING, "0:rule", "the opposing party's members are counted, not my own: a party of golem + ally attacking into 1 blocker loses only 1", () => {
  const { engine, id } = cgBoard();
  declareAttackBy(engine, P1, [id("g"), id("ally")]);
  declareBlockers(engine, P2, [id("f0")]);
  assert.deepEqual(stats(engine, id("g")), { strength: 4, life: 4, speed: 3 });
});

clause(COWERING, "0:rule", "the count follows the opposing party as it changes: destroying one of three blockers during the battle gives back 1 strength and 1 life", () => {
  const { engine, id } = cgBoard({ extra: [{ key: "kill", def: killAny("character"), owner: P1, zone: "hand" }] });
  declareAttackBy(engine, P1, [id("g")]);
  declareBlockers(engine, P2, foes(id, 3));
  assert.deepEqual(stats(engine, id("g")), { strength: 2, life: 2, speed: 3 });
  playRaw(engine, P1, id("kill"), { selected: { t: [id("f2")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("f2")), "discard");
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("f0"), id("f1")], "the destroyed blocker left the party (CR 302.15)");
  assert.deepEqual(stats(engine, id("g")), { strength: 3, life: 3, speed: 3 }, "two members remain");
});

clause(COWERING, "0:rule", "two Cowering Golems in one party each lose 1 per opposing member", () => {
  const { engine, id } = cgBoard({ extra: [{ key: "g2", def: printing(COWERING), owner: P1, zone: "play" }] });
  declareAttackBy(engine, P1, [id("g"), id("g2")]);
  declareBlockers(engine, P2, foes(id, 2));
  assert.deepEqual(stats(engine, id("g")), { strength: 3, life: 3, speed: 3 });
  assert.deepEqual(stats(engine, id("g2")), { strength: 3, life: 3, speed: 3 });
});

clause(COWERING, "0:rule", "its strength cannot be pushed below 0 (CR 410.4): at 2 strength after another effect, 3 opposing members leave it at 0, not -1", () => {
  const shrink = tactic({
    name: "Shrink 3",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sh",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: -3, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const { engine, id } = cgBoard({ extra: [{ key: "shrink", def: shrink, owner: P1, zone: "hand" }] });
  play(engine, P1, id("shrink"), { selected: { t: [id("g")] } });
  assert.equal(engine.getStat(id("g"), "strength"), 2);
  declareAttackBy(engine, P1, [id("g")]);
  declareBlockers(engine, P2, foes(id, 3));
  assert.equal(engine.getStat(id("g"), "strength"), 0, "2 - 3 stays at 0");
});

clause(COWERING, "0:rule", "an opposing party of 5 takes all 5 life: with 0 life against 0 damage it is destroyed (FAQ: a character with 0 life is destroyed)", () => {
  const { engine, id } = golemAttackedBy(5);
  assert.equal(zoneOf(engine, id("g")), "discard", "0 damage is equal to 0 life");
});

clause(COWERING, "0:rule", "an opposing party of 6 takes more life than it has: it is destroyed too (a value cannot go below 0, so 0 life, CR 410.4 + FAQ)", () => {
  const { engine, id } = golemAttackedBy(6);
  assert.equal(zoneOf(engine, id("g")), "discard");
});

// =================================================================================
// Drivey Car
// If this card leaves play, put X Micromajig tokens into play, where X is the number of characters
// your opponent controls minus the number of characters you control.
// Character (vehicle), cost 1, [E][E], 1 strength / 3 speed / 1 life.
// =================================================================================

const DRIVEY = "16a1de58-a23b-49c4-a3da-c696b92a74c6";

interface DcOpts {
  /** Other characters P1 controls besides the Car. */
  mine?: number;
  /** Characters P2 controls. */
  foes?: number;
  active?: PlayerId;
  car?: "play" | "hand" | "deck";
  carFaceDown?: boolean;
  carController?: PlayerId;
  extra?: CardPlacement[];
}

/** P1: car + `mine` characters m0.. ; P2: `foes` characters f0.. . Tactics in P1's hand: kill, bounce, exile, flip. */
function dcBoard(o: DcOpts = {}) {
  return buildGame({
    turn: 2,
    activePlayerId: o.active ?? P1,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "car", def: printing(DRIVEY), owner: P1, zone: o.car ?? "play", faceDown: o.carFaceDown, controller: o.carController },
      ...Array.from({ length: o.mine ?? 0 }, (_, i) => ({ key: `m${i}`, def: character({ name: `Mine${i}` }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: o.foes ?? 0 }, (_, i) => ({ key: `f${i}`, def: character({ name: `Foe${i}` }), owner: P2, zone: "play" as const })),
      { key: "kill", def: killAny("character"), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceChar(), owner: P1, zone: "hand" },
      { key: "exile", def: exileChar(), owner: P1, zone: "hand" },
      { key: "flip", def: flipDownChar(), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ]
  });
}

const killCar = (engine: SpoilsEngine, id: IdOf) => {
  play(engine, P1, id("kill"), { selected: { t: [id("car")] } });
  drain(engine, declineAll);
};

clause(DRIVEY, "0:rule", "deploys for exactly its printed cost of 1 and threshold [E][E]", () => deployChecks(DRIVEY, { cost: 1, icon: "elitism", icons: 2, type: "character" }));

clause(DRIVEY, "0:rule", "has its printed stats: 1 strength, 1 life, 3 speed; it is a vehicle", () => {
  statsAre(DRIVEY, 1, 1, 3);
  const { engine, id } = dcBoard();
  assert.ok(engine.getDefinition(id("car")).subtype.includes("vehicle"), "engine.getDefinition(id(\"car\")).subtype.includes(\"vehicle\")");
});

for (const [foes, mine, x] of [
  [3, 1, 2],
  [2, 0, 2],
  [4, 0, 4],
  [6, 1, 5],
  [1, 0, 1]
] as const) {
  clause(DRIVEY, "0:rule", `destroyed with ${foes} opposing characters and ${mine} other characters of mine: X = ${x}, so ${x} Micromajig token${x === 1 ? "" : "s"} enter play under my control`, () => {
    const { engine, id } = dcBoard({ foes, mine });
    killCar(engine, id);
    assert.equal(zoneOf(engine, id("car")), "discard", "the Car left play");
    const tokens = micromajigs(engine, P1);
    assert.equal(tokens.length, x, `X = ${foes} - ${mine} = ${x}`);
    assert.equal(micromajigs(engine, P2).length, 0, "none for the opponent");
    assert.equal(engine.state.pendingChoice, undefined);
  });
}

clause(DRIVEY, "0:rule", "the Car itself is not counted among 'the characters you control': it has already left play (alone against 2 opposing characters, X = 2, not 1)", () => {
  const { engine, id } = dcBoard({ foes: 2, mine: 0 });
  killCar(engine, id);
  assert.equal(micromajigs(engine, P1).length, 2);
});

for (const [foes, mine] of [
  [2, 2],
  [0, 0],
  [3, 3]
] as const) {
  clause(DRIVEY, "0:rule", `with ${foes} opposing characters and ${mine} others of mine X = 0: no token enters play`, () => {
    const { engine, id } = dcBoard({ foes, mine });
    killCar(engine, id);
    assert.equal(zoneOf(engine, id("car")), "discard");
    assert.equal(micromajigs(engine, P1).length, 0);
    assert.equal(micromajigs(engine, P2).length, 0);
    assert.equal(engine.state.pendingChoice, undefined);
  });
}

for (const [foes, mine] of [
  [1, 3],
  [0, 1],
  [2, 5]
] as const) {
  clause(DRIVEY, "0:rule", `with ${foes} opposing characters and ${mine} others of mine X is negative (${foes - mine}): no token enters play, and the game goes on`, () => {
    const { engine, id } = dcBoard({ foes, mine });
    killCar(engine, id);
    assert.equal(zoneOf(engine, id("car")), "discard");
    assert.equal(micromajigs(engine, P1).length, 0, "a negative X puts no tokens into play");
    assert.equal(micromajigs(engine, P2).length, 0, "and none for the opponent either");
    assert.equal(charactersOf(engine, P1).length, mine, "my characters are untouched");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.winner, undefined);
  });
}

clause(DRIVEY, "0:rule", "a token it creates is a proper Micromajig: a 1/1/3 character with the majig subtype (CR 409.3c), under my control", () => {
  const { engine, id } = dcBoard({ foes: 3, mine: 1 });
  killCar(engine, id);
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 2);
  for (const token of tokens) {
    const def = engine.getDefinition(token);
    assert.equal(def.type, "character");
    assert.ok(def.subtype.includes("majig"), "majig subtype");
    assert.equal(engine.getStat(token, "strength"), 1);
    assert.equal(engine.getStat(token, "life"), 1);
    assert.equal(engine.getStat(token, "speed"), 3);
    assert.equal(engine.state.cards[token].controllerId, P1);
    assert.equal(engine.state.cards[token].zone, "play");
  }
});

clause(DRIVEY, "0:rule", "a token it creates is a Gearsmith card (CR 409.3c: a Micromajig is a Gearsmith character)", () => {
  const { engine, id } = dcBoard({ foes: 2, mine: 0 });
  killCar(engine, id);
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 2);
  for (const token of tokens) assertMicromajig(engine, token, P1);
});

clause(DRIVEY, "0:rule", "only characters are counted: the opponent's items and locations do not raise X", () => {
  const { engine, id } = dcBoard({
    foes: 1,
    mine: 0,
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" }
    ]
  });
  killCar(engine, id);
  assert.equal(micromajigs(engine, P1).length, 1, "X = 1 character, not 3 permanents");
});

clause(DRIVEY, "0:rule", "my own items and locations do not lower X", () => {
  const { engine, id } = dcBoard({
    foes: 2,
    mine: 0,
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" }
    ]
  });
  killCar(engine, id);
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(DRIVEY, "0:rule", "a face-down card is a resource, not a character (CR 411.1): the opponent's face-down cards do not count, nor do mine", () => {
  const { engine, id } = dcBoard({
    foes: 1,
    mine: 0,
    extra: [
      { key: "fdFoe", def: character({ name: "FaceDownFoe" }), owner: P2, zone: "play", faceDown: true },
      { key: "fdMine", def: character({ name: "FaceDownMine" }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  killCar(engine, id);
  assert.equal(micromajigs(engine, P1).length, 1, "X = 1 - 0");
});

clause(DRIVEY, "0:rule", "control, not ownership, decides: a character I control but the opponent owns lowers X, one I own but they control raises it", () => {
  const { engine, id } = dcBoard({
    foes: 2,
    mine: 0,
    extra: [
      { key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  killCar(engine, id);
  // opponent controls f0, f1 and "lent" = 3; I control "borrowed" = 1 (the Car has left play)
  assert.equal(micromajigs(engine, P1).length, 2, "3 - 1");
});

clause(DRIVEY, "0:rule", "my tokens already in play count as characters I control: they lower X", () => {
  const micro = { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } as const;
  const makeTokens = item({
    name: "Token Maker",
    cost: 0,
    behavior: { abilities: [{ id: "mk", type: "activated", effects: [{ type: "createTokens", controller: "controller", count: 2, token: { ...micro, subtype: [...micro.subtype] } }] }] }
  });
  const { engine, id } = dcBoard({ foes: 3, mine: 0, extra: [{ key: "maker", def: makeTokens, owner: P1, zone: "play" }] });
  activate(engine, P1, id("maker"), "mk");
  assert.equal(micromajigs(engine, P1).length, 2, "two tokens first");
  killCar(engine, id);
  assert.equal(micromajigs(engine, P1).length, 2 + 1, "X = 3 - 2 = 1 more");
});

clause(DRIVEY, "0:rule", "'leaves play' is any way: put into its owner's hand", () => {
  const { engine, id } = dcBoard({ foes: 3, mine: 0 });
  play(engine, P1, id("bounce"), { selected: { t: [id("car")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("car")), "hand");
  assert.equal(micromajigs(engine, P1).length, 3);
});

clause(DRIVEY, "0:rule", "'leaves play' is any way: removed from the game", () => {
  const { engine, id } = dcBoard({ foes: 2, mine: 0 });
  play(engine, P1, id("exile"), { selected: { t: [id("car")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("car")), "removed");
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(DRIVEY, "0:rule", "'leaves play' is any way: turned face-down into a resource (CR 411.4: it left play as a face-up card)", () => {
  const { engine, id } = dcBoard({ foes: 2, mine: 0 });
  play(engine, P1, id("flip"), { selected: { t: [id("car")] } });
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("car")].faceDown, true);
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(DRIVEY, "0:rule", "'leaves play' includes dying in a battle", () => {
  const { engine, id } = dcBoard({
    active: P2,
    foes: 2,
    mine: 0,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("car")]);
  autoResolveBattle(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("car")), "discard", "1 life against 3 damage");
  assert.equal(micromajigs(engine, P1).length, 3, "X = 3 opposing characters - 0");
});

clause(DRIVEY, "0:rule", "it triggers on the opponent's turn too: destroyed by their tactic, the tokens are still mine", () => {
  const { engine, id } = dcBoard({ active: P2, foes: 2, mine: 0, extra: [{ key: "theirKill", def: killAny("character"), owner: P2, zone: "hand" }] });
  play(engine, P2, id("theirKill"), { selected: { t: [id("car")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("car")), "discard");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(micromajigs(engine, P2).length, 0);
});

clause(DRIVEY, "0:rule", "'your' is the controller's: a Car I own but the opponent controls makes THEM the one who gets tokens, counted from their side", () => {
  const { engine, id } = dcBoard({ foes: 0, mine: 3, carController: P2, extra: [{ key: "theirKill", def: killAny("character"), owner: P1, zone: "hand" }] });
  // P2 controls only the Car; P1 controls three characters. When the Car leaves, X for its controller P2 = 3 - 0.
  play(engine, P1, id("theirKill"), { selected: { t: [id("car")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("car")), "discard");
  assert.equal(micromajigs(engine, P2).length, 3, "tokens go to the Car's controller");
  assert.equal(micromajigs(engine, P1).length, 0);
});

clause(DRIVEY, "0:rule", "the tokens are 'put into play', not played: they did not start the turn, so they cannot attack this turn", () => {
  const { engine, id } = dcBoard({ foes: 3, mine: 1 });
  killCar(engine, id);
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 2);
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [tokens[0]], target: { type: "faction", playerId: P2 } }), "a token that just entered play", /did not start the turn in play/);
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("m0")], target: { type: "faction", playerId: P2 } });
  assert.ok(battleOf(engine), "control: a character that started the turn in play can attack");
});

clause(DRIVEY, "0:rule", "a face-down Car is only a resource with no rules text (CR 411.1): when it leaves play nothing happens", () => {
  const { engine, id } = dcBoard({ foes: 3, mine: 0, carFaceDown: true, extra: [{ key: "killRes", def: killAny("resource"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("killRes"), { selected: { t: [id("car")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("car")), "discard");
  assert.equal(micromajigs(engine, P1).length, 0);
});

clause(DRIVEY, "0:rule", "'this card': another Car leaving play does not trigger mine", () => {
  const { engine, id } = dcBoard({ foes: 4, mine: 0, extra: [{ key: "car2", def: printing(DRIVEY), owner: P1, zone: "play" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("car2")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("car2")), "discard");
  assert.equal(zoneOf(engine, id("car")), "play");
  assert.equal(micromajigs(engine, P1).length, 4 - 1, "only the dead Car's trigger: X = 4 - 1 (the other Car is still mine)");
});

clause(DRIVEY, "0:rule", "it only matters in play: discarding a Car from my hand, or milling one, makes no tokens", () => {
  const discardFromHand = tactic({
    name: "Discard Car",
    cost: 0,
    behavior: {
      abilities: [
        { id: "dc", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }
      ]
    }
  });
  const { engine, id } = dcBoard({ foes: 3, mine: 0, car: "hand", extra: [{ key: "dis", def: discardFromHand, owner: P1, zone: "hand" }] });
  play(engine, P1, id("dis"), { selected: { t: [id("car")] } });
  assert.equal(zoneOf(engine, id("car")), "discard");
  assert.equal(micromajigs(engine, P1).length, 0);
});

// =================================================================================
// Essence of Elitism
// Choose one of the following as this card's rules text:
// OPTION 1 -- Put a Micromajig token into play.
// OPTION 2 -- COST: Pick a character with COVERT. -- EFFECT: This turn, the character loses COVERT.
// OPTION 3 -- COST: Pick an item in your discard pile. -- EFFECT: Put the item into your hand.
// Tactic, cost 1, [E][E].
// =================================================================================

const ESSENCE = "f58c2e29-ba33-4864-a6f9-87dd8e63a9d9";

interface EeOpts {
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * P1: mine (plain), mineCovert (COVERT + AGGRO); P2: foe (plain), foeCovert (COVERT), foeThing (item), foePlace (location), fd (face-down).
 * P1's discard pile: itemA, itemB (items), charD (character), tacD (tactic), placeD (location). P2's discard pile: oppItem.
 * P1's hand: mhItem (item). P1's play: playItem (item). P1 and P2 each have two cards in hand.
 */
function eeBoard(o: EeOpts = {}) {
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ee", def: printing(ESSENCE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mineCovert", def: character({ name: "MineCovert", strength: 2, life: 3, speed: 2, behavior: { keywords: ["covert", "aggro"] } }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeCovert", def: character({ name: "FoeCovert", strength: 2, life: 3, speed: 2, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "foeThing", def: item({ name: "FoeThing" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play", faceDown: true },
      { key: "itemA", def: item({ name: "Item A" }), owner: P1, zone: "discard" },
      { key: "itemB", def: item({ name: "Item B", subtype: ["gear"] }), owner: P1, zone: "discard" },
      { key: "charD", def: character({ name: "Char D" }), owner: P1, zone: "discard" },
      { key: "tacD", def: tactic({ name: "Tactic D" }), owner: P1, zone: "discard" },
      { key: "placeD", def: location({ name: "Place D" }), owner: P1, zone: "discard" },
      { key: "oppItem", def: item({ name: "Opp Item" }), owner: P2, zone: "discard" },
      { key: "mhItem", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
      { key: "playItem", def: item({ name: "Play Item" }), owner: P1, zone: "play" },
      { key: "oh0", def: character({ name: "Opp Hand 0" }), owner: P2, zone: "hand" },
      { key: "oh1", def: character({ name: "Opp Hand 1" }), owner: P2, zone: "hand" },
      ...res(o.icons ?? { elitism: 4 }),
      ...(o.extra ?? [])
    ]
  });
}

const essenceRaw = (engine: SpoilsEngine, id: IdOf, mode: number | undefined, selected: Record<string, CardInstanceId[]> = {}) =>
  engine.perform({ type: "playCard", playerId: P1, cardId: id("ee"), selected, variables: {}, ...(mode !== undefined ? { mode } : {}) } as never);

/** Plays Essence of Elitism choosing `mode` (0, 1, 2) with `selected`, resolving responses. */
const essence = (engine: SpoilsEngine, id: IdOf, mode: number, selected: Record<string, CardInstanceId[]> = {}) => {
  essenceRaw(engine, id, mode, selected);
  resolvePendingResponses(engine);
};

const covert = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getKeywords(cardId).includes("covert");

clause(ESSENCE, "0:rule", "exactly one option is the card's rules text: OPTION 1 puts a token into play and does nothing of options 2 and 3", () => {
  const { engine, id } = eeBoard();
  const handBefore = handOf(engine, P1).length;
  essence(engine, id, 0);
  assert.equal(micromajigs(engine, P1).length, 1, "option 1 happened");
  assert.equal(covert(engine, id("foeCovert")), true, "no COVERT was stripped (option 2)");
  assert.equal(covert(engine, id("mineCovert")), true);
  assert.equal(zoneOf(engine, id("itemA")), "discard", "no item was recovered (option 3)");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "my hand only lost the tactic");
});

clause(ESSENCE, "0:rule", "choosing OPTION 2 does not also put a token into play or recover an item", () => {
  const { engine, id } = eeBoard();
  essence(engine, id, 1, { c: [id("foeCovert")] });
  assert.equal(covert(engine, id("foeCovert")), false, "option 2 happened");
  assert.equal(micromajigs(engine, P1).length, 0, "no token (option 1)");
  assert.equal(zoneOf(engine, id("itemA")), "discard", "no item recovered (option 3)");
});

clause(ESSENCE, "0:rule", "choosing OPTION 3 does not also put a token into play or strip COVERT", () => {
  const { engine, id } = eeBoard();
  essence(engine, id, 2, { it: [id("itemA")] });
  assert.equal(zoneOf(engine, id("itemA")), "hand", "option 3 happened");
  assert.equal(micromajigs(engine, P1).length, 0, "no token (option 1)");
  assert.equal(covert(engine, id("foeCovert")), true, "no COVERT stripped (option 2)");
  assert.equal(covert(engine, id("mineCovert")), true);
});

clause(ESSENCE, "0:rule", "an option must be chosen: a mode outside 0-2 is refused and nothing is paid", () => {
  const { engine, id } = eeBoard();
  refused(() => essenceRaw(engine, id, 3), "mode 3 does not exist");
  refused(() => essenceRaw(engine, id, -1), "mode -1 does not exist");
  assert.equal(zoneOf(engine, id("ee")), "hand");
  assert.equal(ready(engine), 4, "nothing was paid");
  essenceRaw(engine, id, 0);
  assert.ok(engine.state.responseWindow, "control: a real option is accepted");
});

clause(ESSENCE, "0:rule", "playing without choosing an option is refused ('choose one of the following'): the engine silently plays one of them", () => {
  const { engine, id } = eeBoard();
  refused(() => essenceRaw(engine, id, undefined), "no option chosen");
  assert.equal(zoneOf(engine, id("ee")), "hand");
  assert.equal(ready(engine), 4);
});

clause(ESSENCE, "0:rule", "pays exactly 1 whichever option is chosen, and ends in its owner's discard pile", () => {
  for (const [mode, selected] of [
    [0, {}],
    [1, { c: ["foeCovert"] }],
    [2, { it: ["itemA"] }]
  ] as const) {
    const { engine, id } = eeBoard();
    const before = ready(engine);
    essence(engine, id, mode, Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, v.map((key) => id(key))])));
    assert.equal(before - ready(engine), 1, `option ${mode + 1} pays the printed cost of 1`);
    assert.equal(zoneOf(engine, id("ee")), "discard", `option ${mode + 1}`);
  }
});

clause(ESSENCE, "0:rule", "is refused with no resources at all, whichever option is chosen", () => {
  for (const [mode, selected] of [
    [0, {}],
    [1, { c: ["foeCovert"] }],
    [2, { it: ["itemA"] }]
  ] as const) {
    const { engine, id } = eeBoard({ icons: {} });
    refused(() => essenceRaw(engine, id, mode, Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, v.map((key) => id(key))]))), `option ${mode + 1}`);
    assert.equal(zoneOf(engine, id("ee")), "hand");
  }
});

clause(ESSENCE, "0:rule", "needs [E][E] whichever option is chosen: one [E] among many other resources is refused, two are accepted", () => {
  for (const [mode, selected] of [
    [0, {}],
    [1, { c: ["foeCovert"] }],
    [2, { it: ["itemA"] }]
  ] as const) {
    const pick = (id: IdOf) => Object.fromEntries(Object.entries(selected).map(([k, v]) => [k, v.map((key) => id(key))]));
    const one = eeBoard({ icons: { elitism: 1, rage: 5 } });
    refused(() => essenceRaw(one.engine, one.id, mode, pick(one.id)), `one [E], option ${mode + 1}`);
    const noneE = eeBoard({ icons: { rage: 6 } });
    refused(() => essenceRaw(noneE.engine, noneE.id, mode, pick(noneE.id)), `no [E], option ${mode + 1}`);
    const two = eeBoard({ icons: { elitism: 2, rage: 1 } });
    essenceRaw(two.engine, two.id, mode, pick(two.id));
    assert.ok(two.engine.state.responseWindow, `two [E], option ${mode + 1}: accepted`);
  }
});

clause(ESSENCE, "0:rule", "it is a tactic: it can be played in response on the opponent's turn with any option, and not outside a response window", () => {
  const { engine, id } = eeBoard({ turn: 2, active: P2 });
  refused(() => essenceRaw(engine, id, 1, { c: [id("foeCovert")] }), "no window yet");
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  essenceRaw(engine, id, 1, { c: [id("foeCovert")] });
  resolvePendingResponses(engine);
  assert.equal(covert(engine, id("foeCovert")), false, "played in response during their attack");
  assert.equal(zoneOf(engine, id("ee")), "discard");
});

// --- OPTION 1: a Micromajig token ----------------------------------------------------

clause(ESSENCE, "1:option:OPTION 1", "exactly one Micromajig token enters play under my control, and none for the opponent", () => {
  const { engine, id } = eeBoard();
  const before = charactersOf(engine, P1).length;
  essence(engine, id, 0);
  assert.equal(micromajigs(engine, P1).length, 1);
  assert.equal(micromajigs(engine, P2).length, 0);
  assert.equal(charactersOf(engine, P1).length, before + 1);
  assert.equal(engine.state.pendingChoice, undefined, "it asks for nothing");
});

clause(ESSENCE, "1:option:OPTION 1", "the token is a Micromajig: a 1/1/3 character with the majig subtype, in play", () => {
  const { engine, id } = eeBoard();
  essence(engine, id, 0);
  const [token] = micromajigs(engine, P1);
  assert.ok(token, "token");
  const def = engine.getDefinition(token);
  assert.equal(def.type, "character");
  assert.ok(def.subtype.includes("majig"), "def.subtype.includes(\"majig\")");
  assert.equal(engine.getStat(token, "strength"), 1);
  assert.equal(engine.getStat(token, "life"), 1);
  assert.equal(engine.getStat(token, "speed"), 3);
  assert.equal(engine.state.cards[token].controllerId, P1);
});

clause(ESSENCE, "1:option:OPTION 1", "the token is a Gearsmith card (CR 409.3c: a Micromajig is a Gearsmith character)", () => {
  const { engine, id } = eeBoard();
  essence(engine, id, 0);
  const [token] = micromajigs(engine, P1);
  assert.ok(token, "token");
  assertMicromajig(engine, token, P1);
});

clause(ESSENCE, "1:option:OPTION 1", "it needs no pick: it plays with no characters in play at all", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ee", def: printing(ESSENCE), owner: P1, zone: "hand" }, ...res({ elitism: 2 })]
  });
  essence(engine, id, 0);
  assert.equal(micromajigs(engine, P1).length, 1);
  assert.equal(zoneOf(engine, id("ee")), "discard");
});

clause(ESSENCE, "1:option:OPTION 1", "the token was put into play, not deployed: it did not start the turn, so it cannot attack this turn", () => {
  const { engine, id } = eeBoard({ turn: 2 });
  essence(engine, id, 0);
  const [token] = micromajigs(engine, P1);
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [token], target: { type: "faction", playerId: P2 } }), "a token that just entered play", /did not start the turn in play/);
});

clause(ESSENCE, "1:option:OPTION 1", "played twice (two copies) it makes two tokens", () => {
  const { engine, id } = eeBoard({ extra: [{ key: "ee2", def: printing(ESSENCE), owner: P1, zone: "hand" }] });
  essence(engine, id, 0);
  play(engine, P1, id("ee2"), { mode: 0 });
  assert.equal(micromajigs(engine, P1).length, 2);
});

// --- OPTION 2: strip COVERT ------------------------------------------------------------

clause(ESSENCE, "2:option:OPTION 2", "the picked opposing character with COVERT loses COVERT this turn; no other character does", () => {
  const { engine, id } = eeBoard();
  assert.equal(covert(engine, id("foeCovert")), true, "precondition");
  essence(engine, id, 1, { c: [id("foeCovert")] });
  assert.equal(covert(engine, id("foeCovert")), false);
  assert.equal(covert(engine, id("mineCovert")), true, "my covert character keeps it");
  assert.equal(covert(engine, id("foe")), false);
  assert.equal(covert(engine, id("mine")), false);
});

clause(ESSENCE, "2:option:OPTION 2", "I can pick my own character with COVERT", () => {
  const { engine, id } = eeBoard();
  essence(engine, id, 1, { c: [id("mineCovert")] });
  assert.equal(covert(engine, id("mineCovert")), false);
  assert.equal(covert(engine, id("foeCovert")), true, "theirs keeps it");
});

clause(ESSENCE, "2:option:OPTION 2", "only COVERT is lost: the picked character keeps its other keyword (AGGRO) and its stats", () => {
  const { engine, id } = eeBoard();
  essence(engine, id, 1, { c: [id("mineCovert")] });
  assert.ok(engine.getKeywords(id("mineCovert")).includes("aggro"), "still has AGGRO");
  assert.equal(engine.getStat(id("mineCovert"), "strength"), 2);
  assert.equal(engine.getStat(id("mineCovert"), "life"), 3);
  assert.equal(zoneOf(engine, id("mineCovert")), "play");
});

clause(ESSENCE, "2:option:OPTION 2", "the character picked must HAVE COVERT: a character without it is refused (and the refusal costs nothing)", () => {
  const { engine, id } = eeBoard();
  refused(() => essenceRaw(engine, id, 1, { c: [id("foe")] }), "an opposing character without COVERT");
  refused(() => essenceRaw(engine, id, 1, { c: [id("mine")] }), "my own character without COVERT");
  assert.equal(zoneOf(engine, id("ee")), "hand");
  assert.equal(ready(engine), 4, "nothing was paid");
  essenceRaw(engine, id, 1, { c: [id("foeCovert")] });
  assert.ok(engine.state.responseWindow, "control: a character with COVERT is accepted");
});

clause(ESSENCE, "2:option:OPTION 2", "COVERT granted by another effect counts as having COVERT", () => {
  const { engine, id } = eeBoard({ extra: [{ key: "grant", def: grantCovert(), owner: P1, zone: "hand" }] });
  refused(() => essenceRaw(engine, id, 1, { c: [id("mine")] }), "before the grant: no COVERT");
  play(engine, P1, id("grant"), { selected: { t: [id("mine")] } });
  assert.equal(covert(engine, id("mine")), true);
  essence(engine, id, 1, { c: [id("mine")] });
  assert.equal(covert(engine, id("mine")), false, "the granted COVERT is lost too");
});

clause(ESSENCE, "2:option:OPTION 2", "the pick is a cost and is required: none or two picks are refused", () => {
  const { engine, id } = eeBoard();
  refused(() => essenceRaw(engine, id, 1, {}), "no pick");
  refused(() => essenceRaw(engine, id, 1, { c: [] }), "an empty pick");
  refused(() => essenceRaw(engine, id, 1, { c: [id("foeCovert"), id("mineCovert")] }), "two picks");
  assert.equal(zoneOf(engine, id("ee")), "hand");
  assert.equal(ready(engine), 4);
  assert.equal(covert(engine, id("foeCovert")), true);
  assert.equal(covert(engine, id("mineCovert")), true);
});

clause(ESSENCE, "2:option:OPTION 2", "only a character in play can be picked: an item, a location, a faction, a face-down card and cards outside play are refused", () => {
  const { engine, id } = eeBoard();
  for (const [what, target] of [
    ["an item", id("foeThing")],
    ["a location", id("foePlace")],
    ["their faction", factionOf(engine, P2)],
    ["my faction", factionOf(engine, P1)],
    ["a face-down card (its COVERT is not rules text while face-down)", id("fd")],
    ["a character in a discard pile", id("charD")],
    ["a character in a hand", id("oh0")]
  ] as const) {
    refused(() => essenceRaw(engine, id, 1, { c: [target] }), what);
  }
  assert.equal(zoneOf(engine, id("ee")), "hand");
  essenceRaw(engine, id, 1, { c: [id("foeCovert")] });
  assert.ok(engine.state.responseWindow, "control: a character in play with COVERT is accepted");
});

clause(ESSENCE, "2:option:OPTION 2", "with no character with COVERT in play, option 2 cannot be played (while option 1 still can)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ee", def: printing(ESSENCE), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      ...res({ elitism: 2 })
    ]
  });
  refused(() => essenceRaw(engine, id, 1, { c: [id("plain")] }), "nothing to pick");
  essenceRaw(engine, id, 0);
  assert.ok(engine.state.responseWindow, "option 1 is still playable");
});

clause(ESSENCE, "2:option:OPTION 2", "the loss is real for an attacker: a plain character can block the formerly covert attacker", () => {
  const { engine, id } = eeBoard({ turn: 2 });
  essence(engine, id, 1, { c: [id("mineCovert")] });
  declareAttackBy(engine, P1, [id("mineCovert")]);
  declareBlockers(engine, P2, [id("foe")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe")], "a non-covert character may block a party that is no longer covert");
});

clause(ESSENCE, "2:option:OPTION 2", "control for the above: without the option, a plain character cannot block the covert attacker", () => {
  const { engine, id } = eeBoard({ turn: 2 });
  declareAttackBy(engine, P1, [id("mineCovert")]);
  refused(() => declareBlockers(engine, P2, [id("foe")]), "a non-covert blocker against a covert party");
  declareBlockers(engine, P2, [id("foeCovert")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foeCovert")]);
});

clause(ESSENCE, "2:option:OPTION 2", "the loss is real for a blocker: a formerly covert character may now block a plain attacker", () => {
  const { engine, id } = eeBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  essenceRaw(engine, id, 1, { c: [id("mineCovert")] });
  resolvePendingResponses(engine);
  assert.equal(covert(engine, id("mineCovert")), false);
  declareBlockers(engine, P1, [id("mineCovert")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("mineCovert")], "it is not covert any more, so it may block a plain party");
});

clause(ESSENCE, "2:option:OPTION 2", "control for the above: a covert character cannot block a plain attacker", () => {
  const { engine, id } = eeBoard({ turn: 2, active: P2 });
  declareAttackBy(engine, P2, [id("foe")]);
  refused(() => declareBlockers(engine, P1, [id("mineCovert")]), "a covert character may block only a covert party");
});

clause(ESSENCE, "2:option:OPTION 2", "'this turn': the COVERT comes back when the turn ends", () => {
  const { engine, id } = eeBoard();
  essence(engine, id, 1, { c: [id("mineCovert")] });
  assert.equal(covert(engine, id("mineCovert")), false);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(covert(engine, id("mineCovert")), true, "back at the end of the turn");
  endTurn(engine, P2);
  assert.equal(covert(engine, id("mineCovert")), true);
});

// --- OPTION 3: recover an item ------------------------------------------------------------

clause(ESSENCE, "3:option:OPTION 3", "the picked item in my discard pile is put into my hand; the other discarded cards stay", () => {
  const { engine, id } = eeBoard();
  const handBefore = handOf(engine, P1).length;
  essence(engine, id, 2, { it: [id("itemA")] });
  assert.equal(zoneOf(engine, id("itemA")), "hand");
  assert.ok(handOf(engine, P1).includes(id("itemA")), "handOf(engine, P1).includes(id(\"itemA\"))");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left my hand, the item joined it");
  for (const key of ["itemB", "charD", "tacD", "placeD"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key} stays in the discard pile`);
  assert.equal(zoneOf(engine, id("oppItem")), "discard");
});

clause(ESSENCE, "3:option:OPTION 3", "a gear item can be picked too, and the item is then deployable from my hand", () => {
  const { engine, id } = eeBoard();
  essence(engine, id, 2, { it: [id("itemB")] });
  assert.equal(zoneOf(engine, id("itemB")), "hand");
  play(engine, P1, id("itemB"));
  assert.equal(zoneOf(engine, id("itemB")), "play");
});

clause(ESSENCE, "3:option:OPTION 3", "only an item can be picked: a character, tactic or location in my discard pile is refused", () => {
  const { engine, id } = eeBoard();
  refused(() => essenceRaw(engine, id, 2, { it: [id("charD")] }), "a character");
  refused(() => essenceRaw(engine, id, 2, { it: [id("tacD")] }), "a tactic");
  refused(() => essenceRaw(engine, id, 2, { it: [id("placeD")] }), "a location");
  assert.equal(zoneOf(engine, id("ee")), "hand");
  assert.equal(ready(engine), 4, "nothing was paid");
  essenceRaw(engine, id, 2, { it: [id("itemA")] });
  assert.ok(engine.state.responseWindow, "control: an item is accepted");
});

clause(ESSENCE, "3:option:OPTION 3", "it must be in MY discard pile: the opponent's discarded item, an item in my hand and an item in play are refused", () => {
  const { engine, id } = eeBoard();
  refused(() => essenceRaw(engine, id, 2, { it: [id("oppItem")] }), "the opponent's discard pile");
  refused(() => essenceRaw(engine, id, 2, { it: [id("mhItem")] }), "my hand");
  refused(() => essenceRaw(engine, id, 2, { it: [id("playItem")] }), "in play");
  refused(() => essenceRaw(engine, id, 2, { it: [id("foeThing")] }), "the opponent's item in play");
  assert.equal(zoneOf(engine, id("oppItem")), "discard");
  essenceRaw(engine, id, 2, { it: [id("itemA")] });
  assert.ok(engine.state.responseWindow, "control: an item in my discard pile is accepted");
});

clause(ESSENCE, "3:option:OPTION 3", "exactly one item: none or two are refused", () => {
  const { engine, id } = eeBoard();
  refused(() => essenceRaw(engine, id, 2, {}), "no pick");
  refused(() => essenceRaw(engine, id, 2, { it: [] }), "an empty pick");
  refused(() => essenceRaw(engine, id, 2, { it: [id("itemA"), id("itemB")] }), "two picks");
  assert.equal(zoneOf(engine, id("ee")), "hand");
  assert.equal(zoneOf(engine, id("itemA")), "discard");
  assert.equal(zoneOf(engine, id("itemB")), "discard");
});

clause(ESSENCE, "3:option:OPTION 3", "with no item in my discard pile option 3 cannot be played (while option 1 still can)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ee", def: printing(ESSENCE), owner: P1, zone: "hand" },
      { key: "tacD", def: tactic({ name: "Tactic D" }), owner: P1, zone: "discard" },
      ...res({ elitism: 2 })
    ]
  });
  refused(() => essenceRaw(engine, id, 2, { it: [id("tacD")] }), "no item to pick");
  essenceRaw(engine, id, 0);
  assert.ok(engine.state.responseWindow, "option 1 is still playable");
});

clause(ESSENCE, "3:option:OPTION 3", "'your discard pile' is its owner's: my item that the opponent controlled and that was destroyed sits in MY discard pile and can be picked", () => {
  const { engine, id } = eeBoard({
    extra: [
      { key: "stolenThing", def: item({ name: "Stolen Thing" }), owner: P1, controller: P2, zone: "play" },
      { key: "kill", def: killAny("item"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("stolenThing")] } });
  assert.ok(discardOf(engine, P1).includes(id("stolenThing")), "it went to its owner's discard pile");
  essence(engine, id, 2, { it: [id("stolenThing")] });
  assert.equal(zoneOf(engine, id("stolenThing")), "hand");
  assert.ok(handOf(engine, P1).includes(id("stolenThing")), "handOf(engine, P1).includes(id(\"stolenThing\"))");
});

clause(ESSENCE, "3:option:OPTION 3", "a recovered item is an ordinary card in hand again: its cost is paid normally and it comes back into play", () => {
  const { engine, id } = eeBoard({ icons: { elitism: 6 } });
  essence(engine, id, 2, { it: [id("itemA")] });
  const before = ready(engine);
  play(engine, P1, id("itemA"));
  assert.equal(zoneOf(engine, id("itemA")), "play");
  assert.equal(before - ready(engine), 0, "Item A has cost 0");
});

// =================================================================================
// The three "you may pay N, put a token on it" Golems:
//
// Fleet Golem        - When this card enters play, you may pay 5. If you do, put a token on it.
//                      While there is a token on this card, it cannot be blocked.
//                      Character (golem), cost 3, [E][E], 3 strength / 2 speed / 3 life.
// Inconspicuous Golem - When this card enters play, you may pay 1. If you do, put a token on it.
//                      While there is a token on this card, it can block COVERT parties.
//                      Character (golem), cost 2, [E], 0 strength / 3 speed / 4 life.
// Mundane Pupil      - When this card enters play, you may pay 3. If you do, put a token on it.
//                      While there is a token on this card, it gains 1 strength and 1 life.
//                      Character (31f), cost 1, [E][E], 1 strength / 4 speed / 1 life.
//
// The enters-play half is one parametrised body per check; each printing still gets
// its own clause() calls.
// =================================================================================

const FLEET = "920611b1-1ee4-42a2-a1a1-ec4ef8d5e8ac";
const INCONSPICUOUS = "604aa4d1-2a70-436e-9b4e-20e08cf6b6b8";
const PUPIL = "d0666557-9aec-453e-948a-abb32fa3cb10";

interface Golem {
  id: string;
  name: string;
  /** The N of "you may pay N". */
  pay: number;
  cost: number;
  icons: number;
  strength: number;
  life: number;
  speed: number;
}

const FLEET_G: Golem = { id: FLEET, name: "Fleet Golem", pay: 5, cost: 3, icons: 2, strength: 3, life: 3, speed: 2 };
const INCON_G: Golem = { id: INCONSPICUOUS, name: "Inconspicuous Golem", pay: 1, cost: 2, icons: 1, strength: 0, life: 4, speed: 3 };
const PUPIL_G: Golem = { id: PUPIL, name: "Mundane Pupil", pay: 3, cost: 1, icons: 2, strength: 1, life: 1, speed: 4 };

interface GolemOpts {
  zone?: "hand" | "play" | "discard";
  tokens?: number;
  /** Resources left after paying the deploy cost (so exactly this many are available for the 'pay N'). */
  spare?: number;
  faceDown?: boolean;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * P1: gl (the golem), ally (2/3/2, in play). P2: foe (2/3/2, in play). Resources: Elitism, `cost + spare` of them
 * (or enough to meet the threshold). When the golem starts in play, `spare` is simply the number of ready resources.
 */
function golemBoard(g: Golem, o: GolemOpts = {}) {
  const zone = o.zone ?? "hand";
  const resources = zone === "hand" ? Math.max(g.cost + (o.spare ?? 20), g.icons) : o.spare ?? 20;
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "gl", def: printing(g.id), owner: P1, zone, counters: o.tokens ? { token: o.tokens } : undefined, faceDown: o.faceDown },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res({ elitism: resources }),
      ...(o.extra ?? [])
    ]
  });
}

/** A free-to-use item whose ability (no 'pay' in the cost, so no numeric cost of its own) puts a character from its controller's discard pile into play. */
const summoner = (): CardDefinition =>
  item({
    name: "Summoner",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "summon",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

/** An item whose ability removes one token from a chosen character. */
const tokenRemover = (): CardDefinition =>
  item({
    name: "Token Remover",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });

/** Deploys the golem and returns the open 'may pay' prompt. */
function deployToPrompt(engine: SpoilsEngine, id: IdOf) {
  play(engine, P1, id("gl"));
  const pc = pending(engine);
  assert.ok(pc, "a prompt is open after entering play");
  return pc;
}

// --- When this card enters play, you may pay N. If you do, put a token on it. ---------

const etbOffer = (g: Golem) => () => {
  const { engine, id } = golemBoard(g);
  const pc = deployToPrompt(engine, id);
  assert.equal(pc.kind, "mayPay", "a 'may pay' offer");
  assert.equal(pc.playerId, P1, "to the golem's controller");
  assert.equal(zoneOf(engine, id("gl")), "play", "the golem is already in play");
  assert.equal(tokensOn(engine, id("gl")), 0, "no token until I pay");
};

const etbAccept = (g: Golem) => () => {
  const { engine, id } = golemBoard(g);
  play(engine, P1, id("gl"));
  const afterDeploy = ready(engine);
  answerBy(engine, "mayPay", P1, { pay: true });
  drain(engine, declineAll);
  assert.equal(afterDeploy - ready(engine), g.pay, `exactly ${g.pay} resources are paid`);
  assert.equal(tokensOn(engine, id("gl")), 1, "exactly one token");
  assert.equal(engine.state.pendingChoice, undefined);
};

const etbDecline = (g: Golem) => () => {
  const { engine, id } = golemBoard(g);
  play(engine, P1, id("gl"));
  const afterDeploy = ready(engine);
  answerBy(engine, "mayPay", P1, { pay: false });
  drain(engine, declineAll);
  assert.equal(ready(engine), afterDeploy, "nothing is paid");
  assert.equal(tokensOn(engine, id("gl")), 0, "no token");
  assert.equal(zoneOf(engine, id("gl")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
};

const etbExactlyEnough = (g: Golem) => () => {
  const { engine, id } = golemBoard(g, { spare: g.pay });
  play(engine, P1, id("gl"));
  assert.equal(ready(engine), g.pay, "exactly enough left over");
  answerBy(engine, "mayPay", P1, { pay: true });
  drain(engine, declineAll);
  assert.equal(ready(engine), 0);
  assert.equal(tokensOn(engine, id("gl")), 1);
};

const etbCannotAfford = (g: Golem) => () => {
  const { engine, id } = golemBoard(g, { spare: g.pay - 1 });
  play(engine, P1, id("gl"));
  const afterDeploy = ready(engine);
  assert.equal(afterDeploy, g.pay - 1);
  drain(engine, payYes);
  assert.equal(tokensOn(engine, id("gl")), 0, `${g.pay - 1} resources cannot pay ${g.pay}: no token`);
  assert.equal(ready(engine), afterDeploy, "and nothing is paid");
  assert.equal(engine.state.pendingChoice, undefined, "the game is not stuck");
  assert.equal(zoneOf(engine, id("gl")), "play");
};

const etbOnlyTheGolem = (g: Golem) => () => {
  const { engine, id } = golemBoard(g);
  play(engine, P1, id("gl"));
  answerBy(engine, "mayPay", P1, { pay: true });
  drain(engine, declineAll);
  assert.equal(tokensOn(engine, id("gl")), 1);
  assert.equal(tokensOn(engine, id("ally")), 0, "no token on another character");
  assert.equal(tokensOn(engine, id("foe")), 0);
};

const etbFaceDown = (g: Golem) => () => {
  const { engine, id } = golemBoard(g, { spare: 6 });
  const before = ready(engine);
  developResource(engine, P1, id("gl"), true);
  assert.equal(engine.state.cards[id("gl")].faceDown, true);
  assert.equal(engine.state.pendingChoice, undefined, "a face-down resource has no rules text: no offer");
  assert.equal(tokensOn(engine, id("gl")), 0);
  assert.equal(ready(engine), before + 1, "it is just a new resource");
};

const etbPutIntoPlay = (g: Golem) => () => {
  const { engine, id } = golemBoard(g, { zone: "discard", spare: 12, extra: [{ key: "summoner", def: summoner(), owner: P1, zone: "play" }] });
  activate(engine, P1, id("summoner"), "summon", { selected: { t: [id("gl")] } });
  assert.equal(zoneOf(engine, id("gl")), "play", "put into play, not deployed");
  const pc = pending(engine);
  assert.ok(pc, "it still 'enters play': the offer is made");
  assert.equal(pc.kind, "mayPay");
  const before = ready(engine);
  answerBy(engine, "mayPay", P1, { pay: true });
  drain(engine, declineAll);
  assert.equal(before - ready(engine), g.pay);
  assert.equal(tokensOn(engine, id("gl")), 1);
};

const etbOnlyForItself = (g: Golem) => () => {
  const other = { key: "gl2", def: printing(g.id), owner: P1, zone: "hand" as const };
  const { engine, id } = golemBoard(g, { zone: "play", spare: 20, extra: [other] });
  play(engine, P1, id("gl2"));
  const prompts = drainRecording(engine, payYes);
  assert.equal(prompts.filter((p) => p === "p1:mayPay").length, 1, "only the new golem's own trigger asks");
  assert.equal(tokensOn(engine, id("gl")), 0, "the golem already in play gets nothing");
  assert.equal(tokensOn(engine, id("gl2")), 1);
};

const etbCostReduction = (g: Golem) => () => {
  const { engine, id } = golemBoard(g, {
    zone: "discard",
    spare: 12,
    extra: [
      { key: "summoner", def: summoner(), owner: P1, zone: "play" },
      { key: "cc", def: printing(CLAYWORK), owner: P1, zone: "play" }
    ]
  });
  activate(engine, P1, id("cc"), "research");
  activate(engine, P1, id("summoner"), "summon", { selected: { t: [id("gl")] } });
  const before = ready(engine);
  answerBy(engine, "mayPay", P1, { pay: true });
  drain(engine, declineAll);
  assert.equal(before - ready(engine), Math.max(0, g.pay - 2), "'pay N' is a numeric cost (CR 406.5): the next-cost reduction of 2 applies to it");
  assert.equal(tokensOn(engine, id("gl")), 1);
};

const etbDeployBasics = (g: Golem) => () => deployChecks(g.id, { cost: g.cost, icon: "elitism", icons: g.icons, type: "character" });
const etbStats = (g: Golem) => () => statsAre(g.id, g.strength, g.life, g.speed);

clause(FLEET, "0:rule", "deploys for exactly its printed cost of 3 and threshold [E][E]", etbDeployBasics(FLEET_G));
clause(FLEET, "0:rule", "has its printed stats: 3 strength, 3 life, 2 speed", etbStats(FLEET_G));
clause(FLEET, "0:rule", "on entering play its controller is offered 'may pay' and nothing is paid or placed until they answer", etbOffer(FLEET_G));
clause(FLEET, "0:rule", "accepting pays exactly 5 resources and puts exactly one token on the golem", etbAccept(FLEET_G));
clause(FLEET, "0:rule", "declining pays nothing and puts no token on it", etbDecline(FLEET_G));
clause(FLEET, "0:rule", "with exactly 5 resources left over, paying works and uses them all", etbExactlyEnough(FLEET_G));
clause(FLEET, "0:rule", "with only 4 resources left over the 5 cannot be paid: no token, nothing paid, nothing stuck", etbCannotAfford(FLEET_G));
clause(FLEET, "0:rule", "the token goes on the golem only", etbOnlyTheGolem(FLEET_G));
clause(FLEET, "0:rule", "played face-down as a resource it has no rules text (CR 411.1): no offer, no token", etbFaceDown(FLEET_G));
clause(FLEET, "0:rule", "put into play by an effect (not deployed) it still enters play: the offer is made and works", etbPutIntoPlay(FLEET_G));
clause(FLEET, "0:rule", "'this card' only: a second golem entering while one is in play asks once, for the new one", etbOnlyForItself(FLEET_G));
clause(FLEET, "0:rule", "'pay 5' is a numeric cost (CR 406.5): a pending 'reduce the next numeric cost you pay this turn by 2' lowers it to 3", etbCostReduction(FLEET_G));

clause(INCONSPICUOUS, "0:rule", "deploys for exactly its printed cost of 2 and threshold [E]", etbDeployBasics(INCON_G));
clause(INCONSPICUOUS, "0:rule", "has its printed stats: 0 strength, 4 life, 3 speed", etbStats(INCON_G));
clause(INCONSPICUOUS, "0:rule", "on entering play its controller is offered 'may pay' and nothing is paid or placed until they answer", etbOffer(INCON_G));
clause(INCONSPICUOUS, "0:rule", "accepting pays exactly 1 resource and puts exactly one token on the golem", etbAccept(INCON_G));
clause(INCONSPICUOUS, "0:rule", "declining pays nothing and puts no token on it", etbDecline(INCON_G));
clause(INCONSPICUOUS, "0:rule", "with exactly 1 resource left over, paying works and uses it", etbExactlyEnough(INCON_G));
clause(INCONSPICUOUS, "0:rule", "with no resource left over the 1 cannot be paid: no token, nothing paid, nothing stuck", etbCannotAfford(INCON_G));
clause(INCONSPICUOUS, "0:rule", "the token goes on the golem only", etbOnlyTheGolem(INCON_G));
clause(INCONSPICUOUS, "0:rule", "played face-down as a resource it has no rules text (CR 411.1): no offer, no token", etbFaceDown(INCON_G));
clause(INCONSPICUOUS, "0:rule", "put into play by an effect (not deployed) it still enters play: the offer is made and works", etbPutIntoPlay(INCON_G));
clause(INCONSPICUOUS, "0:rule", "'this card' only: a second golem entering while one is in play asks once, for the new one", etbOnlyForItself(INCON_G));
clause(INCONSPICUOUS, "0:rule", "'pay 1' is a numeric cost (CR 406.5): a pending 'reduce the next numeric cost you pay this turn by 2' lowers it to 0", etbCostReduction(INCON_G));

clause(PUPIL, "0:rule", "deploys for exactly its printed cost of 1 and threshold [E][E]", etbDeployBasics(PUPIL_G));
clause(PUPIL, "0:rule", "has its printed stats: 1 strength, 1 life, 4 speed", etbStats(PUPIL_G));
clause(PUPIL, "0:rule", "on entering play its controller is offered 'may pay' and nothing is paid or placed until they answer", etbOffer(PUPIL_G));
clause(PUPIL, "0:rule", "accepting pays exactly 3 resources and puts exactly one token on the pupil", etbAccept(PUPIL_G));
clause(PUPIL, "0:rule", "declining pays nothing and puts no token on it", etbDecline(PUPIL_G));
clause(PUPIL, "0:rule", "with exactly 3 resources left over, paying works and uses them all", etbExactlyEnough(PUPIL_G));
clause(PUPIL, "0:rule", "with only 2 resources left over the 3 cannot be paid: no token, nothing paid, nothing stuck", etbCannotAfford(PUPIL_G));
clause(PUPIL, "0:rule", "the token goes on the pupil only", etbOnlyTheGolem(PUPIL_G));
clause(PUPIL, "0:rule", "played face-down as a resource it has no rules text (CR 411.1): no offer, no token", etbFaceDown(PUPIL_G));
clause(PUPIL, "0:rule", "put into play by an effect (not deployed) it still enters play: the offer is made and works", etbPutIntoPlay(PUPIL_G));
clause(PUPIL, "0:rule", "'this card' only: a second pupil entering while one is in play asks once, for the new one", etbOnlyForItself(PUPIL_G));
clause(PUPIL, "0:rule", "'pay 3' is a numeric cost (CR 406.5): a pending 'reduce the next numeric cost you pay this turn by 2' lowers it to 1", etbCostReduction(PUPIL_G));

// --- While there is a token on this card ... -----------------------------------------------

/** The token is removed from the golem by an effect: the 'while' text switches off. */
const tokenGoneByEffect = (g: Golem, active: (engine: SpoilsEngine, cardId: CardInstanceId) => boolean) => () => {
  const { engine, id } = golemBoard(g, { zone: "play", tokens: 1, extra: [{ key: "rm", def: tokenRemover(), owner: P1, zone: "play" }] });
  assert.equal(active(engine, id("gl")), true, "on with a token");
  activate(engine, P1, id("rm"), "rm", { selected: { t: [id("gl")] } });
  assert.equal(tokensOn(engine, id("gl")), 0);
  assert.equal(active(engine, id("gl")), false, "off again once the token is gone");
};

/** An item whose ability puts a token on one chosen character. */
const tokenGiver = (): CardDefinition =>
  item({
    name: "Token Giver",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "give",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });

/** A token put on the golem by ANY effect switches the text on ('a token on this card'), and a token on another card does not. */
const tokenFromAnyEffect = (g: Golem, active: (engine: SpoilsEngine, cardId: CardInstanceId) => boolean) => () => {
  const { engine, id } = golemBoard(g, { zone: "play", extra: [{ key: "giver", def: tokenGiver(), owner: P1, zone: "play" }] });
  assert.equal(active(engine, id("gl")), false, "off without a token");
  activate(engine, P1, id("giver"), "give", { selected: { t: [id("ally")] } });
  assert.equal(tokensOn(engine, id("ally")), 1);
  assert.equal(active(engine, id("gl")), false, "a token on ANOTHER card does not count");
  activate(engine, P1, id("giver"), "give", { selected: { t: [id("gl")] } });
  assert.equal(tokensOn(engine, id("gl")), 1);
  assert.equal(active(engine, id("gl")), true, "on once there is a token on this card, whoever put it there");
};

/** Leaving play takes the token with it (CR 409.2), so a golem that comes back has no token and none of the text. */
const tokenLostOnLeavingPlay = (g: Golem, active: (engine: SpoilsEngine, cardId: CardInstanceId) => boolean) => () => {
  const { engine, id } = golemBoard(g, { zone: "play", tokens: 1, extra: [{ key: "bounce", def: bounceChar(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("gl")] } });
  assert.equal(zoneOf(engine, id("gl")), "hand");
  assert.equal(tokensOn(engine, id("gl")), 0, "its tokens disappeared when it left play (CR 409.2)");
  play(engine, P1, id("gl"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("gl")), "play");
  assert.equal(tokensOn(engine, id("gl")), 0, "the new card has no token");
  assert.equal(active(engine, id("gl")), false, "and none of the token text");
};

const unblockable = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getKeywords(cardId).includes("cannotBeBlocked");
const canBlockCovert = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getKeywords(cardId).includes("canBlockCovert");
const pupilBuffed = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getStat(cardId, "strength") === 2 && engine.getStat(cardId, "life") === 2;

// Fleet Golem: it cannot be blocked

clause(FLEET, "1:rule", "without a token it can be blocked: a blocker is accepted against it", () => {
  const { engine, id } = golemBoard(FLEET_G, { zone: "play", turn: 2 });
  assert.equal(unblockable(engine, id("gl")), false);
  declareAttackBy(engine, P1, [id("gl")]);
  declareBlockers(engine, P2, [id("foe")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe")]);
});

clause(FLEET, "1:rule", "with a token it cannot be blocked: declaring any blocker is refused, declaring none is fine", () => {
  const { engine, id } = golemBoard(FLEET_G, { zone: "play", tokens: 1, turn: 2 });
  assert.equal(unblockable(engine, id("gl")), true);
  declareAttackBy(engine, P1, [id("gl")]);
  refused(() => declareBlockers(engine, P2, [id("foe")]), "an unblockable party cannot be blocked (CR 412.1)");
  declareBlockers(engine, P2, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], []);
});

clause(FLEET, "1:rule", "unblocked, it deals its 3 strength to the faction", () => {
  const { engine, id } = golemBoard(FLEET_G, { zone: "play", tokens: 1, turn: 2 });
  const influence = influenceOf(engine, P2);
  declareAttackBy(engine, P1, [id("gl")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influence - influenceOf(engine, P2), 3);
});

clause(FLEET, "1:rule", "two tokens do not change anything: it is still just unblockable", () => {
  const { engine, id } = golemBoard(FLEET_G, { zone: "play", tokens: 2, turn: 2 });
  assert.equal(unblockable(engine, id("gl")), true);
  declareAttackBy(engine, P1, [id("gl")]);
  refused(() => declareBlockers(engine, P2, [id("foe")]), "still unblockable");
});

clause(FLEET, "1:rule", "only a party made ENTIRELY of unblockable characters cannot be blocked (CR 412.1): attacking with an ordinary ally lets the defender block", () => {
  const { engine, id } = golemBoard(FLEET_G, { zone: "play", tokens: 1, turn: 2 });
  declareAttackBy(engine, P1, [id("gl"), id("ally")]);
  declareBlockers(engine, P2, [id("foe")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe")], "the party has a blockable member");
});

clause(FLEET, "1:rule", "two golems with tokens attacking together are an unblockable party", () => {
  const { engine, id } = golemBoard(FLEET_G, { zone: "play", tokens: 1, turn: 2, extra: [{ key: "gl2", def: printing(FLEET), owner: P1, zone: "play", counters: { token: 1 } }] });
  declareAttackBy(engine, P1, [id("gl"), id("gl2")]);
  refused(() => declareBlockers(engine, P2, [id("foe")]), "every member is unblockable");
});

clause(FLEET, "1:rule", "a golem with a token and one without: the party can be blocked", () => {
  const { engine, id } = golemBoard(FLEET_G, { zone: "play", tokens: 1, turn: 2, extra: [{ key: "gl2", def: printing(FLEET), owner: P1, zone: "play" }] });
  declareAttackBy(engine, P1, [id("gl"), id("gl2")]);
  declareBlockers(engine, P2, [id("foe")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe")]);
});

clause(FLEET, "1:rule", "the unblockability is only on this card: an ally attacking alone is blockable even while the golem has a token", () => {
  const { engine, id } = golemBoard(FLEET_G, { zone: "play", tokens: 1, turn: 2 });
  assert.equal(unblockable(engine, id("ally")), false);
  declareAttackBy(engine, P1, [id("ally")]);
  declareBlockers(engine, P2, [id("foe")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe")]);
});

clause(FLEET, "1:rule", "once the token is gone it can be blocked again", tokenGoneByEffect(FLEET_G, (engine, cardId) => unblockable(engine, cardId)));
clause(FLEET, "1:rule", "any token on this card counts, from any source; a token on another card does not", tokenFromAnyEffect(FLEET_G, (engine, cardId) => unblockable(engine, cardId)));
clause(FLEET, "1:rule", "its token disappears when it leaves play (CR 409.2): a bounced and redeployed golem has no token and is blockable", tokenLostOnLeavingPlay(FLEET_G, (engine, cardId) => unblockable(engine, cardId)));

// Inconspicuous Golem: it can block COVERT parties

function inconBoard(o: { tokens?: number; extra?: CardPlacement[] } = {}) {
  return golemBoard(INCON_G, {
    zone: "play",
    tokens: o.tokens,
    turn: 2,
    active: P2,
    extra: [
      { key: "covertAtk", def: character({ name: "CovertAtk", strength: 1, life: 5, speed: 2, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "covertAtk2", def: character({ name: "CovertAtk2", strength: 1, life: 5, speed: 2, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "plainAtk", def: character({ name: "PlainAtk", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

clause(INCONSPICUOUS, "1:rule", "without a token it cannot block a COVERT party", () => {
  const { engine, id } = inconBoard();
  assert.equal(canBlockCovert(engine, id("gl")), false);
  declareAttackBy(engine, P2, [id("covertAtk")]);
  refused(() => declareBlockers(engine, P1, [id("gl")]), "a non-covert character cannot block a covert party");
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], []);
});

clause(INCONSPICUOUS, "1:rule", "with a token it can block a COVERT party", () => {
  const { engine, id } = inconBoard({ tokens: 1 });
  assert.equal(canBlockCovert(engine, id("gl")), true);
  declareAttackBy(engine, P2, [id("covertAtk")]);
  declareBlockers(engine, P1, [id("gl")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("gl")]);
});

clause(INCONSPICUOUS, "1:rule", "with a token it can block a party of several COVERT characters", () => {
  const { engine, id } = inconBoard({ tokens: 1 });
  declareAttackBy(engine, P2, [id("covertAtk"), id("covertAtk2")]);
  declareBlockers(engine, P1, [id("gl")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("gl")]);
});

clause(INCONSPICUOUS, "1:rule", "with a token it still blocks an ordinary party (it gains a permission, it does not become covert)", () => {
  const { engine, id } = inconBoard({ tokens: 1 });
  assert.equal(engine.getKeywords(id("gl")).includes("covert"), false, "it is not COVERT itself");
  declareAttackBy(engine, P2, [id("plainAtk")]);
  declareBlockers(engine, P1, [id("gl")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("gl")]);
});

clause(INCONSPICUOUS, "1:rule", "without a token it blocks an ordinary party too (control)", () => {
  const { engine, id } = inconBoard();
  declareAttackBy(engine, P2, [id("plainAtk")]);
  declareBlockers(engine, P1, [id("gl")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("gl")]);
});

clause(INCONSPICUOUS, "1:rule", "it only helps itself: an ordinary ally cannot join it in blocking a COVERT party", () => {
  const { engine, id } = inconBoard({ tokens: 1 });
  declareAttackBy(engine, P2, [id("covertAtk")]);
  refused(() => declareBlockers(engine, P1, [id("gl"), id("ally")]), "an ordinary ally is not allowed to block a covert party");
  declareBlockers(engine, P1, [id("gl"), id("covertBlocker")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("gl"), id("covertBlocker")], "a real COVERT blocker can join it");
});

clause(INCONSPICUOUS, "1:rule", "an ordinary ally cannot block a COVERT party alone, even while the golem has a token", () => {
  const { engine, id } = inconBoard({ tokens: 1 });
  declareAttackBy(engine, P2, [id("covertAtk")]);
  refused(() => declareBlockers(engine, P1, [id("ally")]), "the ally has no such permission");
});

clause(INCONSPICUOUS, "1:rule", "two tokens do not change anything", () => {
  const { engine, id } = inconBoard({ tokens: 2 });
  declareAttackBy(engine, P2, [id("covertAtk")]);
  declareBlockers(engine, P1, [id("gl")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("gl")]);
});

clause(INCONSPICUOUS, "1:rule", "once the token is gone it cannot block a COVERT party again", tokenGoneByEffect(INCON_G, (engine, cardId) => canBlockCovert(engine, cardId)));
clause(INCONSPICUOUS, "1:rule", "any token on this card counts, from any source; a token on another card does not", tokenFromAnyEffect(INCON_G, (engine, cardId) => canBlockCovert(engine, cardId)));
clause(INCONSPICUOUS, "1:rule", "its token disappears when it leaves play (CR 409.2): a bounced and redeployed golem has no token and cannot block COVERT parties", tokenLostOnLeavingPlay(INCON_G, (engine, cardId) => canBlockCovert(engine, cardId)));

// Mundane Pupil: it gains 1 strength and 1 life

clause(PUPIL, "1:rule", "without a token it has its printed 1 strength and 1 life", () => {
  const { engine, id } = golemBoard(PUPIL_G, { zone: "play" });
  assert.equal(engine.getStat(id("gl"), "strength"), 1);
  assert.equal(engine.getStat(id("gl"), "life"), 1);
});

clause(PUPIL, "1:rule", "with a token it has exactly 2 strength and 2 life, and its speed is untouched", () => {
  const { engine, id } = golemBoard(PUPIL_G, { zone: "play", tokens: 1 });
  assert.equal(engine.getStat(id("gl"), "strength"), 2);
  assert.equal(engine.getStat(id("gl"), "life"), 2);
  assert.equal(engine.getStat(id("gl"), "speed"), 4);
});

clause(PUPIL, "1:rule", "two tokens give the same +1/+1, not +2/+2 ('while there is a token', not 'for each')", () => {
  const { engine, id } = golemBoard(PUPIL_G, { zone: "play", tokens: 2 });
  assert.equal(engine.getStat(id("gl"), "strength"), 2);
  assert.equal(engine.getStat(id("gl"), "life"), 2);
});

clause(PUPIL, "1:rule", "only the pupil gains it: other characters do not", () => {
  const { engine, id } = golemBoard(PUPIL_G, { zone: "play", tokens: 1 });
  assert.equal(engine.getStat(id("ally"), "strength"), 2);
  assert.equal(engine.getStat(id("ally"), "life"), 3);
  assert.equal(engine.getStat(id("foe"), "strength"), 2);
});

clause(PUPIL, "1:rule", "the paid-for token works end to end: deployed, paid 3, it has 2 strength and 2 life", () => {
  const { engine, id } = golemBoard(PUPIL_G);
  play(engine, P1, id("gl"));
  answerBy(engine, "mayPay", P1, { pay: true });
  drain(engine, declineAll);
  assert.equal(engine.getStat(id("gl"), "strength"), 2);
  assert.equal(engine.getStat(id("gl"), "life"), 2);
});

clause(PUPIL, "1:rule", "the extra life is real: with a token it survives 1 damage and dies to the 2nd; without one it dies to the 1st", () => {
  const withToken = golemBoard(PUPIL_G, { zone: "play", tokens: 1, extra: [{ key: "z1", def: zapChar(1), owner: P1, zone: "hand" }, { key: "z1b", def: zapChar(1), owner: P1, zone: "hand" }] });
  play(withToken.engine, P1, withToken.id("z1"), { selected: { t: [withToken.id("gl")] } });
  assert.equal(zoneOf(withToken.engine, withToken.id("gl")), "play", "2 life against 1 damage");
  play(withToken.engine, P1, withToken.id("z1b"), { selected: { t: [withToken.id("gl")] } });
  assert.equal(zoneOf(withToken.engine, withToken.id("gl")), "discard", "2 damage kills it");
  const without = golemBoard(PUPIL_G, { zone: "play", extra: [{ key: "z1", def: zapChar(1), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("z1"), { selected: { t: [without.id("gl")] } });
  assert.equal(zoneOf(without.engine, without.id("gl")), "discard", "1 life against 1 damage");
});

clause(PUPIL, "1:rule", "the extra strength is real: an unblocked pupil with a token deals 2 battle damage, without one 1", () => {
  const withToken = golemBoard(PUPIL_G, { zone: "play", tokens: 1, turn: 2 });
  const before = influenceOf(withToken.engine, P2);
  fight(withToken.engine, P1, [withToken.id("gl")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influenceOf(withToken.engine, P2), 2);
  const without = golemBoard(PUPIL_G, { zone: "play", turn: 2 });
  const before2 = influenceOf(without.engine, P2);
  fight(without.engine, P1, [without.id("gl")], { type: "faction", playerId: P2 }, []);
  assert.equal(before2 - influenceOf(without.engine, P2), 1);
});

clause(PUPIL, "1:rule", "once the token is gone it is a 1/1 again", tokenGoneByEffect(PUPIL_G, (engine, cardId) => pupilBuffed(engine, cardId)));
clause(PUPIL, "1:rule", "any token on this card counts, from any source; a token on another card does not", tokenFromAnyEffect(PUPIL_G, (engine, cardId) => pupilBuffed(engine, cardId)));
clause(PUPIL, "1:rule", "its token disappears when it leaves play (CR 409.2): a bounced and redeployed pupil has no token and is a 1/1", tokenLostOnLeavingPlay(PUPIL_G, (engine, cardId) => pupilBuffed(engine, cardId)));

// =================================================================================
// Ingenious Tinker
// When this card enters play, reduce the next numeric cost you pay this turn by 3.
// Character (31f), cost 6, [E], 3 strength / 3 speed / 3 life.
// =================================================================================

const TINKER = "827e74b0-ab0e-4dee-a998-80f556d831f6";

interface TinkerOpts {
  tinker?: "hand" | "discard" | "play";
  icons?: Icons;
  oppIcons?: Icons;
  extra?: CardPlacement[];
}

/** P1: tinker, hand items big (5), small (2), one (1), zero (0), big2 (5), a second tinker2. P2: oppBig (item, 5). */
function tinkerBoard(o: TinkerOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tinker", def: printing(TINKER), owner: P1, zone: o.tinker ?? "hand" },
      { key: "tinker2", def: printing(TINKER), owner: P1, zone: "hand" },
      { key: "big", def: item({ name: "Big Five", cost: 5 }), owner: P1, zone: "hand" },
      { key: "big2", def: item({ name: "Big Five Again", cost: 5 }), owner: P1, zone: "hand" },
      { key: "small", def: item({ name: "Small Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "one", def: item({ name: "Cheap One", cost: 1 }), owner: P1, zone: "hand" },
      { key: "zero", def: item({ name: "Free Zero", cost: 0 }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "oppBig", def: item({ name: "Their Five", cost: 5 }), owner: P2, zone: "hand" },
      ...res(o.icons ?? { elitism: 20 }),
      ...res(o.oppIcons ?? { elitism: 12 }, P2),
      ...(o.extra ?? [])
    ]
  });
}

/** A tactic with a printed cost that does nothing but deal 1 damage to a chosen character. */
const costlyZap = (cost: number): CardDefinition =>
  tactic({
    name: `Costly Zap ${cost}`,
    cost,
    behavior: {
      abilities: [
        { id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }
      ]
    }
  });

/** Deploys the Tinker and drains its (nonexistent) prompts. */
function deployTinker(engine: SpoilsEngine, id: IdOf, key = "tinker"): number {
  const before = ready(engine);
  play(engine, P1, id(key));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id(key)), "play", "the Tinker is in play");
  return before - ready(engine);
}

clause(TINKER, "0:rule", "deploys for exactly its printed cost of 6 and threshold [E]", () => deployChecks(TINKER, { cost: 6, icon: "elitism", icons: 1, type: "character" }));
clause(TINKER, "0:rule", "has its printed stats: 3 strength, 3 life, 3 speed", () => statsAre(TINKER, 3, 3, 3));

clause(TINKER, "0:rule", "its own deploy cost is not reduced by its own enters-play text: it pays the full 6", () => {
  const { engine, id } = tinkerBoard();
  assert.equal(deployTinker(engine, id), 6);
});

clause(TINKER, "0:rule", "once it is in play the next numeric cost I pay is reduced by exactly 3: a cost-5 item costs 2", () => {
  const { engine, id } = tinkerBoard();
  deployTinker(engine, id);
  assert.equal(paid(engine, id, "big"), 2);
});

clause(TINKER, "0:rule", "...without the Tinker the same item costs its full 5 (control)", () => {
  const { engine, id } = tinkerBoard({ tinker: "hand" });
  assert.equal(paid(engine, id, "big"), 5);
});

clause(TINKER, "0:rule", "a numeric cost never goes below 0 (CR 406.6): cost 2, 1 and 0 cards are free", () => {
  for (const key of ["small", "one", "zero"]) {
    const { engine, id } = tinkerBoard();
    deployTinker(engine, id);
    assert.equal(paid(engine, id, key), 0, `${key} is free`);
  }
});

clause(TINKER, "0:rule", "only the NEXT cost is reduced: the second card pays full price", () => {
  const { engine, id } = tinkerBoard();
  deployTinker(engine, id);
  assert.equal(paid(engine, id, "big"), 2);
  assert.equal(paid(engine, id, "big2"), 5);
});

clause(TINKER, "0:rule", "the reduction applies to a tactic's cost too: a cost-4 tactic costs 1", () => {
  const { engine, id } = tinkerBoard({ extra: [{ key: "zap4", def: costlyZap(4), owner: P1, zone: "hand" }] });
  deployTinker(engine, id);
  const before = ready(engine);
  play(engine, P1, id("zap4"), { selected: { t: [id("foe")] } });
  assert.equal(before - ready(engine), 1);
  assert.equal(zoneOf(engine, id("zap4")), "discard");
});

clause(TINKER, "0:rule", "'this turn': an unused reduction does not carry into the next turn", () => {
  const { engine, id } = tinkerBoard();
  deployTinker(engine, id);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(paid(engine, id, "big"), 5);
});

clause(TINKER, "0:rule", "'you pay': the opponent's costs are not reduced", () => {
  const { engine, id } = tinkerBoard();
  deployTinker(engine, id);
  assert.equal(engine.getCardPlayability(P2, id("oppBig")).numericCost, 5);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 2);
});

clause(TINKER, "0:rule", "the reduction is for the numeric cost only: a card's threshold must still be met", () => {
  const { engine, id } = tinkerBoard({ extra: [{ key: "gated", def: item({ name: "Gated", cost: 2, threshold: "g" }), owner: P1, zone: "hand" }] });
  deployTinker(engine, id);
  refused(() => playRaw(engine, P1, id("gated")), "no [G] among the Elitism");
  assert.equal(zoneOf(engine, id("gated")), "hand");
});

clause(TINKER, "0:rule", "a second Tinker deployed next uses the first one's reduction (pays 3), and brings its own reduction for the card after it", () => {
  const { engine, id } = tinkerBoard();
  assert.equal(deployTinker(engine, id, "tinker"), 6);
  assert.equal(deployTinker(engine, id, "tinker2"), 3, "6 - 3");
  assert.equal(paid(engine, id, "big"), 2, "the second Tinker's own reduction");
});

clause(TINKER, "0:rule", "put into play by an effect (not deployed) it still 'enters play': the next numeric cost is reduced", () => {
  const { engine, id } = tinkerBoard({ tinker: "discard", extra: [{ key: "summoner", def: summoner(), owner: P1, zone: "play" }] });
  activate(engine, P1, id("summoner"), "summon", { selected: { t: [id("tinker")] } });
  assert.equal(zoneOf(engine, id("tinker")), "play");
  assert.equal(paid(engine, id, "big"), 2);
});

clause(TINKER, "0:rule", "played face-down as a resource it has no rules text (CR 411.1): nothing is reduced", () => {
  const { engine, id } = tinkerBoard();
  developResource(engine, P1, id("tinker"), true);
  assert.equal(engine.state.cards[id("tinker")].faceDown, true);
  assert.equal(paid(engine, id, "big"), 5);
});

clause(TINKER, "0:rule", "in the hand or discard pile it reduces nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = tinkerBoard({ tinker: zone });
    assert.equal(paid(engine, id, "big"), 5, zone);
  }
});

clause(TINKER, "0:rule", "'pay N' is a numeric cost (CR 406.5): the reduction lowers an ability that says 'pay 3' to 0", () => {
  const gadget = item({
    name: "Pay Three Gadget",
    cost: 0,
    behavior: { abilities: [{ id: "go", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = tinkerBoard({ extra: [{ key: "gadget", def: gadget, owner: P1, zone: "play" }, ...cards("d", 3, P1, "deck")] });
  deployTinker(engine, id);
  const before = ready(engine);
  activate(engine, P1, id("gadget"), "go");
  assert.equal(before - ready(engine), 0, "pay 3 reduced by 3 is pay 0");
});

clause(TINKER, "0:rule", "two pending 'reduce the next numeric cost' effects (this one and a Claywork Compendium's) both apply to the one next cost: 3 + 2 = 5", () => {
  const { engine, id } = tinkerBoard({ extra: [{ key: "cc", def: printing(CLAYWORK), owner: P1, zone: "play" }] });
  deployTinker(engine, id);
  activate(engine, P1, id("cc"), "research");
  assert.equal(paid(engine, id, "big"), 0, "5 - 3 - 2");
});

// =================================================================================
// Massive Erecting Golem
// (no rules text)
// Character (golem), cost 7, [E][E], 7 strength / 3 speed / 7 life.
// =================================================================================

const MASSIVE = "fe09a3da-fca9-4d80-b7d6-7f25d5e55e6b";

clause(MASSIVE, "vanilla", "deploys for exactly its printed cost of 7 and needs [E][E]: refused with 6 resources, with 1 [E] among many, and with none; accepted with exactly 7", () => {
  deployChecks(MASSIVE, { cost: 7, icon: "elitism", icons: 2, type: "character" });
  const sevenWithTwo = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "subject", def: printing(MASSIVE), owner: P1, zone: "hand" }, ...res({ elitism: 2, rage: 5 })]
  });
  const before = ready(sevenWithTwo.engine);
  play(sevenWithTwo.engine, P1, sevenWithTwo.id("subject"));
  assert.equal(zoneOf(sevenWithTwo.engine, sevenWithTwo.id("subject")), "play", "[E][E] among seven resources is enough");
  assert.equal(before - ready(sevenWithTwo.engine), 7);
});

clause(MASSIVE, "vanilla", "has its printed stats in play: 7 strength, 7 life, 3 speed", () => statsAre(MASSIVE, 7, 7, 3));

clause(MASSIVE, "vanilla", "is a golem character with no keywords, no restrictions and no abilities", () => {
  const { engine, id } = buildGame({ cards: [{ key: "m", def: printing(MASSIVE), owner: P1, zone: "play" }] });
  const def = engine.getDefinition(id("m"));
  assert.equal(def.type, "character");
  assert.deepEqual([...def.subtype], ["golem"]);
  assert.deepEqual(engine.getKeywords(id("m")), []);
  assert.deepEqual(engine.getRestrictions(id("m")), []);
  assert.equal(def.behavior, undefined, "no rules text means no behavior");
});

clause(MASSIVE, "vanilla", "it takes 7 damage to destroy it: 6 does not, the 7th does", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "m", def: printing(MASSIVE), owner: P1, zone: "play" },
      { key: "z6", def: zapChar(6), owner: P1, zone: "hand" },
      { key: "z1", def: zapChar(1), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("z6"), { selected: { t: [id("m")] } });
  assert.equal(zoneOf(engine, id("m")), "play");
  play(engine, P1, id("z1"), { selected: { t: [id("m")] } });
  assert.equal(zoneOf(engine, id("m")), "discard");
});

clause(MASSIVE, "vanilla", "it deals its 7 strength: unblocked it takes 7 influence from the faction", () => {
  const { engine, id } = buildGame({
    turn: 2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "m", def: printing(MASSIVE), owner: P1, zone: "play" }]
  });
  const influence = influenceOf(engine, P2);
  fight(engine, P1, [id("m")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - influenceOf(engine, P2), 7);
});

clause(MASSIVE, "vanilla", "it cannot attack the turn it was deployed, but it can block as soon as it is in play", () => {
  const { engine, id } = buildGame({
    turn: 2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "m", def: printing(MASSIVE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...res({ elitism: 7 })
    ]
  });
  play(engine, P1, id("m"));
  assert.equal(zoneOf(engine, id("m")), "play");
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("m")], target: { type: "faction", playerId: P2 } }), "it did not start the turn in play");
  endTurn(engine, P1);
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("m")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("m")], "it blocks");
});

clause(MASSIVE, "vanilla", "played face-down as a resource it provides one Volition and nothing else", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "m", def: printing(MASSIVE), owner: P1, zone: "hand" }] });
  developResource(engine, P1, id("m"), true);
  assert.equal(engine.state.cards[id("m")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1);
  assert.equal(engine.getThresholds(P1).elitism ?? 0, 0);
  assert.equal(ready(engine), 1);
});

clause(MASSIVE, "vanilla", "it is a character: it can only be deployed on its controller's own turn", () => {
  const { engine, id } = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "m", def: printing(MASSIVE), owner: P1, zone: "hand" }, ...res({ elitism: 8 })]
  });
  refused(() => playRaw(engine, P1, id("m")), "the opponent's turn");
  assert.equal(zoneOf(engine, id("m")), "hand");
});

// =================================================================================
// Master Mud Whisperer
// At the start of your opponent's turn, you may restore all characters you control.
// Character (mud whisperer), cost 6, [E][E], 4 strength / 2 speed / 4 life.
// =================================================================================

const MASTER = "3256cb1c-e1b5-4b46-b7a7-7c5fad249ef4";

interface MasterOpts {
  zone?: "play" | "hand" | "discard";
  faceDown?: boolean;
  controller?: PlayerId;
  active?: PlayerId;
  copies?: number;
  extra?: CardPlacement[];
}

/**
 * P1 owns the Master Mud Whisperer. Depleted: mineDep, mineDep2 (characters), thingDep (item), placeDep (location), foeDep (P2's character).
 * Not depleted: mineReady, foeReady. The Master itself is depleted too.
 */
function masterBoard(o: MasterOpts = {}) {
  return buildGame({
    playerA: { faction: holdFaction() },
    playerB: { faction: holdFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "mmw", def: printing(MASTER), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown, controller: o.controller, depleted: true },
      ...(o.copies && o.copies > 1 ? [{ key: "mmw2", def: printing(MASTER), owner: P1, zone: "play" as const, depleted: true }] : []),
      { key: "mineDep", def: character({ name: "MineDep" }), owner: P1, zone: "play", depleted: true },
      { key: "mineDep2", def: character({ name: "MineDep2" }), owner: P1, zone: "play", depleted: true },
      { key: "mineReady", def: character({ name: "MineReady" }), owner: P1, zone: "play" },
      { key: "thingDep", def: item({ name: "ThingDep" }), owner: P1, zone: "play", depleted: true },
      { key: "placeDep", def: location({ name: "PlaceDep" }), owner: P1, zone: "play", depleted: true },
      { key: "foeDep", def: character({ name: "FoeDep" }), owner: P2, zone: "play", depleted: true },
      { key: "foeReady", def: character({ name: "FoeReady" }), owner: P2, zone: "play" },
      { key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play", depleted: true },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play", depleted: true },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
      ...(o.extra ?? [])
    ]
  });
}

/** Answers every 'restore all' offer with `accept`. */
const restoring = (accept: boolean) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: optionIndex(pc, accept) } : declineAll(pc);

clause(MASTER, "0:rule", "deploys for exactly its printed cost of 6 and threshold [E][E]", () => deployChecks(MASTER, { cost: 6, icon: "elitism", icons: 2, type: "character" }));
clause(MASTER, "0:rule", "has its printed stats: 4 strength, 4 life, 2 speed", () => statsAre(MASTER, 4, 4, 2));

clause(MASTER, "0:rule", "at the start of the opponent's turn its controller (not the opponent) is offered 'restore all', with a way to decline", () => {
  const { engine } = masterBoard();
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const pc = pending(engine);
  assert.ok(pc, "an offer is made");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  const labels = (pc.options as Array<{ label: string }>).map((o) => o.label);
  assert.ok(labels.includes("Decline"), "'you may': it can be declined");
  assert.equal(labels.length, 2);
});

clause(MASTER, "0:rule", "accepting restores EVERY character I control: all my depleted characters, the Master itself included", () => {
  const { engine, id } = masterBoard();
  const seen = startTurnOf(engine, P2, restoring(true));
  assert.deepEqual(seen, ["p1:chooserSelectsOption"]);
  for (const key of ["mmw", "mineDep", "mineDep2", "borrowed"]) assert.equal(isDepleted(engine, id(key)), false, `${key} restored`);
  assert.equal(isDepleted(engine, id("mineReady")), false);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MASTER, "0:rule", "it restores only characters: my depleted item and location stay depleted", () => {
  const { engine, id } = masterBoard();
  startTurnOf(engine, P2, restoring(true));
  assert.equal(isDepleted(engine, id("thingDep")), true, "an item is not a character");
  assert.equal(isDepleted(engine, id("placeDep")), true, "a location is not a character");
});

clause(MASTER, "0:rule", "it restores only characters I CONTROL: the opponent's depleted characters stay depleted", () => {
  const { engine, id } = masterBoard();
  startTurnOf(engine, P2, restoring(true));
  assert.equal(isDepleted(engine, id("foeDep")), true);
  assert.equal(isDepleted(engine, id("lent")), true, "a character I own but the opponent controls is not one I control");
});

clause(MASTER, "0:rule", "control, not ownership: a character I control but the opponent owns is restored", () => {
  const { engine, id } = masterBoard();
  startTurnOf(engine, P2, restoring(true));
  assert.equal(isDepleted(engine, id("borrowed")), false);
});

clause(MASTER, "0:rule", "'you may': declining restores nothing", () => {
  const { engine, id } = masterBoard();
  const seen = startTurnOf(engine, P2, restoring(false));
  assert.deepEqual(seen, ["p1:chooserSelectsOption"], "offered once, to me");
  for (const key of ["mmw", "mineDep", "mineDep2", "foeDep", "thingDep", "placeDep", "borrowed", "lent"]) assert.equal(isDepleted(engine, id(key)), true, `${key} still depleted`);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MASTER, "0:rule", "it is the OPPONENT's turn start that triggers it: at the start of my own turn nothing is offered", () => {
  const { engine, id } = masterBoard({ active: P2 });
  const seen = startTurnOf(engine, P1, restoring(true));
  assert.deepEqual(seen, []);
  assert.equal(isDepleted(engine, id("mineDep")), true, "(this test faction does not restore characters itself)");
});

clause(MASTER, "0:rule", "it triggers at the start of every opponent turn", () => {
  const { engine, id } = masterBoard();
  startTurnOf(engine, P2, restoring(true));
  endTurn(engine, P2);
  engine.state.cards[id("mineDep")].depleted = true;
  endTurn(engine, P1);
  const pc = pending(engine);
  assert.ok(pc, "offered again");
  assert.equal(pc.kind, "chooserSelectsOption");
  answerPending(engine, "chooserSelectsOption", { index: optionIndex(pc, true) });
  assert.equal(isDepleted(engine, id("mineDep")), false);
});

clause(MASTER, "0:rule", "it only works while in play: in my hand or discard pile nothing is offered", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = masterBoard({ zone });
    const seen = startTurnOf(engine, P2, restoring(true));
    assert.deepEqual(seen, [], zone);
    assert.equal(isDepleted(engine, id("mineDep")), true, zone);
  }
});

clause(MASTER, "0:rule", "a face-down Master is only a resource with no rules text (CR 411.1): nothing is offered", () => {
  const { engine, id } = masterBoard({ faceDown: true });
  const seen = startTurnOf(engine, P2, restoring(true));
  assert.deepEqual(seen, []);
  assert.equal(isDepleted(engine, id("mineDep")), true);
});

clause(MASTER, "0:rule", "'your opponent' and 'you control' are relative to its controller: a Master I own but the opponent controls restores THEIR characters at the start of MY turn", () => {
  const { engine, id } = masterBoard({ controller: P2, active: P2 });
  const seen = startTurnOf(engine, P1, restoring(true));
  assert.deepEqual(seen, ["p2:chooserSelectsOption"], "its controller P2 is asked at the start of P1's turn");
  assert.equal(isDepleted(engine, id("foeDep")), false, "their character was restored");
  assert.equal(isDepleted(engine, id("lent")), false, "so was the one they control but do not own");
  assert.equal(isDepleted(engine, id("mineDep")), true, "mine were not");
});

clause(MASTER, "0:rule", "two Master Mud Whisperers each offer it; accepting both just restores everything", () => {
  const { engine, id } = masterBoard({ copies: 2 });
  const seen = startTurnOf(engine, P2, restoring(true));
  assert.equal(seen.filter((p) => p === "p1:chooserSelectsOption").length, 2);
  for (const key of ["mmw", "mmw2", "mineDep", "mineDep2"]) assert.equal(isDepleted(engine, id(key)), false, key);
});

clause(MASTER, "0:rule", "the restore is real: a restored character of mine can block the opponent's attack, a depleted opposing one still cannot do anything", () => {
  const { engine, id } = masterBoard({ extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }] });
  startTurnOf(engine, P2, restoring(true));
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("mineDep"), id("mineDep2")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("mineDep"), id("mineDep2")]);
});

clause(MASTER, "0:rule", "control for the above: with no restore a depleted character cannot block", () => {
  const { engine, id } = masterBoard({ extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }] });
  startTurnOf(engine, P2, restoring(false));
  declareAttackBy(engine, P2, [id("atk")]);
  refused(() => declareBlockers(engine, P1, [id("mineDep")]), "still depleted");
});

// =================================================================================
// Mud Whisperer Wannabe
// If this card blocks, you may pick a character. If you do, restore that character.
// Character (mud whisperer, 31f), cost 4, [E][E], 2 strength / 3 speed / 4 life.
// =================================================================================

const WANNABE = "7496f5a7-efcf-40d3-838e-417241f125af";

interface WannabeOpts {
  extra?: CardPlacement[];
  wannabe?: "play" | "hand" | "discard";
  faceDown?: boolean;
}

/**
 * P2 is the active player and attacks. P1: w (the Wannabe), w2 (a second Wannabe, in play), mineDep, mineDep2 (depleted characters), mineReady,
 * thingDep (item, depleted), placeDep (location). P2: atk, atk2 (attackers, 1 strength / 9 life / 2 speed).
 */
function wannabeBoard(o: WannabeOpts = {}) {
  return buildGame({
    playerA: { faction: holdFaction() },
    playerB: { faction: holdFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "w", def: printing(WANNABE), owner: P1, zone: o.wannabe ?? "play", faceDown: o.faceDown },
      { key: "w2", def: printing(WANNABE), owner: P1, zone: "play" },
      { key: "mineDep", def: character({ name: "MineDep" }), owner: P1, zone: "play", depleted: true },
      { key: "mineDep2", def: character({ name: "MineDep2" }), owner: P1, zone: "play", depleted: true },
      { key: "mineReady", def: character({ name: "MineReady" }), owner: P1, zone: "play" },
      { key: "thingDep", def: item({ name: "ThingDep" }), owner: P1, zone: "play", depleted: true },
      { key: "placeDep", def: location({ name: "PlaceDep" }), owner: P1, zone: "play", depleted: true },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      { key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Raider Two", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

/** P2 attacks with `attackers` and P1 declares `blockers`; returns the engine state with the trigger's prompt (if any) still open. */
function wannabeBlocks(game: ReturnType<typeof wannabeBoard>, blockers: string[], attackers = ["atk"]) {
  declareAttackBy(game.engine, P2, attackers.map(game.id));
  declareBlockers(game.engine, P1, blockers.map(game.id));
  return game;
}

clause(WANNABE, "0:rule", "deploys for exactly its printed cost of 4 and threshold [E][E]", () => deployChecks(WANNABE, { cost: 4, icon: "elitism", icons: 2, type: "character" }));
clause(WANNABE, "0:rule", "has its printed stats: 2 strength, 4 life, 3 speed", () => statsAre(WANNABE, 2, 4, 3));

clause(WANNABE, "0:rule", "when it blocks, its controller is offered an optional pick of a character", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w"]);
  const pc = pending(game.engine);
  assert.ok(pc, "a pick is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "to the blocker's controller, not the attacker");
});

clause(WANNABE, "0:rule", "picking one of my depleted characters restores it, and only it", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w"]);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mineDep")] });
  assert.equal(isDepleted(game.engine, game.id("mineDep")), false);
  assert.equal(isDepleted(game.engine, game.id("mineDep2")), true, "the other depleted character stays depleted");
  assert.equal(isDepleted(game.engine, game.id("thingDep")), true);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(WANNABE, "0:rule", "any character can be picked: the attacking character (depleted by attacking) is restored too", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w"]);
  assert.equal(isDepleted(game.engine, game.id("atk")), true, "declaring an attack depletes the attacker");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("atk")] });
  assert.equal(isDepleted(game.engine, game.id("atk")), false);
});

clause(WANNABE, "0:rule", "the Wannabe can pick itself, and a character that is not depleted: nothing bad happens", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w"]);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("w")] });
  assert.equal(isDepleted(game.engine, game.id("w")), false);
  assert.equal(isDepleted(game.engine, game.id("mineDep")), true);
  const second = wannabeBoard();
  wannabeBlocks(second, ["w"]);
  answerPending(second.engine, "chooserSelectsTarget", { selected: [second.id("mineReady")] });
  assert.equal(isDepleted(second.engine, second.id("mineReady")), false);
});

clause(WANNABE, "0:rule", "'you may': declining restores nothing and the battle goes on", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w"]);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  for (const key of ["mineDep", "mineDep2", "atk"]) assert.equal(isDepleted(game.engine, game.id(key)), key !== "mineReady", `${key} unchanged`);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.ok(battleOf(game.engine), "the battle continues");
});

clause(WANNABE, "0:rule", "'pick a character': an item, a location, a faction, a face-down card and characters in a hand or discard pile cannot be picked", () => {
  const game = wannabeBoard();
  const { engine, id } = game;
  wannabeBlocks(game, ["w"]);
  refused(tryPick(engine, P1, [id("thingDep")]), "an item");
  refused(tryPick(engine, P1, [id("placeDep")]), "a location");
  refused(tryPick(engine, P1, [factionOf(engine, P1)]), "my faction");
  refused(tryPick(engine, P1, [factionOf(engine, P2)]), "their faction");
  refused(tryPick(engine, P1, [id("fd")]), "a face-down card");
  refused(tryPick(engine, P1, [id("inHand")]), "a character in my hand");
  refused(tryPick(engine, P1, [id("inDiscard")]), "a character in my discard pile");
  assert.equal(isDepleted(engine, id("thingDep")), true);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mineDep")] });
  assert.equal(isDepleted(engine, id("mineDep")), false, "control: a character in play is accepted");
});

clause(WANNABE, "0:rule", "it is a single pick: two characters are refused", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w"]);
  refused(tryPick(game.engine, P1, [game.id("mineDep"), game.id("mineDep2")]), "two picks");
  assert.equal(isDepleted(game.engine, game.id("mineDep")), true);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mineDep2")] });
  assert.equal(isDepleted(game.engine, game.id("mineDep2")), false);
});

clause(WANNABE, "0:rule", "it triggers when it blocks as part of a bigger blocking party, once", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w", "mineReady"]);
  const seen = drainRecording(game.engine, picking([game.id("mineDep")]));
  assert.equal(seen.filter((p) => p === "p1:chooserSelectsTarget").length, 1);
  assert.equal(isDepleted(game.engine, game.id("mineDep")), false);
});

clause(WANNABE, "0:rule", "it does not trigger when another character blocks and the Wannabe does not", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["mineReady"]);
  assert.equal(game.engine.state.pendingChoice, undefined, "nothing is offered");
  assert.equal(isDepleted(game.engine, game.id("mineDep")), true);
});

clause(WANNABE, "0:rule", "it does not trigger when no blockers are declared", () => {
  const game = wannabeBoard();
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, []);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(game.engine, game.id("mineDep")), true);
});

clause(WANNABE, "0:rule", "it does not trigger when it attacks (only when it blocks)", () => {
  const game = buildGame({
    playerA: { faction: holdFaction() },
    playerB: { faction: holdFaction() },
    turn: 2,
    cards: [
      { key: "w", def: printing(WANNABE), owner: P1, zone: "play" },
      { key: "dep", def: character({ name: "Dep" }), owner: P1, zone: "play", depleted: true },
      { key: "blocker", def: character({ name: "Blocker", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(game.engine, P1, [game.id("w")]);
  declareBlockers(game.engine, P2, [game.id("blocker")]);
  assert.equal(game.engine.state.pendingChoice, undefined, "attacking is not blocking");
  assert.equal(isDepleted(game.engine, game.id("dep")), true);
});

clause(WANNABE, "0:rule", "two Wannabes that both block each trigger: two picks", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w", "w2"]);
  const queue = [game.id("mineDep"), game.id("mineDep2")];
  const seen = drainRecording(game.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [queue.shift()!] } : declineAll(pc)));
  assert.equal(seen.filter((p) => p === "p1:chooserSelectsTarget").length, 2);
  assert.equal(isDepleted(game.engine, game.id("mineDep")), false);
  assert.equal(isDepleted(game.engine, game.id("mineDep2")), false);
});

clause(WANNABE, "0:rule", "it triggers on every block, in every battle", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w"]);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mineDep")] });
  autoResolveBattle(game.engine);
  endTurn(game.engine, P2);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(game.engine, game.id("w")), true, "(the first blocker was depleted by the battle, so another Wannabe blocks next)");
  declareAttackBy(game.engine, P2, [game.id("atk2")]);
  declareBlockers(game.engine, P1, [game.id("w2")]);
  const pc = pending(game.engine);
  assert.ok(pc, "offered again in the next battle");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
});

clause(WANNABE, "0:rule", "only while in play: a Wannabe in my hand or a face-down one blocks nothing and offers nothing", () => {
  const faceDown = wannabeBoard({ faceDown: true });
  declareAttackBy(faceDown.engine, P2, [faceDown.id("atk")]);
  refused(() => declareBlockers(faceDown.engine, P1, [faceDown.id("w")]), "a face-down card is not a character and cannot block");
  assert.equal(faceDown.engine.state.pendingChoice, undefined);
  const inHand = wannabeBoard({ wannabe: "hand" });
  declareAttackBy(inHand.engine, P2, [inHand.id("atk")]);
  refused(() => declareBlockers(inHand.engine, P1, [inHand.id("w")]), "a card in hand cannot block");
});

clause(WANNABE, "0:rule", "the restore happens on the spot: the restored character can block in the NEXT battle but was not part of this one", () => {
  const game = wannabeBoard();
  wannabeBlocks(game, ["w"]);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mineDep")] });
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("w")], "the blocking party was already declared");
  assert.equal(isDepleted(game.engine, game.id("mineDep")), false);
});

// =================================================================================
// Multi-Attachment Man
// If this card is destroyed, you may search your deck for an item and reveal it. If you do, put it into your hand.
// Character (mechanic), cost 3, [E], 2 strength / 3 speed / 1 life.
// =================================================================================

const MAM = "db82f8c3-503c-405c-b067-223752b2cad3";

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface MamOpts {
  mam?: "play" | "hand" | "discard";
  faceDown?: boolean;
  controller?: PlayerId;
  items?: number;
  random?: () => number;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * P1: mam; deck (top first) c0, i0, t0, i1, l0, r0, c1 (+ more items i2.. if asked); hand: hItem; discard: dItem; in play: playItem.
 * P2: deck oi0 (item), oc0 (character); hand: oHandItem; discard: oDiscItem. Tactics in P1's hand: kill, bounce, exile, flip.
 */
function mamBoard(o: MamOpts = {}) {
  const itemCount = o.items ?? 2;
  const deck: CardPlacement[] = [
    { key: "c0", def: character({ name: "Deck Char 0" }), owner: P1, zone: "deck" },
    ...(itemCount > 0 ? [{ key: "i0", def: item({ name: "Deck Item 0" }), owner: P1, zone: "deck" as const }] : []),
    { key: "t0", def: tactic({ name: "Deck Tactic" }), owner: P1, zone: "deck" },
    ...(itemCount > 1 ? [{ key: "i1", def: item({ name: "Deck Item 1", subtype: ["gear"] }), owner: P1, zone: "deck" as const }] : []),
    { key: "l0", def: location({ name: "Deck Location" }), owner: P1, zone: "deck" },
    { key: "r0", def: resourceCard({ name: "Deck Resource" }), owner: P1, zone: "deck" },
    { key: "c1", def: character({ name: "Deck Char 1" }), owner: P1, zone: "deck" },
    ...Array.from({ length: Math.max(0, itemCount - 2) }, (_, i) => ({ key: `i${i + 2}`, def: item({ name: `Deck Item ${i + 2}` }), owner: P1, zone: "deck" as const }))
  ];
  return buildGame({
    random: o.random,
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mam", def: printing(MAM), owner: P1, zone: o.mam ?? "play", faceDown: o.faceDown, controller: o.controller },
      ...deck,
      { key: "hItem", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
      { key: "dItem", def: item({ name: "Discard Item" }), owner: P1, zone: "discard" },
      { key: "playItem", def: item({ name: "Play Item" }), owner: P1, zone: "play" },
      { key: "oi0", def: item({ name: "Opp Deck Item" }), owner: P2, zone: "deck" },
      { key: "oc0", def: character({ name: "Opp Deck Char" }), owner: P2, zone: "deck" },
      { key: "oHandItem", def: item({ name: "Opp Hand Item" }), owner: P2, zone: "hand" },
      { key: "oDiscItem", def: item({ name: "Opp Discard Item" }), owner: P2, zone: "discard" },
      { key: "kill", def: killAny("character"), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceChar(), owner: P1, zone: "hand" },
      { key: "exile", def: exileChar(), owner: P1, zone: "hand" },
      { key: "flip", def: flipDownChar(), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ]
  });
}

const killMam = (engine: SpoilsEngine, id: IdOf) => play(engine, P1, id("kill"), { selected: { t: [id("mam")] } });

clause(MAM, "0:rule", "deploys for exactly its printed cost of 3 and threshold [E]", () => deployChecks(MAM, { cost: 3, icon: "elitism", icons: 1, type: "character" }));
clause(MAM, "0:rule", "has its printed stats: 2 strength, 1 life, 3 speed", () => statsAre(MAM, 2, 1, 3));

clause(MAM, "0:rule", "when it is destroyed its controller is offered a search of their deck (an optional pick)", () => {
  const { engine, id } = mamBoard();
  killMam(engine, id);
  assert.equal(zoneOf(engine, id("mam")), "discard", "it was destroyed");
  const pc = pending(engine);
  assert.ok(pc, "a search prompt is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search");
});

clause(MAM, "0:rule", "the item I pick goes to my hand: exactly one card leaves the deck, the others stay", () => {
  const { engine, id } = mamBoard();
  const handBefore = handOf(engine, P1).length;
  const deckBefore = deckOf(engine, P1).length;
  killMam(engine, id);
  const handAfterKill = handOf(engine, P1).length;
  answerPending(engine, "chooserSelectsTarget", { selected: [id("i0")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("i0")), "hand");
  assert.ok(handOf(engine, P1).includes(id("i0")), "handOf(engine, P1).includes(id(\"i0\"))");
  assert.equal(handOf(engine, P1).length, handAfterKill + 1);
  assert.equal(handAfterKill, handBefore - 1, "(the kill tactic left my hand)");
  assert.equal(deckOf(engine, P1).length, deckBefore - 1);
  assert.equal(zoneOf(engine, id("i1")), "deck", "the other item stays in the deck");
});

for (const key of ["i0", "i1"]) {
  clause(MAM, "0:rule", `any item in the deck can be found (${key}${key === "i1" ? ", a gear item" : ""})`, () => {
    const { engine, id } = mamBoard();
    killMam(engine, id);
    answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] });
    assert.equal(zoneOf(engine, id(key)), "hand");
  });
}

clause(MAM, "0:rule", "the found item is revealed to everyone before it goes to my hand", () => {
  const { engine, id } = mamBoard();
  killMam(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("i1")] });
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("i1")], "the item I found");
  assert.equal(ev.viewerId, "all", "revealed to everyone");
});

clause(MAM, "0:rule", "'you MAY search': I can find nothing; then no card moves to my hand and no item leaves the deck", () => {
  const { engine, id } = mamBoard();
  killMam(engine, id);
  const handBefore = [...handOf(engine, P1)];
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), handBefore);
  assert.equal(zoneOf(engine, id("i0")), "deck");
  assert.equal(zoneOf(engine, id("i1")), "deck");
});

clause(MAM, "0:rule", "only an ITEM can be found: a character, tactic, location or resource card in the deck is refused", () => {
  const { engine, id } = mamBoard();
  killMam(engine, id);
  refused(tryPick(engine, P1, [id("c0")]), "a character");
  refused(tryPick(engine, P1, [id("t0")]), "a tactic");
  refused(tryPick(engine, P1, [id("l0")]), "a location");
  refused(tryPick(engine, P1, [id("r0")]), "a resource card");
  assert.ok(pending(engine), "the prompt stays open");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("i0")] });
  assert.equal(zoneOf(engine, id("i0")), "hand", "control: an item is accepted");
});

clause(MAM, "0:rule", "only from MY deck: the opponent's deck item, my discard pile, my hand and the item in play are refused", () => {
  const { engine, id } = mamBoard();
  killMam(engine, id);
  refused(tryPick(engine, P1, [id("oi0")]), "an item in the opponent's deck");
  refused(tryPick(engine, P1, [id("dItem")]), "an item in my discard pile");
  refused(tryPick(engine, P1, [id("hItem")]), "an item in my hand");
  refused(tryPick(engine, P1, [id("playItem")]), "an item in play");
  refused(tryPick(engine, P1, [id("oHandItem")]), "an item in the opponent's hand");
  refused(tryPick(engine, P1, [id("oDiscItem")]), "an item in the opponent's discard pile");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("i1")] });
  assert.equal(zoneOf(engine, id("i1")), "hand", "control");
});

clause(MAM, "0:rule", "only ONE item: two are refused", () => {
  const { engine, id } = mamBoard();
  killMam(engine, id);
  refused(tryPick(engine, P1, [id("i0"), id("i1")]), "two items");
  assert.equal(zoneOf(engine, id("i0")), "deck");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("i0")] });
  assert.equal(zoneOf(engine, id("i1")), "deck");
});

clause(MAM, "0:rule", "the deck is shuffled afterwards (CR 312.1): the same remaining cards in a new order", () => {
  const { engine, id } = mamBoard({ random: () => 0 });
  const unshuffled = deckOf(engine, P1).filter((c) => c !== id("i1"));
  killMam(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("i1")] });
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(unshuffled, 0), "and they were shuffled");
});

clause(MAM, "0:rule", "the deck is shuffled also when I search and take nothing (CR 312.2: failing a search still shuffles)", () => {
  const { engine, id } = mamBoard({ random: () => 0 });
  const unshuffled = [...deckOf(engine, P1)];
  killMam(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "searched decks are shuffled whether or not a card was found");
});

clause(MAM, "0:rule", "the deck is shuffled afterwards (CR 312.1) even when there is no item in it to find", () => {
  const { engine, id } = mamBoard({ items: 0, random: () => 0 });
  const unshuffled = [...deckOf(engine, P1)];
  killMam(engine, id);
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "the deck was searched, so it is shuffled even though there was no item");
});

clause(MAM, "0:rule", "with no item in the deck it resolves cleanly: no stuck prompt and nothing is added to the hand", () => {
  const { engine, id } = mamBoard({ items: 0 });
  killMam(engine, id);
  const handAfterKill = handOf(engine, P1).length;
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handOf(engine, P1).length, handAfterKill);
  assert.equal(zoneOf(engine, id("mam")), "discard");
});

clause(MAM, "0:rule", "the opponent's deck, hand and discard pile are untouched", () => {
  const { engine, id } = mamBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  const oppDiscard = [...discardOf(engine, P2)];
  killMam(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("i0")] });
  assert.deepEqual(deckOf(engine, P2), oppDeck, "not even shuffled");
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(discardOf(engine, P2), oppDiscard);
});

clause(MAM, "0:rule", "destroyed by the opponent on their turn, it still triggers for me", () => {
  const { engine, id } = mamBoard({ turn: 2, active: P2, extra: [{ key: "theirKill", def: killAny("character"), owner: P2, zone: "hand" }] });
  play(engine, P2, id("theirKill"), { selected: { t: [id("mam")] } });
  const pc = pending(engine);
  assert.ok(pc, "I am offered the search");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("i0")] });
  assert.equal(zoneOf(engine, id("i0")), "hand");
});

clause(MAM, "0:rule", "destroyed in a battle it triggers too", () => {
  const { engine, id } = mamBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Raider", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" }] });
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("mam")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("mam")), "discard", "1 life against 3 damage");
  const pc = pending(engine);
  assert.ok(pc, "the search is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("i1")] });
  assert.equal(zoneOf(engine, id("i1")), "hand");
});

clause(MAM, "0:rule", "only 'destroyed' counts: put into its owner's hand, removed from the game, or turned face-down it does not search", () => {
  for (const [tacticKey, expectedZone] of [
    ["bounce", "hand"],
    ["exile", "removed"],
    ["flip", "play"]
  ] as const) {
    const { engine, id } = mamBoard();
    play(engine, P1, id(tacticKey), { selected: { t: [id("mam")] } });
    assert.equal(zoneOf(engine, id("mam")), expectedZone, tacticKey);
    assert.equal(engine.state.pendingChoice, undefined, `${tacticKey}: no search`);
    assert.equal(zoneOf(engine, id("i0")), "deck");
  }
});

clause(MAM, "0:rule", "only 'this card': another Multi-Attachment Man or any other character being destroyed does not trigger it", () => {
  const { engine, id } = mamBoard({ extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("other")] } });
  assert.equal(zoneOf(engine, id("other")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("mam")), "play");
});

clause(MAM, "0:rule", "two of them: destroying one searches once, for the destroyed copy's controller", () => {
  const { engine, id } = mamBoard({ extra: [{ key: "mam2", def: printing(MAM), owner: P1, zone: "play" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("mam2")] } });
  const seen = drainRecording(engine, picking([id("i0")]));
  assert.equal(seen.filter((entry) => entry === "p1:chooserSelectsTarget").length, 1, "one search");
  assert.equal(zoneOf(engine, id("mam")), "play", "the other copy is untouched");
  assert.equal(zoneOf(engine, id("i0")), "hand");
});

clause(MAM, "0:rule", "a face-down Multi-Attachment Man is only a resource with no rules text (CR 411.1): destroying it searches nothing", () => {
  const { engine, id } = mamBoard({ faceDown: true, extra: [{ key: "killRes", def: killAny("resource"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("killRes"), { selected: { t: [id("mam")] } });
  assert.equal(zoneOf(engine, id("mam")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("i0")), "deck");
});

clause(MAM, "0:rule", "'you' is its controller: a copy I own but the opponent controls lets THEM search THEIR deck", () => {
  const { engine, id } = mamBoard({ controller: P2 });
  const myDeck = [...deckOf(engine, P1)];
  killMam(engine, id);
  const pc = pending(engine);
  assert.ok(pc, "a search is offered");
  assert.equal(pc.playerId, P2, "the copy's controller searches");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oi0")] });
  assert.equal(zoneOf(engine, id("oi0")), "hand");
  assert.ok(handOf(engine, P2).includes(id("oi0")), "their item went to their hand");
  assert.equal(zoneOf(engine, id("mam")), "discard");
  assert.deepEqual(deckOf(engine, P1), myDeck, "my deck was not searched");
});

clause(MAM, "0:rule", "in the hand or discard pile it never triggers: discarding it from my hand searches nothing", () => {
  const discardIt = tactic({
    name: "Discard It",
    cost: 0,
    behavior: {
      abilities: [{ id: "di", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }]
    }
  });
  const { engine, id } = mamBoard({ mam: "hand", extra: [{ key: "di", def: discardIt, owner: P1, zone: "hand" }] });
  play(engine, P1, id("di"), { selected: { t: [id("mam")] } });
  assert.equal(zoneOf(engine, id("mam")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

// =================================================================================
// Mysterious Invasion
// OVERWHELM -- COST: Deplete this card. Destroy 2 characters you control. Pick a character.
//           -- EFFECT: Destroy the character.
// Item, cost 1, [E].
// =================================================================================

const INVASION = "4a1b7a38-e010-4d55-9ba4-5d5ebacc4775";

interface MiOpts {
  mi?: "play" | "hand" | "discard";
  faceDown?: boolean;
  depleted?: boolean;
  active?: PlayerId;
  turn?: number;
  extra?: CardPlacement[];
}

/**
 * P1: mi (the item), c0, c1, c2 (characters), borrowed (owned by P2, controlled by P1), lent (owned by P1, controlled by P2), thing (item), fd (face-down).
 * P2: f0, f1 (characters), foeThing (item), foePlace (location), fdFoe (face-down). Cards in hands / discard piles: mh, oc, dc.
 */
function miBoard(o: MiOpts = {}) {
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mi", def: printing(INVASION), owner: P1, zone: o.mi ?? "play", faceDown: o.faceDown, depleted: o.depleted },
      { key: "c0", def: character({ name: "Mine0" }), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" },
      { key: "thing", def: item({ name: "MyThing" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
      { key: "f0", def: character({ name: "Foe0", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "f1", def: character({ name: "Foe1" }), owner: P2, zone: "play" },
      { key: "foeThing", def: item({ name: "FoeThing" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "fdFoe", def: character({ name: "FaceDownFoe" }), owner: P2, zone: "play", faceDown: true },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OppHandChar" }), owner: P2, zone: "hand" },
      { key: "dc", def: character({ name: "MyDiscardChar" }), owner: P1, zone: "discard" },
      ...(o.extra ?? [])
    ]
  });
}

const overwhelmRaw = (engine: SpoilsEngine, id: IdOf, kill: CardInstanceId[], fodder: CardInstanceId[], player: PlayerId = P1, key = "mi") =>
  engine.perform({ type: "activateAbility", playerId: player, cardId: id(key), abilityId: "overwhelm", selected: { kill, fodder }, variables: {} } as never);

const overwhelm = (engine: SpoilsEngine, id: IdOf, kill: CardInstanceId[], fodder: CardInstanceId[], player: PlayerId = P1, key = "mi") => {
  overwhelmRaw(engine, id, kill, fodder, player, key);
  resolvePendingResponses(engine);
};

clause(INVASION, "0:ability:overwhelm", "deploys for exactly its printed cost of 1 and threshold [E]; it is an item with no subtype", () => {
  deployChecks(INVASION, { cost: 1, icon: "elitism", icons: 1, type: "item" });
  const { engine, id } = miBoard();
  assert.deepEqual([...engine.getDefinition(id("mi")).subtype], []);
});

clause(INVASION, "0:ability:overwhelm", "the costs are paid: the item is depleted and exactly the two chosen characters of mine are destroyed (into their owner's discard pile)", () => {
  const { engine, id } = miBoard();
  assert.equal(isDepleted(engine, id("mi")), false);
  overwhelm(engine, id, [id("f0")], [id("c0"), id("c1")]);
  assert.equal(isDepleted(engine, id("mi")), true, "depleted by its cost");
  assert.equal(zoneOf(engine, id("c0")), "discard");
  assert.equal(zoneOf(engine, id("c1")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("c0")) && discardOf(engine, P1).includes(id("c1")), "discardOf(engine, P1).includes(id(\"c0\")) && discardOf(engine, P1).includes(id(\"c1\"))");
  assert.equal(zoneOf(engine, id("c2")), "play", "an unchosen character of mine survives");
  assert.equal(zoneOf(engine, id("mi")), "play", "the item itself stays in play");
});

clause(INVASION, "0:ability:overwhelm", "the effect destroys the picked opposing character (into its owner's discard pile) and nothing else of theirs", () => {
  const { engine, id } = miBoard();
  overwhelm(engine, id, [id("f0")], [id("c0"), id("c1")]);
  assert.equal(zoneOf(engine, id("f0")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("f0")), "discardOf(engine, P2).includes(id(\"f0\"))");
  assert.equal(zoneOf(engine, id("f1")), "play");
  assert.equal(zoneOf(engine, id("foeThing")), "play");
  assert.equal(zoneOf(engine, id("foePlace")), "play");
});

clause(INVASION, "0:ability:overwhelm", "the picked character can be one of mine that is not among the two destroyed", () => {
  const { engine, id } = miBoard();
  overwhelm(engine, id, [id("c2")], [id("c0"), id("c1")]);
  assert.equal(zoneOf(engine, id("c2")), "discard");
  assert.equal(zoneOf(engine, id("f0")), "play");
});

clause(INVASION, "0:ability:overwhelm", "it costs no resources", () => {
  const { engine, id } = miBoard({ extra: res({ elitism: 3 }) });
  const before = ready(engine);
  overwhelm(engine, id, [id("f0")], [id("c0"), id("c1")]);
  assert.equal(ready(engine), before);
});

clause(INVASION, "0:ability:overwhelm", "exactly two characters must be destroyed: none, one or three are refused and nothing is paid", () => {
  const { engine, id } = miBoard();
  refused(() => overwhelmRaw(engine, id, [id("f0")], []), "no characters");
  refused(() => overwhelmRaw(engine, id, [id("f0")], [id("c0")]), "one character");
  refused(() => overwhelmRaw(engine, id, [id("f0")], [id("c0"), id("c1"), id("c2")]), "three characters");
  assert.equal(isDepleted(engine, id("mi")), false, "the item was not depleted");
  for (const key of ["c0", "c1", "c2", "f0"]) assert.equal(zoneOf(engine, id(key)), "play", key);
  overwhelmRaw(engine, id, [id("f0")], [id("c0"), id("c1")]);
  assert.equal(isDepleted(engine, id("mi")), true, "control: two characters are accepted");
});

clause(INVASION, "0:ability:overwhelm", "the two destroyed must be different characters", () => {
  const { engine, id } = miBoard();
  refused(() => overwhelmRaw(engine, id, [id("f0")], [id("c0"), id("c0")]), "the same character twice");
  assert.equal(zoneOf(engine, id("c0")), "play");
  assert.equal(isDepleted(engine, id("mi")), false);
});

clause(INVASION, "0:ability:overwhelm", "the two destroyed must be characters I control: the opponent's are refused", () => {
  const { engine, id } = miBoard();
  refused(() => overwhelmRaw(engine, id, [id("c2")], [id("f0"), id("f1")]), "two opposing characters");
  refused(() => overwhelmRaw(engine, id, [id("c2")], [id("c0"), id("f1")]), "one of mine and one opposing character");
  assert.equal(zoneOf(engine, id("f0")), "play");
  assert.equal(zoneOf(engine, id("f1")), "play");
  assert.equal(zoneOf(engine, id("c0")), "play");
  assert.equal(isDepleted(engine, id("mi")), false);
});

clause(INVASION, "0:ability:overwhelm", "'you control', not 'you own': a character I control but the opponent owns can be destroyed as the cost (it goes to its owner's discard pile)", () => {
  const { engine, id } = miBoard();
  overwhelm(engine, id, [id("f0")], [id("borrowed"), id("c0")]);
  assert.equal(zoneOf(engine, id("borrowed")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("borrowed")), "in its owner's discard pile");
  assert.equal(zoneOf(engine, id("c0")), "discard");
});

clause(INVASION, "0:ability:overwhelm", "a character I own but the opponent controls cannot be destroyed as the cost", () => {
  const { engine, id } = miBoard();
  refused(() => overwhelmRaw(engine, id, [id("f0")], [id("lent"), id("c0")]), "I do not control it");
  assert.equal(zoneOf(engine, id("lent")), "play");
  assert.equal(isDepleted(engine, id("mi")), false);
});

clause(INVASION, "0:ability:overwhelm", "only characters can be destroyed as the cost: my item, my face-down card and cards outside play are refused", () => {
  const { engine, id } = miBoard();
  refused(() => overwhelmRaw(engine, id, [id("f0")], [id("thing"), id("c0")]), "my item");
  refused(() => overwhelmRaw(engine, id, [id("f0")], [id("fd"), id("c0")]), "my face-down card (only a resource)");
  refused(() => overwhelmRaw(engine, id, [id("f0")], [id("mh"), id("c0")]), "a character in my hand");
  refused(() => overwhelmRaw(engine, id, [id("f0")], [id("dc"), id("c0")]), "a character in my discard pile");
  refused(() => overwhelmRaw(engine, id, [id("f0")], [factionOf(engine, P1), id("c0")]), "my faction");
  assert.equal(zoneOf(engine, id("thing")), "play");
  assert.equal(zoneOf(engine, id("fd")), "play");
  assert.equal(isDepleted(engine, id("mi")), false);
});

clause(INVASION, "0:ability:overwhelm", "a character must be picked: none or two are refused", () => {
  const { engine, id } = miBoard();
  refused(() => overwhelmRaw(engine, id, [], [id("c0"), id("c1")]), "no pick");
  refused(() => overwhelmRaw(engine, id, [id("f0"), id("f1")], [id("c0"), id("c1")]), "two picks");
  assert.equal(zoneOf(engine, id("c0")), "play", "nothing was destroyed by a refused attempt");
  assert.equal(isDepleted(engine, id("mi")), false);
});

clause(INVASION, "0:ability:overwhelm", "the pick must be a character in play: an item, a location, factions, a face-down card and cards outside play are refused", () => {
  const { engine, id } = miBoard();
  for (const [what, target] of [
    ["an opposing item", id("foeThing")],
    ["a location", id("foePlace")],
    ["their faction", factionOf(engine, P2)],
    ["my faction", factionOf(engine, P1)],
    ["a face-down card", id("fdFoe")],
    ["a character in a hand", id("oc")],
    ["a character in my discard pile", id("dc")]
  ] as const) {
    refused(() => overwhelmRaw(engine, id, [target], [id("c0"), id("c1")]), what);
  }
  assert.equal(zoneOf(engine, id("c0")), "play");
  assert.equal(isDepleted(engine, id("mi")), false);
  overwhelmRaw(engine, id, [id("f0")], [id("c0"), id("c1")]);
  assert.ok(engine.state.responseWindow, "control: a character in play is accepted");
});

clause(INVASION, "0:ability:overwhelm", "a character destroyed as the cost is gone before the pick, so it cannot also be the picked character (costs are satisfied in printed order)", () => {
  const { engine, id } = miBoard();
  refused(() => overwhelmRaw(engine, id, [id("c0")], [id("c0"), id("c1")]), "the same card destroyed as the cost and then picked");
  assert.equal(zoneOf(engine, id("c0")), "play");
  assert.equal(isDepleted(engine, id("mi")), false);
});

clause(INVASION, "0:ability:overwhelm", "with only two characters of mine in play, both are destroyed and the pick must be an opposing character", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mi", def: printing(INVASION), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  overwhelm(engine, id, [id("foe")], [id("a"), id("b")]);
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("a")), "discard");
  assert.equal(zoneOf(engine, id("b")), "discard");
});

clause(INVASION, "0:ability:overwhelm", "with fewer than two characters of mine it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mi", def: printing(INVASION), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2" }), owner: P2, zone: "play" }
    ]
  });
  refused(() => overwhelmRaw(engine, id, [id("foe")], [id("a")]), "one character of mine");
  refused(() => overwhelmRaw(engine, id, [id("foe")], [id("a"), id("foe2")]), "an opposing character as the second");
  assert.equal(isDepleted(engine, id("mi")), false);
  assert.equal(zoneOf(engine, id("a")), "play");
});

clause(INVASION, "0:ability:overwhelm", "it cannot be used while depleted; once restored it can be used again", () => {
  const { engine, id } = miBoard();
  overwhelm(engine, id, [id("f0")], [id("c0"), id("c1")]);
  refused(() => overwhelmRaw(engine, id, [id("f1")], [id("c2"), id("borrowed")]), "already depleted");
  assert.equal(zoneOf(engine, id("f1")), "play");
  assert.equal(zoneOf(engine, id("c2")), "play");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(isDepleted(engine, id("mi")), false, "restored at the start of my turn");
  overwhelm(engine, id, [id("f1")], [id("c2"), id("borrowed")]);
  assert.equal(zoneOf(engine, id("f1")), "discard");
});

clause(INVASION, "0:ability:overwhelm", "an item that starts depleted cannot be used", () => {
  const { engine, id } = miBoard({ depleted: true });
  refused(() => overwhelmRaw(engine, id, [id("f0")], [id("c0"), id("c1")]), "depleted");
  assert.equal(zoneOf(engine, id("c0")), "play");
});

clause(INVASION, "0:ability:overwhelm", "only its controller can use it", () => {
  const { engine, id } = miBoard({ turn: 2, active: P2 });
  refused(() => overwhelmRaw(engine, id, [id("c0")], [id("f0"), id("f1")], P2), "the opponent's turn: not their item");
  assert.equal(zoneOf(engine, id("c0")), "play");
  assert.equal(isDepleted(engine, id("mi")), false);
});

clause(INVASION, "0:ability:overwhelm", "it can only be used while in play, and a face-down copy is just a resource with no rules text (CR 411.1)", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = miBoard({ mi: zone });
    refused(() => overwhelmRaw(engine, id, [id("f0")], [id("c0"), id("c1")]), zone);
  }
  const fd = miBoard({ faceDown: true });
  refused(() => overwhelmRaw(fd.engine, fd.id, [fd.id("f0")], [fd.id("c0"), fd.id("c1")]), "face-down");
  assert.equal(zoneOf(fd.engine, fd.id("c0")), "play");
});

clause(INVASION, "0:ability:overwhelm", "it is an ability: it can be used in response on the opponent's turn, e.g. to destroy their attacker", () => {
  const { engine, id } = miBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(engine, P2, [id("f0")]);
  overwhelmRaw(engine, id, [id("f0")], [id("c0"), id("c1")]);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("f0")), "discard", "the attacker is destroyed");
  assert.equal(zoneOf(engine, id("c0")), "discard");
  assert.equal(zoneOf(engine, id("c1")), "discard");
  assert.equal(isDepleted(engine, id("mi")), true);
});

clause(INVASION, "0:ability:overwhelm", "the costs are already paid when responses come: if the picked character is destroyed in response, my two characters stay destroyed and the item stays depleted", () => {
  const { engine, id } = miBoard({ extra: [{ key: "theirKill", def: killAny("character"), owner: P2, zone: "hand" }] });
  overwhelmRaw(engine, id, [id("f0")], [id("c0"), id("c1")]);
  assert.equal(zoneOf(engine, id("c0")), "discard", "(cost paid at activation)");
  assert.equal(isDepleted(engine, id("mi")), true);
  engine.perform({ type: "playCard", playerId: P2, cardId: id("theirKill"), selected: { t: [id("f0")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("f0")), "discard");
  assert.equal(engine.state.pendingChoice, undefined, "nothing breaks");
  assert.equal(zoneOf(engine, id("c2")), "play");
});

clause(INVASION, "0:ability:overwhelm", "a character destroyed as the cost still counts as destroyed: Multi-Attachment Man's search triggers for me", () => {
  const { engine, id } = miBoard({
    extra: [
      { key: "mam", def: printing(MAM), owner: P1, zone: "play" },
      { key: "deckItem", def: item({ name: "Deck Item" }), owner: P1, zone: "deck" }
    ]
  });
  overwhelmRaw(engine, id, [id("f0")], [id("mam"), id("c0")]);
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "the search is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("deckItem")] });
  assert.equal(zoneOf(engine, id("deckItem")), "hand");
  assert.equal(zoneOf(engine, id("f0")), "discard", "and the effect still destroyed the picked character");
});

clause(INVASION, "0:ability:overwhelm", "destroying the picked character triggers its 'if destroyed' text too: Multi-Attachment Man picked as the target searches for its controller", () => {
  const { engine, id } = miBoard({
    extra: [
      { key: "foeMam", def: printing(MAM), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "Foe Deck Item" }), owner: P2, zone: "deck" }
    ]
  });
  overwhelmRaw(engine, id, [id("foeMam")], [id("c0"), id("c1")]);
  resolvePendingResponses(engine);
  const pc = pending(engine);
  assert.ok(pc, "the opponent is offered the search");
  assert.equal(pc.playerId, P2);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("foeItem")] });
  assert.equal(zoneOf(engine, id("foeItem")), "hand");
});

// =================================================================================
// Jocular Stupefaction
// COST: Pick a character with COVERT. -- EFFECT: Destroy the character.
// FLIP UP: 3 [E]
// Tactic, cost 3, [E].
// =================================================================================

const JOCULAR = "f8fbc218-d0fc-4880-9aa6-2068ae358079";

interface JsOpts {
  js?: "hand" | "faceDown" | "play" | "discard";
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * P1: js; mineCovert (COVERT), mine (plain). P2: foeCovert, foeCovert2 (COVERT), foe (plain), foeThing (item), foePlace (location), fdCovert (face-down),
 * ocCovert (COVERT character in hand), dcCovert (COVERT character in a discard pile); P2 also holds a real Essence of Elitism (ee2) and has [E][E].
 */
function jsBoard(o: JsOpts = {}) {
  const where = o.js ?? "hand";
  const covertKeyword: Partial<CardDefinition> = { behavior: { keywords: ["covert"] } };
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "js", def: printing(JOCULAR), owner: P1, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      { key: "mineCovert", def: character({ name: "MineCovert", strength: 2, life: 3, speed: 2, ...covertKeyword }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeCovert", def: character({ name: "FoeCovert", strength: 2, life: 3, speed: 2, ...covertKeyword }), owner: P2, zone: "play" },
      { key: "foeCovert2", def: character({ name: "FoeCovert2", strength: 2, life: 3, speed: 2, ...covertKeyword }), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeThing", def: item({ name: "FoeThing" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "fdCovert", def: character({ name: "FaceDownCovert", ...covertKeyword }), owner: P2, zone: "play", faceDown: true },
      { key: "ocCovert", def: character({ name: "OppHandCovert", ...covertKeyword }), owner: P2, zone: "hand" },
      { key: "dcCovert", def: character({ name: "DiscardCovert", ...covertKeyword }), owner: P1, zone: "discard" },
      { key: "ee2", def: printing(ESSENCE), owner: P2, zone: "hand" },
      ...res(o.icons ?? { elitism: 4 }),
      ...res({ elitism: 2 }, P2),
      ...(o.extra ?? [])
    ]
  });
}

const jsPlayRaw = (engine: SpoilsEngine, id: IdOf, target?: CardInstanceId) => playRaw(engine, P1, id("js"), { selected: target ? { c: [target] } : {} });
const jsPlay = (engine: SpoilsEngine, id: IdOf, target: CardInstanceId) => play(engine, P1, id("js"), { selected: { c: [target] } });
const jsFlip = (engine: SpoilsEngine, id: IdOf, target?: CardInstanceId, player: PlayerId = P1) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId: id("js"), selected: target ? { c: [target] } : {}, variables: {} });

clause(JOCULAR, "0:ability", "pays exactly 3, destroys the picked COVERT character (an opposing one) into its owner's discard pile and nothing else", () => {
  const { engine, id } = jsBoard();
  const before = ready(engine);
  jsPlay(engine, id, id("foeCovert"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3");
  assert.equal(zoneOf(engine, id("foeCovert")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("foeCovert")), "discardOf(engine, P2).includes(id(\"foeCovert\"))");
  for (const key of ["foeCovert2", "foe", "mineCovert", "mine", "foeThing", "foePlace"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} stays`);
  assert.equal(zoneOf(engine, id("js")), "discard", "the tactic ends in its owner's discard pile");
});

clause(JOCULAR, "0:ability", "my own COVERT character can be picked and is destroyed", () => {
  const { engine, id } = jsBoard();
  jsPlay(engine, id, id("mineCovert"));
  assert.equal(zoneOf(engine, id("mineCovert")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("mineCovert")), "discardOf(engine, P1).includes(id(\"mineCovert\"))");
  assert.equal(zoneOf(engine, id("foeCovert")), "play");
});

clause(JOCULAR, "0:ability", "the pick must HAVE COVERT: a plain character (theirs or mine) is refused and nothing is paid", () => {
  const { engine, id } = jsBoard();
  refused(() => jsPlayRaw(engine, id, id("foe")), "an opposing character without COVERT");
  refused(() => jsPlayRaw(engine, id, id("mine")), "my own character without COVERT");
  assert.equal(zoneOf(engine, id("js")), "hand");
  assert.equal(ready(engine), 4, "nothing was paid");
  assert.equal(zoneOf(engine, id("foe")), "play");
  jsPlayRaw(engine, id, id("foeCovert"));
  assert.ok(engine.state.responseWindow, "control: a COVERT character is accepted");
});

clause(JOCULAR, "0:ability", "COVERT granted by another effect counts: after a plain character is given COVERT this turn it can be picked", () => {
  const { engine, id } = jsBoard({ extra: [{ key: "grant", def: grantCovert(), owner: P1, zone: "hand" }] });
  refused(() => jsPlayRaw(engine, id, id("foe")), "before the grant");
  play(engine, P1, id("grant"), { selected: { t: [id("foe")] } });
  jsPlay(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(JOCULAR, "0:ability", "a character that lost COVERT this turn (Essence of Elitism, option 2) can no longer be picked", () => {
  const { engine, id } = jsBoard({ icons: { elitism: 6 }, extra: [{ key: "myEssence", def: printing(ESSENCE), owner: P1, zone: "hand" }] });
  play(engine, P1, id("myEssence"), { mode: 1, selected: { c: [id("foeCovert")] } });
  assert.equal(engine.getKeywords(id("foeCovert")).includes("covert"), false);
  refused(() => jsPlayRaw(engine, id, id("foeCovert")), "no COVERT right now");
  jsPlay(engine, id, id("foeCovert2"));
  assert.equal(zoneOf(engine, id("foeCovert2")), "discard", "control: another character with COVERT");
  assert.equal(zoneOf(engine, id("foeCovert")), "play");
});

clause(JOCULAR, "0:ability", "the pick is a cost, the destruction is the effect: if the picked character loses COVERT in response it is destroyed anyway", () => {
  const { engine, id } = jsBoard();
  jsPlayRaw(engine, id, id("foeCovert"));
  engine.perform({ type: "playCard", playerId: P2, cardId: id("ee2"), mode: 1, selected: { c: [id("foeCovert")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ee2")), "discard", "their Essence resolved");
  assert.equal(zoneOf(engine, id("foeCovert")), "discard", "the character I picked is destroyed");
});

clause(JOCULAR, "0:ability", "only a character in play can be picked: an item, a location, factions, a face-down card and characters in a hand or discard pile are refused", () => {
  const { engine, id } = jsBoard();
  for (const [what, target] of [
    ["an item", id("foeThing")],
    ["a location", id("foePlace")],
    ["their faction", factionOf(engine, P2)],
    ["my faction", factionOf(engine, P1)],
    ["a face-down card (its COVERT is not rules text while face-down)", id("fdCovert")],
    ["a COVERT character in their hand", id("ocCovert")],
    ["a COVERT character in my discard pile", id("dcCovert")]
  ] as const) {
    refused(() => jsPlayRaw(engine, id, target), what);
  }
  assert.equal(zoneOf(engine, id("js")), "hand");
  assert.equal(ready(engine), 4);
});

clause(JOCULAR, "0:ability", "exactly one character: none or two are refused", () => {
  const { engine, id } = jsBoard();
  refused(() => jsPlayRaw(engine, id, undefined), "no pick");
  refused(() => playRaw(engine, P1, id("js"), { selected: { c: [] } }), "an empty pick");
  refused(() => playRaw(engine, P1, id("js"), { selected: { c: [id("foeCovert"), id("foeCovert2")] } }), "two picks");
  assert.equal(zoneOf(engine, id("js")), "hand");
  assert.equal(zoneOf(engine, id("foeCovert")), "play");
  assert.equal(zoneOf(engine, id("foeCovert2")), "play");
});

clause(JOCULAR, "0:ability", "with no COVERT character in play it cannot be played at all", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "js", def: printing(JOCULAR), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "play" },
      ...res({ elitism: 3 })
    ]
  });
  refused(() => playRaw(engine, P1, id("js"), { selected: { c: [id("plain")] } }), "nothing to pick");
  refused(() => playRaw(engine, P1, id("js"), { selected: {} }), "no pick");
  assert.equal(ready(engine), 3);
});

clause(JOCULAR, "0:ability", "if the picked character is destroyed in response, the tactic still ends in my discard pile and nothing breaks", () => {
  const { engine, id } = jsBoard({ extra: [{ key: "theirKill", def: killAny("character"), owner: P2, zone: "hand" }] });
  jsPlayRaw(engine, id, id("foeCovert"));
  engine.perform({ type: "playCard", playerId: P2, cardId: id("theirKill"), selected: { t: [id("foeCovert")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foeCovert")), "discard");
  assert.equal(zoneOf(engine, id("js")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("foeCovert2")), "play", "nothing else was destroyed");
});

clause(JOCULAR, "0:ability", "needs [E] and exactly 3 resources: refused with 2, refused without [E], accepted with one [E] among others", () => {
  const exact = jsBoard({ icons: { elitism: 3 } });
  jsPlay(exact.engine, exact.id, exact.id("foeCovert"));
  assert.equal(zoneOf(exact.engine, exact.id("foeCovert")), "discard");
  assert.equal(ready(exact.engine), 0);
  const short = jsBoard({ icons: { elitism: 2 } });
  refused(() => jsPlayRaw(short.engine, short.id, short.id("foeCovert")), "2 resources");
  const noE = jsBoard({ icons: { rage: 6 } });
  refused(() => jsPlayRaw(noE.engine, noE.id, noE.id("foeCovert")), "plenty of resources but no [E]");
  const oneE = jsBoard({ icons: { elitism: 1, rage: 2 } });
  jsPlay(oneE.engine, oneE.id, oneE.id("foeCovert"));
  assert.equal(zoneOf(oneE.engine, oneE.id("foeCovert")), "discard", "one [E] among three resources is enough");
});

clause(JOCULAR, "0:ability", "it is a tactic: usable in response on the opponent's turn, e.g. to destroy their COVERT attacker", () => {
  const { engine, id } = jsBoard({ turn: 2, active: P2 });
  refused(() => jsPlayRaw(engine, id, id("foeCovert")), "no window yet");
  declareAttackOpenWindow(engine, P2, [id("foeCovert")]);
  jsPlayRaw(engine, id, id("foeCovert"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foeCovert")), "discard");
  assert.equal(zoneOf(engine, id("js")), "discard");
});

clause(JOCULAR, "0:ability", "the destruction is real destruction: damage on the victim is irrelevant and a destroyed character's attached item goes with it", () => {
  const { engine, id } = jsBoard({ extra: [{ key: "pep", def: printing(BLAND_PEPPER), owner: P2, zone: "play", attachedToKey: "foeCovert" }] });
  jsPlay(engine, id, id("foeCovert"));
  assert.equal(zoneOf(engine, id("foeCovert")), "discard");
  assert.equal(zoneOf(engine, id("pep")), "discard", "the attached item leaves play with its host (CR 301.4)");
});

// --- FLIP UP: 3 [E] ------------------------------------------------------------------

clause(JOCULAR, "1:flipUp", "face-down in play it is a resource: one Volition, in the resource pool", () => {
  const { engine, id } = jsBoard({ js: "faceDown", icons: { elitism: 2 } });
  assert.equal(engine.isResource(id("js")), true);
  assert.equal(ready(engine), 3, "two [E] plus the face-down Jocular Stupefaction");
  assert.equal(engine.getThresholds(P1).volition, 1);
});

clause(JOCULAR, "1:flipUp", "flipping it up resolves the tactic: the picked COVERT character is destroyed and the card ends in my discard pile", () => {
  const { engine, id } = jsBoard({ js: "faceDown", icons: { elitism: 4 } });
  jsFlip(engine, id, id("foeCovert"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foeCovert")), "discard");
  assert.equal(zoneOf(engine, id("js")), "discard", "a flipped-up tactic goes to its owner's discard pile when it has resolved");
  assert.equal(engine.state.cards[id("js")].faceDown, false);
  for (const key of ["foeCovert2", "mineCovert", "foe", "mine"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} stays`);
});

clause(JOCULAR, "1:flipUp", "it pays the FLIP UP cost of 3 (the card can be one of the three)", () => {
  const { engine, id } = jsBoard({ js: "faceDown", icons: { elitism: 6 } });
  const before = ready(engine);
  assert.equal(before, 7, "six [E] plus the face-down card");
  jsFlip(engine, id, id("foeCovert"));
  resolvePendingResponses(engine);
  const after = ready(engine);
  // The card stops being a resource (-1) and 3 resources are paid; the paid ones may include the card itself (CR 507.4b), so 3 or 4 remain.
  assert.ok(after === 3 || after === 4, `expected 3 or 4 resources left (3 paid), got ${after}`);
});

clause(JOCULAR, "1:flipUp", "the cost is exactly 3: two [E] plus the card itself is enough, one [E] plus itself is refused", () => {
  const enough = jsBoard({ js: "faceDown", icons: { elitism: 2 } });
  jsFlip(enough.engine, enough.id, enough.id("foeCovert"));
  resolvePendingResponses(enough.engine);
  assert.equal(zoneOf(enough.engine, enough.id("foeCovert")), "discard");
  const short = jsBoard({ js: "faceDown", icons: { elitism: 1 } });
  refused(() => jsFlip(short.engine, short.id, short.id("foeCovert")), "two resources for a cost of 3");
  assert.equal(short.engine.state.cards[short.id("js")].faceDown, true);
  assert.equal(ready(short.engine), 2, "nothing was paid");
});

clause(JOCULAR, "1:flipUp", "FLIP UP needs [E]: many other resources without [E] are refused, one [E] is enough", () => {
  const none = jsBoard({ js: "faceDown", icons: { rage: 6 } });
  refused(() => jsFlip(none.engine, none.id, none.id("foeCovert")), "no [E]");
  assert.equal(none.engine.state.cards[none.id("js")].faceDown, true);
  assert.equal(ready(none.engine), 7, "nothing was paid");
  const one = jsBoard({ js: "faceDown", icons: { elitism: 1, rage: 4 } });
  jsFlip(one.engine, one.id, one.id("foeCovert"));
  resolvePendingResponses(one.engine);
  assert.equal(zoneOf(one.engine, one.id("foeCovert")), "discard");
});

clause(JOCULAR, "1:flipUp", "the picked character must have COVERT, exactly one, and be in play: plain characters, non-characters, none and two are refused (and nothing is paid)", () => {
  const { engine, id } = jsBoard({ js: "faceDown", icons: { elitism: 5 } });
  refused(() => jsFlip(engine, id, id("foe")), "a plain opposing character");
  refused(() => jsFlip(engine, id, id("mine")), "my plain character");
  refused(() => jsFlip(engine, id, id("foeThing")), "an item");
  refused(() => jsFlip(engine, id, id("foePlace")), "a location");
  refused(() => jsFlip(engine, id, factionOf(engine, P2)), "a faction");
  refused(() => jsFlip(engine, id, id("fdCovert")), "a face-down card");
  refused(() => jsFlip(engine, id, id("ocCovert")), "a COVERT character in their hand");
  refused(() => jsFlip(engine, id, undefined), "no pick");
  refused(() => flipUpNow(engine, { type: "flipUp", playerId: P1, cardId: id("js"), selected: { c: [id("foeCovert"), id("foeCovert2")] }, variables: {} }), "two picks");
  assert.equal(engine.state.cards[id("js")].faceDown, true, "still face-down after every refusal");
  assert.equal(ready(engine), 6, "nothing was paid");
  jsFlip(engine, id, id("foeCovert"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foeCovert")), "discard", "control: a COVERT character is accepted");
});

clause(JOCULAR, "1:flipUp", "FLIP UP does not change when a tactic may be played: it can be flipped up in response on the opponent's turn, and on my own turn", () => {
  const theirs = jsBoard({ js: "faceDown", icons: { elitism: 4 }, turn: 2, active: P2 });
  refused(() => jsFlip(theirs.engine, theirs.id, theirs.id("foeCovert")), "no response window yet");
  assert.equal(theirs.engine.state.cards[theirs.id("js")].faceDown, true);
  declareAttackOpenWindow(theirs.engine, P2, [theirs.id("foeCovert")]);
  jsFlip(theirs.engine, theirs.id, theirs.id("foeCovert"));
  resolvePendingResponses(theirs.engine);
  assert.equal(zoneOf(theirs.engine, theirs.id("foeCovert")), "discard", "flipped up in response to the attack");
  const mine = jsBoard({ js: "faceDown", icons: { elitism: 4 } });
  jsFlip(mine.engine, mine.id, mine.id("foeCovert2"));
  resolvePendingResponses(mine.engine);
  assert.equal(zoneOf(mine.engine, mine.id("foeCovert2")), "discard", "and on my own turn");
});

clause(JOCULAR, "1:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const theirs = jsBoard({ js: "faceDown", icons: { elitism: 4 } });
  refused(() => jsFlip(theirs.engine, theirs.id, theirs.id("mineCovert"), P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("js")].faceDown, true);
  const inHand = jsBoard({ js: "hand", icons: { elitism: 4 } });
  refused(() => jsFlip(inHand.engine, inHand.id, inHand.id("foeCovert")), "in my hand it is not a face-down resource");
  const faceUp = jsBoard({ js: "play", icons: { elitism: 4 } });
  refused(() => jsFlip(faceUp.engine, faceUp.id, faceUp.id("foeCovert")), "face-up in play");
});

clause(JOCULAR, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const { engine, id } = jsBoard({ js: "faceDown", icons: { elitism: 4 } });
  holdFlipUp(() => jsFlip(engine, id, id("foeCovert")));
  assert.ok(engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("foeCovert")), "play", "the effect has not happened yet");
});

// =================================================================================
// Mountainous Golem
// Your opponent cannot take control of this card.
// If this card is put into your discard pile from anywhere, remove it from the game.
// FLIP UP: 13 [E][E]
// Character (mountain, golem), cost 13, [E][E], 13 strength / 1 speed / 13 life.
// =================================================================================

const MOUNTAIN = "c5262c5b-9ef2-40ed-9f16-29b391b39a11";

interface MgOpts {
  mg?: "play" | "hand" | "deck" | "faceDown" | "discard";
  owner?: PlayerId;
  controller?: PlayerId;
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/** The golem `mg` is owned by `owner` (default P1). P1: mine (plain character), P2: foe (plain character). Tactics: stealP2 (P2's hand), stealP1 (P1's hand). */
function mgBoard(o: MgOpts = {}) {
  const where = o.mg ?? "play";
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mg", def: printing(MOUNTAIN), owner: o.owner ?? P1, controller: o.controller, zone: where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "stealP2", def: stealChar(), owner: P2, zone: "hand" },
      { key: "stealP1", def: stealChar(), owner: P1, zone: "hand" },
      { key: "kill", def: killAny("character"), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceChar(), owner: P1, zone: "hand" },
      { key: "exile", def: exileChar(), owner: P1, zone: "hand" },
      ...res(o.icons ?? { elitism: 14 }),
      ...res({ elitism: 4 }, P2),
      ...(o.extra ?? [])
    ]
  });
}

const flipMg = (engine: SpoilsEngine, id: IdOf, player: PlayerId = P1) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId: id("mg"), selected: {}, variables: {} });

clause(MOUNTAIN, "0:rule", "deploys for exactly its printed cost of 13 and threshold [E][E]", () => deployChecks(MOUNTAIN, { cost: 13, icon: "elitism", icons: 2, type: "character" }));
clause(MOUNTAIN, "0:rule", "has its printed stats: 13 strength, 13 life, 1 speed; it is a mountain golem", () => {
  statsAre(MOUNTAIN, 13, 13, 1);
  const { engine, id } = mgBoard();
  assert.deepEqual([...engine.getDefinition(id("mg")).subtype].sort(), ["golem", "mountain"]);
});

// --- Your opponent cannot take control of this card ---------------------------------------

clause(MOUNTAIN, "0:rule", "the opponent's take-control effect does nothing to it: it stays under my control (control: it works on an ordinary character)", () => {
  const { engine, id } = mgBoard({ turn: 2, active: P2 });
  play(engine, P2, id("stealP2"), { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].controllerId, P2, "control: the steal works on an ordinary character");
  const second = mgBoard({ turn: 2, active: P2 });
  play(second.engine, P2, second.id("stealP2"), { selected: { t: [second.id("mg")] } });
  assert.equal(second.engine.state.cards[second.id("mg")].controllerId, P1, "the Golem stays mine");
  assert.ok(second.engine.state.players[P1].play.includes(second.id("mg")), "second.engine.state.players[P1].play.includes(second.id(\"mg\"))");
  assert.ok(!second.engine.state.players[P2].play.includes(second.id("mg")), "!second.engine.state.players[P2].play.includes(second.id(\"mg\"))");
  assert.equal(second.engine.state.pendingChoice, undefined, "nothing is stuck");
  assert.equal(zoneOf(second.engine, second.id("stealP2")), "discard", "the tactic resolved");
});

clause(MOUNTAIN, "0:rule", "a temporary take-control (until end of turn) does nothing to it either", () => {
  const timedSteal = tactic({
    name: "Mutiny",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mutiny",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller", duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const { engine, id } = mgBoard({ turn: 2, active: P2, extra: [{ key: "mutiny", def: timedSteal, owner: P2, zone: "hand" }] });
  play(engine, P2, id("mutiny"), { selected: { t: [id("mg")] } });
  assert.equal(engine.state.cards[id("mg")].controllerId, P1);
});

clause(MOUNTAIN, "0:rule", "it protects the controller's Golem whoever owns it: the opponent cannot steal back a Golem I control but they own", () => {
  const { engine, id } = mgBoard({ owner: P2, controller: P1, turn: 2, active: P2 });
  assert.equal(engine.state.cards[id("mg")].controllerId, P1, "(precondition)");
  play(engine, P2, id("stealP2"), { selected: { t: [id("mg")] } });
  assert.equal(engine.state.cards[id("mg")].controllerId, P1);
});

clause(MOUNTAIN, "0:rule", "the opponent's own Golem is protected the same way: I cannot take control of it", () => {
  const { engine, id } = mgBoard({ owner: P2 });
  play(engine, P1, id("stealP1"), { selected: { t: [id("mg")] } });
  assert.equal(engine.state.cards[id("mg")].controllerId, P2);
  assert.ok(engine.state.players[P2].play.includes(id("mg")), "engine.state.players[P2].play.includes(id(\"mg\"))");
  const control = mgBoard({ owner: P2 });
  play(control.engine, P1, control.id("stealP1"), { selected: { t: [control.id("foe")] } });
  assert.equal(control.engine.state.cards[control.id("foe")].controllerId, P1, "control: an ordinary character can be stolen");
});

clause(MOUNTAIN, "0:rule", "it does not stop me from using control effects on my own side: my own take-control of my own Golem changes nothing and breaks nothing", () => {
  const { engine, id } = mgBoard();
  play(engine, P1, id("stealP1"), { selected: { t: [id("mg")] } });
  assert.equal(engine.state.cards[id("mg")].controllerId, P1);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MOUNTAIN, "0:rule", "it is not otherwise protected: the opponent can still destroy it (it just cannot take control)", () => {
  const { engine, id } = mgBoard({ turn: 2, active: P2, extra: [{ key: "theirKill", def: killAny("character"), owner: P2, zone: "hand" }] });
  play(engine, P2, id("theirKill"), { selected: { t: [id("mg")] } });
  assert.notEqual(zoneOf(engine, id("mg")), "play");
});

// --- If this card is put into your discard pile from anywhere, remove it from the game -------

clause(MOUNTAIN, "1:rule", "destroyed in play, it is removed from the game instead of staying in the discard pile", () => {
  const { engine, id } = mgBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("mg")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("mg")), "removed");
  assert.ok(!discardOf(engine, P1).includes(id("mg")), "not in the discard pile");
});

clause(MOUNTAIN, "1:rule", "destroyed in a battle it is removed from the game", () => {
  const { engine, id } = mgBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Titan", strength: 14, life: 20, speed: 3 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("mg")]);
  autoResolveBattle(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("mg")), "removed", "14 damage against 13 life");
});

clause(MOUNTAIN, "1:rule", "discarded from my hand it is removed from the game", () => {
  const discardFromHand = tactic({
    name: "Discard A Card",
    cost: 0,
    behavior: {
      abilities: [{ id: "dh", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }]
    }
  });
  const { engine, id } = mgBoard({ mg: "hand", extra: [{ key: "dh", def: discardFromHand, owner: P1, zone: "hand" }] });
  play(engine, P1, id("dh"), { selected: { t: [id("mg")] } });
  assert.equal(zoneOf(engine, id("mg")), "removed");
  assert.ok(!discardOf(engine, P1).includes(id("mg")), "!discardOf(engine, P1).includes(id(\"mg\"))");
});

clause(MOUNTAIN, "1:rule", "milled from my deck into my discard pile it is removed from the game ('from anywhere')", () => {
  const mill = tactic({
    name: "Mill One",
    cost: 0,
    behavior: { abilities: [{ id: "mill", type: "activated", effects: [{ type: "mill", player: "controller", count: 1 }] }] }
  });
  const { engine, id } = mgBoard({ mg: "deck", extra: [{ key: "mill", def: mill, owner: P1, zone: "hand" }] });
  assert.equal(zoneOf(engine, id("mg")), "deck");
  play(engine, P1, id("mill"));
  assert.equal(zoneOf(engine, id("mg")), "removed");
});

clause(MOUNTAIN, "1:rule", "the opponent's Golem is removed from the game too when it goes to ITS owner's discard pile", () => {
  const { engine, id } = mgBoard({ owner: P2 });
  play(engine, P1, id("kill"), { selected: { t: [id("mg")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("mg")), "removed");
  assert.ok(!discardOf(engine, P2).includes(id("mg")), "!discardOf(engine, P2).includes(id(\"mg\"))");
});

clause(MOUNTAIN, "1:rule", "a Golem I own but the opponent controls is destroyed into MY discard pile (its owner's): it is removed from the game", () => {
  const { engine, id } = mgBoard({ controller: P2 });
  play(engine, P1, id("kill"), { selected: { t: [id("mg")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("mg")), "removed");
});

clause(MOUNTAIN, "1:rule", "terminated while being deployed (it goes to its owner's discard pile) it is removed from the game", () => {
  const counter = tactic({
    name: "Counter",
    cost: 0,
    behavior: {
      abilities: [{ id: "counter", type: "activated", targets: [{ id: "t", selector: { zone: "deploying" }, count: 1 }], effects: [{ type: "terminate", target: { type: "selected", id: "t" } }] }]
    }
  });
  const { engine, id } = mgBoard({ mg: "hand", icons: { elitism: 13 }, extra: [{ key: "counter", def: counter, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("mg"));
  assert.equal(zoneOf(engine, id("mg")), "deploying");
  engine.perform({ type: "playCard", playerId: P2, cardId: id("counter"), selected: { t: [id("mg")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mg")), "removed", "put into my discard pile from the deploy area, so it is removed from the game");
});

clause(MOUNTAIN, "1:rule", "only the discard pile: put into my hand it stays in my hand, removed from the game it stays removed", () => {
  const bounced = mgBoard();
  play(bounced.engine, P1, bounced.id("bounce"), { selected: { t: [bounced.id("mg")] } });
  assert.equal(zoneOf(bounced.engine, bounced.id("mg")), "hand");
  const exiled = mgBoard();
  play(exiled.engine, P1, exiled.id("exile"), { selected: { t: [exiled.id("mg")] } });
  assert.equal(zoneOf(exiled.engine, exiled.id("mg")), "removed");
});

clause(MOUNTAIN, "1:rule", "only this card: another character destroyed alongside it goes to the discard pile as usual", () => {
  const { engine, id } = mgBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("mg")), "play");
});

// --- FLIP UP: 13 [E][E] ----------------------------------------------------------------

clause(MOUNTAIN, "2:flipUp", "face-down in play it is a resource: one Volition, in the resource pool", () => {
  const { engine, id } = mgBoard({ mg: "faceDown", icons: { elitism: 2 } });
  assert.equal(engine.isResource(id("mg")), true);
  assert.equal(ready(engine), 3);
  assert.equal(engine.getThresholds(P1).volition, 1);
});

clause(MOUNTAIN, "2:flipUp", "flipping it up puts the character into play face-up as a new card: undamaged, ready, with its full stats", () => {
  const { engine, id } = mgBoard({ mg: "faceDown", icons: { elitism: 14 } });
  flipMg(engine, id);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mg")), "play");
  assert.equal(engine.state.cards[id("mg")].faceDown, false);
  assert.equal(engine.isResource(id("mg")), false);
  assert.equal(isDepleted(engine, id("mg")), false);
  assert.equal(engine.getStat(id("mg"), "strength"), 13);
  assert.equal(engine.getStat(id("mg"), "life"), 13);
  assert.equal(engine.getStat(id("mg"), "speed"), 1);
});

clause(MOUNTAIN, "2:flipUp", "it pays the FLIP UP cost of 13", () => {
  const { engine, id } = mgBoard({ mg: "faceDown", icons: { elitism: 16 } });
  assert.equal(ready(engine), 17, "sixteen [E] plus the face-down Golem");
  flipMg(engine, id);
  resolvePendingResponses(engine);
  const after = ready(engine);
  // The card stops being a resource (-1) and 13 resources are paid; the paid ones may include the card itself (CR 507.4b), so 3 or 4 remain.
  assert.ok(after === 3 || after === 4, `expected 3 or 4 resources left (13 paid), got ${after}`);
});

clause(MOUNTAIN, "2:flipUp", "the cost is exactly 13: twelve [E] plus the card itself is enough, eleven plus itself (12) is refused", () => {
  const enough = mgBoard({ mg: "faceDown", icons: { elitism: 12 } });
  flipMg(enough.engine, enough.id);
  resolvePendingResponses(enough.engine);
  assert.equal(enough.engine.state.cards[enough.id("mg")].faceDown, false, "the card paid for its own FLIP UP (CR 507.4b)");
  assert.equal(zoneOf(enough.engine, enough.id("mg")), "play");
  const short = mgBoard({ mg: "faceDown", icons: { elitism: 11 } });
  refused(() => flipMg(short.engine, short.id), "twelve resources for a cost of 13");
  assert.equal(short.engine.state.cards[short.id("mg")].faceDown, true);
  assert.equal(ready(short.engine), 12, "nothing was paid");
});

clause(MOUNTAIN, "2:flipUp", "FLIP UP needs [E][E]: one [E] among many other resources is refused, so is none, two are accepted", () => {
  const one = mgBoard({ mg: "faceDown", icons: { elitism: 1, rage: 14 } });
  refused(() => flipMg(one.engine, one.id), "one [E]");
  assert.equal(one.engine.state.cards[one.id("mg")].faceDown, true);
  assert.equal(ready(one.engine), 16, "nothing was paid");
  const none = mgBoard({ mg: "faceDown", icons: { rage: 15 } });
  refused(() => flipMg(none.engine, none.id), "no [E]");
  const two = mgBoard({ mg: "faceDown", icons: { elitism: 2, rage: 12 } });
  flipMg(two.engine, two.id);
  resolvePendingResponses(two.engine);
  assert.equal(two.engine.state.cards[two.id("mg")].faceDown, false);
});

clause(MOUNTAIN, "2:flipUp", "the card's own Volition is not [E], and the opponent's [E] do not count", () => {
  const { engine, id } = mgBoard({ mg: "faceDown", icons: { greed: 14 } });
  refused(() => flipMg(engine, id), "no [E] of my own (the opponent has some)");
  assert.equal(engine.state.cards[id("mg")].faceDown, true);
});

clause(MOUNTAIN, "2:flipUp", "a flipped-up Golem keeps its text: destroyed afterwards, it is removed from the game; and the opponent still cannot take control of it", () => {
  const { engine, id } = mgBoard({ mg: "faceDown", icons: { elitism: 14 }, extra: [{ key: "stealP2b", def: stealChar(), owner: P2, zone: "hand" }] });
  flipMg(engine, id);
  resolvePendingResponses(engine);
  play(engine, P1, id("kill"), { selected: { t: [id("mg")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("mg")), "removed");
});

clause(MOUNTAIN, "2:flipUp", "a character flipped up did not start the turn in play: it cannot attack this turn", () => {
  const { engine, id } = mgBoard({ mg: "faceDown", icons: { elitism: 14 }, turn: 2 });
  flipMg(engine, id);
  resolvePendingResponses(engine);
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mg")], target: { type: "faction", playerId: P2 } }), "a new card this turn");
});

clause(MOUNTAIN, "2:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const theirs = mgBoard({ mg: "faceDown", icons: { elitism: 14 } });
  refused(() => flipMg(theirs.engine, theirs.id, P2), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("mg")].faceDown, true);
  const inHand = mgBoard({ mg: "hand", icons: { elitism: 14 } });
  refused(() => flipMg(inHand.engine, inHand.id), "in my hand it is not a face-down resource");
  const faceUp = mgBoard({ mg: "play", icons: { elitism: 14 } });
  refused(() => flipMg(faceUp.engine, faceUp.id), "already face-up");
});

clause(MOUNTAIN, "2:flipUp", "a character is only deployed on its controller's turn, and FLIP UP does not change that (CR 507.4d): refused on the opponent's turn, even in a response window", () => {
  const { engine, id } = mgBoard({ mg: "faceDown", icons: { elitism: 14 }, turn: 2, active: P2 });
  refused(() => flipMg(engine, id), "no window at all");
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  refused(() => flipMg(engine, id), "a character cannot be played in a response window");
  assert.equal(engine.state.cards[id("mg")].faceDown, true);
  assert.equal(ready(engine), 15, "nothing was paid");
});

clause(MOUNTAIN, "2:flipUp", "a flipped-up card is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it enters play", () => {
  const { engine, id } = mgBoard({ mg: "faceDown", icons: { elitism: 14 } });
  holdFlipUp(() => flipMg(engine, id));
  assert.ok(engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("mg")), "deploying", "the character is being deployed, it has not entered play yet");
});

// =================================================================================
// Hall of Conventions
// UNIQUE HALL OF CONVENTIONS
// [E][E][E]: At the start of your turn, reduce the next numeric cost you pay this turn by 1.
// [E][E][E][E][E]: At the start of your turn, you may pick a character. If you do, it gains 2 strength and 2 life this turn.
// [E][E][E][E][E][E][E]: At the start of your turn, you may play a resource.
// Location, cost 3, [E], structure 5.
// =================================================================================

const HALL = "78d1d283-421a-41f1-9bd9-c6a30f391821";

interface HallOpts {
  /** [E] icons P1 controls. */
  elitism?: number;
  other?: Icons;
  faceDown?: number;
  oppElitism?: number;
  hall?: "play" | "hand" | "discard";
  hallFaceDown?: boolean;
  controller?: PlayerId;
  /** Whose turn it is on the board (the turn that starts next is the other player's). */
  active?: PlayerId;
  /** Put Arrogance (two [E] icons) into play. */
  arrogance?: boolean;
  noCharacters?: boolean;
  extra?: CardPlacement[];
}

/**
 * P1 owns the Hall. P1: mine, mine2 (2/3/2 characters), hand: big (item 5), big2 (item 5), small (item 2), one (item 1), zero (item 0), staple (an Elitism resource card), c1, c2 (characters).
 * P2: foe, foe2 (2/3/2), foeThing (item), foePlace (location), fd (face-down), oBig (item 5 in P2's hand).
 */
function hallBoard(o: HallOpts = {}) {
  const characters: CardPlacement[] = o.noCharacters
    ? []
    : [
        { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
        { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
        { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" }
      ];
  return buildGame({
    turn: 2,
    activePlayerId: o.active ?? P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hall", def: printing(HALL), owner: P1, controller: o.controller, zone: o.hall ?? "play", faceDown: o.hallFaceDown },
      ...characters,
      ...(o.arrogance ? [{ key: "arr", def: printing(ARROGANCE), owner: P1, zone: "play" as const }] : []),
      { key: "foeThing", def: item({ name: "FoeThing" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "big", def: item({ name: "Big Five", cost: 5 }), owner: P1, zone: "hand" },
      { key: "big2", def: item({ name: "Big Five Again", cost: 5 }), owner: P1, zone: "hand" },
      { key: "small", def: item({ name: "Small Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "one", def: item({ name: "Cheap One", cost: 1 }), owner: P1, zone: "hand" },
      { key: "zero", def: item({ name: "Free Zero", cost: 0 }), owner: P1, zone: "hand" },
      { key: "staple", def: resourceCard({ name: "Elitism Staple", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "hand" },
      { key: "c1", def: character({ name: "Card One" }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "Card Two" }), owner: P1, zone: "hand" },
      { key: "oBig", def: item({ name: "Their Five", cost: 5 }), owner: P2, zone: "hand" },
      ...res({ elitism: o.elitism ?? 0, ...(o.other ?? {}) }),
      ...volition(o.faceDown ?? 0, P1),
      ...res({ elitism: o.oppElitism ?? 0 }, P2),
      ...(o.extra ?? [])
    ]
  });
}

interface HallPolicy {
  /** Characters to pick when asked for a character (default none = decline). */
  pick?: CardInstanceId[];
  /** Whether to accept the 'play a resource' offer. */
  resource?: boolean;
  /** Cards to answer a 'which resource' prompt with. */
  resourceCards?: CardInstanceId[];
}

/** Answers a turn start per `policy`: trigger ordering takes the first, the character pick takes `pick`, the resource offer follows `resource`. */
const hallAnswers = (policy: HallPolicy = {}) => {
  const resourceCards = [...(policy.resourceCards ?? [])];
  return (pc: PendingChoiceLike): unknown => {
    if (pc.kind === "chooserSelectsTarget") {
      // the "you may play a resource" offer is an optional pick from hand (declaration "play"); the other target prompt is the character pick
      if (isHallResourceOffer(pc)) return { kind: "chooserSelectsTarget", selected: policy.resource === true && resourceCards.length > 0 ? [resourceCards.shift()!] : [] };
      return { kind: "chooserSelectsTarget", selected: policy.pick ?? [] };
    }
    return declineAll(pc);
  };
};

/** True for the Hall's "you may play a resource" prompt (an optional pick from hand), as opposed to the character pick. */
const isHallResourceOffer = (pc: PendingChoiceLike): boolean =>
  pc.kind === "chooserSelectsTarget" && (pc as unknown as { declaration?: { id?: string } }).declaration?.id === "play";

/** Starts P1's turn answering per `policy`; returns every prompt asked. */
const hallTurn = (engine: SpoilsEngine, policy: HallPolicy = {}) => startTurnOf(engine, P1, hallAnswers(policy));

/** A tactic dealing `amount` damage to one chosen location (id `zap`, declaration `t`). */
const zapLocation = (amount: number): CardDefinition =>
  tactic({
    name: `Zap Location ${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }
      ]
    }
  });

clause(HALL, "0:unique", "a single copy deploys for exactly 3 and needs [E]; it is a location with structure 5", () => {
  deployChecks(HALL, { cost: 3, icon: "elitism", icons: 1, type: "location" });
  const { engine, id } = hallBoard({ hall: "play" });
  assert.equal(engine.getDefinition(id("hall")).structure, 5);
});

clause(HALL, "0:unique", "the structure is real: 4 damage leaves it in play, the 5th destroys it", () => {
  const { engine, id } = hallBoard({ extra: [{ key: "z4", def: zapLocation(4), owner: P2, zone: "hand" }, { key: "z1", def: zapLocation(1), owner: P2, zone: "hand" }] });
  const damage = (key: string) => engine.perform({ type: "playCard", playerId: P2, cardId: id(key), selected: { t: [id("hall")] }, variables: {} } as never);
  // The opponent's turn is the active one on this board, so they can play their tactics.
  damage("z4");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("hall")), "play");
  assert.equal(engine.state.cards[id("hall")].damage, 4);
  damage("z1");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("hall")), "discard");
});

function twoHalls(o: { second?: "hand" | "oppPlay" } = {}) {
  return buildGame({
    turn: 1,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: (
      [
        { key: "hall", def: printing(HALL), owner: P1, zone: "play" },
        { key: "hall2", def: printing(HALL), owner: P1, zone: "hand" },
        { key: "oppHall", def: printing(HALL), owner: P2, zone: "play" },
        ...res({ elitism: 4 })
      ] as CardPlacement[]
    ).filter((c) => (o.second === "oppPlay" ? c.key !== "hall2" : c.key !== "oppHall"))
  });
}

clause(HALL, "0:unique", "deploying a second copy while I control one forces me to choose which to keep (keep the new one: the old is destroyed)", () => {
  const { engine, id } = twoHalls();
  play(engine, P1, id("hall2"));
  const pc = pending(engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("hall"), id("hall2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("hall2") });
  assert.equal(zoneOf(engine, id("hall2")), "play");
  assert.equal(zoneOf(engine, id("hall")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(HALL, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = twoHalls();
  play(engine, P1, id("hall2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("hall") });
  assert.equal(zoneOf(engine, id("hall")), "play");
  assert.equal(zoneOf(engine, id("hall2")), "discard");
});

clause(HALL, "0:unique", "UNIQUE only concerns my own cards: the opponent may have their own copy in play, with no choice and no destruction", () => {
  const { engine, id } = twoHalls({ second: "oppPlay" });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("hall")), "play");
  assert.equal(zoneOf(engine, id("oppHall")), "play");
});

clause(HALL, "0:unique", "the opponent deploying their own copy while I control one is fine", () => {
  const { engine, id } = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hall", def: printing(HALL), owner: P1, zone: "play" },
      { key: "oppHall", def: printing(HALL), owner: P2, zone: "hand" },
      ...res({ elitism: 4 }, P2)
    ]
  });
  play(engine, P2, id("oppHall"));
  assert.equal(engine.state.pendingChoice, undefined, "no unique prompt for the opponent");
  assert.equal(zoneOf(engine, id("oppHall")), "play");
  assert.equal(zoneOf(engine, id("hall")), "play");
});

clause(HALL, "0:unique", "taking control of the opponent's copy while I control one forces a choice (FAQ)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hall", def: printing(HALL), owner: P1, zone: "play" },
      { key: "oppHall", def: printing(HALL), owner: P2, zone: "play" },
      {
        key: "steal",
        def: tactic({
          name: "Steal Location",
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
        }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("oppHall")] } });
  const pc = pending(engine);
  assert.ok(pc, "now I control two copies");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
});

clause(HALL, "0:unique", "the designation is what counts, not the name: another location with the same UNIQUE designation conflicts, one with a different designation does not", () => {
  const conflict = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hall", def: printing(HALL), owner: P1, zone: "play" },
      { key: "same", def: location({ name: "Totally Different Name", unique: "hall of conventions" }), owner: P1, zone: "hand" }
    ]
  });
  play(conflict.engine, P1, conflict.id("same"));
  assert.equal(pending(conflict.engine)?.kind, "uniqueSurvivor", "same designation: a choice");
  const noConflict = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hall", def: printing(HALL), owner: P1, zone: "play" },
      { key: "diff", def: location({ name: "Another Place", unique: "something else" }), owner: P1, zone: "hand" }
    ]
  });
  play(noConflict.engine, P1, noConflict.id("diff"));
  assert.equal(noConflict.engine.state.pendingChoice, undefined, "different designation: no choice");
  assert.equal(zoneOf(noConflict.engine, noConflict.id("hall")), "play");
});

// --- [E][E][E]: reduce the next numeric cost you pay this turn by 1 -----------------------

clause(HALL, "1:rule@eee", "with 3 [E], at the start of my turn the next numeric cost I pay is reduced by exactly 1: a cost-5 item costs 4", () => {
  const { engine, id } = hallBoard({ elitism: 8 });
  hallTurn(engine);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(paid(engine, id, "big"), 4);
});

clause(HALL, "1:rule@eee", "...without the Hall the same item costs its full 5 (control)", () => {
  const { engine, id } = hallBoard({ elitism: 8, hall: "hand" });
  hallTurn(engine);
  assert.equal(paid(engine, id, "big"), 5);
});

clause(HALL, "1:rule@eee", "a numeric cost never goes below 0 (CR 406.6): cost 1 and cost 0 cards are free", () => {
  for (const key of ["one", "zero"]) {
    const { engine, id } = hallBoard({ elitism: 8 });
    hallTurn(engine);
    assert.equal(paid(engine, id, key), 0, `${key} is free`);
  }
});

clause(HALL, "1:rule@eee", "only the NEXT cost is reduced: the second card pays full price", () => {
  const { engine, id } = hallBoard({ elitism: 12 });
  hallTurn(engine);
  assert.equal(paid(engine, id, "big"), 4);
  assert.equal(paid(engine, id, "big2"), 5);
});

clause(HALL, "1:rule@eee", "an unused reduction does not pile up: after a second turn start the next cost is still only reduced by 1", () => {
  const { engine, id } = hallBoard({ elitism: 8 });
  hallTurn(engine);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "my second turn has started");
  drain(engine, hallAnswers());
  assert.equal(paid(engine, id, "big"), 4, "1 from this turn's trigger, not 2");
});

for (const [elitism, active] of [
  [2, false],
  [3, true],
  [4, true],
  [1, false],
  [0, false]
] as const) {
  clause(HALL, "1:rule@eee", `threshold: with ${elitism} [E] the reduction is ${active ? "applied" : "NOT applied"} at the start of my turn`, () => {
    const { engine, id } = hallBoard({ elitism, other: { rage: 8 } });
    hallTurn(engine);
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, active ? 4 : 5);
  });
}

clause(HALL, "1:rule@eee", "threshold: [E] is the icon that counts: ten resources of other icons do not turn it on", () => {
  const { engine, id } = hallBoard({ elitism: 2, other: { rage: 5, greed: 5 } });
  hallTurn(engine);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 5);
});

clause(HALL, "1:rule@eee", "threshold: face-down resources provide Volition, not [E], so they do not count", () => {
  const { engine, id } = hallBoard({ elitism: 2, faceDown: 3 });
  hallTurn(engine);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 5);
});

clause(HALL, "1:rule@eee", "threshold: the opponent's [E] do not count for me", () => {
  const { engine, id } = hallBoard({ elitism: 0, oppElitism: 8 });
  hallTurn(engine);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 5);
});

clause(HALL, "1:rule@eee", "threshold counts icons, not cards: Arrogance (two [E] on one card) plus a single [E] resource meets [E][E][E]", () => {
  const { engine, id } = hallBoard({ elitism: 1, arrogance: true });
  assert.equal(engine.getThresholds(P1).elitism, 3);
  hallTurn(engine);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 4);
});

clause(HALL, "1:rule@eee", "'at the start of YOUR turn': at the start of the opponent's turn I get no reduction, even with the threshold", () => {
  const { engine, id } = hallBoard({ elitism: 8, active: P1 });
  startTurnOf(engine, P2, declineAll);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 5);
  assert.deepEqual(engine.state.costReductions, []);
});

clause(HALL, "1:rule@eee", "'your' means the controller: a Hall I own but the opponent controls reduces THEIR next cost at the start of THEIR turn, not mine at the start of mine", () => {
  const { engine, id } = hallBoard({ elitism: 8, oppElitism: 3, controller: P2 });
  hallTurn(engine);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 5, "nothing for me");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getCardPlayability(P2, id("oBig")).numericCost, 4, "their next cost is reduced");
});

clause(HALL, "1:rule@eee", "it only works while the Hall is in play: in my hand or discard pile it does nothing", () => {
  for (const hall of ["hand", "discard"] as const) {
    const { engine, id } = hallBoard({ elitism: 8, hall });
    hallTurn(engine);
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 5, hall);
  }
});

clause(HALL, "1:rule@eee", "a face-down Hall is only a resource with no rules text (CR 411.1): it does nothing at the start of my turn", () => {
  const { engine, id } = hallBoard({ elitism: 8, hallFaceDown: true });
  hallTurn(engine);
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 5);
});

// --- [E]x5: pick a character, +2 strength and +2 life this turn ----------------------------

clause(HALL, "2:rule@eeeee", "with 5 [E], at the start of my turn I am offered an optional pick of a character", () => {
  const { engine } = hallBoard({ elitism: 5 });
  endTurn(engine, P2);
  const seen: string[] = [];
  drain(engine, (pc) => {
    seen.push(`${pc.playerId}:${pc.kind}`);
    return declineAll(pc);
  });
  assert.ok(seen.includes("p1:chooserSelectsTarget"), "I was asked to pick");
  assert.ok(!seen.some((entry) => entry.startsWith("p2:")), "the opponent was asked nothing");
});

clause(HALL, "2:rule@eeeee", "the picked character gains exactly 2 strength and 2 life this turn; no other character does (speed is untouched)", () => {
  const { engine, id } = hallBoard({ elitism: 5 });
  hallTurn(engine, { pick: [id("mine")] });
  assert.equal(engine.getStat(id("mine"), "strength"), 4);
  assert.equal(engine.getStat(id("mine"), "life"), 5);
  assert.equal(engine.getStat(id("mine"), "speed"), 2);
  for (const key of ["mine2", "foe", "foe2"]) {
    assert.equal(engine.getStat(id(key), "strength"), 2, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), 3, `${key} life`);
  }
});

clause(HALL, "2:rule@eeeee", "an opposing character can be picked too", () => {
  const { engine, id } = hallBoard({ elitism: 5 });
  hallTurn(engine, { pick: [id("foe")] });
  assert.equal(engine.getStat(id("foe"), "strength"), 4);
  assert.equal(engine.getStat(id("foe"), "life"), 5);
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
});

clause(HALL, "2:rule@eeeee", "'you may': declining gives nothing to anybody", () => {
  const { engine, id } = hallBoard({ elitism: 5 });
  const seen = hallTurn(engine, { pick: [] });
  assert.ok(seen.includes("p1:chooserSelectsTarget"), "seen.includes(\"p1:chooserSelectsTarget\")");
  for (const key of ["mine", "mine2", "foe", "foe2"]) {
    assert.equal(engine.getStat(id(key), "strength"), 2, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), 3, `${key} life`);
  }
});

clause(HALL, "2:rule@eeeee", "the bonus lasts this turn only", () => {
  const { engine, id } = hallBoard({ elitism: 5 });
  hallTurn(engine, { pick: [id("mine")] });
  assert.equal(engine.getStat(id("mine"), "strength"), 4);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "gone when the turn ends");
  assert.equal(engine.getStat(id("mine"), "life"), 3);
});

clause(HALL, "2:rule@eeeee", "the extra life is real: the picked 3-life character survives 4 damage and dies to the 5th", () => {
  const { engine, id } = hallBoard({ elitism: 5, extra: [{ key: "z4", def: zapChar(4), owner: P1, zone: "hand" }, { key: "z1", def: zapChar(1), owner: P1, zone: "hand" }] });
  hallTurn(engine, { pick: [id("mine")] });
  play(engine, P1, id("z4"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "play");
  play(engine, P1, id("z1"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
});

clause(HALL, "2:rule@eeeee", "the extra strength is real in battle: the picked 2-strength attacker deals 4 to the faction", () => {
  const { engine, id } = hallBoard({ elitism: 5 });
  hallTurn(engine, { pick: [id("mine")] });
  const influence = influenceOf(engine, P2);
  fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - influenceOf(engine, P2), 4);
});

clause(HALL, "2:rule@eeeee", "'pick a character': an item, a location, factions, a face-down card and characters in a hand are refused (and the offer stays open)", () => {
  const { engine, id } = hallBoard({ elitism: 5 });
  endTurn(engine, P2);
  for (let guard = 0; guard < 5 && pending(engine)?.kind === "orderTriggers"; guard++) {
    const order = pending(engine)!;
    answerPending(engine, "orderTriggers", { next: (order.triggers as unknown[])[0] });
  }
  const pc = pending(engine);
  assert.ok(pc, "the pick is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  refused(tryPick(engine, P1, [id("foeThing")]), "an item");
  refused(tryPick(engine, P1, [id("foePlace")]), "a location");
  refused(tryPick(engine, P1, [factionOf(engine, P1)]), "my faction");
  refused(tryPick(engine, P1, [factionOf(engine, P2)]), "their faction");
  refused(tryPick(engine, P1, [id("fd")]), "a face-down card");
  refused(tryPick(engine, P1, [id("c1")]), "a character in my hand");
  refused(tryPick(engine, P1, [id("mine"), id("mine2")]), "two characters");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mine2")] });
  assert.equal(engine.getStat(id("mine2"), "strength"), 4, "control: one character in play is accepted");
});

for (const [elitism, active] of [
  [4, false],
  [5, true],
  [6, true],
  [3, false]
] as const) {
  clause(HALL, "2:rule@eeeee", `threshold: with ${elitism} [E] the pick is ${active ? "offered" : "NOT offered"} at the start of my turn`, () => {
    const { engine, id } = hallBoard({ elitism, other: { rage: 6 } });
    const seen = hallTurn(engine, { pick: [id("mine")] });
    assert.equal(seen.includes("p1:chooserSelectsTarget"), active);
    assert.equal(engine.getStat(id("mine"), "strength"), active ? 4 : 2);
  });
}

clause(HALL, "2:rule@eeeee", "threshold: Arrogance's two [E] plus three [E] resources make [E]x5", () => {
  const { engine, id } = hallBoard({ elitism: 3, arrogance: true });
  const seen = hallTurn(engine, { pick: [id("mine")] });
  assert.ok(seen.includes("p1:chooserSelectsTarget"), "seen.includes(\"p1:chooserSelectsTarget\")");
  assert.equal(engine.getStat(id("mine"), "strength"), 4);
});

clause(HALL, "2:rule@eeeee", "'at the start of YOUR turn': nothing is offered at the start of the opponent's turn", () => {
  const { engine, id } = hallBoard({ elitism: 5, active: P1 });
  const seen = startTurnOf(engine, P2, picking([id("mine")]));
  assert.deepEqual(seen, []);
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
});

clause(HALL, "2:rule@eeeee", "with no character in play at all nothing is stuck", () => {
  const { engine } = hallBoard({ elitism: 5, noCharacters: true });
  hallTurn(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.activePlayerId, P1);
});

clause(HALL, "2:rule@eeeee", "with 5 [E] the [E]x3 paragraph is on as well: both the pick and the reduction happen", () => {
  const { engine, id } = hallBoard({ elitism: 8 });
  const seen = hallTurn(engine, { pick: [id("mine")] });
  assert.ok(seen.includes("p1:chooserSelectsTarget"), "seen.includes(\"p1:chooserSelectsTarget\")");
  assert.equal(engine.getStat(id("mine"), "strength"), 4);
  assert.equal(paid(engine, id, "big"), 4);
});

// --- [E]x7: you may play a resource -------------------------------------------------------------

clause(HALL, "3:rule@eeeeeee", "with 7 [E], at the start of my turn I am offered 'play a resource', with a way to decline", () => {
  const { engine } = hallBoard({ elitism: 7, noCharacters: true });
  endTurn(engine, P2);
  const seen: Array<{ who: string; optional: boolean }> = [];
  drain(engine, (pc) => {
    if (isHallResourceOffer(pc)) {
      seen.push({ who: pc.playerId, optional: (pc as unknown as { declaration?: { optional?: boolean } }).declaration?.optional === true });
      return { kind: "chooserSelectsTarget", selected: [] };
    }
    return declineAll(pc);
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].who, P1, "offered to me");
  assert.ok(seen[0].optional, "the pick of a card from hand to play is optional (a way to decline)");
});

clause(HALL, "3:rule@eeeeeee", "'you may': declining plays nothing and keeps my hand intact", () => {
  const { engine, id } = hallBoard({ elitism: 7, noCharacters: true });
  const handBefore = [...handOf(engine, P1)];
  hallTurn(engine, { resource: false });
  assert.deepEqual([...handOf(engine, P1)].sort(), handBefore.sort());
  assert.equal(zoneOf(engine, id("staple")), "hand");
  assert.equal(zoneOf(engine, id("c1")), "hand");
});

clause(HALL, "3:rule@eeeeeee", "accepting plays a resource from my hand: a real resource card enters play face-up and provides its icon", () => {
  const { engine, id } = hallBoard({ elitism: 7, noCharacters: true });
  hallTurn(engine, { resource: true, resourceCards: [id("staple")] });
  assert.equal(zoneOf(engine, id("staple")), "play", "the resource card was played");
  assert.equal(engine.state.cards[id("staple")].faceDown, false, "a real resource card is played face-up");
  assert.equal(engine.getThresholds(P1).elitism, 8);
});

clause(HALL, "3:rule@eeeeeee", "any card can be played as a face-down resource: a character from my hand enters play face-down and provides one Volition", () => {
  const { engine, id } = hallBoard({ elitism: 7, noCharacters: true });
  hallTurn(engine, { resource: true, resourceCards: [id("c1")] });
  assert.equal(zoneOf(engine, id("c1")), "play", "the character was played as a resource");
  assert.equal(engine.state.cards[id("c1")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1);
});

clause(HALL, "3:rule@eeeeeee", "'a resource': exactly one card is played, the rest of my hand stays", () => {
  const { engine, id } = hallBoard({ elitism: 7, noCharacters: true });
  const resourcesBefore = engine.state.players[P1].play.filter((cardId) => engine.isResource(cardId)).length;
  hallTurn(engine, { resource: true, resourceCards: [id("staple"), id("c1"), id("c2")] });
  const resourcesAfter = engine.state.players[P1].play.filter((cardId) => engine.isResource(cardId)).length;
  assert.equal(resourcesAfter - resourcesBefore, 1);
  assert.equal(zoneOf(engine, id("c1")), "hand");
  assert.equal(zoneOf(engine, id("c2")), "hand");
});

clause(HALL, "3:rule@eeeeeee", "playing a resource this way is not the Develop Rule: I can still develop afterwards", () => {
  const { engine, id } = hallBoard({ elitism: 7, noCharacters: true });
  hallTurn(engine, { resource: true, resourceCards: [id("staple")] });
  assert.equal(zoneOf(engine, id("staple")), "play", "(it played a resource)");
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developResource(engine, P1, id("c1"), true);
  assert.equal(zoneOf(engine, id("c1")), "play");
});

clause(HALL, "3:rule@eeeeeee", "a resource it plays 'enters play' like any other: Arrogance played this way costs 1 influence", () => {
  const { engine, id } = hallBoard({ elitism: 7, noCharacters: true, extra: [{ key: "arrHand", def: printing(ARROGANCE), owner: P1, zone: "hand" }] });
  const before = influenceOf(engine, P1);
  hallTurn(engine, { resource: true, resourceCards: [id("arrHand")] });
  assert.equal(zoneOf(engine, id("arrHand")), "play");
  assert.equal(influenceOf(engine, P1), before - 1);
});

clause(HALL, "3:rule@eeeeeee", "with an empty hand there is nothing to play and nothing gets stuck", () => {
  const empty = hallBoard({ elitism: 7, noCharacters: true });
  for (const key of ["big", "big2", "small", "one", "zero", "staple", "c1", "c2"]) empty.engine.state.cards[empty.id(key)].zone = "discard";
  empty.engine.state.players[P1].hand = [];
  hallTurn(empty.engine, { resource: true });
  assert.equal(empty.engine.state.pendingChoice, undefined);
  assert.equal(empty.engine.state.activePlayerId, P1);
});

for (const [elitism, active] of [
  [6, false],
  [7, true],
  [8, true],
  [5, false]
] as const) {
  clause(HALL, "3:rule@eeeeeee", `threshold: with ${elitism} [E] the offer is ${active ? "made" : "NOT made"} at the start of my turn`, () => {
    const { engine } = hallBoard({ elitism, other: { rage: 4 }, noCharacters: true });
    endTurn(engine, P2);
    let offered = false;
    drain(engine, (pc) => {
      if (isHallResourceOffer(pc)) {
        offered = true;
        return { kind: "chooserSelectsTarget", selected: [] };
      }
      return declineAll(pc);
    });
    assert.equal(offered, active);
  });
}

clause(HALL, "3:rule@eeeeeee", "'at the start of YOUR turn': nothing is offered at the start of the opponent's turn", () => {
  const { engine } = hallBoard({ elitism: 7, noCharacters: true, active: P1 });
  const seen = startTurnOf(engine, P2, hallAnswers({ resource: true }));
  assert.deepEqual(seen, []);
});

clause(HALL, "3:rule@eeeeeee", "with 7 [E] all three paragraphs are on at once: the reduction, the pick and the resource offer all happen in one turn start", () => {
  const { engine, id } = hallBoard({ elitism: 7 });
  const seen = hallTurn(engine, { pick: [id("mine")], resource: false });
  assert.ok(seen.includes("p1:orderTriggers"), "three triggers at once: I order them");
  assert.equal(seen.filter((s) => s === "p1:chooserSelectsTarget").length, 2, "the character pick and the resource offer (an optional pick from hand)");
  assert.equal(engine.getStat(id("mine"), "strength"), 4, "the pick happened");
  assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 4, "the reduction happened");
});

// --- near misses: the turn has already started when the Hall is deployed -----------------

/** P1's own turn is under way (turn 1); the Hall is in P1's hand with twelve [E] available, plus a character, an item and resource cards. */
function hallMidTurn() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hall", def: printing(HALL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "big", def: item({ name: "Big Five", cost: 5 }), owner: P1, zone: "hand" },
      { key: "staple", def: resourceCard({ name: "Elitism Staple", resource: { provides: ["elitism"], staple: true } }), owner: P1, zone: "hand" },
      ...res({ elitism: 12 })
    ]
  });
}

clause(HALL, "1:rule@eee", "deploying the Hall in the middle of my turn does not reduce anything: 'at the start of your turn' has already passed", () => {
  const { engine, id } = hallMidTurn();
  play(engine, P1, id("hall"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("hall")), "play");
  assert.deepEqual(engine.state.costReductions, []);
  assert.equal(paid(engine, id, "big"), 5);
});

clause(HALL, "2:rule@eeeee", "deploying the Hall in the middle of my turn does not offer a pick: 'at the start of your turn' has already passed", () => {
  const { engine, id } = hallMidTurn();
  play(engine, P1, id("hall"));
  assert.equal(engine.state.pendingChoice, undefined, "no offer");
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
});

clause(HALL, "3:rule@eeeeeee", "deploying the Hall in the middle of my turn does not offer a resource play: 'at the start of your turn' has already passed", () => {
  const { engine, id } = hallMidTurn();
  play(engine, P1, id("hall"));
  assert.equal(engine.state.pendingChoice, undefined, "no offer");
  assert.equal(zoneOf(engine, id("staple")), "hand");
});

clause(HALL, "1:rule@eee", "the reduction is available from the very next turn start: deployed on my turn it works at the start of my following turn", () => {
  const { engine, id } = hallMidTurn();
  play(engine, P1, id("hall"));
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  drain(engine, hallAnswers());
  assert.equal(paid(engine, id, "big"), 4);
});

