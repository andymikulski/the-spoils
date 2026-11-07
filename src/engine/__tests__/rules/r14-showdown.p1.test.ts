// Batch r14-showdown, part 1 (docs/TESTING.md): the printed Showdown rules card, SD 1-SD 7
// (docs/rules/showdown-rules.md): roles, decks, factions and Allegiance cards.
// Written from the wording of the rules, not from the engine; docs/MULTIPLAYER-PLAN.md D2 (Allegiance placeholder)
// and D3 say how the engine fills the gaps. Synthetic fixtures only (r14-showdown.shared.ts).

import { describe } from "node:test";
import assert from "node:assert/strict";
import {
  canSeeAllegiance,
  createFactionGame,
  findDeckConstructionIssues,
  getLoyalty,
  heroesOf,
  isAllegianceRevealed,
  isHero,
  isVillain,
  redactStateFor,
  villainOf
} from "../../../engine.js";
import { character } from "../support/fixtures.js";
import { refused, rule, ruleExempt } from "./_rule.js";
import {
  CHAMPION,
  FILLER,
  RAGE,
  sharedFaction,
  evilFaction,
  giveResources,
  heroFaction,
  influenceOf,
  passTurn,
  resourcesOf,
  table,
  use,
  zoneOf
} from "./r14-showdown.shared.js";

describe("SD 1 - one Villain, every other player a Hero", () => {
  rule("SD 1", "with three seats one is the Villain and the other two are Heroes", () => {
    const { engine } = table({ heroes: 2 });
    assert.equal(villainOf(engine.state), "v");
    assert.deepEqual(heroesOf(engine.state), ["h1", "h2"]);
    assert.equal(isVillain(engine.state, "v"), true);
    assert.equal(isHero(engine.state, "v"), false, "the Villain is not a Hero");
    for (const id of ["h1", "h2"]) {
      assert.equal(isHero(engine.state, id), true, `${id} is a Hero`);
      assert.equal(isVillain(engine.state, id), false, `${id} is not the Villain`);
    }
  });

  rule("SD 1", "with five seats there is still exactly one Villain: every other player is a Hero", () => {
    const { engine } = table({ heroes: 4 });
    const seats = Object.keys(engine.state.players);
    assert.equal(seats.length, 5);
    assert.deepEqual(seats.filter(id => isVillain(engine.state, id)), ["v"]);
    assert.deepEqual(seats.filter(id => isHero(engine.state, id)).sort(), ["h1", "h2", "h3", "h4"]);
    assert.deepEqual(heroesOf(engine.state), ["h1", "h2", "h3", "h4"]);
  });

  rule("SD 1", "the Villain faces multiple Heroes: a Showdown needs the Villain seated plus at least two Heroes", () => {
    const evil = evilFaction();
    const hero = heroFaction();
    const seat = (id: string, faction = hero) => ({
      id,
      name: id,
      factionDefinitionId: faction.id,
      deckDefinitionIds: [RAGE.id, FILLER.id, FILLER.id, FILLER.id]
    });
    const shared = sharedFaction();
    const build = (seats: ReturnType<typeof seat>[], villainId = "v") =>
      createFactionGame([evil, hero, shared, CHAMPION, RAGE, FILLER], seats, {
        format: { kind: "showdown", villainId },
        showdown: { heroDeck: [CHAMPION.id], sharedFactionDefinitionId: shared.id },
        seed: 1,
        firstPlayerId: seats[0].id
      });
    refused(() => build([seat("v", evil), seat("h1")]), "a Villain with a single Hero is not a Showdown", /Showdown/);
    refused(() => build([seat("x", evil), seat("h1"), seat("h2")]), "the Villain must be one of the seated players", /not seated/);
    const three = build([seat("v", evil), seat("h1"), seat("h2")]);
    assert.equal(villainOf(three.state), "v", "control: one Villain and two Heroes is a table");
  });

  rule("SD 1", "the roles do not depend on seating order: the Villain may sit anywhere in the turn order", () => {
    const evil = evilFaction();
    const hero = heroFaction();
    const seat = (id: string, faction = hero) => ({ id, name: id, factionDefinitionId: faction.id, deckDefinitionIds: [RAGE.id, ...Array.from({ length: 20 }, () => FILLER.id)] });
    const shared = sharedFaction();
    const engine = createFactionGame(
      [evil, hero, shared, CHAMPION, RAGE, FILLER],
      [seat("h1"), seat("v", evil), seat("h2")],
      {
        format: { kind: "showdown", villainId: "v" },
        showdown: { heroDeck: [CHAMPION.id], sharedFactionDefinitionId: shared.id },
        seed: 1,
        firstPlayerId: "h1"
      }
    );
    assert.deepEqual(engine.state.turnOrder, ["h1", "v", "h2"]);
    assert.equal(villainOf(engine.state), "v");
    assert.deepEqual(heroesOf(engine.state), ["h1", "h2"]);
  });
});

