// A destroy replacement installed at run time (`installReplacement`) can be scoped to whose card is destroyed
// (`controlledBy`) and to who caused it (`by`, `bySource`), the same scoping `ReplacementAbility.replaces` has.
// Synthetic fixtures only; the card that motivated it (Escort Ally: "characters you control cannot be destroyed
// by cards or abilities your opponents control") is a Decade of Deckadence card. The cause must be right on
// every way a card is destroyed: effects, triggers, tactics, lethal battle damage, and the destructions the
// state-based check performs on its own (game rules, a self-destroying paragraph).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine, TargetDeclaration } from "../../engine.js";
import type { CardDefinition } from "../../types/index.js";
import { autoResolveBattle, buildGame, character, P1, P2, resolvePendingResponses, tactic } from "./support/fixtures.js";

const T = { type: "selected", id: "t" } as const;
const PICK: TargetDeclaration[] = [{ id: "t", selector: {}, count: 1 }];
const DURATION = { type: "untilEndOfTurn" } as const;

type Scope = { by?: "self" | "opponent" | "any"; controlledBy?: "self" | "opponent" | "any"; bySource?: object };

/** A character with `shield`: "this turn, characters of mine can't be destroyed by <scope>" (an empty replacement). */
const shielder = (scope: Scope): CardDefinition =>
  character({
    name: "Shielder",
    behavior: {
      abilities: [
        {
          id: "shield",
          type: "activated",
          effects: [
            {
              type: "installReplacement",
              replaces: { event: "destroy", cardType: "character", ...scope },
              duration: DURATION,
              effects: []
            } as never
          ]
        }
      ]
    }
  });

/** A character whose ability `kill` destroys the picked card. */
const killer = (name = "Killer"): CardDefinition =>
  character({
    name,
    behavior: { abilities: [{ id: "kill", type: "activated", targets: PICK, effects: [{ type: "destroy", target: T }] }] }
  });

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;

function activate(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, abilityId: string, picked?: CardInstanceId): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: picked ? { t: [picked] } : {} });
}

/** Lets priority pass until `player` holds it in an open response window, then activates their ability (a response). */
function respond(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, abilityId: string): void {
  for (let guard = 0; guard < 5 && engine.state.responseWindow?.priorityPlayerId !== player; guard++) {
    const window = engine.state.responseWindow;
    assert.ok(window && window.phase === "acceptingResponses", "a response window is open");
    engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
  }
  activate(engine, player, cardId, abilityId);
}

/** Drains every open response window. */
function settle(engine: SpoilsEngine): void {
  for (let guard = 0; guard < 30 && engine.state.responseWindow; guard++) resolvePendingResponses(engine);
}

const OPP_SCOPE: Scope = { controlledBy: "self", by: "opponent" };
const OPP_SOURCE_SCOPE: Scope = { controlledBy: "self", bySource: { controller: "opponent", zone: "any" } };

