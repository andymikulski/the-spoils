// Clause tests — batch open-beta-07. See docs/TESTING.md and
// `npm run card-tests -- manifest open-beta-07`. Expectations come from each
// card's PRINTED text and RULES.md; engine data is only used to drive the engine.

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
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing } from "./_clause.js";
import { endTurn } from "./_turn.js";
import type { SpoilsEngine } from "../../../engine.js";
import type { CardDefinition } from "../../../engine.js";
import type { CardPlacement, DamageSource } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Seat = typeof P1 | typeof P2;

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Seat = P1) => engine.getAvailableResourceCount(player);

/** Raw `playCard` without draining the response window (use `play` from the harness to drain it). */
function playRaw(engine: SpoilsEngine, player: Seat, cardId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "playCard", playerId: player, cardId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** Raw `activateAbility` without draining the response window. */
function activateRaw(engine: SpoilsEngine, player: Seat, cardId: string, abilityId: string, selected: Record<string, string[]> = {}, variables: Record<string, number> = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

/** The current battle, read through a function so TypeScript does not narrow it after an earlier assertion. */
const battleOf = (engine: SpoilsEngine) => engine.state.battle;

const other = (player: Seat): Seat => (player === P1 ? P2 : P1);

/** Declares an attack by `player` against the opponent's faction. */
function declareAttackBy(engine: SpoilsEngine, player: Seat, attackerIds: string[]) {
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target: { type: "faction", playerId: other(player) } });
}

/** Passes priority for whoever holds it until `player` holds it (or the window closes). */
function passUntil(engine: SpoilsEngine, player: Seat) {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player && !engine.state.pendingChoice) {
    if (++guard > 50) throw new Error("passUntil did not converge");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

/** Answers every open `chooserSelectsTarget` with `pick(pc)` and everything else with the decline answer. */
function pickWith(engine: SpoilsEngine, pick: (pc: { kind: string; playerId: string; [k: string]: unknown }) => string[] | undefined) {
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: pick(pc) ?? [] };
    return declineAll(pc);
  });
}

/** Battle damage plan for `autoResolveBattle`: `plan` maps a damage source's card id to the card id it hits; every other source hits its first legal target. */
function fightPlan(plan: Record<string, string>) {
  return (source: DamageSource) => {
    const wanted = plan[source.cardId];
    const target = source.legalTargets.find((t) => t.type === "card" && t.cardId === wanted) ?? source.legalTargets[0];
    return target && source.strength > 0 ? [{ sourceId: source.cardId, target, amount: source.strength }] : [];
  };
}

/** A free tactic that deals `amount` damage to one chosen character (id `zap`, declaration `t`). */
function zapTactic(amount: number, name = "Zap"): CardDefinition {
  return tactic({
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
}

/** `n` vanilla cards in `owner`'s `zone`, keyed `<prefix>0..n-1`. */
function fillers(prefix: string, n: number, owner: Seat, zone: "deck" | "hand" | "discard", make: (i: number) => CardDefinition = (i) => character({ name: `${prefix}${i}` })): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: make(i), owner, zone }));
}

// --- Rocket Boots ----------------------------------------------------------
// ATTACH TO CHARACTER. The attached character gains 1 strength and 1 speed.
// HANDOFF -- COST: Pay 3. Deplete a character you control that is not in a
// battle. -- EFFECT: Attach this card to the character.
// Item (gear), cost 2, threshold [D].

const BOOTS = "e43caacb-ae68-4f69-a1c3-175cc53ecfa6";

function bootsBoard(opts: { bootsIn?: "hand" | "play"; host?: string; deception?: number; greed?: number; turn?: number; active?: Seat; bootsOwner?: Seat } = {}) {
  const bootsIn = opts.bootsIn ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 1,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "boots", def: printing(BOOTS), owner: opts.bootsOwner ?? P1, zone: bootsIn, attachedToKey: bootsIn === "play" ? opts.host ?? "mine" : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(BOOTS, "0:attach", "attaches to the character it is played on (yours or the opponent's); pays 2 and leaves the hand", () => {
  for (const hostKey of ["mine", "foe"] as const) {
    const { engine, id } = bootsBoard();
    const before = ready(engine);
    play(engine, P1, id("boots"), { selected: { attachTo: [id(hostKey)] } });
    assert.equal(engine.state.cards[id("boots")].zone, "play", "enters play");
    assert.equal(engine.state.cards[id("boots")].attachedTo, id(hostKey), `attached to ${hostKey}`);
    assert.equal(engine.state.cards[id("boots")].controllerId, P1, "the Boots stay under their player's control, whoever the host belongs to");
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
    assert.equal(engine.state.players[P1].hand.includes(id("boots")), false);
  }
});

clause(BOOTS, "0:attach", "is refused for a host that is not a character (item, location, face-down card, faction) or with no host chosen", () => {
  const { engine, id } = bootsBoard();
  const attempt = (hostId: string) => () => playRaw(engine, P1, id("boots"), { selected: { attachTo: [hostId] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card is only a resource");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(attempt(engine.state.players[P2].factionId!), "the opponent's faction");
  assert.throws(() => playRaw(engine, P1, id("boots"), { selected: {} }), "no host chosen");
  assert.equal(engine.state.cards[id("boots")].zone, "hand", "a refused play leaves the card in hand");
  attempt(id("mate"))();
  assert.ok(engine.state.responseWindow, "a character host is accepted");
});

clause(BOOTS, "0:attach", "is refused one resource short of its cost of 2, and without [D] even with plenty of other resources", () => {
  const short = bootsBoard({ deception: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("boots"), { selected: { attachTo: [short.id("mine")] } }));
  const noThreshold = bootsBoard({ deception: 0, greed: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("boots"), { selected: { attachTo: [noThreshold.id("mine")] } }));
  const exact = bootsBoard({ deception: 2 });
  play(exact.engine, P1, exact.id("boots"), { selected: { attachTo: [exact.id("mine")] } });
  assert.equal(exact.engine.state.cards[exact.id("boots")].attachedTo, exact.id("mine"), "[D] and exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(BOOTS, "0:attach", "when the host is destroyed the attached Boots leave play with it (to their owner's discard pile)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "boots", def: printing(BOOTS), owner: P1, zone: "play", attachedToKey: "mine" }
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].zone, "discard");
  assert.equal(engine.state.cards[id("boots")].zone, "discard", "attached cards leave play the same way their host does");
  assert.equal(engine.state.players[P1].discard.includes(id("boots")), true);
});

clause(BOOTS, "0:attach", "when the host returns to its owner's hand the attached Boots leave play too (they do not stay on the table unattached)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "boots", def: printing(BOOTS), owner: P1, zone: "play", attachedToKey: "mine" }
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].zone, "hand");
  assert.notEqual(engine.state.cards[id("boots")].zone, "play", "no unattached Boots are left in play");
});

clause(BOOTS, "1:rule", "the attached character gains exactly 1 strength and 1 speed (not life), whether it is yours or the opponent's", () => {
  for (const hostKey of ["mine", "foe"] as const) {
    const bare = bootsBoard();
    const { engine, id } = bootsBoard({ bootsIn: "play", host: hostKey });
    for (const [stat, delta] of [["strength", 1], ["speed", 1], ["life", 0]] as const) {
      assert.equal(engine.getStat(id(hostKey), stat), bare.engine.getStat(bare.id(hostKey), stat) + delta, `${hostKey} ${stat}`);
    }
    assert.equal(engine.getStat(id(hostKey), "strength"), 3);
    assert.equal(engine.getStat(id(hostKey), "speed"), 3);
    assert.equal(engine.getStat(id(hostKey), "life"), 4);
  }
});

clause(BOOTS, "1:rule", "only the attached character is affected: your other characters and the opponent's keep their stats", () => {
  const { engine, id } = bootsBoard({ bootsIn: "play", host: "mine" });
  for (const key of ["mate", "foe"]) {
    assert.equal(engine.getStat(id(key), "strength"), 2, `${key} strength`);
    assert.equal(engine.getStat(id(key), "speed"), 2, `${key} speed`);
    assert.equal(engine.getStat(id(key), "life"), 4, `${key} life`);
  }
});

clause(BOOTS, "1:rule", "two pairs of Boots on one character stack (+2 strength, +2 speed)", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "b1", def: printing(BOOTS), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "b2", def: printing(BOOTS), owner: P1, zone: "play", attachedToKey: "mine" }
    ]
  });
  assert.equal(engine.getStat(id("mine"), "strength"), 4);
  assert.equal(engine.getStat(id("mine"), "speed"), 4);
});

clause(BOOTS, "1:rule", "the bonus is gone once the Boots leave play", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "smash", def: smash, owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "boots", def: printing(BOOTS), owner: P1, zone: "play", attachedToKey: "mine" }
    ]
  });
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  play(engine, P1, id("smash"), { selected: { t: [id("boots")] } });
  assert.equal(engine.state.cards[id("boots")].zone, "discard");
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
  assert.equal(engine.getStat(id("mine"), "speed"), 2);
});

/** A board with the Boots in play on `mine`, a ready character `mate`, a depleted one `tired`, and `foe`. */
function handoffBoard(opts: { resources?: number; greed?: number; deception?: number; withFaceDown?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "boots", def: printing(BOOTS), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "tired", def: character({ name: "Tired", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      // a face-down card is a Volition resource, so it only joins the board when a test needs one to be picked
      ...(opts.withFaceDown ? [{ key: "faceDown", def: character({ name: "FaceDown" }), owner: P1, zone: "play" as const, faceDown: true }] : []),
      ...bank("greed", opts.greed ?? opts.resources ?? 5, P1),
      ...bank("deception", opts.deception ?? 0, P1)
    ]
  });
}

clause(BOOTS, "2:ability:handoff", "pays 3 and depletes the chosen character as the cost, then the Boots attach to that character (the old host loses the bonus, the new one gains it)", () => {
  const { engine, id } = handoffBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("boots"), "handoff", { h: [id("mate")] });
  assert.equal(before - ready(engine), 3, "COST: pay 3, paid on activation");
  assert.equal(engine.state.cards[id("mate")].depleted, true, "COST: the chosen character is depleted on activation");
  assert.equal(engine.state.cards[id("mine")].depleted, false, "the old host is not depleted");
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mate"), "EFFECT: attach this card to the character");
  assert.equal(engine.state.cards[id("boots")].zone, "play");
  assert.equal(engine.state.cards[id("boots")].controllerId, P1);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "old host loses the strength bonus");
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "old host loses the speed bonus");
  assert.equal(engine.getStat(id("mate"), "strength"), 3, "new host gains the strength bonus");
  assert.equal(engine.getStat(id("mate"), "speed"), 3, "new host gains the speed bonus");
});

clause(BOOTS, "2:ability:handoff", "needs no threshold: three resources of any kind pay for it", () => {
  const { engine, id } = handoffBoard({ greed: 3, deception: 0 });
  activate(engine, P1, id("boots"), "handoff", { selected: { h: [id("mate")] } });
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mate"));
  assert.equal(ready(engine), 0, "all three resources were spent");
});

clause(BOOTS, "2:ability:handoff", "is refused one resource short of the cost of 3, and nothing is depleted", () => {
  const { engine, id } = handoffBoard({ greed: 2 });
  assert.throws(() => activateRaw(engine, P1, id("boots"), "handoff", { h: [id("mate")] }));
  assert.equal(engine.state.cards[id("mate")].depleted, false, "no partial payment");
  assert.equal(ready(engine), 2);
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mine"));
  const exact = handoffBoard({ greed: 3 });
  activate(exact.engine, P1, exact.id("boots"), "handoff", { selected: { h: [exact.id("mate")] } });
  assert.equal(exact.engine.state.cards[exact.id("boots")].attachedTo, exact.id("mate"), "exactly 3 resources is enough");
});

clause(BOOTS, "2:ability:handoff", "can hand off to a character you control and the Boots can come from an opponent's character (you pick your own recipient)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "boots", def: printing(BOOTS), owner: P1, zone: "play", attachedToKey: "foe" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "control: the opponent's character wears them");
  activate(engine, P1, id("boots"), "handoff", { selected: { h: [id("mate")] } });
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mate"));
  assert.equal(engine.getStat(id("foe"), "strength"), 2);
  assert.equal(engine.getStat(id("mate"), "strength"), 3);
});

clause(BOOTS, "2:ability:handoff", "the character must be one you control: an opponent's character is refused", () => {
  const { engine, id } = handoffBoard();
  assert.throws(() => activateRaw(engine, P1, id("boots"), "handoff", { h: [id("foe")] }));
  assert.equal(engine.state.cards[id("foe")].depleted, false);
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mine"));
  activate(engine, P1, id("boots"), "handoff", { selected: { h: [id("mate")] } });
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mate"), "control: one of your own characters is accepted");
});

clause(BOOTS, "2:ability:handoff", "the character must be a character: items, face-down cards and factions are refused", () => {
  const { engine, id } = handoffBoard({ withFaceDown: true });
  const before = ready(engine);
  assert.throws(() => activateRaw(engine, P1, id("boots"), "handoff", { h: [id("thing")] }), "an item");
  assert.throws(() => activateRaw(engine, P1, id("boots"), "handoff", { h: [id("faceDown")] }), "a face-down card");
  assert.throws(() => activateRaw(engine, P1, id("boots"), "handoff", { h: [engine.state.players[P1].factionId!] }), "your faction");
  assert.throws(() => activateRaw(engine, P1, id("boots"), "handoff", { h: [] }), "no character picked");
  assert.equal(ready(engine), before, "nothing was paid");
  activate(engine, P1, id("boots"), "handoff", { selected: { h: [id("mate")] } });
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mate"), "control: a character is accepted");
});

clause(BOOTS, "2:ability:handoff", "an already-depleted character cannot be depleted for the cost, so it is refused", () => {
  const { engine, id } = handoffBoard();
  assert.throws(() => activateRaw(engine, P1, id("boots"), "handoff", { h: [id("tired")] }));
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mine"));
  assert.equal(ready(engine), 5, "nothing was paid");
  activate(engine, P1, id("boots"), "handoff", { selected: { h: [id("mate")] } });
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mate"), "control: a ready character is accepted");
});

clause(BOOTS, "2:ability:handoff", "the current host may be the chosen character: it is depleted for the cost and the Boots stay on it", () => {
  const { engine, id } = handoffBoard();
  activate(engine, P1, id("boots"), "handoff", { selected: { h: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].depleted, true);
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mine"));
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "bonus still applies exactly once");
  assert.equal(ready(engine), 2);
});

clause(BOOTS, "2:ability:handoff", "only the Boots' controller can use it", () => {
  const { engine, id } = handoffBoard();
  assert.throws(() => activateRaw(engine, P2, id("boots"), "handoff", { h: [id("foe")] }));
  assert.throws(() => activateRaw(engine, P2, id("boots"), "handoff", { h: [id("mate")] }));
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mine"));
  activate(engine, P1, id("boots"), "handoff", { selected: { h: [id("mate")] } });
  assert.equal(engine.state.cards[id("boots")].attachedTo, id("mate"), "control: the controller can use it");
});

clause(BOOTS, "2:ability:handoff", "a character that is in a battle cannot be chosen (a blocker, and an attacker), but one that is not in the battle can", () => {
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
      { key: "boots", def: printing(BOOTS), owner: P2, zone: "play", attachedToKey: "idle" },
      ...bank("greed", 9, P2)
    ]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  passUntil(engine, P2);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the defender can act in the battle window");
  assert.throws(() => activateRaw(engine, P2, id("boots"), "handoff", { h: [id("blk")] }), "a blocking character is in the battle");
  assert.equal(engine.state.cards[id("blk")].depleted, false, "refused: nothing was paid or depleted");
  assert.equal(ready(engine, P2), 9);
  activateRaw(engine, P2, id("boots"), "handoff", { h: [id("idle2")] });
  assert.equal(engine.state.cards[id("idle2")].depleted, true, "a character not in the battle is accepted");
  assert.equal(ready(engine, P2), 6);
});

clause(BOOTS, "2:ability:handoff", "an attacking character is in a battle and cannot be chosen", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 3 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "boots", def: printing(BOOTS), owner: P1, zone: "play", attachedToKey: "idle" },
      ...bank("greed", 9, P1)
    ]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker acts first in the battle window");
  assert.throws(() => activateRaw(engine, P1, id("boots"), "handoff", { h: [id("atk")] }), "an attacking character is in the battle");
  assert.equal(ready(engine), 9, "refused: nothing paid");
  activateRaw(engine, P1, id("boots"), "handoff", { h: [id("idle")] });
  assert.equal(engine.state.cards[id("idle")].depleted, true, "control: a character outside the battle is accepted");
});

// --- Sarcophyle Matriculation ----------------------------------------------
// COST: Play this only when you are being attacked. Pick a character your
// opponent controls. -- EFFECT: If the character is destroyed during this
// battle, put it into play under your control, depleted. It becomes a
// "sarcophyle". Tactic, cost 4, threshold [D][D].

const MATRIC = "e53172ad-eba1-453f-949d-910e4aba0bd6";

/** P2 is the active player (turn 2) with attackers `atk` / `atk2`; P1 holds the tactic and has the blocker `blk`. */
function matricBoard(opts: { deception?: number; greed?: number; extra?: CardPlacement[]; blkLife?: number; atkLife?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sm", def: printing(MATRIC), owner: P1, zone: "hand" },
      { key: "blk", def: character({ name: "Blk", strength: 5, life: opts.blkLife ?? 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 5, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: opts.atkLife ?? 2, speed: 3, subtype: ["goblin"] }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 2, life: 2, speed: 3 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "kill1", def: killTactic({ name: "Kill1" }), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic({ name: "Kill2" }), owner: P2, zone: "hand" },
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 attacks P1's faction with `attackers`; afterwards P1 holds priority in the attack's response window. */
function matricAttack(board: ReturnType<typeof matricBoard>, attackers: string[] = ["atk"]) {
  const { engine, id } = board;
  declareAttackBy(engine, P2, attackers.map(id));
  passUntil(engine, P1);
}

/** Plays Sarcophyle Matriculation picking `pick`, then blocks with `blockers` and plays the battle out. */
function matricPlayAndFight(board: ReturnType<typeof matricBoard>, pick: string, attackers: string[] = ["atk"], blockers: string[] = ["blk"], split?: Parameters<typeof autoResolveBattle>[1]) {
  const { engine, id } = board;
  matricAttack(board, attackers);
  play(engine, P1, id("sm"), { selected: { c: [id(pick)] } });
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: blockers.map(id) });
  autoResolveBattle(engine, split);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
}

clause(MATRIC, "0:ability", "the picked attacker is destroyed in the battle: it ends up in play under your control, depleted, and is a sarcophyle; the cost of 4 is paid", () => {
  const board = matricBoard();
  const { engine, id } = board;
  matricAttack(board);
  const before = ready(engine);
  play(engine, P1, id("sm"), { selected: { c: [id("atk")] } });
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(engine.state.cards[id("sm")].zone, "discard", "the tactic ends in its owner's discard pile");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  drain(engine, declineAll);

  const atk = engine.state.cards[id("atk")];
  assert.equal(atk.zone, "play", "put into play, not left in the discard pile");
  assert.equal(atk.controllerId, P1, "under your control");
  assert.equal(atk.ownerId, P2, "ownership never changes");
  assert.equal(atk.depleted, true, "depleted");
  assert.equal(atk.damage, 0, "it re-enters play undamaged");
  assert.ok(engine.getSubtypes(id("atk")).includes("sarcophyle"), "it becomes a sarcophyle");
  assert.ok(engine.state.players[P1].play.includes(id("atk")), "it is in your play area");
  assert.equal(engine.state.players[P2].play.includes(id("atk")), false, "and no longer in the opponent's");
  assert.equal(engine.state.players[P2].discard.includes(id("atk")), false, "not in the discard pile");
  assert.equal(battleOf(engine), undefined, "the battle is over");
});

clause(MATRIC, "0:ability", "an unpicked character destroyed in the same battle is destroyed normally (it goes to its owner's discard pile)", () => {
  const board = matricBoard();
  const { engine, id } = board;
  // blk (strength 5) kills atk, mine2 (strength 5) kills atk2: both attackers die, only the picked one is taken
  matricPlayAndFight(board, "atk", ["atk", "atk2"], ["blk", "mine2"], fightPlan({ [id("blk")]: id("atk"), [id("mine2")]: id("atk2") }));
  assert.equal(engine.state.cards[id("atk")].controllerId, P1, "control: the picked one was taken");
  assert.equal(engine.state.cards[id("atk2")].zone, "discard", "the unpicked attacker is destroyed into the discard pile");
  assert.equal(engine.state.players[P2].discard.includes(id("atk2")), true);
  assert.equal(engine.state.cards[id("atk2")].controllerId, P2);
});

clause(MATRIC, "0:ability", "if the picked character is NOT destroyed in the battle, nothing happens to it", () => {
  const board = matricBoard({ atkLife: 9 });
  const { engine, id } = board;
  matricPlayAndFight(board, "atk");
  assert.equal(engine.state.cards[id("atk")].zone, "play");
  assert.equal(engine.state.cards[id("atk")].controllerId, P2, "still the opponent's");
  assert.equal(engine.getSubtypes(id("atk")).includes("sarcophyle"), false);
  assert.equal(engine.state.cards[id("atk")].depleted, true, "depleted only because it attacked");
});

clause(MATRIC, "0:ability", "a picked character that is not even in the battle is taken too if it is destroyed during the battle", () => {
  const board = matricBoard({ atkLife: 9 });
  const { engine, id } = board;
  matricAttack(board);
  play(engine, P1, id("sm"), { selected: { c: [id("bystander")] } });
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
  passUntil(engine, P1);
  play(engine, P1, id("kill1"), { selected: { t: [id("bystander")] } });
  assert.equal(engine.state.cards[id("bystander")].zone, "play", "put into play");
  assert.equal(engine.state.cards[id("bystander")].controllerId, P1, "under your control");
  assert.equal(engine.state.cards[id("bystander")].depleted, true);
  assert.ok(engine.getSubtypes(id("bystander")).includes("sarcophyle"), "engine.getSubtypes(id(\"bystander\")).includes(\"sarcophyle\")");
});

clause(MATRIC, "0:ability", "the effect lasts only for this battle: a later destruction in the same turn is an ordinary destruction", () => {
  const board = matricBoard({ atkLife: 9 });
  const { engine, id } = board;
  matricPlayAndFight(board, "atk");
  assert.equal(battleOf(engine), undefined, "the battle is over");
  assert.equal(engine.state.cards[id("atk")].zone, "play", "it survived the battle");
  play(engine, P2, id("kill2"), { selected: { t: [id("atk")] } });
  assert.equal(engine.state.cards[id("atk")].zone, "discard", "destroyed after the battle: goes to the discard pile");
  assert.equal(engine.state.cards[id("atk")].controllerId, P2);
});

clause(MATRIC, "0:ability", "can be played at any point of the attack: before blockers are declared and after (in the battle's response windows)", () => {
  const early = matricBoard();
  matricAttack(early);
  playRaw(early.engine, P1, early.id("sm"), { selected: { c: [early.id("atk")] } });
  assert.ok(early.engine.state.responseWindow, "accepted while the attack is declared");

  const late = matricBoard();
  matricAttack(late);
  resolvePendingResponses(late.engine);
  late.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [late.id("blk")] });
  passUntil(late.engine, P1);
  playRaw(late.engine, P1, late.id("sm"), { selected: { c: [late.id("atk")] } });
  assert.ok(late.engine.state.responseWindow, "accepted after blockers have been declared");
  assert.equal(late.engine.state.cards[late.id("sm")].zone, "deploying");
});

clause(MATRIC, "0:ability", "can be played when an attack is made on your location (you are being attacked)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sm", def: printing(MATRIC), owner: P1, zone: "hand" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 2, speed: 3 }), owner: P2, zone: "play" },
      ...bank("deception", 4, P1)
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "card", cardId: id("place") } });
  passUntil(engine, P1);
  playRaw(engine, P1, id("sm"), { selected: { c: [id("atk")] } });
  assert.ok(engine.state.responseWindow, "accepted while your location is attacked");
});

clause(MATRIC, "0:ability", "is refused when you are not being attacked: no battle, and when you are the attacker", () => {
  const quiet = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: [
      { key: "sm", def: printing(MATRIC), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("deception", 6, P1)
    ]
  });
  assert.throws(() => playRaw(quiet.engine, P1, quiet.id("sm"), { selected: { c: [quiet.id("foe")] } }), "no battle at all (my own turn)");
  assert.equal(quiet.engine.state.cards[quiet.id("sm")].zone, "hand");

  const offence = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sm", def: printing(MATRIC), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("deception", 6, P1)
    ]
  });
  declareAttackBy(offence.engine, P1, [offence.id("mine")]);
  assert.equal(offence.engine.state.responseWindow?.priorityPlayerId, P1);
  assert.throws(() => playRaw(offence.engine, P1, offence.id("sm"), { selected: { c: [offence.id("foe")] } }), "I am the attacker, not the one being attacked");
  assert.equal(offence.engine.state.cards[offence.id("sm")].zone, "hand");
});

clause(MATRIC, "0:ability", "only a character the opponent controls can be picked: not your own, not an item, a location, a face-down card or a faction", () => {
  const board = matricBoard();
  const { engine, id } = board;
  matricAttack(board);
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("sm"), { selected: { c: [cardId] } });
  assert.throws(attempt(id("blk")), "my own character");
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(engine.state.players[P2].factionId!), "the opponent's faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "my faction");
  assert.throws(() => playRaw(engine, P1, id("sm"), { selected: { c: [] } }), "no pick");
  assert.equal(engine.state.cards[id("sm")].zone, "hand");
  attempt(id("atk"))();
  assert.ok(engine.state.responseWindow, "an opponent's character is accepted");
});

