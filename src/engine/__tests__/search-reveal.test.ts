// "Search your deck for a tactic and reveal it" — the `revealCards` effect
// shows the picked cards (a `cardsRevealed` event) between the pick and the
// move, and which printings carry it follows each printing's printed text.
//
// Part 1 proves the effect against synthetic fixtures; part 2 checks the real
// catalog's per-printing data.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import cardsJson from "../../data/cards.js";
import { createTwoPlayerFactionGame } from "../../engine.js";
import type { CardDefinition, Effect, GameEvent } from "../../engine.js";

type Built = ReturnType<typeof buildGame>;

function revealEvents(engine: Built["engine"]): Extract<GameEvent, { type: "cardsRevealed" }>[] {
  return engine
    .getLog()
    .flatMap(entry => (entry.event?.type === "cardsRevealed" ? [entry.event] : []));
}

/** Log position of the first event matching `predicate`, or -1. */
function logIndex(engine: Built["engine"], predicate: (event: GameEvent) => boolean): number {
  return engine.getLog().findIndex(entry => entry.event !== undefined && predicate(entry.event));
}

/** "Search your deck for a tactic[, reveal it,] and put it into your hand" as a tactic body. */
function tutor(options: { reveal?: Partial<Extract<Effect, { type: "revealCards" }>> | false; owner?: "self" | "opponent" } = {}): CardDefinition {
  const reveal: Effect[] =
    options.reveal === false
      ? []
      : [{ type: "revealCards", selected: "found", ...options.reveal } as Effect];
  return tactic({
    name: "Tutor",
    behavior: {
      abilities: [
        {
          id: "tutor",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: {
                id: "found",
                selector: { owner: options.owner ?? "self", zone: "deck", type: "tactic" },
                count: 1,
                optional: true
              },
              effects: [
                ...reveal,
                { type: "moveCard", target: { type: "selected", id: "found" }, to: "hand" }
              ]
            }
          ]
        }
      ]
    }
  });
}

function playAndPick(built: Built, spell: string, picks: string[]): void {
  const { engine, id } = built;
  engine.perform({ type: "playCard", playerId: P1, cardId: id(spell) });
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
  engine.perform({
    type: "resolvePendingChoice",
    playerId: P1,
    choice: { kind: "chooserSelectsTarget", selected: picks.map(key => id(key)) }
  });
  resolvePendingResponses(engine);
}

