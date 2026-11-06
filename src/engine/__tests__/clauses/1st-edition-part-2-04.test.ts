// Clause tests — batch 1st-edition-part-2-04. See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-part-2-04`. Expectations come from
// each card's PRINTED text and RULES.md / the Comprehensive Rules; engine data is
// only used to drive the engine.

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
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused } from "./_clause.js";
import { battleOf, declareAttackBy, playRaw } from "./_battle.js";
import { fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { developDraw, developResource, endTurn, spentResources, developDrawLeft } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);

/** Raw `activateAbility` without draining the response window. */
function activateRaw(
  engine: SpoilsEngine,
  player: Pid,
  cardId: string,
  abilityId: string,
  selected: Record<string, string[]> = {},
  variables: Record<string, number> = {}
) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

const hand = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const stat = (engine: SpoilsEngine, cardId: string) => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "life"),
  engine.getStat(cardId, "speed")
];

/** Passes priority for whoever holds it until `player` holds it (or the window closes). */
function passUntil(engine: SpoilsEngine, player: Pid) {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player && !engine.state.pendingChoice) {
    if (++guard > 50) throw new Error("passUntil did not converge");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

/** Answers the open `chooserSelectsTarget` with `selected` and lets the game continue. */
function pick(engine: SpoilsEngine, player: Pid, selected: string[]) {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
  developDrawLeft(engine, player); // a turn start's Develop Rule is offered once the card's pick is done: skip it
}

/** Same as `pick` but without draining responses (for refusal checks). */
function pickRaw(engine: SpoilsEngine, player: Pid, selected: string[]) {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
}

/** Answers the open `chooserSelectsOption` by option label pattern. */
function chooseOption(engine: SpoilsEngine, player: Pid, label: RegExp) {
  const pc = pending(engine) as unknown as { kind: string; options: Array<{ label?: string }> } | undefined;
  assert.ok(pc, "a pending choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  const index = pc.options.findIndex((o) => label.test(o.label ?? ""));
  assert.ok(index >= 0, `an option matching ${label}`);
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(engine);
}

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A free tactic that deals `amount` damage to one chosen card (character or location; id `zap`, declaration `t`). */
function zapTactic(amount: number, name = "Zap"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic with no targets and no effect (just "a card was played"). */
const blankTactic = (name = "Blank"): CardDefinition => tactic({ name, cost: 0, behavior: { abilities: [{ id: "blank", type: "activated", effects: [] }] } });

/** A free tactic that grants `keyword` to one chosen character until end of turn (id `grant`, declaration `t`). */
function grantTactic(keyword: "covert"): CardDefinition {
  return tactic({
    name: `Grant ${keyword}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grant",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

/** A covert character with the given name. */
const covertChar = (name: string, over: Partial<CardDefinition> = {}): CardDefinition =>
  character({ name, behavior: { keywords: ["covert"] }, ...over });

/**
 * Deploy-cost checks shared by every card: a card with printed cost `cost` and
 * threshold `iconCount` x `icon` is deployed for exactly `cost` resources when the
 * threshold is met; the threshold is a gate (icons are never spent).
 */
interface DeploySpec {
  printingId: string;
  cost: number;
  icon: StapleIcon;
  iconCount: number;
  /** Extra placements (hosts, etc.) and the `selected` to pass when playing. */
  extra?: CardPlacement[];
  selected?: (id: (key: string) => CardInstanceId) => Record<string, CardInstanceId[]>;
  /** Where the card ends up on resolution (default "play"). */
  ends?: "play" | "discard";
  activePlayer?: Pid;
}

function deployBoard(spec: DeploySpec, main: number, others: number) {
  const otherIcon: StapleIcon = spec.icon === "greed" ? "rage" : "greed";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "card", def: printing(spec.printingId), owner: P1, zone: "hand" },
      ...(spec.extra ?? []),
      ...bank(spec.icon, main, P1),
      ...bank(otherIcon, others, P1)
    ]
  });
}

function deployExact(spec: DeploySpec) {
  const need = Math.max(spec.cost, spec.iconCount);
  const { engine, id } = deployBoard(spec, need, 0);
  assert.equal(engine.getCardPlayability(P1, id("card")).playable, true, "playable with exactly enough resources and icons");
  const before = ready(engine);
  play(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {} });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("card")), spec.ends ?? "play");
  assert.equal(before - ready(engine), spec.cost, `the printed cost of ${spec.cost} is paid`);
}

function deployShort(spec: DeploySpec) {
  const need = Math.max(spec.cost, spec.iconCount);
  const { engine, id } = deployBoard(spec, need - 1, 0);
  assert.equal(engine.getCardPlayability(P1, id("card")).playable, false, "one resource short: not playable");
  const before = ready(engine);
  refused(() => playRaw(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {} }), "one resource short of the cost / threshold");
  assert.equal(zoneOf(engine, id("card")), "hand", "a refused play leaves the card in hand");
  assert.equal(ready(engine), before, "nothing was paid");
}

function deployWrongIcons(spec: DeploySpec) {
  const { engine, id } = deployBoard(spec, 0, spec.cost + spec.iconCount + 4);
  assert.equal(engine.getCardPlayability(P1, id("card")).thresholdMet, false, "no matching icons: the threshold is not met");
  refused(() => playRaw(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {} }), "plenty of resources of the wrong icon");
  assert.equal(zoneOf(engine, id("card")), "hand");
}

function deployIconShort(spec: DeploySpec) {
  const { engine, id } = deployBoard(spec, spec.iconCount - 1, spec.cost + spec.iconCount + 4);
  assert.equal(engine.getCardPlayability(P1, id("card")).thresholdMet, false, "one icon short of the threshold");
  refused(() => playRaw(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {} }), "one icon short of the threshold, with plenty of other resources");
  assert.equal(zoneOf(engine, id("card")), "hand");
}

function deployThresholdIsAGate(spec: DeploySpec) {
  // the icons are never spent: with exactly the icons needed AND extra resources, the icons stay available afterwards
  const { engine, id } = deployBoard(spec, spec.iconCount + spec.cost, 0);
  play(engine, P1, id("card"), { selected: spec.selected?.(id) ?? {} });
  drain(engine, declineAll);
  assert.equal(ready(engine), spec.iconCount, "only the numeric cost is spent; the threshold icons are a gate");
}

// ===============================================================================
// Guardforce Morphmajig
// This card can attack even if it has not been in play under your control since the
// start of the turn. -- If you play a card, put a token on this card. (Playing a
// resource doesn't count.) -- If your opponent plays a card, remove a token from this
// card. -- This card gains 1 strength and 1 life for each token on it.
// Character (guardforce, majig), cost 5, threshold [E][E], 3/3/3.
// ===============================================================================

const GM = "6af508e9-b4a9-473d-80fc-4c1ecbdd5781";

function gmBoard(opts: { gm?: "play" | "hand"; tokens?: number; active?: Pid; eligible?: boolean; elitism?: number; damage?: number; depleted?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      {
        key: "gm",
        def: printing(GM),
        owner: P1,
        zone: opts.gm ?? "play",
        counters: opts.tokens ? { token: opts.tokens } : {},
        attackEligible: opts.eligible,
        damage: opts.damage,
        depleted: opts.depleted
      },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "hand" },
      { key: "i1", def: item({ name: "I1" }), owner: P1, zone: "hand" },
      { key: "l1", def: location({ name: "L1" }), owner: P1, zone: "hand" },
      { key: "t1", def: blankTactic("T1"), owner: P1, zone: "hand" },
      { key: "t2", def: blankTactic("T2"), owner: P1, zone: "hand" },
      { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "hand" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "hand" },
      { key: "oc1", def: character({ name: "OC1" }), owner: P2, zone: "hand" },
      { key: "oi1", def: item({ name: "OI1" }), owner: P2, zone: "hand" },
      { key: "ol1", def: location({ name: "OL1" }), owner: P2, zone: "hand" },
      { key: "ot1", def: blankTactic("OT1"), owner: P2, zone: "hand" },
      { key: "ot2", def: blankTactic("OT2"), owner: P2, zone: "hand" },
      { key: "or1", def: resourceCard({ name: "OR1" }), owner: P2, zone: "hand" },
      { key: "od1", def: character({ name: "OD1" }), owner: P2, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const attackRaw = (engine: SpoilsEngine, player: Pid, attackerIds: string[]) =>
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target: { type: "faction", playerId: other(player) } });

clause(GM, "0:rule", "has the AGGRO keyword and an ordinary character does not", () => {
  const { engine, id } = gmBoard();
  assert.ok(engine.getKeywords(id("gm")).includes("aggro"), "engine.getKeywords(id(\"gm\")).includes(\"aggro\")");
  assert.equal(engine.getKeywords(id("mine")).includes("aggro"), false, "control: an ordinary character has no aggro");
});

clause(GM, "0:rule", "can attack even though it has not been in play under your control since the start of the turn (an ordinary character in the same position cannot)", () => {
  const { engine, id } = gmBoard({ eligible: false, extra: [{ key: "newbie", def: character({ name: "Newbie" }), owner: P1, zone: "play", attackEligible: false }] });
  refused(() => attackRaw(engine, P1, [id("newbie")]), "control: a character that has not been in play since the start of the turn cannot attack");
  assert.equal(battleOf(engine), undefined, "the refused attack started no battle");
  declareAttackBy(engine, P1, [id("gm")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("gm")], "the Morphmajig attacks");
  assert.equal(engine.state.cards[id("gm")].depleted, true, "declaring an attack depletes it as usual");
});

clause(GM, "0:rule", "deployed from your hand this turn, it can attack at once; another character deployed the same turn cannot", () => {
  const { engine, id } = gmBoard({ gm: "hand" });
  play(engine, P1, id("gm"));
  play(engine, P1, id("c1"));
  assert.equal(zoneOf(engine, id("gm")), "play");
  assert.equal(zoneOf(engine, id("c1")), "play");
  refused(() => attackRaw(engine, P1, [id("c1")]), "control: a character deployed this turn cannot attack");
  declareAttackBy(engine, P1, [id("gm")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("gm")]);
});

clause(GM, "0:rule", "can attack together with other eligible characters in one party", () => {
  const { engine, id } = gmBoard({ eligible: false });
  declareAttackBy(engine, P1, [id("gm"), id("mine")]);
  assert.deepEqual([...(battleOf(engine)?.attackingParty ?? [])].sort(), [id("gm"), id("mine")].sort());
});

clause(GM, "0:rule", "the haste only waives the 'since the start of the turn' requirement: a depleted Morphmajig still cannot attack", () => {
  const { engine, id } = gmBoard({ eligible: false, depleted: true });
  refused(() => attackRaw(engine, P1, [id("gm")]), "depleted characters cannot attack");
  assert.equal(battleOf(engine), undefined);
});

clause(GM, "0:rule", "the haste is only for the Morphmajig itself: it does not let another character in the party skip the requirement", () => {
  const { engine, id } = gmBoard({ eligible: false, extra: [{ key: "newbie", def: character({ name: "Newbie" }), owner: P1, zone: "play", attackEligible: false }] });
  refused(() => attackRaw(engine, P1, [id("gm"), id("newbie")]), "the new character cannot join the attack", /did not start the turn in play/);
  assert.equal(battleOf(engine), undefined);
});

// 1:rule — If you play a card, put a token on this card.

const playOne = (key: string) => (b: ReturnType<typeof gmBoard>) => play(b.engine, P1, b.id(key));

for (const [key, label] of [
  ["c1", "a character"],
  ["i1", "an item"],
  ["l1", "a location"],
  ["t1", "a tactic"]
] as const) {
  clause(GM, "1:rule", `playing ${label} puts exactly one token on the Morphmajig`, () => {
    const b = gmBoard();
    assert.equal(tokensOn(b.engine, b.id("gm")), 0);
    playOne(key)(b);
    assert.equal(zoneOf(b.engine, b.id(key)), key === "t1" ? "discard" : "play", "the card was really played");
    assert.equal(tokensOn(b.engine, b.id("gm")), 1);
  });
}

clause(GM, "1:rule", "every card you play adds another token: three plays make three tokens", () => {
  const b = gmBoard();
  play(b.engine, P1, b.id("c1"));
  play(b.engine, P1, b.id("i1"));
  play(b.engine, P1, b.id("t1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 3);
});

clause(GM, "1:rule", "the token is put on as the card is played, before the opponent responds", () => {
  const b = gmBoard();
  playRaw(b.engine, P1, b.id("c1"));
  assert.equal(b.engine.state.cards[b.id("c1")].zone !== "hand", true, "the card is being played");
  assert.equal(tokensOn(b.engine, b.id("gm")), 1, "already one token while the opponent may still respond");
});

clause(GM, "1:rule", "playing a resource does not count: neither a face-up resource nor a face-down card gives a token", () => {
  const b = gmBoard();
  developResource(b.engine, P1, b.id("r1"), false);
  assert.equal(zoneOf(b.engine, b.id("r1")), "play");
  assert.equal(tokensOn(b.engine, b.id("gm")), 0, "a face-up resource is not 'a card played'");
  const c = gmBoard();
  developResource(c.engine, P1, c.id("d1"), true);
  assert.equal(c.engine.state.cards[c.id("d1")].faceDown, true);
  assert.equal(tokensOn(c.engine, c.id("gm")), 0, "a face-down resource is not 'a card played'");
});

clause(GM, "1:rule", "using an ability is not playing a card: no token", () => {
  const ping = item({ name: "Ping", behavior: { abilities: [{ id: "ping", type: "activated", effects: [] }] } });
  const b = gmBoard({ extra: [{ key: "ping", def: ping, owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("ping"), "ping");
  assert.equal(tokensOn(b.engine, b.id("gm")), 0);
  play(b.engine, P1, b.id("c1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 1, "control: playing a card still gives a token");
});

clause(GM, "1:rule", "a card put into play by an effect is not 'played': no token (CR 402.8)", () => {
  const dropper = item({
    name: "Dropper",
    behavior: {
      abilities: [
        {
          id: "drop",
          type: "activated",
          targets: [{ id: "h", selector: { zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "h" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = gmBoard({ extra: [{ key: "dropper", def: dropper, owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("dropper"), "drop", { selected: { h: [b.id("c1")] } });
  assert.equal(zoneOf(b.engine, b.id("c1")), "play", "the character was put into play");
  assert.equal(tokensOn(b.engine, b.id("gm")), 0, "put into play is not played");
});

clause(GM, "1:rule", "when the Morphmajig itself is played it is not in play yet, so it gets no token and has its printed stats", () => {
  const b = gmBoard({ gm: "hand" });
  play(b.engine, P1, b.id("gm"));
  assert.equal(zoneOf(b.engine, b.id("gm")), "play");
  assert.equal(tokensOn(b.engine, b.id("gm")), 0);
  assert.deepEqual(stat(b.engine, b.id("gm")), [3, 3, 3]);
  play(b.engine, P1, b.id("c1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 1, "control: the next card played gives a token");
});

clause(GM, "1:rule", "a Morphmajig still in your hand collects no tokens", () => {
  const b = gmBoard({ gm: "hand" });
  play(b.engine, P1, b.id("c1"));
  play(b.engine, P1, b.id("t1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 0);
});

clause(GM, "1:rule", "each Morphmajig you control gets its own token", () => {
  const b = gmBoard({ extra: [{ key: "gm2", def: printing(GM), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("c1"));
  drain(b.engine, declineAll); // two copies of the same trigger ask for an order
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(b.engine, b.id("gm")), 1);
  assert.equal(tokensOn(b.engine, b.id("gm2")), 1);
});

clause(GM, "1:rule", "'you' is the controller: a Morphmajig you control but the opponent owns gets the token when you play a card", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "gm", def: printing(GM), owner: P2, controller: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "hand" },
      { key: "oc1", def: character({ name: "OC1" }), owner: P2, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("c1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 1, "its controller played a card");
});

clause(GM, "1:rule", "the opponent's own Morphmajig gains a token when ITS controller plays a card, and yours does not", () => {
  const b = gmBoard({
    active: P2,
    extra: [{ key: "ogm", def: printing(GM), owner: P2, zone: "play" }]
  });
  play(b.engine, P2, b.id("oc1"));
  drain(b.engine, declineAll); // both Morphmajigs trigger: the active player orders them
  assert.equal(tokensOn(b.engine, b.id("ogm")), 1, "the opponent's Morphmajig gets a token from the opponent's play");
  assert.equal(tokensOn(b.engine, b.id("gm")), 0, "mine got no token (the opponent's play does not add one to mine)");
});

clause(GM, "1:rule", "a card you play in response during the opponent's turn gives a token as well", () => {
  const b = gmBoard({ active: P2, tokens: 2 });
  playRaw(b.engine, P2, b.id("oc1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 1, "the opponent's play removed one");
  playRaw(b.engine, P1, b.id("t1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 2, "my response put one back");
});

// 2:rule — If your opponent plays a card, remove a token from this card.

for (const [key, label] of [
  ["oc1", "a character"],
  ["oi1", "an item"],
  ["ol1", "a location"],
  ["ot1", "a tactic"]
] as const) {
  clause(GM, "2:rule", `the opponent playing ${label} removes exactly one token`, () => {
    const b = gmBoard({ active: P2, tokens: 3 });
    play(b.engine, P2, b.id(key));
    assert.equal(zoneOf(b.engine, b.id(key)), key === "ot1" ? "discard" : "play", "the card was really played");
    assert.equal(tokensOn(b.engine, b.id("gm")), 2);
  });
}

clause(GM, "2:rule", "each card the opponent plays removes another token", () => {
  const b = gmBoard({ active: P2, tokens: 3 });
  play(b.engine, P2, b.id("oc1"));
  play(b.engine, P2, b.id("ot1"));
  play(b.engine, P2, b.id("oi1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 0);
});

clause(GM, "2:rule", "with no tokens there is nothing to remove: the count stays at 0 and never goes negative", () => {
  const b = gmBoard({ active: P2, tokens: 0 });
  play(b.engine, P2, b.id("oc1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 0);
  assert.deepEqual(stat(b.engine, b.id("gm")), [3, 3, 3]);
});

clause(GM, "2:rule", "the opponent playing a resource does not remove a token (face-up and face-down)", () => {
  const b = gmBoard({ active: P2, tokens: 2 });
  developResource(b.engine, P2, b.id("or1"), false);
  assert.equal(zoneOf(b.engine, b.id("or1")), "play");
  assert.equal(tokensOn(b.engine, b.id("gm")), 2, "a face-up resource is not 'a card played'");
  const c = gmBoard({ active: P2, tokens: 2 });
  developResource(c.engine, P2, c.id("od1"), true);
  assert.equal(c.engine.state.cards[c.id("od1")].faceDown, true);
  assert.equal(tokensOn(c.engine, c.id("gm")), 2, "a face-down resource is not 'a card played'");
});

clause(GM, "2:rule", "playing a card yourself does not remove a token (you gain one)", () => {
  const b = gmBoard({ tokens: 2 });
  play(b.engine, P1, b.id("c1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 3);
});

clause(GM, "2:rule", "a tactic the opponent plays in response during your turn removes a token", () => {
  const b = gmBoard({ tokens: 2 });
  playRaw(b.engine, P1, b.id("c1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 3, "my play added one");
  playRaw(b.engine, P2, b.id("ot1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 2, "the opponent's response removed one");
  resolvePendingResponses(b.engine);
  assert.equal(tokensOn(b.engine, b.id("gm")), 2);
});

clause(GM, "2:rule", "things the opponent merely does without playing a card (ability, putting a card into play) remove nothing", () => {
  const ping = item({
    name: "OppPing",
    behavior: {
      abilities: [
        { id: "ping", type: "activated", effects: [] },
        {
          id: "drop",
          type: "activated",
          targets: [{ id: "h", selector: { zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "h" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = gmBoard({ active: P2, tokens: 2, extra: [{ key: "oping", def: ping, owner: P2, zone: "play" }] });
  activate(b.engine, P2, b.id("oping"), "ping");
  assert.equal(tokensOn(b.engine, b.id("gm")), 2, "an ability is not a card played");
  activate(b.engine, P2, b.id("oping"), "drop", { selected: { h: [b.id("oc1")] } });
  assert.equal(zoneOf(b.engine, b.id("oc1")), "play");
  assert.equal(tokensOn(b.engine, b.id("gm")), 2, "put into play is not played");
});

clause(GM, "2:rule", "every Morphmajig you control loses a token when the opponent plays a card", () => {
  const b = gmBoard({ active: P2, tokens: 2, extra: [{ key: "gm2", def: printing(GM), owner: P1, zone: "play", counters: { token: 1 } }] });
  play(b.engine, P2, b.id("oc1"));
  drain(b.engine, declineAll); // two copies of the same trigger ask for an order
  assert.equal(tokensOn(b.engine, b.id("gm")), 1);
  assert.equal(tokensOn(b.engine, b.id("gm2")), 0);
});

clause(GM, "2:rule", "the opponent's own Morphmajig is not hurt by the opponent's plays (only mine is)", () => {
  const b = gmBoard({
    active: P2,
    tokens: 2,
    extra: [{ key: "ogm", def: printing(GM), owner: P2, zone: "play", counters: { token: 2 } }]
  });
  play(b.engine, P2, b.id("oc1"));
  drain(b.engine, declineAll); // both Morphmajigs trigger: the active player orders them
  assert.equal(tokensOn(b.engine, b.id("gm")), 1, "mine loses one");
  assert.equal(tokensOn(b.engine, b.id("ogm")), 3, "theirs gains one");
});

// 3:rule — This card gains 1 strength and 1 life for each token on it.

for (const n of [0, 1, 2, 5]) {
  clause(GM, "3:rule", `with ${n} token(s) it is ${3 + n}/${3 + n}/3: +${n} strength and +${n} life, speed unchanged`, () => {
    const { engine, id } = gmBoard({ tokens: n });
    assert.deepEqual(stat(engine, id("gm")), [3 + n, 3 + n, 3]);
  });
}

clause(GM, "3:rule", "only tokens count: other kinds of counters add nothing", () => {
  const { engine, id } = gmBoard({ extra: [{ key: "gm2", def: printing(GM), owner: P1, zone: "play", counters: { charge: 3, token: 1 } }] });
  assert.deepEqual(stat(engine, id("gm2")), [4, 4, 3], "one token, three charge counters: +1/+1 only");
});

clause(GM, "3:rule", "only the Morphmajig's own tokens count: another character's tokens give it nothing, and the Morphmajig's tokens buff nobody else", () => {
  const { engine, id } = gmBoard({
    tokens: 2,
    extra: [{ key: "tok", def: character({ name: "Tok", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play", counters: { token: 3 } }]
  });
  assert.deepEqual(stat(engine, id("tok")), [2, 2, 2], "a plain character with tokens is unchanged");
  assert.deepEqual(stat(engine, id("mine")), [1, 6, 1], "my other character is unchanged");
  assert.deepEqual(stat(engine, id("foe")), [1, 6, 1], "the opponent's character is unchanged");
  assert.deepEqual(stat(engine, id("gm")), [5, 5, 3]);
});

clause(GM, "3:rule", "the bonus follows the token count as tokens come and go: +1/+1 for a card you play, -1/-1 for a card the opponent plays", () => {
  const b = gmBoard({ tokens: 1 });
  assert.deepEqual(stat(b.engine, b.id("gm")), [4, 4, 3]);
  play(b.engine, P1, b.id("c1"));
  assert.deepEqual(stat(b.engine, b.id("gm")), [5, 5, 3], "a played card: +1/+1");
  const c = gmBoard({ active: P2, tokens: 2 });
  assert.deepEqual(stat(c.engine, c.id("gm")), [5, 5, 3]);
  play(c.engine, P2, c.id("oc1"));
  assert.deepEqual(stat(c.engine, c.id("gm")), [4, 4, 3], "an opponent's played card: -1/-1");
});

clause(GM, "3:rule", "the life bonus is real life: a token lets it survive damage that would kill it without one", () => {
  // playing the Zap tactic itself puts a token on the Morphmajig (+1 life) before the damage lands
  const kill = gmBoard({ extra: [{ key: "zap", def: zapTactic(4), owner: P1, zone: "hand" }] });
  play(kill.engine, P1, kill.id("zap"), { selected: { t: [kill.id("gm")] } });
  assert.equal(tokensOn(kill.engine, kill.id("gm")), 0, "the token from playing Zap vanished when it left play (CR 409.2)");
  assert.equal(zoneOf(kill.engine, kill.id("gm")), "discard", "control: 4 damage kills the 4-life Morphmajig (3 life + the token from playing Zap)");
  const live = gmBoard({ tokens: 1, extra: [{ key: "zap", def: zapTactic(4), owner: P1, zone: "hand" }] });
  play(live.engine, P1, live.id("zap"), { selected: { t: [live.id("gm")] } });
  assert.equal(tokensOn(live.engine, live.id("gm")), 2);
  assert.equal(zoneOf(live.engine, live.id("gm")), "play", "with one more token it has 5 life and survives 4 damage");
  assert.equal(live.engine.state.cards[live.id("gm")].damage, 4);
});

clause(GM, "3:rule", "losing the last token drops the life bonus and a Morphmajig carrying enough damage is destroyed", () => {
  const b = gmBoard({ active: P2, tokens: 1, damage: 3 });
  assert.equal(zoneOf(b.engine, b.id("gm")), "play", "4 life with 3 damage: alive");
  play(b.engine, P2, b.id("oc1"));
  assert.equal(tokensOn(b.engine, b.id("gm")), 0);
  assert.equal(zoneOf(b.engine, b.id("gm")), "discard", "3 life with 3 damage: destroyed");
});

clause(GM, "3:rule", "tokens do not survive leaving play: a Morphmajig that was bounced and is played again has no tokens (CR 409.2)", () => {
  const b = gmBoard({ tokens: 2, extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("gm")] } });
  assert.equal(zoneOf(b.engine, b.id("gm")), "hand");
  play(b.engine, P1, b.id("gm"));
  assert.equal(zoneOf(b.engine, b.id("gm")), "play");
  assert.equal(tokensOn(b.engine, b.id("gm")), 0, "its old tokens are gone");
  assert.deepEqual(stat(b.engine, b.id("gm")), [3, 3, 3]);
});

clause(GM, "0:rule", "costs exactly 5 and needs [E][E]", () => deployExact({ printingId: GM, cost: 5, icon: "elitism", iconCount: 2 }));
clause(GM, "0:rule", "is refused one resource short of its cost of 5", () => deployShort({ printingId: GM, cost: 5, icon: "elitism", iconCount: 2 }));
clause(GM, "0:rule", "is refused without [E] even with plenty of other resources, and with only one [E]", () => {
  deployWrongIcons({ printingId: GM, cost: 5, icon: "elitism", iconCount: 2 });
  deployIconShort({ printingId: GM, cost: 5, icon: "elitism", iconCount: 2 });
});
clause(GM, "0:rule", "its printed stats are 3 strength, 3 life, 3 speed", () => {
  const { engine, id } = gmBoard();
  assert.deepEqual(stat(engine, id("gm")), [3, 3, 3]);
});

// ===============================================================================
// Heavy Plating
// ATTACH TO CHARACTER -- When this card enters play, you may detach up to 2 resources
// from your faction. -- The attached character gains 4 strength, 4 life, and loses 1
// speed. -- HANDOFF -- COST: Pay 5. Deplete a character you control that is not in a
// battle. -- EFFECT: Attach this card to the character.
// Item (gear), cost 6, threshold [E][E].
// ===============================================================================

const HP = "8dfc4763-6428-4c32-a5bd-366f65dd5b80";

interface HpOpts {
  hp?: "hand" | "play";
  host?: string;
  elitism?: number;
  greed?: number;
  /** Resources already spent (attached to the faction). */
  spent?: number;
  oppSpent?: number;
  withFaceDown?: boolean;
  turn?: number;
  active?: Pid;
  hostStats?: Partial<CardDefinition>;
  extra?: CardPlacement[];
}

function hpBoard(opts: HpOpts = {}) {
  const hpZone = opts.hp ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "hp", def: printing(HP), owner: P1, zone: hpZone, attachedToKey: hpZone === "play" ? opts.host ?? "mine" : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 3, ...opts.hostStats }), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "tired", def: character({ name: "Tired", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...(opts.withFaceDown ? [{ key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play" as const, faceDown: true }] : []),
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...spentResources(P1, opts.spent ?? 0),
      ...spentResources(P2, opts.oppSpent ?? 0),
      ...(opts.extra ?? [])
    ]
  });
}

const attachedTo = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].attachedTo;
const hpSpec: DeploySpec = {
  printingId: HP,
  cost: 6,
  icon: "elitism",
  iconCount: 2,
  extra: [{ key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" }],
  selected: (id) => ({ attachTo: [id("host")] })
};

clause(HP, "0:attach", "attaches to the character it is played on (yours or the opponent's); pays 6 and leaves the hand", () => {
  for (const hostKey of ["mine", "foe"] as const) {
    const { engine, id } = hpBoard();
    const before = ready(engine);
    play(engine, P1, id("hp"), { selected: { attachTo: [id(hostKey)] } });
    drain(engine, declineAll);
    assert.equal(zoneOf(engine, id("hp")), "play", "enters play");
    assert.equal(attachedTo(engine, id("hp")), id(hostKey), `attached to ${hostKey}`);
    assert.equal(engine.state.cards[id("hp")].controllerId, P1, "stays under its player's control, whoever the host belongs to");
    assert.equal(before - ready(engine), 6, "the printed cost of 6 is paid");
    assert.equal(hand(engine, P1).includes(id("hp")), false);
  }
});

clause(HP, "0:attach", "is refused for a host that is not a character (item, location, face-down card, faction) or with no host chosen", () => {
  const { engine, id } = hpBoard({ withFaceDown: true });
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("hp"), { selected: { attachTo: [hostId] } });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(id("faceDown")), "a face-down card is only a resource");
  refused(attempt(engine.state.players[P1].factionId!), "your faction");
  refused(attempt(engine.state.players[P2].factionId!), "the opponent's faction");
  refused(() => playRaw(engine, P1, id("hp"), { selected: {} }), "no host chosen");
  assert.equal(zoneOf(engine, id("hp")), "hand", "a refused play leaves the card in hand");
  assert.equal(ready(engine), 6, "nothing was paid");
  attempt(id("mate"))();
  assert.ok(engine.state.responseWindow, "a character host is accepted");
});

clause(HP, "0:attach", "costs exactly 6 and needs [E][E]", () => deployExact(hpSpec));
clause(HP, "0:attach", "is refused one resource short of its cost of 6", () => deployShort(hpSpec));
clause(HP, "0:attach", "is refused without [E] even with plenty of other resources, and with only one [E]", () => {
  deployWrongIcons(hpSpec);
  deployIconShort(hpSpec);
});
clause(HP, "0:attach", "the threshold icons are a gate, not spent: only the 6 is paid", () => deployThresholdIsAGate(hpSpec));

clause(HP, "0:attach", "when the host is destroyed the attached plating leaves play with it (to its owner's discard pile)", () => {
  const { engine, id } = hpBoard({ hp: "play", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("hp")), "discard", "attached cards leave play the same way their host does");
  assert.equal(discardOf(engine, P1).includes(id("hp")), true);
});

clause(HP, "0:attach", "when the host is returned to its owner's hand the attached plating follows it to its owner's hand (CR 301.4a)", () => {
  const { engine, id } = hpBoard({ hp: "play", extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.equal(zoneOf(engine, id("hp")), "hand", "it leaves play 'in the same way': put into its owner's hand");
  assert.equal(hand(engine, P1).includes(id("hp")), true);
});

clause(HP, "0:attach", "when the host is removed from the game the attached plating is removed from the game too (CR 301.4a)", () => {
  const remove = tactic({
    name: "Remove",
    cost: 0,
    behavior: { abilities: [{ id: "rm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = hpBoard({ hp: "play", extra: [{ key: "remove", def: remove, owner: P1, zone: "hand" }] });
  play(engine, P1, id("remove"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "removed");
  assert.equal(zoneOf(engine, id("hp")), "removed", "it leaves play 'in the same way': removed from the game");
});

clause(HP, "0:attach", "with no character in play there is no legal host, so it cannot be played", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "hp", def: printing(HP), owner: P1, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...bank("elitism", 6, P1)
    ]
  });
  refused(() => playRaw(b.engine, P1, b.id("hp"), { selected: {} }), "no host");
  refused(() => playRaw(b.engine, P1, b.id("hp"), { selected: { attachTo: [b.id("thing")] } }), "an item is no host");
  assert.equal(zoneOf(b.engine, b.id("hp")), "hand");
  assert.equal(ready(b.engine), 6, "nothing was paid");
});

clause(HP, "0:attach", "if its host stops being a character (flipped face-down) the plating is flipped face-down with it", () => {
  const flip = tactic({
    name: "FlipDown",
    cost: 0,
    behavior: { abilities: [{ id: "f", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = hpBoard({ hp: "play", extra: [{ key: "flip", def: flip, owner: P1, zone: "hand" }] });
  play(engine, P1, id("flip"), { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].faceDown, true, "the host is now a face-down resource");
  assert.equal(zoneOf(engine, id("hp")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(engine.state.cards[id("hp")].faceDown, true, "...and is flipped face-down along with its host");
});

// 1:rule — When this card enters play, you may detach up to 2 resources from your faction.

/** Plays the Plating onto `mine` and returns once the "may detach" prompt is open. */
function hpPlayToPrompt(opts: HpOpts = {}) {
  const b = hpBoard({ spent: 3, elitism: 6, ...opts });
  const before = ready(b.engine);
  play(b.engine, P1, b.id("hp"), { selected: { attachTo: [b.id("mine")] } });
  return { ...b, before };
}

clause(HP, "1:rule", "entering play offers the controller the choice to detach, before anything else happens", () => {
  const b = hpPlayToPrompt();
  assert.equal(zoneOf(b.engine, b.id("hp")), "play");
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the Plating's controller decides");
  assert.equal(ready(b.engine), 0, "the 6 paid for the Plating are spent; nothing has been detached yet");
});

clause(HP, "1:rule", "detaching 2: both chosen resources are detached from the faction and can be spent again", () => {
  const b = hpPlayToPrompt();
  const attached = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === b.engine.state.players[P1].factionId);
  assert.equal(attached.length, 9, "3 old + 6 just paid resources are attached to the faction");
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, attached.slice(0, 2));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 2, "exactly the two chosen resources are free again");
  for (const c of attached.slice(0, 2)) assert.equal(attachedTo(b.engine, c), undefined, "detached");
  for (const c of attached.slice(2)) assert.equal(attachedTo(b.engine, c), b.engine.state.players[P1].factionId, "the rest stay attached");
});

clause(HP, "1:rule", "detaching only 1 ('up to 2'): one resource is detached", () => {
  const b = hpPlayToPrompt();
  const attached = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === b.engine.state.players[P1].factionId);
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, [attached[0]]);
  assert.equal(ready(b.engine), 1);
});

clause(HP, "1:rule", "choosing to detach none (empty pick) detaches nothing", () => {
  const b = hpPlayToPrompt();
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, []);
  assert.equal(ready(b.engine), 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(HP, "1:rule", "declining ('may') detaches nothing and leaves the Plating attached and in play", () => {
  const b = hpPlayToPrompt();
  chooseOption(b.engine, P1, /decline/i);
  assert.equal(ready(b.engine), 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("hp")), "play");
  assert.equal(attachedTo(b.engine, b.id("hp")), b.id("mine"));
});

clause(HP, "1:rule", "more than 2 resources cannot be detached", () => {
  const b = hpPlayToPrompt();
  const attached = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === b.engine.state.players[P1].factionId);
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, attached.slice(0, 3)), "three resources is more than 'up to 2'");
  assert.equal(ready(b.engine), 0, "nothing was detached");
  pick(b.engine, P1, attached.slice(0, 2));
  assert.equal(ready(b.engine), 2, "control: two is fine");
});

clause(HP, "1:rule", "only resources can be picked: a character cannot be 'detached'", () => {
  const b = hpPlayToPrompt();
  const attached = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === b.engine.state.players[P1].factionId);
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, [b.id("mate")]), "a character is not a resource");
  refused(() => pickRaw(b.engine, P1, [attached[0], b.id("mate")]), "a resource plus a character");
  pick(b.engine, P1, [attached[0]]);
  assert.equal(ready(b.engine), 1, "control: a resource is fine");
});

clause(HP, "1:rule", "only YOUR faction's resources: the opponent's spent resources cannot be picked", () => {
  const b = hpBoard({ spent: 3, oppSpent: 2 });
  play(b.engine, P1, b.id("hp"), { selected: { attachTo: [b.id("mine")] } });
  const theirs = b.engine.state.players[P2].play.filter((c) => b.engine.isResource(c));
  assert.ok(theirs.length >= 2, "theirs.length >= 2");
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, [theirs[0]]), "the opponent's resource");
  assert.equal(ready(b.engine, P2), 0, "the opponent's resources are still spent");
  const mine = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c));
  pick(b.engine, P1, [mine[0]]);
  assert.equal(ready(b.engine, P2), 0);
});

clause(HP, "1:rule", "only resources that are attached to the faction can be detached: a resource that is not attached cannot be picked", () => {
  const b = hpPlayToPrompt({ elitism: 8, spent: 1 });
  // 8 elitism: 6 are spent on the Plating, 2 stay ready (never attached); 1 old spent resource
  const loose = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && attachedTo(b.engine, c) === undefined);
  assert.equal(loose.length, 2, "two resources are not attached to the faction");
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, [loose[0]]), "a resource that is not attached cannot be detached");
  assert.ok(b.engine.state.pendingChoice, "the choice is still open after the refusal");
});

clause(HP, "1:rule", "a face-down card attached to the faction is a resource and can be detached", () => {
  const b = hpBoard({
    spent: 0,
    extra: volition(2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
  });
  const faceDownAttached = b.engine.state.players[P1].play.filter((c) => b.engine.state.cards[c].faceDown && attachedTo(b.engine, c));
  assert.equal(faceDownAttached.length, 2);
  play(b.engine, P1, b.id("hp"), { selected: { attachTo: [b.id("mine")] } });
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, [faceDownAttached[0]]);
  assert.equal(attachedTo(b.engine, faceDownAttached[0]), undefined);
  assert.equal(attachedTo(b.engine, faceDownAttached[1]), b.engine.state.players[P1].factionId);
});

clause(HP, "1:rule", "the detached resources are spendable at once: detach 2 and immediately play a card that costs 2", () => {
  const b = hpPlayToPrompt({ extra: [{ key: "two", def: item({ name: "Two", cost: 2 }), owner: P1, zone: "hand" }] });
  const attached = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === b.engine.state.players[P1].factionId);
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, attached.slice(0, 2));
  play(b.engine, P1, b.id("two"));
  assert.equal(zoneOf(b.engine, b.id("two")), "play");
  assert.equal(ready(b.engine), 0);
});

clause(HP, "1:rule", "only the Plating's own entering triggers it: another card entering play afterwards raises no choice", () => {
  const b = hpBoard({ hp: "play", extra: [{ key: "other", def: item({ name: "Other" }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no detach offer");
});

clause(HP, "1:rule", "moving the Plating with HANDOFF is not entering play: no new detach offer", () => {
  const b = hpBoard({ hp: "play", greed: 5, elitism: 0 });
  activate(b.engine, P1, b.id("hp"), "handoff", { selected: { w: [b.id("mate")] } });
  assert.equal(attachedTo(b.engine, b.id("hp")), b.id("mate"));
  assert.equal(b.engine.state.pendingChoice, undefined);
});

// 2:rule — The attached character gains 4 strength, 4 life, and loses 1 speed.

clause(HP, "2:rule", "the attached character gets exactly +4 strength, +4 life and -1 speed, whether it is yours or the opponent's", () => {
  for (const hostKey of ["mine", "foe"] as const) {
    const bare = hpBoard();
    const { engine, id } = hpBoard({ hp: "play", host: hostKey });
    for (const [stat_, delta] of [["strength", 4], ["life", 4], ["speed", -1]] as const) {
      assert.equal(engine.getStat(id(hostKey), stat_), bare.engine.getStat(bare.id(hostKey), stat_) + delta, `${hostKey} ${stat_}`);
    }
    assert.deepEqual(stat(engine, id(hostKey)), [6, 8, 2]);
  }
});

clause(HP, "2:rule", "only the attached character is affected: other characters of both players keep their stats", () => {
  const { engine, id } = hpBoard({ hp: "play", host: "mine" });
  for (const key of ["mate", "foe", "tired"]) assert.deepEqual(stat(engine, id(key)), [2, 4, 3], key);
});

clause(HP, "2:rule", "two Platings on one character stack: +8/+8 and -2 speed", () => {
  const { engine, id } = hpBoard({ hp: "play", extra: [{ key: "hp2", def: printing(HP), owner: P1, zone: "play", attachedToKey: "mine" }] });
  assert.deepEqual(stat(engine, id("mine")), [10, 12, 1]);
});

clause(HP, "2:rule", "the bonus is gone once the Plating leaves play", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = hpBoard({ hp: "play", extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }] });
  assert.deepEqual(stat(engine, id("mine")), [6, 8, 2]);
  play(engine, P1, id("smash"), { selected: { t: [id("hp")] } });
  assert.equal(zoneOf(engine, id("hp")), "discard");
  assert.deepEqual(stat(engine, id("mine")), [2, 4, 3]);
});

clause(HP, "2:rule", "the life bonus is real: a host that took more damage than its own life is destroyed when the Plating is destroyed", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play", damage: 5 },
      { key: "hp", def: printing(HP), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "smash", def: smash, owner: P1, zone: "hand" }
    ]
  });
  assert.equal(zoneOf(engine, id("mine")), "play", "8 life with 5 damage: alive");
  play(engine, P1, id("smash"), { selected: { t: [id("hp")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard", "4 life with 5 damage: destroyed");
});

clause(HP, "2:rule", "loses 1 speed, but speed cannot go below 0 (CR 410.4): a 0-speed host stays at 0", () => {
  const { engine, id } = hpBoard({ hp: "play", hostStats: { speed: 0 } });
  assert.equal(engine.getStat(id("mine"), "speed"), 0);
});

// 3:ability:handoff — COST: Pay 5. Deplete a character you control that is not in a battle. EFFECT: Attach this card to the character.

/** The Plating in play on `mine`, a ready character `mate`, a depleted one `tired`, and `foe`. */
const handoffBoard = (opts: { greed?: number; elitism?: number; withFaceDown?: boolean } = {}) =>
  hpBoard({ hp: "play", greed: opts.greed ?? 5, elitism: opts.elitism ?? 0, withFaceDown: opts.withFaceDown });

clause(HP, "3:ability:handoff", "pays 5 and depletes the chosen character as the cost, then the plating attaches to that character (the old host loses the bonus, the new one gains it)", () => {
  const { engine, id } = handoffBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("hp"), "handoff", { w: [id("mate")] });
  assert.equal(before - ready(engine), 5, "COST: pay 5, paid on activation");
  assert.equal(engine.state.cards[id("mate")].depleted, true, "COST: the chosen character is depleted on activation");
  assert.equal(engine.state.cards[id("mine")].depleted, false, "the old host is not depleted");
  assert.equal(attachedTo(engine, id("hp")), id("mine"), "not attached to the new character until the ability resolves");
  resolvePendingResponses(engine);
  assert.equal(attachedTo(engine, id("hp")), id("mate"), "EFFECT: attach this card to the character");
  assert.equal(zoneOf(engine, id("hp")), "play");
  assert.equal(engine.state.cards[id("hp")].controllerId, P1);
  assert.deepEqual(stat(engine, id("mine")), [2, 4, 3], "old host loses the bonus");
  assert.deepEqual(stat(engine, id("mate")), [6, 8, 2], "new host gains the bonus");
});

clause(HP, "3:ability:handoff", "needs no threshold: five resources of any kind pay for it", () => {
  const { engine, id } = handoffBoard({ greed: 5, elitism: 0 });
  activate(engine, P1, id("hp"), "handoff", { selected: { w: [id("mate")] } });
  assert.equal(attachedTo(engine, id("hp")), id("mate"));
  assert.equal(ready(engine), 0, "all five resources were spent");
});

clause(HP, "3:ability:handoff", "is refused one resource short of the cost of 5, and nothing is depleted", () => {
  const { engine, id } = handoffBoard({ greed: 4 });
  refused(() => activateRaw(engine, P1, id("hp"), "handoff", { w: [id("mate")] }), "one resource short");
  assert.equal(engine.state.cards[id("mate")].depleted, false, "no partial payment");
  assert.equal(ready(engine), 4);
  assert.equal(attachedTo(engine, id("hp")), id("mine"));
  const exact = handoffBoard({ greed: 5 });
  activate(exact.engine, P1, exact.id("hp"), "handoff", { selected: { w: [exact.id("mate")] } });
  assert.equal(attachedTo(exact.engine, exact.id("hp")), exact.id("mate"), "exactly 5 resources is enough");
});

clause(HP, "3:ability:handoff", "can hand off to a character you control when the plating sits on an opponent's character", () => {
  const { engine, id } = hpBoard({ hp: "play", host: "foe", greed: 5, elitism: 0 });
  assert.deepEqual(stat(engine, id("foe")), [6, 8, 2], "control: the opponent's character wears it");
  activate(engine, P1, id("hp"), "handoff", { selected: { w: [id("mate")] } });
  assert.equal(attachedTo(engine, id("hp")), id("mate"));
  assert.deepEqual(stat(engine, id("foe")), [2, 4, 3]);
  assert.deepEqual(stat(engine, id("mate")), [6, 8, 2]);
});

clause(HP, "3:ability:handoff", "the character must be one you control: an opponent's character is refused", () => {
  const { engine, id } = handoffBoard();
  refused(() => activateRaw(engine, P1, id("hp"), "handoff", { w: [id("foe")] }), "the opponent's character");
  assert.equal(engine.state.cards[id("foe")].depleted, false);
  assert.equal(ready(engine), 5, "nothing was paid");
  assert.equal(attachedTo(engine, id("hp")), id("mine"));
  activate(engine, P1, id("hp"), "handoff", { selected: { w: [id("mate")] } });
  assert.equal(attachedTo(engine, id("hp")), id("mate"), "control: one of your own characters is accepted");
});

clause(HP, "3:ability:handoff", "the pick must be a character: items, face-down cards and factions are refused, as is no pick at all", () => {
  const { engine, id } = handoffBoard({ withFaceDown: true });
  // a face-down card of mine is only a resource
  const mineFaceDown = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "hp", def: printing(HP), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "fd", def: character({ name: "Fd" }), owner: P1, zone: "play", faceDown: true },
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" },
      ...bank("greed", 6, P1)
    ]
  });
  const fdBefore = ready(mineFaceDown.engine);
  refused(() => activateRaw(mineFaceDown.engine, P1, mineFaceDown.id("hp"), "handoff", { w: [mineFaceDown.id("fd")] }), "my own face-down card");
  assert.equal(ready(mineFaceDown.engine), fdBefore, "nothing was paid");
  assert.equal(mineFaceDown.engine.state.cards[mineFaceDown.id("fd")].depleted, false);
  const before = ready(engine);
  refused(() => activateRaw(engine, P1, id("hp"), "handoff", { w: [id("thing")] }), "an item");
  refused(() => activateRaw(engine, P1, id("hp"), "handoff", { w: [engine.state.players[P1].factionId!] }), "your faction");
  refused(() => activateRaw(engine, P1, id("hp"), "handoff", { w: [] }), "no character picked");
  assert.equal(ready(engine), before, "nothing was paid");
  activate(engine, P1, id("hp"), "handoff", { selected: { w: [id("mate")] } });
  assert.equal(attachedTo(engine, id("hp")), id("mate"), "control: a character is accepted");
});

clause(HP, "3:ability:handoff", "an already-depleted character cannot be depleted for the cost, so it is refused", () => {
  const { engine, id } = handoffBoard();
  refused(() => activateRaw(engine, P1, id("hp"), "handoff", { w: [id("tired")] }), "already depleted");
  assert.equal(attachedTo(engine, id("hp")), id("mine"));
  assert.equal(ready(engine), 5, "nothing was paid");
  activate(engine, P1, id("hp"), "handoff", { selected: { w: [id("mate")] } });
  assert.equal(attachedTo(engine, id("hp")), id("mate"), "control: a ready character is accepted");
});

clause(HP, "3:ability:handoff", "the current host may be the chosen character: it is depleted for the cost and the plating stays on it", () => {
  const { engine, id } = handoffBoard();
  activate(engine, P1, id("hp"), "handoff", { selected: { w: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].depleted, true);
  assert.equal(attachedTo(engine, id("hp")), id("mine"));
  assert.deepEqual(stat(engine, id("mine")), [6, 8, 2], "the bonus still applies exactly once");
  assert.equal(ready(engine), 0);
});

clause(HP, "3:ability:handoff", "only the plating's controller can use it", () => {
  const { engine, id } = handoffBoard();
  refused(() => activateRaw(engine, P2, id("hp"), "handoff", { w: [id("foe")] }), "the opponent cannot use my plating");
  refused(() => activateRaw(engine, P2, id("hp"), "handoff", { w: [id("mate")] }), "...even naming my character");
  assert.equal(attachedTo(engine, id("hp")), id("mine"));
  activate(engine, P1, id("hp"), "handoff", { selected: { w: [id("mate")] } });
  assert.equal(attachedTo(engine, id("hp")), id("mate"), "control: the controller can use it");
});

clause(HP, "3:ability:handoff", "a character that is in a battle cannot be chosen (a blocker), but one that is not in the battle can", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "idle2", def: character({ name: "Idle2", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "hp", def: printing(HP), owner: P2, zone: "play", attachedToKey: "idle" },
      ...bank("greed", 9, P2)
    ]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  passUntil(engine, P2);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the defender can act in the battle window");
  refused(() => activateRaw(engine, P2, id("hp"), "handoff", { w: [id("blk")] }), "a blocking character is in the battle");
  assert.equal(engine.state.cards[id("blk")].depleted, false, "refused: nothing was depleted");
  assert.equal(ready(engine, P2), 9, "refused: nothing was paid");
  activateRaw(engine, P2, id("hp"), "handoff", { w: [id("idle2")] });
  assert.equal(engine.state.cards[id("idle2")].depleted, true, "a character not in the battle is accepted");
  assert.equal(ready(engine, P2), 4);
});

clause(HP, "3:ability:handoff", "an attacking character is in a battle and cannot be chosen", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 3 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "hp", def: printing(HP), owner: P1, zone: "play", attachedToKey: "idle" },
      ...bank("greed", 9, P1)
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker acts first in the battle window");
  refused(() => activateRaw(engine, P1, id("hp"), "handoff", { w: [id("atk")] }), "an attacking character is in the battle");
  assert.equal(ready(engine), 9, "refused: nothing paid");
  activateRaw(engine, P1, id("hp"), "handoff", { w: [id("idle")] });
  assert.equal(engine.state.cards[id("idle")].depleted, true, "control: a character outside the battle is accepted");
});

// ===============================================================================
// Horsemajig of the Apocalypse - Death / Famine / Pestilence / War
// "All other horsemajig characters gain ..." (Death 1 strength, 1 life and 1 speed;
// Famine 1 speed; Pestilence 1 life; War 1 strength). Characters (horsemajig).
// ===============================================================================

const DEATH = "864e66a1-9fb7-404d-9576-fcc0c5e4901a";
const FAMINE = "143db371-4e9a-474a-b536-1d7f8efe26e6";
const PESTILENCE = "2f4a7db5-598c-445d-a4f6-d45c7e740582";
const WAR = "d6015ff5-c210-4133-89a3-c539461b0db0";

/** `base` and `bonus` are [strength, life, speed]. */
interface Horse {
  id: string;
  base: number[];
  bonus: number[];
}
const HORSE_DEATH: Horse = { id: DEATH, base: [2, 3, 4], bonus: [1, 1, 1] };
const HORSE_FAMINE: Horse = { id: FAMINE, base: [1, 2, 4], bonus: [0, 0, 1] };
const HORSE_PESTILENCE: Horse = { id: PESTILENCE, base: [1, 3, 3], bonus: [0, 1, 0] };
const HORSE_WAR: Horse = { id: WAR, base: [2, 2, 3], bonus: [1, 0, 0] };
const ALL_HORSES = [HORSE_DEATH, HORSE_FAMINE, HORSE_PESTILENCE, HORSE_WAR];

const steedDef = (name: string, subtype: string[] = ["horsemajig"]) => character({ name, subtype, strength: 2, life: 3, speed: 2 });
const plus = (base: number[], ...bonuses: number[][]) => base.map((v, i) => v + bonuses.reduce((sum, b) => sum + b[i], 0));

function horseBoard(h: Horse, extra: CardPlacement[] = [], src: Partial<CardPlacement> = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "src", def: printing(h.id), owner: P1, zone: "play", ...src },
      { key: "steed", def: steedDef("Steed"), owner: P1, zone: "play" },
      { key: "oppSteed", def: steedDef("OppSteed"), owner: P2, zone: "play" },
      { key: "multi", def: steedDef("Multi", ["foo", "horsemajig"]), owner: P1, zone: "play" },
      { key: "majigOnly", def: steedDef("MajigOnly", ["majig"]), owner: P1, zone: "play" },
      { key: "oppPlain", def: steedDef("OppPlain", ["foo"]), owner: P2, zone: "play" },
      { key: "bare", def: steedDef("Bare", []), owner: P1, zone: "play" },
      { key: "handSteed", def: steedDef("HandSteed"), owner: P1, zone: "hand" },
      { key: "discSteed", def: steedDef("DiscSteed"), owner: P1, zone: "discard" },
      { key: "deckSteed", def: steedDef("DeckSteed"), owner: P1, zone: "deck" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...extra
    ]
  });
}

const STEED = [2, 3, 2];

function horseOwnSide(h: Horse) {
  const { engine, id } = horseBoard(h);
  assert.deepEqual(stat(engine, id("steed")), plus(STEED, h.bonus), "my other horsemajig");
}
function horseOpponentSide(h: Horse) {
  const { engine, id } = horseBoard(h);
  assert.deepEqual(stat(engine, id("oppSteed")), plus(STEED, h.bonus), "the opponent's horsemajig: 'all other horsemajig characters', not just yours");
}
function horseNotSelf(h: Horse) {
  const { engine, id } = horseBoard(h);
  assert.deepEqual(stat(engine, id("src")), h.base, "'other': the card itself keeps its printed stats");
}
function horseOnlyHorsemajig(h: Horse) {
  const { engine, id } = horseBoard(h);
  for (const key of ["majigOnly", "oppPlain", "bare"]) assert.deepEqual(stat(engine, id(key)), STEED, `${key} is not a horsemajig`);
}
function horseMultiSubtype(h: Horse) {
  const { engine, id } = horseBoard(h);
  assert.deepEqual(stat(engine, id("multi")), plus(STEED, h.bonus), "a character with several subtypes, one of them horsemajig");
}
function horseNotOutsidePlay(h: Horse) {
  const { engine, id } = horseBoard(h);
  for (const key of ["handSteed", "discSteed", "deckSteed"]) assert.deepEqual(stat(engine, id(key)), STEED, `${key} is not in play`);
}
function horseTwoCopies(h: Horse) {
  const { engine, id } = horseBoard(h, [{ key: "src2", def: printing(h.id), owner: P1, zone: "play" }]);
  assert.deepEqual(stat(engine, id("src")), plus(h.base, h.bonus), "each copy is 'another' horsemajig for the other");
  assert.deepEqual(stat(engine, id("src2")), plus(h.base, h.bonus));
  assert.deepEqual(stat(engine, id("steed")), plus(STEED, h.bonus, h.bonus), "an ordinary horsemajig gets the bonus once per copy");
}
function horseLeavesPlay(h: Horse) {
  const { engine, id } = horseBoard(h);
  assert.deepEqual(stat(engine, id("steed")), plus(STEED, h.bonus));
  play(engine, P1, id("kill"), { selected: { t: [id("src")] } });
  assert.equal(zoneOf(engine, id("src")), "discard");
  assert.deepEqual(stat(engine, id("steed")), STEED, "the bonus is gone with the card");
  assert.deepEqual(stat(engine, id("oppSteed")), STEED);
}
function horseEntersLater(h: Horse) {
  const { engine, id } = horseBoard(h);
  assert.deepEqual(stat(engine, id("handSteed")), STEED);
  play(engine, P1, id("handSteed"));
  assert.equal(zoneOf(engine, id("handSteed")), "play");
  assert.deepEqual(stat(engine, id("handSteed")), plus(STEED, h.bonus), "a horsemajig deployed later gets the bonus at once");
}
function horseFaceDownSource(h: Horse) {
  const { engine, id } = horseBoard(h, [], { faceDown: true });
  assert.deepEqual(stat(engine, id("steed")), STEED, "a face-down card has no rules text (CR 411.1)");
  assert.deepEqual(stat(engine, id("oppSteed")), STEED);
}
function horseAllFour(h: Horse) {
  const others = ALL_HORSES.filter((o) => o !== h);
  const { engine, id } = horseBoard(
    h,
    others.map((o, i) => ({ key: `x${i}`, def: printing(o.id), owner: P1, zone: "play" as const }))
  );
  assert.deepEqual(stat(engine, id("src")), plus(h.base, ...others.map((o) => o.bonus)), "gets the bonus of each of the other three horsemajigs");
  assert.deepEqual(stat(engine, id("steed")), plus(STEED, ...ALL_HORSES.map((o) => o.bonus)));
}
function horseDeployChecks(spec: DeploySpec) {
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  if (spec.iconCount > 1) deployIconShort(spec);
}

const DEATH_SPEC: DeploySpec = { printingId: DEATH, cost: 5, icon: "elitism", iconCount: 3 };
const FAMINE_SPEC: DeploySpec = { printingId: FAMINE, cost: 1, icon: "elitism", iconCount: 2 };
const PESTILENCE_SPEC: DeploySpec = { printingId: PESTILENCE, cost: 2, icon: "elitism", iconCount: 1 };
const WAR_SPEC: DeploySpec = { printingId: WAR, cost: 3, icon: "elitism", iconCount: 1 };

// --- Death ---------------------------------------------------------------------

clause(DEATH, "0:rule", "my other horsemajig characters gain exactly 1 strength, 1 life and 1 speed", () => horseOwnSide(HORSE_DEATH));
clause(DEATH, "0:rule", "the opponent's horsemajig characters gain the bonus too", () => horseOpponentSide(HORSE_DEATH));
clause(DEATH, "0:rule", "'other': Death itself keeps its printed 2/3/4", () => horseNotSelf(HORSE_DEATH));
clause(DEATH, "0:rule", "non-horsemajig characters (majig only, other subtype, none) gain nothing", () => horseOnlyHorsemajig(HORSE_DEATH));
clause(DEATH, "0:rule", "a character with several subtypes gains it if one of them is horsemajig", () => horseMultiSubtype(HORSE_DEATH));
clause(DEATH, "0:rule", "horsemajig cards in hand, discard pile and deck are not characters in play and gain nothing", () => horseNotOutsidePlay(HORSE_DEATH));
clause(DEATH, "0:rule", "two Deaths each gain the bonus from the other, and an ordinary horsemajig gains it twice", () => horseTwoCopies(HORSE_DEATH));
clause(DEATH, "0:rule", "the bonus ends when Death leaves play", () => horseLeavesPlay(HORSE_DEATH));
clause(DEATH, "0:rule", "a horsemajig deployed later gains the bonus at once", () => horseEntersLater(HORSE_DEATH));
clause(DEATH, "0:rule", "a face-down Death is only a resource and gives nothing", () => horseFaceDownSource(HORSE_DEATH));
clause(DEATH, "0:rule", "stacks with the other three Horsemajigs of the Apocalypse", () => horseAllFour(HORSE_DEATH));
clause(DEATH, "0:rule", "deploys for exactly 5 with [E][E][E] (refused short, or without the icons)", () => horseDeployChecks(DEATH_SPEC));
clause(DEATH, "0:rule", "its printed stats are 2 strength, 3 life, 4 speed", () => {
  const { engine, id } = horseBoard(HORSE_DEATH);
  assert.deepEqual(stat(engine, id("src")), [2, 3, 4]);
});

// --- Famine --------------------------------------------------------------------

clause(FAMINE, "0:rule", "my other horsemajig characters gain exactly 1 speed (and nothing else)", () => horseOwnSide(HORSE_FAMINE));
clause(FAMINE, "0:rule", "the opponent's horsemajig characters gain the speed too", () => horseOpponentSide(HORSE_FAMINE));
clause(FAMINE, "0:rule", "'other': Famine itself keeps its printed 1/2/4", () => horseNotSelf(HORSE_FAMINE));
clause(FAMINE, "0:rule", "non-horsemajig characters gain nothing", () => horseOnlyHorsemajig(HORSE_FAMINE));
clause(FAMINE, "0:rule", "a character with several subtypes gains it if one of them is horsemajig", () => horseMultiSubtype(HORSE_FAMINE));
clause(FAMINE, "0:rule", "horsemajig cards in hand, discard pile and deck gain nothing", () => horseNotOutsidePlay(HORSE_FAMINE));
clause(FAMINE, "0:rule", "two Famines each gain the speed from the other, and an ordinary horsemajig gains it twice", () => horseTwoCopies(HORSE_FAMINE));
clause(FAMINE, "0:rule", "the bonus ends when Famine leaves play", () => horseLeavesPlay(HORSE_FAMINE));
clause(FAMINE, "0:rule", "a horsemajig deployed later gains the speed at once", () => horseEntersLater(HORSE_FAMINE));
clause(FAMINE, "0:rule", "a face-down Famine is only a resource and gives nothing", () => horseFaceDownSource(HORSE_FAMINE));
clause(FAMINE, "0:rule", "stacks with the other three Horsemajigs of the Apocalypse", () => horseAllFour(HORSE_FAMINE));
clause(FAMINE, "0:rule", "deploys for exactly 1 with [E][E] (refused short, or without the icons)", () => horseDeployChecks(FAMINE_SPEC));
clause(FAMINE, "0:rule", "its printed stats are 1 strength, 2 life, 4 speed", () => {
  const { engine, id } = horseBoard(HORSE_FAMINE);
  assert.deepEqual(stat(engine, id("src")), [1, 2, 4]);
});
clause(FAMINE, "0:rule", "the speed is real: a 2-speed horsemajig made 3-speed strikes together with a 3-speed blocker instead of after it", () => {
  const hit = character({ name: "Hit", subtype: ["horsemajig"], strength: 5, life: 2, speed: 2 });
  const b = horseBoard(HORSE_FAMINE, [
    { key: "hit", def: hit, owner: P1, zone: "play" },
    { key: "blk", def: character({ name: "Blk", strength: 5, life: 2, speed: 3 }), owner: P2, zone: "play" }
  ]);
  declareAttackBy(b.engine, P1, [b.id("hit")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
  autoResolveBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("blk")), "discard", "the 3-speed horsemajig struck at speed 3, together with the blocker");
  assert.equal(zoneOf(b.engine, b.id("hit")), "discard");
  // control: without Famine the 2-speed attacker strikes after the 3-speed blocker has already killed it
  const bare = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "hit", def: hit, owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 5, life: 2, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(bare.engine, P1, [bare.id("hit")]);
  bare.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [bare.id("blk")] });
  autoResolveBattle(bare.engine);
  assert.equal(zoneOf(bare.engine, bare.id("blk")), "play", "control: the faster blocker kills the attacker first");
  assert.equal(zoneOf(bare.engine, bare.id("hit")), "discard");
});

// --- Pestilence ----------------------------------------------------------------

clause(PESTILENCE, "0:rule", "my other horsemajig characters gain exactly 1 life (and nothing else)", () => horseOwnSide(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "the opponent's horsemajig characters gain the life too", () => horseOpponentSide(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "'other': Pestilence itself keeps its printed 1/3/3", () => horseNotSelf(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "non-horsemajig characters gain nothing", () => horseOnlyHorsemajig(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "a character with several subtypes gains it if one of them is horsemajig", () => horseMultiSubtype(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "horsemajig cards in hand, discard pile and deck gain nothing", () => horseNotOutsidePlay(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "two Pestilences each gain the life from the other, and an ordinary horsemajig gains it twice", () => horseTwoCopies(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "the bonus ends when Pestilence leaves play", () => horseLeavesPlay(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "a horsemajig deployed later gains the life at once", () => horseEntersLater(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "a face-down Pestilence is only a resource and gives nothing", () => horseFaceDownSource(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "stacks with the other three Horsemajigs of the Apocalypse", () => horseAllFour(HORSE_PESTILENCE));
clause(PESTILENCE, "0:rule", "deploys for exactly 2 with [E] (refused short, or without the icon)", () => horseDeployChecks(PESTILENCE_SPEC));
clause(PESTILENCE, "0:rule", "its printed stats are 1 strength, 3 life, 3 speed", () => {
  const { engine, id } = horseBoard(HORSE_PESTILENCE);
  assert.deepEqual(stat(engine, id("src")), [1, 3, 3]);
});
clause(PESTILENCE, "0:rule", "the life is real: a 3-life horsemajig survives 3 damage, and is destroyed by it once Pestilence is gone", () => {
  const { engine, id } = horseBoard(HORSE_PESTILENCE, [{ key: "zap", def: zapTactic(3), owner: P1, zone: "hand" }]);
  play(engine, P1, id("zap"), { selected: { t: [id("steed")] } });
  assert.equal(zoneOf(engine, id("steed")), "play", "4 life, 3 damage: alive");
  assert.equal(engine.state.cards[id("steed")].damage, 3);
  play(engine, P1, id("kill"), { selected: { t: [id("src")] } });
  assert.equal(zoneOf(engine, id("steed")), "discard", "3 life, 3 damage: destroyed");
});

// --- War -----------------------------------------------------------------------

clause(WAR, "0:rule", "my other horsemajig characters gain exactly 1 strength (and nothing else)", () => horseOwnSide(HORSE_WAR));
clause(WAR, "0:rule", "the opponent's horsemajig characters gain the strength too", () => horseOpponentSide(HORSE_WAR));
clause(WAR, "0:rule", "'other': War itself keeps its printed 2/2/3", () => horseNotSelf(HORSE_WAR));
clause(WAR, "0:rule", "non-horsemajig characters gain nothing", () => horseOnlyHorsemajig(HORSE_WAR));
clause(WAR, "0:rule", "a character with several subtypes gains it if one of them is horsemajig", () => horseMultiSubtype(HORSE_WAR));
clause(WAR, "0:rule", "horsemajig cards in hand, discard pile and deck gain nothing", () => horseNotOutsidePlay(HORSE_WAR));
clause(WAR, "0:rule", "two Wars each gain the strength from the other, and an ordinary horsemajig gains it twice", () => horseTwoCopies(HORSE_WAR));
clause(WAR, "0:rule", "the bonus ends when War leaves play", () => horseLeavesPlay(HORSE_WAR));
clause(WAR, "0:rule", "a horsemajig deployed later gains the strength at once", () => horseEntersLater(HORSE_WAR));
clause(WAR, "0:rule", "a face-down War is only a resource and gives nothing", () => horseFaceDownSource(HORSE_WAR));
clause(WAR, "0:rule", "stacks with the other three Horsemajigs of the Apocalypse", () => horseAllFour(HORSE_WAR));
clause(WAR, "0:rule", "deploys for exactly 3 with [E] (refused short, or without the icon)", () => horseDeployChecks(WAR_SPEC));
clause(WAR, "0:rule", "its printed stats are 2 strength, 2 life, 3 speed", () => {
  const { engine, id } = horseBoard(HORSE_WAR);
  assert.deepEqual(stat(engine, id("src")), [2, 2, 3]);
});
clause(WAR, "0:rule", "the strength is real: a horsemajig attacking the faction unblocked deals 3 battle damage instead of 2", () => {
  const { engine, id } = horseBoard(HORSE_WAR);
  const before = engine.state.players[P2].influence;
  fightUnblocked(engine, id("steed"));
  assert.equal(before - engine.state.players[P2].influence, 3);
  const bare = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [{ key: "steed", def: steedDef("Steed"), owner: P1, zone: "play" }]
  });
  const bareBefore = bare.engine.state.players[P2].influence;
  fightUnblocked(bare.engine, bare.id("steed"));
  assert.equal(bareBefore - bare.engine.state.players[P2].influence, 2, "control: without War it deals 2");
});

/** `attacker` (P1) attacks the opponent's faction; nobody blocks; the battle is played out. */
function fightUnblocked(engine: SpoilsEngine, attacker: string) {
  declareAttackBy(engine, P1, [attacker]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
}

// ===============================================================================
// Kaiser Wave
// COST: Pick a character. EFFECT: This turn, the character gains 1 strength and 1
// life. It gains an additional 1 strength and 1 life for each "kaiser" card in play.
// It gains an additional 1 strength and 1 life if it is a "kaiser" character.
// Tactic (kaiser), cost 2, threshold [E][E].
// ===============================================================================

const WAVE = "03ff491b-019b-444d-bbf4-3cdbf5323a10";

function waveBoard(opts: { elitism?: number; greed?: number; active?: Pid; extra?: CardPlacement[]; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "wave", def: printing(WAVE), owner: P1, zone: "hand" },
      { key: "target", def: character({ name: "Target", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const kaiserChar = (name: string) => character({ name, subtype: ["kaiser"], strength: 2, life: 3, speed: 2 });
const waveSpec: DeploySpec = {
  printingId: WAVE,
  cost: 2,
  icon: "elitism",
  iconCount: 2,
  ends: "discard",
  extra: [{ key: "t", def: character({ name: "T" }), owner: P1, zone: "play" }],
  selected: (id) => ({ c: [id("t")] })
};

clause(WAVE, "0:ability", "a plain character with no kaiser card in play gains exactly 1 strength and 1 life (speed unchanged), until end of turn", () => {
  const { engine, id } = waveBoard();
  assert.deepEqual(stat(engine, id("target")), [2, 3, 2]);
  play(engine, P1, id("wave"), { selected: { c: [id("target")] } });
  assert.deepEqual(stat(engine, id("target")), [3, 4, 2], "Kaiser Wave itself is a kaiser card, but it is not in play");
});

clause(WAVE, "0:ability", "pays exactly 2 and the tactic ends in its owner's discard pile", () => {
  const { engine, id } = waveBoard();
  const before = ready(engine);
  play(engine, P1, id("wave"), { selected: { c: [id("target")] } });
  assert.equal(before - ready(engine), 2);
  assert.equal(zoneOf(engine, id("wave")), "discard");
});

for (const k of [1, 2, 3]) {
  clause(WAVE, "0:ability", `with ${k} kaiser card(s) in play the (non-kaiser) target gains ${1 + k} strength and ${1 + k} life`, () => {
    const all: CardPlacement[] = [
      { key: "k1", def: kaiserChar("K1"), owner: P2, zone: "play" },
      { key: "k2", def: item({ name: "K2", subtype: ["kaiser"] }), owner: P1, zone: "play" },
      { key: "k3", def: kaiserChar("K3"), owner: P1, zone: "play" }
    ];
    const extra = all.slice(0, k);
    const { engine, id } = waveBoard({ extra });
    play(engine, P1, id("wave"), { selected: { c: [id("target")] } });
    assert.deepEqual(stat(engine, id("target")), [2 + 1 + k, 3 + 1 + k, 2]);
  });
}

clause(WAVE, "0:ability", "every kaiser card counts, whoever controls it and whatever its type (the opponent's character, my item, my location)", () => {
  const { engine, id } = waveBoard({
    extra: [
      { key: "k1", def: kaiserChar("K1"), owner: P2, zone: "play" },
      { key: "k2", def: item({ name: "K2", subtype: ["kaiser"] }), owner: P1, zone: "play" },
      { key: "k3", def: location({ name: "K3", subtype: ["kaiser"] }), owner: P2, zone: "play" }
    ]
  });
  play(engine, P1, id("wave"), { selected: { c: [id("target")] } });
  assert.deepEqual(stat(engine, id("target")), [2 + 1 + 3, 3 + 1 + 3, 2]);
});

clause(WAVE, "0:ability", "only kaiser cards IN PLAY count: kaiser cards in hand, deck and discard pile add nothing", () => {
  const { engine, id } = waveBoard({
    extra: [
      { key: "kh", def: kaiserChar("KH"), owner: P1, zone: "hand" },
      { key: "kd", def: kaiserChar("KD"), owner: P1, zone: "deck" },
      { key: "kdis", def: kaiserChar("KDis"), owner: P1, zone: "discard" },
      { key: "okh", def: kaiserChar("OKH"), owner: P2, zone: "hand" }
    ]
  });
  play(engine, P1, id("wave"), { selected: { c: [id("target")] } });
  assert.deepEqual(stat(engine, id("target")), [3, 4, 2]);
});

clause(WAVE, "0:ability", "a face-down card is only a resource with no subtype, so a face-down 'kaiser' card is not counted (CR 411.1)", () => {
  const { engine, id } = waveBoard({ extra: [{ key: "fd", def: kaiserChar("FD"), owner: P2, zone: "play", faceDown: true }] });
  play(engine, P1, id("wave"), { selected: { c: [id("target")] } });
  assert.deepEqual(stat(engine, id("target")), [3, 4, 2], "the face-down card has no subtype");
});

clause(WAVE, "0:ability", "a kaiser target gains the extra 1/1 as well, and it is itself one of the kaiser cards in play: alone it gets 1 + 1 + 1", () => {
  const { engine, id } = waveBoard({ extra: [{ key: "kt", def: kaiserChar("KT"), owner: P1, zone: "play" }] });
  play(engine, P1, id("wave"), { selected: { c: [id("kt")] } });
  assert.deepEqual(stat(engine, id("kt")), [2 + 3, 3 + 3, 2]);
  assert.deepEqual(stat(engine, id("target")), [2, 3, 2], "nobody else is affected");
});

clause(WAVE, "0:ability", "a kaiser target with other kaiser cards in play gets 1 + (all kaiser cards, itself included) + 1", () => {
  const { engine, id } = waveBoard({
    extra: [
      { key: "kt", def: kaiserChar("KT"), owner: P1, zone: "play" },
      { key: "k1", def: kaiserChar("K1"), owner: P2, zone: "play" },
      { key: "k2", def: item({ name: "K2", subtype: ["kaiser"] }), owner: P1, zone: "play" }
    ]
  });
  play(engine, P1, id("wave"), { selected: { c: [id("kt")] } });
  assert.deepEqual(stat(engine, id("kt")), [2 + 1 + 3 + 1, 3 + 1 + 3 + 1, 2]);
});

clause(WAVE, "0:ability", "the opponent's character can be picked, and it gets the same bonus (a kaiser one gets the extra 1/1)", () => {
  const { engine, id } = waveBoard({ extra: [{ key: "okt", def: kaiserChar("OKT"), owner: P2, zone: "play" }] });
  play(engine, P1, id("wave"), { selected: { c: [id("foe")] } });
  assert.deepEqual(stat(engine, id("foe")), [2 + 1 + 1, 3 + 1 + 1, 2], "one kaiser card in play (the opponent's other character)");
  const b = waveBoard({ extra: [{ key: "okt", def: kaiserChar("OKT"), owner: P2, zone: "play" }] });
  play(b.engine, P1, b.id("wave"), { selected: { c: [b.id("okt")] } });
  assert.deepEqual(stat(b.engine, b.id("okt")), [2 + 3, 3 + 3, 2]);
});

clause(WAVE, "0:ability", "only a character can be picked: an item, a location, a face-down card, a faction or nothing is refused", () => {
  const { engine, id } = waveBoard({ extra: [{ key: "fd", def: character({ name: "FD" }), owner: P2, zone: "play", faceDown: true }] });
  const attempt = (selected: Record<string, string[]>) => () => playRaw(engine, P1, id("wave"), { selected });
  refused(attempt({ c: [id("thing")] }), "an item");
  refused(attempt({ c: [id("place")] }), "a location");
  refused(attempt({ c: [id("fd")] }), "a face-down card");
  refused(attempt({ c: [engine.state.players[P1].factionId!] }), "my faction");
  refused(attempt({ c: [engine.state.players[P2].factionId!] }), "the opponent's faction");
  refused(attempt({}), "no pick");
  assert.equal(zoneOf(engine, id("wave")), "hand");
  assert.equal(ready(engine), 6 + 0, "nothing was paid");
  attempt({ c: [id("target")] })();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(WAVE, "0:ability", "the bonus lasts this turn only: it is gone after the turn ends", () => {
  const { engine, id } = waveBoard();
  play(engine, P1, id("wave"), { selected: { c: [id("target")] } });
  assert.deepEqual(stat(engine, id("target")), [3, 4, 2]);
  endTurn(engine, P1);
  assert.deepEqual(stat(engine, id("target")), [2, 3, 2], "back to normal in the next turn");
});

clause(WAVE, "0:ability", "two Kaiser Waves on one character stack (each counts a kaiser card; neither Wave is in play)", () => {
  const { engine, id } = waveBoard({ extra: [{ key: "wave2", def: printing(WAVE), owner: P1, zone: "hand" }] });
  play(engine, P1, id("wave"), { selected: { c: [id("target")] } });
  play(engine, P1, id("wave2"), { selected: { c: [id("target")] } });
  assert.deepEqual(stat(engine, id("target")), [4, 5, 2]);
});

clause(WAVE, "0:ability", "can be played as a response on the opponent's turn", () => {
  const b = waveBoard({ active: P2, extra: [{ key: "oc", def: character({ name: "OC" }), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("oc"));
  playRaw(b.engine, P1, b.id("wave"), { selected: { c: [b.id("target")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("wave")), "discard");
  assert.deepEqual(stat(b.engine, b.id("target")), [3, 4, 2]);
});

clause(WAVE, "0:ability", "the life is real: the boosted character survives damage that would have killed it", () => {
  const { engine, id } = waveBoard({ extra: [{ key: "zap", def: zapTactic(3), owner: P1, zone: "hand" }] });
  play(engine, P1, id("wave"), { selected: { c: [id("target")] } });
  play(engine, P1, id("zap"), { selected: { t: [id("target")] } });
  assert.equal(zoneOf(engine, id("target")), "play", "4 life, 3 damage");
});

clause(WAVE, "0:ability", "costs exactly 2 and needs [E][E]", () => deployExact(waveSpec));
clause(WAVE, "0:ability", "is refused one resource short of its cost of 2", () => deployShort(waveSpec));
clause(WAVE, "0:ability", "is refused without [E] even with plenty of other resources, and with only one [E]", () => {
  deployWrongIcons(waveSpec);
  deployIconShort(waveSpec);
});

// ===============================================================================
// LeoKaiser
// GO MEGA-NEKO-KAISER! -- COST: Deplete a card named "PantherKaiser" you control.
// Deplete a card named "TigerKaiser" you control. EFFECT: This turn, this card gains 8
// strength, 8 life, and 2 speed and while it is the only member of an attacking party,
// it cannot be blocked by parties with less than 3 members.
// Character (kaiser), cost 4, threshold [E][E][E], 3/3/3.
// ===============================================================================

const LEO = "48a4905f-236a-436e-b066-714b7cdbb70e";
const PANTHER = "eb3eb01d-cb76-4159-a269-b9d1bbe3b973";
const TIGER = "ec420c2e-7624-4682-9309-da550903f6ad";

function leoBoard(opts: { leoDepleted?: boolean; panther?: boolean; tiger?: boolean; resources?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "leo", def: printing(LEO), owner: P1, zone: "play", depleted: opts.leoDepleted },
      ...(opts.panther === false ? [] : [{ key: "pk", def: printing(PANTHER), owner: P1, zone: "play" as const }]),
      ...(opts.tiger === false ? [] : [{ key: "tk", def: printing(TIGER), owner: P1, zone: "play" as const }]),
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b3", def: character({ name: "B3", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b4", def: character({ name: "B4", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", opts.resources ?? 5, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const megaSel = (id: (k: string) => string) => ({ pk: [id("pk")], tk: [id("tk")] });
const megaRaw = (b: ReturnType<typeof leoBoard>, selected = megaSel(b.id)) => activateRaw(b.engine, P1, b.id("leo"), "mega", selected);
const mega = (b: ReturnType<typeof leoBoard>, selected = megaSel(b.id)) => activate(b.engine, P1, b.id("leo"), "mega", { selected });
const blockWith = (b: ReturnType<typeof leoBoard>, keys: string[]) => () =>
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: keys.map(b.id) });

clause(LEO, "0:ability:mega", "the cost is depleting PantherKaiser and TigerKaiser, paid on activation; Leo is not depleted and no resource is paid", () => {
  const b = leoBoard();
  const before = ready(b.engine);
  megaRaw(b);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, true, "PantherKaiser depleted as a cost");
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, true, "TigerKaiser depleted as a cost");
  assert.equal(b.engine.state.cards[b.id("leo")].depleted, false, "Leo himself is not depleted");
  assert.equal(b.engine.state.cards[b.id("ally")].depleted, false, "nothing else is depleted");
  assert.equal(ready(b.engine), before, "no resources are paid");
  assert.deepEqual(stat(b.engine, b.id("leo")), [3, 3, 3], "the effect has not resolved yet");
});

clause(LEO, "0:ability:mega", "this turn Leo gains exactly 8 strength, 8 life and 2 speed", () => {
  const b = leoBoard();
  mega(b);
  assert.deepEqual(stat(b.engine, b.id("leo")), [11, 11, 5]);
  assert.deepEqual(stat(b.engine, b.id("pk")), [1, 3, 2], "PantherKaiser is unchanged");
  assert.deepEqual(stat(b.engine, b.id("ally")), [1, 3, 1], "nobody else is changed");
});

clause(LEO, "0:ability:mega", "the boost ends with the turn", () => {
  const b = leoBoard();
  mega(b);
  endTurn(b.engine, P1);
  assert.deepEqual(stat(b.engine, b.id("leo")), [3, 3, 3]);
});

clause(LEO, "0:ability:mega", "needs a PantherKaiser: refused with only TigerKaiser, and nothing is depleted", () => {
  const b = leoBoard({ panther: false, extra: [{ key: "pk", def: character({ name: "Panther" }), owner: P1, zone: "play" }] });
  refused(() => megaRaw(b), "no PantherKaiser");
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, false, "no partial payment");
});

clause(LEO, "0:ability:mega", "needs a TigerKaiser: refused with only PantherKaiser, and nothing is depleted", () => {
  const b = leoBoard({ tiger: false, extra: [{ key: "tk", def: character({ name: "Tiger" }), owner: P1, zone: "play" }] });
  refused(() => megaRaw(b), "no TigerKaiser");
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false, "no partial payment");
});

clause(LEO, "0:ability:mega", "is refused with neither Kaiser, and works once both are in play", () => {
  const b = leoBoard({ panther: false, tiger: false, extra: [{ key: "pk", def: character({ name: "P" }), owner: P1, zone: "play" }, { key: "tk", def: character({ name: "T" }), owner: P1, zone: "play" }] });
  refused(() => megaRaw(b), "no Kaiser at all");
  const ok = leoBoard();
  mega(ok);
  assert.deepEqual(stat(ok.engine, ok.id("leo")), [11, 11, 5]);
});

clause(LEO, "0:ability:mega", "the Kaisers must be yours: an opponent's PantherKaiser / TigerKaiser cannot pay the cost", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "leo", def: printing(LEO), owner: P1, zone: "play" },
      { key: "pk", def: printing(PANTHER), owner: P2, zone: "play" },
      { key: "tk", def: printing(TIGER), owner: P2, zone: "play" }
    ]
  });
  refused(() => megaRaw(b as never), "the opponent's Kaisers");
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, false);
});

clause(LEO, "0:ability:mega", "a Kaiser you CONTROL counts even if the opponent owns it", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "leo", def: printing(LEO), owner: P1, zone: "play" },
      { key: "pk", def: printing(PANTHER), owner: P2, controller: P1, zone: "play" },
      { key: "tk", def: printing(TIGER), owner: P1, zone: "play" }
    ]
  });
  megaRaw(b as never);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, true);
});

clause(LEO, "0:ability:mega", "an already-depleted PantherKaiser or TigerKaiser cannot be depleted again: refused, nothing else depleted", () => {
  for (const dep of ["pk", "tk"] as const) {
    const b = leoBoard();
    b.engine.state.cards[b.id(dep)].depleted = true;
    refused(() => megaRaw(b), `${dep} is already depleted`);
    const otherKey = dep === "pk" ? "tk" : "pk";
    assert.equal(b.engine.state.cards[b.id(otherKey)].depleted, false, "no partial payment");
    assert.deepEqual(stat(b.engine, b.id("leo")), [3, 3, 3]);
  }
});

clause(LEO, "0:ability:mega", "the names must match exactly: look-alike names do not pay the cost", () => {
  for (const [pName, tName] of [["PantherKaiser2", "TigerKaiser"], ["PantherKaiser", "Tiger Kaiser"], ["Panther", "TigerKaiser"], ["PantherKaiser", "TigerKaiser Jr"]]) {
    const b = leoBoard({
      panther: false,
      tiger: false,
      extra: [
        { key: "pk", def: character({ name: pName, subtype: ["kaiser"] }), owner: P1, zone: "play" },
        { key: "tk", def: character({ name: tName, subtype: ["kaiser"] }), owner: P1, zone: "play" }
      ]
    });
    refused(() => megaRaw(b), `${pName} / ${tName}`);
  }
  const ok = leoBoard({
    panther: false,
    tiger: false,
    extra: [
      { key: "pk", def: character({ name: "PantherKaiser" }), owner: P1, zone: "play" },
      { key: "tk", def: character({ name: "TigerKaiser" }), owner: P1, zone: "play" }
    ]
  });
  megaRaw(ok);
  assert.equal(ok.engine.state.cards[ok.id("pk")].depleted, true, "control: any cards with the right names work, the subtype is not needed");
});

clause(LEO, "0:ability:mega", "the cost names cards, not characters: an item named PantherKaiser can be depleted for it", () => {
  const b = leoBoard({
    panther: false,
    extra: [{ key: "pk", def: item({ name: "PantherKaiser" }), owner: P1, zone: "play" }]
  });
  megaRaw(b);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, true);
});

clause(LEO, "0:ability:mega", "a face-down card has no name (CR 411.1): a face-down 'PantherKaiser' cannot be depleted for the cost", () => {
  const b = leoBoard({
    panther: false,
    extra: [{ key: "pk", def: printing(PANTHER), owner: P1, zone: "play", faceDown: true }]
  });
  refused(() => megaRaw(b), "a face-down card has no name");
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, false);
});

clause(LEO, "0:ability:mega", "with two PantherKaisers you choose which one to deplete; the other stays ready", () => {
  const b = leoBoard({ extra: [{ key: "pk2", def: printing(PANTHER), owner: P1, zone: "play" }] });
  megaRaw(b, { pk: [b.id("pk2")], tk: [b.id("tk")] });
  assert.equal(b.engine.state.cards[b.id("pk2")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false);
});

clause(LEO, "0:ability:mega", "a card that is not named PantherKaiser cannot be picked for the PantherKaiser slot", () => {
  const b = leoBoard();
  refused(() => megaRaw(b, { pk: [b.id("ally")], tk: [b.id("tk")] }), "Ally is not a PantherKaiser");
  refused(() => megaRaw(b, { pk: [b.id("tk")], tk: [b.id("tk")] }), "TigerKaiser in the Panther slot");
  refused(() => megaRaw(b, { pk: [b.id("pk")], tk: [b.id("pk")] }), "PantherKaiser in the Tiger slot");
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false);
});

clause(LEO, "0:ability:mega", "usable while Leo himself is depleted (the cost does not need him ready)", () => {
  const b = leoBoard({ leoDepleted: true });
  mega(b);
  assert.deepEqual(stat(b.engine, b.id("leo")), [11, 11, 5]);
  assert.equal(b.engine.state.cards[b.id("leo")].depleted, true);
});

clause(LEO, "0:ability:mega", "cannot be used twice in a turn: both Kaisers are depleted afterwards", () => {
  const b = leoBoard();
  mega(b);
  refused(() => megaRaw(b), "both Kaisers are depleted");
  assert.deepEqual(stat(b.engine, b.id("leo")), [11, 11, 5], "bonus applied once");
});

clause(LEO, "0:ability:mega", "usable again on a later turn, once the Kaisers have been restored", () => {
  const b = leoBoard();
  mega(b);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false, "restored at the start of my turn");
  mega(b);
  assert.deepEqual(stat(b.engine, b.id("leo")), [11, 11, 5]);
});

clause(LEO, "0:ability:mega", "only Leo's controller can use it", () => {
  const b = leoBoard();
  refused(() => activateRaw(b.engine, P2, b.id("leo"), "mega", megaSel(b.id)), "the opponent");
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false);
});

clause(LEO, "0:ability:mega", "a lone Leo cannot be blocked by a party of 1 or 2, but a party of 3 (or 4) can block him", () => {
  for (const [keys, ok] of [
    [["b1"], false],
    [["b1", "b2"], false],
    [["b1", "b2", "b3"], true],
    [["b1", "b2", "b3", "b4"], true]
  ] as const) {
    const b = leoBoard();
    mega(b);
    declareAttackBy(b.engine, P1, [b.id("leo")]);
    if (ok) {
      blockWith(b, [...keys])();
      assert.equal(battleOf(b.engine)?.blockingParty.length, keys.length, `${keys.length} blockers are allowed`);
    } else {
      refused(blockWith(b, [...keys]), `a party of ${keys.length} cannot block a lone Leo`);
    }
  }
});

clause(LEO, "0:ability:mega", "a lone Leo can still be left unblocked, and attacking is unaffected", () => {
  const b = leoBoard();
  mega(b);
  declareAttackBy(b.engine, P1, [b.id("leo")]);
  blockWith(b, [])();
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.players[P2].influence, 30 - 11, "Leo's 11 strength hit the faction");
});

clause(LEO, "0:ability:mega", "control: without the ability a single blocker can block Leo", () => {
  const b = leoBoard();
  declareAttackBy(b.engine, P1, [b.id("leo")]);
  blockWith(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(LEO, "0:ability:mega", "with another member in the attacking party Leo is not the only member: a single blocker may block", () => {
  const b = leoBoard();
  mega(b);
  declareAttackBy(b.engine, P1, [b.id("leo"), b.id("ally")]);
  blockWith(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(LEO, "0:ability:mega", "used in the attack's response window (after attacking alone) it still restricts the blocking party", () => {
  const b = leoBoard();
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("leo")], target: { type: "faction", playerId: P2 } });
  activate(b.engine, P1, b.id("leo"), "mega", { selected: megaSel(b.id) });
  assert.equal(battleOf(b.engine)?.phase, "blocking");
  refused(blockWith(b, ["b1", "b2"]), "a party of 2");
  blockWith(b, ["b1", "b2", "b3"])();
  assert.equal(battleOf(b.engine)?.blockingParty.length, 3);
});

clause(LEO, "0:ability:mega", "the unblockable-by-small-parties effect lasts this turn only: next turn a single blocker can block a lone Leo", () => {
  const b = leoBoard();
  mega(b);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("leo")]);
  blockWith(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(LEO, "0:ability:mega", "the speed is real: a 5-speed Leo strikes before a 4-speed blocker", () => {
  const fast = character({ name: "Fast", strength: 20, life: 3, speed: 4 });
  const b = leoBoard({ extra: [{ key: "f1", def: fast, owner: P2, zone: "play" }, { key: "f2", def: fast, owner: P2, zone: "play" }, { key: "f3", def: fast, owner: P2, zone: "play" }] });
  mega(b);
  declareAttackBy(b.engine, P1, [b.id("leo")]);
  blockWith(b, ["f1", "f2", "f3"])();
  autoResolveBattle(b.engine, (source) => {
    const target = source.legalTargets[0];
    return target && source.strength > 0 ? [{ sourceId: source.cardId, target, amount: source.strength }] : [];
  });
  assert.equal(zoneOf(b.engine, b.id("f1")), "discard", "Leo (speed 5) killed the first blocker before it could strike");
});

clause(LEO, "0:ability:mega", "costs 4 with [E][E][E] and has printed stats 3/3/3", () => {
  const spec: DeploySpec = { printingId: LEO, cost: 4, icon: "elitism", iconCount: 3 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  const b = leoBoard();
  assert.deepEqual(stat(b.engine, b.id("leo")), [3, 3, 3]);
});

// ===============================================================================
// PantherKaiser
// PANTHER SHIELD -- COST: Pay 2. Deplete this card. Pick a character. EFFECT: This
// turn, the character gains 3 life.
// Character (kaiser), cost 4, threshold [E][E], 1/3/2.
// ===============================================================================

function pantherBoard(opts: { resources?: number; depleted?: boolean; extra?: CardPlacement[]; active?: Pid; withFaceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "pk", def: printing(PANTHER), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...(opts.withFaceDown ? [{ key: "fd", def: character({ name: "FD" }), owner: P2, zone: "play" as const, faceDown: true }] : []),
      ...bank("greed", opts.resources ?? 4, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const shield = (b: ReturnType<typeof pantherBoard>, target: string, pk = "pk") => activate(b.engine, P1, b.id(pk), "shield", { selected: { c: [b.id(target)] } });
const shieldRaw = (b: ReturnType<typeof pantherBoard>, target: string, pk = "pk") => activateRaw(b.engine, P1, b.id(pk), "shield", { c: [b.id(target)] });

clause(PANTHER, "0:ability:shield", "pays 2 and depletes PantherKaiser as the cost, on activation", () => {
  const b = pantherBoard();
  const before = ready(b.engine);
  shieldRaw(b, "ally");
  assert.equal(before - ready(b.engine), 2, "COST: pay 2");
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, true, "COST: deplete this card");
  assert.equal(b.engine.state.cards[b.id("ally")].depleted, false, "the picked character is not depleted");
  assert.deepEqual(stat(b.engine, b.id("ally")), [2, 3, 2], "the life is not gained until the ability resolves");
  resolvePendingResponses(b.engine);
  assert.deepEqual(stat(b.engine, b.id("ally")), [2, 6, 2], "EFFECT: +3 life only (not strength or speed)");
});

clause(PANTHER, "0:ability:shield", "any character can be picked: mine, the opponent's, or PantherKaiser itself", () => {
  for (const key of ["ally", "foe", "pk"]) {
    const b = pantherBoard();
    const base = stat(b.engine, b.id(key));
    shield(b, key);
    assert.deepEqual(stat(b.engine, b.id(key)), [base[0], base[1] + 3, base[2]], key);
  }
});

clause(PANTHER, "0:ability:shield", "only characters can be picked: an item, a location, a face-down card, a faction or nothing is refused, and nothing is paid", () => {
  const b = pantherBoard({ withFaceDown: true });
  const before = ready(b.engine);
  refused(() => shieldRaw(b, "thing"), "an item");
  refused(() => shieldRaw(b, "place"), "a location");
  refused(() => shieldRaw(b, "fd"), "a face-down card");
  refused(() => activateRaw(b.engine, P1, b.id("pk"), "shield", { c: [b.engine.state.players[P1].factionId!] }), "my faction");
  refused(() => activateRaw(b.engine, P1, b.id("pk"), "shield", { c: [b.engine.state.players[P2].factionId!] }), "the opponent's faction");
  refused(() => activateRaw(b.engine, P1, b.id("pk"), "shield", {}), "no pick");
  assert.equal(ready(b.engine), before, "nothing was paid");
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false, "PantherKaiser was not depleted");
  shield(b, "ally");
  assert.equal(stat(b.engine, b.id("ally"))[1], 6, "control: a character works");
});

clause(PANTHER, "0:ability:shield", "needs 2 resources of any kind (no threshold): one is refused, two are enough", () => {
  const one = pantherBoard({ resources: 1 });
  refused(() => shieldRaw(one, "ally"), "one resource is short");
  assert.equal(one.engine.state.cards[one.id("pk")].depleted, false, "no partial payment");
  assert.equal(ready(one.engine), 1);
  const two = pantherBoard({ resources: 2 });
  shield(two, "ally");
  assert.equal(stat(two.engine, two.id("ally"))[1], 6);
  assert.equal(ready(two.engine), 0);
});

clause(PANTHER, "0:ability:shield", "a depleted PantherKaiser cannot use it, and nothing is paid", () => {
  const b = pantherBoard({ depleted: true });
  refused(() => shieldRaw(b, "ally"), "already depleted");
  assert.equal(ready(b.engine), 4);
  assert.deepEqual(stat(b.engine, b.id("ally")), [2, 3, 2]);
});

clause(PANTHER, "0:ability:shield", "cannot be used twice in a turn (it depletes), but again after it is restored", () => {
  const b = pantherBoard({ resources: 8 });
  shield(b, "ally");
  refused(() => shieldRaw(b, "ally"), "depleted");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  shield(b, "ally");
  assert.equal(stat(b.engine, b.id("ally"))[1], 6);
});

clause(PANTHER, "0:ability:shield", "the life lasts this turn only", () => {
  const b = pantherBoard();
  shield(b, "ally");
  assert.equal(stat(b.engine, b.id("ally"))[1], 6);
  endTurn(b.engine, P1);
  assert.equal(stat(b.engine, b.id("ally"))[1], 3);
});

clause(PANTHER, "0:ability:shield", "two PantherKaisers shielding one character stack to +6 life", () => {
  const b = pantherBoard({ resources: 6, extra: [{ key: "pk2", def: printing(PANTHER), owner: P1, zone: "play" }] });
  shield(b, "ally", "pk");
  shield(b, "ally", "pk2");
  assert.equal(stat(b.engine, b.id("ally"))[1], 9);
});

clause(PANTHER, "0:ability:shield", "only PantherKaiser's controller can use it", () => {
  const b = pantherBoard();
  refused(() => activateRaw(b.engine, P2, b.id("pk"), "shield", { c: [b.id("foe")] }), "the opponent");
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false);
});

clause(PANTHER, "0:ability:shield", "the extra life is real: a shielded 3-life character survives 5 damage, an unshielded one does not", () => {
  const board = (shielded: boolean) => {
    const b = pantherBoard({ resources: 4, extra: [{ key: "zap", def: zapTactic(5), owner: P1, zone: "hand" }] });
    if (shielded) shield(b, "ally");
    play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("ally")] } });
    return b;
  };
  const shielded = board(true);
  assert.equal(zoneOf(shielded.engine, shielded.id("ally")), "play", "6 life, 5 damage");
  const bare = board(false);
  assert.equal(zoneOf(bare.engine, bare.id("ally")), "discard", "control: 3 life, 5 damage");
});

clause(PANTHER, "0:ability:shield", "can be used as a response during the opponent's attack to save a blocker", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "pk", def: printing(PANTHER), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 5, life: 9, speed: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("blk")] });
  passUntil(b.engine, P1);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  activateRaw(b.engine, P1, b.id("pk"), "shield", { c: [b.id("blk")] });
  resolvePendingResponses(b.engine);
  autoResolveBattle(b.engine, (source) => {
    const target = source.legalTargets[0];
    return target && source.strength > 0 ? [{ sourceId: source.cardId, target, amount: source.strength }] : [];
  });
  assert.equal(zoneOf(b.engine, b.id("blk")), "play", "6 life vs 5 damage: the blocker survives");
});

clause(PANTHER, "0:ability:shield", "costs 4 with [E][E] and has printed stats 1/3/2", () => {
  const spec: DeploySpec = { printingId: PANTHER, cost: 4, icon: "elitism", iconCount: 2 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  const b = pantherBoard();
  assert.deepEqual(stat(b.engine, b.id("pk")), [1, 3, 2]);
});

// ===============================================================================
// Micromajig Shipping Container
// If this card is destroyed, put 5 Micromajig tokens into play under your control.
// -- (Treat Micromajig tokens as Gearsmith character cards with 1 strength, 1 life, and
// 3 speed. If a Micromajig token would leave play, remove it from the game instead.)
// Character (container), cost 6, threshold [E][E], 4/5/3.
// ===============================================================================

const MSC = "c466319c-2c2d-48eb-8511-4033385a6c30";

/** A free tactic that sends one chosen card in play to `to` (id `s`, declaration `t`). */
function sendTactic(to: "hand" | "deck" | "void" | "remove" | "destroy"): CardDefinition {
  const effect =
    to === "destroy"
      ? { type: "destroy" as const, target: { type: "selected" as const, id: "t" } }
      : to === "remove"
        ? { type: "removeFromGame" as const, target: { type: "selected" as const, id: "t" } }
        : { type: "moveCard" as const, target: { type: "selected" as const, id: "t" }, to };
  return tactic({
    name: `Send-${to}`,
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [effect] }] }
  });
}

/** A free tactic that destroys any one card in play, face-down cards included (id `d`, declaration `t`). */
const destroyAnyTactic = (): CardDefinition =>
  tactic({
    name: "DestroyAny",
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });

/** The Micromajig tokens `player` controls in play. */
function micromajigs(engine: SpoilsEngine, player: Pid = P1): string[] {
  return Object.values(engine.state.cards)
    .filter((c) => c.zone === "play" && c.controllerId === player && engine.getDefinition(c.id).name === "Micromajig")
    .map((c) => c.id);
}

/** A token that left play is out of the game: in no hand, deck, discard pile or play area. */
function assertTokenGone(engine: SpoilsEngine, cardId: string, label: string) {
  const card = engine.state.cards[cardId];
  assert.ok(card === undefined || card.zone === "removed", `${label}: the token is out of the game (zone ${card?.zone})`);
  for (const player of [P1, P2] as const) {
    assert.equal(discardOf(engine, player).includes(cardId), false, `${label}: not in ${player}'s discard pile`);
    assert.equal(hand(engine, player).includes(cardId), false, `${label}: not in ${player}'s hand`);
    assert.equal(deckOf(engine, player).includes(cardId), false, `${label}: not in ${player}'s deck`);
    assert.equal(engine.state.players[player].play.includes(cardId), false, `${label}: not in ${player}'s play area`);
  }
}

function mscBoard(opts: { owner?: Pid; controller?: Pid; faceDown?: boolean; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "msc", def: printing(MSC), owner: opts.owner ?? P1, controller: opts.controller, zone: "play", faceDown: opts.faceDown },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic({ name: "Kill2" }), owner: P1, zone: "hand" },
      { key: "destroyAny", def: destroyAnyTactic(), owner: P1, zone: "hand" },
      { key: "zap1", def: zapTactic(1, "Zap1"), owner: P1, zone: "hand" },
      { key: "zap4", def: zapTactic(4, "Zap4"), owner: P1, zone: "hand" },
      { key: "zap5", def: zapTactic(5, "Zap5"), owner: P1, zone: "hand" },
      { key: "sendHand", def: sendTactic("hand"), owner: P1, zone: "hand" },
      { key: "sendDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
      { key: "sendVoid", def: sendTactic("void"), owner: P1, zone: "hand" },
      { key: "sendRemove", def: sendTactic("remove"), owner: P1, zone: "hand" },
      { key: "sendDestroy", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 6, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("fill", 4, P1, "deck"),
      ...fillers("ofill", 3, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

/** Destroys the Shipping Container with the free Kill tactic. */
const killMsc = (b: ReturnType<typeof mscBoard>, key = "msc", tacticKey = "kill") => {
  play(b.engine, P1, b.id(tacticKey), { selected: { t: [b.id(key)] } });
  drain(b.engine, declineAll);
};

clause(MSC, "0:rule", "destroyed, it puts exactly 5 Micromajig tokens into play under its controller's control (none for the opponent)", () => {
  const b = mscBoard();
  killMsc(b);
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard");
  assert.equal(micromajigs(b.engine, P1).length, 5, "five tokens for me");
  assert.equal(micromajigs(b.engine, P2).length, 0, "none for the opponent");
  for (const t of micromajigs(b.engine, P1)) {
    assert.equal(b.engine.state.cards[t].zone, "play");
    assert.equal(b.engine.state.cards[t].ownerId, P1, "the owner of a card token is the player who controlled the effect (CR 409.3b)");
    assert.equal(b.engine.state.cards[t].depleted, false);
  }
});

clause(MSC, "0:rule", "destroyed by non-battle damage it puts the 5 tokens into play", () => {
  const b = mscBoard();
  play(b.engine, P1, b.id("zap5"), { selected: { t: [b.id("msc")] } });
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard", "5 damage destroys the 5-life container");
  assert.equal(micromajigs(b.engine, P1).length, 5);
});

clause(MSC, "0:rule", "destroyed by battle damage (as a blocker) it puts the 5 tokens into play", () => {
  const b = mscBoard({ active: P2 });
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("msc")] });
  autoResolveBattle(b.engine);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard", "6 battle damage destroys the container");
  assert.equal(micromajigs(b.engine, P1).length, 5);
});

clause(MSC, "0:rule", "destroyed as the cost of one of my own abilities, it still puts the 5 tokens into play", () => {
  const sac = item({
    name: "Sac",
    behavior: {
      abilities: [
        {
          id: "sac",
          type: "activated",
          targets: [{ id: "s", selector: { controller: "self", type: "character" }, count: 1 }],
          costs: [{ type: "destroy", target: { type: "selected", id: "s" } }],
          effects: []
        }
      ]
    }
  });
  const b = mscBoard({ extra: [{ key: "sac", def: sac, owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("sac"), "sac", { selected: { s: [b.id("msc")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard");
  assert.equal(micromajigs(b.engine, P1).length, 5);
});

clause(MSC, "0:rule", "'under your control': a container I control but the opponent owns puts the tokens under MY control", () => {
  const b = mscBoard({ owner: P2, controller: P1 });
  killMsc(b);
  assert.equal(micromajigs(b.engine, P1).length, 5, "tokens go to the controller");
  assert.equal(micromajigs(b.engine, P2).length, 0);
  for (const t of micromajigs(b.engine, P1)) assert.equal(b.engine.state.cards[t].ownerId, P1, "owned by whoever controlled the effect");
});

clause(MSC, "0:rule", "the opponent's container, destroyed, puts the tokens under the opponent's control", () => {
  const b = mscBoard({ owner: P2 });
  killMsc(b);
  assert.equal(micromajigs(b.engine, P2).length, 5);
  assert.equal(micromajigs(b.engine, P1).length, 0);
});

clause(MSC, "0:rule", "two destroyed containers make ten tokens", () => {
  const b = mscBoard({ extra: [{ key: "msc2", def: printing(MSC), owner: P1, zone: "play" }] });
  killMsc(b, "msc", "kill");
  assert.equal(micromajigs(b.engine, P1).length, 5);
  killMsc(b, "msc2", "kill2");
  assert.equal(micromajigs(b.engine, P1).length, 10);
});

clause(MSC, "0:rule", "a container that merely leaves play (returned to hand, removed from the game, put in the deck or void) was not destroyed: no tokens", () => {
  for (const [key, zone] of [["sendHand", "hand"], ["sendRemove", "removed"], ["sendDeck", "deck"], ["sendVoid", "void"]] as const) {
    const b = mscBoard();
    play(b.engine, P1, b.id(key), { selected: { t: [b.id("msc")] } });
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id("msc")), zone, `the container went to ${zone}`);
    assert.equal(micromajigs(b.engine, P1).length, 0, `${key}: no tokens`);
  }
});

clause(MSC, "0:rule", "a face-down container is only a resource: destroying it makes no tokens", () => {
  const b = mscBoard({ faceDown: true });
  assert.equal(b.engine.state.cards[b.id("msc")].faceDown, true);
  play(b.engine, P1, b.id("destroyAny"), { selected: { t: [b.id("msc")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard", "the face-down card was destroyed");
  assert.equal(micromajigs(b.engine, P1).length, 0, "a face-down card has no rules text (CR 411.1)");
});

clause(MSC, "0:rule", "the tokens only appear when the container is destroyed: nothing before, and a damaged-but-alive container makes none", () => {
  const b = mscBoard();
  assert.equal(micromajigs(b.engine, P1).length, 0);
  play(b.engine, P1, b.id("zap4"), { selected: { t: [b.id("msc")] } });
  assert.equal(zoneOf(b.engine, b.id("msc")), "play", "4 damage does not destroy a 5-life container");
  assert.equal(micromajigs(b.engine, P1).length, 0);
});

clause(MSC, "0:rule", "costs 6 with [E][E] and has printed stats 4/5/3", () => {
  const spec: DeploySpec = { printingId: MSC, cost: 6, icon: "elitism", iconCount: 2 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  const b = mscBoard();
  assert.deepEqual(stat(b.engine, b.id("msc")), [4, 5, 3]);
});

function mscTokens(b: ReturnType<typeof mscBoard>): string[] {
  killMsc(b);
  return micromajigs(b.engine, P1);
}

clause(MSC, "1:rule", "the tokens are character cards named Micromajig with exactly 1 strength, 1 life and 3 speed", () => {
  const b = mscBoard();
  const tokens = mscTokens(b);
  assert.equal(tokens.length, 5);
  for (const t of tokens) {
    const def = b.engine.getDefinition(t);
    assert.equal(def.name, "Micromajig");
    assert.equal(def.type, "character", "a character card");
    assert.deepEqual(b.engine.getCardTypes(t), ["character"]);
    assert.deepEqual(stat(b.engine, t), [1, 1, 3], "1 strength, 1 life, 3 speed");
    assert.equal(b.engine.state.cards[t].damage, 0);
  }
});

clause(MSC, "1:rule", "the tokens are GEARSMITH character cards", () => {
  const b = mscBoard();
  const tokens = mscTokens(b);
  assert.equal(tokens.length, 5);
  for (const t of tokens) assert.equal(b.engine.getDefinition(t).trade, "gearsmith");
});

clause(MSC, "1:rule", "the tokens carry the majig subtype (CR 409.3c / RULES.md 13)", () => {
  const b = mscBoard();
  const tokens = mscTokens(b);
  assert.equal(tokens.length, 5);
  for (const t of tokens) assert.deepEqual(b.engine.getSubtypes(t), ["majig"]);
});

clause(MSC, "1:rule", "a token leaving play any way (destroyed, returned to hand, put into the deck, put into the void, removed) is removed from the game: never in a hand, deck or discard pile", () => {
  const b = mscBoard();
  const tokens = mscTokens(b);
  const handBefore = [...hand(b.engine, P1)];
  const deckBefore = [...deckOf(b.engine, P1)];
  const discardBefore = [...discardOf(b.engine, P1)];
  const sends: Array<[string, string]> = [
    ["sendDestroy", "destroyed"],
    ["sendHand", "returned to hand"],
    ["sendDeck", "put into the deck"],
    ["sendVoid", "put into the void"],
    ["sendRemove", "removed from the game"]
  ];
  sends.forEach(([key, label], i) => {
    play(b.engine, P1, b.id(key), { selected: { t: [tokens[i]] } });
    drain(b.engine, declineAll);
    assertTokenGone(b.engine, tokens[i], label);
  });
  assert.equal(micromajigs(b.engine, P1).length, 0, "all five tokens are gone");
  assert.deepEqual(hand(b.engine, P1).filter((c) => !handBefore.includes(c)), [], "no token card entered the hand");
  assert.deepEqual(deckOf(b.engine, P1).filter((c) => !deckBefore.includes(c)), [], "no token card entered the deck");
  const sendKeys = new Set(sends.map(([k]) => b.id(k)));
  assert.deepEqual(
    discardOf(b.engine, P1).filter((c) => !discardBefore.includes(c) && !sendKeys.has(c)),
    [],
    "no token card entered the discard pile"
  );
});

clause(MSC, "1:rule", "a token dies to 1 damage (it has 1 life) and is removed from the game, not put into the discard pile", () => {
  const b = mscBoard();
  const [token, second] = mscTokens(b);
  const discardBefore = [...discardOf(b.engine, P1)];
  play(b.engine, P1, b.id("zap1"), { selected: { t: [token] } });
  assertTokenGone(b.engine, token, "killed by 1 damage");
  assert.equal(zoneOf(b.engine, second), "play", "the other tokens are untouched");
  assert.deepEqual(discardOf(b.engine, P1).filter((c) => !discardBefore.includes(c)), [b.id("zap1")], "only the tactic itself went to the discard pile");
});

clause(MSC, "1:rule", "a token that blocks and is killed in battle is removed from the game", () => {
  const b = mscBoard();
  killMsc(b);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const tokens = micromajigs(b.engine, P1);
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [tokens[0]] });
  autoResolveBattle(b.engine);
  assertTokenGone(b.engine, tokens[0], "killed in battle");
});

clause(MSC, "1:rule", "a token is a character: it can block", () => {
  const b = mscBoard();
  killMsc(b);
  endTurn(b.engine, P1);
  const token = micromajigs(b.engine, P1)[0];
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [token] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [token]);
});

clause(MSC, "1:rule", "a token put into play this turn cannot attack yet (a character put into play was not in play since the start of the turn)", () => {
  const b = mscBoard();
  const [token] = mscTokens(b);
  refused(() => attackRaw(b.engine, P1, [token]), "a token made this turn cannot attack");
  assert.equal(battleOf(b.engine), undefined);
});

// ===============================================================================
// Omnidirectional Patrolmajig
// If you are attacked and this card is depleted, you may restore this card.
// Character (majig), cost 6, threshold [E], 3/6/2.
// ===============================================================================

const OP = "118e132f-9ad3-45c7-825e-88b00941f8ef";

function opBoard(opts: { depleted?: boolean; opZone?: "play" | "hand"; active?: Pid; extra?: CardPlacement[]; oppOp?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "op", def: printing(OP), owner: P1, zone: opts.opZone ?? "play", depleted: opts.depleted ?? true },
      { key: "tired", def: character({ name: "Tired", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play", depleted: true },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 6 }), owner: P1, zone: "play" },
      { key: "atk1", def: character({ name: "Atk1", strength: 1, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 1, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "oloc", def: location({ name: "OLoc", structure: 6 }), owner: P2, zone: "play" },
      ...(opts.oppOp ? [{ key: "oop", def: printing(OP), owner: P2, zone: "play" as const, depleted: true }] : []),
      ...(opts.extra ?? [])
    ]
  });
}

type OpBoard = ReturnType<typeof opBoard>;

const attackFaction = (b: OpBoard, attacker: Pid, keys: string[]) =>
  b.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: keys.map(b.id), target: { type: "faction", playerId: other(attacker) } });
const attackCard = (b: OpBoard, attacker: Pid, keys: string[], targetKey: string) =>
  b.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: keys.map(b.id), target: { type: "card", cardId: b.id(targetKey) } });

clause(OP, "0:rule", "when I am attacked while it is depleted I am offered the choice to restore it, before blockers are declared", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is open right after the attack is declared");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the Patrolmajig's controller (the defender) decides");
  assert.equal(b.engine.state.cards[b.id("op")].depleted, true, "still depleted until I choose");
  assert.notEqual(battleOf(b.engine)?.phase, "blocking", "blockers are not being declared yet");
});

clause(OP, "0:rule", "accepting restores it, and the restored Patrolmajig can then block", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  chooseOption(b.engine, P1, /restore/i);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("op")].depleted, false, "restored");
  assert.equal(battleOf(b.engine)?.phase, "blocking");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("op")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("op")]);
});

clause(OP, "0:rule", "declining ('may') leaves it depleted, so it cannot block", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  chooseOption(b.engine, P1, /decline/i);
  assert.equal(b.engine.state.cards[b.id("op")].depleted, true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("op")] }), "a depleted character cannot block");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("mine")], "control: another character blocks");
});

