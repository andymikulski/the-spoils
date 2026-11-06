import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../engine.js";
import { bank, buildGame, cardDef, character, developFaction, P1, P2, resolvePendingResponses } from "./per-card/_harness.js";

// The Poshernacle ("At the start of your turn, you may use an ability. / you may draw a card. / your faction gains
// 1 influence") in play beside a faction with a Restore Rule and a Develop Rule: all of them are start-of-turn
// triggers in the ONE batch, and the player orders them (CR 602.2). Ordering is the whole point of the card:
//
//   3 open resources + Poshernacle. Gain 1 influence, draw, Develop (play a resource: 4 open), use the faction's
//   "pay 4: play a resource" through the Poshernacle's "use an ability", and ONLY THEN the Restore Rule, which
//   detaches (un-spends) everything the ability paid.

const FILLER = character({ name: "Filler", life: 2 });

function scenario() {
  const handResources = bank("greed", 2, P1).map(placement => ({ ...placement, zone: "hand" as const }));
  const { engine, id } = buildGame({
    playerA: { faction: cardDef("Seed", "The Tournament Faction") },
    playerB: { faction: developFaction() },
    cards: [
      { key: "posh", def: cardDef("Seed 2", "The Poshernacle"), owner: P1, zone: "play" },
      ...bank("greed", 3, P1),
      ...handResources,
      { key: "top", def: FILLER, owner: P1, zone: "deck" },
      { key: "next", def: FILLER, owner: P1, zone: "deck" }
    ],
    activePlayerId: P2
  });
  return { engine, id, handIds: handResources.map(placement => id(placement.key)) };
}

const factionOf = (engine: SpoilsEngine, playerId: PlayerId) => engine.state.players[playerId].factionId!;

function openResources(engine: SpoilsEngine, playerId: PlayerId): number {
  return engine.state.players[playerId].play.filter(
    cardId => !!engine.getDefinition(cardId).resource && !engine.state.cards[cardId].attachedTo
  ).length;
}

function answer(engine: SpoilsEngine, playerId: PlayerId, choice: unknown): void {
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);
}

/** Resolves the pending start-of-turn trigger `abilityId` of `sourceId` first. */
function resolveFirst(engine: SpoilsEngine, sourceId: CardInstanceId, abilityId: string): void {
  const pending = engine.state.pendingChoice;
  assert.equal(pending?.kind, "orderTriggers", `expected the trigger order prompt, found ${pending?.kind}`);
  if (pending?.kind !== "orderTriggers") return;
  answer(engine, pending.playerId, { kind: "orderTriggers", next: { sourceId, abilityId } });
}

/** The Poshernacle's "you may use an ability": the faction's "pay 4, play a resource" with `resourceId` from hand. */
function useFactionResourceAbility(engine: SpoilsEngine, resourceId: CardInstanceId): void {
  assert.equal(engine.state.pendingChoice?.kind, "useAnyAbility", "the Poshernacle offers an ability to use");
  answer(engine, P1, { kind: "useAnyAbility", cardId: factionOf(engine, P1) });
  assert.equal((engine.state.pendingChoice as { kind: string } | undefined)?.kind, "useTargetAbility");
  answer(engine, P1, { kind: "useTargetAbility", abilityId: "tournament-resource", selected: { resource: [resourceId] } });
  // The ability goes on the stack: the opponent passes and it resolves.
  resolvePendingResponses(engine);
  // The resource enters play: face-up (a real resource card).
  if ((engine.state.pendingChoice as { kind: string } | undefined)?.kind === "playResource") {
    answer(engine, P1, { kind: "playResource", faceDown: false });
  }
}

