// Unit tests for the engine capabilities added for the Open Beta set
// coverage pass. One (or a few) tests per capability primitive; card-shaped
// end-to-end scenarios live in open-beta-smoke.test.ts.
// See CATALOG-BUILDOUT.md + COVERAGE.md's capability backlog.

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
  resourceCard,
  tactic
} from "./support/fixtures.js";

// --- draw-count-modifier ------------------------------------------------------

describe("capability: draw-count-modifier", () => {
  test("+1 to every draw, and a conditional 'cannot draw'", () => {
    const beatrix = character({
      name: "Beatrix",
      behavior: {
        abilities: [
          {
            id: "more",
            type: "continuous",
            modifiers: [],
            drawModifiers: [{ player: "self", delta: 1 }]
          },
          {
            id: "cap",
            type: "continuous",
            condition: {
              type: "numberCompare",
              left: {
                type: "count",
                selector: { owner: "self", zone: "hand" }
              },
              operator: ">=",
              right: 3
            },
            modifiers: [],
            drawModifiers: [{ player: "self", prevent: true }]
          }
        ]
      }
    });
    const spell = tactic({
      name: "Draw2",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [{ type: "draw", player: "controller", amount: 2 }]
          }
        ]
      }
    });

    const { engine } = buildGame({
      cards: [
        { key: "b", def: beatrix, owner: P1 },
        { key: "s", def: spell, owner: P1, zone: "play" },
        ...Array.from({ length: 6 }, (_, i) => ({
          key: `d${i}`,
          def: character({ name: `D${i}` }),
          owner: P1,
          zone: "deck" as const
        }))
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: engineId(engine, "Draw2"), abilityId: "b" });
    resolvePendingResponses(engine);
    // 2 requested + 1 from Beatrix = 3 in hand
    assert.equal(engine.state.players[P1].hand.length, 3);

    // Now hand >= 3 -> "cannot draw"
    engine.perform({ type: "activateAbility", playerId: P1, cardId: engineId(engine, "Draw2"), abilityId: "b" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, 3);
  });
});

// --- event-draw-amount-expression ------------------------------------------

describe("capability: eventDrawAmount expression", () => {
  test("faction gains influence equal to cards drawn", () => {
    const summit = location({
      name: "Gold Summit",
      behavior: {
        abilities: [
          {
            id: "gild",
            type: "triggered",
            event: "cardsDrawn",
            condition: { type: "eventPlayerIs", player: "controller" },
            effects: [
              {
                type: "modifyInfluence",
                player: "controller",
                amount: { type: "eventDrawAmount" }
              }
            ]
          }
        ]
      }
    });
    const spell = tactic({
      name: "Draw3",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [{ type: "draw", player: "controller", amount: 3 }]
          }
        ]
      }
    });

    const { engine } = buildGame({
      cards: [
        { key: "g", def: summit, owner: P1 },
        { key: "s", def: spell, owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({
          key: `d${i}`,
          def: character({ name: `D${i}` }),
          owner: P1,
          zone: "deck" as const
        }))
      ]
    });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: engineId(engine, "Draw3"), abilityId: "b" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before + 3);
  });
});

// --- influence-change-modifier -------------------------------------------------

describe("capability: influence-change-modifier", () => {
  test("a 'reduce influence loss by 1' floor never turns a loss into a gain", () => {
    const tax = character({
      name: "Tax Attorney",
      behavior: {
        abilities: [
          {
            id: "shield",
            type: "continuous",
            modifiers: [],
            influenceModifiers: [
              { player: "self", direction: "loss", delta: 1 }
            ]
          }
        ]
      }
    });
    const bomb = tactic({
      name: "LoseInf",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              { type: "modifyInfluence", player: "controller", amount: -3 }
            ]
          }
        ]
      }
    });
    const nick = tactic({
      name: "LoseOne",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              { type: "modifyInfluence", player: "controller", amount: -1 }
            ]
          }
        ]
      }
    });

    const { engine } = buildGame({
      cards: [
        { key: "t", def: tax, owner: P1 },
        { key: "b", def: bomb, owner: P1, zone: "play" },
        { key: "n", def: nick, owner: P1, zone: "play" }
      ]
    });
    const start = engine.state.players[P1].influence;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: engineId(engine, "LoseInf"), abilityId: "b" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, start - 2); // -3 +1

    engine.perform({ type: "activateAbility", playerId: P1, cardId: engineId(engine, "LoseOne"), abilityId: "b" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, start - 2); // -1 +1 floored at 0
  });
});

// --- cannot-lose-at-zero-influence ------------------------------------------

