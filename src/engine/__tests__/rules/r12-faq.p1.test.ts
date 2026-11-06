// Batch r12-faq (docs/TESTING.md), part 1: Rules FAQ 2.0 rulings 1-8.
// Each ruling is reproduced with synthetic cards; expectations come from the
// FAQ's question and answer text, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
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
} from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { chooseDevelopOption, developDraw, orderUntilDevelopPrompt, settleTurnStart } from "../support/develop.js";

const ACTIVATED = (effects: unknown[], extra: Record<string, unknown> = {}) =>
  ({ abilities: [{ id: "go", type: "activated", effects, ...extra }] }) as CardDefinition["behavior"];

const blank = (name: string) => tactic({ name });
const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;

/** Settles response windows and answers every `orderTriggers` prompt with the first listed trigger. */
function settle(engine: SpoilsEngine): void {
  for (let guard = 0; guard < 50; guard++) {
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    if (pending?.kind !== "orderTriggers") return;
    const first = pending.triggers[0]!;
    engine.perform({
      type: "resolvePendingChoice",
      playerId: pending.playerId,
      choice: { kind: "orderTriggers", next: { sourceId: first.sourceId, abilityId: first.abilityId } }
    });
  }
  throw new Error("settle(): did not converge");
}

describe("FAQ 1 — who is the active player", () => {
  rule("FAQ 1", "the active player is the player whose turn it is, and does not change while the opponent responds or plays a card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    assert.equal(engine.state.activePlayerId, P1, "it is P1's turn");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "P2 now holds priority");
    assert.equal(engine.state.activePlayerId, P1, "holding priority does not make P2 the active player");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(engine.state.activePlayerId, P1, "P2 playing a card does not either");
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P1, "nor does resolving it");
  });

  rule("FAQ 1", "'the active player' in a card resolves to the player whose turn it is, whoever plays the card", () => {
    // P2 responds on P1's turn with a tactic: "the active player gains 2 influence".
    const gift = tactic({ name: "Gift", behavior: ACTIVATED([{ type: "modifyInfluence", player: "activePlayer", amount: 2 }]) });
    const { engine, id } = buildGame({
      cards: [
        { key: "opener", def: blank("Opener"), owner: P1, zone: "hand" },
        { key: "gift", def: gift, owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("gift") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, 27, "the active player (P1) got the influence");
    assert.equal(engine.state.players[P2].influence, 25, "the player who played the card did not");
  });

  rule("FAQ 1", "the only way the active player changes is for one turn to end and another to begin", () => {
    const { engine } = buildGame({ cards: [] });
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.state.activePlayerId, P1, "announcing the end of turn does not change it while P2 may still respond");
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2, "when the turn has ended the other player's turn begins");
    assert.equal(engine.state.turn, 2);
    settleTurnStart(engine);
    refused(() => engine.perform({ type: "endTurn", playerId: P1 }), "the former active player ending a turn that is not theirs", /turn|active|priority/i);
  });
});

