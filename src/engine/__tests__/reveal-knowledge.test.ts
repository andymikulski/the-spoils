// Two reveal follow-ups:
//
//  1. `cardsRevealed.knownToRevealer`: set only when the player who caused the
//     reveal already knew every card in it (a search pick, a card from their own
//     hand, their own face-down resource). A renderer skips the "show the
//     revealer" moment only for those; the top of a deck, an opponent's hand or
//     an opponent's face-down card is news to the revealer.
//  2. Community Chest's mulligan reveal: bottoming it in the opening mulligan
//     while controlling [D] reveals it, off the `cardsMulliganed` event.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFactionGame } from "../../engine.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import { chooseDevelopOption, openDevelop, settleTurnStart } from "./support/develop.js";
import cardsJson from "../../data/cards.js";
import type { CardDefinition, Effect, GameEvent } from "../../engine.js";

type Built = ReturnType<typeof buildGame>;
type Revealed = Extract<GameEvent, { type: "cardsRevealed" }>;

function revealEvents(engine: Built["engine"]): Revealed[] {
  return engine
    .getLog()
    .flatMap(entry => (entry.event?.type === "cardsRevealed" ? [entry.event] : []));
}

/** A real catalog printing as a test definition, free to cast. */
function printing(name: string, set: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  const found = (cardsJson as CardDefinition[]).find(c => c.name === name && c.set === set);
  assert.ok(found, `${name} (${set}) is in the catalog`);
  return { ...structuredClone(found), cost: 0, threshold: 0, ...overrides };
}

const filler = (name: string) => tactic({ name });

/** A tactic whose only effect list is `effects`, cast by P1. */
function castEffects(effects: Effect[], cards: NonNullable<Parameters<typeof buildGame>[0]>["cards"] = []) {
  const spell = tactic({
    name: "Spell",
    behavior: { abilities: [{ id: "body", type: "activated", effects }] }
  });
  const built = buildGame({ cards: [{ key: "spell", def: spell, owner: P1, zone: "hand" }, ...cards] });
  built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("spell") });
  resolvePendingResponses(built.engine);
  return built;
}

