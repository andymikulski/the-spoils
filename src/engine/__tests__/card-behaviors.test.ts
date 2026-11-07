// Behavior data authored onto real cards in data/cards/, exercised here
// through synthetic fixtures shaped identically to that data (see
// CLAUDE.md's "Development approach" — engine-rules tests stay independent
// of data/cards/ itself, but should prove the exact ability shape that
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
  defaultFactionDefinition,
  factionCard,
  item,
  location,
  noDevelopFaction,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import { chooseDevelopOption, developDraw, developPlay, developPlayAtTurnStart, openDevelop, settleTurnStart } from "./support/develop.js";
import type { CardDefinition } from "../../engine.js";
import { createTwoPlayerFactionGame, TOURNAMENT_FACTION_BEHAVIOR } from "../../engine.js";

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
    settleTurnStart(engine);

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
    assert.ok(engine.state.players[P1].hand.includes(id("topOfDeck")), "engine.state.players[P1].hand.includes(id(\"topOfDeck\"))");
    assert.equal(engine.state.cards[id("hike")].zone, "discard");
  });
});

describe("Universal faction behavior: Tournament Faction 'Resource' ability", () => {
  // Regression test: data/cards/ carried a stale `playResourceFromHand`
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

  // Regression (reported brick): picking a `faceDownOnly` resource — Elitist
  // Upgrade and the other Holy Heist FLIP IT staples — for this ability threw
  // "must be played face down" mid-resolution, AFTER the 4-resource cost was
  // already spent, with no way to recover. `faceDown: "auto"` keyed only off
  // `type === "resource"` and never consulted `faceDownOnly`.
  test("picking a faceDownOnly resource plays it face-down instead of bricking after the cost is paid", () => {
    const { engine, id } = buildGame({
      playerA: { faction: factionCard({ name: "Tournament Faction", behavior: TOURNAMENT_FACTION_BEHAVIOR }) },
      cards: [
        { key: "r1", def: resourceCard({ name: "R1" }), owner: P1 },
        { key: "r2", def: resourceCard({ name: "R2" }), owner: P1 },
        { key: "r3", def: resourceCard({ name: "R3" }), owner: P1 },
        { key: "r4", def: resourceCard({ name: "R4" }), owner: P1 },
        {
          key: "elitistUpgrade",
          def: resourceCard({
            name: "Elitist Upgrade",
            resource: { provides: ["elitism"], faceDownOnly: true }
          }),
          owner: P1,
          zone: "hand"
        }
      ]
    });

    assert.doesNotThrow(() =>
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("__factionA"),
        abilityId: "tournament-resource",
        selected: { resource: [id("elitistUpgrade")] }
      })
    );
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("elitistUpgrade")].zone, "play");
    assert.equal(engine.state.cards[id("elitistUpgrade")].faceDown, true);
    // Face-down it is an anonymous Volition source, not [E].
    assert.equal(engine.getThresholds(P1).elitism ?? 0, 0);
  });
});

// "EXTRA COST: Pick a non-resource card. -- Put the card into its owner's
// hand. Look at an opponent's hand and choose a card in it. That player
// discards that card."
//
// New mechanisms this shape exercises (see BEHAVIORS.md): a selector
// excluding a card type via `conditions` + the `__candidate` binding
// (CardSelector.type only supports a single positive match), and a
// `chooserSelectsTarget` effect nested after the bounce so the discard
// choice is queried from the opponent's hand *after* the bounced card has
// already landed there, not up front alongside the bounce target (a card
// bounced by this same resolution must be a legal discard candidate).
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
            }
          ],
          effects: [
            { type: "moveCard", target: { type: "selected", id: "bounced" }, to: "hand" },
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: {
                id: "discarded",
                selector: { controller: "opponent", zone: "hand" },
                count: 1
              },
              effects: [
                { type: "moveCard", target: { type: "selected", id: "discarded" }, to: "discard" }
              ]
            }
          ]
        }
      ]
    }
  });
}

describe("card behavior: Forget (negated selector + sequential chooserSelectsTarget)", () => {
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
        selected: { bounced: [id("onlyResource")] }
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
      selected: { bounced: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "hand");
    assert.ok(engine.state.players[P2].hand.includes(id("victim")), "engine.state.players[P2].hand.includes(id(\"victim\"))");

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.equal(engine.state.pendingChoice?.playerId, P1);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("opponentCard")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("opponentCard")].zone, "discard");
    assert.ok(engine.state.players[P2].discard.includes(id("opponentCard")), "engine.state.players[P2].discard.includes(id(\"opponentCard\"))");
  });

  test("the just-bounced card is itself a legal discard candidate (regression: it must land in hand before the discard choice is offered)", () => {
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
      selected: { bounced: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "hand");
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("victim")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "discard");
    assert.ok(engine.state.players[P2].discard.includes(id("victim")), "engine.state.players[P2].discard.includes(id(\"victim\"))");
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
    settleTurnStart(engine, "draw");
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine, "draw");

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

  // Reported bug: ejecting the Ejector in response to a targeted `dealDamage`
  // ability left it sitting in hand with damage still marked (e.g. shown as
  // "0/1" life) until it was replayed. `dealDamage`'s target is fixed at
  // activation time (`context.selected`) but the effect itself doesn't
  // resolve until responses finish — if the target bails out of play via a
  // response in between, the effect must fizzle against it instead of
  // marking damage on a card no longer in play.
  test("EJECT in response to a targeted dealDamage effect leaves no damage behind", () => {
    const zapper = character({
      name: "Zapper",
      behavior: {
        abilities: [
          {
            id: "zap",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "zapper", def: zapper, owner: P1 },
        { key: "ejector", def: quotidianEjector(), owner: P2, counters: { token: 2 } }
      ]
    });

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("zapper"),
      abilityId: "zap",
      selected: { t: [id("ejector")] }
    });

    // P2 has priority to respond and bails the targeted Ejector out before
    // the 3 damage lands.
    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("ejector"),
      abilityId: "quotidian-ejector-eject",
      selected: { target: [id("ejector")] }
    });

    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("ejector")].zone, "hand");
    assert.equal(engine.state.cards[id("ejector")].damage, 0);
  });

});

// CR §202.9 / §402.9 (RULES.md §3.6): a faction card is never a legal pick
// for a generic selector; it only becomes one when the selector explicitly
// admits factions (`type: "faction"`, or a positive `cardTypeIs: "faction"`
// in `conditions` — the "pick a character or faction" pattern used by Bask
// Bile / Boorish Boar / Prime Titan).
describe("faction cards are unpickable unless the selector names factions", () => {
  test("a generic 'pick a non-resource card' selector cannot reach a faction", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "ejector", def: quotidianEjector(), owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("ejector") });
    resolvePendingResponses(engine);

    for (const player of [P1, P2]) {
      assert.throws(
        () =>
          engine.perform({
            type: "activateAbility",
            playerId: P1,
            cardId: id("ejector"),
            abilityId: "quotidian-ejector-eject",
            selected: { target: [engine.state.players[player].factionId!] }
          }),
        /Illegal target/
      );
    }
  });

  test("a 'character or faction' selector still admits the faction card", () => {
    const bileLike = character({
      name: "Bile-like",
      behavior: {
        abilities: [
          {
            id: "hemorage",
            type: "activated",
            targets: [
              {
                id: "t",
                selector: {
                  zone: "play",
                  conditions: [
                    {
                      type: "or",
                      conditions: [
                        { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" },
                        { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "faction" }
                      ]
                    }
                  ]
                },
                count: 1
              }
            ],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "bile", def: bileLike, owner: P1 }]
    });

    const targetFaction = engine.state.players[P2].factionId!;
    const before = engine.state.players[P2].influence;

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("bile"),
      abilityId: "hemorage",
      selected: { t: [targetFaction] }
    });
    resolvePendingResponses(engine);

    // CR §408.3: damage to a faction is taken as influence loss.
    assert.equal(engine.state.players[P2].influence, before - 3);
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

// CR §411.1 — a face-down card in play is *only* a Volition resource: it
// has no name, no other type, and no rules text. Its printed abilities are
// dormant, so a "when this leaves play" trigger does not fire when it
// leaves play face-down, and it is not seen as a character/item by a
// type-checking selector. Flipping it face-up makes it "a completely new
// card" (§411.3); flipping a face-up card face-down still counts as that
// card leaving play (§411.4).
describe("face-down cards have no characteristics (CR §411.1)", () => {
  // Hands its controller 3 influence the instant it leaves play.
  function gnat(overrides: Partial<CardDefinition> = {}): CardDefinition {
    return character({
      name: "Swarm of Gnats",
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
      },
      ...overrides
    });
  }

  test("a face-down resource's 'leaves play' trigger stays dormant when it is destroyed", () => {
    const zap = tactic({
      name: "Zap",
      behavior: {
        abilities: [
          {
            id: "z",
            type: "activated",
            targets: [
              {
                id: "t",
                selector: { zone: "play", type: "resource", controller: "opponent" },
                count: 1
              }
            ],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        { key: "zap", def: zap, owner: P1, zone: "hand" },
        { key: "gnat", def: gnat(), owner: P2, controller: P2, faceDown: true }
      ]
    });

    const before = engine.state.players[P2].influence;

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("zap"),
      selected: { t: [id("gnat")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("gnat")].zone, "discard");
    assert.equal(
      engine.state.players[P2].influence,
      before,
      "the face-down card had no rules text — its leaves-play trigger must not fire"
    );
  });

  test("a face-down resource is not a legal 'character or item' target", () => {
    const grab = tactic({
      name: "Grab",
      behavior: {
        abilities: [
          {
            id: "g",
            type: "activated",
            targets: [
              {
                id: "t",
                selector: {
                  controller: "self",
                  zone: "play",
                  conditions: [
                    {
                      type: "or",
                      conditions: [
                        {
                          type: "cardTypeIs",
                          target: { type: "selected", id: "__candidate" },
                          cardType: "character"
                        },
                        {
                          type: "cardTypeIs",
                          target: { type: "selected", id: "__candidate" },
                          cardType: "item"
                        }
                      ]
                    }
                  ]
                },
                count: 1
              }
            ],
            effects: [{ type: "deplete", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "grab", def: grab, owner: P2, zone: "hand" },
        { key: "real", def: character({ name: "Real" }), owner: P2 },
        { key: "gnat", def: gnat({ id: "gnat-facedown-def" }), owner: P2, faceDown: true }
      ]
    });

    assert.throws(() =>
      engine.perform({
        type: "playCard",
        playerId: P2,
        cardId: id("grab"),
        selected: { t: [id("gnat")] }
      })
    );

    // The real, face-up character is still a fine target.
    engine.perform({
      type: "playCard",
      playerId: P2,
      cardId: id("grab"),
      selected: { t: [id("real")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("real")].depleted, true);
  });

  test("flipping a face-up card face-down still fires its 'leaves play' trigger (CR §411.4)", () => {
    const quicksand = tactic({
      name: "Quicksand",
      behavior: {
        abilities: [
          {
            id: "q",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        { key: "qs", def: quicksand, owner: P1, zone: "hand" },
        { key: "gnat", def: gnat(), owner: P2, controller: P2 }
      ]
    });

    const before = engine.state.players[P2].influence;

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("qs"),
      selected: { t: [id("gnat")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("gnat")].faceDown, true);
    assert.equal(
      engine.state.players[P2].influence,
      before + 3,
      "the face-up card genuinely left play when it was flipped"
    );
  });

  test("flipping a face-down resource face-up to deploy it fires only its enters-play trigger", () => {
    const manifest = tactic({
      name: "Manifest",
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            targets: [
              {
                id: "rev",
                selector: {
                  controller: "self",
                  zone: "play",
                  type: "character",
                  faceDown: true
                },
                count: 1
              }
            ],
            effects: [
              {
                type: "deployFromZone",
                player: "controller",
                target: { type: "selected", id: "rev" }
              }
            ]
          }
        ]
      }
    });

    const gnatWithEtb = gnat({
      id: "gnat-etb-def",
      cost: 6,
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
            effects: [{ type: "modifyInfluence", player: "controller", amount: 100 }]
          },
          {
            id: "on-enter",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        { key: "man", def: manifest, owner: P1, zone: "hand" },
        { key: "fd", def: gnatWithEtb, owner: P1, zone: "play", faceDown: true }
      ],
      playerA: { influence: 20 }
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("man"),
      selected: { rev: [id("fd")] }
    });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "deployForFree", cardId: id("fd") }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("fd")].faceDown, false);
    assert.equal(
      engine.state.players[P1].influence,
      23,
      "only the enters-play trigger fired; the dormant leaves-play trigger did not"
    );
  });

  test("a card played as a face-down resource does not fire its 'enters play' trigger", () => {
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

    const etbGnat = character({
      name: "ETB Gnat",
      behavior: {
        abilities: [
          {
            id: "etb",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      playerA: { faction: resourceFaction },
      cards: [{ key: "gnat", def: etbGnat, owner: P1, zone: "hand" }],
      activePlayerId: P1
    });

    const before = engine.state.players[P1].influence;

    developPlay(engine, P1, id("gnat"), true);
    resolvePendingResponses(engine);

    const gnat = engine.state.cards[id("gnat")];
    assert.equal(gnat.zone, "play");
    assert.equal(gnat.faceDown, true);
    assert.equal(
      engine.state.players[P1].influence,
      before,
      "a face-down resource has no rules text — its ETB stays dormant"
    );
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

    assert.ok(engine.state.players[P1].hand.includes(id("buriedTactic")), "engine.state.players[P1].hand.includes(id(\"buriedTactic\"))");

    const deckAfter = engine.state.players[P1].deck;
    assert.equal(deckAfter.length, deckBefore.size - 1);
    for (const cardId of deckAfter) {
      assert.ok(deckBefore.has(cardId), "deckBefore.has(cardId)");
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

    assert.ok(!engine.state.players[P1].hand.includes(id("buriedTactic")), "!engine.state.players[P1].hand.includes(id(\"buriedTactic\"))");
    assert.ok(engine.state.players[P1].deck.includes(id("buriedTactic")), "engine.state.players[P1].deck.includes(id(\"buriedTactic\"))");
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
    assert.ok(discarded[0] === id("handCard1") || discarded[0] === id("handCard2"), "discarded[0] === id(\"handCard1\") || discarded[0] === id(\"handCard2\")");
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
    settleTurnStart(engine, "draw");
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine, "draw");

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
    text: "Pick up to 2 non-resource cards. Put up to 2 tokens divided however you want on the cards.",
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
              upTo: true,
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
    assert.ok(engine.state.players[P1].hand.includes(id("topOfDeck")), "engine.state.players[P1].hand.includes(id(\"topOfDeck\"))");
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

// The `x` roll a target `count` depends on can't be known by a caller
// before the engine makes it (a caller-supplied value would let a client fake the
// roll) — `playCard` always
// pauses on a `selectDeployTargets` pending choice for a card shaped like
// this, roll already made, regardless of whether `selected` was supplied
// upfront. A client-supplied `variables.x` is ignored outright: the roll
// stays authoritative even if a caller tries to override it.
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

    engine.perform({ type: "playCard", playerId: P1, cardId: id("smash") });

    assert.equal(engine.state.pendingChoice?.kind, "selectDeployTargets");

    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "selectDeployTargets", selected: { picked: [id("item1"), id("item2")] } }
      })
    );

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectDeployTargets", selected: { picked: [id("item1")] } }
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

    engine.perform({ type: "playCard", playerId: P1, cardId: id("smash") });
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectDeployTargets", selected: { picked: [id("item1"), id("item2")] } }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("item1")].zone, "discard");
    assert.equal(engine.state.cards[id("item2")].zone, "discard");
  });

  test("a client-supplied variables.x override is ignored — the engine's own roll always wins", () => {
    const { engine, id } = buildGame({
      random: () => 0, // the true roll: min(1) + floor(0*2) = 1
      cards: [
        { key: "smash", def: hammerSmash(), owner: P1, zone: "hand" },
        { key: "item1", def: item({ name: "Item1" }), owner: P2 },
        { key: "item2", def: item({ name: "Item2" }), owner: P2 }
      ]
    });

    // A malicious/buggy caller claims the coin landed on 2 and tries to pick
    // both items in one atomic call. The engine still rolls for itself (x=1
    // here), ignores the supplied override and selection, and pauses.
    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("smash"),
      variables: { x: 2 },
      selected: { picked: [id("item1"), id("item2")] }
    });

    assert.equal(engine.state.pendingChoice?.kind, "selectDeployTargets");
    assert.throws(() =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "selectDeployTargets", selected: { picked: [id("item1"), id("item2")] } }
      })
    );
  });
});

// Synthetic card, not an authored one: an activated ability whose effect
// amount (not a target count) is sized by an unguarded random roll, no
// picker involved. Exercises the `applyVariableRolls` merge fix in
// isolation from Hammer Smash's deferred-target-choice machinery, and via
// `activateAbility` rather than `playCard` — a second call site of the fix.
function coinFlipZapper(): CardDefinition {
  return character({
    name: "Coin Flip Zapper",
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          variables: { x: { type: "random", min: 1, max: 6 } },
          effects: [{ type: "modifyInfluence", player: "controller", amount: { type: "variable", id: "x" } }]
        }
      ]
    }
  });
}

describe("applyVariableRolls: a caller-supplied override cannot rig an unguarded random roll", () => {
  test("activateAbility ignores a client-supplied variables.x — the engine's own roll always wins", () => {
    const { engine, id } = buildGame({
      random: () => 0, // the true roll: min(1) + floor(0*6) = 1
      cards: [{ key: "zapper", def: coinFlipZapper(), owner: P1 }]
    });

    const before = engine.state.players[P1].influence;

    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("zapper"),
      abilityId: "zap",
      variables: { x: 6 } // claims the roll landed on the max; the engine must ignore this
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, before + 1);
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
        assert.ok(!source.legalTargets.some(target => target.type === "faction"), "!source.legalTargets.some(target => target.type === \"faction\")");
      }

      return source.legalTargets.length > 0
        ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }]
        : [];
    });

    assert.ok(checked, "checked");
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
    settleTurnStart(engine);

    assert.equal(engine.state.pendingChoice?.kind, "selectTargets");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { picked: [id("victim")] } }
    });
    settleTurnStart(engine);
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
    settleTurnStart(engine);

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { picked: [] } }
    });
    settleTurnStart(engine);
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
    settleTurnStart(engine);

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
    settleTurnStart(engine);

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

    // X = 0: there is nothing to choose, so the opponent is not prompted
    // for a 0-card pick (SYS-25); all five go straight to the discard pile.
    assert.equal(engine.state.pendingChoice, undefined, "no unanswerable 'choose 0 cards' prompt");

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

    developPlay(engine, P2, id("r1"), false);
    resolvePendingResponses(engine);
    // first resource of P2's turn -> ordinal 1 -> triggered
    assert.equal(engine.state.players[P2].influence, start - 1);

    // full turn cycle back to P2: turnEventTally reset, so it fires again
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine, "draw");
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);

    const p2Turn2 = engine.state.players[P2].influence;
    developPlayAtTurnStart(engine, P2, id("r2"), false);
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
    assert.ok(engine.state.battle, "engine.state.battle");
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
    settleTurnStart(engine, "draw");
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

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

  // (CR §507.4b) "You pay the Flip Up cost before you actually flip the
  // card over, so you can use the card to pay for its own Flip Up cost."
  test("a face-down card can pay for its own FLIP UP cost", () => {
    const selfPaying = tactic({
      name: "SelfPaying",
      flipUp: { cost: 1, threshold: 0 },
      behavior: {
        abilities: [
          {
            id: "main",
            type: "activated",
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "sp", def: selfPaying, owner: P1, faceDown: true },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "flipUp", playerId: P1, cardId: id("sp"), selected: {} });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("sp")].zone, "discard");
    assert.equal(engine.state.cards[id("sp")].faceDown, false);
    assert.equal(engine.state.cards[id("sp")].attachedTo, undefined);
    assert.equal(engine.state.players[P1].hand.includes(id("d1")), true);
  });

  // A FLIP UP whose own effect pauses on a chooser: resolution suspends on
  // the pendingChoice, and the "move the flipped tactic to discard"
  // bookkeeping waits until the paused effect has finished.
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
    // Flipping up is playing the card: the opponent passes, then it resolves.
    resolvePendingResponses(engine);

    // Suspended on the chooser; the flipped tactic has NOT gone to discard yet.
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.equal(engine.state.cards[id("pop")].faceDown, false);
    assert.equal(engine.state.cards[id("pop")].zone, "deploying");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("h1")] }
    });

    resolvePendingResponses(engine);
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

