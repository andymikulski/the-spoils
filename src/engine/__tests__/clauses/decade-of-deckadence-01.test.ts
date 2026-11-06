// Clause tests — batch decade-of-deckadence-01. See docs/TESTING.md and
// `npm run card-tests -- manifest decade-of-deckadence-01`. Expectations come from each
// card's PRINTED text (markup); engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
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
import { clause, clauseMismatch, declineAll, drain, flipUpNow, printing, refused } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { developDraw, developResource, endTurn, openDevelopPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ greed: 4, rage: 2 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const voidOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].void];
const cardOf = (engine: SpoilsEngine, id: CardInstanceId) => engine.state.cards[id];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const START = 30; // developFaction() starts at 30 influence

/** `n` plain characters `<prefix>0..n-1` for `owner` in `zone`. */
const chars = (prefix: string, n: number, owner: PlayerId, zone: Zone): CardPlacement[] =>
  fillers(prefix, n, owner, zone, (i) => character({ name: `${prefix} ${i}` }));

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

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** A player responds to the open window by playing a tactic from hand; the chain is then drained. */
function respondWith(
  engine: SpoilsEngine,
  responder: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "playCard", playerId: responder, cardId, selected, variables } as never);
  resolvePendingResponses(engine);
}

function spentBy(engine: SpoilsEngine, player: PlayerId, fn: () => void): number {
  const before = ready(engine, player);
  fn();
  return before - ready(engine, player);
}

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
function pickTargets(selected: CardInstanceId[]) {
  return (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc));
}

/** Accepts every `mayPay`, declines (or defaults) anything else. */
const acceptPay = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc));
/** Declines every `mayPay`, defaults anything else. */
const refusePay = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(pc));

/** A free tactic that draws a card (so we can see that it resolved). */
const cantrip = (name: string, cost: number, threshold = ""): CardDefinition =>
  tactic({ name, cost, threshold: threshold as never, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

/** A no-op tactic. */
const noop = (name: string): CardDefinition => tactic({ name, cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } });

// =============================================================================
// 1337!
// Reduce the numeric cost of the next card you deploy this turn by 4. Draw a card.
// Tactic, gearsmith, cost 3, [E].
// =============================================================================

const LEET = "e8aaaab6-65b7-45c1-923d-020e6299f073";

function leetBoard(opts: { icons?: Icons; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "leet", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "leet2", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "C0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "C2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "c4", def: character({ name: "C4", cost: 4 }), owner: P1, zone: "hand" },
      { key: "c5", def: character({ name: "C5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c6", def: character({ name: "C6", cost: 6 }), owner: P1, zone: "hand" },
      { key: "c6b", def: character({ name: "C6b", cost: 6 }), owner: P1, zone: "hand" },
      { key: "i5", def: item({ name: "I5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "loc4", def: location({ name: "Loc4", cost: 4 }), owner: P1, zone: "hand" },
      { key: "t3", def: cantrip("T3", 3), owner: P1, zone: "hand" },
      ...fillers("a", 5, P1, "deck"),
      ...fillers("b", 3, P2, "deck"),
      ...res(opts.icons ?? { elitism: 14 }),
      ...(opts.extra ?? [])
    ]
  });
}

clause(LEET, "0:rule", "printed card: gearsmith tactic, cost 3, threshold [E]; pays exactly 3 and ends in the discard pile", () => {
  const p = printing(LEET);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "gearsmith");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "e");
  const { engine, id } = leetBoard();
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("leet"))), 3);
  assert.equal(zoneOf(engine, id("leet")), "discard");
});

clause(LEET, "0:rule", "needs [E] and exactly 3 free resources: 2 resources are one short, no [E] is refused", () => {
  const short = leetBoard({ icons: { elitism: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("leet")), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("leet")), "hand");
  const noE = leetBoard({ icons: { rage: 5 } });
  refused(() => playRaw(noE.engine, P1, noE.id("leet")), "no [E] icon", /threshold/i);
  const ok = leetBoard({ icons: { elitism: 1, rage: 2 } });
  assert.equal(spentBy(ok.engine, P1, () => play(ok.engine, P1, ok.id("leet"))), 3);
});

for (const [key, printed, paid] of [
  ["c6", 6, 2],
  ["c5", 5, 1],
  ["c4", 4, 0],
  ["c2", 2, 0],
  ["c0", 0, 0]
] as const) {
  clause(LEET, "0:rule", `the next card (a character with cost ${printed}) costs 4 less: pays ${paid}`, () => {
    const { engine, id } = leetBoard();
    play(engine, P1, id("leet"));
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id(key))), paid);
    assert.equal(zoneOf(engine, id(key)), "play");
  });
}

clause(LEET, "0:rule", "control: without 1337! the same cost-6 character costs the full 6", () => {
  const { engine, id } = leetBoard();
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 6);
});

clause(LEET, "0:rule", "the reduction is exactly 4 with no choice offered", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  assert.equal(engine.state.pendingChoice, undefined, "no 'how much' prompt");
});

for (const [key, label, printed, paid] of [
  ["i5", "an item", 5, 1],
  ["loc4", "a location", 4, 0],
  ["t3", "a tactic", 3, 0]
] as const) {
  clause(LEET, "0:rule", `works on any deployed card type: ${label} with cost ${printed} pays ${paid}`, () => {
    const { engine, id } = leetBoard();
    play(engine, P1, id("leet"));
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id(key))), paid);
  });
}

clause(LEET, "0:rule", "only the NEXT card: the card after it costs full price", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6b"))), 6, "the reduction was used up");
});

clause(LEET, "0:rule", "the next card can be another 1337!: it costs 0 (3 - 4, never below 0), and ITS reduction applies to the card after", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("leet2"))), 0, "the second 1337! is the next card, so it is free");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2, "and its own reduction applies to the next card");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6b"))), 6);
});

clause(LEET, "0:rule", "'this turn': an unused reduction is gone next turn", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 6, "the next turn's card pays in full");
});

