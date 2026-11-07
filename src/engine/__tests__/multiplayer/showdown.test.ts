// Showdown (docs/rules/showdown-rules.md; docs/MULTIPLAYER-PLAN.md Phase 4).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  createFactionGame,
  getLoyalty,
  opponentsOf,
  redactStateFor,
  type CardDefinition,
  type SpoilsEngine
} from "../../../engine.js";
import { character, defaultFactionDefinition, factionCard, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

const RAGE = resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } });
const FILLER = character({ name: "Filler", life: 2 });

/** A Villain faction scaled by opponents, with DARING GAMBIT (SD-EA 2, 3, 10). */
const VILLAIN_FACTION = factionCard({
  name: "Villains",
  faction: {
    ...defaultFactionDefinition({
      startingInfluence: 15,
      setup: { startingResources: { count: 1, stapleOnly: true }, openingHand: { goingFirst: 0, goingSecond: 0 } }
    }),
    influencePerOpponent: 10,
    showdownRole: "villain",
    setup: {
      startingResources: { count: 1, countPerOpponent: 1, stapleOnly: true },
      openingHand: { goingFirst: 0, goingSecond: 0 }
    },
    daringGambit: { damage: 7 }
  }
});

const HERO_FACTION = factionCard({
  name: "Heroes",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } }
  })
});

/** Every Hero may use its abilities (SD-SLE 1): claim the top Hero card; send the top Hero card to the Temptation Pile; claim one card in the pile. */
const SHARED_FACTION = factionCard({
  name: "Shared",
  faction: {
    ...defaultFactionDefinition(),
    showdownRole: "heroes",
    abilities: [
      {
        id: "spring",
        type: "activated",
        usableBy: "heroes",
        costs: [],
        effects: [{ type: "claimHeroCards", claimer: "controller", from: "heroDeckTop" }]
      },
      { id: "tempt", type: "activated", usableBy: "heroes", costs: [], effects: [{ type: "heroDeckToTemptationPile" }] },
      {
        id: "take",
        type: "activated",
        usableBy: "heroes",
        costs: [],
        targets: [{ id: "t", selector: { zone: "table", showdownPile: "temptationPile" }, count: 1 }],
        effects: [{ type: "claimHeroCards", claimer: "controller", from: "selected", selected: "t" }]
      },
      { id: "reveal", type: "activated", usableBy: "heroes", costs: [], effects: [{ type: "revealAllegiances" }] }
    ]
  }
});