describe("cardsRevealed.knownToRevealer: the revealer learns the card", () => {
  test("the top card of the revealer's own deck", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wheel", def: printing("Roulette Wheel of DOOM!", "Seed"), owner: P1, zone: "hand" },
        { key: "top", def: character({ name: "Top Card", cost: 2 }), owner: P1, zone: "deck" },
        { key: "victim", def: character({ name: "Victim", life: 2 }), owner: P2, zone: "play" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("wheel") });
    resolvePendingResponses(engine);

    const [event] = revealEvents(engine);
    assert.deepEqual(event.cardIds, [id("top")]);
    assert.equal(event.knownToRevealer, undefined);
  });

  test("the top card of the opponent's deck, while the card it then searches for is known", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "research", def: printing("Meager Research", "1st Edition"), owner: P1, zone: "hand" },
        { key: "oppTop", def: filler("Opponent Top"), owner: P2, zone: "deck" },
        { key: "mine", def: filler("My Tactic"), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("research") });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("mine")] }
    });
    resolvePendingResponses(engine);

    const [top, searched] = revealEvents(engine);
    assert.deepEqual(top.cardIds, [id("oppTop")]);
    assert.equal(top.knownToRevealer, undefined, "the opponent's top card is news");
    assert.deepEqual(searched.cardIds, [id("mine")]);
    assert.equal(searched.knownToRevealer, true, "the searcher picked it");
  });

  test("an opponent's hand, but not the revealer's own hand", () => {
    const hands = (of: "controller" | "opponent") =>
      revealEvents(
        castEffects([{ type: "reveal", of, zone: "hand", viewer: "all" }], [
          { key: "held", def: filler("Held Card"), owner: of === "controller" ? P1 : P2, zone: "hand" }
        ]).engine
      );

    const [theirs] = hands("opponent");
    assert.equal(theirs.ownerId, P2);
    assert.equal(theirs.knownToRevealer, undefined);

    const mine = hands("controller").find(event => event.ownerId === P1)!;
    assert.equal(mine.knownToRevealer, true);
  });

  test("Discommodiousness on the opponent's hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "disco", def: printing("Discommodiousness", "2nd Edition"), owner: P1, zone: "hand" },
        { key: "t1", def: filler("Held Tactic"), owner: P2, zone: "hand" },
        { key: "deckCard", def: filler("Deck Card"), owner: P2, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("disco") });
    resolvePendingResponses(engine);

    const [event] = revealEvents(engine);
    assert.equal(event.ownerId, P2);
    assert.equal(event.knownToRevealer, undefined);
  });

  test("cards turned over from the top of a deck until a match", () => {
    const { engine } = castEffects(
      [
        {
          type: "revealFromTopUntil",
          player: "controller",
          match: { type: "cardTypeIs", target: { type: "selected", id: "__candidate" }, cardType: "character" },
          bindAs: "hit",
          onMatch: []
        }
      ],
      [
        { key: "a", def: filler("Tactic A"), owner: P1, zone: "deck" },
        { key: "b", def: character({ name: "Character B" }), owner: P1, zone: "deck" }
      ]
    );
    const [event] = revealEvents(engine);
    assert.ok(event, "the cards were turned over");
    assert.equal(event.knownToRevealer, undefined);
  });

  test("Auction House's turned-over cards", () => {
    const house = location({
      name: "Auction House",
      behavior: {
        abilities: [
          { id: "auction", type: "triggered", event: "turnStarted", effects: [{ type: "auctionForCard", revealFor: "controller" }] }
        ]
      }
    });
    const { engine } = buildGame({
      cards: [
        { key: "house", def: house, owner: P1 },
        { key: "prize", def: character({ name: "Prize", strength: 5 }), owner: P1, zone: "deck" }
      ],
      activePlayerId: P2,
      turn: 2
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);

    const [event] = revealEvents(engine);
    assert.ok(event, "event");
    assert.equal(event.knownToRevealer, undefined);
  });

  test("Demolition Investment: the opponent's face-down resource is news to the player who reveals it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "demo", def: printing("Demolition Investment", "Ungodly Mess"), owner: P1, zone: "hand" },
        { key: "theirs", def: resourceCard({ name: "Their Resource" }), owner: P2, zone: "play", faceDown: true }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("demo"), selected: { p: [engine.state.players[P2].factionId!] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "chooserSelectsTarget", selected: [id("theirs")] }
    });
    resolvePendingResponses(engine);

    const [event] = revealEvents(engine);
    assert.deepEqual(event.cardIds, [id("theirs")]);
    assert.equal(event.ownerId, P2);
    assert.equal(event.knownToRevealer, undefined);
  });

  test("Mustache Showdown: the revealer knows the pile they split, not the one the opponent split", () => {
    const aficionado = character({
      name: "Mustache Aficionado",
      behavior: {
        abilities: [
          {
            id: "showdown",
            type: "activated",
            costs: [{ type: "deplete", target: "source" }],
            effects: [{ type: "partitionAndPick", count: 2, piles: 2, compareBy: "cost", winnerTakes: 1 }]
          }
        ]
      }
    });
    const costed = (name: string, cost: number) => character({ name, id: `rk-${name.toLowerCase()}`, cost });
    const { engine, id } = buildGame({
      cards: [
        { key: "afi", def: aficionado, owner: P1 },
        { key: "a1", def: costed("A1", 1), owner: P1, zone: "deck" },
        { key: "a2", def: costed("A2", 2), owner: P1, zone: "deck" },
        { key: "b1", def: costed("B1", 1), owner: P2, zone: "deck" },
        { key: "b2", def: costed("B2", 2), owner: P2, zone: "deck" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("afi"), abilityId: "showdown" });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "partitionCards", piles: [[id("a1")], [id("a2")]] }
    });
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "partitionCards", piles: [[id("b1")], [id("b2")]] }
    });
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "pickPile", index: 0 } });
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "pickPile", index: 0 } });

    const events = revealEvents(engine);
    assert.equal(events.find(e => e.ownerId === P1)!.knownToRevealer, true, "P1 split their own pile");
    assert.equal(events.find(e => e.ownerId === P2)!.knownToRevealer, undefined, "P2 split theirs");
  });
});