describe("FAQ 2 — Tactician Vacation closes the tactic window", () => {
  /** "This turn, tactics cannot be deployed." Opponents cannot respond to it. */
  const vacation = () =>
    tactic({
      name: "Vacation",
      behavior: {
        noResponse: true,
        abilities: [
          {
            id: "body",
            type: "activated",
            effects: [{ type: "forEachPlayer", effects: [{ type: "restrictPlay", player: "controller", kind: "cardType", cardType: "tactic", duration: { type: "untilEndOfTurn" } }] }]
          }
        ]
      }
    });
  const flash = (name: string) => character({ name, behavior: { keywords: ["tactical"] } });
  const ping = (name: string) => tactic({ name, behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: 1 }]) });
  const poke = () => character({ name: "Poker", behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: 1 }]) });

  rule("FAQ 2", "control: with no Vacation the opponent can respond with a card that 'can be played whenever you could play a tactic'", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "poker", def: poke(), owner: P1 },
        { key: "flash", def: flash("Flash Guy"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("poker"), abilityId: "go" });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("flash") });
    assert.equal(engine.state.responseStack.length, 2, "the TACTICAL character is a legal response");
  });

  rule("FAQ 2", "after a Tactician Vacation the opponent cannot play a TACTICAL card in the window, and cannot play a tactic either", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "vac", def: vacation(), owner: P1, zone: "hand" },
        { key: "poker", def: poke(), owner: P1 },
        { key: "flash", def: flash("Flash Guy"), owner: P2, zone: "hand" },
        { key: "reply", def: ping("Reply"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("vac") });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("vac")), "discard", "the Vacation resolved");
    // Open a response window: P1 uses an ability, P2 now holds priority.
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("poker"), abilityId: "go" });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "P2 may respond");
    refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") }), "a tactic after the Vacation", /deployed right now|cannot/i);
    refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("flash") }), "a card playable 'whenever you could play a tactic' after the Vacation", /deployed right now|cannot/i);
    assert.equal(zone(engine, id("flash")), "hand", "the card is still in hand");
    assert.equal(engine.state.responseStack.length, 1, "nothing was added to the stack");
  });

  rule("FAQ 2", "the closed window lasts the whole turn: the same card is refused again later in that turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "vac", def: vacation(), owner: P1, zone: "hand" },
        { key: "poker", def: poke(), owner: P1 },
        { key: "flash", def: flash("Flash Guy"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("vac") });
    resolvePendingResponses(engine);
    for (let round = 0; round < 2; round++) {
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("poker"), abilityId: "go" });
      refused(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("flash") }), `round ${round + 1}: a TACTICAL card`, /deployed right now|cannot/i);
      resolvePendingResponses(engine);
    }
  });

  rule("FAQ 2", "the card can still be played when it normally could be played: a TACTICAL character is deployable in the main phase after a Vacation", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "vac", def: vacation(), owner: P1, zone: "hand" },
        { key: "flash", def: flash("Flash Guy"), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("vac") });
    resolvePendingResponses(engine);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("flash") });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("flash")), "play", "deployed at ordinary timing");
  });

  rule("FAQ 2", "the window reopens on the next turn: the opponent can play a tactic on their own turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "vac", def: vacation(), owner: P1, zone: "hand" },
        { key: "reply", def: ping("Reply"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("vac") });
    resolvePendingResponses(engine);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2);
    settleTurnStart(engine);
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("reply")), "discard", "the tactic was playable again");
  });
});

describe("FAQ 3 — faction abilities", () => {
  const drawFaction = (name: string) =>
    factionCard({
      name,
      faction: defaultFactionDefinition({
        abilities: [
          {
            id: "faction-draw",
            name: "Draw",
            type: "activated",
            costs: [{ type: "payResources", amount: 1 }],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      })
    });
  const board = (extra: Parameters<typeof buildGame>[0] = {}) =>
    buildGame({
      playerA: { faction: drawFaction("Draw Faction A") },
      playerB: { faction: drawFaction("Draw Faction B") },
      ...extra,
      cards: [
        { key: "a-res", def: resourceCard({ name: "Res A" }), owner: P1 },
        { key: "b-res", def: resourceCard({ name: "Res B" }), owner: P2 },
        { key: "a-top", def: blank("A Top"), owner: P1, zone: "deck" },
        { key: "b-top", def: blank("B Top"), owner: P2, zone: "deck" },
        ...(extra.cards ?? [])
      ]
    });
  const factionId = (engine: SpoilsEngine, player: typeof P1 | typeof P2) => engine.state.players[player].factionId!;
  const handSize = (engine: SpoilsEngine, player: typeof P1 | typeof P2) => engine.state.players[player].hand.length;

  rule("FAQ 3", "a faction ability can be used any time during your own turn", () => {
    const { engine } = board();
    const before = handSize(engine, P1);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: factionId(engine, P1), abilityId: "faction-draw" });
    resolvePendingResponses(engine);
    assert.equal(handSize(engine, P1), before + 1, "drew a card through the faction ability");
  });

  rule("FAQ 3", "a faction ability can be used in response to the opponent playing a card, and resolves before that card's effect", () => {
    const ping = tactic({ name: "Ping", behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: 1 }]) });
    const { engine, id } = board({ cards: [{ key: "ping", def: ping, owner: P1, zone: "hand" }] });
    const before = handSize(engine, P2);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ping") });
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "P2 may respond");
    engine.perform({ type: "activateAbility", playerId: P2, cardId: factionId(engine, P2), abilityId: "faction-draw" });
    assert.equal(engine.state.players[P1].influence, 25, "the card's costs are paid but its effect has not happened yet");
    resolvePendingResponses(engine);
    assert.equal(handSize(engine, P2), before + 1, "the faction ability resolved");
    assert.equal(engine.state.players[P1].influence, 26, "and the original card still resolved after it");
  });

  rule("FAQ 3", "a faction ability can be used in response to the opponent using an ability", () => {
    const poker = character({ name: "Poker", behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: 1 }]) });
    const { engine, id } = board({ cards: [{ key: "poker", def: poker, owner: P1 }] });
    const before = handSize(engine, P2);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("poker"), abilityId: "go" });
    engine.perform({ type: "activateAbility", playerId: P2, cardId: factionId(engine, P2), abilityId: "faction-draw" });
    resolvePendingResponses(engine);
    assert.equal(handSize(engine, P2), before + 1);
  });

  rule("FAQ 3", "a faction ability can be used in response to the opponent announcing the end of their turn", () => {
    const { engine } = board();
    const before = handSize(engine, P2);
    engine.perform({ type: "endTurn", playerId: P1 });
    assert.equal(engine.state.responseWindow?.kind, "endTurn");
    engine.perform({ type: "activateAbility", playerId: P2, cardId: factionId(engine, P2), abilityId: "faction-draw" });
    resolvePendingResponses(engine);
    assert.equal(handSize(engine, P2), before + 1, "drew in response to the end-of-turn announcement");
  });

  rule("FAQ 3", "'any time you can legally use an ability': on the opponent's turn with nothing in flight the faction ability is refused (control: allowed in response)", () => {
    const { engine } = board();
    refused(
      () => engine.perform({ type: "activateAbility", playerId: P2, cardId: factionId(engine, P2), abilityId: "faction-draw" }),
      "using an ability on the opponent's turn with no response window open",
      /timing|priority|turn|cannot/i
    );
    engine.perform({ type: "endTurn", playerId: P1 });
    engine.perform({ type: "activateAbility", playerId: P2, cardId: factionId(engine, P2), abilityId: "faction-draw" });
    assert.equal(engine.state.responseStack.length, 1, "control: in response to the end of turn it works");
  });
});