// A token depicts one real printing of its name: it carries that printing's id (art),
// subtitle and flavor text, and a swarm spreads across the printings.
describe("createTokens: token printing", () => {
  const maker = (name: string) =>
    tactic({
      name: "Token Maker",
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            effects: [
              { type: "createTokens", controller: "controller", count: 8, token: { name, cardType: "character", strength: 1, life: 1, speed: 3 } }
            ]
          }
        ]
      }
    });
  const tokensOf = (engine: ReturnType<typeof buildGame>["engine"]) =>
    engine.state.players[P1].play.map(cid => engine.state.cards[cid]).filter(c => c.isToken);

  test("takes subtitle and flavor text from the printing it depicts, only where that printing has them", () => {
    const withFlavor = character({ name: "Micromajig", subtitle: "movin' on up", flavorText: "Tiny, but plentiful." });
    const bare = character({ name: "Micromajig" });
    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: maker("Micromajig"), owner: P1, zone: "hand" },
        { key: "a", def: withFlavor, owner: P1, zone: "discard" },
        { key: "b", def: bare, owner: P1, zone: "discard" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("m") });
    resolvePendingResponses(engine);

    const defs = tokensOf(engine).map(t => engine.definitions[t.definitionId]);
    assert.equal(defs.length, 8);
    assert.deepEqual(new Set(defs.map(d => d.printingId)), new Set([withFlavor.id, bare.id]), "a swarm spreads across both printings");
    for (const d of defs) {
      const printing = d.printingId === withFlavor.id ? withFlavor : bare;
      assert.equal(d.subtitle, printing.subtitle);
      assert.equal(d.flavorText, printing.flavorText);
    }
  });

  test("a token with no printed namesake has no printing", () => {
    const { engine, id } = buildGame({ cards: [{ key: "m", def: maker("Nobody Prints This"), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("m") });
    resolvePendingResponses(engine);

    for (const t of tokensOf(engine)) {
      const d = engine.definitions[t.definitionId];
      assert.equal(d.printingId, undefined);
      assert.equal(d.flavorText, undefined);
    }
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

// ===========================================================================
// Seed 2 - the FLIP UP era. New shapes below (see BEHAVIORS.md / RULES.md).
// ===========================================================================

// "Pick a character. Flip the character face-down under its owner's control."
// (Alluring Quicksand, Thorough Sanitization, Midget Mine, ...)
describe("Seed 2: flipFaceDown effect", () => {
  test("flips a target in play into a face-down resource under its owner, wiping its state", () => {
    const quicksand = tactic({
      name: "Quicksand",
      behavior: {
        abilities: [
          {
            id: "q",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "qs", def: quicksand, owner: P1, zone: "hand" },
        {
          key: "victim",
          def: character({ name: "Victim", life: 5 }),
          owner: P2,
          controller: P1,
          damage: 2,
          depleted: true,
          counters: { token: 3 }
        }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("qs"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);

    const v = engine.state.cards[id("victim")];
    assert.equal(v.zone, "play");
    assert.equal(v.faceDown, true);
    assert.equal(v.controllerId, P2, "reverts to owner's control");
    assert.equal(engine.state.players[P2].play.includes(id("victim")), true);
    assert.equal(v.damage, 0);
    assert.equal(v.depleted, false);
    assert.deepEqual(v.counters, {});
    assert.equal(engine.getThresholds(P2).volition, 1);
  });

  test("as a would-be-destroyed replacement, flips the card face-down instead", () => {
    const groomer = character({
      name: "Ceremonious Groomer",
      life: 3,
      behavior: {
        abilities: [
          {
            id: "save",
            type: "replacement",
            replaces: { event: "destroy" },
            effects: [{ type: "flipFaceDown", target: { type: "selected", id: "__candidate" } }]
          }
        ]
      }
    });
    const bolt = tactic({
      name: "Bolt",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 10 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "g", def: groomer, owner: P1 },
        { key: "bolt", def: bolt, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });

    engine.perform({ type: "playCard", playerId: P2, cardId: id("bolt"), selected: { t: [id("g")] } });
    resolvePendingResponses(engine);

    const g = engine.state.cards[id("g")];
    assert.equal(g.zone, "play");
    assert.equal(g.faceDown, true);
    assert.equal(engine.state.players[P1].discard.includes(id("g")), false);
  });
});

// "Put this card into play under its owner's control as a face-down resource
// instead of into their discard pile." (Otter Floss, Sprint, Tiny Shiny, ...)
// and "...into its owner's hand instead..." gated on FLIP UP (Clam Hash).
describe("Seed 2: tactic selfDisposition", () => {
  test("faceDownResource - the resolved tactic re-enters play face-down, not the discard", () => {
    const floss = tactic({
      name: "Otter Floss",
      selfDisposition: { to: "faceDownResource" },
      behavior: {
        abilities: [{ id: "f", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "floss", def: floss, owner: P1, zone: "hand" },
        { key: "x1", def: resourceCard({ name: "R1" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("floss") });
    resolvePendingResponses(engine);

    const f = engine.state.cards[id("floss")];
    assert.equal(f.zone, "play");
    assert.equal(f.faceDown, true);
    assert.equal(engine.state.players[P1].discard.includes(id("floss")), false);
  });

  test("hand disposition gated on deployedViaFlipUp: hand when flipped up, discard when played normally", () => {
    const mk = () => tactic({
      name: "Clam Hash",
      id: "clam-hash-def",
      flipUp: { cost: 0, threshold: 0 },
      selfDisposition: { to: "hand", condition: { type: "deployedViaFlipUp" } },
      behavior: {
        abilities: [{ id: "c", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }]
      }
    });

    {
      const { engine, id } = buildGame({ cards: [{ key: "ch", def: mk(), owner: P1, zone: "hand" }] });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("ch") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.cards[id("ch")].zone, "discard");
    }

    {
      const { engine, id } = buildGame({ cards: [{ key: "ch", def: mk(), owner: P1, zone: "play", faceDown: true }] });
      engine.perform({ type: "flipUp", playerId: P1, cardId: id("ch") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.cards[id("ch")].zone, "hand");
    }
  });
});

// "Reveal a face-down tactic/item/location you control." (Foment, Manifest,
// Hidden Ruins, Implosive Explosion, ...) - CardSelector.faceDown.
describe("Seed 2: CardSelector.faceDown", () => {
  test("faceDown true matches a face-down card by its real hidden type; face-up cards are excluded", () => {
    const picker = tactic({
      name: "Picker",
      behavior: {
        abilities: [
          {
            id: "p",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self", zone: "play", type: "tactic", faceDown: true }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "pick", def: picker, owner: P1, zone: "hand" },
        { key: "fdTactic", def: tactic({ name: "Hidden", id: "hidden-tac" }), owner: P1, zone: "play", faceDown: true },
        { key: "faceupChar", def: character({ name: "Up" }), owner: P1 }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("pick"), selected: { t: [id("faceupChar")] } })
    );

    engine.perform({ type: "playCard", playerId: P1, cardId: id("pick"), selected: { t: [id("fdTactic")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("fdTactic")].zone, "hand");
  });
});

// "Put the card into play under your control [as a face-down resource]."
// (Peculate, Miraculous Regeneration, Party Clowns, Gilded Yurt, ...)
describe("Seed 2: putIntoPlay effect", () => {
  test("moves a discard-pile character into play under the chooser's control, firing cardEnteredPlay", () => {
    const etbWitness = character({
      name: "Witness",
      behavior: {
        abilities: [
          {
            id: "w",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
          }
        ]
      }
    });
    const raise = tactic({
      name: "Raise",
      behavior: {
        abilities: [
          {
            id: "r",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "raise", def: raise, owner: P1, zone: "hand" },
        { key: "wit", def: etbWitness, owner: P1, zone: "discard" }
      ],
      playerA: { influence: 20 }
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("raise"), selected: { t: [id("wit")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("wit")].zone, "play");
    assert.equal(engine.state.cards[id("wit")].controllerId, P1);
    assert.equal(engine.state.players[P1].influence, 25, "its ETB fired");
  });

  test("faceDown true puts it into play as an anonymous face-down resource with no ETB", () => {
    const raiseFd = tactic({
      name: "RaiseFaceDown",
      behavior: {
        abilities: [
          {
            id: "r",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller", faceDown: true }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "raise", def: raiseFd, owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "discard" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("raise"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);

    const c = engine.state.cards[id("c")];
    assert.equal(c.zone, "play");
    assert.equal(c.faceDown, true);
    assert.equal(engine.getThresholds(P1).volition, 1);
  });
});

// "Reveal a face-down tactic you control. You may deploy the tactic."
// (Manifest, Hidden Ruins, Accidental Invention, Burly Assailment); and
// "Pick a non-resource card in your discard pile. You may deploy the card."
// (Dark Awakening) - the deployFromZone effect.
describe("Seed 2: deployFromZone effect", () => {
  test("deploys a face-down permanent in play as its real type, waiving the numeric cost", () => {
    const manifest = tactic({
      name: "Manifest",
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            targets: [{ id: "rev", selector: { controller: "self", zone: "play", type: "character", faceDown: true }, count: 1 }],
            effects: [
              { type: "deployFromZone", player: "controller", target: { type: "selected", id: "rev" } }
            ]
          }
        ]
      }
    });
    const bruiser = character({
      name: "Bruiser",
      cost: 6,
      behavior: {
        abilities: [
          {
            id: "etb",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "man", def: manifest, owner: P1, zone: "hand" },
        { key: "fd", def: bruiser, owner: P1, zone: "play", faceDown: true }
      ],
      playerA: { influence: 20 }
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("man"), selected: { rev: [id("fd")] } });
    resolvePendingResponses(engine);

    // pending "deploy for free" choice for the revealed card
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "deployForFree", cardId: id("fd") }
    });
    resolvePendingResponses(engine);

    const fd = engine.state.cards[id("fd")];
    assert.equal(fd.zone, "play");
    assert.equal(fd.faceDown, false);
    assert.equal(engine.state.players[P1].influence, 23, "its ETB fired, no numeric cost paid");
  });

  test("the player may decline to deploy", () => {
    const manifest = tactic({
      name: "Manifest2",
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            targets: [{ id: "rev", selector: { controller: "self", zone: "play", type: "character", faceDown: true }, count: 1 }],
            effects: [{ type: "deployFromZone", player: "controller", target: { type: "selected", id: "rev" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "man", def: manifest, owner: P1, zone: "hand" },
        { key: "fd", def: character({ name: "Stay", id: "stay-def" }), owner: P1, zone: "play", faceDown: true }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("man"), selected: { rev: [id("fd")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree" } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("fd")].faceDown, true, "still face-down - declined");
  });

  test("ignoreThreshold waives the printed-threshold gate too (I Drink Your Milkshake!)", () => {
    const opener = tactic({
      name: "Milkshake Opener",
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            targets: [{ id: "rev", selector: { controller: "self", zone: "void", type: "character", faceDown: false }, count: 1 }],
            effects: [
              { type: "deployFromZone", player: "controller", target: { type: "selected", id: "rev" }, ignoreThreshold: true }
            ]
          }
        ]
      }
    });
    // a character with a threshold the controller cannot meet (no resources in play)
    const gated = character({ name: "Gated", id: "gated-x", cost: 5, threshold: "ooo" });

    const { engine, id } = buildGame({
      cards: [
        { key: "op", def: opener, owner: P1, zone: "hand" },
        { key: "g", def: gated, owner: P1, zone: "void" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("op"), selected: { rev: [id("g")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("g") } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("g")].zone, "play", "deployed despite unmet [O][O][O]");
  });
});

// "While this card is in your discard pile, when a card that provides at
// least [O] enters play under your control, ..." - TriggeredAbility.triggerZone.
describe("Seed 2: TriggeredAbility.triggerZone", () => {
  test("a discard-zone trigger fires while its source sits in the discard pile", () => {
    const echo = tactic({
      name: "Echo",
      behavior: {
        abilities: [
          {
            id: "fromDiscard",
            type: "triggered",
            triggerZone: "discard",
            event: "cardEnteredPlay",
            effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "echo", def: echo, owner: P1, zone: "discard" },
        { key: "body", def: character({ name: "Body" }), owner: P1, zone: "hand" }
      ],
      playerA: { influence: 20 }
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("body") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, 22, "the discard-zone trigger fired");
  });

  test("the same ability does NOT fire while the source is still in play", () => {
    const echo = tactic({
      name: "EchoInPlay",
      behavior: {
        abilities: [
          {
            id: "fromDiscard",
            type: "triggered",
            triggerZone: "discard",
            event: "cardEnteredPlay",
            effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "echo", def: echo, owner: P1, zone: "play", faceDown: true },
        { key: "body", def: character({ name: "Body" }), owner: P1, zone: "hand" }
      ],
      playerA: { influence: 20 }
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("body") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, 20, "not in the discard pile - no trigger");
  });

  // "... choose to put this card on the bottom of your deck as part of your
  // mulligan ... draw a card at the start of your turn." (Community Chest) —
  // a triggered ability that fires while its source sits in the DECK.
  test("a deck-zone trigger fires from the deck at the start of the owner's turn", () => {
    const chest = tactic({
      name: "Deck Sitter",
      id: "deck-sitter",
      behavior: {
        abilities: [
          {
            id: "from-deck",
            type: "triggered",
            triggerZone: "deck",
            event: "turnStarted",
            condition: {
              type: "and",
              conditions: [
                { type: "eventPlayerIs", player: "controller" },
                { type: "bottomedInMulligan" }
              ]
            },
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      playerA: { faction: noDevelopFaction() },
      playerB: { faction: noDevelopFaction() },
      cards: [
        { key: "chest", def: chest, owner: P1, zone: "deck" },
        { key: "filler", def: character({ name: "Filler", id: "filler-ds" }), owner: P1, zone: "deck" }
      ]
    });
    engine.state.mulligan[P1] = [id("chest")];
    const handBefore = engine.state.players[P1].hand.length;

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    assert.equal(
      engine.state.players[P1].hand.length,
      handBefore + 1,
      "drew a card at the start of P1's next turn, from the deck"
    );
  });

  test("the deck-zone trigger does not fire when the card was NOT bottomed in the mulligan", () => {
    const chest = tactic({
      name: "Deck Sitter 2",
      id: "deck-sitter-2",
      behavior: {
        abilities: [
          {
            id: "from-deck",
            type: "triggered",
            triggerZone: "deck",
            event: "turnStarted",
            condition: {
              type: "and",
              conditions: [
                { type: "eventPlayerIs", player: "controller" },
                { type: "bottomedInMulligan" }
              ]
            },
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      playerA: { faction: noDevelopFaction() },
      playerB: { faction: noDevelopFaction() },
      cards: [
        { key: "chest", def: chest, owner: P1, zone: "deck" },
        { key: "filler", def: character({ name: "Filler", id: "filler-ds2" }), owner: P1, zone: "deck" }
      ]
    });
    const handBefore = engine.state.players[P1].hand.length;

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    assert.equal(engine.state.players[P1].hand.length, handBefore, "no mulligan bottom -> no draw");
  });
});

// "PROVIDES: [O]" on a character / crest item, and "When a card that
// provides at least [X] enters play under your control, ..." -
// getThresholds counting + the cardProvides condition.
describe("Seed 2: card-provides-icon", () => {
  test("a non-resource in-play card with resource.provides counts toward thresholds", () => {
    const minion = character({
      name: "Minion of Thabbash",
      resource: { provides: ["obsession"] }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "m", def: minion, owner: P1 }]
    });

    void id;
    assert.equal(engine.getThresholds(P1).obsession, 1);
  });

  test("cardProvides gates 'a card that provides at least [O] enters play' on the entering card's icons", () => {
    const mooncalf = character({
      name: "Titillated Mooncalf",
      behavior: {
        abilities: [
          {
            id: "prov",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: {
              type: "and",
              conditions: [
                { type: "eventCardControlledBy", player: "controller" },
                { type: "cardProvides", target: "eventCard", icon: "obsession", min: 1 }
              ]
            },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    // A crest-style item that provides [O][O].
    const crest = item({ name: "Crest of Obsession", resource: { provides: ["obsession", "obsession"] } });
    const plainItem = item({ name: "Plain Item" });

    const { engine, id } = buildGame({
      cards: [
        { key: "mc", def: mooncalf, owner: P1 },
        { key: "crest", def: crest, owner: P1, zone: "hand" },
        { key: "plain", def: plainItem, owner: P1, zone: "hand" }
      ],
      playerA: { influence: 20 }
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("plain") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 20, "a plain item provides no [O]");

    engine.perform({ type: "playCard", playerId: P1, cardId: id("crest") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 21, "the crest provides [O] -> +1");
  });
});

// "This turn, you control an additional [E][E][E][E]." (31337!) -
// the grantResourceIcons effect.
describe("Seed 2: grantResourceIcons effect", () => {
  test("phantom icons count toward thresholds until end of turn", () => {
    const leet = tactic({
      name: "31337!",
      behavior: {
        abilities: [
          {
            id: "l",
            type: "activated",
            effects: [
              { type: "grantResourceIcons", player: "controller", icon: "elitism", amount: 4, duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "leet", def: leet, owner: P1, zone: "hand" }]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("leet") });
    resolvePendingResponses(engine);

    assert.equal(engine.getThresholds(P1).elitism, 4);
  });
});

// "Search your deck for a staple resource." (Dowsing Cleric) -
// CardSelector.staple + the isStaple condition.
describe("Seed 2: staple-selector", () => {
  test("selector.staple:true matches only staple resources", () => {
    const cleric = character({
      name: "Dowsing Cleric",
      behavior: {
        abilities: [
          {
            id: "search",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            targets: [
              { id: "found", selector: { controller: "self", zone: "deck", type: "resource", staple: true }, count: 1, optional: true }
            ],
            effects: [
              { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "found" } }, effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "hand" }] },
              { type: "shuffleDeck", player: "controller" }
            ]
          }
        ]
      }
    });
    const staple = resourceCard({ name: "Greed", id: "greed-stp", resource: { provides: ["greed"], staple: true } });
    const special = resourceCard({ name: "Fancy", id: "fancy-res", resource: { provides: ["greed"], staple: false } });

    const { engine, id } = buildGame({
      cards: [
        { key: "cl", def: cleric, owner: P1, zone: "hand" },
        { key: "stp", def: staple, owner: P1, zone: "deck" },
        { key: "sp", def: special, owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("cl") });
    resolvePendingResponses(engine);

    // only the staple is a legal pick
    assert.throws(() =>
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { found: [id("sp")] } } })
    );
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { found: [id("stp")] } } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("stp")].zone, "hand");
  });

  test("selector.staple:true matches basic resources by name when the data has no staple flag", () => {
    // Real card data (e.g. Mau Strategist's Greed) never sets
    // `resource.staple`; staple-ness falls back to the five basic names.
    const searcher = character({
      name: "Staple Searcher",
      behavior: {
        abilities: [
          {
            id: "search",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            targets: [
              { id: "found", selector: { controller: "self", zone: "deck", type: "resource", staple: true }, count: 1, optional: true }
            ],
            effects: [
              { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "found" } }, effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "hand" }] },
              { type: "shuffleDeck", player: "controller" }
            ]
          }
        ]
      }
    });
    // no `resource` field at all — exactly how real basic resources ship
    const greed = resourceCard({ name: "Greed", id: "greed-bare", resource: undefined });
    const custom = resourceCard({ name: "Blood Money", id: "blood-money", resource: { provides: ["greed"] } });

    const { engine, id } = buildGame({
      cards: [
        { key: "ss", def: searcher, owner: P1, zone: "hand" },
        { key: "g", def: greed, owner: P1, zone: "deck" },
        { key: "cm", def: custom, owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("ss") });
    resolvePendingResponses(engine);

    // the non-staple resource is not a legal pick; the basic one is
    assert.throws(() =>
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { found: [id("cm")] } } })
    );
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { found: [id("g")] } } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("g")].zone, "hand");
  });
});

// "When a player draws any number of cards, ..." (Meat of the Mountain) -
// the cardsDrawn event.
describe("Seed 2: cardsDrawn event", () => {
  test("fires once per completed draw, carrying the player and count", () => {
    const meat = item({
      name: "Meat of the Mountain",
      behavior: {
        abilities: [
          {
            id: "onDraw",
            type: "triggered",
            event: "cardsDrawn",
            condition: { type: "eventPlayerIs", player: "controller" },
            effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]
          }
        ]
      }
    });
    const drawTactic = tactic({
      name: "DrawTwo",
      behavior: { abilities: [{ id: "d", type: "activated", effects: [{ type: "draw", player: "controller", amount: 2 }] }] }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "meat", def: meat, owner: P1 },
        { key: "dt", def: drawTactic, owner: P1, zone: "hand" },
        { key: "c1", def: character({ name: "C1", id: "c1d" }), owner: P1, zone: "deck" },
        { key: "c2", def: character({ name: "C2", id: "c2d" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("dt") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("meat")].counters.token, 1, "one cardsDrawn event for the batch of 2");
  });
});

// "At the start of your next turn, if this card is in play, put the voided
// character into play." (Gilded Yurt); "At the end of the turn, ..." (Vast
// Mastabatorium) - the scheduleEffect effect.
describe("Seed 2: scheduleEffect effect", () => {
  test("endOfTurn - fires as the scheduling turn ends", () => {
    const yurt = location({
      name: "EndOfTurnLoc",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            effects: [
              { type: "scheduleEffect", when: "endOfTurn", effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "y", def: yurt, owner: P1 }],
      playerA: { influence: 20 }
    });
    void id;

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("y"), abilityId: "a" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 20, "not yet");

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.players[P1].influence, 23, "fired at end of turn");
  });

  test("startOfNextTurn - fires at the start of the scheduling player's next turn, honouring its condition", () => {
    const yurt = location({
      name: "NextTurnLoc",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            effects: [
              {
                type: "scheduleEffect",
                when: "startOfNextTurn",
                condition: { type: "sourceInZone", zone: "play" },
                effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "y", def: yurt, owner: P1 }],
      playerA: { influence: 20 }
    });
    void id;

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("y"), abilityId: "a" });
    resolvePendingResponses(engine);

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.players[P1].influence, 20, "not on the opponent's turn");

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.players[P1].influence, 25, "fired at the start of P1's next turn");
  });
});

// "Use this only 5 times each turn." (Vast Mastabatorium) -
// ActivatedAbility.usesPerTurn.
describe("Seed 2: ActivatedAbility.usesPerTurn", () => {
  test("caps activations per turn and resets next turn", () => {
    const spring = location({
      name: "Twice Loc",
      behavior: {
        abilities: [
          { id: "a", type: "activated", usesPerTurn: 2, effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "s", def: spring, owner: P1 }],
      playerA: { influence: 20 }
    });
    void id;

    const use = () => { engine.perform({ type: "activateAbility", playerId: P1, cardId: id("s"), abilityId: "a" }); resolvePendingResponses(engine); };
    use();
    use();
    assert.throws(use, /only 2 time/);
    assert.equal(engine.state.players[P1].influence, 22);

    // next turn, the cap resets
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    use();
    assert.equal(engine.state.players[P1].influence, 23);
  });
});

// "Pick a number for X, where X is less than or equal to the number of [O]
// you control." (Desolate) - ActivatedAbility.variableBounds.
describe("Seed 2: variableBounds", () => {
  test("rejects a chosen variable above its dynamic max", () => {
    const desolate = tactic({
      name: "Desolate",
      behavior: {
        abilities: [
          {
            id: "d",
            type: "activated",
            variableBounds: { x: { max: { type: "resourceIcons", player: "controller", icon: "obsession" } } },
            effects: [{ type: "modifyInfluence", player: "controller", amount: { type: "variable", id: "x" } }]
          }
        ]
      }
    });
    const obs = () => resourceCard({ name: "Obsession", id: "o-des", resource: { provides: ["obsession"], staple: true } });

    const { engine, id } = buildGame({
      cards: [
        { key: "des", def: desolate, owner: P1, zone: "hand" },
        { key: "o1", def: obs(), owner: P1 },
        { key: "o2", def: obs(), owner: P1 }
      ],
      playerA: { influence: 20 }
    });

    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("des"), variables: { x: 3 } })
    );

    engine.perform({ type: "playCard", playerId: P1, cardId: id("des"), variables: { x: 2 } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 22);
  });
});

// "At the start of your turn, you may use an ability." (The Poshernacle) -
// the useAnyAbility effect.
describe("Seed 2: useAnyAbility effect", () => {
  test("chooser picks one of their cards, then one of its abilities, resolved as a sub-resolution", () => {
    const posh = location({
      name: "The Poshernacle",
      behavior: {
        abilities: [
          {
            id: "startUse",
            type: "triggered",
            event: "turnStarted",
            condition: { type: "eventPlayerIs", player: "controller" },
            effects: [{ type: "useAnyAbility", chooser: "controller" }]
          }
        ]
      }
    });
    const engine1 = character({
      name: "Piggy Bank",
      behavior: {
        abilities: [
          { id: "coin", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 4 }] }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "posh", def: posh, owner: P1 },
        { key: "bank", def: engine1, owner: P1 }
      ],
      playerA: { influence: 20 },
      activePlayerId: P2
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    assert.equal(engine.state.pendingChoice?.kind, "useAnyAbility");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "useAnyAbility", cardId: id("bank") } });

    assert.equal(engine.state.pendingChoice?.kind, "useTargetAbility");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "useTargetAbility", abilityId: "coin" } });
    settleTurnStart(engine);
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, 24);
  });
});

// "While there is a token on this card, it loses COVERT and gains 1/1."
// (Nattering Stoopswaggler) - ContinuousAbility.suppressKeywords.
describe("Seed 2: suppressKeywords", () => {
  test("a continuous suppression beats a statically-printed keyword while its condition holds", () => {
    const natter = character({
      name: "Nattering Stoopswaggler",
      behavior: {
        keywords: ["covert"],
        abilities: [
          {
            id: "tokenLoss",
            type: "continuous",
            condition: { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 1 },
            modifiers: [],
            suppressKeywords: [{ target: "source", keyword: "covert" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "n", def: natter, owner: P1, counters: {} }]
    });

    assert.equal(engine.hasKeyword(id("n"), "covert"), true, "printed COVERT with no token");

    engine.state.cards[id("n")].counters.token = 1;
    assert.equal(engine.hasKeyword(id("n"), "covert"), false, "token present -> COVERT suppressed");
  });
});

// "...it can block COVERT parties." (Recyclable Golem) - the canBlockCovert keyword.
describe("Seed 2: canBlockCovert keyword", () => {
  test("a canBlockCovert character may block an all-COVERT attacking party", () => {
    const sneaky = character({ name: "Sneaky", strength: 2, life: 2, speed: 1, behavior: { keywords: ["covert"] } });
    const golem = character({ name: "Recyclable Golem", strength: 1, life: 4, speed: 1, behavior: { keywords: ["canBlockCovert"] } });

    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: sneaky, owner: P1 },
        { key: "blk", def: golem, owner: P2 }
      ],
      activePlayerId: P1
    });

    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);

    // canBlockCovert makes this a legal block against the covert attacker
    assert.doesNotThrow(() =>
      engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] })
    );
    assert.deepEqual(engine.state.battle?.blockingParty, [id("blk")]);
  });
});

// "Characters cannot attack or be restored." (Framptle) -
// the cannotBeRestored restriction (aura form).
describe("Seed 2: cannotBeRestored restriction", () => {
  test("the faction Restore Rule skips a character under a cannotBeRestored aura", () => {
    const framptle = character({
      name: "Framptle",
      behavior: {
        abilities: [
          {
            id: "aura",
            type: "continuous",
            modifiers: [],
            restrictions: [
              { selector: { zone: "play", type: "character" }, restriction: "cannotBeRestored" }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "f", def: framptle, owner: P1 },
        { key: "guy", def: character({ name: "Guy" }), owner: P1, depleted: true }
      ]
    });

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    assert.equal(engine.state.cards[id("guy")].depleted, true, "not restored - under the aura");
  });
});

// "Reduce the next damage inflicted to the character this turn by 2."
// (Tiny Shiny); "The next X damage ... is inflicted to the second picked
// card instead." (Delectable Boon) - the preventDamage effect.
describe("Seed 2: preventDamage shield", () => {
  test("mode:reduce absorbs the next incoming damage up to `amount`", () => {
    const shield = tactic({
      name: "Tiny Shiny",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "preventDamage", target: { type: "selected", id: "t" }, amount: 2, mode: "reduce" }]
          }
        ]
      }
    });
    const bolt = tactic({
      name: "Bolt3",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "sh", def: shield, owner: P1, zone: "hand" },
        { key: "bo", def: bolt, owner: P1, zone: "hand" },
        { key: "guy", def: character({ name: "Guy", life: 10 }), owner: P1 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("sh"), selected: { t: [id("guy")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bo"), selected: { t: [id("guy")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("guy")].damage, 1, "3 - 2 absorbed");
  });

  test("mode:redirect sends the next damage to another card instead", () => {
    const boon = tactic({
      name: "Delectable Boon",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [
              { id: "from", selector: { zone: "play", type: "character" }, count: 1 },
              { id: "to", selector: { zone: "play", type: "character" }, count: 1 }
            ],
            effects: [
              { type: "preventDamage", target: { type: "selected", id: "from" }, amount: 5, mode: "redirect", redirectTo: { type: "selected", id: "to" } }
            ]
          }
        ]
      }
    });
    const bolt = tactic({
      name: "Bolt4",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "bn", def: boon, owner: P1, zone: "hand" },
        { key: "bo", def: bolt, owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A", life: 10 }), owner: P1 },
        { key: "b", def: character({ name: "B", life: 10 }), owner: P2 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("bn"), selected: { from: [id("a")], to: [id("b")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bo"), selected: { t: [id("a")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("a")].damage, 0, "a was shielded");
    assert.equal(engine.state.cards[id("b")].damage, 3, "b took the redirected 3");
  });
});

// "When battle damage is inflicted to a character in a party with this
// card, reduce the amount by 1." (Necromantic Healer) -
// the sharesBattlePartyWithSource condition inside damageModifiers.
describe("Seed 2: sharesBattlePartyWithSource (party damageModifier)", () => {
  test("reduces battle damage to a character sharing the source's party by 1", () => {
    const healer = character({
      name: "Necromantic Healer",
      strength: 1,
      life: 4,
      speed: 1,
      behavior: {
        abilities: [
          {
            id: "ward",
            type: "continuous",
            modifiers: [],
            damageModifiers: [
              {
                selector: {
                  zone: "play",
                  type: "character",
                  conditions: [
                    { type: "sharesBattlePartyWithSource", target: { type: "selected", id: "__candidate" } }
                  ]
                },
                battleOnly: true,
                delta: -1
              }
            ]
          }
        ]
      }
    });
    const bruiser = character({ name: "Bruiser", strength: 4, life: 4, speed: 1 });

    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: bruiser, owner: P1 },
        { key: "healer", def: healer, owner: P2 },
        { key: "ally", def: character({ name: "Ally", strength: 1, life: 10, speed: 1 }), owner: P2 }
      ],
      activePlayerId: P1
    });

    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("healer"), id("ally")] });
    autoResolveBattle(engine, (src) =>
      src.cardId === id("atk")
        ? [{ sourceId: src.cardId, target: { type: "card", cardId: id("ally") }, amount: src.strength }]
        : src.strength > 0 && src.legalTargets.length > 0
          ? [{ sourceId: src.cardId, target: src.legalTargets[0], amount: src.strength }]
          : []
    );

    // 4 strength - 1 (in the healer's own blocking party) = 3
    assert.equal(engine.state.cards[id("ally")].damage, 3);
  });
});

// "detach it from your faction." (Braggadocian Aide) - the detach effect.
describe("Seed 2: detach effect", () => {
  test("clears a resource's attachment to a faction", () => {
    const aide = character({
      name: "Braggadocian Aide",
      behavior: {
        abilities: [
          {
            id: "d",
            type: "activated",
            targets: [{ id: "r", selector: { controller: "self", zone: "play", type: "resource" }, count: 1 }],
            effects: [{ type: "detach", target: { type: "selected", id: "r" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "aide", def: aide, owner: P1 },
        { key: "res", def: resourceCard({ name: "R" }), owner: P1 }
      ]
    });

    const factionId = engine.state.players[P1].factionId!;
    engine.state.cards[id("res")].attachedTo = factionId;

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("aide"), abilityId: "d", selected: { r: [id("res")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("res")].attachedTo, undefined);
  });
});

// "All players remove the top 6 cards of their deck from the game."
// (Hideous Hexapede) - mill `to: "removed"`.
describe("Seed 2: mill to removed", () => {
  test("mills the top N of a deck straight to the removed zone", () => {
    const nuke = tactic({
      name: "Hideous",
      behavior: {
        abilities: [{ id: "n", type: "activated", effects: [{ type: "mill", player: "controller", count: 2, to: "removed" }] }]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "n", def: nuke, owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1", id: "d1x" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2", id: "d2x" }), owner: P1, zone: "deck" },
        { key: "d3", def: character({ name: "D3", id: "d3x" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("n") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("d1")].zone, "removed");
    assert.equal(engine.state.cards[id("d2")].zone, "removed");
    assert.equal(engine.state.cards[id("d3")].zone, "deck");
    assert.equal(engine.state.players[P1].discard.length, 1, "the tactic went to discard, not the milled cards");
  });
});

// "Put the character with the lowest numeric cost into its owner's hand."
// (Verrucose Brains) - the isExtremum condition.
describe("Seed 2: isExtremum condition", () => {
  test("only a minimal-cost character satisfies the selector", () => {
    const brains = item({
      name: "Verrucose Brains",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [
              {
                id: "t",
                selector: {
                  zone: "play",
                  type: "character",
                  conditions: [
                    {
                      type: "isExtremum",
                      target: { type: "selected", id: "__candidate" },
                      metric: "cost",
                      direction: "min",
                      among: { zone: "play", type: "character" }
                    }
                  ]
                },
                count: 1
              }
            ],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "br", def: brains, owner: P1 },
        { key: "cheap", def: character({ name: "Cheap", cost: 1, id: "cheapc" }), owner: P1 },
        { key: "pricey", def: character({ name: "Pricey", cost: 5, id: "priceyc" }), owner: P2 }
      ]
    });

    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("br"), abilityId: "b", selected: { t: [id("pricey")] } })
    );
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("br"), abilityId: "b", selected: { t: [id("cheap")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("cheap")].zone, "hand");
  });
});

// "EXTRA COST: Pick a location you control. While the picked location is in
// play, this card cannot attack or block." (Conscientious Objector) -
// rememberTarget + linkedCardInPlay + the `remembered` TargetRef.
describe("Seed 2: rememberTarget / linkedCardInPlay", () => {
  test("a continuous self-restriction gates on the remembered card still being in play", () => {
    const objector = character({
      name: "Conscientious Objector",
      behavior: {
        onPlay: {
          targets: [{ id: "anchor", selector: { controller: "self", zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "rememberTarget", key: "anchor", target: { type: "selected", id: "anchor" } }]
        },
        abilities: [
          {
            id: "pacifist",
            type: "continuous",
            condition: { type: "linkedCardInPlay", key: "anchor" },
            modifiers: [],
            restrictions: [
              { target: "source", restriction: "cannotAttack" },
              { target: "source", restriction: "cannotBlock" }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "obj", def: objector, owner: P1, zone: "hand" },
        { key: "loc", def: location({ name: "Anchor Loc", id: "anchor-loc" }), owner: P1 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("obj"), selected: { anchor: [id("loc")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.hasRestriction(id("obj"), "cannotAttack"), true);

    // remove the anchor -> restriction lifts
    engine.state.cards[id("loc")].zone = "discard";
    engine.state.players[P1].play = engine.state.players[P1].play.filter(c => c !== id("loc"));
    assert.equal(engine.hasRestriction(id("obj"), "cannotAttack"), false);
  });
});

// "PETTY VENGEANCE - Use this only while this card is a face-down resource."
// (Fired Hand) - ActivatedAbility.fromFaceDown + the sourceIsFaceDown condition.
describe("Seed 2: activate-while-facedown", () => {
  test("a fromFaceDown ability can be used while the source is a face-down resource", () => {
    const fired = character({
      name: "Fired Hand",
      behavior: {
        abilities: [
          {
            id: "petty",
            type: "activated",
            fromFaceDown: true,
            condition: { type: "sourceIsFaceDown" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [{ key: "fh", def: fired, owner: P1, zone: "play", faceDown: true }],
      playerA: { influence: 20 }
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("fh"), abilityId: "petty" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, 21);
    assert.equal(engine.state.cards[id("fh")].faceDown, true, "stays face-down");
  });
});

// "FLIP IT" staple-resource cycle (Holy Heist: Elitist Upgrade, Obsessive
// Concentration, Greedy Profiteering, Deceptive Domain, Raging Ferocity) —
// ResourceDefinition.faceDownOnly + a `fromFaceDown` activated ability whose
// first effect is the new `flipFaceUp` (turn the source face-up in place),
// then a rider. Fixture mirrors the shape authored onto Elitist Upgrade.
describe("Holy Heist: FLIP IT (flipFaceUp + faceDownOnly)", () => {
  const flipItElitistUpgrade = () =>
    resourceCard({
      name: "Elitist Upgrade",
      id: "flipit-elitist-upgrade",
      trade: "gearsmith",
      resource: { provides: ["elitism"], faceDownOnly: true },
      behavior: {
        abilities: [
          {
            id: "flip-it",
            name: "Flip It",
            type: "activated",
            fromFaceDown: true,
            threshold: "e",
            condition: {
              type: "and",
              conditions: [
                { type: "sourceIsFaceDown" },
                { type: "not", condition: { type: "battleActive" } }
              ]
            },
            costs: [{ type: "payResources", amount: 4 }],
            effects: [
              { type: "flipFaceUp", target: "source" },
              {
                type: "forEach",
                selector: { controller: "self", zone: "play", type: "character", subtype: "majig" },
                effects: [
                  {
                    type: "createModifier",
                    target: { type: "selected", id: "__candidate" },
                    stat: "strength",
                    operation: "add",
                    value: 1,
                    duration: { type: "untilEndOfTurn" }
                  },
                  {
                    type: "createModifier",
                    target: { type: "selected", id: "__candidate" },
                    stat: "life",
                    operation: "add",
                    value: 1,
                    duration: { type: "untilEndOfTurn" }
                  }
                ]
              }
            ]
          }
        ]
      }
    });

  const elitismBank = (n: number, owner: string) =>
    Array.from({ length: n }, (_, i) => ({
      key: `e-${owner}-${i}`,
      def: resourceCard({
        name: "Elitism",
        id: `flipit-elitism-${i}`,
        trade: "universal",
        resource: { provides: ["elitism"], staple: true }
      }),
      owner,
      zone: "play" as const
    }));

  test("a face-down FLIP IT resource surfaces its fromFaceDown ability, flips itself face-up on use, and resolves the rider", () => {
    const majig = character({ name: "Fleet Majig", subtype: ["majig"], strength: 1, life: 1 });

    const { engine, id } = buildGame({
      cards: [
        { key: "up", def: flipItElitistUpgrade(), owner: P1, zone: "play", faceDown: true },
        { key: "mj", def: majig, owner: P1, zone: "play" },
        ...elitismBank(5, P1)
      ]
    });

    // While face-down it is an anonymous Volition source, not [E]: only the
    // five banked Elitism count toward threshold.
    assert.equal(engine.getThresholds(P1).elitism, 5);
    assert.ok((engine.getThresholds(P1).volition ?? 0) >= 1, "(engine.getThresholds(P1).volition ?? 0) >= 1");

    // The listing surfaces the fromFaceDown ability even though the card is face-down.
    const before = engine
      .getAvailableActivatedAbilities(P1)
      .filter(a => a.cardId === id("up") && a.ability.id === "flip-it");
    assert.equal(before.length, 1, "FLIP IT is offered while the source is face-down");

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("up"), abilityId: "flip-it" });
    resolvePendingResponses(engine);

    // Source flipped face-up in place — still a resource, still in play.
    assert.equal(engine.state.cards[id("up")].faceDown, false, "source is face-up");
    assert.equal(engine.state.cards[id("up")].zone, "play");

    // ...and now providing [E]: the flipped card's icon is added on top of the
    // five banked Elitism (which are only attached, not spent — threshold
    // isn't paid from). Its Volition contribution is gone.
    assert.equal(engine.getThresholds(P1).elitism, 6, "5 banked + the flipped card");

    // Rider resolved: the majig got +1/+1 for the turn.
    assert.equal(engine.getStat(id("mj"), "strength"), 2);
    assert.equal(engine.getStat(id("mj"), "life"), 2);

    // No longer offered — the card is face-up now, so sourceIsFaceDown fails.
    const after = engine
      .getAvailableActivatedAbilities(P1)
      .filter(a => a.cardId === id("up") && a.ability.id === "flip-it");
    assert.equal(after.length, 0);
  });

  test("the FLIP IT source MAY help pay its own 'Pay N' when the other resources fall short (R6)", () => {
    // 3 banked Elitism + the face-down Elitist Upgrade itself = 4 unattached
    // resources and the cost is Pay 4: the face-down card may be one of the 4.
    const short = buildGame({
      cards: [
        { key: "up", def: flipItElitistUpgrade(), owner: P1, zone: "play", faceDown: true },
        ...elitismBank(3, P1)
      ]
    });

    const offered = short.engine
      .getAvailableActivatedAbilities(P1)
      .filter(a => a.cardId === short.id("up") && a.ability.id === "flip-it");
    assert.equal(offered.length, 1, "FLIP IT is offered: the source can fund part of its own Pay 4");

    short.engine.perform({ type: "activateAbility", playerId: P1, cardId: short.id("up"), abilityId: "flip-it" });
    resolvePendingResponses(short.engine);
    assert.equal(short.engine.state.cards[short.id("up")].faceDown, false, "flipped face-up");

    // With only 2 banked resources even counting the source it is one short.
    const tooShort = buildGame({
      cards: [
        { key: "up", def: flipItElitistUpgrade(), owner: P1, zone: "play", faceDown: true },
        ...elitismBank(2, P1)
      ]
    });
    assert.throws(
      () =>
        tooShort.engine.perform({
          type: "activateAbility",
          playerId: P1,
          cardId: tooShort.id("up"),
          abilityId: "flip-it"
        }),
      /cost/i
    );
    assert.equal(tooShort.engine.state.cards[tooShort.id("up")].faceDown, true, "still face-down — nothing happened");

    // One more banked resource: now there are 4 *other* resources, so the flip
    // is legal and every paid resource comes from the bank, not the source.
    const ok = buildGame({
      cards: [
        { key: "up", def: flipItElitistUpgrade(), owner: P1, zone: "play", faceDown: true },
        ...elitismBank(4, P1)
      ]
    });

    const okOffered = ok.engine
      .getAvailableActivatedAbilities(P1)
      .filter(a => a.cardId === ok.id("up") && a.ability.id === "flip-it");
    assert.equal(okOffered.length, 1, "FLIP IT is offered once 4 other resources are available");

    ok.engine.perform({ type: "activateAbility", playerId: P1, cardId: ok.id("up"), abilityId: "flip-it" });
    resolvePendingResponses(ok.engine);

    const flipped = ok.engine.state.cards[ok.id("up")];
    assert.equal(flipped.faceDown, false, "source flipped face-up");
    assert.equal(flipped.attachedTo, undefined, "source was NOT spent to pay its own cost");
    const bankAttached = [0, 1, 2, 3].filter(
      i => ok.engine.state.cards[ok.id(`e-${P1}-${i}`)].attachedTo !== undefined
    );
    assert.equal(bankAttached.length, 4, "all 4 paid resources came from the bank");
  });

  test("faceDownOnly forbids a face-up develop play, but allows a face-down one", () => {
    const faction = factionCard({
      name: "PR-Faction",
      faction: defaultFactionDefinition({
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [{ type: "playResource", count: 1 }] }
        }
      })
    });

    const mk = () =>
      buildGame({
        playerA: { faction },
        cards: [{ key: "up", def: flipItElitistUpgrade(), owner: P1, zone: "hand" }]
      });

    // The Develop Rule cannot play it face-up: it enters face-down whichever side is asked for.
    const faceUp = mk();
    developPlay(faceUp.engine, P1, faceUp.id("up"), false);
    resolvePendingResponses(faceUp.engine);
    assert.equal(faceUp.engine.state.cards[faceUp.id("up")].zone, "play");
    assert.equal(faceUp.engine.state.cards[faceUp.id("up")].faceDown, true);

    const faceDown = mk();
    developPlay(faceDown.engine, P1, faceDown.id("up"), true);
    resolvePendingResponses(faceDown.engine);
    assert.equal(faceDown.engine.state.cards[faceDown.id("up")].zone, "play");
    assert.equal(faceDown.engine.state.cards[faceDown.id("up")].faceDown, true);
    // Face-down: an anonymous Volition source, not [E] yet.
    assert.ok((faceDown.engine.getThresholds(P1).volition ?? 0) >= 1, "(faceDown.engine.getThresholds(P1).volition ?? 0) >= 1");
    assert.equal(faceDown.engine.getThresholds(P1).elitism ?? 0, 0);
  });
});

// "Duplicate the tactic. Terminate the tactic." (Muddle) - the duplicate
// effect + terminate scope "respondedItem" + respondingTo "ability".
describe("Seed 2: duplicate + respond-to-ability", () => {
  test("Muddle resolves a copy of the responded-to tactic's effects, then terminates the original", () => {
    const muddle = tactic({
      name: "Muddle",
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            condition: { type: "respondingTo", cardType: "tactic" },
            effects: [
              { type: "duplicate", target: { type: "respondedToCard" } },
              { type: "terminate", scope: "target", target: { type: "respondedToCard" } }
            ]
          }
        ]
      }
    });
    const gain = tactic({
      name: "Big Gain",
      behavior: { abilities: [{ id: "g", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 4 }] }] }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "gain", def: gain, owner: P2, zone: "hand" },
        { key: "mud", def: muddle, owner: P1, zone: "hand" }
      ],
      activePlayerId: P2,
      playerB: { influence: 20 }
    });

    engine.perform({ type: "playCard", playerId: P2, cardId: id("gain") });
    // P1 responds with Muddle
    engine.perform({ type: "playCard", playerId: P1, cardId: id("mud") });
    resolvePendingResponses(engine);

    // Big Gain itself was terminated (never resolved for P2).
    assert.equal(engine.state.cards[id("gain")].zone, "discard");
    assert.equal(engine.state.players[P2].influence, 20, "the terminated original never gave P2 +4");
    // P1's Muddle duplicated Big Gain's "+4 influence" under P1's control
    assert.equal(engine.state.players[P1].influence, 29);
  });

  test("respondingTo respondsTo:'ability' + terminate respondedItem", () => {
    const cockblock = tactic({
      name: "Cock Block",
      behavior: {
        abilities: [
          {
            id: "cb",
            type: "activated",
            condition: { type: "respondingTo", respondsTo: "ability" },
            effects: [{ type: "terminate", scope: "respondedItem" }]
          }
        ]
      }
    });
    const pinger = character({
      name: "Pinger",
      behavior: {
        abilities: [
          { id: "ping", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "ping", def: pinger, owner: P2 },
        { key: "cb", def: cockblock, owner: P1, zone: "hand" }
      ],
      activePlayerId: P2,
      playerA: { influence: 20 }
    });

    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("ping"), abilityId: "ping" });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("cb") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.players[P1].influence, 20, "the ping ability was terminated before it resolved");
  });
});

// "ENSNARE - COST: Pay 1 or destroy a Micromajig token you control."
// (Time Traveler Tourist Trap) - the oneOf alternative cost.
describe("Seed 2: oneOf alternative cost", () => {
  test("auto-pays the first payable branch", () => {
    const trap = location({
      name: "Time Traveler Tourist Trap",
      behavior: {
        abilities: [
          {
            id: "ensnare",
            type: "activated",
            costs: [
              {
                type: "oneOf",
                options: [
                  [{ type: "payResources", amount: 1 }],
                  [{ type: "destroy", target: { type: "random", selector: { controller: "self", zone: "play", subtype: "micromajig" } } }]
                ]
              }
            ],
            effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "trap", def: trap, owner: P1 },
        { key: "r", def: resourceCard({ name: "R" }), owner: P1 }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("trap"), abilityId: "ensnare" });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("trap")].counters.token, 1);
    // paid with the resource (branch 1), which is now attached to the faction
    assert.equal(engine.state.cards[id("r")].attachedTo, engine.state.players[P1].factionId);
  });
});

// "All characters gain the rules text «At the start of your turn, you may
// pay 1. If you don't, destroy this card.»" (Lodge Dock Florist) -
// ContinuousAbility.grantedAbilities (a granted triggered ability).
describe("Seed 2: ContinuousAbility.grantedAbilities", () => {
  test("a granted triggered ability fires for every matching card while the aura is in play", () => {
    const florist = location({
      name: "Lodge Dock Florist",
      behavior: {
        abilities: [
          {
            id: "tax",
            type: "continuous",
            modifiers: [],
            grantedAbilities: [
              {
                selector: { zone: "play", type: "character" },
                abilities: [
                  {
                    id: "florist-upkeep",
                    type: "triggered",
                    event: "turnStarted",
                    condition: { type: "eventPlayerIs", player: "controller" },
                    effects: [
                      {
                        type: "mayPay",
                        player: "controller",
                        costs: [{ type: "payResources", amount: 1 }],
                        effects: [],
                        elseEffects: [{ type: "destroy", target: "source" }]
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
        { key: "florist", def: florist, owner: P1 },
        { key: "guy", def: character({ name: "Guy", life: 3 }), owner: P1 }
      ],
      activePlayerId: P2
    });

    // P2 -> P1: at the start of P1's turn the granted upkeep fires for "guy";
    // P1 has no resources, so it can't pay and "guy" is destroyed.
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    assert.equal(engine.state.cards[id("guy")].zone, "discard", "couldn't pay the granted upkeep");
  });

  test("removing the aura source takes the granted ability with it", () => {
    const florist = location({
      name: "Lodge Dock Florist 2",
      behavior: {
        abilities: [
          {
            id: "tax",
            type: "continuous",
            modifiers: [],
            grantedAbilities: [
              {
                selector: { zone: "play", type: "character" },
                abilities: [
                  {
                    id: "florist-upkeep-2",
                    type: "triggered",
                    event: "turnStarted",
                    condition: { type: "eventPlayerIs", player: "controller" },
                    effects: [{ type: "destroy", target: "source" }]
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
        { key: "florist", def: florist, owner: P1, zone: "discard" },
        { key: "guy", def: character({ name: "Guy", life: 3 }), owner: P1 }
      ],
      activePlayerId: P2
    });

    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    assert.equal(engine.state.cards[id("guy")].zone, "play", "aura not in play -> no granted upkeep");
  });
});

// "All your face-down tactics gain FLIP UP with numeric cost and threshold
// equal to their regular numeric cost and threshold." (Woadenworm
// Gloamspike) - ContinuousAbility.grantFlipUp.
describe("Seed 2: ContinuousAbility.grantFlipUp", () => {
  test("a face-down tactic with no printed FLIP UP can be flipped up for its printed cost while the aura is out", () => {
    const gloamspike = character({
      name: "Woadenworm Gloamspike",
      behavior: {
        abilities: [
          {
            id: "grant",
            type: "continuous",
            modifiers: [],
            grantFlipUp: { selector: { controller: "self", zone: "play", type: "tactic", faceDown: true } }
          }
        ]
      }
    });
    const plainTactic = tactic({
      name: "Plain Tactic",
      id: "plain-tac",
      cost: 1,
      threshold: "o",
      behavior: { abilities: [{ id: "t", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }] }
    });
    const obs = () => resourceCard({ name: "Obsession", id: "o-gs", resource: { provides: ["obsession"], staple: true } });

    // without the aura: no FLIP UP
    {
      const { engine, id } = buildGame({
        cards: [
          { key: "fd", def: plainTactic, owner: P1, zone: "play", faceDown: true },
          { key: "o1", def: obs(), owner: P1 }
        ]
      });
      assert.throws(() => engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") }), /no FLIP UP/);
    }

    // with the aura: flips up for printed cost 1 / threshold [O]
    {
      const { engine, id } = buildGame({
        cards: [
          { key: "gs", def: gloamspike, owner: P1 },
          { key: "fd", def: plainTactic, owner: P1, zone: "play", faceDown: true },
          { key: "o1", def: obs(), owner: P1 },
          { key: "o2", def: obs(), owner: P1 }
        ],
        playerA: { influence: 20 }
      });
      engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.players[P1].influence, 22, "the tactic resolved");
      assert.equal(engine.state.cards[id("fd")].zone, "discard");
    }
  });
});

// "This turn, the item is a golem character with strength and life equal to
// its numeric cost and 3 speed." (Contrabulous Fabtraption — RUNE OF
// ANIMATION) — the setCardType effect. Per CR §208.1 the character type is
// ADDED; the card keeps its printed type too.
describe("Seed 2: setCardType (type-change-modifier)", () => {
  const animator = (): CardDefinition =>
    item({
      name: "Animator",
      id: "animator-x",
      behavior: {
        abilities: [
          {
            id: "animate",
            type: "activated",
            costs: [{ type: "destroy", target: "source" }],
            targets: [{ id: "it", selector: { zone: "play", type: "item" }, count: 1 }],
            effects: [
              {
                type: "setCardType",
                target: { type: "selected", id: "it" },
                cardType: "character",
                grantStats: {
                  strength: { type: "cardCost", target: { type: "selected", id: "it" } },
                  life: { type: "cardCost", target: { type: "selected", id: "it" } },
                  speed: 3
                },
                duration: { type: "untilEndOfTurn" }
              }
            ]
          }
        ]
      }
    });

  test("an animated item is an effective character with the granted stats, and dies to lethal damage as one", () => {
    const bolt = tactic({
      name: "Golem Bolt",
      id: "golem-bolt",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            // targets a CHARACTER — the animated item only qualifies while the grant holds
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 4 }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "anim", def: animator(), owner: P1 },
        { key: "cog", def: item({ name: "Cog", id: "cog-x", cost: 4 }), owner: P1 },
        { key: "bolt", def: bolt, owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("anim"), abilityId: "animate", selected: { it: [id("cog")] } });
    resolvePendingResponses(engine);

    assert.ok(engine.hasCardType(id("cog"), "character"), "gained the character type");
    assert.ok(engine.hasCardType(id("cog"), "item"), "kept its printed type (CR §208.1)");
    assert.equal(engine.getStat(id("cog"), "strength"), 4);
    assert.equal(engine.getStat(id("cog"), "life"), 4);
    assert.equal(engine.getStat(id("cog"), "speed"), 3);

    // a character-only bolt can now pick it, and 4 damage is lethal (life 4)
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bolt"), selected: { t: [id("cog")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("cog")].zone, "discard");
  });

  test("the grant expires at the start of the controller's next turn — reverts to item, forgets this-turn damage", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "anim", def: animator(), owner: P1 },
        { key: "cog", def: item({ name: "Cog", id: "cog-y", cost: 6 }), owner: P1 }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("anim"), abilityId: "animate", selected: { it: [id("cog")] } });
    resolvePendingResponses(engine);
    assert.ok(engine.hasCardType(id("cog"), "character"), "engine.hasCardType(id(\"cog\"), \"character\")");

    // 3 non-lethal damage (life 6)
    engine.state.cards[id("cog")].damage = 3;

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    assert.deepEqual(engine.getCardTypes(id("cog")), ["item"], "the added character type expired");
    assert.equal(engine.getStat(id("cog"), "strength"), 0, "granted stat modifier expired too");
    assert.equal(engine.state.cards[id("cog")].damage, 0, "CR §208.3 — damage forgotten on losing the character type");
  });
});

// "Deploy this only in response to a card or ability that picked a character
// as an extra cost. Pick another character ... its effect happens as though
// your opponent had picked the other character instead." (Mistaken Identity)
// — the respondedToPicked condition + retargetExtraCost effect.
describe("Seed 2: retargetExtraCost (Mistaken Identity)", () => {
  test("rewrites the responded-to card's extra-cost pick so it resolves against the other character", () => {
    const grabber = tactic({
      name: "Grabber",
      id: "grabber-x",
      behavior: {
        abilities: [
          {
            id: "g",
            type: "activated",
            // EXTRA COST: pick a character; EFFECT: destroy it
            targets: [{ id: "v", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "v" } }]
          }
        ]
      }
    });
    const mistaken = tactic({
      name: "Mistaken Identity",
      id: "mistaken-x",
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            condition: {
              type: "and",
              conditions: [
                { type: "respondingTo" },
                { type: "respondedToPicked", cardType: "character" }
              ]
            },
            targets: [{ id: "other", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [
              { type: "retargetExtraCost", cardType: "character", to: { type: "selected", id: "other" } }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "grab", def: grabber, owner: P2, zone: "hand" },
        { key: "mi", def: mistaken, owner: P1, zone: "hand" },
        { key: "ally", def: character({ name: "Ally", id: "ally-x", life: 3 }), owner: P1 },
        { key: "chump", def: character({ name: "Chump", id: "chump-x", life: 3 }), owner: P1 }
      ],
      activePlayerId: P2
    });

    engine.perform({ type: "playCard", playerId: P2, cardId: id("grab"), selected: { v: [id("ally")] } });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("mi"), selected: { other: [id("chump")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("ally")].zone, "play", "the originally-picked character was spared");
    assert.equal(engine.state.cards[id("chump")].zone, "discard", "the swapped-in character took the effect");
  });

  test("the EXTRA COST gate fails when the responded-to card picked no character", () => {
    const noPick = tactic({
      name: "No Pick",
      id: "nopick-x",
      behavior: { abilities: [{ id: "n", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
    });
    const mistaken = tactic({
      name: "Mistaken Identity",
      id: "mistaken-y",
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            condition: { type: "respondedToPicked", cardType: "character" },
            targets: [{ id: "other", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "retargetExtraCost", cardType: "character", to: { type: "selected", id: "other" } }]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "np", def: noPick, owner: P2, zone: "hand" },
        { key: "mi", def: mistaken, owner: P1, zone: "hand" },
        { key: "ch", def: character({ name: "Ch", id: "ch-y" }), owner: P1 }
      ],
      activePlayerId: P2
    });

    engine.perform({ type: "playCard", playerId: P2, cardId: id("np") });
    assert.throws(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("mi"), selected: { other: [id("ch")] } }),
      /cannot be deployed right now/
    );
  });
});

// "While this card is in your hand you may reveal this card as you are
// playing a resource. If you do, you may deploy this card for 1." (Witty
// Worm) — CardDefinition.revealFromHand + the Develop Rule's resource play.
describe("Seed 2: revealFromHand alt-deploy (Witty Worm)", () => {
  const obs = () => resourceCard({ name: "Obsession", id: "o-ww", resource: { provides: ["obsession"], staple: true } });
  const devFaction = () =>
    factionCard({
      name: "Dev Faction",
      faction: {
        startingInfluence: 25,
        setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [{ type: "playResource", count: 1 }] }
        }
      }
    });

  test("reveals from hand as the develop play and deploys for the flat cost, threshold still enforced", () => {
    const worm = character({
      name: "Witty Worm",
      id: "witty-worm-x",
      cost: 4,
      threshold: "oo",
      revealFromHand: { cost: 1 }
    });

    const { engine, id } = buildGame({
      playerA: { faction: devFaction() },
      cards: [
        { key: "worm", def: worm, owner: P1, zone: "hand" },
        { key: "res", def: obs(), owner: P1, zone: "hand" },
        { key: "o1", def: obs(), owner: P1 },
        { key: "o2", def: obs(), owner: P1 },
        { key: "o3", def: obs(), owner: P1 }
      ]
    });

    // The resource being played is the other hand card; revealing the Worm is offered before it enters play.
    openDevelop(engine, P1);
    chooseDevelopOption(engine, P1, "Play a resource");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("res")] }
    });
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "resourceReveal", cardId: id("worm") } });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown: false } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("worm")].zone, "play", "deployed from hand");
    assert.equal(engine.state.cards[id("res")].zone, "play", "the resource was played as well");
    assert.equal(engine.state.pendingChoice, undefined, "the develop rule is used up for the turn");
    const factionId = engine.state.players[P1].factionId!;
    const spent = [id("o1"), id("o2"), id("o3")].filter(r => engine.state.cards[r].attachedTo === factionId);
    assert.equal(spent.length, 1, "exactly the flat cost of 1 was paid");
  });

  test("rejected when the printed threshold isn't met even though the flat cost is affordable", () => {
    const worm = character({
      name: "Witty Worm",
      id: "witty-worm-y",
      cost: 4,
      threshold: "ooo",
      revealFromHand: { cost: 1 }
    });

    const { engine, id } = buildGame({
      playerA: { faction: devFaction() },
      cards: [
        { key: "worm", def: worm, owner: P1, zone: "hand" },
        { key: "res", def: obs(), owner: P1, zone: "hand" },
        { key: "o1", def: obs(), owner: P1 },
        { key: "o2", def: obs(), owner: P1 }
      ]
    });

    // The reveal is not even offered while the Worm's threshold is unmet: only the resource's face is asked.
    openDevelop(engine, P1);
    chooseDevelopOption(engine, P1, "Play a resource");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("res")] }
    });
    assert.equal(engine.state.pendingChoice?.kind, "playResource");
    assert.equal(engine.state.cards[id("worm")].zone, "hand");
  });
});