describe("cardsRevealed.knownToRevealer: the revealer already knew the card", () => {
  test("a search pick (Intellectual Reliquary takes a tactic from the top 3)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "reliquary", def: printing("Intellectual Reliquary", "Seed"), owner: P1, zone: "play" },
        { key: "res", def: resourceCard({ name: "Fuel" }), owner: P1, zone: "play" },
        { key: "spell", def: filler("Looked-At Tactic"), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("reliquary"),
      abilityId: "imbibe",
      selected: {}
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("spell")] } } as never);
    resolvePendingResponses(engine);

    const [event] = revealEvents(engine);
    assert.deepEqual(event.cardIds, [id("spell")]);
    assert.equal(event.knownToRevealer, true);
  });

  test("a face-down resource of the revealer's own (FLIP IT)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "flip", def: printing("Elitist Upgrade", "Holy Heist"), owner: P1, zone: "play", faceDown: true },
        ...Array.from({ length: 5 }, (_, i) => ({
          key: `r${i}`,
          def: resourceCard({ name: `Fuel ${i}`, resource: { provides: ["elitism"], staple: true } }),
          owner: P1,
          zone: "play" as const
        }))
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("flip"), abilityId: "flip-it" });
    resolvePendingResponses(engine);

    const [event] = revealEvents(engine);
    assert.deepEqual(event.cardIds, [id("flip")]);
    assert.equal(event.knownToRevealer, true);
  });

  test("a card revealed from the revealer's own hand as a cost (Uhluhtc Niudla)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "uhluhtc", def: printing("Uhluhtc Niudla", "Holy Heist"), owner: P1, zone: "play" },
        { key: "fuel", def: resourceCard({ name: "Fuel" }), owner: P1, zone: "play" },
        { key: "rev", def: resourceCard({ name: "Obsession" }), owner: P1, zone: "hand" },
        { key: "draw", def: filler("Drawn"), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("uhluhtc"),
      abilityId: "uhluhtc-avail",
      selected: { rev: [id("rev")] }
    });
    resolvePendingResponses(engine);

    const [event] = revealEvents(engine);
    assert.equal(event.zone, "hand");
    assert.equal(event.knownToRevealer, true);
  });

  test("a card revealed from hand to deploy it (Witty Worm)", () => {
    const { engine, id } = buildGame({
      playerA: {
        faction: factionCard({
          name: "Dev Faction",
          faction: defaultFactionDefinition({
            startingInfluence: 25,
            setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
            turn: {
              restore: { detachResources: true, restoreNonResources: true },
              develop: { choices: [{ type: "playResource", count: 1 }] }
            }
          })
        })
      },
      cards: [
        { key: "worm", def: character({ name: "Witty Worm", cost: 4, revealFromHand: { cost: 1 } }), owner: P1, zone: "hand" },
        { key: "o1", def: resourceCard({ name: "Fuel" }), owner: P1 },
        { key: "res", def: resourceCard({ name: "Pitch" }), owner: P1, zone: "hand" }
      ]
    });
    // Playing a resource for the Develop Rule: before the chosen card enters play, the Worm may be revealed.
    openDevelop(engine, P1);
    chooseDevelopOption(engine, P1, "Play a resource");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("res")] }
    });
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "resourceReveal", cardId: id("worm") }
    });
    resolvePendingResponses(engine);

    const [event] = revealEvents(engine);
    assert.deepEqual(event.cardIds, [id("worm")]);
    assert.equal(event.knownToRevealer, true);
  });

  test("an effect that reveals its own card", () => {
    const { engine } = castEffects([{ type: "revealCards", target: "source" }]);
    const [event] = revealEvents(engine);
    assert.equal(event.knownToRevealer, true);
  });
});

// -----------------------------------------------------------------------------
// Community Chest
// -----------------------------------------------------------------------------

