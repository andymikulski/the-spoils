// Clause tests — batch open-beta-08. See docs/TESTING.md and
// `npm run card-tests -- manifest open-beta-08`. Expectations come from each
// card's PRINTED text and RULES.md; engine data (ability ids, declaration ids,
// choice kinds) is only used to DRIVE the engine.

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
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, holdResourceFace } from "./_clause.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, readyCount, setupGame, developOffers, endTurnRaw, settleStartFirst } from "./_turn.js";
import type { SpoilsEngine } from "../../../engine.js";
import type { CardDefinition } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

type Player = typeof P1 | typeof P2;

/** Raw `playCard` without draining the response window (use `play` from the harness to drain it). */
function playRaw(engine: SpoilsEngine, player: Player, cardId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "playCard", playerId: player, cardId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** Raw `activateAbility` without draining the response window. */
function activateRaw(engine: SpoilsEngine, player: Player, cardId: string, abilityId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** Answers the open pending choice (as the player it is for, unless told otherwise) and drains response windows. */
function answer(engine: SpoilsEngine, choice: unknown, player?: Player) {
  const pc = engine.state.pendingChoice as unknown as { playerId: Player } | undefined;
  assert.ok(pc, "a pending choice is open");
  engine.perform({ type: "resolvePendingChoice", playerId: player ?? pc.playerId, choice } as never);
  resolvePendingResponses(engine);
}

const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as { kind: string; playerId: Player; [key: string]: unknown } | undefined;

/** Every logged event of a type. */
const eventsOf = (engine: SpoilsEngine, type: string) => engine.getLog().filter((entry) => (entry.event as unknown as { type: string } | undefined)?.type === type).map((entry) => entry.event as unknown as Record<string, unknown>);

const zoneOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].zone;
const damageOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].damage ?? 0;
const influenceOf = (engine: SpoilsEngine, player: Player) => engine.state.players[player].influence;

/** Declares an attack by `attackers` on the faction of `defender`, drains the declaration window. */
function declareAttack(engine: SpoilsEngine, attacker: Player, attackerIds: string[], target?: { type: "faction"; playerId: Player } | { type: "location"; cardId: string }) {
  const defender: Player = attacker === P1 ? P2 : P1;
  engine.perform({ type: "declareAttack", playerId: attacker, attackerIds, target: target ?? { type: "faction", playerId: defender } } as never);
  resolvePendingResponses(engine);
}

/** The defender declares `blockerIds` (possibly none), draining the window that follows. */
function declareBlockers(engine: SpoilsEngine, defender: Player, blockerIds: string[]) {
  engine.perform({ type: "declareBlockers", playerId: defender, blockerIds } as never);
  resolvePendingResponses(engine);
}

/** A free tactic that depletes one chosen character (id `dep`, declaration `t`). */
const DEPLETER = tactic({
  name: "Depleter",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "dep",
        type: "activated",
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "deplete", target: { type: "selected", id: "t" } }]
      }
    ]
  }
});

/** A free tactic that does nothing (id `noop`): something for the other player to respond to. */
const NOOP = tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });

/** `player` plays their Noop tactic from hand (key `noop`), leaving its response window open for the opponent. */
function playNoopOnOwnTurn(engine: SpoilsEngine, id: (key: string) => string, player: Player) {
  playRaw(engine, player, id("noop"));
  assert.ok(engine.state.responseWindow, "the opponent may respond");
}

/** A free tactic that deals N damage to one chosen character (id `hit`, declaration `t`). */
const hitter = (amount: number, name = `Hit${amount}`) =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "hit",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A character with an attached-style strength modifier carrier: an item that gives the character it is attached to +N strength. */
const strengthGear = (amount: number, name = "Gear") =>
  item({
    name,
    attachTo: "character",
    behavior: { abilities: [{ id: "gear", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: amount }] }] }
  });

// =============================================================================
// Flaming Barduse
// COST: You may pick up to 2 characters. -- When this card enters play, if you
// picked characters as part of its cost then inflict up to 2 damage divided
// however you want to the characters.
// Character (dragon), cost 3, threshold [R][R], 1 strength / 2 speed / 1 life.
// =============================================================================

const BARDUSE = "6e28ba40-77e6-471f-9872-ec49f0a8e4e8";

function barduseBoard(opts: { rage?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fb", def: printing(BARDUSE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 5 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", life: 1 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", life: 5 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      { key: "handguy", def: character({ name: "Hand Guy" }), owner: P1, zone: "hand" },
      { key: "gone", def: character({ name: "Gone" }), owner: P2, zone: "discard" },
      ...bank("rage", opts.rage ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Plays the Barduse picking `picked` as its cost and drains the response window; the damage distribution is then open (if any pick was made). */
function barduseWith(picked: string[], opts: { rage?: number; greed?: number } = {}) {
  const board = barduseBoard(opts);
  const { engine, id } = board;
  play(engine, P1, id("fb"), { selected: { picked: picked.map(id) } });
  return board;
}

const distribute = (engine: SpoilsEngine, shares: Record<string, number>) => answer(engine, { kind: "distributeAmong", shares });

clause(BARDUSE, "0:ability", "with no characters picked (the pick is optional) it deploys for 3, asks nothing and damages nothing", () => {
  const { engine, id } = barduseBoard();
  const before = readyCount(engine, P1);
  play(engine, P1, id("fb"), { selected: { picked: [] } });
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(before - readyCount(engine, P1), 3, "the printed cost of 3 is paid");
  assert.equal(pending(engine), undefined, "nothing to distribute, so no prompt");
  for (const key of ["mine", "mine2", "foe", "foe2", "weak", "bystander", "fb"]) assert.equal(damageOf(engine, id(key)), 0, `${key} takes no damage`);
  assert.equal(engine.getStat(id("fb"), "strength"), 1);
  assert.equal(engine.getStat(id("fb"), "speed"), 2);
  assert.equal(engine.getStat(id("fb"), "life"), 1);
});

clause(BARDUSE, "0:ability", "deploys with no `picked` selection at all (up to 2 includes none)", () => {
  const { engine, id } = barduseBoard();
  play(engine, P1, id("fb"), {});
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(pending(engine), undefined);
});

clause(BARDUSE, "0:ability", "picking one character is accepted and pays exactly 3", () => {
  const { engine, id } = barduseBoard();
  const before = readyCount(engine, P1);
  play(engine, P1, id("fb"), { selected: { picked: [id("foe")] } });
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(before - readyCount(engine, P1), 3);
  assert.equal(attachedCount(engine, P1), 3);
  assert.equal(pending(engine)?.kind, "distributeAmong");
});

clause(BARDUSE, "0:ability", "picking two characters is accepted (one of mine, one of theirs)", () => {
  const { engine, id } = barduseBoard();
  play(engine, P1, id("fb"), { selected: { picked: [id("mine"), id("foe")] } });
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(pending(engine)?.kind, "distributeAmong");
  assert.deepEqual([...(pending(engine)!.targets as string[])].sort(), [id("mine"), id("foe")].sort(), "the distribution is among exactly the picked characters");
});

clause(BARDUSE, "0:ability", "picking three characters is refused (up to 2)", () => {
  const { engine, id } = barduseBoard();
  assert.throws(() => playRaw(engine, P1, id("fb"), { selected: { picked: [id("mine"), id("foe"), id("foe2")] } }));
  assert.equal(zoneOf(engine, id("fb")), "hand", "nothing was played");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
});

clause(BARDUSE, "0:ability", "the same character cannot be picked twice to count as two", () => {
  const { engine, id } = barduseBoard();
  assert.throws(() => playRaw(engine, P1, id("fb"), { selected: { picked: [id("foe"), id("foe")] } }));
  assert.equal(zoneOf(engine, id("fb")), "hand");
});

clause(BARDUSE, "0:ability", "only characters in play can be picked: not an item, a location, a faction, a face-down resource, or a card in hand / discard", () => {
  const { engine, id } = barduseBoard();
  const refused = (key: string | undefined, raw?: string) =>
    assert.throws(() => playRaw(engine, P1, id("fb"), { selected: { picked: [raw ?? id(key!)] } }), key ?? raw);
  refused("thing");
  refused("place");
  refused("facedown");
  refused("handguy");
  refused("gone");
  refused(undefined, engine.state.players[P2].factionId!);
  refused(undefined, engine.state.players[P1].factionId!);
  assert.equal(zoneOf(engine, id("fb")), "hand");
});

clause(BARDUSE, "0:ability", "the card being played cannot pick itself (it is not in play while its cost is paid)", () => {
  const { engine, id } = barduseBoard();
  assert.throws(() => playRaw(engine, P1, id("fb"), { selected: { picked: [id("fb")] } }));
  assert.equal(zoneOf(engine, id("fb")), "hand");
});

clause(BARDUSE, "0:ability", "is refused one resource short of its cost of 3, and nothing is picked or paid", () => {
  const short = barduseBoard({ rage: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("fb"), { selected: { picked: [short.id("foe")] } }));
  assert.equal(zoneOf(short.engine, short.id("fb")), "hand");
  assert.equal(attachedCount(short.engine, P1), 0);
  const exact = barduseBoard({ rage: 3 });
  play(exact.engine, P1, exact.id("fb"), { selected: { picked: [] } });
  assert.equal(zoneOf(exact.engine, exact.id("fb")), "play", "exactly 3 resources is enough");
});

clause(BARDUSE, "0:ability", "is refused without [R][R] even with enough other resources; [R][R] plus another resource is enough", () => {
  const noThreshold = barduseBoard({ rage: 1, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("fb"), { selected: { picked: [] } }), "only one [R]");
  const none = barduseBoard({ rage: 0, greed: 5 });
  assert.throws(() => playRaw(none.engine, P1, none.id("fb"), { selected: { picked: [] } }), "no [R]");
  const ok = barduseBoard({ rage: 2, greed: 1 });
  play(ok.engine, P1, ok.id("fb"), { selected: { picked: [] } });
  assert.equal(zoneOf(ok.engine, ok.id("fb")), "play");
  assert.equal(readyCount(ok.engine, P1), 0, "the icons are paid for like any resource: all three are spent");
});

clause(BARDUSE, "0:ability", "picking as a cost does not damage anything while the card is still being deployed (the damage is on entering play)", () => {
  const { engine, id } = barduseBoard();
  playRaw(engine, P1, id("fb"), { selected: { picked: [id("foe")] } });
  assert.ok(engine.state.responseWindow, "the opponent may respond to the card being deployed");
  assert.equal(zoneOf(engine, id("fb")), "deploying");
  assert.equal(damageOf(engine, id("foe")), 0, "no damage yet");
  assert.equal(pending(engine), undefined, "no distribution yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(pending(engine)?.kind, "distributeAmong", "now that it has entered play, the damage is divided");
});

clause(BARDUSE, "1:rule", "one picked character: up to 2 damage, here all 2 on it; nothing else takes damage", () => {
  const { engine, id } = barduseWith(["foe"]);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "distributeAmong");
  assert.equal(pc.amount, 2, "up to 2 damage");
  assert.equal(pc.playerId, P1, "the Barduse's controller divides the damage");
  distribute(engine, { [id("foe")]: 2 });
  assert.equal(damageOf(engine, id("foe")), 2);
  for (const key of ["mine", "mine2", "foe2", "weak", "bystander", "fb"]) assert.equal(damageOf(engine, id(key)), 0, `${key} is not damaged`);
  assert.equal(pending(engine), undefined);
});

clause(BARDUSE, "1:rule", "one picked character: 'up to' 2 means 1 damage is allowed", () => {
  const { engine, id } = barduseWith(["foe"]);
  distribute(engine, { [id("foe")]: 1 });
  assert.equal(damageOf(engine, id("foe")), 1);
});

clause(BARDUSE, "1:rule", "one picked character: 'up to' 2 means 0 damage is allowed", () => {
  const { engine, id } = barduseWith(["foe"]);
  distribute(engine, {});
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(BARDUSE, "1:rule", "two picked characters: divided 1 and 1", () => {
  const { engine, id } = barduseWith(["foe", "foe2"]);
  distribute(engine, { [id("foe")]: 1, [id("foe2")]: 1 });
  assert.equal(damageOf(engine, id("foe")), 1);
  assert.equal(damageOf(engine, id("foe2")), 1);
});

clause(BARDUSE, "1:rule", "two picked characters: divided 2 and 0 (either way round)", () => {
  const a = barduseWith(["foe", "foe2"]);
  distribute(a.engine, { [a.id("foe")]: 2 });
  assert.equal(damageOf(a.engine, a.id("foe")), 2);
  assert.equal(damageOf(a.engine, a.id("foe2")), 0);
  const b = barduseWith(["foe", "foe2"]);
  distribute(b.engine, { [b.id("foe2")]: 2 });
  assert.equal(damageOf(b.engine, b.id("foe")), 0);
  assert.equal(damageOf(b.engine, b.id("foe2")), 2);
});

clause(BARDUSE, "1:rule", "two picked characters: 'up to 2' allows dividing only 1 in total, or none", () => {
  const one = barduseWith(["foe", "foe2"]);
  distribute(one.engine, { [one.id("foe2")]: 1 });
  assert.equal(damageOf(one.engine, one.id("foe")), 0);
  assert.equal(damageOf(one.engine, one.id("foe2")), 1);
  const zero = barduseWith(["foe", "foe2"]);
  distribute(zero.engine, {});
  assert.equal(damageOf(zero.engine, zero.id("foe")) + damageOf(zero.engine, zero.id("foe2")), 0);
});

clause(BARDUSE, "1:rule", "the damage cannot be divided more than 2 in total, nor onto a character that was not picked", () => {
  const { engine, id } = barduseWith(["foe", "foe2"]);
  assert.throws(() => distribute(engine, { [id("foe")]: 2, [id("foe2")]: 1 }), "3 in total");
  assert.throws(() => distribute(engine, { [id("foe")]: 3 }), "3 on one");
  assert.throws(() => distribute(engine, { [id("bystander")]: 1 }), "an unpicked character");
  assert.throws(() => distribute(engine, { [id("fb")]: 1 }), "the Barduse itself");
  assert.equal(pending(engine)?.kind, "distributeAmong", "still waiting for a legal division");
  distribute(engine, { [id("foe")]: 1, [id("foe2")]: 1 });
  assert.equal(damageOf(engine, id("bystander")), 0);
});

clause(BARDUSE, "1:rule", "the picked characters may be my own: a pick of mine can take the damage", () => {
  const { engine, id } = barduseWith(["mine", "foe"]);
  distribute(engine, { [id("mine")]: 2 });
  assert.equal(damageOf(engine, id("mine")), 2);
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(damageOf(engine, id("mine2")), 0, "my other character is untouched");
});

clause(BARDUSE, "1:rule", "the controller (not the picked characters' controller) decides the division, even when only opposing characters were picked", () => {
  const { engine, id } = barduseWith(["foe", "foe2"]);
  assert.equal(pending(engine)?.playerId, P1);
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "distributeAmong", shares: { [id("foe")]: 2 } } } as never), "the opponent cannot divide it");
  distribute(engine, { [id("foe")]: 2 });
  assert.equal(damageOf(engine, id("foe")), 2);
});

clause(BARDUSE, "1:rule", "damage that is lethal destroys the character", () => {
  const { engine, id } = barduseWith(["weak", "foe"]);
  distribute(engine, { [id("weak")]: 1, [id("foe")]: 1 });
  assert.equal(zoneOf(engine, id("weak")), "discard", "a 1-life character with 1 damage is destroyed");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(damageOf(engine, id("foe")), 1);
});

clause(BARDUSE, "1:rule", "damage on my own picked character is real: 2 damage destroys a 2-life character of mine", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fb", def: printing(BARDUSE), owner: P1, zone: "hand" },
      { key: "frail", def: character({ name: "Frail", life: 2 }), owner: P1, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  play(engine, P1, id("fb"), { selected: { picked: [id("frail")] } });
  distribute(engine, { [id("frail")]: 2 });
  assert.equal(zoneOf(engine, id("frail")), "discard");
});

clause(BARDUSE, "1:rule", "only the picked characters are damaged: the unpicked, items, locations and factions are not", () => {
  const { engine, id } = barduseWith(["foe"]);
  const factionInfluence = influenceOf(engine, P2);
  distribute(engine, { [id("foe")]: 2 });
  assert.equal(damageOf(engine, id("thing")), 0);
  assert.equal(damageOf(engine, id("place")), 0);
  assert.equal(influenceOf(engine, P2), factionInfluence, "the opposing faction is untouched");
  assert.equal(influenceOf(engine, P1), 30);
});

clause(BARDUSE, "1:rule", "if no characters were picked there is no damage even when characters are in play (not even to them all)", () => {
  const { engine, id } = barduseWith([]);
  assert.equal(pending(engine), undefined);
  for (const key of ["mine", "mine2", "foe", "foe2", "weak", "bystander"]) assert.equal(damageOf(engine, id(key)), 0);
  assert.equal(zoneOf(engine, id("weak")), "play");
});

clause(BARDUSE, "1:rule", "only when it ENTERS PLAY with characters picked as part of its cost: put into play by an effect (nothing picked) there is no damage", () => {
  const REANIMATE = tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fb", def: printing(BARDUSE), owner: P1, zone: "discard" },
      { key: "re", def: REANIMATE, owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" }
    ]
  });
  play(engine, P1, id("re"), { selected: { t: [id("fb")] } });
  assert.equal(zoneOf(engine, id("fb")), "play", "the Barduse entered play");
  assert.equal(pending(engine), undefined, "no characters were picked as part of its cost, so nothing is divided");
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(BARDUSE, "1:rule", "the damage happens each time it is deployed with picks (a second Barduse from hand does it again)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fb1", def: printing(BARDUSE), owner: P1, zone: "hand" },
      { key: "fb2", def: printing(BARDUSE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      ...bank("rage", 6, P1)
    ]
  });
  play(engine, P1, id("fb1"), { selected: { picked: [id("foe")] } });
  distribute(engine, { [id("foe")]: 2 });
  play(engine, P1, id("fb2"), { selected: { picked: [id("foe")] } });
  distribute(engine, { [id("foe")]: 2 });
  assert.equal(damageOf(engine, id("foe")), 4);
});

// =============================================================================
// Gruesome Trophies
// At the start of your turn, you may pick a character. If you do, deplete that
// character. Item, cost 6, threshold [R].
// =============================================================================

const TROPHIES = "03f31f27-dfd2-4802-acd0-340f65683e89";

/** P2's turn is active (so ending it starts P1's). P1 controls the Trophies unless `controller` says otherwise. */
function trophiesBoard(opts: { controller?: Player; rage?: number; greed?: number; second?: boolean; hand?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.controller === P2 ? P1 : P2,
    turn: 2,
    cards: [
      { key: "tr", def: printing(TROPHIES), owner: P1, zone: opts.hand ? "hand" : "play", controller: opts.controller ?? P1 },
      ...(opts.second ? [{ key: "tr2", def: printing(TROPHIES), owner: P1, zone: "play" as const }] : []),
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 5 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      { key: "a2", def: character({ name: "A2" }), owner: P1, zone: "deck" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "deck" },
      { key: "b2", def: character({ name: "B2" }), owner: P2, zone: "deck" },
      ...bank("rage", opts.rage ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const depletedKeys = (engine: SpoilsEngine, id: (key: string) => string, keys: string[]) => keys.filter((key) => engine.state.cards[id(key)].depleted);

/** P1's turn starts (P2 ends theirs); returns with the Trophies' pick open (if the engine asks one). */
const startP1Turn = (engine: SpoilsEngine) => endTurn(engine, P2);

clause(TROPHIES, "0:rule", "at the start of my turn I am asked to pick a character; picking an opponent's character depletes it and only it", () => {
  const { engine, id } = trophiesBoard();
  startP1Turn(engine);
  assert.equal(engine.state.activePlayerId, P1);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Trophies' controller picks");
  answer(engine, { kind: "chooserSelectsTarget", selected: [id("foe")] });
  assert.deepEqual(depletedKeys(engine, id, ["mine", "mine2", "foe", "foe2"]), ["foe"], "exactly the picked character is depleted");
  assert.equal(pending(engine), undefined);
});

clause(TROPHIES, "0:rule", "I may pick one of my own characters: it is depleted", () => {
  const { engine, id } = trophiesBoard();
  startP1Turn(engine);
  answer(engine, { kind: "chooserSelectsTarget", selected: [id("mine")] });
  assert.deepEqual(depletedKeys(engine, id, ["mine", "mine2", "foe", "foe2"]), ["mine"]);
});

clause(TROPHIES, "0:rule", "'you may': declining to pick leaves every character ready", () => {
  const { engine, id } = trophiesBoard();
  startP1Turn(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "it is offered");
  answer(engine, { kind: "chooserSelectsTarget", selected: [] });
  assert.deepEqual(depletedKeys(engine, id, ["mine", "mine2", "foe", "foe2"]), []);
  assert.equal(pending(engine), undefined);
});

clause(TROPHIES, "0:rule", "only characters can be picked: not an item (not even the Trophies), a location, a faction or a face-down resource", () => {
  const { engine, id } = trophiesBoard();
  startP1Turn(engine);
  const refused = (cardId: string, label: string) =>
    assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never), label);
  refused(id("thing"), "item");
  refused(id("tr"), "the Trophies itself is an item");
  refused(id("place"), "location");
  refused(id("facedown"), "face-down resource");
  refused(engine.state.players[P2].factionId!, "opponent's faction");
  refused(engine.state.players[P1].factionId!, "own faction");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  assert.equal(engine.state.cards[engine.state.players[P2].factionId!].depleted, false);
});

clause(TROPHIES, "0:rule", "only ONE character is picked: two are refused", () => {
  const { engine, id } = trophiesBoard();
  startP1Turn(engine);
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("foe"), id("foe2")] } } as never));
  answer(engine, { kind: "chooserSelectsTarget", selected: [id("foe")] });
  assert.deepEqual(depletedKeys(engine, id, ["foe", "foe2"]), ["foe"]);
});

clause(TROPHIES, "0:rule", "the opponent does not get to pick: only I am asked, and they cannot answer for me", () => {
  const { engine, id } = trophiesBoard();
  startP1Turn(engine);
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("mine")] } } as never));
  assert.equal(pending(engine)?.playerId, P1);
});

clause(TROPHIES, "0:rule", "it is START of my turn: the pick is offered as soon as my turn begins (before I take any action)", () => {
  const { engine } = trophiesBoard();
  engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(engine);
  settleStartFirst(engine); // my turn start's Restore and Develop Rules come first
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
});

clause(TROPHIES, "0:rule", "the character stays depleted for my turn: a depleted opposing character cannot block my attack", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "tr", def: printing(TROPHIES), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "guard", def: character({ name: "Guard", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "deck" }
    ]
  });
  startP1Turn(engine);
  answer(engine, { kind: "chooserSelectsTarget", selected: [id("guard")] });
  assert.equal(engine.state.cards[id("guard")].depleted, true);
  declareAttack(engine, P1, [id("atk")]);
  assert.throws(() => declareBlockers(engine, P2, [id("guard")]), "the depleted Guard cannot block");
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30 - 2, "the unblocked attacker hit the faction");
});

clause(TROPHIES, "0:rule", "it triggers at the start of EVERY one of my turns", () => {
  const { engine, id } = trophiesBoard();
  startP1Turn(engine);
  answer(engine, { kind: "chooserSelectsTarget", selected: [id("foe")] });
  endTurn(engine, P1); // P2's turn: restore frees their Foe
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(pending(engine), undefined, "not at the start of the opponent's turn");
  endTurn(engine, P2); // P1's turn again
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "offered again");
  answer(engine, { kind: "chooserSelectsTarget", selected: [id("foe2")] });
  assert.equal(engine.state.cards[id("foe2")].depleted, true);
});

clause(TROPHIES, "0:rule", "not at the start of the OPPONENT's turn: no pick is offered and nothing is depleted", () => {
  const { engine, id } = trophiesBoard();
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  endTurn(engine, P1); // P2's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(depletedKeys(engine, id, ["mine", "mine2", "foe", "foe2"]), []);
});

clause(TROPHIES, "0:rule", "'your turn' is the controller's turn: a Trophies I own but the opponent controls triggers for them, not me", () => {
  const { engine, id } = trophiesBoard({ controller: P2 });
  // P1 is active; ending P1's turn starts P2's turn: the controller (P2) is asked.
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the controller picks");
  answer(engine, { kind: "chooserSelectsTarget", selected: [id("mine")] });
  assert.equal(engine.state.cards[id("mine")].depleted, true);
  // and at the start of my own (owner's) turn it does nothing
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine), undefined, "no pick at the start of the owner's turn");
});

clause(TROPHIES, "0:rule", "the Trophies must be in play: one in my hand does nothing", () => {
  const { engine } = trophiesBoard({ hand: true });
  startP1Turn(engine);
  assert.equal(pending(engine), undefined);
});

clause(TROPHIES, "0:rule", "two Trophies each give a pick: two different characters can be depleted", () => {
  const { engine, id } = trophiesBoard({ second: true });
  startP1Turn(engine);
  const picks = [id("foe"), id("foe2")];
  let n = 0;
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [picks[n++]] };
    return declineAll(pc);
  });
  assert.equal(n, 2, "asked twice");
  assert.deepEqual(depletedKeys(engine, id, ["foe", "foe2", "mine", "mine2"]), ["foe", "foe2"]);
});

clause(TROPHIES, "0:rule", "is refused one resource short of its cost of 6", () => {
  const { engine, id } = trophiesBoard({ rage: 5, hand: true });
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  assert.throws(() => playRaw(engine, P1, id("tr")));
  assert.equal(zoneOf(engine, id("tr")), "hand");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(TROPHIES, "0:rule", "deploys for exactly 6 with [R] and then is a plain item in play", () => {
  const { engine, id } = trophiesBoard({ rage: 6, hand: true });
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  play(engine, P1, id("tr"));
  assert.equal(zoneOf(engine, id("tr")), "play");
  assert.equal(attachedCount(engine, P1), 6, "the printed cost of 6 is paid");
  assert.equal(engine.getDefinition(id("tr")).type, "item");
});

clause(TROPHIES, "0:rule", "is refused without [R] even with plenty of other resources", () => {
  const { engine, id } = trophiesBoard({ rage: 0, greed: 9, hand: true });
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  assert.throws(() => playRaw(engine, P1, id("tr")));
  assert.equal(zoneOf(engine, id("tr")), "hand");
});

// =============================================================================
// Hammer Smash
// COST: Flip a coin. If you win, X is 2 otherwise X is 1. Pick up to X items.
// EFFECT: Destroy the items. Tactic, cost 2, threshold [R][R].
// The flip is driven by the engine's RNG; `random` below pins it.
// =============================================================================

const HAMMER = "2fcbabbe-1a09-4d83-a419-8f08c8bf6f90";
const WIN_OR_LOSE = [0.1, 0.9]; // one of these is a win, the other a loss, whichever way the engine reads its RNG

function hammerBoard(random: number, opts: { rage?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => random,
    cards: [
      { key: "hs", def: printing(HAMMER), owner: P1, zone: "hand" },
      { key: "i1", def: item({ name: "I1" }), owner: P2, zone: "play" },
      { key: "i2", def: item({ name: "I2" }), owner: P2, zone: "play" },
      { key: "i3", def: item({ name: "I3" }), owner: P1, zone: "play" },
      { key: "i4", def: item({ name: "I4" }), owner: P2, zone: "play" },
      { key: "c1", def: character({ name: "C1" }), owner: P2, zone: "play" },
      { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      { key: "handItem", def: item({ name: "Hand Item" }), owner: P2, zone: "hand" },
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Plays Hammer Smash; the coin is flipped and the picks are then asked of the player. */
function hammerStart(board: ReturnType<typeof hammerBoard>) {
  playRaw(board.engine, P1, board.id("hs"));
  const pc = pending(board.engine);
  assert.ok(pc, "a pending choice asks for the item picks after the flip");
  assert.equal(pc.kind, "selectDeployTargets");
  assert.equal(pc.playerId, P1);
  return pc;
}

/** Offers `keys` as the picks; true when the engine accepts them (the card then resolves). */
function hammerPick(board: ReturnType<typeof hammerBoard>, keys: string[]): boolean {
  try {
    board.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: keys.map(board.id) } } } as never);
  } catch {
    return false;
  }
  resolvePendingResponses(board.engine);
  drain(board.engine, declineAll);
  return true;
}

/** How many items may be picked under this roll: 2 if two are accepted, 1 if only one, 0 otherwise. */
function hammerCapacity(random: number): number {
  const two = hammerBoard(random);
  hammerStart(two);
  if (hammerPick(two, ["i1", "i2"])) return 2;
  const one = hammerBoard(random);
  hammerStart(one);
  return hammerPick(one, ["i1"]) ? 1 : 0;
}

const winRoll = () => WIN_OR_LOSE.find((r) => hammerCapacity(r) === 2);
const loseRoll = () => WIN_OR_LOSE.find((r) => hammerCapacity(r) === 1);

clause(HAMMER, "0:ability", "the coin flip decides X: one outcome allows picking 2 items (X is 2), the other only 1 (X is 1)", () => {
  assert.deepEqual([hammerCapacity(0.1), hammerCapacity(0.9)].sort(), [1, 2]);
});

clause(HAMMER, "0:ability", "the flip is a COIN FLIP: it is logged as one", () => {
  const board = hammerBoard(0.1);
  hammerStart(board);
  assert.ok(eventsOf(board.engine, "coinFlipped").length >= 1, "a coin flip is recorded in the game log");
});

clause(HAMMER, "0:ability", "a coin-flip replacement (Two-Headed Coin: 'if you lose a coin flip, ... reflip') applies to Hammer Smash's flip", () => {
  const TWO_HEADED_COIN = printing("90a28359-1bad-419f-bd94-1566b810853f");
  let offered = 0;
  for (const random of WIN_OR_LOSE) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      random: () => random,
      cards: [
        { key: "hs", def: printing(HAMMER), owner: P1, zone: "hand" },
        { key: "coin", def: TWO_HEADED_COIN, owner: P1, zone: "play" },
        { key: "i1", def: item({ name: "I1" }), owner: P2, zone: "play" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("rage", 4, P1)
      ]
    });
    playRaw(engine, P1, id("hs"));
    if (pending(engine)?.kind === "coinFlipReplace") offered++;
  }
  assert.equal(offered, 1, "exactly the losing flip offers the reflip");
});

