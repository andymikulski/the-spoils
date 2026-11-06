// Clause tests — batch 1st-edition-part-2-02. See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-part-2-02`. Expectations come from each
// card's PRINTED text (1st Edition Part 2 printing), RULES.md and the Comprehensive
// Rules / FAQ; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  cardDef,
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
import { clause, declineAll, drain, printing, refused, settleState } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  playRaw
} from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn, factionOf, developPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement, DamageSource } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1): number => engine.getAvailableResourceCount(player);
const influence = (engine: SpoilsEngine, player: Pid): number => engine.state.players[player].influence;
const handOf = (engine: SpoilsEngine, player: Pid): CardInstanceId[] => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid): CardInstanceId[] => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid): CardInstanceId[] => engine.state.players[player].discard;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted;
const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string): boolean => (engine.getKeywords(cardId) as string[]).includes(keyword);
const stats = (engine: SpoilsEngine, cardId: CardInstanceId): number[] => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "life"),
  engine.getStat(cardId, "speed")
];
const asTarget = (cardId: CardInstanceId) => ({ type: "card" as const, cardId });

/** The ids of all cards in `owner`'s hand, as a sorted copy (to compare hands as sets). */
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/**
 * A whole battle where the attacker's damage goes where `pickTarget` says (a card id, or "faction"),
 * after `blockers` (possibly none) are declared.
 */
function fightAssign(
  engine: SpoilsEngine,
  attacker: Pid,
  attackers: CardInstanceId[],
  target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId },
  blockers: CardInstanceId[],
  pickTarget: (source: DamageSource) => CardInstanceId | "faction" | undefined
): void {
  declareAttackBy(engine, attacker, attackers, target);
  engine.perform({ type: "declareBlockers", playerId: other(attacker), blockerIds: blockers });
  autoResolveBattle(engine, (source) => {
    if (source.strength <= 0 || source.legalTargets.length === 0) return [];
    const picked = controllerOf(engine, source.cardId) === attacker ? pickTarget(source) : undefined;
    if (picked === undefined) return [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }];
    const to = picked === "faction" ? { type: "faction" as const, playerId: other(attacker) } : asTarget(picked);
    return [{ sourceId: source.cardId, target: to, amount: source.strength }];
  });
}

/** A whole battle with the default damage assignment (each source's full strength to its first legal target). */
function fightDefault(
  engine: SpoilsEngine,
  attacker: Pid,
  attackers: CardInstanceId[],
  target: { type: "faction"; playerId: PlayerId } | { type: "card"; cardId: CardInstanceId },
  blockers: CardInstanceId[]
): void {
  declareAttackBy(engine, attacker, attackers, target);
  engine.perform({ type: "declareBlockers", playerId: other(attacker), blockerIds: blockers });
  autoResolveBattle(engine);
}

/** A free tactic dealing `amount` damage to one picked character (id `dmg`, declaration `t`). */
function damageTactic(amount: number, name = `Damage${amount}`): CardDefinition {
  return tactic({
    name,
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

/** A free tactic dealing `amount` damage to one picked location (id `ldmg`, declaration `t`). */
function locationDamageTactic(amount: number): CardDefinition {
  return tactic({
    name: `LocDamage${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "ldmg",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic that adds `amount` strength to one picked character until end of turn (id `pump`, declaration `t`). */
function pumpTactic(amount: number): CardDefinition {
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

/** A free tactic that returns one picked character to its owner's hand (id `b`, declaration `t`). */
function bounce(): CardDefinition {
  return tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
}

/** A free tactic that destroys one picked item (id `k`, declaration `t`). */
function destroyItemTactic(): CardDefinition {
  return tactic({
    name: "DestroyItem",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic that takes permanent control of one picked opponent's character (id `steal`, declaration `t`). */
function stealTactic(): CardDefinition {
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

/** A character with a free activated ability that inflicts `amount` damage to one picked character (id `zap`, declaration `t`). */
function zapper(name: string, amount: number, over: Partial<CardDefinition> = {}): CardDefinition {
  return character({
    name,
    strength: 1,
    life: 9,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    },
    ...over
  });
}

/** A free tactic that puts a card of yours from your discard pile into play (id `raise`, declaration `t`). */
function reanimator(): CardDefinition {
  return item({
    name: "Reanimator",
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          costs: [],
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
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

/** An attack target for P2 attacking P1's faction. */
const factionOfP1 = { type: "faction" as const, playerId: P1 };
const factionOfP2 = { type: "faction" as const, playerId: P2 };

// --- Venomous Sacspider ------------------------------------------------------------
// If this card is destroyed by battle damage, your opponent must discard their hand.
// Character (arcanist, lurker), cost 3, threshold [O][O], 2 strength / 3 speed / 1 life.

const SPIDER = "b374445f-2ac5-40b2-bfc5-5ee47771db6c";

/** P2 attacks (turn 2); P1 owns the Sacspider (`spider`), an ally (`ally`), and holds 2 cards; P2 holds 3 cards (`oh0..2`). */
function spiderDefends(opts: { ophand?: number; ally?: Partial<CardDefinition>; attacker?: Partial<CardDefinition>; spiderController?: Pid; spiderOwner?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "spider", def: printing(SPIDER), owner: opts.spiderOwner ?? P1, controller: opts.spiderController, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 5, speed: 1, ...opts.ally }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 5, speed: 3, ...opts.attacker }), owner: P2, zone: "play" },
      ...fillers("mine", 2, P1, "hand"),
      ...fillers("oh", opts.ophand ?? 3, P2, "hand"),
      ...fillers("od", 2, P2, "deck")
    ]
  });
}

/** P1 attacks (turn 1) with the Sacspider; P2 owns a blocker and holds 3 cards. */
function spiderAttacks(opts: { blocker?: Partial<CardDefinition> } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "spider", def: printing(SPIDER), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 2, life: 5, speed: 3, ...opts.blocker }), owner: P2, zone: "play" },
      ...fillers("mine", 2, P1, "hand"),
      ...fillers("oh", 3, P2, "hand")
    ]
  });
}

clause(SPIDER, "0:rule", "blocking and destroyed by battle damage: the opponent discards their whole hand, to their own discard pile", () => {
  const { engine, id } = spiderDefends();
  const oppHand = ["oh0", "oh1", "oh2"].map(id);
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard", "the Sacspider (1 life) was destroyed by the 3 battle damage");
  assert.deepEqual(handOf(engine, P2), [], "the opponent's hand is empty");
  for (const card of oppHand) assert.equal(zoneOf(engine, card), "discard", "each card of the hand was discarded");
  assert.deepEqual(sorted(discardOf(engine, P2)), sorted(oppHand), "into the opponent's own discard pile");
});

clause(SPIDER, "0:rule", "only the opponent discards: the Sacspider's controller keeps their hand", () => {
  const { engine, id } = spiderDefends();
  const mine = sorted(handOf(engine, P1));
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.deepEqual(sorted(handOf(engine, P1)), mine, "my hand is untouched");
  assert.deepEqual(discardOf(engine, P1), [id("spider")], "only the Sacspider is in my discard pile");
});

clause(SPIDER, "0:rule", "attacking and destroyed by the blocker's battle damage: the opponent (the blocker's controller) discards their hand", () => {
  const { engine, id } = spiderAttacks();
  fightDefault(engine, P1, [id("spider")], factionOfP2, [id("blk")]);
  assert.equal(zoneOf(engine, id("spider")), "discard", "destroyed by the blocker's 2 battle damage");
  assert.deepEqual(handOf(engine, P2), [], "the opponent discarded their hand");
  assert.equal(discardOf(engine, P2).length, 3);
  assert.equal(handOf(engine, P1).length, 2, "the attacker's controller keeps their hand");
});

clause(SPIDER, "0:rule", "the whole hand goes, whatever its size: 1 card, and 6 cards", () => {
  for (const size of [1, 6]) {
    const { engine, id } = spiderDefends({ ophand: size });
    fightDefault(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
    assert.equal(handOf(engine, P2).length, 0, `${size} card(s) in hand: all discarded`);
    assert.equal(discardOf(engine, P2).length, size);
  }
});

clause(SPIDER, "0:rule", "an opponent with no cards in hand discards nothing and the game carries on", () => {
  const { engine, id } = spiderDefends({ ophand: 0 });
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(pending(engine), undefined, "nothing is left pending");
  assert.deepEqual(discardOf(engine, P2), []);
  assert.deepEqual(deckOf(engine, P2).length, 2, "the opponent's deck is untouched");
});

clause(SPIDER, "0:rule", "the opponent's deck, play area and discard pile are not touched: only the hand is discarded", () => {
  const { engine, id } = spiderDefends();
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(deckOf(engine, P2).length, 2, "deck untouched");
  assert.equal(zoneOf(engine, id("atk")), "play", "the attacker is still in play");
});

clause(SPIDER, "0:rule", "a Sacspider that survives battle damage (the attacker deals 0) does not make the opponent discard", () => {
  const { engine, id } = spiderDefends({ attacker: { strength: 0 } });
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "play", "0 battle damage does not destroy it");
  assert.equal(handOf(engine, P2).length, 3, "the opponent keeps their hand");
});

clause(SPIDER, "0:rule", "a Sacspider that is not hit does not make the opponent discard (attacking, unblocked)", () => {
  const { engine, id } = spiderAttacks();
  fightDefault(engine, P1, [id("spider")], factionOfP2, []);
  assert.equal(zoneOf(engine, id("spider")), "play");
  assert.equal(handOf(engine, P2).length, 3);
  assert.equal(influence(engine, P2), 30 - 2, "the Sacspider's 2 battle damage went to the faction");
});

clause(SPIDER, "0:rule", "destroyed by a non-battle effect (a 'destroy' tactic): the opponent does not discard", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "spider", def: printing(SPIDER), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...fillers("oh", 3, P2, "hand")
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("spider")] } });
  assert.equal(zoneOf(engine, id("spider")), "discard", "destroyed");
  assert.equal(handOf(engine, P2).length, 3, "not by battle damage: the opponent keeps their hand");
});

clause(SPIDER, "0:rule", "destroyed by non-battle damage (a damage tactic outside of battle): the opponent does not discard", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "spider", def: printing(SPIDER), owner: P1, zone: "play" },
      { key: "zap", def: damageTactic(1), owner: P2, zone: "hand" },
      ...fillers("oh", 3, P2, "hand")
    ]
  });
  play(game.engine, P2, game.id("zap"), { selected: { t: [game.id("spider")] } });
  assert.equal(zoneOf(game.engine, game.id("spider")), "discard", "the 1 damage destroyed the 1-life Sacspider");
  assert.equal(handOf(game.engine, P2).length, 3, "damage from a tactic is not battle damage: no discard (FAQ, CR 408.6)");
});

clause(SPIDER, "0:rule", "damage from a tactic DURING a battle is not battle damage either (FAQ): the opponent keeps their hand", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "spider", def: printing(SPIDER), owner: P1, zone: "play" },
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

clause(SPIDER, "0:rule", "another character of the controller destroyed by battle damage does not make the opponent discard", () => {
  const { engine, id } = spiderDefends({ ally: { life: 2 } });
  // The blocking party is the Sacspider and its ally; all 3 damage goes to the ally.
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("spider"), id("ally")], () => id("ally"));
  assert.equal(zoneOf(engine, id("ally")), "discard", "the ally (2 life) was destroyed by battle damage");
  assert.equal(zoneOf(engine, id("spider")), "play", "the Sacspider survived");
  assert.equal(handOf(engine, P2).length, 3, "only the Sacspider's own destruction counts");
});

clause(SPIDER, "0:rule", "the Sacspider destroyed in a party alongside its ally still triggers: the opponent discards", () => {
  const { engine, id } = spiderDefends();
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("ally"), id("spider")], () => id("spider"));
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(zoneOf(engine, id("ally")), "play", "the ally took none of the damage");
  assert.equal(handOf(engine, P2).length, 0, "the opponent discards their hand");
});

clause(SPIDER, "0:rule", "the Sacspider destroying someone else's character does not make ITS controller or the other player discard", () => {
  const { engine, id } = spiderAttacks({ blocker: { life: 1, strength: 0 } });
  fightDefault(engine, P1, [id("spider")], factionOfP2, [id("blk")]);
  assert.equal(zoneOf(engine, id("blk")), "discard", "the blocker (1 life) was destroyed by the Sacspider's battle damage");
  assert.equal(zoneOf(engine, id("spider")), "play", "the Sacspider (blocker deals 0) survives");
  assert.equal(handOf(engine, P2).length, 3, "the destroyed character's controller does not discard");
  assert.equal(handOf(engine, P1).length, 2);
});

clause(SPIDER, "0:rule", "simultaneous destruction: a Sacspider and its attacker destroyed in the same damage step still empties the opponent's hand", () => {
  const { engine, id } = spiderDefends({ attacker: { strength: 2, life: 1, speed: 3 } });
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(zoneOf(engine, id("atk")), "discard", "the attacker (1 life) was destroyed by the Sacspider's 2 damage");
  assert.equal(handOf(engine, P2).length, 0);
});

clause(SPIDER, "0:rule", "'your opponent' is relative to the Sacspider's controller: P2's Sacspider destroyed by battle damage makes P1 discard", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "spider", def: printing(SPIDER), owner: P2, zone: "play" },
      ...fillers("mine", 3, P1, "hand"),
      ...fillers("oh", 2, P2, "hand")
    ]
  });
  fightDefault(engine, P1, [id("atk")], factionOfP2, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(handOf(engine, P1).length, 0, "P1 (the opponent of the Sacspider's controller) discards their hand");
  assert.equal(handOf(engine, P2).length, 2, "P2 keeps theirs");
});

clause(SPIDER, "0:rule", "'your opponent' follows control: a Sacspider P2 owns but P1 controls makes P2 discard", () => {
  const { engine, id } = spiderDefends({ spiderOwner: P2, spiderController: P1 });
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("spider")]);
  assert.equal(zoneOf(engine, id("spider")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("spider")), true, "it goes to its owner's discard pile");
  assert.equal(handOf(engine, P2).filter((card) => card !== id("spider")).length, 0, "P2 (the controller's opponent) discards their hand");
  assert.equal(handOf(engine, P1).length, 2, "P1, who controls it, keeps their hand");
});

clause(SPIDER, "0:rule", "a face-down Sacspider is just a resource: it has no trigger", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hidden", def: printing(SPIDER), owner: P1, zone: "play", faceDown: true },
      { key: "kill", def: tactic({ name: "KillRes", cost: 0, behavior: { abilities: [{ id: "kr", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
      ...fillers("oh", 3, P2, "hand")
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("hidden")] } });
  assert.equal(zoneOf(engine, id("hidden")), "discard");
  assert.equal(handOf(engine, P2).length, 3);
});

clause(SPIDER, "0:rule", "costs 3 with [O][O], has 2 strength / 3 speed / 1 life, and is the printed arcanist lurker", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "spider", def: printing(SPIDER), owner: P1, zone: "hand" }, ...bank("obsession", 3, P1)]
  });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("spider"));
  assert.equal(zoneOf(exact.engine, exact.id("spider")), "play");
  assert.equal(before - ready(exact.engine), 3, "pays exactly 3");
  assert.deepEqual(stats(exact.engine, exact.id("spider")), [2, 1, 3]);

  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "spider", def: printing(SPIDER), owner: P1, zone: "hand" }, ...bank("obsession", 2, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("spider")), "one resource short");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "spider", def: printing(SPIDER), owner: P1, zone: "hand" }, ...bank("obsession", 1, P1), ...bank("greed", 5, P1)]
  });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("spider")), "only one [O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("spider")), "hand");
});

// --- Violating Anomaly -------------------------------------------------------------
// When this card enters play, look at your opponent's hand and pick a card. Your opponent
// must discard that card.
// If this card leaves play, you may pick a non-resource card. Put that card into its
// owner's hand. Draw a card.
// Character (arcanist; muddler, lurker), cost 6, threshold [O][O], 2 strength / 2 speed / 4 life.

const ANOMALY = "973827cb-fb59-4ce8-9681-1263a14d2e62";

/** A character with a "when this enters play, you draw a card" trigger (a witness for 'did it enter play'). */
function drawOnEnter(name = "Greeter", over: Partial<CardDefinition> = {}): CardDefinition {
  return character({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    },
    ...over
  });
}

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

clause(ANOMALY, "0:rule", "entering play: its controller is asked to pick a card from the opponent's hand, and the opponent discards exactly that card", () => {
  const { engine, id } = anomalyDeploy();
  const before = sorted(handOf(engine, P2));
  play(engine, P1, id("an"));
  assert.equal(zoneOf(engine, id("an")), "play", "the Anomaly is in play");
  const pc = pending(engine);
  assert.ok(pc, "a pick is required");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Anomaly's controller picks (not the opponent)");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh1")] });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("oh1")), "discard", "the picked card was discarded");
  assert.deepEqual(discardOf(engine, P2), [id("oh1")], "into the opponent's own discard pile, and nothing else with it");
  assert.deepEqual(sorted(handOf(engine, P2)), sorted(before.filter((card) => card !== id("oh1"))), "every other card stays in their hand");
});

for (const key of ["oh0", "oh1", "oh2", "ores"]) {
  clause(ANOMALY, "0:rule", `any card of the opponent's hand can be picked, and only it is discarded (${key}${key === "ores" ? ", a resource card: 'a card'" : ""})`, () => {
    const { engine, id } = anomalyDeploy();
    play(engine, P1, id("an"));
    answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] });
    assert.deepEqual(discardOf(engine, P2), [id(key)]);
    assert.equal(handOf(engine, P2).length, 3);
    assert.equal(handOf(engine, P1).length, 2, "my hand is untouched");
  });
}

clause(ANOMALY, "0:rule", "the pick must come from the OPPONENT'S HAND: my own hand, their deck, discard pile and play area are refused", () => {
  const { engine, id } = anomalyDeploy({ extra: [{ key: "oldDiscard", def: character({ name: "Old" }), owner: P2, zone: "discard" }] });
  play(engine, P1, id("an"));
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  const attempt = (cardId: CardInstanceId) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
  refused(attempt(id("mine0")), "a card of my own hand");
  refused(attempt(id("od0")), "a card of their deck");
  refused(attempt(id("oldDiscard")), "a card of their discard pile");
  refused(attempt(id("foe")), "a character they have in play");
  refused(attempt(factionOf(engine, P2)), "their faction");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the pick is still open after the refusals");
  attempt(id("oh2"))();
  assert.equal(zoneOf(engine, id("oh2")), "discard", "control: a card of their hand is accepted");
});

clause(ANOMALY, "0:rule", "'pick a card ... must discard': the pick is mandatory (nothing, or two cards, is refused) while the opponent holds cards", () => {
  const { engine, id } = anomalyDeploy();
  play(engine, P1, id("an"));
  const attempt = (selected: CardInstanceId[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);
  refused(attempt([]), "picking nothing");
  refused(attempt([id("oh0"), id("oh1")]), "picking two cards");
  assert.equal(handOf(engine, P2).length, 4, "nothing was discarded by the refused answers");
  attempt([id("oh0")])();
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
  if (pending(engine)) answerPending(engine, "chooserSelectsTarget", { selected: [id("only")] });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("only")), "discard");
  assert.deepEqual(handOf(engine, P2), []);
});

clause(ANOMALY, "0:rule", "an opponent with an empty hand: nothing to pick or discard, the Anomaly is in play and nothing is stuck", () => {
  const { engine, id } = anomalyDeploy({ ophand: false });
  play(engine, P1, id("an"));
  assert.equal(zoneOf(engine, id("an")), "play");
  assert.equal(pending(engine), undefined, "no pick is offered");
  assert.equal(engine.state.responseWindow, undefined);
  assert.deepEqual(discardOf(engine, P2), []);
  assert.deepEqual(discardOf(engine, P1), [], "I discard nothing either");
});

clause(ANOMALY, "0:rule", "the pick happens when the Anomaly enters play, not while it is still waiting for responses", () => {
  const { engine, id } = anomalyDeploy();
  playRaw(engine, P1, id("an"));
  assert.equal(zoneOf(engine, id("an")), "deploying");
  assert.equal(pending(engine), undefined, "no pick while it is being deployed");
  assert.equal(handOf(engine, P2).length, 4);
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the pick opens once it has entered play");
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
      { key: "re", def: reanimator(), owner: P1, zone: "play" },
      { key: "an", def: printing(ANOMALY), owner: P1, zone: "discard" },
      ...fillers("oh", 3, P2, "hand")
    ]
  });
  activate(engine, P1, id("re"), "raise", { selected: { t: [id("an")] } });
  assert.equal(zoneOf(engine, id("an")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the entering-play pick opens");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oh2")] });
  assert.deepEqual(discardOf(engine, P2), [id("oh2")]);
});

clause(ANOMALY, "0:rule", "'your opponent' is relative to its controller: P2's Anomaly picks from P1's hand", () => {
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
  assert.equal(pc?.playerId, P2, "P2 (the controller) picks");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("oh0")] } } as never), "not from their own hand");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("mine1")] });
  assert.deepEqual(discardOf(engine, P1), [id("mine1")], "P1 discards the picked card");
  assert.equal(handOf(engine, P2).length, 2);
});

clause(ANOMALY, "0:rule", "costs 6 with [O][O]; has 2 strength / 2 speed / 4 life", () => {
  const exact = anomalyDeploy({ obsession: 6 });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("an"));
  assert.equal(zoneOf(exact.engine, exact.id("an")), "play");
  assert.equal(before - ready(exact.engine), 6, "pays exactly 6");
  assert.deepEqual(stats(exact.engine, exact.id("an")), [2, 4, 2]);

  const short = anomalyDeploy({ obsession: 5 });
  refused(() => playRaw(short.engine, P1, short.id("an")), "one resource short");
  const noThreshold = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "an", def: printing(ANOMALY), owner: P1, zone: "hand" }, ...bank("obsession", 1, P1), ...bank("greed", 8, P1)]
  });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("an")), "only one [O]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("an")), "hand");
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
  const handBefore = handOf(game.engine, P1).length;
  destroyAnomaly(game, true, "foe");
  assert.equal(zoneOf(game.engine, game.id("foe")), "hand");
  assert.ok(handOf(game.engine, P2).includes(game.id("foe")), "in the opponent's hand");
  assert.equal(handOf(game.engine, P1).includes(game.id("foe")), false, "not in mine");
  assert.equal(handOf(game.engine, P1).length, handBefore - 1 + 1, "kill tactic left my hand; I drew one card");
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

clause(ANOMALY, "1:rule", "'Draw a card' draws exactly one card, whether or not a card was picked", () => {
  for (const accept of [true, false]) {
    const game = anomalyLeaves();
    const deckBefore = deckOf(game.engine, P1).length;
    destroyAnomaly(game, accept, accept ? "foe" : undefined);
    assert.equal(deckBefore - deckOf(game.engine, P1).length, 1, `accept=${accept}`);
    assert.equal(deckOf(game.engine, P2).length, 2, "the opponent draws nothing");
  }
});

clause(ANOMALY, "1:rule", "the pick is limited to non-resource cards in play: resources, face-down cards, factions, the Anomaly itself and cards outside play are refused", () => {
  const game = anomalyLeaves([...bank("greed", 1, P1)]);
  const resourceId = game.engine.state.players[P1].play.find((card) => game.engine.getDefinition(card).type === "resource")!;
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("an")] } });
  assert.equal(pending(game.engine)?.kind, "chooserSelectsOption");
  answerPending(game.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  const attempt = (cardId: CardInstanceId) => () =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
  refused(attempt(resourceId), "a face-up resource");
  refused(attempt(game.id("hidden")), "a face-down card is a resource");
  refused(attempt(factionOf(game.engine, P1)), "my faction (CR 202.9)");
  refused(attempt(factionOf(game.engine, P2)), "their faction");
  refused(attempt(game.id("an")), "the Anomaly itself has left play");
  refused(attempt(game.id("inHand")), "a card in a hand");
  refused(attempt(game.id("inDiscard")), "a card in a discard pile");
  refused(attempt(game.id("od0")), "a card in a deck");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "still open after the refusals");
  attempt(game.id("itm"))();
  assert.equal(zoneOf(game.engine, game.id("itm")), "hand", "control: a non-resource card in play is accepted");
});

clause(ANOMALY, "1:rule", "the pick is exactly one card: two are refused", () => {
  const game = anomalyLeaves();
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("an")] } });
  answerPending(game.engine, "chooserSelectsOption", { index: 0 });
  refused(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [game.id("mine"), game.id("foe")] } } as never)
  );
  assert.equal(zoneOf(game.engine, game.id("mine")), "play");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
});

clause(ANOMALY, "1:rule", "its controller makes the choices even when the OPPONENT destroys it", () => {
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
  const game = anomalyLeaves([{ key: "bounce", def: bounce(), owner: P1, zone: "hand" }]);
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
  fightDefault(game.engine, P2, [game.id("atk")], factionOfP1, [game.id("an")]);
  drain(game.engine, leaveScript(game.id, true, "itm"));
  assert.equal(zoneOf(game.engine, game.id("an")), "discard");
  assert.equal(zoneOf(game.engine, game.id("itm")), "hand", "picked item returned to hand");
  assert.equal(zoneOf(game.engine, top), "hand", "card drawn");
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
      { key: "kill", def: tactic({ name: "KillRes", cost: 0, behavior: { abilities: [{ id: "kr", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
      ...fillers("d", 2, P1, "deck")
    ]
  });
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("fd")] } });
  assert.equal(zoneOf(game.engine, game.id("fd")), "discard");
  assert.equal(pending(game.engine), undefined, "dormant");
  assert.equal(deckOf(game.engine, P1).length, 2, "nothing drawn");
});

clause(ANOMALY, "1:rule", "with an empty deck the pick still happens and nothing breaks", () => {
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

// --- Voidal Interference -----------------------------------------------------------
// COST: Play this only in response to a card being played. (Playing a resource doesn't count.)
// EFFECT: Put the card into its owner's hand. Treat the card as though it was not played. Its
// owner must put a card from their hand on top of their deck.
// Tactic (arcanist), cost 3, threshold [O].

const INTERFERENCE = "73269637-6bcc-4f27-9770-d42b0f146f4b";

/** A tactic of P2's that kills one of the opponent's characters when it resolves (picked on play: id `k`, declaration `t`). */
function slayTactic(): CardDefinition {
  return tactic({
    name: "Slay",
    cost: 1,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

interface InterfOpts {
  /** What P2 plays (a cost-1 card). */
  played?: CardDefinition;
  obsession?: number;
  greed?: number;
  extra?: CardPlacement[];
}

/** P2's turn. P2 holds `played` (`opp`) and 3 other cards (`ph0..2`); P1 holds the Interference (`vi`) and 2 cards. */
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
      ...fillers("ph", 3, P2, "hand"),
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

/** P2 plays `opp`, P1 answers with the Interference, and the responses resolve until P2's put-on-top choice opens. */
function interfere(game: ReturnType<typeof interfBoard>, selected: Record<string, CardInstanceId[]> = {}): void {
  playRaw(game.engine, P2, game.id("opp"), { selected });
  playRaw(game.engine, P1, game.id("vi"));
  resolvePendingResponses(game.engine);
}

/** Answers the owner's put-on-top choice with `key` (a hand card), asserting P2 is the one asked. */
function putOnTop(game: ReturnType<typeof interfBoard>, key: string): void {
  const pc = pending(game.engine);
  assert.ok(pc, "the owner is asked to put a card on top of their deck");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the card's owner chooses");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(key)] });
}

clause(INTERFERENCE, "0:ability", "in response to a character being played: it returns to its owner's hand and never enters play", () => {
  const game = interfBoard({ played: drawOnEnter("Greeter", { cost: 1 }) });
  const deckBefore = deckOf(game.engine, P2).length;
  interfere(game);
  assert.equal(zoneOf(game.engine, game.id("opp")), "hand", "back in its owner's hand, not in play");
  assert.ok(handOf(game.engine, P2).includes(game.id("opp")), "handOf(game.engine, P2).includes(game.id(\"opp\"))");
  assert.equal(game.engine.state.players[P2].play.includes(game.id("opp")), false);
  putOnTop(game, "ph0");
  assert.equal(deckOf(game.engine, P2).length, deckBefore + 1, "only the card put on top is added: the enters-play trigger did not draw (the card was treated as not played)");
  assert.equal(zoneOf(game.engine, game.id("vi")), "discard", "the Interference itself goes to its owner's discard pile");
});

clause(INTERFERENCE, "0:ability", "in response to an item being played: it returns to its owner's hand instead of entering play", () => {
  const game = interfBoard({ played: item({ name: "Gadget", cost: 1 }) });
  interfere(game);
  assert.equal(zoneOf(game.engine, game.id("opp")), "hand");
  assert.equal(game.engine.state.players[P2].play.includes(game.id("opp")), false);
});

clause(INTERFERENCE, "0:ability", "in response to a location being played: it returns to its owner's hand instead of entering play", () => {
  const game = interfBoard({ played: location({ name: "Hovel", cost: 1 }) });
  interfere(game);
  assert.equal(zoneOf(game.engine, game.id("opp")), "hand");
  assert.equal(game.engine.state.players[P2].play.includes(game.id("opp")), false);
});

clause(INTERFERENCE, "0:ability", "in response to a tactic being played: the tactic returns to its owner's hand, NOT its discard pile, and its effect does not happen", () => {
  const game = interfBoard({ played: slayTactic() });
  interfere(game, { t: [buildTarget(game, "victim")] });
  assert.equal(zoneOf(game.engine, game.id("opp")), "hand", "the tactic is in its owner's hand");
  assert.equal(discardOf(game.engine, P2).includes(game.id("opp")), false, "not in the discard pile");
  assert.equal(zoneOf(game.engine, game.id("victim")), "play", "its effect (destroy the victim) did not happen");
});

function buildTarget(game: ReturnType<typeof interfBoard>, key: string): CardInstanceId {
  return game.id(key);
}

clause(INTERFERENCE, "0:ability", "its owner must then put a card from their hand on top of their deck: choosing another card puts exactly that card on top", () => {
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

clause(INTERFERENCE, "0:ability", "the card put on top may be the very card that was bounced", () => {
  const game = interfBoard();
  const deckBefore = [...deckOf(game.engine, P2)];
  interfere(game);
  putOnTop(game, "opp");
  assert.equal(deckOf(game.engine, P2)[0], game.id("opp"), "the bounced card is on top of its owner's deck");
  assert.deepEqual(deckOf(game.engine, P2).slice(1), deckBefore);
  assert.equal(handOf(game.engine, P2).length, 3, "their original three cards are still in hand");
});

for (const key of ["ph0", "ph1", "ph2"]) {
  clause(INTERFERENCE, "0:ability", `any card of the owner's hand can go on top (${key}), and only that card moves`, () => {
    const game = interfBoard();
    interfere(game);
    putOnTop(game, key);
    assert.equal(deckOf(game.engine, P2)[0], game.id(key));
    for (const other of ["ph0", "ph1", "ph2"].filter((k) => k !== key)) assert.equal(zoneOf(game.engine, game.id(other)), "hand", `${other} stays in hand`);
    assert.equal(zoneOf(game.engine, game.id("opp")), "hand");
  });
}

function putOnTopAttempt(game: ReturnType<typeof interfBoard>, cardId: CardInstanceId): () => void {
  return () => game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
}

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

clause(INTERFERENCE, "0:ability", "'must put a card': the owner has a card in hand, so putting nothing on top is refused", () => {
  const game = interfBoard();
  interfere(game);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  refused(
    () => game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [] } } as never),
    "'must put a card from their hand on top' cannot be declined"
  );
});

clause(INTERFERENCE, "0:ability", "exactly one card is put on top: two are refused", () => {
  const game = interfBoard();
  interfere(game);
  refused(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [game.id("ph0"), game.id("ph1")] } } as never)
  );
  assert.equal(deckOf(game.engine, P2).length, 2, "nothing moved");
});

clause(INTERFERENCE, "0:ability", "costs 3 and needs [O]: one resource short, or no [O], is refused; exactly 3 with one [O] works", () => {
  const short = interfBoard({ obsession: 2 });
  playRaw(short.engine, P2, short.id("opp"));
  refused(() => playRaw(short.engine, P1, short.id("vi")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("vi")), "hand");
  assert.equal(ready(short.engine), 2, "nothing was spent");

  const noThreshold = interfBoard({ obsession: 0, greed: 5 });
  playRaw(noThreshold.engine, P2, noThreshold.id("opp"));
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("vi")), "no [O]");

  const exact = interfBoard({ obsession: 1, greed: 2 });
  playRaw(exact.engine, P2, exact.id("opp"));
  const before = ready(exact.engine);
  playRaw(exact.engine, P1, exact.id("vi"));
  assert.equal(before - ready(exact.engine), 3, "pays exactly 3, as a cost when it is played");
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("opp")), "hand");
});

