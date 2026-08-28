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
                { label: "Gain 1 influence", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] },
                { label: "Gain 2 influence", effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }
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
              selector: { zone: "any", conditions: [nonResource] }
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
              options: [
                { label: "Decline", effects: [] },
                { label: "Put a token on this card", effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }
              ]
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
              options: [
                { label: "Decline", effects: [] },
                { label: "Put a token on this card", effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }
              ]
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
                  zone: "any",
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

// ===========================================================================
// Seed 3 coverage — Wave A: primitive expression / condition vocabulary
// (printedStat, resourceIcons, cardTradeIs, hasUnique). One card shape each.
// ===========================================================================

// "printed life minus 2" — Fornicaves-style: a continuous debuff whose amount
// is derived from the target's PRINTED life, not its current (modified) life.
describe("Seed 3 Wave A: printedStat expression", () => {
  test("createModifier value = printedStat resolves against the definition, ignoring other modifiers", () => {
    const debuffer = item({
      name: "Printed-Life Debuffer",
      behavior: {
        abilities: [
          {
            id: "debuff",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [
              {
                type: "createModifier",
                target: { type: "selected", id: "t" },
                stat: "life",
                operation: "add",
                // lose (printed life - 2): printed 5 -> -3
                value: {
                  type: "multiply",
                  values: [
                    -1,
                    { type: "add", values: [{ type: "printedStat", target: { type: "selected", id: "t" }, stat: "life" }, -2] }
                  ]
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
        { key: "src", def: debuffer, owner: P1 },
        { key: "bear", def: character({ name: "Bear", life: 5 }), owner: P1 }
      ]
    });

    // pre-existing +10 life modifier must NOT feed back into printedStat
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("src"),
      abilityId: "debuff",
      selected: { t: [id("bear")] }
    });
    resolvePendingResponses(engine);

    // 5 printed - 3 = 2
    assert.equal(engine.getStat(id("bear"), "life"), 2);
  });
});

// "X is the number of [O] you control" — Devilfang Thunderhoof / Fecal Urgency.
describe("Seed 3 Wave A: resourceIcons expression", () => {
  test("counts a player's in-play resource icons of one type", () => {
    const obsession = resourceCard({ name: "Obsession", resource: { provides: ["obsession"], staple: true } });
    const drawPerIcon = tactic({
      name: "Draw Per Obsession",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            effects: [
              { type: "draw", player: "controller", amount: { type: "resourceIcons", player: "controller", icon: "obsession" } }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "t", def: drawPerIcon, owner: P1, zone: "hand" },
        { key: "o1", def: obsession, owner: P1 },
        { key: "o2", def: obsession, owner: P1 },
        { key: "o3", def: obsession, owner: P1 },
        { key: "fd", def: character({ name: "FaceDown" }), owner: P1, faceDown: true },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        { key: "d3", def: character({ name: "D3" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    resolvePendingResponses(engine);
    // tactic left hand; 3 obsession resources -> drew d1/d2/d3 (the face-down
    // resource provides volition, not obsession, so it doesn't count).
    assert.deepEqual(
      [...engine.state.players[P1].hand].map(cid => engine.getDefinition(cid).name).sort(),
      ["D1", "D2", "D3"]
    );
  });
});

// "all non-Rogue characters" — Delicious Strawberry Flavored Death.
describe("Seed 3 Wave A: cardTradeIs condition", () => {
  test("selector `conditions` with not(cardTradeIs) excludes a trade", () => {
    const depleteNonRogue = tactic({
      name: "Deplete Non-Rogue",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            effects: [
              {
                type: "forEach",
                selector: {
                  zone: "play",
                  type: "character",
                  conditions: [
                    { type: "not", condition: { type: "cardTradeIs", target: { type: "selected", id: "__candidate" }, trade: "rogue" } }
                  ]
                },
                effects: [{ type: "deplete", target: { type: "selected", id: "__candidate" } }]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "t", def: depleteNonRogue, owner: P1, zone: "hand" },
        { key: "warlord", def: character({ name: "Warlord Guy", trade: "warlord" }), owner: P1 },
        { key: "rogue", def: character({ name: "Rogue Guy", trade: "rogue" }), owner: P1 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("warlord")].depleted, true);
    assert.equal(engine.state.cards[id("rogue")].depleted, false);
  });
});

// "pick a character with the UNIQUE keyword in its rules text" — Prestige Inversion.
describe("Seed 3 Wave A: hasUnique condition", () => {
  test("selector `conditions` restricts targeting to cards with a Unique designation", () => {
    const removeUnique = tactic({
      name: "Remove Unique",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            targets: [
              {
                id: "t",
                selector: {
                  zone: "play",
                  type: "character",
                  conditions: [{ type: "hasUnique", target: { type: "selected", id: "__candidate" } }]
                },
                count: 1
              }
            ],
            effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "t", def: removeUnique, owner: P1, zone: "hand" },
        { key: "uniq", def: character({ name: "Unique One", unique: "one" }), owner: P2 },
        { key: "plain", def: character({ name: "Plain" }), owner: P2 }
      ]
    });

    // targeting the non-unique character is illegal
    assert.throws(() =>
      engine.perform({
        type: "playCard",
        playerId: P1,
        cardId: id("t"),
        selected: { t: [id("plain")] }
      })
    );

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("t"),
      selected: { t: [id("uniq")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("uniq")].zone, "removed");
  });
});

// ===========================================================================
// Seed 3 coverage — Wave B: mill effect, bind effect
// ===========================================================================

// "You may put the top 3 cards of that opponent's deck into their discard
// pile." — Ipsighast, the Lustful.
describe("Seed 3 Wave B: mill effect", () => {
  test("moves the top N cards of a deck to its owner's discard", () => {
    const millCard = tactic({
      name: "Mill 3",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            effects: [{ type: "mill", player: "opponent", count: 3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "t", def: millCard, owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P2, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P2, zone: "deck" },
        { key: "d3", def: character({ name: "D3" }), owner: P2, zone: "deck" },
        { key: "d4", def: character({ name: "D4" }), owner: P2, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    resolvePendingResponses(engine);

    assert.deepEqual(engine.state.players[P2].deck, [id("d4")]);
    assert.deepEqual([...engine.state.players[P2].discard].sort(), [id("d1"), id("d2"), id("d3")].sort());
  });

  test("mills only what's there when the deck is shorter than count", () => {
    const millCard = tactic({
      name: "Mill 5",
      behavior: { abilities: [{ id: "x", type: "activated", effects: [{ type: "mill", player: "controller", count: 5 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "t", def: millCard, owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].deck.length, 0);
    assert.equal(engine.state.players[P1].discard.includes(id("d1")), true);
  });
});

// "When a character enters play under your control, you may destroy that
// character. If you do, X is that character's strength ... it gains X strength
// this turn." — Merbegon: capture a stat before the source of it is gone.
describe("Seed 3 Wave B: bind effect", () => {
  test("captures a value before a later effect removes the card it came from", () => {
    const grafter = character({
      name: "Stat Grafter",
      behavior: {
        abilities: [
          {
            id: "graft",
            type: "activated",
            targets: [
              { id: "victim", selector: { zone: "play", type: "character", conditions: [{ type: "not", condition: { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "faction" } }] }, count: 1 },
              { id: "buffed", selector: { zone: "play", type: "character" }, count: 1 }
            ],
            effects: [
              { type: "bind", id: "gx", value: { type: "stat", target: { type: "selected", id: "victim" }, stat: "strength" } },
              { type: "destroy", target: { type: "selected", id: "victim" } },
              {
                type: "createModifier",
                target: { type: "selected", id: "buffed" },
                stat: "strength",
                operation: "add",
                value: { type: "variable", id: "gx" },
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "grafter", def: grafter, owner: P1 },
        { key: "victim", def: character({ name: "Beefy", strength: 6 }), owner: P1 },
        { key: "buffed", def: character({ name: "Recipient", strength: 2 }), owner: P1 }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("grafter"),
      abilityId: "graft",
      selected: { victim: [id("victim")], buffed: [id("buffed")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "discard");
    // 2 base + 6 captured from the (now destroyed) victim
    assert.equal(engine.getStat(id("buffed"), "strength"), 8);
  });
});

// ===========================================================================
// Seed 3 coverage — Wave C: continuous auras (selector-based ContinuousAbility
// modifiers / keyword grants), with per-target derived values.
// ===========================================================================

// "All characters lose X life, where X is their printed life minus 2." —
// Fornicaves. A live, selector-scoped modifier whose amount is per-target.
describe("Seed 3 Wave C: continuous aura modifier (selector form)", () => {
  test("applies to every matching card with a per-target derived value", () => {
    const fornicaves = location({
      name: "Fornicaves",
      structure: 1,
      behavior: {
        abilities: [
          {
            id: "aura",
            type: "continuous",
            modifiers: [
              {
                selector: { zone: "play", type: "character" },
                stat: "life",
                operation: "add",
                // -(printedLife - 2)
                value: {
                  type: "multiply",
                  values: [
                    -1,
                    { type: "add", values: [{ type: "printedStat", target: { type: "selected", id: "__candidate" }, stat: "life" }, -2] }
                  ]
                }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "cave", def: fornicaves, owner: P1 },
        { key: "a", def: character({ name: "A", life: 5 }), owner: P1 },
        { key: "b", def: character({ name: "B", life: 3 }), owner: P2 }
      ]
    });

    // every character ends at printed life - (printed life - 2) = 2
    assert.equal(engine.getStat(id("a"), "life"), 2);
    assert.equal(engine.getStat(id("b"), "life"), 2);

    // aura is live: it stops the instant the source leaves play
    engine.state.cards[id("cave")].zone = "discard";
    assert.equal(engine.getStat(id("a"), "life"), 5);
  });

  test("aura keyword grant reaches every matching card", () => {
    const hideout = location({
      name: "Covert Hideout",
      behavior: {
        abilities: [
          {
            id: "aura",
            type: "continuous",
            modifiers: [],
            keywords: [{ selector: { controller: "self", zone: "play", type: "character" }, keyword: "covert" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "hideout", def: hideout, owner: P1 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 }
      ]
    });

    assert.equal(engine.hasKeyword(id("mine"), "covert"), true);
    assert.equal(engine.hasKeyword(id("theirs"), "covert"), false);
  });
});

// "Your opponents must pay 1 to deploy a tactic." — Vilghame Manewaft.
// "Reduce the numeric cost of characters you play by 2, to a minimum of 1." —
// Ensmallment Ray.
describe("Seed 3 Wave C: costModifiers (continuous deploy-cost adjustment)", () => {
  test("taxes an opponent's matching deploys and discounts the controller's, with a floor", () => {
    const tycoon = character({
      name: "Cost Tycoon",
      behavior: {
        abilities: [
          {
            id: "econ",
            type: "continuous",
            modifiers: [],
            costModifiers: [
              { affects: "opponent", delta: 1, selector: { zone: "any", type: "tactic" } },
              { affects: "controller", delta: -2, minCost: 1, selector: { zone: "any", type: "character" } }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "tycoon", def: tycoon, owner: P1 },
        { key: "p1char", def: character({ name: "P1 Char", cost: 5 }), owner: P1, zone: "hand" },
        { key: "p2tac", def: tactic({ name: "P2 Tactic", cost: 2 }), owner: P2, zone: "hand" },
        { key: "p1tac", def: tactic({ name: "P1 Tactic", cost: 2 }), owner: P1, zone: "hand" }
      ]
    });

    // controller's character: 5 - 2 = 3
    assert.equal(engine.getCardPlayability(P1, id("p1char")).numericCost, 3);
    // opponent's tactic: 2 + 1 = 3
    assert.equal(engine.getCardPlayability(P2, id("p2tac")).numericCost, 3);
    // controller's own tactic: unaffected (selector is character-only)
    assert.equal(engine.getCardPlayability(P1, id("p1tac")).numericCost, 2);

    // floor: a cheap character can't go below minCost 1
    const cheap = character({ name: "Cheap", cost: 2 });
    const g2 = buildGame({
      cards: [
        { key: "tycoon", def: tycoon, owner: P1 },
        { key: "cheap", def: cheap, owner: P1, zone: "hand" }
      ]
    });
    assert.equal(g2.engine.getCardPlayability(P1, g2.id("cheap")).numericCost, 1);
  });
});

// "When battle damage is inflicted to a character you control, reduce the
// amount by 2. ...to a character an opponent controls, increase the amount by
// 2." — Shieldmane Grandchest.
describe("Seed 3 Wave C: damageModifiers (continuous battle-damage adjustment)", () => {
  test("reduces incoming battle damage to controlled characters, floored at 0", () => {
    const shield = character({
      name: "Shieldmane",
      strength: 6,
      life: 6,
      behavior: {
        abilities: [
          {
            id: "ward",
            type: "continuous",
            modifiers: [],
            damageModifiers: [
              { selector: { controller: "self", type: "character" }, battleOnly: true, delta: -2 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "shield", def: shield, owner: P1, attackEligible: false },
        { key: "ally", def: character({ name: "Ally", life: 5, speed: 1 }), owner: P1, attackEligible: false },
        { key: "attacker", def: character({ name: "Attacker", strength: 3, speed: 2 }), owner: P2 }
      ],
      activePlayerId: P2
    });

    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("ally")] });
    resolvePendingResponses(engine);
    autoResolveBattle(engine);

    // 3 strength - 2 ward = 1 damage taken
    assert.equal(engine.state.cards[id("ally")].damage, 1);
  });

  // CR §609.1f + §408.2: damage from several characters to the same thing
  // this round is inflicted as a single summed amount, and the reduction
  // applies once to that sum. Two attackers each assigning 2 to one warded
  // blocker => (2 + 2) - 2 = 2, NOT (2-2) + (2-2) = 0.
  test("applies once to the summed speed-group amount, not per assignment", () => {
    const shield = character({
      name: "Shieldmane",
      strength: 1,
      life: 6,
      behavior: {
        abilities: [
          {
            id: "ward",
            type: "continuous",
            modifiers: [],
            damageModifiers: [
              { selector: { controller: "self", type: "character" }, battleOnly: true, delta: -2 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "shield", def: shield, owner: P1, attackEligible: false },
        { key: "blocker", def: character({ name: "Blocker", life: 8, speed: 1 }), owner: P1, attackEligible: false },
        { key: "a1", def: character({ name: "A1", strength: 2, speed: 2 }), owner: P2 },
        { key: "a2", def: character({ name: "A2", strength: 2, speed: 2 }), owner: P2 }
      ],
      activePlayerId: P2
    });

    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("a1"), id("a2")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("blocker")] });
    resolvePendingResponses(engine);
    autoResolveBattle(engine, source => {
      if (source.cardId !== id("a1") && source.cardId !== id("a2")) {
        return source.legalTargets.length > 0 && source.strength > 0
          ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }]
          : [];
      }
      return [
        { sourceId: source.cardId, target: { type: "card", cardId: id("blocker") }, amount: source.strength }
      ];
    });

    assert.equal(engine.state.cards[id("blocker")].damage, 2);
  });

  // RULES.md §8 / CR §408.2 + §408.3: combat damage to a faction IS damage —
  // increase/reduction effects apply to it before it converts to influence
  // loss. Only a direct "loses N influence" effect (CR §408.3b) is exempt.
  test("a battle-damage reduction on your faction cuts the influence an unblocked attacker costs you", () => {
    const bulwark = character({
      name: "Bulwark",
      behavior: {
        abilities: [
          {
            id: "ward-faction",
            type: "continuous",
            modifiers: [],
            damageModifiers: [
              { selector: { controller: "self", type: "faction" }, battleOnly: true, delta: -2 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "bulwark", def: bulwark, owner: P1, attackEligible: false },
        { key: "raider", def: character({ name: "Raider", strength: 3 }), owner: P2 }
      ]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("raider")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);

    // 3 strength - 2 ward = 1 influence lost.
    assert.equal(engine.state.players[P1].influence, before - 1);
  });

  test("the same reduction does NOT touch a direct 'loses N influence' effect (CR §408.3b)", () => {
    const bulwark = character({
      name: "Bulwark",
      behavior: {
        abilities: [
          {
            id: "ward-faction",
            type: "continuous",
            modifiers: [],
            damageModifiers: [
              { selector: { controller: "self", type: "faction" }, battleOnly: true, delta: -2 }
            ]
          }
        ]
      }
    });
    const drain = tactic({
      name: "Drain",
      behavior: {
        abilities: [
          {
            id: "d",
            type: "activated",
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "bulwark", def: bulwark, owner: P1 },
        { key: "drain", def: drain, owner: P2, zone: "hand" }
      ]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({ type: "playCard", playerId: P2, cardId: id("drain") });
    resolvePendingResponses(engine);

    // Full 3 lost — a "loses influence" effect isn't damage.
    assert.equal(engine.state.players[P1].influence, before - 3);
  });
});

// ===========================================================================
// Seed 3 coverage — Wave D: deckPosition TargetRef + moveCard `position`
// ===========================================================================

// "While the top card of your deck is revealed, this card gains X strength,
// where X is the numeric cost of that card." — Axeclaw Grandchest.
// "...put it on top of your deck." — The Stone of Triumph.
describe("Seed 3 Wave D: deckPosition ref + moveCard position", () => {
  test("deckPosition resolves the top card; cardCost reads its printed cost", () => {
    const grandchest = character({
      name: "Axeclaw Grandchest",
      strength: 0,
      behavior: {
        abilities: [
          {
            id: "topcard-buff",
            type: "continuous",
            modifiers: [
              {
                target: "source",
                stat: "strength",
                operation: "add",
                value: { type: "cardCost", target: { type: "deckPosition", player: "controller", from: "top" } }
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "gc", def: grandchest, owner: P1 },
        { key: "top", def: character({ name: "Top", cost: 6 }), owner: P1, zone: "deck" },
        { key: "next", def: character({ name: "Next", cost: 2 }), owner: P1, zone: "deck" }
      ]
    });

    assert.equal(engine.getStat(id("gc"), "strength"), 6);
  });

  test("moveCard with position:'top' puts a card on top of the deck", () => {
    const tutor = tactic({
      name: "To The Top",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "deck", position: "top" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "t", def: tutor, owner: P1, zone: "hand" },
        { key: "grave", def: character({ name: "Grave" }), owner: P1, zone: "discard" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("t"), selected: { t: [id("grave")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].deck[0], id("grave"));
  });
});

// ===========================================================================
// Seed 3 coverage — Wave E: terminate (response-stack removal / "counter")
// ===========================================================================

// "When a player deploys a tactic, terminate it and inflict 1 damage to this
// card." — The Great Wall of Keeping Stuff Out.
describe("Seed 3 Wave E: terminate effect", () => {
  test("a cardPlayed trigger terminates the just-played tactic before it resolves", () => {
    const wall = location({
      name: "Great Wall",
      structure: 2,
      behavior: {
        abilities: [
          {
            id: "wall-trigger",
            type: "triggered",
            event: "cardPlayed",
            condition: { type: "cardTypeIs", target: "eventCard", cardType: "tactic" },
            effects: [
              { type: "terminate", target: "eventCard" },
              { type: "dealDamage", target: "source", amount: 1 }
            ]
          }
        ]
      }
    });

    const bomb = tactic({
      name: "Influence Bomb",
      behavior: {
        abilities: [
          { id: "boom", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -5 }] }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "wall", def: wall, owner: P1 },
        { key: "bomb", def: bomb, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });

    const p1InfluenceBefore = engine.state.players[P1].influence;

    engine.perform({ type: "playCard", playerId: P2, cardId: id("bomb") });
    resolvePendingResponses(engine);

    // the tactic never resolved -> no influence loss; it's in its owner's discard
    assert.equal(engine.state.players[P1].influence, p1InfluenceBefore);
    assert.equal(engine.state.cards[id("bomb")].zone, "discard");
    // and the wall took 1 damage
    assert.equal(engine.state.cards[id("wall")].damage, 1);
  });

  test("scope 'othersOnStack' terminates every other unresolved card", () => {
    const alarm = tactic({
      name: "Alarm",
      behavior: {
        abilities: [{ id: "x", type: "activated", effects: [{ type: "terminate", scope: "othersOnStack" }] }]
      }
    });
    const other = tactic({
      name: "Other",
      behavior: {
        abilities: [{ id: "y", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] }]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "other", def: other, owner: P1, zone: "hand" },
        { key: "alarm", def: alarm, owner: P2, zone: "hand" }
      ]
    });

    const p2Before = engine.state.players[P2].influence;

    // P1 plays Other (opens a response window); P2 responds with Alarm.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("other") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("alarm") });
    resolvePendingResponses(engine);

    // Alarm resolved (LIFO) and terminated Other before it could resolve.
    assert.equal(engine.state.players[P2].influence, p2Before);
    assert.equal(engine.state.cards[id("other")].zone, "discard");
  });
});

// ===========================================================================
// Seed 3 coverage — Wave F: activate-from-zone (RECUR) + removeFromGame /
// sacrificeSelected costs
// ===========================================================================

// "RECUR: [G][G] — COST: Use this only while this card is in your discard
// pile. Pay 1. Remove this card from the game. — EFFECT: Draw a card." —
// Prestige Inversion.
describe("Seed 3 Wave F: activationZone (RECUR from discard) + removeFromGame cost", () => {
  test("an ability with activationZone 'discard' is usable from the discard pile and exiles itself", () => {
    const recur = tactic({
      name: "Prestige Inversion",
      behavior: {
        abilities: [
          // the normal play-time effect (unused here)
          { id: "main", type: "activated", effects: [{ type: "draw", player: "controller", amount: 0 }] },
          {
            id: "recur",
            type: "activated",
            activationZone: "discard",
            costs: [
              { type: "payResources", amount: 1 },
              { type: "removeFromGame", target: "source" }
            ],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "pi", def: recur, owner: P1, zone: "discard" },
        { key: "res", def: resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } }), owner: P1 },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });

    // can't use it while it'd need to be in play
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pi"), abilityId: "recur" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("pi")].zone, "removed");
    assert.equal(engine.state.players[P1].hand.includes(id("d1")), true);
  });

  test("activationZone defaults to 'play' — a discard card can't use a normal ability", () => {
    const t = tactic({
      name: "Normal",
      behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
    const { engine, id } = buildGame({ cards: [{ key: "t", def: t, owner: P1, zone: "discard" }] });
    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("t"), abilityId: "a" })
    );
  });

  // "RECUR: [G][G]" — an ability-level `threshold` gate (Prestige Inversion).
  test("an ability's `threshold` gates activation, same shorthand as a card's", () => {
    const recur = tactic({
      name: "Prestige Inversion",
      behavior: {
        abilities: [
          { id: "main", type: "activated", effects: [{ type: "draw", player: "controller", amount: 0 }] },
          {
            id: "recur",
            type: "activated",
            activationZone: "discard",
            threshold: "gg",
            costs: [{ type: "payResources", amount: 1 }],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const greed = () => resourceCard({ name: "Greed", resource: { provides: ["greed"], staple: true } });

    // one [G] — threshold "gg" unmet
    const short = buildGame({
      cards: [
        { key: "pi", def: recur, owner: P1, zone: "discard" },
        { key: "g1", def: greed(), owner: P1 }
      ]
    });
    assert.throws(() =>
      short.engine.perform({ type: "activateAbility", playerId: P1, cardId: short.id("pi"), abilityId: "recur" })
    );

    // two [G] — threshold met
    const ok = buildGame({
      cards: [
        { key: "pi", def: recur, owner: P1, zone: "discard" },
        { key: "g1", def: greed(), owner: P1 },
        { key: "g2", def: greed(), owner: P1 },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });
    ok.engine.perform({ type: "activateAbility", playerId: P1, cardId: ok.id("pi"), abilityId: "recur" });
    resolvePendingResponses(ok.engine);
    assert.equal(ok.engine.state.players[P1].hand.includes(ok.id("d1")), true);
  });
});

// "EXTRA COST: Choose X > 0. Remove X tactics in your discard pile from the
// game." — Cowslaw.
describe("Seed 3 Wave F: sacrificeSelected cost", () => {
  test("consumes every selected card by the given disposition", () => {
    const cowslaw = tactic({
      name: "Cowslaw",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            targets: [
              { id: "fodder", selector: { controller: "self", zone: "discard", type: "tactic" }, count: 2 }
            ],
            costs: [{ type: "sacrificeSelected", declarationId: "fodder", disposition: "removeFromGame" }],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "cs", def: cowslaw, owner: P1, zone: "hand" },
        { key: "g1", def: tactic({ name: "G1" }), owner: P1, zone: "discard" },
        { key: "g2", def: tactic({ name: "G2" }), owner: P1, zone: "discard" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("cs"),
      selected: { fodder: [id("g1"), id("g2")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("g1")].zone, "removed");
    assert.equal(engine.state.cards[id("g2")].zone, "removed");
    assert.equal(engine.state.players[P1].hand.includes(id("d1")), true);
  });
});

// ===========================================================================
// Seed 3 coverage — Wave G: eventOrdinal condition ("first ... each turn")
// ===========================================================================

// "The first resource each opponent plays each turn enters play attached to
// that player's faction." — Vilghame Manewaft (attach clause modelled here
// as an influence ping to keep the test focused on the ordinal gate).
describe("Seed 3 Wave G: eventOrdinal condition", () => {
  test("fires only on the first matching event of the turn, and resets next turn", () => {
    const vilghame = character({
      name: "Vilghame",
      behavior: {
        abilities: [
          {
            id: "first-resource",
            type: "triggered",
            event: "resourcePlayed",
            condition: {
              type: "and",
              conditions: [
                { type: "eventPlayerIs", player: "opponent" },
                { type: "eventOrdinal", operator: "=", value: 1 }
              ]
            },
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
          }
        ]
      }
    });

    const resourceFaction = factionCard({
      name: "Resource Faction",
      faction: {
        startingInfluence: 25,
        setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [{ type: "playResource", count: 1 }] }
        }
      }
    });

    const { engine, id } = buildGame({
      playerB: { faction: resourceFaction },
      cards: [
        { key: "vil", def: vilghame, owner: P1 },
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P2, zone: "hand" },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });

    const start = engine.state.players[P2].influence;

    engine.perform({
      type: "chooseDevelop",
      playerId: P2,
      choice: { type: "playResource", cards: [{ cardId: id("r1"), faceDown: false }] }
    });
    resolvePendingResponses(engine);
    // first resource of P2's turn -> ordinal 1 -> triggered
    assert.equal(engine.state.players[P2].influence, start - 1);

    // full turn cycle back to P2: turnEventTally reset, so it fires again
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "draw" } });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    const p2Turn2 = engine.state.players[P2].influence;
    engine.perform({
      type: "chooseDevelop",
      playerId: P2,
      choice: { type: "playResource", cards: [{ cardId: id("r2"), faceDown: false }] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, p2Turn2 - 1);
  });
});

// ===========================================================================
// Seed 3 coverage — Wave H: mustAttack restriction, dealDamage cost,
// setRestoreLock effect
// ===========================================================================

// "This turn, the characters must attack if they can." — 94r913 My 908570pp3r5.
describe("Seed 3 Wave H: mustAttack restriction", () => {
  test("declaring an attack that omits an eligible mustAttack character is rejected", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "forced", def: character({ name: "Forced", strength: 2 }), owner: P1 },
        { key: "free", def: character({ name: "Free", strength: 2 }), owner: P1 }
      ]
    });

    // grant mustAttack to "forced" this turn
    engine.state.restrictions.push({
      id: "r1",
      targetId: id("forced"),
      restriction: "mustAttack",
      duration: { type: "untilEndOfTurn" },
      createdTurn: engine.state.turn
    });

    assert.throws(() =>
      engine.perform({
        type: "declareAttack",
        playerId: P1,
        attackerIds: [id("free")],
        target: { type: "faction", playerId: P2 }
      })
    );

    // including it is fine
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("free"), id("forced")],
      target: { type: "faction", playerId: P2 }
    });
    assert.ok(engine.state.battle);
  });
});

// "PARTY ON! — COST: Inflict 1 damage to this location. ... — EFFECT: Deplete
// the character." — Intriguing Mezzanine.
describe("Seed 3 Wave H: dealDamage cost + setRestoreLock effect", () => {
  test("a location spends its own structure as a cost and locks the target from faction restore", () => {
    const mezzanine = location({
      name: "Intriguing Mezzanine",
      structure: 3,
      behavior: {
        abilities: [
          {
            id: "party-on",
            type: "activated",
            costs: [{ type: "dealDamage", target: "source", amount: 1 }],
            targets: [{ id: "victim", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [
              { type: "deplete", target: { type: "selected", id: "victim" } },
              { type: "setRestoreLock", target: { type: "selected", id: "victim" } }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "mez", def: mezzanine, owner: P1 },
        { key: "victim", def: character({ name: "Victim" }), owner: P1 }
      ],
      playerA: { faction: factionCard({ name: "restoring", faction: {
        startingInfluence: 25,
        setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [{ type: "draw", count: 1 }] }
        }
      } }) }
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("mez"),
      abilityId: "party-on",
      selected: { victim: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("mez")].damage, 1);
    assert.equal(engine.state.cards[id("victim")].depleted, true);
    assert.equal(engine.state.cards[id("victim")].restoreLocked, true);

    // P1's next turn start: the locked character is NOT restored
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    engine.perform({ type: "chooseDevelop", playerId: P2, choice: { type: "draw" } });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].depleted, true);
  });
});

// ===========================================================================
// Seed 3 coverage — Wave I: deploySameNameThisTurn + respondingTo /
// respondedToCard
// ===========================================================================

// "If an opponent deployed at least 2 cards with the same name this turn,
// ..." — Hilarious Refrigerator Alarm.
describe("Seed 3 Wave I: deploySameNameThisTurn condition", () => {
  test("true once a player has deployed 2+ identically-named cards this turn", () => {
    const probe = tactic({
      name: "Probe",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            effects: [
              {
                type: "if",
                condition: { type: "deploySameNameThisTurn", player: "controller", operator: ">=", value: 2 },
                effects: [{ type: "modifyInfluence", player: "controller", amount: 10 }]
              }
            ]
          }
        ]
      }
    });
    const twin = () => tactic({ name: "Twin", id: "twin-def", behavior: { abilities: [{ id: "n", type: "activated", effects: [{ type: "draw", player: "controller", amount: 0 }] }] } });

    const { engine, id } = buildGame({
      cards: [
        { key: "t1", def: twin(), owner: P1, zone: "hand" },
        { key: "t2", def: twin(), owner: P1, zone: "hand" },
        { key: "probe", def: probe, owner: P1, zone: "hand" }
      ]
    });

    const before = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("t1") });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("t2") });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("probe") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before + 10);
  });
});

// "Deploy this only in response to a character being deployed. ... Terminate
// the character." — Anatidaephobia.
describe("Seed 3 Wave I: respondingTo condition + respondedToCard ref", () => {
  test("gates play timing and lets the effect reach the responded-to card", () => {
    const anat = tactic({
      name: "Anatidaephobia",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            condition: { type: "respondingTo", cardType: "character" },
            effects: [{ type: "terminate", target: { type: "respondedToCard" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "anat", def: anat, owner: P2, zone: "hand" },
        { key: "guy", def: character({ name: "Incoming Guy" }), owner: P1, zone: "hand" }
      ]
    });

    // Not legal with nothing to respond to
    assert.throws(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("anat") }));

    // P1 deploys a character -> opens a response window; P2 responds with Anat
    engine.perform({ type: "playCard", playerId: P1, cardId: id("guy") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("anat") });
    resolvePendingResponses(engine);

    // the character was terminated before entering play
    assert.equal(engine.state.cards[id("guy")].zone, "discard");
  });
});

// "EXTRA COST: ... If you did not deploy this card using FLIP UP, pay X,
// where X is the character's numeric cost." — Anatidaephobia. A hard
// play-time cost (not a "you may"), waived when the card is FLIP-UP'd,
// expressed as a `conditional` cost amount over `deployedViaFlipUp`.
describe("Seed 3 Wave I: Anatidaephobia — play-time 'pay X' hard cost, waived on FLIP UP", () => {
  function anat(): CardDefinition {
    return tactic({
      name: "AnatHardCost",
      threshold: "g",
      flipUp: { cost: 1, threshold: "g" },
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            condition: { type: "respondingTo", cardType: "character" },
            costs: [
              {
                type: "payResources",
                amount: {
                  type: "conditional",
                  if: { type: "deployedViaFlipUp" },
                  then: 0,
                  else: { type: "cardCost", target: { type: "respondedToCard" } }
                }
              }
            ],
            effects: [{ type: "terminate", target: { type: "respondedToCard" } }]
          }
        ]
      }
    });
  }

  const greed = (name: string) =>
    resourceCard({ name, resource: { provides: ["greed"], staple: true } });
  const plain = (name: string) => resourceCard({ name });
  const plainMany = (prefix: string, n: number, owner: typeof P1) =>
    Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: plain(`${prefix}${i}`), owner }));

  test("normal play pays X = the responded-to character's numeric cost", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "anat", def: anat(), owner: P2, zone: "hand" },
        { key: "g1", def: greed("G1"), owner: P2 },
        { key: "g2", def: greed("G2"), owner: P2 },
        { key: "g3", def: greed("G3"), owner: P2 },
        ...plainMany("p1r", 3, P1),
        { key: "guy", def: character({ name: "Guy", cost: 3 }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("guy") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("anat") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("guy")].zone, "discard");
    // all 3 greed resources spent on X
    assert.equal(engine.getAvailableResourceCount(P2), 0);
  });

  test("normal play is rejected outright when X is unaffordable", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "anat", def: anat(), owner: P2, zone: "hand" },
        { key: "g1", def: greed("G1"), owner: P2 },
        { key: "g2", def: greed("G2"), owner: P2 },
        ...plainMany("p1r", 4, P1),
        { key: "guy", def: character({ name: "Guy", cost: 4 }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("guy") });
    assert.throws(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("anat") }));

    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "play");
  });

  test("FLIP UP waives X — only the flip-up cost is paid", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "anat", def: anat(), owner: P2, faceDown: true },
        { key: "g1", def: greed("G1"), owner: P2 },
        ...plainMany("p1r", 6, P1),
        { key: "guy", def: character({ name: "Guy", cost: 6 }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("guy") });
    engine.perform({ type: "flipUp", playerId: P2, cardId: id("anat"), selected: {} });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("guy")].zone, "discard");
    // the single greed resource paid the flip-up cost of 1; X was not charged
    assert.equal(engine.getAvailableResourceCount(P2), 0);
  });
});

// ===========================================================================
// Seed 3 coverage — Wave J: FLIP UP (alternate deploy of a face-down card)
// ===========================================================================

// "EXTRA COST: If you deployed this card using FLIP UP X is 4, otherwise X is
// 2. Pick X or fewer characters. This turn, the characters must attack if
// they can. Draw a card.  FLIP UP: 2 [E]" — 94r913 My 908570pp3r5.
describe("Seed 3 Wave J: flipUp action + deployedViaFlipUp condition", () => {
  function poppers(): CardDefinition {
    return tactic({
      name: "908570pp3r5",
      cost: 3,
      threshold: "e",
      flipUp: {
        cost: 2,
        threshold: "e",
        effects: []
      },
      behavior: {
        abilities: [
          {
            id: "main",
            type: "activated",
            variables: {
              x: {
                // deployedViaFlipUp ? 4 : 2 — modelled as 2 + 2*(flag)
                type: "add",
                values: [2, 2]
              }
            },
            targets: [
              { id: "picked", selector: { zone: "play", type: "character" }, count: { type: "variable", id: "x" }, optional: true }
            ],
            effects: [
              {
                type: "forEach",
                selected: "picked",
                effects: [
                  { type: "grantRestriction", target: { type: "selected", id: "__candidate" }, restriction: "mustAttack", duration: { type: "untilEndOfTurn" } }
                ]
              },
              { type: "draw", player: "controller", amount: 1 }
            ]
          }
        ]
      }
    });
  }

  test("a face-down resource can be flipped up by paying its FLIP UP cost and resolves with deployedViaFlipUp", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pop", def: poppers(), owner: P1, faceDown: true },
        { key: "e1", def: resourceCard({ name: "E1", resource: { provides: ["elitism"], staple: true } }), owner: P1 },
        { key: "e2", def: resourceCard({ name: "E2", resource: { provides: ["elitism"], staple: true } }), owner: P1 },
        { key: "e3", def: resourceCard({ name: "E3", resource: { provides: ["elitism"], staple: true } }), owner: P1 },
        { key: "target", def: character({ name: "Target" }), owner: P1 },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "flipUp",
      playerId: P1,
      cardId: id("pop"),
      selected: { picked: [id("target")] }
    });
    resolvePendingResponses(engine);

    // resolved as a tactic -> discard; drew a card; target forced to attack
    assert.equal(engine.state.cards[id("pop")].zone, "discard");
    assert.equal(engine.state.cards[id("pop")].faceDown, false);
    assert.equal(engine.state.players[P1].hand.includes(id("d1")), true);
    assert.equal(engine.hasRestriction(id("target"), "mustAttack"), true);
  });

  test("flipUp is rejected when the FLIP UP threshold isn't met", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pop", def: poppers(), owner: P1, faceDown: true },
        // rage icons only — the FLIP UP threshold "e" is unmet
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "flipUp", playerId: P1, cardId: id("pop"), selected: { picked: [] } })
    );
  });

  // A FLIP UP whose own effect pauses on a chooser: resolution suspends on
  // the pendingChoice, and the "move the flipped tactic to discard"
  // bookkeeping waits until the paused effect has finished (finishFlipUp).
  test("a FLIP UP whose effect pauses on a chooser suspends, then finishes on resume", () => {
    const searcher = tactic({
      name: "FlipSearcher",
      flipUp: { cost: 1, threshold: "o" },
      behavior: {
        abilities: [
          {
            id: "main",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: {
                  id: "pick",
                  selector: { controller: "self", zone: "hand" },
                  count: 1,
                  optional: true
                },
                effects: [
                  {
                    type: "if",
                    condition: { type: "targetExists", target: { type: "selected", id: "pick" } },
                    effects: [
                      { type: "moveCard", target: { type: "selected", id: "pick" }, to: "discard" }
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
        { key: "pop", def: searcher, owner: P1, faceDown: true },
        { key: "o1", def: resourceCard({ name: "O1", resource: { provides: ["obsession"], staple: true } }), owner: P1 },
        { key: "o2", def: resourceCard({ name: "O2", resource: { provides: ["obsession"], staple: true } }), owner: P1 },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "flipUp", playerId: P1, cardId: id("pop"), selected: {} });

    // Suspended on the chooser; the flipped tactic has NOT gone to discard yet.
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.equal(engine.state.cards[id("pop")].faceDown, false);
    assert.equal(engine.state.cards[id("pop")].zone, "play");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("h1")] }
    });

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("h1")].zone, "discard");
    assert.equal(engine.state.cards[id("h2")].zone, "hand");
    assert.equal(engine.state.cards[id("pop")].zone, "discard");
  });
});

// ===========================================================================
// Seed 3 coverage — Wave K: replacement abilities ("...instead")
// ===========================================================================

// "If a character would be put into a player's hand, destroy it instead." —
// The Stone of Shame.
describe("Seed 3 Wave K: replacement ability (moveToZone -> destroy instead)", () => {
  test("a character bounced to hand is destroyed instead while the Stone is in play", () => {
    const stone = item({
      name: "The Stone of Shame",
      behavior: {
        abilities: [
          {
            id: "shame",
            type: "replacement",
            replaces: { event: "moveToZone", zone: "hand", cardType: "character" },
            effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }]
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
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "stone", def: stone, owner: P1 },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 },
        { key: "bounce", def: bounce, owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("bounce"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);

    // replaced: it's in the discard pile, not its owner's hand
    assert.equal(engine.state.cards[id("victim")].zone, "discard");
    assert.equal(engine.state.players[P2].hand.includes(id("victim")), false);
  });

  test("with the Stone gone, the bounce works normally", () => {
    const stone = item({
      name: "The Stone of Shame",
      behavior: {
        abilities: [
          {
            id: "shame",
            type: "replacement",
            replaces: { event: "moveToZone", zone: "hand", cardType: "character" },
            effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }]
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
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "stone", def: stone, owner: P1, zone: "discard" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 },
        { key: "bounce", def: bounce, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bounce"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].hand.includes(id("victim")), true);
  });

  // CR §506.2 / §506.2a: a replacement never applies to something happening
  // as part of an extra cost — but a replacement on a card *attached* to the
  // cost-paid card still does.
  test("a card destroyed as an ability cost is really gone, but an attached card's own replacement still fires", () => {
    const guardedChar = character({
      name: "Guarded",
      behavior: {
        abilities: [
          {
            // "if this would be destroyed, put it into its owner's hand instead"
            id: "self-guard",
            type: "replacement",
            replaces: { event: "destroy" },
            effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }]
          }
        ]
      }
    });

    const clingyGear = item({
      name: "Clingy Gear",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            // "if an item would be put into a discard pile from play, remove
            // it from the game instead" (scoped to items so it doesn't also
            // catch the character destroyed as a cost).
            id: "gear-guard",
            type: "replacement",
            replaces: { event: "moveToZone", zone: "discard", cardType: "item" },
            effects: [{ type: "removeFromGame", target: { type: "selected", id: "__candidate" } }]
          }
        ]
      }
    });

    // Ability whose cost destroys a chosen character.
    const engineOfRuin = character({
      name: "Engine of Ruin",
      behavior: {
        abilities: [
          {
            id: "feed",
            type: "activated",
            targets: [{ id: "fuel", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
            costs: [{ type: "destroy", target: { type: "selected", id: "fuel" } }],
            effects: []
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "ruin", def: engineOfRuin, owner: P1 },
        { key: "guarded", def: guardedChar, owner: P1 },
        { key: "gear", def: clingyGear, owner: P1, attachedToKey: "guarded" }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("ruin"),
      abilityId: "feed",
      selected: { fuel: [id("guarded")] }
    });
    resolvePendingResponses(engine);

    // The destroy was an extra cost — the "put into hand instead"
    // replacement did NOT apply; Guarded is in the discard pile.
    assert.equal(engine.state.cards[id("guarded")].zone, "discard");
    assert.equal(engine.state.players[P1].hand.includes(id("guarded")), false);

    // The attached gear, now hostless, would go to the discard pile — but
    // its own replacement fires: removed from the game instead.
    assert.equal(engine.state.cards[id("gear")].zone, "removed");
  });
});

// ===========================================================================
// Seed 3 coverage — Wave L: optional replacement, nameValue, forEachPlayer,
// createTokens, mayPay + cardNameEquals, setDamage / removeFromBattle,
// useTargetAbility, uniqueGrant, non-tactic onPlay.
// ===========================================================================

// "If this card would be destroyed by an opposing card or effect, you may put
// a token on it instead..." — Giada, the Elegant.
describe("Seed 3 Wave L: optional replacement (pause + accept/decline)", () => {
  function giada(): CardDefinition {
    return character({
      name: "Giada",
      life: 3,
      unique: "giada",
      behavior: {
        abilities: [
          {
            id: "guard",
            name: "Elegant Guard",
            type: "replacement",
            replaces: { event: "destroy", controlledBy: "self", by: "opponent" },
            optional: true,
            effects: [
              { type: "addCounter", target: { type: "selected", id: "__candidate" }, counter: "token", amount: 1 },
              { type: "deplete", target: { type: "selected", id: "__candidate" } },
              { type: "setDamage", target: { type: "selected", id: "__candidate" }, amount: 0 }
            ]
          }
        ]
      }
    });
  }

  test("accepting the replacement stops the destruction", () => {
    const kill = tactic({
      name: "Kill",
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

    const { engine, id } = buildGame({
      cards: [
        { key: "giada", def: giada(), owner: P1, damage: 0 },
        { key: "kill", def: kill, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });

    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("giada")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "replacementChoice");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "replacementChoice", apply: true } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("giada")].zone, "play");
    assert.equal(engine.state.cards[id("giada")].counters.token, 1);
    assert.equal(engine.state.cards[id("giada")].depleted, true);
  });

  test("declining lets the destruction happen", () => {
    const kill = tactic({
      name: "Kill",
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
    const { engine, id } = buildGame({
      cards: [
        { key: "giada", def: giada(), owner: P1 },
        { key: "kill", def: kill, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("giada")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "replacementChoice", apply: false } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("giada")].zone, "discard");
  });

  // "...destroyed by an opposing card or effect..." — `replaces.by:
  // "opponent"`. Giada's own controller destroying her (a sacrifice)
  // doesn't offer the guard.
  test("a friendly card/effect destroying it does NOT offer the guard", () => {
    const sacrifice = tactic({
      name: "Sacrifice",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "giada", def: giada(), owner: P1 },
        { key: "sacrifice", def: sacrifice, owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("sacrifice"), selected: { t: [id("giada")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("giada")].zone, "discard");
  });

  // Lethal battle damage from an opposing character counts as "an opposing
  // card or effect" — the destruction is attributed to the attacker.
  test("lethal battle damage from an opponent's character offers the guard", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "giada", def: giada(), owner: P1, attackEligible: false },
        { key: "attacker", def: character({ name: "Attacker", strength: 5, speed: 2 }), owner: P2 }
      ],
      activePlayerId: P2
    });

    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("attacker")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("giada")] });
    resolvePendingResponses(engine);
    autoResolveBattle(engine);

    assert.equal(engine.state.pendingChoice?.kind, "replacementChoice");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "replacementChoice", apply: true } });
    resolvePendingResponses(engine);
    autoResolveBattle(engine);

    assert.equal(engine.state.cards[id("giada")].zone, "play");
    assert.equal(engine.state.cards[id("giada")].counters.token, 1);
  });
});

// "When this card enters play, name a card subtype. Players must pay 2 to
// deploy cards with the named subtype." — Port Manteau.
describe("Seed 3 Wave L: nameValue + subtypeVar cost modifier", () => {
  test("naming a subtype taxes deploys of that subtype", () => {
    const manteau = location({
      name: "Port Manteau",
      structure: 3,
      behavior: {
        abilities: [
          {
            id: "name",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "nameValue", chooser: "controller", valueKind: "subtype", storeAs: "banned" }]
          },
          {
            id: "tax",
            type: "continuous",
            modifiers: [],
            costModifiers: [{ affects: "controller", delta: 2, selector: { zone: "any", subtypeVar: "banned" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "manteau", def: manteau, owner: P1, zone: "hand" },
        { key: "lackey", def: character({ name: "A Lackey", subtype: ["lackey"], cost: 3 }), owner: P1, zone: "hand" },
        { key: "brute", def: character({ name: "A Brute", subtype: ["brute"], cost: 3 }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("manteau") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "nameValue");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "lackey" } });
    resolvePendingResponses(engine);

    assert.equal(engine.getCardPlayability(P1, id("lackey")).numericCost, 5);
    assert.equal(engine.getCardPlayability(P1, id("brute")).numericCost, 3);
  });
});

// "Each player chooses a card of each non-resource type they control..." —
// Spatchcocking (simplified: each player loses 1 influence).
describe("Seed 3 Wave L: forEachPlayer", () => {
  test("runs the effects once per player with controller rebound", () => {
    const spatch = tactic({
      name: "Spatch",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            effects: [
              { type: "forEachPlayer", effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [{ key: "s", def: spatch, owner: P1, zone: "hand" }]
    });
    const p1 = engine.state.players[P1].influence;
    const p2 = engine.state.players[P2].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("s") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, p1 - 1);
    assert.equal(engine.state.players[P2].influence, p2 - 1);
  });

  // A nested chooser effect that pauses *for every player* inside one
  // forEachPlayer: each player's frame must pause, resolve independently,
  // and resume in turn order (active player first). This is the
  // frame-reordering path in the forEachPlayer case of resolveEffect.
  test("a nested chooser that pauses for each player resolves per player, in turn order", () => {
    const each = tactic({
      name: "EachDiscards",
      behavior: {
        abilities: [
          {
            id: "e",
            type: "activated",
            effects: [
              {
                type: "forEachPlayer",
                effects: [
                  {
                    type: "chooserSelectsTarget",
                    chooser: "controller",
                    declaration: {
                      id: "pick",
                      selector: { controller: "self", zone: "hand" },
                      count: 1,
                      optional: true
                    },
                    effects: [
                      {
                        type: "if",
                        condition: { type: "targetExists", target: { type: "selected", id: "pick" } },
                        effects: [
                          { type: "moveCard", target: { type: "selected", id: "pick" }, to: "discard" }
                        ]
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
        { key: "e", def: each, owner: P1, zone: "hand" },
        { key: "h1a", def: character({ name: "H1A" }), owner: P1, zone: "hand" },
        { key: "h1b", def: character({ name: "H1B" }), owner: P1, zone: "hand" },
        { key: "h2a", def: character({ name: "H2A" }), owner: P2, zone: "hand" },
        { key: "h2b", def: character({ name: "H2B" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("e") });
    resolvePendingResponses(engine);

    // Active player (P1) is prompted first.
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.equal(engine.state.pendingChoice?.playerId, P1);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("h1a")] }
    });
    resolvePendingResponses(engine);

    // Then the opponent (P2).
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.equal(engine.state.pendingChoice?.playerId, P2);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "chooserSelectsTarget", selected: [id("h2b")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("h1a")].zone, "discard");
    assert.equal(engine.state.cards[id("h2b")].zone, "discard");
    assert.equal(engine.state.cards[id("h1b")].zone, "hand");
    assert.equal(engine.state.cards[id("h2a")].zone, "hand");
    assert.equal(engine.state.cards[id("e")].zone, "discard");
  });
});

// "If you ... choose to put this card on the bottom of your deck as part of
// your mulligan at the start of a game, ..." — Community Chest. The mulligan
// history now lives on GameState; `bottomedInMulligan` reads it.
describe("Seed 3 Wave L: bottomedInMulligan condition", () => {
  function boon(): CardDefinition {
    return tactic({
      name: "MulliganBoon",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            effects: [
              {
                type: "if",
                condition: { type: "bottomedInMulligan" },
                effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
              }
            ]
          }
        ]
      }
    });
  }

  test("true for a card its owner bottomed in the opening mulligan", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "boon", def: boon(), owner: P1, zone: "hand" }]
    });
    engine.state.mulligan[P1] = [id("boon")];

    const before = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("boon") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before + 5);
  });

  test("false for a card that wasn't bottomed", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "boon", def: boon(), owner: P1, zone: "hand" }]
    });

    const before = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("boon") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before);
  });
});

