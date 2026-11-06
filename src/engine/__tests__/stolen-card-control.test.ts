// A card you took control of keeps that control only while it is in play
// (CR §407.3: "that player retains control of the card until it leaves play").
// Once it is in a hand, deck, discard pile, the void or out of the game it has
// no thief: it is controlled by whoever holds it — its owner, or `heldBy` when
// an effect put it into someone else's hand/deck (CR §407.7–407.8: ownership
// never changes). Synthetic fixtures only.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type {
  AbilityDefinition,
  CardDefinition,
  CardSelector,
  Effect,
  SpoilsEngine
} from "../../engine.js";
import {
  buildGame,
  character,
  item,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import { settleTurnStart } from "./support/develop.js";

type Activated = Extract<AbilityDefinition, { type: "activated" }>;

const PICK_STOLEN = [
  { id: "t", selector: { controller: "self", type: "character" } as CardSelector, count: 1 }
];
const T = { type: "selected", id: "t" } as const;

/** What the thief can do to the card it just took, one ability per fate. */
const FATES: Record<string, Effect> = {
  bounce: { type: "moveCard", target: T, to: "hand" },
  topdeck: { type: "moveCard", target: T, to: "deck", position: "top" },
  discard: { type: "moveCard", target: T, to: "discard" },
  void: { type: "moveCard", target: T, to: "void" },
  remove: { type: "removeFromGame", target: T },
  destroy: { type: "destroy", target: T },
  // "Put it into MY hand": the thief now holds a card it doesn't own.
  borrow: { type: "moveCard", target: T, to: "hand", toPlayer: "controller" }
};

function thiefDef(extra: AbilityDefinition[] = []): CardDefinition {
  const abilities: Activated[] = [
    {
      id: "steal",
      type: "activated",
      targets: [
        { id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }
      ],
      effects: [{ type: "takeControl", target: T, controller: "controller" }]
    },
    ...Object.entries(FATES).map(([id, effect]) => ({
      id,
      type: "activated" as const,
      targets: PICK_STOLEN,
      effects: [effect]
    }))
  ];
  return character({ name: "Thief", behavior: { abilities: [...abilities, ...extra] } });
}

function use(engine: SpoilsEngine, who: string, cardId: string, abilityId: string, victim: string): void {
  engine.perform({
    type: "activateAbility",
    playerId: who,
    cardId,
    abilityId,
    selected: { t: [victim] }
  });
  resolvePendingResponses(engine);
}

/** P1's Thief takes P2's Victim; the Victim is P1's until it leaves play. */
function heist(victimDef: CardDefinition = character({ name: "Victim" })) {
  const built = buildGame({
    cards: [
      { key: "thief", def: thiefDef(), owner: P1 },
      { key: "victim", def: victimDef, owner: P2 }
    ]
  });
  const { engine, id } = built;
  use(engine, P1, id("thief"), "steal", id("victim"));
  assert.equal(engine.state.cards[id("victim")].controllerId, P1);
  assert.ok(engine.state.players[P1].play.includes(id("victim")), "engine.state.players[P1].play.includes(id(\"victim\"))");
  return built;
}

function endP1Turn(engine: SpoilsEngine): void {
  engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(engine);
  settleTurnStart(engine);
  assert.equal(engine.state.activePlayerId, P2);
}

describe("a stolen card that leaves play is controlled by whoever holds it", () => {
  test("bounced to its owner's hand: the owner controls it and can deploy it", () => {
    const { engine, id } = heist();
    use(engine, P1, id("thief"), "bounce", id("victim"));

    const victim = engine.state.cards[id("victim")];
    assert.equal(victim.zone, "hand");
    assert.ok(engine.state.players[P2].hand.includes(id("victim")), "engine.state.players[P2].hand.includes(id(\"victim\"))");
    assert.equal(victim.ownerId, P2);
    assert.equal(victim.controllerId, P2);
    assert.equal(victim.heldBy, undefined);

    endP1Turn(engine);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("victim") });
    resolvePendingResponses(engine);

    assert.equal(engine.state.cards[id("victim")].zone, "play");
    assert.equal(engine.state.cards[id("victim")].controllerId, P2);
    assert.ok(engine.state.players[P2].play.includes(id("victim")), "engine.state.players[P2].play.includes(id(\"victim\"))");
    assert.ok(!engine.state.players[P1].play.includes(id("victim")), "!engine.state.players[P1].play.includes(id(\"victim\"))");
  });

  test("the thief cannot deploy the card it no longer holds", () => {
    const { engine, id } = heist();
    use(engine, P1, id("thief"), "bounce", id("victim"));

    assert.throws(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("victim") }),
      /do not control|not in your hand|Card must be in your hand/i
    );
  });

  test("put on top of the owner's deck: controlled by the owner", () => {
    const { engine, id } = heist();
    use(engine, P1, id("thief"), "topdeck", id("victim"));

    const victim = engine.state.cards[id("victim")];
    assert.equal(victim.zone, "deck");
    assert.equal(engine.state.players[P2].deck[0], id("victim"));
    assert.equal(victim.controllerId, P2);
    assert.equal(victim.heldBy, undefined);
  });

  for (const [fate, zone] of [
    ["discard", "discard"],
    ["destroy", "discard"],
    ["void", "void"],
    ["remove", "removed"]
  ] as const) {
    test(`${fate}: lands in the owner's ${zone} and is controlled by the owner`, () => {
      const { engine, id } = heist();
      use(engine, P1, id("thief"), fate, id("victim"));

      const victim = engine.state.cards[id("victim")];
      assert.equal(victim.zone, zone);
      assert.ok(engine.state.players[P2][zone].includes(id("victim")), "engine.state.players[P2][zone].includes(id(\"victim\"))");
      assert.ok(!engine.state.players[P1][zone].includes(id("victim")), "!engine.state.players[P1][zone].includes(id(\"victim\"))");
      assert.equal(victim.controllerId, P2);
    });
  }

  test("selectors read the new control: 'your discard pile' finds it for the owner only", () => {
    const { engine, id } = heist();
    use(engine, P1, id("thief"), "destroy", id("victim"));

    const find = (controllerId: string) =>
      engine
        .queryCards(
          { controller: "self", zone: "discard" },
          { sourceId: id("thief"), controllerId, selected: {} }
        )
        .map(c => c.id);

    assert.deepEqual(find(P2), [id("victim")]);
    assert.deepEqual(find(P1), []);
  });

  test("an item or resource that changed hands is released the same way", () => {
    const built = buildGame({
      cards: [
        { key: "thief", def: thiefDef(), owner: P1 },
        { key: "tool", def: item({ name: "Tool" }), owner: P2, controller: P1 },
        { key: "coin", def: resourceCard({ name: "Coin" }), owner: P2, controller: P1 }
      ]
    });
    const { engine, id } = built;
    const bounce: Effect[] = ["tool", "coin"].map(key => ({
      type: "moveCard",
      target: { type: "selected", id: key },
      to: "hand"
    }));
    // No ability fits two picks at once; drive the engine's own effect resolver.
    for (const effect of bounce) {
      engine.resolveEffect(effect, {
        sourceId: id("thief"),
        controllerId: P1,
        selected: { tool: [id("tool")], coin: [id("coin")] }
      });
    }

    for (const key of ["tool", "coin"]) {
      const card = engine.state.cards[id(key)];
      assert.equal(card.zone, "hand", key);
      assert.ok(engine.state.players[P2].hand.includes(id(key)), key);
      assert.equal(card.controllerId, P2, key);
    }
  });
});

