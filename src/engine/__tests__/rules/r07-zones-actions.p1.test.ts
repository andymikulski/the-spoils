// Batch r07-zones-actions, part 1 (docs/TESTING.md): CR 301 Attach & Detach, CR 303 Deplete & Restore,
// CR 304 Destroy, CR 305 Discard. Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, Effect, GameEvent, SpoilsEngine, TargetDeclaration } from "../../../engine.js";
import { buildGame, character, item, location, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

const T: TargetDeclaration[] = [{ id: "t", selector: {}, count: 1 }];
const pick = (id: string) => ({ type: "selected" as const, id });

/** A zero-cost tactic whose single ability runs `effects`; `targets` default to one in-play card named `t`. */
const spell = (name: string, effects: Effect[], targets: TargetDeclaration[] = T): CardDefinition =>
  tactic({ name, behavior: { abilities: [{ id: "a", type: "activated", targets, effects }] } });

const gear = (name = "Gear") => item({ name, attachTo: "character" });
const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;
const attachedTo = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.attachedTo;

/** Every card attached to `hostId`. */
const attachmentsOf = (engine: SpoilsEngine, hostId: string) =>
  Object.values(engine.state.cards).filter(card => card.attachedTo === hostId).map(card => card.id);

/** Plays `spellKey` as P1 with `selected` and settles every window. */
function cast(built: ReturnType<typeof buildGame>, spellKey: string, selected: Record<string, string[]> = {}): void {
  built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id(spellKey), selected });
  resolvePendingResponses(built.engine);
  assert.equal(built.engine.state.pendingChoice, undefined, "the spell needed no further answer");
}

const events = (engine: SpoilsEngine, type: GameEvent["type"]) =>
  engine.getLog().filter(entry => entry.event?.type === type).map(entry => entry.event!);

