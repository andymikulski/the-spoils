// Behavior data authored onto real cards in data/cards.json, exercised here
// through synthetic fixtures shaped identically to that data (see
// CLAUDE.md's "Development approach" — engine-rules tests stay independent
// of data/cards.json itself, but should prove the exact ability shape that
// was written there is mechanically correct).
//
// One test per *new ability shape*, not per card — see BEHAVIORS.md's
// "Testing convention". Most converted cards reuse an already-proven shape
// (temporary stat modifier, single-target damage/move, multi-effect with no
// targeting, etc.) and don't need their own case here.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  autoResolveBattle,
  buildGame,
  character,
  factionCard,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import type { CardDefinition } from "../../engine.js";
import { TOURNAMENT_FACTION_BEHAVIOR } from "../../engine.js";

// "When this card enters play, your faction gains 4 influence."
function nastyButler(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return character({
    name: "Nasty Butler",
    subtype: ["lackey"],
    behavior: {
      abilities: [
        {
          id: "nasty-butler-etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 4 }]
        }
      ]
    },
    ...overrides
  });
}

describe("card behavior: Nasty Butler (triggered ETB influence gain)", () => {
  test("entering play gains its own controller 4 influence", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "butler", def: nastyButler(), owner: P1, zone: "hand" }]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({ type: "playCard", playerId: P1, cardId: id("butler") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before + 4);
  });

  test("does not fire when a different card enters play", () => {
    // Proves the `sourceIsEventCard` condition is load-bearing: findTriggers
    // matches any in-play card's triggered ability against every event of
    // the right type, not just the event's own source (see SpoilsEngine's
    // findTriggers) — without the condition this ability would fire for
    // any card entering play, not just itself.
    const { engine, id } = buildGame({
      cards: [
        { key: "butler", def: nastyButler(), owner: P1 },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "hand" }
      ]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({ type: "playCard", playerId: P1, cardId: id("bystander") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before);
  });
});

// "HAGGLE -- COST: Deplete this card. Pick a character. -- EFFECT: This
// turn, the character loses 2 strength."
function skilledNegotiator(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return character({
    name: "Skilled Negotiator",
    strength: 0,
    subtype: ["lawyer"],
    behavior: {
      abilities: [
        {
          id: "skilled-negotiator-haggle",
          name: "Haggle",
          type: "activated",
          costs: [{ type: "deplete", target: "source" }],
          targets: [{ id: "target", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [
            {
              type: "createModifier",
              target: { type: "selected", id: "target" },
              stat: "strength",
              operation: "add",
              value: -2,
              duration: { type: "untilEndOfTurn" }
            }
          ]
        }
      ]
    },
    ...overrides
  });
}

describe("card behavior: Skilled Negotiator (activated HAGGLE)", () => {
  test("depletes the source and reduces the picked character's strength by 2, even an opponent's", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "negotiator", def: skilledNegotiator(), owner: P1 },
        { key: "victim", def: character({ name: "Victim", strength: 5 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("negotiator"),
      abilityId: "skilled-negotiator-haggle",
      selected: { target: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.getStat(id("victim"), "strength"), 3);
    assert.equal(engine.state.cards[id("negotiator")].depleted, true);
  });

  test("the strength reduction expires at end of turn", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        { key: "negotiator", def: skilledNegotiator(), owner: P1 },
        { key: "victim", def: character({ name: "Victim", strength: 5 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("negotiator"),
      abilityId: "skilled-negotiator-haggle",
      selected: { target: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.getStat(id("victim"), "strength"), 3);

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    assert.equal(engine.getStat(id("victim"), "strength"), 5);
  });

  test("cannot be used again until the source is restored", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "negotiator", def: skilledNegotiator(), owner: P1 },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("negotiator"),
      abilityId: "skilled-negotiator-haggle",
      selected: { target: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("negotiator"),
        abilityId: "skilled-negotiator-haggle",
        selected: { target: [id("victim")] }
      })
    );
  });
});

// "Your faction gains 2 influence. Draw a card."
function rateHike(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return tactic({
    name: "Rate Hike",
    behavior: {
      abilities: [
        {
          id: "rate-hike",
          type: "activated",
          effects: [
            { type: "modifyInfluence", player: "controller", amount: 2 },
            { type: "draw", player: "controller", amount: 1 }
          ]
        }
      ]
    },
    ...overrides
  });
}

describe("card behavior: Rate Hike (tactic, multiple effects)", () => {
  test("gains 2 influence and draws a card, then goes to discard", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "hike", def: rateHike(), owner: P1, zone: "hand" },
        { key: "topOfDeck", def: character({ name: "Top Card" }), owner: P1, zone: "deck" }
      ]
    });

    const beforeInfluence = engine.state.players[P1].influence;
    const beforeHandSize = engine.state.players[P1].hand.length;

    engine.perform({ type: "playCard", playerId: P1, cardId: id("hike") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, beforeInfluence + 2);
    // "hike" itself left the hand to resolve; the draw replaces it 1-for-1.
    assert.equal(engine.state.players[P1].hand.length, beforeHandSize);
    assert.ok(engine.state.players[P1].hand.includes(id("topOfDeck")));
    assert.equal(engine.state.cards[id("hike")].zone, "discard");
  });
});