clause(MATRIC, "0:ability", "a character you own but the opponent controls is 'a character your opponent controls' and can be picked; one you control but they own cannot", () => {
  const board = matricBoard({
    extra: [
      { key: "lent", def: character({ name: "Lent", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play", controller: P2 },
      { key: "stolen", def: character({ name: "Stolen", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play", controller: P1 }
    ]
  });
  const { engine, id } = board;
  matricAttack(board);
  assert.throws(() => playRaw(engine, P1, id("sm"), { selected: { c: [id("stolen")] } }), "P2 owns it but P1 controls it");
  playRaw(engine, P1, id("sm"), { selected: { c: [id("lent")] } });
  assert.ok(engine.state.responseWindow, "P1 owns it but P2 controls it: accepted");
});

clause(MATRIC, "0:ability", "is refused one resource short of its cost of 4, and without [D][D] even with plenty of other resources", () => {
  const short = matricBoard({ deception: 3 });
  matricAttack(short);
  assert.throws(() => playRaw(short.engine, P1, short.id("sm"), { selected: { c: [short.id("atk")] } }));
  assert.equal(short.engine.state.cards[short.id("sm")].zone, "hand");

  const oneD = matricBoard({ deception: 1, greed: 6 });
  matricAttack(oneD);
  assert.throws(() => playRaw(oneD.engine, P1, oneD.id("sm"), { selected: { c: [oneD.id("atk")] } }), "only one [D]");

  const exact = matricBoard({ deception: 4 });
  matricAttack(exact);
  play(exact.engine, P1, exact.id("sm"), { selected: { c: [exact.id("atk")] } });
  assert.equal(exact.engine.state.cards[exact.id("sm")].zone, "discard", "exactly 4 resources with [D][D] is enough");

  const twoD = matricBoard({ deception: 2, greed: 2 });
  matricAttack(twoD);
  play(twoD.engine, P1, twoD.id("sm"), { selected: { c: [twoD.id("atk")] } });
  assert.equal(twoD.engine.state.cards[twoD.id("sm")].zone, "discard", "[D][D] plus two other resources is enough");
});

clause(MATRIC, "0:ability", "also works when played after blockers are declared: the picked attacker is destroyed by the blocker and ends up under your control", () => {
  const { engine, id } = matricBoard();
  declareAttackBy(engine, P2, [id("atk")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blk")] });
  passUntil(engine, P1);
  play(engine, P1, id("sm"), { selected: { c: [id("atk")] } });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("atk")].zone, "play");
  assert.equal(engine.state.cards[id("atk")].controllerId, P1);
  assert.equal(engine.state.cards[id("atk")].depleted, true);
  assert.ok(engine.getSubtypes(id("atk")).includes("sarcophyle"), "engine.getSubtypes(id(\"atk\")).includes(\"sarcophyle\")");
});

// --- Scrag -----------------------------------------------------------------
// COST: Pick a character. X is that character's life. -- EFFECT: Destroy the
// character if your opponent has at least X cards in their discard pile.
// Tactic, cost 2, threshold [D][D].

const SCRAG = "c0b6851e-1ad8-4079-8f81-5e5ff07f9187";

function scragBoard(opts: { oppDiscard?: number; myDiscard?: number; deception?: number; greed?: number; foeLife?: number; foeDamage?: number; mixed?: boolean } = {}) {
  const mixedDef = (i: number) => (i % 3 === 0 ? tactic({ name: `Dis${i}` }) : i % 3 === 1 ? item({ name: `Dis${i}` }) : character({ name: `Dis${i}` }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sg", def: printing(SCRAG), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: opts.foeLife ?? 3 }), owner: P2, zone: "play", damage: opts.foeDamage ?? 0 },
      { key: "bystander", def: character({ name: "Bystander", life: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      ...fillers("od", opts.oppDiscard ?? 0, P2, "discard", opts.mixed ? mixedDef : undefined),
      ...fillers("md", opts.myDiscard ?? 0, P1, "discard"),
      ...bank("deception", opts.deception ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

for (const [discard, destroyed] of [
  [0, false],
  [2, false],
  [3, true],
  [4, true],
  [9, true]
] as const) {
  clause(SCRAG, "0:ability", `a life-3 character with ${discard} cards in the opponent's discard pile is ${destroyed ? "destroyed (at least X = 3)" : "not destroyed (fewer than X = 3)"}; the cost of 2 is paid`, () => {
    const { engine, id } = scragBoard({ oppDiscard: discard });
    const before = ready(engine);
    play(engine, P1, id("sg"), { selected: { c: [id("foe")] } });
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid either way");
    assert.equal(engine.state.cards[id("foe")].zone, destroyed ? "discard" : "play");
    assert.equal(engine.state.cards[id("sg")].zone, "discard", "the tactic ends in its owner's discard pile");
    assert.equal(engine.state.cards[id("bystander")].zone, "play", "an unpicked character is untouched");
    assert.equal(engine.state.cards[id("mine")].zone, "play");
  });
}

clause(SCRAG, "0:ability", "counts every kind of card in the opponent's discard pile, not only characters", () => {
  const hit = scragBoard({ oppDiscard: 3, mixed: true });
  play(hit.engine, P1, hit.id("sg"), { selected: { c: [hit.id("foe")] } });
  assert.equal(hit.engine.state.cards[hit.id("foe")].zone, "discard", "a tactic, an item and a character make 3 cards");
  const miss = scragBoard({ oppDiscard: 2, mixed: true });
  play(miss.engine, P1, miss.id("sg"), { selected: { c: [miss.id("foe")] } });
  assert.equal(miss.engine.state.cards[miss.id("foe")].zone, "play");
});

clause(SCRAG, "0:ability", "only the OPPONENT's discard pile counts: a big discard pile of your own does not help", () => {
  const { engine, id } = scragBoard({ oppDiscard: 2, myDiscard: 9 });
  play(engine, P1, id("sg"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "play", "the opponent has only 2 < 3");
});

clause(SCRAG, "0:ability", "X is the character's life, not its remaining life: damage on it does not lower X", () => {
  const survive = scragBoard({ foeLife: 5, foeDamage: 3, oppDiscard: 4 });
  play(survive.engine, P1, survive.id("sg"), { selected: { c: [survive.id("foe")] } });
  assert.equal(survive.engine.state.cards[survive.id("foe")].zone, "play", "X = 5 and the opponent has 4: survives even with 3 damage");
  const die = scragBoard({ foeLife: 5, foeDamage: 3, oppDiscard: 5 });
  play(die.engine, P1, die.id("sg"), { selected: { c: [die.id("foe")] } });
  assert.equal(die.engine.state.cards[die.id("foe")].zone, "discard", "X = 5 and the opponent has 5");
});

clause(SCRAG, "0:ability", "X is the character's current life, including bonuses it has", () => {
  const lifeGear = item({
    name: "Life Gear",
    attachTo: "character",
    behavior: { abilities: [{ id: "life", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: 2 }] }] }
  });
  const board = (oppDiscard: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sg", def: printing(SCRAG), owner: P1, zone: "hand" },
        { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
        { key: "gear", def: lifeGear, owner: P2, zone: "play", attachedToKey: "foe" },
        ...fillers("od", oppDiscard, P2, "discard"),
        ...bank("deception", 4, P1)
      ]
    });
  const four = board(4);
  assert.equal(four.engine.getStat(four.id("foe"), "life"), 5, "the gear works");
  play(four.engine, P1, four.id("sg"), { selected: { c: [four.id("foe")] } });
  assert.equal(four.engine.state.cards[four.id("foe")].zone, "play", "X = 5 with 4 cards: survives (printed life 3 would have died)");
  const five = board(5);
  play(five.engine, P1, five.id("sg"), { selected: { c: [five.id("foe")] } });
  assert.equal(five.engine.state.cards[five.id("foe")].zone, "discard", "X = 5 with 5 cards");
});

clause(SCRAG, "0:ability", "any character can be picked, including one of your own", () => {
  const { engine, id } = scragBoard({ oppDiscard: 3 });
  play(engine, P1, id("sg"), { selected: { c: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].zone, "discard", "life 3 with 3 cards in the opponent's discard pile");
  assert.equal(engine.state.cards[id("foe")].zone, "play");
});

clause(SCRAG, "0:ability", "the picked card must be a character: an item, a location, a face-down card and a faction are refused", () => {
  const { engine, id } = scragBoard({ oppDiscard: 5 });
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("sg"), { selected: { c: [cardId] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(engine.state.players[P2].factionId!), "the opponent's faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(() => playRaw(engine, P1, id("sg"), { selected: { c: [] } }), "no pick");
  assert.equal(engine.state.cards[id("sg")].zone, "hand");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
});

clause(SCRAG, "0:ability", "is refused one resource short of its cost of 2, and without [D][D]", () => {
  const short = scragBoard({ oppDiscard: 3, deception: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sg"), { selected: { c: [short.id("foe")] } }));
  assert.equal(short.engine.state.cards[short.id("sg")].zone, "hand");

  const oneD = scragBoard({ oppDiscard: 3, deception: 1, greed: 5 });
  assert.throws(() => playRaw(oneD.engine, P1, oneD.id("sg"), { selected: { c: [oneD.id("foe")] } }), "only one [D]");

  const exact = scragBoard({ oppDiscard: 3, deception: 2 });
  play(exact.engine, P1, exact.id("sg"), { selected: { c: [exact.id("foe")] } });
  assert.equal(exact.engine.state.cards[exact.id("foe")].zone, "discard", "[D][D] and exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

// --- Snake Eyes ------------------------------------------------------------
// COST: Pick a character. -- EFFECT: If the character has received damage this
// turn, destroy it. Then, draw a card. Tactic, cost 3, threshold [D].

const SNAKE = "3e04b4b1-a534-458f-b98b-626d045e3c17";

function snakeBoard(opts: { deception?: number; greed?: number; deck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "se", def: printing(SNAKE), owner: P1, zone: "hand" },
      { key: "zap", def: zapTactic(1), owner: P1, zone: "hand" },
      { key: "zap2", def: zapTactic(2, "Zap2"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 6 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 6 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", life: 6 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      ...fillers("d", opts.deck ?? 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(SNAKE, "0:ability", "destroys a character that has received damage this turn (even 1 damage on a big character), pays 3, and then draws a card", () => {
  const { engine, id } = snakeBoard();
  play(engine, P1, id("zap"), { selected: { t: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].damage, 1, "setup: the character has received damage");
  assert.equal(engine.state.cards[id("foe")].zone, "play");
  const top = engine.state.players[P1].deck[0];
  const handBefore = engine.state.players[P1].hand.length;
  const before = ready(engine);
  play(engine, P1, id("se"), { selected: { c: [id("foe")] } });
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(engine.state.cards[id("foe")].zone, "discard", "destroyed");
  assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1, "Snake Eyes left the hand, one card was drawn");
  assert.equal(engine.state.cards[top].zone, "hand", "the top card of the deck was drawn");
  assert.equal(engine.state.cards[id("bystander")].zone, "play", "an unpicked character is untouched");
});

clause(SNAKE, "0:ability", "a character that has not received damage this turn survives, but you still draw a card", () => {
  const { engine, id } = snakeBoard();
  const top = engine.state.players[P1].deck[0];
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("se"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "play", "no damage received: not destroyed");
  assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1, "'Then, draw a card' happens regardless");
  assert.equal(engine.state.cards[top].zone, "hand");
  assert.equal(engine.state.cards[id("se")].zone, "discard");
});

clause(SNAKE, "0:ability", "damage received by a different character does not count: only the picked character's own damage matters", () => {
  const { engine, id } = snakeBoard();
  play(engine, P1, id("zap"), { selected: { t: [id("bystander")] } });
  play(engine, P1, id("se"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "play", "the bystander was damaged, not the foe");
  assert.equal(engine.state.cards[id("bystander")].zone, "play");
});

clause(SNAKE, "0:ability", "works on your own damaged character too, whatever its controller", () => {
  const { engine, id } = snakeBoard();
  play(engine, P1, id("zap"), { selected: { t: [id("mine")] } });
  play(engine, P1, id("se"), { selected: { c: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].zone, "discard");
});

clause(SNAKE, "0:ability", "damage from any source counts, and any amount of it (a 2-damage effect as well as a 1-damage one)", () => {
  const { engine, id } = snakeBoard();
  play(engine, P1, id("zap2"), { selected: { t: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].damage, 2);
  play(engine, P1, id("se"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "discard");
});

clause(SNAKE, "0:ability", "damage dealt in battle counts as damage received this turn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "se", def: printing(SNAKE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      ...bank("deception", 3, P1)
    ]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("blk")].damage, 1, "setup: the blocker took battle damage");
  assert.equal(engine.state.cards[id("blk")].zone, "play");
  play(engine, P1, id("se"), { selected: { c: [id("blk")] } });
  assert.equal(engine.state.cards[id("blk")].zone, "discard");
});

clause(SNAKE, "0:ability", "damage received on an earlier turn does not count: it is cleared at the start of the turn", () => {
  const { engine, id } = snakeBoard();
  play(engine, P1, id("zap"), { selected: { t: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].damage, 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("foe")].damage, 0, "damage wears off at the start of the turn");
  play(engine, P1, id("se"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "play", "no damage received THIS turn");
});

clause(SNAKE, "0:ability", "an attempt to inflict 0 damage is not damage received", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "se", def: printing(SNAKE), owner: P1, zone: "hand" },
      { key: "zero", def: zapTactic(0, "Zero"), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 6 }), owner: P2, zone: "play" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      ...bank("deception", 3, P1)
    ]
  });
  play(engine, P1, id("zero"), { selected: { t: [id("foe")] } });
  play(engine, P1, id("se"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "play", "0 damage inflicts nothing (CR 408.1)");
});

clause(SNAKE, "0:ability", "with an empty deck the character is still destroyed and nothing is drawn (no loss from an empty deck)", () => {
  const { engine, id } = snakeBoard({ deck: 0 });
  play(engine, P1, id("zap"), { selected: { t: [id("foe")] } });
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("se"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "discard");
  assert.equal(engine.state.players[P1].hand.length, handBefore - 1, "nothing to draw");
  assert.equal(engine.state.winner, undefined, "running out of cards does not lose the game (CR 102.1a)");
});

clause(SNAKE, "0:ability", "the picked card must be a character: an item, a location, a face-down card and a faction are refused", () => {
  const { engine, id } = snakeBoard();
  const attempt = (cardId: string) => () => playRaw(engine, P1, id("se"), { selected: { c: [cardId] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(engine.state.players[P2].factionId!), "the opponent's faction");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(() => playRaw(engine, P1, id("se"), { selected: { c: [] } }), "no pick");
  assert.equal(engine.state.cards[id("se")].zone, "hand");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
});

clause(SNAKE, "0:ability", "is refused one resource short of its cost of 3, and without [D]", () => {
  const short = snakeBoard({ deception: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("se"), { selected: { c: [short.id("foe")] } }));
  assert.equal(short.engine.state.cards[short.id("se")].zone, "hand");

  const noD = snakeBoard({ deception: 0, greed: 6 });
  assert.throws(() => playRaw(noD.engine, P1, noD.id("se"), { selected: { c: [noD.id("foe")] } }), "no [D] at all");

  const exact = snakeBoard({ deception: 3 });
  play(exact.engine, P1, exact.id("se"), { selected: { c: [exact.id("foe")] } });
  assert.equal(exact.engine.state.cards[exact.id("se")].zone, "discard", "[D] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

// --- Sudden Osprey ---------------------------------------------------------
// You may play this card whenever you could play a tactic. -- When this card
// enters play, you may pick a character. If you do, that character gains 1
// strength and 1 life this turn. Character (beast), cost 2, threshold [D][D],
// 1 strength / 3 speed / 2 life.

const OSPREY = "40c81ba9-8ef7-4600-89d9-3aa627d217ef";

/** A free tactic that does nothing, played to open a response window for the opponent. */
const noopTactic = (name = "Noop") => tactic({ name, cost: 0, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });

function ospreyBoard(opts: { deception?: number; greed?: number; turn?: number; active?: Seat; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 1,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "bird", def: printing(OSPREY), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      { key: "tac", def: noopTactic("MyNoop"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "theirTac", def: noopTactic("TheirNoop"), owner: P2, zone: "hand" },
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Answers the open optional pick with `selected` (empty = decline) and drains the window. */
function answerPick(engine: SpoilsEngine, player: Seat, selected: string[]) {
  const pc = engine.state.pendingChoice as unknown as { kind: string } | undefined;
  assert.ok(pc, "a pick is pending");
  assert.equal(pc.kind, "chooserSelectsTarget");
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
}

/** The opponent plays a tactic on their turn, which gives P1 (the responder) a response window. */
function opponentOpensWindow(board: ReturnType<typeof ospreyBoard>) {
  const { engine, id } = board;
  playRaw(engine, P2, id("theirTac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "setup: P1 may respond");
}

clause(OSPREY, "0:rule", "can be played on the opponent's turn in response to their tactic, for its cost of 2, and it enters play under your control", () => {
  const board = ospreyBoard({ turn: 2, active: P2 });
  const { engine, id } = board;
  opponentOpensWindow(board);
  const before = ready(engine);
  playRaw(engine, P1, id("bird"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  resolvePendingResponses(engine);
  answerPick(engine, P1, []);
  assert.equal(engine.state.cards[id("bird")].zone, "play", "the character is in play");
  assert.equal(engine.state.cards[id("bird")].controllerId, P1);
  assert.ok(engine.state.players[P1].play.includes(id("bird")), "engine.state.players[P1].play.includes(id(\"bird\"))");
});

clause(OSPREY, "0:rule", "a character without TACTICAL cannot be played in that same window (control), nor can anything be played on the opponent's turn with no window open", () => {
  const board = ospreyBoard({ turn: 2, active: P2 });
  const { engine, id } = board;
  assert.throws(() => playRaw(engine, P1, id("bird")), "no window is open on the opponent's turn: not even a tactic could be played");
  assert.throws(() => playRaw(engine, P1, id("tac")), "control: a tactic cannot be played now either");
  opponentOpensWindow(board);
  assert.throws(() => playRaw(engine, P1, id("plain")), "an ordinary character cannot be deployed in a response window");
  assert.equal(engine.state.cards[id("plain")].zone, "hand");
  playRaw(engine, P1, id("tac"));
  assert.ok(engine.state.cards[id("tac")].zone === "deploying" || engine.state.cards[id("tac")].zone === "discard", "control: a tactic can be");
});

clause(OSPREY, "0:rule", "can be played in response to the opponent's attack, and the new character can then block that attack", () => {
  const { engine, id } = ospreyBoard({ turn: 2, active: P2 });
  declareAttackBy(engine, P2, [id("foe")]);
  passUntil(engine, P1);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("bird"));
  resolvePendingResponses(engine);
  answerPick(engine, P1, []);
  assert.equal(engine.state.cards[id("bird")].zone, "play");
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("bird")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("bird")], "the Osprey blocks");
});

clause(OSPREY, "0:rule", "can be played in the battle's response windows after blockers are declared", () => {
  const { engine, id } = ospreyBoard({ turn: 2, active: P2 });
  declareAttackBy(engine, P2, [id("foe")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mine")] });
  passUntil(engine, P1);
  playRaw(engine, P1, id("bird"));
  resolvePendingResponses(engine);
  answerPick(engine, P1, []);
  assert.equal(engine.state.cards[id("bird")].zone, "play");
});

clause(OSPREY, "0:rule", "can still be played on your own turn like any character", () => {
  const { engine, id } = ospreyBoard();
  const before = ready(engine);
  play(engine, P1, id("bird"));
  answerPick(engine, P1, []);
  assert.equal(engine.state.cards[id("bird")].zone, "play");
  assert.equal(before - ready(engine), 2);
});

clause(OSPREY, "0:rule", "keeps its cost and threshold when played as a response: refused one resource short and without [D][D]", () => {
  const short = ospreyBoard({ turn: 2, active: P2, deception: 1 });
  opponentOpensWindow(short);
  assert.throws(() => playRaw(short.engine, P1, short.id("bird")), "one resource");
  const oneD = ospreyBoard({ turn: 2, active: P2, deception: 1, greed: 5 });
  opponentOpensWindow(oneD);
  assert.throws(() => playRaw(oneD.engine, P1, oneD.id("bird")), "only one [D]");
  const exact = ospreyBoard({ turn: 2, active: P2, deception: 2 });
  opponentOpensWindow(exact);
  playRaw(exact.engine, P1, exact.id("bird"));
  assert.equal(exact.engine.state.cards[exact.id("bird")].zone, "deploying", "[D][D] and exactly 2 resources is enough");
});

clause(OSPREY, "0:rule", "has its printed stats 1 strength / 3 speed / 2 life once in play", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  answerPick(engine, P1, []);
  assert.equal(engine.getStat(id("bird"), "strength"), 1);
  assert.equal(engine.getStat(id("bird"), "speed"), 3);
  assert.equal(engine.getStat(id("bird"), "life"), 2);
  assert.ok(engine.getSubtypes(id("bird")).includes("beast"), "engine.getSubtypes(id(\"bird\")).includes(\"beast\")");
});

clause(OSPREY, "1:rule", "when it enters play you may pick a character: that character gains exactly +1 strength and +1 life (not speed), and nobody else does", () => {
  for (const pick of ["mine", "foe"] as const) {
    const { engine, id } = ospreyBoard();
    play(engine, P1, id("bird"));
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.equal(pc.kind, "chooserSelectsTarget", "a pick is offered");
    assert.equal(pc.playerId, P1, "its controller picks");
    answerPick(engine, P1, [id(pick)]);
    const unpicked = pick === "mine" ? "foe" : "mine";
    assert.equal(engine.getStat(id(pick), "strength"), 3, `${pick} strength`);
    assert.equal(engine.getStat(id(pick), "life"), 4, `${pick} life`);
    assert.equal(engine.getStat(id(pick), "speed"), 2, `${pick} speed unchanged`);
    assert.equal(engine.getStat(id(unpicked), "strength"), 2, `${unpicked} strength unchanged`);
    assert.equal(engine.getStat(id(unpicked), "life"), 3, `${unpicked} life unchanged`);
    assert.equal(engine.getStat(id("bird"), "strength"), 1, "the Osprey itself is unchanged when it picked another");
    assert.equal(engine.getStat(id("bird"), "life"), 2);
  }
});

clause(OSPREY, "1:rule", "the Osprey itself is a character in play when the trigger resolves, so it can pick itself", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  answerPick(engine, P1, [id("bird")]);
  assert.equal(engine.getStat(id("bird"), "strength"), 2);
  assert.equal(engine.getStat(id("bird"), "life"), 3);
});

clause(OSPREY, "1:rule", "it is optional: picking nothing changes no stats and does not stop the Osprey entering play", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  answerPick(engine, P1, []);
  assert.equal(engine.state.cards[id("bird")].zone, "play");
  for (const [key, strength, life] of [["mine", 2, 3], ["foe", 2, 3], ["bird", 1, 2]] as const) {
    assert.equal(engine.getStat(id(key), "strength"), strength, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), life, `${key} life`);
  }
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(OSPREY, "1:rule", "only a character can be picked: an item, a location, a face-down card, a faction and a second character are refused", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  const attempt = (selected: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);
  assert.throws(attempt([id("thing")]), "an item");
  assert.throws(attempt([id("place")]), "a location");
  assert.throws(attempt([id("faceDown")]), "a face-down card");
  assert.throws(attempt([engine.state.players[P2].factionId!]), "a faction");
  assert.throws(attempt([id("mine"), id("foe")]), "'a character' means one");
  attempt([id("mine")])();
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "a single character is accepted");
});

clause(OSPREY, "1:rule", "the bonus lasts this turn only: gone at the start of the next turn", () => {
  const { engine, id } = ospreyBoard();
  play(engine, P1, id("bird"));
  answerPick(engine, P1, [id("mine")]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "back to printed strength");
  assert.equal(engine.getStat(id("mine"), "life"), 3, "back to printed life");
});

clause(OSPREY, "1:rule", "the extra life is real: a character that would die to 3 damage survives it with +1 life", () => {
  const board = ospreyBoard({ extra: [{ key: "zap3", def: zapTactic(3, "Zap3"), owner: P1, zone: "hand" }] });
  const { engine, id } = board;
  play(engine, P1, id("bird"));
  answerPick(engine, P1, [id("foe")]);
  play(engine, P1, id("zap3"), { selected: { t: [id("foe")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "play", "life 3 + 1 = 4 survives 3 damage");
  assert.equal(engine.state.cards[id("foe")].damage, 3);
});

clause(OSPREY, "1:rule", "triggers only when the Osprey itself enters play: another card entering play does not offer a pick", () => {
  const { engine, id } = ospreyBoard({ extra: [{ key: "bird2", def: printing(OSPREY), owner: P1, zone: "play" }] });
  play(engine, P1, id("plain"));
  assert.equal(engine.state.cards[id("plain")].zone, "play");
  assert.equal(engine.state.pendingChoice, undefined, "the Osprey already in play did not trigger on another card entering");
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
});

clause(OSPREY, "1:rule", "triggers when it is put into play by an effect, not only when deployed", () => {
  const fetch = tactic({
    name: "Fetch",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "fetch",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", type: "character", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = ospreyBoard({ extra: [{ key: "fetch", def: fetch, owner: P1, zone: "hand" }] });
  play(engine, P1, id("fetch"), { selected: { t: [id("bird")] } });
  assert.equal(engine.state.cards[id("bird")].zone, "play");
  answerPick(engine, P1, [id("mine")]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "its enters-play ability still fires");
});

// --- Swashbuckler ----------------------------------------------------------
// When this card enters play, you may remove 4 cards in your opponent's
// discard pile from the game. If you don't, destroy this card.
// Character (pirate), cost 4, threshold [D][D], 4 strength / 4 speed / 4 life.

const SWASH = "ae5a510d-db82-4c4f-83b5-eb2878145280";

function swashBoard(opts: { oppDiscard?: number; myDiscard?: number; deception?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sw", def: printing(SWASH), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...fillers("od", opts.oppDiscard ?? 6, P2, "discard"),
      ...fillers("md", opts.myDiscard ?? 6, P1, "discard"),
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

/** Deploys the Swashbuckler and returns the first pending choice. */
function swashEnter(board: ReturnType<typeof swashBoard>) {
  play(board.engine, P1, board.id("sw"));
  return board.engine.state.pendingChoice as unknown as { kind: string; playerId: string; [k: string]: unknown } | undefined;
}

/** Chooses the "remove" half (option 0) and then the given discard-pile cards. */
function swashRemove(board: ReturnType<typeof swashBoard>, keys: string[]) {
  const { engine, id } = board;
  const first = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(first.kind, "chooserSelectsOption");
  engine.perform({ type: "resolvePendingChoice", playerId: first.playerId, choice: { kind: "chooserSelectsOption", index: 0 } } as never);
  resolvePendingResponses(engine);
  if (engine.state.pendingChoice) {
    const second = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.equal(second.kind, "chooserSelectsTarget");
    engine.perform({ type: "resolvePendingChoice", playerId: second.playerId, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
    resolvePendingResponses(engine);
  }
}

clause(SWASH, "0:rule", "deploys for its printed cost of 4 with [D][D] and has 4 strength / 4 speed / 4 life", () => {
  const board = swashBoard();
  const { engine, id } = board;
  const before = ready(engine);
  swashEnter(board);
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(engine.getStat(id("sw"), "strength"), 4);
  assert.equal(engine.getStat(id("sw"), "speed"), 4);
  assert.equal(engine.getStat(id("sw"), "life"), 4);
  assert.ok(engine.getSubtypes(id("sw")).includes("pirate"), "engine.getSubtypes(id(\"sw\")).includes(\"pirate\")");
  const short = swashBoard({ deception: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sw")), "one resource short");
  const oneD = swashBoard({ deception: 1, greed: 6 });
  assert.throws(() => playRaw(oneD.engine, P1, oneD.id("sw")), "only one [D]");
});

clause(SWASH, "0:rule", "you may remove 4 cards from the opponent's discard pile: exactly the 4 you choose are removed from the game and the Swashbuckler stays", () => {
  const board = swashBoard({ oppDiscard: 7 });
  const { engine, id } = board;
  const first = swashEnter(board);
  assert.equal(first?.kind, "chooserSelectsOption", "the controller is offered the choice");
  assert.equal(first?.playerId, P1, "its controller decides");
  const chosen = ["od1", "od3", "od4", "od6"];
  swashRemove(board, chosen);
  for (const key of chosen) assert.equal(engine.state.cards[id(key)].zone, "removed", `${key} is removed from the game`);
  for (const key of ["od0", "od2", "od5"]) assert.equal(engine.state.cards[id(key)].zone, "discard", `${key} stays in the discard pile`);
  assert.equal(engine.state.cards[id("sw")].zone, "play", "removing the cards means the Swashbuckler is not destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SWASH, "0:rule", "with exactly 4 cards in the opponent's discard pile all 4 can be removed", () => {
  const board = swashBoard({ oppDiscard: 4 });
  const { engine, id } = board;
  swashEnter(board);
  swashRemove(board, ["od0", "od1", "od2", "od3"]);
  for (const key of ["od0", "od1", "od2", "od3"]) assert.equal(engine.state.cards[id(key)].zone, "removed");
  assert.equal(engine.state.cards[id("sw")].zone, "play");
});

clause(SWASH, "0:rule", "only the opponent's discard pile can be used: your own discarded cards cannot be removed instead", () => {
  const board = swashBoard({ oppDiscard: 6, myDiscard: 6 });
  const { engine, id } = board;
  swashEnter(board);
  const first = engine.state.pendingChoice as unknown as { playerId: string };
  engine.perform({ type: "resolvePendingChoice", playerId: first.playerId, choice: { kind: "chooserSelectsOption", index: 0 } } as never);
  resolvePendingResponses(engine);
  const attempt = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  assert.throws(attempt(["md0", "md1", "md2", "md3"]), "four of my own discarded cards");
  assert.throws(attempt(["od0", "od1", "od2", "md0"]), "three of theirs and one of mine");
  attempt(["od0", "od1", "od2", "od3"])();
  assert.equal(engine.state.cards[id("md0")].zone, "discard", "my own discard pile is untouched");
  assert.equal(engine.state.cards[id("od0")].zone, "removed");
});

clause(SWASH, "0:rule", "must be exactly 4 cards: 3 or 5 cannot be chosen for the removal", () => {
  const board = swashBoard({ oppDiscard: 7 });
  const { engine, id } = board;
  swashEnter(board);
  const first = engine.state.pendingChoice as unknown as { playerId: string };
  engine.perform({ type: "resolvePendingChoice", playerId: first.playerId, choice: { kind: "chooserSelectsOption", index: 0 } } as never);
  resolvePendingResponses(engine);
  const attempt = (keys: string[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map(id) } } as never);
  assert.throws(attempt(["od0", "od1", "od2"]), "three cards is not 4");
  assert.throws(attempt(["od0", "od1", "od2", "od3", "od4"]), "five cards is not 4");
  assert.throws(attempt(["od0", "od0", "od1", "od2"]), "the same card twice");
  assert.equal(engine.state.cards[id("od0")].zone, "discard", "nothing was removed by the refused answers");
});

clause(SWASH, "0:rule", "if you don't remove the cards, the Swashbuckler is destroyed and the opponent's discard pile is untouched", () => {
  const board = swashBoard({ oppDiscard: 7 });
  const { engine, id } = board;
  const first = swashEnter(board);
  assert.equal(first?.kind, "chooserSelectsOption");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 1 } } as never);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("sw")].zone, "discard", "destroyed");
  assert.equal(engine.state.players[P1].discard.includes(id("sw")), true, "into its owner's discard pile");
  for (let i = 0; i < 7; i++) assert.equal(engine.state.cards[id(`od${i}`)].zone, "discard", `od${i} stays`);
  assert.equal(engine.state.cards[id("mine")].zone, "play", "other cards are untouched");
});

clause(SWASH, "0:rule", "with fewer than 4 cards in the opponent's discard pile you cannot remove 4, so it is destroyed and no cards are removed", () => {
  for (const count of [3, 0]) {
    const board = swashBoard({ oppDiscard: count });
    const { engine, id } = board;
    swashEnter(board);
    drain(engine, (pc) => {
      if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: 0 };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: Array.from({ length: count }, (_, i) => id(`od${i}`)) };
      return declineAll(pc);
    });
    assert.equal(engine.state.cards[id("sw")].zone, "discard", `${count} cards: the Swashbuckler is destroyed`);
    for (let i = 0; i < count; i++) assert.equal(engine.state.cards[id(`od${i}`)].zone, "discard", `${count} cards: od${i} was not removed (fewer than 4 cannot be removed)`);
  }
});

clause(SWASH, "0:rule", "does not trigger when another card enters play, and a Swashbuckler already in play is not destroyed by it", () => {
  const board = swashBoard({ oppDiscard: 7 });
  const { engine, id } = board;
  swashEnter(board);
  swashRemove(board, ["od0", "od1", "od2", "od3"]);
  assert.equal(engine.state.cards[id("sw")].zone, "play");
  play(engine, P1, id("plain"));
  assert.equal(engine.state.pendingChoice, undefined, "no new prompt");
  assert.equal(engine.state.cards[id("sw")].zone, "play");
  for (const key of ["od4", "od5", "od6"]) assert.equal(engine.state.cards[id(key)].zone, "discard");
});

clause(SWASH, "0:rule", "the trigger also happens when it is put into play by an effect, not only when deployed", () => {
  const fetch = tactic({
    name: "Fetch",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "fetch",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", type: "character", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fetch", def: fetch, owner: P1, zone: "hand" },
      { key: "sw", def: printing(SWASH), owner: P1, zone: "hand" },
      ...fillers("od", 5, P2, "discard")
    ]
  });
  play(board.engine, P1, board.id("fetch"), { selected: { t: [board.id("sw")] } });
  assert.equal(board.engine.state.cards[board.id("sw")].zone, "play");
  const pc = board.engine.state.pendingChoice as unknown as { kind: string } | undefined;
  assert.equal(pc?.kind, "chooserSelectsOption", "its enters-play ability still asks");
  board.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 1 } } as never);
  resolvePendingResponses(board.engine);
  assert.equal(board.engine.state.cards[board.id("sw")].zone, "discard", "declining destroys it");
});

// --- The Billionaire ------------------------------------------------------
// UNIQUE PLUCK. You may use abilities on your opponent's cards as though you
// were your opponent. (The effect still happens to your opponent.)
// CHANGE COSTUME -- COST: Pay 3, shuffle this card into its owner's deck. --
// EFFECT: Search your deck for a "pluck" card with a different name than this
// card and put it into play. Character (pluck, grifter), cost 5, [D][D][D][D],
// 2 strength / 4 speed / 3 life.

const BILL = "2ec131a8-26eb-4dd7-914d-ced1ca9e770c";

/** An opponent's character with three borrowable abilities: a numeric cost, a deplete cost, and one that names "an opponent's character". */
const FOUNTAIN = character({
  name: "Fountain",
  behavior: {
    abilities: [
      { id: "gush", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] },
      { id: "sip", type: "activated", costs: [{ type: "deplete", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] },
      {
        id: "ping",
        type: "activated",
        targets: [{ id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }],
        effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
      }
    ]
  }
});

const pluckChar = (name: string, over: Partial<CardDefinition> = {}) => character({ name, subtype: ["pluck"], ...over });

function billBoard(opts: { billIn?: "play" | "hand" | "none"; p1Res?: number; p2Res?: number; extra?: CardPlacement[]; random?: () => number; billOwner?: Seat } = {}) {
  const billIn = opts.billIn ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    cards: [
      ...(billIn === "none" ? [] : [{ key: "bill", def: printing(BILL), owner: opts.billOwner ?? P1, controller: P1, zone: billIn } as CardPlacement]),
      { key: "fountain", def: FOUNTAIN, owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      ...fillers("a", 4, P1, "deck"),
      ...fillers("b", 4, P2, "deck"),
      ...bank("deception", opts.p1Res ?? 9, P1),
      ...bank("rage", opts.p2Res ?? 3, P2),
      ...(opts.extra ?? [])
    ]
  });
}

// --- 0:unique ---

function billDuplicateBoard(second: "hand-bill" | "hand-twin" | "hand-other" | "opp-bill") {
  const secondDef = second === "hand-twin" ? pluckChar("Twin", { unique: "pluck", cost: 0 }) : second === "hand-other" ? pluckChar("Other", { unique: "someone-else", cost: 0 }) : printing(BILL);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: second === "opp-bill" ? 2 : 1,
    activePlayerId: second === "opp-bill" ? P2 : P1,
    cards: [
      { key: "bill", def: printing(BILL), owner: P1, zone: "play" },
      { key: "second", def: secondDef, owner: second === "opp-bill" ? P2 : P1, zone: second === "opp-bill" ? "hand" : "hand" },
      ...bank("deception", 9, P1),
      ...bank("deception", 9, P2)
    ]
  });
}

clause(BILL, "0:unique", "playing a second Billionaire makes you keep one: keeping the new one destroys the old one", () => {
  const { engine, id } = billDuplicateBoard("hand-bill");
  play(engine, P1, id("second"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [id("bill"), id("second")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("second") } } as never);
  assert.equal(engine.state.cards[id("second")].zone, "play");
  assert.equal(engine.state.cards[id("bill")].zone, "discard", "the other copy is destroyed");
});

clause(BILL, "0:unique", "keeping the old Billionaire destroys the new one", () => {
  const { engine, id } = billDuplicateBoard("hand-bill");
  play(engine, P1, id("second"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("bill") } } as never);
  assert.equal(engine.state.cards[id("bill")].zone, "play");
  assert.equal(engine.state.cards[id("second")].zone, "discard");
});

clause(BILL, "0:unique", "any other card with the UNIQUE PLUCK designation counts as a duplicate, whatever its name", () => {
  const { engine, id } = billDuplicateBoard("hand-twin");
  play(engine, P1, id("second"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; candidates: string[]; unique: string };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc.unique, "pluck");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("bill") } } as never);
  assert.equal(engine.state.cards[id("bill")].zone, "play");
  assert.equal(engine.state.cards[id("second")].zone, "discard");
});

clause(BILL, "0:unique", "a card with a different UNIQUE designation is not a duplicate", () => {
  const { engine, id } = billDuplicateBoard("hand-other");
  play(engine, P1, id("second"));
  assert.equal(engine.state.pendingChoice, undefined, "no choice");
  assert.equal(engine.state.cards[id("bill")].zone, "play");
  assert.equal(engine.state.cards[id("second")].zone, "play");
});

clause(BILL, "0:unique", "the restriction is per player: the opponent may control their own Billionaire", () => {
  const { engine, id } = billDuplicateBoard("opp-bill");
  play(engine, P2, id("second"));
  assert.equal(engine.state.pendingChoice, undefined, "no choice for either player");
  assert.equal(engine.state.cards[id("bill")].zone, "play");
  assert.equal(engine.state.cards[id("second")].zone, "play");
});

clause(BILL, "0:unique", "deploys for its printed cost of 5 with [D][D][D][D] and has its printed 2 strength / 4 speed / 3 life", () => {
  const ok = billBoard({ billIn: "hand", p1Res: 5 });
  play(ok.engine, P1, ok.id("bill"));
  assert.equal(ok.engine.state.cards[ok.id("bill")].zone, "play");
  assert.equal(ready(ok.engine), 0, "all five resources were spent");
  assert.equal(ok.engine.getStat(ok.id("bill"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("bill"), "speed"), 4);
  assert.equal(ok.engine.getStat(ok.id("bill"), "life"), 3);
  assert.ok(ok.engine.getSubtypes(ok.id("bill")).includes("pluck"), "ok.engine.getSubtypes(ok.id(\"bill\")).includes(\"pluck\")");
  assert.ok(ok.engine.getSubtypes(ok.id("bill")).includes("grifter"), "ok.engine.getSubtypes(ok.id(\"bill\")).includes(\"grifter\")");
  const short = billBoard({ billIn: "hand", p1Res: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("bill")), "one resource short");
  const threeD = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "bill", def: printing(BILL), owner: P1, zone: "hand" }, ...bank("deception", 3, P1), ...bank("greed", 4, P1)]
  });
  assert.throws(() => playRaw(threeD.engine, P1, threeD.id("bill")), "only three [D]");
});

// --- 1:rule ---

clause(BILL, "1:rule", "you can use an ability on your opponent's card: the effect happens to the opponent (they draw, you do not)", () => {
  const { engine, id } = billBoard();
  const p1Hand = engine.state.players[P1].hand.length;
  const p2Hand = engine.state.players[P2].hand.length;
  const p2Top = engine.state.players[P2].deck[0];
  activate(engine, P1, id("fountain"), "gush");
  assert.equal(engine.state.players[P2].hand.length, p2Hand + 1, "your opponent draws");
  assert.equal(engine.state.cards[p2Top].zone, "hand");
  assert.equal(engine.state.players[P2].hand.includes(p2Top), true);
  assert.equal(engine.state.players[P1].hand.length, p1Hand, "you do not");
});

clause(BILL, "1:rule", "used 'as though you were your opponent', its numeric cost is paid out of the opponent's resources, not yours", () => {
  const { engine, id } = billBoard({ p1Res: 9, p2Res: 3 });
  const p1Before = ready(engine, P1);
  const p2Before = ready(engine, P2);
  activate(engine, P1, id("fountain"), "gush");
  assert.equal(p2Before - ready(engine, P2), 2, "the opponent's resources pay the cost of 2");
  assert.equal(p1Before - ready(engine, P1), 0, "yours are untouched");
});

clause(BILL, "1:rule", "if the opponent could not pay the cost it cannot be used, however many resources you have", () => {
  const { engine, id } = billBoard({ p1Res: 9, p2Res: 1 });
  assert.throws(() => activateRaw(engine, P1, id("fountain"), "gush"));
  assert.equal(ready(engine, P1), 9);
  assert.equal(ready(engine, P2), 1);
  assert.equal(engine.state.players[P2].hand.length, 0);
});

clause(BILL, "1:rule", "a non-numeric cost (deplete this card) is paid by the opponent's card, and then the opponent draws", () => {
  const { engine, id } = billBoard();
  const p1Hand = engine.state.players[P1].hand.length;
  activate(engine, P1, id("fountain"), "sip");
  assert.equal(engine.state.cards[id("fountain")].depleted, true, "the opponent's card is depleted");
  assert.equal(engine.state.players[P2].hand.length, 1, "the opponent draws");
  assert.equal(engine.state.players[P1].hand.length, p1Hand);
  assert.throws(() => activateRaw(engine, P1, id("fountain"), "sip"), "it is depleted now, so the cost cannot be paid again");
});

clause(BILL, "1:rule", "'your opponent' inside the borrowed ability means the opponent's opponent, you: it picks among YOUR characters", () => {
  const { engine, id } = billBoard({ extra: [{ key: "theirs", def: character({ name: "Theirs", life: 5 }), owner: P2, zone: "play" }] });
  assert.throws(() => activateRaw(engine, P1, id("fountain"), "ping", { t: [id("theirs")] }), "the opponent's own characters are not 'an opponent's character' for the opponent");
  activate(engine, P1, id("fountain"), "ping", { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].damage, 1, "your own character took the damage");
  assert.equal(engine.state.cards[id("theirs")].damage, 0);
});

clause(BILL, "1:rule", "without a Billionaire in play you cannot use the opponent's abilities", () => {
  const { engine, id } = billBoard({ billIn: "none" });
  assert.throws(() => activateRaw(engine, P1, id("fountain"), "gush"));
  assert.throws(() => activateRaw(engine, P1, id("fountain"), "sip"));
  assert.equal(engine.state.players[P2].hand.length, 0);
});

clause(BILL, "1:rule", "a Billionaire in your hand does not give you the power; it must be in play", () => {
  const { engine, id } = billBoard({ billIn: "hand" });
  assert.throws(() => activateRaw(engine, P1, id("fountain"), "gush"));
});

clause(BILL, "1:rule", "once the Billionaire leaves play you can no longer use the opponent's abilities", () => {
  const { engine, id } = billBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  activate(engine, P1, id("fountain"), "gush");
  assert.equal(engine.state.players[P2].hand.length, 1, "works while it is in play");
  play(engine, P1, id("kill"), { selected: { t: [id("bill")] } });
  assert.equal(engine.state.cards[id("bill")].zone, "discard");
  assert.throws(() => activateRaw(engine, P1, id("fountain"), "gush"), "no longer");
});

clause(BILL, "1:rule", "it only works for the Billionaire's controller: the opponent cannot use YOUR abilities", () => {
  const mineWithAbility = character({ name: "MyFountain", behavior: { abilities: [{ id: "gush", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const { engine, id } = billBoard({ extra: [{ key: "myf", def: mineWithAbility, owner: P1, zone: "play" }] });
  assert.throws(() => activateRaw(engine, P2, id("myf"), "gush"), "P2 has no Billionaire");
  activate(engine, P1, id("myf"), "gush");
  assert.equal(engine.state.players[P1].hand.length, 1, "control: you can use your own ability as normal");
});

clause(BILL, "1:rule", "it works in the other direction too when the opponent controls the Billionaire (they may use YOUR cards' abilities)", () => {
  const mineWithAbility = character({ name: "MyFountain", behavior: { abilities: [{ id: "gush", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "bill", def: printing(BILL), owner: P2, zone: "play" },
      { key: "myf", def: mineWithAbility, owner: P1, zone: "play" },
      ...fillers("a", 3, P1, "deck")
    ]
  });
  activate(engine, P2, id("myf"), "gush");
  assert.equal(engine.state.players[P1].hand.length, 1, "the effect happens to the Billionaire's opponent (P1 draws)");
  assert.equal(engine.state.players[P2].hand.length, 0);
});

clause(BILL, "1:rule", "also reaches abilities printed on the opponent's faction card", () => {
  const faction = factionWithDrawAbility();
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction },
    cards: [
      { key: "bill", def: printing(BILL), owner: P1, zone: "play" },
      ...fillers("b", 3, P2, "deck"),
      ...bank("rage", 2, P2),
      ...bank("deception", 4, P1)
    ]
  });
  const factionId = engine.state.players[P2].factionId!;
  activate(engine, P1, factionId, "faction-draw");
  assert.equal(engine.state.players[P2].hand.length, 1, "the opponent draws from their faction's ability");
  assert.equal(engine.state.players[P1].hand.length, 0);
  assert.equal(ready(engine, P2), 1, "paid with the opponent's resources");
  assert.equal(ready(engine, P1), 4);
  void id;
});

function factionWithDrawAbility(): CardDefinition {
  const base = developFaction();
  return {
    ...base,
    id: "ob7-faction-with-ability",
    name: "Drawing Faction",
    faction: {
      ...base.faction!,
      abilities: [{ id: "faction-draw", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  };
}

// --- 2:ability:costume ---

function costumeBoard(opts: { res?: number; greed?: number; random?: () => number; billOwner?: Seat; extra?: CardPlacement[] } = {}) {
  return billBoard({
    p1Res: opts.res ?? 3,
    random: opts.random,
    billOwner: opts.billOwner,
    extra: [
      { key: "alt", def: pluckChar("AltPluck"), owner: P1, zone: "deck" },
      { key: "alt2", def: pluckChar("AltTwo"), owner: P1, zone: "deck" },
      { key: "plain", def: character({ name: "PlainGuy" }), owner: P1, zone: "deck" },
      { key: "bill2", def: printing(BILL), owner: P1, zone: "deck" },
      { key: "twin", def: pluckChar("TwinPluck", { unique: "pluck" }), owner: P1, zone: "deck" },
      { key: "oppPluck", def: pluckChar("OppPluck"), owner: P2, zone: "deck" },
      { key: "handPluck", def: pluckChar("HandPluck"), owner: P1, zone: "hand" },
      { key: "discPluck", def: pluckChar("DiscPluck"), owner: P1, zone: "discard" },
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(BILL, "2:ability:costume", "pays 3 and shuffles the Billionaire into its owner's deck as the cost, before anyone can respond", () => {
  const { engine, id } = costumeBoard();
  const before = ready(engine);
  const deckBefore = engine.state.players[P1].deck.length;
  activateRaw(engine, P1, id("bill"), "costume");
  assert.equal(before - ready(engine), 3, "COST: pay 3, paid on activation");
  assert.equal(engine.state.cards[id("bill")].zone, "deck", "COST: shuffle this card into its owner's deck, already done on activation");
  assert.equal(engine.state.players[P1].deck.length, deckBefore + 1);
  assert.ok(engine.state.players[P1].deck.includes(id("bill")), "engine.state.players[P1].deck.includes(id(\"bill\"))");
});

clause(BILL, "2:ability:costume", "the Billionaire is already gone when the opponent gets to respond, so a response cannot destroy it", () => {
  const { engine, id } = costumeBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  activateRaw(engine, P1, id("bill"), "costume");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.throws(() => playRaw(engine, P2, id("kill"), { selected: { t: [id("bill")] } }), "the Billionaire left play as a cost, so it is not a legal target");
  assert.equal(engine.state.cards[id("kill")].zone, "hand");
});

clause(BILL, "2:ability:costume", "then you search your deck for a pluck card with a different name and put it into play under your control", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("bill"), "costume");
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "you search");
  pickWith(engine, () => [id("alt")]);
  assert.equal(engine.state.cards[id("alt")].zone, "play", "put into play");
  assert.equal(engine.state.cards[id("alt")].controllerId, P1);
  assert.equal(engine.state.cards[id("alt2")].zone, "deck", "only one card is fetched");
  assert.equal(engine.state.cards[id("bill")].zone, "deck", "the Billionaire stays in the deck");
  assert.equal(engine.state.pendingChoice, undefined, "no unique conflict: the Billionaire is gone");
});

clause(BILL, "2:ability:costume", "only a pluck card can be found: a non-pluck card, the opponent's deck, your hand and your discard pile are refused", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("bill"), "costume");
  const attempt = (key: string) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } } as never);
  assert.throws(attempt("plain"), "a card that is not a pluck");
  assert.throws(attempt("oppPluck"), "a pluck in the OPPONENT's deck");
  assert.throws(attempt("handPluck"), "a pluck in your hand");
  assert.throws(attempt("discPluck"), "a pluck in your discard pile");
  attempt("alt2")();
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("alt2")].zone, "play");
});

clause(BILL, "2:ability:costume", "the pluck card must have a different name than the Billionaire: another Billionaire is refused", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("bill"), "costume");
  const attempt = (key: string) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } } as never);
  assert.throws(attempt("bill2"), "a second Billionaire has the same name");
  assert.throws(attempt("bill"), "the shuffled-in Billionaire itself");
  attempt("alt")();
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("alt")].zone, "play");
});

clause(BILL, "2:ability:costume", "only one card is found: asking for two is refused", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("bill"), "costume");
  assert.throws(() =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("alt"), id("alt2")] } } as never)
  );
});

