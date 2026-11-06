// Clause tests — batch seed-3-01, part p2 (groups 8-13: Anatidaephobia, Fecal
// Urgency, Intriguing Mezzanine, Port Manteau, Prestige Inversion, Vilghame
// Manewaft). See docs/TESTING.md and
// `npm run card-tests -- manifest seed-3-01 --groups 8-13`. Expectations come
// from each card's PRINTED text; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  bank,
  character,
  developFaction,
  drawerChar,
  item,
  killTactic,
  play,
  resolvePendingResponses,
  tactic,
  volition,
  uniqueChar,
  activate,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { playRaw } from "./_battle.js";
import { answerPending, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { developResources, endTurn, factionOf } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ greed: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** `n` greed resources of `owner` that are already spent (attached to the owner's faction). */
const spentGreed = (n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank("greed", n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

/** Resources not yet attached to anything (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const influence = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** Raw `flipUp` WITHOUT draining the response window. */
function flipUpRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}, variables: Record<string, number> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables });
}

/** Raw `playCard` WITHOUT draining the response window. */
function castRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}, variables: Record<string, number> = {}): void {
  engine.perform({ type: "playCard", playerId: player, cardId, selected, variables } as never);
}

/** The sole open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** A tactic that draws one card for its controller (so an opponent can really play it). */
const drawTactic = (name: string, cost: number, extra: Partial<CardDefinition> = {}): CardDefinition =>
  tactic({
    name,
    cost,
    behavior: { abilities: [{ id: "draw1", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] },
    ...extra
  });

/** Resources of `player` that are spent (attached to something). */
const spentCount = (engine: SpoilsEngine, player: PlayerId = P1): number =>
  engine.state.players[player].play.filter((c) => engine.isResource(c) && engine.state.cards[c].attachedTo !== undefined).length;

// =====================================================================================
// Anatidaephobia
// =====================================================================================

const ANAT = "25fc8abf-08b6-4afb-bdbd-a7db7c29e1d9"; // tactic, cost 0, threshold g -- COST: Play this only in response to a character being played. If you did not play this card using FLIP UP, pay X, where X is the character's numeric cost. -- EFFECT: Terminate the character. -- FLIP UP: 1 [G] and your faction loses 5 influence.

interface AnatOpts {
  mine?: Icons;
  charCost?: number;
  anat?: "hand" | "faceDown";
  char?: CardDefinition;
  extra?: CardPlacement[];
}

/** P1 holds Anatidaephobia (hand or face-down resource); it is P2's turn and P2 holds the character `big` in hand. */
function anatBoard(o: AnatOpts = {}) {
  const faceDown = o.anat === "faceDown";
  return devBoard(
    [
      { key: "anat", def: printing(ANAT), owner: P1, zone: faceDown ? "play" : "hand", faceDown },
      { key: "big", def: o.char ?? character({ name: "Incoming", cost: o.charCost ?? 3, strength: 2, life: 2 }), owner: P2, zone: "hand" },
      { key: "by", def: character({ name: "Bystander", cost: 1 }), owner: P2, zone: "play" },
      ...fillers("pd", 3, P2, "deck"),
      ...res(o.mine ?? { greed: 5 }),
      ...res({ rage: 6 }, P2),
      ...(o.extra ?? [])
    ],
    { activePlayerId: P2 }
  );
}
type AnatGame = ReturnType<typeof anatBoard>;

/** P2 deploys `key` and P1 (holding priority) has not answered yet. */
const castBig = (g: AnatGame, key = "big"): void => castRaw(g.engine, P2, g.id(key));
/** P1 plays Anatidaephobia from hand in response, then every response window closes. */
const anatRespond = (g: AnatGame): void => {
  castRaw(g.engine, P1, g.id("anat"));
  resolvePendingResponses(g.engine);
};
/** P1 flips Anatidaephobia up in response, then every response window closes. */
const anatFlip = (g: AnatGame): void => {
  flipUpRaw(g.engine, P1, g.id("anat"));
  resolvePendingResponses(g.engine);
};

clause(ANAT, "0:ability", "responding to a character being played: pays X = the character's numeric cost (3), terminates it (to its OWNER's discard pile, never enters play); a bystander is untouched", () => {
  const g = anatBoard();
  castBig(g);
  assert.equal(ready(g.engine), 5, "nothing paid before I respond");
  assert.equal(zoneOf(g.engine, g.id("big")) === "play", false, "the character is still waiting to resolve");
  anatRespond(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("big")), "discard", "terminated");
  assert.ok(discardOf(g.engine, P2).includes(g.id("big")), "it goes to its owner's discard pile");
  assert.equal(zoneOf(g.engine, g.id("by")), "play", "the bystander character is not terminated");
  assert.equal(zoneOf(g.engine, g.id("anat")), "discard", "the tactic ends in my discard pile");
  assert.equal(ready(g.engine, P1), 2, "exactly X = 3 of my 5 resources were paid");
  assert.equal(ready(g.engine, P2), 3, "the opponent's cost stays paid");
});

clause(ANAT, "0:ability", "X is the character's numeric cost: a cost-0, cost-1 and cost-4 character make me pay 0, 1 and 4", () => {
  for (const cost of [0, 1, 4]) {
    const g = anatBoard({ charCost: cost, mine: { greed: 5 } });
    castBig(g);
    anatRespond(g);
    assert.equal(zoneOf(g.engine, g.id("big")), "discard", `cost ${cost}: terminated`);
    assert.equal(ready(g.engine, P1), 5 - cost, `cost ${cost}: pays exactly X`);
  }
});

clause(ANAT, "0:ability", "pay X must be affordable: with 3 resources against a cost-4 character it is refused (nothing is spent, the character still resolves); with exactly 4 it works", () => {
  const g = anatBoard({ charCost: 4, mine: { greed: 3 } });
  castBig(g);
  refused(() => castRaw(g.engine, P1, g.id("anat")), "one resource short of X");
  assert.equal(zoneOf(g.engine, g.id("anat")), "hand");
  assert.equal(ready(g.engine, P1), 3, "nothing was spent");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("big")), "play", "the unanswered character resolves");
  const ok = anatBoard({ charCost: 4, mine: { greed: 4 } });
  castBig(ok);
  anatRespond(ok);
  assert.equal(zoneOf(ok.engine, ok.id("big")), "discard");
  assert.equal(ready(ok.engine, P1), 0);
});

clause(ANAT, "0:ability", "threshold [G]: with enough resources but no [G] (or only the opponent's [G]) it is refused; one [G] plus other resources is enough", () => {
  const noG = anatBoard({ charCost: 2, mine: { rage: 4 } });
  castBig(noG);
  refused(() => castRaw(noG.engine, P1, noG.id("anat")), "no [G]");
  assert.equal(zoneOf(noG.engine, noG.id("anat")), "hand");
  const theirs = anatBoard({ charCost: 2, mine: { rage: 4 }, extra: res({ greed: 3 }, P2) });
  castBig(theirs);
  refused(() => castRaw(theirs.engine, P1, theirs.id("anat")), "the opponent's [G] do not count");
  const ok = anatBoard({ charCost: 2, mine: { greed: 1, rage: 2 } });
  castBig(ok);
  anatRespond(ok);
  assert.equal(zoneOf(ok.engine, ok.id("big")), "discard");
  assert.equal(ready(ok.engine, P1), 1, "X = 2 of my 3 resources were paid");
});

clause(ANAT, "0:ability", "can be played only in response to a character being played: refused on my own turn with nothing to respond to, and when the opponent plays an item, a tactic, or uses an ability", () => {
  const own = devBoard([{ key: "anat", def: printing(ANAT), owner: P1, zone: "hand" }, { key: "cc", def: character({ name: "Mine", cost: 1 }), owner: P1, zone: "play" }, ...res({ greed: 5 })]);
  refused(() => castRaw(own.engine, P1, own.id("anat")), "nothing to respond to");
  assert.equal(zoneOf(own.engine, own.id("anat")), "hand");
  assert.equal(zoneOf(own.engine, own.id("cc")), "play", "nothing terminated");
  const cases: Array<[string, CardPlacement[], (g: AnatGame) => void]> = [
    ["an item", [{ key: "it", def: item({ name: "Trinket", cost: 1 }), owner: P2, zone: "hand" }], (g) => castBig(g, "it")],
    ["a tactic", [{ key: "tc", def: drawTactic("Quick Study", 1), owner: P2, zone: "hand" }], (g) => castBig(g, "tc")],
    [
      "a character's ability",
      [{ key: "dr", def: drawerChar(), owner: P2, zone: "play" }],
      (g) => g.engine.perform({ type: "activateAbility", playerId: P2, cardId: g.id("dr"), abilityId: "draw1", selected: {}, variables: {} } as never)
    ]
  ];
  for (const [label, extra, trigger] of cases) {
    const g = anatBoard({ extra });
    trigger(g);
    refused(() => castRaw(g.engine, P1, g.id("anat")), `responding to ${label}`);
    assert.equal(zoneOf(g.engine, g.id("anat")), "hand", `${label}: still in hand`);
    assert.equal(ready(g.engine, P1), 5, `${label}: nothing paid`);
    assert.equal(zoneOf(g.engine, g.id("by")), "play");
  }
  const ok = anatBoard();
  castBig(ok);
  anatRespond(ok);
  assert.equal(zoneOf(ok.engine, ok.id("big")), "discard", "positive control: responding to a character works");
});

