// Reveals that are not searches: "reveal the top N cards of a deck", "reveals
// their hand", "look at the top N, choose X and reveal it", a revealed face-down
// resource, a card revealed from hand, Auction House's turned-over cards and
// Mustache Showdown's chosen piles. Every one emits `cardsRevealed`.
//
// Part 1 plays real catalog printings end to end, part 2 proves the engine-side
// reveals with synthetic fixtures, part 3 checks the catalog data per printing.
// (Search-and-reveal lives in search-reveal.test.ts.)

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  buildGame,
  character,
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

/** Log position of the first event matching `predicate`, or -1. */
function logIndex(engine: Built["engine"], predicate: (event: GameEvent) => boolean): number {
  return engine.getLog().findIndex(entry => entry.event !== undefined && predicate(entry.event));
}

/** A real catalog printing as a test definition, free to cast. */
function printing(name: string, set: string, overrides: Partial<CardDefinition> = {}): CardDefinition {
  const found = (cardsJson as CardDefinition[]).find(c => c.name === name && c.set === set);
  assert.ok(found, `${name} (${set}) is in the catalog`);
  return { ...structuredClone(found), cost: 0, threshold: 0, ...overrides };
}

const filler = (name: string) => tactic({ name });

describe("reveal effects on real printings", () => {
  test("Roulette Wheel of DOOM! shows the top card of its controller's deck before the pick", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "wheel", def: printing("Roulette Wheel of DOOM!", "Seed"), owner: P1, zone: "hand" },
        { key: "top", def: character({ name: "Top Card", cost: 2 }), owner: P1, zone: "deck" },
        { key: "next", def: filler("Next Card"), owner: P1, zone: "deck" },
        { key: "victim", def: character({ name: "Victim", life: 2 }), owner: P2, zone: "play" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("wheel") });
    resolvePendingResponses(engine);

    const [event, ...rest] = revealEvents(engine);
    assert.equal(rest.length, 0);
    assert.deepEqual(event.cardIds, [id("top")]);
    assert.equal(event.zone, "deck");
    assert.equal(event.ownerId, P1);
    assert.equal(event.viewerId, "all");
    assert.equal(event.byCardId, id("wheel"));
    assert.equal(engine.state.cards[id("top")].zone, "deck", "revealed, not moved");
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the pick comes after the reveal");
  });

  test("Meager Research shows the top card of the opponent's deck, then the card it searches for", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "research", def: printing("Meager Research", "1st Edition"), owner: P1, zone: "hand" },
        { key: "oppTop", def: filler("Opponent Top"), owner: P2, zone: "deck" },
        { key: "oppNext", def: filler("Opponent Next"), owner: P2, zone: "deck" },
        { key: "mine", def: filler("My Tactic"), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("research") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("mine")] }
    });
    resolvePendingResponses(engine);

    const events = revealEvents(engine);
    assert.equal(events.length, 2);
    assert.deepEqual(events[0].cardIds, [id("oppTop")]);
    assert.equal(events[0].ownerId, P2);
    assert.equal(events[0].zone, "deck");
    assert.equal(events[0].viewerId, "all");
    assert.deepEqual(events[1].cardIds, [id("mine")]);
    assert.equal(events[1].ownerId, P1);

    const revealedAt = logIndex(engine, e => e.type === "cardsRevealed" && e.ownerId === P2);
    const movedAt = logIndex(engine, e => e.type === "cardMoved" && e.cardId === id("oppTop") && e.to === "hand");
    assert.ok(revealedAt >= 0 && movedAt > revealedAt, "revealed from the deck, then put into their hand");
  });

  test("Discommodiousness (2nd Edition) shows the opponent's whole hand before the tactics are shuffled away", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "disco", def: printing("Discommodiousness", "2nd Edition"), owner: P1, zone: "hand" },
        { key: "t1", def: filler("Held Tactic"), owner: P2, zone: "hand" },
        { key: "c1", def: character({ name: "Held Character" }), owner: P2, zone: "hand" },
        { key: "deckCard", def: filler("Deck Card"), owner: P2, zone: "deck" },
        { key: "mineDeck", def: filler("My Deck Card"), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("disco") });
    resolvePendingResponses(engine);

    const [event, ...rest] = revealEvents(engine);
    assert.equal(rest.length, 0);
    assert.deepEqual([...event.cardIds].sort(), [id("t1"), id("c1")].sort());
    assert.equal(event.zone, "hand");
    assert.equal(event.ownerId, P2);
    assert.equal(event.viewerId, "all");
    assert.equal(event.byCardId, id("disco"));

    const revealedAt = logIndex(engine, e => e.type === "cardsRevealed");
    const movedAt = logIndex(engine, e => e.type === "cardMoved" && e.cardId === id("t1") && e.to === "deck");
    assert.ok(revealedAt >= 0 && movedAt > revealedAt, "revealedAt >= 0 && movedAt > revealedAt");
  });

  test("Intellectual Reliquary reveals the tactic it takes from the top 3, and nothing when it takes none", () => {
    const play = (pick: boolean) => {
      const built = buildGame({
        cards: [
          { key: "reliquary", def: printing("Intellectual Reliquary", "Seed"), owner: P1, zone: "play" },
          { key: "res", def: resourceCard({ name: "Fuel" }), owner: P1, zone: "play" },
          { key: "spell", def: filler("Looked-At Tactic"), owner: P1, zone: "deck" },
          { key: "other", def: filler("Another Tactic"), owner: P1, zone: "deck" }
        ]
      });
      const { engine, id } = built;
      engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: id("reliquary"),
        abilityId: "imbibe",
        selected: {}
      });
      resolvePendingResponses(engine);
      // the tactic is chosen when the ability resolves
      const open = engine.state.pendingChoice as { kind: string; playerId: typeof P1 } | undefined;
      if (open?.kind === "chooserSelectsTarget") {
        engine.perform({ type: "resolvePendingChoice", playerId: open.playerId, choice: { kind: "chooserSelectsTarget", selected: pick ? [id("spell")] : [] } } as never);
        resolvePendingResponses(engine);
      }
      return built;
    };

    const taken = play(true);
    const [event, ...rest] = revealEvents(taken.engine);
    assert.equal(rest.length, 0);
    assert.deepEqual(event.cardIds, [taken.id("spell")]);
    assert.equal(event.zone, "deck");
    assert.equal(event.viewerId, "all");
    assert.ok(taken.engine.state.players[P1].hand.includes(taken.id("spell")), "taken.engine.state.players[P1].hand.includes(taken.id(\"spell\"))");
    const revealedAt = logIndex(taken.engine, e => e.type === "cardsRevealed");
    const movedAt = logIndex(taken.engine, e => e.type === "cardMoved" && e.cardId === taken.id("spell") && e.to === "hand");
    assert.ok(revealedAt >= 0 && movedAt > revealedAt, "revealed while still in the deck");

    assert.equal(revealEvents(play(false).engine).length, 0, "choosing no tactic reveals nothing");
  });

  test("Cheats McGuillicutty's CHEAT reveals the top card in the 2nd Edition printing only", () => {
    const cheat = (set: string) => {
      const built = buildGame({
        cards: [
          { key: "cheats", def: printing("Cheats McGuillicutty", set), owner: P1, zone: "play" },
          { key: "top", def: character({ name: "Top Character" }), owner: P1, zone: "deck" }
        ]
      });
      built.engine.perform({
        type: "activateAbility",
        playerId: P1,
        cardId: built.id("cheats"),
        abilityId: "cheat"
      });
      resolvePendingResponses(built.engine);
      return built;
    };

    const second = cheat("2nd Edition");
    const [event] = revealEvents(second.engine);
    assert.deepEqual(event.cardIds, [second.id("top")]);
    assert.equal(event.zone, "deck");
    assert.equal(event.ownerId, P1);

    assert.equal(revealEvents(cheat("1st Edition Part 2").engine).length, 0, "that printing says \"look at\"");
  });
});