clause(OP, "0:rule", "only the defender's Patrolmajig decides: the attacker cannot answer the choice", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 0 } } as never),
    "the attacker cannot decide for me"
  );
  assert.equal(b.engine.state.cards[b.id("op")].depleted, true);
  assert.ok(pending(b.engine), "the choice is still open");
});

clause(OP, "0:rule", "also triggers when the attack targets a location I control", () => {
  const b = opBoard();
  attackCard(b, P2, ["atk1"], "loc");
  const pc = pending(b.engine);
  assert.ok(pc, "I am being attacked: a location I control is the target of the attack");
  assert.equal(pc.playerId, P1);
  chooseOption(b.engine, P1, /restore/i);
  assert.equal(b.engine.state.cards[b.id("op")].depleted, false);
});

clause(OP, "0:rule", "does nothing when it is not depleted: no choice is offered", () => {
  const b = opBoard({ depleted: false });
  attackFaction(b, P2, ["atk1"]);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing to restore, so the trigger does not apply");
  assert.equal(battleOf(b.engine)?.phase !== undefined, true);
});

clause(OP, "0:rule", "a party of several attackers still gives exactly one offer", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1", "atk2"]);
  chooseOption(b.engine, P1, /restore/i);
  assert.equal(b.engine.state.pendingChoice, undefined, "no second offer");
  assert.equal(b.engine.state.cards[b.id("op")].depleted, false);
});