clause(ANAT, "0:ability", "terminating the character means it never enters play, so its enters-play trigger does not fire (control: unanswered, the same character does trigger)", () => {
  const greeter = () =>
    character({
      name: "Greeter",
      cost: 2,
      behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
  const control = anatBoard({ char: greeter() });
  const before = handOf(control.engine, P2).length;
  castBig(control);
  resolvePendingResponses(control.engine);
  assert.equal(zoneOf(control.engine, control.id("big")), "play");
  assert.equal(handOf(control.engine, P2).length, before - 1 + 1, "unanswered: it enters play and draws");
  const g = anatBoard({ char: greeter() });
  castBig(g);
  anatRespond(g);
  assert.equal(zoneOf(g.engine, g.id("big")), "discard");
  assert.equal(handOf(g.engine, P2).length, before - 1, "terminated: no card drawn");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ANAT, ["0:ability", "1:flipUp"], "played with FLIP UP the 'pay X' is skipped: a cost-4 character is terminated for the FLIP UP cost alone, and FLIP UP is still only possible in response to a character", () => {
  const g = anatBoard({ anat: "faceDown", charCost: 4, mine: { greed: 3 } });
  castBig(g);
  anatFlip(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("big")), "discard", "terminated");
  assert.equal(zoneOf(g.engine, g.id("anat")), "discard");
  assert.equal(spentCount(g.engine), 1, "exactly the 1 of FLIP UP was spent, not X = 4 and not nothing");
  assert.equal(ready(g.engine) + spentCount(g.engine), 3, "my three [G] are all still there, one of them spent");
  // refused outside a response to a character
  const own = devBoard([{ key: "anat", def: printing(ANAT), owner: P1, zone: "play", faceDown: true }, ...res({ greed: 3 })]);
  const ownInfluence = influence(own.engine, P1);
  refused(() => flipUpRaw(own.engine, P1, own.id("anat")), "FLIP UP with nothing to respond to");
  assert.equal(own.engine.state.cards[own.id("anat")].faceDown, true);
  assert.equal(influence(own.engine, P1), ownInfluence, "no influence lost");
  const itemG = anatBoard({ anat: "faceDown", extra: [{ key: "it", def: item({ name: "Trinket", cost: 1 }), owner: P2, zone: "hand" }] });
  castBig(itemG, "it");
  refused(() => flipUpRaw(itemG.engine, P1, itemG.id("anat")), "FLIP UP in response to an item");
  assert.equal(itemG.engine.state.cards[itemG.id("anat")].faceDown, true);
});

clause(ANAT, "1:flipUp", "a face-down Anatidaephobia is a resource in my pool", () => {
  const g = anatBoard({ anat: "faceDown" });
  assert.equal(g.engine.isResource(g.id("anat")), true);
  assert.equal(ready(g.engine), 6, "five [G] plus the face-down card");
});

clause(ANAT, "1:flipUp", "FLIP UP: my faction loses exactly 5 influence (the opponent's is untouched), 1 is paid, and the character is terminated", () => {
  const g = anatBoard({ anat: "faceDown", mine: { greed: 3 } });
  const mine = influence(g.engine, P1);
  const theirs = influence(g.engine, P2);
  castBig(g);
  anatFlip(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influence(g.engine, P1), mine - 5, "my faction loses 5 influence");
  assert.equal(influence(g.engine, P2), theirs, "the opponent's faction is untouched");
  assert.equal(zoneOf(g.engine, g.id("big")), "discard");
  assert.equal(g.engine.state.cards[g.id("anat")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("anat")), "discard");
  assert.equal(spentCount(g.engine), 1, "FLIP UP cost 1: exactly one resource was spent");
  assert.equal(ready(g.engine) + spentCount(g.engine), 3, "no more than that one was paid");
});

clause(ANAT, "1:flipUp", "FLIP UP needs [G]: with only other icons, or only the opponent's [G], it is refused (still face-down, no influence lost, the character resolves); a spent [G] still meets the threshold and the card can pay for itself", () => {
  const wrong = anatBoard({ anat: "faceDown", mine: { rage: 3 } });
  const before = influence(wrong.engine, P1);
  castBig(wrong);
  refused(() => flipUpRaw(wrong.engine, P1, wrong.id("anat")), "no [G]");
  assert.equal(wrong.engine.state.cards[wrong.id("anat")].faceDown, true);
  assert.equal(influence(wrong.engine, P1), before);
  resolvePendingResponses(wrong.engine);
  assert.equal(zoneOf(wrong.engine, wrong.id("big")), "play");
  const theirs = anatBoard({ anat: "faceDown", mine: { rage: 3 }, extra: res({ greed: 3 }, P2) });
  castBig(theirs);
  refused(() => flipUpRaw(theirs.engine, P1, theirs.id("anat")), "the opponent's [G] do not count");
  assert.equal(theirs.engine.state.cards[theirs.id("anat")].faceDown, true);
  const spent = anatBoard({ anat: "faceDown", mine: {}, extra: spentGreed(1) });
  castBig(spent);
  flipUpRaw(spent.engine, P1, spent.id("anat"));
  resolvePendingResponses(spent.engine);
  assert.equal(zoneOf(spent.engine, spent.id("big")), "discard", "a spent [G] still meets the threshold; the card paid for its own FLIP UP");
});

clause(ANAT, "1:flipUp", "only a face-down card can be flipped up: Anatidaephobia in my hand is refused", () => {
  const g = anatBoard({ anat: "hand" });
  castBig(g);
  refused(() => flipUpRaw(g.engine, P1, g.id("anat")), "FLIP UP from hand");
  assert.equal(zoneOf(g.engine, g.id("anat")), "hand");
  assert.equal(zoneOf(g.engine, g.id("big")) === "discard", false);
});

clause(ANAT, "1:flipUp", "losing 5 influence with fewer than 5 left stops at 0, never below", () => {
  const g = anatBoard({ anat: "faceDown", mine: { greed: 2 } });
  g.engine.state.players[P1].influence = 3;
  castBig(g);
  anatFlip(g);
  assert.equal(influence(g.engine, P1), 0);
});

// =====================================================================================
// Fecal Urgency
// =====================================================================================

const FECAL = "a43be8c9-6c39-463a-a10a-6721510e84bb"; // tactic, cost 3, threshold g -- COST: Choose a number for X that is less than or equal to the number of [G] you control. -- EFFECT: Draw X cards. Your faction loses X+X influence.

const fecalBoard = (mine: Icons, theirs: Icons = {}, extra: CardPlacement[] = []) =>
  devBoard([
    { key: "fu", def: printing(FECAL), owner: P1, zone: "hand" },
    ...fillers("d", 6, P1, "deck"),
    ...fillers("od", 3, P2, "deck"),
    { key: "oh", def: character({ name: "Opp Hand" }), owner: P2, zone: "hand" },
    ...res(mine),
    ...res(theirs, P2),
    ...extra
  ]);
type FecalGame = ReturnType<typeof fecalBoard>;
const fecalPlay = (g: FecalGame, x: number): void => play(g.engine, P1, g.id("fu"), { variables: { x } });
const fecalTry = (g: FecalGame, x: number): void => castRaw(g.engine, P1, g.id("fu"), {}, { x });

clause(FECAL, "0:ability", "X = 2: I draw exactly the top 2 cards of MY deck in order, my faction loses 2+2 = 4 influence (the opponent's is untouched), and the tactic costs 3", () => {
  const g = fecalBoard({ greed: 5 });
  const top = deckOf(g.engine, P1).slice(0, 2);
  const deckBefore = deckOf(g.engine, P1).length;
  const mine = influence(g.engine, P1);
  const theirs = influence(g.engine, P2);
  const oppHand = handOf(g.engine, P2);
  const oppDeck = deckOf(g.engine, P2);
  fecalPlay(g, 2);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(g.engine, P1), top, "the top two cards, in order");
  assert.equal(deckOf(g.engine, P1).length, deckBefore - 2);
  assert.equal(influence(g.engine, P1), mine - 4);
  assert.equal(influence(g.engine, P2), theirs);
  assert.deepEqual(handOf(g.engine, P2), oppHand);
  assert.deepEqual(deckOf(g.engine, P2), oppDeck);
  assert.equal(ready(g.engine), 2, "5 [G] minus the printed cost 3");
  assert.equal(zoneOf(g.engine, g.id("fu")), "discard");
});

clause(FECAL, "0:ability", "X scales: X = 0, 1, 3 and 5 draw X cards and lose 2X influence", () => {
  for (const x of [0, 1, 3, 5]) {
    const g = fecalBoard({ greed: 5 });
    const top = deckOf(g.engine, P1).slice(0, x);
    const mine = influence(g.engine, P1);
    fecalPlay(g, x);
    assert.equal(g.engine.state.pendingChoice, undefined, `X=${x}`);
    assert.deepEqual(handOf(g.engine, P1), top, `X=${x}: drew X cards`);
    assert.equal(influence(g.engine, P1), mine - 2 * x, `X=${x}: lost X+X influence`);
  }
});

clause(FECAL, "0:ability", "X may not exceed the number of [G] I control: other icons, the opponent's [G] and face-down resources do not count; X equal to the number is fine", () => {
  const rage = fecalBoard({ greed: 3, rage: 3 });
  refused(() => fecalTry(rage, 4), "4 > three [G] (rage does not count; X=3 on the same board is accepted below)", /cannot be deployed right now/);
  assert.deepEqual(handOf(rage.engine, P1), [rage.id("fu")]);
  assert.equal(zoneOf(rage.engine, rage.id("fu")), "hand");
  fecalPlay(rage, 3);
  assert.equal(handOf(rage.engine, P1).length, 3, "X = 3 = number of [G]: accepted");
  const theirs = fecalBoard({ greed: 2, rage: 3 }, { greed: 4 });
  refused(() => fecalTry(theirs, 3), "the opponent's [G] do not count (X=2 on the same board is accepted below)", /cannot be deployed right now/);
  fecalPlay(theirs, 2);
  assert.equal(handOf(theirs.engine, P1).length, 2);
  const faceDown = fecalBoard({ greed: 2 }, {}, volition(3));
  refused(() => fecalTry(faceDown, 3), "face-down Volition is not [G] (X=2 on the same board is accepted below)", /cannot be deployed right now/);
  assert.equal(ready(faceDown.engine), 5, "nothing was spent by the refused attempt");
  fecalPlay(faceDown, 2);
  assert.equal(handOf(faceDown.engine, P1).length, 2, "control: X = 2 = number of [G] is accepted on the same board");
});

clause(FECAL, "0:ability", "X must be a whole number (CR: 'not -1'): X = -1 is refused (nothing drawn, no influence gained)", () => {
  const g = fecalBoard({ greed: 5 });
  const mine = influence(g.engine, P1);
  refused(() => fecalTry(g, -1), "X = -1");
  assert.equal(zoneOf(g.engine, g.id("fu")), "hand", "not played");
  assert.equal(influence(g.engine, P1), mine, "no influence gained");
  assert.equal(handOf(g.engine, P1).length, 1, "nothing drawn");
});

clause(FECAL, "0:ability", "X must be a whole number (CR: 'not 3 and a half'): X = 1.5 is refused (nothing drawn or lost)", () => {
  const g = fecalBoard({ greed: 5 });
  const mine = influence(g.engine, P1);
  refused(() => fecalTry(g, 1.5), "X = 1.5");
  assert.equal(zoneOf(g.engine, g.id("fu")), "hand", "not played");
  assert.equal(influence(g.engine, P1), mine, "no influence lost");
  assert.equal(handOf(g.engine, P1).length, 1, "nothing drawn");
});

clause(FECAL, "0:ability", "printed cost 3 and threshold [G]: with 2 resources, or with 5 non-[G] resources, it is refused; 3 resources including a [G] work (X = 0 draws nothing)", () => {
  const poor = fecalBoard({ greed: 2 });
  refused(() => fecalTry(poor, 1), "cost 3 with only 2 resources");
  assert.equal(zoneOf(poor.engine, poor.id("fu")), "hand");
  const noG = fecalBoard({ rage: 5 });
  refused(() => fecalTry(noG, 0), "threshold [G] not met");
  assert.equal(zoneOf(noG.engine, noG.id("fu")), "hand");
  const ok = fecalBoard({ greed: 1, rage: 2 });
  fecalPlay(ok, 0);
  assert.equal(zoneOf(ok.engine, ok.id("fu")), "discard");
  assert.equal(ready(ok.engine), 0, "three resources paid");
  assert.equal(handOf(ok.engine, P1).length, 0, "X = 0 draws nothing");
});

clause(FECAL, "0:ability", "my faction can't lose more influence than it has: with 3 influence, X = 2 (lose 4) leaves 0, not -1", () => {
  const g = fecalBoard({ greed: 5 });
  g.engine.state.players[P1].influence = 3;
  fecalPlay(g, 2);
  assert.equal(influence(g.engine, P1), 0);
});

// =====================================================================================
// Intriguing Mezzanine
// =====================================================================================

const MEZZ = "d5a76074-c837-4279-8f74-bef9e4878b92"; // location, cost 5, threshold gggg, structure 2 -- COST: Pick 2 characters. -- When this card enters play, deplete those characters. -- PARTY ON! -- COST: Inflict 1 damage to this location. If you do, pick a character. -- EFFECT: Deplete the character. -- Characters depleted by this card cannot be restored by their controller's faction's RESTORE RULE.

interface MezzOpts {
  mine?: Icons;
  extra?: CardPlacement[];
  mez?: "hand" | "play";
}
function mezzBoard(o: MezzOpts = {}) {
  return devBoard([
    { key: "mez", def: printing(MEZZ), owner: P1, zone: o.mez ?? "hand" },
    { key: "c1", def: character({ name: "Mine One", cost: 1 }), owner: P1, zone: "play" },
    { key: "c2", def: character({ name: "Mine Two", cost: 1 }), owner: P1, zone: "play" },
    { key: "o1", def: character({ name: "Theirs One", cost: 1 }), owner: P2, zone: "play" },
    { key: "o2", def: character({ name: "Theirs Two", cost: 1 }), owner: P2, zone: "play" },
    { key: "it", def: item({ name: "Trinket", cost: 1 }), owner: P1, zone: "play" },
    { key: "dc", def: character({ name: "Fallen", cost: 1 }), owner: P1, zone: "discard" },
    { key: "hc", def: character({ name: "Benched", cost: 1 }), owner: P1, zone: "hand" },
    ...res(o.mine ?? { greed: 5 }),
    ...(o.extra ?? [])
  ]);
}
type MezzGame = ReturnType<typeof mezzBoard>;
const isDepleted = (g: MezzGame, key: string): boolean => g.engine.state.cards[g.id(key)].depleted === true;
const mezzPlay = (g: MezzGame, picked: string[]): void => play(g.engine, P1, g.id("mez"), { selected: { picked: picked.map(g.id) } });
const party = (g: MezzGame, target: string): void => activate(g.engine, P1, g.id("mez"), "mezz-party", { selected: { c: [g.id(target)] } });

clause(MEZZ, ["0:ability", "1:rule"], "playing it picks 2 characters (mine and/or theirs) and they are depleted when it enters play; every other character stays ready", () => {
  const pairs: Array<[string, string]> = [["c1", "o1"], ["o1", "o2"], ["c1", "c2"]];
  for (const pair of pairs) {
    const g = mezzBoard();
    mezzPlay(g, pair);
    assert.equal(g.engine.state.pendingChoice, undefined, pair.join());
    assert.equal(zoneOf(g.engine, g.id("mez")), "play", `${pair.join()}: the location is in play`);
    for (const key of ["c1", "c2", "o1", "o2"]) assert.equal(isDepleted(g, key), pair.includes(key), `${pair.join()}: ${key}`);
    assert.equal(ready(g.engine), 0, "the cost 5 was paid");
    assert.equal(g.engine.state.cards[g.id("it")].depleted === true, false, "the item is not a character");
  }
});

clause(MEZZ, ["0:ability", "1:rule", "3:rule"], "a character that is ALREADY depleted can be picked (the pick needs no ready character); it stays depleted, and since this card did not deplete it the RESTORE RULE still restores it", () => {
  const g = mezzBoard();
  g.engine.state.cards[g.id("c1")].depleted = true; // depleted by something else
  mezzPlay(g, ["c1", "o1"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("mez")), "play", "picking a depleted character is legal");
  assert.equal(isDepleted(g, "c1"), true, "still depleted");
  assert.equal(isDepleted(g, "o1"), true, "the other pick is depleted by this card");
  endTurn(g.engine, P1);
  assert.equal(isDepleted(g, "o1"), true, "o1 was depleted by this card: not restored at their turn start");
  endTurn(g.engine, P2);
  assert.equal(isDepleted(g, "c1"), false, "c1 was already depleted before this card; the lock covers only characters depleted BY this card");
  assert.equal(isDepleted(g, "o1"), true, "o1 stays locked");
});

clause(MEZZ, "2:ability:mezz-party", "PARTY ON! can pick an already-depleted character: the damage cost is still paid and nothing else changes", () => {
  const g = mezzBoard({ mez: "play" });
  g.engine.state.cards[g.id("o1")].depleted = true;
  party(g, "o1");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.cards[g.id("mez")].damage, 1, "the cost is paid");
  assert.equal(isDepleted(g, "o1"), true, "stays depleted");
  for (const key of ["c1", "c2", "o2"]) assert.equal(isDepleted(g, key), false, key);
});