clause(HAMMER, "0:ability", "on a win X is 2: two items can be picked and both are destroyed (mine or theirs)", () => {
  const r = winRoll();
  assert.notEqual(r, undefined, "one outcome is the win");
  const board = hammerBoard(r!);
  const before = readyCount(board.engine, P1);
  hammerStart(board);
  assert.ok(hammerPick(board, ["i1", "i3"]), "hammerPick(board, [\"i1\", \"i3\"])");
  assert.equal(zoneOf(board.engine, board.id("i1")), "discard");
  assert.equal(zoneOf(board.engine, board.id("i3")), "discard", "my own item can be destroyed too");
  for (const key of ["i2", "i4"]) assert.equal(zoneOf(board.engine, board.id(key)), "play", `${key} was not picked`);
  assert.equal(before - readyCount(board.engine, P1), 2, "the printed cost of 2 is paid");
  assert.equal(zoneOf(board.engine, board.id("hs")), "discard", "the tactic ends in its owner's discard pile");
});

clause(HAMMER, "0:ability", "on a win X is 2: three items are refused", () => {
  const board = hammerBoard(winRoll()!);
  hammerStart(board);
  assert.equal(hammerPick(board, ["i1", "i2", "i4"]), false);
  assert.equal(pending(board.engine)?.kind, "selectDeployTargets", "still asking");
  for (const key of ["i1", "i2", "i4"]) assert.equal(zoneOf(board.engine, board.id(key)), "play");
});

clause(HAMMER, "0:ability", "on a win X is 2: picking just one item is fine ('up to')", () => {
  const board = hammerBoard(winRoll()!);
  hammerStart(board);
  assert.ok(hammerPick(board, ["i2"]), "hammerPick(board, [\"i2\"])");
  assert.equal(zoneOf(board.engine, board.id("i2")), "discard");
  for (const key of ["i1", "i3", "i4"]) assert.equal(zoneOf(board.engine, board.id(key)), "play");
});

clause(HAMMER, "0:ability", "on a loss X is 1: one item can be picked and is destroyed", () => {
  const r = loseRoll();
  assert.notEqual(r, undefined, "one outcome is the loss");
  const board = hammerBoard(r!);
  const before = readyCount(board.engine, P1);
  hammerStart(board);
  assert.ok(hammerPick(board, ["i4"]), "hammerPick(board, [\"i4\"])");
  assert.equal(zoneOf(board.engine, board.id("i4")), "discard");
  for (const key of ["i1", "i2", "i3"]) assert.equal(zoneOf(board.engine, board.id(key)), "play");
  assert.equal(before - readyCount(board.engine, P1), 2, "the printed cost of 2 is paid");
  assert.equal(zoneOf(board.engine, board.id("hs")), "discard");
});

clause(HAMMER, "0:ability", "on a loss X is 1: two items are refused", () => {
  const board = hammerBoard(loseRoll()!);
  hammerStart(board);
  assert.equal(hammerPick(board, ["i1", "i2"]), false);
  assert.equal(pending(board.engine)?.kind, "selectDeployTargets");
  for (const key of ["i1", "i2"]) assert.equal(zoneOf(board.engine, board.id(key)), "play");
});

clause(HAMMER, "0:ability", "'up to X': picking no item at all is allowed on both a win and a loss, and destroys nothing", () => {
  for (const random of WIN_OR_LOSE) {
    const board = hammerBoard(random);
    hammerStart(board);
    assert.ok(hammerPick(board, []), `roll ${random}`);
    for (const key of ["i1", "i2", "i3", "i4"]) assert.equal(zoneOf(board.engine, board.id(key)), "play");
    assert.equal(zoneOf(board.engine, board.id("hs")), "discard", "the tactic is still spent");
    assert.equal(attachedCount(board.engine, P1), 2, "and its cost still paid");
  }
});

clause(HAMMER, "0:ability", "only ITEMS in play can be picked: not a character, a location, a faction, a face-down resource, or an item in hand", () => {
  for (const random of WIN_OR_LOSE) {
    const board = hammerBoard(random);
    hammerStart(board);
    for (const key of ["c1", "c2", "place", "facedown", "handItem"]) assert.equal(hammerPick(board, [key]), false, `${key} (roll ${random})`);
    assert.equal(hammerPick(board, ["__factionB"]), false, "a faction");
    assert.equal(pending(board.engine)?.kind, "selectDeployTargets");
    assert.equal(zoneOf(board.engine, board.id("c1")), "play");
  }
});

clause(HAMMER, "0:ability", "the same item cannot be picked twice to make up X=2", () => {
  const board = hammerBoard(winRoll()!);
  hammerStart(board);
  assert.equal(hammerPick(board, ["i1", "i1"]), false);
  assert.equal(zoneOf(board.engine, board.id("i1")), "play");
});

clause(HAMMER, "0:ability", "only the picked items are destroyed: characters, locations and unpicked items stay", () => {
  const board = hammerBoard(winRoll()!);
  hammerStart(board);
  assert.ok(hammerPick(board, ["i1", "i2"]), "hammerPick(board, [\"i1\", \"i2\"])");
  for (const key of ["c1", "c2", "place", "i3", "i4", "facedown", "handItem"]) assert.notEqual(zoneOf(board.engine, board.id(key)), "discard", `${key} survives`);
  assert.equal(zoneOf(board.engine, board.id("handItem")), "hand");
});

clause(HAMMER, "0:ability", "with no item in play it can still be played (up to X includes none): the coin is flipped, nothing is destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.1,
    cards: [
      { key: "hs", def: printing(HAMMER), owner: P1, zone: "hand" },
      { key: "c1", def: character({ name: "C1" }), owner: P2, zone: "play" },
      ...bank("rage", 2, P1)
    ]
  });
  playRaw(engine, P1, id("hs"));
  if (pending(engine)) answer(engine, { kind: "selectDeployTargets", selected: { picked: [] } });
  else resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("hs")), "discard");
  assert.equal(zoneOf(engine, id("c1")), "play");
});

clause(HAMMER, "0:ability", "the player cannot choose the coin: supplying X in the play action does not change the flip", () => {
  const lose = loseRoll()!;
  const board = hammerBoard(lose);
  playRaw(board.engine, P1, board.id("hs"), { variables: { x: 2 } });
  assert.equal(pending(board.engine)?.kind, "selectDeployTargets");
  assert.equal(hammerPick(board, ["i1", "i2"]), false, "a lost flip still allows only one item");
});

clause(HAMMER, "0:ability", "is refused one resource short of its cost of 2, and without [R][R]", () => {
  const short = hammerBoard(0.1, { rage: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("hs")));
  assert.equal(zoneOf(short.engine, short.id("hs")), "hand");
  const noThreshold = hammerBoard(0.1, { rage: 1, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("hs")), "only one [R]");
  const exact = hammerBoard(0.1, { rage: 2 });
  playRaw(exact.engine, P1, exact.id("hs"));
  assert.equal(pending(exact.engine)?.kind, "selectDeployTargets", "exactly [R][R] is enough");
});

// =============================================================================
// Heirloom Incinerator
// If this card inflicts damage to a faction, you may pick an item. If you do,
// destroy that item. Character (tyrant), cost 1, threshold [R], 1 str / 3 spd / 1 life.
// =============================================================================

const INCINERATOR = "29762041-4f61-49d1-a545-1ea60ceeaaee";

