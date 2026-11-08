// Deck validation and game setup agree on what a faction's STARTING RESOURCES rule needs from the deck.
//
// A faction's rule may name specific resources ("1 Obsession, 1 staple resource", "1 Deception" next
// to X staples, "2 Greed"). Setup puts those cards into play from the deck and cannot start without
// them, so `findDeckConstructionIssues` must flag a deck that lacks them, and must flag nothing else:
// a generic part of the rule ("1 staple resource", "Any 2 staple resources", "Any 1 card", the X
// staples) is a search that may find fewer (CR 312.2) and setup starts with what the deck has.
//
// The sweep runs over every faction printing of the real catalog.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { CARD_CATALOG } from "../../../data.js";
import {
  createTwoPlayerFactionGame,
  findDeckConstructionIssues,
  getMaxCopies,
  getMinimumDeckSize,
  isStapleResourceDefinition,
  withBuiltInFactionDefaults,
  type CardDefinition,
  type PlayerId,
  type SpoilsEngine
} from "../../../engine.js";

const STAPLE_NAMES = ["Obsession", "Greed", "Elitism", "Deception", "Rage"] as const;

const staple = (name: string): CardDefinition => {
  const card = CARD_CATALOG.find(c => c.type === "resource" && c.name === name && isStapleResourceDefinition(c));
  assert.ok(card, `${name} is a staple in the catalog`);
  return card;
};
const characters = CARD_CATALOG.filter(c => c.type === "character" && getMaxCopies(c) === 4);
const factions = CARD_CATALOG.filter(c => c.type === "faction");
const P1_ID = "p1" as PlayerId;
const P2_ID = "p2" as PlayerId;

/**
 * The resources a faction's printed STARTING RESOURCES name outright, with the copies it names,
 * read from the faction data (the `slots` names, `chosenStaples.plus`, or flat `names`).
 */
function requiredCopies(faction: CardDefinition): Map<string, number> {
  const rule = withBuiltInFactionDefaults(faction).faction!.setup.startingResources;
  const names = rule.slots?.length
    ? rule.slots.flatMap(slot => (slot.kind === "resource" && slot.name ? [slot.name] : []))
    : rule.chosenStaples
      ? (rule.chosenStaples.plus ?? [])
      : (rule.names ?? []);
  const copies = new Map<string, number>();
  for (const name of names) copies.set(name, (copies.get(name) ?? 0) + 1);
  return copies;
}

/** The unnamed staple slots of a faction's rule ("1 staple resource"; the Union's X staples at the smallest X). */
function stapleSlotCount(faction: CardDefinition): number {
  const rule = withBuiltInFactionDefaults(faction).faction!.setup.startingResources;
  if (rule.slots?.length) return rule.slots.filter(slot => slot.kind === "resource" && slot.staple && !slot.name).length;
  return rule.chosenStaples?.min ?? 0;
}

/**
 * A decklist for `faction` (faction card first): `have[name]` copies of each staple (5 by default),
 * padded with filler characters up to the faction's printed minimum deck size.
 */
function deckFor(faction: CardDefinition, have: Partial<Record<string, number>> = {}): CardDefinition[] {
  const cards: CardDefinition[] = [faction];
  for (const name of STAPLE_NAMES) {
    for (let i = 0; i < (have[name] ?? 5); i++) cards.push(staple(name));
  }
  const minimum = getMinimumDeckSize(faction) ?? 0;
  for (let i = 0; cards.length - 1 < minimum; i++) cards.push(characters[Math.floor(i / 4)]!);
  return cards;
}

const OPPONENT = factions.find(c => c.name === "The Tournament Faction")!;

