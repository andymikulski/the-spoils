// Batch r07-zones-actions, part 2 (docs/TESTING.md): CR 306 Draw, CR 307 Duplicate, CR 308 Free, CR 310 Pick,
// CR 311 Provides. Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, Effect, GameEvent, SpoilsEngine, TargetDeclaration } from "../../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

const pick = (id: string) => ({ type: "selected" as const, id });

/** A zero-cost tactic whose single ability runs `effects`. */
const spell = (name: string, effects: Effect[], targets: TargetDeclaration[] = []): CardDefinition =>
  tactic({ name, behavior: { abilities: [{ id: "a", type: "activated", targets, effects }] } });

const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;
const events = (engine: SpoilsEngine, type: GameEvent["type"]) =>
  engine.getLog().filter(entry => entry.event?.type === type).map(entry => entry.event!);
const answer = (engine: SpoilsEngine, playerId: string, choice: Record<string, unknown>) =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);

/** Plays `spellKey` as `player` (default P1) and settles every window. */
function cast(built: ReturnType<typeof buildGame>, spellKey: string, selected: Record<string, string[]> = {}, player = P1): void {
  built.engine.perform({ type: "playCard", playerId: player, cardId: built.id(spellKey), selected });
  resolvePendingResponses(built.engine);
  assert.equal(built.engine.state.pendingChoice, undefined, "the spell needed no further answer");
}

/** `n` named cards in `owner`'s deck, `${prefix}0` on top. */
const deckOf = (n: number, owner = P1, prefix = "d"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "deck" as const }));

const rageBank = (n: number, owner = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `rage${owner}${i}`, def: resourceCard({ name: `Rage${owner}${i}` }), owner }));