clause(LEET, "0:rule", "the threshold is not reduced, and a refused attempt does not use the reduction up", () => {
  const needsRage = character({ name: "NeedsRage", cost: 5, threshold: "rr" as never });
  const { engine, id } = leetBoard({ extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  refused(() => playRaw(engine, P1, id("nr")), "no [R] icons");
  assert.equal(zoneOf(engine, id("nr")), "hand");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2, "the reduction survived the refused attempt");
  const ok = leetBoard({ icons: { elitism: 4, rage: 4 }, extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  play(ok.engine, P1, ok.id("leet"));
  assert.equal(spentBy(ok.engine, P1, () => play(ok.engine, P1, ok.id("nr"))), 1, "cost 5 with [R][R] pays 1");
});

clause(LEET, "0:rule", "only for me: my opponent's card costs them full price while my reduction waits, and my next card still gets it", () => {
  const drawer = character({
    name: "Drawer",
    behavior: { abilities: [{ id: "draw1", name: "Study", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = leetBoard({
    extra: [
      { key: "drawer", def: drawer, owner: P1, zone: "play" },
      { key: "oppTactic", def: cantrip("OppTactic", 3), owner: P2, zone: "hand" },
      ...res({ rage: 5 }, P2)
    ]
  });
  play(engine, P1, id("leet"));
  actRaw(engine, P1, id("drawer"), "draw1");
  const theirs = spentBy(engine, P2, () => playRaw(engine, P2, id("oppTactic")));
  assert.equal(theirs, 3, "my opponent pays the full 3");
  resolvePendingResponses(engine);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2, "my reduction is still there");
});

clause(LEET, "0:rule", "it is a tactic: played in response on the opponent's turn it reduces the next card I deploy that turn", () => {
  const { engine, id } = leetBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "p2tac", def: noop("Their Noop"), owner: P2, zone: "hand" },
      { key: "p2tac2", def: noop("Their Noop 2"), owner: P2, zone: "hand" },
      { key: "swift", def: cantrip("Swift", 5), owner: P1, zone: "hand" }
    ]
  });
  playRaw(engine, P2, id("p2tac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("leet"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("leet")), "discard", "control: 1337! resolved");
  playRaw(engine, P2, id("p2tac2"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  assert.equal(spentBy(engine, P1, () => playRaw(engine, P1, id("swift"))), 1, "5 - 4");
});

clause(LEET, "0:rule", "draws exactly one card, the top of my deck; the opponent draws nothing", () => {
  const { engine, id } = leetBoard();
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("leet"));
  assert.equal(handOf(engine, P1).length, handBefore, "-1 tactic, +1 drawn");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(deckOf(engine, P1).length, 4);
  assert.equal(handOf(engine, P2).length, 0, "the opponent draws nothing");
});

clause(LEET, "0:rule", "with an empty deck the reduction still applies and nothing is drawn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "leet", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "c6", def: character({ name: "C6", cost: 6 }), owner: P1, zone: "hand" },
      ...res({ elitism: 12 })
    ]
  });
  play(engine, P1, id("leet"));
  assert.equal(handOf(engine, P1).length, 1);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2);
});

clause(LEET, "0:rule", "the reduction covers the whole numeric cost of the next card, including a 'pay N' extra cost (CR 406.3): cost 2 + pay 4 = 6, minus 4, costs 2", () => {
  const payer = character({ name: "Payer", cost: 2, behavior: { onPlay: { costs: [{ type: "payResources", amount: 4 }], effects: [] } } });
  const { engine, id } = leetBoard({ extra: [{ key: "payer", def: payer, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("payer"))), 6 - 4);
});

clause(LEET, "0:rule", "'deploy': playing a resource is not deploying a card, so developing a resource leaves the reduction for the next deployed card", () => {
  const { engine, id } = leetBoard({ extra: [{ key: "hres", def: resourceCard({ name: "HandRes", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  developResource(engine, P1, id("hres"), false);
  assert.equal(zoneOf(engine, id("hres")), "play");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c6"))), 2, "the resource play did not use the reduction up");
});

// =============================================================================
// Adriel, Sarcophyle King — character, rogue, subtype adriel / sarcophyle, cost 5, [D][D], 4 str / 4 spd / 2 life
// UNIQUE ADRIEL
// MADNESS -- COST: Destroy another character you control. -- EFFECT: This turn, this character gains 2 strength and 1 speed.
// =============================================================================

const ADRIEL = "9f1acc5d-2d57-49ef-96c6-5dcbbd696b03";

function adrielBoard(o: { extra?: CardPlacement[]; turn?: number; active?: PlayerId; adriel?: Zone } = {}) {
  return devBoard(
    [
      { key: "ad", def: printing(ADRIEL), owner: P1, zone: o.adriel ?? "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "ally2", def: character({ name: "Ally Two", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "idol", def: item({ name: "Idol" }), owner: P1, zone: "play" },
      { key: "dc", def: character({ name: "Dusty" }), owner: P1, zone: "discard" },
      { key: "hc", def: character({ name: "Handy" }), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type AdBoard = ReturnType<typeof adrielBoard>;
const madness = (g: AdBoard, sac: string) => activate(g.engine, P1, g.id("ad"), "madness", { selected: { sac: [g.id(sac)] } });
const madnessRaw = (g: AdBoard, sac: string) => actRaw(g.engine, P1, g.id("ad"), "madness", { sac: [g.id(sac)] });
const adStats = (g: AdBoard, key = "ad"): [number, number, number] => [
  g.engine.getStat(g.id(key), "strength"),
  g.engine.getStat(g.id(key), "speed"),
  g.engine.getStat(g.id(key), "life")
];

clause(ADRIEL, "0:unique", "printed card: rogue character (adriel, sarcophyle), 4 strength / 4 speed / 2 life, deploys for exactly 5 with [D][D]", () => {
  const p = printing(ADRIEL);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "rogue");
  assert.deepEqual(p.subtype, ["adriel", "sarcophyle"]);
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "dd");
  const g = adrielBoard({ adriel: "hand", extra: res({ deception: 5 }) });
  assert.deepEqual(adStats(g), [4, 4, 2]);
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("ad"))), 5);
  assert.equal(zoneOf(g.engine, g.id("ad")), "play");
  const short = adrielBoard({ adriel: "hand", extra: res({ deception: 4 }) });
  refused(() => playRaw(short.engine, P1, short.id("ad")), "4 resources for cost 5");
  const oneIcon = adrielBoard({ adriel: "hand", extra: res({ deception: 1, rage: 5 }) });
  refused(() => playRaw(oneIcon.engine, P1, oneIcon.id("ad")), "one [D] is short of [D][D]", /threshold/i);
});

clause(ADRIEL, "0:unique", "controlling a second Adriel makes you keep one: the controller chooses and the other is destroyed", () => {
  const g = adrielBoard({ extra: [{ key: "ad2", def: printing(ADRIEL), owner: P1, zone: "hand" }, ...res({ deception: 5 })] });
  play(g.engine, P1, g.id("ad2"));
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [g.id("ad"), g.id("ad2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("ad2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("ad2")), "play");
  assert.equal(zoneOf(g.engine, g.id("ad")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const g2 = adrielBoard({ extra: [{ key: "ad2", def: printing(ADRIEL), owner: P1, zone: "hand" }, ...res({ deception: 5 })] });
  play(g2.engine, P1, g2.id("ad2"));
  g2.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g2.id("ad") } } as never);
  assert.equal(zoneOf(g2.engine, g2.id("ad")), "play");
  assert.equal(zoneOf(g2.engine, g2.id("ad2")), "discard");
});

clause(ADRIEL, "0:unique", "the restriction is per player (the opponent may have its own Adriel), and a different UNIQUE designation is not a duplicate", () => {
  const g = adrielBoard({
    extra: [
      { key: "foeAd", def: printing(ADRIEL), owner: P2, zone: "play" },
      { key: "other", def: character({ name: "Other Unique", unique: "other unique" } as Partial<CardDefinition>), owner: P1, zone: "play" }
    ]
  });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ad")), "play");
  assert.equal(zoneOf(g.engine, g.id("foeAd")), "play");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
});

clause(ADRIEL, "1:ability:madness", "destroys another character I control as the cost, and this card gains +2 strength and +1 speed (life unchanged)", () => {
  const g = adrielBoard();
  assert.deepEqual(adStats(g), [4, 4, 2]);
  madness(g, "ally");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard", "the cost destroyed Ally");
  assert.deepEqual(adStats(g), [6, 5, 2], "4+2 strength, 4+1 speed, life 2");
  assert.equal(zoneOf(g.engine, g.id("ally2")), "play", "only the picked character is destroyed");
  assert.equal(zoneOf(g.engine, g.id("ad")), "play");
});

clause(ADRIEL, "1:ability:madness", "no other cost: no resource is paid", () => {
  const g = adrielBoard({ extra: res({ rage: 3 }) });
  assert.equal(spentBy(g.engine, P1, () => madness(g, "ally")), 0);
  assert.deepEqual(adStats(g), [6, 5, 2]);
  const bare = adrielBoard();
  madness(bare, "ally2");
  assert.deepEqual(adStats(bare), [6, 5, 2], "usable with no resources at all");
});

clause(ADRIEL, "1:ability:madness", "the cost is paid when the ability is used, before the opponent can respond", () => {
  const g = adrielBoard();
  madnessRaw(g, "ally");
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard", "Ally is already destroyed while the window is open");
  assert.deepEqual(adStats(g), [4, 4, 2], "the bonus is not there until the ability resolves");
  resolvePendingResponses(g.engine);
  assert.deepEqual(adStats(g), [6, 5, 2]);
});

clause(ADRIEL, "1:ability:madness", "'another': it cannot destroy itself", () => {
  const g = adrielBoard();
  refused(() => madnessRaw(g, "ad"), "Adriel is not 'another' character");
  assert.equal(zoneOf(g.engine, g.id("ad")), "play");
  assert.deepEqual(adStats(g), [4, 4, 2]);
  const ok = adrielBoard();
  madness(ok, "ally");
  assert.deepEqual(adStats(ok), [6, 5, 2], "control: another character works on the same board");
});

clause(ADRIEL, "1:ability:madness", "'you control': an opponent's character, an item, a faction, a card in hand/discard cannot be the sacrifice", () => {
  for (const [why, key] of [["an opponent's character", "foe"], ["an item", "idol"], ["a character in hand", "hc"], ["a character in the discard pile", "dc"]] as const) {
    const g = adrielBoard();
    refused(() => madnessRaw(g, key), why);
    assert.deepEqual(adStats(g), [4, 4, 2], `${why}: no bonus`);
    for (const k of ["ally", "ally2", "foe", "idol"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${why}: ${k} untouched`);
  }
  const f = adrielBoard();
  refused(() => actRaw(f.engine, P1, f.id("ad"), "madness", { sac: [f.engine.state.players[P1].factionId!] }), "my faction");
  assert.deepEqual(adStats(f), [4, 4, 2]);
});

clause(ADRIEL, "1:ability:madness", "a character stolen from the opponent counts as one I control; one the opponent stole from me does not", () => {
  const g = adrielBoard({
    extra: [
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  refused(() => madnessRaw(g, "lent"), "controlled by my opponent");
  madness(g, "stolen");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard");
  assert.deepEqual(adStats(g), [6, 5, 2]);
});

clause(ADRIEL, "1:ability:madness", "needs a pick: with no other character of mine, or no pick, it cannot be used", () => {
  const alone = devBoard([{ key: "ad", def: printing(ADRIEL), owner: P1, zone: "play" }, { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }]);
  refused(() => actRaw(alone.engine, P1, alone.id("ad"), "madness", {}), "no other character to destroy");
  assert.deepEqual([alone.engine.getStat(alone.id("ad"), "strength"), alone.engine.getStat(alone.id("ad"), "speed")], [4, 4]);
  const g = adrielBoard();
  refused(() => actRaw(g.engine, P1, g.id("ad"), "madness", {}), "no pick");
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
});

clause(ADRIEL, "1:ability:madness", "'this turn': the bonus lasts through the battle and is gone next turn", () => {
  const g = adrielBoard();
  madness(g, "ally");
  assert.deepEqual(adStats(g), [6, 5, 2]);
  endTurn(g.engine, P1);
  assert.deepEqual(adStats(g), [4, 4, 2], "gone once the turn ended");
  endTurn(g.engine, P2);
  assert.deepEqual(adStats(g), [4, 4, 2]);
});

clause(ADRIEL, "1:ability:madness", "it only buffs this card: other characters of mine and theirs keep their stats", () => {
  const g = adrielBoard();
  madness(g, "ally");
  assert.deepEqual(adStats(g, "ally2"), [1, 1, 1]);
  assert.deepEqual(adStats(g, "foe"), [3, 3, 3]);
});

clause(ADRIEL, "1:ability:madness", "usable repeatedly: each use destroys one more character and stacks +2 / +1", () => {
  const g = adrielBoard();
  madness(g, "ally");
  madness(g, "ally2");
  assert.deepEqual(adStats(g), [8, 6, 2], "4+2+2 strength, 4+1+1 speed");
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.equal(zoneOf(g.engine, g.id("ally2")), "discard");
});

clause(ADRIEL, "1:ability:madness", "a sacrifice that is already in the discard pile cannot be chosen twice; the second use needs a new character", () => {
  const g = adrielBoard();
  madness(g, "ally");
  refused(() => madnessRaw(g, "ally"), "Ally already left play");
  assert.deepEqual(adStats(g), [6, 5, 2], "only one use resolved");
});

clause(ADRIEL, "1:ability:madness", "can be used in a response window on the opponent's turn (it is an ability, not a deploy)", () => {
  const g = adrielBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  madnessRaw(g, "ally");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.deepEqual(adStats(g), [6, 5, 2]);
});

// =============================================================================
// Alistar Wixthorough — character, arcanist, ritualist, cost 6, [O][O][O], 4 str / 3 spd / 4 life
// UNIQUE ALISTAR, TACTICAL
// When this card enters play, void your discard pile.
// You may deploy cards voided by this card as if they were in your hand.
// =============================================================================

const ALISTAR = "ddb6e76b-5fc8-4198-9adf-04b5a5bc9755";

function alistarBoard(o: { extra?: CardPlacement[]; turn?: number; active?: PlayerId; alistar?: Zone; icons?: Icons } = {}) {
  return devBoard(
    [
      { key: "al", def: printing(ALISTAR), owner: P1, zone: o.alistar ?? "hand" },
      { key: "dChar", def: character({ name: "Dead Char", cost: 2, strength: 2, life: 2 }), owner: P1, zone: "discard" },
      { key: "dTac", def: cantrip("Dead Tactic", 1), owner: P1, zone: "discard" },
      { key: "dItem", def: item({ name: "Dead Item", cost: 1 }), owner: P1, zone: "discard" },
      { key: "dRes", def: resourceCard({ name: "Dead Res", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "discard" },
      { key: "oDisc", def: character({ name: "Opp Discard", cost: 1 }), owner: P2, zone: "discard" },
      { key: "hand1", def: character({ name: "Hand One" }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 3 }), owner: P2, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...res(o.icons ?? { obsession: 6 }),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type AlBoard = ReturnType<typeof alistarBoard>;
const alStats = (g: AlBoard): [number, number, number] => [g.engine.getStat(g.id("al"), "strength"), g.engine.getStat(g.id("al"), "speed"), g.engine.getStat(g.id("al"), "life")];
/** Deploys Alistar from hand and settles. */
const deployAlistar = (g: AlBoard) => {
  play(g.engine, P1, g.id("al"));
  drain(g.engine, declineAll);
};

clause(ALISTAR, "0:unique", "printed card: arcanist ritualist, 4 str / 3 spd / 4 life, deploys for exactly 6 with [O][O][O]", () => {
  const p = printing(ALISTAR);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "arcanist");
  assert.deepEqual(p.subtype, ["ritualist"]);
  assert.equal(p.cost, 6);
  assert.equal(p.threshold, "ooo");
  const g = alistarBoard();
  assert.equal(spentBy(g.engine, P1, () => deployAlistar(g)), 6);
  assert.equal(zoneOf(g.engine, g.id("al")), "play");
  assert.deepEqual(alStats(g), [4, 3, 4]);
  const short = alistarBoard({ icons: { obsession: 5 } });
  refused(() => playRaw(short.engine, P1, short.id("al")), "5 resources for cost 6");
  const twoIcons = alistarBoard({ icons: { obsession: 2, rage: 5 } });
  refused(() => playRaw(twoIcons.engine, P1, twoIcons.id("al")), "two [O] is short of [O][O][O]", /threshold/i);
});

clause(ALISTAR, "0:unique", "controlling a second Alistar makes you keep one (the controller chooses); a different designation is no duplicate", () => {
  const g = alistarBoard({ alistar: "play", extra: [{ key: "al2", def: printing(ALISTAR), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("al2"));
  let pc = pending(g.engine);
  if (pc?.kind === "orderTriggers") {
    answerPending(g.engine, "orderTriggers", { next: (pc.triggers as unknown[])[0] });
    pc = pending(g.engine);
  }
  const survivor = pc as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(survivor.kind, "uniqueSurvivor");
  assert.equal(survivor.playerId, P1);
  assert.deepEqual([...survivor.candidates].sort(), [g.id("al"), g.id("al2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("al") } } as never);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("al")), "play");
  assert.equal(zoneOf(g.engine, g.id("al2")), "discard");
  const other = alistarBoard({ alistar: "play", extra: [{ key: "ou", def: character({ name: "Other Unique", unique: "other unique" } as Partial<CardDefinition>), owner: P1, zone: "play" }] });
  assert.equal(other.engine.state.pendingChoice, undefined);
  const theirs = alistarBoard({ alistar: "play", extra: [{ key: "fal", def: printing(ALISTAR), owner: P2, zone: "play" }] });
  assert.equal(theirs.engine.state.pendingChoice, undefined, "the opponent may have their own Alistar");
  assert.equal(zoneOf(theirs.engine, theirs.id("fal")), "play");
});

clause(ALISTAR, "0:kw:TACTICAL", "has the TACTICAL keyword (a plain character does not)", () => {
  const g = alistarBoard({ alistar: "play", extra: [{ key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }] });
  assert.ok(g.engine.getKeywords(g.id("al")).includes("tactical"), "Alistar is tactical");
  assert.equal(g.engine.getKeywords(g.id("plain")).includes("tactical"), false);
});

clause(ALISTAR, "0:kw:TACTICAL", "can be deployed whenever a tactic could be (the opponent's attack window) for its printed cost, and not outside a window on their turn", () => {
  const atk = { key: "atk", def: character({ name: "Attacker", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" as const };
  const g = alistarBoard({ turn: 2, active: P2, extra: [atk] });
  refused(() => playRaw(g.engine, P1, g.id("al")), "no window open on the opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("al")), "hand");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("al"))), 6);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("al")), "play", "deployed on the opponent's turn");
  const plain = alistarBoard({ turn: 2, active: P2, extra: [atk, { key: "pc", def: character({ name: "Plain Card", cost: 0 }), owner: P1, zone: "hand" }] });
  declareAttackOpenWindow(plain.engine, P2, [plain.id("atk")]);
  refused(() => playRaw(plain.engine, P1, plain.id("pc")), "a non-tactical character can't be deployed in that window");
});

clause(ALISTAR, "0:kw:TACTICAL", "TACTICAL changes the timing only: the cost 6 and [O][O][O] are still required in the window", () => {
  const atk = { key: "atk", def: character({ name: "Attacker", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" as const };
  const lowIcons = alistarBoard({ turn: 2, active: P2, icons: { obsession: 2, rage: 4 }, extra: [atk] });
  declareAttackOpenWindow(lowIcons.engine, P2, [lowIcons.id("atk")]);
  refused(() => playRaw(lowIcons.engine, P1, lowIcons.id("al")), "two [O]", /threshold/i);
  const poor = alistarBoard({ turn: 2, active: P2, icons: { obsession: 5 }, extra: [atk] });
  declareAttackOpenWindow(poor.engine, P2, [poor.id("atk")]);
  refused(() => playRaw(poor.engine, P1, poor.id("al")), "5 resources for cost 6");
});

clause(ALISTAR, "1:rule", "when it enters play, my whole discard pile is voided (every card type), and nothing else moves", () => {
  const g = alistarBoard();
  deployAlistar(g);
  for (const k of ["dChar", "dTac", "dItem", "dRes"]) assert.equal(zoneOf(g.engine, g.id(k)), "void", `${k} is voided`);
  assert.equal(discardOf(g.engine, P1).length, 0, "my discard pile is empty");
  assert.equal(voidOf(g.engine, P1).length, 4);
  assert.equal(zoneOf(g.engine, g.id("hand1")), "hand", "my hand is untouched");
  assert.equal(deckOf(g.engine, P1).length, 4, "my deck is untouched");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(ALISTAR, "1:rule", "'your discard pile': the opponent's discard pile is not voided", () => {
  const g = alistarBoard();
  deployAlistar(g);
  assert.equal(zoneOf(g.engine, g.id("oDisc")), "discard");
  assert.deepEqual(discardOf(g.engine, P2), [g.id("oDisc")]);
});

clause(ALISTAR, "1:rule", "it works with an empty discard pile, and Alistar itself is not voided (it was never in the discard pile)", () => {
  const empty = devBoard([{ key: "al", def: printing(ALISTAR), owner: P1, zone: "hand" }, ...res({ obsession: 6 })]);
  play(empty.engine, P1, empty.id("al"));
  drain(empty.engine, declineAll);
  assert.equal(zoneOf(empty.engine, empty.id("al")), "play");
  assert.equal(voidOf(empty.engine, P1).length, 0);
});

clause(ALISTAR, "1:rule", "an opponent's Alistar voids only its own controller's discard pile", () => {
  const g = alistarBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "fal", def: printing(ALISTAR), owner: P2, zone: "hand" },
      ...res({ obsession: 6 }, P2)
    ]
  });
  play(g.engine, P2, g.id("fal"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("oDisc")), "void");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "discard", "my discard pile is not 'their' discard pile");
});

clause(ALISTAR, "1:rule", "it triggers only when THIS card enters play: another Alistar-less deploy voids nothing", () => {
  const g = alistarBoard({ alistar: "play", extra: [{ key: "newc", def: character({ name: "New", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("newc"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("newc")), "play");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "discard", "no trigger for another card entering play");
  assert.equal(voidOf(g.engine, P1).length, 0);
});

clause(ALISTAR, "2:rule", "a character voided by Alistar can be deployed from the Void as if it were in my hand, paying its cost and threshold", () => {
  const g = alistarBoard({ icons: { obsession: 9, rage: 2 } });
  deployAlistar(g);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "void");
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("dChar"))), 2, "its printed cost 2 is paid");
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "play", "deployed from the Void");
});

clause(ALISTAR, "2:rule", "a voided tactic can be played (and goes to the discard pile afterwards); a voided item can be deployed", () => {
  const g = alistarBoard({ icons: { obsession: 9 } });
  deployAlistar(g);
  const handBefore = handOf(g.engine, P1).length;
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("dTac"))), 1);
  assert.equal(zoneOf(g.engine, g.id("dTac")), "discard", "a tactic resolves into the discard pile");
  assert.equal(handOf(g.engine, P1).length, handBefore + 1, "its effect (draw a card) resolved");
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("dItem"))), 1);
  assert.equal(zoneOf(g.engine, g.id("dItem")), "play");
});

clause(ALISTAR, "2:rule", "'as if they were in your hand': the normal cost and threshold apply, so too few resources are refused", () => {
  const g = alistarBoard({ icons: { obsession: 6 } });
  deployAlistar(g);
  refused(() => playRaw(g.engine, P1, g.id("dChar")), "all six resources are spent on Alistar; Dead Char costs 2");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "void");
  const thr = alistarBoard({ icons: { obsession: 6, rage: 0 }, extra: [{ key: "dNeed", def: character({ name: "Needs Rage", cost: 0, threshold: "r" as never }), owner: P1, zone: "discard" }] });
  deployAlistar(thr);
  refused(() => playRaw(thr.engine, P1, thr.id("dNeed")), "no [R] icon for a threshold-[R] card", /threshold/i);
});

clause(ALISTAR, "2:rule", "only cards voided BY THIS CARD: a card placed in the Void some other way cannot be deployed from it", () => {
  const g = alistarBoard({ extra: [{ key: "otherVoid", def: character({ name: "Other Void", cost: 0 }), owner: P1, zone: "void" }], icons: { obsession: 9 } });
  deployAlistar(g);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "void");
  refused(() => playRaw(g.engine, P1, g.id("otherVoid")), "voided by something else, not by Alistar");
  assert.equal(zoneOf(g.engine, g.id("otherVoid")), "void");
  play(g.engine, P1, g.id("dChar"));
  assert.equal(zoneOf(g.engine, g.id("dChar")), "play", "control: the card Alistar voided can be deployed");
});

clause(ALISTAR, "2:rule", "'You may deploy': a voided resource is not deployed (resources are played, not deployed), so it cannot be played from the Void", () => {
  const g = alistarBoard({ icons: { obsession: 9 } });
  deployAlistar(g);
  assert.equal(zoneOf(g.engine, g.id("dRes")), "void");
  refused(() => playRaw(g.engine, P1, g.id("dRes")), "resources are not deployed");
  assert.equal(zoneOf(g.engine, g.id("dRes")), "void");
});

clause(ALISTAR, "2:rule", "'you may deploy': only the player controlling Alistar can; the opponent cannot deploy my voided cards", () => {
  const g = alistarBoard({ icons: { obsession: 6 }, extra: res({ rage: 4 }, P2) });
  deployAlistar(g);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  refused(() => playRaw(g.engine, P2, g.id("dChar")), "not the opponent's card");
  assert.equal(zoneOf(g.engine, g.id("dChar")), "void");
});

clause(ALISTAR, "2:rule", "the permission is a static ability of Alistar: once he leaves play the voided cards cannot be deployed", () => {
  const g = alistarBoard({ icons: { obsession: 9 }, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  deployAlistar(g);
  assert.equal(zoneOf(g.engine, g.id("dChar")), "void");
  // control: with Alistar in play the deploy is legal
  assert.equal(g.engine.getCardPlayability(P1, g.id("dChar")).playable, true, "playable while Alistar is in play");
  // Alistar is destroyed by a response-window kill on the opponent's attack
  const g2 = alistarBoard({ icons: { obsession: 9 }, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  deployAlistar(g2);
  play(g2.engine, P1, g2.id("kill"), { selected: { t: [g2.id("al")] } });
  assert.equal(zoneOf(g2.engine, g2.id("al")), "discard");
  assert.equal(zoneOf(g2.engine, g2.id("dChar")), "void");
  refused(() => playRaw(g2.engine, P1, g2.id("dChar")), "Alistar has left play");
});

// =============================================================================
// Alluring Quicksand — tactic, banker, cost 4, [G][G]
// EXTRA COST: Pick a character. -- Flip the character face-down under its owner's control.
// RECUR: [G][G][G][G] -- COST: Use this only if this card is in your discard pile. Pay 2. Void this card. Pick a character.
//   EFFECT: Flip the character face-down under its owner's control.
// =============================================================================

const QUICKSAND = "db964ede-8d9f-4414-962c-4f12a8df8a8b";

function qsBoard(opts: { qs?: Zone; icons?: Icons; extra?: CardPlacement[]; turn?: number; active?: PlayerId; owner?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "qs", def: printing(QUICKSAND), owner: opts.owner ?? P1, zone: opts.qs ?? "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}
type QsBoard = ReturnType<typeof qsBoard>;
const qsPlay = (g: QsBoard, target: string) => play(g.engine, P1, g.id("qs"), { selected: { t: [g.id(target)] } });
const qsPlayRaw = (g: QsBoard, target: string) => playRaw(g.engine, P1, g.id("qs"), { selected: { t: [g.id(target)] } });
const qsRecurRaw = (g: QsBoard, target: string, player: PlayerId = P1) => actRaw(g.engine, player, g.id("qs"), "quicksand-recur", { rt: [g.id(target)] });
const qsRecur = (g: QsBoard, target: string, player: PlayerId = P1) => activate(g.engine, player, g.id("qs"), "quicksand-recur", { selected: { rt: [g.id(target)] } });

/** Things a "character" pick must refuse. */
const NOT_CHARACTERS: Array<{ key: string; why: string; extra: CardPlacement[] }> = [
  { key: "it", why: "an item", extra: [{ key: "it", def: item({ name: "Trinket" }), owner: P2, zone: "play" }] },
  { key: "loc", why: "a location", extra: [{ key: "loc", def: location({ name: "Hovel" }), owner: P2, zone: "play" }] },
  { key: "rs", why: "a face-up resource", extra: [{ key: "rs", def: resourceCard({ name: "Rage Res" }), owner: P2, zone: "play" }] },
  { key: "fd", why: "a face-down card (a resource, CR 411.1)", extra: [{ key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }] },
  { key: "hd", why: "a character card in a hand", extra: [{ key: "hd", def: character({ name: "Handy" }), owner: P2, zone: "hand" }] },
  { key: "dk", why: "a character card in a deck", extra: [{ key: "dk", def: character({ name: "Deckard" }), owner: P2, zone: "deck" }] },
  { key: "dc", why: "a character card in a discard pile", extra: [{ key: "dc", def: character({ name: "Dusty" }), owner: P2, zone: "discard" }] }
];

clause(QUICKSAND, "0:extraCost", "printed card: banker tactic, cost 4 (exactly 4 paid), [G][G]; ends in the discard pile", () => {
  const p = printing(QUICKSAND);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "banker");
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "gg");
  const g = qsBoard({ icons: { greed: 6 } });
  assert.equal(spentBy(g.engine, P1, () => qsPlay(g, "foe")), 4);
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
  assert.equal(voidOf(g.engine, P1).includes(g.id("qs")), false, "only RECUR voids it");
});

clause(QUICKSAND, "0:extraCost", "costs 4: 3 resources are refused, and [G][G] is needed even with 4+ resources", () => {
  const short = qsBoard({ icons: { greed: 3 } });
  refused(() => qsPlayRaw(short, "foe"), "3 resources for a cost of 4");
  assert.equal(zoneOf(short.engine, short.id("qs")), "hand");
  const oneGreed = qsBoard({ icons: { greed: 1, rage: 4 } });
  refused(() => qsPlayRaw(oneGreed, "foe"), "one [G] is short of [G][G]", /threshold/i);
  const noGreed = qsBoard({ icons: { rage: 5 } });
  refused(() => qsPlayRaw(noGreed, "foe"), "no [G] at all");
  const twoGreed = qsBoard({ icons: { greed: 2, rage: 2 } });
  qsPlay(twoGreed, "foe");
  assert.equal(cardOf(twoGreed.engine, twoGreed.id("foe")).faceDown, true);
});

clause(QUICKSAND, "0:extraCost", "the pick is part of playing it: with no pick, two picks, or no character in play it cannot be played", () => {
  const g = qsBoard();
  refused(() => playRaw(g.engine, P1, g.id("qs")), "no character picked");
  assert.equal(zoneOf(g.engine, g.id("qs")), "hand");
  refused(() => playRaw(g.engine, P1, g.id("qs"), { selected: { t: [g.id("foe"), g.id("mine")] } }), "two characters picked for 'a character'");
  assert.equal(ready(g.engine), 4, "nothing was paid");
  const empty = devBoard([{ key: "qs", def: printing(QUICKSAND), owner: P1, zone: "hand" }, ...res({ greed: 4 })]);
  refused(() => playRaw(empty.engine, P1, empty.id("qs")), "no characters in play");
});

for (const bad of NOT_CHARACTERS) {
  clause(QUICKSAND, "0:extraCost", `cannot pick ${bad.why}`, () => {
    const g = qsBoard({ extra: bad.extra });
    refused(() => qsPlayRaw(g, bad.key), `picking ${bad.why}`);
    assert.equal(zoneOf(g.engine, g.id("qs")), "hand", "nothing was paid or played");
    assert.equal(ready(g.engine), 4);
    const control = qsBoard({ extra: bad.extra });
    qsPlay(control, "foe");
    assert.equal(cardOf(control.engine, control.id("foe")).faceDown, true, "control: a character can be picked on the same board");
  });
}

clause(QUICKSAND, "0:extraCost", "cannot pick a faction (CR 202.9): neither mine nor my opponent's", () => {
  const g = qsBoard();
  refused(() => playRaw(g.engine, P1, g.id("qs"), { selected: { t: [g.engine.state.players[P2].factionId!] } }), "their faction");
  refused(() => playRaw(g.engine, P1, g.id("qs"), { selected: { t: [g.engine.state.players[P1].factionId!] } }), "my faction");
  assert.equal(zoneOf(g.engine, g.id("qs")), "hand");
});

clause(QUICKSAND, "0:extraCost", "either player's character can be picked (my own too)", () => {
  const g = qsBoard();
  qsPlay(g, "mine");
  assert.equal(cardOf(g.engine, g.id("mine")).faceDown, true);
  assert.equal(cardOf(g.engine, g.id("mine")).controllerId, P1);
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false, "control: the other character is untouched");
});

clause(QUICKSAND, "0:extraCost", "the cost is paid when the tactic is played, before my opponent can respond; the flip waits for resolution", () => {
  const g = qsBoard({ icons: { greed: 6 } });
  const before = ready(g.engine);
  qsPlayRaw(g, "foe");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(before - ready(g.engine), 4, "the cost is already paid");
  assert.equal(zoneOf(g.engine, g.id("qs")), "deploying");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false, "the flip has not happened yet");
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true);
});

clause(QUICKSAND, "1:rule", "flips the picked character face-down: it stays in play as a face-down resource under its owner's control", () => {
  const g = qsBoard();
  qsPlay(g, "foe");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("foe"));
  assert.equal(card.zone, "play", "it is flipped, not destroyed or moved");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P2);
  assert.deepEqual(g.engine.getCardTypes(g.id("foe")), ["resource"], "a face-down card is only a resource (CR 411.1)");
});

clause(QUICKSAND, "1:rule", "only the picked character is flipped: every other character, in either play area, is untouched", () => {
  const g = qsBoard({ extra: chars("pad", 2, P1, "play").concat(chars("opp", 2, P2, "play")) });
  qsPlay(g, "foe");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true);
  for (const key of ["mine", "pad0", "pad1", "opp0", "opp1"]) {
    assert.equal(cardOf(g.engine, g.id(key)).faceDown, false, `${key} stays face-up`);
    assert.equal(zoneOf(g.engine, g.id(key)), "play");
  }
});

clause(QUICKSAND, "1:rule", "the flipped character is a face-down resource: one Volition icon and one ready resource for its owner (CR 203.4a)", () => {
  const g = qsBoard();
  const volBefore = g.engine.getThresholds(P2).volition ?? 0;
  const readyBefore = ready(g.engine, P2);
  qsPlay(g, "foe");
  assert.equal(g.engine.getThresholds(P2).volition ?? 0, volBefore + 1);
  assert.equal(ready(g.engine, P2), readyBefore + 1);
});

clause(QUICKSAND, "1:rule", "'under its OWNER's control': a character I stole goes back to its owner face-down; my card my opponent stole comes back to me", () => {
  const g = qsBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }] });
  assert.equal(cardOf(g.engine, g.id("stolen")).controllerId, P1, "control: I control it first");
  qsPlay(g, "stolen");
  const card = cardOf(g.engine, g.id("stolen"));
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P2, "under its owner's control");
  assert.equal(g.engine.state.players[P1].play.includes(g.id("stolen")), false, "gone from my play area");
  const lent = qsBoard({ extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" }] });
  qsPlay(lent, "lent");
  assert.equal(cardOf(lent.engine, lent.id("lent")).faceDown, true);
  assert.equal(cardOf(lent.engine, lent.id("lent")).controllerId, P1, "its owner (me) controls the face-down resource");
});

clause(QUICKSAND, "1:rule", "the flipped card is brand new: damage, depletion and tokens do not carry over (CR 411.3)", () => {
  const g = qsBoard({
    extra: [{ key: "hurt", def: character({ name: "Hurt", life: 6 }), owner: P2, zone: "play", damage: 3, depleted: true, counters: { token: 2 } }]
  });
  qsPlay(g, "hurt");
  const card = cardOf(g.engine, g.id("hurt"));
  assert.equal(card.faceDown, true);
  assert.equal(card.damage, 0);
  assert.equal(card.depleted, false);
  assert.equal(card.counters?.token ?? 0, 0);
});

clause(QUICKSAND, "1:rule", "the pick is resolved when the tactic resolves: a character destroyed or bounced in response is not flipped", () => {
  const g = qsBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  qsPlayRaw(g, "foe");
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("foe")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false);
  assert.equal(cardOf(g.engine, g.id("mine")).faceDown, false, "no other character is flipped");
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
});

clause(QUICKSAND, "1:rule", "can be played in response on my opponent's turn, and a flipped attacker drops out of the battle (no longer a character)", () => {
  const g = qsBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 4 }), owner: P2, zone: "play" }] });
  const hurt = influenceOf(g.engine, P1);
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("qs"), { t: [g.id("atk")] });
  assert.equal(cardOf(g.engine, g.id("atk")).faceDown, true);
  assert.equal(cardOf(g.engine, g.id("atk")).controllerId, P2);
  assert.deepEqual(battleOf(g.engine)?.attackingParty ?? [], [], "the attacking party is empty");
  if (battleOf(g.engine)) finishBattle(g.engine);
  assert.equal(influenceOf(g.engine, P1), hurt, "the face-down attacker dealt no battle damage");
});

clause(QUICKSAND, "1:rule", "a character with a gear item attached flips; the attachment stays in play flipped face-down with its host", () => {
  const gear = item({ name: "Gear", attachTo: "character", behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] } });
  const g = qsBoard({ extra: [{ key: "gear", def: gear, owner: P2, zone: "play", attachedToKey: "foe" }] });
  qsPlay(g, "foe");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("gear")), "play");
  assert.equal(cardOf(g.engine, g.id("gear")).faceDown, true, "flipped face-down with its host");
});

// --- RECUR ---

clause(QUICKSAND, "2:ability:quicksand-recur", "from my discard pile it flips a character face-down under its owner's control", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  qsRecur(g, "foe");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const card = cardOf(g.engine, g.id("foe"));
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P2);
  assert.deepEqual(g.engine.getCardTypes(g.id("foe")), ["resource"]);
});

clause(QUICKSAND, "2:ability:quicksand-recur", "Pay 2 exactly, and 'Void this card': it ends in the Void zone, not the discard pile or removed zone", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  assert.equal(spentBy(g.engine, P1, () => qsRecur(g, "foe")), 2, "Pay 2");
  assert.equal(zoneOf(g.engine, g.id("qs")), "void");
  assert.ok(voidOf(g.engine, P1).includes(g.id("qs")), "in my Void");
  assert.equal(discardOf(g.engine, P1).includes(g.id("qs")), false);
});

clause(QUICKSAND, "2:ability:quicksand-recur", "the cost (Pay 2, void this card) is paid when it is used, before the opponent can respond", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  const before = ready(g.engine);
  qsRecurRaw(g, "foe");
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(before - ready(g.engine), 2);
  assert.equal(zoneOf(g.engine, g.id("qs")), "void");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false, "the flip waits for resolution");
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, true);
});

clause(QUICKSAND, "2:ability:quicksand-recur", "RECUR can flip my own character, and a stolen one goes back under its owner's control", () => {
  const own = qsBoard({ qs: "discard", icons: { greed: 6 } });
  qsRecur(own, "mine");
  assert.equal(cardOf(own.engine, own.id("mine")).faceDown, true);
  assert.equal(cardOf(own.engine, own.id("mine")).controllerId, P1);
  const stolen = qsBoard({
    qs: "discard",
    icons: { greed: 6 },
    extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }]
  });
  qsRecur(stolen, "stolen");
  assert.equal(cardOf(stolen.engine, stolen.id("stolen")).faceDown, true);
  assert.equal(cardOf(stolen.engine, stolen.id("stolen")).controllerId, P2, "under its owner's control");
});

clause(QUICKSAND, "2:ability:quicksand-recur", "needs [G][G][G][G]: three Greed with plenty of other resources is refused, four works", () => {
  const three = qsBoard({ qs: "discard", icons: { greed: 3, rage: 4 } });
  refused(() => qsRecurRaw(three, "foe"), "three [G] is short of [G][G][G][G]", /threshold|requirement/i);
  assert.equal(zoneOf(three.engine, three.id("qs")), "discard");
  assert.equal(cardOf(three.engine, three.id("foe")).faceDown, false);
  const four = qsBoard({ qs: "discard", icons: { greed: 4, rage: 2 } });
  qsRecur(four, "foe");
  assert.equal(cardOf(four.engine, four.id("foe")).faceDown, true);
});

clause(QUICKSAND, "2:ability:quicksand-recur", "Pay 2: refused with fewer than 2 free resources even with [G][G][G][G] controlled (spent resources still give the icons)", () => {
  const spent = (n: number) => bank("greed", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const short = qsBoard({ qs: "discard", icons: {}, extra: [...spent(3), ...res({ greed: 1 })] });
  assert.equal(ready(short.engine), 1);
  refused(() => qsRecurRaw(short, "foe"), "one free resource for Pay 2");
  assert.equal(zoneOf(short.engine, short.id("qs")), "discard", "nothing was voided");
  const exact = qsBoard({ qs: "discard", icons: {}, extra: [...spent(2), ...res({ greed: 2 })] });
  qsRecur(exact, "foe");
  assert.equal(cardOf(exact.engine, exact.id("foe")).faceDown, true);
  assert.equal(ready(exact.engine), 0);
});

clause(QUICKSAND, "2:ability:quicksand-recur", "Use this only if this card is in your discard pile: refused from hand, deck, play and the Void", () => {
  for (const where of ["hand", "deck", "void", "play"] as const) {
    const g = qsBoard({ qs: where, icons: { greed: 6 } });
    refused(() => qsRecurRaw(g, "foe"), `Quicksand in ${where}`);
    assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false);
    assert.equal(zoneOf(g.engine, g.id("qs")), where);
  }
  const control = qsBoard({ qs: "discard", icons: { greed: 6 } });
  qsRecur(control, "foe");
  assert.equal(cardOf(control.engine, control.id("foe")).faceDown, true, "control: from the discard pile it works");
});

clause(QUICKSAND, "2:ability:quicksand-recur", "'your discard pile': a Quicksand in my OPPONENT's discard pile cannot be recurred by me", () => {
  const g = qsBoard({ qs: "discard", owner: P2, icons: { greed: 6 } });
  refused(() => qsRecurRaw(g, "foe", P1), "their discard pile");
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
  assert.equal(cardOf(g.engine, g.id("foe")).faceDown, false);
});

clause(QUICKSAND, "2:ability:quicksand-recur", "RECUR is a one-shot: once voided the card cannot be recurred again", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 8 } });
  qsRecur(g, "foe");
  refused(() => qsRecurRaw(g, "mine"), "the card has left the discard pile");
  assert.equal(cardOf(g.engine, g.id("mine")).faceDown, false);
});

for (const bad of NOT_CHARACTERS) {
  clause(QUICKSAND, "2:ability:quicksand-recur", `RECUR cannot pick ${bad.why}`, () => {
    const g = qsBoard({ qs: "discard", icons: { greed: 6 }, extra: bad.extra });
    refused(() => qsRecurRaw(g, bad.key), `picking ${bad.why}`);
    assert.equal(zoneOf(g.engine, g.id("qs")), "discard", "nothing was paid or voided");
    assert.equal(ready(g.engine), 6);
  });
}

clause(QUICKSAND, "2:ability:quicksand-recur", "RECUR needs a pick and cannot pick a faction", () => {
  const g = qsBoard({ qs: "discard", icons: { greed: 6 } });
  refused(() => actRaw(g.engine, P1, g.id("qs"), "quicksand-recur", {}), "no pick");
  refused(() => actRaw(g.engine, P1, g.id("qs"), "quicksand-recur", { rt: [g.engine.state.players[P2].factionId!] }), "their faction");
  assert.equal(zoneOf(g.engine, g.id("qs")), "discard");
  assert.equal(ready(g.engine), 6);
});

// =============================================================================
// Ancestral Coffers — location, banker, cost 4, [G][G], structure 5
// At the start of your turn, draw a card and gain 1 influence.
// =============================================================================

const COFFERS = "fc47f513-5247-4454-8747-067127c7ed06";

function coffersBoard(extra: CardPlacement[] = [], o: { coffers?: Zone; owner?: PlayerId; deck?: number } = {}) {
  return devBoard([
    { key: "cf", def: printing(COFFERS), owner: o.owner ?? P1, zone: o.coffers ?? "play" },
    ...fillers("d", o.deck ?? 5, P1, "deck"),
    ...fillers("e", 5, P2, "deck"),
    ...extra
  ]);
}

clause(COFFERS, "0:rule", "printed card: banker location, cost 4, [G][G], structure 5", () => {
  const p = printing(COFFERS);
  assert.equal(p.type, "location");
  assert.equal(p.trade, "banker");
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "gg");
  const g = coffersBoard([...res({ greed: 4 })], { coffers: "hand" });
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("cf"))), 4);
  assert.equal(zoneOf(g.engine, g.id("cf")), "play");
  assert.equal(g.engine.getStat(g.id("cf"), "structure"), 5);
  const short = coffersBoard([...res({ greed: 3 })], { coffers: "hand" });
  refused(() => playRaw(short.engine, P1, short.id("cf")), "3 resources for cost 4");
  const oneGreed = coffersBoard([...res({ greed: 1, rage: 4 })], { coffers: "hand" });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("cf")), "one [G] is short of [G][G]", /threshold/i);
});

clause(COFFERS, "0:rule", "at the start of my turn I draw a card (the top of my deck) and gain 1 influence", () => {
  const g = coffersBoard();
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  const top = deckOf(g.engine, P1)[0];
  const hand = handOf(g.engine, P1).length;
  const inf = influenceOf(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, hand + 1, "drew exactly one card");
  assert.equal(zoneOf(g.engine, top), "hand", "the top card of the deck");
  assert.equal(influenceOf(g.engine, P1), inf + 1, "gained exactly 1 influence");
});

clause(COFFERS, "0:rule", "it does not trigger at the start of the opponent's turn", () => {
  const g = coffersBoard();
  const hand = handOf(g.engine, P1).length;
  const inf = influenceOf(g.engine, P1);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(handOf(g.engine, P1).length, hand);
  assert.equal(influenceOf(g.engine, P1), inf);
  assert.equal(handOf(g.engine, P2).length, 0, "and the opponent gets nothing from my Coffers");
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(COFFERS, "0:rule", "'your turn': an opponent's Coffers pays its controller at THEIR turn start, not mine", () => {
  const g = coffersBoard([], { owner: P2 });
  const inf2 = influenceOf(g.engine, P2);
  endTurn(g.engine, P1);
  assert.equal(handOf(g.engine, P2).length, 1, "the opponent drew");
  assert.equal(influenceOf(g.engine, P2), inf2 + 1);
  assert.equal(handOf(g.engine, P1).length, 0);
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(COFFERS, "0:rule", "every turn: it triggers again at the next own turn start", () => {
  const g = coffersBoard();
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(handOf(g.engine, P1).length, 2);
  assert.equal(influenceOf(g.engine, P1), START + 2);
});

clause(COFFERS, "0:rule", "two Coffers each trigger: draw 2 and gain 2 influence", () => {
  const g = coffersBoard([{ key: "cf2", def: printing(COFFERS), owner: P1, zone: "play" }]);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(handOf(g.engine, P1).length, 2);
  assert.equal(influenceOf(g.engine, P1), START + 2);
});

clause(COFFERS, "0:rule", "it works only while in play: a Coffers in hand or in the discard pile does nothing", () => {
  for (const zone of ["hand", "discard", "deck"] as const) {
    const g = coffersBoard([], { coffers: zone });
    endTurn(g.engine, P1);
    endTurn(g.engine, P2);
    assert.equal(influenceOf(g.engine, P1), START, `Coffers in ${zone}`);
    assert.equal(handOf(g.engine, P1).length, zone === "hand" ? 1 : 0, `Coffers in ${zone}: no draw`);
  }
});

clause(COFFERS, "0:rule", "once destroyed (structure 5 damage) it no longer triggers", () => {
  const g = coffersBoard([{ key: "bolt", def: tactic({ name: "Bolt", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }] }] } }), owner: P2, zone: "hand" }]);
  endTurn(g.engine, P1);
  play(g.engine, P2, g.id("bolt"), { selected: { t: [g.id("cf")] } });
  assert.equal(zoneOf(g.engine, g.id("cf")), "discard");
  endTurn(g.engine, P2);
  assert.equal(influenceOf(g.engine, P1), START);
  assert.equal(handOf(g.engine, P1).length, 0);
});

// =============================================================================
// Arathea, the Undying — character, rogue, sarcophyle, cost 5, [D][D], 3 str / 4 spd / 3 life
// UNIQUE ARATHEA
// SEDUCE -- COST: Use this ability in response to a non-character card being deployed. Destroy this card.
//   EFFECT: That card's controller may pay 3. If they don't, terminate the card being deployed.
// REANIMATE -- COST: Use this only if this card is in your discard pile. Destroy a character you control.
//   EFFECT: Put this card into its owner's hand.
// =============================================================================

const ARATHEA = "915c6a8b-d0cc-4754-8e8d-22f8ab60f754";

/** P2 (active) is deploying `foe`; P1 has Arathea in play. Returns before P1 does anything. */
function seduceBoard(o: { foe?: CardDefinition; p2Resources?: number; deploy?: boolean; ara?: Zone } = {}) {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "ara", def: printing(ARATHEA), owner: P1, zone: o.ara ?? "play" },
      { key: "foe", def: o.foe ?? cantrip("Foe Tactic", 0), owner: P2, zone: "hand" },
      { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
      ...fillers("d", 4, P2, "deck"),
      ...bank("rage", o.p2Resources ?? 3, P2)
    ]
  });
  if (o.deploy !== false) playRaw(g.engine, P2, g.id("foe"));
  return g;
}
type SedBoard = ReturnType<typeof seduceBoard>;
const seduce = (g: SedBoard) => actRaw(g.engine, P1, g.id("ara"), "seduce");

clause(ARATHEA, "0:unique", "printed card: rogue sarcophyle, 3 str / 4 spd / 3 life, deploys for exactly 5 with [D][D]", () => {
  const p = printing(ARATHEA);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "rogue");
  assert.deepEqual(p.subtype, ["sarcophyle"]);
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "dd");
  const g = devBoard([{ key: "ara", def: printing(ARATHEA), owner: P1, zone: "hand" }, ...res({ deception: 5 })]);
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("ara"))), 5);
  assert.deepEqual([g.engine.getStat(g.id("ara"), "strength"), g.engine.getStat(g.id("ara"), "speed"), g.engine.getStat(g.id("ara"), "life")], [3, 4, 3]);
  const short = devBoard([{ key: "ara", def: printing(ARATHEA), owner: P1, zone: "hand" }, ...res({ deception: 4 })]);
  refused(() => playRaw(short.engine, P1, short.id("ara")), "4 resources for cost 5");
  const oneIcon = devBoard([{ key: "ara", def: printing(ARATHEA), owner: P1, zone: "hand" }, ...res({ deception: 1, rage: 5 })]);
  refused(() => playRaw(oneIcon.engine, P1, oneIcon.id("ara")), "one [D] is short of [D][D]", /threshold/i);
});

clause(ARATHEA, "0:unique", "controlling a second Arathea makes you keep one; Adriel (a different designation) is no duplicate; the opponent may have their own", () => {
  const g = devBoard([
    { key: "ara", def: printing(ARATHEA), owner: P1, zone: "play" },
    { key: "ara2", def: printing(ARATHEA), owner: P1, zone: "hand" },
    ...res({ deception: 5 })
  ]);
  play(g.engine, P1, g.id("ara2"));
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [g.id("ara"), g.id("ara2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("ara2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("ara2")), "play");
  assert.equal(zoneOf(g.engine, g.id("ara")), "discard");
  const other = devBoard([
    { key: "ara", def: printing(ARATHEA), owner: P1, zone: "play" },
    { key: "adr", def: printing(ADRIEL), owner: P1, zone: "play" },
    { key: "fara", def: printing(ARATHEA), owner: P2, zone: "play" }
  ]);
  assert.equal(other.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(other.engine, other.id("ara")), "play");
  assert.equal(zoneOf(other.engine, other.id("adr")), "play");
  assert.equal(zoneOf(other.engine, other.id("fara")), "play");
});

clause(ARATHEA, "1:ability:seduce", "in response to a tactic being deployed: destroys Arathea as the cost, and the card's controller is asked whether to pay 3", () => {
  const g = seduceBoard();
  seduce(g);
  assert.equal(zoneOf(g.engine, g.id("ara")), "discard", "the cost destroyed Arathea");
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "THAT CARD'S controller decides, not Arathea's controller");
});

clause(ARATHEA, "1:ability:seduce", "the cost is paid when the ability is used, before the opponent can respond", () => {
  const g = seduceBoard();
  seduce(g);
  assert.equal(zoneOf(g.engine, g.id("ara")), "discard", "destroyed while the window is still open");
  assert.equal(g.engine.state.priorityPlayerId, P2);
});

clause(ARATHEA, "1:ability:seduce", "if the controller pays 3, the card resolves normally (and exactly 3 resources are paid)", () => {
  const g = seduceBoard({ p2Resources: 4 });
  const top = deckOf(g.engine, P2)[0];
  const before = ready(g.engine, P2);
  seduce(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, acceptPay);
  assert.equal(before - ready(g.engine, P2), 3, "paid exactly 3");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "the tactic resolved into its owner's discard pile");
  assert.equal(zoneOf(g.engine, top), "hand", "its effect (draw a card) happened");
});

clause(ARATHEA, "1:ability:seduce", "if the controller doesn't pay, the card being deployed is terminated: no effect, straight to its owner's discard pile", () => {
  const g = seduceBoard({ p2Resources: 4 });
  const top = deckOf(g.engine, P2)[0];
  const before = ready(g.engine, P2);
  seduce(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, refusePay);
  assert.equal(ready(g.engine, P2), before, "nothing paid");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(zoneOf(g.engine, top), "deck", "the tactic's draw did not happen");
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(ARATHEA, "1:ability:seduce", "a controller who cannot pay 3 (only 2 resources) cannot save the card: it is terminated", () => {
  const g = seduceBoard({ p2Resources: 2 });
  const top = deckOf(g.engine, P2)[0];
  seduce(g);
  resolvePendingResponses(g.engine);
  drain(g.engine, (pc) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(zoneOf(g.engine, top), "deck", "no draw");
  assert.equal(ready(g.engine, P2), 2, "the 2 resources were not spent");
});

for (const [label, foe, destination] of [
  ["an item", item({ name: "Foe Item", cost: 0 }), "play"],
  ["a location", location({ name: "Foe Location", cost: 0, structure: 2 }), "play"]
] as const) {
  clause(ARATHEA, "1:ability:seduce", `works in response to ${label} being deployed: unpaid it is terminated (never enters play), paid it enters play`, () => {
    const declined = seduceBoard({ foe });
    seduce(declined);
    resolvePendingResponses(declined.engine);
    drain(declined.engine, refusePay);
    assert.equal(zoneOf(declined.engine, declined.id("foe")), "discard", `${label} was terminated`);
    const paid = seduceBoard({ foe });
    seduce(paid);
    resolvePendingResponses(paid.engine);
    drain(paid.engine, acceptPay);
    assert.equal(zoneOf(paid.engine, paid.id("foe")), destination, `${label} entered play when paid`);
    assert.equal(zoneOf(paid.engine, paid.id("ara")), "discard");
  });
}

clause(ARATHEA, "1:ability:seduce", "'non-character': refused in response to a character being deployed", () => {
  const g = seduceBoard({ foe: character({ name: "Foe Char", cost: 0 }) });
  refused(() => seduce(g), "a character is being deployed");
  assert.equal(zoneOf(g.engine, g.id("ara")), "play", "Arathea was not destroyed");
  const control = seduceBoard({ foe: item({ name: "Foe Item", cost: 0 }) });
  seduce(control);
  assert.equal(zoneOf(control.engine, control.id("ara")), "discard", "control: an item is a legal response target");
});

clause(ARATHEA, "1:ability:seduce", "'in response to a card being deployed': refused with nothing on the stack, and in response to an ability", () => {
  const idle = seduceBoard({ deploy: false });
  refused(() => seduce(idle), "nothing is being deployed");
  assert.equal(zoneOf(idle.engine, idle.id("ara")), "play");
  const worker = character({ name: "Worker", behavior: { abilities: [{ id: "work", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "ara", def: printing(ARATHEA), owner: P1, zone: "play" },
      { key: "w", def: worker, owner: P2, zone: "play" },
      ...fillers("d", 2, P2, "deck")
    ]
  });
  actRaw(g.engine, P2, g.id("w"), "work");
  assert.ok(g.engine.state.responseWindow, "the ability is on the stack");
  refused(() => actRaw(g.engine, P1, g.id("ara"), "seduce"), "an ability, not a card being deployed");
  assert.equal(zoneOf(g.engine, g.id("ara")), "play");
});

clause(ARATHEA, "1:ability:seduce", "usable only from play: Arathea in my hand or discard pile cannot use SEDUCE", () => {
  for (const where of ["hand", "discard"] as const) {
    const g = seduceBoard({ ara: where });
    refused(() => seduce(g), `Arathea in ${where}`);
    assert.equal(zoneOf(g.engine, g.id("ara")), where);
  }
});

clause(ARATHEA, "2:ability:reanimate", "from my discard pile: destroys a character I control as the cost and puts Arathea into her owner's hand", () => {
  const g = devBoard([
    { key: "ara", def: printing(ARATHEA), owner: P1, zone: "discard" },
    { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
    { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "play" }
  ]);
  activate(g.engine, P1, g.id("ara"), "reanimate", { selected: { sac: [g.id("sac")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("sac")), "discard", "the sacrifice was destroyed");
  assert.equal(zoneOf(g.engine, g.id("ara")), "hand", "Arathea is back in her owner's hand");
  assert.equal(zoneOf(g.engine, g.id("keep")), "play", "only the picked character is destroyed");
});

clause(ARATHEA, "2:ability:reanimate", "no resources are needed, and the cost is paid when the ability is used (before the opponent can respond)", () => {
  const g = devBoard([
    { key: "ara", def: printing(ARATHEA), owner: P1, zone: "discard" },
    { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
    ...res({ rage: 2 })
  ]);
  const before = ready(g.engine);
  actRaw(g.engine, P1, g.id("ara"), "reanimate", { sac: [g.id("sac")] });
  assert.equal(zoneOf(g.engine, g.id("sac")), "discard", "destroyed while the window is open");
  assert.equal(zoneOf(g.engine, g.id("ara")), "discard", "not returned until it resolves");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ara")), "hand");
  assert.equal(ready(g.engine), before, "no resource paid");
});

clause(ARATHEA, "2:ability:reanimate", "a character I control: an opponent's character, an item and a faction are refused; a stolen character is mine", () => {
  const mk = () =>
    devBoard([
      { key: "ara", def: printing(ARATHEA), owner: P1, zone: "discard" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "idol", def: item({ name: "Idol" }), owner: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }
    ]);
  for (const key of ["foe", "idol", "lent"]) {
    const g = mk();
    refused(() => actRaw(g.engine, P1, g.id("ara"), "reanimate", { sac: [g.id(key)] }), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("ara")), "discard");
    assert.equal(zoneOf(g.engine, g.id(key)), "play");
  }
  const f = mk();
  refused(() => actRaw(f.engine, P1, f.id("ara"), "reanimate", { sac: [f.engine.state.players[P1].factionId!] }), "my faction");
  const s = mk();
  activate(s.engine, P1, s.id("ara"), "reanimate", { selected: { sac: [s.id("stolen")] } });
  assert.equal(zoneOf(s.engine, s.id("ara")), "hand", "control: a character I control (even a stolen one) is a legal sacrifice");
});

clause(ARATHEA, "2:ability:reanimate", "needs a character to destroy: refused with none in play, or with no pick", () => {
  const alone = devBoard([{ key: "ara", def: printing(ARATHEA), owner: P1, zone: "discard" }, { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }]);
  refused(() => actRaw(alone.engine, P1, alone.id("ara"), "reanimate", {}), "no character of mine");
  assert.equal(zoneOf(alone.engine, alone.id("ara")), "discard");
  const g = devBoard([{ key: "ara", def: printing(ARATHEA), owner: P1, zone: "discard" }, { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" }]);
  refused(() => actRaw(g.engine, P1, g.id("ara"), "reanimate", {}), "no pick");
  assert.equal(zoneOf(g.engine, g.id("sac")), "play");
});

clause(ARATHEA, "2:ability:reanimate", "Use this only if this card is in your discard pile: refused from play, hand, deck and the Void, and from the opponent's discard pile", () => {
  for (const where of ["play", "hand", "deck", "void"] as const) {
    const g = devBoard([{ key: "ara", def: printing(ARATHEA), owner: P1, zone: where }, { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" }]);
    refused(() => actRaw(g.engine, P1, g.id("ara"), "reanimate", { sac: [g.id("sac")] }), `Arathea in ${where}`);
    assert.equal(zoneOf(g.engine, g.id("sac")), "play", `${where}: nothing destroyed`);
  }
  const theirs = devBoard([{ key: "ara", def: printing(ARATHEA), owner: P2, zone: "discard" }, { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" }]);
  refused(() => actRaw(theirs.engine, P1, theirs.id("ara"), "reanimate", { sac: [theirs.id("sac")] }), "their discard pile");
});

// =============================================================================
// Aristocracy (resource, gearsmith, cost 0) and Avarice (resource, arcanist, cost 0)
// When a resource enters play under your control, name [E] icon or [D] icon (Avarice: [O] icon or [G] icon).
// X is the named icon. This turn, this card gains "PROVIDES: X".
// =============================================================================

const ARISTOCRACY = "702e82d6-140f-49b9-8122-f1201dd790d7";
const AVARICE = "84888b76-c5fc-4824-bd6d-9f6a68a38ba8";

type IconName = "rage" | "greed" | "deception" | "elitism" | "obsession" | "volition";
const ALL_ICONS: IconName[] = ["rage", "greed", "deception", "elitism", "obsession", "volition"];

function namerBoard(namerId: string, o: { extra?: CardPlacement[]; namer?: Zone; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "nm", def: printing(namerId), owner: P1, zone: o.namer ?? "play" },
      { key: "hr", def: resourceCard({ name: "Hand Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "hr2", def: resourceCard({ name: "Hand Rage Two", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "hc", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" },
      { key: "orr", def: resourceCard({ name: "Their Rage", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type NmBoard = ReturnType<typeof namerBoard>;
const iconCount = (g: NmBoard, name: IconName, player: PlayerId = P1): number => (g.engine.getThresholds(player) as Record<string, number>)[name] ?? 0;

/** Develops `key` from hand as a resource (face-up unless `down`), leaving the nameValue prompt pending. */
const developKey = (g: NmBoard, key: string, down = false, player: PlayerId = P1) => developResource(g.engine, player, g.id(key), down);
const nameIt = (g: NmBoard, value: string) => answerPending(g.engine, "nameValue", { value });
const THRESH: Record<string, string> = { elitism: "e", deception: "d", obsession: "o", greed: "g" };

/** The whole clause, for a namer of icons `a` / `b`; each check is a function so each printing gets its own literal clause() calls. */
const namerChecks = (namerId: string, a: IconName, b: IconName) => ({
  offers: () => () => {
    const g = namerBoard(namerId);
    developKey(g, "hr");
    const pc = pending(g.engine) as unknown as { kind: string; playerId: string; options: string[] };
    assert.equal(pc?.kind, "nameValue", "a resource entering play under my control asks me to name an icon");
    assert.equal(pc.playerId, P1);
    assert.deepEqual([...pc.options].sort(), [a, b].sort(), "exactly the two printed icons are offered");
  },
  refusesOthers: () => () => {
    for (const bad of ALL_ICONS.filter((i) => i !== a && i !== b)) {
      const g = namerBoard(namerId);
      developKey(g, "hr");
      refused(() => nameIt(g, bad), `naming ${bad} is not allowed`);
      assert.equal(pending(g.engine)?.kind, "nameValue", `the prompt stays open after naming ${bad}`);
      assert.equal(iconCount(g, a), 0);
      assert.equal(iconCount(g, b), 0);
      nameIt(g, a);
      assert.equal(pending(g.engine), undefined, "control: a printed icon is accepted");
    }
  },
  gains: (named: IconName, other: IconName) => () => {
    const g = namerBoard(namerId);
    developKey(g, "hr");
    nameIt(g, named);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(iconCount(g, named), 1, `this card now provides ${named}`);
    assert.equal(iconCount(g, other), 0, `and not ${other}`);
    assert.equal(iconCount(g, "rage"), 1, "the entering Rage resource provides its own icon as normal");
  },
  unlocksThreshold: () => () => {
    const needs = character({ name: "NeedsIcon", cost: 0, threshold: THRESH[a] as never });
    const g = namerBoard(namerId, { extra: [{ key: "need", def: needs, owner: P1, zone: "hand" }] });
    refused(() => playRaw(g.engine, P1, g.id("need")), "no icon before the grant", /threshold/i);
    developKey(g, "hr");
    nameIt(g, a);
    play(g.engine, P1, g.id("need"));
    assert.equal(zoneOf(g.engine, g.id("need")), "play", "the granted icon meets the threshold");
  },
  thisTurn: () => () => {
    const g = namerBoard(namerId);
    developKey(g, "hr");
    nameIt(g, a);
    assert.equal(iconCount(g, a), 1);
    endTurn(g.engine, P1);
    endTurn(g.engine, P2);
    assert.equal(g.engine.state.activePlayerId, P1);
    assert.equal(iconCount(g, a), 0, "the grant lasted only the turn it was made");
    assert.equal(iconCount(g, "rage"), 1);
  },
  stacks: () => () => {
    const base = developFaction();
    const two = developFaction({ faction: { ...base.faction!, turn: { ...base.faction!.turn, develop: { choices: [{ type: "playResource", count: 2 }] } } } });
    const g = devBoard(
      [
        { key: "nm", def: printing(namerId), owner: P1, zone: "play" },
        { key: "hr", def: resourceCard({ name: "Hand Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
        { key: "hr2", def: resourceCard({ name: "Hand Rage Two", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" }
      ],
      { playerA: { faction: two } }
    );
    openDevelopPlay(g.engine, P1);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hr")], faceDown: false });
    nameIt(g as NmBoard, a);
    nameIt(g as NmBoard, b);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(iconCount(g as NmBoard, a), 1, "first grant");
    assert.equal(iconCount(g as NmBoard, b), 1, "second grant: each entering resource adds its own PROVIDES");
    const same = devBoard(
      [
        { key: "nm", def: printing(namerId), owner: P1, zone: "play" },
        { key: "hr", def: resourceCard({ name: "Hand Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
        { key: "hr2", def: resourceCard({ name: "Hand Rage Two", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" }
      ],
      { playerA: { faction: two } }
    );
    openDevelopPlay(same.engine, P1);
    answerPending(same.engine, "chooserSelectsTarget", { selected: [same.id("hr")], faceDown: false });
    nameIt(same as NmBoard, a);
    nameIt(same as NmBoard, a);
    assert.equal(iconCount(same as NmBoard, a), 2, "naming the same icon twice gives two icons");
  },
  noTriggerOpponent: () => () => {
    const g = namerBoard(namerId, { turn: 2, active: P2 });
    developKey(g, "orr", false, P2);
    assert.equal(pending(g.engine), undefined, "the opponent's resource entering play is not 'under your control'");
    assert.equal(iconCount(g, a), 0);
    assert.equal(iconCount(g, b), 0);
  },
  noTriggerNonResource: () => () => {
    const g = namerBoard(namerId);
    play(g.engine, P1, g.id("hc"));
    assert.equal(zoneOf(g.engine, g.id("hc")), "play");
    assert.equal(pending(g.engine), undefined, "a character entering play does not trigger it");
    assert.equal(iconCount(g, a), 0);
  },
  noTriggerSelf: () => () => {
    const g = namerBoard(namerId, { namer: "hand" });
    developKey(g, "nm");
    assert.equal(zoneOf(g.engine, g.id("nm")), "play");
    assert.equal(pending(g.engine), undefined, "its own entry does not trigger it (it must already be in play)");
    assert.equal(iconCount(g, a) + iconCount(g, b), 0);
  },
  noTriggerOutOfPlay: () => () => {
    for (const zone of ["hand", "discard"] as const) {
      const g = namerBoard(namerId, { namer: zone });
      developKey(g, "hr");
      assert.equal(pending(g.engine), undefined, `${namerId} in ${zone} does not trigger`);
    }
  },
  faceDown: () => () => {
    const g = namerBoard(namerId);
    developKey(g, "hr", true);
    const pc = pending(g.engine);
    assert.equal(pc?.kind, "nameValue", "a face-down card entering play is a resource entering play (CR 411.1)");
    nameIt(g, b);
    assert.equal(iconCount(g, b), 1);
    assert.equal(iconCount(g, "volition"), 1, "the face-down card itself provides Volition");
  }
});

const ARI = namerChecks(ARISTOCRACY, "elitism", "deception");
const AVA = namerChecks(AVARICE, "obsession", "greed");

clause(ARISTOCRACY, "0:rule", "a resource entering play under my control asks me to name an icon, and only [E] and [D] are offered", ARI.offers());
clause(ARISTOCRACY, "0:rule", "naming any other icon (Rage, Greed, Obsession, Volition) is refused; [E] and [D] are accepted", ARI.refusesOthers());
clause(ARISTOCRACY, "0:rule", "naming [E]: this card provides an [E] icon (and no [D])", ARI.gains("elitism", "deception"));
clause(ARISTOCRACY, "0:rule", "naming [D]: this card provides a [D] icon (and no [E])", ARI.gains("deception", "elitism"));
clause(ARISTOCRACY, "0:rule", "the granted [E] meets an [E] threshold that was unmet before", ARI.unlocksThreshold());
clause(ARISTOCRACY, "0:rule", "'this turn': the granted icon is gone at the next turn", ARI.thisTurn());
clause(ARISTOCRACY, "0:rule", "two resources entering play this turn give two grants (they stack)", ARI.stacks());
clause(ARISTOCRACY, "0:rule", "a face-down card entering play is a resource entering play: it triggers too", ARI.faceDown());
clause(ARISTOCRACY, "0:rule", "the opponent's resource entering play does not trigger it", ARI.noTriggerOpponent());
clause(ARISTOCRACY, "0:rule", "a non-resource (character) entering play does not trigger it", ARI.noTriggerNonResource());
clause(ARISTOCRACY, "0:rule", "it does not trigger on its own entry (it is not in play before it enters)", ARI.noTriggerSelf());
clause(ARISTOCRACY, "0:rule", "it only works in play: in hand or in the discard pile it does not trigger", ARI.noTriggerOutOfPlay());
clause(AVARICE, "0:rule", "a resource entering play under my control asks me to name an icon, and only [O] and [G] are offered", AVA.offers());
clause(AVARICE, "0:rule", "naming any other icon (Rage, Deception, Elitism, Volition) is refused; [O] and [G] are accepted", AVA.refusesOthers());
clause(AVARICE, "0:rule", "naming [O]: this card provides an [O] icon (and no [G])", AVA.gains("obsession", "greed"));
clause(AVARICE, "0:rule", "naming [G]: this card provides a [G] icon (and no [O])", AVA.gains("greed", "obsession"));
clause(AVARICE, "0:rule", "the granted [O] meets an [O] threshold that was unmet before", AVA.unlocksThreshold());
clause(AVARICE, "0:rule", "'this turn': the granted icon is gone at the next turn", AVA.thisTurn());
clause(AVARICE, "0:rule", "two resources entering play this turn give two grants (they stack)", AVA.stacks());
clause(AVARICE, "0:rule", "a face-down card entering play is a resource entering play: it triggers too", AVA.faceDown());
clause(AVARICE, "0:rule", "the opponent's resource entering play does not trigger it", AVA.noTriggerOpponent());
clause(AVARICE, "0:rule", "a non-resource (character) entering play does not trigger it", AVA.noTriggerNonResource());
clause(AVARICE, "0:rule", "it does not trigger on its own entry (it is not in play before it enters)", AVA.noTriggerSelf());
clause(AVARICE, "0:rule", "it only works in play: in hand or in the discard pile it does not trigger", AVA.noTriggerOutOfPlay());

// =============================================================================
// Armageddon Man — character, warlord, soldier, cost 5, [R][R], 3 str / 3 spd / 3 life
// EXTRA COST: You may pick a non-staple resource.
// When this card enters play, if you picked a non-staple resource as part of its extra cost, destroy it and deal 2 damage to its controller's faction.
// =============================================================================

const ARMAGEDDON = "de04e9b9-a1c4-4083-9c82-b7711179dfae";

const oddCoin = (name = "Odd Coin") => resourceCard({ name, resource: { provides: ["greed"], staple: false } });

function armBoard(o: { extra?: CardPlacement[]; rage?: number; am?: Zone } = {}) {
  return devBoard([
    { key: "am", def: printing(ARMAGEDDON), owner: P1, zone: o.am ?? "hand" },
    { key: "myOdd", def: oddCoin("My Odd Coin"), owner: P1, zone: "play" },
    { key: "theirOdd", def: oddCoin("Their Odd Coin"), owner: P2, zone: "play" },
    { key: "myStaple", def: resourceCard({ name: "My Staple", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "play" },
    { key: "theirStaple", def: resourceCard({ name: "Their Staple", resource: { provides: ["greed"], staple: true } }), owner: P2, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    ...res({ rage: o.rage ?? 5 }),
    ...(o.extra ?? [])
  ]);
}
type ArmBoard = ReturnType<typeof armBoard>;
const armPlay = (g: ArmBoard, pick?: string) => play(g.engine, P1, g.id("am"), { selected: pick ? { res: [g.id(pick)] } : {} });
const armPlayRaw = (g: ArmBoard, pick?: string) => playRaw(g.engine, P1, g.id("am"), { selected: pick ? { res: [g.id(pick)] } : {} });

clause(ARMAGEDDON, "0:extraCost", "printed card: warlord soldier, 3 / 3 / 3, deploys for exactly 5 with [R][R]", () => {
  const p = printing(ARMAGEDDON);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual(p.subtype, ["soldier"]);
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "rr");
  const g = armBoard();
  // the board's greed resources (staple and odd coins) are also free to pay with, so count what the deploy takes
  assert.equal(spentBy(g.engine, P1, () => armPlay(g)), 5);
  assert.equal(zoneOf(g.engine, g.id("am")), "play");
  assert.deepEqual([g.engine.getStat(g.id("am"), "strength"), g.engine.getStat(g.id("am"), "speed"), g.engine.getStat(g.id("am"), "life")], [3, 3, 3]);
  const oneIcon = devBoard([
    { key: "am", def: printing(ARMAGEDDON), owner: P1, zone: "hand" },
    ...res({ rage: 1, greed: 4 })
  ]);
  refused(() => playRaw(oneIcon.engine, P1, oneIcon.id("am")), "one [R] is short of [R][R]", /threshold/i);
  const poor = devBoard([{ key: "am", def: printing(ARMAGEDDON), owner: P1, zone: "hand" }, ...res({ rage: 4 })]);
  refused(() => playRaw(poor.engine, P1, poor.id("am")), "4 resources for cost 5");
});

clause(ARMAGEDDON, "0:extraCost", "'You may': it can be deployed with no pick at all, and then nothing is destroyed or damaged", () => {
  const g = armBoard();
  armPlay(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("am")), "play");
  for (const k of ["myOdd", "theirOdd", "myStaple", "theirStaple"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} untouched`);
  assert.equal(influenceOf(g.engine, P1), START);
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(ARMAGEDDON, "0:extraCost", "can pick a non-staple resource of either player (mine or my opponent's)", () => {
  const theirs = armBoard();
  armPlay(theirs, "theirOdd");
  assert.equal(zoneOf(theirs.engine, theirs.id("am")), "play");
  assert.equal(zoneOf(theirs.engine, theirs.id("theirOdd")), "discard");
  const mine = armBoard();
  armPlay(mine, "myOdd");
  assert.equal(zoneOf(mine.engine, mine.id("am")), "play");
  assert.equal(zoneOf(mine.engine, mine.id("myOdd")), "discard");
});

clause(ARMAGEDDON, "0:extraCost", "a staple resource cannot be picked (mine or theirs)", () => {
  for (const key of ["myStaple", "theirStaple"]) {
    const g = armBoard();
    refused(() => armPlayRaw(g, key), `${key} is a staple`);
    assert.equal(zoneOf(g.engine, g.id("am")), "hand", "nothing paid or played");
    assert.equal(zoneOf(g.engine, g.id(key)), "play");
  }
});

clause(ARMAGEDDON, "0:extraCost", "only a resource in play can be picked: a character, an item, a non-staple resource in hand or in the discard pile are refused", () => {
  const extra: CardPlacement[] = [
    { key: "item", def: item({ name: "An Item" }), owner: P2, zone: "play" },
    { key: "handOdd", def: oddCoin("Hand Odd"), owner: P1, zone: "hand" },
    { key: "discOdd", def: oddCoin("Disc Odd"), owner: P2, zone: "discard" }
  ];
  for (const key of ["foe", "item", "handOdd", "discOdd"]) {
    const g = armBoard({ extra });
    refused(() => armPlayRaw(g, key), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("am")), "hand");
    assert.equal(influenceOf(g.engine, P1), START);
    assert.equal(influenceOf(g.engine, P2), START);
  }
});

clause(ARMAGEDDON, "0:extraCost", "'a non-staple resource': at most one can be picked", () => {
  const g = armBoard();
  refused(() => playRaw(g.engine, P1, g.id("am"), { selected: { res: [g.id("myOdd"), g.id("theirOdd")] } }), "two picks for 'a' resource");
  assert.equal(zoneOf(g.engine, g.id("am")), "hand");
});

clause(ARMAGEDDON, "1:rule", "picked opponent's resource: when Armageddon Man enters play it is destroyed and 2 damage is dealt to the OPPONENT's faction", () => {
  const g = armBoard();
  armPlay(g, "theirOdd");
  assert.equal(zoneOf(g.engine, g.id("theirOdd")), "discard", "destroyed");
  assert.equal(influenceOf(g.engine, P2), START - 2, "2 damage to its controller's faction");
  assert.equal(influenceOf(g.engine, P1), START, "my faction is untouched");
});

clause(ARMAGEDDON, "1:rule", "picked my own resource: it is destroyed and 2 damage is dealt to MY faction ('its controller's faction')", () => {
  const g = armBoard();
  armPlay(g, "myOdd");
  assert.equal(zoneOf(g.engine, g.id("myOdd")), "discard");
  assert.equal(influenceOf(g.engine, P1), START - 2);
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(ARMAGEDDON, "1:rule", "the resource's CONTROLLER takes the damage, not its owner: a stolen non-staple resource damages the thief's faction", () => {
  const g = armBoard({ extra: [{ key: "stolen", def: oddCoin("Stolen Odd"), owner: P2, controller: P1, zone: "play" }] });
  armPlay(g, "stolen");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard");
  assert.equal(influenceOf(g.engine, P1), START - 2, "its controller (me) takes the damage");
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(ARMAGEDDON, "1:rule", "the effect happens when it ENTERS PLAY: while the deploy waits for responses nothing is destroyed yet", () => {
  const g = armBoard();
  armPlayRaw(g, "theirOdd");
  assert.equal(zoneOf(g.engine, g.id("theirOdd")), "play", "still in play while Armageddon Man is being deployed");
  assert.equal(influenceOf(g.engine, P2), START);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("theirOdd")), "discard");
  assert.equal(influenceOf(g.engine, P2), START - 2);
});

clause(ARMAGEDDON, "1:rule", "'if you picked': put into play by an effect (no extra cost was paid) it does nothing to the non-staple resources", () => {
  const cheat = tactic({
    name: "Cheat",
    cost: 0,
    behavior: { abilities: [{ id: "pip", type: "activated", targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const g = armBoard({ am: "discard", extra: [{ key: "cheat", def: cheat, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("cheat"), { selected: { t: [g.id("am")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("am")), "play", "control: it entered play");
  assert.equal(zoneOf(g.engine, g.id("theirOdd")), "play");
  assert.equal(zoneOf(g.engine, g.id("myOdd")), "play");
  assert.equal(influenceOf(g.engine, P2), START);
  assert.equal(influenceOf(g.engine, P1), START);
});

clause(ARMAGEDDON, "1:rule", "a face-down resource is not a staple resource: it can be picked (CR 411.1: no staple label)", () => {
  const g = armBoard({ extra: [{ key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }] });
  armPlay(g, "fd");
  assert.equal(zoneOf(g.engine, g.id("fd")), "discard", "the face-down card was destroyed");
  assert.equal(influenceOf(g.engine, P2), START - 2);
});

// =============================================================================
// Arya, Princess of Mauville — character, banker, mau, cost 2, [G][G][G], 1 str / 3 spd / 1 life
// UNIQUE ARYA
// When this card enters play, if it was deployed from your hand, draw 3 cards. If you do, put 2 cards from your hand on the
// bottom of your deck in any order.
// =============================================================================

const ARYA = "2a1b14c8-813c-4828-8898-20f8ab6fd836";

function aryaBoard(o: { deck?: number; extra?: CardPlacement[]; arya?: Zone; greed?: number } = {}) {
  return devBoard([
    { key: "ar", def: printing(ARYA), owner: P1, zone: o.arya ?? "hand" },
    { key: "h1", def: character({ name: "Held One" }), owner: P1, zone: "hand" },
    ...fillers("d", o.deck ?? 6, P1, "deck"),
    ...fillers("e", 3, P2, "deck"),
    ...res({ greed: o.greed ?? 3 }),
    ...(o.extra ?? [])
  ]);
}
type AryaBoard = ReturnType<typeof aryaBoard>;
const aryaPlay = (g: AryaBoard) => play(g.engine, P1, g.id("ar"));
/** Answers every prompt; the "put 2 cards on the bottom" pick takes the first two cards in hand. */
const aryaAnswer = (g: AryaBoard) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: handOf(g.engine, pc.playerId as PlayerId).slice(0, 2) } : pc.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: (pc.candidates as string[])[0] } : declineAll(pc);
/** Answers the "put 2 cards on the bottom" pick with `ids`. */
const bottomPick = (ids: CardInstanceId[]) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc);

clause(ARYA, "0:unique", "printed card: banker mau, 1 str / 3 spd / 1 life, deploys for exactly 2 with [G][G][G]", () => {
  const p = printing(ARYA);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "banker");
  assert.deepEqual(p.subtype, ["mau"]);
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "ggg");
  const g = aryaBoard({ greed: 3 });
  assert.equal(spentBy(g.engine, P1, () => { aryaPlay(g); drain(g.engine, aryaAnswer(g)); }), 2);
  assert.equal(zoneOf(g.engine, g.id("ar")), "play");
  assert.deepEqual([g.engine.getStat(g.id("ar"), "strength"), g.engine.getStat(g.id("ar"), "speed"), g.engine.getStat(g.id("ar"), "life")], [1, 3, 1]);
  const twoG = aryaBoard({ greed: 2, extra: res({ rage: 3 }) });
  refused(() => playRaw(twoG.engine, P1, twoG.id("ar")), "two [G] is short of [G][G][G]", /threshold/i);
});

clause(ARYA, "0:unique", "controlling a second Arya makes you keep one (the controller chooses); the opponent may have their own; another designation is no duplicate", () => {
  const g = aryaBoard({ extra: [{ key: "ar2", def: printing(ARYA), owner: P1, zone: "play" }] });
  aryaPlay(g);
  drain(g.engine, (p) => (p.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: g.id("ar2") } : aryaAnswer(g)(p)));
  assert.equal(zoneOf(g.engine, g.id("ar2")), "play", "the chosen survivor stays");
  assert.equal(zoneOf(g.engine, g.id("ar")), "discard", "the other is destroyed");
  const theirs = aryaBoard({ extra: [{ key: "far", def: printing(ARYA), owner: P2, zone: "play" }] });
  aryaPlay(theirs);
  drain(theirs.engine, aryaAnswer(theirs));
  assert.equal(zoneOf(theirs.engine, theirs.id("far")), "play");
  assert.equal(zoneOf(theirs.engine, theirs.id("ar")), "play", "no duplicate: the other Arya is the opponent's");
  const uniq = aryaBoard({ extra: [{ key: "ou", def: character({ name: "Other Unique", unique: "other unique" } as Partial<CardDefinition>), owner: P1, zone: "play" }] });
  aryaPlay(uniq);
  drain(uniq.engine, aryaAnswer(uniq));
  assert.equal(zoneOf(uniq.engine, uniq.id("ar")), "play");
  assert.equal(zoneOf(uniq.engine, uniq.id("ou")), "play");
});

clause(ARYA, "1:rule", "deployed from my hand: draws 3 cards (the top three), then I put 2 cards from my hand on the bottom of my deck", () => {
  const g = aryaBoard();
  const deckBefore = deckOf(g.engine, P1);
  const top3 = deckBefore.slice(0, 3);
  aryaPlay(g);
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; declaration: { count: number } };
  assert.equal(pc?.kind, "chooserSelectsTarget", "asks me to pick cards from my hand");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.declaration.count, 2, "exactly 2 cards");
  assert.equal(handOf(g.engine, P1).length, 4, "1 held card + 3 drawn (Arya left the hand)");
  for (const id of top3) assert.equal(zoneOf(g.engine, id), "hand", "the three top cards were drawn");
  const picks = [g.id("h1"), top3[0]];
  drain(g.engine, bottomPick(picks));
  assert.equal(handOf(g.engine, P1).length, 2);
  const deck = deckOf(g.engine, P1);
  assert.equal(deck.length, deckBefore.length - 3 + 2);
  assert.deepEqual(deck.slice(-2), picks, "the two picked cards are on the bottom of my deck");
});

clause(ARYA, "1:rule", "'in any order': either order of the two cards can be put on the bottom", () => {
  const a = aryaBoard();
  const top3 = deckOf(a.engine, P1).slice(0, 3);
  aryaPlay(a);
  drain(a.engine, bottomPick([top3[1], top3[2]]));
  assert.deepEqual(deckOf(a.engine, P1).slice(-2), [top3[1], top3[2]]);
  const b = aryaBoard();
  const top3b = deckOf(b.engine, P1).slice(0, 3);
  aryaPlay(b);
  drain(b.engine, bottomPick([top3b[2], top3b[1]]));
  assert.deepEqual(deckOf(b.engine, P1).slice(-2), [top3b[2], top3b[1]], "the opposite order is possible too");
});

clause(ARYA, "1:rule", "the two cards must be cards from my hand: exactly 2, not 1, not 3, not the opponent's, and not Arya herself", () => {
  const g = aryaBoard({ extra: [{ key: "oh", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }] });
  const top3 = deckOf(g.engine, P1).slice(0, 3);
  aryaPlay(g);
  const resolve = (ids: CardInstanceId[]) => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  refused(() => resolve([top3[0]]), "one card is not two");
  refused(() => resolve([g.id("h1"), top3[0], top3[1]]), "three cards is not two");
  refused(() => resolve([g.id("h1"), g.id("oh")]), "an opponent's hand card");
  refused(() => resolve([g.id("h1"), g.id("ar")]), "Arya is no longer in the hand");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the prompt is still open after the refusals");
  resolve([g.id("h1"), top3[0]]);
  assert.equal(pending(g.engine), undefined);
});

clause(ARYA, "1:rule", "'if you do': with only 2 cards left to draw (a short deck) I do not draw 3, so no cards go to the bottom", () => {
  const g = aryaBoard({ deck: 2 });
  aryaPlay(g);
  drain(g.engine, declineAll);
  assert.equal(handOf(g.engine, P1).length, 3, "held card + the 2 cards that could be drawn");
  assert.equal(deckOf(g.engine, P1).length, 0, "nothing went to the bottom of my deck");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ARYA, "1:rule", "with exactly 3 cards left in the deck the draw works and the two bottomed cards are all that is left in the deck", () => {
  const g = aryaBoard({ deck: 3 });
  const top3 = deckOf(g.engine, P1);
  aryaPlay(g);
  drain(g.engine, bottomPick([top3[0], top3[1]]));
  assert.deepEqual(deckOf(g.engine, P1), [top3[0], top3[1]]);
  assert.equal(handOf(g.engine, P1).length, 2);
});

clause(ARYA, "1:rule", "'deployed from your hand': put into play from the discard pile by an effect, she draws nothing", () => {
  const cheat = tactic({
    name: "Cheat",
    cost: 0,
    behavior: { abilities: [{ id: "pip", type: "activated", targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const g = aryaBoard({ arya: "discard", extra: [{ key: "cheat", def: cheat, owner: P1, zone: "hand" }] });
  const hand = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("cheat"), { selected: { t: [g.id("ar")] } });
  assert.equal(pending(g.engine), undefined, "no draw / bottom prompt");
  assert.equal(zoneOf(g.engine, g.id("ar")), "play");
  assert.equal(handOf(g.engine, P1).length, hand - 1, "only the Cheat tactic left my hand: nothing drawn");
  assert.equal(deckOf(g.engine, P1).length, 6);
});

clause(ARYA, "1:rule", "'deployed from your hand': put into play from the deck by an effect, she draws nothing", () => {
  const cheat = tactic({
    name: "Cheat Deck",
    cost: 0,
    behavior: { abilities: [{ id: "pip", type: "activated", targets: [{ id: "t", selector: { zone: "deck", type: "character", name: "Arya, Princess of Mauville" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const g = aryaBoard({ arya: "deck", extra: [{ key: "cheat", def: cheat, owner: P1, zone: "hand" }] });
  const hand = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("cheat"), { selected: { t: [g.id("ar")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("ar")), "play");
  assert.equal(handOf(g.engine, P1).length, hand - 1);
});

clause(ARYA, "1:rule", "an opponent's Arya draws for its controller only (the controller picks the cards to bottom)", () => {
  const g = devBoard(
    [
      { key: "ar", def: printing(ARYA), owner: P2, zone: "hand" },
      ...fillers("d", 5, P2, "deck"),
      ...fillers("e", 5, P1, "deck"),
      ...res({ greed: 3 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(g.engine, P2, g.id("ar"));
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the controller picks");
  assert.equal(handOf(g.engine, P1).length, 0, "I drew nothing");
});

// =============================================================================
// Black Market Broker — character, rogue, outlaw, cost 2, [D], 2 str / 4 spd / 1 life
// Each resource you control that doesn't have "PROVIDES: [D]", gains "PROVIDES: [D]".
// =============================================================================

const BROKER = "983463ac-8bd9-4e79-8562-0a45e615748f";

function brokerBoard(o: { extra?: CardPlacement[]; broker?: Zone; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "bk", def: printing(BROKER), owner: P1, zone: o.broker ?? "play" },
      ...res({ rage: 2, greed: 1 }),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type BkBoard = ReturnType<typeof brokerBoard>;
const thr = (g: BkBoard, name: IconName, player: PlayerId = P1) => ((g.engine.getThresholds(player) as Record<string, number>)[name] ?? 0);

clause(BROKER, "0:rule", "printed card: rogue outlaw, 2 str / 4 spd / 1 life, deploys for exactly 2 with [D]", () => {
  const p = printing(BROKER);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "rogue");
  assert.deepEqual(p.subtype, ["outlaw"]);
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "d");
  const g = devBoard([{ key: "bk", def: printing(BROKER), owner: P1, zone: "hand" }, ...res({ deception: 2 })]);
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("bk"))), 2);
  assert.deepEqual([g.engine.getStat(g.id("bk"), "strength"), g.engine.getStat(g.id("bk"), "speed"), g.engine.getStat(g.id("bk"), "life")], [2, 4, 1]);
  const noD = devBoard([{ key: "bk", def: printing(BROKER), owner: P1, zone: "hand" }, ...res({ rage: 4 })]);
  refused(() => playRaw(noD.engine, P1, noD.id("bk")), "no [D] icon", /threshold/i);
  const poor = devBoard([{ key: "bk", def: printing(BROKER), owner: P1, zone: "hand" }, ...res({ deception: 1 })]);
  refused(() => playRaw(poor.engine, P1, poor.id("bk")), "one resource for cost 2");
});

clause(BROKER, "0:rule", "every resource I control that lacks [D] gains a [D] icon: 2 Rage + 1 Greed give 3 Deception", () => {
  const g = brokerBoard();
  assert.equal(thr(g, "deception"), 3);
  assert.equal(thr(g, "rage"), 2, "they keep their own icons");
  assert.equal(thr(g, "greed"), 1);
  const without = brokerBoard({ broker: "hand" });
  assert.equal(thr(without, "deception"), 0, "control: with the Broker in hand there is no [D]");
});

clause(BROKER, "0:rule", "a resource that already provides [D] gains nothing extra (still exactly one [D])", () => {
  const g = brokerBoard({ extra: res({ deception: 2 }) });
  assert.equal(thr(g, "deception"), 5, "2 Deception resources keep 1 each; the other 3 resources gain one each");
});

clause(BROKER, "0:rule", "face-down resources (Volition) are resources I control: each gains [D] and keeps Volition", () => {
  const g = brokerBoard({ extra: volition(2, P1) });
  assert.equal(thr(g, "deception"), 5);
  assert.equal(thr(g, "volition"), 2);
});

clause(BROKER, "0:rule", "the granted [D] meets a [D][D] threshold: a card the player could not deploy before is deployable", () => {
  const needsDD = character({ name: "NeedsDD", cost: 0, threshold: "dd" as never });
  const noBroker = brokerBoard({ broker: "hand", extra: [{ key: "need", def: needsDD, owner: P1, zone: "hand" }] });
  refused(() => playRaw(noBroker.engine, P1, noBroker.id("need")), "no [D] icons", /threshold/i);
  const g = brokerBoard({ extra: [{ key: "need", def: needsDD, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("need"));
  assert.equal(zoneOf(g.engine, g.id("need")), "play");
});

clause(BROKER, "0:rule", "spent (attached) resources are still resources I control and gain [D] too", () => {
  const spent = bank("rage", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = brokerBoard({ extra: spent });
  assert.equal(thr(g, "deception"), 5, "2 ready Rage + 1 Greed + 2 spent Rage");
});

clause(BROKER, "0:rule", "only resources I control: my opponent's resources do not gain [D], and a resource I stole does", () => {
  const g = brokerBoard({
    extra: [
      ...res({ rage: 2 }, P2),
      { key: "stolenRes", def: resourceCard({ name: "Stolen Rage" }), owner: P2, controller: P1, zone: "play" }
    ]
  });
  assert.equal(thr(g, "deception", P2), 0, "the opponent's resources gain nothing");
  assert.equal(thr(g, "deception"), 4, "3 original + the stolen resource");
});

clause(BROKER, "0:rule", "non-resource cards I control gain nothing: only resources count", () => {
  const g = brokerBoard({ extra: [{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }, { key: "idol", def: item({ name: "Idol" }), owner: P1, zone: "play" }] });
  assert.equal(thr(g, "deception"), 3);
});

clause(BROKER, "0:rule", "it applies to resources that enter play later (a resource developed after the Broker)", () => {
  const g = brokerBoard({ extra: [{ key: "hr", def: resourceCard({ name: "Late Rage" }), owner: P1, zone: "hand" }] });
  assert.equal(thr(g, "deception"), 3);
  developResource(g.engine, P1, g.id("hr"), false);
  assert.equal(thr(g, "deception"), 4, "the new resource gained [D] too");
});

clause(BROKER, "0:rule", "it stops when the Broker leaves play: destroyed, the [D] icons are gone", () => {
  const g = brokerBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(thr(g, "deception"), 3);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("bk")] } });
  assert.equal(zoneOf(g.engine, g.id("bk")), "discard");
  assert.equal(thr(g, "deception"), 0);
  assert.equal(thr(g, "rage"), 2);
});

clause(BROKER, "0:rule", "it works only while the Broker is face-up in play: flipped face-down it is just a resource", () => {
  const flip = tactic({
    name: "Flipper",
    cost: 0,
    behavior: { abilities: [{ id: "f", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
  });
  const g = brokerBoard({ extra: [{ key: "flip", def: flip, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("flip"), { selected: { t: [g.id("bk")] } });
  assert.equal(cardOf(g.engine, g.id("bk")).faceDown, true);
  assert.equal(thr(g, "deception"), 0, "a face-down Broker has no rules text");
});

clause(BROKER, "0:rule", "an opponent's Broker affects only its controller's resources", () => {
  const g = brokerBoard({ broker: "hand", extra: [{ key: "fbk", def: printing(BROKER), owner: P2, zone: "play" }, ...res({ rage: 2 }, P2)] });
  assert.equal(thr(g, "deception", P2), 2);
  assert.equal(thr(g, "deception", P1), 0, "my resources are not theirs");
});

// =============================================================================
// Shared helpers for the Elitism-search cards (Brain Dump, Contriving Engineer)
// =============================================================================

/** A small seeded LCG: a deterministic random source for `buildGame({ random })`. */
function seeded(seed = 12345): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** The staple resource card named "Elitism". */
const elitismCard = (): CardDefinition => resourceCard({ name: "Elitism", resource: { provides: ["elitism"], staple: true } });

const pickIds = (engine: SpoilsEngine, ids: CardInstanceId[], player: PlayerId = P1) =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);

const deckNames = (engine: SpoilsEngine, player: PlayerId): string[] => deckOf(engine, player).map((c) => engine.getDefinition(c).name);
const revealsOf = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
const factionIdOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].factionId;

// =============================================================================
// Brain Dump — tactic, gearsmith, cost 5, [E][E]
// Search your deck for 2 cards named "Elitism" and reveal them. If you do, put them into play attached to your faction.
// =============================================================================

const BRAINDUMP = "22c41d24-a765-4444-a19f-54c6f789aa75";

function dumpBoard(o: { elitism?: number; random?: () => number; icons?: Icons; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: o.random ?? seeded(),
    cards: [
      { key: "bd", def: printing(BRAINDUMP), owner: P1, zone: "hand" },
      ...fillers("d", 6, P1, "deck"),
      ...Array.from({ length: o.elitism ?? 3 }, (_, i) => ({ key: `el${i}`, def: elitismCard(), owner: P1, zone: "deck" as const })),
      { key: "crest", def: item({ name: "Crest of Elitism" }), owner: P1, zone: "deck" },
      { key: "essence", def: item({ name: "Essence of Elitism" }), owner: P1, zone: "deck" },
      { key: "elHand", def: elitismCard(), owner: P1, zone: "hand" },
      { key: "elDisc", def: elitismCard(), owner: P1, zone: "discard" },
      { key: "foeEl", def: elitismCard(), owner: P2, zone: "deck" },
      ...fillers("f", 3, P2, "deck"),
      ...res(o.icons ?? { elitism: 7 }),
      ...(o.extra ?? [])
    ]
  });
}
type DumpBoard = ReturnType<typeof dumpBoard>;
const dumpCast = (g: DumpBoard) => play(g.engine, P1, g.id("bd"));

clause(BRAINDUMP, "0:rule", "printed card: gearsmith tactic, cost 5, threshold [E][E]; pays exactly 5 and ends in the discard pile", () => {
  const p = printing(BRAINDUMP);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "gearsmith");
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "ee");
  const g = dumpBoard({ icons: { elitism: 7 } });
  assert.equal(spentBy(g.engine, P1, () => playRaw(g.engine, P1, g.id("bd"))), 5);
  resolvePendingResponses(g.engine);
  pickIds(g.engine, []);
  assert.equal(zoneOf(g.engine, g.id("bd")), "discard");
  const short = dumpBoard({ icons: { elitism: 4 } });
  refused(() => playRaw(short.engine, P1, short.id("bd")), "4 resources for cost 5");
  const oneE = dumpBoard({ icons: { elitism: 1, rage: 6 } });
  refused(() => playRaw(oneE.engine, P1, oneE.id("bd")), "one [E] is short of [E][E]", /threshold/i);
  const twoE = dumpBoard({ icons: { elitism: 2, rage: 3 } });
  playRaw(twoE.engine, P1, twoE.id("bd"));
  assert.equal(zoneOf(twoE.engine, twoE.id("bd")), "deploying", "two [E] and five resources is enough");
});

clause(BRAINDUMP, "0:rule", "finds 2 Elitism: the controller is asked which, both enter play attached to my faction as face-up resources, the third stays in the deck", () => {
  const g = dumpBoard();
  playRaw(g.engine, P1, g.id("bd"));
  assert.equal(zoneOf(g.engine, g.id("el0")), "deck", "nothing is searched while the tactic is only being deployed");
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; declaration: { count: number } };
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.declaration.count, 2);
  pickIds(g.engine, [g.id("el0"), g.id("el2")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["el0", "el2"]) {
    assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} is in play`);
    assert.equal(cardOf(g.engine, g.id(key)).attachedTo, factionIdOf(g.engine, P1), `${key} is attached to my faction`);
    assert.equal(cardOf(g.engine, g.id(key)).controllerId, P1);
    assert.equal(cardOf(g.engine, g.id(key)).faceDown, false);
  }
  assert.equal(zoneOf(g.engine, g.id("el1")), "deck", "only two are fetched");
});

clause(BRAINDUMP, "0:rule", "the found cards are revealed", () => {
  const g = dumpBoard();
  dumpCast(g);
  pickIds(g.engine, [g.id("el0"), g.id("el1")]);
  const reveals = revealsOf(g.engine);
  assert.equal(reveals.length, 1, "revealed once");
  assert.deepEqual([...(reveals[0].event as unknown as { cardIds: string[] }).cardIds].sort(), [g.id("el0"), g.id("el1")].sort());
});

clause(BRAINDUMP, "0:rule", "the Elitism arrive as resources: two more [E] icons, but being attached they are already spent (no extra resource to pay with)", () => {
  const g = dumpBoard();
  dumpCast(g);
  const readyBefore = ready(g.engine);
  const iconsBefore = (g.engine.getThresholds(P1) as Record<string, number>).elitism ?? 0;
  pickIds(g.engine, [g.id("el0"), g.id("el1")]);
  assert.equal((g.engine.getThresholds(P1) as Record<string, number>).elitism, iconsBefore + 2);
  assert.equal(ready(g.engine), readyBefore, "they are attached, so they can't pay for anything this turn");
});

clause(BRAINDUMP, "0:rule", "only cards NAMED \"Elitism\": Crest of Elitism, Essence of Elitism and ordinary deck cards are refused", () => {
  const g = dumpBoard();
  dumpCast(g);
  refused(() => pickIds(g.engine, [g.id("crest"), g.id("el0")]), "Crest of Elitism");
  refused(() => pickIds(g.engine, [g.id("essence"), g.id("el0")]), "Essence of Elitism");
  refused(() => pickIds(g.engine, [g.id("d0")]), "an ordinary deck card");
  assert.ok(pending(g.engine), "the prompt is still open");
  pickIds(g.engine, [g.id("el0"), g.id("el1")]);
  assert.equal(zoneOf(g.engine, g.id("el0")), "play", "control: Elitism cards are accepted");
});

clause(BRAINDUMP, "0:rule", "it searches MY deck: an Elitism in my hand or discard pile, or in the opponent's deck, cannot be fetched", () => {
  const g = dumpBoard();
  dumpCast(g);
  refused(() => pickIds(g.engine, [g.id("elHand")]), "in my hand");
  refused(() => pickIds(g.engine, [g.id("elDisc")]), "in my discard pile");
  refused(() => pickIds(g.engine, [g.id("foeEl")]), "in the opponent's deck");
  assert.equal(zoneOf(g.engine, g.id("foeEl")), "deck");
  pickIds(g.engine, [g.id("el0")]);
  assert.equal(zoneOf(g.engine, g.id("el0")), "play");
});

clause(BRAINDUMP, "0:rule", "'2 cards': at most 2 can be found, three are refused", () => {
  const g = dumpBoard({ elitism: 4 });
  dumpCast(g);
  refused(() => pickIds(g.engine, [g.id("el0"), g.id("el1"), g.id("el2")]), "three cards");
  assert.ok(pending(g.engine), "the prompt is still open");
  pickIds(g.engine, [g.id("el0"), g.id("el1")]);
  assert.equal(zoneOf(g.engine, g.id("el2")), "deck");
  assert.equal(zoneOf(g.engine, g.id("el3")), "deck");
});

clause(BRAINDUMP, "0:rule", "CR 312.2: a search with criteria may fail: finding none puts nothing into play", () => {
  const g = dumpBoard();
  dumpCast(g);
  pickIds(g.engine, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["el0", "el1", "el2"]) assert.equal(zoneOf(g.engine, g.id(key)), "deck", `${key} stays in the deck`);
  assert.equal(revealsOf(g.engine).length, 0, "nothing was revealed");
  assert.equal(zoneOf(g.engine, g.id("bd")), "discard");
});

clause(BRAINDUMP, "0:rule", "reading: with only one Elitism in the deck, the one that can be found is put into play (the other copy cannot be found)", () => {
  const g = dumpBoard({ elitism: 1 });
  dumpCast(g);
  pickIds(g.engine, [g.id("el0")]);
  assert.equal(zoneOf(g.engine, g.id("el0")), "play");
  assert.equal(cardOf(g.engine, g.id("el0")).attachedTo, factionIdOf(g.engine, P1));
});

clause(BRAINDUMP, "0:rule", "with no Elitism in the deck nothing can be found and the game is not left waiting", () => {
  const g = dumpBoard({ elitism: 0 });
  dumpCast(g);
  if (pending(g.engine)) pickIds(g.engine, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.responseWindow, undefined);
  assert.equal(zoneOf(g.engine, g.id("bd")), "discard");
});

clause(BRAINDUMP, "0:rule", "CR 312.1: the deck is shuffled afterwards (found or not)", () => {
  const found = [dumpBoard({ random: () => 0 }), dumpBoard({ random: () => 0.9999999 })];
  for (const g of found) {
    dumpCast(g);
    pickIds(g.engine, [g.id("el0"), g.id("el1")]);
  }
  assert.deepEqual([...deckNames(found[0].engine, P1)].sort(), [...deckNames(found[1].engine, P1)].sort(), "same cards");
  assert.notDeepEqual(deckNames(found[0].engine, P1), deckNames(found[1].engine, P1), "but the order follows the random source: shuffled");
  const none = [dumpBoard({ random: () => 0 }), dumpBoard({ random: () => 0.9999999 })];
  for (const g of none) {
    dumpCast(g);
    pickIds(g.engine, []);
  }
  assert.notDeepEqual(deckNames(none[0].engine, P1), deckNames(none[1].engine, P1), "shuffled even when nothing was found");
  const empty = [dumpBoard({ random: () => 0, elitism: 0 }), dumpBoard({ random: () => 0.9999999, elitism: 0 })];
  for (const g of empty) {
    dumpCast(g);
    if (pending(g.engine)) pickIds(g.engine, []);
  }
  assert.notDeepEqual(deckNames(empty[0].engine, P1), deckNames(empty[1].engine, P1), "shuffled even when there is no Elitism at all");
});

clause(BRAINDUMP, "0:rule", "the opponent's deck is untouched", () => {
  const g = dumpBoard();
  const before = [...deckOf(g.engine, P2)];
  dumpCast(g);
  pickIds(g.engine, [g.id("el0"), g.id("el1")]);
  assert.deepEqual(deckOf(g.engine, P2), before);
});

clause(BRAINDUMP, "0:rule", "the attached Elitism detach like any spent resource at my next restore and are then available resources", () => {
  const g = dumpBoard();
  dumpCast(g);
  pickIds(g.engine, [g.id("el0"), g.id("el1")]);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(cardOf(g.engine, g.id("el0")).attachedTo, undefined);
  assert.ok(g.engine.getAvailableResourceIds(P1).includes(g.id("el0")), "g.engine.getAvailableResourceIds(P1).includes(el0)");
});

// =============================================================================
// Brainbath — tactic, arcanist, cost 1, [O][O]
// Draw 2 cards. Put a card from your hand on the bottom of your deck.
// RECUR: [O][O] -- COST: Use this only if this card is in your discard pile. Pay 4. Void this card.
//   EFFECT: All opponents discard a card. Draw a card.
// =============================================================================

const BRAINBATH = "3bd6878a-1a14-402f-93eb-a23afac654b0";

function bathBoard(o: { icons?: Icons; deck?: number; hand?: number; bb?: Zone; oppHand?: number; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "bb", def: printing(BRAINBATH), owner: P1, zone: o.bb ?? "hand" },
      ...fillers("d", o.deck ?? 5, P1, "deck"),
      ...fillers("h", o.hand ?? 2, P1, "hand"),
      ...fillers("oh", o.oppHand ?? 3, P2, "hand"),
      ...fillers("od", 3, P2, "deck"),
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      { key: "disc", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...res(o.icons ?? { obsession: 8 })
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type BathBoard = ReturnType<typeof bathBoard>;
const bathRecur = (g: BathBoard, player: PlayerId = P1) => actRaw(g.engine, player, g.id("bb"), "recur");
const drainPicking = (engine: SpoilsEngine, picks: CardInstanceId[]) =>
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: picks } : declineAll(pc)));

clause(BRAINBATH, "0:rule", "printed card: arcanist tactic, cost 1 (exactly 1 paid), [O][O]; draws the top 2 cards then puts a hand card on the bottom", () => {
  const p = printing(BRAINBATH);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "arcanist");
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "oo");
  const g = bathBoard();
  const deckBefore = [...deckOf(g.engine, P1)];
  const before = ready(g.engine);
  play(g.engine, P1, g.id("bb"));
  assert.equal(before - ready(g.engine), 1, "the printed cost of 1 is paid");
  for (const c of deckBefore.slice(0, 2)) assert.equal(zoneOf(g.engine, c), "hand", "the top two cards were drawn");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the controller chooses");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("h0")), "deck");
  assert.equal(deckOf(g.engine, P1)[deckOf(g.engine, P1).length - 1], g.id("h0"), "it is the bottom card of the deck");
  assert.deepEqual(deckOf(g.engine, P1).slice(0, 3), deckBefore.slice(2), "the rest of the deck keeps its order");
  assert.equal(handOf(g.engine, P1).length, 2 + 2 - 1);
  assert.equal(zoneOf(g.engine, g.id("bb")), "discard");
});

clause(BRAINBATH, "0:rule", "needs [O][O]: one [O] among many other resources is refused, two are accepted; no resources at all is refused", () => {
  const one = bathBoard({ icons: { obsession: 1, greed: 6 } });
  refused(() => playRaw(one.engine, P1, one.id("bb")), "only one [O]", /threshold/i);
  const none = bathBoard({ icons: {} });
  refused(() => playRaw(none.engine, P1, none.id("bb")), "no resources");
  const two = bathBoard({ icons: { obsession: 2, greed: 4 } });
  play(two.engine, P1, two.id("bb"));
  drainPicking(two.engine, [two.id("h0")]);
  assert.equal(zoneOf(two.engine, two.id("bb")), "discard");
  const exact = bathBoard({ icons: { obsession: 2 } });
  play(exact.engine, P1, exact.id("bb"));
  drainPicking(exact.engine, [exact.id("h0")]);
  assert.equal(ready(exact.engine), 1, "one of two resources was spent");
});

clause(BRAINBATH, "0:rule", "the card put on the bottom can be one of the two just drawn, or a card that was already in hand", () => {
  const a = bathBoard();
  const drawnTop = deckOf(a.engine, P1)[0];
  play(a.engine, P1, a.id("bb"));
  answerPending(a.engine, "chooserSelectsTarget", { selected: [drawnTop] });
  assert.equal(deckOf(a.engine, P1)[deckOf(a.engine, P1).length - 1], drawnTop);
  assert.equal(zoneOf(a.engine, a.id("h0")), "hand");
  const b = bathBoard();
  play(b.engine, P1, b.id("bb"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("h1")] });
  assert.equal(deckOf(b.engine, P1)[deckOf(b.engine, P1).length - 1], b.id("h1"));
});

clause(BRAINBATH, "0:rule", "exactly one card goes to the bottom: none or two are refused; it must come from MY hand", () => {
  const g = bathBoard();
  play(g.engine, P1, g.id("bb"));
  refused(() => pickIds(g.engine, []), "putting nothing back");
  refused(() => pickIds(g.engine, [g.id("h0"), g.id("h1")]), "putting two back");
  refused(() => pickIds(g.engine, [g.id("oh0")]), "the opponent's hand");
  refused(() => pickIds(g.engine, [g.id("inPlay")]), "a card in play");
  refused(() => pickIds(g.engine, [g.id("disc")]), "a card in the discard pile");
  refused(() => pickIds(g.engine, [g.id("od0")]), "the opponent's deck");
  assert.ok(pending(g.engine), "the choice is still open");
  pickIds(g.engine, [g.id("h0")]);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("h0")), "deck");
  assert.equal(zoneOf(g.engine, g.id("oh0")), "hand", "the opponent's hand was not touched");
});

clause(BRAINBATH, "0:rule", "the draw is exactly 2 with a large deck; the opponent's deck and hand are untouched", () => {
  const g = bathBoard({ deck: 9 });
  const oppDeck = [...deckOf(g.engine, P2)];
  const oppHand = [...handOf(g.engine, P2)];
  play(g.engine, P1, g.id("bb"));
  assert.equal(deckOf(g.engine, P1).length, 9 - 2);
  drainPicking(g.engine, [g.id("h0")]);
  assert.equal(deckOf(g.engine, P1).length, 9 - 2 + 1);
  assert.deepEqual(deckOf(g.engine, P2), oppDeck);
  assert.deepEqual(handOf(g.engine, P2), oppHand);
});

clause(BRAINBATH, "0:rule", "short decks: with 1 card it draws that card and still puts one back; with none it draws nothing, no loss, and still puts one back", () => {
  const one = bathBoard({ deck: 1 });
  play(one.engine, P1, one.id("bb"));
  assert.equal(zoneOf(one.engine, one.id("d0")), "hand");
  answerPending(one.engine, "chooserSelectsTarget", { selected: [one.id("h0")] });
  assert.deepEqual(deckOf(one.engine, P1), [one.id("h0")]);
  const none = bathBoard({ deck: 0 });
  play(none.engine, P1, none.id("bb"));
  assert.equal(none.engine.state.winner, undefined, "no loss for an empty deck");
  drainPicking(none.engine, [none.id("h0")]);
  assert.deepEqual(deckOf(none.engine, P1), [none.id("h0")]);
  const bare = bathBoard({ deck: 0, hand: 0 });
  play(bare.engine, P1, bare.id("bb"));
  resolvePendingResponses(bare.engine);
  assert.equal(bare.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(bare.engine, bare.id("bb")), "discard");
});

clause(BRAINBATH, "1:ability:recur", "from the discard pile: Pay 4 exactly, void Brainbath, the opponent discards a card of their choice and I draw a card", () => {
  const g = bathBoard({ bb: "discard" });
  const before = ready(g.engine);
  const deckBefore = [...deckOf(g.engine, P1)];
  const handBefore = handOf(g.engine, P1).length;
  const oppHandBefore = handOf(g.engine, P2).length;
  bathRecur(g);
  assert.equal(before - ready(g.engine), 4, "Pay 4");
  assert.equal(zoneOf(g.engine, g.id("bb")), "void", "Void this card");
  assert.ok(voidOf(g.engine, P1).includes(g.id("bb")), "voidOf(g.engine, P1).includes(bb)");
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the opponent picks their own discard");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh1")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("oh1")), "discard");
  assert.equal(handOf(g.engine, P2).length, oppHandBefore - 1, "exactly one card");
  assert.equal(handOf(g.engine, P1).length, handBefore + 1, "I drew exactly one card");
  assert.equal(zoneOf(g.engine, deckBefore[0]), "hand", "the top card of my deck");
});

clause(BRAINBATH, "1:ability:recur", "the cost (Pay 4, void) is paid when RECUR is used, before the opponent can respond", () => {
  const g = bathBoard({ bb: "discard" });
  const before = ready(g.engine);
  bathRecur(g);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(before - ready(g.engine), 4);
  assert.equal(zoneOf(g.engine, g.id("bb")), "void");
  assert.equal(zoneOf(g.engine, g.id("oh0")), "hand", "the discard has not happened yet");
});

clause(BRAINBATH, "1:ability:recur", "the card discarded must come from the opponent's hand, exactly one, chosen by them; I cannot answer for them", () => {
  const g = bathBoard({ bb: "discard" });
  bathRecur(g);
  resolvePendingResponses(g.engine);
  refused(() => pickIds(g.engine, [g.id("oh0")], P1), "I cannot answer the opponent's choice");
  refused(() => pickIds(g.engine, [g.id("h0")], P2), "a card in MY hand");
  refused(() => pickIds(g.engine, [g.id("inPlay")], P2), "a card in play");
  refused(() => pickIds(g.engine, [], P2), "they must discard a card");
  refused(() => pickIds(g.engine, [g.id("oh0"), g.id("oh1")], P2), "only one card");
  pickIds(g.engine, [g.id("oh2")], P2);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("oh2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("oh0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("h0")), "hand");
});

clause(BRAINBATH, "1:ability:recur", "if the opponent has no cards in hand they discard nothing and I still draw; with an empty deck they still discard", () => {
  const noHand = bathBoard({ bb: "discard", oppHand: 0 });
  const top = deckOf(noHand.engine, P1)[0];
  bathRecur(noHand);
  resolvePendingResponses(noHand.engine);
  assert.equal(noHand.engine.state.pendingChoice, undefined, "no stuck prompt");
  assert.equal(zoneOf(noHand.engine, top), "hand", "the draw still happens");
  const noDeck = bathBoard({ bb: "discard", deck: 0 });
  bathRecur(noDeck);
  resolvePendingResponses(noDeck.engine);
  answerPending(noDeck.engine, "chooserSelectsTarget", { selected: [noDeck.id("oh0")] });
  assert.equal(zoneOf(noDeck.engine, noDeck.id("oh0")), "discard");
  assert.equal(noDeck.engine.state.winner, undefined);
});

clause(BRAINBATH, "1:ability:recur", "it draws exactly one and does not put a card back: my hand is otherwise left alone", () => {
  const g = bathBoard({ bb: "discard", deck: 6 });
  bathRecur(g);
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0")] });
  assert.equal(deckOf(g.engine, P1).length, 5, "one card drawn, none put back");
  assert.equal(handOf(g.engine, P1).length, 3, "two cards plus the one drawn");
});

clause(BRAINBATH, "1:ability:recur", "Use this only if this card is in your discard pile: refused from hand, deck, play and the Void; and never from the opponent's discard pile", () => {
  for (const zone of ["hand", "deck", "play", "void"] as const) {
    const g = bathBoard({ bb: zone });
    refused(() => bathRecur(g), `Brainbath in ${zone}`);
    assert.equal(ready(g.engine), 8, "nothing was paid");
  }
  const ok = bathBoard({ bb: "discard" });
  bathRecur(ok);
  assert.equal(zoneOf(ok.engine, ok.id("bb")), "void", "control: from the discard pile it works");
  const theirs = devBoard([
    { key: "bb", def: printing(BRAINBATH), owner: P2, zone: "discard" },
    ...fillers("oh", 2, P2, "hand"),
    ...fillers("d", 3, P1, "deck"),
    ...res({ obsession: 8 })
  ]);
  refused(() => actRaw(theirs.engine, P1, theirs.id("bb"), "recur"), "not my discard pile");
  assert.equal(zoneOf(theirs.engine, theirs.id("bb")), "discard");
  assert.equal(ready(theirs.engine), 8);
});

clause(BRAINBATH, "1:ability:recur", "Pay 4: refused with 3 resources, accepted with exactly 4; needs [O][O]", () => {
  const short = bathBoard({ bb: "discard", icons: { obsession: 3 } });
  refused(() => bathRecur(short), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("bb")), "discard");
  const exact = bathBoard({ bb: "discard", icons: { obsession: 4 } });
  bathRecur(exact);
  assert.equal(ready(exact.engine), 0);
  assert.equal(zoneOf(exact.engine, exact.id("bb")), "void");
  const oneO = bathBoard({ bb: "discard", icons: { obsession: 1, greed: 8 } });
  refused(() => bathRecur(oneO), "only one [O]", /threshold|requirement/i);
  const noO = bathBoard({ bb: "discard", icons: { greed: 8 } });
  refused(() => bathRecur(noO), "no [O]");
  const twoO = bathBoard({ bb: "discard", icons: { obsession: 2, greed: 2 } });
  bathRecur(twoO);
  assert.equal(zoneOf(twoO.engine, twoO.id("bb")), "void");
});

clause(BRAINBATH, "1:ability:recur", "it is an ability, not a tactic play: it works on the opponent's turn in response to their attack, once only", () => {
  const atk = devBoard([
    { key: "bb", def: printing(BRAINBATH), owner: P1, zone: "discard" },
    { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
    ...fillers("oh", 2, P2, "hand"),
    ...fillers("d", 3, P1, "deck"),
    ...res({ obsession: 8 })
  ], { turn: 2, activePlayerId: P2 });
  declareAttackOpenWindow(atk.engine, P2, [atk.id("atk")]);
  actRaw(atk.engine, P1, atk.id("bb"), "recur");
  resolvePendingResponses(atk.engine);
  answerPending(atk.engine, "chooserSelectsTarget", { selected: [atk.id("oh0")] });
  assert.equal(zoneOf(atk.engine, atk.id("bb")), "void");
  assert.equal(zoneOf(atk.engine, atk.id("oh0")), "discard");
  assert.equal(zoneOf(atk.engine, atk.id("d0")), "hand", "and I drew");
  refused(() => actRaw(atk.engine, P1, atk.id("bb"), "recur"), "the card left the discard pile");
});

// =============================================================================
// Contriving Engineer — character, gearsmith, inventor, cost 4, [E], 2 str / 3 spd / 1 life
// When this card enters play, you may search your deck for a card named "Elitism" and reveal it. If you do, put it into play.
// Attach it to your faction.
// =============================================================================

const ENGINEER = "58db4b48-ca86-4629-85f4-16c21b37c4bf";

function engBoard(o: { zone?: Zone; elitism?: number; random?: () => number; owner?: PlayerId; extra?: CardPlacement[]; elRes?: number; rage?: number } = {}) {
  const owner = o.owner ?? P1;
  const foe = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    random: o.random ?? seeded(),
    cards: [
      { key: "eng", def: printing(ENGINEER), owner, zone: o.zone ?? "hand" },
      { key: "ally", def: character({ name: "Ally", cost: 1 }), owner, zone: "hand" },
      ...fillers("d", 6, owner, "deck"),
      ...Array.from({ length: o.elitism ?? 2 }, (_, i) => ({ key: `el${i}`, def: elitismCard(), owner, zone: "deck" as const })),
      { key: "crest", def: item({ name: "Crest of Elitism" }), owner, zone: "deck" },
      { key: "elHand", def: elitismCard(), owner, zone: "hand" },
      { key: "elDisc", def: elitismCard(), owner, zone: "discard" },
      { key: "foeEl", def: elitismCard(), owner: foe, zone: "deck" },
      ...fillers("f", 3, foe, "deck"),
      ...res({ elitism: o.elRes ?? 1, rage: o.rage ?? 6 }, owner),
      ...(o.extra ?? [])
    ]
  });
}
type EngBoard = ReturnType<typeof engBoard>;

clause(ENGINEER, "0:rule", "printed card: gearsmith inventor, 2 / 3 / 1; pays 4 to deploy, searching only once it is in play", () => {
  const p = printing(ENGINEER);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "gearsmith");
  assert.deepEqual(p.subtype, ["inventor"]);
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "e");
  const g = engBoard();
  const before = ready(g.engine);
  playRaw(g.engine, P1, g.id("eng"));
  assert.equal(before - ready(g.engine), 4);
  assert.equal(zoneOf(g.engine, g.id("el0")), "deck", "nothing is searched while it is only being deployed");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("eng")), "play");
  assert.deepEqual([g.engine.getStat(g.id("eng"), "strength"), g.engine.getStat(g.id("eng"), "speed"), g.engine.getStat(g.id("eng"), "life")], [2, 3, 1]);
  const short = engBoard({ elRes: 1, rage: 2 });
  refused(() => playRaw(short.engine, P1, short.id("eng")), "3 resources for cost 4");
  const noE = engBoard({ elRes: 0, rage: 8 });
  refused(() => playRaw(noE.engine, P1, noE.id("eng")), "no [E]", /threshold/i);
});

clause(ENGINEER, "0:rule", "accepting the search: the chosen Elitism is revealed, enters play and is attached to my faction (face-up, mine)", () => {
  const g = engBoard();
  play(g.engine, P1, g.id("eng"));
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the controller is asked which Elitism");
  assert.equal(pc?.playerId, P1);
  pickIds(g.engine, [g.id("el1")]);
  assert.equal(zoneOf(g.engine, g.id("el1")), "play");
  assert.equal(cardOf(g.engine, g.id("el1")).attachedTo, factionIdOf(g.engine, P1));
  assert.equal(cardOf(g.engine, g.id("el1")).controllerId, P1);
  assert.equal(cardOf(g.engine, g.id("el1")).faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("el0")), "deck", "only the one chosen");
  const reveals = revealsOf(g.engine);
  assert.equal(reveals.length, 1, "revealed once");
  assert.deepEqual((reveals[0].event as unknown as { cardIds: string[] }).cardIds, [g.id("el1")], "the found card is revealed");
});

clause(ENGINEER, "0:rule", "the Elitism provides [E] but, attached, it is already spent (no extra resource to pay with)", () => {
  const g = engBoard({ elRes: 1 });
  play(g.engine, P1, g.id("eng"));
  const readyBefore = ready(g.engine);
  const iconsBefore = (g.engine.getThresholds(P1) as Record<string, number>).elitism ?? 0;
  pickIds(g.engine, [g.id("el0")]);
  assert.equal((g.engine.getThresholds(P1) as Record<string, number>).elitism, iconsBefore + 1);
  assert.equal(ready(g.engine), readyBefore);
});

clause(ENGINEER, "0:rule", "'you may': declining the search puts nothing into play, and the Elitism stay in the deck", () => {
  const g = engBoard();
  play(g.engine, P1, g.id("eng"));
  pickIds(g.engine, []);
  assert.equal(zoneOf(g.engine, g.id("el0")), "deck");
  assert.equal(zoneOf(g.engine, g.id("el1")), "deck");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("eng")), "play", "the Engineer is in play either way");
  assert.equal(revealsOf(g.engine).length, 0);
});

clause(ENGINEER, "0:rule", "'a card named Elitism': exactly one is fetched even when several are in the deck", () => {
  const g = engBoard({ elitism: 3 });
  play(g.engine, P1, g.id("eng"));
  refused(() => pickIds(g.engine, [g.id("el0"), g.id("el1")]), "two cards");
  assert.ok(pending(g.engine), "the prompt is still open");
  pickIds(g.engine, [g.id("el2")]);
  assert.equal(zoneOf(g.engine, g.id("el2")), "play");
  assert.equal(zoneOf(g.engine, g.id("el0")), "deck");
  assert.equal(zoneOf(g.engine, g.id("el1")), "deck");
});

clause(ENGINEER, "0:rule", "only cards NAMED \"Elitism\" in MY deck can be fetched (not Crest of Elitism, my hand, my discard pile, the opponent's deck)", () => {
  const g = engBoard();
  play(g.engine, P1, g.id("eng"));
  refused(() => pickIds(g.engine, [g.id("crest")]), "Crest of Elitism");
  refused(() => pickIds(g.engine, [g.id("d0")]), "an ordinary deck card");
  refused(() => pickIds(g.engine, [g.id("elHand")]), "in my hand");
  refused(() => pickIds(g.engine, [g.id("elDisc")]), "in my discard pile");
  refused(() => pickIds(g.engine, [g.id("foeEl")]), "in the opponent's deck");
  assert.equal(zoneOf(g.engine, g.id("foeEl")), "deck");
  pickIds(g.engine, [g.id("el0")]);
  assert.equal(zoneOf(g.engine, g.id("el0")), "play", "control: a card named Elitism is accepted");
});

clause(ENGINEER, "0:rule", "with no Elitism in my deck nothing is fetched and the game is not left waiting; the opponent's deck is untouched", () => {
  const g = engBoard({ elitism: 0 });
  const oppDeck = [...deckOf(g.engine, P2)];
  play(g.engine, P1, g.id("eng"));
  if (pending(g.engine)) pickIds(g.engine, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.responseWindow, undefined);
  assert.equal(zoneOf(g.engine, g.id("eng")), "play");
  assert.deepEqual(deckOf(g.engine, P2), oppDeck);
});

clause(ENGINEER, "0:rule", "CR 312.1: the deck is shuffled afterwards (card found, nothing found, or no Elitism at all)", () => {
  for (const [label, elitism, answer] of [["found", 2, "pick"], ["declined", 2, "none"], ["no Elitism", 0, "none"]] as const) {
    const a = engBoard({ random: () => 0, elitism });
    const b = engBoard({ random: () => 0.9999999, elitism });
    for (const g of [a, b]) {
      play(g.engine, P1, g.id("eng"));
      if (pending(g.engine)) pickIds(g.engine, answer === "pick" ? [g.id("el0")] : []);
    }
    assert.deepEqual([...deckNames(a.engine, P1)].sort(), [...deckNames(b.engine, P1)].sort(), `${label}: same cards`);
    assert.notDeepEqual(deckNames(a.engine, P1), deckNames(b.engine, P1), `${label}: the deck was shuffled`);
  }
});

clause(ENGINEER, "0:rule", "'you may search': declining the search entirely is no search, so the deck is NOT shuffled (Q2); a failed search still is", () => {
  const rotating = engBoard({ random: () => 0 });
  const identity = engBoard({ random: () => 0.9999999 });
  for (const g of [rotating, identity]) {
    play(g.engine, P1, g.id("eng"));
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [], declined: true } } as never);
    resolvePendingResponses(g.engine);
  }
  assert.equal(rotating.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckNames(rotating.engine, P1), deckNames(identity.engine, P1), "declined: the deck order does not depend on the random source");
  assert.equal(zoneOf(rotating.engine, rotating.id("el0")), "deck");
});

clause(ENGINEER, "0:rule", "'enters play' includes being put into play by an effect: an Engineer raised from the discard pile searches too", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: { abilities: [{ id: "raise", type: "activated", targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const g = engBoard({ extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }, { key: "dead", def: printing(ENGINEER), owner: P1, zone: "discard" }] });
  play(g.engine, P1, g.id("raise"), { selected: { t: [g.id("dead")] } });
  assert.equal(zoneOf(g.engine, g.id("dead")), "play");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the search prompt appears");
  pickIds(g.engine, [g.id("el0")]);
  assert.equal(cardOf(g.engine, g.id("el0")).attachedTo, factionIdOf(g.engine, P1));
});

clause(ENGINEER, "0:rule", "it triggers for ITSELF entering play only: another card entering play while the Engineer is out starts no search", () => {
  const g = engBoard({ zone: "play" });
  play(g.engine, P1, g.id("ally"));
  assert.equal(g.engine.state.pendingChoice, undefined, "no search prompt");
  assert.equal(zoneOf(g.engine, g.id("el0")), "deck");
});

clause(ENGINEER, "0:rule", "the second player's Engineer searches THEIR deck and attaches to THEIR faction", () => {
  const g = engBoard({ owner: P2 });
  play(g.engine, P2, g.id("eng"));
  assert.equal(pending(g.engine)?.playerId, P2, "the Engineer's controller chooses");
  pickIds(g.engine, [g.id("el0")], P2);
  assert.equal(cardOf(g.engine, g.id("el0")).attachedTo, factionIdOf(g.engine, P2));
  assert.equal(cardOf(g.engine, g.id("el0")).controllerId, P2);
});

// =============================================================================
// Copulating Sarcophyle — character, rogue, sarcophyle, cost 1, [D], 1 str / 3 spd / 1 life
// If this card would be destroyed, you may lose 1 influence, instead. If you do, put this card into its owner's hand.
// =============================================================================

const SARCOPHYLE = "a609764f-804b-47ca-8822-573e6c5e956f";

function sarBoard(o: { extra?: CardPlacement[]; turn?: number; active?: PlayerId; influence?: number } = {}) {
  return devBoard(
    [
      { key: "sar", def: printing(SARCOPHYLE), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", life: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      {
        key: "bolt",
        def: tactic({ name: "Bolt", cost: 0, behavior: { abilities: [{ id: "bolt", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }] }] } }),
        owner: P1,
        zone: "hand"
      },
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type SarBoard = ReturnType<typeof sarBoard>;
/** P1 plays its Kill tactic on `key`; stops at the first pending choice. */
const killIt = (g: SarBoard, key: string) => {
  playRaw(g.engine, P1, g.id("kill"), { selected: { t: [g.id(key)] } });
  resolvePendingResponses(g.engine);
};
const boltIt = (g: SarBoard, key: string) => {
  playRaw(g.engine, P1, g.id("bolt"), { selected: { t: [g.id(key)] } });
  resolvePendingResponses(g.engine);
};
const replaceAnswerFor = (apply: boolean) => (pc: PendingChoiceLike): unknown => (pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply } : declineAll(pc));
/** P1 attacks with the Sarcophyle into a bigger blocker; replacement prompts are answered with `answer`. */
function fightThroughAnswering(g: SarBoard, answer: (pc: PendingChoiceLike) => unknown): void {
  declareAttackBy(g.engine, P1, [g.id("sar")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("foe")] } as never);
  finishBattle(g.engine, undefined, answer);
}

clause(SARCOPHYLE, "0:rule", "printed card: rogue sarcophyle, 1 / 3 / 1, deploys for exactly 1 with [D]", () => {
  const p = printing(SARCOPHYLE);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "rogue");
  assert.deepEqual(p.subtype, ["sarcophyle"]);
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "d");
  const g = devBoard([{ key: "sar", def: printing(SARCOPHYLE), owner: P1, zone: "hand" }, ...res({ deception: 3 })]);
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("sar"))), 1);
  assert.deepEqual([g.engine.getStat(g.id("sar"), "strength"), g.engine.getStat(g.id("sar"), "speed"), g.engine.getStat(g.id("sar"), "life")], [1, 3, 1]);
  const noD = devBoard([{ key: "sar", def: printing(SARCOPHYLE), owner: P1, zone: "hand" }, ...res({ rage: 3 })]);
  refused(() => playRaw(noD.engine, P1, noD.id("sar")), "no [D] icon", /threshold/i);
  const none = devBoard([{ key: "sar", def: printing(SARCOPHYLE), owner: P1, zone: "hand" }]);
  refused(() => playRaw(none.engine, P1, none.id("sar")), "no resources for cost 1");
});

clause(SARCOPHYLE, "0:rule", "destroyed by a destroy effect: I am offered the replacement; accepting loses exactly 1 influence and returns the card to its owner's hand", () => {
  const g = sarBoard();
  const inf = influenceOf(g.engine, P1);
  killIt(g, "sar");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "replacementChoice", "'you may': it is optional");
  assert.equal(pc?.playerId, P1);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("sar")), "hand", "put into its owner's hand instead of being destroyed");
  assert.equal(influenceOf(g.engine, P1), inf - 1, "lost exactly 1 influence");
  assert.equal(discardOf(g.engine, P1).includes(g.id("sar")), false, "it never reached the discard pile");
});

clause(SARCOPHYLE, "0:rule", "declining: no influence is lost and the card is destroyed normally", () => {
  const g = sarBoard();
  const inf = influenceOf(g.engine, P1);
  killIt(g, "sar");
  answerPending(g.engine, "replacementChoice", { apply: false });
  assert.equal(zoneOf(g.engine, g.id("sar")), "discard");
  assert.equal(influenceOf(g.engine, P1), inf);
});

clause(SARCOPHYLE, "0:rule", "destroyed by lethal damage: the replacement applies too, and the card comes back to hand undamaged (CR 506.6)", () => {
  const g = sarBoard();
  const inf = influenceOf(g.engine, P1);
  boltIt(g, "sar");
  assert.equal(pending(g.engine)?.kind, "replacementChoice");
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("sar")), "hand");
  assert.equal(influenceOf(g.engine, P1), inf - 1);
  assert.equal(cardOf(g.engine, g.id("sar")).damage, 0, "no damage carries over");
  const declined = sarBoard();
  boltIt(declined, "sar");
  answerPending(declined.engine, "replacementChoice", { apply: false });
  assert.equal(zoneOf(declined.engine, declined.id("sar")), "discard", "declining: destroyed by the damage");
});

clause(SARCOPHYLE, "0:rule", "destroyed in battle: the replacement applies to battle damage too", () => {
  const g = sarBoard();
  const inf = influenceOf(g.engine, P1);
  fightThroughAnswering(g, replaceAnswerFor(true));
  assert.equal(zoneOf(g.engine, g.id("sar")), "hand", "returned to hand instead of dying in the battle");
  assert.equal(influenceOf(g.engine, P1), inf - 1);
  const declined = sarBoard();
  fightThroughAnswering(declined, replaceAnswerFor(false));
  assert.equal(zoneOf(declined.engine, declined.id("sar")), "discard");
  assert.equal(influenceOf(declined.engine, P1), inf);
});

clause(SARCOPHYLE, "0:rule", "'this card': another character of mine being destroyed is not replaced (no prompt, no influence loss)", () => {
  const g = sarBoard();
  const inf = influenceOf(g.engine, P1);
  killIt(g, "other");
  assert.equal(g.engine.state.pendingChoice, undefined, "no replacement is offered");
  assert.equal(zoneOf(g.engine, g.id("other")), "discard");
  assert.equal(zoneOf(g.engine, g.id("sar")), "play");
  assert.equal(influenceOf(g.engine, P1), inf);
});

clause(SARCOPHYLE, "0:rule", "the returned card can be redeployed from the hand, and can dodge destruction again (each time costs 1 influence)", () => {
  const g = sarBoard({ extra: [{ key: "kill2", def: killTactic({ name: "Kill Two" }), owner: P1, zone: "hand" }, ...res({ deception: 3 })] });
  const inf = influenceOf(g.engine, P1);
  killIt(g, "sar");
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("sar")), "hand");
  play(g.engine, P1, g.id("sar"));
  assert.equal(zoneOf(g.engine, g.id("sar")), "play");
  playRaw(g.engine, P1, g.id("kill2"), { selected: { t: [g.id("sar")] } });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("sar")), "hand");
  assert.equal(influenceOf(g.engine, P1), inf - 2);
});

clause(SARCOPHYLE, "0:rule", "only while in play: a Sarcophyle in my hand offers nothing when other cards are destroyed", () => {
  const g = sarBoard({ extra: [{ key: "sar2", def: printing(SARCOPHYLE), owner: P1, zone: "hand" }] });
  killIt(g, "other");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("sar2")), "hand");
});

// =============================================================================
// Cantankerous Claywork — character, gearsmith, golem, cost 7, [E][E][E], 6 str / 3 spd / 5 life
// AGGRO
// When this card attacks, other characters you control gain 1 strength and 1 life this turn.
// =============================================================================

const CLAYWORK = "a2cf52ef-059d-4a5a-8520-e33f56ece629";

function clayBoard(o: { inHand?: boolean; resources?: CardPlacement[]; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    random: () => 0.5,
    cards: [
      { key: "cw", def: printing(CLAYWORK), owner: P1, zone: o.inHand ? "hand" : "play" },
      { key: "mine1", def: character({ name: "Mine One", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 4, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe One", strength: 3, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "idol", def: item({ name: "My Idol", strength: 2 }), owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("f", 3, P2, "deck"),
      ...(o.resources ?? []),
      ...(o.extra ?? [])
    ]
  });
}
type ClayBoard = ReturnType<typeof clayBoard>;
const clayStats = (g: ClayBoard, key: string): [number, number] => [g.engine.getStat(g.id(key), "strength"), g.engine.getStat(g.id(key), "life")];

clause(CLAYWORK, "0:kw:AGGRO", "has the AGGRO keyword and its printed 6 / 3 / 5 gearsmith golem stats", () => {
  const g = clayBoard();
  assert.ok(g.engine.getKeywords(g.id("cw")).map((k) => String(k).toLowerCase()).includes("aggro"), "g.engine.getKeywords(cw).map((k) => String(k).toLowerCase()).includes(");
  assert.equal(g.engine.getStat(g.id("cw"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("cw"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("cw"), "life"), 5);
  assert.deepEqual(g.engine.getCardTypes(g.id("cw")), ["character"]);
  assert.equal(printing(CLAYWORK).trade, "gearsmith");
  assert.deepEqual(printing(CLAYWORK).subtype, ["golem"]);
  assert.equal(g.engine.getKeywords(g.id("mine1")).map((k) => String(k).toLowerCase()).includes("aggro"), false, "control: an ordinary character has no AGGRO");
});

clause(CLAYWORK, "0:kw:AGGRO", "it can attack the turn it enters play, and an ordinary character deployed the same turn cannot", () => {
  const g = clayBoard({ inHand: true, resources: res({ elitism: 7 }), extra: [{ key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("cw"));
  play(g.engine, P1, g.id("plain"));
  assert.equal(zoneOf(g.engine, g.id("cw")), "play");
  assert.equal(zoneOf(g.engine, g.id("plain")), "play");
  refused(() => declareAttackBy(g.engine, P1, [g.id("plain")]), "no AGGRO, summoning sick", /./);
  declareAttackBy(g.engine, P1, [g.id("cw")]);
  assert.ok(g.engine.state.battle, "Claywork attacked right away");
});

clause(CLAYWORK, "0:kw:AGGRO", "deploys for exactly its printed cost 7 with [E][E][E]: seven Elitism are all spent; six is one short; 7 Rage lack the threshold; two [E] is one icon short; spent [E] still count", () => {
  const ok = clayBoard({ inHand: true, resources: res({ elitism: 7 }) });
  play(ok.engine, P1, ok.id("cw"));
  assert.equal(zoneOf(ok.engine, ok.id("cw")), "play");
  assert.equal(ready(ok.engine), 0, "all seven paid");
  const short = clayBoard({ inHand: true, resources: res({ elitism: 6 }) });
  refused(() => playRaw(short.engine, P1, short.id("cw")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("cw")), "hand");
  assert.equal(ready(short.engine), 6, "nothing paid");
  const noThreshold = clayBoard({ inHand: true, resources: res({ rage: 7 }) });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("cw")), "no [E] at all", /threshold/i);
  const iconShort = clayBoard({ inHand: true, resources: res({ elitism: 2, rage: 5 }) });
  refused(() => playRaw(iconShort.engine, P1, iconShort.id("cw")), "two [E] of three", /threshold/i);
  const spentOk = clayBoard({ inHand: true, resources: [...bank("elitism", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...res({ rage: 7 })] });
  play(spentOk.engine, P1, spentOk.id("cw"));
  assert.equal(zoneOf(spentOk.engine, spentOk.id("cw")), "play", "spent [E] count for the threshold; seven ready Rage pay");
});

clause(CLAYWORK, "1:rule", "when it attacks, every other character I control gains +1 strength and +1 life; it, the opponent's character and my item are not changed", () => {
  const g = clayBoard();
  declareAttackBy(g.engine, P1, [g.id("cw")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(clayStats(g, "mine1"), [3, 4], "2/3 -> 3/4");
  assert.deepEqual(clayStats(g, "mine2"), [5, 6], "4/5 -> 5/6");
  assert.deepEqual(clayStats(g, "cw"), [6, 5], "'other' characters only: Claywork itself is unchanged");
  assert.deepEqual(clayStats(g, "foe1"), [3, 3], "the opponent's character is not 'your'");
  assert.equal(g.engine.getStat(g.id("mine1"), "speed"), 1, "speed unchanged");
  assert.equal(g.engine.getStat(g.id("idol"), "strength"), 2, "an item is not a character: not boosted");
});

clause(CLAYWORK, "1:rule", "'this turn': the bonus stays for the whole turn (also after the battle) and is gone next turn", () => {
  const g = clayBoard();
  declareAttackBy(g.engine, P1, [g.id("cw")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
  finishBattle(g.engine);
  assert.equal(g.engine.state.battle, undefined, "the battle is over");
  assert.deepEqual(clayStats(g, "mine1"), [3, 4], "still boosted after the battle, same turn");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.deepEqual(clayStats(g, "mine1"), [2, 3], "'this turn' ended");
  assert.deepEqual(clayStats(g, "mine2"), [4, 5]);
});

clause(CLAYWORK, "1:rule", "other attackers in the same party are 'other characters' too and gain the bonus", () => {
  const g = clayBoard();
  declareAttackBy(g.engine, P1, [g.id("cw"), g.id("mine1")]);
  drain(g.engine, declineAll);
  assert.deepEqual(clayStats(g, "mine1"), [3, 4]);
  assert.deepEqual(clayStats(g, "mine2"), [5, 6]);
});

clause(CLAYWORK, "1:rule", "it triggers only when THIS card attacks: another character attacking alone gives no bonus", () => {
  const g = clayBoard();
  declareAttackBy(g.engine, P1, [g.id("mine1")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(clayStats(g, "mine1"), [2, 3]);
  assert.deepEqual(clayStats(g, "mine2"), [4, 5]);
  assert.deepEqual(clayStats(g, "cw"), [6, 5]);
});

clause(CLAYWORK, "1:rule", "the set is fixed when it attacks: a character entering later this turn is not boosted", () => {
  const g = clayBoard({ extra: [{ key: "late", def: character({ name: "Late", cost: 0, strength: 1, life: 1 }), owner: P1, zone: "hand" }] });
  declareAttackBy(g.engine, P1, [g.id("cw")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
  finishBattle(g.engine);
  assert.deepEqual(clayStats(g, "mine1"), [3, 4], "control: the trigger did happen");
  play(g.engine, P1, g.id("late"));
  assert.equal(zoneOf(g.engine, g.id("late")), "play");
  assert.deepEqual(clayStats(g, "late"), [1, 1]);
});

clause(CLAYWORK, "1:rule", "two Claywork attacking together: each is 'other' for the other (+1/+1 each) and a bystander gets both bonuses", () => {
  const g = clayBoard({ extra: [{ key: "cw2", def: printing(CLAYWORK), owner: P1, zone: "play" }] });
  declareAttackBy(g.engine, P1, [g.id("cw"), g.id("cw2")]);
  drain(g.engine, declineAll);
  assert.deepEqual(clayStats(g, "mine1"), [4, 5], "two triggers: +2/+2");
  assert.deepEqual(clayStats(g, "cw"), [7, 6], "boosted by the other Claywork only");
  assert.deepEqual(clayStats(g, "cw2"), [7, 6]);
  assert.deepEqual(clayStats(g, "foe1"), [3, 3]);
});

clause(CLAYWORK, "1:rule", "the opponent's Claywork boosts only its controller's characters", () => {
  const g = clayBoard({ active: P2, extra: [{ key: "foecw", def: printing(CLAYWORK), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P2, [g.id("foecw")]);
  assert.deepEqual(clayStats(g, "foe1"), [4, 4]);
  assert.deepEqual(clayStats(g, "mine1"), [2, 3], "my characters are not 'their' characters");
  assert.deepEqual(clayStats(g, "foecw"), [6, 5]);
});

// =============================================================================
// Caracal Morphnus — character, banker, seraphim / dragon, cost 6, [G], 0 str / 3 spd / 0 life
// UNIQUE CARACAL
// This card enters play with 5 tokens on it.
// This card gains 1 strength and 1 life for each token on it.
// When you draw any number of cards, put tokens on this card equal to the number of cards drawn.
// $$$ MORPH -- COST: Remove 3 tokens from this card. -- EFFECT: Draw a card.
// =============================================================================

const CARACAL = "9f783951-32f8-47cb-8eb7-9c047142d5c4";

function caracalBoard(o: { zone?: Zone; tokens?: number; deck?: number; extra?: CardPlacement[]; greed?: number; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "ca", def: printing(CARACAL), owner: P1, zone: o.zone ?? "play", ...(o.tokens === undefined ? {} : { counters: { token: o.tokens } }) },
      ...fillers("d", o.deck ?? 8, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...res({ greed: o.greed ?? 6 }),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type CaBoard = ReturnType<typeof caracalBoard>;
const caStats = (g: CaBoard): [number, number, number] => [g.engine.getStat(g.id("ca"), "strength"), g.engine.getStat(g.id("ca"), "speed"), g.engine.getStat(g.id("ca"), "life")];
const morph = (g: CaBoard) => activate(g.engine, P1, g.id("ca"), "morph");
/** A free tactic: its controller draws `n` cards. */
const drawTactic = (n: number, name = `Draw ${n}`) => tactic({ name, cost: 0, behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "draw", player: "controller", amount: n }] }] } });

clause(CARACAL, "0:unique", "printed card: banker seraphim dragon, 0 str / 3 spd / 0 life base, deploys for exactly 6 with [G]", () => {
  const p = printing(CARACAL);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "banker");
  assert.deepEqual(p.subtype, ["seraphim", "dragon"]);
  assert.equal(p.cost, 6);
  assert.equal(p.threshold, "g");
  assert.equal(p.strength, 0);
  assert.equal(p.life, 0);
  assert.equal(p.speed, 3);
  const g = caracalBoard({ zone: "hand", greed: 6 });
  assert.equal(spentBy(g.engine, P1, () => play(g.engine, P1, g.id("ca"))), 6);
  assert.equal(zoneOf(g.engine, g.id("ca")), "play");
  const short = caracalBoard({ zone: "hand", greed: 5 });
  refused(() => playRaw(short.engine, P1, short.id("ca")), "5 resources for cost 6");
  const noG = devBoard([{ key: "ca", def: printing(CARACAL), owner: P1, zone: "hand" }, ...res({ rage: 6 })]);
  refused(() => playRaw(noG.engine, P1, noG.id("ca")), "no [G] icon", /threshold/i);
});

clause(CARACAL, "0:unique", "controlling a second Caracal makes you keep one (the controller chooses); a different designation is no duplicate; the opponent may have their own", () => {
  const g = caracalBoard({ tokens: 5, extra: [{ key: "ca2", def: printing(CARACAL), owner: P1, zone: "hand" }], greed: 6 });
  assert.equal(zoneOf(g.engine, g.id("ca")), "play", "control: the first Caracal is alive (5 tokens = 5 life)");
  play(g.engine, P1, g.id("ca2"));
  drain(g.engine, (pc) => (pc.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: g.id("ca2") } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("ca2")), "play", "the chosen survivor stays");
  assert.equal(zoneOf(g.engine, g.id("ca")), "discard", "the other is destroyed");
  const other = caracalBoard({ tokens: 5, extra: [{ key: "ou", def: character({ name: "Other Unique", unique: "other unique" } as Partial<CardDefinition>), owner: P1, zone: "play" }] });
  assert.equal(other.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(other.engine, other.id("ou")), "play");
  const theirs = caracalBoard({ tokens: 5, extra: [{ key: "fca", def: printing(CARACAL), owner: P2, zone: "play" }] });
  assert.equal(theirs.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(theirs.engine, theirs.id("fca")), "play");
});

clause(CARACAL, "1:rule", "it enters play with exactly 5 tokens on it (deployed from hand)", () => {
  const g = caracalBoard({ zone: "hand" });
  play(g.engine, P1, g.id("ca"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ca")), "play");
  assert.equal(tokensOn(g.engine, g.id("ca")), 5);
});

clause(CARACAL, "1:rule", "also when put into play by an effect rather than deployed: it still has 5 tokens", () => {
  const cheat = tactic({
    name: "Cheat",
    cost: 0,
    behavior: { abilities: [{ id: "pip", type: "activated", targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const g = caracalBoard({ zone: "discard", extra: [{ key: "cheat", def: cheat, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("cheat"), { selected: { t: [g.id("ca")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ca")), "play");
  assert.equal(tokensOn(g.engine, g.id("ca")), 5);
});

clause(CARACAL, "1:rule", "tokens do not carry over: a Caracal that left play and is deployed again enters with 5 tokens, not 5 + the old ones (CR 409.2)", () => {
  const g = caracalBoard({ extra: [{ key: "bounce", def: tactic({ name: "Bounce", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" }], tokens: 4, greed: 6 });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("ca")] } });
  assert.equal(zoneOf(g.engine, g.id("ca")), "hand");
  play(g.engine, P1, g.id("ca"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("ca")), "play");
  assert.equal(tokensOn(g.engine, g.id("ca")), 5, "exactly 5, fresh");
});

clause(CARACAL, "2:rule", "gains 1 strength and 1 life for each token: 5 tokens give 5 / 3 / 5", () => {
  const g = caracalBoard({ zone: "hand" });
  play(g.engine, P1, g.id("ca"));
  drain(g.engine, declineAll);
  assert.deepEqual(caStats(g), [5, 3, 5]);
});

clause(CARACAL, "2:rule", "it follows the token count: 1, 2 and 7 tokens give +1, +2 and +7; speed never changes", () => {
  for (const n of [1, 2, 7]) {
    const g = caracalBoard({ tokens: n });
    assert.deepEqual(caStats(g), [n, 3, n], `${n} tokens`);
  }
});

clause(CARACAL, "2:rule", "only its own tokens count: tokens on another card give it nothing", () => {
  const g = caracalBoard({ tokens: 2, extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", counters: { token: 4 } }] });
  assert.deepEqual(caStats(g), [2, 3, 2]);
});

clause(CARACAL, "3:rule", "when I draw cards (a draw-2 effect), it gets tokens equal to the number drawn", () => {
  const g = caracalBoard({ tokens: 3, extra: [{ key: "dr", def: drawTactic(2), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("dr"));
  drain(g.engine, declineAll);
  assert.equal(handOf(g.engine, P1).length, 2, "two cards drawn");
  assert.equal(tokensOn(g.engine, g.id("ca")), 5, "3 + 2");
  assert.deepEqual(caStats(g), [5, 3, 5]);
});

clause(CARACAL, "3:rule", "draw 1 and draw 3 give +1 and +3", () => {
  const one = caracalBoard({ tokens: 2, extra: [{ key: "dr", def: drawTactic(1), owner: P1, zone: "hand" }] });
  play(one.engine, P1, one.id("dr"));
  assert.equal(tokensOn(one.engine, one.id("ca")), 3);
  const three = caracalBoard({ tokens: 2, extra: [{ key: "dr", def: drawTactic(3), owner: P1, zone: "hand" }] });
  play(three.engine, P1, three.id("dr"));
  assert.equal(tokensOn(three.engine, three.id("ca")), 5);
});

clause(CARACAL, "3:rule", "only cards actually drawn count: drawing 3 from a 1-card deck gives 1 token; drawing from an empty deck gives none", () => {
  const short = caracalBoard({ tokens: 2, deck: 1, extra: [{ key: "dr", def: drawTactic(3), owner: P1, zone: "hand" }] });
  play(short.engine, P1, short.id("dr"));
  assert.equal(handOf(short.engine, P1).length, 1);
  assert.equal(tokensOn(short.engine, short.id("ca")), 3, "one card drawn: +1");
  const empty = caracalBoard({ tokens: 2, deck: 0, extra: [{ key: "dr", def: drawTactic(2), owner: P1, zone: "hand" }] });
  play(empty.engine, P1, empty.id("dr"));
  assert.equal(tokensOn(empty.engine, empty.id("ca")), 2, "nothing drawn: no tokens");
});

clause(CARACAL, "3:rule", "'you draw': the Develop Rule's draw counts, but the opponent's draws do not", () => {
  const dev = caracalBoard({ tokens: 2 });
  developDraw(dev.engine, P1);
  assert.equal(tokensOn(dev.engine, dev.id("ca")), 3, "the Develop Rule draw is a draw");
  const opp = caracalBoard({ tokens: 2, turn: 2, active: P2, extra: [{ key: "odr", def: drawTactic(2, "Opp Draw"), owner: P2, zone: "hand" }] });
  play(opp.engine, P2, opp.id("odr"));
  assert.equal(handOf(opp.engine, P2).length, 2, "the opponent drew");
  assert.equal(tokensOn(opp.engine, opp.id("ca")), 2, "no tokens for the opponent's draw");
});

clause(CARACAL, "3:rule", "it needs to be in play: a Caracal in my hand or discard pile collects no tokens when I draw", () => {
  const g = caracalBoard({ zone: "hand", extra: [{ key: "dr", def: drawTactic(2), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("dr"));
  assert.equal(tokensOn(g.engine, g.id("ca")), 0);
});

clause(CARACAL, "4:ability:morph", "$$$ MORPH removes exactly 3 tokens as the cost and draws a card (which adds 1 token back by the draw rule)", () => {
  const g = caracalBoard({ tokens: 5 });
  const top = deckOf(g.engine, P1)[0];
  morph(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, top), "hand", "drew the top card");
  assert.equal(handOf(g.engine, P1).length, 1);
  assert.equal(tokensOn(g.engine, g.id("ca")), 5 - 3 + 1, "3 removed, then +1 for the card drawn");
  assert.deepEqual(caStats(g), [3, 3, 3]);
});

clause(CARACAL, "4:ability:morph", "the cost is paid when MORPH is used, before the opponent can respond; no resources are needed", () => {
  const g = caracalBoard({ tokens: 5, greed: 0 });
  actRaw(g.engine, P1, g.id("ca"), "morph");
  assert.equal(g.engine.state.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(tokensOn(g.engine, g.id("ca")), 2, "the 3 tokens are already removed");
  assert.equal(handOf(g.engine, P1).length, 0, "the draw waits for resolution");
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P1).length, 1);
});

clause(CARACAL, "4:ability:morph", "needs 3 tokens: with 2 tokens (or 0) it is refused and nothing changes", () => {
  for (const n of [0, 1, 2]) {
    const g = caracalBoard({ tokens: n });
    refused(() => actRaw(g.engine, P1, g.id("ca"), "morph"), `${n} tokens`);
    assert.equal(tokensOn(g.engine, g.id("ca")), n);
    assert.equal(handOf(g.engine, P1).length, 0);
  }
  const four = caracalBoard({ tokens: 4 });
  morph(four);
  assert.equal(tokensOn(four.engine, four.id("ca")), 2, "4 - 3 + 1 drawn");
});

clause(CARACAL, "4:ability:morph", "it can be used again while tokens remain: 7 tokens -> 5 -> 3 and two cards drawn", () => {
  const g = caracalBoard({ tokens: 7 });
  morph(g);
  morph(g);
  assert.equal(handOf(g.engine, P1).length, 2);
  assert.equal(tokensOn(g.engine, g.id("ca")), 7 - 3 + 1 - 3 + 1);
});

clause(CARACAL, "4:ability:morph", "removing the last tokens leaves 0 strength and 0 life (base 0 + 0 tokens): the Caracal is destroyed, and MORPH still draws its card", () => {
  const g = caracalBoard({ tokens: 3 });
  const top = deckOf(g.engine, P1)[0];
  morph(g);
  assert.equal(zoneOf(g.engine, top), "hand", "the ability still resolved: a card was drawn");
  assert.equal(zoneOf(g.engine, g.id("ca")), "discard", "0 life destroys it (no tokens left to gain life from)");
});

clause(CARACAL, "4:ability:morph", "it works only from play: MORPH on a Caracal in hand or the discard pile is refused", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = caracalBoard({ zone, tokens: 5 });
    refused(() => actRaw(g.engine, P1, g.id("ca"), "morph"), `Caracal in ${zone}`);
  }
});

// =============================================================================
// Carnal Cravings — resource, banker, cost 0
// PROVIDES: [G]
// When a card that provides [G] enters play under your control, gain 1 influence.
// =============================================================================

const CRAVINGS = "0a4909d1-aadf-4e15-a41b-267e177ff51d";

function cravingsBoard(o: { cravings?: Zone; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "cc", def: printing(CRAVINGS), owner: P1, zone: o.cravings ?? "play" },
      { key: "gr", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "gr2", def: resourceCard({ name: "Greed Two", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "rg", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "ogr", def: resourceCard({ name: "Their Greed", resource: { provides: ["greed"], staple: true } }), owner: P2, zone: "hand" },
      { key: "hc", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type CcBoard = ReturnType<typeof cravingsBoard>;
const greedCount = (g: CcBoard) => (g.engine.getThresholds(P1) as Record<string, number>).greed ?? 0;

clause(CRAVINGS, "0:provides", "a non-staple resource that provides exactly one [G] (and nothing else)", () => {
  const g = cravingsBoard();
  const t = g.engine.getThresholds(P1) as Record<string, number>;
  assert.equal(t.greed, 1);
  for (const icon of ["rage", "deception", "elitism", "obsession", "volition"]) assert.equal(t[icon] ?? 0, 0, `no ${icon}`);
  const p = printing(CRAVINGS);
  assert.equal(p.type, "resource");
  assert.equal(p.trade, "banker");
  assert.equal(p.cost, 0);
  assert.equal(p.resource?.staple, false);
  assert.deepEqual(p.resource?.provides, ["greed"]);
  assert.equal(ready(g.engine), 1, "and it is a resource I can pay with");
});

clause(CRAVINGS, "0:provides", "its [G] meets a threshold: a [G] card is deployable only once Carnal Cravings is in play", () => {
  const needsG = character({ name: "NeedsG", cost: 0, threshold: "g" as never });
  const without = cravingsBoard({ cravings: "hand", extra: [{ key: "need", def: needsG, owner: P1, zone: "hand" }] });
  refused(() => playRaw(without.engine, P1, without.id("need")), "no [G] icon", /threshold/i);
  const withIt = cravingsBoard({ extra: [{ key: "need", def: needsG, owner: P1, zone: "hand" }] });
  play(withIt.engine, P1, withIt.id("need"));
  assert.equal(zoneOf(withIt.engine, withIt.id("need")), "play");
});

clause(CRAVINGS, "1:rule", "a Greed resource entering play under my control: I gain exactly 1 influence", () => {
  const g = cravingsBoard();
  const inf = influenceOf(g.engine, P1);
  developResource(g.engine, P1, g.id("gr"), false);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(g.engine, P1), inf + 1);
  assert.equal(greedCount(g), 2);
});

clause(CRAVINGS, "1:rule", "a card that does not provide [G] (a Rage resource) gains nothing", () => {
  const g = cravingsBoard();
  const inf = influenceOf(g.engine, P1);
  developResource(g.engine, P1, g.id("rg"), false);
  assert.equal(influenceOf(g.engine, P1), inf);
});

clause(CRAVINGS, "1:rule", "a face-down card provides Volition, not [G], so it gains nothing; a non-resource card entering play gains nothing", () => {
  const g = cravingsBoard();
  const inf = influenceOf(g.engine, P1);
  developResource(g.engine, P1, g.id("gr"), true);
  assert.equal(influenceOf(g.engine, P1), inf, "a Greed card played face-down provides Volition only");
  const c = cravingsBoard();
  play(c.engine, P1, c.id("hc"));
  assert.equal(influenceOf(c.engine, P1), inf);
});

clause(CRAVINGS, "1:rule", "'under your control': the opponent's Greed resource entering play gives me nothing", () => {
  const g = cravingsBoard({ turn: 2, active: P2 });
  const inf = influenceOf(g.engine, P1);
  developResource(g.engine, P2, g.id("ogr"), false);
  assert.equal(zoneOf(g.engine, g.id("ogr")), "play");
  assert.equal(influenceOf(g.engine, P1), inf);
  assert.equal(influenceOf(g.engine, P2), START);
});

clause(CRAVINGS, "1:rule", "it does not trigger on its own entry (it has to be in play to watch): deploying it gains nothing", () => {
  const g = cravingsBoard({ cravings: "hand" });
  const inf = influenceOf(g.engine, P1);
  developResource(g.engine, P1, g.id("cc"), false);
  assert.equal(zoneOf(g.engine, g.id("cc")), "play");
  assert.equal(influenceOf(g.engine, P1), inf);
  assert.equal(greedCount(g), 1);
});

clause(CRAVINGS, "1:rule", "a second Carnal Cravings entering play is a card that provides [G]: the first gains me 1 influence", () => {
  const g = cravingsBoard({ extra: [{ key: "cc2", def: printing(CRAVINGS), owner: P1, zone: "hand" }] });
  const inf = influenceOf(g.engine, P1);
  developResource(g.engine, P1, g.id("cc2"), false);
  drain(g.engine, declineAll);
  assert.equal(influenceOf(g.engine, P1), inf + 1, "only the Cravings already in play sees the new one enter");
});

clause(CRAVINGS, "1:rule", "two Carnal Cravings in play both trigger on a Greed resource: +2 influence", () => {
  const g = cravingsBoard({ extra: [{ key: "cc2", def: printing(CRAVINGS), owner: P1, zone: "play" }] });
  const inf = influenceOf(g.engine, P1);
  developResource(g.engine, P1, g.id("gr"), false);
  drain(g.engine, declineAll);
  assert.equal(influenceOf(g.engine, P1), inf + 2);
});

clause(CRAVINGS, "1:rule", "it only works in play: in hand or in the discard pile a Greed resource entering play gains nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = cravingsBoard({ cravings: zone });
    const inf = influenceOf(g.engine, P1);
    developResource(g.engine, P1, g.id("gr"), false);
    assert.equal(influenceOf(g.engine, P1), inf, `Cravings in ${zone}`);
  }
});

clause(CRAVINGS, "1:rule", "each qualifying card gains once: two Greed resources entering over the turn gain 1 each", () => {
  const base = developFaction();
  const two = developFaction({ faction: { ...base.faction!, turn: { ...base.faction!.turn, develop: { choices: [{ type: "playResource", count: 2 }] } } } });
  const g = devBoard(
    [
      { key: "cc", def: printing(CRAVINGS), owner: P1, zone: "play" },
      { key: "gr", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "gr2", def: resourceCard({ name: "Greed Two", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" }
    ],
    { playerA: { faction: two } }
  );
  const inf = influenceOf(g.engine, P1);
  openDevelopPlay(g.engine, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("gr")], faceDown: false });
  drain(g.engine, declineAll);
  assert.equal(influenceOf(g.engine, P1), inf + 2);
});

// =============================================================================
// Chain Reaction — tactic, warlord, cost 0, [R]
// EXTRA COST: Pick a location.
// Inflict 3 damage to the location. If it is destroyed by that damage, you may pick a character. If you do, inflict 2 damage to that
// character. If it is destroyed by that damage, inflict 1 damage to an opponent and draw a card.
// FLIP UP: 1 [R]
// =============================================================================

const CHAIN = "5332f878-57a2-46dd-ab1e-f7ab6113a5bd";

function chainBoard(o: { rage?: number; zone?: "hand" | "facedown"; extra?: CardPlacement[]; locStructure?: number; locDamage?: number; turn?: number; active?: PlayerId; other?: number } = {}) {
  return devBoard(
    [
      { key: "cr", def: printing(CHAIN), owner: P1, zone: o.zone === "facedown" ? "play" : "hand", ...(o.zone === "facedown" ? { faceDown: true } : {}) },
      { key: "loc", def: location({ name: "Target Loc", structure: o.locStructure ?? 3 }), owner: P2, zone: "play", damage: o.locDamage ?? 0 },
      { key: "myLoc", def: location({ name: "My Loc", structure: 3 }), owner: P1, zone: "play" },
      { key: "weak", def: character({ name: "Weak", life: 2 }), owner: P2, zone: "play" },
      { key: "tough", def: character({ name: "Tough", life: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 1 }), owner: P1, zone: "play" },
      { key: "idol", def: item({ name: "Idol" }), owner: P2, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...res({ rage: o.rage ?? 1 }),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type ChBoard = ReturnType<typeof chainBoard>;
const chainRaw = (g: ChBoard, loc = "loc") => playRaw(g.engine, P1, g.id("cr"), { selected: { l: [g.id(loc)] } });
const chainCast = (g: ChBoard, loc = "loc") => {
  chainRaw(g, loc);
  resolvePendingResponses(g.engine);
};
/** Casts it and, if asked for a character, picks `charKey` (or nobody). */
const chainFull = (g: ChBoard, charKey?: string, loc = "loc") => {
  chainCast(g, loc);
  if (pending(g.engine)) answerPending(g.engine, "chooserSelectsTarget", { selected: charKey ? [g.id(charKey)] : [] });
};

clause(CHAIN, "0:extraCost", "printed card: warlord tactic, cost 0, [R]; needs one Rage icon and pays nothing", () => {
  const p = printing(CHAIN);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 0);
  assert.equal(p.threshold, "r");
  const g = chainBoard({ rage: 1 });
  assert.equal(spentBy(g.engine, P1, () => chainFull(g)), 0, "cost 0");
  assert.equal(zoneOf(g.engine, g.id("cr")), "discard");
  const noR = chainBoard({ rage: 0, extra: res({ greed: 3 }) });
  refused(() => chainRaw(noR), "no [R] icon even though it is free", /threshold/i);
  assert.equal(zoneOf(noR.engine, noR.id("cr")), "hand");
  const none = chainBoard({ rage: 0 });
  refused(() => chainRaw(none), "no resources at all");
});

clause(CHAIN, "0:extraCost", "the pick is a location: either player's location can be picked", () => {
  const theirs = chainBoard();
  chainFull(theirs, undefined, "loc");
  assert.equal(zoneOf(theirs.engine, theirs.id("loc")), "discard");
  const mine = chainBoard();
  chainFull(mine, undefined, "myLoc");
  assert.equal(zoneOf(mine.engine, mine.id("myLoc")), "discard", "my own location can be picked");
});

clause(CHAIN, "0:extraCost", "a character, an item, a faction, a location in hand or in the discard pile cannot be picked; no pick and two picks are refused", () => {
  const extra: CardPlacement[] = [
    { key: "handLoc", def: location({ name: "Hand Loc" }), owner: P1, zone: "hand" },
    { key: "discLoc", def: location({ name: "Disc Loc" }), owner: P2, zone: "discard" }
  ];
  for (const key of ["weak", "idol", "handLoc", "discLoc"]) {
    const g = chainBoard({ extra });
    refused(() => chainRaw(g, key), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("cr")), "hand", "nothing played");
  }
  const f = chainBoard();
  refused(() => playRaw(f.engine, P1, f.id("cr"), { selected: { l: [f.engine.state.players[P2].factionId!] } }), "a faction");
  const none = chainBoard();
  refused(() => playRaw(none.engine, P1, none.id("cr")), "no pick");
  const two = chainBoard();
  refused(() => playRaw(two.engine, P1, two.id("cr"), { selected: { l: [two.id("loc"), two.id("myLoc")] } }), "two picks");
  const noLocs = devBoard([{ key: "cr", def: printing(CHAIN), owner: P1, zone: "hand" }, ...res({ rage: 1 })]);
  refused(() => playRaw(noLocs.engine, P1, noLocs.id("cr")), "no location in play");
});

clause(CHAIN, "1:rule", "inflicts 3 damage to the location: a structure-5 location survives with 3 damage and nothing more happens", () => {
  const g = chainBoard({ locStructure: 5 });
  const oppInf = influenceOf(g.engine, P2);
  const hand = handOf(g.engine, P1).length;
  chainCast(g);
  assert.equal(g.engine.state.pendingChoice, undefined, "no character prompt: it was not destroyed");
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 3, "exactly 3 damage");
  assert.equal(handOf(g.engine, P1).length, hand - 1, "no card drawn (only the tactic left my hand)");
  assert.equal(influenceOf(g.engine, P2), oppInf);
  for (const k of ["weak", "tough", "mine"]) assert.equal(cardOf(g.engine, g.id(k)).damage, 0, `${k} untouched`);
});

clause(CHAIN, "1:rule", "a structure-3 (or smaller) location is destroyed by the 3 damage and I may pick a character", () => {
  for (const structure of [3, 2]) {
    const g = chainBoard({ locStructure: structure });
    chainCast(g);
    assert.equal(zoneOf(g.engine, g.id("loc")), "discard", `structure ${structure}: destroyed`);
    const pc = pending(g.engine);
    assert.equal(pc?.kind, "chooserSelectsTarget", "asked for a character");
    assert.equal(pc?.playerId, P1);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  }
});

clause(CHAIN, "1:rule", "damage already on the location counts: a structure-5 location with 2 damage is destroyed by the 3 more", () => {
  const g = chainBoard({ locStructure: 5, locDamage: 2 });
  chainCast(g);
  assert.equal(zoneOf(g.engine, g.id("loc")), "discard");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
});

clause(CHAIN, "1:rule", "'you may pick': declining the character pick ends it: no damage, no 1 damage to the opponent, no draw", () => {
  const g = chainBoard();
  const oppInf = influenceOf(g.engine, P2);
  const hand = handOf(g.engine, P1).length;
  chainFull(g, undefined);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const k of ["weak", "tough", "mine"]) assert.equal(cardOf(g.engine, g.id(k)).damage, 0, `${k} untouched`);
  assert.equal(influenceOf(g.engine, P2), oppInf);
  assert.equal(handOf(g.engine, P1).length, hand - 1);
  assert.equal(zoneOf(g.engine, g.id("cr")), "discard");
});

clause(CHAIN, "1:rule", "a picked character takes exactly 2 damage; one that survives (life 3) triggers nothing further", () => {
  const g = chainBoard();
  const oppInf = influenceOf(g.engine, P2);
  const hand = handOf(g.engine, P1).length;
  chainFull(g, "tough");
  assert.equal(cardOf(g.engine, g.id("tough")).damage, 2);
  assert.equal(zoneOf(g.engine, g.id("tough")), "play", "life 3 survives 2 damage");
  assert.equal(influenceOf(g.engine, P2), oppInf, "no damage to the opponent");
  assert.equal(handOf(g.engine, P1).length, hand - 1, "no card drawn");
});

clause(CHAIN, "1:rule", "a picked character destroyed by the 2 damage: 1 damage to an opponent (their influence -1) and I draw a card", () => {
  const g = chainBoard();
  const oppInf = influenceOf(g.engine, P2);
  const myInf = influenceOf(g.engine, P1);
  const top = deckOf(g.engine, P1)[0];
  const hand = handOf(g.engine, P1).length;
  chainFull(g, "weak");
  assert.equal(zoneOf(g.engine, g.id("weak")), "discard", "destroyed");
  assert.equal(influenceOf(g.engine, P2), oppInf - 1, "exactly 1 damage to the opponent");
  assert.equal(influenceOf(g.engine, P1), myInf);
  assert.equal(handOf(g.engine, P1).length, hand, "-1 tactic, +1 drawn");
  assert.equal(zoneOf(g.engine, top), "hand", "the top card of my deck");
});

clause(CHAIN, "1:rule", "my own character can be the pick too (2 damage kills my 1-life character: the opponent still takes 1 and I draw)", () => {
  const g = chainBoard();
  const oppInf = influenceOf(g.engine, P2);
  chainFull(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(influenceOf(g.engine, P2), oppInf - 1);
});

clause(CHAIN, "1:rule", "the picked character must be a character in play: an item, a location or a faction is refused", () => {
  const g = chainBoard();
  chainCast(g);
  const resolve = (ids: CardInstanceId[]) => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  refused(() => resolve([g.id("idol")]), "an item");
  refused(() => resolve([g.id("myLoc")]), "a location");
  refused(() => resolve([g.engine.state.players[P2].factionId!]), "a faction");
  assert.ok(pending(g.engine), "still open");
  resolve([g.id("weak")]);
  assert.equal(zoneOf(g.engine, g.id("weak")), "discard", "control: a character works");
});

clause(CHAIN, "1:rule", "the character pick is only offered if the location was destroyed by that damage (a surviving location offers none)", () => {
  const g = chainBoard({ locStructure: 4 });
  chainCast(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(CHAIN, "1:rule", "the cost is paid and the location picked when it is played; the damage waits for resolution", () => {
  const g = chainBoard();
  chainRaw(g);
  assert.equal(g.engine.state.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 0);
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("loc")), "discard");
});

clause(CHAIN, "2:flipUp", "FLIP UP: 1 [R]: face-down in play it flips up on my turn, pays exactly 1, and does the same thing", () => {
  const g = chainBoard({ zone: "facedown", rage: 2 });
  const before = ready(g.engine);
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("cr"), selected: { l: [g.id("loc")] }, variables: {} });
  resolvePendingResponses(g.engine);
  assert.equal(before - ready(g.engine) >= 1, true, "at least the FLIP UP cost was spent");
  assert.equal(cardOf(g.engine, g.id("cr")).faceDown === false || zoneOf(g.engine, g.id("cr")) === "discard", true, "it flipped up");
  assert.equal(zoneOf(g.engine, g.id("loc")), "discard", "3 damage destroyed the structure-3 location");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "and the character pick follows");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("weak")] });
  assert.equal(zoneOf(g.engine, g.id("weak")), "discard");
  assert.equal(zoneOf(g.engine, g.id("cr")), "discard", "the tactic ends in the discard pile");
});

clause(CHAIN, "2:flipUp", "FLIP UP pays 1 (the card may pay for itself): with spares at most 1 other resource is spent, and a lone face-down card + spent [R] is enough", () => {
  const g = chainBoard({ zone: "facedown", rage: 3, locStructure: 5 });
  const others = (e: SpoilsEngine) => e.getAvailableResourceIds(P1).filter((id) => id !== g.id("cr")).length;
  const before = others(g.engine);
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("cr"), selected: { l: [g.id("loc")] }, variables: {} });
  const spentNow = before - others(g.engine);
  assert.ok(spentNow === 0 || spentNow === 1, `no more than 1 resource is paid, got ${spentNow}`);
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 3, "it resolved");
  const solo = devBoard([
    { key: "cr", def: printing(CHAIN), owner: P1, zone: "play", faceDown: true },
    { key: "loc", def: location({ name: "Target Loc", structure: 5 }), owner: P2, zone: "play" },
    ...bank("rage", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  ]);
  assert.equal(ready(solo.engine), 1, "only the face-down card is ready");
  flipUpNow(solo.engine, { type: "flipUp", playerId: P1, cardId: solo.id("cr"), selected: { l: [solo.id("loc")] }, variables: {} });
  assert.equal(cardOf(solo.engine, solo.id("loc")).damage, 3, "the card paid its own FLIP UP cost of 1; the spent [R] met the threshold");
});

clause(CHAIN, "2:flipUp", "FLIP UP needs an [R] icon after flipping: without Rage it is refused (nothing paid), with one Rage it works", () => {
  const g = chainBoard({ zone: "facedown", rage: 0, extra: res({ greed: 3 }) });
  const before = ready(g.engine);
  refused(() => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("cr"), selected: { l: [g.id("loc")] }, variables: {} }), "no [R] icon");
  assert.equal(cardOf(g.engine, g.id("cr")).faceDown, true);
  assert.equal(ready(g.engine), before, "nothing paid");
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
  const ok = chainBoard({ zone: "facedown", rage: 1 });
  flipUpNow(ok.engine, { type: "flipUp", playerId: P1, cardId: ok.id("cr"), selected: { l: [ok.id("loc")] }, variables: {} });
  assert.equal(zoneOf(ok.engine, ok.id("loc")), "discard");
});

clause(CHAIN, "2:flipUp", "FLIP UP keeps the extra cost: it needs a location pick, and not a character", () => {
  const g = chainBoard({ zone: "facedown", rage: 2 });
  refused(() => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("cr"), selected: {}, variables: {} }), "no pick");
  refused(() => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("cr"), selected: { l: [g.id("weak")] }, variables: {} }), "a character instead of a location");
  assert.equal(cardOf(g.engine, g.id("cr")).faceDown, true);
  assert.equal(ready(g.engine), 3, "nothing paid (2 Rage + the face-down card)");
});

clause(CHAIN, "2:flipUp", "as a tactic it can be flipped up in an opponent's response window too (the same timing as playing it)", () => {
  const g = chainBoard({ zone: "facedown", rage: 2, turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 6 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("cr"), selected: { l: [g.id("loc")] }, variables: {} });
  assert.equal(zoneOf(g.engine, g.id("loc")), "discard");
});

// =============================================================================
// Chirophobia — resource, arcanist, cost 0
// PROVIDES: [O]
// DISTRACTION -- COST: Pay 3. Pick a tactic in your discard pile. Destroy this card. -- EFFECT: Put the tactic into your hand.
// =============================================================================

const CHIRO = "a03da9a8-2d5b-45ac-8283-6d6d676be0b7";

function chiroBoard(o: { chiro?: Zone | "facedown"; ready?: number; spent?: number; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "ch", def: printing(CHIRO), owner: P1, zone: o.chiro === "facedown" ? "play" : (o.chiro ?? "play"), ...(o.chiro === "facedown" ? { faceDown: true } : {}) },
      { key: "tac", def: cantrip("Dead Tactic", 1), owner: P1, zone: "discard" },
      { key: "tac2", def: cantrip("Dead Tactic Two", 1), owner: P1, zone: "discard" },
      { key: "dchar", def: character({ name: "Dead Char" }), owner: P1, zone: "discard" },
      { key: "otac", def: cantrip("Their Dead Tactic", 1), owner: P2, zone: "discard" },
      { key: "htac", def: cantrip("Hand Tactic", 1), owner: P1, zone: "hand" },
      { key: "dtac", def: cantrip("Deck Tactic", 1), owner: P1, zone: "deck" },
      ...bank("rage", o.ready ?? 3, P1),
      ...bank("rage", o.spent ?? 0, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}
type ChiBoard = ReturnType<typeof chiroBoard>;
const distract = (g: ChiBoard, key = "tac") => activate(g.engine, P1, g.id("ch"), "distraction", { selected: { t: [g.id(key)] } });
const distractRaw = (g: ChiBoard, key = "tac") => actRaw(g.engine, P1, g.id("ch"), "distraction", { t: [g.id(key)] });

clause(CHIRO, "0:provides", "a non-staple resource that provides exactly one [O] (and nothing else)", () => {
  const g = chiroBoard({ ready: 0 });
  const t = g.engine.getThresholds(P1) as Record<string, number>;
  assert.equal(t.obsession, 1);
  for (const icon of ["rage", "greed", "deception", "elitism", "volition"]) assert.equal(t[icon] ?? 0, 0, `no ${icon}`);
  const p = printing(CHIRO);
  assert.equal(p.type, "resource");
  assert.equal(p.trade, "arcanist");
  assert.equal(p.cost, 0);
  assert.equal(p.resource?.staple, false);
  assert.deepEqual(p.resource?.provides, ["obsession"]);
  const needsO = character({ name: "NeedsO", cost: 0, threshold: "o" as never });
  const withIt = chiroBoard({ extra: [{ key: "need", def: needsO, owner: P1, zone: "hand" }] });
  play(withIt.engine, P1, withIt.id("need"));
  assert.equal(zoneOf(withIt.engine, withIt.id("need")), "play", "its [O] meets a threshold");
});

clause(CHIRO, "1:ability:distraction", "pays exactly 3, destroys Chirophobia and puts the picked tactic from my discard pile into my hand", () => {
  const g = chiroBoard({ ready: 3 });
  const before = ready(g.engine);
  distract(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("tac")), "hand", "the tactic is in my hand");
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard", "Chirophobia was destroyed");
  assert.equal(zoneOf(g.engine, g.id("tac2")), "discard", "the other tactic stays");
  assert.equal(before - ready(g.engine) >= 3, true);
});

clause(CHIRO, "1:ability:distraction", "Pay 3 is paid by OTHER resources: with Chirophobia as one of only three resources the cost is short (it is destroyed as part of the cost)", () => {
  const short = chiroBoard({ ready: 2 });
  assert.equal(ready(short.engine), 3, "control: three ready resources counting Chirophobia");
  refused(() => distractRaw(short), "only 2 other resources");
  assert.equal(zoneOf(short.engine, short.id("ch")), "play");
  assert.equal(zoneOf(short.engine, short.id("tac")), "discard");
  const ok = chiroBoard({ ready: 3 });
  distract(ok);
  assert.equal(zoneOf(ok.engine, ok.id("tac")), "hand");
});

clause(CHIRO, "1:ability:distraction", "the 3 resources paid are other resources: exactly 3 of the others become spent, with spares left over", () => {
  const g = chiroBoard({ ready: 5 });
  distract(g);
  assert.equal(ready(g.engine), 2, "5 others - 3 paid; Chirophobia itself is gone");
});

clause(CHIRO, "1:ability:distraction", "spent (attached) resources cannot pay the 3", () => {
  const g = chiroBoard({ ready: 2, spent: 3 });
  refused(() => distractRaw(g), "two ready others, three spent");
  assert.equal(zoneOf(g.engine, g.id("tac")), "discard");
});

clause(CHIRO, "1:ability:distraction", "the pick must be a TACTIC in MY discard pile: a character, a tactic in the opponent's discard pile, in my hand or deck are refused; no pick is refused", () => {
  for (const key of ["dchar", "otac", "htac", "dtac"]) {
    const g = chiroBoard({ ready: 4 });
    refused(() => distractRaw(g, key), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("ch")), "play", "not destroyed");
    assert.equal(ready(g.engine), 5, "nothing paid");
  }
  const none = chiroBoard({ ready: 4 });
  refused(() => actRaw(none.engine, P1, none.id("ch"), "distraction", {}), "no pick");
  const two = chiroBoard({ ready: 4 });
  refused(() => actRaw(two.engine, P1, two.id("ch"), "distraction", { t: [two.id("tac"), two.id("tac2")] }), "two picks");
  const noTactics = devBoard([{ key: "ch", def: printing(CHIRO), owner: P1, zone: "play" }, ...res({ rage: 4 })]);
  refused(() => actRaw(noTactics.engine, P1, noTactics.id("ch"), "distraction", {}), "no tactic in the discard pile");
});

clause(CHIRO, "1:ability:distraction", "each tactic can be picked: the second one works as well", () => {
  const g = chiroBoard({ ready: 4 });
  distract(g, "tac2");
  assert.equal(zoneOf(g.engine, g.id("tac2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("tac")), "discard");
});

clause(CHIRO, "1:ability:distraction", "the cost (Pay 3, destroy this card) is paid when the ability is used, before the opponent can respond", () => {
  const g = chiroBoard({ ready: 4 });
  distractRaw(g);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard", "Chirophobia is already destroyed");
  assert.equal(zoneOf(g.engine, g.id("tac")), "discard", "the tactic is not in hand until it resolves");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("tac")), "hand");
});

clause(CHIRO, "1:ability:distraction", "it works only while Chirophobia is face-up in play: face-down or in hand it has no ability", () => {
  const down = chiroBoard({ chiro: "facedown", ready: 4 });
  refused(() => distractRaw(down), "a face-down card has no abilities", /cannot be activated|Activated ability not found/);
  const inHand = chiroBoard({ chiro: "hand", ready: 4 });
  refused(() => distractRaw(inHand), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("tac")), "discard");
});

clause(CHIRO, "1:ability:distraction", "the picked tactic can be played again afterwards from my hand", () => {
  const g = chiroBoard({ ready: 5, extra: res({ obsession: 2 }) });
  distract(g);
  play(g.engine, P1, g.id("tac"));
  assert.equal(zoneOf(g.engine, g.id("tac")), "discard", "it resolved again");
});


// @@END@@
