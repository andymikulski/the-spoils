// End-to-end, with the real printings: Pant Swipe (the loot is face-down in the void, the Pant Swipe player looks and
// deploys it ignoring thresholds, the owner may not look) and Arcane Escrow (discard replacement, "you may look at
// cards voided by this card" via ContinuousAbility.mayLookAtVoided, Develop-Rule draw replacement, WITHDRAW).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { activate, bank, buildGame, character, developFaction, play, resolvePendingResponses, P1, P2 } from "./per-card/_harness.js";
import { zoneOf } from "./clauses/_board.js";
import { declineAll, drain, printing } from "./clauses/_clause.js";
import { developDraw } from "./support/develop.js";

const PANT_SWIPE_VOIDS = "3a9ab0e7-b3f3-4956-8f82-be8f0916a9da";
const ARCANE_ESCROW = "ae2a8991-a53d-4ac4-a5d8-707b812babae";

describe("Pant Swipe (face-down void printing): look and deploy without the threshold", () => {
  function swipeGame() {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random: () => 0,
      cards: [
        { key: "swipe", def: printing(PANT_SWIPE_VOIDS), owner: P1, zone: "hand" },
        ...bank("deception", 8, P1),
        // a threshold P1 cannot meet (they only have deception resources)
        ...["o1", "o2", "o3", "o4", "o5"].map(key => ({
          key,
          def: character({ name: key, cost: 1, threshold: "rrr" }),
          owner: P2,
          zone: "deck" as const
        }))
      ] as never
    });
    play(g.engine, P1, g.id("swipe"));
    resolvePendingResponses(g.engine);
    return g;
  }

  test("top 4 go face-down into the void; only the Pant Swipe player may look", () => {
    const g = swipeGame();
    for (const key of ["o1", "o2", "o3", "o4"]) {
      assert.equal(zoneOf(g.engine, g.id(key)), "void");
      assert.equal(g.engine.state.cards[g.id(key)].faceDown, true);
      assert.equal(g.engine.canViewerSeeVoidedCard(P1, g.id(key)), true);
      assert.equal(g.engine.canViewerSeeVoidedCard(P2, g.id(key)), false);
    }
    assert.equal(zoneOf(g.engine, g.id("o5")), "deck");
  });

  test("they deploy as though in hand even though the threshold is unmet", () => {
    const g = swipeGame();
    const listed = g.engine.getPlayableFromOutsideHand(P1);
    assert.equal(listed.length, 4);
    assert.ok(listed.every(l => l.ignoreThreshold && l.playability.playable));
    assert.equal(g.engine.getPlayableFromOutsideHand(P2).length, 0, "the owner gets no play grant");
    const target = g.id("o1");
    play(g.engine, P1, target);
    drain(g.engine, declineAll);
    assert.equal(zoneOf(g.engine, target), "play");
    assert.equal(g.engine.state.cards[target].controllerId, P1);
  });
});

describe("Arcane Escrow", () => {
  function escrowGame(extra: unknown[] = []) {
    return buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random: () => 0,
      cards: [
        { key: "ae", def: printing(ARCANE_ESCROW), owner: P1, zone: "play" },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" },
        { key: "h3", def: character({ name: "H3" }), owner: P1, zone: "hand" },
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        ...bank("greed", 4, P1),
        ...extra
      ] as never
    });
  }

  /** WITHDRAW: pay 1, draw, discard 2 - answering every Escrow replacement offer with `accept`. */
  function withdraw(g: ReturnType<typeof escrowGame>, pick: string[], accept: boolean) {
    activate(g.engine, P1, g.id("ae"), "ae-withdraw");
    resolvePendingResponses(g.engine);
    drain(g.engine, pc => {
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: pick.map(k => g.id(k)) };
      if (pc.kind === "replacementChoice") return { kind: "replacementChoice", apply: accept };
      return declineAll(pc as never);
    });
  }

  test("WITHDRAW + discard replacement: accepted discards go face-down to the void, voided by Escrow", () => {
    const g = escrowGame();
    withdraw(g, ["h1", "h2"], true);
    assert.equal(zoneOf(g.engine, g.id("d1")), "hand", "WITHDRAW drew a card");
    for (const k of ["h1", "h2"]) {
      const c = g.engine.state.cards[g.id(k)];
      assert.equal(c.zone, "void");
      assert.equal(c.faceDown, true);
      assert.equal(c.voidedBy, g.id("ae"));
    }
    assert.equal(zoneOf(g.engine, g.id("h3")), "hand");
  });

  test("declining the replacement discards normally", () => {
    const g = escrowGame();
    withdraw(g, ["h1", "h2"], false);
    assert.equal(zoneOf(g.engine, g.id("h1")), "discard");
    assert.equal(zoneOf(g.engine, g.id("h2")), "discard");
  });

  test("the Escrow controller may look at cards voided by it; the opponent may not", () => {
    const g = escrowGame();
    withdraw(g, ["h1", "h2"], true);
    assert.equal(g.engine.canViewerSeeVoidedCard(P1, g.id("h1")), true);
    assert.equal(g.engine.canViewerSeeVoidedCard(P2, g.id("h1")), false);
  });

  test("looking is a standing permission: needs Escrow in play and controlled by the viewer; other cards stay hidden", () => {
    const g = escrowGame([{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "void" }]);
    const other = g.engine.state.cards[g.id("other")];
    other.faceDown = true;
    other.faceDownBy = P2;
    other.voidedBy = g.id("h3");
    withdraw(g, ["h1", "h2"], true);
    assert.equal(g.engine.canViewerSeeVoidedCard(P1, g.id("other")), false, "not voided by this card");
    // Take away the recorded-voider path to isolate the standing permission.
    g.engine.state.cards[g.id("h1")].faceDownBy = undefined;
    assert.equal(g.engine.canViewerSeeVoidedCard(P1, g.id("h1")), true, "Escrow in play, controlled by P1");
    g.engine.state.cards[g.id("ae")].zone = "discard" as never;
    assert.equal(g.engine.canViewerSeeVoidedCard(P1, g.id("h1")), false, "Escrow left play");
    g.engine.state.cards[g.id("ae")].zone = "play" as never;
    g.engine.state.cards[g.id("ae")].controllerId = P2;
    assert.equal(g.engine.canViewerSeeVoidedCard(P1, g.id("h1")), false, "someone else controls it now");
    assert.equal(g.engine.canViewerSeeVoidedCard(P2, g.id("h1")), true, "its new controller may look");
  });

  test("Develop Rule draw: may put a card voided by Escrow into hand instead of drawing", () => {
    const g = escrowGame();
    withdraw(g, ["h1", "h2"], true);
    developDraw(g.engine, P1);
    assert.equal(g.engine.state.pendingChoice?.kind, "mayPay");
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } });
    assert.equal(g.engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("h1")] } });
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("h1")), "hand");
    assert.equal(g.engine.state.cards[g.id("h1")].faceDown ?? false, false);
  });

  test("Develop Rule draw with nothing voided by Escrow just draws", () => {
    const g = escrowGame();
    developDraw(g.engine, P1);
    resolvePendingResponses(g.engine);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("d1")), "hand");
  });
});
