// Classic (2-player) checks for cards whose encoding names "the opponent" or "the picked card's controller".
//
// A multiplayer audit flagged Irresistible Bribe, Scrag, Caboodling Gladhander and Needless Beating from the catalog's
// archival `text`. Each printing plays exactly as printed on its own card (docs/CARD-DATA.md): every printing of those
// cards that prints "your opponent" is correctly encoded with "opponent" (a pick of your own card still pays / counts /
// checks your opponent), and the printings that print "that character's controller" use `controllerOf`. These tests pin
// both. Lecram's two looks and the "that character's controller" printings of Redonkulous / Smothering Corpulence were
// the real gaps.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  cardDef,
  developFaction,
  bank,
  character,
  play,
  P1,
  P2,
  resolvePendingResponses,
  developDrawChoice
} from "./_harness.js";
import { endTurn } from "../clauses/_turn.js";

function drain(
  engine: ReturnType<typeof buildGame>["engine"],
  answerFor: (pc: { kind: string; playerId: string; [k: string]: unknown }) => unknown,
  budget = 40
): void {
  let n = 0;
  if (!engine.state.pendingChoice && engine.state.responseWindow?.kind === "endTurn") resolvePendingResponses(engine);
  while (engine.state.pendingChoice && n++ < budget) {
    const pc = engine.state.pendingChoice as { kind: string; playerId: string };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: developDrawChoice(pc) ?? answerFor(pc) } as never);
    resolvePendingResponses(engine);
  }
}

const declineAll = (pc: { kind: string; [k: string]: unknown }) => {
  switch (pc.kind) {
    case "mayPay":
      return { kind: "mayPay", pay: false };
    case "chooserSelectsTarget":
      return { kind: "chooserSelectsTarget", selected: [] };
    case "orderTriggers":
      return { kind: "orderTriggers", next: ((pc.triggers as unknown[]) ?? [])[0] };
    case "reorderDeck":
      return { kind: "reorderDeck", order: pc.cardIds };
    default:
      return { kind: pc.kind, accept: false };
  }
};

describe("Irresistible Bribe — printed \"Your opponent's faction gains X influence\"", () => {
  for (const set of ["Open Beta", "1st Edition", "2nd Edition"]) {
    test(`${set}: your opponent gains X when you bribe away your own character, and also when you bribe theirs`, () => {
      for (const owner of [P1, P2]) {
        const { engine, id } = buildGame({
          playerA: { faction: developFaction() },
          cards: [
            { key: "ib", def: cardDef(set, "Irresistible Bribe"), owner: P1, zone: "hand" },
            { key: "c", def: character({ name: "C", strength: 2 }), owner, zone: "play" },
            ...bank("greed", 6, P1)
          ]
        });
        const mine = engine.state.players[P1].influence;
        const theirs = engine.state.players[P2].influence;
        play(engine, P1, id("ib"), { selected: { c: [id("c")] } });
        assert.equal(engine.state.cards[id("c")].zone, "discard");
        assert.equal(engine.state.players[P1].influence, mine);
        assert.equal(engine.state.players[P2].influence, theirs + 2);
      }
    });
  }
});

describe("Scrag — printed \"if your opponent has at least X cards in their discard pile\"", () => {
  const run = (set: string, owner: typeof P1 | typeof P2, discardOwner: typeof P1 | typeof P2) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sc", def: cardDef(set, "Scrag"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 2 }), owner, zone: "play" },
        ...["d1", "d2"].map(k => ({ key: k, def: character({ name: k }), owner: discardOwner, zone: "discard" as const })),
        ...bank("deception", 6, P1)
      ]
    });
    play(engine, P1, id("sc"), { selected: { c: [id("c")] } });
    drain(engine, declineAll);
    return engine.state.cards[id("c")].zone;
  };

  for (const set of ["Open Beta", "1st Edition", "2nd Edition"]) {
    test(`${set}: counts YOUR OPPONENT's discard pile, whoever controls the picked character`, () => {
      assert.equal(run(set, P1, P2), "discard", "own character, opponent has 2 cards in discard");
      assert.equal(run(set, P2, P2), "discard", "their character, opponent has 2 cards in discard");
      assert.equal(run(set, P1, P1), "play", "own character, only I have cards in discard");
      assert.equal(run(set, P2, P1), "play", "their character, only I have cards in discard");
    });
  }

  test("Decade of Deckadence: counts the PICKED CHARACTER'S CONTROLLER's discard pile", () => {
    const set = "Decade of Deckadence";
    assert.equal(run(set, P1, P1), "discard", "own character, I have 2 cards in discard");
    assert.equal(run(set, P1, P2), "play", "own character, only the opponent has cards in discard");
    assert.equal(run(set, P2, P2), "discard", "their character, they have 2 cards in discard");
    assert.equal(run(set, P2, P1), "play", "their character, only I have cards in discard");
  });
});