// "You and an opponent look at the top 3 cards of your decks and divide them
// into 2 face-down piles ... choose one of their opponent's piles ... the
// owner of the higher-total-cost pile may put one card into their hand ...
// shuffle the rest back." (Mustache Aficionado) — the partitionAndPick
// effect + its partitionCards / pickPile / takeFromPile pending choices.
describe("Seed 2: partitionAndPick (Mustache Aficionado — MUSTACHE SHOWDOWN)", () => {
  test("runs the full split / cross-pick / compare / take / shuffle sequence", () => {
    const aficionado = character({
      name: "Mustache Aficionado",
      id: "mustache-x",
      behavior: {
        abilities: [
          {
            id: "showdown",
            type: "activated",
            costs: [{ type: "deplete", target: "source" }],
            effects: [{ type: "partitionAndPick", count: 3, piles: 2, compareBy: "cost", winnerTakes: 1 }]
          }
        ]
      }
    });

    const dc = (name: string, cost: number) => character({ name, id: name.toLowerCase(), cost, life: 3 });

    const { engine, id } = buildGame({
      cards: [
        { key: "afi", def: aficionado, owner: P1 },
        { key: "a1", def: dc("A1", 1), owner: P1, zone: "deck" },
        { key: "a2", def: dc("A2", 1), owner: P1, zone: "deck" },
        { key: "a3", def: dc("A3", 5), owner: P1, zone: "deck" },
        { key: "b1", def: dc("B1", 1), owner: P2, zone: "deck" },
        { key: "b2", def: dc("B2", 1), owner: P2, zone: "deck" },
        { key: "b3", def: dc("B3", 1), owner: P2, zone: "deck" }
      ]
    });

    // fresh read each step: `assert.equal` is an assertion fn, so reusing
    // one `pendingChoice` reference across the sequence narrows it to `never`
    const pc = () => engine.state.pendingChoice as { kind: string; playerId: string; candidates?: string[] } | undefined;

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("afi"), abilityId: "showdown" });
    resolvePendingResponses(engine);

    // P1 splits their revealed [A1, A2, A3] into [A1,A2] + [A3]
    assert.equal(pc()?.kind, "partitionCards");
    assert.equal(pc()?.playerId, P1);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "partitionCards", piles: [[id("a1"), id("a2")], [id("a3")]] }
    });

    // P2 splits [B1, B2, B3] into [B1,B2] + [B3]
    assert.equal(pc()?.playerId, P2);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "partitionCards", piles: [[id("b1"), id("b2")], [id("b3")]] }
    });

    // P1 picks one of P2's piles — index 0 ([B1,B2], total cost 2)
    assert.equal(pc()?.kind, "pickPile");
    assert.equal(pc()?.playerId, P1);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "pickPile", index: 0 } });

    // P2 picks one of P1's piles — index 1 ([A3], total cost 5)
    assert.equal(pc()?.playerId, P2);
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "pickPile", index: 1 } });

    // P1's chosen pile ([A3], 5) beats P2's ([B1,B2], 2) -> P1 (owner) may take from [A3]
    assert.equal(pc()?.kind, "takeFromPile");
    assert.equal(pc()?.playerId, P1);
    assert.deepEqual(pc()?.candidates, [id("a3")]);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "takeFromPile", cardIds: [id("a3")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.pendingPartition, undefined);
    assert.equal(engine.state.players[P1].hand.includes(id("a3")), true, "the winner took A3");
    assert.equal(engine.state.players[P1].deck.includes(id("a1")), true, "un-taken cards shuffled back");
    assert.equal(engine.state.players[P1].deck.includes(id("a2")), true);
    assert.equal(engine.state.players[P2].deck.length, 3, "P2 kept all 3, shuffled back");
  });

  test("a tie in total cost means nobody takes a card", () => {
    const aficionado = character({
      name: "Mustache Aficionado",
      id: "mustache-y",
      behavior: {
        abilities: [
          {
            id: "showdown",
            type: "activated",
            costs: [{ type: "deplete", target: "source" }],
            effects: [{ type: "partitionAndPick", count: 3, piles: 2, compareBy: "cost", winnerTakes: 1 }]
          }
        ]
      }
    });
    const dc = (name: string, cost: number) => character({ name, id: name.toLowerCase() + "t", cost, life: 3 });

    const { engine, id } = buildGame({
      cards: [
        { key: "afi", def: aficionado, owner: P1 },
        { key: "a1", def: dc("A1", 2), owner: P1, zone: "deck" },
        { key: "a2", def: dc("A2", 2), owner: P1, zone: "deck" },
        { key: "a3", def: dc("A3", 2), owner: P1, zone: "deck" },
        { key: "b1", def: dc("B1", 2), owner: P2, zone: "deck" },
        { key: "b2", def: dc("B2", 2), owner: P2, zone: "deck" },
        { key: "b3", def: dc("B3", 2), owner: P2, zone: "deck" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("afi"), abilityId: "showdown" });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "partitionCards", piles: [[id("a1")], [id("a2"), id("a3")]] } });
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "partitionCards", piles: [[id("b1")], [id("b2"), id("b3")]] } });
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "pickPile", index: 0 } });
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "pickPile", index: 0 } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice, undefined, "no takeFromPile on a tie");
    assert.equal(engine.state.pendingPartition, undefined);
    assert.equal(engine.state.players[P1].deck.length, 3);
    assert.equal(engine.state.players[P2].deck.length, 3);
  });
});