describe("CR 301 — attach and detach", () => {
  rule("CR 301.1", "a card with ATTACH TO is attached to the target card it was played onto and stays in play", () => {
    const built = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "gear", def: gear(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("gear"), selected: { attachTo: [id("host")] } });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("gear")), "play", "the attaching card is in play");
    assert.equal(attachedTo(engine, id("gear")), id("host"), "and attached to the target");
    assert.equal(zone(engine, id("host")), "play", "the target is untouched");
  });

  rule("CR 301.1", "an attaching card needs a target of the right type: a location is refused for ATTACH TO CHARACTER", () => {
    const make = () =>
      buildGame({
        cards: [
          { key: "host", def: character({ name: "Host" }), owner: P1 },
          { key: "place", def: location({ name: "Place" }), owner: P1 },
          { key: "gear", def: gear(), owner: P1, zone: "hand" }
        ]
      });
    const control = make();
    control.engine.perform({ type: "playCard", playerId: P1, cardId: control.id("gear"), selected: { attachTo: [control.id("host")] } });
    assert.equal(control.engine.state.cards[control.id("gear")]!.zone, "deploying", "control: a character is a legal target");
    const bad = make();
    refused(
      () => bad.engine.perform({ type: "playCard", playerId: P1, cardId: bad.id("gear"), selected: { attachTo: [bad.id("place")] } }),
      "attach a character-only card to a location"
    );
    assert.equal(bad.engine.state.cards[bad.id("gear")]!.zone, "hand", "the refused card stays in hand");
  });

  rule("CR 301.2", "attaching to something else detaches from the old host at the same time", () => {
    const built = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P1 },
        { key: "gear", def: gear(), owner: P1, attachedToKey: "a" },
        { key: "mover", def: spell("Mover", [{ type: "attachTo", target: pick("t"), to: pick("dest") }], [
          { id: "t", selector: { type: "item" }, count: 1 },
          { id: "dest", selector: { type: "character" }, count: 1 }
        ]), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    assert.deepEqual(attachmentsOf(engine, id("a")), [id("gear")], "control: attached to A to begin with");
    cast(built, "mover", { t: [id("gear")], dest: [id("b")] });
    assert.equal(attachedTo(engine, id("gear")), id("b"), "now attached to B");
    assert.deepEqual(attachmentsOf(engine, id("a")), [], "and no longer to A");
    assert.deepEqual(attachmentsOf(engine, id("b")), [id("gear")]);
    assert.equal(events(engine, "cardAttached").length, 1, "one attach event");
  });

  rule("CR 301.2", "a detach effect leaves the card unattached and in play, and the old host keeps nothing", () => {
    const built = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "gear", def: gear(), owner: P1, attachedToKey: "a" },
        { key: "cut", def: spell("Cut", [{ type: "detach", target: pick("t") }], [{ id: "t", selector: { type: "item" }, count: 1 }]), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    cast(built, "cut", { t: [id("gear")] });
    assert.equal(attachedTo(engine, id("gear")), undefined, "detached");
    assert.deepEqual(attachmentsOf(engine, id("a")), [], "the host has no attachments");
  });

  rule("CR 301.3", "an attaching card is attached to one target only: re-attaching twice leaves only the last host", () => {
    const built = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P1 },
        { key: "c", def: character({ name: "C" }), owner: P1 },
        { key: "gear", def: gear(), owner: P1, attachedToKey: "a" },
        {
          key: "m1",
          def: spell("M1", [{ type: "attachTo", target: pick("t"), to: pick("dest") }], [
            { id: "t", selector: { type: "item" }, count: 1 },
            { id: "dest", selector: { type: "character" }, count: 1 }
          ]),
          owner: P1,
          zone: "hand"
        }
      ]
    });
    const { engine, id } = built;
    cast(built, "m1", { t: [id("gear")], dest: [id("b")] });
    assert.equal(attachedTo(engine, id("gear")), id("b"));
    const holders = Object.values(engine.state.cards).filter(card => card.id !== id("gear") && attachmentsOf(engine, card.id).includes(id("gear")));
    assert.equal(holders.length, 1, "exactly one card has the gear attached");
    assert.equal(holders[0]!.id, id("b"));
  });

  rule("CR 301.3", "a target card can have any number of cards attached to it at once", () => {
    const built = buildGame({
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "g1", def: gear("G1"), owner: P1, zone: "hand" },
        { key: "g2", def: gear("G2"), owner: P1, zone: "hand" },
        { key: "g3", def: gear("G3"), owner: P2, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    for (const key of ["g1", "g2"]) {
      engine.perform({ type: "playCard", playerId: P1, cardId: id(key), selected: { attachTo: [id("host")] } });
      resolvePendingResponses(engine);
    }
    assert.deepEqual(attachmentsOf(engine, id("host")).sort(), [id("g1"), id("g2")].sort(), "two attachments on one host");
    // The opponent's own gear also attaches to the same host (their turn, as a response is not needed: give them the turn).
    engine.state.activePlayerId = P2;
    engine.state.priorityPlayerId = P2;
    engine.perform({ type: "playCard", playerId: P2, cardId: id("g3"), selected: { attachTo: [id("host")] } });
    resolvePendingResponses(engine);
    assert.equal(attachmentsOf(engine, id("host")).length, 3, "a third attachment, from the other player, joins them");
  });

  /** The host and its gear are P1's; `leaver` is the spell that takes the host out of play. */
  const leaving = (name: string, effects: Effect[], extra: Parameters<typeof buildGame>[0] = {}) =>
    buildGame({
      ...extra,
      cards: [
        { key: "host", def: character({ name: "Host" }), owner: P1 },
        { key: "other", def: character({ name: "Other" }), owner: P1 },
        { key: "g1", def: gear("G1"), owner: P1, attachedToKey: "host" },
        { key: "g2", def: gear("G2"), owner: P2, attachedToKey: "host" },
        { key: "g3", def: gear("G3"), owner: P1, attachedToKey: "other" },
        { key: "leaver", def: spell(name, effects), owner: P1, zone: "hand" },
        ...(extra.cards ?? [])
      ]
    });

  const expectFollow = (built: ReturnType<typeof buildGame>, where: { g1: string; g2: string }): void => {
    const { engine, id } = built;
    cast(built, "leaver", { t: [id("host")] });
    assert.notEqual(zone(engine, id("host")), "play", "the host left play");
    assert.equal(zone(engine, id("g1")), where.g1, "the attached card of the same owner left play the same way");
    assert.equal(zone(engine, id("g2")), where.g2, "the opponent's attached card left play the same way, into its owner's zone");
    assert.equal(zone(engine, id("g3")), "play", "a card attached to a different host stays");
    assert.equal(attachedTo(engine, id("g3")), id("other"));
  };

  rule(["CR 301.4", "CR 301.4a"], "a destroyed host takes its attachments to their owners' discard piles", () => {
    expectFollow(leaving("Smite", [{ type: "destroy", target: pick("t") }]), { g1: "discard", g2: "discard" });
  });

  rule(["CR 301.4", "CR 301.4a"], "a host removed from the game takes its attachments out of the game too", () => {
    expectFollow(leaving("Banish", [{ type: "removeFromGame", target: pick("t") }]), { g1: "removed", g2: "removed" });
  });

  rule(["CR 301.4", "CR 301.4a"], "a host put into its owner's hand takes its attachments into their owners' hands", () => {
    const built = leaving("Bounce", [{ type: "moveCard", target: pick("t"), to: "hand" }]);
    expectFollow(built, { g1: "hand", g2: "hand" });
    assert.ok(built.engine.state.players[P1].hand.includes(built.id("g1")), "P1's gear is in P1's hand");
    assert.ok(built.engine.state.players[P2].hand.includes(built.id("g2")), "P2's gear is in P2's hand");
  });

  rule(["CR 301.4", "CR 301.4a"], "a host shuffled into its owner's deck takes its attachments into their owners' decks", () => {
    const built = leaving(
      "Reshuffle",
      [
        { type: "moveCard", target: pick("t"), to: "deck" },
        { type: "shuffleDeck", player: "controller" }
      ],
      { random: () => 0.3 }
    );
    expectFollow(built, { g1: "deck", g2: "deck" });
    assert.ok(built.engine.state.players[P1].deck.includes(built.id("g1")), "P1's gear is in P1's deck");
    assert.ok(built.engine.state.players[P2].deck.includes(built.id("g2")), "P2's gear is in P2's deck");
  });

  rule(["CR 301.4", "CR 301.4a"], "a host that does not leave play keeps its attachments (control)", () => {
    const built = leaving("Scratch", [{ type: "dealDamage", target: pick("t"), amount: 1 }]);
    const { engine, id } = built;
    cast(built, "leaver", { t: [id("host")] });
    assert.equal(zone(engine, id("host")), "play", "the host survived 1 damage");
    assert.equal(zone(engine, id("g1")), "play");
    assert.equal(attachedTo(engine, id("g1")), id("host"), "still attached");
    assert.equal(attachedTo(engine, id("g2")), id("host"));
  });

  rule(["CR 301.4", "CR 301.4a"], "a host destroyed by lethal damage takes its attachments with it", () => {
    const built = leaving("Blast", [{ type: "dealDamage", target: pick("t"), amount: 9 }]);
    const { engine, id } = built;
    cast(built, "leaver", { t: [id("host")] });
    assert.equal(zone(engine, id("host")), "discard");
    assert.equal(zone(engine, id("g1")), "discard");
    assert.equal(zone(engine, id("g2")), "discard");
  });

  /** A host whose destruction is replaced by `replacement`. */
  const replacedHost = (replacement: Effect[]) =>
    buildGame({
      cards: [
        {
          key: "host",
          def: character({
            name: "Slippery",
            behavior: { abilities: [{ id: "slip", type: "replacement", replaces: { event: "destroy" }, effects: replacement }] }
          }),
          owner: P1
        },
        { key: "g1", def: gear("G1"), owner: P1, attachedToKey: "host" },
        { key: "leaver", def: spell("Smite", [{ type: "destroy", target: pick("t") }]), owner: P1, zone: "hand" }
      ]
    });

  rule("CR 301.4b", "a host whose destruction is replaced by 'put into hand instead' takes its attachment to the hand instead too", () => {
    const built = replacedHost([{ type: "moveCard", target: pick("__candidate"), to: "hand" }]);
    const { engine, id } = built;
    cast(built, "leaver", { t: [id("host")] });
    assert.equal(zone(engine, id("host")), "hand", "the host went to hand instead of the discard pile");
    assert.equal(zone(engine, id("g1")), "hand", "the attachment's method of leaving play was replaced too");
  });

  rule("CR 301.4b", "a host whose destruction is replaced by 'remove from the game instead' takes its attachment out of the game", () => {
    const built = replacedHost([{ type: "removeFromGame", target: pick("__candidate") }]);
    const { engine, id } = built;
    cast(built, "leaver", { t: [id("host")] });
    assert.equal(zone(engine, id("host")), "removed");
    assert.equal(zone(engine, id("g1")), "removed", "the attachment follows the replaced method");
  });

  rule("CR 301.4b", "a replacement that stops the host leaving play at all leaves the attachment attached", () => {
    const built = replacedHost([{ type: "addCounter", target: pick("__candidate"), counter: "shield", amount: 1 }]);
    const { engine, id } = built;
    cast(built, "leaver", { t: [id("host")] });
    assert.equal(zone(engine, id("host")), "play", "the host never left play");
    assert.equal(zone(engine, id("g1")), "play", "so neither did its attachment");
    assert.equal(attachedTo(engine, id("g1")), id("host"));
  });
});