clause(MEZZ, "0:ability", "the pick is part of the cost: exactly 2 characters in play, no more, fewer, duplicates, items or cards outside play; a refused attempt spends nothing", () => {
  const bad: Array<[string, string[]]> = [
    ["no pick", []],
    ["only 1 character", ["c1"]],
    ["3 characters", ["c1", "c2", "o1"]],
    ["a character and an item", ["c1", "it"]],
    ["a character and a character in the discard pile", ["c1", "dc"]],
    ["a character and a character in hand", ["c1", "hc"]],
    ["the same character twice", ["c1", "c1"]]
  ];
  for (const [label, picked] of bad) {
    const g = mezzBoard();
    refused(() => castRaw(g.engine, P1, g.id("mez"), { picked: picked.map(g.id) }), label);
    assert.equal(zoneOf(g.engine, g.id("mez")), "hand", `${label}: still in hand`);
    assert.equal(ready(g.engine), 5, `${label}: nothing spent`);
    for (const key of ["c1", "c2", "o1", "o2"]) assert.equal(isDepleted(g, key), false, `${label}: ${key}`);
  }
  const alone = devBoard([
    { key: "mez", def: printing(MEZZ), owner: P1, zone: "hand" },
    { key: "c1", def: character({ name: "Lonely", cost: 1 }), owner: P1, zone: "play" },
    ...res({ greed: 5 })
  ]);
  refused(() => castRaw(alone.engine, P1, alone.id("mez"), { picked: [alone.id("c1")] }), "only one character exists");
  assert.equal(zoneOf(alone.engine, alone.id("mez")), "hand");
});

