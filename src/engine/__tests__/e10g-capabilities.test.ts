import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { activate, buildGame, character, developFaction, P1, P2 } from "./per-card/_harness.js";
import { answerPending, pending } from "./clauses/_board.js";
import type { ActivatedAbility, CardDefinition, Effect } from "../../engine.js";

/** A character with one free activated ability `go` that runs `effects`. */
const doer = (name: string, effects: Effect[]): CardDefinition =>
  character({
    name,
    life: 9,
    behavior: { abilities: [{ id: "go", type: "activated", effects } as unknown as ActivatedAbility] }
  });

const oppHandCount = { type: "count", selector: { owner: "opponent", zone: "hand" } };
const oppHasCards = { type: "numberCompare", left: oppHandCount, operator: ">", right: 0 };
/** The opponent discards a card of their choice from their hand. */
const oppDiscardsOne = {
  type: "chooserSelectsTarget",
  chooser: "opponent",
  declaration: { id: "d", selector: { owner: "opponent", zone: "hand" }, count: 1 },
  effects: [{ type: "moveCard", target: { type: "selected", id: "d" }, to: "discard" }]
};
const oppDrawsIfDeck = {
  type: "if",
  condition: { type: "numberCompare", left: { type: "count", selector: { owner: "opponent", zone: "deck" } }, operator: ">", right: 0 },
  effects: [{ type: "draw", player: "opponent", amount: 1 }]
};

const board = (effects: Effect[], opts: { hand: number; deck: number }) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "src", def: doer("Looper", effects), owner: P1 },
      ...Array.from({ length: opts.hand }, (_, i) => ({ key: `h${i}`, def: character({ name: `Hand${i}` }), owner: P2, zone: "hand" as const })),
      ...Array.from({ length: opts.deck }, (_, i) => ({ key: `d${i}`, def: character({ name: `Deck${i}` }), owner: P2, zone: "deck" as const }))
    ]
  });

describe("E10g engine capabilities", () => {
  test("repeatWhile re-judges its condition against the board as it is now, pausing on a chooser each pass", () => {
    const { engine, id } = board([{ type: "repeatWhile", condition: oppHasCards, effects: [oppDiscardsOne, oppDrawsIfDeck] } as never], { hand: 2, deck: 1 });
    activate(engine, P1, id("src"), "go");
    let passes = 0;
    while (pending(engine)) {
      const pc = pending(engine) as unknown as { kind: string; playerId: string };
      assert.equal(pc.kind, "chooserSelectsTarget");
      assert.equal(pc.playerId, P2, "the opponent decides each discard");
      const hand = engine.state.players[P2].hand;
      answerPending(engine, "chooserSelectsTarget", { selected: [hand[0]] });
      passes++;
      assert.ok(passes < 10, "the loop ends");
    }
    assert.equal(passes, 3, "two cards in hand + the one drawn mid-loop: three discards (a snapshot forEach would stop at two)");
    assert.equal(engine.state.players[P2].hand.length, 0, "until the opponent has no cards in hand");
    assert.equal(engine.state.players[P2].discard.length, 3);
  });

  test("repeatWhile with a condition that is already false never runs its effects", () => {
    const { engine, id } = board([{ type: "repeatWhile", condition: oppHasCards, effects: [oppDiscardsOne] } as never], { hand: 0, deck: 0 });
    activate(engine, P1, id("src"), "go");
    assert.equal(pending(engine), undefined, "no pass, no prompt");
    assert.equal(engine.state.players[P2].discard.length, 0);
  });

  test("repeatWhile gives each pass a fresh pick scope (the previous pass's pick is not reused)", () => {
    const { engine, id } = board([{ type: "repeatWhile", condition: oppHasCards, effects: [oppDiscardsOne] } as never], { hand: 2, deck: 0 });
    activate(engine, P1, id("src"), "go");
    answerPending(engine, "chooserSelectsTarget", { selected: [id("h0")] });
    assert.ok(pending(engine), "the second pass asks again");
    answerPending(engine, "chooserSelectsTarget", { selected: [id("h1")] });
    assert.equal(pending(engine), undefined);
    assert.equal(engine.state.cards[id("h0")].zone, "discard");
    assert.equal(engine.state.cards[id("h1")].zone, "discard");
  });

  test("repeatWhile loop guard: a condition that never becomes false ends the game as a draw instead of hanging (CR 414.1)", () => {
    const { engine, id } = board([{ type: "repeatWhile", condition: { type: "numberCompare", left: 1, operator: ">", right: 0 }, effects: [], maxPasses: 5 } as never], { hand: 0, deck: 0 });
    activate(engine, P1, id("src"), "go");
    assert.deepEqual(engine.state.result, { outcome: "draw", winners: [] });
  });
});
