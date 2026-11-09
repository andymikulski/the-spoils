// Multiplayer (free-for-all) rules, part 13: an iteration over the players finishes before its list goes on, and the
// per-opponent text that needs its own vocabulary, at three and four seats with a two-seat equivalence check.
// Atoms: data/rule-tests/source/multiplayer.txt (batch mp-ffa): MPX-vocab-each, MPX-vocab-players, MPX-vocab-an,
// MPX-an-superlative, MPX-select; CR 402.2.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, Effect, PlayerId } from "../../../engine.js";
import { P1, P2, P3, P4, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { rule } from "./_rule.js";
import { ACTIVATED, board, cast, pending, play, seatsFor, type Table } from "./_mpTable.js";

const answerTargets = (t: Table, who: PlayerId, ...keys: string[]): void =>
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected: keys.map(key => t.id(key)) } });

const handSize = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.hand.length;
const attachedToFaction = (t: Table, key: string, who: PlayerId): boolean => t.engine.state.cards[t.id(key)]!.attachedTo === t.engine.state.players[who]!.factionId;

// ---------------------------------------------------------------------------
// Item 1: "each opponent ... Then draw a card": every opponent acts before the draw.
// ---------------------------------------------------------------------------

/** Swindle's shape: each opponent attaches one of their own unattached resources to their faction; then the controller draws. */
const SWINDLE = tactic({
  name: "Swindle",
  behavior: ACTIVATED({
    effects: [
      {
        type: "forEachPlayer",
        players: "opponents",
        effects: [
          {
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: { id: "r", selector: { owner: "self", zone: "play", type: "resource", attachedToFaction: false }, count: 1 },
            effects: [{ type: "attachTo", target: { type: "selected", id: "r" }, to: { type: "factionOf", player: "controller" } }]
          }
        ]
      },
      { type: "draw", player: "controller", amount: 1 }
    ] as Effect[]
  })
});

/** Two unattached resources for every opponent, so each one's pick is a real choice, and cards to draw. */
const swindleTable = (count: number, spell: CardDefinition = SWINDLE): Table =>
  board(count, spell, [
    ...seatsFor(count)
      .slice(1)
      .flatMap(owner => [
        { key: `${owner}-a`, def: resourceCard({ name: `A of ${owner}` }), owner, zone: "play" as const },
        { key: `${owner}-b`, def: resourceCard({ name: `B of ${owner}` }), owner, zone: "play" as const }
      ]),
    { key: "deck-1", def: tactic({ name: "Deck card 1" }), owner: P1, zone: "deck" },
    { key: "deck-2", def: tactic({ name: "Deck card 2" }), owner: P1, zone: "deck" }
  ]);

describe("MPX-vocab-each / CR 402.2 — an iteration over the opponents finishes for every opponent before the next effect", () => {
  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);
    rule(["MPX-vocab-each", "CR 402.2"], `${count} seats: with a pausing choice for each opponent, the controller draws only after the last opponent has acted`, () => {
      const t = swindleTable(count);
      cast(t);
      const handBefore = handSize(t, P1);
      for (const [n, opponent] of opponents.entries()) {
        assert.equal(pending(t)?.kind, "chooserSelectsTarget", `${opponent} is asked`);
        assert.equal(pending(t)?.playerId, opponent, `the ${n + 1}th choice belongs to ${opponent}, in seat order`);
        assert.equal(handSize(t, P1), handBefore, "nothing after the loop has happened while an opponent still has to act");
        answerTargets(t, opponent, `${opponent}-a`);
      }
      assert.equal(pending(t), undefined);
      for (const opponent of opponents) {
        assert.equal(attachedToFaction(t, `${opponent}-a`, opponent), true, `${opponent} attached their own resource`);
        assert.equal(attachedToFaction(t, `${opponent}-b`, opponent), false, `${opponent} attached only one`);
      }
      assert.equal(handSize(t, P1), handBefore + 1, "the controller drew once, after the loop");
    });
  }
});

// ---------------------------------------------------------------------------
// Items 2 and 11: "while there are at least 10 cards in an opponent's discard pile, that player cannot pick this card"
// (Omahkapi'si Pi'kssii) and "if an opponent controls more ... than you" (Nefarious Horror): each opponent is judged on
// their own, never pooled with the others.
// ---------------------------------------------------------------------------

import { character } from "../support/fixtures.js";
import type { Condition } from "../../../engine.js";
import { intoPlay } from "./_mpTable.js";

/** Omahkapi'si Pi'kssii's rule text: the restriction covers exactly the opponents whose own discard pile holds 10 or more cards. */
const OMAHKAPI = character({
  name: "Omahkapi'si Pi'kssii",
  behavior: {
    abilities: [
      {
        id: "hide",
        type: "continuous",
        modifiers: [],
        restrictions: [
          {
            restriction: "cannotBePickedByOpponents",
            target: "source",
            opponentCondition: {
              type: "numberCompare",
              left: { type: "count", selector: { zone: "discard", owner: "opponent" } },
              operator: ">=",
              right: 10
            }
          }
        ]
      }
    ]
  } as CardDefinition["behavior"]
});

