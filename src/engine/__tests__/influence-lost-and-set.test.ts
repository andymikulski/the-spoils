// Generic capabilities (unit EU5, Decade of Deckadence), synthetic fixtures only:
//  - the `lostInfluenceThisTurn` condition ("if an opponent's faction lost influence this turn") and the per-player
//    `GameState.influenceLostThisTurn` tally behind it;
//  - the `setInfluence` effect plus the `factionStartingInfluence` expression ("set your influence to your faction's
//    starting influence");
//  - `moveCard` letting a "would go to a discard pile" replacement that names no `from` see a RESOLVING TACTIC
//    (deploying -> discard, CR 205.2), which it used to miss.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, Condition, NumberExpression, PlayerId } from "../../engine.js";
import {
  autoResolveBattle,
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  item,
  P1,
  P2,
  resolvePendingResponses,
  tactic
} from "./support/fixtures.js";
import { endTurn } from "./clauses/_turn.js";

type Built = ReturnType<typeof buildGame>;
type Cards = NonNullable<Parameters<typeof buildGame>[0]>["cards"];

const activate = (g: Built, player: PlayerId, key: string, abilityId: string, selected: Record<string, string[]> = {}): void => {
  g.engine.perform({ type: "activateAbility", playerId: player, cardId: g.id(key), abilityId, selected } as never);
  resolvePendingResponses(g.engine);
};

const OPP = { type: "factionOf", player: "opponent" } as const;

/** P1's item: one ability per way of changing influence. */
const lever = (): CardDefinition =>
  item({
    name: "Lever",
    behavior: {
      abilities: [
        { id: "drain-opp-2", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] },
        { id: "drain-opp-1", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] },
        { id: "boost-opp-3", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: 3 }] },
        { id: "burn-opp-3", type: "activated", effects: [{ type: "dealDamage", target: OPP, amount: 3 }] },
        { id: "pay-2", type: "activated", costs: [{ type: "loseInfluence", amount: 2 }], effects: [] },
        { id: "set-opp-5", type: "activated", effects: [{ type: "setInfluence", player: "opponent", amount: 5 }] },
        { id: "set-opp-neg", type: "activated", effects: [{ type: "setInfluence", player: "opponent", amount: -4 }] }
      ]
    }
  });

/** An item whose `read` ability gives its controller +1 influence when the condition holds, +0 otherwise. */
const readerOf = (cond: Condition): CardDefinition =>
  item({
    name: "Reader",
    behavior: {
      abilities: [
        {
          id: "read",
          type: "activated",
          effects: [{ type: "modifyInfluence", player: "controller", amount: { type: "conditional", if: cond, then: 1, else: 0 } }]
        }
      ]
    }
  });

const lostBy = (player: "controller" | "opponent"): Condition => ({ type: "lostInfluenceThisTurn", player });

function board(extra: Cards = [], options: Partial<NonNullable<Parameters<typeof buildGame>[0]>> = {}): Built {
  return buildGame({
    ...options,
    cards: [
      { key: "lever", def: lever(), owner: P1, zone: "play" },
      { key: "readOpp", def: readerOf(lostBy("opponent")), owner: P1, zone: "play" },
      { key: "readMine", def: readerOf(lostBy("controller")), owner: P1, zone: "play" },
      ...(extra ?? [])
    ]
  });
}

/** Whether the condition read "yes" for P1's reader card `key`. */
const reads = (g: Built, key: string): boolean => {
  const before = g.engine.state.players[P1].influence;
  activate(g, P1, key, "read");
  return g.engine.state.players[P1].influence - before === 1;
};