clause(INTERFERENCE, "0:ability", "only in response to a card being played: with nothing being played (a quiet board) it cannot be played", () => {
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
  assert.equal(game.engine.getCardPlayability(P1, game.id("vi")).playable, false, "I cannot respond to my own action, so the Interference is not playable");
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
      ...fillers("od", 2, P2, "deck"),
      ...bank("obsession", 3, P1)
    ]
  });
  game.engine.perform({ type: "activateAbility", playerId: P2, cardId: game.id("drawer"), abilityId: "draw1", selected: {}, variables: {} } as never);
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond to the ability");
  refused(() => playRaw(game.engine, P1, game.id("vi")), "an ability is not a card being played: its own response condition is unmet", /cannot be deployed right now/);
  assert.equal(zoneOf(game.engine, game.id("vi")), "hand");
});

clause(INTERFERENCE, "0:ability", "it cannot be played in response to the opponent ending their turn", () => {
  const game = interfBoard();
  game.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond to the end of turn");
  refused(() => playRaw(game.engine, P1, game.id("vi")), "ending the turn is not a card being played");
  assert.equal(zoneOf(game.engine, game.id("vi")), "hand");
});

clause(INTERFERENCE, "0:ability", "it cannot be played in response to an attack being declared", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "vi", def: printing(INTERFERENCE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("obsession", 3, P1)
    ]
  });
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [game.id("atk")], target: factionOfP1 });
  game.engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond during the attack");
  refused(() => playRaw(game.engine, P1, game.id("vi")), "an attack is not a card being played: its own response condition is unmet", /cannot be deployed right now/);
  assert.equal(zoneOf(game.engine, game.id("vi")), "hand");
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
  // The put-on-top is mandatory now (SYS-20), so the owner gives a real answer: a card of theirs from hand.
  drain(game.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [game.id("ph0")] } : declineAll(pc)));
  assert.equal(zoneOf(game.engine, game.id("x")), "hand", "the opponent's tactic (the card responded to) is back in its owner's hand");
  assert.equal(discardOf(game.engine, P2).includes(game.id("x")), false);
  assert.equal(zoneOf(game.engine, game.id("mine")), "play", "the kill tactic did not resolve");
  assert.equal(game.engine.getStat(game.id("mine"), "strength"), 4, "my own pump, played earlier in the chain, still resolved");
  assert.equal(zoneOf(game.engine, game.id("pump")), "discard", "and went to the discard pile as normal");
});

clause(INTERFERENCE, "0:ability", "in a chain, the owner of the bounced response (the opponent) is the one who puts a card on top of their deck", () => {
  const game = chainOne();
  chainOneRun(game);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the bounced card is the opponent's tactic, so the opponent chooses");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("ph0")] });
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

clause(INTERFERENCE, "0:ability", "the opponent's Interference answering MY response bounces my response to MY hand, and their own earlier character still resolves", () => {
  const game = chainTwo();
  chainTwoRun(game);
  // The put-on-top is mandatory now (SYS-20), so the owner gives a real answer: a card of theirs from hand.
  drain(game.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [game.id("mine1")] } : declineAll(pc)));
  assert.equal(zoneOf(game.engine, game.id("resp")), "hand", "my response was put into MY hand");
  assert.ok(handOf(game.engine, P1).includes(game.id("resp")), "handOf(game.engine, P1).includes(game.id(\"resp\"))");
  assert.equal(game.engine.getStat(game.id("victim"), "strength"), 1, "my pump did not resolve");
  assert.equal(zoneOf(game.engine, game.id("opp")), "play", "the opponent's own character still resolved");
});

clause(INTERFERENCE, "0:ability", "'its owner' is whoever owns the bounced card: when the opponent bounces MY response, I put a card of mine on top of MY deck", () => {
  const game = chainTwo();
  chainTwoRun(game);
  const pc = pending(game.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I am the owner of the bounced response, so I choose the card to put on top");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mine1")] });
  assert.equal(deckOf(game.engine, P1)[0], game.id("mine1"), "a card of my hand is on top of MY deck");
});

// --- Anesthetizing Opulence --------------------------------------------------------
// COST: Pick a character. EFFECT: Destroy the character. Your opponent draws a card.
// Tactic (banker), cost 4, threshold [G][G].

const OPULENCE = "9540ce6d-7f45-4fd9-8f71-093a8e438d50";

function opulenceBoard(opts: { greed?: number; rage?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ao", def: printing(OPULENCE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "foeItm", def: item({ name: "FoeItm" }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...fillers("mineh", 2, P1, "hand"),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", opts.greed ?? 4, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(OPULENCE, "0:ability", "destroys the picked opposing character (into its owner's discard pile); the OPPONENT draws exactly one card, I do not", () => {
  const { engine, id } = opulenceBoard();
  const top = deckOf(engine, P2)[0];
  const myHand = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const before = ready(engine);
  play(engine, P1, id("ao"), { selected: { c: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard", "the picked character was destroyed");
  assert.ok(discardOf(engine, P2).includes(id("foe")), "into its owner's discard pile");
  assert.equal(handOf(engine, P2).length, oppHand + 1, "the opponent drew exactly one card");
  assert.equal(zoneOf(engine, top), "hand", "the top card of their deck");
  assert.equal(deckOf(engine, P2).length, 2);
  assert.equal(handOf(engine, P1).length, myHand - 1, "my hand only lost the tactic: I drew nothing");
  assert.equal(deckOf(engine, P1).length, 3, "my deck is untouched");
  assert.equal(before - ready(engine), 4, "the numeric cost of 4 is paid");
  assert.equal(zoneOf(engine, id("ao")), "discard", "the tactic goes to its owner's discard pile");
  assert.equal(zoneOf(engine, id("mine")), "play", "my own character is untouched");
});

clause(OPULENCE, "0:ability", "a character of MINE can be picked too: it is destroyed and my opponent (not me) still draws", () => {
  const { engine, id } = opulenceBoard();
  const top = deckOf(engine, P2)[0];
  play(engine, P1, id("ao"), { selected: { c: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, top), "hand", "the opponent drew");
  assert.equal(deckOf(engine, P1).length, 3, "I did not draw");
  assert.equal(zoneOf(engine, id("foe")), "play", "their character is untouched");
});

clause(OPULENCE, "0:ability", "a character I control but the opponent owns is destroyed into its OWNER's discard pile", () => {
  const { engine, id } = opulenceBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  play(engine, P1, id("ao"), { selected: { c: [id("stolen")] } });
  assert.equal(zoneOf(engine, id("stolen")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("stolen")), "discardOf(engine, P2).includes(id(\"stolen\"))");
  assert.equal(discardOf(engine, P1).includes(id("stolen")), false);
});

clause(OPULENCE, "0:ability", "'Pick a character' is a COST: a pick is required to play it, and it is made before the opponent can respond", () => {
  const { engine, id } = opulenceBoard();
  refused(() => playRaw(engine, P1, id("ao")), "no pick, no play");
  assert.equal(zoneOf(engine, id("ao")), "hand");
  assert.equal(ready(engine), 4, "nothing was spent by the refused play");
  const oppHand = handOf(engine, P2).length;
  playRaw(engine, P1, id("ao"), { selected: { c: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(ready(engine), 0, "the 4 resources are paid already");
  assert.equal(zoneOf(engine, id("foe")), "play", "the effect (destroy) has not happened yet");
  assert.equal(handOf(engine, P2).length, oppHand, "nor has the opponent's draw");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(handOf(engine, P2).length, oppHand + 1);
});

clause(OPULENCE, "0:ability", "only a character can be picked: not an item, a location, a resource, a face-down card, a faction or a card outside play", () => {
  const { engine, id } = opulenceBoard();
  const resourceId = engine.state.players[P1].play.find((card) => engine.getDefinition(card).type === "resource")!;
  const attempt = (cardId: CardInstanceId) => () => playRaw(engine, P1, id("ao"), { selected: { c: [cardId] } });
  refused(attempt(id("itm")), "my item");
  refused(attempt(id("foeItm")), "their item");
  refused(attempt(id("loc")), "a location");
  refused(attempt(resourceId), "a face-up resource");
  refused(attempt(id("hidden")), "a face-down card");
  refused(attempt(factionOf(engine, P1)), "my faction");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(attempt(id("inHand")), "a character in a hand");
  refused(attempt(id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(engine, id("ao")), "hand", "nothing was played");
  assert.equal(ready(engine), 4, "nothing was spent");
  attempt(id("foe"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(OPULENCE, "0:ability", "exactly one character is picked: two are refused", () => {
  const { engine, id } = opulenceBoard();
  refused(() => playRaw(engine, P1, id("ao"), { selected: { c: [id("foe"), id("mine")] } }));
  assert.equal(zoneOf(engine, id("ao")), "hand");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(OPULENCE, "0:ability", "an opponent with an empty deck: the character is still destroyed and nothing breaks", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ao", def: printing(OPULENCE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("ao"), { selected: { c: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(handOf(engine, P2).length, 0);
  assert.equal(pending(engine), undefined);
});

clause(OPULENCE, "0:ability", "if the picked character left play in response, nothing is destroyed but the opponent still draws (effects do not fizzle, CR 402.5a)", () => {
  const { engine, id } = opulenceBoard({
    extra: [{ key: "bounce", def: bounce(), owner: P2, zone: "hand" }]
  });
  const top = deckOf(engine, P2)[0];
  playRaw(engine, P1, id("ao"), { selected: { c: [id("foe")] } });
  playRaw(engine, P2, id("bounce"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand", "the bounced character is in its owner's hand: it is not fetched back and destroyed (CR 402.4)");
  assert.equal(discardOf(engine, P2).includes(id("foe")), false);
  assert.equal(zoneOf(engine, top), "hand", "the opponent still drew a card");
});

clause(OPULENCE, "0:ability", "can be played in response on the opponent's turn (it is a tactic)", () => {
  const { engine, id } = opulenceBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 2, P2)]
  });
  refused(() => playRaw(engine, P1, id("ao"), { selected: { c: [id("foe")] } }), "nothing to respond to yet");
  playRaw(engine, P2, id("opp"));
  playRaw(engine, P1, id("ao"), { selected: { c: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("opp")), "play", "their character still resolved");
});

clause(OPULENCE, "0:ability", "costs 4 and needs [G][G]: one resource short, or one [G] only, is refused; exactly 4 with two [G] works", () => {
  const short = opulenceBoard({ greed: 3 });
  refused(() => playRaw(short.engine, P1, short.id("ao"), { selected: { c: [short.id("foe")] } }), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("ao")), "hand");
  assert.equal(ready(short.engine), 3, "nothing spent");

  const oneG = opulenceBoard({ greed: 1, rage: 5 });
  refused(() => playRaw(oneG.engine, P1, oneG.id("ao"), { selected: { c: [oneG.id("foe")] } }), "only one [G]");

  const exact = opulenceBoard({ greed: 2, rage: 2 });
  play(exact.engine, P1, exact.id("ao"), { selected: { c: [exact.id("foe")] } });
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "discard");
});

// --- Clandestine Resort ------------------------------------------------------------
// All your characters gain 1 life.
// Location (banker), cost 1, threshold [G][G], structure 5.

const RESORT = "9ee4edbf-5c5a-4730-8e47-1208cacab083";

function resortBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "resort", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "C2", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2, speed: 3 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 4 }), owner: P1, zone: "play" },
      ...extra
    ]
  });
}

clause(RESORT, "0:rule", "every character I control gains exactly 1 life (strength and speed are unchanged)", () => {
  const { engine, id } = resortBoard();
  assert.deepEqual(stats(engine, id("c1")), [2, 3, 3], "2 life +1");
  assert.deepEqual(stats(engine, id("c2")), [1, 6, 1], "5 life +1");
});

clause(RESORT, "0:rule", "the opponent's characters do not gain life", () => {
  const { engine, id } = resortBoard();
  assert.deepEqual(stats(engine, id("foe")), [2, 2, 3]);
});

clause(RESORT, "0:rule", "only characters gain life: the structure of my location and the Resort itself are unchanged", () => {
  const { engine, id } = resortBoard();
  // structure 4 location: 3 damage does not destroy it, 4 does (no bonus)
  engine.state.cards[id("loc")].damage = 3;
  assert.equal(zoneOf(engine, id("loc")), "play");
  assert.equal(engine.getStat(id("loc"), "structure"), 4);
  assert.equal(engine.getStat(id("resort"), "structure"), 5, "the Resort's own structure is its printed 5");
});

clause(RESORT, "0:rule", "a character that enters play later also gains the life", () => {
  const { engine, id } = resortBoard([
    { key: "newbie", def: character({ name: "Newbie", cost: 1, life: 2 }), owner: P1, zone: "hand" },
    ...bank("rage", 1, P1)
  ]);
  play(engine, P1, id("newbie"));
  assert.equal(zoneOf(engine, id("newbie")), "play");
  assert.equal(engine.getStat(id("newbie"), "life"), 3);
});

clause(RESORT, "0:rule", "the extra life is real: a 2-life character survives 2 damage with the Resort, and dies to 3", () => {
  const survives = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "resort", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1", life: 2 }), owner: P1, zone: "play" },
      { key: "zap", def: damageTactic(2), owner: P1, zone: "hand" }
    ]
  });
  play(survives.engine, P1, survives.id("zap"), { selected: { t: [survives.id("c1")] } });
  assert.equal(zoneOf(survives.engine, survives.id("c1")), "play", "2 damage < 3 life");
  assert.equal(damageOf(survives.engine, survives.id("c1")), 2);

  const dies = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "resort", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1", life: 2 }), owner: P1, zone: "play" },
      { key: "zap", def: damageTactic(3), owner: P1, zone: "hand" }
    ]
  });
  play(dies.engine, P1, dies.id("zap"), { selected: { t: [dies.id("c1")] } });
  assert.equal(zoneOf(dies.engine, dies.id("c1")), "discard", "3 damage >= 3 life");
});

clause(RESORT, "0:rule", "it ends when the Resort leaves play: a character holding damage equal to its printed life is destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "resort", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1", life: 2 }), owner: P1, zone: "play", damage: 2 },
      { key: "c2", def: character({ name: "C2", life: 4 }), owner: P1, zone: "play", damage: 1 },
      { key: "smash", def: locationDamageTactic(5), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(zoneOf(engine, id("c1")), "play", "2 damage on a 3-life character");
  assert.equal(engine.getStat(id("c1"), "life"), 3);
  play(engine, P1, id("smash"), { selected: { t: [id("resort")] } });
  assert.equal(zoneOf(engine, id("resort")), "discard", "the Resort was destroyed");
  assert.equal(engine.getStat(id("c2"), "life"), 4, "back to the printed life");
  assert.equal(zoneOf(engine, id("c2")), "play", "1 damage on a 4-life character is fine");
  assert.equal(zoneOf(engine, id("c1")), "discard", "2 damage on a now 2-life character destroys it");
});

clause(RESORT, "0:rule", "it ends when the Resort is returned to hand", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "resort", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1", life: 2 }), owner: P1, zone: "play" },
      {
        key: "bounceLoc",
        def: tactic({ name: "BounceLoc", cost: 0, behavior: { abilities: [{ id: "bl", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  assert.equal(engine.getStat(id("c1"), "life"), 3);
  play(engine, P1, id("bounceLoc"), { selected: { t: [id("resort")] } });
  assert.equal(zoneOf(engine, id("resort")), "hand");
  assert.equal(engine.getStat(id("c1"), "life"), 2);
});

clause(RESORT, "0:rule", "a Resort that is not in play (in hand, in a discard pile) gives nothing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "inHand", def: printing(RESORT), owner: P1, zone: "hand" },
      { key: "inDiscard", def: printing(RESORT), owner: P1, zone: "discard" },
      { key: "c1", def: character({ name: "C1", life: 2 }), owner: P1, zone: "play" }
    ]
  });
  assert.equal(engine.getStat(id("c1"), "life"), 2);
});

clause(RESORT, "0:rule", "two Resorts stack: each one gives +1 life", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "r1", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "r2", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1", life: 2 }), owner: P1, zone: "play" }
    ]
  });
  assert.equal(engine.getStat(id("c1"), "life"), 4);
});

clause(RESORT, "0:rule", "'your' is the Resort's controller: the opponent's own Resort buffs only their characters", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "theirs", def: printing(RESORT), owner: P2, zone: "play" },
      { key: "c1", def: character({ name: "C1", life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 2 }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(engine.getStat(id("foe"), "life"), 3);
  assert.equal(engine.getStat(id("c1"), "life"), 2, "my characters do not gain from the opponent's Resort");
});

clause(RESORT, "0:rule", "a Resort the opponent owns but I control buffs MY characters, not theirs", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "stolen", def: printing(RESORT), owner: P2, zone: "play", controller: P1 },
      { key: "c1", def: character({ name: "C1", life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 2 }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(engine.getStat(id("c1"), "life"), 3);
  assert.equal(engine.getStat(id("foe"), "life"), 2);
});

clause(RESORT, "0:rule", "'your characters' is about control: a character I control but the opponent owns gains life, one I own but they control does not", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "resort", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "borrowed", def: character({ name: "Borrowed", life: 2 }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent", life: 2 }), owner: P1, zone: "play", controller: P2 }
    ]
  });
  assert.equal(engine.getStat(id("borrowed"), "life"), 3);
  assert.equal(engine.getStat(id("lent"), "life"), 2);
});

clause(RESORT, "0:rule", "a face-down card is a resource, not a character: it does not gain the life", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "resort", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", life: 2 }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  assert.deepEqual(engine.getCardTypes(id("hidden")), ["resource"]);
  assert.notEqual(engine.getStat(id("hidden"), "life"), 3, "a face-down card is not one of 'your characters': no +1 life");
});

clause(RESORT, "0:rule", "the Resort is a location with 5 structure: 4 damage leaves it in play, 5 destroys it", () => {
  const four = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "resort", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "smash", def: locationDamageTactic(4), owner: P1, zone: "hand" }
    ]
  });
  play(four.engine, P1, four.id("smash"), { selected: { t: [four.id("resort")] } });
  assert.equal(zoneOf(four.engine, four.id("resort")), "play");
  assert.equal(damageOf(four.engine, four.id("resort")), 4);

  const five = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "resort", def: printing(RESORT), owner: P1, zone: "play" },
      { key: "smash", def: locationDamageTactic(5), owner: P1, zone: "hand" }
    ]
  });
  play(five.engine, P1, five.id("smash"), { selected: { t: [five.id("resort")] } });
  assert.equal(zoneOf(five.engine, five.id("resort")), "discard");
});

clause(RESORT, "0:rule", "costs 1 with [G][G]: refused with no resource, or with only one [G]", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "resort", def: printing(RESORT), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("resort"));
  assert.equal(zoneOf(exact.engine, exact.id("resort")), "play");
  assert.equal(before - ready(exact.engine), 1, "pays exactly 1");

  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "resort", def: printing(RESORT), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("resort")), "[G][G] needs two Greed");
  const none = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "resort", def: printing(RESORT), owner: P1, zone: "hand" }]
  });
  refused(() => playRaw(none.engine, P1, none.id("resort")), "no resources");
});

// --- Class Action Defender ---------------------------------------------------------
// If any amount of damage greater than 4 would be inflicted to this card, inflict no damage instead.
// If you are attacked, you may pay 2. If you do, restore this card.
// Character (banker; lawyer, mau), cost 3, threshold [G][G][G], 2 strength / 3 speed / 3 life.

const DEFENDER = "727008d3-b9eb-4add-9e67-72ec4d1b6937";

/** A gear item that adds `amount` life to the attached character (to make a Defender able to absorb real damage). */
function lifeBoost(amount: number): CardDefinition {
  return item({
    name: `LifeBoost${amount}`,
    attachTo: "character",
    behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: amount }] }] }
  });
}

