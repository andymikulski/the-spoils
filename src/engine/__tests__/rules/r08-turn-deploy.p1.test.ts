// Batch r08-turn-deploy, part 1 (docs/TESTING.md): CR 601 Starting a Game.
// Written from the wording of the Comprehensive Rules, not from the engine.
//
// Setup tests drive `createFactionGame` (the faction card carries the Starting Resources,
// Starting Draw and mulligan entries).

import { describe } from "node:test";
import assert from "node:assert/strict";
import { createFactionGame } from "../../../engine.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { character, defaultFactionDefinition, factionCard, P1, P2, resourceCard } from "../support/fixtures.js";
import { refused, rule, ruleOpen } from "./_rule.js";
import { influence, other, zoneOf } from "./r08-turn-deploy.shared.js";
import { chooseDevelopOption, orderUntilDevelopPrompt, settleTurnStart } from "../support/develop.js";

// ---------------------------------------------------------------------------
// Setup fixtures (CR 601)
// ---------------------------------------------------------------------------

const RAGE = resourceCard({ id: "r08-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
const GREED = resourceCard({ id: "r08-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });
const ODDITY = resourceCard({ id: "r08-oddity", name: "Oddity", resource: { provides: ["elitism"] } });
const FILL = character({ id: "r08-fill", name: "Filler" });

interface FactionOptions {
  influence?: number;
  count?: number;
  names?: string[];
  stapleOnly?: boolean;
  first?: number;
  second?: number;
  mulligan?: boolean;
}

function faction(id: string, options: FactionOptions = {}): CardDefinition {
  return factionCard({
    id,
    name: id,
    faction: defaultFactionDefinition({
      startingInfluence: options.influence ?? 10,
      setup: {
        startingResources: {
          count: options.count ?? 2,
          ...(options.names ? { names: options.names } : {}),
          ...(options.stapleOnly === false ? {} : { stapleOnly: true })
        },
        openingHand: { goingFirst: options.first ?? 3, goingSecond: options.second ?? 4 },
        ...(options.mulligan === false ? {} : { mulligan: { count: 1, mode: "replaceAny" as const } })
      }
    })
  });
}

const FACTION = faction("r08-faction");

/** `rage` Rage cards, `greed` Greed cards, then filler up to `size` cards. */
function deckOf(rage: number, greed: number, size = 16): string[] {
  const staples = [
    ...Array.from({ length: rage }, () => RAGE.id),
    ...Array.from({ length: greed }, () => GREED.id)
  ];
  return [...staples, ...Array.from({ length: Math.max(0, size - staples.length) }, () => FILL.id)];
}

interface SetupOptions {
  a?: CardDefinition;
  b?: CardDefinition;
  deckA?: string[];
  deckB?: string[];
  first?: PlayerId;
  seed?: number;
}

function newGame(options: SetupOptions = {}): SpoilsEngine {
  const a = options.a ?? FACTION;
  const b = options.b ?? FACTION;
  const defs = [...new Map([a, b, RAGE, GREED, ODDITY, FILL].map((def) => [def.id, def])).values()];
  return createFactionGame(
    defs,
    [{ id: P1, name: "Alice", factionDefinitionId: a.id, deckDefinitionIds: options.deckA ?? deckOf(3, 0) },
    { id: P2, name: "Bob", factionDefinitionId: b.id, deckDefinitionIds: options.deckB ?? deckOf(3, 0) }],
    { firstPlayerId: options.first ?? P1, seed: options.seed ?? 11 }
  );
}

/** A game whose setup runs the CR 601.1c random draw and decision itself (no `firstPlayerId` unless `first` is set). */
function decidingGame(options: SetupOptions & { chooseStartingResources?: boolean } = {}): SpoilsEngine {
  const a = options.a ?? FACTION;
  const b = options.b ?? FACTION;
  const defs = [...new Map([a, b, RAGE, GREED, ODDITY, FILL].map((def) => [def.id, def])).values()];
  return createFactionGame(
    defs,
    [{ id: P1, name: "Alice", factionDefinitionId: a.id, deckDefinitionIds: options.deckA ?? deckOf(3, 0) },
    { id: P2, name: "Bob", factionDefinitionId: b.id, deckDefinitionIds: options.deckB ?? deckOf(3, 0) }],
    {
      chooseFirstPlayer: true,
      seed: options.seed ?? 11,
      ...(options.first ? { firstPlayerId: options.first } : {}),
      ...(options.chooseStartingResources ? { chooseStartingResources: true } : {})
    }
  );
}

const nameOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getDefinition(cardId).name;
const resourcesInPlay = (engine: SpoilsEngine, player: PlayerId) =>
  engine.state.players[player].play.filter((cardId) => engine.getDefinition(cardId).type === "resource");

/** Both players decline the mulligan; the game begins. */
function keepBoth(engine: SpoilsEngine, first: PlayerId = P1): void {
  engine.perform({ type: "mulligan", playerId: first, cardIds: [] });
  engine.perform({ type: "mulligan", playerId: other(first), cardIds: [] });
}

// ===========================================================================
// CR 601 — starting a game
// ===========================================================================

describe("CR 601.1 — the order of the opening steps", () => {
  rule("CR 601.1", "setup puts the factions and starting resources in play, deals the opening hands, then offers mulligans, and only then does turn 1 begin", () => {
    const engine = newGame();
    assert.equal(engine.state.players[P1].play.includes(engine.state.players[P1].factionId!), true, "faction in play");
    assert.equal(resourcesInPlay(engine, P1).length, 2, "starting resources in play");
    assert.equal(engine.state.players[P1].hand.length, 3, "opening hand dealt");
    assert.equal(engine.state.setup.phase, "mulligan", "the mulligan step comes next");
    assert.equal(engine.state.started, false, "turn 1 has not begun");
    keepBoth(engine);
    assert.equal(engine.state.setup.phase, "complete");
    assert.equal(engine.state.started, true, "turn 1 has begun");
  });

  rule("CR 601.1", "the opening hand is drawn after the starting resources left the deck: a starting resource is never also in the opening hand", () => {
    const engine = newGame({ deckA: deckOf(2, 0, 2), deckB: deckOf(2, 0, 2), a: faction("r08-all-draw", { first: 5, second: 5 }), b: faction("r08-all-draw-b", { first: 5, second: 5 }) });
    // A 2-card deck: both cards became starting resources, so nothing is left to draw.
    assert.equal(resourcesInPlay(engine, P1).length, 2);
    assert.equal(engine.state.players[P1].hand.length, 0, "the deck is empty after the starting resources, so the hand is empty");
    assert.equal(engine.state.players[P1].deck.length, 0);
  });
});

describe("CR 601.1a — factions start in play", () => {
  rule("CR 601.1a", "each faction card starts the game in play, and it is not in the deck or hand", () => {
    const engine = newGame();
    for (const player of [P1, P2]) {
      const factionId = engine.state.players[player].factionId!;
      assert.equal(zoneOf(engine, factionId), "play", `${player}'s faction is in play`);
      assert.equal(engine.getDefinition(factionId).type, "faction");
      assert.ok(!engine.state.players[player].deck.includes(factionId), `${player}'s faction is not in the deck`);
      assert.ok(!engine.state.players[player].hand.includes(factionId), `${player}'s faction is not in the hand`);
    }
  });

  rule("CR 601.1a", "a faction card listed inside the deck list still starts in play, not in the deck", () => {
    const defs = [FACTION, RAGE, FILL];
    const engine = createFactionGame(
      defs,
      [{ id: P1, name: "Alice", deckDefinitionIds: [FACTION.id, ...deckOf(3, 0, 12)] },
      { id: P2, name: "Bob", deckDefinitionIds: [FACTION.id, ...deckOf(3, 0, 12)] }],
      { firstPlayerId: P1, seed: 3 }
    );
    const factionId = engine.state.players[P1].factionId!;
    assert.equal(zoneOf(engine, factionId), "play");
    const total = engine.state.players[P1].deck.length + engine.state.players[P1].hand.length + resourcesInPlay(engine, P1).length;
    assert.equal(total, 12, "the other 12 cards are the deck, hand and starting resources; the faction is none of them");
  });

  rule("CR 601.1a", "each faction's starting influence is its own printed number", () => {
    const engine = newGame({ a: faction("r08-f25", { influence: 25 }), b: faction("r08-f17", { influence: 17 }) });
    assert.equal(influence(engine, P1), 25);
    assert.equal(influence(engine, P2), 17);
  });

  rule("CR 601.1a", "a different printed starting influence is honoured for the other seat too", () => {
    const engine = newGame({ a: faction("r08-f9", { influence: 9 }), b: faction("r08-f31", { influence: 31 }) });
    assert.equal(influence(engine, P1), 9);
    assert.equal(influence(engine, P2), 31);
  });
});

describe("CR 601.1b / 601.1d — starting resources", () => {
  rule("CR 601.1b", "each player's deck is searched for the number of resources their faction lists, and they are put into play", () => {
    const engine = newGame({ a: faction("r08-two", { count: 2 }), b: faction("r08-three", { count: 3 }), deckA: deckOf(4, 0), deckB: deckOf(4, 0) });
    assert.equal(resourcesInPlay(engine, P1).length, 2, "Alice's faction lists 2");
    assert.equal(resourcesInPlay(engine, P2).length, 3, "Bob's faction lists 3");
    for (const cardId of resourcesInPlay(engine, P1)) assert.equal(engine.state.cards[cardId].ownerId, P1);
    assert.equal(engine.state.players[P1].deck.length + engine.state.players[P1].hand.length, 16 - 2, "the resources came out of the deck");
  });

  rule("CR 601.1b", "a faction that lists no starting resources puts none into play", () => {
    const engine = newGame({ a: faction("r08-none", { count: 0 }) });
    assert.equal(resourcesInPlay(engine, P1).length, 0);
    assert.equal(resourcesInPlay(engine, P2).length, 2, "control: the other faction still gets its two");
  });

  rule("CR 601.1b", "only the resources the entry names are put into play: a faction that names Rage takes Rage, never the Greed ahead of it in the deck", () => {
    const rageOnly = faction("r08-rage-only", { count: 2, names: ["Rage"] });
    const deck = [GREED.id, GREED.id, RAGE.id, ODDITY.id, RAGE.id, ...deckOf(0, 0, 11)];
    const engine = newGame({ a: rageOnly, deckA: deck });
    assert.deepEqual(resourcesInPlay(engine, P1).map((cardId) => nameOf(engine, cardId)), ["Rage", "Rage"]);
  });

  rule("CR 601.1b", "a staple-only entry skips resources that are not staples", () => {
    const deck = [ODDITY.id, ODDITY.id, RAGE.id, GREED.id, ...deckOf(0, 0, 12)];
    const engine = newGame({ deckA: deck });
    const names = resourcesInPlay(engine, P1).map((cardId) => nameOf(engine, cardId)).sort();
    assert.deepEqual(names, ["Greed", "Rage"], "the two staples, not the two Oddity resources first in the deck");
  });

  rule("CR 601.1b", "an entry that is not staple-only may take a non-staple resource", () => {
    const anyResource = faction("r08-any-resource", { count: 1, stapleOnly: false });
    const engine = newGame({ a: anyResource, deckA: [ODDITY.id, ...deckOf(2, 0, 15)] });
    assert.deepEqual(resourcesInPlay(engine, P1).map((cardId) => nameOf(engine, cardId)), ["Oddity"]);
  });

  rule(["CR 601.1b", "CR 601.1d"], "after the starting resources are flipped face-up they are face-up, and provide their own icon rather than Volition", () => {
    const engine = newGame({ deckA: deckOf(2, 0), b: faction("r08-greed-f", { count: 2 }), deckB: deckOf(0, 2) });
    for (const cardId of resourcesInPlay(engine, P1)) assert.equal(engine.state.cards[cardId].faceDown, false, "face-up");
    assert.equal(engine.getThresholds(P1).rage, 2, "two Rage icons");
    assert.equal(engine.getThresholds(P1).volition ?? 0, 0, "no Volition: face-down cards provide Volition, these are face-up");
    assert.equal(engine.getThresholds(P2).greed, 2);
  });

  rule("CR 601.1d", "every player's starting resources are flipped, the second player's included", () => {
    const engine = newGame();
    for (const player of [P1, P2]) {
      const resources = resourcesInPlay(engine, player);
      assert.equal(resources.length, 2);
      for (const cardId of resources) assert.equal(engine.state.cards[cardId].faceDown, false, `${player}'s starting resource is face-up`);
    }
  });
});

describe("CR 601.1c — who goes first", () => {
  rule("CR 601.1c", "the player who is chosen to go first takes the first turn (seat 1)", () => {
    const engine = newGame({ first: P1 });
    keepBoth(engine, P1);
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(engine.state.turn, 1);
  });

  rule("CR 601.1c", "the chosen first player may be either seat: choosing the other player makes them take the first turn", () => {
    const engine = newGame({ first: P2 });
    keepBoth(engine, P2);
    assert.equal(engine.state.activePlayerId, P2);
    assert.equal(engine.state.turn, 1);
    assert.equal(engine.state.priorityPlayerId, P2);
  });

  rule("CR 601.1c", "the first-turn choice is exactly one of the two players: an unknown player cannot be chosen to go first", () => {
    assert.throws(
      () =>
        createFactionGame(
          [FACTION, RAGE, FILL],
          [{ id: P1, name: "Alice", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(3, 0) },
          { id: P2, name: "Bob", factionDefinitionId: FACTION.id, deckDefinitionIds: deckOf(3, 0) }],
          { firstPlayerId: "p3" }
        ),
      /firstPlayerId/
    );
  });

  // Ruling RQ-r08-turn-deploy-1: the engine runs the random draw and the decision (setup option `chooseFirstPlayer`).
  rule("CR 601.1c", "who decides is determined at random: across many seeds either player is picked to decide", () => {
    const deciders = new Set<PlayerId>();
    for (let seed = 1; seed <= 40; seed++) deciders.add(decidingGame({ seed }).getFirstPlayerChoice()!.deciderId);
    assert.equal(deciders.size, 2, "both players are picked to decide under some seed");
  });

  rule("CR 601.1c", "the random draw is the seeded game's own: the same seed picks the same decider", () => {
    for (let seed = 1; seed <= 10; seed++) {
      assert.equal(decidingGame({ seed }).getFirstPlayerChoice()!.deciderId, decidingGame({ seed }).getFirstPlayerChoice()!.deciderId);
    }
  });

  rule("CR 601.1c", "the deciding player may choose to go first: they take the first turn", () => {
    const engine = decidingGame();
    const decider = engine.getFirstPlayerChoice()!.deciderId;
    engine.perform({ type: "chooseFirstPlayer", playerId: decider, firstPlayerId: decider });
    keepBoth(engine, decider);
    assert.equal(engine.state.activePlayerId, decider);
    assert.equal(engine.state.turn, 1);
  });

  rule("CR 601.1c", "the deciding player may choose their opponent to go first: the opponent takes the first turn", () => {
    const engine = decidingGame();
    const decider = engine.getFirstPlayerChoice()!.deciderId;
    engine.perform({ type: "chooseFirstPlayer", playerId: decider, firstPlayerId: other(decider) });
    keepBoth(engine, other(decider));
    assert.equal(engine.state.activePlayerId, other(decider));
    assert.equal(engine.state.priorityPlayerId, other(decider));
  });

  rule("CR 601.1c", "only the deciding player chooses: the other player's answer is refused", () => {
    const engine = decidingGame();
    const decider = engine.getFirstPlayerChoice()!.deciderId;
    refused(() => engine.perform({ type: "chooseFirstPlayer", playerId: other(decider), firstPlayerId: other(decider) }), "the other player cannot decide");
    assert.equal(engine.state.setup.phase, "chooseFirstPlayer");
  });

  rule("CR 601.1c", "the choice names one of the two players", () => {
    const engine = decidingGame();
    const decider = engine.getFirstPlayerChoice()!.deciderId;
    refused(() => engine.perform({ type: "chooseFirstPlayer", playerId: decider, firstPlayerId: "p3" }), "an unknown player cannot go first", /p3/);
  });

  rule(["CR 601.1", "CR 601.1c"], "the decision comes after the starting resources are in play and before any opening hand is drawn", () => {
    const engine = decidingGame();
    assert.equal(engine.state.setup.phase, "chooseFirstPlayer");
    assert.equal(engine.getFlowView().mode, "setup");
    for (const player of [P1, P2]) {
      assert.equal(resourcesInPlay(engine, player).length, 2, `${player}'s starting resources are in play`);
      assert.equal(engine.state.players[player].hand.length, 0, `${player} has not drawn yet`);
    }
    refused(() => engine.perform({ type: "mulligan", playerId: P1, cardIds: [] }), "no mulligan before who goes first is decided");
  });

  rule(["CR 601.1c", "CR 601.1e"], "the opening draws follow the choice: the player chosen to go first draws the going-first number", () => {
    const engine = decidingGame({ a: faction("r08-ten-nine", { first: 10, second: 9 }) });
    const choice = engine.getFirstPlayerChoice()!;
    assert.deepEqual(choice.openingDraw[P1], { [P1]: 10, [P2]: 4 }, "Alice first: 10 for her, 4 for Bob");
    assert.deepEqual(choice.openingDraw[P2], { [P1]: 9, [P2]: 3 }, "Bob first: 9 for Alice, 3 for him");
    engine.perform({ type: "chooseFirstPlayer", playerId: choice.deciderId, firstPlayerId: P2 });
    assert.equal(engine.state.players[P1].hand.length, 9);
    assert.equal(engine.state.players[P2].hand.length, 3);
  });

  rule("CR 601.1c", "the random pick of the decider is not a coin flip a card can see", () => {
    const engine = decidingGame();
    assert.ok(!engine.getLog().some((entry) => entry.event?.type === "coinFlipped"), "no coinFlipped event");
    assert.ok(engine.getLog().some((entry) => entry.event?.type === "firstPlayerDecider"), "the setup draw is logged as its own event");
  });

  rule("CR 601.1c", "a first player already given by the host skips the random draw and the decision", () => {
    const engine = decidingGame({ first: P2 });
    assert.equal(engine.state.setup.phase, "mulligan");
    assert.equal(engine.getFirstPlayerChoice(), null);
    assert.equal(engine.state.activePlayerId, P2);
  });

  rule(["CR 601.1b", "CR 601.1c"], "with a starting-resource choice, the decision waits until both players have chosen their starting resources", () => {
    const engine = decidingGame({ deckA: deckOf(2, 2), chooseStartingResources: true });
    assert.equal(engine.state.setup.phase, "chooseStartingResources");
    const choice = engine.getStartingResourceChoice(P1)!;
    engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: choice.candidateCardIds.slice(0, 2) });
    assert.equal(engine.state.setup.phase, "chooseFirstPlayer");
    assert.equal(resourcesInPlay(engine, P1).length, 2);
  });
});

describe("CR 601.1e — opening hands", () => {
  rule("CR 601.1e", "the first player draws the faction's Starting Draw for going first, the second player the number for going second", () => {
    const engine = newGame({ first: P1 });
    assert.equal(engine.state.players[P1].hand.length, 3, "going first: 3");
    assert.equal(engine.state.players[P2].hand.length, 4, "going second: 4");
  });

  rule("CR 601.1e", "which number a player draws follows who goes first, not the seat", () => {
    const engine = newGame({ first: P2 });
    assert.equal(engine.state.players[P2].hand.length, 3, "Bob goes first: 3");
    assert.equal(engine.state.players[P1].hand.length, 4, "Alice goes second: 4");
  });

  rule("CR 601.1e", "each player draws according to their own faction's entry", () => {
    const engine = newGame({ a: faction("r08-small", { first: 2, second: 6 }), b: faction("r08-big", { first: 8, second: 9 }), first: P1 });
    assert.equal(engine.state.players[P1].hand.length, 2, "Alice's faction, going first");
    assert.equal(engine.state.players[P2].hand.length, 9, "Bob's faction, going second");
  });

  rule("CR 601.1e", "a Starting Draw of 0 draws no cards", () => {
    const engine = newGame({ a: faction("r08-zero", { first: 0, second: 0 }), first: P1 });
    assert.equal(engine.state.players[P1].hand.length, 0);
    assert.equal(engine.state.players[P2].hand.length, 4, "control: the other faction still draws");
  });

  rule("CR 601.1e", "the cards drawn leave the player's own deck", () => {
    const engine = newGame({ first: P1 });
    assert.equal(engine.state.players[P1].deck.length, 16 - 2 - 3, "16 cards, 2 starting resources, 3 drawn");
    assert.equal(engine.state.players[P2].deck.length, 16 - 2 - 4, "16 cards, 2 starting resources, 4 drawn");
    for (const cardId of engine.state.players[P1].hand) {
      assert.equal(engine.state.cards[cardId].ownerId, P1);
      assert.equal(engine.state.cards[cardId].zone, "hand");
    }
  });
});

describe("CR 601.1f / 601.1g — the mulligan", () => {
  rule("CR 601.1f", "the first player may mulligan any cards: they go to the bottom of the deck in the order chosen and an equal number are drawn", () => {
    const engine = newGame();
    const hand = [...engine.state.players[P1].hand];
    const oldDeck = [...engine.state.players[P1].deck];
    const chosen = [hand[0], hand[2]];
    engine.perform({ type: "mulligan", playerId: P1, cardIds: chosen });
    const player = engine.state.players[P1];
    assert.equal(player.hand.length, 3, "an equal number of cards were drawn");
    assert.ok(!player.hand.includes(chosen[0]) && !player.hand.includes(chosen[1]), "the chosen cards left the hand");
    assert.deepEqual(player.deck, [...oldDeck.slice(2), ...chosen], "the chosen cards are at the bottom, in the order given");
    assert.ok(player.hand.includes(oldDeck[0]) && player.hand.includes(oldDeck[1]), "the replacements came from the top of the deck");
  });

  rule("CR 601.1f", "the bottom order is the player's choice: the same two cards can go down in either order", () => {
    for (const reversed of [false, true]) {
      const engine = newGame();
      const hand = engine.state.players[P1].hand;
      const chosen = reversed ? [hand[1], hand[0]] : [hand[0], hand[1]];
      engine.perform({ type: "mulligan", playerId: P1, cardIds: chosen });
      const deck = engine.state.players[P1].deck;
      assert.deepEqual(deck.slice(-2), chosen, `bottom of the deck follows the order given (reversed: ${reversed})`);
    }
  });

  rule("CR 601.1f", "mulliganing no cards is allowed: nothing moves and the decision is used up", () => {
    const engine = newGame();
    const hand = [...engine.state.players[P1].hand];
    const deck = [...engine.state.players[P1].deck];
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    assert.deepEqual(engine.state.players[P1].hand, hand);
    assert.deepEqual(engine.state.players[P1].deck, deck);
    refused(() => engine.perform({ type: "mulligan", playerId: P1, cardIds: [] }), "mulligan again after deciding", /mulligan decision/);
  });

  rule("CR 601.1f", "a player may mulligan their whole hand", () => {
    const engine = newGame();
    const hand = [...engine.state.players[P1].hand];
    const oldDeck = [...engine.state.players[P1].deck];
    engine.perform({ type: "mulligan", playerId: P1, cardIds: hand });
    const player = engine.state.players[P1];
    assert.equal(player.hand.length, hand.length, "the same number of cards in hand");
    assert.deepEqual([...player.hand].sort(), oldDeck.slice(0, hand.length).sort(), "the new hand is the old top of the deck");
    assert.deepEqual(player.deck.slice(-hand.length), hand, "the old hand is at the bottom");
  });

  rule("CR 601.1f", "the mulligan can be done only once: the same player cannot mulligan again, before or after the game begins", () => {
    const engine = newGame();
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [engine.state.players[P1].hand[0]] });
    refused(
      () => engine.perform({ type: "mulligan", playerId: P1, cardIds: [engine.state.players[P1].hand[0]] }),
      "second mulligan by the first player while the second player is still to decide",
      /mulligan decision/
    );
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });
    assert.equal(engine.state.started, true, "control: both players have decided, the game began");
    settleTurnStart(engine);
    refused(() => engine.perform({ type: "mulligan", playerId: P1, cardIds: [] }), "mulligan after the game began", /mulligan step is over/);
  });

  rule("CR 601.1f", "the mulligan cards must come from the player's own hand, each at most once", () => {
    const engine = newGame();
    const hand = engine.state.players[P1].hand;
    const foreign = engine.state.players[P2].hand[0];
    const deckCard = engine.state.players[P1].deck[0];
    refused(() => engine.perform({ type: "mulligan", playerId: P1, cardIds: [foreign] }), "the opponent's hand card", /must be in your hand/);
    refused(() => engine.perform({ type: "mulligan", playerId: P1, cardIds: [deckCard] }), "a card still in the deck", /must be in your hand/);
    refused(() => engine.perform({ type: "mulligan", playerId: P1, cardIds: [hand[0], hand[0]] }), "the same card twice", /twice/);
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [hand[0]] });
    assert.equal(engine.state.players[P1].hand.length, 3, "control: a legal mulligan works");
  });

  rule("CR 601.1f", "the first player is the one who goes first: when the second seat goes first, they mulligan first", () => {
    const engine = newGame({ first: P2 });
    refused(() => engine.perform({ type: "mulligan", playerId: P1, cardIds: [] }), "the player going second mulligans first", /mulligan decision/);
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    assert.equal(engine.state.started, true);
  });

  ruleOpen("CR 601.1f", "RQ-r08-turn-deploy-2", "every player may mulligan, whether or not their faction card lists a mulligan", () => {
    const noMulligan = faction("r08-no-mulligan", { mulligan: false });
    const engine = newGame({ a: noMulligan, b: noMulligan });
    assert.equal(engine.state.setup.phase, "mulligan", "the mulligan step happens");
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [engine.state.players[P1].hand[0]] });
    assert.equal(engine.state.players[P1].hand.length, 3);
  });

  rule("CR 601.1g", "each player follows the mulligan step in turn order: the player going second decides only after the first player", () => {
    const engine = newGame();
    refused(() => engine.perform({ type: "mulligan", playerId: P2, cardIds: [] }), "the second player mulligans before the first", /mulligan decision/);
    engine.perform({ type: "mulligan", playerId: P1, cardIds: [] });
    assert.equal(engine.state.started, false, "the game waits for the second player");
    const hand = [...engine.state.players[P2].hand];
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [hand[3]] });
    assert.equal(engine.state.players[P2].hand.length, 4, "the second player's mulligan draws an equal number");
    assert.ok(!engine.state.players[P2].hand.includes(hand[3]), "the mulliganed card left the hand");
    assert.equal(engine.state.started, true);
  });

  rule("CR 601.1g", "the second player's mulligan is done with the same steps: bottom of the deck in the chosen order, equal draw", () => {
    const engine = newGame();
    keepOne(engine);
    const hand = [...engine.state.players[P2].hand];
    const oldDeck = [...engine.state.players[P2].deck];
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [hand[1], hand[0]] });
    assert.deepEqual(engine.state.players[P2].deck, [...oldDeck.slice(2), hand[1], hand[0]]);
    assert.equal(engine.state.players[P2].hand.length, 4);
  });
});