describe("FAQ 4 — draw or play a resource at the start of the turn", () => {
  /** A standard Develop Rule: draw a card OR play a resource. */
  const standard = () =>
    factionCard({
      name: "Develop Faction",
      faction: defaultFactionDefinition({
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
        }
      })
    });
  const board = () =>
    buildGame({
      playerA: { faction: standard() },
      cards: [
        { key: "top", def: blank("Top"), owner: P1, zone: "deck" },
        { key: "res", def: resourceCard({ name: "Hand Resource" }), owner: P1, zone: "hand" }
      ]
    });

  /**
   * Ends both players' turns so P1's turn begins (P2's own Develop Rule is skipped); P1's start-of-turn triggers - the
   * Restore Rule and the Develop Rule, user ruling 2026-10-27 - are ordered, which leaves the Develop Rule's option
   * prompt pending. Returns the options it offers (Skip excluded).
   */
  function startOfTurn(engine: SpoilsEngine): string[] {
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    settleTurnStart(engine);
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P1, "P1's turn has begun");
    return orderUntilDevelopPrompt(engine).filter(label => label !== "Skip the Develop Rule");
  }

  rule("FAQ 4", "the Develop Rule offers a draw OR a resource play on the player's turn: both are listed as alternatives", () => {
    const { engine } = board();
    const options = startOfTurn(engine);
    assert.ok(options.length > 0, "P1's new turn offers the Develop Rule");
    assert.equal(options.length, 2, "one or the other");
    assert.ok(options.some(label => /^Draw /.test(label)) && options.some(label => /^Play a resource/.test(label)), "a draw or a resource play");
  });

  rule("FAQ 4", "choosing to draw uses the Develop Rule up: the resource is not also played", () => {
    const { engine, id } = board();
    assert.ok(startOfTurn(engine).length > 0, "the Develop Rule is available");
    chooseDevelopOption(engine, P1, /^Draw /);
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("top")), "hand", "drew a card");
    // The Develop Rule is a trigger that has now resolved: nothing is left to develop, so the resource cannot also be played.
    assert.equal(engine.state.pendingChoice, undefined, "nothing more to develop");
    assert.equal(zone(engine, id("res")), "hand", "the resource stayed in hand");
  });

  rule("FAQ 4", "choosing to play a resource uses the Develop Rule up: no draw afterwards", () => {
    const { engine, id } = board();
    assert.ok(startOfTurn(engine).length > 0, "the Develop Rule is available");
    chooseDevelopOption(engine, P1, /^Play a resource/);
    // A one-card hand is not asked which card; the face prompt is.
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown: false } });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("res")), "play", "played the resource");
    assert.equal(zone(engine, id("top")), "deck", "nothing was drawn");
    // The Develop Rule is a trigger that has now resolved: nothing is left to develop, so no draw follows.
    assert.equal(engine.state.pendingChoice, undefined, "no draw is offered afterwards");
    assert.equal(zone(engine, id("top")), "deck", "still nothing drawn");
  });

  rule("FAQ 4", "faction abilities are separate from the Develop Rule: after developing, a faction Draw ability still draws", () => {
    const withAbility = factionCard({
      name: "Ability Faction",
      faction: defaultFactionDefinition({
        abilities: [{ id: "faction-draw", name: "Draw", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
      })
    });
    const { engine, id } = buildGame({
      playerA: { faction: withAbility },
      cards: [
        { key: "top1", def: blank("Top 1"), owner: P1, zone: "deck" },
        { key: "top2", def: blank("Top 2"), owner: P1, zone: "deck" },
        { key: "res", def: resourceCard({ name: "Res" }), owner: P1 }
      ]
    });
    developDraw(engine, P1);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: engine.state.players[P1].factionId!, abilityId: "faction-draw" });
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].hand.length, 2, "a second card came from the faction ability");
    assert.equal(zone(engine, id("top2")), "hand");
  });
});