clause(BILL, "2:ability:costume", "a search with criteria may find nothing (CR 312.2): the cost is still paid and the Billionaire is in the deck", () => {
  const { engine, id } = costumeBoard();
  const before = ready(engine);
  activate(engine, P1, id("bill"), "costume");
  pickWith(engine, () => []);
  assert.equal(before - ready(engine), 3);
  assert.equal(engine.state.cards[id("bill")].zone, "deck");
  for (const key of ["alt", "alt2", "twin"]) assert.equal(engine.state.cards[id(key)].zone, "deck", `${key} stays in the deck`);
});

clause(BILL, "2:ability:costume", "with no eligible pluck in the deck it still costs 3 and shuffles the Billionaire away", () => {
  const { engine, id } = billBoard({ p1Res: 3 });
  const before = ready(engine);
  activate(engine, P1, id("bill"), "costume");
  drain(engine, declineAll);
  assert.equal(before - ready(engine), 3);
  assert.equal(engine.state.cards[id("bill")].zone, "deck");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(BILL, "2:ability:costume", "a found card with the same UNIQUE PLUCK designation can enter play because the Billionaire has already left", () => {
  const { engine, id } = costumeBoard();
  activate(engine, P1, id("bill"), "costume");
  pickWith(engine, () => [id("twin")]);
  assert.equal(engine.state.cards[id("twin")].zone, "play");
  assert.equal(engine.state.pendingChoice, undefined, "no 'keep one' choice: the Billionaire was shuffled away as the cost");
  assert.equal(engine.state.cards[id("bill")].zone, "deck");
});

clause(BILL, "2:ability:costume", "the Billionaire goes into its OWNER's deck: one you control but the opponent owns goes into the opponent's deck", () => {
  const { engine, id } = costumeBoard({ billOwner: P2 });
  activate(engine, P1, id("bill"), "costume");
  pickWith(engine, () => []);
  assert.equal(engine.state.cards[id("bill")].zone, "deck");
  assert.ok(engine.state.players[P2].deck.includes(id("bill")), "the owner's deck");
  assert.equal(engine.state.players[P1].deck.includes(id("bill")), false);
});

clause(BILL, "2:ability:costume", "the deck is shuffled: two different random streams leave the deck in different orders", () => {
  const run = (random: () => number) => {
    const { engine, id } = costumeBoard({ random });
    activate(engine, P1, id("bill"), "costume");
    pickWith(engine, () => []);
    return engine.state.players[P1].deck.map((cardId) => engine.getDefinition(cardId).name);
  };
  const low = run(() => 0.01);
  const high = run(() => 0.99);
  assert.deepEqual([...low].sort(), [...high].sort(), "same cards");
  assert.notDeepEqual(low, high, "the order depends on the random stream, so the deck was shuffled");
});

clause(BILL, "2:ability:costume", "is refused one resource short of its cost of 3 and nothing moves; it needs no threshold", () => {
  const short = costumeBoard({ res: 2 });
  assert.throws(() => activateRaw(short.engine, P1, short.id("bill"), "costume"));
  assert.equal(short.engine.state.cards[short.id("bill")].zone, "play", "the Billionaire stays");
  assert.equal(ready(short.engine), 2);

  const greedOnly = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bill", def: printing(BILL), owner: P1, zone: "play" },
      { key: "alt", def: pluckChar("AltPluck"), owner: P1, zone: "deck" },
      ...bank("greed", 3, P1)
    ]
  });
  activate(greedOnly.engine, P1, greedOnly.id("bill"), "costume");
  pickWith(greedOnly.engine, () => [greedOnly.id("alt")]);
  assert.equal(greedOnly.engine.state.cards[greedOnly.id("alt")].zone, "play", "three resources of any kind are enough");
});

clause(BILL, "2:ability:costume", "only the Billionaire's controller can use it", () => {
  const { engine, id } = costumeBoard();
  assert.throws(() => activateRaw(engine, P2, id("bill"), "costume"));
  assert.equal(engine.state.cards[id("bill")].zone, "play");
});

clause(BILL, "2:ability:costume", "can be used the turn the Billionaire enters play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bill", def: printing(BILL), owner: P1, zone: "play", attackEligible: false },
      { key: "alt", def: pluckChar("AltPluck"), owner: P1, zone: "deck" },
      ...bank("greed", 3, P1)
    ]
  });
  activate(engine, P1, id("bill"), "costume");
  pickWith(engine, () => [id("alt")]);
  assert.equal(engine.state.cards[id("alt")].zone, "play");
});

// --- Thief Doyen -----------------------------------------------------------
// COST: Discard a character or item. X is that card's cost. -- This card
// enters play with X tokens on it. -- This card gains 1 strength and 1 life
// for each token on it. Character (thief), cost 4, threshold [D][D],
// 0 strength / 3 speed / 0 life.

const DOYEN = "6b686959-405f-4648-a0ea-cb6d88c96bbe";