describe("CR 306 — draw", () => {
  rule("CR 306.1", "drawing puts the TOP card of the deck into the hand (one card: the next one stays on top)", () => {
    const built = buildGame({ cards: [{ key: "draw", def: spell("Draw1", [{ type: "draw", player: "controller", amount: 1 }]), owner: P1, zone: "hand" }, ...deckOf(4)] });
    const { engine, id } = built;
    assert.equal(engine.state.players[P1].deck[0], id("d0"), "d0 is the top card");
    cast(built, "draw");
    assert.ok(engine.state.players[P1].hand.includes(id("d0")), "the top card is now in hand");
    assert.equal(zone(engine, id("d0")), "hand");
    assert.equal(engine.state.players[P1].deck[0], id("d1"), "the next card is the new top");
    assert.equal(engine.state.players[P1].deck.length, 3);
  });

  rule("CR 306.1", "drawing several cards takes them from the top in order", () => {
    const built = buildGame({ cards: [{ key: "draw", def: spell("Draw3", [{ type: "draw", player: "controller", amount: 3 }]), owner: P1, zone: "hand" }, ...deckOf(5)] });
    const { engine, id } = built;
    cast(built, "draw");
    for (const key of ["d0", "d1", "d2"]) assert.equal(zone(engine, id(key)), "hand", `${key} was drawn`);
    for (const key of ["d3", "d4"]) assert.equal(zone(engine, id(key)), "deck", `${key} was not drawn`);
    assert.equal(engine.state.players[P1].deck[0], id("d3"));
  });

  rule("CR 306.1", "only the drawing player's deck is touched: the opponent's deck and hand are unchanged", () => {
    const built = buildGame({
      cards: [{ key: "draw", def: spell("Draw1", [{ type: "draw", player: "controller", amount: 1 }]), owner: P1, zone: "hand" }, ...deckOf(2), ...deckOf(2, P2, "o")]
    });
    const { engine } = built;
    const theirs = [...engine.state.players[P2].deck];
    cast(built, "draw");
    assert.deepEqual(engine.state.players[P2].deck, theirs, "the opponent's deck is unchanged");
    assert.equal(engine.state.players[P2].hand.length, 0);
  });

  rule("CR 306.2", "if the deck has fewer cards than the draw asks for, the player draws what is there and does not lose", () => {
    const built = buildGame({ cards: [{ key: "draw", def: spell("Draw5", [{ type: "draw", player: "controller", amount: 5 }]), owner: P1, zone: "hand" }, ...deckOf(2)] });
    const { engine, id } = built;
    const handBefore = engine.state.players[P1].hand.length - 1; // the spell leaves the hand
    cast(built, "draw");
    assert.equal(engine.state.players[P1].deck.length, 0, "the deck is empty");
    assert.equal(engine.state.players[P1].hand.length, handBefore + 2, "only the two cards that existed were drawn");
    assert.ok(engine.state.players[P1].hand.includes(id("d0")) && engine.state.players[P1].hand.includes(id("d1")), "both are in hand");
    assert.equal(engine.state.winner, undefined, "the game is still on");
  });

  rule("CR 306.2", "drawing from an empty deck draws nothing, does not lose, and the player can keep acting", () => {
    const built = buildGame({
      cards: [
        { key: "draw", def: spell("Draw1", [{ type: "draw", player: "controller", amount: 1 }]), owner: P1, zone: "hand" },
        { key: "next", def: spell("Next", []), owner: P1, zone: "hand" }
      ]
    });
    const { engine } = built;
    const hand = engine.state.players[P1].hand.length;
    cast(built, "draw");
    assert.equal(engine.state.players[P1].hand.length, hand - 1, "nothing was drawn");
    assert.equal(engine.state.winner, undefined, "no loss for running out of cards");
    cast(built, "next");
    assert.equal(zone(engine, built.id("next")), "discard", "the player could keep playing");
  });

  rule("CR 306.2", "a player with exactly enough cards draws them all and the empty deck is not a loss", () => {
    const built = buildGame({ cards: [{ key: "draw", def: spell("Draw2", [{ type: "draw", player: "controller", amount: 2 }]), owner: P1, zone: "hand" }, ...deckOf(2)] });
    cast(built, "draw");
    assert.equal(built.engine.state.players[P1].deck.length, 0);
    assert.equal(built.engine.state.winner, undefined);
    assert.equal(events(built.engine, "cardsDrawn").length, 1);
  });

  rule("CR 306.3", "'draw 2 cards' is one group draw: one cardsDrawn event for 2 cards, so a trigger fires once", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "w", type: "triggered", event: "cardsDrawn", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
    });
    const built = buildGame({
      cards: [
        { key: "watch", def: watcher, owner: P1 },
        { key: "draw", def: spell("Draw2", [{ type: "draw", player: "controller", amount: 2 }]), owner: P1, zone: "hand" },
        ...deckOf(4)
      ]
    });
    const before = built.engine.state.players[P1].influence;
    cast(built, "draw");
    const drawn = events(built.engine, "cardsDrawn");
    assert.equal(drawn.length, 1, "a single draw event");
    assert.equal((drawn[0] as { count: number }).count, 2, "covering both cards");
    assert.equal(built.engine.state.players[P1].influence, before + 1, "the trigger fired once, not twice");
  });

  rule("CR 306.3", "two separate 'draw a card' instructions are two draw events (control for the group draw)", () => {
    const watcher = character({
      name: "Watcher",
      behavior: { abilities: [{ id: "w", type: "triggered", event: "cardsDrawn", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] }
    });
    const built = buildGame({
      cards: [
        { key: "watch", def: watcher, owner: P1 },
        {
          key: "draw",
          def: spell("DrawTwice", [
            { type: "draw", player: "controller", amount: 1 },
            { type: "draw", player: "controller", amount: 1 }
          ]),
          owner: P1,
          zone: "hand"
        },
        ...deckOf(4)
      ]
    });
    const before = built.engine.state.players[P1].influence;
    cast(built, "draw");
    assert.equal(events(built.engine, "cardsDrawn").length, 2, "two events");
    assert.equal(built.engine.state.players[P1].influence, before + 2, "the trigger fired twice");
  });

  rule("CR 306.4", "a game in which both factions reach 0 influence at the same time is a draw", () => {
    const mutual = spell("Mutual", [
      {
        type: "simultaneousDamage",
        hits: [
          { target: { type: "factionOf", player: "controller" }, amount: 25 },
          { target: { type: "factionOf", player: "opponent" }, amount: 25 }
        ]
      }
    ]);
    const built = buildGame({ cards: [{ key: "m", def: mutual, owner: P1, zone: "hand" }] });
    cast(built, "m");
    assert.equal(built.engine.state.players[P1].influence, 0);
    assert.equal(built.engine.state.players[P2].influence, 0);
    assert.equal(built.engine.state.winner, "draw", "no winner: the game is a draw");
  });

  rule("CR 306.4", "only one faction reaching 0 is a win for the other player, not a draw (control)", () => {
    const strike = spell("Strike", [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 25 }]);
    const built = buildGame({ cards: [{ key: "s", def: strike, owner: P1, zone: "hand" }] });
    cast(built, "s");
    assert.equal(built.engine.state.winner, P1, "P1 wins");
  });
});