describe("SD 2 - the Villain's faction and deck", () => {
  rule("SD 2", "the Villain's faction card is in play for the Villain and its rules govern them (influence 15 + 10 per opponent here)", () => {
    const { engine, defs } = table({ heroes: 2 });
    const faction = engine.state.players.v.factionId!;
    assert.equal(engine.state.cards[faction].definitionId, defs.villain.id);
    assert.equal(zoneOf(engine, faction), "play");
    assert.equal(influenceOf(engine, "v"), 35, "the Villain faction's own INFLUENCE rule applied");
    assert.equal(influenceOf(engine, "h1"), 20, "a Hero's faction rules are its own");
  });

  rule("SD 2", "the Villain Deck follows all normal Constructed deck rules: the 4-copy limit applies to it like any deck", () => {
    const evil = evilFaction();
    const villainous = character({ name: "Villainous" });
    const copies = (n: number) => Array.from({ length: n }, () => villainous);
    const kinds = (cards: Parameters<typeof findDeckConstructionIssues>[0]) =>
      findDeckConstructionIssues(cards, { minimumSize: false, factionRules: false }).map(issue => issue.kind);
    assert.deepEqual(kinds([evil, ...copies(4)]), [], "four copies are fine");
    assert.deepEqual(kinds([evil, ...copies(5)]), ["copyLimit"], "a fifth copy breaks the Constructed limit");
    assert.deepEqual(kinds([evil, evil, ...copies(1)]), ["factionCount"], "a deck still holds exactly one faction card");
  });

  rule("SD 2", "the Villain Deck follows the epic Constructed rules too: one copy of an epic card", () => {
    const evil = evilFaction();
    const epic = character({ name: "Epic Villain", rarity: "epic" });
    const options = { minimumSize: false, factionRules: false } as const;
    assert.deepEqual(findDeckConstructionIssues([evil, epic], options).map(issue => issue.kind), []);
    assert.deepEqual(findDeckConstructionIssues([evil, epic, epic], options).map(issue => issue.kind), ["epicCopyLimit"]);
  });

  ruleExempt(
    "SD 2",
    "the printed sentence 'designed with this style of game play in mind' is deck-design advice, not a rule the engine can check"
  );
});