function setupGame(
  deckA: CardDefinition[],
  deckB: CardDefinition[] = deckFor(OPPONENT),
  options: { x?: number; interactive?: boolean } = {}
): SpoilsEngine {
  const [factionA, ...bodyA] = deckA;
  const [factionB, ...bodyB] = deckB;
  const flipsTo = factionA!.faction?.flipsTo ? CARD_CATALOG.filter(c => c.id === factionA!.faction!.flipsTo) : [];
  const definitions = [...new Map([...deckA, ...deckB, ...flipsTo].map(c => [c.id, c])).values()];
  return createTwoPlayerFactionGame(
    definitions,
    { id: P1_ID, name: "A", factionDefinitionId: factionA!.id, deckDefinitionIds: bodyA.map(c => c.id) },
    { id: P2_ID, name: "B", factionDefinitionId: factionB!.id, deckDefinitionIds: bodyB.map(c => c.id) },
    {
      firstPlayerId: P1_ID,
      seed: 7,
      chooseStartingResources: options.interactive,
      ...(options.x === undefined ? {} : { startingResourceX: { [P1_ID]: options.x, [P2_ID]: options.x } })
    }
  );
}

/** Answers every `chooseStartingResources` seat with the first candidates the engine offers. */
function answerStartingChoices(engine: SpoilsEngine): void {
  for (let guard = 0; engine.state.setup.phase === "chooseStartingResources" && guard < 10; guard++) {
    const playerId = engine.state.setup.order[engine.state.setup.currentIndex]!;
    const choice = engine.getStartingResourceChoice(playerId);
    assert.ok(choice, "the seat to choose has a choice to make");
    const picks: string[] = [];
    const kinds = new Set<string>();
    const pickFrom = (candidates: readonly string[]): void => {
      const id = candidates.find(
        candidate => !picks.includes(candidate) && !(choice.distinct && kinds.has(engine.getDefinition(candidate).id))
      );
      assert.ok(id, "the engine offers a card to pick");
      picks.push(id);
      kinds.add(engine.getDefinition(id).id);
    };
    if (choice.slots) for (const slot of choice.slots) pickFrom(slot.candidateCardIds);
    else for (let i = 0; i < choice.count; i++) pickFrom(choice.candidateCardIds);
    engine.perform({ type: "chooseStartingResources", playerId, cardIds: picks });
  }
}

const inPlayNames = (engine: SpoilsEngine, playerId: PlayerId): string[] =>
  engine.state.players[playerId].play
    .filter(id => engine.getDefinition(id).type !== "faction")
    .map(id => engine.getDefinition(id).name)
    .sort();

describe("faction STARTING RESOURCES names match the printed text", () => {
  test("every faction printing's required resources are exactly the ones its printed rule names, with their counts", () => {
    assert.ok(factions.length >= 28, "the sweep covers every faction printing");
    for (const faction of factions) {
      // A double-sided faction's other side prints no rules text of its own.
      const data = withBuiltInFactionDefaults(faction).faction!;
      const printedOn = data.setup.startsFlipped ? CARD_CATALOG.find(c => c.id === data.flipsTo)! : faction;
      // The Slightly Less Evil Alliance prints no STARTING RESOURCES rule: it names nothing.
      const segment = /STARTING RESOURCES([\s\S]*?)STARTING DRAW/.exec(printedOn.text)?.[1] ?? "";
      const printed = new Map<string, number>();
      for (const match of segment.matchAll(/(\d+)\s+(?:face-down\s+)?(Obsession|Greed|Elitism|Deception|Rage)\b/gi)) {
        const name = STAPLE_NAMES.find(n => n.toLowerCase() === match[2]!.toLowerCase())!;
        printed.set(name, (printed.get(name) ?? 0) + Number(match[1]));
      }
      assert.deepEqual(
        [...requiredCopies(faction)].sort(),
        [...printed].sort(),
        `${faction.name} (${faction.set}): data requires what the text names`
      );
    }
  });
});

