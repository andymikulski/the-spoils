// Unit tests for the engine capabilities added for the Holy Heist set
// coverage pass. One test per capability primitive (the card-shaped
// integration lives in holy-heist-smoke.test.ts / card-behaviors.test.ts).
// See COVERAGE.md's capability backlog.

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
import type { CardDefinition } from "../../engine.js";

// --- healDamage --------------------------------------------------------------

describe("capability: healDamage effect", () => {
  test("removes up to N damage markers, floored at 0", () => {
    const wall = location({
      name: "Patch Job",
      structure: 10,
      behavior: {
        abilities: [
          {
            id: "patch",
            type: "activated",
            costs: [{ type: "deplete", target: "source" }],
            effects: [{ type: "healDamage", target: "source", amount: 2 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "wall", def: wall, owner: P1, zone: "play", damage: 3 }]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("wall"),
      abilityId: "patch"
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("wall")].damage, 1);

    // restore + re-activate: 1 - 2 clamps at 0, not negative
    engine.state.cards[id("wall")].depleted = false;
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("wall"),
      abilityId: "patch"
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("wall")].damage, 0);
  });
});

// --- Duration.untilStartOfNextTurn -----------------------------------------

describe("capability: untilStartOfNextTurn duration", () => {
  test("a modifier survives the opponent's turn, expires at the start of your next", () => {
    const buffer = character({
      name: "Self Buffer",
      strength: 2,
      behavior: {
        abilities: [
          {
            id: "buff",
            type: "activated",
            effects: [
              {
                type: "createModifier",
                target: "source",
                stat: "strength",
                operation: "add",
                value: 3,
                duration: { type: "untilStartOfNextTurn" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "buf", def: buffer, owner: P1, zone: "play" }]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("buf"),
      abilityId: "buff"
    });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("buf"), "strength"), 5);

    // P1 -> P2's turn: still active (unlike untilEndOfTurn)
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("buf"), "strength"), 5, "survives opponent turn");

    // P2 -> P1's turn: swept at this start-of-turn point
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("buf"), "strength"), 2, "expires at start of your next turn");
  });
});

// --- ActivatedAbility.usableBy: "opponent" --------------------------------

describe("capability: usableBy 'opponent'", () => {
  const gizmo = (): CardDefinition =>
    item({
      name: "Opp-Only Gizmo",
      behavior: {
        abilities: [
          {
            id: "reset",
            type: "activated",
            usableBy: "opponent",
            costs: [{ type: "payResources", amount: 0 }],
            effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
          }
        ]
      }
    });

  test("hidden from the controller, offered to and usable by the opponent", () => {
    // P2's turn so P2 has the priority/timing to use an ability at all.
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [{ key: "g", def: gizmo(), owner: P1, zone: "play" }]
    });

    const oppSees = engine
      .getAvailableActivatedAbilities(P2)
      .some(a => a.cardId === id("g") && a.ability.id === "reset");
    assert.equal(oppSees, true, "opponent can use it");

    const before = engine.state.players[P2].influence;
    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("g"),
      abilityId: "reset"
    });
    resolvePendingResponses(engine);
    // resolves under the opponent (P2) — `controller` in the effect is P2
    assert.equal(engine.state.players[P2].influence, before - 1);
  });

  test("hidden from the controller even on the controller's own turn", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [{ key: "g", def: gizmo(), owner: P1, zone: "play" }]
    });

    const ownerSees = engine
      .getAvailableActivatedAbilities(P1)
      .some(a => a.cardId === id("g"));
    assert.equal(ownerSees, false, "controller cannot use it");

    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("g"),
        abilityId: "reset"
      })
    );
  });
});

// --- hasKeyword condition -------------------------------------------------