describe("CR 307 — duplicate", () => {
  /** Cost 2, threshold R, extra cost "discard a card": the opponent's faction loses 2 influence. */
  const costly = (): CardDefinition =>
    tactic({
      name: "Costly",
      cost: 2,
      threshold: "r",
      behavior: {
        abilities: [
          {
            id: "c",
            type: "activated",
            costs: [{ type: "discard", id: "dc", player: "controller", selector: { zone: "hand" }, count: 1 }],
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }]
          }
        ]
      }
    });
  const replicate = (): CardDefinition =>
    tactic({ name: "Replicate", behavior: { abilities: [{ id: "r", type: "activated", effects: [{ type: "duplicate", target: "respondedToCard" }] }] } });

  /** P1 plays Costly (paying 2 rage + discarding `h`); P2, with no resources at all, holds Replicate and `fodder` cards. */
  const duelBoard = (p2Fodder: number) =>
    buildGame({
      cards: [
        { key: "costly", def: costly(), owner: P1, zone: "hand" },
        { key: "h", def: character({ name: "H" }), owner: P1, zone: "hand" },
        { key: "rep", def: replicate(), owner: P2, zone: "hand" },
        ...Array.from({ length: p2Fodder }, (_, i) => ({ key: `x${i}`, def: character({ name: `X${i}` }), owner: P2, zone: "hand" as const })),
        ...rageBank(2)
      ]
    });

  /** P1 plays Costly, P2 responds with Replicate; stops with Replicate resolving (its picks still to be answered). */
  function duplicateInResponse(built: ReturnType<typeof buildGame>): void {
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("costly"), selected: { dc: [id("h")] } });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("rep") });
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "advanceFlow" });
  }

  rule("CR 307.1", "a duplicate is an invisible copy: it has the original's effect and no new card appears", () => {
    const built = duelBoard(1);
    const { engine, id } = built;
    const cardCount = Object.keys(engine.state.cards).length;
    duplicateInResponse(built);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the copy asks its owner to pay the discard cost");
    assert.equal(engine.state.pendingChoice?.playerId, P2);
    answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id("x0")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 25 - 2, "the copy (controlled by P2) cost P1 2 influence");
    assert.equal(engine.state.players[P2].influence, 25 - 2, "and then the original cost P2 2 influence");
    assert.equal(Object.keys(engine.state.cards).length, cardCount, "no card instance was created for the copy");
  });

  rule("CR 307.1", "the copy's cost number is 0 and it needs no threshold: a player with no resources can duplicate a cost-2 threshold-R tactic", () => {
    const built = duelBoard(1);
    const { engine, id } = built;
    assert.equal(engine.getAvailableResourceCount(P2), 0, "P2 has no resources and no Rage");
    duplicateInResponse(built);
    answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id("x0")] });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 23, "the copy took effect anyway");
    assert.equal(engine.getAvailableResourceCount(P2), 0, "and spent nothing");
  });

  rule("CR 307.1", "the same player could NOT deploy the original: it needs its cost number and threshold (control)", () => {
    const built = buildGame({
      cards: [
        { key: "costly", def: costly(), owner: P2, zone: "hand" },
        { key: "x", def: character({ name: "X" }), owner: P2, zone: "hand" }
      ],
      activePlayerId: P2
    });
    refused(
      () => built.engine.perform({ type: "playCard", playerId: P2, cardId: built.id("costly"), selected: { dc: [built.id("x")] } }),
      "deploy a cost-2 threshold-R tactic with no resources"
    );
    assert.equal(zone(built.engine, built.id("costly")), "hand");
  });

  rule("CR 307.1", "the copy keeps the original's extra costs: its owner discards a card and the card goes to the discard pile", () => {
    const built = duelBoard(2);
    const { engine, id } = built;
    duplicateInResponse(built);
    answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id("x0")] });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("x0")), "discard", "the discard cost was paid again for the copy");
    assert.equal(zone(engine, id("x1")), "hand", "only one card was discarded");
    assert.equal(zone(engine, id("h")), "discard", "the original's own discard cost was paid too");
  });

  rule("CR 307.1", "if the copy's extra cost cannot be satisfied the duplicate is terminated: it has no effect and pays nothing", () => {
    const built = duelBoard(0);
    const { engine, id } = built;
    duplicateInResponse(built);
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined, "no prompt: there is nothing to discard");
    assert.equal(engine.state.players[P1].influence, 25, "the copy did nothing: P1 lost no influence");
    assert.equal(engine.state.players[P2].influence, 25 - 2, "the original still resolved");
    assert.equal(zone(engine, id("rep")), "discard", "Replicate itself resolved");
  });

  /** A modal tactic: option 0 costs the opponent 1 influence, option 1 costs them 4. */
  const modal = (): CardDefinition =>
    tactic({
      name: "Modal",
      behavior: {
        modes: [
          { label: "Small", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] },
          { label: "Big", effects: [{ type: "modifyInfluence", player: "opponent", amount: -4 }] }
        ]
      }
    });
  const modalBoard = () =>
    buildGame({
      cards: [
        { key: "modal", def: modal(), owner: P1, zone: "hand" },
        { key: "rep", def: replicate(), owner: P2, zone: "hand" }
      ]
    });
  function duplicateModal(built: ReturnType<typeof buildGame>, mode: number): void {
    const { engine, id } = built;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("modal"), mode });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("rep") });
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "advanceFlow" });
  }

  rule("CR 307.2", "a duplicate of a card with labelled options lets its owner choose a NEW option (the other one)", () => {
    const built = modalBoard();
    const { engine } = built;
    duplicateModal(built, 0);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "the duplicator is asked which option");
    assert.equal(engine.state.pendingChoice?.playerId, P2);
    answer(engine, P2, { kind: "chooserSelectsOption", index: 1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 25 - 4, "the copy used option 1 (Big) against P1");
    assert.equal(engine.state.players[P2].influence, 25 - 1, "the original still used its own option 0 (Small)");
  });

  rule("CR 307.2", "the duplicate's owner may also choose the same option as the original", () => {
    const built = modalBoard();
    const { engine } = built;
    duplicateModal(built, 1);
    answer(engine, P2, { kind: "chooserSelectsOption", index: 1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 25 - 4);
    assert.equal(engine.state.players[P2].influence, 25 - 4, "the original used option 1");
  });

  rule("CR 307.2", "the duplicate may choose the option the original did not, in either direction (original Big, copy Small)", () => {
    const built = modalBoard();
    const { engine } = built;
    duplicateModal(built, 1);
    answer(engine, P2, { kind: "chooserSelectsOption", index: 0 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 25 - 1, "the copy chose Small");
    assert.equal(engine.state.players[P2].influence, 25 - 4, "the original stayed Big");
  });

  /** P1's character "Echo" duplicates the last tactic P1 played; "Gag" bans P1 from playing tactics this turn. */
  const echoBoard = () =>
    buildGame({
      cards: [
        {
          key: "echo",
          def: character({ name: "Echo", behavior: { abilities: [{ id: "e", type: "activated", effects: [{ type: "duplicate", target: { type: "lastDeployedTactic" } }] }] } }),
          owner: P1
        },
        {
          key: "gag",
          def: character({
            name: "Gag",
            behavior: {
              abilities: [{ id: "g", type: "activated", effects: [{ type: "restrictPlay", player: "controller", kind: "cardType", cardType: "tactic", duration: { type: "untilEndOfTurn" } }] }]
            }
          }),
          owner: P1
        },
        { key: "ping", def: spell("Ping", [{ type: "modifyInfluence", player: "opponent", amount: -2 }]), owner: P1, zone: "hand" },
        { key: "late", def: spell("Late", []), owner: P1, zone: "hand" }
      ]
    });
  const activate = (built: ReturnType<typeof buildGame>, key: string, abilityId: string) => {
    built.engine.perform({ type: "activateAbility", playerId: P1, cardId: built.id(key), abilityId });
    resolvePendingResponses(built.engine);
  };

  rule("CR 307.3", "control: with no restriction, a duplicate made by an ability copies the tactic and takes effect", () => {
    const built = echoBoard();
    cast(built, "ping");
    assert.equal(built.engine.state.players[P2].influence, 23, "the tactic resolved once");
    activate(built, "echo", "e");
    assert.equal(built.engine.state.players[P2].influence, 21, "the duplicate resolved too");
  });

  rule("CR 307.3", "while an effect forbids the player to play tactics, a duplicate they create is terminated immediately", () => {
    const built = echoBoard();
    cast(built, "ping");
    activate(built, "gag", "g");
    refused(
      () => built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("late") }),
      "play a tactic under the restriction"
    );
    activate(built, "echo", "e");
    assert.equal(built.engine.state.players[P2].influence, 23, "the duplicate did nothing: it was terminated");
  });

  rule("CR 307.4", "when a duplicate leaves the Being Deployed area it disappears: no new card, nothing extra in any discard pile", () => {
    const built = duelBoard(1);
    const { engine, id } = built;
    const cardCount = Object.keys(engine.state.cards).length;
    duplicateInResponse(built);
    answer(engine, P2, { kind: "chooserSelectsTarget", selected: [id("x0")] });
    resolvePendingResponses(engine);
    assert.equal(Object.keys(engine.state.cards).length, cardCount, "no card exists for the copy");
    assert.deepEqual([...engine.state.players[P2].discard].sort(), [id("rep"), id("x0")].sort(), "P2's pile holds only Replicate and the discarded card");
    assert.deepEqual([...engine.state.players[P1].discard].sort(), [id("costly"), id("h")].sort(), "P1's pile holds only the original and its discard cost");
    for (const player of [P1, P2]) {
      assert.equal(engine.state.players[player].deck.length, 0, `${player}'s deck got nothing`);
    }
  });
});

