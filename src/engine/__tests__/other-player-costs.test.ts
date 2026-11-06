// E3c: a cost step ANOTHER player decides or pays (`otherPlayerChooses`), a cost the payer divides (`distribute`), the
// pay loop as a cost (`alternatingPay`), and a coin flipped as a number that sizes a pick (`coinFlip`). These tests drive
// synthetic cards; the printed cards have their own clause tests. See BEHAVIORS.md "E3 cost model" ("Costs another player
// decides").

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

const sel = (id: string) => ({ type: "selected", id });
const spent = (owner: string, n: number): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `s${owner}${i}`,
    def: resourceCard({ name: `S${owner}${i}` }),
    owner,
    attachedToKey: owner === P1 ? "__factionA" : "__factionB"
  }));
const ready = (owner: string, n: number): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `r${owner}${i}`, def: resourceCard({ name: `R${owner}${i}` }), owner }));
const attachedTo = (engine: SpoilsEngine, id: string) => engine.state.cards[id].attachedTo;
const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;

/** A character whose ability `go` has the given costs / targets / effects. */
function source(over: Record<string, unknown>) {
  return character({
    name: "Src",
    strength: 2,
    life: 3,
    behavior: { abilities: [{ id: "go", type: "activated", effects: [], ...over }] } as never
  });
}
const activate = (engine: SpoilsEngine, cardId: string, extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "activateAbility", playerId: P1, cardId, abilityId: "go", ...extra } as never);
const answer = (engine: SpoilsEngine, playerId: string, choice: Record<string, unknown>) =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);

const detachStep = {
  type: "otherPlayerChooses",
  chooser: "opponent",
  declaration: { id: "det", selector: { owner: "opponent", zone: "play", type: "resource", attachedToFaction: true }, count: 2, optional: true },
  effects: [{ type: "forEach", selected: "det", effects: [{ type: "detach", target: sel("__candidate") }] }]
};