const discard = (owner: PlayerId, n: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `d-${owner}-${i}`, def: tactic({ name: `Discarded ${owner} ${i}` }), owner, zone: "discard" as const }));

/** Whether `picker` may pick the Omahkapi'si on the table: the engine's own pick check, as a picker's ability would make it. */
const canPick = (t: Table, picker: PlayerId): boolean =>
  t.engine
    .targetCandidates({ zone: "play", type: "character" }, { sourceId: t.id(`c-${picker}`), controllerId: picker, selected: {} }, picker)
    .some(card => card.id === t.id("spell"));

describe("MPX-vocab-an / MPX-an-superlative — \"that player cannot pick this card\" binds each opponent whose own discard pile has 10 cards", () => {
  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);
    const table = (piles: Record<string, number>): Table => {
      const t = board(count, OMAHKAPI, opponents.flatMap(owner => discard(owner, piles[owner] ?? 0)));
      intoPlay(t);
      return t;
    };

    rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: ${P2} has 10 cards in their pile: ${P2} cannot pick it, every other opponent and the controller can`, () => {
      const t = table({ [P2]: 10 });
      assert.equal(canPick(t, P2), false);
      for (const other of opponents.filter(seat => seat !== P2)) assert.equal(canPick(t, other), true, `${other} has fewer than 10 cards`);
      assert.equal(canPick(t, P1), true, "its controller is never an opponent");
    });

    rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: 9 cards bar nobody`, () => {
      const t = table({ [P2]: 9, [P3]: 9, [P4]: 9 });
      for (const seat of seatsFor(count)) assert.equal(canPick(t, seat), true, seat);
    });

    rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: the piles are not added together: nobody is barred at 6 and 6`, () => {
      const t = table({ [P2]: 6, [P3]: 6, [P4]: 6 });
      for (const seat of seatsFor(count)) assert.equal(canPick(t, seat), true, seat);
    });

    rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: a pile reaching 10 bars its owner as well, and only them`, () => {
      const t = table({ [P2]: 10, [P3]: 10 });
      assert.equal(canPick(t, P2), false);
      if (count >= 3) assert.equal(canPick(t, P3), false);
      if (count >= 4) assert.equal(canPick(t, P4), true);
    });

    rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: the controller's own pile has no effect`, () => {
      const t = board(count, OMAHKAPI, discard(P1, 12));
      intoPlay(t);
      for (const seat of opponents) assert.equal(canPick(t, seat), true, seat);
    });

    rule(["MPX-vocab-an"], `${count} seats: a refused pick is refused when the barred opponent plays a tactic on it, and accepted for another opponent`, () => {
      const pick = tactic({
        name: "Pick a character",
        behavior: {
          abilities: [{ id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }], effects: [] }]
        } as CardDefinition["behavior"]
      });
      for (const [picker, allowed] of opponents.map((seat, i) => [seat, i > 0] as const)) {
        const t = board(count, OMAHKAPI, [
          ...discard(P2, 10),
          { key: "pick", def: pick, owner: picker, zone: "hand" as const },
          { key: "mana", def: resourceCard({ name: "Mana" }), owner: picker }
        ]);
        intoPlay(t);
        t.engine.state.activePlayerId = picker;
        t.engine.state.priorityPlayerId = picker;
        const play = () => t.engine.perform({ type: "playCard", playerId: picker, cardId: t.id("pick"), selected: { t: [t.id("spell")] } });
        if (allowed) play();
        else assert.throws(play);
      }
    });
  }
});

/** "An opponent controls more characters than you." */
const MORE_THAN_ME: Condition = {
  type: "anyOpponent",
  condition: {
    type: "numberCompare",
    left: { type: "count", selector: { type: "character", zone: "play", controller: "opponent" } },
    operator: ">",
    right: { type: "count", selector: { type: "character", zone: "play", controller: "self" } }
  }
};