describe("SD 3 - one shared Hero Deck, reached only through effects", () => {
  rule("SD 3", "there is a single Hero Deck however many Heroes play: exactly the cards given, each once, on the table", () => {
    const heroDeck = [CHAMPION, CHAMPION, character({ name: "Sidekick" })];
    const { engine } = table({ heroes: 3, heroDeck });
    const pile = engine.state.showdown!.heroDeck;
    assert.equal(pile.length, 3);
    assert.deepEqual(
      pile.map(id => engine.getDefinition(id).name).sort(),
      ["Champion", "Champion", "Sidekick"]
    );
    for (const id of pile) {
      assert.equal(zoneOf(engine, id), "table", "on the table");
      assert.equal(engine.state.cards[id].heroCard, true, "a Hero card");
    }
  });

  rule("SD 3", "the Hero Deck is nobody's deck: it is in none of the players' zones, and a Hero's draws never take from it", () => {
    const { engine } = table({ heroes: 2, heroDeck: [CHAMPION, CHAMPION] });
    const pile = [...engine.state.showdown!.heroDeck];
    const drawsBefore = engine.state.players.h1.hand.length;
    for (const player of Object.values(engine.state.players)) {
      for (const zone of [player.deck, player.hand, player.play, player.discard, player.void, player.removed]) {
        for (const id of pile) assert.ok(!zone.includes(id), `${id} is in ${player.id}'s zones`);
      }
    }
    // h1's Develop Rule drew at the turn start: that came from h1's own deck.
    assert.equal(drawsBefore, 1);
    assert.deepEqual(engine.state.showdown!.heroDeck, pile, "the draw left the Hero Deck alone");
  });

  rule("SD 3", "Heroes cannot play Hero Deck cards directly: they only get them through effects (a claim moves one out)", () => {
    const { engine, shared } = table({ heroes: 2, heroDeck: [CHAMPION] });
    const [top] = engine.state.showdown!.heroDeck;
    refused(
      () => engine.perform({ type: "playCard", playerId: "h1", cardId: top }),
      "a card on the Hero Deck is not in any hand"
    );
    assert.equal(zoneOf(engine, top), "table", "still in the Hero Deck");
    giveResources(engine, "h1", 6);
    use(engine, "h1", shared, "spring");
    assert.equal(zoneOf(engine, top), "play", "control: an effect (SPRING FORTH) does bring it into play");
    assert.equal(engine.state.cards[top].controllerId, "h1");
  });

  rule("SD 3", "the Hero Deck is face-down to every player: its cards are masked in each viewer's state", () => {
    const { engine } = table({ heroes: 2, heroDeck: [CHAMPION] });
    const [top] = engine.state.showdown!.heroDeck;
    for (const viewer of ["v", "h1", "h2", "spectator"] as const) {
      const seen = redactStateFor(engine.state, viewer).cards[top];
      assert.notEqual(seen.definitionId, CHAMPION.id, `${viewer} cannot see the top Hero card`);
    }
    assert.equal(engine.state.cards[top].definitionId, CHAMPION.id, "control: the real state knows it");
  });

  ruleExempt(
    "SD 3",
    "the card's sentence 'We recommend a Sword of Great Justice theme' (and the balance advice) is deck-design advice, not a rule"
  );
});

describe("SD 4 - each Hero picks their own faction", () => {
  const brave = heroFaction({
    startingInfluence: 20,
    setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 2, goingSecond: 3 } }
  });
  const bold = heroFaction({
    startingInfluence: 30,
    setup: { startingResources: { count: 2, names: ["Rage"] }, openingHand: { goingFirst: 4, goingSecond: 5 } }
  });

  rule("SD 4", "two Heroes can play two different factions, each with its own influence, starting resources and opening hand", () => {
    const { engine } = table({ heroes: 2, heroFactions: [brave, bold], unsettled: true });
    const factionOf = (id: string) => engine.state.cards[engine.state.players[id].factionId!].definitionId;
    assert.equal(factionOf("h1"), brave.id);
    assert.equal(factionOf("h2"), bold.id);
    assert.equal(influenceOf(engine, "h1"), 20);
    assert.equal(influenceOf(engine, "h2"), 30);
    assert.equal(resourcesOf(engine, "h1").length, 0);
    assert.equal(resourcesOf(engine, "h2").length, 2);
    assert.equal(engine.state.players.h1.hand.length, 2, "first seat: the faction's going-first hand");
    assert.equal(engine.state.players.h2.hand.length, 5,"later seat: the faction's going-second hand");
  });

  rule("SD 4", "Heroes may also share a faction: the choice is each Hero's own", () => {
    const { engine } = table({ heroes: 3, heroFactions: [brave], unsettled: true });
    const factionDefs = ["h1", "h2", "h3"].map(id => engine.state.cards[engine.state.players[id].factionId!].definitionId);
    assert.deepEqual(factionDefs, [brave.id, brave.id, brave.id]);
    for (const id of ["h1", "h2", "h3"]) assert.equal(influenceOf(engine, id), 20);
  });

  rule("SD 4", "the Villain's faction is not a Hero's choice: it does not change with the Heroes' factions", () => {
    const { engine, defs } = table({ heroes: 2, heroFactions: [brave, bold], unsettled: true });
    assert.equal(engine.state.cards[engine.state.players.v.factionId!].definitionId, defs.villain.id);
    assert.equal(influenceOf(engine, "v"), 35);
  });
});

