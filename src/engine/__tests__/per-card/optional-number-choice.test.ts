// "You MAY choose a number for X and …" — Micromajig Recycling Station (Shade of the Devoured Emperor):
// "At the start of your turn, you may choose a number for X and destroy X Micromajig tokens you control. If you do,
// reduce the next numeric cost you pay this turn by X+1."
//
// Skipping the "may" and choosing 0 are different answers: choosing 0 is doing it (CR 410.2a: 0 is a whole number),
// so it destroys nothing and still reduces by 0+1; skipping does nothing at all (rulings.md Q54).
// Kept in its own file because the two-player per-card files are frozen (docs/MULTIPLAYER-PLAN.md, test-freeze).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, cardDef, developFaction, character, resolvePendingResponses, P1, P2, developDrawChoice, settleStartFirst } from "./_harness.js";

const def = (name: string) => cardDef("Shade of the Devoured Emperor", name);

type Pending = { kind: string; playerId: string; optional?: boolean; min?: number; [k: string]: unknown };

/** Starts P1's turn with the Station and one Micromajig token in play, answering the number prompt with `answer`. */
function startRecycling(answer: (pc: Pending) => unknown) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mrs", def: def("Micromajig Recycling Station"), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "Micromajig", subtype: ["micromajig"] }), owner: P1, zone: "play" },
      { key: "cheap", def: character({ name: "Cheap", cost: 1 }), owner: P1, zone: "hand" }
    ],
    activePlayerId: P2
  });
  engine.state.cards[id("m1")].isToken = true; // the Station only recycles Micromajig TOKENS
  engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(engine);
  settleStartFirst(engine);

  let offered: Pending | undefined;
  let budget = 40;
  while (engine.state.pendingChoice && budget-- > 0) {
    const pc = engine.state.pendingChoice as unknown as Pending;
    if (pc.kind === "chooseNumber") offered = pc;
    const choice = developDrawChoice(pc) ?? (pc.kind === "chooseNumber" ? answer(pc) : { kind: pc.kind, pay: false, selected: [] });
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  return { engine, id, offered };
}

describe("Micromajig Recycling Station — the number choice is optional", () => {
  test("the prompt can be skipped", () => {
    const { offered } = startRecycling(() => ({ kind: "chooseNumber", value: 0 }));
    assert.equal(offered?.optional, true);
  });

  test("choosing X = 0 still reduces the next cost by 1 and destroys nothing", () => {
    const { engine, id } = startRecycling(() => ({ kind: "chooseNumber", value: 0 }));
    assert.ok(engine.state.cards[id("m1")], "no token was destroyed");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("cheap") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("cheap")].zone, "play", "the 1-cost card was free");
  });

  test("skipping the 'may' gives no discount and destroys nothing", () => {
    const { engine, id } = startRecycling(() => ({ kind: "chooseNumber", skip: true }));
    assert.ok(engine.state.cards[id("m1")], "no token was destroyed");
    assert.throws(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("cheap") }));
  });

  test("a number choice that is not optional refuses a skip", () => {
    // Deity Delimitation Device's RELEASE: a mandatory "choose a number for X".
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ddd", def: cardDef("Holy Heist", "Deity Delimitation Device"), owner: P1, zone: "play" }]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ddd"), abilityId: "ddd-release" } as never);
    resolvePendingResponses(engine);
    const pc = engine.state.pendingChoice as Pending | undefined;
    assert.equal(pc?.kind, "chooseNumber");
    assert.notEqual(pc?.optional, true);
    assert.throws(() =>
      engine.perform({ type: "resolvePendingChoice", playerId: pc!.playerId, choice: { kind: "chooseNumber", skip: true } } as never)
    );
  });
});
