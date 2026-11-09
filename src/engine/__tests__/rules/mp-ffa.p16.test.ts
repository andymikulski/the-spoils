// Multiplayer (free-for-all) rules, part 16: every construct finishes its own step before the effect list it sits in
// goes on (CR 402.1, 402.2), including the ones that used to run their inner lists in a plain loop (`mayPay`
// else-branches, `revealFromTopUntil` branches, replacement effects); and a card removed from the game face-down is
// seen only by the players the rules allow (CR 403.6a, MPX-hidden). Every numbered case runs at two and at three seats.
// Atoms: CR 402.1, CR 402.2, CR 403.6a, CR 506.1, MPX-vocab-each, MPX-hidden.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, Effect, PlayerId, Viewer } from "../../../engine.js";
import { HIDDEN_DEFINITION_ID, redactStateFor } from "../../../engine.js";
import { character, P1, P2, P3, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { rule } from "./_rule.js";
import { ACTIVATED, board, cast, pending, play, seatsFor, type Table } from "./_mpTable.js";

const COUNTS = [2, 3] as const;

const answerTargets = (t: Table, who: PlayerId, ...keys: string[]): void =>
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected: keys.map(key => t.id(key)) } });

const influence = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.influence;
const handSize = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.hand.length;
const zoneOf = (t: Table, key: string): string => t.engine.state.cards[t.id(key)]!.zone;

/** "Each opponent picks one of their own resources": a pausing choice for every opponent, in seat order. */
const PICK: Effect = {
  type: "forEachPlayer",
  players: "opponents",
  effects: [
    {
      type: "chooserSelectsTarget",
      chooser: "controller",
      declaration: { id: "r", selector: { owner: "self", zone: "play", type: "resource" }, count: 1 },
      effects: []
    }
  ]
};

/** "X" is read at the end of the step that needs it: gain that much influence. */
const GAIN_X: Effect = { type: "modifyInfluence", player: "controller", amount: { type: "variable", id: "x" } };
const SET_X = (value: number): Effect => ({ type: "bind", id: "x", value });
const ALWAYS = { type: "numberCompare", left: 1, operator: "=", right: 1 } as const;

/** Two resources for every opponent (so each pick is a real choice) and a few cards for P1's deck. */
const table = (count: number, spell: CardDefinition, extra: Parameters<typeof board>[2] = []): Table =>
  board(count, spell, [
    ...seatsFor(count)
      .slice(1)
      .flatMap(owner => [
        { key: `${owner}-a`, def: resourceCard({ name: `A of ${owner}` }), owner, zone: "play" as const },
        { key: `${owner}-b`, def: resourceCard({ name: `B of ${owner}` }), owner, zone: "play" as const }
      ]),
    ...extra
  ]);

/** Every opponent answers their pick, in seat order, with their "a" resource. */
function answerAll(t: Table): void {
  for (const opponent of t.seats.slice(1)) {
    assert.equal(pending(t)?.kind, "chooserSelectsTarget", `${opponent} is asked`);
    assert.equal(pending(t)?.playerId, opponent);
    answerTargets(t, opponent, `${opponent}-a`);
  }
}

// ---------------------------------------------------------------------------
// Item 1: no exceptions to "a construct finishes its own step first".
// ---------------------------------------------------------------------------

describe("CR 402.2 / MPX-vocab-each — an iteration that is the last effect of its list finishes before the stack item does", () => {
  const LAST = tactic({ name: "Each Opponent Picks", behavior: ACTIVATED({ effects: [PICK] }) });
  for (const count of COUNTS) {
    rule(["CR 402.2", "MPX-vocab-each"], `${count} seats: the spell stays unresolved until the last opponent has answered`, () => {
      const t = table(count, LAST);
      cast(t);
      for (const opponent of t.seats.slice(1)) {
        assert.equal(pending(t)?.playerId, opponent, `${opponent} is asked`);
        assert.notEqual(zoneOf(t, "spell"), "discard", `the spell is not finished while ${opponent} still has to answer`);
        answerTargets(t, opponent, `${opponent}-a`);
      }
      assert.equal(pending(t), undefined);
      assert.equal(zoneOf(t, "spell"), "discard", "it finishes after the last answer");
    });
  }
});