describe("lostInfluenceThisTurn condition", () => {
  test("false before anyone loses influence", () => {
    const g = board();
    assert.equal(reads(g, "readOpp"), false);
    assert.equal(reads(g, "readMine"), false);
  });

  test("a modifyInfluence loss counts for the player whose faction lost, and only that player", () => {
    const g = board();
    activate(g, P1, "lever", "drain-opp-1");
    assert.equal(g.engine.state.players[P2].influence, 24);
    assert.equal(reads(g, "readOpp"), true);
    assert.equal(reads(g, "readMine"), false);
  });

  test("damage inflicted to the faction counts (CR 408.3)", () => {
    const g = board();
    activate(g, P1, "lever", "burn-opp-3");
    assert.equal(g.engine.state.players[P2].influence, 22);
    assert.equal(reads(g, "readOpp"), true);
  });

  test("battle damage to the faction counts", () => {
    const g = board([{ key: "atk", def: character({ name: "Atk", strength: 2 }), owner: P1, zone: "play" }]);
    g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("atk")], target: { type: "faction", playerId: P2 } } as never);
    resolvePendingResponses(g.engine);
    g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(g.engine);
    assert.equal(g.engine.state.players[P2].influence, 23);
    assert.equal(reads(g, "readOpp"), true);
  });

  test("an influence COST counts for the payer", () => {
    const g = board();
    activate(g, P1, "lever", "pay-2");
    assert.equal(g.engine.state.players[P1].influence, 23);
    assert.equal(reads(g, "readMine"), true);
    assert.equal(reads(g, "readOpp"), false);
  });

  test("a gain, and setting influence (even downward), are not a loss", () => {
    const g = board();
    activate(g, P1, "lever", "boost-opp-3");
    assert.equal(reads(g, "readOpp"), false);
    activate(g, P1, "lever", "set-opp-5");
    assert.equal(g.engine.state.players[P2].influence, 5);
    assert.equal(reads(g, "readOpp"), false, "28 -> 5 by a set is not 'loses influence'");
  });

  test("a loss reduced to nothing by an influence modifier (Tax Attorney) is not a loss", () => {
    const shield = item({
      name: "Shield",
      behavior: { abilities: [{ id: "shield", type: "continuous", modifiers: [], influenceModifiers: [{ player: "self", direction: "loss", delta: 1 }] }] }
    });
    const g = board([{ key: "shield", def: shield, owner: P2, zone: "play" }]);
    activate(g, P1, "lever", "drain-opp-1");
    assert.equal(g.engine.state.players[P2].influence, 25, "the loss of 1 was reduced to 0");
    assert.equal(reads(g, "readOpp"), false);
    activate(g, P1, "lever", "drain-opp-2");
    assert.equal(g.engine.state.players[P2].influence, 24);
    assert.equal(reads(g, "readOpp"), true, "2 reduced by 1 is still a loss of 1");
  });

  test("records the influence actually lost: a loss that would go below 0 stops at 0 (CR 410.4)", () => {
    const g = board([], { playerB: { influence: 3 } });
    activate(g, P1, "lever", "drain-opp-2");
    assert.equal(g.engine.state.influenceLostThisTurn[P2], 2);
    assert.equal(reads(g, "readOpp"), true);
    activate(g, P1, "lever", "drain-opp-2");
    assert.equal(g.engine.state.players[P2].influence, 0);
    assert.equal(g.engine.state.influenceLostThisTurn[P2], 3, "only the 1 left to lose");
  });

  test("the tally starts over each turn", () => {
    const g = board();
    activate(g, P1, "lever", "drain-opp-1");
    assert.equal(reads(g, "readOpp"), true);
    endTurn(g.engine, P1);
    endTurn(g.engine, P2);
    assert.equal(g.engine.state.activePlayerId, P1);
    assert.equal(reads(g, "readOpp"), false);
    activate(g, P1, "lever", "drain-opp-1");
    assert.equal(reads(g, "readOpp"), true);
  });
});

describe("setInfluence effect and factionStartingInfluence expression", () => {
  const setToStart: NumberExpression = { type: "factionStartingInfluence", player: "controller" };
  const reset = (): CardDefinition =>
    item({
      name: "Reset",
      behavior: { abilities: [{ id: "reset", type: "activated", effects: [{ type: "setInfluence", player: "controller", amount: setToStart }] }] }
    });
  const factionWith = (startingInfluence: number): CardDefinition =>
    factionCard({ faction: defaultFactionDefinition({ startingInfluence }) });

  test("sets the faction's influence to its own starting influence, up or down", () => {
    const g = buildGame({
      playerA: { faction: factionWith(30), influence: 12 },
      cards: [{ key: "reset", def: reset(), owner: P1, zone: "play" }]
    });
    activate(g, P1, "reset", "reset");
    assert.equal(g.engine.state.players[P1].influence, 30);
    g.engine.state.players[P1].influence = 41;
    activate(g, P1, "reset", "reset");
    assert.equal(g.engine.state.players[P1].influence, 30);
  });

  test("each player reads their own faction's number", () => {
    const opp = item({
      name: "OppReset",
      behavior: {
        abilities: [
          {
            id: "r",
            type: "activated",
            effects: [{ type: "setInfluence", player: "opponent", amount: { type: "factionStartingInfluence", player: "opponent" } }]
          }
        ]
      }
    });
    const g = buildGame({
      playerA: { faction: factionWith(20), influence: 3 },
      playerB: { faction: factionWith(28), influence: 3 },
      cards: [
        { key: "reset", def: reset(), owner: P1, zone: "play" },
        { key: "opp", def: opp, owner: P1, zone: "play" }
      ]
    });
    activate(g, P1, "reset", "reset");
    assert.equal(g.engine.state.players[P1].influence, 20);
    assert.equal(g.engine.state.players[P2].influence, 3);
    activate(g, P1, "opp", "r");
    assert.equal(g.engine.state.players[P2].influence, 28);
  });

  test("a flipped double-sided faction reads the side that is face up", () => {
    const front = factionCard({
      name: "Front",
      faction: defaultFactionDefinition({
        startingInfluence: 25,
        turn: {
          restore: { detachResources: true, restoreNonResources: true },
          develop: { choices: [] },
          endOfTurnEffects: [{ type: "flipCoin", winEffects: [{ type: "flipFactionCard", target: "source" }], loseEffects: [] }]
        },
        flipsTo: "back"
      })
    });
    const back = factionCard({ id: "back", name: "Back", faction: defaultFactionDefinition({ startingInfluence: 22, flipsTo: front.id }) });
    const g = buildGame({
      playerA: { faction: front, influence: 9 },
      cards: [
        { key: "back-stash", def: back, owner: P2, zone: "deck" },
        { key: "reset", def: reset(), owner: P1, zone: "play" }
      ],
      random: () => 0.1
    });
    activate(g, P1, "reset", "reset");
    assert.equal(g.engine.state.players[P1].influence, 25, "front side");
    endTurn(g.engine, P1);
    assert.equal(g.engine.getDefinition(g.engine.state.players[P1].factionId!).name, "Back");
    endTurn(g.engine, P2);
    activate(g, P1, "reset", "reset");
    assert.equal(g.engine.state.players[P1].influence, 22, "back side");
  });

  test("never sets below 0 (CR 410.4); influence modifiers do not touch it and it is not a loss", () => {
    const shield = item({
      name: "Shield",
      behavior: { abilities: [{ id: "shield", type: "continuous", modifiers: [], influenceModifiers: [{ player: "self", direction: "any", delta: 1 }] }] }
    });
    const g = board([{ key: "shield", def: shield, owner: P2, zone: "play" }]);
    activate(g, P1, "lever", "set-opp-5");
    assert.equal(g.engine.state.players[P2].influence, 5, "the modifier did not touch the set");
    activate(g, P1, "lever", "set-opp-neg");
    assert.equal(g.engine.state.players[P2].influence, 0);
    assert.equal(g.engine.state.influenceLostThisTurn[P2] ?? 0, 0);
  });

  test("reports the change with an influenceChanged event, and nothing when it already matches", () => {
    const g = buildGame({
      playerA: { faction: factionWith(30), influence: 30 },
      cards: [{ key: "reset", def: reset(), owner: P1, zone: "play" }]
    });
    const logBefore = g.engine.state.gameLog.length;
    activate(g, P1, "reset", "reset");
    assert.equal(g.engine.state.players[P1].influence, 30);
    g.engine.state.players[P1].influence = 10;
    activate(g, P1, "reset", "reset");
    assert.equal(g.engine.state.players[P1].influence, 30);
    assert.ok(g.engine.state.gameLog.length > logBefore);
  });
});