describe("Caboodling Gladhander — Seed prints \"your opponent's faction\", Seed Saga \"that character's controller's faction\"", () => {
  const run = (set: string, owner: typeof P1 | typeof P2) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "cg", def: cardDef(set, "Caboodling Gladhander"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", strength: 3 }), owner, zone: "play" },
        ...bank("greed", 10, P1)
      ]
    });
    const before = { mine: engine.state.players[P1].influence, theirs: engine.state.players[P2].influence };
    play(engine, P1, id("cg"), { selected: { c: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[id("c")].zone, "discard");
    return { engine, before };
  };

  test("Seed: your opponent gains the influence for either side's character", () => {
    for (const owner of [P1, P2]) {
      const { engine, before } = run("Seed", owner);
      assert.equal(engine.state.players[P1].influence, before.mine);
      assert.equal(engine.state.players[P2].influence, before.theirs + 3);
    }
  });

  test("Seed Saga: the picked character's controller gains the influence", () => {
    const own = run("Seed Saga", P1);
    assert.equal(own.engine.state.players[P1].influence, own.before.mine + 3);
    assert.equal(own.engine.state.players[P2].influence, own.before.theirs);
    const theirs = run("Seed Saga", P2);
    assert.equal(theirs.engine.state.players[P1].influence, theirs.before.mine);
    assert.equal(theirs.engine.state.players[P2].influence, theirs.before.theirs + 3);
  });
});

describe("Needless Beating — printed \"COST: Pick a character\" and \"your opponent's faction\"", () => {
  for (const set of ["1st Edition Part 2", "2nd Edition"]) {
    test(`${set}: a pick of your own character still reads your opponent's influence for the extra damage`, () => {
      const run = (opponentInfluence: number) => {
        const { engine, id } = buildGame({
          playerA: { faction: developFaction() },
          playerB: { influence: opponentInfluence },
          cards: [
            { key: "nb", def: cardDef(set, "Needless Beating"), owner: P1, zone: "hand" },
            { key: "own", def: character({ name: "Own", life: 10 }), owner: P1, zone: "play" },
            { key: "theirs", def: character({ name: "Theirs", life: 10 }), owner: P2, zone: "play" },
            ...bank("rage", 8, P1)
          ]
        });
        play(engine, P1, id("nb"), { selected: { c: [id("own")] } });
        drain(engine, declineAll);
        return { own: engine.state.cards[id("own")].damage ?? 0, theirs: engine.state.cards[id("theirs")].damage ?? 0 };
      };
      assert.deepEqual(run(20), { own: 2, theirs: 0 }, "opponent above 15: just 2 damage");
      assert.deepEqual(run(15), { own: 3, theirs: 0 }, "opponent at 15: 1 additional damage");
      assert.deepEqual(run(10), { own: 3, theirs: 1 }, "opponent at 10: 1 damage to each character your opponent controls");
    });
  }
});

describe("Lecram, Silent Advisor — looks at the top card of a deck", () => {
  const board = (random: () => number) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random,
      cards: [
        { key: "lec", def: cardDef("Seed Saga", "Lecram, Silent Advisor"), owner: P1, zone: "play" },
        ...["a1", "a2"].map(k => ({ key: k, def: character({ name: k }), owner: P1, zone: "deck" as const })),
        ...["b1", "b2"].map(k => ({ key: k, def: character({ name: k }), owner: P2, zone: "deck" as const }))
      ]
    });

  test("at the end of your turn a won coin flip lets you look at the top card of an opponent's deck", () => {
    const { engine, id } = board(() => 0);
    const theirDeck = [...engine.state.players[P2].deck];
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    const pc = engine.state.pendingChoice as { kind: string; playerId: string; deckOwnerId: string; cardIds: string[] } | undefined;
    assert.equal(pc?.kind, "reorderDeck");
    assert.equal(pc?.playerId, P1, "I am the one looking");
    assert.equal(pc?.deckOwnerId, P2, "at the opponent's deck");
    assert.deepEqual(pc?.cardIds, theirDeck.slice(0, 1), "its top card");
    assert.equal(engine.state.cards[id("lec")].zone, "play");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: pc!.cardIds } } as never);
    assert.deepEqual(engine.state.players[P2].deck, theirDeck, "looking leaves the deck as it was");
  });

  test("a lost coin flip looks at nothing", () => {
    const { engine } = board(() => 0.99);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.notEqual(engine.state.pendingChoice?.kind, "reorderDeck", "nothing to look at (the next pending choice is the opponent's turn start)");
  });

  test("at the start of your turn you may look at the top card of your own deck", () => {
    const { engine } = board(() => 0.99);
    const myDeck = [...engine.state.players[P1].deck];
    endTurn(engine, P1);
    endTurn(engine, P2);
    const pc = engine.state.pendingChoice as { kind: string; playerId: string; deckOwnerId: string; cardIds: string[]; upTo?: boolean } | undefined;
    assert.equal(pc?.kind, "reorderDeck");
    assert.equal(pc?.playerId, P1);
    assert.equal(pc?.deckOwnerId, P1);
    assert.equal(pc?.upTo, true, "a \"may\" look: you can decline");
    assert.deepEqual(pc?.cardIds, myDeck.slice(0, 1));
  });
});