describe("Universal faction behavior: Tournament Faction 'Resource' ability", () => {
  // Regression test: data/cards.json carried a stale `playResourceFromHand`
  // effect (not a member of the Effect union — a silent no-op, since a
  // definition sourced from untyped JSON can name a case the resolveEffect
  // switch simply doesn't have) on every reflavored "tournament faction"
  // printing. Fixed to the same targets+playResource shape already used by
  // TOURNAMENT_FACTION_BEHAVIOR in utilities.ts; this proves that shape
  // actually works end to end.
  test("paying 4 and picking a hand card plays it as a face-down resource", () => {
    const { engine, id } = buildGame({
      playerA: { faction: factionCard({ name: "Tournament Faction", behavior: TOURNAMENT_FACTION_BEHAVIOR }) },
      cards: [
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 },
        { key: "r3", def: resourceCard({ name: "R3" }), owner: P1 },
        { key: "r4", def: resourceCard({ name: "R4" }), owner: P1 },
        { key: "filler", def: character({ name: "Filler" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("__factionA"),
      abilityId: "tournament-resource",
      selected: { resource: [id("filler")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("filler")].zone, "play");
    assert.equal(engine.state.cards[id("filler")].faceDown, true);
  });
});

// "EXTRA COST: Pick a non-resource card. -- Put the card into its owner's
// hand. Look at an opponent's hand and choose a card in it. That player
// discards that card."
//
// New mechanisms this shape exercises (see BEHAVIORS.md): a selector
// excluding a card type via `conditions` + the `__candidate` binding
// (CardSelector.type only supports a single positive match), and two
// independent TargetDeclarations resolved together by one playCard action.
function forgetTactic(): CardDefinition {
  return tactic({
    name: "Forget",
    behavior: {
      abilities: [
        {
          id: "forget",
          type: "activated",
          targets: [
            {
              id: "bounced",
              selector: {
                zone: "play",
                conditions: [
                  {
                    type: "not",
                    condition: {
                      type: "cardTypeIs",
                      target: { type: "selected", id: "__candidate" },
                      cardType: "resource"
                    }
                  }
                ]
              },
              count: 1
            },
            {
              id: "discarded",
              selector: { controller: "opponent", zone: "hand" },
              count: 1
            }
          ],
          effects: [
            { type: "moveCard", target: { type: "selected", id: "bounced" }, to: "hand" },
            { type: "moveCard", target: { type: "selected", id: "discarded" }, to: "discard" }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Forget (negated selector + multiple target declarations)", () => {
  test("the 'non-resource' selector rejects a resource as the bounce target", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "forget", def: forgetTactic(), owner: P1, zone: "hand" },
        { key: "onlyResource", def: resourceCard({ name: "Only Resource" }), owner: P1 },
        { key: "opponentCard", def: character({ name: "Opponent Card" }), owner: P2, zone: "hand" }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "playCard",
        playerId: P1,
        cardId: id("forget"),
        selected: { bounced: [id("onlyResource")], discarded: [id("opponentCard")] }
      })
    );
  });

  test("bounces a non-resource card to its owner's hand and makes the opponent discard a chosen card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "forget", def: forgetTactic(), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 },
        { key: "opponentCard", def: character({ name: "Opponent Card" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("forget"),
      selected: { bounced: [id("victim")], discarded: [id("opponentCard")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "hand");
    assert.ok(engine.state.players[P2].hand.includes(id("victim")));
    assert.equal(engine.state.cards[id("opponentCard")].zone, "discard");
    assert.ok(engine.state.players[P2].discard.includes(id("opponentCard")));
  });
});

describe("forEach effect (apply to every card matching a selector, not just one target)", () => {
  test("dealDamage inside forEach hits every matching character, not just one", () => {
    const boardWipe = tactic({
      name: "Board Wipe",
      behavior: {
        abilities: [
          {
            id: "wipe",
            type: "activated",
            effects: [
              {
                type: "forEach",
                selector: { zone: "play", type: "character" },
                effects: [
                  { type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 2 }
                ]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "wipe", def: boardWipe, owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("wipe") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("mine")].damage, 2);
    assert.equal(engine.state.cards[id("theirs")].damage, 2);
  });

  test("createModifier inside forEach scoped to 'controller: self' only buffs the controller's own characters", () => {
    const rally = tactic({
      name: "Rally",
      behavior: {
        abilities: [
          {
            id: "rally",
            type: "activated",
            effects: [
              {
                type: "forEach",
                selector: { controller: "self", zone: "play", type: "character" },
                effects: [
                  {
                    type: "createModifier",
                    target: { type: "selected", id: "__candidate" },
                    stat: "strength",
                    operation: "add",
                    value: 5,
                    duration: { type: "untilEndOfTurn" }
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
        { key: "rally", def: rally, owner: P1, zone: "hand" },
        { key: "mine1", def: character({ name: "Mine1", strength: 1 }), owner: P1 },
        { key: "mine2", def: character({ name: "Mine2", strength: 2 }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs", strength: 3 }), owner: P2 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("rally") });
    resolvePendingResponses(engine);

    assert.equal(engine.getStat(id("mine1"), "strength"), 6);
    assert.equal(engine.getStat(id("mine2"), "strength"), 7);
    assert.equal(engine.getStat(id("theirs"), "strength"), 3);
  });
});

// "While an opponent controls a character, this card gains 1 strength and
// 1 life." — a continuous ability gated by `numberCompare` against a
// `count` NumberExpression, rather than any single card's own stat/counter.
function sleepingGuard(): CardDefinition {
  return character({
    name: "Sleeping Guard",
    behavior: {
      abilities: [
        {
          id: "sleeping-guard-while",
          type: "continuous",
          condition: {
            type: "numberCompare",
            left: { type: "count", selector: { controller: "opponent", zone: "play", type: "character" } },
            operator: ">=",
            right: 1
          },
          modifiers: [
            { target: "source", stat: "strength", operation: "add", value: 1 },
            { target: "source", stat: "life", operation: "add", value: 1 }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Sleeping Guard (numberCompare condition on a count expression)", () => {
  test("turns on once an opponent controls a character, and is off otherwise", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "guard", def: sleepingGuard(), owner: P1 },
        { key: "grunt", def: character({ name: "Grunt" }), owner: P2, zone: "hand" }
      ]
    });

    assert.equal(engine.getStat(id("guard"), "strength"), 1);
    assert.equal(engine.getStat(id("guard"), "life"), 3);

    engine.perform({ type: "playCard", playerId: P2, cardId: id("grunt") });
    resolvePendingResponses(engine);

    assert.equal(engine.getStat(id("guard"), "strength"), 2);
    assert.equal(engine.getStat(id("guard"), "life"), 4);
  });
});

describe("attachedTo TargetRef (continuous modifier on the card an item is attached to)", () => {
  function buffItem(): CardDefinition {
    return item({
      name: "Buff Item",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "buff",
            type: "continuous",
            modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }]
          }
        ]
      }
    });
  }

  test("buffs the character it's attached to", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wearer", def: character({ name: "Wearer", strength: 1 }), owner: P1 },
        { key: "item", def: buffItem(), owner: P1, attachedToKey: "wearer" }
      ]
    });

    assert.equal(engine.getStat(id("wearer"), "strength"), 3);
  });

  test("has no effect while unattached", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bystander", def: character({ name: "Bystander", strength: 1 }), owner: P1 },
        { key: "item", def: buffItem(), owner: P1 }
      ]
    });

    assert.equal(engine.getStat(id("bystander"), "strength"), 1);
  });
});

// "ATTACH TO CHARACTER -- The attached character gains 2 strength. --
// HANDOFF -- COST: Pay 3. Deplete a character you control that is not in a
// battle. -- EFFECT: Attach this card to the character." (Kettinger)
//
// New mechanisms: the `attachTo` effect re-attaching an already-in-play
// item, and `inBattle` (negated) restricting the handoff target.
function kettinger(): CardDefinition {
  return item({
    name: "Kettinger",
    attachTo: "character",
    behavior: {
      abilities: [
        {
          id: "kettinger-buff",
          type: "continuous",
          modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }]
        },
        {
          id: "kettinger-handoff",
          name: "Handoff",
          type: "activated",
          costs: [
            { type: "payResources", amount: 3 },
            { type: "deplete", target: { type: "selected", id: "newWearer" } }
          ],
          targets: [
            {
              id: "newWearer",
              selector: {
                controller: "self",
                zone: "play",
                type: "character",
                conditions: [
                  {
                    type: "not",
                    condition: { type: "inBattle", target: { type: "selected", id: "__candidate" } }
                  }
                ]
              },
              count: 1
            }
          ],
          effects: [{ type: "attachTo", target: "source", to: { type: "selected", id: "newWearer" } }]
        }
      ]
    }
  });
}

describe("card behavior: Kettinger (attachTo effect re-attaches an in-play item)", () => {
  test("moves the item's attachment, and the attachedTo modifier follows it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wearerA", def: character({ name: "WearerA", strength: 1 }), owner: P1 },
        { key: "wearerB", def: character({ name: "WearerB", strength: 1 }), owner: P1 },
        { key: "kettinger", def: kettinger(), owner: P1, attachedToKey: "wearerA" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 },
        { key: "r3", def: resourceCard({ name: "R3" }), owner: P1 }
      ]
    });

    assert.equal(engine.getStat(id("wearerA"), "strength"), 3);
    assert.equal(engine.getStat(id("wearerB"), "strength"), 1);

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("kettinger"),
      abilityId: "kettinger-handoff",
      selected: { newWearer: [id("wearerB")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("kettinger")].attachedTo, id("wearerB"));
    assert.equal(engine.getStat(id("wearerA"), "strength"), 1);
    assert.equal(engine.getStat(id("wearerB"), "strength"), 3);
  });

  test("cannot hand off to a character currently in a battle", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wearerA", def: character({ name: "WearerA", strength: 1 }), owner: P1 },
        { key: "attacker", def: character({ name: "Attacker", strength: 1 }), owner: P1 },
        { key: "kettinger", def: kettinger(), owner: P1, attachedToKey: "wearerA" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 },
        { key: "r3", def: resourceCard({ name: "R3" }), owner: P1 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("kettinger"),
        abilityId: "kettinger-handoff",
        selected: { newWearer: [id("attacker")] }
      })
    );
  });
});

// "EXTRA COST: Pick a blocking character. -- Inflict 3 damage to the
// character." (Eye Gouge) — a battle-role selector via `inBattle`.
function eyeGouge(): CardDefinition {
  return tactic({
    name: "Eye Gouge",
    behavior: {
      abilities: [
        {
          id: "eye-gouge",
          type: "activated",
          targets: [
            {
              id: "target",
              selector: {
                zone: "play",
                type: "character",
                conditions: [
                  { type: "inBattle", target: { type: "selected", id: "__candidate" }, role: "blocker" }
                ]
              },
              count: 1
            }
          ],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "target" }, amount: 3 }]
        }
      ]
    }
  });
}

describe("card behavior: Eye Gouge (inBattle condition scopes a selector to blockers)", () => {
  test("can only target the blocking character, not the attacker or an uninvolved character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 3 }), owner: P1 },
        { key: "blocker", def: character({ name: "Blocker", life: 10 }), owner: P2 },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P2 },
        { key: "gouge", def: eyeGouge(), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blocker")] });

    assert.throws(() =>
      engine.perform({
        type: "playCard",
        playerId: P1,
        cardId: id("gouge"),
        selected: { target: [id("attacker")] }
      })
    );
    assert.throws(() =>
      engine.perform({
        type: "playCard",
        playerId: P1,
        cardId: id("gouge"),
        selected: { target: [id("bystander")] }
      })
    );

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("gouge"),
      selected: { target: [id("blocker")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("blocker")].damage, 3);
  });
});

