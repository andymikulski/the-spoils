// Clause tests — batch 1st-edition-02. See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-02`. Expectations come from each
// card's PRINTED text and RULES.md; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bounceTactic,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  drawerChar,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing } from "./_clause.js";
import { battleOf, declareAttackBy, fight, playRaw } from "./_battle.js";
import { attachedCount, endTurn, factionOf, readyCount, spentResources } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

const influenceOf = (engine: SpoilsEngine, player: Pid): number => engine.state.players[player].influence;
const handOf = (engine: SpoilsEngine, player: Pid): CardInstanceId[] => engine.state.players[player].hand;
const discardOf = (engine: SpoilsEngine, player: Pid): CardInstanceId[] => engine.state.players[player].discard;
const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string): boolean =>
  (engine.getKeywords(cardId) as string[]).includes(keyword);

/** Answers every open pending choice, using `pick` for `chooserSelectsTarget` and the decline default for the rest. */
function answerPicks(engine: SpoilsEngine, pick: (pc: { playerId: string; [key: string]: unknown }) => CardInstanceId[]) {
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: pick(pc) } : declineAll(pc)));
}

/** Resolves a pending `mayPay` with `pay`. */
function answerMayPay(engine: SpoilsEngine, pay: boolean) {
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "mayPay", "a 'you may pay' choice is open");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay } } as never);
  resolvePendingResponses(engine);
}

/** A tactic that deals `amount` damage to one picked card (decl `t`, ability `dmg`). */
function damageTactic(amount: number): CardDefinition {
  return tactic({
    name: `Smite${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dmg",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic that discards one picked card from its controller's hand (decl `t`). */
const discardFromHandTactic = (): CardDefinition =>
  tactic({
    name: "Dump",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  });

/** A free tactic that restores one picked character (decl `t`). */
const restoreTactic = (): CardDefinition =>
  tactic({
    name: "Refresh",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rst",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "restore", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

// =============================================================================
// Defense Attorney
// "If you are attacked and this card could block, this card must block."
// Character, cost 3, threshold [G], 1 / 3 / 4.
// =============================================================================

const ATTORNEY = "b6e5dd65-97aa-447d-838d-0f13b6cd78ea";

function attorneyBoard(opts: { attorneyOwner?: Pid; extra?: CardPlacement[]; attackerDef?: CardDefinition } = {}) {
  const defender = opts.attorneyOwner ?? P2;
  const attacker = other(defender);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "atk", def: opts.attackerDef ?? character({ name: "Attacker", strength: 2, life: 6, speed: 2 }), owner: attacker, zone: "play" },
      { key: "atty", def: printing(ATTORNEY), owner: defender, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 2 }), owner: defender, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

const declareBlock = (engine: SpoilsEngine, player: Pid, blockerIds: CardInstanceId[]) =>
  engine.perform({ type: "declareBlockers", playerId: player, blockerIds });

clause(ATTORNEY, "0:rule", "the card itself: cost 3 with [G], printed 1 / 3 / 4", () => {
  const mk = (greed: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "atty", def: printing(ATTORNEY), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const short = mk(2, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("atty")), "2 is one short of 3");
  const noThreshold = mk(0, 5);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("atty")), "no [G]");
  const ok = mk(1, 2);
  const before = readyCount(ok.engine, P1);
  play(ok.engine, P1, ok.id("atty"));
  assert.equal(before - readyCount(ok.engine, P1), 3);
  assert.equal(ok.engine.getStat(ok.id("atty"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("atty"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("atty"), "life"), 4);
});

clause(ATTORNEY, "0:rule", "when its controller is attacked it must block: declaring no blockers is refused", () => {
  const { engine, id } = attorneyBoard();
  declareAttackBy(engine, P1, [id("atk")]);
  assert.throws(() => declareBlock(engine, P2, []), "no blockers at all is not allowed while the Attorney can block");
  assert.equal(battleOf(engine)?.phase, "blocking", "the battle is still waiting for blockers");
  assert.deepEqual(battleOf(engine)?.blockingParty, []);
});

clause(ATTORNEY, "0:rule", "it must block even when other characters block instead of it (a block without the Attorney is refused)", () => {
  const { engine, id } = attorneyBoard();
  declareAttackBy(engine, P1, [id("atk")]);
  assert.throws(() => declareBlock(engine, P2, [id("ally")]), "blocking with only the Ally leaves the Attorney out");
  assert.equal(battleOf(engine)?.phase, "blocking");
});

clause(ATTORNEY, "0:rule", "blocking with the Attorney alone is accepted, and it is in the blocking party", () => {
  const { engine, id } = attorneyBoard();
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlock(engine, P2, [id("atty")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("atty")]);
});

clause(ATTORNEY, "0:rule", "blocking with the Attorney AND another character is accepted (it must block, others may)", () => {
  const { engine, id } = attorneyBoard();
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlock(engine, P2, [id("atty"), id("ally")]);
  assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [id("atty"), id("ally")].sort());
});

clause(ATTORNEY, "0:rule", "a refused declaration costs nothing: after it the correct block still goes through", () => {
  const { engine, id } = attorneyBoard();
  declareAttackBy(engine, P1, [id("atk")]);
  assert.throws(() => declareBlock(engine, P2, []));
  assert.throws(() => declareBlock(engine, P2, [id("ally")]));
  declareBlock(engine, P2, [id("atty")]);
  autoResolveBattle(engine);
  assert.equal(battleOf(engine), undefined, "the battle ran to the end");
  assert.equal(influenceOf(engine, P2), engine.getFactionDefinition(P2)!.startingInfluence, "the faction took no damage: the Attorney blocked");
});

clause(ATTORNEY, "0:rule", "the forced block really fights: the Attorney deals its strength to the attacker and takes the attacker's damage", () => {
  const { engine, id } = attorneyBoard();
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlock(engine, P2, [id("atty")]);
  autoResolveBattle(engine);
  assert.equal(engine.state.cards[id("atk")].damage, 1, "the Attorney (strength 1) damaged the attacker");
  assert.equal(engine.state.cards[id("atty")].damage, 2, "the attacker (strength 2) damaged the Attorney");
  assert.equal(zoneOf(engine, id("atty")), "play");
});

clause(ATTORNEY, "0:rule", "it only has to block when it COULD block: a depleted Attorney is not forced (declaring no blockers is fine)", () => {
  const { engine, id } = attorneyBoard();
  engine.state.cards[id("atty")].depleted = true;
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlock(engine, P2, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], []);
});

clause(ATTORNEY, "0:rule", "a depleted Attorney does not stop the other characters from blocking (and cannot itself be declared)", () => {
  const { engine, id } = attorneyBoard();
  engine.state.cards[id("atty")].depleted = true;
  declareAttackBy(engine, P1, [id("atk")]);
  assert.throws(() => declareBlock(engine, P2, [id("atty")]), "depleted characters cannot block");
  declareBlock(engine, P2, [id("ally")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("ally")]);
});

clause(ATTORNEY, "0:rule", "it could not block a COVERT party (it is not covert), so it is not forced to", () => {
  const covertAttacker = character({ name: "Sneak", strength: 2, life: 6, speed: 2, behavior: { keywords: ["covert"] } });
  const { engine, id } = attorneyBoard({ attackerDef: covertAttacker });
  declareAttackBy(engine, P1, [id("atk")]);
  assert.throws(() => declareBlock(engine, P2, [id("atty")]), "control: a non-covert Attorney cannot block a covert party");
  declareBlock(engine, P2, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], [], "declaring no blockers is fine: the Attorney could not block");
});

clause(ATTORNEY, "0:rule", "it could not block a party that cannot be blocked, so it is not forced to", () => {
  const ghost = character({ name: "Ghost", strength: 2, life: 6, speed: 2, behavior: { keywords: ["cannotBeBlocked"] } });
  const { engine, id } = attorneyBoard({ attackerDef: ghost });
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlock(engine, P2, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], []);
});

clause(ATTORNEY, "0:rule", "it could not block an attacker that only lets fast characters block (minimum blocker speed 5 vs the Attorney's speed 3): not forced", () => {
  const picky = character({
    name: "Picky",
    strength: 2,
    life: 6,
    speed: 2,
    behavior: { abilities: [{ id: "picky", type: "continuous", modifiers: [], blockRestriction: { minBlockerSpeed: 5 } }] }
  });
  const { engine, id } = attorneyBoard({ attackerDef: picky });
  declareAttackBy(engine, P1, [id("atk")]);
  assert.throws(() => declareBlock(engine, P2, [id("atty")]), "control: the Attorney cannot legally block this attacker");
  declareBlock(engine, P2, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], [], "so it is not forced to, and declaring no blockers must be possible");
});

clause(ATTORNEY, "0:rule", "it could not block if it cannot block for any reason (a 'cannot block' restriction): not forced", () => {
  const jinx = item({
    name: "Jinx",
    attachTo: "character",
    behavior: { abilities: [{ id: "jinx", type: "continuous", modifiers: [], restrictions: [{ target: "attachedTo", restriction: "cannotBlock" }] }] }
  });
  const { engine, id } = attorneyBoard({ extra: [{ key: "jinx", def: jinx, owner: P1, zone: "play", attachedToKey: "atty" }] });
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlock(engine, P2, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], []);
});

clause(ATTORNEY, "0:rule", "'you are attacked' means its own controller: when the Attorney's controller attacks, nothing forces anything on the other side", () => {
  // P2 owns the Attorney and attacks; P1 (no Attorney) is being attacked and is free to declare no blockers.
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "atty", def: printing(ATTORNEY), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("atty")]);
  declareBlock(engine, P1, []);
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], [], "the opponent's blockers are not forced by the Attorney");
});

clause(ATTORNEY, "0:rule", "an Attorney controlled by the attacked player is forced; one controlled by the ATTACKER is not (it is not a blocker for that attack)", () => {
  const { engine, id } = attorneyBoard({
    extra: [{ key: "enemyAtty", def: printing(ATTORNEY), owner: P1, zone: "play" }]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  assert.throws(() => declareBlock(engine, P2, []), "P2's own Attorney still forces P2's block");
  declareBlock(engine, P2, [id("atty")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("atty")]);
});

clause(ATTORNEY, "0:rule", "two Attorneys on the attacked side must both block", () => {
  const { engine, id } = attorneyBoard({
    extra: [{ key: "atty2", def: printing(ATTORNEY), owner: P2, zone: "play" }]
  });
  declareAttackBy(engine, P1, [id("atk")]);
  assert.throws(() => declareBlock(engine, P2, [id("atty")]), "the second Attorney is left out");
  assert.throws(() => declareBlock(engine, P2, [id("atty2")]), "the first Attorney is left out");
  assert.throws(() => declareBlock(engine, P2, []));
  declareBlock(engine, P2, [id("atty"), id("atty2")]);
  assert.deepEqual([...(battleOf(engine)?.blockingParty ?? [])].sort(), [id("atty"), id("atty2")].sort());
});

clause(ATTORNEY, "0:rule", "it must block an attacking party of two just the same", () => {
  const { engine, id } = attorneyBoard({ extra: [{ key: "atk2", def: character({ name: "Attacker2", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" }] });
  declareAttackBy(engine, P1, [id("atk"), id("atk2")]);
  assert.throws(() => declareBlock(engine, P2, []));
  assert.throws(() => declareBlock(engine, P2, [id("ally")]));
  declareBlock(engine, P2, [id("atty")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("atty")]);
});

clause(ATTORNEY, "0:rule", "a party that is only PARTLY covert is not a covert party, so the Attorney could block it and must", () => {
  const sneak = covertChar("Sneak");
  const { engine, id } = attorneyBoard({ extra: [{ key: "sneak", def: sneak, owner: P1, zone: "play" }] });
  declareAttackBy(engine, P1, [id("atk"), id("sneak")]);
  assert.throws(() => declareBlock(engine, P2, []), "the party includes a non-covert attacker: anyone can block it");
  declareBlock(engine, P2, [id("atty")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("atty")]);
});

clause(ATTORNEY, "0:rule", "a party that is only PARTLY unblockable can still be blocked, so the Attorney must block it", () => {
  const ghost = character({ name: "Ghost", strength: 1, life: 6, speed: 2, behavior: { keywords: ["cannotBeBlocked"] } });
  const { engine, id } = attorneyBoard({ extra: [{ key: "ghost", def: ghost, owner: P1, zone: "play" }] });
  declareAttackBy(engine, P1, [id("atk"), id("ghost")]);
  assert.throws(() => declareBlock(engine, P2, []));
  declareBlock(engine, P2, [id("atty")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("atty")]);
});

clause(ATTORNEY, "0:rule", "the obligation is per attack: it applies to every attack in the same turn", () => {
  const { engine, id } = attorneyBoard({
    extra: [{ key: "atk2", def: character({ name: "Attacker2", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" }]
  });
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("atty")]);
  assert.equal(battleOf(engine), undefined);
  engine.state.cards[id("atty")].depleted = false; // battle depletes survivors; ready it again to make the second attack a fair test
  declareAttackBy(engine, P1, [id("atk2")]);
  assert.throws(() => declareBlock(engine, P2, []), "the second attack forces the block again");
  declareBlock(engine, P2, [id("atty")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("atty")]);
});

clause(ATTORNEY, "0:rule", "it only forces a block while in play: an Attorney in hand, in the discard pile, or destroyed beforehand forces nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "atk", def: character({ name: "Attacker", strength: 2, life: 6, speed: 2 }), owner: P1, zone: "play" },
        { key: "atty", def: printing(ATTORNEY), owner: P2, zone },
        { key: "ally", def: character({ name: "Ally" }), owner: P2, zone: "play" }
      ]
    });
    declareAttackBy(engine, P1, [id("atk")]);
    declareBlock(engine, P2, []);
    assert.deepEqual(battleOf(engine)?.blockingParty ?? [], [], `Attorney in ${zone}`);
  }
  const killed = attorneyBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  killed.engine.state.activePlayerId = P2;
  killed.engine.state.priorityPlayerId = P2;
  play(killed.engine, P2, killed.id("kill"), { selected: { t: [killed.id("atty")] } });
  assert.equal(zoneOf(killed.engine, killed.id("atty")), "discard");
  killed.engine.state.activePlayerId = P1;
  killed.engine.state.priorityPlayerId = P1;
  declareAttackBy(killed.engine, P1, [killed.id("atk")]);
  declareBlock(killed.engine, P2, []);
  assert.deepEqual(battleOf(killed.engine)?.blockingParty ?? [], []);
});

// =============================================================================
// Erotic Assassin
// This card cannot be restored by your faction's Restore Rule.
// This card can attack only once each turn.
// RESTORE -- COST: Pay 2. -- EFFECT: Restore this card.
// Character, cost 0, threshold [G][G], 3 / 3 / 3.
// =============================================================================

const ASSASSIN = "2d09f169-5615-431f-a919-adb226d54442";

function assassinBoard(opts: { turn?: number; active?: Pid; greed?: number; assassinDepleted?: boolean; extra?: CardPlacement[]; spent?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "as", def: printing(ASSASSIN), owner: P1, zone: "play", depleted: opts.assassinDepleted ?? false },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 4, P1),
      ...(opts.spent ? spentResources(P1, opts.spent) : []),
      ...(opts.extra ?? [])
    ]
  });
}

const useRestore = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, player: Pid = P1) =>
  activate(engine, player, id("as"), "restore");

/** `attacker` declares the attack and passes priority, so the DEFENDER holds the response window (they can use abilities now, before blockers). */
function attackUntilDefenderMayRespond(engine: SpoilsEngine, attacker: Pid, attackerIds: CardInstanceId[]) {
  engine.perform({ type: "declareAttack", playerId: attacker, attackerIds, target: { type: "faction", playerId: other(attacker) } });
  engine.perform({ type: "passPriority", playerId: attacker });
}

/** P1 uses RESTORE while holding the response window, then the windows drain so blockers can be declared. */
function useRestoreAsDefender(engine: SpoilsEngine, id: (key: string) => CardInstanceId) {
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("as"), abilityId: "restore", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
}

// --- the card itself: cost 0, [G][G]

clause(ASSASSIN, "0:rule", "enters play for 0 resources with [G][G], and is refused with only one Greed", () => {
  const printed = printing(ASSASSIN);
  assert.equal(printed.cost, 0);
  const deploy = (greed: number, rage: number) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "as", def: printed, owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
    return { engine, id };
  };
  const ok = deploy(2, 0);
  const before = readyCount(ok.engine, P1);
  play(ok.engine, P1, ok.id("as"));
  assert.equal(zoneOf(ok.engine, ok.id("as")), "play");
  assert.equal(before - readyCount(ok.engine, P1), 0, "cost 0: nothing is paid");
  assert.equal(ok.engine.getStat(ok.id("as"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("as"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("as"), "life"), 3);
  const oneGreed = deploy(1, 5);
  assert.throws(() => playRaw(oneGreed.engine, P1, oneGreed.id("as")), "one Greed is short of [G][G]");
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("as")), "hand");
  const none = deploy(0, 0);
  assert.throws(() => playRaw(none.engine, P1, none.id("as")), "no resources at all");
});

// --- 0:rule  cannot be restored by the Restore Rule

clause(ASSASSIN, "0:rule", "a depleted Assassin is NOT restored by its controller's Restore Rule at the start of their turn", () => {
  const { engine, id } = assassinBoard({ turn: 1, active: P1, assassinDepleted: true });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "it is P1's turn again");
  assert.equal(engine.state.cards[id("as")].depleted, true, "the Restore Rule did not restore the Assassin");
});

clause(ASSASSIN, "0:rule", "control: any other depleted character IS restored by the same Restore Rule at the same time", () => {
  const { engine, id } = assassinBoard({ turn: 1, active: P1, assassinDepleted: true, extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("tired")].depleted, false, "an ordinary character is restored");
  assert.equal(engine.state.cards[id("as")].depleted, true, "the Assassin is not");
});

clause(ASSASSIN, "0:rule", "it stays depleted through any number of Restore Rules, not just the first", () => {
  const { engine, id } = assassinBoard({ turn: 1, active: P1, assassinDepleted: true });
  for (let i = 0; i < 3; i++) {
    endTurn(engine, P1);
    endTurn(engine, P2);
    assert.equal(engine.state.cards[id("as")].depleted, true, `after Restore Rule number ${i + 1}`);
  }
});

clause(ASSASSIN, "0:rule", "the rest of the Restore Rule still happens: spent resources are detached while the Assassin stays depleted", () => {
  const { engine, id } = assassinBoard({ turn: 1, active: P1, assassinDepleted: true, greed: 0, spent: 3 });
  assert.equal(attachedCount(engine, P1), 3);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(attachedCount(engine, P1), 0, "the resources were detached by the Restore Rule");
  assert.equal(readyCount(engine, P1), 3);
  assert.equal(engine.state.cards[id("as")].depleted, true);
});

clause(ASSASSIN, "0:rule", "only the Restore Rule is blocked: an explicit 'restore' effect from another card restores the Assassin", () => {
  const { engine, id } = assassinBoard({ assassinDepleted: true, extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("refresh"), { selected: { t: [id("as")] } });
  assert.equal(engine.state.cards[id("as")].depleted, false);
});

clause(ASSASSIN, "0:rule", "an Assassin that is not depleted is simply ready (the rule changes nothing for it)", () => {
  const { engine, id } = assassinBoard({ turn: 1, active: P1 });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("as")].depleted, false);
});

clause(ASSASSIN, "0:rule", "an Assassin depleted by attacking stays depleted into its controller's next turn (it cannot attack then without RESTORE)", () => {
  const { engine, id } = assassinBoard({ turn: 2 });
  fight(engine, P1, [id("as")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.cards[id("as")].depleted, true, "attacking depleted it");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("as")].depleted, true);
  assert.throws(() => declareAttackBy(engine, P1, [id("as")]), "a depleted character cannot attack");
});

// --- 1:rule  can attack only once each turn

clause(ASSASSIN, "1:rule", "it can attack once in a turn", () => {
  const { engine, id } = assassinBoard();
  fight(engine, P1, [id("as")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), 30 - 3, "its 3 strength hit the faction");
});

clause(ASSASSIN, "1:rule", "after RESTORE (so it is ready again) a second attack in the same turn is refused", () => {
  const { engine, id } = assassinBoard();
  fight(engine, P1, [id("as")], { type: "faction", playerId: P2 }, []);
  useRestore(engine, id);
  assert.equal(engine.state.cards[id("as")].depleted, false, "ready again");
  assert.throws(() => declareAttackBy(engine, P1, [id("as")]), "but it already attacked this turn");
  assert.equal(engine.state.cards[id("as")].depleted, false, "the refused attack depleted nothing");
  assert.equal(battleOf(engine), undefined);
});

clause(ASSASSIN, "1:rule", "restored by another card's effect instead, the second attack is refused just the same", () => {
  const { engine, id } = assassinBoard({ extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  fight(engine, P1, [id("as")], { type: "faction", playerId: P2 }, []);
  play(engine, P1, id("refresh"), { selected: { t: [id("as")] } });
  assert.equal(engine.state.cards[id("as")].depleted, false);
  assert.throws(() => declareAttackBy(engine, P1, [id("as")]));
});

clause(ASSASSIN, "1:rule", "the limit is per card: another character restored after attacking CAN attack again the same turn", () => {
  const { engine, id } = assassinBoard({ extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  fight(engine, P1, [id("mate")], { type: "faction", playerId: P2 }, []);
  play(engine, P1, id("refresh"), { selected: { t: [id("mate")] } });
  declareAttackBy(engine, P1, [id("mate")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("mate")], "the ordinary character attacks a second time");
});

clause(ASSASSIN, "1:rule", "attacking in a party counts as its attack for the turn", () => {
  const { engine, id } = assassinBoard();
  fight(engine, P1, [id("as"), id("mate")], { type: "faction", playerId: P2 }, []);
  useRestore(engine, id);
  assert.throws(() => declareAttackBy(engine, P1, [id("as"), id("mate")]), "the Assassin is not allowed back in a party");
  assert.throws(() => declareAttackBy(engine, P1, [id("as")]));
});

clause(ASSASSIN, "1:rule", "the limit resets with the next turn: after RESTORE it attacks again on its controller's next turn", () => {
  const { engine, id } = assassinBoard({ greed: 6 });
  fight(engine, P1, [id("as")], { type: "faction", playerId: P2 }, []);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("as")].depleted, true, "the Restore Rule did not restore it");
  useRestore(engine, id);
  fight(engine, P1, [id("as")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), 30 - 6, "it hit the faction on both turns");
});

clause(ASSASSIN, "1:rule", "'attack' not 'block': an Assassin that blocked can block again once restored, in the same turn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "as", def: printing(ASSASSIN), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  fight(engine, P2, [id("a1")], { type: "faction", playerId: P1 }, [id("as")]);
  assert.equal(engine.state.cards[id("as")].depleted, true, "battle depletes surviving participants");
  attackUntilDefenderMayRespond(engine, P2, [id("a2")]);
  useRestoreAsDefender(engine, id);
  declareBlock(engine, P1, [id("as")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("as")], "the once-a-turn limit is about attacking only");
});

// --- 2:ability:restore  Pay 2: restore this card

clause(ASSASSIN, "2:ability:restore", "pays exactly 2 resources and restores the depleted Assassin", () => {
  const { engine, id } = assassinBoard({ assassinDepleted: true, greed: 5 });
  const before = readyCount(engine, P1);
  useRestore(engine, id);
  assert.equal(before - readyCount(engine, P1), 2, "exactly 2 paid (not 1, not 3)");
  assert.equal(attachedCount(engine, P1), 2);
  assert.equal(engine.state.cards[id("as")].depleted, false, "restored");
});

clause(ASSASSIN, "2:ability:restore", "restores only this card: another depleted character stays depleted", () => {
  const { engine, id } = assassinBoard({ assassinDepleted: true, extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  useRestore(engine, id);
  assert.equal(engine.state.cards[id("as")].depleted, false);
  assert.equal(engine.state.cards[id("tired")].depleted, true);
});

clause(ASSASSIN, "2:ability:restore", "works with exactly 2 resources", () => {
  const { engine, id } = assassinBoard({ assassinDepleted: true, greed: 2 });
  useRestore(engine, id);
  assert.equal(engine.state.cards[id("as")].depleted, false);
  assert.equal(readyCount(engine, P1), 0);
});

clause(ASSASSIN, "2:ability:restore", "is refused with only 1 ready resource, and nothing is paid or restored", () => {
  const { engine, id } = assassinBoard({ assassinDepleted: true, greed: 1 });
  assert.throws(() => useRestore(engine, id));
  assert.equal(engine.state.cards[id("as")].depleted, true);
  assert.equal(readyCount(engine, P1), 1, "the one resource is still ready");
});

clause(ASSASSIN, "2:ability:restore", "resources already spent do not count: 2 resources of which 1 is attached is 1 short", () => {
  const { engine, id } = assassinBoard({ assassinDepleted: true, greed: 1, spent: 1 });
  assert.equal(readyCount(engine, P1), 1);
  assert.throws(() => useRestore(engine, id));
  assert.equal(engine.state.cards[id("as")].depleted, true);
});

clause(ASSASSIN, "2:ability:restore", "is refused with no resources", () => {
  const { engine, id } = assassinBoard({ assassinDepleted: true, greed: 0 });
  assert.throws(() => useRestore(engine, id));
  assert.equal(engine.state.cards[id("as")].depleted, true);
});

clause(ASSASSIN, "2:ability:restore", "can be used again and again (each use pays 2 again)", () => {
  const { engine, id } = assassinBoard({ assassinDepleted: true, greed: 6 });
  useRestore(engine, id);
  engine.state.cards[id("as")].depleted = true;
  useRestore(engine, id);
  assert.equal(engine.state.cards[id("as")].depleted, false);
  assert.equal(readyCount(engine, P1), 2, "6 - 2 - 2");
});

clause(ASSASSIN, "2:ability:restore", "can be used on the opponent's turn: restored in time to block", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "as", def: printing(ASSASSIN), owner: P1, zone: "play", depleted: true },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  attackUntilDefenderMayRespond(engine, P2, [id("a1")]);
  assert.throws(() => declareBlock(engine, P1, [id("as")]), "control: depleted, it cannot block");
  useRestoreAsDefender(engine, id);
  assert.equal(engine.state.cards[id("as")].depleted, false);
  declareBlock(engine, P1, [id("as")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("as")]);
});

clause(ASSASSIN, "2:ability:restore", "the opponent cannot use it (even with resources of their own)", () => {
  const { engine, id } = assassinBoard({ assassinDepleted: true, extra: [...bank("greed", 5, P2)] });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P2, cardId: id("as"), abilityId: "restore", selected: {}, variables: {} } as never));
  assert.equal(engine.state.cards[id("as")].depleted, true);
  assert.equal(readyCount(engine, P2), 5, "the opponent paid nothing");
});

// =============================================================================
// Executive Poaching
// Destroy the character your opponent controls with the highest numeric cost.
// If there is a tie, you decide which character is destroyed.
// Tactic, cost 5, threshold [G][G].
// =============================================================================

const POACHING = "1b3ecf99-3be5-43ae-9727-77ce4b1e2c62";

interface Foe {
  key: string;
  cost: number;
  /** Who controls it (default P2). */
  controller?: Pid;
  /** Who owns it (default: the controller). */
  owner?: Pid;
  type?: "character" | "item" | "location";
  faceDown?: boolean;
}

function poachBoard(foes: Foe[], opts: { greed?: number; mine?: Array<{ key: string; cost: number }>; hand?: number } = {}) {
  const cards: CardPlacement[] = [{ key: "ep", def: printing(POACHING), owner: P1, zone: "hand" }];
  for (const foe of foes) {
    const controller = foe.controller ?? P2;
    const owner: Pid = foe.owner ?? controller;
    const type = foe.type ?? "character";
    const def = type === "item" ? item({ name: foe.key, cost: foe.cost }) : type === "location" ? location({ name: foe.key, cost: foe.cost }) : character({ name: foe.key, cost: foe.cost });
    cards.push({ key: foe.key, def, owner, controller, zone: "play", faceDown: foe.faceDown });
  }
  for (const mine of opts.mine ?? []) cards.push({ key: mine.key, def: character({ name: mine.key, cost: mine.cost }), owner: P1, zone: "play" });
  cards.push(...bank("greed", opts.greed ?? 6, P1));
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, cards });
}

/** Plays Poaching (no pick yet) and returns the open choice, or undefined if the engine resolved it with no choice. */
function playPoaching(engine: SpoilsEngine, id: (key: string) => CardInstanceId) {
  play(engine, P1, id("ep"));
  return engine.state.pendingChoice as unknown as { kind: string; playerId: string; declaration?: { count?: number } } | undefined;
}

const pickFor = (engine: SpoilsEngine, playerId: string, cardIds: CardInstanceId[]) => () => {
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected: cardIds } } as never);
  resolvePendingResponses(engine);
};

/** Plays Poaching and, if a choice is asked, answers it with `choose` (a key resolved by the caller). */
function poachAndPick(engine: SpoilsEngine, id: (key: string) => CardInstanceId, chooseKey?: string) {
  const pc = playPoaching(engine, id);
  if (pc) {
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "the caster makes the decision");
    pickFor(engine, pc.playerId, chooseKey ? [id(chooseKey)] : [])();
  }
  return pc;
}

clause(POACHING, "0:rule", "destroys the opponent's character with the single highest numeric cost, and only that one", () => {
  const { engine, id } = poachBoard([
    { key: "a", cost: 1 },
    { key: "b", cost: 5 },
    { key: "c", cost: 3 }
  ]);
  const before = readyCount(engine, P1);
  poachAndPick(engine, id, "b");
  assert.equal(zoneOf(engine, id("b")), "discard", "the cost-5 character is destroyed");
  assert.ok(discardOf(engine, P2).includes(id("b")), "into its owner's discard pile");
  assert.equal(zoneOf(engine, id("a")), "play");
  assert.equal(zoneOf(engine, id("c")), "play");
  assert.equal(before - readyCount(engine, P1), 5, "the printed cost of 5 is paid");
  assert.equal(zoneOf(engine, id("ep")), "discard", "the tactic ends in its owner's discard pile");
});

clause(POACHING, "0:rule", "with a single unique highest cost the caster is never made to choose the victim: the pick, if offered, can only be that character", () => {
  const { engine, id } = poachBoard([
    { key: "a", cost: 2 },
    { key: "b", cost: 6 }
  ]);
  const pc = playPoaching(engine, id);
  if (pc) {
    assert.throws(pickFor(engine, pc.playerId, [id("a")]), "the cost-2 character is not the highest");
    pickFor(engine, pc.playerId, [id("b")])();
  }
  assert.equal(zoneOf(engine, id("b")), "discard");
  assert.equal(zoneOf(engine, id("a")), "play");
});

for (const [label, costs] of [
  ["costs 3 and 7 (7 wins)", [3, 7]],
  ["costs 7 and 3 (order on the board does not matter)", [7, 3]],
  ["costs 0, 1 and 2", [0, 1, 2]],
  ["costs 9, 8, 7, 6", [9, 8, 7, 6]]
] as const) {
  clause(POACHING, "0:rule", `highest of ${label} is the one destroyed`, () => {
    const foes = costs.map((cost, i) => ({ key: `f${i}`, cost }));
    const { engine, id } = poachBoard(foes);
    const top = foes.reduce((best, foe) => (foe.cost > best.cost ? foe : best));
    poachAndPick(engine, id, top.key);
    for (const foe of foes) {
      assert.equal(zoneOf(engine, id(foe.key)), foe.key === top.key ? "discard" : "play", `${foe.key} (cost ${foe.cost})`);
    }
  });
}

clause(POACHING, "0:rule", "a tie: the CASTER is asked which of the tied characters to destroy", () => {
  const { engine, id } = poachBoard([
    { key: "a", cost: 4 },
    { key: "b", cost: 4 },
    { key: "low", cost: 2 }
  ]);
  const pc = playPoaching(engine, id);
  assert.ok(pc, "a tie needs a decision");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "'you decide': the caster decides, not the character's controller");
});

clause(POACHING, "0:rule", "a tie: the caster may choose either tied character, and only the chosen one is destroyed", () => {
  for (const [victim, survivor] of [["a", "b"], ["b", "a"]] as const) {
    const { engine, id } = poachBoard([
      { key: "a", cost: 4 },
      { key: "b", cost: 4 },
      { key: "low", cost: 2 }
    ]);
    poachAndPick(engine, id, victim);
    assert.equal(zoneOf(engine, id(victim)), "discard", `chose ${victim}`);
    assert.equal(zoneOf(engine, id(survivor)), "play", `${survivor} survives`);
    assert.equal(zoneOf(engine, id("low")), "play", "the lower-cost character is untouched");
  }
});

clause(POACHING, "0:rule", "a tie: a lower-cost character cannot be chosen, nor both tied ones, nor nothing", () => {
  const { engine, id } = poachBoard([
    { key: "a", cost: 4 },
    { key: "b", cost: 4 },
    { key: "low", cost: 2 }
  ]);
  const pc = playPoaching(engine, id)!;
  assert.throws(pickFor(engine, pc.playerId, [id("low")]), "not tied for highest");
  assert.throws(pickFor(engine, pc.playerId, [id("a"), id("b")]), "destroy only ONE");
  assert.throws(pickFor(engine, pc.playerId, []), "the choice is mandatory when a tie exists");
  assert.throws(pickFor(engine, pc.playerId, [id("ep")]), "not a character the opponent controls");
  assert.ok(engine.state.pendingChoice, "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("a")), "play");
  assert.equal(zoneOf(engine, id("b")), "play");
  pickFor(engine, pc.playerId, [id("b")])();
  assert.equal(zoneOf(engine, id("b")), "discard");
});

clause(POACHING, "0:rule", "a three-way tie: any of the three may be chosen, one is destroyed", () => {
  for (const victim of ["a", "b", "c"]) {
    const { engine, id } = poachBoard([
      { key: "a", cost: 6 },
      { key: "b", cost: 6 },
      { key: "c", cost: 6 },
      { key: "d", cost: 5 }
    ]);
    poachAndPick(engine, id, victim);
    for (const key of ["a", "b", "c"]) assert.equal(zoneOf(engine, id(key)), key === victim ? "discard" : "play", `${key} when ${victim} chosen`);
    assert.equal(zoneOf(engine, id("d")), "play");
  }
});

clause(POACHING, "0:rule", "a tie at cost 0 (all characters cost 0) is still a tie the caster decides", () => {
  const { engine, id } = poachBoard([
    { key: "a", cost: 0 },
    { key: "b", cost: 0 }
  ]);
  const pc = playPoaching(engine, id)!;
  assert.ok(pc, "both cost 0: the caster chooses");
  assert.equal(pc.playerId, P1);
  pickFor(engine, pc.playerId, [id("a")])();
  assert.equal(zoneOf(engine, id("a")), "discard");
  assert.equal(zoneOf(engine, id("b")), "play");
});

clause(POACHING, "0:rule", "the only opponent character is destroyed", () => {
  const { engine, id } = poachBoard([{ key: "solo", cost: 0 }]);
  poachAndPick(engine, id, "solo");
  assert.equal(zoneOf(engine, id("solo")), "discard");
});

clause(POACHING, "0:rule", "with no opponent character in play it can still be played: the cost is paid, nothing is destroyed, the tactic is discarded", () => {
  const { engine, id } = poachBoard([], { mine: [{ key: "mine", cost: 9 }] });
  const before = readyCount(engine, P1);
  play(engine, P1, id("ep"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("ep")), "discard");
  assert.equal(before - readyCount(engine, P1), 5);
  assert.equal(zoneOf(engine, id("mine")), "play", "your own character is never the victim");
});

clause(POACHING, "0:rule", "only characters YOUR OPPONENT controls: your own higher-cost character is never destroyed", () => {
  const { engine, id } = poachBoard([{ key: "foe", cost: 1 }], { mine: [{ key: "mine", cost: 9 }] });
  poachAndPick(engine, id, "foe");
  assert.equal(zoneOf(engine, id("foe")), "discard", "the opponent's only character, though it is cheaper than mine");
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(POACHING, "0:rule", "a higher-cost item or location of the opponent is not a character and is not destroyed", () => {
  const { engine, id } = poachBoard([
    { key: "foe", cost: 2 },
    { key: "gadget", cost: 9, type: "item" },
    { key: "place", cost: 9, type: "location" }
  ]);
  poachAndPick(engine, id, "foe");
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("gadget")), "play");
  assert.equal(zoneOf(engine, id("place")), "play");
});

clause(POACHING, "0:rule", "a tie is only between characters: an item with the same cost does not make it a tie", () => {
  const { engine, id } = poachBoard([
    { key: "foe", cost: 5 },
    { key: "gadget", cost: 5, type: "item" }
  ]);
  const pc = playPoaching(engine, id);
  if (pc) pickFor(engine, pc.playerId, [id("foe")])();
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("gadget")), "play");
});

clause(POACHING, "0:rule", "a face-down card is a resource, not a character: its real cost does not count", () => {
  const { engine, id } = poachBoard([
    { key: "foe", cost: 2 },
    { key: "hidden", cost: 9, faceDown: true }
  ]);
  poachAndPick(engine, id, "foe");
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("hidden")), "play", "the face-down resource is untouched");
});

clause(POACHING, "0:rule", "the opponent's hand and discard are not 'controlled': a costlier character there is ignored", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ep", def: printing(POACHING), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: 2 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand", cost: 9 }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 9 }), owner: P2, zone: "discard" },
      ...bank("greed", 5, P1)
    ]
  });
  poachAndPick(engine, id, "foe");
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("inHand")), "hand");
  assert.equal(zoneOf(engine, id("inDiscard")), "discard");
});

clause(POACHING, "0:rule", "a character the opponent controls counts even if you own it: it is destroyed and goes to ITS OWNER's discard pile", () => {
  const { engine, id } = poachBoard([
    { key: "stolen", cost: 8, controller: P2, owner: P1 },
    { key: "theirs", cost: 3 }
  ]);
  poachAndPick(engine, id, "stolen");
  assert.equal(zoneOf(engine, id("stolen")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("stolen")), "its owner (the caster) gets it in their discard pile");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(POACHING, "0:rule", "a character the opponent OWNS but YOU control is not 'controlled by your opponent': it is not a candidate", () => {
  const { engine, id } = poachBoard([
    { key: "lent", cost: 9, controller: P1, owner: P2 },
    { key: "theirs", cost: 3 }
  ]);
  poachAndPick(engine, id, "theirs");
  assert.equal(zoneOf(engine, id("theirs")), "discard", "the highest cost among characters the opponent CONTROLS");
  assert.equal(zoneOf(engine, id("lent")), "play");
});

clause(POACHING, "0:rule", "a controlled-but-not-owned character ties on cost with an owned one", () => {
  const { engine, id } = poachBoard([
    { key: "stolen", cost: 6, controller: P2, owner: P1 },
    { key: "theirs", cost: 6 },
    { key: "low", cost: 1 }
  ]);
  const pc = playPoaching(engine, id)!;
  assert.ok(pc, "a tie: the caster decides");
  assert.throws(pickFor(engine, pc.playerId, [id("low")]));
  pickFor(engine, pc.playerId, [id("stolen")])();
  assert.equal(zoneOf(engine, id("stolen")), "discard");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(POACHING, "0:rule", "is refused one resource short of its cost of 5, and nothing is destroyed", () => {
  const { engine, id } = poachBoard([{ key: "foe", cost: 3 }], { greed: 4 });
  assert.throws(() => playRaw(engine, P1, id("ep")));
  assert.equal(zoneOf(engine, id("ep")), "hand");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(readyCount(engine, P1), 4);
});

clause(POACHING, "0:rule", "is refused without [G][G] even with plenty of other resources, and allowed with exactly [G][G] + 3 others", () => {
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ep", def: printing(POACHING), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 1, P1),
      ...bank("rage", 8, P1)
    ]
  });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ep")), "only one [G]");
  const faceDown = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ep", def: printing(POACHING), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 1, P1),
      ...volition(8, P1)
    ]
  });
  assert.throws(() => playRaw(faceDown.engine, P1, faceDown.id("ep")), "face-down resources provide Volition, not [G]");
  const ok = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ep", def: printing(POACHING), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: 3 }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1),
      ...bank("rage", 3, P1)
    ]
  });
  poachAndPick(ok.engine, ok.id, "foe");
  assert.equal(zoneOf(ok.engine, ok.id("foe")), "discard", "[G][G] and 5 resources in total is enough");
});

// =============================================================================
// Mafia Lawyer
// When this card enters play, your faction loses 2 influence.
// If this card is destroyed in a battle your faction gains X influence, where X
// is the total strength of the opposing party.
// Character, cost 4, threshold [G][G], 3 / 3 / 3.
// =============================================================================

const LAWYER = "3f79fea5-a850-4e9f-ab51-6fd2bf34d831";
const START_INFLUENCE = 30; // developFaction()

/** A battle board: `p1` and `p2` extra cards; P1 attacks (turn 2). */
function warBoard(p1: CardPlacement[], p2: CardPlacement[], opts: { active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [...p1, ...p2]
  });
}

const fighter = (key: string, owner: Pid, strength: number, life: number, speed = 2): CardPlacement => ({
  key,
  def: character({ name: key, strength, life, speed }),
  owner,
  zone: "play"
});

/** Resolves the battle sending each listed source's whole strength at the mapped target card; other sources take the default first legal target. */
function resolveSending(engine: SpoilsEngine, plan: Record<CardInstanceId, CardInstanceId> = {}) {
  autoResolveBattle(engine, (source) => {
    const wanted = plan[source.cardId];
    const target =
      (wanted && source.legalTargets.find((t) => t.type === "card" && t.cardId === wanted)) || source.legalTargets[0];
    if (!target || source.strength <= 0) return [];
    return [{ sourceId: source.cardId, target, amount: source.strength }];
  });
}

const lawyerHand = (greed: number, rage = 0) =>
  [{ key: "law", def: printing(LAWYER), owner: P1, zone: "hand" } as CardPlacement, ...bank("greed", greed, P1), ...bank("rage", rage, P1)];

clause(LAWYER, "0:rule", "when it enters play (deployed for 4), its controller's faction loses exactly 2 influence and the opponent's does not", () => {
  const { engine, id } = buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, cards: lawyerHand(4) });
  const before = readyCount(engine, P1);
  play(engine, P1, id("law"));
  assert.equal(zoneOf(engine, id("law")), "play");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 2);
  assert.equal(influenceOf(engine, P2), START_INFLUENCE, "the opponent's faction is untouched");
  assert.equal(before - readyCount(engine, P1), 4, "the printed cost of 4 is paid");
});

clause(LAWYER, "0:rule", "the influence loss happens each time it enters play (leaves, comes back: 2 more)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      ...lawyerHand(8),
      { key: "bounce", def: tactic({ name: "Bounce", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("law"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 2);
  play(engine, P1, id("bounce"), { selected: { t: [id("law")] } });
  assert.equal(zoneOf(engine, id("law")), "hand");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 2, "leaving play costs nothing");
  play(engine, P1, id("law"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 4, "entering play again loses 2 more");
});

clause(LAWYER, "0:rule", "it triggers off ITSELF entering play only: another character entering play loses nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "law", def: printing(LAWYER), owner: P1, zone: "play" },
      { key: "newcomer", def: character({ name: "Newcomer", cost: 1 }), owner: P1, zone: "hand" },
      { key: "foeNew", def: character({ name: "FoeNew", cost: 1 }), owner: P2, zone: "hand" },
      ...bank("greed", 2, P1)
    ]
  });
  const before = [influenceOf(engine, P1), influenceOf(engine, P2)];
  play(engine, P1, id("newcomer"));
  assert.deepEqual([influenceOf(engine, P1), influenceOf(engine, P2)], before);
});

clause(LAWYER, "0:rule", "a Lawyer that is already in play at the start loses nothing (only entering triggers it)", () => {
  const { engine } = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }] });
  assert.equal(influenceOf(engine, P1), START_INFLUENCE, "placed directly into play: it did not 'enter play' during the game");
});

clause(LAWYER, "0:rule", "two Lawyers entering play lose 2 each", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      ...lawyerHand(8),
      { key: "law2", def: printing(LAWYER), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("law"));
  play(engine, P1, id("law2"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 4);
});

clause(LAWYER, "0:rule", "the opponent's Lawyer costs THEIR faction 2 influence, not the player of the other seat", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "law", def: printing(LAWYER), owner: P2, zone: "hand" }, ...bank("greed", 4, P2)]
  });
  play(engine, P2, id("law"));
  assert.equal(influenceOf(engine, P2), START_INFLUENCE - 2);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(LAWYER, "0:rule", "it triggers when put into play by an effect too (not only when deployed)", () => {
  const reanimate = tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { owner: "self", zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "law", def: printing(LAWYER), owner: P1, zone: "discard" },
      { key: "re", def: reanimate, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("re"), { selected: { t: [id("law")] } });
  assert.equal(zoneOf(engine, id("law")), "play");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 2);
});

clause(LAWYER, "0:rule", "losing influence is not capped by the faction: with 2 influence left the Lawyer takes it to 0 and its controller loses the game", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 2 },
    cards: lawyerHand(4)
  });
  play(engine, P1, id("law"));
  assert.equal(influenceOf(engine, P1), 0);
  assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P2] }, "the faction at 0 influence loses");
});

clause(LAWYER, "0:rule", "with 3 influence left it goes to 1 and the game continues", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 3 },
    cards: lawyerHand(4)
  });
  play(engine, P1, id("law"));
  assert.equal(influenceOf(engine, P1), 1);
  assert.equal(engine.state.result, undefined);
});

clause(LAWYER, "0:rule", "is refused one resource short of its cost of 4, and without [G][G]", () => {
  const short = buildGame({ playerA: { faction: developFaction() }, cards: lawyerHand(3) });
  assert.throws(() => playRaw(short.engine, P1, short.id("law")));
  assert.equal(influenceOf(short.engine, P1), START_INFLUENCE, "nothing happened");
  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: lawyerHand(1, 6) });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("law")), "[G][G] needs two Greed");
  const exact = buildGame({ playerA: { faction: developFaction() }, cards: lawyerHand(2, 2) });
  play(exact.engine, P1, exact.id("law"));
  assert.equal(zoneOf(exact.engine, exact.id("law")), "play");
  assert.equal(exact.engine.getStat(exact.id("law"), "strength"), 3);
  assert.equal(exact.engine.getStat(exact.id("law"), "life"), 3);
  assert.equal(exact.engine.getStat(exact.id("law"), "speed"), 3);
});

// --- 1:rule  destroyed in a battle: gain X = total strength of the opposing party

clause(LAWYER, "1:rule", "attacking and killed by a single blocker: its controller gains the blocker's strength", () => {
  const { engine, id } = warBoard([{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }], [fighter("blk", P2, 5, 9)]);
  fight(engine, P1, [id("law")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(zoneOf(engine, id("law")), "discard", "the Lawyer died");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 5, "X = the opposing party's strength (5)");
  assert.equal(influenceOf(engine, P2), START_INFLUENCE, "the opponent gains and loses nothing");
});

for (const strength of [1, 3, 4, 9]) {
  clause(LAWYER, "1:rule", `X is the opposing party's strength: a ${strength}-strength blocker (X=${strength})`, () => {
    const { engine, id } = warBoard([{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }], [fighter("blk", P2, strength, 20)]);
    fight(engine, P1, [id("law")], { type: "faction", playerId: P2 }, [id("blk")]);
    if (strength >= 3) {
      assert.equal(zoneOf(engine, id("law")), "discard");
      assert.equal(influenceOf(engine, P1), START_INFLUENCE + strength);
    } else {
      assert.equal(zoneOf(engine, id("law")), "play", "a 1-strength blocker cannot kill a 3-life Lawyer");
      assert.equal(influenceOf(engine, P1), START_INFLUENCE, "not destroyed: no gain");
    }
  });
}

