// Unit tests for the engine capabilities added for the 1st Edition Part 2
// set coverage pass. One test per capability primitive; card-shaped
// end-to-end scenarios live in first-ed-part2-smoke.test.ts.
// See COVERAGE.md's capability backlog.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  autoResolveBattle,
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import { settleTurnStart } from "./support/develop.js";

// --- battlePartySize expression -------------------------------------------

describe("capability: battlePartySize expression", () => {
  test("triggers off the size of the attacking party the source is in", () => {
    const liege = character({
      name: "Callow Liegeman",
      strength: 2,
      life: 2,
      behavior: {
        abilities: [
          {
            id: "rally",
            type: "triggered",
            event: "characterAttacked",
            condition: {
              type: "and",
              conditions: [
                { type: "sourceIsEventCard" },
                {
                  type: "numberCompare",
                  left: { type: "battlePartySize", side: "attacking" },
                  operator: ">",
                  right: 1
                }
              ]
            },
            effects: [
              {
                type: "createModifier",
                target: "source",
                stat: "strength",
                operation: "add",
                value: 1,
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });
    const buddy = character({ name: "Buddy", strength: 2, life: 2 });

    const { engine, id } = buildGame({
      cards: [
        { key: "liege", def: liege, owner: P1 },
        { key: "buddy", def: buddy, owner: P1 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("liege"), id("buddy")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.getStat(id("liege"), "strength"), 3);
  });

  test("is 1 for a solo attacker and 0 with no battle", () => {
    const solo = character({
      name: "Solo",
      behavior: {
        abilities: [
          {
            id: "read",
            type: "activated",
            effects: [
              {
                type: "createModifier",
                target: "source",
                stat: "strength",
                operation: "add",
                value: { type: "battlePartySize", side: "ownParty" },
                duration: { type: "permanent" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "solo", def: solo, owner: P1 }]
    });

    // no battle -> 0
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("solo"), abilityId: "read" });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("solo"), "strength"), 1);
  });
});

// --- extremumStat expression ---------------------------------------------

describe("capability: extremumStat expression", () => {
  test("max/min of a live stat over a selector", () => {
    const reader = character({
      name: "Reader",
      behavior: {
        abilities: [
          {
            id: "peak",
            type: "activated",
            effects: [
              {
                type: "createModifier",
                target: "source",
                stat: "strength",
                operation: "add",
                value: {
                  type: "extremumStat",
                  selector: { controller: "opponent", type: "character" },
                  stat: "speed",
                  direction: "max"
                },
                duration: { type: "permanent" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "reader", def: reader, owner: P1 },
        { key: "slow", def: character({ name: "Slow", speed: 2 }), owner: P2 },
        { key: "fast", def: character({ name: "Fast", speed: 5 }), owner: P2 }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("reader"), abilityId: "peak" });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("reader"), "strength"), 1 + 5);
  });
});

// --- isCard condition --------------------------------------------------------

describe("capability: isCard condition", () => {
  test("pins a damageModifiers selector to the attached character", () => {
    const chucks = item({
      name: "Swordchucks",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "sharpen",
            type: "continuous",
            modifiers: [],
            damageModifiers: [
              {
                selector: {
                  type: "character",
                  conditions: [{ type: "isCard", other: "attachedTo" }]
                },
                delta: 2
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "bearer", def: character({ name: "Bearer", life: 10 }), owner: P1 },
        { key: "other", def: character({ name: "Other", life: 10 }), owner: P1 },
        { key: "chucks", def: chucks, owner: P1, attachedToKey: "bearer" },
        {
          key: "zapper",
          def: character({
            name: "Zapper",
            behavior: {
              abilities: [
                {
                  id: "zap",
                  type: "activated",
                  targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
                  effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
                }
              ]
            }
          }),
          owner: P2
        }
      ],
      activePlayerId: P2
    });

    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("zapper"),
      abilityId: "zap",
      selected: { t: [id("bearer")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("bearer")].damage, 3);

    engine.state.cards[id("zapper")].depleted = false;
    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("zapper"),
      abilityId: "zap",
      selected: { t: [id("other")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("other")].damage, 1);
  });
});

// --- attachmentHost TargetRef ---------------------------------------------

describe("capability: attachmentHost TargetRef", () => {
  test("resolves to the host of a picked attachment", () => {
    const gear = item({ name: "Gear", attachTo: "character" });
    const spell = tactic({
      name: "Scorching Runicution",
      behavior: {
        abilities: [
          {
            id: "burn",
            type: "activated",
            targets: [{ id: "g", selector: { type: "item" }, count: 1 }],
            effects: [
              {
                type: "dealDamage",
                target: { type: "attachmentHost", target: { type: "selected", id: "g" } },
                amount: 3
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", life: 10 }), owner: P1 },
        { key: "gear", def: gear, owner: P1, attachedToKey: "host" },
        { key: "spell", def: spell, owner: P1, zone: "hand" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("spell"),
      selected: { g: [id("gear")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("host")].damage, 3);
  });
});

// --- nameVar selector ----------------------------------------------------

describe("capability: CardSelector.nameVar", () => {
  test("matches a card name against a stored nameValue", () => {
    const diva = character({
      name: "Odious Diva",
      behavior: {
        abilities: [
          {
            id: "disapprove",
            type: "activated",
            effects: [
              { type: "nameValue", chooser: "controller", valueKind: "cardName", storeAs: "named" },
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: {
                  id: "x",
                  selector: { owner: "opponent", zone: "hand", nameVar: "named" },
                  count: 1,
                  optional: true
                },
                effects: [
                  { type: "moveCard", target: { type: "selected", id: "x" }, to: "deck", position: "bottom" }
                ]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "diva", def: diva, owner: P1 },
        { key: "wanted", def: tactic({ name: "Wanted" }), owner: P2, zone: "hand" },
        { key: "safe", def: tactic({ name: "Safe" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("diva"), abilityId: "disapprove" });
    resolvePendingResponses(engine);
    // nameValue pause
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "nameValue", value: "Wanted" }
    });
    // chooserSelectsTarget pause — only "Wanted" is a legal candidate
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("wanted")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("wanted")].zone, "deck");
  });
});

// --- respondedAbilitySource TargetRef -----------------------------------

describe("capability: respondedAbilitySource TargetRef", () => {
  test("resolves the source card of the responded-to ability", () => {
    const pinger = character({
      name: "Pinger",
      behavior: {
        abilities: [
          {
            id: "ping",
            type: "activated",
            effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }]
          }
        ]
      }
    });
    const puppet = tactic({
      name: "Exploding Sock Puppet!",
      behavior: {
        noResponse: true,
        abilities: [
          {
            id: "boom",
            type: "activated",
            condition: { type: "respondingTo", respondsTo: "ability" },
            effects: [
              { type: "terminate", scope: "respondedItem" },
              { type: "destroy", target: { type: "respondedAbilitySource" } }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "pinger", def: pinger, owner: P2 },
        { key: "puppet", def: puppet, owner: P1, zone: "hand" }
      ],
      activePlayerId: P2
    });

    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("pinger"), abilityId: "ping" });
    // P1 responds with the puppet
    engine.perform({ type: "playCard", playerId: P1, cardId: id("puppet") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("pinger")].zone, "discard");
    // the ping was terminated -> no influence lost
    assert.equal(engine.state.players[P1].influence, engine.getFactionDefinition(P1)!.startingInfluence);
  });
});

// --- terminate disposition ---------------------------------------------------

describe("capability: terminate disposition:'hand'", () => {
  test("a terminated card goes to its owner's hand", () => {
    const spell = tactic({ name: "Big Spell" });
    const counter = tactic({
      name: "Voidal Interference",
      behavior: {
        abilities: [
          {
            id: "stop",
            type: "activated",
            condition: { type: "respondingTo", cardType: "tactic" },
            effects: [
              { type: "terminate", scope: "respondedItem", disposition: "hand" }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "spell", def: spell, owner: P1, zone: "hand" },
        { key: "counter", def: counter, owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("counter") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("spell")].zone, "hand");
  });
});

// --- damagedThisTurn condition ------------------------------------------

describe("capability: damagedThisTurn condition", () => {
  test("true when the source damaged the event card earlier this turn", () => {
    const engineCard = character({
      name: "Gore Engine",
      strength: 3,
      behavior: {
        abilities: [
          {
            id: "feed",
            type: "triggered",
            event: "cardDestroyed",
            condition: { type: "damagedThisTurn", target: "eventCard" },
            effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]
          },
          {
            id: "zap",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
          }
        ]
      }
    });
    const victim = character({ name: "Victim", life: 2 });

    const { engine, id } = buildGame({
      cards: [
        { key: "engine", def: engineCard, owner: P1 },
        { key: "victim", def: victim, owner: P2 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("engine"),
      abilityId: "zap",
      selected: { t: [id("victim")] }
    });
    resolvePendingResponses(engine);
    // finish it off with a second point of damage from elsewhere
    engine.state.cards[id("engine")].depleted = false;
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("engine"),
      abilityId: "zap",
      selected: { t: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "discard");
    assert.equal(engine.state.cards[id("engine")].counters.token ?? 0, 1);
  });
});

// --- destroyedByBattleDamage condition --------------------------------

describe("capability: destroyedByBattleDamage condition", () => {
  test("fires only when the lethal instance was battle damage", () => {
    const spider = character({
      name: "Venomous Sacspider",
      strength: 1,
      life: 2,
      behavior: {
        abilities: [
          {
            id: "spite",
            type: "triggered",
            event: "cardDestroyed",
            condition: {
              type: "and",
              conditions: [{ type: "sourceIsEventCard" }, { type: "destroyedByBattleDamage" }]
            },
            effects: [
              {
                type: "forEach",
                selector: { owner: "opponent", zone: "hand" },
                effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "spider", def: spider, owner: P1, attackEligible: true },
        { key: "killer", def: character({ name: "Killer", strength: 5, life: 5 }), owner: P2 },
        { key: "h1", def: tactic({ name: "H1" }), owner: P2, zone: "hand" },
        { key: "h2", def: tactic({ name: "H2" }), owner: P2, zone: "hand" }
      ],
      activePlayerId: P1
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("spider")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("killer")] });
    autoResolveBattle(engine);

    assert.equal(engine.state.cards[id("spider")].zone, "discard");
    assert.equal(engine.state.cards[id("h1")].zone, "discard");
    assert.equal(engine.state.cards[id("h2")].zone, "discard");
  });
});

// --- lockAbilityThisTurn effect ---------------------------------------

describe("capability: lockAbilityThisTurn effect", () => {
  test("bars re-activation of the responded-to ability this turn", () => {
    const drawer = character({
      name: "Drawer",
      behavior: {
        abilities: [
          {
            id: "draw2",
            type: "activated",
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const stopper = tactic({
      name: "Subsection 5",
      behavior: {
        noResponse: true,
        abilities: [
          {
            id: "stop",
            type: "activated",
            condition: { type: "respondingTo", respondsTo: "ability" },
            effects: [
              { type: "terminate", scope: "respondedItem" },
              { type: "lockAbilityThisTurn", target: "respondedAbility" }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "drawer", def: drawer, owner: P2 },
        { key: "stopper", def: stopper, owner: P1, zone: "hand" },
        ...Array.from({ length: 5 }, (_, i) => ({
          key: `d${i}`,
          def: tactic({ name: `D${i}` }),
          owner: P2,
          zone: "deck" as const
        }))
      ],
      activePlayerId: P2
    });

    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("drawer"), abilityId: "draw2" });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("stopper") });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P2, cardId: id("drawer"), abilityId: "draw2" })
    );
  });
});

// --- deployForFree free:false -------------------------------------------

describe("capability: deployForFree free:false", () => {
  test("the player still pays the deployed card's numeric cost", () => {
    const guy = character({ name: "Recruit", cost: 2 });
    const late = tactic({
      name: "Late Addition",
      behavior: {
        abilities: [
          {
            id: "add",
            type: "activated",
            effects: [
              { type: "deployForFree", player: "controller", maxCost: 99, free: false, selector: { type: "character" } },
              { type: "draw", player: "controller", amount: 1 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "late", def: late, owner: P1, zone: "hand" },
        { key: "guy", def: guy, owner: P1, zone: "hand" },
        { key: "d0", def: tactic({ name: "D0" }), owner: P1, zone: "deck" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "play" },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1, zone: "play" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("late") });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "deployForFree", cardId: id("guy") }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("guy")].zone, "play");
    // both resources attached to pay the cost of 2
    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });
});

// --- conditional-damage-prevention (minAmount / setTo) -----------------

describe("capability: DamageModifierDefinition minAmount/setTo", () => {
  test("damage above the threshold is clamped, smaller hits pass through", () => {
    const defender = character({
      name: "Class Action Defender",
      life: 3,
      behavior: {
        abilities: [
          {
            id: "cap",
            type: "continuous",
            modifiers: [],
            damageModifiers: [
              {
                selector: { type: "character", conditions: [{ type: "isCard" }] },
                delta: 0,
                minAmount: 5,
                setTo: 0
              }
            ]
          }
        ]
      }
    });
    const zap = tactic({
      name: "Zap",
      behavior: {
        abilities: [
          {
            id: "z",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            variables: { n: { type: "variable", id: "n" } },
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: { type: "variable", id: "n" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "def", def: defender, owner: P1 },
        { key: "zap1", def: zap, owner: P2, zone: "hand" },
        { key: "zap2", def: zap, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });

    engine.perform({
      type: "playCard",
      playerId: P2,
      cardId: id("zap1"),
      selected: { t: [id("def")] },
      variables: { n: 5 }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("def")].damage, 0);

    engine.perform({
      type: "playCard",
      playerId: P2,
      cardId: id("zap2"),
      selected: { t: [id("def")] },
      variables: { n: 2 }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("def")].damage, 2);
  });
});

// --- party-composition-restriction ------------------------------------

describe("capability: ContinuousAbility.partyRestriction", () => {
  test("rejects an odd-sized attacking party that includes the source", () => {
    const bug = character({
      name: "Insect Appreciator",
      strength: 2,
      behavior: {
        abilities: [
          {
            id: "even",
            type: "continuous",
            modifiers: [],
            partyRestriction: { role: "any", parity: "even" }
          }
        ]
      }
    });
    const a = character({ name: "A", strength: 2 });
    const b = character({ name: "B", strength: 2 });

    const { engine, id } = buildGame({
      cards: [
        { key: "bug", def: bug, owner: P1 },
        { key: "a", def: a, owner: P1 },
        { key: "b", def: b, owner: P1 }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("bug"), id("a"), id("b")],
        target: { type: "faction", playerId: P2 }
      })
    );

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("bug"), id("a")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    assert.ok(engine.state.battle, "engine.state.battle");
  });
});

// --- block-eligibility-restriction ------------------------------------

describe("capability: ContinuousAbility.blockRestriction", () => {
  test("only fast-enough characters may block", () => {
    const boars = character({
      name: "Wild Boars",
      strength: 2,
      life: 2,
      speed: 4,
      behavior: {
        abilities: [
          {
            id: "swift",
            type: "continuous",
            modifiers: [],
            blockRestriction: { minBlockerSpeed: { type: "stat", target: "source", stat: "speed" } }
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "boars", def: boars, owner: P1, attackEligible: true },
        { key: "slow", def: character({ name: "Slowpoke", speed: 2, life: 5 }), owner: P2 },
        { key: "fast", def: character({ name: "Speedy", speed: 5, life: 5 }), owner: P2 }
      ],
      activePlayerId: P1
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("boars")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("slow")] })
    );
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("fast")] });
    autoResolveBattle(engine);
  });
});

// --- restrictBlockers effect (the "this turn" form) -------------------

describe("capability: restrictBlockers effect", () => {
  test("this-turn minimum blocking-party size, gated by a condition", () => {
    const leo = character({
      name: "LeoKaiser",
      strength: 3,
      life: 3,
      behavior: {
        abilities: [
          {
            id: "mega",
            type: "activated",
            effects: [
              {
                type: "restrictBlockers",
                target: "source",
                minPartySize: 3,
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "leo", def: leo, owner: P1, attackEligible: true },
        { key: "b1", def: character({ name: "B1", life: 5 }), owner: P2 },
        { key: "b2", def: character({ name: "B2", life: 5 }), owner: P2 }
      ],
      activePlayerId: P1
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("leo"), abilityId: "mega" });
    resolvePendingResponses(engine);

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("leo")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("b1"), id("b2")] })
    );
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
  });
});

// --- restrictBlockersToChosen effect ---------------------------------

describe("capability: restrictBlockersToChosen effect", () => {
  test("only the attacker-chosen characters may block", () => {
    const wyrm = character({
      name: "Wyrmfang Deathskull",
      strength: 3,
      life: 6,
      behavior: {
        abilities: [
          {
            id: "dictate",
            type: "triggered",
            event: "characterAttacked",
            condition: { type: "sourceIsEventCard" },
            effects: [
              {
                type: "restrictBlockersToChosen",
                chooser: "opponent",
                declaration: {
                  id: "blk",
                  selector: { controller: "self", type: "character" },
                  count: 9,
                  optional: true
                }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "wyrm", def: wyrm, owner: P1, attackEligible: true },
        { key: "x", def: character({ name: "X", life: 5 }), owner: P2 },
        { key: "y", def: character({ name: "Y", life: 5 }), owner: P2 }
      ],
      activePlayerId: P1
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("wyrm")],
      target: { type: "faction", playerId: P2 }
    });
    // the characterAttacked trigger pauses for P2 to choose
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "chooseChosenBlockers", cardIds: [id("x")] }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("y")] })
    );
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("x")] });
    autoResolveBattle(engine);
  });
});

// --- coin-flip -------------------------------------------------------------

describe("capability: flipCoin effect + coinFlip replacement", () => {
  test("runs the winning branch on a win", () => {
    const flipper = character({
      name: "Fwing!",
      behavior: {
        abilities: [
          {
            id: "flip",
            type: "activated",
            effects: [
              {
                type: "flipCoin",
                winEffects: [{ type: "addCounter", target: "source", counter: "win", amount: 1 }],
                loseEffects: [{ type: "addCounter", target: "source", counter: "lose", amount: 1 }]
              }
            ]
          }
        ]
      }
    });

    // rng that always yields < 0.5 -> a win
    const { engine, id } = buildGame({
      cards: [{ key: "f", def: flipper, owner: P1 }],
      random: () => 0.1
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("f"), abilityId: "flip" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("f")].counters.win ?? 0, 1);
    assert.equal(engine.state.cards[id("f")].counters.lose ?? 0, 0);
  });

  test("Two-Headed Coin's replacement offers a reflip on a loss", () => {
    const coin = item({
      name: "Two-Headed Coin",
      behavior: {
        abilities: [
          {
            id: "reflip",
            type: "replacement",
            replaces: { event: "coinFlip", result: "lose" },
            optional: true,
            optionalCost: [{ type: "deplete", target: "source" }],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const flipper = tactic({
      name: "Flippy",
      behavior: {
        abilities: [
          {
            id: "flip",
            type: "activated",
            effects: [
              {
                type: "flipCoin",
                winEffects: [{ type: "modifyInfluence", player: "controller", amount: 1 }],
                loseEffects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
              }
            ]
          }
        ]
      }
    });

    let calls = 0;
    // first flip loses (>=0.5), reflip wins (<0.5)
    const { engine, id } = buildGame({
      cards: [
        { key: "coin", def: coin, owner: P1 },
        { key: "flip", def: flipper, owner: P1, zone: "hand" },
        { key: "d0", def: tactic({ name: "D0" }), owner: P1, zone: "deck" }
      ],
      random: () => (calls++ === 0 ? 0.9 : 0.1)
    });

    const before = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("flip") });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "coinFlipReplace", reflip: true }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("coin")].depleted, true);
    assert.equal(engine.state.players[P1].influence, before + 1);
    assert.equal(engine.state.players[P1].hand.length, 1);
  });
});

// --- takecontrol-duration ----------------------------------------------

describe("capability: takeControl duration", () => {
  test("control reverts at the start-of-turn sweep", () => {
    const grab = tactic({
      name: "Mutiny Grant",
      behavior: {
        abilities: [
          {
            id: "grab",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }],
            effects: [
              {
                type: "takeControl",
                target: { type: "selected", id: "t" },
                controller: "controller",
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "grab", def: grab, owner: P1, zone: "hand" },
        { key: "minion", def: character({ name: "Minion" }), owner: P2 }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("grab"),
      selected: { t: [id("minion")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("minion")].controllerId, P1);
    assert.ok(engine.state.players[P1].play.includes(id("minion")), "engine.state.players[P1].play.includes(id(\"minion\"))");

    // end P1's turn, then end P2's turn -> back to P1's start-of-turn sweep
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    assert.equal(engine.state.cards[id("minion")].controllerId, P2);
    assert.ok(engine.state.players[P2].play.includes(id("minion")), "engine.state.players[P2].play.includes(id(\"minion\"))");
  });
});

// --- ability-cost-modifier -------------------------------------------

describe("capability: ContinuousAbility.abilityCostModifiers", () => {
  test("reduces a faction ability's payResources cost, floored at minCost", () => {
    const fumast = location({
      name: "F.U.M.A.S.T.",
      behavior: {
        abilities: [
          {
            id: "discount",
            type: "continuous",
            modifiers: [],
            abilityCostModifiers: [{ scope: "factionAbilities", delta: -1, minCost: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      playerA: {
        faction: factionCard({
          name: "P1 Faction",
          faction: defaultFactionDefinition({
            abilities: [
              {
                id: "fdraw",
                type: "activated",
                costs: [{ type: "payResources", amount: 2 }],
                effects: [{ type: "draw", player: "controller", amount: 1 }]
              }
            ]
          })
        })
      },
      cards: [
        { key: "fumast", def: fumast, owner: P1 },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "play" },
        { key: "d0", def: tactic({ name: "D0" }), owner: P1, zone: "deck" }
      ]
    });

    const factionId = engine.state.players[P1].factionId!;
    // cost is 2 - 1 = 1, so a single resource pays it
    engine.perform({ type: "activateAbility", playerId: P1, cardId: factionId, abilityId: "fdraw" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, 1);
    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });
});

// --- copy-rules-text (grantAbilitiesFrom) ----------------------------

describe("capability: grantAbilitiesFrom effect", () => {
  test("the target gains the source card's activated abilities", () => {
    const donor = character({
      name: "Donor",
      behavior: {
        abilities: [
          {
            id: "gift",
            type: "activated",
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const thief = character({
      name: "Skin Suit Survivor",
      behavior: {
        abilities: [
          {
            id: "steal",
            type: "activated",
            targets: [{ id: "d", selector: { type: "character" }, count: 1 }],
            effects: [
              { type: "grantAbilitiesFrom", target: "source", from: { type: "selected", id: "d" } }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "thief", def: thief, owner: P1 },
        { key: "donor", def: donor, owner: P1 },
        { key: "d0", def: tactic({ name: "D0" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("thief"),
      abilityId: "steal",
      selected: { d: [id("donor")] }
    });
    resolvePendingResponses(engine);

    engine.state.cards[id("thief")].depleted = false;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("thief"), abilityId: "gift" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, 1);
  });
});

// --- initiate-attack-effect ------------------------------------------

describe("capability: initiateAttack effect", () => {
  test("Counter Attack resolves a full battle mid-effect, then draws", () => {
    const counter = tactic({
      name: "Counter Attack",
      behavior: {
        abilities: [
          {
            id: "ca",
            type: "activated",
            targets: [
              {
                id: "atk",
                selector: { controller: "self", type: "character" },
                count: 9,
                optional: true
              }
            ],
            effects: [
              { type: "initiateAttack", attackerSelection: "atk", target: "opponent" },
              { type: "draw", player: "controller", amount: 1 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "counter", def: counter, owner: P2, zone: "hand" },
        { key: "striker", def: character({ name: "Striker", strength: 4 }), owner: P2 },
        { key: "d0", def: tactic({ name: "D0" }), owner: P2, zone: "deck" }
      ],
      activePlayerId: P2
    });

    const before = engine.state.players[P1].influence;

    engine.perform({
      type: "playCard",
      playerId: P2,
      cardId: id("counter"),
      selected: { atk: [id("striker")] }
    });
    resolvePendingResponses(engine);

    // battle should be underway with P2 as attacker
    assert.ok(engine.state.battle, "engine.state.battle");
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.players[P1].influence, before - 4);
    // the "draw a card" rider fired after the battle
    assert.equal(engine.state.players[P2].hand.length, 1);
    assert.equal(engine.state.cards[id("counter")].zone, "discard");
  });
});

// --- bid-auction ---------------------------------------------------------

describe("capability: auctionForCard effect", () => {
  test("the high bidder pays detached resources and gets the character", () => {
    const house = location({
      name: "Auction House",
      behavior: {
        abilities: [
          {
            id: "auction",
            type: "triggered",
            event: "turnStarted",
            effects: [{ type: "auctionForCard", revealFor: "controller" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "house", def: house, owner: P1 },
        { key: "prize", def: character({ name: "Prize", strength: 5 }), owner: P1, zone: "deck" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "play" },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1, zone: "play" },
        { key: "r3", def: resourceCard({ name: "R3" }), owner: P2, zone: "play" }
      ],
      activePlayerId: P2,
      turn: 2
    });

    // end P2's turn -> P1's turnStarted fires the auction
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    // P1 (active, bids first) bids 2
    assert.equal(engine.state.pendingChoice?.kind, "auctionBid");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "auctionBid", bid: 2 }
    });
    // P2 can only afford 1 -> passes
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "auctionBid", bid: 0 }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("prize")].zone, "play");
    assert.equal(engine.state.cards[id("prize")].controllerId, P1);
    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });
});