// "EXTRA COST: Pick a character. -- This turn, the character gains COVERT.
// Draw a card." (Air Travel) — a temporary keyword grant, proven the same
// way keywords.test.ts/battle.test.ts prove static COVERT: only a COVERT
// character may legally block a COVERT attacking party.
describe("grantKeyword effect (temporary keyword grant)", () => {
  test("a character granted COVERT this turn can only be blocked by a COVERT character", () => {
    const airTravel = tactic({
      name: "Air Travel",
      behavior: {
        abilities: [
          {
            id: "air-travel",
            type: "activated",
            targets: [{ id: "target", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [
              {
                type: "grantKeyword",
                target: { type: "selected", id: "target" },
                keyword: "covert",
                duration: { type: "untilEndOfTurn" }
              },
              { type: "draw", player: "controller", amount: 1 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "sneak", def: character({ name: "Sneak" }), owner: P1 },
        { key: "guard", def: character({ name: "Guard" }), owner: P2 },
        { key: "airTravel", def: airTravel, owner: P1, zone: "hand" },
        { key: "topOfDeck", def: character({ name: "Top" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("airTravel"),
      selected: { target: [id("sneak")] }
    });
    resolvePendingResponses(engine);

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("sneak")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("guard")] })
    );
  });

  test("expires at end of turn — no longer COVERT the following turn", () => {
    const airTravel = tactic({
      name: "Air Travel",
      behavior: {
        abilities: [
          {
            id: "air-travel",
            type: "activated",
            targets: [{ id: "target", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [
              {
                type: "grantKeyword",
                target: { type: "selected", id: "target" },
                keyword: "covert",
                duration: { type: "untilEndOfTurn" }
              },
              { type: "draw", player: "controller", amount: 1 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        { key: "sneak", def: character({ name: "Sneak" }), owner: P1 },
        { key: "guard", def: character({ name: "Guard" }), owner: P2 },
        { key: "airTravel", def: airTravel, owner: P1, zone: "hand" },
        { key: "topOfDeck", def: character({ name: "Top" }), owner: P1, zone: "deck" },
        { key: "p2Deck", def: character({ name: "P2 Deck" }), owner: P2, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("airTravel"),
      selected: { target: [id("sneak")] }
    });
    resolvePendingResponses(engine);

    // Cycle through P2's full turn (develop step included) to reach P1's
    // next turn — the grant is created on turn 1 and must be gone by then.
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "chooseDevelop", playerId: P2, choice: { type: "draw" } });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("sneak")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    // No longer COVERT — a non-COVERT blocker is legal now.
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("guard")] });
    assert.equal(engine.state.battle?.blockingParty.includes(id("guard")), true);
  });
});

// "ATTACH TO CHARACTER -- The attached character gains COVERT. -- HANDOFF
// -- COST: Deplete a character you control that is not in a battle. --
// EFFECT: Attach this card to the character." (Very Big Hat of Invisibility)
describe("ContinuousAbility.keywords (item granting a keyword to the card it's attached to)", () => {
  test("a character wearing an item that grants COVERT can only be blocked by a COVERT character", () => {
    const hat = item({
      name: "Very Big Hat of Invisibility",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "hat-covert",
            type: "continuous",
            modifiers: [],
            keywords: [{ target: "attachedTo", keyword: "covert" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "wearer", def: character({ name: "Wearer" }), owner: P1 },
        { key: "hat", def: hat, owner: P1, attachedToKey: "wearer" },
        { key: "guard", def: character({ name: "Guard" }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("wearer")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("guard")] })
    );
  });
});

// "ATTACH TO CHARACTER -- The attached character cannot attack or block."
// (Lugubrious Finger Trap) — ContinuousAbility.restrictions.
describe("card behavior: Lugubrious Finger Trap (restrictions granted via attachment)", () => {
  function fingerTrap(): CardDefinition {
    return item({
      name: "Lugubrious Finger Trap",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "finger-trap-restrict",
            type: "continuous",
            modifiers: [],
            restrictions: [
              { target: "attachedTo", restriction: "cannotAttack" },
              { target: "attachedTo", restriction: "cannotBlock" }
            ]
          }
        ]
      }
    });
  }

  test("the attached character cannot attack", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "trapped", def: character({ name: "Trapped" }), owner: P1 },
        { key: "trap", def: fingerTrap(), owner: P1, attachedToKey: "trapped" }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("trapped")],
        target: { type: "faction", playerId: P2 }
      })
    );
  });

  test("the attached character cannot block", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 1 }), owner: P1 },
        { key: "trapped", def: character({ name: "Trapped" }), owner: P2 },
        { key: "trap", def: fingerTrap(), owner: P2, attachedToKey: "trapped" }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("trapped")] })
    );
  });

  test("an untrapped character can still attack and block normally", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "free", def: character({ name: "Free" }), owner: P1 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("free")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.battle?.attackingParty.includes(id("free")), true);
  });
});

// "This card enters play with 2 tokens on it. -- EJECT -- COST: Remove 2
// tokens from this card. Pick a non-resource card. -- EFFECT: Put the card
// into its owner's hand." (Quotidian Ejector) — `removeCounter` as a Cost.
function quotidianEjector(): CardDefinition {
  return character({
    name: "Quotidian Ejector",
    behavior: {
      abilities: [
        {
          id: "quotidian-ejector-etb-tokens",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "addCounter", target: "source", counter: "token", amount: 2 }]
        },
        {
          id: "quotidian-ejector-eject",
          name: "Eject",
          type: "activated",
          costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 2 }],
          targets: [
            {
              id: "target",
              selector: {
                zone: "play",
                conditions: [
                  {
                    type: "not",
                    condition: {
                      type: "cardTypeIs",
                      target: { type: "selected", id: "__candidate" },
                      cardType: "resource"
                    }
                  }
                ]
              },
              count: 1
            }
          ],
          effects: [{ type: "moveCard", target: { type: "selected", id: "target" }, to: "hand" }]
        }
      ]
    }
  });
}

describe("card behavior: Quotidian Ejector (removeCounter as a Cost)", () => {
  test("enters play with 2 tokens, and EJECT consumes them to bounce a card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ejector", def: quotidianEjector(), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("ejector") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("ejector")].counters.token, 2);

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("ejector"),
      abilityId: "quotidian-ejector-eject",
      selected: { target: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("ejector")].counters.token, 0);
    assert.equal(engine.state.cards[id("victim")].zone, "hand");
  });

  test("cannot pay the cost without enough tokens", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ejector", def: quotidianEjector(), owner: P1 }, // placed directly, skips the ETB trigger — 0 tokens
        { key: "victim", def: character({ name: "Victim" }), owner: P2 }
      ]
    });

    assert.equal(engine.state.cards[id("ejector")].counters.token ?? 0, 0);

    assert.throws(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("ejector"),
        abilityId: "quotidian-ejector-eject",
        selected: { target: [id("victim")] }
      })
    );
  });
});

// `sourceIsDamageSource` — "when this card deals damage to a faction" (e.g.
// Heirloom Incinerator). This also proves a real engine fix: battle damage
// to a faction previously never emitted `damageDealt` at all (only
// card-target battle damage did), so this trigger could never have fired
// for its actual real-world case.
describe("sourceIsDamageSource condition", () => {
  function incinerator(): CardDefinition {
    return character({
      name: "Incinerator",
      strength: 3,
      behavior: {
        abilities: [
          {
            id: "on-damage",
            type: "triggered",
            event: "damageDealt",
            condition: {
              type: "and",
              conditions: [
                { type: "sourceIsDamageSource" },
                { type: "cardTypeIs", target: "eventCard", cardType: "faction" }
              ]
            },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      }
    });
  }

  test("fires from battle damage this card deals to an opposing faction", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "attacker", def: incinerator(), owner: P1 }]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    assert.equal(engine.state.players[P1].influence, before + 1);
  });

  test("does not fire when this card deals damage to a character instead of a faction", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 3 }), owner: P1 },
        { key: "blocker", def: incinerator(), owner: P2 }
      ]
    });

    const before = engine.state.players[P2].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blocker")] });
    autoResolveBattle(engine);

    assert.equal(engine.state.players[P2].influence, before);
  });
});

// `cardMovedFromZone` — scoping a `cardMoved` trigger to "when this card
// leaves play" specifically, combined with `sourceIsEventCard` via `and`.
describe("cardMovedFromZone condition", () => {
  test("fires when this card is destroyed (leaves play)", () => {
    const leaver = character({
      name: "Leaver",
      life: 1,
      behavior: {
        abilities: [
          {
            id: "on-leave",
            type: "triggered",
            event: "cardMoved",
            condition: {
              type: "and",
              conditions: [
                { type: "sourceIsEventCard" },
                { type: "cardMovedFromZone", zone: "play" }
              ]
            },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }]
          }
        ]
      }
    });

    const killer = character({
      name: "Killer",
      behavior: {
        abilities: [
          {
            id: "kill",
            type: "activated",
            targets: [{ id: "target", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "target" }, amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "leaver", def: leaver, owner: P1 },
        { key: "killer", def: killer, owner: P2 }
      ]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("killer"),
      abilityId: "kill",
      selected: { target: [id("leaver")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("leaver")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, before + 3);
  });

  test("does not fire when this card enters play (a different event) or when a different card leaves play", () => {
    const leaver = character({
      name: "Leaver",
      behavior: {
        abilities: [
          {
            id: "on-leave",
            type: "triggered",
            event: "cardMoved",
            condition: {
              type: "and",
              conditions: [
                { type: "sourceIsEventCard" },
                { type: "cardMovedFromZone", zone: "play" }
              ]
            },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }]
          }
        ]
      }
    });

    // Bystander leaves play (dies to a direct kill) — leaver's own ability
    // must not fire for a card that isn't itself.
    const killer = character({
      name: "Killer",
      behavior: {
        abilities: [
          {
            id: "kill",
            type: "activated",
            targets: [{ id: "target", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "target" }, amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "leaver", def: leaver, owner: P1 },
        { key: "bystander", def: character({ name: "Bystander", life: 1 }), owner: P2 },
        { key: "killer", def: killer, owner: P2 }
      ]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("killer"),
      abilityId: "kill",
      selected: { target: [id("bystander")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("bystander")].zone, "discard");
    assert.equal(engine.state.players[P1].influence, before);
  });
});

// "When this card attacks, you may pick a character. If you do, deplete
// it." (Bloodcurdling Bulldozer) — optional targeting + the `if` meta-effect
// ("if you do"), plus the `characterAttacked` event itself.
function bloodcurdlingBulldozer(): CardDefinition {
  return character({
    name: "Bloodcurdling Bulldozer",
    behavior: {
      abilities: [
        {
          id: "bulldozer-attack",
          type: "triggered",
          event: "characterAttacked",
          condition: { type: "sourceIsEventCard" },
          targets: [
            { id: "target", selector: { zone: "play", type: "character" }, count: 1, optional: true }
          ],
          effects: [
            {
              type: "if",
              condition: { type: "targetExists", target: { type: "selected", id: "target" } },
              effects: [{ type: "deplete", target: { type: "selected", id: "target" } }]
            }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Bloodcurdling Bulldozer (optional targeting + 'if you do')", () => {
  test("with a legal candidate, pauses on a real decision — declining does nothing", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bulldozer", def: bloodcurdlingBulldozer(), owner: P1 },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("bulldozer")],
      target: { type: "faction", playerId: P2 }
    });

    assert.equal(engine.state.pendingChoice?.kind, "selectTargets");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { target: [] } }
    });

    assert.equal(engine.state.cards[id("bystander")].depleted, false);
  });

  test("choosing a target depletes it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bulldozer", def: bloodcurdlingBulldozer(), owner: P1 },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("bulldozer")],
      target: { type: "faction", playerId: P2 }
    });

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { target: [id("bystander")] } }
    });

    assert.equal(engine.state.cards[id("bystander")].depleted, true);
  });

});

