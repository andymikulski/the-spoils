// "Choose a number for X and destroy X <things>. If you do, <something that reads X>": choosing X = 0 when there is
// nothing to pick at all must still run the follow-up effects with an empty selection, exactly as it does when there
// ARE candidates (Micromajig Recycling Station: X = 0 -> "reduce the next numeric cost by X+1" = 1; rulings.md Q54:
// choosing 0 is doing it). Found by driving the real turn-start flow: the "no legal candidate" early return in
// `chooserSelectsTarget` came before the "count is 0" branch, so with no Micromajig token to pick the reduction
// effect inside the nested list was dropped.
// Kept in its own file because the two-player per-card files are frozen (docs/MULTIPLAYER-PLAN.md, test-freeze).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildGame, cardDef, developFaction, character, resolvePendingResponses, P1, P2, developDrawChoice, settleStartFirst } from "./_harness.js";

const def = (name: string) => cardDef("Shade of the Devoured Emperor", name);

type Pending = { kind: string; playerId: string; optional?: boolean; min?: number; max?: number; [k: string]: unknown };

/** Starts P1's turn with the Station and `tokens` Micromajig tokens in play, answering the number prompt with `value`. */
function startRecycling(tokens: number, value: number) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mrs", def: def("Micromajig Recycling Station"), owner: P1, zone: "play" },
      ...Array.from({ length: tokens }, (_, i) => ({
        key: `m${i}`,
        def: character({ name: "Micromajig", subtype: ["micromajig"] }),
        owner: P1,
        zone: "play" as const
      })),
      { key: "cheap", def: character({ name: "Cheap", cost: 1 }), owner: P1, zone: "hand" }
    ],
    activePlayerId: P2
  });
  for (let i = 0; i < tokens; i++) engine.state.cards[id(`m${i}`)].isToken = true; // the Station only recycles Micromajig TOKENS
  engine.perform({ type: "endTurn", playerId: P2 });
  resolvePendingResponses(engine);
  settleStartFirst(engine);

  let offered: Pending | undefined;
  let budget = 40;
  while (engine.state.pendingChoice && budget-- > 0) {
    const pc = engine.state.pendingChoice as unknown as Pending;
    if (pc.kind === "chooseNumber") offered = pc;
    const choice = developDrawChoice(pc) ?? (pc.kind === "chooseNumber"
        ? { kind: "chooseNumber", value }
        : pc.kind === "chooserSelectsTarget"
          ? { kind: pc.kind, selected: [id("m0")] }
          : { kind: pc.kind, pay: false, selected: [] });
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  return { engine, id, offered };
}

describe("Micromajig Recycling Station — X = 0 gives the discount whether or not there is a token to pick", () => {
  for (const tokens of [0, 1, 2]) {
    test(`${tokens} token(s) in play: choosing 0 destroys nothing and the next 1-cost card is free`, () => {
      const { engine, id, offered } = startRecycling(tokens, 0);
      assert.equal(offered?.max, tokens, "the prompt offers 0..number of tokens");
      for (let i = 0; i < tokens; i++) assert.ok(engine.state.cards[id(`m${i}`)], "no token was destroyed");
      assert.equal(engine.getCardPlayability(P1, id("cheap")).numericCost, 0, "the engine reports the reduced cost");
      engine.perform({ type: "playCard", playerId: P1, cardId: id("cheap") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.cards[id("cheap")].zone, "play", "the 1-cost card was free");
    });
  }

  test("choosing 1 with one token destroys it and reduces by 2", () => {
    const { engine, id } = startRecycling(1, 1);
    assert.equal(engine.state.cards[id("m0")], undefined, "the token was destroyed (a token ceases to exist)");
    assert.equal(engine.getCardPlayability(P1, id("cheap")).numericCost, 0);
  });
});