describe("FAQ 5 — Dwarvish Grimalkin: each trigger is a separate instance of drawing", () => {
  const grimalkin = () => {
    const draw = (n: number) => ({
      id: `draw-${n}`,
      type: "triggered" as const,
      event: "cardEnteredPlay" as const,
      condition: { type: "sourceIsEventCard" as const },
      effects: [{ type: "draw" as const, player: "controller" as const, amount: 1 }]
    });
    return character({ name: "Triple Drawer", behavior: { abilities: [draw(1), draw(2), draw(3)] } });
  };
  const beatrix = () =>
    character({
      name: "Extra Drawer",
      behavior: { abilities: [{ id: "more", type: "continuous", modifiers: [], drawModifiers: [{ player: "self", delta: 1 }] }] }
    });
  const deckCards = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `d${i}`, def: blank(`Deck ${i}`), owner: P1, zone: "deck" as const }));
  const drawEvents = (engine: SpoilsEngine) =>
    engine.getLog().flatMap(entry => (entry.event?.type === "cardsDrawn" && entry.event.playerId === P1 ? [entry.event.count] : []));

  rule("FAQ 5", "three triggers on one card are three separate draws of 1 card each, not one draw of 3", () => {
    const { engine, id } = buildGame({
      cards: [{ key: "grim", def: grimalkin(), owner: P1, zone: "hand" }, ...deckCards(10)]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("grim") });
    settle(engine);
    assert.equal(zone(engine, id("grim")), "play");
    assert.equal(engine.state.players[P1].hand.length, 3, "3 cards drawn in total");
    assert.deepEqual(drawEvents(engine), [1, 1, 1], "as 3 separate instances of drawing 1 card");
  });

  rule("FAQ 5", "each instance is modified separately: with an 'increase the amount by 1' card in play, 3 instances draw 6 cards, not 4", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "grim", def: grimalkin(), owner: P1, zone: "hand" },
        { key: "bea", def: beatrix(), owner: P1 },
        ...deckCards(10)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("grim") });
    settle(engine);
    assert.equal(engine.state.players[P1].hand.length, 6, "6 cards drawn");
    assert.deepEqual(drawEvents(engine), [2, 2, 2], "each of the 3 draws was increased from 1 to 2");
  });

  rule("FAQ 5", "a single draw of 3 (one instance) with the same increase draws 4: the increase is per instance, so separate instances matter", () => {
    const drawThree = tactic({ name: "Draw Three", behavior: ACTIVATED([{ type: "draw", player: "controller", amount: 3 }]) });
    const { engine, id } = buildGame({
      cards: [
        { key: "three", def: drawThree, owner: P1, zone: "hand" },
        { key: "bea", def: beatrix(), owner: P1 },
        ...deckCards(10)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("three") });
    settle(engine);
    assert.equal(engine.state.players[P1].hand.length, 4, "one instance of 3, increased by 1");
    assert.deepEqual(drawEvents(engine), [4]);
  });
});

