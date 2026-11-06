// "Put it into YOUR hand" / "shuffle it into YOUR deck" (moveCard.toPlayer,
// moveSelected.toPlayer, CardInstance.heldBy). Some printings send a card to
// the effect controller's hand or deck instead of its owner's; the two only
// differ for a card you control but don't own (CR §407.7–407.8: ownership
// never changes). Synthetic fixtures only — the per-printing cards are covered
// in per-card/printed-variants.test.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { AbilityDefinition, CardSelector, Effect, SpoilsEngine } from "../../engine.js";
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

/** A character with a single no-cost activated ability per entry, id = key. */
function operator(abilities: Record<string, Pick<Extract<AbilityDefinition, { type: "activated" }>, "targets" | "effects">>) {
  return character({
    name: "Operator",
    behavior: {
      abilities: Object.entries(abilities).map(([abilityId, a]) => ({
        id: abilityId,
        type: "activated" as const,
        ...a
      }))
    }
  });
}

const PICK_CONTROLLED_RESOURCE = [
  { id: "res", selector: { controller: "self", type: "resource" } as CardSelector, count: 1 }
];
const RES = { type: "selected", id: "res" } as const;

function activate(
  engine: SpoilsEngine,
  cardId: string,
  abilityId: string,
  selected: Record<string, string[]> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: P1, cardId, abilityId, selected });
  resolvePendingResponses(engine);
}

/** P1 controls a resource owned by P2, plus an Operator carrying `abilities`. */
function stolenResourceGame(
  abilities: Parameters<typeof operator>[0],
  extra: NonNullable<Parameters<typeof buildGame>[0]>["cards"] = []
) {
  return buildGame({
    cards: [
      { key: "op", def: operator(abilities), owner: P1, zone: "play" },
      {
        key: "res",
        def: resourceCard({ name: "Borrowed Resource" }),
        owner: P2,
        controller: P1,
        zone: "play"
      },
      ...extra
    ]
  });
}

const TO_MY_HAND: Effect = { type: "moveCard", target: RES, to: "hand", toPlayer: "controller" };

