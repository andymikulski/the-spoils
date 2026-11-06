// Batch r11-general-loops-bidding, part 2 (docs/TESTING.md): CR 413 Bidding and
// CR 414 Action Loops. Written from the wording of the Comprehensive Rules.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import { buildGame, character, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { refused, rule, ruleExempt, ruleOpen } from "./_rule.js";
import { settleTurnStart } from "../support/develop.js";

const ACTIVATED = (effects: unknown[]) =>
  ({ abilities: [{ id: "go", type: "activated", effects }] }) as CardDefinition["behavior"];

// ---------------------------------------------------------------------------
// CR 413 — bidding. The engine's only bidding is the `auctionForCard` effect
// (Auction House): a character is up for bid, bids are `auctionBid` choices.
// ---------------------------------------------------------------------------

type Pid = typeof P1 | typeof P2;

interface AuctionOptions {
  /** Detached resources each player controls (a bid is capped by this). */
  p1: number;
  p2: number;
  /** Whose turn it is. */
  active?: Pid;
  /** Whose deck is revealed (the character up for bid is in it). */
  revealFor?: "controller" | "opponent";
}

function auctionBoard(options: AuctionOptions) {
  const active = options.active ?? P1;
  const house = character({
    name: "Auction Block",
    behavior: ACTIVATED([{ type: "auctionForCard", revealFor: options.revealFor ?? "controller" }])
  });
  const deckOwner: Pid = (options.revealFor ?? "controller") === "controller" ? active : active === P1 ? P2 : P1;
  const resources = (owner: Pid, n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `res-${owner}-${i}`, def: resourceCard({ name: `Res ${owner} ${i}` }), owner }));
  const built = buildGame({
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "house", def: house, owner: active },
      { key: "skipped", def: tactic({ name: "Skipped" }), owner: deckOwner, zone: "deck" as const },
      { key: "prize", def: character({ name: "Prize" }), owner: deckOwner, zone: "deck" as const },
      ...resources(P1, options.p1),
      ...resources(P2, options.p2)
    ]
  });
  built.engine.perform({ type: "activateAbility", playerId: active, cardId: built.id("house"), abilityId: "go" });
  resolvePendingResponses(built.engine);
  return { ...built, initial: { [P1]: options.p1, [P2]: options.p2 } as Record<Pid, number> };
}

type AuctionGame = ReturnType<typeof auctionBoard>;

const prompt = (g: AuctionGame) => {
  const pending = g.engine.state.pendingChoice;
  return pending?.kind === "auctionBid" ? pending : undefined;
};
const bid = (g: AuctionGame, playerId: Pid, amount: number) =>
  g.engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "auctionBid", bid: amount } });
/** Detached resources `owner` has spent since the bidding opened. */
const spent = (g: AuctionGame, owner: Pid) => g.initial[owner] - g.engine.getAvailableResourceCount(owner);
const prize = (g: AuctionGame) => g.engine.state.cards[g.id("prize")]!;