function incineratorBoard(extra: CardPlacement[] = [], opts: { items?: boolean; inPlay?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "hi", def: printing(INCINERATOR), owner: P1, zone: opts.inPlay === false ? "hand" : "play" },
      ...(opts.items === false
        ? []
        : [
            { key: "theirItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" as const },
            { key: "theirItem2", def: item({ name: "Their Item 2" }), owner: P2, zone: "play" as const },
            { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" as const }
          ]),
      { key: "theirChar", def: character({ name: "Their Char", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "myChar", def: character({ name: "My Char", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      ...extra
    ]
  });
}

/** The Incinerator attacks the opposing faction unblocked and the battle runs until its trigger asks for a pick (if it does). */
function incineratorHitsFaction(board = incineratorBoard()) {
  declareAttack(board.engine, P1, [board.id("hi")]);
  declareBlockers(board.engine, P2, []);
  autoResolveBattle(board.engine);
  return board;
}

const pickItem = (engine: SpoilsEngine, ids: string[]) => answer(engine, { kind: "selectTargets", selected: { target: ids } });

clause(INCINERATOR, "0:rule", "when it damages the faction (unblocked) I may pick an item; picking an opposing item destroys it and only it", () => {
  const { engine, id } = incineratorHitsFaction();
  assert.equal(influenceOf(engine, P2), 30 - 1, "the Incinerator hit the faction for its 1 strength");
  const pc = pending(engine);
  assert.ok(pc, "I am offered the pick");
  assert.equal(pc.playerId, P1);
  pickItem(engine, [id("theirItem")]);
  assert.equal(zoneOf(engine, id("theirItem")), "discard");
  for (const key of ["theirItem2", "myItem", "theirChar", "myChar", "place"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} survives`);
  assert.equal(pending(engine), undefined);
});

clause(INCINERATOR, "0:rule", "'an item' includes one of my own: it can be picked and destroyed", () => {
  const { engine, id } = incineratorHitsFaction();
  pickItem(engine, [id("myItem")]);
  assert.equal(zoneOf(engine, id("myItem")), "discard");
  assert.equal(zoneOf(engine, id("theirItem")), "play");
});

clause(INCINERATOR, "0:rule", "'you may': declining to pick destroys nothing", () => {
  const { engine, id } = incineratorHitsFaction();
  pickItem(engine, []);
  for (const key of ["theirItem", "theirItem2", "myItem"]) assert.equal(zoneOf(engine, id(key)), "play");
  assert.equal(pending(engine), undefined);
});

clause(INCINERATOR, "0:rule", "only an ITEM can be picked: not a character, a location, a faction or a face-down resource", () => {
  const { engine, id } = incineratorHitsFaction();
  const refused = (cardId: string, label: string) =>
    assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { target: [cardId] } } } as never), label);
  refused(id("theirChar"), "character");
  refused(id("myChar"), "my character");
  refused(id("place"), "location");
  refused(id("facedown"), "face-down resource");
  refused(engine.state.players[P2].factionId!, "faction");
  refused(id("hi"), "the Incinerator itself");
  assert.equal(pending(engine)?.kind, "selectTargets", "still waiting for a legal pick");
});

clause(INCINERATOR, "0:rule", "exactly ONE item is picked: two are refused", () => {
  const { engine, id } = incineratorHitsFaction();
  assert.throws(() => pickItem(engine, [id("theirItem"), id("theirItem2")]));
  pickItem(engine, [id("theirItem2")]);
  assert.equal(zoneOf(engine, id("theirItem")), "play");
  assert.equal(zoneOf(engine, id("theirItem2")), "discard");
});

clause(INCINERATOR, "0:rule", "with no item in play nothing is asked and nothing happens", () => {
  const { engine, id } = incineratorHitsFaction(incineratorBoard([], { items: false }));
  assert.equal(influenceOf(engine, P2), 29, "the faction was still damaged");
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.battle, undefined, "the battle finished");
  assert.equal(zoneOf(engine, id("theirChar")), "play");
});

clause(INCINERATOR, "0:rule", "damage to a CHARACTER (blocked by a character that survives to the end) does not trigger it", () => {
  const { engine, id } = incineratorBoard([{ key: "blocker", def: character({ name: "Blocker", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }]);
  declareAttack(engine, P1, [id("hi")]);
  declareBlockers(engine, P2, [id("blocker")]);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("blocker")), 1, "the Incinerator damaged the blocker");
  assert.equal(pending(engine), undefined, "no item pick");
  for (const key of ["theirItem", "theirItem2", "myItem"]) assert.equal(zoneOf(engine, id(key)), "play");
  assert.equal(influenceOf(engine, P2), 30, "the faction was not hit");
});

clause(INCINERATOR, "0:rule", "damage to a LOCATION does not trigger it", () => {
  const board = incineratorBoard();
  const { engine, id } = board;
  declareAttack(engine, P1, [id("hi")], { type: "location", cardId: id("place") });
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("place")), 1, "the Incinerator damaged the location");
  assert.equal(pending(engine), undefined);
  for (const key of ["theirItem", "theirItem2", "myItem"]) assert.equal(zoneOf(engine, id(key)), "play");
});

clause(INCINERATOR, "0:rule", "if the blockers are gone before it assigns, its damage goes to the faction and it triggers", () => {
  // A faster attacker kills the lone blocker first; the Incinerator (speed 3) then has only the faction to hit.
  const { engine, id } = incineratorBoard([
    { key: "fast", def: character({ name: "Fast", strength: 5, life: 5, speed: 5 }), owner: P1, zone: "play" },
    { key: "blocker", def: character({ name: "Blocker", strength: 0, life: 2, speed: 1 }), owner: P2, zone: "play" }
  ]);
  declareAttack(engine, P1, [id("hi"), id("fast")]);
  declareBlockers(engine, P2, [id("blocker")]);
  autoResolveBattle(engine, (source) => {
    const target = source.legalTargets[0];
    return target && source.strength > 0 ? [{ sourceId: source.cardId, target, amount: source.strength }] : [];
  });
  assert.equal(zoneOf(engine, id("blocker")), "discard", "the blocker died to the faster attacker");
  assert.equal(influenceOf(engine, P2), 30 - 1, "the Incinerator's damage went to the faction");
  assert.equal(pending(engine)?.kind, "selectTargets", "it inflicted damage to a faction, so it asks for an item");
  pickItem(engine, [id("theirItem")]);
  assert.equal(zoneOf(engine, id("theirItem")), "discard");
});

clause(INCINERATOR, "0:rule", "damage from ANOTHER card to the faction does not trigger it (the Incinerator stays home)", () => {
  const { engine, id } = incineratorBoard([{ key: "other", def: character({ name: "Other", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" }]);
  declareAttack(engine, P1, [id("other")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30 - 2);
  assert.equal(pending(engine), undefined, "the damage was not inflicted by the Incinerator");
  for (const key of ["theirItem", "theirItem2", "myItem"]) assert.equal(zoneOf(engine, id(key)), "play");
});

clause(INCINERATOR, "0:rule", "in a party, only the Incinerator's own damage triggers it: one pick, not one per attacker", () => {
  const { engine, id } = incineratorBoard([{ key: "other", def: character({ name: "Other", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" }]);
  declareAttack(engine, P1, [id("hi"), id("other")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30 - 3, "both attackers hit the faction");
  assert.equal(pending(engine)?.kind, "selectTargets");
  pickItem(engine, [id("theirItem")]);
  assert.equal(pending(engine), undefined, "asked only once");
  assert.equal(zoneOf(engine, id("theirItem2")), "play");
});

clause(INCINERATOR, "0:rule", "it must actually INFLICT damage: at 0 strength it inflicts none and nothing triggers", () => {
  const { engine, id } = incineratorBoard([
    { key: "gear", def: strengthGear(-1, "Weakener"), owner: P2, zone: "play", attachedToKey: "hi" }
  ]);
  assert.equal(engine.getStat(id("hi"), "strength"), 0, "the Incinerator is at 0 strength");
  declareAttack(engine, P1, [id("hi")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30, "no damage inflicted");
  assert.equal(pending(engine), undefined, "so no trigger");
});

clause(INCINERATOR, "0:rule", "the opponent's Incinerator works for its controller: they pick the item when it damages MY faction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "hi", def: printing(INCINERATOR), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "theirItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" }
    ]
  });
  declareAttack(engine, P2, [id("hi")]);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), 30 - 1);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P2, "the Incinerator's controller picks");
  answer(engine, { kind: "selectTargets", selected: { target: [id("myItem")] } });
  assert.equal(zoneOf(engine, id("myItem")), "discard");
  assert.equal(zoneOf(engine, id("theirItem")), "play");
});

clause(INCINERATOR, "0:rule", "does nothing while it is merely in play: no pick when it is not the one dealing damage to a faction (a blocked turn, an idle turn)", () => {
  const { engine, id } = incineratorBoard();
  endTurn(engine, P1);
  assert.equal(pending(engine), undefined);
  for (const key of ["theirItem", "theirItem2", "myItem"]) assert.equal(zoneOf(engine, id(key)), "play");
});

clause(INCINERATOR, "0:rule", "is refused one resource short of its cost of 1, and without [R]", () => {
  const short = incineratorBoard([], { inPlay: false });
  assert.throws(() => playRaw(short.engine, P1, short.id("hi")));
  assert.equal(zoneOf(short.engine, short.id("hi")), "hand");
  const greed = incineratorBoard([...bank("greed", 3, P1)], { inPlay: false });
  assert.throws(() => playRaw(greed.engine, P1, greed.id("hi")), "no [R]");
  const ok = incineratorBoard([...bank("rage", 1, P1)], { inPlay: false });
  play(ok.engine, P1, ok.id("hi"));
  assert.equal(zoneOf(ok.engine, ok.id("hi")), "play", "one [R] pays cost 1 and meets the threshold");
  assert.equal(attachedCount(ok.engine, P1), 1);
  assert.equal(ok.engine.getStat(ok.id("hi"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("hi"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("hi"), "life"), 1);
});

// =============================================================================
// Hidden Sniper
// SHARPSHOOT -- COST: Pay 1. Deplete this card. Pick a character.
// EFFECT: Inflict 1 damage to the character.
// Character (soldier), cost 3, threshold [R][R], 0 str / 3 spd / 1 life.
// =============================================================================

const SNIPER = "bda717f9-94fe-4684-b424-4870061d759b";

function sniperBoard(opts: { rage?: number; inPlay?: boolean; sniperDepleted?: boolean; fresh?: boolean; active?: Player; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "hs", def: printing(SNIPER), owner: P1, zone: opts.inPlay === false ? "hand" : "play", depleted: opts.sniperDepleted, attackEligible: opts.fresh ? false : true },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 5 }), owner: P2, zone: "play" },
      { key: "glass", def: character({ name: "Glass", life: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "deck" },
      ...bank("rage", opts.rage ?? 4, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const sharpshoot = (engine: SpoilsEngine, id: (key: string) => string, targetKey: string, player: Player = P1) =>
  activate(engine, player, id("hs"), "hidden-sniper-sharpshoot", { selected: { target: [id(targetKey)] } });

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "pays exactly 1, depletes the Sniper itself and inflicts 1 damage to the picked opposing character", () => {
  const { engine, id } = sniperBoard();
  const before = readyCount(engine, P1);
  sharpshoot(engine, id, "foe");
  assert.equal(before - readyCount(engine, P1), 1, "COST: Pay 1");
  assert.equal(attachedCount(engine, P1), 1);
  assert.equal(engine.state.cards[id("hs")].depleted, true, "COST: Deplete this card");
  assert.equal(damageOf(engine, id("foe")), 1, "EFFECT: 1 damage");
  for (const key of ["foe2", "glass", "mine"]) assert.equal(damageOf(engine, id(key)), 0, `${key} is not damaged`);
  assert.equal(zoneOf(engine, id("hs")), "play");
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "can pick one of my own characters", () => {
  const { engine, id } = sniperBoard();
  sharpshoot(engine, id, "mine");
  assert.equal(damageOf(engine, id("mine")), 1);
  assert.equal(damageOf(engine, id("foe")), 0);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "1 damage destroys a 1-life character", () => {
  const { engine, id } = sniperBoard();
  sharpshoot(engine, id, "glass");
  assert.equal(zoneOf(engine, id("glass")), "discard");
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "the damage is 1 whatever the Sniper's own strength (it has 0)", () => {
  const { engine, id } = sniperBoard();
  assert.equal(engine.getStat(id("hs"), "strength"), 0);
  sharpshoot(engine, id, "foe");
  assert.equal(damageOf(engine, id("foe")), 1);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "may pick the Sniper itself: it is a character in play even though depleted by the cost", () => {
  const { engine, id } = sniperBoard();
  sharpshoot(engine, id, "hs");
  assert.equal(engine.state.cards[id("hs")].zone, "discard", "1 damage destroys the 1-life Sniper");
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "only a character can be picked: not an item, a location, a faction or a face-down resource", () => {
  const { engine, id } = sniperBoard();
  for (const key of ["thing", "place", "facedown"]) assert.throws(() => sharpshoot(engine, id, key), key);
  assert.throws(() => activate(engine, P1, id("hs"), "hidden-sniper-sharpshoot", { selected: { target: [engine.state.players[P2].factionId!] } }), "opponent's faction");
  assert.throws(() => activate(engine, P1, id("hs"), "hidden-sniper-sharpshoot", { selected: { target: [engine.state.players[P1].factionId!] } }), "own faction");
  assert.equal(engine.state.cards[id("hs")].depleted, false, "nothing was paid");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "exactly one character: none or two are refused", () => {
  const { engine, id } = sniperBoard();
  assert.throws(() => activate(engine, P1, id("hs"), "hidden-sniper-sharpshoot", { selected: { target: [] } }));
  assert.throws(() => activate(engine, P1, id("hs"), "hidden-sniper-sharpshoot", { selected: { target: [id("foe"), id("foe2")] } }));
  assert.equal(attachedCount(engine, P1), 0);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "is refused with no resource to pay, and works with exactly 1", () => {
  const none = sniperBoard({ rage: 0 });
  assert.throws(() => sharpshoot(none.engine, none.id, "foe"));
  assert.equal(damageOf(none.engine, none.id("foe")), 0);
  assert.equal(none.engine.state.cards[none.id("hs")].depleted, false, "no partial payment");
  const one = sniperBoard({ rage: 1 });
  sharpshoot(one.engine, one.id, "foe");
  assert.equal(damageOf(one.engine, one.id("foe")), 1);
  assert.equal(readyCount(one.engine, P1), 0);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "is refused when every resource is already spent", () => {
  const spent = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hs", def: printing(SNIPER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      ...bank("rage", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
    ]
  });
  assert.throws(() => sharpshoot(spent.engine, spent.id, "foe"));
  assert.equal(damageOf(spent.engine, spent.id("foe")), 0);
  assert.equal(spent.engine.state.cards[spent.id("hs")].depleted, false, "nothing was paid");
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "is refused while the Sniper is depleted (the cost depletes it) and nothing is paid", () => {
  const { engine, id } = sniperBoard({ sniperDepleted: true });
  assert.throws(() => sharpshoot(engine, id, "foe"));
  assert.equal(attachedCount(engine, P1), 0, "the 1 was not paid");
  assert.equal(damageOf(engine, id("foe")), 0);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "once per untapping: a second use the same turn is refused, and it works again after the Sniper is restored next turn", () => {
  const { engine, id } = sniperBoard();
  sharpshoot(engine, id, "foe");
  assert.throws(() => sharpshoot(engine, id, "foe2"), "depleted");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("hs")].depleted, false, "restored at the start of my turn");
  sharpshoot(engine, id, "foe2");
  assert.equal(damageOf(engine, id("foe2")), 1);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "usable the turn it entered play (abilities do not need the card to have started the turn in play)", () => {
  const { engine, id } = sniperBoard({ fresh: true });
  sharpshoot(engine, id, "foe");
  assert.equal(damageOf(engine, id("foe")), 1);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "usable on the opponent's turn, in response to what they do (any time I could use an ability)", () => {
  const { engine, id } = sniperBoard({ active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playNoopOnOwnTurn(engine, id, P2);
  activateRaw(engine, P1, id("hs"), "hidden-sniper-sharpshoot", { selected: { target: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe")), 1);
  assert.equal(engine.state.cards[id("hs")].depleted, true);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "not usable on the opponent's turn when there is nothing to respond to", () => {
  const { engine, id } = sniperBoard({ active: P2 });
  assert.throws(() => sharpshoot(engine, id, "foe"));
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(attachedCount(engine, P1), 0);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "only its controller can use it", () => {
  const { engine, id } = sniperBoard({ active: P2, extra: bank("rage", 3, P2) });
  assert.throws(() => sharpshoot(engine, id, "mine", P2));
  assert.equal(damageOf(engine, id("mine")), 0);
  assert.equal(engine.state.cards[id("hs")].depleted, false);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "damage from several Snipers accumulates on the same character", () => {
  const { engine, id } = sniperBoard({ extra: [{ key: "hs2", def: printing(SNIPER), owner: P1, zone: "play" }] });
  sharpshoot(engine, id, "foe");
  activate(engine, P1, id("hs2"), "hidden-sniper-sharpshoot", { selected: { target: [id("foe")] } });
  assert.equal(damageOf(engine, id("foe")), 2);
  assert.equal(attachedCount(engine, P1), 2);
});

clause(SNIPER, "0:ability:hidden-sniper-sharpshoot", "is refused one resource short of its cost of 3, and without [R][R]", () => {
  const short = sniperBoard({ rage: 2, inPlay: false });
  assert.throws(() => playRaw(short.engine, P1, short.id("hs")));
  const noThreshold = sniperBoard({ rage: 1, inPlay: false, extra: bank("greed", 5, P1) });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("hs")), "one [R] only");
  const ok = sniperBoard({ rage: 3, inPlay: false });
  play(ok.engine, P1, ok.id("hs"));
  assert.equal(zoneOf(ok.engine, ok.id("hs")), "play");
  assert.equal(attachedCount(ok.engine, P1), 3);
  assert.equal(ok.engine.getStat(ok.id("hs"), "strength"), 0);
  assert.equal(ok.engine.getStat(ok.id("hs"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("hs"), "life"), 1);
});

// =============================================================================
// Humiliating Torture Apparatus
// If a card is depleted, that card's controller's faction loses 1 influence.
// (Resources don't deplete when used; they attach to your faction.)
// Item, cost 4, threshold [R][R][R].
// =============================================================================

const APPARATUS = "30012fd1-7785-4090-8787-ae61fc48f2dd";

function apparatusBoard(opts: { inPlay?: boolean; controller?: Player; extra?: CardPlacement[]; active?: Player } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "hta", def: printing(APPARATUS), owner: P1, zone: opts.inPlay === false ? "hand" : "play", controller: opts.controller },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "dep", def: DEPLETER, owner: P1, zone: "hand" },
      { key: "dep2", def: DEPLETER, owner: P1, zone: "hand" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "e1", def: character({ name: "E1" }), owner: P2, zone: "deck" },
      ...bank("rage", 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const deplete = (engine: SpoilsEngine, id: (key: string) => string, targetKey: string, depKey = "dep") =>
  play(engine, P1, id(depKey), { selected: { t: [id(targetKey)] } });

clause(APPARATUS, "0:rule", "an opposing card being depleted costs ITS controller's faction 1 influence (not mine)", () => {
  const { engine, id } = apparatusBoard();
  deplete(engine, id, "foe");
  assert.equal(engine.state.cards[id("foe")].depleted, true);
  assert.equal(influenceOf(engine, P2), 29, "the depleted card's controller loses 1");
  assert.equal(influenceOf(engine, P1), 30, "I lose nothing");
});

clause(APPARATUS, "0:rule", "my own card being depleted costs MY faction 1 influence", () => {
  const { engine, id } = apparatusBoard();
  deplete(engine, id, "mine");
  assert.equal(influenceOf(engine, P1), 29);
  assert.equal(influenceOf(engine, P2), 30);
});

clause(APPARATUS, "0:rule", "it is the depleted card's CONTROLLER, not its owner: a card I own that the opponent controls costs them", () => {
  const { engine, id } = apparatusBoard({ extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }] });
  deplete(engine, id, "lent");
  assert.equal(influenceOf(engine, P2), 29, "the controller's faction loses");
  assert.equal(influenceOf(engine, P1), 30, "the owner's does not");
});

clause(APPARATUS, "0:rule", "a card I control but the opponent owns costs my faction", () => {
  const { engine, id } = apparatusBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  deplete(engine, id, "stolen");
  assert.equal(influenceOf(engine, P1), 29);
  assert.equal(influenceOf(engine, P2), 30);
});

clause(APPARATUS, "0:rule", "each card depleted costs 1: two cards depleted lose 2 (a total across both factions, 1 each)", () => {
  const { engine, id } = apparatusBoard();
  deplete(engine, id, "foe");
  deplete(engine, id, "foe2", "dep2");
  assert.equal(influenceOf(engine, P2), 28);
  const both = apparatusBoard();
  deplete(both.engine, both.id, "foe");
  deplete(both.engine, both.id, "mine", "dep2");
  assert.equal(influenceOf(both.engine, P1), 29);
  assert.equal(influenceOf(both.engine, P2), 29);
});

clause(APPARATUS, "0:rule", "any card type: depleting an item costs its controller 1 influence too", () => {
  const ITEM_DEPLETER = tactic({
    name: "Item Depleter",
    cost: 0,
    behavior: { abilities: [{ id: "idep", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "deplete", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = apparatusBoard({ extra: [{ key: "idep", def: ITEM_DEPLETER, owner: P1, zone: "hand" }] });
  play(engine, P1, id("idep"), { selected: { t: [id("myItem")] } });
  assert.equal(engine.state.cards[id("myItem")].depleted, true);
  assert.equal(influenceOf(engine, P1), 29);
});

clause(APPARATUS, "0:rule", "the Apparatus is a card too: depleting it costs its own controller 1 influence", () => {
  const ITEM_DEPLETER = tactic({
    name: "Item Depleter",
    cost: 0,
    behavior: { abilities: [{ id: "idep", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "deplete", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = apparatusBoard({ extra: [{ key: "idep", def: ITEM_DEPLETER, owner: P1, zone: "hand" }] });
  play(engine, P1, id("idep"), { selected: { t: [id("hta")] } });
  assert.equal(engine.state.cards[id("hta")].depleted, true);
  assert.equal(influenceOf(engine, P1), 29);
});

clause(APPARATUS, "0:rule", "a depletion paid as an ability cost counts: using Hidden Sniper's SHARPSHOOT costs its controller 1 influence", () => {
  const { engine, id } = apparatusBoard({ extra: [{ key: "sniper", def: printing(SNIPER), owner: P1, zone: "play" }] });
  activate(engine, P1, id("sniper"), "hidden-sniper-sharpshoot", { selected: { target: [id("foe")] } });
  assert.equal(engine.state.cards[id("sniper")].depleted, true);
  assert.equal(influenceOf(engine, P1), 29, "the Sniper (mine) was depleted");
  assert.equal(influenceOf(engine, P2), 30, "damage to a character is not influence loss");
});

clause(APPARATUS, "0:rule", "attacking depletes the attackers: each attacker costs the attacker's faction 1 influence", () => {
  const { engine, id } = apparatusBoard();
  declareAttack(engine, P1, [id("mine"), id("mine2")]);
  assert.equal(engine.state.cards[id("mine")].depleted, true);
  assert.equal(influenceOf(engine, P1), 28, "two attackers were depleted by declaring the attack");
  assert.equal(influenceOf(engine, P2), 30, "no damage has been dealt yet");
});

clause(APPARATUS, "0:rule", "a battle: attackers cost their faction 1 each on declaring; surviving blockers are depleted when the battle ends (RULES 8, CR 609.1h) and cost theirs 1 each; nobody is depleted twice", () => {
  const { engine, id } = apparatusBoard();
  declareAttack(engine, P1, [id("mine")]);
  assert.equal(influenceOf(engine, P1), 29, "declaring depleted the attacker");
  declareBlockers(engine, P2, [id("foe")]);
  assert.equal(engine.state.cards[id("foe")].depleted, false, "declaring a block does not deplete the blocker");
  assert.equal(influenceOf(engine, P2), 30);
  autoResolveBattle(engine);
  assert.equal(engine.state.battle, undefined, "the battle is over");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(engine.state.cards[id("foe")].depleted, true, "the surviving blocker is depleted at the end of the battle");
  assert.equal(influenceOf(engine, P2), 29, "so its controller's faction lost 1");
  assert.equal(influenceOf(engine, P1), 29, "the attacker was not depleted a second time");
});

clause(APPARATUS, "0:rule", "a blocker destroyed in the battle is not depleted at its end: its controller loses nothing for it", () => {
  const { engine, id } = apparatusBoard({ extra: [{ key: "glass", def: character({ name: "Glass", strength: 0, life: 1, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttack(engine, P1, [id("mine")]);
  declareBlockers(engine, P2, [id("glass")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("glass")), "discard");
  assert.equal(influenceOf(engine, P2), 30, "a destroyed blocker is not depleted");
  assert.equal(influenceOf(engine, P1), 29);
});

clause(APPARATUS, "0:rule", "a card that is already depleted is not depleted again: no further influence is lost", () => {
  const { engine, id } = apparatusBoard();
  deplete(engine, id, "foe");
  assert.equal(influenceOf(engine, P2), 29);
  try {
    deplete(engine, id, "foe", "dep2");
  } catch {
    // an engine may refuse to deplete an already-depleted card outright; either way nothing more is lost
  }
  assert.equal(influenceOf(engine, P2), 29, "depleting an already-depleted card changes nothing");
});

clause(APPARATUS, "0:rule", "resources do not deplete: paying with resources attaches them and costs no influence", () => {
  const COSTLY = tactic({
    name: "Costly",
    cost: 3,
    behavior: { abilities: [{ id: "costly", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hta", def: printing(APPARATUS), owner: P1, zone: "play" },
      { key: "costly", def: COSTLY, owner: P1, zone: "hand" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      ...bank("rage", 5, P1)
    ]
  });
  play(engine, P1, id("costly"));
  assert.equal(attachedCount(engine, P1), 3, "three resources were spent (attached)");
  assert.equal(influenceOf(engine, P1), 30, "no influence lost for paying");
  assert.equal(influenceOf(engine, P2), 30);
});

clause(APPARATUS, "0:rule", "resources attached to the faction are not 'depleted' either: detaching and re-attaching them costs nothing", () => {
  const { engine } = apparatusBoard({
    extra: [...bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))]
  });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(attachedCount(engine, P1), 0, "the resources were detached by the restore rule");
  assert.equal(influenceOf(engine, P1), 30, "restoring/detaching resources costs nothing");
  assert.equal(influenceOf(engine, P2), 30);
});

clause(APPARATUS, "0:rule", "it works on the opponent's turn too: my Sniper depleted in response during their turn costs me 1", () => {
  const { engine, id } = apparatusBoard({ active: P2, extra: [{ key: "sniper", def: printing(SNIPER), owner: P1, zone: "play" }, { key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playNoopOnOwnTurn(engine, id, P2);
  activateRaw(engine, P1, id("sniper"), "hidden-sniper-sharpshoot", { selected: { target: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("sniper")].depleted, true);
  assert.equal(influenceOf(engine, P1), 29);
});

clause(APPARATUS, "0:rule", "when it is not in play nothing is lost (a copy in hand does nothing)", () => {
  const { engine, id } = apparatusBoard({ inPlay: false });
  deplete(engine, id, "foe");
  assert.equal(engine.state.cards[id("foe")].depleted, true);
  assert.equal(influenceOf(engine, P2), 30);
});

clause(APPARATUS, "0:rule", "it triggers for either player's Apparatus: an Apparatus the opponent controls also costs my depleted card's controller 1", () => {
  const { engine, id } = apparatusBoard({ controller: P2 });
  deplete(engine, id, "mine");
  assert.equal(influenceOf(engine, P1), 29, "the card's controller (me) loses 1 whoever controls the Apparatus");
  assert.equal(influenceOf(engine, P2), 30);
});

clause(APPARATUS, "0:rule", "two Apparatuses each trigger: a depleted card then costs 2", () => {
  const { engine, id } = apparatusBoard({ extra: [{ key: "hta2", def: printing(APPARATUS), owner: P1, zone: "play" }] });
  deplete(engine, id, "foe");
  drain(engine, declineAll);
  assert.equal(influenceOf(engine, P2), 28);
});

clause(APPARATUS, "0:rule", "the influence loss can end the game: a faction at 1 influence whose card is depleted loses", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: 1 },
    cards: [
      { key: "hta", def: printing(APPARATUS), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "dep", def: DEPLETER, owner: P1, zone: "hand" }
    ]
  });
  deplete(engine, id, "foe");
  assert.equal(influenceOf(engine, P2), 0);
  assert.equal(engine.state.winner, P1);
});

clause(APPARATUS, "0:rule", "is refused one resource short of its cost of 4, and without [R][R][R]", () => {
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "hta", def: printing(APPARATUS), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)]
  });
  assert.throws(() => playRaw(short.engine, P1, short.id("hta")));
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "hta", def: printing(APPARATUS), owner: P1, zone: "hand" }, ...bank("rage", 2, P1), ...bank("greed", 5, P1)]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("hta")), "only two [R]");
  const ok = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "hta", def: printing(APPARATUS), owner: P1, zone: "hand" }, ...bank("rage", 3, P1), ...bank("greed", 1, P1)]
  });
  play(ok.engine, P1, ok.id("hta"));
  assert.equal(zoneOf(ok.engine, ok.id("hta")), "play");
  assert.equal(attachedCount(ok.engine, P1), 4, "the printed cost of 4 is paid");
});

// =============================================================================
// Kettinger
// ATTACH TO CHARACTER. The attached character gains 3 strength.
// HANDOFF -- COST: Pay 3, deplete a character you control that is not in a
// battle. EFFECT: Attach this card to the character.
// Item (gear), cost 2, threshold [R].
// =============================================================================

const KETTINGER = "90a923f7-847e-4b87-9a28-eab4b3cd4340";

/** Free tactics that bounce (put into its owner's hand), destroy, or turn face-down one chosen character (declaration `t`). */
const BOUNCER = tactic({
  name: "Bouncer",
  cost: 0,
  behavior: { abilities: [{ id: "bounce", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
});
const KILLER = tactic({
  name: "Killer",
  cost: 0,
  behavior: { abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
});
const FLIPPER = tactic({
  name: "Flipper",
  cost: 0,
  behavior: { abilities: [{ id: "flip", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
});

function kettingerBoard(opts: { rage?: number; greed?: number; inHand?: boolean; attachedTo?: string; extra?: CardPlacement[]; active?: Player } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "k", def: printing(KETTINGER), owner: P1, zone: opts.inHand ? "hand" : "play", ...(opts.attachedTo ? { attachedToKey: opts.attachedTo } : {}) },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine3", def: character({ name: "Mine3", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      { key: "handguy", def: character({ name: "Hand Guy" }), owner: P1, zone: "hand" },
      { key: "kill", def: KILLER, owner: P1, zone: "hand" },
      { key: "bounce", def: BOUNCER, owner: P1, zone: "hand" },
      { key: "flip", def: FLIPPER, owner: P1, zone: "hand" },
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const strengthOf = (engine: SpoilsEngine, cardId: string) => engine.getStat(cardId, "strength");
const handoff = (engine: SpoilsEngine, id: (key: string) => string, toKey: string, player: Player = P1) =>
  activate(engine, player, id("k"), "kettinger-handoff", { selected: { newWearer: [id(toKey)] } });

clause(KETTINGER, "0:attach", "deployed picking one of my characters: it enters play attached to that character, for cost 2", () => {
  const { engine, id } = kettingerBoard({ inHand: true });
  const before = readyCount(engine, P1);
  play(engine, P1, id("k"), { selected: { attachTo: [id("mine")] } });
  assert.equal(zoneOf(engine, id("k")), "play");
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine"), "attached to the picked character");
  assert.equal(before - readyCount(engine, P1), 2, "the printed cost of 2 is paid");
  assert.equal(engine.state.cards[id("k")].controllerId, P1);
});

clause(KETTINGER, "0:attach", "can attach to an OPPONENT's character (any character), and I keep controlling the Kettinger", () => {
  const { engine, id } = kettingerBoard({ inHand: true });
  play(engine, P1, id("k"), { selected: { attachTo: [id("foe")] } });
  assert.equal(zoneOf(engine, id("k")), "play");
  assert.equal(engine.state.cards[id("k")].attachedTo, id("foe"));
  assert.equal(engine.state.cards[id("k")].controllerId, P1);
  assert.ok(engine.state.players[P1].play.includes(id("k")), "it stays among my cards in play");
});

clause(KETTINGER, "0:attach", "the host must be a character: an item, a location, a faction, a face-down resource or a card in hand is refused", () => {
  const { engine, id } = kettingerBoard({ inHand: true });
  for (const key of ["thing", "place", "facedown", "handguy"]) assert.throws(() => playRaw(engine, P1, id("k"), { selected: { attachTo: [id(key)] } }), key);
  assert.throws(() => playRaw(engine, P1, id("k"), { selected: { attachTo: [engine.state.players[P2].factionId!] } }), "faction");
  assert.throws(() => playRaw(engine, P1, id("k"), { selected: { attachTo: [id("k")] } }), "itself");
  assert.equal(zoneOf(engine, id("k")), "hand");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
});

clause(KETTINGER, "0:attach", "a host is required: playing it with no character picked is refused", () => {
  const { engine, id } = kettingerBoard({ inHand: true });
  assert.throws(() => playRaw(engine, P1, id("k"), { selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("k"), { selected: { attachTo: [] } }));
  assert.equal(zoneOf(engine, id("k")), "hand");
});

clause(KETTINGER, "0:attach", "only ONE host: two characters picked is refused", () => {
  const { engine, id } = kettingerBoard({ inHand: true });
  assert.throws(() => playRaw(engine, P1, id("k"), { selected: { attachTo: [id("mine"), id("mine2")] } }));
  assert.equal(zoneOf(engine, id("k")), "hand");
});

clause(KETTINGER, "0:attach", "with no character in play it cannot be played at all", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "k", def: printing(KETTINGER), owner: P1, zone: "hand" }, { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" }, ...bank("rage", 3, P1)]
  });
  assert.throws(() => playRaw(engine, P1, id("k"), { selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("k"), { selected: { attachTo: [id("thing")] } }));
  assert.equal(zoneOf(engine, id("k")), "hand");
});

clause(KETTINGER, "0:attach", "when its host is destroyed it is destroyed too (it leaves play the same way)", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("k")), "discard");
});

clause(KETTINGER, "0:attach", "when its host is put into its owner's hand the Kettinger leaves play the same way (to its owner's hand), CR 301.4a", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  play(engine, P1, id("bounce"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.notEqual(zoneOf(engine, id("k")), "play", "no longer in play");
  assert.equal(zoneOf(engine, id("k")), "hand", "it left the same way as the host: to its owner's hand");
});

clause(KETTINGER, "0:attach", "when its host is shuffled into its owner's deck the Kettinger leaves play the same way (into its owner's deck), CR 301.4a", () => {
  const TO_DECK = tactic({
    name: "To Deck",
    cost: 0,
    behavior: { abilities: [{ id: "todeck", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "deck" }] }] }
  });
  const { engine, id } = kettingerBoard({ attachedTo: "mine", extra: [{ key: "todeck", def: TO_DECK, owner: P1, zone: "hand" }] });
  play(engine, P1, id("todeck"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "deck");
  assert.equal(zoneOf(engine, id("k")), "deck", "the Kettinger followed its host into the deck");
});

clause(KETTINGER, "0:attach", "when its host is removed from the game the Kettinger is removed from the game too, CR 301.4a", () => {
  const REMOVER = tactic({
    name: "Remover",
    cost: 0,
    behavior: { abilities: [{ id: "remove", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = kettingerBoard({ attachedTo: "mine", extra: [{ key: "remover", def: REMOVER, owner: P1, zone: "hand" }] });
  play(engine, P1, id("remover"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "removed");
  assert.equal(zoneOf(engine, id("k")), "removed", "the Kettinger followed its host out of the game");
});

clause(KETTINGER, "0:attach", "when its host stops being a character (turned face-down) the Kettinger is flipped face-down with it", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  play(engine, P1, id("flip"), { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].faceDown, true);
  assert.equal(zoneOf(engine, id("k")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(engine.state.cards[id("k")].faceDown, true, "...and is flipped face-down along with its host");
});

clause(KETTINGER, "0:attach", "the opponent's host leaving play also takes the Kettinger I attached to it", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "foe" });
  play(engine, P1, id("kill"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("k")), "discard");
});

clause(KETTINGER, "0:attach", "is refused one resource short of its cost of 2, and without [R]", () => {
  const short = kettingerBoard({ inHand: true, rage: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("k"), { selected: { attachTo: [short.id("mine")] } }));
  assert.equal(zoneOf(short.engine, short.id("k")), "hand");
  const noThreshold = kettingerBoard({ inHand: true, rage: 0, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("k"), { selected: { attachTo: [noThreshold.id("mine")] } }), "no [R]");
  const exact = kettingerBoard({ inHand: true, rage: 2 });
  play(exact.engine, P1, exact.id("k"), { selected: { attachTo: [exact.id("mine")] } });
  assert.equal(zoneOf(exact.engine, exact.id("k")), "play");
  assert.equal(readyCount(exact.engine, P1), 0);
});

clause(KETTINGER, "1:rule", "the attached character gains 3 strength (a 1-strength host becomes 4); nobody else changes", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  assert.equal(strengthOf(engine, id("mine")), 1 + 3);
  assert.equal(strengthOf(engine, id("mine2")), 2, "my other character is unchanged");
  assert.equal(strengthOf(engine, id("foe")), 1, "an opponent's character is unchanged");
});

clause(KETTINGER, "1:rule", "it grants strength ONLY: life and speed stay as printed", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  assert.equal(engine.getStat(id("mine"), "life"), 5);
  assert.equal(engine.getStat(id("mine"), "speed"), 2);
});

clause(KETTINGER, "1:rule", "an opponent's character it is attached to gains the 3 strength (it is the ATTACHED character, whoever controls it)", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "foe" });
  assert.equal(strengthOf(engine, id("foe")), 1 + 3);
  assert.equal(strengthOf(engine, id("mine")), 1);
});

clause(KETTINGER, "1:rule", "a Kettinger in hand gives nothing", () => {
  const { engine, id } = kettingerBoard({ inHand: true });
  for (const key of ["mine", "mine2", "foe"]) assert.equal(strengthOf(engine, id(key)), engine.getDefinition(id(key)).strength);
});

clause(KETTINGER, "1:rule", "two Kettingers on one host stack: +6", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine", extra: [{ key: "k2", def: printing(KETTINGER), owner: P1, zone: "play", attachedToKey: "mine" }] });
  assert.equal(strengthOf(engine, id("mine")), 1 + 6);
});

clause(KETTINGER, "1:rule", "the bonus is real in battle: the attached character deals its boosted strength to the faction", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  declareAttack(engine, P1, [id("mine")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30 - 4, "1 strength + 3 from the Kettinger");
});

clause(KETTINGER, "1:rule", "the bonus ends when the Kettinger leaves play", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine", extra: [{ key: "zap", def: tactic({ name: "Item Zap", cost: 0, behavior: { abilities: [{ id: "zapit", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }] });
  assert.equal(strengthOf(engine, id("mine")), 4);
  play(engine, P1, id("zap"), { selected: { t: [id("k")] } });
  assert.equal(zoneOf(engine, id("k")), "discard");
  assert.equal(strengthOf(engine, id("mine")), 1);
});

clause(KETTINGER, "1:rule", "a freshly deployed Kettinger gives its host +3 immediately", () => {
  const { engine, id } = kettingerBoard({ inHand: true });
  play(engine, P1, id("k"), { selected: { attachTo: [id("mine2")] } });
  assert.equal(strengthOf(engine, id("mine2")), 2 + 3);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "pays exactly 3, depletes the chosen character, and attaches the Kettinger to it", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  const before = readyCount(engine, P1);
  handoff(engine, id, "mine2");
  assert.equal(before - readyCount(engine, P1), 3, "COST: Pay 3");
  assert.equal(engine.state.cards[id("mine2")].depleted, true, "COST: deplete the character");
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine2"), "EFFECT: attached to the character");
  assert.equal(engine.state.cards[id("mine")].depleted, false, "the old host is not depleted");
  assert.equal(engine.state.cards[id("k")].depleted, false, "the Kettinger itself is not depleted");
});

clause(KETTINGER, "2:ability:kettinger-handoff", "the strength moves with it: the old host loses 3, the new one gains 3", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  handoff(engine, id, "mine2");
  assert.equal(strengthOf(engine, id("mine")), 1, "the old host is back to its printed strength");
  assert.equal(strengthOf(engine, id("mine2")), 2 + 3);
  assert.equal(strengthOf(engine, id("mine3")), 2);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "can take the Kettinger from an opponent's character onto one of mine", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "foe" });
  handoff(engine, id, "mine");
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine"));
  assert.equal(strengthOf(engine, id("foe")), 1);
  assert.equal(strengthOf(engine, id("mine")), 4);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "the character depleted must be one I CONTROL: an opponent's character is refused", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  assert.throws(() => handoff(engine, id, "foe"));
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine"), "nothing moved");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
  assert.equal(engine.state.cards[id("foe")].depleted, false);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "a character I control but the opponent owns is a legal target", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine", extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  handoff(engine, id, "stolen");
  assert.equal(engine.state.cards[id("k")].attachedTo, id("stolen"));
});

clause(KETTINGER, "2:ability:kettinger-handoff", "a character I own but the opponent controls is not", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine", extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }] });
  assert.throws(() => handoff(engine, id, "lent"));
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine"));
});

clause(KETTINGER, "2:ability:kettinger-handoff", "only a character: an item, a location, a faction, a face-down resource is refused", () => {
  const { engine, id } = kettingerBoard({
    attachedTo: "mine",
    extra: [
      { key: "myThing", def: item({ name: "My Thing" }), owner: P1, zone: "play" },
      ...volition(1, P1).map((p) => ({ ...p, key: "myFacedown" }))
    ]
  });
  for (const key of ["myThing", "myFacedown"]) assert.throws(() => handoff(engine, id, key), key);
  assert.throws(() => activate(engine, P1, id("k"), "kettinger-handoff", { selected: { newWearer: [engine.state.players[P1].factionId!] } }), "faction");
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine"));
  assert.equal(attachedCount(engine, P1), 0);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "exactly one character: none or two are refused", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  assert.throws(() => activate(engine, P1, id("k"), "kettinger-handoff", { selected: { newWearer: [] } }));
  assert.throws(() => activate(engine, P1, id("k"), "kettinger-handoff", { selected: { newWearer: [id("mine2"), id("mine3")] } }));
  assert.equal(attachedCount(engine, P1), 0);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "the character must not be in a battle: an attacker is refused, one that is not fighting is fine", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine2")], target: { type: "faction", playerId: P2 } } as never);
  assert.ok(engine.state.battle, "a battle is under way and I may respond");
  assert.throws(() => activateRaw(engine, P1, id("k"), "kettinger-handoff", { selected: { newWearer: [id("mine2")] } }), "the attacker is in the battle");
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine"));
  activateRaw(engine, P1, id("k"), "kettinger-handoff", { selected: { newWearer: [id("mine3")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine3"), "a character that is not in the battle may be used");
  assert.equal(engine.state.cards[id("mine3")].depleted, true);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "a blocker is in a battle too: it cannot be the character (defending, in response to the opponent's attack)", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine", active: P2, extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" }] });
  declareAttack(engine, P2, [id("atk")]);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mine2")] } as never);
  assert.equal(engine.state.battle?.blockingParty.includes(id("mine2")), true);
  engine.perform({ type: "passPriority", playerId: P2 } as never);
  assert.throws(() => activateRaw(engine, P1, id("k"), "kettinger-handoff", { selected: { newWearer: [id("mine2")] } }), "the blocker is in the battle");
  activateRaw(engine, P1, id("k"), "kettinger-handoff", { selected: { newWearer: [id("mine3")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine3"));
});

clause(KETTINGER, "2:ability:kettinger-handoff", "the character must be able to be depleted: an already-depleted character is refused", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine", extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  assert.throws(() => handoff(engine, id, "tired"));
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine"));
  assert.equal(attachedCount(engine, P1), 0);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "is refused one resource short of 3, and works with exactly 3", () => {
  const short = kettingerBoard({ attachedTo: "mine", rage: 2 });
  assert.throws(() => handoff(short.engine, short.id, "mine2"));
  assert.equal(short.engine.state.cards[short.id("mine2")].depleted, false, "no partial payment");
  assert.equal(short.engine.state.cards[short.id("k")].attachedTo, short.id("mine"));
  const exact = kettingerBoard({ attachedTo: "mine", rage: 3 });
  handoff(exact.engine, exact.id, "mine2");
  assert.equal(exact.engine.state.cards[exact.id("k")].attachedTo, exact.id("mine2"));
  assert.equal(readyCount(exact.engine, P1), 0);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "can be used again after the next restore: the new host then (restored) can pass it on", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "mine" });
  handoff(engine, id, "mine2");
  assert.throws(() => handoff(engine, id, "mine2"), "mine2 is depleted");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("mine2")].depleted, false);
  handoff(engine, id, "mine3");
  assert.equal(engine.state.cards[id("k")].attachedTo, id("mine3"));
});

clause(KETTINGER, "2:ability:kettinger-handoff", "only its controller can use it", () => {
  const { engine, id } = kettingerBoard({ attachedTo: "foe", active: P2, extra: bank("rage", 5, P2) });
  assert.throws(() => handoff(engine, id, "foe2", P2));
  assert.equal(engine.state.cards[id("k")].attachedTo, id("foe"));
});

// =============================================================================
// Rabid Sarume
// When this card enters play, inflict 1 damage to all your opponent's
// characters. Character (dragon), cost 5, threshold [R][R][R], 4 str / 3 spd / 2 life.
// =============================================================================

const SARUME = "06dceb26-b7b7-49c4-b66c-9fd1b93ef09a";

function sarumeBoard(opts: { rage?: number; greed?: number; inPlay?: boolean; active?: Player; extra?: CardPlacement[]; owner?: Player } = {}) {
  const owner = opts.owner ?? P1;
  const other: Player = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? owner,
    turn: 2,
    cards: [
      { key: "sar", def: printing(SARUME), owner, zone: opts.inPlay ? "play" : "hand" },
      { key: "foe1", def: character({ name: "Foe1", life: 3 }), owner: other, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 3 }), owner: other, zone: "play" },
      { key: "foe3", def: character({ name: "Foe3", life: 1 }), owner: other, zone: "play" },
      { key: "mine1", def: character({ name: "Mine1", life: 3 }), owner, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", life: 1 }), owner, zone: "play" },
      { key: "foeThing", def: item({ name: "Foe Thing" }), owner: other, zone: "play" },
      { key: "foePlace", def: location({ name: "Foe Place", structure: 5 }), owner: other, zone: "play" },
      ...volition(1, other).map((p) => ({ ...p, key: "foeDown" })),
      { key: "handChar", def: character({ name: "Hand Char", life: 3 }), owner, zone: "hand" },
      ...bank("rage", opts.rage ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner),
      ...(opts.extra ?? [])
    ]
  });
}

clause(SARUME, "0:rule", "entering play inflicts 1 damage to each of my opponent's characters", () => {
  const { engine, id } = sarumeBoard();
  const before = readyCount(engine, P1);
  play(engine, P1, id("sar"));
  assert.equal(zoneOf(engine, id("sar")), "play");
  assert.equal(before - readyCount(engine, P1), 5, "the printed cost of 5 is paid");
  assert.equal(damageOf(engine, id("foe1")), 1);
  assert.equal(damageOf(engine, id("foe2")), 1);
  assert.equal(zoneOf(engine, id("foe3")), "discard", "1 damage destroys a 1-life character");
});

clause(SARUME, "0:rule", "a 1-life opposing character is destroyed by it", () => {
  const { engine, id } = sarumeBoard();
  play(engine, P1, id("sar"));
  assert.equal(zoneOf(engine, id("foe3")), "discard");
  assert.equal(zoneOf(engine, id("foe1")), "play");
  assert.equal(zoneOf(engine, id("foe2")), "play");
});

clause(SARUME, "0:rule", "exactly 1 damage each (not 1 in total, not 2)", () => {
  const { engine, id } = sarumeBoard();
  play(engine, P1, id("sar"));
  assert.equal(damageOf(engine, id("foe1")) + damageOf(engine, id("foe2")), 2);
});

clause(SARUME, "0:rule", "none of MY characters, nor the Sarume itself, take damage", () => {
  const { engine, id } = sarumeBoard();
  play(engine, P1, id("sar"));
  assert.equal(damageOf(engine, id("mine1")), 0);
  assert.equal(damageOf(engine, id("mine2")), 0);
  assert.equal(zoneOf(engine, id("mine2")), "play", "my 1-life character survives");
  assert.equal(damageOf(engine, id("sar")), 0);
});

clause(SARUME, "0:rule", "only CHARACTERS: the opponent's items, locations, face-down resources and faction are untouched", () => {
  const { engine, id } = sarumeBoard();
  const influence = influenceOf(engine, P2);
  play(engine, P1, id("sar"));
  assert.equal(damageOf(engine, id("foeThing")), 0);
  assert.equal(damageOf(engine, id("foePlace")), 0);
  assert.equal(damageOf(engine, id("foeDown")), 0);
  assert.equal(zoneOf(engine, id("foeDown")), "play");
  assert.equal(influenceOf(engine, P2), influence, "the faction loses nothing");
  assert.equal(influenceOf(engine, P1), 30);
});

clause(SARUME, "0:rule", "the damage happens when it ENTERS play, not while it is still being deployed", () => {
  const { engine, id } = sarumeBoard();
  playRaw(engine, P1, id("sar"));
  assert.equal(zoneOf(engine, id("sar")), "deploying");
  assert.equal(damageOf(engine, id("foe1")), 0, "not yet");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe1")), 1);
});

clause(SARUME, "0:rule", "a Sarume already in play does not trigger when another card enters play (mine or theirs)", () => {
  const { engine, id } = sarumeBoard({ inPlay: true, extra: [{ key: "oppDeploy", def: character({ name: "Opp Deploy", cost: 0 }), owner: P2, zone: "hand" }] });
  play(engine, P1, id("handChar"));
  assert.equal(zoneOf(engine, id("handChar")), "play");
  for (const key of ["foe1", "foe2"]) assert.equal(damageOf(engine, id(key)), 0, `${key}: no damage from another card entering`);
  assert.equal(zoneOf(engine, id("foe3")), "play");
});

clause(SARUME, "0:rule", "it triggers each time it enters play (a second Sarume deals another round)", () => {
  const { engine, id } = sarumeBoard({ rage: 10, extra: [{ key: "sar2", def: printing(SARUME), owner: P1, zone: "hand" }] });
  play(engine, P1, id("sar"));
  play(engine, P1, id("sar2"));
  assert.equal(damageOf(engine, id("foe1")), 2);
  assert.equal(damageOf(engine, id("foe2")), 2);
});

clause(SARUME, "0:rule", "it triggers when put into play by an effect, not only when deployed", () => {
  const REANIMATE = tactic({
    name: "Reanimate",
    cost: 0,
    behavior: { abilities: [{ id: "re", type: "activated", targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = sarumeBoard({
    extra: [
      { key: "grave", def: printing(SARUME), owner: P1, zone: "discard" },
      { key: "re", def: REANIMATE, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("re"), { selected: { t: [id("grave")] } });
  assert.equal(zoneOf(engine, id("grave")), "play");
  assert.equal(damageOf(engine, id("foe1")), 1);
  assert.equal(damageOf(engine, id("foe2")), 1);
});

clause(SARUME, "0:rule", "'your opponent's' is relative to the Sarume's controller: the opponent's Sarume damages MY characters", () => {
  const { engine, id } = sarumeBoard({ owner: P2 });
  play(engine, P2, id("sar"));
  assert.equal(zoneOf(engine, id("sar")), "play");
  assert.equal(damageOf(engine, id("foe1")), 1, "P1's characters (foe1..) are the Sarume controller's opponent's");
  assert.equal(damageOf(engine, id("foe2")), 1);
  assert.equal(zoneOf(engine, id("foe3")), "discard");
  assert.equal(damageOf(engine, id("mine1")), 0, "the Sarume controller's own characters are safe");
});

clause(SARUME, "0:rule", "with no opposing character nothing happens and nothing is asked", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sar", def: printing(SARUME), owner: P1, zone: "hand" }, { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }, ...bank("rage", 5, P1)]
  });
  play(engine, P1, id("sar"));
  assert.equal(zoneOf(engine, id("sar")), "play");
  assert.equal(pending(engine), undefined);
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(SARUME, "0:rule", "is refused one resource short of its cost of 5, and without [R][R][R]", () => {
  const short = sarumeBoard({ rage: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sar")));
  assert.equal(zoneOf(short.engine, short.id("sar")), "hand");
  assert.equal(damageOf(short.engine, short.id("foe1")), 0);
  const noThreshold = sarumeBoard({ rage: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sar")), "only two [R]");
  const ok = sarumeBoard({ rage: 3, greed: 2 });
  play(ok.engine, P1, ok.id("sar"));
  assert.equal(zoneOf(ok.engine, ok.id("sar")), "play");
  assert.equal(ok.engine.getStat(ok.id("sar"), "strength"), 4);
  assert.equal(ok.engine.getStat(ok.id("sar"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("sar"), "life"), 2);
});

// =============================================================================
// Raging Bask
// If this card is blocked, you may assign its damage to the target of the
// attack instead of the blocking party. (The target of an attack is either a
// faction or a location.) Character (dragon), cost 6, threshold [R][R], 4 str / 3 spd / 4 life.
// =============================================================================

const BASK = "52d7cbbb-e848-441e-95d5-2cb4006f5195";

function baskBoard(opts: { rage?: number; greed?: number; inHand?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "bask", def: printing(BASK), owner: P1, zone: opts.inHand ? "hand" : "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

type Assignment = { sourceId: string; target: { type: "card"; cardId: string } | { type: "faction"; playerId: Player }; amount: number };

/** Runs the battle forward until a player has to assign battle damage. */
function toDamageAssignment(engine: SpoilsEngine) {
  resolvePendingResponses(engine);
  assert.ok(engine.state.battle?.phase === "attackerDamageAssignment" || engine.state.battle?.phase === "defenderDamageAssignment", `at a damage assignment step, was ${engine.state.battle?.phase}`);
  return engine.getBattleView()!;
}

function assignDamage(engine: SpoilsEngine, player: Player, assignments: Assignment[]) {
  engine.perform({ type: "assignBattleDamage", playerId: player, assignments } as never);
  resolvePendingResponses(engine);
}

const factionTarget = (player: Player) => ({ type: "faction", playerId: player }) as const;
const cardTarget = (cardId: string) => ({ type: "card", cardId }) as const;
const sourceOf = (view: NonNullable<ReturnType<SpoilsEngine["getBattleView"]>>, cardId: string) => view.damageSources.find((source) => source.cardId === cardId);
const targetsOf = (view: NonNullable<ReturnType<SpoilsEngine["getBattleView"]>>, cardId: string) =>
  (sourceOf(view, cardId)?.legalTargets ?? []).map((t) => (t.type === "card" ? t.cardId : t.type === "faction" ? `faction:${t.playerId}` : `?`));

function baskAttacks(board: ReturnType<typeof baskBoard>, blockers: string[], target?: { type: "faction"; playerId: Player } | { type: "location"; cardId: string }, party: string[] = ["bask"]) {
  const { engine, id } = board;
  declareAttack(engine, P1, party.map(id), target);
  declareBlockers(engine, P2, blockers.map(id));
  return toDamageAssignment(engine);
}

clause(BASK, "0:rule", "blocked while attacking a faction: its damage may go to the faction instead of the blocker (all 4 to the faction)", () => {
  const board = baskBoard();
  const { engine, id } = board;
  const view = baskAttacks(board, ["b1"]);
  assert.ok(targetsOf(view, id("bask")).includes(`faction:${P2}`), "the target of the attack is a legal recipient");
  assert.ok(targetsOf(view, id("bask")).includes(id("b1")), "the blocker is still a legal recipient");
  assignDamage(engine, P1, [{ sourceId: id("bask"), target: factionTarget(P2), amount: 4 }]);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30 - 4, "the faction took Bask's 4 damage");
  assert.equal(damageOf(engine, id("b1")), 0, "the blocker took none from Bask");
});

clause(BASK, "0:rule", "'you may': it can still assign all its damage to the blocking party as usual", () => {
  const board = baskBoard();
  const { engine, id } = board;
  baskAttacks(board, ["b1"]);
  assignDamage(engine, P1, [{ sourceId: id("bask"), target: cardTarget(id("b1")), amount: 4 }]);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("b1")), 4);
  assert.equal(influenceOf(engine, P2), 30, "the faction took nothing");
});

clause(BASK, "0:rule", "blocked by a party of two: the damage may bypass both blockers and hit the faction", () => {
  const board = baskBoard();
  const { engine, id } = board;
  const view = baskAttacks(board, ["b1", "b2"]);
  const targets = targetsOf(view, id("bask"));
  for (const t of [id("b1"), id("b2"), `faction:${P2}`]) assert.ok(targets.includes(t), `${t} is a legal recipient`);
  assignDamage(engine, P1, [{ sourceId: id("bask"), target: factionTarget(P2), amount: 4 }]);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 26);
  assert.equal(damageOf(engine, id("b1")) + damageOf(engine, id("b2")), 0);
});

clause(BASK, "0:rule", "attacking a LOCATION (the target of the attack), the damage may go to the location instead of the blocker", () => {
  const board = baskBoard();
  const { engine, id } = board;
  const view = baskAttacks(board, ["b1"], { type: "location", cardId: id("place") });
  const targets = targetsOf(view, id("bask"));
  assert.ok(targets.includes(id("place")), "the attacked location is a legal recipient");
  assert.ok(targets.includes(id("b1")), "targets.includes(id(\"b1\"))");
  assert.ok(!targets.includes(`faction:${P2}`), "the faction is not the target of this attack");
  assignDamage(engine, P1, [{ sourceId: id("bask"), target: cardTarget(id("place")), amount: 4 }]);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("place")), 4);
  assert.equal(damageOf(engine, id("b1")), 0);
  assert.equal(influenceOf(engine, P2), 30);
});

clause(BASK, "0:rule", "not blocked: its damage goes to the target of the attack as for any attacker", () => {
  const board = baskBoard();
  const { engine, id } = board;
  const view = baskAttacks(board, []);
  assert.deepEqual(targetsOf(view, id("bask")), [`faction:${P2}`]);
  assignDamage(engine, P1, [{ sourceId: id("bask"), target: factionTarget(P2), amount: 4 }]);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 26);
});

clause(BASK, "0:rule", "only THIS card gets the option: another attacker in the party must still assign to the blockers", () => {
  const board = baskBoard();
  const { engine, id } = board;
  const view = baskAttacks(board, ["b1"], undefined, ["bask", "other"]);
  assert.ok(targetsOf(view, id("bask")).includes(`faction:${P2}`), "targetsOf(view, id(\"bask\")).includes(`faction:${P2}`)");
  const otherTargets = targetsOf(view, id("other"));
  assert.deepEqual(otherTargets, [id("b1")], "the other attacker may only hit the blocker");
  assert.throws(() => assignDamage(engine, P1, [{ sourceId: id("bask"), target: factionTarget(P2), amount: 4 }, { sourceId: id("other"), target: factionTarget(P2), amount: 2 }]));
  assignDamage(engine, P1, [{ sourceId: id("bask"), target: factionTarget(P2), amount: 4 }, { sourceId: id("other"), target: cardTarget(id("b1")), amount: 2 }]);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 26);
  assert.equal(damageOf(engine, id("b1")), 2);
});

clause(BASK, "0:rule", "if the blocker is blocked-then-destroyed first, Bask's damage still reaches the target (no change to normal rules)", () => {
  const board = baskBoard({ extra: [{ key: "fast", def: character({ name: "Fast", strength: 9, life: 3, speed: 5 }), owner: P1, zone: "play" }] });
  const { engine, id } = board;
  declareAttack(engine, P1, [id("bask"), id("fast")]);
  declareBlockers(engine, P2, [id("b1")]);
  const first = toDamageAssignment(engine);
  assert.deepEqual(first.damageSources.map((s) => s.cardId), [id("fast")], "the fastest attacker assigns first");
  assignDamage(engine, P1, [{ sourceId: id("fast"), target: cardTarget(id("b1")), amount: 9 }]);
  assert.equal(zoneOf(engine, id("b1")), "discard");
  const second = toDamageAssignment(engine);
  assert.deepEqual(targetsOf(second, id("bask")), [`faction:${P2}`]);
});

clause(BASK, "0:rule", "defending (blocking) it has no such option: it can only assign to the attackers", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "bask", def: printing(BASK), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttack(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("bask")]);
  resolvePendingResponses(engine);
  let view = engine.getBattleView()!;
  // the attacker (speed 1) assigns after Bask (speed 3): find Bask's step
  let guard = 0;
  while (!sourceOf(view, id("bask")) && guard++ < 6) {
    assignDamage(engine, view.actingPlayerId as Player, view.damageSources.map((s) => ({ sourceId: s.cardId, target: s.legalTargets[0] as never, amount: s.strength })));
    view = engine.getBattleView()!;
  }
  assert.deepEqual(targetsOf(view, id("bask")), [id("atk")], "Bask blocking may only hit the attacker");
});

clause(BASK, "0:rule", "is refused one resource short of its cost of 6, and without [R][R]", () => {
  const short = baskBoard({ inHand: true, rage: 5 });
  assert.throws(() => playRaw(short.engine, P1, short.id("bask")));
  const noThreshold = baskBoard({ inHand: true, rage: 1, greed: 9 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("bask")), "only one [R]");
  const ok = baskBoard({ inHand: true, rage: 2, greed: 4 });
  play(ok.engine, P1, ok.id("bask"));
  assert.equal(zoneOf(ok.engine, ok.id("bask")), "play");
  assert.equal(attachedCount(ok.engine, P1), 6);
  assert.equal(ok.engine.getStat(ok.id("bask"), "strength"), 4);
  assert.equal(ok.engine.getStat(ok.id("bask"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("bask"), "life"), 4);
});

// =============================================================================
// Reckless Challenger
// At the end of your turn, if this card started the turn on your side and did
// not attack, destroy it. Character (fighter), cost 4, threshold [R], 7 str / 3 spd / 1 life.
// =============================================================================

const CHALLENGER = "93e4cad7-05bb-4273-acdd-61af6f0f7072";

function challengerBoard(opts: { rage?: number; greed?: number; inHand?: boolean; fresh?: boolean; depleted?: boolean; owner?: Player; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    turn: 2,
    cards: [
      { key: "rc", def: printing(CHALLENGER), owner, zone: opts.inHand ? "hand" : "play", attackEligible: opts.fresh ? false : true, depleted: opts.depleted },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 5, speed: 1 }), owner, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 0, life: 9, speed: 1 }), owner: owner === P1 ? P2 : P1, zone: "play" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "e1", def: character({ name: "E1" }), owner: P2, zone: "deck" },
      ...bank("rage", opts.rage ?? 0, owner),
      ...bank("greed", opts.greed ?? 0, owner),
      ...(opts.extra ?? [])
    ]
  });
}

clause(CHALLENGER, "0:rule", "it started the turn on my side and I did not attack with it: it is destroyed at the end of my turn", () => {
  const { engine, id } = challengerBoard();
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the turn ended");
  assert.equal(zoneOf(engine, id("rc")), "discard", "destroyed (goes to its owner's discard pile)");
});

clause(CHALLENGER, "0:rule", "it attacked this turn: it survives the end of the turn", () => {
  const { engine, id } = challengerBoard();
  declareAttack(engine, P1, [id("rc")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("rc")), "play");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(zoneOf(engine, id("rc")), "play", "it attacked, so it is not destroyed");
});

clause(CHALLENGER, "0:rule", "it attacked in a party (with others) and was blocked: it still counts as having attacked", () => {
  const { engine, id } = challengerBoard();
  declareAttack(engine, P1, [id("rc"), id("mate")]);
  declareBlockers(engine, P2, [id("foe")]);
  autoResolveBattle(engine);
  if (zoneOf(engine, id("rc")) === "play") {
    endTurn(engine, P1);
    assert.equal(zoneOf(engine, id("rc")), "play");
  }
  assert.equal(zoneOf(engine, id("rc")), "play", "a Challenger that attacked and survived is not culled");
});

clause(CHALLENGER, "0:rule", "another character attacked but not the Challenger: it is still destroyed", () => {
  const { engine, id } = challengerBoard();
  declareAttack(engine, P1, [id("mate")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "discard");
  assert.equal(zoneOf(engine, id("mate")), "play", "the character that did attack is not affected");
});

clause(CHALLENGER, "0:rule", "it entered play this turn (did not start the turn on my side): it is not destroyed at the end of that turn", () => {
  const { engine, id } = challengerBoard({ fresh: true });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(zoneOf(engine, id("rc")), "play");
});

clause(CHALLENGER, "0:rule", "deployed this turn, it survives that turn but is destroyed at the end of my NEXT turn if it still has not attacked", () => {
  const { engine, id } = challengerBoard({ inHand: true, rage: 4 });
  play(engine, P1, id("rc"));
  assert.equal(zoneOf(engine, id("rc")), "play");
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "play", "end of the turn it was played");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(zoneOf(engine, id("rc")), "play", "start of my next turn");
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "discard", "it started that turn on my side and did not attack");
});

clause(CHALLENGER, "0:rule", "'did not attack' is per turn: attacking one turn does not save it on the next", () => {
  const { engine, id } = challengerBoard();
  declareAttack(engine, P1, [id("rc")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "play");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "discard", "this turn it did not attack");
});

clause(CHALLENGER, "0:rule", "a depleted Challenger (which could not attack) is still destroyed", () => {
  const { engine, id } = challengerBoard({ depleted: true });
  endTurn(engine, P1);
  // restore happens at the start of ITS controller's turn, so it is still depleted at the end of this one
  assert.equal(zoneOf(engine, id("rc")), "discard");
});

clause(CHALLENGER, "0:rule", "only at the end of ITS CONTROLLER's turn: it is not destroyed at the end of the opponent's turn", () => {
  const { engine, id } = challengerBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(zoneOf(engine, id("rc")), "play", "the end of the opponent's turn does not cull it");
});

clause(CHALLENGER, "0:rule", "the opponent's Challenger is destroyed at the end of THEIR turn when it did not attack (and not at the end of mine)", () => {
  const { engine, id } = challengerBoard({ owner: P2 });
  // P2 is active. End of P2's turn:
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(zoneOf(engine, id("rc")), "discard");
});

clause(CHALLENGER, "0:rule", "a Challenger I took from the opponent mid-turn did not start the turn on my side: it survives my end of turn", () => {
  const STEAL = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "steal", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = challengerBoard({ owner: P2, fresh: true, extra: [{ key: "steal", def: STEAL, owner: P1, zone: "hand" }] });
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  play(engine, P1, id("steal"), { selected: { t: [id("rc")] } });
  assert.equal(engine.state.cards[id("rc")].controllerId, P1, "I now control it");
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "play", "it started my turn on THEIR side");
});

clause(CHALLENGER, "0:rule", "'at the END of your turn': it is destroyed when the turn actually ends (after the opponent's responses), not when the end of turn is announced (CR 610.1a)", () => {
  const { engine, id } = challengerBoard();
  engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(engine.state.activePlayerId, P1, "the turn has not ended yet; the opponent may respond");
  assert.ok(engine.state.responseWindow, "the opponent's chance to respond to the end of turn");
  assert.equal(zoneOf(engine, id("rc")), "play", "end-of-turn triggers happen after the opponent's responses");
  resolvePendingResponses(engine);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(zoneOf(engine, id("rc")), "discard", "and it is destroyed once the turn has actually ended");
});

clause(CHALLENGER, "0:rule", "an opponent who responds to my end of turn by taking the Challenger saves it: when the turn really ends it is not mine", () => {
  const STEAL = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "steal", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = challengerBoard({ extra: [{ key: "steal", def: STEAL, owner: P2, zone: "hand" }] });
  engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(zoneOf(engine, id("rc")), "play", "still in play while the opponent decides how to respond");
  // the opponent responds to the announcement by stealing the Challenger
  engine.perform({ type: "playCard", playerId: P2, cardId: id("steal"), selected: { t: [id("rc")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("rc")].controllerId, P2, "the opponent controls it when the turn ends");
  assert.equal(zoneOf(engine, id("rc")), "play", "so it is not destroyed at the end of MY turn");
});

clause(CHALLENGER, "0:rule", "its printed 7 strength / 3 speed / 1 life, and it deploys for 4 with [R]", () => {
  const short = challengerBoard({ inHand: true, rage: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rc")));
  const noThreshold = challengerBoard({ inHand: true, greed: 9 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rc")), "no [R]");
  const ok = challengerBoard({ inHand: true, rage: 1, greed: 3 });
  play(ok.engine, P1, ok.id("rc"));
  assert.equal(zoneOf(ok.engine, ok.id("rc")), "play");
  assert.equal(attachedCount(ok.engine, P1), 4);
  assert.equal(ok.engine.getStat(ok.id("rc"), "strength"), 7);
  assert.equal(ok.engine.getStat(ok.id("rc"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("rc"), "life"), 1);
});

// =============================================================================
// Reveille Tower
// All your characters gain 1 strength. Location, cost 2, threshold [R][R][R][R], structure 5.
// =============================================================================

const TOWER = "6dcca61c-61da-4e12-957a-bd2c073d1646";

function towerBoard(opts: { rage?: number; greed?: number; inHand?: boolean; controller?: Player; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "tower", def: printing(TOWER), owner: P1, zone: opts.inHand ? "hand" : "play", controller: opts.controller },
      { key: "a", def: character({ name: "A", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      ...volition(1, P1).map((p) => ({ ...p, key: "myDown" })),
      { key: "handChar", def: character({ name: "Hand Char", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "hand" },
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(TOWER, "0:rule", "every one of my characters gains 1 strength", () => {
  const { engine, id } = towerBoard();
  assert.equal(strengthOf(engine, id("a")), 1 + 1);
  assert.equal(strengthOf(engine, id("b")), 3 + 1);
});

clause(TOWER, "0:rule", "gains strength only: life and speed are unchanged", () => {
  const { engine, id } = towerBoard();
  assert.equal(engine.getStat(id("a"), "life"), 3);
  assert.equal(engine.getStat(id("a"), "speed"), 2);
});

clause(TOWER, "0:rule", "the opponent's characters do not gain it", () => {
  const { engine, id } = towerBoard();
  assert.equal(strengthOf(engine, id("foe")), 2);
});

clause(TOWER, "0:rule", "a character that enters play later gains it too", () => {
  const { engine, id } = towerBoard();
  play(engine, P1, id("handChar"));
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(strengthOf(engine, id("handChar")), 2 + 1);
});

clause(TOWER, "0:rule", "a character in my hand does not (only characters in play)", () => {
  const { engine, id } = towerBoard();
  assert.equal(strengthOf(engine, id("handChar")), 2);
});

clause(TOWER, "0:rule", "the bonus is real in battle: my 1-strength attacker hits the faction for 2", () => {
  const { engine, id } = towerBoard();
  declareAttack(engine, P1, [id("a")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30 - 2);
});

clause(TOWER, "0:rule", "it is a static effect of the card in play: gone when the Tower leaves play", () => {
  const BREAKER = tactic({
    name: "Breaker",
    cost: 0,
    behavior: { abilities: [{ id: "brk", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = towerBoard({ extra: [{ key: "brk", def: BREAKER, owner: P1, zone: "hand" }] });
  assert.equal(strengthOf(engine, id("a")), 2);
  play(engine, P1, id("brk"), { selected: { t: [id("tower")] } });
  assert.equal(zoneOf(engine, id("tower")), "discard");
  assert.equal(strengthOf(engine, id("a")), 1, "back to printed strength");
  assert.equal(strengthOf(engine, id("b")), 3);
});

clause(TOWER, "0:rule", "a Tower in hand gives nothing", () => {
  const { engine, id } = towerBoard({ inHand: true });
  assert.equal(strengthOf(engine, id("a")), 1);
});

clause(TOWER, "0:rule", "two Towers stack: +2", () => {
  const { engine, id } = towerBoard({ extra: [{ key: "tower2", def: printing(TOWER), owner: P1, zone: "play" }] });
  assert.equal(strengthOf(engine, id("a")), 1 + 2);
});

clause(TOWER, "0:rule", "'your' characters are the ones its controller controls: an opponent-controlled Tower buffs THEIR characters, not mine", () => {
  const { engine, id } = towerBoard({ controller: P2 });
  assert.equal(strengthOf(engine, id("foe")), 2 + 1, "the controller's character gains it");
  assert.equal(strengthOf(engine, id("a")), 1, "the owner's characters do not");
  assert.equal(strengthOf(engine, id("b")), 3);
});

clause(TOWER, "0:rule", "a character I control but the opponent owns gains it; one I own but the opponent controls does not", () => {
  const { engine, id } = towerBoard({
    extra: [
      { key: "stolen", def: character({ name: "Stolen", strength: 1 }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent", strength: 1 }), owner: P1, zone: "play", controller: P2 }
    ]
  });
  assert.equal(strengthOf(engine, id("stolen")), 2);
  assert.equal(strengthOf(engine, id("lent")), 1);
});

clause(TOWER, "0:rule", "only characters: face-down resources and items are not characters (no stat to change)", () => {
  const { engine, id } = towerBoard();
  assert.equal(engine.getStat(id("myDown"), "strength"), 0);
});

clause(TOWER, "0:rule", "it is a location with structure 5: destroyed by 5 damage but not by 4", () => {
  const HIT_LOCATION = (amount: number) =>
    tactic({
      name: `Hit Location ${amount}`,
      cost: 0,
      behavior: { abilities: [{ id: "hitloc", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
    });
  const four = towerBoard({ extra: [{ key: "h", def: HIT_LOCATION(4), owner: P1, zone: "hand" }] });
  play(four.engine, P1, four.id("h"), { selected: { t: [four.id("tower")] } });
  assert.equal(zoneOf(four.engine, four.id("tower")), "play", "4 damage does not destroy a structure-5 location");
  const five = towerBoard({ extra: [{ key: "h", def: HIT_LOCATION(5), owner: P1, zone: "hand" }] });
  play(five.engine, P1, five.id("h"), { selected: { t: [five.id("tower")] } });
  assert.equal(zoneOf(five.engine, five.id("tower")), "discard", "5 damage destroys it");
});

clause(TOWER, "0:rule", "is refused without [R][R][R][R], and four [R] deploy it for a cost of 2", () => {
  const noThreshold = towerBoard({ inHand: true, rage: 3, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("tower")), "only three [R]");
  const none = towerBoard({ inHand: true });
  assert.throws(() => playRaw(none.engine, P1, none.id("tower")), "no resources");
  const ok = towerBoard({ inHand: true, rage: 4 });
  play(ok.engine, P1, ok.id("tower"));
  assert.equal(zoneOf(ok.engine, ok.id("tower")), "play");
  assert.equal(attachedCount(ok.engine, P1), 2, "the printed cost of 2 is paid (the four [R] are a threshold, not a cost)");
  assert.equal(readyCount(ok.engine, P1), 5 - 2, "four [R] and a face-down resource: two were spent");
  assert.equal(strengthOf(ok.engine, ok.id("a")), 2, "and its aura is live at once");
});

// =============================================================================
// Rudo Mangod
// UNIQUE RUDOLPHUS.
// PUNCH -- COST: Pay 2, deplete this card, pick a character. X is that
// character's strength, Y is this card's strength. EFFECT: Inflict X damage to
// this card. Inflict Y damage to the character.
// Character (fighter), cost 5, threshold [R][R][R], 4 str / 3 spd / 3 life.
// =============================================================================

const RUDO = "51827cec-b647-4048-bf85-e6f84a66ae17";
const RUDO_FIRST_EDITION = "ae4f6e1e-19c6-4151-be5c-edc185640deb"; // another printing designated UNIQUE RUDOLPHUS
const RUDO_HOLDER_OF_LIGHT = "baa7224f-39ee-4e4b-8788-1f190dbb38f0"; // another card designated UNIQUE RUDOLPHUS

/** A free tactic that adds `amount` strength (permanently) to one chosen character (declaration `t`). */
const strengthTactic = (amount: number, name: string) =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mod",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "permanent" } }]
        }
      ]
    }
  });

/** A free tactic that takes control of one chosen character (declaration `t`). */
const STEAL = tactic({
  name: "Steal",
  cost: 0,
  behavior: { abilities: [{ id: "steal", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
});

function rudoBoard(opts: { rage?: number; greed?: number; rudoDepleted?: boolean; inHand?: boolean; fresh?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "rudo", def: printing(RUDO), owner: P1, zone: opts.inHand ? "hand" : "play", depleted: opts.rudoDepleted, attackEligible: opts.fresh ? false : true },
      { key: "weakFoe", def: character({ name: "Weak Foe", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe3", def: character({ name: "Foe3", strength: 3, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const punch = (engine: SpoilsEngine, id: (key: string) => string, targetKey: string, player: Player = P1) =>
  activate(engine, player, id("rudo"), "punch", { selected: { c: [id(targetKey)] } });

clause(RUDO, "1:ability:punch", "pays exactly 2, depletes Rudo itself, and trades blows: the character takes Y (Rudo's strength 4), Rudo takes X (the character's strength 2)", () => {
  const { engine, id } = rudoBoard();
  const before = readyCount(engine, P1);
  punch(engine, id, "foe2");
  assert.equal(before - readyCount(engine, P1), 2, "COST: Pay 2");
  assert.equal(engine.state.cards[id("rudo")].depleted, true, "COST: deplete this card");
  assert.equal(damageOf(engine, id("rudo")), 2, "X = the character's strength (2) damage to Rudo");
  assert.equal(damageOf(engine, id("foe2")), 4, "Y = Rudo's strength (4) damage to the character");
  assert.equal(zoneOf(engine, id("rudo")), "play");
});

clause(RUDO, "1:ability:punch", "a 0-strength character: Rudo takes nothing and the character takes 4", () => {
  const { engine, id } = rudoBoard();
  punch(engine, id, "weakFoe");
  assert.equal(damageOf(engine, id("rudo")), 0);
  assert.equal(damageOf(engine, id("weakFoe")), 4);
});

clause(RUDO, "1:ability:punch", "a 1-strength character of mine: X=1 to Rudo, Y=4 to it", () => {
  const { engine, id } = rudoBoard();
  punch(engine, id, "mine");
  assert.equal(damageOf(engine, id("rudo")), 1);
  assert.equal(damageOf(engine, id("mine")), 4);
});

clause(RUDO, "1:ability:punch", "X equal to Rudo's life destroys Rudo (3 strength vs 3 life) but the character still takes Y=4", () => {
  const { engine, id } = rudoBoard();
  punch(engine, id, "foe3");
  assert.equal(zoneOf(engine, id("rudo")), "discard", "Rudo took X=3 damage and died");
  assert.equal(damageOf(engine, id("foe3")), 4, "Y was fixed by the cost: the character still takes it");
});

clause(RUDO, "1:ability:punch", "Y uses Rudo's CURRENT strength: an item boosting him by 2 makes it 6", () => {
  const { engine, id } = rudoBoard({ extra: [{ key: "gear", def: strengthGear(2), owner: P1, zone: "play", attachedToKey: "rudo" }] });
  assert.equal(strengthOf(engine, id("rudo")), 6);
  punch(engine, id, "foe2");
  assert.equal(damageOf(engine, id("foe2")), 6, "Y = Rudo's strength now");
  assert.equal(damageOf(engine, id("rudo")), 2);
});

clause(RUDO, "1:ability:punch", "X uses the character's CURRENT strength: a 2-strength character with +1 gear is X=3", () => {
  const { engine, id } = rudoBoard({ extra: [{ key: "gear", def: strengthGear(1), owner: P2, zone: "play", attachedToKey: "foe2" }] });
  assert.equal(strengthOf(engine, id("foe2")), 3);
  punch(engine, id, "foe2");
  assert.equal(zoneOf(engine, id("rudo")), "discard", "X=3 destroys the 3-life Rudo");
  assert.equal(damageOf(engine, id("foe2")), 4);
});

clause(RUDO, "1:ability:punch", "X and Y are fixed when the cost is paid: a response that boosts the character does not raise X", () => {
  const { engine, id } = rudoBoard({ extra: [{ key: "pump", def: strengthTactic(5, "Pump"), owner: P2, zone: "hand" }] });
  activateRaw(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe2")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  playRaw(engine, P2, id("pump"), { selected: { t: [id("foe2")] } });
  resolvePendingResponses(engine);
  assert.equal(strengthOf(engine, id("foe2")), 7, "the response did resolve");
  assert.equal(zoneOf(engine, id("rudo")), "play", "X was 2 when the cost was paid, not 7");
  assert.equal(damageOf(engine, id("rudo")), 2);
  assert.equal(damageOf(engine, id("foe2")), 4);
});

clause(RUDO, "1:ability:punch", "Y is fixed when the cost is paid: a response that weakens Rudo does not lower Y", () => {
  const { engine, id } = rudoBoard({ extra: [{ key: "weaken", def: strengthTactic(-3, "Weaken"), owner: P2, zone: "hand" }] });
  activateRaw(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe2")] } });
  playRaw(engine, P2, id("weaken"), { selected: { t: [id("rudo")] } });
  resolvePendingResponses(engine);
  assert.equal(strengthOf(engine, id("rudo")), 1, "the response did resolve");
  assert.equal(damageOf(engine, id("foe2")), 4, "Y was Rudo's strength (4) when the cost was paid, not 1");
  assert.equal(damageOf(engine, id("rudo")), 2);
});

clause(RUDO, "1:ability:punch", "it can pick Rudo himself: a character in play (even though depleted by the cost); he takes X and Y", () => {
  const { engine, id } = rudoBoard();
  punch(engine, id, "rudo");
  assert.equal(zoneOf(engine, id("rudo")), "discard", "4 + 4 damage destroys him");
});

clause(RUDO, "1:ability:punch", "only a character: an item, a location, a faction or a face-down resource is refused", () => {
  const { engine, id } = rudoBoard();
  for (const key of ["thing", "place", "facedown"]) assert.throws(() => punch(engine, id, key), key);
  assert.throws(() => activate(engine, P1, id("rudo"), "punch", { selected: { c: [engine.state.players[P2].factionId!] } }), "faction");
  assert.equal(engine.state.cards[id("rudo")].depleted, false);
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
});

clause(RUDO, "1:ability:punch", "exactly one character: none or two are refused", () => {
  const { engine, id } = rudoBoard();
  assert.throws(() => activate(engine, P1, id("rudo"), "punch", { selected: { c: [] } }));
  assert.throws(() => activate(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe2"), id("foe3")] } }));
  assert.equal(attachedCount(engine, P1), 0);
});

clause(RUDO, "1:ability:punch", "is refused while Rudo is depleted, and nothing is paid", () => {
  const { engine, id } = rudoBoard({ rudoDepleted: true });
  assert.throws(() => punch(engine, id, "foe2"));
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(damageOf(engine, id("foe2")), 0);
});

clause(RUDO, "1:ability:punch", "is refused one resource short of 2, and works with exactly 2", () => {
  const short = rudoBoard({ rage: 1 });
  assert.throws(() => punch(short.engine, short.id, "foe2"));
  assert.equal(short.engine.state.cards[short.id("rudo")].depleted, false);
  const exact = rudoBoard({ rage: 2 });
  punch(exact.engine, exact.id, "foe2");
  assert.equal(damageOf(exact.engine, exact.id("foe2")), 4);
  assert.equal(readyCount(exact.engine, P1), 0);
});

clause(RUDO, "1:ability:punch", "usable the turn Rudo entered play, and only once until he is restored", () => {
  const { engine, id } = rudoBoard({ fresh: true });
  punch(engine, id, "weakFoe");
  assert.equal(damageOf(engine, id("weakFoe")), 4);
  assert.throws(() => punch(engine, id, "weakFoe"), "depleted now");
  assert.equal(damageOf(engine, id("weakFoe")), 4);
});

clause(RUDO, "1:ability:punch", "only its controller can use it", () => {
  const { engine, id } = rudoBoard({ extra: bank("rage", 3, P2) });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => punch(engine, id, "mine", P2));
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(RUDO, "1:ability:punch", "is refused one resource short of its cost of 5 when deployed, and without [R][R][R]; its printed stats are 4 / 3 / 3", () => {
  const short = rudoBoard({ inHand: true, rage: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rudo")));
  const noThreshold = rudoBoard({ inHand: true, rage: 2, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rudo")), "only two [R]");
  const ok = rudoBoard({ inHand: true, rage: 3, greed: 2 });
  play(ok.engine, P1, ok.id("rudo"));
  assert.equal(zoneOf(ok.engine, ok.id("rudo")), "play");
  assert.equal(attachedCount(ok.engine, P1), 5);
  assert.equal(ok.engine.getStat(ok.id("rudo"), "strength"), 4);
  assert.equal(ok.engine.getStat(ok.id("rudo"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("rudo"), "life"), 3);
});

// --- UNIQUE RUDOLPHUS

function uniqueBoard(second: CardDefinition | "same", opts: { secondZone?: "hand" | "play"; secondOwner?: Player; secondController?: Player; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "r1", def: printing(RUDO), owner: P1, zone: "play" },
      { key: "r2", def: second === "same" ? printing(RUDO) : second, owner: opts.secondOwner ?? P1, zone: opts.secondZone ?? "hand", controller: opts.secondController },
      ...bank("rage", 10, P1),
      ...bank("rage", 10, P2),
      ...(opts.extra ?? [])
    ]
  });
}

clause(RUDO, "0:unique", "playing a second Rudo Mangod: I choose which one to keep (keep the new one: the old is destroyed)", () => {
  const { engine, id } = uniqueBoard("same");
  play(engine, P1, id("r2"));
  const pc = pending(engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("r1"), id("r2")].sort());
  answer(engine, { kind: "uniqueSurvivor", keep: id("r2") });
  assert.equal(zoneOf(engine, id("r2")), "play");
  assert.equal(zoneOf(engine, id("r1")), "discard", "the other is destroyed");
  assert.equal(pending(engine), undefined);
});

clause(RUDO, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = uniqueBoard("same");
  play(engine, P1, id("r2"));
  answer(engine, { kind: "uniqueSurvivor", keep: id("r1") });
  assert.equal(zoneOf(engine, id("r1")), "play");
  assert.equal(zoneOf(engine, id("r2")), "discard");
});

clause(RUDO, "0:unique", "the choice cannot be skipped: nothing else proceeds until a survivor is chosen, and it must be one of the two", () => {
  const { engine, id } = uniqueBoard("same", { extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  play(engine, P1, id("r2"));
  assert.throws(() => answer(engine, { kind: "uniqueSurvivor", keep: id("other") }), "not a candidate");
  assert.throws(() => endTurn(engine, P1), "the game is waiting for the choice");
  assert.equal(pending(engine)?.kind, "uniqueSurvivor");
});

clause(RUDO, "0:unique", "other printings designated UNIQUE RUDOLPHUS count as the same designation (Rudo Mangod, 1st Edition)", () => {
  const { engine, id } = uniqueBoard(printing(RUDO_FIRST_EDITION));
  play(engine, P1, id("r2"));
  assert.equal(pending(engine)?.kind, "uniqueSurvivor");
  answer(engine, { kind: "uniqueSurvivor", keep: id("r1") });
  assert.equal(zoneOf(engine, id("r2")), "discard");
});

clause(RUDO, "0:unique", "...and Rudo Mangod, Holder of Light too", () => {
  const { engine, id } = uniqueBoard(printing(RUDO_HOLDER_OF_LIGHT));
  play(engine, P1, id("r2"));
  assert.equal(pending(engine)?.kind, "uniqueSurvivor");
});

clause(RUDO, "0:unique", "it is per player: the opponent may control their own Rudo Mangod with no choice and no destruction", () => {
  const { engine, id } = uniqueBoard("same", { secondOwner: P2, secondZone: "play" });
  endTurn(engine, P1);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("r1")), "play");
  assert.equal(zoneOf(engine, id("r2")), "play");
});

clause(RUDO, "0:unique", "the opponent deploying their own Rudo while I have mine on the table is fine", () => {
  const { engine, id } = uniqueBoard("same", { secondOwner: P2, secondZone: "hand" });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  play(engine, P2, id("r2"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("r2")), "play");
  assert.equal(zoneOf(engine, id("r1")), "play");
});

clause(RUDO, "0:unique", "taking control of the opponent's Rudo while I have one forces me to choose (FAQ), and the copy not kept is destroyed", () => {
  const { engine, id } = uniqueBoard("same", { secondOwner: P2, secondZone: "play", extra: [{ key: "steal", def: STEAL, owner: P1, zone: "hand" }] });
  playRaw(engine, P1, id("steal"), { selected: { t: [id("r2")] } });
  // the opponent has nothing to answer with: pass, so the tactic resolves
  engine.perform({ type: "passPriority", playerId: P2 } as never);
  engine.perform({ type: "advanceFlow" } as never);
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor", "I now control two Rudo Mangods");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc!.candidates as string[])].sort(), [id("r1"), id("r2")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("r1") } } as never);
  assert.equal(zoneOf(engine, id("r1")), "play");
  assert.equal(zoneOf(engine, id("r2")), "discard");
});

clause(RUDO, "0:unique", "after choosing which stolen/own Rudo to keep, the stealing tactic finishes resolving (it is discarded and the game goes on)", () => {
  const { engine, id } = uniqueBoard("same", { secondOwner: P2, secondZone: "play", extra: [{ key: "steal", def: STEAL, owner: P1, zone: "hand" }] });
  playRaw(engine, P1, id("steal"), { selected: { t: [id("r2")] } });
  engine.perform({ type: "passPriority", playerId: P2 } as never);
  engine.perform({ type: "advanceFlow" } as never);
  assert.equal(pending(engine)?.kind, "uniqueSurvivor");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("r1") } } as never);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("steal")), "discard", "the resolved tactic goes to its owner's discard pile");
  assert.equal(engine.state.responseWindow, undefined, "the response window has closed and play can go on");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "I can end my turn");
});

clause(RUDO, "0:unique", "a different UNIQUE designation does not conflict", () => {
  const OTHER_UNIQUE = character({ name: "Other Unique", unique: "someone-else", strength: 1, life: 1 });
  const { engine, id } = uniqueBoard(OTHER_UNIQUE);
  play(engine, P1, id("r2"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("r1")), "play");
  assert.equal(zoneOf(engine, id("r2")), "play");
});

clause(RUDO, "0:unique", "a Rudo in my hand (or discard) does not conflict with the one in play", () => {
  const { engine, id } = uniqueBoard("same");
  endTurn(engine, P1);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("r1")), "play");
  assert.equal(zoneOf(engine, id("r2")), "hand");
});

// =============================================================================
// Shriever Attack
// Inflict 2 damage to all characters. Tactic, cost 4, threshold [R][R].
// =============================================================================

const SHRIEVER = "da97b625-3ba0-4b07-bddd-f5239b29f5a2";

function shrieverBoard(opts: { rage?: number; greed?: number; active?: Player; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "sh", def: printing(SHRIEVER), owner: P1, zone: "hand" },
      { key: "mine3", def: character({ name: "Mine3", life: 3 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", life: 2 }), owner: P1, zone: "play" },
      { key: "foe3", def: character({ name: "Foe3", life: 3 }), owner: P2, zone: "play" },
      { key: "foe1", def: character({ name: "Foe1", life: 1 }), owner: P2, zone: "play" },
      { key: "tired", def: character({ name: "Tired", life: 4 }), owner: P2, zone: "play", depleted: true },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "myThing", def: item({ name: "My Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 4 }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      { key: "handChar", def: character({ name: "Hand Char", life: 3 }), owner: P2, zone: "hand" },
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(SHRIEVER, "0:rule", "every character in play takes exactly 2 damage: mine and theirs", () => {
  const { engine, id } = shrieverBoard();
  const before = readyCount(engine, P1);
  play(engine, P1, id("sh"));
  assert.equal(before - readyCount(engine, P1), 4, "the printed cost of 4 is paid");
  assert.equal(damageOf(engine, id("mine3")), 2, "my 3-life character");
  assert.equal(damageOf(engine, id("foe3")), 2, "their 3-life character");
  assert.equal(damageOf(engine, id("tired")), 2, "a depleted character is a character too");
  assert.equal(zoneOf(engine, id("sh")), "discard", "the tactic ends in its owner's discard pile");
});

clause(SHRIEVER, "0:rule", "characters whose life is 2 or less are destroyed (2 damage is lethal at life 2, and at life 1)", () => {
  const { engine, id } = shrieverBoard();
  play(engine, P1, id("sh"));
  assert.equal(zoneOf(engine, id("mine2")), "discard");
  assert.equal(zoneOf(engine, id("foe1")), "discard");
  assert.equal(zoneOf(engine, id("mine3")), "play", "life 3 survives with 2 damage");
  assert.equal(zoneOf(engine, id("foe3")), "play");
});

clause(SHRIEVER, "0:rule", "only characters: items, locations, face-down resources, factions and cards in hand are not damaged", () => {
  const { engine, id } = shrieverBoard();
  const influence = [influenceOf(engine, P1), influenceOf(engine, P2)];
  play(engine, P1, id("sh"));
  for (const key of ["thing", "myThing", "place", "facedown", "handChar"]) assert.equal(damageOf(engine, id(key)), 0, `${key} takes no damage`);
  assert.deepEqual([influenceOf(engine, P1), influenceOf(engine, P2)], influence, "no faction loses influence");
  assert.equal(zoneOf(engine, id("place")), "play");
});

clause(SHRIEVER, "0:rule", "the damage is 2 per character (not 2 split between them)", () => {
  const { engine, id } = shrieverBoard();
  play(engine, P1, id("sh"));
  assert.equal(damageOf(engine, id("tired")) + damageOf(engine, id("foe3")) + damageOf(engine, id("mine3")), 6);
});

clause(SHRIEVER, "0:rule", "two Shriever Attacks stack: 4 damage in total", () => {
  const { engine, id } = shrieverBoard({ rage: 8, extra: [{ key: "sh2", def: printing(SHRIEVER), owner: P1, zone: "hand" }] });
  play(engine, P1, id("sh"));
  play(engine, P1, id("sh2"));
  assert.equal(zoneOf(engine, id("tired")), "discard", "4 damage destroys the 4-life character");
  assert.equal(zoneOf(engine, id("mine3")), "discard");
  assert.equal(zoneOf(engine, id("foe3")), "discard");
});

clause(SHRIEVER, "0:rule", "damage is dealt now: a character that enters play afterwards is unharmed", () => {
  const { engine, id } = shrieverBoard({ extra: [{ key: "late", def: character({ name: "Late", cost: 0, life: 3 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("sh"));
  play(engine, P1, id("late"));
  assert.equal(damageOf(engine, id("late")), 0);
});

clause(SHRIEVER, "0:rule", "is a tactic: it can be played in response on the opponent's turn", () => {
  const { engine, id } = shrieverBoard({ active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playNoopOnOwnTurn(engine, id, P2);
  playRaw(engine, P1, id("sh"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe3")), 2);
  assert.equal(zoneOf(engine, id("sh")), "discard");
});

clause(SHRIEVER, "0:rule", "but not on the opponent's turn when there is nothing to respond to", () => {
  const { engine, id } = shrieverBoard({ active: P2 });
  assert.throws(() => playRaw(engine, P1, id("sh")));
  assert.equal(zoneOf(engine, id("sh")), "hand");
  assert.equal(damageOf(engine, id("foe3")), 0);
});

clause(SHRIEVER, "0:rule", "is refused one resource short of its cost of 4, and without [R][R]", () => {
  const short = shrieverBoard({ rage: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sh")));
  assert.equal(attachedCount(short.engine, P1), 0);
  const noThreshold = shrieverBoard({ rage: 1, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sh")), "only one [R]");
  const exact = shrieverBoard({ rage: 2, greed: 2 });
  play(exact.engine, P1, exact.id("sh"));
  assert.equal(damageOf(exact.engine, exact.id("foe3")), 2, "[R][R] and four resources in all is enough");
});

// =============================================================================
// Siege Machine
// BATTERING RAM -- COST: Pay 2, destroy a resource you control.
// EFFECT: Your opponent's faction loses 1 influence.
// Item, cost 0, threshold [R][R][R][R].
// =============================================================================

const SIEGE = "5c02a5f8-543e-456b-8ee2-075fd1f6bff9";

function siegeBoard(opts: { rage?: number; greed?: number; spent?: number; inHand?: boolean; extra?: CardPlacement[]; oppInfluence?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), ...(opts.oppInfluence !== undefined ? { influence: opts.oppInfluence } : {}) },
    turn: 2,
    cards: [
      { key: "sm", def: printing(SIEGE), owner: P1, zone: opts.inHand ? "hand" : "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("deception", opts.spent ?? 0, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("rage", 2, P2),
      ...(opts.extra ?? [])
    ]
  });
}

/** The resources P1 controls (rage ones), in the order they were placed. */
const myResources = (engine: SpoilsEngine) => engine.state.players[P1].play.filter((cardId) => engine.isResource(cardId));

const ram = (engine: SpoilsEngine, resourceId: string) => activate(engine, P1, engine.state.players[P1].play.find((c) => engine.getDefinition(c).name === "Siege Machine")!, "ram", { selected: { r: [resourceId] } });

clause(SIEGE, "0:ability:ram", "pays 2 (attached), destroys the chosen resource, and the opposing faction loses 1 influence", () => {
  const { engine } = siegeBoard({ rage: 5 });
  const target = myResources(engine)[4]; // not one the engine would pick first to pay with
  const before = readyCount(engine, P1);
  ram(engine, target);
  assert.equal(zoneOf(engine, target), "discard", "COST: the resource is destroyed");
  assert.equal(attachedCount(engine, P1), 2, "COST: pay 2 (two resources are attached)");
  assert.equal(before - readyCount(engine, P1), 3, "one destroyed, two spent");
  assert.equal(influenceOf(engine, P2), 29, "EFFECT: the opponent's faction loses 1 influence");
  assert.equal(influenceOf(engine, P1), 30, "mine is untouched");
});

clause(SIEGE, "0:ability:ram", "whichever resource is destroyed, the 2 paid are two OTHER resources: a destroyed resource cannot also be part of the payment", () => {
  for (let index = 0; index < 5; index++) {
    const { engine } = siegeBoard({ rage: 5 });
    const target = myResources(engine)[index];
    const before = readyCount(engine, P1);
    ram(engine, target);
    assert.equal(zoneOf(engine, target), "discard", `resource #${index} destroyed`);
    assert.equal(attachedCount(engine, P1), 2, `resource #${index}: two other resources were paid`);
    assert.equal(before - readyCount(engine, P1), 3, `resource #${index}: one destroyed and two spent`);
  }
});

clause(SIEGE, "0:ability:ram", "the influence loss is exactly 1, however many resources are in play", () => {
  const { engine } = siegeBoard({ rage: 9 });
  ram(engine, myResources(engine)[0]);
  assert.equal(influenceOf(engine, P2), 29);
});

clause(SIEGE, "0:ability:ram", "it is influence LOSS, not damage: no damage event is dealt and the faction is not 'damaged'", () => {
  const { engine } = siegeBoard({ rage: 5 });
  ram(engine, myResources(engine)[0]);
  assert.equal(eventsOf(engine, "damageDealt").length, 0);
});

clause(SIEGE, "0:ability:ram", "the destroyed resource must be one I CONTROL: an opponent's resource is refused", () => {
  const { engine } = siegeBoard({ rage: 5 });
  const theirs = engine.state.players[P2].play.filter((c) => engine.isResource(c))[0];
  assert.throws(() => ram(engine, theirs));
  assert.equal(zoneOf(engine, theirs), "play");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
  assert.equal(influenceOf(engine, P2), 30);
});

clause(SIEGE, "0:ability:ram", "a resource I control but the opponent owns can be destroyed", () => {
  const { engine, id } = siegeBoard({ rage: 5, extra: bank("greed", 1, P2).map((p) => ({ ...p, key: "taken", controller: P1 })) });
  ram(engine, id("taken"));
  assert.equal(zoneOf(engine, id("taken")), "discard");
  assert.equal(influenceOf(engine, P2), 29);
});

clause(SIEGE, "0:ability:ram", "only a RESOURCE can be destroyed: not a character, an item (not even the Siege Machine), a location or a faction", () => {
  const { engine, id } = siegeBoard({ rage: 5 });
  for (const key of ["mine", "foe", "sm"]) assert.throws(() => ram(engine, id(key)), key);
  assert.throws(() => ram(engine, engine.state.players[P1].factionId!), "faction");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("sm")), "play");
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(influenceOf(engine, P2), 30);
});

clause(SIEGE, "0:ability:ram", "a face-down resource is a resource: it can be destroyed", () => {
  const { engine, id } = siegeBoard({ rage: 4, extra: volition(1, P1).map((p) => ({ ...p, key: "down" })) });
  ram(engine, id("down"));
  assert.equal(zoneOf(engine, id("down")), "discard");
  assert.equal(influenceOf(engine, P2), 29);
});

clause(SIEGE, "0:ability:ram", "a resource already spent (attached to my faction) this turn can be the one destroyed", () => {
  const { engine } = siegeBoard({ rage: 4, spent: 1 });
  const spent = myResources(engine).find((c) => engine.state.cards[c].attachedTo === factionOf(engine, P1))!;
  ram(engine, spent);
  assert.equal(zoneOf(engine, spent), "discard");
  assert.equal(attachedCount(engine, P1), 2, "two of the four ready resources were then paid");
  assert.equal(readyCount(engine, P1), 2);
  assert.equal(influenceOf(engine, P2), 29);
});

clause(SIEGE, "0:ability:ram", "numeric costs are paid LAST (CR 406.4): with only 2 ready resources I cannot destroy one of them and still pay 2", () => {
  const { engine } = siegeBoard({ rage: 2 });
  const [target] = myResources(engine);
  assert.throws(() => ram(engine, target));
  assert.equal(zoneOf(engine, target), "play", "nothing was destroyed");
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(influenceOf(engine, P2), 30);
});

clause(SIEGE, "0:ability:ram", "with 3 ready resources: one is destroyed, the other two are paid, nothing is left", () => {
  const { engine } = siegeBoard({ rage: 3 });
  ram(engine, myResources(engine)[0]);
  assert.equal(readyCount(engine, P1), 0);
  assert.equal(attachedCount(engine, P1), 2);
  assert.equal(influenceOf(engine, P2), 29);
});

clause(SIEGE, "0:ability:ram", "is refused with fewer than 2 resources left to pay, and with none at all", () => {
  const spent = siegeBoard({ rage: 4, spent: 3 });
  // 7 resources, 3 already spent -> 4 ready: fine. Now spend more so only 1 ready remains after the destroy.
  assert.equal(readyCount(spent.engine, P1), 4);
  const tight = siegeBoard({ rage: 1, spent: 4 });
  assert.throws(() => ram(tight.engine, myResources(tight.engine)[0]));
  const none = siegeBoard({ rage: 0 });
  assert.throws(() => activate(none.engine, P1, none.id("sm"), "ram", { selected: { r: [] } }));
  assert.equal(influenceOf(tight.engine, P2), 30);
});

clause(SIEGE, "0:ability:ram", "the opponent's faction at 1 influence is reduced to 0 and I win", () => {
  const { engine } = siegeBoard({ rage: 5, oppInfluence: 1 });
  ram(engine, myResources(engine)[0]);
  assert.equal(influenceOf(engine, P2), 0);
  assert.equal(engine.state.winner, P1);
});

clause(SIEGE, "0:ability:ram", "may be used repeatedly (no limit is printed): each use destroys another resource and costs another influence", () => {
  const { engine } = siegeBoard({ rage: 9 });
  const [first] = myResources(engine);
  ram(engine, first);
  const second = myResources(engine).find((c) => engine.state.cards[c].attachedTo === undefined)!;
  ram(engine, second);
  assert.equal(influenceOf(engine, P2), 28);
});

clause(SIEGE, "0:ability:ram", "only its controller can use it", () => {
  const { engine } = siegeBoard({ rage: 5 });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  const theirs = engine.state.players[P2].play.filter((c) => engine.isResource(c))[0];
  assert.throws(() =>
    engine.perform({ type: "activateAbility", playerId: P2, cardId: engine.state.players[P1].play.find((c) => engine.getDefinition(c).name === "Siege Machine")!, abilityId: "ram", selected: { r: [theirs] }, variables: {} } as never)
  );
  assert.equal(influenceOf(engine, P1), 30);
});

clause(SIEGE, "0:ability:ram", "is deployed for cost 0 with [R][R][R][R]; refused with only three [R]", () => {
  const noThreshold = siegeBoard({ inHand: true, rage: 3, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sm")), "three [R] is not four");
  const ok = siegeBoard({ inHand: true, rage: 4 });
  play(ok.engine, P1, ok.id("sm"));
  assert.equal(zoneOf(ok.engine, ok.id("sm")), "play");
  assert.equal(attachedCount(ok.engine, P1), 0, "the printed cost of 0: nothing is paid");
  assert.equal(readyCount(ok.engine, P1), 4);
});

// =============================================================================
// Skewer
// COST: Pick a value for X. Pay twice X, then pick a character.
// EFFECT: Inflict X damage to the character. Tactic, cost 0, threshold [R].
// =============================================================================

const SKEWER = "e8c328cd-52e3-48b3-a18b-1b4c892af1d6";

function skewerBoard(opts: { rage?: number; greed?: number; active?: Player; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "sk", def: printing(SKEWER), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 9 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play" },
      { key: "glass", def: character({ name: "Glass", life: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      ...bank("rage", opts.rage ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

for (const x of [0, 1, 2, 3]) {
  clause(SKEWER, "0:ability", `X=${x}: pays exactly ${2 * x} (twice X) and inflicts ${x} damage to the picked character`, () => {
    const { engine, id } = skewerBoard();
    const before = readyCount(engine, P1);
    play(engine, P1, id("sk"), { variables: { x }, selected: { target: [id("foe")] } });
    assert.equal(before - readyCount(engine, P1), 2 * x, `twice X = ${2 * x}`);
    assert.equal(attachedCount(engine, P1), 2 * x);
    assert.equal(damageOf(engine, id("foe")), x);
    assert.equal(damageOf(engine, id("foe2")) + damageOf(engine, id("mine")) + damageOf(engine, id("glass")), 0, "nobody else is damaged");
    assert.equal(zoneOf(engine, id("sk")), "discard");
  });
}

clause(SKEWER, "0:ability", "X=2 destroys a 2-life character (damage equal to its life is lethal); X=1 does not", () => {
  const lethal = skewerBoard();
  play(lethal.engine, P1, lethal.id("sk"), { variables: { x: 2 }, selected: { target: [lethal.id("glass")] } });
  assert.equal(zoneOf(lethal.engine, lethal.id("glass")), "discard");
  const nonLethal = skewerBoard();
  play(nonLethal.engine, P1, nonLethal.id("sk"), { variables: { x: 1 }, selected: { target: [nonLethal.id("glass")] } });
  assert.equal(zoneOf(nonLethal.engine, nonLethal.id("glass")), "play");
  assert.equal(damageOf(nonLethal.engine, nonLethal.id("glass")), 1);
});

clause(SKEWER, "0:ability", "can pick one of my own characters", () => {
  const { engine, id } = skewerBoard();
  play(engine, P1, id("sk"), { variables: { x: 2 }, selected: { target: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2);
});

clause(SKEWER, "0:ability", "X is refused when twice X cannot be paid (X=3 needs 6; with 5 resources it is refused, X=2 works)", () => {
  const { engine, id } = skewerBoard({ rage: 5 });
  assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x: 3 }, selected: { target: [id("foe")] } }));
  assert.equal(zoneOf(engine, id("sk")), "hand");
  assert.equal(attachedCount(engine, P1), 0);
  play(engine, P1, id("sk"), { variables: { x: 2 }, selected: { target: [id("foe")] } });
  assert.equal(damageOf(engine, id("foe")), 2);
  assert.equal(readyCount(engine, P1), 1);
});

clause(SKEWER, "0:ability", "twice X, not X: with exactly 2X-1 resources it is refused", () => {
  for (const x of [1, 2, 3]) {
    const { engine, id } = skewerBoard({ rage: 2 * x - 1 });
    assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x }, selected: { target: [id("foe")] } }), `X=${x}`);
    const exact = skewerBoard({ rage: 2 * x });
    play(exact.engine, P1, exact.id("sk"), { variables: { x }, selected: { target: [exact.id("foe")] } });
    assert.equal(damageOf(exact.engine, exact.id("foe")), x, `X=${x} with exactly ${2 * x}`);
    assert.equal(readyCount(exact.engine, P1), 0);
  }
});

clause(SKEWER, "0:ability", "X cannot be negative", () => {
  const { engine, id } = skewerBoard();
  assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x: -1 }, selected: { target: [id("foe")] } }));
  assert.equal(damageOf(engine, id("foe")), 0);
});