clause(MEZZ, "0:ability", "printed cost 5, threshold [G][G][G][G] and structure 2: 4 resources or 3 [G] are refused, 5 resources with 4 [G] work", () => {
  const poor = mezzBoard({ mine: { greed: 4 } });
  refused(() => castRaw(poor.engine, P1, poor.id("mez"), { picked: [poor.id("c1"), poor.id("c2")] }), "one short of 5");
  assert.equal(zoneOf(poor.engine, poor.id("mez")), "hand");
  const noThreshold = mezzBoard({ mine: { greed: 3, rage: 2 } });
  refused(() => castRaw(noThreshold.engine, P1, noThreshold.id("mez"), { picked: [noThreshold.id("c1"), noThreshold.id("c2")] }), "only three [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("mez")), "hand");
  const ok = mezzBoard({ mine: { greed: 4, rage: 1 } });
  mezzPlay(ok, ["c1", "c2"]);
  assert.equal(zoneOf(ok.engine, ok.id("mez")), "play");
  assert.equal(ok.engine.getStat(ok.id("mez"), "structure"), 2);
});

clause(MEZZ, "1:rule", "the characters are depleted only when the location ENTERS play, not while it waits to resolve (the opponent can still respond)", () => {
  const g = mezzBoard();
  playRaw(g.engine, P1, g.id("mez"), { selected: { picked: [g.id("c1"), g.id("o1")] } });
  assert.equal(zoneOf(g.engine, g.id("mez")) === "play", false, "still being played");
  assert.equal(isDepleted(g, "c1"), false, "not depleted yet");
  assert.equal(isDepleted(g, "o1"), false, "not depleted yet");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mez")), "play");
  assert.equal(isDepleted(g, "c1"), true);
  assert.equal(isDepleted(g, "o1"), true);
});

clause(MEZZ, "1:rule", "if one picked character is gone before the location enters play, the other is still depleted", () => {
  const g = mezzBoard({ extra: [{ key: "kt", def: killTactic(), owner: P2, zone: "hand" }] });
  castRaw(g.engine, P1, g.id("mez"), { picked: [g.id("c1"), g.id("o1")] });
  castRaw(g.engine, P2, g.id("kt"), { t: [g.id("o1")] });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("o1")), "discard", "the opponent destroyed it in response");
  assert.equal(zoneOf(g.engine, g.id("mez")), "play");
  assert.equal(isDepleted(g, "c1"), true, "the other pick is depleted");
  assert.equal(isDepleted(g, "c2"), false);
  assert.equal(isDepleted(g, "o2"), false);
});

clause(MEZZ, "2:ability:mezz-party", "PARTY ON!: the cost is 1 damage to this location, then the picked character (mine or theirs) is depleted and nobody else is", () => {
  for (const target of ["o1", "c1"]) {
    const g = mezzBoard({ mez: "play" });
    party(g, target);
    assert.equal(g.engine.state.pendingChoice, undefined, target);
    assert.equal(g.engine.state.cards[g.id("mez")].damage, 1, `${target}: 1 damage inflicted on the location`);
    assert.equal(zoneOf(g.engine, g.id("mez")), "play", "structure 2 survives 1 damage");
    for (const key of ["c1", "c2", "o1", "o2"]) assert.equal(isDepleted(g, key), key === target, `${target}: ${key}`);
    assert.equal(g.engine.state.cards[g.id("c1")].damage === 0 && g.engine.state.cards[g.id("o1")].damage === 0, true, "the characters take no damage");
  }
});

clause(MEZZ, "2:ability:mezz-party", "PARTY ON! can be used again: the second use puts 2 damage on the structure-2 location, destroying it, yet the second character is still depleted", () => {
  const g = mezzBoard({ mez: "play" });
  party(g, "o1");
  party(g, "o2");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(g, "o1"), true);
  assert.equal(isDepleted(g, "o2"), true, "the effect still resolves after the cost destroyed the location");
  assert.equal(zoneOf(g.engine, g.id("mez")), "discard", "2 damage destroys a structure-2 location");
  assert.equal(isDepleted(g, "c1"), false);
  assert.equal(isDepleted(g, "c2"), false);
});

clause(MEZZ, "2:ability:mezz-party", "PARTY ON! picks a character in play: an item, a character in the discard pile or in hand, or no pick at all is refused and the damage cost is not paid", () => {
  for (const [label, picked] of [["an item", ["it"]], ["a discarded character", ["dc"]], ["a character in hand", ["hc"]], ["no pick", []]] as Array<[string, string[]]>) {
    const g = mezzBoard({ mez: "play" });
    refused(() => g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("mez"), abilityId: "mezz-party", selected: { c: picked.map(g.id) }, variables: {} } as never), label);
    assert.equal(g.engine.state.cards[g.id("mez")].damage, 0, `${label}: no damage inflicted`);
    for (const key of ["c1", "c2", "o1", "o2", "it"]) assert.equal(isDepleted(g, key), false, `${label}: ${key}`);
  }
});

clause(MEZZ, "2:ability:mezz-party", "PARTY ON! is only available from the location in play, and only to its controller", () => {
  const inHand = mezzBoard({ mez: "hand" });
  refused(() => inHand.engine.perform({ type: "activateAbility", playerId: P1, cardId: inHand.id("mez"), abilityId: "mezz-party", selected: { c: [inHand.id("o1")] }, variables: {} } as never), "from hand");
  assert.equal(isDepleted(inHand, "o1"), false);
  // P1 makes a play; the opponent, holding priority in the window, tries to use P1's location
  const g = mezzBoard({ mez: "play", extra: [{ key: "dt", def: drawTactic("Quick Study", 0), owner: P1, zone: "hand" }] });
  castRaw(g.engine, P1, g.id("dt"));
  refused(
    () => g.engine.perform({ type: "activateAbility", playerId: P2, cardId: g.id("mez"), abilityId: "mezz-party", selected: { c: [g.id("c1")] }, variables: {} } as never),
    "the opponent can't use my location's ability",
    /control|owner|not yours|cannot|can't/i
  );
  assert.equal(g.engine.state.cards[g.id("mez")].damage, 0);
  assert.equal(isDepleted(g, "c1"), false);
});

/** Both factions restore at the start of their own turn (draw/play-resource faction, detach + restore non-resources). */
const cycleTurns = (g: MezzGame): void => {
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
};

clause(MEZZ, ["1:rule", "3:rule"], "characters depleted when the location enters play are not restored by their controller's RESTORE RULE (mine at my turn, theirs at theirs, turn after turn); other depleted characters are", () => {
  const g = mezzBoard({
    extra: [
      { key: "c3", def: character({ name: "Mine Tired", cost: 1 }), owner: P1, zone: "play", depleted: true },
      { key: "o3", def: character({ name: "Theirs Tired", cost: 1 }), owner: P2, zone: "play", depleted: true }
    ]
  });
  mezzPlay(g, ["c1", "o1"]);
  endTurn(g.engine, P1);
  assert.equal(isDepleted(g, "o1"), true, "their locked character stays depleted at their restore step");
  assert.equal(isDepleted(g, "o3"), false, "their other depleted character is restored");
  endTurn(g.engine, P2);
  assert.equal(isDepleted(g, "c1"), true, "my locked character stays depleted at my restore step");
  assert.equal(isDepleted(g, "c3"), false, "my other depleted character is restored");
  cycleTurns(g);
  assert.equal(isDepleted(g, "c1"), true, "still locked a full round later");
  assert.equal(isDepleted(g, "o1"), true);
});