/** An item that draws its controller a card whenever any damage is inflicted (a witness for 'damage was inflicted'). */
function damageWitness(): CardDefinition {
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

for (const [amount, expected] of DAMAGE_ON_DEFENDER) {
  clause(DEFENDER, "0:rule", `a damage tactic of ${amount} on a Defender with 20 life: ${expected === 0 ? "no damage is inflicted (more than 4)" : `${expected} damage is inflicted (4 or less)`}`, () => {
    const { engine, id } = defenderBoard({ boost: 17, extra: [{ key: "zap", def: damageTactic(amount), owner: P1, zone: "hand" }] });
    assert.equal(engine.getStat(id("cad"), "life"), 20);
    play(engine, P1, id("zap"), { selected: { t: [id("cad")] } });
    assert.equal(damageOf(engine, id("cad")), expected);
    assert.equal(zoneOf(engine, id("cad")), "play");
  });
}

clause(DEFENDER, "0:rule", "an Ally with the same 20 life takes the full 9 damage: only this card has the clause", () => {
  const { engine, id } = defenderBoard({ extra: [{ key: "zap", def: damageTactic(9), owner: P1, zone: "hand" }] });
  play(engine, P1, id("zap"), { selected: { t: [id("ally")] } });
  assert.equal(damageOf(engine, id("ally")), 9);
});

clause(DEFENDER, "0:rule", "damage of 4 or less is inflicted and destroys a plain 3-life Defender; damage over 4 does not (unprotected 3 life survives 5)", () => {
  const four = defenderBoard({ extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  play(four.engine, P1, four.id("zap"), { selected: { t: [four.id("cad")] } });
  assert.equal(zoneOf(four.engine, four.id("cad")), "discard", "4 damage destroys the 3-life Defender");
  const five = defenderBoard({ extra: [{ key: "zap", def: damageTactic(5), owner: P1, zone: "hand" }] });
  play(five.engine, P1, five.id("zap"), { selected: { t: [five.id("cad")] } });
  assert.equal(zoneOf(five.engine, five.id("cad")), "play", "5 damage is not inflicted: the Defender survives");
  assert.equal(damageOf(five.engine, five.id("cad")), 0);
});

clause(DEFENDER, "0:rule", "damage from the OPPONENT'S tactic is prevented too ('any amount of damage')", () => {
  const { engine, id } = defenderBoard({ turn: 2, active: P2, extra: [{ key: "zap", def: damageTactic(7), owner: P2, zone: "hand" }] });
  play(engine, P2, id("zap"), { selected: { t: [id("cad")] } });
  assert.equal(zoneOf(engine, id("cad")), "play");
  assert.equal(damageOf(engine, id("cad")), 0);
});

clause(DEFENDER, "0:rule", "'inflict no damage' means nothing triggers off the damage (CR 408.1a): the witness sees 4 damage but not 5", () => {
  const four = defenderBoard({ boost: 17, extra: [{ key: "zap", def: damageTactic(4), owner: P1, zone: "hand" }] });
  const deckBefore = deckOf(four.engine, P1).length;
  play(four.engine, P1, four.id("zap"), { selected: { t: [four.id("cad")] } });
  assert.equal(deckBefore - deckOf(four.engine, P1).length, 1, "control: the witness triggered on 4 damage");
  const five = defenderBoard({ boost: 17, extra: [{ key: "zap", def: damageTactic(5), owner: P1, zone: "hand" }] });
  play(five.engine, P1, five.id("zap"), { selected: { t: [five.id("cad")] } });
  assert.equal(deckOf(five.engine, P1).length, 6, "5 damage was prevented: no damage event, no trigger");
});

clause(DEFENDER, "0:rule", "battle damage over 4 from one attacker is prevented (5 strength)", () => {
  const { engine, id } = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cad")], () => id("cad"));
  assert.equal(damageOf(engine, id("cad")), 0, "5 battle damage inflicts nothing");
  assert.equal(zoneOf(engine, id("cad")), "play");
  assert.equal(damageOf(engine, id("atk")), 2, "the Defender still deals its 2 strength");
});

clause(DEFENDER, "0:rule", "battle damage of exactly 4 is inflicted", () => {
  const { engine, id } = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cad")], () => id("cad"));
  assert.equal(damageOf(engine, id("cad")), 4);
});

clause(DEFENDER, "0:rule", "damage from several characters in one step is summed first (CR 609.1f): 3 + 3 = 6 is more than 4 and is prevented", () => {
  const { engine, id } = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [
      { key: "a1", def: character({ name: "A1", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  fightAssign(engine, P2, [id("a1"), id("a2")], factionOfP1, [id("cad")], () => id("cad"));
  assert.equal(damageOf(engine, id("cad")), 0, "the single combined amount of 6 is prevented");
});

clause(DEFENDER, "0:rule", "damage from several characters in one step is summed first: 2 + 2 = 4 is inflicted in full", () => {
  const { engine, id } = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [
      { key: "a1", def: character({ name: "A1", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  fightAssign(engine, P2, [id("a1"), id("a2")], factionOfP1, [id("cad")], () => id("cad"));
  assert.equal(damageOf(engine, id("cad")), 4);
});

clause(DEFENDER, "0:rule", "each damage instance is judged on its own: instances of 3 and 3 in different speed steps (6 in all) are both inflicted", () => {
  const { engine, id } = defenderBoard({
    boost: 17,
    turn: 2,
    active: P2,
    extra: [
      { key: "fast", def: character({ name: "Fast", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "slow", def: character({ name: "Slow", strength: 3, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  fightAssign(engine, P2, [id("fast"), id("slow")], factionOfP1, [id("cad")], () => id("cad"));
  assert.equal(damageOf(engine, id("cad")), 6, "two separate instances of 3 (each 4 or less)");
});

clause(DEFENDER, "0:rule", "a Defender that is attacking is protected as well", () => {
  const { engine, id } = defenderBoard({
    boost: 17,
    turn: 1,
    active: P1,
    extra: [{ key: "blk", def: character({ name: "Blocker", strength: 6, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightAssign(engine, P1, [id("cad")], factionOfP2, [id("blk")], () => id("blk"));
  assert.equal(damageOf(engine, id("cad")), 0, "6 battle damage from the blocker is prevented");
  assert.equal(damageOf(engine, id("blk")), 2);
});

clause(DEFENDER, "0:rule", "the prevention is the card's own: an opposing Defender protects only itself", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cad", def: printing(DEFENDER), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 20 }), owner: P2, zone: "play" },
      { key: "zap", def: damageTactic(6), owner: P1, zone: "hand" },
      { key: "zap2", def: damageTactic(6), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zap"), { selected: { t: [id("foe")] } });
  assert.equal(damageOf(engine, id("foe")), 6, "the neighbour takes the full damage");
  play(engine, P1, id("zap2"), { selected: { t: [id("cad")] } });
  assert.equal(damageOf(engine, id("cad")), 0);
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
  const { engine, id } = braceBoard();
  assert.equal(isDepleted(engine, id("cad")), true);
  const before = ready(engine);
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: factionOfP1 });
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay", "I am offered the payment");
  assert.equal(pc?.playerId, P1, "the Defender's controller decides");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(isDepleted(engine, id("cad")), false, "restored");
  assert.equal(before - ready(engine), 2, "exactly 2 resources paid");
});

clause(DEFENDER, "1:rule", "declining the payment: nothing is paid and the Defender stays depleted", () => {
  const { engine, id } = braceBoard();
  const before = ready(engine);
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: factionOfP1 });
  assert.equal(pending(engine)?.kind, "mayPay");
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(isDepleted(engine, id("cad")), true, "'If you do, restore': not paying means not restoring");
  assert.equal(ready(engine), before, "no resource was spent");
});

clause(DEFENDER, "1:rule", "a restored Defender can block the attack; a declined one (still depleted) cannot", () => {
  const paid = braceBoard();
  declareAttackBy(paid.engine, P2, [paid.id("atk")], factionOfP1);
  if (pending(paid.engine)) answerPending(paid.engine, "mayPay", { pay: true });
  resolvePendingResponses(paid.engine);
  paid.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [paid.id("cad")] });
  assert.deepEqual(battleOf(paid.engine)?.blockingParty, [paid.id("cad")], "restored: it blocks");

  const declined = braceBoard();
  declareAttackBy(declined.engine, P2, [declined.id("atk")], factionOfP1);
  if (pending(declined.engine)) answerPending(declined.engine, "mayPay", { pay: false });
  resolvePendingResponses(declined.engine);
  refused(() => declined.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [declined.id("cad")] }), "depleted: it cannot block");
});

clause(DEFENDER, "1:rule", "'attacked' includes an attack on a location I control (CR 302.2: being attacked means a faction or location they control is the target)", () => {
  const { engine, id } = braceBoard();
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "card", cardId: id("loc") } });
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay", "an attack on my location also offers the payment");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(isDepleted(engine, id("cad")), false);
});

clause(DEFENDER, "1:rule", "with only 1 ready resource I cannot pay 2: the Defender stays depleted and nothing is spent", () => {
  const { engine, id } = braceBoard({ resources: 1 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: factionOfP1 });
  const pc = pending(engine);
  if (pc) {
    refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } } as never), "cannot pay 2 with 1 resource");
    answerPending(engine, "mayPay", { pay: false });
  }
  assert.equal(isDepleted(engine, id("cad")), true);
  assert.equal(ready(engine), 1);
});

clause(DEFENDER, "1:rule", "exactly 2 ready resources is enough", () => {
  const { engine, id } = braceBoard({ resources: 2 });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: factionOfP1 });
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(isDepleted(engine, id("cad")), false);
  assert.equal(ready(engine), 0);
});

clause(DEFENDER, "1:rule", "when I attack, nobody is 'attacked' on my side: the Defender does not offer the payment", () => {
  const { engine, id } = buildGame({
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
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: factionOfP2 });
  assert.equal(pending(engine), undefined, "no offer");
  resolvePendingResponses(engine);
  assert.equal(isDepleted(engine, id("cad")), true);
  assert.equal(ready(engine), 3);
});

clause(DEFENDER, "1:rule", "the opponent's Defender reacts when I attack THEM: the offer goes to its controller", () => {
  const { engine, id } = buildGame({
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
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: factionOfP2 });
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "P2 controls the Defender");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(isDepleted(engine, id("cad")), false);
  assert.equal(ready(engine, P2), 1, "P2 paid 2 of 3");
  assert.equal(ready(engine, P1), 0);
});

clause(DEFENDER, "1:rule", "two Defenders each offer the payment: paying for both costs 4 and restores both", () => {
  const { engine, id } = braceBoard({
    resources: 4,
    extra: [{ key: "cad2", def: printing(DEFENDER), owner: P1, zone: "play", depleted: true }]
  });
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: factionOfP1 });
  let answered = 0;
  drain(engine, (pc) => {
    if (pc.kind === "mayPay") {
      answered++;
      return { kind: "mayPay", pay: true };
    }
    return declineAll(pc);
  });
  assert.equal(answered, 2, "one offer per Defender");
  assert.equal(isDepleted(engine, id("cad")), false);
  assert.equal(isDepleted(engine, id("cad2")), false);
  assert.equal(ready(engine), 0, "2 + 2 resources paid");
});

clause(DEFENDER, "1:rule", "every attack on me offers it again (a second battle in the same turn)", () => {
  const { engine, id } = braceBoard({
    resources: 4,
    extra: [{ key: "atk2", def: character({ name: "Attacker2", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(engine, P2, [id("atk")], factionOfP1);
  if (pending(engine)) answerPending(engine, "mayPay", { pay: true });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(engine);
  engine.state.cards[id("cad")].depleted = true;
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk2")], target: factionOfP1 });
  assert.equal(pending(engine)?.kind, "mayPay", "the second attack offers the payment again");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(isDepleted(engine, id("cad")), false);
  assert.equal(ready(engine), 0);
});

clause(DEFENDER, "1:rule", "costs 3 with [G][G][G]; has 2 strength / 3 speed / 3 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "cad", def: printing(DEFENDER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("cad"));
  assert.equal(zoneOf(exact.engine, exact.id("cad")), "play");
  assert.equal(before - ready(exact.engine), 3);
  assert.deepEqual(stats(exact.engine, exact.id("cad")), [2, 3, 3]);

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
  refused(() => playRaw(twoG.engine, P1, twoG.id("cad")), "only two [G] of the three", /Threshold requirements are not met/);
});

// --- Club Mau Bouncer --------------------------------------------------------------
// If a character inflicts damage to this card, inflict 1 damage to that character.
// Character (banker; mercenary, mau), cost 4, threshold [G][G], 2 strength / 3 speed / 4 life.

const BOUNCER = "b4c2aed3-d9f8-4ac6-b4a0-8b97136f20b0";

/** P2 attacks (turn 2) into P1's Bouncer (`cmb`); P2's attacker is `atk`. */
function bouncerDefends(opts: { attacker?: Partial<CardDefinition>; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cmb", def: printing(BOUNCER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 5, speed: 3, ...opts.attacker }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(BOUNCER, "0:rule", "a character that damages the Bouncer in battle takes 1 damage back", () => {
  const { engine, id } = bouncerDefends();
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cmb")], () => id("cmb"));
  assert.equal(damageOf(engine, id("cmb")), 2, "the Bouncer took the attacker's 2 battle damage");
  assert.equal(damageOf(engine, id("atk")), 3, "the attacker took the Bouncer's own 2 battle damage plus the 1 retaliation");
});

clause(BOUNCER, "0:rule", "the retaliation is exactly 1, whatever the damage amount was (3 strength inflicted, still 1 back)", () => {
  const { engine, id } = bouncerDefends({ attacker: { strength: 3 } });
  // The Bouncer is the only blocker; make its own strength irrelevant by looking at the damage the attacker takes.
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cmb")], () => id("cmb"));
  assert.equal(damageOf(engine, id("cmb")), 3);
  assert.equal(damageOf(engine, id("atk")), 3, "2 (battle) + 1 (retaliation), not 3 + 2");
});

clause(BOUNCER, "0:rule", "retaliation is not battle damage and is on top of it: with the Bouncer's strength zeroed the attacker takes only the 1", () => {
  const { engine, id } = bouncerDefends({
    extra: [{ key: "gag", def: item({ name: "Gag", attachTo: "character", behavior: { abilities: [{ id: "gag", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -2 }] }] } }), owner: P2, zone: "play", attachedToKey: "cmb" }]
  });
  assert.equal(engine.getStat(id("cmb"), "strength"), 0);
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cmb")], () => id("cmb"));
  assert.equal(damageOf(engine, id("cmb")), 2);
  assert.equal(damageOf(engine, id("atk")), 1, "only the retaliation");
});

clause(BOUNCER, "0:rule", "the retaliation can destroy the damaging character (1 life attacker)", () => {
  const { engine, id } = bouncerDefends({
    attacker: { strength: 2, life: 1, speed: 1 },
    extra: [{ key: "gag", def: item({ name: "Gag", attachTo: "character", behavior: { abilities: [{ id: "gag", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -2 }] }] } }), owner: P2, zone: "play", attachedToKey: "cmb" }]
  });
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cmb")], () => id("cmb"));
  assert.equal(zoneOf(engine, id("atk")), "discard", "1 retaliation damage destroyed the 1-life attacker");
  assert.equal(zoneOf(engine, id("cmb")), "play");
});

clause(BOUNCER, "0:rule", "the Bouncer destroyed by the damage still hits back (the trigger happens when the damage is inflicted)", () => {
  const { engine, id } = bouncerDefends({ attacker: { strength: 6, life: 5, speed: 3 } });
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cmb")], () => id("cmb"));
  assert.equal(zoneOf(engine, id("cmb")), "discard", "6 damage destroyed the 4-life Bouncer");
  assert.equal(damageOf(engine, id("atk")), 3, "the attacker still took the retaliation (2 battle damage + 1)");
});

clause(BOUNCER, "0:rule", "when the Bouncer attacks and the blocker damages it, the blocker takes 1 back", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "cmb", def: printing(BOUNCER), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 2, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  fightAssign(engine, P1, [id("cmb")], factionOfP2, [id("blk")], () => id("blk"));
  assert.equal(damageOf(engine, id("cmb")), 2);
  assert.equal(damageOf(engine, id("blk")), 3, "2 battle damage from the Bouncer plus the 1 retaliation");
});

clause(BOUNCER, "0:rule", "each character that inflicts damage to the Bouncer takes 1 back: two attackers, 1 each", () => {
  const { engine, id } = bouncerDefends({
    extra: [{ key: "atk2", def: character({ name: "Attacker2", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightAssign(engine, P2, [id("atk"), id("atk2")], factionOfP1, [id("cmb")], () => id("cmb"));
  assert.equal(damageOf(engine, id("cmb")), 3, "2 + 1 battle damage");
  const taken = [damageOf(engine, id("atk")), damageOf(engine, id("atk2"))];
  assert.equal(taken[0] + taken[1], 2 + 1 + 1, "the Bouncer's 2 damage goes to one attacker; each of the two attackers also takes 1 retaliation");
  assert.ok(taken.every((damage) => damage >= 1), "both attackers took at least the retaliation damage");
});

clause(BOUNCER, "0:rule", "a character that deals no damage (0 strength) inflicts nothing, so nothing comes back (CR 408.1a)", () => {
  const { engine, id } = bouncerDefends({
    attacker: { strength: 0 },
    extra: [{ key: "gag", def: item({ name: "Gag", attachTo: "character", behavior: { abilities: [{ id: "gag", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: -2 }] }] } }), owner: P2, zone: "play", attachedToKey: "cmb" }]
  });
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cmb")], () => id("cmb"));
  assert.equal(damageOf(engine, id("cmb")), 0);
  assert.equal(damageOf(engine, id("atk")), 0, "no damage inflicted, no retaliation");
});

clause(BOUNCER, "0:rule", "damage to another card of mine (its ally) does not trigger it: the attacker takes no retaliation", () => {
  const { engine, id } = bouncerDefends();
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cmb"), id("ally")], (source) => (source.cardId === id("atk") ? id("ally") : undefined));
  assert.equal(damageOf(engine, id("ally")), 2, "the ally took the damage");
  assert.equal(damageOf(engine, id("cmb")), 0);
  // The attacker took the Bouncer's own 2 battle damage and the ally's 1, with no retaliation on top.
  assert.equal(damageOf(engine, id("atk")), 3, "2 (Bouncer) + 1 (ally) battle damage only: no retaliation was added");
});

clause(BOUNCER, "0:rule", "damage that is not inflicted by a character (a tactic's damage) does not hit anyone back", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cmb", def: printing(BOUNCER), owner: P1, zone: "play" },
      { key: "zap", def: damageTactic(2), owner: P2, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" }
    ]
  });
  play(engine, P2, id("zap"), { selected: { t: [id("cmb")] } });
  assert.equal(damageOf(engine, id("cmb")), 2, "the tactic damaged the Bouncer");
  assert.equal(damageOf(engine, id("foe")), 0, "the opponent's characters took nothing");
});

clause(BOUNCER, "0:rule", "damage inflicted by a character's ability counts: the zapping character takes 1 back", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cmb", def: printing(BOUNCER), owner: P1, zone: "play" },
      { key: "zapper", def: zapper("Zapper", 2), owner: P2, zone: "play" }
    ]
  });
  activate(engine, P2, id("zapper"), "zap", { selected: { t: [id("cmb")] } });
  assert.equal(damageOf(engine, id("cmb")), 2);
  assert.equal(damageOf(engine, id("zapper")), 1, "that character takes 1 damage");
});

clause(BOUNCER, "0:rule", "every damage instance hits back: two zaps, two damage", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cmb", def: printing(BOUNCER), owner: P1, zone: "play" },
      { key: "zapper", def: zapper("Zapper", 1), owner: P2, zone: "play" }
    ]
  });
  activate(engine, P2, id("zapper"), "zap", { selected: { t: [id("cmb")] } });
  activate(engine, P2, id("zapper"), "zap", { selected: { t: [id("cmb")] } });
  assert.equal(damageOf(engine, id("cmb")), 2);
  assert.equal(damageOf(engine, id("zapper")), 2);
});

clause(BOUNCER, "0:rule", "'a character' is any character: my own character that damages my Bouncer takes 1 back", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "cmb", def: printing(BOUNCER), owner: P1, zone: "play" },
      { key: "zapper", def: zapper("Zapper", 1), owner: P1, zone: "play" }
    ]
  });
  activate(engine, P1, id("zapper"), "zap", { selected: { t: [id("cmb")] } });
  assert.equal(damageOf(engine, id("zapper")), 1);
});

clause(BOUNCER, "0:rule", "the retaliation damages only that character: the attacker's controller's faction loses no influence", () => {
  const { engine, id } = bouncerDefends();
  fightAssign(engine, P2, [id("atk")], factionOfP1, [id("cmb")], () => id("cmb"));
  assert.equal(influence(engine, P2), 30);
  assert.equal(influence(engine, P1), 30);
});

clause(BOUNCER, "0:rule", "it does not trigger on the Bouncer's own damage dealt to others (the Bouncer hitting a faction)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "cmb", def: printing(BOUNCER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" }
    ]
  });
  fightAssign(engine, P1, [id("cmb")], factionOfP2, [], () => "faction");
  assert.equal(influence(engine, P2), 28, "2 battle damage to their faction");
  assert.equal(damageOf(engine, id("cmb")), 0);
  assert.equal(damageOf(engine, id("foe")), 0);
});

clause(BOUNCER, "0:rule", "costs 4 with [G][G]; has 2 strength / 3 speed / 4 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "cmb", def: printing(BOUNCER), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("cmb"));
  assert.equal(zoneOf(exact.engine, exact.id("cmb")), "play");
  assert.equal(before - ready(exact.engine), 4);
  assert.deepEqual(stats(exact.engine, exact.id("cmb")), [2, 4, 3]);

  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "cmb", def: printing(BOUNCER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("cmb")), "one resource short");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "cmb", def: printing(BOUNCER), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 5, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("cmb")), "only one [G]");
});

/** `activateAbility` WITHOUT draining the response window (to assert what is true while the ability waits for responses). */
function activateRaw(
  engine: SpoilsEngine,
  player: Pid,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

// --- Crooked Appraiser -------------------------------------------------------------
// INSPECT. COST: Deplete this card. Pick a location. EFFECT: Inflict 2 damage to the location.
// Character (banker; mau), cost 2, threshold [G], 1 strength / 3 speed / 3 life.

const APPRAISER = "4c23d2e0-da0c-4cd6-9a6c-23c43f83d5d8";

function appraiserBoard(opts: { turn?: number; active?: Pid; ca?: Partial<CardPlacement>; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ca", def: printing(APPRAISER), owner: P1, zone: "play", ...opts.ca },
      { key: "loc", def: location({ name: "FoeLoc", structure: 6 }), owner: P2, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc", structure: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "locHand", def: location({ name: "LocHand" }), owner: P2, zone: "hand" },
      { key: "locDiscard", def: location({ name: "LocDiscard" }), owner: P2, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(APPRAISER, "0:ability:inspect", "inflicts 2 damage to the picked location (an opponent's location with 6 structure takes 2 and stays in play)", () => {
  const { engine, id } = appraiserBoard();
  activate(engine, P1, id("ca"), "inspect", { selected: { loc: [id("loc")] } });
  assert.equal(damageOf(engine, id("loc")), 2, "exactly 2 damage");
  assert.equal(zoneOf(engine, id("loc")), "play");
  assert.equal(damageOf(engine, id("myLoc")), 0, "another location is untouched");
});

clause(APPRAISER, "0:ability:inspect", "my own location can be picked as well", () => {
  const { engine, id } = appraiserBoard();
  activate(engine, P1, id("ca"), "inspect", { selected: { loc: [id("myLoc")] } });
  assert.equal(damageOf(engine, id("myLoc")), 2);
  assert.equal(damageOf(engine, id("loc")), 0);
});

clause(APPRAISER, "0:ability:inspect", "'Deplete this card' is a cost: the Appraiser is depleted as soon as the ability is used, and stays depleted", () => {
  const { engine, id } = appraiserBoard();
  assert.equal(isDepleted(engine, id("ca")), false);
  activateRaw(engine, P1, id("ca"), "inspect", { loc: [id("loc")] });
  assert.equal(isDepleted(engine, id("ca")), true, "depleted while the ability waits for responses");
  assert.equal(damageOf(engine, id("loc")), 0, "the damage is the effect: not yet inflicted");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("loc")), 2);
  assert.equal(isDepleted(engine, id("ca")), true);
});

clause(APPRAISER, "0:ability:inspect", "it costs no resources: it works with none, and none are spent", () => {
  const { engine, id } = appraiserBoard();
  assert.equal(ready(engine), 0);
  activate(engine, P1, id("ca"), "inspect", { selected: { loc: [id("loc")] } });
  assert.equal(damageOf(engine, id("loc")), 2);
  const rich = appraiserBoard({ extra: bank("greed", 3, P1) });
  activate(rich.engine, P1, rich.id("ca"), "inspect", { selected: { loc: [rich.id("loc")] } });
  assert.equal(ready(rich.engine), 3, "no resource was spent");
});

clause(APPRAISER, "0:ability:inspect", "a depleted Appraiser cannot use it, and nothing is damaged", () => {
  const { engine, id } = appraiserBoard({ ca: { depleted: true } });
  refused(() => activateRaw(engine, P1, id("ca"), "inspect", { loc: [id("loc")] }));
  assert.equal(damageOf(engine, id("loc")), 0);
});

clause(APPRAISER, "0:ability:inspect", "a location with 2 structure is destroyed by the 2 damage; with 3 it survives and a second use finishes it (damage accumulates)", () => {
  const two = appraiserBoard({ extra: [{ key: "small", def: location({ name: "Small", structure: 2 }), owner: P2, zone: "play" }] });
  activate(two.engine, P1, two.id("ca"), "inspect", { selected: { loc: [two.id("small")] } });
  assert.equal(zoneOf(two.engine, two.id("small")), "discard", "2 damage >= 2 structure");

  const three = appraiserBoard({ extra: [{ key: "mid", def: location({ name: "Mid", structure: 3 }), owner: P2, zone: "play" }] });
  activate(three.engine, P1, three.id("ca"), "inspect", { selected: { loc: [three.id("mid")] } });
  assert.equal(zoneOf(three.engine, three.id("mid")), "play", "2 damage < 3 structure");
  three.engine.state.cards[three.id("ca")].depleted = false;
  activate(three.engine, P1, three.id("ca"), "inspect", { selected: { loc: [three.id("mid")] } });
  assert.equal(zoneOf(three.engine, three.id("mid")), "discard", "2 + 2 damage >= 3");
});

clause(APPRAISER, "0:ability:inspect", "a location is the only legal pick: characters, items, face-down cards, factions and locations outside play are refused", () => {
  const { engine, id } = appraiserBoard();
  const attempt = (cardId: CardInstanceId) => () => activateRaw(engine, P1, id("ca"), "inspect", { loc: [cardId] });
  refused(attempt(id("foe")), "a character");
  refused(attempt(id("ca")), "the Appraiser itself");
  refused(attempt(id("itm")), "an item");
  refused(attempt(id("hidden")), "a face-down card");
  refused(attempt(factionOf(engine, P2)), "a faction");
  refused(attempt(id("locHand")), "a location in a hand");
  refused(attempt(id("locDiscard")), "a location in a discard pile");
  assert.equal(isDepleted(engine, id("ca")), false, "the refused attempts did not deplete it");
  attempt(id("loc"))();
  assert.equal(isDepleted(engine, id("ca")), true, "control: a location is accepted");
});

clause(APPRAISER, "0:ability:inspect", "exactly one location is picked: none, or two, is refused", () => {
  const { engine, id } = appraiserBoard();
  refused(() => activateRaw(engine, P1, id("ca"), "inspect", {}), "no pick");
  refused(() => activateRaw(engine, P1, id("ca"), "inspect", { loc: [id("loc"), id("myLoc")] }), "two picks");
  assert.equal(isDepleted(engine, id("ca")), false);
});

clause(APPRAISER, "0:ability:inspect", "with no location in play it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ca", def: printing(APPRAISER), owner: P1, zone: "play" }, { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }]
  });
  refused(() => activateRaw(engine, P1, id("ca"), "inspect", {}));
  assert.equal(isDepleted(engine, id("ca")), false);
});

clause(APPRAISER, "0:ability:inspect", "the Appraiser can use it the turn it enters play (CR 204.3a), though it could not attack", () => {
  const { engine, id } = appraiserBoard({ ca: { attackEligible: false } });
  activate(engine, P1, id("ca"), "inspect", { selected: { loc: [id("loc")] } });
  assert.equal(damageOf(engine, id("loc")), 2);
});

clause(APPRAISER, "0:ability:inspect", "it can be used in response on the opponent's turn", () => {
  const { engine, id } = appraiserBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  activateRaw(engine, P1, id("ca"), "inspect", { loc: [id("loc")] });
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("loc")), 2);
  assert.equal(zoneOf(engine, id("opp")), "play");
});

clause(APPRAISER, "0:ability:inspect", "only the Appraiser's controller can use it: the opponent cannot", () => {
  const { engine, id } = appraiserBoard({ turn: 2, active: P2 });
  refused(() => activateRaw(engine, P2, id("ca"), "inspect", { loc: [id("myLoc")] }));
  assert.equal(damageOf(engine, id("myLoc")), 0);
  assert.equal(isDepleted(engine, id("ca")), false);
});

clause(APPRAISER, "0:ability:inspect", "costs 2 with [G]; has 1 strength / 3 speed / 3 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ca", def: printing(APPRAISER), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("ca"));
  assert.equal(zoneOf(exact.engine, exact.id("ca")), "play");
  assert.equal(before - ready(exact.engine), 2);
  assert.deepEqual(stats(exact.engine, exact.id("ca")), [1, 3, 3]);

  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ca", def: printing(APPRAISER), owner: P1, zone: "hand" }, ...bank("greed", 1, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("ca")), "one resource short");
  const noG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ca", def: printing(APPRAISER), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(noG.engine, P1, noG.id("ca")), "no [G]");
});

// --- Embezzling Bookkeeper ---------------------------------------------------------
// When this card enters play, your opponent draws a card.
// Character (banker; employee, mau), cost 3, threshold [G][G], 4 strength / 3 speed / 4 life.

const BOOKKEEPER = "56c1a7f7-7146-43d5-8bd4-2bad9e9522e7";

function bookkeeperBoard(opts: { odeck?: number; extra?: CardPlacement[]; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "eb", def: printing(BOOKKEEPER), owner: P1, zone: "hand" },
      ...fillers("mineh", 2, P1, "hand"),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("oh", 2, P2, "hand"),
      ...fillers("od", opts.odeck ?? 3, P2, "deck"),
      ...bank("greed", opts.greed ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(BOOKKEEPER, "0:rule", "entering play: my opponent draws exactly one card (the top of their deck) and I draw none", () => {
  const { engine, id } = bookkeeperBoard();
  const top = deckOf(engine, P2)[0];
  const myHand = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  play(engine, P1, id("eb"));
  assert.equal(zoneOf(engine, id("eb")), "play");
  assert.equal(handOf(engine, P2).length, oppHand + 1, "the opponent drew one card");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(deckOf(engine, P2).length, 2);
  assert.equal(handOf(engine, P1).length, myHand - 1, "my hand only lost the Bookkeeper: I drew nothing");
  assert.equal(deckOf(engine, P1).length, 3);
});

clause(BOOKKEEPER, "0:rule", "the draw happens when it ENTERS play, not while it is still waiting for responses", () => {
  const { engine, id } = bookkeeperBoard();
  const oppHand = handOf(engine, P2).length;
  playRaw(engine, P1, id("eb"));
  assert.equal(zoneOf(engine, id("eb")), "deploying");
  assert.equal(handOf(engine, P2).length, oppHand, "nothing yet");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P2).length, oppHand + 1);
});

clause(BOOKKEEPER, "0:rule", "an opponent with an empty deck draws nothing and nothing breaks", () => {
  const { engine, id } = bookkeeperBoard({ odeck: 0 });
  play(engine, P1, id("eb"));
  assert.equal(zoneOf(engine, id("eb")), "play");
  assert.equal(handOf(engine, P2).length, 2);
  assert.equal(pending(engine), undefined);
});

clause(BOOKKEEPER, "0:rule", "another character entering play does not make the opponent draw", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "eb", def: printing(BOOKKEEPER), owner: P1, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", 1, P1)
    ]
  });
  play(engine, P1, id("newbie"));
  assert.equal(zoneOf(engine, id("newbie")), "play");
  assert.equal(deckOf(engine, P2).length, 3, "the opponent drew nothing");
  assert.equal(handOf(engine, P2).length, 0);
});

clause(BOOKKEEPER, "0:rule", "'your opponent' is relative to its controller: P2's Bookkeeper makes P1 draw", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "eb", def: printing(BOOKKEEPER), owner: P2, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...bank("greed", 3, P2)
    ]
  });
  const top = deckOf(engine, P1)[0];
  play(engine, P2, id("eb"));
  assert.equal(zoneOf(engine, top), "hand", "P1 drew");
  assert.equal(deckOf(engine, P2).length, 3, "P2 did not");
});

clause(BOOKKEEPER, "0:rule", "also triggers when it is put into play by an effect, and again every time it enters play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "re", def: reanimator(), owner: P1, zone: "play" },
      { key: "eb", def: printing(BOOKKEEPER), owner: P1, zone: "discard" },
      { key: "bounce", def: bounce(), owner: P1, zone: "hand" },
      ...fillers("od", 3, P2, "deck")
    ]
  });
  activate(engine, P1, id("re"), "raise", { selected: { t: [id("eb")] } });
  assert.equal(zoneOf(engine, id("eb")), "play");
  assert.equal(handOf(engine, P2).length, 1, "the first entering drew a card for the opponent");
  play(engine, P1, id("bounce"), { selected: { t: [id("eb")] } });
  assert.equal(zoneOf(engine, id("eb")), "hand");
  assert.equal(handOf(engine, P2).length, 1, "leaving play draws nothing");
});

clause(BOOKKEEPER, "0:rule", "costs 3 with [G][G]; has 4 strength / 3 speed / 4 life", () => {
  const exact = bookkeeperBoard({ greed: 3 });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("eb"));
  assert.equal(before - ready(exact.engine), 3);
  assert.deepEqual(stats(exact.engine, exact.id("eb")), [4, 4, 3]);

  const short = bookkeeperBoard({ greed: 2 });
  refused(() => playRaw(short.engine, P1, short.id("eb")), "one resource short");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "eb", def: printing(BOOKKEEPER), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("eb")), "only one [G]");
});

// --- Entry-Level Employee ----------------------------------------------------------
// This card enters play with 2 tokens on it.
// This card loses 1 strength and 1 life for each token on it.
// INVEST. COST: Pay 2. EFFECT: Remove a token from this card.
// Character (banker; employee), cost 2, threshold [G], 3 strength / 3 speed / 4 life.

const EMPLOYEE = "2eb2b684-8786-4248-8daf-ca614b8286a0";