clause(SKEWER, "0:ability", "X is a whole number (CR 410.2): a fractional X is refused", () => {
  const { engine, id } = skewerBoard();
  assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x: 1.5 }, selected: { target: [id("foe")] } }), "X=1.5");
  assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x: 0.5 }, selected: { target: [id("foe")] } }), "X=0.5");
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(attachedCount(engine, P1), 0);
});

clause(SKEWER, "0:ability", "the character is required even at X=0: playing it with no pick is refused", () => {
  const { engine, id } = skewerBoard();
  assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x: 1 }, selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x: 0 }, selected: { target: [] } }));
  assert.equal(zoneOf(engine, id("sk")), "hand");
});

clause(SKEWER, "0:ability", "only a character can be picked: not an item, a location, a faction or a face-down resource", () => {
  const { engine, id } = skewerBoard();
  for (const key of ["thing", "place", "facedown"]) assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [id(key)] } }), key);
  assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [engine.state.players[P2].factionId!] } }), "faction");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(SKEWER, "0:ability", "exactly one character: two are refused", () => {
  const { engine, id } = skewerBoard();
  assert.throws(() => playRaw(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [id("foe"), id("foe2")] } }));
  assert.equal(attachedCount(engine, P1), 0);
});

clause(SKEWER, "0:ability", "threshold [R]: refused without any [R] even at X=0 with other resources; fine with one [R] among the payment", () => {
  const noRage = skewerBoard({ rage: 0, greed: 6 });
  assert.throws(() => playRaw(noRage.engine, P1, noRage.id("sk"), { variables: { x: 0 }, selected: { target: [noRage.id("foe")] } }), "X=0");
  assert.throws(() => playRaw(noRage.engine, P1, noRage.id("sk"), { variables: { x: 2 }, selected: { target: [noRage.id("foe")] } }), "X=2");
  const one = skewerBoard({ rage: 1, greed: 5 });
  play(one.engine, P1, one.id("sk"), { variables: { x: 3 }, selected: { target: [one.id("foe")] } });
  assert.equal(damageOf(one.engine, one.id("foe")), 3, "one [R] and five other resources pay 2X=6");
});