describe("capability: hasKeyword condition", () => {
  const gatedAbility = {
    id: "sneaky",
    type: "activated" as const,
    condition: { type: "hasKeyword" as const, target: "source" as const, keyword: "covert" as const },
    effects: [{ type: "modifyInfluence" as const, player: "controller" as const, amount: 1 }]
  };

  test("gates an ability on the source currently having the keyword", () => {
    const covertGuy = character({ name: "Covert Guy", behavior: { keywords: ["covert"], abilities: [gatedAbility] } });
    const plainGuy = character({ name: "Plain Guy", behavior: { abilities: [gatedAbility] } });

    const { engine, id } = buildGame({
      cards: [
        { key: "covert", def: covertGuy, owner: P1, zone: "play" },
        { key: "plain", def: plainGuy, owner: P1, zone: "play" }
      ]
    });

    assert.equal(
      engine.getAvailableActivatedAbilities(P1).some(a => a.cardId === id("covert")),
      true
    );
    assert.equal(
      engine.getAvailableActivatedAbilities(P1).some(a => a.cardId === id("plain")),
      false
    );
  });
});

// --- scheduleEffect when: "startOfOpponentNextTurn" ---------------------

describe("capability: scheduleEffect startOfOpponentNextTurn", () => {
  test("fires at the start of the immediately following (opponent's) turn", () => {
    const bomb = character({
      name: "Time Bomb",
      behavior: {
        abilities: [
          {
            id: "arm",
            type: "activated",
            effects: [
              {
                type: "scheduleEffect",
                when: "startOfOpponentNextTurn",
                effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "bomb", def: bomb, owner: P1, zone: "play" }]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("bomb"),
      abilityId: "arm"
    });
    resolvePendingResponses(engine);

    const p2Before = engine.state.players[P2].influence;
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    // now P2's turn — the scheduled effect fired against P2's faction
    assert.equal(engine.state.players[P2].influence, p2Before - 3);
  });
});

// --- grantKeywordToPlayer effect --------------------------------------------

describe("capability: grantKeywordToPlayer effect", () => {
  test("grants a keyword to every character the player controls (live-checked)", () => {
    const banner = character({
      name: "Rally Banner",
      behavior: {
        abilities: [
          {
            id: "rally",
            type: "activated",
            effects: [
              {
                type: "grantKeywordToPlayer",
                player: "controller",
                keyword: "aggro",
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "banner", def: banner, owner: P1, zone: "play" },
        { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play", attackEligible: false },
        { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", attackEligible: false }
      ]
    });

    assert.equal(engine.hasKeyword(id("ally"), "aggro"), false);

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("banner"),
      abilityId: "rally"
    });
    resolvePendingResponses(engine);

    assert.equal(engine.hasKeyword(id("ally"), "aggro"), true, "own character gains it");
    assert.equal(engine.hasKeyword(id("foe"), "aggro"), false, "opponent's does not");

    // expires with the turn
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.hasKeyword(id("ally"), "aggro"), false);
  });
});

// --- cardsDiscarded event -------------------------------------------------

describe("capability: cardsDiscarded event", () => {
  test("fires once per discarded card; a per-event buff sums (Bewilderbeast shape)", () => {
    const beast = character({
      name: "Discard Beast",
      strength: 3,
      life: 3,
      behavior: {
        abilities: [
          {
            id: "feed",
            type: "triggered",
            event: "cardsDiscarded",
            condition: { type: "eventPlayerIs", player: "opponent" },
            effects: [
              { type: "createModifier", target: "source", stat: "strength", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } },
              { type: "createModifier", target: "source", stat: "life", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    });

    const mill = item({
      name: "Make Them Discard",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "opponent",
                declaration: { id: "disc", selector: { controller: "opponent", zone: "hand" }, count: 2 },
                effects: [
                  { type: "forEach", selected: "disc", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }
                ]
              }
            ]
          }
        ]
      }
    });

    const junk = (n: number): CardDefinition => character({ name: `Junk ${n}` });

    const { engine, id } = buildGame({
      cards: [
        { key: "beast", def: beast, owner: P1, zone: "play" },
        { key: "mill", def: mill, owner: P1, zone: "play" },
        { key: "j1", def: junk(1), owner: P2, zone: "hand" },
        { key: "j2", def: junk(2), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("mill"),
      abilityId: "go"
    });
    resolvePendingResponses(engine);

    // opponent picks both hand cards to discard
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "chooserSelectsTarget", selected: [id("j1"), id("j2")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("j1")].zone, "discard");
    assert.equal(engine.state.cards[id("j2")].zone, "discard");
    assert.equal(engine.getStat(id("beast"), "strength"), 5, "+1 per discarded card");
    assert.equal(engine.getStat(id("beast"), "life"), 5);
  });
});

// --- mustBePicked restriction -------------------------------------------

describe("capability: mustBePicked restriction", () => {
  test("collapses a mandatory target pool to the forced card, auto-resolving it", () => {
    // "Marked" grants itself mustBePicked via an always-on continuous ability.
    const marked = character({
      name: "Marked",
      behavior: {
        abilities: [
          {
            id: "lure",
            type: "continuous",
            modifiers: [],
            restrictions: [{ target: "source", restriction: "mustBePicked" }]
          }
        ]
      }
    });

    const sniper = item({
      name: "Auto Sniper",
      behavior: {
        abilities: [
          {
            id: "snipe",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "deplete", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "sniper", def: sniper, owner: P1, zone: "play" },
        { key: "plain", def: character({ name: "Plain Bystander" }), owner: P1, zone: "play" },
        { key: "marked", def: marked, owner: P1, zone: "play" }
      ]
    });

    // Trying to pick the free character is rejected — it's no longer a
    // legal candidate while "marked" is in the pool.
    assert.throws(
      () =>
        engine.perform({
          type: "activateAbility",
          playerId: P1,
          cardId: id("sniper"),
          abilityId: "snipe",
          selected: { t: [id("plain")] }
        }),
      /Illegal target/
    );

    // Picking the forced character is fine.
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("sniper"),
      abilityId: "snipe",
      selected: { t: [id("marked")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("marked")].depleted, true, "forced card was picked");
    assert.equal(engine.state.cards[id("plain")].depleted, false, "the free card was not");
  });
});

// --- behavior.keepOnHostLeave -----------------------------------------------

describe("capability: keepOnHostLeave (persistent attachment)", () => {
  test("an Attach-to item stays in play unattached when its host leaves", () => {
    const blade = item({
      name: "Persistent Blade",
      attachTo: "character",
      behavior: { keepOnHostLeave: true }
    });
    const plainItem = item({ name: "Plain Amulet", attachTo: "character" });

    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host", life: 1 }), owner: P1, zone: "play" },
        { key: "host2", def: character({ name: "Host2", life: 1 }), owner: P1, zone: "play" },
        { key: "blade", def: blade, owner: P1, zone: "play", attachedToKey: "host" },
        { key: "amulet", def: plainItem, owner: P1, zone: "play", attachedToKey: "host2" }
      ]
    });

    engine.state.cards[id("host")].damage = 5;
    engine.state.cards[id("host2")].damage = 5;
    // @ts-expect-error test reaches into a private for a direct SBA nudge
    engine.checkStateBasedActions();

    assert.equal(engine.state.cards[id("host")].zone, "discard");
    assert.equal(engine.state.cards[id("blade")].zone, "play", "persistent blade stays");
    assert.equal(engine.state.cards[id("blade")].attachedTo, undefined, "but unattached");

    assert.equal(engine.state.cards[id("amulet")].zone, "discard", "plain attach item leaves");
  });
});

// --- preventDamage wholeInstance -----------------------------------------

describe("capability: preventDamage wholeInstance", () => {
  test("negates the whole next instance regardless of size, then is spent", () => {
    const loaf = item({
      name: "Damage Loaf",
      behavior: {
        abilities: [
          {
            id: "deflect",
            type: "activated",
            targets: [{ id: "who", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [
              { type: "preventDamage", target: { type: "selected", id: "who" }, amount: 0, mode: "reduce", wholeInstance: true }
            ]
          },
          {
            id: "hit",
            type: "activated",
            targets: [{ id: "victim", selector: { zone: "play", type: "character" }, count: 1 }],
            variables: {},
            effects: [{ type: "dealDamage", target: { type: "selected", id: "victim" }, amount: 5 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "loaf", def: loaf, owner: P1, zone: "play" },
        { key: "mook", def: character({ name: "Mook", life: 10 }), owner: P1, zone: "play" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("loaf"), abilityId: "deflect", selected: { who: [id("mook")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("loaf"), abilityId: "hit", selected: { victim: [id("mook")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("mook")].damage, 0, "whole 5-point instance absorbed");

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("loaf"), abilityId: "hit", selected: { victim: [id("mook")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("mook")].damage, 5, "shield already spent — next hit lands");
  });
});

// --- suppressAbilities effect ------------------------------------------------

describe("capability: suppressAbilities effect", () => {
  test("turns off all of a card's abilities for the duration, then they return", () => {
    const gadget = character({
      name: "Self-Nuller",
      strength: 2,
      behavior: {
        abilities: [
          {
            id: "buff",
            type: "continuous",
            modifiers: [
              { target: "source", stat: "strength", operation: "add", value: 2 }
            ]
          },
          {
            id: "wipe",
            type: "activated",
            effects: [
              { type: "suppressAbilities", target: "source", duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "g", def: gadget, owner: P1, zone: "play" }]
    });

    assert.equal(engine.getStat(id("g"), "strength"), 4, "continuous self-buff active");

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("g"), abilityId: "wipe" });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("g"), "strength"), 2, "own continuous ability suppressed");

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("g"), "strength"), 4, "suppression expired");
  });
});

// --- hasAttachment ofSubtype ----------------------------------------------

describe("capability: hasAttachment ofSubtype filter", () => {
  const withGearBuff = () =>
    character({
      name: "Gear User",
      strength: 3,
      behavior: {
        abilities: [
          {
            id: "gear-buff",
            type: "continuous",
            condition: { type: "hasAttachment", target: "source", ofSubtype: "gear" },
            modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }]
          }
        ]
      }
    });

  test("only a subtype-matching attachment satisfies it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: withGearBuff(), owner: P1, zone: "play" },
        { key: "b", def: withGearBuff(), owner: P1, zone: "play" },
        { key: "gear", def: item({ name: "Gear Item", subtype: ["gear"], attachTo: "character" }), owner: P1, zone: "play", attachedToKey: "a" },
        { key: "plain", def: item({ name: "Plain Item", subtype: ["upgrade"], attachTo: "character" }), owner: P1, zone: "play", attachedToKey: "b" }
      ]
    });

    assert.equal(engine.getStat(id("a"), "strength"), 5, "gear attached → buffed");
    assert.equal(engine.getStat(id("b"), "strength"), 3, "non-gear attached → not buffed");
  });
});

// --- textMentionsIcon condition -----------------------------------------

describe("capability: textMentionsIcon condition", () => {
  test("an aura buffs only characters whose printed text names the icon", () => {
    const ruins = location({
      name: "Icon Ruins",
      behavior: {
        abilities: [
          {
            id: "aura",
            type: "continuous",
            modifiers: [
              {
                selector: {
                  controller: "self",
                  zone: "play",
                  type: "character",
                  conditions: [
                    { type: "textMentionsIcon", target: { type: "selected", id: "__candidate" }, icon: "volition" }
                  ]
                },
                stat: "strength",
                operation: "add",
                value: 2
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "ruins", def: ruins, owner: P1, zone: "play" },
        { key: "vguy", def: character({ name: "Volition Guy", strength: 1, text: "[V][V][V]: This card cannot be blocked." }), owner: P1, zone: "play" },
        { key: "plain", def: character({ name: "Plain Guy", strength: 1, text: "Vanilla beatstick." }), owner: P1, zone: "play" }
      ]
    });

    assert.equal(engine.getStat(id("vguy"), "strength"), 3, "[V] in text → buffed");
    assert.equal(engine.getStat(id("plain"), "strength"), 1, "no [V] in text → not");
  });
});
