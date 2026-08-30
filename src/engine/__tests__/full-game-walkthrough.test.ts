// A single, hand-scripted playthrough of an entire game — mulligan through
// a decided winner — using nothing but explicit engine.perform() calls, the
// same way a human player would narrate a game turn by turn. This is a
// deliberate companion to full-game.test.ts, not a replacement for it:
// full-game.test.ts proves the real precon decks survive a generic,
// legality-probing policy bot end to end; this test instead reads top to
// bottom as a concrete story ("P1 plays a Recruit, P2 blocks, P2 tricks with
// Rally...") against a small synthetic card set, so a reader can follow
// exactly what happens and why at every step without reverse-engineering a
// bot's decision process.
//
// The two hands/decks below come from createTwoPlayerFactionGame with a
// fixed seed (2) — the resulting shuffle is deterministic, so every draw
// referenced here (via handCard(), which looks a card up by name rather
// than by a hardcoded id) is reproducible. Card lookups go by name, not
// position, so the script reads as "play the Recruit in hand" rather than
// depending on exactly where the shuffle happened to put it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoResolveBattle,
  character,
  defaultFactionDefinition,
  factionCard,
  item,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import {
  createTwoPlayerFactionGame,
  type CardDefinition,
  type CardInstanceId,
  type SpoilsEngine
} from "../../engine.js";

const RAGE = resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } });
const RECRUIT = character({ name: "Recruit", cost: 1, strength: 1, life: 2 });

// "Pay 1: this character gets +2 strength until end of turn."
const CHAMPION = character({
  name: "Champion",
  cost: 3,
  strength: 3,
  life: 5,
  behavior: {
    abilities: [
      {
        id: "champion-warcry",
        name: "Warcry",
        type: "activated",
        costs: [{ type: "payResources", amount: 1 }],
        effects: [
          {
            type: "createModifier",
            target: "source",
            stat: "strength",
            operation: "add",
            value: 2,
            duration: { type: "untilEndOfTurn" }
          }
        ]
      }
    ]
  }
});

// "Attach to character. The attached character gets +2 strength."
const WARBLADE = item({
  name: "Warblade",
  cost: 1,
  attachTo: "character",
  behavior: {
    abilities: [
      {
        id: "warblade-buff",
        type: "continuous",
        modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }]
      }
    ]
  }
});

