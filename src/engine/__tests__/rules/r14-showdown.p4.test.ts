// Batch r14-showdown, part 4 (docs/TESTING.md): the Evil Alliance faction card, SD-EA 1-SD-EA 11
// (docs/rules/showdown-rules.md). Written from the printed wording, not from the engine. The rules suite uses
// synthetic factions only: `evilFaction` (r14-showdown.shared.ts) is authored with the engine's Showdown
// vocabulary and stands in for the printed The Evil Alliance.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { FactionDefinition, SpoilsEngine } from "../../../engine.js";
import { character, item, location, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { chooseDevelopOption, isDevelopChoice, orderUntilDevelopPrompt } from "../support/develop.js";
import { refused, rule } from "./_rule.js";
import {
  BILE,
  CHAMPION,
  FANCY,
  RAGE,
  evilFaction,
  finishResourcePlay,
  giveResources,
  heroFaction,
  influenceOf,
  passTurn,
  passTurnUnsettled,
  passTurnsTo,
  place,
  resourcesOf,
  table,
  toHand,
  use,
  zoneOf
} from "./r14-showdown.shared.js";

/** The Villain's Evil Alliance with no opening hand, so a test's hands are exactly what it puts there. */
const quiet = (overrides: Partial<FactionDefinition> = {}) =>
  evilFaction({
    setup: {
      startingResources: { count: 1, countPerOpponent: 1, stapleOnly: true },
      openingHand: { goingFirst: 0, goingSecond: 0 }
    },
    ...overrides
  });

const handOf = (engine: SpoilsEngine, id: string) => engine.state.players[id].hand.length;
const villainResources = (engine: SpoilsEngine) => resourcesOf(engine, "v");
const attached = (engine: SpoilsEngine, id: string) => engine.state.cards[id].attachedTo !== undefined;

/** Answers every Develop Rule prompt that is open (and each one it raises) with "draw"; returns how many there were. */
function developByDrawing(engine: SpoilsEngine, playerId: string): number {
  orderUntilDevelopPrompt(engine);
  let prompts = 0;
  while (isDevelopChoice(engine.state.pendingChoice)) {
    chooseDevelopOption(engine, playerId, /^Draw /);
    prompts++;
    assert.ok(prompts <= 6, "the Develop Rule stops asking");
  }
  return prompts;
}

describe("SD-EA 1 - X is the Villain's number of opponents at the start of the game", () => {
  rule("SD-EA 1", "X is the number of Heroes the Villain faces: 2, 3 or 4 with that many Heroes", () => {
    for (const heroes of [2, 3, 4]) {
      const { engine } = table({ heroes });
      assert.equal(engine.state.startingOpponentCounts.v, heroes, `${heroes} Heroes: X = ${heroes}`);
    }
  });

  rule("SD-EA 1", "a Hero who used the same scaling would have X = 1: their only opponent is the Villain, however many Heroes play", () => {
    const scaled = heroFaction({ startingInfluence: 15, influencePerOpponent: 10 });
    const { engine } = table({ heroes: 3, heroFactions: [scaled] });
    for (const id of ["h1", "h2", "h3"]) {
      assert.equal(engine.state.startingOpponentCounts[id], 1, `${id}: X = 1`);
      assert.equal(influenceOf(engine, id), 25, `${id} starts with 15 + 10 * 1`);
    }
  });

  rule("SD-EA 1", "X is fixed at the start of the game: a Hero leaving later does not change the Villain's X", () => {
    const { engine } = table({ heroes: 3, villainFaction: quiet(), allegiance: ["heroes", "heroes", "heroes", "heroes"] });
    engine.state.players.h2.influence = 0;
    passTurn(engine);
    assert.ok(engine.state.players.h2.eliminated, "h2 is out");
    assert.equal(engine.state.startingOpponentCounts.v, 3, "X still counts the opponents at the start");
    passTurnsTo(engine, "h3");
    passTurnUnsettled(engine);
    assert.equal(engine.state.activePlayerId, "v");
    assert.equal(developByDrawing(engine, "v"), 3, "the Villain still develops X = 3 times with two Heroes left");
  });
});

describe("SD-EA 2 - starting influence is 15 + 10 per opponent", () => {
  rule("SD-EA 2", "two Heroes: 35 influence", () => {
    assert.equal(influenceOf(table({ heroes: 2 }).engine, "v"), 35);
  });

  rule("SD-EA 2", "three Heroes: 45; four Heroes: 55", () => {
    assert.equal(influenceOf(table({ heroes: 3 }).engine, "v"), 45);
    assert.equal(influenceOf(table({ heroes: 4 }).engine, "v"), 55);
  });

  rule("SD-EA 2", "the Heroes' factions are unaffected: they start with their own printed influence", () => {
    const { engine } = table({ heroes: 3 });
    for (const id of ["h1", "h2", "h3"]) assert.equal(influenceOf(engine, id), 20);
  });
});

describe("SD-EA 3 - starting resources: any 1 + X staple resources", () => {
  const stapleCount = (engine: SpoilsEngine) => villainResources(engine).filter(id => engine.getDefinition(id).resource?.staple).length;

  rule("SD-EA 3", "the Villain starts with 3 resources against two Heroes, 4 against three and 5 against four", () => {
    for (const [heroes, expected] of [[2, 3], [3, 4], [4, 5]] as const) {
      const { engine } = table({ heroes, unsettled: true, seatExtras: { v: [FANCY, FANCY, FANCY, FANCY, FANCY, FANCY] } });
      assert.equal(villainResources(engine).length, expected, `${heroes} Heroes: 1 + ${heroes}`);
      assert.equal(stapleCount(engine), expected, "all of them staples");
    }
  });

  rule("SD-EA 3", "only staple resources: a deck full of non-staple resources never supplies a starting resource", () => {
    const { engine } = table({ heroes: 2, unsettled: true, seatExtras: { v: [FANCY, FANCY, FANCY, FANCY] } });
    for (const id of villainResources(engine)) assert.equal(engine.getDefinition(id).name, "Rage");
  });

  rule("SD-EA 3", "any staples: the Villain picks which, in any mix of kinds, as long as there are 1 + X of them", () => {
    const { engine } = table({
      heroes: 2,
      chooseStartingResources: true,
      seatExtras: { v: [BILE, BILE, BILE, BILE, FANCY] }
    });
    assert.equal(engine.state.setup.phase, "chooseStartingResources");
    const choice = engine.getStartingResourceChoice("v")!;
    assert.equal(choice.count, 3, "1 + X with two Heroes");
    const names = new Set(choice.candidateCardIds.map(id => engine.getDefinition(id).name));
    assert.deepEqual([...names].sort(), ["Bile", "Rage"], "every kind of staple is on offer, the non-staple is not");
    const rage = choice.candidateCardIds.filter(id => engine.getDefinition(id).name === "Rage");
    const bile = choice.candidateCardIds.filter(id => engine.getDefinition(id).name === "Bile");
    refused(
      () => engine.perform({ type: "chooseStartingResources", playerId: "v", cardIds: [rage[0], bile[0]] }),
      "two staples where 1 + X = 3 are due",
      /exactly 3/
    );
    engine.perform({ type: "chooseStartingResources", playerId: "v", cardIds: [rage[0], bile[0], bile[1]] });
    assert.deepEqual(
      villainResources(engine).map(id => engine.getDefinition(id).name).sort(),
      ["Bile", "Bile", "Rage"],
      "a mix of kinds is fine"
    );
  });

  rule("SD-EA 3", "a non-staple resource cannot be one of the starting resources", () => {
    const { engine } = table({ heroes: 2, chooseStartingResources: true, seatExtras: { v: [BILE, BILE, FANCY, FANCY] } });
    const fancy = engine.state.players.v.deck.filter(id => engine.getDefinition(id).name === "Fancy");
    const rage = engine.getStartingResourceChoice("v")!.candidateCardIds.filter(id => engine.getDefinition(id).name === "Rage");
    refused(
      () => engine.perform({ type: "chooseStartingResources", playerId: "v", cardIds: [rage[0], rage[1], fancy[0]] }),
      "a non-staple among the starting resources",
      /staple/
    );
  });
});

describe("SD-EA 4 - starting draw: 7 going first, 8 going second", () => {
  const handSizes = (first: string, heroes = 2) => {
    const { engine } = table({ heroes, first, unsettled: true });
    return handOf(engine, "v");
  };

  rule("SD-EA 4", "the Villain going first draws 7", () => {
    assert.equal(handSizes("v"), 7);
  });

  rule("SD-EA 4", "the Villain going second draws 8", () => {
    assert.equal(handSizes("h1"), 8, "the Villain after the first Hero");
  });

  rule("SD-EA 4", "going later than second still draws 8, with more Heroes at the table", () => {
    assert.equal(handSizes("h2", 3), 8);
    assert.equal(handSizes("h3", 3), 8);
  });

  rule("SD-EA 4", "the Villain's opening hand depends on the Villain's place in the turn order, not the Heroes' factions", () => {
    const withPlainHeroes = table({ heroes: 2, first: "v", unsettled: true }).engine;
    assert.equal(handOf(withPlainHeroes, "v"), 7);
    assert.equal(handOf(withPlainHeroes, "h1"), 0, "a Hero's opening hand is their own faction's (none here)");
  });
});

describe("SD-EA 5 - restore rule: restore everything and detach resources at the start of your turn", () => {
  const GUARD = character({ name: "Guard", life: 4 });
  const RELIC = item({ name: "Relic" });
  const SHRINE = location({ name: "Shrine", structure: 5 });

  rule("SD-EA 5", "at the start of the Villain's turn the Villain's depleted cards are restored and its resources detached from the faction", () => {
    const { engine } = table({ heroes: 2, villainFaction: quiet(), deckExtras: [GUARD] });
    passTurnsTo(engine, "v");
    const guard = place(engine, "v", GUARD);
    use(engine, "v", engine.state.players.v.factionId!, "draw");
    const paid = villainResources(engine);
    assert.ok(paid.every(id => attached(engine, id)), "paying 3 attached the resources to the faction");
    engine.state.cards[guard].depleted = true;
    passTurnsTo(engine, "h1");
    assert.equal(engine.state.cards[guard].depleted, true, "still depleted on a Hero's turn");
    assert.ok(paid.every(id => attached(engine, id)), "still attached on a Hero's turn");
    passTurnsTo(engine, "v");
    assert.equal(engine.state.cards[guard].depleted, false, "restored at the start of the Villain's turn");
    assert.ok(paid.every(id => !attached(engine, id)), "detached at the start of the Villain's turn");
  });

  rule("SD-EA 5", "all depleted cards are restored, not only characters: a depleted item and location are too", () => {
    const { engine } = table({ heroes: 2, villainFaction: quiet(), deckExtras: [RELIC, SHRINE] });
    passTurnsTo(engine, "v");
    const relic = place(engine, "v", RELIC);
    const shrine = place(engine, "v", SHRINE);
    engine.state.cards[relic].depleted = true;
    engine.state.cards[shrine].depleted = true;
    passTurnsTo(engine, "h1");
    assert.deepEqual([engine.state.cards[relic].depleted, engine.state.cards[shrine].depleted], [true, true]);
    passTurnsTo(engine, "v");
    assert.deepEqual([engine.state.cards[relic].depleted, engine.state.cards[shrine].depleted], [false, false]);
  });

  rule("SD-EA 5", "it is the Villain's rule alone: a Hero's turn start does not restore the Villain's cards (control)", () => {
    const { engine } = table({ heroes: 2, villainFaction: quiet(), deckExtras: [GUARD], first: "v" });
    const guard = place(engine, "v", GUARD);
    engine.state.cards[guard].depleted = true;
    passTurn(engine);
    assert.equal(engine.state.activePlayerId, "h1");
    assert.equal(engine.state.cards[guard].depleted, true);
    passTurn(engine);
    assert.equal(engine.state.cards[guard].depleted, true, "nor does the second Hero's");
  });
});

describe("SD-EA 6 - develop rule: draw a card or play a resource, X times in all", () => {
  /** The Villain's turn start, stopped at its Develop Rule's first prompt. */
  const villainTurnStart = (heroes: number) => {
    const t = table({ heroes, villainFaction: quiet(), first: "h1" });
    for (let guard = 0; guard < heroes - 1; guard++) passTurn(t.engine);
    passTurnUnsettled(t.engine);
    assert.equal(t.engine.state.activePlayerId, "v");
    return t.engine;
  };

  rule("SD-EA 6", "against two Heroes the Villain develops twice: draw a card or play a resource, then once more", () => {
    const engine = villainTurnStart(2);
    assert.equal(handOf(engine, "v"), 0);
    assert.equal(developByDrawing(engine, "v"), 2, "two Develop Rule choices");
    assert.equal(handOf(engine, "v"), 2, "each draw took a card");
    assert.equal(engine.state.pendingChoice, undefined, "and that is all");
  });

  rule("SD-EA 6", "against three Heroes the Villain develops three times, against four, four times", () => {
    const three = villainTurnStart(3);
    assert.equal(developByDrawing(three, "v"), 3);
    assert.equal(handOf(three, "v"), 3);
    const four = villainTurnStart(4);
    assert.equal(developByDrawing(four, "v"), 4);
    assert.equal(handOf(four, "v"), 4);
  });

  rule("SD-EA 6", "each repeat is a fresh choice: the Villain may draw once and play a resource once", () => {
    const { engine } = table({ heroes: 2, villainFaction: quiet(), first: "h1" });
    toHand(engine, "v", RAGE, 2);
    passTurn(engine);
    passTurnUnsettled(engine);
    assert.equal(engine.state.activePlayerId, "v");
    const resourcesBefore = villainResources(engine).length;
    orderUntilDevelopPrompt(engine);
    chooseDevelopOption(engine, "v", /^Draw /);
    assert.ok(isDevelopChoice(engine.state.pendingChoice), "a second choice is offered");
    chooseDevelopOption(engine, "v", /^Play /);
    finishResourcePlay(engine);
    assert.equal(villainResources(engine).length, resourcesBefore + 1, "a resource was played");
    assert.equal(handOf(engine, "v"), 2, "2 in hand - 1 played + 1 drawn");
    assert.equal(engine.state.pendingChoice, undefined, "and no third choice");
  });

  rule("SD-EA 6", "a Hero's own Develop Rule is its faction's: a Hero develops once", () => {
    const { engine } = table({ heroes: 3, villainFaction: quiet(), first: "v" });
    passTurnUnsettled(engine);
    assert.equal(engine.state.activePlayerId, "h1");
    assert.equal(developByDrawing(engine, "h1"), 1, "once, not X times");
  });
});

describe("SD-EA 7 - DRAW: pay 3, draw a card", () => {
  const drawer = (resources: number) =>
    table({ heroes: 2, villainFaction: quiet({ setup: { startingResources: { count: resources, stapleOnly: true }, openingHand: { goingFirst: 0, goingSecond: 0 } } }), first: "v" });

  rule("SD-EA 7", "paying 3 draws one card", () => {
    const { engine } = drawer(3);
    const faction = engine.state.players.v.factionId!;
    const handBefore = handOf(engine, "v");
    const deckBefore = engine.state.players.v.deck.length;
    use(engine, "v", faction, "draw");
    assert.equal(handOf(engine, "v"), handBefore + 1);
    assert.equal(engine.state.players.v.deck.length, deckBefore - 1);
    assert.equal(villainResources(engine).filter(id => attached(engine, id)).length, 3, "all 3 resources were paid");
  });

  rule("SD-EA 7", "it cannot be used with fewer than 3 resources to pay with, and can with exactly 3", () => {
    const { engine } = drawer(2);
    const faction = engine.state.players.v.factionId!;
    const handBefore = handOf(engine, "v");
    refused(() => use(engine, "v", faction, "draw"), "paying 3 with 2 resources", /cannot be paid/);
    assert.equal(handOf(engine, "v"), handBefore, "nothing drawn");
    giveResources(engine, "v", 3);
    use(engine, "v", faction, "draw");
    assert.equal(handOf(engine, "v"), handBefore + 1, "control: with 3 resources it works");
  });

  rule("SD-EA 7", "it can be used again as long as 3 more resources can be paid", () => {
    const { engine } = drawer(6);
    const faction = engine.state.players.v.factionId!;
    const handBefore = handOf(engine, "v");
    use(engine, "v", faction, "draw");
    use(engine, "v", faction, "draw");
    assert.equal(handOf(engine, "v"), handBefore + 2);
    refused(() => use(engine, "v", faction, "draw"), "a third draw with no resources left", /cannot be paid/);
  });

  rule("SD-EA 7", "it is the Villain's faction ability: a Hero cannot use it", () => {
    const { engine } = drawer(3);
    const faction = engine.state.players.v.factionId!;
    passTurn(engine);
    giveResources(engine, "h1", 3);
    refused(() => use(engine, "h1", faction, "draw"), "a Hero using the Villain's DRAW", /control/i);
  });
});

describe("SD-EA 8 - RESOURCE: pay 3, play a resource", () => {
  const resourcer = (resources: number) =>
    table({ heroes: 2, villainFaction: quiet({ setup: { startingResources: { count: resources, stapleOnly: true }, openingHand: { goingFirst: 0, goingSecond: 0 } } }), first: "v" });

  rule("SD-EA 8", "paying 3 plays a resource from hand", () => {
    const { engine } = resourcer(3);
    const faction = engine.state.players.v.factionId!;
    const [card] = toHand(engine, "v", RAGE);
    const before = villainResources(engine).length;
    engine.perform({ type: "activateAbility", playerId: "v", cardId: faction, abilityId: "resource" });
    resolvePendingResponses(engine);
    finishResourcePlay(engine);
    assert.equal(zoneOf(engine, card), "play", "the resource came into play");
    assert.equal(villainResources(engine).length, before + 1);
    assert.equal(villainResources(engine).filter(id => attached(engine, id)).length, 3, "3 resources paid for it");
  });

  rule("SD-EA 8", "it cannot be used without 3 resources to pay with", () => {
    const { engine } = resourcer(2);
    const faction = engine.state.players.v.factionId!;
    const [card] = toHand(engine, "v", RAGE);
    refused(() => use(engine, "v", faction, "resource"), "paying 3 with 2 resources", /cannot be paid/);
    assert.equal(zoneOf(engine, card), "hand", "nothing was played");
  });
});

describe("SD-EA 9 - ENTICEMENT: only during your turn, once per turn", () => {
  const enticing = (heroes: number) => {
    const t = table({ heroes, villainFaction: quiet(), first: "v" });
    toHand(t.engine, "v", RAGE, 1);
    return t;
  };
  const entice = (engine: SpoilsEngine) => {
    engine.perform({ type: "activateAbility", playerId: "v", cardId: engine.state.players.v.factionId!, abilityId: "enticement" });
    resolvePendingResponses(engine);
    finishResourcePlay(engine);
  };

  rule("SD-EA 9", "draws X - 1 cards: one against two Heroes", () => {
    const { engine } = enticing(2);
    const deckBefore = engine.state.players.v.deck.length;
    entice(engine);
    assert.equal(engine.state.players.v.deck.length, deckBefore - 1, "X - 1 = 1 card drawn");
  });

  rule("SD-EA 9", "draws X - 1 cards: two against three Heroes", () => {
    const { engine } = enticing(3);
    const deckBefore = engine.state.players.v.deck.length;
    entice(engine);
    assert.equal(engine.state.players.v.deck.length, deckBefore - 2, "X - 1 = 2 cards drawn");
  });

  rule("SD-EA 9", "plays a resource from the Villain's hand", () => {
    const { engine } = enticing(2);
    const before = villainResources(engine).length;
    entice(engine);
    assert.equal(villainResources(engine).length, before + 1);
  });

  rule("SD-EA 9", "puts the top card of the Hero Deck into the Temptation Pile", () => {
    const { engine } = enticing(2);
    const [top] = engine.state.showdown!.heroDeck;
    entice(engine);
    assert.deepEqual(engine.state.showdown!.temptationPile, [top]);
    assert.equal(engine.state.showdown!.heroDeck.length, 0);
  });

  rule("SD-EA 9", "only once per turn: a second use the same turn is refused, and it is available again next turn", () => {
    const { engine } = enticing(2);
    toHand(engine, "v", RAGE, 1);
    entice(engine);
    refused(() => entice(engine), "ENTICEMENT a second time this turn", /only 1 time/);
    passTurnsTo(engine, "h1");
    passTurnsTo(engine, "v");
    toHand(engine, "v", RAGE, 1);
    entice(engine);
    assert.equal(engine.state.showdown!.temptationPile.length, 1, "control: next turn it works (the Hero Deck had one card)");
  });

  rule("SD-EA 9", "only during the Villain's turn: with priority in a Hero's turn the Villain still cannot use it, though their other abilities are fine", () => {
    const NOOP = item({
      name: "Noop",
      behavior: { abilities: [{ id: "noop", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
    const { engine } = table({ heroes: 2, villainFaction: quiet(), deckExtras: [NOOP], first: "h1" });
    toHand(engine, "v", RAGE, 1);
    const faction = engine.state.players.v.factionId!;
    engine.perform({ type: "activateAbility", playerId: "h1", cardId: place(engine, "h1", NOOP), abilityId: "noop" });
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow!.priorityPlayerId });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, "v", "the Villain may respond to the Hero");
    assert.equal(engine.state.activePlayerId, "h1", "it is a Hero's turn");
    const statuses = engine.getActivatedAbilityStatuses("v").filter(status => status.cardId === faction);
    const byId = (id: string) => statuses.find(status => status.ability.id === id);
    assert.equal(byId("draw")?.available, true, "DRAW has no timing limit");
    assert.equal(byId("enticement")?.available, false);
    assert.equal(byId("enticement")?.unavailableBecause, "condition");
    refused(
      () => engine.perform({ type: "activateAbility", playerId: "v", cardId: faction, abilityId: "enticement" }),
      "ENTICEMENT in a Hero's turn",
      /condition is not satisfied/
    );
  });
});

describe("SD-EA 10 - DARING GAMBIT: 7 damage from a Hero to another Hero claims the Temptation Pile", () => {
  /** A Hero character that can inflict 7, 6, 4 or 1 damage to another Hero's faction (or the Villain's). */
  const BRUTE = character({
    name: "Brute",
    behavior: {
      abilities: [7, 6, 4, 1].flatMap(amount => [
        {
          id: `hit${amount}`,
          type: "activated" as const,
          costs: [],
          targets: [{ id: "f", selector: { type: "faction" as const, controller: "otherHero" as const }, count: 1 }],
          effects: [{ type: "dealDamage" as const, target: { type: "selected" as const, id: "f" }, amount }]
        },
        {
          id: `villain${amount}`,
          type: "activated" as const,
          costs: [],
          targets: [{ id: "f", selector: { type: "faction" as const, controller: "opponent" as const }, count: 1 }],
          effects: [{ type: "dealDamage" as const, target: { type: "selected" as const, id: "f" }, amount }]
        }
      ])
    }
  });
  const OPERATOR = item({
    name: "Operator",
    behavior: { abilities: [{ id: "tempt", type: "activated", costs: [], effects: [{ type: "heroDeckToTemptationPile", count: 2 }] }] }
  });
  const PEP = tactic({
    name: "Pep",
    behavior: { abilities: [{ id: "pep", type: "activated", costs: [], effects: [{ type: "modifyInfluence", player: "controller", amount: 5 }] }] }
  });
  const gambit = (options: { villainFaction?: ReturnType<typeof evilFaction> } = {}) => {
    const t = table({
      heroes: 3,
      deckExtras: [BRUTE, OPERATOR],
      heroDeck: [CHAMPION, CHAMPION],
      allegiance: ["heroes", "heroes", "heroes", "heroes"],
      ...(options.villainFaction ? { villainFaction: options.villainFaction } : {})
    });
    use(t.engine, "h1", place(t.engine, "h1", OPERATOR), "tempt");
    return t;
  };
  const pileOf = (engine: SpoilsEngine) => [...engine.state.showdown!.temptationPile];
  const hit = (engine: SpoilsEngine, brute: string, ability: string, victim: string) =>
    use(engine, "h1", brute, ability, { f: [engine.state.players[victim].factionId!] });

  rule("SD-EA 10", "a Hero inflicting 7 damage to another Hero claims the entire Temptation Pile", () => {
    const { engine } = gambit();
    const pile = pileOf(engine);
    assert.equal(pile.length, 2);
    const brute = place(engine, "h1", BRUTE);
    hit(engine, brute, "hit7", "h2");
    assert.equal(influenceOf(engine, "h2"), 13, "the 7 damage landed");
    assert.deepEqual(pileOf(engine), [], "the pile is empty");
    for (const id of pile) {
      assert.equal(zoneOf(engine, id), "play", "claimed into play");
      assert.equal(engine.state.cards[id].controllerId, "h1", "under the damaging Hero's control");
    }
  });

  rule("SD-EA 10", "6 damage is not enough: the pile stays where it is", () => {
    const { engine } = gambit();
    const pile = pileOf(engine);
    hit(engine, place(engine, "h1", BRUTE), "hit6", "h2");
    assert.equal(influenceOf(engine, "h2"), 14);
    assert.deepEqual(pileOf(engine), pile, "untouched");
  });

  rule("SD-EA 10", "damage adds up within the turn: 6 and then 1 more to the same Hero is 7", () => {
    const { engine } = gambit();
    const brute = place(engine, "h1", BRUTE);
    hit(engine, brute, "hit6", "h2");
    assert.equal(pileOf(engine).length, 2, "not yet");
    hit(engine, brute, "hit1", "h2");
    assert.deepEqual(pileOf(engine), [], "claimed once the total reached 7");
  });

  rule("SD-EA 10", "it counts damage 'this turn': 6 in one turn and 1 in a later turn is not 7", () => {
    const { engine } = gambit();
    const brute = place(engine, "h1", BRUTE);
    hit(engine, brute, "hit6", "h2");
    passTurn(engine);
    passTurnsTo(engine, "h1");
    assert.equal(engine.state.activePlayerId, "h1", "a full round later");
    hit(engine, brute, "hit1", "h2");
    assert.equal(pileOf(engine).length, 2, "the new turn started the count again");
  });

  rule("SD-EA 10", "it must be 7 to the same Hero: 4 to one Hero and 4 to another is not enough", () => {
    const { engine } = gambit();
    const brute = place(engine, "h1", BRUTE);
    hit(engine, brute, "hit4", "h2");
    hit(engine, brute, "hit4", "h3");
    assert.equal(pileOf(engine).length, 2);
  });

  rule("SD-EA 10", "damage to the Villain is not damage to another Hero: even 7 claims nothing", () => {
    const { engine } = gambit();
    const brute = place(engine, "h1", BRUTE);
    use(engine, "h1", brute, "villain7", { f: [engine.state.players.v.factionId!] });
    assert.equal(influenceOf(engine, "v"), 38, "the Villain took 7 (45 - 7)");
    assert.equal(pileOf(engine).length, 2);
  });

  rule("SD-EA 10", "a Hero's attack counts: a 7-strength attacker unblocked against another Hero claims the pile", () => {
    const rager = character({ name: "Rager", strength: 7, life: 4 });
    const t = table({
      heroes: 3,
      deckExtras: [rager, OPERATOR],
      heroDeck: [CHAMPION, CHAMPION],
      allegiance: ["heroes", "heroes", "heroes", "heroes"]
    });
    use(t.engine, "h1", place(t.engine, "h1", OPERATOR), "tempt");
    const attacker = place(t.engine, "h1", rager);
    t.engine.perform({ type: "declareAttack", playerId: "h1", attackerIds: [attacker], target: { type: "faction", playerId: "h2" } });
    resolvePendingResponses(t.engine);
    t.engine.perform({ type: "declareBlockers", playerId: "h2", blockerIds: [] });
    for (let guard = 0; t.engine.state.battle && guard < 40; guard++) {
      if (t.engine.state.responseWindow) resolvePendingResponses(t.engine);
      else if (t.engine.state.battle.phase === "attackerDamageAssignment") {
        const view = t.engine.getBattleView()!;
        t.engine.perform({
          type: "assignBattleDamage",
          playerId: view.actingPlayerId!,
          assignments: view.damageSources.map(s => ({ sourceId: s.cardId, target: s.legalTargets[0], amount: s.strength }))
        });
      } else t.engine.perform({ type: "advanceFlow" });
    }
    assert.equal(influenceOf(t.engine, "h2"), 13);
    assert.deepEqual(pileOf(t.engine), [], "the pile went to the attacking Hero");
    assert.equal(t.engine.state.cards[attacker].controllerId, "h1");
  });

  rule("SD-EA 10", "the pile is claimed for the damaging Hero, whichever Hero that is: the Villain's own damage does not trigger it", () => {
    const evilBrute = character({
      name: "Evil Brute",
      behavior: {
        abilities: [
          {
            id: "blast",
            type: "activated",
            costs: [],
            targets: [{ id: "f", selector: { type: "faction", controller: "opponent" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "f" }, amount: 7 }]
          }
        ]
      }
    });
    const t = table({
      heroes: 3,
      deckExtras: [evilBrute, OPERATOR],
      heroDeck: [CHAMPION, CHAMPION],
      first: "v",
      allegiance: ["heroes", "heroes", "heroes", "heroes"]
    });
    use(t.engine, "v", place(t.engine, "v", OPERATOR), "tempt");
    const brute = place(t.engine, "v", evilBrute);
    use(t.engine, "v", brute, "blast", { f: [t.engine.state.players.h1.factionId!] }, "h1");
    assert.equal(influenceOf(t.engine, "h1"), 13);
    assert.equal(pileOf(t.engine).length, 2, "Villain-inflicted damage is not a Hero's");
  });

  rule("SD-EA 10", "a claimed pile with a tactic in it: the character enters play and the tactic is offered for a free play", () => {
    const t = table({
      heroes: 3,
      deckExtras: [BRUTE, OPERATOR],
      heroDeck: [CHAMPION, PEP],
      allegiance: ["heroes", "heroes", "heroes", "heroes"]
    });
    const [first, second] = t.engine.state.showdown!.heroDeck;
    // The character sits above the tactic in the pile.
    const ordered = [first, second].sort(
      (a, b) => Number(t.engine.getDefinition(a).type === "tactic") - Number(t.engine.getDefinition(b).type === "tactic")
    );
    t.engine.state.showdown!.heroDeck = [...ordered];
    use(t.engine, "h1", place(t.engine, "h1", OPERATOR), "tempt");
    const [character1, tactic1] = ordered;
    hit(t.engine, place(t.engine, "h1", BRUTE), "hit7", "h2");
    assert.equal(zoneOf(t.engine, character1), "play", "the character entered play");
    assert.equal(t.engine.state.pendingChoice?.kind, "deployForFree", "the tactic is offered");
    assert.equal(t.engine.state.pendingChoice?.playerId, "h1");
    assert.deepEqual((t.engine.state.pendingChoice as { candidates: string[] }).candidates, [tactic1]);
  });

  rule("SD-EA 10", "with an empty Temptation Pile the gambit has nothing to claim and nothing goes wrong", () => {
    const t = table({ heroes: 3, deckExtras: [BRUTE], allegiance: ["heroes", "heroes", "heroes", "heroes"] });
    hit(t.engine, place(t.engine, "h1", BRUTE), "hit7", "h2");
    assert.equal(influenceOf(t.engine, "h2"), 13);
    assert.deepEqual(pileOf(t.engine), []);
    assert.equal(t.engine.state.pendingChoice, undefined);
  });

  rule("SD-EA 10", "it is the Villain faction's rule: without it, 7 damage between Heroes claims nothing (control)", () => {
    const { engine } = gambit({ villainFaction: evilFaction({ daringGambit: undefined }) });
    hit(engine, place(engine, "h1", BRUTE), "hit7", "h2");
    assert.equal(pileOf(engine).length, 2);
  });
});

describe("SD-EA 11 - OMNIPOTENCE: the Villain automatically meets all thresholds", () => {
  const GEM = character({ name: "Gem", cost: 0, threshold: "gggg" });
  const play = (engine: SpoilsEngine, playerId: string, cardId: string) => {
    engine.perform({ type: "playCard", playerId, cardId });
    resolvePendingResponses(engine);
  };

  rule("SD-EA 11", "the Villain deploys a card with a threshold they have no icons for", () => {
    const { engine } = table({ heroes: 2, villainFaction: quiet(), deckExtras: [GEM], first: "v" });
    const [gem] = toHand(engine, "v", GEM);
    assert.ok(villainResources(engine).every(id => !(engine.getDefinition(id).resource?.provides ?? []).includes("greed")), "no Greed icon among the Villain's resources");
    play(engine, "v", gem);
    assert.equal(zoneOf(engine, gem), "play");
  });

  rule("SD-EA 11", "control: a Hero without the icons cannot deploy the same card", () => {
    const { engine } = table({ heroes: 2, villainFaction: quiet(), deckExtras: [GEM], first: "h1" });
    const [gem] = toHand(engine, "h1", GEM);
    refused(() => play(engine, "h1", gem), "a Hero short of the threshold", /threshold/i);
    assert.equal(zoneOf(engine, gem), "hand");
  });

  rule("SD-EA 11", "control: without OMNIPOTENCE even the Villain is held to the threshold", () => {
    const { engine } = table({ heroes: 2, villainFaction: quiet({ meetsAllThresholds: false }), deckExtras: [GEM], first: "v" });
    const [gem] = toHand(engine, "v", GEM);
    refused(() => play(engine, "v", gem), "a Villain short of the threshold", /threshold/i);
  });

  rule("SD-EA 11", "it also covers a threshold on an ability, and a threshold-gated standing effect", () => {
    const gated = item({
      name: "Gated Idol",
      behavior: { abilities: [{ id: "bless", type: "activated", threshold: "gggg", costs: [], effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] }] }
    });
    const { engine } = table({ heroes: 2, villainFaction: quiet(), deckExtras: [gated], first: "v" });
    const idol = place(engine, "v", gated);
    const before = influenceOf(engine, "v");
    use(engine, "v", idol, "bless");
    assert.equal(influenceOf(engine, "v"), before + 3, "the Villain meets [G][G][G][G] automatically");
  });

  rule("SD-EA 11", "a Hero cannot use a threshold-gated ability they lack icons for (control)", () => {
    const gated = item({
      name: "Gated Idol",
      behavior: { abilities: [{ id: "bless", type: "activated", threshold: "gggg", costs: [], effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] }] }
    });
    const { engine } = table({ heroes: 2, villainFaction: quiet(), deckExtras: [gated], first: "h1" });
    const idol = place(engine, "h1", gated);
    refused(() => use(engine, "h1", idol, "bless"), "a Hero without the icons", /threshold/i);
  });
});