describe("MPX-vocab-an / MPX-an-superlative — \"an opponent controls more ... than you\" compares each opponent with you, not their total", () => {
  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);
    // `board` gives every seat one character; `extra` adds more to chosen seats.
    const holds = (more: Record<string, number>): boolean => {
      const t = board(
        count,
        tactic({ name: "Unused" }),
        Object.entries(more).flatMap(([owner, n]) => Array.from({ length: n }, (_, i) => ({ key: `x-${owner}-${i}`, def: character({ name: `Extra ${owner} ${i}` }), owner })))
      );
      return t.engine.evaluateCondition(MORE_THAN_ME, { sourceId: t.id("c-p1"), controllerId: P1, selected: {} });
    };

    rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: true when one opponent has more characters than the controller`, () => {
      assert.equal(holds({ [P2]: 1 }), true);
    });

    rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: false when every opponent has exactly as many as the controller, however many there are in all`, () => {
      assert.equal(holds({}), false);
    });

    rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: the controller having more than every opponent is false`, () => {
      assert.equal(holds({ [P1]: 2 }), false);
    });

    if (count >= 3) {
      rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: the opponents' characters are not pooled (1 + 1 against 1 is not "more")`, () => {
        // Every seat has one character: the opponents hold 2 or 3 together against the controller's 1, yet none holds more.
        assert.equal(holds({}), false);
        // The controller at 2 against two opponents at 1 each: pooled they have 2 or more, but each has fewer.
        assert.equal(holds({ [P1]: 1 }), false);
      });

      rule(["MPX-vocab-an", "MPX-an-superlative"], `${count} seats: true when only the last opponent has more`, () => {
        assert.equal(holds({ [opponents[opponents.length - 1]!]: 1 }), true);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Item 5: Unloyal Necromorph, "any opponent may pay 2" (MPQ-P7, MPX-offer).
// ---------------------------------------------------------------------------

/** Unloyal Necromorph's rules text: the replacement is offered to each opponent in turn. */
const NECROMORPH = character({
  name: "Unloyal Necromorph",
  life: 3,
  behavior: {
    abilities: [
      {
        id: "unloyal-necromorph",
        type: "replacement",
        replaces: { event: "destroy" },
        optional: true,
        optionalCost: [{ type: "payResources", amount: 2 }],
        chooser: "opponents",
        effects: [
          { type: "takeControl", target: { type: "selected", id: "__candidate" }, controller: "controller" },
          { type: "setDamage", target: { type: "selected", id: "__candidate" }, amount: 0 }
        ],
        condition: { type: "isCard", target: { type: "selected", id: "__candidate" }, other: "source" }
      }
    ]
  } as CardDefinition["behavior"]
});

describe("MPX-offer — \"any opponent may pay 2\": offered to each opponent in turn, the first to pay settles it", () => {
  const SMASH = tactic({
    name: "Smash",
    behavior: ACTIVATED({
      targets: [{ id: "t", selector: { type: "character", controller: "self", zone: "play" }, count: 1 }],
      effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
    })
  });

  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);
    /** P1 smashes its own Necromorph (carrying 2 damage); `poor` are opponents with no resources to pay with. */
    const smash = (poor: PlayerId[] = []): Table => {
      const t = board(count, SMASH, [
        { key: "necro", def: NECROMORPH, owner: P1, zone: "play", damage: 2 },
        ...opponents.filter(seat => !poor.includes(seat)).flatMap(owner => [0, 1].map(i => ({ key: `pay-${owner}-${i}`, def: resourceCard({ name: `Pay ${owner} ${i}` }), owner })))
      ]);
      t.engine.perform(play(t, { selected: { t: [t.id("necro")] } }));
      resolvePendingResponses(t.engine);
      return t;
    };
    const answer = (t: Table, who: PlayerId, apply: boolean): void =>
      t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "replacementChoice", apply } });
    const necro = (t: Table) => t.engine.state.cards[t.id("necro")]!;

    rule(["MPX-offer"], `${count} seats: the offer goes to the first opponent clockwise; if they pay they take control, damage is reduced to 0 and nobody else is asked`, () => {
      const t = smash();
      assert.equal(pending(t)?.kind, "replacementChoice");
      assert.equal(pending(t)?.playerId, opponents[0], "clockwise from the controller's left");
      answer(t, opponents[0]!, true);
      assert.equal(pending(t), undefined, "the rest are not asked");
      assert.equal(necro(t).zone, "play");
      assert.equal(necro(t).controllerId, opponents[0]);
      assert.equal(necro(t).damage, 0);
    });

    rule(["MPX-offer"], `${count} seats: each opponent who declines passes the offer on; the one who pays last settles it`, () => {
      const t = smash();
      for (const decliner of opponents.slice(0, -1)) {
        assert.equal(pending(t)?.playerId, decliner);
        answer(t, decliner, false);
      }
      const last = opponents[opponents.length - 1]!;
      assert.equal(pending(t)?.playerId, last);
      answer(t, last, true);
      assert.equal(necro(t).controllerId, last, "\"that player\" is the one who paid");
      assert.equal(necro(t).zone, "play");
    });

    rule(["MPX-offer"], `${count} seats: if every opponent declines the Necromorph is destroyed`, () => {
      const t = smash();
      for (const decliner of opponents) {
        assert.equal(pending(t)?.playerId, decliner);
        answer(t, decliner, false);
      }
      assert.equal(pending(t), undefined);
      assert.equal(necro(t).zone, "discard");
    });

    rule(["MPX-offer"], `${count} seats: an opponent who cannot pay 2 is not offered it`, () => {
      const t = smash([opponents[0]!]);
      if (count === 2) {
        assert.equal(pending(t), undefined, "the only opponent cannot pay: destroyed");
        assert.equal(necro(t).zone, "discard");
      } else {
        assert.equal(pending(t)?.playerId, opponents[1], "the opponent with no resources is skipped");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Items 6 and 12: I Drink Your Milkshake! The card remembers what it removed, and (Seed Saga) whom it searched.
// ---------------------------------------------------------------------------

const NAME_MATCH: Condition = { type: "cardNameEquals", target: { type: "selected", id: "__candidate" }, other: "eventCard" };
const NOT_A_RESOURCE: Condition = { type: "not", condition: { type: "cardTypeIs", target: "eventCard", cardType: "resource" } };

/** The echo both printings share, parameterised by who may trigger it and how the removed card is found. */
const echo = (when: Condition, removed: Record<string, unknown>): Record<string, unknown> => ({
  id: "milkshake-echo",
  type: "triggered",
  triggerFromAnyZone: true,
  event: "cardPlayed",
  condition: { type: "and", conditions: [when, NOT_A_RESOURCE] },
  effects: [
    {
      type: "chooserSelectsTarget",
      chooser: "controller",
      declaration: { id: "voided", selector: { zone: "removed", conditions: [NAME_MATCH], ...removed }, count: 1, optional: true },
      effects: [
        {
          type: "if",
          condition: { type: "targetExists", target: { type: "selected", id: "voided" } },
          effects: [
            { type: "revealCards", selected: "voided" },
            { type: "deployFromZone", player: "controller", target: { type: "selected", id: "voided" }, ignoreThreshold: true, afterDeploy: [{ type: "terminate", scope: "target", target: "eventCard" }] }
          ]
        }
      ]
    }
  ]
});

/** Seed 2 ("search your opponent's deck ... if your opponent plays a card"): any opponent's play triggers it, and it finds the card this card removed. */
const MILKSHAKE_SEED_2 = tactic({
  name: "I Drink Your Milkshake! (Seed 2)",
  behavior: {
    abilities: [
      {
        id: "milkshake-play",
        type: "activated",
        targets: [{ id: "dig", selector: { owner: "opponent", zone: "deck" }, count: 1, optional: true }],
        effects: [
          { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "dig" } }, effects: [{ type: "moveCard", target: { type: "selected", id: "dig" }, to: "removed", faceDown: true }] },
          { type: "shuffleDeck", player: "opponent" }
        ]
      },
      echo({ type: "eventPlayerIs", player: "opponent" }, { voidedBySource: true })
    ]
  } as unknown as CardDefinition["behavior"]
});

/** Seed Saga ("search an opponent's deck ... when that opponent deploys a card"): remembers the opponent it searched. */
const MILKSHAKE_SAGA = tactic({
  name: "I Drink Your Milkshake! (Seed Saga)",
  behavior: {
    abilities: [
      {
        id: "milkshake-play",
        type: "activated",
        playerChoices: [{ id: "searched", from: "opponents" }],
        targets: [
          {
            id: "dig",
            selector: { zone: "deck", conditions: [{ type: "targetOwnedBy", target: { type: "selected", id: "__candidate" }, player: { type: "chosenPlayer", id: "searched" } }] },
            count: 1,
            optional: true
          }
        ],
        effects: [
          { type: "rememberPlayer", key: "searched", player: { type: "chosenPlayer", id: "searched" } },
          { type: "if", condition: { type: "targetExists", target: { type: "selected", id: "dig" } }, effects: [{ type: "moveCard", target: { type: "selected", id: "dig" }, to: "removed", faceDown: true }] },
          { type: "shuffleDeck", player: { type: "chosenPlayer", id: "searched" } }
        ]
      },
      echo({ type: "eventPlayerIs", player: { type: "rememberedPlayer", key: "searched" } }, { voidedBySource: true })
    ]
  } as unknown as CardDefinition["behavior"]
});

describe("MPX-trigger-condition / MPX-vocab-your — I Drink Your Milkshake!: the removed card is the one this card removed", () => {
  const FOO = (owner: PlayerId) => character({ name: "Foo", id: `foo-${owner}` });
  const names = (t: Table, who: PlayerId): string[] => t.engine.state.players[who]!.play.map(id => t.engine.getDefinition(id).name);

  /** P1 plays `milkshake`, searching `searched` (their deck holds a Foo). Every seat has a Foo in hand. */
  const searched = (count: number, milkshake: CardDefinition, victim: PlayerId): Table => {
    const t = board(count, milkshake, [
      { key: "deck-foo", def: FOO(victim), owner: victim, zone: "deck" },
      ...seatsFor(count)
        .slice(1)
        .map(owner => ({ key: `hand-foo-${owner}`, def: character({ name: "Foo", id: `hand-foo-${owner}` }), owner, zone: "hand" as const }))
    ]);
    t.engine.perform(play(t, { ...(count > 2 ? { players: { ...(milkshake === MILKSHAKE_SAGA ? { searched: victim } : { opponent: victim }) } } : {}), selected: { dig: [t.id("deck-foo")] } }));
    resolvePendingResponses(t.engine);
    assert.equal(t.engine.state.cards[t.id("deck-foo")]!.zone, "removed", "the searched card was removed from the game");
    return t;
  };

  /** `who` plays their Foo on their own turn; P1 then answers the echo, taking the removed card if `take`. */
  const echoBy = (t: Table, who: PlayerId, take: boolean): void => {
    t.engine.state.activePlayerId = who;
    t.engine.state.priorityPlayerId = who;
    t.engine.perform({ type: "playCard", playerId: who, cardId: t.id(`hand-foo-${who}`) });
    resolvePendingResponses(t.engine);    if (t.engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      assert.equal(t.engine.state.pendingChoice.playerId, P1);
      t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: take ? [t.id("deck-foo")] : [] } });
      if (take) {
        assert.equal(t.engine.state.pendingChoice?.kind, "deployForFree");
        t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: t.id("deck-foo"), selected: {} } });
      }
      resolvePendingResponses(t.engine);
    }
  };

  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);

    for (const who of opponents) {
      rule(["MPX-trigger-condition", "MPX-vocab-your"], `${count} seats, Seed 2: ${who} plays a Foo after P2's deck was searched: the echo fires for ${who} and terminates ${who}'s card with the card removed from P2's deck`, () => {
        const t = searched(count, MILKSHAKE_SEED_2, P2);
        echoBy(t, who, true);
        assert.equal(t.engine.state.cards[t.id("deck-foo")]!.zone, "play");
        assert.equal(t.engine.state.cards[t.id("deck-foo")]!.controllerId, P1, "P1 deployed it");
        assert.equal(t.engine.state.cards[t.id(`hand-foo-${who}`)]!.zone, "discard", `${who}'s card was terminated`);
        assert.equal(names(t, P1).filter(name => name === "Foo").length, 1);
      });
    }

    rule(["MPX-trigger-condition", "MPX-vocab-your"], `${count} seats, Seed 2: a card played by P1 does not trigger it, nor does a resource`, () => {
      const t = searched(count, MILKSHAKE_SEED_2, P2);
      const own = tactic({ name: "Own play" });
      const withOwn = board(count, MILKSHAKE_SEED_2, [
        { key: "deck-foo", def: FOO(P2), owner: P2, zone: "deck" },
        { key: "own-foo", def: character({ name: "Foo", id: "own-foo" }), owner: P1, zone: "hand" },
        { key: "own", def: own, owner: P1, zone: "hand" }
      ]);
      withOwn.engine.perform(play(withOwn, { ...(count > 2 ? { players: { opponent: P2 } } : {}), selected: { dig: [withOwn.id("deck-foo")] } }));
      resolvePendingResponses(withOwn.engine);
      withOwn.engine.perform({ type: "playCard", playerId: P1, cardId: withOwn.id("own-foo") });
      resolvePendingResponses(withOwn.engine);
      assert.equal(withOwn.engine.state.pendingChoice, undefined, "P1's own Foo does not trigger the echo");
      assert.equal(withOwn.engine.state.cards[withOwn.id("deck-foo")]!.zone, "removed");
      assert.equal(t.engine.state.cards[t.id("deck-foo")]!.zone, "removed");
    });
  }

  for (const count of [3, 4]) {
    const opponents = seatsFor(count).slice(1);

    for (const victim of opponents) {
      rule(["MPX-vocab-your", "MPX-vocab-an"], `${count} seats, Seed Saga: P1 searches ${victim}'s deck: only ${victim}'s plays trigger the echo`, () => {
        const t = searched(count, MILKSHAKE_SAGA, victim);
        for (const other of opponents.filter(seat => seat !== victim)) {
          echoBy(t, other, true);
          assert.equal(t.engine.state.cards[t.id("deck-foo")]!.zone, "removed", `${other} is not the opponent searched`);
          assert.equal(t.engine.state.cards[t.id(`hand-foo-${other}`)]!.zone, "play", `${other}'s card stays`);
        }
        echoBy(t, victim, true);
        assert.equal(t.engine.state.cards[t.id("deck-foo")]!.zone, "play");
        assert.equal(t.engine.state.cards[t.id(`hand-foo-${victim}`)]!.zone, "discard", `${victim}'s card was terminated`);
      });
    }
  }

  rule(["MPX-vocab-your"], "2 seats, Seed Saga: the only opponent is searched with no choice and their play triggers it", () => {
    const t = searched(2, MILKSHAKE_SAGA, P2);
    echoBy(t, P2, true);
    assert.equal(t.engine.state.cards[t.id("deck-foo")]!.zone, "play");
  });
});