describe("revealCards: search and reveal", () => {
  test("a search shows the picked card to everyone, from the deck, before it reaches hand", () => {
    const built = buildGame({
      cards: [
        { key: "spell", def: tutor(), owner: P1, zone: "hand" },
        { key: "target", def: tactic({ name: "Buried Tactic" }), owner: P1, zone: "deck" },
        { key: "filler", def: tactic({ name: "Filler Tactic" }), owner: P1, zone: "deck" }
      ]
    });
    playAndPick(built, "spell", ["target"]);
    const { engine, id } = built;

    const events = revealEvents(engine);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].cardIds, [id("target")]);
    assert.equal(events[0].zone, "deck");
    assert.equal(events[0].ownerId, P1);
    assert.equal(events[0].viewerId, "all");
    assert.equal(events[0].byCardId, id("spell"));

    assert.ok(engine.state.players[P1].hand.includes(id("target")));
    const revealedAt = logIndex(engine, e => e.type === "cardsRevealed");
    const movedAt = logIndex(engine, e => e.type === "cardMoved" && e.cardId === id("target") && e.to === "hand");
    assert.ok(revealedAt >= 0 && movedAt > revealedAt, "revealed while still in the deck, then moved");

    const entry = engine.getLog().find(e => e.event?.type === "cardsRevealed");
    assert.match(entry!.message, /Alice reveals Buried Tactic from deck/);
  });

  test("the same search without the effect emits nothing (a printing that does not say reveal)", () => {
    const built = buildGame({
      cards: [
        { key: "spell", def: tutor({ reveal: false }), owner: P1, zone: "hand" },
        { key: "target", def: tactic({ name: "Buried Tactic" }), owner: P1, zone: "deck" }
      ]
    });
    playAndPick(built, "spell", ["target"]);

    assert.equal(revealEvents(built.engine).length, 0);
    assert.ok(built.engine.state.players[P1].hand.includes(built.id("target")));
  });

  test("declining an optional search reveals nothing", () => {
    const built = buildGame({
      cards: [
        { key: "spell", def: tutor(), owner: P1, zone: "hand" },
        { key: "target", def: tactic({ name: "Buried Tactic" }), owner: P1, zone: "deck" }
      ]
    });
    playAndPick(built, "spell", []);

    assert.equal(revealEvents(built.engine).length, 0);
    assert.ok(built.engine.state.players[P1].deck.includes(built.id("target")));
  });

  test("a search that finds nothing to pick never opens a choice or a reveal", () => {
    const built = buildGame({ cards: [{ key: "spell", def: tutor(), owner: P1, zone: "hand" }] });
    built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("spell") });
    resolvePendingResponses(built.engine);

    assert.equal(built.engine.state.pendingChoice, undefined);
    assert.equal(revealEvents(built.engine).length, 0);
  });

  test("several picks are shown in one event", () => {
    const spell = tactic({
      name: "Double Tutor",
      behavior: {
        abilities: [
          {
            id: "double",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: { id: "found", selector: { owner: "self", zone: "deck" }, count: 2 },
                effects: [
                  { type: "revealCards", selected: "found" },
                  {
                    type: "forEach",
                    selected: "found",
                    effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }]
                  }
                ]
              }
            ]
          }
        ]
      }
    });
    const built = buildGame({
      cards: [
        { key: "spell", def: spell, owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P1, zone: "deck" },
        { key: "b", def: character({ name: "B" }), owner: P1, zone: "deck" }
      ]
    });
    playAndPick(built, "spell", ["a", "b"]);

    const events = revealEvents(built.engine);
    assert.equal(events.length, 1);
    assert.deepEqual([...events[0].cardIds].sort(), [built.id("a"), built.id("b")].sort());
  });

  test("viewer names who is entitled to look", () => {
    const built = buildGame({
      cards: [
        { key: "spell", def: tutor({ reveal: { viewer: "opponent" } }), owner: P1, zone: "hand" },
        { key: "target", def: tactic({ name: "Buried Tactic" }), owner: P1, zone: "deck" }
      ]
    });
    playAndPick(built, "spell", ["target"]);

    assert.equal(revealEvents(built.engine)[0].viewerId, P2);
  });

  test("searching the opponent's deck reports the opponent as the owner", () => {
    const built = buildGame({
      cards: [
        { key: "spell", def: tutor({ owner: "opponent" }), owner: P1, zone: "hand" },
        { key: "theirs", def: tactic({ name: "Their Tactic" }), owner: P2, zone: "deck" }
      ]
    });
    playAndPick(built, "spell", ["theirs"]);

    const [event] = revealEvents(built.engine);
    assert.equal(event.ownerId, P2);
    assert.equal(event.zone, "deck");
  });

  test("a reveal spanning two owners is one event per owner", () => {
    const spell = tactic({
      name: "Fair Share",
      behavior: {
        abilities: [
          {
            id: "share",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: { id: "found", selector: { zone: "deck" }, count: 2 },
                effects: [{ type: "revealCards", selected: "found" }]
              }
            ]
          }
        ]
      }
    });
    const built = buildGame({
      cards: [
        { key: "spell", def: spell, owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "deck" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "deck" }
      ]
    });
    playAndPick(built, "spell", ["mine", "theirs"]);

    const events = revealEvents(built.engine);
    assert.deepEqual(events.map(e => e.ownerId).sort(), [P1, P2]);
    for (const event of events) assert.equal(event.cardIds.length, 1);
  });

  test("a triggered ability's own deck pick is revealed once the pick is made (targets-shaped search)", () => {
    const centipede = character({
      name: "Centipede",
      behavior: {
        abilities: [
          {
            id: "centipede-search",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            targets: [
              { id: "target", selector: { controller: "self", zone: "deck", type: "tactic" }, count: 1, optional: true }
            ],
            effects: [
              {
                type: "if",
                condition: { type: "targetExists", target: { type: "selected", id: "target" } },
                effects: [
                  { type: "revealCards", selected: "target" },
                  { type: "moveCard", target: { type: "selected", id: "target" }, to: "hand" }
                ]
              }
            ]
          }
        ]
      }
    });
    const built = buildGame({
      cards: [
        { key: "centipede", def: centipede, owner: P1, zone: "hand" },
        { key: "buried", def: tactic({ name: "Buried Tactic" }), owner: P1, zone: "deck" }
      ]
    });
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("centipede") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "selectTargets");
    assert.equal(revealEvents(engine).length, 0, "nothing is shown before the pick is made");

    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { target: [id("buried")] } }
    });
    resolvePendingResponses(engine);

    const [event] = revealEvents(engine);
    assert.deepEqual(event.cardIds, [id("buried")]);
    assert.equal(event.byCardId, id("centipede"));
    assert.ok(engine.state.players[P1].hand.includes(id("buried")));
  });

  test("a selector reveals every matching card, not just the one kept (\"reveal all copies\")", () => {
    const spell = tactic({
      name: "Copies",
      behavior: {
        abilities: [
          {
            id: "copies",
            type: "activated",
            effects: [{ type: "revealCards", selector: { owner: "self", zone: "deck", name: "Twin" } }]
          }
        ]
      }
    });
    const twin = character({ name: "Twin" });
    const built = buildGame({
      cards: [
        { key: "spell", def: spell, owner: P1, zone: "hand" },
        { key: "t1", def: twin, owner: P1, zone: "deck" },
        { key: "t2", def: twin, owner: P1, zone: "deck" },
        { key: "other", def: character({ name: "Other" }), owner: P1, zone: "deck" }
      ]
    });
    built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("spell") });
    resolvePendingResponses(built.engine);

    const events = revealEvents(built.engine);
    assert.equal(events.length, 1);
    assert.deepEqual([...events[0].cardIds].sort(), [built.id("t1"), built.id("t2")].sort());
  });
});

