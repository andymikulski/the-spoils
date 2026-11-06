// Holy Heist capability unit tests, batch 2 (small conditions / refs /
// expressions / choices). See holy-heist-caps.test.ts for batch 1.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "./support/fixtures.js";
import { settleTurnStart } from "./support/develop.js";
import type { CardDefinition } from "../../engine.js";

describe("capability: isToken condition", () => {
  test("distinguishes token permanents from real cards", () => {
    const maker = character({
      name: "Token Maker",
      behavior: {
        abilities: [
          {
            id: "mk",
            type: "activated",
            effects: [
              {
                type: "createTokens",
                controller: "controller",
                count: 1,
                token: { name: "Blip", cardType: "character", strength: 1, life: 1 }
              }
            ]
          },
          {
            id: "probe",
            type: "activated",
            condition: {
              type: "numberCompare",
              left: {
                type: "count",
                selector: {
                  zone: "play",
                  type: "character",
                  conditions: [
                    { type: "isToken", target: { type: "selected", id: "__candidate" } }
                  ]
                }
              },
              operator: ">=",
              right: 1
            },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "m", def: maker, owner: P1, zone: "play" }]
    });

    assert.equal(
      engine.getAvailableActivatedAbilities(P1).some(a => a.ability.id === "probe"),
      false,
      "no tokens yet"
    );
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("m"), abilityId: "mk" });
    resolvePendingResponses(engine);
    assert.equal(
      engine.getAvailableActivatedAbilities(P1).some(a => a.ability.id === "probe"),
      true,
      "a token now exists"
    );
  });
});

describe("capability: sumCounters expression", () => {
  test("totals a counter across a selector", () => {
    const reader = character({
      name: "Counter Reader",
      behavior: {
        abilities: [
          {
            id: "read",
            type: "continuous",
            modifiers: [
              {
                target: "source",
                stat: "strength",
                operation: "add",
                value: {
                  type: "sumCounters",
                  selector: { controller: "self", zone: "play", type: "character" },
                  counter: "token"
                }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "r", def: reader, owner: P1, zone: "play", counters: { token: 2 } },
        { key: "b", def: character({ name: "Bud" }), owner: P1, zone: "play", counters: { token: 3 } }
      ]
    });

    assert.equal(engine.getStat(id("r"), "strength"), 6, "base 1 + 5 tokens");
  });
});

describe("capability: suppressKeyword effect", () => {
  test("removes a keyword for the duration, restores it after", () => {
    const spy = character({
      name: "Blown Cover",
      behavior: {
        keywords: ["covert"],
        abilities: [
          {
            id: "out",
            type: "activated",
            effects: [
              { type: "suppressKeyword", target: "source", keyword: "covert", duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "s", def: spy, owner: P1, zone: "play" }]
    });

    assert.equal(engine.hasKeyword(id("s"), "covert"), true);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "out" });
    resolvePendingResponses(engine);
    assert.equal(engine.hasKeyword(id("s"), "covert"), false, "suppressed this turn");

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.hasKeyword(id("s"), "covert"), true, "back next turn");
  });
});

describe("capability: distinctNames target declaration", () => {
  const grabber = (): CardDefinition =>
    item({
      name: "Grab Bag",
      behavior: {
        abilities: [
          {
            id: "grab",
            type: "activated",
            targets: [
              {
                id: "picks",
                selector: { owner: "self", zone: "deck", type: "character" },
                count: 2,
                distinctNames: true
              }
            ],
            effects: [
              { type: "forEach", selected: "picks", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }] }
            ]
          }
        ]
      }
    });

  test("rejects two same-named picks, accepts two different", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "g", def: grabber(), owner: P1, zone: "play" },
        { key: "dupA", def: character({ id: "dup", name: "Clone" }), owner: P1, zone: "deck" },
        { key: "dupB", def: character({ id: "dup", name: "Clone" }), owner: P1, zone: "deck" },
        { key: "uniq", def: character({ id: "uniq", name: "Original" }), owner: P1, zone: "deck" }
      ]
    });

    assert.throws(
      () =>
        engine.perform({
          type: "activateAbility",
          playerId: P1,
          cardId: id("g"),
          abilityId: "grab",
          selected: { picks: [id("dupA"), id("dupB")] }
        }),
      /different names/
    );

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("g"),
      abilityId: "grab",
      selected: { picks: [id("dupA"), id("uniq")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("dupA")].zone, "hand");
    assert.equal(engine.state.cards[id("uniq")].zone, "hand");
  });
});