// "Reveal the top 5 cards of an opponent's deck. You may choose a revealed
// character ... put it into play. That player puts the remaining cards on
// the bottom of their deck in any order." (Rosy Palmer, and Her Five
// Friends) — CardSelector.fromTop + lookAndReorder `to: "bottom"`.
describe("Seed 2: Rosy Palmer, and Her Five Friends (fromTop pool + reorder to bottom)", () => {
  test("lookAndReorder `to: \"bottom\"` relocates the top N to the deck bottom in the chosen order", () => {
    const mover = character({
      name: "Bottom Feeder",
      behavior: {
        abilities: [
          {
            id: "shuffle-down",
            type: "activated",
            effects: [{ type: "lookAndReorder", player: "controller", count: 2, to: "bottom" }]
          }
        ]
      }
    });
    const dc = (n: string) => character({ name: n, id: n.toLowerCase() + "-bf" });
    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: mover, owner: P1 },
        { key: "d1", def: dc("D1"), owner: P1, zone: "deck" },
        { key: "d2", def: dc("D2"), owner: P1, zone: "deck" },
        { key: "d3", def: dc("D3"), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("m"), abilityId: "shuffle-down" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [id("d2"), id("d1")] } });
    resolvePendingResponses(engine);

    assert.deepEqual(engine.state.players[P1].deck, [id("d3"), id("d2"), id("d1")], "D1/D2 went to the bottom in the chosen order");
  });

  test("the full Rosy sequence: pick a top-5 character, opponent bottoms the leftovers", () => {
    const bolt = tactic({
      name: "Rosy Bolt",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 10 }]
          }
        ]
      }
    });
    const rosy = character({
      name: "Rosy Palmer, and Her Five Friends",
      id: "rosy-fix",
      life: 2,
      unique: "rosy",
      behavior: {
        abilities: [
          {
            id: "parting-gift",
            type: "triggered",
            event: "cardDestroyed",
            condition: { type: "sourceIsEventCard" },
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: {
                  id: "grab",
                  selector: { owner: "opponent", zone: "deck", type: "character", fromTop: 5 },
                  count: 1,
                  optional: true
                },
                effects: [
                  {
                    type: "if",
                    condition: { type: "targetExists", target: { type: "selected", id: "grab" } },
                    effects: [{ type: "putIntoPlay", target: { type: "selected", id: "grab" }, controller: "controller" }]
                  },
                  {
                    type: "lookAndReorder",
                    player: "opponent",
                    to: "bottom",
                    count: { type: "add", values: [5, { type: "multiply", values: [-1, { type: "selectionCount", id: "grab" }] }] }
                  }
                ]
              }
            ]
          }
        ]
      }
    });
    const dk = (n: string, kind: "char" | "item") =>
      kind === "char"
        ? character({ name: n, id: n.toLowerCase() + "-r" })
        : item({ name: n, id: n.toLowerCase() + "-r" });

    const { engine, id } = buildGame({
      cards: [
        { key: "rosy", def: rosy, owner: P1 },
        { key: "bolt", def: bolt, owner: P1, zone: "hand" },
        // P2 deck top->bottom: C1 C2 C3 C4 C5 C6  (C6 is a character but OUT of the top 5)
        { key: "c1", def: dk("C1", "char"), owner: P2, zone: "deck" },
        { key: "c2", def: dk("C2", "item"), owner: P2, zone: "deck" },
        { key: "c3", def: dk("C3", "char"), owner: P2, zone: "deck" },
        { key: "c4", def: dk("C4", "char"), owner: P2, zone: "deck" },
        { key: "c5", def: dk("C5", "item"), owner: P2, zone: "deck" },
        { key: "c6", def: dk("C6", "char"), owner: P2, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("bolt"), selected: { t: [id("rosy")] } });
    resolvePendingResponses(engine);

    // fresh read each step: `assert.equal` is an assertion fn, so reusing
    // one `pendingChoice` reference across the sequence narrows it to `never`
    const pc = () => engine.state.pendingChoice as { kind: string; playerId: string; cardIds?: string[] } | undefined;

    assert.equal(pc()?.kind, "chooserSelectsTarget");
    // C6 is a character but not in the top 5 -> illegal pick
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("c6")] } }),
      /Illegal target/
    );
    // take C3 (a character in the top 5)
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("c3")] } });

    // opponent now reorders the 4 leftover revealed cards onto the bottom
    assert.equal(pc()?.kind, "reorderDeck");
    assert.equal(pc()?.playerId, P2);
    assert.deepEqual(pc()?.cardIds, [id("c1"), id("c2"), id("c4"), id("c5")]);
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "reorderDeck", order: [id("c5"), id("c4"), id("c2"), id("c1")] } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("c3")].zone, "play");
    assert.equal(engine.state.cards[id("c3")].controllerId, P1);
    assert.deepEqual(
      engine.state.players[P2].deck,
      [id("c6"), id("c5"), id("c4"), id("c2"), id("c1")],
      "C6 (unrevealed) stays on top; the 4 leftovers are bottomed in P2's chosen order"
    );
  });
});