clause(SKEWER, "0:ability", "its printed cost is 0: X=0 needs no resources beyond the [R] threshold", () => {
  const { engine, id } = skewerBoard({ rage: 1 });
  play(engine, P1, id("sk"), { variables: { x: 0 }, selected: { target: [id("foe")] } });
  assert.equal(zoneOf(engine, id("sk")), "discard");
  assert.equal(readyCount(engine, P1), 1, "nothing was spent");
});

clause(SKEWER, "0:ability", "is a tactic: playable in response on the opponent's turn", () => {
  const { engine, id } = skewerBoard({ active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playNoopOnOwnTurn(engine, id, P2);
  playRaw(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe")), 1);
});

// =============================================================================
// Sleeping Guard
// While your opponent controls a character, this card gains 1 strength and
// 1 life. Character (soldier), cost 2, threshold [R], 1 str / 3 spd / 1 life.
// =============================================================================

const GUARD = "1b6600af-3910-4cb2-9899-5fbe3006e6ee";

function guardBoard(opts: { oppChars?: number; guardOwner?: Player; extra?: CardPlacement[]; inHand?: boolean; rage?: number; greed?: number } = {}) {
  const owner = opts.guardOwner ?? P1;
  const other: Player = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    turn: 2,
    cards: [
      { key: "g", def: printing(GUARD), owner, zone: opts.inHand ? "hand" : "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 1 }), owner, zone: "play" },
      ...Array.from({ length: opts.oppChars ?? 1 }, (_, i) => ({ key: `opp${i}`, def: character({ name: `Opp${i}`, strength: 1, life: 3, speed: 1 }), owner: other, zone: "play" as const })),
      { key: "oppThing", def: item({ name: "Opp Thing" }), owner: other, zone: "play" },
      { key: "oppPlace", def: location({ name: "Opp Place" }), owner: other, zone: "play" },
      ...bank("rage", opts.rage ?? 0, owner),
      ...bank("greed", opts.greed ?? 0, owner),
      ...(opts.extra ?? [])
    ]
  });
}

clause(GUARD, "0:rule", "while my opponent controls a character, it gains 1 strength and 1 life (1/1 becomes 2/2)", () => {
  const { engine, id } = guardBoard();
  assert.equal(engine.getStat(id("g"), "strength"), 2);
  assert.equal(engine.getStat(id("g"), "life"), 2);
  assert.equal(engine.getStat(id("g"), "speed"), 3, "speed is unchanged");
});

clause(GUARD, "0:rule", "the bonus is +1/+1 once, however many characters the opponent controls", () => {
  const { engine, id } = guardBoard({ oppChars: 3 });
  assert.equal(engine.getStat(id("g"), "strength"), 2);
  assert.equal(engine.getStat(id("g"), "life"), 2);
});

clause(GUARD, "0:rule", "off when the opponent controls no character: printed 1 strength and 1 life", () => {
  const { engine, id } = guardBoard({ oppChars: 0 });
  assert.equal(engine.getStat(id("g"), "strength"), 1);
  assert.equal(engine.getStat(id("g"), "life"), 1);
});

clause(GUARD, "0:rule", "my own characters do not count: with only my Ally and the Guard, no bonus", () => {
  const { engine, id } = guardBoard({ oppChars: 0 });
  assert.equal(engine.getStat(id("g"), "strength"), 1);
  assert.equal(engine.state.cards[id("ally")].zone, "play");
});

clause(GUARD, "0:rule", "the opponent's items, locations and face-down resources are not characters", () => {
  const { engine, id } = guardBoard({ oppChars: 0, extra: volition(2, P2) });
  assert.equal(engine.getStat(id("g"), "strength"), 1);
  assert.equal(engine.getStat(id("g"), "life"), 1);
});

clause(GUARD, "0:rule", "it switches on when the opponent gets a character and off again when the last one leaves", () => {
  const KILLER_ANY = tactic({
    name: "Killer Any",
    cost: 0,
    behavior: { abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = guardBoard({ extra: [{ key: "kill", def: KILLER_ANY, owner: P1, zone: "hand" }] });
  assert.equal(engine.getStat(id("g"), "strength"), 2);
  play(engine, P1, id("kill"), { selected: { t: [id("opp0")] } });
  assert.equal(zoneOf(engine, id("opp0")), "discard");
  assert.equal(engine.getStat(id("g"), "strength"), 1, "back to printed strength");
  assert.equal(engine.getStat(id("g"), "life"), 1);
});

clause(GUARD, "0:rule", "it switches on when an opposing character is deployed", () => {
  const { engine, id } = guardBoard({ oppChars: 0, extra: [{ key: "newOpp", def: character({ name: "New Opp", cost: 0 }), owner: P2, zone: "hand" }] });
  assert.equal(engine.getStat(id("g"), "strength"), 1);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  play(engine, P2, id("newOpp"));
  assert.equal(zoneOf(engine, id("newOpp")), "play");
  assert.equal(engine.getStat(id("g"), "strength"), 2);
  assert.equal(engine.getStat(id("g"), "life"), 2);
});

clause(GUARD, "0:rule", "the extra life is real: 1 damage does not kill it while the condition holds, 2 does", () => {
  const one = guardBoard({ extra: [{ key: "hit1", def: hitter(1), owner: P1, zone: "hand" }] });
  play(one.engine, P1, one.id("hit1"), { selected: { t: [one.id("g")] } });
  assert.equal(zoneOf(one.engine, one.id("g")), "play");
  const two = guardBoard({ extra: [{ key: "hit2", def: hitter(2), owner: P1, zone: "hand" }] });
  play(two.engine, P1, two.id("hit2"), { selected: { t: [two.id("g")] } });
  assert.equal(zoneOf(two.engine, two.id("g")), "discard");
});

clause(GUARD, "0:rule", "when the bonus stops, damage already taken can destroy it (1 damage on a 1-life Guard)", () => {
  const KILLER_ANY = tactic({
    name: "Killer Any",
    cost: 0,
    behavior: { abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = guardBoard({ extra: [{ key: "hit1", def: hitter(1), owner: P1, zone: "hand" }, { key: "kill", def: KILLER_ANY, owner: P1, zone: "hand" }] });
  play(engine, P1, id("hit1"), { selected: { t: [id("g")] } });
  assert.equal(zoneOf(engine, id("g")), "play", "survives with the bonus life");
  play(engine, P1, id("kill"), { selected: { t: [id("opp0")] } });
  assert.equal(zoneOf(engine, id("g")), "discard", "the bonus is gone and the damage is now lethal");
});

clause(GUARD, "0:rule", "the extra strength is real in battle: it hits the faction for 2", () => {
  const { engine, id } = guardBoard({ extra: [{ key: "blockerless", def: character({ name: "x", cost: 0 }), owner: P1, zone: "hand" }] });
  engine.state.cards[id("opp0")].depleted = true; // the opposing character cannot block
  declareAttack(engine, P1, [id("g")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30 - 2);
});

clause(GUARD, "0:rule", "'your opponent': the opponent's Guard is boosted by MY characters, not by theirs", () => {
  const { engine, id } = guardBoard({ guardOwner: P2 });
  // guard owner is P2 and the single "opp0" character belongs to P1, the Guard's opponent
  assert.equal(engine.getStat(id("g"), "strength"), 2);
  const none = guardBoard({ guardOwner: P2, oppChars: 0 });
  assert.equal(none.engine.getStat(none.id("g"), "strength"), 1);
});

clause(GUARD, "0:rule", "a character the opponent controls but I own counts; one I control but the opponent owns does not", () => {
  const lent = guardBoard({ oppChars: 0, extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }] });
  assert.equal(lent.engine.getStat(lent.id("g"), "strength"), 2, "the opponent CONTROLS it");
  const stolen = guardBoard({ oppChars: 0, extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  assert.equal(stolen.engine.getStat(stolen.id("g"), "strength"), 1, "I control it, so it is not the opponent's");
});

clause(GUARD, "0:rule", "applies to this card only: my other characters get nothing", () => {
  const { engine, id } = guardBoard();
  assert.equal(engine.getStat(id("ally"), "strength"), 1);
  assert.equal(engine.getStat(id("ally"), "life"), 3);
});

clause(GUARD, "0:rule", "is refused one resource short of its cost of 2, and without [R]", () => {
  const short = guardBoard({ inHand: true, rage: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("g")));
  const noThreshold = guardBoard({ inHand: true, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("g")), "no [R]");
  const ok = guardBoard({ inHand: true, rage: 1, greed: 1 });
  play(ok.engine, P1, ok.id("g"));
  assert.equal(zoneOf(ok.engine, ok.id("g")), "play");
  assert.equal(attachedCount(ok.engine, P1), 2);
});

// =============================================================================
// Strength In Numbers
// COST: Play this only when you are attacking. X is the number of members in
// the attacking party. EFFECT: All members of the attacking party gain X
// strength and X life. Tactic, cost 4, threshold [R][R][R].
// (The printed text gives no duration, so the gain does not wear off.)
// =============================================================================

const SIN = "2328f545-4af5-4ff4-b9f8-5878f89de654";

function sinBoard(opts: { attacker?: Player; rage?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  const A: Player = opts.attacker ?? P1;
  const D: Player = A === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: A,
    turn: 2,
    cards: [
      { key: "sin", def: printing(SIN), owner: A, zone: "hand" },
      { key: "atk1", def: character({ name: "Atk1", strength: 1, life: 2, speed: 2 }), owner: A, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 1, life: 2, speed: 2 }), owner: A, zone: "play" },
      { key: "atk3", def: character({ name: "Atk3", strength: 1, life: 2, speed: 2 }), owner: A, zone: "play" },
      { key: "spare", def: character({ name: "Spare", strength: 1, life: 2, speed: 2 }), owner: A, zone: "play" },
      { key: "def1", def: character({ name: "Def1", strength: 2, life: 3, speed: 1 }), owner: D, zone: "play" },
      { key: "def2", def: character({ name: "Def2", strength: 2, life: 3, speed: 1 }), owner: D, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 2, speed: 1 }), owner: D, zone: "play" },
      ...bank("rage", opts.rage ?? 6, A),
      ...bank("greed", opts.greed ?? 0, A),
      ...(opts.extra ?? [])
    ]
  });
}

/** Declares the attack and leaves the attacker's response window open (the card is played in it). */
function sinAttack(board: ReturnType<typeof sinBoard>, attackerKeys: string[], attacker: Player = P1) {
  const defender: Player = attacker === P1 ? P2 : P1;
  board.engine.perform({ type: "declareAttack", playerId: attacker, attackerIds: attackerKeys.map(board.id), target: { type: "faction", playerId: defender } } as never);
}

for (const members of [1, 2, 3]) {
  clause(SIN, "0:ability", `a party of ${members}: X is ${members}, so each member gains ${members} strength and ${members} life, and the cost of 4 is paid`, () => {
    const board = sinBoard();
    const { engine, id } = board;
    const keys = ["atk1", "atk2", "atk3"].slice(0, members);
    sinAttack(board, keys);
    const before = readyCount(engine, P1);
    playRaw(engine, P1, id("sin"));
    resolvePendingResponses(engine);
    for (const key of keys) {
      assert.equal(engine.getStat(id(key), "strength"), 1 + members, `${key} strength`);
      assert.equal(engine.getStat(id(key), "life"), 2 + members, `${key} life`);
      assert.equal(engine.getStat(id(key), "speed"), 2, `${key} speed is unchanged`);
    }
    assert.equal(before - readyCount(engine, P1), 4, "the printed cost of 4 is paid");
    assert.equal(zoneOf(engine, id("sin")), "discard");
  });
}

clause(SIN, "0:ability", "only the members of the attacking party gain it: my other characters and the opponent's characters do not", () => {
  const board = sinBoard();
  const { engine, id } = board;
  sinAttack(board, ["atk1", "atk2"]);
  playRaw(engine, P1, id("sin"));
  resolvePendingResponses(engine);
  for (const key of ["atk3", "spare"]) {
    assert.equal(engine.getStat(id(key), "strength"), 1, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), 2, `${key} life`);
  }
  for (const key of ["def1", "def2", "idle"]) {
    assert.equal(engine.getStat(id(key), "strength"), engine.getDefinition(id(key)).strength, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), engine.getDefinition(id(key)).life, `${key} life`);
  }
});

clause(SIN, "0:ability", "X is the size of the attacking PARTY, not the number of characters I control (2 attack, 4 in play: X=2)", () => {
  const board = sinBoard();
  const { engine, id } = board;
  sinAttack(board, ["atk1", "atk3"]);
  playRaw(engine, P1, id("sin"));
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("atk1"), "strength"), 3);
  assert.equal(engine.getStat(id("atk3"), "life"), 4);
});