describe("Community Chest reveals itself when bottomed in the opening mulligan", () => {
  const DECEPTION = resourceCard({ name: "Dec", resource: { provides: ["deception"], staple: true } });
  const RAGE = resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } });
  const FILLER = character({ name: "Filler", life: 2 });
  const CHEST = printing("Community Chest", "Seed 3");

  const factionWith = (resource: string) =>
    factionCard({
      name: `Faction ${resource}`,
      faction: defaultFactionDefinition({
        startingInfluence: 10,
        setup: {
          startingResources: { count: 2, names: [resource] },
          openingHand: { goingFirst: 4, goingSecond: 4 },
          mulligan: { count: 3, mode: "replaceAny" }
        },
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [{ type: "draw", count: 1 }] }
        }
      })
    });

  /** A game where P1 holds the Chest in the opening hand, in the mulligan step. */
  function chestInHand(resource: "Dec" | "Rage") {
    const faction = factionWith(resource);
    const deck = [DECEPTION.id, DECEPTION.id, RAGE.id, RAGE.id, CHEST.id, ...Array.from({ length: 8 }, () => FILLER.id)];
    for (let seed = 1; seed < 200; seed++) {
      const engine = createFactionGame(
        [faction, DECEPTION, RAGE, FILLER, CHEST],
        [{ id: P1, name: "Alice", factionDefinitionId: faction.id, deckDefinitionIds: deck },
        { id: P2, name: "Bob", factionDefinitionId: faction.id, deckDefinitionIds: deck }],
        { firstPlayerId: P1, seed }
      );
      const chestId = engine.state.players[P1].hand.find(cardId => engine.getDefinition(cardId).name === "Community Chest");
      if (chestId) return { engine, chestId };
    }
    throw new Error("no seed put Community Chest in the opening hand");
  }

  /** "You may reveal it": the Chest's controller accepts the offered reveal. */
  const acceptReveal = (engine: Built["engine"]) => {
    const pc = engine.state.pendingChoice;
    assert.equal(pc?.kind, "mayPay", "the reveal is a 'you may'");
    engine.perform({ type: "resolvePendingChoice", playerId: pc!.playerId, choice: { kind: "mayPay", pay: true } });
  };

  const mulliganEvents = (engine: Built["engine"]) =>
    engine.getLog().flatMap(entry => (entry.event?.type === "cardsMulliganed" ? [entry.event] : []));

  test("bottoming it with [D] in play reveals it to everyone from the deck, before the replacement draw", () => {
    const { engine, chestId } = chestInHand("Dec");
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [chestId] });
    acceptReveal(engine);

    const events = revealEvents(engine);
    assert.equal(events.length, 1);
    const [event] = events;
    assert.deepEqual(event.cardIds, [chestId]);
    assert.equal(event.zone, "deck");
    assert.equal(event.ownerId, P1);
    assert.equal(event.viewerId, "all");
    assert.equal(event.byCardId, chestId);
    assert.equal(event.knownToRevealer, true, "the player just chose to bottom it");

    const log = engine.getLog().map(entry => entry.event?.type);
    const mulliganedAt = log.indexOf("cardsMulliganed");
    const revealedAt = log.indexOf("cardsRevealed");
    const drawnAt = log.indexOf("cardsDrawn", mulliganedAt);
    assert.ok(mulliganedAt >= 0 && revealedAt > mulliganedAt, "revealed once it is bottomed");
    assert.ok(drawnAt < 0 || drawnAt > revealedAt, "revealed before the replacements are drawn");
    assert.deepEqual(mulliganEvents(engine).map(e => e.cardIds), [[chestId]]);
  });

  test("the other player's mulligan does not reveal it again", () => {
    const { engine, chestId } = chestInHand("Dec");
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [chestId] });
    acceptReveal(engine);
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [engine.state.players[P2].hand[0]] });
    assert.equal(revealEvents(engine).length, 1);
  });

  test("keeping it, or controlling no [D], reveals nothing", () => {
    const kept = chestInHand("Dec");
    kept.engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    assert.equal(revealEvents(kept.engine).length, 0, "kept in hand");

    const noD = chestInHand("Rage");
    noD.engine.perform({ type: "mulligan", playerId: P1, cardIds: [noD.chestId] });
    assert.equal(mulliganEvents(noD.engine).length, 1);
    assert.equal(revealEvents(noD.engine).length, 0, "no [D] among the starting resources");
  });

  test("bottoming other cards while keeping the Chest reveals nothing", () => {
    const { engine, chestId } = chestInHand("Dec");
    const other = engine.state.players[P1].hand.find(cardId => cardId !== chestId)!;
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [other] });
    assert.equal(revealEvents(engine).length, 0);
  });
});