/** The Develop Rule: "Play a resource" with `resourceId` from hand, face-up. */
function developPlayResource(engine: SpoilsEngine, resourceId: CardInstanceId): void {
  const pending = engine.state.pendingChoice;
  assert.equal(pending?.kind, "chooserSelectsOption", "the Develop Rule offers its options");
  if (pending?.kind !== "chooserSelectsOption") return;
  const index = pending.options.findIndex(option => option.label === "Play a resource");
  assert.ok(index >= 0, "'Play a resource' is offered");
  answer(engine, P1, { kind: "chooserSelectsOption", index });
  if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [resourceId] });
  }
  if (engine.state.pendingChoice?.kind === "playResource") answer(engine, P1, { kind: "playResource", faceDown: false });
}

function startPlayersTurn(engine: SpoilsEngine): void {
  engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(engine);
}

describe("The Poshernacle: its start-of-turn triggers and the faction's rules are ordered by the player", () => {
  test("the batch holds the faction's Restore Rule, its Develop Rule and all three Poshernacle triggers", () => {
    const { engine, id } = scenario();
    startPlayersTurn(engine);

    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    if (pending?.kind !== "orderTriggers") return;
    assert.equal(pending.playerId, P1, "the turn's player orders them");
    const listed = pending.triggers.map(trigger => `${trigger.sourceId}:${trigger.abilityId}`).sort();
    const faction = factionOf(engine, P1);
    assert.deepEqual(
      listed,
      [
        `${faction}:developRule`,
        `${faction}:restoreRule`,
        `${id("posh")}:posh-draw`,
        `${id("posh")}:posh-influence`,
        `${id("posh")}:posh-use`
      ].sort(),
      "five triggers in one batch"
    );
  });

  test("influence, draw, Develop (play a resource), use the faction ability, THEN Restore: everything paid is un-spent", () => {
    const { engine, id, handIds } = scenario();
    const influenceBefore = engine.state.players[P1].influence;
    const handBefore = engine.state.players[P1].hand.length;
    const faction = factionOf(engine, P1);
    assert.equal(openResources(engine, P1), 3, "3 open resources at the end of the opponent's turn");

    startPlayersTurn(engine);

    resolveFirst(engine, id("posh"), "posh-influence");
    assert.equal(engine.state.players[P1].influence, influenceBefore + 1, "gained 1 influence");

    resolveFirst(engine, id("posh"), "posh-draw");
    answer(engine, P1, { kind: "mayPay", pay: true });
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1, "drew the card");

    resolveFirst(engine, faction, "developRule");
    developPlayResource(engine, handIds[0]);
    assert.equal(openResources(engine, P1), 4, "the Develop Rule's resource makes 4 open resources");

    resolveFirst(engine, id("posh"), "posh-use");
    useFactionResourceAbility(engine, handIds[1]);
    assert.equal(engine.state.cards[handIds[1]].zone, "play", "the faction's ability played a resource");

    // Restore is the last trigger standing: it resolves by itself, after the ability has paid, and un-spends it all.
    assert.equal(engine.state.pendingChoice, undefined, "nothing left to decide");
    assert.equal(openResources(engine, P1), 5, "the Restore Rule detached the four paid resources: all 5 are open");
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1 - 2, "drew one, played two resources");
  });

  test("the same triggers with Restore FIRST leave the paid resources spent", () => {
    const { engine, id, handIds } = scenario();
    const faction = factionOf(engine, P1);

    startPlayersTurn(engine);

    resolveFirst(engine, faction, "restoreRule");
    resolveFirst(engine, id("posh"), "posh-influence");
    resolveFirst(engine, id("posh"), "posh-draw");
    answer(engine, P1, { kind: "mayPay", pay: true });
    resolveFirst(engine, faction, "developRule");
    developPlayResource(engine, handIds[0]);
    // Only the Poshernacle's "use an ability" is left: it resolves on its own.
    useFactionResourceAbility(engine, handIds[1]);

    assert.equal(engine.state.pendingChoice, undefined, "nothing left to decide");
    assert.equal(openResources(engine, P1), 1, "Restore already happened: the four paid resources stay spent");
  });
});