describe("faction startingDrawSearch.reveal", () => {
  function play(reveal: boolean) {
    const faction = factionCard({
      name: "SearchDrawFaction",
      faction: defaultFactionDefinition({
        setup: {
          startingResources: { count: 2, stapleOnly: true },
          startingDrawSearch: {
            selector: { controller: "self", zone: "deck", type: "resource", staple: true },
            ...(reveal ? { reveal: true } : {})
          },
          openingHand: { goingFirst: 0, goingSecond: 0 }
        }
      })
    });
    const rage = resourceCard({ id: "sr-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
    const greed = resourceCard({ id: "sr-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });
    return createTwoPlayerFactionGame(
      [faction, rage, greed],
      { id: P1, name: "Alice", deckDefinitionIds: [faction.id, rage.id, rage.id, greed.id] },
      { id: P2, name: "Bob", deckDefinitionIds: [faction.id, rage.id, rage.id, greed.id] },
      { firstPlayerId: P1 }
    );
  }

  test("a flagged starting search shows the fetched staple to everyone", () => {
    const engine = play(true);
    const events = revealEvents(engine);
    assert.equal(events.length, 2, "one per player");
    const mine = events.find(e => e.ownerId === P1)!;
    assert.equal(mine.viewerId, "all");
    assert.equal(mine.zone, "deck");
    assert.deepEqual(mine.cardIds, engine.state.players[P1].hand);
  });

  test("an unflagged starting search stays private", () => {
    const engine = play(false);
    assert.equal(revealEvents(engine).length, 0);
    assert.equal(engine.state.players[P1].hand.length, 1);
  });
});

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
  faction?: { setup?: { startingDrawSearch?: { reveal?: boolean } } };
}

const catalog = readJson("data/cards.json") as CatalogCard[];
const corrections = readJson("data/card-audit/corrections.json") as Record<string, { text?: string }>;

/** The text printed on this printing's own card: the audit correction when there is one. */
const printedText = (card: CatalogCard): string => corrections[card.id]?.text ?? card.text ?? "";

/** A search sentence that also reveals what it found ("...for a tactic, reveal it, and ..."). */
function printedSearchReveals(text: string): boolean {
  const segments = text.split(/(?<=[.!?])\s+|\s--\s/);
  return segments.some(
    (segment, i) =>
      /search/i.test(segment) &&
      (/reveal/i.test(segment) || /reveal (it|them|the card)/i.test(segments[i + 1] ?? ""))
  );
}

const hasRevealEffect = (card: CatalogCard): boolean =>
  JSON.stringify([card.behavior, card.faction]).includes('"type":"revealCards"') ||
  card.faction?.setup?.startingDrawSearch?.reveal === true;

describe("search-and-reveal data follows each printing's printed text", () => {
  test("every printing that carries revealCards prints a reveal", () => {
    const wrong = catalog
      .filter(hasRevealEffect)
      .filter(card => !/reveal/i.test(printedText(card)))
      .map(card => `${card.name} (${card.set}) ${card.id}`);
    assert.deepEqual(wrong, []);
  });

  test("every printing whose search sentence prints a reveal carries the effect", () => {
    const missing = catalog
      .filter(card => card.behavior || card.faction)
      .filter(card => printedSearchReveals(printedText(card)))
      .filter(card => !hasRevealEffect(card))
      .map(card => `${card.name} (${card.set}) ${card.id}`);
    assert.deepEqual(missing, []);
  });

  test("each revealCards names a declaration or selector that exists", () => {
    const problems: string[] = [];
    for (const card of catalog) {
      const json = JSON.stringify([card.behavior, card.faction]);
      for (const match of json.matchAll(/"type":"revealCards"(?:,"selected":"([^"]+)")?/g)) {
        const id = match[1];
        if (id === undefined) continue;
        if (!json.includes(`"id":"${id}"`)) problems.push(`${card.name} (${card.set}): no declaration '${id}'`);
      }
    }
    assert.deepEqual(problems, []);
  });

  test("reprints differ where the printed text differs (Master Ritualist)", () => {
    const byEdition = (set: string) => catalog.find(c => c.name === "Master Ritualist" && c.set === set)!;
    assert.equal(hasRevealEffect(byEdition("1st Edition")), true, "1st Edition: \"reveal it\"");
    assert.equal(hasRevealEffect(byEdition("Open Beta")), false, "Open Beta: no reveal");
  });

  /** Plays the real printing's QUOTIDIAN INSTRUCTION and returns what the engine revealed. */
  function ritualistReveals(set: string) {
    const printing = catalog.find(c => c.name === "Master Ritualist" && c.set === set)!;
    const definition = (cardsJson as CardDefinition[]).find(c => c.id === printing.id)!;
    const built = buildGame({
      cards: [
        { key: "ritualist", def: structuredClone(definition), owner: P1, zone: "play" },
        { key: "target", def: tactic({ name: "Buried Tactic" }), owner: P1, zone: "deck" }
      ]
    });
    const { engine, id } = built;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ritualist"), abilityId: "qi" });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: [id("target")] }
    });
    resolvePendingResponses(engine);
    assert.ok(engine.state.players[P1].hand.includes(id("target")));
    return { events: revealEvents(engine), target: id("target") };
  }

  test("the 1st Edition Master Ritualist reveals the tactic it finds; the Open Beta one does not", () => {
    const first = ritualistReveals("1st Edition");
    assert.equal(first.events.length, 1);
    assert.deepEqual(first.events[0].cardIds, [first.target]);
    assert.equal(first.events[0].viewerId, "all");

    assert.equal(ritualistReveals("Open Beta").events.length, 0);
  });

  test("a targets-shaped printing (Servile Centipede) reveals once its pick is made", () => {
    const printing = catalog.find(c => c.name === "Servile Centipede" && c.set === "2nd Edition")!;
    const definition = (cardsJson as CardDefinition[]).find(c => c.id === printing.id)!;
    const { engine, id } = buildGame({
      cards: [
        // Free to deploy: only the search behavior is under test.
        { key: "centipede", def: { ...structuredClone(definition), cost: 0, threshold: 0 }, owner: P1, zone: "hand" },
        { key: "target", def: tactic({ name: "Buried Tactic" }), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("centipede") });
    resolvePendingResponses(engine);
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "selectTargets", selected: { target: [id("target")] } }
    });
    resolvePendingResponses(engine);

    const [event] = revealEvents(engine);
    assert.deepEqual(event.cardIds, [id("target")]);
    assert.ok(engine.state.players[P1].hand.includes(id("target")));
  });
});