describe("capability: preventsDefeat", () => {
  test("a faction at 0 influence does not lose while Armored Keep is in play", () => {
    const keep = location({
      name: "Armored Keep",
      behavior: {
        abilities: [
          {
            id: "unbowed",
            type: "continuous",
            modifiers: [],
            preventsDefeat: { player: "self" }
          }
        ]
      }
    });
    const { engine } = buildGame({
      cards: [{ key: "k", def: keep, owner: P1 }],
      playerA: { influence: 1 }
    });
    const bomb = tactic({
      name: "Nuke",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              { type: "modifyInfluence", player: "controller", amount: -5 }
            ]
          }
        ]
      }
    });
    engine.state.cards; // noop
    // add + play the bomb
    const withBomb = buildGame({
      cards: [
        { key: "k", def: keep, owner: P1 },
        { key: "b", def: bomb, owner: P1, zone: "play" }
      ],
      playerA: { influence: 1 }
    });
    withBomb.engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: withBomb.id("b"),
      abilityId: "b"
    });
    resolvePendingResponses(withBomb.engine);
    assert.ok(withBomb.engine.state.players[P1].influence <= 0);
    assert.equal(withBomb.engine.state.winner, undefined);

    // Removing the keep lets the loss resolve.
    withBomb.engine.state.cards[withBomb.id("k")].zone = "discard";
    // trigger a state-based check via a harmless mutation
    withBomb.engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(withBomb.engine.state.winner, P2);
  });
});

// --- attack-tax --------------------------------------------------------------

describe("capability: attackTax", () => {
  test("an opponent must pay N resources to declare an attack", () => {
    const ministry = location({
      name: "Ministry",
      behavior: {
        abilities: [
          {
            id: "toll",
            type: "continuous",
            modifiers: [],
            attackTax: { player: "opponent", amount: 2 }
          }
        ]
      }
    });
    const attacker = character({ name: "Grunt", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: ministry, owner: P1 },
        { key: "a", def: attacker, owner: P2, zone: "play" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P2, zone: "play" },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    assert.equal(engine.getAvailableResourceCount(P2), 2);
    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("a")],
      target: { type: "faction", playerId: P1 }
    });
    // paid the 2-resource toll
    assert.equal(engine.getAvailableResourceCount(P2), 0);
  });

  test("an unpayable toll makes the attack illegal", () => {
    const ministry = location({
      name: "Ministry",
      behavior: {
        abilities: [
          {
            id: "toll",
            type: "continuous",
            modifiers: [],
            attackTax: { player: "opponent", amount: 2 }
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: ministry, owner: P1 },
        { key: "a", def: character({ name: "Grunt", strength: 2, life: 2 }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P2,
        attackerIds: [id("a")],
        target: { type: "faction", playerId: P1 }
      })
    );
  });
});

// --- deploys-this-turn-count ------------------------------------------------

describe("capability: deploysThisTurn expression", () => {
  test("counts a player's deploys this turn, filtered by type", () => {
    const gate = character({
      name: "Gatekeeper",
      behavior: {
        onPlay: {
          condition: {
            type: "numberCompare",
            left: {
              type: "deploysThisTurn",
              player: "controller",
              notCardType: "resource"
            },
            operator: ">=",
            right: 1
          }
        }
      }
    });
    const first = character({ name: "First" });
    const { engine, id } = buildGame({
      cards: [
        { key: "first", def: first, owner: P1, zone: "hand" },
        { key: "gate", def: gate, owner: P1, zone: "hand" }
      ]
    });
    // Gate can't come down before another non-resource deploy this turn.
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("gate") })
    );
    engine.perform({ type: "playCard", playerId: P1, cardId: id("first") });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gate") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("gate")].zone, "play");
  });
});

// --- attacked-this-turn-condition -----------------------------------------