function employeeInPlay(tokens: number, opts: { greed?: number; depleted?: boolean; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "play", counters: tokens ? { token: tokens } : {}, depleted: opts.depleted },
      { key: "other", def: character({ name: "Other", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play", counters: { token: 3 } },
      ...bank("greed", opts.greed ?? 4, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(EMPLOYEE, "0:rule", "enters play with exactly 2 tokens on it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  assert.equal(tokensOn(engine, id("ele")), 0, "no tokens in hand");
  play(engine, P1, id("ele"));
  assert.equal(zoneOf(engine, id("ele")), "play");
  assert.equal(tokensOn(engine, id("ele")), 2);
});

clause(EMPLOYEE, "0:rule", "the tokens arrive when it enters play, not while it is still being deployed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  playRaw(engine, P1, id("ele"));
  assert.equal(tokensOn(engine, id("ele")), 0);
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("ele")), 2);
});

clause(EMPLOYEE, "0:rule", "also enters with 2 tokens when put into play by an effect", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "re", def: reanimator(), owner: P1, zone: "play" },
      { key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "discard" }
    ]
  });
  activate(engine, P1, id("re"), "raise", { selected: { t: [id("ele")] } });
  assert.equal(zoneOf(engine, id("ele")), "play");
  assert.equal(tokensOn(engine, id("ele")), 2);
});

clause(EMPLOYEE, "0:rule", "two Employees each enter with their own 2 tokens", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "e1", def: printing(EMPLOYEE), owner: P1, zone: "hand" },
      { key: "e2", def: printing(EMPLOYEE), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("e1"));
  play(engine, P1, id("e2"));
  assert.equal(tokensOn(engine, id("e1")), 2, "the first one gained nothing from the second entering");
  assert.equal(tokensOn(engine, id("e2")), 2);
});

clause(EMPLOYEE, "0:rule", "another card entering play gives it no tokens", () => {
  const { engine, id } = employeeInPlay(0, { extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("newbie"));
  assert.equal(tokensOn(engine, id("ele")), 0);
});

clause(EMPLOYEE, "0:rule", "tokens disappear when it leaves play (CR 409.2): returned to hand and deployed again it enters with 2 tokens, not 4", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "bounce", def: bounce(), owner: P1, zone: "hand" },
      ...bank("greed", 2, P1)
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("ele")] } });
  assert.equal(zoneOf(engine, id("ele")), "hand");
  play(engine, P1, id("ele"));
  assert.equal(zoneOf(engine, id("ele")), "play");
  assert.equal(tokensOn(engine, id("ele")), 2, "a fresh card: its old tokens are gone");
});

for (const [tokens, strength, life] of [
  [0, 3, 4],
  [1, 2, 3],
  [2, 1, 2],
  [3, 0, 1]
] as const) {
  clause(EMPLOYEE, "1:rule", `with ${tokens} token(s) it has ${strength} strength and ${life} life (speed unchanged at 3)`, () => {
    const { engine, id } = employeeInPlay(tokens);
    assert.deepEqual(stats(engine, id("ele")), [strength, life, 3]);
  });
}

clause(EMPLOYEE, "1:rule", "it is only its OWN tokens that count: another card's tokens do not weaken it, and its tokens do not weaken others", () => {
  const { engine, id } = employeeInPlay(1);
  assert.deepEqual(stats(engine, id("ele")), [2, 3, 3], "1 token of its own (the other card has 3)");
  assert.deepEqual(stats(engine, id("other")), [2, 5, 2], "the other character is unaffected by its own tokens or the Employee's");
});

clause(EMPLOYEE, "1:rule", "at 4 tokens its life is 0 and it is destroyed (FAQ: a character with 0 life is destroyed)", () => {
  const { engine, id } = employeeInPlay(4);
  assert.equal(engine.getStat(id("ele"), "life"), 0);
  settleState(engine);
  assert.equal(zoneOf(engine, id("ele")), "discard");
});

clause(EMPLOYEE, "1:rule", "the lost life is real: with 2 tokens (2 life) 1 damage leaves it in play and 2 damage destroys it", () => {
  const one = employeeInPlay(2, { extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(one.engine, P1, one.id("zap"), { selected: { t: [one.id("ele")] } });
  assert.equal(zoneOf(one.engine, one.id("ele")), "play");
  const two = employeeInPlay(2, { extra: [{ key: "zap", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(two.engine, P1, two.id("zap"), { selected: { t: [two.id("ele")] } });
  assert.equal(zoneOf(two.engine, two.id("ele")), "discard");
});

clause(EMPLOYEE, "1:rule", "the lost strength is real: blocking with 2 tokens it deals 1 battle damage", () => {
  const { engine, id } = employeeInPlay(2, {
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("ele")]);
  assert.equal(damageOf(engine, id("atk")), 1, "strength 3 - 2 tokens = 1");
  assert.equal(damageOf(engine, id("ele")), 1);
});

clause(EMPLOYEE, "2:ability:invest", "pays 2 and removes exactly one token (2 -> 1), and the debuff shrinks with it", () => {
  const { engine, id } = employeeInPlay(2);
  const before = ready(engine);
  activate(engine, P1, id("ele"), "invest");
  assert.equal(tokensOn(engine, id("ele")), 1);
  assert.equal(before - ready(engine), 2, "exactly 2 paid");
  assert.deepEqual(stats(engine, id("ele")), [2, 3, 3], "one less token: one more strength and life");
});

clause(EMPLOYEE, "2:ability:invest", "the 2 is paid when the ability is used; the token is removed only when it resolves", () => {
  const { engine, id } = employeeInPlay(2);
  const before = ready(engine);
  activateRaw(engine, P1, id("ele"), "invest");
  assert.equal(before - ready(engine), 2, "paid already");
  assert.equal(tokensOn(engine, id("ele")), 2, "token still there");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("ele")), 1);
});

clause(EMPLOYEE, "2:ability:invest", "it can be used again and again: 2 tokens -> 0 with 4 resources, never below 0", () => {
  const { engine, id } = employeeInPlay(2, { greed: 6 });
  activate(engine, P1, id("ele"), "invest");
  activate(engine, P1, id("ele"), "invest");
  assert.equal(tokensOn(engine, id("ele")), 0);
  assert.deepEqual(stats(engine, id("ele")), [3, 4, 3]);
  try {
    activate(engine, P1, id("ele"), "invest");
  } catch {
    // using it with nothing to remove may be refused; either way there is no negative count
  }
  assert.equal(tokensOn(engine, id("ele")), 0);
});

clause(EMPLOYEE, "2:ability:invest", "one resource short (1 ready) is refused, and nothing changes", () => {
  const { engine, id } = employeeInPlay(2, { greed: 1 });
  refused(() => activateRaw(engine, P1, id("ele"), "invest"));
  assert.equal(tokensOn(engine, id("ele")), 2);
  assert.equal(ready(engine), 1);
});

clause(EMPLOYEE, "2:ability:invest", "it removes a token from THIS card only", () => {
  const { engine, id } = employeeInPlay(2);
  activate(engine, P1, id("ele"), "invest");
  assert.equal(tokensOn(engine, id("other")), 3, "another card's tokens are untouched");
});

clause(EMPLOYEE, "2:ability:invest", "there is no deplete cost: it works while depleted and does not change its depleted state", () => {
  const { engine, id } = employeeInPlay(2, { depleted: true });
  activate(engine, P1, id("ele"), "invest");
  assert.equal(tokensOn(engine, id("ele")), 1);
  assert.equal(isDepleted(engine, id("ele")), true, "still depleted");
  const ready_ = employeeInPlay(2);
  activate(ready_.engine, P1, ready_.id("ele"), "invest");
  assert.equal(isDepleted(ready_.engine, ready_.id("ele")), false, "a ready Employee does not become depleted");
});

clause(EMPLOYEE, "2:ability:invest", "it can be used the turn the Employee enters play (CR 204.3a)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  play(engine, P1, id("ele"));
  activate(engine, P1, id("ele"), "invest");
  assert.equal(tokensOn(engine, id("ele")), 1);
});

clause(EMPLOYEE, "2:ability:invest", "it can be used in response on the opponent's turn", () => {
  const { engine, id } = employeeInPlay(2, {
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  activateRaw(engine, P1, id("ele"), "invest");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("ele")), 1);
});

clause(EMPLOYEE, "2:ability:invest", "only its controller can use it", () => {
  const { engine, id } = employeeInPlay(2, { turn: 2, active: P2, extra: bank("rage", 3, P2) });
  refused(() => activateRaw(engine, P2, id("ele"), "invest"));
  assert.equal(tokensOn(engine, id("ele")), 2);
});

clause(EMPLOYEE, "2:ability:invest", "costs 2 with [G]; has 3 strength / 3 speed / 4 life (before the tokens)", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("ele"));
  assert.equal(before - ready(exact.engine), 2);
  const noG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(noG.engine, P1, noG.id("ele")), "no [G]");
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "hand" }, ...bank("greed", 1, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("ele")), "one resource short");
  const plain = employeeInPlay(0);
  assert.deepEqual(stats(plain.engine, plain.id("ele")), [3, 4, 3], "the printed stats");
});

// --- Escrow Office -----------------------------------------------------------------
// DEPOSIT. COST: Pay 1. EFFECT: Put a token on this card.
// WITHDRAW. COST: Remove all tokens from this card. X is the number of tokens removed.
//   EFFECT: Reduce the next numeric cost you pay this turn by X.
// Location (banker), cost 2, threshold [G], structure 3.

const OFFICE = "d81cec8e-35a3-47e2-bb47-a4144a0d36d8";

/** A character with no rules text and a printed cost (to measure what a deploy costs). */
const costed = (name: string, cost: number): CardDefinition => character({ name, cost });

/** A tactic that costs `cost`, picks nothing and draws its controller a card. */
function costlyTactic(cost: number, name = `Costly${cost}`): CardDefinition {
  return tactic({ name, cost, behavior: { abilities: [{ id: "c", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
}

function officeBoard(tokens: number, opts: { greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "eo", def: printing(OFFICE), owner: P1, zone: "play", counters: tokens ? { token: tokens } : {} },
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
  const { engine, id } = officeBoard(0);
  const spent = spentBy(engine, P1, () => activate(engine, P1, id("eo"), "deposit"));
  assert.equal(spent, 1, "exactly 1 paid");
  assert.equal(tokensOn(engine, id("eo")), 1);
});

clause(OFFICE, "0:ability:deposit", "the 1 is paid when the ability is used; the token arrives when it resolves", () => {
  const { engine, id } = officeBoard(0);
  const spent = spentBy(engine, P1, () => activateRaw(engine, P1, id("eo"), "deposit"));
  assert.equal(spent, 1);
  assert.equal(tokensOn(engine, id("eo")), 0, "not yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("eo")), 1);
});

clause(OFFICE, "0:ability:deposit", "tokens accumulate one per use: four deposits make four tokens and cost four resources", () => {
  const { engine, id } = officeBoard(0);
  const spent = spentBy(engine, P1, () => {
    for (let n = 1; n <= 4; n++) {
      activate(engine, P1, id("eo"), "deposit");
      assert.equal(tokensOn(engine, id("eo")), n);
    }
  });
  assert.equal(spent, 4);
});

clause(OFFICE, "0:ability:deposit", "the token goes on the Office itself, not on another card", () => {
  const { engine, id } = officeBoard(0);
  activate(engine, P1, id("eo"), "deposit");
  assert.equal(tokensOn(engine, id("other")), 2, "another card's tokens are untouched");
});

clause(OFFICE, "0:ability:deposit", "with no resource to pay it is refused", () => {
  const { engine, id } = officeBoard(0, { greed: 0 });
  refused(() => activateRaw(engine, P1, id("eo"), "deposit"));
  assert.equal(tokensOn(engine, id("eo")), 0);
});

clause(OFFICE, "0:ability:deposit", "it has no deplete or once-per-turn limit and needs no threshold: other resource types pay for it too", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "eo", def: printing(OFFICE), owner: P1, zone: "play" }, ...bank("rage", 2, P1)]
  });
  activate(engine, P1, id("eo"), "deposit");
  activate(engine, P1, id("eo"), "deposit");
  assert.equal(tokensOn(engine, id("eo")), 2);
});

clause(OFFICE, "0:ability:deposit", "it can be used in response on the opponent's turn", () => {
  const { engine, id } = officeBoard(0, {
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  activateRaw(engine, P1, id("eo"), "deposit");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("eo")), 1);
});

clause(OFFICE, "0:ability:deposit", "only its controller can use it", () => {
  const { engine, id } = officeBoard(0, { turn: 2, active: P2, extra: bank("rage", 2, P2) });
  refused(() => activateRaw(engine, P2, id("eo"), "deposit"));
  assert.equal(tokensOn(engine, id("eo")), 0);
});

clause(OFFICE, "0:ability:deposit", "tokens disappear when the Office leaves play (CR 409.2): returned to hand and deployed again it has none", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "eo", def: printing(OFFICE), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "bounceLoc", def: tactic({ name: "BounceLoc", cost: 0, behavior: { abilities: [{ id: "bl", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" },
      ...bank("greed", 2, P1)
    ]
  });
  play(engine, P1, id("bounceLoc"), { selected: { t: [id("eo")] } });
  assert.equal(zoneOf(engine, id("eo")), "hand");
  play(engine, P1, id("eo"));
  assert.equal(zoneOf(engine, id("eo")), "play");
  assert.equal(tokensOn(engine, id("eo")), 0, "a fresh card has no tokens");
});

for (const tokens of [1, 2, 3]) {
  clause(OFFICE, "1:ability:withdraw", `removes ALL ${tokens} token(s), and the next numeric cost I pay this turn is ${tokens} less (a 5-cost character costs ${5 - tokens})`, () => {
    const { engine, id } = officeBoard(tokens);
    activate(engine, P1, id("eo"), "withdraw");
    assert.equal(tokensOn(engine, id("eo")), 0, "every token removed");
    const spent = spentBy(engine, P1, () => play(engine, P1, id("big")));
    assert.equal(zoneOf(engine, id("big")), "play");
    assert.equal(spent, 5 - tokens);
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
  const { engine, id } = officeBoard(2);
  activate(engine, P1, id("eo"), "withdraw");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("mid"))), 1, "3 - 2");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("small"))), 2, "full price");
});

clause(OFFICE, "1:ability:withdraw", "X is the number of tokens removed: tokens on other cards play no part", () => {
  const { engine, id } = officeBoard(1);
  activate(engine, P1, id("eo"), "withdraw");
  assert.equal(tokensOn(engine, id("other")), 2, "another card keeps its tokens");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("big"))), 4, "X was 1, not 3");
});

clause(OFFICE, "1:ability:withdraw", "removing the tokens is a COST: they are gone as soon as the ability is used, before the opponent can respond", () => {
  const { engine, id } = officeBoard(3);
  activateRaw(engine, P1, id("eo"), "withdraw");
  assert.equal(tokensOn(engine, id("eo")), 0, "removed while the ability waits for responses");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("big"))), 2);
});

clause(OFFICE, "1:ability:withdraw", "it costs no resources", () => {
  const { engine, id } = officeBoard(2, { greed: 0 });
  activate(engine, P1, id("eo"), "withdraw");
  assert.equal(tokensOn(engine, id("eo")), 0);
  assert.equal(ready(engine), 0);
});

clause(OFFICE, "1:ability:withdraw", "with no tokens on the Office it cannot be used (there is nothing to remove, CR 401.3b)", () => {
  const { engine, id } = officeBoard(0);
  refused(() => activateRaw(engine, P1, id("eo"), "withdraw"));
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("mid"))), 3, "no reduction was created");
});

clause(OFFICE, "1:ability:withdraw", "a numeric cost of an ability counts too (CR 406.5): the reduction applies to INVEST's 'Pay 2'", () => {
  const { engine, id } = officeBoard(1, {
    extra: [{ key: "ele", def: printing(EMPLOYEE), owner: P1, zone: "play", counters: { token: 2 } }]
  });
  activate(engine, P1, id("eo"), "withdraw");
  const spent = spentBy(engine, P1, () => activate(engine, P1, id("ele"), "invest"));
  assert.equal(spent, 1, "Pay 2 reduced by 1");
  assert.equal(tokensOn(engine, id("ele")), 1, "the ability still did its job");
});

clause(OFFICE, "1:ability:withdraw", "a numeric cost of an ability counts too: after withdrawing 2, DEPOSIT's 'Pay 1' is free", () => {
  const { engine, id } = officeBoard(2);
  activate(engine, P1, id("eo"), "withdraw");
  const spent = spentBy(engine, P1, () => activate(engine, P1, id("eo"), "deposit"));
  assert.equal(spent, 0, "Pay 1 reduced to 0");
  assert.equal(tokensOn(engine, id("eo")), 1, "the deposit still happened");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("mid"))), 3, "and the reduction is used up");
});

clause(OFFICE, "1:ability:withdraw", "a card of numeric cost 0 uses up the reduction without any benefit being carried over", () => {
  const { engine, id } = officeBoard(2);
  activate(engine, P1, id("eo"), "withdraw");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("free"))), 0);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("mid"))), 3, "the reduction was spent on the 0-cost card");
});

clause(OFFICE, "1:ability:withdraw", "'this turn': an unused reduction ends with the turn", () => {
  const { engine, id } = officeBoard(3);
  activate(engine, P1, id("eo"), "withdraw");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "my next turn");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("big"))), 5, "the reduction did not carry over");
});

clause(OFFICE, "1:ability:withdraw", "the reduction is MINE: a tactic the opponent pays for in response costs them its full numeric cost", () => {
  const { engine, id } = officeBoard(3, {
    extra: [{ key: "resp", def: costlyTactic(2), owner: P2, zone: "hand" }, ...bank("rage", 2, P2)]
  });
  activate(engine, P1, id("eo"), "withdraw");
  engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond to my ending the turn");
  const spent = spentBy(engine, P2, () => playRaw(engine, P2, id("resp")));
  assert.equal(spent, 2, "the opponent pays the full 2");
});

clause(OFFICE, "1:ability:withdraw", "it can be used in response on the opponent's turn; the reduction then applies to my next cost that turn", () => {
  const { engine, id } = officeBoard(2, {
    turn: 2,
    active: P2,
    extra: [
      { key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" },
      { key: "resp", def: costlyTactic(2), owner: P1, zone: "hand" },
      ...bank("rage", 1, P2)
    ]
  });
  playRaw(engine, P2, id("opp"));
  activateRaw(engine, P1, id("eo"), "withdraw");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("eo")), 0);
  engine.perform({ type: "endTurn", playerId: P2 });
  const spent = spentBy(engine, P1, () => playRaw(engine, P1, id("resp")));
  assert.equal(spent, 0, "my tactic's cost of 2 is reduced by 2");
});

clause(OFFICE, "1:ability:withdraw", "only its controller can use it", () => {
  const { engine, id } = officeBoard(2, { turn: 2, active: P2 });
  refused(() => activateRaw(engine, P2, id("eo"), "withdraw"));
  assert.equal(tokensOn(engine, id("eo")), 2);
});

clause(OFFICE, "1:ability:withdraw", "costs 2 with [G]; has 3 structure: 2 damage leaves it in play, 3 destroys it", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "eo", def: printing(OFFICE), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("eo"))), 2);
  assert.equal(zoneOf(exact.engine, exact.id("eo")), "play");
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
        { key: "smash", def: locationDamageTactic(damage), owner: P1, zone: "hand" }
      ]
    });
    play(game.engine, P1, game.id("smash"), { selected: { t: [game.id("eo")] } });
    assert.equal(zoneOf(game.engine, game.id("eo")), destroyed ? "discard" : "play", `${damage} damage`);
  }
});

// --- Extortify ---------------------------------------------------------------------
// Your faction gains 8 influence.
// Tactic (banker), cost 3, threshold [G][G].

const EXTORTIFY = "004d96b5-d33a-4f8c-905c-c7aa61ba1756";

function extortifyBoard(opts: { greed?: number; rage?: number; influence?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ex", def: printing(EXTORTIFY), owner: P1, zone: "hand" },
      ...fillers("mineh", 2, P1, "hand"),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("oh", 2, P2, "hand"),
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(EXTORTIFY, "0:rule", "my faction gains exactly 8 influence (30 -> 38), and the opponent's faction is untouched", () => {
  const { engine, id } = extortifyBoard();
  assert.equal(influence(engine, P1), 30);
  const spent = spentBy(engine, P1, () => play(engine, P1, id("ex")));
  assert.equal(influence(engine, P1), 38);
  assert.equal(influence(engine, P2), 30, "the opponent's influence is unchanged");
  assert.equal(spent, 3, "the cost of 3 is paid");
  assert.equal(zoneOf(engine, id("ex")), "discard", "the tactic goes to its owner's discard pile");
});

clause(EXTORTIFY, "0:rule", "the gain does not depend on the starting influence (1 -> 9, 100 -> 108)", () => {
  for (const start of [1, 100]) {
    const { engine, id } = extortifyBoard({ influence: start });
    play(engine, P1, id("ex"));
    assert.equal(influence(engine, P1), start + 8);
  }
});

clause(EXTORTIFY, "0:rule", "it only gains influence: no cards are drawn or discarded", () => {
  const { engine, id } = extortifyBoard();
  const myHand = handOf(engine, P1).length;
  play(engine, P1, id("ex"));
  assert.equal(handOf(engine, P1).length, myHand - 1, "only the tactic left my hand");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.equal(handOf(engine, P2).length, 2);
});

clause(EXTORTIFY, "0:rule", "the influence is gained when it resolves, after the opponent had the chance to respond", () => {
  const { engine, id } = extortifyBoard();
  playRaw(engine, P1, id("ex"));
  assert.equal(influence(engine, P1), 30, "not yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(influence(engine, P1), 38);
});

clause(EXTORTIFY, "0:rule", "'your faction' is the controller's: the opponent's Extortify raises THEIR influence", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "ex", def: printing(EXTORTIFY), owner: P2, zone: "hand" }, ...bank("greed", 3, P2)]
  });
  play(engine, P2, id("ex"));
  assert.equal(influence(engine, P2), 38);
  assert.equal(influence(engine, P1), 30);
});

clause(EXTORTIFY, "0:rule", "it can be played in response on the opponent's turn (it is a tactic)", () => {
  const { engine, id } = extortifyBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  refused(() => playRaw(engine, P1, id("ex")), "nothing to respond to yet");
  playRaw(engine, P2, id("opp"));
  playRaw(engine, P1, id("ex"));
  resolvePendingResponses(engine);
  assert.equal(influence(engine, P1), 38);
  assert.equal(zoneOf(engine, id("opp")), "play");
});

clause(EXTORTIFY, "0:rule", "costs 3 with [G][G]: one resource short, or only one [G], is refused", () => {
  const short = extortifyBoard({ greed: 2 });
  refused(() => playRaw(short.engine, P1, short.id("ex")));
  assert.equal(zoneOf(short.engine, short.id("ex")), "hand");
  assert.equal(ready(short.engine), 2, "nothing spent");
  const oneG = extortifyBoard({ greed: 1, rage: 5 });
  refused(() => playRaw(oneG.engine, P1, oneG.id("ex")), "only one [G]");
  const twoG = extortifyBoard({ greed: 2, rage: 1 });
  play(twoG.engine, P1, twoG.id("ex"));
  assert.equal(influence(twoG.engine, P1), 38, "two [G] and one other resource pay for it");
});

// --- Fat Pants ---------------------------------------------------------------------
// ATTACH TO CHARACTER
// The attached character gains 1 strength and 2 life.
// HANDOFF. COST: Pay 1. Deplete a character you control that is not in a battle.
//   EFFECT: Attach this card to the character.
// Item (banker; gear), cost 3, threshold [G].

const PANTS = "57657edf-5653-4d4f-91a1-78a2542578ec";