describe("moveCard.toPlayer — a card you control but don't own goes into YOUR hand", () => {
  test("it lands in the controller's hand, controlled by them; ownership is untouched", () => {
    const { engine, id } = stolenResourceGame({ go: { targets: PICK_CONTROLLED_RESOURCE, effects: [TO_MY_HAND] } });
    activate(engine, id("op"), "go", { res: [id("res")] });

    const card = engine.state.cards[id("res")];
    assert.equal(card.zone, "hand");
    assert.equal(card.ownerId, P2);
    assert.equal(card.controllerId, P1);
    assert.equal(card.heldBy, P1);
    assert.ok(engine.state.players[P1].hand.includes(id("res")), "engine.state.players[P1].hand.includes(id(\"res\"))");
    assert.ok(!engine.state.players[P2].hand.includes(id("res")), "!engine.state.players[P2].hand.includes(id(\"res\"))");
    assert.ok(!engine.state.players[P1].play.includes(id("res")), "!engine.state.players[P1].play.includes(id(\"res\"))");
  });

  test("without toPlayer the same card still goes to its owner's hand (CR 301.4a)", () => {
    const { engine, id } = stolenResourceGame({
      go: {
        targets: PICK_CONTROLLED_RESOURCE,
        effects: [{ type: "moveCard", target: RES, to: "hand" }]
      }
    });
    activate(engine, id("op"), "go", { res: [id("res")] });

    const card = engine.state.cards[id("res")];
    assert.equal(card.zone, "hand");
    assert.equal(card.heldBy, undefined);
    assert.ok(engine.state.players[P2].hand.includes(id("res")), "engine.state.players[P2].hand.includes(id(\"res\"))");
    assert.ok(!engine.state.players[P1].hand.includes(id("res")), "!engine.state.players[P1].hand.includes(id(\"res\"))");
  });

  test("toPlayer on a card you own is just your own hand (no heldBy)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "op", def: operator({ go: { targets: PICK_CONTROLLED_RESOURCE, effects: [TO_MY_HAND] } }), owner: P1 },
        { key: "res", def: resourceCard({ name: "Mine" }), owner: P1 }
      ]
    });
    activate(engine, id("op"), "go", { res: [id("res")] });
    assert.equal(engine.state.cards[id("res")].heldBy, undefined);
    assert.ok(engine.state.players[P1].hand.includes(id("res")), "engine.state.players[P1].hand.includes(id(\"res\"))");
  });

  test("toPlayer is ignored for zones that always belong to the owner", () => {
    const { engine, id } = stolenResourceGame({
      go: {
        targets: PICK_CONTROLLED_RESOURCE,
        effects: [{ type: "moveCard", target: RES, to: "discard", toPlayer: "controller" }]
      }
    });
    activate(engine, id("op"), "go", { res: [id("res")] });

    const card = engine.state.cards[id("res")];
    assert.equal(card.zone, "discard");
    assert.equal(card.heldBy, undefined);
    assert.ok(engine.state.players[P2].discard.includes(id("res")), "engine.state.players[P2].discard.includes(id(\"res\"))");
    assert.ok(!engine.state.players[P1].discard.includes(id("res")), "!engine.state.players[P1].discard.includes(id(\"res\"))");
  });

  test("a deck destination honors toPlayer and position", () => {
    const { engine, id } = stolenResourceGame(
      {
        go: {
          targets: PICK_CONTROLLED_RESOURCE,
          effects: [{ type: "moveCard", target: RES, to: "deck", position: "top", toPlayer: "controller" }]
        }
      },
      [{ key: "d1", def: tactic({ name: "Under" }), owner: P1, zone: "deck" }]
    );
    activate(engine, id("op"), "go", { res: [id("res")] });

    assert.deepEqual(engine.state.players[P1].deck, [id("res"), id("d1")]);
    assert.equal(engine.state.cards[id("res")].heldBy, P1);
    assert.deepEqual(engine.state.players[P2].deck, []);
  });
});