clause(OP, "0:rule", "restores only itself: another depleted character of mine stays depleted", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  chooseOption(b.engine, P1, /restore/i);
  assert.equal(b.engine.state.cards[b.id("tired")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("mine")].depleted, false);
});

clause(OP, "0:rule", "when I attack, I am not 'attacked': my depleted Patrolmajig is not offered a restore", () => {
  const b = opBoard({ active: P1 });
  attackFaction(b, P1, ["mine"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("op")].depleted, true);
});

clause(OP, "0:rule", "when I attack the opponent's location, I am still not the one being attacked", () => {
  const b = opBoard({ active: P1 });
  attackCard(b, P1, ["mine"], "oloc");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("op")].depleted, true);
});

clause(OP, "0:rule", "the opponent's own Patrolmajig works for them when I attack: its controller is offered the restore, not me", () => {
  const b = opBoard({ active: P1, oppOp: true });
  attackFaction(b, P1, ["mine"]);
  const pc = pending(b.engine);
  assert.ok(pc, "the defender (the opponent) is offered a restore");
  assert.equal(pc.playerId, P2);
  chooseOption(b.engine, P2, /restore/i);
  assert.equal(b.engine.state.cards[b.id("oop")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("op")].depleted, true, "mine, depleted, is not touched by an attack I made");
});