describe("SD 5 - every Hero also has the Slightly Less Evil Alliance", () => {
  rule("SD 5", "a shared faction card sits on the table in addition to the Heroes' own factions, and every Hero may use it", () => {
    const { engine, shared, heroes } = table({ heroes: 3 });
    assert.equal(zoneOf(engine, shared), "play", "the shared faction is on the table");
    for (const id of heroes) {
      const ownFaction = engine.state.players[id].factionId!;
      assert.notEqual(ownFaction, shared, `${id} keeps their own faction card`);
      const offered = engine.getActivatedAbilityStatuses(id).filter(status => status.cardId === shared);
      assert.ok(offered.length > 0, `${id} is offered the shared faction's abilities`);
    }
  });

  rule("SD 5", "it is one card for the whole table, nobody's own faction card", () => {
    const { engine, shared, heroes } = table({ heroes: 3 });
    const factionIds = heroes.map(id => engine.state.players[id].factionId);
    assert.ok(!factionIds.includes(shared), "it is not any Hero's own faction card");
    const sameDefinition = Object.values(engine.state.cards).filter(c => c.definitionId === engine.state.cards[shared].definitionId);
    assert.equal(sameDefinition.length, 1, "a single copy serves every Hero");
  });

  rule("SD 5", "a Hero keeps their own faction's abilities as well as the shared faction's", () => {
    const ownAbility = {
      id: "own",
      type: "activated" as const,
      costs: [],
      effects: [{ type: "draw" as const, player: "controller" as const, amount: 1 }]
    };
    const mine = heroFaction({ abilities: [ownAbility] });
    const { engine, shared } = table({ heroes: 2, heroFactions: [mine] });
    const own = engine.state.players.h1.factionId!;
    const offered = engine.getActivatedAbilityStatuses("h1");
    assert.ok(offered.some(status => status.cardId === own && status.ability.id === "own" && status.available), "own faction ability offered");
    assert.ok(offered.some(status => status.cardId === shared), "shared faction ability offered");
  });

  rule("SD 5", "every Hero reaches the same shared faction: a claim by one Hero and then another both come out of the one Hero Deck", () => {
    const { engine, shared } = table({ heroes: 2, heroDeck: [CHAMPION, CHAMPION] });
    giveResources(engine, "h1", 6);
    use(engine, "h1", shared, "spring");
    assert.equal(engine.state.showdown!.heroDeck.length, 1);
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, "h2");
    giveResources(engine, "h2", 6);
    use(engine, "h2", shared, "spring");
    assert.deepEqual(engine.state.showdown!.heroDeck, [], "both claims came out of the same Hero Deck");
  });
});