describe("E3c — a cost another player decides", () => {
  const board = (extra: CardPlacement[] = []) =>
    buildGame({
      cards: [
        { key: "src", def: source({ costs: [{ type: "deplete", target: "source" }, detachStep], effects: [{ type: "draw", player: "controller", amount: 0 }] }), owner: P1 },
        ...spent(P2, 3),
        ...spent(P1, 1),
        ...extra
      ]
    });

  test("the steps written before it are paid, then the other player is asked; their answer finishes the use", () => {
    const { engine, id } = board();
    activate(engine, id("src"));
    assert.equal(engine.state.cards[id("src")].depleted, true, "the deplete before it is already paid");
    assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
    assert.equal(pending(engine)?.playerId, P2, "the opponent decides");
    answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id(`s${P2}0`), id(`s${P2}1`)] });
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(attachedTo(engine, id(`s${P2}0`)), undefined, "detached as the cost");
    assert.equal(attachedTo(engine, id(`s${P2}1`)), undefined);
    assert.ok(attachedTo(engine, id(`s${P2}2`)), "not chosen: stays attached");
    assert.ok(attachedTo(engine, id(`s${P1}0`)), "the payer's own resource is untouched");
    assert.equal(engine.state.cards[id("src")].depleted, true, "the deplete was paid once, not again by the re-run");
    resolvePendingResponses(engine);
    assert.equal(pending(engine), undefined);
  });

  test("the opponent's answer cannot be forged in the action", () => {
    const { engine, id } = board();
    activate(engine, id("src"), { selected: { det: [id(`s${P2}0`)] } });
    assert.equal(pending(engine)?.playerId, P2, "still asked: a pick riding in the action is not their answer");
    assert.ok(attachedTo(engine, id(`s${P2}0`)), "nothing detached by the forged pick");
  });

  test("an illegal answer is refused and the question stays open", () => {
    const { engine, id } = board();
    activate(engine, id("src"));
    assert.throws(() => answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id(`s${P1}0`)] }), /Illegal target/);
    assert.throws(() => answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id(`s${P2}0`), id(`s${P2}1`), id(`s${P2}2`)] }), /requires/);
    assert.equal(pending(engine)?.playerId, P2, "still waiting for a legal answer");
    answer(engine, P2, { kind: "chooserSelectsTarget", selected: [] });
    assert.equal(engine.state.pendingChoice, undefined, "choosing none is a legal answer to 'may detach up to 2'");
    assert.ok(attachedTo(engine, id(`s${P2}0`)));
  });

  test("a choice of the payer's own before it is asked once and its card is destroyed once, not again by the re-run", () => {
    const destroyOne = { type: "destroy", target: { type: "random", selector: { controller: "self", type: "item" } } };
    const { engine, id } = buildGame({
      cards: [
        { key: "src", def: source({ costs: [destroyOne, detachStep] }), owner: P1 },
        { key: "i1", def: item({ name: "I1" }), owner: P1 },
        { key: "i2", def: item({ name: "I2" }), owner: P1 },
        ...spent(P2, 2)
      ]
    });
    activate(engine, id("src"));
    assert.equal(pending(engine)?.playerId, P1, "the payer chooses which item to destroy");
    answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("i2")] });
    assert.equal(engine.state.cards[id("i2")].zone, "discard", "destroyed before the opponent is asked");
    assert.equal(engine.state.cards[id("i1")].zone, "play");
    assert.equal(pending(engine)?.playerId, P2);
    answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id(`s${P2}0`)] });
    assert.equal(pending(engine), undefined, "nobody is asked twice");
    assert.equal(engine.state.cards[id("i1")].zone, "play", "the re-run did not destroy a second item");
    assert.equal(attachedTo(engine, id(`s${P2}0`)), undefined);
  });

  test("an optional pick with nothing to pick asks nobody", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "src", def: source({ costs: [{ type: "deplete", target: "source" }, detachStep] }), owner: P1 }]
    });
    activate(engine, id("src"));
    assert.equal(pending(engine), undefined, "the opponent has no attached resource");
    assert.equal(engine.state.cards[id("src")].depleted, true);
  });

  test("a mandatory pick with nothing to pick makes the use illegal, and nothing is paid", () => {
    const mandatory = { ...detachStep, declaration: { ...detachStep.declaration, optional: false, count: 1 } };
    const { engine, id } = buildGame({
      cards: [{ key: "src", def: source({ costs: [{ type: "deplete", target: "source" }, mandatory] }), owner: P1 }]
    });
    assert.throws(() => activate(engine, id("src")), /cannot be paid|nothing legal/);
    assert.equal(engine.state.cards[id("src")].depleted ?? false, false, "the deplete was not paid for a use that is illegal");
  });

  test("a mandatory pick that every option leaves unpayable is refused up front (the chooser would have no legal answer)", () => {
    // Pay 2 after the opponent's resource goes... the caster's own resources: picking any of them leaves 1 to pay 2 with.
    const own = {
      type: "otherPlayerChooses",
      chooser: "controller",
      declaration: { id: "res", selector: { controller: "self", zone: "play", type: "resource" }, count: 1 },
      effects: [{ type: "moveCard", target: sel("res"), to: "hand" }]
    };
    const { engine, id } = buildGame({
      cards: [{ key: "src", def: source({ costs: [own, { type: "payResources", amount: 2 }] }), owner: P1 }, ...ready(P1, 2)]
    });
    assert.throws(() => activate(engine, id("src")), /cannot be paid/);
    assert.equal(pending(engine), undefined);
    const ok = buildGame({
      cards: [{ key: "src", def: source({ costs: [own, { type: "payResources", amount: 2 }] }), owner: P1 }, ...ready(P1, 3)]
    });
    activate(ok.engine, ok.id("src"));
    assert.equal(pending(ok.engine)?.playerId, P1, "with a spare resource the payer is asked");
  });

  test("a 'may' step is a yes / no for the other player; yes runs its effects, decline pays nothing", () => {
    const may = {
      type: "otherPlayerChooses",
      chooser: "opponent",
      may: true,
      effects: [{ type: "draw", player: "opponent", amount: 1 }]
    };
    for (const yes of [true, false]) {
      const { engine, id } = buildGame({
        cards: [
          { key: "src", def: source({ costs: [may] }), owner: P1 },
          { key: "d1", def: character({ name: "D1" }), owner: P2, zone: "deck" }
        ]
      });
      activate(engine, id("src"));
      assert.equal(pending(engine)?.kind, "chooserSelectsOption");
      assert.equal(pending(engine)?.playerId, P2);
      answer(engine, P2, { kind: "chooserSelectsOption", index: yes ? 1 : 0 });
      assert.equal(engine.state.players[P2].hand.length, yes ? 1 : 0, yes ? "accepted: the effects ran as the cost was paid" : "declined: nothing happened");
    }
  });
});