clause(MEZZ, ["2:ability:mezz-party", "3:rule"], "characters depleted by PARTY ON! are not restored by the RESTORE RULE either, even after the location is gone; unrelated depleted characters are", () => {
  const g = mezzBoard({
    mez: "play",
    extra: [
      { key: "c3", def: character({ name: "Mine Tired", cost: 1 }), owner: P1, zone: "play", depleted: true },
      { key: "o3", def: character({ name: "Theirs Tired", cost: 1 }), owner: P2, zone: "play", depleted: true }
    ]
  });
  party(g, "c1");
  party(g, "o1");
  assert.equal(zoneOf(g.engine, g.id("mez")), "discard", "the location is destroyed");
  endTurn(g.engine, P1);
  assert.equal(isDepleted(g, "o1"), true);
  assert.equal(isDepleted(g, "o3"), false);
  endTurn(g.engine, P2);
  assert.equal(isDepleted(g, "c1"), true);
  assert.equal(isDepleted(g, "c3"), false);
});

const restoreTactic = (): CardDefinition =>
  tactic({
    name: "Refresh",
    cost: 0,
    behavior: {
      abilities: [{ id: "rs", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }]
    }
  });
const depleteTactic = (): CardDefinition =>
  tactic({
    name: "Exhaust",
    cost: 0,
    behavior: {
      abilities: [{ id: "dp", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "deplete", target: { type: "selected", id: "t" } }] }]
    }
  });