describe("a stolen card held in the thief's hand or deck", () => {
  test("'put it into my hand' makes the thief the holder and controller", () => {
    const { engine, id } = heist();
    use(engine, P1, id("thief"), "borrow", id("victim"));

    const victim = engine.state.cards[id("victim")];
    assert.equal(victim.zone, "hand");
    assert.ok(engine.state.players[P1].hand.includes(id("victim")), "engine.state.players[P1].hand.includes(id(\"victim\"))");
    assert.equal(victim.heldBy, P1);
    assert.equal(victim.controllerId, P1);
    assert.equal(victim.ownerId, P2);
  });

  test("discarding it sends it to the owner's pile and releases the holder's control", () => {
    const { engine, id } = heist();
    use(engine, P1, id("thief"), "borrow", id("victim"));

    engine.resolveEffect(
      { type: "moveCard", target: T, to: "discard" },
      { sourceId: id("thief"), controllerId: P1, selected: { t: [id("victim")] } }
    );

    const victim = engine.state.cards[id("victim")];
    assert.equal(victim.zone, "discard");
    assert.ok(engine.state.players[P2].discard.includes(id("victim")), "engine.state.players[P2].discard.includes(id(\"victim\"))");
    assert.equal(victim.heldBy, undefined);
    assert.equal(victim.controllerId, P2);
  });

  test("returning it to its owner's hand makes the owner its controller", () => {
    const { engine, id } = heist();
    use(engine, P1, id("thief"), "borrow", id("victim"));

    engine.resolveEffect(
      { type: "moveCard", target: T, to: "hand", toPlayer: "opponent" },
      { sourceId: id("thief"), controllerId: P1, selected: { t: [id("victim")] } }
    );

    const victim = engine.state.cards[id("victim")];
    assert.ok(engine.state.players[P2].hand.includes(id("victim")), "engine.state.players[P2].hand.includes(id(\"victim\"))");
    assert.equal(victim.heldBy, undefined);
    assert.equal(victim.controllerId, P2);
  });
});