describe("E3c — a cost the payer divides (`distribute`)", () => {
  const dist = {
    type: "distribute",
    selected: "src",
    amount: { type: "variable", id: "x" },
    maxShare: { type: "counter", target: sel("__candidate"), counter: "token" },
    effects: [{ type: "removeCounter", target: sel("__candidate"), counter: "token", amount: { type: "variable", id: "__amount" } }]
  };
  const board = (tokens: [number, number]) =>
    buildGame({
      cards: [
        {
          key: "t",
          def: tactic({
            name: "Divide",
            behavior: {
              abilities: [
                {
                  id: "go",
                  type: "activated",
                  variableBounds: { x: { min: 0, max: 5 } },
                  targets: [{ id: "src", selector: { controller: "self", zone: "play" }, count: 9, optional: true }],
                  costs: [dist],
                  effects: []
                }
              ]
            } as never
          }),
          owner: P1,
          zone: "hand"
        },
        { key: "a", def: character({ name: "A" }), owner: P1, counters: { token: tokens[0] } },
        { key: "b", def: character({ name: "B" }), owner: P1, counters: { token: tokens[1] } }
      ]
    });
  const play = (b: ReturnType<typeof board>, x: number) =>
    b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("t"), selected: { src: [b.id("a"), b.id("b")] }, variables: { x } } as never);

  test("the payer is asked for the division as the card is played; nothing is removed until it is made", () => {
    const b = board([2, 1]);
    play(b, 3);
    assert.equal(pending(b.engine)?.kind, "distributeAmong");
    assert.equal(b.engine.state.cards[b.id("a")].counters.token, 2);
    answer(b.engine, P1, { kind: "distributeAmong", shares: { [b.id("a")]: 2, [b.id("b")]: 1 } });
    assert.equal(b.engine.state.cards[b.id("a")].counters.token ?? 0, 0);
    assert.equal(b.engine.state.cards[b.id("b")].counters.token ?? 0, 0);
    assert.notEqual(b.engine.state.cards[b.id("t")].zone, "hand", "the card is played");
  });

  test("the picked cards must hold X: more than they hold refuses the play", () => {
    const b = board([1, 1]);
    assert.throws(() => play(b, 3), /cannot be paid|cannot give/);
    assert.equal(b.engine.state.cards[b.id("t")].zone, "hand");
  });

  test("a division that does not add up to X, or takes more than a card holds, is refused and the question stays", () => {
    const b = board([2, 1]);
    play(b, 3);
    assert.throws(() => answer(b.engine, P1, { kind: "distributeAmong", shares: { [b.id("a")]: 2 } }), /exactly/);
    assert.throws(() => answer(b.engine, P1, { kind: "distributeAmong", shares: { [b.id("a")]: 3 } }), /at most|exactly/);
    assert.equal(pending(b.engine)?.kind, "distributeAmong");
  });
});

describe("E3c — the pay loop as a cost (`alternatingPay`)", () => {
  const loop = { type: "alternatingPay", first: "controller", opponent: "opponent", cost: [{ type: "payResources", amount: 1 }] };
  const board = (mine: number, theirs: number, numeric = 0) =>
    buildGame({
      cards: [
        { key: "t", def: tactic({ name: "Loop", cost: numeric, behavior: { abilities: [{ id: "go", type: "activated", costs: [loop], effects: [{ type: "draw", player: "controller", amount: { type: "variable", id: "__paidByFirst" } }] }] } as never }), owner: P1, zone: "hand" },
        ...ready(P1, mine),
        ...ready(P2, theirs),
        ...Array.from({ length: 5 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const }))
      ]
    });
  const play = (b: ReturnType<typeof board>) => b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("t") } as never);

  test("each payment is spent at once and the tallies reach the effect", () => {
    const b = board(4, 4);
    play(b);
    assert.equal(pending(b.engine)?.playerId, P1);
    answer(b.engine, P1, { kind: "alternatingPay", pay: true });
    assert.equal(b.engine.getAvailableResourceCount(P1), 3, "spent at once");
    assert.equal(pending(b.engine)?.playerId, P2);
    answer(b.engine, P2, { kind: "alternatingPay", pay: true });
    answer(b.engine, P1, { kind: "alternatingPay", pay: true });
    answer(b.engine, P2, { kind: "alternatingPay", pay: false });
    assert.equal(pending(b.engine), undefined);
    resolvePendingResponses(b.engine);
    assert.equal(b.engine.state.players[P1].hand.length, 2, "drew as many as P1 paid");
  });

  test("the caster keeps back what the card's own numeric cost needs (it is paid last)", () => {
    const b = board(3, 4, 2);
    play(b);
    answer(b.engine, P1, { kind: "alternatingPay", pay: true });
    answer(b.engine, P2, { kind: "alternatingPay", pay: true });
    assert.equal(pending(b.engine), undefined, "one resource is left and the 2 cost still has to be paid from it: the loop ends");
  });
});