clause(OP, "0:rule", "not in play, it does nothing: a Patrolmajig in my hand raises no choice", () => {
  const b = opBoard({ opZone: "hand" });
  attackFaction(b, P2, ["atk1"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(OP, "0:rule", "every attack on me offers it again: after blocking (and being depleted by the battle) a second attack offers another restore", () => {
  const b = opBoard();
  attackFaction(b, P2, ["atk1"]);
  chooseOption(b.engine, P1, /restore/i);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("op")] });
  autoResolveBattle(b.engine);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("op")].depleted, true, "surviving battle characters are depleted (CR 609.1h)");
  attackFaction(b, P2, ["atk2"]);
  const pc = pending(b.engine);
  assert.ok(pc, "attacked again: another offer");
  chooseOption(b.engine, P1, /restore/i);
  assert.equal(b.engine.state.cards[b.id("op")].depleted, false);
});

clause(OP, "0:rule", "two Patrolmajigs are each offered their own restore", () => {
  const b = opBoard({ extra: [{ key: "op2", def: printing(OP), owner: P1, zone: "play", depleted: true }] });
  attackFaction(b, P2, ["atk1"]);
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
    return declineAll(pc);
  });
  assert.equal(b.engine.state.cards[b.id("op")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("op2")].depleted, false);
});