function doyenBoard(opts: { deception?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "doyen", def: printing(DOYEN), owner: P1, zone: "hand" },
      { key: "fuel3", def: character({ name: "Fuel3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "fuel5", def: item({ name: "Fuel5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "fuel0", def: character({ name: "Fuel0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "fuel1", def: item({ name: "Fuel1", cost: 1 }), owner: P1, zone: "hand" },
      { key: "spell", def: tactic({ name: "Spell", cost: 2 }), owner: P1, zone: "hand" },
      { key: "place", def: location({ name: "Place", cost: 2 }), owner: P1, zone: "hand" },
      { key: "inPlay", def: character({ name: "InPlay", cost: 2 }), owner: P1, zone: "play" },
      { key: "inDeck", def: character({ name: "InDeck", cost: 2 }), owner: P1, zone: "deck" },
      { key: "theirs", def: character({ name: "Theirs", cost: 2 }), owner: P2, zone: "hand" },
      ...bank("deception", opts.deception ?? 9, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const doyenPlay = (board: ReturnType<typeof doyenBoard>, fuel: string) => play(board.engine, P1, board.id("doyen"), { selected: { d: [board.id(fuel)] } });

clause(DOYEN, "0:ability", "discards the chosen character from your hand (to your discard pile) and the Doyen's own cost of 4 is paid", () => {
  const board = doyenBoard();
  const { engine, id } = board;
  const before = ready(engine);
  doyenPlay(board, "fuel3");
  assert.equal(engine.state.cards[id("fuel3")].zone, "discard", "the discarded character");
  assert.equal(engine.state.players[P1].discard.includes(id("fuel3")), true);
  assert.equal(engine.state.cards[id("doyen")].zone, "play");
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid; the discarded card is not paid for with resources");
  for (const key of ["fuel5", "fuel0", "fuel1", "spell", "place"]) assert.equal(engine.state.cards[id(key)].zone, "hand", `${key} stays in hand`);
});

clause(DOYEN, "0:ability", "an item can be discarded too", () => {
  const board = doyenBoard();
  doyenPlay(board, "fuel5");
  assert.equal(board.engine.state.cards[board.id("fuel5")].zone, "discard");
  assert.equal(board.engine.state.cards[board.id("doyen")].zone, "play");
});

clause(DOYEN, "0:ability", "only a character or an item in your hand can be discarded: a tactic, a location, a card in play, in your deck or in the opponent's hand are refused", () => {
  const board = doyenBoard();
  const { engine, id } = board;
  const attempt = (key: string) => () => playRaw(engine, P1, id("doyen"), { selected: { d: [id(key)] } });
  assert.throws(attempt("spell"), "a tactic");
  assert.throws(attempt("place"), "a location");
  assert.throws(attempt("inPlay"), "a character in play (that would be destroying, not discarding)");
  assert.throws(attempt("inDeck"), "a card in the deck");
  assert.throws(attempt("theirs"), "a card in the opponent's hand");
  assert.throws(() => playRaw(engine, P1, id("doyen"), { selected: {} }), "no card chosen: the cost cannot be paid");
  assert.throws(() => playRaw(engine, P1, id("doyen"), { selected: { d: [id("fuel3"), id("fuel5")] } }), "exactly one card");
  assert.equal(engine.state.cards[id("doyen")].zone, "hand", "nothing was played");
  attempt("fuel1")();
  assert.ok(engine.state.responseWindow, "a character or item in hand is accepted");
});

clause(DOYEN, "0:ability", "is refused with nothing to discard", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "doyen", def: printing(DOYEN), owner: P1, zone: "hand" }, ...bank("deception", 9, P1)]
  });
  assert.throws(() => playRaw(engine, P1, id("doyen"), { selected: {} }));
  assert.equal(engine.state.cards[id("doyen")].zone, "hand");
});

clause(DOYEN, "0:ability", "is refused one resource short of its cost of 4, and without [D][D]", () => {
  const short = doyenBoard({ deception: 3 });
  assert.throws(() => playRaw(short.engine, P1, short.id("doyen"), { selected: { d: [short.id("fuel3")] } }));
  assert.equal(short.engine.state.cards[short.id("fuel3")].zone, "hand", "nothing is discarded by a refused play");
  const oneD = doyenBoard({ deception: 1, greed: 6 });
  assert.throws(() => playRaw(oneD.engine, P1, oneD.id("doyen"), { selected: { d: [oneD.id("fuel3")] } }), "only one [D]");
  const exact = doyenBoard({ deception: 4 });
  doyenPlay(exact, "fuel3");
  assert.equal(exact.engine.state.cards[exact.id("doyen")].zone, "play", "[D][D] and exactly 4 resources is enough");
});

clause(DOYEN, "0:ability", "the discard is part of the cost: the chosen card is already in the discard pile when the opponent can respond", () => {
  const { engine, id } = doyenBoard();
  playRaw(engine, P1, id("doyen"), { selected: { d: [id("fuel3")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(engine.state.cards[id("fuel3")].zone, "discard", "COST: discard a character or item, paid when the card is played");
});

for (const [fuel, cost] of [
  ["fuel1", 1],
  ["fuel3", 3],
  ["fuel5", 5]
] as const) {
  clause(DOYEN, "1:rule", `discarding a ${cost}-cost card makes X = ${cost}: it enters play with exactly ${cost} tokens`, () => {
    const board = doyenBoard();
    doyenPlay(board, fuel);
    assert.equal(board.engine.state.cards[board.id("doyen")].zone, "play");
    assert.equal(board.engine.state.cards[board.id("doyen")].counters?.token, cost);
  });

  clause(DOYEN, "2:rule", `with ${cost} tokens it has ${cost} strength and ${cost} life (printed 0/0) and its printed speed 3`, () => {
    const board = doyenBoard();
    doyenPlay(board, fuel);
    assert.equal(board.engine.getStat(board.id("doyen"), "strength"), cost);
    assert.equal(board.engine.getStat(board.id("doyen"), "life"), cost);
    assert.equal(board.engine.getStat(board.id("doyen"), "speed"), 3, "speed gets no bonus");
  });
}

clause(DOYEN, "1:rule", "X is the discarded card's own cost, not what you paid: another card with the same cost gives the same X, and the Doyen's cost never counts", () => {
  const board = doyenBoard();
  doyenPlay(board, "fuel3");
  assert.equal(board.engine.state.cards[board.id("doyen")].counters?.token, 3, "X = 3, not 4 (the Doyen's cost) and not 7");
});

clause(DOYEN, "2:rule", "gains 1 strength and 1 life for each token on it, however the tokens got there", () => {
  for (const tokens of [1, 2, 6]) {
    const { engine, id } = buildGame({
      cards: [{ key: "doyen", def: printing(DOYEN), owner: P1, zone: "play", counters: { token: tokens } }]
    });
    assert.equal(engine.getStat(id("doyen"), "strength"), tokens, `${tokens} tokens: strength`);
    assert.equal(engine.getStat(id("doyen"), "life"), tokens, `${tokens} tokens: life`);
    assert.equal(engine.getStat(id("doyen"), "speed"), 3);
  }
});

clause(DOYEN, "2:rule", "the bonus follows the tokens: removing a token lowers it, and only tokens on THIS card count", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "doyen", def: printing(DOYEN), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "other", def: character({ name: "Other", strength: 1, life: 1 }), owner: P1, zone: "play", counters: { token: 5 } }
    ]
  });
  assert.equal(engine.getStat(id("doyen"), "strength"), 3);
  engine.state.cards[id("doyen")].counters = { token: 2 };
  assert.equal(engine.getStat(id("doyen"), "strength"), 2);
  assert.equal(engine.getStat(id("doyen"), "life"), 2);
  assert.equal(engine.getStat(id("other"), "strength"), 1, "tokens on another card do nothing for the Doyen, and the Doyen does nothing for it");
});

clause(DOYEN, "2:rule", "the extra life is real: a Doyen with 3 tokens survives 2 damage and dies to 3", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "doyen", def: printing(DOYEN), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "zap2", def: zapTactic(2, "Zap2"), owner: P1, zone: "hand" },
      { key: "zap1", def: zapTactic(1, "Zap1"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zap2"), { selected: { t: [id("doyen")] } });
  assert.equal(engine.state.cards[id("doyen")].zone, "play");
  play(engine, P1, id("zap1"), { selected: { t: [id("doyen")] } });
  assert.equal(engine.state.cards[id("doyen")].zone, "discard", "3 damage on life 3");
});

clause(DOYEN, "2:rule", "with X = 0 (a 0-cost card discarded) the Doyen has 0 life and 0 damage is already enough to destroy it", () => {
  const board = doyenBoard();
  doyenPlay(board, "fuel0");
  const doyen = board.engine.state.cards[board.id("doyen")];
  assert.equal(doyen.counters?.token ?? 0, 0, "X = 0 tokens");
  assert.equal(board.engine.getStat(board.id("doyen"), "life"), 0, "0 life");
  assert.equal(doyen.zone, "discard", "damage 0 >= life 0 (CR 204.5 / 408.4): destroyed as soon as it is in play");
});

clause(DOYEN, "2:rule", "a 0-life character that receives any damage is destroyed (1 damage >= 0 life)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "doyen", def: printing(DOYEN), owner: P1, zone: "play", counters: { token: 0 } },
      { key: "zap1", def: zapTactic(1, "Zap1"), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(engine.getStat(id("doyen"), "life"), 0);
  play(engine, P1, id("zap1"), { selected: { t: [id("doyen")] } });
  assert.equal(engine.state.cards[id("doyen")].zone, "discard", "1 damage on life 0");
});

// --- Tremor Engine ---------------------------------------------------------
// At the start of your turn, both players put the top 2 cards of their deck
// into their discard pile. Item, cost 2, threshold [D].

const TREMOR = "f58d1a64-ffe6-44e6-a0fb-7fee920c215d";

function tremorBoard(opts: { engines?: Array<{ owner: Seat; controller?: Seat }>; p1Deck?: number; p2Deck?: number; deception?: number; greed?: number; inHand?: boolean } = {}) {
  const engines = opts.engines ?? [{ owner: P1 }];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      ...engines.map((e, i) => ({ key: `te${i}`, def: printing(TREMOR), owner: e.owner, controller: e.controller, zone: opts.inHand ? ("hand" as const) : ("play" as const) }) as CardPlacement),
      ...fillers("a", opts.p1Deck ?? 6, P1, "deck"),
      ...fillers("b", opts.p2Deck ?? 6, P2, "deck"),
      { key: "p1h", def: character({ name: "P1Hand" }), owner: P1, zone: "hand" },
      { key: "p2h", def: character({ name: "P2Hand" }), owner: P2, zone: "hand" },
      { key: "p1d", def: character({ name: "P1Disc" }), owner: P1, zone: "discard" },
      { key: "p2d", def: character({ name: "P2Disc" }), owner: P2, zone: "discard" },
      ...bank("deception", opts.deception ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(TREMOR, "0:rule", "at the start of your turn BOTH players put exactly the top 2 cards of their deck into their own discard piles", () => {
  const { engine, id } = tremorBoard();
  const a = [...engine.state.players[P1].deck];
  const b = [...engine.state.players[P2].deck];
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "it is now your turn");
  assert.deepEqual(engine.state.players[P1].deck, a.slice(2), "your deck lost its top 2");
  assert.deepEqual(engine.state.players[P2].deck, b.slice(2), "their deck lost its top 2");
  for (const cardId of a.slice(0, 2)) assert.ok(engine.state.players[P1].discard.includes(cardId), "your top 2 are in your discard pile");
  for (const cardId of b.slice(0, 2)) assert.ok(engine.state.players[P2].discard.includes(cardId), "their top 2 are in their discard pile");
  assert.equal(engine.state.players[P1].discard.length, 3, "your old discard card plus 2");
  assert.equal(engine.state.players[P2].discard.length, 3);
  assert.equal(engine.state.cards[id("p1h")].zone, "hand", "hands are not touched");
  assert.equal(engine.state.cards[id("p2h")].zone, "hand");
  assert.equal(engine.state.cards[id("te0")].zone, "play");
});

clause(TREMOR, "0:rule", "does not happen at the start of the OPPONENT's turn", () => {
  const { engine } = tremorBoard();
  endTurn(engine, P2); // your turn: trigger
  const a = engine.state.players[P1].deck.length;
  const b = engine.state.players[P2].deck.length;
  endTurn(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.players[P1].deck.length, a, "no mill at the start of their turn");
  assert.equal(engine.state.players[P2].deck.length, b);
});

clause(TREMOR, "0:rule", "happens again at the start of each of your turns", () => {
  const { engine } = tremorBoard({ p1Deck: 8, p2Deck: 8 });
  endTurn(engine, P2);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.players[P1].deck.length, 4, "two of your turns started: 8 - 4");
  assert.equal(engine.state.players[P2].deck.length, 4);
});

clause(TREMOR, "0:rule", "does nothing without the Engine in play (control) and not while it is still in your hand", () => {
  const noEngine = tremorBoard({ engines: [] });
  endTurn(noEngine.engine, P2);
  assert.equal(noEngine.engine.state.players[P1].deck.length, 6);
  const inHand = tremorBoard({ inHand: true });
  endTurn(inHand.engine, P2);
  assert.equal(inHand.engine.state.players[P1].deck.length, 6);
  assert.equal(inHand.engine.state.players[P2].deck.length, 6);
});

clause(TREMOR, "0:rule", "with fewer than 2 cards in a deck that player puts what they have; nobody loses for an empty deck", () => {
  const { engine } = tremorBoard({ p1Deck: 1, p2Deck: 0 });
  const only = engine.state.players[P1].deck[0];
  endTurn(engine, P2);
  assert.equal(engine.state.players[P1].deck.length, 0);
  assert.ok(engine.state.players[P1].discard.includes(only), "engine.state.players[P1].discard.includes(only)");
  assert.equal(engine.state.players[P2].deck.length, 0);
  assert.equal(engine.state.winner, undefined);
});

clause(TREMOR, "0:rule", "two Engines both trigger: each deck loses 4", () => {
  const { engine } = tremorBoard({ engines: [{ owner: P1 }, { owner: P1 }], p1Deck: 8, p2Deck: 8 });
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(engine.state.players[P1].deck.length, 4);
  assert.equal(engine.state.players[P2].deck.length, 4);
});

clause(TREMOR, "0:rule", "'your turn' is the controller's turn: the opponent's Engine mills both decks at the start of THEIR turn and not yours", () => {
  const { engine } = tremorBoard({ engines: [{ owner: P2 }] });
  endTurn(engine, P2); // P1's turn starts: P2 controls the Engine
  assert.equal(engine.state.players[P1].deck.length, 6, "not at the start of my turn");
  assert.equal(engine.state.players[P2].deck.length, 6);
  endTurn(engine, P1); // P2's turn starts
  assert.equal(engine.state.players[P1].deck.length, 4);
  assert.equal(engine.state.players[P2].deck.length, 4);
});

clause(TREMOR, "0:rule", "an Engine you control but the opponent owns triggers at the start of your turn", () => {
  const { engine } = tremorBoard({ engines: [{ owner: P2, controller: P1 }] });
  endTurn(engine, P2);
  assert.equal(engine.state.players[P1].deck.length, 4);
  assert.equal(engine.state.players[P2].deck.length, 4);
});

clause(TREMOR, "0:rule", "deploys for its printed cost of 2 with [D]: refused one resource short and without [D]", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "te", def: printing(TREMOR), owner: P1, zone: "hand" }, ...bank("deception", 2, P1)]
  });
  play(engine, P1, id("te"));
  assert.equal(engine.state.cards[id("te")].zone, "play");
  assert.equal(ready(engine), 0, "2 resources were spent");
  const short = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "te", def: printing(TREMOR), owner: P1, zone: "hand" }, ...bank("deception", 1, P1)] });
  assert.throws(() => playRaw(short.engine, P1, short.id("te")), "one short");
  const noD = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "te", def: printing(TREMOR), owner: P1, zone: "hand" }, ...bank("greed", 5, P1)] });
  assert.throws(() => playRaw(noD.engine, P1, noD.id("te")), "no [D]");
});

// --- Vander Malagut --------------------------------------------------------
// UNIQUE EVONDAN. All your other "sarcophyle" characters gain 1 speed. -- If a
// character is destroyed on a turn during which this card damaged it, put that
// character into play under your control. It becomes a "sarcophyle". -- If this
// card is destroyed, destroy all "sarcophyle" characters.
// Character (sarcophyle), cost 9, threshold [D][D][D][D], 5 strength / 6 speed / 7 life.

const VANDER = "2e954d06-4902-495d-8a31-37d9ecd3ee96";

const sarco = (name: string, over: Partial<CardDefinition> = {}) => character({ name, subtype: ["sarcophyle"], strength: 1, life: 3, speed: 2, ...over });

function vanderBoard(opts: { turn?: number; active?: Seat; vanderIn?: "play" | "hand" | "none"; victimLife?: number; extra?: CardPlacement[]; deception?: number } = {}) {
  const vanderIn = opts.vanderIn ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 1,
    activePlayerId: opts.active ?? P1,
    cards: [
      ...(vanderIn === "none" ? [] : [{ key: "vander", def: printing(VANDER), owner: P1, zone: vanderIn } as CardPlacement]),
      { key: "sarcoA", def: sarco("SarcoA"), owner: P1, zone: "play" },
      { key: "sarcoB", def: sarco("SarcoB", { speed: 4 }), owner: P1, zone: "play" },
      { key: "foeSarco", def: sarco("FoeSarco"), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 3, speed: 2, subtype: ["goblin"] }), owner: P1, zone: "play" },
      { key: "victim", def: character({ name: "Victim", strength: 1, life: opts.victimLife ?? 5, speed: 1, subtype: ["goblin"] }), owner: P2, zone: "play" },
      { key: "victim2", def: character({ name: "Victim2", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "zap2", def: zapTactic(2, "Zap2"), owner: P1, zone: "hand" },
      { key: "foeKill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" },
      { key: "sarcoItem", def: item({ name: "SarcoItem", subtype: ["sarcophyle"] }), owner: P2, zone: "play" },
      ...bank("deception", opts.deception ?? 9, P1),
      ...(opts.extra ?? [])
    ]
  });
}

// --- 0:unique ---

function vanderDuplicate(second: "vander" | "twin" | "other" | "opp-vander") {
  // the twin/other cards are NOT sarcophyles, so Vander's own death rule (clause 3) does not touch them
  const secondDef = second === "twin" ? character({ name: "Twin", unique: "evondan", cost: 0 }) : second === "other" ? character({ name: "Other", unique: "somebody", cost: 0 }) : printing(VANDER);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: second === "opp-vander" ? 2 : 1,
    activePlayerId: second === "opp-vander" ? P2 : P1,
    cards: [
      { key: "vander", def: printing(VANDER), owner: P1, zone: "play" },
      { key: "second", def: secondDef, owner: second === "opp-vander" ? P2 : P1, zone: "hand" },
      ...bank("deception", 9, P1),
      ...bank("deception", 9, P2)
    ]
  });
}

for (const keep of ["old", "new"] as const) {
  clause(VANDER, "0:unique", `playing a second Vander offers its controller a keep-one choice (keeping the ${keep} one): the unkept copy is destroyed, and since a destroyed Vander destroys all sarcophyle characters, the other Vander goes too`, () => {
    const { engine, id } = vanderDuplicate("vander");
    play(engine, P1, id("second"));
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[]; unique: string };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses");
    assert.equal(pc.unique, "evondan");
    assert.deepEqual([...pc.candidates].sort(), [id("vander"), id("second")].sort());
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep === "old" ? "vander" : "second") } } as never);
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id(keep === "old" ? "second" : "vander")].zone, "discard", "the copy that was not kept is destroyed");
    // E11b: test corrected because the user's Q53 follow-up ruling says a NEW copy removed by UNIQUE never entered play, so
    // its "if this card is destroyed" rule does not fire: keeping the old Vander leaves it in play. Removing the OLD copy
    // (keep new) is a normal destruction, so its death rule still destroys the kept new Vander.
    assert.equal(
      engine.state.cards[id(keep === "old" ? "vander" : "second")].zone,
      keep === "old" ? "play" : "discard",
      keep === "old"
        ? "the new copy never entered play, so its death rule does not destroy the kept old Vander"
        : "the old copy's rule 'if this card is destroyed, destroy all sarcophyle characters' destroys the kept Vander as well"
    );
  });
}

clause(VANDER, "0:unique", "another card with UNIQUE EVONDAN counts as a duplicate, whatever its name: keeping Vander destroys the other card", () => {
  const { engine, id } = vanderDuplicate("twin");
  play(engine, P1, id("second"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; unique: string } | undefined;
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.unique, "evondan");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("vander") } } as never);
  assert.equal(engine.state.cards[id("vander")].zone, "play");
  assert.equal(engine.state.cards[id("second")].zone, "discard");
});

clause(VANDER, "0:unique", "keeping the other UNIQUE EVONDAN card destroys Vander", () => {
  const { engine, id } = vanderDuplicate("twin");
  play(engine, P1, id("second"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("second") } } as never);
  assert.equal(engine.state.cards[id("second")].zone, "play");
  assert.equal(engine.state.cards[id("vander")].zone, "discard");
});

clause(VANDER, "0:unique", "a card with another UNIQUE designation is not a duplicate", () => {
  const { engine, id } = vanderDuplicate("other");
  play(engine, P1, id("second"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("vander")].zone, "play");
  assert.equal(engine.state.cards[id("second")].zone, "play");
});

clause(VANDER, "0:unique", "the restriction is per player: the opponent may control their own Vander", () => {
  const { engine, id } = vanderDuplicate("opp-vander");
  play(engine, P2, id("second"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("vander")].zone, "play");
  assert.equal(engine.state.cards[id("second")].zone, "play");
});

clause(VANDER, "0:unique", "deploys for its printed cost of 9 with [D][D][D][D] and has 5 strength / 6 speed / 7 life", () => {
  const board = vanderBoard({ vanderIn: "hand", deception: 9 });
  play(board.engine, P1, board.id("vander"));
  assert.equal(board.engine.state.cards[board.id("vander")].zone, "play");
  assert.equal(ready(board.engine), 0, "9 resources spent");
  assert.equal(board.engine.getStat(board.id("vander"), "strength"), 5);
  assert.equal(board.engine.getStat(board.id("vander"), "speed"), 6, "no speed bonus for itself");
  assert.equal(board.engine.getStat(board.id("vander"), "life"), 7);
  assert.ok(board.engine.getSubtypes(board.id("vander")).includes("sarcophyle"), "board.engine.getSubtypes(board.id(\"vander\")).includes(\"sarcophyle\")");
  const short = vanderBoard({ vanderIn: "hand", deception: 8 });
  assert.throws(() => playRaw(short.engine, P1, short.id("vander")), "one resource short");
  const threeD = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "vander", def: printing(VANDER), owner: P1, zone: "hand" }, ...bank("deception", 3, P1), ...bank("greed", 8, P1)]
  });
  assert.throws(() => playRaw(threeD.engine, P1, threeD.id("vander")), "only three [D]");
});

// --- 1:rule ---

clause(VANDER, "1:rule", "your other sarcophyle characters gain exactly 1 speed (and nothing else)", () => {
  const { engine, id } = vanderBoard();
  assert.equal(engine.getStat(id("sarcoA"), "speed"), 3, "speed 2 + 1");
  assert.equal(engine.getStat(id("sarcoB"), "speed"), 5, "speed 4 + 1");
  assert.equal(engine.getStat(id("sarcoA"), "strength"), 1, "strength unchanged");
  assert.equal(engine.getStat(id("sarcoA"), "life"), 3, "life unchanged");
});

clause(VANDER, "1:rule", "Vander itself is not 'other': it keeps its printed speed of 6", () => {
  const { engine, id } = vanderBoard();
  assert.equal(engine.getStat(id("vander"), "speed"), 6);
});

clause(VANDER, "1:rule", "only YOUR sarcophyle characters: the opponent's sarcophyle characters and your non-sarcophyle characters keep their speed", () => {
  const { engine, id } = vanderBoard();
  assert.equal(engine.getStat(id("foeSarco"), "speed"), 2, "the opponent's sarcophyle");
  assert.equal(engine.getStat(id("plain"), "speed"), 2, "your goblin");
  assert.equal(engine.getStat(id("victim"), "speed"), 1);
});

clause(VANDER, "1:rule", "a sarcophyle character you control but the opponent owns counts as yours", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "borrowed", def: sarco("Borrowed"), owner: P2, controller: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("borrowed"), "speed"), 3);
});

clause(VANDER, "1:rule", "a sarcophyle character the opponent controls but you own does not count", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "lent", def: sarco("Lent"), owner: P1, controller: P2, zone: "play" }] });
  assert.equal(engine.getStat(id("lent"), "speed"), 2);
});

clause(VANDER, "1:rule", "without Vander in play nobody gets the speed; in hand it does nothing", () => {
  const none = vanderBoard({ vanderIn: "none" });
  assert.equal(none.engine.getStat(none.id("sarcoA"), "speed"), 2);
  const inHand = vanderBoard({ vanderIn: "hand" });
  assert.equal(inHand.engine.getStat(inHand.id("sarcoA"), "speed"), 2);
});

clause(VANDER, "1:rule", "the speed bonus ends when Vander leaves play", () => {
  const { engine, id } = vanderBoard();
  assert.equal(engine.getStat(id("sarcoA"), "speed"), 3);
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  assert.equal(engine.state.cards[id("vander")].zone, "discard");
  assert.equal(engine.state.cards[id("sarcoA")].zone, "discard", "setup: its death also destroyed the sarcophyle characters (clause 3)");
  const bounced = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "vander", def: printing(VANDER), owner: P1, zone: "play" },
      { key: "sarcoA", def: sarco("SarcoA"), owner: P1, zone: "play" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(bounced.engine.getStat(bounced.id("sarcoA"), "speed"), 3);
  play(bounced.engine, P1, bounced.id("bounce"), { selected: { t: [bounced.id("vander")] } });
  assert.equal(bounced.engine.state.cards[bounced.id("vander")].zone, "hand");
  assert.equal(bounced.engine.getStat(bounced.id("sarcoA"), "speed"), 2, "back to printed speed");
});

clause(VANDER, "1:rule", "a character that becomes a sarcophyle later also gets the speed (it is a sarcophyle character you control)", () => {
  const grant = tactic({
    name: "Grant",
    cost: 0,
    behavior: { abilities: [{ id: "grant", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "self" }, count: 1 }], effects: [{ type: "grantSubtype", target: { type: "selected", id: "t" }, subtype: "sarcophyle", duration: { type: "permanent" } }] }] }
  });
  const { engine, id } = vanderBoard({ extra: [{ key: "grant", def: grant, owner: P1, zone: "hand" }] });
  assert.equal(engine.getStat(id("plain"), "speed"), 2);
  play(engine, P1, id("grant"), { selected: { t: [id("plain")] } });
  assert.ok(engine.getSubtypes(id("plain")).includes("sarcophyle"), "engine.getSubtypes(id(\"plain\")).includes(\"sarcophyle\")");
  assert.equal(engine.getStat(id("plain"), "speed"), 3);
});

// --- 2:rule (harvest) ---

/** Vander (P1, attacking on turn 1) is blocked by `victim`; the battle is played out. */
function vanderAttack(board: ReturnType<typeof vanderBoard>, blockers: string[] = ["victim"], plan: Record<string, string> = {}) {
  const { engine, id } = board;
  declareAttackBy(engine, P1, [id("vander")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers.map(id) });
  autoResolveBattle(engine, fightPlan(Object.fromEntries(Object.entries(plan).map(([k, v]) => [id(k), id(v)]))));
  resolvePendingResponses(engine);
  drain(engine, declineAll);
}

clause(VANDER, "2:rule", "a blocker destroyed by Vander's battle damage is put into play under your control instead and becomes a sarcophyle", () => {
  const board = vanderBoard();
  const { engine, id } = board;
  vanderAttack(board);
  const victim = engine.state.cards[id("victim")];
  assert.equal(victim.zone, "play", "put into play instead of the discard pile");
  assert.equal(victim.controllerId, P1, "under your control");
  assert.equal(victim.ownerId, P2, "ownership never changes");
  assert.ok(engine.getSubtypes(id("victim")).includes("sarcophyle"), "it becomes a sarcophyle");
  assert.equal(victim.damage, 0, "it re-enters play undamaged");
  assert.equal(victim.depleted, false, "nothing says it enters depleted");
  assert.ok(engine.state.players[P1].play.includes(id("victim")), "engine.state.players[P1].play.includes(id(\"victim\"))");
  assert.equal(engine.state.players[P2].play.includes(id("victim")), false);
  assert.equal(engine.state.players[P2].discard.includes(id("victim")), false, "the original destruction did not put it in the discard pile");
});

clause(VANDER, "2:rule", "the converted character is a sarcophyle you control, so it gets Vander's +1 speed", () => {
  const board = vanderBoard();
  const { engine, id } = board;
  vanderAttack(board);
  assert.equal(engine.getStat(id("victim"), "speed"), 2, "printed speed 1 + 1");
});

clause(VANDER, "2:rule", "works when Vander blocks: an attacker destroyed by Vander's damage joins you", () => {
  const { engine, id } = vanderBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "raider", def: character({ name: "Raider", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(engine, P2, [id("raider")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("vander")] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("raider")].zone, "play");
  assert.equal(engine.state.cards[id("raider")].controllerId, P1);
  assert.ok(engine.getSubtypes(id("raider")).includes("sarcophyle"), "engine.getSubtypes(id(\"raider\")).includes(\"sarcophyle\")");
});

clause(VANDER, "2:rule", "damage Vander dealt earlier this turn counts: a character it hurt and a later effect destroys the same turn is also put into play under your control", () => {
  const board = vanderBoard({ victimLife: 9 });
  const { engine, id } = board;
  vanderAttack(board);
  assert.equal(engine.state.cards[id("victim")].damage, 5, "setup: Vander dealt 5 of the victim's 9 life");
  assert.equal(engine.state.cards[id("victim")].controllerId, P2);
  play(engine, P1, id("kill"), { selected: { t: [id("victim")] } });
  assert.equal(engine.state.cards[id("victim")].zone, "play", "destroyed on a turn Vander damaged it: put into play instead");
  assert.equal(engine.state.cards[id("victim")].controllerId, P1);
  assert.ok(engine.getSubtypes(id("victim")).includes("sarcophyle"), "engine.getSubtypes(id(\"victim\")).includes(\"sarcophyle\")");
});

clause(VANDER, "2:rule", "a character Vander did not damage this turn is destroyed normally (to its owner's discard pile)", () => {
  const { engine, id } = vanderBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("victim")] } });
  assert.equal(engine.state.cards[id("victim")].zone, "discard");
  assert.equal(engine.state.cards[id("victim")].controllerId, P2);
  assert.equal(engine.state.players[P2].discard.includes(id("victim")), true);
  assert.equal(engine.getSubtypes(id("victim")).includes("sarcophyle"), false);
});

clause(VANDER, "2:rule", "damage from another source does not count: a character hurt by something else and then destroyed goes to the discard pile", () => {
  const { engine, id } = vanderBoard();
  play(engine, P1, id("zap2"), { selected: { t: [id("victim")] } });
  assert.equal(engine.state.cards[id("victim")].damage, 2);
  play(engine, P1, id("kill"), { selected: { t: [id("victim")] } });
  assert.equal(engine.state.cards[id("victim")].zone, "discard");
  assert.equal(engine.state.cards[id("victim")].controllerId, P2);
});

clause(VANDER, "2:rule", "only characters damaged by Vander itself count: one destroyed after Vander damaged a different character goes to the discard pile", () => {
  const board = vanderBoard({ victimLife: 9 });
  const { engine, id } = board;
  vanderAttack(board, ["victim"]);
  play(engine, P1, id("kill"), { selected: { t: [id("victim2")] } });
  assert.equal(engine.state.cards[id("victim2")].zone, "discard", "Vander never damaged victim2");
  assert.equal(engine.state.cards[id("victim2")].controllerId, P2);
});

clause(VANDER, "2:rule", "damage on an earlier turn does not count (it was cleared): destroying the character on a later turn is an ordinary destruction", () => {
  const board = vanderBoard({ victimLife: 9 });
  const { engine, id } = board;
  vanderAttack(board);
  assert.equal(engine.state.cards[id("victim")].damage, 5);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "a later turn of yours");
  assert.equal(engine.state.cards[id("victim")].damage, 0);
  play(engine, P1, id("kill"), { selected: { t: [id("victim")] } });
  assert.equal(engine.state.cards[id("victim")].zone, "discard", "Vander did not damage it THIS turn");
  assert.equal(engine.state.cards[id("victim")].controllerId, P2);
});