/** P1 holds Fat Pants (`fp`) with 3 [G]; characters `a`, `b` (mine), `foe` (theirs); an item, a location and a face-down card. */
function pantsBoard(opts: { greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[]; hidden?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "fp", def: printing(PANTS), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      ...(opts.hidden ? [{ key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play" as const, faceDown: true }] : []),
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** The same board with Fat Pants already attached to `a`. */
function pantsWorn(opts: { greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[]; host?: string; hidden?: boolean } = {}) {
  const host = opts.host ?? "a";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "a", def: character({ name: "A", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "fp", def: printing(PANTS), owner: P1, zone: "play", attachedToKey: host },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      ...(opts.hidden ? [{ key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play" as const, faceDown: true }] : []),
      ...bank("greed", opts.greed ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const attachedTo = (engine: SpoilsEngine, cardId: CardInstanceId): CardInstanceId | undefined => engine.state.cards[cardId].attachedTo;

clause(PANTS, "0:attach", "deploying it picks a character as the first extra cost and it enters play attached to that character", () => {
  const { engine, id } = pantsBoard();
  const spent = spentBy(engine, P1, () => play(engine, P1, id("fp"), { selected: { attachTo: [id("a")] } }));
  assert.equal(zoneOf(engine, id("fp")), "play");
  assert.equal(attachedTo(engine, id("fp")), id("a"), "attached to the picked character");
  assert.equal(spent, 3, "the numeric cost of 3 is paid");
});

clause(PANTS, "0:attach", "it can be attached to an opponent's character", () => {
  const { engine, id } = pantsBoard();
  play(engine, P1, id("fp"), { selected: { attachTo: [id("foe")] } });
  assert.equal(attachedTo(engine, id("fp")), id("foe"));
  assert.equal(engine.getStat(id("foe"), "strength"), 4, "the opponent's character gets the bonus");
  assert.equal(controllerOf(engine, id("fp")), P1, "but I still control Fat Pants");
});

clause(PANTS, "0:attach", "the pick is required: playing it with no character picked is refused", () => {
  const { engine, id } = pantsBoard();
  refused(() => playRaw(engine, P1, id("fp")));
  assert.equal(zoneOf(engine, id("fp")), "hand");
  assert.equal(ready(engine), 3, "nothing was spent");
});

clause(PANTS, "0:attach", "only a character can be picked: items, locations, resources, face-down cards, factions and cards outside play are refused", () => {
  const { engine, id } = pantsBoard({ hidden: true });
  const r0 = ready(engine);
  const resourceId = engine.state.players[P1].play.find((card) => engine.getDefinition(card).type === "resource")!;
  const attempt = (cardId: CardInstanceId) => () => playRaw(engine, P1, id("fp"), { selected: { attachTo: [cardId] } });
  refused(attempt(id("itm")), "an item");
  refused(attempt(id("loc")), "a location");
  refused(attempt(resourceId), "a face-up resource");
  refused(attempt(id("hidden")), "a face-down card");
  refused(attempt(factionOf(engine, P1)), "my faction");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(attempt(id("inHand")), "a character in my hand");
  assert.equal(zoneOf(engine, id("fp")), "hand");
  assert.equal(ready(engine), r0, "nothing was spent");
  attempt(id("b"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(PANTS, "0:attach", "exactly one character is picked: two are refused", () => {
  const { engine, id } = pantsBoard();
  refused(() => playRaw(engine, P1, id("fp"), { selected: { attachTo: [id("a"), id("b")] } }));
  assert.equal(zoneOf(engine, id("fp")), "hand");
});

clause(PANTS, "0:attach", "with no character in play it cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fp", def: printing(PANTS), owner: P1, zone: "hand" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  refused(() => playRaw(engine, P1, id("fp")));
  refused(() => playRaw(engine, P1, id("fp"), { selected: { attachTo: [id("itm")] } }));
  assert.equal(zoneOf(engine, id("fp")), "hand");
});

clause(PANTS, "0:attach", "when its character is destroyed, Fat Pants goes to its owner's discard pile too (CR 301.4)", () => {
  const { engine, id } = pantsWorn({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("a")] } });
  assert.equal(zoneOf(engine, id("a")), "discard");
  assert.equal(zoneOf(engine, id("fp")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("fp")), "discardOf(engine, P1).includes(id(\"fp\"))");
});

clause(PANTS, "0:attach", "when its character is returned to hand, Fat Pants leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const { engine, id } = pantsWorn({ extra: [{ key: "bounce", def: bounce(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("a")] } });
  assert.equal(zoneOf(engine, id("a")), "hand");
  assert.equal(zoneOf(engine, id("fp")), "hand", "attached cards leave play in the same way as their host");
});

clause(PANTS, "0:attach", "when its character leaves play, the Pants are not left behind in play", () => {
  const { engine, id } = pantsWorn({ extra: [{ key: "bounce", def: bounce(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("a")] } });
  assert.notEqual(zoneOf(engine, id("fp")), "play");
  assert.equal(attachedTo(engine, id("fp")), undefined);
});

clause(PANTS, "0:attach", "costs 3 with [G]: one resource short, or no [G], is refused", () => {
  const short = pantsBoard({ greed: 2 });
  refused(() => playRaw(short.engine, P1, short.id("fp"), { selected: { attachTo: [short.id("a")] } }));
  assert.equal(zoneOf(short.engine, short.id("fp")), "hand");
  assert.equal(ready(short.engine), 2);
  const noG = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fp", def: printing(PANTS), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A" }), owner: P1, zone: "play" },
      ...bank("rage", 5, P1)
    ]
  });
  refused(() => playRaw(noG.engine, P1, noG.id("fp"), { selected: { attachTo: [noG.id("a")] } }), "no [G]");
});

clause(PANTS, "1:rule", "the attached character gains 1 strength and 2 life (2/2/2 becomes 3/4/2)", () => {
  const { engine, id } = pantsWorn();
  assert.deepEqual(stats(engine, id("a")), [3, 4, 2], "speed is unchanged");
});

clause(PANTS, "1:rule", "other characters of mine and the opponent's are unaffected", () => {
  const { engine, id } = pantsWorn();
  assert.deepEqual(stats(engine, id("b")), [1, 3, 1]);
  assert.deepEqual(stats(engine, id("foe")), [3, 4, 3]);
});

clause(PANTS, "1:rule", "the bonus is on the wearer when deployed, and is gone again when Fat Pants leaves play", () => {
  const { engine, id } = pantsBoard({ extra: [{ key: "smash", def: destroyItemTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("fp"), { selected: { attachTo: [id("a")] } });
  assert.deepEqual(stats(engine, id("a")), [3, 4, 2]);
  play(engine, P1, id("smash"), { selected: { t: [id("fp")] } });
  assert.equal(zoneOf(engine, id("fp")), "discard");
  assert.deepEqual(stats(engine, id("a")), [2, 2, 2], "back to normal");
});

clause(PANTS, "1:rule", "the bonus is real in battle: the wearer deals 1 more battle damage and survives 2 more damage", () => {
  const { engine, id } = pantsWorn({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("a")]);
  assert.equal(zoneOf(engine, id("a")), "play", "3 damage < 4 life");
  assert.equal(damageOf(engine, id("a")), 3);
  assert.equal(damageOf(engine, id("atk")), 3, "the wearer's strength is 3");
});

clause(PANTS, "1:rule", "two pairs of Pants stack on one character", () => {
  const { engine, id } = pantsWorn({ extra: [{ key: "fp2", def: printing(PANTS), owner: P1, zone: "play", attachedToKey: "a" }] });
  assert.deepEqual(stats(engine, id("a")), [4, 6, 2]);
});

clause(PANTS, "1:rule", "Fat Pants in hand gives nothing", () => {
  const { engine, id } = pantsBoard();
  assert.deepEqual(stats(engine, id("a")), [2, 2, 2]);
});

function handoff(game: ReturnType<typeof pantsWorn>, toKey: string): void {
  activate(game.engine, P1, game.id("fp"), "handoff", { selected: { w: [game.id(toKey)] } });
}

clause(PANTS, "2:ability:handoff", "pays 1, depletes the picked character and attaches Fat Pants to it: the bonus moves from A to B", () => {
  const game = pantsWorn();
  const { engine, id } = game;
  const spent = spentBy(engine, P1, () => handoff(game, "b"));
  assert.equal(spent, 1, "exactly 1 paid");
  assert.equal(attachedTo(engine, id("fp")), id("b"), "attached to the picked character");
  assert.equal(isDepleted(engine, id("b")), true, "the picked character was depleted");
  assert.equal(isDepleted(engine, id("a")), false, "the old wearer was not");
  assert.deepEqual(stats(engine, id("b")), [2, 5, 1], "B now has the bonus");
  assert.deepEqual(stats(engine, id("a")), [2, 2, 2], "A lost it");
  assert.equal(zoneOf(engine, id("fp")), "play", "Fat Pants stays in play");
});

clause(PANTS, "2:ability:handoff", "the 1 and the deplete are costs paid when the ability is used; the move happens when it resolves", () => {
  const game = pantsWorn();
  const { engine, id } = game;
  const spent = spentBy(engine, P1, () => activateRaw(engine, P1, id("fp"), "handoff", { w: [id("b")] }));
  assert.equal(spent, 1);
  assert.equal(isDepleted(engine, id("b")), true, "depleted already");
  assert.equal(attachedTo(engine, id("fp")), id("a"), "not moved yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(attachedTo(engine, id("fp")), id("b"));
});

clause(PANTS, "2:ability:handoff", "the character depleted may be the current wearer: it is depleted and keeps the Pants", () => {
  const game = pantsWorn();
  handoff(game, "a");
  assert.equal(isDepleted(game.engine, game.id("a")), true);
  assert.equal(attachedTo(game.engine, game.id("fp")), game.id("a"));
  assert.deepEqual(stats(game.engine, game.id("a")), [3, 4, 2]);
});

clause(PANTS, "2:ability:handoff", "Pants that I control on an OPPONENT'S character can be handed to one of my own characters", () => {
  const game = pantsWorn({ host: "foe" });
  assert.deepEqual(stats(game.engine, game.id("foe")), [4, 6, 3], "the opponent's wearer has the bonus");
  handoff(game, "a");
  assert.equal(attachedTo(game.engine, game.id("fp")), game.id("a"));
  assert.deepEqual(stats(game.engine, game.id("foe")), [3, 4, 3]);
  assert.deepEqual(stats(game.engine, game.id("a")), [3, 4, 2]);
});

clause(PANTS, "2:ability:handoff", "the character must be one I control: an opponent's character is refused", () => {
  const game = pantsWorn();
  refused(() => activateRaw(game.engine, P1, game.id("fp"), "handoff", { w: [game.id("foe")] }));
  assert.equal(isDepleted(game.engine, game.id("foe")), false);
  assert.equal(attachedTo(game.engine, game.id("fp")), game.id("a"));
  assert.equal(ready(game.engine), 3, "nothing was paid");
});

clause(PANTS, "2:ability:handoff", "only a character can be depleted for it: an item, a location, a face-down card or a faction is refused", () => {
  const game = pantsWorn({ hidden: true });
  const r0 = ready(game.engine);
  const attempt = (cardId: CardInstanceId) => () => activateRaw(game.engine, P1, game.id("fp"), "handoff", { w: [cardId] });
  refused(attempt(game.id("itm")), "an item");
  refused(attempt(game.id("loc")), "a location");
  refused(attempt(game.id("hidden")), "a face-down card");
  refused(attempt(factionOf(game.engine, P1)), "my faction");
  refused(attempt(game.id("fp")), "Fat Pants itself");
  assert.equal(ready(game.engine), r0, "nothing was paid");
  attempt(game.id("b"))();
  assert.equal(isDepleted(game.engine, game.id("b")), true, "control: a character works");
});

clause(PANTS, "2:ability:handoff", "an already-depleted character cannot be picked (it cannot be depleted again, CR 303.2)", () => {
  const game = pantsWorn({ extra: [] });
  game.engine.state.cards[game.id("b")].depleted = true;
  refused(() => activateRaw(game.engine, P1, game.id("fp"), "handoff", { w: [game.id("b")] }));
  assert.equal(attachedTo(game.engine, game.id("fp")), game.id("a"));
  assert.equal(ready(game.engine), 3);
});

clause(PANTS, "2:ability:handoff", "exactly one character is picked: none, or two, is refused", () => {
  const game = pantsWorn();
  refused(() => activateRaw(game.engine, P1, game.id("fp"), "handoff", {}), "none");
  refused(() => activateRaw(game.engine, P1, game.id("fp"), "handoff", { w: [game.id("a"), game.id("b")] }), "two");
  assert.equal(isDepleted(game.engine, game.id("a")), false);
  assert.equal(isDepleted(game.engine, game.id("b")), false);
});

clause(PANTS, "2:ability:handoff", "without a resource to pay it is refused and nothing is depleted", () => {
  const game = pantsWorn({ greed: 0 });
  refused(() => activateRaw(game.engine, P1, game.id("fp"), "handoff", { w: [game.id("b")] }));
  assert.equal(isDepleted(game.engine, game.id("b")), false);
  assert.equal(attachedTo(game.engine, game.id("fp")), game.id("a"));
});

clause(PANTS, "2:ability:handoff", "a character in a battle cannot be depleted for it: an attacker and a blocker are both refused, an idle character works", () => {
  const attacking = pantsWorn({
    extra: [{ key: "c", def: character({ name: "C", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }]
  });
  attacking.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [attacking.id("b")], target: factionOfP2 });
  assert.ok(battleOf(attacking.engine), "a battle is on");
  refused(() => activateRaw(attacking.engine, P1, attacking.id("fp"), "handoff", { w: [attacking.id("b")] }), "an attacker is in a battle");
  assert.equal(ready(attacking.engine), 3, "nothing paid");
  activateRaw(attacking.engine, P1, attacking.id("fp"), "handoff", { w: [attacking.id("c")] });
  resolvePendingResponses(attacking.engine);
  assert.equal(attachedTo(attacking.engine, attacking.id("fp")), attacking.id("c"), "control: an idle character is accepted mid-battle");

  const blocking = pantsWorn({
    turn: 2,
    active: P2,
    extra: [
      { key: "c", def: character({ name: "C", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(blocking.engine, P2, [blocking.id("atk")], factionOfP1);
  blocking.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [blocking.id("b")] });
  refused(() => activateRaw(blocking.engine, P1, blocking.id("fp"), "handoff", { w: [blocking.id("b")] }), "a blocker is in a battle");
});

clause(PANTS, "2:ability:handoff", "a character that was in an earlier battle but is not in one now can be picked", () => {
  const game = pantsWorn();
  fightDefault(game.engine, P1, [game.id("b")], factionOfP2, []);
  assert.equal(battleOf(game.engine), undefined, "the battle is over");
  game.engine.state.cards[game.id("b")].depleted = false;
  handoff(game, "b");
  assert.equal(attachedTo(game.engine, game.id("fp")), game.id("b"));
});

clause(PANTS, "2:ability:handoff", "it can be used in response on the opponent's turn", () => {
  const game = pantsWorn({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(game.engine, P2, game.id("opp"));
  activateRaw(game.engine, P1, game.id("fp"), "handoff", { w: [game.id("b")] });
  resolvePendingResponses(game.engine);
  assert.equal(attachedTo(game.engine, game.id("fp")), game.id("b"));
});

clause(PANTS, "2:ability:handoff", "only the Pants' controller can use it", () => {
  const game = pantsWorn({ turn: 2, active: P2, extra: bank("rage", 3, P2) });
  refused(() => activateRaw(game.engine, P2, game.id("fp"), "handoff", { w: [game.id("foe")] }));
  assert.equal(attachedTo(game.engine, game.id("fp")), game.id("a"));
});

clause(PANTS, "2:ability:handoff", "the old wearer is not left worse off: it simply loses the bonus (damage already taken stays)", () => {
  const game = pantsWorn({ extra: [] });
  game.engine.state.cards[game.id("a")].damage = 1;
  handoff(game, "b");
  assert.equal(damageOf(game.engine, game.id("a")), 1);
  assert.equal(zoneOf(game.engine, game.id("a")), "play", "1 damage on a 2-life character");
});

clause(PANTS, "2:ability:handoff", "if the old wearer's extra life was all that kept it alive, it dies when the Pants move away", () => {
  const game = pantsWorn({ extra: [] });
  game.engine.state.cards[game.id("a")].damage = 3;
  assert.equal(zoneOf(game.engine, game.id("a")), "play", "3 damage < 4 life with the Pants");
  handoff(game, "b");
  assert.equal(zoneOf(game.engine, game.id("a")), "discard", "3 damage >= 2 life without them");
  assert.equal(attachedTo(game.engine, game.id("fp")), game.id("b"), "the Pants moved on");
});

// --- First Unified Market of Abstract Secure Theoreticals -------------------------------
// UNIQUE F.U.M.A.S.T.
// Reduce the numeric cost of your faction's abilities by 1, to a minimum of 1.
// Location (banker), cost 6, threshold [G][G][G][G][G][G], structure 8.

const FUMAST = "914713f6-1e21-4a63-bee9-aeee7a99355b";

/** A faction whose abilities cost 3, 2, 1 and nothing: each draws its controller a card (ids ab3, ab2, ab1, ab0). */
function factionWithAbilities(): CardDefinition {
  const base = developFaction();
  const ability = (id: string, cost: number) => ({
    id,
    name: id,
    type: "activated" as const,
    costs: cost > 0 ? [{ type: "payResources" as const, amount: cost }] : [],
    effects: [{ type: "draw" as const, player: "controller" as const, amount: 1 }]
  });
  return {
    ...base,
    faction: { ...base.faction!, abilities: [ability("ab3", 3), ability("ab2", 2), ability("ab1", 1), ability("ab0", 0)] } as never
  } as CardDefinition;
}

function fumastBoard(opts: { fumast?: boolean; theirs?: boolean; greed?: number; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: factionWithAbilities() },
    playerB: { faction: factionWithAbilities() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      ...(opts.fumast === false ? [] : [{ key: "fm", def: printing(FUMAST), owner: P1, zone: "play" as const }]),
      ...(opts.theirs ? [{ key: "theirFm", def: printing(FUMAST), owner: P2, zone: "play" as const }] : []),
      {
        key: "pricey",
        def: character({
          name: "Pricey",
          behavior: { abilities: [{ id: "draw3", name: "Draw3", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
        }),
        owner: P1,
        zone: "play"
      },
      { key: "tac", def: costlyTactic(3, "Tac3"), owner: P1, zone: "hand" },
      ...fillers("d", 8, P1, "deck"),
      ...fillers("od", 8, P2, "deck"),
      ...bank("greed", opts.greed ?? 8, P1),
      ...bank("rage", opts.theirs !== undefined || opts.active === P2 ? 8 : 0, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const useFactionAbility = (engine: SpoilsEngine, player: Pid, abilityId: string): void =>
  activate(engine, player, factionOf(engine, player), abilityId);

for (const [ability, printed, reduced] of [
  ["ab3", 3, 2],
  ["ab2", 2, 1],
  ["ab1", 1, 1]
] as const) {
  clause(FUMAST, "1:rule", `my faction's ability with numeric cost ${printed} costs ${reduced} while it is in play${printed === 1 ? " (to a minimum of 1)" : ""}`, () => {
    const { engine } = fumastBoard();
    const spent = spentBy(engine, P1, () => useFactionAbility(engine, P1, ability));
    assert.equal(spent, reduced);
    assert.equal(handOf(engine, P1).length, 2, "the ability still did its job: it drew a card (the Tactic was already in hand)");
  });

  clause(FUMAST, "1:rule", `control: without the F.U.M.A.S.T. the same ability costs its full ${printed}`, () => {
    const { engine } = fumastBoard({ fumast: false });
    assert.equal(spentBy(engine, P1, () => useFactionAbility(engine, P1, ability)), printed);
  });
}

clause(FUMAST, "1:rule", "an ability with no numeric cost stays free (a cost of 0 is not raised to the minimum of 1, CR 410.5)", () => {
  const { engine } = fumastBoard();
  assert.equal(spentBy(engine, P1, () => useFactionAbility(engine, P1, "ab0")), 0);
  assert.equal(handOf(engine, P1).length, 2, "and it drew a card");
});

clause(FUMAST, "1:rule", "the reduction is paid in resources when the ability is used: with only 1 ready resource the 3-cost ability (2 after the reduction) is refused", () => {
  const { engine } = fumastBoard({ greed: 1 });
  refused(() => activateRaw(engine, P1, factionOf(engine, P1), "ab3"));
  assert.equal(ready(engine), 1);
  const two = fumastBoard({ greed: 2 });
  assert.equal(spentBy(two.engine, P1, () => useFactionAbility(two.engine, P1, "ab3")), 2, "exactly 2 ready resources are enough");
  const noneLeft = fumastBoard({ greed: 0 });
  refused(() => activateRaw(noneLeft.engine, P1, factionOf(noneLeft.engine, P1), "ab1"), "1 is the minimum: it cannot be free");
});

clause(FUMAST, "1:rule", "only my FACTION's abilities are reduced: a character's 3-cost ability still costs 3", () => {
  const { engine, id } = fumastBoard();
  assert.equal(spentBy(engine, P1, () => activate(engine, P1, id("pricey"), "draw3")), 3);
});

clause(FUMAST, "1:rule", "only the numeric cost of ABILITIES is reduced: a tactic costing 3 still costs 3", () => {
  const { engine, id } = fumastBoard();
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("tac"))), 3);
});

clause(FUMAST, "1:rule", "'your faction': the opponent's faction abilities are not reduced by my F.U.M.A.S.T.", () => {
  const { engine } = fumastBoard({ turn: 2, active: P2 });
  assert.equal(spentBy(engine, P2, () => useFactionAbility(engine, P2, "ab3")), 3, "full price for the opponent");
});

clause(FUMAST, "1:rule", "an opponent's own F.U.M.A.S.T. reduces THEIR faction's abilities and not mine", () => {
  const { engine } = fumastBoard({ fumast: false, theirs: true, turn: 2, active: P2 });
  assert.equal(spentBy(engine, P2, () => useFactionAbility(engine, P2, "ab3")), 2, "their ability is reduced");
  const mine = fumastBoard({ fumast: false, theirs: true });
  assert.equal(spentBy(mine.engine, P1, () => useFactionAbility(mine.engine, P1, "ab3")), 3, "mine is not");
});

clause(FUMAST, "1:rule", "it stops when the F.U.M.A.S.T. leaves play", () => {
  const { engine, id } = fumastBoard({ extra: [{ key: "smash", def: locationDamageTactic(8), owner: P1, zone: "hand" }] });
  assert.equal(spentBy(engine, P1, () => useFactionAbility(engine, P1, "ab3")), 2);
  play(engine, P1, id("smash"), { selected: { t: [id("fm")] } });
  assert.equal(zoneOf(engine, id("fm")), "discard", "8 damage destroys the 8-structure location");
  assert.equal(spentBy(engine, P1, () => useFactionAbility(engine, P1, "ab3")), 3, "full price again");
});

clause(FUMAST, "1:rule", "a F.U.M.A.S.T. that is not in play (in hand) reduces nothing", () => {
  const { engine } = fumastBoard({ fumast: false, extra: [{ key: "fm", def: printing(FUMAST), owner: P1, zone: "hand" }] });
  assert.equal(spentBy(engine, P1, () => useFactionAbility(engine, P1, "ab3")), 3);
});

clause(FUMAST, "1:rule", "the reduction also applies to a real faction: The Evil Alliance's DRAW (pay 3) costs 2", () => {
  const { engine } = buildGame({
    playerA: { faction: cardDef("Seed 3", "The Evil Alliance") },
    cards: [
      { key: "fm", def: printing(FUMAST), owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("greed", 3, P1)
    ]
  });
  assert.equal(spentBy(engine, P1, () => useFactionAbility(engine, P1, "evil-draw")), 2);
});

clause(FUMAST, "0:unique", "controlling a second F.U.M.A.S.T. makes me keep one: choosing the old one destroys the new one", () => {
  const { engine, id } = fumastBoard({ extra: [{ key: "fm2", def: printing(FUMAST), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)] });
  play(engine, P1, id("fm2"));
  const seen: string[] = [];
  drain(engine, (pc) => {
    seen.push(pc.kind);
    return pc.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: id("fm") } : declineAll(pc);
  });
  assert.ok(seen.includes("uniqueSurvivor"), "I was asked which to keep");
  assert.equal(zoneOf(engine, id("fm")), "play", "the chosen one stays");
  assert.equal(zoneOf(engine, id("fm2")), "discard", "the other is destroyed");
  assert.equal(engine.state.responseWindow, undefined);
});

clause(FUMAST, "0:unique", "choosing the new one destroys the old one, and the deploy finishes normally", () => {
  const { engine, id } = fumastBoard({ extra: [{ key: "fm2", def: printing(FUMAST), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)] });
  play(engine, P1, id("fm2"));
  drain(engine, (pc) => (pc.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: id("fm2") } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("fm2")), "play", "the chosen one stays");
  assert.equal(zoneOf(engine, id("fm")), "discard", "the other is destroyed");
  assert.equal(engine.state.responseWindow, undefined, "the deploy finished: the game is not stuck in a resolving window");
});

clause(FUMAST, "0:unique", "the restriction is per player: the opponent may control their own F.U.M.A.S.T. at the same time", () => {
  const { engine, id } = fumastBoard({ theirs: true });
  assert.equal(zoneOf(engine, id("fm")), "play");
  assert.equal(zoneOf(engine, id("theirFm")), "play");
  assert.equal(pending(engine), undefined);
});

function locationThiefBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fm", def: printing(FUMAST), owner: P1, zone: "play" },
      { key: "theirFm", def: printing(FUMAST), owner: P2, zone: "play" },
      {
        key: "thief",
        def: tactic({ name: "LocThief", cost: 0, behavior: { abilities: [{ id: "lt", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location", controller: "opponent" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] } }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
}

clause(FUMAST, "0:unique", "taking control of the opponent's F.U.M.A.S.T. while I control one asks me which to keep", () => {
  const thief = locationThiefBoard();
  playRaw(thief.engine, P1, thief.id("thief"), { selected: { t: [thief.id("theirFm")] } });
  resolvePendingResponses(thief.engine);
  const pc = pending(thief.engine);
  assert.equal(pc?.kind, "uniqueSurvivor", "the Unique rule applies to the card I took");
  assert.equal(pc?.playerId, P1, "I choose");
  assert.deepEqual(sorted(pc?.candidates as string[]), sorted([thief.id("fm"), thief.id("theirFm")]));
});

clause(FUMAST, "0:unique", "after I answer the Unique choice for a F.U.M.A.S.T. I took, only one is left in play and the game carries on", () => {
  const thief = locationThiefBoard();
  playRaw(thief.engine, P1, thief.id("thief"), { selected: { t: [thief.id("theirFm")] } });
  resolvePendingResponses(thief.engine);
  assert.equal(pending(thief.engine)?.kind, "uniqueSurvivor");
  thief.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: thief.id("fm") } } as never);
  resolvePendingResponses(thief.engine);
  const inPlay = ["fm", "theirFm"].filter((key) => zoneOf(thief.engine, thief.id(key)) === "play");
  assert.equal(inPlay.length, 1, "only one of the two F.U.M.A.S.T. remains in play");
  assert.equal(thief.engine.state.responseWindow, undefined, "the game is not stuck in a resolving window");
});

clause(FUMAST, "0:unique", "a card with a different UNIQUE designation is not a duplicate", () => {
  const { engine, id } = fumastBoard({
    extra: [{ key: "fm2", def: printing(FUMAST), owner: P1, zone: "hand" }, { key: "other", def: character({ name: "Someone", unique: "someone" }), owner: P1, zone: "play" }, ...bank("greed", 6, P1)],
    fumast: false
  });
  play(engine, P1, id("fm2"));
  assert.equal(zoneOf(engine, id("fm2")), "play");
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(pending(engine), undefined, "no Unique choice");
});

clause(FUMAST, "1:rule", "costs 6 with six [G]; has 8 structure: 7 damage leaves it in play, 8 destroys it", () => {
  const exact = fumastBoard({ fumast: false, greed: 6, extra: [{ key: "fm", def: printing(FUMAST), owner: P1, zone: "hand" }] });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("fm"))), 6);
  assert.equal(zoneOf(exact.engine, exact.id("fm")), "play");

  // six [G] met by already-spent Greed, but only five ready resources for the cost of 6
  const short = fumastBoard({ fumast: false, greed: 0, extra: [{ key: "fm", def: printing(FUMAST), owner: P1, zone: "hand" }, ...bank("greed", 6, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 5, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("fm")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  const fiveG = fumastBoard({ fumast: false, greed: 5, extra: [{ key: "fm", def: printing(FUMAST), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)] });
  refused(() => playRaw(fiveG.engine, P1, fiveG.id("fm")), "only five [G]: all six icons are required", /Threshold requirements are not met/);

  for (const [damage, destroyed] of [[7, false], [8, true]] as const) {
    const game = fumastBoard({ extra: [{ key: "smash", def: locationDamageTactic(damage), owner: P1, zone: "hand" }] });
    play(game.engine, P1, game.id("smash"), { selected: { t: [game.id("fm")] } });
    assert.equal(zoneOf(game.engine, game.id("fm")), destroyed ? "discard" : "play", `${damage} damage`);
  }
});

// --- Furtive Investor --------------------------------------------------------------
// COVERT
// This card enters play with 2 tokens on it.
// This card loses 1 strength and 1 life for each token on it.
// At the start of your turn, you may pick a non-resource card you control. If you do, remove a token
// from that card.
// Character (banker; investor, mau), cost 4, threshold [G][G], 3 strength / 3 speed / 3 life.

const INVESTOR = "63394a45-b039-47ad-86ff-9853ceedf6df";

clause(INVESTOR, "0:kw:COVERT", "has COVERT", () => covertHasKeyword(INVESTOR));
clause(INVESTOR, "0:kw:COVERT", "cannot be blocked by non-covert characters; a covert character can block it", () => covertCannotBeBlockedByNonCovert(INVESTOR));
clause(INVESTOR, "0:kw:COVERT", "a party with a non-covert member is not a covert party, so anyone may block it", () => covertPartyNeedsEveryMemberCovert(INVESTOR));
clause(INVESTOR, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(INVESTOR));

function investorInPlay(tokens: number, opts: { extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "inv", def: printing(INVESTOR), owner: P1, zone: "play", counters: tokens ? { token: tokens } : {} },
      { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "clean", def: character({ name: "Clean", life: 5 }), owner: P1, zone: "play" },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play", counters: { token: 4 } },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play", counters: { token: 3 } },
      { key: "foeItm", def: item({ name: "FoeItm" }), owner: P2, zone: "play", counters: { token: 3 } },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true, counters: { token: 3 } },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand", counters: { token: 3 } },
      ...fillers("d", 2, P1, "deck"),
      ...fillers("od", 2, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

/** Starts P1's turn (P2 ends theirs). The Investor's start-of-turn trigger then waits for P1's answer. */
function startOfMyTurn(game: ReturnType<typeof investorInPlay>): void {
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1, "P1's turn has started");
}

/** Answers the Investor's start-of-turn pick with `key` (or picks nothing). */
function investorPick(game: ReturnType<typeof investorInPlay>, key?: string): void {
  const pc = pending(game.engine);
  assert.ok(pc, "the Investor asks for a pick at the start of my turn");
  assert.equal(pc.playerId, P1, "its controller picks");
  engineAnswer(game.engine, pc, key === undefined ? [] : [game.id(key)]);
}

/** Answers whichever pick-style choice is open (`selectTargets` keyed by declaration, or `chooserSelectsTarget`). */
function engineAnswer(engine: SpoilsEngine, pc: PendingChoiceLike, selected: CardInstanceId[]): void {
  if (pc.kind === "chooserSelectsTarget") {
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);
  } else {
    const decl = ((pc.declarations as { id: string }[] | undefined) ?? [])[0]?.id ?? "pick";
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, selected: { [decl]: selected } } } as never);
  }
  resolvePendingResponses(engine);
}

clause(INVESTOR, "1:rule", "enters play with exactly 2 tokens", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "inv", def: printing(INVESTOR), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  assert.equal(tokensOn(engine, id("inv")), 0);
  play(engine, P1, id("inv"));
  assert.equal(zoneOf(engine, id("inv")), "play");
  assert.equal(tokensOn(engine, id("inv")), 2);
});

clause(INVESTOR, "1:rule", "the tokens come when it enters play, not while it is being deployed; it also gets them when put into play by an effect", () => {
  const deploy = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "inv", def: printing(INVESTOR), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  playRaw(deploy.engine, P1, deploy.id("inv"));
  assert.equal(tokensOn(deploy.engine, deploy.id("inv")), 0);
  resolvePendingResponses(deploy.engine);
  assert.equal(tokensOn(deploy.engine, deploy.id("inv")), 2);

  const raised = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "re", def: reanimator(), owner: P1, zone: "play" }, { key: "inv", def: printing(INVESTOR), owner: P1, zone: "discard" }]
  });
  activate(raised.engine, P1, raised.id("re"), "raise", { selected: { t: [raised.id("inv")] } });
  assert.equal(tokensOn(raised.engine, raised.id("inv")), 2);
});

clause(INVESTOR, "1:rule", "another card entering play gives it no tokens", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "inv", def: printing(INVESTOR), owner: P1, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("greed", 1, P1)
    ]
  });
  play(engine, P1, id("newbie"));
  assert.equal(tokensOn(engine, id("inv")), 0);
});

clause(INVESTOR, "1:rule", "tokens disappear when it leaves play (CR 409.2): returned to hand and deployed again it has 2 tokens, not 4", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "inv", def: printing(INVESTOR), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "bounce", def: bounce(), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1)
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("inv")] } });
  assert.equal(zoneOf(engine, id("inv")), "hand");
  play(engine, P1, id("inv"));
  assert.equal(tokensOn(engine, id("inv")), 2, "a fresh card: its old tokens are gone");
});

for (const [tokens, strength, life] of [
  [0, 3, 3],
  [1, 2, 2],
  [2, 1, 1]
] as const) {
  clause(INVESTOR, "2:rule", `with ${tokens} token(s) it has ${strength} strength and ${life} life (speed unchanged at 3)`, () => {
    const { engine, id } = investorInPlay(tokens);
    assert.deepEqual(stats(engine, id("inv")), [strength, life, 3]);
  });
}

clause(INVESTOR, "2:rule", "with 3 tokens its life is 0 and it is destroyed (FAQ: a character with 0 life is destroyed)", () => {
  const { engine, id } = investorInPlay(3);
  assert.equal(engine.getStat(id("inv"), "life"), 0);
  settleState(engine);
  assert.equal(zoneOf(engine, id("inv")), "discard");
});

clause(INVESTOR, "2:rule", "only its own tokens count: other cards' tokens do not weaken it, and its tokens do not weaken them", () => {
  const { engine, id } = investorInPlay(1);
  assert.deepEqual(stats(engine, id("inv")), [2, 2, 3]);
  assert.deepEqual(stats(engine, id("ally")), [1, 5, 1], "the Ally with 3 tokens of its own is unaffected by the Investor's rule");
});

clause(INVESTOR, "2:rule", "the lost life is real: with 2 tokens (1 life) 1 damage destroys it", () => {
  const { engine, id } = investorInPlay(2, { turn: 1, active: P1, extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(engine, P1, id("zap"), { selected: { t: [id("inv")] } });
  assert.equal(zoneOf(engine, id("inv")), "discard");
});

clause(INVESTOR, "3:rule", "at the start of my turn I may pick one of my own tokenised cards: the Investor itself loses a token (2 -> 1) and grows", () => {
  const game = investorInPlay(2);
  startOfMyTurn(game);
  investorPick(game, "inv");
  assert.equal(tokensOn(game.engine, game.id("inv")), 1);
  assert.deepEqual(stats(game.engine, game.id("inv")), [2, 2, 3], "one token fewer: one more strength and life");
  assert.equal(pending(game.engine), undefined);
});

for (const [key, what, start] of [
  ["ally", "another character of mine", 3],
  ["itm", "an item of mine", 2],
  ["loc", "a location of mine", 4]
] as const) {
  clause(INVESTOR, "3:rule", `the pick can be ${what}: it loses exactly one token (${start} -> ${start - 1}) and the Investor keeps its own`, () => {
    const game = investorInPlay(2);
    startOfMyTurn(game);
    investorPick(game, key);
    assert.equal(tokensOn(game.engine, game.id(key)), start - 1);
    assert.equal(tokensOn(game.engine, game.id("inv")), 2, "the Investor's own tokens are untouched");
  });
}

clause(INVESTOR, "3:rule", "'you may': picking nothing removes no token anywhere", () => {
  const game = investorInPlay(2);
  startOfMyTurn(game);
  investorPick(game);
  for (const key of ["inv", "ally", "itm", "loc"]) assert.equal(tokensOn(game.engine, game.id(key)), { inv: 2, ally: 3, itm: 2, loc: 4 }[key]);
  assert.equal(pending(game.engine), undefined);
});

clause(INVESTOR, "3:rule", "picking a card with no tokens removes nothing and does not go below 0", () => {
  const game = investorInPlay(2);
  startOfMyTurn(game);
  investorPick(game, "clean");
  assert.equal(tokensOn(game.engine, game.id("clean")), 0);
  assert.equal(tokensOn(game.engine, game.id("inv")), 2);
});

clause(INVESTOR, "3:rule", "only non-resource cards I control in play can be picked: the opponent's cards, face-down cards, resources, factions and cards in hand are refused", () => {
  const game = investorInPlay(2, { extra: bank("greed", 1, P1) });
  startOfMyTurn(game);
  const pc = pending(game.engine);
  assert.ok(pc, "pc");
  const resourceId = game.engine.state.players[P1].play.find((card) => game.engine.getDefinition(card).type === "resource")!;
  const attempt = (cardId: CardInstanceId) => () => engineAnswer(game.engine, pc, [cardId]);
  refused(attempt(game.id("foe")), "the opponent's character");
  refused(attempt(game.id("foeItm")), "the opponent's item");
  refused(attempt(resourceId), "a face-up resource");
  refused(attempt(game.id("hidden")), "a face-down card");
  refused(attempt(factionOf(game.engine, P1)), "my faction");
  refused(attempt(factionOf(game.engine, P2)), "their faction");
  refused(attempt(game.id("inHand")), "a card in my hand");
  assert.equal(tokensOn(game.engine, game.id("foe")), 3);
  assert.equal(tokensOn(game.engine, game.id("hidden")), 3);
  attempt(game.id("ally"))();
  assert.equal(tokensOn(game.engine, game.id("ally")), 2, "control: my own card is accepted");
});

clause(INVESTOR, "3:rule", "exactly one card is picked: two are refused", () => {
  const game = investorInPlay(2);
  startOfMyTurn(game);
  const pc = pending(game.engine);
  assert.ok(pc, "pc");
  refused(() => engineAnswer(game.engine, pc, [game.id("ally"), game.id("itm")]));
  assert.equal(tokensOn(game.engine, game.id("ally")), 3);
  assert.equal(tokensOn(game.engine, game.id("itm")), 2);
});

clause(INVESTOR, "3:rule", "a card I control but the opponent owns can be picked", () => {
  const game = investorInPlay(2, { extra: [{ key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, zone: "play", controller: P1, counters: { token: 2 } }] });
  startOfMyTurn(game);
  investorPick(game, "borrowed");
  assert.equal(tokensOn(game.engine, game.id("borrowed")), 1);
});

clause(INVESTOR, "3:rule", "it happens at the start of MY turn only: at the start of the opponent's turn I am not asked", () => {
  const game = investorInPlay(2, { turn: 1, active: P1 });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(pending(game.engine), undefined, "no pick at the start of the opponent's turn");
  assert.equal(tokensOn(game.engine, game.id("inv")), 2);
});

clause(INVESTOR, "3:rule", "it happens at the start of every one of my turns: 2 tokens are removed over two turns", () => {
  const game = investorInPlay(2);
  startOfMyTurn(game);
  investorPick(game, "inv");
  endTurn(game.engine, P1);
  assert.equal(pending(game.engine), undefined, "nothing on the opponent's turn");
  endTurn(game.engine, P2);
  investorPick(game, "inv");
  assert.equal(tokensOn(game.engine, game.id("inv")), 0);
  assert.deepEqual(stats(game.engine, game.id("inv")), [3, 3, 3], "back to its printed stats");
});

clause(INVESTOR, "3:rule", "the pick is made by the Investor's controller, even for a card the opponent owns", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "inv", def: printing(INVESTOR), owner: P2, zone: "play", controller: P1, counters: { token: 2 } },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", counters: { token: 1 } },
      ...fillers("od", 2, P2, "deck")
    ]
  });
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  const pc = pending(game.engine);
  assert.ok(pc, "a pick opens at the start of P1's turn");
  assert.equal(pc.playerId, P1, "the controller picks");
});