describe("Redonkulous — Seed Saga / Decade of Deckadence print \"that character's controller\"", () => {
  const run = (set: string, owner: typeof P1 | typeof P2) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "r", def: cardDef(set, "Redonkulous"), owner: P1, faceDown: true },
        { key: "c", def: character({ name: "C" }), owner, zone: "play" },
        ...["m1", "m2", "m3", "m4", "m5", "m6"].map(k => ({ key: k, def: character({ name: k }), owner: P1, zone: "hand" as const })),
        ...["t1", "t2", "t3"].map(k => ({ key: k, def: character({ name: k }), owner: P2, zone: "hand" as const })),
        ...bank("obsession", 7, P1)
      ]
    });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("r"), selected: { char: [id("c")] } } as never);
    resolvePendingResponses(engine);
    const asked = engine.state.pendingChoice as { kind: string; playerId: string } | undefined;
    const hand = owner === P1 ? ["m1", "m2"] : ["t1", "t2"];
    drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: hand.map(k => id(k)) } : declineAll(pc)
    );
    return { engine, id, asked };
  };

  for (const [set, gone] of [["Seed Saga", "removed"], ["Decade of Deckadence", "void"]] as const) {
    test(`${set}: the controller of the picked character discards 2 (own character: me; their character: them)`, () => {
      const own = run(set, P1);
      assert.equal(own.asked?.playerId, P1);
      assert.equal(own.engine.state.players[P1].hand.length, 4);
      assert.equal(own.engine.state.players[P2].hand.length, 3);
      assert.equal(own.engine.state.cards[own.id("c")].zone, "play", "I still hold more than 3 cards: no removal");

      const theirs = run(set, P2);
      assert.equal(theirs.asked?.playerId, P2);
      assert.equal(theirs.engine.state.players[P1].hand.length, 6);
      assert.equal(theirs.engine.state.players[P2].hand.length, 1);
      assert.equal(theirs.engine.state.cards[theirs.id("c")].zone, gone, "they hold 3 or fewer: the character is removed");
    });
  }
});

describe("Smothering Corpulence (Seed Saga) — \"you and that character's controller remove the top card of your decks\"", () => {
  test("the picked opponent character's controller's deck loses its top card; X is their card minus mine", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "sc", def: cardDef("Seed Saga", "Smothering Corpulence"), owner: P1, zone: "hand" },
        { key: "c", def: character({ name: "C", life: 5 }), owner: P2, zone: "play" },
        { key: "mine", def: character({ name: "Mine", cost: 1 }), owner: P1, zone: "deck" },
        { key: "theirs", def: character({ name: "Theirs", cost: 3 }), owner: P2, zone: "deck" },
        { key: "mine2", def: character({ name: "Mine2", cost: 1 }), owner: P1, zone: "deck" },
        { key: "theirs2", def: character({ name: "Theirs2", cost: 3 }), owner: P2, zone: "deck" },
        ...bank("deception", 6, P1)
      ]
    });
    const mineTop = engine.state.players[P1].deck[0];
    const theirTop = engine.state.players[P2].deck[0];
    play(engine, P1, id("sc"), { selected: { c: [id("c")] } });
    drain(engine, declineAll);
    assert.equal(engine.state.cards[mineTop].zone, "removed");
    assert.equal(engine.state.cards[theirTop].zone, "removed");
    const costOf = (cardId: string) => engine.getDefinition(cardId).cost ?? 0;
    const x = costOf(theirTop) - costOf(mineTop);
    assert.equal(engine.getStat(id("c"), "life"), 5 - Math.max(0, x));
  });
});