// A generic optional declaration with zero legal candidates must decline
// automatically — no pendingChoice, no error. (Not exercisable through
// Bloodcurdling Bulldozer itself: its own selector has no controller
// restriction, so the attacker is always a legal candidate for its own
// trigger — there's no real "zero candidates" case for that exact card.)
describe("optional targeting with zero legal candidates", () => {
  test("auto-declines without pausing when nothing matches the selector", () => {
    const scavenger = character({
      name: "Scavenger",
      behavior: {
        abilities: [
          {
            id: "on-attack",
            type: "triggered",
            event: "characterAttacked",
            condition: { type: "sourceIsEventCard" },
            targets: [
              { id: "target", selector: { controller: "opponent", zone: "play", type: "character" }, count: 1, optional: true }
            ],
            effects: [
              {
                type: "if",
                condition: { type: "targetExists", target: { type: "selected", id: "target" } },
                effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "scavenger", def: scavenger, owner: P1 }]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("scavenger")],
      target: { type: "faction", playerId: P2 }
    });

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.players[P1].influence, before);
  });
});

// "EXTRA COST: Choose a number for X. Pay X+X. Pick a character. -- Inflict
// X damage to the character." (Skewer) — a player-chosen NumberExpression
// variable referenced by both a tactic's extra cost and its effect. Also
// exercises playCard now consulting a tactic ability's `costs` at all (it
// previously only read `targets`/`effects`).
function skewer(): CardDefinition {
  return tactic({
    name: "Skewer",
    behavior: {
      abilities: [
        {
          id: "skewer",
          type: "activated",
          costs: [
            {
              type: "payResources",
              amount: { type: "add", values: [{ type: "variable", id: "x" }, { type: "variable", id: "x" }] }
            }
          ],
          targets: [{ id: "target", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "target" }, amount: { type: "variable", id: "x" } }]
        }
      ]
    }
  });
}

describe("card behavior: Skewer (player-chosen X variable)", () => {
  test("paying for X=2 costs 4 resources and deals 2 damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "skewer", def: skewer(), owner: P1, zone: "hand" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 },
        { key: "r3", def: resourceCard({ name: "R3" }), owner: P1 },
        { key: "r4", def: resourceCard({ name: "R4" }), owner: P1 },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("skewer"),
      selected: { target: [id("victim")] },
      variables: { x: 2 }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.getAvailableResourceCount(P1), 0);
    assert.equal(engine.state.cards[id("victim")].damage, 2);
  });

  test("cannot pay for X=3 with only 4 resources available", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "skewer", def: skewer(), owner: P1, zone: "hand" },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 },
        { key: "r3", def: resourceCard({ name: "R3" }), owner: P1 },
        { key: "r4", def: resourceCard({ name: "R4" }), owner: P1 },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "playCard",
        playerId: P1,
        cardId: id("skewer"),
        selected: { target: [id("victim")] },
        variables: { x: 3 }
      })
    );
  });
});

// "When this card enters play, you may search your deck for a tactic and
// reveal it. If you do, put it into your hand." (Servile Centipede) —
// deck-zone targeting + `shuffleDeck` (the "search" convention: `zone:
// "deck"` selectors already let a target declaration reach into the deck;
// `shuffleDeck` supplies the reshuffle RULES.md §2 requires afterward).
function servileCentipede(): CardDefinition {
  return character({
    name: "Servile Centipede",
    behavior: {
      abilities: [
        {
          id: "servile-centipede-search",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          targets: [
            { id: "target", selector: { controller: "self", zone: "deck", type: "tactic" }, count: 1, optional: true }
          ],
          effects: [
            {
              type: "if",
              condition: { type: "targetExists", target: { type: "selected", id: "target" } },
              effects: [{ type: "moveCard", target: { type: "selected", id: "target" }, to: "hand" }]
            },
            { type: "shuffleDeck", player: "controller" }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Servile Centipede (search deck-zone target + shuffleDeck)", () => {
  test("finds the tactic, moves it to hand, and reshuffles the rest of the deck", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "centipede", def: servileCentipede(), owner: P1, zone: "hand" },
        { key: "buriedTactic", def: tactic({ name: "Buried Tactic" }), owner: P1, zone: "deck" },
        { key: "filler1", def: character({ name: "Filler1" }), owner: P1, zone: "deck" },
        { key: "filler2", def: character({ name: "Filler2" }), owner: P1, zone: "deck" }
      ]
    });

    const deckBefore = new Set(engine.state.players[P1].deck);

    engine.perform({ type: "playCard", playerId: P1, cardId: id("centipede") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "selectTargets");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { target: [id("buriedTactic")] } }
    });
    resolvePendingResponses(engine);

    assert.ok(engine.state.players[P1].hand.includes(id("buriedTactic")));

    const deckAfter = engine.state.players[P1].deck;
    assert.equal(deckAfter.length, deckBefore.size - 1);
    for (const cardId of deckAfter) {
      assert.ok(deckBefore.has(cardId));
    }
  });

  test("declining still reshuffles, but nothing moves to hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "centipede", def: servileCentipede(), owner: P1, zone: "hand" },
        { key: "buriedTactic", def: tactic({ name: "Buried Tactic" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("centipede") });
    resolvePendingResponses(engine);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { target: [] } }
    });
    resolvePendingResponses(engine);

    assert.ok(!engine.state.players[P1].hand.includes(id("buriedTactic")));
    assert.ok(engine.state.players[P1].deck.includes(id("buriedTactic")));
  });
});

describe("random NumberExpression and TargetRef", () => {
  test("a random NumberExpression range is deterministic under an injected RNG", () => {
    const coinFlipper = tactic({
      name: "Coin Flipper",
      behavior: {
        abilities: [
          {
            id: "flip",
            type: "activated",
            effects: [
              {
                type: "modifyInfluence",
                player: "controller",
                amount: { type: "random", min: 1, max: 2 }
              }
            ]
          }
        ]
      }
    });

    // random() = 0.9 -> Math.floor(0.9 * 2) = 1 -> min(1) + 1 = 2
    const { engine, id } = buildGame({
      random: () => 0.9,
      cards: [{ key: "flipper", def: coinFlipper, owner: P1, zone: "hand" }]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({ type: "playCard", playerId: P1, cardId: id("flipper") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before + 2);
  });

  test("a random TargetRef picks a matching card deterministically under an injected RNG", () => {
    const randomDiscarder = tactic({
      name: "Random Discarder",
      behavior: {
        abilities: [
          {
            id: "discard-random",
            type: "activated",
            effects: [
              {
                type: "moveCard",
                target: { type: "random", selector: { controller: "opponent", zone: "hand" } },
                to: "discard"
              }
            ]
          }
        ]
      }
    });

    // random() = 0 -> index 0 -> the first card matchesSelector/queryCards finds.
    const { engine, id } = buildGame({
      random: () => 0,
      cards: [
        { key: "discarder", def: randomDiscarder, owner: P1, zone: "hand" },
        { key: "handCard1", def: character({ name: "Hand1" }), owner: P2, zone: "hand" },
        { key: "handCard2", def: character({ name: "Hand2" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("discarder") });
    resolvePendingResponses(engine);

    const discarded = engine.state.players[P2].discard;
    assert.equal(discarded.length, 1);
    assert.ok(discarded[0] === id("handCard1") || discarded[0] === id("handCard2"));
  });
});

// "EXTRA COST: Deploy this only while you are attacking. X is the number of
// members in the attacking party. -- This turn, all members of the
// attacking party gain X strength and X life." (Strength In Numbers) —
// exercises three things together: a tactic ability's own `condition`
// gating when it can be played (previously never consulted by playCard,
// only `targets`/`effects`/`costs` were), the `battleRole` condition, and a
// dynamic "X = battle party size" via `count` + `inBattle` composition
// (no dedicated battle-derived NumberExpression needed).
function strengthInNumbers(): CardDefinition {
  const attackingPartySelector = {
    zone: "play" as const,
    type: "character" as const,
    conditions: [
      { type: "inBattle" as const, target: { type: "selected" as const, id: "__candidate" }, role: "attacker" as const }
    ]
  };

  return tactic({
    name: "Strength In Numbers",
    behavior: {
      abilities: [
        {
          id: "strength-in-numbers",
          type: "activated",
          condition: { type: "battleRole", role: "attacker" },
          effects: [
            {
              type: "forEach",
              selector: attackingPartySelector,
              effects: [
                {
                  type: "createModifier",
                  target: { type: "selected", id: "__candidate" },
                  stat: "strength",
                  operation: "add",
                  value: { type: "count", selector: attackingPartySelector },
                  duration: { type: "untilEndOfTurn" }
                },
                {
                  type: "createModifier",
                  target: { type: "selected", id: "__candidate" },
                  stat: "life",
                  operation: "add",
                  value: { type: "count", selector: attackingPartySelector },
                  duration: { type: "untilEndOfTurn" }
                }
              ]
            }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Strength In Numbers (tactic condition + battleRole + dynamic battle-derived X)", () => {
  test("buffs every attacker by the attacking party's own size", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker1", def: character({ name: "Attacker1", strength: 1, life: 3 }), owner: P1 },
        { key: "attacker2", def: character({ name: "Attacker2", strength: 1, life: 3 }), owner: P1 },
        { key: "numbers", def: strengthInNumbers(), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker1"), id("attacker2")],
      target: { type: "faction", playerId: P2 }
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("numbers") });
    resolvePendingResponses(engine);

    assert.equal(engine.getStat(id("attacker1"), "strength"), 3);
    assert.equal(engine.getStat(id("attacker1"), "life"), 5);
    assert.equal(engine.getStat(id("attacker2"), "strength"), 3);
    assert.equal(engine.getStat(id("attacker2"), "life"), 5);
  });

  test("cannot be played while not attacking", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bystander", def: character({ name: "Bystander" }), owner: P1 },
        { key: "numbers", def: strengthInNumbers(), owner: P1, zone: "hand" }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("numbers") })
    );
  });
});

// "An opponent discards a card" (Swarm of Gnats) — `chooserSelectsTarget`:
// the opponent, not the controller, picks which of their own hand cards to
// discard. Proves the pause/resume machinery: resolution stops for the
// non-controller's answer, then the tactic's own stack-item bookkeeping
// (moving it to discard) still completes correctly afterward.
function discardMaker(): CardDefinition {
  return tactic({
    name: "Discard Maker",
    behavior: {
      abilities: [
        {
          id: "make-discard",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "opponent",
              declaration: { id: "toDiscard", selector: { controller: "opponent", zone: "hand" }, count: 1 },
              effects: [{ type: "moveCard", target: { type: "selected", id: "toDiscard" }, to: "discard" }]
            }
          ]
        }
      ]
    }
  });
}

describe("chooserSelectsTarget effect (a non-controller picks a target)", () => {
  test("an opponent discards a card of their own choosing from their hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "maker", def: discardMaker(), owner: P1, zone: "hand" },
        { key: "hand1", def: character({ name: "Hand1" }), owner: P2, zone: "hand" },
        { key: "hand2", def: character({ name: "Hand2" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("maker") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.equal(engine.state.pendingChoice?.playerId, P2);

    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "chooserSelectsTarget", selected: [id("hand1")] }
      })
    );

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "chooserSelectsTarget", selected: [id("hand2")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("hand2")].zone, "discard");
    assert.equal(engine.state.cards[id("hand1")].zone, "hand");
    assert.equal(engine.state.cards[id("maker")].zone, "discard");
  });

  test("no-ops without a choice when the chooser has no legal candidate at all", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "maker", def: discardMaker(), owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("maker") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("maker")].zone, "discard");
  });
});