clause(LAWYER, "1:rule", "X is the TOTAL strength of the opposing party: two blockers of 4 and 2 give 6", () => {
  const { engine, id } = warBoard(
    [{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }],
    [fighter("b1", P2, 4, 20), fighter("b2", P2, 2, 20)]
  );
  declareAttackBy(engine, P1, [id("law")]);
  declareBlock(engine, P2, [id("b1"), id("b2")]);
  resolveSending(engine, { [id("b1")]: id("law"), [id("b2")]: id("law") });
  assert.equal(zoneOf(engine, id("law")), "discard");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 6);
});

clause(LAWYER, "1:rule", "the Lawyer's own party-mates are not the opposing party: their strength is not counted", () => {
  const { engine, id } = warBoard(
    [{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }, fighter("buddy", P1, 7, 20)],
    [fighter("blk", P2, 5, 20)]
  );
  declareAttackBy(engine, P1, [id("law"), id("buddy")]);
  declareBlock(engine, P2, [id("blk")]);
  resolveSending(engine, { [id("blk")]: id("law") });
  assert.equal(zoneOf(engine, id("law")), "discard");
  assert.equal(zoneOf(engine, id("buddy")), "play");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 5, "only the blocker's 5, not the buddy's 7");
});

clause(LAWYER, "1:rule", "blocking: killed by an attacking party, its controller gains the attackers' total strength", () => {
  const { engine, id } = warBoard(
    [{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }],
    [fighter("a1", P2, 4, 20), fighter("a2", P2, 3, 20)],
    { active: P2 }
  );
  declareAttackBy(engine, P2, [id("a1"), id("a2")]);
  declareBlock(engine, P1, [id("law")]);
  resolveSending(engine, { [id("a1")]: id("law"), [id("a2")]: id("law") });
  assert.equal(zoneOf(engine, id("law")), "discard");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 7, "4 + 3");
  assert.equal(influenceOf(engine, P2), START_INFLUENCE);
});

clause(LAWYER, "1:rule", "the opposing party's CURRENT strength counts (a +2 modifier on a blocker is included)", () => {
  const { engine, id } = warBoard(
    [{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }],
    [
      fighter("blk", P2, 3, 20),
      {
        key: "buff",
        def: item({ name: "Buff", attachTo: "character", behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] } }),
        owner: P2,
        zone: "play",
        attachedToKey: "blk"
      }
    ]
  );
  assert.equal(engine.getStat(id("blk"), "strength"), 5);
  fight(engine, P1, [id("law")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 5);
});

clause(LAWYER, "1:rule", "a Lawyer that survives its battle gains nothing", () => {
  const { engine, id } = warBoard([{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }], [fighter("blk", P2, 2, 20)]);
  fight(engine, P1, [id("law")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(zoneOf(engine, id("law")), "play");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(LAWYER, "1:rule", "an unblocked Lawyer is not destroyed: no gain", () => {
  const { engine, id } = warBoard([{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }], [fighter("blk", P2, 9, 20)]);
  fight(engine, P1, [id("law")], { type: "faction", playerId: P2 }, []);
  assert.equal(zoneOf(engine, id("law")), "play");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
  assert.equal(influenceOf(engine, P2), START_INFLUENCE - 3, "it dealt its 3 to the faction");
});

clause(LAWYER, "1:rule", "destroyed OUTSIDE a battle (a tactic on an ordinary turn) it gains nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "law", def: printing(LAWYER), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      fighter("blk", P2, 9, 20)
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("law")] } });
  assert.equal(zoneOf(engine, id("law")), "discard");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE, "no battle: no influence");
});

clause(LAWYER, "1:rule", "destroyed outside a battle by damage (a damage tactic) it gains nothing either", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "law", def: printing(LAWYER), owner: P1, zone: "play" },
      { key: "smite", def: damageTactic(3), owner: P1, zone: "hand" },
      fighter("blk", P2, 4, 20)
    ]
  });
  play(engine, P1, id("smite"), { selected: { t: [id("law")] } });
  assert.equal(zoneOf(engine, id("law")), "discard");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(LAWYER, "1:rule", "destroyed in a battle it is NOT part of (it sits at home while others fight) it gains nothing: it has no opposing party", () => {
  const { engine, id } = warBoard(
    [
      { key: "law", def: printing(LAWYER), owner: P1, zone: "play" },
      fighter("front", P1, 1, 20),
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ],
    [fighter("blk", P2, 6, 20)]
  );
  declareAttackBy(engine, P1, [id("front")]);
  declareBlock(engine, P2, [id("blk")]);
  assert.equal(battleOf(engine) !== undefined, true);
  // The attacker (P1) may use a tactic at a battle response point.
  play(engine, P1, id("kill"), { selected: { t: [id("law")] } });
  assert.equal(zoneOf(engine, id("law")), "discard");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE, "the Lawyer was not in that battle: there is no opposing party to count");
});

clause(LAWYER, "1:rule", "destroyed (by a tactic) while it fights in the battle it counts as destroyed in a battle: X is the opposing party's strength", () => {
  const { engine, id } = warBoard(
    [
      { key: "law", def: printing(LAWYER), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ],
    [fighter("blk", P2, 6, 20)]
  );
  declareAttackBy(engine, P1, [id("law")]);
  declareBlock(engine, P2, [id("blk")]);
  play(engine, P1, id("kill"), { selected: { t: [id("law")] } });
  assert.equal(zoneOf(engine, id("law")), "discard");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 6);
});

clause(LAWYER, "1:rule", "two Lawyers destroyed in the same battle each gain X", () => {
  const { engine, id } = warBoard(
    [
      { key: "law", def: printing(LAWYER), owner: P1, zone: "play" },
      { key: "law2", def: printing(LAWYER), owner: P1, zone: "play" }
    ],
    [fighter("big", P2, 6, 20)]
  );
  declareAttackBy(engine, P1, [id("law"), id("law2")]);
  declareBlock(engine, P2, [id("big")]);
  autoResolveBattle(engine, (source) => {
    if (source.cardId === id("big")) {
      return [
        { sourceId: source.cardId, target: { type: "card", cardId: id("law") }, amount: 3 },
        { sourceId: source.cardId, target: { type: "card", cardId: id("law2") }, amount: 3 }
      ];
    }
    return source.legalTargets.length ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : [];
  });
  assert.equal(zoneOf(engine, id("law")), "discard");
  assert.equal(zoneOf(engine, id("law2")), "discard");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 12, "6 for each Lawyer");
});

clause(LAWYER, "1:rule", "an opposing character that was destroyed earlier in the battle is no longer in the party: its strength is not counted", () => {
  // The Lawyer (speed 3) kills the fast, fragile scout (speed 5) in the first speed group... the scout hits first (speed 5), then
  // the Lawyer (speed 3) kills it while the heavy (speed 1) is still waiting; the heavy then kills the Lawyer.
  const { engine, id } = warBoard(
    [{ key: "law", def: printing(LAWYER), owner: P1, zone: "play" }],
    [
      { key: "scout", def: character({ name: "Scout", strength: 2, life: 1, speed: 5 }), owner: P2, zone: "play" },
      { key: "heavy", def: character({ name: "Heavy", strength: 4, life: 20, speed: 1 }), owner: P2, zone: "play" }
    ]
  );
  declareAttackBy(engine, P1, [id("law")]);
  declareBlock(engine, P2, [id("scout"), id("heavy")]);
  resolveSending(engine, { [id("law")]: id("scout"), [id("scout")]: id("law"), [id("heavy")]: id("law") });
  assert.equal(zoneOf(engine, id("scout")), "discard", "the scout died in the speed-3 group");
  assert.equal(zoneOf(engine, id("law")), "discard", "the heavy then finished the Lawyer");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 4, "the opposing party at that time was only the heavy (4)");
});

// =============================================================================
// Necromorph Bureaucrat
// SUBJUGATE -- COST: Deplete this card. Pick 2 or fewer characters.
// EFFECT: Deplete the characters.
// Character, cost 9, threshold [G][G], 1 / 3 / 1.
// =============================================================================

const BUREAUCRAT = "64fb1c3d-149c-43ca-92e0-c3f7cefa4548";

function bureaucratBoard(opts: { greed?: number; bureaucratDepleted?: boolean; turn?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    cards: [
      { key: "bur", def: printing(BUREAUCRAT), owner: P1, zone: "play", depleted: opts.bureaucratDepleted ?? false },
      { key: "m1", def: character({ name: "Mine1" }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
      { key: "f1", def: character({ name: "Foe1" }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "Foe2" }), owner: P2, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const subjugate = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, keys: string[], playerId: Pid = P1) =>
  activate(engine, playerId, id("bur"), "subjugate", { selected: { cs: keys.map(id) } });

const depletedKeys = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, keys: string[]) =>
  keys.filter((key) => engine.state.cards[id(key)].depleted);

clause(BUREAUCRAT, "0:ability:subjugate", "depletes itself as the cost and the two picked characters (one of each side) as the effect; nobody else", () => {
  const { engine, id } = bureaucratBoard();
  subjugate(engine, id, ["m1", "f1"]);
  assert.equal(engine.state.cards[id("bur")].depleted, true, "COST: deplete this card");
  assert.deepEqual(depletedKeys(engine, id, ["m1", "m2", "f1", "f2"]), ["m1", "f1"], "exactly the picked characters are depleted");
});

clause(BUREAUCRAT, "0:ability:subjugate", "two picks on the opponent's side", () => {
  const { engine, id } = bureaucratBoard();
  subjugate(engine, id, ["f1", "f2"]);
  assert.deepEqual(depletedKeys(engine, id, ["m1", "m2", "f1", "f2"]), ["f1", "f2"]);
});

clause(BUREAUCRAT, "0:ability:subjugate", "two picks on your own side", () => {
  const { engine, id } = bureaucratBoard();
  subjugate(engine, id, ["m1", "m2"]);
  assert.deepEqual(depletedKeys(engine, id, ["m1", "m2", "f1", "f2"]), ["m1", "m2"]);
});

clause(BUREAUCRAT, "0:ability:subjugate", "'2 or fewer': a single pick depletes just that character", () => {
  const { engine, id } = bureaucratBoard();
  subjugate(engine, id, ["f2"]);
  assert.equal(engine.state.cards[id("bur")].depleted, true);
  assert.deepEqual(depletedKeys(engine, id, ["m1", "m2", "f1", "f2"]), ["f2"]);
});

clause(BUREAUCRAT, "0:ability:subjugate", "'2 or fewer' includes zero: picking nothing still pays the deplete cost and depletes nobody else", () => {
  const { engine, id } = bureaucratBoard();
  subjugate(engine, id, []);
  assert.equal(engine.state.cards[id("bur")].depleted, true, "the cost was paid");
  assert.deepEqual(depletedKeys(engine, id, ["m1", "m2", "f1", "f2"]), []);
});

clause(BUREAUCRAT, "0:ability:subjugate", "three picks are refused, and nothing is depleted (not even the Bureaucrat)", () => {
  const { engine, id } = bureaucratBoard({ extra: [{ key: "m3", def: character({ name: "Mine3" }), owner: P1, zone: "play" }] });
  assert.throws(() => subjugate(engine, id, ["m1", "m2", "f1"]));
  assert.equal(engine.state.cards[id("bur")].depleted, false);
  assert.deepEqual(depletedKeys(engine, id, ["m1", "m2", "m3", "f1", "f2"]), []);
});

clause(BUREAUCRAT, "0:ability:subjugate", "the same character cannot be picked twice", () => {
  const { engine, id } = bureaucratBoard();
  assert.throws(() => subjugate(engine, id, ["f1", "f1"]));
  assert.equal(engine.state.cards[id("bur")].depleted, false);
  assert.equal(engine.state.cards[id("f1")].depleted, false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "only characters can be picked: an item, a location, a faction and a face-down resource are refused", () => {
  const { engine, id } = bureaucratBoard();
  assert.throws(() => subjugate(engine, id, ["gadget"]), "item");
  assert.throws(() => subjugate(engine, id, ["place"]), "location");
  assert.throws(() => activate(engine, P1, id("bur"), "subjugate", { selected: { cs: [engine.state.players[P2].factionId!] } }), "faction (CR 202.9)");
  assert.throws(() => subjugate(engine, id, ["hidden"]), "a face-down card is only a resource");
  assert.throws(() => subjugate(engine, id, ["f1", "gadget"]), "a character plus an item");
  assert.equal(engine.state.cards[id("bur")].depleted, false, "every refusal left the Bureaucrat ready");
});

clause(BUREAUCRAT, "0:ability:subjugate", "a card that is not in play (hand / discard) cannot be picked", () => {
  const { engine, id } = bureaucratBoard({
    extra: [
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
    ]
  });
  assert.throws(() => subjugate(engine, id, ["inHand"]));
  assert.throws(() => subjugate(engine, id, ["inDiscard"]));
});

clause(BUREAUCRAT, "0:ability:subjugate", "an already-depleted character may be picked; it simply stays depleted (and the other pick is depleted)", () => {
  const { engine, id } = bureaucratBoard({ extra: [] });
  engine.state.cards[id("f1")].depleted = true;
  subjugate(engine, id, ["f1", "m2"]);
  assert.equal(engine.state.cards[id("f1")].depleted, true);
  assert.equal(engine.state.cards[id("m2")].depleted, true);
});

clause(BUREAUCRAT, "0:ability:subjugate", "it may pick itself (it is a character in play), and the other pick is still depleted", () => {
  const { engine, id } = bureaucratBoard();
  subjugate(engine, id, ["bur", "f1"]);
  assert.equal(engine.state.cards[id("bur")].depleted, true);
  assert.equal(engine.state.cards[id("f1")].depleted, true);
  assert.equal(engine.state.cards[id("m1")].depleted, false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "the cost is 'deplete this card': a depleted Bureaucrat cannot use it, and nothing changes", () => {
  const { engine, id } = bureaucratBoard({ bureaucratDepleted: true });
  assert.throws(() => subjugate(engine, id, ["f1", "f2"]));
  assert.deepEqual(depletedKeys(engine, id, ["m1", "m2", "f1", "f2"]), []);
});

clause(BUREAUCRAT, "0:ability:subjugate", "it costs no resources: usable with none, and none are spent", () => {
  const { engine, id } = bureaucratBoard({ greed: 0 });
  subjugate(engine, id, ["f1"]);
  assert.equal(engine.state.cards[id("f1")].depleted, true);
  const rich = bureaucratBoard({ greed: 3 });
  subjugate(rich.engine, rich.id, ["f1"]);
  assert.equal(readyCount(rich.engine, P1), 3, "no resources attached");
  assert.equal(attachedCount(rich.engine, P1), 0);
});

clause(BUREAUCRAT, "0:ability:subjugate", "once used it is depleted, so it cannot be used a second time that turn", () => {
  const { engine, id } = bureaucratBoard();
  subjugate(engine, id, ["f1"]);
  assert.throws(() => subjugate(engine, id, ["f2"]));
  assert.equal(engine.state.cards[id("f2")].depleted, false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "the opponent cannot use it", () => {
  const { engine, id } = bureaucratBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => subjugate(engine, id, ["m1"], P2));
  assert.equal(engine.state.cards[id("m1")].depleted, false);
  assert.equal(engine.state.cards[id("bur")].depleted, false);
});

clause(BUREAUCRAT, "0:ability:subjugate", "a depleted blocker cannot block: Subjugate the opponent's characters and they cannot defend", () => {
  const { engine, id } = bureaucratBoard();
  subjugate(engine, id, ["f1", "f2"]);
  declareAttackBy(engine, P1, [id("m1")]);
  assert.throws(() => declareBlock(engine, P2, [id("f1")]), "f1 is depleted");
  assert.throws(() => declareBlock(engine, P2, [id("f2")]), "f2 is depleted");
  declareBlock(engine, P2, []);
});

clause(BUREAUCRAT, "0:ability:subjugate", "a depleted character of yours cannot attack", () => {
  const { engine, id } = bureaucratBoard();
  subjugate(engine, id, ["m1", "m2"]);
  assert.throws(() => declareAttackBy(engine, P1, [id("m1")]));
  assert.throws(() => declareAttackBy(engine, P1, [id("m2")]));
});

clause(BUREAUCRAT, "0:ability:subjugate", "can be used the turn it enters play (abilities are not subject to summoning sickness): deploy for 9, then Subjugate", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bur", def: printing(BUREAUCRAT), owner: P1, zone: "hand" },
      { key: "f1", def: character({ name: "Foe1" }), owner: P2, zone: "play" },
      ...bank("greed", 9, P1)
    ]
  });
  const before = readyCount(engine, P1);
  play(engine, P1, id("bur"));
  assert.equal(before - readyCount(engine, P1), 9, "the printed cost of 9 is paid");
  subjugate(engine, id, ["f1"]);
  assert.equal(engine.state.cards[id("f1")].depleted, true);
});

clause(BUREAUCRAT, "0:ability:subjugate", "the card itself: 9 resources and [G][G] are required, and it has its printed 1 / 3 / 1", () => {
  const mk = (greed: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "bur", def: printing(BUREAUCRAT), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const short = mk(8, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("bur")), "8 resources is one short of 9");
  const noThreshold = mk(1, 9);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("bur")), "one Greed is short of [G][G]");
  const ok = mk(2, 7);
  play(ok.engine, P1, ok.id("bur"));
  assert.equal(zoneOf(ok.engine, ok.id("bur")), "play");
  assert.equal(ok.engine.getStat(ok.id("bur"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("bur"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("bur"), "life"), 1);
});

// =============================================================================
// Pervasive Bodyguard
// PROTECT -- COST: Pay 1. Pick a character in a party with this card.
// EFFECT: This turn, the character gains 1 life.
// Character, cost 6, threshold [G][G], 4 / 2 / 4.
// =============================================================================

const BODYGUARD = "cfb3b871-eb82-43b8-9f1b-d8d2359d3c1e";

/** P1's Bodyguard (or P2's when `guardOwner` is P2) with an ally, a benched character and two characters on the other side. */
function bodyguardBoard(opts: { greed?: number; guardOwner?: Pid } = {}) {
  const guardOwner = opts.guardOwner ?? P1;
  const foe = other(guardOwner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "pb", def: printing(BODYGUARD), owner: guardOwner, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 2 }), owner: guardOwner, zone: "play" },
      { key: "bench", def: character({ name: "Bench", strength: 1, life: 3, speed: 2 }), owner: guardOwner, zone: "play" },
      { key: "foe1", def: character({ name: "Foe1", strength: 3, life: 6, speed: 2 }), owner: foe, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 6, speed: 2 }), owner: foe, zone: "play" },
      ...bank("greed", opts.greed ?? 4, guardOwner)
    ]
  });
}

const protectAs = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, targetKey: string, player: Pid) =>
  engine.perform({ type: "activateAbility", playerId: player, cardId: id("pb"), abilityId: "protect", selected: { c: [id(targetKey)] }, variables: {} } as never);

/** `attacker` declares an attack on the other faction and KEEPS priority (so the attacker can use abilities now). */
function startAttack(engine: SpoilsEngine, attacker: Pid, attackerIds: CardInstanceId[]) {
  engine.perform({ type: "declareAttack", playerId: attacker, attackerIds, target: { type: "faction", playerId: other(attacker) } });
}

/** Lets priority pass until `player` holds the open response window. */
function passUntil(engine: SpoilsEngine, player: Pid) {
  for (let guard = 0; guard < 10; guard++) {
    const window = engine.state.responseWindow;
    if (!window || window.phase !== "acceptingResponses" || window.priorityPlayerId === player) return;
    engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
  }
}

clause(BODYGUARD, "0:ability:protect", "an attacking party-mate gains exactly 1 life this turn; pay 1 is paid; the Bodyguard may be depleted from attacking", () => {
  const { engine, id } = bodyguardBoard();
  startAttack(engine, P1, [id("pb"), id("ally")]);
  assert.equal(engine.state.cards[id("pb")].depleted, true, "attacking depleted the Bodyguard; PROTECT has no deplete cost");
  const before = readyCount(engine, P1);
  protectAs(engine, id, "ally", P1);
  resolvePendingResponses(engine);
  assert.equal(before - readyCount(engine, P1), 1, "exactly 1 resource");
  assert.equal(engine.getStat(id("ally"), "life"), 4, "3 + 1");
  assert.equal(engine.getStat(id("pb"), "life"), 4, "the Bodyguard itself is unchanged");
  assert.equal(engine.getStat(id("bench"), "life"), 3, "a character outside the party is unchanged");
  assert.equal(engine.getStat(id("foe1"), "life"), 6);
  assert.equal(engine.getStat(id("ally"), "strength"), 1, "only life changes");
});