clause(SIN, "0:ability", "can be played later in the battle (after blockers are declared): blockers do not gain it", () => {
  const board = sinBoard();
  const { engine, id } = board;
  sinAttack(board, ["atk1", "atk2"]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("def1")] } as never);
  assert.equal(engine.state.battle?.blockingParty.includes(id("def1")), true);
  // the first battle-resolution window: the attacker acts first
  playRaw(engine, P1, id("sin"));
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("atk1"), "strength"), 3);
  assert.equal(engine.getStat(id("atk2"), "life"), 4);
  assert.equal(engine.getStat(id("def1"), "strength"), 2, "the blocker is not a member of the attacking party");
  assert.equal(engine.getStat(id("def1"), "life"), 3);
});

clause(SIN, "0:ability", "the gain is real in battle: two unblocked 1-strength attackers become 3 strength each and hit the faction for 6", () => {
  const board = sinBoard();
  const { engine, id } = board;
  sinAttack(board, ["atk1", "atk2"]);
  playRaw(engine, P1, id("sin"));
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30 - 6);
});

clause(SIN, "0:ability", "the extra life is real in battle: a 2-life attacker blocked by a 2-strength blocker survives with X=1", () => {
  const withSin = sinBoard();
  sinAttack(withSin, ["atk1"]);
  playRaw(withSin.engine, P1, withSin.id("sin"));
  resolvePendingResponses(withSin.engine);
  declareBlockers(withSin.engine, P2, [withSin.id("def1")]);
  autoResolveBattle(withSin.engine);
  assert.equal(zoneOf(withSin.engine, withSin.id("atk1")), "play", "life 3 survives 2 damage");
  const without = sinBoard();
  sinAttack(without, ["atk1"]);
  resolvePendingResponses(without.engine);
  declareBlockers(without.engine, P2, [without.id("def1")]);
  autoResolveBattle(without.engine);
  assert.equal(zoneOf(without.engine, without.id("atk1")), "discard", "control: without the card it dies");
});

clause(SIN, "0:ability", "no duration is printed: the gain is still there on later turns", () => {
  const board = sinBoard();
  const { engine, id } = board;
  sinAttack(board, ["atk1", "atk2"]);
  playRaw(engine, P1, id("sin"));
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.getStat(id("atk1"), "strength"), 3, "still +2 strength on my next turn");
  assert.equal(engine.getStat(id("atk2"), "life"), 4);
});

clause(SIN, "0:ability", "'play this only when you are attacking': refused on my turn when no battle is under way", () => {
  const { engine, id } = sinBoard();
  assert.throws(() => playRaw(engine, P1, id("sin")));
  assert.equal(zoneOf(engine, id("sin")), "hand");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
});

clause(SIN, "0:ability", "refused while I am DEFENDING: the opponent attacks me and I cannot play it in any battle window", () => {
  // P1 owns the card but P2 attacks.
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "sin", def: printing(SIN), owner: P1, zone: "hand" },
      { key: "mine1", def: character({ name: "Mine1", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe1", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...bank("rage", 6, P1)
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe1")], target: { type: "faction", playerId: P1 } } as never);
  engine.perform({ type: "passPriority", playerId: P2 } as never); // the attacker acts first, then the defender
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "it is my turn to respond, yet I may not play it");
  assert.throws(() => playRaw(engine, P1, id("sin")), "defender, after the attack is declared");
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mine1")] } as never);
  engine.perform({ type: "passPriority", playerId: P2 } as never);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "it is my turn to respond, yet I may not play it");
  assert.throws(() => playRaw(engine, P1, id("sin")), "defender, as a blocker");
  assert.equal(zoneOf(engine, id("sin")), "hand");
  assert.equal(engine.getStat(id("foe1"), "strength"), 1);
  assert.equal(attachedCount(engine, P1), 0);
});

clause(SIN, "0:ability", "the OPPONENT can play their own copy when THEY are attacking, boosting their party", () => {
  const board = sinBoard({ attacker: P2 });
  const { engine, id } = board;
  sinAttack(board, ["atk1", "atk2"], P2);
  playRaw(engine, P2, id("sin"));
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("atk1"), "strength"), 3);
  assert.equal(engine.getStat(id("atk2"), "life"), 4);
  assert.equal(engine.getStat(id("def1"), "strength"), 2, "my defenders are unaffected");
});

clause(SIN, "0:ability", "is refused one resource short of its cost of 4, and without [R][R][R]", () => {
  const short = sinBoard({ rage: 3 });
  sinAttack(short, ["atk1"]);
  assert.throws(() => playRaw(short.engine, P1, short.id("sin")));
  assert.equal(zoneOf(short.engine, short.id("sin")), "hand");
  const noThreshold = sinBoard({ rage: 2, greed: 6 });
  sinAttack(noThreshold, ["atk1"]);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sin")), "only two [R]");
  const exact = sinBoard({ rage: 3, greed: 1 });
  sinAttack(exact, ["atk1"]);
  playRaw(exact.engine, P1, exact.id("sin"));
  resolvePendingResponses(exact.engine);
  assert.equal(exact.engine.getStat(exact.id("atk1"), "strength"), 2, "[R][R][R] and four resources in all is enough");
});

// =============================================================================
// Tactician Vacation
// Your opponent cannot respond to this card.
// If you played this card in response to a tactic, that tactic has no effect.
// For the rest of the turn, no tactics can be played.
// Tactic, cost 4, threshold [R].
// =============================================================================

const VACATION = "5ca25182-e910-4f21-97d0-b30298e7d4af";

/** A free tactic that does `amount` damage to a chosen character, costing `cost` (id `hit`, declaration `t`). */
const costlyHit = (amount: number, cost: number, name: string) =>
  tactic({
    name,
    cost,
    behavior: {
      abilities: [
        {
          id: "hit",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A character with the TACTICAL keyword (deployable whenever a tactic could be). */
const TACTICAL_GUY = character({ name: "Tactical Guy", cost: 0, strength: 1, life: 2, speed: 1, behavior: { keywords: ["tactical"] } });

function vacationBoard(opts: { active?: Player; rage?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "vac", def: printing(VACATION), owner: P1, zone: "hand" },
      { key: "noop1", def: NOOP, owner: P1, zone: "hand" },
      { key: "noop1b", def: NOOP, owner: P1, zone: "hand" },
      { key: "p1hit", def: costlyHit(1, 0, "P1 Hit"), owner: P1, zone: "hand" },
      { key: "tg", def: TACTICAL_GUY, owner: P1, zone: "hand" },
      { key: "handguy", def: character({ name: "Hand Guy", cost: 0 }), owner: P1, zone: "hand" },
      { key: "noop2", def: NOOP, owner: P2, zone: "hand" },
      { key: "noop2b", def: NOOP, owner: P2, zone: "hand" },
      { key: "p2hit", def: costlyHit(2, 1, "P2 Hit"), owner: P2, zone: "hand" },
      { key: "tg2", def: TACTICAL_GUY, owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "sniper1", def: printing(SNIPER), owner: P1, zone: "play" },
      { key: "sniper2", def: printing(SNIPER), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("rage", 6, P2),
      ...(opts.extra ?? [])
    ]
  });
}

clause(VACATION, "0:rule", "control: an ordinary tactic leaves a window in which the opponent can respond with a tactic", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("noop1"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 2, "their response happened");
});

clause(VACATION, "0:rule", "the opponent cannot respond to it: no response window opens, it resolves at once", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("vac"));
  assert.equal(engine.state.responseWindow, undefined, "no window for the opponent");
  assert.equal(zoneOf(engine, id("vac")), "discard", "it has already resolved");
});

clause(VACATION, "0:rule", "the opponent cannot respond to it with an ABILITY either (a response is a tactic or an ability)", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("vac"));
  assert.throws(() => activateRaw(engine, P2, id("sniper2"), "hidden-sniper-sharpshoot", { selected: { target: [id("mine")] } }));
  assert.equal(damageOf(engine, id("mine")), 0);
  // control: the same ability IS a legal response to an ordinary tactic
  const control = vacationBoard();
  playRaw(control.engine, P1, control.id("noop1"));
  activateRaw(control.engine, P2, control.id("sniper2"), "hidden-sniper-sharpshoot", { selected: { target: [control.id("mine")] } });
  resolvePendingResponses(control.engine);
  assert.equal(damageOf(control.engine, control.id("mine")), 1);
});

clause(VACATION, "0:rule", "played in RESPONSE to the opponent's action, they still cannot respond to the Vacation", () => {
  const { engine, id } = vacationBoard({ active: P2 });
  playRaw(engine, P2, id("noop2"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("vac"));
  assert.throws(() => activateRaw(engine, P2, id("sniper2"), "hidden-sniper-sharpshoot", { selected: { target: [id("mine")] } }), "the opponent's ability");
  assert.throws(() => playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } }), "the opponent's tactic");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(VACATION, "1:rule", "played in response to a tactic: that tactic has no effect (no damage) and goes to its owner's discard pile, its cost still paid", () => {
  const { engine, id } = vacationBoard({ active: P2 });
  playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } });
  const paidByOpponent = attachedCount(engine, P2);
  assert.equal(paidByOpponent, 1, "their tactic cost 1");
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the tactic had no effect");
  assert.equal(zoneOf(engine, id("p2hit")), "discard", "the terminated tactic goes to its owner's discard pile");
  assert.equal(attachedCount(engine, P2), 1, "its cost stays paid");
  assert.equal(zoneOf(engine, id("vac")), "discard");
});

clause(VACATION, "1:rule", "control: without the Vacation the same tactic does hit", () => {
  const { engine, id } = vacationBoard({ active: P2 });
  playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 2);
});

clause(VACATION, "1:rule", "only THAT tactic is stopped: a tactic played earlier in the chain still resolves afterwards", () => {
  // P2 plays tactic A (2 damage to my Mine); I respond with Vacation, which stops A only.
  // To get a chain: P1 plays p1hit (1 damage to Foe); P2 responds with p2hit (2 damage to Mine); I respond to THAT with Vacation.
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("p1hit"), { selected: { t: [id("foe")] } });
  playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } });
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the tactic Vacation responded to has no effect");
  assert.equal(zoneOf(engine, id("p2hit")), "discard");
  assert.equal(damageOf(engine, id("foe")), 1, "my own earlier tactic, lower in the chain, still resolves");
});