// "An opponent chooses one of the following effects" (Ritual of the
// Screaming Cheese) — `chooserSelectsOption`.
function ritual(): CardDefinition {
  return tactic({
    name: "Ritual",
    behavior: {
      abilities: [
        {
          id: "ritual",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsOption",
              chooser: "opponent",
              options: [
                [{ type: "modifyInfluence", player: "controller", amount: 1 }],
                [{ type: "modifyInfluence", player: "controller", amount: 2 }]
              ]
            }
          ]
        }
      ]
    }
  });
}

describe("chooserSelectsOption effect (a non-controller picks a branch)", () => {
  test("resolves only the chosen option's effects", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ritual", def: ritual(), owner: P1, zone: "hand" }]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({ type: "playCard", playerId: P1, cardId: id("ritual") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    assert.equal(engine.state.pendingChoice?.playerId, P2);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "chooserSelectsOption", index: 1 }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before + 2);
  });

  test("rejects an out-of-range option index", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ritual", def: ritual(), owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("ritual") });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P2,
        choice: { kind: "chooserSelectsOption", index: 5 }
      })
    );
  });
});

// "Look at up to the top 5 cards of any one deck. Put them back in any
// order." (Arcanist's Almanac) — `lookAndReorder`.
function almanac(): CardDefinition {
  return item({
    name: "Arcanist's Almanac",
    behavior: {
      abilities: [
        {
          id: "almanac-foresight",
          name: "Foresight",
          type: "activated",
          costs: [{ type: "deplete", target: "source" }],
          effects: [{ type: "lookAndReorder", player: "controller", count: 3 }]
        }
      ]
    }
  });
}

describe("lookAndReorder effect", () => {
  test("reorders the top N cards of the deck as directed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "almanac", def: almanac(), owner: P1 },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "deck" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "deck" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "deck" },
        { key: "d", def: character({ name: "D" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("almanac"),
      abilityId: "almanac-foresight"
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    const pending = engine.state.pendingChoice;
    assert.deepEqual(
      pending && pending.kind === "reorderDeck" ? [...pending.cardIds].sort() : [],
      [id("a"), id("b"), id("c")].sort()
    );

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "reorderDeck", order: [id("c"), id("a"), id("b")] }
    });
    resolvePendingResponses(engine);

    assert.deepEqual(engine.state.players[P1].deck, [id("c"), id("a"), id("b"), id("d")]);
  });

  test("looks at fewer cards when the deck has fewer than the requested count", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "almanac", def: almanac(), owner: P1 },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("almanac"),
      abilityId: "almanac-foresight"
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    const pending = engine.state.pendingChoice;
    assert.deepEqual(pending && pending.kind === "reorderDeck" ? pending.cardIds : [], [id("a")]);
  });

  test("no-ops without a choice when the deck is empty", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "almanac", def: almanac(), owner: P1 }]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("almanac"),
      abilityId: "almanac-foresight"
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("almanac")].depleted, true);
  });
});

// The real Arcanist's Almanac: "any one deck" means the caster picks WHICH
// player's deck via a faction target, resolved to a PlayerRef with
// `ownerOf` — not just their own.
function arcanistsAlmanac(): CardDefinition {
  return item({
    name: "Arcanist's Almanac",
    behavior: {
      abilities: [
        {
          id: "almanac-foresight",
          name: "Foresight",
          type: "activated",
          costs: [{ type: "deplete", target: "source" }],
          targets: [{ id: "deckOwner", selector: { zone: "play", type: "faction" }, count: 1 }],
          effects: [
            {
              type: "lookAndReorder",
              player: { type: "ownerOf", target: { type: "selected", id: "deckOwner" } },
              count: 5
            }
          ]
        }
      ]
    }
  });
}

describe("ownerOf PlayerRef (Arcanist's Almanac targets any one deck, not just its own)", () => {
  test("can target an opponent's deck", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "almanac", def: arcanistsAlmanac(), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "deck" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("almanac"),
      abilityId: "almanac-foresight",
      selected: { deckOwner: [id("__factionB")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.playerId, P2);
    assert.deepEqual(pending && pending.kind === "reorderDeck" ? pending.cardIds : [], [id("theirs")]);
  });
});

// "Reduce the numeric cost of the next card you deploy this turn by N"
// (1337!) — `reduceNextCost`, consumed by exactly one subsequent playCard.
function discount(amount: number): CardDefinition {
  return tactic({
    name: "Discount",
    behavior: {
      abilities: [
        {
          id: "discount",
          type: "activated",
          effects: [{ type: "reduceNextCost", player: "controller", amount }]
        }
      ]
    }
  });
}

describe("reduceNextCost effect", () => {
  test("waives part of the cost of the very next card played, then stops applying", () => {
    const pricey = character({ name: "Pricey", cost: 3 });

    const { engine, id } = buildGame({
      cards: [
        { key: "discount", def: discount(3), owner: P1, zone: "hand" },
        { key: "pricey1", def: pricey, owner: P1, zone: "hand" },
        { key: "pricey2", def: character({ name: "Pricey2", cost: 3 }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("discount") });
    resolvePendingResponses(engine);

    // No resources anywhere on board, yet this succeeds — fully discounted.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("pricey1") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("pricey1")].zone, "play");

    // The discount is already spent — the second copy needs real resources.
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("pricey2") })
    );
  });

  test("expires unused at end of turn", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        { key: "discount", def: discount(3), owner: P1, zone: "hand" },
        { key: "p2Deck", def: character({ name: "P2 Deck" }), owner: P2, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("discount") });
    resolvePendingResponses(engine);

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "chooseDevelop", playerId: P2, choice: { type: "draw" } });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });

    assert.equal(engine.state.costReductions.length, 0);
  });
});

// "You may deploy a non-resource card with numeric cost X or less for
// free" (Spontaneous Displacement) — `deployForFree`.
function freePlay(maxCost: number): CardDefinition {
  return tactic({
    name: "Free Play",
    behavior: {
      abilities: [
        {
          id: "free-play",
          type: "activated",
          effects: [{ type: "deployForFree", player: "controller", maxCost }]
        }
      ]
    }
  });
}

describe("deployForFree effect", () => {
  test("deploys the chosen card without spending any resources", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "freePlay", def: freePlay(2), owner: P1, zone: "hand" },
        { key: "cheap", def: character({ name: "Cheap", cost: 2 }), owner: P1, zone: "hand" },
        { key: "expensive", def: character({ name: "Expensive", cost: 5 }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("freePlay") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    const pending = engine.state.pendingChoice;
    assert.deepEqual(
      pending && pending.kind === "deployForFree" ? pending.candidates : [],
      [id("cheap")]
    );

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "deployForFree", cardId: id("cheap") }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("cheap")].zone, "play");
    assert.equal(engine.getAvailableResourceCount(P1), 0);
    assert.equal(engine.state.cards[id("freePlay")].zone, "discard");
  });

  test("declining leaves everything in hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "freePlay", def: freePlay(2), owner: P1, zone: "hand" },
        { key: "cheap", def: character({ name: "Cheap", cost: 2 }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("freePlay") });
    resolvePendingResponses(engine);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "deployForFree" }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("cheap")].zone, "hand");
    assert.equal(engine.state.cards[id("freePlay")].zone, "discard");
  });

  test("still requires the chosen card's own extra-cost targets", () => {
    const finisher = character({
      name: "Finisher",
      cost: 2,
      behavior: {
        abilities: [
          {
            id: "on-enter-noop",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: []
          }
        ]
      }
    });

    const grabber = tactic({
      name: "Grabber",
      cost: 2,
      behavior: {
        abilities: [
          {
            id: "grab",
            type: "activated",
            targets: [{ id: "target", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "deplete", target: { type: "selected", id: "target" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "freePlay", def: freePlay(2), owner: P1, zone: "hand" },
        { key: "grabber", def: grabber, owner: P1, zone: "hand" },
        { key: "victim", def: finisher, owner: P1 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("freePlay") });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "deployForFree", cardId: id("grabber") }
      })
    );

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: {
        kind: "deployForFree",
        cardId: id("grabber"),
        selected: { target: [id("victim")] }
      }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].depleted, true);
    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });
});