clause(VANDER, "2:rule", "every character Vander destroys in one battle is taken (damage divided across two blockers)", () => {
  const board = vanderBoard({ victimLife: 3 });
  const { engine, id } = board;
  declareAttackBy(engine, P1, [id("vander")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("victim"), id("victim2")] });
  autoResolveBattle(engine, (source) => {
    if (source.cardId !== id("vander")) return source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : [];
    return [
      { sourceId: source.cardId, target: { type: "card" as const, cardId: id("victim") }, amount: 3 },
      { sourceId: source.cardId, target: { type: "card" as const, cardId: id("victim2") }, amount: 2 }
    ];
  });
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  for (const key of ["victim", "victim2"]) {
    assert.equal(engine.state.cards[id(key)].zone, "play", `${key} put into play`);
    assert.equal(engine.state.cards[id(key)].controllerId, P1, `${key} under your control`);
    assert.ok(engine.getSubtypes(id(key)).includes("sarcophyle"), "engine.getSubtypes(id(key)).includes(\"sarcophyle\")");
  }
});

clause(VANDER, "2:rule", "without Vander in play a destroyed character simply goes to the discard pile (control)", () => {
  const { engine, id } = vanderBoard({ vanderIn: "none" });
  play(engine, P1, id("kill"), { selected: { t: [id("victim")] } });
  assert.equal(engine.state.cards[id("victim")].zone, "discard");
});

clause(VANDER, "2:rule", "also applies to the opponent's turn and to characters of any controller: the opponent's own kill tactic on a character Vander damaged this turn", () => {
  const board = vanderBoard({ victimLife: 9 });
  const { engine, id } = board;
  vanderAttack(board);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  // a new turn: the damage Vander dealt is gone, so a destruction now is ordinary
  play(engine, P2, id("foeKill"), { selected: { t: [id("victim")] } });
  assert.equal(engine.state.cards[id("victim")].zone, "discard");
  assert.equal(engine.state.cards[id("victim")].controllerId, P2);
});

// --- 3:rule (death) ---

clause(VANDER, "3:rule", "when Vander is destroyed, all sarcophyle characters are destroyed: yours and the opponent's", () => {
  const { engine, id } = vanderBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  assert.equal(engine.state.cards[id("vander")].zone, "discard");
  for (const key of ["sarcoA", "sarcoB", "foeSarco"]) {
    assert.equal(engine.state.cards[id(key)].zone, "discard", `${key} (a sarcophyle character) is destroyed`);
  }
});

clause(VANDER, "3:rule", "characters that are not sarcophyles, and sarcophyle cards that are not characters, survive", () => {
  const { engine, id } = vanderBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  for (const key of ["plain", "victim", "victim2", "sarcoItem"]) {
    assert.equal(engine.state.cards[id(key)].zone, "play", `${key} survives`);
  }
});

clause(VANDER, "3:rule", "also fires when Vander dies in battle", () => {
  const { engine, id } = vanderBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "brute", def: character({ name: "Brute", strength: 9, life: 9, speed: 7 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(engine, P2, [id("brute")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("vander")] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("vander")].zone, "discard", "setup: Vander was killed by the brute");
  for (const key of ["sarcoA", "sarcoB", "foeSarco"]) assert.equal(engine.state.cards[id(key)].zone, "discard", key);
  assert.equal(engine.state.cards[id("plain")].zone, "play");
});

clause(VANDER, "3:rule", "a sarcophyle taken with Vander's own conversion is destroyed with the rest", () => {
  const board = vanderBoard({ victimLife: 5 });
  const { engine, id } = board;
  vanderAttack(board);
  assert.equal(engine.state.cards[id("victim")].controllerId, P1, "setup: converted");
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  assert.equal(engine.state.cards[id("victim")].zone, "discard", "the converted sarcophyle dies with Vander");
});

clause(VANDER, "3:rule", "does not trigger when Vander leaves play without being destroyed (returned to hand)", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("vander")] } });
  assert.equal(engine.state.cards[id("vander")].zone, "hand");
  for (const key of ["sarcoA", "sarcoB", "foeSarco"]) assert.equal(engine.state.cards[id(key)].zone, "play", `${key} survives`);
});

clause(VANDER, "3:rule", "does not trigger when another sarcophyle is destroyed", () => {
  const { engine, id } = vanderBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("sarcoA")] } });
  assert.equal(engine.state.cards[id("sarcoA")].zone, "discard");
  assert.equal(engine.state.cards[id("vander")].zone, "play");
  assert.equal(engine.state.cards[id("sarcoB")].zone, "play");
  assert.equal(engine.state.cards[id("foeSarco")].zone, "play");
});

clause(VANDER, "3:rule", "the opponent's own Vander is a sarcophyle character too: it is destroyed as well", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "foeVander", def: printing(VANDER), owner: P2, zone: "play" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  assert.equal(engine.state.cards[id("vander")].zone, "discard");
  assert.equal(engine.state.cards[id("foeVander")].zone, "discard", "'all sarcophyle characters' includes the other Vander");
  assert.equal(engine.state.cards[id("foeSarco")].zone, "discard");
});

// --- Warehouse Raid --------------------------------------------------------
// COST: Flip a coin. If you win, X is 2 otherwise X is 1. -- EFFECT: Your
// opponent must discard X cards at random. Put any items discarded this way
// into play under your control. Tactic, cost 3, threshold [D].

const RAID = "3e634264-918f-44bd-bcd5-340220566f8e";

/** A random stream that returns `values` in order, then repeats the last one. */
function rngSequence(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Opponent hand: h0 item, h1 character, h2 item, h3 character, h4 tactic (unless `hand` says otherwise). */
function raidBoard(opts: { random?: () => number; hand?: Array<"item" | "char" | "tactic">; deception?: number; greed?: number } = {}) {
  const kinds = opts.hand ?? ["item", "char", "item", "char", "tactic"];
  const defFor = (kind: "item" | "char" | "tactic", i: number) =>
    kind === "item" ? item({ name: `H${i}Item` }) : kind === "char" ? character({ name: `H${i}Char` }) : tactic({ name: `H${i}Tactic` });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    cards: [
      { key: "wr", def: printing(RAID), owner: P1, zone: "hand" },
      { key: "mineHand", def: character({ name: "MineHand" }), owner: P1, zone: "hand" },
      ...kinds.map((kind, i) => ({ key: `h${i}`, def: defFor(kind, i), owner: P2, zone: "hand" as const })),
      { key: "oppDeck", def: item({ name: "OppDeckItem" }), owner: P2, zone: "deck" },
      { key: "oppDisc", def: item({ name: "OppDiscItem" }), owner: P2, zone: "discard" },
      ...bank("deception", opts.deception ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

const raidHandLeft = (engine: SpoilsEngine) => engine.state.players[P2].hand.length;
const coinResults = (engine: SpoilsEngine) =>
  engine.getLog().filter((entry) => entry.event?.type === "coinFlipped").map((entry) => entry.event as unknown as { playerId: string; won: boolean });

clause(RAID, "0:ability", "a won coin flip makes X = 2: the opponent discards exactly 2 cards at random (items go to you, the rest to their discard pile), and the cost of 3 is paid", () => {
  const { engine, id } = raidBoard({ random: rngSequence(0.1, 0.5, 0.99) });
  const before = ready(engine);
  play(engine, P1, id("wr"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  const flips = coinResults(engine);
  assert.equal(flips.length, 1, "one coin flip");
  assert.equal(flips[0].playerId, P1, "you flipped");
  assert.equal(flips[0].won, true, "and won");
  assert.equal(raidHandLeft(engine), 3, "exactly 2 of 5 cards left their hand");
  assert.equal(engine.state.cards[id("h2")].zone, "play", "the random pick #1 was h2 (index 2 of 5), an item: put into play");
  assert.equal(engine.state.cards[id("h4")].zone, "discard", "the random pick #2 was h4 (last of 4), a tactic: discarded");
  for (const key of ["h0", "h1", "h3"]) assert.equal(engine.state.cards[id(key)].zone, "hand", `${key} was not picked`);
  assert.equal(engine.state.cards[id("wr")].zone, "discard");
});

clause(RAID, "0:ability", "a lost coin flip makes X = 1: exactly one random card is discarded", () => {
  const { engine, id } = raidBoard({ random: rngSequence(0.9, 0.0) });
  play(engine, P1, id("wr"));
  const flips = coinResults(engine);
  assert.deepEqual(flips.map((f) => f.won), [false], "you lost the flip");
  assert.equal(flips[0].playerId, P1);
  assert.equal(raidHandLeft(engine), 4, "exactly 1 card left the hand");
  assert.equal(engine.state.cards[id("h0")].zone, "play", "the random pick was h0 (index 0), an item: put into play");
  for (const key of ["h1", "h2", "h3", "h4"]) assert.equal(engine.state.cards[id(key)].zone, "hand", `${key} stays`);
});

clause(RAID, "0:ability", "the cards are chosen at random: different random streams discard different cards", () => {
  const picked = (...values: number[]) => {
    const { engine, id } = raidBoard({ random: rngSequence(...values) });
    play(engine, P1, id("wr"));
    return ["h0", "h1", "h2", "h3", "h4"].filter((key) => engine.state.cards[id(key)].zone !== "hand");
  };
  assert.deepEqual(picked(0.9, 0.0), ["h0"]);
  assert.deepEqual(picked(0.9, 0.5), ["h2"]);
  assert.deepEqual(picked(0.9, 0.99), ["h4"]);
  assert.deepEqual(picked(0.1, 0.0, 0.0), ["h0", "h1"]);
  assert.deepEqual(picked(0.1, 0.99, 0.99), ["h3", "h4"], "pick #1 is the last of 5 (h4), pick #2 the last of the remaining 4 (h3)");
});

clause(RAID, "0:ability", "an item discarded this way is put into play under YOUR control (it stays the opponent's card; it is not in their discard pile)", () => {
  const { engine, id } = raidBoard({ random: rngSequence(0.9, 0.0) });
  play(engine, P1, id("wr"));
  const stolen = engine.state.cards[id("h0")];
  assert.equal(stolen.zone, "play");
  assert.equal(stolen.controllerId, P1, "you control it");
  assert.equal(stolen.ownerId, P2, "ownership never changes");
  assert.ok(engine.state.players[P1].play.includes(id("h0")), "engine.state.players[P1].play.includes(id(\"h0\"))");
  assert.equal(engine.state.players[P2].play.includes(id("h0")), false);
  assert.equal(engine.state.players[P2].discard.includes(id("h0")), false, "it was not left in their discard pile");
});

clause(RAID, "0:ability", "a non-item discarded this way goes to its owner's discard pile and is not put into play", () => {
  const { engine, id } = raidBoard({ random: rngSequence(0.9, 0.2) });
  play(engine, P1, id("wr"));
  assert.equal(engine.state.cards[id("h1")].zone, "discard", "index 1 of 5 is the character");
  assert.equal(engine.state.players[P2].discard.includes(id("h1")), true);
  assert.equal(engine.state.cards[id("h1")].controllerId, P2);
  const tacticPick = raidBoard({ random: rngSequence(0.9, 0.99) });
  play(tacticPick.engine, P1, tacticPick.id("wr"));
  assert.equal(tacticPick.engine.state.cards[tacticPick.id("h4")].zone, "discard", "a tactic too");
});

clause(RAID, "0:ability", "with X = 2 and two items picked, both items come into play under your control", () => {
  const { engine, id } = raidBoard({ random: rngSequence(0.1, 0.0, 0.0), hand: ["item", "item", "char"] });
  play(engine, P1, id("wr"));
  for (const key of ["h0", "h1"]) {
    assert.equal(engine.state.cards[id(key)].zone, "play", `${key} in play`);
    assert.equal(engine.state.cards[id(key)].controllerId, P1);
  }
  assert.equal(engine.state.cards[id("h2")].zone, "hand");
  assert.equal(raidHandLeft(engine), 1);
});

clause(RAID, "0:ability", "the opponent makes no choices: no prompt is ever opened", () => {
  const { engine, id } = raidBoard({ random: rngSequence(0.1, 0.0, 0.0) });
  play(engine, P1, id("wr"));
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(RAID, "0:ability", "with fewer cards in the opponent's hand than X they discard what they have; with an empty hand nothing happens", () => {
  const one = raidBoard({ random: rngSequence(0.1, 0.0, 0.0), hand: ["item"] });
  play(one.engine, P1, one.id("wr"));
  assert.equal(raidHandLeft(one.engine), 0, "their only card was discarded");
  assert.equal(one.engine.state.cards[one.id("h0")].zone, "play");
  assert.equal(one.engine.state.cards[one.id("h0")].controllerId, P1);

  const none = raidBoard({ random: rngSequence(0.1), hand: [] });
  play(none.engine, P1, none.id("wr"));
  assert.equal(none.engine.state.cards[none.id("wr")].zone, "discard", "resolved without error");
  assert.equal(none.engine.state.pendingChoice, undefined);
});

clause(RAID, "0:ability", "only the opponent's HAND is raided: their deck and discard pile and your own hand are untouched", () => {
  const { engine, id } = raidBoard({ random: rngSequence(0.1, 0.0, 0.0) });
  play(engine, P1, id("wr"));
  assert.equal(engine.state.cards[id("oppDeck")].zone, "deck");
  assert.equal(engine.state.cards[id("oppDisc")].zone, "discard");
  assert.equal(engine.state.cards[id("mineHand")].zone, "hand");
  assert.equal(engine.state.players[P1].discard.includes(id("mineHand")), false);
});

clause(RAID, "0:ability", "the coin is flipped as part of the cost: the result is already known when the opponent can respond", () => {
  const { engine, id } = raidBoard({ random: rngSequence(0.1, 0.0, 0.0) });
  playRaw(engine, P1, id("wr"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(coinResults(engine).length, 1, "COST: flip a coin, done when the card is played");
});

clause(RAID, "0:ability", "is refused one resource short of its cost of 3, and without [D]", () => {
  const short = raidBoard({ deception: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("wr")));
  assert.equal(short.engine.state.cards[short.id("wr")].zone, "hand");
  const noD = raidBoard({ deception: 0, greed: 6 });
  assert.throws(() => playRaw(noD.engine, P1, noD.id("wr")), "no [D]");
  const exact = raidBoard({ deception: 3, random: rngSequence(0.1, 0.0, 0.0) });
  play(exact.engine, P1, exact.id("wr"));
  assert.equal(exact.engine.state.cards[exact.id("wr")].zone, "discard", "[D] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

// --- Yoink! ----------------------------------------------------------------
// COST: Pick a "gear" card and a character. -- EFFECT: Take control of the
// "gear" card and attach it to the character. Tactic, cost 1, threshold [D].

const YOINK = "b39ce795-6b4e-4782-a0a5-965584c8e108";

const gearDef = (name: string, over: Partial<CardDefinition> = {}) =>
  item({
    name,
    subtype: ["gear"],
    attachTo: "character",
    behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 1 }] }] },
    ...over
  });

function yoinkBoard(opts: { deception?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "yoink", def: printing(YOINK), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 5 }), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5 }), owner: P2, zone: "play" },
      { key: "foeGear", def: gearDef("FoeGear"), owner: P2, zone: "play", attachedToKey: "foe" },
      { key: "mineGear", def: gearDef("MineGear"), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "looseGear", def: item({ name: "LooseGear", subtype: ["gear"] }), owner: P2, zone: "play" },
      { key: "plainItem", def: item({ name: "PlainItem" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "handGear", def: gearDef("HandGear"), owner: P2, zone: "hand" },
      { key: "discGear", def: gearDef("DiscGear"), owner: P2, zone: "discard" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(YOINK, "0:ability", "takes control of the opponent's gear and attaches it to your character: the old host loses the gear's bonus, the new one gains it; the cost of 1 is paid", () => {
  const { engine, id } = yoinkBoard();
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "setup: the gear buffs its host");
  const before = ready(engine);
  play(engine, P1, id("yoink"), { selected: { g: [id("foeGear")], c: [id("mate")] } });
  const gear = engine.state.cards[id("foeGear")];
  assert.equal(before - ready(engine), 1, "the printed cost of 1 is paid");
  assert.equal(gear.controllerId, P1, "you took control");
  assert.equal(gear.ownerId, P2, "ownership never changes");
  assert.equal(gear.attachedTo, id("mate"), "attached to the picked character");
  assert.equal(gear.zone, "play");
  assert.equal(engine.getStat(id("foe"), "strength"), 2, "the old host loses the bonus");
  assert.equal(engine.getStat(id("mate"), "strength"), 3, "the new host gains it");
  assert.equal(engine.state.cards[id("yoink")].zone, "discard");
  assert.ok(engine.state.players[P1].play.includes(id("foeGear")), "it is in your play area");
  assert.equal(engine.state.players[P2].play.includes(id("foeGear")), false);
});

clause(YOINK, "0:ability", "the gear can be attached to the opponent's character instead (any character may be picked)", () => {
  const { engine, id } = yoinkBoard();
  play(engine, P1, id("yoink"), { selected: { g: [id("mineGear")], c: [id("foe")] } });
  assert.equal(engine.state.cards[id("mineGear")].attachedTo, id("foe"));
  assert.equal(engine.state.cards[id("mineGear")].controllerId, P1, "you still control your own gear");
  assert.equal(engine.getStat(id("foe"), "strength"), 4, "the foe now wears two gear cards (+2)");
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "the old host lost it");
});

clause(YOINK, "0:ability", "a gear card that is not attached to anything can be taken and attached", () => {
  const { engine, id } = yoinkBoard();
  play(engine, P1, id("yoink"), { selected: { g: [id("looseGear")], c: [id("mine")] } });
  assert.equal(engine.state.cards[id("looseGear")].controllerId, P1);
  assert.equal(engine.state.cards[id("looseGear")].attachedTo, id("mine"));
  assert.equal(engine.state.cards[id("looseGear")].zone, "play");
});

clause(YOINK, "0:ability", "your own gear can be moved to another of your characters", () => {
  const { engine, id } = yoinkBoard();
  play(engine, P1, id("yoink"), { selected: { g: [id("mineGear")], c: [id("mate")] } });
  assert.equal(engine.state.cards[id("mineGear")].attachedTo, id("mate"));
  assert.equal(engine.getStat(id("mate"), "strength"), 3);
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
});

clause(YOINK, "0:ability", "other cards are untouched: the old host stays in play and other gear and items keep their controller and host", () => {
  const { engine, id } = yoinkBoard();
  play(engine, P1, id("yoink"), { selected: { g: [id("foeGear")], c: [id("mate")] } });
  assert.equal(engine.state.cards[id("foe")].zone, "play", "the old host stays in play");
  assert.equal(engine.state.cards[id("mineGear")].attachedTo, id("mine"), "your other gear is untouched");
  assert.equal(engine.state.cards[id("looseGear")].controllerId, P2, "their other gear is untouched");
  assert.equal(engine.state.cards[id("plainItem")].controllerId, P2);
});

clause(YOINK, "0:ability", "when the new host leaves play the stolen gear goes to its OWNER's discard pile", () => {
  const { engine, id } = yoinkBoard();
  play(engine, P1, id("yoink"), { selected: { g: [id("foeGear")], c: [id("mate")] } });
  play(engine, P1, id("kill"), { selected: { t: [id("mate")] } });
  assert.equal(engine.state.cards[id("mate")].zone, "discard");
  assert.equal(engine.state.cards[id("foeGear")].zone, "discard");
  assert.equal(engine.state.players[P2].discard.includes(id("foeGear")), true, "back to its owner's discard pile");
  assert.equal(engine.state.players[P1].discard.includes(id("foeGear")), false);
});

clause(YOINK, "0:ability", "the first pick must be a gear card in play: a non-gear item, a character, a location, a face-down card, a faction, and gear in a hand or discard pile are refused", () => {
  const { engine, id } = yoinkBoard();
  const attempt = (gear: string) => () => playRaw(engine, P1, id("yoink"), { selected: { g: [gear], c: [id("mate")] } });
  assert.throws(attempt(id("plainItem")), "an item that is not gear");
  assert.throws(attempt(id("foe")), "a character");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction");
  assert.throws(attempt(id("handGear")), "gear in the opponent's hand");
  assert.throws(attempt(id("discGear")), "gear in a discard pile");
  assert.equal(engine.state.cards[id("yoink")].zone, "hand", "nothing was played");
  attempt(id("foeGear"))();
  assert.ok(engine.state.responseWindow, "gear in play is accepted");
});

clause(YOINK, "0:ability", "the second pick must be a character: an item, a location, a face-down card and a faction are refused", () => {
  const { engine, id } = yoinkBoard();
  const attempt = (c: string) => () => playRaw(engine, P1, id("yoink"), { selected: { g: [id("foeGear")], c: [c] } });
  assert.throws(attempt(id("plainItem")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  attempt(id("mate"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
});

clause(YOINK, "0:ability", "both picks are required, one of each", () => {
  const { engine, id } = yoinkBoard();
  assert.throws(() => playRaw(engine, P1, id("yoink"), { selected: { g: [id("foeGear")] } }), "no character");
  assert.throws(() => playRaw(engine, P1, id("yoink"), { selected: { c: [id("mate")] } }), "no gear");
  assert.throws(() => playRaw(engine, P1, id("yoink"), { selected: {} }), "nothing");
  assert.throws(() => playRaw(engine, P1, id("yoink"), { selected: { g: [id("foeGear"), id("looseGear")], c: [id("mate")] } }), "two gear cards");
  assert.throws(() => playRaw(engine, P1, id("yoink"), { selected: { g: [id("foeGear")], c: [id("mate"), id("mine")] } }), "two characters");
  assert.equal(engine.state.cards[id("yoink")].zone, "hand");
});

clause(YOINK, "0:ability", "is refused with no resources, and without [D]", () => {
  const short = yoinkBoard({ deception: 0 });
  assert.throws(() => playRaw(short.engine, P1, short.id("yoink"), { selected: { g: [short.id("foeGear")], c: [short.id("mate")] } }));
  const noD = yoinkBoard({ deception: 0, greed: 5 });
  assert.throws(() => playRaw(noD.engine, P1, noD.id("yoink"), { selected: { g: [noD.id("foeGear")], c: [noD.id("mate")] } }), "no [D]");
  const exact = yoinkBoard({ deception: 1 });
  play(exact.engine, P1, exact.id("yoink"), { selected: { g: [exact.id("foeGear")], c: [exact.id("mate")] } });
  assert.equal(exact.engine.state.cards[exact.id("foeGear")].controllerId, P1, "[D] and exactly 1 resource is enough");
  assert.equal(ready(exact.engine), 0);
});

// --- Warlord section helpers -----------------------------------------------

type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";

/** Answers whatever "pick" prompt is open (`selectTargets` or `chooserSelectsTarget`) with `ids` (empty = pick nothing). */
function answerPick2(engine: SpoilsEngine, player: Seat, ids: string[]) {
  const pc = engine.state.pendingChoice as unknown as { kind: string; declarations?: Array<{ id: string }>; playerId: string } | undefined;
  assert.ok(pc, "a pick is pending");
  assert.equal(pc.playerId, player, "the right player is asked");
  if (pc.kind === "selectTargets") {
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "selectTargets", selected: { [pc.declarations![0].id]: ids } } } as never);
  } else {
    assert.equal(pc.kind, "chooserSelectsTarget");
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  }
  resolvePendingResponses(engine);
}

/** Runs the standard checks for a card with no rules text: exact cost and threshold, refusals one short or without the icons, response-window timing. */
function vanillaDeploys(printingId: string, icon: Icon, cost: number, iconCount: number) {
  const other: Icon = icon === "greed" ? "obsession" : "greed";
  const board = (own: number, others: number, turn = 1, active: Seat = P1) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn,
      activePlayerId: active,
      cards: [{ key: "card", def: printing(printingId), owner: P1, zone: "hand" }, ...bank(icon, own, P1), ...bank(other, others, P1)]
    });
  const exact = board(cost, 0);
  play(exact.engine, P1, exact.id("card"));
  assert.equal(exact.engine.state.cards[exact.id("card")].zone, "play", "deploys with exactly its cost");
  assert.equal(exact.engine.state.cards[exact.id("card")].controllerId, P1);
  assert.equal(ready(exact.engine), 0, `all ${cost} resources were spent`);

  const short = board(cost - 1, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("card")), "one resource short");
  assert.equal(short.engine.state.cards[short.id("card")].zone, "hand");

  const fewIcons = board(iconCount - 1, cost + 2);
  assert.throws(() => playRaw(fewIcons.engine, P1, fewIcons.id("card")), `fewer than ${iconCount} matching icons`);

  const mixed = board(iconCount, cost - iconCount);
  play(mixed.engine, P1, mixed.id("card"));
  assert.equal(mixed.engine.state.cards[mixed.id("card")].zone, "play", "the threshold needs the icons, the rest of the cost can be any resources");

  const surplus = board(cost + 3, 0);
  play(surplus.engine, P1, surplus.id("card"));
  assert.equal(ready(surplus.engine), 3, "only the printed cost is spent");

  const offTurn = board(cost, 0, 2, P2);
  assert.throws(() => playRaw(offTurn.engine, P1, offTurn.id("card")), "a character cannot be deployed on the opponent's turn");
}

/** The printed stats, subtype, card type and (lack of) keywords of a vanilla character in play. */
function vanillaInPlay(printingId: string, stats: { strength: number; speed: number; life: number }, subtype: string) {
  const { engine, id } = buildGame({ cards: [{ key: "card", def: printing(printingId), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("card"), "strength"), stats.strength, "strength");
  assert.equal(engine.getStat(id("card"), "speed"), stats.speed, "speed");
  assert.equal(engine.getStat(id("card"), "life"), stats.life, "life");
  assert.ok(engine.hasCardType(id("card"), "character"), "a character");
  assert.deepEqual(engine.getSubtypes(id("card")), [subtype]);
  assert.deepEqual(engine.getKeywords(id("card")), [], "no keywords");
  assert.deepEqual(engine.getRestrictions(id("card")), [], "no restrictions");
}

// --- Arena Quarter-Finalist ------------------------------------------------
// (no rules text) Character (fighter), cost 7, threshold [R][R], 7 strength / 3 speed / 5 life.

const ARENA = "8a7881b9-2314-47b6-9f6b-8b3e67a27823";

clause(ARENA, "vanilla", "deploys for exactly its printed cost of 7 with [R][R]: refused one short and without two [R]", () => {
  vanillaDeploys(ARENA, "rage", 7, 2);
});

clause(ARENA, "vanilla", "has its printed 7 strength / 3 speed / 5 life, is a fighter, and has no abilities or keywords", () => {
  vanillaInPlay(ARENA, { strength: 7, speed: 3, life: 5 }, "fighter");
});

clause(ARENA, "vanilla", "fights as printed: dealing 7 battle damage and dying to 5 damage", () => {
  const { engine, id } = buildGame({
    turn: 2,
    cards: [
      { key: "arena", def: printing(ARENA), owner: P1, zone: "play" },
      { key: "wall", def: character({ name: "Wall", strength: 1, life: 7, speed: 1 }), owner: P2, zone: "play" },
    ]
  });
  declareAttackBy(engine, P1, [id("arena")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("wall")] });
  autoResolveBattle(engine);
  assert.equal(engine.state.cards[id("wall")].zone, "discard", "7 damage destroys a 7-life blocker");
  assert.equal(engine.state.cards[id("arena")].zone, "play");
  assert.equal(engine.state.cards[id("arena")].damage, 0, "speed 3 beats the blocker's speed 1: the blocker is destroyed before it can deal its damage");
});

clause(ARENA, "vanilla", "is destroyed by exactly 5 damage and survives 4", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "arena", def: printing(ARENA), owner: P2, zone: "play" },
      { key: "zap4", def: zapTactic(4, "Zap4"), owner: P1, zone: "hand" },
      { key: "zap1", def: zapTactic(1, "Zap1"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zap4"), { selected: { t: [id("arena")] } });
  assert.equal(engine.state.cards[id("arena")].zone, "play", "4 damage on life 5");
  play(engine, P1, id("zap1"), { selected: { t: [id("arena")] } });
  assert.equal(engine.state.cards[id("arena")].zone, "discard", "5 damage on life 5");
});

// --- Creaky Old Swordsman --------------------------------------------------
// (no rules text) Character (soldier), cost 3, threshold [R], 3 strength / 2 speed / 2 life.

const SWORDSMAN = "5a9fc075-3dd0-4832-a763-fab2dfdf8535";

clause(SWORDSMAN, "vanilla", "deploys for exactly its printed cost of 3 with [R]: refused one short and without [R]", () => {
  vanillaDeploys(SWORDSMAN, "rage", 3, 1);
});

clause(SWORDSMAN, "vanilla", "has its printed 3 strength / 2 speed / 2 life, is a soldier, and has no abilities or keywords", () => {
  vanillaInPlay(SWORDSMAN, { strength: 3, speed: 2, life: 2 }, "soldier");
});

clause(SWORDSMAN, "vanilla", "is destroyed by exactly 2 damage and survives 1", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sw", def: printing(SWORDSMAN), owner: P2, zone: "play" },
      { key: "zap1", def: zapTactic(1, "Zap1"), owner: P1, zone: "hand" },
      { key: "zap1b", def: zapTactic(1, "Zap1b"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zap1"), { selected: { t: [id("sw")] } });
  assert.equal(engine.state.cards[id("sw")].zone, "play", "1 damage on life 2");
  play(engine, P1, id("zap1b"), { selected: { t: [id("sw")] } });
  assert.equal(engine.state.cards[id("sw")].zone, "discard", "2 damage on life 2");
});

// --- Bask Bile -------------------------------------------------------------
// COST: Pick a character or faction. -- EFFECT: Inflict 5 damage to the
// character or faction. Tactic, cost 7, threshold [R][R].

const BILE = "50782d20-e33e-4e94-9f96-43e6b575c4c1";

function bileBoard(opts: { rage?: number; greed?: number; p2Influence?: number; p1Influence?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.p1Influence },
    playerB: { faction: developFaction(), influence: opts.p2Influence },
    cards: [
      { key: "bile", def: printing(BILE), owner: P1, zone: "hand" },
      { key: "big", def: character({ name: "Big", life: 9 }), owner: P2, zone: "play" },
      { key: "small", def: character({ name: "Small", life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 3 }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      ...bank("rage", opts.rage ?? 7, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(BILE, "0:ability", "inflicts exactly 5 damage to a character (it survives with 5 damage on 9 life), and the cost of 7 is paid", () => {
  const { engine, id } = bileBoard();
  const before = ready(engine);
  play(engine, P1, id("bile"), { selected: { t: [id("big")] } });
  assert.equal(before - ready(engine), 7, "the printed cost of 7 is paid");
  assert.equal(engine.state.cards[id("big")].damage, 5);
  assert.equal(engine.state.cards[id("big")].zone, "play");
  assert.equal(engine.state.cards[id("small")].damage, 0, "other characters are untouched");
  assert.equal(engine.state.cards[id("mine")].damage, 0);
  assert.equal(engine.state.cards[id("bile")].zone, "discard");
});

clause(BILE, "0:ability", "5 damage destroys a character with 5 life", () => {
  const { engine, id } = bileBoard();
  play(engine, P1, id("bile"), { selected: { t: [id("small")] } });
  assert.equal(engine.state.cards[id("small")].zone, "discard");
});

clause(BILE, "0:ability", "can pick your own character too", () => {
  const { engine, id } = bileBoard();
  play(engine, P1, id("bile"), { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].zone, "discard", "5 damage on 5 life");
});

clause(BILE, "0:ability", "can pick a faction: 5 damage to the opponent's faction makes it lose 5 influence (CR 408.3), and yours is untouched", () => {
  const { engine, id } = bileBoard();
  const factionB = engine.state.players[P2].factionId!;
  const p2 = engine.state.players[P2].influence;
  const p1 = engine.state.players[P1].influence;
  play(engine, P1, id("bile"), { selected: { t: [factionB] } });
  assert.equal(engine.state.players[P2].influence, p2 - 5);
  assert.equal(engine.state.players[P1].influence, p1);
});

clause(BILE, "0:ability", "can pick your own faction: you lose 5 influence", () => {
  const { engine, id } = bileBoard();
  const factionA = engine.state.players[P1].factionId!;
  const p1 = engine.state.players[P1].influence;
  const p2 = engine.state.players[P2].influence;
  play(engine, P1, id("bile"), { selected: { t: [factionA] } });
  assert.equal(engine.state.players[P1].influence, p1 - 5);
  assert.equal(engine.state.players[P2].influence, p2);
});

clause(BILE, "0:ability", "5 damage to a faction at 5 influence reduces it to 0 and its owner loses the game", () => {
  const { engine, id } = bileBoard({ p2Influence: 5 });
  play(engine, P1, id("bile"), { selected: { t: [engine.state.players[P2].factionId!] } });
  assert.equal(engine.state.players[P2].influence, 0);
  assert.equal(engine.state.winner, P1);
});

clause(BILE, "0:ability", "only a character or a faction can be picked: an item, a location and a face-down card are refused", () => {
  const { engine, id } = bileBoard();
  const attempt = (t: string) => () => playRaw(engine, P1, id("bile"), { selected: { t: [t] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(() => playRaw(engine, P1, id("bile"), { selected: { t: [] } }), "no pick");
  assert.throws(() => playRaw(engine, P1, id("bile"), { selected: { t: [id("big"), id("small")] } }), "two picks");
  assert.equal(engine.state.cards[id("bile")].zone, "hand");
  attempt(id("big"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
});

clause(BILE, "0:ability", "is refused one resource short of its cost of 7, and with fewer than two [R] even with plenty of other resources", () => {
  const short = bileBoard({ rage: 6 });
  assert.throws(() => playRaw(short.engine, P1, short.id("bile"), { selected: { t: [short.id("big")] } }));
  const oneR = bileBoard({ rage: 1, greed: 8 });
  assert.throws(() => playRaw(oneR.engine, P1, oneR.id("bile"), { selected: { t: [oneR.id("big")] } }), "only one [R]");
  const mixed = bileBoard({ rage: 2, greed: 5 });
  play(mixed.engine, P1, mixed.id("bile"), { selected: { t: [mixed.id("big")] } });
  assert.equal(mixed.engine.state.cards[mixed.id("big")].damage, 5, "[R][R] plus five other resources is enough");
});

// --- Berserker Corps -------------------------------------------------------
// This card gains 1 strength for each token on it. -- At the start of your
// turn, you may destroy a character you control. If you don't, destroy this
// card. If you do, put X tokens on this card, where X is the destroyed
// character's strength. Character (berserker), cost 3, threshold [R][R][R],
// 5 strength / 3 speed / 5 life.

const CORPS = "9c05a49b-ee31-4b4f-a2da-6ab515d3cb37";

/** P2 is active on turn 2; ending P2's turn starts P1's turn, which fires the Corps' trigger. */
function corpsBoard(opts: { tokens?: number; extra?: CardPlacement[]; mateStrength?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "bc", def: printing(CORPS), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : undefined },
      { key: "mate", def: character({ name: "Mate", strength: opts.mateStrength ?? 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mate2", def: character({ name: "Mate2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

for (const tokens of [0, 1, 4]) {
  clause(CORPS, "0:rule", `with ${tokens} tokens on it, it has ${5 + tokens} strength (printed 5 + 1 per token) and its printed 3 speed / 5 life`, () => {
    const { engine, id } = buildGame({ cards: [{ key: "bc", def: printing(CORPS), owner: P1, zone: "play", counters: tokens ? { token: tokens } : undefined }] });
    assert.equal(engine.getStat(id("bc"), "strength"), 5 + tokens);
    assert.equal(engine.getStat(id("bc"), "speed"), 3);
    assert.equal(engine.getStat(id("bc"), "life"), 5, "life gets no bonus");
  });
}

clause(CORPS, "0:rule", "only tokens on this card count: tokens on another card do nothing for it", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "bc", def: printing(CORPS), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1 }), owner: P1, zone: "play", counters: { token: 4 } }
    ]
  });
  assert.equal(engine.getStat(id("bc"), "strength"), 5);
  assert.equal(engine.getStat(id("mate"), "strength"), 1, "and the Corps' rule gives nothing to others");
});

clause(CORPS, "0:rule", "deploys for its printed cost of 3 with [R][R][R]: refused one short and with fewer than three [R]", () => {
  vanillaDeploys(CORPS, "rage", 3, 3);
});

clause(CORPS, "1:rule", "you may destroy a character you control: it is destroyed, and the Corps gets tokens equal to ITS strength (3 tokens, so 8 strength)", () => {
  const { engine, id } = corpsBoard();
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "your turn has started");
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.ok(pc, "you are asked");
  assert.equal(pc.playerId, P1);
  answerPick2(engine, P1, [id("mate")]);
  assert.equal(engine.state.cards[id("mate")].zone, "discard", "the character is destroyed");
  assert.equal(engine.state.cards[id("bc")].zone, "play", "the Corps survives");
  assert.equal(engine.state.cards[id("bc")].counters?.token, 3, "X = the destroyed character's strength");
  assert.equal(engine.getStat(id("bc"), "strength"), 8);
  assert.equal(engine.state.cards[id("mate2")].zone, "play", "other characters are untouched");
});

clause(CORPS, "1:rule", "X is the destroyed character's CURRENT strength (a character buffed to 6 gives 6 tokens)", () => {
  const buff = item({
    name: "Buff",
    attachTo: "character",
    behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 3 }] }] }
  });
  const { engine, id } = corpsBoard({ extra: [{ key: "buff", def: buff, owner: P1, zone: "play", attachedToKey: "mate" }] });
  assert.equal(engine.getStat(id("mate"), "strength"), 6);
  endTurn(engine, P2);
  answerPick2(engine, P1, [id("mate")]);
  assert.equal(engine.state.cards[id("bc")].counters?.token, 6);
  assert.equal(engine.getStat(id("bc"), "strength"), 11);
});

clause(CORPS, "1:rule", "destroying a 0-strength character puts 0 tokens and the Corps survives", () => {
  const { engine, id } = corpsBoard({ mateStrength: 0 });
  endTurn(engine, P2);
  answerPick2(engine, P1, [id("mate")]);
  assert.equal(engine.state.cards[id("mate")].zone, "discard");
  assert.equal(engine.state.cards[id("bc")].zone, "play");
  assert.equal(engine.state.cards[id("bc")].counters?.token ?? 0, 0);
  assert.equal(engine.getStat(id("bc"), "strength"), 5);
});

clause(CORPS, "1:rule", "new tokens are added to the ones it already has", () => {
  const { engine, id } = corpsBoard({ tokens: 2 });
  endTurn(engine, P2);
  answerPick2(engine, P1, [id("mate2")]);
  assert.equal(engine.state.cards[id("bc")].counters?.token, 4, "2 + the destroyed character's strength 2");
  assert.equal(engine.getStat(id("bc"), "strength"), 9);
});

clause(CORPS, "1:rule", "if you don't destroy a character, the Corps is destroyed and your characters are left alone", () => {
  const { engine, id } = corpsBoard();
  endTurn(engine, P2);
  answerPick2(engine, P1, []);
  assert.equal(engine.state.cards[id("bc")].zone, "discard", "the Corps is destroyed");
  for (const key of ["mate", "mate2"]) assert.equal(engine.state.cards[id(key)].zone, "play", `${key} survives`);
  assert.equal(engine.state.cards[id("foe")].zone, "play");
});

clause(CORPS, "1:rule", "the Corps itself is a character you control and can be the one destroyed", () => {
  const { engine, id } = corpsBoard();
  endTurn(engine, P2);
  answerPick2(engine, P1, [id("bc")]);
  assert.equal(engine.state.cards[id("bc")].zone, "discard");
  for (const key of ["mate", "mate2"]) assert.equal(engine.state.cards[id(key)].zone, "play", `${key} survives`);
});

clause(CORPS, "1:rule", "only a character YOU control can be destroyed: the opponent's character, an item and a faction are refused", () => {
  const { engine, id } = corpsBoard();
  endTurn(engine, P2);
  const attempt = (cardId: string) => () => answerPick2(engine, P1, [cardId]);
  assert.throws(attempt(id("foe")), "the opponent's character");
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(attempt(id("mate") + "-nope"), "a card that does not exist");
  assert.throws(() => answerPick2(engine, P1, [id("mate"), id("mate2")]), "only one character");
  assert.ok(engine.state.pendingChoice, "the prompt is still open after refusals");
  attempt(id("mate2"))();
  assert.equal(engine.state.cards[id("mate2")].zone, "discard");
});

clause(CORPS, "1:rule", "with no other character the Corps is destroyed if you decline (and may even destroy itself)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "bc", def: printing(CORPS), owner: P1, zone: "play" }]
  });
  endTurn(engine, P2);
  if (engine.state.pendingChoice) answerPick2(engine, P1, []);
  assert.equal(engine.state.cards[id("bc")].zone, "discard");
});

clause(CORPS, "1:rule", "does not happen at the start of the OPPONENT's turn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: [
      { key: "bc", def: printing(CORPS), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 3 }), owner: P1, zone: "play" }
    ]
  });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined, "no prompt at the start of their turn");
  assert.equal(engine.state.cards[id("bc")].zone, "play");
  assert.equal(engine.state.cards[id("mate")].zone, "play");
});