describe("reveals the engine emits for data flags and rules", () => {
  test("using a face-down resource's ability reveals the resource; a face-up ability does not", () => {
    const hand = character({
      name: "Fired Hand",
      behavior: {
        abilities: [
          {
            id: "petty",
            type: "activated",
            fromFaceDown: true,
            condition: { type: "sourceIsFaceDown" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [{ key: "fh", def: hand, owner: P1, zone: "play", faceDown: true }]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("fh"), abilityId: "petty" });
    resolvePendingResponses(engine);

    const [event, ...rest] = revealEvents(engine);
    assert.equal(rest.length, 0);
    assert.deepEqual(event.cardIds, [id("fh")]);
    assert.equal(event.zone, "play");
    assert.equal(event.ownerId, P1);
    assert.equal(event.viewerId, "all");
    assert.equal(event.byCardId, id("fh"));
    assert.equal(engine.state.cards[id("fh")].faceDown, true, "still face-down; it was only shown");

    const plain = character({
      name: "Plain",
      behavior: {
        abilities: [
          { id: "ping", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }
        ]
      }
    });
    const faceUp = buildGame({ cards: [{ key: "p", def: plain, owner: P1, zone: "play" }] });
    faceUp.engine.perform({ type: "activateAbility", playerId: P1, cardId: faceUp.id("p"), abilityId: "ping" });
    resolvePendingResponses(faceUp.engine);
    assert.equal(revealEvents(faceUp.engine).length, 0);
  });

  test("a FLIP IT activation from the catalog reveals the face-down resource it flips", () => {
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
    assert.equal(event.ownerId, P1);
    assert.equal(engine.state.cards[id("flip")].faceDown, false, "flipped face-up after being revealed");
    assert.ok(
      logIndex(engine, e => e.type === "cardsRevealed") < logIndex(engine, e => e.type === "abilityActivated"),
      "shown as the ability is paid for"
    );
  });

  test("revealing a card from hand to deploy it (Witty Worm) shows it from the hand", () => {
    const { engine, id } = buildGame({
      playerA: { faction: factionCard({ name: "Dev Faction", faction: devFaction() }) },
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
    assert.equal(engine.state.pendingChoice?.kind, "resourceReveal");
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "resourceReveal", cardId: id("worm") }
    });
    resolvePendingResponses(engine);

    const [event, ...rest] = revealEvents(engine);
    assert.equal(rest.length, 0);
    assert.deepEqual(event.cardIds, [id("worm")]);
    assert.equal(event.zone, "hand");
    assert.equal(event.ownerId, P1);
    assert.equal(event.viewerId, "all");
    assert.equal(engine.state.cards[id("worm")].zone, "play");
  });

  test("a moveSelected cost with reveal shows the chosen card from the zone it leaves, once", () => {
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

    const events = revealEvents(engine);
    assert.equal(events.length, 1, "the affordability probe does not reveal");
    assert.deepEqual(events[0].cardIds, [id("rev")]);
    assert.equal(events[0].zone, "hand");
    assert.equal(events[0].ownerId, P1);
    assert.equal(events[0].viewerId, "all");
    const revealedAt = logIndex(engine, e => e.type === "cardsRevealed");
    const movedAt = logIndex(engine, e => e.type === "cardMoved" && e.cardId === id("rev") && e.to === "deck");
    assert.ok(revealedAt >= 0 && movedAt > revealedAt, "revealed from the hand, then shuffled into the deck");
  });

  test("revealCards can name the effect's own card (Thabbashite Desert Creature reveals itself)", () => {
    const self = tactic({
      name: "Self Reveal",
      behavior: {
        abilities: [{ id: "body", type: "activated", effects: [{ type: "revealCards", target: "source" }] }]
      }
    });
    const { engine, id } = buildGame({ cards: [{ key: "spell", def: self, owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("spell") });
    resolvePendingResponses(engine);

    const [event, ...rest] = revealEvents(engine);
    assert.equal(rest.length, 0);
    assert.deepEqual(event.cardIds, [id("spell")]);
    assert.equal(event.byCardId, id("spell"));
  });

  describe("Auction House", () => {
    const house = () =>
      location({
        name: "Auction House",
        behavior: {
          abilities: [
            {
              id: "auction",
              type: "triggered",
              event: "turnStarted",
              // Only the start of its controller's own turn: at a bigger table the other seats start turns too.
              condition: { type: "isActivePlayer" },
              effects: [{ type: "auctionForCard", revealFor: "controller" }]
            }
          ]
        }
      });

    test("shows every card turned over from the deck, through the first character", () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "house", def: house(), owner: P1 },
          { key: "skipped", def: filler("Skipped Tactic"), owner: P1, zone: "deck" },
          { key: "prize", def: character({ name: "Prize", strength: 5 }), owner: P1, zone: "deck" },
          { key: "below", def: filler("Untouched"), owner: P1, zone: "deck" }
        ],
        activePlayerId: P2,
        turn: 2
      });
      engine.perform({ type: "endTurn", playerId: P2 });
      resolvePendingResponses(engine);
      settleTurnStart(engine);

      const [event, ...rest] = revealEvents(engine);
      assert.equal(rest.length, 0);
      assert.deepEqual(event.cardIds, [id("skipped"), id("prize")]);
      assert.equal(event.zone, "deck");
      assert.equal(event.ownerId, P1);
      assert.equal(event.viewerId, "all");
      assert.equal(event.byCardId, id("house"));
      assert.equal(engine.state.pendingChoice?.kind, "auctionBid");
    });

    test("shows the whole deck when no character turns up", () => {
      const { engine, id } = buildGame({
        cards: [
          { key: "house", def: house(), owner: P1 },
          { key: "a", def: filler("Tactic A"), owner: P1, zone: "deck" },
          { key: "b", def: filler("Tactic B"), owner: P1, zone: "deck" }
        ],
        activePlayerId: P2,
        turn: 2
      });
      engine.perform({ type: "endTurn", playerId: P2 });
      resolvePendingResponses(engine);
      settleTurnStart(engine);

      const [event, ...rest] = revealEvents(engine);
      assert.equal(rest.length, 0);
      assert.deepEqual(event.cardIds, [id("a"), id("b")]);
      assert.equal(engine.state.pendingChoice, undefined);
    });
  });

  test("Mustache Showdown reveals the two chosen piles", () => {
    const aficionado = character({
      name: "Mustache Aficionado",
      behavior: {
        abilities: [
          {
            id: "showdown",
            type: "activated",
            costs: [{ type: "deplete", target: "source" }],
            effects: [{ type: "partitionAndPick", count: 3, piles: 2, compareBy: "cost", winnerTakes: 1 }]
          }
        ]
      }
    });
    const costed = (name: string, cost: number) => character({ name, id: `mx-${name.toLowerCase()}`, cost });
    const { engine, id } = buildGame({
      cards: [
        { key: "afi", def: aficionado, owner: P1 },
        { key: "a1", def: costed("A1", 1), owner: P1, zone: "deck" },
        { key: "a2", def: costed("A2", 1), owner: P1, zone: "deck" },
        { key: "a3", def: costed("A3", 5), owner: P1, zone: "deck" },
        { key: "b1", def: costed("B1", 1), owner: P2, zone: "deck" },
        { key: "b2", def: costed("B2", 1), owner: P2, zone: "deck" },
        { key: "b3", def: costed("B3", 1), owner: P2, zone: "deck" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("afi"), abilityId: "showdown" });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "partitionCards", piles: [[id("a1"), id("a2")], [id("a3")]] }
    });
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P2,
      choice: { kind: "partitionCards", piles: [[id("b1"), id("b2")], [id("b3")]] }
    });
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "pickPile", index: 0 } });
    assert.equal(revealEvents(engine).length, 0, "piles stay face-down until both are chosen");
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "pickPile", index: 1 } });

    const events = revealEvents(engine);
    assert.equal(events.length, 2);
    const mine = events.find(e => e.ownerId === P1)!;
    const theirs = events.find(e => e.ownerId === P2)!;
    assert.deepEqual(mine.cardIds, [id("a3")], "P2 chose P1's second pile");
    assert.deepEqual(theirs.cardIds, [id("b1"), id("b2")], "P1 chose P2's first pile");
    for (const event of events) {
      assert.equal(event.zone, "deck");
      assert.equal(event.viewerId, "all");
      assert.equal(event.byCardId, id("afi"));
    }
  });
});

