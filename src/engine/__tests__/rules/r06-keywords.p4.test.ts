// Batch r06-keywords (docs/TESTING.md): CR 507.5 Unique, 507.6 Tactical.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, TriggeredAbility } from "../../../engine.js";
import { buildGame, character, item, location, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import type { BuildGameOptions } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

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

/** "When this card is destroyed, its controller gains 1 influence." */
const ON_DESTROYED: TriggeredAbility = {
  id: "on-destroyed",
  type: "triggered",
  event: "cardDestroyed",
  condition: { type: "sourceIsEventCard" },
  effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
};

const NOOP = { id: "noop", type: "activated" as const, effects: [] };

/** A tactic with no effect. */
const blank = (name: string) => tactic({ name });

/** The opponent (active) attacks the first player's faction and passes: the first player now holds priority in a response window. */
function openOpponentWindow(engine: SpoilsEngine, attackerId: CardInstanceId): void {
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [attackerId], target: { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the first player holds priority in the opponent's response window");
}

describe("CR 507.5 — unique", () => {
  const twin = (name: string, designation = "u", extra: Partial<CardDefinition> = {}) =>
    character({ name, unique: designation, behavior: { abilities: [NOOP, ON_DESTROYED] }, ...extra });

  /** Activates the noop ability of `key`, which runs the game's state check. */
  const poke = (engine: SpoilsEngine, cardId: CardInstanceId) => {
    engine.perform({ type: "activateAbility", playerId: P1, cardId, abilityId: "noop" });
    resolvePendingResponses(engine);
  };

  rule("CR 507.5a", "controlling two cards with the same unique identifier: you choose one to keep and the other is destroyed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: twin("Twin A"), owner: P1 },
        { key: "b", def: twin("Twin B"), owner: P1 }
      ]
    });
    poke(engine, id("a"));
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "uniqueSurvivor", "the player must choose");
    assert.equal(pending?.playerId, P1, "the controller chooses");
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("b") } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("b")), "play", "the kept card stays");
    assert.equal(zoneOf(engine, id("a")), "discard", "the other is gone");
    assert.equal(engine.state.players[P1].influence, before + 1, "it was destroyed (its when-destroyed trigger happened)");
  });

  rule("CR 507.5a", "the choice is the controller's and must name one of the conflicting copies", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: twin("Twin A"), owner: P1 },
        { key: "b", def: twin("Twin B"), owner: P1 },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P1 }
      ]
    });
    poke(engine, id("a"));
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "uniqueSurvivor", keep: id("a") } }),
      "the opponent answers the unique choice",
      /choice|player|not/i
    );
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("bystander") } }),
      "keeping a card that is not a conflicting copy",
      /candidate|keep|unique|choice/i
    );
    assert.equal(zoneOf(engine, id("bystander")), "play", "nothing was destroyed by the refused answers");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("a") } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("b")), "discard", "control: the controller's valid answer works");
  });

  rule("CR 507.5a", "the identifier decides, not the name: different names with the same identifier conflict, the same name with different identifiers do not", () => {
    const conflict = buildGame({
      cards: [
        { key: "a", def: twin("Alpha", "same"), owner: P1 },
        { key: "b", def: twin("Beta", "same"), owner: P1 }
      ]
    });
    poke(conflict.engine, conflict.id("a"));
    assert.equal(conflict.engine.state.pendingChoice?.kind, "uniqueSurvivor", "same identifier, different names: conflict");
    const fine = buildGame({
      cards: [
        { key: "a", def: twin("Same Name", "first"), owner: P1 },
        { key: "b", def: twin("Same Name", "second"), owner: P1 }
      ]
    });
    poke(fine.engine, fine.id("a"));
    assert.equal(fine.engine.state.pendingChoice, undefined, "different identifiers: no conflict");
    assert.equal(zoneOf(fine.engine, fine.id("a")), "play");
    assert.equal(zoneOf(fine.engine, fine.id("b")), "play");
  });

  rule("CR 507.5a", "three copies: choose one to keep, the rest (both others) are destroyed", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: twin("Twin A"), owner: P1 },
        { key: "b", def: twin("Twin B"), owner: P1 },
        { key: "c", def: twin("Twin C"), owner: P1 }
      ]
    });
    poke(engine, id("a"));
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("c") } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined, "no further question");
    assert.equal(zoneOf(engine, id("c")), "play");
    assert.equal(zoneOf(engine, id("a")), "discard");
    assert.equal(zoneOf(engine, id("b")), "discard");
  });

  rule("CR 507.5a", "playing a second copy: when it enters play you choose which copy to keep", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "inPlay", def: twin("Twin A"), owner: P1 },
        { key: "second", def: twin("Twin B"), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("second") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "uniqueSurvivor", "the new copy and the old one conflict");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("inPlay") } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("inPlay")), "play", "the player may keep the older copy");
    assert.equal(zoneOf(engine, id("second")), "discard", "and lose the one just played");
  });

  rule("CR 507.5a", "the restriction only applies to your cards: the opponent may have their own copy in play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: twin("Twin A"), owner: P1 },
        { key: "theirs", def: twin("Twin B"), owner: P2 }
      ]
    });
    poke(engine, id("mine"));
    assert.equal(engine.state.pendingChoice, undefined, "no question");
    assert.equal(zoneOf(engine, id("mine")), "play");
    assert.equal(zoneOf(engine, id("theirs")), "play");
  });

  rule("CR 507.5a", "it is about cards you control: your card and an opponent-owned card under your control conflict, and you choose", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: twin("Twin A"), owner: P1 },
        { key: "stolen", def: twin("Twin B"), owner: P2, controller: P1 }
      ]
    });
    poke(engine, id("mine"));
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "uniqueSurvivor", "both are controlled by the first player");
    assert.equal(pending?.playerId, P1);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("mine") } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("stolen")), "discard", "the stolen copy was destroyed");
    assert.ok(engine.state.players[P2].discard.includes(id("stolen")), "into its owner's discard pile");
  });

  rule("CR 507.5a", "a copy you own but the opponent controls does not conflict with your own copy", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "mine", def: twin("Twin A"), owner: P1 },
        { key: "lent", def: twin("Twin B"), owner: P1, controller: P2 }
      ]
    });
    poke(engine, id("mine"));
    assert.equal(engine.state.pendingChoice, undefined, "different controllers: no conflict");
    assert.equal(zoneOf(engine, id("lent")), "play");
  });

  rule("CR 507.5a", "only cards in play count: a copy in your hand or discard pile does not conflict", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "inPlay", def: twin("Twin A"), owner: P1 },
        { key: "inHand", def: twin("Twin B"), owner: P1, zone: "hand" },
        { key: "inDiscard", def: twin("Twin C"), owner: P1, zone: "discard" }
      ]
    });
    poke(engine, id("inPlay"));
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(engine, id("inPlay")), "play");
    assert.equal(zoneOf(engine, id("inHand")), "hand");
  });

  rule("CR 507.5a", "a face-down copy is a resource with no rules text, so it does not conflict with a face-up copy", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "up", def: twin("Twin A"), owner: P1 },
        { key: "down", def: twin("Twin B"), owner: P1, faceDown: true }
      ]
    });
    poke(engine, id("up"));
    assert.equal(engine.state.pendingChoice, undefined, "no question");
    assert.equal(zoneOf(engine, id("down")), "play");
  });

  rule("CR 507.5b", "destruction of the extra copy prevented by an effect: unique does not try to destroy it again until the prevention ends", () => {
    // A shield item in play replaces the destruction of its controller's characters ("instead gain 1 influence").
    const shield = item({
      name: "Shield",
      behavior: {
        abilities: [
          {
            id: "ward",
            type: "replacement",
            replaces: { event: "destroy", cardType: "character", controlledBy: "self" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const kill = tactic({
      name: "Smash",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { type: "item" }, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "a", def: twin("Twin A"), owner: P1 },
        { key: "b", def: twin("Twin B"), owner: P1 },
        { key: "shield", def: shield, owner: P1 },
        { key: "smash", def: kill, owner: P2, zone: "hand" }
      ]
    });
    const start = engine.state.players[P1].influence;
    poke(engine, id("a"));
    assert.equal(engine.state.pendingChoice?.kind, "uniqueSurvivor");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("a") } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("b")), "play", "the destruction was prevented, the extra copy is still in play");
    assert.equal(engine.state.pendingChoice, undefined, "unique does not ask again while the prevention lasts");
    const afterFirst = engine.state.players[P1].influence;
    assert.equal(afterFirst, start + 1, "the prevention applied exactly once");
    poke(engine, id("a"));
    assert.equal(engine.state.pendingChoice, undefined, "still no new attempt after another game action");
    assert.equal(engine.state.players[P1].influence, afterFirst, "the prevention was not triggered again");
    // The prevention ends: the shield is destroyed by the opponent's tactic.
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("a"), abilityId: "noop" });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("smash"), selected: { t: [id("shield")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("shield")), "discard", "the shield is gone");
    const pending = (): { kind: string } | undefined => engine.state.pendingChoice;
    assert.equal(pending()?.kind, "uniqueSurvivor", "unique acts again now that the prevention has ended");
  });
});

