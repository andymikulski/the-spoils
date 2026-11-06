// Batch r05-abilities (docs/TESTING.md): CR 508 Temporary Rules Text.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { rule } from "./_rule.js";

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]!.zone;

/** A tactic that destroys the card picked for target `t`. */
const destroyer = (name: string) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector: {}, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

describe("CR 508 — temporary rules text", () => {
  /** A tactic that gives the picked card covert for as long as it stays in its game area. */
  const grantCovert = () =>
    tactic({
      name: "Shroud",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "permanent" } }]
          }
        ]
      }
    });

  const bounce = () =>
    tactic({
      name: "Bounce",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    });

  rule("CR 508.1", "temporary rules text exists on the card for as long as it stays where it is: it survives the end of the turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "c", def: character({ name: "Subject" }), owner: P1 },
        { key: "shroud", def: grantCovert(), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("shroud"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasKeyword(id("c"), "covert"), true, "gained");
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2);
    assert.equal(engine.hasKeyword(id("c"), "covert"), true, "still there on the next turn");
  });

  rule("CR 508.1", "the text is gone once the card enters another game area: after returning to hand and being deployed again it has no covert", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "c", def: character({ name: "Subject" }), owner: P1 },
        { key: "shroud", def: grantCovert(), owner: P1, zone: "hand" },
        { key: "bounce", def: bounce(), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("shroud"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasKeyword(id("c"), "covert"), true);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bounce"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("c")), "hand", "it entered another game area");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("c") });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("c")), "play", "deployed again");
    assert.equal(engine.hasKeyword(id("c"), "covert"), false, "the temporary rules text did not come back with it");
  });

  rule("CR 508.1", "text gained by a card in play is gone when it goes to the discard pile and is put back into play", () => {
    const revive = tactic({
      name: "Revive",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "c", def: character({ name: "Subject" }), owner: P1 },
        { key: "shroud", def: grantCovert(), owner: P1, zone: "hand" },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" },
        { key: "revive", def: revive, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("shroud"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("revive"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("c")), "play", "back in play");
    assert.equal(engine.hasKeyword(id("c"), "covert"), false, "without the temporary text");
  });

  /** Gives the surviving character all of a removed character's rules text (Skin Suit style). */
  const copier = () =>
    tactic({
      name: "Copy Text",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [
              { id: "to", selector: { type: "character", name: "Survivor" }, count: 1 },
              { id: "from", selector: { type: "character", name: "Donor" }, count: 1 }
            ],
            effects: [{ type: "grantAbilitiesFrom", target: { type: "selected", id: "to" }, from: { type: "selected", id: "from" } }]
          }
        ]
      }
    });

  const leavesPlayDraw = {
    id: "leaves",
    type: "triggered" as const,
    event: "cardMoved" as const,
    condition: { type: "and" as const, conditions: [{ type: "sourceIsEventCard" as const }, { type: "cardMovedFromZone" as const, zone: "play" as const }] },
    effects: [{ type: "draw" as const, player: "controller" as const, amount: 1 }]
  };

  const textBoard = () =>
    buildGame({
      cards: [
        { key: "survivor", def: character({ name: "Survivor" }), owner: P1 },
        { key: "donor", def: character({ name: "Donor", behavior: { abilities: [leavesPlayDraw] } }), owner: P1 },
        { key: "copy", def: copier(), owner: P1, zone: "hand" },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" },
        { key: "d1", def: character({ name: "Deck 1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "Deck 2" }), owner: P1, zone: "deck" }
      ]
    });

  rule("CR 508.1a", "temporary rules text 'if this card leaves play, draw a card' triggers when the card leaves play", () => {
    const { engine, id } = textBoard();
    engine.perform({ type: "playCard", playerId: P1, cardId: id("copy"), selected: { to: [id("survivor")], from: [id("donor")] } });
    resolvePendingResponses(engine);
    const handBefore = engine.state.players[P1].hand.length;
    engine.perform({ type: "endTurn", playerId: P1 });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("survivor")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("survivor")), "discard", "the card with the temporary text left play");
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1, "its temporary 'leaves play' text drew a card");
  });

  rule("CR 508.1a", "control: a card that never gained the text draws nothing when it leaves play", () => {
    const { engine, id } = textBoard();
    const handBefore = engine.state.players[P1].hand.length;
    engine.perform({ type: "endTurn", playerId: P1 });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("survivor")] } });
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("survivor")), "discard");
    assert.equal(engine.state.players[P1].hand.length, handBefore, "no text, no draw");
  });

  rule("CR 508.2", "a card that 'gains' a keyword is considered to have it as temporary rules text: it has the keyword for the whole time it stays in play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "c", def: character({ name: "Subject" }), owner: P1 },
        { key: "shroud", def: grantCovert(), owner: P1, zone: "hand" }
      ]
    });
    assert.deepEqual(engine.getKeywords(id("c")), [], "before");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("shroud"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);
    assert.deepEqual(engine.getKeywords(id("c")), ["covert"], "it has the keyword");
  });

  rule("CR 508.2", "a keyword gained for a limited time is gone when that time ends (control for the permanent case)", () => {
    const flash = tactic({
      name: "Flash Shroud",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character" }, count: 1 }],
            effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "c", def: character({ name: "Subject" }), owner: P1 },
        { key: "flash", def: flash, owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("flash"), selected: { t: [id("c")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasKeyword(id("c"), "covert"), true);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.hasKeyword(id("c"), "covert"), false, "the stated duration ended");
  });

  const animate = () =>
    tactic({
      name: "Animate",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { type: "item" }, count: 1 }],
            effects: [
              {
                type: "setCardType",
                target: { type: "selected", id: "t" },
                cardType: "character",
                grantStats: { strength: 1, life: 3, speed: 1 },
                duration: { type: "permanent" }
              }
            ]
          }
        ]
      }
    });

  const unanimate = () =>
    tactic({
      name: "Unanimate",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: {}, count: 1 }],
            effects: [{ type: "removeCardType", target: { type: "selected", id: "t" }, cardType: "character" }]
          }
        ]
      }
    });

  const grantAny = () =>
    tactic({
      name: "Shroud Anything",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: {}, count: 1 }],
            effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "permanent" } }]
          }
        ]
      }
    });

  rule(
    "CR 508.3",
    "text gained while the card was a character is removed when it later loses the character type",
    () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "box", def: item({ name: "Box" }), owner: P1 },
          { key: "animate", def: animate(), owner: P1, zone: "hand" },
          { key: "shroud", def: grantAny(), owner: P1, zone: "hand" },
          { key: "unanimate", def: unanimate(), owner: P1, zone: "hand" }
        ]
      });
      engine.perform({ type: "playCard", playerId: P1, cardId: id("animate"), selected: { t: [id("box")] } });
      resolvePendingResponses(engine);
      assert.equal(engine.hasCardType(id("box"), "character"), true, "the item is a character");
      engine.perform({ type: "playCard", playerId: P1, cardId: id("shroud"), selected: { t: [id("box")] } });
      resolvePendingResponses(engine);
      assert.equal(engine.hasKeyword(id("box"), "covert"), true, "it gained covert while a character");
      engine.perform({ type: "playCard", playerId: P1, cardId: id("unanimate"), selected: { t: [id("box")] } });
      resolvePendingResponses(engine);
      assert.equal(engine.hasCardType(id("box"), "character"), false, "it is an item again");
      assert.equal(engine.hasKeyword(id("box"), "covert"), false, "the text gained while it was a character is gone");
    }
  );

  rule("CR 508.3", "text gained while the card was NOT a character is not removed when it later becomes and stops being one", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "box", def: item({ name: "Box" }), owner: P1 },
        { key: "animate", def: animate(), owner: P1, zone: "hand" },
        { key: "shroud", def: grantAny(), owner: P1, zone: "hand" },
        { key: "unanimate", def: unanimate(), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("shroud"), selected: { t: [id("box")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasKeyword(id("box"), "covert"), true, "gained as an item");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("animate"), selected: { t: [id("box")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("unanimate"), selected: { t: [id("box")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("box"), "character"), false, "it is an item again");
    assert.equal(engine.hasKeyword(id("box"), "covert"), true, "text gained while it was not a character stays");
  });

  rule("CR 508.3", "control: while the card is still a character it keeps the text it gained", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "box", def: item({ name: "Box" }), owner: P1 },
        { key: "animate", def: animate(), owner: P1, zone: "hand" },
        { key: "shroud", def: grantAny(), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("animate"), selected: { t: [id("box")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("shroud"), selected: { t: [id("box")] } });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.hasCardType(id("box"), "character"), true);
    assert.equal(engine.hasKeyword(id("box"), "covert"), true);
  });
});