describe("CR 413 — bidding", () => {
  rule("CR 413.1", "players take turns choosing a number or passing: the prompt alternates between the two players after each bid", () => {
    const g = auctionBoard({ p1: 5, p2: 5 });
    assert.equal(prompt(g)?.playerId, P1, "the first bidder");
    bid(g, P1, 1);
    assert.equal(prompt(g)?.playerId, P2, "then the other player");
    bid(g, P2, 2);
    assert.equal(prompt(g)?.playerId, P1, "then back again");
    assert.equal(prompt(g)?.highBid, 2, "the standing bid is shown");
  });

  rule("CR 413.1", "each number chosen must be higher than the last: equal and lower bids are refused, a higher one is accepted", () => {
    const g = auctionBoard({ p1: 5, p2: 5 });
    bid(g, P1, 3);
    refused(() => bid(g, P2, 3), "equal to the standing bid", /exceed/);
    refused(() => bid(g, P2, 2), "lower than the standing bid", /exceed/);
    assert.equal(prompt(g)?.playerId, P2, "the refusals left the bid open");
    bid(g, P2, 4);
    assert.equal(prompt(g)?.highBid, 4, "control: a higher bid is accepted");
  });

  rule("CR 413.1", "boundary: the first bid just has to beat 0, so 1 is a legal opening bid", () => {
    const g = auctionBoard({ p1: 3, p2: 3 });
    bid(g, P1, 1);
    assert.equal(prompt(g)?.highBid, 1);
  });

  rule("CR 413.1", "bidding continues until only 1 player remains: when the other passes, the high bidder wins the bid and puts the character into play", () => {
    const g = auctionBoard({ p1: 3, p2: 3 });
    bid(g, P1, 1);
    bid(g, P2, 2);
    bid(g, P1, 3);
    assert.ok(prompt(g), "two players remain, so the bidding goes on");
    bid(g, P2, 0);
    assert.equal(prompt(g), undefined, "one player remains: the bidding is over");
    assert.equal(prize(g).zone, "play", "the winner got the character");
    assert.equal(prize(g).controllerId, P1, "under the winner's control");
    assert.equal(spent(g, P1), 3, "the winner paid the winning bid");
  });

  rule("CR 413.1", "all other players lose the bid: the loser pays nothing and gets nothing", () => {
    const g = auctionBoard({ p1: 2, p2: 4 });
    bid(g, P1, 1);
    bid(g, P2, 3);
    bid(g, P1, 0);
    assert.equal(prize(g).controllerId, P2, "the high bidder won");
    assert.equal(prize(g).zone, "play");
    assert.equal(spent(g, P2), 3, "the winner pays the winning bid");
    assert.equal(spent(g, P1), 0, "the loser's earlier, lower bid costs nothing");
  });

  rule("CR 413.1", "a bid the other player declines to beat wins at the bid made", () => {
    const g = auctionBoard({ p1: 5, p2: 5 });
    bid(g, P1, 4);
    bid(g, P2, 0);
    assert.equal(prize(g).controllerId, P1);
    assert.equal(spent(g, P1), 4, "paid exactly the bid, not the resources held");
  });

  ruleOpen("CR 413.1", "RQ-r11-3", "when the first bidder passes, the one player who remains wins the bid at once", () => {
    const g = auctionBoard({ p1: 3, p2: 3 });
    bid(g, P1, 0);
    assert.equal(prompt(g), undefined, "only 1 player remains, so the bidding is over");
    assert.equal(prize(g).controllerId, P2, "the remaining player wins the bid");
  });

  rule("CR 413.1a", "bidding begins with the active player: P1 first on P1's turn, P2 first on P2's turn", () => {
    const first = auctionBoard({ p1: 2, p2: 2, active: P1 });
    assert.equal(prompt(first)?.playerId, P1, "P1's turn");
    const second = auctionBoard({ p1: 2, p2: 2, active: P2 });
    assert.equal(prompt(second)?.playerId, P2, "P2's turn");
  });

  rule("CR 413.1a", "the active player bids first even when the revealed deck is the opponent's", () => {
    const g = auctionBoard({ p1: 2, p2: 2, active: P2, revealFor: "opponent" });
    assert.equal(prize(g).ownerId, P1, "the character is from the inactive player's deck");
    assert.equal(prompt(g)?.playerId, P2, "the active player still opens the bidding");
  });

  rule("CR 413.1a", "bidding then continues with the other player (clockwise in a two-player game)", () => {
    const g = auctionBoard({ p1: 2, p2: 2, active: P2 });
    bid(g, P2, 1);
    assert.equal(prompt(g)?.playerId, P1, "the inactive player is next");
  });

  rule("CR 413.1b", "a player who cannot bid higher must pass: with fewer resources than the standing bid every bid is refused and a pass is accepted", () => {
    const g = auctionBoard({ p1: 1, p2: 5 });
    bid(g, P1, 1);
    bid(g, P2, 2);
    assert.equal(prompt(g)?.playerId, P1);
    assert.equal(prompt(g)?.maxBid, 1, "P1 can bid at most 1");
    refused(() => bid(g, P1, 3), "a bid above what P1 can afford", /more than the detached resources/);
    refused(() => bid(g, P1, 1), "a bid that does not beat the standing 2", /exceed/);
    bid(g, P1, 0);
    assert.equal(prize(g).controllerId, P2, "control: passing is accepted and ends it");
  });

  rule("CR 413.1b", "a player with no detached resources cannot bid at all and must pass", () => {
    const g = auctionBoard({ p1: 0, p2: 3 });
    assert.equal(prompt(g)?.maxBid, 0);
    refused(() => bid(g, P1, 1), "a bid with no resources", /more than the detached resources/);
    bid(g, P1, 0);
    assert.equal(prompt(g)?.playerId, P2, "control: the pass was accepted and the other player is asked");
  });

  rule("CR 413.1b", "the number a player may bid is capped by their detached resources: exactly the count is legal, one more is not", () => {
    const g = auctionBoard({ p1: 2, p2: 2 });
    refused(() => bid(g, P1, 3), "bidding one more than the 2 detached resources", /more than the detached resources/);
    bid(g, P1, 2);
    assert.equal(prompt(g)?.highBid, 2, "control: bidding exactly 2 is accepted");
  });

  rule("CR 413.1b", "a player that has passed may not bid again: after P1 passes and P2 bids, the bidding ends without asking P1 to raise", () => {
    const g = auctionBoard({ p1: 5, p2: 5 });
    bid(g, P1, 0);
    assert.equal(prompt(g)?.playerId, P2, "P2 may still bid");
    bid(g, P2, 1);
    assert.equal(prompt(g), undefined, "P1 is not asked again even though they could afford a higher bid");
    assert.equal(prize(g).controllerId, P2, "P2 won with the bid of 1");
    assert.equal(spent(g, P2), 1);
    assert.equal(spent(g, P1), 0);
  });

  rule("CR 413.1b", "a player that was forced to pass (cannot bid) may not bid again either", () => {
    const g = auctionBoard({ p1: 0, p2: 4 });
    bid(g, P1, 0);
    bid(g, P2, 2);
    assert.equal(prompt(g), undefined, "P1 passed for lack of resources and is not asked again");
    assert.equal(prize(g).controllerId, P2);
  });
});