describe("a 'would go to a discard pile, void it instead' replacement (Purifier of the Fallen shape) sees a resolving tactic", () => {
  const voider = (from?: "play" | "hand"): CardDefinition =>
    item({
      name: "Voider",
      behavior: {
        abilities: [
          {
            id: "void-instead",
            type: "replacement",
            replaces: { event: "moveToZone", zone: "discard", controlledBy: "any", ...(from ? { from } : {}) },
            effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "void" }]
          }
        ]
      }
    });
  const poke = (): CardDefinition =>
    tactic({
      name: "Poke",
      behavior: { abilities: [{ id: "p", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] }] }
    });
  const smite = (): CardDefinition =>
    tactic({
      name: "Smite",
      behavior: {
        abilities: [
          {
            id: "s",
            type: "activated",
            targets: [{ id: "t", selector: { type: "character", zone: "play" }, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });
  const zone = (g: Built, key: string) => g.engine.state.cards[g.id(key)].zone;
  const cast = (g: Built, key: string, selected: Record<string, string[]> = {}) => {
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id(key), selected } as never);
    resolvePendingResponses(g.engine);
  };

  test("with no 'from' the resolved tactic is voided, and a destroyed character too", () => {
    const g = buildGame({
      cards: [
        { key: "voider", def: voider(), owner: P2, zone: "play" },
        { key: "poke", def: poke(), owner: P1, zone: "hand" },
        { key: "smite", def: smite(), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P1, zone: "play" }
      ]
    });
    cast(g, "poke");
    assert.equal(g.engine.state.players[P2].influence, 24, "the tactic's effects still resolved");
    assert.equal(zone(g, "poke"), "void");
    cast(g, "smite", { t: [g.id("victim")] });
    assert.equal(zone(g, "victim"), "void");
    assert.equal(zone(g, "smite"), "void");
  });

  test("a replacement limited to 'from: play' (or 'from: hand') does not reach a tactic leaving the stack", () => {
    for (const from of ["play", "hand"] as const) {
      const g = buildGame({
        cards: [
          { key: "voider", def: voider(from), owner: P2, zone: "play" },
          { key: "poke", def: poke(), owner: P1, zone: "hand" }
        ]
      });
      cast(g, "poke");
      assert.equal(zone(g, "poke"), "discard", `from: ${from}`);
    }
  });

  test("without any replacement a resolved tactic still goes to the discard pile", () => {
    const g = buildGame({ cards: [{ key: "poke", def: poke(), owner: P1, zone: "hand" }] });
    cast(g, "poke");
    assert.equal(zone(g, "poke"), "discard");
  });

  test("a character that resolves into play is not touched by a discard replacement", () => {
    const g = buildGame({
      cards: [
        { key: "voider", def: voider(), owner: P2, zone: "play" },
        { key: "guy", def: character({ name: "Guy" }), owner: P1, zone: "hand" }
      ]
    });
    cast(g, "guy");
    assert.equal(zone(g, "guy"), "play");
  });
});