clause(BODYGUARD, "0:ability:protect", "the extra life is real: a 3-damage hit that would kill the 3-life ally does not (control: without PROTECT it dies)", () => {
  const run = (withProtect: boolean) => {
    const { engine, id } = bodyguardBoard();
    startAttack(engine, P1, [id("pb"), id("ally")]);
    if (withProtect) protectAs(engine, id, "ally", P1);
    resolvePendingResponses(engine);
    declareBlock(engine, P2, [id("foe1")]);
    resolveSending(engine, { [id("foe1")]: id("ally") });
    return { engine, id };
  };
  const control = run(false);
  assert.equal(zoneOf(control.engine, control.id("ally")), "discard", "control: 3 damage kills a 3-life character");
  const protectedRun = run(true);
  assert.equal(zoneOf(protectedRun.engine, protectedRun.id("ally")), "play", "with +1 life the same damage does not kill");
  assert.equal(protectedRun.engine.state.cards[protectedRun.id("ally")].damage, 3);
});

clause(BODYGUARD, "0:ability:protect", "a blocking party-mate can be protected too (the Bodyguard's side is being attacked)", () => {
  const { engine, id } = bodyguardBoard({ guardOwner: P2 });
  startAttack(engine, P1, [id("foe1")]);
  resolvePendingResponses(engine);
  declareBlock(engine, P2, [id("pb"), id("ally")]);
  passUntil(engine, P2);
  const before = readyCount(engine, P2);
  protectAs(engine, id, "ally", P2);
  resolvePendingResponses(engine);
  assert.equal(before - readyCount(engine, P2), 1);
  assert.equal(engine.getStat(id("ally"), "life"), 4);
  assert.equal(engine.getStat(id("pb"), "life"), 4);
});

clause(BODYGUARD, "0:ability:protect", "it may pick itself (it is a character in the party with itself)", () => {
  const { engine, id } = bodyguardBoard();
  startAttack(engine, P1, [id("pb"), id("ally")]);
  protectAs(engine, id, "pb", P1);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("pb"), "life"), 5);
  assert.equal(engine.getStat(id("ally"), "life"), 3);
});

clause(BODYGUARD, "0:ability:protect", "a character NOT in a party with the Bodyguard cannot be picked (a benched character of yours)", () => {
  const { engine, id } = bodyguardBoard();
  startAttack(engine, P1, [id("pb"), id("ally")]);
  assert.throws(() => protectAs(engine, id, "bench", P1));
  assert.equal(readyCount(engine, P1), 4, "nothing was paid");
});

clause(BODYGUARD, "0:ability:protect", "a character of the OPPOSING party cannot be picked (it is in a party, but not with this card)", () => {
  const { engine, id } = bodyguardBoard();
  startAttack(engine, P1, [id("pb"), id("ally")]);
  resolvePendingResponses(engine);
  declareBlock(engine, P2, [id("foe1")]);
  assert.throws(() => protectAs(engine, id, "foe1", P1));
  assert.throws(() => protectAs(engine, id, "foe2", P1), "a character not in any party");
  assert.equal(engine.getStat(id("foe1"), "life"), 6);
});

clause(BODYGUARD, "0:ability:protect", "when the Bodyguard is not itself in the battle, nobody is 'in a party with this card'", () => {
  const { engine, id } = bodyguardBoard();
  startAttack(engine, P1, [id("ally")]);
  assert.throws(() => protectAs(engine, id, "ally", P1), "the ally is in a party, but without the Bodyguard");
  assert.throws(() => protectAs(engine, id, "pb", P1), "the Bodyguard is not in a party at all");
});

clause(BODYGUARD, "0:ability:protect", "outside a battle there are no parties, so nothing can be picked", () => {
  const { engine, id } = bodyguardBoard();
  assert.throws(() => protectAs(engine, id, "ally", P1));
  assert.throws(() => protectAs(engine, id, "pb", P1));
  assert.equal(readyCount(engine, P1), 4);
});

clause(BODYGUARD, "0:ability:protect", "pay 1 is required: refused with no ready resources, allowed with exactly one", () => {
  const none = bodyguardBoard({ greed: 0 });
  startAttack(none.engine, P1, [none.id("pb"), none.id("ally")]);
  assert.throws(() => protectAs(none.engine, none.id, "ally", P1));
  assert.equal(none.engine.getStat(none.id("ally"), "life"), 3);
  const one = bodyguardBoard({ greed: 1 });
  startAttack(one.engine, P1, [one.id("pb"), one.id("ally")]);
  protectAs(one.engine, one.id, "ally", P1);
  resolvePendingResponses(one.engine);
  assert.equal(one.engine.getStat(one.id("ally"), "life"), 4);
  assert.equal(readyCount(one.engine, P1), 0);
});

clause(BODYGUARD, "0:ability:protect", "it can be used repeatedly: two uses (one before blocks, one after) give +2 life and cost 2", () => {
  const { engine, id } = bodyguardBoard();
  startAttack(engine, P1, [id("pb"), id("ally")]);
  protectAs(engine, id, "ally", P1);
  resolvePendingResponses(engine);
  declareBlock(engine, P2, [id("foe2")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the attacker holds the post-block window");
  protectAs(engine, id, "ally", P1);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("ally"), "life"), 5, "3 + 1 + 1");
  assert.equal(readyCount(engine, P1), 2, "4 - 1 - 1");
});

clause(BODYGUARD, "0:ability:protect", "gaining life does not heal: damage already on the character stays", () => {
  const { engine, id } = bodyguardBoard();
  engine.state.cards[id("ally")].damage = 2;
  startAttack(engine, P1, [id("pb"), id("ally")]);
  protectAs(engine, id, "ally", P1);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("ally")].damage, 2);
  assert.equal(engine.getStat(id("ally"), "life"), 4);
});

clause(BODYGUARD, "0:ability:protect", "the life bonus lasts the whole turn, and is gone when the turn ends", () => {
  const { engine, id } = bodyguardBoard();
  startAttack(engine, P1, [id("pb"), id("ally")]);
  protectAs(engine, id, "ally", P1);
  resolvePendingResponses(engine);
  declareBlock(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(battleOf(engine), undefined);
  assert.equal(engine.getStat(id("ally"), "life"), 4, "still +1 after the battle, later in the same turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("ally"), "life"), 3, "'this turn' has ended");
});

clause(BODYGUARD, "0:ability:protect", "the opponent cannot use my Bodyguard's PROTECT (even holding the response window)", () => {
  const { engine, id } = bodyguardBoard();
  startAttack(engine, P1, [id("pb"), id("ally")]);
  passUntil(engine, P2);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  assert.throws(() => protectAs(engine, id, "ally", P2));
  assert.equal(engine.getStat(id("ally"), "life"), 3);
});

clause(BODYGUARD, "0:ability:protect", "the card itself: costs 6 with [G][G], and has its printed 4 / 2 / 4", () => {
  const mk = (greed: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "pb", def: printing(BODYGUARD), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const short = mk(5, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("pb")), "5 is one short of 6");
  const noThreshold = mk(1, 8);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("pb")), "one Greed is short of [G][G]");
  const ok = mk(2, 4);
  const before = readyCount(ok.engine, P1);
  play(ok.engine, P1, ok.id("pb"));
  assert.equal(before - readyCount(ok.engine, P1), 6);
  assert.equal(ok.engine.getStat(ok.id("pb"), "strength"), 4);
  assert.equal(ok.engine.getStat(ok.id("pb"), "speed"), 2);
  assert.equal(ok.engine.getStat(ok.id("pb"), "life"), 4);
});

// =============================================================================
// Rate Hike
// Your faction gains 2 influence. Draw a card.
// Tactic, cost 3, threshold [G].
// =============================================================================

const RATE_HIKE = "fef9f4bb-3538-4625-97fe-0b562ebcb6c8";

function hikeBoard(opts: { greed?: number; rage?: number; deck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rh", def: printing(RATE_HIKE), owner: P1, zone: "hand" },
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.deck ?? 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", opts.rage ?? 0, P1)
    ]
  });
}

clause(RATE_HIKE, "0:rule", "your faction gains exactly 2 influence and the opponent's does not change", () => {
  const { engine, id } = hikeBoard();
  play(engine, P1, id("rh"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 2);
  assert.equal(influenceOf(engine, P2), START_INFLUENCE);
});

clause(RATE_HIKE, "0:rule", "you draw exactly one card: the top card of YOUR deck", () => {
  const { engine, id } = hikeBoard();
  const top = engine.state.players[P1].deck[0];
  const deckBefore = engine.state.players[P1].deck.length;
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("rh"));
  assert.equal(zoneOf(engine, top), "hand", "the top card is drawn");
  assert.equal(engine.state.players[P1].deck.length, deckBefore - 1, "exactly one card left the deck");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left the hand (-1) and one card was drawn (+1)");
});

clause(RATE_HIKE, "0:rule", "the opponent's hand and deck are untouched", () => {
  const { engine, id } = hikeBoard();
  const oppDeck = [...engine.state.players[P2].deck];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("rh"));
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(RATE_HIKE, "0:rule", "pays exactly 3 and the tactic goes to its owner's discard pile", () => {
  const { engine, id } = hikeBoard({ greed: 5 });
  const before = readyCount(engine, P1);
  play(engine, P1, id("rh"));
  assert.equal(before - readyCount(engine, P1), 3);
  assert.equal(zoneOf(engine, id("rh")), "discard");
  assert.equal(engine.state.pendingChoice, undefined, "nothing is asked");
});

clause(RATE_HIKE, "0:rule", "with an empty deck the influence is still gained (failing to draw is not a loss, CR 102.1a)", () => {
  const { engine, id } = hikeBoard({ deck: 0 });
  play(engine, P1, id("rh"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 2);
  assert.equal(engine.state.result, undefined);
  assert.equal(zoneOf(engine, id("rh")), "discard");
});

clause(RATE_HIKE, "0:rule", "the influence gain is not capped by the starting influence", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 50 },
    cards: [{ key: "rh", def: printing(RATE_HIKE), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  play(engine, P1, id("rh"));
  assert.equal(influenceOf(engine, P1), 52);
});

clause(RATE_HIKE, "0:rule", "is refused with only 2 resources, and without [G] even with plenty of other resources", () => {
  const short = hikeBoard({ greed: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rh")));
  assert.equal(influenceOf(short.engine, P1), START_INFLUENCE, "nothing happened");
  assert.equal(zoneOf(short.engine, short.id("rh")), "hand");
  const noThreshold = hikeBoard({ greed: 0, rage: 6 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rh")));
  const exact = hikeBoard({ greed: 1, rage: 2 });
  play(exact.engine, P1, exact.id("rh"));
  assert.equal(influenceOf(exact.engine, P1), START_INFLUENCE + 2, "one [G] and 3 resources in total is enough");
});

// =============================================================================
// Recapitulating Apparition
// If this card is put into your discard pile from play, you may pay 1. If you
// do, put this card into play under your control, depleted.
// Character, cost 3, threshold [G][G][G], 2 / 3 / 1.
// =============================================================================

const APPARITION = "956f4342-c5bd-4347-82b5-2c535c53841d";

function apparitionBoard(opts: { greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(APPARITION), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const killApparition = (engine: SpoilsEngine, id: (key: string) => CardInstanceId) => play(engine, P1, id("kill"), { selected: { t: [id("ra")] } });

clause(APPARITION, "0:rule", "destroyed from play, its controller is offered 'you may pay 1'", () => {
  const { engine, id } = apparitionBoard();
  killApparition(engine, id);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; cost: Array<{ type: string; amount: number }> };
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cost.map((c) => [c.type, c.amount]), [["payResources", 1]], "the price is exactly 1");
  assert.equal(zoneOf(engine, id("ra")), "discard", "it is in the discard pile while the choice is open");
});

clause(APPARITION, "0:rule", "paying 1: it returns to play under your control, depleted, and exactly 1 resource is spent", () => {
  const { engine, id } = apparitionBoard({ greed: 3 });
  const before = readyCount(engine, P1);
  killApparition(engine, id);
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
  assert.equal(engine.state.cards[id("ra")].controllerId, P1);
  assert.equal(engine.state.cards[id("ra")].depleted, true, "it comes back depleted");
  assert.equal(before - readyCount(engine, P1), 1, "exactly 1 paid");
  assert.equal(discardOf(engine, P1).includes(id("ra")), false, "no longer in the discard pile");
  assert.ok(engine.state.players[P1].play.includes(id("ra")), "engine.state.players[P1].play.includes(id(\"ra\"))");
});

clause(APPARITION, "0:rule", "it comes back as a fresh card: no damage, at full life", () => {
  const { engine, id } = apparitionBoard();
  killApparition(engine, id);
  answerMayPay(engine, true);
  assert.equal(engine.state.cards[id("ra")].damage, 0);
  assert.equal(engine.getStat(id("ra"), "life"), 1);
  assert.equal(engine.getStat(id("ra"), "strength"), 2);
});

clause(APPARITION, "0:rule", "declining the payment: it stays in the discard pile and nothing is paid", () => {
  const { engine, id } = apparitionBoard({ greed: 3 });
  const before = readyCount(engine, P1);
  killApparition(engine, id);
  answerMayPay(engine, false);
  assert.equal(zoneOf(engine, id("ra")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("ra")), "discardOf(engine, P1).includes(id(\"ra\"))");
  assert.equal(readyCount(engine, P1), before, "no resource spent");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(APPARITION, "0:rule", "with no resource to pay the 1, it cannot come back (it stays in the discard pile)", () => {
  const { engine, id } = apparitionBoard({ greed: 0 });
  killApparition(engine, id);
  if (engine.state.pendingChoice) {
    assert.throws(() => answerMayPay(engine, true), "you cannot pay 1 with 0 resources");
    drain(engine, declineAll);
  }
  assert.equal(zoneOf(engine, id("ra")), "discard");
});

clause(APPARITION, "0:rule", "all resources already spent counts as no resource: it cannot come back", () => {
  const { engine, id } = apparitionBoard({ greed: 0, extra: spentResources(P1, 2) });
  assert.equal(readyCount(engine, P1), 0);
  killApparition(engine, id);
  if (engine.state.pendingChoice) {
    assert.throws(() => answerMayPay(engine, true));
    drain(engine, declineAll);
  }
  assert.equal(zoneOf(engine, id("ra")), "discard");
});

clause(APPARITION, "0:rule", "it recurs every time: destroy it again after it returned and it can come back again", () => {
  const { engine, id } = apparitionBoard({ greed: 3, extra: [{ key: "kill2", def: killTactic(), owner: P1, zone: "hand" }] });
  killApparition(engine, id);
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
  play(engine, P1, id("kill2"), { selected: { t: [id("ra")] } });
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
  assert.equal(readyCount(engine, P1), 1, "paid 1 each time");
});

clause(APPARITION, "0:rule", "destroyed in battle counts too (it is put into the discard pile from play)", () => {
  const { engine, id } = warBoard(
    [{ key: "ra", def: printing(APPARITION), owner: P1, zone: "play" }, ...bank("greed", 3, P1)],
    [fighter("blk", P2, 5, 20)]
  );
  declareAttackBy(engine, P1, [id("ra")]);
  declareBlock(engine, P2, [id("blk")]);
  autoResolveBattle(engine);
  assert.equal(engine.state.pendingChoice?.kind, "mayPay", "asked after it died in the battle");
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
  assert.equal(engine.state.cards[id("ra")].depleted, true);
});

clause(APPARITION, "0:rule", "only 'put into your discard pile': returned to hand (bounced) it is not offered", () => {
  const { engine, id } = apparitionBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("ra")] } });
  assert.equal(zoneOf(engine, id("ra")), "hand");
  assert.equal(engine.state.pendingChoice, undefined, "no 'may pay' for leaving play any other way");
  assert.equal(readyCount(engine, P1), 3);
});

clause(APPARITION, "0:rule", "only 'from play': discarded from hand it does not come back, and nothing is offered", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(APPARITION), owner: P1, zone: "hand" },
      { key: "dump", def: discardFromHandTactic(), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  play(engine, P1, id("dump"), { selected: { t: [id("ra")] } });
  assert.equal(zoneOf(engine, id("ra")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(readyCount(engine, P1), 3);
});

clause(APPARITION, "0:rule", "only 'from play': milled from the deck into the discard pile it does not come back", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(APPARITION), owner: P1, zone: "deck" },
      { key: "mill", def: tactic({ name: "Mill", cost: 0, behavior: { abilities: [{ id: "m", type: "activated", effects: [{ type: "moveCard", target: { type: "random", selector: { owner: "self", zone: "deck" } }, to: "discard" }] }] } }), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  play(engine, P1, id("mill"));
  assert.equal(zoneOf(engine, id("ra")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(APPARITION, "0:rule", "it triggers off ITSELF: another character going to the discard pile from play does not offer anything", () => {
  const { engine, id } = apparitionBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("other")] } });
  assert.equal(zoneOf(engine, id("other")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("ra")), "play");
});

clause(APPARITION, "0:rule", "an opposing Apparition belongs to its own controller: THEY are offered the payment and pay from THEIR resources", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ra", def: printing(APPARITION), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("greed", 2, P2),
      ...bank("greed", 5, P1)
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("ra")] } });
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P2, "the Apparition's controller decides");
  const p1Ready = readyCount(engine, P1);
  answerMayPay(engine, true);
  assert.equal(zoneOf(engine, id("ra")), "play");
  assert.equal(engine.state.cards[id("ra")].controllerId, P2, "under ITS controller's control");
  assert.equal(readyCount(engine, P2), 1, "P2 paid 1");
  assert.equal(readyCount(engine, P1), p1Ready, "P1 paid nothing");
});