// ---------------------------------------------------------------------------
// CR 414 — action loops
// ---------------------------------------------------------------------------

/** A character whose mandatory trigger gains 1 influence every time its controller's influence changes: once started it never ends. */
const forever = () =>
  character({
    name: "Forever",
    behavior: {
      abilities: [
        { id: "again", type: "triggered", event: "influenceChanged", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }
      ]
    }
  });

const gainOne = (name: string) => tactic({ name, behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: 1 }]) });

function playAndResolve(engine: SpoilsEngine, id: (key: string) => string, key: string): void {
  engine.perform({ type: "playCard", playerId: P1, cardId: id(key) });
  resolvePendingResponses(engine);
}

describe("CR 414 — action loops", () => {
  rule("CR 414.1", "an infinitely repeating loop of mandatory effects ends the game as a draw", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "forever", def: forever(), owner: P1 },
        { key: "spark", def: gainOne("Spark"), owner: P1, zone: "hand" }
      ]
    });
    playAndResolve(engine, id, "spark");
    assert.deepEqual(engine.state.result, { outcome: "draw", winners: [] }, "a loop nobody can stop is a draw");
  });

  rule("CR 414.1", "a chain of effects that ends by itself is not a loop: it just resolves and the game goes on", () => {
    const bounded = character({
      name: "Bounded",
      behavior: {
        abilities: [
          {
            id: "again",
            type: "triggered",
            event: "influenceChanged",
            condition: { type: "numberCompare", left: { type: "counter", target: "source", counter: "token" }, operator: "<", right: 3 },
            effects: [
              { type: "addCounter", target: "source", counter: "token", amount: 1 },
              { type: "modifyInfluence", player: "controller", amount: 1 }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "bounded", def: bounded, owner: P1 },
        { key: "spark", def: gainOne("Spark"), owner: P1, zone: "hand" }
      ]
    });
    playAndResolve(engine, id, "spark");
    assert.equal(engine.state.players[P1].influence, 25 + 1 + 3, "the spark plus 3 re-triggers, then it stops");
    assert.equal(engine.state.result, undefined, "no draw");
  });

  rule("CR 414.1", "a repetition that a player may voluntarily end is not a forced loop: it asks each time, declining ends it, and the game is not drawn", () => {
    const optional = character({
      name: "Optional Again",
      behavior: {
        abilities: [
          {
            id: "again",
            type: "triggered",
            event: "influenceChanged",
            effects: [
              {
                type: "chooserSelectsOption",
                chooser: "controller",
                options: [
                  { label: "Again", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] },
                  { label: "Stop", effects: [] }
                ]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "optional", def: optional, owner: P1 },
        { key: "spark", def: gainOne("Spark"), owner: P1, zone: "hand" }
      ]
    });
    playAndResolve(engine, id, "spark");
    const answer = (label: string) => {
      const pending = engine.state.pendingChoice;
      assert.equal(pending?.kind, "chooserSelectsOption", "an option prompt is open");
      if (pending?.kind !== "chooserSelectsOption") return;
      const index = pending.options.findIndex(o => o.label === label);
      assert.ok(index >= 0, `the prompt offers '${label}'`);
      engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "chooserSelectsOption", index } });
      resolvePendingResponses(engine);
    };
    for (let round = 0; round < 6; round++) answer("Again");
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "after 6 rounds it is still only asking");
    answer("Stop");
    assert.equal(engine.state.pendingChoice, undefined, "declining ended the repetition");
    assert.equal(engine.state.result, undefined, "the game is not a draw");
    assert.equal(engine.state.players[P1].influence, 25 + 1 + 6, "one spark plus six accepted rounds");
  });

  rule("CR 414.1a", "the rules do not generate effects: turns, Restore and Develop recurring over and over never make a draw", () => {
    const { engine } = buildGame({ cards: [] });
    for (let turn = 0; turn < 12; turn++) {
      engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
      resolvePendingResponses(engine);
      settleTurnStart(engine);
    }
    assert.equal(engine.state.result, undefined, "twelve rule-driven turn cycles later the game is still on");
    assert.equal(engine.state.turn, 13, "and the turns really did pass");
  });

  ruleExempt(
    ["CR 414.2", "CR 414.2a", "CR 414.2b"],
    "Voluntary-loop shortcuts are a communication procedure between players (demonstrate the series, name a repeat count). The engine has no macro or repeat action: every action is one explicit perform() call, so there is no mechanism to verify; the interrupt right of 414.2c is tested separately."
  );

  rule("CR 414.2c", "the opponent can interrupt a repeated voluntary series at any point: after each repetition they get a response window and may respond", () => {
    const cycler = character({ name: "Cycler", behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: 1 }]) });
    const { engine, id } = buildGame({
      cards: [
        { key: "cycler", def: cycler, owner: P1 },
        { key: "reply", def: tactic({ name: "Reply" }), owner: P2, zone: "hand" }
      ]
    });
    for (let repetition = 1; repetition <= 3; repetition++) {
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cycler"), abilityId: "go" });
      assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, `repetition ${repetition}: the opponent may respond`);
      resolvePendingResponses(engine);
    }
    assert.equal(engine.state.players[P1].influence, 28, "the three repetitions resolved");
    // Fourth time through: the opponent interrupts with a tactic.
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cycler"), abilityId: "go" });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "the response sits above the 4th repetition");
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("reply")]!.zone, "discard", "the response resolved");
    assert.equal(engine.state.players[P1].influence, 29, "then the 4th repetition completed");
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("cycler"), abilityId: "go" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 30, "the series carries on after the interruption");
  });

  ruleExempt(
    ["CR 414.3", "CR 414.3a", "CR 414.3b", "CR 414.3c"],
    "Multi-player voluntary-loop shortcuts (demonstrate, each side names a number, the lesser count wins, the active player picks the stopping point) are an agreement procedure between people. The engine has no shortcut or repeat action, only individual actions with a response window after each, so there is nothing for it to verify."
  );
});