describe("FAQ 6 — multiple triggers at the same time", () => {
  const MARK = { zone: "play" as const, type: "character" as const, subtype: "mark" };
  const onTurnStart = (id: string, effectType: "deplete" | "restore") =>
    ({
      id,
      type: "triggered" as const,
      event: "turnStarted" as const,
      targets: [{ id: "t", selector: MARK, count: 1 }],
      effects: [{ type: effectType, target: { type: "selected" as const, id: "t" } }]
    }) as never;
  const trigger = (name: string, id: string, effectType: "deplete" | "restore") =>
    character({ name, behavior: { abilities: [onTurnStart(id, effectType)] } });
  // The same, on "when a card enters play": no faction trigger of the active player joins that batch.
  const onEntry = (name: string, id: string, effectType: "deplete" | "restore") =>
    character({
      name,
      behavior: {
        abilities: [
          {
            id,
            type: "triggered" as const,
            event: "cardEnteredPlay" as const,
            targets: [{ id: "t", selector: MARK, count: 1 }],
            effects: [{ type: effectType, target: { type: "selected" as const, id: "t" } }]
          }
        ]
      } as never
    });
  const order = (engine: SpoilsEngine, player: typeof P1 | typeof P2, sourceId: string, abilityId: string) =>
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "orderTriggers", next: { sourceId, abilityId } } });

  rule("FAQ 6", "triggers that all come from cards under one player's control: that player decides the order (even when it is not their turn)", () => {
    // User ruling 2026-10-27: the faction's Restore and Develop Rules are start-of-turn triggers of the ACTIVE player's
    // faction, so a start-of-turn batch is never one player's alone. The one-player batch is made with an entry trigger:
    // P1 is active and plays a card; both triggers it sets off are P2's.
    const { engine, id } = buildGame({
      cards: [
        { key: "dep", def: onEntry("Depleter", "dep", "deplete"), owner: P2 },
        { key: "res", def: onEntry("Restorer", "res", "restore"), owner: P2 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P2 },
        { key: "opener", def: character({ name: "Opener" }), owner: P1, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("opener") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P1, "P1 is the active player");
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers", "an ordering decision is needed");
    assert.equal(pending?.playerId, P2, "the player who controls both triggers decides, not the active player");
    order(engine, P2, id("dep"), "dep");
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("mark")]!.depleted, false, "deplete then restore: the Mark ends restored, as P2 ordered");
  });

  rule("FAQ 6", "triggers from cards under both players' control: the active player decides the order", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      turn: 2,
      cards: [
        { key: "dep", def: trigger("Depleter", "dep", "deplete"), owner: P1 },
        { key: "res", def: trigger("Restorer", "res", "restore"), owner: P2 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P2 }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P1);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P1, "the active player (P1) decides although one trigger is P2's");
    refused(() => order(engine, P2, id("res"), "res"), "the non-active player ordering a mixed batch", /not your/i);
    order(engine, P1, id("res"), "res");
    // The active player's own Restore and Develop Rules (user ruling 2026-10-27) are in the same batch: they are answered too.
    settleTurnStart(engine);
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice, undefined, "nothing left to order");
    assert.equal(engine.state.cards[id("mark")]!.depleted, true, "restore then deplete: the Mark ends depleted, as P1 ordered");
  });

  rule("FAQ 6", "the same mixed batch on the other player's turn is decided by the other player (the active one)", () => {
    const { engine, id } = buildGame({
      activePlayerId: P1,
      cards: [
        { key: "dep", def: trigger("Depleter", "dep", "deplete"), owner: P1 },
        { key: "res", def: trigger("Restorer", "res", "restore"), owner: P2 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P1 }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "orderTriggers");
    assert.equal(pending?.playerId, P2, "now P2 is the active player and decides");
  });

  rule("FAQ 6", "the order does not have to be decided ahead of time: the deciding player lets one trigger happen, then chooses the next", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      turn: 2,
      cards: [
        { key: "t1", def: trigger("Trigger One", "t1", "deplete"), owner: P1 },
        { key: "t2", def: trigger("Trigger Two", "t2", "restore"), owner: P1 },
        { key: "t3", def: trigger("Trigger Three", "t3", "deplete"), owner: P1 },
        { key: "mark", def: character({ name: "Mark", subtype: ["mark"] }), owner: P1 }
      ]
    });
    engine.perform({ type: "endTurn", playerId: P2 });
    resolvePendingResponses(engine);
    const first = engine.state.pendingChoice;
    assert.equal(first?.kind, "orderTriggers");
    if (first?.kind !== "orderTriggers") return;
    const cardTriggers = (triggers: typeof first.triggers) => triggers.filter(entry => entry.abilityId.startsWith("t"));
    // User ruling 2026-10-27: Restore and Develop are in the same batch beside the three cards' triggers.
    assert.equal(cardTriggers(first.triggers).length, 3, "all three are waiting");
    order(engine, P1, id("t1"), "t1");
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("mark")]!.depleted, true, "the first chosen trigger has happened");
    const second = engine.state.pendingChoice;
    assert.equal(second?.kind, "orderTriggers", "the player is asked again, with the first already done");
    if (second?.kind !== "orderTriggers") return;
    assert.equal(cardTriggers(second.triggers).length, 2, "two are left");
    order(engine, P1, id("t2"), "t2");
    settleTurnStart(engine); // Restore and Develop, and the last card trigger, follow in the order offered
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("mark")]!.depleted, true, "t2 (restore) ran next, then the last one left, t3 (deplete), ran after it");
    assert.equal(engine.state.pendingChoice, undefined, "nothing left to order");
  });
});
