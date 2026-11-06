// E3b: a free play waives only the numeric cost (its extra costs are still paid), a tactic played by an effect uses the
// stack, a duplicate pays the copied tactic's extra costs, and a played card's numeric cost is the CR 406.3 running total.
// Synthetic cards; the printed cards have their own clause tests (see BEHAVIORS.md "E3b additions").

import { describe, test } from "node:test";
import assert from "node:assert/strict";
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
import type { CardPlacement } from "./support/fixtures.js";
import type { SpoilsEngine } from "../../engine.js";

const ready = (engine: SpoilsEngine, player = P1) => engine.getAvailableResourceCount(player);
const resources = (n: number, owner = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `r${owner}${i}`, def: resourceCard({ name: `R${owner}${i}` }), owner }));
const zone = (engine: SpoilsEngine, id: string) => engine.state.cards[id].zone;
const influence = (engine: SpoilsEngine, player = P2) => engine.state.players[player].influence;
const playCard = (engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "playCard", playerId: player, cardId, selected: {}, variables: {}, ...extra } as never);
const answer = (engine: SpoilsEngine, player: string, choice: Record<string, unknown>) =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice } as never);

/** A tactic with an extra "pay 2" cost whose effect makes the opponent's faction lose 1 influence. */
const costlyTactic = (over: Record<string, unknown> = {}) =>
  tactic({
    name: "Costly",
    cost: 1,
    behavior: {
      abilities: [
        { id: "c", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }
      ]
    } as never,
    ...over
  });

/** An item whose ability plays a tactic from your hand for free. */
const freePlayer = () =>
  item({
    name: "Free Player",
    behavior: {
      abilities: [
        {
          id: "go",
          type: "activated",
          effects: [{ type: "deployForFree", player: "controller", maxCost: 5, selector: { type: "tactic", zone: "any" } }]
        }
      ]
    } as never
  });

const useFreePlayer = (engine: SpoilsEngine, id: (k: string) => string) => {
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("fp"), abilityId: "go", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
};

describe("E3b — 'for free' waives only the numeric cost", () => {
  const board = (spare: number, def = costlyTactic()) =>
    buildGame({
      cards: [
        { key: "fp", def: freePlayer(), owner: P1 },
        { key: "t", def, owner: P1, zone: "hand" },
        ...resources(spare)
      ]
    });

  test("the extra 'pay 2' is paid, the printed cost of 1 is not", () => {
    const { engine, id } = board(3);
    const start = influence(engine);
    useFreePlayer(engine, id);
    answer(engine, P1, { kind: "deployForFree", cardId: id("t") });
    assert.equal(ready(engine), 1, "3 - 2: only the extra cost was paid");
    resolvePendingResponses(engine);
    assert.equal(influence(engine), start - 1, "and the tactic resolved");
  });

  test("an extra cost that cannot be paid refuses the free play and leaves everything where it was", () => {
    const { engine, id } = board(1);
    useFreePlayer(engine, id);
    assert.throws(() => answer(engine, P1, { kind: "deployForFree", cardId: id("t") }), /Costs cannot be paid/);
    assert.equal(zone(engine, id("t")), "hand");
    assert.equal(ready(engine), 1, "nothing was spent");
    assert.equal(engine.state.pendingChoice?.kind, "deployForFree", "the choice is still open: the player may decline");
    answer(engine, P1, { kind: "deployForFree" });
    assert.equal(zone(engine, id("t")), "hand");
  });
});

describe("E3b — a tactic played by an effect waits on the stack and can be responded to", () => {
  const counter = () => tactic({ name: "Counter", cost: 0, behavior: { abilities: [{ id: "x", type: "activated", effects: [] }] } as never });
  const cheap = (extra: Record<string, unknown> = {}) =>
    tactic({
      name: "Cheap",
      cost: 1,
      behavior: { ...extra, abilities: [{ id: "c", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }] } as never
    });

  test("the opponent gets a response window before it resolves", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fp", def: freePlayer(), owner: P1 },
        { key: "t", def: cheap(), owner: P1, zone: "hand" },
        { key: "resp", def: counter(), owner: P2, zone: "hand" }
      ]
    });
    const start = influence(engine);
    useFreePlayer(engine, id);
    answer(engine, P1, { kind: "deployForFree", cardId: id("t") });
    assert.ok(engine.state.responseWindow, "a response window is open");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
    assert.equal(influence(engine), start, "it has not resolved yet");
    assert.equal(zone(engine, id("t")), "deploying");
    resolvePendingResponses(engine);
    assert.equal(influence(engine), start - 1);
    assert.equal(zone(engine, id("t")), "discard");
  });

  test("a tactic the opponent cannot respond to resolves at once", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fp", def: freePlayer(), owner: P1 },
        { key: "t", def: cheap({ noResponse: true }), owner: P1, zone: "hand" }
      ]
    });
    const start = influence(engine);
    useFreePlayer(engine, id);
    answer(engine, P1, { kind: "deployForFree", cardId: id("t") });
    assert.equal(influence(engine), start - 1);
    assert.equal(zone(engine, id("t")), "discard");
  });
});

