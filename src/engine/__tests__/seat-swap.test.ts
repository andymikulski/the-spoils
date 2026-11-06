// Seat swap (RULES.md §12 "Seat swap"): `ContinuousAbility.swapsSides` — the
// players switch seats, and each is in control of the other's side. Control of
// every card in play and of both factions passes to the opposing player while
// the source is in play; hands, decks and discard piles stay with their owners;
// "the owner of the winning deck wins" (the loser at 0 influence is the
// faction's owner, CR §102.1). Synthetic fixtures only — Emergency Obfuscation
// itself is covered per printing in per-card/printed-variants.test.ts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  autoResolveBattle,
  buildGame,
  character,
  factionCard,
  item,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./support/fixtures.js";
import { developPlay, settleTurnStart } from "./support/develop.js";
import { loadGame, saveGame } from "../../engine.js";
import type { CardDefinition, SpoilsEngine } from "../../engine.js";

type Built = ReturnType<typeof buildGame>;

/** A free item whose only rules text is the seat swap. */
const swapper = (overrides: Partial<CardDefinition> = {}): CardDefinition =>
  item({
    name: "Seat Swapper",
    cost: 0,
    behavior: {
      abilities: [{ id: "swap", type: "continuous", modifiers: [], swapsSides: true }]
    },
    ...overrides
  });

/** A faction whose develop rule can play a resource, so a test can develop mid-swap. */
const developFaction = (name: string): CardDefinition =>
  factionCard({
    name,
    faction: {
      startingInfluence: 25,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
      turn: {
        restore: { detachResources: true, restoreNonResources: true },
        develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
      }
    }
  });

const rage = (name = "Rage"): CardDefinition =>
  resourceCard({ name, resource: { provides: ["rage"], staple: true } });

const playIt = (engine: SpoilsEngine, who: string, cardId: string): void => {
  engine.perform({ type: "playCard", playerId: who, cardId });
  resolvePendingResponses(engine);
};

/** The controller of the card placed under `key`. */
const controllerOf = (b: Built, key: string): string => b.engine.state.cards[b.id(key)].controllerId;

/** P1 (active) has a hero + resource; P2 has a guard + resource; the swapper waits in P1's hand. */
function board(extra: Parameters<typeof buildGame>[0] = {}): Built {
  return buildGame({
    cards: [
      { key: "hero", def: character({ name: "Hero" }), owner: P1 },
      { key: "res1", def: rage(), owner: P1 },
      { key: "guard", def: character({ name: "Guard" }), owner: P2 },
      { key: "res2", def: rage(), owner: P2 },
      { key: "swapper", def: swapper(), owner: P1, zone: "hand" }
    ],
    ...extra
  });
}