clause(VACATION, "1:rule", "in response to an ABILITY (not a tactic) the ability still resolves", () => {
  const { engine, id } = vacationBoard({ active: P2 });
  activateRaw(engine, P2, id("sniper2"), "hidden-sniper-sharpshoot", { selected: { target: [id("mine")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 1, "the ability was not a tactic, so it was not stopped");
});

clause(VACATION, "1:rule", "in response to a character being deployed it does not stop the character", () => {
  const { engine, id } = vacationBoard({ active: P2, extra: [{ key: "newGuy", def: character({ name: "New Guy", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("newGuy"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("newGuy")), "play");
});

clause(VACATION, "1:rule", "played on my own turn with nothing to respond to, it just closes the tactic window (nothing is terminated)", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("vac"));
  assert.equal(zoneOf(engine, id("vac")), "discard");
  assert.equal(damageOf(engine, id("mine")), 0);
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(VACATION, "2:rule", "for the rest of the turn I cannot play tactics (my own turn)", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("vac"));
  assert.throws(() => playRaw(engine, P1, id("noop1")));
  assert.throws(() => playRaw(engine, P1, id("p1hit"), { selected: { t: [id("foe")] } }));
  assert.equal(zoneOf(engine, id("noop1")), "hand");
  assert.equal(damageOf(engine, id("foe")), 0);
});

clause(VACATION, "2:rule", "...nor can the OPPONENT play tactics for the rest of the turn (in response to my next action)", () => {
  const { engine, id } = vacationBoard({ extra: [{ key: "cheap", def: character({ name: "Cheap", cost: 0 }), owner: P1, zone: "hand" }] });
  playRaw(engine, P1, id("vac"));
  playRaw(engine, P1, id("cheap")); // a non-tactic action the opponent may respond to
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "they may respond");
  assert.throws(() => playRaw(engine, P2, id("noop2")), "a tactic is not allowed");
  assert.throws(() => playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } }));
  assert.equal(zoneOf(engine, id("noop2")), "hand");
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(VACATION, "2:rule", "...also when I played it on the opponent's turn: neither of us can play tactics for the rest of THAT turn", () => {
  const { engine, id } = vacationBoard({ active: P2, extra: [{ key: "p2char", def: character({ name: "P2 Char", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("noop2"));
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.activePlayerId, P2, "still the opponent's turn");
  assert.throws(() => playRaw(engine, P2, id("noop2b")), "the active player's tactic");
  // the opponent takes another action; I (the responding player) cannot answer it with a tactic
  playRaw(engine, P2, id("p2char"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  assert.throws(() => playRaw(engine, P1, id("noop1")), "my tactic");
  assert.throws(() => playRaw(engine, P1, id("p1hit"), { selected: { t: [id("foe")] } }), "my damage tactic");
  assert.equal(zoneOf(engine, id("noop1")), "hand");
});

clause(VACATION, "2:rule", "abilities are not tactics: they can still be used for the rest of the turn", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("vac"));
  activate(engine, P1, id("sniper1"), "hidden-sniper-sharpshoot", { selected: { target: [id("foe")] } });
  assert.equal(damageOf(engine, id("foe")), 1);
});

clause(VACATION, "2:rule", "non-tactic cards can still be deployed on my turn", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("vac"));
  play(engine, P1, id("handguy"));
  assert.equal(zoneOf(engine, id("handguy")), "play");
});

clause(VACATION, "2:rule", "a TACTICAL card can no longer be deployed out of turn (FAQ: its window is closed too)", () => {
  const control = vacationBoard({ active: P2 });
  playRaw(control.engine, P2, control.id("noop2"));
  playRaw(control.engine, P1, control.id("tg"));
  resolvePendingResponses(control.engine);
  assert.equal(zoneOf(control.engine, control.id("tg")), "play", "control: a Tactical character can be deployed in response");

  const { engine, id } = vacationBoard({ active: P2, extra: [{ key: "p2char", def: character({ name: "P2 Char", cost: 0 }), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("noop2"));
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  playRaw(engine, P2, id("p2char"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to their next action...");
  assert.throws(() => playRaw(engine, P1, id("tg")), "...but not with a Tactical card: the tactic window is closed");
  assert.equal(zoneOf(engine, id("tg")), "hand");
});

clause(VACATION, "2:rule", "...but a TACTICAL card can still be played at the times it normally could be (my own turn)", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("vac"));
  play(engine, P1, id("tg"));
  assert.equal(zoneOf(engine, id("tg")), "play");
});

clause(VACATION, "2:rule", "the restriction covers battle windows too: no tactic can be played in the attack's response windows", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("vac"));
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } } as never);
  assert.throws(() => playRaw(engine, P1, id("noop1")), "attacker's window");
  engine.perform({ type: "passPriority", playerId: P1 } as never);
  assert.throws(() => playRaw(engine, P2, id("noop2")), "defender's window");
});

clause(VACATION, "2:rule", "it lasts only for the rest of THIS turn: on the next turns tactics can be played again", () => {
  const { engine, id } = vacationBoard();
  playRaw(engine, P1, id("vac"));
  assert.throws(() => playRaw(engine, P1, id("noop1")));
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  playRaw(engine, P2, id("noop2"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the opponent's turn: tactics work again, and I may respond to theirs");
  playRaw(engine, P1, id("noop1"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("noop1")), "discard");
  assert.equal(zoneOf(engine, id("noop2")), "discard");
});

clause(VACATION, "2:rule", "a second Vacation cannot be played afterwards (it is a tactic)", () => {
  const { engine, id } = vacationBoard({ extra: [{ key: "vac2", def: printing(VACATION), owner: P1, zone: "hand" }] });
  playRaw(engine, P1, id("vac"));
  assert.throws(() => playRaw(engine, P1, id("vac2")));
  assert.equal(zoneOf(engine, id("vac2")), "hand");
});

clause(VACATION, "2:rule", "is refused one resource short of its cost of 4, and without [R]", () => {
  const short = vacationBoard({ rage: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("vac")));
  assert.equal(zoneOf(short.engine, short.id("vac")), "hand");
  const noThreshold = vacationBoard({ rage: 0, greed: 8 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("vac")), "no [R]");
  const exact = vacationBoard({ rage: 1, greed: 3 });
  playRaw(exact.engine, P1, exact.id("vac"));
  assert.equal(zoneOf(exact.engine, exact.id("vac")), "discard");
  assert.equal(attachedCount(exact.engine, P1), 4, "the printed cost of 4 is paid");
});

// =============================================================================
// Target Practice
// COST: Pick a character. EFFECT: Inflict 2 damage to the character.
// Tactic, cost 2, threshold [R][R].
// =============================================================================

const TARGET_PRACTICE = "19131a9f-93bd-4eec-97e5-9307a2c41eca";

function practiceBoard(opts: { rage?: number; greed?: number; active?: Player; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "tp", def: printing(TARGET_PRACTICE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "glass", def: character({ name: "Glass", life: 2 }), owner: P2, zone: "play" },
      { key: "fragile", def: character({ name: "Fragile", life: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "facedown" })),
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(TARGET_PRACTICE, "0:ability", "inflicts exactly 2 damage to the picked character, pays 2, and nothing else is damaged", () => {
  const { engine, id } = practiceBoard();
  const before = readyCount(engine, P1);
  play(engine, P1, id("tp"), { selected: { target: [id("foe")] } });
  assert.equal(damageOf(engine, id("foe")), 2);
  assert.equal(before - readyCount(engine, P1), 2, "the printed cost of 2 is paid");
  for (const key of ["foe2", "mine", "glass", "fragile", "thing", "place"]) assert.equal(damageOf(engine, id(key)), 0, `${key} untouched`);
  assert.equal(zoneOf(engine, id("tp")), "discard", "the tactic ends in its owner's discard pile");
});

clause(TARGET_PRACTICE, "0:ability", "2 damage destroys a character with 2 life (and one with 1 life); 5 life survives", () => {
  const a = practiceBoard();
  play(a.engine, P1, a.id("tp"), { selected: { target: [a.id("glass")] } });
  assert.equal(zoneOf(a.engine, a.id("glass")), "discard");
  const b = practiceBoard();
  play(b.engine, P1, b.id("tp"), { selected: { target: [b.id("fragile")] } });
  assert.equal(zoneOf(b.engine, b.id("fragile")), "discard");
  const c = practiceBoard();
  play(c.engine, P1, c.id("tp"), { selected: { target: [c.id("foe")] } });
  assert.equal(zoneOf(c.engine, c.id("foe")), "play");
});

clause(TARGET_PRACTICE, "0:ability", "can pick one of my own characters", () => {
  const { engine, id } = practiceBoard();
  play(engine, P1, id("tp"), { selected: { target: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2);
  assert.equal(damageOf(engine, id("foe")), 0);
});

clause(TARGET_PRACTICE, "0:ability", "only a character: an item, a location, a faction or a face-down resource is refused", () => {
  const { engine, id } = practiceBoard();
  for (const key of ["thing", "place", "facedown"]) assert.throws(() => playRaw(engine, P1, id("tp"), { selected: { target: [id(key)] } }), key);
  assert.throws(() => playRaw(engine, P1, id("tp"), { selected: { target: [engine.state.players[P2].factionId!] } }), "faction");
  assert.equal(zoneOf(engine, id("tp")), "hand");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
});

clause(TARGET_PRACTICE, "0:ability", "exactly one character is picked: none or two are refused", () => {
  const { engine, id } = practiceBoard();
  assert.throws(() => playRaw(engine, P1, id("tp"), { selected: { target: [] } }));
  assert.throws(() => playRaw(engine, P1, id("tp"), { selected: {} }));
  assert.throws(() => playRaw(engine, P1, id("tp"), { selected: { target: [id("foe"), id("foe2")] } }));
  assert.equal(zoneOf(engine, id("tp")), "hand");
});

clause(TARGET_PRACTICE, "0:ability", "two Target Practices on one character accumulate to 4", () => {
  const { engine, id } = practiceBoard({ rage: 4, extra: [{ key: "tp2", def: printing(TARGET_PRACTICE), owner: P1, zone: "hand" }] });
  play(engine, P1, id("tp"), { selected: { target: [id("foe")] } });
  play(engine, P1, id("tp2"), { selected: { target: [id("foe")] } });
  assert.equal(damageOf(engine, id("foe")), 4);
});

clause(TARGET_PRACTICE, "0:ability", "is a tactic: playable in response on the opponent's turn", () => {
  const { engine, id } = practiceBoard({ active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playNoopOnOwnTurn(engine, id, P2);
  playRaw(engine, P1, id("tp"), { selected: { target: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe")), 2);
});

clause(TARGET_PRACTICE, "0:ability", "but not on the opponent's turn when there is nothing to respond to", () => {
  const { engine, id } = practiceBoard({ active: P2 });
  assert.throws(() => playRaw(engine, P1, id("tp"), { selected: { target: [id("foe")] } }));
  assert.equal(zoneOf(engine, id("tp")), "hand");
});

clause(TARGET_PRACTICE, "0:ability", "is refused one resource short of its cost of 2, and without [R][R]", () => {
  const short = practiceBoard({ rage: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("tp"), { selected: { target: [short.id("foe")] } }));
  assert.equal(zoneOf(short.engine, short.id("tp")), "hand");
  const noThreshold = practiceBoard({ rage: 1, greed: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("tp"), { selected: { target: [noThreshold.id("foe")] } }), "only one [R]");
  const none = practiceBoard({ rage: 0, greed: 5 });
  assert.throws(() => playRaw(none.engine, P1, none.id("tp"), { selected: { target: [none.id("foe")] } }), "no [R]");
  const exact = practiceBoard({ rage: 2 });
  play(exact.engine, P1, exact.id("tp"), { selected: { target: [exact.id("foe")] } });
  assert.equal(damageOf(exact.engine, exact.id("foe")), 2);
  assert.equal(readyCount(exact.engine, P1), 0);
});

// =============================================================================
// Vanilla characters: Oversoon Lightfoot, Plodding Brute, Scout, Stalwart
// Soldier, Warrior Prodigy. No rules text: they deploy for exactly their
// printed cost and threshold, and have their printed stats.
// =============================================================================

interface VanillaSpec {
  id: string;
  cost: number;
  /** Number of [R] in the printed threshold. */
  rr: number;
  strength: number;
  speed: number;
  life: number;
  subtype: string;
}

const OVERSOON = "8291e81e-f33c-4e7b-82b2-46df44112428";
const PLODDING = "4915d5ec-b028-4753-96ae-f42c84b5d8b3";
const SCOUT = "de3dc0cc-486f-400a-86c2-07086615b78f";
const STALWART = "69ea68d5-af05-4f2e-919c-e5603738afac";
const PRODIGY = "dd59c66f-204d-4361-aab8-bc9eb9e13e9b";

const OVERSOON_SPEC: VanillaSpec = { id: OVERSOON, cost: 1, rr: 2, strength: 2, speed: 3, life: 1, subtype: "soldier" };
const PLODDING_SPEC: VanillaSpec = { id: PLODDING, cost: 4, rr: 1, strength: 5, speed: 2, life: 3, subtype: "soldier" };
const SCOUT_SPEC: VanillaSpec = { id: SCOUT, cost: 4, rr: 2, strength: 3, speed: 4, life: 3, subtype: "soldier" };
const STALWART_SPEC: VanillaSpec = { id: STALWART, cost: 3, rr: 3, strength: 3, speed: 3, life: 3, subtype: "soldier" };
const PRODIGY_SPEC: VanillaSpec = { id: PRODIGY, cost: 2, rr: 2, strength: 2, speed: 3, life: 2, subtype: "soldier" };

function vanillaBoard(spec: VanillaSpec, opts: { rage?: number; greed?: number; active?: Player; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: opts.active ?? P1,
    turn: 2,
    cards: [
      { key: "c", def: printing(spec.id), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 99, speed: 1 }), owner: P2, zone: "play" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "e1", def: character({ name: "E1" }), owner: P2, zone: "deck" },
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

function vanillaDeploysForCostAndThreshold(spec: VanillaSpec) {
  const rage = Math.max(spec.cost, spec.rr);
  const { engine, id } = vanillaBoard(spec, { rage });
  const before = readyCount(engine, P1);
  play(engine, P1, id("c"));
  assert.equal(zoneOf(engine, id("c")), "play");
  assert.equal(attachedCount(engine, P1), spec.cost, `the printed cost of ${spec.cost} is paid`);
  assert.equal(before - readyCount(engine, P1), spec.cost);
  assert.equal(engine.state.cards[id("c")].controllerId, P1);
  assert.equal(pending(engine), undefined);
}

function vanillaRefusedShortOfCost(spec: VanillaSpec) {
  // one resource fewer than the cost, all of the right icon (and so enough icons if the cost allows it)
  const rage = spec.cost - 1;
  const short = vanillaBoard(spec, { rage, greed: 0 });
  assert.throws(() => playRaw(short.engine, P1, short.id("c")), `${rage} resources for cost ${spec.cost}`);
  assert.equal(zoneOf(short.engine, short.id("c")), "hand");
  assert.equal(attachedCount(short.engine, P1), 0, "nothing was paid");
  // plenty of resources but no card to deploy with exactly cost-1 spare: cost-1 rage plus an unrelated spent resource
  const spent = vanillaBoard(spec, { rage: spec.cost, extra: bank("rage", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  // spec.cost ready resources, 1 spent: still enough
  play(spent.engine, P1, spent.id("c"));
  assert.equal(zoneOf(spent.engine, spent.id("c")), "play", "resources already spent do not matter when the ready ones suffice");
  const tight = vanillaBoard(spec, { rage: spec.cost - 1, extra: bank("rage", 3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.throws(() => playRaw(tight.engine, P1, tight.id("c")), "spent (attached) resources cannot pay");
}

function vanillaRefusedShortOfThreshold(spec: VanillaSpec) {
  const short = vanillaBoard(spec, { rage: spec.rr - 1, greed: spec.cost + spec.rr });
  assert.throws(() => playRaw(short.engine, P1, short.id("c")), `${spec.rr - 1} [R] is not enough`);
  assert.equal(zoneOf(short.engine, short.id("c")), "hand");
  const none = vanillaBoard(spec, { rage: 0, greed: spec.cost + spec.rr + 3 });
  assert.throws(() => playRaw(none.engine, P1, none.id("c")), "no [R] at all");
  // [R] x threshold with the cost covered by other icons is enough
  const ok = vanillaBoard(spec, { rage: spec.rr, greed: spec.cost });
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play", "the threshold is a gate, the cost is paid with any resources");
  assert.equal(attachedCount(ok.engine, P1), spec.cost);
}

function vanillaPrintedStats(spec: VanillaSpec) {
  const { engine, id } = vanillaBoard(spec, { rage: Math.max(spec.cost, spec.rr) });
  play(engine, P1, id("c"));
  assert.equal(engine.getStat(id("c"), "strength"), spec.strength, "strength");
  assert.equal(engine.getStat(id("c"), "speed"), spec.speed, "speed");
  assert.equal(engine.getStat(id("c"), "life"), spec.life, "life");
  assert.ok(engine.getSubtypes(id("c")).includes(spec.subtype), `subtype ${spec.subtype}`);
  assert.deepEqual(engine.getKeywords(id("c")), [], "no keywords");
  assert.deepEqual(engine.getRestrictions(id("c")), [], "no restrictions");
  const def = printing(spec.id);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "warlord");
  assert.deepEqual(def.behavior?.abilities ?? [], [], "no abilities (no rules text is printed)");
  assert.deepEqual(def.behavior?.keywords ?? [], [], "no keywords in the data either");
}

function vanillaNotOnOpponentsTurn(spec: VanillaSpec) {
  const rage = Math.max(spec.cost, spec.rr);
  const idle = vanillaBoard(spec, { rage, active: P2 });
  assert.throws(() => playRaw(idle.engine, P1, idle.id("c")), "not my turn, nothing to respond to");
  const respond = vanillaBoard(spec, { rage, active: P2, extra: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }] });
  playNoopOnOwnTurn(respond.engine, respond.id, P2);
  assert.throws(() => playRaw(respond.engine, P1, respond.id("c")), "a character is not a tactic: it cannot be played in response");
  assert.equal(zoneOf(respond.engine, respond.id("c")), "hand");
}

function vanillaAttacksNextTurn(spec: VanillaSpec) {
  const { engine, id } = vanillaBoard(spec, { rage: Math.max(spec.cost, spec.rr) });
  play(engine, P1, id("c"));
  assert.throws(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("c")], target: { type: "faction", playerId: P2 } } as never), "it did not start this turn in play");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  declareAttack(engine, P1, [id("c")]);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), 30 - spec.strength, "it hits the faction for its printed strength");
}

clause(OVERSOON, "vanilla", "deploys for its printed cost of 1 with [R][R] and is a plain character in play", () => vanillaDeploysForCostAndThreshold(OVERSOON_SPEC));
clause(OVERSOON, "vanilla", "is refused with no resource at all (cost 1)", () => vanillaRefusedShortOfCost(OVERSOON_SPEC));
clause(OVERSOON, "vanilla", "is refused with only one [R] (threshold [R][R]) or none, however many other resources there are", () => vanillaRefusedShortOfThreshold(OVERSOON_SPEC));
clause(OVERSOON, "vanilla", "has its printed stats (2 strength / 3 speed / 1 life), the soldier subtype, and nothing else", () => vanillaPrintedStats(OVERSOON_SPEC));
clause(OVERSOON, "vanilla", "can be deployed only on its controller's own turn", () => vanillaNotOnOpponentsTurn(OVERSOON_SPEC));
clause(OVERSOON, "vanilla", "cannot attack the turn it enters play, and attacks for its printed strength the next turn", () => vanillaAttacksNextTurn(OVERSOON_SPEC));

clause(PLODDING, "vanilla", "deploys for its printed cost of 4 with [R] and is a plain character in play", () => vanillaDeploysForCostAndThreshold(PLODDING_SPEC));
clause(PLODDING, "vanilla", "is refused one resource short of its cost of 4", () => vanillaRefusedShortOfCost(PLODDING_SPEC));
clause(PLODDING, "vanilla", "is refused without [R], however many other resources there are", () => vanillaRefusedShortOfThreshold(PLODDING_SPEC));
clause(PLODDING, "vanilla", "has its printed stats (5 strength / 2 speed / 3 life), the soldier subtype, and nothing else", () => vanillaPrintedStats(PLODDING_SPEC));
clause(PLODDING, "vanilla", "can be deployed only on its controller's own turn", () => vanillaNotOnOpponentsTurn(PLODDING_SPEC));
clause(PLODDING, "vanilla", "cannot attack the turn it enters play, and attacks for its printed strength the next turn", () => vanillaAttacksNextTurn(PLODDING_SPEC));

clause(SCOUT, "vanilla", "deploys for its printed cost of 4 with [R][R] and is a plain character in play", () => vanillaDeploysForCostAndThreshold(SCOUT_SPEC));
clause(SCOUT, "vanilla", "is refused one resource short of its cost of 4", () => vanillaRefusedShortOfCost(SCOUT_SPEC));
clause(SCOUT, "vanilla", "is refused with only one [R] (threshold [R][R]) or none, however many other resources there are", () => vanillaRefusedShortOfThreshold(SCOUT_SPEC));
clause(SCOUT, "vanilla", "has its printed stats (3 strength / 4 speed / 3 life), the soldier subtype, and nothing else", () => vanillaPrintedStats(SCOUT_SPEC));
clause(SCOUT, "vanilla", "can be deployed only on its controller's own turn", () => vanillaNotOnOpponentsTurn(SCOUT_SPEC));
clause(SCOUT, "vanilla", "cannot attack the turn it enters play, and attacks for its printed strength the next turn", () => vanillaAttacksNextTurn(SCOUT_SPEC));

clause(STALWART, "vanilla", "deploys for its printed cost of 3 with [R][R][R] and is a plain character in play", () => vanillaDeploysForCostAndThreshold(STALWART_SPEC));
clause(STALWART, "vanilla", "is refused one resource short of its cost of 3", () => vanillaRefusedShortOfCost(STALWART_SPEC));
clause(STALWART, "vanilla", "is refused with fewer than three [R] (threshold [R][R][R]), however many other resources there are", () => vanillaRefusedShortOfThreshold(STALWART_SPEC));
clause(STALWART, "vanilla", "has its printed stats (3 strength / 3 speed / 3 life), the soldier subtype, and nothing else", () => vanillaPrintedStats(STALWART_SPEC));
clause(STALWART, "vanilla", "can be deployed only on its controller's own turn", () => vanillaNotOnOpponentsTurn(STALWART_SPEC));
clause(STALWART, "vanilla", "cannot attack the turn it enters play, and attacks for its printed strength the next turn", () => vanillaAttacksNextTurn(STALWART_SPEC));

clause(PRODIGY, "vanilla", "deploys for its printed cost of 2 with [R][R] and is a plain character in play", () => vanillaDeploysForCostAndThreshold(PRODIGY_SPEC));
clause(PRODIGY, "vanilla", "is refused one resource short of its cost of 2", () => vanillaRefusedShortOfCost(PRODIGY_SPEC));
clause(PRODIGY, "vanilla", "is refused with only one [R] (threshold [R][R]) or none, however many other resources there are", () => vanillaRefusedShortOfThreshold(PRODIGY_SPEC));
clause(PRODIGY, "vanilla", "has its printed stats (2 strength / 3 speed / 2 life), the soldier subtype, and nothing else", () => vanillaPrintedStats(PRODIGY_SPEC));
clause(PRODIGY, "vanilla", "can be deployed only on its controller's own turn", () => vanillaNotOnOpponentsTurn(PRODIGY_SPEC));
clause(PRODIGY, "vanilla", "cannot attack the turn it enters play, and attacks for its printed strength the next turn", () => vanillaAttacksNextTurn(PRODIGY_SPEC));

// =============================================================================
// Vanilla resources: Obsession, Greed, Elitism, Deception, Rage. A resource
// provides its icon. (Resources are played by the Develop Rule, never deployed.)
// =============================================================================

type StapleIconName = "obsession" | "greed" | "elitism" | "deception" | "rage";
const OTHER_ICONS: StapleIconName[] = ["obsession", "greed", "elitism", "deception", "rage"];
const ICON_LETTER: Record<StapleIconName, string> = { obsession: "o", greed: "g", elitism: "e", deception: "d", rage: "r" };

const OBSESSION = "dab6e897-b5be-4760-95c0-20c2795a9ae3";
const GREED = "1b675619-bee8-41ed-8562-d4d9c763ad05";
const ELITISM = "5a5250c1-a651-43e4-ac75-f2403860446d";
const DECEPTION = "e93094ca-311a-4302-bdc5-798905a0f809";
const RAGE = "fe913bf8-b4eb-411a-a8b8-dcaf0095c90e";

function resourceBoard(resourceId: string, opts: { inPlay?: boolean; faceDown?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "res", def: printing(resourceId), owner: P1, zone: opts.inPlay ? "play" : "hand", faceDown: opts.faceDown },
      { key: "other", def: character({ name: "Other Hand Card", cost: 0 }), owner: P1, zone: "hand" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      ...(opts.extra ?? [])
    ]
  });
}

const icons = (engine: SpoilsEngine) => engine.getThresholds(P1) as Record<string, number | undefined>;

function resourceFaceUp(resourceId: string, icon: StapleIconName) {
  const { engine, id } = resourceBoard(resourceId);
  assert.equal(icons(engine)[icon] ?? 0, 0, "no icon before it is played");
  developResource(engine, P1, id("res"), false);
  assert.equal(zoneOf(engine, id("res")), "play");
  assert.equal(engine.state.cards[id("res")].faceDown, false);
  assert.equal(icons(engine)[icon], 1, `provides exactly one ${icon}`);
  for (const other of OTHER_ICONS.filter((name) => name !== icon)) assert.equal(icons(engine)[other] ?? 0, 0, `and no ${other}`);
  assert.equal(icons(engine).volition ?? 0, 0, "and no Volition");
  assert.equal(readyCount(engine, P1), 1, "it is a ready resource I can pay with");
  assert.equal(engine.isResource(id("res")), true);
}

function resourceFaceDown(resourceId: string, icon: StapleIconName) {
  const { engine, id } = resourceBoard(resourceId);
  developResource(engine, P1, id("res"), true);
  assert.equal(zoneOf(engine, id("res")), "play");
  assert.equal(engine.state.cards[id("res")].faceDown, true);
  assert.equal(icons(engine).volition, 1, "face-down it provides Volition");
  assert.equal(icons(engine)[icon] ?? 0, 0, `and not its ${icon}`);
}

function resourceNotDeployable(resourceId: string) {
  const { engine, id } = resourceBoard(resourceId);
  assert.throws(() => playRaw(engine, P1, id("res")), "a resource is played only by an effect (CR 203.1)");
  assert.equal(zoneOf(engine, id("res")), "hand");
}

function resourcePays(resourceId: string, icon: StapleIconName) {
  const COST1 = tactic({ name: "Cost One", cost: 1, behavior: { abilities: [{ id: "c1", type: "activated", effects: [] }] } });
  const { engine, id } = resourceBoard(resourceId, { inPlay: true, extra: [{ key: "t", def: COST1, owner: P1, zone: "hand" }] });
  assert.equal(readyCount(engine, P1), 1);
  play(engine, P1, id("t"));
  assert.equal(engine.state.cards[id("res")].attachedTo, factionOf(engine, P1), "paying attaches the resource to my faction");
  assert.equal(engine.state.cards[id("res")].depleted, false, "resources never deplete");
  assert.equal(readyCount(engine, P1), 0);
  assert.equal(icons(engine)[icon], 1, "an attached resource still provides its icon (a threshold is a gate, not a cost)");
}

function resourceMeetsThreshold(resourceId: string, icon: StapleIconName) {
  const letter = ICON_LETTER[icon];
  const NEEDS_ONE = character({ name: "Needs One", cost: 0, threshold: letter as never });
  const NEEDS_TWO = character({ name: "Needs Two", cost: 0, threshold: (letter + letter) as never });
  const otherIcon = OTHER_ICONS.find((name) => name !== icon)!;
  const NEEDS_OTHER = character({ name: "Needs Other", cost: 0, threshold: ICON_LETTER[otherIcon] as never });
  const { engine, id } = resourceBoard(resourceId, {
    inPlay: true,
    extra: [
      { key: "one", def: NEEDS_ONE, owner: P1, zone: "hand" },
      { key: "two", def: NEEDS_TWO, owner: P1, zone: "hand" },
      { key: "other2", def: NEEDS_OTHER, owner: P1, zone: "hand" }
    ]
  });
  assert.throws(() => playRaw(engine, P1, id("two")), "one icon does not meet a two-icon threshold");
  assert.throws(() => playRaw(engine, P1, id("other2")), `it does not provide ${otherIcon}`);
  play(engine, P1, id("one"));
  assert.equal(zoneOf(engine, id("one")), "play", `one ${icon} meets a one-${icon} threshold`);
}

function resourceIdentity(resourceId: string, trade: string) {
  const def = printing(resourceId);
  assert.equal(def.type, "resource");
  assert.equal(def.trade, trade);
  assert.equal(def.cost ?? 0, 0);
  assert.deepEqual(def.behavior?.abilities ?? [], [], "no abilities (no rules text)");
}

clause(OBSESSION, "vanilla", "played face-up it provides exactly one Obsession (and nothing else), as a ready resource", () => resourceFaceUp(OBSESSION, "obsession"));
clause(OBSESSION, "vanilla", "played face-down it provides Volition, not Obsession", () => resourceFaceDown(OBSESSION, "obsession"));
clause(OBSESSION, "vanilla", "cannot be deployed like a card: resources are played only by an effect", () => resourceNotDeployable(OBSESSION));
clause(OBSESSION, "vanilla", "pays for costs by attaching to my faction, and keeps providing its icon", () => resourcePays(OBSESSION, "obsession"));
clause(OBSESSION, "vanilla", "meets a one-Obsession threshold, not a two-Obsession one nor another icon's", () => resourceMeetsThreshold(OBSESSION, "obsession"));
clause(OBSESSION, "vanilla", "is a cost-0 Arcanist resource card with no rules text", () => resourceIdentity(OBSESSION, "arcanist"));

clause(GREED, "vanilla", "played face-up it provides exactly one Greed (and nothing else), as a ready resource", () => resourceFaceUp(GREED, "greed"));
clause(GREED, "vanilla", "played face-down it provides Volition, not Greed", () => resourceFaceDown(GREED, "greed"));
clause(GREED, "vanilla", "cannot be deployed like a card: resources are played only by an effect", () => resourceNotDeployable(GREED));
clause(GREED, "vanilla", "pays for costs by attaching to my faction, and keeps providing its icon", () => resourcePays(GREED, "greed"));
clause(GREED, "vanilla", "meets a one-Greed threshold, not a two-Greed one nor another icon's", () => resourceMeetsThreshold(GREED, "greed"));
clause(GREED, "vanilla", "is a cost-0 Banker resource card with no rules text", () => resourceIdentity(GREED, "banker"));

clause(ELITISM, "vanilla", "played face-up it provides exactly one Elitism (and nothing else), as a ready resource", () => resourceFaceUp(ELITISM, "elitism"));
clause(ELITISM, "vanilla", "played face-down it provides Volition, not Elitism", () => resourceFaceDown(ELITISM, "elitism"));
clause(ELITISM, "vanilla", "cannot be deployed like a card: resources are played only by an effect", () => resourceNotDeployable(ELITISM));
clause(ELITISM, "vanilla", "pays for costs by attaching to my faction, and keeps providing its icon", () => resourcePays(ELITISM, "elitism"));
clause(ELITISM, "vanilla", "meets a one-Elitism threshold, not a two-Elitism one nor another icon's", () => resourceMeetsThreshold(ELITISM, "elitism"));
clause(ELITISM, "vanilla", "is a cost-0 Gearsmith resource card with no rules text", () => resourceIdentity(ELITISM, "gearsmith"));

clause(DECEPTION, "vanilla", "played face-up it provides exactly one Deception (and nothing else), as a ready resource", () => resourceFaceUp(DECEPTION, "deception"));
clause(DECEPTION, "vanilla", "played face-down it provides Volition, not Deception", () => resourceFaceDown(DECEPTION, "deception"));
clause(DECEPTION, "vanilla", "cannot be deployed like a card: resources are played only by an effect", () => resourceNotDeployable(DECEPTION));
clause(DECEPTION, "vanilla", "pays for costs by attaching to my faction, and keeps providing its icon", () => resourcePays(DECEPTION, "deception"));
clause(DECEPTION, "vanilla", "meets a one-Deception threshold, not a two-Deception one nor another icon's", () => resourceMeetsThreshold(DECEPTION, "deception"));
clause(DECEPTION, "vanilla", "is a cost-0 Rogue resource card with no rules text", () => resourceIdentity(DECEPTION, "rogue"));

clause(RAGE, "vanilla", "played face-up it provides exactly one Rage (and nothing else), as a ready resource", () => resourceFaceUp(RAGE, "rage"));
clause(RAGE, "vanilla", "played face-down it provides Volition, not Rage", () => resourceFaceDown(RAGE, "rage"));
clause(RAGE, "vanilla", "cannot be deployed like a card: resources are played only by an effect", () => resourceNotDeployable(RAGE));
clause(RAGE, "vanilla", "pays for costs by attaching to my faction, and keeps providing its icon", () => resourcePays(RAGE, "rage"));
clause(RAGE, "vanilla", "meets a one-Rage threshold, not a two-Rage one nor another icon's", () => resourceMeetsThreshold(RAGE, "rage"));
clause(RAGE, "vanilla", "is a cost-0 Warlord resource card with no rules text", () => resourceIdentity(RAGE, "warlord"));

// =============================================================================
// The Tournament Faction
// STARTING RESOURCES: Any 2 staple resources.
// STARTING DRAW: 8 going first, 9 going second.
// RESTORE ABILITY: At the start of your turn, restore all your depleted cards
// and detach all resources from your faction.
// DEVELOP ABILITY: At the start of your turn, pick one of the following: draw a
// card or play a resource.
// DRAW -- COST: Pay 3. EFFECT: Draw a card.
// RESOURCE -- COST: Pay 4. EFFECT: Play a resource.
// =============================================================================

const TOURNAMENT = "8ef4a0a5-2d1d-4608-880a-f519921470df";

// The real staple resources, a resource that is NOT a staple, and plain filler.
const STAPLE_RAGE = printing(RAGE);
const STAPLE_GREED = printing(GREED);
const STAPLE_DECEPTION = printing(DECEPTION);
const STAPLE_ELITISM = printing(ELITISM);
const STAPLE_OBSESSION = printing(OBSESSION);
const ODD_RESOURCE = resourceCard({ id: "ob08-odd-resource", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER = character({ id: "ob08-filler", name: "Filler" });

const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

// A plain opponent: 2 staples, 7 going first / 8 going second, a normal Develop Rule.
const PLAIN_OPP = factionCard({
  id: "ob08-plain-opp",
  name: "Plain Opponent",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: {
      startingResources: { count: 2, stapleOnly: true },
      openingHand: { goingFirst: 7, goingSecond: 8 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
    }
  })
});
const plainOppDeck = (): CardDefinition[] => [STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)];
const tournamentSeat = (deck?: CardDefinition[]) => ({ faction: printing(TOURNAMENT), deck: deck ?? [STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)] });

const handSize = (engine: SpoilsEngine, player: Player): number => engine.state.players[player].hand.length;
const playCards = (engine: SpoilsEngine, player: Player): string[] => engine.state.players[player].play.filter((cardId) => engine.getDefinition(cardId).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: string[]): string[] => ids.map((cardId) => engine.getDefinition(cardId).name).sort();

// --- STARTING RESOURCES: "Any 2 staple resources."

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "starts with exactly 2 staple resources in play, face-up, and no other starting cards", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, FILLER, STAPLE_GREED, STAPLE_RAGE, STAPLE_DECEPTION, STAPLE_ELITISM, STAPLE_OBSESSION, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting resources");
  for (const cardId of mine) {
    assert.ok(["Rage", "Greed", "Deception", "Elitism", "Obsession"].includes(engine.getDefinition(cardId).name), `${engine.getDefinition(cardId).name} is a staple`);
    assert.equal(engine.state.cards[cardId].faceDown, false, "flipped face-up after setup");
  }
  const total = Object.values(engine.getThresholds(P1)).reduce((sum: number, n) => sum + (n ?? 0), 0);
  assert.equal(total, 2, "two icons");
  assert.equal(readyCount(engine, P1), 2, "both are resources I can pay with");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "a resource that is not a staple is never taken as a starting resource, even when it is the first resource in the deck", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, ODD_RESOURCE, STAPLE_RAGE, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Rage"]);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the two staples may be of the same kind ('any 2', not 'different')", () => {
  const engine = setupGame(tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"]);
  assert.equal(engine.getThresholds(P1).rage, 2);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the starting resources come out of my deck (they are not extra cards)", () => {
  const engine = setupGame(tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  // 42 deck cards - 2 starting resources - 8 opening hand
  assert.equal(engine.state.players[P1].deck.length, 42 - 2 - 8);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the opponent starts with their own resources, not mine", () => {
  const engine = setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: [STAPLE_ELITISM, STAPLE_DECEPTION, ...repeat(FILLER, 40)] });
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"]);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "'Any': with the choose-starting-resources step on, I pick which 2 staples — from the staples in MY deck only", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, STAPLE_DECEPTION, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources");
  const choice = engine.getStartingResourceChoice(P1);
  assert.ok(choice, "I am offered the choice");
  assert.equal(choice.count, 2);
  const deckStaples = engine.state.players[P1].deck.filter((cardId) => ["Rage", "Greed", "Deception"].includes(engine.getDefinition(cardId).name));
  assert.deepEqual([...choice.candidateCardIds].sort(), [...deckStaples].sort(), "exactly the 7 staples in my deck: not the non-staple resource, not the characters");
  const picked = [choice.candidateCardIds.find((c) => engine.getDefinition(c).name === "Deception")!, choice.candidateCardIds.find((c) => engine.getDefinition(c).name === "Greed")!];
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: picked });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Deception", "Greed"], "exactly the staples I picked are in play");
  for (const cardId of picked) assert.equal(engine.state.cards[cardId].faceDown, false);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "I may pick two of the same kind", () => {
  const engine = setupGame(
    tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  const greeds = engine.getStartingResourceChoice(P1)!.candidateCardIds.filter((c) => engine.getDefinition(c).name === "Greed");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: greeds });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Greed"]);
  assert.equal(engine.getThresholds(P1).greed, 2);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the choice must be exactly 2 staple resources from my deck: not 1, not 3, not a non-staple, not a character, not the same card twice", () => {
  const engine = setupGame(
    tournamentSeat([ODD_RESOURCE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  const [s1, s2, s3] = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const odd = engine.state.players[P1].deck.find((c) => engine.getDefinition(c).name === "Odd Resource")!;
  const filler = engine.state.players[P1].deck.find((c) => engine.getDefinition(c).name === "Filler")!;
  const choose = (cardIds: string[]) => () => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds });
  assert.throws(choose([s1]), "one is too few");
  assert.throws(choose([s1, s2, s3]), "three is too many");
  assert.throws(choose([s1, odd]), "a non-staple resource");
  assert.throws(choose([s1, filler]), "a character");
  assert.throws(choose([s1, s1]), "the same card twice");
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "still waiting for a legal choice");
  assert.equal(playCards(engine, P1).length, 0, "nothing was put into play");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "I cannot choose the opponent's cards, or a card from my own hand", () => {
  const engine = setupGame(
    tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: [STAPLE_ELITISM, STAPLE_DECEPTION, ...repeat(FILLER, 40)] },
    { choose: true }
  );
  const [s1] = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const theirs = engine.state.players[P2].deck.find((c) => engine.getDefinition(c).name === "Elitism")!;
  assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [s1, theirs] }), "the opponent's staple");
  assert.equal(engine.state.setup.phase, "chooseStartingResources");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the opening hand is drawn after the starting resources are chosen (8 going first), so every staple in my deck can be chosen", () => {
  const engine = setupGame(
    tournamentSeat([STAPLE_RAGE, STAPLE_RAGE, STAPLE_RAGE, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, STAPLE_GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(handSize(engine, P1), 0, "nothing is drawn while the choice is pending");
  const candidates = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  assert.equal(candidates.length, 7, "all seven staples I own are still in the deck to choose from");
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: candidates.slice(0, 2) });
  // answer the opponent's choice too, if it is asked for
  while (engine.state.setup.phase === "chooseStartingResources") {
    const seat = (engine.state.setup as unknown as { order: Player[]; currentIndex: number }).order[(engine.state.setup as unknown as { currentIndex: number }).currentIndex];
    engine.perform({ type: "chooseStartingResources", playerId: seat, cardIds: engine.getStartingResourceChoice(seat)!.candidateCardIds.slice(0, 2) });
  }
  assert.equal(handSize(engine, P1), 8);
});

// --- STARTING DRAW: "8 going first, 9 going second."

clause(TOURNAMENT, "1:rule:STARTING DRAW", "draws 8 cards going first", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P1), 8);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "draws 9 cards going second", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P1), 9);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "also applies when the Tournament Faction is the second seat (P2): 8 first, 9 second", () => {
  const goingFirst = setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, tournamentSeat(), { first: P2 });
  assert.equal(handSize(goingFirst, P2), 8);
  const goingSecond = setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, tournamentSeat(), { first: P1 });
  assert.equal(handSize(goingSecond, P2), 9);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 first / 8 second)", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P2), 8, "opponent going second");
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P2), 7, "opponent going first");
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "the cards are drawn from my deck and the starting resources are not part of the hand", () => {
  const engine = setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  for (const cardId of engine.state.players[P1].hand) assert.notEqual(engine.state.cards[cardId].zone, "play");
  assert.equal(engine.state.players[P1].hand.length + engine.state.players[P1].deck.length + playCards(engine, P1).length, 42, "no card appeared or vanished");
});