// "EXTRA COST: Pick a non-resource card. X is half its numeric cost,
// rounded up. -- Put the card into its owner's hand. You may deploy a
// non-resource card with numeric cost X or less for free." (Spontaneous
// Displacement) — `cardCost` + `divide` feeding a `deployForFree`'s
// `maxCost`, referencing a target ("bounced") that already left the
// selector it was picked from by the time the second effect resolves.
function spontaneousDisplacement(): CardDefinition {
  const nonResource = {
    type: "not" as const,
    condition: {
      type: "cardTypeIs" as const,
      target: { type: "selected" as const, id: "__candidate" },
      cardType: "resource" as const
    }
  };

  return tactic({
    name: "Spontaneous Displacement",
    behavior: {
      abilities: [
        {
          id: "spontaneous-displacement",
          type: "activated",
          targets: [
            { id: "bounced", selector: { zone: "play", conditions: [nonResource] }, count: 1 }
          ],
          effects: [
            { type: "moveCard", target: { type: "selected", id: "bounced" }, to: "hand" },
            {
              type: "deployForFree",
              player: "controller",
              maxCost: {
                type: "divide",
                value: { type: "cardCost", target: { type: "selected", id: "bounced" } },
                by: 2,
                rounding: "up"
              },
              selector: { conditions: [nonResource] }
            }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Spontaneous Displacement (cardCost + divide feeding deployForFree)", () => {
  test("bounces the picked card and offers a free deploy at half its cost, rounded up", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "displacement", def: spontaneousDisplacement(), owner: P1, zone: "hand" },
        { key: "bounced", def: character({ name: "Bounced", cost: 5 }), owner: P1 },
        { key: "cheap", def: character({ name: "Cheap", cost: 3 }), owner: P1, zone: "hand" },
        { key: "pricier", def: character({ name: "Pricier", cost: 4 }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("displacement"),
      selected: { bounced: [id("bounced")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("bounced")].zone, "hand");

    // ceil(5 / 2) = 3
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    const pending = engine.state.pendingChoice;
    assert.deepEqual(
      pending && pending.kind === "deployForFree" ? pending.candidates : [],
      [id("cheap")]
    );

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "deployForFree", cardId: id("cheap") }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("cheap")].zone, "play");
    assert.equal(engine.getAvailableResourceCount(P1), 0);
  });
});

const nonResourceInPlay = {
  type: "not" as const,
  condition: {
    type: "cardTypeIs" as const,
    target: { type: "selected" as const, id: "__candidate" },
    cardType: "resource" as const
  }
};

// "EXTRA COST: Pick 2 or fewer non-resource cards. -- Put up to 2 tokens
// divided however you want on the cards. Draw a card." (Voidal Perversion)
// — a ranged ("2 or fewer") TargetDeclaration + `distributeAmong`.
function voidalPerversion(): CardDefinition {
  return tactic({
    name: "Voidal Perversion",
    behavior: {
      abilities: [
        {
          id: "voidal-perversion",
          type: "activated",
          targets: [
            { id: "picked", selector: { zone: "play", conditions: [nonResourceInPlay] }, count: 2, optional: true }
          ],
          effects: [
            {
              type: "distributeAmong",
              chooser: "controller",
              selected: "picked",
              amount: 2,
              effects: [
                {
                  type: "addCounter",
                  target: { type: "selected", id: "__candidate" },
                  counter: "token",
                  amount: { type: "variable", id: "__amount" }
                }
              ]
            },
            { type: "draw", player: "controller", amount: 1 }
          ]
        }
      ]
    }
  });
}

describe("ranged TargetDeclaration + distributeAmong (Voidal Perversion)", () => {
  test("picking fewer than 2, then splitting the tokens unevenly across the picks", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "perversion", def: voidalPerversion(), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "topOfDeck", def: character({ name: "Top" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("perversion"),
      selected: { picked: [id("a")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "distributeAmong");
    const pending = engine.state.pendingChoice;
    assert.deepEqual(pending && pending.kind === "distributeAmong" ? pending.targets : [], [id("a")]);
    assert.equal(pending && pending.kind === "distributeAmong" ? pending.amount : 0, 2);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "distributeAmong", shares: { [id("a")]: 2 } }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("a")].counters.token, 2);
    assert.ok(engine.state.players[P1].hand.includes(id("topOfDeck")));
  });

  test("splitting across two picks, and under-distributing (shares may total less than the amount)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "perversion", def: voidalPerversion(), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P2 },
        { key: "topOfDeck", def: character({ name: "Top" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("perversion"),
      selected: { picked: [id("a"), id("b")] }
    });
    resolvePendingResponses(engine);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "distributeAmong", shares: { [id("a")]: 1 } }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("a")].counters.token, 1);
    assert.equal(engine.state.cards[id("b")].counters.token ?? 0, 0);
  });

  test("rejects shares that exceed the total amount or name a non-picked card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "perversion", def: voidalPerversion(), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P1 }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("perversion"),
      selected: { picked: [id("a")] }
    });
    resolvePendingResponses(engine);

    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "distributeAmong", shares: { [id("a")]: 3 } }
      })
    );
    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "distributeAmong", shares: { [id("bystander")]: 1 } }
      })
    );
  });
});

// "EXTRA COST: Choose a number for X. Deplete X characters you control.
// Pick a character. -- If the picked character has X+X strength or less,
// destroy it." (12 Man Brunch of Doom) — `depleteSelected` cost using a
// variable-count TargetDeclaration.
function twelveManBrunchOfDoom(): CardDefinition {
  return tactic({
    name: "12 Man Brunch of Doom",
    behavior: {
      abilities: [
        {
          id: "brunch-of-doom",
          type: "activated",
          targets: [
            { id: "depleted", selector: { controller: "self", zone: "play", type: "character" }, count: { type: "variable", id: "x" } },
            { id: "picked", selector: { zone: "play", type: "character" }, count: 1 }
          ],
          costs: [{ type: "depleteSelected", declarationId: "depleted" }],
          effects: [
            {
              type: "if",
              condition: {
                type: "statCompare",
                target: { type: "selected", id: "picked" },
                stat: "strength",
                operator: "<=",
                value: { type: "add", values: [{ type: "variable", id: "x" }, { type: "variable", id: "x" }] }
              },
              effects: [{ type: "destroy", target: { type: "selected", id: "picked" } }]
            }
          ]
        }
      ]
    }
  });
}

describe("depleteSelected cost (12 Man Brunch of Doom)", () => {
  test("depletes exactly X selected characters and destroys a low-strength pick", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "brunch", def: twelveManBrunchOfDoom(), owner: P1, zone: "hand" },
        { key: "fodder1", def: character({ name: "Fodder1" }), owner: P1 },
        { key: "fodder2", def: character({ name: "Fodder2" }), owner: P1 },
        { key: "victim", def: character({ name: "Victim", strength: 4 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("brunch"),
      selected: { depleted: [id("fodder1"), id("fodder2")], picked: [id("victim")] },
      variables: { x: 2 }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("fodder1")].depleted, true);
    assert.equal(engine.state.cards[id("fodder2")].depleted, true);
    assert.equal(engine.state.cards[id("victim")].zone, "discard");
  });

  test("does not destroy a pick whose strength exceeds X+X", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "brunch", def: twelveManBrunchOfDoom(), owner: P1, zone: "hand" },
        { key: "fodder1", def: character({ name: "Fodder1" }), owner: P1 },
        { key: "victim", def: character({ name: "Victim", strength: 5 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("brunch"),
      selected: { depleted: [id("fodder1")], picked: [id("victim")] },
      variables: { x: 1 }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("fodder1")].depleted, true);
    assert.equal(engine.state.cards[id("victim")].zone, "play");
  });

  test("cannot pay the cost if one of the selected characters is already depleted", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "brunch", def: twelveManBrunchOfDoom(), owner: P1, zone: "hand" },
        { key: "fodder1", def: character({ name: "Fodder1" }), owner: P1, depleted: true },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "playCard",
        playerId: P1,
        cardId: id("brunch"),
        selected: { depleted: [id("fodder1")], picked: [id("victim")] },
        variables: { x: 1 }
      })
    );
  });
});

// "EXTRA COST: Flip a coin. If you win, X is 2. Otherwise, X is 1. Pick X
// or fewer items. -- Destroy the items." (Hammer Smash) — ability-level
// `variables` rolls (resolved before targeting) feeding a variable-count
// TargetDeclaration, plus `forEach` iterating an already-resolved
// selection rather than re-querying a selector.
function hammerSmash(): CardDefinition {
  return tactic({
    name: "Hammer Smash",
    behavior: {
      abilities: [
        {
          id: "hammer-smash",
          type: "activated",
          variables: { x: { type: "random", min: 1, max: 2 } },
          targets: [
            { id: "picked", selector: { zone: "play", type: "item" }, count: { type: "variable", id: "x" }, optional: true }
          ],
          effects: [
            {
              type: "forEach",
              selected: "picked",
              effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }]
            }
          ]
        }
      ]
    }
  });
}