describe("seat swap — entering play", () => {
  test("every card in play, both factions and the resources included, goes to the other player", () => {
    const b = board();
    const { engine, id } = b;
    const factionA = engine.state.players[P1].factionId!;
    const factionB = engine.state.players[P2].factionId!;
    playIt(engine, P1, id("swapper"));

    assert.ok(engine.state.seatSwap, "the swap is in effect");
    assert.equal(engine.getFlowView().seatsSwapped, true);
    assert.equal(controllerOf(b, "hero"), P2);
    assert.equal(controllerOf(b, "res1"), P2);
    assert.equal(controllerOf(b, "guard"), P1);
    assert.equal(controllerOf(b, "res2"), P1);
    assert.equal(engine.state.cards[factionA].controllerId, P2);
    assert.equal(engine.state.cards[factionB].controllerId, P1);
    // The swapper itself is a card in play on the side it was played to.
    assert.equal(controllerOf(b, "swapper"), P2);
    // "Your faction" follows control.
    assert.equal(engine.state.players[P1].factionId, factionB);
    assert.equal(engine.state.players[P2].factionId, factionA);
    assert.equal(engine.getFactionCard(P1)?.id, factionB);
  });

  test("the play arrays follow control, so resources and thresholds are the other side's", () => {
    const b = board();
    const { engine, id } = b;
    playIt(engine, P1, id("swapper"));
    const p1Play = engine.state.players[P1].play;
    assert.ok(p1Play.includes(id("guard")) && p1Play.includes(id("res2")), "p1Play.includes(id(\"guard\")) && p1Play.includes(id(\"res2\"))");
    assert.ok(!p1Play.includes(id("hero")) && !p1Play.includes(id("res1")), "!p1Play.includes(id(\"hero\")) && !p1Play.includes(id(\"res1\"))");
    assert.deepEqual(engine.getAvailableResourceIds(P1), [id("res2")]);
    assert.deepEqual(engine.getAvailableResourceIds(P2), [id("res1")]);
  });

  test("ownership never changes (CR §407.8)", () => {
    const b = board();
    const { engine, id } = b;
    playIt(engine, P1, id("swapper"));
    assert.equal(engine.state.cards[id("hero")].ownerId, P1);
    assert.equal(engine.state.cards[id("guard")].ownerId, P2);
    assert.equal(engine.state.cards[engine.state.players[P1].factionId!].ownerId, P2);
  });

  test("whose turn it is, and who holds priority, are unaffected", () => {
    const b = board();
    const { engine, id } = b;
    playIt(engine, P1, id("swapper"));
    assert.equal(engine.state.activePlayerId, P1);
    assert.equal(engine.getFlowView().mode, "main");
    assert.equal(engine.state.priorityPlayerId, P1);
  });

  test("hands, decks and discard piles stay with their owners", () => {
    const filler = character({ name: "Filler" });
    const b = buildGame({
      cards: [
        { key: "swapper", def: swapper(), owner: P1, zone: "hand" },
        { key: "h1", def: filler, owner: P1, zone: "hand" },
        { key: "h2", def: filler, owner: P2, zone: "hand" },
        { key: "d1", def: filler, owner: P1, zone: "deck" },
        { key: "d2", def: filler, owner: P2, zone: "deck" },
        { key: "x1", def: filler, owner: P1, zone: "discard" },
        { key: "x2", def: filler, owner: P2, zone: "discard" }
      ]
    });
    const { engine, id } = b;
    playIt(engine, P1, id("swapper"));
    assert.deepEqual(engine.state.players[P1].hand, [id("h1")]);
    assert.deepEqual(engine.state.players[P2].hand, [id("h2")]);
    assert.deepEqual(engine.state.players[P1].deck, [id("d1")]);
    assert.deepEqual(engine.state.players[P2].deck, [id("d2")]);
    assert.deepEqual(engine.state.players[P1].discard, [id("x1")]);
    assert.deepEqual(engine.state.players[P2].discard, [id("x2")]);
  });

  test("a seat-swap event is emitted and logged", () => {
    const b = board();
    const { engine, id } = b;
    playIt(engine, P1, id("swapper"));
    assert.ok(engine.getLog().some(entry => entry.event?.type === "seatsSwapped"), "engine.getLog().some(entry => entry.event?.type === \"seatsSwapped\")");
  });

  test("damage and counters ride along with the card", () => {
    const b = buildGame({
      cards: [
        { key: "hero", def: character({ name: "Hero", life: 5 }), owner: P1, damage: 2, counters: { token: 3 }, depleted: true },
        { key: "swapper", def: swapper(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = b;
    playIt(engine, P1, id("swapper"));
    const hero = engine.state.cards[id("hero")];
    assert.equal(hero.controllerId, P2);
    assert.equal(hero.damage, 2);
    assert.equal(hero.counters.token, 3);
    assert.equal(hero.depleted, true);
  });

  test("a card that cannot be taken control of keeps its controller", () => {
    const anchor = character({
      name: "Anchor",
      behavior: {
        abilities: [
          {
            id: "own",
            type: "continuous",
            modifiers: [],
            restrictions: [{ target: "source", restriction: "cannotBeTakenControl" }]
          }
        ]
      }
    });
    const b = buildGame({
      cards: [
        { key: "anchor", def: anchor, owner: P1 },
        { key: "hero", def: character({ name: "Hero" }), owner: P1 },
        { key: "swapper", def: swapper(), owner: P1, zone: "hand" }
      ]
    });
    playIt(b.engine, P1, b.id("swapper"));
    assert.equal(controllerOf(b, "anchor"), P1);
    assert.equal(controllerOf(b, "hero"), P2);
  });
});

/** A free tactic that destroys the targeted item. */
const smash = (): CardDefinition =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

const smashIt = (engine: SpoilsEngine, who: string, smashId: string, targetId: string): void => {
  engine.perform({ type: "playCard", playerId: who, cardId: smashId, selected: { t: [targetId] } });
  resolvePendingResponses(engine);
};

describe("seat swap — leaving play", () => {
  function swapped(extra: Parameters<typeof buildGame>[0] = {}): Built {
    const b = board({
      ...extra,
      cards: [
        { key: "hero", def: character({ name: "Hero" }), owner: P1 },
        { key: "res1", def: rage(), owner: P1 },
        { key: "guard", def: character({ name: "Guard" }), owner: P2 },
        { key: "res2", def: rage(), owner: P2 },
        { key: "swapper", def: swapper(), owner: P1, zone: "hand" },
        { key: "smash", def: smash(), owner: P1, zone: "hand" },
        { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" },
        ...(extra.cards ?? [])
      ]
    });
    playIt(b.engine, P1, b.id("swapper"));
    return b;
  }

  test("destroying the source puts everyone back and lifts the swap", () => {
    const b = swapped();
    const { engine, id } = b;
    smashIt(engine, P1, id("smash"), id("swapper"));

    assert.equal(engine.state.seatSwap, undefined);
    assert.equal(engine.getFlowView().seatsSwapped, false);
    assert.equal(controllerOf(b, "hero"), P1);
    assert.equal(controllerOf(b, "res1"), P1);
    assert.equal(controllerOf(b, "guard"), P2);
    assert.equal(controllerOf(b, "res2"), P2);
    assert.equal(engine.state.cards[engine.state.players[P1].factionId!].ownerId, P1, "each player holds their own faction again");
    assert.equal(engine.state.cards[engine.state.players[P2].factionId!].ownerId, P2);
    assert.equal(engine.getLog().filter(entry => entry.event?.type === "seatsSwapped").length, 2);
  });

  test("influence travels with its faction, both ways", () => {
    const b = swapped({ playerA: { influence: 11 }, playerB: { influence: 22 } });
    const { engine, id } = b;
    assert.equal(engine.state.players[P1].influence, 22, "P1 now holds P2's faction");
    assert.equal(engine.state.players[P2].influence, 11);
    smashIt(engine, P1, id("smash"), id("swapper"));
    assert.equal(engine.state.players[P1].influence, 11);
    assert.equal(engine.state.players[P2].influence, 22);
  });

  test("a card played while the seats were swapped stays with the player who played it", () => {
    const b = swapped();
    const { engine, id } = b;
    playIt(engine, P1, id("newbie"));
    assert.equal(controllerOf(b, "newbie"), P1);
    smashIt(engine, P1, id("smash"), id("swapper"));
    assert.equal(controllerOf(b, "newbie"), P1);
    assert.equal(controllerOf(b, "hero"), P1);
    assert.ok(engine.state.players[P1].play.includes(id("newbie")), "engine.state.players[P1].play.includes(id(\"newbie\"))");
  });

  test("the develop rule is the held faction's, and a resource developed while swapped stays with its developer", () => {
    // P1 holds P2's faction while swapped, so it is P2's faction that decides what P1's develop offers.
    const b = swapped({
      playerB: { faction: developFaction("DevB") },
      cards: [{ key: "newRes", def: rage("NewRage"), owner: P1, zone: "hand" }]
    });
    const { engine, id } = b;
    developPlay(engine, P1, id("newRes"), false);
    resolvePendingResponses(engine);
    assert.equal(controllerOf(b, "newRes"), P1);
    smashIt(engine, P1, id("smash"), id("swapper"));
    assert.equal(controllerOf(b, "newRes"), P1);
  });

  test("a swapped card that left play is left alone when the swap is lifted", () => {
    const b = swapped();
    const { engine, id } = b;
    // Bounce the swapped hero to its owner's hand: it is nobody's but its owner's now.
    engine.resolveEffect(
      { type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" },
      { sourceId: id("swapper"), controllerId: P2, selected: { t: [id("hero")] } }
    );
    assert.equal(engine.state.cards[id("hero")].zone, "hand");
    smashIt(engine, P1, id("smash"), id("swapper"));
    assert.equal(engine.state.cards[id("hero")].zone, "hand");
    assert.equal(controllerOf(b, "hero"), P1);
  });

  test("a permanent take-control during the swap outlasts it", () => {
    const thief = character({
      name: "Thief",
      behavior: {
        abilities: [
          {
            id: "steal",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "opponent", type: "character" }, count: 1 }],
            effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
          }
        ]
      }
    });
    const b = swapped({ cards: [{ key: "thief", def: thief, owner: P2, attackEligible: false }] });
    const { engine, id } = b;
    // The swap handed P2's Thief to P1, and P1's Hero to P2.
    assert.equal(controllerOf(b, "thief"), P1);
    assert.equal(controllerOf(b, "hero"), P2);
    engine.perform({
      type: "activateAbility",
      playerId: P1,
      cardId: id("thief"),
      abilityId: "steal",
      selected: { t: [id("hero")] }
    });
    resolvePendingResponses(engine);
    assert.equal(controllerOf(b, "hero"), P1);
    // P1's own Guard-side card (P2's thief) is still P1's; now steal it back for P2 isn't needed —
    // lifting the swap must leave Hero with its thief and return the rest.
    smashIt(engine, P1, id("smash"), id("swapper"));
    assert.equal(controllerOf(b, "hero"), P1);
    assert.equal(controllerOf(b, "thief"), P2);
  });
});

describe("seat swap — several sources", () => {
  test("two sources cancel; removing one swaps the seats", () => {
    const b = buildGame({
      cards: [
        { key: "hero", def: character({ name: "Hero" }), owner: P1 },
        { key: "guard", def: character({ name: "Guard" }), owner: P2 },
        { key: "first", def: swapper({ name: "First" }), owner: P1 },
        { key: "second", def: swapper({ name: "Second" }), owner: P1, zone: "hand" },
        { key: "smash", def: smash(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = b;
    // The hand-built first source is already in play: the swap takes hold at the next check.
    playIt(engine, P1, id("second"));
    assert.equal(engine.state.seatSwap, undefined, "two swaps leave the players in their own seats");
    assert.equal(controllerOf(b, "hero"), P1);
    smashIt(engine, P1, id("smash"), id("first"));
    assert.ok(engine.state.seatSwap, "one source left: swapped");
    assert.equal(controllerOf(b, "hero"), P2);
    assert.equal(controllerOf(b, "guard"), P1);
  });
});

describe("seat swap — control changes during the swap", () => {
  test("the latest permanent take-control wins over the swap when it is lifted", () => {
    const b = buildGame({
      cards: [
        { key: "hero", def: character({ name: "Hero" }), owner: P1 },
        { key: "swapper", def: swapper(), owner: P1, zone: "hand" },
        { key: "smash", def: smash(), owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = b;
    playIt(engine, P1, id("swapper"));
    const grab = (who: string): void =>
      engine.resolveEffect(
        { type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" },
        { sourceId: id("swapper"), controllerId: who, selected: { t: [id("hero")] } }
      );
    assert.equal(controllerOf(b, "hero"), P2, "the swap handed Hero to P2");
    grab(P1);
    assert.equal(controllerOf(b, "hero"), P1);
    grab(P2);
    assert.equal(controllerOf(b, "hero"), P2);
    smashIt(engine, P1, id("smash"), id("swapper"));
    assert.equal(controllerOf(b, "hero"), P2, "P2's grab was the most recent effect (CR 407.3a)");
  });
});

describe("seat swap — playing on the other side", () => {
  test("costs are paid from the resources the player now controls", () => {
    const priced = character({ name: "Priced", cost: 1 });
    const b = buildGame({
      cards: [
        { key: "res2", def: rage(), owner: P2 },
        { key: "swapper", def: swapper(), owner: P1, zone: "hand" },
        { key: "priced", def: priced, owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = b;
    // P1 owns no resources, so the card can't be paid for yet.
    assert.throws(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("priced") }));
    playIt(engine, P1, id("swapper"));
    playIt(engine, P1, id("priced"));
    assert.equal(engine.state.cards[id("priced")].zone, "play");
    assert.equal(
      engine.state.cards[id("res2")].attachedTo,
      engine.getFactionCard(P1)?.id,
      "P2's resource was spent, attached to the faction P1 now holds"
    );
  });
});

describe("seat swap — combat and the win condition", () => {
  /** P1 swaps the seats and passes; it is P2's turn, commanding P1's old side. */
  function p2Turn(influenceA: number, influenceB: number): Built {
    const b = buildGame({
      playerA: { influence: influenceA },
      playerB: { influence: influenceB },
      cards: [
        { key: "hero", def: character({ name: "Hero", strength: 4 }), owner: P1 },
        { key: "guard", def: character({ name: "Guard", strength: 4 }), owner: P2 },
        { key: "swapper", def: swapper(), owner: P1, zone: "hand" }
      ]
    });
    playIt(b.engine, P1, b.id("swapper"));
    b.engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(b.engine);
    settleTurnStart(b.engine);
    return b;
  }

  test("the new turn's player commands the characters on the side they now hold", () => {
    const b = p2Turn(25, 25);
    const { engine, id } = b;
    assert.equal(engine.state.activePlayerId, P2);
    // Hero is P1's card, but P2 controls it: it can attack from the start of P2's turn.
    assert.equal(engine.state.cards[id("hero")].attackEligibleTurn, engine.state.turn);
    assert.equal(engine.state.cards[id("guard")].attackEligibleTurn, undefined);
  });

  test("an attack hits the faction the opponent holds (the attacker's own), and its owner loses", () => {
    const b = p2Turn(25, 3);
    const { engine, id } = b;
    // P2 commands Hero (P1's card) and attacks "P1's faction": the faction P1 holds is P2's own (3 influence).
    assert.equal(engine.state.players[P1].influence, 3);
    engine.perform({
      type: "declareAttack",
      playerId: P2,
      attackerIds: [id("hero")],
      target: { type: "faction", playerId: P1 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
    autoResolveBattle(engine);

    assert.ok(engine.state.players[P1].influence <= 0, "engine.state.players[P1].influence <= 0");
    // The faction at 0 is P2's (CR 102.1: its owner loses), so P1, the owner of Hero's deck, wins.
    assert.equal(engine.state.winner, P1);
    assert.equal(engine.getFlowView().mode, "gameOver");
  });

  test("with the seats in their own places the usual owner-loses result holds", () => {
    const b = buildGame({
      playerB: { influence: 3 },
      cards: [{ key: "hero", def: character({ name: "Hero", strength: 4 }), owner: P1 }]
    });
    const { engine, id } = b;
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("hero")],
      target: { type: "faction", playerId: P2 }
    });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(engine);
    assert.equal(engine.state.winner, P1);
  });

  test("a faction-damage effect lands on the faction the target player holds", () => {
    const burn = tactic({
      name: "Burn",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "b",
            type: "activated",
            targets: [],
            effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 5 }]
          }
        ]
      }
    });
    const b = buildGame({
      playerA: { influence: 20 },
      playerB: { influence: 10 },
      cards: [
        { key: "swapper", def: swapper(), owner: P1, zone: "hand" },
        { key: "burn", def: burn, owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = b;
    playIt(engine, P1, id("swapper"));
    playIt(engine, P1, id("burn"));
    // "Your opponent's faction" is the one P2 holds: P1's own, 20 influence.
    assert.equal(engine.state.players[P2].influence, 15);
    assert.equal(engine.state.players[P1].influence, 10);
  });
});

describe("seat swap — mid-battle and tactic timing", () => {
  const tacticalSwapper = (): CardDefinition =>
    swapper({
      behavior: {
        keywords: ["tactical"],
        abilities: [{ id: "swap", type: "continuous", modifiers: [], swapsSides: true }]
      }
    });

  test("played as a tactic while an attack is pending, the swap pulls both parties out of the battle", () => {
    const b = buildGame({
      cards: [
        { key: "hero", def: character({ name: "Hero", strength: 5 }), owner: P1 },
        { key: "guard", def: character({ name: "Guard" }), owner: P2 },
        { key: "swapper", def: tacticalSwapper(), owner: P2, zone: "hand" }
      ],
      playerB: { influence: 4 }
    });
    const { engine, id } = b;
    engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("hero")],
      target: { type: "faction", playerId: P2 }
    });
    // The attacker passes; P2 answers in the post-attack window with the tactical swap.
    engine.perform({ type: "passPriority", playerId: P1 });
    engine.perform({ type: "playCard", playerId: P2, cardId: id("swapper") });
    resolvePendingResponses(engine);

    assert.ok(engine.state.seatSwap, "the swap resolved");
    assert.equal(controllerOf(b, "hero"), P2);
    // Hero is no longer P1's (CR 407.4), so the party is empty, the battle is over at once and no battle damage is dealt.
    assert.equal(engine.state.battle, undefined);
    autoResolveBattle(engine);
    assert.equal(engine.state.winner, undefined);
    assert.equal(engine.state.players[P1].influence, 4, "P2's faction, now held by P1, took no damage");
    assert.equal(engine.getFlowView().mode, "main");
    assert.equal(engine.state.activePlayerId, P1);
  });
});

describe("seat swap — saving a game", () => {
  test("the swap survives a save and load, and can still be lifted", () => {
    const defs = [swapper(), smash(), character({ name: "Hero" })];
    const b = buildGame({
      cards: [
        { key: "hero", def: defs[2], owner: P1 },
        { key: "swapper", def: defs[0], owner: P1, zone: "hand" },
        { key: "smash", def: defs[1], owner: P1, zone: "hand" }
      ]
    });
    const { engine, id } = b;
    playIt(engine, P1, id("swapper"));
    const catalog = Object.values(engine.definitions);
    const loaded = loadGame(saveGame(engine), catalog);
    assert.ok(loaded.state.seatSwap, "loaded.state.seatSwap");
    assert.equal(loaded.state.cards[id("hero")].controllerId, P2);
    smashIt(loaded, P1, id("smash"), id("swapper"));
    assert.equal(loaded.state.seatSwap, undefined);
    assert.equal(loaded.state.cards[id("hero")].controllerId, P1);
  });
});