describe("capability: attackedThisTurn condition", () => {
  test("self-destructs at end of turn if it did not attack", () => {
    const reckless = character({
      name: "Reckless",
      strength: 3,
      life: 1,
      behavior: {
        abilities: [
          {
            id: "cull",
            type: "triggered",
            event: "turnEnding",
            condition: {
              type: "and",
              conditions: [
                { type: "eventPlayerIs", player: "controller" },
                { type: "not", condition: { type: "attackedThisTurn" } }
              ]
            },
            effects: [{ type: "destroy", target: "source" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [{ key: "r", def: reckless, owner: P1 }]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("r")].zone, "discard");
  });
});

// --- damaged-this-turn-any-source -----------------------------------------

describe("capability: damagedThisTurn by 'any'", () => {
  test("true when the card took damage from any source this turn", () => {
    const target = character({ name: "Mark", life: 5 });
    const pinger = tactic({
      name: "Ping",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [
              { type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }
            ]
          }
        ]
      }
    });
    const finisher = tactic({
      name: "Finish",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [
              {
                type: "if",
                condition: {
                  type: "damagedThisTurn",
                  target: { type: "selected", id: "t" },
                  by: "any"
                },
                effects: [
                  { type: "destroy", target: { type: "selected", id: "t" } }
                ]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: target, owner: P2, zone: "play" },
        { key: "p", def: pinger, owner: P1, zone: "play" },
        { key: "f", def: finisher, owner: P1, zone: "play" }
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("p"),
      abilityId: "b",
      selected: { t: [id("m")] }
    });
    resolvePendingResponses(engine);
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("f"),
      abilityId: "b",
      selected: { t: [id("m")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("m")].zone, "discard");
  });
});

// --- grant-subtype --------------------------------------------------------

describe("capability: grantSubtype effect", () => {
  test("adds a subtype that subtype selectors then see", () => {
    const bless = tactic({
      name: "Bless",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [
              {
                type: "grantSubtype",
                target: { type: "selected", id: "t" },
                subtype: "sarcophyle",
                duration: { type: "permanent" }
              }
            ]
          }
        ]
      }
    });
    const lord = character({
      name: "Sarco Lord",
      behavior: {
        abilities: [
          {
            id: "aura",
            type: "continuous",
            modifiers: [
              {
                selector: { controller: "self", subtype: "sarcophyle" },
                stat: "speed",
                operation: "add",
                value: 1
              }
            ]
          }
        ]
      }
    });
    const grunt = character({ name: "Grunt", speed: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "b", def: bless, owner: P1, zone: "play" },
        { key: "l", def: lord, owner: P1 },
        { key: "g", def: grunt, owner: P1 }
      ]
    });
    assert.equal(engine.getStat(id("g"), "speed"), 2);
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("b"),
      abilityId: "b",
      selected: { t: [id("g")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("g"), "speed"), 3);
  });
});

// --- redirect-hand-moves ------------------------------------------------------

describe("capability: redirectHandMoves effect", () => {
  test("a card that would go to hand goes to discard instead this turn", () => {
    const misfire = tactic({
      name: "Misfire",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              {
                type: "redirectHandMoves",
                who: "any",
                to: "discard",
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });
    const bounce = tactic({
      name: "Bounce",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [
              { type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }
            ]
          }
        ]
      }
    });
    const guy = character({ name: "Guy" });
    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: misfire, owner: P1, zone: "play" },
        { key: "bo", def: bounce, owner: P1, zone: "play" },
        { key: "g", def: guy, owner: P2, zone: "play" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("m"), abilityId: "b" });
    resolvePendingResponses(engine);
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("bo"),
      abilityId: "b",
      selected: { t: [id("g")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("g")].zone, "discard");
  });
});

// --- selector-fromtop-expression -----------------------------------------