clause(APPARITION, "0:rule", "removed from the game instead (not put into the discard pile) it does not come back", () => {
  const { engine, id } = apparitionBoard({ extra: [{ key: "exile", def: tactic({ name: "Exile", cost: 0, behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("exile"), { selected: { t: [id("ra")] } });
  assert.equal(zoneOf(engine, id("ra")), "removed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(APPARITION, "0:rule", "the card itself: cost 3 with [G][G][G], printed 2 / 3 / 1", () => {
  const mk = (greed: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ra", def: printing(APPARITION), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const short = mk(2, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("ra")), "2 is one short of 3");
  const noThreshold = mk(2, 5);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ra")), "two Greed is one short of [G][G][G]");
  const ok = mk(3, 0);
  play(ok.engine, P1, ok.id("ra"));
  assert.equal(zoneOf(ok.engine, ok.id("ra")), "play");
  assert.equal(ok.engine.getStat(ok.id("ra"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("ra"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("ra"), "life"), 1);
});

// =============================================================================
// Red Tape
// COST: Pick a character. EFFECT: This turn, the character loses 3 strength.
// Draw a card.
// Tactic, cost 2, threshold [G][G].
// =============================================================================

const RED_TAPE = "a0ac1478-502c-4ff4-97f2-c52089d23130";

function tapeBoard(opts: { greed?: number; rage?: number; deck?: number; extra?: CardPlacement[]; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    cards: [
      { key: "rt", def: printing(RED_TAPE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 5, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", strength: 9 }), owner: P2, zone: "play", faceDown: true },
      ...Array.from({ length: opts.deck ?? 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("greed", opts.greed ?? 2, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const playTape = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, targetKey: string) => play(engine, P1, id("rt"), { selected: { c: [id(targetKey)] } });

clause(RED_TAPE, "0:ability", "the picked opposing character loses exactly 3 strength (4 -> 1) and no other stat", () => {
  const { engine, id } = tapeBoard();
  playTape(engine, id, "foe");
  assert.equal(engine.getStat(id("foe"), "strength"), 1);
  assert.equal(engine.getStat(id("foe"), "life"), 5, "life is unchanged");
  assert.equal(engine.getStat(id("foe"), "speed"), 2, "speed is unchanged");
});

clause(RED_TAPE, "0:ability", "it may pick your own character too (5 -> 2)", () => {
  const { engine, id } = tapeBoard();
  playTape(engine, id, "mine");
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
});

clause(RED_TAPE, "0:ability", "only the picked character is affected", () => {
  const { engine, id } = tapeBoard();
  playTape(engine, id, "foe");
  assert.equal(engine.getStat(id("mine"), "strength"), 5);
  assert.equal(engine.getStat(id("weak"), "strength"), 1);
});

clause(RED_TAPE, "0:ability", "strength cannot go below 0 (CR 410.4): a 1-strength character loses 3 and is at 0", () => {
  const { engine, id } = tapeBoard();
  playTape(engine, id, "weak");
  assert.equal(engine.getStat(id("weak"), "strength"), 0);
});

clause(RED_TAPE, "0:ability", "a 3-strength character is reduced to exactly 0", () => {
  const { engine, id } = tapeBoard({
    extra: [{ key: "three", def: character({ name: "Three", strength: 3, life: 5 }), owner: P2, zone: "play" }]
  });
  playTape(engine, id, "three");
  assert.equal(engine.getStat(id("three"), "strength"), 0);
});

clause(RED_TAPE, "0:ability", "you draw a card (the top of YOUR deck) even when the picked character is the opponent's", () => {
  const { engine, id } = tapeBoard();
  const top = engine.state.players[P1].deck[0];
  const oppDeck = [...engine.state.players[P2].deck];
  const oppHand = [...handOf(engine, P2)];
  const handBefore = handOf(engine, P1).length;
  playTape(engine, id, "foe");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left the hand, one card was drawn");
  assert.equal(engine.state.players[P1].deck.length, 2);
  assert.deepEqual(engine.state.players[P2].deck, oppDeck, "the opponent drew nothing");
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(RED_TAPE, "0:ability", "the card is drawn when the picked character is yours, too", () => {
  const { engine, id } = tapeBoard();
  const top = engine.state.players[P1].deck[0];
  playTape(engine, id, "mine");
  assert.equal(zoneOf(engine, top), "hand");
});

clause(RED_TAPE, "0:ability", "with an empty deck the strength loss still happens and nothing breaks", () => {
  const { engine, id } = tapeBoard({ deck: 0 });
  playTape(engine, id, "foe");
  assert.equal(engine.getStat(id("foe"), "strength"), 1);
  assert.equal(zoneOf(engine, id("rt")), "discard");
  assert.equal(engine.state.result, undefined);
});

clause(RED_TAPE, "0:ability", "pays exactly 2 and the tactic goes to its owner's discard pile", () => {
  const { engine, id } = tapeBoard({ greed: 5 });
  const before = readyCount(engine, P1);
  playTape(engine, id, "foe");
  assert.equal(before - readyCount(engine, P1), 2);
  assert.equal(zoneOf(engine, id("rt")), "discard");
});

clause(RED_TAPE, "0:ability", "'this turn': the character has its strength back once the turn ends", () => {
  const { engine, id } = tapeBoard();
  playTape(engine, id, "foe");
  assert.equal(engine.getStat(id("foe"), "strength"), 1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("foe"), "strength"), 4, "restored at the end of the turn");
});

clause(RED_TAPE, "0:ability", "two Red Tapes stack: 8 strength loses 3 twice (8 -> 2)", () => {
  const { engine, id } = tapeBoard({
    greed: 4,
    extra: [
      { key: "big", def: character({ name: "Big", strength: 8, life: 5 }), owner: P2, zone: "play" },
      { key: "rt2", def: printing(RED_TAPE), owner: P1, zone: "hand" }
    ]
  });
  playTape(engine, id, "big");
  play(engine, P1, id("rt2"), { selected: { c: [id("big")] } });
  assert.equal(engine.getStat(id("big"), "strength"), 2);
});

clause(RED_TAPE, "0:ability", "the lost strength is real in battle: a blocker debuffed from 4 to 1 deals only 1 damage", () => {
  const { engine, id } = tapeBoard();
  declareAttackBy(engine, P1, [id("mine")]);
  declareBlock(engine, P2, [id("foe")]);
  playTape(engine, id, "foe");
  autoResolveBattle(engine);
  assert.equal(engine.state.cards[id("mine")].damage, 1, "foe dealt 1 (4 - 3), not 4");
  assert.equal(zoneOf(engine, id("foe")), "discard", "mine still deals its full 5 (the foe has 5 life)");
});

clause(RED_TAPE, "0:ability", "a character debuffed to 0 strength deals no damage (the floor applies to the damage too)", () => {
  const { engine, id } = tapeBoard();
  declareAttackBy(engine, P1, [id("mine")]);
  declareBlock(engine, P2, [id("weak")]);
  playTape(engine, id, "weak");
  autoResolveBattle(engine);
  assert.equal(engine.state.cards[id("mine")].damage, 0, "0 strength: no damage");
});

clause(RED_TAPE, "0:ability", "only a character can be picked: an item, a location, a faction and a face-down resource are refused", () => {
  const { engine, id } = tapeBoard();
  assert.throws(() => playTape(engine, id, "gadget"), "item");
  assert.throws(() => playTape(engine, id, "place"), "location");
  assert.throws(() => play(engine, P1, id("rt"), { selected: { c: [engine.state.players[P2].factionId!] } }), "faction");
  assert.throws(() => playTape(engine, id, "hidden"), "face-down resource");
  assert.equal(zoneOf(engine, id("rt")), "hand", "nothing was played");
  assert.equal(readyCount(engine, P1), 2, "nothing was paid");
});

clause(RED_TAPE, "0:ability", "a character must be picked: playing it with no pick, or with two, is refused", () => {
  const { engine, id } = tapeBoard();
  assert.throws(() => playRaw(engine, P1, id("rt"), { selected: { c: [] } }));
  assert.throws(() => playRaw(engine, P1, id("rt"), { selected: { c: [id("foe"), id("weak")] } }));
  assert.equal(zoneOf(engine, id("rt")), "hand");
});

clause(RED_TAPE, "0:ability", "a character that is not in play (hand / discard) cannot be picked", () => {
  const { engine, id } = tapeBoard({
    extra: [
      { key: "inHand", def: character({ name: "InHand", strength: 5 }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard", strength: 5 }), owner: P2, zone: "discard" }
    ]
  });
  assert.throws(() => playTape(engine, id, "inHand"));
  assert.throws(() => playTape(engine, id, "inDiscard"));
});

clause(RED_TAPE, "0:ability", "is refused one resource short of its cost of 2, and without [G][G]", () => {
  const short = tapeBoard({ greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("rt"), { selected: { c: [short.id("foe")] } }));
  assert.equal(short.engine.getStat(short.id("foe"), "strength"), 4);
  const noThreshold = tapeBoard({ greed: 1, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("rt"), { selected: { c: [noThreshold.id("foe")] } }), "one [G] is short of [G][G]");
  const exact = tapeBoard({ greed: 2 });
  playTape(exact.engine, exact.id, "foe");
  assert.equal(exact.engine.getStat(exact.id("foe"), "strength"), 1, "[G][G] and 2 resources is enough");
});

// =============================================================================
// Secret Handshake
// COST: Pick a character. EFFECT: This turn, the character gains 4 life. Draw a
// card.
// Tactic, cost 2, threshold [G].
// =============================================================================

const HANDSHAKE = "cd52558c-f78d-417c-aed6-ec56df486e6a";

function handshakeBoard(opts: { greed?: number; rage?: number; deck?: number; extra?: CardPlacement[]; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    cards: [
      { key: "sh", def: printing(HANDSHAKE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", life: 9 }), owner: P2, zone: "play", faceDown: true },
      ...Array.from({ length: opts.deck ?? 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("greed", opts.greed ?? 2, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const playHandshake = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, targetKey: string) => play(engine, P1, id("sh"), { selected: { c: [id(targetKey)] } });

clause(HANDSHAKE, "0:ability", "the picked character of yours gains exactly 4 life (3 -> 7) and no other stat", () => {
  const { engine, id } = handshakeBoard();
  playHandshake(engine, id, "mine");
  assert.equal(engine.getStat(id("mine"), "life"), 7);
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
  assert.equal(engine.getStat(id("mine"), "speed"), 2);
});

clause(HANDSHAKE, "0:ability", "it may pick an opponent's character (5 -> 9)", () => {
  const { engine, id } = handshakeBoard();
  playHandshake(engine, id, "foe");
  assert.equal(engine.getStat(id("foe"), "life"), 9);
  assert.equal(engine.getStat(id("mine"), "life"), 3, "the unpicked character is unchanged");
});

clause(HANDSHAKE, "0:ability", "you draw a card (the top of YOUR deck), even when the picked character is the opponent's", () => {
  const { engine, id } = handshakeBoard();
  const top = engine.state.players[P1].deck[0];
  const oppDeck = [...engine.state.players[P2].deck];
  const handBefore = handOf(engine, P1).length;
  playHandshake(engine, id, "foe");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
});

clause(HANDSHAKE, "0:ability", "the draw also happens for your own character", () => {
  const { engine, id } = handshakeBoard();
  const top = engine.state.players[P1].deck[0];
  playHandshake(engine, id, "mine");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(engine.state.players[P1].deck.length, 2);
});

clause(HANDSHAKE, "0:ability", "with an empty deck the life is still gained", () => {
  const { engine, id } = handshakeBoard({ deck: 0 });
  playHandshake(engine, id, "mine");
  assert.equal(engine.getStat(id("mine"), "life"), 7);
  assert.equal(engine.state.result, undefined);
});

clause(HANDSHAKE, "0:ability", "pays exactly 2 and the tactic goes to its owner's discard pile", () => {
  const { engine, id } = handshakeBoard({ greed: 4 });
  const before = readyCount(engine, P1);
  playHandshake(engine, id, "mine");
  assert.equal(before - readyCount(engine, P1), 2);
  assert.equal(zoneOf(engine, id("sh")), "discard");
});

clause(HANDSHAKE, "0:ability", "'this turn': back to the printed life when the turn ends", () => {
  const { engine, id } = handshakeBoard();
  playHandshake(engine, id, "mine");
  assert.equal(engine.getStat(id("mine"), "life"), 7);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("mine"), "life"), 3);
});

clause(HANDSHAKE, "0:ability", "two Handshakes stack (+8)", () => {
  const { engine, id } = handshakeBoard({ greed: 4, extra: [{ key: "sh2", def: printing(HANDSHAKE), owner: P1, zone: "hand" }] });
  playHandshake(engine, id, "mine");
  play(engine, P1, id("sh2"), { selected: { c: [id("mine")] } });
  assert.equal(engine.getStat(id("mine"), "life"), 11);
});

clause(HANDSHAKE, "0:ability", "the life is real in battle: a 3-life character survives 5 damage with +4 life, and dies without (control)", () => {
  const run = (withHandshake: boolean) => {
    const { engine, id } = handshakeBoard();
    declareAttackBy(engine, P1, [id("mine")]);
    declareBlock(engine, P2, [id("foe")]);
    if (withHandshake) playHandshake(engine, id, "mine");
    autoResolveBattle(engine);
    return { engine, id };
  };
  const control = run(false);
  assert.equal(zoneOf(control.engine, control.id("mine")), "discard", "control: 5 damage kills a 3-life character");
  const protectedRun = run(true);
  assert.equal(zoneOf(protectedRun.engine, protectedRun.id("mine")), "play");
  assert.equal(protectedRun.engine.state.cards[protectedRun.id("mine")].damage, 5);
});

clause(HANDSHAKE, "0:ability", "gaining life does not heal damage already on the character", () => {
  const { engine, id } = handshakeBoard();
  engine.state.cards[id("mine")].damage = 2;
  playHandshake(engine, id, "mine");
  assert.equal(engine.state.cards[id("mine")].damage, 2);
  assert.equal(engine.getStat(id("mine"), "life"), 7);
});

clause(HANDSHAKE, "0:ability", "a character with damage 2 of life 3 would die to 1 more damage; with +4 life it survives 4 more", () => {
  const { engine, id } = handshakeBoard({ extra: [{ key: "smite", def: damageTactic(4), owner: P1, zone: "hand" }] });
  engine.state.cards[id("mine")].damage = 2;
  playHandshake(engine, id, "mine");
  play(engine, P1, id("smite"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "play", "damage 6 < life 7");
  assert.equal(engine.state.cards[id("mine")].damage, 6);
});

clause(HANDSHAKE, "0:ability", "only a character can be picked: an item, a location, a faction and a face-down resource are refused", () => {
  const { engine, id } = handshakeBoard();
  assert.throws(() => playHandshake(engine, id, "gadget"), "item");
  assert.throws(() => playHandshake(engine, id, "place"), "location");
  assert.throws(() => play(engine, P1, id("sh"), { selected: { c: [engine.state.players[P2].factionId!] } }), "faction");
  assert.throws(() => playHandshake(engine, id, "hidden"), "face-down resource");
  assert.equal(zoneOf(engine, id("sh")), "hand");
  assert.equal(readyCount(engine, P1), 2);
});

clause(HANDSHAKE, "0:ability", "exactly one character must be picked", () => {
  const { engine, id } = handshakeBoard();
  assert.throws(() => playRaw(engine, P1, id("sh"), { selected: { c: [] } }));
  assert.throws(() => playRaw(engine, P1, id("sh"), { selected: { c: [id("mine"), id("foe")] } }));
});

clause(HANDSHAKE, "0:ability", "is refused one resource short of its cost of 2, and without [G]", () => {
  const short = handshakeBoard({ greed: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sh"), { selected: { c: [short.id("mine")] } }));
  assert.equal(short.engine.getStat(short.id("mine"), "life"), 3);
  const noThreshold = handshakeBoard({ greed: 0, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sh"), { selected: { c: [noThreshold.id("mine")] } }), "no [G]");
  const exact = handshakeBoard({ greed: 1, rage: 1 });
  playHandshake(exact.engine, exact.id, "mine");
  assert.equal(exact.engine.getStat(exact.id("mine"), "life"), 7, "one [G] and 2 resources in total is enough");
});

// --- Mafia Lawyer x Red Tape: the opposing party's strength cannot be negative (CR 410.4)

clause(LAWYER, "1:rule", "a blocker pushed below 0 strength by an effect counts as 0, not as a negative number, in the opposing party's total", () => {
  const { engine, id } = warBoard(
    [
      { key: "law", def: printing(LAWYER), owner: P1, zone: "play" },
      { key: "rt", def: printing(RED_TAPE), owner: P1, zone: "hand" },
      ...bank("greed", 2, P1)
    ],
    [fighter("b1", P2, 1, 20), fighter("b2", P2, 4, 20)]
  );
  declareAttackBy(engine, P1, [id("law")]);
  declareBlock(engine, P2, [id("b1"), id("b2")]);
  play(engine, P1, id("rt"), { selected: { c: [id("b1")] } });
  resolveSending(engine, { [id("b1")]: id("law"), [id("b2")]: id("law") });
  assert.equal(zoneOf(engine, id("law")), "discard", "b2 (4 damage) killed the Lawyer");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 4, "b1 is at 0 strength and counts 0; b2 counts 4: X = 4");
});

// =============================================================================
// Samuel Gristwalter
// UNIQUE SAMUEL. No damage can be inflicted to your faction.
// Character, cost 4, threshold [G][G][G][G], 0 / 1 / 3.
// =============================================================================

const SAMUEL = "50923614-01ee-46c0-9296-8e937fc99c62";

/** A free tactic dealing `amount` damage to `who`'s faction (relative to its controller). */
const burnTactic = (amount: number, who: "controller" | "opponent"): CardDefinition =>
  tactic({
    name: `Burn${who}${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "burn", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: who }, amount }] }] }
  });

/** A free tactic making `who`'s faction LOSE `amount` influence (not damage). */
const drainTactic = (amount: number, who: "controller" | "opponent"): CardDefinition =>
  tactic({
    name: `Drain${who}${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "drain", type: "activated", effects: [{ type: "modifyInfluence", player: who, amount: -amount }] }] }
  });

function samuelBoard(opts: { samuel?: boolean; p2Strength?: number; extra?: CardPlacement[]; active?: Pid; samuelZone?: "play" | "hand" | "discard" } = {}) {
  const cards: CardPlacement[] = [
    { key: "atk", def: character({ name: "Attacker", strength: opts.p2Strength ?? 5, life: 9, speed: 2 }), owner: P2, zone: "play" },
    ...(opts.extra ?? [])
  ];
  if (opts.samuel !== false) cards.push({ key: "sam", def: printing(SAMUEL), owner: P1, zone: opts.samuelZone ?? "play" });
  return buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: 2, activePlayerId: opts.active ?? P2, cards });
}

const samuelHitsFaction = (engine: SpoilsEngine, id: (key: string) => CardInstanceId) => {
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, []);
};

clause(SAMUEL, "0:unique", "a second copy: its controller chooses which to keep (keep the new one: the old one is destroyed)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("sam2"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("sam"), id("sam2")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("sam2") } } as never);
  assert.equal(zoneOf(engine, id("sam2")), "play");
  assert.equal(zoneOf(engine, id("sam")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SAMUEL, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("sam2"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("sam") } } as never);
  assert.equal(zoneOf(engine, id("sam")), "play");
  assert.equal(zoneOf(engine, id("sam2")), "discard");
});

clause(SAMUEL, "0:unique", "the choice may not name a card that is not one of the copies", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("sam2"));
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("bystander") } } as never));
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.ok(engine.state.pendingChoice, "still waiting for a real answer");
});

clause(SAMUEL, "0:unique", "UNIQUE is per player: the opponent may control their own Samuel with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P2, zone: "hand" },
      ...bank("greed", 4, P2)
    ]
  });
  play(engine, P2, id("sam2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sam")), "play");
  assert.equal(zoneOf(engine, id("sam2")), "play");
});

clause(SAMUEL, "0:unique", "a second copy in hand (not in play) is no conflict", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sam")), "play");
  assert.equal(zoneOf(engine, id("sam2")), "hand");
});

clause(SAMUEL, "0:unique", "after the first copy is destroyed a new one can be played with no conflict", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "discard" },
      { key: "sam2", def: printing(SAMUEL), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("sam2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sam2")), "play");
});

for (const amount of [1, 2, 5, 9]) {
  clause(SAMUEL, "1:rule", `an unblocked ${amount}-strength attacker deals no damage to my faction: influence stays the same`, () => {
    const { engine, id } = samuelBoard({ p2Strength: amount });
    const before = influenceOf(engine, P1);
    samuelHitsFaction(engine, id);
    assert.equal(influenceOf(engine, P1), before);
    assert.equal(battleOf(engine), undefined, "the battle ran to the end");
    assert.equal(engine.state.result, undefined);
  });
}

clause(SAMUEL, "1:rule", "control: without Samuel the same attack costs the faction 5 influence", () => {
  const { engine, id } = samuelBoard({ samuel: false });
  samuelHitsFaction(engine, id);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 5);
});

clause(SAMUEL, "1:rule", "an attacking party of two (3 + 4 damage) inflicts nothing to my faction", () => {
  const { engine, id } = samuelBoard({ extra: [{ key: "atk2", def: character({ name: "Attacker2", strength: 4, life: 9, speed: 2 }), owner: P2, zone: "play" }] });
  engine.state.cards[id("atk")].depleted = false;
  fight(engine, P2, [id("atk"), id("atk2")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "damage from a card effect (not only battle damage) is also not inflicted to my faction", () => {
  const { engine, id } = samuelBoard({ extra: [{ key: "burn", def: burnTactic(4, "opponent"), owner: P2, zone: "hand" }] });
  play(engine, P2, id("burn"));
  assert.equal(zoneOf(engine, id("burn")), "discard", "the burn was played");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "control: the same effect damages the faction when Samuel is not in play", () => {
  const { engine, id } = samuelBoard({ samuel: false, extra: [{ key: "burn", def: burnTactic(4, "opponent"), owner: P2, zone: "hand" }] });
  play(engine, P2, id("burn"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 4);
});

clause(SAMUEL, "1:rule", "my own damage effect against my own faction is also prevented ('no damage can be inflicted to your faction')", () => {
  const { engine, id } = samuelBoard({ active: P1, extra: [{ key: "selfBurn", def: burnTactic(3, "controller"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("selfBurn"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "only DAMAGE is stopped: an effect making my faction LOSE influence still works (CR 408.3b)", () => {
  const { engine, id } = samuelBoard({ extra: [{ key: "drain", def: drainTactic(3, "opponent"), owner: P2, zone: "hand" }] });
  play(engine, P2, id("drain"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 3);
});

clause(SAMUEL, "1:rule", "only DAMAGE is stopped: Mafia Lawyer's 'your faction loses 2 influence' still costs the Samuel player 2", () => {
  const { engine, id } = samuelBoard({ active: P1, extra: [{ key: "law", def: printing(LAWYER), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)] });
  play(engine, P1, id("law"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 2);
});

clause(SAMUEL, "1:rule", "gaining influence is unaffected: Rate Hike still gives 2", () => {
  const { engine, id } = samuelBoard({ active: P1, extra: [{ key: "rh", def: printing(RATE_HIKE), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)] });
  play(engine, P1, id("rh"));
  assert.equal(influenceOf(engine, P1), START_INFLUENCE + 2);
});

clause(SAMUEL, "1:rule", "'your faction' only: the opponent's faction still takes damage from my attackers", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), START_INFLUENCE - 4);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "an opponent's Samuel protects THEIR faction only: mine still takes damage", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 4);
});

clause(SAMUEL, "1:rule", "'your' faction means the controller's: a Samuel owned by P1 but controlled by P2 protects P2's faction, not P1's", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, controller: P2, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 4, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 3, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P1, [id("a1")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), START_INFLUENCE, "P2 controls Samuel: protected");
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  fight(engine, P2, [id("a2")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 3, "P1 owns Samuel but does not control it: unprotected");
});

clause(SAMUEL, "1:rule", "it only protects while in play: Samuel in hand or in the discard pile does nothing", () => {
  for (const samuelZone of ["hand", "discard"] as const) {
    const { engine, id } = samuelBoard({ samuelZone });
    samuelHitsFaction(engine, id);
    assert.equal(influenceOf(engine, P1), START_INFLUENCE - 5, `Samuel in ${samuelZone}`);
  }
});

clause(SAMUEL, "1:rule", "once Samuel leaves play the faction can be damaged again", () => {
  const { engine, id } = samuelBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  play(engine, P2, id("kill"), { selected: { t: [id("sam")] } });
  assert.equal(zoneOf(engine, id("sam")), "discard");
  samuelHitsFaction(engine, id);
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 5);
});

clause(SAMUEL, "1:rule", "a faction at 1 influence survives any amount of damage while Samuel is in play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 1 },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 9, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  samuelHitsFaction(engine, id);
  assert.equal(influenceOf(engine, P1), 1);
  assert.equal(engine.state.result, undefined);
});

clause(SAMUEL, "1:rule", "only the FACTION is protected: Samuel himself and other characters take battle damage normally", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "friend", def: character({ name: "Friend", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker2", strength: 3, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, [id("sam")]);
  assert.equal(engine.state.cards[id("sam")].damage, 2, "Samuel took the 2 damage");
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  fight(engine, P2, [id("atk2")], { type: "faction", playerId: P1 }, [id("friend")]);
  assert.equal(engine.state.cards[id("friend")].damage, 3);
});

clause(SAMUEL, "1:rule", "only the FACTION is protected: an attacked location takes its damage", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sam", def: printing(SAMUEL), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 5 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P2, [id("atk")], { type: "card", cardId: id("place") }, []);
  assert.equal(engine.state.cards[id("place")].damage, 3, "the location is damaged");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE);
});

clause(SAMUEL, "1:rule", "the card itself: cost 4 with [G][G][G][G], printed 0 / 1 / 3", () => {
  const mk = (greed: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "sam", def: printing(SAMUEL), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const short = mk(3, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("sam")), "3 is one short of 4");
  const noThreshold = mk(3, 5);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sam")), "three Greed is one short of [G][G][G][G]");
  const ok = mk(4, 0);
  const before = readyCount(ok.engine, P1);
  play(ok.engine, P1, ok.id("sam"));
  assert.equal(before - readyCount(ok.engine, P1), 4);
  assert.equal(ok.engine.getStat(ok.id("sam"), "strength"), 0);
  assert.equal(ok.engine.getStat(ok.id("sam"), "speed"), 1);
  assert.equal(ok.engine.getStat(ok.id("sam"), "life"), 3);
});

// =============================================================================
// Selective Gluttony
// Draw 10 cards. Discard 9 cards.
// Tactic, cost 3, threshold [G][G][G].
// =============================================================================

const GLUTTONY = "be335787-ef92-496e-8cc6-4b83fa17ea85";

function gluttonyBoard(opts: { deck?: number; hand?: number; greed?: number; rage?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sg", def: printing(GLUTTONY), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.hand ?? 2 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const })),
      ...Array.from({ length: opts.deck ?? 12 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", opts.rage ?? 0, P1)
    ]
  });
}

const gluttonyChoice = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
const gluttonyDiscard = (engine: SpoilsEngine, ids: CardInstanceId[]) => () => {
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  resolvePendingResponses(engine);
};
const keysOf = (id: (key: string) => CardInstanceId, keys: string[]) => keys.map(id);
const range = (prefix: string, from: number, to: number) => Array.from({ length: to - from }, (_, i) => `${prefix}${from + i}`);

clause(GLUTTONY, "0:rule", "draws exactly 10 cards: the top 10 of your deck, before anything is discarded", () => {
  const { engine, id } = gluttonyBoard();
  const top10 = engine.state.players[P1].deck.slice(0, 10);
  play(engine, P1, id("sg"));
  assert.deepEqual(top10, keysOf(id, range("d", 0, 10)), "(setup check) the deck is in key order");
  for (const cardId of top10) assert.equal(zoneOf(engine, cardId), "hand", "drawn");
  assert.equal(handOf(engine, P1).length, 2 + 10, "the 2 cards already in hand plus 10 drawn: nothing is discarded yet");
  assert.equal(engine.state.players[P1].deck.length, 2, "the 2 cards below the top 10 remain");
  assert.equal(gluttonyChoice(engine)?.kind, "chooserSelectsTarget", "now the discard decision");
  assert.equal(gluttonyChoice(engine)?.playerId, P1, "the player who played the card decides what to discard");
});

clause(GLUTTONY, "0:rule", "then discards 9 cards of your choice: discarding 9 of the 10 drawn leaves the 2 old cards and 1 drawn card", () => {
  const { engine, id } = gluttonyBoard();
  play(engine, P1, id("sg"));
  gluttonyDiscard(engine, keysOf(id, range("d", 0, 9)))();
  assert.deepEqual([...handOf(engine, P1)].sort(), keysOf(id, ["h0", "h1", "d9"]).sort(), "hand: old cards + the one drawn card not discarded");
  for (const key of range("d", 0, 9)) assert.equal(zoneOf(engine, id(key)), "discard", `${key}`);
  assert.equal(discardOf(engine, P1).length, 9 + 1, "9 discarded cards and the tactic itself");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GLUTTONY, "0:rule", "the 9 can include cards that were already in your hand", () => {
  const { engine, id } = gluttonyBoard();
  play(engine, P1, id("sg"));
  gluttonyDiscard(engine, keysOf(id, ["h0", "h1", ...range("d", 0, 7)]))();
  assert.deepEqual([...handOf(engine, P1)].sort(), keysOf(id, ["d7", "d8", "d9"]).sort());
  assert.equal(zoneOf(engine, id("h0")), "discard");
  assert.equal(zoneOf(engine, id("h1")), "discard");
});

clause(GLUTTONY, "0:rule", "the player chooses which cards to keep: keeping an old card and the first drawn card", () => {
  const { engine, id } = gluttonyBoard();
  play(engine, P1, id("sg"));
  gluttonyDiscard(engine, keysOf(id, ["h1", ...range("d", 1, 9)]))();
  assert.deepEqual([...handOf(engine, P1)].sort(), keysOf(id, ["h0", "d0", "d9"]).sort());
});

clause(GLUTTONY, "0:rule", "exactly 9 must be discarded: 8, 10 and 0 are refused, as are duplicates", () => {
  const { engine, id } = gluttonyBoard();
  play(engine, P1, id("sg"));
  const pending = () => assert.ok(engine.state.pendingChoice, "still waiting for a legal discard");
  assert.throws(gluttonyDiscard(engine, keysOf(id, range("d", 0, 8))), "8 cards");
  pending();
  assert.throws(gluttonyDiscard(engine, keysOf(id, range("d", 0, 10))), "10 cards");
  pending();
  assert.throws(gluttonyDiscard(engine, []), "nothing");
  pending();
  assert.throws(gluttonyDiscard(engine, keysOf(id, ["d0", "d0", ...range("d", 1, 8)])), "the same card twice");
  pending();
  assert.equal(handOf(engine, P1).length, 12, "no card was discarded by any refused answer");
});

clause(GLUTTONY, "0:rule", "only cards in YOUR HAND can be discarded: the deck, the opponent's hand and the tactic itself are refused", () => {
  const { engine, id } = gluttonyBoard();
  play(engine, P1, id("sg"));
  const nine = keysOf(id, range("d", 0, 8));
  assert.throws(gluttonyDiscard(engine, [...nine, id("d10")]), "a card still in the deck");
  assert.throws(gluttonyDiscard(engine, [...nine, id("oh")]), "the opponent's hand");
  assert.throws(gluttonyDiscard(engine, [...nine, id("sg")]), "the tactic is not in your hand any more");
  assert.throws(gluttonyDiscard(engine, [...nine, id("e0")]), "the opponent's deck");
  assert.equal(zoneOf(engine, id("d10")), "deck");
  assert.equal(zoneOf(engine, id("oh")), "hand");
});

clause(GLUTTONY, "0:rule", "the opponent's hand, deck and discard pile are untouched", () => {
  const { engine, id } = gluttonyBoard();
  const oppDeck = [...engine.state.players[P2].deck];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("sg"));
  gluttonyDiscard(engine, keysOf(id, range("d", 0, 9)))();
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(GLUTTONY, "0:rule", "discarded cards go to THEIR OWNER's discard pile, and the tactic ends up there too", () => {
  const { engine, id } = gluttonyBoard();
  play(engine, P1, id("sg"));
  gluttonyDiscard(engine, keysOf(id, range("d", 0, 9)))();
  assert.ok(discardOf(engine, P1).includes(id("sg")), "discardOf(engine, P1).includes(id(\"sg\"))");
  assert.ok(discardOf(engine, P1).includes(id("d0")), "discardOf(engine, P1).includes(id(\"d0\"))");
});

clause(GLUTTONY, "0:rule", "a deck of exactly 10 is drawn completely, then 9 discarded", () => {
  const { engine, id } = gluttonyBoard({ deck: 10 });
  play(engine, P1, id("sg"));
  assert.equal(engine.state.players[P1].deck.length, 0);
  assert.equal(handOf(engine, P1).length, 12);
  gluttonyDiscard(engine, keysOf(id, range("d", 1, 10)))();
  assert.deepEqual([...handOf(engine, P1)].sort(), keysOf(id, ["h0", "h1", "d0"]).sort());
});

clause(GLUTTONY, "0:rule", "with fewer than 10 cards in the deck you draw as many as you can (CR 402.5): deck of 4 and hand of 2 gives 6 cards", () => {
  const { engine, id } = gluttonyBoard({ deck: 4 });
  play(engine, P1, id("sg"));
  assert.equal(engine.state.players[P1].deck.length, 0, "the whole deck was drawn");
  assert.equal(handOf(engine, P1).length, 6, "drawn 4 on top of the 2 in hand");
  assert.equal(gluttonyChoice(engine)?.kind, "chooserSelectsTarget", "then the discard decision");
  assert.equal(engine.state.result, undefined, "running out of cards does not lose the game");
});

clause(GLUTTONY, "0:rule", "discarding 9 when you hold fewer than 9 cards: you discard as many as you can, i.e. your whole hand (CR 402.5)", () => {
  const { engine, id } = gluttonyBoard({ deck: 4 });
  play(engine, P1, id("sg"));
  assert.ok(gluttonyChoice(engine), "a discard decision is open");
  assert.throws(gluttonyDiscard(engine, [...handOf(engine, P1)].slice(0, 5)), "5 of the 6 is not 'as many as you can'");
  gluttonyDiscard(engine, [...handOf(engine, P1)])();
  assert.equal(handOf(engine, P1).length, 0, "all 6 cards were discarded");
  assert.equal(discardOf(engine, P1).length, 6 + 1);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GLUTTONY, "0:rule", "with an empty deck and an empty hand it still resolves: nothing to draw, nothing to discard", () => {
  const { engine, id } = gluttonyBoard({ deck: 0, hand: 0 });
  play(engine, P1, id("sg"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("sg")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.result, undefined);
});

clause(GLUTTONY, "0:rule", "pays exactly 3 resources", () => {
  const { engine, id } = gluttonyBoard({ greed: 6 });
  const before = readyCount(engine, P1);
  play(engine, P1, id("sg"));
  assert.equal(before - readyCount(engine, P1), 3);
});

clause(GLUTTONY, "0:rule", "is refused with only 2 resources, and without [G][G][G] even with plenty of other resources", () => {
  const short = gluttonyBoard({ greed: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("sg")));
  assert.equal(short.engine.state.players[P1].deck.length, 12, "nothing was drawn");
  const noThreshold = gluttonyBoard({ greed: 2, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("sg")), "two Greed is one short of [G][G][G]");
  const exact = gluttonyBoard({ greed: 3 });
  play(exact.engine, P1, exact.id("sg"));
  assert.equal(handOf(exact.engine, P1).length, 12, "three Greed is enough");
});

// =============================================================================
// The Ministry of Other Smaller Ministries
// Your opponent must pay 2 for each attacking party they form.
// Location, cost 3, threshold [G][G], structure 5.
// =============================================================================

const MINISTRY = "5ae38ba3-9369-4d01-9ee3-3359406a007f";

function ministryBoard(opts: { ministries?: Array<"p1" | "p2">; ready?: number; spent?: number; active?: Pid; attackers?: number } = {}) {
  const attacker: Pid = opts.active ?? P2;
  const defender = other(attacker);
  const ministries = opts.ministries ?? [defender === P1 ? "p1" : "p2"];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      ...ministries.map((side, i) => ({ key: `min${i}`, def: printing(MINISTRY), owner: side === "p1" ? P1 : P2, zone: "play" as const })),
      ...Array.from({ length: opts.attackers ?? 3 }, (_, i) => fighter(`a${i}`, attacker, 1, 9)),
      fighter("blk", defender, 1, 9),
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: defender, zone: "play" },
      ...bank("greed", opts.ready ?? 4, attacker),
      ...spentResources(attacker, opts.spent ?? 0)
    ]
  });
}

const attackWith = (engine: SpoilsEngine, player: Pid, ids: CardInstanceId[], target?: { type: "faction"; playerId: Pid } | { type: "card"; cardId: CardInstanceId }) =>
  engine.perform({ type: "declareAttack", playerId: player, attackerIds: ids, target: target ?? { type: "faction", playerId: other(player) } });

clause(MINISTRY, "0:rule", "the opponent pays exactly 2 resources to form an attacking party; the attack then goes ahead", () => {
  const { engine, id } = ministryBoard({ ready: 5 });
  attackWith(engine, P2, [id("a0")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("a0")], "the attack was declared");
  assert.equal(attachedCount(engine, P2), 2, "2 resources were paid");
  assert.equal(readyCount(engine, P2), 3);
  assert.equal(engine.state.cards[id("a0")].depleted, true);
});

clause(MINISTRY, "0:rule", "with exactly 2 resources the attack is possible and uses them all", () => {
  const { engine, id } = ministryBoard({ ready: 2 });
  attackWith(engine, P2, [id("a0")]);
  assert.ok(battleOf(engine), "battleOf(engine)");
  assert.equal(readyCount(engine, P2), 0);
});

clause(MINISTRY, "0:rule", "with only 1 ready resource the attack is illegal: no battle, nothing depleted, nothing paid", () => {
  const { engine, id } = ministryBoard({ ready: 1 });
  assert.throws(() => attackWith(engine, P2, [id("a0")]));
  assert.equal(battleOf(engine), undefined);
  assert.equal(engine.state.cards[id("a0")].depleted, false);
  assert.equal(readyCount(engine, P2), 1);
});

clause(MINISTRY, "0:rule", "with no resources at all the opponent cannot attack", () => {
  const { engine, id } = ministryBoard({ ready: 0 });
  assert.throws(() => attackWith(engine, P2, [id("a0")]));
  assert.equal(battleOf(engine), undefined);
});

clause(MINISTRY, "0:rule", "resources already spent (attached) cannot pay the 2: 3 resources of which 2 are spent is 1 short", () => {
  const { engine, id } = ministryBoard({ ready: 1, spent: 2 });
  assert.equal(readyCount(engine, P2), 1);
  assert.throws(() => attackWith(engine, P2, [id("a0")]));
  assert.equal(battleOf(engine), undefined);
});

clause(MINISTRY, "0:rule", "the price is per party, not per character: a party of three attackers pays 2 in total", () => {
  const { engine, id } = ministryBoard({ ready: 5 });
  attackWith(engine, P2, [id("a0"), id("a1"), id("a2")]);
  assert.equal(attachedCount(engine, P2), 2);
  assert.equal(readyCount(engine, P2), 3);
});

clause(MINISTRY, "0:rule", "a party of three still needs the 2: with 1 resource it is refused", () => {
  const { engine, id } = ministryBoard({ ready: 1 });
  assert.throws(() => attackWith(engine, P2, [id("a0"), id("a1"), id("a2")]));
  assert.equal(engine.state.cards[id("a1")].depleted, false);
});

clause(MINISTRY, "0:rule", "each attacking party formed costs 2: a second attack in the same turn pays 2 again", () => {
  const { engine, id } = ministryBoard({ ready: 5 });
  fight(engine, P2, [id("a0")], { type: "faction", playerId: P1 }, []);
  assert.equal(attachedCount(engine, P2), 2);
  attackWith(engine, P2, [id("a1")]);
  assert.equal(attachedCount(engine, P2), 4, "the second party paid another 2");
  assert.equal(readyCount(engine, P2), 1);
});

clause(MINISTRY, "0:rule", "the second party cannot be formed without another 2: with 3 resources the second attack is refused", () => {
  const { engine, id } = ministryBoard({ ready: 3 });
  fight(engine, P2, [id("a0")], { type: "faction", playerId: P1 }, []);
  assert.equal(readyCount(engine, P2), 1);
  assert.throws(() => attackWith(engine, P2, [id("a1")]));
  assert.equal(battleOf(engine), undefined);
  assert.equal(engine.state.cards[id("a1")].depleted, false);
});

clause(MINISTRY, "0:rule", "attacking a LOCATION is forming an attacking party too: it costs 2", () => {
  const { engine, id } = ministryBoard({ ready: 3 });
  attackWith(engine, P2, [id("a0")], { type: "card", cardId: id("place") });
  assert.equal(attachedCount(engine, P2), 2);
  const poor = ministryBoard({ ready: 1 });
  assert.throws(() => attackWith(poor.engine, P2, [poor.id("a0")], { type: "card", cardId: poor.id("place") }));
});

clause(MINISTRY, "0:rule", "the Ministry's controller attacks for free", () => {
  const { engine, id } = ministryBoard({ ministries: ["p1"], active: P1, ready: 0 });
  attackWith(engine, P1, [id("a0")]);
  assert.ok(battleOf(engine), "no resources needed");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(MINISTRY, "0:rule", "blocking costs nothing: the taxed player defends for free", () => {
  const { engine, id } = ministryBoard({ ministries: ["p1"], active: P1, ready: 4 });
  const defenderReady = readyCount(engine, P2);
  attackWith(engine, P1, [id("a0")]);
  resolvePendingResponses(engine);
  declareBlock(engine, P2, [id("blk")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("blk")]);
  assert.equal(readyCount(engine, P2), defenderReady);
});

clause(MINISTRY, "0:rule", "it taxes the OPPONENT of its controller: a Ministry controlled by the attacker taxes the other player, not the attacker", () => {
  const { engine, id } = ministryBoard({ ministries: ["p2"], active: P2, ready: 0 });
  attackWith(engine, P2, [id("a0")]);
  assert.ok(battleOf(engine), "P2's own Ministry does not tax P2");
});

clause(MINISTRY, "0:rule", "and symmetrically P1 pays when P2 controls the Ministry", () => {
  const { engine, id } = ministryBoard({ ministries: ["p2"], active: P1, ready: 5 });
  attackWith(engine, P1, [id("a0")]);
  assert.equal(attachedCount(engine, P1), 2);
  const poor = ministryBoard({ ministries: ["p2"], active: P1, ready: 1 });
  assert.throws(() => attackWith(poor.engine, P1, [poor.id("a0")]));
});

clause(MINISTRY, "0:rule", "without the Ministry in play an attack is free", () => {
  const { engine, id } = ministryBoard({ ministries: [], ready: 0 });
  attackWith(engine, P2, [id("a0")]);
  assert.ok(battleOf(engine), "battleOf(engine)");
  assert.equal(attachedCount(engine, P2), 0);
});

clause(MINISTRY, "0:rule", "it only taxes while in play: once the Ministry is destroyed attacks are free again", () => {
  const raze = tactic({
    name: "Raze",
    cost: 0,
    behavior: { abilities: [{ id: "raze", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "min", def: printing(MINISTRY), owner: P1, zone: "play" },
      fighter("a0", P2, 1, 9),
      { key: "raze", def: raze, owner: P2, zone: "hand" }
    ]
  });
  assert.throws(() => attackWith(engine, P2, [id("a0")]), "control: taxed while it is in play (no resources)");
  play(engine, P2, id("raze"), { selected: { t: [id("min")] } });
  assert.equal(zoneOf(engine, id("min")), "discard");
  attackWith(engine, P2, [id("a0")]);
  assert.ok(battleOf(engine), "free now");
  assert.equal(attachedCount(engine, P2), 0);
});

clause(MINISTRY, "0:rule", "damaged but still standing (structure 5, 4 damage) the Ministry keeps taxing", () => {
  const { engine, id } = ministryBoard({ ready: 0 });
  engine.state.cards[id("min0")].damage = 4;
  assert.throws(() => attackWith(engine, P2, [id("a0")]));
});

clause(MINISTRY, "0:rule", "two Ministries each ask for 2: an attacking party costs 4", () => {
  const { engine, id } = ministryBoard({ ministries: ["p1", "p1"], ready: 5 });
  attackWith(engine, P2, [id("a0")]);
  assert.equal(attachedCount(engine, P2), 4);
  const short = ministryBoard({ ministries: ["p1", "p1"], ready: 3 });
  assert.throws(() => attackWith(short.engine, P2, [short.id("a0")]), "3 resources cannot pay 4");
});

clause(MINISTRY, "0:rule", "the paid resources really are used up: after the tax nothing is left to pay for anything else this turn", () => {
  const { engine, id } = ministryBoard({ ready: 2 });
  attackWith(engine, P2, [id("a0")]);
  assert.equal(readyCount(engine, P2), 0, "nothing left for anything else");
  assert.equal(attachedCount(engine, P2), 2);
});

clause(MINISTRY, "0:rule", "the card itself: cost 3 with [G][G], structure 5", () => {
  const mk = (greed: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "min", def: printing(MINISTRY), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]
    });
  const short = mk(2, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("min")), "2 is one short of 3");
  const noThreshold = mk(1, 5);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("min")), "one Greed is short of [G][G]");
  const ok = mk(2, 1);
  const before = readyCount(ok.engine, P1);
  play(ok.engine, P1, ok.id("min"));
  assert.equal(before - readyCount(ok.engine, P1), 3);
  assert.equal(zoneOf(ok.engine, ok.id("min")), "play");
  assert.equal(ok.engine.getStat(ok.id("min"), "structure"), 5);
});

// =============================================================================
// Vanilla characters: Union Leader, Gigamajig, Legacy Warmachine
// No rules text: they play for their printed cost and threshold with their
// printed stats, and nothing else about them is special.
// =============================================================================

type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";
interface Vanilla {
  id: string;
  cost: number;
  icon: Icon;
  /** How many of `icon` the printed threshold asks for. */
  count: number;
  strength: number;
  speed: number;
  life: number;
}
const otherIcon = (icon: Icon): Icon => (icon === "rage" ? "greed" : "rage");

function vanillaBoard(v: Vanilla, resources: CardPlacement[], opts: { turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "card", def: printing(v.id), owner: P1, zone: "hand" },
      { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 20, speed: 1 }), owner: P2, zone: "play" },
      ...resources
    ]
  });
}

function vanillaDeploysForCost(v: Vanilla) {
  const printed = printing(v.id);
  assert.equal(printed.cost, v.cost, "(setup check) the printed cost");
  const { engine, id } = vanillaBoard(v, bank(v.icon, v.cost + 2, P1));
  const before = readyCount(engine, P1);
  const handBefore = [...handOf(engine, P1)];
  const inf = [influenceOf(engine, P1), influenceOf(engine, P2)];
  play(engine, P1, id("card"));
  assert.equal(zoneOf(engine, id("card")), "play");
  assert.equal(engine.state.cards[id("card")].controllerId, P1);
  assert.equal(before - readyCount(engine, P1), v.cost, `exactly the printed cost of ${v.cost} is paid`);
  assert.equal(engine.state.cards[id("card")].depleted, false);
  assert.equal(engine.state.pendingChoice, undefined, "nothing is asked");
  assert.deepEqual(handOf(engine, P1), handBefore.filter((c) => c !== id("card")), "the rest of the hand is untouched");
  assert.deepEqual([influenceOf(engine, P1), influenceOf(engine, P2)], inf, "no influence changes");
}

function vanillaStats(v: Vanilla) {
  const { engine, id } = vanillaBoard(v, bank(v.icon, v.cost, P1));
  play(engine, P1, id("card"));
  assert.equal(engine.getStat(id("card"), "strength"), v.strength, "strength");
  assert.equal(engine.getStat(id("card"), "speed"), v.speed, "speed");
  assert.equal(engine.getStat(id("card"), "life"), v.life, "life");
  assert.deepEqual(engine.getKeywords(id("card")), [], "no keywords");
  assert.deepEqual(engine.getAvailableActivatedAbilities(P1).filter((entry) => entry.cardId === id("card")), [], "no abilities");
}

function vanillaRefusedShort(v: Vanilla) {
  const oneShort = vanillaBoard(v, bank(v.icon, v.cost - 1, P1));
  assert.throws(() => playRaw(oneShort.engine, P1, oneShort.id("card")), "one resource short of the cost");
  assert.equal(zoneOf(oneShort.engine, oneShort.id("card")), "hand");
  assert.equal(readyCount(oneShort.engine, P1), v.cost - 1, "nothing was paid");
  const none = vanillaBoard(v, []);
  assert.throws(() => playRaw(none.engine, P1, none.id("card")), "no resources");
}

function vanillaRefusedWithoutThreshold(v: Vanilla) {
  const wrongIcons = vanillaBoard(v, [...bank(v.icon, v.count - 1, P1), ...bank(otherIcon(v.icon), v.cost + 3, P1)]);
  assert.throws(() => playRaw(wrongIcons.engine, P1, wrongIcons.id("card")), `one ${v.icon} short of the threshold, with plenty of other resources`);
  assert.equal(zoneOf(wrongIcons.engine, wrongIcons.id("card")), "hand");
  const faceDown = vanillaBoard(v, [...bank(v.icon, v.count - 1, P1), ...volition(v.cost + 3, P1)]);
  assert.throws(() => playRaw(faceDown.engine, P1, faceDown.id("card")), "face-down resources provide Volition, not the icon");
  const none = vanillaBoard(v, bank(otherIcon(v.icon), v.cost, P1));
  assert.throws(() => playRaw(none.engine, P1, none.id("card")), "none of the required icon at all");
}

function vanillaThresholdMetByMix(v: Vanilla) {
  const { engine, id } = vanillaBoard(v, [...bank(v.icon, v.count, P1), ...bank(otherIcon(v.icon), v.cost - v.count, P1)]);
  const before = readyCount(engine, P1);
  play(engine, P1, id("card"));
  assert.equal(zoneOf(engine, id("card")), "play", "the threshold needs only the icons, the cost can be paid with anything");
  assert.equal(before - readyCount(engine, P1), v.cost);
}

function vanillaNoPhantomKeywords(v: Vanilla) {
  // not AGGRO: cannot attack the turn it enters play
  const entered = vanillaBoard(v, bank(v.icon, v.cost, P1));
  play(entered.engine, P1, entered.id("card"));
  assert.throws(() => declareAttackBy(entered.engine, P1, [entered.id("card")]), "no AGGRO: it cannot attack the turn it enters play");
  // not TACTICAL: cannot be deployed on the opponent's turn
  const theirTurn = vanillaBoard(v, bank(v.icon, v.cost, P1), { active: P2 });
  assert.throws(() => playRaw(theirTurn.engine, P1, theirTurn.id("card")), "no TACTICAL: only on your own turn");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("card")), "hand");
  // not COVERT: an ordinary character can block it
  const settled = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "card", def: printing(v.id), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 20, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(settled.engine, P1, [settled.id("card")]);
  declareBlock(settled.engine, P2, [settled.id("plain")]);
  assert.deepEqual(battleOf(settled.engine)?.blockingParty, [settled.id("plain")], "no COVERT");
}

function vanillaBattleStrength(v: Vanilla) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "card", def: printing(v.id), owner: P1, zone: "play" }]
  });
  fight(engine, P1, [id("card")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), START_INFLUENCE - v.strength, "an unblocked attack deals exactly its printed strength");
  assert.equal(engine.state.cards[id("card")].depleted, true);
}