describe("a reveal names the zone holder, not the card owner", () => {
  // P1 controls a resource P2 owns; the operator's ability moves it into P1's
  // hand or deck (`toPlayer: "controller"`), where it is held by P1.
  const RES = { type: "selected", id: "res" } as const;
  const operator = (effects: Effect[]) =>
    character({
      name: "Operator",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            targets: [{ id: "res", selector: { controller: "self", type: "resource" }, count: 1 }],
            effects
          }
        ]
      }
    });
  const stolenGame = (effects: Effect[], extra: NonNullable<Parameters<typeof buildGame>[0]>["cards"] = []) => {
    const built = buildGame({
      cards: [
        { key: "op", def: operator(effects), owner: P1, zone: "play" },
        { key: "res", def: resourceCard({ name: "Borrowed Resource" }), owner: P2, controller: P1, zone: "play" },
        ...extra
      ]
    });
    built.engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: built.id("op"),
      abilityId: "go",
      selected: { res: [built.id("res")] }
    });
    resolvePendingResponses(built.engine);
    return built;
  };

  test("a card held in the controller's hand is revealed from the controller's hand", () => {
    const { engine, id } = stolenGame([
      { type: "moveCard", target: RES, to: "hand", toPlayer: "controller" },
      { type: "revealCards", selected: "res" }
    ]);
    assert.equal(engine.state.cards[id("res")].heldBy, P1);

    const [event, ...rest] = revealEvents(engine);
    assert.equal(rest.length, 0);
    assert.deepEqual(event.cardIds, [id("res")]);
    assert.equal(event.zone, "hand");
    assert.equal(event.ownerId, P1, "P1's hand, although P2 owns the card");
    const entry = engine.getLog().find(e => e.event?.type === "cardsRevealed");
    assert.match(entry!.message, /Alice reveals Borrowed Resource from hand/);
  });

  test("a card held in the controller's deck is revealed from the controller's deck", () => {
    const { engine, id } = stolenGame([
      { type: "moveCard", target: RES, to: "deck", position: "top", toPlayer: "controller" },
      { type: "revealCards", selected: "res" }
    ]);
    const [event, ...rest] = revealEvents(engine);
    assert.equal(rest.length, 0);
    assert.equal(event.zone, "deck");
    assert.equal(event.ownerId, P1);
  });

  test("a card moved to its owner's hand (no toPlayer) is still revealed from the owner's hand", () => {
    const { engine } = stolenGame([
      { type: "moveCard", target: RES, to: "hand" },
      { type: "revealCards", selected: "res" }
    ]);
    const [event] = revealEvents(engine);
    assert.equal(event.zone, "hand");
    assert.equal(event.ownerId, P2);
  });

  test("one reveal across both hands groups by holder: the borrowed card joins the holder's own cards", () => {
    const { engine, id } = stolenGame(
      [
        { type: "moveCard", target: RES, to: "hand", toPlayer: "controller" },
        { type: "revealCards", selector: { zone: "hand" } }
      ],
      [
        { key: "mine", def: tactic({ name: "Mine" }), owner: P1, zone: "hand" },
        { key: "theirs", def: tactic({ name: "Theirs" }), owner: P2, zone: "hand" }
      ]
    );
    const events = revealEvents(engine);
    assert.equal(events.length, 2);
    const fromP1 = events.find(e => e.ownerId === P1)!;
    const fromP2 = events.find(e => e.ownerId === P2)!;
    assert.deepEqual([...fromP1.cardIds].sort(), [id("mine"), id("res")].sort());
    assert.deepEqual(fromP2.cardIds, [id("theirs")]);
  });

  test("Auction House shows a borrowed card from the deck of the player holding it", () => {
    const { engine, id } = stolenGame(
      [
        { type: "moveCard", target: RES, to: "deck", position: "top", toPlayer: "controller" },
        { type: "auctionForCard", revealFor: "controller" }
      ],
      [{ key: "prize", def: character({ name: "Prize", strength: 5 }), owner: P1, zone: "deck" }]
    );
    const [event, ...rest] = revealEvents(engine);
    assert.equal(rest.length, 0, "the borrowed card and the prize come out of one deck");
    assert.deepEqual(event.cardIds, [id("res"), id("prize")]);
    assert.equal(event.zone, "deck");
    assert.equal(event.ownerId, P1);
  });
});