/** The first player keeps; the second still has to decide. */
function keepOne(engine: SpoilsEngine, first: PlayerId = P1): void {
  engine.perform({ type: "mulligan", playerId: first, cardIds: [] });
}

describe("CR 601.1h — the first turn begins", () => {
  rule("CR 601.1h", "once the last mulligan is made the first turn begins: the game is started, it is turn 1, and the first player is active", () => {
    const engine = newGame();
    assert.equal(engine.state.started, false);
    keepOne(engine);
    assert.equal(engine.state.started, false, "not before the second player has decided");
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] });
    assert.equal(engine.state.started, true);
    assert.equal(engine.state.turn, 1);
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(engine.state.priorityPlayerId, P1);
  });

  rule("CR 601.1h", "no turn action can be taken before the first turn begins (control: it can once the mulligans are done)", () => {
    const engine = newGame({ first: P1 });
    refused(() => engine.perform({ type: "endTurn", playerId: P1 }), "ending the turn during the mulligan step", /mulligans must be completed/);
    keepBoth(engine);
    // The first turn has begun: its start-of-turn triggers (Restore, Develop) are waiting, and are answered as on any turn.
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.state.responseWindow?.kind, "endTurn", "control: the turn can be ended once the game has started");
  });

  rule("CR 601.1h", "the first turn is a turn like any other: the first player can use their faction's Develop Rule on it", () => {
    const engine = newGame();
    keepBoth(engine);
    // User ruling 2026-10-27: Restore and Develop are start-of-turn triggers of the faction card; on the first turn they
    // are put on the stack like on any other turn, and the first player decides their order.
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers", "the first turn's start-of-turn triggers are waiting to be ordered");
    if (pending?.kind !== "orderTriggers") throw new Error("unreachable");
    assert.equal(pending.playerId, P1, "the first player orders them");
    assert.deepEqual(pending.triggers.map(trigger => trigger.abilityId).sort(), ["developRule", "restoreRule"]);
    const offers = orderUntilDevelopPrompt(engine);
    assert.ok(offers.some(label => /^Draw /.test(label)), "the first player's Develop Rule is available");
    const handBefore = engine.state.players[P1].hand.length;
    chooseDevelopOption(engine, P1, /^Draw /);
    assert.equal(engine.state.players[P1].hand.length, handBefore + 1, "the Develop Rule drew a card");
    assert.equal(engine.state.players[P2].hand.length, 4, "the second player's board is untouched");
  });

  rule("CR 601.1h", "the second player's faction rules don't act on the first turn: only the player taking it can develop", () => {
    const engine = newGame({ first: P2 });
    keepBoth(engine, P2);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers", "the player taking the first turn has their start-of-turn triggers to order");
    if (pending?.kind !== "orderTriggers") throw new Error("unreachable");
    assert.equal(pending.playerId, P2, "the player taking the first turn orders them");
    assert.ok(
      pending.triggers.every(trigger => trigger.sourceId === engine.state.players[P2].factionId),
      "and they are all the first player's faction card's: the other faction has nothing on this turn"
    );
    assert.ok(orderUntilDevelopPrompt(engine).some(label => /^Draw /.test(label)), "the player taking the first turn can develop");
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } }),
      "the inactive player develops"
    );
  });
});