clause(MEZZ, "3:rule", "only the RESTORE RULE is blocked: another effect can still restore a character this card depleted", () => {
  const g = mezzBoard({ extra: [{ key: "rf", def: restoreTactic(), owner: P1, zone: "hand" }] });
  mezzPlay(g, ["c1", "o1"]);
  assert.equal(isDepleted(g, "c1"), true);
  play(g.engine, P1, g.id("rf"), { selected: { t: [g.id("c1")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(g, "c1"), false, "restored by an explicit restore effect");
  assert.equal(isDepleted(g, "o1"), true, "the other one is untouched");
});

clause(MEZZ, "3:rule", "the block is only for characters depleted BY THIS CARD: a character restored by an effect and later depleted by something else is restored by the RESTORE RULE again", () => {
  const g = mezzBoard({
    extra: [
      { key: "rf", def: restoreTactic(), owner: P1, zone: "hand" },
      { key: "ex", def: depleteTactic(), owner: P1, zone: "hand" }
    ]
  });
  mezzPlay(g, ["c1", "o1"]);
  play(g.engine, P1, g.id("rf"), { selected: { t: [g.id("c1")] } });
  assert.equal(isDepleted(g, "c1"), false);
  play(g.engine, P1, g.id("ex"), { selected: { t: [g.id("c1")] } });
  assert.equal(isDepleted(g, "c1"), true, "depleted again, by Exhaust");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(isDepleted(g, "c1"), false, "Exhaust (not the location) depleted it, so the RESTORE RULE restores it");
});

// =====================================================================================
// Port Manteau
// =====================================================================================

const MANTEAU = "e2f64e14-2f97-4905-8bb0-8bea33994928"; // location, cost 2, threshold g, structure 3 -- When this card enters play, name a card subtype. -- Players must pay 2 to play cards with the named subtype.

const demolishTactic = (): CardDefinition =>
  tactic({
    name: "Demolish",
    cost: 0,
    behavior: {
      abilities: [{ id: "dm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });

function manteauBoard(o: { mine?: Icons; theirs?: Icons; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "pm", def: printing(MANTEAU), owner: P1, zone: "hand" },
      { key: "gear", def: character({ name: "Gear Guy", subtype: ["gear"], cost: 1 }), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain Guy", subtype: ["elf"], cost: 1 }), owner: P1, zone: "hand" },
      { key: "multi", def: character({ name: "Multi Guy", subtype: ["elf", "gear"], cost: 1 }), owner: P1, zone: "hand" },
      { key: "gitem", def: item({ name: "Gear Item", subtype: ["gear"], cost: 1 }), owner: P1, zone: "hand" },
      { key: "gtac", def: drawTactic("Gear Tactic", 1, { subtype: ["gear"] }), owner: P1, zone: "hand" },
      { key: "none", def: character({ name: "No Subtype", subtype: [], cost: 1 }), owner: P1, zone: "hand" },
      { key: "ogear", def: character({ name: "Their Gear", subtype: ["gear"], cost: 1 }), owner: P2, zone: "hand" },
      { key: "oplain", def: character({ name: "Their Plain", subtype: ["elf"], cost: 1 }), owner: P2, zone: "hand" },
      ...res(o.mine ?? { greed: 12 }),
      ...res(o.theirs ?? { rage: 8 }, P2),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active ?? P1 }
  );
}
type ManteauGame = ReturnType<typeof manteauBoard>;
const playCost = (g: ManteauGame, player: PlayerId, key: string): number | undefined => g.engine.getCardPlayability(player, g.id(key)).numericCost;
const namePm = (g: ManteauGame, value: string, key = "pm"): void => {
  play(g.engine, P1, g.id(key));
  answerPending(g.engine, "nameValue", { value });
};

clause(MANTEAU, "0:rule", "entering play makes its controller name a card subtype (nothing is taxed until a subtype is named)", () => {
  const g = manteauBoard();
  assert.equal(playCost(g, P1, "gear"), 1, "before it is in play there is no tax");
  play(g.engine, P1, g.id("pm"));
  const pc = expectPending(g.engine, "nameValue");
  assert.equal(pc.playerId, P1, "its controller names the subtype");
  assert.equal(pc.valueKind, "subtype");
  assert.equal(zoneOf(g.engine, g.id("pm")), "play");
  answerPending(g.engine, "nameValue", { value: "gear" });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(playCost(g, P1, "gear"), 3);
  // the other player's Port Manteau: its controller (the opponent) names
  const opp = manteauBoard({ active: P2, extra: [{ key: "pm2", def: printing(MANTEAU), owner: P2, zone: "hand" }], theirs: { greed: 3 } });
  play(opp.engine, P2, opp.id("pm2"));
  const pc2 = expectPending(opp.engine, "nameValue");
  assert.equal(pc2.playerId, P2, "the opponent controls this copy, so the opponent names");
  answerPending(opp.engine, "nameValue", { value: "elf" });
  assert.equal(playCost(opp, P1, "plain"), 3, "it taxes me too");
  assert.equal(playCost(opp, P2, "oplain"), 3);
});

clause(MANTEAU, "0:rule", "Port Manteau itself deploys for its printed cost 2 with threshold [G]: only rage, or one resource, is refused; one [G] plus another resource works (structure 3)", () => {
  const rage = manteauBoard({ mine: { rage: 4 } });
  refused(() => castRaw(rage.engine, P1, rage.id("pm")), "no [G]");
  assert.equal(zoneOf(rage.engine, rage.id("pm")), "hand");
  const short = manteauBoard({ mine: { greed: 1 } });
  refused(() => castRaw(short.engine, P1, short.id("pm")), "one resource short of 2");
  assert.equal(zoneOf(short.engine, short.id("pm")), "hand");
  const ok = manteauBoard({ mine: { greed: 1, rage: 1 } });
  play(ok.engine, P1, ok.id("pm"));
  assert.equal(zoneOf(ok.engine, ok.id("pm")), "play");
  assert.equal(ready(ok.engine), 0, "2 paid");
  assert.equal(ok.engine.getStat(ok.id("pm"), "structure"), 3);
});

clause(MANTEAU, "1:rule", "players pay 2 more for cards with the named subtype (characters, items, tactics; mine and the opponent's; also with several subtypes) and the others cost their printed 1", () => {
  const g = manteauBoard();
  namePm(g, "gear");
  for (const [player, key] of [[P1, "gear"], [P1, "multi"], [P1, "gitem"], [P1, "gtac"], [P2, "ogear"]] as Array<[PlayerId, string]>) {
    assert.equal(playCost(g, player, key), 3, `${key} has the named subtype: 1 + 2`);
  }
  for (const [player, key] of [[P1, "plain"], [P1, "none"], [P2, "oplain"]] as Array<[PlayerId, string]>) {
    assert.equal(playCost(g, player, key), 1, `${key} does not: printed cost`);
  }
});

clause(MANTEAU, "1:rule", "the tax is really paid: deploying a gear card spends 3 resources; with only 2 ready it is refused and nothing is spent", () => {
  const poor = manteauBoard({ mine: { greed: 4 } });
  namePm(poor, "gear");
  assert.equal(ready(poor.engine), 2);
  refused(() => castRaw(poor.engine, P1, poor.id("gear")), "cost 1 + 2 with 2 resources");
  assert.equal(zoneOf(poor.engine, poor.id("gear")), "hand");
  assert.equal(ready(poor.engine), 2, "nothing spent");
  play(poor.engine, P1, poor.id("plain"));
  assert.equal(zoneOf(poor.engine, poor.id("plain")), "play", "an untaxed card still costs only 1");
  assert.equal(ready(poor.engine), 1);
  const ok = manteauBoard({ mine: { greed: 5 } });
  namePm(ok, "gear");
  play(ok.engine, P1, ok.id("gear"));
  assert.equal(zoneOf(ok.engine, ok.id("gear")), "play");
  assert.equal(ready(ok.engine), 0, "3 paid for the 1-cost card");
});

clause(MANTEAU, "1:rule", "the opponent pays the extra 2 as well: on their turn their gear card costs 3 (refused with 2 resources, accepted with 3)", () => {
  const mk = (theirs: Icons) => {
    const g = manteauBoard({ mine: { greed: 2 }, theirs });
    namePm(g, "gear");
    endTurn(g.engine, P1);
    return g;
  };
  const poor = mk({ rage: 2 });
  refused(() => castRaw(poor.engine, P2, poor.id("ogear")), "their gear card costs 3");
  assert.equal(zoneOf(poor.engine, poor.id("ogear")), "hand");
  assert.equal(ready(poor.engine, P2), 2);
  const ok = mk({ rage: 3 });
  play(ok.engine, P2, ok.id("ogear"));
  assert.equal(zoneOf(ok.engine, ok.id("ogear")), "play");
  assert.equal(ready(ok.engine, P2), 0, "all 3 paid");
});

clause(MANTEAU, "1:rule", "the named subtype is the one chosen: naming 'elf' taxes elf cards (mine and theirs) and not gear cards", () => {
  const g = manteauBoard();
  namePm(g, "elf");
  for (const [player, key] of [[P1, "plain"], [P1, "multi"], [P2, "oplain"]] as Array<[PlayerId, string]>) assert.equal(playCost(g, player, key), 3, key);
  for (const [player, key] of [[P1, "gear"], [P1, "gitem"], [P1, "none"], [P2, "ogear"]] as Array<[PlayerId, string]>) assert.equal(playCost(g, player, key), 1, key);
});

clause(MANTEAU, "1:rule", "the tax lasts only while Port Manteau is in play: destroyed, gear cards cost their printed 1 again", () => {
  const g = manteauBoard({ extra: [{ key: "dm", def: demolishTactic(), owner: P1, zone: "hand" }] });
  namePm(g, "gear");
  assert.equal(playCost(g, P1, "gear"), 3);
  play(g.engine, P1, g.id("dm"), { selected: { t: [g.id("pm")] } });
  assert.equal(zoneOf(g.engine, g.id("pm")), "discard", "Port Manteau is destroyed");
  assert.equal(playCost(g, P1, "gear"), 1);
  assert.equal(playCost(g, P2, "ogear"), 1);
  assert.equal(playCost(g, P1, "multi"), 1);
});

clause(MANTEAU, "1:rule", "two Port Manteaus each make players pay 2: the same subtype named twice costs 4 more, two different subtypes tax a card with both 2+2", () => {
  const same = manteauBoard({ extra: [{ key: "pm2", def: printing(MANTEAU), owner: P1, zone: "hand" }] });
  namePm(same, "gear");
  namePm(same, "gear", "pm2");
  assert.equal(playCost(same, P1, "gear"), 5, "1 + 2 + 2");
  assert.equal(playCost(same, P1, "plain"), 1);
  const diff = manteauBoard({ extra: [{ key: "pm2", def: printing(MANTEAU), owner: P1, zone: "hand" }] });
  namePm(diff, "gear");
  namePm(diff, "elf", "pm2");
  assert.equal(playCost(diff, P1, "multi"), 5, "elf and gear");
  assert.equal(playCost(diff, P1, "gear"), 3);
  assert.equal(playCost(diff, P1, "plain"), 3);
  assert.equal(playCost(diff, P1, "none"), 1);
});

// =====================================================================================
// Prestige Inversion
// =====================================================================================

const PRESTIGE = "4189d9eb-5a42-4fd6-bc2b-efd9e6f40ccb"; // tactic, cost 1, threshold gg -- COST: Pick a character with the UNIQUE keyword in its rules text. -- EFFECT: Remove the character from the game. -- RECUR: [G][G] -- COST: Use this only while this card is in your discard pile. Pay 1. Remove this card from the game. -- EFFECT: Draw a card.

function prestigeBoard(o: { mine?: Icons; pi?: "hand" | "discard"; piOwner?: PlayerId; extra?: CardPlacement[] } = {}) {
  return devBoard([
    { key: "pi", def: printing(PRESTIGE), owner: o.piOwner ?? P1, zone: o.pi ?? "hand" },
    { key: "u1", def: uniqueChar({ name: "Unique Theirs", unique: "theirs" }), owner: P2, zone: "play" },
    { key: "u2", def: uniqueChar({ name: "Unique Mine", unique: "mine" }), owner: P1, zone: "play" },
    { key: "u3", def: uniqueChar({ name: "Unique Bystander", unique: "bystander" }), owner: P2, zone: "play" },
    { key: "pc", def: character({ name: "Plain Char", cost: 1 }), owner: P2, zone: "play" },
    { key: "ui", def: item({ name: "Unique Relic", cost: 1, unique: "relic" }), owner: P2, zone: "play" },
    { key: "ud", def: uniqueChar({ name: "Unique Fallen", unique: "fallen" }), owner: P2, zone: "discard" },
    ...fillers("d", 4, P1, "deck"),
    ...fillers("od", 3, P2, "deck"),
    { key: "oh", def: character({ name: "Opp Hand" }), owner: P2, zone: "hand" },
    ...res(o.mine ?? { greed: 3 }),
    ...(o.extra ?? [])
  ]);
}
type PrestigeGame = ReturnType<typeof prestigeBoard>;
const prestigeTry = (g: PrestigeGame, picked: string[]): void => castRaw(g.engine, P1, g.id("pi"), { t: picked.map(g.id) });
const recur = (g: PrestigeGame, player: PlayerId = P1): void => activate(g.engine, player, g.id("pi"), "prestige-recur");
const tryRecur = (g: PrestigeGame, player: PlayerId = P1): void =>
  g.engine.perform({ type: "activateAbility", playerId: player, cardId: g.id("pi"), abilityId: "prestige-recur", selected: {}, variables: {} } as never);

clause(PRESTIGE, "0:ability", "removes the picked UNIQUE character (theirs or mine) from the game: it goes to the removed zone, not the discard pile; other UNIQUE characters stay; the tactic costs 1 and goes to my discard pile", () => {
  for (const [target, others] of [["u1", ["u2", "u3", "pc"]], ["u2", ["u1", "u3", "pc"]]] as Array<[string, string[]]>) {
    const g = prestigeBoard();
    play(g.engine, P1, g.id("pi"), { selected: { t: [g.id(target)] } });
    assert.equal(g.engine.state.pendingChoice, undefined, target);
    assert.equal(zoneOf(g.engine, g.id(target)), "removed", `${target}: removed from the game`);
    for (const key of others) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${target}: ${key} stays in play`);
    assert.equal(zoneOf(g.engine, g.id("pi")), "discard");
    assert.equal(ready(g.engine), 2, `${target}: exactly 1 paid`);
    assert.equal(zoneOf(g.engine, g.id("ud")), "discard", "the discarded unique card is not touched");
  }
});

clause(PRESTIGE, "0:ability", "the pick must be a character in play with UNIQUE: a plain character, a UNIQUE item, a UNIQUE character in the discard pile, two at once, or no pick is refused and nothing is spent", () => {
  const bad: Array<[string, string[]]> = [
    ["a character without UNIQUE", ["pc"]],
    ["a UNIQUE item", ["ui"]],
    ["a UNIQUE character in the discard pile", ["ud"]],
    ["two UNIQUE characters", ["u1", "u3"]],
    ["no pick", []]
  ];
  for (const [label, picked] of bad) {
    const g = prestigeBoard();
    refused(() => prestigeTry(g, picked), label);
    assert.equal(zoneOf(g.engine, g.id("pi")), "hand", `${label}: not played`);
    assert.equal(ready(g.engine), 3, `${label}: nothing spent`);
    for (const key of ["u1", "u2", "u3", "pc", "ui"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${label}: ${key}`);
  }
});

clause(PRESTIGE, "0:ability", "printed cost 1 and threshold [G][G]: 3 non-[G] resources, a single [G], no resources, or [G][G] already spent are refused; [G][G] works and pays exactly 1", () => {
  const cases: Array<[string, Icons, CardPlacement[]]> = [
    ["only rage", { rage: 3 }, []],
    ["a single [G]", { greed: 1, rage: 3 }, []],
    ["nothing", {}, []],
    ["[G][G] but both spent", {}, spentGreed(2)]
  ];
  for (const [label, mine, extra] of cases) {
    const g = prestigeBoard({ mine, extra });
    refused(() => prestigeTry(g, ["u1"]), label);
    assert.equal(zoneOf(g.engine, g.id("u1")), "play", label);
    assert.equal(zoneOf(g.engine, g.id("pi")), "hand", label);
  }
  const ok = prestigeBoard({ mine: { greed: 2 } });
  play(ok.engine, P1, ok.id("pi"), { selected: { t: [ok.id("u1")] } });
  assert.equal(zoneOf(ok.engine, ok.id("u1")), "removed");
  assert.equal(ready(ok.engine), 1, "exactly 1 of the 2 [G] was paid");
});

clause(PRESTIGE, "1:ability:prestige-recur", "RECUR from my discard pile: pay 1, remove this card from the game, draw exactly one card (the top of MY deck)", () => {
  const g = prestigeBoard({ pi: "discard" });
  const top = deckOf(g.engine, P1)[0];
  const deckBefore = deckOf(g.engine, P1).length;
  const oppHand = handOf(g.engine, P2);
  const oppDeck = deckOf(g.engine, P2);
  recur(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("pi")), "removed", "removed from the game");
  assert.equal(ready(g.engine), 2, "exactly 1 paid");
  assert.deepEqual(handOf(g.engine, P1), [top], "drew exactly the top card");
  assert.equal(deckOf(g.engine, P1).length, deckBefore - 1);
  assert.deepEqual(handOf(g.engine, P2), oppHand);
  assert.deepEqual(deckOf(g.engine, P2), oppDeck);
  for (const key of ["u1", "u2", "u3"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", "no character was removed");
});

clause(PRESTIGE, "1:ability:prestige-recur", "RECUR can be used only while this card is in my discard pile: from my hand, or from the opponent's discard pile, it is refused", () => {
  const hand = prestigeBoard({ pi: "hand" });
  refused(() => tryRecur(hand), "from hand");
  assert.equal(zoneOf(hand.engine, hand.id("pi")), "hand");
  assert.equal(handOf(hand.engine, P1).length, 1, "nothing drawn");
  assert.equal(ready(hand.engine), 3);
  const theirs = prestigeBoard({ pi: "discard", piOwner: P2 });
  refused(() => tryRecur(theirs), "it is in the opponent's discard pile");
  assert.equal(zoneOf(theirs.engine, theirs.id("pi")), "discard");
  assert.equal(ready(theirs.engine), 3);
  const mine = prestigeBoard({ pi: "discard" });
  recur(mine);
  assert.equal(zoneOf(mine.engine, mine.id("pi")), "removed", "positive control: from my own discard pile it works");
});

clause(PRESTIGE, "1:ability:prestige-recur", "RECUR needs [G][G] and 1 to pay: one [G] among other resources, no resources, or [G][G] already spent are refused (the card stays in the discard pile, nothing drawn)", () => {
  const cases: Array<[string, Icons, CardPlacement[]]> = [
    ["a single [G]", { greed: 1, rage: 3 }, []],
    ["only rage", { rage: 3 }, []],
    ["nothing at all", {}, []],
    ["[G][G] but both spent", {}, spentGreed(2)]
  ];
  for (const [label, mine, extra] of cases) {
    const g = prestigeBoard({ pi: "discard", mine, extra });
    refused(() => tryRecur(g), label);
    assert.equal(zoneOf(g.engine, g.id("pi")), "discard", label);
    assert.equal(handOf(g.engine, P1).length, 0, `${label}: nothing drawn`);
  }
  const ok = prestigeBoard({ pi: "discard", mine: { greed: 2 } });
  recur(ok);
  assert.equal(zoneOf(ok.engine, ok.id("pi")), "removed");
  assert.equal(handOf(ok.engine, P1).length, 1);
  assert.equal(ready(ok.engine), 1, "only 1 of the 2 [G] was paid");
});

// =====================================================================================
// Vilghame Manewaft
// =====================================================================================

const VILGHAME = "3534079d-0983-4521-a905-589de7d4b9d8"; // character, cost 5, threshold ggg, str 5 / spd 3 / life 3 -- UNIQUE VILGHAME -- Your opponent must pay 1 to play a tactic. -- The first resource each opponent plays each turn enters play attached to that opponent's faction.

const handRes = (key: string, icon: StapleIcon, owner: PlayerId): CardPlacement => ({ key, def: bank(icon, 1, owner)[0].def, owner, zone: "hand" });

interface VilOpts {
  vil?: "play" | "hand";
  mine?: Icons;
  theirs?: Icons;
  active?: PlayerId;
  extra?: CardPlacement[];
  playerB?: CardDefinition;
}
function vilBoard(o: VilOpts = {}) {
  return devBoard(
    [
      { key: "v", def: printing(VILGHAME), owner: P1, zone: o.vil ?? "play" },
      { key: "ot2", def: drawTactic("Opp Tactic", 2), owner: P2, zone: "hand" },
      { key: "ot0", def: drawTactic("Opp Free Tactic", 0), owner: P2, zone: "hand" },
      { key: "oc", def: character({ name: "Opp Char", cost: 2 }), owner: P2, zone: "hand" },
      { key: "oi", def: item({ name: "Opp Item", cost: 2 }), owner: P2, zone: "hand" },
      { key: "mt", def: drawTactic("My Tactic", 2), owner: P1, zone: "hand" },
      ...fillers("pd", 4, P1, "deck"),
      ...fillers("od", 4, P2, "deck"),
      ...res(o.mine ?? { greed: 6 }),
      ...res(o.theirs ?? { rage: 6 }, P2),
      ...(o.extra ?? [])
    ],
    { activePlayerId: o.active ?? P2, ...(o.playerB ? { playerB: { faction: o.playerB } } : {}) }
  );
}
type VilGame = ReturnType<typeof vilBoard>;
const vilCost = (g: VilGame, player: PlayerId, key: string): number | undefined => g.engine.getCardPlayability(player, g.id(key)).numericCost;

clause(VILGHAME, "1:rule", "my opponent pays 1 more for a tactic: cost 2 becomes 3, a free tactic costs 1; the extra is really spent, and one resource short is refused", () => {
  const g = vilBoard();
  assert.equal(vilCost(g, P2, "ot2"), 3);
  assert.equal(vilCost(g, P2, "ot0"), 1);
  play(g.engine, P2, g.id("ot2"));
  assert.equal(zoneOf(g.engine, g.id("ot2")), "discard");
  assert.equal(ready(g.engine, P2), 3, "paid 3 of 6");
  play(g.engine, P2, g.id("ot0"));
  assert.equal(zoneOf(g.engine, g.id("ot0")), "discard");
  assert.equal(ready(g.engine, P2), 2, "the free tactic cost 1");
  const poor = vilBoard({ theirs: { rage: 2 } });
  refused(() => castRaw(poor.engine, P2, poor.id("ot2")), "cost 2 + 1 with 2 resources");
  assert.equal(zoneOf(poor.engine, poor.id("ot2")), "hand");
  assert.equal(ready(poor.engine, P2), 2, "nothing spent");
  const none = vilBoard({ theirs: {} });
  refused(() => castRaw(none.engine, P2, none.id("ot0")), "a free tactic still costs 1");
  assert.equal(zoneOf(none.engine, none.id("ot0")), "hand");
});

clause(VILGHAME, "1:rule", "only the opponent's TACTICS are taxed: my own tactic, and their character and item, cost the printed 2", () => {
  const g = vilBoard();
  assert.equal(vilCost(g, P1, "mt"), 2, "my own tactic");
  assert.equal(vilCost(g, P2, "oc"), 2, "their character");
  assert.equal(vilCost(g, P2, "oi"), 2, "their item");
  play(g.engine, P2, g.id("oc"));
  assert.equal(zoneOf(g.engine, g.id("oc")), "play");
  assert.equal(ready(g.engine, P2), 4, "the character cost its printed 2");
});

clause(VILGHAME, "1:rule", "the tax needs Vilghame IN PLAY: in my hand it changes nothing, and once it is destroyed the opponent's tactics cost their printed cost again", () => {
  const inHand = vilBoard({ vil: "hand" });
  assert.equal(vilCost(inHand, P2, "ot2"), 2);
  assert.equal(vilCost(inHand, P2, "ot0"), 0);
  const g = vilBoard({ extra: [{ key: "kt", def: killTactic(), owner: P2, zone: "hand" }] });
  assert.equal(vilCost(g, P2, "kt"), 1, "a free removal tactic is taxed too");
  play(g.engine, P2, g.id("kt"), { selected: { t: [g.id("v")] } });
  assert.equal(zoneOf(g.engine, g.id("v")), "discard", "Vilghame is destroyed (3 life vs the destroy effect)");
  assert.equal(vilCost(g, P2, "ot2"), 2);
  assert.equal(vilCost(g, P2, "ot0"), 0);
});

clause(VILGHAME, "1:rule", "the tax also applies to a tactic the opponent plays as a RESPONSE on my turn: a cost-2 tactic costs them 3, and my own tactic that they respond to is not taxed", () => {
  const g = vilBoard({ active: P1 });
  castRaw(g.engine, P1, g.id("mt"));
  assert.equal(ready(g.engine, P1), 4, "my own cost-2 tactic cost 2");
  castRaw(g.engine, P2, g.id("ot2"));
  assert.equal(ready(g.engine, P2), 3, "their response cost 2 + 1");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ot2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("mt")), "discard");
});

/** Plays `key` through the faction's Develop Rule (face-up or face-down) and closes response windows. */
const developRes = (g: VilGame, player: PlayerId, keys: string[], faceDown = false): void => {
  developResources(g.engine, player, keys.map((key) => g.id(key)), faceDown);
  resolvePendingResponses(g.engine);
};
const attachedToFaction = (g: VilGame, key: string, player: PlayerId): boolean => g.engine.state.cards[g.id(key)].attachedTo === factionOf(g.engine, player);

clause(VILGHAME, "2:rule", "the first resource my opponent plays enters play attached to their faction (spent: it can't pay for anything), face-up or face-down; with Vilghame in hand it enters ready", () => {
  for (const faceDown of [false, true]) {
    const g = vilBoard({ theirs: { rage: 2 }, extra: [handRes("r1", "rage", P2)] });
    developRes(g, P2, ["r1"], faceDown);
    assert.equal(zoneOf(g.engine, g.id("r1")), "play", `faceDown=${faceDown}`);
    assert.equal(attachedToFaction(g, "r1", P2), true, `faceDown=${faceDown}: attached to the opponent's faction`);
    assert.equal(ready(g.engine, P2), 2, `faceDown=${faceDown}: it adds nothing to their pool`);
  }
  const control = vilBoard({ vil: "hand", theirs: { rage: 2 }, extra: [handRes("r1", "rage", P2)] });
  developRes(control, P2, ["r1"]);
  assert.equal(attachedToFaction(control, "r1", P2), false);
  assert.equal(ready(control.engine, P2), 3, "without Vilghame in play the resource is ready");
});

clause(VILGHAME, "2:rule", "only OPPONENTS' resources are redirected: my own first resource enters play ready", () => {
  const g = vilBoard({ active: P1, mine: { greed: 2 }, extra: [handRes("r1", "greed", P1)] });
  developRes(g, P1, ["r1"]);
  assert.equal(zoneOf(g.engine, g.id("r1")), "play");
  assert.equal(attachedToFaction(g, "r1", P1), false);
  assert.equal(g.engine.state.cards[g.id("r1")].attachedTo, undefined);
  assert.equal(ready(g.engine, P1), 3);
});

clause(VILGHAME, "2:rule", "only the FIRST resource each turn: when the opponent plays two in one turn, the first is attached and the second enters ready", () => {
  const base = developFaction();
  const twoResources = developFaction({
    faction: { ...base.faction!, turn: { ...base.faction!.turn, develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 2 }] } } } as never
  });
  const g = vilBoard({ playerB: twoResources, theirs: {}, extra: [handRes("r1", "rage", P2), handRes("r2", "rage", P2)] });
  developRes(g, P2, ["r1", "r2"]);
  assert.equal(zoneOf(g.engine, g.id("r1")), "play");
  assert.equal(zoneOf(g.engine, g.id("r2")), "play");
  assert.equal(attachedToFaction(g, "r1", P2), true, "the first is attached");
  assert.equal(attachedToFaction(g, "r2", P2), false, "the second is not");
  assert.equal(ready(g.engine, P2), 1, "only the second resource is ready");
});

clause(VILGHAME, "2:rule", "'each turn': on the opponent's next turn their first resource is attached again", () => {
  const g = vilBoard({ theirs: {}, extra: [handRes("r1", "rage", P2), handRes("r2", "rage", P2)] });
  developRes(g, P2, ["r1"]);
  assert.equal(attachedToFaction(g, "r1", P2), true);
  endTurn(g.engine, P2);
  endTurn(g.engine, P1);
  assert.equal(attachedToFaction(g, "r1", P2), false, "their restore step detached the first resource");
  assert.equal(ready(g.engine, P2), 1);
  developRes(g, P2, ["r2"]);
  assert.equal(zoneOf(g.engine, g.id("r2")), "play");
  assert.equal(attachedToFaction(g, "r2", P2), true, "the new turn's first resource is attached again");
  assert.equal(ready(g.engine, P2), 1);
});

clause(VILGHAME, "2:rule", "the redirection stops when Vilghame is destroyed: the opponent's next resource enters ready", () => {
  const g = vilBoard({ theirs: { rage: 2 }, extra: [{ key: "kt", def: killTactic(), owner: P2, zone: "hand" }, handRes("r1", "rage", P2)] });
  play(g.engine, P2, g.id("kt"), { selected: { t: [g.id("v")] } });
  assert.equal(zoneOf(g.engine, g.id("v")), "discard");
  const before = ready(g.engine, P2);
  developRes(g, P2, ["r1"]);
  assert.equal(attachedToFaction(g, "r1", P2), false);
  assert.equal(ready(g.engine, P2), before + 1);
});

const vilUniqueBoard = (extra: CardPlacement[] = []) =>
  devBoard(
    [
      { key: "old", def: printing(VILGHAME), owner: P1, zone: "play" },
      { key: "new", def: printing(VILGHAME), owner: P1, zone: "hand" },
      { key: "by", def: character({ name: "Bystander", cost: 1 }), owner: P1, zone: "play" },
      ...res({ greed: 3, rage: 2 }),
      ...extra
    ],
    { activePlayerId: P1 }
  );
const keepVil = (engine: SpoilsEngine, keep: CardInstanceId): void =>
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep } } as never);

