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

describe("exportState — a name-resolved snapshot of the whole board for replay / debugging", () => {
  test("every zone's contents, by card name, with influence and deck size", () => {
    const { engine, id } = buildGame({
      playerA: { name: "Alice", influence: 20 },
      playerB: { name: "Bob", influence: 18 },
      cards: [
        { key: "onBoard", def: character({ name: "Front Line" }), owner: P1 },
        { key: "inHand", def: tactic({ name: "Secret Plan" }), owner: P1, zone: "hand" },
        { key: "spent", def: tactic({ name: "Old News" }), owner: P1, zone: "discard" },
        { key: "gone", def: character({ name: "Exiled" }), owner: P1, zone: "removed" },
        { key: "d1", def: character({ name: "Deckcard 1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "Deckcard 2" }), owner: P1, zone: "deck" },
        { key: "oppMon", def: character({ name: "Their Guy" }), owner: P2 }
      ]
    });

    const snap = engine.exportState();

    assert.equal(snap.turn, 1);
    assert.equal(snap.activePlayerId, P1);
    assert.equal(snap.mode, "main");

    const alice = snap.players.find(p => p.id === P1)!;
    const bob = snap.players.find(p => p.id === P2)!;

    assert.equal(alice.name, "Alice");
    assert.equal(alice.influence, 20);
    assert.equal(bob.influence, 18);
    assert.equal(alice.deckCount, 2);

    assert.deepEqual(
      alice.play.map(c => c.name),
      ["Front Line"]
    );
    assert.deepEqual(
      alice.hand.map(c => c.name),
      ["Secret Plan"]
    );
    assert.deepEqual(
      alice.discard.map(c => c.name),
      ["Old News"]
    );
    assert.deepEqual(
      alice.removed.map(c => c.name),
      ["Exiled"]
    );
    assert.deepEqual(
      bob.play.map(c => c.name),
      ["Their Guy"]
    );

    // A card outside play carries no in-play status fields.
    const inHand = alice.hand[0];
    assert.equal(inHand.depleted, undefined);
    assert.equal(inHand.strength, undefined);
    assert.equal(inHand.damage, undefined);
  });

  test("in-play status is captured: damage, depletion, counters, effective strength", () => {
    const buffGear = item({
      name: "Buff Gear",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "buff",
            type: "continuous",
            modifiers: [
              { target: "attachedTo", stat: "strength", operation: "add", value: 2 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        {
          key: "hero",
          def: character({ name: "Hero", strength: 3, life: 5 }),
          owner: P1,
          damage: 2,
          depleted: true,
          counters: { valor: 1 }
        },
        { key: "gear", def: buffGear, owner: P1, attachedToKey: "hero" }
      ]
    });

    const hero = engine.exportState().players.find(p => p.id === P1)!.play.find(c => c.name === "Hero")!;

    assert.equal(hero.damage, 2);
    assert.equal(hero.depleted, true);
    assert.deepEqual(hero.counters, { valor: 1 });
    assert.equal(hero.strength, 5, "3 printed + 2 from the attached gear");
    assert.equal(hero.life, 5);
    assert.deepEqual(hero.attachments, [id("gear")]);
  });

  test("an attachment on an opponent's character shows under its own controller, and names its host", () => {
    const gear = item({
      name: "Borrowed Blade",
      attachTo: "character",
      behavior: {
        abilities: [
          {
            id: "edge",
            type: "continuous",
            modifiers: [
              { target: "attachedTo", stat: "strength", operation: "add", value: 1 }
            ]
          }
        ]
      }
    });

    const { engine, id } = buildGame({
      cards: [
        { key: "victim", def: character({ name: "Marked Target" }), owner: P1 },
        // P2 owns and controls the gear; it hangs off P1's character.
        { key: "gear", def: gear, owner: P2, attachedToKey: "victim" }
      ]
    });

    const snap = engine.exportState();
    const p1 = snap.players.find(p => p.id === P1)!;
    const p2 = snap.players.find(p => p.id === P2)!;

    // The gear is listed in its controller's play zone, flagged as such, and
    // names the host it is attached to.
    const gearSnap = p2.play.find(c => c.name === "Borrowed Blade")!;
    assert.equal(gearSnap.controllerId, P2);
    assert.deepEqual(gearSnap.attachedTo, { id: id("victim"), name: "Marked Target" });

    // The host, listed in the other player's zone, back-references the attachment.
    const victimSnap = p1.play.find(c => c.name === "Marked Target")!;
    assert.deepEqual(victimSnap.attachments, [id("gear")]);
    assert.equal(victimSnap.controllerId, undefined, "controller matches the zone owner — omitted");
  });

  test("captures the response stack in flight — outermost item first", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "alpha", def: tactic({ name: "Alpha" }), owner: P1, zone: "hand" },
        { key: "bravo", def: tactic({ name: "Bravo" }), owner: P2, zone: "hand" }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("alpha") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("bravo") });

    const snap = engine.exportState();
    assert.equal(snap.mode, "response");
    assert.deepEqual(
      snap.responseStack.map(s => s.label),
      ["Alpha", "Bravo"]
    );

    resolvePendingResponses(engine);
    assert.equal(engine.exportState().responseStack.length, 0);
  });

  test("the snapshot is plain serializable data — it round-trips through JSON", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "spell", def: tactic({ name: "Spark" }), owner: P1, zone: "hand" },
        { key: "res", def: resourceCard({ name: "Mana" }), owner: P1 },
        { key: "chump", def: character({ name: "Chump" }), owner: P2, damage: 1 }
      ]
    });

    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    resolvePendingResponses(engine);

    const snap = engine.exportState();
    assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  });
});
