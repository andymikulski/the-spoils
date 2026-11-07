// Table-matrix (Phase 7) card-data fixes for the Seed sets, checked at a three-player table against RULES.md §16 and
// docs/MULTIPLAYER-PLAN.md. Each card is loaded from the real catalog by printing id; a two-player assertion pins that
// classic play is unchanged.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../../data/cards.js";
import type { CardDefinition, PlayerId } from "../../../engine.js";
import { buildGame, character, noDevelopFaction, resolvePendingResponses } from "./_harness.js";

const CATALOG = cardsJson as CardDefinition[];

/** A real catalog printing, by id (a deep clone, safe to mutate). */
function printing(id: string): CardDefinition {
  const def = CATALOG.find(card => card.id === id);
  if (!def) throw new Error(`no printing ${id}`);
  return structuredClone(def);
}

const SEATS = ["p1", "p2", "p3"].map(id => ({ id, faction: noDevelopFaction() }));
const ONE_ON_ONE = ["p1", "p2"].map(id => ({ id, faction: noDevelopFaction() }));

type Engine = ReturnType<typeof buildGame>["engine"];
type Pending = { kind: string; playerId: PlayerId; [key: string]: unknown };

const pending = (engine: Engine): Pending | undefined => engine.state.pendingChoice as Pending | undefined;

/** Answer the open choice (which must be for `playerId`, of `kind`), then drain any response window. */
function reply(engine: Engine, playerId: PlayerId, kind: string, choice: Record<string, unknown>): void {
  const open = pending(engine);
  assert.ok(open, `expected an open ${kind} choice for ${playerId}`);
  assert.equal(open.kind, kind);
  assert.equal(open.playerId, playerId, `the open ${open.kind} choice is for ${open.playerId}, not ${playerId}`);
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind, ...choice } } as never);
  resolvePendingResponses(engine);
}

/** Settle a turn start's simultaneous triggers: resolve the one named `abilityId` first, then any others in the offered order. */
function settleTriggers(engine: Engine, abilityId: string): void {
  for (let guard = 0; guard < 10 && pending(engine)?.kind === "orderTriggers"; guard++) {
    const open = pending(engine)!;
    const triggers = open.triggers as Array<{ abilityId: string }>;
    const next = triggers.find(trigger => trigger.abilityId === abilityId) ?? triggers[0];
    reply(engine, open.playerId, "orderTriggers", { next });
  }
}

const zoneOf = (engine: Engine, cardId: string) => engine.state.cards[cardId].zone;
const handOf = (engine: Engine, playerId: PlayerId) => [...engine.state.players[playerId].hand];

describe("Obscene Communion (Seed): \"Both players\" is the controller and one opponent (MP 3)", () => {
  const COMMUNION = "604a992d-9d16-41db-b9f7-7face9e9a3da";

  const hands = (players: readonly string[]) =>
    players.flatMap(owner => [0, 1].map(i => ({ key: `${owner}h${i}`, def: character({ name: `${owner} hand ${i}` }), owner, zone: "hand" as const })));

  test("at an opponent's turn start that opponent chooses; only they and the controller discard (OPTION 3), the third player does not", () => {
    const { engine, id } = buildGame({
      players: SEATS,
      cards: [{ key: "comm", def: printing(COMMUNION), owner: "p1" }, ...hands(["p1", "p2", "p3"])]
    });
    engine.perform({ type: "endTurn", playerId: "p1" });
    resolvePendingResponses(engine);
    settleTriggers(engine, "communion");
    assert.equal(engine.state.activePlayerId, "p2");
    reply(engine, "p2", "chooserSelectsOption", { index: 2 });
    // "that player" (p2, whose turn it is) first, then the controller; nobody else is asked
    reply(engine, "p2", "chooserSelectsTarget", { selected: [id("p2h0")] });
    reply(engine, "p1", "chooserSelectsTarget", { selected: [id("p1h0")] });
    assert.equal(pending(engine), undefined, "the third player is not asked");
    assert.equal(zoneOf(engine, id("p2h0")), "discard");
    assert.equal(zoneOf(engine, id("p1h0")), "discard");
    assert.equal(handOf(engine, "p3").length, 2, "the third player discarded nothing");
    assert.equal(handOf(engine, "p1").length, 1);
    assert.equal(handOf(engine, "p2").length, 1);
  });

  test("OPTION 1 at the same turn start: only the two draw (and put a card on the bottom of their deck); the third player's deck and hand are untouched", () => {
    const deck = (owner: string) => [0, 1, 2].map(i => ({ key: `${owner}d${i}`, def: character({ name: `${owner} deck ${i}` }), owner, zone: "deck" as const }));
    const { engine, id } = buildGame({
      players: SEATS,
      cards: [{ key: "comm", def: printing(COMMUNION), owner: "p1" }, ...hands(["p1", "p2", "p3"]), ...deck("p1"), ...deck("p2"), ...deck("p3")]
    });
    engine.perform({ type: "endTurn", playerId: "p1" });
    resolvePendingResponses(engine);
    settleTriggers(engine, "communion");
    reply(engine, "p2", "chooserSelectsOption", { index: 0 });
    reply(engine, "p2", "chooserSelectsTarget", { selected: [id("p2h0")] });
    reply(engine, "p1", "chooserSelectsTarget", { selected: [id("p1h0")] });
    assert.equal(pending(engine), undefined, "the third player is not asked");
    assert.equal(handOf(engine, "p3").length, 2, "the third player drew nothing");
    assert.equal(engine.state.players.p3.deck.length, 3);
    assert.equal(handOf(engine, "p2").length, 2, "drew one, put one on the bottom");
    assert.equal(handOf(engine, "p1").length, 2);
  });

  test("on the controller's own turn the controller names which opponent takes part (nobody else does)", () => {
    const { engine, id } = buildGame({
      players: SEATS,
      activePlayerId: "p3",
      turn: 3,
      cards: [{ key: "comm", def: printing(COMMUNION), owner: "p1" }, ...hands(["p1", "p2", "p3"])]
    });
    engine.perform({ type: "endTurn", playerId: "p3" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, "p1");
    settleTriggers(engine, "communion");
    reply(engine, "p1", "chooseOpponent", { opponentId: "p3" });
    reply(engine, "p1", "chooserSelectsOption", { index: 2 });
    reply(engine, "p1", "chooserSelectsTarget", { selected: [id("p1h0")] });
    reply(engine, "p3", "chooserSelectsTarget", { selected: [id("p3h0")] });
    assert.equal(pending(engine), undefined);
    assert.equal(handOf(engine, "p2").length, 2, "the opponent not named discarded nothing");
  });

  test("classic two-player play is unchanged: both players discard, the active player first", () => {
    const { engine, id } = buildGame({
      players: ONE_ON_ONE,
      cards: [{ key: "comm", def: printing(COMMUNION), owner: "p1" }, ...hands(["p1", "p2"])]
    });
    engine.perform({ type: "endTurn", playerId: "p1" });
    resolvePendingResponses(engine);
    settleTriggers(engine, "communion");
    reply(engine, "p2", "chooserSelectsOption", { index: 2 });
    reply(engine, "p2", "chooserSelectsTarget", { selected: [id("p2h0")] });
    reply(engine, "p1", "chooserSelectsTarget", { selected: [id("p1h0")] });
    assert.equal(pending(engine), undefined);
    assert.equal(handOf(engine, "p1").length, 1);
    assert.equal(handOf(engine, "p2").length, 1);
  });
});