describe("capability: CardSelector.fromTop as a NumberExpression", () => {
  test("'top X' where X is a variable", () => {
    const dig = tactic({
      name: "Dig",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            variables: { x: 2 },
            effects: [
              {
                type: "forEach",
                selector: {
                  owner: "opponent",
                  zone: "deck",
                  fromTop: { type: "variable", id: "x" }
                },
                effects: [
                  {
                    type: "moveCard",
                    target: { type: "selected", id: "__candidate" },
                    to: "discard"
                  }
                ]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "d", def: dig, owner: P1, zone: "play" },
        ...Array.from({ length: 4 }, (_, i) => ({
          key: `c${i}`,
          def: character({ name: `C${i}` }),
          owner: P2,
          zone: "deck" as const
        }))
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("d"), abilityId: "b" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].discard.length, 2);
  });
});

// --- last-deployed-tactic-ref ------------------------------------------------

describe("capability: lastDeployedTactic ref + duplicate", () => {
  test("duplicate re-resolves the last resolved tactic's effects", () => {
    const draw1 = tactic({
      name: "Draw1",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const replicate = tactic({
      name: "Replicate",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              { type: "duplicate", target: { type: "lastDeployedTactic" } }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "d", def: draw1, owner: P1, zone: "hand" },
        { key: "r", def: replicate, owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({
          key: `c${i}`,
          def: character({ name: `C${i}` }),
          owner: P1,
          zone: "deck" as const
        }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("d") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, 1);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("r"), abilityId: "b" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, 2);
  });
});

// --- foreach-sequential ---------------------------------------------------

describe("capability: forEach { sequential: true }", () => {
  test("a per-iteration chooser pauses and resumes for every element", () => {
    const drain = tactic({
      name: "Drain",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              {
                type: "forEach",
                sequential: true,
                selector: { owner: "opponent", zone: "hand" },
                effects: [
                  {
                    type: "chooserSelectsTarget",
                    chooser: "opponent",
                    declaration: {
                      id: "d",
                      selector: { owner: "opponent", zone: "hand" },
                      count: 1
                    },
                    effects: [
                      {
                        type: "moveCard",
                        target: { type: "selected", id: "d" },
                        to: "discard"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "d", def: drain, owner: P1, zone: "play" },
        ...Array.from({ length: 3 }, (_, i) => ({
          key: `h${i}`,
          def: character({ name: `H${i}` }),
          owner: P2,
          zone: "hand" as const
        }))
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("d"), abilityId: "b" });
    // three sequential pauses, each answered by P2
    for (let i = 0; i < 3; i++) {
      resolvePendingResponses(engine);
      assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
      const hand = engine.state.players[P2].hand;
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P2,
        choice: { kind: "chooserSelectsTarget", selected: [hand[0]] }
      });
    }
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].hand.length, 0);
    assert.equal(engine.state.players[P2].discard.length, 3);
  });
});

// --- party-restriction-any-party ------------------------------------------

describe("capability: partyRestriction scope 'allParties' + maxMembers", () => {
  test("a location forces every attacking party to exactly 1 member", () => {
    const alley = location({
      name: "Hangdog Alley",
      behavior: {
        abilities: [
          {
            id: "solo",
            type: "continuous",
            modifiers: [],
            partyRestriction: {
              role: "attacking",
              minMembers: 1,
              maxMembers: 1,
              scope: "allParties"
            }
          }
        ]
      }
    });
    const a1 = character({ name: "A1", strength: 2, life: 2 });
    const a2 = character({ name: "A2", strength: 2, life: 2 });
    const { engine, id } = buildGame({
      cards: [
        { key: "alley", def: alley, owner: P2 },
        { key: "a1", def: a1, owner: P1, zone: "play" },
        { key: "a2", def: a2, owner: P1, zone: "play" }
      ]
    });
    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("a1"), id("a2")],
        target: { type: "faction", playerId: P2 }
      })
    );
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("a1")],
      target: { type: "faction", playerId: P2 }
    });
    assert.ok(engine.state.battle);
  });
});

// --- play-restriction-by-name -------------------------------------------------

describe("capability: playRestrictions kind { named }", () => {
  test("a named card cannot be deployed while the source is in play", () => {
    const photo = item({
      name: "Incriminating Photograph",
      behavior: {
        abilities: [
          {
            id: "ban",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [
              {
                type: "nameValue",
                chooser: "controller",
                valueKind: "cardName",
                storeAs: "banned"
              }
            ]
          },
          {
            id: "wall",
            type: "continuous",
            modifiers: [],
            playRestrictions: [{ player: "any", kind: { named: "banned" } }]
          }
        ]
      }
    });
    const target = character({ name: "Forbidden" });
    const { engine, id } = buildGame({
      cards: [
        { key: "p", def: photo, owner: P1, zone: "hand" },
        { key: "t", def: target, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("p") });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "nameValue", value: "Forbidden" }
    });
    resolvePendingResponses(engine);
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("t") })
    );
  });
});

// --- install-replacement-effect ---------------------------------------------

describe("capability: installReplacement effect", () => {
  test("'would be destroyed -> take control instead' for the turn", () => {
    const matriculate = item({
      name: "Matriculation",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [
              { id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }
            ],
            effects: [
              {
                type: "installReplacement",
                replaces: { event: "destroy" },
                condition: {
                  type: "isCard",
                  target: { type: "selected", id: "__candidate" },
                  other: { type: "selected", id: "t" }
                },
                duration: { type: "untilEndOfTurn" },
                effects: [
                  {
                    type: "takeControl",
                    target: { type: "selected", id: "__candidate" },
                    controller: "controller"
                  },
                  {
                    type: "setDamage",
                    target: { type: "selected", id: "__candidate" },
                    amount: 0
                  }
                ]
              }
            ]
          }
        ]
      }
    });
    const victim = character({ name: "Victim", life: 2 });
    const killer = item({
      name: "Kill",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [
              { type: "destroy", target: { type: "selected", id: "t" } }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: matriculate, owner: P1, zone: "play" },
        { key: "k", def: killer, owner: P1, zone: "play" },
        { key: "v", def: victim, owner: P2, zone: "play" }
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("m"),
      abilityId: "b",
      selected: { t: [id("v")] }
    });
    resolvePendingResponses(engine);
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("k"),
      abilityId: "b",
      selected: { t: [id("v")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("v")].zone, "play");
    assert.equal(engine.state.cards[id("v")].controllerId, P1);
  });
});