describe("capability: tradeVar selector + nameValue trade", () => {
  test("a named trade constrains a later selector", () => {
    const scout = item({
      name: "Trade Scout",
      behavior: {
        abilities: [
          {
            id: "scout",
            type: "activated",
            effects: [
              { type: "nameValue", chooser: "controller", valueKind: "trade", storeAs: "t" },
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: {
                  id: "found",
                  selector: { owner: "self", zone: "deck", type: "character", tradeVar: "t" },
                  count: 1
                },
                effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "hand" }]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "sc", def: scout, owner: P1, zone: "play" },
        { key: "war", def: character({ id: "war", name: "Warrior", trade: "warlord" }), owner: P1, zone: "deck" },
        { key: "bank", def: character({ id: "bank", name: "Teller", trade: "banker" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("sc"), abilityId: "scout" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "nameValue");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "nameValue", value: "warlord" }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("war")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("war")].zone, "hand");
  });
});

describe("capability: battleTargetIs + battleDamageAssigned conditions", () => {
  test("true while a controlled-by-opponent location is the target and no damage assigned", () => {
    const probe = character({
      name: "Battle Probe",
      strength: 0,
      behavior: {
        abilities: [
          {
            id: "check",
            type: "triggered",
            event: "battleStarted",
            condition: {
              type: "and",
              conditions: [
                { type: "battleTargetIs", controlledBy: "opponent", cardType: "location" },
                { type: "battleDamageAssigned", operator: "=", value: 0 }
              ]
            },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Raider", strength: 2, speed: 3 }), owner: P1, zone: "play" },
        { key: "probe", def: probe, owner: P1, zone: "play" },
        { key: "fort", def: location({ name: "Fort", structure: 5 }), owner: P2, zone: "play" }
      ]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("atk")],
      target: { type: "card", cardId: id("fort") }
    });
    resolvePendingResponses(engine);

    assert.equal(
      engine.state.players[P1].influence,
      before + 5,
      "trigger saw a controlled-location target with no damage yet assigned"
    );
  });
});

describe("capability: respondedToPicked TargetRef", () => {
  test("resolves to the character the responded-to card picked as an extra cost", () => {
    // The responded-to tactic: EXTRA COST pick a character, then deplete it.
    const grabTactic = tactic({
      name: "Grabber",
      behavior: {
        abilities: [
          {
            id: "grab",
            type: "activated",
            targets: [{ id: "pick", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "deplete", target: { type: "selected", id: "pick" } }]
          }
        ]
      }
    });

    // The response: bounce whatever character the grab picked.
    const counterTactic = tactic({
      name: "Counter Grab",
      behavior: {
        abilities: [
          {
            id: "cg",
            type: "activated",
            condition: { type: "respondedToPicked", cardType: "character" },
            effects: [
              { type: "moveCard", target: { type: "respondedToPicked", cardType: "character" }, to: "hand" }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "grab", def: grabTactic, owner: P1, zone: "hand" },
        { key: "cg", def: counterTactic, owner: P2, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P1, zone: "play" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("grab"),
      selected: { pick: [id("victim")] }
    });
    // P2 responds with Counter Grab into the open window
    engine.perform({ type: "playCard", playerId: P2, cardId: id("cg") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "hand", "picked character bounced");
  });
});