clause(INVESTOR, "3:rule", "two Investors each trigger: two tokens can be removed in one turn start", () => {
  const game = investorInPlay(2, { extra: [{ key: "inv2", def: printing(INVESTOR), owner: P1, zone: "play", counters: { token: 2 } }] });
  startOfMyTurn(game);
  let picks = 0;
  drain(game.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget" || pc.kind === "selectTargets") {
      picks++;
      const decl = ((pc.declarations as { id: string }[] | undefined) ?? [])[0]?.id ?? "pick";
      return pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [game.id("ally")] }
        : { kind: "selectTargets", selected: { [decl]: [game.id("ally")] } };
    }
    return declineAll(pc);
  });
  assert.equal(picks, 2, "one pick per Investor");
  assert.equal(tokensOn(game.engine, game.id("ally")), 1, "3 - 2");
});

clause(INVESTOR, "3:rule", "costs 4 with [G][G]; has 3 strength / 3 speed / 3 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "inv", def: printing(INVESTOR), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("inv"))), 4);
  assert.equal(zoneOf(exact.engine, exact.id("inv")), "play");
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "inv", def: printing(INVESTOR), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("inv")), "one resource short");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "inv", def: printing(INVESTOR), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 5, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("inv")), "only one [G]");
});

// --- Hired Goons -------------------------------------------------------------------
// COVERT
// At the start of your turn, you may pay 2. If you don't, your opponent takes control of this card.
// Character (banker; mercenary, mau), cost 5, threshold [G][G], 5 strength / 3 speed / 4 life.

const GOONS = "b4d02b5b-bfb5-4384-addd-ba8f738b9940";

clause(GOONS, "0:kw:COVERT", "has COVERT", () => covertHasKeyword(GOONS));
clause(GOONS, "0:kw:COVERT", "cannot be blocked by non-covert characters; a covert character can block it", () => covertCannotBeBlockedByNonCovert(GOONS));
clause(GOONS, "0:kw:COVERT", "a party with a non-covert member is not a covert party, so anyone may block it", () => covertPartyNeedsEveryMemberCovert(GOONS));
clause(GOONS, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(GOONS));

/** The Goons in play for P1 (or `owner`/`controller` overrides) and `greed` ready [G] for each side; P2's turn is about to end. */
function goonsBoard(opts: { greed?: number; oppResources?: number; owner?: Pid; controller?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "gg", def: printing(GOONS), owner: opts.owner ?? P1, controller: opts.controller, zone: "play" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", opts.oppResources ?? 3, P2),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck")
    ]
  });
}

const goonsOwnedBy = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, player: Pid): boolean =>
  engine.state.players[player].play.includes(id("gg")) && controllerOf(engine, id("gg")) === player;

clause(GOONS, "1:rule", "paying 2 at the start of my turn keeps the Goons: I still control it and exactly 2 resources were paid", () => {
  const { engine, id } = goonsBoard();
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay", "I am offered the payment");
  assert.equal(pc?.playerId, P1);
  const before = ready(engine);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(before - ready(engine), 2, "exactly 2 paid");
  assert.equal(controllerOf(engine, id("gg")), P1);
  assert.equal(zoneOf(engine, id("gg")), "play");
});

clause(GOONS, "1:rule", "declining to pay: nothing is paid and the OPPONENT takes control of the Goons", () => {
  const { engine, id } = goonsBoard();
  endTurn(engine, P2);
  const before = ready(engine);
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(ready(engine), before, "nothing was spent");
  assert.equal(controllerOf(engine, id("gg")), P2, "my opponent controls it now");
  assert.ok(engine.state.players[P2].play.includes(id("gg")), "it is among their cards in play");
  assert.equal(engine.state.players[P1].play.includes(id("gg")), false, "and no longer among mine");
  assert.equal(engine.state.cards[id("gg")].ownerId, P1, "ownership never changes");
  assert.equal(zoneOf(engine, id("gg")), "play");
});

clause(GOONS, "1:rule", "the control change is permanent (CR 407.3): it is still the opponent's after the turn goes round", () => {
  const { engine, id } = goonsBoard({ oppResources: 4 });
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(controllerOf(engine, id("gg")), P2);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay", "now THEY are asked: the Goons' controller pays or loses it");
  assert.equal(pc?.playerId, P2);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(controllerOf(engine, id("gg")), P2, "they paid and keep it");
});

clause(GOONS, "1:rule", "'your opponent' follows control: when the new controller declines, it goes back to me", () => {
  const { engine, id } = goonsBoard();
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: false });
  endTurn(engine, P1);
  assert.equal(pending(engine)?.playerId, P2);
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(controllerOf(engine, id("gg")), P1, "the other player takes control of it");
  assert.ok(engine.state.players[P1].play.includes(id("gg")), "engine.state.players[P1].play.includes(id(\"gg\"))");
});

clause(GOONS, "1:rule", "with fewer than 2 ready resources I cannot pay, so the opponent takes control", () => {
  const { engine, id } = goonsBoard({ greed: 1 });
  endTurn(engine, P2);
  const pc = pending(engine);
  if (pc) {
    refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } } as never), "cannot pay 2 with 1 resource");
    answerPending(engine, "mayPay", { pay: false });
  }
  assert.equal(controllerOf(engine, id("gg")), P2);
  assert.equal(ready(engine), 1, "nothing was spent");
});

clause(GOONS, "1:rule", "with no resources at all the opponent takes control", () => {
  const { engine, id } = goonsBoard({ greed: 0 });
  endTurn(engine, P2);
  if (pending(engine)) answerPending(engine, "mayPay", { pay: false });
  assert.equal(controllerOf(engine, id("gg")), P2);
});

clause(GOONS, "1:rule", "exactly 2 ready resources are enough to pay", () => {
  const { engine, id } = goonsBoard({ greed: 2 });
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(controllerOf(engine, id("gg")), P1);
  assert.equal(ready(engine), 0);
});

clause(GOONS, "1:rule", "it is only at the start of the CONTROLLER's turn: no question at the start of the opponent's turn", () => {
  const { engine, id } = goonsBoard({ greed: 4 });
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(pending(engine), undefined, "my Goons asks nothing at the start of the opponent's turn");
  assert.equal(controllerOf(engine, id("gg")), P1);
});

clause(GOONS, "1:rule", "it asks every one of my turns: I pay at each start of turn to keep it", () => {
  const { engine, id } = goonsBoard({ greed: 4 });
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(pending(engine)?.kind, "mayPay", "asked again on my next turn");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(controllerOf(engine, id("gg")), P1);
});

clause(GOONS, "1:rule", "'your' is the controller: Goons that P2 owns but P1 controls ask P1, and P1 declining gives it to P2", () => {
  const { engine, id } = goonsBoard({ owner: P2, controller: P1 });
  endTurn(engine, P2);
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1, "its controller is asked");
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(controllerOf(engine, id("gg")), P2);
});

clause(GOONS, "1:rule", "a Goons controlled by the opponent does not make ME pay at the start of my turn", () => {
  const { engine, id } = goonsBoard({ owner: P1, controller: P2 });
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine), undefined, "I am not asked about a card I do not control");
  assert.equal(controllerOf(engine, id("gg")), P2);
});

clause(GOONS, "1:rule", "costs 5 with [G][G]; has 5 strength / 3 speed / 4 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "gg", def: printing(GOONS), owner: P1, zone: "hand" }, ...bank("greed", 5, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("gg"))), 5);
  assert.deepEqual(stats(exact.engine, exact.id("gg")), [5, 4, 3]);
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "gg", def: printing(GOONS), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("gg")), "one resource short");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "gg", def: printing(GOONS), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 6, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("gg")), "only one [G]");
});

// --- Inside Information ------------------------------------------------------------
// PROFIT. COST: Deplete this card. EFFECT: Draw 4 cards. Your opponent takes control of this card.
// Item (banker), cost 3, threshold [G][G].

const INSIDE = "ce20a6a6-4cf6-4b28-96d1-8b68c1441c10";

function insideBoard(opts: { deck?: number; odeck?: number; owner?: Pid; controller?: Pid; depleted?: boolean; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ii", def: printing(INSIDE), owner: opts.owner ?? P1, controller: opts.controller, zone: "play", depleted: opts.depleted },
      ...fillers("d", opts.deck ?? 6, P1, "deck"),
      ...fillers("od", opts.odeck ?? 6, P2, "deck"),
      ...fillers("mineh", 1, P1, "hand"),
      ...fillers("oh", 1, P2, "hand"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(INSIDE, "0:ability:profit", "draws exactly 4 cards (the top 4 of my deck, in order) and nothing else is drawn", () => {
  const { engine, id } = insideBoard();
  const top4 = deckOf(engine, P1).slice(0, 4);
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("ii"), "profit");
  assert.equal(handOf(engine, P1).length, handBefore + 4);
  for (const card of top4) assert.equal(zoneOf(engine, card), "hand", "the top four cards were drawn");
  assert.equal(deckOf(engine, P1).length, 2);
  assert.equal(deckOf(engine, P2).length, 6, "the opponent's deck is untouched");
  assert.equal(handOf(engine, P2).length, 1);
});

clause(INSIDE, "0:ability:profit", "my opponent takes control of it: it stays in play, among their cards, still owned by me", () => {
  const { engine, id } = insideBoard();
  activate(engine, P1, id("ii"), "profit");
  assert.equal(controllerOf(engine, id("ii")), P2);
  assert.equal(zoneOf(engine, id("ii")), "play", "it stays in play");
  assert.ok(engine.state.players[P2].play.includes(id("ii")), "engine.state.players[P2].play.includes(id(\"ii\"))");
  assert.equal(engine.state.players[P1].play.includes(id("ii")), false);
  assert.equal(engine.state.cards[id("ii")].ownerId, P1, "ownership never changes");
});

clause(INSIDE, "0:ability:profit", "'Deplete this card' is a cost: it is depleted as soon as the ability is used; the draw and the control change wait for resolution", () => {
  const { engine, id } = insideBoard();
  activateRaw(engine, P1, id("ii"), "profit");
  assert.equal(isDepleted(engine, id("ii")), true, "depleted while the ability waits for responses");
  assert.equal(handOf(engine, P1).length, 1, "nothing drawn yet");
  assert.equal(controllerOf(engine, id("ii")), P1, "control has not changed yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, 5);
  assert.equal(controllerOf(engine, id("ii")), P2);
});

clause(INSIDE, "0:ability:profit", "it costs no resources", () => {
  const { engine, id } = insideBoard();
  assert.equal(ready(engine), 0);
  activate(engine, P1, id("ii"), "profit");
  assert.equal(handOf(engine, P1).length, 5);
});

clause(INSIDE, "0:ability:profit", "a depleted Inside Information cannot be used", () => {
  const { engine, id } = insideBoard({ depleted: true });
  refused(() => activateRaw(engine, P1, id("ii"), "profit"));
  assert.equal(handOf(engine, P1).length, 1);
  assert.equal(controllerOf(engine, id("ii")), P1);
});

clause(INSIDE, "0:ability:profit", "with fewer than 4 cards in my deck I draw what there is (CR 306.2) and the opponent still takes control", () => {
  const { engine, id } = insideBoard({ deck: 2 });
  activate(engine, P1, id("ii"), "profit");
  assert.equal(handOf(engine, P1).length, 3, "both deck cards drawn");
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(controllerOf(engine, id("ii")), P2);
});

clause(INSIDE, "0:ability:profit", "with an empty deck the opponent still takes control", () => {
  const { engine, id } = insideBoard({ deck: 0 });
  activate(engine, P1, id("ii"), "profit");
  assert.equal(controllerOf(engine, id("ii")), P2);
  assert.equal(pending(engine), undefined);
});

clause(INSIDE, "0:ability:profit", "once the opponent controls it, it is theirs to use: after their restore they draw 4 and I take control back", () => {
  const { engine, id } = insideBoard({ turn: 1, active: P1 });
  activate(engine, P1, id("ii"), "profit");
  assert.equal(isDepleted(engine, id("ii")), true);
  refused(() => activateRaw(engine, P1, id("ii"), "profit"), "I no longer control it (and it is depleted)");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("ii")), false, "their restore untapped it");
  const oppTop4 = deckOf(engine, P2).slice(0, 4);
  const oppHand = handOf(engine, P2).length;
  activate(engine, P2, id("ii"), "profit");
  assert.equal(handOf(engine, P2).length, oppHand + 4, "THEY drew four");
  for (const card of oppTop4) assert.equal(zoneOf(engine, card), "hand");
  assert.equal(controllerOf(engine, id("ii")), P1, "their opponent (me) takes control back");
});

clause(INSIDE, "0:ability:profit", "'draw' and 'your opponent' are relative to the controller: an Inside Information P2 owns but P1 controls draws for P1 and goes to P2", () => {
  const { engine, id } = insideBoard({ owner: P2, controller: P1 });
  activate(engine, P1, id("ii"), "profit");
  assert.equal(handOf(engine, P1).length, 5, "P1 (the controller) drew 4");
  assert.equal(handOf(engine, P2).length, 1);
  assert.equal(controllerOf(engine, id("ii")), P2, "P1's opponent takes control");
});

clause(INSIDE, "0:ability:profit", "it can be used in response on the opponent's turn", () => {
  const { engine, id } = insideBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  activateRaw(engine, P1, id("ii"), "profit");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, 5);
  assert.equal(controllerOf(engine, id("ii")), P2);
});

clause(INSIDE, "0:ability:profit", "only the controller can use it: I cannot use an Inside Information the opponent controls", () => {
  const { engine, id } = insideBoard({ turn: 2, active: P2, owner: P2 });
  refused(() => activateRaw(engine, P1, id("ii"), "profit"));
  assert.equal(handOf(engine, P1).length, 1);
});

clause(INSIDE, "0:ability:profit", "costs 3 with [G][G]", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ii", def: printing(INSIDE), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("ii"))), 3);
  assert.equal(zoneOf(exact.engine, exact.id("ii")), "play");
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ii", def: printing(INSIDE), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("ii")), "one resource short");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ii", def: printing(INSIDE), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("ii")), "only one [G]");
});

// --- Keen Stratagem ----------------------------------------------------------------
// Search your deck for a staple resource, reveal it, and put it into your hand.
// Tactic (banker), cost 1, threshold [G].

const STRATAGEM = "210c93ab-9cc2-45a8-9e8e-0aec15e38f54";

const staple = (name: string, icon: "rage" | "greed" | "deception" | "elitism" | "obsession"): CardDefinition =>
  resourceCard({ name, resource: { provides: [icon], staple: true } });

const STAPLES = [
  ["rage", "Rage"],
  ["greed", "Greed"],
  ["deception", "Deception"],
  ["elitism", "Elitism"],
  ["obsession", "Obsession"]
] as const;

/** P1 holds the Stratagem and 1 [G]; the deck is (top to bottom) a non-staple resource, two characters, then the five staples and a spare Greed. */
function stratagemBoard(opts: { deck?: "full" | "noStaples" | "empty"; greed?: number; random?: () => number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  const deck: CardPlacement[] =
    opts.deck === "empty"
      ? []
      : [
          { key: "fancy", def: resourceCard({ name: "Fancy Resource", resource: { provides: ["greed"], staple: false } }), owner: P1, zone: "deck" },
          { key: "dc1", def: character({ name: "Deck Char 1" }), owner: P1, zone: "deck" },
          { key: "dc2", def: character({ name: "Deck Char 2" }), owner: P1, zone: "deck" },
          ...(opts.deck === "noStaples"
            ? []
            : [
                ...STAPLES.map(([icon, name]) => ({ key: `s_${icon}`, def: staple(name, icon), owner: P1, zone: "deck" as const })),
                { key: "s_greed2", def: staple("Greed", "greed"), owner: P1, zone: "deck" as const }
              ]),
          { key: "dc3", def: character({ name: "Deck Char 3" }), owner: P1, zone: "deck" }
        ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random ?? (() => 0.5),
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ks", def: printing(STRATAGEM), owner: P1, zone: "hand" },
      { key: "inHandStaple", def: staple("Greed", "greed"), owner: P1, zone: "hand" },
      { key: "inDiscardStaple", def: staple("Greed", "greed"), owner: P1, zone: "discard" },
      { key: "oppStaple", def: staple("Greed", "greed"), owner: P2, zone: "deck" },
      { key: "oppChar", def: character({ name: "Opp Char" }), owner: P2, zone: "deck" },
      ...deck,
      ...bank("greed", opts.greed ?? 1, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays the Stratagem and, if a pick opens, answers it with `pickKey` (nothing when undefined). */
function stratagem(game: ReturnType<typeof stratagemBoard>, pickKey?: string): void {
  play(game.engine, P1, game.id("ks"));
  const pc = pending(game.engine);
  if (pc) {
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "I search my own deck");
    answerPending(game.engine, "chooserSelectsTarget", { selected: pickKey ? [game.id(pickKey)] : [] });
  }
}

for (const [icon, name] of STAPLES) {
  clause(STRATAGEM, "0:rule", `finds a staple resource (${name}) in my deck and puts it into my hand, and nothing else`, () => {
    const game = stratagemBoard();
    const deckBefore = deckOf(game.engine, P1).length;
    const handBefore = handOf(game.engine, P1).length;
    stratagem(game, `s_${icon}`);
    assert.equal(zoneOf(game.engine, game.id(`s_${icon}`)), "hand");
    assert.equal(deckBefore - deckOf(game.engine, P1).length, 1, "exactly one card left the deck");
    assert.equal(handOf(game.engine, P1).length, handBefore - 1 + 1, "the tactic left my hand, the staple came in");
    assert.equal(zoneOf(game.engine, game.id("ks")), "discard");
  });
}

clause(STRATAGEM, "0:rule", "it is revealed: a 'cards revealed' event names the found card", () => {
  const game = stratagemBoard();
  stratagem(game, "s_rage");
  const reveals = game.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.ok(
    reveals.some((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds.includes(game.id("s_rage"))),
    "the found Rage was revealed"
  );
});

clause(STRATAGEM, "0:rule", "a staple resource only: a non-staple resource card and ordinary cards in my deck are refused", () => {
  const game = stratagemBoard();
  play(game.engine, P1, game.id("ks"));
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  const attempt = (cardId: CardInstanceId) => () =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
  refused(attempt(game.id("fancy")), "a resource card that is not a staple");
  refused(attempt(game.id("dc1")), "a character");
  refused(attempt(game.id("dc3")), "another character");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the search is still open");
  attempt(game.id("s_elitism"))();
  assert.equal(zoneOf(game.engine, game.id("s_elitism")), "hand", "control: a staple is accepted");
});

clause(STRATAGEM, "0:rule", "only MY deck is searched: staples in the opponent's deck, my hand and my discard pile are refused", () => {
  const game = stratagemBoard();
  play(game.engine, P1, game.id("ks"));
  const attempt = (cardId: CardInstanceId) => () =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [cardId] } } as never);
  refused(attempt(game.id("oppStaple")), "a staple in the opponent's deck");
  refused(attempt(game.id("inHandStaple")), "a staple already in my hand");
  refused(attempt(game.id("inDiscardStaple")), "a staple in my discard pile");
  attempt(game.id("s_greed2"))();
  assert.equal(zoneOf(game.engine, game.id("s_greed2")), "hand");
});

clause(STRATAGEM, "0:rule", "exactly one card: two staples are refused", () => {
  const game = stratagemBoard();
  play(game.engine, P1, game.id("ks"));
  refused(() =>
    game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [game.id("s_rage"), game.id("s_greed")] } } as never)
  );
  assert.equal(zoneOf(game.engine, game.id("s_rage")), "deck");
});

clause(STRATAGEM, "0:rule", "I may fail the search (CR 312.2): picking nothing leaves my hand alone", () => {
  const game = stratagemBoard();
  const handBefore = handOf(game.engine, P1).length;
  const deckBefore = deckOf(game.engine, P1).length;
  stratagem(game, undefined);
  assert.equal(handOf(game.engine, P1).length, handBefore - 1, "only the tactic left my hand");
  assert.equal(deckOf(game.engine, P1).length, deckBefore);
  assert.equal(zoneOf(game.engine, game.id("ks")), "discard");
  assert.equal(pending(game.engine), undefined);
});

clause(STRATAGEM, "0:rule", "a deck with no staple resource: nothing to find, the tactic still resolves", () => {
  const game = stratagemBoard({ deck: "noStaples" });
  const handBefore = handOf(game.engine, P1).length;
  stratagem(game, undefined);
  assert.equal(handOf(game.engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(game.engine, game.id("ks")), "discard");
  assert.equal(pending(game.engine), undefined);
});

clause(STRATAGEM, "0:rule", "an empty deck: nothing breaks", () => {
  const game = stratagemBoard({ deck: "empty" });
  stratagem(game, undefined);
  assert.equal(zoneOf(game.engine, game.id("ks")), "discard");
  assert.equal(pending(game.engine), undefined);
});

clause(STRATAGEM, "0:rule", "a searched deck is shuffled afterwards (CR 312.1): the remaining cards are reordered", () => {
  const game = stratagemBoard({ random: () => 0 });
  const before = [...deckOf(game.engine, P1)];
  stratagem(game, "s_rage");
  const remaining = before.filter((card) => card !== game.id("s_rage"));
  assert.deepEqual(sorted(deckOf(game.engine, P1)), sorted(remaining), "the same cards remain");
  assert.deepEqual(deckOf(game.engine, P1), shuffledWithConstant(remaining, 0), "in a freshly shuffled order");
  assert.notDeepEqual(deckOf(game.engine, P1), remaining, "which is not the old order");
});

clause(STRATAGEM, "0:rule", "the deck is shuffled even when I fail the search (CR 312.1)", () => {
  const game = stratagemBoard({ random: () => 0 });
  const before = [...deckOf(game.engine, P1)];
  stratagem(game, undefined);
  assert.deepEqual(deckOf(game.engine, P1), shuffledWithConstant(before, 0), "a searched deck is shuffled whether or not anything was found");
});

clause(STRATAGEM, "0:rule", "the opponent's deck is not touched (not searched, not shuffled)", () => {
  const game = stratagemBoard({ random: () => 0 });
  const oppBefore = [...deckOf(game.engine, P2)];
  stratagem(game, "s_rage");
  assert.deepEqual(deckOf(game.engine, P2), oppBefore);
});

clause(STRATAGEM, "0:rule", "the search happens when the tactic resolves, not while the opponent can still respond", () => {
  const game = stratagemBoard();
  playRaw(game.engine, P1, game.id("ks"));
  assert.equal(pending(game.engine), undefined, "no search yet");
  assert.equal(game.engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(game.engine);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the search opens when it resolves");
});

clause(STRATAGEM, "0:rule", "it can be played in response on the opponent's turn", () => {
  const game = stratagemBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  refused(() => playRaw(game.engine, P1, game.id("ks")), "nothing to respond to yet");
  playRaw(game.engine, P2, game.id("opp"));
  playRaw(game.engine, P1, game.id("ks"));
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("s_obsession")] });
  assert.equal(zoneOf(game.engine, game.id("s_obsession")), "hand");
  assert.equal(zoneOf(game.engine, game.id("opp")), "play");
});

clause(STRATAGEM, "0:rule", "costs 1 with [G]: refused with no resources, or with only a non-[G] resource", () => {
  const exact = stratagemBoard({ greed: 1 });
  assert.equal(spentBy(exact.engine, P1, () => stratagem(exact, "s_rage")), 1, "pays exactly 1");
  const none = stratagemBoard({ greed: 0 });
  refused(() => playRaw(none.engine, P1, none.id("ks")), "no resources");
  const rage = stratagemBoard({ greed: 0, extra: bank("rage", 3, P1) });
  refused(() => playRaw(rage.engine, P1, rage.id("ks")), "no [G]");
  assert.equal(zoneOf(rage.engine, rage.id("ks")), "hand");
});

// --- Key Man -----------------------------------------------------------------------
// If this card leaves play, draw a card.
// Character (banker; executive, mau), cost 1, threshold [G], 1 strength / 3 speed / 1 life.

const KEYMAN = "062c99df-9e9b-4667-b615-a0e936efa356";