describe("E3b — a duplicate keeps the copied tactic's extra costs", () => {
  /** "Duplicate the last tactic played this turn." */
  const replicate = () =>
    tactic({
      name: "Replicate",
      cost: 0,
      behavior: { abilities: [{ id: "r", type: "activated", effects: [{ type: "duplicate", target: { type: "lastDeployedTactic" } }] }] } as never
    });
  /** Extra costs "discard a card" and "pay X". */
  const tithe = () =>
    tactic({
      name: "Tithe",
      cost: 1,
      behavior: {
        abilities: [
          {
            id: "t",
            type: "activated",
            variables: { x: 0 },
            variableBounds: { x: { min: 0 } },
            costs: [
              { type: "discard", id: "dc", player: "controller", selector: { zone: "hand" }, count: 1 },
              { type: "payResources", amount: { type: "variable", id: "x" } }
            ],
            effects: [{ type: "modifyInfluence", player: "opponent", amount: { type: "multiply", values: [{ type: "variable", id: "x" }, -1] } }]
          }
        ]
      } as never
    });

  const board = (spare: number, hand = 2) =>
    buildGame({
      cards: [
        { key: "t", def: tithe(), owner: P1, zone: "hand" },
        { key: "rep", def: replicate(), owner: P1, zone: "hand" },
        ...Array.from({ length: hand }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const })),
        ...resources(spare)
      ]
    });

  test("the copy discards another card and pays X again, with the original's X", () => {
    const { engine, id } = board(6);
    const start = influence(engine);
    playCard(engine, P1, id("t"), { variables: { x: 2 }, selected: { dc: [id("h0")] } });
    resolvePendingResponses(engine);
    assert.equal(influence(engine), start - 2);
    assert.equal(ready(engine), 6 - 1 - 2, "printed cost 1 + X");
    playCard(engine, P1, id("rep"));
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the duplicator is asked what to discard for the copy");
    assert.equal(engine.state.pendingChoice?.playerId, P1);
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("h1")] });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("h1")), "discard", "the copy's discard cost was paid");
    assert.equal(ready(engine), 3 - 2, "and X = 2 resources again (the copy has cost number 0)");
    assert.equal(influence(engine), start - 4, "the copy took effect with X = 2");
  });

  test("a copy whose extra cost cannot be paid is invalid and has no effect", () => {
    const { engine, id } = board(4);
    const start = influence(engine);
    playCard(engine, P1, id("t"), { variables: { x: 2 }, selected: { dc: [id("h0")] } });
    resolvePendingResponses(engine);
    // 1 resource left: the copy cannot pay X = 2
    playCard(engine, P1, id("rep"));
    resolvePendingResponses(engine);
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("h1")] });
    resolvePendingResponses(engine);
    assert.equal(influence(engine), start - 2, "no second effect");
    assert.equal(zone(engine, id("h1")), "hand", "and nothing was discarded: the costs are rehearsed first");
    assert.equal(ready(engine), 1, "nor paid");
  });
});

describe("E3b — a played card's numeric cost is the running total (CR 406.3)", () => {
  /** "Pay X, where X is its numeric cost": a response that charges the played tactic's total. */
  const mirror = () =>
    tactic({
      name: "Mirror",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "m",
            type: "activated",
            condition: { type: "respondingTo", cardType: "tactic" },
            costs: [{ type: "payResources", amount: { type: "cardCost", target: { type: "respondedToCard" } } }],
            effects: []
          }
        ]
      } as never
    });

  test("while it is on the stack it counts its pay-N extra costs; the printed number is not the total", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      turn: 2,
      cards: [
        { key: "t", def: costlyTactic(), owner: P2, zone: "hand" },
        { key: "mir", def: mirror(), owner: P1, zone: "hand" },
        ...resources(6, P1),
        ...resources(6, P2)
      ]
    });
    playCard(engine, P2, id("t"));
    assert.equal(ready(engine, P2), 3, "the opponent paid 1 + 2");
    const before = ready(engine);
    playCard(engine, P1, id("mir"));
    assert.equal(before - ready(engine), 3, "X = the running total 3, not the printed 1");
  });
});
