// Unit tests for the engine capabilities added for the Ungodly Mess set
// coverage pass. One test per capability primitive; see COVERAGE.md's
// capability backlog.

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

// --- distinctCount expression -------------------------------------------------

describe("capability: distinctCount expression", () => {
  test("counts distinct staple resource names, not icons", () => {
    const rage = resourceCard({ id: "um-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
    const greed = resourceCard({ id: "um-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });
    const engineer = character({
      name: "Elite Acrolos Engineer",
      strength: 1,
      life: 1,
      behavior: {
        abilities: [
          {
            id: "scale",
            type: "continuous",
            modifiers: [
              {
                target: "source",
                stat: "strength",
                operation: "add",
                value: {
                  type: "distinctCount",
                  by: "name",
                  selector: { controller: "self", type: "resource", staple: true }
                }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "eng", def: engineer, owner: P1 },
        { key: "r1", def: rage, owner: P1 },
        { key: "r2", def: rage, owner: P1 },
        { key: "r3", def: greed, owner: P1 }
      ]
    });

    // 2 distinct names (Rage, Greed) across 3 staples -> +2 strength.
    assert.equal(engine.getStat(id("eng"), "strength"), 3);
  });
});

// --- resource-attachment selector -------------------------------------------

describe("capability: attachedToFaction selector predicate", () => {
  test("false matches detached (available) resources; true matches spent ones", () => {
    const rage = resourceCard({ id: "um-rage2", name: "Rage" });
    const probe = character({
      name: "Probe",
      strength: 0,
      life: 5,
      behavior: {
        abilities: [
          {
            id: "count-detached",
            type: "continuous",
            modifiers: [
              {
                target: "source",
                stat: "strength",
                operation: "add",
                value: {
                  type: "count",
                  selector: { controller: "opponent", type: "resource", attachedToFaction: false }
                }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "probe", def: probe, owner: P1 },
        { key: "r1", def: rage, owner: P2 },
        { key: "r2", def: rage, owner: P2, attachedToKey: "__factionB" }
      ]
    });

    // r1 is detached/available, r2 is attached/spent -> exactly 1 detached.
    assert.equal(engine.getStat(id("probe"), "strength"), 1);
  });
});

// --- conditional-threshold-slack (FEALTY) ----------------------------------

describe("capability: conditional-threshold-slack (FEALTY)", () => {
  test("relaxes the printed threshold by a total icon deficit while the condition holds", () => {
    const decep = resourceCard({
      id: "um-decep",
      name: "Deception",
      resource: { provides: ["deception"], staple: true }
    });
    const fealty = character({
      id: "um-fealty",
      name: "Eustace, Sensible Glutton",
      threshold: "dddd",
      thresholdSlack: {
        amount: 3,
        condition: {
          type: "numberCompare",
          left: {
            type: "distinctCount",
            by: "name",
            selector: { controller: "self", type: "resource", staple: true }
          },
          operator: ">=",
          right: 1
        }
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "fealty", def: fealty, owner: P1, zone: "hand" },
        { key: "d1", def: decep, owner: P1 }
      ]
    });

    // One Deception icon vs a "dddd" requirement = 3 short; slack 3 covers it.
    const play = engine.getCardPlayability(P1, id("fealty"));
    assert.equal(play.thresholdMet, true);
  });

  test("does not relax when the condition fails", () => {
    const fealty = character({
      id: "um-fealty2",
      name: "Eustace, Sensible Glutton",
      threshold: "dddd",
      thresholdSlack: {
        amount: 3,
        condition: { type: "numberCompare", left: 0, operator: ">=", right: 1 }
      }
    });
    const { engine, id } = buildGame({
      cards: [{ key: "fealty", def: fealty, owner: P1, zone: "hand" }]
    });
    assert.equal(engine.getCardPlayability(P1, id("fealty")).thresholdMet, false);
  });
});

// --- granted-continuous-ability (God's Blessing) ---------------------------

describe("capability: granted-continuous-ability", () => {
  test("a grantedAbilities block's continuous aura is honored, sourced on the recipient", () => {
    const blessing = item({
      name: "God's Blessing of Boost",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "grant-text",
            type: "continuous",
            modifiers: [],
            grantedAbilities: [
              {
                selector: { type: "character", conditions: [{ type: "isCard", other: "attachedTo" }] },
                abilities: [
                  {
                    id: "boost-aura",
                    type: "continuous",
                    modifiers: [
                      {
                        selector: { controller: "self", type: "character" },
                        stat: "strength",
                        operation: "add",
                        value: 1
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
    const host = character({ name: "Host", strength: 2, life: 3 });
    const ally = character({ name: "Ally", strength: 2, life: 3 });
    const foe = character({ name: "Foe", strength: 2, life: 3 });

    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: host, owner: P1 },
        { key: "ally", def: ally, owner: P1 },
        { key: "foe", def: foe, owner: P2 },
        { key: "blessing", def: blessing, owner: P1, attachedToKey: "host" }
      ]
    });

    // The granted aura is sourced on Host, so it buffs Host's controller's
    // characters (+1) and not the opponent's.
    assert.equal(engine.getStat(id("host"), "strength"), 3);
    assert.equal(engine.getStat(id("ally"), "strength"), 3);
    assert.equal(engine.getStat(id("foe"), "strength"), 2);
  });
});

// --- blocker-selector-restriction ----------------------------------------

describe("capability: blockRestriction.blockerMustNotMatch", () => {
  test("a matching character cannot be declared as a blocker", () => {
    const silencer = character({
      name: "Silencer",
      strength: 2,
      life: 2,
      speed: 5,
      behavior: {
        abilities: [
          {
            id: "no-tokened-blockers",
            type: "continuous",
            modifiers: [],
            blockRestriction: {
              blockerMustNotMatch: {
                type: "character",
                conditions: [
                  { type: "counterCompare", target: { type: "selected", id: "__candidate" }, counter: "token", operator: ">=", value: 1 }
                ]
              }
            }
          }
        ]
      }
    });
    const blockerA = character({ name: "Clean", strength: 2, life: 2 });
    const blockerB = character({ name: "Tokened", strength: 2, life: 2 });

    const { engine, id } = buildGame({
      cards: [
        { key: "sil", def: silencer, owner: P1 },
        { key: "ba", def: blockerA, owner: P2 },
        { key: "bb", def: blockerB, owner: P2, counters: { token: 1 } }
      ],
      activePlayerId: P1
    });

    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("sil")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    // token-bearing blocker is illegal
    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("bb")] })
    );
    // clean blocker is fine
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("ba")] });
  });
});

// --- continuous-void-play ------------------------------------------------

describe("capability: ContinuousAbility.voidPlay", () => {
  test("lets the controller deploy a matching void card while the condition holds", () => {
    const enabler = location({
      name: "Voidal Tactician",
      structure: 3,
      behavior: {
        abilities: [
          {
            id: "void-tactics",
            type: "continuous",
            modifiers: [],
            condition: { type: "cardDepleted", target: "source" },
            voidPlay: {
              ignoreThreshold: true,
              selector: { zone: "void", type: "tactic", owner: "self" }
            }
          }
        ]
      }
    });
    const bomb = tactic({
      name: "Void Bomb",
      threshold: "ooooo",
      behavior: {
        abilities: [
          {
            id: "boom",
            type: "activated",
            costs: [],
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "loc", def: enabler, owner: P1, depleted: true },
        { key: "bomb", def: bomb, owner: P1, zone: "void" }
      ],
      activePlayerId: P1
    });

    const before = engine.state.players[P2].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bomb") });
    // resolve the tactic off the stack
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, before - 3);
  });
});

// --- continuous-play-restriction --------------------------------------------

describe("capability: ContinuousAbility.playRestrictions", () => {
  test("opponents may only play tactics on their own turn (Geldale)", () => {
    const geldale = location({
      name: "Geldale, City-Fortress",
      structure: 5,
      behavior: {
        abilities: [
          {
            id: "no-response-tactics",
            type: "continuous",
            modifiers: [],
            playRestrictions: [
              { player: "opponent", kind: { cardType: "tactic" }, timing: "notActivePlayer" }
            ]
          }
        ]
      }
    });
    const trick = tactic({ name: "Trick", behavior: { abilities: [] } });
    const bait = character({ name: "Bait", strength: 1, life: 1 });

    const { engine, id } = buildGame({
      cards: [
        { key: "gel", def: geldale, owner: P1 },
        { key: "trick", def: trick, owner: P2, zone: "hand" },
        { key: "bait", def: bait, owner: P1, zone: "hand" }
      ],
      activePlayerId: P1
    });

    // P1 plays a character; opponent gets a response window.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bait") });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P2, cardId: id("trick") })
    );
  });
});

// --- continuous-return-to-hand-restriction --------------------------------

describe("capability: ContinuousAbility.restrictReturnToHand", () => {
  test("a card owned by the restricted player cannot be moved to hand from a listed zone", () => {
    const lockbox = item({
      name: "Lockbox of the Aeons",
      behavior: {
        abilities: [
          {
            id: "no-recur",
            type: "continuous",
            modifiers: [],
            restrictReturnToHand: { player: "opponent", fromZones: ["discard"] }
          }
        ]
      }
    });
    const grabber = character({
      name: "Grabber",
      behavior: {
        abilities: [
          {
            id: "recur",
            type: "activated",
            costs: [],
            targets: [
              { id: "pick", count: 1, selector: { owner: "self", zone: "discard", type: "character" } }
            ],
            effects: [{ type: "moveCard", target: { type: "selected", id: "pick" }, to: "hand" }]
          }
        ]
      }
    });
    const junk = character({ name: "Junk", strength: 1, life: 1 });

    const { engine, id } = buildGame({
      cards: [
        { key: "lock", def: lockbox, owner: P1 },
        { key: "grab", def: grabber, owner: P2 },
        { key: "junk", def: junk, owner: P2, zone: "discard" }
      ],
      activePlayerId: P2
    });

    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("grab"),
      abilityId: "recur",
      selected: { pick: [id("junk")] }
    });
    resolvePendingResponses(engine);
    // The move fizzled — Junk is still in the discard pile.
    assert.equal(engine.state.cards[id("junk")].zone, "discard");
  });
});

// --- prevent-all-damage-window -------------------------------------------

describe("capability: preventAllDamage effect", () => {
  test("reduces every damage instance to 0 for its duration", () => {
    const shield = tactic({
      name: "Limited Liability",
      behavior: {
        abilities: [
          {
            id: "shield",
            type: "activated",
            costs: [],
            effects: [{ type: "preventAllDamage", duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const gun = character({
      name: "Gun",
      behavior: {
        abilities: [
          {
            id: "shoot",
            type: "activated",
            costs: [],
            targets: [{ id: "t", count: 1, selector: { controller: "opponent", type: "character" } }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }]
          }
        ]
      }
    });
    const victim = character({ name: "Victim", strength: 1, life: 4 });

    const { engine, id } = buildGame({
      cards: [
        { key: "shield", def: shield, owner: P1, zone: "hand" },
        { key: "gun", def: gun, owner: P1 },
        { key: "victim", def: victim, owner: P2 }
      ],
      activePlayerId: P1
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("shield") });
    resolvePendingResponses(engine);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("gun"), abilityId: "shoot", selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("victim")].damage, 0);
  });
});

// --- restrict-destruction-window --------------------------------------------

describe("capability: restrictDestruction effect", () => {
  test("the destroy effect is inert but a destroy cost still works", () => {
    const decree = tactic({
      name: "Limited Liability",
      behavior: {
        abilities: [
          {
            id: "decree",
            type: "activated",
            costs: [],
            effects: [{ type: "restrictDestruction", duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const nuke = character({
      name: "Nuke",
      behavior: {
        abilities: [
          {
            id: "effect-destroy",
            type: "activated",
            costs: [],
            targets: [{ id: "t", count: 1, selector: { controller: "opponent", type: "character" } }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          },
          {
            id: "cost-destroy",
            type: "activated",
            costs: [{ type: "destroy", target: { type: "selected", id: "c" } }],
            targets: [{ id: "c", count: 1, selector: { controller: "self", type: "character" } }],
            effects: []
          }
        ]
      }
    });
    const target = character({ name: "Target", strength: 1, life: 2 });
    const fodder = character({ name: "Fodder", strength: 1, life: 2 });

    const { engine, id } = buildGame({
      cards: [
        { key: "decree", def: decree, owner: P1, zone: "hand" },
        { key: "nuke", def: nuke, owner: P1 },
        { key: "fodder", def: fodder, owner: P1 },
        { key: "target", def: target, owner: P2 }
      ],
      activePlayerId: P1
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("decree") });
    resolvePendingResponses(engine);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("nuke"), abilityId: "effect-destroy", selected: { t: [id("target")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("target")].zone, "play", "destroy effect is inert");

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("nuke"), abilityId: "cost-destroy", selected: { c: [id("fodder")] } });
    resolvePendingResponses(engine);
    assert.notEqual(engine.state.cards[id("fodder")].zone, "play", "destroy cost still works");
  });
});