const HERO_CHAMPION = character({ name: "Champion", strength: 4, life: 4 });
/** "Destroy a location." — with no location in play it cannot be played. */
const NEEDS_TARGET = tactic({
  name: "Wrecker",
  behavior: {
    abilities: [
      {
        id: "wreck",
        type: "activated",
        costs: [],
        targets: [{ id: "l", selector: { type: "location" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "l" } }]
      }
    ]
  }
});
const HERO_TRICK = tactic({ name: "Trick", behavior: { abilities: [{ id: "trick", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

/** "Deal 7 damage to another Hero's faction." */
const BRUTE: CardDefinition = character({
  name: "Brute",
  behavior: {
    abilities: [
      {
        id: "smash",
        type: "activated",
        costs: [],
        targets: [{ id: "f", selector: { type: "faction", controller: "otherHero" }, count: 1 }],
        effects: [{ type: "dealDamage", target: { type: "selected", id: "f" }, amount: 7 }]
      }
    ]
  }
});

const DEFS = [RAGE, FILLER, VILLAIN_FACTION, HERO_FACTION, SHARED_FACTION, HERO_CHAMPION, HERO_TRICK, NEEDS_TARGET, BRUTE];

function deck(...extra: string[]) {
  return [RAGE.id, RAGE.id, RAGE.id, RAGE.id, ...extra, ...Array.from({ length: 10 }, () => FILLER.id)];
}

function showdownGame(options: { heroDeck?: string[]; allegiance?: Array<"heroes" | "villain"> } = {}): SpoilsEngine {
  const engine = createFactionGame(
    DEFS,
    [
      { id: "v", name: "Villain", factionDefinitionId: VILLAIN_FACTION.id, deckDefinitionIds: deck() },
      { id: "h1", name: "Hero 1", factionDefinitionId: HERO_FACTION.id, deckDefinitionIds: deck(BRUTE.id) },
      { id: "h2", name: "Hero 2", factionDefinitionId: HERO_FACTION.id, deckDefinitionIds: deck() }
    ],
    {
      firstPlayerId: "h1",
      seed: 5,
      format: {
        kind: "showdown",
        villainId: "v",
        ...(options.allegiance ? { allegiance: { cards: options.allegiance } } : {})
      },
      showdown: { heroDeck: options.heroDeck ?? [HERO_CHAMPION.id], sharedFactionDefinitionId: SHARED_FACTION.id }
    }
  );
  settleTurnStart(engine);
  return engine;
}

function shared(engine: SpoilsEngine): string {
  return engine.state.showdown!.sharedFactionId!;
}

function use(engine: SpoilsEngine, playerId: string, abilityId: string, selected?: Record<string, string[]>) {
  engine.perform({ type: "activateAbility", playerId, cardId: shared(engine), abilityId, ...(selected ? { selected } : {}) });
  resolvePendingResponses(engine);
}

describe("Showdown setup", () => {
  test("Allegiance cards go to the Heroes only, face-down (SD 6)", () => {
    const engine = showdownGame();
    assert.deepEqual(Object.keys(engine.state.showdown!.allegiance).sort(), ["h1", "h2"]);
    assert.ok(Object.values(engine.state.showdown!.allegiance).every(card => !card.faceUp));
  });

  test("the Villain's influence and starting resources scale with the opponents at the start (SD-EA 2, 3)", () => {
    const engine = showdownGame();
    assert.equal(engine.state.players.v.influence, 35);
    assert.equal(engine.state.players.h1.influence, 20);
    const villainResources = engine.state.players.v.play.filter(id => engine.getDefinition(id).type === "resource");
    assert.equal(villainResources.length, 3);
  });

  test("the Hero Deck waits on the table and the shared faction is in play", () => {
    const engine = showdownGame();
    const [top] = engine.state.showdown!.heroDeck;
    assert.equal(engine.state.cards[top].zone, "table");
    assert.equal(engine.state.cards[top].heroCard, true);
    assert.equal(engine.state.cards[shared(engine)].zone, "play");
  });
});

describe("Showdown opponents (SD 13–15)", () => {
  test("the Villain opposes every Hero; a Hero opposes the Villain", () => {
    const engine = showdownGame();
    assert.deepEqual(opponentsOf(engine.state, "v"), ["h1", "h2"]);
    assert.deepEqual(opponentsOf(engine.state, "h1"), ["v"]);
  });

  test("a revealed traitor opposes the other Heroes instead", () => {
    const engine = showdownGame({ allegiance: ["villain", "villain"] });
    use(engine, "h1", "reveal");
    assert.equal(getLoyalty(engine.state, "h1"), "villain");
    assert.deepEqual(opponentsOf(engine.state, "h1"), ["h2"]);
  });

  test("the Villain sees every Allegiance card; a Hero only their own until revealed (SD 7)", () => {
    const engine = showdownGame();
    const forH1 = redactStateFor(engine.state, "h1").showdown!.allegiance;
    assert.notEqual(forH1.h1.loyalty, "hidden");
    assert.equal(forH1.h2.loyalty, "hidden");
    const forV = redactStateFor(engine.state, "v").showdown!.allegiance;
    assert.notEqual(forV.h2.loyalty, "hidden");
  });
});

describe("Hero cards (SD 8–11, SD-SLE 1)", () => {
  test("only a Hero can use the shared faction's abilities", () => {
    const engine = showdownGame();
    assert.throws(
      () => engine.perform({ type: "activateAbility", playerId: "v", cardId: shared(engine), abilityId: "spring" }),
      /Only a Hero/
    );
  });

  test("a claimed character enters play under the claimer, who owns it; leaving play removes it from the game", () => {
    const engine = showdownGame();
    const [top] = engine.state.showdown!.heroDeck;
    use(engine, "h1", "spring");
    const card = engine.state.cards[top];
    assert.equal(card.zone, "play");
    assert.equal(card.controllerId, "h1");
    assert.equal(card.ownerId, "h1");
    assert.deepEqual(engine.state.showdown!.heroDeck, []);
    (engine as unknown as { moveCard(id: string, to: string): void }).moveCard(top, "discard");
    assert.equal(engine.state.cards[top].zone, "removed");
  });

  test("a claimed tactic that can be played must be played for free; once resolved it is removed from the game", () => {
    const engine = showdownGame({ heroDeck: [HERO_TRICK.id] });
    const [top] = engine.state.showdown!.heroDeck;
    use(engine, "h1", "spring");
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "deployForFree");
    assert.throws(
      () => engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree" } }),
      /must be played/
    );
    engine.perform({ type: "resolvePendingChoice", playerId: "h1", choice: { kind: "deployForFree", cardId: top } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[top].zone, "removed");
  });

  test("a claimed tactic that cannot be played is removed from the game at once (SD 10)", () => {
    const engine = showdownGame({ heroDeck: [NEEDS_TARGET.id] });
    const [top] = engine.state.showdown!.heroDeck;
    use(engine, "h1", "spring");
    assert.notEqual(engine.state.pendingChoice?.kind, "deployForFree");
    assert.equal(engine.state.cards[top].zone, "removed");
  });

  test("Hero cards go to the face-up Temptation Pile and can be claimed from it", () => {
    const engine = showdownGame();
    const [top] = engine.state.showdown!.heroDeck;
    use(engine, "h1", "tempt");
    assert.deepEqual(engine.state.showdown!.temptationPile, [top]);
    use(engine, "h1", "take", { t: [top] });
    assert.equal(engine.state.cards[top].zone, "play");
    assert.deepEqual(engine.state.showdown!.temptationPile, []);
  });

  test("DARING GAMBIT: 7 damage from one Hero to another claims the entire Temptation Pile (SD-EA 10)", () => {
    const engine = showdownGame({ heroDeck: [HERO_CHAMPION.id, HERO_CHAMPION.id] });
    use(engine, "h1", "tempt");
    use(engine, "h1", "tempt");
    const pile = [...engine.state.showdown!.temptationPile];
    assert.equal(pile.length, 2);
    // A Brute in play for h1, attacking h2's faction for 7.
    const brute = Object.values(engine.state.cards).find(c => c.ownerId === "h1" && engine.getDefinition(c.id).name === "Brute")!;
    (engine as unknown as { putCardIntoPlay(id: string, controller: string, faceDown: boolean, ctx: unknown): void }).putCardIntoPlay(
      brute.id,
      "h1",
      false,
      { sourceId: brute.id, controllerId: "h1", selected: {} }
    );
    resolvePendingResponses(engine);
    const h2Faction = engine.state.players.h2.factionId!;
    engine.perform({ type: "activateAbility", playerId: "h1", cardId: brute.id, abilityId: "smash", selected: { f: [h2Faction] } });
    resolvePendingResponses(engine);
    assert.deepEqual(engine.state.showdown!.temptationPile, []);
    for (const id of pile) assert.equal(engine.state.cards[id].controllerId, "h1");
  });
});