describe("a card held in a non-owner's hand or deck behaves as that player's card", () => {
  test("'a card in your hand' (owner: self) finds it; 'owner: opponent' does not", () => {
    const { engine, id } = stolenResourceGame({ go: { targets: PICK_CONTROLLED_RESOURCE, effects: [TO_MY_HAND] } });
    activate(engine, id("op"), "go", { res: [id("res")] });

    const ctxP1 = { sourceId: id("op"), controllerId: P1, selected: {} };
    const ctxP2 = { sourceId: id("op"), controllerId: P2, selected: {} };
    const ids = (selector: CardSelector, ctx: typeof ctxP1) =>
      engine.queryCards(selector, ctx).map(c => c.id);

    assert.deepEqual(ids({ owner: "self", zone: "hand" }, ctxP1), [id("res")]);
    assert.deepEqual(ids({ controller: "self", zone: "hand" }, ctxP1), [id("res")]);
    assert.deepEqual(ids({ owner: "opponent", zone: "hand" }, ctxP1), []);
    // From the true owner's seat it is the opponent's hand, not theirs.
    assert.deepEqual(ids({ owner: "self", zone: "hand" }, ctxP2), []);
    assert.deepEqual(ids({ owner: "opponent", zone: "hand" }, ctxP2), [id("res")]);
  });

  test("it can be played as a resource and enters play under the holder's control", () => {
    const { engine, id } = stolenResourceGame({
      go: {
        targets: PICK_CONTROLLED_RESOURCE,
        effects: [
          TO_MY_HAND,
          {
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: { id: "play", selector: { owner: "self", zone: "hand" }, count: 1, optional: true },
            effects: [
              { type: "playResource", target: { type: "selected", id: "play" }, faceDown: "auto", player: "controller" }
            ]
          }
        ]
      }
    });
    activate(engine, id("op"), "go", { res: [id("res")] });
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("res")], faceDown: false }
    });
    resolvePendingResponses(engine);

    const card = engine.state.cards[id("res")];
    assert.equal(card.zone, "play");
    assert.equal(card.controllerId, P1);
    assert.equal(card.ownerId, P2);
    assert.equal(card.heldBy, undefined);
    assert.ok(engine.state.players[P1].play.includes(id("res")), "engine.state.players[P1].play.includes(id(\"res\"))");
    assert.ok(!engine.state.players[P2].play.includes(id("res")), "!engine.state.players[P2].play.includes(id(\"res\"))");
  });

  test("discarding it sends it to its owner's discard pile; the holder is the one who discarded", () => {
    const { engine, id } = stolenResourceGame({
      go: { targets: PICK_CONTROLLED_RESOURCE, effects: [TO_MY_HAND] },
      dump: {
        targets: [{ id: "h", selector: { owner: "self", zone: "hand" }, count: 1 }],
        effects: [{ type: "moveCard", target: { type: "selected", id: "h" }, to: "discard" }]
      }
    });
    activate(engine, id("op"), "go", { res: [id("res")] });
    activate(engine, id("op"), "dump", { h: [id("res")] });

    const card = engine.state.cards[id("res")];
    assert.equal(card.zone, "discard");
    assert.equal(card.heldBy, undefined);
    assert.ok(engine.state.players[P2].discard.includes(id("res")), "engine.state.players[P2].discard.includes(id(\"res\"))");
    assert.ok(!engine.state.players[P1].hand.includes(id("res")), "!engine.state.players[P1].hand.includes(id(\"res\"))");
    assert.ok(!engine.state.players[P1].discard.includes(id("res")), "!engine.state.players[P1].discard.includes(id(\"res\"))");

    const discards = engine.getLog().filter(e => e.event?.type === "cardsDiscarded");
    assert.equal(discards.length, 1);
    assert.equal((discards[0].event as { playerId: string }).playerId, P1);
  });

  test("a default move out of the holder's hand into a deck goes to its owner's deck, controlled by the owner again", () => {
    const { engine, id } = stolenResourceGame({
      go: { targets: PICK_CONTROLLED_RESOURCE, effects: [TO_MY_HAND] },
      back: {
        targets: [{ id: "h", selector: { owner: "self", zone: "hand" }, count: 1 }],
        effects: [{ type: "moveCard", target: { type: "selected", id: "h" }, to: "deck" }]
      }
    });
    activate(engine, id("op"), "go", { res: [id("res")] });
    activate(engine, id("op"), "back", { h: [id("res")] });

    const card = engine.state.cards[id("res")];
    assert.equal(card.zone, "deck");
    assert.equal(card.heldBy, undefined);
    assert.equal(card.controllerId, P2);
    assert.deepEqual(engine.state.players[P2].deck, [id("res")]);
    assert.ok(!engine.state.players[P1].hand.includes(id("res")), "!engine.state.players[P1].hand.includes(id(\"res\"))");
  });

  test("a hand-to-hand move with no toPlayer leaves it where it is; naming the owner hands it over", () => {
    const { engine, id } = stolenResourceGame({
      go: { targets: PICK_CONTROLLED_RESOURCE, effects: [TO_MY_HAND] },
      stay: {
        targets: [{ id: "h", selector: { owner: "self", zone: "hand" }, count: 1 }],
        effects: [{ type: "moveCard", target: { type: "selected", id: "h" }, to: "hand" }]
      },
      give: {
        targets: [{ id: "h", selector: { owner: "self", zone: "hand" }, count: 1 }],
        effects: [{ type: "moveCard", target: { type: "selected", id: "h" }, to: "hand", toPlayer: "opponent" }]
      }
    });
    activate(engine, id("op"), "go", { res: [id("res")] });
    activate(engine, id("op"), "stay", { h: [id("res")] });
    assert.equal(engine.state.cards[id("res")].heldBy, P1);
    assert.ok(engine.state.players[P1].hand.includes(id("res")), "engine.state.players[P1].hand.includes(id(\"res\"))");

    activate(engine, id("op"), "give", { h: [id("res")] });
    const card = engine.state.cards[id("res")];
    assert.equal(card.zone, "hand");
    assert.equal(card.heldBy, undefined);
    assert.equal(card.controllerId, P2);
    assert.deepEqual(engine.state.players[P2].hand, [id("res")]);
    assert.deepEqual(engine.state.players[P1].hand, []);
  });

  test("a non-resource card held in your hand is deployable by you, and stays the owner's", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "op",
          def: operator({
            go: {
              targets: [{ id: "res", selector: { controller: "self", type: "item" }, count: 1 }],
              effects: [TO_MY_HAND]
            }
          }),
          owner: P1
        },
        { key: "res", def: item({ name: "Stolen Gadget", cost: 0 }), owner: P2, controller: P1 }
      ]
    });
    activate(engine, id("op"), "go", { res: [id("res")] });
    assert.equal(engine.state.cards[id("res")].zone, "hand");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("res") });
    resolvePendingResponses(engine);
    // P1 deployed the card it holds, and controls it in play; P2 still owns it.
    const card = engine.state.cards[id("res")];
    assert.equal(card.zone, "play");
    assert.equal(card.controllerId, P1);
    assert.equal(card.ownerId, P2);
    assert.ok(engine.state.players[P1].play.includes(id("res")), "engine.state.players[P1].play.includes(id(\"res\"))");
  });

  test("drawing it from the holder's deck puts it in the holder's hand, still held", () => {
    const { engine, id } = stolenResourceGame({
      go: {
        targets: PICK_CONTROLLED_RESOURCE,
        effects: [
          { type: "moveCard", target: RES, to: "deck", position: "top", toPlayer: "controller" },
          { type: "draw", player: "controller", amount: 1 }
        ]
      }
    });
    activate(engine, id("op"), "go", { res: [id("res")] });

    const card = engine.state.cards[id("res")];
    assert.equal(card.zone, "hand");
    assert.equal(card.heldBy, P1);
    assert.deepEqual(engine.state.players[P1].hand, [id("res")]);
    assert.deepEqual(engine.state.players[P1].deck, []);
  });

  test("'top N of your deck' (fromTop) and 'owner: self, zone: deck' see it in the holder's deck", () => {
    const { engine, id } = stolenResourceGame(
      {
        go: {
          targets: PICK_CONTROLLED_RESOURCE,
          effects: [{ type: "moveCard", target: RES, to: "deck", position: "top", toPlayer: "controller" }]
        }
      },
      [{ key: "d1", def: tactic({ name: "Under" }), owner: P1, zone: "deck" }]
    );
    activate(engine, id("op"), "go", { res: [id("res")] });

    const ctx = { sourceId: id("op"), controllerId: P1, selected: {} };
    assert.deepEqual(
      engine.queryCards({ owner: "self", zone: "deck", fromTop: 1 }, ctx).map(c => c.id),
      [id("res")]
    );
    assert.deepEqual(
      engine.queryCards({ owner: "self", zone: "deck" }, ctx).map(c => c.id).sort(),
      [id("d1"), id("res")].sort()
    );
    assert.deepEqual(engine.queryCards({ owner: "opponent", zone: "deck" }, ctx), []);
  });

  test("searching your deck finds it, and the search is of the holder's deck", () => {
    const { engine, id } = stolenResourceGame(
      {
        go: {
          targets: PICK_CONTROLLED_RESOURCE,
          effects: [
            { type: "moveCard", target: RES, to: "deck", toPlayer: "controller" },
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: {
                id: "found",
                selector: { owner: "self", zone: "deck", name: "Borrowed Resource" },
                count: 1,
                optional: true
              },
              effects: [{ type: "moveCard", target: { type: "selected", id: "found" }, to: "hand", toPlayer: "controller" }]
            }
          ]
        }
      },
      [{ key: "d1", def: tactic({ name: "Under" }), owner: P1, zone: "deck" }]
    );
    activate(engine, id("op"), "go", { res: [id("res")] });
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("res")] }
    });
    resolvePendingResponses(engine);

    assert.deepEqual(engine.state.players[P1].hand, [id("res")]);
    assert.equal(engine.state.cards[id("res")].heldBy, P1);
    const searched = engine.getLog().filter(e => e.event?.type === "deckSearched");
    assert.equal(searched.length, 1);
    assert.equal((searched[0].event as { playerId: string }).playerId, P1);
  });

  test("'put the top card of your deck on the bottom' repositions it within the holder's deck", () => {
    const { engine, id } = stolenResourceGame(
      {
        go: {
          targets: PICK_CONTROLLED_RESOURCE,
          effects: [{ type: "moveCard", target: RES, to: "deck", position: "top", toPlayer: "controller" }]
        },
        bottom: {
          effects: [
            {
              type: "moveCard",
              target: { type: "deckPosition", player: "controller", from: "top", index: 0 },
              to: "deck",
              position: "bottom"
            }
          ]
        }
      },
      [{ key: "d1", def: tactic({ name: "Under" }), owner: P1, zone: "deck" }]
    );
    activate(engine, id("op"), "go", { res: [id("res")] });
    assert.deepEqual(engine.state.players[P1].deck, [id("res"), id("d1")]);
    activate(engine, id("op"), "bottom");
    assert.deepEqual(engine.state.players[P1].deck, [id("d1"), id("res")]);
    assert.equal(engine.state.cards[id("res")].heldBy, P1);
  });
});