// Seed 3 "EPIC"/"Showdown" faction cards (The Evil Alliance, Imperial Army,
// The Knitting Coalition, ...) — FactionDefinition.abilities /
// meetsAllThresholds / turn.startOfTurnEffects / develop.usesPerTurn, and
// ActivatedAbility.usableBy. See RULES.md §3.6.
describe("Seed 3: faction-card mechanics", () => {
  const fac = (over: Record<string, unknown>): CardDefinition =>
    factionCard({
      name: "F",
      faction: {
        startingInfluence: 25,
        setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [{ type: "draw", count: 1 }] }
        },
        ...over
      }
    });
  const staple = (icon: string, i: number): CardDefinition =>
    resourceCard({ name: icon, id: `fm-${icon}-${i}`, resource: { provides: [icon as "rage"], staple: true } });

  test("FactionDefinition.abilities: the controller can activate a faction's printed ability", () => {
    const { engine } = buildGame({
      playerA: {
        faction: fac({
          abilities: [
            { id: "fac-draw", name: "Draw", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }
          ]
        })
      },
      cards: [
        { key: "g", def: staple("greed", 0), owner: P1 },
        { key: "d1", def: character({ name: "D1", id: "fm-d1" }), owner: P1, zone: "deck" }
      ]
    });
    const factionId = engine.state.players[P1].factionId!;
    const before = engine.state.players[P1].hand.length;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: factionId, abilityId: "fac-draw" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, before + 1);
  });

  test("meetsAllThresholds (OMNIPOTENCE) lets the controller ignore every threshold", () => {
    const { engine, id } = buildGame({
      playerA: { faction: fac({ meetsAllThresholds: true }) },
      cards: [{ key: "gated", def: character({ name: "Gated", id: "omni-x", cost: 0, threshold: "rrrrrr" }), owner: P1, zone: "hand" }]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gated") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("gated")].zone, "play", "deployed despite [R]x6 unmet");
  });

  test("turn.startOfTurnEffects: reduceNextCost{cardType:'character'} discounts only the next character", () => {
    const { engine, id } = buildGame({
      playerA: {
        faction: fac({
          turn: {
            restore: { detachResources: false, restoreNonResources: true },
            develop: { choices: [{ type: "draw", count: 1 }] },
            startOfTurnEffects: [{ type: "reduceNextCost", player: "controller", amount: 2, cardType: "character" }]
          }
        })
      },
      cards: [
        { key: "it", def: item({ name: "Item3", id: "sote-it", cost: 3 }), owner: P1, zone: "hand" },
        { key: "ch", def: character({ name: "Char3", id: "sote-ch", cost: 3 }), owner: P1, zone: "hand" },
        ...Array.from({ length: 4 }, (_, i) => ({ key: `r${i}`, def: staple("rage", i), owner: P1 }))
      ]
    });
    // cycle to a fresh P1 turn so the start-of-turn effect fires
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    const factionId = engine.state.players[P1].factionId!;
    const spent = () => [0, 1, 2, 3].map(i => id(`r${i}`)).filter(r => engine.state.cards[r].attachedTo === factionId).length;

    engine.perform({ type: "playCard", playerId: P1, cardId: id("it") });
    resolvePendingResponses(engine);
    assert.equal(spent(), 3, "the item paid full 3 — the discount is character-only");

    engine.perform({ type: "playCard", playerId: P1, cardId: id("ch") });
    resolvePendingResponses(engine);
    assert.equal(spent(), 4, "the character cost 3-2=1");
  });

  test("develop.usesPerTurn: 2 (OVERTIME) allows a second develop the same turn", () => {
    const { engine } = buildGame({
      playerA: {
        faction: fac({
          turn: {
            restore: { detachResources: true, restoreNonResources: true },
            develop: { choices: [{ type: "draw", count: 1 }], usesPerTurn: 2 }
          }
        })
      },
      cards: Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}`, id: `ov-d${i}` }), owner: P1, zone: "deck" }))
    });
    const before = engine.state.players[P1].hand.length;
    openDevelop(engine, P1);
    chooseDevelopOption(engine, P1, /^Draw /);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "second develop still offered");
    chooseDevelopOption(engine, P1, /^Draw /);
    assert.equal(engine.state.pendingChoice, undefined, "no third develop");
    assert.equal(engine.state.players[P1].hand.length, before + 2);
  });

  test("ActivatedAbility.usableBy:'anyPlayer' — the opponent can use it", () => {
    const { engine } = buildGame({
      playerA: {
        faction: fac({
          abilities: [
            { id: "shared-draw", name: "Inflationary Forces", type: "activated", usableBy: "anyPlayer", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }
          ]
        })
      },
      cards: [
        { key: "g0", def: staple("greed", 10), owner: P2 },
        { key: "g1", def: staple("greed", 11), owner: P2 },
        { key: "d1", def: character({ name: "D1", id: "kc-d1" }), owner: P2, zone: "deck" }
      ],
      activePlayerId: P2
    });
    const factionAId = engine.state.players[P1].factionId!;
    const before = engine.state.players[P2].hand.length;
    engine.perform({ type: "activateAbility", playerId: P2, cardId: factionAId, abilityId: "shared-draw" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].hand.length, before + 1, "P2 drew via P1's faction ability");
  });
});

// ---------------------------------------------------------------------------
// Shade of the Devoured Emperor — read-side vocabulary (conditions / exprs /
// refs used pervasively by that set). One case per primitive.
// ---------------------------------------------------------------------------
describe("SotDE read-side vocabulary", () => {
  const rageRes = (i: number): CardDefinition =>
    resourceCard({ name: "Rage", id: `sotde-rage-${i}`, trade: "warlord", resource: { provides: ["rage"], staple: true } });
  const ctx = (sourceId: string, controllerId: string, extra: Record<string, unknown> = {}) => ({
    sourceId,
    controllerId,
    selected: {},
    ...extra
  });

  test("isActivePlayer — true only on the resolved player's turn", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }],
      activePlayerId: P1
    });
    const c = ctx(id("a"), P1);
    assert.equal(engine.evaluateCondition({ type: "isActivePlayer" }, c as never), true);
    assert.equal(
      engine.evaluateCondition({ type: "isActivePlayer", player: "opponent" }, c as never),
      false
    );
  });

  test("battleActive — false with no battle, true mid-battle", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "atk", def: character({ name: "Atk", strength: 2 }), owner: P1 },
        { key: "def", def: character({ name: "Def", life: 5 }), owner: P2 }
      ]
    });
    const c = ctx(id("atk"), P1);
    assert.equal(engine.evaluateCondition({ type: "battleActive" }, c as never), false);
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
    assert.equal(engine.evaluateCondition({ type: "battleActive" }, c as never), true);
  });

  test("cardSubtypeIs — matches the printed subtype list", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "drg", def: character({ name: "Wyrm", subtype: ["dragon"] }), owner: P1 },
        { key: "guy", def: character({ name: "Guy", subtype: ["lackey"] }), owner: P1 }
      ]
    });
    assert.equal(
      engine.evaluateCondition(
        { type: "cardSubtypeIs", target: { type: "selected", id: "t" }, subtype: "dragon" },
        ctx(id("drg"), P1, { selected: { t: [id("drg")] } }) as never
      ),
      true
    );
    assert.equal(
      engine.evaluateCondition(
        { type: "cardSubtypeIs", target: { type: "selected", id: "t" }, subtype: "dragon" },
        ctx(id("guy"), P1, { selected: { t: [id("guy")] } }) as never
      ),
      false
    );
  });

  test("inPlaySinceTurnStart — true for a card present at turn start, false for one just deployed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "old", def: character({ name: "Old" }), owner: P1 },
        { key: "new", def: character({ name: "New", id: "sotde-new" }), owner: P1, zone: "hand" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `r${i}`, def: rageRes(i), owner: P1 }))
      ]
    });
    assert.equal(
      engine.evaluateCondition({ type: "inPlaySinceTurnStart" }, ctx(id("old"), P1) as never),
      true
    );
    engine.perform({ type: "playCard", playerId: P1, cardId: id("new") });
    resolvePendingResponses(engine);
    assert.equal(
      engine.evaluateCondition({ type: "inPlaySinceTurnStart" }, ctx(id("new"), P1) as never),
      false,
      "a character deployed this turn has not been in play since turn start"
    );
  });

  test("uniqueIs condition + CardSelector.uniqueDesignation", () => {
    const withU = (name: string, u: string): CardDefinition => character({ name, id: `u-${name}`, unique: u });
    const { engine, id } = buildGame({
      cards: [
        { key: "eu", def: withU("Eustace", "eustace"), owner: P1 },
        { key: "jo", def: withU("Jo", "jo"), owner: P1 },
        { key: "plain", def: character({ name: "Plain" }), owner: P1 }
      ]
    });
    assert.equal(
      engine.evaluateCondition(
        { type: "uniqueIs", target: { type: "selected", id: "t" }, designations: ["eustace", "ignatious"] },
        ctx(id("eu"), P1, { selected: { t: [id("eu")] } }) as never
      ),
      true
    );
    assert.equal(
      engine.evaluateCondition(
        { type: "uniqueIs", target: { type: "selected", id: "t" }, designations: ["eustace"] },
        ctx(id("jo"), P1, { selected: { t: [id("jo")] } }) as never
      ),
      false
    );
    const matched = engine
      .queryCards({ zone: "play", uniqueDesignation: ["eustace", "jo"] }, ctx(id("eu"), P1) as never)
      .map(x => x.id)
      .sort();
    assert.deepEqual(matched, [id("eu"), id("jo")].sort());
  });

  test("controllerOf PlayerRef — follows a take-control", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "c", def: character({ name: "C" }), owner: P1, controller: P2 }]
    });
    assert.equal(
      engine.resolvePlayerRef(
        { type: "controllerOf", target: { type: "selected", id: "t" } },
        ctx(id("c"), P1, { selected: { t: [id("c")] } }) as never
      ).id,
      P2
    );
    assert.equal(
      engine.resolvePlayerRef(
        { type: "ownerOf", target: { type: "selected", id: "t" } },
        ctx(id("c"), P1, { selected: { t: [id("c")] } }) as never
      ).id,
      P1
    );
  });

  test("sumStat / thresholdIconCount / eventDamageAmount / damageSource", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: character({ name: "A", strength: 3 }), owner: P2 },
        { key: "b", def: character({ name: "B", strength: 5 }), owner: P2 },
        { key: "mine", def: character({ name: "Mine", strength: 1 }), owner: P1 },
        { key: "thr", def: character({ name: "Thr", threshold: "rrro" }), owner: P1 }
      ]
    });
    const c = ctx(id("mine"), P1);
    assert.equal(
      engine.evaluateNumber(
        { type: "sumStat", selector: { controller: "opponent", zone: "play", type: "character" }, stat: "strength" },
        c as never
      ),
      8
    );
    assert.equal(
      engine.evaluateNumber(
        { type: "thresholdIconCount", target: { type: "selected", id: "t" } },
        ctx(id("thr"), P1, { selected: { t: [id("thr")] } }) as never
      ),
      4
    );
    const evt = { type: "damageDealt", sourceId: id("mine"), targetId: id("a"), amount: 7 } as const;
    assert.equal(engine.evaluateNumber({ type: "eventDamageAmount" }, { ...c, event: evt } as never), 7);
    assert.equal(engine.evaluateNumber({ type: "eventDamageAmount" }, c as never), 0, "0 outside a damageDealt event");
    assert.equal(
      engine.resolvePlayerRef({ type: "controllerOf", target: { type: "damageSource" } }, { ...c, event: evt } as never).id,
      P1
    );
  });
});

// ---------------------------------------------------------------------------
// SotDE — grantProvides / loseInfluence cost / removeCardType / nameValue icon
// ---------------------------------------------------------------------------
describe("SotDE effect/cost vocabulary", () => {
  const obsRes = (i: number): CardDefinition =>
    resourceCard({ name: "Obsession", id: `sotde-obs-${i}`, trade: "arcanist", resource: { provides: ["obsession"], staple: true } });

  test("grantProvides — card gains PROVIDES this turn, counted for thresholds, gone next turn", () => {
    const imp = character({
      name: "Anxious Imp",
      threshold: "o",
      behavior: {
        abilities: [
          {
            id: "obsess",
            type: "activated",
            costs: [{ type: "payResources", amount: 2 }],
            effects: [
              { type: "grantProvides", target: "source", icon: "obsession", amount: 3, duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "imp", def: imp, owner: P1 },
        { key: "o1", def: obsRes(1), owner: P1 },
        { key: "o2", def: obsRes(2), owner: P1 }
      ]
    });
    assert.equal(engine.getThresholds(P1).obsession ?? 0, 2, "just the two obsession resources");
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("imp"), abilityId: "obsess" });
    resolvePendingResponses(engine);
    // spent resources still count for threshold (attachment only marks them
    // unavailable to pay again) — 2 + the Imp's own granted [O][O][O]
    assert.equal(engine.getThresholds(P1).obsession ?? 0, 5, "2 resources + Imp's granted PROVIDES [O][O][O]");

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.getThresholds(P1).obsession ?? 0, 2, "grant expired; the 2 resources remain");
  });

  test("loseInfluence cost — activating drops the faction's influence", () => {
    const fin = character({
      name: "Thabbashite Financier",
      behavior: {
        abilities: [
          {
            id: "blood-gold",
            type: "activated",
            costs: [{ type: "loseInfluence", amount: 1 }],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      playerA: { influence: 20 },
      cards: [
        { key: "fin", def: fin, owner: P1 },
        { key: "d1", def: character({ name: "D", id: "bg-d" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("fin"), abilityId: "blood-gold" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 19);
    assert.equal(engine.state.players[P1].hand.includes(id("d1")), true);
  });

  test("removeCardType — clears an added type and its ride-along stats", () => {
    const bunny = item({
      name: "Pogo-Bunny",
      behavior: {
        abilities: [
          {
            id: "raar",
            type: "activated",
            effects: [
              {
                type: "setCardType",
                target: "source",
                cardType: "character",
                grantStats: { strength: 2, life: 2, speed: 3 },
                duration: { type: "untilEndOfTurn" }
              }
            ]
          },
          {
            id: "hide",
            type: "activated",
            effects: [{ type: "removeCardType", target: "source", cardType: "character" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({ cards: [{ key: "b", def: bunny, owner: P1 }] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("b"), abilityId: "raar" });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("b"), "character"), true);
    assert.equal(engine.getStat(id("b"), "strength"), 2);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("b"), abilityId: "hide" });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("b"), "character"), false, "lost the character type");
    assert.equal(engine.hasCardType(id("b"), "item"), true, "kept its printed type");
    assert.equal(engine.getStat(id("b"), "strength"), 0, "ride-along strength grant dropped");
  });

  test("nameValue resourceIcon + grantProvides { fromNamed } — name an icon, grant it", () => {
    const chemist = character({
      name: "Thabbashite Chemist",
      behavior: {
        abilities: [
          {
            id: "deliniate",
            type: "activated",
            effects: [
              { type: "nameValue", chooser: "controller", valueKind: "resourceIcon", storeAs: "x" },
              {
                type: "forEach",
                selector: { controller: "self", zone: "play", type: "resource", faceDown: true },
                effects: [
                  {
                    type: "grantProvides",
                    target: { type: "selected", id: "__candidate" },
                    icon: { fromNamed: "x" },
                    amount: 1,
                    duration: { type: "untilEndOfTurn" }
                  }
                ]
              }
            ]
          }
        ]
      }
    });
    const hidden = character({ name: "Hidden", id: "chem-fd" });
    const { engine, id } = buildGame({
      cards: [
        { key: "chem", def: chemist, owner: P1 },
        { key: "fd", def: hidden, owner: P1, zone: "play", faceDown: true }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("chem"), abilityId: "deliniate" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "nameValue");
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "banana" } }),
      /resource icon/
    );
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "rage" } });
    resolvePendingResponses(engine);
    // the face-down resource provided only Volition; now also [R]
    assert.equal(engine.getThresholds(P1).rage ?? 0, 1);
    assert.equal(engine.getThresholds(P1).volition ?? 0, 1, "still a face-down Volition source too");
  });
});

// ---------------------------------------------------------------------------
// SotDE — restriction / battle vocabulary
// ---------------------------------------------------------------------------
describe("SotDE restriction/battle vocabulary", () => {
  const bolt = (): CardDefinition =>
    tactic({
      name: "Bolt",
      id: "sotde-bolt",
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
          }
        ]
      }
    });

  test("cannotBePicked — excluded from target candidates but not from forEach", () => {
    const shy = character({
      name: "Shy",
      behavior: {
        abilities: [
          { id: "hide", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBePicked" }] }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "shy", def: shy, owner: P1 },
        { key: "other", def: character({ name: "Other", id: "sotde-other", life: 5 }), owner: P1 },
        { key: "bolt", def: bolt(), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    assert.throws(
      () => engine.perform({ type: "playCard", playerId: P2, cardId: id("bolt"), selected: { t: [id("shy")] } }),
      /Illegal target/
    );
    // a forEach "all characters" still hits it
    const wrath = tactic({
      name: "Wrath",
      id: "sotde-wrath",
      behavior: {
        abilities: [
          {
            id: "w",
            type: "activated",
            effects: [
              { type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 1 }] }
            ]
          }
        ]
      }
    });
    const g2 = buildGame({
      cards: [
        { key: "shy", def: shy, owner: P1 },
        { key: "wrath", def: wrath, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    g2.engine.perform({ type: "playCard", playerId: P2, cardId: g2.id("wrath") });
    resolvePendingResponses(g2.engine);
    assert.equal(g2.engine.state.cards[g2.id("shy")].damage, 1, "swept up by the 'all characters' effect");
  });

  test("cannotBePickedByOpponents — its controller can pick it, an opponent cannot", () => {
    const shy = character({
      name: "Shy",
      behavior: {
        abilities: [
          { id: "hide", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBePickedByOpponents" }] }
        ]
      }
    });
    const foe = buildGame({
      cards: [
        { key: "shy", def: shy, owner: P1 },
        { key: "bolt", def: bolt(), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    assert.throws(
      () => foe.engine.perform({ type: "playCard", playerId: P2, cardId: foe.id("bolt"), selected: { t: [foe.id("shy")] } }),
      /Illegal target/
    );

    const own = buildGame({
      cards: [
        { key: "shy", def: shy, owner: P1 },
        { key: "bolt", def: bolt(), owner: P1, zone: "hand" }
      ]
    });
    own.engine.perform({ type: "playCard", playerId: P1, cardId: own.id("bolt"), selected: { t: [own.id("shy")] } });
    resolvePendingResponses(own.engine);
    assert.equal(own.engine.state.cards[own.id("shy")].damage, 1);

    // The public candidate query a renderer uses agrees with the engine's verdict.
    const selector = { zone: "play" as const, type: "character" as const };
    const ctx = (controllerId: typeof P1) => ({ sourceId: own.id("bolt"), controllerId, selected: {} });
    assert.deepEqual(own.engine.targetCandidates(selector, ctx(P1)).map(c => c.id), [own.id("shy")]);
    assert.deepEqual(own.engine.targetCandidates(selector, ctx(P2)).map(c => c.id), []);
    assert.deepEqual(own.engine.targetCandidates(selector, ctx(P1), P2).map(c => c.id), [], "picker override");
  });

  test("attackOncePerTurn restriction — a second attack the same turn is rejected", () => {
    const roller = character({
      name: "Skullcrush Steamroller",
      strength: 4,
      life: 5,
      behavior: {
        abilities: [
          { id: "limit", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "attackOncePerTurn" }] },
          { id: "assist", type: "activated", effects: [{ type: "restore", target: "source" }] }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "r", def: roller, owner: P1 },
        { key: "def", def: character({ name: "Def", id: "sotde-def", life: 9 }), owner: P2 }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("r")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(engine.state.battle, undefined, "battle finished");
    // restore it so depletion isn't what blocks the retry
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("r"), abilityId: "assist" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("r")].depleted, false);
    assert.throws(
      () => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("r")], target: { type: "faction", playerId: P2 } }),
      /once each turn/
    );
  });

  test("suppressAllAbilities — a card loses its other abilities, keeps the suppressor's own rider", () => {
    // "[R][R][R][R][R][R]: loses all other rules text and loses 1 speed"
    const blockhead = character({
      name: "Rushing Crushing Blockhead",
      speed: 4,
      behavior: {
        abilities: [
          { id: "cantblock", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBlock" }] },
          {
            id: "etb-influence",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -5 }]
          },
          {
            id: "rage6",
            type: "continuous",
            condition: { type: "numberCompare", left: { type: "resourceIcons", player: "controller", icon: "rage" }, operator: ">=", right: 2 },
            modifiers: [{ target: "source", stat: "speed", operation: "add", value: -1 }],
            suppressAllAbilities: { target: "source" }
          }
        ]
      }
    });
    const rr = (i: number): CardDefinition =>
      resourceCard({ name: "Rage", id: `blk-r-${i}`, trade: "warlord", resource: { provides: ["rage"], staple: true } });
    const { engine, id } = buildGame({
      playerB: { influence: 25 },
      cards: [
        { key: "blk", def: blockhead, owner: P1, zone: "hand" },
        { key: "r1", def: rr(1), owner: P1 },
        { key: "r2", def: rr(2), owner: P1 }
      ]
    });
    const before = engine.state.players[P2].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("blk") });
    resolvePendingResponses(engine);
    // [R][R] threshold met => rage6 suppresses the ETB trigger, so no influence hit
    assert.equal(engine.state.players[P2].influence, before, "ETB trigger suppressed");
    assert.equal(engine.hasRestriction(id("blk"), "cannotBlock"), false, "the other continuous is suppressed");
    assert.equal(engine.getStat(id("blk"), "speed"), 3, "the suppressor's own -1 speed still applies");
  });

  test("restrictPlay — cannot play the named card type, and cannot FLIP UP", () => {
    const disturb = tactic({
      name: "Study Disturbance",
      id: "sotde-disturb",
      behavior: {
        abilities: [
          {
            id: "d",
            type: "activated",
            effects: [
              { type: "restrictPlay", player: "controller", kind: "cardType", cardType: "character", duration: { type: "untilEndOfTurn" } },
              { type: "restrictPlay", player: "controller", kind: "flipUp", duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "d", def: disturb, owner: P1, zone: "hand" },
        { key: "guy", def: character({ name: "Guy", id: "sotde-guy" }), owner: P1, zone: "hand" },
        { key: "fd", def: { ...character({ name: "FD", id: "sotde-fd" }), flipUp: { cost: 0, threshold: 0 } }, owner: P1, zone: "play", faceDown: true }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("d") });
    resolvePendingResponses(engine);
    assert.throws(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("guy") }),
      /cannot play character/
    );
    assert.throws(
      () => engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") }),
      /FLIP UP/
    );
    // clears at end of turn
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("guy") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("guy")].zone, "play");
  });
});

// ---------------------------------------------------------------------------
// SotDE — new-shape authored cards (smoke) + damage history + leave-play links
// ---------------------------------------------------------------------------
describe("SotDE new-shape cards", () => {
  test("dealDamage to a faction card converts to influence loss (CR §408.3)", () => {
    const bolt = tactic({
      name: "FBolt",
      id: "sotde-fbolt",
      behavior: {
        abilities: [
          { id: "b", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 4 }] }
        ]
      }
    });
    const { engine, id } = buildGame({
      playerB: { influence: 20 },
      cards: [{ key: "bolt", def: bolt, owner: P1, zone: "hand" }]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bolt") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, 16, "faction lost 4 influence, no damage markers");
    assert.equal(engine.state.cards[engine.state.players[P2].factionId!].damage, 0);
  });

  test("Testudine Autoframe — voids a UNIQUE JO on ETB and returns it when it leaves play", () => {
    const jo = character({ name: "Jo", id: "test-jo", unique: "jo" });
    const testudine = character({
      name: "Testudine Autoframe",
      unique: "testudine",
      behavior: {
        abilities: [
          {
            id: "etb",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            targets: [{ id: "j", selector: { controller: "self", zone: "play", uniqueDesignation: "jo" }, count: 1, optional: true }],
            effects: [
              { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "j" } }, effects: [
                { type: "rememberTarget", key: "voidedJo", target: { type: "selected", id: "j" } },
                { type: "moveCard", target: { type: "selected", id: "j" }, to: "void" }
              ] }
            ]
          },
          {
            id: "leave",
            type: "triggered",
            event: "cardMoved",
            condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] },
            effects: [{ type: "putIntoPlay", target: { type: "remembered", key: "voidedJo" }, controller: "controller" }]
          }
        ]
      }
    });
    const killer = tactic({
      name: "Killer",
      id: "test-killer",
      behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "jo", def: jo, owner: P1 },
        { key: "tf", def: testudine, owner: P1, zone: "hand" },
        { key: "kill", def: killer, owner: P2, zone: "hand" }
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tf") });
    resolvePendingResponses(engine);
    if (engine.state.pendingChoice?.kind === "selectTargets") {
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { j: [id("jo")] } } });
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.cards[id("jo")].zone, "void", "Jo voided on ETB");

    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("tf")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("tf")].zone, "discard", "Testudine destroyed");
    assert.equal(engine.state.cards[id("jo")].zone, "play", "voided Jo returned via the leave-play trigger + departedLinks snapshot");
    assert.equal(engine.state.cards[id("jo")].controllerId, P1);
  });

  test("Stuttershy — dies -> flips face-down instead, opponent +1 influence, a Micromajig appears", () => {
    const stutter = character({
      name: "Stuttershy",
      life: 1,
      behavior: {
        abilities: [
          {
            id: "duck",
            type: "replacement",
            replaces: { event: "destroy", controlledBy: "self" },
            condition: { type: "cardNameEquals", target: { type: "selected", id: "__candidate" }, other: "source" },
            effects: [
              { type: "flipFaceDown", target: { type: "selected", id: "__candidate" } },
              { type: "modifyInfluence", player: "opponent", amount: 1 },
              { type: "createTokens", controller: "controller", count: 1, token: { name: "Micromajig", cardType: "character", subtype: ["micromajig"], strength: 0, life: 1, speed: 1 } }
            ]
          }
        ]
      }
    });
    const bolt = tactic({
      name: "SBolt",
      id: "stut-bolt",
      behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 9 }] }] }
    });
    const { engine, id } = buildGame({
      playerB: { influence: 20 },
      cards: [
        { key: "s", def: stutter, owner: P1 },
        { key: "bolt", def: bolt, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    const micromajigsBefore = Object.values(engine.state.cards).filter(c => engine.getDefinition(c.id).name === "Micromajig").length;
    engine.perform({ type: "playCard", playerId: P2, cardId: id("bolt"), selected: { t: [id("s")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("s")].faceDown, true, "ducked into a face-down resource");
    assert.equal(engine.state.cards[id("s")].zone, "play");
    assert.equal(engine.state.players[P2].influence, 21, "opponent gained 1 influence");
    const micromajigsAfter = Object.values(engine.state.cards).filter(c => engine.getDefinition(c.id).name === "Micromajig").length;
    assert.equal(micromajigsAfter, micromajigsBefore + 1, "a Micromajig token entered play");
  });
});

// ---------------------------------------------------------------------------
// SotDE — batch 4: counter trigger / restore skips / numeric cost / choose num
// ---------------------------------------------------------------------------
describe("SotDE batch-4 vocabulary", () => {
  test("counterChanged trigger — 'when there are no tokens on this card, destroy it'", () => {
    const map = item({
      name: "Runic Map",
      behavior: {
        abilities: [
          {
            id: "empty",
            type: "triggered",
            event: "counterChanged",
            condition: {
              type: "and",
              conditions: [
                { type: "sourceIsEventCard" },
                { type: "counterCompare", target: "source", counter: "token", operator: "=", value: 0 }
              ]
            },
            effects: [{ type: "destroy", target: "source" }]
          },
          {
            id: "spend",
            type: "activated",
            effects: [{ type: "removeCounter", target: "source", counter: "token", amount: 1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [{ key: "m", def: map, owner: P1, counters: { token: 2 } }]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("m"), abilityId: "spend" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("m")].zone, "play", "1 token left");
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("m"), abilityId: "spend" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("m")].zone, "discard", "destroyed on hitting 0 tokens");
  });

  test("skipRestoreRule — the player's next Restore Rule is skipped whole", () => {
    const lassitude = character({
      name: "Monstrous Lassitude",
      behavior: {
        abilities: [
          {
            id: "etb",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "skipRestoreRule", player: "controller" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "l", def: lassitude, owner: P1, zone: "hand" },
        { key: "dep", def: character({ name: "Dep", id: "ml-dep" }), owner: P1, depleted: true }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("l") });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.cards[id("dep")].depleted, true, "restore rule skipped on P1's next turn");
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.cards[id("dep")].depleted, false, "restores again the turn after");
  });

  test("skipNextRestore — a single character misses one restore then restores after", () => {
    const kid = character({
      name: "Numba 1 Stunna",
      behavior: {
        abilities: [
          {
            id: "no-restore",
            type: "triggered",
            event: "damageDealt",
            condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "cardTypeIs", target: "eventCard", cardType: "character" }] },
            effects: [{ type: "skipNextRestore", target: "eventCard" }]
          },
          {
            id: "zap",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "k", def: kid, owner: P1 },
        { key: "victim", def: character({ name: "Victim", id: "n1s-v", life: 5 }), owner: P1, depleted: true }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("k"), abilityId: "zap", selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.cards[id("victim")].depleted, true, "skipped its next restore");
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.cards[id("victim")].depleted, false, "restores normally the turn after");
  });

  test("modifyNumericCost lowers a card's deploy cost this turn", () => {
    const tinker = tactic({
      name: "Cost Tinker",
      id: "sotde-tinker",
      behavior: {
        abilities: [
          {
            id: "t",
            type: "activated",
            targets: [{ id: "ch", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [
              { type: "modifyNumericCost", target: { type: "selected", id: "ch" }, delta: -2, duration: { type: "untilEndOfTurn" } }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "tk", def: tinker, owner: P1, zone: "hand" },
        { key: "big", def: character({ name: "Big", id: "cm-big", cost: 5 }), owner: P1 }
      ]
    });
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 5);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("tk"), selected: { ch: [id("big")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.getCardPlayability(P1, id("big")).numericCost, 3, "−2 this turn");
  });

  test("chooserSelectsNumber — the opponent picks X, then loses X influence", () => {
    const appr = tactic({
      name: "Opp Picks X",
      id: "sotde-oppx",
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsNumber",
                chooser: "opponent",
                storeAs: "x",
                min: 0,
                max: 3,
                effects: [{ type: "modifyInfluence", player: "opponent", amount: { type: "multiply", values: [{ type: "variable", id: "x" }, -1] } }]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      playerB: { influence: 20 },
      cards: [{ key: "a", def: appr, owner: P1, zone: "hand" }]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("a") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooseNumber");
    assert.equal((engine.state.pendingChoice as { playerId: string }).playerId, P2);
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooseNumber", value: 9 } }),
      /\[0, 3\]/
    );
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooseNumber", value: 3 } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, 17);
  });

  test("playResource { player } + cannotBeTakenControl", () => {
    const followSuit = character({
      name: "Man Shark",
      behavior: {
        abilities: [
          {
            id: "fs",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "opponent",
                declaration: { id: "pick", selector: { controller: "opponent", zone: "hand" }, count: 1 },
                effects: [{ type: "playResource", target: { type: "selected", id: "pick" }, faceDown: true, player: "opponent" }]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "ms", def: followSuit, owner: P1 },
        { key: "handc", def: character({ name: "HandC", id: "ms-h" }), owner: P2, zone: "hand" }
      ]
    });
    const fdBefore = engine.getThresholds(P2).volition ?? 0;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ms"), abilityId: "fs" });
    resolvePendingResponses(engine);
    if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("handc")] } });
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.cards[id("handc")].zone, "play");
    assert.equal(engine.state.cards[id("handc")].faceDown, true);
    assert.equal(engine.state.cards[id("handc")].controllerId, P2, "under the opponent's control");
    assert.equal(engine.getThresholds(P2).volition ?? 0, fdBefore + 1);

    const giant = character({
      name: "Gigantitect Giant",
      behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBeTakenControl" }] }] }
    });
    const grab = tactic({
      name: "Grab",
      id: "sotde-grab",
      behavior: { abilities: [{ id: "g", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
    });
    const g3 = buildGame({
      cards: [
        { key: "giant", def: giant, owner: P1 },
        { key: "grab", def: grab, owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    g3.engine.perform({ type: "playCard", playerId: P2, cardId: g3.id("grab"), selected: { t: [g3.id("giant")] } });
    resolvePendingResponses(g3.engine);
    assert.equal(g3.engine.state.cards[g3.id("giant")].controllerId, P1, "take-control fizzled");
  });
});

// ---------------------------------------------------------------------------
// SotDE — modal tactics ("Choose one of the following as this card's text")
// ---------------------------------------------------------------------------
describe("SotDE modal tactics", () => {
  const modal = tactic({
    name: "Shriever Breeding Program",
    id: "sotde-sbp",
    behavior: {
      modes: [
        {
          label: "Deplete a character, draw a card",
          condition: { type: "isActivePlayer", player: "controller" },
          targets: [{ id: "ch", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [
            { type: "deplete", target: { type: "selected", id: "ch" } },
            { type: "draw", player: "controller", amount: 1 }
          ]
        },
        {
          label: "Choose a number X, lose X influence, draw X",
          variables: { x: { type: "number" } as never },
          costs: [{ type: "loseInfluence", amount: { type: "variable", id: "x" } }],
          effects: [{ type: "draw", player: "controller", amount: { type: "variable", id: "x" } }]
        }
      ]
    }
  });

  test("mode 0 — deplete + draw", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "m", def: modal, owner: P1, zone: "hand" },
        { key: "v", def: character({ name: "V", id: "sbp-v" }), owner: P1 },
        ...Array.from({ length: 2 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}`, id: `sbp-d${i}` }), owner: P1, zone: "deck" as const }))
      ]
    });
    const hand = engine.state.players[P1].hand.length;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("m"), mode: 0, selected: { ch: [id("v")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("v")].depleted, true);
    assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1, "played the tactic, drew 1");
  });

  test("mode 1 — X influence for X cards; mode 0's target is not required", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 20 },
      cards: [
        { key: "m", def: modal, owner: P1, zone: "hand" },
        ...Array.from({ length: 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `E${i}`, id: `sbp-e${i}` }), owner: P1, zone: "deck" as const }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("m"), mode: 1, variables: { x: 3 } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 17, "lost X=3 influence");
    assert.equal(engine.state.players[P1].hand.filter(c => engine.getDefinition(c).name.startsWith("E")).length, 3, "drew X=3");
  });
});