clause(OP, "0:rule", "costs 6 with [E] and has printed stats 3/6/2", () => {
  const spec: DeploySpec = { printingId: OP, cost: 6, icon: "elitism", iconCount: 1 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  const b = opBoard();
  assert.deepEqual(stat(b.engine, b.id("op")), [3, 6, 2]);
});

// ===============================================================================
// PantherKaiser is above. Patent Enforcement:
// COST: Play this only in response to an item being played. Pay X, where X is that
// item's numeric cost. EFFECT: The item enters play under your control.
// Tactic, cost 0, threshold [E][E][E].
// ===============================================================================

const PATENT = "b3ed1ba4-1a95-4da5-94d0-f8dc5f59b36d";

const etbDraw = (name: string, cost: number) =>
  item({
    name,
    cost,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });

function patentBoard(opts: { itemCost?: number; elitism?: number; greed?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "pe", def: printing(PATENT), owner: P1, zone: "hand" },
      { key: "oi", def: item({ name: "OppItem", cost: opts.itemCost ?? 3 }), owner: P2, zone: "hand" },
      { key: "oc", def: character({ name: "OppChar", cost: 2 }), owner: P2, zone: "hand" },
      { key: "ol", def: location({ name: "OppLoc", cost: 2 }), owner: P2, zone: "hand" },
      { key: "ot", def: tactic({ name: "OppTactic", cost: 2, behavior: { abilities: [{ id: "blank", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" },
      { key: "mine", def: item({ name: "MineItem", cost: 2 }), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", 10, P2),
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 starts playing `key`; returns once P1 may respond. */
const opponentPlays = (b: ReturnType<typeof patentBoard>, key: string) => playRaw(b.engine, P2, b.id(key));

for (const cost of [0, 1, 3, 5]) {
  clause(PATENT, "0:ability", `in response to a cost-${cost} item: pays exactly ${cost} (the item's numeric cost) and the item enters play under my control`, () => {
    const b = patentBoard({ itemCost: cost });
    opponentPlays(b, "oi");
    assert.equal(b.engine.getCardPlayability(P1, b.id("pe")).playable, true, "playable in response to an item");
    const before = ready(b.engine);
    playRaw(b.engine, P1, b.id("pe"));
    assert.equal(before - ready(b.engine), cost, "X = the item's numeric cost, paid when the tactic is played");
    resolvePendingResponses(b.engine);
    assert.equal(zoneOf(b.engine, b.id("oi")), "play", "the item entered play");
    assert.equal(b.engine.state.cards[b.id("oi")].controllerId, P1, "under my control");
    assert.equal(b.engine.state.cards[b.id("oi")].ownerId, P2, "ownership never changes");
    assert.equal(zoneOf(b.engine, b.id("pe")), "discard", "the tactic goes to its owner's discard pile");
    assert.equal(b.engine.state.players[P1].play.includes(b.id("oi")), true);
    assert.equal(b.engine.state.players[P2].play.includes(b.id("oi")), false, "the opponent does not get it");
  });
}

clause(PATENT, "0:ability", "the opponent's item does not enter play for the opponent: its enters-play trigger works for me, and the opponent gets nothing", () => {
  const b = patentBoard({ itemCost: 2, extra: [{ key: "oetb", def: etbDraw("OppEtb", 2), owner: P2, zone: "hand" }] });
  const myHand = hand(b.engine, P1).length;
  const oppHand = hand(b.engine, P2).length;
  opponentPlays(b, "oetb");
  playRaw(b.engine, P1, b.id("pe"));
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("oetb")), "play");
  assert.equal(b.engine.state.cards[b.id("oetb")].controllerId, P1);
  assert.equal(hand(b.engine, P1).length, myHand - 1 + 1, "I played the tactic and drew from the item's trigger");
  assert.equal(hand(b.engine, P2).length, oppHand - 1, "the opponent only lost the item from hand: no draw for them");
});

clause(PATENT, "0:ability", "the stolen item is mine to use: I can activate its ability, the opponent cannot", () => {
  const ping = item({ name: "Pinger", cost: 1, behavior: { abilities: [{ id: "ping", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const b = patentBoard({ extra: [{ key: "ping", def: ping, owner: P2, zone: "hand" }] });
  opponentPlays(b, "ping");
  playRaw(b.engine, P1, b.id("pe"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ping")), "play");
  const handBefore = hand(b.engine, P1).length;
  refused(() => activateRaw(b.engine, P2, b.id("ping"), "ping"), "the opponent no longer controls it");
  endTurn(b.engine, P2);
  activate(b.engine, P1, b.id("ping"), "ping");
  assert.equal(hand(b.engine, P1).length, handBefore + 1, "I used the item's ability");
});

clause(PATENT, "0:ability", "only in response to an ITEM: refused when the opponent is playing a character, a location or a tactic", () => {
  for (const key of ["oc", "ol", "ot"]) {
    const b = patentBoard();
    opponentPlays(b, key);
    assert.equal(b.engine.getCardPlayability(P1, b.id("pe")).playable, false, `not playable against ${key}`);
    const before = ready(b.engine);
    refused(() => playRaw(b.engine, P1, b.id("pe")), `responding to ${key}`);
    assert.equal(zoneOf(b.engine, b.id("pe")), "hand");
    assert.equal(ready(b.engine), before, "nothing was paid");
  }
});

clause(PATENT, "0:ability", "only in response to something being played: with nothing on the stack (my own turn, or the opponent's idle turn) it is refused", () => {
  const mine = patentBoard({ active: P1 });
  assert.equal(mine.engine.getCardPlayability(P1, mine.id("pe")).playable, false);
  refused(() => playRaw(mine.engine, P1, mine.id("pe")), "my own turn, nothing to respond to");
  assert.equal(zoneOf(mine.engine, mine.id("pe")), "hand");
  const idle = patentBoard({ active: P2 });
  refused(() => playRaw(idle.engine, P1, idle.id("pe")), "opponent's turn but nothing played");
  assert.equal(zoneOf(idle.engine, idle.id("pe")), "hand");
  assert.equal(ready(idle.engine), 8, "nothing was paid");
});

clause(PATENT, "0:ability", "I cannot use it against my own item (you cannot respond to your own actions)", () => {
  const b = patentBoard({ active: P1, extra: [{ key: "pe2", def: printing(PATENT), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("mine"));
  // "not your priority" is exactly the right reason here (CR 607.1: you cannot respond to your own action)
  refused(() => playRaw(b.engine, P1, b.id("pe")), "my own item: I hold no priority to respond to my own action", /priority/);
  assert.equal(zoneOf(b.engine, b.id("mine")) === "deploying" || zoneOf(b.engine, b.id("mine")) === "play", true);
});

clause(PATENT, "0:ability", "the opponent can use it too, against an item I play (on my turn)", () => {
  const b = patentBoard({ active: P1, extra: [{ key: "pe2", def: printing(PATENT), owner: P2, zone: "hand" }, ...bank("elitism", 8, P2)] });
  playRaw(b.engine, P1, b.id("mine"));
  playRaw(b.engine, P2, b.id("pe2"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(b.engine.state.cards[b.id("mine")].controllerId, P2, "stolen by the opponent");
  assert.equal(b.engine.state.cards[b.id("mine")].ownerId, P1);
});

clause(PATENT, "0:ability", "X must be affordable: a cost-4 item with only 3 resources is refused (nothing paid), 4 is enough", () => {
  const short = patentBoard({ itemCost: 4, elitism: 3 });
  opponentPlays(short, "oi");
  refused(() => playRaw(short.engine, P1, short.id("pe")), "3 resources for X = 4");
  assert.equal(ready(short.engine), 3);
  assert.equal(zoneOf(short.engine, short.id("pe")), "hand");
  const enough = patentBoard({ itemCost: 4, elitism: 4 });
  opponentPlays(enough, "oi");
  playRaw(enough.engine, P1, enough.id("pe"));
  resolvePendingResponses(enough.engine);
  assert.equal(enough.engine.state.cards[enough.id("oi")].controllerId, P1);
  assert.equal(ready(enough.engine), 0);
});

clause(PATENT, "0:ability", "needs [E][E][E]: with only two [E] (and plenty of other resources) or none it is refused", () => {
  for (const [elitism, greed] of [[2, 8], [0, 10]]) {
    const b = patentBoard({ itemCost: 2, elitism, greed });
    opponentPlays(b, "oi");
    assert.equal(b.engine.getCardPlayability(P1, b.id("pe")).thresholdMet, false);
    refused(() => playRaw(b.engine, P1, b.id("pe")), `${elitism} elitism`);
    assert.equal(zoneOf(b.engine, b.id("pe")), "hand");
  }
  const ok = patentBoard({ itemCost: 0, elitism: 3 });
  opponentPlays(ok, "oi");
  playRaw(ok.engine, P1, ok.id("pe"));
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("oi")].controllerId, P1, "exactly [E][E][E] is enough; the icons are a gate and X = 0 costs nothing");
  assert.equal(ready(ok.engine), 3, "the icons were not spent");
});

clause(PATENT, "0:ability", "the printed cost is 0: apart from X nothing else is paid", () => {
  const b = patentBoard({ itemCost: 2, elitism: 5 });
  opponentPlays(b, "oi");
  playRaw(b.engine, P1, b.id("pe"));
  resolvePendingResponses(b.engine);
  assert.equal(ready(b.engine), 3, "5 resources - X (2) = 3");
});

// ===============================================================================
// Quipmajig
// INSULT -- COST: Deplete this card. Pick a COVERT character. EFFECT: Deplete the
// character. This turn, the character cannot inflict damage.
// Character (majig), cost 3, threshold [E], 2/3/1.
// ===============================================================================

const QUIP = "04a9990f-2c23-4788-96da-17e120fa53b7";

const pingerCovert = (name: string) =>
  character({
    name,
    strength: 3,
    life: 4,
    speed: 2,
    behavior: {
      keywords: ["covert"],
      abilities: [
        {
          id: "ping",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "opponent" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
        }
      ]
    }
  });

function quipBoard(opts: { depleted?: boolean; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "quip", def: printing(QUIP), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "myCov", def: pingerCovert("MyCovert"), owner: P1, zone: "play" },
      { key: "myCov2", def: pingerCovert("MyCovert2"), owner: P1, zone: "play" },
      { key: "foeCov", def: covertChar("FoeCovert", { strength: 3, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foePlain", def: character({ name: "FoePlain", strength: 3, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: covertChar("FdCovert"), owner: P2, zone: "play", faceDown: true },
      ...bank("greed", 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type QuipBoard = ReturnType<typeof quipBoard>;
const insultRaw = (b: QuipBoard, target: string) => activateRaw(b.engine, P1, b.id("quip"), "insult", { c: [b.id(target)] });
const insult = (b: QuipBoard, target: string) => activate(b.engine, P1, b.id("quip"), "insult", { selected: { c: [b.id(target)] } });
const pingRaw = (b: QuipBoard, who: string, target = "foePlain") => activateRaw(b.engine, P1, b.id(who), "ping", { t: [b.id(target)] });
const damageOf = (b: QuipBoard, key: string) => b.engine.state.cards[b.id(key)].damage;

clause(QUIP, "0:ability:insult", "the cost is depleting Quipmajig and picking a covert character, paid on activation: no resources are spent and the picked character is not depleted yet", () => {
  const b = quipBoard();
  const before = ready(b.engine);
  insultRaw(b, "foeCov");
  assert.equal(b.engine.state.cards[b.id("quip")].depleted, true, "COST: deplete this card");
  assert.equal(b.engine.state.cards[b.id("foeCov")].depleted, false, "the picked character is depleted by the EFFECT, not the cost");
  assert.equal(ready(b.engine), before, "no resources are paid");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("foeCov")].depleted, true, "EFFECT: deplete the character");
});

clause(QUIP, "0:ability:insult", "the picked COVERT character can be the opponent's or mine", () => {
  const theirs = quipBoard();
  insult(theirs, "foeCov");
  assert.equal(theirs.engine.state.cards[theirs.id("foeCov")].depleted, true);
  const mine = quipBoard();
  insult(mine, "myCov");
  assert.equal(mine.engine.state.cards[mine.id("myCov")].depleted, true);
});

clause(QUIP, "0:ability:insult", "the character cannot inflict damage this turn: its ability's damage is 0, another covert character's is not", () => {
  const b = quipBoard();
  insult(b, "myCov");
  pingRaw(b, "myCov");
  resolvePendingResponses(b.engine);
  assert.equal(damageOf(b, "foePlain"), 0, "the insulted character inflicts no damage");
  pingRaw(b, "myCov2");
  resolvePendingResponses(b.engine);
  assert.equal(damageOf(b, "foePlain"), 2, "control: an ordinary covert character still does 2 damage");
});

clause(QUIP, "0:ability:insult", "the character's battle damage is 0 this turn: an insulted attacker deals no damage to the faction", () => {
  const dmg = (insulted: boolean) => {
    const b = quipBoard({ active: P2 });
    b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("foeCov")], target: { type: "faction", playerId: P1 } });
    b.engine.perform({ type: "passPriority", playerId: P2 });
    assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "the defender may respond");
    if (insulted) insultRaw(b, "foeCov");
    resolvePendingResponses(b.engine);
    b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(b.engine);
    return 30 - b.engine.state.players[P1].influence;
  };
  assert.equal(dmg(false), 3, "control: the covert attacker deals its 3");
  assert.equal(dmg(true), 0, "insulted: it inflicts no damage");
});

clause(QUIP, "0:ability:insult", "the insulted character deals no battle damage to a blocker either", () => {
  const b = quipBoard({ active: P2 });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("foeCov")], target: { type: "faction", playerId: P1 } });
  b.engine.perform({ type: "passPriority", playerId: P2 });
  insultRaw(b, "foeCov");
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("myCov")] });
  autoResolveBattle(b.engine);
  assert.equal(damageOf(b, "myCov"), 0, "the blocker took no damage from the insulted attacker");
  assert.equal(b.engine.state.players[P1].influence, 30);
});

clause(QUIP, "0:ability:insult", "the 'cannot inflict damage' only lasts this turn: next turn the character's damage works again", () => {
  const b = quipBoard();
  insult(b, "myCov");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.cards[b.id("myCov")].depleted, false, "restored at the start of my turn");
  pingRaw(b, "myCov");
  resolvePendingResponses(b.engine);
  assert.equal(damageOf(b, "foePlain"), 2);
});

clause(QUIP, "0:ability:insult", "only COVERT characters can be picked: a plain character, an item, a location, a face-down card, a faction or nothing is refused, and Quipmajig is not depleted", () => {
  const b = quipBoard();
  refused(() => insultRaw(b, "plain"), "a character without covert");
  refused(() => insultRaw(b, "foePlain"), "the opponent's character without covert");
  refused(() => insultRaw(b, "thing"), "an item");
  refused(() => insultRaw(b, "place"), "a location");
  refused(() => insultRaw(b, "fd"), "a face-down card has no keywords");
  refused(() => insultRaw(b, "quip"), "Quipmajig itself is not covert");
  refused(() => activateRaw(b.engine, P1, b.id("quip"), "insult", { c: [b.engine.state.players[P2].factionId!] }), "the opponent's faction");
  refused(() => activateRaw(b.engine, P1, b.id("quip"), "insult", {}), "no pick");
  assert.equal(b.engine.state.cards[b.id("quip")].depleted, false, "nothing was paid");
  insult(b, "foeCov");
  assert.equal(b.engine.state.cards[b.id("foeCov")].depleted, true, "control: a covert character is accepted");
});

clause(QUIP, "0:ability:insult", "a character that has gained COVERT this turn counts as a COVERT character", () => {
  const b = quipBoard({ extra: [{ key: "grant", def: grantTactic("covert"), owner: P1, zone: "hand" }] });
  refused(() => insultRaw(b, "plain"), "not covert yet");
  play(b.engine, P1, b.id("grant"), { selected: { t: [b.id("plain")] } });
  assert.ok(b.engine.getKeywords(b.id("plain")).includes("covert"), "b.engine.getKeywords(b.id(\"plain\")).includes(\"covert\")");
  insult(b, "plain");
  assert.equal(b.engine.state.cards[b.id("plain")].depleted, true);
});

clause(QUIP, "0:ability:insult", "an already-depleted covert character can still be picked: it stays depleted and still cannot inflict damage", () => {
  const b = quipBoard({ extra: [{ key: "tiredCov", def: pingerCovert("TiredCovert"), owner: P1, zone: "play", depleted: true }] });
  insult(b, "tiredCov");
  assert.equal(b.engine.state.cards[b.id("tiredCov")].depleted, true);
  pingRaw(b, "tiredCov");
  resolvePendingResponses(b.engine);
  assert.equal(damageOf(b, "foePlain"), 0);
});

clause(QUIP, "0:ability:insult", "a depleted Quipmajig cannot use it; it can be used once per restore", () => {
  const b = quipBoard({ depleted: true });
  refused(() => insultRaw(b, "foeCov"), "Quipmajig is depleted");
  assert.equal(b.engine.state.cards[b.id("foeCov")].depleted, false);
  const c = quipBoard();
  insult(c, "foeCov");
  refused(() => insultRaw(c, "myCov"), "depleted by its own cost");
  endTurn(c.engine, P1);
  endTurn(c.engine, P2);
  insult(c, "myCov");
  assert.equal(c.engine.state.cards[c.id("myCov")].depleted, true, "usable again after the restore");
});

clause(QUIP, "0:ability:insult", "only Quipmajig's controller can use it", () => {
  const b = quipBoard();
  refused(() => activateRaw(b.engine, P2, b.id("quip"), "insult", { c: [b.id("foeCov")] }), "the opponent");
  assert.equal(b.engine.state.cards[b.id("quip")].depleted, false);
});

clause(QUIP, "0:ability:insult", "costs 3 with [E] and has printed stats 2/3/1", () => {
  const spec: DeploySpec = { printingId: QUIP, cost: 3, icon: "elitism", iconCount: 1 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  const b = quipBoard();
  assert.deepEqual(stat(b.engine, b.id("quip")), [2, 3, 1]);
});

// ===============================================================================
// Runic Field Enhancer
// UNIQUE RUNIC FIELD ENHANCER -- All your characters gain 1 strength and 1 life for
// each gear card you control.
// Item, cost 5, threshold [E][E][E].
// ===============================================================================

const RFE = "35a182a8-dfd2-42c7-b5a3-f2a10dff9f40";

const gearItem = (name: string, cost = 0) => item({ name, cost, subtype: ["gear"] });
const rfeChar = (name: string) => character({ name, strength: 2, life: 3, speed: 2 });

function rfeBoard(opts: { rfe?: "play" | "hand"; elitism?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "rfe", def: printing(RFE), owner: P1, zone: opts.rfe ?? "play" },
      { key: "c1", def: rfeChar("C1"), owner: P1, zone: "play" },
      { key: "c2", def: rfeChar("C2"), owner: P1, zone: "play" },
      { key: "foe", def: rfeChar("Foe"), owner: P2, zone: "play" },
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const plusMine = (n: number) => [2 + n, 3 + n, 2];

clause(RFE, "0:unique", "controlling a second RFE makes you keep one: keeping the new one destroys the old one and play continues", () => {
  const b = rfeBoard({ extra: [{ key: "rfe2", def: printing(RFE), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("rfe2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.ok(pc, "a 'keep one' choice is open");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...pc.candidates].sort(), [b.id("rfe"), b.id("rfe2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("rfe2") } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("rfe2")), "play");
  assert.equal(zoneOf(b.engine, b.id("rfe")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.responseWindow, undefined, "the game is not stuck");
});

clause(RFE, "0:unique", "keeping the old one destroys the new one", () => {
  const b = rfeBoard({ extra: [{ key: "rfe2", def: printing(RFE), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("rfe2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("rfe") } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("rfe")), "play");
  assert.equal(zoneOf(b.engine, b.id("rfe2")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.responseWindow, undefined);
});

clause(RFE, "0:unique", "the choice is limited to the duplicates: another card cannot be 'kept'", () => {
  const b = rfeBoard({ extra: [{ key: "rfe2", def: printing(RFE), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("rfe2"));
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("c1") } } as never),
    "Mine is not a Runic Field Enhancer"
  );
  assert.ok(pending(b.engine), "the choice stays open");
});

clause(RFE, "0:unique", "the restriction is per player: the opponent may control their own, with no choice and no destruction", () => {
  const b = rfeBoard({ extra: [{ key: "orfe", def: printing(RFE), owner: P2, zone: "hand" }, ...bank("elitism", 6, P2)], active: P2 });
  play(b.engine, P2, b.id("orfe"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("rfe")), "play");
  assert.equal(zoneOf(b.engine, b.id("orfe")), "play");
});

clause(RFE, "0:unique", "taking control of the opponent's RFE while I have my own makes me keep one", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });
  const b = rfeBoard({ extra: [{ key: "orfe", def: printing(RFE), owner: P2, zone: "play" }, { key: "steal", def: steal, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("steal"), { selected: { t: [b.id("orfe")] } });
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor", "two RFEs under one player's control");
  assert.equal(pc?.playerId, P1);
});

clause(RFE, "0:unique", "a card with a different UNIQUE designation (or none) is not a duplicate", () => {
  const b = rfeBoard({ extra: [{ key: "other", def: item({ name: "OtherUnique", unique: "other unique" } as Partial<CardDefinition>), owner: P1, zone: "play" }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("rfe")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(RFE, "0:unique", "costs 5 with [E][E][E] and puts no choice up when it is the only RFE", () => {
  const spec: DeploySpec = { printingId: RFE, cost: 5, icon: "elitism", iconCount: 3 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  const b = rfeBoard({ rfe: "hand" });
  play(b.engine, P1, b.id("rfe"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("rfe")), "play");
});

clause(RFE, "1:rule", "with no gear card nothing changes (the enhancer itself is not a gear card)", () => {
  const { engine, id } = rfeBoard();
  assert.deepEqual(stat(engine, id("c1")), [2, 3, 2]);
  assert.deepEqual(stat(engine, id("c2")), [2, 3, 2]);
});

for (const n of [1, 2, 3]) {
  clause(RFE, "1:rule", `with ${n} gear card(s) I control, all my characters gain +${n} strength and +${n} life (speed unchanged)`, () => {
    const gears: CardPlacement[] = Array.from({ length: n }, (_, i) => ({ key: `g${i}`, def: gearItem(`G${i}`), owner: P1, zone: "play" as const }));
    const { engine, id } = rfeBoard({ extra: gears });
    assert.deepEqual(stat(engine, id("c1")), plusMine(n));
    assert.deepEqual(stat(engine, id("c2")), plusMine(n));
  });
}

clause(RFE, "1:rule", "only gear counts: other items and other subtypes add nothing", () => {
  const { engine, id } = rfeBoard({
    extra: [
      { key: "g0", def: gearItem("G0"), owner: P1, zone: "play" },
      { key: "plain", def: item({ name: "PlainItem" }), owner: P1, zone: "play" },
      { key: "gizmo", def: item({ name: "Gizmo", subtype: ["gizmo"] }), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual(stat(engine, id("c1")), plusMine(1));
});

clause(RFE, "1:rule", "only gear I control: the opponent's gear is not counted", () => {
  const { engine, id } = rfeBoard({
    extra: [
      { key: "g0", def: gearItem("G0"), owner: P1, zone: "play" },
      { key: "og0", def: gearItem("OG0"), owner: P2, zone: "play" },
      { key: "og1", def: gearItem("OG1"), owner: P2, zone: "play" }
    ]
  });
  assert.deepEqual(stat(engine, id("c1")), plusMine(1), "only my one gear card counts");
});

clause(RFE, "1:rule", "gear I control counts wherever it is attached: Heavy Plating on the opponent's character is mine and counts", () => {
  const { engine, id } = rfeBoard({ extra: [{ key: "hp", def: printing(HP), owner: P1, zone: "play", attachedToKey: "foe" }] });
  assert.deepEqual(stat(engine, id("c1")), plusMine(1));
  assert.deepEqual(stat(engine, id("foe")), [6, 7, 1], "the Plating's own bonus goes to the host (2+4, 3+4, 2-1); the enhancer does not buff the opponent");
});

clause(RFE, "1:rule", "gear on my own character: the host gets the enhancer bonus too (it is one of my characters)", () => {
  const { engine, id } = rfeBoard({ extra: [{ key: "hp", def: printing(HP), owner: P1, zone: "play", attachedToKey: "c1" }] });
  assert.deepEqual(stat(engine, id("c1")), [2 + 4 + 1, 3 + 4 + 1, 2 - 1]);
  assert.deepEqual(stat(engine, id("c2")), plusMine(1));
});

clause(RFE, "1:rule", "only gear in play counts: gear in hand, deck and discard pile adds nothing", () => {
  const { engine, id } = rfeBoard({
    extra: [
      { key: "gh", def: gearItem("GH"), owner: P1, zone: "hand" },
      { key: "gd", def: gearItem("GD"), owner: P1, zone: "deck" },
      { key: "gx", def: gearItem("GX"), owner: P1, zone: "discard" }
    ]
  });
  assert.deepEqual(stat(engine, id("c1")), [2, 3, 2]);
});

clause(RFE, "1:rule", "a face-down card has no subtype, so a face-down 'gear' card is not counted (CR 411.1)", () => {
  const { engine, id } = rfeBoard({ extra: [{ key: "gfd", def: gearItem("GFD"), owner: P1, zone: "play", faceDown: true }] });
  assert.deepEqual(stat(engine, id("c1")), [2, 3, 2], "a face-down card is only a resource");
});

clause(RFE, "1:rule", "'your characters' only: the opponent's characters gain nothing", () => {
  const { engine, id } = rfeBoard({ extra: [{ key: "g0", def: gearItem("G0"), owner: P1, zone: "play" }] });
  assert.deepEqual(stat(engine, id("foe")), [2, 3, 2]);
});

clause(RFE, "1:rule", "the opponent's own enhancer buffs their characters by their gear, and not mine", () => {
  const { engine, id } = rfeBoard({
    extra: [
      { key: "orfe", def: printing(RFE), owner: P2, zone: "play" },
      { key: "og0", def: gearItem("OG0"), owner: P2, zone: "play" },
      { key: "og1", def: gearItem("OG1"), owner: P2, zone: "play" },
      { key: "g0", def: gearItem("G0"), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual(stat(engine, id("foe")), plusMine(2), "their two gear cards");
  assert.deepEqual(stat(engine, id("c1")), plusMine(1), "my one gear card");
});

clause(RFE, "1:rule", "the bonus follows the gear count live: gear entering play adds, gear leaving play removes", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = rfeBoard({
    extra: [
      { key: "gearInHand", def: gearItem("GearInHand"), owner: P1, zone: "hand" },
      { key: "smash", def: smash, owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(stat(engine, id("c1")), [2, 3, 2]);
  play(engine, P1, id("gearInHand"));
  assert.deepEqual(stat(engine, id("c1")), plusMine(1), "gear entered play");
  play(engine, P1, id("smash"), { selected: { t: [id("gearInHand")] } });
  assert.equal(zoneOf(engine, id("gearInHand")), "discard");
  assert.deepEqual(stat(engine, id("c1")), [2, 3, 2], "gear left play");
});

clause(RFE, "1:rule", "a character deployed later gains the bonus at once", () => {
  const { engine, id } = rfeBoard({
    extra: [
      { key: "g0", def: gearItem("G0"), owner: P1, zone: "play" },
      { key: "late", def: rfeChar("Late"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("late"));
  assert.deepEqual(stat(engine, id("late")), plusMine(1));
});

clause(RFE, "1:rule", "the bonus is gone when the enhancer leaves play", () => {
  const { engine, id } = rfeBoard({
    extra: [
      { key: "g0", def: gearItem("G0"), owner: P1, zone: "play" },
      { key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(stat(engine, id("c1")), plusMine(1));
  play(engine, P1, id("kill"), { selected: { t: [id("rfe")] } });
  assert.equal(zoneOf(engine, id("rfe")), "discard");
  assert.deepEqual(stat(engine, id("c1")), [2, 3, 2]);
});

clause(RFE, "1:rule", "a face-down enhancer is only a resource and gives nothing", () => {
  const { engine, id } = rfeBoard({
    extra: [{ key: "g0", def: gearItem("G0"), owner: P1, zone: "play" }]
  });
  const fd = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "rfe", def: printing(RFE), owner: P1, zone: "play", faceDown: true },
      { key: "c1", def: rfeChar("C1"), owner: P1, zone: "play" },
      { key: "g0", def: gearItem("G0"), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual(stat(fd.engine, fd.id("c1")), [2, 3, 2]);
  assert.deepEqual(stat(engine, id("c1")), plusMine(1), "control");
});

clause(RFE, "1:rule", "the life is real: with two gear cards a 3-life character survives 4 damage, and is destroyed by it once the enhancer is gone", () => {
  const { engine, id } = rfeBoard({
    extra: [
      { key: "g0", def: gearItem("G0"), owner: P1, zone: "play" },
      { key: "g1", def: gearItem("G1"), owner: P1, zone: "play" },
      { key: "zap", def: zapTactic(4), owner: P1, zone: "hand" },
      { key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zap"), { selected: { t: [id("c1")] } });
  assert.equal(zoneOf(engine, id("c1")), "play", "5 life, 4 damage");
  play(engine, P1, id("kill"), { selected: { t: [id("rfe")] } });
  assert.equal(zoneOf(engine, id("c1")), "discard", "3 life, 4 damage");
});

// ===============================================================================
// Sagacious 31f
// If an attacking party is formed including this card and at least 2 other
// characters, you may search your deck for a card and put it into your hand.
// Character (31f), cost 4, threshold [E][E][E], 2/3/1.
// ===============================================================================

const S31 = "ac010020-67ca-4fbe-b1fa-74e261a76c84";

function s31Board(opts: { deck?: boolean; random?: () => number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: opts.random ?? (() => 0),
    cards: [
      { key: "s31", def: printing(S31), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe3", def: character({ name: "Foe3", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...(opts.deck === false
        ? []
        : [
            { key: "dChar", def: character({ name: "DChar" }), owner: P1, zone: "deck" as const },
            { key: "dItem", def: item({ name: "DItem" }), owner: P1, zone: "deck" as const },
            { key: "dTac", def: tactic({ name: "DTac" }), owner: P1, zone: "deck" as const },
            { key: "dLoc", def: location({ name: "DLoc" }), owner: P1, zone: "deck" as const },
            { key: "dRes", def: resourceCard({ name: "DRes" }), owner: P1, zone: "deck" as const }
          ]),
      { key: "oDeck", def: item({ name: "ODeck" }), owner: P2, zone: "deck" },
      { key: "inHand", def: item({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: item({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

type S31Board = ReturnType<typeof s31Board>;
const s31Attack = (b: S31Board, keys: string[], attacker: Pid = P1) =>
  b.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: keys.map(b.id), target: { type: "faction", playerId: other(attacker) } });

clause(S31, "0:rule", "attacking in a party of 3 with it offers the search, resolved before blockers", () => {
  const b = s31Board();
  s31Attack(b, ["s31", "a1", "a2"]);
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  assert.notEqual(battleOf(b.engine)?.phase, "blocking");
});

clause(S31, "0:rule", "choosing to search: any card of my deck can be picked and goes into my hand", () => {
  for (const key of ["dChar", "dItem", "dTac", "dLoc", "dRes"]) {
    const b = s31Board();
    s31Attack(b, ["s31", "a1", "a2"]);
    chooseOption(b.engine, P1, /search/i);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
    pick(b.engine, P1, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} is now in my hand`);
    assert.equal(hand(b.engine, P1).includes(b.id(key)), true);
    assert.equal(deckOf(b.engine, P1).length, 4, "the other four stay in the deck");
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(S31, "0:rule", "a party of 4 (it plus 3 others) also offers the search", () => {
  const b = s31Board();
  s31Attack(b, ["s31", "a1", "a2", "a3"]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(S31, "0:rule", "a party of 2 (it and one other) does not offer the search", () => {
  const b = s31Board();
  s31Attack(b, ["s31", "a1"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(deckOf(b.engine, P1).length, 5);
  assert.equal(hand(b.engine, P1).length, 1);
});

clause(S31, "0:rule", "attacking alone does not offer the search", () => {
  const b = s31Board();
  s31Attack(b, ["s31"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(S31, "0:rule", "a party of 3 that does not include it does not offer the search", () => {
  const b = s31Board();
  s31Attack(b, ["a1", "a2", "a3"]);
  assert.equal(b.engine.state.pendingChoice, undefined, "it stayed home");
  assert.equal(deckOf(b.engine, P1).length, 5);
});

clause(S31, "0:rule", "the opponent's attacking party of 3 does not offer me the search", () => {
  const b = s31Board({
    extra: [
      { key: "ofoe1", def: character({ name: "OFoe1" }), owner: P2, zone: "play" },
      { key: "ofoe2", def: character({ name: "OFoe2" }), owner: P2, zone: "play" }
    ]
  });
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  s31Attack(b, ["foe", "foe2", "foe3"], P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(S31, "0:rule", "declining ('may') puts nothing into my hand and leaves the deck as it was", () => {
  const b = s31Board();
  const deckBefore = [...deckOf(b.engine, P1)];
  const handBefore = [...hand(b.engine, P1)];
  s31Attack(b, ["s31", "a1", "a2"]);
  chooseOption(b.engine, P1, /decline/i);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
  assert.deepEqual(hand(b.engine, P1), handBefore);
});

clause(S31, "0:rule", "only cards of my own deck can be picked: not the opponent's deck, my hand or my discard pile", () => {
  const b = s31Board();
  s31Attack(b, ["s31", "a1", "a2"]);
  chooseOption(b.engine, P1, /search/i);
  refused(() => pickRaw(b.engine, P1, [b.id("oDeck")]), "the opponent's deck");
  refused(() => pickRaw(b.engine, P1, [b.id("inHand")]), "my hand");
  refused(() => pickRaw(b.engine, P1, [b.id("inDiscard")]), "my discard pile");
  refused(() => pickRaw(b.engine, P1, [b.id("a1")]), "a character in play");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  pick(b.engine, P1, [b.id("dItem")]);
  assert.equal(zoneOf(b.engine, b.id("dItem")), "hand", "control: a card of my deck works");
});

clause(S31, "0:rule", "exactly one card: two cards cannot be taken", () => {
  const b = s31Board();
  s31Attack(b, ["s31", "a1", "a2"]);
  chooseOption(b.engine, P1, /search/i);
  refused(() => pickRaw(b.engine, P1, [b.id("dItem"), b.id("dChar")]), "two cards");
  assert.equal(hand(b.engine, P1).length, 1);
});

clause(S31, "0:rule", "having chosen to search for 'a card', the search must find one (CR 312.2): taking nothing is refused", () => {
  const b = s31Board();
  s31Attack(b, ["s31", "a1", "a2"]);
  chooseOption(b.engine, P1, /search/i);
  refused(() => pickRaw(b.engine, P1, []), "an unconditional search must find a card when the deck has one");
});

clause(S31, "0:rule", "the deck is shuffled after the search (CR 312.1)", () => {
  const b = s31Board({ random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  s31Attack(b, ["s31", "a1", "a2"]);
  chooseOption(b.engine, P1, /search/i);
  pick(b.engine, P1, [b.id("dRes")]);
  const remaining = before.filter((c) => c !== b.id("dRes"));
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...remaining].sort(), "the same cards remain");
  assert.deepEqual(deckOf(b.engine, P1), shuffledWithConstant(remaining, 0), "and they were shuffled");
});

clause(S31, "0:rule", "with an empty deck choosing to search does nothing and breaks nothing", () => {
  const b = s31Board({ deck: false });
  s31Attack(b, ["s31", "a1", "a2"]);
  const handBefore = hand(b.engine, P1).length;
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc)));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(hand(b.engine, P1).length, handBefore);
  assert.ok(battleOf(b.engine), "the battle goes on");
});

clause(S31, "0:rule", "two Sagacious 31f in the same party of 3 each offer a search: two cards", () => {
  const b = s31Board({ extra: [{ key: "s31b", def: printing(S31), owner: P1, zone: "play" }] });
  s31Attack(b, ["s31", "s31b", "a1"]);
  let picks = 0;
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
    if (pc.kind === "chooserSelectsTarget") {
      picks += 1;
      return { kind: "chooserSelectsTarget", selected: [picks === 1 ? b.id("dItem") : b.id("dTac")] };
    }
    return declineAll(pc);
  });
  assert.equal(picks, 2, "two searches");
  assert.equal(zoneOf(b.engine, b.id("dItem")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dTac")), "hand");
});

clause(S31, "0:rule", "the search happens when the party is formed (on the attack), not later in the battle", () => {
  const b = s31Board();
  s31Attack(b, ["s31", "a1", "a2"]);
  chooseOption(b.engine, P1, /search/i);
  pick(b.engine, P1, [b.id("dItem")]);
  assert.equal(zoneOf(b.engine, b.id("dItem")), "hand");
  assert.ok(battleOf(b.engine), "the battle is still going on");
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined, "no second offer during the battle");
});

clause(S31, "0:rule", "costs 4 with [E][E][E] and has printed stats 2/3/1", () => {
  const spec: DeploySpec = { printingId: S31, cost: 4, icon: "elitism", iconCount: 3 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  const b = s31Board();
  assert.deepEqual(stat(b.engine, b.id("s31")), [2, 3, 1]);
});

// ===============================================================================
// Schproingmajig
// PUMP-UP -- COST: Deplete another character you control. EFFECT: This turn, this card
// gains 2 strength and 2 life.
// SCHPROING! -- COST: Destroy a character you control. EFFECT: This turn, while this
// card is the only member of an attacking party it cannot be blocked.
// Character (majig), cost 6, threshold [E][E], 4/4/2.
// ===============================================================================

const SCHPROING = "8041780e-69a0-458a-8563-eabfa164ac2f";

function smBoard(opts: { extra?: CardPlacement[]; active?: Pid; resources?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "sm", def: printing(SCHPROING), owner: P1, zone: "play" },
      { key: "o1", def: character({ name: "O1", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "o2", def: character({ name: "O2", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "tired", def: character({ name: "Tired", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Fd" }), owner: P1, zone: "play", faceDown: true },
      ...bank("greed", opts.resources ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type SmBoard = ReturnType<typeof smBoard>;
const pumpRaw = (b: SmBoard, target: string, who = "sm") => activateRaw(b.engine, P1, b.id(who), "pumpup", { o: [b.id(target)] });
const pump = (b: SmBoard, target: string, who = "sm") => activate(b.engine, P1, b.id(who), "pumpup", { selected: { o: [b.id(target)] } });
const schproingRaw = (b: SmBoard, target: string, who = "sm") => activateRaw(b.engine, P1, b.id(who), "schproing", { s: [b.id(target)] });
const schproing = (b: SmBoard, target: string, who = "sm") => activate(b.engine, P1, b.id(who), "schproing", { selected: { s: [b.id(target)] } });
const blockWithSm = (b: SmBoard, keys: string[]) => () => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: keys.map(b.id) });

clause(SCHPROING, "0:ability:pumpup", "the cost is depleting another character I control, paid on activation; no resources are paid and Schproingmajig is not depleted", () => {
  const b = smBoard();
  const before = ready(b.engine);
  pumpRaw(b, "o1");
  assert.equal(b.engine.state.cards[b.id("o1")].depleted, true, "COST: the other character is depleted");
  assert.equal(b.engine.state.cards[b.id("sm")].depleted, false, "Schproingmajig itself is not depleted");
  assert.equal(b.engine.state.cards[b.id("o2")].depleted, false);
  assert.equal(ready(b.engine), before, "no resources are paid");
  assert.deepEqual(stat(b.engine, b.id("sm")), [4, 4, 2], "the effect has not resolved yet");
});

clause(SCHPROING, "0:ability:pumpup", "this turn it gains exactly 2 strength and 2 life (speed unchanged)", () => {
  const b = smBoard();
  pump(b, "o1");
  assert.deepEqual(stat(b.engine, b.id("sm")), [6, 6, 2]);
  assert.deepEqual(stat(b.engine, b.id("o1")), [1, 3, 1], "the depleted character is not changed");
});

clause(SCHPROING, "0:ability:pumpup", "the boost lasts this turn only", () => {
  const b = smBoard();
  pump(b, "o1");
  endTurn(b.engine, P1);
  assert.deepEqual(stat(b.engine, b.id("sm")), [4, 4, 2]);
});

clause(SCHPROING, "0:ability:pumpup", "can be used again with another character: the boosts stack (+4/+4)", () => {
  const b = smBoard();
  pump(b, "o1");
  pump(b, "o2");
  assert.deepEqual(stat(b.engine, b.id("sm")), [8, 8, 2]);
});

clause(SCHPROING, "0:ability:pumpup", "the same character cannot be depleted twice: the second use on it is refused", () => {
  const b = smBoard();
  pump(b, "o1");
  refused(() => pumpRaw(b, "o1"), "already depleted");
  assert.deepEqual(stat(b.engine, b.id("sm")), [6, 6, 2], "only one boost");
});

clause(SCHPROING, "0:ability:pumpup", "'another': Schproingmajig itself cannot be the character depleted", () => {
  const b = smBoard();
  refused(() => pumpRaw(b, "sm"), "itself is not 'another'");
  assert.equal(b.engine.state.cards[b.id("sm")].depleted, false);
  assert.deepEqual(stat(b.engine, b.id("sm")), [4, 4, 2]);
});

clause(SCHPROING, "0:ability:pumpup", "another character means ANY other character I control, including a second Schproingmajig", () => {
  const b = smBoard({ extra: [{ key: "sm2", def: printing(SCHPROING), owner: P1, zone: "play" }] });
  pump(b, "sm2");
  assert.equal(b.engine.state.cards[b.id("sm2")].depleted, true, "the other Schproingmajig was depleted for the cost");
  assert.deepEqual(stat(b.engine, b.id("sm")), [6, 6, 2]);
});

clause(SCHPROING, "0:ability:pumpup", "the character must be one I control: the opponent's is refused, nothing is depleted", () => {
  const b = smBoard();
  refused(() => pumpRaw(b, "foe"), "the opponent's character");
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, false);
  assert.deepEqual(stat(b.engine, b.id("sm")), [4, 4, 2]);
});

clause(SCHPROING, "0:ability:pumpup", "the pick must be a character: an item, a location, a face-down card, a faction or nothing is refused", () => {
  const b = smBoard();
  refused(() => pumpRaw(b, "thing"), "an item");
  refused(() => pumpRaw(b, "place"), "a location");
  refused(() => pumpRaw(b, "fd"), "a face-down card");
  refused(() => activateRaw(b.engine, P1, b.id("sm"), "pumpup", { o: [b.engine.state.players[P1].factionId!] }), "my faction");
  refused(() => activateRaw(b.engine, P1, b.id("sm"), "pumpup", {}), "no pick");
  assert.deepEqual(stat(b.engine, b.id("sm")), [4, 4, 2]);
  pump(b, "o1");
  assert.deepEqual(stat(b.engine, b.id("sm")), [6, 6, 2], "control: another character works");
});

clause(SCHPROING, "0:ability:pumpup", "an already-depleted character cannot be depleted for the cost", () => {
  const b = smBoard();
  refused(() => pumpRaw(b, "tired"), "already depleted");
  assert.deepEqual(stat(b.engine, b.id("sm")), [4, 4, 2]);
});

clause(SCHPROING, "0:ability:pumpup", "a depleted Schproingmajig can still use it (the cost depletes another card, not itself)", () => {
  const b = smBoard();
  b.engine.state.cards[b.id("sm")].depleted = true;
  pump(b, "o1");
  assert.deepEqual(stat(b.engine, b.id("sm")), [6, 6, 2]);
});

clause(SCHPROING, "0:ability:pumpup", "only the controller can use it", () => {
  const b = smBoard();
  refused(() => activateRaw(b.engine, P2, b.id("sm"), "pumpup", { o: [b.id("foe")] }), "the opponent");
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, false);
});

clause(SCHPROING, "0:ability:pumpup", "the life is real: the boosted Schproingmajig survives 5 damage", () => {
  const b = smBoard({ extra: [{ key: "zap", def: zapTactic(5), owner: P1, zone: "hand" }] });
  pump(b, "o1");
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("sm")] } });
  assert.equal(zoneOf(b.engine, b.id("sm")), "play", "6 life, 5 damage");
});

clause(SCHPROING, "1:ability:schproing", "the cost is destroying a character I control, paid on activation (it is already in the discard pile before the ability resolves); no resources are paid", () => {
  const b = smBoard();
  const before = ready(b.engine);
  schproingRaw(b, "o1");
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard", "COST: destroy a character you control");
  assert.equal(zoneOf(b.engine, b.id("o2")), "play", "only the chosen one");
  assert.equal(ready(b.engine), before, "no resources are paid");
});

clause(SCHPROING, "1:ability:schproing", "any character I control can be destroyed for it, Schproingmajig itself included", () => {
  const b = smBoard();
  schproing(b, "sm");
  assert.equal(zoneOf(b.engine, b.id("sm")), "discard", "it may destroy itself");
  const c = smBoard();
  schproing(c, "tired");
  assert.equal(zoneOf(c.engine, c.id("tired")), "discard", "a depleted character can be destroyed");
});

clause(SCHPROING, "1:ability:schproing", "the character must be one I control: the opponent's is refused, nothing is destroyed", () => {
  const b = smBoard();
  refused(() => schproingRaw(b, "foe"), "the opponent's character");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(SCHPROING, "1:ability:schproing", "the pick must be a character: an item, a location, a face-down card, a faction or nothing is refused", () => {
  const b = smBoard();
  refused(() => schproingRaw(b, "thing"), "an item");
  refused(() => schproingRaw(b, "place"), "a location");
  refused(() => schproingRaw(b, "fd"), "a face-down card");
  refused(() => activateRaw(b.engine, P1, b.id("sm"), "schproing", { s: [b.engine.state.players[P1].factionId!] }), "my faction");
  refused(() => activateRaw(b.engine, P1, b.id("sm"), "schproing", {}), "no pick");
  for (const key of ["thing", "place", "fd"]) assert.equal(zoneOf(b.engine, b.id(key)), "play");
});

clause(SCHPROING, "1:ability:schproing", "attacking alone after SCHPROING!, it cannot be blocked: any blocker is refused, and not blocking is fine", () => {
  const b = smBoard();
  schproing(b, "o1");
  declareAttackBy(b.engine, P1, [b.id("sm")]);
  refused(blockWithSm(b, ["b1"]), "one blocker");
  refused(blockWithSm(b, ["b1", "b2"]), "two blockers");
  blockWithSm(b, [])();
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.players[P2].influence, 30 - 4, "the 4 strength hit the faction");
});

clause(SCHPROING, "1:ability:schproing", "control: without SCHPROING! a lone Schproingmajig can be blocked", () => {
  const b = smBoard();
  declareAttackBy(b.engine, P1, [b.id("sm")]);
  blockWithSm(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(SCHPROING, "1:ability:schproing", "it is only unblockable while it is the ONLY member of the attacking party: with a partner it can be blocked", () => {
  const b = smBoard();
  schproing(b, "o1");
  declareAttackBy(b.engine, P1, [b.id("sm"), b.id("o2")]);
  blockWithSm(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(SCHPROING, "1:ability:schproing", "used after the lone attack is declared (in the response window) it still makes the attack unblockable", () => {
  const b = smBoard();
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("sm")], target: { type: "faction", playerId: P2 } });
  activate(b.engine, P1, b.id("sm"), "schproing", { selected: { s: [b.id("o1")] } });
  assert.equal(battleOf(b.engine)?.phase, "blocking");
  refused(blockWithSm(b, ["b1"]), "unblockable once SCHPROING! resolved");
});

clause(SCHPROING, "1:ability:schproing", "the unblockability lasts this turn only: next turn a lone Schproingmajig can be blocked again", () => {
  const b = smBoard();
  schproing(b, "o1");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("sm")]);
  blockWithSm(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(SCHPROING, "1:ability:schproing", "only the controller can use it", () => {
  const b = smBoard();
  refused(() => activateRaw(b.engine, P2, b.id("sm"), "schproing", { s: [b.id("foe")] }), "the opponent");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(SCHPROING, "1:ability:schproing", "it only affects Schproingmajig: another lone attacker of mine remains blockable", () => {
  const b = smBoard();
  schproing(b, "o1");
  declareAttackBy(b.engine, P1, [b.id("o2")]);
  blockWithSm(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(SCHPROING, "1:ability:schproing", "costs 6 with [E][E] and has printed stats 4/4/2", () => {
  const spec: DeploySpec = { printingId: SCHPROING, cost: 6, icon: "elitism", iconCount: 2 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  const b = smBoard();
  assert.deepEqual(stat(b.engine, b.id("sm")), [4, 4, 2]);
});

// ===============================================================================
// Scorching Runicution
// COST: Pick a "gear" card. X is that card's numeric cost. EFFECT: Inflict X damage to
// the character to which the "gear" card is attached. Destroy the "gear" card.
// Tactic, cost 2, threshold [E].
// ===============================================================================

const SCORCH = "c56085da-7855-456e-81cf-5c822300ca3e";

const attachedGear = (name: string, cost: number) => item({ name, cost, subtype: ["gear"], attachTo: "character" });

function scorchBoard(opts: { elitism?: number; extra?: CardPlacement[]; hostLife?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sr", def: printing(SCORCH), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 2, life: opts.hostLife ?? 10, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: attachedGear("Gear", 3), owner: P2, zone: "play", attachedToKey: "host" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 10, speed: 2 }), owner: P1, zone: "play" },
      { key: "mygear", def: attachedGear("MyGear", 2), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "bystander", def: character({ name: "Bystander", strength: 2, life: 10, speed: 2 }), owner: P2, zone: "play" },
      { key: "plainItem", def: item({ name: "PlainItem", cost: 2 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...bank("elitism", opts.elitism ?? 4, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type ScorchBoard = ReturnType<typeof scorchBoard>;
const scorch = (b: ScorchBoard, target: string) => play(b.engine, P1, b.id("sr"), { selected: { g: [b.id(target)] } });
const scorchRaw = (b: ScorchBoard, target: string) => playRaw(b.engine, P1, b.id("sr"), { selected: { g: [b.id(target)] } });

clause(SCORCH, "0:ability", "inflicts X damage (the gear card's numeric cost) to the character it is attached to, and destroys the gear card", () => {
  const b = scorchBoard();
  scorch(b, "gear");
  assert.equal(b.engine.state.cards[b.id("host")].damage, 3, "X = the gear's cost of 3");
  assert.equal(zoneOf(b.engine, b.id("gear")), "discard", "the gear card is destroyed");
  assert.equal(zoneOf(b.engine, b.id("host")), "play", "10 life: it survives 3 damage");
  assert.equal(zoneOf(b.engine, b.id("sr")), "discard", "the tactic goes to the discard pile");
});

for (const cost of [0, 1, 5]) {
  clause(SCORCH, "0:ability", `X is the gear's numeric cost: a cost-${cost} gear card does ${cost} damage`, () => {
    const b = scorchBoard({ extra: [{ key: "g2", def: attachedGear("G2", cost), owner: P2, zone: "play", attachedToKey: "bystander" }] });
    scorch(b, "g2");
    assert.equal(b.engine.state.cards[b.id("bystander")].damage, cost);
    assert.equal(zoneOf(b.engine, b.id("g2")), "discard");
  });
}

clause(SCORCH, "0:ability", "a gear card I control on my own character works the same way (the damage is to my own character)", () => {
  const b = scorchBoard();
  scorch(b, "mygear");
  assert.equal(b.engine.state.cards[b.id("mine")].damage, 2);
  assert.equal(zoneOf(b.engine, b.id("mygear")), "discard");
  assert.equal(b.engine.state.cards[b.id("host")].damage, 0, "the other gear's host is untouched");
});

clause(SCORCH, "0:ability", "only the gear's host takes damage: other characters, my faction and the opponent's faction are untouched", () => {
  const b = scorchBoard();
  scorch(b, "gear");
  assert.equal(b.engine.state.cards[b.id("bystander")].damage, 0);
  assert.equal(b.engine.state.cards[b.id("mine")].damage, 0);
  assert.equal(b.engine.state.players[P1].influence, 30);
  assert.equal(b.engine.state.players[P2].influence, 30);
  assert.equal(zoneOf(b.engine, b.id("mygear")), "play", "other gear cards stay");
});

clause(SCORCH, "0:ability", "enough damage destroys the host: a 3-life host dies to a cost-3 gear", () => {
  const b = scorchBoard({ hostLife: 3 });
  scorch(b, "gear");
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("gear")), "discard");
});

clause(SCORCH, "0:ability", "with the real Heavy Plating (cost 6) a 4-life host takes 6 damage and dies once the Plating's +4 life is gone", () => {
  const b = scorchBoard({ hostLife: 4, extra: [{ key: "hp", def: printing(HP), owner: P2, zone: "play", attachedToKey: "bystander" }] });
  assert.deepEqual(stat(b.engine, b.id("bystander")), [6, 14, 1], "10 life + 4 from the Plating");
  const c = scorchBoard({ extra: [{ key: "hp", def: printing(HP), owner: P2, zone: "play", attachedToKey: "host" }] });
  scorch(c, "hp");
  assert.equal(c.engine.state.cards[c.id("host")].damage, 6, "X = the Plating's numeric cost, 6");
  assert.equal(zoneOf(c.engine, c.id("hp")), "discard");
  const d = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sr", def: printing(SCORCH), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "hp", def: printing(HP), owner: P2, zone: "play", attachedToKey: "host" },
      ...bank("elitism", 2, P1)
    ]
  });
  play(d.engine, P1, d.id("sr"), { selected: { g: [d.id("hp")] } });
  assert.equal(zoneOf(d.engine, d.id("hp")), "discard");
  assert.equal(zoneOf(d.engine, d.id("host")), "discard", "6 damage on a 4-life character (8 with the Plating, 4 without it)");
});

clause(SCORCH, "0:ability", "a gear card that is not attached to anything is destroyed and nobody takes damage", () => {
  const b = scorchBoard({ extra: [{ key: "loose", def: item({ name: "Loose", cost: 4, subtype: ["gear"] }), owner: P1, zone: "play" }] });
  scorch(b, "loose");
  assert.equal(zoneOf(b.engine, b.id("loose")), "discard");
  for (const key of ["host", "mine", "bystander"]) assert.equal(b.engine.state.cards[b.id(key)].damage, 0, key);
  assert.equal(b.engine.state.players[P2].influence, 30);
});

clause(SCORCH, "0:ability", "a face-down card has no subtype, so a face-down 'gear' card cannot be picked as a gear card (CR 411.1)", () => {
  const b = scorchBoard({ extra: [{ key: "fdGear", def: attachedGear("FdGear", 2), owner: P2, zone: "play", faceDown: true }] });
  const before = ready(b.engine);
  refused(() => scorchRaw(b, "fdGear"), "a face-down card has no subtype");
  assert.equal(zoneOf(b.engine, b.id("sr")), "hand");
  assert.equal(ready(b.engine), before, "nothing was paid");
});

clause(SCORCH, "0:ability", "only gear cards can be picked: a non-gear item, a character, a location or nothing is refused", () => {
  const b = scorchBoard();
  const before = ready(b.engine);
  refused(() => scorchRaw(b, "plainItem"), "an item without the gear subtype");
  refused(() => scorchRaw(b, "host"), "a character");
  refused(() => scorchRaw(b, "place"), "a location");
  refused(() => playRaw(b.engine, P1, b.id("sr"), { selected: {} }), "no pick");
  assert.equal(zoneOf(b.engine, b.id("sr")), "hand");
  assert.equal(ready(b.engine), before, "nothing was paid");
  scorchRaw(b, "gear");
  assert.ok(b.engine.state.responseWindow, "control: a gear card is accepted");
});

clause(SCORCH, "0:ability", "the gear card must be in play: gear in hand, deck or discard pile cannot be picked", () => {
  const b = scorchBoard({
    extra: [
      { key: "gh", def: attachedGear("GH", 2), owner: P1, zone: "hand" },
      { key: "gd", def: attachedGear("GD", 2), owner: P1, zone: "deck" },
      { key: "gx", def: attachedGear("GX", 2), owner: P1, zone: "discard" }
    ]
  });
  for (const key of ["gh", "gd", "gx"]) refused(() => scorchRaw(b, key), `${key} is not in play`);
  assert.equal(zoneOf(b.engine, b.id("sr")), "hand");
});

clause(SCORCH, "0:ability", "both players' gear can be picked (mine and the opponent's)", () => {
  const b = scorchBoard();
  scorchRaw(b, "gear");
  const c = scorchBoard();
  scorchRaw(c, "mygear");
  assert.ok(b.engine.state.responseWindow, "b.engine.state.responseWindow");
  assert.ok(c.engine.state.responseWindow, "c.engine.state.responseWindow");
});

clause(SCORCH, "0:ability", "costs 2 and needs [E]", () => {
  const spec: DeploySpec = {
    printingId: SCORCH,
    cost: 2,
    icon: "elitism",
    iconCount: 1,
    ends: "discard",
    extra: [
      { key: "h", def: character({ name: "H", life: 10 }), owner: P2, zone: "play" },
      { key: "g", def: attachedGear("G", 1), owner: P2, zone: "play", attachedToKey: "h" }
    ],
    selected: (id) => ({ g: [id("g")] })
  };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
});

// ===============================================================================
// Senior Research Assistant
// RESEARCH -- COST: Deplete this card. EFFECT: Reduce the next numeric cost you pay
// this turn by 2.
// Character (31f), cost 4, threshold [E][E], 2/2/2.
// ===============================================================================

const SRA = "c1d2e319-7435-40aa-a215-76bd52b37d78";

function sraBoard(opts: { depleted?: boolean; resources?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  const payer = item({
    name: "Payer",
    behavior: { abilities: [{ id: "pay3", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "sra", def: printing(SRA), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "big", def: character({ name: "Big", cost: 4 }), owner: P1, zone: "hand" },
      { key: "small", def: character({ name: "Small", cost: 1 }), owner: P1, zone: "hand" },
      { key: "two", def: item({ name: "Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "tac3", def: tactic({ name: "Tac3", cost: 3, behavior: { abilities: [{ id: "blank", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      { key: "gated", def: character({ name: "Gated", cost: 3, threshold: "ee" }), owner: P1, zone: "hand" },
      { key: "payer", def: payer, owner: P1, zone: "play" },
      { key: "obig", def: character({ name: "OBig", cost: 4 }), owner: P2, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...bank("greed", opts.resources ?? 12, P1),
      ...bank("greed", 8, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type SraBoard = ReturnType<typeof sraBoard>;
const research = (b: SraBoard, who = "sra") => activate(b.engine, P1, b.id(who), "research");
const researchRaw = (b: SraBoard, who = "sra") => activateRaw(b.engine, P1, b.id(who), "research");
/** Resources spent by playing `key` from hand. */
function spentBy(b: SraBoard, key: string): number {
  const before = ready(b.engine);
  play(b.engine, P1, b.id(key));
  return before - ready(b.engine);
}

clause(SRA, "0:ability:research", "the cost is depleting Research's source: Senior Research Assistant is depleted on activation and no resources are paid", () => {
  const b = sraBoard();
  const before = ready(b.engine);
  researchRaw(b);
  assert.equal(b.engine.state.cards[b.id("sra")].depleted, true, "COST: deplete this card");
  assert.equal(ready(b.engine), before, "no resources are paid");
  assert.equal(b.engine.getCardPlayability(P1, b.id("big")).numericCost, 4, "the reduction is not in effect until the ability resolves");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getCardPlayability(P1, b.id("big")).numericCost, 2, "once resolved the next cost is 2 less");
});

clause(SRA, "0:ability:research", "the next card I play costs 2 less: a cost-4 character costs 2", () => {
  const b = sraBoard();
  research(b);
  assert.equal(spentBy(b, "big"), 2);
  assert.equal(zoneOf(b.engine, b.id("big")), "play");
});

clause(SRA, "0:ability:research", "it applies to the next numeric cost whatever the card type: an item and a tactic are reduced too", () => {
  const item_ = sraBoard();
  research(item_);
  assert.equal(spentBy(item_, "two"), 0, "a cost-2 item is free");
  const tac = sraBoard();
  research(tac);
  assert.equal(spentBy(tac, "tac3"), 1, "a cost-3 tactic costs 1");
});

clause(SRA, "0:ability:research", "a numeric cost cannot go below 0: a cost-1 card costs 0", () => {
  const b = sraBoard();
  research(b);
  assert.equal(spentBy(b, "small"), 0);
  assert.equal(zoneOf(b.engine, b.id("small")), "play");
});

clause(SRA, "0:ability:research", "only the NEXT cost: the second card I play costs its full price", () => {
  const b = sraBoard();
  research(b);
  assert.equal(spentBy(b, "big"), 2);
  assert.equal(spentBy(b, "two"), 2, "the second card is not reduced");
});

clause(SRA, "0:ability:research", "the reduction is mine: the opponent's cards cost their normal price", () => {
  const b = sraBoard();
  research(b);
  assert.equal(b.engine.getCardPlayability(P2, b.id("obig")).numericCost, 4);
});

clause(SRA, "0:ability:research", "two Research uses (two assistants) both reduce the same next cost: 2 + 2 = 4 less (CR 406.3: all cost reductions apply)", () => {
  const b = sraBoard({ extra: [{ key: "sra2", def: printing(SRA), owner: P1, zone: "play" }] });
  research(b, "sra");
  research(b, "sra2");
  assert.equal(spentBy(b, "big"), 0, "4 - 4");
});

clause(SRA, "0:ability:research", "it lasts this turn only: if no cost is paid before the turn ends, the next turn's costs are normal", () => {
  const b = sraBoard();
  research(b);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(spentBy(b, "big"), 4, "the unused reduction is gone");
});

clause(SRA, "0:ability:research", "'the next numeric cost you pay' includes a 'pay N' ability cost (CR 406.5): a pay-3 ability costs 1", () => {
  const b = sraBoard();
  research(b);
  const before = ready(b.engine);
  activate(b.engine, P1, b.id("payer"), "pay3");
  assert.equal(before - ready(b.engine), 1, "the next numeric cost I pay is the ability's pay 3, reduced by 2");
});

clause(SRA, "0:ability:research", "the reduction does not waive the threshold: a reduced card still needs its icons", () => {
  const b = sraBoard();
  research(b);
  assert.equal(b.engine.getCardPlayability(P1, b.id("gated")).thresholdMet, false, "no [E] icons");
  refused(() => playRaw(b.engine, P1, b.id("gated")), "the threshold is not met");
  assert.equal(zoneOf(b.engine, b.id("gated")), "hand");
  assert.equal(spentBy(b, "big"), 2, "the reduction is still waiting for the next card I can pay for");
});

clause(SRA, "0:ability:research", "a depleted Senior Research Assistant cannot do it; once per restore", () => {
  const b = sraBoard({ depleted: true });
  refused(() => researchRaw(b), "depleted");
  assert.equal(spentBy(b, "big"), 4, "no reduction");
  const c = sraBoard();
  research(c);
  refused(() => researchRaw(c), "depleted by its own cost");
  endTurn(c.engine, P1);
  endTurn(c.engine, P2);
  research(c);
  assert.equal(spentBy(c, "big"), 2, "usable again after the restore");
});

clause(SRA, "0:ability:research", "only the controller can use it", () => {
  const b = sraBoard();
  refused(() => activateRaw(b.engine, P2, b.id("sra"), "research"), "the opponent");
  assert.equal(b.engine.state.cards[b.id("sra")].depleted, false);
});

clause(SRA, "0:ability:research", "usable in response on the opponent's turn: the next cost I pay then (a response tactic) is reduced", () => {
  const b = sraBoard({ active: P2, extra: [{ key: "oc", def: character({ name: "OC" }), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("oc"));
  activateRaw(b.engine, P1, b.id("sra"), "research");
  b.engine.perform({ type: "passPriority", playerId: P2 });
  b.engine.perform({ type: "advanceFlow" });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond again after Research resolved");
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("tac3"));
  assert.equal(before - ready(b.engine), 1, "the response tactic costs 3 - 2");
});

clause(SRA, "0:ability:research", "costs 4 with [E][E] and has printed stats 2/2/2", () => {
  const spec: DeploySpec = { printingId: SRA, cost: 4, icon: "elitism", iconCount: 2 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  const b = sraBoard();
  assert.deepEqual(stat(b.engine, b.id("sra")), [2, 2, 2]);
});

// ===============================================================================
// Spackle
// REPAIR -- COST: Deplete this card. Pick a location. EFFECT: Remove 2 damage from the
// location.
// Item, cost 1, threshold [E].
// ===============================================================================

const SPACKLE = "ee76ecf6-a635-4d63-9357-fb78a53b3052";

function spackleBoard(opts: { depleted?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sp", def: printing(SPACKLE), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "loc5", def: location({ name: "Loc5", structure: 8 }), owner: P1, zone: "play", damage: 5 },
      { key: "oloc3", def: location({ name: "OLoc3", structure: 8 }), owner: P2, zone: "play", damage: 3 },
      { key: "loc2", def: location({ name: "Loc2", structure: 8 }), owner: P1, zone: "play", damage: 2 },
      { key: "loc1", def: location({ name: "Loc1", structure: 8 }), owner: P1, zone: "play", damage: 1 },
      { key: "loc0", def: location({ name: "Loc0", structure: 8 }), owner: P1, zone: "play", damage: 0 },
      { key: "char", def: character({ name: "Char", life: 9 }), owner: P1, zone: "play", damage: 3 },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "fd", def: location({ name: "Fd" }), owner: P2, zone: "play", faceDown: true },
      ...bank("greed", 2, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type SpackleBoard = ReturnType<typeof spackleBoard>;
const repair = (b: SpackleBoard, target: string) => activate(b.engine, P1, b.id("sp"), "repair", { selected: { loc: [b.id(target)] } });
const repairRaw = (b: SpackleBoard, target: string) => activateRaw(b.engine, P1, b.id("sp"), "repair", { loc: [b.id(target)] });
const dmg = (b: SpackleBoard, key: string) => b.engine.state.cards[b.id(key)].damage;

clause(SPACKLE, "0:ability:repair", "the cost is depleting Spackle, paid on activation; no resources are paid, and the damage is removed when the ability resolves", () => {
  const b = spackleBoard();
  const before = ready(b.engine);
  repairRaw(b, "loc5");
  assert.equal(b.engine.state.cards[b.id("sp")].depleted, true, "COST: deplete this card");
  assert.equal(ready(b.engine), before, "no resources are paid");
  assert.equal(dmg(b, "loc5"), 5, "not repaired until the ability resolves");
  resolvePendingResponses(b.engine);
  assert.equal(dmg(b, "loc5"), 3, "EFFECT: remove 2 damage");
});

clause(SPACKLE, "0:ability:repair", "removes exactly 2 damage: 5 -> 3 and 3 -> 1, for my location and the opponent's", () => {
  const b = spackleBoard();
  repair(b, "loc5");
  assert.equal(dmg(b, "loc5"), 3);
  const c = spackleBoard();
  repair(c, "oloc3");
  assert.equal(dmg(c, "oloc3"), 1);
});

clause(SPACKLE, "0:ability:repair", "removes at most the damage there is: 2 -> 0, 1 -> 0 and 0 -> 0, never negative", () => {
  for (const key of ["loc2", "loc1", "loc0"]) {
    const b = spackleBoard();
    repair(b, key);
    assert.equal(dmg(b, key), 0, key);
  }
});

clause(SPACKLE, "0:ability:repair", "only the picked location is repaired", () => {
  const b = spackleBoard();
  repair(b, "loc5");
  assert.equal(dmg(b, "oloc3"), 3);
  assert.equal(dmg(b, "loc2"), 2);
  assert.equal(dmg(b, "char"), 3, "a character's damage is not touched");
});

clause(SPACKLE, "0:ability:repair", "only a location can be picked: a character, an item, a face-down card, a faction or nothing is refused, and Spackle is not depleted", () => {
  const b = spackleBoard();
  refused(() => repairRaw(b, "char"), "a character");
  refused(() => repairRaw(b, "thing"), "an item");
  refused(() => repairRaw(b, "fd"), "a face-down card is not a location");
  refused(() => repairRaw(b, "sp"), "Spackle itself");
  refused(() => activateRaw(b.engine, P1, b.id("sp"), "repair", { loc: [b.engine.state.players[P2].factionId!] }), "the opponent's faction");
  refused(() => activateRaw(b.engine, P1, b.id("sp"), "repair", {}), "no pick");
  assert.equal(b.engine.state.cards[b.id("sp")].depleted, false, "nothing was paid");
  assert.equal(dmg(b, "char"), 3);
  repair(b, "loc5");
  assert.equal(dmg(b, "loc5"), 3, "control: a location works");
});

clause(SPACKLE, "0:ability:repair", "a depleted Spackle cannot be used; once per restore", () => {
  const b = spackleBoard({ depleted: true });
  refused(() => repairRaw(b, "loc5"), "depleted");
  assert.equal(dmg(b, "loc5"), 5);
  const c = spackleBoard();
  repair(c, "loc5");
  refused(() => repairRaw(c, "loc5"), "depleted by its own cost");
  endTurn(c.engine, P1);
  endTurn(c.engine, P2);
  repair(c, "loc5");
  assert.equal(dmg(c, "loc5"), 1, "5 - 2 - 2: repaired again after the restore");
});

clause(SPACKLE, "0:ability:repair", "only Spackle's controller can use it", () => {
  const b = spackleBoard();
  refused(() => activateRaw(b.engine, P2, b.id("sp"), "repair", { loc: [b.id("oloc3")] }), "the opponent");
  assert.equal(dmg(b, "oloc3"), 3);
});

clause(SPACKLE, "0:ability:repair", "the repair is real: a location with 4 structure and 3 damage survives 2 more damage after a repair, and is destroyed by it without one", () => {
  const board = (repaired: boolean) => {
    const b = spackleBoard({
      extra: [
        { key: "weak", def: location({ name: "Weak", structure: 4 }), owner: P1, zone: "play", damage: 3 },
        { key: "zap", def: zapTactic(2), owner: P1, zone: "hand" }
      ]
    });
    if (repaired) repair(b, "weak");
    play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("weak")] } });
    return b;
  };
  const fixed = board(true);
  assert.equal(zoneOf(fixed.engine, fixed.id("weak")), "play", "1 + 2 = 3 < 4");
  const broken = board(false);
  assert.equal(zoneOf(broken.engine, broken.id("weak")), "discard", "3 + 2 = 5 >= 4");
});

clause(SPACKLE, "0:ability:repair", "costs 1 with [E] and is not a character: it can be used the turn it enters play", () => {
  const spec: DeploySpec = { printingId: SPACKLE, cost: 1, icon: "elitism", iconCount: 1 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sp", def: printing(SPACKLE), owner: P1, zone: "hand" },
      { key: "loc", def: location({ name: "Loc", structure: 8 }), owner: P1, zone: "play", damage: 4 },
      ...bank("elitism", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("sp"));
  activate(b.engine, P1, b.id("sp"), "repair", { selected: { loc: [b.id("loc")] } });
  assert.equal(b.engine.state.cards[b.id("loc")].damage, 2);
});

// ===============================================================================
// T Force 5 Megabrutemajig / Megadudemajig / Megascoutmajig
// When this card enters play, you may detach up to 2 resources from your faction.
// Characters (t force 5, majig): Megabrute cost 7 [E][E] 8/5/2; Megadude cost 6
// [E][E][E][E][E] 7/5/3; Megascout cost 7 [E][E] 5/4/4.
// ===============================================================================

const TF_BRUTE = "8039fd38-e699-489c-949b-0de160346cb2";
const TF_DUDE = "8ec43855-13bb-4b04-9504-c0e6a275acc6";
const TF_SCOUT = "dfd1b21a-d461-4031-a3db-6c56557d771b";

interface TForce {
  id: string;
  cost: number;
  iconCount: number;
  /** [strength, life, speed] */
  stats: number[];
}
const BRUTE: TForce = { id: TF_BRUTE, cost: 7, iconCount: 2, stats: [8, 5, 2] };
const DUDE: TForce = { id: TF_DUDE, cost: 6, iconCount: 5, stats: [7, 5, 3] };
const SCOUT: TForce = { id: TF_SCOUT, cost: 7, iconCount: 2, stats: [5, 4, 4] };

/** The T Force card in hand; exactly cost + 2 elitism resources (so 2 stay ready after paying); an opponent with spent resources. */
function tfBoard(t: TForce, opts: { zone?: "hand" | "play"; extra?: CardPlacement[]; oppSpent?: number; spent?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "tf", def: printing(t.id), owner: P1, zone: opts.zone ?? "hand" },
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" },
      { key: "next", def: item({ name: "Next" }), owner: P1, zone: "hand" },
      { key: "two", def: item({ name: "Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "four", def: item({ name: "Four", cost: 4 }), owner: P1, zone: "hand" },
      ...bank("elitism", opts.zone === "play" ? 0 : t.cost + 2, P1),
      ...spentResources(P1, opts.spent ?? 0),
      ...spentResources(P2, opts.oppSpent ?? 0),
      ...(opts.extra ?? [])
    ]
  });
}
type TfBoard = ReturnType<typeof tfBoard>;

const attachedResources = (b: TfBoard, player: Pid = P1) =>
  b.engine.state.players[player].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === b.engine.state.players[player].factionId);

function tfPlayToPrompt(t: TForce, opts: Parameters<typeof tfBoard>[1] = {}) {
  const b = tfBoard(t, opts);
  play(b.engine, P1, b.id("tf"));
  return b;
}

function tfOffer(t: TForce) {
  const b = tfPlayToPrompt(t);
  assert.equal(zoneOf(b.engine, b.id("tf")), "play", "it entered play");
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "its controller decides");
  assert.equal(ready(b.engine), 2, "the only free resources are the two I did not pay with");
}
function tfDetachTwo(t: TForce) {
  const b = tfPlayToPrompt(t);
  const att = attachedResources(b);
  assert.equal(att.length, t.cost, "paid resources are attached to the faction");
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, att.slice(0, 2));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 4, "two detached on top of the two I never spent");
  for (const c of att.slice(0, 2)) assert.equal(b.engine.state.cards[c].attachedTo, undefined);
  for (const c of att.slice(2)) assert.equal(b.engine.state.cards[c].attachedTo, b.engine.state.players[P1].factionId, "the rest stay attached");
}
function tfDetachOne(t: TForce) {
  const b = tfPlayToPrompt(t);
  const att = attachedResources(b);
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, [att[0]]);
  assert.equal(ready(b.engine), 3);
}
function tfDetachNone(t: TForce) {
  const a = tfPlayToPrompt(t);
  chooseOption(a.engine, P1, /decline/i);
  assert.equal(ready(a.engine), 2, "declined: nothing detached");
  assert.equal(a.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(a.engine, a.id("tf")), "play", "the card stays in play");
  const b = tfPlayToPrompt(t);
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, []);
  assert.equal(ready(b.engine), 2, "chose to detach, took none");
  assert.equal(b.engine.state.pendingChoice, undefined);
}
function tfNotThree(t: TForce) {
  const b = tfPlayToPrompt(t);
  const att = attachedResources(b);
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, att.slice(0, 3)), "three resources is more than 'up to 2'");
  assert.equal(ready(b.engine), 2, "nothing was detached");
  pick(b.engine, P1, att.slice(0, 2));
  assert.equal(ready(b.engine), 4, "control: two is fine");
}
function tfResourcesOnly(t: TForce) {
  const b = tfPlayToPrompt(t, { oppSpent: 3 });
  const att = attachedResources(b);
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, [b.id("mate")]), "a character is not a resource");
  const theirs = attachedResources(b, P2);
  assert.ok(theirs.length >= 1, "theirs.length >= 1");
  refused(() => pickRaw(b.engine, P1, [theirs[0]]), "the opponent's spent resource");
  assert.equal(ready(b.engine, P2), 0, "the opponent's resources are untouched");
  pick(b.engine, P1, [att[0]]);
  assert.equal(ready(b.engine), 3, "control: my own resource works");
}
function tfOnlyAttached(t: TForce) {
  const b = tfPlayToPrompt(t);
  const loose = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === undefined);
  assert.equal(loose.length, 2, "two resources are not attached to the faction");
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, [loose[0]]), "a resource that is not attached cannot be detached");
}
function tfOnlySelf(t: TForce) {
  const b = tfBoard(t, { zone: "play", extra: bank("elitism", 2, P1) });
  play(b.engine, P1, b.id("next"));
  assert.equal(zoneOf(b.engine, b.id("next")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "another card entering play does not trigger it");
}
function tfPutIntoPlay(t: TForce) {
  const dropper = item({
    name: "Dropper",
    behavior: {
      abilities: [
        {
          id: "drop",
          type: "activated",
          targets: [{ id: "h", selector: { zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "h" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = tfBoard(t, { extra: [{ key: "dropper", def: dropper, owner: P1, zone: "play" }], spent: 3 });
  activate(b.engine, P1, b.id("dropper"), "drop", { selected: { h: [b.id("tf")] } });
  assert.equal(zoneOf(b.engine, b.id("tf")), "play", "put into play, not deployed");
  const pc = pending(b.engine);
  assert.ok(pc, "'when this card enters play' also covers being put into play");
  assert.equal(pc.kind, "chooserSelectsOption");
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, attachedResources(b).slice(0, 2));
  assert.equal(ready(b.engine), t.cost + 2 + 2, "two of the three spent resources are free again");
}
function tfSpendAtOnce(t: TForce) {
  const b = tfPlayToPrompt(t);
  const att = attachedResources(b);
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, att.slice(0, 2));
  play(b.engine, P1, b.id("four"));
  assert.equal(zoneOf(b.engine, b.id("four")), "play", "the two detached resources plus the two I never spent pay for a cost-4 item");
  assert.equal(ready(b.engine), 0);
  const c = tfPlayToPrompt(t);
  chooseOption(c.engine, P1, /decline/i);
  refused(() => playRaw(c.engine, P1, c.id("four")), "control: declining leaves only 2 free resources");
}
function tfDeploy(t: TForce) {
  const spec: DeploySpec = { printingId: t.id, cost: t.cost, icon: "elitism", iconCount: t.iconCount };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  if (t.iconCount > 1) deployIconShort(spec);
  const b = tfBoard(t, { zone: "play" });
  assert.deepEqual(stat(b.engine, b.id("tf")), t.stats, "printed stats");
}

clause(TF_BRUTE, "0:rule", "entering play offers its controller the choice to detach", () => tfOffer(BRUTE));
clause(TF_BRUTE, "0:rule", "detaching 2: both chosen resources are detached from the faction, the rest stay attached", () => tfDetachTwo(BRUTE));
clause(TF_BRUTE, "0:rule", "detaching only 1 ('up to 2') detaches one", () => tfDetachOne(BRUTE));
clause(TF_BRUTE, "0:rule", "declining, or choosing to detach and taking none, detaches nothing", () => tfDetachNone(BRUTE));
clause(TF_BRUTE, "0:rule", "more than 2 resources cannot be detached", () => tfNotThree(BRUTE));
clause(TF_BRUTE, "0:rule", "only resources of my own faction can be picked: not a character, not the opponent's spent resources", () => tfResourcesOnly(BRUTE));
clause(TF_BRUTE, "0:rule", "only resources that are attached to the faction can be detached: a resource that is not attached cannot be picked", () => tfOnlyAttached(BRUTE));
clause(TF_BRUTE, "0:rule", "only the card's own entering triggers it: another card entering play raises no choice", () => tfOnlySelf(BRUTE));
clause(TF_BRUTE, "0:rule", "being put into play (not deployed) also triggers it", () => tfPutIntoPlay(BRUTE));
clause(TF_BRUTE, "0:rule", "the detached resources can be spent at once", () => tfSpendAtOnce(BRUTE));
clause(TF_BRUTE, "0:rule", "costs 7 with [E][E] (refused short or without icons) and has printed stats 8/5/2", () => tfDeploy(BRUTE));

clause(TF_DUDE, "0:rule", "entering play offers its controller the choice to detach", () => tfOffer(DUDE));
clause(TF_DUDE, "0:rule", "detaching 2: both chosen resources are detached from the faction, the rest stay attached", () => tfDetachTwo(DUDE));
clause(TF_DUDE, "0:rule", "detaching only 1 ('up to 2') detaches one", () => tfDetachOne(DUDE));
clause(TF_DUDE, "0:rule", "declining, or choosing to detach and taking none, detaches nothing", () => tfDetachNone(DUDE));
clause(TF_DUDE, "0:rule", "more than 2 resources cannot be detached", () => tfNotThree(DUDE));
clause(TF_DUDE, "0:rule", "only resources of my own faction can be picked: not a character, not the opponent's spent resources", () => tfResourcesOnly(DUDE));
clause(TF_DUDE, "0:rule", "only resources that are attached to the faction can be detached: a resource that is not attached cannot be picked", () => tfOnlyAttached(DUDE));
clause(TF_DUDE, "0:rule", "only the card's own entering triggers it: another card entering play raises no choice", () => tfOnlySelf(DUDE));
clause(TF_DUDE, "0:rule", "being put into play (not deployed) also triggers it", () => tfPutIntoPlay(DUDE));
clause(TF_DUDE, "0:rule", "the detached resources can be spent at once", () => tfSpendAtOnce(DUDE));
clause(TF_DUDE, "0:rule", "costs 6 with [E][E][E][E][E] (refused short or without icons) and has printed stats 7/5/3", () => tfDeploy(DUDE));

clause(TF_SCOUT, "0:rule", "entering play offers its controller the choice to detach", () => tfOffer(SCOUT));
clause(TF_SCOUT, "0:rule", "detaching 2: both chosen resources are detached from the faction, the rest stay attached", () => tfDetachTwo(SCOUT));
clause(TF_SCOUT, "0:rule", "detaching only 1 ('up to 2') detaches one", () => tfDetachOne(SCOUT));
clause(TF_SCOUT, "0:rule", "declining, or choosing to detach and taking none, detaches nothing", () => tfDetachNone(SCOUT));
clause(TF_SCOUT, "0:rule", "more than 2 resources cannot be detached", () => tfNotThree(SCOUT));
clause(TF_SCOUT, "0:rule", "only resources of my own faction can be picked: not a character, not the opponent's spent resources", () => tfResourcesOnly(SCOUT));
clause(TF_SCOUT, "0:rule", "only resources that are attached to the faction can be detached: a resource that is not attached cannot be picked", () => tfOnlyAttached(SCOUT));
clause(TF_SCOUT, "0:rule", "only the card's own entering triggers it: another card entering play raises no choice", () => tfOnlySelf(SCOUT));
clause(TF_SCOUT, "0:rule", "being put into play (not deployed) also triggers it", () => tfPutIntoPlay(SCOUT));
clause(TF_SCOUT, "0:rule", "the detached resources can be spent at once", () => tfSpendAtOnce(SCOUT));
clause(TF_SCOUT, "0:rule", "costs 7 with [E][E] (refused short or without icons) and has printed stats 5/4/4", () => tfDeploy(SCOUT));

// ===============================================================================
// The Whatever Device
// THANK GOD WE INVENTED THE... -- COST: Pick a number for X. Pay X. Destroy this card.
// EFFECT: Search your deck for an item with numeric cost X or less and reveal it. You
// may play that card for free. (You still need the proper resource icons and must pay
// any additional costs.) If you don't, put it into your hand.
// Item, cost 2, threshold [E][E][E][E].
// ===============================================================================

const TWD = "8ac37971-303b-4ec6-bf9b-a09c1883a44a";

function twdBoard(opts: { resources?: number; elitism?: number; extra?: CardPlacement[]; random?: () => number; noZeroItem?: boolean; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: opts.random ?? (() => 0),
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "twd", def: printing(TWD), owner: P1, zone: "play" },
      ...(opts.noZeroItem ? [] : [{ key: "i0", def: item({ name: "I0", cost: 0 }), owner: P1, zone: "deck" as const }]),
      { key: "i1", def: item({ name: "I1", cost: 1 }), owner: P1, zone: "deck" },
      { key: "i2", def: item({ name: "I2", cost: 2 }), owner: P1, zone: "deck" },
      { key: "i3", def: item({ name: "I3", cost: 3 }), owner: P1, zone: "deck" },
      { key: "i5", def: item({ name: "I5", cost: 5 }), owner: P1, zone: "deck" },
      { key: "ch0", def: character({ name: "Ch0", cost: 0 }), owner: P1, zone: "deck" },
      { key: "tac0", def: tactic({ name: "Tac0", cost: 0 }), owner: P1, zone: "deck" },
      { key: "loc0", def: location({ name: "Loc0", cost: 0 }), owner: P1, zone: "deck" },
      { key: "oi1", def: item({ name: "OI1", cost: 1 }), owner: P2, zone: "deck" },
      { key: "hi1", def: item({ name: "HI1", cost: 1 }), owner: P1, zone: "hand" },
      { key: "di1", def: item({ name: "DI1", cost: 1 }), owner: P1, zone: "discard" },
      ...bank("greed", opts.resources ?? 8, P1),
      ...bank("elitism", opts.elitism ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}
type TwdBoard = ReturnType<typeof twdBoard>;

const twdRaw = (b: TwdBoard, x: number) => activateRaw(b.engine, P1, b.id("twd"), "thankgod", {}, { x });
/** Uses the Device with X and settles the response window; the search prompt is then open. */
const twd = (b: TwdBoard, x: number) => {
  twdRaw(b, x);
  resolvePendingResponses(b.engine);
};
const freePlayAnswer = (b: TwdBoard, key?: string) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: key ? b.id(key) : undefined } } as never);
  resolvePendingResponses(b.engine);
};
const freePlayAnswerRaw = (b: TwdBoard, key?: string) =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: key ? b.id(key) : undefined } } as never);

/** Search with X, take `key` and choose to put it into the hand. */
function twdFetch(b: TwdBoard, x: number, key: string) {
  twd(b, x);
  pick(b.engine, P1, [b.id(key)]);
  chooseOption(b.engine, P1, /hand/i);
}

clause(TWD, "0:ability:thankgod", "the cost is paid on activation: X resources are spent and the Device is destroyed (it is in its owner's discard pile before the search happens)", () => {
  const b = twdBoard();
  const before = ready(b.engine);
  twdRaw(b, 3);
  assert.equal(before - ready(b.engine), 3, "COST: pay X");
  assert.equal(zoneOf(b.engine, b.id("twd")), "discard", "COST: destroy this card");
  assert.equal(discardOf(b.engine, P1).includes(b.id("twd")), true);
  assert.equal(zoneOf(b.engine, b.id("i3")), "deck", "nothing has been searched yet");
  assert.equal(b.engine.state.pendingChoice, undefined, "the search happens when the ability resolves");
});

for (const x of [0, 1, 3, 5]) {
  clause(TWD, "0:ability:thankgod", `X = ${x}: pays exactly ${x} and destroys the Device`, () => {
    const b = twdBoard();
    const before = ready(b.engine);
    twd(b, x);
    assert.equal(before - ready(b.engine), x);
    assert.equal(zoneOf(b.engine, b.id("twd")), "discard");
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the search prompt is open");
  });
}

clause(TWD, "0:ability:thankgod", "needs no threshold of its own: resources of any kind pay for X", () => {
  const b = twdBoard({ resources: 2, elitism: 0 });
  twd(b, 2);
  assert.equal(ready(b.engine), 0);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
});

clause(TWD, "0:ability:thankgod", "X must be affordable: X = 9 with 8 resources is refused, nothing is paid and the Device stays", () => {
  const b = twdBoard({ resources: 8 });
  const before = ready(b.engine);
  refused(() => twdRaw(b, 9), "X = 9 costs 9");
  assert.equal(zoneOf(b.engine, b.id("twd")), "play");
  assert.equal(ready(b.engine), before, "nothing was paid");
  twd(b, 8);
  assert.equal(ready(b.engine), 0, "control: X = 8 can be paid exactly");
});

clause(TWD, "0:ability:thankgod", "X is a number of at least 0: a negative X is refused", () => {
  const b = twdBoard();
  const before = ready(b.engine);
  refused(() => twdRaw(b, -1), "a negative X");
  assert.equal(zoneOf(b.engine, b.id("twd")), "play");
  assert.equal(ready(b.engine), before);
});

clause(TWD, "0:ability:thankgod", "X must be a whole number (CR 410.2): a fractional X such as 1.5 is refused", () => {
  const b = twdBoard();
  const before = ready(b.engine);
  refused(() => twdRaw(b, 1.5), "a fractional X");
  assert.equal(zoneOf(b.engine, b.id("twd")), "play");
  assert.equal(ready(b.engine), before, "nothing was paid");
});

clause(TWD, "0:ability:thankgod", "the search finds an item with numeric cost X or less: with X = 2 the cost-0, cost-1 and cost-2 items can be taken", () => {
  for (const key of ["i0", "i1", "i2"]) {
    const b = twdBoard();
    twdFetch(b, 2, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} (cost ≤ 2) is found`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(TWD, "0:ability:thankgod", "an item costing more than X cannot be taken: with X = 2 the cost-3 and cost-5 items are refused", () => {
  const b = twdBoard();
  twd(b, 2);
  refused(() => pickRaw(b.engine, P1, [b.id("i3")]), "cost 3 > X");
  refused(() => pickRaw(b.engine, P1, [b.id("i5")]), "cost 5 > X");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  assert.equal(zoneOf(b.engine, b.id("i3")), "deck");
});

clause(TWD, "0:ability:thankgod", "X = 0 finds only cost-0 items", () => {
  const b = twdBoard();
  twd(b, 0);
  refused(() => pickRaw(b.engine, P1, [b.id("i1")]), "cost 1 > 0");
  pick(b.engine, P1, [b.id("i0")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
});

clause(TWD, "0:ability:thankgod", "only items: a character, a tactic or a location with a low cost cannot be taken", () => {
  const b = twdBoard();
  twd(b, 5);
  refused(() => pickRaw(b.engine, P1, [b.id("ch0")]), "a character");
  refused(() => pickRaw(b.engine, P1, [b.id("tac0")]), "a tactic");
  refused(() => pickRaw(b.engine, P1, [b.id("loc0")]), "a location");
  pick(b.engine, P1, [b.id("i5")]);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "control: an item works");
});

clause(TWD, "0:ability:thankgod", "only my own deck: the opponent's deck, my hand and my discard pile cannot be searched", () => {
  const b = twdBoard();
  twd(b, 5);
  refused(() => pickRaw(b.engine, P1, [b.id("oi1")]), "the opponent's deck");
  refused(() => pickRaw(b.engine, P1, [b.id("hi1")]), "my hand");
  refused(() => pickRaw(b.engine, P1, [b.id("di1")]), "my discard pile");
  assert.equal(zoneOf(b.engine, b.id("oi1")), "deck");
});

clause(TWD, "0:ability:thankgod", "only one item is taken", () => {
  const b = twdBoard();
  twd(b, 5);
  refused(() => pickRaw(b.engine, P1, [b.id("i1"), b.id("i2")]), "two items");
});

clause(TWD, "0:ability:thankgod", "the found item is revealed", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, P1, [b.id("i3")]);
  const reveals = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1);
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("i3")]);
  assert.equal(ev.viewerId, "all", "revealed to everyone");
});

clause(TWD, "0:ability:thankgod", "'If you don't (play it), put it into your hand': choosing not to play puts the item in my hand, not in play", () => {
  const b = twdBoard();
  twdFetch(b, 3, "i3");
  assert.equal(zoneOf(b.engine, b.id("i3")), "hand");
  assert.equal(hand(b.engine, P1).includes(b.id("i3")), true);
  assert.equal(ready(b.engine), 5, "only X was paid");
});

clause(TWD, "0:ability:thankgod", "'You may play that card for free': the item enters play under my control without paying its numeric cost", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, P1, [b.id("i3")]);
  chooseOption(b.engine, P1, /deploy|play/i);
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  freePlayAnswer(b, "i3");
  assert.equal(zoneOf(b.engine, b.id("i3")), "play");
  assert.equal(b.engine.state.cards[b.id("i3")].controllerId, P1);
  assert.equal(ready(b.engine), 5, "8 - X (3); the item's own cost of 3 was free");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TWD, "0:ability:thankgod", "choosing to play it but then not playing it ('If you don't') puts the item into my hand", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, P1, [b.id("i3")]);
  chooseOption(b.engine, P1, /deploy|play/i);
  freePlayAnswer(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("i3")), "hand", "not played, so it goes to my hand");
});

clause(TWD, "0:ability:thankgod", "an item I cannot play (missing resource icons) is put into my hand instead", () => {
  const needsRage = item({ name: "NeedsRage", cost: 1, threshold: "rr" as never });
  const b = twdBoard({ extra: [{ key: "nr", def: needsRage, owner: P1, zone: "deck" }] });
  twd(b, 3);
  pick(b.engine, P1, [b.id("nr")]);
  chooseOption(b.engine, P1, /deploy|play/i);
  if (pending(b.engine)?.kind === "deployForFree") {
    refused(() => freePlayAnswerRaw(b, "nr"), "no [R] icons: it cannot be played");
    freePlayAnswer(b);
  }
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("nr")), "hand", "it could not be played, so it goes to my hand");
});

clause(TWD, "0:ability:thankgod", "'you still need the proper resource icons': an item whose icons I have is played, one whose icons I lack is refused", () => {
  const needsElitism = item({ name: "NeedsElitism", cost: 1, threshold: "ee" as never });
  const ok = twdBoard({ elitism: 2, extra: [{ key: "ne", def: needsElitism, owner: P1, zone: "deck" }] });
  twd(ok, 3);
  pick(ok.engine, P1, [ok.id("ne")]);
  chooseOption(ok.engine, P1, /deploy|play/i);
  freePlayAnswer(ok, "ne");
  assert.equal(zoneOf(ok.engine, ok.id("ne")), "play", "with [E][E] it is played");
  const no = twdBoard({ extra: [{ key: "ne", def: needsElitism, owner: P1, zone: "deck" }] });
  twd(no, 3);
  pick(no.engine, P1, [no.id("ne")]);
  chooseOption(no.engine, P1, /deploy|play/i);
  refused(() => freePlayAnswerRaw(no, "ne"), "no [E] icons");
  assert.notEqual(zoneOf(no.engine, no.id("ne")), "play");
});

clause(TWD, "0:ability:thankgod", "'must pay any additional costs': playing the found item for free still costs its extra 'pay 2'", () => {
  const costly = item({ name: "Costly", cost: 2, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }] } } });
  const b = twdBoard({ extra: [{ key: "costly", def: costly, owner: P1, zone: "deck" }] });
  twd(b, 2);
  const afterX = ready(b.engine);
  pick(b.engine, P1, [b.id("costly")]);
  chooseOption(b.engine, P1, /deploy|play/i);
  freePlayAnswer(b, "costly");
  assert.equal(zoneOf(b.engine, b.id("costly")), "play");
  assert.equal(afterX - ready(b.engine), 2, "the numeric cost is free, the additional cost of 2 is paid");
});

clause(TWD, "0:ability:thankgod", "failing the search (taking nothing) ends the ability: there is no found card, so no 'play it for free / put it into your hand' question is asked", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, P1, []);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing was found, so there is nothing to play or to put into the hand");
});

clause(TWD, "0:ability:thankgod", "the search is optional (it has criteria): taking nothing leaves every item in the deck; the Device is still destroyed and X still paid", () => {
  const b = twdBoard();
  twd(b, 3);
  pick(b.engine, P1, []);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("twd")), "discard");
  assert.equal(ready(b.engine), 5);
  for (const key of ["i0", "i1", "i2", "i3", "i5"]) assert.equal(zoneOf(b.engine, b.id(key)), "deck", key);
  assert.equal(hand(b.engine, P1).length, 1, "only the card that was already in hand");
});

clause(TWD, "0:ability:thankgod", "the searched deck is shuffled afterwards (CR 312.1), whether or not a card was taken", () => {
  const b = twdBoard({ random: () => 0 });
  const before = [...deckOf(b.engine, P1)];
  twd(b, 3);
  pick(b.engine, P1, [b.id("i3")]);
  chooseOption(b.engine, P1, /hand/i);
  const remaining = before.filter((c) => c !== b.id("i3"));
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...remaining].sort(), "the same cards remain");
  assert.deepEqual(deckOf(b.engine, P1), shuffledWithConstant(remaining, 0), "and they were shuffled");
});

clause(TWD, "0:ability:thankgod", "the deck is shuffled even when the search finds nothing (no item with cost X or less in the deck)", () => {
  const b = twdBoard({ random: () => 0, noZeroItem: true });
  const before = [...deckOf(b.engine, P1)];
  twd(b, 0);
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(b.engine, P1), before, "the deck was searched, so it is shuffled");
});

clause(TWD, "0:ability:thankgod", "with no item at all in the deck nothing breaks: the Device is destroyed and X paid", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "twd", def: printing(TWD), owner: P1, zone: "play" },
      { key: "ch", def: character({ name: "Ch" }), owner: P1, zone: "deck" },
      ...bank("greed", 4, P1)
    ]
  });
  activate(b.engine, P1, b.id("twd"), "thankgod", { variables: { x: 2 } });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("twd")), "discard");
  assert.equal(ready(b.engine), 2);
  assert.equal(zoneOf(b.engine, b.id("ch")), "deck");
});

clause(TWD, "0:ability:thankgod", "only the Device's controller can use it", () => {
  const b = twdBoard();
  refused(() => activateRaw(b.engine, P2, b.id("twd"), "thankgod", {}, { x: 1 }), "the opponent");
  assert.equal(zoneOf(b.engine, b.id("twd")), "play");
});

clause(TWD, "0:ability:thankgod", "a deployed item works the turn it is found: it is in play under my control and its own abilities are mine", () => {
  const drawer = item({ name: "Drawer", cost: 1, behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const b = twdBoard({ extra: [{ key: "drawer", def: drawer, owner: P1, zone: "deck" }, ...fillers("c", 3, P1, "deck")] });
  twd(b, 2);
  pick(b.engine, P1, [b.id("drawer")]);
  chooseOption(b.engine, P1, /deploy|play/i);
  freePlayAnswer(b, "drawer");
  const handBefore = hand(b.engine, P1).length;
  activate(b.engine, P1, b.id("drawer"), "d");
  assert.equal(hand(b.engine, P1).length, handBefore + 1);
});

clause(TWD, "0:ability:thankgod", "costs 2 with [E][E][E][E]", () => {
  const spec: DeploySpec = { printingId: TWD, cost: 2, icon: "elitism", iconCount: 4 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
});

// ===============================================================================
// Top-Secret Subterranean Goofarium
// COVERT characters cannot inflict damage to this card. -- If you are attacked, you
// may detach up to X resources from your faction, where X is the number of members in
// the attacking party.
// Location, cost 2, threshold [E][E], structure 4.
// ===============================================================================

const GOOF = "5c340546-b7ed-4cfd-805d-7abdbf465bcd";

const pingLocation = (name: string, keywords: Array<"covert">, strength = 3, speed = 3) =>
  character({
    name,
    strength,
    life: 9,
    speed,
    behavior: {
      keywords,
      abilities: [
        {
          id: "ping",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]
        }
      ]
    }
  });

function goofBoard(opts: { goof?: "play" | "hand"; spent?: number; ready?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "goof", def: printing(GOOF), owner: P1, zone: opts.goof ?? "play" },
      { key: "loc2", def: location({ name: "OtherLoc", structure: 9 }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "covA", def: covertChar("CovA", { strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "covB", def: covertChar("CovB", { strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "fastCov", def: covertChar("FastCov", { strength: 3, life: 9, speed: 5 }), owner: P2, zone: "play" },
      { key: "plainA", def: character({ name: "PlainA", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "plainB", def: character({ name: "PlainB", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "plainC", def: character({ name: "PlainC", strength: 1, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "tac2", def: tactic({ name: "Tac2", cost: 2, behavior: { abilities: [{ id: "blank", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      ...spentResources(P1, opts.spent ?? 5),
      ...bank("greed", opts.ready ?? 0, P1),
      ...spentResources(P2, 2),
      ...(opts.extra ?? [])
    ]
  });
}
type GoofBoard = ReturnType<typeof goofBoard>;

/** `attackers` (P2) attack the card `targetKey` (or P1's faction when omitted). Returns once the declaration is made. */
const goofAttack = (b: GoofBoard, attackers: string[], targetKey?: string, attacker: Pid = P2) =>
  b.engine.perform({
    type: "declareAttack",
    playerId: attacker,
    attackerIds: attackers.map(b.id),
    target: targetKey ? { type: "card", cardId: b.id(targetKey) } : { type: "faction", playerId: other(attacker) }
  });

/** P2 attacks `targetKey` with `attackers`, I decline every choice, nobody blocks, and the battle is played out. */
function goofFight(b: GoofBoard, attackers: string[], targetKey?: string) {
  goofAttack(b, attackers, targetKey);
  drain(b.engine, declineAll);
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(b.engine);
  resolvePendingResponses(b.engine);
}
const goofDamage = (b: GoofBoard, key = "goof") => b.engine.state.cards[b.id(key)].damage;

clause(GOOF, "0:rule", "control: a non-covert attacker damages it normally (3 strength, 3 damage)", () => {
  const b = goofBoard();
  goofFight(b, ["plainA"], "goof");
  assert.equal(goofDamage(b), 3);
});

clause(GOOF, "0:rule", "a COVERT attacker inflicts no damage to it in battle", () => {
  const b = goofBoard();
  goofFight(b, ["covA"], "goof");
  assert.equal(goofDamage(b), 0);
  assert.equal(zoneOf(b.engine, b.id("goof")), "play");
});

clause(GOOF, "0:rule", "a whole party of COVERT attackers inflicts no damage to it", () => {
  const b = goofBoard();
  goofFight(b, ["covA", "covB", "fastCov"], "goof");
  assert.equal(goofDamage(b), 0);
});

clause(GOOF, "0:rule", "in a mixed party only the covert members are blocked: the non-covert attacker's damage (2) still lands", () => {
  const b = goofBoard();
  goofFight(b, ["covA", "plainB"], "goof");
  assert.equal(goofDamage(b), 2, "3 from the covert character is nothing, 2 from the plain one lands");
});

clause(GOOF, "0:rule", "the same holds when the covert member strikes at a different speed from the plain one", () => {
  const b = goofBoard();
  goofFight(b, ["fastCov", "plainA"], "goof");
  assert.equal(goofDamage(b), 3, "only the plain attacker's 3");
});

clause(GOOF, "0:rule", "enough non-covert damage still destroys it (structure 4): 3 + 2 from two plain attackers", () => {
  const b = goofBoard();
  goofFight(b, ["plainA", "plainB", "covA"], "goof");
  assert.equal(zoneOf(b.engine, b.id("goof")), "discard", "5 damage from the plain attackers destroys the 4-structure location");
});

clause(GOOF, "0:rule", "it protects only itself: a covert attacker damages another location of mine normally", () => {
  const b = goofBoard();
  goofFight(b, ["covA"], "loc2");
  assert.equal(goofDamage(b, "loc2"), 3);
  assert.equal(goofDamage(b), 0);
});

clause(GOOF, "0:rule", "a covert attacker still damages my faction normally", () => {
  const b = goofBoard();
  goofFight(b, ["covA"]);
  assert.equal(b.engine.state.players[P1].influence, 27);
});

clause(GOOF, "0:rule", "a covert character's non-battle damage (an ability) to it is 0 too, while a plain character's ability damages it", () => {
  const b = goofBoard({
    extra: [
      { key: "pingCov", def: pingLocation("PingCov", ["covert"]), owner: P2, zone: "play" },
      { key: "pingPlain", def: pingLocation("PingPlain", []), owner: P2, zone: "play" }
    ]
  });
  activate(b.engine, P2, b.id("pingCov"), "ping", { selected: { t: [b.id("goof")] } });
  assert.equal(goofDamage(b), 0, "covert");
  activate(b.engine, P2, b.id("pingCov"), "ping", { selected: { t: [b.id("loc2")] } });
  assert.equal(goofDamage(b, "loc2"), 3, "...but it damages other locations");
  activate(b.engine, P2, b.id("pingPlain"), "ping", { selected: { t: [b.id("goof")] } });
  assert.equal(goofDamage(b), 3, "control: a plain character damages it");
});

clause(GOOF, "0:rule", "the rule applies to any COVERT character, mine included", () => {
  const b = goofBoard({
    active: P1,
    extra: [{ key: "myPing", def: pingLocation("MyPing", ["covert"]), owner: P1, zone: "play" }]
  });
  activate(b.engine, P1, b.id("myPing"), "ping", { selected: { t: [b.id("goof")] } });
  assert.equal(goofDamage(b), 0);
});

clause(GOOF, "0:rule", "a character that has gained COVERT counts as COVERT: its attack does no damage to it", () => {
  const b = goofBoard({ extra: [{ key: "grant", def: grantTactic("covert"), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("grant"), { selected: { t: [b.id("plainA")] } });
  assert.ok(b.engine.getKeywords(b.id("plainA")).includes("covert"), "b.engine.getKeywords(b.id(\"plainA\")).includes(\"covert\")");
  goofFight(b, ["plainA"], "goof");
  assert.equal(goofDamage(b), 0);
});

clause(GOOF, "0:rule", "damage from a tactic (not a covert character) still hurts it: 4 damage destroys it", () => {
  const b = goofBoard({ extra: [{ key: "zap", def: zapTactic(4), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("zap"), { selected: { t: [b.id("goof")] } });
  assert.equal(zoneOf(b.engine, b.id("goof")), "discard");
});

clause(GOOF, "0:rule", "costs 2 with [E][E] and has structure 4", () => {
  const spec: DeploySpec = { printingId: GOOF, cost: 2, icon: "elitism", iconCount: 2 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  const b = goofBoard();
  assert.equal(b.engine.getStat(b.id("goof"), "structure"), 4);
});

// 1:rule — If you are attacked, you may detach up to X resources from your faction.

/** Declares the attack and returns with the offer open. */
function goofOffer(attackers: string[], targetKey?: string, opts: Parameters<typeof goofBoard>[0] = {}) {
  const b = goofBoard(opts);
  goofAttack(b, attackers, targetKey);
  return b;
}
const goofAttached = (b: GoofBoard) => attachedResources(b);

clause(GOOF, "1:rule", "when I am attacked I am offered the detach, right after the attack is declared and before blockers", () => {
  const b = goofOffer(["plainA", "plainB"]);
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the Goofarium's controller decides");
  assert.notEqual(battleOf(b.engine)?.phase, "blocking");
});

clause(GOOF, "1:rule", "a party of 2 attacks: up to 2 resources are detached", () => {
  const b = goofOffer(["plainA", "plainB"]);
  const att = goofAttached(b);
  assert.equal(att.length, 5);
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, att.slice(0, 3)), "X = 2: three is too many");
  pick(b.engine, P1, att.slice(0, 2));
  assert.equal(ready(b.engine), 2);
  for (const c of att.slice(0, 2)) assert.equal(b.engine.state.cards[c].attachedTo, undefined);
  for (const c of att.slice(2)) assert.equal(b.engine.state.cards[c].attachedTo, b.engine.state.players[P1].factionId);
});

clause(GOOF, "1:rule", "a lone attacker: X = 1, so only one resource may be detached", () => {
  const b = goofOffer(["plainA"]);
  const att = goofAttached(b);
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, att.slice(0, 2)), "X = 1: two is too many");
  pick(b.engine, P1, [att[0]]);
  assert.equal(ready(b.engine), 1);
});

clause(GOOF, "1:rule", "a party of 3: up to 3 resources may be detached", () => {
  const b = goofOffer(["plainA", "plainB", "plainC"]);
  const att = goofAttached(b);
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, att.slice(0, 4)), "X = 3: four is too many");
  pick(b.engine, P1, att.slice(0, 3));
  assert.equal(ready(b.engine), 3);
});

clause(GOOF, "1:rule", "'up to X': detaching fewer is fine", () => {
  const b = goofOffer(["plainA", "plainB", "plainC"]);
  const att = goofAttached(b);
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, [att[0]]);
  assert.equal(ready(b.engine), 1);
});

clause(GOOF, "1:rule", "an attack on the Goofarium itself counts as attacking me", () => {
  const b = goofOffer(["plainA"], "goof");
  assert.equal(pending(b.engine)?.playerId, P1);
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, [goofAttached(b)[0]]);
  assert.equal(ready(b.engine), 1);
});

clause(GOOF, "1:rule", "an attack on another location of mine counts too", () => {
  const b = goofOffer(["plainA", "plainB"], "loc2");
  assert.equal(pending(b.engine)?.playerId, P1);
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, goofAttached(b).slice(0, 2));
  assert.equal(ready(b.engine), 2);
});

clause(GOOF, "1:rule", "declining ('may'), or choosing to detach and taking none, detaches nothing", () => {
  const a = goofOffer(["plainA", "plainB"]);
  chooseOption(a.engine, P1, /decline/i);
  assert.equal(ready(a.engine), 0);
  assert.equal(a.engine.state.pendingChoice, undefined);
  const b = goofOffer(["plainA", "plainB"]);
  chooseOption(b.engine, P1, /detach/i);
  pick(b.engine, P1, []);
  assert.equal(ready(b.engine), 0);
});

clause(GOOF, "1:rule", "when I attack I am not 'attacked': no offer", () => {
  const b = goofBoard({ active: P1 });
  goofAttack(b, ["mine"], undefined, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 0);
});

clause(GOOF, "1:rule", "not in play, it does nothing: a Goofarium in my hand raises no offer", () => {
  const b = goofOffer(["plainA", "plainB"], undefined, { goof: "hand" });
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(GOOF, "1:rule", "the detached resources can be spent in response to the same attack; without the detach I could not afford a cost-2 tactic", () => {
  // answer the offer without draining the attack's response window, so I can still respond to the attack
  const answerOffer = (b: GoofBoard, index: number, selected?: string[]) => {
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index } } as never);
    if (selected) b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);
  };
  const b = goofOffer(["plainA", "plainB"]);
  answerOffer(b, 0, goofAttached(b).slice(0, 2));
  assert.equal(b.engine.state.pendingChoice, undefined);
  passUntil(b.engine, P1);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "the defender may respond to the attack");
  playRaw(b.engine, P1, b.id("tac2"));
  assert.equal(ready(b.engine), 0, "the tactic's 2 was paid from the detached resources");
  const c = goofOffer(["plainA", "plainB"]);
  answerOffer(c, 1);
  passUntil(c.engine, P1);
  assert.equal(c.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => playRaw(c.engine, P1, c.id("tac2")), "all my resources are still spent");
});

clause(GOOF, "1:rule", "only my own faction's resources can be picked: not a character, not the opponent's spent resources", () => {
  const b = goofOffer(["plainA", "plainB"]);
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, [b.id("mine")]), "a character");
  const theirs = attachedResources(b, P2);
  assert.ok(theirs.length >= 1, "theirs.length >= 1");
  refused(() => pickRaw(b.engine, P1, [theirs[0]]), "the opponent's resource");
  assert.equal(ready(b.engine, P2), 0);
  pick(b.engine, P1, [goofAttached(b)[0]]);
  assert.equal(ready(b.engine), 1, "control: my own resource works");
});

clause(GOOF, "1:rule", "only resources that are attached to the faction can be detached: a resource that is not attached cannot be picked", () => {
  const b = goofOffer(["plainA", "plainB"], undefined, { ready: 2 });
  const loose = b.engine.state.players[P1].play.filter((c) => b.engine.isResource(c) && b.engine.state.cards[c].attachedTo === undefined);
  assert.equal(loose.length, 2);
  chooseOption(b.engine, P1, /detach/i);
  refused(() => pickRaw(b.engine, P1, [loose[0]]), "a resource that is not attached cannot be detached");
});

clause(GOOF, "1:rule", "only the Goofarium's controller decides: the attacker cannot answer", () => {
  const b = goofOffer(["plainA", "plainB"]);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 0 } } as never),
    "the attacker cannot decide for me"
  );
  assert.ok(pending(b.engine), "pending(b.engine)");
});

clause(GOOF, "1:rule", "two Goofariums each offer a detach", () => {
  const b = goofBoard({ extra: [{ key: "goof2", def: printing(GOOF), owner: P1, zone: "play" }] });
  goofAttack(b, ["plainA", "plainB"]);
  let offers = 0;
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") {
      offers += 1;
      return { kind: "chooserSelectsOption", index: 1 };
    }
    return declineAll(pc);
  });
  assert.equal(offers, 2);
});

// ===============================================================================
// Unrelenting Ridicule
// COST: Pick a COVERT character. EFFECT: Destroy the character.
// Tactic, cost 2, threshold [E].
// ===============================================================================

const RIDICULE = "1bfa9585-adaf-4228-985e-16ace4b9cecb";

function ridiculeBoard(opts: { elitism?: number; greed?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "ur", def: printing(RIDICULE), owner: P1, zone: "hand" },
      { key: "foeCov", def: covertChar("FoeCov", { strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeCov2", def: covertChar("FoeCov2", { strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "myCov", def: covertChar("MyCov", { strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foePlain", def: character({ name: "FoePlain", strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fdCov", def: covertChar("FdCov"), owner: P2, zone: "play", faceDown: true },
      ...bank("elitism", opts.elitism ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}
type RidiculeBoard = ReturnType<typeof ridiculeBoard>;
const ridicule = (b: RidiculeBoard, target: string) => play(b.engine, P1, b.id("ur"), { selected: { c: [b.id(target)] } });
const ridiculeRaw = (b: RidiculeBoard, target: string) => playRaw(b.engine, P1, b.id("ur"), { selected: { c: [b.id(target)] } });

clause(RIDICULE, "0:ability", "destroys the picked COVERT character (the opponent's): it goes to its owner's discard pile, the tactic to mine", () => {
  const b = ridiculeBoard();
  ridicule(b, "foeCov");
  assert.equal(zoneOf(b.engine, b.id("foeCov")), "discard");
  assert.equal(discardOf(b.engine, P2).includes(b.id("foeCov")), true);
  assert.equal(zoneOf(b.engine, b.id("ur")), "discard");
  assert.equal(discardOf(b.engine, P1).includes(b.id("ur")), true);
});

clause(RIDICULE, "0:ability", "my own COVERT character can be picked and destroyed too", () => {
  const b = ridiculeBoard();
  ridicule(b, "myCov");
  assert.equal(zoneOf(b.engine, b.id("myCov")), "discard");
});

clause(RIDICULE, "0:ability", "only the picked character is destroyed: other covert and plain characters survive", () => {
  const b = ridiculeBoard();
  ridicule(b, "foeCov");
  for (const key of ["foeCov2", "myCov", "plain", "foePlain"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", key);
});

clause(RIDICULE, "0:ability", "pays exactly 2 as the cost, when it is played", () => {
  const b = ridiculeBoard();
  const before = ready(b.engine);
  ridiculeRaw(b, "foeCov");
  assert.equal(before - ready(b.engine), 2);
  assert.equal(zoneOf(b.engine, b.id("foeCov")), "play", "the destruction is the effect: not yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foeCov")), "discard");
});

clause(RIDICULE, "0:ability", "only COVERT characters can be picked: a plain character (mine or theirs), an item, a location, a face-down card, a faction or nothing is refused, and nothing is paid", () => {
  const b = ridiculeBoard();
  const before = ready(b.engine);
  refused(() => ridiculeRaw(b, "plain"), "my plain character");
  refused(() => ridiculeRaw(b, "foePlain"), "the opponent's plain character");
  refused(() => ridiculeRaw(b, "thing"), "an item");
  refused(() => ridiculeRaw(b, "place"), "a location");
  refused(() => ridiculeRaw(b, "fdCov"), "a face-down card has no keywords");
  refused(() => playRaw(b.engine, P1, b.id("ur"), { selected: { c: [b.engine.state.players[P2].factionId!] } }), "the opponent's faction");
  refused(() => playRaw(b.engine, P1, b.id("ur"), { selected: {} }), "no pick");
  assert.equal(zoneOf(b.engine, b.id("ur")), "hand");
  assert.equal(ready(b.engine), before, "nothing was paid");
  ridiculeRaw(b, "foeCov");
  assert.ok(b.engine.state.responseWindow, "control: a covert character is accepted");
});

clause(RIDICULE, "0:ability", "a character that gained COVERT this turn is a COVERT character; one that has not is refused", () => {
  const b = ridiculeBoard({ extra: [{ key: "grant", def: grantTactic("covert"), owner: P1, zone: "hand" }] });
  refused(() => ridiculeRaw(b, "foePlain"), "not covert yet");
  play(b.engine, P1, b.id("grant"), { selected: { t: [b.id("foePlain")] } });
  assert.ok(b.engine.getKeywords(b.id("foePlain")).includes("covert"), "b.engine.getKeywords(b.id(\"foePlain\")).includes(\"covert\")");
  ridicule(b, "foePlain");
  assert.equal(zoneOf(b.engine, b.id("foePlain")), "discard");
});

clause(RIDICULE, "0:ability", "can be played in response to an attack by a covert party, destroying the attacker and ending its battle damage", () => {
  const b = ridiculeBoard({ active: P2 });
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("foeCov")], target: { type: "faction", playerId: P1 } });
  b.engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  ridiculeRaw(b, "foeCov");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foeCov")), "discard");
  assert.equal(b.engine.state.players[P1].influence, 30, "no damage got through");
});

clause(RIDICULE, "0:ability", "costs 2 and needs [E]", () => {
  const spec: DeploySpec = {
    printingId: RIDICULE,
    cost: 2,
    icon: "elitism",
    iconCount: 1,
    ends: "discard",
    extra: [{ key: "t", def: covertChar("T"), owner: P2, zone: "play" }],
    selected: (id) => ({ c: [id("t")] })
  };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
});

// ===============================================================================
// Auction House
// At the start of each player's turn, that player must reveal cards from the top of
// their deck until a character is revealed or no cards are left. If a character is
// revealed, players take turns bidding starting with the active player. Players
// cannot bid a number greater than the number of detached resources they control.
// Whichever player makes the winning bid pays that many resources and puts the
// character into play under their control. Shuffle all other revealed cards into
// their owner's deck.
// Location, cost 3, threshold [D][D][D], structure 4.
// ===============================================================================

const AUCTION = "71886432-9edb-44a6-b9aa-7890b3267cf3";

const prizeChar = (name: string) => character({ name, strength: 2, life: 3, speed: 2 });

/** The standard deck of the player whose turn starts: four non-characters, the prize character, then two more cards (top first). */
function auctionDeck(owner: Pid, prefix = ""): CardPlacement[] {
  return [
    { key: `${prefix}it1`, def: item({ name: `${prefix}It1` }), owner, zone: "deck" },
    { key: `${prefix}tac1`, def: tactic({ name: `${prefix}Tac1` }), owner, zone: "deck" },
    { key: `${prefix}loc1`, def: location({ name: `${prefix}Loc1` }), owner, zone: "deck" },
    { key: `${prefix}res1`, def: resourceCard({ name: `${prefix}Res1` }), owner, zone: "deck" },
    { key: `${prefix}ch1`, def: prizeChar(`${prefix}Prize`), owner, zone: "deck" },
    { key: `${prefix}x1`, def: item({ name: `${prefix}X1` }), owner, zone: "deck" },
    { key: `${prefix}ch2`, def: prizeChar(`${prefix}Second`), owner, zone: "deck" }
  ];
}

interface AuctionOpts {
  /** Whose turn is about to start. */
  startOf: Pid;
  houseOwner?: Pid;
  houseZone?: "play" | "hand" | "discard";
  houseFaceDown?: boolean;
  /** Deck of the player whose turn starts (default: the standard deck); [] for an empty deck. */
  deck?: CardPlacement[];
  /** Ready (detached) resources for each player at the moment their bidding happens. */
  ready1?: number;
  ready2?: number;
  /** Already-spent resources (attached to the faction) for each player. */
  spent1?: number;
  spent2?: number;
  random?: () => number;
  extra?: CardPlacement[];
}

function auctionBoard(opts: AuctionOpts) {
  const startOf = opts.startOf;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: other(startOf),
    random: opts.random ?? (() => 0),
    cards: [
      { key: "house", def: printing(AUCTION), owner: opts.houseOwner ?? P1, zone: opts.houseZone ?? "play", faceDown: opts.houseFaceDown },
      ...(opts.deck ?? auctionDeck(startOf)),
      // the other player's deck must stay untouched by this turn start
      ...auctionDeck(other(startOf), "o"),
      ...bank("greed", opts.ready1 ?? 0, P1),
      ...bank("greed", opts.ready2 ?? 0, P2),
      ...spentResources(P1, opts.spent1 ?? 0),
      ...spentResources(P2, opts.spent2 ?? 0),
      ...(opts.extra ?? [])
    ]
  });
}
type AuctionBoard = ReturnType<typeof auctionBoard>;

/** The turn of `startOf` begins (the other player ends theirs). */
function beginTurn(b: AuctionBoard, startOf: Pid) {
  endTurn(b.engine, other(startOf));
  assert.equal(b.engine.state.activePlayerId, startOf);
}

const bid = (b: AuctionBoard, player: Pid, amount: number) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "auctionBid", bid: amount } } as never);
  resolvePendingResponses(b.engine);
};
const bidRaw = (b: AuctionBoard, player: Pid, amount: number) =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "auctionBid", bid: amount } } as never);
const bidPrompt = (b: AuctionBoard) => {
  const pc = pending(b.engine);
  return pc?.kind === "auctionBid" ? pc : undefined;
};
/** Ids of the characters in `player`'s play area that are named `name`. */
const inPlayNamed = (b: AuctionBoard, name: string) =>
  Object.values(b.engine.state.cards)
    .filter((c) => c.zone === "play" && b.engine.getDefinition(c.id).name === name)
    .map((c) => c.id);
const revealedBy = (b: AuctionBoard) =>
  b.engine
    .getLog()
    .filter((entry) => entry.event?.type === "cardsRevealed")
    .map((entry) => entry.event as unknown as { cardIds: string[]; ownerId?: string });
const SORT = (xs: string[]) => [...xs].sort();

clause(AUCTION, "0:rule", "at the start of the player's turn it reveals cards from the top of THEIR deck down to and including the first character, and bidding opens", () => {
  const b = auctionBoard({ startOf: P2, ready2: 3 });
  const oppDeck = [...deckOf(b.engine, P1)];
  beginTurn(b, P2);
  const reveals = revealedBy(b).filter((ev) => ev.cardIds.includes(b.id("ch1")));
  assert.equal(reveals.length, 1, "one reveal that reaches the prize");
  assert.deepEqual(reveals[0].cardIds, ["it1", "tac1", "loc1", "res1", "ch1"].map(b.id), "top to bottom, up to and including the first character");
  assert.ok(bidPrompt(b), "bidding is open");
  assert.equal(bidPrompt(b)?.characterId, b.id("ch1"));
  assert.deepEqual(deckOf(b.engine, P1), oppDeck, "the other player's deck was not touched");
});

clause(AUCTION, "0:rule", "the reveal skips every non-character: items, tactics, locations and resource cards are passed over", () => {
  const b = auctionBoard({ startOf: P2, ready2: 3 });
  beginTurn(b, P2);
  assert.equal(bidPrompt(b)?.characterId, b.id("ch1"), "the first character, not the item on top");
});

clause(AUCTION, "0:rule", "it triggers at the start of EACH player's turn: at the start of mine it reveals from MY deck", () => {
  const b = auctionBoard({ startOf: P1, ready1: 3 });
  const oppDeck = [...deckOf(b.engine, P2)];
  beginTurn(b, P1);
  const pc = bidPrompt(b);
  assert.ok(pc, "bidding is open at the start of my turn too");
  assert.equal(pc.characterId, b.id("ch1"), "my deck's character");
  assert.equal(pc.playerId, P1, "I am the active player and bid first");
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "the opponent's deck was not touched");
});

clause(AUCTION, "0:rule", "it works whoever controls it: the opponent's Auction House reveals from my deck at the start of my turn", () => {
  const b = auctionBoard({ startOf: P1, houseOwner: P2, ready1: 3 });
  beginTurn(b, P1);
  assert.equal(bidPrompt(b)?.characterId, b.id("ch1"));
  const c = auctionBoard({ startOf: P2, houseOwner: P2, ready2: 3 });
  beginTurn(c, P2);
  assert.equal(bidPrompt(c)?.characterId, c.id("ch1"), "and at the start of its controller's own turn");
});

clause(AUCTION, "0:rule", "the first bid belongs to the active player, then the other player, alternating", () => {
  const b = auctionBoard({ startOf: P2, ready1: 5, ready2: 5 });
  beginTurn(b, P2);
  assert.equal(bidPrompt(b)?.playerId, P2, "the active player bids first");
  bid(b, P2, 1);
  assert.equal(bidPrompt(b)?.playerId, P1, "then the other player");
  bid(b, P1, 2);
  assert.equal(bidPrompt(b)?.playerId, P2, "then back to the first");
});

clause(AUCTION, "0:rule", "only the player whose turn it is to bid can answer", () => {
  const b = auctionBoard({ startOf: P2, ready1: 5, ready2: 5 });
  beginTurn(b, P2);
  refused(() => bidRaw(b, P1, 1), "it is the active player's bid");
  assert.equal(bidPrompt(b)?.playerId, P2);
});

clause(AUCTION, "0:rule", "each bid must be higher than the last: equal or lower bids are refused", () => {
  const b = auctionBoard({ startOf: P2, ready1: 6, ready2: 6 });
  beginTurn(b, P2);
  bid(b, P2, 2);
  refused(() => bidRaw(b, P1, 2), "equal to the last bid");
  refused(() => bidRaw(b, P1, 1), "lower than the last bid");
  assert.equal(bidPrompt(b)?.playerId, P1, "still waiting for my bid");
  bid(b, P1, 3);
  refused(() => bidRaw(b, P2, 3), "equal to the last bid");
  bid(b, P2, 4);
  assert.equal(bidPrompt(b)?.playerId, P1);
});

clause(AUCTION, "0:rule", "a player cannot bid more than the detached resources they control: 4 with 3 is refused, 3 is fine", () => {
  const b = auctionBoard({ startOf: P2, ready2: 3 });
  beginTurn(b, P2);
  refused(() => bidRaw(b, P2, 4), "only 3 detached resources");
  assert.equal(bidPrompt(b)?.playerId, P2, "the bid is still open");
  bid(b, P2, 3);
  assert.equal(bidPrompt(b)?.playerId, P1);
});

clause(AUCTION, "0:rule", "only DETACHED resources count: resources already spent (attached to the faction) do not raise the cap", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2, ready1: 2, spent1: 3 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  refused(() => bidRaw(b, P1, 3), "5 resources, but 3 are attached");
  refused(() => bidRaw(b, P1, 5), "all five");
  bid(b, P1, 2);
  assert.equal(bidPrompt(b)?.playerId, P2);
});

clause(AUCTION, "0:rule", "the active player's spent resources are detached by the turn-start restore, so they all count", () => {
  const b = auctionBoard({ startOf: P2, spent2: 4 });
  beginTurn(b, P2);
  assert.equal(ready(b.engine, P2), 4, "restored: all four are detached");
  bid(b, P2, 4);
  assert.equal(bidPrompt(b)?.playerId, P1);
});

clause(AUCTION, "0:rule", "a player with no detached resources cannot bid at all: only passing is possible", () => {
  const b = auctionBoard({ startOf: P2, ready2: 0, ready1: 2 });
  beginTurn(b, P2);
  refused(() => bidRaw(b, P2, 1), "no detached resources");
  bid(b, P2, 0);
  assert.equal(bidPrompt(b)?.playerId, P1, "I may still bid");
});

clause(AUCTION, "0:rule", "a bid must be a whole number: 1.5 and negative numbers are refused (CR 410.2)", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4 });
  beginTurn(b, P2);
  refused(() => bidRaw(b, P2, 1.5), "a fractional bid");
  refused(() => bidRaw(b, P2, -1), "a negative bid");
  assert.equal(bidPrompt(b)?.playerId, P2);
});

clause(AUCTION, "0:rule", "the highest bidder wins: the character enters play under their control, they pay exactly the winning bid, the loser pays nothing", () => {
  const b = auctionBoard({ startOf: P2, ready1: 5, ready2: 5 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 2);
  bid(b, P2, 0);
  assert.equal(b.engine.state.pendingChoice, undefined, "the auction is over");
  const prize = b.id("ch1");
  assert.equal(zoneOf(b.engine, prize), "play");
  assert.equal(b.engine.state.cards[prize].controllerId, P1, "under the winner's control, although it came from the other player's deck");
  assert.equal(b.engine.state.cards[prize].ownerId, P2, "ownership never changes");
  assert.equal(ready(b.engine, P1), 3, "I paid my winning bid of 2");
  assert.equal(ready(b.engine, P2), 5, "the loser pays nothing");
});

clause(AUCTION, "0:rule", "the winner pays by attaching that many resources to their faction (they are not destroyed)", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4 });
  beginTurn(b, P2);
  const before = attachedResources(b, P2).length;
  bid(b, P2, 3);
  bid(b, P1, 0);
  assert.equal(attachedResources(b, P2).length - before, 3);
  assert.equal(ready(b.engine, P2), 1);
  assert.equal(b.engine.state.players[P2].play.filter((c) => b.engine.isResource(c)).length, 4, "all four resources are still in play");
});

clause(AUCTION, "0:rule", "the active player can win too: bidding 2 while the other passes puts the character into play under the active player's control", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4, ready1: 4 });
  beginTurn(b, P2);
  bid(b, P2, 2);
  bid(b, P1, 0);
  assert.equal(zoneOf(b.engine, b.id("ch1")), "play");
  assert.equal(b.engine.state.cards[b.id("ch1")].controllerId, P2);
  assert.equal(ready(b.engine, P2), 2);
  assert.equal(ready(b.engine, P1), 4);
});

clause(AUCTION, "0:rule", "the other player can win with a first bid after the active player passes", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4, ready1: 4 });
  beginTurn(b, P2);
  bid(b, P2, 0);
  assert.equal(bidPrompt(b)?.playerId, P1, "I still get to bid");
  bid(b, P1, 1);
  // (whether the active player is asked again is covered by the CR 413.1b test; answer with a pass if so)
  while (bidPrompt(b)) bid(b, bidPrompt(b)!.playerId as Pid, 0);
  assert.equal(b.engine.state.cards[b.id("ch1")].controllerId, P1);
  assert.equal(zoneOf(b.engine, b.id("ch1")), "play");
  assert.equal(ready(b.engine, P1), 3);
});

clause(AUCTION, "0:rule", "a player who has passed may not bid again (CR 413.1b): after the active player passes and I bid, the auction is over", () => {
  const b = auctionBoard({ startOf: P2, ready2: 4, ready1: 4 });
  beginTurn(b, P2);
  bid(b, P2, 0);
  bid(b, P1, 1);
  assert.equal(b.engine.state.pendingChoice, undefined, "the active player passed and may not bid again: I win with 1");
  assert.equal(b.engine.state.cards[b.id("ch1")].controllerId, P1);
});

clause(AUCTION, "0:rule", "if nobody bids, nobody puts the character into play and nothing is paid", () => {
  const b = auctionBoard({ startOf: P2, ready1: 3, ready2: 3 });
  beginTurn(b, P2);
  bid(b, P2, 0);
  bid(b, P1, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.notEqual(zoneOf(b.engine, b.id("ch1")), "play");
  assert.equal(inPlayNamed(b, "Prize").length, 0);
  assert.equal(ready(b.engine, P1), 3);
  assert.equal(ready(b.engine, P2), 3);
});

clause(AUCTION, "0:rule", "after a winning bid all the other revealed cards are shuffled into their owner's deck (not lost, and not in a hand, the discard pile or play)", () => {
  const b = auctionBoard({ startOf: P2, ready1: 5, ready2: 5, random: () => 0 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  const others = ["it1", "tac1", "loc1", "res1"].map(b.id);
  for (const c of others) assert.equal(zoneOf(b.engine, c), "deck", "marked as being in the deck");
  assert.deepEqual(
    SORT(deckOf(b.engine, P2)),
    SORT(["it1", "tac1", "loc1", "res1", "x1", "ch2"].map(b.id)),
    "the deck holds the 4 shuffled cards and the 2 never revealed, without the prize"
  );
  assert.equal(hand(b.engine, P2).length, 0);
  assert.equal(discardOf(b.engine, P2).length, 0);
});

clause(AUCTION, "0:rule", "after a winning bid the returned cards really are shuffled: the deck is not left in its original order", () => {
  const b = auctionBoard({ startOf: P2, ready2: 5, random: () => 0 });
  const original = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  const afterSettle = deckOf(b.engine, P2);
  const expectedMembers = original.filter((c) => c !== b.id("ch1"));
  assert.deepEqual(SORT(afterSettle), SORT(expectedMembers), "the six non-prize cards are in the deck");
  assert.notDeepEqual(afterSettle, [b.id("x1"), b.id("ch2"), b.id("it1"), b.id("tac1"), b.id("loc1"), b.id("res1")], "not the unrevealed cards followed by the revealed ones in order");
  assert.notDeepEqual(afterSettle, expectedMembers, "not in the original order");
});

clause(AUCTION, "0:rule", "when nobody bids, all revealed cards are shuffled back: the deck holds every card again, in a new order", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2, random: () => 0 });
  const original = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  bid(b, P2, 0);
  bid(b, P1, 0);
  assert.deepEqual(SORT(deckOf(b.engine, P2)), SORT(original));
  assert.notDeepEqual(deckOf(b.engine, P2), original, "shuffled");
  assert.equal(hand(b.engine, P2).length, 0);
  assert.equal(discardOf(b.engine, P2).length, 0);
});

clause(AUCTION, "0:rule", "when nobody wins, the character is among the cards back in the deck: the deck is complete again", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2 });
  const original = SORT(deckOf(b.engine, P2));
  beginTurn(b, P2);
  bid(b, P2, 0);
  bid(b, P1, 0);
  assert.deepEqual(SORT(deckOf(b.engine, P2)), original, "all seven cards are back in the deck");
});

clause(AUCTION, "0:rule", "with no character in the deck every card is revealed, shuffled back, and there is no bidding", () => {
  const noChars = auctionDeck(P2).filter((p) => p.def.type !== "character");
  const b = auctionBoard({ startOf: P2, deck: noChars, ready2: 3, ready1: 3, random: () => 0 });
  const original = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "no bidding");
  assert.deepEqual(SORT(deckOf(b.engine, P2)), SORT(original), "all cards are back in the deck");
  const reveals = revealedBy(b).filter((ev) => ev.cardIds.length === original.length);
  assert.equal(reveals.length, 1, "every card was revealed");
  assert.notDeepEqual(deckOf(b.engine, P2), original, "and shuffled");
  assert.equal(ready(b.engine, P1), 3);
  assert.equal(ready(b.engine, P2), 3);
});

clause(AUCTION, "0:rule", "an empty deck: nothing is revealed and the turn goes on", () => {
  const b = auctionBoard({ startOf: P2, deck: [], ready2: 3 });
  beginTurn(b, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.responseWindow, undefined);
  assert.equal(b.engine.state.activePlayerId, P2);
});

clause(AUCTION, "0:rule", "a character on top: only that card is revealed, there is nothing to shuffle back, and the winner gets it", () => {
  const deck: CardPlacement[] = [
    { key: "ch1", def: prizeChar("Prize"), owner: P2, zone: "deck" },
    { key: "x1", def: item({ name: "X1" }), owner: P2, zone: "deck" }
  ];
  const b = auctionBoard({ startOf: P2, deck, ready2: 2 });
  beginTurn(b, P2);
  assert.equal(bidPrompt(b)?.characterId, b.id("ch1"));
  bid(b, P2, 1);
  bid(b, P1, 0);
  assert.equal(zoneOf(b.engine, b.id("ch1")), "play");
  assert.deepEqual(deckOf(b.engine, P2), [b.id("x1")]);
});

clause(AUCTION, "0:rule", "only the first character is the prize: a second character further down stays in the deck, unrevealed", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  assert.equal(zoneOf(b.engine, b.id("ch2")), "deck");
  assert.equal(revealedBy(b).some((ev) => ev.cardIds.includes(b.id("ch2"))), false, "never revealed");
});

clause(AUCTION, "0:rule", "the character is put into play (not deployed): its enters-play trigger works for the winner", () => {
  const etb = character({
    name: "Prize",
    strength: 2,
    life: 3,
    speed: 2,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const deck: CardPlacement[] = [
    { key: "ch1", def: etb, owner: P2, zone: "deck" },
    ...Array.from({ length: 3 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner: P1, zone: "deck" as const })),
    ...Array.from({ length: 2 }, (_, i) => ({ key: `g${i}`, def: character({ name: `G${i}` }), owner: P2, zone: "deck" as const }))
  ];
  const b = auctionBoard({ startOf: P2, deck, ready1: 3, ready2: 3 });
  const p1Hand = hand(b.engine, P1).length;
  const p2Hand = hand(b.engine, P2).length;
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 2);
  bid(b, P2, 0);
  drain(b.engine, declineAll);
  assert.equal(hand(b.engine, P1).length, p1Hand + 1, "the winner (controller) draws from the trigger");
  assert.equal(hand(b.engine, P2).length, p2Hand, "the deck's owner does not");
});

clause(AUCTION, "0:rule", "a character put into play at the start of the turn cannot attack that turn (CR 204.3b)", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  assert.equal(b.engine.state.cards[b.id("ch1")].controllerId, P2);
  refused(() => b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("ch1")], target: { type: "faction", playerId: P1 } }), "not in play since the start of the turn");
});

clause(AUCTION, "0:rule", "the turn carries on normally once the auction is over: no pending choice or response window is left", () => {
  const b = auctionBoard({ startOf: P2, ready2: 2 });
  beginTurn(b, P2);
  bid(b, P2, 1);
  bid(b, P1, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.responseWindow, undefined);
  assert.equal(b.engine.state.activePlayerId, P2);
  const handBefore = hand(b.engine, P2).length;
  developDraw(b.engine, P2);
  assert.equal(hand(b.engine, P2).length, handBefore + 1, "the active player can use their develop rule as usual");
});

clause(AUCTION, "0:rule", "it does nothing when it is not in play: an Auction House in the hand or in the discard pile reveals nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const b = auctionBoard({ startOf: P2, houseZone: zone, ready2: 3 });
    const deck = [...deckOf(b.engine, P2)];
    beginTurn(b, P2);
    assert.equal(b.engine.state.pendingChoice, undefined, `${zone}: no bidding`);
    assert.deepEqual(deckOf(b.engine, P2), deck, `${zone}: the deck is untouched`);
    assert.equal(revealedBy(b).length, 0);
  }
});

clause(AUCTION, "0:rule", "a face-down Auction House is only a resource and does nothing", () => {
  const b = auctionBoard({ startOf: P2, houseFaceDown: true, ready2: 3 });
  const deck = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P2), deck);
});

clause(AUCTION, "0:rule", "once it is destroyed it stops: the next turn start reveals nothing", () => {
  const b = auctionBoard({ startOf: P2, ready2: 3, extra: [{ key: "kill", def: destroyAnyTactic(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("house")] } });
  assert.equal(zoneOf(b.engine, b.id("house")), "discard");
  const deck = [...deckOf(b.engine, P2)];
  beginTurn(b, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P2), deck);
});

clause(AUCTION, "0:rule", "two Auction Houses each run an auction at the start of the turn, one after the other", () => {
  const chars = (owner: Pid): CardPlacement[] => Array.from({ length: 4 }, (_, i) => ({ key: `c${i}`, def: prizeChar(`C${i}`), owner, zone: "deck" as const }));
  const b = auctionBoard({ startOf: P2, deck: chars(P2), ready2: 3, ready1: 3, extra: [{ key: "house2", def: printing(AUCTION), owner: P1, zone: "play" }] });
  beginTurn(b, P2);
  // two copies of the same trigger ask the active player for an order first
  while (pending(b.engine)?.kind === "orderTriggers") {
    const pc = pending(b.engine) as unknown as { triggers: unknown[]; playerId: string };
    b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: pc.triggers[0] } } as never);
    resolvePendingResponses(b.engine);
  }
  assert.ok(bidPrompt(b), "the first auction");
  bid(b, P2, 0);
  bid(b, P1, 0);
  const second = bidPrompt(b);
  assert.ok(second, "the second Auction House starts its own auction");
  assert.equal(second.playerId, P2);
  bid(b, P2, 0);
  bid(b, P1, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(AUCTION, "0:rule", "costs 3 with [D][D][D] and has structure 4", () => {
  const spec: DeploySpec = { printingId: AUCTION, cost: 3, icon: "deception", iconCount: 3 };
  deployExact(spec);
  deployShort(spec);
  deployWrongIcons(spec);
  deployIconShort(spec);
  const b = auctionBoard({ startOf: P2 });
  assert.equal(b.engine.getStat(b.id("house"), "structure"), 4);
});

//<<END>>