describe("CR 308 — free", () => {
  /** An item whose ability plays a card from your hand for free. */
  const freeMaker = (): CardDefinition =>
    item({
      name: "Free Maker",
      behavior: { abilities: [{ id: "go", type: "activated", effects: [{ type: "deployForFree", player: "controller", maxCost: 9, selector: { zone: "hand" } }] }] }
    });
  const useFreeMaker = (built: ReturnType<typeof buildGame>) => {
    built.engine.perform({ type: "activateAbility", playerId: P1, cardId: built.id("fm"), abilityId: "go" });
    resolvePendingResponses(built.engine);
    assert.equal(built.engine.state.pendingChoice?.kind, "deployForFree", "the free play is offered");
  };
  const playFree = (built: ReturnType<typeof buildGame>, key: string) => {
    answer(built.engine, P1, { kind: "deployForFree", cardId: built.id(key) });
    resolvePendingResponses(built.engine);
  };

  rule("CR 308.1", "a card played for free has cost number 0 while it is deployed: no resources are spent on a cost-3 character", () => {
    const built = buildGame({
      cards: [{ key: "fm", def: freeMaker(), owner: P1 }, { key: "big", def: character({ name: "Big", cost: 3 }), owner: P1, zone: "hand" }]
    });
    assert.equal(built.engine.getAvailableResourceCount(P1), 0, "P1 has no resources at all");
    useFreeMaker(built);
    playFree(built, "big");
    assert.equal(zone(built.engine, built.id("big")), "play", "the cost-3 character entered play");
  });

  rule("CR 308.1", "the same cost-3 character cannot be deployed normally without resources, and a normal play spends 3 (control)", () => {
    const poor = buildGame({ cards: [{ key: "big", def: character({ name: "Big", cost: 3 }), owner: P1, zone: "hand" }] });
    refused(() => poor.engine.perform({ type: "playCard", playerId: P1, cardId: poor.id("big") }), "deploy a cost-3 character with no resources");
    const rich = buildGame({ cards: [{ key: "big", def: character({ name: "Big", cost: 3 }), owner: P1, zone: "hand" }, ...rageBank(4)] });
    rich.engine.perform({ type: "playCard", playerId: P1, cardId: rich.id("big") });
    resolvePendingResponses(rich.engine);
    assert.equal(rich.engine.getAvailableResourceCount(P1), 1, "4 - 3: a normal deploy pays the cost number");
  });

  rule("CR 308.1", "a free play spends no resources even when the player has some", () => {
    const built = buildGame({
      cards: [{ key: "fm", def: freeMaker(), owner: P1 }, { key: "big", def: character({ name: "Big", cost: 3 }), owner: P1, zone: "hand" }, ...rageBank(4)]
    });
    useFreeMaker(built);
    playFree(built, "big");
    assert.equal(built.engine.getAvailableResourceCount(P1), 4, "all 4 resources are still unspent");
  });

  rule("CR 308.1a", "a free play still needs the threshold: a card needing Rage is refused without Rage, and played with it", () => {
    const rageCard = () => character({ name: "Rager", cost: 2, threshold: "r" });
    const without = buildGame({ cards: [{ key: "fm", def: freeMaker(), owner: P1 }, { key: "r", def: rageCard(), owner: P1, zone: "hand" }] });
    useFreeMaker(without);
    refused(() => answer(without.engine, P1, { kind: "deployForFree", cardId: without.id("r") }), "free play without the threshold");
    assert.equal(zone(without.engine, without.id("r")), "hand", "the card stayed in hand");
    const withRage = buildGame({
      cards: [{ key: "fm", def: freeMaker(), owner: P1 }, { key: "r", def: rageCard(), owner: P1, zone: "hand" }, ...rageBank(1)]
    });
    useFreeMaker(withRage);
    playFree(withRage, "r");
    assert.equal(zone(withRage.engine, withRage.id("r")), "play", "with the threshold met it is played");
    assert.equal(withRage.engine.getAvailableResourceCount(P1), 1, "and the Rage resource was not spent");
  });

  /** A tactic with extra cost "discard a card"; effect: the opponent loses 1 influence. */
  const taxed = (): CardDefinition =>
    tactic({
      name: "Taxed",
      cost: 3,
      behavior: {
        abilities: [
          {
            id: "t",
            type: "activated",
            costs: [{ type: "discard", id: "dc", player: "controller", selector: { zone: "hand" }, count: 1 }],
            effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }]
          }
        ]
      }
    });

  rule("CR 308.1a", "a free play still pays the card's extra costs: the discard is made and then the card resolves", () => {
    const built = buildGame({
      cards: [
        { key: "fm", def: freeMaker(), owner: P1 },
        { key: "t", def: taxed(), owner: P1, zone: "hand" },
        { key: "fodder", def: character({ name: "Fodder" }), owner: P1, zone: "hand" }
      ]
    });
    useFreeMaker(built);
    answer(built.engine, P1, { kind: "deployForFree", cardId: built.id("t"), selected: { dc: [built.id("fodder")] } });
    resolvePendingResponses(built.engine);
    assert.equal(zone(built.engine, built.id("fodder")), "discard", "the extra cost was paid");
    assert.equal(built.engine.state.players[P2].influence, 24, "and the tactic resolved");
  });

  rule("CR 308.1a", "a free play is refused when an extra cost cannot be satisfied", () => {
    const built = buildGame({ cards: [{ key: "fm", def: freeMaker(), owner: P1 }, { key: "t", def: taxed(), owner: P1, zone: "hand" }] });
    useFreeMaker(built);
    refused(() => answer(built.engine, P1, { kind: "deployForFree", cardId: built.id("t") }), "free play with nothing to discard");
    assert.equal(zone(built.engine, built.id("t")), "hand", "the card stayed in hand");
    assert.equal(built.engine.state.players[P2].influence, 25, "nothing happened");
  });

  rule("CR 308.1a", "an extra 'pay N' cost is still paid on a free play (only the cost number is waived)", () => {
    const paying = tactic({
      name: "Paying",
      cost: 5,
      behavior: {
        abilities: [{ id: "p", type: "activated", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }]
      }
    });
    const built = buildGame({ cards: [{ key: "fm", def: freeMaker(), owner: P1 }, { key: "p", def: paying, owner: P1, zone: "hand" }, ...rageBank(3)] });
    useFreeMaker(built);
    playFree(built, "p");
    assert.equal(built.engine.getAvailableResourceCount(P1), 1, "3 - 2: the extra cost was paid, the cost number of 5 was not");
    assert.equal(built.engine.state.players[P2].influence, 24);
  });
});