/** A tactic that makes its controller's opponent discard a card from hand (id `dd`, picks one of the opponent's hand cards `t`). */
function discardFromHandTactic(): CardDefinition {
  return tactic({
    name: "Discarder",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dd",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  });
}

function keyManBoard(opts: { deck?: number; owner?: Pid; controller?: Pid; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "km", def: printing(KEYMAN), owner: opts.owner ?? P1, controller: opts.controller, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...fillers("d", opts.deck ?? 4, P1, "deck"),
      ...fillers("od", 4, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(KEYMAN, "0:rule", "destroyed: its controller draws exactly one card (the top of their deck)", () => {
  const { engine, id } = keyManBoard();
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("kill"), { selected: { t: [id("km")] } });
  assert.equal(zoneOf(engine, id("km")), "discard");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left, one card drawn");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.equal(deckOf(engine, P2).length, 4, "the opponent draws nothing");
});

clause(KEYMAN, "0:rule", "'leaves play' is any way: returned to hand it draws a card too", () => {
  const { engine, id } = keyManBoard({ extra: [{ key: "bounce", def: bounce(), owner: P1, zone: "hand" }] });
  const top = deckOf(engine, P1)[0];
  play(engine, P1, id("bounce"), { selected: { t: [id("km")] } });
  assert.equal(zoneOf(engine, id("km")), "hand");
  assert.equal(zoneOf(engine, top), "hand", "drawn");
  assert.equal(deckOf(engine, P1).length, 3, "exactly one card");
});

clause(KEYMAN, "0:rule", "destroyed by battle damage it draws a card", () => {
  const { engine, id } = keyManBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" }]
  });
  const top = deckOf(engine, P1)[0];
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("km")]);
  assert.equal(zoneOf(engine, id("km")), "discard");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(deckOf(engine, P1).length, 3);
});

clause(KEYMAN, "0:rule", "an empty deck: nothing is drawn and nothing breaks", () => {
  const { engine, id } = keyManBoard({ deck: 0 });
  play(engine, P1, id("kill"), { selected: { t: [id("km")] } });
  assert.equal(zoneOf(engine, id("km")), "discard");
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(pending(engine), undefined);
});

clause(KEYMAN, "0:rule", "another card of mine leaving play does not draw", () => {
  const { engine, id } = keyManBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(deckOf(engine, P1).length, 4, "no draw");
  assert.equal(zoneOf(engine, id("km")), "play");
});

clause(KEYMAN, "0:rule", "'draw' is the controller's: a Key Man P2 owns but P1 controls draws for P1 when it dies", () => {
  const { engine, id } = keyManBoard({ owner: P2, controller: P1 });
  const top = deckOf(engine, P1)[0];
  play(engine, P1, id("kill"), { selected: { t: [id("km")] } });
  assert.equal(zoneOf(engine, id("km")), "discard");
  assert.equal(zoneOf(engine, top), "hand", "its controller drew");
  assert.equal(deckOf(engine, P2).length, 4, "its owner did not");
});

clause(KEYMAN, "0:rule", "the opponent's Key Man draws for THEM", () => {
  const { engine, id } = keyManBoard({ owner: P2 });
  const oppTop = deckOf(engine, P2)[0];
  play(engine, P1, id("kill"), { selected: { t: [id("km")] } });
  assert.equal(zoneOf(engine, id("km")), "discard");
  assert.equal(zoneOf(engine, oppTop), "hand", "P2 drew");
  assert.equal(deckOf(engine, P1).length, 4, "I did not");
});

clause(KEYMAN, "0:rule", "a Key Man that never was in play does not draw when it is discarded from hand", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "km", def: printing(KEYMAN), owner: P1, zone: "hand" },
      { key: "disc", def: discardFromHandTactic(), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck")
    ]
  });
  play(game.engine, P1, game.id("disc"), { selected: { t: [game.id("km")] } });
  assert.equal(zoneOf(game.engine, game.id("km")), "discard");
  assert.equal(deckOf(game.engine, P1).length, 3, "no draw: it did not leave play");
});

clause(KEYMAN, "0:rule", "a face-down Key Man is just a resource: it has no trigger", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "km", def: printing(KEYMAN), owner: P1, zone: "play", faceDown: true },
      { key: "killRes", def: tactic({ name: "KillRes", cost: 0, behavior: { abilities: [{ id: "kr", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck")
    ]
  });
  play(engine, P1, id("killRes"), { selected: { t: [id("km")] } });
  assert.equal(zoneOf(engine, id("km")), "discard");
  assert.equal(deckOf(engine, P1).length, 3);
});

clause(KEYMAN, "0:rule", "each Key Man draws its own card: two destroyed in turn draw two", () => {
  const { engine, id } = keyManBoard({ extra: [{ key: "km2", def: printing(KEYMAN), owner: P1, zone: "play" }, { key: "kill2", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("km")] } });
  play(engine, P1, id("kill2"), { selected: { t: [id("km2")] } });
  assert.equal(deckOf(engine, P1).length, 2);
});

clause(KEYMAN, "0:rule", "costs 1 with [G]; has 1 strength / 3 speed / 1 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "km", def: printing(KEYMAN), owner: P1, zone: "hand" }, ...bank("greed", 1, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("km"))), 1);
  assert.deepEqual(stats(exact.engine, exact.id("km")), [1, 1, 3]);
  const none = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "km", def: printing(KEYMAN), owner: P1, zone: "hand" }]
  });
  refused(() => playRaw(none.engine, P1, none.id("km")), "no resource");
  const noG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "km", def: printing(KEYMAN), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)]
  });
  refused(() => playRaw(noG.engine, P1, noG.id("km")), "no [G]");
});

// --- Market Oracle -----------------------------------------------------------------
// INVEST. COST: Deplete this card. Pick a non-resource card you control. EFFECT: Remove a token from the card.
// Character (banker; investor, mau), cost 2, threshold [G], 1 strength / 3 speed / 2 life.

const ORACLE = "2d521705-d7e3-4c99-a5a8-682dd96ac1c6";

function oracleBoard(opts: { depleted?: boolean; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "mo", def: printing(ORACLE), owner: P1, zone: "play", depleted: opts.depleted, counters: { token: 2 } },
      { key: "c", def: character({ name: "C", life: 5 }), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play", counters: { token: 4 } },
      { key: "clean", def: character({ name: "Clean", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play", counters: { token: 3 } },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true, counters: { token: 3 } },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand", counters: { token: 3 } },
      ...(opts.extra ?? [])
    ]
  });
}

for (const [key, what, start] of [
  ["c", "another character of mine", 3],
  ["itm", "an item of mine", 2],
  ["loc", "a location of mine", 4],
  ["mo", "the Oracle itself", 2]
] as const) {
  clause(ORACLE, "0:ability:invest", `removes exactly one token from the picked card (${what}: ${start} -> ${start - 1})`, () => {
    const { engine, id } = oracleBoard();
    activate(engine, P1, id("mo"), "invest", { selected: { pick: [id(key)] } });
    assert.equal(tokensOn(engine, id(key)), start - 1);
    if (key !== "mo") assert.equal(tokensOn(engine, id("mo")), 2, "the Oracle's own tokens are untouched");
    for (const other of ["c", "itm", "loc"].filter((k) => k !== key)) assert.equal(tokensOn(engine, id(other)), { c: 3, itm: 2, loc: 4 }[other as "c"], `${other} untouched`);
  });
}

clause(ORACLE, "0:ability:invest", "'Deplete this card' is a cost: depleted as soon as the ability is used; the token comes off when it resolves", () => {
  const { engine, id } = oracleBoard();
  activateRaw(engine, P1, id("mo"), "invest", { pick: [id("c")] });
  assert.equal(isDepleted(engine, id("mo")), true, "depleted while the ability waits for responses");
  assert.equal(tokensOn(engine, id("c")), 3, "token still there");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("c")), 2);
  assert.equal(isDepleted(engine, id("mo")), true);
});

clause(ORACLE, "0:ability:invest", "it costs no resources", () => {
  const { engine, id } = oracleBoard({ extra: bank("greed", 2, P1) });
  const spent = spentBy(engine, P1, () => activate(engine, P1, id("mo"), "invest", { selected: { pick: [id("c")] } }));
  assert.equal(tokensOn(engine, id("c")), 2);
  assert.equal(spent, 0, "no resource was spent");
});

clause(ORACLE, "0:ability:invest", "a depleted Oracle cannot use it", () => {
  const { engine, id } = oracleBoard({ depleted: true });
  refused(() => activateRaw(engine, P1, id("mo"), "invest", { pick: [id("c")] }));
  assert.equal(tokensOn(engine, id("c")), 3);
});

clause(ORACLE, "0:ability:invest", "a card with no tokens can be picked: nothing is removed and the count stays at 0", () => {
  const { engine, id } = oracleBoard();
  activate(engine, P1, id("mo"), "invest", { selected: { pick: [id("clean")] } });
  assert.equal(tokensOn(engine, id("clean")), 0);
  assert.equal(isDepleted(engine, id("mo")), true, "the cost was still paid");
});

clause(ORACLE, "0:ability:invest", "only a non-resource card I control in play can be picked: the opponent's cards, face-down cards, resources, factions and cards in hand are refused", () => {
  const { engine, id } = oracleBoard({ extra: bank("greed", 1, P1) });
  const resourceId = engine.state.players[P1].play.find((card) => engine.getDefinition(card).type === "resource")!;
  const attempt = (cardId: CardInstanceId) => () => activateRaw(engine, P1, id("mo"), "invest", { pick: [cardId] });
  refused(attempt(id("foe")), "the opponent's character");
  refused(attempt(resourceId), "a face-up resource");
  refused(attempt(id("hidden")), "a face-down card");
  refused(attempt(factionOf(engine, P1)), "my faction");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(attempt(id("inHand")), "a card in my hand");
  assert.equal(isDepleted(engine, id("mo")), false, "the refused attempts did not deplete the Oracle");
  assert.equal(tokensOn(engine, id("foe")), 3);
  attempt(id("c"))();
  assert.equal(isDepleted(engine, id("mo")), true, "control: my own card is accepted");
});

clause(ORACLE, "0:ability:invest", "exactly one card is picked: none, or two, is refused", () => {
  const { engine, id } = oracleBoard();
  refused(() => activateRaw(engine, P1, id("mo"), "invest", {}), "no pick");
  refused(() => activateRaw(engine, P1, id("mo"), "invest", { pick: [id("c"), id("itm")] }), "two picks");
  assert.equal(isDepleted(engine, id("mo")), false);
});

clause(ORACLE, "0:ability:invest", "a card I control but the opponent owns can be picked", () => {
  const { engine, id } = oracleBoard({ extra: [{ key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, zone: "play", controller: P1, counters: { token: 2 } }] });
  activate(engine, P1, id("mo"), "invest", { selected: { pick: [id("borrowed")] } });
  assert.equal(tokensOn(engine, id("borrowed")), 1);
});

clause(ORACLE, "0:ability:invest", "the Oracle can use it the turn it enters play (CR 204.3a)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mo", def: printing(ORACLE), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "C" }), owner: P1, zone: "play", counters: { token: 2 } },
      ...bank("greed", 2, P1)
    ]
  });
  play(engine, P1, id("mo"));
  activate(engine, P1, id("mo"), "invest", { selected: { pick: [id("c")] } });
  assert.equal(tokensOn(engine, id("c")), 1);
});

clause(ORACLE, "0:ability:invest", "it can be used in response on the opponent's turn", () => {
  const { engine, id } = oracleBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  activateRaw(engine, P1, id("mo"), "invest", { pick: [id("c")] });
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("c")), 2);
});

clause(ORACLE, "0:ability:invest", "only its controller can use it", () => {
  const { engine, id } = oracleBoard({ turn: 2, active: P2 });
  refused(() => activateRaw(engine, P2, id("mo"), "invest", { pick: [id("foe")] }));
  assert.equal(tokensOn(engine, id("foe")), 3);
});

clause(ORACLE, "0:ability:invest", "costs 2 with [G]; has 1 strength / 3 speed / 2 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mo", def: printing(ORACLE), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("mo"))), 2);
  assert.deepEqual(stats(exact.engine, exact.id("mo")), [1, 2, 3]);
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mo", def: printing(ORACLE), owner: P1, zone: "hand" }, ...bank("greed", 1, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("mo")), "one resource short");
  const noG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mo", def: printing(ORACLE), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)]
  });
  refused(() => playRaw(noG.engine, P1, noG.id("mo")), "no [G]");
});

// --- Mau Party ---------------------------------------------------------------------
// COST: Play this only during your turn. EFFECT: Draw 5 cards. Your faction gains 2 influence.
// Tactic (banker), cost 5, threshold [G][G][G][G].

const MAU_PARTY = "2a3fa1ac-c90a-439b-b7fa-1343702dc16f";

function partyBoard(opts: { deck?: number; greed?: number; rage?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "mp", def: printing(MAU_PARTY), owner: P1, zone: "hand" },
      ...fillers("mineh", 1, P1, "hand"),
      ...fillers("d", opts.deck ?? 8, P1, "deck"),
      ...fillers("od", 8, P2, "deck"),
      ...fillers("oh", 2, P2, "hand"),
      ...bank("greed", opts.greed ?? 5, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(MAU_PARTY, "0:ability", "draws exactly 5 cards (the top five of my deck) and my faction gains exactly 2 influence", () => {
  const { engine, id } = partyBoard();
  const top5 = deckOf(engine, P1).slice(0, 5);
  const handBefore = handOf(engine, P1).length;
  const spent = spentBy(engine, P1, () => play(engine, P1, id("mp")));
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 5, "the tactic left my hand, five cards came in");
  for (const card of top5) assert.equal(zoneOf(engine, card), "hand", "the top five were drawn");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.equal(influence(engine, P1), 32, "30 + 2");
  assert.equal(spent, 5, "the numeric cost of 5 is paid");
  assert.equal(zoneOf(engine, id("mp")), "discard");
});

clause(MAU_PARTY, "0:ability", "the opponent is not affected: no draw, no influence change", () => {
  const { engine, id } = partyBoard();
  play(engine, P1, id("mp"));
  assert.equal(handOf(engine, P2).length, 2);
  assert.equal(deckOf(engine, P2).length, 8);
  assert.equal(influence(engine, P2), 30);
});

clause(MAU_PARTY, "0:ability", "with fewer than 5 cards in my deck I draw what there is (CR 306.2), and the influence is still gained", () => {
  const { engine, id } = partyBoard({ deck: 3 });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("mp"));
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 3);
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(influence(engine, P1), 32);
});

clause(MAU_PARTY, "0:ability", "with an empty deck the influence is still gained and nothing breaks", () => {
  const { engine, id } = partyBoard({ deck: 0 });
  play(engine, P1, id("mp"));
  assert.equal(influence(engine, P1), 32);
  assert.equal(pending(engine), undefined);
});

clause(MAU_PARTY, "0:ability", "the cards and the influence come when it resolves, after the opponent had the chance to respond", () => {
  const { engine, id } = partyBoard();
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("mp"));
  assert.equal(handOf(engine, P1).length, handBefore - 1, "nothing drawn yet");
  assert.equal(influence(engine, P1), 30);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 5);
  assert.equal(influence(engine, P1), 32);
});

clause(MAU_PARTY, "0:ability", "'Play this only during your turn': on the opponent's turn, in response to their card, it is refused and nothing is spent", () => {
  const { engine, id } = partyBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I would be allowed to respond with another tactic");
  refused(() => playRaw(engine, P1, id("mp")), "but not with this one: 'Play this only during your turn'", /cannot be deployed right now/);
  assert.equal(zoneOf(engine, id("mp")), "hand");
  assert.equal(ready(engine), 5, "nothing was spent");
  assert.equal(influence(engine, P1), 30);
});

clause(MAU_PARTY, "0:ability", "on my own turn it can be played in response to the opponent's response", () => {
  const { engine, id } = partyBoard({
    turn: 1,
    active: P1,
    greed: 6,
    extra: [
      { key: "mine", def: character({ name: "Mine", cost: 1 }), owner: P1, zone: "hand" },
      { key: "resp", def: costlyTactic(0, "Response"), owner: P2, zone: "hand" }
    ]
  });
  playRaw(engine, P1, id("mine"));
  playRaw(engine, P2, id("resp"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may answer their response");
  playRaw(engine, P1, id("mp"));
  resolvePendingResponses(engine);
  assert.equal(influence(engine, P1), 32, "it resolved during my own turn");
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(MAU_PARTY, "0:ability", "it can be played on my own turn with nothing to respond to (a tactic is played on your turn)", () => {
  const { engine, id } = partyBoard({ turn: 1, active: P1 });
  play(engine, P1, id("mp"));
  assert.equal(influence(engine, P1), 32);
});

clause(MAU_PARTY, "0:ability", "'your faction' and 'draw' are the controller's: the opponent playing their own Mau Party on their turn draws for and credits THEM", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mp", def: printing(MAU_PARTY), owner: P2, zone: "hand" },
      ...fillers("od", 6, P2, "deck"),
      ...fillers("d", 6, P1, "deck"),
      ...bank("greed", 5, P2)
    ]
  });
  play(engine, P2, id("mp"));
  assert.equal(handOf(engine, P2).length, 5);
  assert.equal(influence(engine, P2), 32);
  assert.equal(influence(engine, P1), 30);
  assert.equal(deckOf(engine, P1).length, 6);
});

clause(MAU_PARTY, "0:ability", "costs 5 with [G][G][G][G]: one resource short, or only three [G], is refused", () => {
  const short = partyBoard({ greed: 4 });
  refused(() => playRaw(short.engine, P1, short.id("mp")));
  assert.equal(zoneOf(short.engine, short.id("mp")), "hand");
  assert.equal(ready(short.engine), 4, "nothing spent");
  const threeG = partyBoard({ greed: 3, rage: 3 });
  refused(() => playRaw(threeG.engine, P1, threeG.id("mp")), "only three [G]");
  const fourG = partyBoard({ greed: 4, rage: 1 });
  play(fourG.engine, P1, fourG.id("mp"));
  assert.equal(influence(fourG.engine, P1), 32, "four [G] and one other resource pay for it");
});

// --- Moneychanger ------------------------------------------------------------------
// This card loses 1 strength and 1 life for each token on it.
// EXCHANGE. COST: Put a token on this card. Deplete this card. EFFECT: Draw a card.
// Character (banker; investor), cost 3, threshold [G][G], 2 strength / 3 speed / 2 life.

const MONEYCHANGER = "6bf1518b-c908-4a50-86d8-371d138e13d5";

function changerBoard(tokens: number, opts: { depleted?: boolean; deck?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "play", counters: tokens ? { token: tokens } : {}, depleted: opts.depleted },
      { key: "other", def: character({ name: "Other", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play", counters: { token: 3 } },
      ...fillers("d", opts.deck ?? 4, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

for (const [tokens, strength, life] of [
  [0, 2, 2],
  [1, 1, 1]
] as const) {
  clause(MONEYCHANGER, "0:rule", `with ${tokens} token(s) it has ${strength} strength and ${life} life (speed unchanged at 3)`, () => {
    const { engine, id } = changerBoard(tokens);
    assert.deepEqual(stats(engine, id("mc")), [strength, life, 3]);
    assert.equal(zoneOf(engine, id("mc")), "play");
  });
}

clause(MONEYCHANGER, "0:rule", "with 2 tokens its life is 0 and it is destroyed (FAQ: a character with 0 life is destroyed)", () => {
  const { engine, id } = changerBoard(2);
  assert.equal(engine.getStat(id("mc"), "life"), 0);
  settleState(engine);
  assert.equal(zoneOf(engine, id("mc")), "discard");
});

clause(MONEYCHANGER, "0:rule", "only its own tokens count: another card's tokens do not weaken it", () => {
  const { engine, id } = changerBoard(1);
  assert.deepEqual(stats(engine, id("mc")), [1, 1, 3]);
  assert.deepEqual(stats(engine, id("other")), [2, 5, 2], "the other character (3 tokens of its own) is unaffected");
});

clause(MONEYCHANGER, "0:rule", "the lost life is real: with 1 token (1 life) 1 damage destroys it, while with no token 1 damage does not", () => {
  const with1 = changerBoard(1, { extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(with1.engine, P1, with1.id("zap"), { selected: { t: [with1.id("mc")] } });
  assert.equal(zoneOf(with1.engine, with1.id("mc")), "discard");
  const with0 = changerBoard(0, { extra: [{ key: "zap", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(with0.engine, P1, with0.id("zap"), { selected: { t: [with0.id("mc")] } });
  assert.equal(zoneOf(with0.engine, with0.id("mc")), "play");
});

clause(MONEYCHANGER, "0:rule", "the lost strength is real: with 1 token a Moneychanger blocking deals 1 battle damage", () => {
  const { engine, id } = changerBoard(1, {
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 5, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("mc")]);
  assert.equal(damageOf(engine, id("atk")), 1, "2 strength - 1 token");
});

clause(MONEYCHANGER, "1:ability:exchange", "puts a token on the Moneychanger, depletes it, and draws exactly one card (the top of my deck)", () => {
  const { engine, id } = changerBoard(0);
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("mc")), 1, "one token");
  assert.equal(isDepleted(engine, id("mc")), true, "depleted");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "one card drawn");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.equal(deckOf(engine, P2).length, 3, "the opponent draws nothing");
});

clause(MONEYCHANGER, "1:ability:exchange", "the Moneychanger shrinks with the token it just took (2/2 -> 1/1)", () => {
  const { engine, id } = changerBoard(0);
  activate(engine, P1, id("mc"), "exchange");
  assert.deepEqual(stats(engine, id("mc")), [1, 1, 3]);
});

clause(MONEYCHANGER, "1:ability:exchange", "'Deplete this card' is a cost: depleted as soon as the ability is used, with the draw waiting for resolution", () => {
  const { engine, id } = changerBoard(0);
  const handBefore = handOf(engine, P1).length;
  activateRaw(engine, P1, id("mc"), "exchange");
  assert.equal(isDepleted(engine, id("mc")), true, "depleted while the ability waits for responses");
  assert.equal(handOf(engine, P1).length, handBefore, "nothing drawn yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, handBefore + 1);
});

clause(MONEYCHANGER, "1:ability:exchange", "'Put a token on this card' is a COST: the token is on the card as soon as the ability is used, before the opponent can respond", () => {
  const { engine, id } = changerBoard(0);
  activateRaw(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("mc")), 1, "the token was put on as part of paying");
  assert.equal(handOf(engine, P1).length, 0, "while the card is still to be drawn");
});

clause(MONEYCHANGER, "1:ability:exchange", "it costs no resources", () => {
  const { engine, id } = changerBoard(0, { extra: bank("greed", 2, P1) });
  assert.equal(spentBy(engine, P1, () => activate(engine, P1, id("mc"), "exchange")), 0);
});

clause(MONEYCHANGER, "1:ability:exchange", "a depleted Moneychanger cannot use it", () => {
  const { engine, id } = changerBoard(0, { depleted: true });
  refused(() => activateRaw(engine, P1, id("mc"), "exchange"));
  assert.equal(tokensOn(engine, id("mc")), 0);
  assert.equal(handOf(engine, P1).length, 0);
});

clause(MONEYCHANGER, "1:ability:exchange", "it can be used once per restore: after its controller's restore it works again", () => {
  const { engine, id } = changerBoard(0, { turn: 1, active: P1 });
  activate(engine, P1, id("mc"), "exchange");
  refused(() => activateRaw(engine, P1, id("mc"), "exchange"), "depleted: not twice in a turn");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(isDepleted(engine, id("mc")), false, "restored");
});

clause(MONEYCHANGER, "1:ability:exchange", "a Moneychanger with 1 token takes a second one: it ends at 0 life and is destroyed, but the ability still draws the card", () => {
  const { engine, id } = changerBoard(1);
  const top = deckOf(engine, P1)[0];
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(zoneOf(engine, top), "hand", "the card is still drawn: an ability resolves even if its source has left play (CR 502.4)");
  assert.equal(zoneOf(engine, id("mc")), "discard", "2 tokens: 0 life");
});

clause(MONEYCHANGER, "1:ability:exchange", "with an empty deck the token and the deplete still happen and nothing breaks", () => {
  const { engine, id } = changerBoard(0, { deck: 0 });
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("mc")), 1);
  assert.equal(isDepleted(engine, id("mc")), true);
  assert.equal(pending(engine), undefined);
});

clause(MONEYCHANGER, "1:ability:exchange", "the token goes on the Moneychanger only: other cards' tokens are untouched", () => {
  const { engine, id } = changerBoard(0);
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("other")), 3);
});

clause(MONEYCHANGER, "1:ability:exchange", "it can be used the turn it enters play (CR 204.3a)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "hand" }, ...fillers("d", 2, P1, "deck"), ...bank("greed", 3, P1)]
  });
  play(engine, P1, id("mc"));
  activate(engine, P1, id("mc"), "exchange");
  assert.equal(tokensOn(engine, id("mc")), 1);
  assert.equal(handOf(engine, P1).length, 1);
});

clause(MONEYCHANGER, "1:ability:exchange", "it can be used in response on the opponent's turn", () => {
  const { engine, id } = changerBoard(0, {
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  activateRaw(engine, P1, id("mc"), "exchange");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, 1);
});

clause(MONEYCHANGER, "1:ability:exchange", "only its controller can use it", () => {
  const { engine, id } = changerBoard(0, { turn: 2, active: P2 });
  refused(() => activateRaw(engine, P2, id("mc"), "exchange"));
  assert.equal(tokensOn(engine, id("mc")), 0);
});

clause(MONEYCHANGER, "1:ability:exchange", "tokens disappear when it leaves play (CR 409.2): returned to hand and deployed again it has none", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "bounce", def: bounce(), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("mc")] } });
  assert.equal(zoneOf(engine, id("mc")), "hand");
  play(engine, P1, id("mc"));
  assert.equal(zoneOf(engine, id("mc")), "play");
  assert.equal(tokensOn(engine, id("mc")), 0, "a fresh card has no tokens");
});

clause(MONEYCHANGER, "1:ability:exchange", "costs 3 with [G][G]; has 2 strength / 3 speed / 2 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("mc"))), 3);
  assert.deepEqual(stats(exact.engine, exact.id("mc")), [2, 2, 3], "no tokens on entering play");
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("mc")), "one resource short");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mc", def: printing(MONEYCHANGER), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("mc")), "only one [G]");
});

// --- Motivational Speaker ----------------------------------------------------------
// If this card blocks, all members of the blocking party gain 2 strength and 2 life this turn.
// (This includes this character.)
// Character (banker; salesman), cost 4, threshold [G][G], 0 strength / 3 speed / 3 life.

const SPEAKER = "a2816b7a-7843-44e8-b9ef-0327e17ce16d";

/** P2 attacks (turn 2). P1 has the Speaker (`ms`), two allies (`a1`: 1/1, `a2`: 1/4) and P2's attacker is `atk`. */
function speakerDefends(opts: { atk?: Partial<CardDefinition>; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ms", def: printing(SPEAKER), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 9, speed: 3, ...opts.atk }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

function speakerBlocks(game: ReturnType<typeof speakerDefends>, blockers: string[], attackers = ["atk"]): void {
  declareAttackBy(game.engine, P2, attackers.map(game.id), factionOfP1);
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: blockers.map(game.id) });
}

clause(SPEAKER, "0:rule", "blocking alone: the Speaker itself gains 2 strength and 2 life (0/3 becomes 2/5)", () => {
  const game = speakerDefends();
  assert.deepEqual(stats(game.engine, game.id("ms")), [0, 3, 3]);
  speakerBlocks(game, ["ms"]);
  assert.deepEqual(stats(game.engine, game.id("ms")), [2, 5, 3], "this includes the Speaker (speed is unchanged)");
});

clause(SPEAKER, "0:rule", "every member of the blocking party gains +2/+2, not just the Speaker", () => {
  const game = speakerDefends();
  speakerBlocks(game, ["ms", "a1"]);
  assert.deepEqual(stats(game.engine, game.id("ms")), [2, 5, 3]);
  assert.deepEqual(stats(game.engine, game.id("a1")), [3, 3, 1], "1/1 becomes 3/3");
});

clause(SPEAKER, "0:rule", "a character that is not in the blocking party gains nothing", () => {
  const game = speakerDefends();
  speakerBlocks(game, ["ms", "a1"]);
  assert.deepEqual(stats(game.engine, game.id("a2")), [1, 4, 1], "a2 did not block");
});

clause(SPEAKER, "0:rule", "the attacking party gains nothing", () => {
  const game = speakerDefends();
  speakerBlocks(game, ["ms"], ["atk", "atk2"]);
  assert.deepEqual(stats(game.engine, game.id("atk")), [2, 9, 3]);
  assert.deepEqual(stats(game.engine, game.id("atk2")), [1, 9, 1]);
});

clause(SPEAKER, "0:rule", "the extra life is real in the battle: a 1-life ally survives 2 damage (3 life) and dies to 3", () => {
  const survive = speakerDefends();
  speakerBlocks(survive, ["ms", "a1"]);
  autoResolveBattle(survive.engine, (source) => (controllerOf(survive.engine, source.cardId) === P2 ? [{ sourceId: source.cardId, target: asTarget(survive.id("a1")), amount: source.strength }] : source.legalTargets.length ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : []));
  assert.equal(zoneOf(survive.engine, survive.id("a1")), "play", "2 damage < 3 life");
  assert.equal(damageOf(survive.engine, survive.id("a1")), 2);

  const die = speakerDefends({ atk: { strength: 3 } });
  speakerBlocks(die, ["ms", "a1"]);
  autoResolveBattle(die.engine, (source) => (controllerOf(die.engine, source.cardId) === P2 ? [{ sourceId: source.cardId, target: asTarget(die.id("a1")), amount: source.strength }] : source.legalTargets.length ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : []));
  assert.equal(zoneOf(die.engine, die.id("a1")), "discard", "3 damage >= 3 life");
});