// "...put 1 Micromajig token into play under your control." — Unscrupuls of
// Victory.
describe("Seed 3 Wave L: createTokens", () => {
  test("puts token permanents into play that vanish on leaving play", () => {
    const maker = tactic({
      name: "Token Maker",
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            effects: [
              { type: "createTokens", controller: "controller", count: 2, token: { name: "Micromajig", cardType: "character", strength: 0, life: 1, speed: 1 } }
            ]
          }
        ]
      }
    });
    const sac = tactic({
      name: "Sac Token",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: maker, owner: P1, zone: "hand" },
        { key: "sac", def: sac, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("m") });
    resolvePendingResponses(engine);

    const tokens = engine.state.players[P1].play
      .map(cid => engine.state.cards[cid])
      .filter(c => c.isToken);
    assert.equal(tokens.length, 2);
    const tid = tokens[0].id;

    // destroying a token removes it from state entirely (no discard)
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sac"), selected: { t: [tid] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[tid], undefined);
    assert.equal(engine.state.players[P1].discard.includes(tid), false);
  });
});

// "When a character you control is destroyed, you may pay 1. If you do,
// search your deck for a card with the same name..." — The Stone of Triumph.
describe("Seed 3 Wave L: mayPay + cardNameEquals", () => {
  test("optional pay gates a same-name deck search", () => {
    const stone = item({
      name: "The Stone of Triumph",
      behavior: {
        abilities: [
          {
            id: "t",
            type: "triggered",
            event: "cardDestroyed",
            condition: {
              type: "and",
              conditions: [
                { type: "eventCardControlledBy", player: "controller" },
                { type: "cardTypeIs", target: "eventCard", cardType: "character" }
              ]
            },
            effects: [
              {
                type: "mayPay",
                player: "controller",
                costs: [{ type: "payResources", amount: 1 }],
                effects: [
                  {
                    type: "chooserSelectsTarget",
                    chooser: "controller",
                    declaration: {
                      id: "found",
                      selector: {
                        controller: "self",
                        zone: "deck",
                        conditions: [{ type: "cardNameEquals", target: { type: "selected", id: "__candidate" }, other: "eventCard" }]
                      },
                      count: 1
                    },
                    effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "deck", position: "top" }]
                  }
                ]
              }
            ]
          }
        ]
      }
    });

    const sac = tactic({
      name: "Sac Hero",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "stone", def: stone, owner: P1 },
        { key: "hero", def: character({ name: "Hero", id: "hero-def" }), owner: P1 },
        { key: "heroCopy", def: character({ name: "Hero", id: "hero-def" }), owner: P1, zone: "deck" },
        { key: "other", def: character({ name: "Other", id: "other-def" }), owner: P1, zone: "deck" },
        { key: "sac", def: sac, owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "R" }), owner: P1 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("sac"), selected: { t: [id("hero")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "mayPay");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("heroCopy")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].deck[0], id("heroCopy"));
  });
});

