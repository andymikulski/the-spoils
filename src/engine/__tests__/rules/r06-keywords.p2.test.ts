// Batch r06-keywords (docs/TESTING.md): CR 507.4 Flip Up.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, character, item, location, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import type { BuildGameOptions } from "../support/fixtures.js";
import { refused, rule, ruleOpen } from "./_rule.js";

type Placement = NonNullable<BuildGameOptions["cards"]>[number];

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;

/** Face-up rage resources owned by `owner`, keys `<tag>0`, `<tag>1`, ... */
function rageBank(count: number, tag = "bank", owner: PlayerId = P1): Placement[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `${tag}${i}`,
    def: resourceCard({ name: `${tag}${i}`, resource: { provides: ["rage"], staple: true } }),
    owner
  }));
}

/** Face-up greed resources owned by `owner`. */
function greedBank(count: number, tag = "greed", owner: PlayerId = P1): Placement[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `${tag}${i}`,
    def: resourceCard({ name: `${tag}${i}`, resource: { provides: ["greed"], staple: true } }),
    owner
  }));
}

/** How many resources `playerId` has spent: cards attached to their faction. */
function spent(engine: SpoilsEngine, playerId: PlayerId): number {
  const factionId = engine.state.players[playerId].factionId;
  return Object.values(engine.state.cards).filter(card => card.attachedTo === factionId && card.zone === "play").length;
}

/** A tactic with no effect. */
const blank = (name: string) => tactic({ name });

/** A face-down card's definition: a character with the given FLIP UP. */
const hidden = (flipUp: CardDefinition["flipUp"], extra: Partial<CardDefinition> = {}) =>
  character({ name: "Hidden", cost: 5, flipUp, ...extra });

/** The opponent (active) attacks the first player's faction and passes: the first player now holds priority in a response window. */
function openOpponentWindow(engine: SpoilsEngine, attackerId: CardInstanceId): void {
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [attackerId], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the first player holds priority in the opponent's response window");
}

