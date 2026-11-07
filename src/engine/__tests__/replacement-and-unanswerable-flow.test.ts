// Flow invariants that must hold at every table size:
//  - a replacement's effects happen as one (CR §506): a prompt among them makes the rest wait for the answer, and no
//    state-based check runs between them — in nested effect lists (forEachPlayer, asPlayer) too;
//  - a card nobody may respond to resolves as though everyone had passed (CR §607.2): the response window then goes
//    on exactly as after any other resolution.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { P1, P2, buildGame, character, killTactic, resolvePendingResponses, tactic } from "./per-card/_harness.js";
import type { CardDefinition, Effect } from "../../engine.js";

const handSize = (engine: ReturnType<typeof buildGame>["engine"], playerId: string) => engine.state.players[playerId].hand.length;

/** A character with 2 life whose destruction is replaced by `effects`. */
const replacedOnDestroy = (effects: Effect[]): CardDefinition =>
  character({
    name: "Replacer",
    life: 2,
    behavior: {
      abilities: [
        {
          id: "instead",
          type: "replacement",
          replaces: { event: "destroy" },
          condition: { type: "cardNameEquals", target: { type: "selected", id: "__candidate" }, other: "source" },
          effects
        }
      ]
    } as CardDefinition["behavior"]
  });

const deckCards = (owner: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ key: `${owner}-d${i}`, def: character({ name: `${owner}D${i}` }), owner, zone: "deck" as const }));

describe("a replacement's effects happen as one (CR §506)", () => {
  test("a prompt among them makes the rest wait for the answer", () => {
    // "If this would be destroyed, choose: A or B. If you chose A, draw a card." — the draw reads the answer.
    const def = replacedOnDestroy([
      {
        type: "chooserSelectsOption",
        chooser: "controller",
        options: [
          { label: "A", effects: [{ type: "bind", id: "chose", value: 1 }] },
          { label: "B", effects: [] }
        ]
      },
      {
        type: "if",
        condition: { type: "numberCompare", left: { type: "variable", id: "chose" }, operator: "=", right: 1 },
        effects: [{ type: "draw", player: "controller", amount: 1 }]
      }
    ]);
    const { engine, id } = buildGame({
      cards: [{ key: "r", def, owner: P1, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }, ...deckCards(P1, 3)]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("kill"), selected: { t: [id("r")] } } as never);
    resolvePendingResponses(engine);
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "chooserSelectsOption");
    assert.equal(handSize(engine, P1), 0, "nothing after the prompt has happened yet");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } } as never);
    resolvePendingResponses(engine);
    assert.equal(handSize(engine, P1), 1, "the draw saw the answer");
    assert.equal(engine.state.cards[id("r")].zone, "play", "the destruction was replaced");
  });

  test("no state-based check runs between its effects, nested lists included: lethal damage does not destroy it mid-replacement", () => {
    // The damage reset comes last, after a nested effect list; a check between them would destroy the card.
    const def = replacedOnDestroy([
      { type: "forEachPlayer", effects: [{ type: "draw", player: "controller", amount: 1 }] },
      { type: "setDamage", target: { type: "selected", id: "__candidate" }, amount: 0 }
    ]);
    const bolt = tactic({
      name: "Bolt",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [{ key: "r", def, owner: P1, zone: "play" }, { key: "bolt", def: bolt, owner: P2, zone: "hand" }, ...deckCards(P1, 2), ...deckCards(P2, 2)],
      activePlayerId: P2
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("bolt"), selected: { t: [id("r")] } } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("r")].zone, "play");
    assert.equal(engine.state.cards[id("r")].damage, 0);
    assert.equal(handSize(engine, P1), 1);
    assert.equal(handSize(engine, P2), 1, "every player drew, then the damage was reset");
  });
});

describe("a card nobody may respond to resolves as though everyone had passed (CR §607.2)", () => {
  const NOOP = tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } });
  /** "Your opponents cannot respond to this card. Terminate the tactic it responds to." */
  const SNUFF = tactic({
    name: "Snuff",
    cost: 0,
    behavior: { noResponse: true, abilities: [{ id: "s", type: "activated", effects: [{ type: "terminate", scope: "respondedItem" }] }] }
  });
  /** "Your opponents cannot respond to this card. Choose: draw a card, or nothing." */
  const PONDER = tactic({
    name: "Ponder",
    cost: 0,
    behavior: {
      noResponse: true,
      abilities: [
        {
          id: "p",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsOption",
              chooser: "controller",
              options: [
                { label: "Draw", effects: [{ type: "draw", player: "controller", amount: 1 }] },
                { label: "Nothing", effects: [] }
              ]
            }
          ]
        }
      ]
    }
  });

  test("a response that ends the item beneath empties the stack: the window closes and the active player carries on", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [{ key: "noop", def: NOOP, owner: P2, zone: "hand" }, { key: "snuff", def: SNUFF, owner: P1, zone: "hand" }]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("noop") } as never);
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("snuff") } as never);
    assert.equal(engine.state.cards[id("snuff")].zone, "discard");
    assert.equal(engine.state.cards[id("noop")].zone, "discard", "the tactic it responded to was terminated");
    assert.equal(engine.state.responseStack.length, 0);
    assert.equal(engine.state.responseWindow, undefined, "the window closed, as after any resolution that empties the stack");
    assert.equal(engine.state.priorityPlayerId, P2, "play is back with the active player");
  });

  test("a response that stops on a prompt: once answered, the item beneath is offered again (CR §607.2)", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "noop", def: NOOP, owner: P2, zone: "hand" },
        { key: "ponder", def: PONDER, owner: P1, zone: "hand" },
        ...deckCards(P1, 2)
      ]
    });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("noop") } as never);
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ponder") } as never);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } } as never);
    assert.equal(handSize(engine, P1), 1, "Ponder resolved");
    const window = engine.state.responseWindow;
    assert.equal(window?.phase, "acceptingResponses");
    assert.equal(window?.priorityPlayerId, P1, "P2's tactic is offered to the player who may respond to it");
    assert.deepEqual(engine.state.responseStack.map(item => item.sourceId), [id("noop")]);
  });
});