describe("SD 6 - an Allegiance card, face-down, dealt at random to each Hero", () => {
  rule("SD 6", "every Hero is dealt exactly one Allegiance card, face-down; the Villain is dealt none", () => {
    const { engine } = table({ heroes: 3 });
    assert.deepEqual(Object.keys(engine.state.showdown!.allegiance).sort(), ["h1", "h2", "h3"]);
    for (const card of Object.values(engine.state.showdown!.allegiance)) assert.equal(card.faceUp, false, "dealt face-down");
    assert.equal(isAllegianceRevealed(engine.state, "h1"), false);
    assert.equal(engine.state.showdown!.allegiance.v, undefined, "no Allegiance card for the Villain");
  });

  rule("SD 6", "each card shows a loyalty to the Heroes or secretly to the Villain, and the Heroes' cards come from the Allegiance deck", () => {
    const { engine } = table({ heroes: 3, allegiance: ["villain", "heroes", "heroes", "heroes"] });
    const loyalties = ["h1", "h2", "h3"].map(id => getLoyalty(engine.state, id));
    for (const loyalty of loyalties) assert.ok(loyalty === "heroes" || loyalty === "villain", `a loyalty, got ${loyalty}`);
    assert.ok(loyalties.filter(loyalty => loyalty === "villain").length <= 1, "only one traitor card exists in this Allegiance deck");
  });

  rule("SD 6", "a Hero's loyalty is what their card says: an all-traitor deck makes every Hero loyal to the Villain, an all-loyal deck none", () => {
    const traitors = table({ heroes: 2, allegiance: ["villain", "villain"] }).engine;
    assert.deepEqual(["h1", "h2"].map(id => getLoyalty(traitors.state, id)), ["villain", "villain"]);
    const loyal = table({ heroes: 2, allegiance: ["heroes", "heroes"] }).engine;
    assert.deepEqual(["h1", "h2"].map(id => getLoyalty(loyal.state, id)), ["heroes", "heroes"]);
  });

  rule("SD 6", "the deal is random: across different games a given Hero gets both kinds of card, and the same game deals the same way again", () => {
    const dealt = (seed: number) => {
      const { engine } = table({ heroes: 3, allegiance: ["villain", "heroes", "heroes", "heroes"], seed });
      return ["h1", "h2", "h3"].map(id => getLoyalty(engine.state, id));
    };
    const h1Across = new Set(Array.from({ length: 40 }, (_, i) => dealt(i + 1)[0]));
    assert.deepEqual([...h1Across].sort(), ["heroes", "villain"], "h1 is sometimes the traitor, sometimes not");
    const patterns = new Set(Array.from({ length: 40 }, (_, i) => dealt(i + 1).join(",")));
    assert.ok(patterns.size > 1, "the cards fall in different places in different games");
    assert.deepEqual(dealt(7), dealt(7), "control: the same seed deals the same");
  });

  rule("SD 6", "before the game starts: the Allegiance cards are already dealt at turn 1, before anyone has taken a turn", () => {
    const { engine } = table({ heroes: 2, unsettled: true });
    assert.equal(engine.state.turn, 1);
    assert.equal(Object.keys(engine.state.showdown!.allegiance).length, 2);
  });

  rule("SD 6", "there must be an Allegiance card for every Hero: a deck too small to deal one each is refused", () => {
    refused(() => table({ heroes: 3, allegiance: ["heroes", "heroes"] }), "two cards cannot go to three Heroes", /Allegiance deck/);
    const control = table({ heroes: 3, allegiance: ["heroes", "heroes", "heroes"] }).engine;
    assert.equal(Object.keys(control.state.showdown!.allegiance).length, 3, "control: one each works");
  });

  rule("SD 6", "the loyalty stays hidden: to a viewer who may not look, the card's loyalty reads hidden", () => {
    const { engine } = table({ heroes: 2, allegiance: ["villain", "villain"] });
    const spectator = redactStateFor(engine.state, "spectator").showdown!.allegiance;
    assert.equal(spectator.h1.loyalty, "hidden");
    assert.equal(spectator.h2.loyalty, "hidden");
    assert.equal(engine.state.showdown!.allegiance.h1.loyalty, "villain", "control: the real card is a traitor's");
  });
});