describe("CR 507.4 — flip up", () => {
  const flipBoard = (flipUp: CardDefinition["flipUp"], banks = 2, extra: Placement[] = []) =>
    buildGame({
      cards: [{ key: "fd", def: hidden(flipUp), owner: P1, faceDown: true }, ...rageBank(banks), ...extra]
    });

  rule("CR 507.4a", "a face-down card in play under your control with Flip Up may be played by paying its Flip Up cost and flipping it face-up", () => {
    const { engine, id } = flipBoard({ cost: 2, threshold: 0 });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd"), payWith: [id("bank0"), id("bank1")] });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("fd")), "play", "the card is in play");
    assert.equal(engine.state.cards[id("fd")]!.faceDown, false, "face-up");
    assert.equal(engine.state.cards[id("fd")]!.controllerId, P1);
    assert.equal(spent(engine, P1), 2, "its Flip Up cost of 2 was paid, printed cost 5 was not");
  });

  rule("CR 507.4a", "flipping up plays the card as though it were in your hand: a 'when you play a card' trigger sees it", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "w", type: "triggered", event: "cardPlayed", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
    });
    const { engine, id } = flipBoard({ cost: 1, threshold: 0 }, 2, [{ key: "watcher", def: watcher, owner: P1 }]);
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before + 1, "the card counts as played");
  });

  rule("CR 507.4a", "a flipped-up tactic is played like a tactic from hand: its effect happens and it goes to the discard pile", () => {
    const pinger = tactic({
      name: "Ping",
      cost: 4,
      flipUp: { cost: 1, threshold: 0 },
      behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] }] }
    });
    const { engine, id } = buildGame({ cards: [{ key: "fd", def: pinger, owner: P1, faceDown: true }, ...rageBank(1)] });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
    assert.equal(engine.state.players[P1].influence, before, "the effect waits for responses");
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before + 3, "the tactic's effect happened");
    assert.equal(zoneOf(engine, id("fd")), "discard", "and the tactic went to its owner's discard pile");
  });

  rule("CR 507.4a", "a face-up card in play cannot be flipped up (control: the same card face-down can)", () => {
    const faceUp = buildGame({ cards: [{ key: "fd", def: hidden({ cost: 1, threshold: 0 }), owner: P1 }, ...rageBank(2)] });
    refused(() => faceUp.engine.perform({ type: "flipUp", playerId: P1, cardId: faceUp.id("fd") }), "flip up a face-up card", /face-down/i);
    const faceDown = flipBoard({ cost: 1, threshold: 0 });
    faceDown.engine.perform({ type: "flipUp", playerId: P1, cardId: faceDown.id("fd") });
    resolvePendingResponses(faceDown.engine);
    assert.equal(faceDown.engine.state.cards[faceDown.id("fd")]!.faceDown, false, "control: the face-down card flipped");
  });

  rule("CR 507.4a", "a card in your hand cannot be flipped up", () => {
    const { engine, id } = buildGame({ cards: [{ key: "fd", def: hidden({ cost: 1, threshold: 0 }), owner: P1, zone: "hand" }, ...rageBank(2)] });
    refused(() => engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") }), "flip up a card in hand", /face-down/i);
    assert.equal(zoneOf(engine, id("fd")), "hand");
  });

  rule("CR 507.4a", "a face-down card under the opponent's control cannot be flipped up by you (control: its controller can)", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "fd", def: hidden({ cost: 1, threshold: 0 }), owner: P2, faceDown: true }, ...rageBank(2), ...rageBank(2, "theirs", P2)]
    });
    refused(() => engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") }), "flip up the opponent's card", /control/i);
    assert.equal(engine.state.cards[id("fd")]!.faceDown, true, "still face-down");
    const control = buildGame({
      activePlayerId: P2,
      cards: [{ key: "fd", def: hidden({ cost: 1, threshold: 0 }), owner: P2, faceDown: true }, ...rageBank(2, "theirs", P2)]
    });
    control.engine.perform({ type: "flipUp", playerId: P2, cardId: control.id("fd") });
    resolvePendingResponses(control.engine);
    assert.equal(control.engine.state.cards[control.id("fd")]!.faceDown, false, "control: its controller flipped it on their turn");
  });

  rule("CR 507.4a", "a face-down card that has no Flip Up cannot be flipped up", () => {
    const { engine, id } = buildGame({ cards: [{ key: "fd", def: character({ name: "Plain" }), owner: P1, faceDown: true }, ...rageBank(2)] });
    refused(() => engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") }), "flip up a card without Flip Up", /FLIP UP/i);
    assert.equal(engine.state.cards[id("fd")]!.faceDown, true);
  });

  rule("CR 507.4a", "the Flip Up cost must be payable: one resource short is refused with nothing paid (exactly enough works)", () => {
    // fd itself is a ready resource too: 1 bank + fd = 2 available for a cost of 3.
    const short = flipBoard({ cost: 3, threshold: 0 }, 1);
    refused(() => short.engine.perform({ type: "flipUp", playerId: P1, cardId: short.id("fd") }), "flip up with 2 resources for cost 3", /cannot be paid|enough|FLIP UP/i);
    assert.equal(short.engine.state.cards[short.id("fd")]!.faceDown, true, "still face-down");
    assert.equal(spent(short.engine, P1), 0, "nothing was paid");
    const exact = flipBoard({ cost: 3, threshold: 0 }, 2);
    exact.engine.perform({ type: "flipUp", playerId: P1, cardId: exact.id("fd") });
    resolvePendingResponses(exact.engine);
    assert.equal(exact.engine.state.cards[exact.id("fd")]!.faceDown, false, "control: 2 banks + the card itself pays 3");
  });

  rule("CR 507.4a", "to deploy it you must also meet its Flip Up threshold: one icon short is refused (exactly enough works)", () => {
    // threshold rr: one rage and plenty of greed is one rage short.
    const short = buildGame({ cards: [{ key: "fd", def: hidden({ cost: 1, threshold: "rr" }), owner: P1, faceDown: true }, ...rageBank(1), ...greedBank(3)] });
    refused(() => short.engine.perform({ type: "flipUp", playerId: P1, cardId: short.id("fd") }), "flip up with one rage of two needed", /threshold/i);
    assert.equal(short.engine.state.cards[short.id("fd")]!.faceDown, true);
    assert.equal(spent(short.engine, P1), 0, "nothing was paid");
    const exact = buildGame({ cards: [{ key: "fd", def: hidden({ cost: 1, threshold: "rr" }), owner: P1, faceDown: true }, ...rageBank(2), ...greedBank(1)] });
    exact.engine.perform({ type: "flipUp", playerId: P1, cardId: exact.id("fd") });
    resolvePendingResponses(exact.engine);
    assert.equal(exact.engine.state.cards[exact.id("fd")]!.faceDown, false, "control: two rage meets the threshold");
  });

  rule("CR 507.4a", "the threshold is a requirement, not a cost: meeting it does not use up the icons", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "fd", def: hidden({ cost: 1, threshold: "rr" }), owner: P1, faceDown: true }, ...rageBank(2), ...greedBank(1)]
    });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd"), payWith: [id("greed0")] });
    resolvePendingResponses(engine);
    assert.equal(spent(engine, P1), 1, "only the cost of 1 was paid");
    assert.equal(engine.state.cards[id("bank0")]!.attachedTo, undefined, "the first rage resource is still unspent");
    assert.equal(engine.state.cards[id("bank1")]!.attachedTo, undefined, "the second rage resource is still unspent");
  });

  rule("CR 507.4b", "the Flip Up cost is paid before the card flips: the card can pay for its own Flip Up cost", () => {
    // No other resource at all: the face-down card is the only resource and the cost is 1.
    const { engine, id } = buildGame({ cards: [{ key: "fd", def: hidden({ cost: 1, threshold: 0 }), owner: P1, faceDown: true }] });
    assert.equal(engine.getAvailableResourceCount(P1), 1, "the face-down card is the only resource");
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd"), payWith: [id("fd")] });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("fd")), "play");
    assert.equal(engine.state.cards[id("fd")]!.faceDown, false, "it flipped");
  });

  rule("CR 507.4b", "using the card to pay for itself leaves the other resources untouched", () => {
    const { engine, id } = flipBoard({ cost: 1, threshold: 0 }, 2);
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd"), payWith: [id("fd")] });
    resolvePendingResponses(engine);
    assert.equal(spent(engine, P1), 0, "no other resource was spent");
    assert.equal(engine.getAvailableResourceCount(P1), 2, "both banks are still ready");
  });

  rule("CR 507.4b", "the card can pay for itself but only once: with a cost of 2 and no other resource it is one short", () => {
    const { engine, id } = buildGame({ cards: [{ key: "fd", def: hidden({ cost: 2, threshold: 0 }), owner: P1, faceDown: true }] });
    refused(() => engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") }), "flip up for 2 with only itself", /cannot be paid|enough|FLIP UP/i);
    assert.equal(engine.state.cards[id("fd")]!.faceDown, true);
    const control = buildGame({ cards: [{ key: "fd", def: hidden({ cost: 2, threshold: 0 }), owner: P1, faceDown: true }, ...rageBank(1)] });
    control.engine.perform({ type: "flipUp", playerId: P1, cardId: control.id("fd") });
    resolvePendingResponses(control.engine);
    assert.equal(control.engine.state.cards[control.id("fd")]!.faceDown, false, "control: itself plus one more resource pays 2");
  });

  rule("CR 507.4c", "Flip Up extra costs are satisfied directly before the regular extra costs: the resource played for the Flip Up cost can be picked for a regular extra cost", () => {
    const foment = tactic({
      name: "Foment",
      cost: 3,
      flipUp: {
        cost: 0,
        threshold: 0,
        effects: [
          {
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: { id: "flip-res", selector: { controller: "self", zone: "hand", type: "resource" }, count: 1 },
            effects: [{ type: "playResource", target: { type: "selected", id: "flip-res" }, faceDown: false }]
          }
        ]
      },
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "res", selector: { controller: "self", zone: "play", type: "resource" }, count: 1 }],
            costs: [{ type: "pick", declarationId: "res" }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "res" }, to: "hand", toPlayer: "controller" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "fd", def: foment, owner: P1, faceDown: true },
        { key: "handRes", def: resourceCard({ name: "Hand Resource" }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd"), selected: { "flip-res": [id("handRes")], res: [id("handRes")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("fd")), "discard", "the flipped tactic resolved");
    assert.equal(zoneOf(engine, id("handRes")), "hand", "the resource played for the Flip Up cost was picked for the regular extra cost and returned to hand");
  });

  rule("CR 507.4c", "a Flip Up extra cost that cannot be satisfied (no card in hand to play) means the card cannot be flipped up", () => {
    const makeFoment = () =>
      tactic({
        name: "Foment",
        cost: 3,
        flipUp: {
          cost: 0,
          threshold: 0,
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "flip-res", selector: { controller: "self", zone: "hand", type: "resource" }, count: 1 },
              effects: [{ type: "playResource", target: { type: "selected", id: "flip-res" }, faceDown: false }]
            }
          ]
        }
      });
    const empty = buildGame({ cards: [{ key: "fd", def: makeFoment(), owner: P1, faceDown: true }] });
    refused(() => empty.engine.perform({ type: "flipUp", playerId: P1, cardId: empty.id("fd") }), "flip up with an empty hand", /cannot be paid|hand|FLIP UP/i);
    assert.equal(empty.engine.state.cards[empty.id("fd")]!.faceDown, true, "still face-down");
    const stocked = buildGame({
      cards: [
        { key: "fd", def: makeFoment(), owner: P1, faceDown: true },
        { key: "handRes", def: resourceCard({ name: "Hand Resource" }), owner: P1, zone: "hand" }
      ]
    });
    stocked.engine.perform({ type: "flipUp", playerId: P1, cardId: stocked.id("fd"), selected: { "flip-res": [stocked.id("handRes")] } });
    resolvePendingResponses(stocked.engine);
    assert.equal(zoneOf(stocked.engine, stocked.id("fd")), "discard", "control: with a card in hand the flip works");
    assert.equal(zoneOf(stocked.engine, stocked.id("handRes")), "play", "and the hand card was played as a resource");
  });

  rule("CR 507.4d", "Flip Up does not change when a character may be deployed: not during the opponent's turn", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [{ key: "fd", def: hidden({ cost: 1, threshold: 0 }), owner: P1, faceDown: true }, ...rageBank(2)]
    });
    refused(() => engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") }), "flip up a character on the opponent's turn", /active player|tactic|deploy/i);
    assert.equal(engine.state.cards[id("fd")]!.faceDown, true);
    const control = buildGame({ cards: [{ key: "fd", def: hidden({ cost: 1, threshold: 0 }), owner: P1, faceDown: true }, ...rageBank(2)] });
    control.engine.perform({ type: "flipUp", playerId: P1, cardId: control.id("fd") });
    resolvePendingResponses(control.engine);
    assert.equal(control.engine.state.cards[control.id("fd")]!.faceDown, false, "control: on its controller's own turn it flips");
  });

  const typed: Array<[string, CardDefinition]> = [
    ["character", character({ name: "Hidden", cost: 5, flipUp: { cost: 1, threshold: 0 } })],
    ["item", item({ name: "Hidden", cost: 5, flipUp: { cost: 1, threshold: 0 } })],
    ["location", location({ name: "Hidden", cost: 5, flipUp: { cost: 1, threshold: 0 } })]
  ];
  for (const [label, def] of typed) {
    rule("CR 507.4d", `a face-down ${label} cannot be flipped up in a response window on the opponent's turn`, () => {
      const { engine, id } = buildGame({
        activePlayerId: P2,
        cards: [
          { key: "fd", def, owner: P1, faceDown: true },
          { key: "attacker", def: character({ name: "Attacker" }), owner: P2 },
          ...rageBank(2)
        ]
      });
      openOpponentWindow(engine, id("attacker"));
      refused(() => engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") }), `flip up a ${label} in the opponent's window`, /tactic|TACTICAL|respon/i);
      assert.equal(engine.state.cards[id("fd")]!.faceDown, true, "still face-down");
    });
  }

  rule("CR 507.4d", "a face-down tactic may be flipped up in a response window on the opponent's turn (control for the character refusals)", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "fd", def: tactic({ name: "Hidden Tactic", cost: 5, flipUp: { cost: 1, threshold: 0 } }), owner: P1, faceDown: true },
        { key: "attacker", def: character({ name: "Attacker" }), owner: P2 },
        ...rageBank(2)
      ]
    });
    openOpponentWindow(engine, id("attacker"));
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("fd")), "discard", "the tactic was played and resolved");
  });

  rule("CR 507.4d", "a character cannot be flipped up in response to an opponent's response on your own turn, a tactic can", () => {
    const characterBoard = () =>
      buildGame({
        cards: [
          { key: "open", def: blank("Opener"), owner: P1, zone: "hand" },
          { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" },
          { key: "fdChar", def: hidden({ cost: 1, threshold: 0 }), owner: P1, faceDown: true },
          { key: "fdTac", def: tactic({ name: "Hidden Tactic", cost: 5, flipUp: { cost: 1, threshold: 0 } }), owner: P1, faceDown: true },
          ...rageBank(3)
        ]
      });
    const a = characterBoard();
    a.engine.perform({ type: "playCard", playerId: P1, cardId: a.id("open") });
    a.engine.perform({ type: "playCard", playerId: P2, cardId: a.id("reply") });
    assert.equal(a.engine.state.responseWindow?.priorityPlayerId, P1, "the first player may respond to the reply");
    refused(() => a.engine.perform({ type: "flipUp", playerId: P1, cardId: a.id("fdChar") }), "flip up a character as a response", /tactic|TACTICAL|respon/i);
    const b = characterBoard();
    b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("open") });
    b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("reply") });
    b.engine.perform({ type: "flipUp", playerId: P1, cardId: b.id("fdTac") });
    assert.equal(b.engine.state.responseStack.length, 3, "control: the tactic is a response above the reply");
  });

  rule("CR 507.4d", "a card with TACTICAL can be flipped up at the times a tactic can: in a response window on the opponent's turn", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "fd", def: hidden({ cost: 1, threshold: 0 }, { behavior: { keywords: ["tactical"] } }), owner: P1, faceDown: true },
        { key: "attacker", def: character({ name: "Attacker" }), owner: P2 },
        ...rageBank(2)
      ]
    });
    openOpponentWindow(engine, id("attacker"));
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("fd")), "play", "the TACTICAL character entered play");
    assert.equal(engine.state.cards[id("fd")]!.faceDown, false);
  });

  rule("CR 507.4e", "the numeric cost of a card flipped up starts at its Flip Up cost, not its printed cost", () => {
    const { engine, id } = flipBoard({ cost: 2, threshold: 0 }, 6);
    const view = engine.getFlipUpPlayability(P1, id("fd"));
    assert.equal(view.numericCost, 2, "a printed cost of 5 is not used");
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
    resolvePendingResponses(engine);
    assert.equal(spent(engine, P1), 2);
  });

  rule("CR 507.4e", "extra costs that say 'pay N' are added to the running total on top of the Flip Up cost", () => {
    const costly = character({
      name: "Costly",
      cost: 5,
      flipUp: { cost: 2, threshold: 0 },
      behavior: { onPlay: { costs: [{ type: "payResources", amount: 1 }] } }
    });
    const { engine, id } = buildGame({ cards: [{ key: "fd", def: costly, owner: P1, faceDown: true }, ...rageBank(6)] });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
    resolvePendingResponses(engine);
    assert.equal(spent(engine, P1), 3, "Flip Up cost 2 plus the extra 'pay 1'");
  });

  rule("CR 507.4e", "cost increases apply to the running total that began at the Flip Up cost", () => {
    const tax = character({
      name: "Tax",
      behavior: { abilities: [{ id: "tax", type: "continuous", modifiers: [], costModifiers: [{ affects: "opponent", delta: 1 }] }] }
    });
    const { engine, id } = flipBoard({ cost: 2, threshold: 0 }, 6, [{ key: "tax", def: tax, owner: P2 }]);
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
    resolvePendingResponses(engine);
    assert.equal(spent(engine, P1), 3, "Flip Up cost 2 plus the increase of 1");
  });

  ruleOpen(
    "CR 507.4e",
    "RQ-r06-keywords-1",
    "a cost reduction larger than the Flip Up cost's share: the Flip Up cost already paid is not refunded",
    () => {
      const discount = character({
        name: "Discount",
        behavior: { abilities: [{ id: "disc", type: "continuous", modifiers: [], costModifiers: [{ affects: "controller", delta: -1 }] }] }
      });
      const { engine, id } = flipBoard({ cost: 2, threshold: 0 }, 6, [{ key: "discount", def: discount, owner: P1 }]);
      engine.perform({ type: "flipUp", playerId: P1, cardId: id("fd") });
      resolvePendingResponses(engine);
      assert.equal(spent(engine, P1), 2, "the Flip Up cost of 2 was paid first and the balance after the reduction is 0");
    }
  );
});