function devFaction(): CardDefinition["faction"] & object {
  return {
    startingInfluence: 25,
    setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "playResource", count: 1 }] }
    }
  };
}

// -----------------------------------------------------------------------------
// Real catalog: per printing
// -----------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readJson = (rel: string) => JSON.parse(readFileSync(ROOT + rel, "utf8"));

interface CatalogCard {
  id: string;
  name: string;
  set: string;
  text?: string;
  behavior?: unknown;
  faction?: unknown;
  revealFromHand?: unknown;
}

const catalog = readJson("data/cards.json") as CatalogCard[];
const corrections = readJson("data/card-audit/corrections.json") as Record<string, { text?: string }>;
const printedText = (card: CatalogCard): string => corrections[card.id]?.text ?? card.text ?? "";
const behaviorJson = (card: CatalogCard): string => JSON.stringify([card.behavior, card.faction, card.revealFromHand]);

/** Every way a printing can emit `cardsRevealed`. */
const REVEAL_MECHANISMS = [
  '"type":"reveal"',
  '"type":"revealCards"',
  '"type":"revealFromTopUntil"',
  '"type":"partitionAndPick"',
  '"type":"auctionForCard"',
  '"grantsReveal"',
  '"fromFaceDown":true',
  '"reveal":true',
  '"type":"revealSelf"',
  '"from":"heroDeckTop"'
];