clause(CORPS, "1:rule", "an opponent's Corps asks THEM at the start of their turn, not you", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: [
      { key: "bc", def: printing(CORPS), owner: P2, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 4 }), owner: P1, zone: "play" }
    ]
  });
  endTurn(engine, P1);
  const pc = engine.state.pendingChoice as unknown as { playerId: string };
  assert.equal(pc.playerId, P2);
  answerPick2(engine, P2, [id("theirs")]);
  assert.equal(engine.state.cards[id("bc")].counters?.token, 2);
  assert.equal(engine.state.cards[id("mine")].zone, "play");
});

// --- Bloodcurdling Bulldozer -----------------------------------------------
// If this card attacks, you may pick a character. If you do, deplete that
// character. Character (berserker), cost 3, threshold [R], 2 strength / 3 speed
// / 1 life.

const DOZER = "77287cd5-34b1-40b0-a3a5-9db4414743e8";

function dozerBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "dozer", def: printing(DOZER), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe1", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "tired", def: character({ name: "Tired", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play", depleted: true },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
}

clause(DOZER, "0:rule", "when it attacks you may pick an opponent's character: it is depleted, and so cannot block the attack", () => {
  const { engine, id } = dozerBoard();
  declareAttackBy(engine, P1, [id("dozer")]);
  const pc = engine.state.pendingChoice as unknown as { playerId: string };
  assert.ok(pc, "you are asked as the attack is declared");
  assert.equal(pc.playerId, P1);
  answerPick2(engine, P1, [id("foe1")]);
  assert.equal(engine.state.cards[id("foe1")].depleted, true, "depleted");
  assert.equal(engine.state.cards[id("foe2")].depleted, false, "another character is not");
  assert.equal(engine.state.cards[id("mate")].depleted, false);
  assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe1")] }), "a depleted character cannot block");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe2")] });
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe2")], "an undepleted character can");
});

clause(DOZER, "0:rule", "you may pick any character, including your own", () => {
  const { engine, id } = dozerBoard();
  declareAttackBy(engine, P1, [id("dozer")]);
  answerPick2(engine, P1, [id("mate")]);
  assert.equal(engine.state.cards[id("mate")].depleted, true);
  assert.equal(engine.state.cards[id("foe1")].depleted, false);
});

clause(DOZER, "0:rule", "it is optional: picking nothing depletes nothing and the attack goes on", () => {
  const { engine, id } = dozerBoard();
  declareAttackBy(engine, P1, [id("dozer")]);
  answerPick2(engine, P1, []);
  for (const key of ["mate", "foe1", "foe2"]) assert.equal(engine.state.cards[id(key)].depleted, false, `${key} stays ready`);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("dozer")]);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(DOZER, "0:rule", "only a character can be picked: an item, a location, a face-down card and a faction are refused; only one character", () => {
  const { engine, id } = dozerBoard();
  declareAttackBy(engine, P1, [id("dozer")]);
  const attempt = (ids: string[]) => () => answerPick2(engine, P1, ids);
  assert.throws(attempt([id("thing")]), "an item");
  assert.throws(attempt([id("place")]), "a location");
  assert.throws(attempt([id("faceDown")]), "a face-down card");
  assert.throws(attempt([engine.state.players[P2].factionId!]), "a faction");
  assert.throws(attempt([id("foe1"), id("foe2")]), "'a character' means one");
  attempt([id("foe2")])();
  assert.equal(engine.state.cards[id("foe2")].depleted, true);
});

clause(DOZER, "0:rule", "an already-depleted character may be picked and simply stays depleted", () => {
  const { engine, id } = dozerBoard();
  declareAttackBy(engine, P1, [id("dozer")]);
  answerPick2(engine, P1, [id("tired")]);
  assert.equal(engine.state.cards[id("tired")].depleted, true);
});

clause(DOZER, "0:rule", "it triggers once when the Bulldozer attacks together with another character", () => {
  const { engine, id } = dozerBoard();
  declareAttackBy(engine, P1, [id("dozer"), id("mate")]);
  answerPick2(engine, P1, [id("foe1")]);
  assert.equal(engine.state.pendingChoice, undefined, "only one prompt");
  assert.equal(engine.state.cards[id("foe1")].depleted, true);
  assert.equal(engine.state.cards[id("foe2")].depleted, false);
});

clause(DOZER, "0:rule", "does not trigger when a different character attacks without it", () => {
  const { engine, id } = dozerBoard();
  declareAttackBy(engine, P1, [id("mate")]);
  assert.equal(engine.state.pendingChoice, undefined);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("foe1")].depleted, false);
});

clause(DOZER, "0:rule", "does not trigger when the Bulldozer blocks", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "dozer", def: printing(DOZER), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" },
      { key: "raider", def: character({ name: "Raider", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("raider")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("dozer")] });
  assert.equal(engine.state.pendingChoice, undefined, "blocking is not attacking");
  assert.equal(engine.state.cards[id("mate")].depleted, false);
});

clause(DOZER, "0:rule", "deploys for its printed cost of 3 with [R] and has 2 strength / 3 speed / 1 life", () => {
  vanillaDeploys(DOZER, "rage", 3, 1);
  const { engine, id } = buildGame({ cards: [{ key: "dozer", def: printing(DOZER), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("dozer"), "strength"), 2);
  assert.equal(engine.getStat(id("dozer"), "speed"), 3);
  assert.equal(engine.getStat(id("dozer"), "life"), 1);
  assert.ok(engine.getSubtypes(id("dozer")).includes("berserker"), "engine.getSubtypes(id(\"dozer\")).includes(\"berserker\")");
});

// --- Cannon Squadron -------------------------------------------------------
// FIRE! -- COST: Deplete this card, pick up to 2 characters. -- EFFECT:
// Inflict up to 2 damage divided however you want to the characters.
// Character (soldier), cost 9, threshold [R][R], 1 strength / 3 speed / 1 life.

const CANNON = "e7d5d2a9-182a-4dfa-b844-8cf9d9dcc353";

function cannonBoard(opts: { attackEligible?: boolean; depleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cs", def: printing(CANNON), owner: P1, zone: "play", attackEligible: opts.attackEligible, depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine", life: 6 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe1", life: 6 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 6 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", life: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
}

/** Fires with the picked cards, then answers the division prompt with `shares` (card key -> damage). */
function cannonFire(board: ReturnType<typeof cannonBoard>, picks: string[], shares?: Record<string, number>) {
  const { engine, id } = board;
  activateRaw(engine, P1, id("cs"), "cannon-squadron-fire", { picked: picks.map(id) });
  resolvePendingResponses(engine);
  if (shares) {
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.equal(pc?.kind, "distributeAmong", "you are asked how to divide the damage");
    assert.equal(pc.playerId, P1, "you divide it");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "distributeAmong", shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [id(k), v])) }
    } as never);
    resolvePendingResponses(engine);
  }
}

const damageOf = (board: ReturnType<typeof cannonBoard>, key: string) => board.engine.state.cards[board.id(key)].damage;

clause(CANNON, "0:ability:cannon-squadron-fire", "depletes the Squadron as the cost (on activation), picks 2 characters, and divides 2 damage 1 and 1", () => {
  const board = cannonBoard();
  const { engine, id } = board;
  activateRaw(engine, P1, id("cs"), "cannon-squadron-fire", { picked: [id("foe1"), id("foe2")] });
  assert.equal(engine.state.cards[id("cs")].depleted, true, "COST: deplete this card, paid on activation");
  resolvePendingResponses(engine);
  assert.equal((engine.state.pendingChoice as unknown as { kind: string }).kind, "distributeAmong");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [id("foe1")]: 1, [id("foe2")]: 1 } } } as never);
  resolvePendingResponses(engine);
  assert.equal(damageOf(board, "foe1"), 1);
  assert.equal(damageOf(board, "foe2"), 1);
  assert.equal(damageOf(board, "mine"), 0, "an unpicked character is untouched");
  assert.equal(damageOf(board, "weak"), 0);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "all 2 damage can go to one of the two picked characters (2 and 0)", () => {
  const board = cannonBoard();
  cannonFire(board, ["foe1", "foe2"], { foe1: 2 });
  assert.equal(damageOf(board, "foe1"), 2);
  assert.equal(damageOf(board, "foe2"), 0);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "with a single pick, that character takes all 2 damage", () => {
  const board = cannonBoard();
  cannonFire(board, ["foe1"], { foe1: 2 });
  assert.equal(damageOf(board, "foe1"), 2);
  assert.equal(damageOf(board, "foe2"), 0);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "'up to 2' damage: you may inflict only 1 damage in total", () => {
  const board = cannonBoard();
  cannonFire(board, ["foe1", "foe2"], { foe1: 1 });
  assert.equal(damageOf(board, "foe1"), 1);
  assert.equal(damageOf(board, "foe2"), 0);
  assert.equal(board.engine.state.pendingChoice, undefined);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "'up to 2' damage: you may inflict no damage at all", () => {
  const board = cannonBoard();
  cannonFire(board, ["foe1", "foe2"], {});
  assert.equal(damageOf(board, "foe1"), 0);
  assert.equal(damageOf(board, "foe2"), 0);
  assert.equal(board.engine.state.pendingChoice, undefined);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "more than 2 damage cannot be inflicted, and damage cannot go to a character that was not picked", () => {
  const board = cannonBoard();
  const { engine, id } = board;
  activateRaw(engine, P1, id("cs"), "cannon-squadron-fire", { picked: [id("foe1"), id("foe2")] });
  resolvePendingResponses(engine);
  const answer = (shares: Record<string, number>) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [id(k), v])) } } as never);
  assert.throws(answer({ foe1: 2, foe2: 1 }), "3 damage");
  assert.throws(answer({ foe1: 3 }), "3 damage on one character");
  assert.throws(answer({ foe1: 1, weak: 1 }), "damage to a character that was not picked");
  assert.throws(answer({ foe1: -1, foe2: 3 }), "a negative share");
  assert.equal(damageOf(board, "foe1"), 0, "nothing was inflicted by the refused answers");
  answer({ foe1: 1, foe2: 1 })();
});