describe("ability-level variable rolls (Hammer Smash's coin flip)", () => {
  test("X=1 (coin flip low) allows picking only 1 item", () => {
    const { engine, id } = buildGame({
      random: () => 0, // random(0,1) -> min(1) + floor(0*2) = 1
      cards: [
        { key: "smash", def: hammerSmash(), owner: P1, zone: "hand" },
        { key: "item1", def: item({ name: "Item1" }), owner: P2 },
        { key: "item2", def: item({ name: "Item2" }), owner: P2 }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "playCard",
        playerId: P1,
        cardId: id("smash"),
        selected: { picked: [id("item1"), id("item2")] }
      })
    );

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("smash"),
      selected: { picked: [id("item1")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("item1")].zone, "discard");
    assert.equal(engine.state.cards[id("item2")].zone, "play");
  });

  test("X=2 (coin flip high) allows destroying up to 2 items", () => {
    const { engine, id } = buildGame({
      random: () => 0.9, // random(1,2) -> min(1) + floor(0.9*2) = 2
      cards: [
        { key: "smash", def: hammerSmash(), owner: P1, zone: "hand" },
        { key: "item1", def: item({ name: "Item1" }), owner: P2 },
        { key: "item2", def: item({ name: "Item2" }), owner: P2 }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("smash"),
      selected: { picked: [id("item1"), id("item2")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("item1")].zone, "discard");
    assert.equal(engine.state.cards[id("item2")].zone, "discard");
  });
});

// "While you have an even number of cards in your hand, this card gains 1
// strength, 1 life, and 1 speed." (Compulsive Creeper) — `modulo`.
function compulsiveCreeper(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return character({
    name: "Compulsive Creeper",
    behavior: {
      abilities: [
        {
          id: "creeper-parity",
          type: "continuous",
          condition: {
            type: "numberCompare",
            left: {
              type: "modulo",
              value: { type: "count", selector: { controller: "self", zone: "hand" } },
              by: 2
            },
            operator: "=",
            right: 0
          },
          modifiers: [
            { target: "source", stat: "strength", operation: "add", value: 1 },
            { target: "source", stat: "life", operation: "add", value: 1 },
            { target: "source", stat: "speed", operation: "add", value: 1 }
          ]
        }
      ]
    },
    ...overrides
  });
}

describe("modulo NumberExpression (parity conditions)", () => {
  test("off with an odd hand size", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "creeper", def: compulsiveCreeper(), owner: P1 },
        { key: "hand1", def: character({ name: "Hand1" }), owner: P1, zone: "hand" }
      ]
    });

    // 1 card in hand: odd -> off.
    assert.equal(engine.getStat(id("creeper"), "strength"), 1);
  });

  test("on with an even hand size", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "creeper", def: compulsiveCreeper({ strength: 2, life: 1, speed: 2 }), owner: P1 },
        { key: "hand1", def: character({ name: "Hand1" }), owner: P1, zone: "hand" },
        { key: "hand2", def: character({ name: "Hand2" }), owner: P1, zone: "hand" }
      ]
    });

    assert.equal(engine.getStat(id("creeper"), "strength"), 3);
    assert.equal(engine.getStat(id("creeper"), "life"), 2);
    assert.equal(engine.getStat(id("creeper"), "speed"), 3);
  });
});

// "While this card is attacking, you may assign its battle damage to the
// target of the attack instead of the blocking party." (Raging Bask) —
// the `redirectDamage` keyword, checked by `getLegalBattleDamageTargets`.
describe("redirectDamage keyword (Raging Bask)", () => {
  test("while blocked, may assign damage to the attack's original target instead of the blocker", () => {
    const basker = character({
      name: "Raging Bask",
      strength: 5,
      behavior: { keywords: ["redirectDamage"] }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "basker", def: basker, owner: P1 },
        { key: "blocker", def: character({ name: "Blocker", life: 10 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("basker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blocker")] });

    const before = engine.state.players[P2].influence;

    autoResolveBattle(engine, source => {
      if (source.cardId !== id("basker")) {
        return source.legalTargets.length > 0
          ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }]
          : [];
      }

      const factionTarget = source.legalTargets.find(target => target.type === "faction");
      assert.ok(factionTarget, "basker should have the faction as a legal damage target while blocked");
      assert.ok(
        source.legalTargets.some(target => target.type === "card"),
        "the blocker should still be a legal option too"
      );

      return [{ sourceId: source.cardId, target: factionTarget!, amount: source.strength }];
    });

    assert.equal(engine.state.players[P2].influence, before - 5);
    assert.equal(engine.state.cards[id("blocker")].damage, 0);
  });

  test("without the keyword, a blocked attacker can only damage the blocker", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 5 }), owner: P1 },
        { key: "blocker", def: character({ name: "Blocker", life: 10 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blocker")] });

    let checked = false;

    autoResolveBattle(engine, source => {
      if (source.cardId === id("attacker")) {
        checked = true;
        assert.ok(!source.legalTargets.some(target => target.type === "faction"));
      }

      return source.legalTargets.length > 0
        ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }]
        : [];
    });

    assert.ok(checked);
  });
});

// "This card gains 1 strength for each token on it. -- At the start of
// your turn, you may pick a character you control. If you do, destroy it.
// Put X tokens on this card, where X is the destroyed character's
// strength when it was destroyed. Otherwise, destroy this card." —
// (Berserker Corps) — `eventPlayerIs` ("at the start of YOUR turn"), and
// "if you do X, otherwise Y" as two sequential `if`/`if not` effects over
// one optional target, with the strength snapshotted (via `addCounter`)
// *before* the `destroy` effect that would otherwise change it.
function berserkerCorps(): CardDefinition {
  return character({
    name: "Berserker Corps",
    strength: 1,
    behavior: {
      abilities: [
        {
          id: "berserker-corps-strength",
          type: "continuous",
          modifiers: [
            { target: "source", stat: "strength", operation: "add", value: { type: "counter", target: "source", counter: "token" } }
          ]
        },
        {
          id: "berserker-corps-start",
          type: "triggered",
          event: "turnStarted",
          condition: { type: "eventPlayerIs", player: "controller" },
          targets: [
            { id: "picked", selector: { controller: "self", zone: "play", type: "character" }, count: 1, optional: true }
          ],
          effects: [
            {
              type: "if",
              condition: { type: "targetExists", target: { type: "selected", id: "picked" } },
              effects: [
                {
                  type: "addCounter",
                  target: "source",
                  counter: "token",
                  amount: { type: "stat", target: { type: "selected", id: "picked" }, stat: "strength" }
                },
                { type: "destroy", target: { type: "selected", id: "picked" } }
              ]
            },
            {
              type: "if",
              condition: { type: "not", condition: { type: "targetExists", target: { type: "selected", id: "picked" } } },
              effects: [{ type: "destroy", target: "source" }]
            }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Berserker Corps (eventPlayerIs + sequential if/if-not as if/else)", () => {
  test("sacrificing a character snapshots its strength into tokens before destroying it", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "berserker", def: berserkerCorps(), owner: P1 },
        { key: "victim", def: character({ name: "Victim", strength: 3 }), owner: P1 }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "selectTargets");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { picked: [id("victim")] } }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "discard");
    assert.equal(engine.state.cards[id("berserker")].counters.token, 3);
    assert.equal(engine.getStat(id("berserker"), "strength"), 4);
  });

  test("declining destroys Berserker Corps itself instead", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "berserker", def: berserkerCorps(), owner: P1 },
        { key: "victim", def: character({ name: "Victim", strength: 3 }), owner: P1 }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { picked: [] } }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("berserker")].zone, "discard");
    assert.equal(engine.state.cards[id("victim")].zone, "play");
  });
});