describe("a deck missing a resource its faction's STARTING RESOURCES names is flagged", () => {
  test("the Union of Unextraordinary Miners with no Deception (the reported case)", () => {
    const union = factions.find(c => c.name === "The Union of Unextraordinary Miners")!;
    const deck = deckFor(union, { Deception: 0 });
    const issues = findDeckConstructionIssues(deck);
    assert.deepEqual(issues.map(i => i.kind), ["factionRule"], "one faction-rule issue");
    assert.match(issues[0]!.message, /Union of Unextraordinary Miners.*1 Deception.*missing 1 Deception/);
    assert.throws(() => setupGame(deck), /no matching starting resource 'Deception'/, "setup cannot start it");
    assert.deepEqual(findDeckConstructionIssues(deckFor(union)), [], "with Deception it is a legal deck");
  });

  for (const faction of factions) {
    const required = requiredCopies(faction);
    const label = `${faction.name} (${faction.set})`;

    test(`${label}: validation flags each missing required resource and setup runs once they are present`, () => {
      const full = deckFor(faction);
      assert.deepEqual(findDeckConstructionIssues(full), [], `${label}: the full deck is constructible`);
      for (const mode of [false, true]) {
        const engine = setupGame(full, deckFor(OPPONENT), { interactive: mode });
        answerStartingChoices(engine);
        assert.notEqual(engine.state.setup.phase, "chooseStartingResources", `${label}: setup got past the staple choice`);
        if (required.size > 0) {
          const played = inPlayNames(engine, P1_ID);
          for (const [name, copies] of required) {
            assert.ok(
              played.filter(played => played === name).length >= copies,
              `${label}: ${copies} ${name} in play (interactive ${mode}): ${played.join(", ")}`
            );
          }
        }
      }

      for (const [name, copies] of required) {
        for (const have of new Set([0, copies - 1])) {
          const deficient = deckFor(faction, { [name]: have });
          const issues = findDeckConstructionIssues(deficient);
          assert.deepEqual(
            issues.map(i => i.kind),
            ["factionRule"],
            `${label}: ${have} of ${copies} ${name} is the only problem with the deck`
          );
          assert.match(issues[0]!.message, new RegExp(`missing ${copies - have} ${name}`), `${label}: the message names what is missing`);
        }
      }

      // Each staple slot is a different card from the named resources: the named copies alone are one staple short.
      const slots = stapleSlotCount(faction);
      if (slots > 0) {
        const spare = STAPLE_NAMES.find(name => !required.has(name))!;
        const have = (spares: number) => ({
          ...Object.fromEntries(STAPLE_NAMES.map(name => [name, required.get(name) ?? 0])),
          [spare]: spares
        });
        const short = findDeckConstructionIssues(deckFor(faction, have(slots - 1)));
        assert.deepEqual(short.map(i => i.kind), ["factionRule"], `${label}: one staple short is the only problem`);
        assert.match(short[0]!.message, /missing 1 staple resource/, `${label}: the message names the staple`);
        const enough = deckFor(faction, have(slots));
        assert.deepEqual(findDeckConstructionIssues(enough), [], `${label}: exactly enough staples is constructible`);
        const engine = setupGame(enough);
        const total = [...required.values()].reduce((sum, copies) => sum + copies, 0) + slots;
        assert.equal(inPlayNames(engine, P1_ID).length, total, `${label}: every named and staple slot is filled`);
      }
    });
  }
});

