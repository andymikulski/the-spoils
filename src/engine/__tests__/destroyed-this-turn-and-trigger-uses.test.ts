// Two generic capabilities (unit EU2, Decade of Deckadence):
//  - the `destroyedThisTurn` NumberExpression ("X is the number of characters that were destroyed this turn");
//  - `TriggeredAbility.usesPerTurn` ("Once per turn, when ...").
// Synthetic fixtures only; the cards that use them are checked in their own scratch tests.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, NumberExpression, PlayerId } from "../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses } from "./support/fixtures.js";
import { endTurn } from "./clauses/_turn.js";

type Built = ReturnType<typeof buildGame>;

const activate = (g: Built, player: PlayerId, key: string, abilityId: string, selected: Record<string, string[]> = {}): void => {
  g.engine.perform({ type: "activateAbility", playerId: player, cardId: g.id(key), abilityId: abilityId, selected } as never);
  resolvePendingResponses(g.engine);
  // Triggers that fire together are ordered by their controller: take the listed order.
  for (let pc = g.engine.state.pendingChoice as any; pc?.kind === "orderTriggers"; pc = g.engine.state.pendingChoice as any) {
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: pc.triggers[0] } } as never);
    resolvePendingResponses(g.engine);
  }
};

const kill = (g: Built, player: PlayerId, killerKey: string, victimKey: string): void =>
  activate(g, player, killerKey, "kill", { t: [g.id(victimKey)] });