// --- Union Leader (7, [G][G], 5 / 3 / 8)

const UNION_LEADER = "9c8eb327-cfe2-4fda-8498-4a309301c51f";
const UL: Vanilla = { id: UNION_LEADER, cost: 7, icon: "greed", count: 2, strength: 5, speed: 3, life: 8 };

clause(UNION_LEADER, "vanilla", "plays for exactly its printed cost of 7 and nothing else happens", () => vanillaDeploysForCost(UL));
clause(UNION_LEADER, "vanilla", "has its printed 5 / 3 / 8 in play, no keywords and no abilities", () => vanillaStats(UL));
clause(UNION_LEADER, "vanilla", "is refused one resource short of 7, and with no resources", () => vanillaRefusedShort(UL));
clause(UNION_LEADER, "vanilla", "is refused without [G][G] even with plenty of other resources or face-down ones", () => vanillaRefusedWithoutThreshold(UL));
clause(UNION_LEADER, "vanilla", "[G][G] plus 5 other resources is enough (the threshold is a gate, the cost is paid with anything)", () => vanillaThresholdMetByMix(UL));
clause(UNION_LEADER, "vanilla", "has no AGGRO / TACTICAL / COVERT it does not print", () => vanillaNoPhantomKeywords(UL));
clause(UNION_LEADER, "vanilla", "deals its printed 5 strength to the faction when unblocked", () => vanillaBattleStrength(UL));

// --- Gigamajig (6, [E]x6, 10 / 2 / 10)

const GIGAMAJIG = "a0e85730-e5d0-4310-a064-0e795a9ac0de";
const GM: Vanilla = { id: GIGAMAJIG, cost: 6, icon: "elitism", count: 6, strength: 10, speed: 2, life: 10 };

clause(GIGAMAJIG, "vanilla", "plays for exactly its printed cost of 6 and nothing else happens", () => vanillaDeploysForCost(GM));
clause(GIGAMAJIG, "vanilla", "has its printed 10 / 2 / 10 in play, no keywords and no abilities", () => vanillaStats(GM));
clause(GIGAMAJIG, "vanilla", "is refused one resource short of 6, and with no resources", () => vanillaRefusedShort(GM));
clause(GIGAMAJIG, "vanilla", "is refused with only five [E] even with plenty of other resources or face-down ones", () => vanillaRefusedWithoutThreshold(GM));
clause(GIGAMAJIG, "vanilla", "six [E] is enough (cost 6 is paid by the same six)", () => vanillaThresholdMetByMix(GM));
clause(GIGAMAJIG, "vanilla", "has no AGGRO / TACTICAL / COVERT it does not print", () => vanillaNoPhantomKeywords(GM));
clause(GIGAMAJIG, "vanilla", "deals its printed 10 strength to the faction when unblocked", () => vanillaBattleStrength(GM));

// --- Legacy Warmachine (5, [E], 4 / 1 / 5)

const WARMACHINE = "1d158d19-01fc-489d-b89e-ac9adcbab6e4";
const WM: Vanilla = { id: WARMACHINE, cost: 5, icon: "elitism", count: 1, strength: 4, speed: 1, life: 5 };

clause(WARMACHINE, "vanilla", "plays for exactly its printed cost of 5 and nothing else happens", () => vanillaDeploysForCost(WM));
clause(WARMACHINE, "vanilla", "has its printed 4 / 1 / 5 in play, no keywords and no abilities", () => vanillaStats(WM));
clause(WARMACHINE, "vanilla", "is refused one resource short of 5, and with no resources", () => vanillaRefusedShort(WM));
clause(WARMACHINE, "vanilla", "is refused without [E] even with plenty of other resources or face-down ones", () => vanillaRefusedWithoutThreshold(WM));
clause(WARMACHINE, "vanilla", "one [E] plus 4 other resources is enough", () => vanillaThresholdMetByMix(WM));
clause(WARMACHINE, "vanilla", "has no AGGRO / TACTICAL / COVERT it does not print", () => vanillaNoPhantomKeywords(WM));
clause(WARMACHINE, "vanilla", "deals its printed 4 strength to the faction when unblocked", () => vanillaBattleStrength(WM));

// =============================================================================
// Resurrection Emporium
// If a character would be put into your discard pile from anywhere, remove it
// from the game instead.
// RESURRECT -- COST: Use this only during your turn. Pick a character in your
// discard pile. Pay 3+X, where X is that character's numeric cost.
// EFFECT: Put the character into play under your control.
// Location, cost 0, threshold [G][G][G], structure 3.
// =============================================================================

const EMPORIUM = "e1dfe8ff-f8aa-4b7d-83d6-4f4f7cf52502";

const removedOf = (engine: SpoilsEngine, player: Pid): CardInstanceId[] => (engine.state.players[player] as unknown as { removed?: CardInstanceId[] }).removed ?? [];

function emporiumBoard(opts: { emporiumOwner?: Pid; extra?: CardPlacement[]; active?: Pid } = {}) {
  const emp = opts.emporiumOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      ...(emp === P1 ? [{ key: "emp", def: printing(EMPORIUM), owner: P1, zone: "play" as const }] : [{ key: "emp", def: printing(EMPORIUM), owner: P2, zone: "play" as const }]),
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", life: 3 }), owner: P2, zone: "play" },
      { key: "k1", def: killTactic(), owner: P1, zone: "hand" },
      { key: "k2", def: killTactic(), owner: P2, zone: "hand" },
      ...bank("greed", 12, P1),
      ...bank("greed", 12, P2),
      ...(opts.extra ?? [])
    ]
  });
}

// --- 0:rule  characters that would go to your discard pile are removed from the game instead