describe("hand-entry restrictions follow the receiving player, not the owner", () => {
  const lockbox = item({
    name: "Lockbox",
    behavior: {
      abilities: [
        {
          id: "seal",
          type: "continuous",
          modifiers: [],
          restrictReturnToHand: { player: "opponent", fromZones: ["play"] }
        }
      ]
    }
  });

  test("a lockbox against the opponent's hand blocks a default (owner) return but not your own hand", () => {
    // P1's Lockbox: "cards cannot be put into your opponents' hands from play".
    const defaultMove = stolenResourceGame(
      { go: { targets: PICK_CONTROLLED_RESOURCE, effects: [{ type: "moveCard", target: RES, to: "hand" }] } },
      [{ key: "lock", def: lockbox, owner: P1, zone: "play" }]
    );
    activate(defaultMove.engine, defaultMove.id("op"), "go", { res: [defaultMove.id("res")] });
    // Owner is P2 (P1's opponent): the move fizzles.
    assert.equal(defaultMove.engine.state.cards[defaultMove.id("res")].zone, "play");

    const intoMine = stolenResourceGame(
      { go: { targets: PICK_CONTROLLED_RESOURCE, effects: [TO_MY_HAND] } },
      [{ key: "lock", def: lockbox, owner: P1, zone: "play" }]
    );
    activate(intoMine.engine, intoMine.id("op"), "go", { res: [intoMine.id("res")] });
    // Same card, but it is P1's own hand receiving it.
    assert.equal(intoMine.engine.state.cards[intoMine.id("res")].zone, "hand");
    assert.equal(intoMine.engine.state.cards[intoMine.id("res")].heldBy, P1);
  });

  test("a hand-redirect window aimed at the opponent leaves a card going into your own hand alone", () => {
    const redirect = (toPlayer: boolean) => {
      const game = stolenResourceGame(
        {
          arm: { effects: [{ type: "redirectHandMoves", who: "opponent", to: "discard", duration: { type: "untilEndOfTurn" } }] },
          go: {
            targets: PICK_CONTROLLED_RESOURCE,
            effects: [
              toPlayer ? TO_MY_HAND : { type: "moveCard", target: RES, to: "hand" }
            ]
          }
        }
      );
      activate(game.engine, game.id("op"), "arm");
      activate(game.engine, game.id("op"), "go", { res: [game.id("res")] });
      return game.engine.state.cards[game.id("res")];
    };

    // Into the opponent's (owner's) hand: redirected to the owner's discard pile.
    assert.equal(redirect(false).zone, "discard");
    // Into the caster's own hand: not an opponent's hand, so not redirected.
    const mine = redirect(true);
    assert.equal(mine.zone, "hand");
    assert.equal(mine.heldBy, P1);
  });
});