describe("leaves-play abilities still see the controller it had in play", () => {
  const CARE = (id: string, event: "cardDestroyed" | "cardMoved"): AbilityDefinition => ({
    id,
    type: "triggered",
    event,
    condition:
      event === "cardMoved"
        ? {
            type: "and",
            conditions: [
              { type: "sourceIsEventCard" },
              { type: "cardMovedFromZone", zone: "play" }
            ]
          }
        : { type: "sourceIsEventCard" },
    effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
  });

  test("its own 'when destroyed' trigger is the thief's, not the owner's", () => {
    const { engine, id } = heist(
      character({ name: "Vengeful", behavior: { abilities: [CARE("die", "cardDestroyed")] } })
    );
    const before = {
      thief: engine.state.players[P1].influence,
      owner: engine.state.players[P2].influence
    };
    use(engine, P1, id("thief"), "destroy", id("victim"));

    assert.equal(engine.state.players[P1].influence, before.thief + 1);
    assert.equal(engine.state.players[P2].influence, before.owner);
    assert.equal(engine.state.cards[id("victim")].controllerId, P2);
  });

  test("its own 'when this leaves play' trigger is the thief's when it is bounced", () => {
    const { engine, id } = heist(
      character({ name: "Clingy", behavior: { abilities: [CARE("leave", "cardMoved")] } })
    );
    const before = {
      thief: engine.state.players[P1].influence,
      owner: engine.state.players[P2].influence
    };
    use(engine, P1, id("thief"), "bounce", id("victim"));

    assert.equal(engine.state.players[P1].influence, before.thief + 1);
    assert.equal(engine.state.players[P2].influence, before.owner);
    assert.equal(engine.state.cards[id("victim")].controllerId, P2);
  });

  test("'a character an opponent controls is destroyed' judges the thief as the controller", () => {
    // Owner P2 watches for destroyed characters that P2's opponent controls.
    const watcher = character({
      name: "Watcher",
      behavior: {
        abilities: [
          {
            id: "watch",
            type: "triggered",
            event: "cardDestroyed",
            condition: { type: "eventCardControlledBy", player: "opponent" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "thief", def: thiefDef(), owner: P1 },
        { key: "victim", def: character({ name: "Victim" }), owner: P2 },
        { key: "watcher", def: watcher, owner: P2 }
      ]
    });
    use(engine, P1, id("thief"), "steal", id("victim"));
    const before = engine.state.players[P2].influence;
    use(engine, P1, id("thief"), "destroy", id("victim"));

    assert.equal(engine.state.players[P2].influence, before + 2);
  });
});

describe("timed take-control and cards that are not in play", () => {
  const GRAB: CardDefinition = tactic({
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
              target: T,
              controller: "controller",
              duration: { type: "untilEndOfTurn" }
            }
          ]
        }
      ]
    }
  });

  test("a card that leaves play during the grant stays the owner's after the sweep", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "grab", def: GRAB, owner: P1, zone: "hand" },
        { key: "thief", def: thiefDef(), owner: P1 },
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
    assert.equal(engine.state.controlGrants.length, 1);

    use(engine, P1, id("thief"), "bounce", id("minion"));
    assert.equal(engine.state.cards[id("minion")].controllerId, P2);
    assert.equal(engine.state.controlGrants.length, 0);

    // P1's turn ends, P2's turn ends: the sweep runs and must not touch it.
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    const minion = engine.state.cards[id("minion")];
    assert.equal(minion.zone, "hand");
    assert.equal(minion.controllerId, P2);
    assert.ok(engine.state.players[P2].hand.includes(id("minion")), "engine.state.players[P2].hand.includes(id(\"minion\"))");
    assert.ok(!engine.state.players[P1].play.includes(id("minion")), "!engine.state.players[P1].play.includes(id(\"minion\"))");
  });

  test("taking control of a card that is not in play does nothing", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "thief", def: thiefDef(), owner: P1 },
        { key: "gone", def: character({ name: "Gone" }), owner: P2, zone: "discard" },
        { key: "held", def: character({ name: "Held" }), owner: P2, zone: "hand" }
      ]
    });
    for (const key of ["gone", "held"]) {
      engine.resolveEffect(
        {
          type: "takeControl",
          target: { type: "selected", id: "c" },
          controller: "controller",
          duration: { type: "untilEndOfTurn" }
        },
        { sourceId: id("thief"), controllerId: P1, selected: { c: [id(key)] } }
      );
      assert.equal(engine.state.cards[id(key)].controllerId, P2, key);
    }
    assert.equal(engine.state.controlGrants.length, 0);
  });
});