const hasMechanism = (card: CatalogCard): boolean => {
  const json = behaviorJson(card);
  return Boolean(card.revealFromHand) || REVEAL_MECHANISMS.some(mechanism => json.includes(mechanism));
};

/** Printed reveals the engine does not model yet, with the reason. */
const UNMODELED: Record<string, string> = {};

describe("every printed reveal has a mechanism", () => {
  test("each printing whose text says reveal emits a reveal somewhere, bar the documented gaps", () => {
    const missing = catalog
      .filter(card => /reveal/i.test(printedText(card)))
      .filter(card => !hasMechanism(card))
      .filter(card => !(card.name in UNMODELED))
      .map(card => `${card.name} (${card.set}) ${card.id}`);
    assert.deepEqual(missing, []);
  });

  test("the documented gaps are still gaps", () => {
    const stale = catalog
      .filter(card => card.name in UNMODELED)
      .filter(card => hasMechanism(card))
      .map(card => `${card.name} (${card.set})`);
    assert.deepEqual(stale, [], "drop the entry from UNMODELED once the card reveals");
  });

  test("a printing only reveals to everyone when its text says reveal (\"look at\" is a private viewer)", () => {
    const publicReveal = (node: unknown): boolean => {
      if (Array.isArray(node)) return node.some(publicReveal);
      if (!node || typeof node !== "object") return false;
      const record = node as Record<string, unknown>;
      if ((record.type === "reveal" || record.type === "revealCards") && (record.viewer === undefined || record.viewer === "all")) return true;
      if (record.type === "moveSelected" && record.reveal === true) return true;
      return Object.values(record).some(publicReveal);
    };
    const wrong = catalog
      .filter(card => publicReveal([card.behavior, card.faction]))
      .filter(card => !/reveal/i.test(printedText(card)))
      .map(card => `${card.name} (${card.set}) ${card.id}`);
    assert.deepEqual(wrong, []);
  });

  test("every fromFaceDown ability prints \"Reveal this card\" (the engine reveals the source when it is used)", () => {
    const wrong = catalog
      .filter(card => JSON.stringify(card.behavior ?? null).includes('"fromFaceDown":true'))
      .filter(card => !/reveal this card/i.test(printedText(card)))
      .map(card => `${card.name} (${card.set}) ${card.id}`);
    assert.deepEqual(wrong, []);
  });

  test("every revealFromHand printing prints that it reveals the card", () => {
    const wrong = catalog
      .filter(card => card.revealFromHand)
      .filter(card => !/reveal this card/i.test(printedText(card)))
      .map(card => `${card.name} (${card.set}) ${card.id}`);
    assert.deepEqual(wrong, []);
  });

  test("a reveal pick names a declaration that exists", () => {
    const problems: string[] = [];
    for (const card of catalog) {
      const json = behaviorJson(card);
      for (const match of json.matchAll(/"type":"revealCards","selected":"([^"]+)"/g)) {
        if (!json.includes(`"id":"${match[1]}"`)) problems.push(`${card.name} (${card.set}): no declaration '${match[1]}'`);
      }
    }
    assert.deepEqual(problems, []);
  });
});