describe("moveSelected.toPlayer — 'shuffle this card into your deck' as a cost", () => {
  const tuckingItem = (toPlayer: "controller" | undefined) =>
    item({
      name: "Trinket",
      behavior: {
        abilities: [
          {
            id: "tuck",
            type: "activated",
            costs: [
              {
                type: "moveSelected",
                id: "self",
                player: "controller",
                selector: { name: "__self" },
                count: 1,
                to: "deck",
                ...(toPlayer ? { toPlayer } : {}),
                shuffle: true
              }
            ],
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      }
    });
  const decks = () => [
    { key: "m1", def: tactic({ name: "M1" }), owner: P1, zone: "deck" as const },
    { key: "m2", def: tactic({ name: "M2" }), owner: P1, zone: "deck" as const },
    { key: "m3", def: tactic({ name: "M3" }), owner: P1, zone: "deck" as const },
    { key: "t1", def: tactic({ name: "T1" }), owner: P2, zone: "deck" as const },
    { key: "t2", def: tactic({ name: "T2" }), owner: P2, zone: "deck" as const },
    { key: "t3", def: tactic({ name: "T3" }), owner: P2, zone: "deck" as const }
  ];

  test("a card you control but don't own goes into YOUR deck and that deck is the one shuffled", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "trinket", def: tuckingItem("controller"), owner: P2, controller: P1, zone: "play" }, ...decks()],
      random: () => 0 // every Fisher–Yates swap targets index 0, so a shuffle visibly reorders
    });
    const p1Before = [...engine.state.players[P1].deck];
    const p2Before = [...engine.state.players[P2].deck];

    activate(engine, id("trinket"), "tuck");

    const card = engine.state.cards[id("trinket")];
    assert.equal(card.zone, "deck");
    assert.equal(card.heldBy, P1);
    assert.equal(card.ownerId, P2);
    assert.deepEqual([...engine.state.players[P1].deck].sort(), [...p1Before, id("trinket")].sort());
    assert.notDeepEqual(engine.state.players[P1].deck, [...p1Before, id("trinket")], "P1's deck was shuffled");
    assert.deepEqual(engine.state.players[P2].deck, p2Before, "P2's deck was neither entered nor shuffled");
  });

  test("with no toPlayer the same cost shuffles the card into its OWNER's deck and shuffles that deck", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "trinket", def: tuckingItem(undefined), owner: P2, controller: P1, zone: "play" }, ...decks()],
      random: () => 0
    });
    const p1Before = [...engine.state.players[P1].deck];
    const p2Before = [...engine.state.players[P2].deck];

    activate(engine, id("trinket"), "tuck");

    const card = engine.state.cards[id("trinket")];
    assert.equal(card.zone, "deck");
    assert.equal(card.heldBy, undefined);
    assert.deepEqual([...engine.state.players[P2].deck].sort(), [...p2Before, id("trinket")].sort());
    assert.notDeepEqual(engine.state.players[P2].deck, [...p2Before, id("trinket")], "P2's deck was shuffled");
    assert.deepEqual(engine.state.players[P1].deck, p1Before, "P1's deck was untouched");
  });
});