clause(VILGHAME, "0:unique", "has UNIQUE VILGHAME: a second Vilghame under my control makes me choose one to keep; keeping the new one destroys the old, keeping the old destroys the new", () => {
  const a = vilUniqueBoard();
  play(a.engine, P1, a.id("new"));
  const pc = expectPending(a.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [a.id("old"), a.id("new")].sort());
  keepVil(a.engine, a.id("new"));
  assert.equal(a.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(a.engine, a.id("new")), "play");
  assert.equal(zoneOf(a.engine, a.id("old")), "discard");
  assert.equal(zoneOf(a.engine, a.id("by")), "play", "the bystander is untouched");
  const b = vilUniqueBoard();
  play(b.engine, P1, b.id("new"));
  expectPending(b.engine, "uniqueSurvivor");
  keepVil(b.engine, b.id("old"));
  assert.equal(zoneOf(b.engine, b.id("old")), "play");
  assert.equal(zoneOf(b.engine, b.id("new")), "discard");
});

clause(VILGHAME, "0:unique", "after I choose which Vilghame to keep, the deployment finishes: the response window closes and the game goes on", () => {
  const g = vilUniqueBoard();
  play(g.engine, P1, g.id("new"));
  expectPending(g.engine, "uniqueSurvivor");
  keepVil(g.engine, g.id("new"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "no stuck response window");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("new")), "play");
});

