// Clause tests — batch 1st-edition-part-2-03. See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-part-2-03`. Expectations come from
// each card's PRINTED text and RULES.md; engine data is only used to drive the engine.

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
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import { clause, clauseMismatch, declineAll, drain, printing, holdResourceFace } from "./_clause.js";
import { battleOf, declareAttackBy, fight, playRaw } from "./_battle.js";
import { answerPending, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { developResource, endTurn, developOffers } from "./_turn.js";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;

const otherOf = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);

/** Raw `activateAbility` without draining the response window (use `activate` from the harness to drain it). */
function activateRaw(
  engine: SpoilsEngine,
  player: Pid,
  cardId: string,
  abilityId: string,
  opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}
) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

const hand = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deck = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discard = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const damageOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].damage;
const stats = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

/** Sorted copy, for comparing sets of card ids. */
const sameCards = (a: string[], b: string[], message = "same cards") => assert.deepEqual([...a].sort(), [...b].sort(), message);

/** The event types in the game log (for "no damage was dealt" style checks). */
const loggedEvents = (engine: SpoilsEngine, type: string) => engine.getLog().filter((entry) => entry.event?.type === type);

/** Passes priority for whoever holds it until `player` holds it (or the window closes). */
function passUntil(engine: SpoilsEngine, player: Pid) {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player && !engine.state.pendingChoice) {
    if (++guard > 50) throw new Error("passUntil did not converge");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

/** Answers the open `chooserSelectsTarget` with `selected` and lets the game continue. */
function pick(engine: SpoilsEngine, selected: string[]) {
  answerPending(engine, "chooserSelectsTarget", { selected });
}

/** `n` face-up staple resources for `owner` with fixed keys `<prefix>0..n-1` (so a test can name an individual resource). */
function resources(prefix: string, n: number, owner: Pid, icon: "rage" | "greed" | "deception" | "elitism" | "obsession" = "greed"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: resourceCard({ name: `Res ${prefix}${i}`, trade: "universal", resource: { provides: [icon], staple: true } }),
    owner,
    zone: "play" as const
  }));
}

/** Resource cards (and, via `isResource`, face-down cards) `player` has in play. */
const resourcesInPlay = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].play.filter((cardId) => engine.isResource(cardId));

/** A small seeded LCG: every shuffle / random pick in a test using it is reproducible (docs/TESTING.md: seed anything random). */
function seeded(seed = 12345): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Answers every pending choice with `fn(pc)`; anything it returns undefined for gets the decline answer. */
function driveWith(engine: SpoilsEngine, fn: (pc: { kind: string; playerId: string; [k: string]: unknown }) => unknown) {
  drain(engine, (pc) => fn(pc) ?? declineAll(pc));
}

/** Keeps resolving the current battle, answering trigger-order prompts, until it is over. */
function finishBattle(engine: SpoilsEngine, split?: Parameters<typeof autoResolveBattle>[1]) {
  let guard = 0;
  while ((engine.state.battle || engine.state.pendingChoice) && guard++ < 30) {
    if (engine.state.pendingChoice) drain(engine, declineAll);
    else autoResolveBattle(engine, split);
  }
  assert.equal(engine.state.battle, undefined, "the battle finished");
}

/** `fight`, but robust to "order your triggers" prompts. */
function fightThrough(
  engine: SpoilsEngine,
  attacker: Pid,
  attackers: string[],
  target: { type: "faction"; playerId: Pid } | { type: "card"; cardId: string },
  blockers: string[],
  split?: Parameters<typeof autoResolveBattle>[1]
) {
  declareAttackBy(engine, attacker, attackers, target);
  engine.perform({ type: "declareBlockers", playerId: otherOf(attacker), blockerIds: blockers });
  finishBattle(engine, split);
}

// =============================================================================
// Prudent Thug
// When this card enters play, your faction loses 3 influence.
// This card loses 1 strength and 1 life for each token on it.
// This card can attack only once each turn.
// RESTORE -- COST: Pay 1. Put a token on this card. -- EFFECT: Restore this card.
// Character (mercenary, investor), banker, cost 5, threshold [G][G], 4 / 3 / 5.
// =============================================================================

const THUG = "02c2f936-b92e-4051-badb-c9a15d0371c1";

function thugBoard(
  opts: {
    thug?: "hand" | "play";
    greed?: number;
    rage?: number;
    turn?: number;
    active?: Pid;
    owner?: Pid;
    tokens?: number;
    depleted?: boolean;
    influenceA?: number;
    extra?: CardPlacement[];
  } = {}
) {
  const owner = opts.owner ?? P1;
  const zone = opts.thug ?? "hand";
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influenceA },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? owner,
    cards: [
      {
        key: "thug",
        def: printing(THUG),
        owner,
        zone,
        counters: opts.tokens ? { token: opts.tokens } : undefined,
        depleted: opts.depleted
      },
      { key: "ally", def: character({ name: "Ally", cost: 1, strength: 2, life: 4, speed: 1 }), owner, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: otherOf(owner), zone: "play" },
      ...bank("greed", opts.greed ?? 8, owner),
      ...bank("rage", opts.rage ?? 0, owner),
      ...(opts.extra ?? [])
    ]
  });
}

clause(THUG, "0:rule", "pays 5 to deploy and loses nothing until it actually enters play; then your faction loses exactly 3 influence", () => {
  const { engine, id } = thugBoard();
  const before = influence(engine, P1);
  const resources = ready(engine);
  playRaw(engine, P1, id("thug"));
  assert.equal(resources - ready(engine), 5, "the printed cost of 5 is paid");
  assert.equal(influence(engine, P1), before, "still being deployed: it has not entered play, so nothing is lost yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("thug")), "play");
  assert.equal(influence(engine, P1), before - 3, "your faction loses 3 influence when it enters play");
});

clause(THUG, "0:rule", "the loss is exactly 3, once (not per resource paid, not repeated on later turns), and the opponent's faction is untouched", () => {
  const { engine, id } = thugBoard();
  const mine = influence(engine, P1);
  const theirs = influence(engine, P2);
  play(engine, P1, id("thug"));
  assert.equal(mine - influence(engine, P1), 3);
  assert.equal(influence(engine, P2), theirs, "the opponent's faction does not lose influence");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(influence(engine, P1), mine - 3, "no further influence is lost when turns pass");
  assert.equal(influence(engine, P2), theirs);
});

clause(THUG, "0:rule", "it is 'your faction': a Thug deployed by the second player costs THAT player's faction 3 influence", () => {
  const { engine, id } = thugBoard({ owner: P2, active: P2 });
  const mine = influence(engine, P1);
  const theirs = influence(engine, P2);
  play(engine, P2, id("thug"));
  assert.equal(zoneOf(engine, id("thug")), "play");
  assert.equal(influence(engine, P2), theirs - 3, "its controller's faction loses 3");
  assert.equal(influence(engine, P1), mine, "the other faction is unchanged");
});

clause(THUG, "0:rule", "the influence loss is not damage: no damage event is dealt to the faction and the faction card holds no damage", () => {
  const { engine, id } = thugBoard();
  play(engine, P1, id("thug"));
  assert.equal(influence(engine, P1), 27);
  assert.equal(loggedEvents(engine, "damageDealt").length, 0, "CR 408.3b: a direct influence loss is not damage");
  assert.equal(damageOf(engine, engine.state.players[P1].factionId!), 0);
});

clause(THUG, "0:rule", "it triggers only for ITSELF entering play: another card entering play while a Thug is in play loses no influence", () => {
  const { engine, id } = thugBoard({ thug: "play" });
  const before = influence(engine, P1);
  play(engine, P1, id("ally"));
  assert.equal(zoneOf(engine, id("ally")), "play");
  assert.equal(influence(engine, P1), before, "a different card entering play does not trigger the Thug");
});

clause(THUG, "0:rule", "a Thug that starts the game on the table (never entered play) does not make the faction lose influence", () => {
  const { engine } = thugBoard({ thug: "play" });
  assert.equal(influence(engine, P1), 30);
});

clause(THUG, "0:rule", "'enters play' includes being put into play by an effect (not just deployed): a Thug raised from the discard pile costs 3 influence too", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "thug", def: printing(THUG), owner: P1, zone: "discard" },
      { key: "raise", def: raise, owner: P1, zone: "hand" }
    ]
  });
  const before = influence(engine, P1);
  play(engine, P1, id("raise"), { selected: { t: [id("thug")] } });
  assert.equal(zoneOf(engine, id("thug")), "play");
  assert.equal(influence(engine, P1), before - 3, "entering play by any route triggers the loss");
});

clause(THUG, "0:rule", "a second Thug entering play while the first is out costs 3 (not 6): only the entering Thug triggers", () => {
  const { engine, id } = thugBoard({
    thug: "play",
    extra: [{ key: "thug2", def: printing(THUG), owner: P1, zone: "hand" }]
  });
  const before = influence(engine, P1);
  play(engine, P1, id("thug2"));
  assert.equal(zoneOf(engine, id("thug2")), "play");
  assert.equal(influence(engine, P1), before - 3);
});

clause(THUG, "0:rule", "the loss happens even when it would take the faction to 0 influence, and the faction can't go negative (CR 410.4); the owner then loses", () => {
  const { engine, id } = thugBoard({ influenceA: 2 });
  play(engine, P1, id("thug"));
  assert.equal(zoneOf(engine, id("thug")), "play");
  assert.equal(influence(engine, P1), 0, "a number reduced below 0 stays at 0");
  assert.equal(engine.state.winner, P2, "a faction with 0 influence loses the game");
});

clause(THUG, "0:rule", "with exactly 3 influence the loss takes the faction to 0 and the owner loses; with 4 they survive on 1", () => {
  const survive = thugBoard({ influenceA: 4 });
  play(survive.engine, P1, survive.id("thug"));
  assert.equal(influence(survive.engine, P1), 1);
  assert.equal(survive.engine.state.winner, undefined, "1 influence left: the game goes on");
  const lose = thugBoard({ influenceA: 3 });
  play(lose.engine, P1, lose.id("thug"));
  assert.equal(influence(lose.engine, P1), 0);
  assert.equal(lose.engine.state.winner, P2, "0 influence: P1 loses");
});

clause(THUG, "0:rule", "is refused one resource short of its cost of 5, and without [G][G], and then the faction loses nothing", () => {
  const short = thugBoard({ greed: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("thug")));
  assert.equal(zoneOf(short.engine, short.id("thug")), "hand");
  assert.equal(influence(short.engine, P1), 30, "nothing happened");
  const noThreshold = thugBoard({ greed: 1, rage: 8 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("thug")), "only one [G]");
  const exact = thugBoard({ greed: 5 });
  play(exact.engine, P1, exact.id("thug"));
  assert.equal(zoneOf(exact.engine, exact.id("thug")), "play", "[G][G] and exactly 5 resources is enough");
  const mixed = thugBoard({ greed: 2, rage: 3 });
  play(mixed.engine, P1, mixed.id("thug"));
  assert.equal(zoneOf(mixed.engine, mixed.id("thug")), "play", "[G][G] plus three other resources is enough");
});

clause(THUG, "1:rule", "with no tokens it has its printed 4 strength and 5 life (speed 3 is unaffected)", () => {
  const { engine, id } = thugBoard({ thug: "play" });
  assert.deepEqual(stats(engine, id("thug")), [4, 5, 3]);
});

clause(THUG, "1:rule", "loses 1 strength and 1 life for EACH token: 1, 2, 3 and 4 tokens give 3/4, 2/3, 1/2 and 0/1 (speed never changes)", () => {
  for (const [tokens, strength, life] of [
    [1, 3, 4],
    [2, 2, 3],
    [3, 1, 2],
    [4, 0, 1]
  ] as const) {
    const { engine, id } = thugBoard({ thug: "play", tokens });
    assert.deepEqual(stats(engine, id("thug")), [strength, life, 3], `${tokens} token(s)`);
  }
});

clause(THUG, "1:rule", "strength stops at 0 (CR 410.4): with 5 tokens its strength is 0, not -1", () => {
  const { engine, id } = thugBoard({ thug: "play", tokens: 5 });
  assert.equal(engine.getStat(id("thug"), "strength"), 0, "a number an effect tries to reduce below 0 stays at 0");
});

clause(THUG, "1:rule", "the life loss is real: with 3 tokens (life 2) two damage destroys it, while the same damage does not destroy a Thug with 1 token (life 4)", () => {
  const dmg = tactic({
    name: "Zap2",
    cost: 0,
    behavior: {
      abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }]
    }
  });
  const weak = thugBoard({ thug: "play", tokens: 3, extra: [{ key: "zap", def: dmg, owner: P1, zone: "hand" }] });
  play(weak.engine, P1, weak.id("zap"), { selected: { t: [weak.id("thug")] } });
  assert.equal(zoneOf(weak.engine, weak.id("thug")), "discard", "2 damage against life 2 destroys it");
  const sturdy = thugBoard({ thug: "play", tokens: 1, extra: [{ key: "zap", def: dmg, owner: P1, zone: "hand" }] });
  play(sturdy.engine, P1, sturdy.id("zap"), { selected: { t: [sturdy.id("thug")] } });
  assert.equal(zoneOf(sturdy.engine, sturdy.id("thug")), "play", "2 damage against life 4 does not");
  const untouched = thugBoard({ thug: "play", tokens: 0, extra: [{ key: "zap", def: dmg, owner: P1, zone: "hand" }] });
  play(untouched.engine, P1, untouched.id("zap"), { selected: { t: [untouched.id("thug")] } });
  assert.equal(zoneOf(untouched.engine, untouched.id("thug")), "play", "life 5 survives 2 damage");
});

clause(THUG, "1:rule", "only tokens ON this card count: tokens on another card, or on a second Thug, don't weaken it", () => {
  const { engine, id } = thugBoard({
    thug: "play",
    extra: [
      { key: "thug2", def: printing(THUG), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "other", def: character({ name: "Other", strength: 4, life: 5 }), owner: P1, zone: "play", counters: { token: 3 } }
    ]
  });
  assert.deepEqual(stats(engine, id("thug")), [4, 5, 3], "the first Thug has no tokens");
  assert.deepEqual(stats(engine, id("thug2")), [1, 2, 3], "the second has 3");
  assert.deepEqual(stats(engine, id("other")), [4, 5, 1], "a card without the Thug's text isn't weakened by its own tokens");
});

clause(THUG, "1:rule", "it applies on the opponent's Thug just the same (it reads the card's own tokens, whoever controls it)", () => {
  const { engine, id } = thugBoard({ thug: "play", owner: P2, active: P2, tokens: 2 });
  assert.deepEqual(stats(engine, id("thug")), [2, 3, 3]);
});

clause(THUG, "1:rule", "the debuff ends as the tokens go: removing the tokens (the card leaves play and re-enters) gives full stats again", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "thug", def: printing(THUG), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      ...bank("greed", 8, P1)
    ]
  });
  assert.deepEqual(stats(engine, id("thug")), [2, 3, 3]);
  play(engine, P1, id("bounce"), { selected: { t: [id("thug")] } });
  assert.equal(zoneOf(engine, id("thug")), "hand");
  assert.equal(tokensOn(engine, id("thug")), 0, "CR 409.2: tokens disappear when the card leaves play");
  play(engine, P1, id("thug"));
  assert.equal(zoneOf(engine, id("thug")), "play");
  assert.deepEqual(stats(engine, id("thug")), [4, 5, 3], "a fresh Thug has no tokens, so no debuff");
});

clause(THUG, "2:rule", "it can attack once: the first attack is legal and the battle resolves (control)", () => {
  const { engine, id } = thugBoard({ thug: "play" });
  assert.ok(engine.getRestrictions(id("thug")).includes("attackOncePerTurn"), "engine.getRestrictions(id(\"thug\")).includes(\"attackOncePerTurn\")");
  const before = influence(engine, P2);
  fight(engine, P1, [id("thug")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(engine, P2), before - 4, "its 4 strength hit the faction");
  assert.equal(engine.state.cards[id("thug")].depleted, true, "attacking depletes it");
});

clause(THUG, "2:rule", "after it has attacked and been restored (RESTORE) it still cannot attack again this turn", () => {
  const { engine, id } = thugBoard({ thug: "play" });
  fight(engine, P1, [id("thug")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.cards[id("thug")].depleted, true);
  activate(engine, P1, id("thug"), "restore");
  assert.equal(engine.state.cards[id("thug")].depleted, false, "restored by RESTORE");
  assert.throws(() => declareAttackBy(engine, P1, [id("thug")]), "it already attacked this turn");
  assert.equal(engine.state.battle, undefined, "no second battle was started");
});

clause(THUG, "2:rule", "control: an ordinary character that attacked and was restored CAN attack again the same turn, and so can a Thug's ally", () => {
  const { engine, id } = thugBoard({
    thug: "play",
    extra: [{ key: "plain", def: character({ name: "Plain", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" }]
  });
  fight(engine, P1, [id("plain")], { type: "faction", playerId: P2 }, []);
  engine.state.cards[id("plain")].depleted = false; // restored
  fight(engine, P1, [id("plain")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.cards[id("plain")].depleted, true, "an ordinary character may attack twice with a restore in between");
  // ...but the Thug, which has not attacked yet, can still make its one attack
  fight(engine, P1, [id("thug")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.cards[id("thug")].depleted, true);
});

clause(THUG, "2:rule", "attacking alongside others counts as its attack: restored, it cannot attack again that turn", () => {
  const { engine, id } = thugBoard({
    thug: "play",
    extra: [{ key: "plain", def: character({ name: "Plain", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" }]
  });
  fight(engine, P1, [id("thug"), id("plain")], { type: "faction", playerId: P2 }, []);
  engine.state.cards[id("thug")].depleted = false;
  engine.state.cards[id("plain")].depleted = false;
  assert.throws(() => declareAttackBy(engine, P1, [id("thug")]), "the Thug already attacked");
  assert.throws(() => declareAttackBy(engine, P1, [id("thug"), id("plain")]), "...also as part of a party");
  assert.equal(engine.state.battle, undefined);
  fight(engine, P1, [id("plain")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.cards[id("plain")].depleted, true, "the plain character can attack again");
});

clause(THUG, "2:rule", "the limit is per turn: on its controller's next turn the Thug can attack again", () => {
  const { engine, id } = thugBoard({ thug: "play" });
  fight(engine, P1, [id("thug")], { type: "faction", playerId: P2 }, []);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("thug")].depleted, false, "restored at the start of the turn");
  const before = influence(engine, P2);
  fight(engine, P1, [id("thug")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(engine, P2), before - 4, "it attacked again on the new turn");
});

clause(THUG, "3:ability:restore", "COST: pay 1 and put a token on it are paid when RESTORE is activated; the token is on the card before the opponent can respond", () => {
  const { engine, id } = thugBoard({ thug: "play", depleted: true });
  const before = ready(engine);
  activateRaw(engine, P1, id("thug"), "restore");
  assert.equal(before - ready(engine), 1, "pay 1: exactly one resource");
  assert.equal(tokensOn(engine, id("thug")), 1, "the token is a COST, so it is already on the card while the ability waits for responses");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
});

clause(THUG, "3:ability:restore", "EFFECT: restore this card: a depleted Thug becomes ready, it has one token and has lost 1 strength and 1 life", () => {
  const { engine, id } = thugBoard({ thug: "play", depleted: true });
  assert.equal(engine.state.cards[id("thug")].depleted, true);
  const before = ready(engine);
  activate(engine, P1, id("thug"), "restore");
  assert.equal(engine.state.cards[id("thug")].depleted, false, "restored");
  assert.equal(tokensOn(engine, id("thug")), 1);
  assert.deepEqual(stats(engine, id("thug")), [3, 4, 3], "1 token: -1 strength, -1 life");
  assert.equal(before - ready(engine), 1);
});

clause(THUG, "3:ability:restore", "needs no threshold: a single resource of any kind pays for it", () => {
  const { engine, id } = thugBoard({ thug: "play", depleted: true, greed: 0, rage: 1 });
  activate(engine, P1, id("thug"), "restore");
  assert.equal(engine.state.cards[id("thug")].depleted, false);
  assert.equal(tokensOn(engine, id("thug")), 1);
  assert.equal(ready(engine), 0, "the one resource was spent");
});

clause(THUG, "3:ability:restore", "with no resource to pay it is refused: it stays depleted and no token is put on it", () => {
  const { engine, id } = thugBoard({ thug: "play", depleted: true, greed: 0 });
  assert.throws(() => activateRaw(engine, P1, id("thug"), "restore"));
  assert.equal(engine.state.cards[id("thug")].depleted, true);
  assert.equal(tokensOn(engine, id("thug")), 0, "the token is only put on as part of a paid cost");
  assert.equal(engine.state.responseWindow, undefined);
});

clause(THUG, "3:ability:restore", "each use pays 1 and adds a token: three uses (re-depleting in between) leave 3 tokens, 1/2 stats and 3 resources spent", () => {
  const { engine, id } = thugBoard({ thug: "play", depleted: true });
  const before = ready(engine);
  for (let i = 1; i <= 3; i++) {
    engine.state.cards[id("thug")].depleted = true;
    activate(engine, P1, id("thug"), "restore");
    assert.equal(tokensOn(engine, id("thug")), i, `after use ${i}`);
    assert.equal(engine.state.cards[id("thug")].depleted, false);
  }
  assert.deepEqual(stats(engine, id("thug")), [1, 2, 3]);
  assert.equal(before - ready(engine), 3);
});

clause(THUG, "3:ability:restore", "the token cost can kill it: the fifth token leaves a 5-life Thug with 0 life, so it is destroyed", () => {
  const { engine, id } = thugBoard({ thug: "play", depleted: true, tokens: 4 });
  assert.deepEqual(stats(engine, id("thug")), [0, 1, 3]);
  engine.state.cards[id("thug")].depleted = true;
  activate(engine, P1, id("thug"), "restore");
  assert.equal(zoneOf(engine, id("thug")), "discard", "0 life: a character with 0 life is destroyed (FAQ)");
});

clause(THUG, "3:ability:restore", "only its controller may use it", () => {
  const { engine, id } = thugBoard({ thug: "play", depleted: true, extra: bank("greed", 3, P2) });
  assert.throws(() => activateRaw(engine, P2, id("thug"), "restore"));
  assert.equal(tokensOn(engine, id("thug")), 0);
  assert.equal(engine.state.cards[id("thug")].depleted, true);
  activate(engine, P1, id("thug"), "restore");
  assert.equal(engine.state.cards[id("thug")].depleted, false, "control: the controller can");
});

clause(THUG, "3:ability:restore", "it restores only itself: a depleted ally stays depleted", () => {
  const { engine, id } = thugBoard({
    thug: "play",
    depleted: true,
    extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }]
  });
  activate(engine, P1, id("thug"), "restore");
  assert.equal(engine.state.cards[id("thug")].depleted, false);
  assert.equal(engine.state.cards[id("tired")].depleted, true, "only 'this card' is restored");
});

// =============================================================================
// Pugnacious Publicist
// When this card enters play, all your characters gain 1 life this turn.
// Character (publicist), banker, cost 3, threshold [G][G], 1 / 3 / 3.
// =============================================================================

const PUBLICIST = "cb4a80c5-060f-4738-bfb6-fa94e726f169";

function publicistBoard(opts: { pub?: "hand" | "play"; greed?: number; rage?: number; owner?: Pid; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  const foe = otherOf(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    cards: [
      { key: "pub", def: printing(PUBLICIST), owner, zone: opts.pub ?? "hand" },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 3, speed: 2 }), owner, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 4, life: 5, speed: 1 }), owner, zone: "play" },
      { key: "late", def: character({ name: "Late", cost: 1, strength: 2, life: 3, speed: 2 }), owner, zone: "hand" },
      { key: "f1", def: character({ name: "F1", strength: 2, life: 3, speed: 2 }), owner: foe, zone: "play" },
      { key: "f2", def: character({ name: "F2", strength: 2, life: 6, speed: 2 }), owner: foe, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 4 }), owner, zone: "play" },
      ...bank("greed", opts.greed ?? 8, owner),
      ...bank("rage", opts.rage ?? 0, owner),
      ...(opts.extra ?? [])
    ]
  });
}

clause(PUBLICIST, "0:rule", "pays 3 to deploy; every character you control gains exactly 1 life (and nothing else changes) once it is in play", () => {
  const { engine, id } = publicistBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("pub"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.deepEqual(stats(engine, id("a1")), [2, 3, 2], "nothing happens while it is only being deployed");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("pub")), "play");
  assert.deepEqual(stats(engine, id("a1")), [2, 4, 2], "+1 life only: strength and speed are unchanged");
  assert.deepEqual(stats(engine, id("a2")), [4, 6, 1], "all your characters, not just one");
});

clause(PUBLICIST, "0:rule", "'all your characters' includes the Publicist itself (it is a character you control that is in play)", () => {
  const { engine, id } = publicistBoard();
  play(engine, P1, id("pub"));
  assert.deepEqual(stats(engine, id("pub")), [1, 4, 3], "printed life 3, +1");
});

clause(PUBLICIST, "0:rule", "the opponent's characters gain nothing", () => {
  const { engine, id } = publicistBoard();
  play(engine, P1, id("pub"));
  assert.deepEqual(stats(engine, id("f1")), [2, 3, 2]);
  assert.deepEqual(stats(engine, id("f2")), [2, 6, 2]);
});

clause(PUBLICIST, "0:rule", "it is 'your' characters from the controller's view: the second player's Publicist helps the second player's characters only", () => {
  const { engine, id } = publicistBoard({ owner: P2 });
  play(engine, P2, id("pub"));
  assert.deepEqual(stats(engine, id("a1")), [2, 4, 2], "P2's A1 (owner P2) gains 1 life");
  assert.deepEqual(stats(engine, id("f1")), [2, 3, 2], "P1's character does not");
  assert.deepEqual(stats(engine, id("f2")), [2, 6, 2]);
});

clause(PUBLICIST, "0:rule", "the extra life is real: damage that would have destroyed a 3-life character leaves it alive (3 damage on a 4-life A1), while a character the Publicist did not help dies to the same damage", () => {
  const dmg = (amount: number) =>
    tactic({
      name: `Zap${amount}`,
      cost: 0,
      behavior: {
        abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }]
      }
    });
  const { engine, id } = publicistBoard({
    extra: [
      { key: "zapA", def: dmg(3), owner: P1, zone: "hand" },
      { key: "zapB", def: dmg(3), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("pub"));
  play(engine, P1, id("zapA"), { selected: { t: [id("a1")] } });
  assert.equal(zoneOf(engine, id("a1")), "play", "3 damage against 4 life");
  assert.equal(damageOf(engine, id("a1")), 3);
  play(engine, P1, id("zapB"), { selected: { t: [id("f1")] } });
  assert.equal(zoneOf(engine, id("f1")), "discard", "control: the opponent's 3-life character gets no help");
});

clause(PUBLICIST, "0:rule", "'this turn': the life bonus is gone on the next turn (the opponent's) and stays gone on yours", () => {
  const { engine, id } = publicistBoard();
  play(engine, P1, id("pub"));
  assert.equal(engine.getStat(id("a1"), "life"), 4);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("a1"), "life"), 3, "ended with the turn");
  assert.equal(engine.getStat(id("pub"), "life"), 3);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.getStat(id("a1"), "life"), 3, "and it does not come back");
  assert.equal(engine.getStat(id("a2"), "life"), 5);
});

clause(PUBLICIST, "0:rule", "it affects the characters you have WHEN it enters play: one that enters later in the turn does not gain the life", () => {
  const { engine, id } = publicistBoard();
  play(engine, P1, id("pub"));
  play(engine, P1, id("late"));
  assert.equal(zoneOf(engine, id("late")), "play");
  assert.equal(engine.getStat(id("late"), "life"), 3, "entered after the Publicist: not 'all your characters' at that moment");
  assert.equal(engine.getStat(id("a1"), "life"), 4, "control: the earlier characters still have the bonus");
});

clause(PUBLICIST, "0:rule", "only characters: an item and a location you control are not affected, and no extra damage capacity appears", () => {
  const { engine, id } = publicistBoard();
  const structure = engine.getDefinition(id("place")).structure;
  play(engine, P1, id("pub"));
  assert.equal(engine.getStat(id("a1"), "life"), 4, "control: characters did gain");
  assert.equal(engine.getDefinition(id("place")).structure, structure);
  assert.equal(engine.getStat(id("gadget"), "life") ?? 0, 0, "an item has no life to gain");
});

clause(PUBLICIST, "0:rule", "it fires when the Publicist enters play, not when another card does: a Publicist already in play does not pump a later arrival", () => {
  const { engine, id } = publicistBoard({ pub: "play" });
  play(engine, P1, id("late"));
  assert.equal(engine.getStat(id("late"), "life"), 3);
  assert.equal(engine.getStat(id("a1"), "life"), 3);
  assert.equal(engine.getStat(id("pub"), "life"), 3, "starting on the table is not 'entering play'");
});

clause(PUBLICIST, "0:rule", "two Publicists in one turn stack: the second adds another +1 to every character, the first Publicist included", () => {
  const { engine, id } = publicistBoard({ extra: [{ key: "pub2", def: printing(PUBLICIST), owner: P1, zone: "hand" }] });
  play(engine, P1, id("pub"));
  play(engine, P1, id("pub2"));
  assert.equal(engine.getStat(id("a1"), "life"), 5, "two bonuses");
  assert.equal(engine.getStat(id("pub"), "life"), 5, "the first Publicist got both");
  assert.equal(engine.getStat(id("pub2"), "life"), 4, "the second only gets its own");
  assert.equal(engine.getStat(id("f1"), "life"), 3);
});

clause(PUBLICIST, "0:rule", "'enters play' includes being put into play by an effect: a Publicist raised from the discard pile gives the life bonus too", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [{ id: "raise", type: "activated", targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });
  const { engine, id } = publicistBoard({ extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }, { key: "dead", def: printing(PUBLICIST), owner: P1, zone: "discard" }] });
  play(engine, P1, id("raise"), { selected: { t: [id("dead")] } });
  assert.equal(zoneOf(engine, id("dead")), "play");
  assert.equal(engine.getStat(id("a1"), "life"), 4);
  assert.equal(engine.getStat(id("dead"), "life"), 4, "it counts itself");
  assert.equal(engine.getStat(id("f1"), "life"), 3, "the opponent's characters gain nothing");
});

clause(PUBLICIST, "0:rule", "is refused one resource short of its cost of 3, and without [G][G]", () => {
  const short = publicistBoard({ greed: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("pub")));
  assert.equal(zoneOf(short.engine, short.id("pub")), "hand");
  assert.equal(short.engine.getStat(short.id("a1"), "life"), 3, "no bonus from a refused play");
  const noThreshold = publicistBoard({ greed: 1, rage: 8 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("pub")), "only one [G]");
  const exact = publicistBoard({ greed: 3 });
  play(exact.engine, P1, exact.id("pub"));
  assert.equal(zoneOf(exact.engine, exact.id("pub")), "play", "[G][G] and exactly 3 resources");
  assert.equal(ready(exact.engine), 0);
  const mixed = publicistBoard({ greed: 2, rage: 1 });
  play(mixed.engine, P1, mixed.id("pub"));
  assert.equal(zoneOf(mixed.engine, mixed.id("pub")), "play", "[G][G] plus one other resource");
});

// =============================================================================
// Randolph von Macovawitz Spitoon III, Ltd.
// UNIQUE RANDOLPH
// When this card enters play, draw a card.
// PAYDAY LOAN -- COST: Pay 1. Discard a resource or destroy a resource you
// control. -- EFFECT: Draw a card.
// Character (mau), banker, cost 4, threshold [G][G][G][G], 2 / 3 / 3.
// =============================================================================

const RANDOLPH = "61a6a464-9af8-4ffd-8519-90de271c5500";

function randolphBoard(
  opts: {
    zone?: "hand" | "play";
    greed?: number;
    rage?: number;
    deckSize?: number;
    owner?: Pid;
    active?: Pid;
    handResources?: number;
    faceDown?: number;
    extra?: CardPlacement[];
  } = {}
) {
  const owner = opts.owner ?? P1;
  const foe = otherOf(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    cards: [
      { key: "rand", def: printing(RANDOLPH), owner, zone: opts.zone ?? "hand" },
      { key: "ally", def: character({ name: "Ally", cost: 1 }), owner, zone: "hand" },
      { key: "hchar", def: character({ name: "Hand Char", cost: 3 }), owner, zone: "hand" },
      ...Array.from({ length: opts.handResources ?? 0 }, (_, i) => ({
        key: `hres${i}`,
        def: resourceCard({ name: `Hand Staple ${i}`, trade: "universal" }),
        owner,
        zone: "hand" as const
      })),
      ...fillers("d", opts.deckSize ?? 5, owner, "deck"),
      ...fillers("e", 3, foe, "deck"),
      { key: "foeChar", def: character({ name: "Foe Char" }), owner: foe, zone: "play" },
      ...resources("g", opts.greed ?? 6, owner, "greed"),
      ...resources("r", opts.rage ?? 0, owner, "rage"),
      ...Array.from({ length: opts.faceDown ?? 0 }, (_, i) => ({
        key: `fd${i}`,
        def: character({ name: `Hidden ${i}`, cost: 2 }),
        owner,
        zone: "play" as const,
        faceDown: true
      })),
      ...resources("fr", 2, foe, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

// --- UNIQUE RANDOLPH -----------------------------------------------------------

for (const keep of ["rand", "rand2"] as const) {
  clause(RANDOLPH, "0:unique", `a second Randolph: its controller is asked which to keep (keeping the ${keep === "rand" ? "old" : "new"} one); the other copy is destroyed`, () => {
    const { engine, id } = randolphBoard({ zone: "play", greed: 5, extra: [{ key: "rand2", def: printing(RANDOLPH), owner: P1, zone: "hand" }] });
    play(engine, P1, id("rand2"));
    const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "uniqueSurvivor", "a 'keep one' choice is open");
    assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
    sameCards(pc.candidates, [id("rand"), id("rand2")]);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    const gone = keep === "rand" ? "rand2" : "rand";
    assert.equal(zoneOf(engine, id(keep)), "play", "the chosen copy stays");
    assert.equal(zoneOf(engine, id(gone)), "discard", "the other copy is destroyed");
    assert.equal(discard(engine, P1).includes(id(gone)), true, "into its owner's discard pile");
    assert.equal(engine.state.pendingChoice, undefined);
  });

  clause(RANDOLPH, "0:unique", `after the UNIQUE choice (keeping the ${keep === "rand" ? "old" : "new"} Randolph) the deploy finishes and the game carries on`, () => {
    const { engine, id } = randolphBoard({ zone: "play", greed: 5, extra: [{ key: "rand2", def: printing(RANDOLPH), owner: P1, zone: "hand" }] });
    play(engine, P1, id("rand2"));
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.responseWindow, undefined, "the response window closed: the deploy is over");
    endTurn(engine, P1);
    assert.equal(engine.state.activePlayerId, P2, "the turn can be ended afterwards");
  });
}

clause(RANDOLPH, "0:unique", "the 'keep' answer must name one of the two Randolphs", () => {
  const { engine, id } = randolphBoard({ zone: "play", greed: 5, extra: [{ key: "rand2", def: printing(RANDOLPH), owner: P1, zone: "hand" }] });
  play(engine, P1, id("rand2"));
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("ally") } } as never));
  assert.ok(pending(engine), "still waiting for a real answer");
  assert.equal(zoneOf(engine, id("rand")), "play");
  assert.equal(zoneOf(engine, id("rand2")), "play");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("rand") } } as never);
  assert.equal(zoneOf(engine, id("rand2")), "discard", "control: a real answer is accepted");
});

clause(RANDOLPH, "0:unique", "a Randolph in hand is no conflict while another is in play (the restriction is on cards in play)", () => {
  const { engine, id } = randolphBoard({ zone: "play", extra: [{ key: "rand2", def: printing(RANDOLPH), owner: P1, zone: "hand" }] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("rand")), "play");
  assert.equal(zoneOf(engine, id("rand2")), "hand");
});

clause(RANDOLPH, "0:unique", "the restriction is per player: the opponent may control their own Randolph, with no choice and no destruction", () => {
  const { engine, id } = randolphBoard({
    zone: "play",
    active: P2,
    extra: [{ key: "theirs", def: printing(RANDOLPH), owner: P2, zone: "hand" }, ...resources("p2g", 6, P2, "greed")]
  });
  play(engine, P2, id("theirs"));
  assert.equal(engine.state.pendingChoice, undefined, "no 'keep one' choice");
  assert.equal(zoneOf(engine, id("rand")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(RANDOLPH, "0:unique", "taking control of the opponent's Randolph while you have your own is a duplicate: you must keep one", () => {
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
  const { engine, id } = randolphBoard({
    zone: "play",
    extra: [
      { key: "theirs", def: printing(RANDOLPH), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("theirs")] } });
  assert.equal(pending(engine)?.kind, "uniqueSurvivor", "two Randolphs under one player's control");
  assert.equal(pending(engine)?.playerId, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("theirs") } } as never);
  assert.equal(zoneOf(engine, id("theirs")), "play");
  assert.equal(engine.state.cards[id("theirs")].controllerId, P1, "the stolen Randolph is now yours");
  assert.equal(zoneOf(engine, id("rand")), "discard", "your own copy is the one destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(RANDOLPH, "0:unique", "after the UNIQUE choice forced by taking control of the opponent's Randolph, the tactic finishes and the game carries on", () => {
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
  const { engine, id } = randolphBoard({
    zone: "play",
    extra: [
      { key: "theirs", def: printing(RANDOLPH), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("theirs")] } });
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("rand") } } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.responseWindow, undefined, "the response window closed");
  assert.equal(zoneOf(engine, id("steal")), "discard", "the tactic finished resolving");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the turn can be ended afterwards");
});

clause(RANDOLPH, "0:unique", "a different UNIQUE designation (or none) is not a duplicate", () => {
  const { engine, id } = randolphBoard({
    zone: "play",
    extra: [{ key: "other", def: character({ name: "Other Unique", unique: "someone else" } as Partial<CardDefinition>), owner: P1, zone: "play" }]
  });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("rand")), "play");
  assert.equal(zoneOf(engine, id("other")), "play");
});

// --- When this card enters play, draw a card -----------------------------------

clause(RANDOLPH, "1:rule", "pays 4; nothing is drawn while it is only being deployed; once in play you draw exactly one card, the top one", () => {
  const { engine, id } = randolphBoard({ greed: 4 });
  const topTwo = deck(engine, P1).slice(0, 2);
  const deckBefore = deck(engine, P1).length;
  const handBefore = hand(engine, P1).length;
  const resourcesBefore = ready(engine);
  playRaw(engine, P1, id("rand"));
  assert.equal(resourcesBefore - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(hand(engine, P1).length, handBefore - 1, "Randolph left the hand; nothing drawn yet");
  assert.equal(deck(engine, P1).length, deckBefore);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("rand")), "play");
  assert.equal(hand(engine, P1).length, handBefore, "one card left the hand and one was drawn");
  assert.equal(deck(engine, P1).length, deckBefore - 1, "exactly one card left the deck");
  assert.equal(zoneOf(engine, topTwo[0]), "hand", "the top card is the one drawn");
  assert.equal(zoneOf(engine, topTwo[1]), "deck", "...and only that one");
});

clause(RANDOLPH, "1:rule", "only you draw: the opponent's hand and deck are untouched", () => {
  const { engine, id } = randolphBoard({ greed: 4 });
  const theirHand = hand(engine, P2).length;
  const theirDeck = deck(engine, P2).length;
  play(engine, P1, id("rand"));
  assert.equal(hand(engine, P2).length, theirHand);
  assert.equal(deck(engine, P2).length, theirDeck);
});

clause(RANDOLPH, "1:rule", "'draw a card' is the controller's: a Randolph deployed by the second player draws for the second player", () => {
  const { engine, id } = randolphBoard({ owner: P2, active: P2, greed: 4 });
  const mineDeck = deck(engine, P1).length;
  const theirs = hand(engine, P2).length;
  play(engine, P2, id("rand"));
  assert.equal(hand(engine, P2).length, theirs, "one out, one drawn");
  assert.equal(deck(engine, P1).length, mineDeck, "the other player draws nothing");
});

clause(RANDOLPH, "1:rule", "it fires for ITSELF entering play only: a Randolph already in play does not draw when another card enters, and does not draw by being in play", () => {
  const { engine, id } = randolphBoard({ zone: "play" });
  assert.equal(hand(engine, P1).length, 2, "nothing was drawn by starting on the table");
  const deckBefore = deck(engine, P1).length;
  play(engine, P1, id("ally"));
  assert.equal(zoneOf(engine, id("ally")), "play");
  assert.equal(deck(engine, P1).length, deckBefore, "no draw when a different card enters play");
  assert.equal(hand(engine, P1).length, 1);
});

clause(RANDOLPH, "1:rule", "with an empty deck there is nothing to draw: it still enters play and nobody loses", () => {
  const { engine, id } = randolphBoard({ greed: 4, deckSize: 0 });
  const handBefore = hand(engine, P1).length;
  play(engine, P1, id("rand"));
  assert.equal(zoneOf(engine, id("rand")), "play");
  assert.equal(hand(engine, P1).length, handBefore - 1, "no card to draw");
  assert.equal(engine.state.winner, undefined, "running out of cards does not lose the game (CR 306.2)");
});

clause(RANDOLPH, "1:rule", "with one card left in the deck the draw takes it", () => {
  const { engine, id } = randolphBoard({ greed: 4, deckSize: 1 });
  const only = deck(engine, P1)[0];
  play(engine, P1, id("rand"));
  assert.equal(zoneOf(engine, only), "hand");
  assert.equal(deck(engine, P1).length, 0);
});

for (const keep of ["rand", "rand2"] as const) {
  // E11: corrected per the user's Q53 ruling (2026-10-21): UNIQUE is enforced immediately, before the new copy's enters-play
  // trigger. Keeping the NEW copy lets its draw continue; if the NEW copy is the one destroyed (keeping the old one) it
  // never entered play, so its enters-play draw does NOT happen (the old assertion that it still drew contradicts the ruling).
  clause(RANDOLPH, "1:rule", `a second Randolph draws its card when it enters play only if the UNIQUE choice keeps it (keeping the ${keep === "rand" ? "old one: the destroyed new copy never entered play, no draw" : "new one: its draw continues"})`, () => {
    const { engine, id } = randolphBoard({ zone: "play", greed: 4, extra: [{ key: "rand2", def: printing(RANDOLPH), owner: P1, zone: "hand" }] });
    const handBefore = hand(engine, P1).length;
    const top = deck(engine, P1)[0];
    play(engine, P1, id("rand2"));
    assert.equal(pending(engine)?.kind, "uniqueSurvivor");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    assert.equal(engine.state.pendingChoice, undefined);
    if (keep === "rand2") {
      assert.equal(zoneOf(engine, top), "hand", "the kept new copy's trigger continued after the UNIQUE choice");
      assert.equal(hand(engine, P1).length, handBefore, "net: one card played, one drawn");
    } else {
      assert.equal(zoneOf(engine, top), "deck", "the destroyed new copy never entered play: no draw");
      assert.equal(hand(engine, P1).length, handBefore - 1, "net: one card played, none drawn");
    }
  });
}

clause(RANDOLPH, "1:rule", "'enters play' includes being put into play by an effect: a Randolph raised from the discard pile draws a card too", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [{ id: "raise", type: "activated", targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });
  const { engine, id } = randolphBoard({ extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }, { key: "dead", def: printing(RANDOLPH), owner: P1, zone: "discard" }] });
  const top = deck(engine, P1)[0];
  play(engine, P1, id("raise"), { selected: { t: [id("dead")] } });
  assert.equal(zoneOf(engine, id("dead")), "play");
  assert.equal(zoneOf(engine, top), "hand", "the enters-play draw happened");
});

clause(RANDOLPH, "1:rule", "is refused one resource short of its cost of 4, and without [G][G][G][G] (plenty of other resources)", () => {
  const short = randolphBoard({ greed: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rand")));
  assert.equal(zoneOf(short.engine, short.id("rand")), "hand");
  const noThreshold = randolphBoard({ greed: 3, rage: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rand")), "only three [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("rand")), "hand");
  const exact = randolphBoard({ greed: 4 });
  play(exact.engine, P1, exact.id("rand"));
  assert.equal(zoneOf(exact.engine, exact.id("rand")), "play", "[G][G][G][G] and exactly 4 resources is enough");
  const mixed = randolphBoard({ greed: 4, rage: 2 });
  play(mixed.engine, P1, mixed.id("rand"));
  assert.equal(ready(mixed.engine), 2, "only the 4 is spent");
});

// --- PAYDAY LOAN -------------------------------------------------------------------

clause(RANDOLPH, "2:ability:payday", "discarding a resource: pays 1, the resource card goes from hand to the discard pile as a COST, and the draw follows when it resolves", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 2 });
  const top = deck(engine, P1)[0];
  const resourcesBefore = ready(engine);
  const inPlayBefore = resourcesInPlay(engine, P1).length;
  activateRaw(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(resourcesBefore - ready(engine), 1, "pay 1");
  assert.equal(zoneOf(engine, id("hres0")), "discard", "COST: the resource is discarded when the ability is used");
  assert.equal(discard(engine, P1).includes(id("hres0")), true);
  assert.equal(zoneOf(engine, id("hres1")), "hand", "only the chosen one");
  assert.equal(zoneOf(engine, top), "deck", "the draw is the EFFECT: it has not happened while the opponent may respond");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, top), "hand", "the top card was drawn");
  assert.equal(resourcesInPlay(engine, P1).length, inPlayBefore, "no resource in play was destroyed");
});

clause(RANDOLPH, "2:ability:payday", "discarding: net hand size is unchanged (-1 discarded, +1 drawn) and exactly one card is drawn", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 1 });
  const handBefore = hand(engine, P1).length;
  const deckBefore = deck(engine, P1).length;
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(hand(engine, P1).length, handBefore);
  assert.equal(deck(engine, P1).length, deckBefore - 1);
});

clause(RANDOLPH, "2:ability:payday", "destroying a resource you control (face-up, in play): pays 1, it is destroyed into your discard pile as a COST, nothing is discarded from hand, then you draw", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 1 });
  const top = deck(engine, P1)[0];
  const inPlayBefore = resourcesInPlay(engine, P1).length;
  const handBefore = hand(engine, P1).length;
  activateRaw(engine, P1, id("rand"), "payday", { selected: { r: [id("g5")] } });
  assert.equal(zoneOf(engine, id("g5")), "discard", "COST: the resource is destroyed");
  assert.equal(discard(engine, P1).includes(id("g5")), true);
  assert.equal(resourcesInPlay(engine, P1).length, inPlayBefore - 1, "exactly one resource was destroyed");
  assert.equal(zoneOf(engine, id("hres0")), "hand", "the resource in hand was not discarded");
  assert.equal(hand(engine, P1).length, handBefore, "no card left the hand");
  assert.equal(zoneOf(engine, top), "deck", "the draw waits for the effect");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(hand(engine, P1).length, handBefore + 1);
});

clause(RANDOLPH, "2:ability:payday", "destroying: pays exactly 1 in addition (a 6-resource board ends with 4 unspent resources: 1 paid, 1 destroyed)", () => {
  const { engine, id } = randolphBoard({ zone: "play", greed: 6 });
  activate(engine, P1, id("rand"), "payday", { selected: { r: [id("g5")] } });
  assert.equal(resourcesInPlay(engine, P1).length, 5, "one destroyed");
  assert.equal(ready(engine), 4, "6 resources - 1 destroyed - 1 paid (the payment is not the destroyed resource unless it is)");
});

clause(RANDOLPH, "2:ability:payday", "a face-down card is a resource (CR 411.1) and can be the one destroyed; it goes to the discard pile", () => {
  const { engine, id } = randolphBoard({ zone: "play", faceDown: 1 });
  assert.equal(engine.isResource(id("fd0")), true, "control: a face-down card is a resource");
  const top = deck(engine, P1)[0];
  activate(engine, P1, id("rand"), "payday", { selected: { r: [id("fd0")] } });
  assert.equal(zoneOf(engine, id("fd0")), "discard");
  assert.equal(zoneOf(engine, top), "hand");
});

clause(RANDOLPH, "2:ability:payday", "a resource that was already spent (attached to the faction) is still 'a resource you control' and can be destroyed", () => {
  const { engine, id } = randolphBoard({
    zone: "play",
    greed: 2,
    extra: [{ key: "spent", def: resourceCard({ name: "Spent", trade: "universal", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "play", attachedToKey: "__factionA" }]
  });
  assert.equal(engine.state.cards[id("spent")].attachedTo, engine.state.players[P1].factionId);
  activate(engine, P1, id("rand"), "payday", { selected: { r: [id("spent")] } });
  assert.equal(zoneOf(engine, id("spent")), "discard");
});

clause(RANDOLPH, "2:ability:payday", "destroy: an opponent's resource is not 'a resource you control' (refused, nothing paid), while your own is accepted", () => {
  const { engine, id } = randolphBoard({ zone: "play" });
  const before = ready(engine);
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { r: [id("fr0")] } }));
  assert.equal(zoneOf(engine, id("fr0")), "play", "their resource is untouched");
  assert.equal(ready(engine), before, "nothing was paid");
  activate(engine, P1, id("rand"), "payday", { selected: { r: [id("g0")] } });
  assert.equal(zoneOf(engine, id("g0")), "discard", "control: your own resource is accepted");
});

clause(RANDOLPH, "2:ability:payday", "destroy: only a resource can be destroyed: a character, your faction or another non-resource card is refused", () => {
  const { engine, id } = randolphBoard({
    zone: "play",
    extra: [
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" }
    ]
  });
  const before = ready(engine);
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { r: [id("mate")] } }), "a character");
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { r: [id("thing")] } }), "an item");
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { r: [engine.state.players[P1].factionId!] } }), "the faction");
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { r: [id("rand")] } }), "Randolph himself");
  assert.equal(zoneOf(engine, id("mate")), "play");
  assert.equal(zoneOf(engine, id("thing")), "play");
  assert.equal(zoneOf(engine, id("rand")), "play");
  assert.equal(ready(engine), before, "nothing was paid by the refused attempts");
  activate(engine, P1, id("rand"), "payday", { selected: { r: [id("g0")] } });
  assert.equal(zoneOf(engine, id("g0")), "discard", "control: a resource is accepted");
});

clause(RANDOLPH, "2:ability:payday", "discard: only a RESOURCE card can be discarded: a character or tactic in hand is refused, nothing is paid", () => {
  const { engine, id } = randolphBoard({
    zone: "play",
    handResources: 1,
    extra: [{ key: "htac", def: tactic({ name: "Hand Tactic", cost: 2 }), owner: P1, zone: "hand" }]
  });
  const before = ready(engine);
  const handBefore = hand(engine, P1).length;
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { d: [id("hchar")] } }), "a character card");
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { d: [id("htac")] } }), "a tactic card");
  assert.equal(zoneOf(engine, id("hchar")), "hand");
  assert.equal(zoneOf(engine, id("htac")), "hand");
  assert.equal(ready(engine), before, "nothing was paid");
  assert.equal(hand(engine, P1).length, handBefore);
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(zoneOf(engine, id("hres0")), "discard", "control: a resource card is accepted");
});

clause(RANDOLPH, "2:ability:payday", "discard: the resource must be in YOUR hand; a resource in play cannot be 'discarded' (that is the destroy option)", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 1 });
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { d: [id("g0")] } }), "a resource in play");
  assert.equal(zoneOf(engine, id("g0")), "play");
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { d: [id("fr0")] } }), "the opponent's resource");
  assert.equal(zoneOf(engine, id("fr0")), "play");
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(zoneOf(engine, id("hres0")), "discard", "control: a resource in hand is accepted");
});

clause(RANDOLPH, "2:ability:payday", "one OR the other: exactly one resource goes (discarding does not also destroy; destroying does not also discard)", () => {
  const disc = randolphBoard({ zone: "play", handResources: 2 });
  activate(disc.engine, P1, disc.id("rand"), "payday", { selected: { d: [disc.id("hres0")] } });
  assert.equal(zoneOf(disc.engine, disc.id("hres1")), "hand");
  assert.equal(resourcesInPlay(disc.engine, P1).length, 6, "discard option: nothing in play destroyed");
  const dest = randolphBoard({ zone: "play", handResources: 2 });
  activate(dest.engine, P1, dest.id("rand"), "payday", { selected: { r: [dest.id("g0")] } });
  assert.equal(zoneOf(dest.engine, dest.id("hres0")), "hand");
  assert.equal(zoneOf(dest.engine, dest.id("hres1")), "hand");
  assert.equal(resourcesInPlay(dest.engine, P1).length, 5, "destroy option: exactly one destroyed");
});

clause(RANDOLPH, "2:ability:payday", "with neither a resource to discard nor one chosen to destroy it is refused and nothing is paid", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 1 });
  const before = ready(engine);
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", {}));
  assert.equal(ready(engine), before);
  assert.equal(zoneOf(engine, id("hres0")), "hand");
  assert.equal(engine.state.responseWindow, undefined);
});

clause(RANDOLPH, "2:ability:payday", "without a resource to pay 1 it is refused: nothing is discarded or destroyed", () => {
  const { engine, id } = randolphBoard({ zone: "play", greed: 0, handResources: 1 });
  assert.throws(() => activateRaw(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } }));
  assert.equal(zoneOf(engine, id("hres0")), "hand", "the discard was not performed");
  assert.equal(engine.state.responseWindow, undefined);
});

clause(RANDOLPH, "2:ability:payday", "pays exactly 1 and needs no threshold: a single resource of another kind is enough when discarding", () => {
  const { engine, id } = randolphBoard({ zone: "play", greed: 0, rage: 1, handResources: 1 });
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(zoneOf(engine, id("hres0")), "discard");
  assert.equal(ready(engine), 0, "the single resource was spent");
});

clause(RANDOLPH, "2:ability:payday", "EFFECT draws exactly ONE card (the top), not two", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 1 });
  const [first, second] = deck(engine, P1).slice(0, 2);
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(zoneOf(engine, first), "hand");
  assert.equal(zoneOf(engine, second), "deck");
});

clause(RANDOLPH, "2:ability:payday", "it can be used again and again (it does not deplete Randolph): two uses draw two cards and cost 1 each", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 2 });
  const [first, second, third] = deck(engine, P1).slice(0, 3);
  const before = ready(engine);
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(engine.state.cards[id("rand")].depleted, false, "no deplete cost");
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres1")] } });
  assert.equal(before - ready(engine), 2);
  assert.equal(zoneOf(engine, first), "hand");
  assert.equal(zoneOf(engine, second), "hand");
  assert.equal(zoneOf(engine, third), "deck");
  assert.equal(discard(engine, P1).includes(id("hres0")) && discard(engine, P1).includes(id("hres1")), true);
});

clause(RANDOLPH, "2:ability:payday", "with an empty deck the cost is still paid and nothing is drawn; nobody loses", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 1, deckSize: 0 });
  const handBefore = hand(engine, P1).length;
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(zoneOf(engine, id("hres0")), "discard");
  assert.equal(hand(engine, P1).length, handBefore - 1);
  assert.equal(engine.state.winner, undefined);
});

clause(RANDOLPH, "2:ability:payday", "only Randolph's controller may use it", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 1, extra: [{ key: "p2hres", def: resourceCard({ name: "P2 Staple" }), owner: P2, zone: "hand" }, ...resources("p2g", 3, P2, "greed")] });
  assert.throws(() => activateRaw(engine, P2, id("rand"), "payday", { selected: { d: [id("p2hres")] } }));
  assert.equal(zoneOf(engine, id("p2hres")), "hand");
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(zoneOf(engine, id("hres0")), "discard", "control: its controller can");
});

clause(RANDOLPH, "2:ability:payday", "Randolph does not have to be undepleted or untouched: a depleted Randolph can still use it (no deplete cost)", () => {
  const { engine, id } = randolphBoard({ zone: "play", handResources: 1, extra: [] });
  engine.state.cards[id("rand")].depleted = true;
  activate(engine, P1, id("rand"), "payday", { selected: { d: [id("hres0")] } });
  assert.equal(zoneOf(engine, id("hres0")), "discard");
  assert.equal(engine.state.cards[id("rand")].depleted, true, "still depleted: the ability neither needs nor changes it");
});

// =============================================================================
// Real Estate Auctioneer
// LIQUIDATE -- COST: Pay 2. Discard a card. Deplete this card. -- EFFECT: Draw 2 cards.
// Character (auctioneer), banker, cost 5, threshold [G][G], 3 / 3 / 3.
// =============================================================================

const AUCTIONEER = "07fac91d-0244-4ce4-a97e-64659aa234ad";

function auctioneerBoard(
  opts: { zone?: "hand" | "play"; greed?: number; rage?: number; deckSize?: number; handCards?: number; depleted?: boolean; owner?: Pid; active?: Pid; extra?: CardPlacement[] } = {}
) {
  const owner = opts.owner ?? P1;
  const foe = otherOf(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    cards: [
      { key: "auc", def: printing(AUCTIONEER), owner, zone: opts.zone ?? "play", depleted: opts.depleted },
      ...fillers("h", opts.handCards ?? 2, owner, "hand"),
      ...fillers("d", opts.deckSize ?? 5, owner, "deck"),
      ...fillers("e", 3, foe, "hand"),
      ...fillers("f", 3, foe, "deck"),
      { key: "foeChar", def: character({ name: "Foe Char" }), owner: foe, zone: "play" },
      ...resources("g", opts.greed ?? 6, owner, "greed"),
      ...resources("r", opts.rage ?? 0, owner, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(AUCTIONEER, "0:ability:liquidate", "COST is paid when it is used: 2 resources, the chosen card discarded, the Auctioneer depleted, all before the opponent can respond and before anything is drawn", () => {
  const { engine, id } = auctioneerBoard();
  const [top1, top2] = deck(engine, P1).slice(0, 2);
  const before = ready(engine);
  activateRaw(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0")] } });
  assert.equal(before - ready(engine), 2, "pay 2: exactly two resources");
  assert.equal(zoneOf(engine, id("h0")), "discard", "the card is discarded as a cost");
  assert.equal(discard(engine, P1).includes(id("h0")), true, "into its owner's discard pile");
  assert.equal(engine.state.cards[id("auc")].depleted, true, "deplete this card");
  assert.equal(zoneOf(engine, top1), "deck", "the EFFECT (draw) has not happened while the opponent may respond");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, top1), "hand");
  assert.equal(zoneOf(engine, top2), "hand");
});

clause(AUCTIONEER, "0:ability:liquidate", "EFFECT draws exactly 2 cards (the top two), so the hand ends one card bigger", () => {
  const { engine, id } = auctioneerBoard();
  const [first, second, third] = deck(engine, P1).slice(0, 3);
  const handBefore = hand(engine, P1).length;
  const deckBefore = deck(engine, P1).length;
  activate(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0")] } });
  assert.equal(hand(engine, P1).length, handBefore + 1, "-1 discarded, +2 drawn");
  assert.equal(deck(engine, P1).length, deckBefore - 2);
  assert.equal(zoneOf(engine, first), "hand");
  assert.equal(zoneOf(engine, second), "hand");
  assert.equal(zoneOf(engine, third), "deck", "not a third");
  assert.equal(zoneOf(engine, id("h1")), "hand", "the other hand card stays");
});

clause(AUCTIONEER, "0:ability:liquidate", "'a card': any card in hand can be discarded, whatever its type (character, tactic, item, resource)", () => {
  const types: Array<[string, CardDefinition]> = [
    ["character", character({ name: "HC" })],
    ["tactic", tactic({ name: "HT", cost: 2 })],
    ["item", item({ name: "HI" })],
    ["resource", resourceCard({ name: "HR" })]
  ];
  for (const [label, def] of types) {
    const { engine, id } = auctioneerBoard({ extra: [{ key: "odd", def, owner: P1, zone: "hand" }] });
    activate(engine, P1, id("auc"), "liquidate", { selected: { d: [id("odd")] } });
    assert.equal(zoneOf(engine, id("odd")), "discard", `a ${label} card`);
  }
});

clause(AUCTIONEER, "0:ability:liquidate", "the discard must be a card in your hand: a card in play, in the discard pile, in the deck or in the opponent's hand is refused, nothing is paid", () => {
  const { engine, id } = auctioneerBoard({
    extra: [
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "old", def: character({ name: "Old" }), owner: P1, zone: "discard" }
    ]
  });
  const before = ready(engine);
  const attempt = (cardId: string) => () => activateRaw(engine, P1, id("auc"), "liquidate", { selected: { d: [cardId] } });
  assert.throws(attempt(id("ally")), "a card in play");
  assert.throws(attempt(id("old")), "a card in the discard pile");
  assert.throws(attempt(id("d0")), "a card in the deck");
  assert.throws(attempt(id("e0")), "the opponent's hand");
  assert.throws(attempt(id("auc")), "the Auctioneer itself");
  assert.equal(ready(engine), before, "nothing was paid by the refused attempts");
  assert.equal(engine.state.cards[id("auc")].depleted, false, "and nothing was depleted");
  assert.equal(zoneOf(engine, id("e0")), "hand");
  attempt(id("h1"))();
  assert.equal(zoneOf(engine, id("h1")), "discard", "control: a card in your hand is accepted");
});

clause(AUCTIONEER, "0:ability:liquidate", "exactly one card is discarded: none or two is refused", () => {
  const { engine, id } = auctioneerBoard();
  assert.throws(() => activateRaw(engine, P1, id("auc"), "liquidate", { selected: { d: [] } }), "no card");
  assert.throws(() => activateRaw(engine, P1, id("auc"), "liquidate", {}), "no selection at all");
  assert.throws(() => activateRaw(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0"), id("h1")] } }), "two cards");
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(zoneOf(engine, id("h1")), "hand");
  assert.equal(engine.state.cards[id("auc")].depleted, false);
});

clause(AUCTIONEER, "0:ability:liquidate", "with an empty hand there is no card to discard, so it cannot be used", () => {
  const { engine, id } = auctioneerBoard({ handCards: 0 });
  const before = ready(engine);
  assert.throws(() => activateRaw(engine, P1, id("auc"), "liquidate", { selected: { d: [] } }));
  assert.equal(ready(engine), before);
  assert.equal(engine.state.cards[id("auc")].depleted, false);
  assert.equal(
    engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("auc") && a.ability.id === "liquidate"),
    false,
    "it is not offered as a legal activation"
  );
});

clause(AUCTIONEER, "0:ability:liquidate", "is offered as a legal activation when everything can be paid (2 resources, a card, undepleted)", () => {
  const { engine, id } = auctioneerBoard();
  assert.equal(engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("auc") && a.ability.id === "liquidate"), true);
});

clause(AUCTIONEER, "0:ability:liquidate", "is refused one resource short of the pay-2 cost: nothing is discarded or depleted", () => {
  const { engine, id } = auctioneerBoard({ greed: 1 });
  assert.throws(() => activateRaw(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0")] } }));
  assert.equal(zoneOf(engine, id("h0")), "hand", "the card was not discarded");
  assert.equal(engine.state.cards[id("auc")].depleted, false, "not depleted");
  assert.equal(ready(engine), 1, "the resource was not spent");
  assert.equal(engine.state.responseWindow, undefined);
  const exact = auctioneerBoard({ greed: 2 });
  activate(exact.engine, P1, exact.id("auc"), "liquidate", { selected: { d: [exact.id("h0")] } });
  assert.equal(exact.engine.state.cards[exact.id("auc")].depleted, true, "exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(AUCTIONEER, "0:ability:liquidate", "needs no resource icons: two resources of any kind pay for it", () => {
  const { engine, id } = auctioneerBoard({ greed: 0, rage: 2 });
  activate(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0")] } });
  assert.equal(engine.state.cards[id("auc")].depleted, true);
  assert.equal(ready(engine), 0);
});

clause(AUCTIONEER, "0:ability:liquidate", "a depleted Auctioneer cannot pay the deplete cost: refused, nothing discarded or paid", () => {
  const { engine, id } = auctioneerBoard({ depleted: true });
  const before = ready(engine);
  assert.throws(() => activateRaw(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0")] } }));
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(ready(engine), before);
  assert.equal(
    engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("auc") && a.ability.id === "liquidate"),
    false
  );
});

clause(AUCTIONEER, "0:ability:liquidate", "once per restore: after using it the Auctioneer is depleted so it can't be used again; next turn it is restored and can", () => {
  const { engine, id } = auctioneerBoard({ handCards: 3 });
  activate(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0")] } });
  assert.throws(() => activateRaw(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h1")] } }), "already depleted");
  assert.equal(zoneOf(engine, id("h1")), "hand");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("auc")].depleted, false, "restored at the start of the turn");
  activate(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h1")] } });
  assert.equal(zoneOf(engine, id("h1")), "discard", "usable again");
});

clause(AUCTIONEER, "0:ability:liquidate", "only its controller may use it", () => {
  const { engine, id } = auctioneerBoard({ extra: resources("p2g", 4, P2, "greed") });
  assert.throws(() => activateRaw(engine, P2, id("auc"), "liquidate", { selected: { d: [id("e0")] } }));
  assert.equal(zoneOf(engine, id("e0")), "hand");
  assert.equal(engine.state.cards[id("auc")].depleted, false);
});

clause(AUCTIONEER, "0:ability:liquidate", "the controller draws, and the opponent's hand and deck are untouched", () => {
  const { engine, id } = auctioneerBoard();
  const theirHand = hand(engine, P2).length;
  const theirDeck = deck(engine, P2).length;
  activate(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0")] } });
  assert.equal(hand(engine, P2).length, theirHand);
  assert.equal(deck(engine, P2).length, theirDeck);
});

clause(AUCTIONEER, "0:ability:liquidate", "with fewer than 2 cards in the deck you draw what is there and do not lose", () => {
  const one = auctioneerBoard({ deckSize: 1 });
  const only = deck(one.engine, P1)[0];
  const handBefore = hand(one.engine, P1).length;
  activate(one.engine, P1, one.id("auc"), "liquidate", { selected: { d: [one.id("h0")] } });
  assert.equal(zoneOf(one.engine, only), "hand");
  assert.equal(hand(one.engine, P1).length, handBefore, "-1 discarded, +1 drawn");
  assert.equal(one.engine.state.winner, undefined);
  const none = auctioneerBoard({ deckSize: 0 });
  activate(none.engine, P1, none.id("auc"), "liquidate", { selected: { d: [none.id("h0")] } });
  assert.equal(hand(none.engine, P1).length, 1, "nothing to draw");
  assert.equal(none.engine.state.winner, undefined);
});

clause(AUCTIONEER, "0:ability:liquidate", "it can be used the turn the Auctioneer enters play (abilities have no summoning sickness, CR 204.3a)", () => {
  const { engine, id } = auctioneerBoard({ zone: "hand", greed: 7 });
  play(engine, P1, id("auc"));
  assert.equal(zoneOf(engine, id("auc")), "play");
  const handBefore = hand(engine, P1).length;
  activate(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0")] } });
  assert.equal(engine.state.cards[id("auc")].depleted, true);
  assert.equal(hand(engine, P1).length, handBefore + 1);
});

clause(AUCTIONEER, "0:ability:liquidate", "the effect uses the text as paid even if the Auctioneer is destroyed in response: the 2 cards are still drawn", () => {
  const { engine, id } = auctioneerBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  const [first, second] = deck(engine, P1).slice(0, 2);
  activateRaw(engine, P1, id("auc"), "liquidate", { selected: { d: [id("h0")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(engine, P2, id("kill"), { selected: { t: [id("auc")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("auc")), "discard", "the Auctioneer was destroyed in response");
  assert.equal(zoneOf(engine, first), "hand", "CR 502.4: the ability still resolves");
  assert.equal(zoneOf(engine, second), "hand");
});

// =============================================================================
// Reluctant Hiree
// This card enters play with 3 tokens on it.
// This card loses 1 strength for each token on it.
// INVEST -- COST: Pay X, where X is the number of tokens on this card.
//        -- EFFECT: Remove a token from this card.
// Character (employee), banker, cost 3, threshold [G][G], 4 / 3 / 4.
// =============================================================================

const HIREE = "3c2c57b8-43a8-46ef-9f6d-0e105783d92d";

function hireeBoard(opts: { zone?: "hand" | "play"; tokens?: number; greed?: number; rage?: number; owner?: Pid; active?: Pid; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    cards: [
      { key: "hiree", def: printing(HIREE), owner, zone: opts.zone ?? "play", counters: opts.tokens ? { token: opts.tokens } : undefined },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: otherOf(owner), zone: "play" },
      ...resources("g", opts.greed ?? 8, owner, "greed"),
      ...resources("r", opts.rage ?? 0, owner, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(HIREE, "0:rule", "deploying pays 3 and puts the Hiree into play with exactly 3 tokens on it", () => {
  const { engine, id } = hireeBoard({ zone: "hand" });
  const before = ready(engine);
  playRaw(engine, P1, id("hiree"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("hiree")), "play");
  assert.equal(tokensOn(engine, id("hiree")), 3, "enters play with 3 tokens");
});

clause(HIREE, "0:rule", "it comes in already weakened: 3 tokens leave it with 1 strength (printed 4), life 4 and speed 3 unchanged", () => {
  const { engine, id } = hireeBoard({ zone: "hand" });
  play(engine, P1, id("hiree"));
  assert.deepEqual(stats(engine, id("hiree")), [1, 4, 3]);
});

clause(HIREE, "0:rule", "the tokens are on THIS card only: no other card gets tokens, and the opponent's cards are untouched", () => {
  const { engine, id } = hireeBoard({ zone: "hand", extra: [{ key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" }] });
  play(engine, P1, id("hiree"));
  assert.equal(tokensOn(engine, id("mate")), 0);
  assert.equal(tokensOn(engine, id("foe")), 0);
  assert.equal(tokensOn(engine, engine.state.players[P1].factionId!), 0);
});

clause(HIREE, "0:rule", "every Hiree gets its own 3 tokens: a second Hiree entering play has 3, the first keeps the tokens it has", () => {
  const { engine, id } = hireeBoard({ zone: "hand", extra: [{ key: "hiree2", def: printing(HIREE), owner: P1, zone: "hand" }] });
  play(engine, P1, id("hiree"));
  engine.state.cards[id("hiree")].counters.token = 2; // pretend one was already removed
  play(engine, P1, id("hiree2"));
  assert.equal(tokensOn(engine, id("hiree2")), 3);
  assert.equal(tokensOn(engine, id("hiree")), 2, "an existing Hiree gets nothing when another enters");
});

clause(HIREE, "0:rule", "it only enters play with tokens: a Hiree that starts on the table, or when another card enters play, has none from the rule", () => {
  const { engine, id } = hireeBoard({ zone: "play", extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  assert.equal(tokensOn(engine, id("hiree")), 0);
  play(engine, P1, id("newbie"));
  assert.equal(tokensOn(engine, id("hiree")), 0, "another card entering play adds no tokens to it");
  assert.equal(tokensOn(engine, id("newbie")), 0);
});

clause(HIREE, "0:rule", "put into play by an effect (not deployed) it also enters with 3 tokens", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hiree", def: printing(HIREE), owner: P1, zone: "discard" },
      { key: "raise", def: raise, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("raise"), { selected: { t: [id("hiree")] } });
  assert.equal(zoneOf(engine, id("hiree")), "play");
  assert.equal(tokensOn(engine, id("hiree")), 3);
  assert.equal(engine.getStat(id("hiree"), "strength"), 1);
});

clause(HIREE, "0:rule", "a Hiree that left play and is deployed again enters with 3 tokens, not with its old tokens plus 3 (CR 409.2)", () => {
  const { engine, id } = hireeBoard({ zone: "hand", extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("hiree"));
  assert.equal(tokensOn(engine, id("hiree")), 3);
  play(engine, P1, id("bounce"), { selected: { t: [id("hiree")] } });
  assert.equal(zoneOf(engine, id("hiree")), "hand");
  assert.equal(tokensOn(engine, id("hiree")), 0, "its tokens disappeared when it left play");
  play(engine, P1, id("hiree"));
  assert.equal(zoneOf(engine, id("hiree")), "play");
  assert.equal(tokensOn(engine, id("hiree")), 3, "a fresh stint in play starts with exactly 3");
  assert.equal(engine.getStat(id("hiree"), "strength"), 1);
});

clause(HIREE, "0:rule", "is refused one resource short of its cost of 3, and without [G][G]", () => {
  const short = hireeBoard({ zone: "hand", greed: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("hiree")));
  assert.equal(zoneOf(short.engine, short.id("hiree")), "hand");
  const noThreshold = hireeBoard({ zone: "hand", greed: 1, rage: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("hiree")), "only one [G]");
  const exact = hireeBoard({ zone: "hand", greed: 3 });
  play(exact.engine, P1, exact.id("hiree"));
  assert.equal(zoneOf(exact.engine, exact.id("hiree")), "play", "[G][G] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(HIREE, "1:rule", "with no tokens it has its printed 4 strength; each token takes away 1 (1 token: 3, 2: 2, 3: 1, 4: 0); life 4 and speed 3 never change", () => {
  for (const [tokens, strength] of [
    [0, 4],
    [1, 3],
    [2, 2],
    [3, 1],
    [4, 0]
  ] as const) {
    const { engine, id } = hireeBoard({ tokens });
    assert.deepEqual(stats(engine, id("hiree")), [strength, 4, 3], `${tokens} token(s)`);
  }
});

clause(HIREE, "1:rule", "strength stops at 0 (CR 410.4): with 6 tokens its strength is 0, not -2", () => {
  const { engine, id } = hireeBoard({ tokens: 6 });
  assert.equal(engine.getStat(id("hiree"), "strength"), 0);
});

clause(HIREE, "1:rule", "only its OWN tokens count: tokens on another card don't weaken it", () => {
  const { engine, id } = hireeBoard({ tokens: 1, extra: [{ key: "mate", def: character({ name: "Mate", strength: 4, life: 4 }), owner: P1, zone: "play", counters: { token: 3 } }] });
  assert.equal(engine.getStat(id("hiree"), "strength"), 3, "1 token of its own");
  assert.equal(engine.getStat(id("mate"), "strength"), 4, "a different card is not weakened by its tokens");
});

clause(HIREE, "1:rule", "it applies to an opponent-controlled Hiree the same way (read from the card's own tokens)", () => {
  const { engine, id } = hireeBoard({ owner: P2, active: P2, tokens: 2 });
  assert.deepEqual(stats(engine, id("hiree")), [2, 4, 3]);
});

clause(HIREE, "1:rule", "the weakness is real in battle: with 3 tokens it deals only 1 damage to the faction", () => {
  const { engine, id } = hireeBoard({ tokens: 3 });
  const before = influence(engine, P2);
  fight(engine, P1, [id("hiree")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(engine, P2), before - 1);
});

clause(HIREE, "1:rule", "and with no tokens it deals its full 4", () => {
  const { engine, id } = hireeBoard({ tokens: 0 });
  const before = influence(engine, P2);
  fight(engine, P1, [id("hiree")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(engine, P2), before - 4);
});

clause(HIREE, "2:ability:invest", "pays X = the number of tokens (3) as a COST when used; the token itself is only removed when it resolves", () => {
  const { engine, id } = hireeBoard({ tokens: 3 });
  const before = ready(engine);
  activateRaw(engine, P1, id("hiree"), "invest");
  assert.equal(before - ready(engine), 3, "pay X = 3");
  assert.equal(tokensOn(engine, id("hiree")), 3, "the EFFECT (remove a token) waits for the opponent's responses");
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("hiree")), 2, "EFFECT: remove a token");
  assert.equal(engine.getStat(id("hiree"), "strength"), 2, "one token less: one strength more");
});

clause(HIREE, "2:ability:invest", "X follows the tokens: with 2 tokens it costs 2, with 1 token it costs 1, each removing exactly one token", () => {
  for (const [tokens, cost] of [
    [2, 2],
    [1, 1]
  ] as const) {
    const { engine, id } = hireeBoard({ tokens });
    const before = ready(engine);
    activate(engine, P1, id("hiree"), "invest");
    assert.equal(before - ready(engine), cost, `X = ${tokens}`);
    assert.equal(tokensOn(engine, id("hiree")), tokens - 1);
  }
});

clause(HIREE, "2:ability:invest", "with 4 tokens X is 4, with 5 tokens it is 5", () => {
  for (const tokens of [4, 5]) {
    const { engine, id } = hireeBoard({ tokens, greed: 8 });
    const before = ready(engine);
    activate(engine, P1, id("hiree"), "invest");
    assert.equal(before - ready(engine), tokens, `X = ${tokens}`);
    assert.equal(tokensOn(engine, id("hiree")), tokens - 1);
  }
});

clause(HIREE, "2:ability:invest", "is refused one resource short of X (2 resources for 3 tokens): no payment, no token removed", () => {
  const { engine, id } = hireeBoard({ tokens: 3, greed: 2 });
  assert.throws(() => activateRaw(engine, P1, id("hiree"), "invest"));
  assert.equal(tokensOn(engine, id("hiree")), 3);
  assert.equal(ready(engine), 2, "nothing was paid");
  assert.equal(engine.state.responseWindow, undefined);
  const exact = hireeBoard({ tokens: 3, greed: 3 });
  activate(exact.engine, P1, exact.id("hiree"), "invest");
  assert.equal(tokensOn(exact.engine, exact.id("hiree")), 2, "exactly X resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(HIREE, "2:ability:invest", "needs no threshold: resources of any kind pay for it", () => {
  const { engine, id } = hireeBoard({ tokens: 3, greed: 0, rage: 3 });
  activate(engine, P1, id("hiree"), "invest");
  assert.equal(tokensOn(engine, id("hiree")), 2);
  assert.equal(ready(engine), 0);
});

clause(HIREE, "2:ability:invest", "can be used repeatedly (no deplete): from 3 tokens it takes 3 + 2 + 1 = 6 resources to remove them all, ending at full 4 strength", () => {
  const { engine, id } = hireeBoard({ tokens: 3, greed: 6 });
  activate(engine, P1, id("hiree"), "invest");
  activate(engine, P1, id("hiree"), "invest");
  activate(engine, P1, id("hiree"), "invest");
  assert.equal(tokensOn(engine, id("hiree")), 0);
  assert.equal(ready(engine), 0, "3 + 2 + 1 resources");
  assert.deepEqual(stats(engine, id("hiree")), [4, 4, 3]);
  assert.equal(engine.state.cards[id("hiree")].depleted, false, "INVEST never depletes it");
});

clause(HIREE, "2:ability:invest", "with no tokens X is 0 and there is no token to remove: nothing is paid, the token count never goes negative", () => {
  const { engine, id } = hireeBoard({ tokens: 0 });
  const before = ready(engine);
  activate(engine, P1, id("hiree"), "invest");
  assert.equal(tokensOn(engine, id("hiree")), 0);
  assert.equal(ready(engine), before, "X = 0: pay nothing");
  assert.equal(engine.getStat(id("hiree"), "strength"), 4);
});

clause(HIREE, "2:ability:invest", "removes a token from THIS card only: another Hiree keeps its tokens", () => {
  const { engine, id } = hireeBoard({ tokens: 3, extra: [{ key: "hiree2", def: printing(HIREE), owner: P1, zone: "play", counters: { token: 3 } }] });
  activate(engine, P1, id("hiree"), "invest");
  assert.equal(tokensOn(engine, id("hiree")), 2);
  assert.equal(tokensOn(engine, id("hiree2")), 3);
});

clause(HIREE, "2:ability:invest", "only its controller may use it", () => {
  const { engine, id } = hireeBoard({ tokens: 3, extra: resources("p2g", 4, P2, "greed") });
  assert.throws(() => activateRaw(engine, P2, id("hiree"), "invest"));
  assert.equal(tokensOn(engine, id("hiree")), 3);
  assert.equal(ready(engine, P2), 4);
  activate(engine, P1, id("hiree"), "invest");
  assert.equal(tokensOn(engine, id("hiree")), 2, "control: the controller can");
});

clause(HIREE, "2:ability:invest", "X is settled when the cost is paid: a token added in response doesn't change the 3 paid, and the effect still removes just ONE token", () => {
  const addToken = tactic({
    name: "Add Token",
    cost: 0,
    behavior: { abilities: [{ id: "add", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }] }] }
  });
  const { engine, id } = hireeBoard({ tokens: 3, extra: [{ key: "adder", def: addToken, owner: P2, zone: "hand" }, ...resources("p2g", 2, P2, "greed")] });
  const before = ready(engine);
  activateRaw(engine, P1, id("hiree"), "invest");
  assert.equal(before - ready(engine), 3, "X = 3 at the time of payment");
  playRaw(engine, P2, id("adder"), { selected: { t: [id("hiree")] } });
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine), 3, "no further payment is asked for the new token");
  assert.equal(tokensOn(engine, id("hiree")), 3, "3 + 1 added - 1 removed");
});

clause(HIREE, "2:ability:invest", "it can be used the turn the Hiree enters play (abilities have no summoning sickness)", () => {
  const { engine, id } = hireeBoard({ zone: "hand", greed: 6 });
  play(engine, P1, id("hiree"));
  assert.equal(tokensOn(engine, id("hiree")), 3);
  activate(engine, P1, id("hiree"), "invest");
  assert.equal(tokensOn(engine, id("hiree")), 2);
  assert.equal(ready(engine), 0, "3 to deploy + 3 for INVEST");
});

// =============================================================================
// Revivatate
// COST: Play this only during your turn. Pick 2 characters in your discard pile.
// EFFECT: Put 1 of the characters into play under your control and 1 into your hand.
// Tactic, banker, cost 6, threshold [G][G][G][G][G].
// =============================================================================

const REVIVATATE = "a0e2b30c-c763-4182-9c34-84c3d407d60d";

/** A character with a "when this enters play, draw a card" trigger, so a test can tell "put into play" from "put into hand". */
const DRAW_ON_ENTER = (name: string) =>
  character({
    name,
    cost: 1,
    strength: 2,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });

function revivatateBoard(opts: { greed?: number; rage?: number; active?: Pid; extra?: CardPlacement[]; chars?: CardDefinition[] } = {}) {
  const chars = opts.chars ?? [
    character({ name: "Alpha", strength: 3, life: 3, speed: 2 }),
    character({ name: "Beta", strength: 1, life: 5, speed: 1 }),
    character({ name: "Gamma", strength: 2, life: 2, speed: 3 })
  ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "rev", def: printing(REVIVATATE), owner: P1, zone: "hand" },
      ...chars.map((def, i) => ({ key: `c${i}`, def, owner: P1, zone: "discard" as const })),
      { key: "tac", def: tactic({ name: "Spent Tactic", cost: 1 }), owner: P1, zone: "discard" },
      { key: "oc0", def: character({ name: "Their Dead One" }), owner: P2, zone: "discard" },
      { key: "oc1", def: character({ name: "Their Dead Two" }), owner: P2, zone: "discard" },
      { key: "inplay", def: character({ name: "On Table" }), owner: P1, zone: "play" },
      { key: "inhand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" },
      { key: "indeck", def: character({ name: "In Deck" }), owner: P1, zone: "deck" },
      ...fillers("e", 2, P2, "hand"),
      ...resources("g", opts.greed ?? 8, P1, "greed"),
      ...resources("r", opts.rage ?? 0, P1, "rage"),
      ...resources("p2g", 6, P2, "greed"),
      ...(opts.extra ?? [])
    ]
  });
}

/** Answers the "which one goes into play" prompt with `key`'s card. */
function chooseForPlay(engine: SpoilsEngine, cardId: string) {
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the caster is asked which character goes into play");
  assert.equal(pc.playerId, P1);
  pick(engine, [cardId]);
}

clause(REVIVATATE, "0:ability", "COST: pays 6; the two picked characters are chosen as the tactic is played and stay in the discard pile until it resolves", () => {
  const { engine, id } = revivatateBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  assert.equal(before - ready(engine), 6, "the printed cost of 6 is paid");
  assert.equal(zoneOf(engine, id("c0")), "discard", "nothing has moved while the opponent may respond");
  assert.equal(zoneOf(engine, id("c1")), "discard");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  chooseForPlay(engine, id("c0"));
});

clause(REVIVATATE, "0:ability", "EFFECT: of the two picked characters the one you choose enters play under your control and the other goes to your hand", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  chooseForPlay(engine, id("c1"));
  assert.equal(zoneOf(engine, id("c1")), "play", "the chosen one is in play");
  assert.equal(engine.state.cards[id("c1")].controllerId, P1, "under your control");
  assert.equal(engine.state.players[P1].play.includes(id("c1")), true);
  assert.equal(zoneOf(engine, id("c0")), "hand", "the other one is in your hand");
  assert.equal(hand(engine, P1).includes(id("c0")), true);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(REVIVATATE, "0:ability", "...and it works the other way round: choosing the first pick for play sends the second to hand", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  chooseForPlay(engine, id("c0"));
  assert.equal(zoneOf(engine, id("c0")), "play");
  assert.equal(zoneOf(engine, id("c1")), "hand");
});

clause(REVIVATATE, "0:ability", "exactly one goes into play and exactly one into hand: neither is left in the discard pile, and an unpicked character is untouched", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  chooseForPlay(engine, id("c0"));
  assert.equal(zoneOf(engine, id("c2")), "discard", "a character that was not picked stays in the discard pile");
  assert.equal(zoneOf(engine, id("tac")), "discard");
  assert.equal(zoneOf(engine, id("oc0")), "discard", "the opponent's discard pile is untouched");
  assert.equal(zoneOf(engine, id("oc1")), "discard");
  const playCount = engine.state.players[P1].play.filter((c) => ["c0", "c1", "c2"].some((k) => id(k) === c)).length;
  assert.equal(playCount, 1, "only one of the characters entered play");
  assert.equal(hand(engine, P1).filter((c) => ["c0", "c1", "c2"].some((k) => id(k) === c)).length, 1, "only one came to the hand");
});

clause(REVIVATATE, "0:ability", "the caster (not the opponent) chooses which one goes into play, and the choice must be one of the two picked", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  const pc = pending(engine);
  assert.equal(pc?.playerId, P1, "the caster chooses");
  assert.throws(() => pick(engine, [id("c2")]), "an unpicked character in the discard pile cannot be the one");
  assert.throws(() => pick(engine, [id("oc0")]), "nor can the opponent's card");
  assert.throws(() => pick(engine, [id("inhand")]), "nor a card from elsewhere");
  assert.ok(pending(engine), "the prompt is still open");
  assert.equal(zoneOf(engine, id("c2")), "discard");
  pick(engine, [id("c0")]);
  assert.equal(zoneOf(engine, id("c0")), "play", "control: a picked character is accepted");
});

clause(REVIVATATE, "0:ability", "exactly one character is put into play: choosing both or none is refused (the other must go to the hand)", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  assert.throws(() => pick(engine, [id("c0"), id("c1")]), "both into play");
  assert.throws(() => pick(engine, []), "neither into play");
  assert.equal(zoneOf(engine, id("c0")), "discard");
  assert.equal(zoneOf(engine, id("c1")), "discard");
  pick(engine, [id("c1")]);
  assert.equal(zoneOf(engine, id("c1")), "play");
  assert.equal(zoneOf(engine, id("c0")), "hand");
});

clause(REVIVATATE, "0:ability", "the tactic itself is spent: it ends up in the caster's discard pile", () => {
  const { engine, id } = revivatateBoard();
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  chooseForPlay(engine, id("c0"));
  assert.equal(zoneOf(engine, id("rev")), "discard");
  assert.equal(discard(engine, P1).includes(id("rev")), true);
});

clause(REVIVATATE, "0:ability", "the character put into play really enters play (its 'when this enters play' trigger fires); the one put into hand does not trigger", () => {
  const chars = [DRAW_ON_ENTER("Drawer A"), DRAW_ON_ENTER("Drawer B")];
  for (const [chosen, other] of [
    ["c0", "c1"],
    ["c1", "c0"]
  ] as const) {
    const { engine, id } = revivatateBoard({ chars });
    const handBefore = hand(engine, P1).length;
    const deckBefore = deck(engine, P1).length;
    play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
    chooseForPlay(engine, id(chosen));
    drain(engine, declineAll);
    assert.equal(zoneOf(engine, id(chosen)), "play");
    assert.equal(zoneOf(engine, id(other)), "hand");
    assert.equal(deck(engine, P1).length, deckBefore - 1, "exactly one enters-play trigger fired: one card drawn");
    assert.equal(hand(engine, P1).length, handBefore - 1 + 1 + 1, "-Revivatate, +the card put into hand, +the drawn card");
  }
});

clause(REVIVATATE, "0:ability", "a Prudent Thug put into play by it costs the faction 3 influence; one put into hand costs nothing", () => {
  const thug = printing(THUG);
  const plain = character({ name: "Plain" });
  const intoPlay = revivatateBoard({ chars: [thug, plain] });
  const inf = influence(intoPlay.engine, P1);
  play(intoPlay.engine, P1, intoPlay.id("rev"), { selected: { picks: [intoPlay.id("c0"), intoPlay.id("c1")] } });
  chooseForPlay(intoPlay.engine, intoPlay.id("c0"));
  assert.equal(zoneOf(intoPlay.engine, intoPlay.id("c0")), "play");
  assert.equal(influence(intoPlay.engine, P1), inf - 3, "the Thug entered play");
  const intoHand = revivatateBoard({ chars: [thug, plain] });
  play(intoHand.engine, P1, intoHand.id("rev"), { selected: { picks: [intoHand.id("c0"), intoHand.id("c1")] } });
  chooseForPlay(intoHand.engine, intoHand.id("c1"));
  assert.equal(zoneOf(intoHand.engine, intoHand.id("c0")), "hand");
  assert.equal(influence(intoHand.engine, P1), inf, "a Thug put into hand never entered play");
});

clause(REVIVATATE, "0:ability", "only characters can be picked: a tactic in the discard pile (or a card not in the discard pile) is refused, nothing is paid", () => {
  const { engine, id } = revivatateBoard();
  const before = ready(engine);
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("tac")] } }), "a tactic card");
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("inplay")] } }), "a character in play");
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("inhand")] } }), "a character in hand");
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("indeck")] } }), "a character in the deck");
  assert.equal(ready(engine), before, "nothing was paid by the refused attempts");
  assert.equal(zoneOf(engine, id("rev")), "hand");
  playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c2")] } });
  assert.ok(engine.state.responseWindow, "control: two characters in your discard pile are accepted");
});

clause(REVIVATATE, "0:ability", "your discard pile only: the opponent's discarded characters can't be picked", () => {
  const { engine, id } = revivatateBoard();
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("oc0"), id("oc1")] } }), "both from their pile");
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("oc0")] } }), "one from their pile");
  assert.equal(zoneOf(engine, id("rev")), "hand");
  playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  assert.ok(engine.state.responseWindow, "control: two of your own are accepted");
});

clause(REVIVATATE, "0:ability", "exactly 2 are picked: one, none, three or the same character twice is refused", () => {
  const { engine, id } = revivatateBoard();
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0")] } }), "only one");
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [] } }), "none");
  assert.throws(() => playRaw(engine, P1, id("rev"), {}), "no selection");
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1"), id("c2")] } }), "three");
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c0")] } }), "the same card twice");
  assert.equal(zoneOf(engine, id("rev")), "hand");
  assert.equal(zoneOf(engine, id("c0")), "discard");
});

clause(REVIVATATE, "0:ability", "with only one character in your discard pile it can't be played (there aren't 2 to pick)", () => {
  const { engine, id } = revivatateBoard({ chars: [character({ name: "Lonely" })] });
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0")] } }));
  assert.throws(() => playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("tac")] } }));
  assert.throws(() => playRaw(engine, P1, id("rev"), {}));
  assert.equal(zoneOf(engine, id("rev")), "hand");
  assert.equal(zoneOf(engine, id("c0")), "discard");
});

clause(REVIVATATE, "0:ability", "with exactly 2 characters in your discard pile it can be played and both are used (control for the check above)", () => {
  const { engine, id } = revivatateBoard({ chars: [character({ name: "One" }), character({ name: "Two" })] });
  play(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  chooseForPlay(engine, id("c1"));
  assert.equal(zoneOf(engine, id("c1")), "play");
  assert.equal(zoneOf(engine, id("c0")), "hand");
});

clause(REVIVATATE, "0:ability", "'play this only during your turn': refused in response on the opponent's turn, accepted on yours", () => {
  const react = revivatateBoard({
    active: P2,
    extra: [{ key: "p2tac", def: tactic({ name: "P2 Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" }]
  });
  playRaw(react.engine, P2, react.id("p2tac"));
  assert.equal(react.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  const before = ready(react.engine);
  assert.throws(() => playRaw(react.engine, P1, react.id("rev"), { selected: { picks: [react.id("c0"), react.id("c1")] } }), "not my turn");
  assert.equal(zoneOf(react.engine, react.id("rev")), "hand");
  assert.equal(zoneOf(react.engine, react.id("c0")), "discard");
  assert.equal(ready(react.engine), before, "nothing was paid");
  const mine = revivatateBoard();
  playRaw(mine.engine, P1, mine.id("rev"), { selected: { picks: [mine.id("c0"), mine.id("c1")] } });
  assert.ok(mine.engine.state.responseWindow, "control: on my own turn it is played");
});

clause(REVIVATATE, "0:ability", "during my own turn it can also be played in response (to an ability the opponent used against my action)", () => {
  const { engine, id } = revivatateBoard({
    extra: [{ key: "foeGuy", def: abilityGuy("Foe Guy"), owner: P2, zone: "play" }]
  });
  playRaw(engine, P1, id("inhand"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  activateRaw(engine, P2, id("foeGuy"), "peek");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  assert.equal(zoneOf(engine, id("rev")), "deploying", "accepted: it is my turn");
});

clause(REVIVATATE, "0:ability", "its cost is 6 and it needs [G][G][G][G][G]: one resource short, or only four [G], is refused; exactly enough works", () => {
  const short = revivatateBoard({ greed: 5 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rev"), { selected: { picks: [short.id("c0"), short.id("c1")] } }));
  assert.equal(zoneOf(short.engine, short.id("rev")), "hand");
  const noThreshold = revivatateBoard({ greed: 4, rage: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rev"), { selected: { picks: [noThreshold.id("c0"), noThreshold.id("c1")] } }), "four [G] only");
  const exact = revivatateBoard({ greed: 6 });
  playRaw(exact.engine, P1, exact.id("rev"), { selected: { picks: [exact.id("c0"), exact.id("c1")] } });
  assert.equal(ready(exact.engine), 0);
  const mixed = revivatateBoard({ greed: 5, rage: 1 });
  playRaw(mixed.engine, P1, mixed.id("rev"), { selected: { picks: [mixed.id("c0"), mixed.id("c1")] } });
  assert.equal(ready(mixed.engine), 0, "[G]x5 plus one other resource pays 6");
});

clause(REVIVATATE, "0:ability", "if a picked character is removed from the discard pile in response, the game is not left stuck and the missing card does not come back", () => {
  const exile = tactic({
    name: "Exile One",
    cost: 0,
    behavior: {
      abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }]
    }
  });
  const { engine, id } = revivatateBoard({ extra: [{ key: "exile", def: exile, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("rev"), { selected: { picks: [id("c0"), id("c1")] } });
  playRaw(engine, P2, id("exile"), { selected: { t: [id("c0")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c0")), "removed", "control: the response removed c0 from the game");
  driveWith(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("c1")] } : undefined));
  assert.equal(engine.state.pendingChoice, undefined, "the game is not stuck");
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(zoneOf(engine, id("c0")), "removed", "CR 402.4: an effect loses track of a card that changed areas");
  assert.notEqual(zoneOf(engine, id("c1")), "discard", "the surviving pick is not left behind");
});

// =============================================================================
// Short Term Investment
// This card comes into play with 2 tokens on it.
// At the start of your turn, remove a token from this card.
// RETURN -- COST: Use this only if there are no tokens on this card. Destroy this
// card. -- EFFECT: Draw 3 cards.
// Item, banker, cost 2, threshold [G][G].
// =============================================================================

const STI = "00255313-8ec6-4597-8cfb-f92c227061ce";

function stiBoard(opts: { zone?: "hand" | "play"; tokens?: number; greed?: number; rage?: number; deckSize?: number; owner?: Pid; active?: Pid; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  const foe = otherOf(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    cards: [
      { key: "sti", def: printing(STI), owner, zone: opts.zone ?? "play", counters: opts.tokens !== undefined ? { token: opts.tokens } : undefined },
      { key: "mate", def: character({ name: "Mate" }), owner, zone: "play" },
      { key: "foeChar", def: character({ name: "Foe" }), owner: foe, zone: "play" },
      ...fillers("d", opts.deckSize ?? 6, owner, "deck"),
      ...fillers("f", 6, foe, "deck"),
      ...resources("g", opts.greed ?? 6, owner, "greed"),
      ...resources("r", opts.rage ?? 0, owner, "rage"),
      ...resources("p2g", 4, foe, "greed"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(STI, "0:rule", "pays 2 to deploy and comes into play with exactly 2 tokens", () => {
  const { engine, id } = stiBoard({ zone: "hand" });
  const before = ready(engine);
  playRaw(engine, P1, id("sti"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("sti")), "play");
  assert.equal(tokensOn(engine, id("sti")), 2);
});

clause(STI, "0:rule", "the tokens go on THIS card only", () => {
  const { engine, id } = stiBoard({ zone: "hand" });
  play(engine, P1, id("sti"));
  assert.equal(tokensOn(engine, id("mate")), 0);
  assert.equal(tokensOn(engine, id("foeChar")), 0);
});

clause(STI, "0:rule", "each Investment brings its own 2 tokens: a second one enters with 2, the first keeps what it has", () => {
  const { engine, id } = stiBoard({ zone: "hand", extra: [{ key: "sti2", def: printing(STI), owner: P1, zone: "hand" }] });
  play(engine, P1, id("sti"));
  engine.state.cards[id("sti")].counters.token = 1;
  play(engine, P1, id("sti2"));
  assert.equal(tokensOn(engine, id("sti2")), 2);
  assert.equal(tokensOn(engine, id("sti")), 1, "the first is unchanged");
});

clause(STI, "0:rule", "it only comes into play with tokens: one that begins on the table has none, and other cards entering add none", () => {
  const { engine, id } = stiBoard({ extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  assert.equal(tokensOn(engine, id("sti")), 0);
  play(engine, P1, id("newbie"));
  assert.equal(tokensOn(engine, id("sti")), 0);
});

clause(STI, "0:rule", "put into play by an effect it also comes in with 2 tokens", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "item" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sti", def: printing(STI), owner: P1, zone: "discard" },
      { key: "raise", def: raise, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("raise"), { selected: { t: [id("sti")] } });
  assert.equal(zoneOf(engine, id("sti")), "play");
  assert.equal(tokensOn(engine, id("sti")), 2);
});

clause(STI, "0:rule", "an Investment that left play and is deployed again comes in with 2 tokens, not its old ones (CR 409.2)", () => {
  // The Investment is not a character, so the stock character-only Bounce can't pick it.
  const bounceAny = bounceTactic({ behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } });
  const { engine, id } = stiBoard({ zone: "hand", extra: [{ key: "bounce", def: bounceAny, owner: P1, zone: "hand" }] });
  play(engine, P1, id("sti"));
  engine.state.cards[id("sti")].counters.token = 1;
  play(engine, P1, id("bounce"), { selected: { t: [id("sti")] } });
  assert.equal(zoneOf(engine, id("sti")), "hand");
  assert.equal(tokensOn(engine, id("sti")), 0, "tokens disappear when the card leaves play");
  play(engine, P1, id("sti"));
  assert.equal(zoneOf(engine, id("sti")), "play");
  assert.equal(tokensOn(engine, id("sti")), 2);
});

clause(STI, "0:rule", "is refused one resource short of its cost of 2, and without [G][G]", () => {
  const short = stiBoard({ zone: "hand", greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sti")));
  assert.equal(zoneOf(short.engine, short.id("sti")), "hand");
  const noThreshold = stiBoard({ zone: "hand", greed: 1, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sti")), "only one [G]");
  const exact = stiBoard({ zone: "hand", greed: 2 });
  play(exact.engine, P1, exact.id("sti"));
  assert.equal(zoneOf(exact.engine, exact.id("sti")), "play", "[G][G] and exactly 2 resources");
  assert.equal(ready(exact.engine), 0);
});

clause(STI, "1:rule", "at the start of YOUR turn it loses one token: deployed with 2, it has 1 at your next turn and 0 at the one after", () => {
  const { engine, id } = stiBoard({ zone: "hand" });
  play(engine, P1, id("sti"));
  assert.equal(tokensOn(engine, id("sti")), 2, "no token is removed the turn it is deployed");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(tokensOn(engine, id("sti")), 2, "the opponent's turn start is not 'the start of your turn'");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(tokensOn(engine, id("sti")), 1, "start of my turn: one token removed");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("sti")), 0, "...and another next time");
});

clause(STI, "1:rule", "it removes exactly ONE token per turn, not all of them", () => {
  const { engine, id } = stiBoard({ tokens: 5 });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("sti")), 4);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("sti")), 3);
});

clause(STI, "1:rule", "with no tokens left there is nothing to remove: the count stays at 0 on later turns", () => {
  const { engine, id } = stiBoard({ tokens: 0 });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("sti")), 0);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("sti")), 0);
});

clause(STI, "1:rule", "only the controller's turn start counts: an Investment controlled by the second player ticks at THEIR turn start, not at mine", () => {
  const { engine, id } = stiBoard({ owner: P2, active: P1, tokens: 2 });
  assert.equal(engine.state.activePlayerId, P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(tokensOn(engine, id("sti")), 1, "start of its controller's turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(tokensOn(engine, id("sti")), 1, "not at the start of the other player's turn");
});

clause(STI, "1:rule", "each Investment ticks on its own: two of them each lose one token at the start of the turn", () => {
  const { engine, id } = stiBoard({ tokens: 2, extra: [{ key: "sti2", def: printing(STI), owner: P1, zone: "play", counters: { token: 3 } }] });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(pending(engine)?.kind, "orderTriggers", "two start-of-turn triggers from one player: that player orders them (CR 503.4)");
  drain(engine, declineAll);
  assert.equal(tokensOn(engine, id("sti")), 1);
  assert.equal(tokensOn(engine, id("sti2")), 2);
});

clause(STI, "1:rule", "other cards' tokens are not touched at the start of the turn", () => {
  const { engine, id } = stiBoard({ tokens: 2, extra: [{ key: "tokened", def: character({ name: "Tokened" }), owner: P1, zone: "play", counters: { token: 3 } }] });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("tokened")), 3);
});

clause(STI, "2:ability:return", "USE ONLY IF no tokens: with 2 tokens or 1 token it is refused, with 0 it works", () => {
  for (const tokens of [2, 1]) {
    const { engine, id } = stiBoard({ tokens });
    const handBefore = hand(engine, P1).length;
    assert.throws(() => activateRaw(engine, P1, id("sti"), "return"), `${tokens} token(s)`);
    assert.equal(zoneOf(engine, id("sti")), "play", "not destroyed");
    assert.equal(hand(engine, P1).length, handBefore, "nothing drawn");
    assert.equal(engine.state.responseWindow, undefined);
  }
  const { engine, id } = stiBoard({ tokens: 0 });
  activate(engine, P1, id("sti"), "return");
  assert.equal(zoneOf(engine, id("sti")), "discard");
});

clause(STI, "2:ability:return", "is not offered as a legal activation while it has tokens, and is offered at 0", () => {
  const withTokens = stiBoard({ tokens: 1 });
  assert.equal(withTokens.engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === withTokens.id("sti") && a.ability.id === "return"), false);
  const none = stiBoard({ tokens: 0 });
  assert.equal(none.engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === none.id("sti") && a.ability.id === "return"), true);
});

clause(STI, "2:ability:return", "the whole life cycle: deployed with 2 tokens it can't be cashed in at once, nor after one turn, but can after the second turn start", () => {
  const { engine, id } = stiBoard({ zone: "hand" });
  play(engine, P1, id("sti"));
  assert.throws(() => activateRaw(engine, P1, id("sti"), "return"), "2 tokens");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("sti")), 1);
  assert.throws(() => activateRaw(engine, P1, id("sti"), "return"), "1 token");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("sti")), 0);
  const top3 = deck(engine, P1).slice(0, 3);
  activate(engine, P1, id("sti"), "return");
  for (const c of top3) assert.equal(zoneOf(engine, c), "hand");
});

clause(STI, "2:ability:return", "COST: destroy this card is paid when it is used (before the opponent can respond), and the 3 cards are drawn only when the ability resolves", () => {
  const { engine, id } = stiBoard({ tokens: 0 });
  const [a, b, c, d] = deck(engine, P1).slice(0, 4);
  activateRaw(engine, P1, id("sti"), "return");
  assert.equal(zoneOf(engine, id("sti")), "discard", "destroyed as a cost, into its owner's discard pile");
  assert.equal(discard(engine, P1).includes(id("sti")), true);
  assert.equal(zoneOf(engine, a), "deck", "nothing drawn yet");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  for (const card of [a, b, c]) assert.equal(zoneOf(engine, card), "hand");
  assert.equal(zoneOf(engine, d), "deck", "exactly three cards, not four");
});

clause(STI, "2:ability:return", "EFFECT draws exactly 3 cards: the hand grows by 3 and the deck shrinks by 3", () => {
  const { engine, id } = stiBoard({ tokens: 0 });
  const handBefore = hand(engine, P1).length;
  const deckBefore = deck(engine, P1).length;
  activate(engine, P1, id("sti"), "return");
  assert.equal(hand(engine, P1).length, handBefore + 3);
  assert.equal(deck(engine, P1).length, deckBefore - 3);
});

clause(STI, "2:ability:return", "it costs no resources and needs no threshold (it works with no resources at all)", () => {
  const { engine, id } = stiBoard({ tokens: 0, greed: 0 });
  assert.equal(ready(engine), 0);
  activate(engine, P1, id("sti"), "return");
  assert.equal(zoneOf(engine, id("sti")), "discard");
  assert.equal(hand(engine, P1).length, 3);
});

clause(STI, "2:ability:return", "with fewer than 3 cards in the deck you draw what is there and do not lose", () => {
  const two = stiBoard({ tokens: 0, deckSize: 2 });
  activate(two.engine, P1, two.id("sti"), "return");
  assert.equal(hand(two.engine, P1).length, 2);
  assert.equal(deck(two.engine, P1).length, 0);
  assert.equal(two.engine.state.winner, undefined);
  const none = stiBoard({ tokens: 0, deckSize: 0 });
  activate(none.engine, P1, none.id("sti"), "return");
  assert.equal(hand(none.engine, P1).length, 0);
  assert.equal(zoneOf(none.engine, none.id("sti")), "discard", "the cost is still paid");
  assert.equal(none.engine.state.winner, undefined);
});

clause(STI, "2:ability:return", "it can only be used once: the card is destroyed, so a second use is impossible", () => {
  const { engine, id } = stiBoard({ tokens: 0 });
  activate(engine, P1, id("sti"), "return");
  assert.throws(() => activateRaw(engine, P1, id("sti"), "return"));
  assert.equal(hand(engine, P1).length, 3, "only the first use drew");
});

clause(STI, "2:ability:return", "only its controller may use it; the opponent drawing nothing", () => {
  const { engine, id } = stiBoard({ tokens: 0 });
  const theirHand = hand(engine, P2).length;
  assert.throws(() => activateRaw(engine, P2, id("sti"), "return"));
  assert.equal(zoneOf(engine, id("sti")), "play");
  assert.equal(hand(engine, P2).length, theirHand);
  activate(engine, P1, id("sti"), "return");
  assert.equal(hand(engine, P2).length, theirHand, "the opponent drew nothing");
});

clause(STI, "2:ability:return", "like any ability it can be used in response, even on the opponent's turn", () => {
  const { engine, id } = stiBoard({
    tokens: 0,
    active: P2,
    extra: [{ key: "p2tac", def: tactic({ name: "P2 Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } }), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P2, id("p2tac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  const top3 = deck(engine, P1).slice(0, 3);
  activateRaw(engine, P1, id("sti"), "return");
  resolvePendingResponses(engine);
  for (const c of top3) assert.equal(zoneOf(engine, c), "hand");
  assert.equal(zoneOf(engine, id("sti")), "discard");
});

// =============================================================================
// Smear Campaign
// ATTACH TO CHARACTER
// If the attached character inflicts any amount of damage, inflict an equal
// amount of damage to the character's controller's faction.
// Item (gear), banker, cost 0, threshold [G].
// =============================================================================

const SMEAR = "338fa9ec-5021-4909-bfe3-0d71fcbebd3e";

/** A character with a free ability "zap" dealing `amount` damage to one chosen character (declaration `t`). */
const zapper = (name: string, amount: number, extra: Partial<CardDefinition> = {}) =>
  character({
    name,
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }]
    },
    ...extra
  });

function smearBoard(
  opts: { smear?: "hand" | "play"; host?: "host" | "foeHost"; greed?: number; rage?: number; active?: Pid; hostDef?: CardDefinition; extra?: CardPlacement[]; influenceA?: number; influenceB?: number } = {}
) {
  const where = opts.smear ?? "play";
  const hostKey = opts.host ?? "host";
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influenceA },
    playerB: { faction: developFaction(), influence: opts.influenceB },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "smear", def: printing(SMEAR), owner: P1, zone: where, attachedToKey: where === "play" ? hostKey : undefined },
      { key: "host", def: opts.hostDef ?? character({ name: "Host", strength: 3, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeHost", def: character({ name: "Foe Host", strength: 3, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "blk1", def: character({ name: "Blocker One", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blocker Two", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...resources("g", opts.greed ?? 2, P1, "greed"),
      ...resources("r", opts.rage ?? 0, P1, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(SMEAR, "0:attach", "is played onto a character: it enters play attached to the chosen host, costs nothing (cost 0) and leaves the hand", () => {
  const { engine, id } = smearBoard({ smear: "hand" });
  const before = ready(engine);
  play(engine, P1, id("smear"), { selected: { attachTo: [id("host")] } });
  assert.equal(zoneOf(engine, id("smear")), "play");
  assert.equal(engine.state.cards[id("smear")].attachedTo, id("host"));
  assert.equal(before - ready(engine), 0, "cost 0: no resource is spent");
  assert.equal(engine.state.players[P1].hand.includes(id("smear")), false);
});

clause(SMEAR, "0:attach", "the host can be any character, yours or the opponent's; the Campaign stays under its player's control", () => {
  for (const hostKey of ["host", "foeHost"] as const) {
    const { engine, id } = smearBoard({ smear: "hand" });
    play(engine, P1, id("smear"), { selected: { attachTo: [id(hostKey)] } });
    assert.equal(engine.state.cards[id("smear")].attachedTo, id(hostKey), hostKey);
    assert.equal(engine.state.cards[id("smear")].controllerId, P1);
  }
});

clause(SMEAR, "0:attach", "is refused for a host that is not a character (item, location, faction), or with no host chosen; the card stays in hand", () => {
  const { engine, id } = smearBoard({ smear: "hand" });
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("smear"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(() => playRaw(engine, P1, id("smear"), { selected: {} }), "no host");
  assert.equal(zoneOf(engine, id("smear")), "hand");
  attempt(id("other"))();
  assert.ok(engine.state.responseWindow, "control: a character host is accepted");
});

clause(SMEAR, "0:attach", "a face-down card (just a resource) is not a character host", () => {
  const { engine, id } = smearBoard({ smear: "hand", extra: [{ key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }] });
  assert.throws(() => playRaw(engine, P1, id("smear"), { selected: { attachTo: [id("hidden")] } }));
  assert.equal(zoneOf(engine, id("smear")), "hand");
});

clause(SMEAR, "0:attach", "needs [G]: refused with no greed icon (even with resources), accepted with one", () => {
  const none = smearBoard({ smear: "hand", greed: 0, rage: 4 });
  assert.throws(() => playRaw(none.engine, P1, none.id("smear"), { selected: { attachTo: [none.id("host")] } }));
  assert.equal(zoneOf(none.engine, none.id("smear")), "hand");
  const one = smearBoard({ smear: "hand", greed: 1 });
  play(one.engine, P1, one.id("smear"), { selected: { attachTo: [one.id("host")] } });
  assert.equal(zoneOf(one.engine, one.id("smear")), "play");
  assert.equal(ready(one.engine), 1, "[G] is a threshold, not a cost: the resource is not spent");
});

clause(SMEAR, "0:attach", "when its host is destroyed the Campaign is destroyed with it (to its owner's discard pile)", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("smear")), "discard");
  assert.equal(discard(engine, P1).includes(id("smear")), true);
});

clause(SMEAR, "0:attach", "when its host is returned to hand the Campaign leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("smear")), "hand", "an attached card leaves play the same way its host does");
  assert.equal(engine.state.players[P1].hand.includes(id("smear")), true);
});

clause(SMEAR, "0:attach", "when its host is returned to hand the Campaign does not stay on the table unattached", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.notEqual(zoneOf(engine, id("smear")), "play");
  assert.equal(engine.state.cards[id("smear")].attachedTo, undefined);
});

clause(SMEAR, "0:attach", "a Campaign on an opponent's character: when that character is destroyed the Campaign goes to its OWNER's discard pile", () => {
  const { engine, id } = smearBoard({ host: "foeHost", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("foeHost")] } });
  assert.equal(zoneOf(engine, id("smear")), "discard");
  assert.equal(discard(engine, P1).includes(id("smear")), true, "my card goes to my discard pile");
  assert.equal(discard(engine, P2).includes(id("smear")), false);
});

clause(SMEAR, "0:attach", "if its host stops being a character (flipped face-down into a resource) the Campaign is flipped face-down with it", () => {
  const flip = tactic({
    name: "Flip Down",
    cost: 0,
    behavior: { abilities: [{ id: "fd", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = smearBoard({ extra: [{ key: "flip", def: flip, owner: P1, zone: "hand" }] });
  play(engine, P1, id("flip"), { selected: { t: [id("host")] } });
  assert.equal(engine.state.cards[id("host")].faceDown, true, "control: the host is now a face-down resource");
  assert.equal(zoneOf(engine, id("smear")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(engine.state.cards[id("smear")].faceDown, true, "...and is flipped face-down along with its host");
});

/** The host (controlled by P1) attacks P2's faction unblocked; returns the two factions' influence changes. */
function hostHitsFaction(engine: SpoilsEngine, id: (key: string) => string, hostKey = "host") {
  const a = influence(engine, P1);
  const b = influence(engine, P2);
  fightThrough(engine, P1, [id(hostKey)], { type: "faction", playerId: P2 }, []);
  return { mine: a - influence(engine, P1), theirs: b - influence(engine, P2) };
}

clause(SMEAR, "1:rule", "control: without the Campaign the host's battle damage hurts only the defending faction", () => {
  const { engine, id } = smearBoard({ smear: "hand" });
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3);
  assert.equal(mine, 0);
});

clause(SMEAR, "1:rule", "the host hits a faction for 3: the defender loses 3 AND the host's controller's own faction takes an equal 3 damage", () => {
  const { engine, id } = smearBoard();
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3, "the battle damage itself");
  assert.equal(mine, 3, "an equal amount of damage to the character's controller's faction");
  assert.equal(damageOf(engine, engine.state.players[P1].factionId!), 0, "a faction takes damage as lost influence, it holds no damage");
});

clause(SMEAR, "1:rule", "the amount is the amount inflicted: strength 5 gives 5, strength 1 gives 1", () => {
  for (const strength of [1, 5]) {
    const { engine, id } = smearBoard({ hostDef: character({ name: "Host", strength, life: 6, speed: 2 }) });
    const { mine, theirs } = hostHitsFaction(engine, id);
    assert.equal(theirs, strength);
    assert.equal(mine, strength, `strength ${strength}`);
  }
});

clause(SMEAR, "1:rule", "it triggers on damage to a CHARACTER too: a blocked host damaging the blocker costs its controller's faction the same amount", () => {
  const { engine, id } = smearBoard();
  const before = influence(engine, P1);
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("blk2")]);
  assert.equal(damageOf(engine, id("blk2")), 3, "the blocker took 3");
  assert.equal(before - influence(engine, P1), 3, "my faction took 3 for it");
});

clause(SMEAR, "1:rule", "the full amount counts even when it exceeds the blocker's life (overkill): 3 damage to a 2-life blocker is still 3", () => {
  const { engine, id } = smearBoard();
  const before = influence(engine, P1);
  fight(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("blk1")]);
  assert.equal(zoneOf(engine, id("blk1")), "discard", "control: the blocker died");
  assert.equal(before - influence(engine, P1), 3);
});

clause(SMEAR, "1:rule", "it triggers on damage to a LOCATION too", () => {
  const { engine, id } = smearBoard();
  const before = influence(engine, P1);
  fight(engine, P1, [id("host")], { type: "card", cardId: id("place") }, []);
  assert.equal(damageOf(engine, id("place")), 3, "control: the location took 3");
  assert.equal(before - influence(engine, P1), 3);
});

clause(SMEAR, "1:rule", "damage split between two blockers (2 + 1 of strength 3) adds up: the faction takes 3 in all", () => {
  const { engine, id } = smearBoard();
  const before = influence(engine, P1);
  fightThrough(engine, P1, [id("host")], { type: "faction", playerId: P2 }, [id("blk1"), id("blk2")], (source) => {
    if (source.cardId !== id("host")) return source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : [];
    const t1 = source.legalTargets.find((t) => t.type === "card" && t.cardId === id("blk1"))!;
    const t2 = source.legalTargets.find((t) => t.type === "card" && t.cardId === id("blk2"))!;
    return [
      { sourceId: source.cardId, target: t1, amount: 2 },
      { sourceId: source.cardId, target: t2, amount: 1 }
    ];
  });
  assert.equal(zoneOf(engine, id("blk1")), "discard", "control: 2 damage killed the 2-life blocker");
  assert.equal(damageOf(engine, id("blk2")), 1, "control: the other blocker took 1");
  assert.equal(before - influence(engine, P1), 3, "an equal amount to the damage inflicted, in total");
});

clause(SMEAR, "1:rule", "'any amount of damage' includes damage from the host's ability, not only battle damage", () => {
  const { engine, id } = smearBoard({ hostDef: zapper("Zap Host", 2) });
  const before = influence(engine, P1);
  activate(engine, P1, id("host"), "zap", { selected: { t: [id("blk2")] } });
  assert.equal(damageOf(engine, id("blk2")), 2, "control: the ability dealt 2");
  assert.equal(before - influence(engine, P1), 2);
});

clause(SMEAR, "1:rule", "...and damage dealt by the host to your own character counts as well", () => {
  const { engine, id } = smearBoard({ hostDef: zapper("Zap Host", 2) });
  const before = influence(engine, P1);
  activate(engine, P1, id("host"), "zap", { selected: { t: [id("other")] } });
  assert.equal(damageOf(engine, id("other")), 2);
  assert.equal(before - influence(engine, P1), 2);
});

clause(SMEAR, "1:rule", "it triggers every time: two uses of the host's ability cost the faction 2 + 2", () => {
  const { engine, id } = smearBoard({ hostDef: zapper("Zap Host", 2) });
  const before = influence(engine, P1);
  activate(engine, P1, id("host"), "zap", { selected: { t: [id("blk2")] } });
  activate(engine, P1, id("host"), "zap", { selected: { t: [id("blk2")] } });
  assert.equal(before - influence(engine, P1), 4);
});

clause(SMEAR, "1:rule", "only the ATTACHED character: damage inflicted by another of your characters costs nothing", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "zapOther", def: zapper("Zap Other", 2), owner: P1, zone: "play" }] });
  const before = influence(engine, P1);
  activate(engine, P1, id("zapOther"), "zap", { selected: { t: [id("blk2")] } });
  assert.equal(damageOf(engine, id("blk2")), 2, "control: damage was dealt");
  assert.equal(influence(engine, P1), before, "not by the attached character: no effect");
  const { mine } = hostHitsFaction(engine, id, "other");
  assert.equal(mine, 0, "battle damage by a non-host character: no effect either");
});

clause(SMEAR, "1:rule", "damage inflicted TO the host does not trigger it", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "zapFoe", def: zapper("Zap Foe", 2), owner: P2, zone: "play" }], active: P2 });
  const mineBefore = influence(engine, P1);
  const theirsBefore = influence(engine, P2);
  activate(engine, P2, id("zapFoe"), "zap", { selected: { t: [id("host")] } });
  assert.equal(damageOf(engine, id("host")), 2, "control: the host took 2");
  assert.equal(influence(engine, P1), mineBefore);
  assert.equal(influence(engine, P2), theirsBefore);
});

clause(SMEAR, "1:rule", "when the attached character deals no damage (strength 0) nothing is inflicted on the faction", () => {
  const { engine, id } = smearBoard({ hostDef: character({ name: "Host", strength: 0, life: 6, speed: 2 }) });
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 0);
  assert.equal(mine, 0, "0 damage inflicts nothing and triggers nothing (CR 408.1a)");
});

clause(SMEAR, "1:rule", "it follows the CHARACTER'S controller, not the Campaign's: on an opponent's character it is the opponent's faction that takes the damage", () => {
  const { engine, id } = smearBoard({ host: "foeHost", active: P2 });
  const mineBefore = influence(engine, P1);
  const theirsBefore = influence(engine, P2);
  fight(engine, P2, [id("foeHost")], { type: "faction", playerId: P1 }, []);
  assert.equal(mineBefore - influence(engine, P1), 3, "control: the battle damage hit my faction");
  assert.equal(theirsBefore - influence(engine, P2), 3, "the foe's own faction (the host's controller) took the equal damage");
});

clause(SMEAR, "1:rule", "...and when the host changes controller the damage follows the new controller", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });
  const { engine, id } = smearBoard({ host: "foeHost", extra: [{ key: "steal", def: steal, owner: P1, zone: "hand" }] });
  play(engine, P1, id("steal"), { selected: { t: [id("foeHost")] } });
  assert.equal(engine.state.cards[id("foeHost")].controllerId, P1, "control: I now control the host");
  assert.equal(zoneOf(engine, id("smear")), "play", "the Campaign is still attached");
  engine.state.cards[id("foeHost")].attackEligibleTurn = engine.state.turn;
  const { mine, theirs } = hostHitsFaction(engine, id, "foeHost");
  assert.equal(theirs, 3);
  assert.equal(mine, 3, "now my character: my faction takes the equal damage");
});

clause(SMEAR, "1:rule", "two Campaigns on one character both apply: 3 damage costs its controller's faction 3 + 3", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "smear2", def: printing(SMEAR), owner: P1, zone: "play", attachedToKey: "host" }] });
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3);
  assert.equal(mine, 6);
});

clause(SMEAR, "1:rule", "a Campaign on the opponent's character and one on mine both fire for their own host only", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "smear2", def: printing(SMEAR), owner: P1, zone: "play", attachedToKey: "foeHost" }] });
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(mine, 3);
  assert.equal(theirs, 3, "the foe's Campaign host did not deal damage, so only my host's Campaign fired");
});

clause(SMEAR, "1:rule", "once the Campaign has left play the host's damage costs its controller nothing again", () => {
  const { engine, id } = smearBoard({ extra: [{ key: "smash", def: tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("smash"), { selected: { t: [id("smear")] } });
  assert.equal(zoneOf(engine, id("smear")), "discard");
  const { mine, theirs } = hostHitsFaction(engine, id);
  assert.equal(theirs, 3);
  assert.equal(mine, 0);
});

clause(SMEAR, "1:rule", "the damage to the faction can be lethal: a faction with 3 influence reduced to 0 loses the game", () => {
  const { engine, id } = smearBoard({ influenceA: 3, influenceB: 30 });
  hostHitsFaction(engine, id);
  assert.equal(influence(engine, P1), 0);
  assert.equal(engine.state.winner, P2, "the host's controller lost to their own Campaign");
});

clause(SMEAR, "1:rule", "damage the attached character inflicts to its OWN controller's faction also triggers the Campaign (it is 'any amount of damage')", () => {
  const selfHarm = character({
    name: "Self Harm",
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [{ id: "ouch", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "controller" }, amount: 2 }] }]
    }
  });
  const { engine, id } = smearBoard({ hostDef: selfHarm });
  const before = influence(engine, P1);
  activate(engine, P1, id("host"), "ouch");
  assert.equal(before - influence(engine, P1), 4, "2 from the ability, plus an equal 2 from the Campaign");
});

// =============================================================================
// Snooty Doorman
// DENIED! -- COST: Use this only in response to a character being played. Destroy
// this card. -- EFFECT: When the character is finished being played, put it into
// its owner's discard pile instead of into play.
// Character (lackey), banker, cost 3, threshold [G], 2 / 3 / 2.
// =============================================================================

const DOORMAN = "72439f0b-d9fe-4ea9-b701-e2f535669484";

const NOOP_TACTIC = (name = "Noop") => tactic({ name, cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } });

function doormanBoard(opts: { active?: Pid; greedP1?: number; extra?: CardPlacement[]; foeHand?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "door", def: printing(DOORMAN), owner: P1, zone: "play" },
      { key: "door2", def: printing(DOORMAN), owner: P1, zone: "play" },
      { key: "foeDoor", def: printing(DOORMAN), owner: P2, zone: "play" },
      { key: "cA", def: character({ name: "Newcomer", cost: 2, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "hand" },
      { key: "cB", def: character({ name: "Second Newcomer", cost: 1, strength: 1, life: 1, speed: 1 }), owner: P2, zone: "hand" },
      { key: "tac", def: NOOP_TACTIC("Their Tactic"), owner: P2, zone: "hand" },
      { key: "itm", def: item({ name: "Their Item", cost: 1 }), owner: P2, zone: "hand" },
      { key: "loc", def: location({ name: "Their Place", cost: 1, structure: 3 }), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "My Guy" }), owner: P1, zone: "play" },
      { key: "p1res", def: resourceCard({ name: "P1 Staple" }), owner: P1, zone: "hand" },
      ...fillers("pd", 4, P2, "deck"),
      ...resources("p2g", 10, P2, "greed"),
      ...resources("g", opts.greedP1 ?? 3, P1, "greed"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(DOORMAN, "0:ability:denied", "in response to the opponent's character being played: the character never enters play, it goes to its OWNER's discard pile", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  assert.equal(zoneOf(engine, id("cA")), "deploying", "control: it is being played");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  activateRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "discard", "put into its owner's discard pile instead of into play");
  assert.equal(discard(engine, P2).includes(id("cA")), true);
  assert.equal(discard(engine, P1).includes(id("cA")), false, "not mine");
  assert.equal(engine.state.players[P2].play.includes(id("cA")), false);
  assert.equal(engine.state.responseWindow, undefined);
});

clause(DOORMAN, "0:ability:denied", "COST: the Doorman is destroyed when DENIED! is used (before it resolves), into its owner's discard pile", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  activateRaw(engine, P1, id("door"), "denied");
  assert.equal(zoneOf(engine, id("door")), "discard", "'Destroy this card' is a cost");
  assert.equal(discard(engine, P1).includes(id("door")), true);
  assert.equal(zoneOf(engine, id("cA")), "deploying", "the denial has not happened yet: the effect waits for responses");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "discard");
});

clause(DOORMAN, "0:ability:denied", "only the Doorman using it is destroyed: my other Doorman, my other characters and the opponent's Doorman stay in play", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  activateRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("door2")), "play");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("foeDoor")), "play");
});

clause(DOORMAN, "0:ability:denied", "the denied character's cost stays paid (the opponent's resources are not refunded)", () => {
  const { engine, id } = doormanBoard();
  const before = ready(engine, P2);
  playRaw(engine, P2, id("cA"));
  assert.equal(before - ready(engine, P2), 2, "control: they paid cost 2");
  activateRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine, P2), 2, "still spent");
});

clause(DOORMAN, "0:ability:denied", "it costs no resources to use and needs no threshold: usable with no resources at all", () => {
  const { engine, id } = doormanBoard({ greedP1: 0 });
  assert.equal(ready(engine, P1), 0);
  playRaw(engine, P2, id("cA"));
  activateRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "discard");
});

clause(DOORMAN, "0:ability:denied", "the character 'enters play' never: its enters-play trigger does not fire (a Prudent Thug costs its owner no influence)", () => {
  const { engine, id } = doormanBoard({ extra: [{ key: "thug", def: printing(THUG), owner: P2, zone: "hand" }] });
  const before = influence(engine, P2);
  playRaw(engine, P2, id("thug"));
  activateRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("thug")), "discard");
  assert.equal(influence(engine, P2), before, "the Thug never entered play");
  // control: the same Thug, not denied, does cost 3
  const control = doormanBoard({ extra: [{ key: "thug", def: printing(THUG), owner: P2, zone: "hand" }] });
  play(control.engine, P2, control.id("thug"));
  assert.equal(influence(control.engine, P2), before - 3);
});

clause(DOORMAN, "0:ability:denied", "...and no draw trigger fires either (a Randolph denied draws nothing)", () => {
  const { engine, id } = doormanBoard({ extra: [{ key: "rand", def: printing(RANDOLPH), owner: P2, zone: "hand" }] });
  const handBefore = hand(engine, P2).length;
  const deckBefore = deck(engine, P2).length;
  playRaw(engine, P2, id("rand"));
  activateRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("rand")), "discard");
  assert.equal(deck(engine, P2).length, deckBefore, "nothing drawn");
  assert.equal(hand(engine, P2).length, handBefore - 1);
});

clause(DOORMAN, "0:ability:denied", "not destroyed: the denied character does not count as 'destroyed' (it never was in play), so no destroy trigger fires", () => {
  const dies = character({
    name: "Dies Loudly",
    cost: 1,
    behavior: {
      abilities: [{ id: "last", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -5 }] }]
    }
  });
  const { engine, id } = doormanBoard({ extra: [{ key: "dies", def: dies, owner: P2, zone: "hand" }] });
  const before = influence(engine, P1);
  playRaw(engine, P2, id("dies"));
  activateRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("dies")), "discard");
  assert.equal(influence(engine, P1), before, "it was not destroyed, merely put into the discard pile");
});

clause(DOORMAN, "0:ability:denied", "only THAT character is affected: a different character played afterwards enters play normally", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  activateRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  play(engine, P2, id("cB"));
  assert.equal(zoneOf(engine, id("cB")), "play", "the next character is not denied");
  assert.equal(zoneOf(engine, id("cA")), "discard");
});

clause(DOORMAN, "0:ability:denied", "'in response to a character being played': refused in response to a tactic, an item, a location or an ability", () => {
  const react = (key: string) => {
    const b = doormanBoard({ extra: [{ key: "zapper", def: zapper("Their Zapper", 1), owner: P2, zone: "play" }] });
    return { ...b, key };
  };
  for (const key of ["tac", "itm", "loc"]) {
    const { engine, id } = react(key);
    playRaw(engine, P2, id(key));
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, `${key}: I may respond`);
    assert.throws(() => activateRaw(engine, P1, id("door"), "denied"), `${key} is not a character`);
    assert.equal(zoneOf(engine, id("door")), "play", "the Doorman was not destroyed by a refused use");
  }
  const { engine, id } = react("ability");
  activateRaw(engine, P2, id("zapper"), "zap", { selected: { t: [id("mine")] } });
  assert.throws(() => activateRaw(engine, P1, id("door"), "denied"), "an ability is not a character being played");
  assert.equal(zoneOf(engine, id("door")), "play");
});

clause(DOORMAN, "0:ability:denied", "control: the same Doorman IS usable once a character is being played (it is the situation, not the Doorman, that was refused)", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  activateRaw(engine, P1, id("door"), "denied");
  assert.equal(zoneOf(engine, id("door")), "discard");
});

clause(DOORMAN, "0:ability:denied", "it can't be used with nothing being played, nor in response to a battle declaration or on my own turn", () => {
  const idle = doormanBoard({ active: P1 });
  assert.throws(() => activateRaw(idle.engine, P1, idle.id("door"), "denied"), "nothing is being played");
  assert.equal(zoneOf(idle.engine, idle.id("door")), "play");
  const attack = doormanBoard({ active: P2 });
  declareAttackBy(attack.engine, P2, [attack.id("foeDoor")]);
  assert.throws(() => activateRaw(attack.engine, P1, attack.id("door"), "denied"), "an attack is not a character being played");
  assert.equal(zoneOf(attack.engine, attack.id("door")), "play");
});

clause(DOORMAN, "0:ability:denied", "a character that is put into play by an effect is not 'being played': the Doorman can't respond to the tactic that raises it", () => {
  const putter = tactic({
    name: "Put Into Play",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "t", selector: { controller: "self", zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = doormanBoard({ extra: [{ key: "putter", def: putter, owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("putter"), { selected: { t: [id("cA")] } });
  assert.throws(() => activateRaw(engine, P1, id("door"), "denied"), "the tactic is what is being played");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "play", "the character entered play");
});

clause(DOORMAN, "0:ability:denied", "only its controller may use it: the opponent can't use my Doorman, and mine can't deny my own character", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  assert.throws(() => activateRaw(engine, P2, id("door"), "denied"), "not the controller");
  assert.equal(zoneOf(engine, id("door")), "play");
  assert.equal(zoneOf(engine, id("cA")), "deploying");
  // my own character being played: I cannot respond to my own action
  const own = doormanBoard({ active: P1, extra: [{ key: "myChar", def: character({ name: "My Newcomer", cost: 1 }), owner: P1, zone: "hand" }] });
  playRaw(own.engine, P1, own.id("myChar"));
  assert.throws(() => activateRaw(own.engine, P1, own.id("door"), "denied"), "you can never respond to your own action (CR 607.1)");
  assert.equal(zoneOf(own.engine, own.id("door")), "play");
});

clause(DOORMAN, "0:ability:denied", "the opponent's Doorman works for the opponent in the same way: it denies MY character", () => {
  const { engine, id } = doormanBoard({ active: P1, extra: [{ key: "myChar", def: character({ name: "My Newcomer", cost: 1 }), owner: P1, zone: "hand" }] });
  playRaw(engine, P1, id("myChar"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  activateRaw(engine, P2, id("foeDoor"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("myChar")), "discard");
  assert.equal(discard(engine, P1).includes(id("myChar")), true, "into MY discard pile, its owner's");
  assert.equal(zoneOf(engine, id("foeDoor")), "discard");
});

clause(DOORMAN, "0:ability:denied", "it is a response: once the Doorman is spent, my other Doorman can't deny the character again (it is already gone), and nothing breaks", () => {
  const { engine, id } = doormanBoard();
  playRaw(engine, P2, id("cA"));
  activateRaw(engine, P1, id("door"), "denied");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("cA")), "discard");
  assert.equal(zoneOf(engine, id("door2")), "play", "the second Doorman is still there");
  assert.throws(() => activateRaw(engine, P1, id("door2"), "denied"), "nothing is being played any more");
});

// =============================================================================
// Subsection 5, Paragraph 12
// Your opponent cannot respond to this card.
// COST: Play this only in response to an ability that's source was not a faction.
// EFFECT: The ability has no effect and cannot be used again this turn. Draw a card.
// Tactic, banker, cost 2, threshold [G][G].
// =============================================================================

const SUBSECTION = "8fbf09c1-9f8e-4c2e-8695-fd6f95a4fa8a";

/** A character with two free-ish abilities: ZAP (pay 1: 2 damage to a character) and PEEK (draw a card). */
const abilityGuy = (name: string) =>
  character({
    name,
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          costs: [{ type: "payResources", amount: 1 }],
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
        },
        { id: "peek", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    }
  });

const GUY = abilityGuy("Ability Guy");
const OTHER_GUY = abilityGuy("Other Guy");

const IDOL = item({
  name: "Pulse Idol",
  behavior: {
    abilities: [{ id: "pulse", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }]
  }
});

const SHRINE = location({
  name: "Quake Shrine",
  structure: 4,
  behavior: {
    abilities: [{ id: "quake", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }]
  }
});

const ABILITY_FACTION = factionCard({
  id: "p203-ability-faction",
  name: "Faction With Ability",
  faction: defaultFactionDefinition({
    startingInfluence: 30,
    abilities: [{ id: "fdraw", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
  })
});

function s5Board(opts: { active?: Pid; greed?: number; rage?: number; deckSize?: number; foeFaction?: CardDefinition; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: opts.foeFaction ?? developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "s5", def: printing(SUBSECTION), owner: P1, zone: "hand" },
      { key: "myTac", def: NOOP_TACTIC("My Noop"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 8 }), owner: P1, zone: "play" },
      { key: "myGuy", def: abilityGuy("My Ability Guy"), owner: P1, zone: "play" },
      { key: "guy", def: GUY, owner: P2, zone: "play" },
      { key: "guy2", def: GUY, owner: P2, zone: "play" },
      { key: "other", def: OTHER_GUY, owner: P2, zone: "play" },
      { key: "idol", def: IDOL, owner: P2, zone: "play" },
      { key: "shrine", def: SHRINE, owner: P2, zone: "play" },
      { key: "p2tac", def: NOOP_TACTIC("Their Noop"), owner: P2, zone: "hand" },
      { key: "p2char", def: character({ name: "Their Newcomer", cost: 0 }), owner: P2, zone: "hand" },
      ...fillers("d", opts.deckSize ?? 5, P1, "deck"),
      ...fillers("f", 5, P2, "deck"),
      ...resources("g", opts.greed ?? 4, P1, "greed"),
      ...resources("r", opts.rage ?? 0, P1, "rage"),
      ...resources("p2g", 8, P2, "greed"),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 activates `abilityId` of its card `cardKey` (zap at my character by default) and holds the response window open for P1. */
function foeUses(engine: SpoilsEngine, id: (key: string) => string, cardKey: string, abilityId: string) {
  const needsTarget = abilityId !== "peek" && abilityId !== "fdraw";
  activateRaw(engine, P2, id(cardKey), abilityId, needsTarget ? { selected: { t: [id("mine")] } } : {});
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the ability");
}

clause(SUBSECTION, "0:rule", "the opponent gets no response window: the Paragraph resolves on its own, and they can respond with neither a tactic nor an ability", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  assert.throws(() => playRaw(engine, P2, id("p2tac")), "no tactic in response");
  assert.throws(() => activateRaw(engine, P2, id("other"), "peek"), "no ability in response");
  assert.throws(() => activateRaw(engine, P2, id("idol"), "pulse", { selected: { t: [id("mine")] } }), "no ability of an item either");
  assert.equal(zoneOf(engine, id("p2tac")), "hand");
});

clause(SUBSECTION, "0:rule", "control: a response to the opponent's ability by an ordinary tactic can be answered", () => {
  const { engine, id } = s5Board({ extra: [{ key: "ptac", def: tactic({ name: "Plain Reply", cost: 0, behavior: { abilities: [{ id: "p", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } }), owner: P1, zone: "hand" }] });
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("ptac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "an ordinary tactic leaves them room to respond");
  playRaw(engine, P2, id("p2tac"));
  assert.equal(zoneOf(engine, id("p2tac")), "deploying", "their response was accepted");
});

clause(SUBSECTION, "1:ability", "in response to a character's ability: pays 2, the ability has no effect (no damage), and I draw a card", () => {
  const { engine, id } = s5Board();
  const myBefore = ready(engine, P1);
  const theirBefore = ready(engine, P2);
  const top = deck(engine, P1)[0];
  foeUses(engine, id, "guy", "zap");
  assert.equal(theirBefore - ready(engine, P2), 1, "control: zap's cost was paid by them");
  playRaw(engine, P1, id("s5"));
  assert.equal(myBefore - ready(engine, P1), 2, "the printed cost of 2 is paid");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the ability had no effect");
  assert.equal(zoneOf(engine, top), "hand", "I drew the top card");
  assert.equal(zoneOf(engine, id("s5")), "discard", "the tactic is spent");
  assert.equal(engine.state.responseWindow, undefined);
});

clause(SUBSECTION, "1:ability", "control: without the Paragraph the same ability does its 2 damage", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 2);
});

clause(SUBSECTION, "1:ability", "the stopped ability's costs stay paid: their resource is not refunded", () => {
  const { engine, id } = s5Board();
  const before = ready(engine, P2);
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine, P2), 1, "they stay down the resource");
});

clause(SUBSECTION, "1:ability", "I draw exactly ONE card, not two, and the opponent's hand and deck are untouched", () => {
  const { engine, id } = s5Board();
  const [first, second] = deck(engine, P1).slice(0, 2);
  const theirHand = hand(engine, P2).length;
  const theirDeck = deck(engine, P2).length;
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, first), "hand");
  assert.equal(zoneOf(engine, second), "deck");
  assert.equal(hand(engine, P2).length, theirHand);
  assert.equal(deck(engine, P2).length, theirDeck);
});

clause(SUBSECTION, "1:ability", "even an ability that only draws is stopped: their PEEK draws nothing", () => {
  const { engine, id } = s5Board();
  const theirHand = hand(engine, P2).length;
  foeUses(engine, id, "guy", "peek");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(hand(engine, P2).length, theirHand, "no effect: they drew nothing");
  assert.equal(hand(engine, P1).length, 2, "I drew my card: the Noop tactic plus the drawn card (the Paragraph was played)");
});

clause(SUBSECTION, "1:ability", "an item's ability is a legal target (its source was not a faction)", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "idol", "pulse");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the Idol's pulse had no effect");
  assert.equal(zoneOf(engine, id("s5")), "discard");
});

clause(SUBSECTION, "1:ability", "a location's ability is a legal target too", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "shrine", "quake");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the Shrine's quake had no effect");
  assert.equal(zoneOf(engine, id("s5")), "discard");
});

clause(SUBSECTION, "1:ability", "'cannot be used again this turn': the same ability of the same card is refused for the rest of the turn", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  const before = ready(engine, P2);
  assert.throws(() => activateRaw(engine, P2, id("guy"), "zap", { selected: { t: [id("mine")] } }), "locked for this turn");
  assert.equal(ready(engine, P2), before, "nothing was paid by the refused attempt");
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(SUBSECTION, "1:ability", "...and a locked ability is no longer offered as a legal activation (while an unlocked one still is)", () => {
  const { engine, id } = s5Board();
  assert.equal(
    engine.getAvailableActivatedAbilities(P2).some((a) => a.cardId === id("guy") && a.ability.id === "zap"),
    true,
    "control: before the Paragraph, ZAP is offered"
  );
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  const offered = engine.getAvailableActivatedAbilities(P2).filter((a) => a.cardId === id("guy")).map((a) => a.ability.id);
  assert.deepEqual(offered, ["peek"], "only the unlocked PEEK is offered for that card");
});

clause(SUBSECTION, "1:ability", "the lock is on THAT ability only: the same card's other ability, and other cards' abilities, still work", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  const handBefore = hand(engine, P2).length;
  activate(engine, P2, id("guy"), "peek");
  assert.equal(hand(engine, P2).length, handBefore + 1, "the same card's PEEK still works");
  activate(engine, P2, id("other"), "zap", { selected: { t: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2, "a different card's ZAP still works");
  activate(engine, P2, id("idol"), "pulse", { selected: { t: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 3, "an item's ability still works");
});

clause(SUBSECTION, "1:ability", "another copy of the same card is a different card with its own ability: it can still use it this turn", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  activate(engine, P2, id("guy2"), "zap", { selected: { t: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2, "the second Ability Guy is not 'the ability' that was stopped");
});

clause(SUBSECTION, "1:ability", "'this turn': on the opponent's next turn the stopped ability can be used again", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.throws(() => activateRaw(engine, P2, id("guy"), "zap", { selected: { t: [id("mine")] } }), "still this turn");
  endTurn(engine, P2);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "their next turn");
  activate(engine, P2, id("guy"), "zap", { selected: { t: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2, "the lock lasted only through the turn it was played");
});

clause(SUBSECTION, "1:ability", "the ability is locked for everyone for the turn, not just for that activation: even after I end up with a response window of my own, it stays refused", () => {
  const { engine, id } = s5Board();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  playRaw(engine, P2, id("p2char"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  resolvePendingResponses(engine);
  assert.throws(() => activateRaw(engine, P2, id("guy"), "zap", { selected: { t: [id("mine")] } }));
});

clause(SUBSECTION, "1:ability", "ONLY the responded-to ability is stopped: an earlier action lower in the chain still resolves", () => {
  const { engine, id } = s5Board({ active: P1 });
  // my Noop tactic first; they answer with ZAP; I answer the ZAP with the Paragraph
  const handBefore = hand(engine, P1).length;
  playRaw(engine, P1, id("myTac"));
  activateRaw(engine, P2, id("guy"), "zap", { selected: { t: [id("mine")] } });
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the zap was stopped");
  assert.equal(zoneOf(engine, id("myTac")), "discard", "my own tactic resolved afterwards as normal");
  assert.equal(hand(engine, P1).length, handBefore - 2 + 1, "two cards played, one drawn");
});

clause(SUBSECTION, "1:ability", "it works on my own turn too, answering an ability they used in response to my action", () => {
  const { engine, id } = s5Board({ active: P1 });
  playRaw(engine, P1, id("myTac"));
  foeUses(engine, id, "other", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0);
  assert.equal(zoneOf(engine, id("s5")), "discard");
  assert.equal(zoneOf(engine, id("myTac")), "discard");
});

clause(SUBSECTION, "1:ability", "'play this only in response to an ability whose source was not a faction': a faction's ability is refused", () => {
  const { engine, id } = s5Board({ foeFaction: ABILITY_FACTION });
  const foeFaction = engine.state.players[P2].factionId!;
  const before = ready(engine, P1);
  activateRaw(engine, P2, foeFaction, "fdraw");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "control: I can respond to their faction's ability");
  assert.throws(() => playRaw(engine, P1, id("s5")), "its source was a faction");
  assert.equal(zoneOf(engine, id("s5")), "hand");
  assert.equal(ready(engine, P1), before, "nothing was paid");
  // ...and the faction's draw does happen
  const theirHand = hand(engine, P2).length;
  resolvePendingResponses(engine);
  assert.equal(hand(engine, P2).length, theirHand + 1);
});

clause(SUBSECTION, "1:ability", "control: with the same faction on the board, a character's ability is still a legal target", () => {
  const { engine, id } = s5Board({ foeFaction: ABILITY_FACTION });
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(SUBSECTION, "1:ability", "it must be a response to an ABILITY: refused in response to a tactic being played", () => {
  const { engine, id } = s5Board();
  playRaw(engine, P2, id("p2tac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  assert.throws(() => playRaw(engine, P1, id("s5")));
  assert.equal(zoneOf(engine, id("s5")), "hand");
});

clause(SUBSECTION, "1:ability", "...and in response to a character being played", () => {
  const { engine, id } = s5Board();
  playRaw(engine, P2, id("p2char"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  assert.throws(() => playRaw(engine, P1, id("s5")));
  assert.equal(zoneOf(engine, id("s5")), "hand");
  assert.equal(zoneOf(engine, id("p2char")), "deploying", "the character is unaffected");
});

clause(SUBSECTION, "1:ability", "...and with nothing to respond to (my own turn, idle): refused", () => {
  const { engine, id } = s5Board({ active: P1 });
  const before = ready(engine, P1);
  assert.throws(() => playRaw(engine, P1, id("s5")));
  assert.equal(zoneOf(engine, id("s5")), "hand");
  assert.equal(ready(engine, P1), before);
});

clause(SUBSECTION, "1:ability", "I can't respond to my own ability with it (CR 607.1)", () => {
  const { engine, id } = s5Board({ active: P1 });
  activateRaw(engine, P1, id("myGuy"), "zap", { selected: { t: [id("mine")] } });
  assert.throws(() => playRaw(engine, P1, id("s5")));
  assert.equal(zoneOf(engine, id("s5")), "hand");
});

clause(SUBSECTION, "1:ability", "is refused one resource short of its cost of 2, and without [G][G]", () => {
  const short = s5Board({ greed: 1 });
  foeUses(short.engine, short.id, "guy", "zap");
  assert.throws(() => playRaw(short.engine, P1, short.id("s5")));
  assert.equal(zoneOf(short.engine, short.id("s5")), "hand");
  const noThreshold = s5Board({ greed: 1, rage: 6 });
  foeUses(noThreshold.engine, noThreshold.id, "guy", "zap");
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("s5")), "only one [G]");
  const exact = s5Board({ greed: 2 });
  foeUses(exact.engine, exact.id, "guy", "zap");
  playRaw(exact.engine, P1, exact.id("s5"));
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("s5")), "discard", "[G][G] and exactly 2 resources works");
  const mixed = s5Board({ greed: 2, rage: 1 });
  foeUses(mixed.engine, mixed.id, "guy", "zap");
  playRaw(mixed.engine, P1, mixed.id("s5"));
  resolvePendingResponses(mixed.engine);
  assert.equal(zoneOf(mixed.engine, mixed.id("s5")), "discard");
});

clause(SUBSECTION, "1:ability", "with an empty deck the draw finds nothing and nobody loses, but the ability is still stopped and locked", () => {
  const { engine, id } = s5Board({ deckSize: 0 });
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("s5"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0);
  assert.equal(engine.state.winner, undefined);
  assert.throws(() => activateRaw(engine, P2, id("guy"), "zap", { selected: { t: [id("mine")] } }));
});

// =============================================================================
// Tad Disingenuous
// UNDERHANDED DEAL -- COST: Discard a card. -- EFFECT: This turn, this card gains COVERT.
// Character (lawyer, mau), banker, cost 6, threshold [G][G], 4 / 3 / 3.
// =============================================================================

const TAD = "6ff3de61-5058-4ff5-91fd-a44cf03d1a0e";

function tadBoard(opts: { active?: Pid; handCards?: number; deckSize?: number; greed?: number; extra?: CardPlacement[]; tadOwner?: Pid } = {}) {
  const owner = opts.tadOwner ?? P1;
  const foe = otherOf(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    cards: [
      { key: "tad", def: printing(TAD), owner, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 5, speed: 2 }), owner, zone: "play" },
      { key: "plainBlocker", def: character({ name: "Plain Blocker", strength: 1, life: 8, speed: 1 }), owner: foe, zone: "play" },
      { key: "covertBlocker", def: character({ name: "Covert Blocker", strength: 1, life: 8, speed: 1, behavior: { keywords: ["covert"] } }), owner: foe, zone: "play" },
      ...fillers("h", opts.handCards ?? 2, owner, "hand"),
      ...fillers("d", opts.deckSize ?? 4, owner, "deck"),
      ...fillers("e", 2, foe, "hand"),
      ...resources("g", opts.greed ?? 3, owner, "greed"),
      ...(opts.extra ?? [])
    ]
  });
}

const isCovert = (engine: SpoilsEngine, cardId: string) => engine.getKeywords(cardId).includes("covert");

clause(TAD, "0:ability:deal", "COST: discard a card is paid when it is used (before the opponent can respond); nothing else is paid", () => {
  const { engine, id } = tadBoard();
  const before = ready(engine);
  const handBefore = hand(engine, P1).length;
  activateRaw(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  assert.equal(zoneOf(engine, id("h0")), "discard", "the chosen card is discarded as a cost");
  assert.equal(discard(engine, P1).includes(id("h0")), true, "into its owner's discard pile");
  assert.equal(hand(engine, P1).length, handBefore - 1, "exactly one card");
  assert.equal(zoneOf(engine, id("h1")), "hand", "the other hand card stays");
  assert.equal(ready(engine), before, "no resources are paid");
  assert.equal(engine.state.cards[id("tad")].depleted, false, "Tad is not depleted by it");
  assert.equal(isCovert(engine, id("tad")), false, "the EFFECT has not happened while the opponent may respond");
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
  resolvePendingResponses(engine);
  assert.equal(isCovert(engine, id("tad")), true);
});

clause(TAD, "0:ability:deal", "EFFECT: Tad gains COVERT (it genuinely has the keyword); before using it he doesn't have it", () => {
  const { engine, id } = tadBoard();
  assert.equal(isCovert(engine, id("tad")), false, "control: Tad is not covert by himself");
  assert.deepEqual(engine.getKeywords(id("tad")), [], "Tad has no printed keywords");
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  assert.equal(isCovert(engine, id("tad")), true);
});

clause(TAD, "0:ability:deal", "only THIS card gains COVERT: his ally, the opponent's characters and the opponent's covert one are unchanged", () => {
  const { engine, id } = tadBoard();
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  assert.equal(isCovert(engine, id("ally")), false);
  assert.equal(isCovert(engine, id("plainBlocker")), false);
});

clause(TAD, "0:ability:deal", "'any card': any card in hand can be discarded, whatever its type", () => {
  const types: Array<[string, CardDefinition]> = [
    ["character", character({ name: "HC" })],
    ["tactic", tactic({ name: "HT", cost: 2 })],
    ["item", item({ name: "HI" })],
    ["resource", resourceCard({ name: "HR" })]
  ];
  for (const [label, def] of types) {
    const { engine, id } = tadBoard({ extra: [{ key: "odd", def, owner: P1, zone: "hand" }] });
    activate(engine, P1, id("tad"), "deal", { selected: { d: [id("odd")] } });
    assert.equal(zoneOf(engine, id("odd")), "discard", `a ${label} card`);
    assert.equal(isCovert(engine, id("tad")), true, `a ${label} card pays for it`);
  }
});

clause(TAD, "0:ability:deal", "the discard must be a card in your hand: cards in play, discard pile, deck or the opponent's hand are refused, nothing is discarded", () => {
  const { engine, id } = tadBoard({ extra: [{ key: "old", def: character({ name: "Old" }), owner: P1, zone: "discard" }] });
  const attempt = (cardId: string) => () => activateRaw(engine, P1, id("tad"), "deal", { selected: { d: [cardId] } });
  assert.throws(attempt(id("ally")), "a card in play");
  assert.throws(attempt(id("old")), "a card in the discard pile");
  assert.throws(attempt(id("d0")), "a card in the deck");
  assert.throws(attempt(id("e0")), "the opponent's hand");
  assert.throws(attempt(id("tad")), "Tad himself");
  assert.equal(zoneOf(engine, id("e0")), "hand");
  assert.equal(isCovert(engine, id("tad")), false);
  attempt(id("h1"))();
  assert.equal(zoneOf(engine, id("h1")), "discard", "control: a card in your hand is accepted");
});

clause(TAD, "0:ability:deal", "exactly one card: none, or two, is refused", () => {
  const { engine, id } = tadBoard();
  assert.throws(() => activateRaw(engine, P1, id("tad"), "deal", { selected: { d: [] } }));
  assert.throws(() => activateRaw(engine, P1, id("tad"), "deal", {}));
  assert.throws(() => activateRaw(engine, P1, id("tad"), "deal", { selected: { d: [id("h0"), id("h1")] } }));
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(zoneOf(engine, id("h1")), "hand");
  assert.equal(isCovert(engine, id("tad")), false);
});

clause(TAD, "0:ability:deal", "with an empty hand there is nothing to discard: it can't be used and isn't offered", () => {
  const { engine, id } = tadBoard({ handCards: 0 });
  assert.throws(() => activateRaw(engine, P1, id("tad"), "deal", { selected: { d: [] } }));
  assert.equal(isCovert(engine, id("tad")), false);
  assert.equal(engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("tad") && a.ability.id === "deal"), false);
});

clause(TAD, "0:ability:deal", "is offered when there is a card in hand", () => {
  const { engine, id } = tadBoard({ handCards: 1 });
  assert.equal(engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("tad") && a.ability.id === "deal"), true);
});

clause(TAD, "0:ability:deal", "costs no resources: it works with none at all, and with a depleted Tad", () => {
  const { engine, id } = tadBoard({ greed: 0 });
  engine.state.cards[id("tad")].depleted = true;
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  assert.equal(isCovert(engine, id("tad")), true);
  assert.equal(engine.state.cards[id("tad")].depleted, true, "still depleted: it neither needs nor changes that");
});

clause(TAD, "0:ability:deal", "only its controller may use it", () => {
  const { engine, id } = tadBoard();
  assert.throws(() => activateRaw(engine, P2, id("tad"), "deal", { selected: { d: [id("e0")] } }));
  assert.equal(zoneOf(engine, id("e0")), "hand");
  assert.equal(isCovert(engine, id("tad")), false);
});

clause(TAD, "0:ability:deal", "'this turn': COVERT is gone on the next turn (the opponent's) and stays gone on mine", () => {
  const { engine, id } = tadBoard();
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  assert.equal(isCovert(engine, id("tad")), true);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isCovert(engine, id("tad")), false, "ended with the turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isCovert(engine, id("tad")), false);
});

clause(TAD, "0:ability:deal", "using it twice doesn't stack COVERT: a card can't hold two instances (CR 507.3e); both discards are still paid", () => {
  const { engine, id } = tadBoard({ handCards: 3 });
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h1")] } });
  assert.equal(engine.getKeywords(id("tad")).filter((k) => k === "covert").length, 1);
  assert.equal(zoneOf(engine, id("h0")), "discard");
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.equal(zoneOf(engine, id("h2")), "hand");
});

clause(TAD, "0:ability:deal", "with COVERT, attacking alone, Tad can't be blocked by a non-covert character; a covert character can block him", () => {
  const { engine, id } = tadBoard();
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  declareAttackBy(engine, P1, [id("tad")]);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] }), "non-covert can't block a covert party");
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker"), id("covertBlocker")] }), "nor join a covert blocker");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("covertBlocker")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("covertBlocker")], "a covert character may block it");
});

clause(TAD, "0:ability:deal", "control: without the ability a plain character CAN block Tad", () => {
  const { engine, id } = tadBoard();
  declareAttackBy(engine, P1, [id("tad")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("plainBlocker")]);
});

clause(TAD, "0:ability:deal", "the ability can be used in the attack's response window, and then the (now covert) party can't be blocked by non-covert characters", () => {
  const { engine, id } = tadBoard();
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("tad")], target: { type: "faction", playerId: P2 } });
  assert.ok(engine.state.responseWindow, "the attacker holds priority in the declaration window");
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  resolvePendingResponses(engine);
  assert.equal(isCovert(engine, id("tad")), true);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] }), "the party became covert before blockers");
  const before = influence(engine, P2);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), before - 4, "unblocked, Tad hits for his 4");
});

clause(TAD, "0:ability:deal", "a party is covert only if EVERY member is: Tad with COVERT alongside a plain ally can still be blocked by a plain character", () => {
  const { engine, id } = tadBoard();
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  declareAttackBy(engine, P1, [id("tad"), id("ally")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("plainBlocker")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("plainBlocker")]);
});

clause(TAD, "0:ability:deal", "COVERT also limits Tad as a blocker: once he has it he may block only covert parties, so he can't block a plain attacker (a plain ally still can)", () => {
  const { engine, id } = tadBoard({ active: P2 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("plainBlocker")], target: { type: "faction", playerId: P1 } });
  passUntil(engine, P1);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the defender may use abilities before blocking");
  activate(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  assert.equal(isCovert(engine, id("tad")), true);
  assert.ok(battleOf(engine), "the battle is waiting for blockers");
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("tad")] }), "a covert character may block only a covert party");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("ally")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("ally")], "control: a plain character may block it");
});

clause(TAD, "0:ability:deal", "control: a non-covert Tad (no ability used) CAN block a plain attacker", () => {
  const { engine, id } = tadBoard({ active: P2 });
  declareAttackBy(engine, P2, [id("plainBlocker")], { type: "faction", playerId: P1 });
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("tad")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("tad")]);
});

clause(TAD, "0:ability:deal", "the ability can be used on the opponent's turn in response: an opponent's action opens a window, Tad gains COVERT, the discard is paid", () => {
  const { engine, id } = tadBoard({
    active: P2,
    extra: [{ key: "p2tac", def: NOOP_TACTIC("Their Noop"), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P2, id("p2tac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  activateRaw(engine, P1, id("tad"), "deal", { selected: { d: [id("h0")] } });
  resolvePendingResponses(engine);
  assert.equal(isCovert(engine, id("tad")), true);
  assert.equal(zoneOf(engine, id("h0")), "discard");
});

// =============================================================================
// The Garbageman
// This card can attack only once each turn.
// SIFT -- COST: Deplete this card. -- EFFECT: Draw a card. Discard a card.
// RUMMAGE -- COST: Pay 2. Remove 3 cards in your discard pile from the game.
//         -- EFFECT: Restore this card.
// Character (lackey, mau), banker, cost 2, threshold [G][G], 1 / 3 / 3.
// =============================================================================

const GARBAGEMAN = "4fcedeb9-466a-4f77-b3a0-6808cc8e9d31";

function garbageBoard(
  opts: { zone?: "hand" | "play"; depleted?: boolean; handCards?: number; deckSize?: number; discardCards?: number; greed?: number; rage?: number; owner?: Pid; active?: Pid; extra?: CardPlacement[] } = {}
) {
  const owner = opts.owner ?? P1;
  const foe = otherOf(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    cards: [
      { key: "gm", def: printing(GARBAGEMAN), owner, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 5, speed: 2 }), owner, zone: "play", depleted: true },
      { key: "foeChar", def: character({ name: "Foe Char", strength: 1, life: 20, speed: 1 }), owner: foe, zone: "play" },
      ...fillers("h", opts.handCards ?? 2, owner, "hand"),
      ...fillers("d", opts.deckSize ?? 4, owner, "deck"),
      ...fillers("x", opts.discardCards ?? 5, owner, "discard"),
      ...fillers("fx", 4, foe, "discard"),
      ...fillers("fh", 2, foe, "hand"),
      ...resources("g", opts.greed ?? 4, owner, "greed"),
      ...resources("r", opts.rage ?? 0, owner, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

/** Answers the SIFT "discard a card" prompt with `cardId`. */
function siftDiscard(engine: SpoilsEngine, cardId: string) {
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the controller must pick the card to discard");
  assert.equal(pc.playerId, P1);
  pick(engine, [cardId]);
}

clause(GARBAGEMAN, "0:rule", "it can attack once: the first attack is legal and resolves (control)", () => {
  const { engine, id } = garbageBoard();
  assert.ok(engine.getRestrictions(id("gm")).includes("attackOncePerTurn"), "engine.getRestrictions(id(\"gm\")).includes(\"attackOncePerTurn\")");
  const before = influence(engine, P2);
  fight(engine, P1, [id("gm")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(engine, P2), before - 1, "its 1 strength hit the faction");
  assert.equal(engine.state.cards[id("gm")].depleted, true);
});

clause(GARBAGEMAN, "0:rule", "after it has attacked and been restored (RUMMAGE) it still cannot attack again this turn", () => {
  const { engine, id } = garbageBoard();
  fight(engine, P1, [id("gm")], { type: "faction", playerId: P2 }, []);
  activate(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("x2")] } });
  assert.equal(engine.state.cards[id("gm")].depleted, false, "restored by RUMMAGE");
  assert.throws(() => declareAttackBy(engine, P1, [id("gm")]), "it already attacked this turn");
  assert.equal(engine.state.battle, undefined, "no second battle was started");
});

clause(GARBAGEMAN, "0:rule", "control: another character that attacked and was restored CAN attack again the same turn", () => {
  const { engine, id } = garbageBoard({ extra: [{ key: "plain", def: character({ name: "Plain", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" }] });
  fight(engine, P1, [id("plain")], { type: "faction", playerId: P2 }, []);
  engine.state.cards[id("plain")].depleted = false;
  fight(engine, P1, [id("plain")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.cards[id("plain")].depleted, true, "an ordinary character may attack twice with a restore in between");
});

clause(GARBAGEMAN, "0:rule", "attacking in a party counts as its attack for the turn", () => {
  const { engine, id } = garbageBoard({ extra: [{ key: "plain", def: character({ name: "Plain", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" }] });
  fight(engine, P1, [id("gm"), id("plain")], { type: "faction", playerId: P2 }, []);
  engine.state.cards[id("gm")].depleted = false;
  engine.state.cards[id("plain")].depleted = false;
  assert.throws(() => declareAttackBy(engine, P1, [id("gm")]), "alone");
  assert.throws(() => declareAttackBy(engine, P1, [id("gm"), id("plain")]), "in a party");
  assert.equal(engine.state.battle, undefined);
});

clause(GARBAGEMAN, "0:rule", "the limit is per turn: on its controller's next turn it can attack again", () => {
  const { engine, id } = garbageBoard();
  fight(engine, P1, [id("gm")], { type: "faction", playerId: P2 }, []);
  endTurn(engine, P1);
  endTurn(engine, P2);
  const before = influence(engine, P2);
  fight(engine, P1, [id("gm")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(engine, P2), before - 1);
});

clause(GARBAGEMAN, "1:ability:sift", "COST: deplete this card when it is used (before the opponent can respond); nothing else is paid, and the draw waits for the effect", () => {
  const { engine, id } = garbageBoard();
  const top = deck(engine, P1)[0];
  const before = ready(engine);
  activateRaw(engine, P1, id("gm"), "sift");
  assert.equal(engine.state.cards[id("gm")].depleted, true);
  assert.equal(ready(engine), before, "no resources are paid");
  assert.equal(zoneOf(engine, top), "deck", "not drawn yet");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, top), "hand", "EFFECT: draw a card");
  siftDiscard(engine, id("h0"));
});

clause(GARBAGEMAN, "1:ability:sift", "EFFECT: draws the top card, then you discard a card of your choice: hand size is unchanged, the chosen card is in the discard pile", () => {
  const { engine, id } = garbageBoard();
  const top = deck(engine, P1)[0];
  const handBefore = hand(engine, P1).length;
  const deckBefore = deck(engine, P1).length;
  activate(engine, P1, id("gm"), "sift");
  siftDiscard(engine, id("h1"));
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.equal(discard(engine, P1).includes(id("h1")), true);
  assert.equal(zoneOf(engine, id("h0")), "hand", "the other hand card stays");
  assert.equal(zoneOf(engine, top), "hand", "the drawn card stays");
  assert.equal(hand(engine, P1).length, handBefore, "+1 drawn, -1 discarded");
  assert.equal(deck(engine, P1).length, deckBefore - 1, "exactly one card drawn");
});

clause(GARBAGEMAN, "1:ability:sift", "the draw comes FIRST: the card just drawn may itself be the one discarded", () => {
  const { engine, id } = garbageBoard();
  const top = deck(engine, P1)[0];
  activate(engine, P1, id("gm"), "sift");
  siftDiscard(engine, top);
  assert.equal(zoneOf(engine, top), "discard");
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(zoneOf(engine, id("h1")), "hand");
});

clause(GARBAGEMAN, "1:ability:sift", "with an empty hand the freshly drawn card is the only one to discard", () => {
  const { engine, id } = garbageBoard({ handCards: 0 });
  const top = deck(engine, P1)[0];
  activate(engine, P1, id("gm"), "sift");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  siftDiscard(engine, top);
  assert.equal(zoneOf(engine, top), "discard");
  assert.equal(hand(engine, P1).length, 0);
});

clause(GARBAGEMAN, "1:ability:sift", "the discard is chosen by the controller from their own hand; the opponent's cards and cards elsewhere can't be picked", () => {
  const { engine, id } = garbageBoard();
  activate(engine, P1, id("gm"), "sift");
  assert.throws(() => pick(engine, [id("fh0")]), "the opponent's hand");
  assert.throws(() => pick(engine, [id("x0")]), "my discard pile");
  assert.throws(() => pick(engine, [id("ally")]), "a card in play");
  assert.throws(() => pick(engine, [id("d1")]), "a card in my deck");
  assert.ok(pending(engine), "the prompt is still open");
  assert.equal(zoneOf(engine, id("fh0")), "hand");
  siftDiscard(engine, id("h0"));
  assert.equal(zoneOf(engine, id("h0")), "discard", "control: a card in my hand is accepted");
});

clause(GARBAGEMAN, "1:ability:sift", "'Discard a card': exactly one, and it is not optional (picking nothing or two is refused)", () => {
  const { engine, id } = garbageBoard();
  activate(engine, P1, id("gm"), "sift");
  assert.throws(() => pick(engine, []), "nothing");
  assert.throws(() => pick(engine, [id("h0"), id("h1")]), "two cards");
  assert.ok(pending(engine), "still waiting");
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(zoneOf(engine, id("h1")), "hand");
});

clause(GARBAGEMAN, "1:ability:sift", "with an empty deck nothing is drawn but the discard still happens", () => {
  const { engine, id } = garbageBoard({ deckSize: 0 });
  activate(engine, P1, id("gm"), "sift");
  siftDiscard(engine, id("h0"));
  assert.equal(zoneOf(engine, id("h0")), "discard");
  assert.equal(hand(engine, P1).length, 1);
  assert.equal(engine.state.winner, undefined);
});

clause(GARBAGEMAN, "1:ability:sift", "with an empty deck AND an empty hand there is nothing to draw or discard: it completes without trouble", () => {
  const { engine, id } = garbageBoard({ deckSize: 0, handCards: 0 });
  activate(engine, P1, id("gm"), "sift");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("gm")].depleted, true, "the cost was paid");
  assert.equal(engine.state.winner, undefined);
});

clause(GARBAGEMAN, "1:ability:sift", "a depleted Garbageman can't use it: refused, and nothing is drawn", () => {
  const { engine, id } = garbageBoard({ depleted: true });
  const handBefore = hand(engine, P1).length;
  assert.throws(() => activateRaw(engine, P1, id("gm"), "sift"));
  assert.equal(hand(engine, P1).length, handBefore);
  assert.equal(engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("gm") && a.ability.id === "sift"), false);
});

clause(GARBAGEMAN, "1:ability:sift", "once per restore: a second SIFT in the same turn is refused until it is restored", () => {
  const { engine, id } = garbageBoard();
  activate(engine, P1, id("gm"), "sift");
  siftDiscard(engine, id("h0"));
  assert.throws(() => activateRaw(engine, P1, id("gm"), "sift"));
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("gm")].depleted, false);
  activate(engine, P1, id("gm"), "sift");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "usable again");
});

clause(GARBAGEMAN, "1:ability:sift", "it can be used the turn the Garbageman enters play (abilities have no summoning sickness)", () => {
  const { engine, id } = garbageBoard({ zone: "hand" });
  play(engine, P1, id("gm"));
  assert.equal(zoneOf(engine, id("gm")), "play");
  activate(engine, P1, id("gm"), "sift");
  siftDiscard(engine, id("h0"));
  assert.equal(engine.state.cards[id("gm")].depleted, true);
});

clause(GARBAGEMAN, "1:ability:sift", "only its controller may use it", () => {
  const { engine, id } = garbageBoard();
  assert.throws(() => activateRaw(engine, P2, id("gm"), "sift"));
  assert.equal(engine.state.cards[id("gm")].depleted, false);
});

clause(GARBAGEMAN, "1:ability:sift", "the effect resolves as paid even if the Garbageman is destroyed in response: still draw and discard", () => {
  const { engine, id } = garbageBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  const top = deck(engine, P1)[0];
  activateRaw(engine, P1, id("gm"), "sift");
  playRaw(engine, P2, id("kill"), { selected: { t: [id("gm")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gm")), "discard", "destroyed in response");
  assert.equal(zoneOf(engine, top), "hand", "the draw still happened");
  siftDiscard(engine, id("h0"));
  assert.equal(zoneOf(engine, id("h0")), "discard");
});

clause(GARBAGEMAN, "2:ability:rummage", "COST: pay 2 and the three picked cards leave the game as the ability is used (before the opponent can respond); the restore waits", () => {
  const { engine, id } = garbageBoard({ depleted: true });
  const before = ready(engine);
  activateRaw(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("x2")] } });
  assert.equal(before - ready(engine), 2, "pay 2");
  for (const key of ["x0", "x1", "x2"]) {
    assert.equal(zoneOf(engine, id(key)), "removed", `${key} is removed from the game`);
    assert.equal(discard(engine, P1).includes(id(key)), false);
  }
  assert.equal(zoneOf(engine, id("x3")), "discard", "an unpicked card stays");
  assert.equal(zoneOf(engine, id("x4")), "discard");
  assert.equal(engine.state.cards[id("gm")].depleted, true, "not restored yet: that is the EFFECT");
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("gm")].depleted, false, "EFFECT: restore this card");
});

clause(GARBAGEMAN, "2:ability:rummage", "exactly three cards are removed: the opponent's discard pile and the rest of mine are untouched", () => {
  const { engine, id } = garbageBoard({ depleted: true });
  activate(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("x2")] } });
  assert.equal(discard(engine, P1).length, 2);
  assert.equal(discard(engine, P2).length, 4, "the opponent's discard pile is untouched");
  assert.equal(engine.state.players[P1].removed.length, 3);
});

clause(GARBAGEMAN, "2:ability:rummage", "the cards must come from MY discard pile: the opponent's discard pile, my hand, my deck and cards in play are refused, nothing is paid", () => {
  const { engine, id } = garbageBoard({ depleted: true });
  const before = ready(engine);
  const attempt = (cards: string[]) => () => activateRaw(engine, P1, id("gm"), "rummage", { selected: { rfg: cards } });
  assert.throws(attempt([id("fx0"), id("fx1"), id("fx2")]), "the opponent's discard pile");
  assert.throws(attempt([id("x0"), id("x1"), id("fx0")]), "one of the opponent's cards");
  assert.throws(attempt([id("x0"), id("x1"), id("h0")]), "a card in my hand");
  assert.throws(attempt([id("x0"), id("x1"), id("d0")]), "a card in my deck");
  assert.throws(attempt([id("x0"), id("x1"), id("ally")]), "a card in play");
  assert.equal(ready(engine), before, "nothing was paid");
  assert.equal(zoneOf(engine, id("x0")), "discard");
  attempt([id("x0"), id("x1"), id("x2")])();
  assert.equal(zoneOf(engine, id("x0")), "removed", "control: three of my own discarded cards are accepted");
});

clause(GARBAGEMAN, "2:ability:rummage", "exactly three: two, four, none, or the same card twice is refused", () => {
  const { engine, id } = garbageBoard({ depleted: true });
  const attempt = (cards: string[]) => () => activateRaw(engine, P1, id("gm"), "rummage", { selected: { rfg: cards } });
  assert.throws(attempt([id("x0"), id("x1")]), "only two");
  assert.throws(attempt([id("x0"), id("x1"), id("x2"), id("x3")]), "four");
  assert.throws(attempt([]), "none");
  assert.throws(() => activateRaw(engine, P1, id("gm"), "rummage", {}), "no selection at all");
  assert.throws(attempt([id("x0"), id("x0"), id("x1")]), "the same card twice");
  assert.equal(discard(engine, P1).length, 5, "nothing was removed");
  assert.equal(engine.state.cards[id("gm")].depleted, true);
});

clause(GARBAGEMAN, "2:ability:rummage", "with fewer than three cards in my discard pile it can't be used", () => {
  const { engine, id } = garbageBoard({ depleted: true, discardCards: 2 });
  assert.throws(() => activateRaw(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1")] } }));
  assert.throws(() => activateRaw(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("fx0")] } }));
  assert.equal(discard(engine, P1).length, 2);
  assert.equal(engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("gm") && a.ability.id === "rummage"), false);
});

clause(GARBAGEMAN, "2:ability:rummage", "with exactly three cards in my discard pile it works and empties it", () => {
  const { engine, id } = garbageBoard({ depleted: true, discardCards: 3 });
  assert.equal(engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("gm") && a.ability.id === "rummage"), true);
  activate(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("x2")] } });
  assert.equal(discard(engine, P1).length, 0);
  assert.equal(engine.state.cards[id("gm")].depleted, false);
});

clause(GARBAGEMAN, "2:ability:rummage", "is refused one resource short of the pay-2 cost: nothing is removed, nothing is restored", () => {
  const { engine, id } = garbageBoard({ depleted: true, greed: 1 });
  assert.throws(() => activateRaw(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("x2")] } }));
  assert.equal(zoneOf(engine, id("x0")), "discard", "the cards were not removed");
  assert.equal(ready(engine), 1);
  assert.equal(engine.state.cards[id("gm")].depleted, true);
  const exact = garbageBoard({ depleted: true, greed: 2 });
  activate(exact.engine, P1, exact.id("gm"), "rummage", { selected: { rfg: [exact.id("x0"), exact.id("x1"), exact.id("x2")] } });
  assert.equal(exact.engine.state.cards[exact.id("gm")].depleted, false, "exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(GARBAGEMAN, "2:ability:rummage", "needs no resource icons: two resources of any kind pay for it", () => {
  const { engine, id } = garbageBoard({ depleted: true, greed: 0, rage: 2 });
  activate(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("x2")] } });
  assert.equal(engine.state.cards[id("gm")].depleted, false);
});

clause(GARBAGEMAN, "2:ability:rummage", "EFFECT: restores THIS card only: another depleted character stays depleted", () => {
  const { engine, id } = garbageBoard({ depleted: true });
  assert.equal(engine.state.cards[id("ally")].depleted, true);
  activate(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("x2")] } });
  assert.equal(engine.state.cards[id("gm")].depleted, false);
  assert.equal(engine.state.cards[id("ally")].depleted, true);
});

clause(GARBAGEMAN, "2:ability:rummage", "SIFT then RUMMAGE then SIFT: the combination works in one turn (deplete, restore, deplete again)", () => {
  const { engine, id } = garbageBoard();
  activate(engine, P1, id("gm"), "sift");
  siftDiscard(engine, id("h0"));
  assert.equal(engine.state.cards[id("gm")].depleted, true);
  assert.equal(discard(engine, P1).length, 6, "SIFT's discard fed the discard pile");
  activate(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("h0"), id("x0"), id("x1")] } });
  assert.equal(zoneOf(engine, id("h0")), "removed", "the card SIFT discarded can be removed from the game");
  assert.equal(engine.state.cards[id("gm")].depleted, false);
  activate(engine, P1, id("gm"), "sift");
  siftDiscard(engine, id("h1"));
  assert.equal(engine.state.cards[id("gm")].depleted, true);
});

clause(GARBAGEMAN, "2:ability:rummage", "only its controller may use it", () => {
  const { engine, id } = garbageBoard({ depleted: true, extra: resources("p2g", 3, P2, "greed") });
  assert.throws(() => activateRaw(engine, P2, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("x2")] } }));
  assert.throws(() => activateRaw(engine, P2, id("gm"), "rummage", { selected: { rfg: [id("fx0"), id("fx1"), id("fx2")] } }));
  assert.equal(engine.state.cards[id("gm")].depleted, true);
  assert.equal(zoneOf(engine, id("fx0")), "discard");
});

clause(GARBAGEMAN, "2:ability:rummage", "it can be used any number of times if the discard pile and resources allow: two uses remove six cards and cost four resources", () => {
  const { engine, id } = garbageBoard({ depleted: true, discardCards: 6 });
  const before = ready(engine);
  activate(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x0"), id("x1"), id("x2")] } });
  engine.state.cards[id("gm")].depleted = true;
  activate(engine, P1, id("gm"), "rummage", { selected: { rfg: [id("x3"), id("x4"), id("x5")] } });
  assert.equal(before - ready(engine), 4);
  assert.equal(engine.state.players[P1].removed.length, 6);
  assert.equal(engine.state.cards[id("gm")].depleted, false);
});

// =============================================================================
// Writ of Reclamation
// COST: Pick a number for X that is 3 or less. Remove X cards in your discard
// pile from the game. Pick X other cards in your discard pile.
// EFFECT: Shuffle the other cards into your deck. Draw a card.
// Tactic, banker, cost 2, threshold [G][G].
// =============================================================================

const WRIT = "9c1910b5-891f-4b4c-944d-45499fb00e50";

function writBoard(opts: { discardCards?: number; deckSize?: number; greed?: number; rage?: number; active?: Pid; random?: () => number; extra?: CardPlacement[] } = {}) {
  const n = opts.discardCards ?? 8;
  const mixed: CardDefinition[] = [
    character({ name: "Dead Character" }),
    tactic({ name: "Used Tactic", cost: 1 }),
    item({ name: "Broken Item" }),
    resourceCard({ name: "Spent Staple" })
  ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? seeded(),
    cards: [
      { key: "writ", def: printing(WRIT), owner: P1, zone: "hand" },
      { key: "myTac", def: NOOP_TACTIC("My Noop"), owner: P1, zone: "hand" },
      ...Array.from({ length: n }, (_, i) => ({ key: `x${i}`, def: i < mixed.length ? mixed[i] : character({ name: `Dead ${i}` }), owner: P1, zone: "discard" as const })),
      ...fillers("d", opts.deckSize ?? 6, P1, "deck"),
      ...fillers("fx", 4, P2, "discard"),
      ...fillers("fd", 4, P2, "deck"),
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...resources("g", opts.greed ?? 4, P1, "greed"),
      ...resources("r", opts.rage ?? 0, P1, "rage"),
      ...resources("p2g", 4, P2, "greed"),
      ...(opts.extra ?? [])
    ]
  });
}

const writSel = (id: (key: string) => string, removed: string[], others: string[]) => ({ rfg: removed.map(id), others: others.map(id) });

/** Plays the Writ at `x`, removing the cards named in `removed` and picking `others`. */
function playWrit(engine: SpoilsEngine, id: (key: string) => string, x: number, removed: string[], others: string[]) {
  play(engine, P1, id("writ"), { variables: { x }, selected: writSel(id, removed, others) });
}

clause(WRIT, "0:ability", "X=1: pays 2, one card of your discard pile is removed from the game as a COST, one other is picked; then it is shuffled into your deck and a card is drawn", () => {
  const { engine, id } = writBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, ["x0"], ["x1"]) });
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(zoneOf(engine, id("x0")), "removed", "COST: removed from the game when the tactic is played");
  assert.equal(engine.state.players[P1].removed.includes(id("x0")), true);
  assert.equal(zoneOf(engine, id("x1")), "discard", "the picked 'other' card stays in the discard pile until the effect");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.notEqual(zoneOf(engine, id("x1")), "discard", "EFFECT: shuffled into the deck (and maybe the card drawn)");
  assert.equal(["deck", "hand"].includes(zoneOf(engine, id("x1"))), true);
  assert.equal(zoneOf(engine, id("writ")), "discard", "the tactic is spent");
});

for (const x of [1, 2, 3]) {
  clause(WRIT, "0:ability", `X=${x}: exactly ${x} card(s) leave the game, ${x} other card(s) go back into the deck, exactly one card is drawn`, () => {
    const { engine, id } = writBoard();
    const removed = Array.from({ length: x }, (_, i) => `x${i}`);
    const others = Array.from({ length: x }, (_, i) => `x${i + 3}`);
    const untouched = ["x6", "x7"];
    const discardBefore = discard(engine, P1).length;
    const deckBefore = deck(engine, P1).length;
    const handBefore = hand(engine, P1).length;
    playWrit(engine, id, x, removed, others);
    for (const key of removed) assert.equal(zoneOf(engine, id(key)), "removed", `${key} removed from the game`);
    for (const key of untouched) assert.equal(zoneOf(engine, id(key)), "discard", `${key} was not picked`);
    for (const key of others) assert.equal(["deck", "hand"].includes(zoneOf(engine, id(key))), true, `${key} was shuffled into the deck (or drawn)`);
    assert.equal(discard(engine, P1).length, discardBefore - 2 * x + 1, "X removed, X shuffled away, and the spent Writ added");
    assert.equal(deck(engine, P1).length, deckBefore + x - 1, "X shuffled in, one drawn");
    assert.equal(hand(engine, P1).length, handBefore - 1 + 1, "the Writ was played; one card drawn");
  });
}

clause(WRIT, "0:ability", "X=0: nothing is removed or shuffled in, but a card is still drawn", () => {
  const { engine, id } = writBoard();
  const discardBefore = discard(engine, P1).length;
  const handBefore = hand(engine, P1).length;
  playWrit(engine, id, 0, [], []);
  assert.equal(engine.state.players[P1].removed.length, 0);
  assert.equal(discard(engine, P1).length, discardBefore + 1, "only the spent Writ joined the discard pile");
  assert.equal(deck(engine, P1).length, 5, "one card drawn from the 6-card deck");
  assert.equal(hand(engine, P1).length, handBefore, "the Writ left the hand, one card was drawn");
});

clause(WRIT, "0:ability", "...at X=0 the drawn card is the top of the deck (no shuffle has put anything in)", () => {
  const { engine, id } = writBoard({ random: () => 0 });
  const top = deck(engine, P1)[0];
  playWrit(engine, id, 0, [], []);
  assert.equal(zoneOf(engine, top), "hand");
});

clause(WRIT, "0:ability", "X=0 shuffles no cards into the deck, so the deck is not shuffled (CR 313.2: you only shuffle if more than 0 cards are added)", () => {
  const rotating = writBoard({ random: () => 0 });
  const identity = writBoard({ random: () => 0.9999999 });
  playWrit(rotating.engine, rotating.id, 0, [], []);
  playWrit(identity.engine, identity.id, 0, [], []);
  assert.deepEqual(
    deck(rotating.engine, P1).map((c) => rotating.engine.getDefinition(c).name),
    deck(identity.engine, P1).map((c) => identity.engine.getDefinition(c).name),
    "the deck order must not depend on the random source: no shuffle happened"
  );
});

clause(WRIT, "0:ability", "with X cards shuffled in, the deck IS shuffled afterwards (the order depends on the random source)", () => {
  const rotating = writBoard({ random: () => 0 });
  const identity = writBoard({ random: () => 0.9999999 });
  playWrit(rotating.engine, rotating.id, 2, ["x0", "x1"], ["x4", "x5"]);
  playWrit(identity.engine, identity.id, 2, ["x0", "x1"], ["x4", "x5"]);
  const names = (g: typeof rotating) => deck(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  const everything = (g: typeof rotating) => [...names(g), ...hand(g.engine, P1).map((c) => g.engine.getDefinition(c).name)].sort();
  assert.deepEqual(everything(rotating), everything(identity), "same cards between deck and hand");
  assert.notDeepEqual(names(rotating), names(identity), "...but the deck order depends on the random source: the deck was shuffled");
});

clause(WRIT, "0:ability", "the draw comes AFTER the shuffle: with an empty deck and X=1 the card drawn is the one just shuffled in", () => {
  const { engine, id } = writBoard({ deckSize: 0 });
  assert.equal(deck(engine, P1).length, 0);
  playWrit(engine, id, 1, ["x0"], ["x1"]);
  assert.equal(zoneOf(engine, id("x1")), "hand", "shuffled into the (empty) deck, then drawn");
  assert.equal(deck(engine, P1).length, 0);
});

clause(WRIT, "0:ability", "with an empty deck and X=0 there is nothing to draw, nobody loses, and the tactic still resolves", () => {
  const { engine, id } = writBoard({ deckSize: 0 });
  const handBefore = hand(engine, P1).length;
  playWrit(engine, id, 0, [], []);
  assert.equal(hand(engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(engine, id("writ")), "discard");
  assert.equal(engine.state.winner, undefined);
});

clause(WRIT, "0:ability", "'any card': the removed cards can be any type (character, tactic, item, resource) and so can the picked others", () => {
  const { engine, id } = writBoard();
  playWrit(engine, id, 3, ["x0", "x1", "x2"], ["x3", "x4", "x5"]);
  for (const key of ["x0", "x1", "x2"]) assert.equal(zoneOf(engine, id(key)), "removed", key);
  assert.equal(["deck", "hand"].includes(zoneOf(engine, id("x3"))), true, "a resource card went back to the deck");
});

clause(WRIT, "0:ability", "X is at most 3: X=4 is refused (nothing is paid or removed), X=3 is accepted", () => {
  const { engine, id } = writBoard();
  const before = ready(engine);
  assert.throws(() => playRaw(engine, P1, id("writ"), { variables: { x: 4 }, selected: writSel(id, ["x0", "x1", "x2", "x3"], ["x4", "x5", "x6", "x7"]) }));
  assert.equal(ready(engine), before);
  assert.equal(zoneOf(engine, id("x0")), "discard");
  assert.equal(zoneOf(engine, id("writ")), "hand");
  playWrit(engine, id, 3, ["x0", "x1", "x2"], ["x3", "x4", "x5"]);
  assert.equal(zoneOf(engine, id("x0")), "removed");
});

clause(WRIT, "0:ability", "X can't be negative", () => {
  const { engine, id } = writBoard();
  assert.throws(() => playRaw(engine, P1, id("writ"), { variables: { x: -1 }, selected: writSel(id, [], []) }));
  assert.equal(zoneOf(engine, id("writ")), "hand");
});

clause(WRIT, "0:ability", "X must be a whole number (CR 410.2): X=1.5 is refused", () => {
  const { engine, id } = writBoard();
  assert.throws(() => playRaw(engine, P1, id("writ"), { variables: { x: 1.5 }, selected: writSel(id, ["x0"], ["x1"]) }));
  assert.equal(zoneOf(engine, id("writ")), "hand", "a refused play leaves the card in hand");
  assert.equal(zoneOf(engine, id("x0")), "discard");
});

clause(WRIT, "0:ability", "exactly X cards are removed: fewer or more than X is refused", () => {
  const { engine, id } = writBoard();
  const attempt = (x: number, removed: string[], others: string[]) => () => playRaw(engine, P1, id("writ"), { variables: { x }, selected: writSel(id, removed, others) });
  assert.throws(attempt(2, ["x0"], ["x2", "x3"]), "X=2 but one removed");
  assert.throws(attempt(1, ["x0", "x1"], ["x2"]), "X=1 but two removed");
  assert.throws(attempt(1, [], ["x2"]), "X=1 but none removed");
  assert.equal(zoneOf(engine, id("x0")), "discard");
  assert.equal(zoneOf(engine, id("writ")), "hand");
});

clause(WRIT, "0:ability", "exactly X other cards are picked: fewer or more than X is refused", () => {
  const { engine, id } = writBoard();
  const attempt = (x: number, removed: string[], others: string[]) => () => playRaw(engine, P1, id("writ"), { variables: { x }, selected: writSel(id, removed, others) });
  assert.throws(attempt(2, ["x0", "x1"], ["x2"]), "X=2 but one other");
  assert.throws(attempt(1, ["x0"], ["x2", "x3"]), "X=1 but two others");
  assert.throws(attempt(1, ["x0"], []), "X=1 but no other");
  assert.equal(zoneOf(engine, id("x0")), "discard");
});

clause(WRIT, "0:ability", "the others must be OTHER cards: a card can't be both removed and picked to be shuffled in", () => {
  const { engine, id } = writBoard();
  const before = ready(engine);
  assert.throws(() => playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, ["x0"], ["x0"]) }), "the same card twice");
  assert.throws(() => playRaw(engine, P1, id("writ"), { variables: { x: 2 }, selected: writSel(id, ["x0", "x1"], ["x1", "x2"]) }), "overlap");
  assert.equal(ready(engine), before);
  assert.equal(zoneOf(engine, id("x0")), "discard");
});

clause(WRIT, "0:ability", "both groups come from YOUR discard pile: the opponent's discarded cards, and cards in your hand, deck or in play, are refused", () => {
  const { engine, id } = writBoard();
  const attempt = (removed: string[], others: string[]) => () => playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, removed, others) });
  assert.throws(attempt(["fx0"], ["x1"]), "removing the opponent's card");
  assert.throws(attempt(["x0"], ["fx0"]), "shuffling the opponent's card into my deck");
  assert.throws(attempt(["myTac"], ["x1"]), "removing a card from my hand");
  assert.throws(attempt(["x0"], ["myTac"]), "picking a card from my hand");
  assert.throws(attempt(["d0"], ["x1"]), "removing a card from my deck");
  assert.throws(attempt(["x0"], ["ally"]), "picking a card in play");
  assert.equal(zoneOf(engine, id("fx0")), "discard", "the opponent's discard pile is intact");
  assert.equal(zoneOf(engine, id("x0")), "discard");
  assert.equal(zoneOf(engine, id("writ")), "hand");
  playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, ["x0"], ["x1"]) });
  assert.ok(engine.state.responseWindow, "control: my own discarded cards are accepted");
});

clause(WRIT, "0:ability", "the opponent's discard pile, hand and deck are untouched by a successful play", () => {
  const { engine, id } = writBoard();
  const theirDiscard = discard(engine, P2).length;
  const theirDeck = deck(engine, P2).length;
  const theirHand = hand(engine, P2).length;
  playWrit(engine, id, 2, ["x0", "x1"], ["x2", "x3"]);
  assert.equal(discard(engine, P2).length, theirDiscard);
  assert.equal(deck(engine, P2).length, theirDeck);
  assert.equal(hand(engine, P2).length, theirHand);
});

clause(WRIT, "0:ability", "there must be enough cards: X=3 needs 6 cards in the discard pile (3 removed + 3 others); with 5 it is refused", () => {
  const { engine, id } = writBoard({ discardCards: 5 });
  assert.throws(() => playRaw(engine, P1, id("writ"), { variables: { x: 3 }, selected: writSel(id, ["x0", "x1", "x2"], ["x3", "x4"]) }));
  assert.throws(() => playRaw(engine, P1, id("writ"), { variables: { x: 3 }, selected: writSel(id, ["x0", "x1", "x2"], ["x3", "x4", "x4"]) }));
  assert.equal(zoneOf(engine, id("x0")), "discard");
  playWrit(engine, id, 2, ["x0", "x1"], ["x2", "x3"]);
  assert.equal(zoneOf(engine, id("x0")), "removed", "control: X=2 needs only 4 cards");
  const six = writBoard({ discardCards: 6 });
  playWrit(six.engine, six.id, 3, ["x0", "x1", "x2"], ["x3", "x4", "x5"]);
  assert.equal(zoneOf(six.engine, six.id("x0")), "removed", "exactly 6 cards is enough for X=3");
});

clause(WRIT, "0:ability", "with an empty discard pile only X=0 is possible", () => {
  const { engine, id } = writBoard({ discardCards: 0 });
  assert.throws(() => playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, [], []) }));
  assert.equal(zoneOf(engine, id("writ")), "hand");
  playWrit(engine, id, 0, [], []);
  assert.equal(zoneOf(engine, id("writ")), "discard", "control: X=0 still works");
});

clause(WRIT, "0:ability", "is refused one resource short of its cost of 2, and without [G][G]; X does not change the price", () => {
  const short = writBoard({ greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("writ"), { variables: { x: 1 }, selected: writSel(short.id, ["x0"], ["x1"]) }));
  assert.equal(zoneOf(short.engine, short.id("x0")), "discard", "nothing was removed");
  assert.equal(zoneOf(short.engine, short.id("writ")), "hand");
  const noThreshold = writBoard({ greed: 1, rage: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("writ"), { variables: { x: 1 }, selected: writSel(noThreshold.id, ["x0"], ["x1"]) }), "only one [G]");
  for (const x of [0, 3]) {
    const exact = writBoard({ greed: 2 });
    const removed = Array.from({ length: x }, (_, i) => `x${i}`);
    const others = Array.from({ length: x }, (_, i) => `x${i + 3}`);
    playWrit(exact.engine, exact.id, x, removed, others);
    assert.equal(zoneOf(exact.engine, exact.id("writ")), "discard", `X=${x} with exactly 2 resources`);
    assert.equal(ready(exact.engine), 0, `X=${x} still costs just 2`);
  }
});

clause(WRIT, "0:ability", "a tactic: it can be played in response on the opponent's turn", () => {
  const { engine, id } = writBoard({
    active: P2,
    extra: [{ key: "p2tac", def: NOOP_TACTIC("Their Noop"), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P2, id("p2tac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("writ"), { variables: { x: 1 }, selected: writSel(id, ["x0"], ["x1"]) });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("x0")), "removed");
  assert.equal(zoneOf(engine, id("writ")), "discard");
});

clause(WRIT, "0:ability", "the others are chosen as a cost, so the opponent can respond knowing them; a card they remove from the game in response stays removed (CR 402.4) while the rest is shuffled in", () => {
  const exile = tactic({
    name: "Exile One",
    cost: 0,
    behavior: {
      abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "discard" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }]
    }
  });
  const { engine, id } = writBoard({ extra: [{ key: "exile", def: exile, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("writ"), { variables: { x: 2 }, selected: writSel(id, ["x0", "x1"], ["x2", "x3"]) });
  playRaw(engine, P2, id("exile"), { selected: { t: [id("x2")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("x2")), "removed", "control: the response exiled one of the picked cards");
  assert.equal(["deck", "hand"].includes(zoneOf(engine, id("x3"))), true, "the other picked card was still shuffled in");
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(engine.state.pendingChoice, undefined);
});

// =============================================================================
// 0p3r4710n 1337 H4x0rz
// COST: Play this only during your turn.
// EFFECT: You may play up to 4 non-tactic cards for free. (You still need the
// proper resource icons and must pay any additional costs.)
// Tactic, gearsmith, cost 12, threshold [E][E][E][E].
// =============================================================================

const LEET = "45a1bfe0-f338-454c-b3ee-7dc5b6b55235";

type FreePick = { card?: string; selected?: Record<string, string[]> };

function leetBoard(opts: { elitism?: number; greed?: number; rage?: number; deception?: number; active?: Pid; hand?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "leet", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "c1", def: character({ name: "Big Five", cost: 5, strength: 3, life: 3 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "Mid Three", cost: 3, strength: 2, life: 2 }), owner: P1, zone: "hand" },
      { key: "i3", def: item({ name: "Gadget Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "l4", def: location({ name: "Place Four", cost: 4, structure: 3 }), owner: P1, zone: "hand" },
      { key: "c6", def: character({ name: "Dear Six", cost: 6, strength: 4, life: 4 }), owner: P1, zone: "hand" },
      { key: "t1", def: tactic({ name: "Hand Tactic One", cost: 1 }), owner: P1, zone: "hand" },
      { key: "t2", def: tactic({ name: "Hand Tactic Two", cost: 1 }), owner: P1, zone: "hand" },
      ...(opts.hand ?? []),
      { key: "old", def: character({ name: "In The Discard", cost: 1 }), owner: P1, zone: "discard" },
      { key: "indeck", def: character({ name: "In The Deck", cost: 1 }), owner: P1, zone: "deck" },
      { key: "theirs", def: character({ name: "Their Card", cost: 1 }), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "On Table" }), owner: P1, zone: "play" },
      ...resources("e", opts.elitism ?? 4, P1, "elitism"),
      ...resources("g", opts.greed ?? 0, P1, "greed"),
      ...resources("r", opts.rage ?? 8, P1, "rage"),
      ...resources("dc", opts.deception ?? 0, P1, "deception"),
      ...resources("p2g", 4, P2, "greed"),
      ...(opts.extra ?? [])
    ]
  });
}

/** The cards currently offered by the open "play for free" prompt, by key (unknown ids are returned as-is). */
function freeCandidates(engine: SpoilsEngine, id: (key: string) => string, keys: string[]): string[] {
  const pc = pending(engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "deployForFree", "the caster is asked whether to play a card for free");
  return keys.filter((key) => pc.candidates.includes(id(key)));
}

function answerFree(engine: SpoilsEngine, id: (key: string) => string, pickKey?: string, selected?: Record<string, string[]>) {
  const pc = pending(engine);
  assert.equal(pc?.kind, "deployForFree");
  assert.equal(pc.playerId, P1, "the caster decides");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: pickKey ? id(pickKey) : undefined, selected } } as never);
  resolvePendingResponses(engine);
}

/** Plays the tactic and answers each free-play prompt with the next entry of `picks` (undefined = decline); returns how many prompts were asked. */
function runLeet(engine: SpoilsEngine, id: (key: string) => string, picks: Array<string | FreePick | undefined>): number {
  play(engine, P1, id("leet"));
  let asked = 0;
  while (pending(engine)?.kind === "deployForFree" && asked < 10) {
    const next = picks[asked++];
    const pick: FreePick = typeof next === "string" ? { card: next } : next ?? {};
    answerFree(engine, id, pick.card, pick.selected);
  }
  return asked;
}

clause(LEET, "0:ability", "pays 12 to play; with exactly 12 resources (four of them [E]) all are spent and the tactic is spent", () => {
  const { engine, id } = leetBoard();
  assert.equal(ready(engine), 12);
  const asked = runLeet(engine, id, []);
  assert.equal(ready(engine), 0, "the printed cost of 12 was paid");
  assert.equal(zoneOf(engine, id("leet")), "discard");
  assert.ok(asked >= 1, "control: the free-play prompt appeared");
});

clause(LEET, "0:ability", "is refused one resource short of its cost of 12, and without [E][E][E][E] (plenty of other resources)", () => {
  const short = leetBoard({ elitism: 4, rage: 7 });
  assert.equal(ready(short.engine), 11);
  assert.throws(() => playRaw(short.engine, P1, short.id("leet")));
  assert.equal(zoneOf(short.engine, short.id("leet")), "hand");
  const noThreshold = leetBoard({ elitism: 3, rage: 12 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("leet")), "only three [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("leet")), "hand");
  const exact = leetBoard({ elitism: 4, rage: 8 });
  playRaw(exact.engine, P1, exact.id("leet"));
  assert.equal(ready(exact.engine), 0);
  const plenty = leetBoard({ elitism: 5, rage: 10 });
  playRaw(plenty.engine, P1, plenty.id("leet"));
  assert.equal(ready(plenty.engine), 3, "only 12 of 15 are spent");
});

clause(LEET, "0:ability", "'Play this only during your turn': refused in response on the opponent's turn, accepted on mine", () => {
  const react = leetBoard({
    active: P2,
    extra: [{ key: "p2tac", def: NOOP_TACTIC("Their Noop"), owner: P2, zone: "hand" }]
  });
  playRaw(react.engine, P2, react.id("p2tac"));
  assert.equal(react.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  const before = ready(react.engine);
  assert.throws(() => playRaw(react.engine, P1, react.id("leet")), "not my turn");
  assert.equal(zoneOf(react.engine, react.id("leet")), "hand");
  assert.equal(ready(react.engine), before, "nothing was paid");
  const mine = leetBoard();
  playRaw(mine.engine, P1, mine.id("leet"));
  assert.equal(ready(mine.engine), 0, "control: on my own turn it is played");
});

clause(LEET, "0:ability", "during my own turn it can also be played in response (to an ability the opponent used against my action)", () => {
  const { engine, id } = leetBoard({ extra: [{ key: "myTac", def: NOOP_TACTIC("My Noop"), owner: P1, zone: "hand" }, { key: "foeGuy", def: abilityGuy("Foe Guy"), owner: P2, zone: "play" }] });
  playRaw(engine, P1, id("myTac"));
  activateRaw(engine, P2, id("foeGuy"), "peek");
  playRaw(engine, P1, id("leet"));
  assert.equal(zoneOf(engine, id("leet")), "deploying");
});

clause(LEET, "0:ability", "EFFECT: you may play up to four non-tactic cards for free: four chosen cards enter play and cost no resources", () => {
  const { engine, id } = leetBoard();
  const asked = runLeet(engine, id, ["c1", "c2", "i3", "l4"]);
  for (const key of ["c1", "c2", "i3", "l4"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} is in play`);
  assert.equal(zoneOf(engine, id("c6")), "hand", "a fifth card was not played");
  assert.equal(asked, 4, "exactly four prompts");
  assert.equal(ready(engine), 0, "after paying 12, the 5+3+2+4 numeric cost of the cards cost nothing");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(LEET, "0:ability", "'up to 4': at most four cards, even with more eligible cards in hand (a fifth is never offered)", () => {
  const { engine, id } = leetBoard();
  const asked = runLeet(engine, id, ["c1", "c2", "i3", "l4", "c6"]);
  assert.equal(asked, 4);
  assert.equal(zoneOf(engine, id("c6")), "hand");
  assert.equal(engine.state.pendingChoice, undefined, "no fifth prompt");
});

clause(LEET, "0:ability", "'up to': one, two or three cards are fine, and the rest stay in hand", () => {
  for (const count of [1, 2, 3]) {
    const { engine, id } = leetBoard();
    const keys = ["c1", "c2", "i3"].slice(0, count);
    runLeet(engine, id, keys);
    for (const key of keys) assert.equal(zoneOf(engine, id(key)), "play", `${key} (of ${count})`);
    for (const key of ["c1", "c2", "i3", "l4", "c6"].filter((k) => !keys.includes(k))) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand (of ${count})`);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(ready(engine), 0);
  }
});

clause(LEET, "0:ability", "'you may': declining plays nothing; the 12 are still spent and the tactic is spent", () => {
  const { engine, id } = leetBoard();
  runLeet(engine, id, []);
  for (const key of ["c1", "c2", "i3", "l4", "c6"]) assert.equal(zoneOf(engine, id(key)), "hand", key);
  assert.equal(zoneOf(engine, id("leet")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(LEET, "0:ability", "the cards played for free enter play under my control, from my hand (they leave it)", () => {
  const { engine, id } = leetBoard();
  const handBefore = hand(engine, P1).length;
  runLeet(engine, id, ["c1", "c2"]);
  assert.equal(engine.state.cards[id("c1")].controllerId, P1);
  assert.equal(engine.state.players[P1].play.includes(id("c1")), true);
  assert.equal(hand(engine, P1).includes(id("c1")), false);
  assert.equal(hand(engine, P1).length, handBefore - 1 - 2, "the tactic and the two cards left the hand");
});

clause(LEET, "0:ability", "NON-tactic only: tactics in hand are not offered and can't be chosen", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  const offered = freeCandidates(engine, id, ["c1", "c2", "i3", "l4", "c6", "t1", "t2"]);
  assert.deepEqual(offered.sort(), ["c1", "c2", "c6", "i3", "l4"], "characters, items and locations are offered; tactics are not");
  assert.throws(() => answerFree(engine, id, "t1"), "a tactic");
  assert.equal(zoneOf(engine, id("t1")), "hand");
  answerFree(engine, id, "c2");
  assert.equal(zoneOf(engine, id("c2")), "play", "control: a non-tactic card is accepted");
});

clause(LEET, "0:ability", "characters, items and locations can each be played: a character, an item and a location enter play", () => {
  const { engine, id } = leetBoard();
  runLeet(engine, id, ["c2", "i3", "l4"]);
  assert.equal(engine.getCardTypes(id("c2")).includes("character"), true);
  assert.equal(zoneOf(engine, id("c2")), "play");
  assert.equal(zoneOf(engine, id("i3")), "play");
  assert.equal(zoneOf(engine, id("l4")), "play");
});

clause(LEET, "0:ability", "only cards in MY HAND are played: the discard pile, the deck, the opponent's hand and cards already in play can't be chosen", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  for (const key of ["old", "indeck", "theirs", "mine"]) assert.throws(() => answerFree(engine, id, key), key);
  assert.equal(zoneOf(engine, id("old")), "discard");
  assert.equal(zoneOf(engine, id("indeck")), "deck");
  assert.equal(zoneOf(engine, id("theirs")), "hand");
  assert.ok(pending(engine), "the prompt is still open");
  answerFree(engine, id, "c1");
  assert.equal(zoneOf(engine, id("c1")), "play");
});

clause(LEET, "0:ability", "the same card can't be played twice (once it is in play it's no longer an option)", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("leet"));
  answerFree(engine, id, "c1");
  assert.throws(() => answerFree(engine, id, "c1"), "already in play");
  assert.deepEqual(freeCandidates(engine, id, ["c1", "c2"]), ["c2"]);
});

clause(LEET, "0:ability", "'for free': a high-cost card (cost 6) is played with no resources spent", () => {
  const { engine, id } = leetBoard({ elitism: 4, rage: 9 });
  const afterCost = 13 - 12;
  runLeet(engine, id, ["c6"]);
  assert.equal(zoneOf(engine, id("c6")), "play");
  assert.equal(ready(engine), afterCost, "only the tactic's own 12 was paid; the 6-cost card was free");
});

clause(LEET, "0:ability", "'you still need the proper resource icons': a card whose threshold I don't meet is refused; one I do meet is played", () => {
  const needRage = character({ name: "Needs Rage", cost: 1, threshold: "rr" as never });
  const needGreed = character({ name: "Needs Greed", cost: 1, threshold: "gg" as never });
  const { engine, id } = leetBoard({ greed: 2, rage: 0, deception: 6, elitism: 4, hand: [{ key: "nr", def: needRage, owner: P1, zone: "hand" }, { key: "ng", def: needGreed, owner: P1, zone: "hand" }] });
  assert.equal(ready(engine), 12);
  play(engine, P1, id("leet"));
  assert.throws(() => answerFree(engine, id, "nr"), "no [R] icons");
  assert.equal(zoneOf(engine, id("nr")), "hand");
  answerFree(engine, id, "ng");
  assert.equal(zoneOf(engine, id("ng")), "play", "control: [G][G] is met");
});

clause(LEET, "0:ability", "...with the right icons a [R][R] card is played for free too", () => {
  const needRage = character({ name: "Needs Rage", cost: 4, threshold: "rr" as never });
  const { engine, id } = leetBoard({ elitism: 4, rage: 8, hand: [{ key: "nr", def: needRage, owner: P1, zone: "hand" }] });
  runLeet(engine, id, ["nr"]);
  assert.equal(zoneOf(engine, id("nr")), "play");
});

clause(LEET, "0:ability", "'must pay any additional costs': a card with an extra 'pay 2' cost still costs 2 even though its numeric cost is free", () => {
  const costly = character({ name: "Costly Entry", cost: 5, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }], effects: [] } } });
  const { engine, id } = leetBoard({ elitism: 4, rage: 10, hand: [{ key: "costly", def: costly, owner: P1, zone: "hand" }] });
  assert.equal(ready(engine), 14);
  play(engine, P1, id("leet"));
  assert.equal(ready(engine), 2, "after the tactic's 12");
  answerFree(engine, id, "costly");
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("costly")), "play");
  assert.equal(ready(engine), 0, "the additional cost of 2 was paid; only the numeric cost 5 was free");
});

clause(LEET, "0:ability", "...and a card whose extra cost I can't pay can't be played for free", () => {
  const costly = character({ name: "Costly Entry", cost: 5, behavior: { onPlay: { costs: [{ type: "payResources", amount: 2 }], effects: [] } } });
  const { engine, id } = leetBoard({ elitism: 4, rage: 8, hand: [{ key: "costly", def: costly, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  assert.equal(ready(engine), 0);
  assert.throws(() => answerFree(engine, id, "costly"), "no resources left for the extra 'pay 2'");
  assert.equal(zoneOf(engine, id("costly")), "hand");
});

clause(LEET, "0:ability", "...other extra costs are paid too: a card with 'discard a card' as an extra cost makes me discard the chosen card, and is refused without one", () => {
  const discardy = character({ name: "Discarding Entry", cost: 3, behavior: { onPlay: { costs: [{ type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }], effects: [] } } });
  const { engine, id } = leetBoard({ hand: [{ key: "disc", def: discardy, owner: P1, zone: "hand" }] });
  play(engine, P1, id("leet"));
  assert.throws(() => answerFree(engine, id, "disc"), "the discard was not chosen");
  assert.equal(zoneOf(engine, id("disc")), "hand");
  answerFree(engine, id, "disc", { d: [id("c6")] });
  assert.equal(zoneOf(engine, id("disc")), "play");
  assert.equal(zoneOf(engine, id("c6")), "discard", "the extra cost was paid: c6 was discarded");
});

clause(LEET, "0:ability", "played cards really ENTER play: their 'when this enters play' triggers fire (a free Prudent Thug costs 3 influence, a free Randolph draws a card)", () => {
  const { engine, id } = leetBoard({
    elitism: 4,
    greed: 4,
    rage: 4,
    hand: [
      { key: "thug", def: printing(THUG), owner: P1, zone: "hand" },
      { key: "rand", def: printing(RANDOLPH), owner: P1, zone: "hand" }
    ],
    extra: fillers("d", 3, P1, "deck")
  });
  const influenceBefore = influence(engine, P1);
  const deckBefore = deck(engine, P1).length;
  runLeet(engine, id, ["thug", "rand"]);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("thug")), "play");
  assert.equal(zoneOf(engine, id("rand")), "play");
  assert.equal(influence(engine, P1), influenceBefore - 3, "the Thug's enters-play loss happened");
  assert.equal(deck(engine, P1).length, deckBefore - 1, "Randolph's enters-play draw happened");
  assert.equal(ready(engine), 0, "the Thug (5) and Randolph (4) were free");
});

clause(LEET, "0:ability", "an ATTACH TO card played for free attaches to the host I pick (Smear Campaign on the opponent's character)", () => {
  const { engine, id } = leetBoard({
    greed: 1,
    hand: [{ key: "smear", def: printing(SMEAR), owner: P1, zone: "hand" }],
    extra: [{ key: "foeChar", def: character({ name: "Foe Char" }), owner: P2, zone: "play" }]
  });
  runLeet(engine, id, [{ card: "smear", selected: { attachTo: [id("foeChar")] } }]);
  assert.equal(zoneOf(engine, id("smear")), "play");
  assert.equal(engine.state.cards[id("smear")].attachedTo, id("foeChar"));
});

clause(LEET, "0:ability", "the tactic is spent: it ends in my discard pile once the free plays are done", () => {
  const { engine, id } = leetBoard();
  runLeet(engine, id, ["c1"]);
  assert.equal(zoneOf(engine, id("leet")), "discard");
  assert.equal(discard(engine, P1).includes(id("leet")), true);
});

clause(LEET, "0:ability", "with only two eligible cards in hand, those two can be played and the game does not get stuck on the other prompts", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "leet", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A", cost: 2 }), owner: P1, zone: "hand" },
      { key: "b", def: item({ name: "B", cost: 2 }), owner: P1, zone: "hand" },
      ...resources("e", 4, P1, "elitism"),
      ...resources("r", 8, P1, "rage")
    ]
  });
  runLeet(engine, id, ["a", "b"]);
  assert.equal(zoneOf(engine, id("a")), "play");
  assert.equal(zoneOf(engine, id("b")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.responseWindow, undefined);
});

clause(LEET, "0:ability", "with no non-tactic card in hand nothing can be played and the tactic still resolves", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "leet", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "t1", def: tactic({ name: "Only Tactic", cost: 1 }), owner: P1, zone: "hand" },
      ...resources("e", 4, P1, "elitism"),
      ...resources("r", 8, P1, "rage")
    ]
  });
  runLeet(engine, id, []);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("leet")), "discard");
  assert.equal(zoneOf(engine, id("t1")), "hand");
  assert.equal(engine.state.pendingChoice, undefined);
});

// =============================================================================
// 4p7 31f
// If a "gear" card becomes attached to this card, you may detach a resource from
// your faction.
// While a "gear" card is attached to this card, this card gains 1 strength and 1 life.
// Character (31f), gearsmith, cost 3, threshold [E][E], 2 / 3 / 2.
// =============================================================================

const ELF = "f98c69dc-d771-430d-95f0-69461bc3c1ee";

const GEAR = (name = "Test Gear", cost = 0) => item({ name, cost, subtype: ["gear"], attachTo: "character" } as Partial<CardDefinition>);
const TRINKET = (name = "Test Trinket") => item({ name, cost: 0, subtype: ["trinket"], attachTo: "character" } as Partial<CardDefinition>);

/** A tactic that re-homes the chosen attached item onto the chosen character (declarations `g` and `h`). */
const REHOME = tactic({
  name: "Rehome",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "rehome",
        type: "activated",
        targets: [
          { id: "g", selector: { zone: "play", type: "item" }, count: 1 },
          { id: "h", selector: { zone: "play", type: "character" }, count: 1 }
        ],
        effects: [{ type: "attachTo", target: { type: "selected", id: "g" }, to: { type: "selected", id: "h" } }]
      }
    ]
  }
});

function elfBoard(
  opts: { elf?: "hand" | "play"; spent?: number; unspent?: number; attachedGear?: number; attachedTrinket?: boolean; active?: Pid; extra?: CardPlacement[] } = {}
) {
  const gearAttached: CardPlacement[] = Array.from({ length: opts.attachedGear ?? 0 }, (_, i) => ({
    key: `agear${i}`,
    def: GEAR(`Attached Gear ${i}`),
    owner: P1,
    zone: "play" as const,
    attachedToKey: "elf"
  }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "elf", def: printing(ELF), owner: P1, zone: opts.elf ?? "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 20, speed: 1 }), owner: P2, zone: "play" },
      { key: "gear", def: GEAR("Hand Gear"), owner: P1, zone: "hand" },
      { key: "gear2", def: GEAR("Second Hand Gear"), owner: P1, zone: "hand" },
      { key: "trinket", def: TRINKET(), owner: P1, zone: "hand" },
      { key: "rehome", def: REHOME, owner: P1, zone: "hand" },
      { key: "foeGear", def: GEAR("Foe Gear"), owner: P2, zone: "hand" },
      ...gearAttached,
      ...(opts.attachedTrinket ? [{ key: "atrinket", def: TRINKET("Attached Trinket"), owner: P1, zone: "play" as const, attachedToKey: "elf" }] : []),
      ...resources("s", opts.spent ?? 0, P1, "elitism").map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...resources("u", opts.unspent ?? 3, P1, "elitism"),
      ...resources("fs", 2, P2, "rage").map((p) => ({ ...p, attachedToKey: "__factionB" })),
      ...(opts.extra ?? [])
    ]
  });
}

const attachedTo = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].attachedTo;
const isSpent = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].attachedTo !== undefined;

/** Answers the "you may detach" prompt: accept (picking `resourceKey` if asked which) or decline. */
function answerDetach(engine: SpoilsEngine, id: (key: string) => string, accept: boolean, resourceKey?: string) {
  const first = pending(engine);
  assert.ok(first, "a 'you may detach a resource' prompt is open");
  assert.equal(first.playerId, P1, "the elf's controller decides");
  if (first.kind === "chooserSelectsOption") {
    const options = (first as unknown as { options: Array<{ label?: string }> }).options;
    const index = options.findIndex((o) => (accept ? !/decline|no\b|nothing/i.test(o.label ?? "") : /decline|no\b|nothing/i.test(o.label ?? "")));
    assert.ok(index >= 0, "the prompt offers both an accept and a decline option");
    answerPending(engine, "chooserSelectsOption", { index });
  } else if (first.kind === "mayPay") {
    answerPending(engine, "mayPay", { pay: accept });
  } else {
    assert.fail(`unexpected prompt ${first.kind}`);
  }
  if (accept && pending(engine)?.kind === "chooserSelectsTarget") {
    assert.ok(resourceKey, "the test must name the resource to detach");
    pick(engine, [id(resourceKey)]);
  }
}

clause(ELF, "1:rule", "with no gear attached it has its printed 2 strength, 2 life and 3 speed", () => {
  const { engine, id } = elfBoard();
  assert.deepEqual(stats(engine, id("elf")), [2, 2, 3]);
});

clause(ELF, "1:rule", "with a 'gear' card attached it gains exactly 1 strength and 1 life (speed unchanged)", () => {
  const { engine, id } = elfBoard({ attachedGear: 1 });
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "it is the gear subtype that counts: an attached card that is not gear gives nothing", () => {
  const { engine, id } = elfBoard({ attachedTrinket: true });
  assert.equal(attachedTo(engine, id("atrinket")), id("elf"), "control: the trinket is attached");
  assert.deepEqual(stats(engine, id("elf")), [2, 2, 3]);
});

clause(ELF, "1:rule", "a non-gear attachment next to a gear one doesn't add anything: still +1/+1", () => {
  const { engine, id } = elfBoard({ attachedGear: 1, attachedTrinket: true });
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "the bonus is not per gear: two gear cards attached still give +1 strength and +1 life ('while a gear card is attached')", () => {
  const { engine, id } = elfBoard({ attachedGear: 2 });
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3]);
  const three = elfBoard({ attachedGear: 3 });
  assert.deepEqual(stats(three.engine, three.id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "gear attached to ANOTHER character doesn't buff the elf, and the elf's gear doesn't buff the other", () => {
  const { engine, id } = elfBoard({ extra: [{ key: "ogear", def: GEAR("Other Gear"), owner: P1, zone: "play", attachedToKey: "other" }] });
  assert.deepEqual(stats(engine, id("elf")), [2, 2, 3]);
  assert.deepEqual(stats(engine, id("other")), [2, 4, 2], "control: the attached-to character is a plain Other (no gear rule of its own)");
});

clause(ELF, "1:rule", "an opponent's gear attached to the elf counts too (it is 'a gear card attached to this card')", () => {
  const { engine, id } = elfBoard({ extra: [{ key: "foeAttached", def: GEAR("Foe Attached"), owner: P2, zone: "play", attachedToKey: "elf" }] });
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "a real gear card (Smear Campaign, subtype gear) attached to the elf gives the bonus", () => {
  const { engine, id } = elfBoard({ extra: [{ key: "smear", def: printing(SMEAR), owner: P1, zone: "play", attachedToKey: "elf" }] });
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "playing a gear card onto the elf turns the bonus on", () => {
  const { engine, id } = elfBoard();
  assert.deepEqual(stats(engine, id("elf")), [2, 2, 3]);
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  answerDetach(engine, id, false);
  assert.equal(attachedTo(engine, id("gear")), id("elf"));
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "1:rule", "the bonus ends when the gear leaves play", () => {
  const { engine, id } = elfBoard({ attachedGear: 1, extra: [{ key: "smash", def: tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }] });
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3]);
  play(engine, P1, id("smash"), { selected: { t: [id("agear0")] } });
  assert.equal(zoneOf(engine, id("agear0")), "discard");
  assert.deepEqual(stats(engine, id("elf")), [2, 2, 3]);
});

clause(ELF, "1:rule", "with two gear cards, destroying one keeps the bonus; destroying both ends it", () => {
  const smash = tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });
  const { engine, id } = elfBoard({ attachedGear: 2, extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }, { key: "smash2", def: smash, owner: P1, zone: "hand" }] });
  play(engine, P1, id("smash"), { selected: { t: [id("agear0")] } });
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3], "one gear left: still buffed");
  play(engine, P1, id("smash2"), { selected: { t: [id("agear1")] } });
  assert.deepEqual(stats(engine, id("elf")), [2, 2, 3], "no gear left: back to printed");
});

clause(ELF, "1:rule", "the bonus is real in battle: an elf with a gear attached deals 3 damage (not 2) to the faction", () => {
  const withGear = elfBoard({ attachedGear: 1 });
  const before = influence(withGear.engine, P2);
  fight(withGear.engine, P1, [withGear.id("elf")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influence(withGear.engine, P2), 3);
  const bare = elfBoard();
  const beforeBare = influence(bare.engine, P2);
  fight(bare.engine, P1, [bare.id("elf")], { type: "faction", playerId: P2 }, []);
  assert.equal(beforeBare - influence(bare.engine, P2), 2, "control: without gear it hits for 2");
});

clause(ELF, "1:rule", "the extra life is real: with a gear attached 2 damage doesn't destroy it, and losing the gear then destroys an elf that is carrying 2 damage", () => {
  const dmg2 = tactic({ name: "Zap2", cost: 0, behavior: { abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] } });
  const smash = tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });
  const { engine, id } = elfBoard({ attachedGear: 1, extra: [{ key: "zap", def: dmg2, owner: P1, zone: "hand" }, { key: "smash", def: smash, owner: P1, zone: "hand" }] });
  play(engine, P1, id("zap"), { selected: { t: [id("elf")] } });
  assert.equal(zoneOf(engine, id("elf")), "play", "2 damage against 3 life");
  assert.equal(damageOf(engine, id("elf")), 2);
  play(engine, P1, id("smash"), { selected: { t: [id("agear0")] } });
  assert.equal(zoneOf(engine, id("elf")), "discard", "life back to 2 with 2 damage on it: destroyed");
});

// --- the detach rule ------------------------------------------------------------

clause(ELF, "0:rule", "a gear card deployed onto the elf lets me detach a resource of my faction: accepting detaches the chosen spent resource (one more resource is available)", () => {
  const { engine, id } = elfBoard({ spent: 3, unspent: 2 });
  assert.equal(ready(engine), 2);
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  assert.equal(attachedTo(engine, id("gear")), id("elf"));
  answerDetach(engine, id, true, "s1");
  resolvePendingResponses(engine);
  assert.equal(isSpent(engine, id("s1")), false, "the chosen resource is detached");
  assert.equal(isSpent(engine, id("s0")), true, "the others stay attached");
  assert.equal(isSpent(engine, id("s2")), true);
  assert.equal(ready(engine), 3, "exactly one more resource is available");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ELF, "0:rule", "'you may': declining detaches nothing", () => {
  const { engine, id } = elfBoard({ spent: 3, unspent: 2 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  answerDetach(engine, id, false);
  resolvePendingResponses(engine);
  assert.equal(ready(engine), 2);
  for (const key of ["s0", "s1", "s2"]) assert.equal(isSpent(engine, id(key)), true, key);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(attachedTo(engine, id("gear")), id("elf"), "the gear stays attached either way");
});

clause(ELF, "0:rule", "it is one resource: a single detach, not all of them, and the prompt does not come twice for one gear", () => {
  const { engine, id } = elfBoard({ spent: 4, unspent: 0 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  answerDetach(engine, id, true, "s0");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined, "a second prompt for the same gear would be a second detach");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "the resource is chosen by me from my faction's attached resources: the opponent's attached resource is refused", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1, extra: [] });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  const first = pending(engine);
  assert.ok(first, "first");
  if (first.kind === "chooserSelectsOption") {
    const options = (first as unknown as { options: Array<{ label?: string }> }).options;
    answerPending(engine, "chooserSelectsOption", { index: options.findIndex((o) => !/decline/i.test(o.label ?? "")) });
  }
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "which resource?");
  assert.throws(() => pick(engine, [engine.state.players[P2].play.find((c) => engine.isResource(c))!]), "the opponent's resource");
  assert.throws(() => pick(engine, [id("other")]), "a character is not a resource");
  assert.throws(() => pick(engine, [engine.state.players[P1].factionId!]), "the faction itself is not a resource");
  pick(engine, [id("s0")]);
  assert.equal(isSpent(engine, id("s0")), false, "control: my own attached resource is accepted");
});

clause(ELF, "0:rule", "it works for a gear card attached by the OPPONENT too: I (the elf's controller) get to detach one of MY resources", () => {
  const { engine, id } = elfBoard({ active: P2, spent: 2, unspent: 1, extra: [{ key: "p2res", def: resourceCard({ name: "P2 res" }), owner: P2, zone: "play" }] });
  const theirs = engine.state.players[P2].play.filter((c) => engine.isResource(c));
  play(engine, P2, id("foeGear"), { selected: { attachTo: [id("elf")] } });
  assert.equal(attachedTo(engine, id("foeGear")), id("elf"), "control: their gear is on my elf");
  assert.ok(pending(engine), "I am asked");
  answerDetach(engine, id, true, "s0");
  resolvePendingResponses(engine);
  assert.equal(isSpent(engine, id("s0")), false);
  for (const c of theirs) assert.equal(isSpent(engine, c), engine.state.cards[c].attachedTo !== undefined);
});

clause(ELF, "0:rule", "gear that becomes attached to ANOTHER character doesn't trigger the elf (the elf has none of it)", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("other")] } });
  assert.equal(attachedTo(engine, id("gear")), id("other"));
  assert.equal(engine.state.pendingChoice, undefined, "no prompt: nothing became attached to the elf");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "...even when the elf already carries a gear card: a second gear card going onto ANOTHER character is still no trigger for the elf", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1, attachedGear: 1 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("other")] } });
  assert.equal(attachedTo(engine, id("gear")), id("other"));
  assert.equal(engine.state.pendingChoice, undefined, "no prompt: the new gear did not become attached to the elf");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "only GEAR triggers it: a non-gear card becoming attached to the elf doesn't", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1 });
  play(engine, P1, id("trinket"), { selected: { attachTo: [id("elf")] } });
  assert.equal(attachedTo(engine, id("trinket")), id("elf"), "control: the trinket attached");
  assert.equal(engine.state.pendingChoice, undefined, "no prompt");
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "each gear that becomes attached triggers it again: two gear cards in turn give two chances to detach", () => {
  const { engine, id } = elfBoard({ spent: 3, unspent: 1 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  answerDetach(engine, id, true, "s0");
  resolvePendingResponses(engine);
  assert.equal(ready(engine), 2);
  play(engine, P1, id("gear2"), { selected: { attachTo: [id("elf")] } });
  assert.ok(pending(engine), "the second gear prompts again");
  answerDetach(engine, id, true, "s1");
  resolvePendingResponses(engine);
  assert.equal(ready(engine), 3);
});

clause(ELF, "0:rule", "'becomes attached' includes a gear card that was already in play and is moved onto the elf by an effect", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1, extra: [{ key: "ogear", def: GEAR("Other Gear"), owner: P1, zone: "play", attachedToKey: "other" }] });
  play(engine, P1, id("rehome"), { selected: { g: [id("ogear")], h: [id("elf")] } });
  assert.equal(attachedTo(engine, id("ogear")), id("elf"), "control: the gear moved onto the elf");
  assert.ok(pending(engine), "the elf's controller is asked whether to detach");
  answerDetach(engine, id, true, "s0");
  resolvePendingResponses(engine);
  assert.equal(isSpent(engine, id("s0")), false);
  assert.equal(ready(engine), 2);
});

clause(ELF, "0:rule", "...and a gear card moved onto the elf also turns the +1/+1 on", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1, extra: [{ key: "ogear", def: GEAR("Other Gear"), owner: P1, zone: "play", attachedToKey: "other" }] });
  play(engine, P1, id("rehome"), { selected: { g: [id("ogear")], h: [id("elf")] } });
  answerDetach(engine, id, false);
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3]);
});

clause(ELF, "0:rule", "a gear card moved AWAY from the elf to another character doesn't trigger the elf, and removes the bonus", () => {
  const { engine, id } = elfBoard({ spent: 2, unspent: 1, attachedGear: 1 });
  play(engine, P1, id("rehome"), { selected: { g: [id("agear0")], h: [id("other")] } });
  assert.equal(attachedTo(engine, id("agear0")), id("other"));
  assert.equal(engine.state.pendingChoice, undefined, "no prompt");
  assert.deepEqual(stats(engine, id("elf")), [2, 2, 3]);
  assert.equal(ready(engine), 1);
});

clause(ELF, "0:rule", "with no resource attached to my faction the 'may detach' has nothing to do: no resource becomes available", () => {
  const { engine, id } = elfBoard({ spent: 0, unspent: 3 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  if (pending(engine)) {
    // the engine may still ask; accepting or declining must not create resources
    const first = pending(engine)!;
    if (first.kind === "chooserSelectsOption") answerPending(engine, "chooserSelectsOption", { index: 0 });
    if (pending(engine)?.kind === "chooserSelectsTarget") pick(engine, [id("u0")]);
  }
  resolvePendingResponses(engine);
  assert.equal(ready(engine), 3, "nothing was spent, so nothing can be detached; the count is unchanged");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ELF, "0:rule", "the resource that can be detached is one that is ATTACHED to the faction: an unspent resource can't be picked", () => {
  const { engine, id } = elfBoard({ spent: 1, unspent: 2 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  const first = pending(engine);
  assert.ok(first, "first");
  if (first.kind === "chooserSelectsOption") answerPending(engine, "chooserSelectsOption", { index: 0 });
  // only an attached resource may be detached: picking an unspent one is not 'detaching a resource from your faction'
  assert.throws(() => pick(engine, [id("u0")]), "an unspent resource is not attached to the faction");
  pick(engine, [id("s0")]);
  assert.equal(ready(engine), 3);
});

clause(ELF, "0:rule", "the detach is optional per trigger and both answers leave the elf's own buff on", () => {
  const { engine, id } = elfBoard({ spent: 1, unspent: 0 });
  play(engine, P1, id("gear"), { selected: { attachTo: [id("elf")] } });
  answerDetach(engine, id, false);
  resolvePendingResponses(engine);
  assert.deepEqual(stats(engine, id("elf")), [3, 3, 3]);
});

// =============================================================================
// Acuminous Gigantitect
// GRAND DESIGN -- COST: Pay 2. Discard a card. Deplete this card.
//              -- EFFECT: The next numeric cost you pay this turn is reduced by 6.
// Character (inventor), gearsmith, cost 5, threshold [E][E], 3 / 3 / 3.
// =============================================================================

const GIGANTITECT = "43b52d42-fc5b-426d-8188-0390a4272f6c";

/** A character that costs `cost` to deploy (no threshold). */
const costly = (name: string, cost: number) => character({ name, cost, strength: 1, life: 2, speed: 1 });

/** An ability-bearing character whose ability pays `amount` ("Pay N: draw a card"). */
const payer = (amount: number) =>
  character({
    name: `Payer ${amount}`,
    behavior: { abilities: [{ id: "buy", type: "activated", costs: [{ type: "payResources", amount }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function gigBoard(
  opts: { resources?: number; handCards?: number; depleted?: boolean; gig2?: boolean; extra?: CardPlacement[]; active?: Pid; deckSize?: number } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "gig", def: printing(GIGANTITECT), owner: P1, zone: "play", depleted: opts.depleted },
      ...(opts.gig2 ? [{ key: "gig2", def: printing(GIGANTITECT), owner: P1, zone: "play" as const }] : []),
      ...fillers("h", opts.handCards ?? 4, P1, "hand"),
      ...fillers("d", opts.deckSize ?? 6, P1, "deck"),
      { key: "c10", def: costly("Cost Ten", 10), owner: P1, zone: "hand" },
      { key: "c8", def: costly("Cost Eight", 8), owner: P1, zone: "hand" },
      { key: "c7", def: costly("Cost Seven", 7), owner: P1, zone: "hand" },
      { key: "c6", def: costly("Cost Six", 6), owner: P1, zone: "hand" },
      { key: "c3", def: costly("Cost Three", 3), owner: P1, zone: "hand" },
      { key: "c0", def: costly("Cost Zero", 0), owner: P1, zone: "hand" },
      { key: "t7", def: tactic({ name: "Cost Seven Tactic", cost: 7 }), owner: P1, zone: "hand" },
      { key: "payer5", def: payer(5), owner: P1, zone: "play" },
      { key: "payer8", def: payer(8), owner: P1, zone: "play" },
      { key: "foeC", def: costly("Their Cost Eight", 8), owner: P2, zone: "hand" },
      ...fillers("f", 4, P2, "deck"),
      ...resources("r", opts.resources ?? 24, P1, "rage"),
      ...resources("p2r", 12, P2, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

/** Uses GRAND DESIGN, discarding `h0`. */
function grandDesign(engine: SpoilsEngine, id: (key: string) => string, gigKey = "gig", discardKey = "h0") {
  activate(engine, P1, id(gigKey), "grand", { selected: { d: [id(discardKey)] } });
}

/** The resources a play of `cardKey` costs (before - after), including the response-window drain. */
function costOfPlaying(engine: SpoilsEngine, id: (key: string) => string, cardKey: string, opts: { selected?: Record<string, string[]> } = {}) {
  const before = ready(engine);
  play(engine, P1, id(cardKey), opts);
  return before - ready(engine);
}

clause(GIGANTITECT, "0:ability:grand", "COST is paid when it is used: 2 resources, the chosen card discarded and the Gigantitect depleted, before the opponent can respond", () => {
  const { engine, id } = gigBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0")] } });
  assert.equal(before - ready(engine), 2, "pay 2");
  assert.equal(zoneOf(engine, id("h0")), "discard", "the card is discarded");
  assert.equal(discard(engine, P1).includes(id("h0")), true);
  assert.equal(engine.state.cards[id("gig")].depleted, true, "deplete this card");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 8, "the reduction is the EFFECT: it isn't in force while the ability waits for responses");
  resolvePendingResponses(engine);
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 2, "once it has resolved the next cost is reduced by 6");
});

clause(GIGANTITECT, "0:ability:grand", "EFFECT: the next card I deploy costs 6 less: a cost-8 character costs exactly 2 resources", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "c8"), 2);
  assert.equal(zoneOf(engine, id("c8")), "play");
});

clause(GIGANTITECT, "0:ability:grand", "...exactly 6 less, not more or less: costs 10 → 4, 7 → 1, 6 → 0", () => {
  for (const [key, paid] of [
    ["c10", 4],
    ["c7", 1],
    ["c6", 0]
  ] as const) {
    const { engine, id } = gigBoard();
    grandDesign(engine, id);
    assert.equal(costOfPlaying(engine, id, key), paid, key);
  }
});

clause(GIGANTITECT, "0:ability:grand", "a cost lower than 6 is reduced only to 0 (CR 406.6): cost 3 and cost 0 cost nothing", () => {
  for (const key of ["c3", "c0"]) {
    const { engine, id } = gigBoard();
    grandDesign(engine, id);
    assert.equal(costOfPlaying(engine, id, key), 0, key);
    assert.equal(zoneOf(engine, id(key)), "play");
  }
});

clause(GIGANTITECT, "0:ability:grand", "it works for any card type: a cost-7 tactic costs 1", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "t7"), 1);
  assert.equal(zoneOf(engine, id("t7")), "discard", "the tactic resolved");
});

clause(GIGANTITECT, "0:ability:grand", "'the NEXT numeric cost': only one cost is reduced; the card after it costs full price", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "c8"), 2);
  assert.equal(costOfPlaying(engine, id, "c7"), 7, "the reduction was used up");
  assert.equal(engine.getCardPlayability(P1, id("c6")).numericCost, 6);
});

clause(GIGANTITECT, "0:ability:grand", "an ability's 'pay N' is a numeric cost too (CR 406.5): the next ability cost is reduced (Pay 8 costs 2, Pay 5 costs nothing)", () => {
  const eight = gigBoard();
  grandDesign(eight.engine, eight.id);
  const before = ready(eight.engine);
  activate(eight.engine, P1, eight.id("payer8"), "buy");
  assert.equal(before - ready(eight.engine), 2, "Pay 8 reduced by 6");
  const five = gigBoard();
  grandDesign(five.engine, five.id);
  const beforeFive = ready(five.engine);
  activate(five.engine, P1, five.id("payer5"), "buy");
  assert.equal(beforeFive - ready(five.engine), 0, "Pay 5 reduced to 0");
});

clause(GIGANTITECT, "0:ability:grand", "...and that uses the reduction up: the card deployed afterwards costs full price", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  activate(engine, P1, id("payer8"), "buy");
  assert.equal(costOfPlaying(engine, id, "c7"), 7);
});

clause(GIGANTITECT, "0:ability:grand", "it applies to the whole numeric cost including 'pay' extra costs (CR 406.3): cost 5 + extra 'pay 3' = 8, reduced to 2", () => {
  const extraCost = character({ name: "Extra Cost", cost: 5, behavior: { onPlay: { costs: [{ type: "payResources", amount: 3 }], effects: [] } } });
  const { engine, id } = gigBoard({ extra: [{ key: "ec", def: extraCost, owner: P1, zone: "hand" }] });
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "ec"), 2);
});

clause(GIGANTITECT, "0:ability:grand", "only YOUR cost: the opponent's next numeric cost is not reduced", () => {
  const { engine, id } = gigBoard({ active: P2 });
  engine.state.cards[id("gig")].depleted = false;
  // the opponent plays on their own turn; my reduction (used earlier on my turn) must not apply to them
  const mine = gigBoard();
  grandDesign(mine.engine, mine.id);
  assert.equal(mine.engine.getCardPlayability(P2, mine.id("foeC")).numericCost, 8, "their card still costs 8 while I hold a reduction");
});

clause(GIGANTITECT, "0:ability:grand", "'this turn': an unused reduction is gone on the next turn (the opponent's), and on mine afterwards", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 2);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 8, "the unused reduction did not carry over");
  assert.equal(costOfPlaying(engine, id, "c8"), 8);
});

clause(GIGANTITECT, "0:ability:grand", "two uses stack on the same next cost: with two reductions a cost-14 card costs 2 (each effect reduces 'the next numeric cost' by 6)", () => {
  const big = costly("Cost Fourteen", 14);
  const { engine, id } = gigBoard({ extra: [{ key: "c14", def: big, owner: P1, zone: "hand" }] });
  grandDesign(engine, id, "gig", "h0");
  // The second Grand Design's effect, already resolved: a second Grand Design cannot be USED first, because its own
  // "pay 2" is itself "the next numeric cost" and would use the first reduction up (1st-edition-part-2-03-18).
  engine.state.costReductions.push({ id: "second-grand-design", playerId: P1, amount: 6, createdTurn: engine.state.turn });
  assert.equal(costOfPlaying(engine, id, "c14"), 2);
});

clause(GIGANTITECT, "0:ability:grand", "...and the second Grand Design's own 'pay 2' is itself the next numeric cost, so the first reduction makes it free", () => {
  const { engine, id } = gigBoard({ gig2: true });
  grandDesign(engine, id, "gig", "h0");
  const before = ready(engine);
  activate(engine, P1, id("gig2"), "grand", { selected: { d: [id("h1")] } });
  assert.equal(before - ready(engine), 0, "pay 2 reduced by 6 to 0");
  assert.equal(engine.state.cards[id("gig2")].depleted, true);
  assert.equal(zoneOf(engine, id("h1")), "discard", "its other costs were still paid");
});

clause(GIGANTITECT, "0:ability:grand", "the discard must be a card in my hand: cards in play, discard pile, deck or the opponent's hand are refused, nothing is paid", () => {
  const { engine, id } = gigBoard({ extra: [{ key: "old", def: character({ name: "Old" }), owner: P1, zone: "discard" }, { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }] });
  const before = ready(engine);
  const attempt = (cardId: string) => () => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [cardId] } });
  assert.throws(attempt(id("payer5")), "a card in play");
  assert.throws(attempt(id("old")), "a card in the discard pile");
  assert.throws(attempt(id("d0")), "a card in the deck");
  assert.throws(attempt(id("theirHand")), "the opponent's hand");
  assert.throws(attempt(id("gig")), "the Gigantitect itself");
  assert.equal(ready(engine), before, "nothing was paid");
  assert.equal(engine.state.cards[id("gig")].depleted, false);
  attempt(id("h1"))();
  assert.equal(zoneOf(engine, id("h1")), "discard", "control: a hand card is accepted");
});

clause(GIGANTITECT, "0:ability:grand", "any card in hand can be discarded (even a costly character or tactic), exactly one", () => {
  const { engine, id } = gigBoard();
  assert.throws(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [] } }), "none");
  assert.throws(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0"), id("h1")] } }), "two");
  assert.throws(() => activateRaw(engine, P1, id("gig"), "grand", {}), "no selection");
  grandDesign(engine, id, "gig", "t7");
  assert.equal(zoneOf(engine, id("t7")), "discard");
});

clause(GIGANTITECT, "0:ability:grand", "with an empty hand it can't be used", () => {
  const { engine, id } = gigBoard({ handCards: 0 });
  for (const key of ["c10", "c8", "c7", "c6", "c3", "c0", "t7"]) engine.state.cards[id(key)].zone = "discard";
  engine.state.players[P1].hand.length = 0;
  assert.throws(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [] } }));
  assert.equal(engine.state.cards[id("gig")].depleted, false);
});

clause(GIGANTITECT, "0:ability:grand", "is refused one resource short of the pay-2 cost: nothing is discarded or depleted", () => {
  const { engine, id } = gigBoard({ resources: 1 });
  assert.throws(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0")] } }));
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(engine.state.cards[id("gig")].depleted, false);
  assert.equal(ready(engine), 1);
  const exact = gigBoard({ resources: 2 });
  grandDesign(exact.engine, exact.id);
  assert.equal(exact.engine.state.cards[exact.id("gig")].depleted, true, "exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(GIGANTITECT, "0:ability:grand", "needs no resource icons: two resources of any kind pay for it", () => {
  const { engine, id } = gigBoard({ resources: 0, extra: resources("e", 2, P1, "deception") });
  grandDesign(engine, id);
  assert.equal(engine.state.cards[id("gig")].depleted, true);
});

clause(GIGANTITECT, "0:ability:grand", "a depleted Gigantitect can't use it (refused, nothing paid); next turn it is restored and can", () => {
  const { engine, id } = gigBoard({ depleted: true });
  const before = ready(engine);
  assert.throws(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0")] } }));
  assert.equal(ready(engine), before);
  assert.equal(zoneOf(engine, id("h0")), "hand");
  endTurn(engine, P1);
  endTurn(engine, P2);
  grandDesign(engine, id);
  assert.equal(engine.state.cards[id("gig")].depleted, true);
});

clause(GIGANTITECT, "0:ability:grand", "only its controller may use it", () => {
  const { engine, id } = gigBoard();
  assert.throws(() => activateRaw(engine, P2, id("gig"), "grand", { selected: { d: [id("foeC")] } }));
  assert.equal(engine.state.cards[id("gig")].depleted, false);
});

clause(GIGANTITECT, "0:ability:grand", "it can be used the turn the Gigantitect enters play (abilities have no summoning sickness)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "gig", def: printing(GIGANTITECT), owner: P1, zone: "hand" },
      ...fillers("h", 2, P1, "hand"),
      { key: "c8", def: costly("Cost Eight", 8), owner: P1, zone: "hand" },
      ...resources("e", 2, P1, "elitism"),
      ...resources("r", 14, P1, "rage")
    ]
  });
  play(engine, P1, id("gig"));
  assert.equal(zoneOf(engine, id("gig")), "play");
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "c8"), 2);
});

clause(GIGANTITECT, "0:ability:grand", "the reduction is the controller's even if the Gigantitect is destroyed in response (the ability resolves as paid)", () => {
  const { engine, id } = gigBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0")] } });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("gig")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gig")), "discard", "destroyed in response");
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 2, "CR 502.4: the ability still takes effect");
});

// =============================================================================
// Contriving Engineer
// When this card enters play, you may search your deck for a card named
// "Elitism" and put it into play attached to your faction.
// Character (inventor), gearsmith, cost 4, threshold [E], 2 / 3 / 1.
// =============================================================================

const ENGINEER = "e6209034-2b54-4889-8789-15b12c330056";
/** The staple resource card named "Elitism" (1st Edition printing). */
const ELITISM = "b4ddcf43-e508-4a11-9953-697acdcaf116";

function engineerBoard(
  opts: { zone?: "hand" | "play"; elitismInDeck?: number; deckSize?: number; elitismResources?: number; rage?: number; random?: () => number; owner?: Pid; active?: Pid; extra?: CardPlacement[] } = {}
) {
  const owner = opts.owner ?? P1;
  const foe = otherOf(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    random: opts.random ?? seeded(),
    cards: [
      { key: "eng", def: printing(ENGINEER), owner, zone: opts.zone ?? "hand" },
      { key: "ally", def: character({ name: "Ally", cost: 1 }), owner, zone: "hand" },
      ...fillers("d", opts.deckSize ?? 6, owner, "deck"),
      ...Array.from({ length: opts.elitismInDeck ?? 2 }, (_, i) => ({ key: `el${i}`, def: printing(ELITISM), owner, zone: "deck" as const })),
      { key: "crest", def: item({ name: "Crest of Elitism" }), owner, zone: "deck" },
      { key: "essence", def: item({ name: "Essence of Elitism" }), owner, zone: "deck" },
      { key: "elHand", def: printing(ELITISM), owner, zone: "hand" },
      { key: "elDisc", def: printing(ELITISM), owner, zone: "discard" },
      { key: "foeEl", def: printing(ELITISM), owner: foe, zone: "deck" },
      ...fillers("f", 3, foe, "deck"),
      ...resources("e", opts.elitismResources ?? 1, owner, "elitism"),
      ...resources("r", opts.rage ?? 6, owner, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

const deckNames = (engine: SpoilsEngine, player: Pid) => deck(engine, player).map((c) => engine.getDefinition(c).name);
const elitismCount = (engine: SpoilsEngine, player: Pid) => engine.getThresholds(player).elitism ?? 0;

clause(ENGINEER, "0:rule", "pays 4 to deploy; accepting the search puts the chosen Elitism into play, attached to my faction", () => {
  const { engine, id } = engineerBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("eng"));
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(zoneOf(engine, id("el0")), "deck", "nothing is searched while it is only being deployed");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("eng")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the controller is asked which Elitism");
  assert.equal(pending(engine)?.playerId, P1);
  pick(engine, [id("el1")]);
  assert.equal(zoneOf(engine, id("el1")), "play", "the chosen Elitism is in play");
  assert.equal(engine.state.cards[id("el1")].attachedTo, engine.state.players[P1].factionId, "attached to my faction");
  assert.equal(engine.state.cards[id("el1")].controllerId, P1);
  assert.equal(engine.state.cards[id("el1")].faceDown, false, "a face-up resource");
  assert.equal(zoneOf(engine, id("el0")), "deck", "only the one chosen");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ENGINEER, "0:rule", "the Elitism arrives as a resource: it provides [E] (one more icon) but, being attached, it is already spent (no extra resource to pay with)", () => {
  const { engine, id } = engineerBoard({ elitismResources: 1 });
  play(engine, P1, id("eng"));
  const readyBefore = ready(engine);
  const iconsBefore = elitismCount(engine, P1);
  pick(engine, [id("el0")]);
  assert.equal(engine.isResource(id("el0")), true);
  assert.equal(elitismCount(engine, P1), iconsBefore + 1, "one more [E] icon");
  assert.equal(ready(engine), readyBefore, "it is attached to the faction, so it can't pay for anything this turn");
});

clause(ENGINEER, "0:rule", "...and it detaches like any spent resource at my next turn's restore: then it is an available resource", () => {
  const { engine, id } = engineerBoard();
  play(engine, P1, id("eng"));
  pick(engine, [id("el0")]);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("el0")].attachedTo, undefined, "detached by the restore rule");
  assert.equal(engine.getAvailableResourceIds(P1).includes(id("el0")), true);
});

clause(ENGINEER, "0:rule", "'you may': declining the search puts nothing into play, and the Elitism cards stay in the deck", () => {
  const { engine, id } = engineerBoard();
  play(engine, P1, id("eng"));
  pick(engine, []);
  assert.equal(zoneOf(engine, id("el0")), "deck");
  assert.equal(zoneOf(engine, id("el1")), "deck");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("eng")), "play", "the Engineer is in play either way");
});

clause(ENGINEER, "0:rule", "CR 312.2: with a specific search you may fail even if a valid card is there (the same as declining)", () => {
  const { engine, id } = engineerBoard({ elitismInDeck: 1 });
  play(engine, P1, id("eng"));
  pick(engine, []);
  assert.equal(zoneOf(engine, id("el0")), "deck");
  assert.equal(engine.state.players[P1].play.some((c) => engine.getDefinition(c).name === "Elitism" && engine.state.cards[c].attachedTo !== undefined), false);
});

clause(ENGINEER, "0:rule", "'a card named Elitism': exactly one is fetched, even when several are in the deck (two can't be chosen)", () => {
  const { engine, id } = engineerBoard({ elitismInDeck: 3 });
  play(engine, P1, id("eng"));
  assert.throws(() => pick(engine, [id("el0"), id("el1")]), "two cards");
  assert.ok(pending(engine), "the prompt is still open");
  pick(engine, [id("el2")]);
  assert.equal(zoneOf(engine, id("el2")), "play");
  assert.equal(zoneOf(engine, id("el0")), "deck");
  assert.equal(zoneOf(engine, id("el1")), "deck");
});

clause(ENGINEER, "0:rule", "only cards NAMED \"Elitism\" can be fetched: Crest of Elitism, Essence of Elitism and other deck cards are refused", () => {
  const { engine, id } = engineerBoard();
  play(engine, P1, id("eng"));
  assert.throws(() => pick(engine, [id("crest")]), "Crest of Elitism");
  assert.throws(() => pick(engine, [id("essence")]), "Essence of Elitism");
  assert.throws(() => pick(engine, [id("d0")]), "an ordinary deck card");
  assert.equal(zoneOf(engine, id("crest")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pick(engine, [id("el0")]);
  assert.equal(zoneOf(engine, id("el0")), "play", "control: a card named Elitism is accepted");
});

clause(ENGINEER, "0:rule", "it searches MY deck: an Elitism in my hand or discard pile, or in the opponent's deck, can't be fetched", () => {
  const { engine, id } = engineerBoard();
  play(engine, P1, id("eng"));
  assert.throws(() => pick(engine, [id("elHand")]), "in my hand");
  assert.throws(() => pick(engine, [id("elDisc")]), "in my discard pile");
  assert.throws(() => pick(engine, [id("foeEl")]), "in the opponent's deck");
  assert.equal(zoneOf(engine, id("foeEl")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pick(engine, [id("el0")]);
  assert.equal(zoneOf(engine, id("el0")), "play");
});

clause(ENGINEER, "0:rule", "the opponent's deck is untouched: it keeps its cards and its order", () => {
  const { engine, id } = engineerBoard();
  const before = [...deck(engine, P2)];
  play(engine, P1, id("eng"));
  pick(engine, [id("el0")]);
  assert.deepEqual(deck(engine, P2), before);
});

clause(ENGINEER, "0:rule", "with no Elitism in my deck nothing can be fetched and the game is not left waiting", () => {
  const { engine, id } = engineerBoard({ elitismInDeck: 0 });
  play(engine, P1, id("eng"));
  if (pending(engine)) pick(engine, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(zoneOf(engine, id("eng")), "play");
  assert.equal(elitismCount(engine, P1), 1, "no new [E] icon");
});

clause(ENGINEER, "0:rule", "CR 312.1: the deck is shuffled afterwards when a card was found", () => {
  const rotating = engineerBoard({ random: () => 0 });
  const identity = engineerBoard({ random: () => 0.9999999 });
  for (const g of [rotating, identity]) {
    play(g.engine, P1, g.id("eng"));
    pick(g.engine, [g.id("el0")]);
  }
  assert.deepEqual([...deckNames(rotating.engine, P1)].sort(), [...deckNames(identity.engine, P1)].sort(), "same cards");
  assert.notDeepEqual(deckNames(rotating.engine, P1), deckNames(identity.engine, P1), "but the order follows the random source: the deck was shuffled");
});

clause(ENGINEER, "0:rule", "CR 312.1: the deck is shuffled afterwards even when I search and choose to find nothing", () => {
  const rotating = engineerBoard({ random: () => 0 });
  const identity = engineerBoard({ random: () => 0.9999999 });
  for (const g of [rotating, identity]) {
    play(g.engine, P1, g.id("eng"));
    pick(g.engine, []);
  }
  assert.notDeepEqual(deckNames(rotating.engine, P1), deckNames(identity.engine, P1), "the deck was searched, so it is shuffled whether or not a card was taken");
});

clause(ENGINEER, "0:rule", "CR 312.1: the deck is shuffled afterwards even when there is no Elitism in it", () => {
  const rotating = engineerBoard({ random: () => 0, elitismInDeck: 0 });
  const identity = engineerBoard({ random: () => 0.9999999, elitismInDeck: 0 });
  for (const g of [rotating, identity]) {
    play(g.engine, P1, g.id("eng"));
    if (pending(g.engine)) pick(g.engine, []);
  }
  assert.notDeepEqual(deckNames(rotating.engine, P1), deckNames(identity.engine, P1), "a search with no match still shuffles");
});

clause(ENGINEER, "0:rule", "'enters play' includes being put into play by an effect: an Engineer raised from the discard pile searches too", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [{ id: "raise", type: "activated", targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });
  const { engine, id } = engineerBoard({ extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }, { key: "dead", def: printing(ENGINEER), owner: P1, zone: "discard" }] });
  play(engine, P1, id("raise"), { selected: { t: [id("dead")] } });
  assert.equal(zoneOf(engine, id("dead")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search prompt appears");
  pick(engine, [id("el0")]);
  assert.equal(zoneOf(engine, id("el0")), "play");
  assert.equal(engine.state.cards[id("el0")].attachedTo, engine.state.players[P1].factionId);
});

clause(ENGINEER, "0:rule", "it triggers for ITSELF entering play only: another card entering play while the Engineer is out starts no search", () => {
  const { engine, id } = engineerBoard({ zone: "play" });
  play(engine, P1, id("ally"));
  assert.equal(engine.state.pendingChoice, undefined, "no search prompt");
  assert.equal(zoneOf(engine, id("el0")), "deck");
});

clause(ENGINEER, "0:rule", "an Engineer that starts on the table (never entered play) searches for nothing", () => {
  const { engine, id } = engineerBoard({ zone: "play" });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("el0")), "deck");
});

clause(ENGINEER, "0:rule", "it works for the second player's Engineer too: THEIR deck is searched and THEIR faction gets the Elitism", () => {
  const { engine, id } = engineerBoard({ owner: P2, active: P2 });
  play(engine, P2, id("eng"));
  assert.equal(pending(engine)?.playerId, P2, "the Engineer's controller chooses");
  pick(engine, [id("el0")]);
  assert.equal(zoneOf(engine, id("el0")), "play");
  assert.equal(engine.state.cards[id("el0")].attachedTo, engine.state.players[P2].factionId);
  assert.equal(engine.state.cards[id("el0")].controllerId, P2);
});

clause(ENGINEER, "0:rule", "two Engineers fetch an Elitism each (each enters play with its own search)", () => {
  const { engine, id } = engineerBoard({ rage: 8, extra: [{ key: "eng2", def: printing(ENGINEER), owner: P1, zone: "hand" }] });
  play(engine, P1, id("eng"));
  pick(engine, [id("el0")]);
  play(engine, P1, id("eng2"));
  pick(engine, [id("el1")]);
  assert.equal(zoneOf(engine, id("el0")), "play");
  assert.equal(zoneOf(engine, id("el1")), "play");
  assert.equal(elitismCount(engine, P1), 3);
});

clause(ENGINEER, "0:rule", "is refused one resource short of its cost of 4, and without [E]", () => {
  const short = engineerBoard({ elitismResources: 1, rage: 2 });
  assert.equal(ready(short.engine), 3);
  assert.throws(() => playRaw(short.engine, P1, short.id("eng")));
  assert.equal(zoneOf(short.engine, short.id("eng")), "hand");
  const noThreshold = engineerBoard({ elitismResources: 0, rage: 8 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("eng")), "no [E]");
  const exact = engineerBoard({ elitismResources: 1, rage: 3 });
  play(exact.engine, P1, exact.id("eng"));
  assert.equal(zoneOf(exact.engine, exact.id("eng")), "play", "[E] and exactly 4 resources is enough");
});

// =============================================================================
// Discommodiousness
// Your opponent must reveal their hand and shuffle all tactics from it into
// their deck. Your opponent draws X cards, where X is the number of tactics
// shuffled into their deck. Draw a card.
// Tactic, gearsmith, cost 2, threshold [E][E].
// =============================================================================

const DISCOMMODIOUS = "42334135-ad09-4e14-b243-597d4a44384e";

function discBoard(
  opts: { oppTactics?: number; oppOthers?: number; oppDeck?: number; myDeck?: number; elitism?: number; rage?: number; random?: () => number; active?: Pid; extra?: CardPlacement[] } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? seeded(),
    cards: [
      { key: "disc", def: printing(DISCOMMODIOUS), owner: P1, zone: "hand" },
      { key: "myTac", def: tactic({ name: "My Hand Tactic", cost: 1 }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.oppTactics ?? 2 }, (_, i) => ({ key: `ot${i}`, def: tactic({ name: `Their Tactic ${i}`, cost: 1 }), owner: P2, zone: "hand" as const })),
      ...Array.from({ length: opts.oppOthers ?? 3 }, (_, i) => ({
        key: `oc${i}`,
        def: i === 0 ? character({ name: "Their Character" }) : i === 1 ? item({ name: "Their Item" }) : i === 2 ? location({ name: "Their Place" }) : resourceCard({ name: `Their Staple ${i}` }),
        owner: P2,
        zone: "hand" as const
      })),
      ...fillers("d", opts.myDeck ?? 5, P1, "deck"),
      ...fillers("f", opts.oppDeck ?? 6, P2, "deck"),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...resources("e", opts.elitism ?? 2, P1, "elitism"),
      ...resources("r", opts.rage ?? 2, P1, "rage"),
      ...resources("p2e", 4, P2, "elitism"),
      ...(opts.extra ?? [])
    ]
  });
}

const handKeys = (engine: SpoilsEngine, id: (key: string) => string, keys: string[], player: Pid) => keys.filter((key) => hand(engine, player).includes(id(key)));

clause(DISCOMMODIOUS, "0:rule", "pays 2; every tactic in the opponent's hand is shuffled into their deck; their other cards stay in hand", () => {
  const { engine, id } = discBoard({ oppDeck: 8 });
  const before = ready(engine);
  playRaw(engine, P1, id("disc"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(zoneOf(engine, id("ot0")), "hand", "nothing happens while the opponent may respond");
  resolvePendingResponses(engine);
  for (const key of ["oc0", "oc1", "oc2"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} (not a tactic) stays in hand`);
  const movedToDeck = loggedEvents(engine, "cardMoved")
    .map((entry) => entry.event as unknown as { cardId: string; from: string; to: string })
    .filter((event) => event.from === "hand" && event.to === "deck")
    .map((event) => event.cardId);
  sameCards(movedToDeck, [id("ot0"), id("ot1")], "exactly their two tactics were moved from hand into the deck");
  assert.equal(zoneOf(engine, id("disc")), "discard", "the tactic is spent");
});

clause(DISCOMMODIOUS, "0:rule", "...and they draw X = the number of tactics shuffled: with 2 tactics their hand ends the same size, their deck the same size", () => {
  const { engine, id } = discBoard();
  const theirHand = hand(engine, P2).length;
  const theirDeck = deck(engine, P2).length;
  play(engine, P1, id("disc"));
  assert.equal(hand(engine, P2).length, theirHand, "-2 tactics shuffled away, +2 drawn");
  assert.equal(deck(engine, P2).length, theirDeck, "+2 shuffled in, -2 drawn");
});

for (const tactics of [1, 3, 4]) {
  clause(DISCOMMODIOUS, "0:rule", `X varies with the hand: with ${tactics} tactic(s) in their hand they shuffle ${tactics} and draw ${tactics}`, () => {
    const { engine, id } = discBoard({ oppTactics: tactics });
    const theirHand = hand(engine, P2).length;
    const theirDeck = deck(engine, P2).length;
    const nonTactics = ["oc0", "oc1", "oc2"].map(id);
    play(engine, P1, id("disc"));
    assert.equal(hand(engine, P2).length, theirHand);
    assert.equal(deck(engine, P2).length, theirDeck);
    for (const card of nonTactics) assert.equal(zoneOf(engine, card), "hand", "non-tactics never left the hand");
  });
}

clause(DISCOMMODIOUS, "0:rule", "the draw comes AFTER the shuffle: with an empty deck the opponent draws the tactics they just shuffled in (they all come back)", () => {
  const { engine, id } = discBoard({ oppDeck: 0, oppTactics: 2 });
  play(engine, P1, id("disc"));
  assert.equal(zoneOf(engine, id("ot0")), "hand");
  assert.equal(zoneOf(engine, id("ot1")), "hand");
  assert.equal(deck(engine, P2).length, 0);
});

clause(DISCOMMODIOUS, "0:rule", "with one card in their deck and 2 tactics: the 2 tactics are shuffled with it and exactly 2 cards are drawn, leaving 1 in the deck", () => {
  const { engine, id } = discBoard({ oppDeck: 1, oppTactics: 2 });
  play(engine, P1, id("disc"));
  assert.equal(deck(engine, P2).length, 1);
  assert.equal(hand(engine, P2).length, 2 + 3, "3 non-tactics plus the 2 cards drawn");
});

clause(DISCOMMODIOUS, "0:rule", "the shuffled tactics really do go into the deck and are shuffled: the deck order follows the random source", () => {
  const rotating = discBoard({ oppDeck: 8, random: () => 0 });
  const identity = discBoard({ oppDeck: 8, random: () => 0.9999999 });
  for (const g of [rotating, identity]) play(g.engine, P1, g.id("disc"));
  const names = (g: typeof rotating) => deck(g.engine, P2).map((c) => g.engine.getDefinition(c).name);
  const everything = (g: typeof rotating) => [...names(g), ...hand(g.engine, P2).map((c) => g.engine.getDefinition(c).name)].sort();
  assert.deepEqual(everything(rotating), everything(identity), "the same cards between their deck and hand");
  assert.notDeepEqual(names(rotating), names(identity), "...with a deck order that depends on the random source");
});

clause(DISCOMMODIOUS, "0:rule", "I draw exactly one card (my top card), my own tactic stays in hand and my deck is not shuffled", () => {
  const { engine, id } = discBoard();
  const [first, second] = deck(engine, P1).slice(0, 2);
  const mine = hand(engine, P1).length;
  const myDeckOrder = [...deck(engine, P1)];
  play(engine, P1, id("disc"));
  assert.equal(zoneOf(engine, first), "hand", "my top card was drawn");
  assert.equal(zoneOf(engine, second), "deck");
  assert.equal(hand(engine, P1).length, mine - 1 + 1, "Discommodiousness left the hand, one card drawn");
  assert.equal(zoneOf(engine, id("myTac")), "hand", "my own tactic is not shuffled away");
  assert.deepEqual(deck(engine, P1), myDeckOrder.slice(1), "my deck lost only its top card");
});

clause(DISCOMMODIOUS, "0:rule", "'your opponent must reveal their hand': their whole hand is revealed (tactics and the other cards)", () => {
  const { engine, id } = discBoard();
  const theirHand = [...hand(engine, P2)];
  play(engine, P1, id("disc"));
  const reveals = loggedEvents(engine, "cardsRevealed");
  assert.ok(reveals.length >= 1, "a reveal happened");
  const shown = reveals.flatMap((entry) => ((entry.event as unknown as { cardIds?: string[] }).cardIds ?? []));
  for (const card of theirHand) assert.equal(shown.includes(card), true, `${engine.getDefinition(card).name} was revealed`);
});

clause(DISCOMMODIOUS, "0:rule", "only the opponent's hand is revealed and searched: none of MY cards appear in the reveal", () => {
  const { engine, id } = discBoard();
  play(engine, P1, id("disc"));
  const shown = loggedEvents(engine, "cardsRevealed").flatMap((entry) => ((entry.event as unknown as { cardIds?: string[] }).cardIds ?? []));
  assert.equal(shown.includes(id("myTac")), false);
});

clause(DISCOMMODIOUS, "0:rule", "with no tactic in their hand nothing is shuffled and they draw nothing, but I still draw a card", () => {
  const { engine, id } = discBoard({ oppTactics: 0 });
  const theirHand = [...hand(engine, P2)];
  const theirDeck = [...deck(engine, P2)];
  const top = deck(engine, P1)[0];
  play(engine, P1, id("disc"));
  assert.deepEqual(hand(engine, P2), theirHand, "their hand is unchanged");
  assert.equal(deck(engine, P2).length, theirDeck.length, "their deck has the same cards");
  assert.equal(zoneOf(engine, top), "hand", "I drew a card");
});

clause(DISCOMMODIOUS, "0:rule", "with no tactic in their hand no cards are shuffled into their deck, so the deck is not shuffled (CR 313.2)", () => {
  const rotating = discBoard({ oppTactics: 0, oppDeck: 8, random: () => 0 });
  const identity = discBoard({ oppTactics: 0, oppDeck: 8, random: () => 0.9999999 });
  for (const g of [rotating, identity]) play(g.engine, P1, g.id("disc"));
  assert.deepEqual(
    deck(rotating.engine, P2).map((c) => rotating.engine.getDefinition(c).name),
    deck(identity.engine, P2).map((c) => identity.engine.getDefinition(c).name),
    "their deck order must not depend on the random source"
  );
});

clause(DISCOMMODIOUS, "0:rule", "with an empty hand there is nothing to reveal or shuffle; I draw one card and the game goes on", () => {
  const { engine, id } = discBoard({ oppTactics: 0, oppOthers: 0 });
  assert.equal(hand(engine, P2).length, 0);
  const top = deck(engine, P1)[0];
  play(engine, P1, id("disc"));
  assert.equal(hand(engine, P2).length, 0);
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(DISCOMMODIOUS, "0:rule", "a hand of only tactics: all of them go away and the same number come back", () => {
  const { engine, id } = discBoard({ oppTactics: 3, oppOthers: 0 });
  play(engine, P1, id("disc"));
  assert.equal(hand(engine, P2).length, 3);
  assert.equal(deck(engine, P2).length, 6);
});

clause(DISCOMMODIOUS, "0:rule", "the shuffle is of THEIR deck: my cards never move to my deck, and nothing of mine goes to theirs", () => {
  const { engine, id } = discBoard();
  play(engine, P1, id("disc"));
  assert.equal(zoneOf(engine, id("myTac")), "hand");
  assert.equal(deck(engine, P2).some((c) => engine.state.cards[c].ownerId === P1), false);
});

clause(DISCOMMODIOUS, "0:rule", "it can be played on the opponent's turn, in response to their action (tactic timing)", () => {
  const { engine, id } = discBoard({
    active: P2,
    extra: [{ key: "p2noop", def: NOOP_TACTIC("Their Noop"), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P2, id("p2noop"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  const theirDeck = deck(engine, P2).length;
  playRaw(engine, P1, id("disc"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("disc")), "discard");
  assert.equal(deck(engine, P2).length, theirDeck, "their tactics went back and the same number were drawn");
});

clause(DISCOMMODIOUS, "0:rule", "is refused one resource short of its cost of 2, and without [E][E]", () => {
  const short = discBoard({ elitism: 2, rage: 0 });
  short.engine.state.cards[short.id("e1")].attachedTo = short.engine.state.players[P1].factionId;
  assert.equal(ready(short.engine), 1);
  assert.throws(() => playRaw(short.engine, P1, short.id("disc")));
  assert.equal(zoneOf(short.engine, short.id("disc")), "hand");
  const noThreshold = discBoard({ elitism: 1, rage: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("disc")), "only one [E]");
  const exact = discBoard({ elitism: 2, rage: 0 });
  play(exact.engine, P1, exact.id("disc"));
  assert.equal(zoneOf(exact.engine, exact.id("disc")), "discard", "[E][E] and exactly 2 resources");
  assert.equal(ready(exact.engine), 0);
});

// =============================================================================
// Elite Team Registration
// Search your deck for up to 2 Gearsmith characters with different names, reveal
// them, and put them into your hand.
// Tactic, gearsmith, cost 4, threshold [E][E][E].
// =============================================================================

const REGISTRATION = "3dd0c05f-dd1d-49a2-b7b5-ab17f0ee8bd3";

const gearsmithChar = (name: string, extra: Partial<CardDefinition> = {}) => character({ name, trade: "gearsmith", strength: 2, life: 2, ...extra });

function registrationBoard(opts: { elitism?: number; rage?: number; random?: () => number; active?: Pid; deckExtra?: CardPlacement[]; noGearsmiths?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? seeded(),
    cards: [
      { key: "reg", def: printing(REGISTRATION), owner: P1, zone: "hand" },
      ...fillers("d", 5, P1, "deck"),
      ...(opts.noGearsmiths
        ? []
        : [
            { key: "gA", def: gearsmithChar("Gear Alpha"), owner: P1, zone: "deck" as const },
            { key: "gB", def: gearsmithChar("Gear Beta"), owner: P1, zone: "deck" as const },
            { key: "gC", def: gearsmithChar("Gear Gamma"), owner: P1, zone: "deck" as const },
            { key: "twin1", def: gearsmithChar("Gear Twin"), owner: P1, zone: "deck" as const },
            { key: "twin2", def: gearsmithChar("Gear Twin"), owner: P1, zone: "deck" as const }
          ]),
      { key: "banker", def: character({ name: "Banker Guy", trade: "banker" }), owner: P1, zone: "deck" },
      { key: "universal", def: character({ name: "Universal Guy", trade: "universal" }), owner: P1, zone: "deck" },
      { key: "gearItem", def: item({ name: "Gearsmith Item", trade: "gearsmith" }), owner: P1, zone: "deck" },
      { key: "gearTac", def: tactic({ name: "Gearsmith Tactic", trade: "gearsmith", cost: 1 }), owner: P1, zone: "deck" },
      { key: "gHand", def: gearsmithChar("Gear In Hand"), owner: P1, zone: "hand" },
      { key: "gDisc", def: gearsmithChar("Gear In Discard"), owner: P1, zone: "discard" },
      { key: "foeG", def: gearsmithChar("Their Gearsmith"), owner: P2, zone: "deck" },
      ...fillers("f", 3, P2, "deck"),
      ...(opts.deckExtra ?? []),
      ...resources("e", opts.elitism ?? 3, P1, "elitism"),
      ...resources("r", opts.rage ?? 1, P1, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays the tactic and answers the search with `keys`. */
function registrationSearch(engine: SpoilsEngine, id: (key: string) => string, keys: string[]) {
  play(engine, P1, id("reg"));
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the controller is asked what to find");
  assert.equal(pending(engine)?.playerId, P1);
  pick(engine, keys.map(id));
}

clause(REGISTRATION, "0:rule", "pays 4; the two chosen Gearsmith characters (different names) go from the deck into my hand", () => {
  const { engine, id } = registrationBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("reg"));
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(zoneOf(engine, id("gA")), "deck", "nothing is searched while the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pick(engine, [id("gA"), id("gB")]);
  assert.equal(zoneOf(engine, id("gA")), "hand");
  assert.equal(zoneOf(engine, id("gB")), "hand");
  assert.equal(hand(engine, P1).includes(id("gA")), true);
  assert.equal(zoneOf(engine, id("gC")), "deck", "a third Gearsmith stays in the deck");
  assert.equal(zoneOf(engine, id("reg")), "discard", "the tactic is spent");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(REGISTRATION, "0:rule", "'reveal them': the found cards are revealed", () => {
  const { engine, id } = registrationBoard();
  registrationSearch(engine, id, ["gA", "gB"]);
  const shown = loggedEvents(engine, "cardsRevealed").flatMap((entry) => ((entry.event as unknown as { cardIds?: string[] }).cardIds ?? []));
  assert.equal(shown.includes(id("gA")), true);
  assert.equal(shown.includes(id("gB")), true);
});

clause(REGISTRATION, "0:rule", "'up to 2': finding just one is fine", () => {
  const { engine, id } = registrationBoard();
  const handBefore = hand(engine, P1).length;
  registrationSearch(engine, id, ["gB"]);
  assert.equal(zoneOf(engine, id("gB")), "hand");
  assert.equal(zoneOf(engine, id("gA")), "deck");
  assert.equal(hand(engine, P1).length, handBefore - 1 + 1);
});

clause(REGISTRATION, "0:rule", "'up to 2' includes none: I may fail the search even though valid cards are there (CR 312.2)", () => {
  const { engine, id } = registrationBoard();
  const handBefore = hand(engine, P1).length;
  registrationSearch(engine, id, []);
  assert.equal(zoneOf(engine, id("gA")), "deck");
  assert.equal(hand(engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(engine, id("reg")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(REGISTRATION, "0:rule", "never more than 2: three Gearsmith characters are refused", () => {
  const { engine, id } = registrationBoard();
  play(engine, P1, id("reg"));
  assert.throws(() => pick(engine, [id("gA"), id("gB"), id("gC")]), "three cards");
  assert.ok(pending(engine), "the search is still open");
  assert.equal(zoneOf(engine, id("gA")), "deck");
  pick(engine, [id("gA"), id("gC")]);
  assert.equal(zoneOf(engine, id("gC")), "hand", "control: two are accepted");
});

clause(REGISTRATION, "0:rule", "'with different names': two copies of the same Gearsmith character are refused; one copy alone is fine", () => {
  const { engine, id } = registrationBoard();
  play(engine, P1, id("reg"));
  assert.throws(() => pick(engine, [id("twin1"), id("twin2")]), "same name twice");
  assert.equal(zoneOf(engine, id("twin1")), "deck");
  assert.equal(zoneOf(engine, id("twin2")), "deck");
  pick(engine, [id("twin1"), id("gA")]);
  assert.equal(zoneOf(engine, id("twin1")), "hand", "control: one Twin plus a differently named card");
  assert.equal(zoneOf(engine, id("twin2")), "deck");
});

clause(REGISTRATION, "0:rule", "when the only Gearsmith characters left are copies of one name, just one can be taken", () => {
  const { engine, id } = registrationBoard({ noGearsmiths: true, deckExtra: [{ key: "twin1", def: gearsmithChar("Gear Twin"), owner: P1, zone: "deck" }, { key: "twin2", def: gearsmithChar("Gear Twin"), owner: P1, zone: "deck" }] });
  play(engine, P1, id("reg"));
  assert.throws(() => pick(engine, [id("twin1"), id("twin2")]));
  pick(engine, [id("twin2")]);
  assert.equal(zoneOf(engine, id("twin2")), "hand");
  assert.equal(zoneOf(engine, id("twin1")), "deck");
});

clause(REGISTRATION, "0:rule", "only GEARSMITH characters: a Banker character, a Universal character, a Gearsmith item and a Gearsmith tactic are refused", () => {
  const { engine, id } = registrationBoard();
  play(engine, P1, id("reg"));
  assert.throws(() => pick(engine, [id("banker")]), "a Banker character");
  assert.throws(() => pick(engine, [id("universal")]), "a Universal character");
  assert.throws(() => pick(engine, [id("gearItem")]), "a Gearsmith item");
  assert.throws(() => pick(engine, [id("gearTac")]), "a Gearsmith tactic");
  assert.throws(() => pick(engine, [id("d0")]), "an ordinary card");
  assert.throws(() => pick(engine, [id("gA"), id("banker")]), "one valid and one invalid");
  assert.equal(zoneOf(engine, id("banker")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pick(engine, [id("gA")]);
  assert.equal(zoneOf(engine, id("gA")), "hand", "control: a Gearsmith character is accepted");
});

clause(REGISTRATION, "0:rule", "it searches MY deck: Gearsmith characters in my hand or discard pile, or in the opponent's deck, can't be taken", () => {
  const { engine, id } = registrationBoard();
  play(engine, P1, id("reg"));
  assert.throws(() => pick(engine, [id("gHand")]), "in my hand");
  assert.throws(() => pick(engine, [id("gDisc")]), "in my discard pile");
  assert.throws(() => pick(engine, [id("foeG")]), "in the opponent's deck");
  assert.equal(zoneOf(engine, id("foeG")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pick(engine, [id("gA")]);
  assert.equal(zoneOf(engine, id("gA")), "hand");
});

clause(REGISTRATION, "0:rule", "the opponent's deck is untouched", () => {
  const { engine, id } = registrationBoard();
  const before = [...deck(engine, P2)];
  registrationSearch(engine, id, ["gA", "gB"]);
  assert.deepEqual(deck(engine, P2), before);
});

clause(REGISTRATION, "0:rule", "with no Gearsmith character in my deck nothing can be found and the tactic still resolves (no stuck prompt)", () => {
  const { engine, id } = registrationBoard({ noGearsmiths: true });
  play(engine, P1, id("reg"));
  if (pending(engine)) pick(engine, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(zoneOf(engine, id("reg")), "discard");
});

clause(REGISTRATION, "0:rule", "the cards that were found leave the deck: the deck is smaller by the number found", () => {
  const { engine, id } = registrationBoard();
  const before = deck(engine, P1).length;
  registrationSearch(engine, id, ["gA", "gB"]);
  assert.equal(deck(engine, P1).length, before - 2);
  assert.equal(deck(engine, P1).includes(id("gA")), false);
});

clause(REGISTRATION, "0:rule", "CR 312.1: the deck is shuffled afterwards when cards were found", () => {
  const rotating = registrationBoard({ random: () => 0 });
  const identity = registrationBoard({ random: () => 0.9999999 });
  for (const g of [rotating, identity]) registrationSearch(g.engine, g.id, ["gA", "gB"]);
  const names = (g: typeof rotating) => deck(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  assert.deepEqual([...names(rotating)].sort(), [...names(identity)].sort());
  assert.notDeepEqual(names(rotating), names(identity), "the order follows the random source: the deck was shuffled");
});

clause(REGISTRATION, "0:rule", "CR 312.1: the deck is shuffled afterwards even when I choose to find nothing", () => {
  const rotating = registrationBoard({ random: () => 0 });
  const identity = registrationBoard({ random: () => 0.9999999 });
  for (const g of [rotating, identity]) registrationSearch(g.engine, g.id, []);
  const names = (g: typeof rotating) => deck(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  assert.notDeepEqual(names(rotating), names(identity), "the deck was searched, so it is shuffled");
});

clause(REGISTRATION, "0:rule", "CR 312.1: the deck is shuffled afterwards even when there is no Gearsmith character to find", () => {
  const rotating = registrationBoard({ random: () => 0, noGearsmiths: true });
  const identity = registrationBoard({ random: () => 0.9999999, noGearsmiths: true });
  for (const g of [rotating, identity]) {
    play(g.engine, P1, g.id("reg"));
    if (pending(g.engine)) pick(g.engine, []);
  }
  const names = (g: typeof rotating) => deck(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  assert.notDeepEqual(names(rotating), names(identity), "a search with no match still shuffles");
});

clause(REGISTRATION, "0:rule", "it can be played on the opponent's turn in response to their action (tactic timing)", () => {
  const { engine, id } = registrationBoard({ active: P2, extra: [{ key: "p2noop", def: NOOP_TACTIC("Their Noop"), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("p2noop"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("reg"));
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pick(engine, [id("gA"), id("gB")]);
  assert.equal(zoneOf(engine, id("gA")), "hand");
});

clause(REGISTRATION, "0:rule", "is refused one resource short of its cost of 4, and without [E][E][E]", () => {
  const short = registrationBoard({ elitism: 3, rage: 0 });
  assert.equal(ready(short.engine), 3);
  assert.throws(() => playRaw(short.engine, P1, short.id("reg")));
  assert.equal(zoneOf(short.engine, short.id("reg")), "hand");
  const noThreshold = registrationBoard({ elitism: 2, rage: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("reg")), "only two [E]");
  const exact = registrationBoard({ elitism: 3, rage: 1 });
  registrationSearch(exact.engine, exact.id, []);
  assert.equal(zoneOf(exact.engine, exact.id("reg")), "discard", "[E][E][E] and exactly 4 resources");
  assert.equal(ready(exact.engine), 0);
});

// =============================================================================
// Epiphany Ball
// SUDDEN INSIGHT -- COST: Deplete this card. -- EFFECT: Search your deck for a
// card and put it into your hand. Your opponent takes control of this card.
// Item, gearsmith, cost 3, threshold [E][E].
// =============================================================================

const BALL = "5f6c7c41-3be8-44ce-9293-454a35772c0f";

function ballBoard(opts: { depleted?: boolean; deckSize?: number; emptyDeck?: boolean; oppDeckSize?: number; random?: () => number; active?: Pid; owner?: Pid; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  const foe = otherOf(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    random: opts.random ?? seeded(),
    cards: [
      { key: "ball", def: printing(BALL), owner, zone: "play", depleted: opts.depleted },
      ...(opts.emptyDeck
        ? []
        : [
            { key: "want", def: character({ name: "Wanted Character", cost: 4 }), owner, zone: "deck" as const },
            { key: "wantTac", def: tactic({ name: "Wanted Tactic", cost: 1 }), owner, zone: "deck" as const },
            { key: "wantItem", def: item({ name: "Wanted Item" }), owner, zone: "deck" as const },
            { key: "wantRes", def: resourceCard({ name: "Wanted Staple" }), owner, zone: "deck" as const },
            ...fillers("d", opts.deckSize ?? 5, owner, "deck")
          ]),
      { key: "foeWant", def: character({ name: "Their Wanted" }), owner: foe, zone: "deck" },
      ...fillers("f", opts.oppDeckSize ?? 4, foe, "deck"),
      { key: "inHand", def: character({ name: "In Hand" }), owner, zone: "hand" },
      { key: "inDisc", def: character({ name: "In Discard" }), owner, zone: "discard" },
      { key: "theirHand", def: character({ name: "Their Hand" }), owner: foe, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner, zone: "play" },
      ...resources("r", 4, owner, "rage"),
      ...resources("p2r", 4, foe, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

const controllerOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].controllerId;

clause(BALL, "0:ability:insight", "COST: deplete this card is paid when it is used (before the opponent can respond); the search happens when it resolves", () => {
  const { engine, id } = ballBoard();
  activateRaw(engine, P1, id("ball"), "insight");
  assert.equal(engine.state.cards[id("ball")].depleted, true, "deplete this card");
  assert.equal(controllerOf(engine, id("ball")), P1, "control has not changed yet");
  assert.equal(pending(engine), undefined, "no search yet");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "now I search");
  assert.equal(pending(engine)?.playerId, P1);
  pick(engine, [engine.state.players[P1].deck[0]]);
});

clause(BALL, "0:ability:insight", "EFFECT: I search my deck for a card and put it into my hand; then my opponent takes control of the Ball", () => {
  const { engine, id } = ballBoard();
  const handBefore = hand(engine, P1).length;
  const deckBefore = deck(engine, P1).length;
  activate(engine, P1, id("ball"), "insight");
  pick(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
  assert.equal(hand(engine, P1).length, handBefore + 1);
  assert.equal(deck(engine, P1).length, deckBefore - 1);
  assert.equal(controllerOf(engine, id("ball")), P2, "the opponent now controls it");
  assert.equal(engine.state.cards[id("ball")].ownerId, P1, "ownership never changes (CR 407.8)");
  assert.equal(zoneOf(engine, id("ball")), "play");
  assert.equal(engine.state.players[P2].play.includes(id("ball")), true);
  assert.equal(engine.state.players[P1].play.includes(id("ball")), false);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(BALL, "0:ability:insight", "'a card': any type can be fetched (character, tactic, item, resource)", () => {
  for (const key of ["want", "wantTac", "wantItem", "wantRes"]) {
    const { engine, id } = ballBoard();
    activate(engine, P1, id("ball"), "insight");
    pick(engine, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "hand", key);
  }
});

clause(BALL, "0:ability:insight", "exactly one card: two are refused", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  assert.throws(() => pick(engine, [id("want"), id("wantTac")]), "two cards");
  assert.ok(pending(engine), "the search is still open");
  assert.equal(zoneOf(engine, id("want")), "deck");
  pick(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
  assert.equal(zoneOf(engine, id("wantTac")), "deck");
});

clause(BALL, "0:ability:insight", "'search your deck for a card' must find one when the deck has cards (CR 312.2): finding nothing is refused", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  assert.throws(() => pick(engine, []), "no card chosen");
  assert.ok(pending(engine), "still waiting for a real choice");
  assert.equal(controllerOf(engine, id("ball")), P1);
  pick(engine, [id("want")]);
  assert.equal(controllerOf(engine, id("ball")), P2, "control passes only after the search completes");
});

clause(BALL, "0:ability:insight", "it searches MY deck: cards in my hand or discard pile, the opponent's deck, hand and cards in play are refused", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  for (const key of ["inHand", "inDisc", "foeWant", "theirHand", "mine"]) assert.throws(() => pick(engine, [id(key)]), key);
  assert.equal(zoneOf(engine, id("foeWant")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pick(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
});

clause(BALL, "0:ability:insight", "the opponent's deck and hand are untouched", () => {
  const { engine, id } = ballBoard();
  const theirDeck = [...deck(engine, P2)];
  const theirHand = [...hand(engine, P2)];
  activate(engine, P1, id("ball"), "insight");
  pick(engine, [id("want")]);
  assert.deepEqual(deck(engine, P2), theirDeck);
  assert.deepEqual(hand(engine, P2), theirHand);
});

clause(BALL, "0:ability:insight", "CR 312.1: my deck is shuffled afterwards", () => {
  const rotating = ballBoard({ random: () => 0 });
  const identity = ballBoard({ random: () => 0.9999999 });
  for (const g of [rotating, identity]) {
    activate(g.engine, P1, g.id("ball"), "insight");
    pick(g.engine, [g.id("want")]);
  }
  const names = (g: typeof rotating) => deck(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  assert.deepEqual([...names(rotating)].sort(), [...names(identity)].sort(), "the same cards remain");
  assert.notDeepEqual(names(rotating), names(identity), "...in an order that follows the random source: the searched deck was shuffled");
});

clause(BALL, "0:ability:insight", "with an empty deck there is nothing to find, but the opponent still takes control of the Ball", () => {
  const { engine, id } = ballBoard({ emptyDeck: true });
  assert.equal(deck(engine, P1).length, 0);
  activate(engine, P1, id("ball"), "insight");
  if (pending(engine)) pick(engine, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(controllerOf(engine, id("ball")), P2, "control passes regardless");
  assert.equal(engine.state.winner, undefined);
});

clause(BALL, "0:ability:insight", "a depleted Ball can't be used: refused, nothing searched", () => {
  const { engine, id } = ballBoard({ depleted: true });
  assert.throws(() => activateRaw(engine, P1, id("ball"), "insight"));
  assert.equal(pending(engine), undefined);
  assert.equal(controllerOf(engine, id("ball")), P1);
  assert.equal(engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("ball") && a.ability.id === "insight"), false);
});

clause(BALL, "0:ability:insight", "no resources are needed: it works with none at all", () => {
  const { engine, id } = ballBoard();
  for (const key of ["r0", "r1", "r2", "r3"]) engine.state.cards[id(key)].attachedTo = engine.state.players[P1].factionId;
  assert.equal(ready(engine), 0);
  activate(engine, P1, id("ball"), "insight");
  pick(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
});

clause(BALL, "0:ability:insight", "only its controller may use it", () => {
  const { engine, id } = ballBoard();
  assert.throws(() => activateRaw(engine, P2, id("ball"), "insight"));
  assert.equal(engine.state.cards[id("ball")].depleted, false);
  assert.equal(controllerOf(engine, id("ball")), P1);
});

clause(BALL, "0:ability:insight", "once the opponent controls it I can't use it any more (it was depleted anyway, and it isn't mine)", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  pick(engine, [id("want")]);
  assert.throws(() => activateRaw(engine, P1, id("ball"), "insight"));
  engine.state.cards[id("ball")].depleted = false;
  assert.throws(() => activateRaw(engine, P1, id("ball"), "insight"), "not my card to use any more");
});

clause(BALL, "0:ability:insight", "it comes back and forth: on their turn the Ball is restored under their control; they can use it, and I take control of it again", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  pick(engine, [id("want")]);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("ball")].depleted, false, "restored at the start of their turn (they control it)");
  const theirWanted = id("foeWant");
  activate(engine, P2, id("ball"), "insight");
  assert.equal(pending(engine)?.playerId, P2, "THEY search THEIR deck");
  pick(engine, [theirWanted]);
  assert.equal(zoneOf(engine, theirWanted), "hand");
  assert.equal(hand(engine, P2).includes(theirWanted), true);
  assert.equal(controllerOf(engine, id("ball")), P1, "their opponent (me) takes control of it");
  assert.equal(engine.state.cards[id("ball")].ownerId, P1);
});

clause(BALL, "0:ability:insight", "back with me, it is restored again on my turn and usable once more", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  pick(engine, [id("want")]);
  endTurn(engine, P1);
  activate(engine, P2, id("ball"), "insight");
  pick(engine, [id("foeWant")]);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(controllerOf(engine, id("ball")), P1);
  assert.equal(engine.state.cards[id("ball")].depleted, false);
  activate(engine, P1, id("ball"), "insight");
  assert.equal(pending(engine)?.playerId, P1);
  pick(engine, [id("wantTac")]);
  assert.equal(zoneOf(engine, id("wantTac")), "hand");
  assert.equal(controllerOf(engine, id("ball")), P2);
});

clause(BALL, "0:ability:insight", "only the Ball changes hands: my other permanents stay mine", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  pick(engine, [id("want")]);
  assert.equal(controllerOf(engine, id("mine")), P1);
  assert.equal(controllerOf(engine, engine.state.players[P1].factionId!), P1);
});

clause(BALL, "0:ability:insight", "when the Ball is destroyed under their control it goes to ITS OWNER's discard pile (mine)", () => {
  const { engine, id } = ballBoard({ extra: [{ key: "smash", def: tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P2, zone: "hand" }] });
  activate(engine, P1, id("ball"), "insight");
  pick(engine, [id("want")]);
  endTurn(engine, P1);
  play(engine, P2, id("smash"), { selected: { t: [id("ball")] } });
  assert.equal(zoneOf(engine, id("ball")), "discard");
  assert.equal(discard(engine, P1).includes(id("ball")), true, "its owner's discard pile");
  assert.equal(discard(engine, P2).includes(id("ball")), false);
});

clause(BALL, "0:ability:insight", "the effect resolves as paid if the Ball is destroyed in response: I still search and the (gone) card changes no hands", () => {
  const { engine, id } = ballBoard({ extra: [{ key: "kill", def: tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P2, zone: "hand" }] });
  activateRaw(engine, P1, id("ball"), "insight");
  playRaw(engine, P2, id("kill"), { selected: { t: [id("ball")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ball")), "discard", "destroyed in response");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search still happens (CR 502.4)");
  pick(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
  assert.equal(zoneOf(engine, id("ball")), "discard", "a card in the discard pile is not given to the opponent");
});

// =============================================================================
// Exploding Sock Puppet!
// Your opponent cannot respond to this card.
// COST: Play this only in response to a character's ability.
// EFFECT: The ability has no effect. Destroy the character.
// Tactic, gearsmith, cost 2, threshold [E].
// =============================================================================

const PUPPET = "ab111049-6ba1-430e-8d27-f647bcd5ac35";

function puppetBoard(opts: { active?: Pid; elitism?: number; rage?: number; foeFaction?: CardDefinition; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: opts.foeFaction ?? developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "pup", def: printing(PUPPET), owner: P1, zone: "hand" },
      { key: "myTac", def: NOOP_TACTIC("My Noop"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 8 }), owner: P1, zone: "play" },
      { key: "myGuy", def: abilityGuy("My Ability Guy"), owner: P1, zone: "play" },
      { key: "guy", def: GUY, owner: P2, zone: "play" },
      { key: "guy2", def: GUY, owner: P2, zone: "play" },
      { key: "other", def: OTHER_GUY, owner: P2, zone: "play" },
      { key: "idol", def: IDOL, owner: P2, zone: "play" },
      { key: "shrine", def: SHRINE, owner: P2, zone: "play" },
      { key: "p2tac", def: NOOP_TACTIC("Their Noop"), owner: P2, zone: "hand" },
      { key: "p2char", def: character({ name: "Their Newcomer", cost: 0 }), owner: P2, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("f", 4, P2, "deck"),
      ...resources("e", opts.elitism ?? 1, P1, "elitism"),
      ...resources("r", opts.rage ?? 3, P1, "rage"),
      ...resources("p2g", 8, P2, "greed"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(PUPPET, "0:rule", "the opponent gets no response window: it resolves on its own, and they can respond with neither a tactic nor an ability", () => {
  const { engine, id } = puppetBoard();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("pup"));
  assert.throws(() => playRaw(engine, P2, id("p2tac")), "no tactic in response");
  assert.throws(() => activateRaw(engine, P2, id("other"), "peek"), "no ability in response");
  assert.equal(zoneOf(engine, id("p2tac")), "hand");
});

clause(PUPPET, "1:ability", "in response to a character's ability: pays 2, the ability has no effect, and that character is destroyed (into its owner's discard pile)", () => {
  const { engine, id } = puppetBoard();
  const before = ready(engine);
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("pup"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the ability had no effect");
  assert.equal(zoneOf(engine, id("guy")), "discard", "the character is destroyed");
  assert.equal(discard(engine, P2).includes(id("guy")), true, "into its owner's discard pile");
  assert.equal(zoneOf(engine, id("pup")), "discard", "the tactic is spent");
  assert.equal(engine.state.responseWindow, undefined);
});

clause(PUPPET, "1:ability", "control: without the Puppet the same ability does its damage and the character survives", () => {
  const { engine, id } = puppetBoard();
  foeUses(engine, id, "guy", "zap");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 2);
  assert.equal(zoneOf(engine, id("guy")), "play");
});

clause(PUPPET, "1:ability", "only THE character whose ability it was is destroyed: the opponent's other characters (even copies) and mine are untouched", () => {
  const { engine, id } = puppetBoard();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  for (const key of ["guy2", "other"]) assert.equal(zoneOf(engine, id(key)), "play", key);
  for (const key of ["mine", "myGuy"]) assert.equal(zoneOf(engine, id(key)), "play", key);
});

clause(PUPPET, "1:ability", "the stopped ability's costs stay paid: the opponent's resource is not refunded", () => {
  const { engine, id } = puppetBoard();
  const before = ready(engine, P2);
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine, P2), 1);
});

clause(PUPPET, "1:ability", "it stops a drawing ability too, and the character is still destroyed", () => {
  const { engine, id } = puppetBoard();
  const theirHand = hand(engine, P2).length;
  foeUses(engine, id, "guy", "peek");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  assert.equal(hand(engine, P2).length, theirHand, "no card drawn");
  assert.equal(zoneOf(engine, id("guy")), "discard");
});

clause(PUPPET, "1:ability", "the character's own destroy-triggers fire as for any destruction (it is destroyed, not removed)", () => {
  const dies = character({
    name: "Dies Loudly",
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [
        { id: "zap", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] },
        { id: "last", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] }
      ]
    }
  });
  const { engine, id } = puppetBoard({ extra: [{ key: "dies", def: dies, owner: P2, zone: "play" }] });
  const before = influence(engine, P1);
  foeUses(engine, id, "dies", "zap");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("dies")), "discard");
  assert.equal(influence(engine, P1), before - 3, "its 'when this is destroyed' trigger ran: it was destroyed");
});

clause(PUPPET, "1:ability", "'in response to a CHARACTER's ability': refused for an item's ability and for a location's ability", () => {
  for (const [key, ability] of [
    ["idol", "pulse"],
    ["shrine", "quake"]
  ] as const) {
    const { engine, id } = puppetBoard();
    foeUses(engine, id, key, ability);
    const before = ready(engine);
    assert.throws(() => playRaw(engine, P1, id("pup")), `${key}'s ability is not a character's`);
    assert.equal(zoneOf(engine, id("pup")), "hand");
    assert.equal(ready(engine), before, "nothing was paid");
    assert.equal(zoneOf(engine, id(key)), "play", "and the source was not destroyed");
  }
});

clause(PUPPET, "1:ability", "...refused for a faction's ability", () => {
  const { engine, id } = puppetBoard({ foeFaction: ABILITY_FACTION });
  const foeFaction = engine.state.players[P2].factionId!;
  activateRaw(engine, P2, foeFaction, "fdraw");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  assert.throws(() => playRaw(engine, P1, id("pup")));
  assert.equal(zoneOf(engine, id("pup")), "hand");
  assert.equal(zoneOf(engine, foeFaction), "play");
});

clause(PUPPET, "1:ability", "...refused when it is not a response to an ability at all: in response to a tactic, to a character being played, or with nothing to respond to", () => {
  const tac = puppetBoard();
  playRaw(tac.engine, P2, tac.id("p2tac"));
  assert.throws(() => playRaw(tac.engine, P1, tac.id("pup")), "a tactic");
  const chr = puppetBoard();
  playRaw(chr.engine, P2, chr.id("p2char"));
  assert.throws(() => playRaw(chr.engine, P1, chr.id("pup")), "a character being played");
  assert.equal(chr.engine.state.cards[chr.id("p2char")].zone, "deploying");
  const idle = puppetBoard({ active: P1 });
  assert.throws(() => playRaw(idle.engine, P1, idle.id("pup")), "nothing to respond to");
  assert.equal(zoneOf(idle.engine, idle.id("pup")), "hand");
});

clause(PUPPET, "1:ability", "I can't use it against my own ability (CR 607.1)", () => {
  const { engine, id } = puppetBoard({ active: P1 });
  activateRaw(engine, P1, id("myGuy"), "zap", { selected: { t: [id("mine")] } });
  assert.throws(() => playRaw(engine, P1, id("pup")));
  assert.equal(zoneOf(engine, id("myGuy")), "play");
});

clause(PUPPET, "1:ability", "it works on my own turn too, against an ability they used in response to my action", () => {
  const { engine, id } = puppetBoard({ active: P1 });
  playRaw(engine, P1, id("myTac"));
  foeUses(engine, id, "other", "zap");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0);
  assert.equal(zoneOf(engine, id("other")), "discard");
  assert.equal(zoneOf(engine, id("myTac")), "discard", "my own tactic still resolved afterwards");
});

clause(PUPPET, "1:ability", "if the character already destroyed itself as the ability's cost, the ability still has no effect and nothing breaks (Snooty Doorman's DENIED!)", () => {
  const { engine, id } = puppetBoard({
    active: P1,
    extra: [
      { key: "door", def: printing(DOORMAN), owner: P2, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  playRaw(engine, P1, id("mine2"));
  activateRaw(engine, P2, id("door"), "denied");
  assert.equal(zoneOf(engine, id("door")), "discard", "control: their Doorman is already destroyed as a cost");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mine2")), "play", "DENIED! had no effect, so my character entered play");
  assert.equal(zoneOf(engine, id("door")), "discard");
  assert.equal(zoneOf(engine, id("pup")), "discard");
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(PUPPET, "1:ability", "is refused one resource short of its cost of 2, and without [E]", () => {
  const short = puppetBoard({ elitism: 1, rage: 0 });
  foeUses(short.engine, short.id, "guy", "zap");
  assert.throws(() => playRaw(short.engine, P1, short.id("pup")));
  assert.equal(zoneOf(short.engine, short.id("pup")), "hand");
  assert.equal(zoneOf(short.engine, short.id("guy")), "play");
  const noThreshold = puppetBoard({ elitism: 0, rage: 6 });
  foeUses(noThreshold.engine, noThreshold.id, "guy", "zap");
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("pup")), "no [E]");
  const exact = puppetBoard({ elitism: 1, rage: 1 });
  foeUses(exact.engine, exact.id, "guy", "zap");
  playRaw(exact.engine, P1, exact.id("pup"));
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("pup")), "discard", "[E] and exactly 2 resources works");
  assert.equal(zoneOf(exact.engine, exact.id("guy")), "discard");
  assert.equal(ready(exact.engine), 0);
});

// =============================================================================
// Guardforce Alpha Prime 31f
// This card can attack even if it has not been in play under your control since
// the start of the turn.
// Character (guardforce, 31f), gearsmith, cost 4, threshold [E][E], 3 / 3 / 2.
// =============================================================================

const GF31F = "d8b8dada-5302-4ef8-b226-59688a14f294";

function gfBoard(printingId: string, opts: { zone?: "hand" | "play"; fresh?: boolean; depleted?: boolean; elitism?: number; rage?: number; extra?: CardPlacement[]; handExtra?: CardPlacement[]; influenceB?: number; noHand?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: opts.influenceB },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "gf", def: printing(printingId), owner: P1, zone: opts.zone ?? "play", attackEligible: opts.fresh ? false : true, depleted: opts.depleted },
      { key: "oldAlly", def: character({ name: "Old Ally", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "freshAlly", def: character({ name: "Fresh Ally", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play", attackEligible: false },
      ...(opts.noHand
        ? []
        : [
            { key: "handChar", def: character({ name: "Hand Char", cost: 1 }), owner: P1, zone: "hand" as const },
            { key: "handRes", def: resourceCard({ name: "Hand Staple", trade: "universal", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" as const }
          ]),
      { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 12, speed: 1 }), owner: P2, zone: "play" },
      { key: "foeFresh", def: character({ name: "Foe Fresh", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...(opts.handExtra ?? []),
      ...resources("e", opts.elitism ?? 3, P1, "elitism"),
      ...resources("r", opts.rage ?? 4, P1, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(GF31F, "0:rule", "a 31f that entered play THIS turn can attack: it is deployed (4, [E][E]) and attacks at once, hitting the faction for its 3 strength", () => {
  const { engine, id } = gfBoard(GF31F, { zone: "hand" });
  const before = ready(engine);
  play(engine, P1, id("gf"));
  assert.equal(before - ready(engine), 4, "the printed cost of 4");
  assert.equal(zoneOf(engine, id("gf")), "play");
  const influenceBefore = influence(engine, P2);
  fight(engine, P1, [id("gf")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceBefore - influence(engine, P2), 3, "it attacked and hit for 3");
  assert.equal(engine.state.cards[id("gf")].depleted, true);
});

clause(GF31F, "0:rule", "it has the AGGRO keyword", () => {
  const { engine, id } = gfBoard(GF31F);
  assert.equal(engine.getKeywords(id("gf")).includes("aggro"), true);
  assert.equal(engine.getKeywords(id("oldAlly")).includes("aggro"), false, "control: an ordinary character doesn't");
});

clause(GF31F, "0:rule", "control: an ordinary character that entered play this turn can NOT attack", () => {
  const { engine, id } = gfBoard(GF31F, { zone: "hand" });
  play(engine, P1, id("handChar"));
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.throws(() => declareAttackBy(engine, P1, [id("handChar")]), "has not been in play since the start of the turn");
  assert.equal(engine.state.battle, undefined);
  assert.throws(() => declareAttackBy(engine, P1, [id("freshAlly")]), "a character marked as entered this turn");
});

clause(GF31F, "0:rule", "a 31f flagged as entered this turn attacks fine, and its own printed 3 damage lands", () => {
  const { engine, id } = gfBoard(GF31F, { fresh: true });
  const before = influence(engine, P2);
  fight(engine, P1, [id("gf")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influence(engine, P2), 3);
});

clause(GF31F, "0:rule", "it only lifts the 'since the start of the turn' restriction: a depleted 31f still can't attack", () => {
  const { engine, id } = gfBoard(GF31F, { fresh: true, depleted: true });
  assert.throws(() => declareAttackBy(engine, P1, [id("gf")]), "depleted");
  assert.equal(engine.state.battle, undefined);
});

clause(GF31F, "0:rule", "it grants the exception to ITSELF only: in a party, a character that entered this turn still can't go along", () => {
  const { engine, id } = gfBoard(GF31F, { fresh: true });
  assert.throws(() => declareAttackBy(engine, P1, [id("gf"), id("freshAlly")]), "the fresh ally is not eligible");
  assert.equal(engine.state.battle, undefined);
  declareAttackBy(engine, P1, [id("gf"), id("oldAlly")]);
  assert.ok(battleOf(engine), "control: with an eligible ally the party attacks");
});

clause(GF31F, "0:rule", "put into play by an effect this turn it can still attack", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: { abilities: [{ id: "raise", type: "activated", targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = gfBoard(GF31F, { zone: "hand", handExtra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }, { key: "dead", def: printing(GF31F), owner: P1, zone: "discard" }] });
  play(engine, P1, id("raise"), { selected: { t: [id("dead")] } });
  assert.equal(zoneOf(engine, id("dead")), "play");
  const before = influence(engine, P2);
  fight(engine, P1, [id("dead")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influence(engine, P2), 3);
});

clause(GF31F, "0:rule", "a 31f taken from the opponent this turn can attack this turn (it has not been under MY control since the start of the turn)", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = gfBoard(GF31F, { zone: "hand", handExtra: [{ key: "steal", def: steal, owner: P1, zone: "hand" }], extra: [{ key: "theirs", def: printing(GF31F), owner: P2, zone: "play" }] });
  play(engine, P1, id("steal"), { selected: { t: [id("theirs")] } });
  assert.equal(controllerOf(engine, id("theirs")), P1);
  const before = influence(engine, P2);
  fight(engine, P1, [id("theirs")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influence(engine, P2), 3, "it attacked the turn it changed hands");
});

clause(GF31F, "0:rule", "it can attack a location and be blocked like any attacker", () => {
  const { engine, id } = gfBoard(GF31F, { fresh: true, extra: [{ key: "place", def: location({ name: "Their Place", structure: 5 }), owner: P2, zone: "play" }] });
  fight(engine, P1, [id("gf")], { type: "card", cardId: id("place") }, []);
  assert.equal(damageOf(engine, id("place")), 3);
  const blocked = gfBoard(GF31F, { fresh: true });
  fight(blocked.engine, P1, [blocked.id("gf")], { type: "faction", playerId: P2 }, [blocked.id("blocker")]);
  assert.equal(damageOf(blocked.engine, blocked.id("blocker")), 3, "a blocker takes the damage");
});

clause(GF31F, "0:rule", "on the opponent's turn it does not matter: a 31f can attack only on its controller's turn", () => {
  const { engine, id } = gfBoard(GF31F, { fresh: true });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.throws(() => declareAttackBy(engine, P1, [id("gf")]), "not my turn");
});

// =============================================================================
// Guardforce Alpha Prime H4x0r
// UNIQUE GUARDFORCE ALPHA PRIME H4X0R
// This card can attack even if it has not been in play under your control since
// the start of the turn.
// If this card inflicts damage to a faction, you may play a resource.
// Character (guardforce, 31f), gearsmith, cost 5, threshold [E][E][E], 4 / 3 / 4.
// =============================================================================

const GFH4X = "0d08df2b-8e38-40d5-ad9b-f90d4af1fb7c";

// --- UNIQUE ------------------------------------------------------------------

function h4xDuplicateBoard() {
  return gfBoard(GFH4X, { elitism: 3, rage: 5, extra: [{ key: "gf2", def: printing(GFH4X), owner: P1, zone: "hand" }] });
}

for (const keep of ["gf", "gf2"] as const) {
  clause(GFH4X, "0:unique", `a second H4x0r: its controller is asked which to keep (keeping the ${keep === "gf" ? "old" : "new"} one); the other copy is destroyed`, () => {
    const { engine, id } = h4xDuplicateBoard();
    play(engine, P1, id("gf2"));
    const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
    sameCards(pc.candidates, [id("gf"), id("gf2")]);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    const gone = keep === "gf" ? "gf2" : "gf";
    assert.equal(zoneOf(engine, id(keep)), "play");
    assert.equal(zoneOf(engine, id(gone)), "discard");
    assert.equal(discard(engine, P1).includes(id(gone)), true, "into its owner's discard pile");
    assert.equal(engine.state.pendingChoice, undefined);
  });

  clause(GFH4X, "0:unique", `after the UNIQUE choice (keeping the ${keep === "gf" ? "old" : "new"} H4x0r) the deploy finishes and the game carries on`, () => {
    const { engine, id } = h4xDuplicateBoard();
    play(engine, P1, id("gf2"));
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.responseWindow, undefined, "the response window closed: the deploy is over");
    endTurn(engine, P1);
    assert.equal(engine.state.activePlayerId, P2, "the turn can be ended afterwards");
  });
}

clause(GFH4X, "0:unique", "the 'keep' answer must name one of the two H4x0rs", () => {
  const { engine, id } = h4xDuplicateBoard();
  play(engine, P1, id("gf2"));
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("oldAlly") } } as never));
  assert.ok(pending(engine), "pending(engine)");
  assert.equal(zoneOf(engine, id("gf")), "play");
  assert.equal(zoneOf(engine, id("gf2")), "play");
});

clause(GFH4X, "0:unique", "an H4x0r in hand while another is in play is no conflict", () => {
  const { engine, id } = h4xDuplicateBoard();
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("gf2")), "hand");
});

clause(GFH4X, "0:unique", "per player: the opponent may have their own H4x0r, with no choice and no destruction", () => {
  const { engine, id } = gfBoard(GFH4X, { extra: [{ key: "theirs", def: printing(GFH4X), owner: P2, zone: "play" }] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("gf")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(GFH4X, "0:unique", "the plain 31f (a different designation) is no duplicate of the H4x0r", () => {
  const { engine, id } = gfBoard(GFH4X, { extra: [{ key: "plain31f", def: printing(GF31F), owner: P1, zone: "play" }] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("gf")), "play");
  assert.equal(zoneOf(engine, id("plain31f")), "play");
});

// --- AGGRO ---------------------------------------------------------------------

clause(GFH4X, "1:rule", "an H4x0r that entered play this turn can attack: deployed (5, [E][E][E]) it hits the faction for its 4 strength at once", () => {
  const { engine, id } = gfBoard(GFH4X, { zone: "hand", elitism: 3, rage: 4 });
  const before = ready(engine);
  play(engine, P1, id("gf"));
  assert.equal(before - ready(engine), 5, "the printed cost of 5");
  const influenceBefore = influence(engine, P2);
  fightThrough(engine, P1, [id("gf")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceBefore - influence(engine, P2), 4);
});

clause(GFH4X, "1:rule", "it has AGGRO, an ordinary character doesn't; a depleted H4x0r still can't attack; the exception is its own", () => {
  const { engine, id } = gfBoard(GFH4X, { fresh: true, depleted: true });
  assert.equal(engine.getKeywords(id("gf")).includes("aggro"), true);
  assert.throws(() => declareAttackBy(engine, P1, [id("gf")]), "depleted");
  const ready2 = gfBoard(GFH4X, { fresh: true });
  assert.throws(() => declareAttackBy(ready2.engine, P1, [ready2.id("gf"), ready2.id("freshAlly")]), "the fresh ally can't go along");
  assert.equal(ready2.engine.state.battle, undefined);
});

clause(GFH4X, "1:rule", "control: an ordinary character that entered play this turn can not attack", () => {
  const { engine, id } = gfBoard(GFH4X);
  assert.throws(() => declareAttackBy(engine, P1, [id("freshAlly")]));
});

// --- the resource rule -----------------------------------------------------------

/** Plays out a battle where the H4x0r hits the faction, stopping at the "may play a resource" prompt. */
function h4xHitsFaction(opts: Parameters<typeof gfBoard>[1] = {}) {
  const board = gfBoard(GFH4X, { fresh: true, ...opts });
  declareAttackBy(board.engine, P1, [board.id("gf")]);
  board.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  let guard = 0;
  while (board.engine.state.battle && !board.engine.state.pendingChoice && guard++ < 30) autoResolveBattle(board.engine);
  return board;
}

/** Answers the "you may play a resource" prompt: accept (and pick `cardKey`) or decline. */
function answerPlayResource(engine: SpoilsEngine, id: (key: string) => string, accept: boolean, cardKey?: string) {
  const first = pending(engine);
  assert.ok(first, "a 'you may play a resource' prompt is open");
  assert.equal(first.playerId, P1);
  if (first.kind === "chooserSelectsOption") {
    const options = (first as unknown as { options: Array<{ label?: string }> }).options;
    const index = options.findIndex((o) => (accept ? !/decline|no\b|nothing/i.test(o.label ?? "") : /decline|no\b|nothing/i.test(o.label ?? "")));
    assert.ok(index >= 0, "the prompt offers both answers");
    answerPending(engine, "chooserSelectsOption", { index });
  } else if (first.kind === "mayPay") {
    answerPending(engine, "mayPay", { pay: accept });
  } else {
    assert.fail(`unexpected prompt ${first.kind}`);
  }
  if (accept && pending(engine)?.kind === "chooserSelectsTarget") {
    assert.ok(cardKey, "the test must name the card to play");
    pick(engine, [id(cardKey)]);
  }
  finishBattle(engine);
}

clause(GFH4X, "2:rule", "when it inflicts damage to a faction I may play a resource: accepting and picking a resource card from hand puts it into play face-up as a resource", () => {
  const { engine, id } = h4xHitsFaction();
  assert.equal(influence(engine, P2), 26, "control: the faction took the 4 damage (30 - 4)");
  const readyBefore = ready(engine);
  answerPlayResource(engine, id, true, "handRes");
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(engine.isResource(id("handRes")), true);
  assert.equal(ready(engine), readyBefore + 1, "one more available resource");
  assert.equal(hand(engine, P1).includes(id("handRes")), false);
});

clause(GFH4X, "2:rule", "...any card can be played as a resource face-down: a character from hand goes in face-down (a Volition resource)", () => {
  const { engine, id } = h4xHitsFaction();
  const readyBefore = ready(engine);
  const volitionBefore = engine.getThresholds(P1).volition ?? 0;
  answerPlayResource(engine, id, true, "handChar");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(ready(engine), readyBefore + 1);
  assert.equal(engine.getThresholds(P1).volition ?? 0, volitionBefore + 1, "a face-down card provides Volition");
});

clause(GFH4X, "2:rule","'play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2)", () => holdResourceFace(() => {
  const { engine, id } = h4xHitsFaction();
  const first = pending(engine);
  assert.ok(first, "first");
  if (first.kind === "chooserSelectsOption") {
    const options = (first as unknown as { options: Array<{ label?: string }> }).options;
    answerPending(engine, "chooserSelectsOption", { index: options.findIndex((o) => !/decline/i.test(o.label ?? "")) });
  }
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("handRes")] } } as never);
  resolvePendingResponses(engine);
  const asked = engine.state.pendingChoice !== undefined && engine.state.cards[id("handRes")].zone === "hand";
  const faceDown = engine.state.cards[id("handRes")].zone === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(GFH4X, "2:rule", "'you may': declining plays no resource", () => {
  const { engine, id } = h4xHitsFaction();
  const readyBefore = ready(engine);
  answerPlayResource(engine, id, false);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
  assert.equal(ready(engine), readyBefore);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GFH4X, "2:rule", "exactly one resource: after playing one, the other hand cards stay in hand", () => {
  const { engine, id } = h4xHitsFaction();
  answerPlayResource(engine, id, true, "handRes");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
  assert.equal(engine.state.pendingChoice, undefined, "no second prompt");
});

clause(GFH4X, "2:rule", "the card to play comes from MY hand: cards in play, the opponent's cards and my deck can't be chosen", () => {
  const { engine, id } = h4xHitsFaction({ extra: [{ key: "myDeckCard", def: character({ name: "My Deck Card" }), owner: P1, zone: "deck" }, { key: "theirHandCard", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }] });
  const first = pending(engine);
  assert.ok(first, "first");
  if (first.kind === "chooserSelectsOption") {
    const options = (first as unknown as { options: Array<{ label?: string }> }).options;
    answerPending(engine, "chooserSelectsOption", { index: options.findIndex((o) => !/decline/i.test(o.label ?? "")) });
  }
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  assert.throws(() => pick(engine, [id("oldAlly")]), "a card in play");
  assert.throws(() => pick(engine, [id("theirHandCard")]), "the opponent's hand");
  assert.throws(() => pick(engine, [id("myDeckCard")]), "my deck");
  pick(engine, [id("handRes")]);
  finishBattle(engine);
  assert.equal(zoneOf(engine, id("handRes")), "play", "control: a card from my hand is accepted");
});

clause(GFH4X, "2:rule", "it is not the Develop Rule: playing a resource this way leaves my Develop Rule available for the turn", () => {
  const { engine, id } = h4xHitsFaction();
  answerPlayResource(engine, id, true, "handRes");
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule has not been used");
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play", "control: the Develop Rule still works afterwards");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
});

clause(GFH4X, "2:rule", "'inflicts damage to a FACTION': when it is blocked and damages a character instead, there is no prompt", () => {
  const { engine, id } = gfBoard(GFH4X, { fresh: true });
  fightThrough(engine, P1, [id("gf")], { type: "faction", playerId: P2 }, [id("blocker")]);
  assert.equal(damageOf(engine, id("blocker")), 4, "control: it damaged the blocker");
  assert.equal(engine.state.pendingChoice, undefined, "no prompt: the damage went to a character");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
});

clause(GFH4X, "2:rule", "...nor when it damages a location", () => {
  const { engine, id } = gfBoard(GFH4X, { fresh: true, extra: [{ key: "place", def: location({ name: "Their Place", structure: 9 }), owner: P2, zone: "play" }] });
  fightThrough(engine, P1, [id("gf")], { type: "card", cardId: id("place") }, []);
  assert.equal(damageOf(engine, id("place")), 4, "control: it damaged the location");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
});

clause(GFH4X, "2:rule", "only when THIS card inflicts the damage: another attacker's damage to the faction doesn't prompt (the H4x0r stays home)", () => {
  const { engine, id } = gfBoard(GFH4X);
  fightThrough(engine, P1, [id("oldAlly")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.pendingChoice, undefined, "no prompt");
  assert.equal(influence(engine, P2), 28, "control: the faction took damage from the ally");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
});

clause(GFH4X, "2:rule", "in a party with another attacker the H4x0r's own damage still prompts, once", () => {
  const { engine, id } = gfBoard(GFH4X, { fresh: true });
  declareAttackBy(engine, P1, [id("gf"), id("oldAlly")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  let guard = 0;
  while (engine.state.battle && !engine.state.pendingChoice && guard++ < 30) autoResolveBattle(engine);
  assert.ok(pending(engine), "a prompt appears for the H4x0r's damage");
  answerPlayResource(engine, id, true, "handRes");
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "only one prompt for one H4x0r");
  assert.equal(influence(engine, P2), 24, "control: 4 + 2 damage in all");
});

clause(GFH4X, "2:rule", "with nothing in hand to play there is nothing to pick, and nothing breaks", () => {
  const { engine, id } = gfBoard(GFH4X, { fresh: true, noHand: true });
  assert.equal(hand(engine, P1).length, 0);
  declareAttackBy(engine, P1, [id("gf")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  let guard = 0;
  while (engine.state.battle && guard++ < 30) {
    if (engine.state.pendingChoice) {
      const pc = pending(engine)!;
      if (pc.kind === "chooserSelectsOption") answerPending(engine, "chooserSelectsOption", { index: 1 });
      else pick(engine, []);
    } else autoResolveBattle(engine);
  }
  assert.equal(engine.state.battle, undefined);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(influence(engine, P2), 26);
});

// @@END@@