// "Target a character you control. It gets +2 strength until end of turn." — a battle trick, playable into a response window like any tactic.
const RALLY = tactic({
  name: "Rally",
  cost: 1,
  behavior: {
    abilities: [
      {
        id: "rally",
        type: "activated",
        targets: [{ id: "t", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
        effects: [
          {
            type: "createModifier",
            target: { type: "selected", id: "t" },
            stat: "strength",
            operation: "add",
            value: 2,
            duration: { type: "untilEndOfTurn" }
          }
        ]
      }
    ]
  }
});

const FACTION = factionCard({
  name: "Testers",
  faction: defaultFactionDefinition({
    startingInfluence: 8,
    setup: {
      startingResources: { count: 2, names: ["Rage"] },
      openingHand: { goingFirst: 4, goingSecond: 5 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
    }
  })
});

const DEFINITIONS: CardDefinition[] = [FACTION, RAGE, RECRUIT, CHAMPION, WARBLADE, RALLY];

function deckOf(): string[] {
  return [
    ...Array.from({ length: 6 }, () => RAGE.id),
    ...Array.from({ length: 4 }, () => RECRUIT.id),
    ...Array.from({ length: 2 }, () => CHAMPION.id),
    ...Array.from({ length: 2 }, () => WARBLADE.id),
    ...Array.from({ length: 2 }, () => RALLY.id)
  ];
}

/** Finds the first copy of `name` currently in `playerId`'s hand — deterministic given the fixed seed, but written by name so the script reads as intent rather than a hardcoded instance id. */
function handCard(engine: SpoilsEngine, playerId: string, name: string): CardInstanceId {
  const found = engine.state.players[playerId].hand.find(id => engine.getDefinition(id).name === name);
  assert.ok(
    found,
    `Expected a '${name}' in ${playerId}'s hand, got [${engine.state.players[playerId].hand.map(id => engine.getDefinition(id).name)}].`
  );
  return found!;
}

test("full game: a hand-scripted walkthrough from mulligan to a decided winner", () => {
  const engine = createTwoPlayerFactionGame(
    DEFINITIONS,
    { id: P1, name: "Alice", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf() },
    { id: P2, name: "Bob", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf() },
    { firstPlayerId: P1, seed: 2 }
  );

  // --- Setup: starting resources, opening hands, mulligan ---
  assert.equal(engine.state.players[P1].influence, 8);
  assert.equal(engine.getAvailableResourceCount(P1), 2, "2 starting Rage should already be in play.");
  assert.equal(engine.state.players[P1].hand.length, 4, "Going first draws 4.");
  assert.equal(engine.state.players[P2].hand.length, 5, "Going second draws 5.");
  assert.equal(engine.state.setup.phase, "mulligan");

  engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
  engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });

  assert.equal(engine.state.setup.phase, "complete");
  assert.equal(engine.state.developsUsedThisTurn, 0);
  assert.equal(engine.state.activePlayerId, P1);

  // --- Turn 1 (P1): develop by playing a resource, then deploy two Recruits ---
  engine.perform({
    type: "chooseDevelop",
    playerId: P1,
    choice: { type: "playResource", cards: [{ cardId: handCard(engine, P1, "Rage"), faceDown: false }] }
  });
  assert.equal(engine.state.developsUsedThisTurn, 1);
  assert.equal(engine.getAvailableResourceCount(P1), 3);

  const recruitA = handCard(engine, P1, "Recruit");
  engine.perform({ type: "playCard", playerId: P1, cardId: recruitA });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[recruitA].zone, "play");

  const recruitB = handCard(engine, P1, "Recruit");
  engine.perform({ type: "playCard", playerId: P1, cardId: recruitB });
  resolvePendingResponses(engine);

  assert.equal(engine.getAvailableResourceCount(P1), 1, "Both Recruits cost 1 each.");
  assert.equal(
    engine.state.cards[recruitA].attackEligibleTurn,
    undefined,
    "A character played this turn hasn't started the turn in play, so it can't attack yet."
  );

  engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(engine);

  // --- Turn 2 (P2): mirror P1's opening ---
  engine.perform({
    type: "chooseDevelop",
    playerId: P2,
    choice: { type: "playResource", cards: [{ cardId: handCard(engine, P2, "Rage"), faceDown: false }] }
  });

  const recruitC = handCard(engine, P2, "Recruit");
  engine.perform({ type: "playCard", playerId: P2, cardId: recruitC });
  resolvePendingResponses(engine);

  const recruitD = handCard(engine, P2, "Recruit");
  engine.perform({ type: "playCard", playerId: P2, cardId: recruitD });
  resolvePendingResponses(engine);

  engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(engine);

  // --- Turn 3 (P1): draw, deploy Champion, attack — P2 blocks and tricks with Rally ---
  engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });
  assert.equal(engine.state.turn, 3);
  assert.equal(
    engine.state.cards[recruitA].attackEligibleTurn,
    3,
    "Recruit A settled since turn 1 and is now eligible to attack."
  );

  const championA = handCard(engine, P1, "Champion");
  engine.perform({ type: "playCard", playerId: P1, cardId: championA });
  resolvePendingResponses(engine);
  assert.equal(engine.getAvailableResourceCount(P1), 0, "Champion's cost of 3 used every Rage P1 had.");

  engine.perform({
    type: "declareAttack",
    playerId: P1,
    attackerIds: [recruitA],
    target: { type: "faction", playerId: P2 }
  });
  resolvePendingResponses(engine);

  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [recruitC] });
  assert.equal(engine.state.battle?.phase, "beforeDamageResponse");
  assert.equal(
    engine.state.responseWindow?.priorityPlayerId,
    P1,
    "The attacker gets first opportunity to respond after blockers are declared."
  );

  // P1 has nothing worth doing here, so priority passes to P2, who plays
  // Rally on the blocker: without it, Recruit C's 1 strength wouldn't
  // scratch Recruit A (2 life); with it, Recruit C hits for 3 and kills it.
  engine.perform({ type: "passPriority", playerId: P1 });
  engine.perform({
    type: "playCard",
    playerId: P2,
    cardId: handCard(engine, P2, "Rally"),
    selected: { t: [recruitC] }
  });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(recruitC, "strength"), 3);

  autoResolveBattle(engine);

  assert.equal(engine.state.cards[recruitA].zone, "discard", "Recruit A died to the Rally-boosted blocker.");
  assert.equal(engine.state.cards[recruitC].zone, "play", "Recruit C's 2 life survives 1 damage from Recruit A.");
  assert.equal(engine.state.cards[recruitC].damage, 1);
  assert.equal(engine.state.players[P2].influence, 8, "The attack was blocked, so P2's faction took no damage.");

  engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(engine);

  // --- Turn 4 (P2): draw, equip Warblade, swing in unblocked (P1's board is untapped but chooses not to block) ---
  engine.perform({ type: "chooseDevelop", playerId: P2, choice: { type: "draw" } });

  const warbladeP2 = handCard(engine, P2, "Warblade");
  engine.perform({
    type: "playCard",
    playerId: P2,
    cardId: warbladeP2,
    selected: { attachTo: [recruitD] }
  });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(recruitD, "strength"), 3, "Recruit D: 1 base + 2 from Warblade.");

  engine.perform({
    type: "declareAttack",
    playerId: P2,
    attackerIds: [recruitC, recruitD],
    target: { type: "faction", playerId: P1 }
  });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  resolvePendingResponses(engine);
  autoResolveBattle(engine);

  assert.equal(engine.state.players[P1].influence, 4, "8 - (1 + 3) unblocked damage.");
  assert.equal(engine.state.cards[recruitC].depleted, true);
  assert.equal(engine.state.cards[recruitD].depleted, true);

  engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(engine);

  // --- Turn 5 (P1): play the last resource, pump Champion with Warcry, and swing for lethal-ish damage —
  // P2's Recruits are still depleted from attacking last turn, so nothing can block. ---
  engine.perform({
    type: "chooseDevelop",
    playerId: P1,
    choice: { type: "playResource", cards: [{ cardId: handCard(engine, P1, "Rage"), faceDown: false }] }
  });
  assert.equal(engine.getAvailableResourceCount(P1), 4);

  engine.perform({ type: "activateAbility", playerId: P1, cardId: championA, abilityId: "champion-warcry" });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(championA, "strength"), 5, "3 base + 2 from Warcry.");

  engine.perform({
    type: "declareAttack",
    playerId: P1,
    attackerIds: [championA, recruitB],
    target: { type: "faction", playerId: P2 }
  });
  resolvePendingResponses(engine);

  const p2Blockers = engine.state.players[P2].play.filter(
    id => !engine.state.cards[id].depleted && engine.getDefinition(id).type === "character"
  );
  assert.deepEqual(p2Blockers, [], "Both P2 Recruits are still depleted from attacking on turn 4.");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  resolvePendingResponses(engine);
  autoResolveBattle(engine);

  assert.equal(engine.state.players[P2].influence, 2, "8 - (5 + 1) unblocked damage.");

  engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(engine);

  // --- Turn 6 (P2): draw, deploy the second Champion, and land the finishing blow —
  // P1's board is depleted from attacking last turn, so this connects unblocked for exactly enough. ---
  engine.perform({ type: "chooseDevelop", playerId: P2, choice: { type: "draw" } });

  const championB = handCard(engine, P2, "Champion");
  engine.perform({ type: "playCard", playerId: P2, cardId: championB });
  resolvePendingResponses(engine);

  engine.perform({
    type: "declareAttack",
    playerId: P2,
    attackerIds: [recruitC, recruitD],
    target: { type: "faction", playerId: P1 }
  });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  resolvePendingResponses(engine);
  autoResolveBattle(engine);

  // 4 (after turn 4) - (1 + 3) unblocked damage = 0.
  assert.equal(engine.state.players[P1].influence, 0);
  assert.equal(engine.state.winner, P2);
  assert.equal(engine.getFlowView().mode, "gameOver");
  assert.equal(engine.getFlowView().winner, P2);

  // No further actions can be performed once the game has ended.
  assert.throws(() => engine.perform({ type: "passPriority", playerId: P2 }));
});