clause(CANNON, "0:ability:cannon-squadron-fire", "'up to 2' characters: you may pick none; it still costs the deplete and inflicts nothing", () => {
  const board = cannonBoard();
  cannonFire(board, []);
  assert.equal(board.engine.state.cards[board.id("cs")].depleted, true);
  assert.equal(board.engine.state.pendingChoice, undefined, "nothing to divide");
  for (const key of ["mine", "foe1", "foe2", "weak"]) assert.equal(damageOf(board, key), 0, `${key} untouched`);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "no more than 2 characters can be picked", () => {
  const board = cannonBoard();
  const { engine, id } = board;
  assert.throws(() => activateRaw(engine, P1, id("cs"), "cannon-squadron-fire", { picked: [id("foe1"), id("foe2"), id("mine")] }), "three characters");
  assert.equal(engine.state.cards[id("cs")].depleted, false, "a refused activation deplete nothing");
});

clause(CANNON, "0:ability:cannon-squadron-fire", "only characters can be picked, and the same one cannot be picked twice", () => {
  const board = cannonBoard();
  const { engine, id } = board;
  const attempt = (ids: string[]) => () => activateRaw(engine, P1, id("cs"), "cannon-squadron-fire", { picked: ids });
  assert.throws(attempt([id("thing")]), "an item");
  assert.throws(attempt([id("place")]), "a location");
  assert.throws(attempt([id("faceDown")]), "a face-down card");
  assert.throws(attempt([engine.state.players[P2].factionId!]), "a faction");
  assert.throws(attempt([id("foe1"), id("foe1")]), "the same character twice");
  assert.equal(engine.state.cards[id("cs")].depleted, false);
  attempt([id("foe1"), id("mine")])();
  assert.ok(engine.state.responseWindow, "two characters of either side are accepted");
});

clause(CANNON, "0:ability:cannon-squadron-fire", "your own characters can be picked and damaged too, and so can the Squadron itself", () => {
  const board = cannonBoard();
  cannonFire(board, ["mine", "cs"], { mine: 1, cs: 1 });
  assert.equal(damageOf(board, "mine"), 1);
  assert.equal(board.engine.state.cards[board.id("cs")].zone, "discard", "1 damage destroys the 1-life Squadron");
});

clause(CANNON, "0:ability:cannon-squadron-fire", "damage is real: 1 damage destroys a 1-life character and 2 damage on a 6-life character does not", () => {
  const board = cannonBoard();
  cannonFire(board, ["weak", "foe1"], { weak: 1, foe1: 1 });
  assert.equal(board.engine.state.cards[board.id("weak")].zone, "discard");
  assert.equal(board.engine.state.cards[board.id("foe1")].zone, "play");
  assert.equal(damageOf(board, "foe1"), 1);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "cannot be used while depleted, and is usable again after it is restored at the start of your next turn", () => {
  const depleted = cannonBoard({ depleted: true });
  assert.throws(() => activateRaw(depleted.engine, P1, depleted.id("cs"), "cannon-squadron-fire", { picked: [depleted.id("foe1")] }));
  assert.equal(damageOf(depleted, "foe1"), 0);

  const board = cannonBoard();
  cannonFire(board, ["foe1"], { foe1: 2 });
  assert.throws(() => activateRaw(board.engine, P1, board.id("cs"), "cannon-squadron-fire", { picked: [board.id("foe2")] }), "depleted by the cost");
  endTurn(board.engine, P1);
  endTurn(board.engine, P2);
  assert.equal(board.engine.state.cards[board.id("cs")].depleted, false, "restored");
  cannonFire(board, ["foe2"], { foe2: 2 });
  assert.equal(damageOf(board, "foe2"), 2);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "can be used the turn it enters play, and only by its controller", () => {
  const board = cannonBoard({ attackEligible: false });
  assert.throws(() => activateRaw(board.engine, P2, board.id("cs"), "cannon-squadron-fire", { picked: [board.id("mine")] }), "the opponent cannot use it");
  assert.equal(board.engine.state.cards[board.id("cs")].depleted, false);
  cannonFire(board, ["foe1"], { foe1: 2 });
  assert.equal(damageOf(board, "foe1"), 2, "abilities work the turn a character arrives (CR 204.3a)");
});

clause(CANNON, "0:ability:cannon-squadron-fire", "deploys for its printed cost of 9 with [R][R] and has 1 strength / 3 speed / 1 life", () => {
  vanillaDeploys(CANNON, "rage", 9, 2);
  const { engine, id } = buildGame({ cards: [{ key: "cs", def: printing(CANNON), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("cs"), "strength"), 1);
  assert.equal(engine.getStat(id("cs"), "speed"), 3);
  assert.equal(engine.getStat(id("cs"), "life"), 1);
  assert.ok(engine.getSubtypes(id("cs")).includes("soldier"), "engine.getSubtypes(id(\"cs\")).includes(\"soldier\")");
});

// --- Crazed Deputy ---------------------------------------------------------
// If this card is blocked, it gains 2 strength and 2 life this turn.
// Character (tyrant), cost 1, threshold [R], 1 strength / 3 speed / 1 life.

const DEPUTY = "0739c1ee-433e-4103-903f-0405c7aee707";

function deputyBoard(opts: { blkStrength?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "cd", def: printing(DEPUTY), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: opts.blkStrength ?? 2, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(DEPUTY, "0:rule", "when it is blocked it gains exactly 2 strength and 2 life (not speed): 3 / 3 / 3", () => {
  const { engine, id } = deputyBoard();
  assert.equal(engine.getStat(id("cd"), "strength"), 1);
  declareAttackBy(engine, P1, [id("cd")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("cd"), "strength"), 3);
  assert.equal(engine.getStat(id("cd"), "life"), 3);
  assert.equal(engine.getStat(id("cd"), "speed"), 3, "speed unchanged");
});

clause(DEPUTY, "0:rule", "the extra life and strength matter in the fight: a blocker with 2 strength does not kill the 1-life Deputy, and the Deputy hits for 3", () => {
  const board = deputyBoard();
  const { engine, id } = board;
  declareAttackBy(engine, P1, [id("cd")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("cd")].zone, "play", "it survived 2 damage (life 3)");
  assert.equal(engine.state.cards[id("cd")].damage, 2);
  assert.equal(engine.state.cards[id("blk")].damage, 3, "it dealt 3 damage (strength 3)");
});

clause(DEPUTY, "0:rule", "an unblocked Deputy gains nothing (declaring no blockers)", () => {
  const { engine, id } = deputyBoard();
  declareAttackBy(engine, P1, [id("cd")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("cd"), "strength"), 1, "unblocked: no gain");
  assert.equal(engine.getStat(id("cd"), "life"), 1);
});

clause(DEPUTY, "0:rule", "the gain lasts this turn only", () => {
  const { engine, id } = deputyBoard();
  declareAttackBy(engine, P1, [id("cd")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("cd"), "strength"), 3, "still this turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("cd"), "strength"), 1, "gone");
  assert.equal(engine.getStat(id("cd"), "life"), 1);
});

clause(DEPUTY, "0:rule", "blocking does not trigger it: when the Deputy is the blocker it gains nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cd", def: printing(DEPUTY), owner: P1, zone: "play" },
      { key: "raider", def: character({ name: "Raider", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("raider")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("cd")] });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("cd"), "strength"), 1);
  assert.equal(engine.getStat(id("cd"), "life"), 1);
});

clause(DEPUTY, "0:rule", "only the Deputy gains: its fellow attacker keeps its stats", () => {
  const { engine, id } = deputyBoard();
  declareAttackBy(engine, P1, [id("cd"), id("mate")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("mate"), "strength"), 1);
  assert.equal(engine.getStat(id("mate"), "life"), 4);
});

clause(DEPUTY, "0:rule", "an attacking party that includes the Deputy and is blocked counts as the Deputy being blocked", () => {
  const { engine, id } = deputyBoard();
  declareAttackBy(engine, P1, [id("cd"), id("mate")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk"), id("blk2")] });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("cd"), "strength"), 3);
  assert.equal(engine.getStat(id("cd"), "life"), 3);
});

clause(DEPUTY, "0:rule", "a Deputy that is not attacking is unaffected when other characters are blocked", () => {
  const { engine, id } = deputyBoard();
  declareAttackBy(engine, P1, [id("mate")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("cd"), "strength"), 1);
  assert.equal(engine.getStat(id("cd"), "life"), 1);
});

clause(DEPUTY, "0:rule", "deploys for its printed cost of 1 with [R] and has 1 strength / 3 speed / 1 life", () => {
  vanillaDeploys(DEPUTY, "rage", 1, 1);
  const { engine, id } = buildGame({ cards: [{ key: "cd", def: printing(DEPUTY), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("cd"), "strength"), 1);
  assert.equal(engine.getStat(id("cd"), "speed"), 3);
  assert.equal(engine.getStat(id("cd"), "life"), 1);
  assert.ok(engine.getSubtypes(id("cd")).includes("tyrant"), "engine.getSubtypes(id(\"cd\")).includes(\"tyrant\")");
});

// --- Dragon Catheter -------------------------------------------------------
// At the start of your turn, you must put a token on the character with the
// highest strength. If there is a tie, you pick which character gets the token.
// -- All characters gain 1 strength for each token on them.
// Item, cost 3, threshold [R][R].

const CATHETER = "2fcbb91a-300a-4efb-b045-1de22cb5ca2d";

/** P2 is active on turn 2; ending P2's turn starts P1's turn, which fires the Catheter. */
function catheterBoard(opts: { extra?: CardPlacement[]; mineStrength?: number; foeStrength?: number; foe2Strength?: number; owner?: Seat; turn?: number; active?: Seat; cathIn?: "play" | "hand" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "cath", def: printing(CATHETER), owner: opts.owner ?? P1, zone: opts.cathIn ?? "play" },
      { key: "mine", def: character({ name: "Mine", strength: opts.mineStrength ?? 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: opts.foeStrength ?? 5, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: opts.foe2Strength ?? 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "huge", def: character({ name: "Huge", strength: 99 }), owner: P2, zone: "play", faceDown: true },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

const tokensOn = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].counters?.token ?? 0;

clause(CATHETER, "0:rule", "at the start of your turn a token goes on the character with the highest strength, even an opponent's", () => {
  const { engine, id } = catheterBoard();
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  if (engine.state.pendingChoice) answerPick2(engine, P1, [id("foe")]);
  assert.equal(tokensOn(engine, id("foe")), 1, "foe (strength 5) is the strongest character");
  assert.equal(tokensOn(engine, id("mine")), 0);
  assert.equal(tokensOn(engine, id("foe2")), 0);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(CATHETER, "0:rule", "your own character gets the token when it is the strongest", () => {
  const { engine, id } = catheterBoard({ mineStrength: 7 });
  endTurn(engine, P2);
  if (engine.state.pendingChoice) answerPick2(engine, P1, [id("mine")]);
  assert.equal(tokensOn(engine, id("mine")), 1);
  assert.equal(tokensOn(engine, id("foe")), 0);
});

clause(CATHETER, "0:rule", "'highest strength' is current strength: a character buffed above the others gets the token", () => {
  const buff = item({
    name: "Buff",
    attachTo: "character",
    behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 3 }] }] }
  });
  const { engine, id } = catheterBoard({ extra: [{ key: "buff", def: buff, owner: P1, zone: "play", attachedToKey: "mine" }] });
  assert.equal(engine.getStat(id("mine"), "strength"), 6, "setup: mine is 3 + 3, above foe's 5");
  endTurn(engine, P2);
  if (engine.state.pendingChoice) answerPick2(engine, P1, [id("mine")]);
  assert.equal(tokensOn(engine, id("mine")), 1);
  assert.equal(tokensOn(engine, id("foe")), 0);
});

clause(CATHETER, "0:rule", "a face-down card (not a character) and an item are never given the token, however strong", () => {
  const { engine, id } = catheterBoard();
  endTurn(engine, P2);
  if (engine.state.pendingChoice) answerPick2(engine, P1, [id("foe")]);
  assert.equal(tokensOn(engine, id("huge")), 0);
  assert.equal(tokensOn(engine, id("thing")), 0);
});

clause(CATHETER, "0:rule", "on a tie you pick which of the tied characters gets the token (yours)", () => {
  const { engine, id } = catheterBoard({ mineStrength: 5, foeStrength: 5 });
  endTurn(engine, P2);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.ok(pc, "you are asked");
  assert.equal(pc.playerId, P1, "you pick");
  answerPick2(engine, P1, [id("mine")]);
  assert.equal(tokensOn(engine, id("mine")), 1);
  assert.equal(tokensOn(engine, id("foe")), 0, "the other tied character gets none");
});

clause(CATHETER, "0:rule", "on a tie you may pick the opponent's character instead", () => {
  const { engine, id } = catheterBoard({ mineStrength: 5, foeStrength: 5 });
  endTurn(engine, P2);
  answerPick2(engine, P1, [id("foe")]);
  assert.equal(tokensOn(engine, id("foe")), 1);
  assert.equal(tokensOn(engine, id("mine")), 0);
});

clause(CATHETER, "0:rule", "the token must go on one of the tied characters: a weaker character is refused", () => {
  const { engine, id } = catheterBoard({ mineStrength: 5, foeStrength: 5 });
  endTurn(engine, P2);
  assert.throws(() => answerPick2(engine, P1, [id("foe2")]), "foe2 has strength 2");
  assert.equal(tokensOn(engine, id("foe2")), 0);
  answerPick2(engine, P1, [id("foe")]);
  assert.equal(tokensOn(engine, id("foe")), 1);
});

clause(CATHETER, "0:rule", "it is mandatory ('you must'): you cannot decline, and cannot give the token to two characters", () => {
  const { engine, id } = catheterBoard({ mineStrength: 5, foeStrength: 5 });
  endTurn(engine, P2);
  assert.throws(() => answerPick2(engine, P1, []), "declining is not allowed");
  assert.throws(() => answerPick2(engine, P1, [id("mine"), id("foe")]), "one token, one character");
  assert.ok(engine.state.pendingChoice, "still waiting for a legal answer");
  assert.equal(tokensOn(engine, id("mine")) + tokensOn(engine, id("foe")), 0);
  answerPick2(engine, P1, [id("mine")]);
  assert.equal(tokensOn(engine, id("mine")), 1);
});

clause(CATHETER, "0:rule", "with a single strongest character, only that character can receive the token", () => {
  const { engine, id } = catheterBoard();
  endTurn(engine, P2);
  assert.throws(() => answerPick2(engine, P1, [id("mine")]), "mine (3) is not the strongest (foe is 5)");
  assert.throws(() => answerPick2(engine, P1, []), "cannot decline");
  assert.equal(tokensOn(engine, id("mine")), 0);
  answerPick2(engine, P1, [id("foe")]);
  assert.equal(tokensOn(engine, id("foe")), 1);
});

clause(CATHETER, "0:rule", "the token's own bonus counts the next time: the same character stays the strongest and collects one token per turn", () => {
  const { engine, id } = catheterBoard();
  endTurn(engine, P2);
  if (engine.state.pendingChoice) answerPick2(engine, P1, [id("foe")]);
  endTurn(engine, P1);
  endTurn(engine, P2);
  if (engine.state.pendingChoice) answerPick2(engine, P1, [id("foe")]);
  assert.equal(tokensOn(engine, id("foe")), 2);
  assert.equal(engine.getStat(id("foe"), "strength"), 7);
});

clause(CATHETER, "0:rule", "a tie is judged on current strength: once the token breaks a tie (4 vs 4), the token's own bonus makes that character the strict highest next turn", () => {
  const { engine, id } = catheterBoard({ mineStrength: 4, foeStrength: 4, foe2Strength: 1 });
  endTurn(engine, P2);
  answerPick2(engine, P1, [id("mine")]);
  assert.equal(engine.getStat(id("mine"), "strength"), 5);
  assert.equal(engine.getStat(id("foe"), "strength"), 4);
  endTurn(engine, P1);
  endTurn(engine, P2);
  if (engine.state.pendingChoice) {
    assert.throws(() => answerPick2(engine, P1, [id("foe")]), "foe (4) is no longer tied with mine (5)");
    answerPick2(engine, P1, [id("mine")]);
  }
  assert.equal(tokensOn(engine, id("mine")), 2);
  assert.equal(tokensOn(engine, id("foe")), 0);
});

clause(CATHETER, "0:rule", "does not happen at the start of the OPPONENT's turn", () => {
  const { engine, id } = catheterBoard({ turn: 1, active: P1 });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined, "no prompt");
  for (const key of ["mine", "foe", "foe2"]) assert.equal(tokensOn(engine, id(key)), 0, `${key} has no token`);
});

clause(CATHETER, "0:rule", "an opponent-controlled Catheter fires at the start of THEIR turn, and they pick on a tie", () => {
  const { engine, id } = catheterBoard({ owner: P2, mineStrength: 5, foeStrength: 5, turn: 1, active: P1 });
  endTurn(engine, P1);
  const pc = engine.state.pendingChoice as unknown as { playerId: string };
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2, "the Catheter's controller picks");
  answerPick2(engine, P2, [id("mine")]);
  assert.equal(tokensOn(engine, id("mine")), 1, "they may even pick your character");
});

clause(CATHETER, "0:rule", "with no characters in play nothing happens and nothing breaks", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "cath", def: printing(CATHETER), owner: P1, zone: "play" }]
  });
  endTurn(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("cath")].zone, "play");
});

clause(CATHETER, "0:rule", "does nothing while it is only in your hand", () => {
  const { engine, id } = catheterBoard({ cathIn: "hand" });
  endTurn(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(engine, id("foe")), 0);
});

clause(CATHETER, "1:rule", "every character gains 1 strength per token on it: yours and the opponent's, and a character with no token gains nothing", () => {
  const { engine, id } = catheterBoard({
    extra: [{ key: "tok2", def: character({ name: "Tok2", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play", counters: { token: 2 } }]
  });
  engine.state.cards[id("foe")].counters = { token: 1 };
  engine.state.cards[id("mine")].counters = { token: 3 };
  assert.equal(engine.getStat(id("mine"), "strength"), 3 + 3);
  assert.equal(engine.getStat(id("foe"), "strength"), 5 + 1);
  assert.equal(engine.getStat(id("tok2"), "strength"), 1 + 2);
  assert.equal(engine.getStat(id("foe2"), "strength"), 2, "no token: no bonus");
});

clause(CATHETER, "1:rule", "only strength changes: life and speed are not affected", () => {
  const { engine, id } = catheterBoard();
  engine.state.cards[id("foe")].counters = { token: 4 };
  assert.equal(engine.getStat(id("foe"), "life"), 4);
  assert.equal(engine.getStat(id("foe"), "speed"), 2);
});

clause(CATHETER, "1:rule", "the bonus applies while the Catheter is in play and ends when it leaves play (the tokens stay on the cards)", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = catheterBoard({ extra: [{ key: "smash", def: smash, owner: P2, zone: "hand" }] });
  engine.state.cards[id("foe")].counters = { token: 2 };
  assert.equal(engine.getStat(id("foe"), "strength"), 7);
  play(engine, P2, id("smash"), { selected: { t: [id("cath")] } });
  assert.equal(engine.state.cards[id("cath")].zone, "discard");
  assert.equal(engine.getStat(id("foe"), "strength"), 5, "no bonus without the Catheter");
  assert.equal(tokensOn(engine, id("foe")), 2, "the tokens themselves stay");
});

clause(CATHETER, "1:rule", "an opponent's Catheter gives the same bonus to every character, including yours", () => {
  const { engine, id } = catheterBoard({ owner: P2 });
  engine.state.cards[id("mine")].counters = { token: 2 };
  assert.equal(engine.getStat(id("mine"), "strength"), 5);
});

clause(CATHETER, "1:rule", "tokens give no bonus without a Catheter in play", () => {
  const { engine, id } = buildGame({
    cards: [{ key: "mine", def: character({ name: "Mine", strength: 3 }), owner: P1, zone: "play", counters: { token: 2 } }]
  });
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "no Catheter, no bonus");
});

clause(CATHETER, "1:rule", "deploys for its printed cost of 3 with [R][R]", () => {
  vanillaDeploys(CATHETER, "rage", 3, 2);
});

// --- Dragon Juice ----------------------------------------------------------
// COST: Pick a character. -- EFFECT: This turn, the character gains 5 strength.
// Tactic, cost 2, threshold [R].

const JUICE = "515bd953-5632-4e72-9233-53a8ed9af611";

function juiceBoard(opts: { rage?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dj", def: printing(JUICE), owner: P1, zone: "hand" },
      { key: "dj2", def: printing(JUICE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(JUICE, "0:ability", "the picked character gains exactly 5 strength this turn (not life or speed); the cost of 2 is paid", () => {
  const { engine, id } = juiceBoard();
  const before = ready(engine);
  play(engine, P1, id("dj"), { selected: { target: [id("mine")] } });
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(engine.getStat(id("mine"), "strength"), 7);
  assert.equal(engine.getStat(id("mine"), "life"), 4);
  assert.equal(engine.getStat(id("mine"), "speed"), 2);
  assert.equal(engine.state.cards[id("dj")].zone, "discard");
});

clause(JUICE, "0:ability", "only the picked character gains it: your other characters and the opponent's do not", () => {
  const { engine, id } = juiceBoard();
  play(engine, P1, id("dj"), { selected: { target: [id("mine")] } });
  assert.equal(engine.getStat(id("mate"), "strength"), 2);
  assert.equal(engine.getStat(id("foe"), "strength"), 3);
});

clause(JUICE, "0:ability", "can pick an opponent's character", () => {
  const { engine, id } = juiceBoard();
  play(engine, P1, id("dj"), { selected: { target: [id("foe")] } });
  assert.equal(engine.getStat(id("foe"), "strength"), 8);
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
});

clause(JUICE, "0:ability", "the bonus ends with the turn", () => {
  const { engine, id } = juiceBoard();
  play(engine, P1, id("dj"), { selected: { target: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "strength"), 7);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "and it does not come back");
});

clause(JUICE, "0:ability", "two Juices on one character stack to +10", () => {
  const { engine, id } = juiceBoard();
  play(engine, P1, id("dj"), { selected: { target: [id("mine")] } });
  play(engine, P1, id("dj2"), { selected: { target: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "strength"), 12);
});

clause(JUICE, "0:ability", "the extra strength is real in battle: a 2-strength attacker deals 7 damage", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "dj", def: printing(JUICE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "wall", def: character({ name: "Wall", strength: 0, life: 7, speed: 1 }), owner: P2, zone: "play" },
      ...bank("rage", 2, P1)
    ]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("wall")] });
  passUntil(engine, P1);
  play(engine, P1, id("dj"), { selected: { target: [id("atk")] } });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("wall")].zone, "discard", "7 damage destroys the 7-life wall");
});

clause(JUICE, "0:ability", "only a character can be picked: an item, a location, a face-down card and a faction are refused", () => {
  const { engine, id } = juiceBoard();
  const attempt = (t: string) => () => playRaw(engine, P1, id("dj"), { selected: { target: [t] } });
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(id("place")), "a location");
  assert.throws(attempt(id("faceDown")), "a face-down card");
  assert.throws(attempt(engine.state.players[P1].factionId!), "your faction");
  assert.throws(attempt(engine.state.players[P2].factionId!), "their faction");
  assert.throws(() => playRaw(engine, P1, id("dj"), { selected: { target: [] } }), "no pick");
  assert.throws(() => playRaw(engine, P1, id("dj"), { selected: { target: [id("mine"), id("mate")] } }), "two picks");
  assert.equal(engine.state.cards[id("dj")].zone, "hand");
  attempt(id("mine"))();
  assert.ok(engine.state.responseWindow, "a character is accepted");
});

clause(JUICE, "0:ability", "is refused one resource short of its cost of 2, and without [R]", () => {
  const short = juiceBoard({ rage: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("dj"), { selected: { target: [short.id("mine")] } }));
  const noR = juiceBoard({ rage: 0, greed: 6 });
  assert.throws(() => playRaw(noR.engine, P1, noR.id("dj"), { selected: { target: [noR.id("mine")] } }), "no [R]");
  const exact = juiceBoard({ rage: 2 });
  play(exact.engine, P1, exact.id("dj"), { selected: { target: [exact.id("mine")] } });
  assert.equal(exact.engine.getStat(exact.id("mine"), "strength"), 7, "[R] and exactly 2 resources is enough");
  const mixed = juiceBoard({ rage: 1, greed: 1 });
  play(mixed.engine, P1, mixed.id("dj"), { selected: { target: [mixed.id("mine")] } });
  assert.equal(mixed.engine.getStat(mixed.id("mine"), "strength"), 7, "one [R] plus any other resource");
});

// --- Dragon Rider ----------------------------------------------------------
// This card gains 1 strength and 1 life for each dragon card you control.
// Character (rider), cost 5, threshold [R][R], 3 strength / 3 speed / 3 life.

const RIDER = "f1baed39-da6d-4ef7-ae62-de3a84b2c159";

const dragonChar = (name: string, extra: string[] = []) => character({ name, subtype: ["dragon", ...extra], strength: 1, life: 3, speed: 1 });

function riderStats(extra: CardPlacement[]) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "rider", def: printing(RIDER), owner: P1, zone: "play" }, ...extra]
  });
  return { strength: engine.getStat(id("rider"), "strength"), life: engine.getStat(id("rider"), "life"), speed: engine.getStat(id("rider"), "speed"), engine, id };
}

clause(RIDER, "0:rule", "with no dragon cards it has its printed 3 strength / 3 speed / 3 life", () => {
  const s = riderStats([]);
  assert.deepEqual([s.strength, s.speed, s.life], [3, 3, 3]);
});

clause(RIDER, "0:rule", "gains 1 strength and 1 life per dragon you control: one dragon, then three (speed never changes)", () => {
  const one = riderStats([{ key: "d1", def: dragonChar("D1"), owner: P1, zone: "play" }]);
  assert.deepEqual([one.strength, one.life, one.speed], [4, 4, 3]);
  const three = riderStats([
    { key: "d1", def: dragonChar("D1"), owner: P1, zone: "play" },
    { key: "d2", def: dragonChar("D2"), owner: P1, zone: "play" },
    { key: "d3", def: dragonChar("D3"), owner: P1, zone: "play" }
  ]);
  assert.deepEqual([three.strength, three.life, three.speed], [6, 6, 3]);
});

clause(RIDER, "0:rule", "any type of dragon card counts: a dragon item and a dragon location as well as dragon characters", () => {
  const s = riderStats([
    { key: "d1", def: dragonChar("D1"), owner: P1, zone: "play" },
    { key: "d2", def: item({ name: "D2", subtype: ["dragon"] }), owner: P1, zone: "play" },
    { key: "d3", def: location({ name: "D3", subtype: ["dragon"] }), owner: P1, zone: "play" }
  ]);
  assert.deepEqual([s.strength, s.life], [6, 6]);
});

clause(RIDER, "0:rule", "only dragons you control: the opponent's dragons do not count, but a dragon you control and the opponent owns does", () => {
  const theirs = riderStats([{ key: "od", def: dragonChar("OD"), owner: P2, zone: "play" }]);
  assert.deepEqual([theirs.strength, theirs.life], [3, 3], "the opponent's dragon");
  const stolen = riderStats([{ key: "sd", def: dragonChar("SD"), owner: P2, controller: P1, zone: "play" }]);
  assert.deepEqual([stolen.strength, stolen.life], [4, 4], "a dragon you took");
  const lent = riderStats([{ key: "ld", def: dragonChar("LD"), owner: P1, controller: P2, zone: "play" }]);
  assert.deepEqual([lent.strength, lent.life], [3, 3], "a dragon you own but the opponent controls");
});

clause(RIDER, "0:rule", "only dragons in play count: a dragon in your hand, deck or discard pile does not", () => {
  const s = riderStats([
    { key: "h", def: dragonChar("H"), owner: P1, zone: "hand" },
    { key: "k", def: dragonChar("K"), owner: P1, zone: "deck" },
    { key: "x", def: dragonChar("X"), owner: P1, zone: "discard" }
  ]);
  assert.deepEqual([s.strength, s.life], [3, 3]);
});

clause(RIDER, "0:rule", "a face-down card is only a resource with no subtype, so a face-down dragon does not count", () => {
  const s = riderStats([{ key: "f", def: dragonChar("F"), owner: P1, zone: "play", faceDown: true }]);
  assert.deepEqual([s.strength, s.life], [3, 3], "a face-down card has no characteristics (CR 411.1)");
});

clause(RIDER, "0:rule", "non-dragons do not count, not even other riders or look-alike subtypes; a card with several subtypes counts once", () => {
  const none = riderStats([
    { key: "r2", def: character({ name: "R2", subtype: ["rider"] }), owner: P1, zone: "play" },
    { key: "dl", def: character({ name: "DL", subtype: ["dragonling"] }), owner: P1, zone: "play" },
    { key: "b", def: character({ name: "B", subtype: ["beast"] }), owner: P1, zone: "play" }
  ]);
  assert.deepEqual([none.strength, none.life], [3, 3]);
  const multi = riderStats([{ key: "m", def: dragonChar("M", ["beast", "rider"]), owner: P1, zone: "play" }]);
  assert.deepEqual([multi.strength, multi.life], [4, 4], "one card, one point");
});

clause(RIDER, "0:rule", "the bonus follows the board: it drops when a dragon leaves play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rider", def: printing(RIDER), owner: P1, zone: "play" },
      { key: "d1", def: dragonChar("D1"), owner: P1, zone: "play" },
      { key: "d2", def: dragonChar("D2"), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(engine.getStat(id("rider"), "strength"), 5);
  play(engine, P1, id("kill"), { selected: { t: [id("d1")] } });
  assert.equal(engine.getStat(id("rider"), "strength"), 4);
  assert.equal(engine.getStat(id("rider"), "life"), 4);
});

clause(RIDER, "0:rule", "the extra life is real: with two dragons (life 5) it survives 4 damage and dies to 5", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rider", def: printing(RIDER), owner: P1, zone: "play" },
      { key: "d1", def: dragonChar("D1"), owner: P1, zone: "play" },
      { key: "d2", def: dragonChar("D2"), owner: P1, zone: "play" },
      { key: "z4", def: zapTactic(4, "Z4"), owner: P1, zone: "hand" },
      { key: "z1", def: zapTactic(1, "Z1"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("z4"), { selected: { t: [id("rider")] } });
  assert.equal(engine.state.cards[id("rider")].zone, "play");
  play(engine, P1, id("z1"), { selected: { t: [id("rider")] } });
  assert.equal(engine.state.cards[id("rider")].zone, "discard");
});