describe("CR 402.1 — a branch of an `if` that paused finishes before the effect that follows the `if`", () => {
  // Warehouse Raid's shape: the first branch is still half done (it waits for a choice) when the list's next effect, which
  // reads and rewrites the same value, comes up.
  const BRANCH = tactic({
    name: "Branch Then Rewrite",
    behavior: ACTIVATED({ effects: [SET_X(1), { type: "if", condition: ALWAYS, effects: [PICK, GAIN_X] }, SET_X(5)] })
  });
  const FIRST_THEN = tactic({
    name: "Choice First In Branch",
    behavior: ACTIVATED({
      effects: [
        SET_X(1),
        {
          type: "if",
          condition: ALWAYS,
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "mine", selector: { owner: "self", zone: "play", type: "resource" }, count: 1 },
              effects: []
            },
            GAIN_X
          ]
        },
        SET_X(5)
      ]
    })
  });
  for (const count of COUNTS) {
    rule(["CR 402.1", "CR 402.2"], `${count} seats: the branch's last effect reads the value as it was before the list's next effect`, () => {
      const t = table(count, BRANCH);
      const before = influence(t, P1);
      cast(t);
      answerAll(t);
      assert.equal(pending(t), undefined);
      assert.equal(influence(t, P1) - before, 1, "the branch's gain used x = 1, not the later x = 5");
    });

    rule(["CR 402.1"], `${count} seats: a branch whose first effect is the pausing choice, with nothing of its own parked, keeps its order too`, () => {
      const t = table(count, FIRST_THEN, [{ key: "own-a", def: resourceCard({ name: "Own A" }), owner: P1, zone: "play" }]);
      const before = influence(t, P1);
      cast(t);
      assert.equal(pending(t)?.playerId, P1);
      answerTargets(t, P1, "own-a");
      assert.equal(pending(t), undefined);
      assert.equal(influence(t, P1) - before, 1, "x was still 1 when the branch's second effect ran");
    });
  }
});

// ---------------------------------------------------------------------------
// Item 2a: mayPay's else-branch.
// ---------------------------------------------------------------------------

describe("CR 402.1 — a `mayPay` that cannot be paid runs its else-effects as a list that can pause", () => {
  const CANNOT_PAY = (elseEffects: Effect[]) =>
    tactic({
      name: "Pay Fifty Or Else",
      behavior: ACTIVATED({
        effects: [SET_X(1), { type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 50 }], effects: [], elseEffects }, SET_X(5)]
      })
    });
  for (const count of COUNTS) {
    rule(["CR 402.1", "CR 402.2", "MPX-vocab-each"], `${count} seats: every opponent answers inside the else-branch before its last effect, and before the list goes on`, () => {
      const t = table(count, CANNOT_PAY([PICK, GAIN_X]));
      const before = influence(t, P1);
      cast(t);
      assert.equal(pending(t)?.kind, "chooserSelectsTarget", "the else-branch asks the first opponent");
      assert.equal(influence(t, P1), before, "nothing after the choice has happened yet");
      answerAll(t);
      assert.equal(pending(t), undefined);
      assert.equal(influence(t, P1) - before, 1, "the else-branch finished (x = 1) before the list's x = 5");
    });
  }
});

// ---------------------------------------------------------------------------
// Item 2b: revealFromTopUntil's branches.
// ---------------------------------------------------------------------------