describe("installReplacement destroy: scoped by the cause", () => {
  test("an opponent's ability is replaced (shield installed in response)", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "shield", def: shielder(OPP_SCOPE), owner: P1 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "foe", def: killer("Foe"), owner: P2 }
      ]
    });
    activate(engine, P2, id("foe"), "kill", id("mine"));
    respond(engine, P1, id("shield"), "shield");
    settle(engine);
    assert.equal(zoneOf(engine, id("mine")), "play", "destroyed by an opposing ability: replaced");
    assert.equal(engine.state.runtimeReplacements.length, 1);
  });

  test("the installer's own destroys, and the opponent's own characters, are outside the scope", () => {
    for (const scope of [OPP_SCOPE, OPP_SOURCE_SCOPE]) {
      const { engine, id } = buildGame({
        cards: [
          { key: "shield", def: shielder(scope), owner: P1 },
          { key: "mine", def: character({ name: "Mine" }), owner: P1 },
          { key: "mine2", def: killer("Mine2"), owner: P1 },
          { key: "foe2", def: character({ name: "Foe2" }), owner: P2 }
        ]
      });
      activate(engine, P1, id("shield"), "shield");
      settle(engine);
      activate(engine, P1, id("mine2"), "kill", id("mine"));
      settle(engine);
      assert.equal(zoneOf(engine, id("mine")), "discard", "my own ability destroys my own character: not replaced");
      activate(engine, P1, id("mine2"), "kill", id("foe2"));
      settle(engine);
      assert.equal(zoneOf(engine, id("foe2")), "discard", "controlledBy is the installer's side: the opponent's character is not covered");
    }
  });

  test("an opponent's tactic is replaced", () => {
    const smite = tactic({
      name: "Smite",
      behavior: { abilities: [{ id: "s", type: "activated", targets: PICK, effects: [{ type: "destroy", target: T }] }] }
    });
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "shield", def: shielder(OPP_SCOPE), owner: P1 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "smite", def: smite, owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("smite"), selected: { t: [id("mine")] } });
    respond(engine, P1, id("shield"), "shield");
    settle(engine);
    assert.equal(zoneOf(engine, id("smite")), "discard", "the tactic resolved");
    assert.equal(zoneOf(engine, id("mine")), "play");
  });

  test("a destroy made by a triggered ability of an opposing card is replaced", () => {
    const boomer = character({
      name: "Boomer",
      behavior: {
        abilities: [
          {
            id: "boom",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            targets: PICK,
            effects: [{ type: "destroy", target: T }]
          } as never
        ]
      }
    });
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "shield", def: shielder(OPP_SCOPE), owner: P1 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "boomer", def: boomer, owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("boomer"), selected: { t: [id("mine")] } });
    respond(engine, P1, id("shield"), "shield");
    settle(engine);
    assert.equal(zoneOf(engine, id("boomer")), "play", "the trigger's source deployed");
    assert.equal(zoneOf(engine, id("mine")), "play", "the trigger's destroy was replaced");
  });

  test("lethal battle damage from an opposing character: by 'opponent' replaces it, bySource does not", () => {
    for (const [scope, survives] of [
      [OPP_SCOPE, true],
      [OPP_SOURCE_SCOPE, false]
    ] as const) {
      const { engine, id } = buildGame({
        activePlayerId: P2,
        cards: [
          { key: "shield", def: shielder(scope), owner: P1 },
          { key: "mine", def: character({ name: "Mine", strength: 1, life: 2 }), owner: P1 },
          { key: "foe", def: character({ name: "Foe", strength: 5, life: 9 }), owner: P2 }
        ]
      });
      engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
      respond(engine, P1, id("shield"), "shield");
      settle(engine);
      engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("mine")] });
      autoResolveBattle(engine);
      assert.equal(engine.state.battle, undefined, "the battle is over");
      assert.equal(zoneOf(engine, id("mine")) === "play", survives, JSON.stringify(scope));
    }
  });

  test("bySource: a destroy effect of an opposing card is replaced", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "shield", def: shielder(OPP_SOURCE_SCOPE), owner: P1 },
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "foe", def: killer("Foe"), owner: P2 }
      ]
    });
    activate(engine, P2, id("foe"), "kill", id("a"));
    respond(engine, P1, id("shield"), "shield");
    settle(engine);
    assert.equal(zoneOf(engine, id("a")), "play");
  });

  test("a destruction by the card's own paragraph, after an opponent's effect, is not 'by an opponent'", () => {
    // The opponent's tactic destroys one of its own characters (the cause the engine saw last); the state-based check then destroys my card by
    // its own paragraph. That destruction is my card's, not the tactic's.
    const doomed = character({
      name: "Doomed",
      behavior: {
        abilities: [
          {
            id: "doom",
            type: "continuous",
            modifiers: [],
            condition: {
              type: "numberCompare",
              left: { type: "count", selector: { owner: "opponent", zone: "discard", type: "character" } },
              operator: ">=",
              right: 1
            },
            destroysSource: true
          } as never
        ]
      }
    });
    const nothing = tactic({
      name: "Nothing",
      behavior: { abilities: [{ id: "n", type: "activated", targets: PICK, effects: [{ type: "destroy", target: T }] }] }
    });
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "shield", def: shielder(OPP_SCOPE), owner: P1 },
        { key: "doomed", def: doomed, owner: P1 },
        { key: "foe2", def: character({ name: "Foe2" }), owner: P2 },
        { key: "nothing", def: nothing, owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("nothing"), selected: { t: [id("foe2")] } });
    respond(engine, P1, id("shield"), "shield");
    assert.equal(zoneOf(engine, id("doomed")), "play");
    settle(engine);
    assert.equal(zoneOf(engine, id("foe2")), "discard");
    assert.equal(zoneOf(engine, id("doomed")), "discard", "its own paragraph destroyed it; the shield (by an opponent) does not apply");
  });

  test("a destroy paid as a cost is not replaced (CR 506.2)", () => {
    const sac = character({
      name: "Sac",
      behavior: { abilities: [{ id: "sac", type: "activated", costs: [{ type: "destroy", target: "source" }], effects: [] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "shield", def: shielder({ controlledBy: "self", by: "any" }), owner: P1 },
        { key: "sac", def: sac, owner: P1 }
      ]
    });
    activate(engine, P1, id("shield"), "shield");
    settle(engine);
    activate(engine, P1, id("sac"), "sac");
    settle(engine);
    assert.equal(zoneOf(engine, id("sac")), "discard");
  });

  test("getActiveProtections lists the scoped replacement only for the cards it covers", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "shield", def: shielder(OPP_SCOPE), owner: P1 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 }
      ]
    });
    activate(engine, P1, id("shield"), "shield");
    settle(engine);
    const forMine = engine.getActiveProtections(id("mine")).filter(p => p.kind === "replacement");
    assert.equal(forMine.length, 1);
    assert.match(forMine[0]!.text, /opposing/);
    assert.equal(engine.getActiveProtections(id("foe")).filter(p => p.kind === "replacement").length, 0);
  });
});