// --- RESTORE ABILITY: "At the start of your turn, restore all your depleted cards and detach all resources from your faction."

const topOfDeck = (label: string, owner: Player): CardPlacement[] =>
  Array.from({ length: 4 }, (_, i) => ({ key: `${label}${i}`, def: character({ name: `${label} ${i}` }), owner, zone: "deck" as const }));

/** `n` rage resources for `owner`, already attached to (spent on) `owner`'s faction. */
const spentRage = (owner: Player, n: number): CardPlacement[] => bank("rage", n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

function restoreBoard(active: Player) {
  return buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spentRage(P1, 3),
      ...volition(1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1), // not attached: stays that way
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: P2, depleted: true },
      // control differs from ownership: "your depleted cards" are the ones YOU control
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spentRage(P2, 2),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2)
    ]
  });
}

clause(TOURNAMENT, "2:rule:RESTORE ABILITY", "at the start of my turn my depleted characters and items are restored", () => {
  const { engine, id } = restoreBoard(P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "my depleted character is restored");
  assert.equal(engine.state.cards[id("mineItem")].depleted, false, "my depleted item is restored");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control (the opponent owns it) is mine to restore");
});

clause(TOURNAMENT, "2:rule:RESTORE ABILITY", "at the start of my turn every resource is detached from my faction (face-up and face-down), and all my resources are ready", () => {
  const { engine } = restoreBoard(P2);
  assert.equal(attachedCount(engine, P1), 4, "3 rage + 1 face-down resource are attached before my turn");
  endTurn(engine, P2);
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(readyCount(engine, P1), 6, "all six of my resources are ready again");
});

clause(TOURNAMENT, "2:rule:RESTORE ABILITY", "does not restore the opponent's cards or detach the opponent's resources", () => {
  const { engine, id } = restoreBoard(P2);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("theirChar")].depleted, true, "'your depleted cards': the opponent's character stays depleted");
  assert.equal(engine.state.cards[id("theirItem")].depleted, true);
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true, "a card I own but the opponent controls is not 'my' card to restore");
  assert.equal(attachedCount(engine, P2), 2, "'your faction': the opponent's resources stay attached");
});

clause(TOURNAMENT, "2:rule:RESTORE ABILITY", "does nothing at the start of the opponent's turn", () => {
  const { engine, id } = restoreBoard(P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "my depleted character does not restore at the opponent's turn start");
  assert.equal(engine.state.cards[id("mineItem")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "my resources stay attached");
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true);
});

// --- DEVELOP ABILITY: "At the start of your turn, pick one of the following: draw a card or play a resource."

function developBoard(active: Player = P1) {
  return buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }
    ]
  });
}

clause(TOURNAMENT, "3:rule:DEVELOP ABILITY", "I may draw a card (the top of my deck)", () => {
  const { engine, id } = developBoard();
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  const theirHand = handSize(engine, P2);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1));
  assert.equal(handSize(engine, P2), theirHand, "the opponent draws nothing");
  assert.equal(playCards(engine, P1).length, 0, "no resource was played");
});

clause(TOURNAMENT, "3:rule:DEVELOP ABILITY", "I may play a resource card face-up from my hand", () => {
  const { engine, id } = developBoard();
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  developResource(engine, P1, id("handRes"), false);
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false);
  assert.equal(engine.getThresholds(P1).greed, 1, "it provides its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "no card was drawn");
  assert.equal(zoneOf(engine, id("handRes2")), "hand", "only one resource is played");
});

clause(TOURNAMENT, "3:rule:DEVELOP ABILITY", "I may play any card face-down as a resource (Volition), including an actual resource card", () => {
  const { engine, id } = developBoard();
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1);
  const real = developBoard();
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(real.engine.state.cards[real.id("handRes")].faceDown, true);
  assert.equal(real.engine.getThresholds(P1).volition, 1);
  assert.equal(real.engine.getThresholds(P1).greed ?? 0, 0, "face-down it no longer provides its Greed");
});

clause(TOURNAMENT, "3:rule:DEVELOP ABILITY", "a non-resource card cannot be played face-up as a resource", () => {
  const { engine, id } = developBoard();
  developResource(engine, P1, id("handChar"), false); // asked to play it face-up
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "only an actual resource card may be played face-up: a non-resource card enters face-down");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
});

clause(TOURNAMENT, "3:rule:DEVELOP ABILITY", "'pick one': draw OR play a resource, not both", () => {
  const a = developBoard();
  developDraw(a.engine, P1);
  assert.equal(a.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.equal(zoneOf(a.engine, a.id("handRes")), "hand");
  const b = developBoard();
  const deckBefore = [...b.engine.state.players[P1].deck];
  developResource(b.engine, P1, b.id("handRes"), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.deepEqual(b.engine.state.players[P1].deck, deckBefore);
});

clause(TOURNAMENT, "3:rule:DEVELOP ABILITY", "it can be used only once per turn", () => {
  const a = developBoard();
  developDraw(a.engine, P1);
  const hand = handSize(a.engine, P1);
  assert.equal(a.engine.state.pendingChoice, undefined, "a second draw is not offered");
  assert.equal(handSize(a.engine, P1), hand);
  const b = developBoard();
  developResource(b.engine, P1, b.id("handRes"), false);
  assert.equal(b.engine.state.pendingChoice, undefined, "a second resource play is not offered");
  assert.equal(zoneOf(b.engine, b.id("handRes2")), "hand");
});

clause(TOURNAMENT, "3:rule:DEVELOP ABILITY", "it can be used only on my own turn", () => {
  const { engine, id } = developBoard();
  const handBefore = engine.state.players[P1].hand.length;
  endTurnRaw(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  const pending = engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(pending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.players[P1].hand.length, handBefore, "I draw nothing at the opponent's turn start");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
});

clause(TOURNAMENT, "3:rule:DEVELOP ABILITY", "it is available again every turn, and skipping it costs nothing", () => {
  const { engine } = developBoard();
  const hand = handSize(engine, P1);
  endTurn(engine, P1); // I skipped my Develop Rule entirely
  assert.equal(handSize(engine, P1), hand, "skipping it gives nothing");
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(handSize(engine, P1), hand + 1, "available again on my next turn: the Develop Rule offered a draw at the start of my turn");
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(handSize(engine, P1), hand + 2, "and renews every turn");
});

// --- DRAW: "Pay 3. Draw a card."

function abilityBoard(resources: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}

function activateFaction(engine: SpoilsEngine, player: Player, abilityId: string, owner: Player = player, selected: Record<string, string[]> = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId: factionOf(engine, owner), abilityId, selected, variables: {} } as never);
  resolvePendingResponses(engine);
}

clause(TOURNAMENT, "4:ability:tournament-draw", "pays exactly 3 resources (attached) and draws one card, the top of my deck", () => {
  const { engine, id } = abilityBoard(5);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(readyCount(engine, P1), 2, "exactly 3 resources were paid");
  assert.equal(attachedCount(engine, P1), 3, "paid resources are attached to the faction");
  assert.equal(handSize(engine, P1), handBefore + 1, "drew one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1));
  assert.equal(handSize(engine, P2), 1, "the opponent drew nothing");
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "the faction isn't depleted by it");
});

clause(TOURNAMENT, "4:ability:tournament-draw", "is refused when the 3 cannot be paid (2 resources; 3 with 2 already spent; none) and nothing is half-paid", () => {
  const two = abilityBoard(2);
  assert.throws(() => activateFaction(two.engine, P1, "tournament-draw"));
  assert.equal(handSize(two.engine, P1), 2);
  assert.equal(attachedCount(two.engine, P1), 0, "nothing was half-paid");
  const spentSome = abilityBoard(3, spentRage(P1, 2));
  assert.equal(readyCount(spentSome.engine, P1), 3);
  const tight = abilityBoard(1, spentRage(P1, 2));
  assert.equal(readyCount(tight.engine, P1), 1);
  assert.throws(() => activateFaction(tight.engine, P1, "tournament-draw"), "resources already spent cannot pay again");
  const none = abilityBoard(0);
  assert.throws(() => activateFaction(none.engine, P1, "tournament-draw"));
});

clause(TOURNAMENT, "4:ability:tournament-draw", "works with exactly 3 resources of any icons", () => {
  const { engine, id } = abilityBoard(0, [...bank("greed", 1, P1), ...bank("deception", 1, P1), ...volition(1, P1)]);
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand");
  assert.equal(readyCount(engine, P1), 0);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "can be used again the same turn (no limit is printed)", () => {
  const { engine } = abilityBoard(7);
  const handBefore = handSize(engine, P1);
  activateFaction(engine, P1, "tournament-draw");
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(handSize(engine, P1), handBefore + 2);
  assert.equal(attachedCount(engine, P1), 6);
  assert.equal(readyCount(engine, P1), 1);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "is separate from the Develop Rule (using one leaves the other available)", () => {
  const a = abilityBoard(3);
  const base = handSize(a.engine, P1);
  activateFaction(a.engine, P1, "tournament-draw");
  assert.ok(developOffers(a.engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(a.engine, P1);
  assert.equal(handSize(a.engine, P1), base + 2);
  const b = abilityBoard(3);
  developDraw(b.engine, P1);
  activateFaction(b.engine, P1, "tournament-draw");
  assert.equal(handSize(b.engine, P1), base + 2);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "only its controller can use it", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...topOfDeck("theirdeck", P2)]
  });
  const theirHand = handSize(engine, P2);
  assert.throws(() => activateFaction(engine, P2, "tournament-draw", P1));
  assert.equal(handSize(engine, P2), theirHand);
  assert.equal(attachedCount(engine, P2), 0);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "can be used in response on the opponent's turn (any time I could use an ability)", () => {
  const { engine, id } = abilityBoard(3, [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }]);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  playNoopOnOwnTurn(engine, id, P2);
  const handBefore = handSize(engine, P1);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: factionOf(engine, P1), abilityId: "tournament-draw", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(handSize(engine, P1), handBefore + 1);
});

// --- RESOURCE: "Pay 4. Play a resource."

/** Activates RESOURCE choosing `cardKey` from my hand as the card to play. */
const useResource = (board: ReturnType<typeof abilityBoard>, cardKey: string, player: Player = P1) =>
  activateFaction(board.engine, player, "tournament-resource", player, { resource: [board.id(cardKey)] });

clause(TOURNAMENT, "5:ability:tournament-resource", "pays exactly 4 resources and plays a resource card from my hand face-up, providing its icon", () => {
  const board = abilityBoard(6);
  const { engine, id } = board;
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  useResource(board, "handRes");
  assert.equal(attachedCount(engine, P1), 4, "exactly 4 resources were paid");
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(engine.getThresholds(P1).greed, 1);
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "nothing was drawn");
  assert.equal(zoneOf(engine, id("handChar")), "hand", "only the chosen card was played");
  assert.equal(readyCount(engine, P1), 6 - 4 + 1, "the new resource is ready to pay for things");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "any card can be played as a resource: a non-resource goes in face-down (Volition)", () => {
  const board = abilityBoard(4);
  const { engine, id } = board;
  useResource(board, "handChar");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "a non-resource goes in face-down");
  assert.equal(engine.getThresholds(P1).volition, 1);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "'Play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2)", () => holdResourceFace(() => {
  const board = abilityBoard(4);
  const { engine, id } = board;
  useResource(board, "handRes");
  const asked = engine.state.pendingChoice !== undefined && zoneOf(engine, id("handRes")) === "hand";
  const faceDown = zoneOf(engine, id("handRes")) === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card I must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(TOURNAMENT, "5:ability:tournament-resource", "the card must come from my own hand (not the opponent's hand, not my deck, not a card in play)", () => {
  const board = abilityBoard(4);
  const { engine, id } = board;
  for (const key of ["theirHand", "mydeck0"]) assert.throws(() => useResource(board, key), key);
  assert.throws(() => activateFaction(engine, P1, "tournament-resource", P1, { resource: [factionOf(engine, P1)] }), "my faction");
  assert.throws(() => activateFaction(engine, P1, "tournament-resource", P1, {}), "no card chosen");
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(zoneOf(engine, id("mydeck0")), "deck");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid for a refused play");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "exactly one resource: two cards chosen are refused", () => {
  const board = abilityBoard(4);
  assert.throws(() => activateFaction(board.engine, P1, "tournament-resource", P1, { resource: [board.id("handRes"), board.id("handChar")] }));
  assert.equal(zoneOf(board.engine, board.id("handRes")), "hand");
  assert.equal(attachedCount(board.engine, P1), 0);
});

clause(TOURNAMENT, "5:ability:tournament-resource", "is refused when the 4 cannot be paid (3 resources, none, or 3 with 3 already spent), and no resource is played", () => {
  const three = abilityBoard(3);
  assert.throws(() => useResource(three, "handRes"));
  assert.equal(pending(three.engine), undefined);
  assert.equal(zoneOf(three.engine, three.id("handRes")), "hand");
  assert.equal(attachedCount(three.engine, P1), 0);
  const none = abilityBoard(0);
  assert.throws(() => useResource(none, "handRes"));
  const tight = abilityBoard(3, spentRage(P1, 3));
  assert.throws(() => useResource(tight, "handRes"), "spent resources cannot pay");
  const exact = abilityBoard(4);
  useResource(exact, "handRes");
  assert.equal(zoneOf(exact.engine, exact.id("handRes")), "play", "exactly 4 is enough");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "can be used again the same turn (no limit is printed)", () => {
  const board = abilityBoard(8);
  const { engine, id } = board;
  useResource(board, "handRes");
  useResource(board, "handChar");
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(attachedCount(engine, P1), 8);
});

clause(TOURNAMENT, "5:ability:tournament-resource", "is separate from the Develop Rule (a resource played by the ability leaves the Develop Rule available)", () => {
  const board = abilityBoard(4);
  const { engine, id } = board;
  useResource(board, "handRes");
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "only its controller can use it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 8, P2), { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }]
  });
  assert.throws(() => activateFaction(engine, P2, "tournament-resource", P1, { resource: [id("theirHand")] }));
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(attachedCount(engine, P2), 0);
});

// --- extra edge cases found while reviewing the clauses above

clause(BARDUSE, "1:rule", "a picked character that left play before the Barduse entered play takes no damage: the 2 damage is divided among those still in play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fb", def: printing(BARDUSE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 5 }), owner: P2, zone: "play" },
      { key: "kill", def: KILLER, owner: P2, zone: "hand" },
      ...bank("rage", 3, P1)
    ]
  });
  playRaw(engine, P1, id("fb"), { selected: { picked: [id("foe"), id("foe2")] } });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("foe")] } }); // the opponent's response removes one of the picks
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(pending(engine)?.kind, "distributeAmong");
  // E10b: test corrected because a picked card that left play in response is no longer one of the recipients (CR 402.4, seed-09-2): the engine now refuses a share for it, so the whole 2 goes to the character still in play.
  assert.throws(() => distribute(engine, { [id("foe")]: 1, [id("foe2")]: 1 }), "a card in the discard pile cannot be given a share");
  assert.equal(pending(engine)?.kind, "distributeAmong", "the refused answer leaves the division open");
  distribute(engine, { [id("foe2")]: 2 });
  assert.equal(damageOf(engine, id("foe2")), 2, "the whole 2 lands on the character still in play");
  assert.equal(damageOf(engine, id("foe")), 0, "a card in the discard pile takes no damage");
  assert.equal(zoneOf(engine, id("foe")), "discard");
});

clause(BARDUSE, "1:rule", "...and all 2 damage can go to the one still in play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fb", def: printing(BARDUSE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 5 }), owner: P2, zone: "play" },
      { key: "kill", def: KILLER, owner: P2, zone: "hand" },
      ...bank("rage", 3, P1)
    ]
  });
  playRaw(engine, P1, id("fb"), { selected: { picked: [id("foe"), id("foe2")] } });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  distribute(engine, { [id("foe2")]: 2 });
  assert.equal(damageOf(engine, id("foe2")), 2);
});

clause(HAMMER, "0:ability", "an item attached to a character can be picked and destroyed; its host stays", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.9,
    cards: [
      { key: "hs", def: printing(HAMMER), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", life: 5 }), owner: P2, zone: "play" },
      { key: "gear", def: strengthGear(2), owner: P2, zone: "play", attachedToKey: "host" },
      ...bank("rage", 2, P1)
    ]
  });
  playRaw(engine, P1, id("hs"));
  const accepted = (() => {
    try {
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: [id("gear")] } } } as never);
      return true;
    } catch {
      return false;
    }
  })();
  assert.ok(accepted, "a gear item is an item in play");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gear")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(SIN, "0:ability", "X is the party's size when the card is played: a member already destroyed in the battle no longer counts", () => {
  const board = sinBoard({ extra: [{ key: "p2hit", def: costlyHit(2, 0, "P2 Hit"), owner: P2, zone: "hand" }] });
  const { engine, id } = board;
  sinAttack(board, ["atk1", "atk2"]);
  engine.perform({ type: "passPriority", playerId: P1 } as never); // the attacker's window: nothing yet
  playRaw(engine, P2, id("p2hit"), { selected: { t: [id("atk1")] } }); // the defender kills an attacker (life 2)
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("atk1")), "discard");
  assert.deepEqual(engine.state.battle?.attackingParty, [id("atk2")], "the party now has one member");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
  playRaw(engine, P1, id("sin"));
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("atk2"), "strength"), 1 + 1, "X is 1: the remaining member gains 1 strength");
  assert.equal(engine.getStat(id("atk2"), "life"), 2 + 1);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "with an empty deck the cost is still paid and nothing is drawn; running out of cards does not lose the game (CR 102.1a)", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    cards: [...bank("rage", 3, P1)]
  });
  assert.equal(engine.state.players[P1].deck.length, 0);
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(attachedCount(engine, P1), 3, "the 3 were paid");
  assert.equal(handSize(engine, P1), 0, "there was nothing to draw");
  assert.equal(engine.state.winner, undefined, "no one lost");
});

clause(TROPHIES, "0:rule", "with no character in play at all there is nothing to pick: nothing is asked and nothing happens", () => {
  const { engine } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "tr", def: printing(TROPHIES), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "deck" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "deck" }
    ]
  });
  startP1Turn(engine);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine), undefined);
});

clause(APPARATUS, "0:rule", "a deplete paid as a cost on a chosen card counts too: Kettinger's HANDOFF depletes my character, so my faction loses 1", () => {
  const { engine, id } = apparatusBoard({
    extra: [
      { key: "k", def: printing(KETTINGER), owner: P1, zone: "play", attachedToKey: "mine" }
    ]
  });
  activate(engine, P1, id("k"), "kettinger-handoff", { selected: { newWearer: [id("mine2")] } });
  assert.equal(engine.state.cards[id("mine2")].depleted, true);
  assert.equal(influenceOf(engine, P1), 29);
  assert.equal(influenceOf(engine, P2), 30);
});

clause(APPARATUS, "0:rule", "Rudo Mangod's PUNCH (deplete this card) costs its controller 1 influence", () => {
  const { engine, id } = apparatusBoard({ extra: [{ key: "rudo", def: printing(RUDO), owner: P1, zone: "play" }] });
  activate(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("rudo")].depleted, true);
  assert.equal(influenceOf(engine, P1), 29);
});