clause(VILGHAME, "0:unique", "only a candidate can be kept: a bystander is refused and the choice stays open", () => {
  const g = vilUniqueBoard();
  play(g.engine, P1, g.id("new"));
  expectPending(g.engine, "uniqueSurvivor");
  refused(() => keepVil(g.engine, g.id("by")), "a bystander cannot be the survivor", /unique|survivor|candidate|keep|choice/i);
  assert.equal(zoneOf(g.engine, g.id("by")), "play");
  expectPending(g.engine, "uniqueSurvivor");
});

clause(VILGHAME, "0:unique", "UNIQUE is per player: my opponent controlling their own Vilghame does not trigger it", () => {
  const g = vilUniqueBoard();
  g.engine.state.cards[g.id("old")].controllerId = P2;
  play(g.engine, P1, g.id("new"));
  assert.equal(g.engine.state.pendingChoice, undefined, "no choice is needed");
  assert.equal(zoneOf(g.engine, g.id("new")), "play");
  assert.equal(zoneOf(g.engine, g.id("old")), "play");
});

clause(VILGHAME, "0:unique", "the identifier is VILGHAME: another card carrying UNIQUE VILGHAME also counts, a different identifier does not", () => {
  const same = devBoard(
    [{ key: "other", def: character({ name: "Other Vilghame", unique: "vilghame" }), owner: P1, zone: "play" }, { key: "new", def: printing(VILGHAME), owner: P1, zone: "hand" }, ...res({ greed: 3, rage: 2 })],
    { activePlayerId: P1 }
  );
  play(same.engine, P1, same.id("new"));
  expectPending(same.engine, "uniqueSurvivor");
  const diff = devBoard(
    [{ key: "other", def: character({ name: "Other Unique", unique: "somethingelse" }), owner: P1, zone: "play" }, { key: "new", def: printing(VILGHAME), owner: P1, zone: "hand" }, ...res({ greed: 3, rage: 2 })],
    { activePlayerId: P1 }
  );
  play(diff.engine, P1, diff.id("new"));
  assert.equal(diff.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(diff.engine, diff.id("other")), "play");
  assert.equal(zoneOf(diff.engine, diff.id("new")), "play");
});

clause(VILGHAME, "0:unique", "deploys for its printed cost 5 with threshold [G][G][G] and has the printed 5 strength / 3 speed / 3 life; 4 resources or only two [G] are refused", () => {
  const board = (mine: Icons) => vilBoard({ vil: "hand", mine, active: P1 });
  const short = board({ greed: 3, rage: 1 });
  refused(() => castRaw(short.engine, P1, short.id("v")), "one short of 5");
  assert.equal(zoneOf(short.engine, short.id("v")), "hand");
  const noThreshold = board({ greed: 2, rage: 3 });
  refused(() => castRaw(noThreshold.engine, P1, noThreshold.id("v")), "only two [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("v")), "hand");
  const ok = board({ greed: 3, rage: 2 });
  play(ok.engine, P1, ok.id("v"));
  assert.equal(zoneOf(ok.engine, ok.id("v")), "play");
  assert.equal(ready(ok.engine), 0, "5 paid");
  assert.equal(ok.engine.getStat(ok.id("v"), "strength"), 5);
  assert.equal(ok.engine.getStat(ok.id("v"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("v"), "life"), 3);
});