clause(RIDER, "0:rule", "only the Rider itself gains: other characters keep their stats", () => {
  const s = riderStats([
    { key: "d1", def: dragonChar("D1"), owner: P1, zone: "play" },
    { key: "pal", def: character({ name: "Pal", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" }
  ]);
  assert.equal(s.engine.getStat(s.id("pal"), "strength"), 2);
  assert.equal(s.engine.getStat(s.id("d1"), "strength"), 1, "the dragon itself too");
});

clause(RIDER, "0:rule", "deploys for its printed cost of 5 with [R][R] and is a rider", () => {
  vanillaDeploys(RIDER, "rage", 5, 2);
  const s = riderStats([]);
  assert.ok(s.engine.getSubtypes(s.id("rider")).includes("rider"), "s.engine.getSubtypes(s.id(\"rider\")).includes(\"rider\")");
});

// --- Dragon Tank -----------------------------------------------------------
// At the start of your turn, you may destroy a character your opponent
// controls. If you don't, destroy this card instead. Character (dragon), cost
// 12, threshold [R][R][R][R][R], 10 strength / 4 speed / 10 life.

const TANK = "e055ac0a-49d8-4bb0-914b-b039336c5e97";

function tankBoard(opts: { foes?: boolean; owner?: Seat; turn?: number; active?: Seat } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "tank", def: printing(TANK), owner: opts.owner ?? P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      ...(opts.foes === false
        ? []
        : [
            { key: "foe1", def: character({ name: "Foe1", life: 3 }), owner: P2, zone: "play" } as CardPlacement,
            { key: "foe2", def: character({ name: "Foe2", life: 3 }), owner: P2, zone: "play" } as CardPlacement
          ]),
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
}

clause(TANK, "0:rule", "at the start of your turn you may destroy an opponent's character: it is destroyed and the Tank stays", () => {
  const { engine, id } = tankBoard();
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  const pc = engine.state.pendingChoice as unknown as { playerId: string };
  assert.ok(pc, "you are asked");
  assert.equal(pc.playerId, P1);
  answerPick2(engine, P1, [id("foe1")]);
  assert.equal(engine.state.cards[id("foe1")].zone, "discard");
  assert.equal(engine.state.cards[id("tank")].zone, "play", "the Tank survives");
  assert.equal(engine.state.cards[id("foe2")].zone, "play", "only the picked character");
  assert.equal(engine.state.cards[id("mine")].zone, "play");
});

clause(TANK, "0:rule", "if you don't, the Tank is destroyed instead and no opponent's character is", () => {
  const { engine, id } = tankBoard();
  endTurn(engine, P2);
  answerPick2(engine, P1, []);
  assert.equal(engine.state.cards[id("tank")].zone, "discard", "the Tank is destroyed");
  assert.equal(engine.state.players[P1].discard.includes(id("tank")), true);
  for (const key of ["foe1", "foe2", "mine"]) assert.equal(engine.state.cards[id(key)].zone, "play", `${key} is not destroyed`);
});

clause(TANK, "0:rule", "if there is no opponent's character to destroy the Tank is destroyed", () => {
  const { engine, id } = tankBoard({ foes: false });
  endTurn(engine, P2);
  if (engine.state.pendingChoice) answerPick2(engine, P1, []);
  assert.equal(engine.state.cards[id("tank")].zone, "discard");
  assert.equal(engine.state.cards[id("mine")].zone, "play");
});

clause(TANK, "0:rule", "only a character your OPPONENT controls can be destroyed: your own character, an item and a faction are refused", () => {
  const { engine, id } = tankBoard();
  endTurn(engine, P2);
  const attempt = (ids: string[]) => () => answerPick2(engine, P1, ids);
  assert.throws(attempt([id("mine")]), "your own character");
  assert.throws(attempt([id("tank")]), "the Tank itself");
  assert.throws(attempt([id("thing")]), "an item");
  assert.throws(attempt([id("faceDown")]), "a face-down card");
  assert.throws(attempt([engine.state.players[P2].factionId!]), "their faction");
  assert.throws(attempt([id("foe1"), id("foe2")]), "'a character' means one");
  assert.ok(engine.state.pendingChoice, "the prompt stays open");
  attempt([id("foe2")])();
  assert.equal(engine.state.cards[id("foe2")].zone, "discard");
});

clause(TANK, "0:rule", "does not happen at the start of the OPPONENT's turn", () => {
  const { engine, id } = tankBoard({ turn: 1, active: P1 });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("tank")].zone, "play");
  assert.equal(engine.state.cards[id("foe1")].zone, "play");
});

clause(TANK, "0:rule", "happens at the start of each of your turns", () => {
  const { engine, id } = tankBoard();
  endTurn(engine, P2);
  answerPick2(engine, P1, [id("foe1")]);
  endTurn(engine, P1);
  endTurn(engine, P2);
  answerPick2(engine, P1, [id("foe2")]);
  assert.equal(engine.state.cards[id("foe1")].zone, "discard");
  assert.equal(engine.state.cards[id("foe2")].zone, "discard");
  assert.equal(engine.state.cards[id("tank")].zone, "play");
});

clause(TANK, "0:rule", "an opponent-controlled Tank asks THEM at the start of their turn and destroys one of YOUR characters", () => {
  const { engine, id } = tankBoard({ owner: P2, turn: 1, active: P1 });
  endTurn(engine, P1);
  const pc = engine.state.pendingChoice as unknown as { playerId: string };
  assert.equal(pc.playerId, P2);
  answerPick2(engine, P2, [id("mine")]);
  assert.equal(engine.state.cards[id("mine")].zone, "discard");
  assert.equal(engine.state.cards[id("tank")].zone, "play");
});

clause(TANK, "0:rule", "deploys for its printed cost of 12 with five [R], and has 10 strength / 4 speed / 10 life", () => {
  vanillaDeploys(TANK, "rage", 12, 5);
  const { engine, id } = buildGame({ cards: [{ key: "tank", def: printing(TANK), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("tank"), "strength"), 10);
  assert.equal(engine.getStat(id("tank"), "speed"), 4);
  assert.equal(engine.getStat(id("tank"), "life"), 10);
  assert.ok(engine.getSubtypes(id("tank")).includes("dragon"), "engine.getSubtypes(id(\"tank\")).includes(\"dragon\")");
});

// --- Dragon's Anthem -------------------------------------------------------
// This turn, your characters gain 5 strength. Tactic, cost 10, threshold
// [R][R][R][R].

const ANTHEM = "eed47373-168e-4ab8-86e2-c0f63d47cc7f";

function anthemBoard(opts: { rage?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(ANTHEM), owner: P1, zone: "hand" },
      { key: "an2", def: printing(ANTHEM), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "M1", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "M2", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "F1", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(ANTHEM, "0:rule", "each of your characters gains exactly 5 strength this turn (not life or speed), and the cost of 10 is paid", () => {
  const { engine, id } = anthemBoard({ rage: 12 });
  const before = ready(engine);
  play(engine, P1, id("an"));
  assert.equal(before - ready(engine), 10, "the printed cost of 10 is paid");
  assert.equal(engine.getStat(id("m1"), "strength"), 6);
  assert.equal(engine.getStat(id("m2"), "strength"), 8);
  assert.equal(engine.getStat(id("m1"), "life"), 4);
  assert.equal(engine.getStat(id("m2"), "speed"), 3);
  assert.equal(engine.state.cards[id("an")].zone, "discard");
});

clause(ANTHEM, "0:rule", "the opponent's characters do not gain it", () => {
  const { engine, id } = anthemBoard();
  play(engine, P1, id("an"));
  assert.equal(engine.getStat(id("f1"), "strength"), 2);
});

clause(ANTHEM, "0:rule", "the bonus lasts this turn only", () => {
  const { engine, id } = anthemBoard();
  play(engine, P1, id("an"));
  assert.equal(engine.getStat(id("m1"), "strength"), 6);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("m1"), "strength"), 1);
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("m1"), "strength"), 1, "and it does not come back on your next turn");
  assert.equal(engine.getStat(id("m2"), "strength"), 3);
});

clause(ANTHEM, "0:rule", "two Anthems stack to +10", () => {
  const { engine, id } = anthemBoard({ rage: 20 });
  play(engine, P1, id("an"));
  play(engine, P1, id("an2"));
  assert.equal(engine.getStat(id("m1"), "strength"), 11);
});

clause(ANTHEM, "0:rule", "the strength is real in battle: a 1-strength attacker deals 6 damage after the Anthem", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "an", def: printing(ANTHEM), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "wall", def: character({ name: "Wall", strength: 0, life: 6, speed: 1 }), owner: P2, zone: "play" },
      ...bank("rage", 10, P1)
    ]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("wall")] });
  passUntil(engine, P1);
  play(engine, P1, id("an"));
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("wall")].zone, "discard", "6 damage destroys the 6-life wall");
});

clause(ANTHEM, "0:rule", "is refused one resource short of its cost of 10, and with fewer than four [R] even with plenty of other resources", () => {
  const short = anthemBoard({ rage: 9 });
  assert.throws(() => playRaw(short.engine, P1, short.id("an")));
  assert.equal(short.engine.state.cards[short.id("an")].zone, "hand");
  const threeR = anthemBoard({ rage: 3, greed: 9 });
  assert.throws(() => playRaw(threeR.engine, P1, threeR.id("an")), "only three [R]");
  const fourR = anthemBoard({ rage: 4, greed: 6 });
  play(fourR.engine, P1, fourR.id("an"));
  assert.equal(fourR.engine.getStat(fourR.id("m1"), "strength"), 6, "four [R] plus six other resources is enough");
  assert.equal(ready(fourR.engine), 0);
});

// --- Dragon's Quarters -----------------------------------------------------
// At the start of your turn, you may pick a character. If you do, this card
// inflicts X+1 damage to that character, where X is the number of "dragon"
// cards you control. Location, cost 2, threshold [R][R][R], structure 4.

const QUARTERS = "77196b4c-63df-4c4a-a016-c7f41217c1c8";

/** P2 is active on turn 2; ending P2's turn starts P1's turn, which fires the Quarters. */
function quartersBoard(opts: { extra?: CardPlacement[]; owner?: Seat; turn?: number; active?: Seat } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "dq", def: printing(QUARTERS), owner: opts.owner ?? P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", life: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      ...(opts.extra ?? [])
    ]
  });
}

const quartersFire = (board: ReturnType<typeof quartersBoard>, pick: string[]) => {
  endTurn(board.engine, P2);
  assert.equal(board.engine.state.activePlayerId, P1, "your turn has started");
  answerPick2(board.engine, P1, pick.map(board.id));
};

clause(QUARTERS, "0:rule", "with no dragons you control it inflicts 1 damage (X = 0, so X+1 = 1) to the picked character", () => {
  const board = quartersBoard();
  const { engine, id } = board;
  endTurn(engine, P2);
  const pc = engine.state.pendingChoice as unknown as { playerId: string };
  assert.ok(pc, "you are asked");
  assert.equal(pc.playerId, P1);
  answerPick2(engine, P1, [id("foe")]);
  assert.equal(engine.state.cards[id("foe")].damage, 1);
  assert.equal(engine.state.cards[id("mine")].damage, 0);
});

clause(QUARTERS, "0:rule", "each dragon card you control adds 1 damage: two dragons (a character and an item) make 3 damage", () => {
  const board = quartersBoard({
    extra: [
      { key: "d1", def: dragonChar("D1"), owner: P1, zone: "play" },
      { key: "d2", def: item({ name: "D2", subtype: ["dragon"] }), owner: P1, zone: "play" }
    ]
  });
  quartersFire(board, ["foe"]);
  assert.equal(board.engine.state.cards[board.id("foe")].damage, 3);
});

clause(QUARTERS, "0:rule", "four dragons make 5 damage", () => {
  const board = quartersBoard({
    extra: ["d1", "d2", "d3", "d4"].map((key) => ({ key, def: dragonChar(key.toUpperCase()), owner: P1, zone: "play" }) as CardPlacement)
  });
  quartersFire(board, ["foe"]);
  assert.equal(board.engine.state.cards[board.id("foe")].damage, 5);
});

clause(QUARTERS, "0:rule", "a face-down card is only a resource with no subtype, so a face-down dragon does not count", () => {
  const board = quartersBoard({ extra: [{ key: "fd", def: dragonChar("FD"), owner: P1, zone: "play", faceDown: true }] });
  quartersFire(board, ["foe"]);
  assert.equal(board.engine.state.cards[board.id("foe")].damage, 1, "X = 0: a face-down card has no characteristics (CR 411.1)");
});

clause(QUARTERS, "0:rule", "only dragons you control count: the opponent's dragons and dragons in other zones do not", () => {
  const board = quartersBoard({
    extra: [
      { key: "od", def: dragonChar("OD"), owner: P2, zone: "play" },
      { key: "hd", def: dragonChar("HD"), owner: P1, zone: "hand" },
      { key: "xd", def: dragonChar("XD"), owner: P1, zone: "discard" },
      { key: "nd", def: character({ name: "ND", subtype: ["beast"] }), owner: P1, zone: "play" }
    ]
  });
  quartersFire(board, ["foe"]);
  assert.equal(board.engine.state.cards[board.id("foe")].damage, 1, "X = 0");
});

clause(QUARTERS, "0:rule", "a dragon you control but the opponent owns counts", () => {
  const board = quartersBoard({ extra: [{ key: "sd", def: dragonChar("SD"), owner: P2, controller: P1, zone: "play" }] });
  quartersFire(board, ["foe"]);
  assert.equal(board.engine.state.cards[board.id("foe")].damage, 2);
});

clause(QUARTERS, "0:rule", "any character can be picked: your own (even a dragon), and damage can destroy it", () => {
  const own = quartersBoard({ extra: [{ key: "d1", def: dragonChar("D1"), owner: P1, zone: "play" }] });
  quartersFire(own, ["mine"]);
  assert.equal(own.engine.state.cards[own.id("mine")].damage, 2);
  const kill = quartersBoard();
  quartersFire(kill, ["weak"]);
  assert.equal(kill.engine.state.cards[kill.id("weak")].zone, "discard", "1 damage on 1 life");
});

clause(QUARTERS, "0:rule", "the location itself inflicts the damage (it is the source of the damage)", () => {
  const board = quartersBoard();
  quartersFire(board, ["foe"]);
  const hits = board.engine.getLog().filter((entry) => entry.event?.type === "damageDealt").map((entry) => entry.event as unknown as { sourceId?: string; targetId?: string; amount?: number });
  assert.ok(hits.some((hit) => hit.sourceId === board.id("dq") && hit.targetId === board.id("foe")), "a damageDealt event from the Quarters to the foe");
});

clause(QUARTERS, "0:rule", "it is optional: picking nothing inflicts no damage", () => {
  const board = quartersBoard();
  quartersFire(board, []);
  for (const key of ["mine", "foe", "weak"]) assert.equal(board.engine.state.cards[board.id(key)].damage, 0, `${key} untouched`);
  assert.equal(board.engine.state.cards[board.id("dq")].zone, "play");
});

clause(QUARTERS, "0:rule", "only a character can be picked: an item, a face-down card and a faction are refused; only one", () => {
  const board = quartersBoard();
  const { engine, id } = board;
  endTurn(engine, P2);
  const attempt = (ids: string[]) => () => answerPick2(engine, P1, ids);
  assert.throws(attempt([id("thing")]), "an item");
  assert.throws(attempt([id("faceDown")]), "a face-down card");
  assert.throws(attempt([engine.state.players[P2].factionId!]), "a faction");
  assert.throws(attempt([id("dq")]), "the location itself");
  assert.throws(attempt([id("foe"), id("mine")]), "two characters");
  attempt([id("foe")])();
  assert.equal(engine.state.cards[id("foe")].damage, 1);
});

clause(QUARTERS, "0:rule", "does not happen at the start of the OPPONENT's turn", () => {
  const board = quartersBoard({ turn: 1, active: P1 });
  endTurn(board.engine, P1);
  assert.equal(board.engine.state.activePlayerId, P2);
  assert.equal(board.engine.state.pendingChoice, undefined);
  assert.equal(board.engine.state.cards[board.id("foe")].damage, 0);
});

clause(QUARTERS, "0:rule", "an opponent-controlled Quarters asks THEM at the start of their turn, counts THEIR dragons, and can hit your character", () => {
  const board = quartersBoard({ owner: P2, turn: 1, active: P1, extra: [{ key: "od", def: dragonChar("OD"), owner: P2, zone: "play" }] });
  endTurn(board.engine, P1);
  const pc = board.engine.state.pendingChoice as unknown as { playerId: string };
  assert.equal(pc.playerId, P2);
  answerPick2(board.engine, P2, [board.id("mine")]);
  assert.equal(board.engine.state.cards[board.id("mine")].damage, 2, "1 dragon + 1");
});

clause(QUARTERS, "0:rule", "deploys for its printed cost of 2 with [R][R][R] and has structure 4", () => {
  const hand = (rage: number, greed: number, turn = 1, active: Seat = P1) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn,
      activePlayerId: active,
      cards: [{ key: "dq", def: printing(QUARTERS), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)]
    });
  const ok = hand(3, 0);
  play(ok.engine, P1, ok.id("dq"));
  assert.equal(ok.engine.state.cards[ok.id("dq")].zone, "play");
  assert.equal(ready(ok.engine), 1, "only the cost of 2 is spent; the third [R] is just threshold");
  assert.equal(ok.engine.getStat(ok.id("dq"), "structure"), 4);
  assert.ok(ok.engine.hasCardType(ok.id("dq"), "location"), "ok.engine.hasCardType(ok.id(\"dq\"), \"location\")");
  const twoR = hand(2, 5);
  assert.throws(() => playRaw(twoR.engine, P1, twoR.id("dq")), "only two [R]");
  const one = hand(1, 0);
  assert.throws(() => playRaw(one.engine, P1, one.id("dq")), "one resource");
  const offTurn = hand(3, 0, 2, P2);
  assert.throws(() => playRaw(offTurn.engine, P1, offTurn.id("dq")), "not on the opponent's turn");
});

clause(QUARTERS, "0:rule", "is destroyed by 4 damage (structure 4) and survives 3", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "dq", def: printing(QUARTERS), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "card", cardId: id("dq") } });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("dq")].zone, "play", "3 damage on structure 4");
  assert.equal(engine.state.cards[id("dq")].damage, 3);
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk2")], target: { type: "card", cardId: id("dq") } });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("dq")].zone, "discard", "4 damage in total");
});

// --- Dragon's Strategy -----------------------------------------------------
// Your opponent's faction loses 2 influence. Then, draw a card. Tactic, cost 3,
// threshold [R].

const STRATEGY = "463d51ef-13f3-4c9c-a90b-a1e1d63b8e98";

function strategyBoard(opts: { rage?: number; greed?: number; deck?: number; p2Influence?: number; p1Influence?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.p1Influence },
    playerB: { faction: developFaction(), influence: opts.p2Influence },
    cards: [
      { key: "ds", def: printing(STRATEGY), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...fillers("d", opts.deck ?? 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("rage", opts.rage ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(STRATEGY, "0:rule", "your opponent's faction loses exactly 2 influence, yours loses none, and the cost of 3 is paid", () => {
  const { engine, id } = strategyBoard();
  const p1 = engine.state.players[P1].influence;
  const p2 = engine.state.players[P2].influence;
  const before = ready(engine);
  play(engine, P1, id("ds"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(engine.state.players[P2].influence, p2 - 2);
  assert.equal(engine.state.players[P1].influence, p1);
  assert.equal(engine.state.cards[id("ds")].zone, "discard");
});

clause(STRATEGY, "0:rule", "then you draw exactly one card (the top of your deck), and the opponent draws none", () => {
  const { engine, id } = strategyBoard();
  const top = engine.state.players[P1].deck[0];
  const hand = engine.state.players[P1].hand.length;
  const oppHand = engine.state.players[P2].hand.length;
  play(engine, P1, id("ds"));
  assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1, "the tactic left the hand, one card was drawn");
  assert.equal(engine.state.cards[top].zone, "hand");
  assert.equal(engine.state.players[P1].deck.length, 2);
  assert.equal(engine.state.players[P2].hand.length, oppHand);
  assert.equal(engine.state.players[P2].deck.length, 3, "their deck is untouched");
});

clause(STRATEGY, "0:rule", "the influence loss does not touch characters or cards in play", () => {
  const { engine, id } = strategyBoard();
  play(engine, P1, id("ds"));
  assert.equal(engine.state.cards[id("foe")].damage, 0);
  assert.equal(engine.state.cards[id("foe")].zone, "play");
  assert.equal(engine.state.cards[id("mine")].zone, "play");
});

clause(STRATEGY, "0:rule", "an opponent at 2 influence is reduced to 0 and loses the game", () => {
  const { engine, id } = strategyBoard({ p2Influence: 2 });
  play(engine, P1, id("ds"));
  assert.equal(engine.state.players[P2].influence, 0);
  assert.equal(engine.state.winner, P1);
});

clause(STRATEGY, "0:rule", "an opponent at 1 influence is reduced to 0, not below 0 (CR 410.4)", () => {
  const { engine, id } = strategyBoard({ p2Influence: 1 });
  play(engine, P1, id("ds"));
  assert.equal(engine.state.players[P2].influence, 0, "a number an effect would push below 0 stays at 0");
});

clause(STRATEGY, "0:rule", "an opponent at 1 influence loses the game", () => {
  const { engine, id } = strategyBoard({ p2Influence: 1 });
  play(engine, P1, id("ds"));
  assert.equal(engine.state.winner, P1);
});

clause(STRATEGY, "0:rule", "with an empty deck the influence is still lost and nothing is drawn", () => {
  const { engine, id } = strategyBoard({ deck: 0 });
  const p2 = engine.state.players[P2].influence;
  const hand = engine.state.players[P1].hand.length;
  play(engine, P1, id("ds"));
  assert.equal(engine.state.players[P2].influence, p2 - 2);
  assert.equal(engine.state.players[P1].hand.length, hand - 1);
  assert.equal(engine.state.winner, undefined);
});

clause(STRATEGY, "0:rule", "influence loss is not damage: a 'prevent all damage' window does not stop it (CR 408.3b), though it does stop damage to the same faction", () => {
  const blanket = tactic({
    name: "Blanket",
    cost: 0,
    behavior: { abilities: [{ id: "blanket", type: "activated", effects: [{ type: "preventAllDamage", duration: { type: "untilEndOfTurn" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ds", def: printing(STRATEGY), owner: P1, zone: "hand" },
      { key: "blanket", def: blanket, owner: P1, zone: "hand" },
      { key: "bile", def: tactic({ name: "Burn", cost: 0, behavior: { abilities: [{ id: "burn", type: "activated", effects: [{ type: "dealDamage", target: { type: "faction", player: "opponent" } as never, amount: 4 }] }] } }), owner: P1, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      ...bank("rage", 3, P1)
    ]
  });
  const p2 = engine.state.players[P2].influence;
  play(engine, P1, id("blanket"));
  play(engine, P1, id("bile"));
  assert.equal(engine.state.players[P2].influence, p2, "setup: the blanket prevents damage to the faction");
  play(engine, P1, id("ds"));
  assert.equal(engine.state.players[P2].influence, p2 - 2, "the influence loss still happens");
});

clause(STRATEGY, "0:rule", "is refused one resource short of its cost of 3, and without [R]", () => {
  const short = strategyBoard({ rage: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("ds")));
  assert.equal(short.engine.state.cards[short.id("ds")].zone, "hand");
  const noR = strategyBoard({ rage: 0, greed: 6 });
  assert.throws(() => playRaw(noR.engine, P1, noR.id("ds")), "no [R]");
  const mixed = strategyBoard({ rage: 1, greed: 2 });
  play(mixed.engine, P1, mixed.id("ds"));
  assert.equal(mixed.engine.state.cards[mixed.id("ds")].zone, "discard", "[R] plus two other resources is enough");
  assert.equal(ready(mixed.engine), 0);
});

// --- Eye Gouge -------------------------------------------------------------
// COST: Pick a blocking character. -- EFFECT: Inflict 3 damage to the
// character. Tactic, cost 3, threshold [R][R].

const GOUGE = "6fefce63-dfc6-41e7-80f0-8b46c8a9a76f";

/** P1 attacks with `atk`; P2 blocks with `blk` (life 5) and `blk2` (life 3); afterwards P1 holds priority in the battle window. */
function gougeBattle(opts: { rage?: number; greed?: number; block?: boolean } = {}) {
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "eg", def: printing(GOUGE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
  const { engine, id } = board;
  declareAttackBy(engine, P1, [id("atk")]);
  resolvePendingResponses(engine);
  if (opts.block !== false) {
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk"), id("blk2")] });
    passUntil(engine, P1);
  }
  return board;
}

clause(GOUGE, "0:ability", "inflicts exactly 3 damage to the picked blocking character (a 5-life blocker survives with 3 damage), and the cost of 3 is paid", () => {
  const { engine, id } = gougeBattle();
  const before = ready(engine);
  play(engine, P1, id("eg"), { selected: { target: [id("blk")] } });
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(engine.state.cards[id("blk")].damage, 3);
  assert.equal(engine.state.cards[id("blk")].zone, "play");
  assert.equal(engine.state.cards[id("blk2")].damage, 0, "the other blocker is untouched");
  assert.equal(engine.state.cards[id("idle")].damage, 0);
  assert.equal(engine.state.cards[id("atk")].damage, 0);
  assert.equal(engine.state.cards[id("eg")].zone, "discard");
});

clause(GOUGE, "0:ability", "3 damage destroys a 3-life blocker, which then leaves the blocking party", () => {
  const { engine, id } = gougeBattle();
  play(engine, P1, id("eg"), { selected: { target: [id("blk2")] } });
  assert.equal(engine.state.cards[id("blk2")].zone, "discard");
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("blk")], "only the other blocker remains");
});

clause(GOUGE, "0:ability", "only a blocking character can be picked: a character that is not blocking, the attacker, an item and a faction are refused", () => {
  const { engine, id } = gougeBattle();
  const attempt = (t: string) => () => playRaw(engine, P1, id("eg"), { selected: { target: [t] } });
  assert.throws(attempt(id("idle")), "an opposing character that is not blocking");
  assert.throws(attempt(id("atk")), "the attacking character");
  assert.throws(attempt(id("mine")), "one of your own characters that is not in the battle");
  assert.throws(attempt(id("thing")), "an item");
  assert.throws(attempt(engine.state.players[P2].factionId!), "a faction");
  assert.throws(() => playRaw(engine, P1, id("eg"), { selected: { target: [] } }), "no pick");
  assert.equal(engine.state.cards[id("eg")].zone, "hand", "nothing was played");
  attempt(id("blk"))();
  assert.ok(engine.state.responseWindow, "a blocking character is accepted");
});

clause(GOUGE, "0:ability", "is refused before blockers are declared: nobody is blocking yet", () => {
  const { engine, id } = gougeBattle({ block: false });
  assert.ok(battleOf(engine), "setup: an attack is in progress");
  assert.throws(() => playRaw(engine, P1, id("eg"), { selected: { target: [id("blk")] } }), "not blocking yet");
  assert.throws(() => playRaw(engine, P1, id("eg"), { selected: { target: [id("atk")] } }), "an attacker is not a blocker");
  assert.equal(engine.state.cards[id("eg")].zone, "hand");
});

clause(GOUGE, "0:ability", "is refused with no battle at all", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "eg", def: printing(GOUGE), owner: P1, zone: "hand" },
      { key: "blk", def: character({ name: "Blk" }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  assert.throws(() => playRaw(engine, P1, id("eg"), { selected: { target: [id("blk")] } }));
  assert.equal(engine.state.cards[id("eg")].zone, "hand");
});

clause(GOUGE, "0:ability", "a blocking character of yours can be picked too (whoever controls it)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "eg", def: printing(GOUGE), owner: P1, zone: "hand" },
      { key: "raider", def: character({ name: "Raider", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  declareAttackBy(engine, P2, [id("raider")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mine")] });
  passUntil(engine, P1);
  play(engine, P1, id("eg"), { selected: { target: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].damage, 3, "your own blocker took the damage");
});

clause(GOUGE, "0:ability", "is refused once the battle is over: no character is blocking any more", () => {
  const board = gougeBattle();
  const { engine, id } = board;
  resolvePendingResponses(engine);
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  assert.equal(battleOf(engine), undefined, "setup: the battle is over");
  assert.throws(() => playRaw(engine, P1, id("eg"), { selected: { target: [id("blk")] } }));
});

clause(GOUGE, "0:ability", "is refused one resource short of its cost of 3, and with fewer than two [R]", () => {
  const short = gougeBattle({ rage: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("eg"), { selected: { target: [short.id("blk")] } }));
  assert.equal(short.engine.state.cards[short.id("eg")].zone, "hand");
  const oneR = gougeBattle({ rage: 1, greed: 6 });
  assert.throws(() => playRaw(oneR.engine, P1, oneR.id("eg"), { selected: { target: [oneR.id("blk")] } }), "only one [R]");
  const mixed = gougeBattle({ rage: 2, greed: 1 });
  play(mixed.engine, P1, mixed.id("eg"), { selected: { target: [mixed.id("blk")] } });
  assert.equal(mixed.engine.state.cards[mixed.id("blk")].damage, 3, "[R][R] plus one other resource is enough");
  assert.equal(ready(mixed.engine), 0);
});

// --- Extra interaction tests ---------------------------------------------

clause(SCRAG, "0:ability", "X is fixed by the cost: a response that raises the picked character's life afterwards does not change X", () => {
  const grow = tactic({
    name: "Grow",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grow",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: 4, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sg", def: printing(SCRAG), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      { key: "grow", def: grow, owner: P2, zone: "hand" },
      ...fillers("od", 3, P2, "discard"),
      ...bank("deception", 2, P1)
    ]
  });
  playRaw(engine, P1, id("sg"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(engine, P2, id("grow"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("foe"), "life"), 7, "setup: the response raised the life to 7");
  assert.equal(engine.state.cards[id("foe")].zone, "discard", "X was fixed at 3 when the cost was paid, and the opponent has 3 cards in their discard pile");
});

clause(OSPREY, "0:rule", "'whenever you could play a tactic': once Tactician Vacation has closed the tactic window this turn, the Osprey cannot be played in a response window, but still can in your own main phase", () => {
  const vacation = printing("5ca25182-e910-4f21-97d0-b30298e7d4af");
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "vac", def: vacation, owner: P1, zone: "hand" },
      { key: "birdMine", def: printing(OSPREY), owner: P1, zone: "hand" },
      { key: "birdTheirs", def: printing(OSPREY), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("rage", 4, P1),
      ...bank("deception", 2, P1),
      ...bank("deception", 4, P2)
    ]
  });
  play(engine, P1, id("vac"));
  declareAttackBy(engine, P1, [id("atk")]);
  passUntil(engine, P2);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "setup: the opponent has a response window");
  assert.throws(() => playRaw(engine, P2, id("birdTheirs")), "tactics are closed this turn, and so are 'whenever you could play a tactic' windows");
  assert.equal(engine.state.cards[id("birdTheirs")].zone, "hand");
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  resolvePendingResponses(engine);
  play(engine, P1, id("birdMine"));
  answerPick(engine, P1, []);
  assert.equal(engine.state.cards[id("birdMine")].zone, "play", "in your own main phase it can still be played as an ordinary character");
});

/** An opponent's character with a threshold-gated ability (id `thr`) that draws a card for its controller. */
const GATED = character({
  name: "Gated",
  behavior: { abilities: [{ id: "thr", type: "activated", threshold: "r", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
});

clause(BILL, "1:rule", "a borrowed ability's threshold is judged as though you were the opponent: their icons count, yours do not", () => {
  const withTheirs = billBoard({ p1Res: 3, extra: [{ key: "gated", def: GATED, owner: P2, zone: "play" }] });
  assert.ok(withTheirs.engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === withTheirs.id("gated")), "the opponent's own [R] satisfies it");
  activate(withTheirs.engine, P1, withTheirs.id("gated"), "thr");
  assert.equal(withTheirs.engine.state.players[P2].hand.length, 1, "the opponent draws");

  const withMine = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bill", def: printing(BILL), owner: P1, zone: "play" },
      { key: "gated", def: GATED, owner: P2, zone: "play" },
      ...fillers("b", 3, P2, "deck"),
      ...bank("rage", 5, P1)
    ]
  });
  assert.throws(() => activateRaw(withMine.engine, P1, withMine.id("gated"), "thr"), "your own [R] icons do not meet the opponent's ability's threshold");
  assert.equal(withMine.engine.state.players[P2].hand.length, 0);
});