describe("CR 402.1 — the branches of `revealFromTopUntil` pause, and the other revealed cards are dealt with after them", () => {
  const MATCH = { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" } as const;
  const REVEAL = (match: Effect[], empty: Effect[]) =>
    tactic({
      name: "Reveal Until A Character",
      behavior: ACTIVATED({
        effects: [
          SET_X(1),
          { type: "revealFromTopUntil", player: "controller", match: MATCH, bindAs: "rec", onMatch: match, onEmpty: empty, rest: "discard" },
          SET_X(5)
        ]
      })
    });
  const TO_HAND: Effect = { type: "moveCard", target: { type: "selected", id: "rec" }, to: "hand" };
  const deck = (keys: Array<[string, "tactic" | "character"]>) =>
    keys.map(([key, kind]) => ({
      key,
      def: kind === "character" ? character({ name: key }) : tactic({ name: key }),
      owner: P1,
      zone: "deck" as const
    }));

  for (const count of COUNTS) {
    rule(["CR 402.1", "CR 402.2", "MPX-vocab-each"], `${count} seats: a choice in onMatch waits for every opponent; the revealed non-matches are discarded only afterwards`, () => {
      const t = table(count, REVEAL([PICK, TO_HAND, GAIN_X], []), deck([["skip-1", "tactic"], ["skip-2", "tactic"], ["hit", "character"], ["below", "tactic"]]));
      assert.equal(t.engine.state.players[P1]!.deck[0], t.id("skip-1"), "the deck is in the order it was listed");
      const before = influence(t, P1);
      const handBefore = handSize(t, P1);
      cast(t);
      assert.equal(pending(t)?.playerId, P2, "the first opponent is asked inside onMatch");
      assert.equal(zoneOf(t, "skip-1"), "deck", "the revealed non-matches have not been dealt with while the branch waits");
      assert.equal(zoneOf(t, "skip-2"), "deck");
      assert.equal(handSize(t, P1), handBefore - 1, "only the spell left the hand: the match has not moved yet");
      answerAll(t);
      assert.equal(pending(t), undefined);
      assert.equal(zoneOf(t, "hit"), "hand", "the match went to the hand when the branch finished");
      assert.equal(zoneOf(t, "skip-1"), "discard", "then the other revealed cards were discarded");
      assert.equal(zoneOf(t, "skip-2"), "discard");
      assert.equal(zoneOf(t, "below"), "deck", "an unrevealed card stayed where it was");
      assert.equal(influence(t, P1) - before, 1, "the branch finished before the list's x = 5");
    });

    rule(["CR 402.1", "CR 402.2", "MPX-vocab-each"], `${count} seats: a choice in onEmpty (no card matches) waits for every opponent; every revealed card is discarded afterwards`, () => {
      const t = table(count, REVEAL([], [PICK, GAIN_X]), deck([["skip-1", "tactic"], ["skip-2", "tactic"]]));
      const before = influence(t, P1);
      cast(t);
      assert.equal(pending(t)?.playerId, P2, "the first opponent is asked inside onEmpty");
      assert.equal(zoneOf(t, "skip-1"), "deck", "the revealed cards have not been dealt with while the branch waits");
      answerAll(t);
      assert.equal(pending(t), undefined);
      assert.equal(zoneOf(t, "skip-1"), "discard");
      assert.equal(zoneOf(t, "skip-2"), "discard");
      assert.equal(influence(t, P1) - before, 1);
    });
  }
});

// ---------------------------------------------------------------------------
// Item 2c: replacement effect lists.
// ---------------------------------------------------------------------------

describe("CR 506.1 / CR 402.1 — a replacement's effects pause like any list: what follows them waits for the answers", () => {
  /** "If this would be destroyed, instead each opponent picks one of their resources. Then draw a card." */
  const LUCKY = character({
    name: "Lucky Pickpocket",
    life: 3,
    behavior: {
      abilities: [
        {
          id: "lucky",
          type: "replacement",
          replaces: { event: "destroy" },
          effects: [PICK, { type: "draw", player: "controller", amount: 1 }, { type: "setDamage", target: { type: "selected", id: "__candidate" }, amount: 0 }],
          condition: { type: "isCard", target: { type: "selected", id: "__candidate" }, other: "source" }
        }
      ]
    } as CardDefinition["behavior"]
  });
  const SMASH = tactic({
    name: "Smash",
    behavior: ACTIVATED({
      targets: [{ id: "t", selector: { type: "character", controller: "self", zone: "play" }, count: 1 }],
      effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
    })
  });
  for (const count of COUNTS) {
    rule(["CR 506.1", "CR 402.1", "MPX-vocab-each"], `${count} seats: the draw after the opponents' picks waits until the last of them has answered`, () => {
      const t = table(count, SMASH, [
        { key: "lucky", def: LUCKY, owner: P1, zone: "play" },
        { key: "deck-1", def: tactic({ name: "Deck 1" }), owner: P1, zone: "deck" },
        { key: "deck-2", def: tactic({ name: "Deck 2" }), owner: P1, zone: "deck" }
      ]);
      const handBefore = handSize(t, P1);
      t.engine.perform(play(t, { selected: { t: [t.id("lucky")] } }));
      resolvePendingResponses(t.engine);
      for (const opponent of t.seats.slice(1)) {
        assert.equal(pending(t)?.kind, "chooserSelectsTarget", `${opponent} is asked`);
        assert.equal(pending(t)?.playerId, opponent);
        assert.equal(handSize(t, P1), handBefore - 1, "the spell left the hand; the replacement's draw has not happened yet");
        answerTargets(t, opponent, `${opponent}-a`);
      }
      assert.equal(pending(t), undefined);
      assert.equal(handSize(t, P1), handBefore, "after the last answer: one card drawn");
      assert.equal(zoneOf(t, "lucky"), "play", "the replaced destruction left it in play");
      assert.equal(t.engine.state.cards[t.id("lucky")]!.damage, 0);
    });
  }
});

// ---------------------------------------------------------------------------
// Item 3: Pant Swipe (Seed): "Remove the top 4 cards of your opponent's deck from the game face-down. (You are still
// allowed to look at them.)"
// ---------------------------------------------------------------------------

describe("CR 403.6a / MPX-hidden — cards removed from the game face-down are seen only by the player who removed them", () => {
  const SWIPE = tactic({
    name: "Pant Swipe Shape",
    behavior: ACTIVATED({
      effects: [
        {
          type: "forEach",
          selector: { owner: "opponent", zone: "deck", fromTop: 2 },
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "__candidate" }, faceDown: true }]
        }
      ]
    })
  });
  const PLAIN = tactic({
    name: "Plain Removal",
    behavior: ACTIVATED({
      effects: [
        {
          type: "forEach",
          selector: { owner: "opponent", zone: "deck", fromTop: 2 },
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "__candidate" } }]
        }
      ]
    })
  });
  const withDeck = (count: number, spell: CardDefinition): Table =>
    board(count, spell, [
      { key: "d1", def: tactic({ name: "Opponent Deck 1" }), owner: P2, zone: "deck" },
      { key: "d2", def: tactic({ name: "Opponent Deck 2" }), owner: P2, zone: "deck" },
      { key: "d3", def: tactic({ name: "Opponent Deck 3" }), owner: P2, zone: "deck" }
    ]);
  const masked = (t: Table, viewer: Viewer, key: string): boolean =>
    redactStateFor(t.engine.state, viewer, {
      revealed: t.engine.getFlowView().revealed,
      canSeeVoided: cardId => (viewer === "spectator" ? false : t.engine.canViewerSeeVoidedCard(viewer, cardId))
    }).cards[t.id(key)]!.definitionId === HIDDEN_DEFINITION_ID;

  for (const count of COUNTS) {
    const viewers: Viewer[] = [...seatsFor(count), "spectator"];
    rule(["CR 403.6a", "MPX-hidden"], `${count} seats: the face-down removed cards are in the removed zone, face-down, and only their remover sees them`, () => {
      const t = withDeck(count, SWIPE);
      cast(t, { opponent: P2 });
      for (const key of ["d1", "d2"]) {
        const card = t.engine.state.cards[t.id(key)]!;
        assert.equal(card.zone, "removed");
        assert.equal(card.faceDown, true);
        assert.equal(card.faceDownBy, P1);
        for (const viewer of viewers) assert.equal(masked(t, viewer, key), viewer !== P1, `${viewer} looking at ${key}`);
      }
      assert.equal(zoneOf(t, "d3"), "deck", "only the top two were taken");
    });

    rule(["CR 403.6a"], `${count} seats: a plain removal from the game is face-up and seen by every viewer`, () => {
      const t = withDeck(count, PLAIN);
      cast(t, { opponent: P2 });
      for (const viewer of viewers) assert.equal(masked(t, viewer, "d1"), false, `${viewer} looking at d1`);
      assert.equal(t.engine.state.cards[t.id("d1")]!.faceDown, false);
    });
  }
});
