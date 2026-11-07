// Clause tests — batch 2nd-edition-02. See docs/TESTING.md and
// `npm run card-tests -- manifest 2nd-edition-02`. Expectations come from each
// card's PRINTED text (2nd Edition printing) and RULES.md / the CR; engine data
// is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame as baseBuildGame,
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
import { clause, clauseMismatch, declineAll, drain, printing, refused } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, pending, tokensOn, zoneOf } from "./_board.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  declareAttackOpenWindow,
  fight,
  fightThrough,
  finishBattle,
  playRaw
} from "./_battle.js";
import { developResource, endTurn, factionOf, developPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { developDraw } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

/** `buildGame` with a fixed random source, so shuffles, coin flips and random picks are deterministic (tests that assert a shuffle pass their own). */
const buildGame = (options: Parameters<typeof baseBuildGame>[0] = {}) => baseBuildGame({ ...options, random: options.random ?? (() => 0.5) });

type Pid = typeof P1 | typeof P2;
type Def = CardDefinition;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const handOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => (engine.getKeywords(cardId) as string[]).includes(keyword);
const tokens = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].counters?.token ?? 0;
const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const nameOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getDefinition(cardId).name;
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/** `n` plain characters for `owner` in `zone`, keyed `<prefix>0..n-1` (so deck order is top = 0). */
function fillers(prefix: string, n: number, owner: Pid, zone: "deck" | "hand" | "discard" | "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}` }), owner, zone }));
}

/** Answers the open `chooserSelectsTarget` choice with `selected` (and drains the response window afterwards). */
function pick(engine: SpoilsEngine, selected: CardInstanceId[], player?: Pid): void {
  const who = player ?? (pending(engine)!.playerId as Pid);
  engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
}

/** Same as `pick` but WITHOUT draining the response window (for refusal checks and for asserting what is true right after the answer). */
function pickRaw(engine: SpoilsEngine, selected: CardInstanceId[], player?: Pid): void {
  const who = player ?? (pending(engine)!.playerId as Pid);
  engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected } } as never);
}

/** Answers the open `chooserSelectsOption` choice with the option whose label matches `pattern`. */
function chooseOption(engine: SpoilsEngine, pattern: RegExp): void {
  const pc = pending(engine) as unknown as { kind: string; options: Array<{ label?: string }> } | undefined;
  assert.equal(pc?.kind, "chooserSelectsOption", "an option choice is open");
  const index = pc!.options.findIndex((option) => pattern.test(option.label ?? ""));
  assert.ok(index >= 0, `an option matching ${pattern} (have ${pc!.options.map((option) => option.label).join(" | ")})`);
  answerPending(engine, "chooserSelectsOption", { index });
}

/** Raw `activateAbility` WITHOUT draining the response window. */
function activateRaw(
  engine: SpoilsEngine,
  player: Pid,
  cardId: CardInstanceId,
  abilityId: string,
  opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** A free tactic that draws `amount` cards for its controller (id `drw`). */
function drawTactic(name = "Cantrip", amount = 1, cost = 0): Def {
  return tactic({
    name,
    cost,
    behavior: { abilities: [{ id: "drw", type: "activated", effects: [{ type: "draw", player: "controller", amount }] }] }
  });
}

/** A free tactic that moves one picked character to its owner's hand (id `b`, declaration `t`). */
function bounceTactic(): Def {
  return tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });
}

/** A free tactic dealing `amount` damage to one picked character (id `dmg`, declaration `t`). */
function damageTactic(amount: number, name = `Smite${amount}`): Def {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "dmg", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }]
    }
  });
}

/** A free tactic that adds `amount` strength to one picked character until end of turn (id `pump`, declaration `t`). */
function pumpTactic(amount: number): Def {
  return tactic({
    name: `Pump${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pump",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

/** A free tactic that destroys one picked item (id `k`, declaration `t`). */
function destroyItemTactic(): Def {
  return tactic({
    name: "DestroyItem",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
}

/** A free tactic that returns one picked item to its owner's hand (id `bi`, declaration `t`). */
function bounceItemTactic(): Def {
  return tactic({
    name: "BounceItem",
    cost: 0,
    behavior: {
      abilities: [{ id: "bi", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });
}

/** A free tactic that takes permanent control of one picked opponent's character (id `steal`, declaration `t`). */
function stealTactic(): Def {
  return tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "opponent" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A character with a "when this enters play, you draw a card" trigger (a witness for 'did it enter play'). */
function drawOnEnter(name = "Greeter", over: Partial<Def> = {}): Def {
  return character({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    },
    ...over
  });
}

/** P2 (the active player's opponent) attacks P1's faction with `attackerKey` and passes, leaving P1 holding priority in the declaration window. */
function openWindowOnP2Attack(engine: SpoilsEngine, attackerId: CardInstanceId): void {
  declareAttackOpenWindow(engine, P2, [attackerId], { type: "faction", playerId: P1 });
}

// =============================================================================
// Ritual of the Shattering Teeth
// COST: Choose a number for X. Pay X+X.
// EFFECT: Look at your opponent's hand and choose X or fewer cards in it. Your
// opponent discards those cards.
// Tactic (arcanist), cost 0, threshold [O][O][O].
// =============================================================================

const TEETH = "a4e9bfdd-dc54-40ec-ac20-374ca334f6e6";

function teethBoard(opts: { oppHand?: number; obsession?: number; greed?: number; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "rst", def: printing(TEETH), owner: P1, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.oppHand ?? 5 }, (_, i) => ({ key: `oh${i + 1}`, def: character({ name: `OH${i + 1}` }), owner: P2, zone: "hand" as const })),
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P2, zone: "play" },
      { key: "oppDiscard", def: character({ name: "OppDiscard" }), owner: P2, zone: "discard" },
      { key: "oppDeck", def: character({ name: "OppDeck" }), owner: P2, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type TeethBoard = ReturnType<typeof teethBoard>;

/** Plays Teeth for X; the caster is asked to look at the opponent's hand and pick; answers with `picks` (opponent-hand keys). */
function teethPlay(b: TeethBoard, x: number, picks: string[]): void {
  play(b.engine, P1, b.id("rst"), { variables: { x } });
  if (x === 0) {
    // "choose 0 cards" is not a decision: no prompt is opened (SYS-25).
    assert.equal(pending(b.engine), undefined, "X = 0: nothing to choose, so no prompt");
    return;
  }
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "a pick is asked for");
  assert.equal(pc?.playerId, P1, "you look at the hand and choose");
  pick(b.engine, picks.map(b.id));
  assert.equal(pending(b.engine), undefined);
}

clause(TEETH, "0:ability", "the card itself: tactic with printed cost 0 and threshold [O][O][O]: X = 0 costs nothing", () => {
  const b = teethBoard({ obsession: 3 });
  const before = ready(b.engine);
  teethPlay(b, 0, []);
  assert.equal(ready(b.engine), before, "X = 0 pays 0+0");
  assert.equal(zoneOf(b.engine, b.id("rst")), "discard", "the tactic resolved into its owner's discard pile");
  assert.deepEqual(handOf(b.engine, P2).length, 5, "nothing discarded");
});

for (const x of [1, 2, 3, 4]) {
  clause(TEETH, "0:ability", `X=${x}: pays exactly X+X (${2 * x}) and the opponent discards exactly the ${x} card(s) you choose`, () => {
    const b = teethBoard();
    const before = ready(b.engine);
    const picks = ["oh1", "oh3", "oh5", "oh2"].slice(0, x);
    teethPlay(b, x, picks);
    assert.equal(before - ready(b.engine), 2 * x, `pays ${x}+${x} (the printed cost is 0)`);
    for (const key of ["oh1", "oh2", "oh3", "oh4", "oh5"]) {
      assert.equal(zoneOf(b.engine, b.id(key)), picks.includes(key) ? "discard" : "hand", `${key}`);
    }
    assert.deepEqual(sorted(discardOf(b.engine, P2).filter((c) => c !== b.id("oppDiscard"))), sorted(picks.map(b.id)), "into the OPPONENT's discard pile");
    assert.equal(zoneOf(b.engine, b.id("myHand")), "hand", "your own hand is untouched");
    assert.equal(zoneOf(b.engine, b.id("inPlay")), "play", "their cards in play are untouched");
    assert.equal(zoneOf(b.engine, b.id("oppDeck")), "deck", "their deck is untouched");
    assert.equal(zoneOf(b.engine, b.id("rst")), "discard");
    assert.deepEqual(discardOf(b.engine, P1), [b.id("rst")], "the discard happened to the opponent, not you");
  });
}

clause(TEETH, "0:ability", "the numeric cost is paid by attaching resources to your faction (X=3 attaches 6)", () => {
  const b = teethBoard({ obsession: 8 });
  teethPlay(b, 3, ["oh1", "oh2", "oh3"]);
  const attached = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === factionOf(b.engine, P1));
  assert.equal(attached.length, 6, "exactly 6 resources are attached to the faction");
  assert.equal(ready(b.engine), 2);
});

clause(TEETH, "0:ability", "'X or fewer': choosing fewer than X cards (or none) discards only those, and X is paid in full anyway", () => {
  for (const picks of [["oh2"], [], ["oh4", "oh5"]]) {
    const b = teethBoard();
    const before = ready(b.engine);
    teethPlay(b, 3, picks);
    assert.equal(before - ready(b.engine), 6, `X=3 is paid in full when choosing ${picks.length}`);
    assert.equal(discardOf(b.engine, P2).filter((c) => c !== b.id("oppDiscard")).length, picks.length, `chose ${picks.length}`);
    for (const key of picks) assert.equal(zoneOf(b.engine, b.id(key)), "discard");
    for (const key of ["oh1", "oh2", "oh3", "oh4", "oh5"].filter((k) => !picks.includes(k))) assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} stays`);
  }
});

clause(TEETH, "0:ability", "you cannot choose MORE than X cards: three for X=2 and two for X=1 are refused, and X cards are accepted", () => {
  const b = teethBoard();
  play(b.engine, P1, b.id("rst"), { variables: { x: 2 } });
  refused(() => pickRaw(b.engine, ["oh1", "oh2", "oh3"].map(b.id)), "three cards for X=2");
  assert.equal(handOf(b.engine, P2).length, 5, "nothing was discarded by the refused answer");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  pick(b.engine, ["oh1", "oh2"].map(b.id));
  assert.equal(discardOf(b.engine, P2).filter((c) => c !== b.id("oppDiscard")).length, 2);

  const one = teethBoard();
  play(one.engine, P1, one.id("rst"), { variables: { x: 1 } });
  refused(() => pickRaw(one.engine, ["oh1", "oh2"].map(one.id)), "two cards for X=1");
  pick(one.engine, [one.id("oh4")]);
  assert.equal(zoneOf(one.engine, one.id("oh4")), "discard");
  assert.equal(zoneOf(one.engine, one.id("oh1")), "hand");
});

clause(TEETH, "0:ability", "X=0 chooses no cards at all: the choice (if offered) refuses a card", () => {
  const b = teethBoard();
  play(b.engine, P1, b.id("rst"), { variables: { x: 0 } });
  if (pending(b.engine)) {
    refused(() => pickRaw(b.engine, [b.id("oh1")]), "X = 0 allows no cards");
    pick(b.engine, []);
  }
  assert.equal(handOf(b.engine, P2).length, 5);
  assert.equal(discardOf(b.engine, P2).filter((c) => c !== b.id("oppDiscard")).length, 0);
});

clause(TEETH, "0:ability", "only cards in the OPPONENT's HAND can be chosen: your hand, their play area, discard pile and deck are refused", () => {
  const b = teethBoard();
  play(b.engine, P1, b.id("rst"), { variables: { x: 2 } });
  refused(() => pickRaw(b.engine, [b.id("myHand")]), "a card from your own hand");
  refused(() => pickRaw(b.engine, [b.id("inPlay")]), "a card in their play area");
  refused(() => pickRaw(b.engine, [b.id("oppDiscard")]), "a card in their discard pile");
  refused(() => pickRaw(b.engine, [b.id("oppDeck")]), "a card in their deck");
  refused(() => pickRaw(b.engine, [b.id("oh1"), b.id("myHand")]), "a legal card plus an illegal one");
  refused(() => pickRaw(b.engine, [factionOf(b.engine, P2)]), "their faction");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still open after the refusals");
  assert.equal(handOf(b.engine, P2).length, 5);
  pick(b.engine, [b.id("oh1")]);
  assert.equal(zoneOf(b.engine, b.id("oh1")), "discard", "control: a card of their hand is accepted");
});

clause(TEETH, "0:ability", "the same card cannot be chosen twice (X=2, 'oh1' twice discards nothing and is refused)", () => {
  const b = teethBoard();
  play(b.engine, P1, b.id("rst"), { variables: { x: 2 } });
  refused(() => pickRaw(b.engine, [b.id("oh1"), b.id("oh1")]), "the same card twice");
  assert.equal(zoneOf(b.engine, b.id("oh1")), "hand");
  pick(b.engine, [b.id("oh1"), b.id("oh2")]);
  assert.equal(discardOf(b.engine, P2).filter((c) => c !== b.id("oppDiscard")).length, 2);
});

clause(TEETH, "0:ability", "YOU choose (the opponent is not asked and cannot answer for you)", () => {
  const b = teethBoard();
  play(b.engine, P1, b.id("rst"), { variables: { x: 1 } });
  assert.equal(pending(b.engine)?.playerId, P1);
  refused(() => pickRaw(b.engine, [b.id("oh1")], P2), "the opponent cannot make your choice");
  assert.equal(zoneOf(b.engine, b.id("oh1")), "hand");
});

clause(TEETH, "0:ability", "'cards in it' includes resource cards and tactics: any card of the hand can be chosen", () => {
  const b = teethBoard({
    oppHand: 0,
    extra: [
      { key: "rc", def: resourceCard({ name: "StapleRage" }), owner: P2, zone: "hand" },
      { key: "tc", def: tactic({ name: "TheirTactic" }), owner: P2, zone: "hand" },
      { key: "ic", def: item({ name: "TheirItem" }), owner: P2, zone: "hand" },
      { key: "lc", def: location({ name: "TheirPlace" }), owner: P2, zone: "hand" }
    ]
  });
  teethPlay(b, 4, ["rc", "tc", "ic", "lc"]);
  assert.deepEqual(handOf(b.engine, P2), [], "all four cards (resource, tactic, item, location) were discarded");
  assert.equal(discardOf(b.engine, P2).filter((c) => c !== b.id("oppDiscard")).length, 4);
});

clause(TEETH, "0:ability", "with fewer cards in their hand than X, you choose from what they have", () => {
  const b = teethBoard({ oppHand: 1 });
  teethPlay(b, 3, ["oh1"]);
  assert.equal(zoneOf(b.engine, b.id("oh1")), "discard");
  assert.deepEqual(handOf(b.engine, P2), []);
});

clause(TEETH, "0:ability", "an opponent with no hand: the cost is still paid, nothing is discarded, and nothing is left pending", () => {
  const b = teethBoard({ oppHand: 0 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("rst"), { variables: { x: 2 } });
  if (pending(b.engine)) pick(b.engine, []);
  assert.equal(before - ready(b.engine), 4);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oppDiscard")], "their discard pile only holds what it already did");
  assert.equal(zoneOf(b.engine, b.id("rst")), "discard");
});

clause(TEETH, "0:ability", "Pay X+X must be affordable: X=2 needs 4 resources (3 is refused, nothing is spent), 4 works", () => {
  const three = teethBoard({ obsession: 3 });
  refused(() => playRaw(three.engine, P1, three.id("rst"), { variables: { x: 2 } }), "3 resources cannot pay 2+2");
  assert.equal(zoneOf(three.engine, three.id("rst")), "hand");
  assert.equal(ready(three.engine), 3, "nothing was spent");
  playRaw(three.engine, P1, three.id("rst"), { variables: { x: 1 } });
  assert.ok(three.engine.state.responseWindow, "control: X=1 (2 resources) can be paid");

  const four = teethBoard({ obsession: 4 });
  teethPlay(four, 2, ["oh1", "oh2"]);
  assert.equal(ready(four.engine), 0, "exactly 4 resources pays for X=2");
  assert.equal(discardOf(four.engine, P2).filter((c) => c !== four.id("oppDiscard")).length, 2);
});

clause(TEETH, "0:ability", "a big X: X=4 needs 8 resources, 7 is refused", () => {
  const seven = teethBoard({ obsession: 7 });
  refused(() => playRaw(seven.engine, P1, seven.id("rst"), { variables: { x: 4 } }), "7 resources cannot pay 4+4");
  const eight = teethBoard({ obsession: 8 });
  teethPlay(eight, 4, ["oh1", "oh2", "oh3", "oh4"]);
  assert.equal(ready(eight.engine), 0);
});

clause(TEETH, "0:ability", "needs [O][O][O] even though its cost is 0: two [O] with plenty of other resources is refused, three is enough", () => {
  const two = teethBoard({ obsession: 2, greed: 6 });
  refused(() => playRaw(two.engine, P1, two.id("rst"), { variables: { x: 0 } }), "X=0 with only [O][O]");
  refused(() => playRaw(two.engine, P1, two.id("rst"), { variables: { x: 1 } }), "X=1 with only [O][O]");
  assert.equal(two.engine.getCardPlayability(P1, two.id("rst")).playable, false);
  assert.equal(zoneOf(two.engine, two.id("rst")), "hand");
  const three = teethBoard({ obsession: 3, greed: 0 });
  assert.equal(three.engine.getCardPlayability(P1, three.id("rst")).playable, true);
  const mixed = teethBoard({ obsession: 3, greed: 4 });
  teethPlay(mixed, 2, ["oh1", "oh2"]);
  assert.equal(discardOf(mixed.engine, P2).filter((c) => c !== mixed.id("oppDiscard")).length, 2, "[O][O][O] gates it; other resources help pay the 2+2");
});

clause(TEETH, "0:ability", "the [O] icons are not spent: X=1 with exactly [O][O][O] plus one more resource pays 2 and the icons still count afterwards", () => {
  const b = teethBoard({ obsession: 3, greed: 0 });
  assert.equal(b.engine.getCardPlayability(P1, b.id("rst")).playable, true);
  teethPlay(b, 1, ["oh1"]);
  assert.equal(ready(b.engine), 1, "3 resources, 2 paid");
});

clause(TEETH, "0:ability", "X is a whole number >= 0: a negative X is refused and spends nothing", () => {
  const b = teethBoard();
  refused(() => playRaw(b.engine, P1, b.id("rst"), { variables: { x: -1 } }), "X = -1");
  assert.equal(zoneOf(b.engine, b.id("rst")), "hand");
  assert.equal(ready(b.engine), 8);
});

clause(TEETH, "0:ability", "X is a whole number: 1.5 is refused (CR 410.2) and spends nothing", () => {
  const b = teethBoard();
  refused(() => playRaw(b.engine, P1, b.id("rst"), { variables: { x: 1.5 } }), "X = 1.5");
  assert.equal(zoneOf(b.engine, b.id("rst")), "hand");
  assert.equal(ready(b.engine), 8, "nothing was spent");
});

clause(TEETH, "0:ability", "the cost is paid when it is played (before the opponent can respond); the discard happens only when it resolves", () => {
  const b = teethBoard();
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("rst"), { variables: { x: 2 } });
  assert.equal(before - ready(b.engine), 4, "X+X is paid as a cost");
  assert.equal(discardOf(b.engine, P2).filter((c) => c !== b.id("oppDiscard")).length, 0, "nothing discarded yet");
  assert.equal(pending(b.engine), undefined, "the choice is made on resolution, not while waiting for responses");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(b.engine, b.id("rst")), "deploying");
});

clause(TEETH, "0:ability", "the hand you look at is the hand when it RESOLVES: a card the opponent draws in response can be chosen", () => {
  const b = teethBoard({
    oppHand: 1,
    extra: [{ key: "cantrip", def: drawTactic("Cantrip", 1), owner: P2, zone: "hand" }]
  });
  const topOfDeck = deckOf(b.engine, P2)[0];
  playRaw(b.engine, P1, b.id("rst"), { variables: { x: 2 } });
  playRaw(b.engine, P2, b.id("cantrip"));
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.ok(handOf(b.engine, P2).includes(topOfDeck), "the opponent drew in response");
  pick(b.engine, [topOfDeck]);
  assert.equal(zoneOf(b.engine, topOfDeck), "discard", "the freshly drawn card was in the hand being looked at");
});

clause(TEETH, "0:ability", "a card the opponent plays out of their hand in response can no longer be chosen", () => {
  const b = teethBoard({
    oppHand: 2,
    extra: [{ key: "cantrip", def: drawTactic("Cantrip", 0), owner: P2, zone: "hand" }]
  });
  playRaw(b.engine, P1, b.id("rst"), { variables: { x: 3 } });
  playRaw(b.engine, P2, b.id("cantrip"));
  resolvePendingResponses(b.engine);
  refused(() => pickRaw(b.engine, [b.id("cantrip")]), "the played tactic is no longer in their hand");
  pick(b.engine, [b.id("oh1"), b.id("oh2")]);
  assert.deepEqual(handOf(b.engine, P2), []);
});

clause(TEETH, "0:ability", "it is a tactic: it can be played in response to the opponent's attack on their turn, and it works", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "rst", def: printing(TEETH), owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" },
      { key: "oh2", def: character({ name: "OH2" }), owner: P2, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  refused(() => playRaw(b.engine, P1, b.id("rst"), { variables: { x: 1 } }), "nothing to respond to on the opponent's quiet turn");
  openWindowOnP2Attack(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("rst"), { variables: { x: 1 } });
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.playerId, P1);
  pick(b.engine, [b.id("oh1")]);
  assert.equal(zoneOf(b.engine, b.id("oh1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("oh2")), "hand");
  assert.equal(ready(b.engine), 2, "paid 1+1");
});

clause(TEETH, "0:ability", "it can be played on your own turn with nothing to respond to", () => {
  const b = teethBoard({ turn: 1, active: P1 });
  assert.equal(b.engine.getCardPlayability(P1, b.id("rst")).playable, true);
  teethPlay(b, 1, ["oh5"]);
  assert.equal(zoneOf(b.engine, b.id("oh5")), "discard");
});

clause(TEETH, "0:ability", "'your opponent' is relative to the caster: P2 casting it makes P1 discard", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "rst", def: printing(TEETH), owner: P2, zone: "hand" },
      { key: "p1a", def: character({ name: "P1A" }), owner: P1, zone: "hand" },
      { key: "p1b", def: character({ name: "P1B" }), owner: P1, zone: "hand" },
      { key: "p2a", def: character({ name: "P2A" }), owner: P2, zone: "hand" },
      ...bank("obsession", 4, P2)
    ]
  });
  play(b.engine, P2, b.id("rst"), { variables: { x: 1 } });
  assert.equal(pending(b.engine)?.playerId, P2, "the caster chooses");
  refused(() => pickRaw(b.engine, [b.id("p2a")]), "their own hand is not the opponent's hand");
  pick(b.engine, [b.id("p1b")]);
  assert.equal(zoneOf(b.engine, b.id("p1b")), "discard");
  assert.ok(discardOf(b.engine, P1).includes(b.id("p1b")), "P1's discard pile");
  assert.equal(zoneOf(b.engine, b.id("p2a")), "hand");
});

// =============================================================================
// Rummaging Millipede
// COVERT
// When this card enters play, you may pick a tactic in your discard pile. If you
// do, put it into your hand.
// Character (arcanist; lurker), cost 5, threshold [O][O], 3 strength / 3 speed / 1 life.
// =============================================================================

const MILLIPEDE = "ff956c3c-377a-45b8-9c53-b3a503e73701";

clause(MILLIPEDE, "0:kw:COVERT", "has the COVERT keyword (and an ordinary character does not)", () => covertHasKeyword(MILLIPEDE));
clause(MILLIPEDE, "0:kw:COVERT", "cannot be blocked by non-covert characters, alone or alongside a covert one; a covert character can block it", () => covertCannotBeBlockedByNonCovert(MILLIPEDE));
clause(MILLIPEDE, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(MILLIPEDE));
clause(MILLIPEDE, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(MILLIPEDE));

function millipedeBoard(opts: { obsession?: number; greed?: number; extra?: CardPlacement[]; tactics?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mm", def: printing(MILLIPEDE), owner: P1, zone: "hand" },
      ...(opts.tactics === false
        ? []
        : [
            { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "discard" as const },
            { key: "tacB", def: tactic({ name: "TacB" }), owner: P1, zone: "discard" as const }
          ]),
      { key: "chrD", def: character({ name: "ChrD" }), owner: P1, zone: "discard" },
      { key: "itemD", def: item({ name: "ItemD" }), owner: P1, zone: "discard" },
      { key: "oppTac", def: tactic({ name: "OppTac" }), owner: P2, zone: "discard" },
      { key: "handTac", def: tactic({ name: "HandTac" }), owner: P1, zone: "hand" },
      { key: "deckTac", def: tactic({ name: "DeckTac" }), owner: P1, zone: "deck" },
      { key: "playChar", def: character({ name: "PlayChar" }), owner: P1, zone: "play" },
      ...bank("obsession", opts.obsession ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type MilBoard = ReturnType<typeof millipedeBoard>;
function millipedePlay(b: MilBoard): void {
  play(b.engine, P1, b.id("mm"));
  assert.equal(zoneOf(b.engine, b.id("mm")), "play");
}

clause(MILLIPEDE, "1:rule", "the card itself: costs 5, needs [O][O], and has 3 strength / 3 speed / 1 life", () => {
  const exact = millipedeBoard({ obsession: 2, greed: 3 });
  const before = ready(exact.engine);
  millipedePlay(exact);
  assert.equal(before - ready(exact.engine), 5, "pays exactly 5");
  assert.deepEqual(stats(exact.engine, exact.id("mm")), [3, 1, 3]);
  const short = millipedeBoard({ obsession: 4 });
  refused(() => playRaw(short.engine, P1, short.id("mm")), "4 resources for a cost of 5");
  assert.equal(zoneOf(short.engine, short.id("mm")), "hand");
  const noThreshold = millipedeBoard({ obsession: 1, greed: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("mm")), "one [O] is not [O][O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("mm")), "hand");
});

clause(MILLIPEDE, "1:rule", "when it enters play you may pick a tactic in your discard pile, and it goes into your hand", () => {
  const b = millipedeBoard();
  millipedePlay(b);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "its controller picks");
  const handBefore = [...handOf(b.engine, P1)];
  pick(b.engine, [b.id("tacA")]);
  assert.equal(zoneOf(b.engine, b.id("tacA")), "hand");
  assert.deepEqual(sorted(handOf(b.engine, P1)), sorted([...handBefore, b.id("tacA")]), "the hand gains exactly the picked tactic");
  assert.equal(zoneOf(b.engine, b.id("tacB")), "discard", "the other tactic stays in the discard pile");
  assert.equal(pending(b.engine), undefined);
});

clause(MILLIPEDE, "1:rule", "either tactic in the discard pile can be picked", () => {
  for (const key of ["tacA", "tacB"]) {
    const b = millipedeBoard();
    millipedePlay(b);
    pick(b.engine, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", key);
    assert.equal(zoneOf(b.engine, b.id(key === "tacA" ? "tacB" : "tacA")), "discard");
  }
});

clause(MILLIPEDE, "1:rule", "'you may': picking nothing leaves every tactic in the discard pile and the hand unchanged", () => {
  const b = millipedeBoard();
  millipedePlay(b);
  const handBefore = [...handOf(b.engine, P1)];
  pick(b.engine, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
  assert.equal(zoneOf(b.engine, b.id("tacB")), "discard");
  assert.deepEqual(handOf(b.engine, P1), handBefore);
});

clause(MILLIPEDE, "1:rule", "only a TACTIC in YOUR discard pile: a character or item there, the opponent's discard pile, your hand, deck and play area are refused", () => {
  const b = millipedeBoard();
  millipedePlay(b);
  refused(() => pickRaw(b.engine, [b.id("chrD")]), "a character in your discard pile");
  refused(() => pickRaw(b.engine, [b.id("itemD")]), "an item in your discard pile");
  refused(() => pickRaw(b.engine, [b.id("oppTac")]), "a tactic in the opponent's discard pile");
  refused(() => pickRaw(b.engine, [b.id("handTac")]), "a tactic in your hand");
  refused(() => pickRaw(b.engine, [b.id("deckTac")]), "a tactic in your deck");
  refused(() => pickRaw(b.engine, [b.id("playChar")]), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("mm")]), "the Millipede itself");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(b.engine, [b.id("tacB")]);
  assert.equal(zoneOf(b.engine, b.id("tacB")), "hand", "control: a tactic in your discard pile is accepted");
});

clause(MILLIPEDE, "1:rule", "only ONE tactic is returned: two at once is refused and nothing moves", () => {
  const b = millipedeBoard();
  millipedePlay(b);
  refused(() => pickRaw(b.engine, [b.id("tacA"), b.id("tacB")]));
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
  assert.equal(zoneOf(b.engine, b.id("tacB")), "discard");
});

clause(MILLIPEDE, "1:rule", "with no tactic in your discard pile there is nothing to pick: no choice is asked and the hand is unchanged", () => {
  const b = millipedeBoard({ tactics: false });
  const handBefore = handOf(b.engine, P1).filter((c) => c !== b.id("mm"));
  millipedePlay(b);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(sorted(handOf(b.engine, P1)), sorted(handBefore));
  assert.equal(zoneOf(b.engine, b.id("chrD")), "discard");
});

clause(MILLIPEDE, "1:rule", "the tactic returns when it ENTERS play, not while the Millipede waits for responses", () => {
  const b = millipedeBoard();
  playRaw(b.engine, P1, b.id("mm"));
  assert.equal(zoneOf(b.engine, b.id("mm")), "deploying");
  assert.equal(pending(b.engine), undefined, "nothing is picked yet");
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "now it has entered play");
});

clause(MILLIPEDE, "1:rule", "a tactic you played earlier this turn (now in the discard pile) can be picked", () => {
  const b = millipedeBoard({ tactics: false, extra: [{ key: "pre", def: drawTactic("Pre", 1), owner: P1, zone: "hand" }] });
  // The cantrip is played first so a tactic is in the discard pile when the Millipede enters play.
  play(b.engine, P1, b.id("pre"));
  assert.equal(zoneOf(b.engine, b.id("pre")), "discard");
  millipedePlay(b);
  pick(b.engine, [b.id("pre")]);
  assert.equal(zoneOf(b.engine, b.id("pre")), "hand");
});

clause(MILLIPEDE, "1:rule", "it triggers only when THIS card enters play: another character of mine entering play asks nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mm", def: printing(MILLIPEDE), owner: P1, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" },
      { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "discard" }
    ]
  });
  play(b.engine, P1, b.id("newbie"));
  assert.equal(zoneOf(b.engine, b.id("newbie")), "play");
  assert.equal(pending(b.engine), undefined, "no pick for another card entering play");
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
});

clause(MILLIPEDE, "1:rule", "it does not trigger when it leaves play", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mm", def: printing(MILLIPEDE), owner: P1, zone: "play" },
      { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "discard" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mm")] } });
  assert.equal(zoneOf(b.engine, b.id("mm")), "discard");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("tacA")), "discard");
});

clause(MILLIPEDE, "1:rule", "'enters play' includes being put into play by an effect (not deployed)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      {
        key: "putter",
        def: tactic({
          name: "Putter",
          cost: 0,
          behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
        }),
        owner: P1,
        zone: "hand"
      },
      { key: "mm", def: printing(MILLIPEDE), owner: P1, zone: "hand" },
      { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "discard" }
    ]
  });
  const putter = b.id("putter");
  play(b.engine, P1, putter, { selected: { t: [b.id("mm")] } });
  assert.equal(zoneOf(b.engine, b.id("mm")), "play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the entering-play pick opens");
  pick(b.engine, [b.id("tacA")]);
  assert.equal(zoneOf(b.engine, b.id("tacA")), "hand");
  assert.equal(zoneOf(b.engine, putter), "discard", "the putting tactic itself resolved into the discard pile");
});

clause(MILLIPEDE, "1:rule", "'your discard pile' is the controller's: P2's Millipede offers P2's tactics and refuses P1's", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mm", def: printing(MILLIPEDE), owner: P2, zone: "hand" },
      { key: "mine", def: tactic({ name: "MineTac" }), owner: P1, zone: "discard" },
      { key: "theirs", def: tactic({ name: "TheirTac" }), owner: P2, zone: "discard" },
      ...bank("obsession", 5, P2)
    ]
  });
  play(b.engine, P2, b.id("mm"));
  assert.equal(pending(b.engine)?.playerId, P2);
  refused(() => pickRaw(b.engine, [b.id("mine")]), "the other player's discard pile");
  pick(b.engine, [b.id("theirs")]);
  assert.ok(handOf(b.engine, P2).includes(b.id("theirs")), "into P2's hand");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
});

clause(MILLIPEDE, "1:rule", "the Millipede stays in play and the tactic it returned can be played again from the hand", () => {
  const b = millipedeBoard({ tactics: false, extra: [{ key: "pre", def: drawTactic("Pre", 1), owner: P1, zone: "hand" }, { key: "dk", def: character({ name: "DeckCard" }), owner: P1, zone: "deck" }] });
  play(b.engine, P1, b.id("pre"));
  millipedePlay(b);
  pick(b.engine, [b.id("pre")]);
  assert.equal(zoneOf(b.engine, b.id("mm")), "play");
  play(b.engine, P1, b.id("pre"));
  assert.equal(zoneOf(b.engine, b.id("pre")), "discard", "played again");
});

// =============================================================================
// Servile Centipede
// When this card enters play, you may search your deck for a tactic and reveal
// it. If you do, put it into your hand.
// Character (arcanist; lurker), cost 4, threshold [O], 1 strength / 3 speed / 3 life.
// =============================================================================

const CENTIPEDE = "6d042680-d2e0-42a0-a99c-600d30c8625d";

/** Every logged event of one type. */
function eventsOf(engine: SpoilsEngine, type: string): Array<Record<string, unknown>> {
  return engine
    .getLog()
    .filter((entry) => (entry as { event?: { type?: string } }).event?.type === type)
    .map((entry) => (entry as unknown as { event: Record<string, unknown> }).event);
}

/** Index in the log of the first event satisfying `test`, or -1. */
function logIndex(engine: SpoilsEngine, test: (event: Record<string, unknown>) => boolean): number {
  return engine.getLog().findIndex((entry) => {
    const event = (entry as { event?: Record<string, unknown> }).event;
    return event !== undefined && test(event);
  });
}

/** Answers an open `selectTargets` choice with `selected` (declaration id → cards) and drains responses. */
function pickTargets(engine: SpoilsEngine, selected: Record<string, CardInstanceId[]>, player?: Pid): void {
  const who = player ?? (pending(engine)!.playerId as Pid);
  engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "selectTargets", selected } } as never);
  resolvePendingResponses(engine);
}

/** `pickTargets` without draining, for refusal checks. */
function pickTargetsRaw(engine: SpoilsEngine, selected: Record<string, CardInstanceId[]>, player?: Pid): void {
  const who = player ?? (pending(engine)!.playerId as Pid);
  engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "selectTargets", selected } } as never);
}

function centipedeBoard(opts: { zone?: "hand" | "play"; obsession?: number; greed?: number; tacticsInDeck?: boolean; controller?: Pid; extra?: CardPlacement[]; random?: () => number } = {}) {
  const owner = opts.controller ?? P1;
  const opp = other(owner);
  const withTactics = opts.tacticsInDeck !== false;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: owner === P1 ? 1 : 2,
    activePlayerId: owner,
    random: opts.random,
    cards: [
      { key: "sc", def: printing(CENTIPEDE), owner, zone: opts.zone ?? "hand" },
      { key: "c1", def: character({ name: "C1" }), owner, zone: "deck" },
      ...(withTactics ? [{ key: "tacA", def: tactic({ name: "TacA" }), owner, zone: "deck" as const }] : []),
      { key: "c2", def: character({ name: "C2" }), owner, zone: "deck" },
      ...(withTactics ? [{ key: "tacB", def: tactic({ name: "TacB" }), owner, zone: "deck" as const }] : []),
      { key: "c3", def: character({ name: "C3" }), owner, zone: "deck" },
      { key: "c4", def: item({ name: "C4" }), owner, zone: "deck" },
      { key: "c5", def: character({ name: "C5" }), owner, zone: "deck" },
      { key: "handTac", def: tactic({ name: "HandTac" }), owner, zone: "hand" },
      { key: "discTac", def: tactic({ name: "DiscTac" }), owner, zone: "discard" },
      { key: "otherChar", def: character({ name: "OtherChar", cost: 0 }), owner, zone: "hand" },
      { key: "oppTac", def: tactic({ name: "OppTac" }), owner: opp, zone: "deck" },
      { key: "oppC1", def: character({ name: "OppC1" }), owner: opp, zone: "deck" },
      { key: "oppC2", def: character({ name: "OppC2" }), owner: opp, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 4, owner),
      ...bank("greed", opts.greed ?? 0, owner),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays the Centipede and leaves its search prompt open. */
function playCentipede(opts: Parameters<typeof centipedeBoard>[0] = {}) {
  const built = centipedeBoard(opts);
  play(built.engine, opts?.controller ?? P1, built.id("sc"));
  return built;
}

clause(CENTIPEDE, "0:rule", "the card itself: costs 4, needs [O], 1 strength / 3 speed / 3 life, and offers its controller a search when it enters play", () => {
  const { engine, id } = centipedeBoard({ obsession: 1, greed: 3 });
  const before = ready(engine);
  play(engine, P1, id("sc"));
  assert.equal(zoneOf(engine, id("sc")), "play");
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  const pc = pending(engine)!;
  assert.ok(pc, "a search is offered");
  assert.equal(pc.playerId, P1, "to its controller");
  assert.deepEqual(stats(engine, id("sc")), [1, 3, 3]);
});

clause(CENTIPEDE, "0:rule", "deploy restrictions: one resource short or no [O] is refused", () => {
  const short = centipedeBoard({ obsession: 3 });
  refused(() => playRaw(short.engine, P1, short.id("sc")), "3 resources for a cost of 4");
  assert.equal(zoneOf(short.engine, short.id("sc")), "hand");
  const noThreshold = centipedeBoard({ obsession: 0, greed: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("sc")), "no [O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("sc")), "hand");
});

for (const found of ["tacA", "tacB"] as const) {
  clause(CENTIPEDE, "0:rule", `searching and finding ${found}: it goes from the deck to your hand and no other card moves`, () => {
    const { engine, id } = centipedeBoard();
    const handBefore = [...handOf(engine, P1)];
    const deckBefore = [...deckOf(engine, P1)];
    play(engine, P1, id("sc"));
    pickTargets(engine, { target: [id(found)] });
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, id(found)), "hand");
    assert.deepEqual(sorted(handOf(engine, P1)), sorted([...handBefore.filter((c) => c !== id("sc")), id(found)]), "the hand gains exactly the found tactic");
    assert.deepEqual(sorted(deckOf(engine, P1)), sorted(deckBefore.filter((c) => c !== id(found))), "the rest of the deck is the same cards");
    assert.equal(zoneOf(engine, id(found === "tacA" ? "tacB" : "tacA")), "deck", "only ONE tactic is taken");
    assert.equal(zoneOf(engine, id("sc")), "play", "the Centipede stays in play");
  });
}

clause(CENTIPEDE, "0:rule", "'and reveal it': the found tactic is revealed to everyone, exactly once, before it goes into your hand", () => {
  const { engine, id } = centipedeBoard();
  play(engine, P1, id("sc"));
  pickTargets(engine, { target: [id("tacB")] });
  const reveals = eventsOf(engine, "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  assert.deepEqual(reveals[0].cardIds, [id("tacB")], "exactly the tactic that was found");
  assert.equal(reveals[0].viewerId, "all", "revealed to every player");
  const revealAt = logIndex(engine, (e) => e.type === "cardsRevealed");
  const moveAt = logIndex(engine, (e) => e.type === "cardMoved" && e.cardId === id("tacB") && e.to === "hand");
  assert.ok(revealAt >= 0 && moveAt > revealAt, "revealed first, then put into the hand");
});

clause(CENTIPEDE, "0:rule", "only a TACTIC in YOUR DECK can be found: characters, items, a tactic in your hand or discard pile or in the opponent's deck are refused", () => {
  const { engine, id } = playCentipede();
  refused(() => pickTargetsRaw(engine, { target: [id("c1")] }), "a character in the deck");
  refused(() => pickTargetsRaw(engine, { target: [id("c4")] }), "an item in the deck");
  refused(() => pickTargetsRaw(engine, { target: [id("handTac")] }), "a tactic in hand");
  refused(() => pickTargetsRaw(engine, { target: [id("discTac")] }), "a tactic in the discard pile");
  refused(() => pickTargetsRaw(engine, { target: [id("oppTac")] }), "a tactic in the opponent's deck");
  refused(() => pickTargetsRaw(engine, { target: [id("tacA"), id("tacB")] }), "a tactic = exactly one card");
  assert.equal(pending(engine)?.kind, "selectTargets", "still waiting for a legal answer");
  assert.equal(zoneOf(engine, id("handTac")), "hand");
  assert.equal(zoneOf(engine, id("oppTac")), "deck");
  pickTargets(engine, { target: [id("tacA")] });
  assert.equal(zoneOf(engine, id("tacA")), "hand", "control: a tactic in your deck is accepted");
});

clause(CENTIPEDE, "0:rule", "'you may': declining the search moves nothing, reveals nothing, and leaves the Centipede in play", () => {
  const { engine, id } = playCentipede();
  const handBefore = [...handOf(engine, P1)];
  const deckBefore = [...deckOf(engine, P1)];
  pickTargets(engine, { target: [] });
  assert.equal(pending(engine), undefined);
  assert.deepEqual(sorted(handOf(engine, P1)), sorted(handBefore), "the hand is unchanged");
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted(deckBefore), "no card left the deck");
  assert.equal(eventsOf(engine, "cardsRevealed").length, 0, "nothing was revealed ('If you do')");
  assert.equal(zoneOf(engine, id("tacA")), "deck");
  assert.equal(zoneOf(engine, id("tacB")), "deck");
  assert.equal(zoneOf(engine, id("sc")), "play");
});

clause(CENTIPEDE, "0:rule", "the searched deck is shuffled afterwards (CR 312.1): same cards in a new order", () => {
  const { engine, id } = centipedeBoard();
  const before = deckOf(engine, P1).filter((c) => c !== id("tacA"));
  play(engine, P1, id("sc"));
  pickTargets(engine, { target: [id("tacA")] });
  const after = deckOf(engine, P1);
  assert.deepEqual(sorted(after), sorted(before), "same cards");
  assert.notDeepEqual(after, before, "in a new order");
});

clause(CENTIPEDE, "0:rule", "a search that finds nothing (no tactic in the deck) still shuffles the searched deck (CR 312.1)", () => {
  const { engine, id } = centipedeBoard({ tacticsInDeck: false });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("sc"));
  drain(engine, declineAll);
  assert.deepEqual(sorted(deckOf(engine, P1)), sorted(before), "same cards");
  assert.notDeepEqual(deckOf(engine, P1), before, "shuffled");
});

clause(CENTIPEDE, "0:rule", "'you MAY search': declining takes nothing, reveals nothing, and does not shuffle (nothing was searched)", () => {
  const { engine, id } = playCentipede();
  const deckBefore = [...deckOf(engine, P1)];
  pickTargets(engine, { target: [] });
  assert.deepEqual(deckOf(engine, P1), deckBefore, "the deck is left exactly as it was: no search happened");
  assert.equal(zoneOf(engine, id("sc")), "play");
});

clause(CENTIPEDE, "0:rule", "only YOUR deck is searched and shuffled: the opponent's deck, hand and discard pile are untouched", () => {
  const { engine, id } = centipedeBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  const oppDiscard = [...discardOf(engine, P2)];
  play(engine, P1, id("sc"));
  pickTargets(engine, { target: [id("tacA")] });
  assert.deepEqual(deckOf(engine, P2), oppDeck, "same cards, same order");
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(discardOf(engine, P2), oppDiscard);
});

clause(CENTIPEDE, "0:rule", "a deck with no tactic in it: nothing can be found, the hand is unchanged, nothing is revealed, and the Centipede is in play", () => {
  const { engine, id } = centipedeBoard({ tacticsInDeck: false });
  const handBefore = handOf(engine, P1).filter((c) => c !== id("sc"));
  play(engine, P1, id("sc"));
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(sorted(handOf(engine, P1)), sorted(handBefore));
  assert.equal(eventsOf(engine, "cardsRevealed").length, 0);
  assert.equal(zoneOf(engine, id("sc")), "play");
});

clause(CENTIPEDE, "0:rule", "it triggers when THIS card enters play, not when another card enters play (mine or the opponent's)", () => {
  const { engine, id } = centipedeBoard({ zone: "play" });
  const deckBefore = [...deckOf(engine, P1)];
  play(engine, P1, id("otherChar"));
  assert.equal(zoneOf(engine, id("otherChar")), "play");
  assert.equal(pending(engine), undefined, "no search when another card of mine enters play");
  assert.deepEqual(deckOf(engine, P1), deckBefore);

  const theirs = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sc", def: printing(CENTIPEDE), owner: P1, zone: "play" },
      { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" },
      { key: "theirChar", def: character({ name: "TheirChar", cost: 0 }), owner: P2, zone: "hand" }
    ]
  });
  play(theirs.engine, P2, theirs.id("theirChar"));
  assert.equal(pending(theirs.engine), undefined, "no search when the opponent's card enters play");
  assert.equal(zoneOf(theirs.engine, theirs.id("tac")), "deck");
});

clause(CENTIPEDE, "0:rule", "a second Centipede entering play searches once, for the newcomer only", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "old", def: printing(CENTIPEDE), owner: P1, zone: "play" },
      { key: "new", def: printing(CENTIPEDE), owner: P1, zone: "hand" },
      { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "deck" },
      { key: "tacB", def: tactic({ name: "TacB" }), owner: P1, zone: "deck" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "deck" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(engine, P1, id("new"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.sourceId, id("new"), "the entering Centipede's trigger");
  pickTargets(engine, { target: [id("tacA")] });
  assert.equal(pending(engine), undefined, "no second search for the Centipede that was already in play");
  assert.equal(zoneOf(engine, id("tacB")), "deck");
});

clause(CENTIPEDE, "0:rule", "it does not search when it leaves play", () => {
  const killer = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sc", def: printing(CENTIPEDE), owner: P1, zone: "play" },
      { key: "killer", def: killTactic(), owner: P1, zone: "hand" },
      { key: "tac", def: tactic({ name: "Tac" }), owner: P1, zone: "deck" }
    ]
  });
  play(killer.engine, P1, killer.id("killer"), { selected: { t: [killer.id("sc")] } });
  drain(killer.engine, declineAll);
  assert.equal(zoneOf(killer.engine, killer.id("sc")), "discard");
  assert.equal(zoneOf(killer.engine, killer.id("tac")), "deck", "leaving play does not search");
  assert.equal(eventsOf(killer.engine, "cardsRevealed").length, 0);
});

clause(CENTIPEDE, "0:rule", "'enters play' includes being put into play by an effect, not only being deployed from hand", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      {
        key: "putter",
        def: tactic({
          name: "Putter",
          cost: 0,
          behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
        }),
        owner: P1,
        zone: "hand"
      },
      { key: "sc", def: printing(CENTIPEDE), owner: P1, zone: "hand" },
      { key: "tacA", def: tactic({ name: "TacA" }), owner: P1, zone: "deck" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "deck" }
    ]
  });
  const before = ready(engine);
  play(engine, P1, id("putter"), { selected: { t: [id("sc")] } });
  assert.equal(zoneOf(engine, id("sc")), "play");
  assert.equal(ready(engine), before, "put into play: no cost paid");
  assert.ok(pending(engine), "the search is offered");
  pickTargets(engine, { target: [id("tacA")] });
  assert.equal(zoneOf(engine, id("tacA")), "hand");
});

clause(CENTIPEDE, "0:rule", "the controller's deck is searched: P2's Centipede searches P2's deck, the tactic goes to P2's hand, P1's tactic cannot be found", () => {
  const { engine, id } = centipedeBoard({ controller: P2 });
  play(engine, P2, id("sc"));
  const pc = pending(engine)!;
  assert.equal(pc.playerId, P2, "the Centipede's controller searches");
  refused(() => pickTargetsRaw(engine, { target: [id("oppTac")] }, P2), "the other player's tactic cannot be found");
  pickTargets(engine, { target: [id("tacA")] }, P2);
  assert.ok(handOf(engine, P2).includes(id("tacA")), "it goes to the searcher's hand");
  assert.equal(zoneOf(engine, id("oppTac")), "deck", "the other player's deck is untouched");
});

// --- shared helpers for the two "play a card for free" tactics ----------------------

/** The names the caster is offered by the open `deployForFree` choice (sorted). */
function offered(engine: SpoilsEngine): string[] {
  const pc = pending(engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "deployForFree", "the caster is asked whether to play a card for free");
  return pc.candidates.map((c) => engine.getDefinition(c).name).sort();
}

/** Answers the open `deployForFree` choice (a card, or nothing to decline) as `player`. */
function freePlay(engine: SpoilsEngine, cardId?: CardInstanceId, selected?: Record<string, CardInstanceId[]>, player: Pid = P1): void {
  assert.equal(pending(engine)?.playerId, player, "the caster decides on the free play");
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "deployForFree", cardId, selected } } as never);
  resolvePendingResponses(engine);
}

/** Tries the free play without draining (for refusal checks). */
function freePlayRaw(engine: SpoilsEngine, cardId: CardInstanceId, selected?: Record<string, CardInstanceId[]>, player: Pid = P1): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "deployForFree", cardId, selected } } as never);
}

/** A tactic costing `cost` that destroys one picked character when it resolves (id `s`, declaration `t`). */
function sniperTactic(name = "Sniper", cost = 1): Def {
  return tactic({
    name,
    cost,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
}

/** A tactic costing `cost` with the extra cost "pay `n`" and the effect "draw a card". */
function payExtraTactic(n: number, name = "Costly", cost = 1): Def {
  return tactic({
    name,
    cost,
    behavior: { abilities: [{ id: "c", type: "activated", costs: [{ type: "payResources", amount: n }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
}

/** A character costing `cost` with the extra cost "lose `n` influence". */
function influenceTaxChar(n: number, name = "Taxed", cost = 1): Def {
  return character({ name, cost, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: n }] } } });
}

// =============================================================================
// Spontaneous Displacement
// COST: Pick a non-resource card. X is half its numeric cost, rounded up.
// EFFECT: Put the card into its owner's hand. You may play a non-resource card
// with numeric cost X or less for free. (You still need to meet its threshold and
// satisfy its extra costs.)
// Tactic (arcanist), cost 4, threshold [O][O][O].
// =============================================================================

const DISPLACEMENT = "34e2b8f1-9b0f-4d38-9f54-6494a9f0c079";

function displacementBoard(opts: { obsession?: number; greed?: number; hand?: Def[]; foeCosts?: number[]; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  const hand = opts.hand ?? Array.from({ length: 10 }, (_, i) => character({ name: `H${i}`, cost: i }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "sd", def: printing(DISPLACEMENT), owner: P1, zone: "hand" },
      ...hand.map((def) => ({ key: `h:${def.name}`, def, owner: P1, zone: "hand" as const })),
      ...(opts.foeCosts ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).map((cost) => ({ key: `foe${cost}`, def: character({ name: `Foe${cost}`, cost }), owner: P2, zone: "play" as const })),
      { key: "myChar", def: character({ name: "MyChar", cost: 1 }), owner: P1, zone: "play" },
      { key: "myChar0", def: character({ name: "MyChar0", cost: 0 }), owner: P1, zone: "play" },
      { key: "myChar2", def: character({ name: "MyChar2", cost: 2 }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem", cost: 3 }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc", cost: 5 }), owner: P1, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem", cost: 6 }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc", cost: 4 }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent", cost: 1 }), owner: P1, zone: "play", controller: P2 },
      { key: "faceDown", def: character({ name: "FaceDown", cost: 1 }), owner: P2, zone: "play", faceDown: true },
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 1 }), owner: P1, zone: "discard" },
      { key: "oppHand", def: character({ name: "OppHand", cost: 0 }), owner: P2, zone: "hand" },
      ...bank("obsession", opts.obsession ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type DispBoard = ReturnType<typeof displacementBoard>;
const sdPlay = (b: DispBoard, target: string) => play(b.engine, P1, b.id("sd"), { selected: { bounced: [b.id(target)] } });
const sdPlayRaw = (b: DispBoard, target: string) => playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [b.id(target)] } });

clause(DISPLACEMENT, "0:ability", "is a tactic costing 4 with [O][O][O]: exactly 4 with three [O] works and pays 4; one short or only two [O] is refused", () => {
  const exact = displacementBoard({ obsession: 3, greed: 1 });
  const before = ready(exact.engine);
  sdPlay(exact, "foe2");
  assert.equal(before - ready(exact.engine), 4, "the printed cost of 4 is paid");
  assert.equal(zoneOf(exact.engine, exact.id("foe2")), "hand");
  const short = displacementBoard({ obsession: 3, greed: 0 });
  refused(() => sdPlayRaw(short, "foe2"), "3 resources for a cost of 4");
  assert.equal(zoneOf(short.engine, short.id("sd")), "hand");
  assert.equal(ready(short.engine), 3, "nothing was spent");
  const noIcons = displacementBoard({ obsession: 2, greed: 6 });
  refused(() => sdPlayRaw(noIcons, "foe2"), "only two [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("sd")), "hand");
});

for (let cost = 0; cost <= 9; cost++) {
  const x = Math.ceil(cost / 2);
  clause(DISPLACEMENT, "0:ability", `picked card of numeric cost ${cost}: X is half rounded up = ${x}, so exactly the cards of cost ${x} or less are offered`, () => {
    const b = displacementBoard();
    const resources = ready(b.engine);
    sdPlay(b, `foe${cost}`);
    assert.equal(resources - ready(b.engine), 4, "the printed cost of 4 is paid");
    assert.equal(zoneOf(b.engine, b.id(`foe${cost}`)), "hand", "the picked card went to its owner's hand");
    assert.equal(handOf(b.engine, P2).includes(b.id(`foe${cost}`)), true);
    assert.deepEqual(
      offered(b.engine),
      Array.from({ length: x + 1 }, (_, i) => `H${i}`).sort(),
      `X=${x}`
    );
  });
}

clause(DISPLACEMENT, "0:ability", "the free play: exactly cost X is allowed, X+1 is refused; the card is played, nothing is paid, and only one card is played", () => {
  const b = displacementBoard();
  sdPlay(b, "foe6"); // X = 3
  refused(() => freePlayRaw(b.engine, b.id("h:H4")), "cost 4 is more than X=3");
  assert.equal(zoneOf(b.engine, b.id("h:H4")), "hand");
  assert.equal(pending(b.engine)?.kind, "deployForFree", "the choice is still open after the refusal");
  const resources = ready(b.engine);
  freePlay(b.engine, b.id("h:H3"));
  assert.equal(zoneOf(b.engine, b.id("h:H3")), "play");
  assert.equal(ready(b.engine), resources, "for free: nothing paid");
  assert.equal(zoneOf(b.engine, b.id("h:H2")), "hand", "only one card is played");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sd")), "discard", "the tactic resolved");
});

clause(DISPLACEMENT, "0:ability", "'you may': declining the free play plays nothing and the card is still put into its owner's hand", () => {
  const b = displacementBoard();
  sdPlay(b, "foe6");
  const resources = ready(b.engine);
  freePlay(b.engine, undefined);
  for (let i = 0; i < 10; i++) assert.equal(zoneOf(b.engine, b.id(`h:H${i}`)), "hand", `H${i}`);
  assert.equal(ready(b.engine), resources);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sd")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foe6")), "hand", "the bounce is not optional");
});

clause(DISPLACEMENT, "0:ability", "a card you control is put into YOUR hand and is itself a candidate when its cost is 0 or 1 (X=0 or 1)", () => {
  const one = displacementBoard();
  sdPlay(one, "myChar");
  assert.equal(handOf(one.engine, P1).includes(one.id("myChar")), true, "in my hand");
  assert.ok(offered(one.engine).includes("MyChar"), "the card I just bounced (cost 1, X=1) can be replayed for free");
  freePlay(one.engine, one.id("myChar"));
  assert.equal(zoneOf(one.engine, one.id("myChar")), "play", "replayed");

  const zero = displacementBoard();
  sdPlay(zero, "myChar0");
  assert.deepEqual(offered(zero.engine), ["H0", "MyChar0"], "cost 0, X=0: the bounced card itself is a candidate");
});

clause(DISPLACEMENT, "0:ability", "a bounced card of cost 2 (X=1) is NOT a candidate: its cost is more than X", () => {
  const b = displacementBoard();
  sdPlay(b, "myChar2");
  assert.deepEqual(offered(b.engine), ["H0", "H1"]);
  assert.equal(handOf(b.engine, P1).includes(b.id("myChar2")), true);
});

for (const [key, owner, what] of [
  ["myChar", P1, "my character"],
  ["myItem", P1, "my item"],
  ["myLoc", P1, "my location"],
  ["foe2", P2, "the opponent's character"],
  ["foeItem", P2, "the opponent's item"],
  ["foeLoc", P2, "the opponent's location"]
] as const) {
  clause(DISPLACEMENT, "0:ability", `any non-resource card in play can be picked: ${what} goes to its owner's hand`, () => {
    const b = displacementBoard();
    sdPlay(b, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", key);
    assert.equal(handOf(b.engine, owner).includes(b.id(key)), true, `${key} is in its owner's hand`);
    assert.equal(handOf(b.engine, other(owner)).includes(b.id(key)), false, "and not in the other hand");
    drain(b.engine, declineAll);
  });
}

clause(DISPLACEMENT, "0:ability", "an item attached to a character can be picked on its own: it goes to its owner's hand and the character stays in play", () => {
  const b = displacementBoard({ extra: [{ key: "gear", def: item({ name: "Gear", cost: 1, attachTo: "character" }), owner: P2, zone: "play", attachedToKey: "myChar" }] });
  sdPlay(b, "gear");
  assert.equal(zoneOf(b.engine, b.id("gear")), "hand");
  assert.ok(handOf(b.engine, P2).includes(b.id("gear")), "the opponent owns it: their hand");
  assert.equal(zoneOf(b.engine, b.id("myChar")), "play", "the host is untouched");
  assert.equal(b.engine.state.cards[b.id("gear")].attachedTo, undefined);
});

clause(DISPLACEMENT, "0:ability", "damage markers on a location are gone when it is put into its owner's hand (CR 408.9 / 207.5b)", () => {
  const b = displacementBoard({ extra: [{ key: "hurtLoc", def: location({ name: "HurtLoc", cost: 2, structure: 5 }), owner: P1, zone: "play", damage: 3 }] });
  sdPlay(b, "hurtLoc");
  assert.equal(zoneOf(b.engine, b.id("hurtLoc")), "hand");
  assert.equal(b.engine.state.cards[b.id("hurtLoc")].damage, 0);
});

clause(DISPLACEMENT, "0:ability", "a card you control but the opponent owns goes to the OWNER's hand (and is not offered); one you own but they control comes to YOUR hand", () => {
  const stolen = displacementBoard();
  sdPlay(stolen, "stolen");
  assert.equal(handOf(stolen.engine, P2).includes(stolen.id("stolen")), true, "owned by P2: back to P2's hand");
  assert.equal(offered(stolen.engine).includes("Stolen"), false, "not in my hand, so not a candidate");
  drain(stolen.engine, declineAll);

  const lent = displacementBoard();
  sdPlay(lent, "lent");
  assert.equal(handOf(lent.engine, P1).includes(lent.id("lent")), true, "owned by P1: into P1's hand");
  assert.ok(offered(lent.engine).includes("Lent"), "and it is a candidate (cost 1, X=1)");
});

clause(DISPLACEMENT, "0:ability", "only non-resource cards can be played for free: a resource card in hand is not offered and is refused", () => {
  const b = displacementBoard({ hand: [character({ name: "Cheap", cost: 0 }), resourceCard({ name: "Staple", cost: 0 })] });
  sdPlay(b, "foe0");
  assert.deepEqual(offered(b.engine), ["Cheap"]);
  refused(() => freePlayRaw(b.engine, b.id("h:Staple")), "a resource card");
  assert.equal(zoneOf(b.engine, b.id("h:Staple")), "hand");
  freePlay(b.engine, b.id("h:Cheap"));
  assert.equal(zoneOf(b.engine, b.id("h:Cheap")), "play", "control: the non-resource card is played");
});

clause(DISPLACEMENT, "0:ability", "you still need to meet its threshold: a card whose icons you lack cannot be played for free", () => {
  const b = displacementBoard({ hand: [character({ name: "NeedsRage", cost: 1, threshold: "rr" }), character({ name: "NeedsObsession", cost: 1, threshold: "o" })] });
  sdPlay(b, "foe2");
  refused(() => freePlayRaw(b.engine, b.id("h:NeedsRage")), "no [R]");
  assert.equal(zoneOf(b.engine, b.id("h:NeedsRage")), "hand");
  freePlay(b.engine, b.id("h:NeedsObsession"));
  assert.equal(zoneOf(b.engine, b.id("h:NeedsObsession")), "play", "control: [O] is met");
});

clause(DISPLACEMENT, "0:ability", "you still need to satisfy its extra costs: a card needing a pick is refused without it, accepted with it", () => {
  const b = displacementBoard({ hand: [sniperTactic()] });
  sdPlay(b, "foe2");
  refused(() => freePlayRaw(b.engine, b.id("h:Sniper")), "no target picked");
  assert.equal(zoneOf(b.engine, b.id("h:Sniper")), "hand");
  freePlay(b.engine, b.id("h:Sniper"), { t: [b.id("foe0")] });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("foe0")), "discard", "it did its job");
  assert.equal(zoneOf(b.engine, b.id("h:Sniper")), "discard");
});

clause(DISPLACEMENT, "0:ability", "extra costs such as losing influence are paid by the free play", () => {
  const b = displacementBoard({ hand: [influenceTaxChar(2)] });
  sdPlay(b, "foe2");
  const start = influence(b.engine, P1);
  freePlay(b.engine, b.id("h:Taxed"));
  assert.equal(zoneOf(b.engine, b.id("h:Taxed")), "play");
  assert.equal(influence(b.engine, P1), start - 2, "its extra cost 'lose 2 influence' was paid");
});

clause(DISPLACEMENT, "0:ability", "you still need to satisfy its extra costs: an extra 'pay 2' cost is still paid when the card is played for free", () => {
  const b = displacementBoard({ hand: [payExtraTactic(2)] });
  sdPlay(b, "foe2");
  const resources = ready(b.engine);
  freePlay(b.engine, b.id("h:Costly"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("h:Costly")), "discard");
  assert.equal(resources - ready(b.engine), 2, "only the cost NUMBER is free; the extra 'pay 2' is paid");
});

clause(DISPLACEMENT, "0:ability", "only cards in YOUR hand can be played: not your discard pile, the opponent's hand, or the card bounced from the opponent's side", () => {
  const b = displacementBoard({ hand: [character({ name: "InHand", cost: 0 })], foeCosts: [4] });
  sdPlay(b, "foe4");
  assert.deepEqual(offered(b.engine), ["InHand"], "InDiscard, OppHand and the bounced Foe4 (in their hand) are not offered");
  refused(() => freePlayRaw(b.engine, b.id("oppHand")), "the opponent's hand");
  refused(() => freePlayRaw(b.engine, b.id("inDiscard")), "my discard pile");
  refused(() => freePlayRaw(b.engine, b.id("foe4")), "the card bounced to the opponent's hand");
  freePlay(b.engine, b.id("h:InHand"));
  assert.equal(zoneOf(b.engine, b.id("h:InHand")), "play");
});

clause(DISPLACEMENT, "0:ability", "the free play can be a character, an item, a location or a tactic", () => {
  const defs = [character({ name: "Guy", cost: 1 }), item({ name: "Widget", cost: 1 }), location({ name: "Hall", cost: 1, structure: 3 }), drawTactic("Cantrip", 1, 1)];
  for (const def of defs) {
    const b = displacementBoard({ hand: [def] });
    sdPlay(b, "foe2");
    assert.deepEqual(offered(b.engine), [def.name]);
    freePlay(b.engine, b.id(`h:${def.name}`));
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id(`h:${def.name}`)), def.type === "tactic" ? "discard" : "play", def.name);
  }
});

clause(DISPLACEMENT, "0:ability", "a character played for free really is deployed: its enters-play trigger fires", () => {
  const b = displacementBoard({ hand: [drawOnEnter("Greeter", { cost: 1 })], extra: fillers("dk", 2, P1, "deck") });
  sdPlay(b, "foe2");
  const top = deckOf(b.engine, P1)[0];
  freePlay(b.engine, b.id("h:Greeter"));
  assert.equal(zoneOf(b.engine, b.id("h:Greeter")), "play");
  assert.equal(zoneOf(b.engine, top), "hand", "its 'when this enters play, draw a card' happened");
});

clause(DISPLACEMENT, "0:ability", "the pick must be a non-resource card in play: resources, face-down cards, factions, cards in a hand or discard pile, none, and two are refused", () => {
  const b = displacementBoard();
  const resourceId = b.engine.state.players[P1].play.find((c) => b.engine.getDefinition(c).type === "resource")!;
  const tryPick = (cardId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [cardId] } });
  refused(tryPick(resourceId), "a face-up resource");
  refused(tryPick(b.id("faceDown")), "a face-down card is only a resource");
  refused(tryPick(factionOf(b.engine, P1)), "your faction");
  refused(tryPick(factionOf(b.engine, P2)), "the opponent's faction");
  refused(tryPick(b.id("h:H3")), "a card in hand");
  refused(tryPick(b.id("inDiscard")), "a card in a discard pile");
  refused(() => playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [] } }), "a pick is required");
  refused(() => playRaw(b.engine, P1, b.id("sd"), { selected: { bounced: [b.id("foe1"), b.id("foe2")] } }), "only one card");
  assert.equal(zoneOf(b.engine, b.id("sd")), "hand", "nothing was played");
  assert.equal(ready(b.engine), 10, "nothing was paid");
  tryPick(b.id("foe3"))();
  assert.ok(b.engine.state.responseWindow, "control: a non-resource card in play is accepted");
});

clause(DISPLACEMENT, "0:ability", "the cost is paid when it is played; the card is put into its owner's hand only when the tactic resolves, after the opponent may respond", () => {
  const b = displacementBoard();
  const resources = ready(b.engine);
  sdPlayRaw(b, "foe4");
  assert.equal(resources - ready(b.engine), 4);
  assert.equal(zoneOf(b.engine, b.id("foe4")), "play", "not yet bounced");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe4")), "hand");
});

clause(DISPLACEMENT, "0:ability", "X is fixed by the pick (the cost): the picked card returned by the opponent in response still lets you play a card of cost X or less", () => {
  const b = displacementBoard({ extra: [{ key: "bounceT", def: bounceTactic(), owner: P2, zone: "hand" }] });
  sdPlayRaw(b, "foe6");
  playRaw(b.engine, P2, b.id("bounceT"), { selected: { t: [b.id("foe6")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe6")), "hand");
  assert.deepEqual(offered(b.engine), ["H0", "H1", "H2", "H3"], "X = half of 6 = 3 was fixed when the card was picked");
});

clause(DISPLACEMENT, "0:ability", "a picked card destroyed in response stays in the discard pile (CR 402.4): it is not pulled back into its owner's hand", () => {
  const b = displacementBoard({ extra: [{ key: "killT", def: killTactic(), owner: P2, zone: "hand" }] });
  sdPlayRaw(b, "myChar");
  playRaw(b.engine, P2, b.id("killT"), { selected: { t: [b.id("myChar")] } });
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("myChar")), "discard", "it was destroyed before the tactic resolved; it cannot be put into the hand from the discard pile");
});

clause(DISPLACEMENT, "0:ability", "damage on the picked character is gone when it is put into its owner's hand (CR 408.9)", () => {
  const b = displacementBoard({ extra: [{ key: "dmg", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("dmg"), { selected: { t: [b.id("foe3")] } });
  assert.equal(b.engine.state.cards[b.id("foe3")].damage, 1, "control: the damage was inflicted");
  sdPlay(b, "foe3");
  assert.equal(zoneOf(b.engine, b.id("foe3")), "hand");
  assert.equal(b.engine.state.cards[b.id("foe3")].damage, 0, "damage is reduced to 0 when a card changes areas");
});

clause(DISPLACEMENT, "0:ability", "tokens on the picked card disappear when it is put into its owner's hand (CR 409.2)", () => {
  const b = displacementBoard({ extra: [{ key: "ticker", def: character({ name: "Ticker", cost: 1 }), owner: P1, zone: "play", counters: { token: 3 } }] });
  assert.equal(tokens(b.engine, b.id("ticker")), 3);
  sdPlay(b, "ticker");
  assert.equal(zoneOf(b.engine, b.id("ticker")), "hand");
  assert.equal(tokens(b.engine, b.id("ticker")), 0, "its tokens disappeared when it left play");
});

clause(DISPLACEMENT, "0:ability", "a card attached to the picked character leaves play the same way: it goes to ITS OWNER's hand too (CR 301.4a)", () => {
  const gear = item({ name: "Gear", cost: 1, attachTo: "character" });
  const b = displacementBoard({ extra: [{ key: "gear", def: gear, owner: P1, zone: "play", attachedToKey: "foe3" }] });
  sdPlay(b, "foe3");
  assert.equal(zoneOf(b.engine, b.id("foe3")), "hand");
  assert.equal(zoneOf(b.engine, b.id("gear")), "hand", "the attached item left play in the same way: into its owner's hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("gear")), "handOf(b.engine, P1).includes(b.id(\"gear\"))");
});

clause(DISPLACEMENT, "0:ability", "with no non-resource card of cost X or less in your hand, no free-play choice is asked and the picked card is still bounced", () => {
  const b = displacementBoard({ hand: [character({ name: "Pricey", cost: 5 })] });
  sdPlay(b, "foe2"); // X = 1
  assert.equal(pending(b.engine), undefined, "nothing is eligible, so nothing is asked");
  assert.equal(zoneOf(b.engine, b.id("foe2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("h:Pricey")), "hand");
  assert.equal(zoneOf(b.engine, b.id("sd")), "discard");
});

clause(DISPLACEMENT, "0:ability", "it is a tactic: it can be played in response to the opponent's attack, with the same effect", () => {
  const b = displacementBoard({
    turn: 2,
    active: P2,
    hand: [character({ name: "H0", cost: 0 }), character({ name: "H1", cost: 1 })],
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }]
  });
  refused(() => sdPlayRaw(b, "foe4"), "nothing to respond to on the opponent's quiet turn");
  openWindowOnP2Attack(b.engine, b.id("atk"));
  sdPlayRaw(b, "foe4");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe4")), "hand");
  assert.deepEqual(offered(b.engine), ["H0", "H1"]);
});

clause(DISPLACEMENT, "0:ability", "'you' is the caster: P2 casting it bounces the card and offers P2's own hand", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sd", def: printing(DISPLACEMENT), owner: P2, zone: "hand" },
      { key: "p2cheap", def: character({ name: "P2Cheap", cost: 1 }), owner: P2, zone: "hand" },
      { key: "p1cheap", def: character({ name: "P1Cheap", cost: 1 }), owner: P1, zone: "hand" },
      { key: "target", def: character({ name: "Target", cost: 2 }), owner: P1, zone: "play" },
      ...bank("obsession", 4, P2)
    ]
  });
  play(b.engine, P2, b.id("sd"), { selected: { bounced: [b.id("target")] } });
  assert.deepEqual(offered(b.engine), ["P2Cheap"]);
  assert.ok(handOf(b.engine, P1).includes(b.id("target")), "handOf(b.engine, P1).includes(b.id(\"target\"))");
  freePlay(b.engine, b.id("p2cheap"), undefined, P2);
  assert.equal(zoneOf(b.engine, b.id("p2cheap")), "play");
});

// =============================================================================
// Stolen Inspiration
// Look at your opponent's hand and choose a non-resource card in it. Your
// opponent discards that card. You may play a non-resource card with numeric
// cost X or less for free, where X is half the numeric cost of the discarded
// card, rounded up. (You still need to meet its threshold and satisfy its
// extra costs.)
// Tactic (arcanist), cost 3, threshold [O][O].
// =============================================================================

const INSPIRATION = "7a32d945-fe61-448f-9cc7-d6aac8312c57";

function inspirationBoard(opts: { obsession?: number; greed?: number; p1Hand?: Def[]; p2Hand?: Def[]; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  const p1Hand = opts.p1Hand ?? Array.from({ length: 10 }, (_, i) => character({ name: `H${i}`, cost: i }));
  const p2Hand = opts.p2Hand ?? [...Array.from({ length: 10 }, (_, i) => character({ name: `O${i}`, cost: i })), resourceCard({ name: "OStaple" })];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "si", def: printing(INSPIRATION), owner: P1, zone: "hand" },
      ...p1Hand.map((def) => ({ key: `h:${def.name}`, def, owner: P1, zone: "hand" as const })),
      ...p2Hand.map((def) => ({ key: `o:${def.name}`, def, owner: P2, zone: "hand" as const })),
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 0 }), owner: P1, zone: "discard" },
      { key: "inPlay", def: character({ name: "InPlay", cost: 0 }), owner: P2, zone: "play" },
      { key: "oppDiscard", def: character({ name: "OppDiscard", cost: 0 }), owner: P2, zone: "discard" },
      ...bank("obsession", opts.obsession ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type InspBoard = ReturnType<typeof inspirationBoard>;
// E3a: "Look at your opponent's hand and choose a non-resource card in it" is rules text (an EFFECT), not a cost:
// nothing is picked when the tactic is played. The caster chooses `discardKey` when it resolves.
const siPlay = (b: InspBoard, discardKey: string) => {
  play(b.engine, P1, b.id("si"), { selected: {} });
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(discardKey)] });
};
const siPlayRaw = (b: InspBoard, _discardKey: string) => playRaw(b.engine, P1, b.id("si"), { selected: {} });

clause(INSPIRATION, "0:rule", "is a tactic costing 3 with [O][O]: three resources with two [O] works and pays 3; one short or only one [O] is refused", () => {
  const exact = inspirationBoard({ obsession: 2, greed: 1 });
  const before = ready(exact.engine);
  siPlay(exact, "o:O2");
  assert.equal(before - ready(exact.engine), 3, "the printed cost of 3 is paid");
  assert.equal(zoneOf(exact.engine, exact.id("o:O2")), "discard");
  const short = inspirationBoard({ obsession: 2, greed: 0 });
  refused(() => siPlayRaw(short, "o:O2"), "2 resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("si")), "hand");
  assert.equal(ready(short.engine), 2, "nothing was spent");
  const noIcons = inspirationBoard({ obsession: 1, greed: 6 });
  refused(() => siPlayRaw(noIcons, "o:O2"), "only one [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("si")), "hand");
});

for (let cost = 0; cost <= 9; cost++) {
  const x = Math.ceil(cost / 2);
  clause(INSPIRATION, "0:rule", `the chosen card (cost ${cost}) is discarded by the opponent into THEIR discard pile and nothing else of theirs is`, () => {
    const b = inspirationBoard();
    const before = ready(b.engine);
    const theirHand = [...handOf(b.engine, P2)];
    siPlay(b, `o:O${cost}`);
    assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
    assert.equal(zoneOf(b.engine, b.id(`o:O${cost}`)), "discard");
    assert.equal(discardOf(b.engine, P2).includes(b.id(`o:O${cost}`)), true, "into THEIR discard pile");
    assert.deepEqual(sorted(handOf(b.engine, P2)), sorted(theirHand.filter((c) => c !== b.id(`o:O${cost}`))), "the rest of their hand is untouched");
    assert.deepEqual(sorted(discardOf(b.engine, P2)), sorted([b.id("oppDiscard"), b.id(`o:O${cost}`)]), "only that card joined their discard pile");
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id("si")), "discard");
  });

  clause(INSPIRATION, "0:rule", `discarded card of numeric cost ${cost}: X is half rounded up = ${x}, so exactly the cards of cost ${x} or less are offered`, () => {
    const b = inspirationBoard();
    siPlay(b, `o:O${cost}`);
    assert.deepEqual(
      offered(b.engine),
      Array.from({ length: x + 1 }, (_, i) => `H${i}`).sort(),
      `X=${x}`
    );
  });
}

clause(INSPIRATION, "0:rule", "you choose which card: any non-resource card of their hand can be the one", () => {
  for (const cost of [0, 5, 9]) {
    const b = inspirationBoard();
    siPlay(b, `o:O${cost}`);
    assert.equal(zoneOf(b.engine, b.id(`o:O${cost}`)), "discard", `O${cost}`);
    for (const rest of [0, 5, 9].filter((c) => c !== cost)) assert.equal(zoneOf(b.engine, b.id(`o:O${rest}`)), "hand", `O${rest} stays`);
  }
});

clause(INSPIRATION, "0:rule", "every non-resource TYPE can be the chosen card, and X comes from its own cost: a cost-6 tactic, a cost-5 item and a cost-4 location give X = 3, 3 and 2", () => {
  const types: Array<[string, Def, string[]]> = [
    ["tactic", tactic({ name: "BigTactic", cost: 6 }), ["H0", "H1", "H2", "H3"]],
    ["item", item({ name: "BigItem", cost: 5 }), ["H0", "H1", "H2", "H3"]],
    ["location", location({ name: "BigLoc", cost: 4 }), ["H0", "H1", "H2"]]
  ];
  for (const [what, def, expected] of types) {
    const b = inspirationBoard({ p2Hand: [def, character({ name: "Filler", cost: 1 })], p1Hand: Array.from({ length: 5 }, (_, i) => character({ name: `H${i}`, cost: i })) });
    siPlay(b, `o:${def.name}`);
    assert.equal(zoneOf(b.engine, b.id(`o:${def.name}`)), "discard", `the ${what} was discarded`);
    assert.deepEqual(offered(b.engine), expected, `X from the ${what}'s cost`);
  }
});

clause(INSPIRATION, "0:rule", "a NON-RESOURCE card is required: a resource card in their hand, a card of yours, a card in play or in a discard pile, none, and two are refused", () => {
  // The choice is made when the tactic resolves (E3a): a bad answer is refused and leaves the choice open.
  const b = inspirationBoard();
  play(b.engine, P1, b.id("si"), { selected: {} });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  const attempt = (key: string) => () => pickRaw(b.engine, [b.id(key)]);
  refused(attempt("o:OStaple"), "a resource card");
  refused(attempt("h:H3"), "a card in my own hand");
  refused(attempt("inPlay"), "a card in play");
  refused(attempt("inDiscard"), "a card in my discard pile");
  refused(attempt("oppDiscard"), "a card in their discard pile");
  refused(() => pickRaw(b.engine, [b.id("o:O1"), b.id("o:O2")]), "only one card");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "every bad answer left the choice open");
  attempt("o:O1")();
  assert.equal(zoneOf(b.engine, b.id("o:O1")), "discard", "control: a non-resource card of their hand is accepted");
});

clause(INSPIRATION, "0:rule", "the card is chosen when the tactic RESOLVES (it is rules text, not a cost): it can be played with no pick, and you choose afterwards", () => {
  const b = inspirationBoard();
  playRaw(b.engine, P1, b.id("si"));
  assert.ok(b.engine.state.responseWindow, "the tactic is being deployed with no pick made yet");
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "when it resolves I look at their hand and choose");
  assert.equal(pc?.playerId, P1, "I am the one who chooses");
  pick(b.engine, [b.id("o:O4")]);
  assert.equal(zoneOf(b.engine, b.id("o:O4")), "discard");
});

clause(INSPIRATION, "0:rule", "with no non-resource card in their hand the tactic can still be played; nothing is discarded and nothing can be played for free", () => {
  const b = inspirationBoard({ p2Hand: [resourceCard({ name: "OStaple" })] });
  const resources = ready(b.engine);
  playRaw(b.engine, P1, b.id("si"));
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(resources - ready(b.engine), 3, "it was played and paid for");
  assert.equal(zoneOf(b.engine, b.id("o:OStaple")), "hand", "the resource card stays in their hand");
  assert.equal(zoneOf(b.engine, b.id("si")), "discard");
});

clause(INSPIRATION, "0:rule", "the free play: exactly cost X is allowed, X+1 is refused; the card is played, nothing is paid, and only one card is played", () => {
  const b = inspirationBoard();
  siPlay(b, "o:O6"); // X = 3
  refused(() => freePlayRaw(b.engine, b.id("h:H4")), "cost 4 is more than X=3");
  assert.equal(pending(b.engine)?.kind, "deployForFree", "still open after the refusal");
  const resources = ready(b.engine);
  freePlay(b.engine, b.id("h:H3"));
  assert.equal(zoneOf(b.engine, b.id("h:H3")), "play");
  assert.equal(ready(b.engine), resources, "for free: nothing paid");
  assert.equal(zoneOf(b.engine, b.id("h:H2")), "hand", "only one card is played");
  assert.equal(pending(b.engine), undefined);
});

clause(INSPIRATION, "0:rule", "'you may': declining the free play plays nothing and the discard still happened", () => {
  const b = inspirationBoard();
  siPlay(b, "o:O6");
  freePlay(b.engine, undefined);
  for (let i = 0; i < 10; i++) assert.equal(zoneOf(b.engine, b.id(`h:H${i}`)), "hand", `H${i}`);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("o:O6")), "discard", "the discard happened regardless");
});

clause(INSPIRATION, "0:rule", "only non-resource cards of YOUR hand can be played: resource cards are never offered; the opponent's hand and your discard pile are refused", () => {
  const b = inspirationBoard({ p1Hand: [character({ name: "Cheap", cost: 0 }), resourceCard({ name: "Staple", cost: 0 })] });
  siPlay(b, "o:O2");
  assert.deepEqual(offered(b.engine), ["Cheap"]);
  refused(() => freePlayRaw(b.engine, b.id("h:Staple")), "a resource card");
  refused(() => freePlayRaw(b.engine, b.id("o:O0")), "the opponent's hand");
  refused(() => freePlayRaw(b.engine, b.id("inDiscard")), "my discard pile");
  freePlay(b.engine, b.id("h:Cheap"));
  assert.equal(zoneOf(b.engine, b.id("h:Cheap")), "play");
});

clause(INSPIRATION, "0:rule", "you still need to meet its threshold: a card whose icons you lack cannot be played for free", () => {
  const b = inspirationBoard({ p1Hand: [character({ name: "NeedsRage", cost: 1, threshold: "rr" }), character({ name: "NeedsObsession", cost: 1, threshold: "o" })] });
  siPlay(b, "o:O2");
  refused(() => freePlayRaw(b.engine, b.id("h:NeedsRage")), "no [R]");
  assert.equal(zoneOf(b.engine, b.id("h:NeedsRage")), "hand");
  freePlay(b.engine, b.id("h:NeedsObsession"));
  assert.equal(zoneOf(b.engine, b.id("h:NeedsObsession")), "play");
});

clause(INSPIRATION, "0:rule", "you still need to satisfy its extra costs: a card needing a pick is refused without it, accepted with it", () => {
  const b = inspirationBoard({ p1Hand: [sniperTactic()] });
  siPlay(b, "o:O2");
  refused(() => freePlayRaw(b.engine, b.id("h:Sniper")), "no target picked");
  freePlay(b.engine, b.id("h:Sniper"), { t: [b.id("inPlay")] });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("inPlay")), "discard");
});

clause(INSPIRATION, "0:rule", "extra costs such as losing influence are paid by the free play", () => {
  const b = inspirationBoard({ p1Hand: [influenceTaxChar(2)] });
  siPlay(b, "o:O2");
  const start = influence(b.engine, P1);
  freePlay(b.engine, b.id("h:Taxed"));
  assert.equal(zoneOf(b.engine, b.id("h:Taxed")), "play");
  assert.equal(influence(b.engine, P1), start - 2);
});

clause(INSPIRATION, "0:rule", "you still need to satisfy its extra costs: an extra 'pay 2' cost is still paid when the card is played for free", () => {
  const b = inspirationBoard({ p1Hand: [payExtraTactic(2)] });
  siPlay(b, "o:O2");
  const resources = ready(b.engine);
  freePlay(b.engine, b.id("h:Costly"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("h:Costly")), "discard");
  assert.equal(resources - ready(b.engine), 2, "only the cost NUMBER is free; the extra 'pay 2' is paid");
});

clause(INSPIRATION, "0:rule", "the free play can be a character, an item, a location or a tactic", () => {
  const defs = [character({ name: "Guy", cost: 1 }), item({ name: "Widget", cost: 1 }), location({ name: "Hall", cost: 1, structure: 3 }), drawTactic("Cantrip", 1, 1)];
  for (const def of defs) {
    const b = inspirationBoard({ p1Hand: [def] });
    siPlay(b, "o:O2");
    assert.deepEqual(offered(b.engine), [def.name]);
    freePlay(b.engine, b.id(`h:${def.name}`));
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id(`h:${def.name}`)), def.type === "tactic" ? "discard" : "play", def.name);
  }
});

clause(INSPIRATION, "0:rule", "the free play happens after the discard, and the caster decides on it", () => {
  const b = inspirationBoard();
  siPlay(b, "o:O6");
  assert.equal(zoneOf(b.engine, b.id("o:O6")), "discard");
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  assert.equal(pending(b.engine)?.playerId, P1, "I decide on the free play");
});

clause(INSPIRATION, "0:rule", "with no non-resource card of cost X or less in your hand, no free-play choice is asked", () => {
  const b = inspirationBoard({ p1Hand: [character({ name: "Pricey", cost: 5 })] });
  siPlay(b, "o:O2"); // X = 1
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("o:O2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("h:Pricey")), "hand");
});

clause(INSPIRATION, "0:rule", "the cost is paid when it is played; the discard happens only when the tactic resolves, after the opponent may respond", () => {
  const b = inspirationBoard();
  const before = ready(b.engine);
  siPlayRaw(b, "o:O4");
  assert.equal(before - ready(b.engine), 3);
  assert.equal(zoneOf(b.engine, b.id("o:O4")), "hand", "not discarded yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
});

clause(INSPIRATION, "0:rule", "it is a tactic: it can be played in response to the opponent's attack", () => {
  const b = inspirationBoard({
    turn: 2,
    active: P2,
    p1Hand: [character({ name: "H0", cost: 0 }), character({ name: "H1", cost: 1 })],
    p2Hand: [character({ name: "O2", cost: 2 }), character({ name: "O3", cost: 3 })],
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }]
  });
  refused(() => siPlayRaw(b, "o:O2"), "nothing to respond to on the opponent's quiet turn");
  openWindowOnP2Attack(b.engine, b.id("atk"));
  siPlayRaw(b, "o:O2");
  resolvePendingResponses(b.engine);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o:O2")] });
  assert.equal(zoneOf(b.engine, b.id("o:O2")), "discard");
  assert.deepEqual(offered(b.engine), ["H0", "H1"]);
});

clause(INSPIRATION, "0:rule", "'your opponent' is relative to the caster: P2 casting it makes P1 discard and offers P2's hand", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "si", def: printing(INSPIRATION), owner: P2, zone: "hand" },
      { key: "p2cheap", def: character({ name: "P2Cheap", cost: 1 }), owner: P2, zone: "hand" },
      { key: "p1card", def: character({ name: "P1Card", cost: 2 }), owner: P1, zone: "hand" },
      { key: "p1cheap", def: character({ name: "P1Cheap", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P2)
    ]
  });
  play(b.engine, P2, b.id("si"), { selected: {} });
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("p1card")] });
  assert.ok(discardOf(b.engine, P1).includes(b.id("p1card")), "P1 discarded");
  assert.deepEqual(offered(b.engine), ["P2Cheap"]);
  freePlay(b.engine, b.id("p2cheap"), undefined, P2);
  assert.equal(zoneOf(b.engine, b.id("p2cheap")), "play");
});

// =============================================================================
// Swarm of Gnats
// When this card enters or leaves play, your opponent discards a card.
// Character (arcanist; lurker), cost 4, threshold [O][O], 2 strength / 2 speed / 3 life.
// =============================================================================

const GNATS = "88855760-2a12-4d04-8e88-213f36effba4";

function gnatsBoard(opts: { zone?: "hand" | "play"; oppHand?: number; obsession?: number; greed?: number; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "sg", def: printing(GNATS), owner: P1, zone: opts.zone ?? "hand" },
      { key: "mine", def: character({ name: "Mine", cost: 0 }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.oppHand ?? 3 }, (_, i) => ({ key: `oh${i}`, def: character({ name: `OH${i}` }), owner: P2, zone: "hand" as const })),
      { key: "ores", def: resourceCard({ name: "OStaple" }), owner: P2, zone: "hand" },
      { key: "oppPlay", def: character({ name: "OppPlay" }), owner: P2, zone: "play" },
      { key: "oppDeck", def: character({ name: "OppDeck" }), owner: P2, zone: "deck" },
      { key: "oppDiscard", def: character({ name: "OppDiscard" }), owner: P2, zone: "discard" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      ...bank("obsession", opts.obsession ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type GnatBoard = ReturnType<typeof gnatsBoard>;
const oppDiscarded = (b: GnatBoard) => discardOf(b.engine, P2).filter((c) => c !== b.id("oppDiscard"));

clause(GNATS, "0:rule", "the card itself: costs 4, needs [O][O], and has 2 strength / 2 speed / 3 life", () => {
  const exact = gnatsBoard({ obsession: 2, greed: 2 });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("sg"));
  assert.equal(zoneOf(exact.engine, exact.id("sg")), "play");
  assert.equal(before - ready(exact.engine), 4, "pays exactly 4");
  assert.deepEqual(stats(exact.engine, exact.id("sg")), [2, 3, 2]);
  const short = gnatsBoard({ obsession: 3 });
  refused(() => playRaw(short.engine, P1, short.id("sg")), "3 resources for a cost of 4");
  assert.equal(zoneOf(short.engine, short.id("sg")), "hand");
  const noIcons = gnatsBoard({ obsession: 1, greed: 6 });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("sg")), "only one [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("sg")), "hand");
});

clause(GNATS, "0:rule", "when it enters play your OPPONENT chooses a card from their hand and discards it, into their own discard pile", () => {
  const b = gnatsBoard();
  const hand = [...handOf(b.engine, P2)];
  play(b.engine, P1, b.id("sg"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent decides which card to discard");
  pick(b.engine, [b.id("oh1")]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("oh1")), "discard");
  assert.deepEqual(oppDiscarded(b), [b.id("oh1")], "exactly one card, into THEIR discard pile");
  assert.deepEqual(sorted(handOf(b.engine, P2)), sorted(hand.filter((c) => c !== b.id("oh1"))), "the rest of their hand is untouched");
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand", "my hand is untouched");
});

clause(GNATS, "0:rule", "the opponent can discard ANY card of their hand, including a resource card", () => {
  for (const key of ["oh0", "oh2", "ores"]) {
    const b = gnatsBoard();
    play(b.engine, P1, b.id("sg"));
    pick(b.engine, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", key);
    assert.equal(oppDiscarded(b).length, 1);
  }
});

clause(GNATS, "0:rule", "the discard is mandatory and exactly one card: picking nothing or two cards is refused while they hold cards", () => {
  const b = gnatsBoard();
  play(b.engine, P1, b.id("sg"));
  refused(() => pickRaw(b.engine, []), "'discards a card' cannot be skipped");
  refused(() => pickRaw(b.engine, [b.id("oh0"), b.id("oh1")]), "two cards");
  assert.equal(handOf(b.engine, P2).length, 4, "nothing was discarded by the refused answers");
  pick(b.engine, [b.id("oh0")]);
  assert.equal(oppDiscarded(b).length, 1);
});

clause(GNATS, "0:rule", "the chosen card must come from the OPPONENT's HAND: my hand, their play area, deck and discard pile are refused; I cannot choose for them", () => {
  const b = gnatsBoard();
  play(b.engine, P1, b.id("sg"));
  refused(() => pickRaw(b.engine, [b.id("mine")]), "my own hand");
  refused(() => pickRaw(b.engine, [b.id("oppPlay")]), "their play area");
  refused(() => pickRaw(b.engine, [b.id("oppDeck")]), "their deck");
  refused(() => pickRaw(b.engine, [b.id("oppDiscard")]), "their discard pile");
  refused(() => pickRaw(b.engine, [b.id("oh0")], P1), "I (the Gnats' controller) cannot answer for them");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for their discard");
  pick(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard", "control: a card of their hand is accepted");
});

clause(GNATS, "0:rule", "an opponent with an empty hand discards nothing and nothing is left pending", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "sg", def: printing(GNATS), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1)]
  });
  play(b.engine, P1, b.id("sg"));
  assert.equal(zoneOf(b.engine, b.id("sg")), "play");
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(discardOf(b.engine, P2), []);
  assert.deepEqual(discardOf(b.engine, P1), [], "I discard nothing either");
});

clause(GNATS, "0:rule", "an opponent with exactly one card in hand discards it", () => {
  const b = gnatsBoard({ oppHand: 0, extra: [] });
  b.engine.state.cards[b.id("ores")].zone = "hand";
  const hand = handOf(b.engine, P2);
  assert.deepEqual(hand, [b.id("ores")]);
  play(b.engine, P1, b.id("sg"));
  if (pending(b.engine)) pick(b.engine, [b.id("ores")]);
  assert.deepEqual(handOf(b.engine, P2), []);
  assert.equal(zoneOf(b.engine, b.id("ores")), "discard");
});

clause(GNATS, "0:rule", "the discard happens when it ENTERS play, not while it waits for responses", () => {
  const b = gnatsBoard();
  playRaw(b.engine, P1, b.id("sg"));
  assert.equal(zoneOf(b.engine, b.id("sg")), "deploying");
  assert.equal(pending(b.engine), undefined);
  assert.equal(handOf(b.engine, P2).length, 4, "nothing discarded yet");
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.playerId, P2, "now it has entered play");
});

clause(GNATS, "0:rule", "when it LEAVES play (destroyed) your opponent discards a card as well, chosen by them", () => {
  const b = gnatsBoard({ zone: "play" });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("sg")] } });
  assert.equal(zoneOf(b.engine, b.id("sg")), "discard");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent chooses");
  pick(b.engine, [b.id("oh2")]);
  assert.deepEqual(oppDiscarded(b), [b.id("oh2")]);
  assert.equal(handOf(b.engine, P2).length, 3);
});

clause(GNATS, "0:rule", "leaving play any other way triggers it too: returned to its owner's hand", () => {
  const b = gnatsBoard({ zone: "play" });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("sg")] } });
  assert.equal(zoneOf(b.engine, b.id("sg")), "hand");
  assert.equal(pending(b.engine)?.playerId, P2);
  pick(b.engine, [b.id("oh1")]);
  assert.deepEqual(oppDiscarded(b), [b.id("oh1")]);
});

clause(GNATS, "0:rule", "leaving play by being destroyed in battle triggers it", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sg", def: printing(GNATS), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 5, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "oh0", def: character({ name: "OH0" }), owner: P2, zone: "hand" },
      { key: "oh1", def: character({ name: "OH1" }), owner: P2, zone: "hand" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 });
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("sg")] });
  finishBattle(b.engine, undefined, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("oh0")] } : declineAll(pc)));
  assert.equal(zoneOf(b.engine, b.id("sg")), "discard");
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard", "P2 (the Gnats' opponent) discarded");
  assert.equal(zoneOf(b.engine, b.id("oh1")), "hand", "exactly one card");
});

clause(GNATS, "0:rule", "being turned face-down counts as leaving play (CR 411.4): the opponent discards a card", () => {
  const flipDown = tactic({
    name: "FlipDown",
    cost: 0,
    behavior: { abilities: [{ id: "fd", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
  });
  const b = gnatsBoard({ zone: "play", extra: [{ key: "flip", def: flipDown, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("flip"), { selected: { t: [b.id("sg")] } });
  assert.equal(b.engine.state.cards[b.id("sg")].faceDown, true, "the Gnats is a face-down resource now");
  assert.equal(pending(b.engine)?.playerId, P2, "its leaves-play trigger fired");
  pick(b.engine, [b.id("oh0")], P2);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard");
});

clause(GNATS, "0:rule", "each Gnats that leaves play triggers on its own: two Gnats destroyed by Downsizing make the opponent discard twice", () => {
  const b = gnatsBoard({
    zone: "play",
    extra: [
      { key: "sg2", def: printing(GNATS), owner: P1, zone: "play" },
      { key: "ds", def: printing(DOWNSIZING), owner: P1, zone: "hand" },
      ...bank("greed", 10, P1)
    ]
  });
  const handBefore = handOf(b.engine, P2).length;
  play(b.engine, P1, b.id("ds"));
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [handOf(b.engine, P2)[0]] } : declineAll(pc)));
  assert.equal(zoneOf(b.engine, b.id("sg")), "discard");
  assert.equal(zoneOf(b.engine, b.id("sg2")), "discard");
  assert.equal(handBefore - handOf(b.engine, P2).length, 2, "one discard per Gnats");
  assert.equal(pending(b.engine), undefined);
});

clause(GNATS, "0:rule", "entering and leaving are two separate triggers: a Gnats that enters and later leaves play makes the opponent discard twice", () => {
  const b = gnatsBoard();
  play(b.engine, P1, b.id("sg"));
  pick(b.engine, [b.id("oh0")]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("sg")] } });
  pick(b.engine, [b.id("oh1")]);
  assert.deepEqual(sorted(oppDiscarded(b)), sorted([b.id("oh0"), b.id("oh1")]));
  assert.equal(pending(b.engine), undefined);
});

clause(GNATS, "0:rule", "it does not trigger for OTHER cards entering or leaving play (mine or theirs)", () => {
  const b = gnatsBoard({ zone: "play", extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("mine"));
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(pending(b.engine), undefined, "my other character entering play");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("other")] } });
  assert.equal(zoneOf(b.engine, b.id("other")), "discard");
  assert.equal(pending(b.engine), undefined, "my other character leaving play");
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("oppPlay")] } });
  assert.equal(zoneOf(b.engine, b.id("oppPlay")), "hand");
  assert.equal(pending(b.engine), undefined, "their character leaving play");
  assert.equal(oppDiscarded(b).length, 0);
});

clause(GNATS, "0:rule", "'enters play' includes being put into play by an effect", () => {
  const b = gnatsBoard({
    extra: [
      {
        key: "putter",
        def: tactic({
          name: "Putter",
          cost: 0,
          behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
        }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("putter"), { selected: { t: [b.id("sg")] } });
  assert.equal(zoneOf(b.engine, b.id("sg")), "play");
  assert.equal(ready(b.engine), before, "put into play: nothing paid");
  assert.equal(pending(b.engine)?.playerId, P2);
  pick(b.engine, [b.id("oh0")]);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard");
});

clause(GNATS, "0:rule", "'your opponent' is relative to the Gnats' controller: P2's Gnats makes P1 discard, chosen by P1", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sg", def: printing(GNATS), owner: P2, zone: "hand" },
      { key: "p1a", def: character({ name: "P1A" }), owner: P1, zone: "hand" },
      { key: "p1b", def: character({ name: "P1B" }), owner: P1, zone: "hand" },
      { key: "p2a", def: character({ name: "P2A" }), owner: P2, zone: "hand" },
      ...bank("obsession", 4, P2)
    ]
  });
  play(b.engine, P2, b.id("sg"));
  assert.equal(pending(b.engine)?.playerId, P1, "P1 decides what to discard");
  refused(() => pickRaw(b.engine, [b.id("p2a")], P1), "not the Gnats controller's own hand");
  pick(b.engine, [b.id("p1b")]);
  assert.ok(discardOf(b.engine, P1).includes(b.id("p1b")), "discardOf(b.engine, P1).includes(b.id(\"p1b\"))");
  assert.equal(zoneOf(b.engine, b.id("p2a")), "hand");
});

clause(GNATS, "0:rule", "a face-down Gnats is just a resource: leaving play triggers nothing", () => {
  const b = gnatsBoard({
    extra: [
      { key: "fd", def: printing(GNATS), owner: P1, zone: "play", faceDown: true },
      {
        key: "killRes",
        def: tactic({ name: "KillRes", cost: 0, behavior: { abilities: [{ id: "kr", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  play(b.engine, P1, b.id("killRes"), { selected: { t: [b.id("fd")] } });
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard");
  assert.equal(pending(b.engine), undefined);
  assert.equal(oppDiscarded(b).length, 0);
});

// =============================================================================
// The Deranger
// LOBOTOMIZE
// COST: Deplete this card.
// EFFECT: Look at your opponent's hand and choose 2 or fewer non-resource cards in
// it. Your opponent discards those cards. Your opponent takes control of this card.
// Item (arcanist), cost 3, threshold [O][O].
// =============================================================================

const DERANGER = "98836f41-4b3b-400b-b63b-45878afff2fb";

function derangerBoard(opts: { theirHand?: boolean; depleted?: boolean; extra?: CardPlacement[]; controller?: Pid; active?: Pid; turn?: number; obsession?: number; zone?: "hand" | "play" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "dr", def: printing(DERANGER), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted, controller: opts.controller },
      ...(opts.theirHand === false
        ? []
        : [
            { key: "c1", def: character({ name: "TheirC1" }), owner: P2, zone: "hand" as const },
            { key: "c2", def: character({ name: "TheirC2" }), owner: P2, zone: "hand" as const },
            { key: "c3", def: character({ name: "TheirC3" }), owner: P2, zone: "hand" as const },
            { key: "tac", def: tactic({ name: "TheirTactic" }), owner: P2, zone: "hand" as const },
            { key: "res", def: resourceCard({ name: "TheirRage" }), owner: P2, zone: "hand" as const }
          ]),
      ...fillers("ph", 2, P1, "hand"),
      { key: "foeInPlay", def: character({ name: "FoeInPlay" }), owner: P2, zone: "play" },
      { key: "foeDiscard", def: character({ name: "FoeDiscard" }), owner: P2, zone: "discard" },
      { key: "foeDeck", def: character({ name: "FoeDeck" }), owner: P2, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type DerBoard = ReturnType<typeof derangerBoard>;
const lobotomize = (b: DerBoard, player: Pid = P1) => activate(b.engine, player, b.id("dr"), "lobotomize");
const lobotomizeRaw = (b: DerBoard, player: Pid = P1) => activateRaw(b.engine, player, b.id("dr"), "lobotomize");
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].controllerId;

clause(DERANGER, "0:ability:lobotomize", "the card itself: an item costing 3 with [O][O]", () => {
  const exact = derangerBoard({ zone: "hand", obsession: 2, extra: bank("greed", 1, P1) });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("dr"));
  assert.equal(zoneOf(exact.engine, exact.id("dr")), "play");
  assert.equal(before - ready(exact.engine), 3, "pays exactly 3");
  const short = derangerBoard({ zone: "hand", obsession: 2 });
  refused(() => playRaw(short.engine, P1, short.id("dr")), "2 resources for a cost of 3");
  const noIcons = derangerBoard({ zone: "hand", obsession: 1, extra: bank("greed", 5, P1) });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("dr")), "only one [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("dr")), "hand");
});

clause(DERANGER, "0:ability:lobotomize", "deplete is the COST: paid when the ability is used (before the opponent can respond), control has not changed yet", () => {
  const b = derangerBoard();
  assert.equal(isDepleted(b.engine, b.id("dr")), false);
  lobotomizeRaw(b);
  assert.equal(isDepleted(b.engine, b.id("dr")), true, "COST: Deplete this card");
  assert.equal(controllerOf(b.engine, b.id("dr")), P1, "control has not changed yet");
  assert.equal(handOf(b.engine, P2).length, 5, "nothing is discarded yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "you look at the hand and choose");
});

clause(DERANGER, "0:ability:lobotomize", "two chosen cards are discarded from the opponent's hand into THEIR discard pile; the rest of the hand stays", () => {
  const b = derangerBoard();
  lobotomize(b);
  pick(b.engine, ["c1", "tac"].map(b.id));
  for (const key of ["c1", "tac"]) {
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", key);
    assert.ok(discardOf(b.engine, P2).includes(b.id(key)), `${key} is in their discard pile`);
  }
  assert.deepEqual(sorted(handOf(b.engine, P2).map((c) => nameOf(b.engine, c))), ["TheirC2", "TheirC3", "TheirRage"].sort(), "the other cards stay in their hand");
  assert.deepEqual(discardOf(b.engine, P1), [], "my discard pile is untouched");
});

clause(DERANGER, "0:ability:lobotomize", "every non-resource type can be chosen: an item and a location in their hand are discarded with a tactic", () => {
  const b = derangerBoard({
    theirHand: false,
    extra: [
      { key: "it", def: item({ name: "TheirItem" }), owner: P2, zone: "hand" },
      { key: "lc", def: location({ name: "TheirPlace" }), owner: P2, zone: "hand" },
      { key: "tc", def: tactic({ name: "TheirTac" }), owner: P2, zone: "hand" }
    ]
  });
  lobotomize(b);
  pick(b.engine, ["it", "lc"].map(b.id));
  assert.equal(zoneOf(b.engine, b.id("it")), "discard");
  assert.equal(zoneOf(b.engine, b.id("lc")), "discard");
  assert.equal(zoneOf(b.engine, b.id("tc")), "hand");
});

clause(DERANGER, "0:ability:lobotomize", "'2 or fewer': one card, or none, can be chosen, and only those are discarded", () => {
  const one = derangerBoard();
  lobotomize(one);
  pick(one.engine, [one.id("c2")]);
  assert.equal(zoneOf(one.engine, one.id("c2")), "discard");
  assert.equal(handOf(one.engine, P2).length, 4);
  const none = derangerBoard();
  lobotomize(none);
  pick(none.engine, []);
  assert.equal(handOf(none.engine, P2).length, 5, "nothing was discarded");
});

clause(DERANGER, "0:ability:lobotomize", "three cards cannot be chosen", () => {
  const b = derangerBoard();
  lobotomize(b);
  refused(() => pickRaw(b.engine, ["c1", "c2", "c3"].map(b.id)));
  assert.equal(handOf(b.engine, P2).length, 5);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  pick(b.engine, ["c1", "c2"].map(b.id));
  assert.equal(handOf(b.engine, P2).length, 3, "control: two are accepted");
});

clause(DERANGER, "0:ability:lobotomize", "the choices must be NON-RESOURCE cards: a resource card in their hand is refused (a tactic is fine)", () => {
  const b = derangerBoard();
  lobotomize(b);
  refused(() => pickRaw(b.engine, [b.id("res")]), "a resource card");
  refused(() => pickRaw(b.engine, ["c1", "res"].map(b.id)), "a resource card as the second choice");
  assert.equal(zoneOf(b.engine, b.id("res")), "hand");
  pick(b.engine, ["tac", "c1"].map(b.id));
  assert.equal(zoneOf(b.engine, b.id("tac")), "discard");
  assert.equal(zoneOf(b.engine, b.id("res")), "hand");
});

clause(DERANGER, "0:ability:lobotomize", "the choices must come from the OPPONENT's hand: my hand, their cards in play, deck and discard pile are refused", () => {
  const b = derangerBoard();
  lobotomize(b);
  refused(() => pickRaw(b.engine, [b.id("ph0")]), "my own hand");
  refused(() => pickRaw(b.engine, [b.id("foeInPlay")]), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("foeDiscard")]), "a card in their discard pile");
  refused(() => pickRaw(b.engine, [b.id("foeDeck")]), "a card in their deck");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pick(b.engine, [b.id("c3")]);
  assert.equal(zoneOf(b.engine, b.id("ph0")), "hand");
  assert.equal(zoneOf(b.engine, b.id("c3")), "discard", "control: a card of their hand is accepted");
});

clause(DERANGER, "0:ability:lobotomize", "the same card cannot be chosen twice", () => {
  const b = derangerBoard();
  lobotomize(b);
  refused(() => pickRaw(b.engine, ["c1", "c1"].map(b.id)));
  assert.equal(zoneOf(b.engine, b.id("c1")), "hand");
});

clause(DERANGER, "0:ability:lobotomize", "afterwards your opponent takes control of the Deranger (it moves to their play area; ownership does not change)", () => {
  const b = derangerBoard();
  lobotomize(b);
  pick(b.engine, ["c1", "c2"].map(b.id));
  assert.equal(controllerOf(b.engine, b.id("dr")), P2);
  assert.ok(b.engine.state.players[P2].play.includes(b.id("dr")), "it is in the opponent's play area");
  assert.equal(b.engine.state.players[P1].play.includes(b.id("dr")), false);
  assert.equal(b.engine.state.cards[b.id("dr")].ownerId, P1, "ownership never changes");
  assert.equal(zoneOf(b.engine, b.id("dr")), "play");
});

clause(DERANGER, "0:ability:lobotomize", "the opponent takes control even if you choose no card", () => {
  const b = derangerBoard();
  lobotomize(b);
  pick(b.engine, []);
  assert.equal(controllerOf(b.engine, b.id("dr")), P2);
});

clause(DERANGER, "0:ability:lobotomize", "the opponent takes control even if they have no card in hand (nothing to look at)", () => {
  const b = derangerBoard({ theirHand: false });
  lobotomize(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(controllerOf(b.engine, b.id("dr")), P2);
});

clause(DERANGER, "0:ability:lobotomize", "the opponent takes control even if their hand holds only resource cards", () => {
  const b = derangerBoard({ theirHand: false, extra: [{ key: "res", def: resourceCard({ name: "OnlyStaple" }), owner: P2, zone: "hand" }] });
  lobotomize(b);
  if (pending(b.engine)) pick(b.engine, []);
  assert.equal(controllerOf(b.engine, b.id("dr")), P2);
  assert.equal(zoneOf(b.engine, b.id("res")), "hand");
});

clause(DERANGER, "0:ability:lobotomize", "once the opponent controls it you can no longer use it", () => {
  const b = derangerBoard();
  lobotomize(b);
  pick(b.engine, []);
  refused(() => lobotomizeRaw(b), "I no longer control it");
});

clause(DERANGER, "0:ability:lobotomize", "it stays depleted under the new controller until restored at the start of THEIR turn; then they can use it on you and it comes back to you", () => {
  const b = derangerBoard();
  lobotomize(b);
  pick(b.engine, []);
  assert.equal(isDepleted(b.engine, b.id("dr")), true, "still depleted");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(b.engine, b.id("dr")), false, "restored at the start of the new controller's turn");
  activate(b.engine, P2, b.id("dr"), "lobotomize");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P2, "now P2 looks at P1's hand");
  pick(b.engine, [b.id("ph0")]);
  assert.equal(zoneOf(b.engine, b.id("ph0")), "discard");
  assert.ok(discardOf(b.engine, P1).includes(b.id("ph0")), "P1's discard pile");
  assert.equal(controllerOf(b.engine, b.id("dr")), P1, "and P1 takes control again");
});

clause(DERANGER, "0:ability:lobotomize", "a depleted Deranger cannot be used (its cost is depleting it) and nothing happens", () => {
  const b = derangerBoard({ depleted: true });
  refused(() => lobotomizeRaw(b), "the Deranger is already depleted");
  assert.equal(handOf(b.engine, P2).length, 5);
  assert.equal(controllerOf(b.engine, b.id("dr")), P1);
  assert.equal(pending(b.engine), undefined);
});

clause(DERANGER, "0:ability:lobotomize", "only the Deranger's controller can use it", () => {
  const b = derangerBoard();
  refused(() => lobotomizeRaw(b, P2), "the opponent does not control it");
  assert.equal(isDepleted(b.engine, b.id("dr")), false);
  assert.equal(handOf(b.engine, P2).length, 5);
});

clause(DERANGER, "0:ability:lobotomize", "it can be used in response on the opponent's turn (abilities may be used in response): their hand is looked at and control passes to them", () => {
  const b = derangerBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }]
  });
  refused(() => lobotomizeRaw(b), "nothing to respond to on the opponent's quiet turn");
  openWindowOnP2Attack(b.engine, b.id("atk"));
  lobotomizeRaw(b);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.playerId, P1);
  pick(b.engine, [b.id("c1")]);
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard");
  assert.equal(controllerOf(b.engine, b.id("dr")), P2);
});

clause(DERANGER, "0:ability:lobotomize", "the hand you look at is the hand when it RESOLVES: a card the opponent draws in response can be chosen; one they play cannot", () => {
  const b = derangerBoard({
    theirHand: false,
    extra: [
      { key: "cantrip", def: drawTactic("Cantrip", 1), owner: P2, zone: "hand" },
      { key: "keep", def: character({ name: "Keep" }), owner: P2, zone: "hand" },
      { key: "fresh", def: character({ name: "Fresh" }), owner: P2, zone: "deck" }
    ]
  });
  const top = deckOf(b.engine, P2)[0];
  lobotomizeRaw(b);
  playRaw(b.engine, P2, b.id("cantrip"));
  resolvePendingResponses(b.engine);
  assert.ok(handOf(b.engine, P2).includes(top), "the opponent drew in response");
  refused(() => pickRaw(b.engine, [b.id("cantrip")]), "the cantrip was played, it is not in their hand");
  pick(b.engine, [top, b.id("keep")]);
  assert.equal(zoneOf(b.engine, top), "discard");
  assert.equal(zoneOf(b.engine, b.id("keep")), "discard");
});

clause(DERANGER, "0:ability:lobotomize", "an ability resolves as written even if its source left play (CR 502.4): destroyed in response, the discards still happen", () => {
  const b = derangerBoard({ extra: [{ key: "destroyIt", def: destroyItemTactic(), owner: P2, zone: "hand" }] });
  lobotomizeRaw(b);
  playRaw(b.engine, P2, b.id("destroyIt"), { selected: { t: [b.id("dr")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("dr")), "discard", "the Deranger was destroyed in response");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the ability still resolves");
  pick(b.engine, ["c1", "c2"].map(b.id));
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dr")), "discard", "it is still in its owner's discard pile: nobody 'took control' of a card that left play");
});

clause(DERANGER, "0:ability:lobotomize", "'your opponent' is relative to the user: P2 using a Deranger P2 controls makes P1 discard and passes control to P1", () => {
  const b = derangerBoard({ controller: P2, active: P2, turn: 2 });
  activate(b.engine, P2, b.id("dr"), "lobotomize");
  assert.equal(pending(b.engine)?.playerId, P2);
  refused(() => pickRaw(b.engine, [b.id("c1")]), "c1 is P2's own card");
  pick(b.engine, [b.id("ph0")]);
  assert.equal(zoneOf(b.engine, b.id("ph0")), "discard");
  assert.equal(controllerOf(b.engine, b.id("dr")), P1);
});

// =============================================================================
// Toxic Cultivator
// While you control an even number of characters, reduce the numeric cost of
// tactics you play by 1, to a minimum of 1.
// Character (arcanist; cultivator), cost 2, threshold [O][O], 1 strength / 3 speed / 1 life.
// =============================================================================

const CULTIVATOR = "aa2bed3e-d990-4231-aff0-f81be930ca84";

/** `others` more characters of yours in play next to the Cultivator; tactics of cost 0, 1, 2, 3 and 5 plus a cost-3 item, character and location in hand. */
function cultivatorBoard(opts: { others?: number; copies?: number; oppChars?: number; faceDownChars?: number; extra?: CardPlacement[]; greed?: number; zone?: "play" | "hand" } = {}) {
  const copies = Array.from({ length: opts.copies ?? 1 }, (_, i) => ({ key: i === 0 ? "tc" : `tc${i + 1}`, def: printing(CULTIVATOR), owner: P1 as Pid, zone: opts.zone ?? ("play" as const) }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      ...copies,
      ...Array.from({ length: opts.others ?? 1 }, (_, i) => ({ key: `m${i + 1}`, def: character({ name: `M${i + 1}` }), owner: P1 as Pid, zone: "play" as const })),
      ...Array.from({ length: opts.oppChars ?? 0 }, (_, i) => ({ key: `f${i + 1}`, def: character({ name: `F${i + 1}` }), owner: P2 as Pid, zone: "play" as const })),
      ...Array.from({ length: opts.faceDownChars ?? 0 }, (_, i) => ({ key: `fd${i + 1}`, def: character({ name: `FD${i + 1}` }), owner: P1 as Pid, zone: "play" as const, faceDown: true })),
      ...[0, 1, 2, 3, 5].map((cost) => ({ key: `t${cost}`, def: drawTactic(`Tac${cost}`, 1, cost), owner: P1 as Pid, zone: "hand" as const })),
      { key: "itemC", def: item({ name: "ItemC", cost: 3 }), owner: P1, zone: "hand" },
      { key: "charC", def: character({ name: "CharC", cost: 3 }), owner: P1, zone: "hand" },
      { key: "locC", def: location({ name: "LocC", cost: 3 }), owner: P1, zone: "hand" },
      { key: "oppTac", def: drawTactic("OppTac3", 1, 3), owner: P2, zone: "hand" },
      ...fillers("d", 6, P1, "deck"),
      ...bank("greed", opts.greed ?? 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type CultBoard = ReturnType<typeof cultivatorBoard>;
const costOf = (b: CultBoard, key: string, player: Pid = P1) => b.engine.getCardPlayability(player, b.id(key)).numericCost;
/** The numeric costs of the cost-1, 2, 3 and 5 tactics in hand (the cost-0 one has its own test). */
const tacticCosts = (b: CultBoard) => [1, 2, 3, 5].map((cost) => costOf(b, `t${cost}`));

clause(CULTIVATOR, "0:rule", "the card itself: a cultivator costing 2 with [O][O], 1 strength / 3 speed / 1 life", () => {
  const mk = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "tc", def: printing(CULTIVATOR), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const exact = mk(2, 0);
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("tc"));
  assert.equal(before - ready(exact.engine), 2, "pays exactly 2");
  assert.deepEqual(stats(exact.engine, exact.id("tc")), [1, 1, 3]);
  assert.ok((exact.engine.getDefinition(exact.id("tc")).subtype ?? []).includes("cultivator"), "(exact.engine.getDefinition(exact.id(\"tc\")).subtype ?? []).includes(\"cultivator\")");
  const short = mk(1, 0);
  refused(() => playRaw(short.engine, P1, short.id("tc")), "one resource for a cost of 2");
  const noIcons = mk(1, 5);
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("tc")), "only one [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("tc")), "hand");
});

clause(CULTIVATOR, "0:rule", "with an even number of characters (2) your tactics cost 1 less, to a minimum of 1", () => {
  const b = cultivatorBoard({ others: 1 });
  assert.deepEqual(tacticCosts(b), [1, 1, 2, 4], "costs 1,2,3,5 -> 1 (already at the minimum), 1 (the minimum), 2, 4");
});

clause(CULTIVATOR, "0:rule", "a cost of 0 stays 0: 'to a minimum of 1' does not raise a value that was already below 1 (CR 410.5)", () => {
  const b = cultivatorBoard({ others: 1 });
  assert.equal(costOf(b, "t0"), 0);
});

clause(CULTIVATOR, "0:rule", "a cost-0 tactic is unchanged with an odd count (control for the cost-0 test)", () => {
  const b = cultivatorBoard({ others: 0 });
  assert.equal(costOf(b, "t0"), 0);
});

clause(CULTIVATOR, "0:rule", "with an ODD number of characters (the Cultivator alone, or 3) tactics cost their printed cost", () => {
  for (const others of [0, 2]) {
    const b = cultivatorBoard({ others });
    assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], `${others + 1} characters`);
  }
});

clause(CULTIVATOR, "0:rule", "4 characters is even again, and 6", () => {
  for (const others of [3, 5]) {
    const b = cultivatorBoard({ others });
    assert.deepEqual(tacticCosts(b), [1, 1, 2, 4], `${others + 1} characters`);
  }
});

clause(CULTIVATOR, "0:rule", "the reduction really is what you pay: a cost-3 tactic costs 2 resources with 2 characters and 3 with 3", () => {
  const even = cultivatorBoard({ others: 1 });
  const before = ready(even.engine);
  play(even.engine, P1, even.id("t3"));
  assert.equal(before - ready(even.engine), 2);
  const odd = cultivatorBoard({ others: 2 });
  const beforeOdd = ready(odd.engine);
  play(odd.engine, P1, odd.id("t3"));
  assert.equal(beforeOdd - ready(odd.engine), 3);
});

clause(CULTIVATOR, "0:rule", "affordability follows the reduced cost: a cost-3 tactic is playable with only 2 resources while the count is even, refused while it is odd", () => {
  const even = cultivatorBoard({ others: 1, greed: 2 });
  play(even.engine, P1, even.id("t3"));
  assert.equal(zoneOf(even.engine, even.id("t3")), "discard");
  const odd = cultivatorBoard({ others: 2, greed: 2 });
  refused(() => playRaw(odd.engine, P1, odd.id("t3")), "3 resources needed");
  assert.equal(zoneOf(odd.engine, odd.id("t3")), "hand");
});

clause(CULTIVATOR, "0:rule", "only tactics are reduced: an item, a character and a location of cost 3 still cost 3", () => {
  const b = cultivatorBoard({ others: 1 });
  assert.equal(costOf(b, "itemC"), 3);
  assert.equal(costOf(b, "charC"), 3);
  assert.equal(costOf(b, "locC"), 3);
});

clause(CULTIVATOR, "0:rule", "it counts characters YOU control: the opponent's characters do not make the count even", () => {
  const b = cultivatorBoard({ others: 0, oppChars: 1 });
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "you control 1 character, they control 1");
  const evenMine = cultivatorBoard({ others: 1, oppChars: 1 });
  assert.deepEqual(tacticCosts(evenMine), [1, 1, 2, 4], "you control 2 characters (their 1 does not matter)");
  const theirsEven = cultivatorBoard({ others: 0, oppChars: 3 });
  assert.deepEqual(tacticCosts(theirsEven), [1, 2, 3, 5], "they control 3 and I control 1");
});

clause(CULTIVATOR, "0:rule", "face-down cards are resources, not characters, so they do not count", () => {
  const b = cultivatorBoard({ others: 0, faceDownChars: 1 });
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "1 character plus a face-down resource is still an odd count");
  const even = cultivatorBoard({ others: 1, faceDownChars: 1 });
  assert.deepEqual(tacticCosts(even), [1, 1, 2, 4], "2 characters plus a face-down resource is still even");
});

clause(CULTIVATOR, "0:rule", "a character you control but do not own counts", () => {
  const b = cultivatorBoard({ others: 0, extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  assert.deepEqual(tacticCosts(b), [1, 1, 2, 4]);
});

clause(CULTIVATOR, "0:rule", "items and locations are not characters: they do not change the parity", () => {
  const b = cultivatorBoard({ others: 0, extra: [{ key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" }, { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" }] });
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "still one character");
});

clause(CULTIVATOR, "0:rule", "only YOUR tactics are reduced: the opponent's tactic keeps its cost", () => {
  const b = cultivatorBoard({ others: 1, oppChars: 1 });
  assert.equal(costOf(b, "oppTac", P2), 3);
});

clause(CULTIVATOR, "0:rule", "it also reduces a tactic you play in response on the opponent's turn: a cost-3 tactic costs 2 in their attack window", () => {
  const b = cultivatorBoard({ others: 1, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }] });
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  openWindowOnP2Attack(b.engine, b.id("atk"));
  const spent = spentBy(b.engine, P1, () => playRaw(b.engine, P1, b.id("t3")));
  assert.equal(spent, 2, "3 - 1");
});

clause(CULTIVATOR, "0:rule", "it switches off the moment the count turns odd (a character leaves play) and back on when even again", () => {
  const b = cultivatorBoard({ others: 1, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  assert.deepEqual(tacticCosts(b), [1, 1, 2, 4]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("m1")] } });
  assert.equal(zoneOf(b.engine, b.id("m1")), "discard");
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "one character left: odd");
  play(b.engine, P1, b.id("newbie"));
  assert.deepEqual(tacticCosts(b), [1, 1, 2, 4], "two characters again: even");
});

clause(CULTIVATOR, "0:rule", "it stops when the Cultivator itself leaves play", () => {
  const b = cultivatorBoard({ others: 1, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("tc")] } });
  assert.equal(zoneOf(b.engine, b.id("tc")), "discard");
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "no Cultivator, no reduction (and one character left)");
  const threeChars = cultivatorBoard({ others: 2, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(threeChars.engine, P1, threeChars.id("kill"), { selected: { t: [threeChars.id("tc")] } });
  assert.deepEqual(tacticCosts(threeChars), [1, 2, 3, 5], "two characters (even) but no Cultivator: no reduction");
});

clause(CULTIVATOR, "0:rule", "a Cultivator that is not in play (in hand) reduces nothing, even with an even character count", () => {
  const b = cultivatorBoard({ others: 2, zone: "hand" });
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5]);
  const none = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "M2" }), owner: P1, zone: "play" },
      { key: "t3", def: drawTactic("Tac3", 1, 3), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(none.engine.getCardPlayability(P1, none.id("t3")).numericCost, 3, "no Cultivator at all");
});

clause(CULTIVATOR, "0:rule", "entering play turns it on: deploying the Cultivator itself makes a lone character an even pair", () => {
  const b = cultivatorBoard({ others: 1, zone: "hand", extra: bank("obsession", 2, P1) });
  assert.deepEqual(tacticCosts(b), [1, 2, 3, 5], "before: no Cultivator in play");
  play(b.engine, P1, b.id("tc"));
  assert.equal(zoneOf(b.engine, b.id("tc")), "play");
  assert.deepEqual(tacticCosts(b), [1, 1, 2, 4], "after: the Cultivator and one other character make an even count");
});

clause(CULTIVATOR, "0:rule", "two Cultivators (2 characters, an even count) each reduce by 1: costs 5 / 3 / 2 / 1 become 3 / 1 / 1 / 1", () => {
  const b = cultivatorBoard({ copies: 2, others: 0 });
  assert.deepEqual(tacticCosts(b), [1, 1, 1, 3], "5-2=3, 3-2=1, 2-2 -> minimum 1, 1 stays 1");
});

clause(CULTIVATOR, "0:rule", "the reduction applies to a tactic's whole numeric cost, including an extra 'pay 2' (a cost-1 tactic with 'pay 2' costs 1+2-1 = 2)", () => {
  const b = cultivatorBoard({ others: 1, extra: [{ key: "pay2", def: payExtraTactic(2, "PayTwo", 1), owner: P1, zone: "hand" }] });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("pay2"));
  assert.equal(before - ready(b.engine), 2, "running total 1 + 2 = 3, reduced by 1 to 2 (CR 406.3)");
});

clause(CULTIVATOR, "0:rule", "the reduction control: with an odd count the same cost-1 tactic with 'pay 2' costs the full 1+2 = 3", () => {
  const b = cultivatorBoard({ others: 0, extra: [{ key: "pay2", def: payExtraTactic(2, "PayTwo", 1), owner: P1, zone: "hand" }] });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("pay2"));
  assert.equal(before - ready(b.engine), 3);
});

clause(CULTIVATOR, "0:rule", "the reduction applies to a tactic's whole numeric cost, including a 'pay X+X' extra cost (Cash Out X=2 costs 0+4-1 = 3)", () => {
  const b = cultivatorBoard({ others: 1, extra: [{ key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" }], greed: 8 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("co"), { variables: { x: 2 } });
  assert.equal(before - ready(b.engine), 3, "running total 0 + 4 = 4, reduced by 1 to 3");
});

clause(CULTIVATOR, "0:rule", "Cash Out control: with an odd character count X=2 costs the full 4", () => {
  const b = cultivatorBoard({ others: 0, extra: [{ key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" }], greed: 8 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("co"), { variables: { x: 2 } });
  assert.equal(before - ready(b.engine), 4);
});

// =============================================================================
// Unnatural Alteration
// COST: Play this only during your turn and not during a battle. Pick a character
// you control.
// EFFECT: Destroy the character if you can. If you do, X is its numeric cost. Search
// your deck for a character with numeric cost X+3 or less and reveal it. You may play
// it for free. If you don't, put it into your hand.
// Tactic (arcanist), cost 4, threshold [O].
// =============================================================================

const ALTERATION = "68679306-bedf-4fff-86f0-4e156ad5b426";

function alterationBoard(opts: { sacCost?: number; obsession?: number; active?: Pid; turn?: number; random?: () => number; extra?: CardPlacement[]; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random,
    cards: [
      { key: "ua", def: printing(ALTERATION), owner: P1, zone: "hand" },
      { key: "sac", def: character({ name: "Sacrifice", cost: opts.sacCost ?? 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "inHandChar", def: character({ name: "InHandChar", cost: 1 }), owner: P1, zone: "hand" },
      // the deck, top to bottom (with a sacrifice of cost 2, X + 3 = 5)
      { key: "f5", def: character({ name: "Cost5", cost: 5 }), owner: P1, zone: "deck" },
      { key: "f6", def: character({ name: "Cost6", cost: 6 }), owner: P1, zone: "deck" },
      { key: "f1", def: character({ name: "Cost1", cost: 1 }), owner: P1, zone: "deck" },
      { key: "dItem", def: item({ name: "DeckItem", cost: 1 }), owner: P1, zone: "deck" },
      { key: "dTac", def: tactic({ name: "DeckTactic", cost: 0 }), owner: P1, zone: "deck" },
      { key: "dLoc", def: location({ name: "DeckLocation", cost: 0 }), owner: P1, zone: "deck" },
      { key: "fOp", def: character({ name: "NeedsGreed", cost: 0, threshold: "ggg" }), owner: P1, zone: "deck" },
      { key: "fTax", def: influenceTaxChar(2, "Taxed", 3), owner: P1, zone: "deck" },
      { key: "theirDeckChar", def: character({ name: "TheirDeckChar", cost: 1 }), owner: P2, zone: "deck" },
      ...bank("obsession", opts.obsession ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type AltBoard = ReturnType<typeof alterationBoard>;
const alterationPlay = (b: AltBoard, sac = "sac") => play(b.engine, P1, b.id("ua"), { selected: { c: [b.id(sac)] } });
const alterationPlayRaw = (b: AltBoard, sac = "sac") => playRaw(b.engine, P1, b.id("ua"), { selected: { c: [b.id(sac)] } });

clause(ALTERATION, "0:ability", "the card itself: a tactic costing 4 with [O]: exactly 4 with one [O] works and pays 4; one short or no [O] is refused", () => {
  const exact = alterationBoard({ obsession: 1, greed: 3 });
  const before = ready(exact.engine);
  alterationPlayRaw(exact);
  assert.equal(before - ready(exact.engine), 4, "the printed cost of 4 is paid when it is played");
  const short = alterationBoard({ obsession: 3 });
  refused(() => alterationPlayRaw(short), "3 resources for a cost of 4");
  assert.equal(zoneOf(short.engine, short.id("ua")), "hand");
  const noIcons = alterationBoard({ obsession: 0, greed: 6 });
  refused(() => alterationPlayRaw(noIcons), "no [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("ua")), "hand");
});

clause(ALTERATION, "0:ability", "pays 4, destroys the picked character of yours when it resolves, then you search your deck", () => {
  const b = alterationBoard();
  alterationPlayRaw(b);
  assert.equal(zoneOf(b.engine, b.id("sac")), "play", "the character is destroyed by the effect, when it resolves");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "destroyed: into its owner's discard pile");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the search");
  assert.equal(pc?.playerId, P1);
  assert.equal(zoneOf(b.engine, b.id("ua")), "deploying");
});

clause(ALTERATION, "0:ability", "X = the destroyed character's numeric cost: with cost 2 a character of cost 5 (X+3) may be found, cost 6 may not", () => {
  const b = alterationBoard({ sacCost: 2 });
  alterationPlay(b);
  refused(() => pickRaw(b.engine, [b.id("f6")]), "cost 6 > X+3 = 5");
  pick(b.engine, [b.id("f5")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(ALTERATION, "0:ability", "a character with a lower cost may be found as well (cost 1 <= X+3)", () => {
  const b = alterationBoard({ sacCost: 2 });
  alterationPlay(b);
  pick(b.engine, [b.id("f1")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(ALTERATION, "0:ability", "X = 4: a sacrificed character of cost 4 allows cost 7 but not cost 8", () => {
  const b = alterationBoard({
    sacCost: 4,
    extra: [
      { key: "f7", def: character({ name: "Cost7", cost: 7 }), owner: P1, zone: "deck" },
      { key: "f8", def: character({ name: "Cost8", cost: 8 }), owner: P1, zone: "deck" }
    ]
  });
  alterationPlay(b);
  refused(() => pickRaw(b.engine, [b.id("f8")]), "cost 8 > X+3 = 7");
  pick(b.engine, [b.id("f7")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(ALTERATION, "0:ability", "X = 0 (a sacrificed character of cost 0): only characters of cost 3 or less; cost 5 is refused", () => {
  const b = alterationBoard({ sacCost: 0 });
  alterationPlay(b);
  refused(() => pickRaw(b.engine, [b.id("f5")]), "cost 5 > X+3 = 3");
  pick(b.engine, [b.id("f1")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(ALTERATION, "0:ability", "the card found must be a CHARACTER from YOUR deck: an item, a tactic, a location, the opponent's deck, a card in play or in hand are refused", () => {
  const b = alterationBoard();
  alterationPlay(b);
  refused(() => pickRaw(b.engine, [b.id("dItem")]), "an item");
  refused(() => pickRaw(b.engine, [b.id("dTac")]), "a tactic");
  refused(() => pickRaw(b.engine, [b.id("dLoc")]), "a location");
  refused(() => pickRaw(b.engine, [b.id("theirDeckChar")]), "the opponent's deck");
  refused(() => pickRaw(b.engine, [b.id("other")]), "a character in play");
  refused(() => pickRaw(b.engine, [b.id("inHandChar")]), "a character in hand");
  refused(() => pickRaw(b.engine, [b.id("f5"), b.id("f1")]), "only one card is found");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still searching");
  pick(b.engine, [b.id("f5")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(ALTERATION, "0:ability", "'and reveal it': the found character is revealed to everyone exactly once", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("f5")]);
  const reveals = eventsOf(b.engine, "cardsRevealed");
  assert.equal(reveals.length, 1);
  assert.deepEqual(reveals[0].cardIds, [b.id("f5")]);
  assert.equal(reveals[0].viewerId, "all");
});

clause(ALTERATION, "0:ability", "'You may play it for free': playing it puts it into play without paying its cost number", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("f5")]);
  const readyBefore = ready(b.engine);
  chooseOption(b.engine, /free|play|deploy/i);
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  answerPending(b.engine, "deployForFree", { cardId: b.id("f5") });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("f5")), "play", "the found character is in play");
  assert.equal(ready(b.engine), readyBefore, "its cost number of 5 was not paid");
  assert.equal(handOf(b.engine, P1).includes(b.id("f5")), false, "and it did not go to the hand as well");
  assert.equal(zoneOf(b.engine, b.id("ua")), "discard", "the tactic resolved");
});

clause(ALTERATION, "0:ability", "a character played for free really is deployed: its enters-play trigger fires", () => {
  const b = alterationBoard({ extra: [{ key: "greet", def: drawOnEnter("Greeter", { cost: 1 }), owner: P1, zone: "deck" }, ...fillers("dk", 2, P1, "deck")] });
  alterationPlay(b);
  pick(b.engine, [b.id("greet")]);
  const top = deckOf(b.engine, P1).find((c) => c !== b.id("greet"))!;
  chooseOption(b.engine, /free|play|deploy/i);
  answerPending(b.engine, "deployForFree", { cardId: b.id("greet") });
  assert.equal(zoneOf(b.engine, b.id("greet")), "play");
  assert.ok(handOf(b.engine, P1).length >= 2, "its draw trigger resolved");
  void top;
});

clause(ALTERATION, "0:ability", "'If you don't, put it into your hand': not playing it puts the found character into your hand", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("f5")]);
  chooseOption(b.engine, /hand/i);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("f5")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("f5")), "handOf(b.engine, P1).includes(b.id(\"f5\"))");
  assert.equal(zoneOf(b.engine, b.id("ua")), "discard", "the tactic resolved");
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard");
});

clause(ALTERATION, "0:ability", "deciding to play it but then declining the free deploy puts the found character into your hand ('if you don't')", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("f5")]);
  chooseOption(b.engine, /free|play|deploy/i);
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  answerPending(b.engine, "deployForFree", {});
  assert.equal(zoneOf(b.engine, b.id("f5")), "hand", "you did not play it, so it goes into your hand");
});

clause(ALTERATION, "0:ability", "you still need to meet its threshold: a found character whose icons you lack cannot be played for free", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, [b.id("fOp")]);
  chooseOption(b.engine, /free|play|deploy/i);
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  refused(() => freePlayRaw(b.engine, b.id("fOp")), "[G][G][G] is not met");
  assert.notEqual(zoneOf(b.engine, b.id("fOp")), "play");
});

clause(ALTERATION, "0:ability", "a free deploy that the icons allow does work (the threshold is met)", () => {
  const b = alterationBoard({ greed: 3 });
  alterationPlay(b);
  pick(b.engine, [b.id("fOp")]);
  chooseOption(b.engine, /free|play|deploy/i);
  answerPending(b.engine, "deployForFree", { cardId: b.id("fOp") });
  assert.equal(zoneOf(b.engine, b.id("fOp")), "play");
});

clause(ALTERATION, "0:ability", "you still need to satisfy its extra costs: a found character with 'lose 2 influence' pays it when played for free", () => {
  const b = alterationBoard();
  const start = influence(b.engine, P1);
  alterationPlay(b);
  pick(b.engine, [b.id("fTax")]);
  chooseOption(b.engine, /free|play|deploy/i);
  answerPending(b.engine, "deployForFree", { cardId: b.id("fTax") });
  assert.equal(zoneOf(b.engine, b.id("fTax")), "play");
  assert.equal(influence(b.engine, P1), start - 2, "its extra cost (lose 2 influence) was paid");
});

clause(ALTERATION, "0:ability", "the search may fail (CR 312.2 'a character with ...'): finding nothing still destroys the character, and nothing enters your hand or play", () => {
  const b = alterationBoard();
  const handBefore = [...handOf(b.engine, P1)].filter((c) => c !== b.id("ua"));
  alterationPlay(b);
  pick(b.engine, []);
  if (pending(b.engine)?.kind === "chooserSelectsOption") chooseOption(b.engine, /hand/i);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard");
  assert.deepEqual(sorted(handOf(b.engine, P1)), sorted(handBefore));
  assert.equal(zoneOf(b.engine, b.id("f5")), "deck");
});

clause(ALTERATION, "0:ability", "finding nothing leaves nothing to play or take: no 'play it for free / put it into your hand' question is asked", () => {
  const b = alterationBoard();
  alterationPlay(b);
  pick(b.engine, []);
  assert.equal(pending(b.engine), undefined, "no card was found, so there is nothing to decide about");
});

clause(ALTERATION, "0:ability", "no character of cost X+3 or less in the deck: nothing to find, the character is still destroyed and nothing is left pending", () => {
  const b = alterationBoard({ sacCost: 0 });
  for (const key of ["f5", "f6", "f1", "fOp", "fTax"]) {
    b.engine.state.cards[b.id(key)].zone = "discard";
    b.engine.state.players[P1].deck = b.engine.state.players[P1].deck.filter((c) => c !== b.id(key));
    b.engine.state.players[P1].discard.push(b.id(key));
  }
  alterationPlay(b);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard");
  assert.equal(pending(b.engine), undefined, "nothing to search for");
});

clause(ALTERATION, "0:ability", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const b = alterationBoard({ random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  alterationPlay(b);
  pick(b.engine, [b.id("f5")]);
  chooseOption(b.engine, /hand/i);
  const rest = before.filter((c) => c !== b.id("f5"));
  assert.deepEqual(sorted(deckOf(b.engine, P1)), sorted(rest), "same cards");
  assert.notDeepEqual(deckOf(b.engine, P1), rest, "in a new order");
});

clause(ALTERATION, "0:ability", "'If you do': a picked character that left play in response (so it was not destroyed) means no search", () => {
  const b = alterationBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }] });
  alterationPlayRaw(b);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("sac")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("sac")), "hand", "the character was returned to its owner's hand in response");
  assert.equal(pending(b.engine), undefined, "it was not destroyed, so there is no search");
  assert.equal(zoneOf(b.engine, b.id("f5")), "deck");
  assert.equal(zoneOf(b.engine, b.id("ua")), "discard");
});

clause(ALTERATION, "0:ability", "'if you can': a picked character already destroyed in response cannot be destroyed again: no search, and it stays in the discard pile", () => {
  const b = alterationBoard({ extra: [{ key: "killT", def: killTactic(), owner: P2, zone: "hand" }] });
  alterationPlayRaw(b);
  playRaw(b.engine, P2, b.id("killT"), { selected: { t: [b.id("sac")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard");
  assert.equal(pending(b.engine), undefined, "the destroy 'did not happen' through this card, so X is not defined and there is no search");
  assert.equal(zoneOf(b.engine, b.id("f5")), "deck");
});

clause(ALTERATION, "0:ability", "Pick a character YOU control: the opponent's character, items, locations, cards in hand, none and two are refused", () => {
  const b = alterationBoard();
  const tryPick = (cardId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("ua"), { selected: { c: [cardId] } });
  refused(tryPick(b.id("foe")), "the opponent's character");
  refused(tryPick(b.id("thing")), "an item");
  refused(tryPick(b.id("place")), "a location");
  refused(tryPick(b.id("inHandChar")), "a character in hand");
  refused(tryPick(factionOf(b.engine, P1)), "my faction");
  refused(() => playRaw(b.engine, P1, b.id("ua"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(b.engine, P1, b.id("ua"), { selected: { c: [b.id("sac"), b.id("other")] } }), "two characters");
  assert.equal(zoneOf(b.engine, b.id("ua")), "hand", "nothing was played");
  assert.equal(ready(b.engine), 6, "nothing was paid");
  tryPick(b.id("other"))();
  assert.ok(b.engine.state.responseWindow, "control: a character I control is accepted");
});

clause(ALTERATION, "0:ability", "a character I control but do not own can be picked (and is destroyed into its OWNER's discard pile)", () => {
  const b = alterationBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", cost: 3 }), owner: P2, zone: "play", controller: P1 }] });
  alterationPlay(b, "stolen");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("stolen")), "discardOf(b.engine, P2).includes(b.id(\"stolen\"))");
  refused(() => pickRaw(b.engine, [b.id("theirDeckChar")]), "a search in MY deck only");
  pick(b.engine, [b.id("f6")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "X = 3: cost 6 is allowed");
});

clause(ALTERATION, "0:ability", "'Play this only during your turn': refused in the opponent's response window on THEIR turn (a control tactic is playable in the same window)", () => {
  const b = alterationBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }, { key: "ctl", def: drawTactic("Control", 1, 0), owner: P1, zone: "hand" }] });
  openWindowOnP2Attack(b.engine, b.id("atk"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority in the window");
  refused(() => alterationPlayRaw(b), "not my turn");
  assert.equal(zoneOf(b.engine, b.id("ua")), "hand");
  assert.equal(ready(b.engine), 6, "nothing was paid");
  playRaw(b.engine, P1, b.id("ctl"));
  assert.equal(zoneOf(b.engine, b.id("ctl")), "deploying", "control: the same window accepts another tactic from me");
});

clause(ALTERATION, "0:ability", "'Play this only during your turn', with no battle involved: refused in response to the opponent's TACTIC on their turn (a control tactic is playable in the same window)", () => {
  const b = alterationBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "theirs", def: drawTactic("TheirCantrip", 1, 0), owner: P2, zone: "hand" },
      { key: "ctl", def: drawTactic("Control", 1, 0), owner: P1, zone: "hand" },
      ...fillers("e", 3, P2, "deck")
    ]
  });
  playRaw(b.engine, P2, b.id("theirs"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority in the window");
  assert.equal(battleOf(b.engine), undefined, "no battle is under way");
  refused(() => alterationPlayRaw(b), "not my turn");
  assert.equal(zoneOf(b.engine, b.id("ua")), "hand");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play");
  assert.equal(ready(b.engine), 6, "nothing was paid");
  playRaw(b.engine, P1, b.id("ctl"));
  assert.equal(zoneOf(b.engine, b.id("ctl")), "deploying", "control: the same window accepts another tactic from me");
});

clause(ALTERATION, "0:ability", "'Play this only during your turn', with no battle involved: refused in response to the opponent announcing the end of their turn", () => {
  const b = alterationBoard({ turn: 2, active: P2, extra: [{ key: "ctl", def: drawTactic("Control", 1, 0), owner: P1, zone: "hand" }] });
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => alterationPlayRaw(b), "not my turn");
  assert.equal(zoneOf(b.engine, b.id("ua")), "hand");
  playRaw(b.engine, P1, b.id("ctl"));
  assert.equal(zoneOf(b.engine, b.id("ctl")), "deploying", "control: the same window accepts another tactic from me");
});

clause(ALTERATION, "0:ability", "'Destroy the character if you can': when destruction is impossible this turn the character stays in play, X is not defined and nothing is searched", () => {
  const noDestroy = tactic({
    name: "NoDestroy",
    cost: 0,
    behavior: { abilities: [{ id: "nd", type: "activated", effects: [{ type: "restrictDestruction", duration: { type: "untilEndOfTurn" } }] }] }
  });
  const b = alterationBoard({ extra: [{ key: "nd", def: noDestroy, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("nd"));
  alterationPlay(b);
  assert.equal(zoneOf(b.engine, b.id("sac")), "play", "it could not be destroyed");
  assert.equal(pending(b.engine), undefined, "so there is no search");
  assert.equal(zoneOf(b.engine, b.id("f5")), "deck");
  assert.equal(zoneOf(b.engine, b.id("ua")), "discard", "the tactic still resolved");
});

clause(ALTERATION, "0:ability", "'during your turn' includes responding to the opponent's response on MY turn", () => {
  const b = alterationBoard({
    turn: 2,
    active: P1,
    extra: [
      { key: "opener", def: drawTactic("Opener", 1, 0), owner: P1, zone: "hand" },
      { key: "oppT", def: drawTactic("OppCantrip", 1, 0), owner: P2, zone: "hand" }
    ]
  });
  playRaw(b.engine, P1, b.id("opener"));
  playRaw(b.engine, P2, b.id("oppT"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to their response");
  alterationPlayRaw(b);
  assert.equal(zoneOf(b.engine, b.id("ua")), "deploying", "played on my own turn, in response");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "it resolved on my turn");
});

clause(ALTERATION, "0:ability", "'not during a battle': refused while a battle is under way (a control tactic is playable in the same window); allowed again after the battle", () => {
  const b = alterationBoard({
    extra: [
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "ctl", def: drawTactic("Control", 1, 0), owner: P1, zone: "hand" }
    ]
  });
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P2 } });
  assert.ok(battleOf(b.engine), "a battle is under way");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority in the declaration window");
  refused(() => alterationPlayRaw(b), "during a battle");
  assert.equal(zoneOf(b.engine, b.id("ua")), "hand");
  assert.equal(ready(b.engine), 6, "nothing was paid");
  playRaw(b.engine, P1, b.id("ctl"));
  assert.ok(b.engine.state.responseWindow, "control: the same window accepts another tactic");
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  assert.equal(battleOf(b.engine), undefined);
  alterationPlay(b);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "after the battle it can be played");
});

clause(ALTERATION, "0:ability", "during a battle's later windows (after blockers are declared) it is still refused", () => {
  const b = alterationBoard({
    extra: [
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "ctl", def: drawTactic("Control", 1, 0), owner: P1, zone: "hand" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 });
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
  assert.ok(battleOf(b.engine), "battleOf(b.engine)");
  if (b.engine.state.responseWindow) {
    assert.equal(b.engine.state.responseWindow.priorityPlayerId, P1, "the attacker holds priority first");
    refused(() => alterationPlayRaw(b), "during the battle");
    assert.equal(zoneOf(b.engine, b.id("ua")), "hand");
    playRaw(b.engine, P1, b.id("ctl"));
    assert.ok(b.engine.state.responseWindow, "control: another tactic is accepted in this window");
  }
});

// =============================================================================
// Venomous Sacspider
// If this card is destroyed by battle damage, your opponent discards their hand.
// Character (arcanist; lurker), cost 3, threshold [O][O], 2 strength / 3 speed / 1 life.
// =============================================================================

const SACSPIDER = "25467632-34e7-4eca-b5f0-9b5c50a05d1f";
const factionOfP1 = { type: "faction" as const, playerId: P1 };
const factionOfP2 = { type: "faction" as const, playerId: P2 };

/** P2 attacks (turn 2); P1 owns the Sacspider (`spider`), an ally (`ally`), and holds 2 cards; P2 holds 3 cards (`oh0..2`). */
function spiderDefends(opts: { ophand?: number; ally?: Partial<Def>; attacker?: Partial<Def>; spiderController?: Pid; spiderOwner?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "spider", def: printing(SACSPIDER), owner: opts.spiderOwner ?? P1, controller: opts.spiderController, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 5, speed: 1, ...opts.ally }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 5, speed: 3, ...opts.attacker }), owner: P2, zone: "play" },
      ...fillers("mine", 2, P1, "hand"),
      ...fillers("oh", opts.ophand ?? 3, P2, "hand"),
      ...fillers("od", 2, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

/** P1 attacks (turn 1) with the Sacspider; P2 owns a blocker and holds 3 cards. */
function spiderAttacks(opts: { blocker?: Partial<Def>; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "spider", def: printing(SACSPIDER), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 2, life: 5, speed: 3, ...opts.blocker }), owner: P2, zone: "play" },
      ...fillers("mine", 2, P1, "hand"),
      ...fillers("oh", 3, P2, "hand"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(SACSPIDER, "0:rule", "the card itself: costs 3, needs [O][O], and has 2 strength / 3 speed / 1 life", () => {
  const mk = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "spider", def: printing(SACSPIDER), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const exact = mk(2, 1);
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("spider"));
  assert.equal(zoneOf(exact.engine, exact.id("spider")), "play");
  assert.equal(before - ready(exact.engine), 3, "pays exactly 3");
  assert.deepEqual(stats(exact.engine, exact.id("spider")), [2, 1, 3]);
  const short = mk(2, 0);
  refused(() => playRaw(short.engine, P1, short.id("spider")), "one resource short");
  const noIcons = mk(1, 5);
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("spider")), "only one [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("spider")), "hand");
});

clause(SACSPIDER, "0:rule", "blocking and destroyed by battle damage: the opponent discards their whole hand, into their own discard pile", () => {
  const { engine, id } = spiderDefends();
  const oppHand = ["oh0", "oh1", "oh2"].map(id);
  fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard", "the Sacspider (1 life) was destroyed by the 3 battle damage");
  assert.deepEqual(handOf(engine, P2), [], "the opponent's hand is empty");
  for (const card of oppHand) assert.equal(zoneOf(engine, card), "discard", "each card of the hand was discarded");
  assert.deepEqual(sorted(discardOf(engine, P2)), sorted(oppHand), "into the opponent's own discard pile");
});

clause(SACSPIDER, "0:rule", "only the opponent discards: the Sacspider's controller keeps their hand", () => {
  const { engine, id } = spiderDefends();
  const mine = sorted(handOf(engine, P1));
  fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.deepEqual(sorted(handOf(engine, P1)), mine, "my hand is untouched");
  assert.deepEqual(discardOf(engine, P1), [id("spider")], "only the Sacspider is in my discard pile");
});

clause(SACSPIDER, "0:rule", "attacking and destroyed by the blocker's battle damage: the opponent (the blocker's controller) discards their hand", () => {
  const { engine, id } = spiderAttacks();
  fight(engine, P1, [id("spider")], factionOfP2, [id("blk")]);
  assert.equal(zoneOf(engine, id("spider")), "discard", "destroyed by the blocker's 2 battle damage");
  assert.deepEqual(handOf(engine, P2), [], "the opponent discarded their hand");
  assert.equal(discardOf(engine, P2).length, 3);
  assert.equal(handOf(engine, P1).length, 2, "the attacker's controller keeps their hand");
});

clause(SACSPIDER, "0:rule", "the whole hand goes, whatever its size: 1 card, and 6 cards (resource cards too)", () => {
  for (const size of [1, 6]) {
    const { engine, id } = spiderDefends({ ophand: size });
    fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
    assert.equal(handOf(engine, P2).length, 0, `${size} card(s) in hand: all discarded`);
    assert.equal(discardOf(engine, P2).length, size);
  }
  const withResource = spiderDefends({ ophand: 2, extra: [{ key: "ores", def: resourceCard({ name: "OStaple" }), owner: P2, zone: "hand" }] });
  fight(withResource.engine, P2, [withResource.id("atk")], factionOfP1, [withResource.id("spider")]);
  assert.equal(handOf(withResource.engine, P2).length, 0);
  assert.equal(zoneOf(withResource.engine, withResource.id("ores")), "discard", "the resource card is discarded as well");
});

clause(SACSPIDER, "0:rule", "an opponent with no cards in hand discards nothing and the game carries on", () => {
  const { engine, id } = spiderDefends({ ophand: 0 });
  fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(pending(engine), undefined, "nothing is left pending");
  assert.deepEqual(discardOf(engine, P2), []);
  assert.equal(deckOf(engine, P2).length, 2, "the opponent's deck is untouched");
});

clause(SACSPIDER, "0:rule", "only the hand is discarded: the opponent's deck and the attacker in play are untouched", () => {
  const { engine, id } = spiderDefends();
  fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(deckOf(engine, P2).length, 2, "deck untouched");
  assert.equal(zoneOf(engine, id("atk")), "play", "the attacker is still in play");
});

clause(SACSPIDER, "0:rule", "a Sacspider that survives battle (the attacker deals 0) does not make the opponent discard", () => {
  const { engine, id } = spiderDefends({ attacker: { strength: 0 } });
  fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "play", "0 battle damage does not destroy it");
  assert.equal(handOf(engine, P2).length, 3, "the opponent keeps their hand");
});

clause(SACSPIDER, "0:rule", "a Sacspider that is not hit does not make the opponent discard (attacking, unblocked)", () => {
  const { engine, id } = spiderAttacks();
  fight(engine, P1, [id("spider")], factionOfP2, []);
  assert.equal(zoneOf(engine, id("spider")), "play");
  assert.equal(handOf(engine, P2).length, 3);
});

clause(SACSPIDER, "0:rule", "destroyed by a non-battle effect (a 'destroy' tactic): the opponent does not discard", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "spider", def: printing(SACSPIDER), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...fillers("oh", 3, P2, "hand")
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("spider")] } });
  assert.equal(zoneOf(engine, id("spider")), "discard", "destroyed");
  assert.equal(handOf(engine, P2).length, 3, "not by battle damage: the opponent keeps their hand");
});

clause(SACSPIDER, "0:rule", "destroyed by non-battle damage (a damage tactic outside of battle): the opponent does not discard", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "spider", def: printing(SACSPIDER), owner: P1, zone: "play" },
      { key: "zap", def: damageTactic(1), owner: P2, zone: "hand" },
      ...fillers("oh", 3, P2, "hand")
    ]
  });
  play(game.engine, P2, game.id("zap"), { selected: { t: [game.id("spider")] } });
  assert.equal(zoneOf(game.engine, game.id("spider")), "discard", "the 1 damage destroyed the 1-life Sacspider");
  assert.equal(handOf(game.engine, P2).length, 3, "damage from a tactic is not battle damage (FAQ, CR 408.6)");
});

clause(SACSPIDER, "0:rule", "damage from a tactic DURING a battle is not battle damage either (FAQ): the opponent keeps their hand", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "spider", def: printing(SACSPIDER), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 0, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "zap", def: damageTactic(1), owner: P2, zone: "hand" },
      ...fillers("oh", 3, P2, "hand")
    ]
  });
  declareAttackBy(engine, P2, [id("atk")], factionOfP1);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("spider")] });
  playRaw(engine, P2, id("zap"), { selected: { t: [id("spider")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("spider")), "discard", "the tactic's damage destroyed it during the battle");
  autoResolveBattle(engine);
  assert.equal(handOf(engine, P2).length, 3, "tactic damage during a battle is not battle damage");
});

clause(SACSPIDER, "0:rule", "another character of the controller destroyed by battle damage does not make the opponent discard", () => {
  const { engine, id } = spiderDefends({ ally: { life: 2 } });
  declareAttackBy(engine, P2, [id("atk")], factionOfP1);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("spider"), id("ally")] });
  autoResolveBattle(engine, (source) => {
    if (source.strength <= 0 || source.legalTargets.length === 0) return [];
    const target = source.legalTargets.find((t) => (t as { cardId?: string }).cardId === id("ally")) ?? source.legalTargets[0];
    return [{ sourceId: source.cardId, target, amount: source.strength }];
  });
  assert.equal(zoneOf(engine, id("ally")), "discard", "the ally (2 life) was destroyed by battle damage");
  assert.equal(zoneOf(engine, id("spider")), "play", "the Sacspider survived");
  assert.equal(handOf(engine, P2).length, 3, "only the Sacspider's own destruction counts");
});

clause(SACSPIDER, "0:rule", "the Sacspider destroyed in a blocking party alongside its ally still triggers: the opponent discards", () => {
  const { engine, id } = spiderDefends();
  declareAttackBy(engine, P2, [id("atk")], factionOfP1);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("ally"), id("spider")] });
  autoResolveBattle(engine, (source) => {
    if (source.strength <= 0 || source.legalTargets.length === 0) return [];
    const target = source.legalTargets.find((t) => (t as { cardId?: string }).cardId === id("spider")) ?? source.legalTargets[0];
    return [{ sourceId: source.cardId, target, amount: source.strength }];
  });
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(zoneOf(engine, id("ally")), "play", "the ally took none of the damage");
  assert.equal(handOf(engine, P2).length, 0, "the opponent discards their hand");
});

clause(SACSPIDER, "0:rule", "the Sacspider destroying someone else's character does not make anyone discard", () => {
  const { engine, id } = spiderAttacks({ blocker: { life: 1, strength: 0 } });
  fight(engine, P1, [id("spider")], factionOfP2, [id("blk")]);
  assert.equal(zoneOf(engine, id("blk")), "discard", "the blocker (1 life) was destroyed by the Sacspider's battle damage");
  assert.equal(zoneOf(engine, id("spider")), "play", "the Sacspider (blocker deals 0) survives");
  assert.equal(handOf(engine, P2).length, 3, "the destroyed character's controller does not discard");
  assert.equal(handOf(engine, P1).length, 2);
});

clause(SACSPIDER, "0:rule", "simultaneous destruction: a Sacspider and its attacker destroyed in the same damage step still empties the opponent's hand", () => {
  const { engine, id } = spiderDefends({ attacker: { strength: 2, life: 1, speed: 3 } });
  fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(zoneOf(engine, id("atk")), "discard", "the attacker (1 life) was destroyed by the Sacspider's 2 damage");
  assert.equal(handOf(engine, P2).length, 0);
});

clause(SACSPIDER, "0:rule", "'your opponent' is relative to the Sacspider's controller: P2's Sacspider destroyed by battle damage makes P1 discard", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "spider", def: printing(SACSPIDER), owner: P2, zone: "play" },
      ...fillers("mine", 3, P1, "hand"),
      ...fillers("oh", 2, P2, "hand")
    ]
  });
  fight(engine, P1, [id("atk")], factionOfP2, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(handOf(engine, P1).length, 0, "P1 (the opponent of the Sacspider's controller) discards their hand");
  assert.equal(handOf(engine, P2).length, 2, "P2 keeps theirs");
});

clause(SACSPIDER, "0:rule", "'your opponent' follows control: a Sacspider P2 owns but P1 controls makes P2 discard", () => {
  const { engine, id } = spiderDefends({ spiderOwner: P2, spiderController: P1 });
  fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("spider")), true, "it goes to its owner's discard pile");
  assert.equal(handOf(engine, P2).length, 0, "P2 (the controller's opponent) discards their hand");
  assert.equal(handOf(engine, P1).length, 2, "P1, who controls it, keeps their hand");
});

clause(SACSPIDER, "0:rule", "a face-down Sacspider is just a resource: destroying it triggers nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hidden", def: printing(SACSPIDER), owner: P1, zone: "play", faceDown: true },
      {
        key: "kill",
        def: tactic({ name: "KillRes", cost: 0, behavior: { abilities: [{ id: "kr", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }),
        owner: P1,
        zone: "hand"
      },
      ...fillers("oh", 3, P2, "hand")
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("hidden")] } });
  assert.equal(zoneOf(engine, id("hidden")), "discard");
  assert.equal(handOf(engine, P2).length, 3);
});

clause(SACSPIDER, "0:rule", "'destroyed by battle damage' is judged by the damage that put it over its limit (CR 408.8): earlier tactic damage plus lethal battle damage triggers it", () => {
  const buff = item({ name: "LifeBuff", cost: 0, attachTo: "character", behavior: { abilities: [{ id: "lb", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: 2 }] }] } });
  const { engine, id } = spiderDefends({ attacker: { strength: 1 }, extra: [{ key: "buff", def: buff, owner: P1, zone: "play", attachedToKey: "spider" }, { key: "zap", def: damageTactic(2), owner: P2, zone: "hand" }] });
  assert.equal(engine.getStat(id("spider"), "life"), 3);
  play(engine, P2, id("zap"), { selected: { t: [id("spider")] } });
  assert.equal(zoneOf(engine, id("spider")), "play", "2 damage does not destroy a 3-life Sacspider");
  fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard", "the 1 battle damage put it over its limit");
  assert.equal(handOf(engine, P2).length, 0, "destroyed by battle damage");
});

clause(SACSPIDER, "0:rule", "...and when non-battle damage puts it over its limit after earlier battle damage, it was not destroyed by battle damage", () => {
  const buff = item({ name: "LifeBuff", cost: 0, attachTo: "character", behavior: { abilities: [{ id: "lb", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: 2 }] }] } });
  const { engine, id } = spiderDefends({ attacker: { strength: 2 }, extra: [{ key: "buff", def: buff, owner: P1, zone: "play", attachedToKey: "spider" }, { key: "zap", def: damageTactic(1), owner: P2, zone: "hand" }] });
  fight(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "play", "2 battle damage does not destroy a 3-life Sacspider");
  assert.equal(handOf(engine, P2).length, 4, "no discard yet (the zap is in hand)");
  play(engine, P2, id("zap"), { selected: { t: [id("spider")] } });
  assert.equal(zoneOf(engine, id("spider")), "discard", "the tactic's 1 damage put it over its limit");
  assert.equal(handOf(engine, P2).length, 3, "not destroyed by battle damage: the hand stays (the zap left it)");
});

// =============================================================================
// Violating Anomaly
// When this card enters play, look at your opponent's hand and choose a card in it.
// Your opponent discards that card.
// If this card leaves play, you may pick a non-resource card. If you do, put it into
// its owner's hand. Draw a card.
// Character (arcanist; muddler, lurker), cost 6, threshold [O][O], 2 strength / 2 speed / 4 life.
// =============================================================================

const ANOMALY = "4d2d797d-30ea-4b54-9826-b0140b03b9ff";

/** P1 holds the Anomaly with 6 [O]; P2 holds three characters (`oh0..2`) and a staple Greed resource card (`ores`). */
function anomalyDeploy(opts: { ophand?: boolean; extra?: CardPlacement[]; obsession?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "hand" },
      ...fillers("mine", 2, P1, "hand"),
      ...(opts.ophand === false ? [] : [...fillers("oh", 3, P2, "hand"), { key: "ores", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P2, zone: "hand" as const }]),
      ...fillers("od", 2, P2, "deck"),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("obsession", opts.obsession ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(ANOMALY, "0:rule", "the card itself: costs 6, needs [O][O], and has 2 strength / 2 speed / 4 life", () => {
  const exact = anomalyDeploy({ obsession: 6 });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("an"));
  assert.equal(zoneOf(exact.engine, exact.id("an")), "play");
  assert.equal(before - ready(exact.engine), 6, "pays exactly 6");
  assert.deepEqual(stats(exact.engine, exact.id("an")), [2, 4, 2]);
  assert.deepEqual(sorted(exact.engine.getDefinition(exact.id("an")).subtype ?? []), ["lurker", "muddler"]);
  const short = anomalyDeploy({ obsession: 5 });
  refused(() => playRaw(short.engine, P1, short.id("an")), "one resource short");
  const noIcons = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "an", def: printing(ANOMALY), owner: P1, zone: "hand" }, ...bank("obsession", 1, P1), ...bank("greed", 8, P1)]
  });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("an")), "only one [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("an")), "hand");
});

clause(ANOMALY, "0:rule", "entering play: its controller chooses a card from the opponent's hand, and the opponent discards exactly that card", () => {
  const { engine, id } = anomalyDeploy();
  const before = sorted(handOf(engine, P2));
  play(engine, P1, id("an"));
  assert.equal(zoneOf(engine, id("an")), "play", "the Anomaly is in play");
  const pc = pending(engine);
  assert.ok(pc, "a choice is required");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Anomaly's controller chooses (not the opponent)");
  pick(engine, [id("oh1")]);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("oh1")), "discard", "the chosen card was discarded");
  assert.deepEqual(discardOf(engine, P2), [id("oh1")], "into the opponent's own discard pile, and nothing else with it");
  assert.deepEqual(sorted(handOf(engine, P2)), sorted(before.filter((card) => card !== id("oh1"))), "every other card stays in their hand");
});

for (const key of ["oh0", "oh1", "oh2", "ores"]) {
  clause(ANOMALY, "0:rule", `any card of the opponent's hand can be chosen, and only it is discarded (${key}${key === "ores" ? ", a resource card: 'a card'" : ""})`, () => {
    const { engine, id } = anomalyDeploy();
    play(engine, P1, id("an"));
    pick(engine, [id(key)]);
    assert.deepEqual(discardOf(engine, P2), [id(key)]);
    assert.equal(handOf(engine, P2).length, 3);
    assert.equal(handOf(engine, P1).length, 2, "my hand is untouched");
  });
}

clause(ANOMALY, "0:rule", "the choice must come from the OPPONENT'S HAND: my own hand, their deck, discard pile, play area and faction are refused", () => {
  const { engine, id } = anomalyDeploy({ extra: [{ key: "oldDiscard", def: character({ name: "Old" }), owner: P2, zone: "discard" }] });
  play(engine, P1, id("an"));
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  refused(() => pickRaw(engine, [id("mine0")]), "a card of my own hand");
  refused(() => pickRaw(engine, [id("od0")]), "a card of their deck");
  refused(() => pickRaw(engine, [id("oldDiscard")]), "a card of their discard pile");
  refused(() => pickRaw(engine, [id("foe")]), "a character they have in play");
  refused(() => pickRaw(engine, [factionOf(engine, P2)]), "their faction");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the choice is still open after the refusals");
  pick(engine, [id("oh2")]);
  assert.equal(zoneOf(engine, id("oh2")), "discard", "control: a card of their hand is accepted");
});

clause(ANOMALY, "0:rule", "'choose a card ... discards that card' is mandatory and exactly one: nothing, or two cards, is refused while the opponent holds cards", () => {
  const { engine, id } = anomalyDeploy();
  play(engine, P1, id("an"));
  refused(() => pickRaw(engine, []), "choosing nothing");
  refused(() => pickRaw(engine, [id("oh0"), id("oh1")]), "choosing two cards");
  assert.equal(handOf(engine, P2).length, 4, "nothing was discarded by the refused answers");
  pick(engine, [id("oh0")]);
  assert.equal(discardOf(engine, P2).length, 1, "exactly one card discarded");
});

clause(ANOMALY, "0:rule", "the opponent with exactly one card in hand discards it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "hand" },
      { key: "only", def: character({ name: "Only" }), owner: P2, zone: "hand" },
      ...bank("obsession", 6, P1)
    ]
  });
  play(engine, P1, id("an"));
  if (pending(engine)) pick(engine, [id("only")]);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("only")), "discard");
  assert.deepEqual(handOf(engine, P2), []);
});

clause(ANOMALY, "0:rule", "an opponent with an empty hand: nothing to choose or discard, the Anomaly is in play and nothing is stuck", () => {
  const { engine, id } = anomalyDeploy({ ophand: false });
  play(engine, P1, id("an"));
  assert.equal(zoneOf(engine, id("an")), "play");
  assert.equal(pending(engine), undefined, "no choice is offered");
  assert.equal(engine.state.responseWindow, undefined);
  assert.deepEqual(discardOf(engine, P2), []);
  assert.deepEqual(discardOf(engine, P1), [], "I discard nothing either");
});

clause(ANOMALY, "0:rule", "the discard happens when the Anomaly ENTERS play, not while it is still waiting for responses", () => {
  const { engine, id } = anomalyDeploy();
  playRaw(engine, P1, id("an"));
  assert.equal(zoneOf(engine, id("an")), "deploying");
  assert.equal(pending(engine), undefined, "no choice while it is being deployed");
  assert.equal(handOf(engine, P2).length, 4);
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the choice opens once it has entered play");
  assert.equal(zoneOf(engine, id("an")), "play");
});

clause(ANOMALY, "0:rule", "another character entering play does not trigger it (mine, or the opponent's)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" },
      ...fillers("oh", 2, P2, "hand"),
      ...bank("obsession", 2, P1),
      ...bank("rage", 2, P2)
    ]
  });
  play(engine, P1, id("newbie"));
  assert.equal(zoneOf(engine, id("newbie")), "play");
  assert.equal(pending(engine), undefined, "my own newcomer does not trigger the Anomaly");
  endTurn(engine, P1);
  play(engine, P2, id("theirs"));
  assert.equal(zoneOf(engine, id("theirs")), "play");
  assert.equal(pending(engine), undefined, "the opponent's newcomer does not trigger it either");
  assert.equal(handOf(engine, P2).length, 2, "nothing was discarded");
});

clause(ANOMALY, "0:rule", "also triggers when it is put into play by an effect instead of being deployed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      {
        key: "putter",
        def: tactic({
          name: "Putter",
          cost: 0,
          behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
        }),
        owner: P1,
        zone: "hand"
      },
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "hand" },
      ...fillers("oh", 3, P2, "hand")
    ]
  });
  play(engine, P1, id("putter"), { selected: { t: [id("an")] } });
  assert.equal(zoneOf(engine, id("an")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the entering-play choice opens");
  pick(engine, [id("oh2")]);
  assert.deepEqual(discardOf(engine, P2), [id("oh2")]);
});

clause(ANOMALY, "0:rule", "'your opponent' is relative to its controller: P2's Anomaly chooses from P1's hand", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "an", def: printing(ANOMALY), owner: P2, zone: "hand" },
      ...fillers("mine", 3, P1, "hand"),
      ...fillers("oh", 2, P2, "hand"),
      ...bank("obsession", 6, P2)
    ]
  });
  play(engine, P2, id("an"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "P2 (the controller) chooses");
  refused(() => pickRaw(engine, [id("oh0")]), "not from their own hand");
  pick(engine, [id("mine1")]);
  assert.deepEqual(discardOf(engine, P1), [id("mine1")], "P1 discards the chosen card");
  assert.equal(handOf(engine, P2).length, 2);
});

// -- If this card leaves play ---------------------------------------------------------

/** The Anomaly in play for P1 plus a cast of cards to pick; a destroyer tactic for P1 and a deck to draw from. */
function anomalyLeaves(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeItm", def: item({ name: "FoeItm" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 2, P2, "deck"),
      ...extra
    ]
  });
}

type LeaveGame = ReturnType<typeof anomalyLeaves>;

/** Drives the leave-play prompts: accept (or decline) the optional pick and pick `pickKey`. */
function leaveScript(id: (key: string) => CardInstanceId, accept: boolean, pickKey?: string) {
  return (pc: PendingChoiceLike): unknown => {
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: accept ? 0 : 1 };
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: pickKey ? [id(pickKey)] : [] };
    return declineAll(pc);
  };
}

function destroyAnomaly(game: LeaveGame, accept: boolean, pickKey?: string): void {
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("an")] } });
  drain(game.engine, leaveScript(game.id, accept, pickKey));
}

clause(ANOMALY, "1:rule", "destroyed: its controller may pick a non-resource card in play; it goes to its owner's hand and they draw a card", () => {
  const game = anomalyLeaves();
  const top = deckOf(game.engine, P1)[0];
  destroyAnomaly(game, true, "mine");
  assert.equal(zoneOf(game.engine, game.id("an")), "discard", "the Anomaly was destroyed");
  assert.equal(zoneOf(game.engine, game.id("mine")), "hand", "my character was put into my hand");
  assert.ok(handOf(game.engine, P1).includes(game.id("mine")), "handOf(game.engine, P1).includes(game.id(\"mine\"))");
  assert.equal(zoneOf(game.engine, top), "hand", "and I drew the top card of my deck");
  assert.equal(deckOf(game.engine, P1).length, 2);
  assert.equal(pending(game.engine), undefined);
});

clause(ANOMALY, "1:rule", "picking the opponent's character puts it into ITS OWNER'S hand (the opponent's), and I draw", () => {
  const game = anomalyLeaves();
  const top = deckOf(game.engine, P1)[0];
  destroyAnomaly(game, true, "foe");
  assert.equal(zoneOf(game.engine, game.id("foe")), "hand");
  assert.ok(handOf(game.engine, P2).includes(game.id("foe")), "in the opponent's hand");
  assert.equal(handOf(game.engine, P1).includes(game.id("foe")), false, "not in mine");
  assert.ok(handOf(game.engine, P1).includes(top), "I drew a card");
});

for (const [key, what] of [["itm", "an item I control"], ["loc", "a location I control"], ["foeItm", "an opponent's item"], ["foeLoc", "an opponent's location"]] as const) {
  clause(ANOMALY, "1:rule", `any non-resource card can be picked: ${what}`, () => {
    const game = anomalyLeaves();
    const owner = game.engine.state.cards[game.id(key)].ownerId as Pid;
    destroyAnomaly(game, true, key);
    assert.equal(zoneOf(game.engine, game.id(key)), "hand");
    assert.ok(handOf(game.engine, owner).includes(game.id(key)), "in its owner's hand");
  });
}

clause(ANOMALY, "1:rule", "a card I control but the opponent owns goes to the OWNER's hand", () => {
  const game = anomalyLeaves([{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }]);
  destroyAnomaly(game, true, "stolen");
  assert.ok(handOf(game.engine, P2).includes(game.id("stolen")), "back to its owner");
  assert.equal(handOf(game.engine, P1).includes(game.id("stolen")), false);
});

clause(ANOMALY, "1:rule", "'you may': declining picks nothing, nothing returns to a hand, but the card is still drawn", () => {
  const game = anomalyLeaves();
  const top = deckOf(game.engine, P1)[0];
  destroyAnomaly(game, false);
  assert.equal(zoneOf(game.engine, game.id("an")), "discard");
  for (const key of ["mine", "itm", "loc", "foe", "foeItm", "foeLoc"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", `${key} stayed in play`);
  assert.equal(zoneOf(game.engine, top), "hand", "'Draw a card' does not depend on the pick: it still happens");
  assert.equal(pending(game.engine), undefined);
});

clause(ANOMALY, "1:rule", "'Draw a card' draws exactly one card, whether or not a card was picked, and only for the Anomaly's controller", () => {
  for (const accept of [true, false]) {
    const game = anomalyLeaves();
    const deckBefore = deckOf(game.engine, P1).length;
    destroyAnomaly(game, accept, accept ? "foe" : undefined);
    assert.equal(deckBefore - deckOf(game.engine, P1).length, 1, `accept=${accept}`);
    assert.equal(deckOf(game.engine, P2).length, 2, "the opponent draws nothing");
  }
});

clause(ANOMALY, "1:rule", "the pick is limited to non-resource cards in play: resources, face-down cards, factions, cards outside play are refused; one card exactly", () => {
  const game = anomalyLeaves([...bank("greed", 1, P1)]);
  const resourceId = game.engine.state.players[P1].play.find((card) => game.engine.getDefinition(card).type === "resource")!;
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("an")] } });
  assert.equal(pending(game.engine)?.kind, "chooserSelectsOption");
  answerPending(game.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  refused(() => pickRaw(game.engine, [resourceId]), "a face-up resource");
  refused(() => pickRaw(game.engine, [game.id("hidden")]), "a face-down card is a resource");
  refused(() => pickRaw(game.engine, [factionOf(game.engine, P1)]), "my faction (CR 202.9)");
  refused(() => pickRaw(game.engine, [factionOf(game.engine, P2)]), "their faction");
  refused(() => pickRaw(game.engine, [game.id("inHand")]), "a card in a hand");
  refused(() => pickRaw(game.engine, [game.id("inDiscard")]), "a card in a discard pile");
  refused(() => pickRaw(game.engine, [game.id("od0")]), "a card in a deck");
  refused(() => pickRaw(game.engine, [game.id("mine"), game.id("foe")]), "two cards");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "still open after the refusals");
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  pickRaw(game.engine, [game.id("itm")]);
  assert.equal(zoneOf(game.engine, game.id("itm")), "hand", "control: a non-resource card in play is accepted");
});

clause(ANOMALY, "1:rule", "the Anomaly itself cannot be picked: it has already left play", () => {
  const game = anomalyLeaves();
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("an")] } });
  answerPending(game.engine, "chooserSelectsOption", { index: 0 });
  refused(() => pickRaw(game.engine, [game.id("an")]), "the Anomaly is in the discard pile");
  assert.equal(zoneOf(game.engine, game.id("an")), "discard");
});

clause(ANOMALY, "1:rule", "its controller makes the choices even when the OPPONENT destroys it; only the controller draws", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      ...fillers("d", 2, P1, "deck"),
      ...fillers("od", 2, P2, "deck")
    ]
  });
  const top = deckOf(game.engine, P1)[0];
  const oppTop = deckOf(game.engine, P2)[0];
  play(game.engine, P2, game.id("kill"), { selected: { t: [game.id("an")] } });
  assert.equal(pending(game.engine)?.playerId, P1, "the Anomaly's controller is asked, not the destroyer");
  drain(game.engine, leaveScript(game.id, true, "foe"));
  assert.equal(zoneOf(game.engine, game.id("foe")), "hand", "the pick was made");
  assert.equal(zoneOf(game.engine, top), "hand", "its controller drew");
  assert.equal(zoneOf(game.engine, oppTop), "deck", "the destroyer did not");
});

clause(ANOMALY, "1:rule", "'leaves play' is not only destruction: returned to its owner's hand it triggers too", () => {
  const game = anomalyLeaves([{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]);
  const top = deckOf(game.engine, P1)[0];
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("an")] } });
  assert.equal(zoneOf(game.engine, game.id("an")), "hand", "the Anomaly returned to hand");
  drain(game.engine, leaveScript(game.id, true, "foe"));
  assert.equal(zoneOf(game.engine, game.id("foe")), "hand", "the pick resolved");
  assert.equal(zoneOf(game.engine, top), "hand", "and a card was drawn");
});

clause(ANOMALY, "1:rule", "leaving play by being destroyed in battle triggers it as well", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...fillers("d", 2, P1, "deck")
    ]
  });
  const top = deckOf(game.engine, P1)[0];
  declareAttackBy(game.engine, P2, [game.id("atk")], factionOfP1);
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("an")] });
  finishBattle(game.engine, undefined, leaveScript(game.id, true, "itm"));
  assert.equal(zoneOf(game.engine, game.id("an")), "discard");
  assert.equal(zoneOf(game.engine, game.id("itm")), "hand", "picked item returned to hand");
  assert.equal(zoneOf(game.engine, top), "hand", "card drawn");
});

clause(ANOMALY, "1:rule", "being turned face-down counts as leaving play (CR 411.4): the leave-play trigger runs", () => {
  const flipDown = tactic({
    name: "FlipDown",
    cost: 0,
    behavior: { abilities: [{ id: "fd", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
  });
  const game = anomalyLeaves([{ key: "flip", def: flipDown, owner: P1, zone: "hand" }]);
  const top = deckOf(game.engine, P1)[0];
  play(game.engine, P1, game.id("flip"), { selected: { t: [game.id("an")] } });
  assert.equal(game.engine.state.cards[game.id("an")].faceDown, true);
  drain(game.engine, leaveScript(game.id, true, "foe"));
  assert.equal(zoneOf(game.engine, game.id("foe")), "hand", "the pick resolved");
  assert.equal(zoneOf(game.engine, top), "hand", "and a card was drawn");
});

clause(ANOMALY, "1:rule", "another card of mine leaving play does not trigger it", () => {
  const game = anomalyLeaves();
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("mine")] } });
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  assert.equal(pending(game.engine), undefined, "no prompt");
  assert.equal(zoneOf(game.engine, game.id("an")), "play");
  assert.equal(deckOf(game.engine, P1).length, 3, "nothing was drawn");
});

clause(ANOMALY, "1:rule", "a face-down Anomaly is just a resource: leaving play triggers nothing", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fd", def: printing(ANOMALY), owner: P1, zone: "play", faceDown: true },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      {
        key: "kill",
        def: tactic({ name: "KillRes", cost: 0, behavior: { abilities: [{ id: "kr", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }),
        owner: P1,
        zone: "hand"
      },
      ...fillers("d", 2, P1, "deck")
    ]
  });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("fd")] } });
  assert.equal(zoneOf(game.engine, game.id("fd")), "discard");
  assert.equal(pending(game.engine), undefined, "dormant");
  assert.equal(deckOf(game.engine, P1).length, 2, "nothing drawn");
});

clause(ANOMALY, "1:rule", "with an empty deck the pick still happens and nothing breaks (CR 306.2: you just fail to draw)", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("an")] } });
  drain(game.engine, leaveScript(game.id, true, "mine"));
  assert.equal(zoneOf(game.engine, game.id("mine")), "hand");
  assert.equal(pending(game.engine), undefined);
  assert.equal(deckOf(game.engine, P1).length, 0);
});

clause(ANOMALY, "1:rule", "with no other non-resource card in play there is nothing to pick, but 'Draw a card' still happens and nothing is left pending", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck")
    ]
  });
  const top = deckOf(game.engine, P1)[0];
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("an")] } });
  drain(game.engine, leaveScript(game.id, true));
  assert.equal(zoneOf(game.engine, game.id("an")), "discard");
  assert.equal(zoneOf(game.engine, top), "hand", "the card was still drawn");
  assert.equal(pending(game.engine), undefined);
});

clause(ANOMALY, "1:rule", "damage on the picked card is gone when it is put into its owner's hand (CR 408.9)", () => {
  const game = anomalyLeaves([{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P1, zone: "play", damage: 2 }]);
  destroyAnomaly(game, true, "hurt");
  assert.equal(zoneOf(game.engine, game.id("hurt")), "hand");
  assert.equal(game.engine.state.cards[game.id("hurt")].damage, 0);
});

clause(ANOMALY, "1:rule", "tokens on the picked card disappear when it is put into its owner's hand (CR 409.2)", () => {
  const game = anomalyLeaves([{ key: "ticker", def: character({ name: "Ticker" }), owner: P1, zone: "play", counters: { token: 2 } }]);
  destroyAnomaly(game, true, "ticker");
  assert.equal(zoneOf(game.engine, game.id("ticker")), "hand");
  assert.equal(tokens(game.engine, game.id("ticker")), 0);
});

clause(ANOMALY, "1:rule", "a card attached to the picked character leaves play the same way: it goes to ITS OWNER's hand too (CR 301.4a)", () => {
  const gear = item({ name: "Gear", cost: 1, attachTo: "character" });
  const game = anomalyLeaves([{ key: "gear", def: gear, owner: P1, zone: "play", attachedToKey: "foe" }]);
  destroyAnomaly(game, true, "foe");
  assert.equal(zoneOf(game.engine, game.id("foe")), "hand");
  assert.equal(zoneOf(game.engine, game.id("gear")), "hand", "the attached item left play in the same way: into its owner's hand");
});

// =============================================================================
// Voidal Interference
// COST: Play this only in response to a card being played. (Playing a resource
// doesn't count.)
// EFFECT: Terminate the card, but put it into its owner's hand instead of their
// discard pile. Its owner puts a card from their hand on the top of their deck.
// Tactic (arcanist), cost 3, threshold [O].
// =============================================================================

const INTERFERENCE = "a9f369a5-06f7-426b-9e23-137f0ad1bdc2";

/** A tactic of P2's that kills one of the opponent's characters when it resolves (picked on play: id `k`, declaration `t`). */
function slayTactic(cost = 1): Def {
  return tactic({
    name: "Slay",
    cost,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
}

interface InterfOpts {
  /** What P2 plays (a cost-1 card). */
  played?: Def;
  obsession?: number;
  greed?: number;
  extra?: CardPlacement[];
  p2Hand?: number;
}

/** P2's turn. P2 holds `played` (`opp`) and other cards (`ph0..`); P1 holds the Interference (`vi`) and 2 cards. */
function interfBoard(opts: InterfOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "vi", def: printing(INTERFERENCE), owner: P1, zone: "hand" },
      { key: "opp", def: opts.played ?? character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" },
      { key: "victim", def: character({ name: "Victim", life: 3 }), owner: P1, zone: "play" },
      ...fillers("ph", opts.p2Hand ?? 3, P2, "hand"),
      ...fillers("mine", 2, P1, "hand"),
      ...fillers("od", 2, P2, "deck"),
      ...fillers("d", 2, P1, "deck"),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("rage", 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type InterfBoard = ReturnType<typeof interfBoard>;

/** P2 plays `opp`, P1 answers with the Interference, and the responses resolve until P2's put-on-top choice opens. */
function interfere(game: InterfBoard, selected: Record<string, CardInstanceId[]> = {}): void {
  playRaw(game.engine, P2, game.id("opp"), { selected });
  playRaw(game.engine, P1, game.id("vi"));
  resolvePendingResponses(game.engine);
}

/** Answers the owner's put-on-top choice with `key` (a hand card), asserting P2 is the one asked. */
function putOnTop(game: InterfBoard, key: string): void {
  const pc = pending(game.engine);
  assert.ok(pc, "the owner is asked to put a card on top of their deck");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the card's owner chooses");
  pick(game.engine, [game.id(key)]);
}

clause(INTERFERENCE, "0:ability", "in response to a character being played: it is terminated (never enters play, no enters-play trigger) and returns to its owner's hand", () => {
  const game = interfBoard({ played: drawOnEnter("Greeter", { cost: 1 }) });
  const deckBefore = deckOf(game.engine, P2).length;
  interfere(game);
  assert.equal(zoneOf(game.engine, game.id("opp")), "hand", "back in its owner's hand, not in play");
  assert.ok(handOf(game.engine, P2).includes(game.id("opp")), "handOf(game.engine, P2).includes(game.id(\"opp\"))");
  assert.equal(game.engine.state.players[P2].play.includes(game.id("opp")), false);
  putOnTop(game, "ph0");
  assert.equal(deckOf(game.engine, P2).length, deckBefore + 1, "only the card put on top is added: the enters-play trigger did not draw");
  assert.equal(zoneOf(game.engine, game.id("vi")), "discard", "the Interference itself goes to its owner's discard pile");
});

clause(INTERFERENCE, "0:ability", "in response to an item being played: it is terminated and returns to its owner's hand instead of entering play", () => {
  const game = interfBoard({ played: item({ name: "Gadget", cost: 1 }) });
  interfere(game);
  assert.equal(zoneOf(game.engine, game.id("opp")), "hand");
  assert.equal(game.engine.state.players[P2].play.includes(game.id("opp")), false);
});

clause(INTERFERENCE, "0:ability", "in response to a location being played: it is terminated and returns to its owner's hand instead of entering play", () => {
  const game = interfBoard({ played: location({ name: "Hovel", cost: 1 }) });
  interfere(game);
  assert.equal(zoneOf(game.engine, game.id("opp")), "hand");
  assert.equal(game.engine.state.players[P2].play.includes(game.id("opp")), false);
});

clause(INTERFERENCE, "0:ability", "in response to a tactic being played: the tactic returns to its owner's hand, NOT its discard pile, and its effect does not happen", () => {
  const game = interfBoard({ played: slayTactic() });
  interfere(game, { t: [game.id("victim")] });
  assert.equal(zoneOf(game.engine, game.id("opp")), "hand", "the tactic is in its owner's hand");
  assert.equal(discardOf(game.engine, P2).includes(game.id("opp")), false, "not in the discard pile");
  assert.equal(zoneOf(game.engine, game.id("victim")), "play", "its effect (destroy the victim) did not happen");
});

clause(INTERFERENCE, "0:ability", "terminating does not refund what was already paid: the terminated card's cost resources stay spent", () => {
  const game = interfBoard({ played: character({ name: "Opp", cost: 2 }) });
  const before = ready(game.engine, P2);
  playRaw(game.engine, P2, game.id("opp"));
  assert.equal(before - ready(game.engine, P2), 2, "control: the opponent paid 2");
  playRaw(game.engine, P1, game.id("vi"));
  resolvePendingResponses(game.engine);
  assert.equal(before - ready(game.engine, P2), 2, "terminate stops the card; it does not give the cost back");
});

clause(INTERFERENCE, "0:ability", "terminating does not refund extra costs already paid either (influence lost as a cost stays lost)", () => {
  const game = interfBoard({ played: influenceTaxChar(2, "Opp", 1) });
  const start = influence(game.engine, P2);
  playRaw(game.engine, P2, game.id("opp"));
  assert.equal(influence(game.engine, P2), start - 2, "control: the extra cost was paid");
  playRaw(game.engine, P1, game.id("vi"));
  resolvePendingResponses(game.engine);
  assert.equal(influence(game.engine, P2), start - 2, "not refunded");
  assert.equal(zoneOf(game.engine, game.id("opp")), "hand");
});

clause(INTERFERENCE, "0:ability", "its owner then puts a card from their hand on top of their deck: choosing another card puts exactly that card on top", () => {
  const game = interfBoard();
  const deckBefore = [...deckOf(game.engine, P2)];
  const handBefore = handOf(game.engine, P2).length;
  interfere(game);
  putOnTop(game, "ph1");
  assert.equal(zoneOf(game.engine, game.id("ph1")), "deck");
  assert.equal(deckOf(game.engine, P2)[0], game.id("ph1"), "on TOP of the deck");
  assert.deepEqual(deckOf(game.engine, P2).slice(1), deckBefore, "the rest of the deck is unchanged below it");
  assert.equal(handOf(game.engine, P2).length, handBefore - 1, "the played card left the hand (-1), came back (+1), and one card went on the deck (-1)");
  assert.ok(handOf(game.engine, P2).includes(game.id("opp")), "the bounced card is in their hand");
});

clause(INTERFERENCE, "0:ability", "the card put on top may be the very card that was returned", () => {
  const game = interfBoard();
  const deckBefore = [...deckOf(game.engine, P2)];
  interfere(game);
  putOnTop(game, "opp");
  assert.equal(deckOf(game.engine, P2)[0], game.id("opp"), "the returned card is on top of its owner's deck");
  assert.deepEqual(deckOf(game.engine, P2).slice(1), deckBefore);
  assert.equal(handOf(game.engine, P2).length, 3, "their original three cards are still in hand");
});

for (const key of ["ph0", "ph1", "ph2"]) {
  clause(INTERFERENCE, "0:ability", `any card of the owner's hand can go on top (${key}), and only that card moves`, () => {
    const game = interfBoard();
    interfere(game);
    putOnTop(game, key);
    assert.equal(deckOf(game.engine, P2)[0], game.id(key));
    for (const rest of ["ph0", "ph1", "ph2"].filter((k) => k !== key)) assert.equal(zoneOf(game.engine, game.id(rest)), "hand", `${rest} stays in hand`);
    assert.equal(zoneOf(game.engine, game.id("opp")), "hand");
  });
}

clause(INTERFERENCE, "0:ability", "with no other card in hand, the returned card is the only one the owner can put on top", () => {
  const game = interfBoard({ p2Hand: 0 });
  interfere(game);
  if (pending(game.engine)) pick(game.engine, [game.id("opp")], P2);
  assert.equal(deckOf(game.engine, P2)[0], game.id("opp"), "the returned card went on top");
  assert.deepEqual(handOf(game.engine, P2), [], "their hand is empty");
});

const putOnTopAttempt = (game: InterfBoard, cardId: CardInstanceId) => () => pickRaw(game.engine, [cardId], P2);

clause(INTERFERENCE, "0:ability", "the card must come from the OWNER's hand: a card in the Interference caster's hand is refused", () => {
  const game = interfBoard();
  interfere(game);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  refused(putOnTopAttempt(game, game.id("mine0")), "a card from the caster's hand is not 'a card from their hand'");
  assert.equal(handOf(game.engine, P1).includes(game.id("mine0")), true, "the caster's hand is untouched");
});

clause(INTERFERENCE, "0:ability", "the card must come from the OWNER's hand: cards in decks and in play are refused, a card of their own hand is accepted", () => {
  const game = interfBoard();
  interfere(game);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  refused(putOnTopAttempt(game, game.id("d0")), "a card from the caster's deck");
  refused(putOnTopAttempt(game, game.id("od0")), "a card from their own deck (not in hand)");
  refused(putOnTopAttempt(game, game.id("victim")), "a card in play");
  putOnTopAttempt(game, game.id("ph0"))();
  assert.equal(deckOf(game.engine, P2)[0], game.id("ph0"), "control: a card of their own hand is accepted");
});

clause(INTERFERENCE, "0:ability", "'puts a card' is mandatory: the owner has cards in hand, so putting nothing on top is refused", () => {
  const game = interfBoard();
  interfere(game);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  refused(() => pickRaw(game.engine, [], P2), "putting nothing on top cannot be chosen");
});

clause(INTERFERENCE, "0:ability", "exactly one card is put on top: two are refused", () => {
  const game = interfBoard();
  interfere(game);
  refused(() => pickRaw(game.engine, [game.id("ph0"), game.id("ph1")], P2));
  assert.equal(deckOf(game.engine, P2).length, 2, "nothing moved");
  pick(game.engine, [game.id("ph0")], P2);
  assert.equal(deckOf(game.engine, P2).length, 3);
});

clause(INTERFERENCE, "0:ability", "costs 3 and needs [O]: one resource short, or no [O], is refused; exactly 3 with one [O] works", () => {
  const short = interfBoard({ obsession: 2 });
  playRaw(short.engine, P2, short.id("opp"));
  refused(() => playRaw(short.engine, P1, short.id("vi")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("vi")), "hand");
  assert.equal(ready(short.engine), 2, "nothing was spent");

  const noIcons = interfBoard({ obsession: 0, greed: 5 });
  playRaw(noIcons.engine, P2, noIcons.id("opp"));
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("vi")), "no [O]");

  const exact = interfBoard({ obsession: 1, greed: 2 });
  playRaw(exact.engine, P2, exact.id("opp"));
  const before = ready(exact.engine);
  playRaw(exact.engine, P1, exact.id("vi"));
  assert.equal(before - ready(exact.engine), 3, "pays exactly 3, as a cost when it is played");
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("opp")), "hand");
});

clause(INTERFERENCE, "0:ability", "only in response to a card being played: with nothing being played it cannot be played", () => {
  const game = interfBoard();
  refused(() => playRaw(game.engine, P1, game.id("vi")), "nothing to respond to");
  assert.equal(zoneOf(game.engine, game.id("vi")), "hand");
  assert.equal(ready(game.engine), 3, "nothing was spent");
});

clause(INTERFERENCE, "0:ability", "it cannot be played on my own turn with nothing to respond to, and I cannot respond to my own card", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "vi", def: printing(INTERFERENCE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  refused(() => playRaw(game.engine, P1, game.id("vi")), "nothing to respond to");
  playRaw(game.engine, P1, game.id("mine"));
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent holds priority over my card (CR 607.1)");
  assert.equal(game.engine.getCardPlayability(P1, game.id("vi")).playable, false, "I cannot respond to my own action");
  assert.equal(zoneOf(game.engine, game.id("vi")), "hand");
});

clause(INTERFERENCE, "0:ability", "it cannot be played in response to an ability being activated", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "vi", def: printing(INTERFERENCE), owner: P1, zone: "hand" },
      { key: "drawer", def: character({ name: "Drawer", behavior: { abilities: [{ id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P2, zone: "play" },
      { key: "ctl", def: drawTactic("Control", 1, 0), owner: P1, zone: "hand" },
      ...fillers("od", 2, P2, "deck"),
      ...bank("obsession", 3, P1)
    ]
  });
  activateRaw(game.engine, P2, game.id("drawer"), "draw1");
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond to the ability");
  refused(() => playRaw(game.engine, P1, game.id("vi")), "an ability is not a card being played: its own response condition is unmet", /cannot be deployed right now/);
  assert.equal(zoneOf(game.engine, game.id("vi")), "hand");
  playRaw(game.engine, P1, game.id("ctl"));
  assert.equal(zoneOf(game.engine, game.id("ctl")), "deploying", "control: another tactic can be played in this window");
});

clause(INTERFERENCE, "0:ability", "it cannot be played in response to the opponent ending their turn", () => {
  const game = interfBoard({ extra: [{ key: "ctl", def: drawTactic("Control", 1, 0), owner: P1, zone: "hand" }] });
  game.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond to the end of turn");
  refused(() => playRaw(game.engine, P1, game.id("vi")), "ending the turn is not a card being played");
  assert.equal(zoneOf(game.engine, game.id("vi")), "hand");
  playRaw(game.engine, P1, game.id("ctl"));
  assert.equal(zoneOf(game.engine, game.id("ctl")), "deploying", "control: another tactic can be played in this window");
});

clause(INTERFERENCE, "0:ability", "it cannot be played in response to an attack being declared", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "vi", def: printing(INTERFERENCE), owner: P1, zone: "hand" },
      { key: "ctl", def: drawTactic("Control", 1, 0), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("obsession", 3, P1)
    ]
  });
  openWindowOnP2Attack(game.engine, game.id("atk"));
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond during the attack");
  refused(() => playRaw(game.engine, P1, game.id("vi")), "an attack is not a card being played: its own response condition is unmet", /cannot be deployed right now/);
  assert.equal(zoneOf(game.engine, game.id("vi")), "hand");
  playRaw(game.engine, P1, game.id("ctl"));
  assert.equal(zoneOf(game.engine, game.id("ctl")), "deploying", "control: another tactic can be played in this window");
});

clause(INTERFERENCE, "0:ability", "playing a resource doesn't count: after the opponent plays a resource there is nothing to respond to", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "vi", def: printing(INTERFERENCE), owner: P1, zone: "hand" },
      { key: "res", def: character({ name: "Res" }), owner: P2, zone: "hand" },
      ...bank("obsession", 3, P1)
    ]
  });
  developPlay(game.engine, P2, game.id("res"), true);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("res")), "play", "the resource was played (face-down)");
  refused(() => playRaw(game.engine, P1, game.id("vi")), "a resource being played cannot be responded to with it");
  assert.equal(zoneOf(game.engine, game.id("vi")), "hand");
});

/**
 * Settles the put-on-top choice of a chain test WITHOUT assuming who is asked or which hand is legal (those are asserted by their own tests):
 * whoever is asked puts some card on top of a deck, so the rest of the chain can resolve whether or not the choice is optional.
 */
function settlePutOnTop(engine: SpoilsEngine): void {
  let guard = 0;
  while (pending(engine)?.kind === "chooserSelectsTarget" && guard++ < 5) {
    const asked = pending(engine)!.playerId as Pid;
    const candidates = [...handOf(engine, asked), ...handOf(engine, other(asked))];
    let done = false;
    for (const card of candidates) {
      try {
        pick(engine, [card], asked);
        done = true;
        break;
      } catch {
        /* that card is not a legal choice: try the next one */
      }
    }
    assert.ok(done, "some card could be put on top of a deck");
  }
}

function chainOne() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "vi", def: printing(INTERFERENCE), owner: P1, zone: "hand" },
      { key: "pump", def: pumpTactic(3), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3 }), owner: P1, zone: "play" },
      { key: "x", def: killTactic(), owner: P2, zone: "hand" },
      ...fillers("ph", 2, P2, "hand"),
      ...fillers("mineh", 1, P1, "hand"),
      ...bank("obsession", 3, P1)
    ]
  });
}

function chainOneRun(game: ReturnType<typeof chainOne>): void {
  playRaw(game.engine, P1, game.id("pump"), { selected: { t: [game.id("mine")] } });
  playRaw(game.engine, P2, game.id("x"), { selected: { t: [game.id("mine")] } });
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the opponent's response");
  playRaw(game.engine, P1, game.id("vi"));
  resolvePendingResponses(game.engine);
}

clause(INTERFERENCE, "0:ability", "in a chain it answers the LATEST card played: the opponent's response returns to hand and does nothing, my own earlier tactic still resolves", () => {
  const game = chainOne();
  chainOneRun(game);
  settlePutOnTop(game.engine);
  assert.equal(zoneOf(game.engine, game.id("x")), "hand", "the opponent's tactic (the card responded to) is back in its owner's hand");
  assert.equal(discardOf(game.engine, P2).includes(game.id("x")), false);
  assert.equal(zoneOf(game.engine, game.id("mine")), "play", "the kill tactic did not resolve");
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 4, "my own pump, played earlier in the chain, still resolved");
  assert.equal(zoneOf(game.engine, game.id("pump")), "discard", "and went to the discard pile as normal");
});

clause(INTERFERENCE, "0:ability", "in a chain, the owner of the returned response (the opponent) is the one who puts a card on top of their deck", () => {
  const game = chainOne();
  chainOneRun(game);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the returned card is the opponent's tactic, so the opponent chooses");
  pick(game.engine, [game.id("ph0")], P2);
  assert.equal(deckOf(game.engine, P2)[0], game.id("ph0"));
});

function chainTwo() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" },
      { key: "vi2", def: printing(INTERFERENCE), owner: P2, zone: "hand" },
      { key: "resp", def: pumpTactic(1), owner: P1, zone: "hand" },
      { key: "victim", def: character({ name: "Victim" }), owner: P1, zone: "play" },
      ...fillers("mine", 2, P1, "hand"),
      ...fillers("d", 2, P1, "deck"),
      ...bank("rage", 1, P2),
      ...bank("obsession", 3, P2)
    ]
  });
}

function chainTwoRun(game: ReturnType<typeof chainTwo>): void {
  playRaw(game.engine, P2, game.id("opp"));
  playRaw(game.engine, P1, game.id("resp"), { selected: { t: [game.id("victim")] } });
  playRaw(game.engine, P2, game.id("vi2"));
  resolvePendingResponses(game.engine);
}

clause(INTERFERENCE, "0:ability", "the opponent's Interference answering MY response returns my response to MY hand, and their own earlier character still resolves", () => {
  const game = chainTwo();
  chainTwoRun(game);
  settlePutOnTop(game.engine);
  assert.equal(zoneOf(game.engine, game.id("resp")), "hand", "my response was put into MY hand");
  assert.ok(handOf(game.engine, P1).includes(game.id("resp")), "handOf(game.engine, P1).includes(game.id(\"resp\"))");
  assert.equal(game.engine.getStat(game.id("victim"), "strength"), 1, "my pump did not resolve");
  assert.equal(zoneOf(game.engine, game.id("opp")), "play", "the opponent's own character still resolved");
});

clause(INTERFERENCE, "0:ability", "'its owner' is whoever owns the returned card: when the opponent returns MY response, I put a card of mine on top of MY deck", () => {
  const game = chainTwo();
  chainTwoRun(game);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I am the owner of the returned response, so I choose the card to put on top");
  pick(game.engine, [game.id("mine1")], P1);
  assert.equal(deckOf(game.engine, P1)[0], game.id("mine1"), "a card of my hand is on top of MY deck");
});

// =============================================================================
// Voidal Nullification Chamber
// At the start of your turn, you may put a token on this card.
// ENERGIZE -- COST: Pay 2. EFFECT: Put a token on this card.
// DISSOLVE -- COST: Use this only if there are an even number of characters in play.
// Remove 4 tokens from this card. Pick a character. EFFECT: Destroy the character.
// Location (arcanist), cost 4, threshold [O][O][O], structure 2.
// =============================================================================

const CHAMBER = "488c4135-4d14-46e7-9b5e-f8b9aaf7ce4d";

function chamberBoard(opts: { tokens?: number; obsession?: number; chars?: number; oppChars?: number; extra?: CardPlacement[]; controller?: Pid; zone?: "play" | "hand"; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "nc", def: printing(CHAMBER), owner: P1, zone: opts.zone ?? "play", controller: opts.controller, counters: opts.tokens ? { token: opts.tokens } : undefined },
      ...Array.from({ length: opts.chars ?? 1 }, (_, i) => ({ key: `m${i}`, def: character({ name: `Mine${i}` }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: opts.oppChars ?? 1 }, (_, i) => ({ key: `f${i}`, def: character({ name: `Foe${i}` }), owner: P2, zone: "play" as const })),
      ...bank("obsession", opts.obsession ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type ChamberBoard = ReturnType<typeof chamberBoard>;

/** Starts P1's turn (P2 ends theirs) on a board built with `active: P2`; answers the Chamber's option: "put" a token, or "decline". */
function chamberUpkeep(b: ChamberBoard, answer: "put" | "decline" | "none"): void {
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  if (answer === "none") return;
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption", "you are asked whether to put a token");
  assert.equal(pc?.playerId, P1);
  chooseOption(b.engine, answer === "put" ? /token|put/i : /decline|no|skip/i);
}

clause(CHAMBER, "0:rule", "at the start of your turn you may put a token on it: accepting adds exactly one token", () => {
  const b = chamberBoard({ turn: 2, active: P2, tokens: 1 });
  chamberUpkeep(b, "put");
  assert.equal(tokens(b.engine, b.id("nc")), 2);
  assert.equal(pending(b.engine), undefined);
});

clause(CHAMBER, "0:rule", "'may': declining leaves the tokens alone", () => {
  const b = chamberBoard({ turn: 2, active: P2, tokens: 1 });
  chamberUpkeep(b, "decline");
  assert.equal(tokens(b.engine, b.id("nc")), 1);
  assert.equal(pending(b.engine), undefined);
});

clause(CHAMBER, "0:rule", "it starts with no token and gets its first token from the start-of-turn rule", () => {
  const b = chamberBoard({ turn: 2, active: P2 });
  assert.equal(tokens(b.engine, b.id("nc")), 0);
  chamberUpkeep(b, "put");
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "0:rule", "it triggers at the start of every one of your turns, one token each time", () => {
  const b = chamberBoard({ turn: 2, active: P2 });
  chamberUpkeep(b, "put");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "asked again the next turn");
  chooseOption(b.engine, /token|put/i);
  assert.equal(tokens(b.engine, b.id("nc")), 2);
});

clause(CHAMBER, "0:rule", "only at the start of YOUR turn: nothing happens at the start of the opponent's turn", () => {
  const b = chamberBoard({ tokens: 1 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(pending(b.engine), undefined, "no choice for anyone");
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "0:rule", "'your turn' is the controller's turn: a Chamber controlled by the opponent asks THEM at the start of their turn", () => {
  const b = chamberBoard({ turn: 2, active: P1, controller: P2 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P2, "its controller");
  chooseOption(b.engine, /token|put/i);
  assert.equal(tokens(b.engine, b.id("nc")), 1);
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine), undefined, "not asked at the start of its owner's own turn");
});

clause(CHAMBER, "0:rule", "a Chamber in your hand does not trigger", () => {
  const b = chamberBoard({ turn: 2, active: P2, zone: "hand" });
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine), undefined);
});

clause(CHAMBER, "0:rule", "the Chamber itself is a location with structure 2 that deploys for 4 with [O][O][O]", () => {
  const board = (obsession: number, greed: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "nc", def: printing(CHAMBER), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("greed", greed, P1)]
    });
  const ok = board(4, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("nc"));
  assert.equal(zoneOf(ok.engine, ok.id("nc")), "play");
  assert.equal(before - ready(ok.engine), 4);
  assert.equal(ok.engine.getStat(ok.id("nc"), "structure"), 2);
  const short = board(3, 0);
  refused(() => playRaw(short.engine, P1, short.id("nc")), "short of 4");
  const noIcons = board(2, 6);
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("nc")), "two [O] are not [O][O][O]");
  const mixed = board(3, 1);
  play(mixed.engine, P1, mixed.id("nc"));
  assert.equal(zoneOf(mixed.engine, mixed.id("nc")), "play");
});

clause(CHAMBER, "0:rule", "it is destroyed by 2 damage (structure 2), not by 1", () => {
  const raze = (amount: number) =>
    tactic({
      name: `Raze${amount}`,
      cost: 0,
      behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
    });
  const one = chamberBoard({ tokens: 3, extra: [{ key: "raze", def: raze(1), owner: P1, zone: "hand" }] });
  play(one.engine, P1, one.id("raze"), { selected: { t: [one.id("nc")] } });
  assert.equal(zoneOf(one.engine, one.id("nc")), "play", "1 damage does not destroy structure 2");
  const two = chamberBoard({ tokens: 3, extra: [{ key: "raze", def: raze(2), owner: P1, zone: "hand" }] });
  play(two.engine, P1, two.id("raze"), { selected: { t: [two.id("nc")] } });
  assert.equal(zoneOf(two.engine, two.id("nc")), "discard");
});

clause(CHAMBER, "0:rule", "tokens disappear when the Chamber leaves play (CR 409.2): a Chamber that went to hand and was replayed has no tokens", () => {
  const bounceLoc = tactic({
    name: "BounceLoc",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const b = chamberBoard({ tokens: 3, extra: [{ key: "bounce", def: bounceLoc, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("nc")] } });
  assert.equal(zoneOf(b.engine, b.id("nc")), "hand");
  assert.equal(tokens(b.engine, b.id("nc")), 0, "its tokens disappeared when it left play");
  play(b.engine, P1, b.id("nc"));
  assert.equal(zoneOf(b.engine, b.id("nc")), "play");
  assert.equal(tokens(b.engine, b.id("nc")), 0, "the new Chamber starts with no tokens");
});

// ENERGIZE

clause(CHAMBER, "1:ability:energize", "pays exactly 2 and puts exactly one token on the Chamber", () => {
  const b = chamberBoard();
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("nc"), "energize");
  assert.equal(before - ready(b.engine), 2, "ENERGIZE costs 2");
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "1:ability:energize", "can be used any number of times: it does not deplete (three uses: 6 resources, 3 tokens)", () => {
  const b = chamberBoard({ obsession: 6 });
  for (let i = 1; i <= 3; i++) {
    activate(b.engine, P1, b.id("nc"), "energize");
    assert.equal(tokens(b.engine, b.id("nc")), i);
  }
  assert.equal(ready(b.engine), 0);
  assert.equal(isDepleted(b.engine, b.id("nc")), false, "a location is not depleted by it");
});

clause(CHAMBER, "1:ability:energize", "is refused one resource short of 2 (nothing is spent), allowed with exactly 2", () => {
  const b = chamberBoard({ obsession: 1 });
  refused(() => activate(b.engine, P1, b.id("nc"), "energize"), "1 resource for a cost of 2");
  assert.equal(tokens(b.engine, b.id("nc")), 0);
  assert.equal(ready(b.engine), 1, "nothing was spent");
  const exact = chamberBoard({ obsession: 2 });
  activate(exact.engine, P1, exact.id("nc"), "energize");
  assert.equal(tokens(exact.engine, exact.id("nc")), 1);
});

clause(CHAMBER, "1:ability:energize", "any resources pay for it (it has no threshold of its own)", () => {
  const b = chamberBoard({ obsession: 0, extra: bank("greed", 2, P1) });
  activate(b.engine, P1, b.id("nc"), "energize");
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "1:ability:energize", "the cost is paid when it is used and the token arrives when it resolves, after the opponent may respond", () => {
  const b = chamberBoard();
  const before = ready(b.engine);
  activateRaw(b.engine, P1, b.id("nc"), "energize");
  assert.equal(before - ready(b.engine), 2);
  assert.equal(tokens(b.engine, b.id("nc")), 0, "not yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  resolvePendingResponses(b.engine);
  assert.equal(tokens(b.engine, b.id("nc")), 1);
});

clause(CHAMBER, "1:ability:energize", "only its controller can use it, and it can be used in response on the opponent's turn", () => {
  const b = chamberBoard({ extra: bank("obsession", 4, P2), turn: 2, active: P2 });
  refused(() => activate(b.engine, P2, b.id("nc"), "energize"), "the opponent cannot use my Chamber");
  declareAttackOpenWindow(b.engine, P2, [b.id("f0")], { type: "faction", playerId: P1 });
  activate(b.engine, P1, b.id("nc"), "energize");
  assert.equal(tokens(b.engine, b.id("nc")), 1, "usable in response to the opponent's attack");
});

clause(CHAMBER, "1:ability:energize", "a Chamber in hand cannot be energized", () => {
  const b = chamberBoard({ zone: "hand" });
  refused(() => activate(b.engine, P1, b.id("nc"), "energize"), "not in play");
  assert.equal(ready(b.engine), 6);
});

// DISSOLVE

const dissolve = (b: ChamberBoard, target: string) => activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [b.id(target)] } });
const dissolveRaw = (b: ChamberBoard, target: string) => activateRaw(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [b.id(target)] } });

clause(CHAMBER, "2:ability:dissolve", "with an even number of characters in play and 4 tokens: removes the 4 tokens and destroys the picked character", () => {
  const b = chamberBoard({ tokens: 4, chars: 1, oppChars: 1 });
  dissolve(b, "f0");
  assert.equal(tokens(b.engine, b.id("nc")), 0, "4 tokens removed");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard", "the character is destroyed");
  assert.equal(discardOf(b.engine, P2).includes(b.id("f0")), true, "into its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("m0")), "play", "no other character is affected");
  assert.equal(zoneOf(b.engine, b.id("nc")), "play", "the Chamber stays");
});

clause(CHAMBER, "2:ability:dissolve", "removes exactly 4 tokens: with 6 tokens, 2 are left; one of your own characters can be picked too", () => {
  const b = chamberBoard({ tokens: 6 });
  dissolve(b, "m0");
  assert.equal(tokens(b.engine, b.id("nc")), 2);
  assert.equal(zoneOf(b.engine, b.id("m0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("f0")), "play");
});

clause(CHAMBER, "2:ability:dissolve", "is refused with fewer than 4 tokens (3 tokens, 0 tokens): nothing is removed or destroyed", () => {
  const b = chamberBoard({ tokens: 3 });
  refused(() => dissolve(b, "f0"), "3 tokens");
  assert.equal(tokens(b.engine, b.id("nc")), 3);
  assert.equal(zoneOf(b.engine, b.id("f0")), "play");
  const none = chamberBoard({ tokens: 0 });
  refused(() => dissolve(none, "f0"), "0 tokens");
  assert.equal(zoneOf(none.engine, none.id("f0")), "play");
});

for (const [mine, theirs, legal] of [
  [1, 1, true],
  [2, 2, true],
  [3, 1, true],
  [2, 1, false],
  [1, 2, false],
  [3, 2, false],
  [1, 0, false],
  [0, 1, false]
] as const) {
  clause(CHAMBER, "2:ability:dissolve", `${mine} of your and ${theirs} of their characters in play (${mine + theirs} in total): ${legal ? "usable (even)" : "refused (odd)"}`, () => {
    const b = chamberBoard({ tokens: 4, chars: mine, oppChars: theirs });
    const target = theirs > 0 ? "f0" : "m0";
    if (legal) {
      dissolve(b, target);
      assert.equal(zoneOf(b.engine, b.id(target)), "discard");
      assert.equal(tokens(b.engine, b.id("nc")), 0);
    } else {
      refused(() => dissolve(b, target), "an odd number of characters");
      assert.equal(tokens(b.engine, b.id("nc")), 4, "no tokens removed");
      assert.equal(zoneOf(b.engine, b.id(target)), "play");
    }
  });
}

clause(CHAMBER, "2:ability:dissolve", "an even count of ZERO characters is even, but with none in play there is nothing to pick: refused, tokens kept", () => {
  const b = chamberBoard({ tokens: 4, chars: 0, oppChars: 0 });
  refused(() => activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [] } }), "no character to pick");
  assert.equal(tokens(b.engine, b.id("nc")), 4);
});

clause(CHAMBER, "2:ability:dissolve", "only CHARACTERS count towards 'an even number of characters': items, locations and face-down cards do not", () => {
  const b = chamberBoard({
    tokens: 4,
    chars: 1,
    oppChars: 2,
    extra: [
      { key: "i1", def: item({ name: "Widget" }), owner: P1, zone: "play" },
      { key: "l1", def: location({ name: "Hall" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  refused(() => dissolve(b, "f0"), "3 characters (the item, the location, the face-down card and the Chamber do not count): odd");
  const even = chamberBoard({
    tokens: 4,
    chars: 1,
    oppChars: 1,
    extra: [
      { key: "i1", def: item({ name: "Widget" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "fd2", def: character({ name: "Hidden2" }), owner: P2, zone: "play", faceDown: true },
      { key: "fd3", def: character({ name: "Hidden3" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  dissolve(even, "f0");
  assert.equal(zoneOf(even.engine, even.id("f0")), "discard", "2 characters: even, whatever else is on the table");
});

clause(CHAMBER, "2:ability:dissolve", "characters in hands, decks and discard piles do not count", () => {
  const b = chamberBoard({
    tokens: 4,
    chars: 1,
    oppChars: 2,
    extra: [
      { key: "h", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "d", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
      { key: "x", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
    ]
  });
  refused(() => dissolve(b, "f0"), "only the 3 in play count (odd) even though 6 exist");
  const even = chamberBoard({ tokens: 4, chars: 1, oppChars: 1, extra: [{ key: "h", def: character({ name: "InHand" }), owner: P1, zone: "hand" }] });
  dissolve(even, "f0");
  assert.equal(zoneOf(even.engine, even.id("f0")), "discard");
});

clause(CHAMBER, "2:ability:dissolve", "the pick must be a character in play: items, locations, factions, face-down cards, and cards in hand or discard are refused; one character exactly", () => {
  const b = chamberBoard({
    tokens: 4,
    chars: 1,
    oppChars: 1,
    extra: [
      { key: "i1", def: item({ name: "Widget" }), owner: P2, zone: "play" },
      { key: "l1", def: location({ name: "Hall" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "h", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "x", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
    ]
  });
  const attempt = (cardId: CardInstanceId) => () => activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [cardId] } });
  refused(attempt(b.id("i1")), "an item");
  refused(attempt(b.id("l1")), "a location");
  refused(attempt(b.id("nc")), "the Chamber itself is a location");
  refused(attempt(factionOf(b.engine, P2)), "a faction");
  refused(attempt(b.id("fd")), "a face-down card");
  refused(attempt(b.id("h")), "a card in hand");
  refused(attempt(b.id("x")), "a card in a discard pile");
  refused(() => activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [] } }), "a pick is required");
  refused(() => activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [b.id("m0"), b.id("f0")] } }), "only one character");
  assert.equal(tokens(b.engine, b.id("nc")), 4, "nothing was paid by the refused attempts");
  attempt(b.id("f0"))();
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard");
});

clause(CHAMBER, "2:ability:dissolve", "a character you control but do not own is destroyed into its OWNER's discard pile", () => {
  const b = chamberBoard({ tokens: 4, chars: 0, oppChars: 0, extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }, { key: "other", def: character({ name: "Other" }), owner: P2, zone: "play" }] });
  activate(b.engine, P1, b.id("nc"), "dissolve", { selected: { c: [b.id("stolen")] } });
  assert.equal(discardOf(b.engine, P2).includes(b.id("stolen")), true);
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(CHAMBER, "2:ability:dissolve", "the tokens are removed as a COST when it is used: they are gone before the opponent can respond, the character dies at resolution", () => {
  const b = chamberBoard({ tokens: 4 });
  dissolveRaw(b, "f0");
  assert.equal(tokens(b.engine, b.id("nc")), 0, "tokens removed at once");
  assert.equal(zoneOf(b.engine, b.id("f0")), "play", "not destroyed yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard");
});

clause(CHAMBER, "2:ability:dissolve", "'use this only if' is a cost-time restriction: if the number of characters turns odd in response, the effect still destroys the character", () => {
  const b = chamberBoard({ tokens: 4, chars: 1, oppChars: 1, turn: 2, active: P1, extra: [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }] });
  dissolveRaw(b, "f0");
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("m0")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("m0")), "hand", "the response made the number of characters odd");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard", "DISSOLVE still destroys its picked character");
});

clause(CHAMBER, "2:ability:dissolve", "needs no resources (its cost is only tokens); only its controller can use it; a Chamber in hand cannot", () => {
  const b = chamberBoard({ tokens: 4, obsession: 0, extra: bank("obsession", 3, P2) });
  refused(() => activate(b.engine, P2, b.id("nc"), "dissolve", { selected: { c: [b.id("f0")] } }), "the opponent cannot");
  assert.equal(tokens(b.engine, b.id("nc")), 4);
  dissolve(b, "f0");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard", "with 0 resources");
  const inHand = chamberBoard({ tokens: 4, zone: "hand" });
  refused(() => dissolve(inHand, "f0"), "not in play");
});

clause(CHAMBER, "2:ability:dissolve", "ENERGIZE and DISSOLVE work together: four ENERGIZEs (8 resources) then DISSOLVE", () => {
  const b = chamberBoard({ obsession: 8 });
  for (let i = 0; i < 4; i++) activate(b.engine, P1, b.id("nc"), "energize");
  assert.equal(tokens(b.engine, b.id("nc")), 4);
  dissolve(b, "f0");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard");
  assert.equal(tokens(b.engine, b.id("nc")), 0);
});

clause(CHAMBER, "2:ability:dissolve", "it can be used in response on the opponent's turn (abilities may be used in response)", () => {
  const b = chamberBoard({ tokens: 4, chars: 1, oppChars: 1, turn: 2, active: P2 });
  refused(() => dissolve(b, "f0"), "nothing to respond to on the opponent's quiet turn");
  declareAttackOpenWindow(b.engine, P2, [b.id("f0")], { type: "faction", playerId: P1 });
  dissolve(b, "f0");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard");
});

// =============================================================================
// Voidal Poisoning
// You may remove any number of tokens from cards you control. Use the tokens to
// generate the following effects any number of times:
// 1 TOKEN - Pick a character. Inflict 1 damage to it.
// 2 TOKENS - Draw a card.
// 2 TOKENS - Your opponent discards a card.
// 3 TOKENS - Search your deck for a card and put it into your hand.
// Tactic (arcanist), cost 3, threshold [O][O][O].
// =============================================================================

const POISONING = "19153f74-edc7-4fdf-bce9-925f4ec5cdff";

function poisoningBoard(opts: { tokens?: Record<string, number>; deck?: number; oppHand?: number; obsession?: number; greed?: number; extra?: CardPlacement[]; random?: () => number } = {}) {
  const t = opts.tokens ?? {};
  const counters = (key: string) => (t[key] ? { token: t[key] } : undefined);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "poi", def: printing(POISONING), owner: P1, zone: "hand" },
      { key: "k1", def: character({ name: "K1", life: 5 }), owner: P1, zone: "play", counters: counters("k1") },
      { key: "k2", def: character({ name: "K2", life: 5 }), owner: P1, zone: "play", counters: counters("k2") },
      { key: "i1", def: item({ name: "I1" }), owner: P1, zone: "play", counters: counters("i1") },
      { key: "l1", def: location({ name: "L1", structure: 5 }), owner: P1, zone: "play", counters: counters("l1") },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play", counters: counters("foe") },
      { key: "weak", def: character({ name: "Weak", life: 1 }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play", counters: counters("foeItem") },
      { key: "stolen", def: character({ name: "Stolen", life: 5 }), owner: P2, zone: "play", controller: P1, counters: counters("stolen") },
      { key: "lent", def: character({ name: "Lent", life: 5 }), owner: P1, zone: "play", controller: P2, counters: counters("lent") },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      ...Array.from({ length: opts.deck ?? 5 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...Array.from({ length: opts.oppHand ?? 3 }, (_, i) => ({ key: `o:Opp${i}`, def: character({ name: `Opp${i}`, cost: 1 }), owner: P2, zone: "hand" as const })),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type PoisonBoard = ReturnType<typeof poisoningBoard>;
type Menu = { kind: string; playerId: string; options: Array<{ cost: number; label?: string }>; available: Record<string, number> };
const menuOf = (engine: SpoilsEngine) => {
  const pc = pending(engine) as unknown as Menu | undefined;
  assert.equal(pc?.kind, "spendCountersMenu", "the token menu is open");
  return pc!;
};
const DAMAGE = /damage/i;
const DRAW = /draw/i;
const DISCARD = /discard/i;
const SEARCH = /search/i;
const optionFor = (engine: SpoilsEngine, label: RegExp, cost: number) => {
  const menu = menuOf(engine);
  const index = menu.options.findIndex((o) => label.test(o.label ?? ""));
  assert.ok(index >= 0, `an option labelled ${label}`);
  assert.equal(menu.options[index].cost, cost, `${label} costs ${cost} token(s)`);
  return index;
};
const spend = (b: PoisonBoard, label: RegExp, cost: number, sources: string[]) =>
  answerPending(b.engine, "spendCountersMenu", { optionIndex: optionFor(b.engine, label, cost), sources: sources.map(b.id) });
const spendRaw = (b: PoisonBoard, optionIndex: number | null, sources: string[], player: Pid = P1) =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "spendCountersMenu", optionIndex, sources: sources.map(b.id) } } as never);
const stopMenu = (b: PoisonBoard) => answerPending(b.engine, "spendCountersMenu", { optionIndex: null });
const castPoisoning = (b: PoisonBoard) => play(b.engine, P1, b.id("poi"));

// --- 0:rule: removing the tokens

clause(POISONING, "0:rule", "the card itself: a tactic costing 3 with [O][O][O]: exactly 3 with three [O] works and pays 3; one short or only two [O] is refused", () => {
  const exact = poisoningBoard({ tokens: { k1: 3 }, obsession: 3 });
  const before = ready(exact.engine);
  castPoisoning(exact);
  assert.equal(before - ready(exact.engine), 3, "the printed cost of 3 is paid");
  assert.equal(menuOf(exact.engine).kind, "spendCountersMenu");
  const short = poisoningBoard({ tokens: { k1: 3 }, obsession: 2 });
  refused(() => playRaw(short.engine, P1, short.id("poi")), "2 resources for a cost of 3");
  assert.equal(tokens(short.engine, short.id("k1")), 3);
  assert.equal(zoneOf(short.engine, short.id("poi")), "hand");
  const noIcons = poisoningBoard({ tokens: { k1: 3 }, obsession: 2, greed: 5 });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("poi")), "only two [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("poi")), "hand");
});

clause(POISONING, "0:rule", "'You MAY remove': stopping at once removes no token and does nothing; the tactic still ends in the discard pile", () => {
  const b = poisoningBoard({ tokens: { k1: 3 } });
  const handBefore = handOf(b.engine, P1).length;
  castPoisoning(b);
  menuOf(b.engine);
  stopMenu(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(tokens(b.engine, b.id("k1")), 3, "no token removed");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "nothing drawn");
  assert.equal(zoneOf(b.engine, b.id("poi")), "discard");
});

clause(POISONING, "0:rule", "the token menu offers exactly the four printed effects at their printed token costs: 1, 2, 2 and 3", () => {
  const b = poisoningBoard({ tokens: { k1: 3 } });
  castPoisoning(b);
  const menu = menuOf(b.engine);
  assert.equal(menu.playerId, P1, "you decide how to use the tokens");
  assert.deepEqual(menu.options.map((o) => o.cost), [1, 2, 2, 3]);
  optionFor(b.engine, DAMAGE, 1);
  optionFor(b.engine, DRAW, 2);
  optionFor(b.engine, DISCARD, 2);
  optionFor(b.engine, SEARCH, 3);
});

clause(POISONING, "0:rule", "tokens may be taken from SEVERAL cards you control (a character, an item, a location): each source loses exactly the tokens named", () => {
  const b = poisoningBoard({ tokens: { k1: 1, i1: 1, l1: 1 } });
  castPoisoning(b);
  spend(b, SEARCH, 3, ["k1", "i1", "l1"]);
  pick(b.engine, [b.id("d2")]);
  for (const key of ["k1", "i1", "l1"]) assert.equal(tokens(b.engine, b.id(key)), 0, `${key} lost its token`);
  assert.equal(zoneOf(b.engine, b.id("d2")), "hand");
});

clause(POISONING, "0:rule", "you choose WHICH cards the tokens come from: 2 of 3 tokens from one card, the rest stay where they were", () => {
  const b = poisoningBoard({ tokens: { k1: 3, k2: 2 } });
  castPoisoning(b);
  spend(b, DRAW, 2, ["k2", "k2"]);
  assert.equal(tokens(b.engine, b.id("k2")), 0);
  assert.equal(tokens(b.engine, b.id("k1")), 3, "the other card keeps all its tokens");
  assert.equal(zoneOf(b.engine, b.id("d0")), "hand");
});

clause(POISONING, "0:rule", "tokens come only from cards YOU control: a card you control but do not own is available, the opponent's cards and a card of yours the opponent controls are not", () => {
  const b = poisoningBoard({ tokens: { foe: 2, foeItem: 2, stolen: 1, lent: 2, k1: 1 } });
  castPoisoning(b);
  const menu = menuOf(b.engine);
  assert.equal(menu.available[b.id("k1")], 1);
  assert.equal(menu.available[b.id("stolen")], 1, "a card you control (though the opponent owns it)");
  assert.equal(menu.available[b.id("foe")], undefined, "the opponent's character");
  assert.equal(menu.available[b.id("foeItem")], undefined, "the opponent's item");
  assert.equal(menu.available[b.id("lent")], undefined, "a card the opponent controls (though you own it)");
  const draw = optionFor(b.engine, DRAW, 2);
  refused(() => spendRaw(b, draw, ["foe", "foe"]), "cannot take tokens from the opponent's card");
  refused(() => spendRaw(b, draw, ["lent", "lent"]), "nor from a card the opponent controls");
  assert.equal(tokens(b.engine, b.id("foe")), 2);
  spend(b, DRAW, 2, ["stolen", "k1"]);
  assert.equal(tokens(b.engine, b.id("stolen")), 0);
  assert.equal(tokens(b.engine, b.id("k1")), 0);
});

clause(POISONING, "0:rule", "you cannot name more tokens than a card has, nor the wrong number of tokens for an effect", () => {
  const b = poisoningBoard({ tokens: { k1: 1, k2: 5 } });
  castPoisoning(b);
  const draw = optionFor(b.engine, DRAW, 2);
  refused(() => spendRaw(b, draw, ["k1", "k1"]), "k1 has only one token");
  refused(() => spendRaw(b, draw, ["k2"]), "'2 TOKENS' needs two tokens, not one");
  refused(() => spendRaw(b, draw, ["k2", "k2", "k2"]), "nor three");
  refused(() => spendRaw(b, draw, []), "nor none");
  refused(() => spendRaw(b, 9, []), "no such effect");
  assert.equal(tokens(b.engine, b.id("k1")), 1);
  assert.equal(tokens(b.engine, b.id("k2")), 5, "refused answers remove nothing");
  assert.equal(menuOf(b.engine).kind, "spendCountersMenu", "the menu is still open");
});

clause(POISONING, "0:rule", "'any number of times', in any combination: 6 tokens pay for 1 + 1 + 2 + 2 (two damage, a draw and a discard); every effect happens, in the order chosen", () => {
  const b = poisoningBoard({ tokens: { k1: 6 } });
  const handBefore = handOf(b.engine, P1).length;
  castPoisoning(b);
  spend(b, DAMAGE, 1, ["k1"]);
  pick(b.engine, [b.id("foe")], P1);
  spend(b, DAMAGE, 1, ["k1"]);
  pick(b.engine, [b.id("weak")], P1);
  spend(b, DRAW, 2, ["k1", "k1"]);
  spend(b, DISCARD, 2, ["k1", "k1"]);
  assert.equal(pending(b.engine)?.playerId, P2, "the opponent discards");
  pick(b.engine, [b.id("o:Opp0")], P2);
  assert.equal(pending(b.engine), undefined, "no tokens left: the menu closes by itself");
  assert.equal(tokens(b.engine, b.id("k1")), 0);
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 1);
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard", "1 damage destroys the 1-life character");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 1, "tactic out, one card drawn");
  assert.equal(zoneOf(b.engine, b.id("o:Opp0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("poi")), "discard");
});

clause(POISONING, "0:rule", "the same effect can be created several times: 6 tokens make three draws", () => {
  const b = poisoningBoard({ tokens: { k1: 6 } });
  const handBefore = handOf(b.engine, P1).length;
  castPoisoning(b);
  for (let n = 0; n < 3; n++) spend(b, DRAW, 2, ["k1", "k1"]);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 3);
  assert.equal(tokens(b.engine, b.id("k1")), 0);
  assert.equal(pending(b.engine), undefined);
});

clause(POISONING, "0:rule", "the whole menu can be combined: 8 tokens pay for 1 + 2 + 2 + 3 (damage, draw, discard and search)", () => {
  const b = poisoningBoard({ tokens: { k1: 4, k2: 4 } });
  castPoisoning(b);
  spend(b, DAMAGE, 1, ["k1"]);
  pick(b.engine, [b.id("foe")], P1);
  spend(b, DRAW, 2, ["k1", "k1"]);
  spend(b, DISCARD, 2, ["k1", "k2"]);
  pick(b.engine, [b.id("o:Opp2")], P2);
  spend(b, SEARCH, 3, ["k2", "k2", "k2"]);
  pick(b.engine, [b.id("d4")], P1);
  assert.equal(tokens(b.engine, b.id("k1")), 0);
  assert.equal(tokens(b.engine, b.id("k2")), 0);
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 1);
  assert.equal(zoneOf(b.engine, b.id("o:Opp2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("d4")), "hand");
  assert.equal(pending(b.engine), undefined);
});

clause(POISONING, "0:rule", "tokens you do not use stay on their cards, and the menu stays open while an effect is still affordable", () => {
  const b = poisoningBoard({ tokens: { k1: 5 } });
  castPoisoning(b);
  spend(b, DRAW, 2, ["k1", "k1"]);
  assert.equal(tokens(b.engine, b.id("k1")), 3);
  menuOf(b.engine);
  stopMenu(b);
  assert.equal(tokens(b.engine, b.id("k1")), 3, "the unused tokens remain");
  assert.equal(pending(b.engine), undefined);
});

clause(POISONING, "0:rule", "with no tokens on any card you control nothing happens, but the tactic can still be played and ends in the discard pile", () => {
  const b = poisoningBoard({ tokens: { foe: 4 } });
  const handBefore = handOf(b.engine, P1).length;
  castPoisoning(b);
  assert.equal(pending(b.engine), undefined, "nothing to spend");
  assert.equal(zoneOf(b.engine, b.id("poi")), "discard");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1);
  assert.equal(tokens(b.engine, b.id("foe")), 4, "the opponent's tokens are untouched");
});

clause(POISONING, "0:rule", "the menu offers a token source only while it has tokens, and an effect is offered only while enough tokens remain", () => {
  const b = poisoningBoard({ tokens: { k1: 1 } });
  castPoisoning(b);
  const menu = menuOf(b.engine);
  assert.equal(menu.available[b.id("k1")], 1);
  const search = menu.options.findIndex((o) => SEARCH.test(o.label ?? ""));
  refused(() => spendRaw(b, search, ["k1"]), "3 tokens are needed for the search");
  spend(b, DAMAGE, 1, ["k1"]);
  pick(b.engine, [b.id("foe")], P1);
  assert.equal(pending(b.engine), undefined, "the only token was used");
});

// --- 1:rule: 1 TOKEN - Pick a character. Inflict 1 damage to it.

for (const [key, who] of [
  ["foe", "an opponent's character"],
  ["k1", "your own character"],
  ["stolen", "a character you control but do not own"]
] as const) {
  clause(POISONING, "1:rule", `1 TOKEN: picks ${who} and inflicts exactly 1 damage to it (nothing else is damaged)`, () => {
    const b = poisoningBoard({ tokens: { k1: 1 } });
    castPoisoning(b);
    spend(b, DAMAGE, 1, ["k1"]);
    const pc = pending(b.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "you pick");
    pick(b.engine, [b.id(key)], P1);
    assert.equal(b.engine.state.cards[b.id(key)].damage, 1);
    for (const rest of ["k1", "k2", "foe", "weak", "stolen", "lent"]) {
      if (rest !== key) assert.equal(b.engine.state.cards[b.id(rest)].damage ?? 0, 0, `${rest} undamaged`);
    }
    assert.equal(tokens(b.engine, b.id("k1")), 0, "1 token spent");
  });
}

clause(POISONING, "1:rule", "1 token inflicts only 1 damage: a 1-life character is destroyed, a 5-life one survives with 1 damage; two uses on one character make 2", () => {
  const b = poisoningBoard({ tokens: { k1: 3 } });
  castPoisoning(b);
  spend(b, DAMAGE, 1, ["k1"]);
  pick(b.engine, [b.id("weak")], P1);
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
  spend(b, DAMAGE, 1, ["k1"]);
  pick(b.engine, [b.id("foe")], P1);
  spend(b, DAMAGE, 1, ["k1"]);
  pick(b.engine, [b.id("foe")], P1);
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 2);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(POISONING, "1:rule", "only a CHARACTER can be picked: an item, a location, a faction, a resource, a face-down card, or a card outside play are refused", () => {
  const b = poisoningBoard({ tokens: { k1: 1 }, extra: [{ key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }] });
  const resourceId = b.engine.state.players[P1].play.find((c) => b.engine.getDefinition(c).type === "resource")!;
  castPoisoning(b);
  spend(b, DAMAGE, 1, ["k1"]);
  refused(() => pickRaw(b.engine, [b.id("i1")], P1), "an item");
  refused(() => pickRaw(b.engine, [b.id("l1")], P1), "a location");
  refused(() => pickRaw(b.engine, [factionOf(b.engine, P2)], P1), "the opponent's faction");
  refused(() => pickRaw(b.engine, [factionOf(b.engine, P1)], P1), "your faction");
  refused(() => pickRaw(b.engine, [resourceId], P1), "a resource");
  refused(() => pickRaw(b.engine, [b.id("fd")], P1), "a face-down card");
  refused(() => pickRaw(b.engine, [b.id("handChar")], P1), "a character in hand");
  refused(() => pickRaw(b.engine, [b.id("discChar")], P1), "a character in the discard pile");
  refused(() => pickRaw(b.engine, [b.id("foe"), b.id("weak")], P1), "only one character");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
  pickRaw(b.engine, [b.id("foe")], P1);
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 1);
});

// --- 2:rule: 2 TOKENS - Draw a card.

clause(POISONING, "2:rule", "2 TOKENS: you draw exactly one card, the top card of your deck; the opponent does not", () => {
  const b = poisoningBoard({ tokens: { k1: 2 } });
  const top = deckOf(b.engine, P1)[0];
  const handBefore = handOf(b.engine, P1).length;
  const oppHand = handOf(b.engine, P2).length;
  castPoisoning(b);
  spend(b, DRAW, 2, ["k1", "k1"]);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 1);
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(deckOf(b.engine, P1).length, 4);
  assert.equal(handOf(b.engine, P2).length, oppHand);
  assert.equal(tokens(b.engine, b.id("k1")), 0, "2 tokens spent");
});

clause(POISONING, "2:rule", "2 TOKENS: with an empty deck the tokens are spent and you simply fail to draw (CR 306.2)", () => {
  const b = poisoningBoard({ tokens: { k1: 2 }, deck: 0 });
  const handBefore = handOf(b.engine, P1).length;
  castPoisoning(b);
  spend(b, DRAW, 2, ["k1", "k1"]);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1);
  assert.equal(b.engine.state.result ?? null, null);
  assert.equal(tokens(b.engine, b.id("k1")), 0);
});

// --- 3:rule: 2 TOKENS - Your opponent discards a card.

clause(POISONING, "3:rule", "2 TOKENS: the OPPONENT chooses a card from their hand and discards it into their discard pile; nothing else is discarded", () => {
  const b = poisoningBoard({ tokens: { k1: 2 } });
  const myHand = [...handOf(b.engine, P1)];
  castPoisoning(b);
  spend(b, DISCARD, 2, ["k1", "k1"]);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses what to discard");
  pick(b.engine, [b.id("o:Opp1")], P2);
  assert.equal(zoneOf(b.engine, b.id("o:Opp1")), "discard");
  assert.equal(discardOf(b.engine, P2).includes(b.id("o:Opp1")), true);
  for (const key of ["o:Opp0", "o:Opp2"]) assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} stays in hand`);
  assert.deepEqual(sorted(handOf(b.engine, P1).filter((c) => c !== b.id("poi"))), sorted(myHand.filter((c) => c !== b.id("poi"))), "your own hand is untouched");
  assert.equal(tokens(b.engine, b.id("k1")), 0, "2 tokens spent");
});

clause(POISONING, "3:rule", "'discards a card' is mandatory: the opponent cannot decline, cannot discard a card that is not in their hand, and discards exactly one", () => {
  const b = poisoningBoard({ tokens: { k1: 2 } });
  castPoisoning(b);
  spend(b, DISCARD, 2, ["k1", "k1"]);
  refused(() => pickRaw(b.engine, [], P2), "picking nothing is refused");
  refused(() => pickRaw(b.engine, [b.id("handChar")], P2), "your card");
  refused(() => pickRaw(b.engine, [b.id("o:Opp0"), b.id("o:Opp1")], P2), "only one card");
  assert.equal(handOf(b.engine, P2).length, 3, "nothing was discarded");
  pick(b.engine, [b.id("o:Opp0")], P2);
  assert.equal(zoneOf(b.engine, b.id("o:Opp0")), "discard");
});

clause(POISONING, "3:rule", "used twice (4 tokens): the opponent discards two cards, each chosen by them, one per use", () => {
  const b = poisoningBoard({ tokens: { k1: 4 } });
  castPoisoning(b);
  spend(b, DISCARD, 2, ["k1", "k1"]);
  assert.equal(pending(b.engine)?.playerId, P2);
  pick(b.engine, [b.id("o:Opp2")], P2);
  assert.equal(handOf(b.engine, P2).length, 2, "one discarded so far");
  spend(b, DISCARD, 2, ["k1", "k1"]);
  assert.equal(pending(b.engine)?.playerId, P2);
  pick(b.engine, [b.id("o:Opp0")], P2);
  assert.deepEqual(handOf(b.engine, P2), [b.id("o:Opp1")], "two discarded, one left");
  assert.equal(tokens(b.engine, b.id("k1")), 0);
});

clause(POISONING, "3:rule", "2 TOKENS: an opponent with an empty hand discards nothing (the tokens are spent)", () => {
  const b = poisoningBoard({ tokens: { k1: 2 }, oppHand: 0 });
  castPoisoning(b);
  spend(b, DISCARD, 2, ["k1", "k1"]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(discardOf(b.engine, P2).length, 0);
  assert.equal(tokens(b.engine, b.id("k1")), 0);
});

// --- 4:rule: 3 TOKENS - Search your deck for a card and put it into your hand.

clause(POISONING, "4:rule", "3 TOKENS: search your deck for ANY card and put it into your hand; the rest of the deck stays", () => {
  for (const found of ["d0", "d2", "d4"]) {
    const b = poisoningBoard({ tokens: { k1: 3 } });
    const deckBefore = [...deckOf(b.engine, P1)];
    castPoisoning(b);
    spend(b, SEARCH, 3, ["k1", "k1", "k1"]);
    const pc = pending(b.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "you search");
    pick(b.engine, [b.id(found)], P1);
    assert.equal(zoneOf(b.engine, b.id(found)), "hand", `${found} found`);
    assert.deepEqual(sorted(deckOf(b.engine, P1)), sorted(deckBefore.filter((c) => c !== b.id(found))), "the rest of the deck is the same cards");
    assert.equal(tokens(b.engine, b.id("k1")), 0, "3 tokens spent");
  }
});

clause(POISONING, "4:rule", "'a card' means any card type: a tactic, an item, a location and a resource card in the deck can each be found", () => {
  const types: Array<[string, Def]> = [
    ["tactic", tactic({ name: "DeckTactic" })],
    ["item", item({ name: "DeckItem" })],
    ["location", location({ name: "DeckLocation" })],
    ["resource", resourceCard({ name: "DeckStaple" })]
  ];
  for (const [what, def] of types) {
    const b = poisoningBoard({ tokens: { k1: 3 }, extra: [{ key: "special", def, owner: P1, zone: "deck" }] });
    castPoisoning(b);
    spend(b, SEARCH, 3, ["k1", "k1", "k1"]);
    pick(b.engine, [b.id("special")], P1);
    assert.equal(zoneOf(b.engine, b.id("special")), "hand", `the ${what} was found`);
  }
});

clause(POISONING, "4:rule", "the search only finds cards of YOUR deck: the opponent's deck, your hand, your discard pile and cards in play are refused; exactly one card", () => {
  const b = poisoningBoard({ tokens: { k1: 3 } });
  castPoisoning(b);
  spend(b, SEARCH, 3, ["k1", "k1", "k1"]);
  refused(() => pickRaw(b.engine, [b.id("e0")], P1), "the opponent's deck");
  refused(() => pickRaw(b.engine, [b.id("handChar")], P1), "your hand");
  refused(() => pickRaw(b.engine, [b.id("discChar")], P1), "your discard pile");
  refused(() => pickRaw(b.engine, [b.id("k2")], P1), "a card in play");
  refused(() => pickRaw(b.engine, [b.id("d0"), b.id("d1")], P1), "only one card");
  pickRaw(b.engine, [b.id("d1")], P1);
  assert.equal(zoneOf(b.engine, b.id("d1")), "hand");
});

clause(POISONING, "4:rule", "'Search your deck for a card' is not optional (CR 312.2): with cards in the deck you must find one, you cannot fail the search", () => {
  const b = poisoningBoard({ tokens: { k1: 3 } });
  castPoisoning(b);
  spend(b, SEARCH, 3, ["k1", "k1", "k1"]);
  refused(() => pickRaw(b.engine, [], P1), "an unconditional 'search for a card' must find a card when the deck has any");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for you to pick a card");
});

clause(POISONING, "4:rule", "the searched deck is shuffled afterwards (CR 312.1): same cards, new order", () => {
  const b = poisoningBoard({ tokens: { k1: 3 }, deck: 8 });
  const before = deckOf(b.engine, P1).filter((c) => c !== b.id("d3"));
  castPoisoning(b);
  spend(b, SEARCH, 3, ["k1", "k1", "k1"]);
  pick(b.engine, [b.id("d3")], P1);
  const after = deckOf(b.engine, P1);
  assert.deepEqual(sorted(after), sorted(before), "same cards");
  assert.notDeepEqual(after, before, "in a new order");
});

clause(POISONING, "4:rule", "the opponent's deck is not touched by your search", () => {
  const b = poisoningBoard({ tokens: { k1: 3 } });
  const theirs = [...deckOf(b.engine, P2)];
  castPoisoning(b);
  spend(b, SEARCH, 3, ["k1", "k1", "k1"]);
  pick(b.engine, [b.id("d0")], P1);
  assert.deepEqual(deckOf(b.engine, P2), theirs);
});

clause(POISONING, "4:rule", "with an empty deck the tokens are spent and nothing is found", () => {
  const b = poisoningBoard({ tokens: { k1: 3 }, deck: 0 });
  const handBefore = handOf(b.engine, P1).length;
  castPoisoning(b);
  spend(b, SEARCH, 3, ["k1", "k1", "k1"]);
  drain(b.engine, declineAll);
  assert.equal(tokens(b.engine, b.id("k1")), 0);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1);
  assert.equal(pending(b.engine), undefined);
});

// =============================================================================
// Voidal Replication
// Your opponent cannot respond to this card.
// COST: Play this only if a tactic has been played this turn.
// EFFECT: Duplicate the last tactic played this turn.
// Tactic (arcanist), cost 3, threshold [O][O][O].
// =============================================================================

const REPLICATION = "63369e53-e89b-4b7d-beb0-7110cb1290ce";

/** A free tactic: "the opponent's faction loses 1 influence", distinguishable from a draw. */
const taxer = (name = "Taxer", cost = 0): Def =>
  tactic({ name, cost, behavior: { abilities: [{ id: "tax", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }] } });

function replicationBoard(opts: { obsession?: number; greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 1,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "rep", def: printing(REPLICATION), owner: P1, zone: "hand" },
      { key: "can", def: drawTactic("Cantrip", 1, 0), owner: P1, zone: "hand" },
      { key: "tax", def: taxer(), owner: P1, zone: "hand" },
      { key: "widget", def: item({ name: "Widget", cost: 0 }), owner: P1, zone: "hand" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 6 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("obsession", opts.obsession ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type RepBoard = ReturnType<typeof replicationBoard>;

clause(REPLICATION, "0:rule", "'Your opponent cannot respond to this card': no response window opens for the opponent; it resolves at once", () => {
  const b = replicationBoard();
  play(b.engine, P1, b.id("can"));
  const handBefore = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("rep"));
  assert.equal(b.engine.state.responseWindow, undefined, "no window for the opponent");
  assert.equal(zoneOf(b.engine, b.id("rep")), "discard", "it has already resolved");
  assert.equal(handOf(b.engine, P1).length, handBefore, "...and its duplicate already drew the card (Replication left, one card drawn)");
});

clause(REPLICATION, "0:rule", "the opponent cannot play a tactic in response to it (a tactic of theirs stays in hand), while an ordinary tactic can be answered", () => {
  const b = replicationBoard({ extra: [{ key: "counter", def: drawTactic("Counter", 1, 0), owner: P2, zone: "hand" }] });
  play(b.engine, P1, b.id("can"));
  playRaw(b.engine, P1, b.id("rep"));
  refused(() => playRaw(b.engine, P2, b.id("counter")), "P2 has no response window");
  assert.equal(zoneOf(b.engine, b.id("counter")), "hand");
  const control = replicationBoard({ extra: [{ key: "counter", def: drawTactic("Counter", 1, 0), owner: P2, zone: "hand" }] });
  playRaw(control.engine, P1, control.id("can"));
  assert.equal(control.engine.state.responseWindow?.priorityPlayerId, P2, "control: an ordinary tactic can be answered");
  playRaw(control.engine, P2, control.id("counter"));
  assert.equal(zoneOf(control.engine, control.id("counter")), "deploying");
});

clause(REPLICATION, "0:rule", "the opponent cannot use an ability in response to it either, and play carries on normally afterwards", () => {
  const b = replicationBoard({
    extra: [
      { key: "drawer", def: character({ name: "Drawer", behavior: { abilities: [{ id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P2, zone: "play" },
      { key: "widget2", def: item({ name: "Widget2", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("can"));
  playRaw(b.engine, P1, b.id("rep"));
  refused(() => activateRaw(b.engine, P2, b.id("drawer"), "draw1"), "P2 has no response window");
  assert.equal(b.engine.state.responseWindow, undefined);
  play(b.engine, P1, b.id("widget2"));
  assert.equal(zoneOf(b.engine, b.id("widget2")), "play", "I can keep playing");
});

clause(REPLICATION, "1:ability", "'Play this only if a tactic has been played this turn': refused when none has, and nothing is paid", () => {
  const b = replicationBoard();
  const before = ready(b.engine);
  refused(() => playRaw(b.engine, P1, b.id("rep")), "no tactic has been played", /cannot be deployed right now/);
  assert.equal(zoneOf(b.engine, b.id("rep")), "hand", "nothing was played");
  assert.equal(ready(b.engine), before, "nothing was paid");
  assert.equal(b.engine.getCardPlayability(P1, b.id("rep")).playable, false);
  play(b.engine, P1, b.id("can"));
  assert.equal(b.engine.getCardPlayability(P1, b.id("rep")).playable, true, "control: playable once a tactic has been played");
});

clause(REPLICATION, "1:ability", "only a TACTIC counts: deploying an item, a character or a location, or using an ability, does not satisfy it", () => {
  const b = replicationBoard({
    extra: [
      { key: "newChar", def: character({ name: "NewChar", cost: 0 }), owner: P1, zone: "hand" },
      { key: "newLoc", def: location({ name: "NewLoc", cost: 0 }), owner: P1, zone: "hand" },
      { key: "drawer", def: item({ name: "Drawer", behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P1, zone: "play" }
    ]
  });
  play(b.engine, P1, b.id("widget"));
  refused(() => playRaw(b.engine, P1, b.id("rep")), "an item was deployed, not a tactic", /cannot be deployed right now/);
  play(b.engine, P1, b.id("newChar"));
  refused(() => playRaw(b.engine, P1, b.id("rep")), "a character was deployed, not a tactic", /cannot be deployed right now/);
  play(b.engine, P1, b.id("newLoc"));
  refused(() => playRaw(b.engine, P1, b.id("rep")), "a location was deployed, not a tactic", /cannot be deployed right now/);
  activate(b.engine, P1, b.id("drawer"), "dr");
  refused(() => playRaw(b.engine, P1, b.id("rep")), "an ability was used, not a tactic", /cannot be deployed right now/);
  assert.equal(zoneOf(b.engine, b.id("rep")), "hand");
});

clause(REPLICATION, "1:ability", "'this turn': a tactic played on an earlier turn does not count", () => {
  const b = replicationBoard();
  play(b.engine, P1, b.id("can"));
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  refused(() => playRaw(b.engine, P1, b.id("rep")), "the Cantrip was last turn");
  play(b.engine, P1, b.id("tax"));
  playRaw(b.engine, P1, b.id("rep"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("rep")), "discard", "a tactic played THIS turn does");
});

clause(REPLICATION, "1:ability", "a tactic played by the OPPONENT this turn counts too (any tactic has been played this turn)", () => {
  const b = replicationBoard({ extra: [{ key: "theirs", def: drawTactic("TheirCantrip", 1, 0), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("widget")); // P1 deploys an item; P2 responds with a tactic
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(b.engine, P2, b.id("theirs"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("widget")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard");
  playRaw(b.engine, P1, b.id("rep"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("rep")), "discard", "the opponent's tactic satisfied the restriction");
});

clause(REPLICATION, "1:ability", "the card itself costs 3 with [O][O][O]: exactly 3 with three [O] pays 3; one short or only two [O] is refused", () => {
  const exact = replicationBoard({ obsession: 3 });
  play(exact.engine, P1, exact.id("can"));
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("rep"));
  assert.equal(before - ready(exact.engine), 3, "the printed cost of 3 is paid");
  const short = replicationBoard({ obsession: 2 });
  play(short.engine, P1, short.id("can"));
  refused(() => playRaw(short.engine, P1, short.id("rep")), "2 resources for a cost of 3");
  const noIcons = replicationBoard({ obsession: 2, greed: 5 });
  play(noIcons.engine, P1, noIcons.id("can"));
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("rep")), "only two [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("rep")), "hand");
});

clause(REPLICATION, "1:ability", "duplicates the tactic: a Cantrip's draw happens a second time, for you", () => {
  const b = replicationBoard();
  play(b.engine, P1, b.id("can"));
  const handAfterCantrip = handOf(b.engine, P1).length;
  const top = deckOf(b.engine, P1)[0];
  playRaw(b.engine, P1, b.id("rep"));
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, handAfterCantrip - 1 + 1, "Replication left the hand, the duplicate drew one card");
  assert.equal(zoneOf(b.engine, top), "hand", "the duplicate drew the top card");
});

clause(REPLICATION, "1:ability", "duplicates the LAST tactic played, not an earlier one: Cantrip then Taxer, then Replication repeats the Taxer only", () => {
  const b = replicationBoard();
  play(b.engine, P1, b.id("can"));
  play(b.engine, P1, b.id("tax"));
  const hand = handOf(b.engine, P1).length;
  const start = influence(b.engine, P2);
  assert.equal(start, 30 - 1, "the Taxer took 1 influence");
  playRaw(b.engine, P1, b.id("rep"));
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), start - 1, "the Taxer was duplicated");
  assert.equal(handOf(b.engine, P1).length, hand - 1, "the Cantrip was NOT duplicated (only Replication left the hand)");
});

clause(REPLICATION, "1:ability", "...and in the other order the Cantrip is the last tactic: it repeats the draw and not the Taxer", () => {
  const b = replicationBoard();
  play(b.engine, P1, b.id("tax"));
  play(b.engine, P1, b.id("can"));
  const hand = handOf(b.engine, P1).length;
  const start = influence(b.engine, P2);
  playRaw(b.engine, P1, b.id("rep"));
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), start, "the Taxer was not repeated");
  assert.equal(handOf(b.engine, P1).length, hand, "Replication left, the duplicated draw arrived");
});

clause(REPLICATION, "1:ability", "the duplicate is made once: the tactic is repeated exactly once, the duplicate leaves no card behind, the original stays in the discard pile", () => {
  const b = replicationBoard();
  play(b.engine, P1, b.id("tax"));
  const cards = Object.keys(b.engine.state.cards).length;
  const start = influence(b.engine, P2);
  playRaw(b.engine, P1, b.id("rep"));
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), start - 1, "exactly one more influence lost");
  assert.equal(Object.keys(b.engine.state.cards).length, cards, "'an invisible copy': no new card exists");
  assert.equal(zoneOf(b.engine, b.id("tax")), "discard", "the original stays in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("rep")), "discard");
  assert.equal(discardOf(b.engine, P1).length, 2, "just the two real cards");
});

clause(REPLICATION, "1:ability", "the duplicate costs 0 and needs no threshold (CR 307.1): copying your own cost-5 [R][R][R] tactic costs only Replication's own 3", () => {
  const expensive = tactic({ name: "Expensive", cost: 5, threshold: "rrr", behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }] } });
  const b = replicationBoard({ obsession: 3, extra: [{ key: "expensive", def: expensive, owner: P1, zone: "hand" }, ...bank("rage", 5, P1)] });
  play(b.engine, P1, b.id("expensive"));
  const start = influence(b.engine, P2);
  const before = ready(b.engine);
  assert.equal(before, 3, "only the 3 Obsession are left");
  playRaw(b.engine, P1, b.id("rep"));
  resolvePendingResponses(b.engine);
  assert.equal(before - ready(b.engine), 3, "Replication costs 3; the copy of the cost-5 tactic costs 0");
  assert.equal(influence(b.engine, P2), start - 1, "the copy's effect happened");
});

clause(REPLICATION, "1:ability", "the duplicate is controlled by the one who played Replication: duplicating the OPPONENT's last tactic gives ME the draw", () => {
  const b = replicationBoard({ turn: 2, active: P2, extra: [{ key: "theirs", def: drawTactic("TheirCantrip", 1, 0), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("theirs"));
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  const hand = handOf(b.engine, P1).length;
  const oppHand = handOf(b.engine, P2).length;
  playRaw(b.engine, P1, b.id("rep"));
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1, "their tactic was duplicated for me: I drew");
  assert.equal(handOf(b.engine, P2).length, oppHand, "they did not draw again");
});

clause(REPLICATION, "1:ability", "'opponent' inside the duplicated text means the opponent of the duplicate's controller: copying their 'opponent loses 1 influence' tactic makes THEM lose it", () => {
  const b = replicationBoard({ turn: 2, active: P2, extra: [{ key: "theirTax", def: taxer("TheirTax"), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("theirTax"));
  const p1Start = influence(b.engine, P1);
  const p2Start = influence(b.engine, P2);
  assert.equal(p1Start, 30 - 1, "their tactic cost me 1 influence");
  b.engine.perform({ type: "endTurn", playerId: P2 });
  playRaw(b.engine, P1, b.id("rep"));
  assert.equal(influence(b.engine, P1), p1Start, "I do not lose another");
  assert.equal(influence(b.engine, P2), p2Start - 1, "the copy is mine: its 'opponent' is them");
});

clause(REPLICATION, "1:ability", "a tactic being played counts as played: Replication in response to the opponent's tactic duplicates it for you", () => {
  const b = replicationBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "theirs", def: drawTactic("TheirCantrip", 1, 0), owner: P2, zone: "hand" }]
  });
  const p1Hand = handOf(b.engine, P1).length;
  const p2Hand = handOf(b.engine, P2).length;
  playRaw(b.engine, P2, b.id("theirs"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond");
  playRaw(b.engine, P1, b.id("rep"));
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, p1Hand - 1 + 1, "the duplicate drew a card for P1 (the duplicator)");
  assert.equal(handOf(b.engine, P2).length, p2Hand - 1 + 1, "and the original still resolves: P2 drew one too");
});

clause(REPLICATION, "1:ability", "a duplicated tactic's extra costs are satisfied again (CR 307.1): duplicating a 'Pick a character' tactic makes you pick a character for the copy", () => {
  const b = replicationBoard({
    extra: [
      { key: "sniper", def: sniperTactic("Sniper", 0), owner: P1, zone: "hand" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2" }), owner: P2, zone: "play" }
    ]
  });
  play(b.engine, P1, b.id("sniper"), { selected: { t: [b.id("b1")] } });
  assert.equal(zoneOf(b.engine, b.id("b1")), "discard");
  playRaw(b.engine, P1, b.id("rep"));
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine);
  assert.ok(pc, "the copy's 'Pick a character' cost is satisfied anew: you are asked to pick");
  assert.equal(pc?.playerId, P1);
  if (pc?.kind === "selectTargets") pickTargets(b.engine, { t: [b.id("b2")] });
  else pick(b.engine, [b.id("b2")]);
  assert.equal(zoneOf(b.engine, b.id("b2")), "discard", "the copy destroyed the newly picked character");
});

clause(REPLICATION, "1:ability", "a duplicated tactic's extra costs are satisfied again (CR 307.1): duplicating Cash Out (pay X+X) charges X+X again for the copy", () => {
  const b = replicationBoard({ obsession: 6, greed: 8, extra: [{ key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("co"), { variables: { x: 1 } });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("rep"));
  assert.ok(before - ready(b.engine) > 3, "Replication costs 3 and the copy must also pay its extra cost 'Pay X+X' (it cannot be free)");
});

clause(REPLICATION, "1:ability", "a duplicated tactic's extra costs are satisfied again (CR 307.1): a tactic with the extra cost 'discard a card' is not duplicated when you have no card to discard", () => {
  const tithe = tactic({
    name: "Tithe",
    cost: 0,
    behavior: {
      abilities: [{ id: "tithe", type: "activated", costs: [{ type: "discard", id: "dc", player: "controller", selector: { zone: "hand" }, count: 1 }], effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }]
    }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rep", def: printing(REPLICATION), owner: P1, zone: "hand" },
      { key: "tithe", def: tithe, owner: P1, zone: "hand" },
      { key: "junk", def: character({ name: "Junk" }), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1)
    ]
  });
  const start = influence(b.engine, P2);
  play(b.engine, P1, b.id("tithe"), { selected: { dc: [b.id("junk")] } });
  assert.equal(influence(b.engine, P2), start - 1, "control: the original paid its discard and worked");
  assert.deepEqual(handOf(b.engine, P1), [b.id("rep")], "no card is left to discard but Replication, which is being played");
  play(b.engine, P1, b.id("rep"));
  drain(b.engine, declineAll);
  assert.equal(influence(b.engine, P2), start - 1, "the copy's extra cost 'discard a card' cannot be paid, so the duplicate is terminated and does nothing");
});

clause(REPLICATION, "1:ability", "a duplicate of a draw-2 tactic draws 2, and the 'last tactic' is judged by play order, not cost", () => {
  const b = replicationBoard({
    extra: [
      { key: "a", def: drawTactic("First", 1, 1), owner: P1, zone: "hand" },
      { key: "b", def: drawTactic("Second", 2, 2), owner: P1, zone: "hand" }
    ],
    obsession: 8
  });
  play(b.engine, P1, b.id("a"));
  play(b.engine, P1, b.id("b"));
  const hand = handOf(b.engine, P1).length;
  const before = ready(b.engine);
  play(b.engine, P1, b.id("rep"));
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 2, "Replication left the hand; the copy of the LAST tactic (draw 2) drew 2");
  assert.equal(before - ready(b.engine), 3, "only Replication's own cost is paid: the copy is free");
});

clause(REPLICATION, "1:ability", "Replication can be played in response to the opponent's attack when a tactic has been played this turn", () => {
  const b = replicationBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "theirs", def: drawTactic("TheirCantrip", 1, 0), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  play(b.engine, P2, b.id("theirs"));
  openWindowOnP2Attack(b.engine, b.id("atk"));
  const hand = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("rep"));
  assert.equal(handOf(b.engine, P1).length, hand, "Replication left, the copied draw arrived");
});

// =============================================================================
// Armored Keep
// UNIQUE ARMORED KEEP
// You may play this card whenever you could play a tactic.
// You do not lose the game because your faction has 0 influence.
// Location (banker), cost 6, threshold [G][G][G], structure 5.
// =============================================================================

const KEEP = "8613fc09-e2f6-4c74-9664-798476f58c45";
const TACTICIAN_VACATION = "4181e922-7ffb-4c71-aef6-17adf4f006c7";

function keepBoard(extra: CardPlacement[] = [], opts: { greed?: number; turn?: number; active?: Pid; keepZone?: "play" | "hand"; keepController?: Pid; keepFaceDown?: boolean; p1Influence?: number; p2Influence?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.p1Influence },
    playerB: { faction: developFaction(), influence: opts.p2Influence },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: opts.keepZone ?? "play", controller: opts.keepController, faceDown: opts.keepFaceDown },
      ...bank("greed", opts.greed ?? 6, P1),
      ...extra
    ]
  });
}

type KeepBoard = ReturnType<typeof keepBoard>;

clause(KEEP, "0:unique", "controlling a second ARMORED KEEP makes you keep one: choosing the new one destroys the old one", () => {
  const b = keepBoard([{ key: "ak2", def: printing(KEEP), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("ak2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("ak"), b.id("ak2")].sort());
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id("ak2") });
  assert.equal(zoneOf(b.engine, b.id("ak2")), "play");
  assert.equal(zoneOf(b.engine, b.id("ak")), "discard", "the other copy is destroyed");
  assert.equal(pending(b.engine), undefined);
});

clause(KEEP, "0:unique", "choosing the old one keeps it and destroys the new one", () => {
  const b = keepBoard([{ key: "ak2", def: printing(KEEP), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("ak2"));
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id("ak") });
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(zoneOf(b.engine, b.id("ak2")), "discard");
});

clause(KEEP, "0:unique", "the restriction is per player: the opponent may control their own Keep, with no choice and no destruction", () => {
  const b = keepBoard([{ key: "ak2", def: printing(KEEP), owner: P2, zone: "hand" }, ...bank("greed", 6, P2)], { turn: 2, active: P2 });
  play(b.engine, P2, b.id("ak2"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(zoneOf(b.engine, b.id("ak2")), "play");
});

clause(KEEP, "0:unique", "taking control of the opponent's Keep while you have your own is a duplicate: you must keep one, and the one you don't keep is destroyed into its OWNER's discard pile", () => {
  const b = keepBoard([
    { key: "theirs", def: printing(KEEP), owner: P2, zone: "play" },
    { key: "steal", def: tactic({ name: "StealLoc", cost: 0, behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location", controller: "opponent" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] } }), owner: P1, zone: "hand" }
  ]);
  playRaw(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirs")] } });
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor", "two Keeps under one player's control");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("ak"), b.id("theirs")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("ak") } } as never);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard");
  assert.equal(discardOf(b.engine, P2).includes(b.id("theirs")), true, "the stolen copy goes to its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
});

clause(KEEP, "0:unique", "after the Unique choice forced by a tactic that took control of the opponent's Keep, the tactic finishes resolving and the game carries on", () => {
  const b = keepBoard([
    { key: "theirs", def: printing(KEEP), owner: P2, zone: "play" },
    { key: "steal", def: tactic({ name: "StealLoc", cost: 0, behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location", controller: "opponent" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] } }), owner: P1, zone: "hand" },
    { key: "widget", def: item({ name: "Widget", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  playRaw(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirs")] } });
  resolvePendingResponses(b.engine);
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id("ak") });
  for (let i = 0; i < 5 && b.engine.state.responseWindow; i++) {
    const w = b.engine.state.responseWindow;
    if (w.phase === "acceptingResponses") b.engine.perform({ type: "passPriority", playerId: w.priorityPlayerId });
    else b.engine.perform({ type: "advanceFlow" });
  }
  assert.equal(b.engine.state.responseWindow, undefined, "the response window closes");
  assert.equal(zoneOf(b.engine, b.id("steal")), "discard", "the Steal tactic is finished and in its owner's discard pile");
  play(b.engine, P1, b.id("widget"));
  assert.equal(zoneOf(b.engine, b.id("widget")), "play", "and you can keep playing");
});

clause(KEEP, "0:unique", "a card with a different UNIQUE designation (or none) is not a duplicate", () => {
  const b = keepBoard([{ key: "other", def: location({ name: "OtherLoc", unique: "other loc" } as Partial<Def>), owner: P1, zone: "play" }, { key: "plain", def: location({ name: "PlainLoc" }), owner: P1, zone: "play" }]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(zoneOf(b.engine, b.id("plain")), "play");
});

clause(KEEP, "0:unique", "the designation is the printed name, whatever the edition: an Armored Keep of another printing is a duplicate too", () => {
  const b = keepBoard([{ key: "oldKeep", def: printing("fb95db39-dc7b-404d-9c2d-4aeaa4f079ee"), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("oldKeep"));
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor", "two cards with UNIQUE ARMORED KEEP");
  assert.deepEqual([...pc.candidates].sort(), [b.id("ak"), b.id("oldKeep")].sort());
});

clause(KEEP, "0:unique", "a Keep played face-down as a resource is only a resource, so it is not a duplicate of the Keep in play", () => {
  const b = keepBoard([{ key: "ak2", def: printing(KEEP), owner: P1, zone: "hand" }]);
  developResource(b.engine, P1, b.id("ak2"), true);
  assert.equal(pending(b.engine), undefined, "no choice is forced");
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(zoneOf(b.engine, b.id("ak2")), "play");
  assert.equal(b.engine.state.cards[b.id("ak2")].faceDown, true);
});

clause(KEEP, "1:rule", "on your own turn it is played like any location: deployed for 6 with [G][G][G], structure 5", () => {
  const b = keepBoard([], { keepZone: "hand" });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("ak"));
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(before - ready(b.engine), 6);
  assert.equal(b.engine.getStat(b.id("ak"), "structure"), 5);
});

clause(KEEP, "1:rule", "deploy restrictions on your own turn: one resource short, or only two [G] with plenty of other resources, is refused", () => {
  const short = keepBoard([], { keepZone: "hand", greed: 5 });
  refused(() => playRaw(short.engine, P1, short.id("ak")), "5 resources for a cost of 6");
  const noIcons = keepBoard(bank("rage", 6, P1), { keepZone: "hand", greed: 2 });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("ak")), "two [G] are not [G][G][G]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("ak")), "hand");
  const mixed = keepBoard(bank("rage", 3, P1), { keepZone: "hand", greed: 3 });
  play(mixed.engine, P1, mixed.id("ak"));
  assert.equal(zoneOf(mixed.engine, mixed.id("ak")), "play", "[G][G][G] plus three other resources");
});

/** P2's turn: P1 holds the Keep, P2 has an attacker. */
function keepWindowBoard(opts: { greed?: number; obsession?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: "hand" },
      { key: "plainLoc", def: location({ name: "PlainLoc", cost: 1, structure: 2 }), owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "theirTac", def: drawTactic("TheirCantrip", 1, 0), owner: P2, zone: "hand" },
      ...fillers("e", 3, P2, "deck"),
      ...bank("greed", opts.greed ?? 6, P1),
      ...bank("obsession", opts.obsession ?? 0, P1),
      ...bank("rage", 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

clause(KEEP, "1:rule", "you may play it whenever you could play a tactic: in response to the opponent's attack, and it enters play, paying its full cost", () => {
  const b = keepWindowBoard();
  refused(() => playRaw(b.engine, P1, b.id("ak")), "control: on the opponent's turn with nothing to respond to it cannot be played");
  declareAttackOpenWindow(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 });
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play", "it entered play in response, like a tactic would have been played");
  assert.equal(before - ready(b.engine), 6, "paid its full cost");
  assert.equal(b.engine.state.cards[b.id("ak")].controllerId, P1);
  assert.equal(b.engine.getStat(b.id("ak"), "structure"), 5);
});

clause(KEEP, "1:rule", "you may play it in response to the opponent's tactic on their turn, and it resolves (into play) before that tactic does", () => {
  const b = keepWindowBoard();
  const p2Hand = handOf(b.engine, P2).length;
  playRaw(b.engine, P2, b.id("theirTac"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirTac")), "discard", "their tactic resolved after");
  assert.equal(handOf(b.engine, P2).length, p2Hand - 1 + 1, "and its draw happened");
});

clause(KEEP, "1:rule", "you may play it in response to the opponent announcing the end of their turn", () => {
  const b = keepWindowBoard();
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
});

clause(KEEP, "1:rule", "an ordinary location can NOT be played in those windows (control for the TACTICAL timing)", () => {
  const b = keepWindowBoard();
  refused(() => playRaw(b.engine, P1, b.id("plainLoc")), "no window at all on the opponent's turn");
  declareAttackOpenWindow(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 });
  refused(() => playRaw(b.engine, P1, b.id("plainLoc")), "an ordinary location cannot be played in response to an attack");
  assert.equal(zoneOf(b.engine, b.id("plainLoc")), "hand");
});

clause(KEEP, "1:rule", "it is not a tactic: it enters play (it is not discarded) and is still a location", () => {
  const b = keepWindowBoard();
  declareAttackOpenWindow(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 });
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  assert.equal(b.engine.getDefinition(b.id("ak")).type, "location");
  assert.equal(discardOf(b.engine, P1).includes(b.id("ak")), false);
});

clause(KEEP, "1:rule", "played in response, it needs the full cost: refused one resource short of 6 and without [G][G][G]", () => {
  const short = keepWindowBoard({ greed: 5 });
  declareAttackOpenWindow(short.engine, P2, [short.id("attacker")], { type: "faction", playerId: P1 });
  refused(() => playRaw(short.engine, P1, short.id("ak")), "5 resources for a cost of 6");
  const noIcons = keepWindowBoard({ greed: 2, obsession: 8 });
  declareAttackOpenWindow(noIcons.engine, P2, [noIcons.id("attacker")], { type: "faction", playerId: P1 });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("ak")), "two [G] are not [G][G][G]");
  const mixed = keepWindowBoard({ greed: 3, obsession: 3 });
  declareAttackOpenWindow(mixed.engine, P2, [mixed.id("attacker")], { type: "faction", playerId: P1 });
  playRaw(mixed.engine, P1, mixed.id("ak"));
  resolvePendingResponses(mixed.engine);
  assert.equal(zoneOf(mixed.engine, mixed.id("ak")), "play", "[G][G][G] plus three other resources");
});

clause(KEEP, "1:rule", "it can be played during your own battle windows too (any time you could play a tactic), e.g. after you declare an attack", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...bank("greed", 6, P1)
    ]
  });
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P2 } });
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
});

clause(KEEP, "1:rule", "Tactician Vacation closes the tactic window for the whole turn, including cards that can be played 'whenever you could play a tactic' (FAQ): the Keep cannot be played in response to the opponent's attack", () => {
  const b = keepWindowBoard({ extra: [{ key: "vacation", def: printing(TACTICIAN_VACATION), owner: P2, zone: "hand" }, { key: "ctl", def: drawTactic("Control", 1, 0), owner: P1, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("vacation"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("vacation")), "discard");
  declareAttackOpenWindow(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "P1 has priority in the battle window");
  refused(() => playRaw(b.engine, P1, b.id("ctl")), "control: a real tactic cannot be played after Tactician Vacation", /cannot play tactic cards/);
  refused(() => playRaw(b.engine, P1, b.id("ak")), "the tactic window is closed for the turn, so the Keep cannot be played either");
  assert.equal(zoneOf(b.engine, b.id("ak")), "hand");
});

clause(KEEP, "1:rule", "...but after Tactician Vacation it can still be played when it normally could be: on your own turn", () => {
  const b = keepBoard([{ key: "vacation", def: printing(TACTICIAN_VACATION), owner: P1, zone: "hand" }, { key: "ak2", def: printing(KEEP), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)], { keepZone: "hand" });
  play(b.engine, P1, b.id("vacation"));
  assert.equal(zoneOf(b.engine, b.id("vacation")), "discard");
  play(b.engine, P1, b.id("ak"));
  assert.equal(zoneOf(b.engine, b.id("ak")), "play", "a location can still be played on your own turn");
});

// the loss at 0 influence: P1 (Keep owner) attacked by a strength-5 attacker.
function keepBattleBoard(keep: boolean, opts: { influence?: number; keepController?: Pid; keepZone?: "play" | "hand"; keepFaceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence ?? 5 },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      ...(keep ? [{ key: "ak", def: printing(KEEP), owner: P1, zone: opts.keepZone ?? ("play" as const), controller: opts.keepController, faceDown: opts.keepFaceDown }] : []),
      { key: "attacker", def: character({ name: "Attacker", strength: 5, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
}

clause(KEEP, "2:rule", "control: without a Keep a faction that reaches 0 influence loses the game", () => {
  const b = keepBattleBoard(false);
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(influence(b.engine, P1), 0);
  assert.deepEqual(b.engine.state.result, { outcome: "victory", winners: [P2] }, "P1 lost");
});

clause(KEEP, "2:rule", "with the Keep in play you do not lose at 0 influence: the game carries on", () => {
  const b = keepBattleBoard(true);
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(influence(b.engine, P1), 0, "the faction is at 0 influence");
  assert.equal(b.engine.state.result, undefined, "and the game is not over");
  assert.notEqual(b.engine.getFlowView().mode, "gameOver");
});

clause(KEEP, "2:rule", "with the Keep in play and MORE damage than influence you still do not lose", () => {
  const b = keepBattleBoard(true, { influence: 2 });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(b.engine.state.result, undefined);
});

clause(KEEP, "2:rule", "overkill damage leaves the faction at exactly 0 influence (CR 410.4: a number reduced below 0 stays at 0), which is the state the Keep protects", () => {
  const b = keepBattleBoard(true, { influence: 2 });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(influence(b.engine, P1), 0, "5 damage to a faction with 2 influence leaves it at 0");
});

clause(KEEP, "2:rule", "losing more influence than you have with a direct 'loses influence' effect also stops at 0 (CR 410.4)", () => {
  const drain = tactic({ name: "Drain5", cost: 0, behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -5 }] }] } });
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: 2 },
    turn: 1,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P2, zone: "play" },
      { key: "drain", def: drain, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("drain"));
  assert.equal(influence(b.engine, P2), 0, "2 - 5 stays at 0");
  assert.equal(b.engine.state.result, undefined, "and the Keep keeps P2 in the game");
});

clause(KEEP, "2:rule", "the game goes on and play continues: the turn can end and the next turn starts normally", () => {
  const b = keepBattleBoard(true);
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.result, undefined);
});

clause(KEEP, "2:rule", "when the Keep leaves play while you are at 0 influence you lose at once", () => {
  const raze = tactic({
    name: "Raze",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 0 },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: "play" },
      { key: "raze", def: raze, owner: P2, zone: "hand" }
    ],
    turn: 2,
    activePlayerId: P2
  });
  assert.equal(b.engine.state.result ?? null, null, "protected while the Keep stands");
  play(b.engine, P2, b.id("raze"), { selected: { t: [b.id("ak")] } });
  assert.equal(zoneOf(b.engine, b.id("ak")), "discard");
  assert.deepEqual(b.engine.state.result, { outcome: "victory", winners: [P2] }, "the Keep is gone, so P1 at 0 influence loses");
});

clause(KEEP, "2:rule", "the protection starts when the Keep enters play: a faction already at 0 influence is saved once the Keep is in play", () => {
  // A faction cannot sit at 0 influence with the Keep still in hand (it would have lost already), so the board starts at 1.
  const b = keepBoard([], { keepZone: "hand", p1Influence: 1 });
  playRaw(b.engine, P1, b.id("ak"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ak")), "play");
  b.engine.state.players[P1].influence = 0;
  (b.engine as unknown as { checkStateBasedActions(): void }).checkStateBasedActions();
  assert.equal(b.engine.state.result ?? null, null, "at 0 influence with the Keep in play you stay in the game");
});

clause(KEEP, "2:rule", "it protects only YOUR faction: the opponent at 0 influence loses even though you control a Keep", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: 5 },
    turn: 2,
    cards: [
      { key: "ak", def: printing(KEEP), owner: P1, zone: "play" },
      { key: "attacker", def: character({ name: "Attacker", strength: 5, life: 3, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  fight(b.engine, P1, [b.id("attacker")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(b.engine, P2), 0);
  assert.deepEqual(b.engine.state.result, { outcome: "victory", winners: [P1] }, "P2 lost");
});

clause(KEEP, "2:rule", "both factions at 0 influence but only you have a Keep: the opponent loses and you win (not a draw)", () => {
  const b = keepBoard([{ key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }], { p1Influence: 0, p2Influence: 0 });
  endTurn(b.engine, P1);
  assert.deepEqual(b.engine.state.result, { outcome: "victory", winners: [P1] });
});

clause(KEEP, "2:rule", "a Keep the OPPONENT controls protects the opponent, not you", () => {
  const b = keepBattleBoard(true, { keepController: P2 });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.equal(influence(b.engine, P1), 0);
  assert.deepEqual(b.engine.state.result, { outcome: "victory", winners: [P2] }, "the Keep under P2's control does not save P1");
});

clause(KEEP, "2:rule", "a Keep in your hand does not protect you", () => {
  const b = keepBattleBoard(true, { keepZone: "hand" });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.deepEqual(b.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(KEEP, "2:rule", "a face-down Keep is only a resource and does not protect you", () => {
  const b = keepBattleBoard(true, { keepFaceDown: true });
  fight(b.engine, P2, [b.id("attacker")], { type: "faction", playerId: P1 }, []);
  assert.deepEqual(b.engine.state.result, { outcome: "victory", winners: [P2] });
});

clause(KEEP, "2:rule", "both players with a Keep: both can sit at 0 influence and the game does not end", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 0 },
    playerB: { faction: developFaction(), influence: 0 },
    cards: [
      { key: "ak1", def: printing(KEEP), owner: P1, zone: "play" },
      { key: "ak2", def: printing(KEEP), owner: P2, zone: "play" },
      { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
    ]
  });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.result, undefined);
  assert.equal(b.engine.state.activePlayerId, P2);
});

clause(KEEP, "2:rule", "gaining influence while at 0 works as usual and the Keep does not interfere", () => {
  const gain = tactic({ name: "Gain3", cost: 0, behavior: { abilities: [{ id: "g", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] }] } });
  const b = keepBoard([{ key: "gain", def: gain, owner: P1, zone: "hand" }], { p1Influence: 0 });
  play(b.engine, P1, b.id("gain"));
  assert.equal(influence(b.engine, P1), 3);
  assert.equal(b.engine.state.result ?? null, null);
});

clause(KEEP, "2:rule", "damage to the Keep itself: it survives 4 damage and is destroyed by 5 (structure 5)", () => {
  const hit = (amount: number) =>
    tactic({
      name: `Hit${amount}`,
      cost: 0,
      behavior: { abilities: [{ id: "h", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
    });
  for (const [amount, zone] of [
    [4, "play"],
    [5, "discard"]
  ] as const) {
    const b = keepBoard([{ key: "hit", def: hit(amount), owner: P1, zone: "hand" }]);
    play(b.engine, P1, b.id("hit"), { selected: { t: [b.id("ak")] } });
    assert.equal(zoneOf(b.engine, b.id("ak")), zone, `${amount} damage`);
  }
});

// =============================================================================
// Beatrix Winterbottom
// UNIQUE BEATRIX
// If you draw any number of cards, increase the amount by 1.
// While you have at least 10 cards in your hand, you cannot draw cards.
// Character (banker; mau), cost 5, threshold [G][G][G], 1 strength / 4 speed / 2 life.
// =============================================================================

const BEATRIX = "8ef7a416-d6b3-436b-abc1-ca6647cbe939";

const drawN = (n: number, name = `Draw${n}`) => drawTactic(name, n, 0);
const drawThreeSeparately = () =>
  tactic({
    name: "ThreeSingles",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "t",
          type: "activated",
          effects: [
            { type: "draw", player: "controller", amount: 1 },
            { type: "draw", player: "controller", amount: 1 },
            { type: "draw", player: "controller", amount: 1 }
          ]
        }
      ]
    }
  });
/** A free tactic: put a card of your deck into your hand without drawing it (a search). */
const tutorTactic = () =>
  tactic({
    name: "Tutor",
    cost: 0,
    behavior: { abilities: [{ id: "tu", type: "activated", targets: [{ id: "t", selector: { owner: "self", zone: "deck" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });

/**
 * `hand` is the TOTAL size of P1's hand; `tactics` names the special cards (c1/c2/c3/c0/triple/tutor/killer/bw2) in it, the rest is filler characters
 * (cost 0). P2's hand is `oppHand` cards, `oppTactics` of which are special (oc1 = a Draw-1 tactic, oppBw = a Beatrix).
 */
function beatrixBoard(opts: { bw?: "play" | "hand"; bwController?: Pid; hand?: number; tactics?: string[]; oppHand?: number; oppTactics?: string[]; deck?: number; oppDeck?: number; greed?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  const special: Record<string, Def> = {
    c1: drawN(1, "Draw1"),
    c2: drawN(2),
    c3: drawN(3),
    c0: drawN(0),
    triple: drawThreeSeparately(),
    tutor: tutorTactic(),
    killer: killTactic(),
    bw2: printing(BEATRIX)
  };
  const tactics = opts.tactics ?? [];
  const bwInHand = (opts.bw ?? "play") === "hand";
  const handSize = opts.hand ?? 3;
  const filler = handSize - tactics.length - (bwInHand ? 1 : 0);
  assert.ok(filler >= 0, "hand size too small for the requested cards");
  const oppTactics = opts.oppTactics ?? ["oc1"];
  const oppSpecial: Record<string, Def> = { oc1: drawN(1, "OppDraw1"), oppBw: printing(BEATRIX) };
  const oppFiller = (opts.oppHand ?? 3) - oppTactics.length;
  assert.ok(oppFiller >= 0, "oppFiller >= 0");
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    cards: [
      { key: "bw", def: printing(BEATRIX), owner: P1, controller: opts.bwController, zone: opts.bw ?? "play" },
      ...tactics.map((key) => ({ key, def: special[key], owner: P1, zone: "hand" as const })),
      ...Array.from({ length: filler }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}`, cost: 0 }), owner: P1, zone: "hand" as const })),
      ...oppTactics.map((key) => ({ key, def: oppSpecial[key], owner: P2, zone: "hand" as const })),
      ...Array.from({ length: oppFiller }, (_, i) => ({ key: `o${i}`, def: character({ name: `O${i}`, cost: 0 }), owner: P2, zone: "hand" as const })),
      ...Array.from({ length: opts.deck ?? 12 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: opts.oppDeck ?? 12 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** The top `n` cards of `player`'s deck. */
const topOf = (engine: SpoilsEngine, player: Pid, n: number) => deckOf(engine, player).slice(0, n);
const developDrawFor = (engine: SpoilsEngine, player: Pid) => developDraw(engine, player);

clause(BEATRIX, "0:unique", "playing a second Beatrix forces you to choose which one to keep; the other is destroyed", () => {
  const b = beatrixBoard({ greed: 5, tactics: ["bw2"], hand: 1 });
  play(b.engine, P1, b.id("bw2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("bw"), b.id("bw2")].sort());
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id("bw2") });
  assert.equal(zoneOf(b.engine, b.id("bw2")), "play");
  assert.equal(zoneOf(b.engine, b.id("bw")), "discard");
  const old = beatrixBoard({ greed: 5, tactics: ["bw2"], hand: 1 });
  play(old.engine, P1, old.id("bw2"));
  answerPending(old.engine, "uniqueSurvivor", { keep: old.id("bw") });
  assert.equal(zoneOf(old.engine, old.id("bw")), "play");
  assert.equal(zoneOf(old.engine, old.id("bw2")), "discard", "keeping the old copy destroys the new one");
});

clause(BEATRIX, "0:unique", "only YOUR copies count: the opponent may have their own Beatrix with no choice (FAQ)", () => {
  const b = beatrixBoard({ active: P2, oppTactics: ["oppBw"], oppHand: 1, extra: [...bank("greed", 5, P2)] });
  play(b.engine, P2, b.id("oppBw"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("bw")), "play");
  assert.equal(zoneOf(b.engine, b.id("oppBw")), "play");
});

clause(BEATRIX, "0:unique", "taking control of the opponent's Beatrix while you have your own is a duplicate: you choose which to keep, and the other goes to its OWNER's discard pile", () => {
  const b = beatrixBoard({ extra: [{ key: "theirBw", def: printing(BEATRIX), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirBw")] } });
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("bw"), b.id("theirBw")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("theirBw") } } as never);
  assert.equal(zoneOf(b.engine, b.id("bw")), "discard", "my own copy was not kept");
  assert.equal(zoneOf(b.engine, b.id("theirBw")), "play", "the stolen copy is kept");
  assert.equal(b.engine.state.cards[b.id("theirBw")].controllerId, P1);
});

clause(BEATRIX, "0:unique", "after the Unique choice forced by a tactic that took control of the opponent's Beatrix, the tactic finishes resolving and the game carries on", () => {
  const b = beatrixBoard({ extra: [{ key: "theirBw", def: printing(BEATRIX), owner: P2, zone: "play" }, { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }, { key: "widget", def: item({ name: "Widget", cost: 0 }), owner: P1, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("steal"), { selected: { t: [b.id("theirBw")] } });
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bw") } } as never);
  for (let i = 0; i < 5 && b.engine.state.responseWindow; i++) {
    const w = b.engine.state.responseWindow;
    if (w.phase === "acceptingResponses") b.engine.perform({ type: "passPriority", playerId: w.priorityPlayerId });
    else b.engine.perform({ type: "advanceFlow" });
  }
  assert.equal(b.engine.state.responseWindow, undefined, "the response window closes");
  assert.equal(zoneOf(b.engine, b.id("steal")), "discard", "the Steal tactic is finished");
  play(b.engine, P1, b.id("widget"));
  assert.equal(zoneOf(b.engine, b.id("widget")), "play", "and you can keep playing");
});

clause(BEATRIX, "0:unique", "the designation is the printed name, whatever the edition: a Beatrix of another printing is a duplicate too", () => {
  const b = beatrixBoard({ extra: [{ key: "oldBw", def: printing("d584c808-1bc9-43c7-b67d-d8e00d00e1f4"), owner: P1, zone: "hand" }, ...bank("greed", 5, P1)] });
  play(b.engine, P1, b.id("oldBw"));
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates].sort(), [b.id("bw"), b.id("oldBw")].sort());
});

clause(BEATRIX, "0:unique", "a Beatrix played face-down as a resource is only a resource, so it is not a duplicate of the Beatrix in play", () => {
  const b = beatrixBoard({ tactics: ["bw2"], hand: 3 });
  developResource(b.engine, P1, b.id("bw2"), true);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("bw")), "play");
  assert.equal(b.engine.state.cards[b.id("bw2")].faceDown, true);
});

clause(BEATRIX, "0:unique", "deploys for 5 with [G][G][G] (refused one resource short, or one [G] short); printed stats 1 strength / 4 speed / 2 life", () => {
  const short = beatrixBoard({ bw: "hand", greed: 4 });
  refused(() => playRaw(short.engine, P1, short.id("bw")), "4 resources for a cost of 5");
  const noIcons = beatrixBoard({ bw: "hand", greed: 2, extra: [...bank("rage", 6, P1)] });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("bw")), "only two [G]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("bw")), "hand");
  const exact = beatrixBoard({ bw: "hand", greed: 3, extra: [...bank("rage", 2, P1)] });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("bw"));
  assert.equal(zoneOf(exact.engine, exact.id("bw")), "play");
  assert.equal(before - ready(exact.engine), 5, "the printed cost of 5 is paid");
  assert.deepEqual(stats(exact.engine, exact.id("bw")), [1, 2, 4]);
  assert.ok((exact.engine.getDefinition(exact.id("bw")).subtype ?? []).includes("mau"), "(exact.engine.getDefinition(exact.id(\"bw\")).subtype ?? []).includes(\"mau\")");
});

// --- "If you draw any number of cards, increase the amount by 1."

clause(BEATRIX, "1:rule", "the Develop Rule draw (1 card) draws 2 cards: the top two of your deck", () => {
  const b = beatrixBoard();
  const top = topOf(b.engine, P1, 2);
  const hand = handOf(b.engine, P1).length;
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, hand + 2);
  for (const card of top) assert.equal(zoneOf(b.engine, card), "hand");
  assert.equal(deckOf(b.engine, P1).length, 10);
});

for (const [card, n] of [
  ["c1", 1],
  ["c2", 2],
  ["c3", 3]
] as const) {
  clause(BEATRIX, "1:rule", `a card that draws ${n} makes you draw ${n + 1}`, () => {
    const b = beatrixBoard({ tactics: [card], hand: 3 });
    const top = topOf(b.engine, P1, n + 1);
    const hand = handOf(b.engine, P1).length;
    play(b.engine, P1, b.id(card));
    assert.equal(handOf(b.engine, P1).length, hand - 1 + n + 1, `the tactic left, ${n + 1} cards arrived`);
    for (const c of top) assert.equal(zoneOf(b.engine, c), "hand");
    assert.equal(deckOf(b.engine, P1).length, 12 - (n + 1), "no more than that");
  });
}

clause(BEATRIX, "1:rule", "real draw cards are increased too: Cash Out with X=2 (draw 3) draws 4", () => {
  const b = beatrixBoard({ greed: 3, tactics: [], hand: 3, extra: [{ key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)] });
  const top = topOf(b.engine, P1, 4);
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("co"), { variables: { x: 2 } });
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 4, "Cash Out left; 3 + 1 cards arrived");
  for (const c of top) assert.equal(zoneOf(b.engine, c), "hand");
});

clause(BEATRIX, "1:rule", "a Voidal Poisoning draw (2 tokens, draw a card) draws 2", () => {
  const b = beatrixBoard({ hand: 3, extra: [{ key: "poi", def: printing(POISONING), owner: P1, zone: "hand" }, { key: "tk", def: character({ name: "Tokened" }), owner: P1, zone: "play", counters: { token: 2 } }, ...bank("obsession", 3, P1)] });
  const top = topOf(b.engine, P1, 2);
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("poi"));
  answerPending(b.engine, "spendCountersMenu", { optionIndex: optionFor(b.engine, DRAW, 2), sources: [b.id("tk"), b.id("tk")] });
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 2);
  for (const c of top) assert.equal(zoneOf(b.engine, c), "hand");
});

clause(BEATRIX, "1:rule", "a Violating Anomaly leaving play ('Draw a card') draws 2 for the Beatrix controller", () => {
  const b = beatrixBoard({ hand: 3, tactics: ["killer"], extra: [{ key: "an", def: printing(ANOMALY), owner: P1, zone: "play" }] });
  const top = topOf(b.engine, P1, 2);
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("an")] } });
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc)));
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 2, "the killer left the hand; the Anomaly's single draw became 2");
  for (const c of top) assert.equal(zoneOf(b.engine, c), "hand");
});

clause(BEATRIX, "1:rule", "a draw of 0 cards is not 'drawing any number of cards': it stays 0", () => {
  const b = beatrixBoard({ tactics: ["c0"], hand: 3 });
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("c0"));
  assert.equal(handOf(b.engine, P1).length, hand - 1, "nothing drawn");
  assert.equal(deckOf(b.engine, P1).length, 12);
});

clause(BEATRIX, "1:rule", "each separate 'draw a card' instruction is increased on its own (FAQ): three separate draws of 1 give 6 cards, not 4", () => {
  const b = beatrixBoard({ tactics: ["triple"], hand: 3 });
  const hand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("triple"));
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 6);
  assert.equal(deckOf(b.engine, P1).length, 6);
});

clause(BEATRIX, "1:rule", "only YOUR draws: the opponent's draws are not increased", () => {
  const b = beatrixBoard({ active: P2 });
  const hand = handOf(b.engine, P2).length;
  play(b.engine, P2, b.id("oc1"));
  assert.equal(handOf(b.engine, P2).length, hand - 1 + 1, "the opponent draws exactly 1");
  assert.equal(deckOf(b.engine, P2).length, 11);
});

clause(BEATRIX, "1:rule", "'you' is the Beatrix's controller: a Beatrix the opponent controls increases THEIR draws, not its owner's", () => {
  const theirs = beatrixBoard({ bwController: P2, active: P2 });
  const p2Hand = handOf(theirs.engine, P2).length;
  play(theirs.engine, P2, theirs.id("oc1"));
  assert.equal(handOf(theirs.engine, P2).length, p2Hand - 1 + 2, "its controller draws 2");
  const mine = beatrixBoard({ bwController: P2, active: P1, tactics: ["c1"], hand: 3 });
  const p1Hand = handOf(mine.engine, P1).length;
  play(mine.engine, P1, mine.id("c1"));
  assert.equal(handOf(mine.engine, P1).length, p1Hand - 1 + 1, "its owner draws just 1");
});

clause(BEATRIX, "2:rule", "'you' is the Beatrix's controller for the cap too: a Beatrix P2 controls stops P2's draws at 10 cards and leaves its owner's draws alone", () => {
  const theirs = beatrixBoard({ bwController: P2, active: P2, oppHand: 12 });
  const p2Hand = handOf(theirs.engine, P2).length;
  play(theirs.engine, P2, theirs.id("oc1"));
  assert.equal(handOf(theirs.engine, P2).length, p2Hand - 1, "P2 has 11 cards left: it cannot draw");
  const mine = beatrixBoard({ bwController: P2, active: P1, tactics: ["c1"], hand: 12 });
  const p1Hand = handOf(mine.engine, P1).length;
  play(mine.engine, P1, mine.id("c1"));
  assert.equal(handOf(mine.engine, P1).length, p1Hand - 1 + 1, "its owner (not the controller) still draws, unincreased");
});

clause(BEATRIX, "1:rule", "no effect while Beatrix is not in play (in hand): a draw of 1 draws 1", () => {
  const b = beatrixBoard({ bw: "hand" });
  const hand = handOf(b.engine, P1).length;
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, hand + 1);
});

clause(BEATRIX, "1:rule", "the increase ends when Beatrix leaves play", () => {
  const b = beatrixBoard({ tactics: ["killer"], hand: 3 });
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("bw")] } });
  assert.equal(zoneOf(b.engine, b.id("bw")), "discard");
  const hand = handOf(b.engine, P1).length;
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, hand + 1, "back to drawing 1");
});

clause(BEATRIX, "1:rule", "a deck with fewer cards than the increased amount: you draw what is there and do not lose (CR 306.2)", () => {
  const b = beatrixBoard({ deck: 1 });
  const hand = handOf(b.engine, P1).length;
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, hand + 1, "only one card was available");
  assert.equal(deckOf(b.engine, P1).length, 0);
  assert.equal(b.engine.state.result ?? null, null);
});

clause(BEATRIX, "1:rule", "the increase is added to a draw that happens, including from an empty-handed turn start: the Develop draw gives 2 from a 0-card hand", () => {
  const b = beatrixBoard({ hand: 0, oppTactics: [], oppHand: 0 });
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, 2);
});

// --- "While you have at least 10 cards in your hand, you cannot draw cards."

clause(BEATRIX, "2:rule", "with exactly 10 cards in hand you cannot draw: the Develop Rule draw gives no card and the deck is unchanged", () => {
  const b = beatrixBoard({ hand: 10 });
  const deck = [...deckOf(b.engine, P1)];
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, 10, "no card drawn");
  assert.deepEqual(deckOf(b.engine, P1), deck, "the deck is untouched");
});

clause(BEATRIX, "2:rule", "with more than 10 cards in hand you still cannot draw", () => {
  const b = beatrixBoard({ hand: 14 });
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, 14);
  assert.equal(deckOf(b.engine, P1).length, 12);
});

clause(BEATRIX, "2:rule", "with 9 cards in hand you do draw: the increased draw of 2 brings you to 11 (the cap is checked when the draw happens, and a draw is a group, CR 306.3)", () => {
  const b = beatrixBoard({ hand: 9 });
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, 11, "2 cards were drawn");
});

clause(BEATRIX, "2:rule", "the count is taken when you would draw: playing a Draw-1 tactic from 11 cards leaves 10 and nothing is drawn; from 10 cards it leaves 9 and 2 are drawn", () => {
  const eleven = beatrixBoard({ hand: 11, tactics: ["c1"] });
  play(eleven.engine, P1, eleven.id("c1"));
  assert.equal(handOf(eleven.engine, P1).length, 10, "the tactic left; the draw was prevented");
  assert.equal(deckOf(eleven.engine, P1).length, 12);
  const ten = beatrixBoard({ hand: 10, tactics: ["c1"] });
  play(ten.engine, P1, ten.id("c1"));
  assert.equal(handOf(ten.engine, P1).length, 9 + 2, "9 cards left, so the (increased) draw of 2 happened");
});

clause(BEATRIX, "2:rule", "it stops applying as soon as your hand drops below 10: from 12 cards a Draw-1 is prevented, then two free plays leave 9 and the Develop draw works again", () => {
  const b = beatrixBoard({ hand: 12, tactics: ["c1"] });
  play(b.engine, P1, b.id("c1"));
  assert.equal(handOf(b.engine, P1).length, 11, "11 cards left: prevented");
  assert.equal(deckOf(b.engine, P1).length, 12);
  play(b.engine, P1, b.id("h0"));
  assert.equal(handOf(b.engine, P1).length, 10);
  play(b.engine, P1, b.id("h1"));
  assert.equal(handOf(b.engine, P1).length, 9);
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, 11, "9 cards: the increased draw of 2 happens");
});

clause(BEATRIX, "2:rule", "it only stops DRAWING: a search that puts a card into your hand still works with 10 or more cards in hand", () => {
  const b = beatrixBoard({ hand: 11, tactics: ["tutor"] });
  const hand = handOf(b.engine, P1).length;
  const target = deckOf(b.engine, P1)[4];
  play(b.engine, P1, b.id("tutor"), { selected: { t: [target] } });
  assert.equal(zoneOf(b.engine, target), "hand", "put into hand without drawing");
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1);
});

clause(BEATRIX, "2:rule", "it is YOUR hand that counts: the opponent holding 10+ cards does not stop your draws", () => {
  const b = beatrixBoard({ oppHand: 12 });
  const hand = handOf(b.engine, P1).length;
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, hand + 2, "still drawing (increased to 2)");
});

clause(BEATRIX, "2:rule", "and it only stops YOUR draws: with 10+ cards in your hand the opponent still draws normally", () => {
  const b = beatrixBoard({ hand: 12, active: P2 });
  const hand = handOf(b.engine, P2).length;
  play(b.engine, P2, b.id("oc1"));
  assert.equal(handOf(b.engine, P2).length, hand - 1 + 1, "the opponent drew exactly 1");
});

clause(BEATRIX, "2:rule", "no cap without Beatrix in play: with 12 cards in hand a Develop draw still draws 1", () => {
  const b = beatrixBoard({ bw: "hand", hand: 12 });
  const hand = handOf(b.engine, P1).length;
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, hand + 1);
});

clause(BEATRIX, "2:rule", "the cap also stops card-effect draws, whatever the amount: a 'draw 3' played from 12 cards (11 left, still 10 or more) draws nothing", () => {
  const b = beatrixBoard({ hand: 12, tactics: ["c3"] });
  play(b.engine, P1, b.id("c3"));
  assert.equal(handOf(b.engine, P1).length, 11, "the tactic left; nothing drawn");
  assert.equal(deckOf(b.engine, P1).length, 12);
});

clause(BEATRIX, "2:rule", "the cap ends when Beatrix leaves play: at 12 cards the draw works again", () => {
  const b = beatrixBoard({ hand: 12, tactics: ["killer"] });
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("bw")] } });
  const hand = handOf(b.engine, P1).length;
  developDrawFor(b.engine, P1);
  assert.equal(handOf(b.engine, P1).length, hand + 1, "no Beatrix: a normal draw of 1, even with a big hand");
});

// =============================================================================
// Brummagem Jewelry
// ATTACH TO CHARACTER
// When this card enters play, deplete the attached character.
// The attached character cannot be restored by its controller's faction's Restore Rule.
// Item (banker; gear), cost 3, threshold [G][G].
// =============================================================================

const JEWELRY = "78984e6e-5318-4665-9325-5e07897437fa";

function jewelryBoard(opts: { greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "res", def: resourceCard({ name: "Rage" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", 4, P1)
    ]
  });
}

type JewBoard = ReturnType<typeof jewelryBoard>;
const attachPlay = (b: JewBoard, hostKey: string) => play(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id(hostKey)] } });

clause(JEWELRY, "0:attach", "attaches to a character you control: it enters play attached to that character and the printed cost of 3 is paid", () => {
  const b = jewelryBoard();
  const before = ready(b.engine);
  attachPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(b.engine.state.cards[b.id("jew")].attachedTo, b.id("mine"), "attached to the picked character");
  assert.equal(before - ready(b.engine), 3, "the printed cost of 3 is paid");
  assert.equal(b.engine.state.cards[b.id("mine2")].attachedTo, undefined, "no other character gets it");
  assert.ok((b.engine.getDefinition(b.id("jew")).subtype ?? []).includes("gear"), "(b.engine.getDefinition(b.id(\"jew\")).subtype ?? []).includes(\"gear\")");
});

clause(JEWELRY, "0:attach", "attaches to an opponent's character too (ATTACH TO CHARACTER names no controller)", () => {
  const b = jewelryBoard();
  attachPlay(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(b.engine.state.cards[b.id("jew")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("jew")].controllerId, P1, "you still control the Jewelry");
});

clause(JEWELRY, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card, a resource", () => {
  const b = jewelryBoard();
  const attempt = (hostId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "your faction");
  refused(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource (CR 411.1)");
  refused(attempt(b.id("res")), "a resource");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand", "nothing was played");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "a character is accepted");
});

clause(JEWELRY, "0:attach", "is refused for a character that is not in play (in your hand or in a discard pile)", () => {
  const b = jewelryBoard();
  const attempt = (hostId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand");
});

clause(JEWELRY, "0:attach", "needs exactly one host: no pick and two picks are refused", () => {
  const b = jewelryBoard();
  refused(() => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [] } }), "no host picked");
  refused(() => playRaw(b.engine, P1, b.id("jew"), {}), "no selection at all");
  refused(() => playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id("mine"), b.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand");
});

clause(JEWELRY, "0:attach", "is refused one resource short of its cost of 3, and without [G][G] even with enough other resources", () => {
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" }, { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }, ...bank("greed", 2, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("jew"), { selected: { attachTo: [short.id("mine")] } }), "2 resources for a cost of 3");
  const noIcons = jewelryBoard({ greed: 1 });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("jew"), { selected: { attachTo: [noIcons.id("mine")] } }), "one [G] is not [G][G]");
  const exact = jewelryBoard({ greed: 2 });
  attachPlay(exact, "mine");
  assert.equal(zoneOf(exact.engine, exact.id("jew")), "play", "[G][G] plus other resources is enough");
});

clause(JEWELRY, "0:attach", "when the host is destroyed the Jewelry leaves play with it (to its owner's discard pile)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("jew")), "discard", "the attached card follows its host out of play (CR 301.4)");
});

clause(JEWELRY, "0:attach", "when the host returns to its owner's hand the Jewelry leaves play the same way: it goes to ITS OWNER's hand (CR 301.4a)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "foe" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(zoneOf(b.engine, b.id("jew")), "hand", "the Jewelry left play in the same way as its host: into its owner's hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("jew")), "handOf(b.engine, P1).includes(b.id(\"jew\"))");
});

clause(JEWELRY, "0:attach", "with no character in play there is no host to pick, so it cannot be deployed (CR 507.2a: picking the host is the first extra cost)", () => {
  const none = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  refused(() => playRaw(none.engine, P1, none.id("jew"), { selected: { attachTo: [] } }), "no character to attach to");
  assert.equal(zoneOf(none.engine, none.id("jew")), "hand");
  assert.equal(ready(none.engine), 3, "nothing was paid");
  const one = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" }, { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }, ...bank("greed", 3, P1)]
  });
  play(one.engine, P1, one.id("jew"), { selected: { attachTo: [one.id("c")] } });
  assert.equal(zoneOf(one.engine, one.id("jew")), "play", "control: with a character in play it deploys");
});

clause(JEWELRY, "0:attach", "put into play by an effect (not deployed) it still picks a host as it enters play (CR 507.2b), attaches to it and its enters-play trigger depletes the host", () => {
  const putter = tactic({
    name: "Putter",
    cost: 0,
    behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "item" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "put", def: putter, owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
    ]
  });
  play(b.engine, P1, b.id("put"), { selected: { t: [b.id("jew")] } });
  assert.ok(pending(b.engine), "the Jewelry asks for a host as it enters play");
  assert.notEqual(zoneOf(b.engine, b.id("jew")), "discard", "it was not simply put into the discard pile");
});

clause(JEWELRY, "0:attach", "when the host is no longer a character the Jewelry is flipped face-down with it", () => {
  const loseType = tactic({
    name: "Rename",
    cost: 0,
    behavior: { abilities: [{ id: "n", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "flip", def: loseType, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("flip"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("jew")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(b.engine.state.cards[b.id("jew")].faceDown, true, "...and is flipped face-down along with its host");
});

clause(JEWELRY, "1:rule", "when it enters play the attached character of yours is depleted, and no other character is", () => {
  const b = jewelryBoard();
  attachPlay(b, "mine");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "the attached character is depleted");
  assert.equal(isDepleted(b.engine, b.id("mine2")), false, "another of your characters is not");
  assert.equal(isDepleted(b.engine, b.id("foe")), false, "an opponent's character is not");
});

clause(JEWELRY, "1:rule", "it depletes an opponent's character just as well when that is the attached character", () => {
  const b = jewelryBoard();
  attachPlay(b, "foe");
  assert.equal(isDepleted(b.engine, b.id("foe")), true);
  assert.equal(isDepleted(b.engine, b.id("mine")), false);
  assert.equal(isDepleted(b.engine, b.id("mine2")), false);
});

clause(JEWELRY, "1:rule", "the depletion happens when it ENTERS play, not while it is still waiting for responses", () => {
  const b = jewelryBoard();
  playRaw(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("jew")), "deploying", "still being deployed, the opponent may respond");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "not depleted yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "depleted once it has entered play");
});

clause(JEWELRY, "1:rule", "an already depleted attached character simply stays depleted", () => {
  const b = jewelryBoard();
  b.engine.state.cards[b.id("mine")].depleted = true;
  attachPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
});

clause(JEWELRY, "1:rule", "it only fires for the Jewelry entering play: a second Jewelry going on another character does not deplete the first one's host", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew1", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "jew2", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: false },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "control: a Jewelry placed directly into play has not triggered");
  play(b.engine, P1, b.id("jew2"), { selected: { attachTo: [b.id("mine2")] } });
  assert.equal(isDepleted(b.engine, b.id("mine2")), true, "the new Jewelry depletes its own host");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "the first Jewelry's host is unaffected by the second Jewelry entering play");
});

clause(JEWELRY, "1:rule", "a depleted character cannot be declared as an attacker (so the deplete is real)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  play(b.engine, P1, b.id("jew"), { selected: { attachTo: [b.id("mine")] } });
  refused(() => declareAttackBy(b.engine, P1, [b.id("mine")]), "the depleted host cannot attack");
  declareAttackBy(b.engine, P1, [b.id("mine2")]);
  assert.ok(battleOf(b.engine), "the other character still can");
});

/** A character with a free ability that restores itself (id `refresh`). */
function refresher(name = "Refresher"): Def {
  return character({
    name,
    behavior: { abilities: [{ id: "refresh", type: "activated", costs: [], effects: [{ type: "restore", target: "source" }] }] }
  });
}

/** P1's character `mine` carries the Jewelry and is depleted; `plain` is depleted with no Jewelry. P1 and P2 each also own a depleted character. */
function restoreBoard(jewelryController: Pid = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: jewelryController, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", depleted: true },
      { key: "foePlain", def: character({ name: "FoePlain" }), owner: P2, zone: "play", depleted: true },
      { key: "foeJew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "foe" }
    ]
  });
}

clause(JEWELRY, "2:rule", "the attached character is not restored by its controller's faction at the start of that player's turn, while an ordinary depleted character is", () => {
  const b = restoreBoard();
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "the attached character stays depleted through its restore");
  assert.equal(isDepleted(b.engine, b.id("plain")), false, "control: the ordinary depleted character is restored");
});

clause(JEWELRY, "2:rule", "an opponent's attached character is not restored at its controller's turn either", () => {
  const b = restoreBoard();
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(b.engine, b.id("foe")), true, "the attached opponent character stays depleted");
  assert.equal(isDepleted(b.engine, b.id("foePlain")), false, "control: the opponent's ordinary depleted character is restored");
});

clause(JEWELRY, "2:rule", "it makes no difference who controls the Jewelry: an opponent's Jewelry on my character blocks my restore too", () => {
  const b = restoreBoard(P2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
  assert.equal(isDepleted(b.engine, b.id("plain")), false);
});

clause(JEWELRY, "2:rule", "it stays depleted turn after turn while the Jewelry is attached", () => {
  const b = restoreBoard();
  for (let i = 0; i < 2; i++) {
    endTurn(b.engine, P1);
    endTurn(b.engine, P2);
  }
  assert.equal(b.engine.state.turn, 1 + 2 * b.engine.state.turnOrder.length, "two rounds of the table later");
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
});

clause(JEWELRY, "2:rule", "only the faction's RESTORE RULE is blocked: a restore from another source still restores the attached character", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: refresher("Mine"), owner: P1, zone: "play", depleted: true }
    ]
  });
  activate(b.engine, P1, b.id("mine"), "refresh");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "restored by its own effect while the Jewelry is attached");
  assert.equal(zoneOf(b.engine, b.id("jew")), "play");
});

clause(JEWELRY, "2:rule", "once the Jewelry has left play the character is restored by the next restore rule again", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "jew", def: printing(JEWELRY), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "killer", def: destroyItemTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("killer"), { selected: { t: [b.id("jew")] } });
  assert.equal(zoneOf(b.engine, b.id("jew")), "discard");
  assert.equal(isDepleted(b.engine, b.id("mine")), true, "still depleted right after");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "no Jewelry, no lock: the restore rule restores it");
});

clause(JEWELRY, "2:rule", "the lock does not carry over to the Jewelry controller's other characters", () => {
  const b = restoreBoard();
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("plain")), false);
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
  assert.equal(isDepleted(b.engine, b.id("foe")), true, "the Jewelry on the opponent's character is a different lock");
});

// =============================================================================
// Cash Out
// COST: Choose a number for X. Pay X+X.
// EFFECT: Draw X+1 cards.
// Tactic (banker), cost 0, threshold [G][G][G].
// =============================================================================

const CASH_OUT = "0cd52486-40a8-407e-a004-de96c2c13f03";

function cashOutBoard(opts: { greed?: number; other?: number; deck?: number; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" },
      ...fillers("d", opts.deck ?? 10, P1, "deck"),
      ...fillers("e", 10, P2, "deck"),
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", opts.other ?? 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

for (const x of [0, 1, 2, 3, 4]) {
  clause(CASH_OUT, "0:ability", `X=${x}: pays X+X (${2 * x}) and draws X+1 (${x + 1}) cards from the top of the deck`, () => {
    const b = cashOutBoard();
    const before = ready(b.engine);
    const deckBefore = [...deckOf(b.engine, P1)];
    const oppDeck = [...deckOf(b.engine, P2)];
    const handBefore = handOf(b.engine, P1).length;
    play(b.engine, P1, b.id("co"), { variables: { x } });
    assert.equal(before - ready(b.engine), 2 * x, "pays X+X (the printed cost is 0)");
    assert.equal(handOf(b.engine, P1).length, handBefore - 1 + (x + 1), `Cash Out left the hand and ${x + 1} cards arrived`);
    for (const cardId of deckBefore.slice(0, x + 1)) assert.equal(zoneOf(b.engine, cardId), "hand", "the top cards were drawn");
    assert.deepEqual(deckOf(b.engine, P1), deckBefore.slice(x + 1), "and nothing else left the deck");
    assert.deepEqual(deckOf(b.engine, P2), oppDeck, "the opponent's deck is untouched");
    assert.equal(zoneOf(b.engine, b.id("co")), "discard");
  });
}

clause(CASH_OUT, "0:ability", "the cards are drawn as one group (CR 306.3): a single draw event for X+1 cards", () => {
  const b = cashOutBoard();
  play(b.engine, P1, b.id("co"), { variables: { x: 2 } });
  const draws = b.engine.getLog().filter((entry) => entry.event?.type === "cardsDrawn");
  assert.equal(draws.length, 1, "one draw event");
  assert.equal((draws[0].event as unknown as { count: number }).count, 3);
});

clause(CASH_OUT, "0:ability", "the numeric cost is paid by attaching resources to your faction (X=3 attaches 6)", () => {
  const b = cashOutBoard({ greed: 3, other: 8 });
  play(b.engine, P1, b.id("co"), { variables: { x: 3 } });
  const attached = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === factionOf(b.engine, P1));
  assert.equal(attached.length, 6);
});

clause(CASH_OUT, "0:ability", "X can be 0: it is free to pay (but still needs [G][G][G]) and draws exactly 1 card", () => {
  const b = cashOutBoard({ greed: 3, other: 0 });
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("co"), { variables: { x: 0 } });
  assert.equal(ready(b.engine), 3, "nothing was paid");
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(handOf(b.engine, P1).length, 1);
});

clause(CASH_OUT, "0:ability", "cannot pay X+X without the resources: X=2 needs 4 (3 refused, 4 allowed)", () => {
  const three = cashOutBoard({ greed: 3, other: 0 });
  refused(() => playRaw(three.engine, P1, three.id("co"), { variables: { x: 2 } }), "3 resources for X=2");
  assert.equal(zoneOf(three.engine, three.id("co")), "hand");
  assert.equal(ready(three.engine), 3, "nothing spent");
  playRaw(three.engine, P1, three.id("co"), { variables: { x: 1 } });
  assert.ok(three.engine.state.responseWindow, "X=1 (2 resources) works");
  const four = cashOutBoard({ greed: 3, other: 1 });
  play(four.engine, P1, four.id("co"), { variables: { x: 2 } });
  assert.equal(ready(four.engine), 0, "exactly 4 resources pays for X=2");
  assert.equal(handOf(four.engine, P1).length, 3);
});

clause(CASH_OUT, "0:ability", "needs [G][G][G] even when the cost is 0: two [G] and plenty of other resources are not enough", () => {
  const two = cashOutBoard({ greed: 2, other: 8 });
  refused(() => playRaw(two.engine, P1, two.id("co"), { variables: { x: 0 } }), "X=0 with two [G]");
  refused(() => playRaw(two.engine, P1, two.id("co"), { variables: { x: 2 } }), "X=2 with two [G]");
  assert.equal(two.engine.getCardPlayability(P1, two.id("co")).playable, false);
  const three = cashOutBoard({ greed: 3, other: 0 });
  assert.equal(three.engine.getCardPlayability(P1, three.id("co")).playable, true);
});

clause(CASH_OUT, "0:ability", "X cannot be negative", () => {
  const b = cashOutBoard();
  refused(() => playRaw(b.engine, P1, b.id("co"), { variables: { x: -1 } }), "X = -1");
  assert.equal(zoneOf(b.engine, b.id("co")), "hand");
  assert.equal(ready(b.engine), 11);
});

clause(CASH_OUT, "0:ability", "X is a whole number: 1.5 is refused (CR 410.2) and spends nothing", () => {
  const b = cashOutBoard();
  refused(() => playRaw(b.engine, P1, b.id("co"), { variables: { x: 1.5 } }), "X = 1.5");
  assert.equal(zoneOf(b.engine, b.id("co")), "hand");
  assert.equal(ready(b.engine), 11, "nothing was spent");
});

clause(CASH_OUT, "0:ability", "a deck with fewer cards than X+1: you draw what exists and the tactic still resolves (CR 306.2)", () => {
  const b = cashOutBoard({ deck: 2 });
  const deckBefore = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("co"), { variables: { x: 3 } });
  for (const cardId of deckBefore) assert.equal(zoneOf(b.engine, cardId), "hand");
  assert.equal(deckOf(b.engine, P1).length, 0);
  assert.equal(zoneOf(b.engine, b.id("co")), "discard");
  assert.equal(b.engine.state.result, undefined, "running out of cards does not lose the game");
});

clause(CASH_OUT, "0:ability", "the cost is paid when it is played; the draw happens when it resolves, after the opponent may respond", () => {
  const b = cashOutBoard();
  const before = ready(b.engine);
  const handBefore = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("co"), { variables: { x: 2 } });
  assert.equal(before - ready(b.engine), 4);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "nothing drawn yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, handBefore - 1 + 3);
});

clause(CASH_OUT, "0:ability", "can be played in response (it is a tactic), e.g. to the opponent's attack", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" },
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...bank("greed", 3, P1)
    ]
  });
  refused(() => playRaw(b.engine, P1, b.id("co"), { variables: { x: 0 } }), "nothing to respond to");
  openWindowOnP2Attack(b.engine, b.id("attacker"));
  playRaw(b.engine, P1, b.id("co"), { variables: { x: 0 } });
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, 1);
});

clause(CASH_OUT, "0:ability", "'you' is the caster: P2 casting it draws for P2 only", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "co", def: printing(CASH_OUT), owner: P2, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("greed", 5, P2)
    ]
  });
  play(b.engine, P2, b.id("co"), { variables: { x: 1 } });
  assert.equal(handOf(b.engine, P2).length, 2);
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.equal(deckOf(b.engine, P1).length, 4);
});

// =============================================================================
// Class Action Defender
// If any amount of damage greater than 4 is inflicted to this card, reduce it to 0.
// If you are attacked, you may pay 2. If you do, restore this card.
// Character (banker; lawyer, mau), cost 3, threshold [G][G][G], 2 strength / 3 speed / 3 life.
// =============================================================================

const DEFENDER = "eed5d438-3d82-49e5-a873-f8deb2ee42f1";

/** A gear item that adds `amount` life to the attached character (to make a Defender able to absorb real damage). */
function lifeBoost(amount: number): Def {
  return item({
    name: `LifeBoost${amount}`,
    attachTo: "character",
    behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: amount }] }] }
  });
}

/** An item that draws its controller a card whenever any damage is inflicted (a witness for 'damage was inflicted'). */
function damageWitness(): Def {
  return item({
    name: "Witness",
    behavior: { abilities: [{ id: "saw", type: "triggered", event: "damageDealt", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
}

function defenderBoard(opts: { boost?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "cad", def: printing(DEFENDER), owner: P1, zone: "play" },
      ...(opts.boost ? [{ key: "boost", def: lifeBoost(opts.boost), owner: P1, zone: "play" as const, attachedToKey: "cad" }] : []),
      { key: "ally", def: character({ name: "Ally", life: 20 }), owner: P1, zone: "play" },
      { key: "witness", def: damageWitness(), owner: P1, zone: "play" },
      ...fillers("d", 6, P1, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;

/** A whole battle where the attacker's damage goes where `pickTarget` says. */
function fightAssign(
  engine: SpoilsEngine,
  attacker: Pid,
  attackers: CardInstanceId[],
  target: { type: "faction"; playerId: Pid } | { type: "card"; cardId: CardInstanceId },
  blockers: CardInstanceId[],
  pickTarget: (source: { cardId: CardInstanceId }) => CardInstanceId | "faction" | undefined
): void {
  declareAttackBy(engine, attacker, attackers, target);
  engine.perform({ type: "declareBlockers", playerId: other(attacker), blockerIds: blockers });
  autoResolveBattle(engine, (source) => {
    if (source.strength <= 0 || source.legalTargets.length === 0) return [];
    const owner = engine.state.cards[source.cardId].controllerId;
    const picked = owner === attacker ? pickTarget(source) : undefined;
    if (picked === undefined) return [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }];
    const to = picked === "faction" ? { type: "faction" as const, playerId: other(attacker) } : { type: "card" as const, cardId: picked };
    return [{ sourceId: source.cardId, target: to, amount: source.strength }];
  });
}

const DAMAGE_ON_DEFENDER: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [5, 0],
  [6, 0],
  [9, 0],
  [100, 0]
];

clause(DEFENDER, "0:rule", "the card itself: costs 3 with [G][G][G]; 2 strength / 3 speed / 3 life; a banker lawyer mau", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "cad", def: printing(DEFENDER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("cad"));
  assert.equal(zoneOf(exact.engine, exact.id("cad")), "play");
  assert.equal(before - ready(exact.engine), 3);
  assert.deepEqual(stats(exact.engine, exact.id("cad")), [2, 3, 3]);
  assert.deepEqual(sorted(exact.engine.getDefinition(exact.id("cad")).subtype ?? []), ["lawyer", "mau"]);
  const short = buildGame({
    playerA: { faction: developFaction() },
    // [G][G][G] met by three already-spent Greed, but only two ready resources for the cost of 3
    cards: [{ key: "cad", def: printing(DEFENDER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 2, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("cad")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  const twoG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "cad", def: printing(DEFENDER), owner: P1, zone: "hand" }, ...bank("greed", 2, P1), ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(twoG.engine, P1, twoG.id("cad")), "only two [G] of the three");
  assert.equal(zoneOf(twoG.engine, twoG.id("cad")), "hand");
});

for (const [amount, expected] of DAMAGE_ON_DEFENDER) {
  clause(DEFENDER, "0:rule", `a damage tactic of ${amount} on a Defender with 20 life: ${expected === 0 ? "reduced to 0 (greater than 4)" : `${expected} damage is inflicted (4 or less)`}`, () => {
    const b = defenderBoard({ boost: 17, extra: [{ key: "zap", def: damageTactic(amount), owner: P1, zone: "hand" }] });
    assert.equal(b.engine.getStat(b.id("cad"), "life"), 20);
    play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("cad")] } });
    assert.equal(damageOf(b.engine, b.id("cad")), expected);
    assert.equal(zoneOf(b.engine, b.id("cad")), "play");
  });
}

clause(DEFENDER, "0:rule", "an Ally with the same 20 life takes the full 9 damage: only this card has the clause", () => {
  const b = defenderBoard({ extra: [{ key: "zap", def: damageTactic(9), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("ally")] } });
  assert.equal(damageOf(b.engine, b.id("ally")), 9);
});

clause(DEFENDER, "0:rule", "damage of 4 or less is inflicted and destroys a plain 3-life Defender; damage over 4 does not (a 3-life Defender survives 5)", () => {
  const four = defenderBoard({ extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  play(four.engine, P1, four.id("zap"), { selected: { t: [four.id("cad")] } });
  assert.equal(zoneOf(four.engine, four.id("cad")), "discard", "4 damage destroys the 3-life Defender");
  const five = defenderBoard({ extra: [{ key: "zap", def: damageTactic(5), owner: P1, zone: "hand" }] });
  play(five.engine, P1, five.id("zap"), { selected: { t: [five.id("cad")] } });
  assert.equal(zoneOf(five.engine, five.id("cad")), "play", "5 damage is reduced to 0: the Defender survives");
  assert.equal(damageOf(five.engine, five.id("cad")), 0);
});

clause(DEFENDER, "0:rule", "damage from the OPPONENT'S tactic is reduced too ('any amount of damage')", () => {
  const b = defenderBoard({ turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(7), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("zap"), { selected: { t: [b.id("cad")] } });
  assert.equal(zoneOf(b.engine, b.id("cad")), "play");
  assert.equal(damageOf(b.engine, b.id("cad")), 0);
});

clause(DEFENDER, "0:rule", "damage reduced to 0 inflicts nothing (CR 408.2a), so nothing triggers off it: the witness sees 4 damage but not 5", () => {
  const four = defenderBoard({ boost: 17, extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  const deckBefore = deckOf(four.engine, P1).length;
  play(four.engine, P1, four.id("zap"), { selected: { t: [four.id("cad")] } });
  assert.equal(deckBefore - deckOf(four.engine, P1).length, 1, "control: the witness triggered on 4 damage");
  const five = defenderBoard({ boost: 17, extra: [{ key: "zap", def: damageTactic(5), owner: P1, zone: "hand" }] });
  play(five.engine, P1, five.id("zap"), { selected: { t: [five.id("cad")] } });
  assert.equal(deckOf(five.engine, P1).length, 6, "5 damage was reduced to 0: no damage, no trigger");
});

clause(DEFENDER, "0:rule", "battle damage over 4 from one attacker is reduced to 0 (5 strength)", () => {
  const b = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightAssign(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("cad")], () => b.id("cad"));
  assert.equal(damageOf(b.engine, b.id("cad")), 0, "5 battle damage inflicts nothing");
  assert.equal(zoneOf(b.engine, b.id("cad")), "play");
  assert.equal(damageOf(b.engine, b.id("atk")), 2, "the Defender still deals its 2 strength");
});

clause(DEFENDER, "0:rule", "battle damage of exactly 4 is inflicted", () => {
  const b = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightAssign(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("cad")], () => b.id("cad"));
  assert.equal(damageOf(b.engine, b.id("cad")), 4);
});

clause(DEFENDER, "0:rule", "damage from several characters in one step is summed first (CR 609.1f): 3 + 3 = 6 is more than 4 and is reduced to 0", () => {
  const b = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [
      { key: "a1", def: character({ name: "A1", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  fightAssign(b.engine, P2, [b.id("a1"), b.id("a2")], { type: "faction", playerId: P1 }, [b.id("cad")], () => b.id("cad"));
  assert.equal(damageOf(b.engine, b.id("cad")), 0, "the single combined amount of 6 is reduced");
});

clause(DEFENDER, "0:rule", "damage from several characters in one step is summed first: 2 + 2 = 4 is inflicted in full", () => {
  const b = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [
      { key: "a1", def: character({ name: "A1", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  fightAssign(b.engine, P2, [b.id("a1"), b.id("a2")], { type: "faction", playerId: P1 }, [b.id("cad")], () => b.id("cad"));
  assert.equal(damageOf(b.engine, b.id("cad")), 4);
});

clause(DEFENDER, "0:rule", "each damage instance is judged on its own: instances of 3 and 3 in different speed steps (6 in all) are both inflicted", () => {
  const b = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [
      { key: "fast", def: character({ name: "Fast", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "slow", def: character({ name: "Slow", strength: 3, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  fightAssign(b.engine, P2, [b.id("fast"), b.id("slow")], { type: "faction", playerId: P1 }, [b.id("cad")], () => b.id("cad"));
  assert.equal(damageOf(b.engine, b.id("cad")), 6, "two separate instances of 3 (each 4 or less)");
});

clause(DEFENDER, "0:rule", "damage greater than 4 across two separate tactics is judged per instance: 3 then 3 inflicts 6 in total", () => {
  const b = defenderBoard({ boost: 17, extra: [{ key: "z1", def: damageTactic(3), owner: P1, zone: "hand" }, { key: "z2", def: damageTactic(3), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("z1"), { selected: { t: [b.id("cad")] } });
  play(b.engine, P1, b.id("z2"), { selected: { t: [b.id("cad")] } });
  assert.equal(damageOf(b.engine, b.id("cad")), 6);
});

clause(DEFENDER, "0:rule", "a Defender that is attacking is protected as well", () => {
  const b = defenderBoard({
    boost: 17,
    turn: 1,
    active: P1,
    extra: [{ key: "blk", def: character({ name: "Blocker", strength: 6, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightAssign(b.engine, P1, [b.id("cad")], { type: "faction", playerId: P2 }, [b.id("blk")], () => b.id("blk"));
  assert.equal(damageOf(b.engine, b.id("cad")), 0, "6 battle damage from the blocker is reduced to 0");
  assert.equal(damageOf(b.engine, b.id("blk")), 2);
});

clause(DEFENDER, "0:rule", "the reduction is the card's own: an opposing Defender protects only itself", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cad", def: printing(DEFENDER), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 20 }), owner: P2, zone: "play" },
      { key: "zap", def: damageTactic(6), owner: P1, zone: "hand" },
      { key: "zap2", def: damageTactic(6), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("foe")] } });
  assert.equal(damageOf(b.engine, b.id("foe")), 6, "the neighbour takes the full damage");
  play(b.engine, P1, b.id("zap2"), { selected: { t: [b.id("cad")] } });
  assert.equal(damageOf(b.engine, b.id("cad")), 0);
});

// -- If you are attacked, you may pay 2. If you do, restore this card. ---------------

function braceBoard(opts: { resources?: number; depleted?: boolean; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "cad", def: printing(DEFENDER), owner: P1, zone: "play", depleted: opts.depleted ?? true },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "MyLoc", structure: 9 }), owner: P1, zone: "play" },
      ...bank("greed", opts.resources ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(DEFENDER, "1:rule", "when my faction is attacked I may pay 2: paying restores the depleted Defender", () => {
  const b = braceBoard();
  assert.equal(isDepleted(b.engine, b.id("cad")), true);
  const before = ready(b.engine);
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay", "I am offered the payment");
  assert.equal(pc?.playerId, P1, "the Defender's controller decides");
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(isDepleted(b.engine, b.id("cad")), false, "restored");
  assert.equal(before - ready(b.engine), 2, "exactly 2 resources paid");
});

clause(DEFENDER, "1:rule", "declining the payment: nothing is paid and the Defender stays depleted", () => {
  const b = braceBoard();
  const before = ready(b.engine);
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  assert.equal(pending(b.engine)?.kind, "mayPay");
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(isDepleted(b.engine, b.id("cad")), true, "'If you do, restore': not paying means not restoring");
  assert.equal(ready(b.engine), before, "no resource was spent");
});

clause(DEFENDER, "1:rule", "a restored Defender can block the attack; a declined one (still depleted) cannot", () => {
  const paid = braceBoard();
  declareAttackBy(paid.engine, P2, [paid.id("atk")], { type: "faction", playerId: P1 });
  if (pending(paid.engine)) answerPending(paid.engine, "mayPay", { pay: true });
  resolvePendingResponses(paid.engine);
  paid.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [paid.id("cad")] });
  assert.deepEqual(battleOf(paid.engine)?.blockingParty, [paid.id("cad")], "restored: it blocks");
  const declined = braceBoard();
  declareAttackBy(declined.engine, P2, [declined.id("atk")], { type: "faction", playerId: P1 });
  if (pending(declined.engine)) answerPending(declined.engine, "mayPay", { pay: false });
  resolvePendingResponses(declined.engine);
  refused(() => declined.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [declined.id("cad")] }), "depleted: it cannot block");
});

clause(DEFENDER, "1:rule", "'attacked' includes an attack on a location I control (CR 302.2: being attacked means a faction or location they control is the target)", () => {
  const b = braceBoard();
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "card", cardId: b.id("loc") } });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay", "an attack on my location also offers the payment");
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(isDepleted(b.engine, b.id("cad")), false);
});

clause(DEFENDER, "1:rule", "with only 1 ready resource I cannot pay 2: the Defender stays depleted and nothing is spent", () => {
  const b = braceBoard({ resources: 1 });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  if (pending(b.engine)) {
    refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } } as never), "cannot pay 2 with 1 resource");
    answerPending(b.engine, "mayPay", { pay: false });
  }
  assert.equal(isDepleted(b.engine, b.id("cad")), true);
  assert.equal(ready(b.engine), 1);
});

clause(DEFENDER, "1:rule", "exactly 2 ready resources is enough", () => {
  const b = braceBoard({ resources: 2 });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(isDepleted(b.engine, b.id("cad")), false);
  assert.equal(ready(b.engine), 0);
});

clause(DEFENDER, "1:rule", "'If you are attacked' happens once per attack, not once per attacker: a party of two attackers offers the payment exactly once", () => {
  const b = braceBoard({ resources: 4, extra: [{ key: "atk2", def: character({ name: "Attacker2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk"), b.id("atk2")], target: { type: "faction", playerId: P1 } });
  let offers = 0;
  drain(b.engine, (pc) => {
    if (pc.kind === "mayPay") {
      offers++;
      return { kind: "mayPay", pay: true };
    }
    return declineAll(pc);
  });
  assert.equal(offers, 1, "one attack, one offer");
  assert.equal(isDepleted(b.engine, b.id("cad")), false);
  assert.equal(ready(b.engine), 2, "2 of the 4 resources were paid");
});

clause(DEFENDER, "1:rule", "an undepleted Defender has nothing to restore: declining (if asked) costs nothing and it stays ready", () => {
  const b = braceBoard({ depleted: false });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  if (pending(b.engine)) answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(isDepleted(b.engine, b.id("cad")), false);
  assert.equal(ready(b.engine), 3);
});

clause(DEFENDER, "1:rule", "when I attack, nobody is 'attacked' on my side: the Defender does not offer the payment", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "cad", def: printing(DEFENDER), owner: P1, zone: "play", depleted: true },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P2 } });
  assert.equal(pending(b.engine), undefined, "no offer");
  resolvePendingResponses(b.engine);
  assert.equal(isDepleted(b.engine, b.id("cad")), true);
  assert.equal(ready(b.engine), 3);
});

clause(DEFENDER, "1:rule", "the opponent's Defender reacts when I attack THEM: the offer goes to its controller", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "cad", def: printing(DEFENDER), owner: P2, zone: "play", depleted: true },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      ...bank("greed", 3, P2)
    ]
  });
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P2 } });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "P2 controls the Defender");
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(isDepleted(b.engine, b.id("cad")), false);
  assert.equal(ready(b.engine, P2), 1, "P2 paid 2 of 3");
  assert.equal(ready(b.engine, P1), 0);
});

clause(DEFENDER, "1:rule", "two Defenders each offer the payment: paying for both costs 4 and restores both", () => {
  const b = braceBoard({ resources: 4, extra: [{ key: "cad2", def: printing(DEFENDER), owner: P1, zone: "play", depleted: true }] });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  let answered = 0;
  drain(b.engine, (pc) => {
    if (pc.kind === "mayPay") {
      answered++;
      return { kind: "mayPay", pay: true };
    }
    return declineAll(pc);
  });
  assert.equal(answered, 2, "one offer per Defender");
  assert.equal(isDepleted(b.engine, b.id("cad")), false);
  assert.equal(isDepleted(b.engine, b.id("cad2")), false);
  assert.equal(ready(b.engine), 0, "2 + 2 resources paid");
});

clause(DEFENDER, "1:rule", "every attack on me offers it again (a second battle in the same turn)", () => {
  const b = braceBoard({ resources: 4, extra: [{ key: "atk2", def: character({ name: "Attacker2", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackBy(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 });
  if (pending(b.engine)) answerPending(b.engine, "mayPay", { pay: true });
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(b.engine);
  b.engine.state.cards[b.id("cad")].depleted = true;
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk2")], target: { type: "faction", playerId: P1 } });
  assert.equal(pending(b.engine)?.kind, "mayPay", "the second attack offers the payment again");
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(isDepleted(b.engine, b.id("cad")), false);
  assert.equal(ready(b.engine), 0);
});

clause(DEFENDER, "1:rule", "a Defender in hand does not react to an attack", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cad", def: printing(DEFENDER), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "faction", playerId: P1 } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b.engine), 3);
});

// =============================================================================
// Downsizing
// Destroy all characters. Your opponent's faction gains X influence, where X is the
// number of characters destroyed this way.
// Tactic (banker), cost 10, threshold [G][G][G][G].
// =============================================================================

const DOWNSIZING = "040213b2-7931-48c4-bf89-f8d45eaa98be";

function downsizingBoard(o: { mine?: number; theirs?: number; greed?: number; rage?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "ds", def: printing(DOWNSIZING), owner: P1, zone: "hand" },
      ...fillers("m", o.mine ?? 2, P1, "play"),
      ...fillers("t", o.theirs ?? 3, P2, "play"),
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      { key: "myPlace", def: location({ name: "MyPlace" }), owner: P1, zone: "play" },
      { key: "theirPlace", def: location({ name: "TheirPlace" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "myHidden", def: character({ name: "MyHidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "oppRes", def: resourceCard({ name: "Rage" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...bank("greed", o.greed ?? 10, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

clause(DOWNSIZING, "0:rule", "destroys every character: yours and your opponent's, ready and depleted, damaged or not", () => {
  const b = downsizingBoard();
  b.engine.state.cards[b.id("m0")].depleted = true;
  b.engine.state.cards[b.id("t1")].damage = 1;
  play(b.engine, P1, b.id("ds"));
  for (const key of ["m0", "m1", "t0", "t1", "t2"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was destroyed`);
});

clause(DOWNSIZING, "0:rule", "each destroyed character goes to its OWNER's discard pile", () => {
  const b = downsizingBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  play(b.engine, P1, b.id("ds"));
  assert.ok(discardOf(b.engine, P2).includes(b.id("stolen")), "a character P1 controls but P2 owns goes to P2's discard pile");
  assert.ok(discardOf(b.engine, P2).includes(b.id("t0")), "discardOf(b.engine, P2).includes(b.id(\"t0\"))");
  assert.ok(discardOf(b.engine, P1).includes(b.id("m0")), "discardOf(b.engine, P1).includes(b.id(\"m0\"))");
});

clause(DOWNSIZING, "0:rule", "it destroys only characters: items, locations, face-down cards, resources and cards in hand or discard are untouched", () => {
  const b = downsizingBoard();
  play(b.engine, P1, b.id("ds"));
  for (const key of ["myItem", "theirItem", "myPlace", "theirPlace", "hidden", "myHidden", "oppRes"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} stays in play`);
  assert.equal(zoneOf(b.engine, b.id("inHand")), "hand");
  assert.equal(zoneOf(b.engine, b.id("inDiscard")), "discard");
  assert.equal(b.engine.state.cards[b.id("hidden")].faceDown, true, "face-down cards stay face-down");
  assert.equal(zoneOf(b.engine, factionOf(b.engine, P1)), "play");
  assert.equal(zoneOf(b.engine, factionOf(b.engine, P2)), "play");
});

for (const [mine, theirs] of [
  [2, 3],
  [0, 4],
  [3, 0],
  [1, 1]
] as const) {
  clause(DOWNSIZING, "0:rule", `${mine} of your characters and ${theirs} of theirs: your opponent's faction gains ${mine + theirs} (the number destroyed), yours gains nothing`, () => {
    const b = downsizingBoard({ mine, theirs });
    play(b.engine, P1, b.id("ds"));
    assert.equal(influence(b.engine, P2), 20 + mine + theirs, "X counts every destroyed character, whoever controlled it");
    assert.equal(influence(b.engine, P1), 20, "your own faction gains nothing");
    assert.equal(zoneOf(b.engine, b.id("ds")), "discard", "the tactic ends in your discard pile");
  });
}

clause(DOWNSIZING, "0:rule", "with no characters in play nothing is destroyed and X is 0", () => {
  const b = downsizingBoard({ mine: 0, theirs: 0 });
  play(b.engine, P1, b.id("ds"));
  assert.equal(influence(b.engine, P2), 20);
  assert.equal(influence(b.engine, P1), 20);
  assert.equal(zoneOf(b.engine, b.id("ds")), "discard");
});

clause(DOWNSIZING, "0:rule", "face-down cards are not characters and do not count towards X", () => {
  const b = downsizingBoard({ mine: 1, theirs: 1 });
  play(b.engine, P1, b.id("ds"));
  assert.equal(influence(b.engine, P2), 22, "2 characters destroyed; the 2 face-down cards do not count");
});

clause(DOWNSIZING, "0:rule", "'your opponent' is relative to the caster: P2 casting it makes P1's faction gain X", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ds", def: printing(DOWNSIZING), owner: P2, zone: "hand" },
      ...fillers("m", 2, P1, "play"),
      ...fillers("t", 1, P2, "play"),
      ...bank("greed", 10, P2)
    ]
  });
  play(b.engine, P2, b.id("ds"));
  assert.equal(influence(b.engine, P1), 23, "P1 (the opponent of the caster) gained 3");
  assert.equal(influence(b.engine, P2), 20);
});

clause(DOWNSIZING, "0:rule", "X is the number of characters actually destroyed: if nothing can be destroyed this turn, the opponent gains nothing", () => {
  const noDestroy = tactic({
    name: "NoDestroy",
    cost: 0,
    behavior: { abilities: [{ id: "nd", type: "activated", effects: [{ type: "restrictDestruction", duration: { type: "untilEndOfTurn" } }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "ds", def: printing(DOWNSIZING), owner: P1, zone: "hand" },
      { key: "nd", def: noDestroy, owner: P1, zone: "hand" },
      ...fillers("m", 2, P1, "play"),
      ...fillers("t", 3, P2, "play"),
      ...bank("greed", 10, P1)
    ]
  });
  play(b.engine, P1, b.id("nd"));
  play(b.engine, P1, b.id("ds"));
  for (const key of ["m0", "m1", "t0", "t1", "t2"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} could not be destroyed`);
  assert.equal(influence(b.engine, P2), 20, "no characters were destroyed, so X is 0");
});

clause(DOWNSIZING, "0:rule", "the card itself: pays the printed cost of 10", () => {
  const b = downsizingBoard({ greed: 12 });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("ds"));
  assert.equal(before - ready(b.engine), 10, "exactly the printed cost is paid, no more");
});

clause(DOWNSIZING, "0:rule", "is refused one resource short of its cost of 10", () => {
  // (your face-down card "myHidden" is a Volition resource too, so 8 [G] + it = 9 resources)
  const b = downsizingBoard({ greed: 8 });
  assert.equal(ready(b.engine), 9);
  refused(() => playRaw(b.engine, P1, b.id("ds")), "9 resources for a cost of 10");
  assert.equal(zoneOf(b.engine, b.id("ds")), "hand");
  assert.equal(zoneOf(b.engine, b.id("t0")), "play", "nothing was destroyed");
  const exact = downsizingBoard({ greed: 9 });
  assert.equal(ready(exact.engine), 10);
  play(exact.engine, P1, exact.id("ds"));
  assert.equal(zoneOf(exact.engine, exact.id("t0")), "discard", "exactly 10 is enough");
});

clause(DOWNSIZING, "0:rule", "is refused without [G][G][G][G] even with enough other resources", () => {
  const b = downsizingBoard({ greed: 3, rage: 10 });
  refused(() => playRaw(b.engine, P1, b.id("ds")), "three [G] are not four");
  assert.equal(zoneOf(b.engine, b.id("ds")), "hand");
  const four = downsizingBoard({ greed: 4, rage: 6 });
  play(four.engine, P1, four.id("ds"));
  assert.equal(zoneOf(four.engine, four.id("ds")), "discard", "four [G] plus six other resources is enough");
});

clause(DOWNSIZING, "0:rule", "the cost is paid when it is played; the destruction happens when it resolves, after the opponent may respond", () => {
  const b = downsizingBoard({ greed: 12 });
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("ds"));
  assert.equal(before - ready(b.engine), 10);
  assert.equal(zoneOf(b.engine, b.id("t0")), "play", "not destroyed yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("t0")), "discard");
});

clause(DOWNSIZING, "0:rule", "it destroys the characters that are in play when it RESOLVES: a character bounced in response is not destroyed and not counted", () => {
  const b = downsizingBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("ds"));
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("t0")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("t0")), "hand");
  assert.equal(influence(b.engine, P2), 20 + 4, "2 of mine + the 2 other characters of theirs were destroyed; the bounced one was not");
});

// =============================================================================
// Escrow Office
// DEPOSIT -- COST: Pay 1. EFFECT: Put a token on this card.
// WITHDRAW -- COST: Remove all tokens from this card. X is the number of tokens
// removed this way. EFFECT: Reduce the next numeric cost you pay this turn by X.
// Location (banker), cost 2, threshold [G], structure 3.
// =============================================================================

const OFFICE = "f3e17a99-a2b2-4b63-b5a9-ceb32a3165eb";

/** A character with no rules text and a printed cost (to measure what a deploy costs). */
const costed = (name: string, cost: number): Def => character({ name, cost });

/** An item with a free-standing ability that costs `pay` resources and puts a token on itself (id `tick`). */
function paidAbilityItem(pay: number, name = "Ticker"): Def {
  return item({
    name,
    behavior: { abilities: [{ id: "tick", type: "activated", costs: [{ type: "payResources", amount: pay }], effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }] }
  });
}

function officeBoard(tokenCount: number, opts: { greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "eo", def: printing(OFFICE), owner: P1, zone: "play", counters: tokenCount ? { token: tokenCount } : {} },
      { key: "big", def: costed("Big", 5), owner: P1, zone: "hand" },
      { key: "mid", def: costed("Mid", 3), owner: P1, zone: "hand" },
      { key: "small", def: costed("Small", 2), owner: P1, zone: "hand" },
      { key: "free", def: costed("Free", 0), owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Other", life: 5 }), owner: P1, zone: "play", counters: { token: 2 } },
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", opts.greed ?? 12, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Resources `fn` spends for `player`. */
function spentBy(engine: SpoilsEngine, player: Pid, fn: () => void): number {
  const before = ready(engine, player);
  fn();
  return before - ready(engine, player);
}

clause(OFFICE, "0:ability:deposit", "pays 1 and puts a token on the Office", () => {
  const b = officeBoard(0);
  const spent = spentBy(b.engine, P1, () => activate(b.engine, P1, b.id("eo"), "deposit"));
  assert.equal(spent, 1, "exactly 1 paid");
  assert.equal(tokens(b.engine, b.id("eo")), 1);
});

clause(OFFICE, "0:ability:deposit", "the 1 is paid when the ability is used; the token arrives when it resolves", () => {
  const b = officeBoard(0);
  const spent = spentBy(b.engine, P1, () => activateRaw(b.engine, P1, b.id("eo"), "deposit"));
  assert.equal(spent, 1);
  assert.equal(tokens(b.engine, b.id("eo")), 0, "not yet");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(tokens(b.engine, b.id("eo")), 1);
});

clause(OFFICE, "0:ability:deposit", "tokens accumulate one per use: four deposits make four tokens and cost four resources", () => {
  const b = officeBoard(0);
  const spent = spentBy(b.engine, P1, () => {
    for (let n = 1; n <= 4; n++) {
      activate(b.engine, P1, b.id("eo"), "deposit");
      assert.equal(tokens(b.engine, b.id("eo")), n);
    }
  });
  assert.equal(spent, 4);
});

clause(OFFICE, "0:ability:deposit", "the token goes on the Office itself, not on another card", () => {
  const b = officeBoard(0);
  activate(b.engine, P1, b.id("eo"), "deposit");
  assert.equal(tokens(b.engine, b.id("other")), 2, "another card's tokens are untouched");
});

clause(OFFICE, "0:ability:deposit", "with no resource to pay it is refused", () => {
  const b = officeBoard(0, { greed: 0 });
  refused(() => activateRaw(b.engine, P1, b.id("eo"), "deposit"), "nothing to pay with");
  assert.equal(tokens(b.engine, b.id("eo")), 0);
});

clause(OFFICE, "0:ability:deposit", "it has no deplete or once-per-turn limit and needs no threshold: other resource types pay for it too", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "eo", def: printing(OFFICE), owner: P1, zone: "play" }, ...bank("rage", 2, P1)]
  });
  activate(b.engine, P1, b.id("eo"), "deposit");
  activate(b.engine, P1, b.id("eo"), "deposit");
  assert.equal(tokens(b.engine, b.id("eo")), 2);
  assert.equal(isDepleted(b.engine, b.id("eo")), false);
});

clause(OFFICE, "0:ability:deposit", "it can be used in response on the opponent's turn", () => {
  const b = officeBoard(0, { turn: 2, active: P2, extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)] });
  playRaw(b.engine, P2, b.id("opp"));
  activateRaw(b.engine, P1, b.id("eo"), "deposit");
  resolvePendingResponses(b.engine);
  assert.equal(tokens(b.engine, b.id("eo")), 1);
});

clause(OFFICE, "0:ability:deposit", "only its controller can use it", () => {
  const b = officeBoard(0, { turn: 2, active: P2, extra: bank("rage", 2, P2) });
  refused(() => activateRaw(b.engine, P2, b.id("eo"), "deposit"), "the opponent does not control it");
  assert.equal(tokens(b.engine, b.id("eo")), 0);
});

clause(OFFICE, "0:ability:deposit", "an Office in hand cannot be used", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "eo", def: printing(OFFICE), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  refused(() => activateRaw(b.engine, P1, b.id("eo"), "deposit"), "not in play");
  assert.equal(ready(b.engine), 3);
});

clause(OFFICE, "0:ability:deposit", "tokens disappear when the Office leaves play (CR 409.2): returned to hand and deployed again it has none", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "eo", def: printing(OFFICE), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "bounceLoc", def: tactic({ name: "BounceLoc", cost: 0, behavior: { abilities: [{ id: "bl", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" },
      ...bank("greed", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("bounceLoc"), { selected: { t: [b.id("eo")] } });
  assert.equal(zoneOf(b.engine, b.id("eo")), "hand");
  play(b.engine, P1, b.id("eo"));
  assert.equal(zoneOf(b.engine, b.id("eo")), "play");
  assert.equal(tokens(b.engine, b.id("eo")), 0, "a fresh card has no tokens");
});

for (const count of [1, 2, 3]) {
  clause(OFFICE, "1:ability:withdraw", `removes ALL ${count} token(s), and the next numeric cost I pay this turn is ${count} less (a 5-cost character costs ${5 - count})`, () => {
    const b = officeBoard(count);
    activate(b.engine, P1, b.id("eo"), "withdraw");
    assert.equal(tokens(b.engine, b.id("eo")), 0, "every token removed");
    const spent = spentBy(b.engine, P1, () => play(b.engine, P1, b.id("big")));
    assert.equal(zoneOf(b.engine, b.id("big")), "play");
    assert.equal(spent, 5 - count);
  });
}

clause(OFFICE, "1:ability:withdraw", "with 5 tokens a 5-cost card is free; with 7 tokens the cost cannot go below 0 and the extra reduction is wasted", () => {
  const five = officeBoard(5);
  activate(five.engine, P1, five.id("eo"), "withdraw");
  assert.equal(spentBy(five.engine, P1, () => play(five.engine, P1, five.id("big"))), 0);
  const seven = officeBoard(7);
  activate(seven.engine, P1, seven.id("eo"), "withdraw");
  assert.equal(spentBy(seven.engine, P1, () => play(seven.engine, P1, seven.id("big"))), 0, "cost 0, never negative");
  assert.equal(spentBy(seven.engine, P1, () => play(seven.engine, P1, seven.id("mid"))), 3, "the next one pays full: only ONE cost is reduced");
});

clause(OFFICE, "1:ability:withdraw", "only the NEXT numeric cost is reduced: the cost after it is paid in full", () => {
  const b = officeBoard(2);
  activate(b.engine, P1, b.id("eo"), "withdraw");
  assert.equal(spentBy(b.engine, P1, () => play(b.engine, P1, b.id("mid"))), 1, "3 - 2");
  assert.equal(spentBy(b.engine, P1, () => play(b.engine, P1, b.id("small"))), 2, "full price");
});

clause(OFFICE, "1:ability:withdraw", "X is the number of tokens removed: tokens on other cards play no part", () => {
  const b = officeBoard(1);
  activate(b.engine, P1, b.id("eo"), "withdraw");
  assert.equal(tokens(b.engine, b.id("other")), 2, "another card keeps its tokens");
  assert.equal(spentBy(b.engine, P1, () => play(b.engine, P1, b.id("big"))), 4, "X was 1, not 3");
});

clause(OFFICE, "1:ability:withdraw", "removing the tokens is a COST: they are gone as soon as the ability is used, before the opponent can respond", () => {
  const b = officeBoard(3);
  activateRaw(b.engine, P1, b.id("eo"), "withdraw");
  assert.equal(tokens(b.engine, b.id("eo")), 0, "removed while the ability waits for responses");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(b.engine);
  assert.equal(spentBy(b.engine, P1, () => play(b.engine, P1, b.id("big"))), 2);
});

clause(OFFICE, "1:ability:withdraw", "it costs no resources", () => {
  const b = officeBoard(2, { greed: 0 });
  activate(b.engine, P1, b.id("eo"), "withdraw");
  assert.equal(tokens(b.engine, b.id("eo")), 0);
  assert.equal(ready(b.engine), 0);
});

clause(OFFICE, "1:ability:withdraw", "with no tokens on the Office it cannot be used (there is nothing to remove, CR 401.3b)", () => {
  const b = officeBoard(0);
  refused(() => activateRaw(b.engine, P1, b.id("eo"), "withdraw"), "no tokens to remove");
  assert.equal(spentBy(b.engine, P1, () => play(b.engine, P1, b.id("mid"))), 3, "no reduction was created");
});

clause(OFFICE, "1:ability:withdraw", "a numeric cost of an ability counts too (CR 406.5): the reduction applies to an ability's 'Pay 2'", () => {
  const b = officeBoard(1, { extra: [{ key: "tick", def: paidAbilityItem(2), owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("eo"), "withdraw");
  const spent = spentBy(b.engine, P1, () => activate(b.engine, P1, b.id("tick"), "tick"));
  assert.equal(spent, 1, "Pay 2 reduced by 1");
  assert.equal(tokens(b.engine, b.id("tick")), 1, "the ability still did its job");
});

clause(OFFICE, "1:ability:withdraw", "a numeric cost of an ability counts too: after withdrawing 2, DEPOSIT's 'Pay 1' is free and uses up the reduction", () => {
  const b = officeBoard(2);
  activate(b.engine, P1, b.id("eo"), "withdraw");
  const spent = spentBy(b.engine, P1, () => activate(b.engine, P1, b.id("eo"), "deposit"));
  assert.equal(spent, 0, "Pay 1 reduced to 0");
  assert.equal(tokens(b.engine, b.id("eo")), 1, "the deposit still happened");
  assert.equal(spentBy(b.engine, P1, () => play(b.engine, P1, b.id("mid"))), 3, "and the reduction is used up");
});

clause(OFFICE, "1:ability:withdraw", "the reduction applies to the whole numeric cost of a tactic being played, including its 'pay X+X' extra cost (CR 406.3): after withdrawing 2, Cash Out X=2 costs 0+4-2 = 2", () => {
  const b = officeBoard(2, { extra: [{ key: "co", def: printing(CASH_OUT), owner: P1, zone: "hand" }, ...fillers("dk", 6, P1, "deck")] });
  activate(b.engine, P1, b.id("eo"), "withdraw");
  const spent = spentBy(b.engine, P1, () => play(b.engine, P1, b.id("co"), { variables: { x: 2 } }));
  assert.equal(spent, 2, "running total 4, reduced by 2");
});

clause(OFFICE, "1:ability:withdraw", "a card of numeric cost 0 uses up the reduction without any benefit being carried over", () => {
  const b = officeBoard(2);
  activate(b.engine, P1, b.id("eo"), "withdraw");
  assert.equal(spentBy(b.engine, P1, () => play(b.engine, P1, b.id("free"))), 0);
  assert.equal(spentBy(b.engine, P1, () => play(b.engine, P1, b.id("mid"))), 3, "the reduction was spent on the 0-cost card");
});

clause(OFFICE, "1:ability:withdraw", "'this turn': an unused reduction ends with the turn", () => {
  const b = officeBoard(3);
  activate(b.engine, P1, b.id("eo"), "withdraw");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my next turn");
  assert.equal(spentBy(b.engine, P1, () => play(b.engine, P1, b.id("big"))), 5, "the reduction did not carry over");
});

clause(OFFICE, "1:ability:withdraw", "the reduction is MINE: a tactic the opponent pays for in response costs them its full numeric cost", () => {
  const b = officeBoard(3, { extra: [{ key: "resp", def: drawTactic("Costly2", 1, 2), owner: P2, zone: "hand" }, ...bank("rage", 2, P2)] });
  activate(b.engine, P1, b.id("eo"), "withdraw");
  b.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond to my ending the turn");
  const spent = spentBy(b.engine, P2, () => playRaw(b.engine, P2, b.id("resp")));
  assert.equal(spent, 2, "the opponent pays the full 2");
});

clause(OFFICE, "1:ability:withdraw", "it can be used in response on the opponent's turn; the reduction then applies to my next cost that turn", () => {
  const b = officeBoard(2, {
    turn: 2,
    active: P2,
    extra: [
      { key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" },
      { key: "resp", def: drawTactic("Costly2", 1, 2), owner: P1, zone: "hand" },
      ...bank("rage", 1, P2)
    ]
  });
  playRaw(b.engine, P2, b.id("opp"));
  activateRaw(b.engine, P1, b.id("eo"), "withdraw");
  resolvePendingResponses(b.engine);
  assert.equal(tokens(b.engine, b.id("eo")), 0);
  b.engine.perform({ type: "endTurn", playerId: P2 });
  const spent = spentBy(b.engine, P1, () => playRaw(b.engine, P1, b.id("resp")));
  assert.equal(spent, 0, "my tactic's cost of 2 is reduced by 2");
});

clause(OFFICE, "1:ability:withdraw", "only its controller can use it", () => {
  const b = officeBoard(2, { turn: 2, active: P2 });
  refused(() => activateRaw(b.engine, P2, b.id("eo"), "withdraw"), "the opponent does not control it");
  assert.equal(tokens(b.engine, b.id("eo")), 2);
});

clause(OFFICE, "1:ability:withdraw", "the card itself: costs 2 with [G] (one short or no [G] is refused) and has structure 3 (2 damage leaves it in play, 3 destroys it)", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "eo", def: printing(OFFICE), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 1, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("eo"))), 2, "one [G] plus one other resource is enough");
  assert.equal(zoneOf(exact.engine, exact.id("eo")), "play");
  assert.equal(exact.engine.getStat(exact.id("eo"), "structure"), 3);
  const noG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "eo", def: printing(OFFICE), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(noG.engine, P1, noG.id("eo")), "no [G]");
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "eo", def: printing(OFFICE), owner: P1, zone: "hand" }, ...bank("greed", 1, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("eo")), "one resource short");
  for (const [damage, destroyed] of [[2, false], [3, true]] as const) {
    const game = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "eo", def: printing(OFFICE), owner: P1, zone: "play" },
        {
          key: "smash",
          def: tactic({ name: `Smash${damage}`, cost: 0, behavior: { abilities: [{ id: "ldmg", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: damage }] }] } }),
          owner: P1,
          zone: "hand"
        }
      ]
    });
    play(game.engine, P1, game.id("smash"), { selected: { t: [game.id("eo")] } });
    assert.equal(zoneOf(game.engine, game.id("eo")), destroyed ? "discard" : "play", `${damage} damage`);
  }
});

// @@END@@
