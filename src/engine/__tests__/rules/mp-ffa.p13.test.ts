// Multiplayer (free-for-all) rules, part 13: "any opponent may pay" as one prompt per opponent, a cost modifier and a
// pick tax over every opponent, and the showdown between the controller and one other player.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-offer, MPX-vocab-each, MPX-both, MPX-vocab-an,
// MPX-select.
// Every numbered point is tested at 3 and at 4 seats, with the two-seat reduction next to it.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, PlayerId } from "../../../engine.js";
import { loadGame, saveGame } from "../../../engine.js";
import { buildGame, character, P1, P2, P3, resolvePendingResponses, resourceCard, tactic, type CardPlacement } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { ACTIVATED, baseline, board, cast, lost, pending, plainSeats, play, seatsFor, TABLES, type Table } from "./_mpTable.js";

const ALL_TABLES = [2, ...TABLES] as const;
/** The JSON of `value` with the numbers of generated ids (the counters run on across games) taken out. */
const same = (value: unknown): string => JSON.stringify(value).replace(/(card|choice|unit|context|modifier|faction|character|resource|tactic|item)[-_]\d+/g, "$1_#");
const named = (id: string) => ({ type: "chosenPlayer", id });
const resources = (owner: PlayerId, count: number): CardPlacement[] =>
  Array.from({ length: count }, (_, i) => ({ key: `pay-${owner}-${i}`, def: resourceCard({ name: `Pay ${owner} ${i}` }), owner }));

// ---------------------------------------------------------------------------
// "Any opponent may pay" (MPX-offer): one `mayPay` prompt per opponent, clockwise from the controller's left.
// ---------------------------------------------------------------------------

describe("mayPay offerTo opponents — any opponent may pay", () => {
  const costs = [{ type: "payResources", amount: 1 }];
  const effects = [{ type: "modifyInfluence", player: "controller", amount: 3 }];
  const elseEffects = [{ type: "modifyInfluence", player: "controller", amount: 5 }];
  const offer = (who: Record<string, unknown>) => ACTIVATED({ effects: [{ type: "mayPay", ...who, costs, effects, elseEffects }] });
  const table = (count: number, payers: PlayerId[], who: Record<string, unknown> = { offerTo: "opponents" }): Table =>
    board(count, tactic({ id: "offer", name: "Offer", behavior: offer(who) }), payers.flatMap(seat => resources(seat, 1)));
  const answer = (t: Table, pay: boolean): void => {
    const choice = pending(t)!;
    t.engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: { kind: "mayPay", pay } });
    resolvePendingResponses(t.engine);
  };
  /** Casts, then declines every prompt (or pays when it is `pays`' turn); returns who was asked, in order. */
  function asked(t: Table, pays?: PlayerId): PlayerId[] {
    t.engine.perform(play(t));
    resolvePendingResponses(t.engine);
    const who: PlayerId[] = [];
    for (let guard = 0; guard < 8 && pending(t); guard++) {
      assert.equal(pending(t)!.kind, "mayPay");
      who.push(pending(t)!.playerId);
      answer(t, pending(t)!.playerId === pays);
    }
    return who;
  }

  for (const count of TABLES) {
    rule(["MPX-offer"], `${count} seats: an opponent who cannot pay is not offered it`, () => {
      const payers = seatsFor(count).slice(2);
      assert.deepEqual(asked(table(count, payers)), payers);
    });

    rule(["MPX-offer"], `${count} seats: when no opponent can pay, Otherwise happens at once with nothing offered`, () => {
      const t = table(count, []);
      const before = baseline(t);
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      assert.equal(pending(t), undefined);
      assert.equal(lost(t, before, P1), -5);
    });

    rule(["MPX-offer"], `${count} seats: the prompt names the opponents still to be asked, and a save and load keeps them`, () => {
      const t = table(count, seatsFor(count).slice(1));
      t.engine.perform(play(t));
      resolvePendingResponses(t.engine);
      const first = pending(t) as { kind: string; playerId: PlayerId; remaining?: PlayerId[] };
      assert.equal(first.kind, "mayPay");
      assert.equal(first.playerId, P2);
      assert.deepEqual(first.remaining, seatsFor(count).slice(2));
      const reloaded = loadGame(JSON.parse(JSON.stringify(saveGame(t.engine))), Object.values(t.engine.definitions));
      const t2: Table = { engine: reloaded, id: t.id, seats: t.seats };
      answer(t2, false);
      assert.equal(pending(t2)!.playerId, P3);
      answer(t2, true);
      assert.equal(pending(t2), undefined);
      assert.equal(reloaded.state.players[P1]!.influence, t.engine.state.players[P1]!.influence + 3, "the paid-for effect happened once, to the controller");
    });
  }

  rule(["MPX-offer"], "2 seats: the one opponent's prompt, and the state after each answer, are the same as for `player: \"opponent\"`", () => {
    for (const pay of [true, false]) {
      const offered = table(2, [P2]);
      const plain = table(2, [P2], { player: "opponent" });
      for (const t of [offered, plain]) {
        t.engine.perform(play(t));
        resolvePendingResponses(t.engine);
      }
      assert.equal(same(offered.engine.state.pendingChoice), same(plain.engine.state.pendingChoice), "the same prompt");
      assert.equal(pending(offered)!.kind, "mayPay");
      assert.equal("remaining" in pending(offered)!, false, "no extra field at two seats");
      for (const t of [offered, plain]) answer(t, pay);
      assert.equal(same(offered.engine.state.players), same(plain.engine.state.players));
      assert.equal(same(offered.engine.state.cards), same(plain.engine.state.cards));
    }
  });

  rule(["MPX-offer"], "2 seats: an opponent who cannot pay gets Otherwise at once, as `player: \"opponent\"` does", () => {
    const t = table(2, []);
    const before = baseline(t);
    t.engine.perform(play(t));
    resolvePendingResponses(t.engine);
    assert.equal(pending(t), undefined);
    assert.equal(lost(t, before, P1), -5);
  });

  rule(["MPX-offer"], "a mayPay names its payer or offers the payment, never both", () => {
    const both = table(3, [P2], { offerTo: "opponents", player: "opponent" });
    refused(() => cast(both, { opponent: P2 }), "both a payer and an offer", /not both/);
  });
});