/** An item that destroys the picked card of any type, from any side. */
const killer = (name = "Killer"): CardDefinition =>
  item({
    name,
    behavior: {
      abilities: [
        {
          id: "kill",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** An item whose ability `read-<n>` gives its controller influence equal to the expression, so a test can read it. */
const reader = (exprs: Record<string, NumberExpression>): CardDefinition =>
  item({
    name: "Reader",
    behavior: {
      abilities: Object.entries(exprs).map(([name, amount]) => ({
        id: `read-${name}`,
        type: "activated" as const,
        effects: [{ type: "modifyInfluence" as const, player: "controller" as const, amount }]
      }))
    }
  });

const read = (g: Built, name: string): number => {
  const before = g.engine.state.players[P1].influence;
  activate(g, P1, "reader", `read-${name}`);
  return g.engine.state.players[P1].influence - before;
};

describe("destroyedThisTurn expression", () => {
  const exprs = {
    any: { type: "destroyedThisTurn" } as NumberExpression,
    chars: { type: "destroyedThisTurn", cardType: "character" } as NumberExpression,
    items: { type: "destroyedThisTurn", cardType: "item" } as NumberExpression,
    mine: { type: "destroyedThisTurn", player: "controller" } as NumberExpression,
    theirChars: { type: "destroyedThisTurn", player: "opponent", cardType: "character" } as NumberExpression
  };

  const board = () =>
    buildGame({
      cards: [
        { key: "reader", def: reader(exprs), owner: P1, zone: "play" },
        { key: "k1", def: killer("K1"), owner: P1, zone: "play" },
        { key: "k2", def: killer("K2"), owner: P2, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "play" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
        { key: "theirItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" }
      ]
    });

  test("0 before anything is destroyed", () => {
    const g = board();
    assert.equal(read(g, "any"), 0);
    assert.equal(read(g, "chars"), 0);
  });

  test("counts by type and by the controller the destroyed card had, whoever destroys it", () => {
    const g = board();
    kill(g, P1, "k1", "mine");
    kill(g, P1, "k1", "theirs");
    kill(g, P1, "k1", "theirItem");
    assert.equal(read(g, "any"), 3);
    assert.equal(read(g, "chars"), 2);
    assert.equal(read(g, "items"), 1);
    assert.equal(read(g, "mine"), 1);
    assert.equal(read(g, "theirChars"), 1);
    kill(g, P1, "k1", "mine2");
    assert.equal(read(g, "chars"), 3);
    assert.equal(read(g, "mine"), 2);
  });

  test("a card that is not destroyed does not count (a bounce, a face-down resource)", () => {
    const bounce = item({
      name: "Bouncer",
      behavior: {
        abilities: [
          {
            id: "bounce",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    });
    const g = buildGame({
      cards: [
        { key: "reader", def: reader(exprs), owner: P1, zone: "play" },
        { key: "b", def: bounce, owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
      ]
    });
    activate(g, P1, "b", "bounce", { t: [g.id("mine")] });
    assert.equal(g.engine.state.cards[g.id("mine")].zone, "hand");
    assert.equal(read(g, "any"), 0);
  });

  test("the tally starts over each turn", () => {
    const g = board();
    kill(g, P1, "k1", "mine");
    assert.equal(read(g, "chars"), 1);
    endTurn(g.engine, P1);
    endTurn(g.engine, P2);
    assert.equal(g.engine.state.activePlayerId, P1);
    assert.equal(read(g, "chars"), 0);
    kill(g, P1, "k1", "theirs");
    assert.equal(read(g, "chars"), 1);
  });

  test("counts what died before the reading card was in play", () => {
    const g = buildGame({
      cards: [
        { key: "reader", def: reader(exprs), owner: P1, zone: "hand" },
        { key: "k1", def: killer("K1"), owner: P1, zone: "play" },
        { key: "a", def: character({ name: "A" }), owner: P2, zone: "play" },
        { key: "b", def: character({ name: "B" }), owner: P2, zone: "play" }
      ]
    });
    kill(g, P1, "k1", "a");
    kill(g, P1, "k1", "b");
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("reader") });
    resolvePendingResponses(g.engine);
    assert.equal(read(g, "chars"), 2);
  });
});

describe("TriggeredAbility.usesPerTurn", () => {
  /** An item whose trigger gives its controller 1 influence when a card is destroyed (optionally only an opposing one). */
  const bell = (usesPerTurn: number | undefined, opposingOnly = false): CardDefinition =>
    item({
      name: "Bell",
      behavior: {
        abilities: [
          {
            id: "ring",
            type: "triggered",
            event: "cardDestroyed",
            ...(usesPerTurn !== undefined ? { usesPerTurn } : {}),
            ...(opposingOnly ? { condition: { type: "eventCardControlledBy", player: "opponent" } } : {}),
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          },
          {
            id: "bounce",
            type: "activated",
            effects: [{ type: "moveCard", target: "source", to: "hand" }]
          }
        ]
      }
    });

  const victims = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `v${i}`, def: character({ name: `V${i}` }), owner: P2, zone: "play" as const }));

  const influence = (g: Built, player: PlayerId = P1) => g.engine.state.players[player].influence;

  test("without the limit the trigger fires on every event", () => {
    const g = buildGame({
      cards: [{ key: "bell", def: bell(undefined), owner: P1, zone: "play" }, { key: "k", def: killer(), owner: P1, zone: "play" }, ...victims(3)]
    });
    const before = influence(g);
    for (const v of ["v0", "v1", "v2"]) kill(g, P1, "k", v);
    assert.equal(influence(g), before + 3);
  });

  test("usesPerTurn: 1 fires once a turn and again the next turn the event happens", () => {
    const g = buildGame({
      cards: [{ key: "bell", def: bell(1), owner: P1, zone: "play" }, { key: "k", def: killer(), owner: P1, zone: "play" }, ...victims(3)]
    });
    const before = influence(g);
    kill(g, P1, "k", "v0");
    kill(g, P1, "k", "v1");
    assert.equal(influence(g), before + 1, "the second event this turn does not fire it");
    endTurn(g.engine, P1);
    endTurn(g.engine, P2);
    const next = influence(g);
    kill(g, P1, "k", "v2");
    assert.equal(influence(g), next + 1, "a new turn, a new use");
  });

  test("usesPerTurn: 2 fires twice, not three times", () => {
    const g = buildGame({
      cards: [{ key: "bell", def: bell(2), owner: P1, zone: "play" }, { key: "k", def: killer(), owner: P1, zone: "play" }, ...victims(3)]
    });
    const before = influence(g);
    for (const v of ["v0", "v1", "v2"]) kill(g, P1, "k", v);
    assert.equal(influence(g), before + 2);
  });

  test("an event that fails the condition does not spend the use", () => {
    const g = buildGame({
      cards: [
        { key: "bell", def: bell(1, true), owner: P1, zone: "play" },
        { key: "k", def: killer(), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
        ...victims(2)
      ]
    });
    const before = influence(g);
    kill(g, P1, "k", "mine");
    assert.equal(influence(g), before, "my own card dying is not an opposing one");
    kill(g, P1, "k", "v0");
    assert.equal(influence(g), before + 1, "the first matching event fires it");
    kill(g, P1, "k", "v1");
    assert.equal(influence(g), before + 1, "and the second does not");
  });

  test("the count is per card: two copies each get their own use", () => {
    const g = buildGame({
      cards: [
        { key: "bell1", def: bell(1), owner: P1, zone: "play" },
        { key: "bell2", def: bell(1), owner: P1, zone: "play" },
        { key: "k", def: killer(), owner: P1, zone: "play" },
        ...victims(2)
      ]
    });
    const before = influence(g);
    kill(g, P1, "k", "v0");
    assert.equal(influence(g), before + 2, "both copies fire");
    kill(g, P1, "k", "v1");
    assert.equal(influence(g), before + 2, "neither fires again");
  });

  test("a different ability of the same card is not limited by it", () => {
    const twin = item({
      name: "Twin",
      behavior: {
        abilities: [
          { id: "a", type: "triggered", event: "cardDestroyed", usesPerTurn: 1, effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] },
          { id: "b", type: "triggered", event: "cardDestroyed", effects: [{ type: "modifyInfluence", player: "controller", amount: 10 }] }
        ]
      }
    });
    const g = buildGame({ cards: [{ key: "t", def: twin, owner: P1, zone: "play" }, { key: "k", def: killer(), owner: P1, zone: "play" }, ...victims(2)] });
    const before = influence(g);
    kill(g, P1, "k", "v0");
    kill(g, P1, "k", "v1");
    assert.equal(influence(g), before + 11 + 10);
  });

  test("a card that leaves play and enters again is a new object with its use back", () => {
    const g = buildGame({
      cards: [{ key: "bell", def: bell(1), owner: P1, zone: "play" }, { key: "k", def: killer(), owner: P1, zone: "play" }, ...victims(3)]
    });
    const before = influence(g);
    kill(g, P1, "k", "v0");
    assert.equal(influence(g), before + 1);
    activate(g, P1, "bell", "bounce");
    assert.equal(g.engine.state.cards[g.id("bell")].zone, "hand");
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("bell") });
    resolvePendingResponses(g.engine);
    assert.equal(g.engine.state.cards[g.id("bell")].zone, "play");
    kill(g, P1, "k", "v1");
    assert.equal(influence(g), before + 2, "fires again after re-entering play");
    kill(g, P1, "k", "v2");
    assert.equal(influence(g), before + 2, "but only once");
  });
});