// ---------------------------------------------------------------------------
// SotDE — batch 5/6: ward redirect / borrowed / granted-activated / aura-hand
// / reduceThreshold / anyPlayerMayPay / noResponse / revealFromHand rider
// ---------------------------------------------------------------------------
describe("SotDE batch-5/6 vocabulary", () => {
  // 6r4wny 60dy9u4rd5 — the canonical `ContinuousAbility.redirects` card.
  test("ward redirect (6r4wny 60dy9u4rd5) — damage and destruction of the warded card hit the guard instead", () => {
    const guard = character({
      name: "Bodyguards",
      life: 6,
      behavior: {
        onPlay: {
          targets: [{ id: "ward", selector: { controller: "self", zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "rememberTarget", key: "ward", target: { type: "selected", id: "ward" } }]
        },
        abilities: [
          {
            id: "redir",
            type: "continuous",
            modifiers: [],
            redirects: [{ from: { type: "remembered", key: "ward" }, to: "source" }]
          }
        ]
      }
    });
    const bolt = tactic({
      name: "WBolt",
      id: "sotde-wbolt",
      behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "ward", def: character({ name: "Ward", id: "wr-ward", life: 2 }), owner: P1 },
        { key: "g", def: guard, owner: P1, zone: "hand" },
        { key: "bolt", def: bolt, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("g"), selected: { ward: [id("ward")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bolt"), selected: { t: [id("ward")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("ward")].damage, 0, "ward untouched");
    assert.equal(engine.state.cards[id("g")].damage, 3, "guard soaked the 3");
    assert.equal(engine.state.cards[id("ward")].zone, "play");
  });

  test("borrowed putIntoPlay — removed from the game at end of turn", () => {
    const digger = character({
      name: "Barracks Digger",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            effects: [
              { type: "putIntoPlay", target: { type: "deckPosition", player: "controller", from: "top" }, controller: "controller", borrowed: true }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "d", def: digger, owner: P1 },
        { key: "top", def: character({ name: "Borrowed", id: "brw-top" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("d"), abilityId: "go" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("top")].zone, "play");
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.cards[id("top")].zone, "removed", "borrowed card removed at end of turn");
  });

  test("granted activated ability — a character can use text granted to it", () => {
    const jo = character({
      name: "Jo",
      unique: "jo",
      behavior: {
        abilities: [
          {
            id: "grant",
            type: "continuous",
            modifiers: [],
            grantedAbilities: [
              {
                selector: { controller: "self", zone: "play", type: "character" },
                abilities: [
                  { id: "research", type: "activated", costs: [{ type: "deplete", target: "source" }], effects: [{ type: "draw", player: "controller", amount: 1 }] }
                ]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "jo", def: jo, owner: P1 },
        { key: "grunt", def: character({ name: "Grunt", id: "ga-grunt" }), owner: P1 },
        ...Array.from({ length: 2 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}`, id: `ga-d${i}` }), owner: P1, zone: "deck" as const }))
      ]
    });
    const before = engine.state.players[P1].hand.length;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("grunt"), abilityId: "research" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("grunt")].depleted, true);
    assert.equal(engine.state.players[P1].hand.length, before + 1, "the granted RESEARCH drew a card");
  });

  test("aura over hand zone + dynamic TACTICAL honored at deploy timing", () => {
    const bridge = location({
      name: "Gloamspike Bridge",
      behavior: {
        abilities: [
          {
            id: "hand-tactical",
            type: "continuous",
            activeZone: "play",
            modifiers: [],
            keywords: [{ selector: { controller: "self", zone: "hand", type: "character" }, keyword: "tactical" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "bridge", def: bridge, owner: P1 },
        { key: "atk", def: character({ name: "Atk", id: "gl-atk", strength: 2 }), owner: P2 },
        { key: "guy", def: character({ name: "Guy", id: "gl-guy" }), owner: P1, zone: "hand" }
      ],
      activePlayerId: P2
    });
    assert.equal(engine.hasKeyword(id("guy"), "tactical"), true, "P1's hand character has aura TACTICAL");
    // The deploy-timing check consults hasKeyword (dynamic grants), so a
    // response-window deploy of this by-aura-TACTICAL character is legal
    // once P1 has priority.
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
    engine.perform({ type: "passPriority", playerId: P2 });
    assert.doesNotThrow(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("guy") }),
      "deploy-timing check honours the dynamically-granted TACTICAL"
    );
    // it's on the response stack now (a TACTICAL character deployed as a response)
    assert.ok(
      engine.state.cards[id("guy")].zone === "deploying" ||
        engine.state.cards[id("guy")].zone === "play", "engine.state.cards[id(\"guy\")].zone === \"deploying\" || engine.state.cards[id(\"guy\")].zone === \"play\""
    );
  });

  test("reduceThreshold — the next deploy needs one fewer of the named icon", () => {
    const dock = location({
      name: "Skydocks",
      behavior: {
        abilities: [
          {
            id: "bday",
            type: "activated",
            effects: [
              { type: "nameValue", chooser: "controller", valueKind: "resourceIcon", storeAs: "ic" },
              { type: "reduceThreshold", player: "controller", icon: { fromNamed: "ic" }, amount: 2 }
            ]
          }
        ]
      }
    });
    const rr = (i: number): CardDefinition =>
      resourceCard({ name: "Rage", id: `sd-r-${i}`, trade: "warlord", resource: { provides: ["rage"], staple: true } });
    const { engine, id } = buildGame({
      cards: [
        { key: "dock", def: dock, owner: P1 },
        { key: "big", def: character({ name: "BigThreshold", id: "sd-big", threshold: "rrr" }), owner: P1, zone: "hand" },
        { key: "r1", def: rr(1), owner: P1 }
      ]
    });
    assert.equal(engine.getCardPlayability(P1, id("big")).thresholdMet, false, "rrr not met with 1 rage");
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("dock"), abilityId: "bday" });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: "rage" } });
    resolvePendingResponses(engine);
    assert.equal(engine.getCardPlayability(P1, id("big")).thresholdMet, true, "rrr − 2 = r, met");
  });

  test("noResponse tactic resolves with no opponent window", () => {
    const swindle = tactic({
      name: "Swindle",
      id: "sotde-swindle",
      behavior: {
        noResponse: true,
        abilities: [{ id: "s", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "sw", def: swindle, owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D", id: "sw-d" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("sw") });
    assert.equal(engine.state.responseWindow, undefined, "no response window opened");
    assert.equal(engine.state.players[P1].hand.includes(id("d1")), true, "resolved immediately");
  });

  test("alternatingPayLoop (Negotiation Ceremonies) — tallies each player's payments", () => {
    const neg = tactic({
      name: "Negotiation Ceremonies",
      id: "sotde-neg",
      behavior: {
        abilities: [
          {
            id: "n",
            type: "activated",
            effects: [
              {
                type: "alternatingPayLoop",
                first: "controller",
                opponent: "opponent",
                cost: [{ type: "payResources", amount: 1 }],
                onEnd: [
                  { type: "draw", player: "controller", amount: { type: "variable", id: "__paidByFirst" } },
                  { type: "draw", player: "opponent", amount: { type: "variable", id: "__paidByOpponent" } }
                ]
              }
            ]
          }
        ]
      }
    });
    const staple = (owner: string, i: number) =>
      ({ key: `${owner}r${i}`, def: resourceCard({ name: "Greed", id: `neg-${owner}-${i}`, trade: "banker", resource: { provides: ["greed"], staple: true } }), owner });
    const deckCard = (owner: string, i: number) =>
      ({ key: `${owner}d${i}`, def: character({ name: `${owner}D${i}`, id: `neg-dc-${owner}-${i}` }), owner, zone: "deck" as const });
    const { engine, id } = buildGame({
      cards: [
        { key: "neg", def: neg, owner: P1, zone: "hand" },
        staple(P1, 0), staple(P1, 1), staple(P1, 2),
        staple(P2, 0), staple(P2, 1),
        ...Array.from({ length: 4 }, (_, i) => deckCard(P1, i)),
        ...Array.from({ length: 4 }, (_, i) => deckCard(P2, i))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("neg") });
    resolvePendingResponses(engine);
    // P1 pays, P2 pays, P1 pays, P2 declines -> P1 paid 2, P2 paid 1
    assert.equal(engine.state.pendingChoice?.kind, "alternatingPay");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "alternatingPay", pay: true } });
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "alternatingPay", pay: true } });
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "alternatingPay", pay: true } });
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "alternatingPay", pay: false } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.filter(c => engine.getDefinition(c).name.startsWith(`${P1}D`)).length, 2, "P1 drew 2 (paid twice)");
    assert.equal(engine.state.players[P2].hand.filter(c => engine.getDefinition(c).name.startsWith(`${P2}D`)).length, 1, "P2 drew 1 (paid once)");
  });
});

// ---------------------------------------------------------------------------
// Parity-gap resolutions (see COVERAGE.md -> "Parity gaps"): five printed
// clauses that previously had no engine model — Study Disturbance / Tedious
// TriAdic Truculence (opponent-may-pay-to-counter), Arcane Escrow
// (develop-draw-replacement), Golden Charm (deck-search-trigger), Parkour
// Hoodlum (card-ignores-source-class), The Knitting Coalition
// (cross-faction-rule-override), The Society of Magical Propriety / The
// Union of Unextraordinary Miners (mixed-starting-resources).
// ---------------------------------------------------------------------------
describe("parity: opponent-may-pay-to-counter (Study Disturbance / Tedious TriAdic Truculence)", () => {
  const greed = (owner: string, i: number) => ({
    key: `${owner}g${i}`,
    def: resourceCard({ name: "Greed", id: `ompc-${owner}-${i}`, resource: { provides: ["greed"], staple: true } }),
    owner
  });

  // "EXTRA COST: Pick a player. That player may pay 2 ... then terminate this
  // card. -- The picked player cannot play characters this turn. Draw a card."
  const disturb = tactic({
    name: "Study Disturbance PG",
    behavior: {
      abilities: [
        {
          id: "sd",
          type: "activated",
          targets: [{ id: "p", selector: { zone: "play", type: "faction" }, count: 1 }],
          effects: [
            {
              type: "mayPay",
              player: { type: "controllerOf", target: { type: "selected", id: "p" } },
              costs: [{ type: "payResources", amount: 2 }],
              effects: [],
              elseEffects: [
                {
                  type: "restrictPlay",
                  player: { type: "controllerOf", target: { type: "selected", id: "p" } },
                  kind: "cardType",
                  cardType: "character",
                  duration: { type: "untilEndOfTurn" }
                },
                { type: "draw", player: "controller", amount: 1 }
              ]
            }
          ]
        }
      ]
    }
  });

  test("the picked player pays from THEIR resources, and the tactic body is skipped ('terminate this card')", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sd", def: disturb, owner: P1, zone: "hand" },
        greed(P2, 0),
        greed(P2, 1),
        { key: "p1draw", def: character({ name: "P1 Draw", id: "ompc-d1" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("sd"),
      selected: { p: [engine.state.players[P2].factionId!] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "mayPay");
    assert.equal(engine.state.pendingChoice?.playerId, P2, "the picked player decides");

    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "mayPay", pay: true } });
    resolvePendingResponses(engine);

    assert.equal(engine.getAvailableResourceCount(P2), 0, "P2 paid 2 from its own resources");
    assert.equal(engine.state.cards[id("p1draw")].zone, "deck", "the tactic fizzled — no draw, no restriction");
    assert.equal(engine.state.players[P1].hand.filter(c => engine.getDefinition(c).name === "P1 Draw").length, 0);
  });

  test("declining the buyout runs the real tactic body", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sd", def: disturb, owner: P1, zone: "hand" },
        greed(P2, 0),
        greed(P2, 1),
        { key: "p1draw", def: character({ name: "P1 Draw", id: "ompc-d2" }), owner: P1, zone: "deck" },
        { key: "p1char", def: character({ name: "P1 Char", id: "ompc-c2" }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("sd"),
      selected: { p: [engine.state.players[P2].factionId!] }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "mayPay", pay: false } });
    resolvePendingResponses(engine);

    assert.equal(engine.getAvailableResourceCount(P2), 2, "P2 kept its resources");
    assert.equal(engine.state.cards[id("p1draw")].zone, "hand", "the tactic resolved — P1 drew");
    assert.throws(
      () => engine.perform({ type: "playCard", playerId: P2, cardId: id("p1char") }),
      /character/i,
      "P2 (the picked player) cannot play characters this turn"
    );
  });

  test("lookAndReorder chooser — 'any opponent looks at the top 3 cards of YOUR deck and puts them back'", () => {
    const ttt = tactic({
      name: "Tedious TriAdic Truculence PG",
      behavior: {
        abilities: [
          {
            id: "ttt",
            type: "activated",
            effects: [
              {
                type: "mayPay",
                player: "opponent",
                costs: [{ type: "payResources", amount: 1 }],
                effects: [
                  { type: "lookAndReorder", player: "controller", chooser: "opponent", count: 3 }
                ],
                elseEffects: [{ type: "draw", player: "controller", amount: 1 }]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "ttt", def: ttt, owner: P1, zone: "hand" },
        greed(P2, 0),
        { key: "a", def: character({ name: "A", id: "ttt-a" }), owner: P1, zone: "deck" },
        { key: "b", def: character({ name: "B", id: "ttt-b" }), owner: P1, zone: "deck" },
        { key: "c", def: character({ name: "C", id: "ttt-c" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("ttt") });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "mayPay", pay: true } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "reorderDeck");
    assert.equal(engine.state.pendingChoice?.playerId, P2, "the paying opponent reorders");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "reorderDeck", order: [id("c"), id("b"), id("a")] }
    });
    resolvePendingResponses(engine);

    assert.deepEqual(
      engine.state.players[P1].deck.slice(0, 3),
      [id("c"), id("b"), id("a")],
      "P1's deck top was reordered by P2"
    );
  });
});

describe("parity: card-ignores-source-class (ContinuousAbility.ignoresRulesTextFrom — Parkour Hoodlum)", () => {
  const hoodlum = (over: Partial<CardDefinition> = {}) =>
    character({
      name: "Parkour Hoodlum PG",
      strength: 2,
      life: 6,
      behavior: {
        abilities: [
          { id: "ig", type: "continuous", modifiers: [], ignoresRulesTextFrom: "location" }
        ]
      },
      ...over
    });

  const zapLocation = location({
    name: "Zap Tower",
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]
        }
      ]
    }
  });

  test("a location cannot pick it as a target, but can pick other characters", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "ph", def: hoodlum(), owner: P1 },
        { key: "og", def: character({ name: "Other Guy", id: "cisc-og", life: 6 }), owner: P1 },
        { key: "loc", def: zapLocation, owner: P2 }
      ]
    });

    assert.throws(
      () =>
        engine.perform({
          type: "activateAbility",
          playerId: P2,
          cardId: id("loc"),
          abilityId: "zap",
          selected: { t: [id("ph")] }
        }),
      /Illegal target/
    );

    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("loc"),
      abilityId: "zap",
      selected: { t: [id("og")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("og")].damage, 3);
  });

  test("a location effect that reaches it without picking (via 'eventCard') is a no-op", () => {
    const trapLocation = location({
      name: "Spike Pit",
      behavior: {
        abilities: [
          {
            id: "onenter",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "cardTypeIs", target: "eventCard", cardType: "character" },
            effects: [{ type: "dealDamage", target: "eventCard", amount: 2 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "trap", def: trapLocation, owner: P2 },
        { key: "ph", def: hoodlum(), owner: P1, zone: "hand" },
        { key: "og", def: character({ name: "Other Guy 2", id: "cisc-og2", life: 6 }), owner: P1, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("og") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("og")].damage, 2, "an ordinary character takes the location's damage");

    engine.perform({ type: "playCard", playerId: P1, cardId: id("ph") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("ph")].damage, 0, "Parkour Hoodlum ignores the location's effect");
  });

  test("a non-location source is unaffected by the immunity", () => {
    const zapGuy = character({
      name: "Zap Guy",
      behavior: {
        abilities: [
          {
            id: "z",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "ph", def: hoodlum(), owner: P1 },
        { key: "zg", def: zapGuy, owner: P2 }
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P2,
      cardId: id("zg"),
      abilityId: "z",
      selected: { t: [id("ph")] }
    });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("ph")].damage, 3, "a character's effect still hits it");
  });

  test("a location aura does not modify it", () => {
    const weakenLocation = location({
      name: "Weakening Field",
      behavior: {
        abilities: [
          {
            id: "aura",
            type: "continuous",
            modifiers: [
              {
                selector: { zone: "play", type: "character" },
                stat: "strength",
                operation: "add",
                value: -1
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "ph", def: hoodlum(), owner: P1 },
        { key: "og", def: character({ name: "Other Guy 3", id: "cisc-og3", strength: 4 }), owner: P1 },
        { key: "field", def: weakenLocation, owner: P2 }
      ]
    });
    assert.equal(engine.getStat(id("og"), "strength"), 3, "an ordinary character loses 1 strength to the aura");
    assert.equal(engine.getStat(id("ph"), "strength"), 2, "Parkour Hoodlum's strength is untouched");
  });
});

describe("parity: cross-faction-rule-override (The Knitting Coalition)", () => {
  test("PULLING STRINGS: an opposing faction's suppressDevelop removes this player's Develop Rule", () => {
    const knitting = factionCard({
      name: "Knitting Coalition PG",
      faction: defaultFactionDefinition({ overridesOpponent: { suppressDevelop: true } })
    });
    const { engine } = buildGame({ playerB: { faction: knitting } });

    assert.deepEqual(engine.getDevelopChoices(P1), [], "P1's Develop Rule is suppressed by P2's Knitting Coalition");
    assert.ok(engine.getDevelopChoices(P2).length > 0, "P2 keeps its own Develop Rule");
    openDevelop(engine, P1);
    assert.equal(engine.state.pendingChoice, undefined, "no Develop Rule options are offered to P1");
  });

  test("HIDDEN INFLUENCE: the opponent's opening hand uses the overriding faction's sizes", () => {
    const filler = (i: number) => character({ name: `KC F${i}`, id: `kc-f-${i}` });
    const fillerIds = Array.from({ length: 20 }, (_, i) => `kc-f-${i}`);
    const knitting = factionCard({
      name: "Knitting Coalition PG2",
      id: "kc-fac",
      faction: defaultFactionDefinition({
        overridesOpponent: { startingDraw: true },
        setup: {
          startingResources: { count: 0 },
          openingHand: { goingFirst: 2, goingSecond: 3 }
        }
      })
    });
    const normal = factionCard({
      name: "Normal Faction PG",
      id: "nf-fac",
      faction: defaultFactionDefinition({
        setup: {
          startingResources: { count: 0 },
          openingHand: { goingFirst: 7, goingSecond: 8 }
        }
      })
    });
    const defs: CardDefinition[] = [
      knitting,
      normal,
      ...Array.from({ length: 20 }, (_, i) => filler(i))
    ];

    const engine = createTwoPlayerFactionGame(
      defs,
      { id: P1, name: "P1", deckDefinitionIds: ["kc-fac", ...fillerIds] },
      { id: P2, name: "P2", deckDefinitionIds: ["nf-fac", ...fillerIds] },
      { firstPlayerId: P1, seed: 1 }
    );

    assert.equal(engine.state.setup.phase, "complete");
    assert.equal(engine.state.players[P1].hand.length, 2, "P1 (Knitting) uses its own goingFirst");
    assert.equal(
      engine.state.players[P2].hand.length,
      3,
      "P2 (Knitting's opponent) uses Knitting's goingSecond, not its own 8"
    );
  });
});

describe("parity: mixed-starting-resources (The Society of Magical Propriety / The Union of Unextraordinary Miners)", () => {
  const inPlayResourceCount = (engine: ReturnType<typeof createTwoPlayerFactionGame>, pid: string) =>
    engine.state.players[pid].play.filter(cid => engine.isResource(cid)).length;

  test("slots: a specific-resource slot plus an any-card slot (face-down when not a resource)", () => {
    const society = factionCard({
      name: "Society PG",
      id: "soc-fac",
      faction: defaultFactionDefinition({
        setup: {
          startingResources: { count: 2, slots: [{ kind: "resource" }, { kind: "anyCard" }] },
          openingHand: { goingFirst: 1, goingSecond: 1 }
        }
      })
    });
    const normal = factionCard({
      name: "Society Opp PG",
      id: "soc-opp-fac",
      faction: defaultFactionDefinition({
        setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 1, goingSecond: 1 } }
      })
    });
    const socRes = resourceCard({ name: "Greed", id: "soc-res", resource: { provides: ["greed"], staple: true } });
    const socChar = character({ name: "Society Any Card", id: "soc-char" });
    const filler = (i: number) => character({ name: `Soc F${i}`, id: `soc-f-${i}` });
    const fillerIds = Array.from({ length: 12 }, (_, i) => `soc-f-${i}`);
    const defs: CardDefinition[] = [
      society,
      normal,
      socRes,
      socChar,
      ...Array.from({ length: 12 }, (_, i) => filler(i))
    ];

    const engine = createTwoPlayerFactionGame(
      defs,
      { id: P1, name: "P1", deckDefinitionIds: ["soc-fac", "soc-res", "soc-char", ...fillerIds] },
      { id: P2, name: "P2", deckDefinitionIds: ["soc-opp-fac", ...fillerIds] },
      { firstPlayerId: P1, seed: 1 }
    );

    const play = engine.state.players[P1].play.map(cid => ({
      cid,
      name: engine.getDefinition(cid).name,
      faceDown: engine.state.cards[cid].faceDown
    }));
    const res = play.find(c => c.name === "Greed");
    const anyCard = play.find(c => c.name === "Society Any Card");

    assert.ok(res && !res.faceDown, "the resource slot placed a face-up resource");
    assert.ok(anyCard && anyCard.faceDown, "the any-card slot placed the non-resource card face-down");
    assert.equal((engine.getThresholds(P1).volition ?? 0), 1, "the face-down any-card provides Volition");
  });

  test("chosenStaples + matchOpponentCount: X staples + fixed extra, opponent topped up to match", () => {
    const staple = (i: number) =>
      resourceCard({ name: "Greed", id: `uni-g-${i}`, resource: { provides: ["greed"], staple: true } });
    const decep = resourceCard({ name: "Deception", id: "uni-decep", resource: { provides: ["deception"], staple: true } });
    const oppStaple = (i: number) =>
      resourceCard({ name: "Greed", id: `uni-o-${i}`, resource: { provides: ["greed"], staple: true } });
    const filler = (i: number) => character({ name: `Uni F${i}`, id: `uni-f-${i}` });
    const fillerIds = Array.from({ length: 12 }, (_, i) => `uni-f-${i}`);

    const union = factionCard({
      name: "Union PG",
      id: "uni-fac",
      faction: defaultFactionDefinition({
        setup: {
          startingResources: {
            count: 2,
            chosenStaples: { min: 1, max: 5, plus: ["Deception"] },
            matchOpponentCount: true
          },
          openingHand: { goingFirst: 1, goingSecond: 1 }
        }
      })
    });
    const normal = factionCard({
      name: "Union Opp PG",
      id: "uni-opp-fac",
      faction: defaultFactionDefinition({
        setup: { startingResources: { count: 2, stapleOnly: true }, openingHand: { goingFirst: 1, goingSecond: 1 } }
      })
    });

    const defs: CardDefinition[] = [
      union,
      normal,
      ...Array.from({ length: 4 }, (_, i) => staple(i)),
      decep,
      ...Array.from({ length: 6 }, (_, i) => oppStaple(i)),
      ...Array.from({ length: 12 }, (_, i) => filler(i))
    ];

    const engine = createTwoPlayerFactionGame(
      defs,
      {
        id: P1,
        name: "P1",
        deckDefinitionIds: [
          "uni-fac",
          "uni-g-0",
          "uni-g-1",
          "uni-g-2",
          "uni-g-3",
          "uni-decep",
          ...fillerIds
        ]
      },
      {
        id: P2,
        name: "P2",
        deckDefinitionIds: [
          "uni-opp-fac",
          "uni-o-0",
          "uni-o-1",
          "uni-o-2",
          "uni-o-3",
          "uni-o-4",
          "uni-o-5",
          ...fillerIds
        ]
      },
      { firstPlayerId: P1, seed: 1, startingResourceX: { [P1]: 3 } }
    );

    assert.equal(inPlayResourceCount(engine, P1), 4, "Union: 3 chosen staples + 1 Deception");
    assert.equal(inPlayResourceCount(engine, P2), 4, "the opponent is topped up from 2 to 4");
  });

  test("chosenStaples defaults X to its minimum when no choice is supplied", () => {
    const staple = (i: number) =>
      resourceCard({ name: "Greed", id: `unid-g-${i}`, resource: { provides: ["greed"], staple: true } });
    const decep = resourceCard({ name: "Deception", id: "unid-decep", resource: { provides: ["deception"], staple: true } });
    const filler = (i: number) => character({ name: `UniD F${i}`, id: `unid-f-${i}` });
    const fillerIds = Array.from({ length: 12 }, (_, i) => `unid-f-${i}`);
    const union = factionCard({
      name: "Union Default PG",
      id: "unid-fac",
      faction: defaultFactionDefinition({
        setup: {
          startingResources: {
            count: 2,
            chosenStaples: { min: 1, max: 5, plus: ["Deception"] },
            matchOpponentCount: true
          },
          openingHand: { goingFirst: 1, goingSecond: 1 }
        }
      })
    });
    const normal = factionCard({
      name: "Union Default Opp PG",
      id: "unid-opp-fac",
      faction: defaultFactionDefinition({
        setup: { startingResources: { count: 2, stapleOnly: true }, openingHand: { goingFirst: 1, goingSecond: 1 } }
      })
    });
    const defs: CardDefinition[] = [
      union,
      normal,
      staple(0),
      staple(1),
      decep,
      resourceCard({ name: "Greed", id: "unid-o-0", resource: { provides: ["greed"], staple: true } }),
      resourceCard({ name: "Greed", id: "unid-o-1", resource: { provides: ["greed"], staple: true } }),
      ...Array.from({ length: 12 }, (_, i) => filler(i))
    ];
    const engine = createTwoPlayerFactionGame(
      defs,
      { id: P1, name: "P1", deckDefinitionIds: ["unid-fac", "unid-g-0", "unid-g-1", "unid-decep", ...fillerIds] },
      { id: P2, name: "P2", deckDefinitionIds: ["unid-opp-fac", "unid-o-0", "unid-o-1", ...fillerIds] },
      { firstPlayerId: P1, seed: 1 }
    );
    assert.equal(inPlayResourceCount(engine, P1), 2, "X defaults to min (1) -> 1 staple + 1 Deception");
    assert.equal(inPlayResourceCount(engine, P2), 2, "both already equal — no top-up");
  });
});

describe("parity: develop-draw-replacement (Arcane Escrow)", () => {
  const escrow = item({
    name: "Arcane Escrow PG",
    behavior: {
      developDrawReplacement: {
        effects: [
          {
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: { id: "v", selector: { owner: "self", zone: "void" }, count: 1, optional: true },
            effects: [
              {
                type: "if",
                condition: { type: "targetExists", target: { type: "selected", id: "v" } },
                effects: [{ type: "moveCard", target: { type: "selected", id: "v" }, to: "hand" }]
              }
            ]
          }
        ]
      }
    }
  });

  test("choosing the draw develop option offers pulling a card from the void instead", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "esc", def: escrow, owner: P1 },
        { key: "voided", def: character({ name: "Voided One", id: "addr-ae-v" }), owner: P1, zone: "void" },
        { key: "top", def: character({ name: "Top Card", id: "addr-ae-t" }), owner: P1, zone: "deck" }
      ]
    });

    developDraw(engine, P1);
    assert.equal(engine.state.pendingChoice?.kind, "mayPay");

    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } });
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("voided")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("voided")].zone, "hand", "pulled from the void");
    assert.equal(engine.state.cards[id("top")].zone, "deck", "did not draw");
  });

  test("declining the substitution draws as normal", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "esc", def: escrow, owner: P1 },
        { key: "voided", def: character({ name: "Voided Two", id: "addr-ae-v2" }), owner: P1, zone: "void" },
        { key: "top", def: character({ name: "Top Card 2", id: "addr-ae-t2" }), owner: P1, zone: "deck" }
      ]
    });
    developDraw(engine, P1);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: false } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("top")].zone, "hand", "drew the top card");
    assert.equal(engine.state.cards[id("voided")].zone, "void", "the voided card stayed put");
  });
});

describe("parity: deck-search-trigger (Golden Charm)", () => {
  test("a deck search fires 'deckSearched'; the interceptor may pay to draw, and the search still happens", () => {
    const charm = item({
      name: "Golden Charm PG",
      behavior: {
        abilities: [
          {
            id: "tax",
            name: "Search Tax",
            type: "triggered",
            event: "deckSearched",
            effects: [
              {
                type: "mayPay",
                player: "controller",
                costs: [{ type: "payResources", amount: 1 }],
                effects: [{ type: "draw", player: "controller", amount: 1 }],
                elseEffects: []
              }
            ]
          }
        ]
      }
    });
    const digger = character({
      name: "Digger",
      behavior: {
        abilities: [
          {
            id: "dig",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: {
                  id: "f",
                  selector: { controller: "self", zone: "deck", type: "character" },
                  count: 1,
                  optional: true
                },
                effects: [{ type: "moveCard", target: { type: "selected", id: "f" }, to: "hand" }]
              }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "charm", def: charm, owner: P1 },
        { key: "g", def: resourceCard({ name: "Greed", id: "dst-g", resource: { provides: ["greed"], staple: true } }), owner: P1 },
        { key: "digger", def: digger, owner: P2 },
        { key: "found", def: character({ name: "Found", id: "dst-found" }), owner: P2, zone: "deck" },
        { key: "p1draw", def: character({ name: "P1 Draw DST", id: "dst-p1d" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({ type: "activateAbility", playerId: P2, cardId: id("digger"), abilityId: "dig" });
    resolvePendingResponses(engine);

    // E10e: "If a player would search their deck you may pay 1 instead. If you
    // do, draw a card and then that player searches" - the Charm is asked
    // BEFORE the search pick is offered.
    const gcChoice = engine.state.pendingChoice;
    assert.equal(gcChoice?.kind, "mayPay", "the deckSearched trigger fires before the search");
    assert.equal(gcChoice?.playerId, P1, "Golden Charm's controller decides");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "then the searcher picks");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "chooserSelectsTarget", selected: [id("found")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("found")].zone, "hand", "the search still happened");
    assert.equal(engine.state.cards[id("p1draw")].zone, "hand", "Golden Charm's controller drew for 1");
    assert.equal(engine.getAvailableResourceCount(P1), 0, "P1 paid 1");
  });
});

// "EXTRA COST: Pick an opponent. -- Search your deck for 5 cards with
// different names ... That player separates those cards into two piles.
// Put one pile into your hand and shuffle the other into your deck."
// (Profane Proposal) — distinctNames search + the separateIntoPiles choice.
describe("card behavior: Profane Proposal (distinctNames + separateIntoPiles)", () => {
  test("the opponent splits the found cards; pile 1 → hand, pile 2 → deck", () => {
    const proposal = tactic({
      name: "Profane Proposal",
      behavior: {
        abilities: [
          {
            id: "profane-proposal",
            type: "activated",
            targets: [
              { id: "found", selector: { controller: "self", zone: "deck" }, count: 3, distinctNames: true }
            ],
            effects: [
              {
                type: "separateIntoPiles",
                splitter: "opponent",
                selected: "found",
                pile1: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }],
                pile2: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "deck", position: "bottom" }]
              },
              { type: "shuffleDeck", player: "controller" }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "pp", def: proposal, owner: P1, zone: "hand" },
        { key: "a", def: character({ id: "pp-a", name: "Pp Ay" }), owner: P1, zone: "deck" },
        { key: "b", def: character({ id: "pp-b", name: "Pp Bee" }), owner: P1, zone: "deck" },
        { key: "c", def: character({ id: "pp-c", name: "Pp Cee" }), owner: P1, zone: "deck" }
      ]
    });

    engine.perform({
      type: "playCard",
      playerId: P1,
      cardId: id("pp"),
      selected: { found: [id("a"), id("b"), id("c")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.pendingChoice?.kind, "pileAssignment");
    assert.equal(engine.state.pendingChoice?.playerId, P2);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "pileAssignment", pile1: [id("a")], pile2: [id("b"), id("c")] }
    });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("a")].zone, "hand");
    assert.equal(engine.state.cards[id("b")].zone, "deck");
    assert.equal(engine.state.cards[id("c")].zone, "deck");
  });

  test("rejects a search selection with a duplicate name", () => {
    const proposal = tactic({
      name: "Profane Proposal Dup",
      behavior: {
        abilities: [
          {
            id: "pp2",
            type: "activated",
            targets: [{ id: "found", selector: { controller: "self", zone: "deck" }, count: 2, distinctNames: true }],
            effects: [{ type: "forEach", selected: "found", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }] }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "pp", def: proposal, owner: P1, zone: "hand" },
        { key: "d1", def: character({ id: "pp-dup", name: "Pp Twin" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ id: "pp-dup", name: "Pp Twin" }), owner: P1, zone: "deck" }
      ]
    });
    assert.throws(() =>
      engine.perform({ type: "playCard", playerId: P1, cardId: id("pp"), selected: { found: [id("d1"), id("d2")] } })
    );
  });
});

// "You may play this card whenever you could play a tactic. While this card is
// in play, both players switch seats. Both players are in control of their
// opponent's side. ... At the start of your turn, you must put a token on this
// card. At the end of your turn, if there are at least 2 tokens on this card,
// destroy it." (Open Beta / 1st Edition) — the seat swap is
// `ContinuousAbility.swapsSides`; the token clock is the usual upkeep/expire
// pair. Engine rules for the swap itself are in seat-swap.test.ts.
function emergencyObfuscation(): CardDefinition {
  return item({
    name: "Emergency Obfuscation",
    cost: 0,
    behavior: {
      keywords: ["tactical"],
      abilities: [
        { id: "swap", type: "continuous", modifiers: [], swapsSides: true },
        {
          id: "upkeep",
          type: "triggered",
          event: "turnStarted",
          condition: { type: "eventPlayerIs", player: "controller" },
          effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]
        },
        {
          id: "expire",
          type: "triggered",
          event: "turnEnding",
          condition: {
            type: "and",
            conditions: [
              { type: "eventPlayerIs", player: "controller" },
              { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 2 }
            ]
          },
          effects: [{ type: "destroy", target: "source" }]
        }
      ]
    }
  });
}

describe("card behavior: Emergency Obfuscation (seat swap with a two-token clock)", () => {
  test("the sides swap on entering play and swap back when the clock destroys it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "eo", def: emergencyObfuscation(), owner: P1, zone: "hand" },
        { key: "hero", def: character({ name: "Hero" }), owner: P1 },
        { key: "guard", def: character({ name: "Guard" }), owner: P2 }
      ]
    });
    const endTurn = (who: string): void => {
      engine.perform({ type: "endTurn", playerId: who });
      resolvePendingResponses(engine);
      settleTurnStart(engine);
    };
    engine.perform({ type: "playCard", playerId: P1, cardId: id("eo") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("hero")].controllerId, P2);
    assert.equal(engine.state.cards[id("guard")].controllerId, P1);
    // It is part of the side it was played to, so the opposing player now owns the clock.
    assert.equal(engine.state.cards[id("eo")].controllerId, P2);

    endTurn(P1);
    assert.equal(engine.state.cards[id("eo")].counters.token, 1);
    endTurn(P2);
    assert.equal(engine.state.cards[id("eo")].zone, "play");
    endTurn(P1);
    assert.equal(engine.state.cards[id("eo")].counters.token, 2);
    endTurn(P2);

    assert.equal(engine.state.cards[id("eo")].zone, "discard");
    assert.equal(engine.state.seatSwap, undefined);
    assert.equal(engine.state.cards[id("hero")].controllerId, P1);
    assert.equal(engine.state.cards[id("guard")].controllerId, P2);
  });
});

// "EXTRA COST: Play only on your turn, after you have declared the end of your
// turn. -- Terminate your end of turn declaration." (Lost on Floor 3)
function lostOnFloor3(): CardDefinition {
  return tactic({
    name: "Lost on Floor 3",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "body",
          type: "activated",
          condition: { type: "endOfTurnDeclared", player: "controller" },
          effects: [{ type: "terminateEndOfTurn" }]
        }
      ]
    }
  });
}

/** A free tactic with no effect, to answer an end-of-turn announcement with. */
const pingTactic = (): CardDefinition =>
  tactic({ name: "Ping", cost: 0, behavior: { abilities: [{ id: "p", type: "activated", effects: [] }] } });

describe("card behavior: Lost on Floor 3 (endOfTurnDeclared + terminateEndOfTurn)", () => {
  const ctx = (sourceId: string, controllerId: string) => ({ sourceId, controllerId, selected: {} });

  test("endOfTurnDeclared holds only while the player's end-of-turn announcement is pending", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "a", def: character({ name: "A" }), owner: P1 }],
      activePlayerId: P1
    });
    const mine = ctx(id("a"), P1);
    assert.equal(engine.evaluateCondition({ type: "endOfTurnDeclared" }, mine as never), false);
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.evaluateCondition({ type: "endOfTurnDeclared" }, mine as never), true);
    assert.equal(
      engine.evaluateCondition({ type: "endOfTurnDeclared", player: "opponent" }, mine as never),
      false
    );
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2);
    assert.equal(engine.evaluateCondition({ type: "endOfTurnDeclared" }, mine as never), false);
  });

  test("terminating the announcement turns the window back into normal play: the turn goes on", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "lof", def: lostOnFloor3(), owner: P1, zone: "hand" },
        { key: "ping", def: pingTactic(), owner: P2, zone: "hand" }
      ],
      activePlayerId: P1
    });
    const turn = engine.state.turn;
    engine.perform({ type: "endTurn", playerId: P1 });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("ping") });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("lof") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.responseWindow, undefined);
    assert.equal(engine.state.turn, turn);
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(engine.state.priorityPlayerId, P1);
    assert.equal(engine.state.cards[id("ping")].zone, "discard", "the opponent's response still resolved");
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    assert.equal(engine.state.activePlayerId, P2, "announcing again ends the turn");
  });

  test("a battle started inside the announcement no longer resumes it once terminated", () => {
    const counter = tactic({
      name: "Counter Attack",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "ca",
            type: "activated",
            targets: [{ id: "atk", selector: { controller: "self", type: "character" }, count: 9, optional: true }],
            effects: [{ type: "initiateAttack", attackerSelection: "atk", target: "opponent" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "lof", def: lostOnFloor3(), owner: P1, zone: "hand" },
        { key: "counter", def: counter, owner: P2, zone: "hand" },
        { key: "striker", def: character({ name: "Striker", strength: 1 }), owner: P2 }
      ],
      activePlayerId: P1
    });
    const turn = engine.state.turn;
    engine.perform({ type: "endTurn", playerId: P1 });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("counter"), selected: { atk: [id("striker")] } });
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(engine.state.battle?.resumeEndTurn?.playerId, P1, "the battle carries the pending end of turn");
    // The battle's attacker passes first (CR 608.1c); then P1, the defender, plays it.
    engine.perform({ type: "passPriority", playerId: P2 });
    assert.equal(engine.state.priorityPlayerId, P1);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("lof") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.battle?.resumeEndTurn, undefined);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.responseWindow, undefined, "the end-of-turn window does not re-open");
    assert.equal(engine.state.turn, turn);
    assert.equal(engine.state.activePlayerId, P1);
  });
});

// "If you would inflict damage to an opponent's faction, for each damage you
// would inflict, you may put up to that many cards from the top of its
// owner's deck into their discard pile instead. -- When a player has no cards
// in their deck, they lose the game." (Trickster's Globe)
function tricksterGlobe(): CardDefinition {
  return item({
    name: "Trickster's Globe",
    behavior: {
      abilities: [
        { id: "mill-instead", type: "continuous", modifiers: [], millInsteadOfFactionDamage: true },
        { id: "empty-deck-loses", type: "continuous", modifiers: [], emptyDeckLoses: true }
      ]
    }
  });
}

describe("card behavior: Trickster's Globe (millInsteadOfFactionDamage + emptyDeckLoses)", () => {
  const deck = (owner: string, n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}` }), owner, zone: "deck" as const }));

  test("two attackers' damage to the faction is one amount, offered once; the answer splits it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "globe", def: tricksterGlobe(), owner: P1 },
        { key: "a", def: character({ name: "A", strength: 2 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 3 }), owner: P1 },
        ...deck(P1, 2, "m"),
        ...deck(P2, 6, "o")
      ],
      activePlayerId: P1
    });
    const influence = engine.state.players[P2].influence;
    const top = engine.state.players[P2].deck.slice(0, 4);
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("a"), id("b")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);

    const pc = engine.state.pendingChoice;
    assert.equal(pc?.kind, "millInsteadOfDamage");
    assert.equal(pc?.kind === "millInsteadOfDamage" && pc.amount, 5);
    assert.equal(pc?.kind === "millInsteadOfDamage" && pc.max, 5);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "millInsteadOfDamage", count: 4 } });
    autoResolveBattle(engine);

    assert.equal(engine.state.battle, undefined);
    assert.equal(engine.state.players[P2].influence, influence - 1);
    assert.deepEqual(engine.state.players[P2].discard, top);
  });

  test("an effect's damage pauses mid-list and the list goes on after the answer", () => {
    const zap = tactic({
      name: "Zap",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "z",
            type: "activated",
            effects: [
              { type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 3 },
              { type: "draw", player: "controller", amount: 1 }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "globe", def: tricksterGlobe(), owner: P1 },
        { key: "zap", def: zap, owner: P1, zone: "hand" },
        ...deck(P1, 2, "m"),
        ...deck(P2, 6, "o")
      ],
      activePlayerId: P1
    });
    const influence = engine.state.players[P2].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("zap") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "millInsteadOfDamage");
    assert.equal(engine.state.players[P1].hand.length, 0, "the draw waits for the answer");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "millInsteadOfDamage", count: 3 } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P2].influence, influence);
    assert.equal(engine.state.players[P2].discard.length, 3);
    assert.equal(engine.state.players[P1].hand.length, 1, "the draw ran");
  });

  test("an empty deck loses even through preventsDefeat (which only covers 0 influence)", () => {
    const keep = item({
      name: "Keep",
      behavior: { abilities: [{ id: "k", type: "continuous", modifiers: [], preventsDefeat: { player: "self" } }] }
    });
    const { engine } = buildGame({
      cards: [
        { key: "globe", def: tricksterGlobe(), owner: P1 },
        { key: "keep", def: keep, owner: P2 },
        ...deck(P1, 2, "m")
      ],
      activePlayerId: P1
    });
    (engine as unknown as { checkStateBasedActions(): void }).checkStateBasedActions();
    assert.equal(engine.state.winner, P1);
  });
});