// ---------------------------------------------------------------------------
// Item 7: Stuttershy, "each opponent's faction gains 1 influence and you may put a Micromajig token into play under
// your control for each influence gained this way".
// ---------------------------------------------------------------------------

/** Stuttershy's flipped-down effects: each opponent's faction gains 1; the controller may put one token per influence gained. */
const STUTTERSHY_EFFECTS = [
  { type: "modifyInfluence", player: "opponents", amount: 1, tallyAs: "gained" },
  {
    type: "chooserSelectsOption",
    chooser: "controller",
    options: [
      { label: "Decline", effects: [] },
      {
        label: "Put Micromajig tokens into play",
        effects: [
          {
            type: "createTokens",
            controller: "controller",
            count: { type: "variable", id: "gained" },
            token: { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 }
          }
        ]
      }
    ]
  }
] as Effect[];

describe("MPX-vocab-each — \"for each influence gained this way\" counts what each opponent's faction actually gained", () => {
  const FLIP = tactic({ name: "Flip Stuttershy", behavior: ACTIVATED({ effects: STUTTERSHY_EFFECTS }) });
  const tokens = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.play.filter(id => t.engine.getDefinition(id).name === "Micromajig").length;
  const choose = (t: Table, index: number): void =>
    t.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index } });

  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);

    rule(["MPX-vocab-each"], `${count} seats: every opponent's faction gains 1 and the controller may put one token for each, ${count - 1} in all`, () => {
      const t = board(count, FLIP);
      const before = Object.fromEntries(seatsFor(count).map(seat => [seat, t.engine.state.players[seat]!.influence]));
      cast(t);
      assert.equal(pending(t)?.kind, "chooserSelectsOption");
      choose(t, 1);
      for (const opponent of opponents) assert.equal(t.engine.state.players[opponent]!.influence, before[opponent]! + 1, `${opponent} gained 1`);
      assert.equal(t.engine.state.players[P1]!.influence, before[P1], "the controller's faction does not gain");
      assert.equal(tokens(t, P1), opponents.length);
      for (const opponent of opponents) assert.equal(tokens(t, opponent), 0, "no opponent gets a token");
    });

    rule(["MPX-vocab-each"], `${count} seats: declining puts no token, but the influence is still gained`, () => {
      const t = board(count, FLIP);
      cast(t);
      choose(t, 0);
      assert.equal(tokens(t, P1), 0);
      for (const opponent of opponents) assert.equal(t.engine.state.players[opponent]!.influence, 26);
    });

    if (count === 4) {
      rule(["MPX-vocab-each", "MPX-elim"], "4 seats: an eliminated opponent gains nothing and adds no token", () => {
        const t = board(count, FLIP);
        t.engine.state.players[P4]!.eliminated = { turn: 1 };
        cast(t);
        choose(t, 1);
        assert.equal(tokens(t, P1), 2);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Item 9: a flipped coin's won / lost effects are an effect list: a player choice inside them pauses (Lecram).
// ---------------------------------------------------------------------------

import { buildGame, noDevelopFaction } from "../support/fixtures.js";

describe("MPX-vocab-an / MPX-select — a choice of a player inside a coin flip's effects pauses and the list goes on after the answer", () => {
  const FLIP = tactic({
    name: "Flip",
    behavior: ACTIVATED({
      effects: [
        {
          type: "flipCoin",
          winEffects: [
            { type: "choosePlayer", id: "victim", from: "opponents" },
            { type: "modifyInfluence", player: { type: "chosenPlayer", id: "victim" }, amount: -3 }
          ],
          loseEffects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
        },
        { type: "draw", player: "controller", amount: 1 }
      ] as Effect[]
    })
  });

  const flipTable = (count: number, roll: number) => {
    const built = buildGame({
      playerA: { faction: noDevelopFaction() },
      playerB: { faction: noDevelopFaction() },
      extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() })),
      random: () => roll,
      cards: [
        { key: "spell", def: FLIP, owner: P1, zone: "hand" },
        { key: "deck", def: tactic({ name: "Deck card" }), owner: P1, zone: "deck" }
      ]
    });
    return built;
  };

  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);

    rule(["MPX-vocab-an", "MPX-select"], `${count} seats: a won flip asks the controller which opponent, and the draw after the flip waits for the answer`, () => {
      const { engine, id } = flipTable(count, 0.1);
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
      resolvePendingResponses(engine);
      const handBefore = engine.state.players[P1]!.hand.length;
      if (count === 2) {
        assert.equal(engine.state.pendingChoice, undefined, "one opponent: nothing to choose");
        assert.equal(engine.state.players[P2]!.influence, 22);
        return;
      }
      assert.equal(engine.state.pendingChoice?.kind, "choosePlayer");
      assert.equal(engine.state.pendingChoice?.playerId, P1);
      assert.equal(engine.state.players[P1]!.hand.length, handBefore, "the draw has not happened yet");
      const chosen = opponents[opponents.length - 1]!;
      engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "choosePlayer", playerId: chosen } });
      for (const opponent of opponents) assert.equal(engine.state.players[opponent]!.influence, opponent === chosen ? 22 : 25, `${opponent}`);
      assert.equal(engine.state.players[P1]!.hand.length, handBefore + 1, "the draw happened after the answer");
    });

    rule(["MPX-vocab-an"], `${count} seats: a lost flip runs its own effects and asks nothing`, () => {
      const { engine, id } = flipTable(count, 0.9);
      engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
      resolvePendingResponses(engine);
      assert.equal(engine.state.pendingChoice, undefined);
      assert.equal(engine.state.players[P1]!.influence, 24);
    });
  }
});