// --- card-picked-trigger ---------------------------------------------------

describe("capability: cardPicked event", () => {
  test("firing when a chooserSelectsTarget effect picks the card", () => {
    const ferret = character({
      name: "Ferrous Ferret",
      behavior: {
        abilities: [
          {
            id: "grow",
            type: "triggered",
            event: "cardPicked",
            condition: { type: "sourceIsEventCard" },
            effects: [
              { type: "addCounter", target: "source", counter: "token", amount: 1 }
            ]
          }
        ]
      }
    });
    const poke = tactic({
      name: "Poke",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: {
                  id: "d",
                  selector: { type: "character" },
                  count: 1
                },
                effects: []
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "f", def: ferret, owner: P1 },
        { key: "p", def: poke, owner: P1, zone: "play" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("p"), abilityId: "b" });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("f")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("f")].counters.token, 1);
  });
});

// --- spend-counters-menu -------------------------------------------------

describe("capability: spendCountersMenu effect", () => {
  test("spend tokens on menu options until stopping", () => {
    const spender = tactic({
      name: "Voidal Poisoning",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              {
                type: "spendCountersMenu",
                chooser: "controller",
                pool: { controller: "self" },
                counter: "token",
                options: [
                  {
                    cost: 1,
                    label: "draw",
                    effects: [{ type: "draw", player: "controller", amount: 1 }]
                  },
                  {
                    cost: 2,
                    label: "draw 2",
                    effects: [{ type: "draw", player: "controller", amount: 2 }]
                  }
                ]
              }
            ]
          }
        ]
      }
    });
    const battery = character({ name: "Battery" });
    const { engine, id } = buildGame({
      cards: [
        { key: "s", def: spender, owner: P1, zone: "play" },
        { key: "b", def: battery, owner: P1, counters: { token: 3 } },
        ...Array.from({ length: 5 }, (_, i) => ({
          key: `c${i}`,
          def: character({ name: `C${i}` }),
          owner: P1,
          zone: "deck" as const
        }))
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "b" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "spendCountersMenu");
    // spend 2 for a 2-draw
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "spendCountersMenu", optionIndex: 1, sources: [id("b"), id("b")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "spendCountersMenu");
    // spend the last 1 for a draw
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "spendCountersMenu", optionIndex: 0, sources: [id("b")] }
    });
    resolvePendingResponses(engine);
    // no tokens left -> the loop ends by itself
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.players[P1].hand.length, 3);
    assert.equal(engine.state.cards[id("b")].counters.token ?? 0, 0);
  });
});

// --- activate-opponents-abilities ---------------------------------------------

describe("capability: canUseOpponentAbilities", () => {
  test("the controller activates an opponent card's ability, paying with own resources", () => {
    const billionaire = character({
      name: "The Billionaire",
      behavior: {
        abilities: [
          {
            id: "borrow",
            type: "continuous",
            modifiers: [],
            canUseOpponentAbilities: true
          }
        ]
      }
    });
    const oppCard = character({
      name: "Opp Machine",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            costs: [{ type: "payResources", amount: 1 }],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "b", def: billionaire, owner: P1 },
        { key: "o", def: oppCard, owner: P2, zone: "play" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "play" },
        ...Array.from({ length: 2 }, (_, i) => ({
          key: `p2c${i}`,
          def: character({ name: `P2C${i}` }),
          owner: P2,
          zone: "deck" as const
        }))
      ]
    });
    const p2HandBefore = engine.state.players[P2].hand.length;
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("o"),
      abilityId: "go"
    });
    resolvePendingResponses(engine);
    // P1 paid the resource; the draw happened as P2 ("as if your opponent used it")
    assert.equal(engine.getAvailableResourceCount(P1), 0);
    assert.equal(engine.state.players[P2].hand.length, p2HandBefore + 1);
  });
});

// helper: resolve a definition's first instance id by card name
function engineId(engine: import("../../engine.js").SpoilsEngine, name: string): string {
  for (const [cid, card] of Object.entries(engine.state.cards)) {
    if (engine.getDefinition(cid).name === name) return card.id;
  }
  throw new Error(`no instance for '${name}'`);
}