describe("SD 7 - the Villain may look at the Allegiance cards at any time", () => {
  rule("SD 7", "the Villain sees every Hero's Allegiance card (and a Hero their own), while another Hero's stays hidden from a Hero", () => {
    const { engine } = table({ heroes: 3, allegiance: ["villain", "heroes", "heroes", "heroes"] });
    const seen = (viewer: "v" | "h1" | "h2" | "h3" | "spectator") => redactStateFor(engine.state, viewer).showdown!.allegiance;
    for (const id of ["h1", "h2", "h3"]) {
      assert.equal(seen("v")[id].loyalty, engine.state.showdown!.allegiance[id].loyalty, `the Villain sees ${id}'s card`);
    }
    assert.equal(seen("h1").h1.loyalty, engine.state.showdown!.allegiance.h1.loyalty, "a Hero sees their own card");
    assert.equal(seen("h1").h2.loyalty, "hidden", "but not another Hero's");
    assert.equal(seen("h1").h3.loyalty, "hidden");
    assert.equal(seen("spectator").h1.loyalty, "hidden", "an onlooker sees none");
  });

  rule("SD 7", "at any time: the Villain still sees every card mid-game, on a Hero's turn and after turns have passed", () => {
    const { engine } = table({ heroes: 2, allegiance: ["villain", "heroes", "heroes"] });
    const villainSees = () => redactStateFor(engine.state, "v").showdown!.allegiance;
    const truth = () => engine.state.showdown!.allegiance;
    assert.equal(engine.state.activePlayerId, "h1");
    assert.deepEqual(villainSees(), truth(), "on a Hero's turn");
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, "h2");
    assert.deepEqual(villainSees(), truth(), "later, on another Hero's turn");
    assert.equal(canSeeAllegiance(engine.state, "v", "h1"), true);
    assert.equal(canSeeAllegiance(engine.state, "v", "h2"), true);
  });

  rule("SD 7", "only the Villain has that privilege: no Hero may look at another Hero's face-down card", () => {
    const { engine } = table({ heroes: 3 });
    assert.equal(canSeeAllegiance(engine.state, "h1", "h2"), false);
    assert.equal(canSeeAllegiance(engine.state, "h2", "h1"), false);
    assert.equal(canSeeAllegiance(engine.state, "h1", "h1"), true, "control: their own, yes");
  });

  rule("SD 7", "looking does not turn the card over: the Villain's look leaves it face-down to everyone else", () => {
    const { engine } = table({ heroes: 2 });
    redactStateFor(engine.state, "v");
    assert.equal(isAllegianceRevealed(engine.state, "h1"), false);
    assert.equal(redactStateFor(engine.state, "h2").showdown!.allegiance.h1.loyalty, "hidden");
  });
});

describe("SD 2 / SD 3 / SD 5 - a Showdown table is held to its rules at setup", () => {
  const evil = evilFaction();
  const hero = heroFaction();
  const shared = sharedFaction();
  const seat = (id: string, faction = hero) => ({ id, name: id, factionDefinitionId: faction.id, deckDefinitionIds: [RAGE.id, FILLER.id, FILLER.id, FILLER.id] });
  const build = (villainFaction: typeof evil, showdown: { heroDeck: string[]; sharedFactionDefinitionId?: string }) =>
    createFactionGame([evil, hero, shared, CHAMPION, RAGE, FILLER], [seat("v", villainFaction), seat("h1"), seat("h2")], {
      format: { kind: "showdown", villainId: "v" },
      showdown,
      seed: 1,
      firstPlayerId: "v"
    });
  const legal = { heroDeck: [CHAMPION.id], sharedFactionDefinitionId: shared.id };

  rule("SD 2", "the Villain must use The Evil Alliance: any other faction in the Villain's seat is refused", () => {
    refused(() => build(hero, legal), "a Hero faction in the Villain's seat", /Evil Alliance/);
    assert.ok(build(evil, legal), "control: the Villain's faction is accepted");
  });

  rule("SD 3", "there is a shared Hero Deck: a table without one is refused", () => {
    refused(() => build(evil, { ...legal, heroDeck: [] }), "an empty Hero Deck", /Hero Deck/);
  });

  rule("SD 5", "every Hero shares the Slightly Less Evil Alliance: a table without it, or with another faction in its place, is refused", () => {
    refused(() => build(evil, { heroDeck: legal.heroDeck }), "no shared faction", /Slightly Less Evil Alliance/);
    refused(() => build(evil, { ...legal, sharedFactionDefinitionId: hero.id }), "a Hero faction as the shared faction", /Slightly Less Evil Alliance/);
  });
});