// ---------------------------------------------------------------------------
// Item 10: a replacement whose effects run a `forEachPlayer` still replaces the destruction (Lucky Bastard).
// ---------------------------------------------------------------------------

describe("MPX-vocab-each / CR 506.1 — a replacement that iterates over the opponents replaces the destruction", () => {
  /** Lucky Bastard's shape: if destroyed, each opponent removes the top card of their deck, you draw, and the damage is reduced to 0. */
  const LUCKY = character({
    name: "Lucky",
    life: 3,
    behavior: {
      abilities: [
        {
          id: "lucky-gamble",
          type: "replacement",
          replaces: { event: "destroy" },
          effects: [
            { type: "forEachPlayer", players: "opponents", effects: [{ type: "removeFromGame", target: { type: "deckPosition", player: "controller", from: "top" } }] },
            { type: "draw", player: "controller", amount: 1 },
            { type: "setDamage", target: { type: "selected", id: "__candidate" }, amount: 0 }
          ],
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

  /** Lethal damage is what destroys it: the replacement runs from the state-based check, with the damage still on the card. */
  const HURT = tactic({
    name: "Hurt",
    behavior: ACTIVATED({
      targets: [{ id: "t", selector: { type: "character", controller: "self", zone: "play" }, count: 1 }],
      effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]
    })
  });
  for (const count of [2, 3, 4]) {
    rule(["MPX-vocab-each", "CR 506.1"], `${count} seats: lethal damage replaced by effects that iterate over the opponents leaves the card in play with 0 damage`, () => {
      const t = board(count, HURT, [
        { key: "lucky", def: LUCKY, owner: P1, zone: "play" },
        ...seatsFor(count).flatMap(owner => [0, 1].map(i => ({ key: `top-${owner}-${i}`, def: tactic({ name: `Deck ${owner} ${i}` }), owner, zone: "deck" as const })))
      ]);
      t.engine.perform(play(t, { selected: { t: [t.id("lucky")] } }));
      resolvePendingResponses(t.engine);
      const lucky = t.engine.state.cards[t.id("lucky")]!;
      assert.equal(lucky.zone, "play");
      assert.equal(lucky.damage, 0);
      for (const opponent of seatsFor(count).slice(1)) {
        assert.equal([0, 1].filter(i => t.engine.state.cards[t.id(`top-${opponent}-${i}`)]!.zone === "removed").length, 1, `${opponent} removed one card`);
      }
    });
  }

  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);
    rule(["MPX-vocab-each", "CR 506.1"], `${count} seats: the card stays in play with its damage reduced to 0, and every opponent removed their top card`, () => {
      const t = board(count, SMASH, [
        { key: "lucky", def: LUCKY, owner: P1, zone: "play", damage: 2 },
        ...seatsFor(count).flatMap(owner => [0, 1].map(i => ({ key: `top-${owner}-${i}`, def: tactic({ name: `Deck ${owner} ${i}` }), owner, zone: "deck" as const })))
      ]);
      const handBefore = t.engine.state.players[P1]!.hand.length;
      t.engine.perform(play(t, { selected: { t: [t.id("lucky")] } }));
      resolvePendingResponses(t.engine);
      const lucky = t.engine.state.cards[t.id("lucky")]!;
      assert.equal(lucky.zone, "play", "the destruction was replaced");
      assert.equal(lucky.damage, 0);
      for (const opponent of opponents) {
        const removed = [0, 1].filter(i => t.engine.state.cards[t.id(`top-${opponent}-${i}`)]!.zone === "removed");
        assert.equal(removed.length, 1, `${opponent} removed exactly one card`);
      }
      assert.equal(t.engine.state.players[P1]!.hand.length, handBefore - 1 + 1, "the controller played the tactic and drew one card");
    });
  }
});

// ---------------------------------------------------------------------------
// Item 8: Final Countdown's "At the start of your opponent's next turn ...", with the printed card's own behavior.
// ---------------------------------------------------------------------------

import { CARD_CATALOG } from "../../../data.js";

const REAL_COUNTDOWN = CARD_CATALOG.find(card => card.name === "Final Countdown" && card.type === "tactic")!;
/** The printed card's behavior, played for free so the table needs no resources. */
const FINAL_COUNTDOWN: CardDefinition = { ...REAL_COUNTDOWN, cost: 0, threshold: "" as CardDefinition["threshold"] };

describe("MPX-lasting / MPX-turn / MPX-select — Final Countdown asks for the opponent when played and fires at that opponent's next turn", () => {
  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);
    const countdownTable = (): Table =>
      board(count, FINAL_COUNTDOWN, [0, 1, 2, 3].map(i => ({ key: `deck-${i}`, def: tactic({ name: `Deck ${i}` }), owner: P1, zone: "deck" as const })));
    const endTurn = (t: Table): void => {
      t.engine.perform({ type: "endTurn", playerId: t.engine.state.activePlayerId });
      resolvePendingResponses(t.engine);
    };

    if (count > 2) {
      rule(["MPX-select", "MP 2"], `${count} seats: the opponent is the first thing asked when the card is played, offered to every other player`, () => {
        const t = countdownTable();
        const needs = t.engine.getPlayRequirements(play(t) as never);
        assert.equal(needs[0]!.kind, "players");
        if (needs[0]!.kind !== "players") return;
        assert.deepEqual(needs[0]!.choices, [{ id: "opponent", candidates: opponents }]);
      });
    }

    for (const chosen of opponents) {
      rule(["MPX-lasting", "MPX-turn"], `${count} seats, ${chosen} chosen: P1 draws 4 at once; nothing happens at the start of the other opponents' turns, and the choices come at the start of ${chosen}'s turn`, () => {
        const t = countdownTable();
        const handBefore = handSize(t, P1);
        t.engine.perform(play(t, count > 2 ? { players: { opponent: chosen } } : {}));
        resolvePendingResponses(t.engine);
        assert.equal(handSize(t, P1), handBefore - 1 + 4, "the card left the hand and four were drawn");
        for (const seat of opponents) {
          endTurn(t);
          assert.equal(t.engine.state.activePlayerId, seat);
          if (seat === chosen) {
            assert.equal(pending(t)?.kind, "chooserSelectsTarget", "P1 is asked what to detach");
            assert.equal(pending(t)?.playerId, P1);
            break;
          }
          assert.equal(pending(t), undefined, `${seat}'s turn start asks nothing`);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Item 1, the other constructs that park the rest of an unfinished step: a branch, a one-at-a-time loop over cards.
// ---------------------------------------------------------------------------

import { character as characterCard } from "../support/fixtures.js";

describe("MPX-vocab-each / CR 402.2 — whatever iterates, the effects after it wait for the last iteration", () => {
  const pickResource = (id: string): Effect => ({
    type: "chooserSelectsTarget",
    chooser: "controller",
    declaration: { id, selector: { controller: "self", zone: "play", type: "resource" }, count: 1 },
    effects: [{ type: "deplete", target: { type: "selected", id } }]
  });
  const ALWAYS: Condition = { type: "numberCompare", left: 1, operator: ">=", right: 1 };

  for (const count of [2, 3, 4]) {
    const opponents = seatsFor(count).slice(1);
    const attachEach: Effect = {
      type: "forEachPlayer",
      players: "opponents",
      effects: [
        {
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "r", selector: { owner: "self", zone: "play", type: "resource", attachedToFaction: false }, count: 1 },
          effects: [{ type: "attachTo", target: { type: "selected", id: "r" }, to: { type: "factionOf", player: "controller" } }]
        }
      ]
    };

    rule(["MPX-vocab-each", "CR 402.2"], `${count} seats: an iteration inside an \`if\` branch finishes for every opponent before the rest of the branch and what follows the \`if\``, () => {
      const spell = tactic({
        name: "Branching Swindle",
        behavior: ACTIVATED({
          effects: [
            { type: "if", condition: ALWAYS, effects: [attachEach, { type: "draw", player: "controller", amount: 1 }] },
            { type: "draw", player: "controller", amount: 1 }
          ] as Effect[]
        })
      });
      const t = swindleTable(count, spell);
      cast(t);
      const handBefore = handSize(t, P1);
      for (const opponent of opponents) {
        assert.equal(pending(t)?.playerId, opponent);
        assert.equal(handSize(t, P1), handBefore, "no draw while an opponent still has to act");
        answerTargets(t, opponent, `${opponent}-a`);
      }
      assert.equal(pending(t), undefined);
      assert.equal(handSize(t, P1), handBefore + 2, "both draws came after the last opponent");
    });

    rule(["MPX-vocab-each", "CR 402.2"], `${count} seats: a one-at-a-time loop over cards finishes every iteration before the effect after it`, () => {
      const spell = tactic({
        name: "Sequential",
        behavior: ACTIVATED({
          effects: [
            { type: "forEach", selector: { type: "character", controller: "self", zone: "play" }, sequential: true, effects: [pickResource("pick")] },
            { type: "draw", player: "controller", amount: 1 }
          ] as Effect[]
        })
      });
      const t = board(count, spell, [
        { key: "extra-1", def: characterCard({ name: "Extra 1" }), owner: P1 },
        { key: "extra-2", def: characterCard({ name: "Extra 2" }), owner: P1 },
        { key: "deck-1", def: tactic({ name: "Deck card" }), owner: P1, zone: "deck" }
      ]);
      cast(t);
      const handBefore = handSize(t, P1);
      for (const key of ["res-0", "res-1", "res-2"]) {
        assert.equal(pending(t)?.kind, "chooserSelectsTarget", `the pick for ${key}`);
        assert.equal(handSize(t, P1), handBefore, "no draw while an iteration is still to come");
        answerTargets(t, P1, key);
      }
      assert.equal(pending(t), undefined);
      assert.equal(handSize(t, P1), handBefore + 1);
    });
  }
});