describe("CR 310 — pick", () => {
  /** A character that cannot be picked. */
  const untouchable = (): CardDefinition =>
    character({
      name: "Untouchable",
      behavior: { abilities: [{ id: "u", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBePicked" }] }] }
    });
  const zap = (selector: TargetDeclaration["selector"] = {}) =>
    spell("Zap", [{ type: "dealDamage", target: pick("t"), amount: 1 }], [{ id: "t", selector, count: 1 }]);

  rule("CR 310.1", "a card that 'cannot be picked' cannot be the pick of a targeted effect, though an ordinary card can (control)", () => {
    const make = () =>
      buildGame({
        cards: [
          { key: "u", def: untouchable(), owner: P2 },
          { key: "plain", def: character({ name: "Plain" }), owner: P2 },
          { key: "zap", def: zap(), owner: P1, zone: "hand" }
        ]
      });
    const control = make();
    cast(control, "zap", { t: [control.id("plain")] });
    assert.equal(control.engine.state.cards[control.id("plain")]!.damage, 1, "control: an ordinary card was picked and damaged");
    const built = make();
    refused(
      () => built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id("zap"), selected: { t: [built.id("u")] } }),
      "pick a card that cannot be picked"
    );
    assert.equal(built.engine.state.cards[built.id("u")]!.damage, 0, "the unpickable card took nothing");
  });

  rule("CR 310.1", "a card that cannot be picked can still be reached by an effect that does not say pick: 'all characters'", () => {
    const sweep = spell("Sweep", [
      { type: "forEach", selector: { type: "character", controller: "opponent" }, effects: [{ type: "dealDamage", target: pick("__candidate"), amount: 1 }] }
    ]);
    const built = buildGame({
      cards: [
        { key: "u", def: untouchable(), owner: P2 },
        { key: "plain", def: character({ name: "Plain" }), owner: P2 },
        { key: "sweep", def: sweep, owner: P1, zone: "hand" }
      ]
    });
    cast(built, "sweep");
    assert.equal(built.engine.state.cards[built.id("u")]!.damage, 1, "the unpickable card was hit by the sweep");
    assert.equal(built.engine.state.cards[built.id("plain")]!.damage, 1);
  });

  rule("CR 310.1", "a card that cannot be picked can be CHOSEN by text that never says pick (a chosen-not-picked declaration)", () => {
    const built = buildGame({
      cards: [
        { key: "u", def: untouchable(), owner: P2 },
        { key: "zap", def: zap({ chosenNotPicked: true }), owner: P1, zone: "hand" }
      ]
    });
    cast(built, "zap", { t: [built.id("u")] });
    assert.equal(built.engine.state.cards[built.id("u")]!.damage, 1, "selected without the word pick");
  });

  rule("CR 310.1", "'cannot be picked by opponents' still lets its own controller pick it", () => {
    const shy = () =>
      character({
        name: "Shy",
        behavior: { abilities: [{ id: "s", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBePickedByOpponents" }] }] }
      });
    const mine = buildGame({ cards: [{ key: "shy", def: shy(), owner: P1 }, { key: "zap", def: zap(), owner: P1, zone: "hand" }] });
    cast(mine, "zap", { t: [mine.id("shy")] });
    assert.equal(mine.engine.state.cards[mine.id("shy")]!.damage, 1, "its controller picked it");
    const theirs = buildGame({ cards: [{ key: "shy", def: shy(), owner: P2 }, { key: "zap", def: zap(), owner: P1, zone: "hand" }] });
    refused(
      () => theirs.engine.perform({ type: "playCard", playerId: P1, cardId: theirs.id("zap"), selected: { t: [theirs.id("shy")] } }),
      "an opponent picks a card that opponents cannot pick"
    );
  });
});

describe("CR 311 — provides", () => {
  const needs = (threshold: string) => tactic({ name: `Needs ${threshold}`, threshold });
  const canPlay = (built: ReturnType<typeof buildGame>, key: string): boolean => {
    try {
      built.engine.perform({ type: "playCard", playerId: P1, cardId: built.id(key) });
      return true;
    } catch {
      return false;
    }
  };
  const provider = (name: string, provides: Array<"rage" | "greed" | "volition">) => character({ name, resource: { provides } });

  rule("CR 311.1", "icons a card provides count toward thresholds: an in-play character providing Rage enables a Rage tactic, and without it the tactic is refused", () => {
    const with_ = buildGame({ cards: [{ key: "p", def: provider("Forge", ["rage"]), owner: P1 }, { key: "t", def: needs("r"), owner: P1, zone: "hand" }] });
    assert.equal(with_.engine.getThresholds(P1).rage, 1, "the card provides one Rage");
    assert.equal(canPlay(with_, "t"), true, "the Rage tactic can be deployed");
    const without = buildGame({ cards: [{ key: "t", def: needs("r"), owner: P1, zone: "hand" }] });
    assert.equal(canPlay(without, "t"), false, "control: with nothing providing Rage it cannot");
  });

  rule("CR 311.1", "a card that provides two icons counts both: it alone meets a two-icon threshold", () => {
    const built = buildGame({ cards: [{ key: "p", def: provider("Twin", ["greed", "greed"]), owner: P1 }, { key: "t", def: needs("gg"), owner: P1, zone: "hand" }] });
    assert.equal(built.engine.getThresholds(P1).greed, 2);
    assert.equal(canPlay(built, "t"), true, "[G][G] met by the one card");
  });

  rule("CR 311.1", "provided icons add to resource icons toward one threshold; one icon short is refused", () => {
    const ok = buildGame({
      cards: [
        { key: "p", def: provider("Forge", ["rage"]), owner: P1 },
        { key: "r", def: resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } }), owner: P1 },
        { key: "t", def: needs("rr"), owner: P1, zone: "hand" }
      ]
    });
    assert.equal(canPlay(ok, "t"), true, "a provider plus a Rage resource make [R][R]");
    const short = buildGame({ cards: [{ key: "p", def: provider("Forge", ["rage"]), owner: P1 }, { key: "t", def: needs("rr"), owner: P1, zone: "hand" }] });
    assert.equal(canPlay(short, "t"), false, "one provider alone is one icon short");
  });

  rule("CR 311.1", "a providing card only counts while it is in play and under your control", () => {
    const inHand = buildGame({ cards: [{ key: "p", def: provider("Forge", ["rage"]), owner: P1, zone: "hand" }, { key: "t", def: needs("r"), owner: P1, zone: "hand" }] });
    assert.equal(inHand.engine.getThresholds(P1).rage ?? 0, 0, "in hand it provides nothing");
    const theirs = buildGame({ cards: [{ key: "p", def: provider("Forge", ["rage"]), owner: P2 }, { key: "t", def: needs("r"), owner: P1, zone: "hand" }] });
    assert.equal(theirs.engine.getThresholds(P1).rage ?? 0, 0, "the opponent's providing card does not count for you");
    assert.equal(theirs.engine.getThresholds(P2).rage, 1, "it counts for its controller");
    assert.equal(canPlay(theirs, "t"), false);
  });

  rule("CR 311.1", "providing icons does not use the card up: two threshold cards can be played off the same provider", () => {
    const built = buildGame({
      cards: [
        { key: "p", def: provider("Forge", ["rage"]), owner: P1 },
        { key: "a", def: needs("r"), owner: P1, zone: "hand" },
        { key: "b", def: needs("r"), owner: P1, zone: "hand" }
      ]
    });
    assert.equal(canPlay(built, "a"), true);
    resolvePendingResponses(built.engine);
    assert.equal(canPlay(built, "b"), true, "the provider still provides after the first deploy");
  });

  /** A staple whose provided icon comes from its name (no explicit `provides`), as the printed staples do. */
  const staple = (name: string) => resourceCard({ name, resource: { staple: true } });

  rule("CR 311.2", "a staple resource card provides exactly one icon of its type by default (Greed staple: one [G], no [R])", () => {
    const built = buildGame({ cards: [{ key: "g", def: staple("Greed"), owner: P1 }] });
    const thresholds = built.engine.getThresholds(P1);
    assert.equal(thresholds.greed, 1, "one Greed icon");
    assert.equal(thresholds.rage ?? 0, 0, "and nothing else");
  });

  rule("CR 311.2", "each staple kind provides its own icon, one each", () => {
    const names = ["Rage", "Greed", "Deception", "Elitism", "Obsession"] as const;
    const built = buildGame({ cards: names.map((name, i) => ({ key: `s${i}`, def: staple(name), owner: P1 })) });
    const thresholds = built.engine.getThresholds(P1);
    for (const icon of ["rage", "greed", "deception", "elitism", "obsession"] as const) {
      assert.equal(thresholds[icon], 1, `${icon}: exactly one icon from one staple`);
    }
    assert.equal(thresholds.volition ?? 0, 0, "no Volition from face-up staples");
  });

  rule("CR 311.2", "one staple is one icon, so a [G][G] threshold needs two Greed staples", () => {
    const one = buildGame({ cards: [{ key: "g1", def: staple("Greed"), owner: P1 }, { key: "t", def: needs("gg"), owner: P1, zone: "hand" }] });
    assert.equal(canPlay(one, "t"), false, "one Greed staple is one icon short");
    const two = buildGame({
      cards: [{ key: "g1", def: staple("Greed"), owner: P1 }, { key: "g2", def: staple("Greed"), owner: P1 }, { key: "t", def: needs("gg"), owner: P1, zone: "hand" }]
    });
    assert.equal(canPlay(two, "t"), true, "two Greed staples meet [G][G]");
  });

  rule("CR 311.2", "every face-down card provides the Volition icon, whatever it is on its face", () => {
    const built = buildGame({
      cards: [
        { key: "fdChar", def: character({ name: "Hidden Char" }), owner: P1, faceDown: true },
        { key: "fdRage", def: staple("Rage"), owner: P1, faceDown: true },
        { key: "fdTactic", def: tactic({ name: "Hidden Tactic" }), owner: P1, faceDown: true }
      ]
    });
    const thresholds = built.engine.getThresholds(P1);
    assert.equal(thresholds.volition, 3, "three face-down cards, three Volition icons");
    assert.equal(thresholds.rage ?? 0, 0, "a face-down Rage staple does not provide Rage");
  });

  rule("CR 311.2", "a Volition threshold is met by a face-down card and not by a face-up non-resource card", () => {
    const down = buildGame({ cards: [{ key: "fd", def: character({ name: "Hidden" }), owner: P1, faceDown: true }, { key: "t", def: needs("v"), owner: P1, zone: "hand" }] });
    assert.equal(canPlay(down, "t"), true, "the face-down card provides [V]");
    const up = buildGame({ cards: [{ key: "up", def: character({ name: "Seen" }), owner: P1 }, { key: "t", def: needs("v"), owner: P1, zone: "hand" }] });
    assert.equal(canPlay(up, "t"), false, "control: a face-up character provides no icon");
  });
});