// "FIRE! -- COST: Deplete this card. Pick 2 or fewer characters. --
// EFFECT: Inflict up to 2 damage divided however you want to the
// characters." (Cannon Squadron) — a `deplete` cost on a character's own
// activated ability, feeding a ranged target declaration into
// `distributeAmong` (same shape as Voidal Perversion, but `dealDamage`
// instead of `addCounter`, and gated by depleting the source).
function cannonSquadron(): CardDefinition {
  return character({
    name: "Cannon Squadron",
    strength: 1,
    behavior: {
      abilities: [
        {
          id: "cannon-squadron-fire",
          type: "activated",
          costs: [{ type: "deplete", target: "source" }],
          targets: [
            { id: "picked", selector: { zone: "play", type: "character" }, count: 2, optional: true }
          ],
          effects: [
            {
              type: "distributeAmong",
              chooser: "controller",
              selected: "picked",
              amount: 2,
              effects: [
                {
                  type: "dealDamage",
                  target: { type: "selected", id: "__candidate" },
                  amount: { type: "variable", id: "__amount" }
                }
              ]
            }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Cannon Squadron (deplete cost + distributeAmong damage)", () => {
  test("splits 2 damage unevenly across 2 picked characters and depletes itself", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cannon", def: cannonSquadron(), owner: P1 },
        { key: "a", def: character({ name: "A", life: 3 }), owner: P2 },
        { key: "b", def: character({ name: "B", life: 3 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("cannon"),
      abilityId: "cannon-squadron-fire",
      selected: { picked: [id("a"), id("b")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "distributeAmong");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "distributeAmong", shares: { [id("a")]: 2 } }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("a")].damage, 2);
    assert.equal(engine.state.cards[id("b")].damage, 0);
    assert.equal(engine.state.cards[id("cannon")].depleted, true);
  });

  test("does not require picking any characters", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "cannon", def: cannonSquadron(), owner: P1 },
        { key: "a", def: character({ name: "A", life: 3 }), owner: P2 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("cannon"),
      abilityId: "cannon-squadron-fire",
      selected: { picked: [] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("a")].damage, 0);
    assert.equal(engine.state.cards[id("cannon")].depleted, true);
  });
});

// "At the start of your turn, you may put a token on this card. --
// ENERGIZE -- COST: Pay 2. -- EFFECT: Put a token on this card. -- STUDY
// -- COST: Remove 3 tokens from this card. -- EFFECT: Draw a card."
// (Voidal Observatory) — a "you may" turnStarted trigger as
// `chooserSelectsOption` with an empty first branch, plus two ordinary
// activated abilities (one paid in resources, one paid by removing
// tokens).
function voidalObservatory(): CardDefinition {
  return location({
    name: "Voidal Observatory",
    structure: 5,
    behavior: {
      abilities: [
        {
          id: "voidal-observatory-start",
          type: "triggered",
          event: "turnStarted",
          condition: { type: "eventPlayerIs", player: "controller" },
          effects: [
            {
              type: "chooserSelectsOption",
              chooser: "controller",
              options: [[], [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]]
            }
          ]
        },
        {
          id: "voidal-observatory-energize",
          name: "Energize",
          type: "activated",
          costs: [{ type: "payResources", amount: 2 }],
          effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]
        },
        {
          id: "voidal-observatory-study",
          name: "Study",
          type: "activated",
          costs: [{ type: "removeCounter", target: "source", counter: "token", amount: 3 }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
}

describe("card behavior: Voidal Observatory (turnStarted may-choice + resource/token-costed abilities)", () => {
  test("accepting the start-of-turn choice adds a token", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [{ key: "observatory", def: voidalObservatory(), owner: P1 }]
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsOption", index: 1 }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("observatory")].counters.token, 1);
  });

  test("Energize pays 2 resources for a token; Study removes 3 tokens to draw", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "observatory", def: voidalObservatory(), owner: P1 },
        { key: "res1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "res2", def: resourceCard({ name: "R2" }), owner: P1 },
        { key: "topOfDeck", def: character({ name: "Top" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("observatory"),
      abilityId: "voidal-observatory-energize"
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("observatory")].counters.token, 1);

    engine.state.cards[id("observatory")].counters.token = 3;

    const handBefore = engine.state.players[P1].hand.length;
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("observatory"),
      abilityId: "voidal-observatory-study"
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("observatory")].counters.token, 0);
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
  });
});

// "ATTACH TO CHARACTER -- This card enters play with 1 token on it. --
// At the start of your turn, you may put a token on this card. -- The
// attached character loses 1 strength, 1 life, and 1 speed for each
// token on this card." (Napiform Protuberance) — a `cardEnteredPlay` ETB
// counter, the same "you may" `chooserSelectsOption` turnStarted pattern
// as Voidal Observatory, and a `multiply`-by-`-1` continuous penalty on
// `attachedTo` scaling with the counter count.
function napiformProtuberance(): CardDefinition {
  return item({
    name: "Napiform Protuberance",
    attachTo: "character",
    behavior: {
      abilities: [
        {
          id: "napiform-etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]
        },
        {
          id: "napiform-start",
          type: "triggered",
          event: "turnStarted",
          condition: { type: "eventPlayerIs", player: "controller" },
          effects: [
            {
              type: "chooserSelectsOption",
              chooser: "controller",
              options: [[], [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]]
            }
          ]
        },
        {
          id: "napiform-penalty",
          type: "continuous",
          modifiers: [
            {
              target: "attachedTo",
              stat: "strength",
              operation: "add",
              value: { type: "multiply", values: [{ type: "counter", target: "source", counter: "token" }, -1] }
            },
            {
              target: "attachedTo",
              stat: "life",
              operation: "add",
              value: { type: "multiply", values: [{ type: "counter", target: "source", counter: "token" }, -1] }
            },
            {
              target: "attachedTo",
              stat: "speed",
              operation: "add",
              value: { type: "multiply", values: [{ type: "counter", target: "source", counter: "token" }, -1] }
            }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Napiform Protuberance (ETB counter + turnStarted may-choice + scaling penalty)", () => {
  test("enters play with 1 token and immediately penalizes the attached character", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Victim", strength: 5, life: 5, speed: 5 }), owner: P1 },
        { key: "napiform", def: napiformProtuberance(), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("napiform"),
      selected: { attachTo: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("napiform")].counters.token, 1);
    assert.equal(engine.getStat(id("victim"), "strength"), 4);
    assert.equal(engine.getStat(id("victim"), "life"), 4);
    assert.equal(engine.getStat(id("victim"), "speed"), 4);
  });

  test("accepting the start-of-turn choice adds another token, deepening the penalty", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "victim", def: character({ name: "Victim", strength: 5, life: 5, speed: 5 }), owner: P1 },
        { key: "napiform", def: napiformProtuberance(), owner: P1, attachedToKey: "victim" }
      ]
    });

    engine.state.cards[id("napiform")].counters.token = 1;

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsOption", index: 1 }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("napiform")].counters.token, 2);
    assert.equal(engine.getStat(id("victim"), "strength"), 3);
  });
});

// "EXTRA COST: Deploy this only if you have at least 5 cards in your
// deck. Deplete up to 5 characters you control. X is the number of
// characters you deplete this way. -- Search your deck for 5 cards and
// reveal them. An opponent chooses X of those cards. Put the chosen
// cards into your hand and the rest into your discard pile." (Arcana
// Experiment) — a tactic condition gating on deck size, `depleteSelected`
// feeding a `selectionCount` variable, and `chooserSelectsTarget`
// constrained to an earlier selection via `targetInSelection`.
function arcanaExperiment(): CardDefinition {
  return tactic({
    name: "Arcana Experiment",
    behavior: {
      abilities: [
        {
          id: "arcana-experiment",
          type: "activated",
          condition: {
            type: "numberCompare",
            left: { type: "count", selector: { controller: "self", zone: "deck" } },
            operator: ">=",
            right: 5
          },
          costs: [{ type: "depleteSelected", declarationId: "depleted" }],
          targets: [
            { id: "depleted", selector: { controller: "self", zone: "play", type: "character" }, count: 5, optional: true },
            { id: "found", selector: { controller: "self", zone: "deck" }, count: 5 }
          ],
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "opponent",
              declaration: {
                id: "chosen",
                selector: {
                  conditions: [
                    { type: "targetInSelection", target: { type: "selected", id: "__candidate" }, selection: "found" }
                  ]
                },
                count: { type: "selectionCount", id: "depleted" }
              },
              effects: [
                {
                  type: "forEach",
                  selected: "chosen",
                  effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }]
                },
                {
                  type: "forEach",
                  selected: "found",
                  effects: [
                    {
                      type: "if",
                      condition: {
                        type: "not",
                        condition: { type: "targetInSelection", target: { type: "selected", id: "__candidate" }, selection: "chosen" }
                      },
                      effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }]
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
}

describe("card behavior: Arcana Experiment (depleteSelected -> selectionCount -> targetInSelection)", () => {
  test("opponent chooses X=2 of the 5 found cards to keep; the rest go to discard", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "experiment", def: arcanaExperiment(), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1 },
        { key: "d2", def: character({ name: "D2" }), owner: P1 },
        { key: "f1", def: character({ name: "F1" }), owner: P1, zone: "deck" },
        { key: "f2", def: character({ name: "F2" }), owner: P1, zone: "deck" },
        { key: "f3", def: character({ name: "F3" }), owner: P1, zone: "deck" },
        { key: "f4", def: character({ name: "F4" }), owner: P1, zone: "deck" },
        { key: "f5", def: character({ name: "F5" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("experiment"),
      selected: {
        depleted: [id("d1"), id("d2")],
        found: [id("f1"), id("f2"), id("f3"), id("f4"), id("f5")]
      }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("d1")].depleted, true);
    assert.equal(engine.state.cards[id("d2")].depleted, true);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.equal(engine.state.pendingChoice?.playerId, P2);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "chooserSelectsTarget", selected: [id("f1"), id("f2")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("f1")].zone, "hand");
    assert.equal(engine.state.cards[id("f2")].zone, "hand");
    assert.equal(engine.state.cards[id("f3")].zone, "discard");
    assert.equal(engine.state.cards[id("f4")].zone, "discard");
    assert.equal(engine.state.cards[id("f5")].zone, "discard");
  });

  test("X=0 when no characters are depleted; opponent sends all 5 to discard", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "experiment", def: arcanaExperiment(), owner: P1, zone: "hand" },
        { key: "f1", def: character({ name: "F1" }), owner: P1, zone: "deck" },
        { key: "f2", def: character({ name: "F2" }), owner: P1, zone: "deck" },
        { key: "f3", def: character({ name: "F3" }), owner: P1, zone: "deck" },
        { key: "f4", def: character({ name: "F4" }), owner: P1, zone: "deck" },
        { key: "f5", def: character({ name: "F5" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("experiment"),
      selected: {
        depleted: [],
        found: [id("f1"), id("f2"), id("f3"), id("f4"), id("f5")]
      }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "chooserSelectsTarget", selected: [] }
    });
    resolvePendingResponses(engine);

    for (const key of ["f1", "f2", "f3", "f4", "f5"]) {
      assert.equal(engine.state.cards[id(key)].zone, "discard");
    }
  });

  test("cannot be deployed with fewer than 5 cards in the deck", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "experiment", def: arcanaExperiment(), owner: P1, zone: "hand" },
        { key: "f1", def: character({ name: "F1" }), owner: P1, zone: "deck" }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "playCard",
        playerId: P1,
        cardId: id("experiment"),
        selected: { depleted: [], found: [id("f1")] }
      })
    );
  });
});