clause(EMPORIUM, "0:rule", "your character destroyed in play is removed from the game, not put into your discard pile", () => {
  const { engine, id } = emporiumBoard();
  play(engine, P1, id("k1"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "removed");
  assert.equal(discardOf(engine, P1).includes(id("mine")), false, "not in the discard pile");
  assert.ok(removedOf(engine, P1).includes(id("mine")), "out of the game");
});

clause(EMPORIUM, "0:rule", "the tactic that destroyed it still goes to the discard pile (only CHARACTERS are replaced)", () => {
  const { engine, id } = emporiumBoard();
  play(engine, P1, id("k1"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("k1")), "discard");
});

clause(EMPORIUM, "0:rule", "a character that dies in battle is removed from the game", () => {
  const { engine, id } = warBoard(
    [{ key: "emp", def: printing(EMPORIUM), owner: P1, zone: "play" }, fighter("mine", P1, 1, 2)],
    [fighter("blk", P2, 5, 20)]
  );
  fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(zoneOf(engine, id("mine")), "removed");
  assert.equal(discardOf(engine, P1).length, 0);
});

clause(EMPORIUM, "0:rule", "'from anywhere': a character discarded from your HAND is removed from the game", () => {
  const { engine, id } = emporiumBoard({
    extra: [
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "dump", def: discardFromHandTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("dump"), { selected: { t: [id("handChar")] } });
  assert.equal(zoneOf(engine, id("handChar")), "removed", "discarded from hand: replaced too");
  assert.equal(discardOf(engine, P1).includes(id("handChar")), false);
});

clause(EMPORIUM, "0:rule", "'from anywhere': a character milled from your DECK is removed from the game", () => {
  const mill = tactic({
    name: "Mill",
    cost: 0,
    behavior: { abilities: [{ id: "m", type: "activated", effects: [{ type: "moveCard", target: { type: "deckPosition", player: "controller", from: "top" }, to: "discard" }] }] }
  });
  const { engine, id } = emporiumBoard({
    extra: [
      { key: "deckChar", def: character({ name: "DeckChar" }), owner: P1, zone: "deck" },
      { key: "mill", def: mill, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("mill"));
  assert.equal(zoneOf(engine, id("deckChar")), "removed", "milled from the deck: replaced too");
  assert.equal(discardOf(engine, P1).includes(id("deckChar")), false);
});

clause(EMPORIUM, "0:rule", "only characters: a destroyed item goes to the discard pile as usual", () => {
  const { engine, id } = emporiumBoard({
    extra: [
      { key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
      { key: "zap", def: tactic({ name: "Zap", cost: 0, behavior: { abilities: [{ id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zap"), { selected: { t: [id("gadget")] } });
  assert.equal(zoneOf(engine, id("gadget")), "discard");
});

clause(EMPORIUM, "0:rule", "only characters: a character-less tactic going to the discard pile is untouched", () => {
  const { engine, id } = emporiumBoard({ extra: [{ key: "rh", def: printing(RATE_HIKE), owner: P1, zone: "hand" }] });
  play(engine, P1, id("rh"));
  assert.equal(zoneOf(engine, id("rh")), "discard");
});

clause(EMPORIUM, "0:rule", "'your discard pile': the opponent's character that dies goes to THEIR discard pile as usual", () => {
  const { engine, id } = emporiumBoard();
  play(engine, P1, id("k1"), { selected: { t: [id("theirs")] } });
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("theirs")), "discardOf(engine, P2).includes(id(\"theirs\"))");
});

clause(EMPORIUM, "0:rule", "an Emporium controlled by the opponent removes THEIR characters, and leaves mine to go to my discard pile", () => {
  const { engine, id } = emporiumBoard({ emporiumOwner: P2 });
  play(engine, P1, id("k1"), { selected: { t: [id("theirs")] } });
  assert.equal(zoneOf(engine, id("theirs")), "removed", "their Emporium, their discard pile");
  const second = emporiumBoard({ emporiumOwner: P2 });
  play(second.engine, P1, second.id("k1"), { selected: { t: [second.id("mine")] } });
  assert.equal(zoneOf(second.engine, second.id("mine")), "discard", "my character is not going to THEIR discard pile");
});

clause(EMPORIUM, "0:rule", "it goes to the discard pile of the card's OWNER: my character that the opponent controls, when it dies, is removed (it was headed for MY discard pile)", () => {
  const { engine, id } = emporiumBoard({
    extra: [{ key: "stolen", def: character({ name: "Stolen", life: 3 }), owner: P1, controller: P2, zone: "play" }]
  });
  play(engine, P1, id("k1"), { selected: { t: [id("stolen")] } });
  assert.equal(zoneOf(engine, id("stolen")), "removed");
  assert.equal(discardOf(engine, P1).includes(id("stolen")), false);
});

clause(EMPORIUM, "0:rule", "the opponent's character that I control, when it dies, goes to ITS owner's discard pile, not mine: it is not removed", () => {
  const { engine, id } = emporiumBoard({
    extra: [{ key: "lent", def: character({ name: "Lent", life: 3 }), owner: P2, controller: P1, zone: "play" }]
  });
  play(engine, P1, id("k1"), { selected: { t: [id("lent")] } });
  assert.equal(zoneOf(engine, id("lent")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("lent")), "discardOf(engine, P2).includes(id(\"lent\"))");
});

clause(EMPORIUM, "0:rule", "a face-down card is a resource, not a character: when destroyed it goes to the discard pile as usual", () => {
  const razeResources = tactic({
    name: "RazeRes",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", owner: "self", faceDown: true }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });
  const { engine, id } = emporiumBoard({
    extra: [
      { key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "raze", def: razeResources, owner: P1, zone: "hand" }
    ]
  });
  assert.equal(engine.getCardTypes(id("fd")).includes("character"), false, "(setup check) a face-down card is only a resource");
  play(engine, P1, id("raze"));
  assert.equal(zoneOf(engine, id("fd")), "discard", "a destroyed face-down resource goes to the discard pile, not out of the game");
});

clause(EMPORIUM, "0:rule", "once the Emporium is gone, characters go to the discard pile again", () => {
  const raze = tactic({
    name: "Raze",
    cost: 0,
    behavior: { abilities: [{ id: "raze", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = emporiumBoard({ extra: [{ key: "raze", def: raze, owner: P1, zone: "hand" }] });
  play(engine, P1, id("raze"), { selected: { t: [id("emp")] } });
  assert.equal(zoneOf(engine, id("emp")), "discard", "the Emporium itself is a location: it goes to the discard pile");
  play(engine, P1, id("k1"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
});

clause(EMPORIUM, "0:rule", "two Emporiums do not remove a character twice: it is simply removed from the game", () => {
  const { engine, id } = emporiumBoard({ extra: [{ key: "emp2", def: printing(EMPORIUM), owner: P1, zone: "play" }] });
  play(engine, P1, id("k1"), { selected: { t: [id("mine")] } });
  drain(engine, (pc) => (pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("mine")), "removed");
});

clause(EMPORIUM, "0:rule", "a removed character cannot trigger 'put into your discard pile' effects: Recapitulating Apparition is not offered its return", () => {
  const { engine, id } = emporiumBoard({ extra: [{ key: "ra", def: printing(APPARITION), owner: P1, zone: "play" }] });
  play(engine, P1, id("k1"), { selected: { t: [id("ra")] } });
  assert.equal(zoneOf(engine, id("ra")), "removed");
  assert.equal(engine.state.pendingChoice, undefined, "it never reached the discard pile: no 'may pay 1'");
});

clause(EMPORIUM, "0:rule", "the card itself: cost 0 with [G][G][G], structure 3", () => {
  const mk = (greed: number) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "emp", def: printing(EMPORIUM), owner: P1, zone: "hand" }, ...bank("greed", greed, P1)] });
  const two = mk(2);
  assert.throws(() => playRaw(two.engine, P1, two.id("emp")), "[G][G] is short of [G][G][G]");
  const three = mk(3);
  play(three.engine, P1, three.id("emp"));
  assert.equal(zoneOf(three.engine, three.id("emp")), "play");
  assert.equal(readyCount(three.engine, P1), 3, "cost 0: nothing is paid");
  assert.equal(three.engine.getStat(three.id("emp"), "structure"), 3);
});

// --- 1:ability:resurrect

function resurrectBoard(opts: { greed?: number; rage?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "emp", def: printing(EMPORIUM), owner: P1, zone: "play" },
      { key: "c0", def: character({ name: "Cost0", cost: 0, strength: 2, life: 3 }), owner: P1, zone: "discard" },
      { key: "c2", def: character({ name: "Cost2", cost: 2, strength: 3, life: 4 }), owner: P1, zone: "discard" },
      { key: "c4", def: character({ name: "Cost4", cost: 4, strength: 4, life: 5 }), owner: P1, zone: "discard" },
      { key: "c9", def: character({ name: "Cost9", cost: 9 }), owner: P1, zone: "discard" },
      { key: "oppCorpse", def: character({ name: "OppCorpse", cost: 1 }), owner: P2, zone: "discard" },
      { key: "gadget", def: item({ name: "GadgetCorpse", cost: 1 }), owner: P1, zone: "discard" },
      { key: "spell", def: tactic({ name: "SpentSpell", cost: 1 }), owner: P1, zone: "discard" },
      { key: "inHand", def: character({ name: "InHand", cost: 1 }), owner: P1, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck", cost: 1 }), owner: P1, zone: "deck" },
      { key: "inPlay", def: character({ name: "InPlay", cost: 1 }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 12, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const resurrect = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, targetKey: string, player: Pid = P1) =>
  engine.perform({ type: "activateAbility", playerId: player, cardId: id("emp"), abilityId: "resurrect", selected: { c: [id(targetKey)] }, variables: {} } as never);

for (const [key, cost] of [["c0", 0], ["c2", 2], ["c4", 4]] as const) {
  clause(EMPORIUM, "1:ability:resurrect", `pays 3+X with X=${cost}: exactly ${3 + cost} resources, and the character comes back under your control`, () => {
    const { engine, id } = resurrectBoard();
    const before = readyCount(engine, P1);
    resurrect(engine, id, key);
    resolvePendingResponses(engine);
    assert.equal(before - readyCount(engine, P1), 3 + cost, `3 + ${cost}`);
    assert.equal(zoneOf(engine, id(key)), "play");
    assert.equal(engine.state.cards[id(key)].controllerId, P1);
    assert.equal(discardOf(engine, P1).includes(id(key)), false);
    assert.equal(engine.state.cards[id(key)].depleted, false);
    assert.equal(engine.state.cards[id(key)].damage, 0);
  });
}

clause(EMPORIUM, "1:ability:resurrect", "only the picked character returns: the others stay in the discard pile", () => {
  const { engine, id } = resurrectBoard();
  resurrect(engine, id, "c2");
  resolvePendingResponses(engine);
  for (const key of ["c0", "c4", "c9"]) assert.equal(zoneOf(engine, id(key)), "discard", key);
  assert.equal(zoneOf(engine, id("emp")), "play", "the Emporium stays in play");
});

clause(EMPORIUM, "1:ability:resurrect", "the returned character has its printed stats", () => {
  const { engine, id } = resurrectBoard();
  resurrect(engine, id, "c4");
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("c4"), "strength"), 4);
  assert.equal(engine.getStat(id("c4"), "life"), 5);
});

clause(EMPORIUM, "1:ability:resurrect", "'put into play': the returned character's enters-play abilities happen (Mafia Lawyer: its faction loses 2)", () => {
  const { engine, id } = resurrectBoard({ extra: [{ key: "law", def: printing(LAWYER), owner: P1, zone: "discard" }] });
  const before = influenceOf(engine, P1);
  resurrect(engine, id, "law");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("law")), "play");
  assert.equal(influenceOf(engine, P1), before - 2);
});

clause(EMPORIUM, "1:ability:resurrect", "is refused one resource short: a cost-4 character needs 7, 6 is not enough", () => {
  const { engine, id } = resurrectBoard({ greed: 6 });
  assert.throws(() => resurrect(engine, id, "c4"));
  assert.equal(zoneOf(engine, id("c4")), "discard");
  assert.equal(readyCount(engine, P1), 6, "nothing paid");
  resurrect(engine, id, "c2");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c2")), "play", "the cost-2 character needs only 5");
});

clause(EMPORIUM, "1:ability:resurrect", "exactly 3+X resources is enough, using all of them", () => {
  const { engine, id } = resurrectBoard({ greed: 7 });
  resurrect(engine, id, "c4");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c4")), "play");
  assert.equal(readyCount(engine, P1), 0);
});

clause(EMPORIUM, "1:ability:resurrect", "the character with cost 9 needs 12, not 3", () => {
  const poor = resurrectBoard({ greed: 11 });
  assert.throws(() => resurrect(poor.engine, poor.id, "c9"));
  const rich = resurrectBoard({ greed: 12 });
  resurrect(rich.engine, rich.id, "c9");
  resolvePendingResponses(rich.engine);
  assert.equal(zoneOf(rich.engine, rich.id("c9")), "play");
});

clause(EMPORIUM, "1:ability:resurrect", "the cost uses resources of any icon (the ability has no threshold of its own)", () => {
  const { engine, id } = resurrectBoard({ greed: 0, rage: 5 });
  resurrect(engine, id, "c2");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c2")), "play");
});

clause(EMPORIUM, "1:ability:resurrect", "only characters in YOUR discard pile: the opponent's discard pile is refused", () => {
  const { engine, id } = resurrectBoard();
  assert.throws(() => resurrect(engine, id, "oppCorpse"));
  assert.equal(zoneOf(engine, id("oppCorpse")), "discard");
  assert.equal(readyCount(engine, P1), 12);
});

clause(EMPORIUM, "1:ability:resurrect", "only CHARACTERS: an item or a tactic in your discard pile is refused", () => {
  const { engine, id } = resurrectBoard();
  assert.throws(() => resurrect(engine, id, "gadget"), "item");
  assert.throws(() => resurrect(engine, id, "spell"), "tactic");
  assert.equal(readyCount(engine, P1), 12);
});

clause(EMPORIUM, "1:ability:resurrect", "only from the discard pile: a character in hand, in the deck or already in play is refused", () => {
  const { engine, id } = resurrectBoard();
  assert.throws(() => resurrect(engine, id, "inHand"), "hand");
  assert.throws(() => resurrect(engine, id, "inDeck"), "deck");
  assert.throws(() => resurrect(engine, id, "inPlay"), "already in play");
  assert.equal(readyCount(engine, P1), 12);
});

clause(EMPORIUM, "1:ability:resurrect", "a character must be picked: no pick and two picks are refused", () => {
  const { engine, id } = resurrectBoard();
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("emp"), abilityId: "resurrect", selected: { c: [] }, variables: {} } as never));
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("emp"), abilityId: "resurrect", selected: { c: [id("c0"), id("c2")] }, variables: {} } as never));
  assert.equal(zoneOf(engine, id("c0")), "discard");
});

clause(EMPORIUM, "1:ability:resurrect", "can be used again for a second character (each pays its own 3+X)", () => {
  const { engine, id } = resurrectBoard({ greed: 12 });
  resurrect(engine, id, "c0");
  resolvePendingResponses(engine);
  resurrect(engine, id, "c2");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c0")), "play");
  assert.equal(zoneOf(engine, id("c2")), "play");
  assert.equal(readyCount(engine, P1), 12 - 3 - 5);
});

clause(EMPORIUM, "1:ability:resurrect", "only during YOUR turn: on the opponent's turn, with a response window open for me, it is refused", () => {
  const stir = tactic({ name: "Stir", cost: 0, behavior: { abilities: [{ id: "stir", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const { engine, id } = resurrectBoard({
    active: P2,
    extra: [
      { key: "stir", def: stir, owner: P2, zone: "hand" },
      { key: "drawer", def: drawerChar(), owner: P1, zone: "play" }
    ]
  });
  playRaw(engine, P2, id("stir"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I hold the response window on their turn");
  assert.throws(() => resurrect(engine, id, "c2"), "RESURRECT may be used only during my turn");
  assert.equal(zoneOf(engine, id("c2")), "discard");
  assert.equal(readyCount(engine, P1), 12, "nothing was paid");
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("drawer"), abilityId: "draw1", selected: {}, variables: {} } as never);
  assert.ok(engine.state.responseWindow, "control: other abilities are usable in that same window");
});

clause(EMPORIUM, "1:ability:resurrect", "the opponent cannot use my Emporium's RESURRECT, even from a discard pile of their own", () => {
  const { engine, id } = resurrectBoard({
    active: P2,
    extra: [...bank("greed", 12, P2)]
  });
  assert.throws(() => resurrect(engine, id, "oppCorpse", P2));
  assert.equal(zoneOf(engine, id("oppCorpse")), "discard");
});

// =============================================================================
// 1337!
// Reduce the numeric cost of the next card you play this turn by up to 4. Draw
// a card.
// Tactic, cost 3, threshold [E].
// =============================================================================

const LEET = "64b33dfe-3811-4466-a7b4-5ffa7a680687";

const drawTactic = (name: string, cost: number): CardDefinition =>
  tactic({ name, cost, behavior: { abilities: [{ id: "dr", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

function leetBoard(opts: { elitism?: number; extra?: CardPlacement[]; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    cards: [
      { key: "l", def: printing(LEET), owner: P1, zone: "hand" },
      { key: "c5", def: character({ name: "Five", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c5b", def: character({ name: "FiveB", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c7", def: character({ name: "Seven", cost: 7 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "c9", def: character({ name: "Nine", cost: 9 }), owner: P1, zone: "hand" },
      { key: "thing", def: item({ name: "Thing", cost: 4 }), owner: P1, zone: "hand" },
      { key: "spell", def: drawTactic("Spell", 6), owner: P1, zone: "hand" },
      ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 2 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      ...bank("elitism", opts.elitism ?? 14, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** "By up to 4": 1337! asks how much to reduce; answers with `value` (4 unless a test says otherwise). */
function answerLeet(engine: SpoilsEngine, value = 4): void {
  if ((engine.state.pendingChoice as { kind?: string } | undefined)?.kind !== "chooseNumber") return;
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value } } as never);
  resolvePendingResponses(engine);
}

/** Plays 1337! (reducing by the full 4) and returns how many resources it cost. */
function playLeet(engine: SpoilsEngine, id: (key: string) => CardInstanceId): number {
  const before = readyCount(engine, P1);
  play(engine, P1, id("l"));
  answerLeet(engine);
  return before - readyCount(engine, P1);
}

/** Plays `key` from hand and returns the number of resources it cost. */
function costOf(engine: SpoilsEngine, id: (key: string) => CardInstanceId, key: string, opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}): number {
  const before = readyCount(engine, P1);
  play(engine, P1, id(key), opts);
  answerLeet(engine);
  return before - readyCount(engine, P1);
}

clause(LEET, "0:rule", "pays exactly 3, draws exactly one card (the top of the deck) and goes to the discard pile", () => {
  const { engine, id } = leetBoard();
  const top = engine.state.players[P1].deck[0];
  const handBefore = handOf(engine, P1).length;
  assert.equal(playLeet(engine, id), 3);
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.equal(engine.state.players[P1].deck.length, 3);
  assert.equal(zoneOf(engine, id("l")), "discard");
});

clause(LEET, "0:rule", "the opponent's hand and deck are untouched", () => {
  const { engine, id } = leetBoard();
  const oppDeck = [...engine.state.players[P2].deck];
  playLeet(engine, id);
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
});

clause(LEET, "0:rule", "the next card you play costs 4 less: a 5-cost character costs 1", () => {
  const { engine, id } = leetBoard();
  playLeet(engine, id);
  assert.equal(costOf(engine, id, "c5"), 1);
  assert.equal(zoneOf(engine, id("c5")), "play");
});

clause(LEET, "0:rule", "a 7-cost card costs 3", () => {
  const { engine, id } = leetBoard();
  playLeet(engine, id);
  assert.equal(costOf(engine, id, "c7"), 3);
});

clause(LEET, "0:rule", "a 9-cost card costs 5", () => {
  const { engine, id } = leetBoard();
  playLeet(engine, id);
  assert.equal(costOf(engine, id, "c9"), 5);
});

clause(LEET, "0:rule", "a 4-cost item costs 0 (reduction can take the cost all the way down)", () => {
  const { engine, id } = leetBoard();
  playLeet(engine, id);
  assert.equal(costOf(engine, id, "thing"), 0);
  assert.equal(zoneOf(engine, id("thing")), "play");
});

clause(LEET, "0:rule", "a 2-cost card costs 0, never less: the cost cannot go negative (no refund)", () => {
  const { engine, id } = leetBoard();
  playLeet(engine, id);
  assert.equal(costOf(engine, id, "c2"), 0);
  assert.equal(attachedCount(engine, P1), 3, "only 1337!'s own 3 resources are attached");
});

clause(LEET, "0:rule", "any card type counts as 'the next card you play': a 6-cost tactic costs 2", () => {
  const { engine, id } = leetBoard();
  playLeet(engine, id);
  assert.equal(costOf(engine, id, "spell"), 2);
  assert.equal(zoneOf(engine, id("spell")), "discard");
});

clause(LEET, "0:rule", "only the NEXT card: the card after it costs its full price", () => {
  const { engine, id } = leetBoard();
  playLeet(engine, id);
  assert.equal(costOf(engine, id, "c5"), 1);
  assert.equal(costOf(engine, id, "c5b"), 5, "the reduction was used up");
});

clause(LEET, "0:rule", "1337! itself is not reduced by itself", () => {
  const { engine, id } = leetBoard({ extra: [{ key: "l2", def: printing(LEET), owner: P1, zone: "hand" }] });
  assert.equal(playLeet(engine, id), 3);
  const before = readyCount(engine, P1);
  play(engine, P1, id("l2"));
  answerLeet(engine);
  assert.equal(before - readyCount(engine, P1), 0, "a second 1337! is the next card: 3 - 4 floors at 0");
});

clause(LEET, "0:rule", "the reduction waives only the NUMERIC cost: the threshold of the next card still has to be met", () => {
  const { engine, id } = leetBoard({ extra: [{ key: "rage", def: character({ name: "NeedsRage", cost: 3, threshold: "rr" }), owner: P1, zone: "hand" }] });
  playLeet(engine, id);
  assert.throws(() => playRaw(engine, P1, id("rage")), "no [R][R], reduced cost or not");
  assert.equal(zoneOf(engine, id("rage")), "hand");
  assert.equal(costOf(engine, id, "c5"), 1, "the reduction is still waiting for a legal card");
});

clause(LEET, "0:rule", "a second 1337! is itself 'the next card you play': it uses up the first reduction (cost 0), and its own reduction is for the card after", () => {
  const { engine, id } = leetBoard({ extra: [{ key: "l2", def: printing(LEET), owner: P1, zone: "hand" }] });
  playLeet(engine, id);
  assert.equal(costOf(engine, id, "l2"), 0, "3 - 4 floors at 0");
  assert.equal(costOf(engine, id, "c9"), 5, "9 - 4: only one reduction is waiting, not two");
});

clause(LEET, "0:rule", "the reduction survives the opponent's responses: their tactic costs them full price and does not use up my reduction", () => {
  const quip = drawTactic("Quip", 2);
  const { engine, id } = leetBoard({
    extra: [
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "quip", def: quip, owner: P2, zone: "hand" },
      ...bank("greed", 5, P2)
    ]
  });
  playLeet(engine, id);
  attackUntilDefenderMayRespond(engine, P1, [id("atk")]);
  const oppBefore = readyCount(engine, P2);
  play(engine, P2, id("quip"));
  assert.equal(oppBefore - readyCount(engine, P2), 2, "the opponent pays the full 2: my reduction is not theirs");
  declareBlock(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(costOf(engine, id, "c5"), 1, "my reduction is still there");
});

clause(LEET, "0:rule", "only 'this turn': if no card is played, the reduction is gone on your next turn", () => {
  const { engine, id } = leetBoard({ turn: 1 });
  playLeet(engine, id);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(costOf(engine, id, "c5"), 5, "full price a turn later");
});

clause(LEET, "0:rule", "it is the controller's reduction: the opponent's first card on their turn is not reduced", () => {
  const { engine, id } = leetBoard({
    turn: 1,
    extra: [{ key: "oppChar", def: character({ name: "OppChar", cost: 4 }), owner: P2, zone: "hand" }, ...bank("greed", 6, P2)]
  });
  playLeet(engine, id);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const before = readyCount(engine, P2);
  play(engine, P2, id("oppChar"));
  assert.equal(before - readyCount(engine, P2), 4, "full price");
});

clause(LEET, "0:rule", "a card is not an ability: using an ability that costs resources pays its full price and does not use up the reduction", () => {
  const { engine, id } = leetBoard({ extra: [{ key: "as", def: printing(ASSASSIN), owner: P1, zone: "play", depleted: true }] });
  playLeet(engine, id);
  const before = readyCount(engine, P1);
  activate(engine, P1, id("as"), "restore");
  assert.equal(before - readyCount(engine, P1), 2, "RESTORE costs its full 2");
  assert.equal(costOf(engine, id, "c5"), 1, "the reduction still applies to the next CARD");
});

clause(LEET, "0:rule", "'by up to 4': the controller chooses how much to reduce, 0 to 4 (here 2: a 5-cost card then costs 3)", () => {
  const { engine, id } = leetBoard();
  play(engine, P1, id("l"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; min: number; max: number } | undefined;
  assert.ok(pc, "the player is asked how much to reduce");
  assert.equal(pc.kind, "chooseNumber");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.min, 0);
  assert.equal(pc.max, 4);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseNumber", value: 2 } } as never);
  resolvePendingResponses(engine);
  assert.equal(costOf(engine, id, "c5"), 3, "reduced by the chosen 2");
});

clause(LEET, "0:rule", "is refused one resource short of its cost of 3, and without [E] even with other resources", () => {
  const short = leetBoard({ elitism: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("l")));
  const noThreshold = leetBoard({ elitism: 0, extra: bank("rage", 6, P1) });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("l")), "no [E]");
  const exact = leetBoard({ elitism: 1, extra: bank("rage", 2, P1) });
  assert.equal(playLeet(exact.engine, exact.id), 3, "one [E] and 3 resources in total is enough");
});

// =============================================================================
// 3p1ph4ny 31f
// When this card enters play, you may play a non-tactic card for free. If you
// do, your opponent may do the same. (You still need the proper resource icons
// and must pay any additional costs.)
// Character, cost 5, threshold [E][E][E], 2 / 3 / 2.
// =============================================================================

const EPIPHANY = "579cf37c-1b99-47a8-b090-96bc06ea81b9";

function epiphanyBoard(opts: { elitism?: number; p1Hand?: CardPlacement[]; p2Hand?: CardPlacement[]; p2Greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "epi", def: printing(EPIPHANY), owner: P1, zone: "hand" },
      ...(opts.p1Hand ?? [
        { key: "ch", def: character({ name: "Cheap", cost: 3 }), owner: P1, zone: "hand" as const },
        { key: "big", def: character({ name: "Big", cost: 8 }), owner: P1, zone: "hand" as const },
        { key: "it", def: item({ name: "Gizmo", cost: 2 }), owner: P1, zone: "hand" as const },
        { key: "loc", def: location({ name: "Hideout", cost: 4 }), owner: P1, zone: "hand" as const },
        { key: "tac", def: drawTactic("Spell", 1), owner: P1, zone: "hand" as const }
      ]),
      ...(opts.p2Hand ?? [
        { key: "oc", def: character({ name: "OppChar", cost: 4 }), owner: P2, zone: "hand" as const },
        { key: "otac", def: drawTactic("OppSpell", 1), owner: P2, zone: "hand" as const },
        { key: "oi", def: item({ name: "OppGizmo", cost: 3 }), owner: P2, zone: "hand" as const }
      ]),
      { key: "deckCard", def: character({ name: "DeckCard", cost: 1 }), owner: P1, zone: "deck" },
      { key: "discardCard", def: character({ name: "DiscardCard", cost: 1 }), owner: P1, zone: "discard" },
      ...bank("elitism", opts.elitism ?? 5, P1),
      ...bank("greed", opts.p2Greed ?? 2, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type FreePick = { kind: string; playerId: string; candidates: CardInstanceId[] };
const freePick = (engine: SpoilsEngine): FreePick | undefined => engine.state.pendingChoice as unknown as FreePick | undefined;
const chooseFree = (engine: SpoilsEngine, player: Pid, cardId?: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}) => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "deployForFree", cardId, selected } } as never);
  resolvePendingResponses(engine);
};

clause(EPIPHANY, "0:rule", "enters play for 5 with [E][E][E] as a 2 / 3 / 2, and then its controller is offered a free play", () => {
  const { engine, id } = epiphanyBoard({ elitism: 5 });
  const before = readyCount(engine, P1);
  play(engine, P1, id("epi"));
  assert.equal(zoneOf(engine, id("epi")), "play");
  assert.equal(before - readyCount(engine, P1), 5);
  assert.equal(engine.getStat(id("epi"), "strength"), 2);
  assert.equal(engine.getStat(id("epi"), "speed"), 3);
  assert.equal(engine.getStat(id("epi"), "life"), 2);
  const pc = freePick(engine);
  assert.equal(pc?.kind, "deployForFree");
  assert.equal(pc?.playerId, P1, "'you may play a non-tactic card'");
});

clause(EPIPHANY, "0:rule", "the free play may be any NON-TACTIC card in your hand: characters, items and locations are offered, tactics are not", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("epi"));
  const pc = freePick(engine)!;
  for (const key of ["ch", "big", "it", "loc"]) assert.ok(pc.candidates.includes(id(key)), `${key} is offered`);
  assert.equal(pc.candidates.includes(id("tac")), false, "a tactic is not offered");
  assert.equal(pc.candidates.includes(id("oc")), false, "the opponent's cards are not offered");
  assert.equal(pc.candidates.includes(id("deckCard")), false, "cards in the deck are not offered");
  assert.equal(pc.candidates.includes(id("discardCard")), false, "cards in the discard pile are not offered");
  assert.equal(pc.candidates.includes(id("epi")), false, "the Epiphany itself is already in play");
});

clause(EPIPHANY, "0:rule", "a tactic cannot be chosen even if named", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("epi"));
  assert.throws(() => chooseFree(engine, P1, id("tac")));
  assert.equal(zoneOf(engine, id("tac")), "hand");
  assert.ok(freePick(engine), "still waiting for a legal answer");
});

clause(EPIPHANY, "0:rule", "a card from the opponent's hand, the deck or the discard pile cannot be chosen", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("epi"));
  assert.throws(() => chooseFree(engine, P1, id("oc")));
  assert.throws(() => chooseFree(engine, P1, id("deckCard")));
  assert.throws(() => chooseFree(engine, P1, id("discardCard")));
});

clause(EPIPHANY, "0:rule", "a chosen character enters play for free: no resources are paid for it", () => {
  const { engine, id } = epiphanyBoard({ elitism: 8 });
  play(engine, P1, id("epi"));
  const afterEpi = readyCount(engine, P1);
  chooseFree(engine, P1, id("ch"));
  assert.equal(zoneOf(engine, id("ch")), "play");
  assert.equal(engine.state.cards[id("ch")].controllerId, P1);
  assert.equal(readyCount(engine, P1), afterEpi, "a 3-cost character cost nothing");
});

clause(EPIPHANY, "0:rule", "a card costing far more than you have still comes in for free (cost 8 with nothing left)", () => {
  const { engine, id } = epiphanyBoard({ elitism: 5 });
  play(engine, P1, id("epi"));
  assert.equal(readyCount(engine, P1), 0);
  chooseFree(engine, P1, id("big"));
  assert.equal(zoneOf(engine, id("big")), "play");
});

clause(EPIPHANY, "0:rule", "an item can be played for free", () => {
  const { engine, id } = epiphanyBoard({ elitism: 5 });
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, id("it"));
  assert.equal(zoneOf(engine, id("it")), "play");
});

clause(EPIPHANY, "0:rule", "a location can be played for free", () => {
  const { engine, id } = epiphanyBoard({ elitism: 5 });
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, id("loc"));
  assert.equal(zoneOf(engine, id("loc")), "play");
});

clause(EPIPHANY, "0:rule", "free is the numeric cost only: a card whose resource icons you lack cannot be played", () => {
  const needsRage = character({ name: "NeedsRage", cost: 1, threshold: "rr" });
  const { engine, id } = epiphanyBoard({ p1Hand: [{ key: "rage", def: needsRage, owner: P1, zone: "hand" }, { key: "ch", def: character({ name: "Cheap", cost: 3 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("epi"));
  assert.throws(() => chooseFree(engine, P1, id("rage")), "no [R][R]");
  assert.equal(zoneOf(engine, id("rage")), "hand");
  assert.ok(freePick(engine), "the choice is still open");
  chooseFree(engine, P1, id("ch"));
  assert.equal(zoneOf(engine, id("ch")), "play");
});

clause(EPIPHANY, "0:rule", "free is the numeric cost only: a card with an additional cost still has it paid (extra 'your faction loses 2 influence')", () => {
  const costly = character({ name: "Costly", cost: 6, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 2 }] } } });
  const { engine, id } = epiphanyBoard({ p1Hand: [{ key: "costly", def: costly, owner: P1, zone: "hand" }] });
  play(engine, P1, id("epi"));
  const afterEpi = readyCount(engine, P1);
  chooseFree(engine, P1, id("costly"));
  assert.equal(zoneOf(engine, id("costly")), "play");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 2, "the additional cost is paid");
  assert.equal(readyCount(engine, P1), afterEpi, "the numeric cost of 6 is not");
});

clause(EPIPHANY, "0:rule", "free is the numeric cost only: a card with an additional 'discard a card' cost still needs the discard, and refuses without it", () => {
  const discarder = character({
    name: "Discarder",
    cost: 6,
    behavior: { onPlay: { costs: [{ type: "discard", id: "d", player: "controller", selector: { zone: "hand", owner: "self" }, count: 1 }] } }
  });
  const { engine, id } = epiphanyBoard({
    p1Hand: [
      { key: "discarder", def: discarder, owner: P1, zone: "hand" },
      { key: "fodder", def: character({ name: "Fodder", cost: 1 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("epi"));
  assert.throws(() => chooseFree(engine, P1, id("discarder")), "the additional cost has no card to discard");
  assert.equal(zoneOf(engine, id("discarder")), "hand");
  chooseFree(engine, P1, id("discarder"), { d: [id("fodder")] });
  assert.equal(zoneOf(engine, id("discarder")), "play");
  assert.equal(zoneOf(engine, id("fodder")), "discard", "the additional cost was paid");
});

clause(EPIPHANY, "0:rule", "'may': its controller can decline, and nothing is played", () => {
  const { engine, id } = epiphanyBoard();
  const handBefore = [...handOf(engine, P1)];
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, undefined);
  for (const key of ["ch", "big", "it", "loc", "tac"]) assert.equal(zoneOf(engine, id(key)), "hand", key);
  assert.deepEqual(handOf(engine, P1), handBefore.filter((c) => c !== id("epi")));
});

clause(EPIPHANY, "0:rule", "the free card's own enters-play abilities happen (it is really played): a character that draws a card when it enters", () => {
  const drawer = character({
    name: "Cantrip",
    cost: 4,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = epiphanyBoard({ p1Hand: [{ key: "cantrip", def: drawer, owner: P1, zone: "hand" }] });
  const top = engine.state.players[P1].deck[0];
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, id("cantrip"));
  assert.equal(zoneOf(engine, top), "hand", "its enters-play trigger drew the top card");
});

clause(EPIPHANY, "0:rule", "if you do play a card, your OPPONENT is then offered the same: a free non-tactic card from their hand", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, id("ch"));
  const pc = freePick(engine);
  assert.ok(pc, "the opponent is offered a free play");
  assert.equal(pc.kind, "deployForFree");
  assert.equal(pc.playerId, P2);
  assert.ok(pc.candidates.includes(id("oc")), "pc.candidates.includes(id(\"oc\"))");
  assert.ok(pc.candidates.includes(id("oi")), "pc.candidates.includes(id(\"oi\"))");
  assert.equal(pc.candidates.includes(id("otac")), false, "the opponent's tactic is not offered");
  assert.equal(pc.candidates.includes(id("big")), false, "my cards are not offered to them");
});

clause(EPIPHANY, "0:rule", "the opponent's free card enters play under THEIR control, and costs them nothing", () => {
  const { engine, id } = epiphanyBoard({ p2Greed: 0 });
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, id("ch"));
  const oppReady = readyCount(engine, P2);
  chooseFree(engine, P2, id("oc"));
  assert.equal(zoneOf(engine, id("oc")), "play");
  assert.equal(engine.state.cards[id("oc")].controllerId, P2);
  assert.equal(readyCount(engine, P2), oppReady);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(EPIPHANY, "0:rule", "the opponent still needs the proper icons for their free card", () => {
  const rage = character({ name: "OppRage", cost: 1, threshold: "rr" });
  const { engine, id } = epiphanyBoard({ p2Hand: [{ key: "orage", def: rage, owner: P2, zone: "hand" }, { key: "oc", def: character({ name: "OppChar", cost: 4 }), owner: P2, zone: "hand" }] });
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, id("ch"));
  assert.throws(() => chooseFree(engine, P2, id("orage")), "they have no [R][R]");
  assert.equal(zoneOf(engine, id("orage")), "hand");
  chooseFree(engine, P2, id("oc"));
  assert.equal(zoneOf(engine, id("oc")), "play");
});

clause(EPIPHANY, "0:rule", "the opponent 'may': they can decline", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, id("ch"));
  chooseFree(engine, P2, undefined);
  assert.equal(zoneOf(engine, id("oc")), "hand");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(EPIPHANY, "0:rule", "the opponent cannot play a tactic for free", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, id("ch"));
  assert.throws(() => chooseFree(engine, P2, id("otac")));
});

clause(EPIPHANY, "0:rule", "'If you do': when its controller DECLINES to play a card, the opponent is not offered one either", () => {
  const { engine, id } = epiphanyBoard();
  play(engine, P1, id("epi"));
  chooseFree(engine, P1, undefined);
  assert.equal(engine.state.pendingChoice, undefined, "no free play for the opponent: its controller played nothing");
  assert.equal(zoneOf(engine, id("oc")), "hand");
});

clause(EPIPHANY, "0:rule", "'If you do': when its controller has no non-tactic card to play, the opponent is not offered one either", () => {
  const { engine, id } = epiphanyBoard({ p1Hand: [{ key: "tac", def: drawTactic("Spell", 1), owner: P1, zone: "hand" }] });
  play(engine, P1, id("epi"));
  if (engine.state.pendingChoice) assert.equal(freePick(engine)?.playerId, P1, "(if anyone is asked) only its controller could be");
  assert.equal(engine.state.pendingChoice, undefined, "nobody is offered a free play: its controller had nothing to play");
  assert.equal(zoneOf(engine, id("oc")), "hand");
});

clause(EPIPHANY, "0:rule", "it triggers off ITSELF entering play only: another character entering play offers nothing", () => {
  const { engine, id } = epiphanyBoard({ extra: [{ key: "epiInPlay", def: printing(EPIPHANY), owner: P1, zone: "play" }, { key: "newcomer", def: character({ name: "Newcomer", cost: 1 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("newcomer"));
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(EPIPHANY, "0:rule", "is refused one resource short of 5, and without [E][E][E]", () => {
  const short = epiphanyBoard({ elitism: 4 });
  assert.throws(() => playRaw(short.engine, P1, short.id("epi")));
  const noThreshold = epiphanyBoard({ elitism: 2, extra: bank("rage", 6, P1) });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("epi")), "two [E] is one short of [E][E][E]");
});

// =============================================================================
// 700160x 31f
// When this card enters play, you may search your deck for a "gear" card with
// numeric cost 5 or less. If you do, put that card into play attached to this
// card.
// Character, cost 3, threshold [E][E], 1 / 3 / 1.
// =============================================================================

const GEARFINDER = "98e1b892-4da0-4b36-b877-23b5fae6dd79";

/** A "gear" item that attaches to a character and gives it +2 strength. */
const gearItem = (name: string, cost: number, over: Partial<CardDefinition> = {}): CardDefinition =>
  item({
    name,
    cost,
    subtype: ["gear"],
    attachTo: "character",
    behavior: { abilities: [{ id: "gearbonus", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] },
    ...over
  });

function gearfinderBoard(opts: { elitism?: number; noGearInDeck?: boolean; extra?: CardPlacement[] } = {}) {
  const deck: CardPlacement[] = opts.noGearInDeck
    ? []
    : [
        { key: "gear0", def: gearItem("Gear0", 0), owner: P1, zone: "deck" },
        { key: "gear5", def: gearItem("Gear5", 5), owner: P1, zone: "deck" },
        { key: "gear6", def: gearItem("Gear6", 6), owner: P1, zone: "deck" },
        { key: "gearRage", def: gearItem("GearRage", 4, { threshold: "rr" }), owner: P1, zone: "deck" }
      ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "gf", def: printing(GEARFINDER), owner: P1, zone: "hand" },
      ...deck,
      { key: "tool", def: item({ name: "Tool", cost: 1, subtype: ["tool"], attachTo: "character" }), owner: P1, zone: "deck" },
      { key: "chump", def: character({ name: "Chump", cost: 1 }), owner: P1, zone: "deck" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner: P1, zone: "deck" as const })),
      { key: "gearHand", def: gearItem("GearHand", 2), owner: P1, zone: "hand" },
      { key: "gearDiscard", def: gearItem("GearDiscard", 2), owner: P1, zone: "discard" },
      { key: "oppGear", def: gearItem("OppGear", 1), owner: P2, zone: "deck" },
      { key: "oppFiller", def: character({ name: "OppFiller" }), owner: P2, zone: "deck" },
      ...bank("elitism", opts.elitism ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const searchChoice = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
const searchPick = (engine: SpoilsEngine, player: Pid, ids: CardInstanceId[]) => () => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  resolvePendingResponses(engine);
};
const sameCards = (a: readonly string[], b: readonly string[]) => assert.deepEqual([...a].sort(), [...b].sort());

clause(GEARFINDER, "0:rule", "enters play for 3 with [E][E] as a 1 / 3 / 1, and its controller is asked what to fetch", () => {
  const { engine, id } = gearfinderBoard();
  const before = readyCount(engine, P1);
  play(engine, P1, id("gf"));
  assert.equal(zoneOf(engine, id("gf")), "play");
  assert.equal(before - readyCount(engine, P1), 3);
  assert.equal(engine.getStat(id("gf"), "strength"), 1);
  assert.equal(engine.getStat(id("gf"), "speed"), 3);
  assert.equal(engine.getStat(id("gf"), "life"), 1);
  assert.equal(searchChoice(engine)?.kind, "chooserSelectsTarget");
  assert.equal(searchChoice(engine)?.playerId, P1);
});

clause(GEARFINDER, "0:rule", "a gear with cost 5 is put into play attached to this card and gives it its bonus (strength 1 + 2)", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear5")])();
  assert.equal(zoneOf(engine, id("gear5")), "play");
  assert.equal(engine.state.cards[id("gear5")].attachedTo, id("gf"), "attached to the 700160x");
  assert.equal(engine.state.cards[id("gear5")].controllerId, P1);
  assert.equal(engine.getStat(id("gf"), "strength"), 3, "the gear's +2 strength applies to its host");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GEARFINDER, "0:rule", "a gear with cost 0 qualifies as well ('5 or less')", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear0")])();
  assert.equal(zoneOf(engine, id("gear0")), "play");
  assert.equal(engine.state.cards[id("gear0")].attachedTo, id("gf"));
});

clause(GEARFINDER, "0:rule", "a gear with cost 6 is too expensive and cannot be chosen", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  assert.throws(searchPick(engine, P1, [id("gear6")]));
  assert.equal(zoneOf(engine, id("gear6")), "deck");
  assert.ok(searchChoice(engine), "still waiting for a legal pick");
});

clause(GEARFINDER, "0:rule", "only a 'gear': an item of another subtype and a plain character in the deck cannot be chosen", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  assert.throws(searchPick(engine, P1, [id("tool")]), "a non-gear item");
  assert.throws(searchPick(engine, P1, [id("chump")]), "a non-gear character");
});

clause(GEARFINDER, "0:rule", "only from YOUR DECK: a gear in your hand, your discard pile or the opponent's deck cannot be chosen", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  assert.throws(searchPick(engine, P1, [id("gearHand")]), "hand");
  assert.throws(searchPick(engine, P1, [id("gearDiscard")]), "discard pile");
  assert.throws(searchPick(engine, P1, [id("oppGear")]), "the opponent's deck");
  assert.equal(zoneOf(engine, id("oppGear")), "deck");
});

clause(GEARFINDER, "0:rule", "only ONE card: two gears are refused", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  assert.throws(searchPick(engine, P1, [id("gear0"), id("gear5")]));
  assert.equal(zoneOf(engine, id("gear0")), "deck");
  assert.equal(zoneOf(engine, id("gear5")), "deck");
});

clause(GEARFINDER, "0:rule", "the gear is put into play, not deployed: its own cost and threshold are not required ([R][R] gear with no Rage)", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  const after = readyCount(engine, P1);
  searchPick(engine, P1, [id("gearRage")])();
  assert.equal(zoneOf(engine, id("gearRage")), "play");
  assert.equal(engine.state.cards[id("gearRage")].attachedTo, id("gf"));
  assert.equal(readyCount(engine, P1), after, "no cost was paid for the gear");
});

clause(GEARFINDER, "0:rule", "'may': its controller can decline; nothing is put into play", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [])();
  for (const key of ["gear0", "gear5", "gear6", "gearRage"]) assert.equal(zoneOf(engine, id(key)), "deck", key);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GEARFINDER, "0:rule", "the deck is shuffled after the search (CR 312.1): same cards, new order", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  const before = engine.state.players[P1].deck.filter((c) => c !== id("gear5"));
  searchPick(engine, P1, [id("gear5")])();
  const after = engine.state.players[P1].deck;
  sameCards(after, before);
  assert.notDeepEqual(after, before, "the deck was shuffled");
});

clause(GEARFINDER, "0:rule", "searching and taking nothing (a search that fails, CR 312.2) still shuffles the searched deck", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  const before = [...engine.state.players[P1].deck];
  searchPick(engine, P1, [])();
  const after = engine.state.players[P1].deck;
  sameCards(after, before);
  assert.notDeepEqual(after, before, "a searched deck is shuffled even when nothing was taken");
});

clause(GEARFINDER, "0:rule", "'you may search': declining is no search at all, so the deck is NOT shuffled (Q2, CR 312.1)", () => {
  const { engine, id } = gearfinderBoard();
  play(engine, P1, id("gf"));
  const before = [...engine.state.players[P1].deck];
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [], declined: true } } as never);
  resolvePendingResponses(engine);
  assert.deepEqual(engine.state.players[P1].deck, before, "nothing was searched, so the deck keeps its order");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GEARFINDER, "0:rule", "the opponent's deck is not searched or shuffled", () => {
  const { engine, id } = gearfinderBoard();
  const oppDeck = [...engine.state.players[P2].deck];
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear5")])();
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
});

clause(GEARFINDER, "0:rule", "a search that finds no legal gear still shuffles the deck (CR 312.1)", () => {
  const { engine, id } = gearfinderBoard({ noGearInDeck: true });
  const before = [...engine.state.players[P1].deck];
  play(engine, P1, id("gf"));
  drain(engine, declineAll);
  const after = engine.state.players[P1].deck;
  sameCards(after, before);
  assert.notDeepEqual(after, before, "the deck was searched (and found nothing), so it is shuffled");
});

clause(GEARFINDER, "0:rule", "if the host leaves play the fetched gear leaves with it (an Attach-to card cannot stay behind)", () => {
  const { engine, id } = gearfinderBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("gf"));
  searchPick(engine, P1, [id("gear5")])();
  play(engine, P1, id("kill"), { selected: { t: [id("gf")] } });
  assert.equal(zoneOf(engine, id("gf")), "discard");
  assert.notEqual(zoneOf(engine, id("gear5")), "play", "the gear left play with its host");
});

clause(GEARFINDER, "0:rule", "it searches only when THIS card enters play: another character entering play asks nothing", () => {
  const { engine, id } = gearfinderBoard({
    extra: [
      { key: "gfInPlay", def: printing(GEARFINDER), owner: P1, zone: "play" },
      { key: "newcomer", def: character({ name: "Newcomer", cost: 1 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("newcomer"));
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(GEARFINDER, "0:rule", "is refused one resource short of 3, and without [E][E]", () => {
  const short = gearfinderBoard({ elitism: 2 });
  assert.throws(() => playRaw(short.engine, P1, short.id("gf")));
  const noThreshold = gearfinderBoard({ elitism: 1, extra: bank("rage", 5, P1) });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("gf")), "one [E] is short of [E][E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("gf")), "hand");
});

// =============================================================================
// The node cycle: A Series of Tubes, Basic Node, Hub Node
// ETB: "you may search your deck for a node card, reveal it, and put it into
// your hand"; DEATH: "if this card is destroyed, destroy all other node cards".
// =============================================================================

const nodeChar = (name: string, over: Partial<CardDefinition> = {}): CardDefinition =>
  character({ name, subtype: ["node"], strength: 2, life: 2, speed: 2, ...over });
const nodeItem = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => item({ name, subtype: ["node"], cost: 1, ...over });

interface NodeSpec {
  id: string;
  cost: number;
  strength: number;
  speed: number;
  life: number;
}

const TUBES = "9d3a3159-52c7-428a-b4ed-db2719792304";
const BASIC_NODE = "a525afe9-e0c7-4502-b713-4e394b0ae77e";
const HUB_NODE = "f7ddc8f5-5819-4855-a12a-0df4543c6775";
const TUBES_SPEC: NodeSpec = { id: TUBES, cost: 5, strength: 5, speed: 3, life: 5 };
const BASIC_SPEC: NodeSpec = { id: BASIC_NODE, cost: 1, strength: 1, speed: 4, life: 1 };
const HUB_SPEC: NodeSpec = { id: HUB_NODE, cost: 3, strength: 2, speed: 3, life: 2 };

function nodeEtbBoard(spec: NodeSpec, opts: { nodesInDeck?: boolean; inPlay?: boolean } = {}) {
  const nodesInDeck = opts.nodesInDeck !== false;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "n", def: printing(spec.id), owner: P1, zone: opts.inPlay ? "play" : "hand" },
      ...(nodesInDeck
        ? [
            { key: "nodeA", def: nodeChar("NodeA"), owner: P1, zone: "deck" as const },
            { key: "nodeI", def: nodeItem("NodeI"), owner: P1, zone: "deck" as const }
          ]
        : []),
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "deck" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner: P1, zone: "deck" as const })),
      { key: "nodeHand", def: nodeChar("NodeHand"), owner: P1, zone: "hand" },
      { key: "nodeDisc", def: nodeChar("NodeDisc"), owner: P1, zone: "discard" },
      { key: "nodeBoard", def: nodeChar("NodeBoard"), owner: P1, zone: "play" },
      { key: "oppNode", def: nodeChar("OppNode"), owner: P2, zone: "deck" },
      { key: "oppFiller", def: character({ name: "OppFiller" }), owner: P2, zone: "deck" },
      { key: "cheapNode", def: nodeChar("CheapNode", { cost: 0 }), owner: P1, zone: "hand" },
      ...bank("elitism", spec.cost, P1)
    ]
  });
}

const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

function nodeOffersSearch(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  const before = readyCount(engine, P1);
  play(engine, P1, id("n"));
  assert.equal(zoneOf(engine, id("n")), "play");
  assert.equal(before - readyCount(engine, P1), spec.cost, "the printed cost is paid");
  assert.equal(searchChoice(engine)?.kind, "chooserSelectsTarget", "the controller may search");
  assert.equal(searchChoice(engine)?.playerId, P1);
  assert.equal(engine.getStat(id("n"), "speed"), spec.speed);
}

function nodeFindsAndReveals(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  play(engine, P1, id("n"));
  searchPick(engine, P1, [id("nodeA")])();
  assert.equal(zoneOf(engine, id("nodeA")), "hand", "put into your hand, not into play");
  assert.ok(handOf(engine, P1).includes(id("nodeA")), "handOf(engine, P1).includes(id(\"nodeA\"))");
  assert.equal(engine.state.pendingChoice, undefined);
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1, "the found card is revealed once");
  const event = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(event.cardIds, [id("nodeA")]);
  assert.equal(event.viewerId, "all", "revealed to everyone");
}

function nodeFindsAnItem(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  play(engine, P1, id("n"));
  searchPick(engine, P1, [id("nodeI")])();
  assert.equal(zoneOf(engine, id("nodeI")), "hand", "a node ITEM is a 'node card' too");
}

function nodeSearchRestrictions(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  play(engine, P1, id("n"));
  assert.throws(searchPick(engine, P1, [id("plain")]), "a non-node card in the deck");
  assert.throws(searchPick(engine, P1, [id("nodeHand")]), "a node in hand");
  assert.throws(searchPick(engine, P1, [id("nodeDisc")]), "a node in the discard pile");
  assert.throws(searchPick(engine, P1, [id("nodeBoard")]), "a node already in play");
  assert.throws(searchPick(engine, P1, [id("oppNode")]), "a node in the opponent's deck");
  assert.throws(searchPick(engine, P1, [id("nodeA"), id("nodeI")]), "only one card");
  assert.ok(searchChoice(engine), "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("nodeA")), "deck");
}

function nodeSearchMayDecline(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  const handBefore = [...handOf(engine, P1)];
  play(engine, P1, id("n"));
  searchPick(engine, P1, [])();
  assert.deepEqual(handOf(engine, P1), handBefore.filter((c) => c !== id("n")), "nothing was taken");
  assert.equal(zoneOf(engine, id("nodeA")), "deck");
  assert.equal(revealEvents(engine).length, 0, "nothing was revealed");
  assert.equal(engine.state.pendingChoice, undefined);
}

function nodeSearchShuffles(spec: NodeSpec) {
  const taken = nodeEtbBoard(spec);
  play(taken.engine, P1, taken.id("n"));
  const before = taken.engine.state.players[P1].deck.filter((c) => c !== taken.id("nodeA"));
  searchPick(taken.engine, P1, [taken.id("nodeA")])();
  sameCards(taken.engine.state.players[P1].deck, before);
  assert.notDeepEqual(taken.engine.state.players[P1].deck, before, "shuffled after taking a card");
  const declined = nodeEtbBoard(spec);
  play(declined.engine, P1, declined.id("n"));
  const beforeDeclined = [...declined.engine.state.players[P1].deck];
  searchPick(declined.engine, P1, [])();
  sameCards(declined.engine.state.players[P1].deck, beforeDeclined);
  assert.notDeepEqual(declined.engine.state.players[P1].deck, beforeDeclined, "shuffled after declining");
}

function nodeSearchLeavesOpponent(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  const oppDeck = [...engine.state.players[P2].deck];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("n"));
  searchPick(engine, P1, [id("nodeA")])();
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
}

function nodeSearchFindsNothingShuffles(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec, { nodesInDeck: false });
  const before = [...engine.state.players[P1].deck];
  play(engine, P1, id("n"));
  drain(engine, declineAll);
  const after = engine.state.players[P1].deck;
  sameCards(after, before);
  assert.notDeepEqual(after, before, "searched and found nothing: the deck is shuffled anyway");
}

function nodeSearchOnlyOnSelf(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec, { inPlay: true });
  play(engine, P1, id("cheapNode"));
  assert.equal(zoneOf(engine, id("cheapNode")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "another node entering play does not make this card search");
}

function nodeCardItself(spec: NodeSpec, enough: number, missing: { elitism: number; rage?: number }) {
  const mk = (elitism: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "n", def: printing(spec.id), owner: P1, zone: "hand" }, ...bank("elitism", elitism, P1), ...bank("rage", rage, P1)]
    });
  const short = mk(spec.cost - 1, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("n")), "one resource short of the cost");
  const wrong = mk(missing.elitism, missing.rage ?? spec.cost + 2);
  assert.throws(() => playRaw(wrong.engine, P1, wrong.id("n")), "short of the [E] threshold");
  const ok = mk(enough, spec.cost - enough);
  play(ok.engine, P1, ok.id("n"));
  assert.equal(zoneOf(ok.engine, ok.id("n")), "play");
  assert.equal(ok.engine.getStat(ok.id("n"), "strength"), spec.strength);
  assert.equal(ok.engine.getStat(ok.id("n"), "speed"), spec.speed);
  assert.equal(ok.engine.getStat(ok.id("n"), "life"), spec.life);
}

// --- destroy all other node cards

function nodeWipeBoard(spec: NodeSpec) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "n", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "mineNode", def: nodeChar("MineNode"), owner: P1, zone: "play" },
      { key: "mineItem", def: nodeItem("MineItem"), owner: P1, zone: "play" },
      { key: "mineOther", def: character({ name: "MineOther" }), owner: P1, zone: "play" },
      { key: "theirNode", def: nodeChar("TheirNode"), owner: P2, zone: "play" },
      { key: "theirItem", def: nodeItem("TheirItem"), owner: P2, zone: "play" },
      { key: "theirOther", def: character({ name: "TheirOther" }), owner: P2, zone: "play" },
      { key: "theirThing", def: item({ name: "TheirThing", subtype: ["tool"] }), owner: P2, zone: "play" },
      { key: "nodeHand", def: nodeChar("NodeHand"), owner: P1, zone: "hand" },
      { key: "nodeDeck", def: nodeChar("NodeDeck"), owner: P1, zone: "deck" },
      { key: "nodeDisc", def: nodeChar("NodeDisc"), owner: P1, zone: "discard" },
      { key: "oppNodeHand", def: nodeChar("OppNodeHand"), owner: P2, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      {
        key: "exile",
        def: tactic({ name: "Exile", cost: 0, behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] } }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
}

function nodeWipesEveryOther(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  play(engine, P1, id("kill"), { selected: { t: [id("n")] } });
  assert.equal(zoneOf(engine, id("n")), "discard");
  for (const key of ["mineNode", "mineItem", "theirNode", "theirItem"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key} is a node card: destroyed`);
  for (const key of ["mineOther", "theirOther", "theirThing"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} is not a node: untouched`);
}

function nodeWipeIgnoresOtherZones(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  play(engine, P1, id("kill"), { selected: { t: [id("n")] } });
  assert.equal(zoneOf(engine, id("nodeHand")), "hand");
  assert.equal(zoneOf(engine, id("nodeDeck")), "deck");
  assert.equal(zoneOf(engine, id("nodeDisc")), "discard");
  assert.equal(zoneOf(engine, id("oppNodeHand")), "hand");
}

function nodeNoWipeWhenBounced(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  play(engine, P1, id("bounce"), { selected: { t: [id("n")] } });
  assert.equal(zoneOf(engine, id("n")), "hand");
  for (const key of ["mineNode", "mineItem", "theirNode", "theirItem"]) assert.equal(zoneOf(engine, id(key)), "play", `${key}: only 'destroyed' triggers it`);
}

function nodeNoWipeWhenRemoved(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  play(engine, P1, id("exile"), { selected: { t: [id("n")] } });
  assert.equal(zoneOf(engine, id("n")), "removed");
  for (const key of ["mineNode", "mineItem", "theirNode", "theirItem"]) assert.equal(zoneOf(engine, id(key)), "play", key);
}