describe("what setup can carry out as far as the deck allows is not required", () => {
  test("Hall of Great Justice (1 Rage, 1 staple resource): a lone Rage is one staple short, refused by both", () => {
    const hall = factions.find(c => c.name === "Hall of Great Justice")!;
    const deck = [hall, staple("Rage"), ...characters.slice(0, 20).flatMap(c => [c, c, c, c])];
    const issues = findDeckConstructionIssues(deck);
    assert.deepEqual(issues.map(i => i.kind), ["factionRule"]);
    assert.match(issues[0]!.message, /Hall of Great Justice.*1 Rage and 1 staple resource.*missing 1 staple resource/);
    assert.throws(() => setupGame(deck), /no matching starting resource/, "setup cannot start it");
    assert.deepEqual(findDeckConstructionIssues([...deck, staple("Rage")]), [], "a second Rage fills the staple slot");
  });

  test("The Society of Magical Propriety with no resource at all is legal; setup (both modes) puts one card face-down", () => {
    const society = factions.find(c => c.name === "The Society of Magical Propriety")!;
    const body = Array.from({ length: 300 }, (_, i) => characters[Math.floor(i / 4)]!);
    const deck = [society, ...body];
    assert.deepEqual(findDeckConstructionIssues(deck), [], "no resource is needed");
    for (const interactive of [false, true]) {
      const engine = setupGame(deck, deckFor(OPPONENT), { interactive });
      answerStartingChoices(engine);
      const inPlay = engine.state.players[P1_ID].play.filter(id => engine.getDefinition(id).type !== "faction");
      assert.equal(inPlay.length, 1, `interactive ${interactive}: only the Any-1-card slot is filled`);
      assert.equal(engine.state.cards[inPlay[0]!]!.faceDown, true, "a non-resource card goes into play face-down");
    }
  });

  test("a flat staple faction (Any 2 staple resources) with one staple is legal", () => {
    const tournament = factions.find(c => c.name === "The Tournament Faction")!;
    const deck = [tournament, staple("Rage"), ...characters.slice(0, 20).flatMap(c => [c, c, c, c])];
    assert.deepEqual(findDeckConstructionIssues(deck), []);
    assert.deepEqual(inPlayNames(setupGame(deck), P1_ID), ["Rage"]);
  });
});

describe("The Union of Unextraordinary Miners: X staples and 1 Deception", () => {
  const union = factions.find(c => c.name === "The Union of Unextraordinary Miners")!;

  test("every X the player may choose starts, for a deck holding only the required Deception and one staple", () => {
    const minimal = [union, staple("Deception"), staple("Rage"), ...characters.slice(0, 5).flatMap(c => [c, c, c, c])];
    assert.deepEqual(findDeckConstructionIssues(minimal), []);
    for (let x = 1; x <= 10; x++) {
      for (const interactive of [false, true]) {
        const engine = setupGame(minimal, deckFor(OPPONENT), { x, interactive });
        answerStartingChoices(engine);
        assert.deepEqual(inPlayNames(engine, P1_ID), ["Deception", "Rage"], `X=${x}, interactive ${interactive}: as many as the deck has`);
      }
    }
  });

  test("the Deception comes from outside the X staples, wherever it sits in the deck", () => {
    for (const order of [
      [staple("Deception"), staple("Rage"), staple("Rage")],
      [staple("Rage"), staple("Rage"), staple("Deception")]
    ]) {
      for (const interactive of [false, true]) {
        const deck = [union, ...order, ...characters.slice(0, 5).flatMap(c => [c, c, c, c])];
        const engine = setupGame(deck, deckFor(OPPONENT), { x: 2, interactive });
        answerStartingChoices(engine);
        assert.deepEqual(
          inPlayNames(engine, P1_ID),
          ["Deception", "Rage", "Rage"],
          `a lone Deception first or last (interactive ${interactive}): 2 staples and the Deception`
        );
      }
    }
  });

  test("an opponent with fewer staples than the top-up needs is topped up as far as possible", () => {
    const opponent = [OPPONENT, staple("Rage"), ...characters.slice(0, 5).flatMap(c => [c, c, c, c])];
    const engine = setupGame(deckFor(union), opponent, { x: 6 });
    assert.equal(engine.state.players[P1_ID].play.filter(id => engine.getDefinition(id).type === "resource").length, 7, "7 for the Union");
    assert.deepEqual(inPlayNames(engine, P2_ID), ["Rage"], "the opponent has only the one staple it can supply");
  });
});