clause(SPEAKER, "0:rule", "the extra strength is real: the Speaker deals 2 battle damage after blocking", () => {
  const game = speakerDefends();
  speakerBlocks(game, ["ms"]);
  autoResolveBattle(game.engine);
  assert.equal(damageOf(game.engine, game.id("atk")), 2, "0 + 2 strength");
  assert.equal(damageOf(game.engine, game.id("ms")), 2, "and it survives the attacker's 2 on 5 life");
});

clause(SPEAKER, "0:rule", "the bonus is in place before any battle damage is dealt (the first response window of the battle)", () => {
  const game = speakerDefends();
  speakerBlocks(game, ["ms", "a1"]);
  assert.equal(damageOf(game.engine, game.id("a1")), 0, "no damage yet");
  assert.equal(game.engine.getStat(game.id("a1"), "life"), 3);
});

clause(SPEAKER, "0:rule", "'this turn': the bonus is gone once the turn ends", () => {
  const game = speakerDefends();
  speakerBlocks(game, ["ms", "a1"]);
  autoResolveBattle(game.engine);
  assert.deepEqual(stats(game.engine, game.id("ms")), [2, 5, 3], "still active for the rest of the turn");
  endTurn(game.engine, P2);
  assert.deepEqual(stats(game.engine, game.id("ms")), [0, 3, 3], "gone");
  assert.deepEqual(stats(game.engine, game.id("a1")), [1, 1, 1], "gone");
});

clause(SPEAKER, "0:rule", "it only happens if the Speaker BLOCKS: a block by another character alone gives no bonus", () => {
  const game = speakerDefends();
  speakerBlocks(game, ["a1"]);
  assert.deepEqual(stats(game.engine, game.id("a1")), [1, 1, 1]);
  assert.deepEqual(stats(game.engine, game.id("ms")), [0, 3, 3]);
});

clause(SPEAKER, "0:rule", "a Speaker that does not block (it stays out of the party) gives the blockers no bonus", () => {
  const game = speakerDefends();
  speakerBlocks(game, ["a1", "a2"]);
  assert.deepEqual(stats(game.engine, game.id("a1")), [1, 1, 1]);
  assert.deepEqual(stats(game.engine, game.id("a2")), [1, 4, 1]);
});

clause(SPEAKER, "0:rule", "attacking is not blocking: a Speaker in an attacking party gives nobody a bonus", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "ms", def: printing(SPEAKER), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(game.engine, P1, [game.id("ms"), game.id("a1")], factionOfP2);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("blk")] });
  assert.deepEqual(stats(game.engine, game.id("ms")), [0, 3, 3]);
  assert.deepEqual(stats(game.engine, game.id("a1")), [1, 1, 1]);
});

clause(SPEAKER, "0:rule", "the opponent's Speaker blocking MY attack buffs THEIR blocking party only", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "ms", def: printing(SPEAKER), owner: P2, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(game.engine, P1, [game.id("atk")], factionOfP2);
  game.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [game.id("ms"), game.id("b1")] });
  assert.deepEqual(stats(game.engine, game.id("ms")), [2, 5, 3]);
  assert.deepEqual(stats(game.engine, game.id("b1")), [3, 3, 1]);
  assert.deepEqual(stats(game.engine, game.id("atk")), [2, 5, 3], "my attacker gains nothing");
});

clause(SPEAKER, "0:rule", "an attack on a location of mine is blocked the same way", () => {
  const game = speakerDefends({ extra: [{ key: "loc", def: location({ name: "MyLoc", structure: 9 }), owner: P1, zone: "play" }] });
  declareAttackBy(game.engine, P2, [game.id("atk")], { type: "card", cardId: game.id("loc") });
  game.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [game.id("ms"), game.id("a1")] });
  assert.deepEqual(stats(game.engine, game.id("ms")), [2, 5, 3]);
  assert.deepEqual(stats(game.engine, game.id("a1")), [3, 3, 1]);
});

clause(SPEAKER, "0:rule", "two Speakers in one blocking party both trigger: every member gains +4/+4", () => {
  const game = speakerDefends({ extra: [{ key: "ms2", def: printing(SPEAKER), owner: P1, zone: "play" }] });
  speakerBlocks(game, ["ms", "ms2", "a1"]);
  assert.deepEqual(stats(game.engine, game.id("ms")), [4, 7, 3]);
  assert.deepEqual(stats(game.engine, game.id("ms2")), [4, 7, 3]);
  assert.deepEqual(stats(game.engine, game.id("a1")), [5, 5, 1]);
});

clause(SPEAKER, "0:rule", "costs 4 with [G][G]; has 0 strength / 3 speed / 3 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ms", def: printing(SPEAKER), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("ms"))), 4);
  assert.deepEqual(stats(exact.engine, exact.id("ms")), [0, 3, 3]);
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ms", def: printing(SPEAKER), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("ms")), "one resource short");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ms", def: printing(SPEAKER), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("ms")), "only one [G]");
});

// --- Mutiny Grant ------------------------------------------------------------------
// COST: Pick a character your opponent controls. Your faction loses X influence, where X is the
// numeric cost of that character.
// EFFECT: This turn, you control the character. Restore the character.
// Tactic (banker), cost 2, threshold [G][G].

const MUTINY = "1dc62434-5a69-44ce-acde-488436a14de8";

function mutinyBoard(opts: { greed?: number; influence?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "mg", def: printing(MUTINY), owner: P1, zone: "hand" },
      { key: "c0", def: character({ name: "C0", cost: 0, strength: 1, life: 3 }), owner: P2, zone: "play" },
      { key: "c1", def: character({ name: "C1", cost: 1 }), owner: P2, zone: "play" },
      { key: "c3", def: character({ name: "C3", cost: 3, strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play", attackEligible: false },
      { key: "c5", def: character({ name: "C5", cost: 5 }), owner: P2, zone: "play" },
      { key: "dep", def: character({ name: "Dep", cost: 2 }), owner: P2, zone: "play", depleted: true },
      { key: "mine", def: character({ name: "Mine", cost: 4 }), owner: P1, zone: "play" },
      { key: "itm", def: item({ name: "Itm", cost: 2 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Loc", cost: 2 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand", cost: 2 }), owner: P2, zone: "hand" },
      ...bank("greed", opts.greed ?? 2, P1),
      ...(opts.extra ?? [])
    ]
  });
}

for (const [key, x] of [
  ["c0", 0],
  ["c1", 1],
  ["c3", 3],
  ["c5", 5]
] as const) {
  clause(MUTINY, "0:ability", `picking a character of numeric cost ${x}: my faction loses exactly ${x} influence (30 -> ${30 - x}) and I control the character`, () => {
    const { engine, id } = mutinyBoard();
    const spent = spentBy(engine, P1, () => play(engine, P1, id("mg"), { selected: { pick: [id(key)] } }));
    assert.equal(influence(engine, P1), 30 - x, `X = ${x}`);
    assert.equal(influence(engine, P2), 30, "the opponent's influence is unchanged");
    assert.equal(controllerOf(engine, id(key)), P1, "I control the character this turn");
    assert.ok(engine.state.players[P1].play.includes(id(key)), "it is among my cards in play");
    assert.equal(engine.state.cards[id(key)].ownerId, P2, "ownership never changes");
    assert.equal(spent, 2, "the numeric cost of 2 is paid with resources; the influence loss is separate");
    assert.equal(zoneOf(engine, id("mg")), "discard");
  });
}

clause(MUTINY, "0:ability", "'Restore the character': a depleted character is restored (undepleted)", () => {
  const { engine, id } = mutinyBoard();
  assert.equal(isDepleted(engine, id("dep")), true);
  play(engine, P1, id("mg"), { selected: { pick: [id("dep")] } });
  assert.equal(isDepleted(engine, id("dep")), false);
  assert.equal(controllerOf(engine, id("dep")), P1);
  assert.equal(influence(engine, P1), 28, "X = its numeric cost 2");
});

clause(MUTINY, "0:ability", "the character is restored only if it was depleted: a ready one stays ready, other characters are untouched", () => {
  const { engine, id } = mutinyBoard();
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(isDepleted(engine, id("c3")), false);
  assert.equal(isDepleted(engine, id("dep")), true, "the other depleted character is not restored");
  assert.equal(controllerOf(engine, id("dep")), P2);
  assert.equal(controllerOf(engine, id("c1")), P2);
});

clause(MUTINY, "0:ability", "the influence loss is a COST: it is lost when the tactic is played, before the opponent can respond; the control change waits", () => {
  const { engine, id } = mutinyBoard();
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(influence(engine, P1), 27, "already lost");
  assert.equal(controllerOf(engine, id("c3")), P2, "not controlled yet");
  assert.equal(isDepleted(engine, id("c3")), false);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("c3")), P1);
});

clause(MUTINY, "0:ability", "'This turn': control goes back to the opponent when the turn ends", () => {
  const { engine, id } = mutinyBoard({ turn: 1, active: P1 });
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(controllerOf(engine, id("c3")), P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(controllerOf(engine, id("c3")), P2, "the opponent controls their character again");
  assert.ok(engine.state.players[P2].play.includes(id("c3")), "engine.state.players[P2].play.includes(id(\"c3\"))");
  assert.equal(engine.state.players[P1].play.includes(id("c3")), false);
  assert.equal(influence(engine, P1), 27, "but the influence stays lost");
});

clause(MUTINY, "0:ability", "while I control it this turn I can use it: it can block for me on... and it is MY card for effects (my tactic can target it as 'a character you control')", () => {
  const { engine, id } = mutinyBoard({
    turn: 1,
    active: P1,
    extra: [{ key: "stolenSelector", def: tactic({ name: "MyChars", cost: 0, behavior: { abilities: [{ id: "mc", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "self" }, count: 1 }], effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: 5, duration: { type: "untilEndOfTurn" } }] }] } }), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  play(engine, P1, id("stolenSelector"), { selected: { t: [id("c3")] } });
  assert.equal(engine.getStat(id("c3"), "strength"), 7, "it is a character I control");
});

clause(MUTINY, "0:ability", "a stolen character was not under my control since the start of the turn, so it cannot attack this turn (CR 608.1b)", () => {
  const { engine, id } = mutinyBoard({ turn: 1, active: P1 });
  play(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  assert.equal(isDepleted(engine, id("c3")), false);
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("c3")], target: factionOfP2 }), "I have not controlled it since the start of the turn");
  declareAttackBy(engine, P1, [id("mine")], factionOfP2);
  assert.ok(battleOf(engine), "control: my own character can attack");
});

clause(MUTINY, "0:ability", "only a character the opponent CONTROLS can be picked: my own character is refused", () => {
  const { engine, id } = mutinyBoard();
  refused(() => playRaw(engine, P1, id("mg"), { selected: { pick: [id("mine")] } }), "my own character");
  assert.equal(influence(engine, P1), 30);
  assert.equal(zoneOf(engine, id("mg")), "hand");
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("c1")] } });
  assert.ok(engine.state.responseWindow, "control: an opponent's character is accepted");
});

clause(MUTINY, "0:ability", "'your opponent controls' is about control: a character the opponent owns but I control is refused; one I own but they control is accepted", () => {
  const { engine, id } = mutinyBoard({
    extra: [
      { key: "borrowed", def: character({ name: "Borrowed", cost: 2 }), owner: P2, zone: "play", controller: P1 },
      { key: "lent", def: character({ name: "Lent", cost: 2 }), owner: P1, zone: "play", controller: P2 }
    ]
  });
  refused(() => playRaw(engine, P1, id("mg"), { selected: { pick: [id("borrowed")] } }), "a character I already control");
  assert.equal(zoneOf(engine, id("mg")), "hand");
  play(engine, P1, id("mg"), { selected: { pick: [id("lent")] } });
  assert.equal(controllerOf(engine, id("lent")), P1);
  assert.equal(influence(engine, P1), 28);
});

clause(MUTINY, "0:ability", "only a character can be picked: an item, a location, a resource, a face-down card, a faction and a card outside play are refused", () => {
  const { engine, id } = mutinyBoard({ extra: [{ key: "hidden", def: character({ name: "Hidden", cost: 2 }), owner: P2, zone: "play", faceDown: true }] });
  const oppResource = engine.state.players[P2].play.find((card) => engine.getDefinition(card).type === "resource");
  const attempt = (cardId: CardInstanceId) => () => playRaw(engine, P1, id("mg"), { selected: { pick: [cardId] } });
  refused(attempt(id("itm")), "an opponent's item");
  refused(attempt(id("loc")), "an opponent's location");
  refused(attempt(id("hidden")), "an opponent's face-down card");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(attempt(id("inHand")), "a character in their hand");
  if (oppResource) refused(attempt(oppResource), "a resource");
  assert.equal(influence(engine, P1), 30, "nothing was lost");
  assert.equal(zoneOf(engine, id("mg")), "hand");
  attempt(id("c1"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(MUTINY, "0:ability", "exactly one character is picked: none, or two, is refused", () => {
  const { engine, id } = mutinyBoard();
  refused(() => playRaw(engine, P1, id("mg")), "no pick");
  refused(() => playRaw(engine, P1, id("mg"), { selected: { pick: [id("c1"), id("c3")] } }), "two picks");
  assert.equal(influence(engine, P1), 30);
});

clause(MUTINY, "0:ability", "'loses X influence' is a cost that needs the influence: with 2 influence left a 3-cost character cannot be picked", () => {
  const { engine, id } = mutinyBoard({ influence: 2 });
  refused(() => playRaw(engine, P1, id("mg"), { selected: { pick: [id("c3")] } }), "not enough influence to lose 3 (CR 401.3b)");
  assert.equal(influence(engine, P1), 2);
  assert.equal(zoneOf(engine, id("mg")), "hand");
  assert.equal(ready(engine), 2, "nothing was spent");
  play(engine, P1, id("mg"), { selected: { pick: [id("c1")] } });
  assert.equal(influence(engine, P1), 1, "control: a 1-cost character costs 1 influence");
});

clause(MUTINY, "0:ability", "the influence is lost directly, not paid: it does not use up resources, and it is lost in addition to the 2 resources", () => {
  const { engine, id } = mutinyBoard({ greed: 2 });
  play(engine, P1, id("mg"), { selected: { pick: [id("c5")] } });
  assert.equal(ready(engine), 0, "exactly the 2 resources of the numeric cost are gone");
  assert.equal(influence(engine, P1), 25);
});

clause(MUTINY, "0:ability", "if the picked character left play in response, the control change does nothing but the influence is still lost", () => {
  const { engine, id } = mutinyBoard({
    extra: [{ key: "bounce", def: bounce(), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  playRaw(engine, P2, id("bounce"), { selected: { t: [id("c3")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c3")), "hand", "it went back to its owner's hand");
  assert.equal(influence(engine, P1), 27, "the cost was paid");
  assert.equal(engine.state.players[P1].play.includes(id("c3")), false);
});

clause(MUTINY, "0:ability", "it can be played in response on the opponent's turn: I control the character until that turn ends", () => {
  const { engine, id } = mutinyBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  playRaw(engine, P1, id("mg"), { selected: { pick: [id("c3")] } });
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("c3")), P1);
  assert.equal(influence(engine, P1), 27);
  endTurn(engine, P2);
  assert.equal(controllerOf(engine, id("c3")), P2, "back with its controller when the turn ends");
});

clause(MUTINY, "0:ability", "costs 2 with [G][G]: one resource short, or only one [G], is refused", () => {
  // [G][G] met by already-spent Greed, but only one ready resource for the cost of 2
  const short = mutinyBoard({ greed: 0, extra: [...bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 1, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("mg"), { selected: { pick: [short.id("c1")] } }), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(influence(short.engine, P1), 30);
  const oneG = mutinyBoard({ greed: 1, extra: bank("rage", 3, P1) });
  refused(() => playRaw(oneG.engine, P1, oneG.id("mg"), { selected: { pick: [oneG.id("c1")] } }), "only one [G]", /Threshold requirements are not met/);
  const mixed = mutinyBoard({ greed: 2, extra: bank("rage", 1, P1) });
  play(mixed.engine, P1, mixed.id("mg"), { selected: { pick: [mixed.id("c1")] } });
  assert.equal(controllerOf(mixed.engine, mixed.id("c1")), P1);
});

// --- Officious Obstructionist ------------------------------------------------------
// STUBBORNNESS. COST: Pay 1. EFFECT: This turn, this card gains 1 life.
// Character (banker; bureaucrat), cost 4, threshold [G], 2 strength / 3 speed / 2 life.

const OBSTRUCTIONIST = "e8b58fc9-9ab5-4476-8a49-f35db8424e8a";

function obstructionistBoard(opts: { greed?: number; rage?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "oo", def: printing(OBSTRUCTIONIST), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(OBSTRUCTIONIST, "0:ability:stubborn", "pays 1 and gives the Obstructionist 1 life this turn (2 -> 3), leaving strength and speed alone", () => {
  const { engine, id } = obstructionistBoard();
  assert.deepEqual(stats(engine, id("oo")), [2, 2, 3]);
  const spent = spentBy(engine, P1, () => activate(engine, P1, id("oo"), "stubborn"));
  assert.equal(spent, 1, "exactly 1 paid");
  assert.deepEqual(stats(engine, id("oo")), [2, 3, 3]);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "it can be used again and again: each use is another +1 life and another resource (3 uses: 5 life)", () => {
  const { engine, id } = obstructionistBoard();
  const spent = spentBy(engine, P1, () => {
    for (let n = 1; n <= 3; n++) {
      activate(engine, P1, id("oo"), "stubborn");
      assert.equal(engine.getStat(id("oo"), "life"), 2 + n);
    }
  });
  assert.equal(spent, 3);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "only THIS card gains the life: other characters of mine and the opponent's do not", () => {
  const { engine, id } = obstructionistBoard();
  activate(engine, P1, id("oo"), "stubborn");
  assert.equal(engine.getStat(id("ally"), "life"), 3);
  assert.equal(engine.getStat(id("foe"), "life"), 3);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "the 1 is paid when the ability is used; the life comes when it resolves", () => {
  const { engine, id } = obstructionistBoard();
  const spent = spentBy(engine, P1, () => activateRaw(engine, P1, id("oo"), "stubborn"));
  assert.equal(spent, 1);
  assert.equal(engine.getStat(id("oo"), "life"), 2, "not yet");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("oo"), "life"), 3);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "the life is real: with one use it survives 2 damage and is destroyed by 3; without it 2 damage destroys it", () => {
  const without = obstructionistBoard({ extra: [{ key: "zap", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("zap"), { selected: { t: [without.id("oo")] } });
  assert.equal(zoneOf(without.engine, without.id("oo")), "discard", "2 damage >= 2 life");

  const with1 = obstructionistBoard({ extra: [{ key: "zap", def: damageTactic(2), owner: P1, zone: "hand" }] });
  activate(with1.engine, P1, with1.id("oo"), "stubborn");
  play(with1.engine, P1, with1.id("zap"), { selected: { t: [with1.id("oo")] } });
  assert.equal(zoneOf(with1.engine, with1.id("oo")), "play", "2 damage < 3 life");

  const three = obstructionistBoard({ extra: [{ key: "zap", def: damageTactic(3), owner: P1, zone: "hand" }] });
  activate(three.engine, P1, three.id("oo"), "stubborn");
  play(three.engine, P1, three.id("zap"), { selected: { t: [three.id("oo")] } });
  assert.equal(zoneOf(three.engine, three.id("oo")), "discard", "3 damage >= 3 life");
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "used in response to a damage tactic it saves the Obstructionist (the life is there when the damage is dealt)", () => {
  const { engine, id } = obstructionistBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "zap", def: damageTactic(2), owner: P2, zone: "hand" }]
  });
  playRaw(engine, P2, id("zap"), { selected: { t: [id("oo")] } });
  activateRaw(engine, P1, id("oo"), "stubborn");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oo")), "play", "my response resolved first: 3 life");
  assert.equal(damageOf(engine, id("oo")), 2);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "'This turn': the extra life is gone once the turn ends", () => {
  const { engine, id } = obstructionistBoard({ turn: 1, active: P1 });
  activate(engine, P1, id("oo"), "stubborn");
  activate(engine, P1, id("oo"), "stubborn");
  assert.equal(engine.getStat(id("oo"), "life"), 4);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("oo"), "life"), 2, "back to the printed life");
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("oo"), "life"), 2);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "used on the opponent's turn the bonus lasts until the end of THAT turn", () => {
  const { engine, id } = obstructionistBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "opp", def: character({ name: "Opp", cost: 1 }), owner: P2, zone: "hand" }, ...bank("rage", 1, P2)]
  });
  playRaw(engine, P2, id("opp"));
  activateRaw(engine, P1, id("oo"), "stubborn");
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("oo"), "life"), 3);
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("oo"), "life"), 2, "gone when that turn ended");
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "it has no threshold and no deplete cost: any resource pays, and the card stays ready", () => {
  const { engine, id } = obstructionistBoard({ greed: 0, rage: 1 });
  activate(engine, P1, id("oo"), "stubborn");
  assert.equal(engine.getStat(id("oo"), "life"), 3);
  assert.equal(isDepleted(engine, id("oo")), false);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "without a resource it is refused", () => {
  const { engine, id } = obstructionistBoard({ greed: 0 });
  refused(() => activateRaw(engine, P1, id("oo"), "stubborn"), "nothing to pay with");
  assert.equal(engine.getStat(id("oo"), "life"), 2);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "it can be used the turn the Obstructionist enters play (CR 204.3a)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "oo", def: printing(OBSTRUCTIONIST), owner: P1, zone: "hand" }, ...bank("greed", 5, P1)]
  });
  play(engine, P1, id("oo"));
  activate(engine, P1, id("oo"), "stubborn");
  assert.equal(engine.getStat(id("oo"), "life"), 3);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "only its controller can use it", () => {
  const { engine, id } = obstructionistBoard({ turn: 2, active: P2, extra: bank("rage", 2, P2) });
  refused(() => activateRaw(engine, P2, id("oo"), "stubborn"), "the opponent cannot use my card's ability");
  assert.equal(engine.getStat(id("oo"), "life"), 2);
});

clause(OBSTRUCTIONIST, "0:ability:stubborn", "costs 4 with [G]; has 2 strength / 3 speed / 2 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "oo", def: printing(OBSTRUCTIONIST), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("oo"))), 4);
  assert.deepEqual(stats(exact.engine, exact.id("oo")), [2, 2, 3]);
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "oo", def: printing(OBSTRUCTIONIST), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("oo")), "one resource short");
  const noG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "oo", def: printing(OBSTRUCTIONIST), owner: P1, zone: "hand" }, ...bank("rage", 5, P1)]
  });
  refused(() => playRaw(noG.engine, P1, noG.id("oo")), "no [G]");
});

// --- Overinsured Figurehead --------------------------------------------------------
// If this card leaves play, draw 2 cards.
// Character (banker; executive), cost 6, threshold [G][G], 3 strength / 3 speed / 5 life.

const FIGUREHEAD = "80039582-f99b-4d7f-9f35-96c725c9d4d9";

function figureheadBoard(opts: { deck?: number; owner?: Pid; controller?: Pid; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "of", def: printing(FIGUREHEAD), owner: opts.owner ?? P1, controller: opts.controller, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...fillers("d", opts.deck ?? 5, P1, "deck"),
      ...fillers("od", 5, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(FIGUREHEAD, "0:rule", "destroyed: its controller draws exactly two cards (the top two of their deck)", () => {
  const { engine, id } = figureheadBoard();
  const top2 = deckOf(engine, P1).slice(0, 2);
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("kill"), { selected: { t: [id("of")] } });
  assert.equal(zoneOf(engine, id("of")), "discard");
  for (const card of top2) assert.equal(zoneOf(engine, card), "hand", "the top two cards were drawn");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 2, "the tactic left, two cards drawn");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.equal(deckOf(engine, P2).length, 5, "the opponent draws nothing");
});

clause(FIGUREHEAD, "0:rule", "'leaves play' is any way: returned to hand it draws two cards too", () => {
  const { engine, id } = figureheadBoard({ extra: [{ key: "bounce", def: bounce(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("of")] } });
  assert.equal(zoneOf(engine, id("of")), "hand");
  assert.equal(deckOf(engine, P1).length, 3, "two cards drawn");
});

clause(FIGUREHEAD, "0:rule", "destroyed by battle damage it draws two cards", () => {
  const { engine, id } = figureheadBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 9, speed: 3 }), owner: P2, zone: "play" }]
  });
  fightDefault(engine, P2, [id("atk")], factionOfP1, [id("of")]);
  assert.equal(zoneOf(engine, id("of")), "discard", "5 damage >= 5 life");
  assert.equal(deckOf(engine, P1).length, 3);
});

clause(FIGUREHEAD, "0:rule", "with only 1 card left in the deck it draws that one (CR 306.2)", () => {
  const { engine, id } = figureheadBoard({ deck: 1 });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("kill"), { selected: { t: [id("of")] } });
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.equal(deckOf(engine, P1).length, 0);
});

clause(FIGUREHEAD, "0:rule", "an empty deck: nothing is drawn and nothing breaks", () => {
  const { engine, id } = figureheadBoard({ deck: 0 });
  play(engine, P1, id("kill"), { selected: { t: [id("of")] } });
  assert.equal(zoneOf(engine, id("of")), "discard");
  assert.equal(handOf(engine, P1).length, 0);
  assert.equal(pending(engine), undefined);
});

clause(FIGUREHEAD, "0:rule", "another card of mine leaving play does not draw", () => {
  const { engine, id } = figureheadBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(deckOf(engine, P1).length, 5);
  assert.equal(zoneOf(engine, id("of")), "play");
});

clause(FIGUREHEAD, "0:rule", "'draw' is the controller's: a Figurehead P2 owns but P1 controls draws for P1 when it dies", () => {
  const { engine, id } = figureheadBoard({ owner: P2, controller: P1 });
  play(engine, P1, id("kill"), { selected: { t: [id("of")] } });
  assert.equal(deckOf(engine, P1).length, 3, "its controller drew two");
  assert.equal(deckOf(engine, P2).length, 5, "its owner did not");
});

clause(FIGUREHEAD, "0:rule", "the opponent's Figurehead draws for THEM", () => {
  const { engine, id } = figureheadBoard({ owner: P2 });
  play(engine, P1, id("kill"), { selected: { t: [id("of")] } });
  assert.equal(deckOf(engine, P2).length, 3, "P2 drew two");
  assert.equal(deckOf(engine, P1).length, 5, "I did not");
});

clause(FIGUREHEAD, "0:rule", "a Figurehead discarded from hand never left play: no draw", () => {
  const game = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "of", def: printing(FIGUREHEAD), owner: P1, zone: "hand" },
      { key: "disc", def: discardFromHandTactic(), owner: P1, zone: "hand" },
      ...fillers("d", 4, P1, "deck")
    ]
  });
  play(game.engine, P1, game.id("disc"), { selected: { t: [game.id("of")] } });
  assert.equal(zoneOf(game.engine, game.id("of")), "discard");
  assert.equal(deckOf(game.engine, P1).length, 4);
});

clause(FIGUREHEAD, "0:rule", "a face-down Figurehead is just a resource: it has no trigger", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "of", def: printing(FIGUREHEAD), owner: P1, zone: "play", faceDown: true },
      { key: "killRes", def: tactic({ name: "KillRes", cost: 0, behavior: { abilities: [{ id: "kr", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
      ...fillers("d", 4, P1, "deck")
    ]
  });
  play(engine, P1, id("killRes"), { selected: { t: [id("of")] } });
  assert.equal(zoneOf(engine, id("of")), "discard");
  assert.equal(deckOf(engine, P1).length, 4);
});

clause(FIGUREHEAD, "0:rule", "each Figurehead draws its own two cards: two destroyed in turn draw four", () => {
  const { engine, id } = figureheadBoard({ deck: 6, extra: [{ key: "of2", def: printing(FIGUREHEAD), owner: P1, zone: "play" }, { key: "kill2", def: killTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("of")] } });
  play(engine, P1, id("kill2"), { selected: { t: [id("of2")] } });
  assert.equal(deckOf(engine, P1).length, 2);
});

clause(FIGUREHEAD, "0:rule", "costs 6 with [G][G]; has 3 strength / 3 speed / 5 life", () => {
  const exact = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "of", def: printing(FIGUREHEAD), owner: P1, zone: "hand" }, ...bank("greed", 6, P1)]
  });
  assert.equal(spentBy(exact.engine, P1, () => play(exact.engine, P1, exact.id("of"))), 6);
  assert.deepEqual(stats(exact.engine, exact.id("of")), [3, 5, 3]);
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "of", def: printing(FIGUREHEAD), owner: P1, zone: "hand" }, ...bank("greed", 5, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("of")), "one resource short");
  const oneG = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "of", def: printing(FIGUREHEAD), owner: P1, zone: "hand" }, ...bank("greed", 1, P1), ...bank("rage", 6, P1)]
  });
  refused(() => playRaw(oneG.engine, P1, oneG.id("of")), "only one [G]");
});

// ===== INSERT-NEW-GROUPS-ABOVE-THIS-LINE =====
