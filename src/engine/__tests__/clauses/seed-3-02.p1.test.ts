// Clause tests, batch seed-3-02, part p1 (groups 1-4): Axeclaw Grandchest, Community Chest,
// Delicious Strawberry Flavored Death, Fornicaves. Every expectation comes from the PRINTED text.

import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, killTactic, location, P1, P2, play, resolvePendingResponses, resourceCard, tactic } from "../per-card/_harness.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import { declareAttackOpenWindow, fight } from "./_battle.js";
import { pending, zoneOf } from "./_board.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { endTurn, setupGame, settleStartFirst } from "./_turn.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;

/** Player P1 and P2 each get a faction that can develop (draw or play a resource). */
const factions = () => ({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() } });

/** A free tactic that draws its controller one card. */
const drawTactic = () =>
  tactic({ name: "DrawOne", cost: 0, behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

/** Deterministic pseudo-random source (LCG) for shuffles. */
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const deckCards = (owner: PlayerId, costs: number[], prefix: string): Cards =>
  costs.map((cost, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}`, cost }), owner, zone: "deck" as const }));

// ===========================================================================================
// Axeclaw Grandchest
// ===========================================================================================

const AXE = "b57044fc-e7a2-409d-bbf2-2dbe4e93519e"; // character . rogue . cost 4 . [D][D][D] . 0/4/4 -- UNIQUE GRANDCHEST -- The top card of your deck is revealed at all times. -- While the top card of your deck is revealed, this card gains X strength, where X is the numeric cost of that card. -- SHAKE UP -- COST: Pay 2. -- EFFECT: Shuffle your deck.
const SHIELDMANE = "452bed36-af64-4986-905b-6074fd01437b"; // another UNIQUE GRANDCHEST card
const RAGE = "3be26b3f-2c78-4d0c-8849-0b4ca48951fd"; // real staple resource (Rage)

interface AxeOpts {
  p1Costs?: number[];
  p2Costs?: number[];
  extra?: Cards;
  axeZone?: "play" | "hand";
  axeController?: PlayerId;
  axeDepleted?: boolean;
  axeFresh?: boolean;
  turn?: number;
  active?: PlayerId;
  random?: () => number;
  p2Influence?: number;
}
function axeBoard(opts: AxeOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), ...(opts.p2Influence ? { influence: opts.p2Influence } : {}) },
    ...(opts.random ? { random: opts.random } : {}),
    ...(opts.turn ? { turn: opts.turn, activePlayerId: opts.active ?? P1 } : {}),
    cards: [
      {
        key: "ax",
        def: printing(AXE),
        owner: P1,
        zone: opts.axeZone ?? "play",
        ...(opts.axeController ? { controller: opts.axeController } : {}),
        ...(opts.axeDepleted ? { depleted: true } : {}),
        ...(opts.axeFresh ? { attackEligible: false } : {})
      },
      ...deckCards(P1, opts.p1Costs ?? [], "a"),
      ...deckCards(P2, opts.p2Costs ?? [], "b"),
      ...(opts.extra ?? [])
    ]
  });
}
const revealedTop = (engine: SpoilsEngine) => engine.getFlowView().revealed.deckTop;
const deckOf = (engine: SpoilsEngine, p: PlayerId) => [...engine.state.players[p].deck];

// --- 0:unique ---------------------------------------------------------------------

function pendingSurvivor(engine: SpoilsEngine) {
  return engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] };
}
const keep = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId) =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "uniqueSurvivor", keep: cardId } } as never);

clause(AXE, "0:unique", "a second copy: its controller chooses which to keep (keep the new one: the old one is destroyed)", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "ax", def: printing(AXE), owner: P1, zone: "play" },
      { key: "ax2", def: printing(AXE), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1)
    ]
  });
  play(engine, P1, id("ax2"));
  const pc = pendingSurvivor(engine);
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("ax"), id("ax2")].sort());
  keep(engine, P1, id("ax2"));
  assert.equal(zoneOf(engine, id("ax2")), "play");
  assert.equal(zoneOf(engine, id("ax")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(AXE, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "ax", def: printing(AXE), owner: P1, zone: "play" },
      { key: "ax2", def: printing(AXE), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1)
    ]
  });
  play(engine, P1, id("ax2"));
  keep(engine, P1, id("ax"));
  assert.equal(zoneOf(engine, id("ax")), "play");
  assert.equal(zoneOf(engine, id("ax2")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(AXE, "0:unique", "UNIQUE is per player: the opponent may control their own Axeclaw Grandchest with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    ...factions(),
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ax", def: printing(AXE), owner: P1, zone: "play" },
      { key: "ax2", def: printing(AXE), owner: P2, zone: "hand" },
      ...bank("deception", 4, P2)
    ]
  });
  play(engine, P2, id("ax2"));
  assert.equal(engine.state.pendingChoice, undefined, "no survivor choice for the opponent's own copy");
  assert.equal(zoneOf(engine, id("ax")), "play");
  assert.equal(zoneOf(engine, id("ax2")), "play");
});

clause(AXE, "0:unique", "the UNIQUE name GRANDCHEST is shared with other Grandchest cards: Axeclaw + Shieldmane Grandchest force a choice", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "shield", def: printing(SHIELDMANE), owner: P1, zone: "play" },
      { key: "ax", def: printing(AXE), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1)
    ]
  });
  play(engine, P1, id("ax"));
  const pc = pendingSurvivor(engine);
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates].sort(), [id("ax"), id("shield")].sort());
  keep(engine, P1, id("shield"));
  assert.equal(zoneOf(engine, id("shield")), "play");
  assert.equal(zoneOf(engine, id("ax")), "discard");
});

clause(AXE, "0:unique", "a non-Grandchest character in play does not trigger UNIQUE", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "other", def: character({ name: "Other Seraphim", subtype: ["seraphim"] }), owner: P1, zone: "play" },
      { key: "ax", def: printing(AXE), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1)
    ]
  });
  play(engine, P1, id("ax"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("ax")), "play");
  assert.equal(zoneOf(engine, id("other")), "play");
});

clause(AXE, "0:unique", "deploys for exactly 4 with [D][D][D]; one resource short and one [D] short are refused; printed 0 strength / 4 speed / 4 life (empty deck)", () => {
  const mk = (res: Cards) => buildGame({ ...factions(), cards: [{ key: "ax", def: printing(AXE), owner: P1, zone: "hand" }, ...res] });
  const ok = mk([...bank("deception", 3, P1), ...bank("rage", 2, P1)]);
  play(ok.engine, P1, ok.id("ax"));
  assert.equal(zoneOf(ok.engine, ok.id("ax")), "play");
  assert.equal(ok.engine.getAvailableResourceCount(P1), 1, "cost 4 of 5 resources");
  assert.equal(ok.engine.getStat(ok.id("ax"), "strength"), 0);
  assert.equal(ok.engine.getStat(ok.id("ax"), "speed"), 4);
  assert.equal(ok.engine.getStat(ok.id("ax"), "life"), 4);

  const short = mk(bank("deception", 3, P1));
  refused(() => play(short.engine, P1, short.id("ax")), "3 resources for a cost-4 card");
  assert.equal(zoneOf(short.engine, short.id("ax")), "hand");

  const noThreshold = mk([...bank("deception", 2, P1), ...bank("rage", 2, P1)]);
  refused(() => play(noThreshold.engine, P1, noThreshold.id("ax")), "only [D][D] of [D][D][D]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("ax")), "hand");
});

// --- 1:rule: the top card of your deck is revealed at all times --------------------------

clause(AXE, "1:rule", "while in play, the top card of its controller's deck is revealed; the opponent's deck top is not", () => {
  const { engine, id } = axeBoard({ p1Costs: [2, 5, 1], p2Costs: [3, 3] });
  assert.equal(engine.state.players[P1].deck[0], id("a0"), "control: a0 is the top of the deck");
  assert.deepEqual(revealedTop(engine), [{ playerId: P1, cardId: id("a0") }]);
});

clause(AXE, "1:rule", "'at all times': still revealed on the opponent's turn", () => {
  const { engine, id } = axeBoard({ p1Costs: [2, 5, 1], p2Costs: [3, 3], turn: 2, active: P2 });
  assert.deepEqual(revealedTop(engine), [{ playerId: P1, cardId: id("a0") }]);
});

clause(AXE, "1:rule", "not revealed while it is in hand; revealed once it enters play; not revealed again after it leaves play", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "ax", def: printing(AXE), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1),
      ...deckCards(P1, [2, 5, 1], "a")
    ]
  });
  assert.deepEqual(revealedTop(engine), [], "in hand");
  play(engine, P1, id("ax"));
  assert.equal(zoneOf(engine, id("ax")), "play");
  assert.deepEqual(revealedTop(engine), [{ playerId: P1, cardId: id("a0") }], "in play");
  play(engine, P1, id("kill"), { selected: { t: [id("ax")] } });
  assert.equal(zoneOf(engine, id("ax")), "discard", "control: it left play");
  assert.deepEqual(revealedTop(engine), [], "off again after it left play");
});

clause(AXE, "1:rule", "the revealed card follows the top of the deck as it changes (after a draw)", () => {
  const { engine, id } = axeBoard({ p1Costs: [2, 5, 1], extra: [{ key: "dr", def: drawTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(revealedTop(engine), [{ playerId: P1, cardId: id("a0") }]);
  play(engine, P1, id("dr"));
  assert.ok(engine.state.players[P1].hand.includes(id("a0")), "control: a0 was drawn");
  assert.deepEqual(revealedTop(engine), [{ playerId: P1, cardId: id("a1") }]);
});

clause(AXE, "1:rule", "'your deck' is its controller's deck: owner P1 but controlled by P2 reveals P2's deck top", () => {
  const { engine, id } = axeBoard({ p1Costs: [2, 5], p2Costs: [3, 3], axeController: P2 });
  assert.deepEqual(revealedTop(engine), [{ playerId: P2, cardId: id("b0") }]);
});

clause(AXE, "1:rule", "each player's own Axeclaw Grandchest reveals its own controller's deck top", () => {
  const { engine, id } = axeBoard({
    p1Costs: [2, 5],
    p2Costs: [3, 3],
    extra: [{ key: "ax2", def: printing(AXE), owner: P2, zone: "play" }]
  });
  const top = revealedTop(engine);
  assert.equal(top.length, 2);
  assert.deepEqual(
    [...top].sort((a, b) => a.playerId.localeCompare(b.playerId)),
    [
      { playerId: P1, cardId: id("a0") },
      { playerId: P2, cardId: id("b0") }
    ]
  );
});

clause(AXE, "1:rule", "an empty deck has no top card to reveal", () => {
  const { engine } = axeBoard({ p1Costs: [] });
  assert.deepEqual(revealedTop(engine), []);
});

// --- 2:rule: gains X strength, X = numeric cost of the revealed top card ----------------------

clause(AXE, "2:rule", "gains strength equal to the top card's cost: cost 0 -> 0, cost 4 -> 4, cost 7 -> 7", () => {
  for (const cost of [0, 4, 7]) {
    const { engine, id } = axeBoard({ p1Costs: [cost, 9] });
    assert.equal(engine.getStat(id("ax"), "strength"), cost, `top card cost ${cost}`);
  }
});

clause(AXE, "2:rule", "only 'your deck' counts: the opponent's deck top does not change its strength", () => {
  const { engine, id } = axeBoard({ p1Costs: [2], p2Costs: [6] });
  assert.equal(engine.getStat(id("ax"), "strength"), 2);
});

clause(AXE, "2:rule", "only this card gains the strength: another character keeps its printed strength", () => {
  const { engine, id } = axeBoard({
    p1Costs: [4],
    extra: [{ key: "by", def: character({ name: "Bystander", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }]
  });
  assert.equal(engine.getStat(id("ax"), "strength"), 4);
  assert.equal(engine.getStat(id("by"), "strength"), 1);
});

clause(AXE, "2:rule", "the strength is GAINED, so it adds to other strength bonuses (top cost 3 + a +2 strength aura = 5)", () => {
  const aura = item({
    name: "Strength Aura",
    behavior: { abilities: [{ id: "aura", type: "continuous", modifiers: [{ selector: { zone: "play", type: "character" }, stat: "strength", operation: "add", value: 2 }] }] }
  });
  const { engine, id } = axeBoard({ p1Costs: [3, 1], extra: [{ key: "aura", def: aura, owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("ax"), "strength"), 5);
});

clause(AXE, "2:rule", "X follows the top card as it changes: a draw moves it from cost 3 to cost 5", () => {
  const { engine, id } = axeBoard({ p1Costs: [3, 5], extra: [{ key: "dr", def: drawTactic(), owner: P1, zone: "hand" }] });
  assert.equal(engine.getStat(id("ax"), "strength"), 3);
  play(engine, P1, id("dr"));
  assert.equal(engine.getStat(id("ax"), "strength"), 5);
});

clause(AXE, "2:rule", "an empty deck gives X = 0 (strength stays at its printed 0)", () => {
  const { engine, id } = axeBoard({ p1Costs: [] });
  assert.equal(engine.getStat(id("ax"), "strength"), 0);
});

clause(AXE, "2:rule", "a top card with no numeric cost (a staple resource) gives X = 0", () => {
  const { engine, id } = axeBoard({ extra: [{ key: "res", def: printing(RAGE), owner: P1, zone: "deck" }] });
  assert.equal(engine.state.players[P1].deck[0], id("res"), "control: the resource is on top");
  assert.equal(engine.getStat(id("ax"), "strength"), 0);
});

clause(AXE, "2:rule", "'your deck' is its controller's deck: owner P1 but controlled by P2 uses P2's deck top", () => {
  const { engine, id } = axeBoard({ p1Costs: [2], p2Costs: [6], axeController: P2 });
  assert.equal(engine.getStat(id("ax"), "strength"), 6);
});

clause(AXE, "2:rule", "no bonus while it is in hand (the rule only works in play)", () => {
  const { engine, id } = axeBoard({ p1Costs: [4], axeZone: "hand" });
  assert.equal(engine.getStat(id("ax"), "strength"), 0);
});

clause(AXE, "2:rule", "the gained strength is real: its battle damage to the faction equals the top card's cost (3)", () => {
  const { engine, id } = axeBoard({ p1Costs: [3, 1], p2Influence: 20 });
  fight(engine, P1, [id("ax")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.players[P2].influence, 17);
});

// --- 3:ability: SHAKE UP ----------------------------------------------------------------------

clause(AXE, "3:ability:axeclaw-shakeup", "COST: Pay 2 is paid (3 resources -> 1 left), and Axeclaw itself is not depleted", () => {
  const { engine, id } = axeBoard({ p1Costs: [1, 2, 3, 4, 5, 6, 7, 8], random: lcg(12345), extra: bank("rage", 3, P1) });
  activate(engine, P1, id("ax"), "axeclaw-shakeup");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.getAvailableResourceCount(P1), 1, "paid exactly 2");
  assert.equal(engine.state.cards[id("ax")].depleted, false, "no deplete cost");
});

clause(AXE, "3:ability:axeclaw-shakeup", "refused with only 1 resource (cost 2); the deck is left alone", () => {
  const { engine, id } = axeBoard({ p1Costs: [1, 2, 3, 4, 5, 6, 7, 8], random: lcg(12345), extra: bank("rage", 1, P1) });
  const before = deckOf(engine, P1);
  refused(() => activate(engine, P1, id("ax"), "axeclaw-shakeup"), "1 resource for Pay 2");
  assert.deepEqual(deckOf(engine, P1), before);
  assert.equal(engine.getAvailableResourceCount(P1), 1);
});

clause(AXE, "3:ability:axeclaw-shakeup", "EFFECT: shuffles your deck (same cards, new order); the opponent's deck is untouched", () => {
  const { engine, id } = axeBoard({
    p1Costs: [1, 2, 3, 4, 5, 6, 7, 8],
    p2Costs: [1, 2, 3, 4, 5, 6, 7, 8],
    random: lcg(12345),
    extra: bank("rage", 2, P1)
  });
  const mine = deckOf(engine, P1);
  const theirs = deckOf(engine, P2);
  activate(engine, P1, id("ax"), "axeclaw-shakeup");
  const after = deckOf(engine, P1);
  assert.notDeepEqual(after, mine, "the order changed");
  assert.deepEqual([...after].sort(), [...mine].sort(), "same cards");
  assert.deepEqual(deckOf(engine, P2), theirs, "opponent's deck is not shuffled");
});

clause(AXE, "3:ability:axeclaw-shakeup", "after the shuffle the new top card is revealed and X follows it", () => {
  const { engine, id } = axeBoard({ p1Costs: [1, 2, 3, 4, 5, 6, 7, 8], random: lcg(12345), extra: bank("rage", 2, P1) });
  assert.equal(engine.getStat(id("ax"), "strength"), 1, "control: a0 (cost 1) starts on top");
  activate(engine, P1, id("ax"), "axeclaw-shakeup");
  const newTop = engine.state.players[P1].deck[0];
  assert.notEqual(newTop, id("a0"), "control: a different card is on top now");
  const index = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => id(`a${i}`) === newTop)!;
  assert.deepEqual(revealedTop(engine), [{ playerId: P1, cardId: newTop }]);
  assert.equal(engine.getStat(id("ax"), "strength"), index + 1, "X = cost of the new top card");
});

clause(AXE, "3:ability:axeclaw-shakeup", "no other restriction: usable twice in a turn, while depleted, and the turn it entered play", () => {
  const { engine, id } = axeBoard({ p1Costs: [1, 2, 3, 4, 5, 6, 7, 8], random: lcg(777), extra: bank("rage", 4, P1), axeDepleted: true, axeFresh: true });
  assert.equal(engine.state.cards[id("ax")].depleted, true, "control: starts depleted");
  activate(engine, P1, id("ax"), "axeclaw-shakeup");
  activate(engine, P1, id("ax"), "axeclaw-shakeup");
  assert.equal(engine.getAvailableResourceCount(P1), 0, "paid 2 twice");
  refused(() => activate(engine, P1, id("ax"), "axeclaw-shakeup"), "no resources left for a third use");
});

// ===========================================================================================
// Community Chest
// ===========================================================================================

const CHEST = "fe7095e0-d918-420c-9303-fbc5054d2564"; // item . rogue . cost 2 . [D] -- UNIQUE COMMUNITY CHEST -- At the start of each player's turn, both players may draw a card or play a resource. -- If you control at least [D] and choose to put this card on the bottom of your deck as part of your mulligan at the start of a game, you may reveal it. If you do, draw a card at the start of your turn.

interface ChestOpts {
  turn?: number;
  active?: PlayerId;
  chestOwner?: PlayerId;
  chestZone?: "play" | "hand";
  noChest?: boolean;
  extra?: Cards;
}
/** Chest in play; P1 hand h1,h2 + deck d0..d2; P2 hand g1,g2 + deck e0..e2. */
function chestBoard(opts: ChestOpts = {}) {
  return buildGame({
    ...factions(),
    ...(opts.turn ? { turn: opts.turn, activePlayerId: opts.active ?? P1 } : {}),
    cards: [
      ...(opts.noChest ? [] : [{ key: "cc", def: printing(CHEST), owner: opts.chestOwner ?? P1, zone: opts.chestZone ?? ("play" as const) }]),
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" as const },
      { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" as const },
      { key: "g1", def: character({ name: "G1" }), owner: P2, zone: "hand" as const },
      { key: "g2", def: character({ name: "G2" }), owner: P2, zone: "hand" as const },
      ...deckCards(P1, [1, 1, 1], "d"),
      ...deckCards(P2, [1, 1, 1], "e"),
      ...(opts.extra ?? [])
    ]
  });
}

interface Say {
  pay: boolean;
  option?: number;
  pick?: string[];
}
/** Answers every start-of-turn Chest prompt from `script`; returns the players that were asked the "may" question. */
function answerChest(engine: SpoilsEngine, script: Partial<Record<PlayerId, Say>>): PlayerId[] {
  const asked: PlayerId[] = [];
  let guard = 0;
  while (engine.state.pendingChoice && guard++ < 20) {
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId };
    const say = script[pc.playerId];
    assert.ok(say, `unexpected ${pc.kind} prompt for ${pc.playerId}`);
    let choice: unknown;
    if (pc.kind === "mayPay") {
      asked.push(pc.playerId);
      choice = { kind: "mayPay", pay: say.pay };
    } else if (pc.kind === "chooserSelectsOption") {
      choice = { kind: "chooserSelectsOption", index: say.option ?? 0 };
    } else if (pc.kind === "chooserSelectsTarget") {
      choice = { kind: "chooserSelectsTarget", selected: say.pick ?? [] };
    } else {
      throw new Error(`unexpected pending choice ${pc.kind}`);
    }
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  assert.equal(engine.state.pendingChoice, undefined, "all prompts answered");
  return asked;
}
const handOf = (engine: SpoilsEngine, p: PlayerId) => [...engine.state.players[p].hand];
const playOf = (engine: SpoilsEngine, p: PlayerId) => [...engine.state.players[p].play];

// --- 0:unique ---------------------------------------------------------------------

clause(CHEST, "0:unique", "a second copy: its controller chooses which to keep (keep the new one: the old one is destroyed)", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "cc", def: printing(CHEST), owner: P1, zone: "play" },
      { key: "cc2", def: printing(CHEST), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1)
    ]
  });
  play(engine, P1, id("cc2"));
  const pc = pendingSurvivor(engine);
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("cc"), id("cc2")].sort());
  keep(engine, P1, id("cc2"));
  assert.equal(zoneOf(engine, id("cc2")), "play");
  assert.equal(zoneOf(engine, id("cc")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(CHEST, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "cc", def: printing(CHEST), owner: P1, zone: "play" },
      { key: "cc2", def: printing(CHEST), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1)
    ]
  });
  play(engine, P1, id("cc2"));
  keep(engine, P1, id("cc"));
  assert.equal(zoneOf(engine, id("cc")), "play");
  assert.equal(zoneOf(engine, id("cc2")), "discard");
});

clause(CHEST, "0:unique", "UNIQUE is per player: the opponent may control their own Community Chest with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    ...factions(),
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cc", def: printing(CHEST), owner: P1, zone: "play" },
      { key: "cc2", def: printing(CHEST), owner: P2, zone: "hand" },
      ...bank("deception", 2, P2)
    ]
  });
  play(engine, P2, id("cc2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("cc")), "play");
  assert.equal(zoneOf(engine, id("cc2")), "play");
});

clause(CHEST, "0:unique", "deploys for exactly 2 with [D]; one resource short and no [D] are refused", () => {
  const mk = (res: Cards) => buildGame({ ...factions(), cards: [{ key: "cc", def: printing(CHEST), owner: P1, zone: "hand" }, ...res] });
  const ok = mk([...bank("deception", 1, P1), ...bank("rage", 2, P1)]);
  play(ok.engine, P1, ok.id("cc"));
  assert.equal(zoneOf(ok.engine, ok.id("cc")), "play");
  assert.equal(ok.engine.getAvailableResourceCount(P1), 1, "cost 2 of 3 resources");

  const short = mk(bank("deception", 1, P1));
  refused(() => play(short.engine, P1, short.id("cc")), "1 resource for a cost-2 card");
  assert.equal(zoneOf(short.engine, short.id("cc")), "hand");

  const noD = mk(bank("rage", 3, P1));
  refused(() => play(noD.engine, P1, noD.id("cc")), "no [D] among three Rage");
  assert.equal(zoneOf(noD.engine, noD.id("cc")), "hand");
});

// --- 1:rule: at the start of each player's turn, both players may draw a card or play a resource ----

clause(CHEST, "1:rule", "start of the OPPONENT's turn: both players are asked, and both who say yes draw a card from their own deck", () => {
  const { engine, id } = chestBoard();
  const playBefore = [playOf(engine, P1).length, playOf(engine, P2).length];
  endTurn(engine, P1);
  const asked = answerChest(engine, { [P1]: { pay: true, option: 0 }, [P2]: { pay: true, option: 0 } });
  assert.deepEqual([...asked].sort(), [P1, P2]);
  assert.deepEqual(handOf(engine, P1).sort(), [id("h1"), id("h2"), id("d0")].sort(), "P1 drew the top of P1's deck");
  assert.deepEqual(handOf(engine, P2).sort(), [id("g1"), id("g2"), id("e0")].sort(), "P2 drew the top of P2's deck");
  assert.deepEqual([playOf(engine, P1).length, playOf(engine, P2).length], playBefore, "drawing does not also play a resource");
});

clause(CHEST, "1:rule", "start of its controller's OWN turn: both players are asked again", () => {
  const { engine, id } = chestBoard({ turn: 2, active: P2 });
  endTurn(engine, P2);
  const asked = answerChest(engine, { [P1]: { pay: true, option: 0 }, [P2]: { pay: true, option: 0 } });
  assert.deepEqual([...asked].sort(), [P1, P2]);
  assert.ok(handOf(engine, P1).includes(id("d0")), "handOf(engine, P1).includes(id(\"d0\"))");
  assert.ok(handOf(engine, P2).includes(id("e0")), "handOf(engine, P2).includes(id(\"e0\"))");
});

clause(CHEST, "1:rule", "'may': each player decides separately; declining draws and plays nothing (P1 declines, P2 draws)", () => {
  const { engine, id } = chestBoard();
  const playBefore = [playOf(engine, P1).length, playOf(engine, P2).length];
  endTurn(engine, P1);
  const asked = answerChest(engine, { [P1]: { pay: false }, [P2]: { pay: true, option: 0 } });
  assert.deepEqual([...asked].sort(), [P1, P2], "both were asked");
  assert.deepEqual(handOf(engine, P1).sort(), [id("h1"), id("h2")].sort(), "P1 declined: hand unchanged");
  assert.equal(engine.state.players[P1].deck.length, 3, "P1's deck untouched");
  assert.deepEqual(handOf(engine, P2).sort(), [id("g1"), id("g2"), id("e0")].sort(), "P2 accepted: drew");
  assert.equal(playOf(engine, P1).length, playBefore[0]);
});

clause(CHEST, "1:rule", "'may': the other way round (P1 draws, P2 declines)", () => {
  const { engine, id } = chestBoard();
  endTurn(engine, P1);
  answerChest(engine, { [P1]: { pay: true, option: 0 }, [P2]: { pay: false } });
  assert.deepEqual(handOf(engine, P1).sort(), [id("h1"), id("h2"), id("d0")].sort());
  assert.deepEqual(handOf(engine, P2).sort(), [id("g1"), id("g2")].sort(), "P2 declined: hand unchanged");
  assert.equal(engine.state.players[P2].deck.length, 3);
});

clause(CHEST, "1:rule", "'or play a resource': a real resource card enters play face-up and provides its icon; a non-resource card enters face-down as a resource; no card is drawn", () => {
  const { engine, id } = chestBoard({
    extra: [{ key: "rage", def: printing(RAGE), owner: P1, zone: "hand" }]
  });
  assert.equal(engine.getAvailableResourceCount(P1), 0);
  endTurn(engine, P1);
  const asked = answerChest(engine, { [P1]: { pay: true, option: 1, pick: [id("rage")] }, [P2]: { pay: true, option: 1, pick: [id("g1")] } });
  assert.deepEqual([...asked].sort(), [P1, P2]);
  assert.equal(zoneOf(engine, id("rage")), "play");
  assert.equal(engine.state.cards[id("rage")].faceDown, false, "a real resource card is played face-up");
  assert.equal(engine.state.cards[id("rage")].controllerId, P1);
  assert.equal(engine.getAvailableResourceCount(P1), 1);
  assert.equal(zoneOf(engine, id("g1")), "play");
  assert.equal(engine.state.cards[id("g1")].faceDown, true, "any other card is played face-down");
  assert.equal(engine.getAvailableResourceCount(P2), 1);
  assert.deepEqual(handOf(engine, P1).sort(), [id("h1"), id("h2")].sort(), "P1 played a resource instead of drawing");
  assert.deepEqual(handOf(engine, P2), [id("g2")]);
  assert.equal(engine.state.players[P1].deck.length, 3, "no card drawn");
  assert.equal(engine.state.players[P2].deck.length, 3, "no card drawn");
});

clause(CHEST, "1:rule", "'play a resource': a real resource card can be played face-down as a resource (any card may be)", () => {
  const { engine, id } = chestBoard({ extra: [{ key: "rage", def: printing(RAGE), owner: P1, zone: "hand" }] });
  endTurn(engine, P1);
  let guard = 0;
  while (engine.state.pendingChoice && guard++ < 10) {
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId };
    const choice =
      pc.playerId !== P1
        ? pc.kind === "mayPay"
          ? { kind: "mayPay", pay: false }
          : { kind: "chooserSelectsTarget", selected: [] }
        : pc.kind === "mayPay"
          ? { kind: "mayPay", pay: true }
          : pc.kind === "chooserSelectsOption"
            ? { kind: "chooserSelectsOption", index: 1 }
            : { kind: "chooserSelectsTarget", selected: [id("rage")], faceDown: true };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  assert.equal(zoneOf(engine, id("rage")), "play", "control: it was played as a resource");
  assert.equal(engine.state.cards[id("rage")].faceDown, true, "the player asked for it face-down");
});

clause(CHEST, "1:rule", "the Chest triggers the same when it is controlled by the OPPONENT of the turn's player: owner P2 still asks both players", () => {
  const { engine, id } = chestBoard({ chestOwner: P2 });
  endTurn(engine, P1);
  const asked = answerChest(engine, { [P1]: { pay: true, option: 0 }, [P2]: { pay: true, option: 0 } });
  assert.deepEqual([...asked].sort(), [P1, P2]);
  assert.ok(handOf(engine, P1).includes(id("d0")), "handOf(engine, P1).includes(id(\"d0\"))");
  assert.ok(handOf(engine, P2).includes(id("e0")), "handOf(engine, P2).includes(id(\"e0\"))");
});

clause(CHEST, "1:rule", "no Chest in play (none at all, or only in hand): nothing is asked at the start of a turn", () => {
  const none = chestBoard({ noChest: true });
  endTurn(none.engine, P1);
  assert.equal(pending(none.engine), undefined);
  assert.equal(handOf(none.engine, P2).length, 2);
  const inHand = chestBoard({ chestZone: "hand" });
  endTurn(inHand.engine, P1);
  assert.equal(pending(inHand.engine), undefined);
  assert.equal(handOf(inHand.engine, P1).length, 3, "h1, h2 and the Chest itself");
  assert.equal(handOf(inHand.engine, P2).length, 2);
});

clause(CHEST, "1:rule", "stops once the Chest leaves play", () => {
  const raze = tactic({
    name: "RazeItem",
    cost: 0,
    behavior: {
      abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
  const { engine, id } = chestBoard({ extra: [{ key: "raze", def: raze, owner: P1, zone: "hand" }] });
  play(engine, P1, id("raze"), { selected: { t: [id("cc")] } });
  assert.equal(zoneOf(engine, id("cc")), "discard", "control: the Chest is gone");
  endTurn(engine, P1);
  assert.equal(pending(engine), undefined);
  assert.equal(handOf(engine, P2).length, 2);
});

// --- 2:rule: mulligan reveal + extra draw ----------------------------------------------------

const DEC = resourceCard({ id: "s302-dec", name: "Dec", resource: { provides: ["deception"], staple: true } });
const RGE = resourceCard({ id: "s302-rge", name: "Rge", resource: { provides: ["rage"], staple: true } });
const FILL = character({ id: "s302-fill", name: "Filler", life: 2 });
const repeat = <T,>(x: T, n: number): T[] => Array.from({ length: n }, () => x);

/** A faction starting with two `startName` resources, a 4-card opening hand and a 3-card mulligan. */
const mulliganFaction = (startName: string) =>
  factionCard({
    id: `s302-faction-${startName}`,
    name: `Faction ${startName}`,
    faction: defaultFactionDefinition({
      startingInfluence: 20,
      setup: {
        startingResources: { count: 2, names: [startName] },
        openingHand: { goingFirst: 4, goingSecond: 4 },
        mulligan: { count: 3, mode: "replaceAny" }
      },
      // no Develop choices: the Develop Rule cannot be skipped, so a drawing faction would add a card to every turn start these count
      turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [] } }
    })
  });

/** A real-setup game (in the mulligan step) where `holder`'s opening hand holds the Community Chest. */
function chestInHand(holder: PlayerId, startName: "Dec" | "Rge") {
  const faction = mulliganFaction(startName);
  const withChest = [DEC, DEC, RGE, RGE, printing(CHEST), ...repeat(FILL, 8)];
  const without = [DEC, DEC, RGE, RGE, ...repeat(FILL, 9)];
  for (let seed = 1; seed < 400; seed++) {
    const engine = setupGame(
      { faction, deck: holder === P1 ? withChest : without },
      { faction, deck: holder === P2 ? withChest : without },
      { seed }
    );
    const chestId = engine.state.players[holder].hand.find((cardId) => engine.getDefinition(cardId).name === "Community Chest");
    if (chestId) return { engine, chestId };
  }
  throw new Error("no seed put the Community Chest into the opening hand");
}
const mulliganRaw = (engine: SpoilsEngine, p: PlayerId, cardIds: CardInstanceId[]) => engine.perform({ type: "mulligan", playerId: p, cardIds } as never);
/** A mulligan that bottoms the Chest asks whether to reveal it ("you may reveal it", Q22): these tests say yes. */
const mulligan = (engine: SpoilsEngine, p: PlayerId, cardIds: CardInstanceId[]) => {
  mulliganRaw(engine, p, cardIds);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: PlayerId } | undefined;
  if (pc?.kind === "mayPay") engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: true } } as never);
  settleStartFirst(engine); // once both have mulliganed, the first turn starts: its Restore Rule and Develop Rule go first
};
const revealEvents = (engine: SpoilsEngine) =>
  engine.getLog().flatMap((entry) => (entry.event?.type === "cardsRevealed" ? [entry.event as unknown as { cardIds: string[]; zone: string; ownerId: string; viewerId: string }] : []));

clause(CHEST, "2:rule", "bottoming it in the mulligan while controlling [D]: it goes to the bottom of the deck and is revealed to everyone", () => {
  const { engine, chestId } = chestInHand(P1, "Dec");
  assert.equal(handOf(engine, P1).length, 4, "control: opening hand of 4");
  mulligan(engine, P1, [chestId]);
  const events = revealEvents(engine);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].cardIds, [chestId]);
  assert.equal(events[0].zone, "deck");
  assert.equal(events[0].ownerId, P1);
  assert.equal(events[0].viewerId, "all");
  const deck = engine.state.players[P1].deck;
  assert.equal(deck[deck.length - 1], chestId, "on the bottom of the deck");
  assert.equal(handOf(engine, P1).length, 4, "replaced by a drawn card");
  assert.ok(!handOf(engine, P1).includes(chestId), "!handOf(engine, P1).includes(chestId)");
});

clause(CHEST, "2:rule", "if revealed, it draws a card at the start of EACH of your turns, and not at the opponent's turn start", () => {
  const { engine, chestId } = chestInHand(P1, "Dec");
  mulligan(engine, P1, [chestId]);
  mulligan(engine, P2, []);
  assert.equal(handOf(engine, P1).length, 5, "turn 1 start: 4 + 1 from the Chest");
  assert.equal(handOf(engine, P2).length, 4, "the opponent is not drawing for it");
  endTurn(engine, P1);
  assert.equal(handOf(engine, P1).length, 5, "the opponent's turn start: nothing for P1");
  assert.equal(handOf(engine, P2).length, 4, "...and nothing for P2");
  endTurn(engine, P2);
  assert.equal(handOf(engine, P1).length, 6, "P1's next turn start: +1 again");
  assert.equal(handOf(engine, P2).length, 4);
});

clause(CHEST, "2:rule", "kept in hand (not bottomed): no reveal and no extra draw", () => {
  const { engine, chestId } = chestInHand(P1, "Dec");
  mulligan(engine, P1, []);
  mulligan(engine, P2, []);
  assert.equal(revealEvents(engine).length, 0);
  assert.ok(handOf(engine, P1).includes(chestId), "handOf(engine, P1).includes(chestId)");
  assert.equal(handOf(engine, P1).length, 4, "turn 1 start: no extra draw");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(handOf(engine, P1).length, 4, "no extra draw on P1's second turn either");
});

clause(CHEST, "2:rule", "bottoming OTHER cards while keeping the Chest: no reveal, no extra draw", () => {
  const { engine, chestId } = chestInHand(P1, "Dec");
  const other = handOf(engine, P1).find((c) => c !== chestId)!;
  mulligan(engine, P1, [other]);
  mulligan(engine, P2, []);
  assert.equal(revealEvents(engine).length, 0);
  assert.ok(handOf(engine, P1).includes(chestId), "handOf(engine, P1).includes(chestId)");
  assert.equal(handOf(engine, P1).length, 4);
});

clause(CHEST, "2:rule", "without [D] (starting resources are Rage): bottoming it reveals nothing and draws nothing", () => {
  const { engine, chestId } = chestInHand(P1, "Rge");
  mulligan(engine, P1, [chestId]);
  assert.equal(revealEvents(engine).length, 0, "no [D] controlled");
  mulligan(engine, P2, []);
  assert.equal(handOf(engine, P1).length, 4, "no extra draw at turn 1 start");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(handOf(engine, P1).length, 4, "...nor on the next turn");
});

clause(CHEST, "2:rule", "'your' mulligan and turn: P2 bottoming it draws at P2's turn start only; the opponent's mulligan does not reveal it again", () => {
  const { engine, chestId } = chestInHand(P2, "Dec");
  mulligan(engine, P1, []);
  mulligan(engine, P2, [chestId]);
  const events = revealEvents(engine);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].cardIds, [chestId]);
  assert.equal(events[0].ownerId, P2);
  assert.equal(handOf(engine, P1).length, 4, "P1's turn 1 start: P1 draws nothing");
  assert.equal(handOf(engine, P2).length, 4, "...and it is not P2's turn yet");
  endTurn(engine, P1);
  assert.equal(handOf(engine, P2).length, 5, "P2's turn start: +1");
  assert.equal(handOf(engine, P1).length, 4);
  endTurn(engine, P2);
  assert.equal(handOf(engine, P1).length, 4, "P1's turn start: nothing for P1");
  assert.equal(handOf(engine, P2).length, 5);
});

clause(CHEST, "2:rule", "the opponent's later mulligan does not reveal an already-bottomed Chest a second time", () => {
  const { engine, chestId } = chestInHand(P1, "Dec");
  mulligan(engine, P1, [chestId]);
  assert.equal(revealEvents(engine).length, 1);
  const theirs = handOf(engine, P2)[0];
  mulligan(engine, P2, [theirs]);
  assert.equal(revealEvents(engine).length, 1, "still only the one reveal");
  assert.equal(handOf(engine, P1).length, 5, "turn 1 start: P1's single extra draw");
});

clause(CHEST, "2:rule", "a Chest that sits in the deck (never in the opening hand) is not revealed when other cards are mulliganed, and draws nothing", () => {
  const faction = mulliganFaction("Dec");
  const withChest = [DEC, DEC, RGE, RGE, printing(CHEST), ...repeat(FILL, 8)];
  const without = [DEC, DEC, RGE, RGE, ...repeat(FILL, 9)];
  let found: ReturnType<typeof setupGame> | undefined;
  let chest: CardInstanceId | undefined;
  for (let seed = 1; seed < 400 && !found; seed++) {
    const engine = setupGame({ faction, deck: withChest }, { faction, deck: without }, { seed });
    const inDeck = engine.state.players[P1].deck.find((c) => engine.getDefinition(c).name === "Community Chest");
    if (inDeck) {
      found = engine;
      chest = inDeck;
    }
  }
  assert.ok(found && chest, "a seed that leaves the Chest in the deck");
  const engine = found;
  assert.ok(engine.state.players[P1].deck.includes(chest), "control: the Chest is in the deck");
  mulligan(engine, P1, [handOf(engine, P1)[0]]);
  mulligan(engine, P2, []);
  assert.equal(revealEvents(engine).length, 0, "no reveal");
  assert.equal(handOf(engine, P1).length, 4, "turn 1 start: no extra draw");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(handOf(engine, P1).length, 4, "no extra draw on P1's second turn");
});

clause(CHEST, "2:rule", "'you MAY reveal it': the player is offered the choice, and declining means no reveal and no extra draw", () => {
  const { engine, chestId } = chestInHand(P1, "Dec");
  mulliganRaw(engine, P1, [chestId]);
  const pc = pending(engine);
  assert.ok(pc, "the player is asked whether to reveal the Chest");
  assert.equal(pc.playerId, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: false } } as never);
  assert.equal(revealEvents(engine).length, 0, "declined: not revealed");
  mulligan(engine, P2, []);
  assert.equal(handOf(engine, P1).length, 4, "declined: no extra draw at the start of the turn");
});

clause(CHEST, "2:rule", "the [D] check for the extra draw is re-made every turn (rules answer Q38): after losing the [D] resources the revealed Chest no longer draws", () => {
  const { engine, chestId } = chestInHand(P1, "Dec");
  mulligan(engine, P1, [chestId]);
  mulligan(engine, P2, []);
  assert.equal(handOf(engine, P1).length, 5, "control: turn 1 start draw happened");
  endTurn(engine, P1);
  const p = engine.state.players[P1];
  const decs = p.play.filter((c) => engine.isResource(c) && engine.getDefinition(c).name === "Dec");
  assert.equal(decs.length, 2, "control: the two starting [D] are in play");
  for (const c of decs) {
    p.play = p.play.filter((x) => x !== c);
    p.discard.push(c);
    engine.state.cards[c].zone = "discard";
  }
  endTurn(engine, P2);
  assert.equal(handOf(engine, P1).length, 5, "without any [D] the revealed Chest does not draw at the start of P1's turn");
});

// ===========================================================================================
// Delicious Strawberry Flavored Death
// ===========================================================================================

const STRAW = "6affffa0-13f7-4085-adb4-2b8ea1a0a2fa"; // tactic . rogue . cost 5 . [D] -- Deplete all non-Rogue characters. Draw a card. -- FLIP UP: 1 [D] and your faction loses 5 influence.

interface StrawOpts {
  faceDown?: boolean;
  res?: Cards;
  influence?: number;
  turn?: number;
  active?: PlayerId;
  extra?: Cards;
}
/** P1 holds (or has face-down in play) the tactic. Characters: P1 gear/rogue/uni, P2 warlord/arc/rogue. */
function strawBoard(opts: StrawOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence ?? 20 },
    playerB: { faction: developFaction(), influence: 20 },
    ...(opts.turn ? { turn: opts.turn, activePlayerId: opts.active ?? P1 } : {}),
    cards: [
      opts.faceDown
        ? { key: "sb", def: printing(STRAW), owner: P1, zone: "play" as const, faceDown: true }
        : { key: "sb", def: printing(STRAW), owner: P1, zone: "hand" as const },
      { key: "p1gear", def: character({ name: "P1 Gearsmith", trade: "gearsmith" }), owner: P1, zone: "play" as const },
      { key: "p1rogue", def: character({ name: "P1 Rogue", trade: "rogue" }), owner: P1, zone: "play" as const },
      { key: "p1uni", def: character({ name: "P1 Universal" }), owner: P1, zone: "play" as const },
      { key: "p2lord", def: character({ name: "P2 Warlord", trade: "warlord" }), owner: P2, zone: "play" as const },
      { key: "p2arc", def: character({ name: "P2 Arcanist", trade: "arcanist" }), owner: P2, zone: "play" as const },
      { key: "p2rogue", def: character({ name: "P2 Rogue", trade: "rogue" }), owner: P2, zone: "play" as const },
      ...deckCards(P1, [1, 1], "d"),
      ...deckCards(P2, [1, 1], "e"),
      ...(opts.res ?? []),
      ...(opts.extra ?? [])
    ]
  });
}
const depletedOf = (engine: SpoilsEngine, cardId: CardInstanceId) => !!engine.state.cards[cardId].depleted;
const flipRaw = (engine: SpoilsEngine, p: PlayerId, cardId: CardInstanceId) =>
  flipUpNow(engine, { type: "flipUp", playerId: p, cardId, selected: {}, variables: {} });

clause(STRAW, "0:rule", "deplete all non-Rogue characters, on BOTH sides: Gearsmith / Universal / Warlord / Arcanist characters are depleted, Rogue characters are not", () => {
  const { engine, id } = strawBoard({ res: bank("deception", 5, P1) });
  for (const k of ["p1gear", "p1rogue", "p1uni", "p2lord", "p2arc", "p2rogue"]) assert.equal(depletedOf(engine, id(k)), false, `control: ${k} starts ready`);
  play(engine, P1, id("sb"));
  assert.equal(engine.state.pendingChoice, undefined);
  for (const k of ["p1gear", "p1uni", "p2lord", "p2arc"]) assert.equal(depletedOf(engine, id(k)), true, `${k} is depleted`);
  for (const k of ["p1rogue", "p2rogue"]) assert.equal(depletedOf(engine, id(k)), false, `${k} (Rogue) is untouched`);
});

clause(STRAW, "0:rule", "only characters in play: items, locations, characters in hand and face-down resources are not depleted", () => {
  const { engine, id } = strawBoard({
    res: bank("deception", 5, P1),
    extra: [
      { key: "itm", def: item({ name: "Gear Item", trade: "gearsmith" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Warlord Keep", trade: "warlord" }), owner: P2, zone: "play" },
      { key: "inhand", def: character({ name: "In Hand", trade: "gearsmith" }), owner: P1, zone: "hand" },
      { key: "fd", def: character({ name: "Face Down Gear", trade: "gearsmith" }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  play(engine, P1, id("sb"));
  assert.equal(depletedOf(engine, id("p1gear")), true, "control: the effect ran");
  assert.equal(depletedOf(engine, id("itm")), false, "item");
  assert.equal(depletedOf(engine, id("loc")), false, "location");
  assert.equal(depletedOf(engine, id("inhand")), false, "character in hand");
  assert.equal(depletedOf(engine, id("fd")), false, "face-down card (a resource, not a character)");
});

clause(STRAW, "0:rule", "a Rogue that is already depleted stays depleted (nothing is restored)", () => {
  const { engine, id } = strawBoard({
    res: bank("deception", 5, P1),
    extra: [{ key: "rogueDep", def: character({ name: "Tired Rogue", trade: "rogue" }), owner: P1, zone: "play", depleted: true }]
  });
  play(engine, P1, id("sb"));
  assert.equal(depletedOf(engine, id("rogueDep")), true);
  assert.equal(depletedOf(engine, id("p1gear")), true);
});

clause(STRAW, "0:rule", "Draw a card: its controller draws exactly one card (the top of their own deck); the opponent draws none; the tactic is discarded; no influence is lost", () => {
  const { engine, id } = strawBoard({ res: bank("deception", 5, P1) });
  play(engine, P1, id("sb"));
  assert.deepEqual(engine.state.players[P1].hand, [id("d0")], "P1's hand: only the drawn card");
  assert.deepEqual([...engine.state.players[P1].deck], [id("d1")]);
  assert.deepEqual(engine.state.players[P2].hand, [], "P2 draws nothing");
  assert.deepEqual([...engine.state.players[P2].deck], [id("e0"), id("e1")]);
  assert.equal(zoneOf(engine, id("sb")), "discard");
  assert.equal(engine.state.players[P1].influence, 20, "played from hand: no influence loss");
});

clause(STRAW, "0:rule", "Draw a card still happens when there is no non-Rogue character to deplete", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "sb", def: printing(STRAW), owner: P1, zone: "hand" },
      { key: "r1", def: character({ name: "Only Rogue", trade: "rogue" }), owner: P1, zone: "play" },
      ...deckCards(P1, [1, 1], "d"),
      ...bank("deception", 5, P1)
    ]
  });
  play(engine, P1, id("sb"));
  assert.equal(depletedOf(engine, id("r1")), false);
  assert.deepEqual(engine.state.players[P1].hand, [id("d0")]);
});

clause(STRAW, "0:rule", "costs exactly 5 and needs [D]: 4 resources refused, 5 Rage (no [D]) refused, 4 Rage + 1 [D] accepted, 6 resources leave 1", () => {
  const short = strawBoard({ res: bank("deception", 4, P1) });
  refused(() => play(short.engine, P1, short.id("sb")), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("sb")), "hand");
  assert.equal(depletedOf(short.engine, short.id("p1gear")), false);

  const noD = strawBoard({ res: bank("rage", 5, P1) });
  refused(() => play(noD.engine, P1, noD.id("sb")), "no [D] among five Rage");
  assert.equal(zoneOf(noD.engine, noD.id("sb")), "hand");

  const exact = strawBoard({ res: [...bank("rage", 4, P1), ...bank("deception", 1, P1)] });
  play(exact.engine, P1, exact.id("sb"));
  assert.equal(zoneOf(exact.engine, exact.id("sb")), "discard");
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0, "all 5 paid");

  const spare = strawBoard({ res: bank("deception", 6, P1) });
  play(spare.engine, P1, spare.id("sb"));
  assert.equal(spare.engine.getAvailableResourceCount(P1), 1, "exactly 5 of 6 paid");
});

clause(STRAW, "0:rule", "a tactic: playable in the opponent's response window (their attack declaration), depleting their non-Rogue characters", () => {
  const { engine, id } = strawBoard({
    res: bank("deception", 5, P1),
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", trade: "rogue", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  play(engine, P1, id("sb"));
  assert.equal(zoneOf(engine, id("sb")), "discard");
  assert.equal(depletedOf(engine, id("p2lord")), true);
  assert.equal(depletedOf(engine, id("p1gear")), true);
  assert.equal(engine.state.players[P1].hand.length, 1, "drew a card");
});

// --- FLIP UP: 1 [D] and your faction loses 5 influence ---------------------------------------

clause(STRAW, "1:flipUp", "FLIP UP: a face-down Strawberry flips for 1 [D]: your faction loses 5 influence, all non-Rogue characters are depleted, you draw a card, the tactic is discarded", () => {
  const { engine, id } = strawBoard({ faceDown: true, res: bank("deception", 1, P1) });
  assert.equal(engine.state.cards[id("sb")].faceDown, true, "control: face-down");
  flipRaw(engine, P1, id("sb"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.players[P1].influence, 15, "20 - 5");
  assert.equal(engine.state.players[P2].influence, 20, "the opponent's faction is untouched");
  for (const k of ["p1gear", "p1uni", "p2lord", "p2arc"]) assert.equal(depletedOf(engine, id(k)), true, `${k} depleted`);
  for (const k of ["p1rogue", "p2rogue"]) assert.equal(depletedOf(engine, id(k)), false, `${k} (Rogue) untouched`);
  assert.deepEqual(engine.state.players[P1].hand, [id("d0")], "drew a card");
  assert.equal(zoneOf(engine, id("sb")), "discard");
});

clause(STRAW, "1:flipUp", "FLIP UP costs 1, not the printed 5 and not 2: with [D] already spent, the face-down card itself is the only free resource and that is enough", () => {
  const spentD = bank("deception", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const { engine, id } = strawBoard({ faceDown: true, res: spentD });
  assert.equal(engine.getAvailableResourceCount(P1), 1, "control: only the face-down card is free");
  flipRaw(engine, P1, id("sb"));
  assert.equal(zoneOf(engine, id("sb")), "discard");
  assert.equal(engine.state.players[P1].influence, 15);
});

clause(STRAW, "1:flipUp", "FLIP UP with a free [D] bank: it flips and the tactic's effects run (2 resources in play including itself)", () => {
  const { engine, id } = strawBoard({ faceDown: true, res: bank("deception", 1, P1) });
  assert.equal(engine.getAvailableResourceCount(P1), 2, "control: the [D] bank and the face-down card itself");
  flipRaw(engine, P1, id("sb"));
  assert.equal(zoneOf(engine, id("sb")), "discard");
  assert.equal(engine.state.players[P1].influence, 15);
});

clause(STRAW, "1:flipUp", "FLIP UP needs [D]: refused with plenty of non-[D] resources, and with no resources at all besides itself", () => {
  const rage = strawBoard({ faceDown: true, res: bank("rage", 5, P1) });
  refused(() => flipRaw(rage.engine, P1, rage.id("sb")), "no [D] among five Rage");
  assert.equal(rage.engine.state.cards[rage.id("sb")].faceDown, true);
  assert.equal(rage.engine.state.players[P1].influence, 20);
  assert.equal(depletedOf(rage.engine, rage.id("p1gear")), false);

  const alone = strawBoard({ faceDown: true });
  refused(() => flipRaw(alone.engine, P1, alone.id("sb")), "nothing but the face-down card");
  assert.equal(alone.engine.state.players[P1].influence, 20);

  const ok = strawBoard({ faceDown: true, res: [...bank("rage", 2, P1), ...bank("deception", 1, P1)] });
  flipRaw(ok.engine, P1, ok.id("sb"));
  assert.equal(zoneOf(ok.engine, ok.id("sb")), "discard", "control: with a [D] it works");
});

clause(STRAW, "1:flipUp", "FLIP UP is not limited to your own turn / main phase: a tactic flips up in the opponent's response window", () => {
  const { engine, id } = strawBoard({
    faceDown: true,
    res: bank("deception", 1, P1),
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", trade: "rogue", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  flipRaw(engine, P1, id("sb"));
  assert.equal(zoneOf(engine, id("sb")), "discard");
  assert.equal(engine.state.players[P1].influence, 15);
  assert.equal(depletedOf(engine, id("p2lord")), true);
});

clause(STRAW, "1:flipUp", "'your faction loses 5 influence' down to exactly 0: the faction's owner loses the game", () => {
  const { engine, id } = strawBoard({ faceDown: true, res: bank("deception", 1, P1), influence: 5 });
  flipRaw(engine, P1, id("sb"));
  assert.equal(engine.state.players[P1].influence, 0);
  assert.equal(engine.state.winner, P2);
});

clause(STRAW, "1:flipUp", "'your faction loses 5 influence' with only 3 influence: influence stops at 0 (never negative)", () => {
  const { engine, id } = strawBoard({ faceDown: true, res: bank("deception", 1, P1), influence: 3 });
  flipRaw(engine, P1, id("sb"));
  assert.equal(engine.state.players[P1].influence, 0);
  assert.equal(engine.state.winner, P2);
});

// ===========================================================================================
// Fornicaves
// ===========================================================================================

const FORN = "27c3d541-82fc-4bfc-b184-14dcfe4858fa"; // location . rogue . cost 3 . [D][D] . structure 1 -- UNIQUE FORNICAVES -- All characters lose X life, where X is their printed life minus 2.

interface FornOpts {
  fornZone?: "play" | "hand";
  extra?: Cards;
}
/** Characters by printed life: P1 c5, c3; P2 c4, c2. */
function fornBoard(opts: FornOpts = {}) {
  return buildGame({
    ...factions(),
    cards: [
      { key: "fo", def: printing(FORN), owner: P1, zone: opts.fornZone ?? "play" },
      { key: "c5", def: character({ name: "Life5", life: 5 }), owner: P1, zone: "play" },
      { key: "c3", def: character({ name: "Life3", life: 3 }), owner: P1, zone: "play" },
      { key: "c4", def: character({ name: "Life4", life: 4 }), owner: P2, zone: "play" },
      { key: "c2", def: character({ name: "Life2", life: 2 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}
const lifeOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getStat(cardId, "life");

clause(FORN, "0:unique", "a second copy: its controller chooses which to keep (keep the new one: the old one is destroyed)", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "fo", def: printing(FORN), owner: P1, zone: "play" },
      { key: "fo2", def: printing(FORN), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1),
      ...bank("rage", 1, P1)
    ]
  });
  play(engine, P1, id("fo2"));
  const pc = pendingSurvivor(engine);
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("fo"), id("fo2")].sort());
  keep(engine, P1, id("fo2"));
  assert.equal(zoneOf(engine, id("fo2")), "play");
  assert.equal(zoneOf(engine, id("fo")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(FORN, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "fo", def: printing(FORN), owner: P1, zone: "play" },
      { key: "fo2", def: printing(FORN), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1),
      ...bank("rage", 1, P1)
    ]
  });
  play(engine, P1, id("fo2"));
  keep(engine, P1, id("fo"));
  assert.equal(zoneOf(engine, id("fo")), "play");
  assert.equal(zoneOf(engine, id("fo2")), "discard");
});

clause(FORN, "0:unique", "UNIQUE is per player: the opponent may control their own Fornicaves with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    ...factions(),
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "fo", def: printing(FORN), owner: P1, zone: "play" },
      { key: "fo2", def: printing(FORN), owner: P2, zone: "hand" },
      ...bank("deception", 2, P2),
      ...bank("rage", 1, P2)
    ]
  });
  play(engine, P2, id("fo2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("fo")), "play");
  assert.equal(zoneOf(engine, id("fo2")), "play");
});

clause(FORN, "0:unique", "deploys for exactly 3 with [D][D]; one resource short and one [D] short are refused; printed structure 1", () => {
  const mk = (res: Cards) => buildGame({ ...factions(), cards: [{ key: "fo", def: printing(FORN), owner: P1, zone: "hand" }, ...res] });
  const ok = mk([...bank("deception", 2, P1), ...bank("rage", 2, P1)]);
  play(ok.engine, P1, ok.id("fo"));
  assert.equal(zoneOf(ok.engine, ok.id("fo")), "play");
  assert.equal(ok.engine.getAvailableResourceCount(P1), 1, "cost 3 of 4 resources");
  assert.equal(ok.engine.getStat(ok.id("fo"), "structure"), 1);

  const short = mk(bank("deception", 2, P1));
  refused(() => play(short.engine, P1, short.id("fo")), "2 resources for a cost-3 card");
  assert.equal(zoneOf(short.engine, short.id("fo")), "hand");

  const oneD = mk([...bank("deception", 1, P1), ...bank("rage", 3, P1)]);
  refused(() => play(oneD.engine, P1, oneD.id("fo")), "only one [D] of [D][D]");
  assert.equal(zoneOf(oneD.engine, oneD.id("fo")), "hand");
});

clause(FORN, "1:rule", "every character in play, either player's, loses (printed life - 2): lives 5, 3 / 4, 2 become 2, 2 / 2, 2", () => {
  const { engine, id } = fornBoard();
  assert.equal(lifeOf(engine, id("c5")), 2, "P1 printed 5 loses 3");
  assert.equal(lifeOf(engine, id("c3")), 2, "P1 printed 3 loses 1");
  assert.equal(lifeOf(engine, id("c4")), 2, "P2 printed 4 loses 2");
  assert.equal(lifeOf(engine, id("c2")), 2, "P2 printed 2 loses 0");
});

clause(FORN, "1:rule", "a printed life of 1 loses nothing (X would be -1: it never raises life)", () => {
  const { engine, id } = fornBoard({ extra: [{ key: "c1", def: character({ name: "Life1", life: 1 }), owner: P1, zone: "play" }] });
  assert.equal(lifeOf(engine, id("c5")), 2, "control: the rule is on");
  assert.equal(lifeOf(engine, id("c1")), 1);
});

clause(FORN, "1:rule", "X uses PRINTED life: a character with +2 life from another source is printed 5 + 2 - 3 = 4", () => {
  const buff = item({
    name: "Life Buff",
    behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ selector: { zone: "play", type: "character" }, stat: "life", operation: "add", value: 2 }] }] }
  });
  const { engine, id } = fornBoard({ extra: [{ key: "buff", def: buff, owner: P1, zone: "play" }] });
  assert.equal(lifeOf(engine, id("c5")), 4, "printed 5 + 2 - 3");
  assert.equal(lifeOf(engine, id("c2")), 4, "printed 2 + 2 - 0");
});

clause(FORN, "1:rule", "only characters in play: a character in hand keeps its printed life, and a location's structure is unchanged", () => {
  const { engine, id } = fornBoard({
    extra: [
      { key: "inhand", def: character({ name: "In Hand", life: 5 }), owner: P1, zone: "hand" },
      { key: "keep", def: location({ name: "Big Keep", structure: 6 }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(lifeOf(engine, id("c5")), 2, "control: the rule is on");
  assert.equal(lifeOf(engine, id("inhand")), 5);
  assert.equal(engine.getStat(id("keep"), "structure"), 6);
  assert.equal(engine.getStat(id("fo"), "structure"), 1, "Fornicaves itself is not a character");
});

clause(FORN, "1:rule", "'all characters' includes ones that enter play afterwards", () => {
  const { engine, id } = fornBoard({ extra: [{ key: "late", def: character({ name: "Latecomer", life: 5, cost: 0 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("late"));
  assert.equal(zoneOf(engine, id("late")), "play");
  assert.equal(lifeOf(engine, id("late")), 2);
});

clause(FORN, "1:rule", "the drain is on only while Fornicaves is in play: off in hand, on when it enters, off again after it leaves", () => {
  const raze = tactic({
    name: "RazeLocation",
    cost: 0,
    behavior: {
      abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
  const { engine, id } = fornBoard({
    fornZone: "hand",
    extra: [{ key: "raze", def: raze, owner: P1, zone: "hand" }, ...bank("deception", 2, P1), ...bank("rage", 1, P1)]
  });
  assert.equal(lifeOf(engine, id("c5")), 5, "Fornicaves in hand");
  play(engine, P1, id("fo"));
  assert.equal(zoneOf(engine, id("fo")), "play");
  assert.equal(lifeOf(engine, id("c5")), 2, "Fornicaves in play");
  assert.equal(lifeOf(engine, id("c4")), 2);
  play(engine, P1, id("raze"), { selected: { t: [id("fo")] } });
  assert.equal(zoneOf(engine, id("fo")), "discard", "control: Fornicaves left play");
  assert.equal(lifeOf(engine, id("c5")), 5, "off again");
  assert.equal(lifeOf(engine, id("c4")), 4);
});

clause(FORN, "1:rule", "life lost is real: a character whose damage reaches its reduced life is destroyed when Fornicaves enters play", () => {
  const { engine, id } = fornBoard({
    fornZone: "hand",
    extra: [
      { key: "hurt", def: character({ name: "Hurt", life: 4 }), owner: P2, zone: "play", damage: 2 },
      { key: "scratched", def: character({ name: "Scratched", life: 4 }), owner: P2, zone: "play", damage: 1 },
      ...bank("deception", 2, P1),
      ...bank("rage", 1, P1)
    ]
  });
  play(engine, P1, id("fo"));
  assert.equal(lifeOf(engine, id("scratched")), 2, "control: reduced life 2");
  assert.equal(zoneOf(engine, id("scratched")), "play", "1 damage < 2 life");
  assert.equal(zoneOf(engine, id("hurt")), "discard", "2 damage >= 2 life");
});

clause(FORN, "1:rule", "two Fornicaves (one per player) both apply: printed life 3 loses 1 twice; printed 2 still loses 0", () => {
  const { engine, id } = buildGame({
    ...factions(),
    cards: [
      { key: "fo", def: printing(FORN), owner: P1, zone: "play" },
      { key: "fo2", def: printing(FORN), owner: P2, zone: "play" },
      { key: "c3", def: character({ name: "Life3", life: 3 }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "Life2", life: 2 }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(lifeOf(engine, id("c3")), 1, "3 - 1 - 1");
  assert.equal(lifeOf(engine, id("c2")), 2, "2 - 0 - 0");
});

clause(FORN, "1:rule", "a character drained to 0 life (printed 4 under two Fornicaves, the second just played) is destroyed", () => {
  const { engine, id } = buildGame({
    ...factions(),
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "fo", def: printing(FORN), owner: P1, zone: "play" },
      { key: "fo2", def: printing(FORN), owner: P2, zone: "hand" },
      { key: "c4", def: character({ name: "Life4", life: 4 }), owner: P1, zone: "play" },
      ...bank("deception", 2, P2),
      ...bank("rage", 1, P2)
    ]
  });
  assert.equal(lifeOf(engine, id("c4")), 2, "control: one Fornicaves leaves printed 4 at life 2");
  play(engine, P2, id("fo2"));
  assert.equal(zoneOf(engine, id("fo2")), "play", "control: the second Fornicaves is in play");
  assert.equal(zoneOf(engine, id("c4")), "discard", "life 4 - 2 - 2 = 0: destroyed");
});

// ---- END OF FORNICAVES ----