describe("CR 303 — deplete and restore", () => {
  const depleter = (effect: "deplete" | "restore") =>
    spell(effect === "deplete" ? "Drain" : "Refresh", [{ type: effect, target: pick("t") }]);

  rule(["CR 303.1", "CR 303.3"], "a deplete effect depletes a restored card and a restore effect restores it again", () => {
    const built = buildGame({
      cards: [
        { key: "c", def: character({ name: "C" }), owner: P1 },
        { key: "drain", def: depleter("deplete"), owner: P1, zone: "hand" },
        { key: "refresh", def: depleter("restore"), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    assert.equal(engine.state.cards[id("c")]!.depleted, false, "restored to begin with");
    cast(built, "drain", { t: [id("c")] });
    assert.equal(engine.state.cards[id("c")]!.depleted, true, "depleted");
    cast(built, "refresh", { t: [id("c")] });
    assert.equal(engine.state.cards[id("c")]!.depleted, false, "restored");
    assert.equal(events(engine, "cardDepleted").length, 1, "one deplete event");
    assert.equal(events(engine, "cardRestored").length, 1, "one restore event");
  });

  rule("CR 303.1", "paying a deplete cost marks the card depleted ('used for the turn')", () => {
    const worker = character({
      name: "Worker",
      behavior: {
        abilities: [{ id: "work", type: "activated", costs: [{ type: "deplete", target: "source" }], effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }]
      }
    });
    const { engine, id } = buildGame({ cards: [{ key: "w", def: worker, owner: P1 }] });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("w"), abilityId: "work" });
    assert.equal(engine.state.cards[id("w")]!.depleted, true, "the cost depleted the card");
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before + 2, "and the ability resolved");
  });

  rule("CR 303.2", "a card cannot be depleted as a cost if it is already depleted (a restored one can)", () => {
    const worker = () =>
      character({
        name: "Worker",
        behavior: {
          abilities: [{ id: "work", type: "activated", costs: [{ type: "deplete", target: "source" }], effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] }]
        }
      });
    const control = buildGame({ cards: [{ key: "w", def: worker(), owner: P1 }] });
    control.engine.perform({ type: "activateAbility", playerId: P1, cardId: control.id("w"), abilityId: "work" });
    assert.equal(control.engine.state.cards[control.id("w")]!.depleted, true, "control: a restored card pays the cost");
    const { engine, id } = buildGame({ cards: [{ key: "w", def: worker(), owner: P1, depleted: true }] });
    refused(() => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("w"), abilityId: "work" }), "pay a deplete cost with a depleted card");
    assert.equal(engine.state.responseStack.length, 0, "nothing was put on the stack");
    assert.equal(events(engine, "cardDepleted").length, 0, "no deplete event for the already-depleted card");
  });

  rule("CR 303.2", "a deplete effect on an already depleted card does nothing: no second deplete happens", () => {
    const built = buildGame({
      cards: [
        { key: "c", def: character({ name: "C" }), owner: P1, depleted: true },
        { key: "drain", def: depleter("deplete"), owner: P1, zone: "hand" }
      ]
    });
    cast(built, "drain", { t: [built.id("c")] });
    assert.equal(built.engine.state.cards[built.id("c")]!.depleted, true, "still depleted");
    assert.equal(events(built.engine, "cardDepleted").length, 0, "no deplete event: it was not depleted again");
  });

  rule("CR 303.2", "a restore effect on an already restored card does nothing: no restore happens", () => {
    const built = buildGame({
      cards: [
        { key: "c", def: character({ name: "C" }), owner: P1 },
        { key: "refresh", def: depleter("restore"), owner: P1, zone: "hand" }
      ]
    });
    cast(built, "refresh", { t: [built.id("c")] });
    assert.equal(built.engine.state.cards[built.id("c")]!.depleted, false, "still restored");
    assert.equal(events(built.engine, "cardRestored").length, 0, "no restore event: it was not restored again");
  });

  rule("CR 303.3", "restoring a depleted card returns it upright and fires a restore event for it only", () => {
    const built = buildGame({
      cards: [
        { key: "tapped", def: character({ name: "Tapped" }), owner: P1, depleted: true },
        { key: "bystander", def: character({ name: "Bystander" }), owner: P1, depleted: true },
        { key: "refresh", def: depleter("restore"), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    cast(built, "refresh", { t: [id("tapped")] });
    assert.equal(engine.state.cards[id("tapped")]!.depleted, false, "restored");
    assert.equal(engine.state.cards[id("bystander")]!.depleted, true, "another depleted card stays depleted");
    const restored = events(engine, "cardRestored");
    assert.equal(restored.length, 1);
    assert.equal((restored[0] as { cardId: string }).cardId, id("tapped"));
  });
});

describe("CR 304 — destroy", () => {
  const smite = () => spell("Smite", [{ type: "destroy", target: pick("t") }]);

  rule("CR 304.1", "destroying a card removes it from play and puts it into its owner's discard pile", () => {
    const built = buildGame({
      cards: [
        { key: "c", def: character({ name: "C" }), owner: P1 },
        { key: "smite", def: smite(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    cast(built, "smite", { t: [id("c")] });
    assert.equal(zone(engine, id("c")), "discard");
    assert.ok(engine.state.players[P1].discard.includes(id("c")), "it is in the discard pile");
    assert.ok(!engine.state.players[P1].play.includes(id("c")), "and no longer in play");
  });

  rule("CR 304.1", "a card controlled by the other player goes to its OWNER's discard pile", () => {
    const built = buildGame({
      cards: [
        { key: "stolen", def: character({ name: "Stolen" }), owner: P1, controller: P2 },
        { key: "smite", def: smite(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    cast(built, "smite", { t: [id("stolen")] });
    assert.ok(engine.state.players[P1].discard.includes(id("stolen")), "in its owner's discard pile");
    assert.ok(!engine.state.players[P2].discard.includes(id("stolen")), "not in the controller's");
  });

  rule("CR 304.1", "every in-play card type can be destroyed (item and location too)", () => {
    const built = buildGame({
      cards: [
        { key: "i", def: item({ name: "I" }), owner: P1 },
        { key: "l", def: location({ name: "L" }), owner: P1 },
        { key: "s1", def: smite(), owner: P1, zone: "hand" },
        { key: "s2", def: smite(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    cast(built, "s1", { t: [id("i")] });
    cast(built, "s2", { t: [id("l")] });
    assert.equal(zone(engine, id("i")), "discard");
    assert.equal(zone(engine, id("l")), "discard");
  });

  rule("CR 304.1", "a card that is not in play cannot be destroyed: a destroy effect cannot reach it", () => {
    const hand = spell("HandSmite", [{ type: "destroy", target: pick("t") }], [{ id: "t", selector: { zone: "hand" }, count: 1 }]);
    const built = buildGame({
      cards: [
        { key: "h", def: character({ name: "H" }), owner: P1, zone: "hand" },
        { key: "smite", def: hand, owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    cast(built, "smite", { t: [id("h")] });
    assert.equal(zone(engine, id("h")), "hand", "nothing in play to remove: the card stays where it was");
    assert.equal(events(engine, "cardDestroyed").length, 0, "no destroyed event");
  });

  rule("CR 304.1", "destruction is not discarding: a 'would discard' replacement does not see a destroyed permanent", () => {
    const warded = character({
      name: "Warded",
      behavior: {
        abilities: [
          {
            id: "ward",
            type: "replacement",
            activeZone: "any",
            replaces: { event: "moveToZone", zone: "discard", from: "hand" },
            effects: [{ type: "removeFromGame", target: pick("__candidate") }]
          }
        ]
      }
    });
    const built = buildGame({
      cards: [
        { key: "w", def: warded, owner: P1 },
        { key: "smite", def: smite(), owner: P1, zone: "hand" }
      ]
    });
    cast(built, "smite", { t: [built.id("w")] });
    assert.equal(zone(built.engine, built.id("w")), "discard", "destroyed into the discard pile; the hand-discard replacement did not apply");
  });

  rule("CR 304.1", "destroying does leave a cardDestroyed event and the card is in the discard pile", () => {
    const built = buildGame({
      cards: [
        { key: "c", def: character({ name: "C" }), owner: P1 },
        { key: "smite", def: smite(), owner: P1, zone: "hand" }
      ]
    });
    cast(built, "smite", { t: [built.id("c")] });
    const destroyed = events(built.engine, "cardDestroyed");
    assert.equal(destroyed.length, 1, "one destroyed event");
    assert.equal((destroyed[0] as { cardId: string }).cardId, built.id("c"));
  });
});

describe("CR 305 — discard", () => {
  /** "Discard the cards you pick from your hand." */
  const discarder = () =>
    spell(
      "Discarder",
      [{ type: "forEach", selected: "t", effects: [{ type: "moveCard", target: pick("__candidate"), to: "discard" }] }],
      [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 2 }]
    );

  rule("CR 305.1", "discarding takes a card from its owner's hand and puts it into their discard pile", () => {
    const built = buildGame({
      cards: [
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" },
        { key: "d", def: discarder(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    cast(built, "d", { t: [id("h1"), id("h2")] });
    assert.ok(engine.state.players[P1].discard.includes(id("h1")), "H1 is in the discard pile");
    assert.ok(!engine.state.players[P1].hand.includes(id("h1")), "and left the hand");
    assert.equal(zone(engine, id("h2")), "discard");
    assert.equal(events(engine, "cardsDiscarded").length, 2, "two cards were discarded");
  });

  rule("CR 305.1", "discarding as a cost takes the picked card from hand to the discard pile", () => {
    const cardWithCost = character({
      name: "Pitcher",
      behavior: {
        abilities: [
          {
            id: "pitch",
            type: "activated",
            costs: [{ type: "discard", id: "dc", player: "controller", selector: { zone: "hand" }, count: 1 }],
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "p", def: cardWithCost, owner: P1 },
        { key: "h", def: character({ name: "H" }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("p"), abilityId: "pitch", selected: { dc: [id("h")] } });
    assert.equal(zone(engine, id("h")), "discard", "the discard cost moved the card at once");
    assert.equal(events(engine, "cardsDiscarded").length, 1);
  });

  rule("CR 305.1", "only a card in hand can be discarded: a card in play cannot be picked as a discard cost (hand card can)", () => {
    const def = () =>
      character({
        name: "Pitcher",
        behavior: {
          abilities: [
            {
              id: "pitch",
              type: "activated",
              costs: [{ type: "discard", id: "dc", player: "controller", selector: { zone: "hand" }, count: 1 }],
              effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
            }
          ]
        }
      });
    const make = () =>
      buildGame({
        cards: [
          { key: "p", def: def(), owner: P1 },
          { key: "inplay", def: character({ name: "InPlay" }), owner: P1 },
          { key: "h", def: character({ name: "H" }), owner: P1, zone: "hand" }
        ]
      });
    const control = make();
    control.engine.perform({ type: "activateAbility", playerId: P1, cardId: control.id("p"), abilityId: "pitch", selected: { dc: [control.id("h")] } });
    assert.equal(control.engine.state.cards[control.id("h")]!.zone, "discard", "control: a card in hand can be discarded");
    const bad = make();
    refused(
      () => bad.engine.perform({ type: "activateAbility", playerId: P1, cardId: bad.id("p"), abilityId: "pitch", selected: { dc: [bad.id("inplay")] } }),
      "discard a card that is in play"
    );
    assert.equal(bad.engine.state.cards[bad.id("inplay")]!.zone, "play", "the in-play card did not move");
  });

  rule("CR 305.1", "a discard replacement ('if you would discard') applies to a card leaving the hand", () => {
    const warded = character({
      name: "Warded",
      behavior: {
        abilities: [
          {
            id: "ward",
            type: "replacement",
            activeZone: "any",
            replaces: { event: "moveToZone", zone: "discard", from: "hand" },
            effects: [{ type: "removeFromGame", target: pick("__candidate") }]
          }
        ]
      }
    });
    const built = buildGame({
      cards: [
        { key: "w", def: warded, owner: P1, zone: "hand" },
        { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "hand" },
        { key: "d", def: discarder(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    cast(built, "d", { t: [id("w"), id("plain")] });
    assert.equal(zone(engine, id("w")), "removed", "the replaced discard sent it out of the game");
    assert.equal(zone(engine, id("plain")), "discard", "an unreplaced card was discarded normally");
  });

  rule("CR 305.2", "several cards discarded together all enter the discard pile at the same time: no trigger sees a half-finished discard", () => {
    // A watcher counts the cards already in its controller's discard pile each time a card is discarded.
    // Simultaneous entry means every observation sees both cards in the pile.
    const watcher = character({
      name: "Watcher",
      behavior: {
        abilities: [
          {
            id: "w",
            type: "triggered",
            event: "cardsDiscarded",
            effects: [
              {
                type: "modifyInfluence",
                player: "controller",
                amount: { type: "count", selector: { zone: "discard", owner: "self" } }
              }
            ]
          }
        ]
      }
    });
    const built = buildGame({
      cards: [
        { key: "watch", def: watcher, owner: P1 },
        { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
        { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" },
        { key: "d", def: discarder(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = built;
    const before = engine.state.players[P1].influence;
    cast(built, "d", { t: [id("h1"), id("h2")] });
    const gained = engine.state.players[P1].influence - before;
    // Two discard observations, each counting the discard pile at the moment it triggers: 2 + 2 = 4 when both cards
    // entered together, 1 + 2 = 3 if they entered one at a time (the spell itself is not in the pile until it resolves).
    assert.equal(gained, 4, "each trigger saw both cards already in the discard pile");
  });
});