describe("CR 507.6 — tactical", () => {
  const tacticalChar = (name = "Flash") => character({ name, behavior: { keywords: ["tactical"] } });

  const respondBoard = (def: CardDefinition) =>
    buildGame({
      activePlayerId: P2,
      cards: [
        { key: "flash", def, owner: P1, zone: "hand" },
        { key: "plain", def: { ...def, id: `plain-${def.id}`, name: "Plain", behavior: undefined }, owner: P1, zone: "hand" },
        { key: "attacker", def: character({ name: "Attacker" }), owner: P2 }
      ]
    });

  const kinds: Array<[string, CardDefinition]> = [
    ["character", tacticalChar()],
    ["item", item({ name: "Flash Item", behavior: { keywords: ["tactical"] } })],
    ["location", location({ name: "Flash Place", behavior: { keywords: ["tactical"] } })]
  ];
  for (const [label, def] of kinds) {
    rule("CR 507.6a", `a tactical ${label} may be deployed at a time you could deploy a tactic: in response to the opponent's attack`, () => {
      const { engine, id } = respondBoard(def);
      openOpponentWindow(engine, id("attacker"));
      refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("plain") }), `a ${label} without tactical as a response`, /tactic|TACTICAL|respon/i);
      engine.perform({ type: "playCard", playerId: P1, cardId: id("flash") });
      resolvePendingResponses(engine);
      assert.equal(zoneOf(engine, id("flash")), "play", `control: the tactical ${label} was deployed`);
    });
  }

  rule("CR 507.6a", "a tactical card may be deployed in response to the opponent's card on your own turn, and resolves into play", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "open", def: blank("Opener"), owner: P2, zone: "hand" },
        { key: "flash", def: tacticalChar(), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("open") });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("flash") });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("flash")), "play");
    assert.equal(engine.state.cards[id("flash")]!.controllerId, P1);
  });

  rule("CR 507.6a", "a tactical card may not be deployed at a time you could not deploy a tactic: when the opponent holds priority", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "open", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "flash", def: tacticalChar(), owner: P1, zone: "hand" },
        { key: "tac", def: blank("Another Tactic"), owner: P1, zone: "hand" },
        { key: "reply", def: tacticalChar("Their Flash"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("open") });
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("tac") }), "a tactic while the opponent holds priority", /priority/);
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("flash") }), "a tactical card while the opponent holds priority", /priority/);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.responseStack.length, 2, "control: the opponent, holding priority, deployed their tactical card");
  });

  rule("CR 507.6a", "a card without tactical (a plain character) cannot be deployed as a response (control for the tactical cases)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "open", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "plain", def: character({ name: "Plain" }), owner: P2, zone: "hand" },
        { key: "flash", def: tacticalChar(), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("open") });
    refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("plain") }), "a plain character as a response", /tactic|TACTICAL|respon/i);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("flash") });
    assert.equal(engine.state.responseStack.length, 2, "control: the tactical character is accepted");
  });

  rule("CR 507.6b", "tactical is active in your hand: a card in hand with tactical is deployable at response time", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "open", def: blank("Opener"), owner: P2, zone: "hand" },
        { key: "flash", def: tacticalChar(), owner: P1, zone: "hand" }
      ],
      activePlayerId: P2
    });
    assert.equal(zoneOf(engine, id("flash")), "hand");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("open") });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("flash") });
    assert.equal(engine.state.responseStack.length, 2, "the tactical card was deployed from the hand as a response");
  });

  rule("CR 507.6b", "tactical is active on a face-down resource: it can be flipped up at response time", () => {
    const withTactical = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "fd", def: character({ name: "Hidden", cost: 5, flipUp: { cost: 1, threshold: 0 }, behavior: { keywords: ["tactical"] } }), owner: P1, faceDown: true },
        { key: "attacker", def: character({ name: "Attacker" }), owner: P2 },
        ...rageBank(2)
      ]
    });
    openOpponentWindow(withTactical.engine, withTactical.id("attacker"));
    withTactical.engine.perform({ type: "flipUp", playerId: P1, cardId: withTactical.id("fd") });
    resolvePendingResponses(withTactical.engine);
    assert.equal(zoneOf(withTactical.engine, withTactical.id("fd")), "play", "flipped up in the opponent's window");
    const without = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "fd", def: character({ name: "Hidden", cost: 5, flipUp: { cost: 1, threshold: 0 } }), owner: P1, faceDown: true },
        { key: "attacker", def: character({ name: "Attacker" }), owner: P2 },
        ...rageBank(2)
      ]
    });
    openOpponentWindow(without.engine, without.id("attacker"));
    refused(() => without.engine.perform({ type: "flipUp", playerId: P1, cardId: without.id("fd") }), "flip up the same card without tactical", /tactic|TACTICAL|respon/i);
  });

  rule("CR 507.6b", "the card still has the tactical keyword while it is a face-down resource", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "fd", def: character({ name: "Hidden", cost: 5, flipUp: { cost: 1, threshold: 0 }, behavior: { keywords: ["tactical"] } }), owner: P1, faceDown: true }]
    });
    assert.equal(engine.hasKeyword(id("fd"), "tactical"), true, "tactical is active even when the card is a face-down resource");
  });

  rule("CR 507.6b", "the card has the tactical keyword while it is in the hand", () => {
    const { engine, id } = buildGame({ cards: [{ key: "flash", def: tacticalChar(), owner: P1, zone: "hand" }] });
    assert.equal(engine.hasKeyword(id("flash"), "tactical"), true, "tactical is active in the hand");
  });
});