// "You may use one of the card's abilities. If you do, the effect happens
// twice instead of once." — Notion Sickness.
describe("Seed 3 Wave L: useTargetAbility", () => {
  test("activates the target's ability, doubled", () => {
    const engineRoom = character({
      name: "Engine Room",
      behavior: {
        abilities: [
          {
            id: "pump",
            type: "activated",
            effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }]
          }
        ]
      }
    });
    const notion = tactic({
      name: "Notion Sickness",
      behavior: {
        abilities: [
          {
            id: "n",
            type: "activated",
            targets: [{ id: "pick", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
            effects: [
              { type: "useTargetAbility", chooser: "controller", target: { type: "selected", id: "pick" }, times: 2 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "room", def: engineRoom, owner: P1 },
        { key: "notion", def: notion, owner: P1, zone: "hand" }
      ]
    });

    const before = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("notion"), selected: { pick: [id("room")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "useTargetAbility");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "useTargetAbility", abilityId: "pump" } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before + 6);
  });

  // "Pick a card you control with an ability in its rules text" — the
  // `hasAbility` selector condition (abilityType: "activated") rejects a
  // vanilla card.
  test("hasAbility target condition — a vanilla card is not a legal pick", () => {
    const withAbility = character({
      name: "Has Ability",
      behavior: { abilities: [{ id: "pump", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
    });
    const vanilla = character({ name: "Vanilla" });
    const notion = tactic({
      name: "Notion",
      behavior: {
        abilities: [
          {
            id: "n",
            type: "activated",
            targets: [
              {
                id: "pick",
                selector: {
                  controller: "self",
                  zone: "play",
                  conditions: [
                    { type: "hasAbility", target: { type: "selected", id: "__candidate" }, abilityType: "activated" }
                  ]
                },
                count: 1
              }
            ],
            effects: [{ type: "useTargetAbility", chooser: "controller", target: { type: "selected", id: "pick" }, times: 2 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "withAbility", def: withAbility, owner: P1 },
        { key: "vanilla", def: vanilla, owner: P1 },
        { key: "notion", def: notion, owner: P1, zone: "hand" }
      ]
    });

    // Picking the vanilla card is rejected...
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("notion"), selected: { pick: [id("vanilla")] } })
    );
    // ...the one with an ability is fine.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("notion"), selected: { pick: [id("withAbility")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "useTargetAbility");
  });
});

// "All non-resource cards gain the rules text Unique X, where X is the card's
// name." — God's Autograph.
describe("Seed 3 Wave L: uniqueGrant (dynamic Unique by name)", () => {
  test("controlling two same-named non-resource cards forces a Unique choice", () => {
    const autograph = item({
      name: "God's Autograph",
      behavior: {
        abilities: [
          {
            id: "sig",
            type: "continuous",
            modifiers: [],
            uniqueGrant: {
              selector: { conditions: [{ type: "not", condition: { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "resource" } }] },
              designation: "cardName"
            }
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "auto", def: autograph, owner: P1 },
        { key: "twinA", def: character({ name: "Twin", id: "twin-def" }), owner: P1 },
        { key: "twinB", def: character({ name: "Twin", id: "twin-def" }), owner: P1, zone: "hand" }
      ]
    });

    // playing the second twin runs the state-based check
    engine.perform({ type: "playCard", playerId: P1, cardId: id("twinB") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "uniqueSurvivor");
  });
});

// "EXTRA COST: Pick 2 characters. When this card enters play, deplete those
// characters." — Intriguing Mezzanine (non-tactic onPlay).
describe("Seed 3 Wave L: non-tactic behavior.onPlay", () => {
  test("a location's EXTRA COST picks feed its inline ETB", () => {
    const mezz = location({
      name: "Mezzanine",
      structure: 3,
      behavior: {
        onPlay: {
          targets: [{ id: "picked", selector: { zone: "play", type: "character" }, count: 2 }],
          effects: [
            { type: "forEach", selected: "picked", effects: [{ type: "deplete", target: { type: "selected", id: "__candidate" } }] }
          ]
        }
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "mezz", def: mezz, owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P1 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("mezz"), selected: { picked: [id("a"), id("b")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("mezz")].zone, "play");
    assert.equal(engine.state.cards[id("a")].depleted, true);
    assert.equal(engine.state.cards[id("b")].depleted, true);
  });
});