describe("other-reveals.patch.cjs matches the catalog", () => {
  const patch = createRequire(import.meta.url)("../../../data/card-audit/other-reveals.patch.cjs") as {
    RULES: { name: string; when: RegExp; apply: (card: CatalogCard) => void }[];
  };

  test("re-applying every rule to its printings changes nothing (the data is current)", () => {
    const stale: string[] = [];
    let applied = 0;
    for (const card of catalog) {
      for (const rule of patch.RULES.filter(r => r.name === card.name && r.when.test(printedText(card)))) {
        applied += 1;
        const copy = structuredClone(card);
        rule.apply(copy);
        if (JSON.stringify(copy) !== JSON.stringify(card)) stale.push(`${card.name} (${card.set}) ${card.id}`);
      }
    }
    assert.ok(applied >= 50, `rules matched ${applied} printings`);
    assert.deepEqual(stale, [], "re-run: node scripts/patch-cards.cjs data/card-audit/other-reveals.patch.cjs");
  });

  test("a printing whose text lacks the sentence is left alone (Cheats McGuillicutty 1st Edition Part 2)", () => {
    const cheats = catalog.filter(card => card.name === "Cheats McGuillicutty");
    const reveals = (card: CatalogCard) => JSON.stringify(card.behavior).includes('"type":"reveal"');
    assert.equal(reveals(cheats.find(c => c.set === "2nd Edition")!), true);
    assert.equal(reveals(cheats.find(c => c.set === "1st Edition Part 2")!), false);
  });

  const expectations: [name: string, mechanism: string, copies: number][] = [
    ["Jackmove", '"type":"reveal","of":"opponent","zone":"deckTop"', 3],
    ["Eccentric Inquisition", '"type":"reveal","of":"opponent","zone":"deckTop","count":7', 2],
    ["Rosy Palmer, and Her Five Friends", '"type":"reveal","of":"opponent","zone":"deckTop","count":5', 2],
    ["Meager Research", '"type":"reveal","of":"opponent","zone":"deckTop","count":1', 2],
    ["Intellectual Reliquary", '"type":"revealCards","selected":"__s"', 3], // Seed, Seed Saga, Decade of Deckadence
    ["Gilda, Mother of Gideon", '"type":"revealCards","selected":"tac"', 1],
    ["Auspicious Arrival", '"type":"revealCards","selected":"pick"', 1],
    ["Discommodiousness", '"type":"reveal","of":"opponent","zone":"hand"', 2],
    ["Spatchcocking", '"type":"reveal","of":"opponent","zone":"hand"', 1],
    ["Roulette Wheel of DOOM!", '"type":"reveal","of":"controller","zone":"deckTop"', 2],
    ["Dauntless Gambler", '"type":"reveal","of":"controller","zone":"deckTop"', 2],
    ["Auction House", '"type":"auctionForCard"', 2],
    ["Mustache Aficionado", '"type":"partitionAndPick"', 2]
  ];
  for (const [name, mechanism, copies] of expectations) {
    test(`${name}: every printing reveals`, () => {
      const printings = catalog.filter(card => card.name === name);
      assert.equal(printings.length, copies);
      for (const card of printings) assert.ok(behaviorJson(card).includes(mechanism), `${card.set} ${card.id}`);
    });
  }
});