// ---------------------------------------------------------------------------
// Cost modifiers and pick taxes over "your opponents" (MPX-vocab-each).
// ---------------------------------------------------------------------------

describe("affects 'opponents' — cost modifiers and pick taxes", () => {
  const OVERSEER = character({
    name: "Overseer",
    behavior: { abilities: [{ id: "tax", type: "continuous", modifiers: [], costModifiers: [{ affects: "opponents", delta: 1 }] }] } as CardDefinition["behavior"]
  });
  /** "Your opponents must pay 1 to pick a character you control." */
  const CHARM = character({
    name: "Charm",
    behavior: { abilities: [{ id: "tax", type: "continuous", modifiers: [], pickTax: [{ affects: "opponents", amount: 1, selector: { type: "character", controller: "self" } }] }] } as CardDefinition["behavior"]
  });
  const PICK = tactic({ name: "Pick", cost: 0, behavior: ACTIVATED({ targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [] }) });

  for (const count of ALL_TABLES) {
    const seats = seatsFor(count);
    rule(["MPX-vocab-each"], `${count} seats: a cost modifier over opponents adds to the deploys of every opponent and not to the controller's`, () => {
      const built = buildGame({
        ...plainSeats(count),
        cards: [
          { key: "overseer", def: OVERSEER, owner: P1 },
          ...seats.map(owner => ({ key: `t-${owner}`, def: tactic({ name: `Tactic ${owner}`, cost: 1 }), owner, zone: "hand" as const }))
        ]
      });
      const cost = (seat: PlayerId) => built.engine.getCardPlayability(seat, built.id(`t-${seat}`)).numericCost;
      assert.equal(cost(P1), 1);
      for (const seat of seats.slice(1)) assert.equal(cost(seat), 2, `${seat} pays 1 more`);
    });

    rule(["MPX-vocab-each"], `${count} seats: a pick tax over opponents is owed by each opponent who picks, and a pick the tax cannot be paid for is refused`, () => {
      for (const picker of seats.slice(1)) {
        const make = (paying: number) =>
          buildGame({
            ...plainSeats(count),
            activePlayerId: picker,
            turn: 2,
            cards: [
              { key: "charm", def: CHARM, owner: P1 },
              { key: "prize", def: character({ name: "Prize" }), owner: P1 },
              { key: "pick", def: PICK, owner: picker, zone: "hand" },
              ...resources(picker, paying)
            ]
          });
        const poor = make(0);
        refused(
          () => poor.engine.perform({ type: "playCard", playerId: picker, cardId: poor.id("pick"), selected: { t: [poor.id("prize")] } } as never),
          `${picker} cannot pay the tax`
        );
        const rich = make(1);
        rich.engine.perform({ type: "playCard", playerId: picker, cardId: rich.id("pick"), selected: { t: [rich.id("prize")] } } as never);
        assert.equal(rich.engine.getAvailableResourceCount(picker), 0, `${picker} paid 1 for the pick`);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// The showdown of "Both players ..." / "You and an opponent ..." (MPX-both, MPX-vocab-an).
// ---------------------------------------------------------------------------

describe("partitionAndPick — the controller and one other player", () => {
  const SHOWDOWN = { type: "partitionAndPick", count: 3, piles: 2, compareBy: "cost", winnerTakes: 1 };
  /** "Both players ...": the block's opponent. */
  const BOTH = ACTIVATED({ effects: [SHOWDOWN] });
  /** "You and an opponent ...": a player choice read back by the effect. */
  const AN_OPPONENT = ACTIVATED({ playerChoices: [{ id: "o", from: "opponents" }], effects: [{ ...SHOWDOWN, opponent: named("o") }] });
  const decks = (count: number): CardPlacement[] =>
    seatsFor(count).flatMap(owner =>
      [1, 2, 3].map(cost => ({ key: `dk-${owner}-${cost}`, def: character({ name: `Deck ${owner} ${cost}`, cost }), owner, zone: "deck" as const }))
    );
  const table = (count: number, behavior: CardDefinition["behavior"]): Table => board(count, tactic({ name: "Showdown", behavior }), decks(count));

  /** Answers the showdown prompts (split off the first card; take the first pile; take nothing) and returns who was asked what. */
  function run(t: Table): Array<[string, PlayerId]> {
    const asked: Array<[string, PlayerId]> = [];
    for (let guard = 0; guard < 10; guard++) {
      resolvePendingResponses(t.engine);
      const choice = t.engine.state.pendingChoice;
      if (!choice) break;
      asked.push([choice.kind, choice.playerId]);
      const answer =
        choice.kind === "partitionCards"
          ? { kind: "partitionCards", piles: [[choice.cardIds[0]!], choice.cardIds.slice(1)] }
          : choice.kind === "pickPile"
            ? { kind: "pickPile", index: 0 }
            : { kind: "takeFromPile", cardIds: [] };
      t.engine.perform({ type: "resolvePendingChoice", playerId: choice.playerId, choice: answer } as never);
    }
    return asked;
  }
  const showdownWith = (other: PlayerId): Array<[string, PlayerId]> => [
    ["partitionCards", P1],
    ["partitionCards", other],
    ["pickPile", P1],
    ["pickPile", other]
  ];

  for (const count of TABLES) {
    const other = seatsFor(count)[count - 1]!;
    rule(["MPX-both", "MPX-select"], `${count} seats: "Both players" is the controller and the opponent selected with the action; nobody else takes part`, () => {
      const t = table(count, BOTH);
      const topOfP2 = [...t.engine.state.players[P2]!.deck];
      t.engine.perform(play(t, { players: { opponent: other } }));
      assert.deepEqual(run(t), showdownWith(other));
      assert.deepEqual(t.engine.state.players[P2]!.deck, topOfP2, "an uninvolved player's deck is untouched");
    });

    rule(["MPX-both", "MPX-select"], `${count} seats: the opponent is asked for with the action, before anything is revealed`, () => {
      const t = table(count, BOTH);
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), [{ kind: "players", choices: [{ id: "opponent", candidates: seatsFor(count).slice(1) }] }]);
      refused(() => t.engine.perform(play(t)), "no opponent selected", /Choose your opponent/);
    });

    rule(["MPX-vocab-an", "MPX-both"], `${count} seats: "You and an opponent" is the controller and the player chosen with the action`, () => {
      const t = table(count, AN_OPPONENT);
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), [{ kind: "players", choices: [{ id: "o", candidates: seatsFor(count).slice(1) }] }]);
      t.engine.perform(play(t, { players: { o: other } }));
      assert.deepEqual(run(t), showdownWith(other));
    });
  }

  rule(["MPX-both", "MPX-vocab-an"], "2 seats: both forms are the controller and the one opponent, and nobody is asked who", () => {
    for (const behavior of [BOTH, AN_OPPONENT]) {
      const t = table(2, behavior);
      assert.deepEqual(t.engine.getPlayRequirements(play(t) as never), []);
      t.engine.perform(play(t));
      assert.deepEqual(run(t), showdownWith(P2));
    }
  });
});
