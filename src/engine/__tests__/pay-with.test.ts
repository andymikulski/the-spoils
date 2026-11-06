import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { P1, bank, buildGame, developFaction, tactic } from "./per-card/_harness.js";
import { flipUpNow } from "./clauses/_clause.js";

// A face-down tactic whose FLIP UP costs 2, with four more resources beside it.
const flipper = () => ({
  ...tactic({ name: "Pay Test", cost: 3, threshold: "o", flipUp: { cost: 2, threshold: "o" } }),
  id: "pay-with-flipper"
});

function board() {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fd", def: flipper(), owner: P1, zone: "play", faceDown: true },
      ...bank("obsession", 4, P1)
    ]
  });
}

const attached = (b: ReturnType<typeof board>, id: string) => b.engine.state.cards[id].attachedTo !== undefined;

describe("paying a numeric cost with chosen resources (payWith)", () => {
  test("getPaymentOptions reports the amount and the resources, the flipping card included", () => {
    const b = board();
    const options = b.engine.getPaymentOptions({ type: "flipUp", playerId: P1, cardId: b.id("fd") });
    assert.equal(options?.amount, 2);
    assert.equal(options?.candidates.length, 5, "four banked resources and the face-down card itself");
    assert.ok(options?.candidates.includes(b.id("fd")));
  });

  test("getPaymentOptions changes nothing", () => {
    const b = board();
    const before = JSON.stringify(b.engine.state);
    b.engine.getPaymentOptions({ type: "flipUp", playerId: P1, cardId: b.id("fd") });
    assert.equal(JSON.stringify(b.engine.state), before);
  });

  test("the named resources are the ones spent", () => {
    const b = board();
    const bank = b.engine.getAvailableResourceIds(P1).filter((id) => id !== b.id("fd"));
    const picked = [bank[3], bank[2]];
    flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("fd"), payWith: picked });
    assert.ok(picked.every((id) => attached(b, id)), "the chosen two are spent");
    assert.ok(bank.filter((id) => !picked.includes(id)).every((id) => !attached(b, id)), "the others are untouched");
  });

  test("the flipping card may pay for itself, and then costs one less other resource", () => {
    const b = board();
    const [other] = b.engine.getAvailableResourceIds(P1).filter((id) => id !== b.id("fd"));
    flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("fd"), payWith: [b.id("fd"), other] });
    assert.equal(b.engine.state.cards[b.id("fd")].faceDown, false);
    assert.ok(attached(b, other));
    const spentOthers = b.engine.getAvailableResourceIds(P1).length;
    assert.equal(spentOthers, 3, "only one banked resource was spent besides the card itself");
  });

  test("naming fewer than the cost: the engine fills the rest", () => {
    const b = board();
    const [first] = b.engine.getAvailableResourceIds(P1).filter((id) => id !== b.id("fd")).reverse();
    flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("fd"), payWith: [first] });
    assert.ok(attached(b, first));
    assert.equal(b.engine.getAvailableResourceIds(P1).length, 2, "two of the four banked resources spent; the flipped card left the pool");
  });

  test("a card that is not an available resource is refused and nothing is paid", () => {
    const b = board();
    const before = b.engine.getAvailableResourceIds(P1).length;
    assert.throws(
      () => b.engine.perform({ type: "flipUp", playerId: P1, cardId: b.id("fd"), payWith: ["nope"] } as never),
      /can't be spent/
    );
    assert.equal(b.engine.getAvailableResourceIds(P1).length, before);
    assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true);
  });

  test("more than the cost is refused", () => {
    const b = board();
    const three = b.engine.getAvailableResourceIds(P1).slice(0, 3);
    assert.throws(
      () => b.engine.perform({ type: "flipUp", playerId: P1, cardId: b.id("fd"), payWith: three } as never),
      /no more than/
    );
  });

  test("a hand play pays with the chosen resources too", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hand", def: { ...tactic({ name: "Hand Pay", cost: 2, threshold: "o" }), id: "pay-with-hand" }, owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    const ids = b.engine.getAvailableResourceIds(P1);
    const picked = [ids[3], ids[1]];
    const options = b.engine.getPaymentOptions({ type: "playCard", playerId: P1, cardId: b.id("hand") });
    assert.equal(options?.amount, 2);
    assert.deepEqual([...(options?.candidates ?? [])].sort(), [...ids].sort());
    flipUpNow(b.engine, { type: "playCard", playerId: P1, cardId: b.id("hand"), payWith: picked });
    assert.ok(picked.every((id) => b.engine.state.cards[id].attachedTo !== undefined));
    assert.equal(b.engine.getAvailableResourceIds(P1).length, 2);
  });

  test("a free card has no payment to choose", () => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "hand", def: { ...tactic({ name: "Free One", cost: 0, threshold: "o" }), id: "pay-with-free" }, owner: P1, zone: "hand" },
        ...bank("obsession", 2, P1)
      ]
    });
    assert.equal(b.engine.getPaymentOptions({ type: "playCard", playerId: P1, cardId: b.id("hand") }), undefined);
  });
});