describe("E3c — a coin flipped as a number (`coinFlip`)", () => {
  const smash = tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "hs",
          type: "activated",
          variables: { x: { type: "coinFlip", win: 2, lose: 1 } },
          targets: [{ id: "picked", selector: { zone: "play", type: "item" }, count: { type: "variable", id: "x" }, optional: true }],
          effects: [{ type: "forEach", selected: "picked", effects: [{ type: "destroy", target: sel("__candidate") }] }]
        }
      ]
    } as never
  });
  const coin = item({
    name: "Two Coin",
    behavior: {
      abilities: [
        {
          id: "r",
          type: "replacement",
          replaces: { event: "coinFlip", result: "lose" },
          optionalCost: [{ type: "moveSelected", id: "self", player: "controller", selector: { controller: "self", name: "__self", zone: "play" }, count: 1, to: "deck", shuffle: true }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    } as never
  });
  const board = (random: number, withCoin: boolean) =>
    buildGame({
      random: () => random,
      cards: [
        { key: "hs", def: smash, owner: P1, zone: "hand" },
        { key: "i1", def: item({ name: "I1" }), owner: P2 },
        { key: "i2", def: item({ name: "I2" }), owner: P2 },
        ...(withCoin ? [{ key: "coin", def: coin, owner: P1 }] : []),
        { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" as const }
      ]
    });
  const flips = (engine: SpoilsEngine) => engine.getLog().filter(entry => (entry.event as { type?: string } | undefined)?.type === "coinFlipped");
  const start = (b: ReturnType<typeof board>) => b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("hs") } as never);
  const pick = (b: ReturnType<typeof board>, keys: string[]) =>
    answer(b.engine, P1, { kind: "selectDeployTargets", selected: { picked: keys.map(b.id) } });

  test("a won flip makes X = 2 and a lost flip X = 1, and the flip is logged once", () => {
    const won = board(0.1, false);
    start(won);
    assert.equal(flips(won.engine).length, 1);
    pick(won, ["i1", "i2"]);
    resolvePendingResponses(won.engine);
    assert.equal(won.engine.state.cards[won.id("i2")].zone, "discard", "X = 2: both items picked");
    const lost = board(0.9, false);
    start(lost);
    assert.throws(() => pick(lost, ["i1", "i2"]), /requires/);
    pick(lost, ["i1"]);
    resolvePendingResponses(lost.engine);
    assert.equal(lost.engine.state.cards[lost.id("i1")].zone, "discard", "X = 1");
    assert.equal(flips(lost.engine).length, 1, "the resumed play does not flip again");
  });

  test("a lost flip offers the coin's reflip BEFORE the pick; reflipping settles X, declining keeps X = 1", () => {
    const declined = board(0.9, true);
    start(declined);
    assert.equal(pending(declined.engine)?.kind, "coinFlipReplace");
    assert.equal(flips(declined.engine).length, 0, "the flip is not logged until it is settled");
    answer(declined.engine, P1, { kind: "coinFlipReplace", reflip: false });
    assert.equal(pending(declined.engine)?.kind, "selectDeployTargets", "then the pick is asked");
    assert.equal(flips(declined.engine).length, 1);
    assert.throws(() => pick(declined, ["i1", "i2"]), /requires/);

    // Reflipping with the same rigged RNG loses again: X stays 1, the coin has been shuffled into the deck and the rider drew a card.
    const again = board(0.9, true);
    start(again);
    answer(again.engine, P1, { kind: "coinFlipReplace", reflip: true });
    assert.equal(again.engine.state.cards[again.id("coin")].zone, "deck", "the coin paid its cost");
    assert.equal(pending(again.engine)?.kind, "selectDeployTargets");
  });
});