function nodeWipesWhenKilledInBattle(spec: NodeSpec) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "n", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "mineNode", def: nodeChar("MineNode"), owner: P1, zone: "play" },
      { key: "theirNode", def: nodeChar("TheirNode"), owner: P2, zone: "play" },
      { key: "theirItem", def: nodeItem("TheirItem"), owner: P2, zone: "play" },
      { key: "mineOther", def: character({ name: "MineOther" }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Brute", strength: 12, life: 30, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  fight(engine, P1, [id("n")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(zoneOf(engine, id("n")), "discard", "killed in the battle");
  for (const key of ["mineNode", "theirNode", "theirItem"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key}`);
  assert.equal(zoneOf(engine, id("mineOther")), "play");
  assert.equal(zoneOf(engine, id("blk")), "play");
}

function nodeWipeIgnoresFaceDown(spec: NodeSpec) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "n", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "hidden", def: nodeChar("Hidden"), owner: P2, zone: "play", faceDown: true },
      { key: "visible", def: nodeChar("Visible"), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("n")] } });
  assert.equal(zoneOf(engine, id("visible")), "discard", "control: a face-up node is destroyed");
  assert.equal(zoneOf(engine, id("hidden")), "play", "a face-down card is a resource with no subtype: it is not a 'node card'");
}

function nodeWipeAlone(spec: NodeSpec) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "n", def: printing(spec.id), owner: P1, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "bystander", def: character({ name: "Bystander" }), owner: P2, zone: "play" }]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("n")] } });
  assert.equal(zoneOf(engine, id("n")), "discard");
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
}

// --- A Series of Tubes (UNIQUE)

function tubesPairBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "t1", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "t2", def: printing(TUBES), owner: P1, zone: "hand" },
      { key: "bystander", def: nodeChar("Bystander"), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      ...bank("elitism", 5, P1)
    ]
  });
}

for (const keep of ["t1", "t2"] as const) {
  clause(TUBES, "0:unique", `a second copy: its controller is asked which to keep (keeping ${keep === "t1" ? "the old" : "the new"} one); the other copy is destroyed`, () => {
    const { engine, id } = tubesPairBoard();
    play(engine, P1, id("t2"));
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates?: string[] };
    assert.equal(pc.kind, "uniqueSurvivor", "a 'keep one' choice is open");
    assert.equal(pc.playerId, P1, "its controller chooses");
    assert.deepEqual([...pc.candidates!].sort(), [id("t1"), id("t2")].sort());
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    const destroyed = keep === "t1" ? "t2" : "t1";
    assert.equal(zoneOf(engine, id(destroyed)), "discard", "the copy that was not kept is destroyed");
    assert.equal(engine.state.players[P1].play.filter((c) => engine.getDefinition(c).unique === "series of tubes").length <= 1, true, "never two copies in play");
  });
}

clause(TUBES, "0:unique", "the destroyed copy is destroyed like any Tubes: its 'if this card is destroyed' rule then destroys every other node card, including the kept copy", () => {
  const { engine, id } = tubesPairBoard();
  play(engine, P1, id("t2"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("t2") } } as never);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("t1")), "discard", "destroyed by UNIQUE");
  assert.equal(zoneOf(engine, id("bystander")), "discard", "another node card: destroyed by the dying Tubes");
  assert.equal(zoneOf(engine, id("t2")), "discard", "the kept Tubes is a node card too, so the dying copy takes it along");
  assert.equal(zoneOf(engine, id("plain")), "play");
});

clause(TUBES, "0:unique", "the 'keep' answer must name one of the copies", () => {
  const { engine, id } = tubesPairBoard();
  play(engine, P1, id("t2"));
  assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("bystander") } } as never));
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.ok(engine.state.pendingChoice, "still waiting for a real answer");
});

clause(TUBES, "0:unique", "a second copy in hand is no conflict until it enters play", () => {
  const { engine, id } = tubesPairBoard();
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("t1")), "play");
  assert.equal(zoneOf(engine, id("t2")), "hand");
});

clause(TUBES, "0:unique", "UNIQUE is per player: the opponent may control their own copy with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "t1", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "t2", def: printing(TUBES), owner: P2, zone: "hand" },
      ...bank("elitism", 5, P2)
    ]
  });
  play(engine, P2, id("t2"));
  assert.notEqual(engine.state.pendingChoice && (engine.state.pendingChoice as { kind: string }).kind, "uniqueSurvivor", "no 'keep one' choice");
  assert.equal(zoneOf(engine, id("t1")), "play");
  assert.equal(zoneOf(engine, id("t2")), "play");
});

// --- 1:rule  All other "node" characters gain 1 strength and 1 life

function tubesAuraBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "t", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "mine", def: nodeChar("MineNode", { strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "theirs", def: nodeChar("TheirNode", { strength: 3, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 2, speed: 2, subtype: ["lackey"] }), owner: P1, zone: "play" },
      { key: "multi", def: character({ name: "Multi", strength: 1, life: 1, speed: 1, subtype: ["majig", "node"] }), owner: P2, zone: "play" },
      { key: "nodeThing", def: nodeItem("NodeThing"), owner: P1, zone: "play" },
      ...extra
    ]
  });
}

clause(TUBES, "1:rule", "each of my other node characters gains exactly 1 strength and 1 life (2/2 -> 3/3), and nothing else changes", () => {
  const { engine, id } = tubesAuraBoard();
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  assert.equal(engine.getStat(id("mine"), "life"), 3);
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "speed is unchanged");
});

clause(TUBES, "1:rule", "'all other': the opponent's node characters gain +1/+1 too (3/4 -> 4/5)", () => {
  const { engine, id } = tubesAuraBoard();
  assert.equal(engine.getStat(id("theirs"), "strength"), 4);
  assert.equal(engine.getStat(id("theirs"), "life"), 5);
  assert.equal(engine.getStat(id("theirs"), "speed"), 1);
});

clause(TUBES, "1:rule", "a character with several subtypes including node also gains it", () => {
  const { engine, id } = tubesAuraBoard();
  assert.equal(engine.getStat(id("multi"), "strength"), 2);
  assert.equal(engine.getStat(id("multi"), "life"), 2);
});

clause(TUBES, "1:rule", "a character that is not a node is unaffected", () => {
  const { engine, id } = tubesAuraBoard();
  assert.equal(engine.getStat(id("plain"), "strength"), 2);
  assert.equal(engine.getStat(id("plain"), "life"), 2);
});

clause(TUBES, "1:rule", "'other': the Series of Tubes itself keeps its printed 5 / 5", () => {
  const { engine, id } = tubesAuraBoard();
  assert.equal(engine.getStat(id("t"), "strength"), 5);
  assert.equal(engine.getStat(id("t"), "life"), 5);
});

clause(TUBES, "1:rule", "a node ITEM is not a character: it has no strength or life to gain, and the bonus does not make it one", () => {
  const { engine, id } = tubesAuraBoard();
  assert.equal(engine.getCardTypes(id("nodeThing")).includes("character"), false);
});

clause(TUBES, "1:rule", "a face-down card is only a resource, not a node character: it is not a character and gains nothing", () => {
  const { engine, id } = tubesAuraBoard([{ key: "hidden", def: nodeChar("Hidden", { strength: 2, life: 2 }), owner: P1, zone: "play", faceDown: true }]);
  assert.equal(engine.getCardTypes(id("hidden")).includes("character"), false);
});

clause(TUBES, "1:rule", "a face-down card has no subtype (CR 411.1), so it is not a 'node' for anything", () => {
  const { engine, id } = tubesAuraBoard([{ key: "hidden", def: nodeChar("Hidden", { strength: 2, life: 2 }), owner: P1, zone: "play", faceDown: true }]);
  assert.equal(engine.getSubtypes(id("hidden")).includes("node"), false, "no subtype while face down");
});

clause(TUBES, "1:rule", "the bonus is per Tubes and not cumulative with itself: one Tubes gives +1, an opposing Tubes gives another +1 (each also boosts the other Tubes)", () => {
  const { engine, id } = tubesAuraBoard([{ key: "t2", def: printing(TUBES), owner: P2, zone: "play" }]);
  assert.equal(engine.getStat(id("mine"), "strength"), 4, "2 + 1 + 1");
  assert.equal(engine.getStat(id("mine"), "life"), 4);
  assert.equal(engine.getStat(id("t"), "strength"), 6, "my Tubes is an 'other node character' for their Tubes");
  assert.equal(engine.getStat(id("t2"), "life"), 6);
});

clause(TUBES, "1:rule", "the bonus ends when the Tubes leaves play", () => {
  const { engine, id } = tubesAuraBoard([{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  play(engine, P1, id("bounce"), { selected: { t: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "hand");
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
  assert.equal(engine.getStat(id("mine"), "life"), 2);
  assert.equal(engine.getStat(id("theirs"), "strength"), 3);
});

clause(TUBES, "1:rule", "a Tubes in hand gives nothing", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "t", def: printing(TUBES), owner: P1, zone: "hand" },
      { key: "mine", def: nodeChar("MineNode"), owner: P1, zone: "play" }
    ]
  });
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
});

clause(TUBES, "1:rule", "the bonus is real in battle: a node that took 3 damage survives with +1 life (2 life -> 3), and dies without (control)", () => {
  const run = (withTubes: boolean) => {
    const { engine, id } = warBoard(
      [
        ...(withTubes ? [{ key: "t", def: printing(TUBES), owner: P1, zone: "play" } as CardPlacement] : []),
        { key: "mine", def: nodeChar("MineNode", { strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" }
      ],
      [fighter("blk", P2, 2, 20, 2)]
    );
    fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, [id("blk")]);
    return { engine, id };
  };
  const control = run(false);
  assert.equal(zoneOf(control.engine, control.id("mine")), "discard", "control: 2 damage kills a 2-life node");
  const boosted = run(true);
  assert.equal(zoneOf(boosted.engine, boosted.id("mine")), "play", "with +1 life 2 damage does not");
});

// --- 2:rule  ETB search (A Series of Tubes)

clause(TUBES, "2:rule", "enters play for 5 and its controller may search for a node card", () => nodeOffersSearch(TUBES_SPEC));
clause(TUBES, "2:rule", "the chosen node card is put into your hand and revealed to everyone", () => nodeFindsAndReveals(TUBES_SPEC));
clause(TUBES, "2:rule", "a node item can be found too", () => nodeFindsAnItem(TUBES_SPEC));
clause(TUBES, "2:rule", "only a node card from your deck, and only one", () => nodeSearchRestrictions(TUBES_SPEC));
clause(TUBES, "2:rule", "'may': the search can be declined, with nothing taken or revealed", () => nodeSearchMayDecline(TUBES_SPEC));
clause(TUBES, "2:rule", "the deck is shuffled afterwards, whether a card was taken or not", () => nodeSearchShuffles(TUBES_SPEC));
clause(TUBES, "2:rule", "the opponent's deck and hand are untouched", () => nodeSearchLeavesOpponent(TUBES_SPEC));
clause(TUBES, "2:rule", "a search that finds no node card still shuffles the deck (CR 312.1)", () => nodeSearchFindsNothingShuffles(TUBES_SPEC));
clause(TUBES, "2:rule", "it searches only when THIS card enters play", () => nodeSearchOnlyOnSelf(TUBES_SPEC));
clause(TUBES, "2:rule", "the card itself: cost 5 with [E][E][E][E], printed 5 / 3 / 5", () => nodeCardItself(TUBES_SPEC, 4, { elitism: 3 }));

// --- 3:rule  destroyed: destroy all other node cards (A Series of Tubes)

clause(TUBES, "3:rule", "destroyed, it destroys every other node card in play (both players', characters and items); non-nodes stay", () => nodeWipesEveryOther(TUBES_SPEC));
clause(TUBES, "3:rule", "node cards in hand, deck and discard pile are not affected", () => nodeWipeIgnoresOtherZones(TUBES_SPEC));
clause(TUBES, "3:rule", "bounced to hand (not destroyed) it destroys nothing", () => nodeNoWipeWhenBounced(TUBES_SPEC));
clause(TUBES, "3:rule", "removed from the game (not destroyed) it destroys nothing", () => nodeNoWipeWhenRemoved(TUBES_SPEC));
clause(TUBES, "3:rule", "killed in battle it destroys all other node cards", () => nodeWipesWhenKilledInBattle(TUBES_SPEC));
clause(TUBES, "3:rule", "destroyed with no other node in play it just dies", () => nodeWipeAlone(TUBES_SPEC));
clause(TUBES, "3:rule", "a face-down card is not a 'node card' and is not destroyed", () => nodeWipeIgnoresFaceDown(TUBES_SPEC));

// --- Basic Node

clause(BASIC_NODE, "0:rule", "enters play for 1 and its controller may search for a node card", () => nodeOffersSearch(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "the chosen node card is put into your hand and revealed to everyone", () => nodeFindsAndReveals(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "a node item can be found too", () => nodeFindsAnItem(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "only a node card from your deck, and only one", () => nodeSearchRestrictions(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "'may': the search can be declined, with nothing taken or revealed", () => nodeSearchMayDecline(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "the deck is shuffled afterwards, whether a card was taken or not", () => nodeSearchShuffles(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "the opponent's deck and hand are untouched", () => nodeSearchLeavesOpponent(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "a search that finds no node card still shuffles the deck (CR 312.1)", () => nodeSearchFindsNothingShuffles(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "it searches only when THIS card enters play", () => nodeSearchOnlyOnSelf(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "the card itself: cost 1 with [E], printed 1 / 4 / 1", () => nodeCardItself(BASIC_SPEC, 1, { elitism: 0 }));
clause(BASIC_NODE, "1:rule", "destroyed, it destroys every other node card in play (both players', characters and items); non-nodes stay", () => nodeWipesEveryOther(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "node cards in hand, deck and discard pile are not affected", () => nodeWipeIgnoresOtherZones(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "bounced to hand (not destroyed) it destroys nothing", () => nodeNoWipeWhenBounced(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "removed from the game (not destroyed) it destroys nothing", () => nodeNoWipeWhenRemoved(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "killed in battle it destroys all other node cards", () => nodeWipesWhenKilledInBattle(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "destroyed with no other node in play it just dies", () => nodeWipeAlone(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "a face-down card is not a 'node card' and is not destroyed", () => nodeWipeIgnoresFaceDown(BASIC_SPEC));

// --- Hub Node

clause(HUB_NODE, "0:rule", "enters play for 3 and its controller may search for a node card", () => nodeOffersSearch(HUB_SPEC));
clause(HUB_NODE, "0:rule", "the chosen node card is put into your hand and revealed to everyone", () => nodeFindsAndReveals(HUB_SPEC));
clause(HUB_NODE, "0:rule", "a node item can be found too", () => nodeFindsAnItem(HUB_SPEC));
clause(HUB_NODE, "0:rule", "only a node card from your deck, and only one", () => nodeSearchRestrictions(HUB_SPEC));
clause(HUB_NODE, "0:rule", "'may': the search can be declined, with nothing taken or revealed", () => nodeSearchMayDecline(HUB_SPEC));
clause(HUB_NODE, "0:rule", "the deck is shuffled afterwards, whether a card was taken or not", () => nodeSearchShuffles(HUB_SPEC));
clause(HUB_NODE, "0:rule", "the opponent's deck and hand are untouched", () => nodeSearchLeavesOpponent(HUB_SPEC));
clause(HUB_NODE, "0:rule", "a search that finds no node card still shuffles the deck (CR 312.1)", () => nodeSearchFindsNothingShuffles(HUB_SPEC));
clause(HUB_NODE, "0:rule", "it searches only when THIS card enters play", () => nodeSearchOnlyOnSelf(HUB_SPEC));
clause(HUB_NODE, "0:rule", "the card itself: cost 3 with [E][E], printed 2 / 3 / 2 when alone", () => nodeCardItself(HUB_SPEC, 2, { elitism: 1 }));
clause(HUB_NODE, "1:rule", "destroyed, it destroys every other node card in play (both players', characters and items); non-nodes stay", () => nodeWipesEveryOther(HUB_SPEC));
clause(HUB_NODE, "1:rule", "node cards in hand, deck and discard pile are not affected", () => nodeWipeIgnoresOtherZones(HUB_SPEC));
clause(HUB_NODE, "1:rule", "bounced to hand (not destroyed) it destroys nothing", () => nodeNoWipeWhenBounced(HUB_SPEC));
clause(HUB_NODE, "1:rule", "removed from the game (not destroyed) it destroys nothing", () => nodeNoWipeWhenRemoved(HUB_SPEC));
clause(HUB_NODE, "1:rule", "killed in battle it destroys all other node cards", () => nodeWipesWhenKilledInBattle(HUB_SPEC));
clause(HUB_NODE, "1:rule", "destroyed with no other node in play it just dies", () => nodeWipeAlone(HUB_SPEC));
clause(HUB_NODE, "1:rule", "a face-down card is not a 'node card' and is not destroyed", () => nodeWipeIgnoresFaceDown(HUB_SPEC));

// --- 4:ability:redirect  (A Series of Tubes)

function redirectBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "t", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "n", def: nodeChar("MineNode", { strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "m", def: nodeChar("MineNode2", { strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "f", def: nodeChar("FoeNode", { strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: nodeItem("NodeThing"), owner: P1, zone: "play" },
      { key: "smite1", def: damageTactic(1), owner: P1, zone: "hand" },
      { key: "smite2", def: damageTactic(2), owner: P1, zone: "hand" },
      { key: "smite3", def: damageTactic(3), owner: P1, zone: "hand" },
      ...extra
    ]
  });
}

const redirectTo = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, targetKey: string, player: Pid = P1) =>
  engine.perform({ type: "activateAbility", playerId: player, cardId: id("t"), abilityId: "redirect", selected: { c: [id(targetKey)] }, variables: {} } as never);
const useRedirect = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, targetKey: string) => {
  redirectTo(engine, id, targetKey);
  resolvePendingResponses(engine);
};
const smite = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, tacticKey: string, targetKey: string) =>
  play(engine, P1, id(tacticKey), { selected: { t: [id(targetKey)] } });
const damageOn = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, key: string) => engine.state.cards[id(key)].damage;

clause(TUBES, "4:ability:redirect", "control: without REDIRECT a 3-damage hit lands entirely on the node", () => {
  const { engine, id } = redirectBoard();
  smite(engine, id, "smite3", "n");
  assert.equal(damageOn(engine, id, "n"), 3);
  assert.equal(damageOn(engine, id, "t"), 0);
});

clause(TUBES, "4:ability:redirect", "the NEXT 1 damage to the picked node is inflicted to the Tubes instead: of a 3-damage hit, 1 goes to the Tubes and 2 stay on the node", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  smite(engine, id, "smite3", "n");
  assert.equal(damageOn(engine, id, "n"), 2, "3 - 1 redirected");
  assert.equal(damageOn(engine, id, "t"), 1, "the Tubes took the 1");
});

clause(TUBES, "4:ability:redirect", "a 1-damage hit is entirely redirected: the node takes nothing", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  smite(engine, id, "smite1", "n");
  assert.equal(damageOn(engine, id, "n"), 0);
  assert.equal(damageOn(engine, id, "t"), 1);
});

clause(TUBES, "4:ability:redirect", "it is 'the next 1 damage' only: once used, a later hit lands on the node in full", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  smite(engine, id, "smite1", "n");
  smite(engine, id, "smite2", "n");
  assert.equal(damageOn(engine, id, "n"), 2, "the second hit is not redirected");
  assert.equal(damageOn(engine, id, "t"), 1, "the Tubes still has only the first 1");
});

clause(TUBES, "4:ability:redirect", "only the picked character: damage to another node is not redirected, and the shield stays for the picked one", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  smite(engine, id, "smite2", "m");
  assert.equal(damageOn(engine, id, "m"), 2, "the other node takes its full damage");
  assert.equal(damageOn(engine, id, "t"), 0);
  smite(engine, id, "smite1", "n");
  assert.equal(damageOn(engine, id, "n"), 0, "the shield on the picked node was still there");
  assert.equal(damageOn(engine, id, "t"), 1);
});

clause(TUBES, "4:ability:redirect", "two uses on the same node protect against 2 damage in total (3 damage: 1 + 1 redirected, 1 left on the node)", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  useRedirect(engine, id, "n");
  smite(engine, id, "smite3", "n");
  assert.equal(damageOn(engine, id, "t"), 2);
  assert.equal(damageOn(engine, id, "n"), 1);
});

clause(TUBES, "4:ability:redirect", "it works on the OPPONENT's node character too ('a node character'): the damage lands on my Tubes", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "f");
  smite(engine, id, "smite2", "f");
  assert.equal(damageOn(engine, id, "f"), 1);
  assert.equal(damageOn(engine, id, "t"), 1);
});

clause(TUBES, "4:ability:redirect", "the shield has no 'this turn': it is still waiting a turn later", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  smite(engine, id, "smite1", "n");
  assert.equal(damageOn(engine, id, "n"), 0);
  assert.equal(damageOn(engine, id, "t"), 1);
});

clause(TUBES, "4:ability:redirect", "only a NODE character can be picked: a non-node character, a node item, a faction and a face-down card are refused", () => {
  const { engine, id } = redirectBoard([{ key: "hidden", def: nodeChar("Hidden"), owner: P1, zone: "play", faceDown: true }]);
  assert.throws(() => redirectTo(engine, id, "plain"), "a non-node character");
  assert.throws(() => redirectTo(engine, id, "thing"), "a node item is not a character");
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("t"), abilityId: "redirect", selected: { c: [engine.state.players[P2].factionId!] }, variables: {} } as never), "a faction");
  assert.throws(() => redirectTo(engine, id, "hidden"), "a face-down card is not a character");
  redirectTo(engine, id, "n");
  assert.ok(engine.state.responseWindow, "a node character is accepted");
});

clause(TUBES, "4:ability:redirect", "exactly one node character must be picked", () => {
  const { engine, id } = redirectBoard();
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("t"), abilityId: "redirect", selected: { c: [] }, variables: {} } as never));
  assert.throws(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("t"), abilityId: "redirect", selected: { c: [id("n"), id("m")] }, variables: {} } as never));
});

clause(TUBES, "4:ability:redirect", "it costs nothing: no resources are paid and the Tubes does not deplete (usable even when depleted)", () => {
  const { engine, id } = redirectBoard([...bank("elitism", 3, P1)]);
  engine.state.cards[id("t")].depleted = true;
  const before = readyCount(engine, P1);
  useRedirect(engine, id, "n");
  assert.equal(readyCount(engine, P1), before, "no resources paid");
  assert.equal(engine.state.cards[id("t")].depleted, true, "it was already depleted and that did not matter");
  smite(engine, id, "smite1", "n");
  assert.equal(damageOn(engine, id, "t"), 1);
});

clause(TUBES, "4:ability:redirect", "the opponent cannot use it", () => {
  const { engine, id } = redirectBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => redirectTo(engine, id, "f", P2));
});

clause(TUBES, "4:ability:redirect", "it works against battle damage: a node blocking a 3-strength attacker takes 2, the Tubes 1", () => {
  const { engine, id } = redirectBoard([{ key: "atk", def: character({ name: "Attacker", strength: 3, life: 20, speed: 2 }), owner: P2, zone: "play" }]);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlock(engine, P1, [id("n")]);
  passUntil(engine, P1);
  redirectTo(engine, id, "n");
  resolvePendingResponses(engine);
  resolveSending(engine, { [id("atk")]: id("n") });
  assert.equal(damageOn(engine, id, "n"), 2);
  assert.equal(damageOn(engine, id, "t"), 1);
});

clause(TUBES, "4:ability:redirect", "the Tubes really takes the damage: if that is lethal it is destroyed and its destroy-all-nodes rule fires", () => {
  const { engine, id } = redirectBoard();
  engine.state.cards[id("t")].damage = 4;
  useRedirect(engine, id, "n");
  smite(engine, id, "smite1", "n");
  assert.equal(zoneOf(engine, id("t")), "discard", "5 damage on a 5-life Tubes");
  assert.equal(zoneOf(engine, id("n")), "discard", "every other node card is destroyed");
  assert.equal(zoneOf(engine, id("m")), "discard");
  assert.equal(zoneOf(engine, id("f")), "discard");
  assert.equal(zoneOf(engine, id("plain")), "play");
});

// --- Hub Node 2:rule  gains 1 strength and 1 life for each other node card in play

function hubBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "hub", def: printing(HUB_NODE), owner: P1, zone: "play" }, ...extra]
  });
}
const hubStats = (engine: SpoilsEngine, id: (key: string) => CardInstanceId) => [engine.getStat(id("hub"), "strength"), engine.getStat(id("hub"), "life"), engine.getStat(id("hub"), "speed")];

clause(HUB_NODE, "2:rule", "alone it has its printed 2 / 2 / speed 3", () => {
  const { engine, id } = hubBoard();
  assert.deepEqual(hubStats(engine, id), [2, 2, 3]);
});

clause(HUB_NODE, "2:rule", "with one other node of mine in play: +1 strength, +1 life (3 / 3)", () => {
  const { engine, id } = hubBoard([{ key: "a", def: nodeChar("A"), owner: P1, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [3, 3, 3], "speed is unchanged");
});

clause(HUB_NODE, "2:rule", "one more for each other node: three others give +3 / +3", () => {
  const { engine, id } = hubBoard([
    { key: "a", def: nodeChar("A"), owner: P1, zone: "play" },
    { key: "b", def: nodeChar("B"), owner: P1, zone: "play" },
    { key: "c", def: nodeChar("C"), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(hubStats(engine, id), [5, 5, 3]);
});

clause(HUB_NODE, "2:rule", "the opponent's node cards count too ('each other node card in play')", () => {
  const { engine, id } = hubBoard([{ key: "a", def: nodeChar("A"), owner: P2, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [3, 3, 3]);
});

clause(HUB_NODE, "2:rule", "node cards that are not characters count too (a node item)", () => {
  const { engine, id } = hubBoard([{ key: "a", def: nodeItem("A"), owner: P1, zone: "play" }, { key: "b", def: nodeItem("B"), owner: P2, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [4, 4, 3]);
});

clause(HUB_NODE, "2:rule", "cards that are not nodes do not count", () => {
  const { engine, id } = hubBoard([
    { key: "a", def: character({ name: "A", subtype: ["lackey"] }), owner: P1, zone: "play" },
    { key: "b", def: item({ name: "B", subtype: ["tool"] }), owner: P2, zone: "play" },
    { key: "c", def: location({ name: "C", subtype: [] }), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(hubStats(engine, id), [2, 2, 3]);
});

clause(HUB_NODE, "2:rule", "node cards in hand, deck and discard pile do not count (only 'in play')", () => {
  const { engine, id } = hubBoard([
    { key: "a", def: nodeChar("A"), owner: P1, zone: "hand" },
    { key: "b", def: nodeChar("B"), owner: P1, zone: "deck" },
    { key: "c", def: nodeChar("C"), owner: P1, zone: "discard" },
    { key: "d", def: nodeChar("D"), owner: P2, zone: "hand" }
  ]);
  assert.deepEqual(hubStats(engine, id), [2, 2, 3]);
});

clause(HUB_NODE, "2:rule", "a face-down node card is a resource, not a node card: it is not counted", () => {
  const { engine, id } = hubBoard([{ key: "hidden", def: nodeChar("Hidden"), owner: P2, zone: "play", faceDown: true }]);
  assert.deepEqual(hubStats(engine, id), [2, 2, 3]);
});

clause(HUB_NODE, "2:rule", "it does not count itself: two Hub Nodes each count the other (+1 each)", () => {
  const { engine, id } = hubBoard([{ key: "hub2", def: printing(HUB_NODE), owner: P2, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [3, 3, 3]);
  assert.equal(engine.getStat(id("hub2"), "strength"), 3);
});

clause(HUB_NODE, "2:rule", "it is live: when a counted node leaves play the bonus shrinks", () => {
  const { engine, id } = hubBoard([
    { key: "a", def: nodeChar("A"), owner: P1, zone: "play" },
    { key: "b", def: nodeChar("B"), owner: P2, zone: "play" },
    { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }
  ]);
  assert.deepEqual(hubStats(engine, id), [4, 4, 3]);
  play(engine, P1, id("bounce"), { selected: { t: [id("b")] } });
  assert.deepEqual(hubStats(engine, id), [3, 3, 3]);
});

clause(HUB_NODE, "2:rule", "it only changes the Hub Node itself: another node's stats are untouched by it", () => {
  const { engine, id } = hubBoard([{ key: "a", def: nodeChar("A", { strength: 2, life: 2 }), owner: P1, zone: "play" }]);
  assert.equal(engine.getStat(id("a"), "strength"), 2, "a plain node next to the Hub Node gets no bonus");
  assert.equal(engine.getStat(id("a"), "life"), 2);
});

clause(HUB_NODE, "2:rule", "with an A Series of Tubes in play the Hub Node gets the Tubes' +1/+1 AND counts the Tubes (2 + 1 + 1 = 4)", () => {
  const { engine, id } = hubBoard([{ key: "tubes", def: printing(TUBES), owner: P1, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [4, 4, 3]);
});

clause(HUB_NODE, "2:rule", "the bonus is real in battle: a Hub Node with two other nodes (4 / 4) survives 3 damage that would kill the printed 2-life card", () => {
  const { engine, id } = warBoard(
    [
      { key: "hub", def: printing(HUB_NODE), owner: P1, zone: "play" },
      { key: "a", def: nodeChar("A"), owner: P1, zone: "play" },
      { key: "b", def: nodeChar("B"), owner: P2, zone: "play" }
    ],
    [fighter("blk", P2, 3, 30, 2)]
  );
  fight(engine, P1, [id("hub")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(zoneOf(engine, id("hub")), "play");
  assert.equal(engine.state.cards[id("hub")].damage, 3);
  assert.equal(engine.state.cards[id("blk")].damage, 4, "its strength is 2 + 2 = 4");
});

// =============================================================================
// Devastating Mockery
// COST: Pick a character. EFFECT: If the character is COVERT, it loses COVERT
// this turn. Draw a card.
// Tactic, cost 2, threshold [E].
// =============================================================================

const MOCKERY = "e20aa8eb-b25d-4ab4-b4fd-95652496d12c";

const covertChar = (name: string, over: Partial<CardDefinition> = {}): CardDefinition =>
  character({ name, strength: 2, life: 5, speed: 2, behavior: { keywords: ["covert"] }, ...over });
const grantCovertTactic = (): CardDefinition =>
  tactic({
    name: "Cloak",
    cost: 0,
    behavior: { abilities: [{ id: "cloak", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }] }] }
  });

function mockeryBoard(opts: { elitism?: number; rage?: number; deck?: number; extra?: CardPlacement[]; turn?: number; active?: Pid; mockeryOwner?: Pid } = {}) {
  const owner = opts.mockeryOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "dm", def: printing(MOCKERY), owner, zone: "hand" },
      { key: "mineCovert", def: covertChar("MineCovert"), owner: P1, zone: "play" },
      { key: "minePlain", def: character({ name: "MinePlain", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foeCovert", def: covertChar("FoeCovert"), owner: P2, zone: "play" },
      { key: "foePlain", def: character({ name: "FoePlain", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: covertChar("Hidden"), owner: P2, zone: "play", faceDown: true },
      ...Array.from({ length: opts.deck ?? 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: other(owner), zone: "deck" as const })),
      ...bank("elitism", opts.elitism ?? 2, owner),
      ...bank("rage", opts.rage ?? 0, owner),
      ...(opts.extra ?? [])
    ]
  });
}

const playMockery = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, targetKey: string, player: Pid = P1) =>
  play(engine, player, id("dm"), { selected: { c: [id(targetKey)] } });

clause(MOCKERY, "0:ability", "a COVERT opposing character loses COVERT", () => {
  const { engine, id } = mockeryBoard();
  assert.ok(hasKeyword(engine, id("foeCovert"), "covert"), "(setup check)");
  playMockery(engine, id, "foeCovert");
  assert.equal(hasKeyword(engine, id("foeCovert"), "covert"), false);
});

clause(MOCKERY, "0:ability", "a COVERT character of mine loses COVERT too", () => {
  const { engine, id } = mockeryBoard();
  playMockery(engine, id, "mineCovert");
  assert.equal(hasKeyword(engine, id("mineCovert"), "covert"), false);
});

clause(MOCKERY, "0:ability", "a character that is not COVERT is unchanged (no COVERT, no other change), and the card still draws", () => {
  const { engine, id } = mockeryBoard();
  const top = engine.state.players[P1].deck[0];
  playMockery(engine, id, "foePlain");
  assert.equal(hasKeyword(engine, id("foePlain"), "covert"), false);
  assert.deepEqual(engine.getKeywords(id("foePlain")), []);
  assert.equal(zoneOf(engine, top), "hand", "'Draw a card' is not conditional");
});

clause(MOCKERY, "0:ability", "only the picked character: every other COVERT character keeps COVERT", () => {
  const { engine, id } = mockeryBoard();
  playMockery(engine, id, "foeCovert");
  assert.ok(hasKeyword(engine, id("mineCovert"), "covert"), "hasKeyword(engine, id(\"mineCovert\"), \"covert\")");
});

clause(MOCKERY, "0:ability", "only COVERT is lost: another keyword on the same character stays", () => {
  const { engine, id } = mockeryBoard({
    extra: [{ key: "both", def: character({ name: "Both", behavior: { keywords: ["covert", "aggro"] } }), owner: P2, zone: "play" }]
  });
  playMockery(engine, id, "both");
  assert.equal(hasKeyword(engine, id("both"), "covert"), false);
  assert.ok(hasKeyword(engine, id("both"), "aggro"), "AGGRO is kept");
});

clause(MOCKERY, "0:ability", "COVERT that comes from an attached item (not printed on the character) is lost as well", () => {
  const cloak = item({
    name: "CloakItem",
    attachTo: "character",
    behavior: { abilities: [{ id: "grant", type: "continuous", modifiers: [], keywords: [{ target: "attachedTo", keyword: "covert" }] }] }
  });
  const { engine, id } = mockeryBoard({ extra: [{ key: "cloak", def: cloak, owner: P2, zone: "play", attachedToKey: "foePlain" }] });
  assert.ok(hasKeyword(engine, id("foePlain"), "covert"), "(setup check) the item grants COVERT");
  playMockery(engine, id, "foePlain");
  assert.equal(hasKeyword(engine, id("foePlain"), "covert"), false, "it loses COVERT whatever the source");
});

clause(MOCKERY, "0:ability", "'this turn': the character is COVERT again once the turn ends", () => {
  const { engine, id } = mockeryBoard({ turn: 1 });
  playMockery(engine, id, "foeCovert");
  assert.equal(hasKeyword(engine, id("foeCovert"), "covert"), false);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.ok(hasKeyword(engine, id("foeCovert"), "covert"), "back at the end of the turn");
});

clause(MOCKERY, "0:ability", "it keeps losing COVERT for the whole turn: COVERT granted later the same turn does not bring it back ('lose beats grant')", () => {
  const { engine, id } = mockeryBoard({ extra: [{ key: "cloak", def: grantCovertTactic(), owner: P1, zone: "hand" }] });
  playMockery(engine, id, "foeCovert");
  play(engine, P1, id("cloak"), { selected: { t: [id("foeCovert")] } });
  assert.equal(hasKeyword(engine, id("foeCovert"), "covert"), false);
});

clause(MOCKERY, "0:ability", "it is real in battle: a COVERT attacker of mine can be blocked by an ordinary character once Mockery is played on it", () => {
  const withoutDm = mockeryBoard();
  declareAttackBy(withoutDm.engine, P1, [withoutDm.id("mineCovert")]);
  assert.throws(() => declareBlock(withoutDm.engine, P2, [withoutDm.id("foePlain")]), "control: an ordinary character cannot block a COVERT party");
  const { engine, id } = mockeryBoard();
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mineCovert")], target: { type: "faction", playerId: P2 } });
  playMockery(engine, id, "mineCovert");
  resolvePendingResponses(engine);
  declareBlock(engine, P2, [id("foePlain")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foePlain")], "no longer a covert party");
});

clause(MOCKERY, "0:ability", "it is real in battle: a COVERT blocker that lost COVERT can block an ordinary attacker (control: with COVERT it cannot)", () => {
  const control = mockeryBoard();
  declareAttackBy(control.engine, P1, [control.id("minePlain")]);
  assert.throws(() => declareBlock(control.engine, P2, [control.id("foeCovert")]), "control: a COVERT character blocks only COVERT parties");
  const { engine, id } = mockeryBoard();
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("minePlain")], target: { type: "faction", playerId: P2 } });
  playMockery(engine, id, "foeCovert");
  resolvePendingResponses(engine);
  declareBlock(engine, P2, [id("foeCovert")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foeCovert")]);
});

clause(MOCKERY, "0:ability", "the opponent can play it on my COVERT attacker in their response window (their own Mockery, their own resources)", () => {
  const { engine, id } = mockeryBoard({ mockeryOwner: P2 });
  attackUntilDefenderMayRespond(engine, P1, [id("mineCovert")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  const before = readyCount(engine, P2);
  playMockery(engine, id, "mineCovert", P2);
  assert.equal(before - readyCount(engine, P2), 2);
  declareBlock(engine, P2, [id("foePlain")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foePlain")]);
});

clause(MOCKERY, "0:ability", "you draw a card (the top of YOUR deck), the opponent draws nothing", () => {
  const { engine, id } = mockeryBoard();
  const top = engine.state.players[P1].deck[0];
  const oppDeck = [...engine.state.players[P2].deck];
  const handBefore = handOf(engine, P1).length;
  playMockery(engine, id, "foeCovert");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
});

clause(MOCKERY, "0:ability", "with an empty deck the effect still happens", () => {
  const { engine, id } = mockeryBoard({ deck: 0 });
  playMockery(engine, id, "foeCovert");
  assert.equal(hasKeyword(engine, id("foeCovert"), "covert"), false);
  assert.equal(zoneOf(engine, id("dm")), "discard");
});

clause(MOCKERY, "0:ability", "pays exactly 2 and the tactic goes to its owner's discard pile", () => {
  const { engine, id } = mockeryBoard({ elitism: 5 });
  const before = readyCount(engine, P1);
  playMockery(engine, id, "foeCovert");
  assert.equal(before - readyCount(engine, P1), 2);
  assert.equal(zoneOf(engine, id("dm")), "discard");
});

clause(MOCKERY, "0:ability", "only a character can be picked: an item, a location, a faction and a face-down card are refused", () => {
  const { engine, id } = mockeryBoard();
  assert.throws(() => playMockery(engine, id, "gadget"), "item");
  assert.throws(() => playMockery(engine, id, "place"), "location");
  assert.throws(() => play(engine, P1, id("dm"), { selected: { c: [engine.state.players[P2].factionId!] } }), "faction");
  assert.throws(() => playMockery(engine, id, "hidden"), "face-down resource");
  assert.equal(zoneOf(engine, id("dm")), "hand");
  assert.equal(readyCount(engine, P1), 2);
});

clause(MOCKERY, "0:ability", "exactly one character must be picked", () => {
  const { engine, id } = mockeryBoard();
  assert.throws(() => playRaw(engine, P1, id("dm"), { selected: { c: [] } }));
  assert.throws(() => playRaw(engine, P1, id("dm"), { selected: { c: [id("foeCovert"), id("mineCovert")] } }));
});

clause(MOCKERY, "0:ability", "is refused one resource short of 2, and without [E] even with plenty of other resources", () => {
  const short = mockeryBoard({ elitism: 1 });
  assert.throws(() => playRaw(short.engine, P1, short.id("dm"), { selected: { c: [short.id("foeCovert")] } }));
  const noThreshold = mockeryBoard({ elitism: 0, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("dm"), { selected: { c: [noThreshold.id("foeCovert")] } }), "no [E]");
  const exact = mockeryBoard({ elitism: 1, rage: 1 });
  playMockery(exact.engine, exact.id, "foeCovert");
  assert.equal(hasKeyword(exact.engine, exact.id("foeCovert"), "covert"), false, "one [E] and 2 resources is enough");
});

// =============================================================================
// Epiphanal Mechanic
// DEVELOPMENT -- COST: Deplete this card. EFFECT: Search your deck for an item,
// reveal it, and put it into your hand.
// DEPLOYMENT -- COST: Deplete this card. EFFECT: You may play an item for free.
// (You still need the proper resource icons and must pay any additional costs.)
// Character, cost 9, threshold [E][E], 1 / 3 / 1.
// =============================================================================

const MECHANIC = "dd3b2a43-ee3e-432f-86ef-0b3064abf691";

function mechanicBoard(opts: { depleted?: boolean; noItemsInDeck?: boolean; extra?: CardPlacement[]; handItems?: boolean } = {}) {
  const deckItems: CardPlacement[] = opts.noItemsInDeck
    ? []
    : [
        { key: "itemA", def: item({ name: "ItemA", cost: 2 }), owner: P1, zone: "deck" },
        { key: "itemB", def: item({ name: "ItemB", cost: 9 }), owner: P1, zone: "deck" }
      ];
  const handItems: CardPlacement[] =
    opts.handItems === false
      ? []
      : [
          { key: "hItem", def: item({ name: "HandItem", cost: 4 }), owner: P1, zone: "hand" },
          { key: "hBig", def: item({ name: "HandBig", cost: 9 }), owner: P1, zone: "hand" },
          { key: "hRage", def: item({ name: "HandRage", cost: 1, threshold: "rr" }), owner: P1, zone: "hand" },
          { key: "hCostly", def: item({ name: "HandCostly", cost: 5, behavior: { onPlay: { costs: [{ type: "loseInfluence", amount: 2 }] } } }), owner: P1, zone: "hand" }
        ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "mech", def: printing(MECHANIC), owner: P1, zone: "play", depleted: opts.depleted ?? false },
      ...deckItems,
      { key: "deckLoc", def: location({ name: "DeckLoc" }), owner: P1, zone: "deck" },
      { key: "deckChar", def: character({ name: "DeckChar" }), owner: P1, zone: "deck" },
      { key: "deckTac", def: drawTactic("DeckTac", 1), owner: P1, zone: "deck" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner: P1, zone: "deck" as const })),
      ...handItems,
      { key: "hChar", def: character({ name: "HandChar", cost: 2 }), owner: P1, zone: "hand" },
      { key: "hLoc", def: location({ name: "HandLoc", cost: 3 }), owner: P1, zone: "hand" },
      { key: "hTac", def: drawTactic("HandTac", 1), owner: P1, zone: "hand" },
      { key: "discItem", def: item({ name: "DiscItem", cost: 1 }), owner: P1, zone: "discard" },
      { key: "oppItem", def: item({ name: "OppItem", cost: 1 }), owner: P2, zone: "deck" },
      { key: "oppItemHand", def: item({ name: "OppItemHand", cost: 1 }), owner: P2, zone: "hand" },
      { key: "oppFiller", def: character({ name: "OppFiller" }), owner: P2, zone: "deck" },
      ...(opts.extra ?? [])
    ]
  });
}

const useMechanic = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, abilityId: "development" | "deployment", player: Pid = P1) =>
  activate(engine, player, id("mech"), abilityId);

// --- DEVELOPMENT

clause(MECHANIC, "0:ability:development", "depletes the Mechanic as its cost, and its controller may search for an item", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "development");
  assert.equal(engine.state.cards[id("mech")].depleted, true, "COST: deplete this card");
  assert.equal(searchChoice(engine)?.kind, "chooserSelectsTarget");
  assert.equal(searchChoice(engine)?.playerId, P1);
});

clause(MECHANIC, "0:ability:development", "the chosen item goes to your hand (not into play) and is revealed to everyone", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "development");
  searchPick(engine, P1, [id("itemB")])();
  assert.equal(zoneOf(engine, id("itemB")), "hand");
  assert.ok(handOf(engine, P1).includes(id("itemB")), "handOf(engine, P1).includes(id(\"itemB\"))");
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1);
  const event = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(event.cardIds, [id("itemB")]);
  assert.equal(event.viewerId, "all");
});

clause(MECHANIC, "0:ability:development", "any item will do, whatever its cost (cost 2 and cost 9)", () => {
  for (const key of ["itemA", "itemB"]) {
    const { engine, id } = mechanicBoard();
    useMechanic(engine, id, "development");
    searchPick(engine, P1, [id(key)])();
    assert.equal(zoneOf(engine, id(key)), "hand", key);
  }
});

clause(MECHANIC, "0:ability:development", "only an ITEM: a location, a character and a tactic in the deck are refused", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "development");
  assert.throws(searchPick(engine, P1, [id("deckLoc")]), "location");
  assert.throws(searchPick(engine, P1, [id("deckChar")]), "character");
  assert.throws(searchPick(engine, P1, [id("deckTac")]), "tactic");
  assert.ok(searchChoice(engine), "still waiting for a legal pick");
});

clause(MECHANIC, "0:ability:development", "only from YOUR DECK: an item in hand, the discard pile or the opponent's deck is refused", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "development");
  assert.throws(searchPick(engine, P1, [id("hItem")]), "hand");
  assert.throws(searchPick(engine, P1, [id("discItem")]), "discard");
  assert.throws(searchPick(engine, P1, [id("oppItem")]), "the opponent's deck");
});

clause(MECHANIC, "0:ability:development", "only one item", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "development");
  assert.throws(searchPick(engine, P1, [id("itemA"), id("itemB")]));
  assert.equal(zoneOf(engine, id("itemA")), "deck");
});

clause(MECHANIC, "0:ability:development", "the search can be declined, but the Mechanic stays depleted (the cost was paid)", () => {
  const { engine, id } = mechanicBoard();
  const handBefore = [...handOf(engine, P1)];
  useMechanic(engine, id, "development");
  searchPick(engine, P1, [])();
  assert.deepEqual(handOf(engine, P1), handBefore);
  assert.equal(engine.state.cards[id("mech")].depleted, true);
  assert.equal(revealEvents(engine).length, 0);
});

clause(MECHANIC, "0:ability:development", "the deck is shuffled afterwards, whether an item was taken or not", () => {
  const taken = mechanicBoard();
  useMechanic(taken.engine, taken.id, "development");
  const before = taken.engine.state.players[P1].deck.filter((c) => c !== taken.id("itemA"));
  searchPick(taken.engine, P1, [taken.id("itemA")])();
  sameCards(taken.engine.state.players[P1].deck, before);
  assert.notDeepEqual(taken.engine.state.players[P1].deck, before, "shuffled after taking an item");
  const declined = mechanicBoard();
  useMechanic(declined.engine, declined.id, "development");
  const beforeDeclined = [...declined.engine.state.players[P1].deck];
  searchPick(declined.engine, P1, [])();
  sameCards(declined.engine.state.players[P1].deck, beforeDeclined);
  assert.notDeepEqual(declined.engine.state.players[P1].deck, beforeDeclined, "shuffled after declining");
});

clause(MECHANIC, "0:ability:development", "a search that finds no item still shuffles the deck (CR 312.1)", () => {
  const { engine, id } = mechanicBoard({ noItemsInDeck: true });
  const before = [...engine.state.players[P1].deck];
  useMechanic(engine, id, "development");
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("mech")].depleted, true, "(the cost was paid)");
  const after = engine.state.players[P1].deck;
  sameCards(after, before);
  assert.notDeepEqual(after, before, "searched and found nothing: shuffled anyway");
});

clause(MECHANIC, "0:ability:development", "the opponent's deck and hand are untouched", () => {
  const { engine, id } = mechanicBoard();
  const oppDeck = [...engine.state.players[P2].deck];
  const oppHand = [...handOf(engine, P2)];
  useMechanic(engine, id, "development");
  searchPick(engine, P1, [id("itemA")])();
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(MECHANIC, "0:ability:development", "a depleted Mechanic cannot use it", () => {
  const { engine, id } = mechanicBoard({ depleted: true });
  assert.throws(() => useMechanic(engine, id, "development"));
  assert.equal(zoneOf(engine, id("itemA")), "deck");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MECHANIC, "0:ability:development", "it costs no resources", () => {
  const { engine, id } = mechanicBoard({ extra: bank("elitism", 3, P1) });
  useMechanic(engine, id, "development");
  assert.equal(readyCount(engine, P1), 3);
});

clause(MECHANIC, "0:ability:development", "the opponent cannot use it", () => {
  const { engine, id } = mechanicBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => useMechanic(engine, id, "development", P2));
  assert.equal(engine.state.cards[id("mech")].depleted, false);
});

clause(MECHANIC, "0:ability:development", "after DEVELOPMENT the Mechanic is depleted, so DEPLOYMENT cannot be used the same turn", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "development");
  searchPick(engine, P1, [id("itemA")])();
  assert.throws(() => useMechanic(engine, id, "deployment"));
});

clause(MECHANIC, "0:ability:development", "the card itself: cost 9 with [E][E], printed 1 / 3 / 1, and its abilities work the turn it enters play", () => {
  const mk = (elitism: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "mech", def: printing(MECHANIC), owner: P1, zone: "hand" },
        { key: "itemA", def: item({ name: "ItemA" }), owner: P1, zone: "deck" },
        ...bank("elitism", elitism, P1),
        ...bank("rage", rage, P1)
      ]
    });
  const short = mk(8, 0);
  assert.throws(() => playRaw(short.engine, P1, short.id("mech")), "8 is one short of 9");
  const noThreshold = mk(1, 9);
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("mech")), "one [E] is short of [E][E]");
  const ok = mk(2, 7);
  play(ok.engine, P1, ok.id("mech"));
  assert.equal(ok.engine.getStat(ok.id("mech"), "strength"), 1);
  assert.equal(ok.engine.getStat(ok.id("mech"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("mech"), "life"), 1);
  useMechanic(ok.engine, ok.id, "development");
  assert.equal(searchChoice(ok.engine)?.kind, "chooserSelectsTarget", "no summoning sickness for abilities");
});

// --- DEPLOYMENT

clause(MECHANIC, "1:ability:deployment", "depletes the Mechanic as its cost, and its controller may play an item for free", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "deployment");
  assert.equal(engine.state.cards[id("mech")].depleted, true);
  const pc = freePick(engine);
  assert.equal(pc?.kind, "deployForFree");
  assert.equal(pc?.playerId, P1);
});

clause(MECHANIC, "1:ability:deployment", "only ITEMS in your hand are offered: not characters, locations or tactics, and not items elsewhere", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "deployment");
  const pc = freePick(engine)!;
  for (const key of ["hItem", "hBig"]) assert.ok(pc.candidates.includes(id(key)), `${key} is offered`);
  for (const key of ["hChar", "hLoc", "hTac", "discItem", "itemA", "oppItemHand", "oppItem"]) assert.equal(pc.candidates.includes(id(key)), false, `${key} is not offered`);
});

clause(MECHANIC, "1:ability:deployment", "a character, a location or a tactic cannot be chosen even if named", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "deployment");
  assert.throws(() => chooseFree(engine, P1, id("hChar")));
  assert.throws(() => chooseFree(engine, P1, id("hLoc")));
  assert.throws(() => chooseFree(engine, P1, id("hTac")));
  assert.ok(freePick(engine), "still waiting for a legal choice");
});

clause(MECHANIC, "1:ability:deployment", "the chosen item enters play for free: a 4-cost item costs nothing", () => {
  const { engine, id } = mechanicBoard({ extra: bank("elitism", 2, P1) });
  useMechanic(engine, id, "deployment");
  chooseFree(engine, P1, id("hItem"));
  assert.equal(zoneOf(engine, id("hItem")), "play");
  assert.equal(engine.state.cards[id("hItem")].controllerId, P1);
  assert.equal(readyCount(engine, P1), 2, "no resources paid");
});

clause(MECHANIC, "1:ability:deployment", "a 9-cost item with no resources at all still comes in for free", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "deployment");
  chooseFree(engine, P1, id("hBig"));
  assert.equal(zoneOf(engine, id("hBig")), "play");
});

clause(MECHANIC, "1:ability:deployment", "free is the numeric cost only: an item whose resource icons you lack cannot be played", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "deployment");
  assert.throws(() => chooseFree(engine, P1, id("hRage")), "no [R][R]");
  assert.equal(zoneOf(engine, id("hRage")), "hand");
  assert.ok(freePick(engine), "freePick(engine)");
});

clause(MECHANIC, "1:ability:deployment", "free is the numeric cost only: an additional cost is still paid (extra 'your faction loses 2 influence')", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "deployment");
  chooseFree(engine, P1, id("hCostly"));
  assert.equal(zoneOf(engine, id("hCostly")), "play");
  assert.equal(influenceOf(engine, P1), START_INFLUENCE - 2);
});

clause(MECHANIC, "1:ability:deployment", "an 'Attach to' item still needs its host: it is played free and attached to the character picked", () => {
  const { engine, id } = mechanicBoard({
    handItems: false,
    extra: [
      { key: "gear", def: gearItem("Gear", 6), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 1, life: 3 }), owner: P1, zone: "play" }
    ]
  });
  useMechanic(engine, id, "deployment");
  chooseFree(engine, P1, id("gear"), { attachTo: [id("host")] });
  assert.equal(zoneOf(engine, id("gear")), "play");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
  assert.equal(engine.getStat(id("host"), "strength"), 3, "the gear's +2 applies");
});

clause(MECHANIC, "1:ability:deployment", "'may': it can be declined; the Mechanic stays depleted and nothing is played", () => {
  const { engine, id } = mechanicBoard();
  useMechanic(engine, id, "deployment");
  chooseFree(engine, P1, undefined);
  assert.equal(zoneOf(engine, id("hItem")), "hand");
  assert.equal(engine.state.cards[id("mech")].depleted, true);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MECHANIC, "1:ability:deployment", "with no item in hand the ability can still be used (the cost is paid, nothing is offered)", () => {
  const { engine, id } = mechanicBoard({ handItems: false });
  useMechanic(engine, id, "deployment");
  assert.equal(engine.state.cards[id("mech")].depleted, true);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MECHANIC, "1:ability:deployment", "a depleted Mechanic cannot use it", () => {
  const { engine, id } = mechanicBoard({ depleted: true });
  assert.throws(() => useMechanic(engine, id, "deployment"));
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MECHANIC, "1:ability:deployment", "it costs no resources", () => {
  const { engine, id } = mechanicBoard({ extra: bank("elitism", 3, P1) });
  useMechanic(engine, id, "deployment");
  chooseFree(engine, P1, id("hItem"));
  assert.equal(readyCount(engine, P1), 3);
});

clause(MECHANIC, "1:ability:deployment", "the opponent cannot use it", () => {
  const { engine, id } = mechanicBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() => useMechanic(engine, id, "deployment", P2));
});

// =============================================================================
// I Got the Gear!
// You may search your deck for a "gear" card. If you do, reveal it and put it
// into your hand.
// Tactic, cost 1, threshold [E].
// =============================================================================

const GOT_THE_GEAR = "97a5cad1-4663-414c-b230-9348968f6fb1";

function gotGearBoard(opts: { elitism?: number; rage?: number; noGear?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ig", def: printing(GOT_THE_GEAR), owner: P1, zone: "hand" },
      ...(opts.noGear
        ? []
        : [
            { key: "gearA", def: gearItem("GearA", 2), owner: P1, zone: "deck" as const },
            { key: "gearB", def: gearItem("GearB", 9), owner: P1, zone: "deck" as const }
          ]),
      { key: "tool", def: item({ name: "Tool", cost: 1, subtype: ["tool"] }), owner: P1, zone: "deck" },
      { key: "chump", def: character({ name: "Chump", cost: 1, subtype: ["gearhead"] }), owner: P1, zone: "deck" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner: P1, zone: "deck" as const })),
      { key: "gearHand", def: gearItem("GearHand", 2), owner: P1, zone: "hand" },
      { key: "gearDisc", def: gearItem("GearDisc", 2), owner: P1, zone: "discard" },
      { key: "gearBoard", def: gearItem("GearBoard", 2), owner: P1, zone: "play" },
      { key: "oppGear", def: gearItem("OppGear", 1), owner: P2, zone: "deck" },
      { key: "oppFiller", def: character({ name: "OppFiller" }), owner: P2, zone: "deck" },
      ...bank("elitism", opts.elitism ?? 1, P1),
      ...bank("rage", opts.rage ?? 0, P1)
    ]
  });
}

clause(GOT_THE_GEAR, "0:rule", "pays exactly 1, the controller may search, and the tactic ends in the discard pile", () => {
  const { engine, id } = gotGearBoard({ elitism: 3 });
  const before = readyCount(engine, P1);
  play(engine, P1, id("ig"));
  assert.equal(before - readyCount(engine, P1), 1);
  assert.equal(searchChoice(engine)?.kind, "chooserSelectsTarget");
  assert.equal(searchChoice(engine)?.playerId, P1);
  searchPick(engine, P1, [id("gearA")])();
  assert.equal(zoneOf(engine, id("ig")), "discard");
});

clause(GOT_THE_GEAR, "0:rule", "the gear goes into your hand (not into play), is revealed to everyone, and any gear qualifies whatever its cost", () => {
  for (const key of ["gearA", "gearB"]) {
    const { engine, id } = gotGearBoard();
    play(engine, P1, id("ig"));
    searchPick(engine, P1, [id(key)])();
    assert.equal(zoneOf(engine, id(key)), "hand", key);
    const reveals = revealEvents(engine);
    assert.equal(reveals.length, 1);
    const event = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
    assert.deepEqual(event.cardIds, [id(key)]);
    assert.equal(event.viewerId, "all");
  }
});

clause(GOT_THE_GEAR, "0:rule", "only a 'gear' card: another item subtype and a character with a similar subtype are refused", () => {
  const { engine, id } = gotGearBoard();
  play(engine, P1, id("ig"));
  assert.throws(searchPick(engine, P1, [id("tool")]), "a non-gear item");
  assert.throws(searchPick(engine, P1, [id("chump")]), "a 'gearhead' character is not a 'gear' card");
});

clause(GOT_THE_GEAR, "0:rule", "only from YOUR DECK: a gear in hand, the discard pile, in play or the opponent's deck is refused", () => {
  const { engine, id } = gotGearBoard();
  play(engine, P1, id("ig"));
  for (const key of ["gearHand", "gearDisc", "gearBoard", "oppGear"]) assert.throws(searchPick(engine, P1, [id(key)]), key);
  assert.equal(zoneOf(engine, id("oppGear")), "deck");
});

clause(GOT_THE_GEAR, "0:rule", "only one card", () => {
  const { engine, id } = gotGearBoard();
  play(engine, P1, id("ig"));
  assert.throws(searchPick(engine, P1, [id("gearA"), id("gearB")]));
  assert.ok(searchChoice(engine), "searchChoice(engine)");
});

clause(GOT_THE_GEAR, "0:rule", "'may': declining takes nothing and reveals nothing, but the tactic is still spent", () => {
  const { engine, id } = gotGearBoard();
  const handBefore = handOf(engine, P1).filter((c) => c !== id("ig"));
  play(engine, P1, id("ig"));
  searchPick(engine, P1, [])();
  assert.deepEqual(handOf(engine, P1), handBefore);
  assert.equal(revealEvents(engine).length, 0);
  assert.equal(zoneOf(engine, id("ig")), "discard");
});

clause(GOT_THE_GEAR, "0:rule", "the deck is shuffled afterwards, whether a gear was taken or not", () => {
  const taken = gotGearBoard();
  play(taken.engine, P1, taken.id("ig"));
  const before = taken.engine.state.players[P1].deck.filter((c) => c !== taken.id("gearA"));
  searchPick(taken.engine, P1, [taken.id("gearA")])();
  sameCards(taken.engine.state.players[P1].deck, before);
  assert.notDeepEqual(taken.engine.state.players[P1].deck, before);
  const declined = gotGearBoard();
  play(declined.engine, P1, declined.id("ig"));
  const beforeDeclined = [...declined.engine.state.players[P1].deck];
  searchPick(declined.engine, P1, [])();
  sameCards(declined.engine.state.players[P1].deck, beforeDeclined);
  assert.notDeepEqual(declined.engine.state.players[P1].deck, beforeDeclined);
});

clause(GOT_THE_GEAR, "0:rule", "a search that finds no gear still shuffles the deck (CR 312.1)", () => {
  const { engine, id } = gotGearBoard({ noGear: true });
  const before = [...engine.state.players[P1].deck];
  play(engine, P1, id("ig"));
  drain(engine, declineAll);
  const after = engine.state.players[P1].deck;
  sameCards(after, before);
  assert.notDeepEqual(after, before, "searched and found nothing: shuffled anyway");
});

clause(GOT_THE_GEAR, "0:rule", "the opponent's deck and hand are untouched", () => {
  const { engine, id } = gotGearBoard();
  const oppDeck = [...engine.state.players[P2].deck];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("ig"));
  searchPick(engine, P1, [id("gearA")])();
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(GOT_THE_GEAR, "0:rule", "is refused with no resources, and without [E] even with other resources", () => {
  const none = gotGearBoard({ elitism: 0 });
  assert.throws(() => playRaw(none.engine, P1, none.id("ig")));
  const noThreshold = gotGearBoard({ elitism: 0, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("ig")), "no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("ig")), "hand");
});

// =============================================================================
// Invent
// COST: Pick a number for X. Pay twice X. EFFECT: Search your deck for X-1
// cards and put them into your hand.
// Tactic, cost 0, threshold [E][E][E].
// =============================================================================

const INVENT = "538346b0-ab91-4619-88e9-ea8431879186";

function inventBoard(opts: { elitism?: number; rage?: number; deck?: number; extra?: CardPlacement[] } = {}) {
  const kinds = [
    (i: number) => character({ name: `Deck${i}`, cost: i }),
    (i: number) => item({ name: `Deck${i}`, cost: i }),
    (i: number) => location({ name: `Deck${i}`, cost: i }),
    (i: number) => drawTactic(`Deck${i}`, i)
  ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "inv", def: printing(INVENT), owner: P1, zone: "hand" },
      { key: "handCard", def: character({ name: "HandCard" }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.deck ?? 10 }, (_, i) => ({ key: `d${i}`, def: kinds[i % 4](i), owner: P1, zone: "deck" as const })),
      { key: "discCard", def: character({ name: "DiscCard" }), owner: P1, zone: "discard" },
      ...Array.from({ length: 4 }, (_, i) => ({ key: `e${i}`, def: character({ name: `E${i}` }), owner: P2, zone: "deck" as const })),
      { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 12, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays Invent with X = `x`; returns the number of resources it cost. */
function playInvent(engine: SpoilsEngine, id: (key: string) => CardInstanceId, x: number): number {
  const before = readyCount(engine, P1);
  play(engine, P1, id("inv"), { variables: { x } });
  return before - readyCount(engine, P1);
}

const dKeys = (...ns: number[]) => ns.map((n) => `d${n}`);

clause(INVENT, "0:ability", "X=2: pays twice X (4) and searches for exactly 1 card, which goes into your hand", () => {
  const { engine, id } = inventBoard();
  const handBefore = handOf(engine, P1).filter((c) => c !== id("inv"));
  assert.equal(playInvent(engine, id, 2), 4);
  assert.equal(searchChoice(engine)?.kind, "chooserSelectsTarget");
  assert.equal(searchChoice(engine)?.playerId, P1);
  searchPick(engine, P1, [id("d5")])();
  assert.equal(zoneOf(engine, id("d5")), "hand");
  assert.deepEqual([...handOf(engine, P1)].sort(), [...handBefore, id("d5")].sort(), "exactly one card gained");
  assert.equal(zoneOf(engine, id("inv")), "discard");
});

clause(INVENT, "0:ability", "X=3: pays 6 and searches for exactly 2 cards", () => {
  const { engine, id } = inventBoard();
  assert.equal(playInvent(engine, id, 3), 6);
  searchPick(engine, P1, [id("d1"), id("d6")])();
  assert.equal(zoneOf(engine, id("d1")), "hand");
  assert.equal(zoneOf(engine, id("d6")), "hand");
  assert.equal(engine.state.players[P1].deck.length, 8);
});

clause(INVENT, "0:ability", "X=5: pays 10 and searches for exactly 4 cards", () => {
  const { engine, id } = inventBoard();
  assert.equal(playInvent(engine, id, 5), 10);
  searchPick(engine, P1, [id("d0"), id("d2"), id("d4"), id("d9")])();
  for (const n of [0, 2, 4, 9]) assert.equal(zoneOf(engine, id(`d${n}`)), "hand");
  assert.equal(engine.state.players[P1].deck.length, 6);
});

clause(INVENT, "0:ability", "the cards can be of any type: a character, an item, a location and a tactic", () => {
  const { engine, id } = inventBoard();
  playInvent(engine, id, 5);
  searchPick(engine, P1, [id("d0"), id("d1"), id("d2"), id("d3")])();
  for (const n of [0, 1, 2, 3]) assert.equal(zoneOf(engine, id(`d${n}`)), "hand");
});

clause(INVENT, "0:ability", "X=1: pays 2 and searches for 0 cards: nothing enters your hand", () => {
  const { engine, id } = inventBoard();
  const handBefore = handOf(engine, P1).filter((c) => c !== id("inv"));
  assert.equal(playInvent(engine, id, 1), 2);
  if (searchChoice(engine)) searchPick(engine, P1, [])();
  assert.deepEqual([...handOf(engine, P1)], handBefore, "X-1 = 0 cards");
  assert.equal(engine.state.players[P1].deck.length, 10);
  assert.equal(zoneOf(engine, id("inv")), "discard");
});

clause(INVENT, "0:ability", "X=0 is a legal number: it costs nothing and finds nothing (it cannot find -1 cards)", () => {
  const { engine, id } = inventBoard({ elitism: 3 });
  const handBefore = handOf(engine, P1).filter((c) => c !== id("inv"));
  assert.equal(playInvent(engine, id, 0), 0);
  if (searchChoice(engine)) searchPick(engine, P1, [])();
  assert.deepEqual([...handOf(engine, P1)], handBefore);
  assert.equal(engine.state.players[P1].deck.length, 10);
  assert.equal(zoneOf(engine, id("inv")), "discard");
});

clause(INVENT, "0:ability", "X cannot be negative", () => {
  const { engine, id } = inventBoard();
  assert.throws(() => playRaw(engine, P1, id("inv"), { variables: { x: -1 } }));
  assert.equal(zoneOf(engine, id("inv")), "hand");
  assert.equal(readyCount(engine, P1), 12);
});

clause(INVENT, "0:ability", "an unconditional 'search for X-1 cards' must find all X-1: finding fewer (1 of 2) is refused", () => {
  const { engine, id } = inventBoard();
  playInvent(engine, id, 3);
  assert.throws(searchPick(engine, P1, [id("d4")]), "X=3 asks for 2 cards, 1 is too few");
  assert.throws(searchPick(engine, P1, []), "and finding none at all is not allowed either");
  searchPick(engine, P1, [id("d4"), id("d7")])();
  assert.equal(zoneOf(engine, id("d4")), "hand");
});

clause(INVENT, "0:ability", "X-1 cards exactly: three cards for X=3 (too many) is refused", () => {
  const { engine, id } = inventBoard();
  playInvent(engine, id, 3);
  assert.throws(searchPick(engine, P1, [id("d1"), id("d2"), id("d3")]), "X=3 asks for 2 cards, 3 is too many");
  assert.ok(searchChoice(engine), "searchChoice(engine)");
  assert.equal(zoneOf(engine, id("d1")), "deck");
});

clause(INVENT, "0:ability", "only from YOUR deck: cards in hand, discard pile or the opponent's deck are refused", () => {
  const { engine, id } = inventBoard();
  playInvent(engine, id, 2);
  assert.throws(searchPick(engine, P1, [id("handCard")]), "hand");
  assert.throws(searchPick(engine, P1, [id("discCard")]), "discard");
  assert.throws(searchPick(engine, P1, [id("e0")]), "the opponent's deck");
  assert.throws(searchPick(engine, P1, [id("d2"), id("d2")]), "the same card twice");
});

clause(INVENT, "0:ability", "with fewer than X-1 cards in the deck, you find all that there are (deck of 2 cards, X=5)", () => {
  const { engine, id } = inventBoard({ deck: 2 });
  assert.equal(playInvent(engine, id, 5), 10);
  searchPick(engine, P1, [id("d0"), id("d1")])();
  assert.equal(zoneOf(engine, id("d0")), "hand");
  assert.equal(zoneOf(engine, id("d1")), "hand");
  assert.equal(engine.state.players[P1].deck.length, 0);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(INVENT, "0:ability", "the deck is shuffled after the search", () => {
  const { engine, id } = inventBoard();
  playInvent(engine, id, 2);
  const before = engine.state.players[P1].deck.filter((c) => c !== id("d5"));
  searchPick(engine, P1, [id("d5")])();
  sameCards(engine.state.players[P1].deck, before);
  assert.notDeepEqual(engine.state.players[P1].deck, before, "shuffled");
});

clause(INVENT, "0:ability", "the cards are not revealed ('put them into your hand' says nothing about revealing)", () => {
  const { engine, id } = inventBoard();
  playInvent(engine, id, 3);
  searchPick(engine, P1, [id("d1"), id("d2")])();
  assert.equal(revealEvents(engine).length, 0);
});

clause(INVENT, "0:ability", "the opponent's deck and hand are untouched", () => {
  const { engine, id } = inventBoard();
  const oppDeck = [...engine.state.players[P2].deck];
  const oppHand = [...handOf(engine, P2)];
  playInvent(engine, id, 3);
  searchPick(engine, P1, [id("d1"), id("d2")])();
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(INVENT, "0:ability", "paying twice X needs 2X ready resources: X=3 is refused with 5 and allowed with exactly 6", () => {
  const short = inventBoard({ elitism: 5 });
  assert.throws(() => playRaw(short.engine, P1, short.id("inv"), { variables: { x: 3 } }));
  assert.equal(zoneOf(short.engine, short.id("inv")), "hand");
  assert.equal(readyCount(short.engine, P1), 5);
  const exact = inventBoard({ elitism: 6 });
  assert.equal(playInvent(exact.engine, exact.id, 3), 6);
  assert.equal(readyCount(exact.engine, P1), 0);
});

clause(INVENT, "0:ability", "the printed cost is 0: with X=1 only the 2 of 'pay twice X' is paid, and [E][E][E] is still needed", () => {
  const noThreshold = inventBoard({ elitism: 2, rage: 5 });
  assert.throws(() => playRaw(noThreshold.engine, P1, noThreshold.id("inv"), { variables: { x: 1 } }), "two [E] is short of [E][E][E]");
  const ok = inventBoard({ elitism: 3 });
  assert.equal(playInvent(ok.engine, ok.id, 1), 2);
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("inv")), "discard");
});

clause(INVENT, "0:ability", "[E][E][E] is needed whatever X is: X=2 with only two [E] and plenty of other resources is refused", () => {
  const { engine, id } = inventBoard({ elitism: 2, rage: 6 });
  assert.throws(() => playRaw(engine, P1, id("inv"), { variables: { x: 2 } }));
  assert.equal(zoneOf(engine, id("inv")), "hand");
});

clause(INVENT, "0:ability", "paying twice X may use resources of any icon once [E][E][E] is met", () => {
  const { engine, id } = inventBoard({ elitism: 3, rage: 3 });
  assert.equal(playInvent(engine, id, 3), 6);
});

clause(INVENT, "0:ability", "with 1337! first (4 off the next card's numeric cost, which includes 'pay twice X'): X=3 costs 6 - 4 = 2", () => {
  const { engine, id } = inventBoard({ elitism: 14, extra: [{ key: "l", def: printing(LEET), owner: P1, zone: "hand" }] });
  play(engine, P1, id("l"));
  answerLeet(engine);
  const before = readyCount(engine, P1);
  play(engine, P1, id("inv"), { variables: { x: 3 } });
  assert.equal(before - readyCount(engine, P1), 2);
});

// @@END@@
