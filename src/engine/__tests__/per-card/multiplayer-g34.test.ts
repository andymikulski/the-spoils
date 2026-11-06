// Multiplayer per-card fixes (docs/MULTIPLAYER-PLAN.md, audit data/multiplayer-audit/g3.json + g4.json).
// Each card below is loaded from the real catalog and played at a three-player table, asserting the
// printed text's multiplayer reading (each opponent / any opponent / the picked player ...), plus,
// where cheap, a two-player assertion that the classic behavior is unchanged.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  P1,
  P2,
  activate,
  bank,
  banks,
  buildGame,
  cardDef,
  character,
  developFaction,
  item,
  killTactic,
  play,
  resolvePendingResponses,
  resourceCard,
  settleStartFirst,
  volition
} from "./_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";

const P3 = "p3";
const SEATS = [P1, P2, P3].map(id => ({ id, faction: developFaction() }));

type Game = ReturnType<typeof buildGame>;

/** A three-player table in the middle of p1's turn (unless `activePlayerId` says otherwise). */
function table(cards: CardPlacement[], opts: { activePlayerId?: PlayerId; players?: 2 | 3 } = {}): Game {
  return buildGame({
    players: opts.players === 2 ? SEATS.slice(0, 2) : SEATS,
    cards,
    ...(opts.activePlayerId ? { activePlayerId: opts.activePlayerId } : {})
  });
}

const cd = (set: string, name: string): CardDefinition => cardDef(set, name);

/** Plain characters in play for `owner`, keyed `<prefix>0..n-1`. */
function chars(prefix: string, n: number, owner: PlayerId, over: Partial<CardDefinition> = {}, zone: "play" | "hand" | "deck" = "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: character({ name: `${prefix.toUpperCase()}${i}`, strength: 2, life: 9, cost: 0, ...over }),
    owner,
    zone
  }));
}

const influence = (engine: SpoilsEngine) => Object.fromEntries(Object.values(engine.state.players).map(p => [p.id, p.influence]));
const zoneOf = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].zone;
const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as { kind: string; playerId: string; [k: string]: unknown } | undefined;

type Answer = (pc: NonNullable<ReturnType<typeof pending>>) => unknown;

/** Legal candidates of a pending `chooserSelectsTarget`. */
function candidatesOf(engine: SpoilsEngine, pc: NonNullable<ReturnType<typeof pending>>): string[] {
  const declaration = pc.declaration as { selector: never; count: number };
  return engine.targetCandidates(declaration.selector, pc.context as never, pc.playerId).map(c => c.id);
}

/** Answers every pending choice with `answer` (a choice, or undefined to decline / pick nothing); records who was asked what. */
function drain(engine: SpoilsEngine, answer: Answer = () => undefined, budget = 60): string[] {
  const asked: string[] = [];
  resolvePendingResponses(engine);
  for (let n = 0; engine.state.pendingChoice && n < budget; n++) {
    const pc = pending(engine)!;
    asked.push(`${pc.playerId}:${pc.kind}`);
    const given = answer(pc);
    const choice =
      given ??
      (() => {
        switch (pc.kind) {
          case "mayPay":
          case "anyPlayerMayPay":
            return { kind: pc.kind, pay: false };
          case "chooserSelectsOption":
            return { kind: "chooserSelectsOption", index: 0 };
          case "chooserSelectsTarget":
            return { kind: "chooserSelectsTarget", selected: [] };
          case "orderTriggers":
            return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
          case "distributeAmong":
            return { kind: "distributeAmong", shares: {} };
          default:
            throw new Error(`drain: unhandled ${pc.kind}`);
        }
      })();
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  return asked;
}

/** Picks the first `count` legal candidates of every chooserSelectsTarget; declines mayPay. */
const pickFirst =
  (engine: SpoilsEngine, count = 1): Answer =>
  pc =>
    pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: candidatesOf(engine, pc).slice(0, count) } : undefined;

const payWith = (...payers: PlayerId[]): Answer => pc =>
  pc.kind === "mayPay" || pc.kind === "anyPlayerMayPay" ? { kind: pc.kind, pay: payers.includes(pc.playerId) } : undefined;

/** Picks of the form `pickFirst`, paying as `payWith`, whichever applies. */
const combine = (...answers: Answer[]): Answer => pc => answers.map(a => a(pc)).find(x => x !== undefined);

const handOf = (engine: SpoilsEngine, playerId: PlayerId) => engine.state.players[playerId].hand.length;

// ===========================================================================
// b — "each opponent" fans out
// ===========================================================================

describe("Brainbath (Decade of Deckadence): RECUR makes all opponents discard", () => {
  const board = (players: 2 | 3) =>
    table(
      [
        { key: "bb", def: cd("Decade of Deckadence", "Brainbath"), owner: P1, zone: "discard" },
        ...bank("obsession", 6, P1),
        ...chars("a", 2, P1, {}, "deck"),
        ...chars("h", 2, P2, {}, "hand"),
        ...(players === 3 ? chars("k", 2, P3, {}, "hand") : [])
      ],
      { players }
    );

  test("three players: each opponent discards a card of their own hand", () => {
    const { engine, id } = board(3);
    activate(engine, P1, id("bb"), "recur");
    const asked = drain(engine, pickFirst(engine));
    assert.deepEqual(asked, ["p2:chooserSelectsTarget", "p3:chooserSelectsTarget"]);
    assert.equal(handOf(engine, P2), 1);
    assert.equal(handOf(engine, P3), 1);
    assert.equal(handOf(engine, P1), 1, "and the controller draws one");
  });

  test("two players: unchanged (the one opponent discards)", () => {
    const { engine, id } = board(2);
    activate(engine, P1, id("bb"), "recur");
    drain(engine, pickFirst(engine));
    assert.equal(handOf(engine, P2), 1);
    assert.equal(handOf(engine, P1), 1);
  });
});

describe("Forbidden Bibliotheca: CHECK OUT makes each opponent discard 2", () => {
  test("every opponent discards two cards", () => {
    const { engine, id } = table([
      { key: "fb", def: cd("Holy Heist", "Forbidden Bibliotheca"), owner: P1, counters: { token: 3 } },
      ...chars("h", 3, P2, {}, "hand"),
      ...chars("k", 3, P3, {}, "hand")
    ]);
    activate(engine, P1, id("fb"), "bib-checkout");
    drain(engine, pickFirst(engine, 2));
    assert.equal(handOf(engine, P2), 1);
    assert.equal(handOf(engine, P3), 1);
  });
});

describe("Clockman City Shuffle: every opponent's characters lose 1 strength and 1 life", () => {
  test("p2's and p3's characters shrink, p1's grow", () => {
    const { engine, id } = table([
      { key: "ccs", def: cd("Shade of the Devoured Emperor", "Clockman City Shuffle"), owner: P1, zone: "hand" },
      ...banks(3, P1),
      ...chars("m", 1, P1),
      ...chars("b", 1, P2),
      ...chars("c", 1, P3)
    ]);
    play(engine, P1, id("ccs"));
    drain(engine);
    assert.equal(engine.getStat(id("m0"), "strength"), 3);
    assert.equal(engine.getStat(id("m0"), "life"), 10);
    for (const key of ["b0", "c0"]) {
      assert.equal(engine.getStat(id(key), "strength"), 1, key);
      assert.equal(engine.getStat(id(key), "life"), 8, key);
    }
  });
});

describe("Corrosive Waste Dispenser: CONVERT makes each opponent destroy a character they control", () => {
  test("p2 and p3 each lose one of their own characters", () => {
    const { engine, id } = table([
      { key: "cwd", def: cd("Ungodly Mess", "Corrosive Waste Dispenser"), owner: P1, counters: { token: 4 } },
      ...chars("m", 1, P1),
      ...chars("b", 2, P2),
      ...chars("c", 2, P3),
      ...bank("greed", 2, P1)
    ]);
    activate(engine, P1, id("cwd"), "convert", { selected: { sac: [id("m0")] } });
    drain(engine, pickFirst(engine));
    const alive = (prefix: string) => [0, 1].filter(i => zoneOf(engine, id(`${prefix}${i}`)) === "play").length;
    assert.equal(alive("b"), 1);
    assert.equal(alive("c"), 1);
  });
});

describe("Enlightened Sarcophyle: each opponent loses 1 influence", () => {
  const board = (players: 2 | 3) =>
    table(
      [
        { key: "es", def: cd("Decade of Deckadence", "Enlightened Sarcophyle"), owner: P1 },
        { key: "kill", def: killTactic({ id: "mp-kill" }), owner: P1, zone: "hand" },
        ...chars("v", 1, P2)
      ],
      { players }
    );

  test("three players: both opponents lose 1, the controller gains 1", () => {
    const { engine, id } = board(3);
    const before = influence(engine);
    play(engine, P1, id("kill"), { selected: { t: [id("v0")] } });
    drain(engine);
    const after = influence(engine);
    assert.deepEqual([after.p1, after.p2, after.p3], [before.p1 + 1, before.p2 - 1, before.p3 - 1]);
  });

  test("two players: unchanged", () => {
    const { engine, id } = board(2);
    const before = influence(engine);
    play(engine, P1, id("kill"), { selected: { t: [id("v0")] } });
    drain(engine);
    assert.deepEqual([influence(engine).p1, influence(engine).p2], [before.p1 + 1, before.p2 - 1]);
  });
});

describe("Flaming Cube: each opponent's faction loses 6 influence", () => {
  test("any player can push it over; the cube's controller's opponents all lose 6", () => {
    const { engine, id } = table(
      [
        { key: "cube", def: cd("Shade of the Devoured Emperor", "Flaming Cube"), owner: P1, counters: { token: 5 } },
        ...chars("b", 1, P2)
      ],
      { activePlayerId: P2 }
    );
    const before = influence(engine);
    activate(engine, P2, id("cube"), "fc-control", { selected: { x: [id("b0")] } });
    drain(engine, pc => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : undefined));
    const after = influence(engine);
    assert.equal(zoneOf(engine, id("cube")), "discard");
    assert.deepEqual([after.p1, after.p2, after.p3], [before.p1, before.p2 - 6, before.p3 - 6]);
  });
});

describe("Hassan-i of Thabbash: each opponent must destroy a character they control", () => {
  test("when destroyed, p2 and p3 each destroy one of their own", () => {
    const { engine, id } = table([
      { key: "h", def: cd("Shade of the Devoured Emperor", "Hassan-i of Thabbash"), owner: P1 },
      { key: "kill", def: killTactic({ id: "mp-kill" }), owner: P1, zone: "hand" },
      ...chars("b", 2, P2),
      ...chars("c", 2, P3)
    ]);
    play(engine, P1, id("kill"), { selected: { t: [id("h")] } });
    const asked = drain(engine, pickFirst(engine));
    assert.deepEqual(asked, ["p2:chooserSelectsTarget", "p3:chooserSelectsTarget"]);
    const alive = (prefix: string) => [0, 1].filter(i => zoneOf(engine, id(`${prefix}${i}`)) === "play").length;
    assert.equal(alive("b"), 1);
    assert.equal(alive("c"), 1);
  });
});

describe("Insidious Brainworm: each opponent loses 3 influence when it enters play", () => {
  test("three players: no opponent need be named, both lose 3", () => {
    const { engine, id } = table([
      { key: "bw", def: cd("Decade of Deckadence", "Insidious Brainworm"), owner: P1, zone: "hand" },
      ...banks(3, P1)
    ]);
    const before = influence(engine);
    play(engine, P1, id("bw"));
    assert.equal(drain(engine).length, 0, "nothing was asked");
    const after = influence(engine);
    assert.deepEqual([after.p1, after.p2, after.p3], [before.p1, before.p2 - 3, before.p3 - 3]);
  });
});

describe("Luteorunic Behemoth: all opponents must destroy 4 non-staple cards they control", () => {
  test("each opponent chooses and destroys 4 of their own", () => {
    const { engine, id } = table([
      { key: "lb", def: cd("Decade of Deckadence", "Luteorunic Behemoth"), owner: P1, zone: "hand" },
      ...banks(3, P1),
      ...chars("b", 5, P2),
      ...chars("c", 5, P3)
    ]);
    play(engine, P1, id("lb"));
    const asked = drain(engine, pickFirst(engine, 4));
    assert.deepEqual(asked, ["p2:chooserSelectsTarget", "p3:chooserSelectsTarget"]);
    const alive = (prefix: string) => [0, 1, 2, 3, 4].filter(i => zoneOf(engine, id(`${prefix}${i}`)) === "play").length;
    assert.equal(alive("b"), 1);
    assert.equal(alive("c"), 1);
  });
});

describe("Sharpey Pointy Lethal Army Tool: UNFOLD reaches every opponent's characters", () => {
  const board = (top: CardDefinition) =>
    table([
      { key: "host", def: character({ name: "Host", strength: 1, life: 9 }), owner: P1 },
      { key: "tool", def: cd("Shade of the Devoured Emperor", "Sharpey Pointy Lethal Army Tool"), owner: P1, attachedToKey: "host" },
      { key: "top", def: top, owner: P1, zone: "deck" },
      ...bank("greed", 2, P1),
      ...chars("b", 1, P2),
      ...chars("c", 1, P3)
    ]);

  test("cost 5 or more: every opponent's characters lose 1 life", () => {
    const { engine, id } = board(character({ name: "Big", cost: 6 }));
    activate(engine, P1, id("tool"), "sharpey-unfold");
    drain(engine);
    assert.equal(engine.getStat(id("b0"), "life"), 8);
    assert.equal(engine.getStat(id("c0"), "life"), 8);
    assert.equal(engine.getStat(id("host"), "life"), 9);
  });

  test("a resource: the attached character and every opponent's characters are destroyed", () => {
    const { engine, id } = board(resourceCard({ name: "Res", resource: { provides: ["rage"], staple: true } }));
    activate(engine, P1, id("tool"), "sharpey-unfold");
    drain(engine);
    assert.equal(zoneOf(engine, id("host")), "discard");
    assert.equal(zoneOf(engine, id("b0")), "discard");
    assert.equal(zoneOf(engine, id("c0")), "discard");
  });
});

describe("Stuttershy: each opponent's faction gains 1; one Micromajig per influence gained", () => {
  const board = (players: 2 | 3) =>
    table(
      [
        { key: "st", def: cd("Shade of the Devoured Emperor", "Stuttershy"), owner: P1 },
        { key: "kill", def: killTactic({ id: "mp-kill" }), owner: P1, zone: "hand" }
      ],
      { players }
    );
  const tokens = (engine: SpoilsEngine) => Object.values(engine.state.cards).filter(c => c.isToken && c.controllerId === P1 && c.zone === "play").length;

  test("three players: both factions gain 1 and two tokens may be made", () => {
    const { engine, id } = board(3);
    const before = influence(engine);
    play(engine, P1, id("kill"), { selected: { t: [id("st")] } });
    drain(engine, pc => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : undefined));
    const after = influence(engine);
    assert.deepEqual([after.p1, after.p2, after.p3], [before.p1, before.p2 + 1, before.p3 + 1]);
    assert.equal(tokens(engine), 2);
  });

  test("two players: one token, as before", () => {
    const { engine, id } = board(2);
    play(engine, P1, id("kill"), { selected: { t: [id("st")] } });
    drain(engine, pc => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : undefined));
    assert.equal(tokens(engine), 1);
  });

  test("declining makes no tokens", () => {
    const { engine, id } = board(3);
    play(engine, P1, id("kill"), { selected: { t: [id("st")] } });
    drain(engine);
    assert.equal(tokens(engine), 0);
  });
});

describe("Swindle: each opponent must attach a resource to their faction", () => {
  test("p2 and p3 each attach one; no response is possible", () => {
    const { engine, id } = table([
      { key: "sw", def: cd("Shade of the Devoured Emperor", "Swindle"), owner: P1, zone: "hand" },
      ...banks(2, P1),
      { key: "rb", def: resourceCard({ name: "RB", resource: { provides: ["rage"], staple: true } }), owner: P2 },
      { key: "rc", def: resourceCard({ name: "RC", resource: { provides: ["rage"], staple: true } }), owner: P3 },
      ...chars("d", 3, P1, {}, "deck"),
      ...chars("h", 1, P1, {}, "hand")
    ]);
    play(engine, P1, id("sw"));
    drain(engine, pickFirst(engine));
    assert.equal(engine.state.cards[id("rb")].attachedTo, engine.state.players.p2.factionId);
    assert.equal(engine.state.cards[id("rc")].attachedTo, engine.state.players.p3.factionId);
  });
});

describe("Thabbashite Weapons Expert: X damage to each opponent's faction", () => {
  test("at the start of its controller's turn it damages every opponent's faction", () => {
    const { engine, id } = table(
      [
        { key: "twe", def: cd("Ungodly Mess", "Thabbashite Weapons Expert"), owner: P1 },
        ...chars("d", 3, P1, {}, "deck")
      ],
      { activePlayerId: P3 }
    );
    const before = influence(engine);
    engine.perform({ type: "endTurn", playerId: P3 });
    resolvePendingResponses(engine);
    settleStartFirst(engine);
    drain(engine, pc =>
      pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : undefined
    );
    assert.equal(zoneOf(engine, id("twe")), "discard");
    const after = influence(engine);
    assert.deepEqual([after.p1, after.p2, after.p3], [before.p1, before.p2 - 2, before.p3 - 2]);
  });
});

describe("Undevoted Gargantuan: each opponent may detach up to 3 resources", () => {
  test("every opponent decides separately", () => {
    const res = (key: string, owner: PlayerId, faction: string): CardPlacement => ({
      key,
      def: resourceCard({ name: key, resource: { provides: ["rage"], staple: true } }),
      owner,
      attachedToKey: faction
    });
    const { engine, id } = table([
      { key: "ug", def: cd("Shade of the Devoured Emperor", "Undevoted Gargantuan"), owner: P1, zone: "hand" },
      ...banks(5, P1),
      res("b0", P2, "__factionB"),
      res("b1", P2, "__factionB"),
      res("c0", P3, "__faction_p3"),
      res("c1", P3, "__faction_p3")
    ]);
    play(engine, P1, id("ug"));
    const asked = drain(engine, pc =>
      pc.kind === "chooserSelectsTarget" && pc.playerId === P2
        ? { kind: "chooserSelectsTarget", selected: candidatesOf(engine, pc) }
        : undefined
    );
    assert.deepEqual(asked, ["p2:chooserSelectsTarget", "p3:chooserSelectsTarget"]);
    assert.equal(engine.state.cards[id("b0")].attachedTo, undefined, "p2 detached");
    assert.equal(engine.state.cards[id("c0")].attachedTo, engine.state.players.p3.factionId, "p3 declined");
  });
});

describe("Words of Glory: X is the total strength of all the characters your opponents control", () => {
  const board = (players: 2 | 3) =>
    table(
      [
        { key: "wg", def: cd("Shade of the Devoured Emperor", "Words of Glory"), owner: P1, zone: "hand" },
        ...banks(8, P1),
        { key: "m", def: character({ name: "Mine", strength: 1, life: 20 }), owner: P1 },
        { key: "b", def: character({ name: "B", strength: 3, life: 20 }), owner: P2 },
        ...(players === 3 ? [{ key: "c", def: character({ name: "C", strength: 4, life: 20 }), owner: P3 }] : [])
      ],
      { players }
    );

  test("three players: strengths are summed across both opponents", () => {
    const { engine, id } = board(3);
    play(engine, P1, id("wg"));
    drain(engine);
    for (const key of ["m", "b", "c"]) assert.equal(engine.state.cards[id(key)].damage, 4, key);
  });

  test("two players: only the one opponent's strength counts", () => {
    const { engine, id } = board(2);
    play(engine, P1, id("wg"));
    drain(engine);
    assert.equal(engine.state.cards[id("m")].damage, 0);
    assert.equal(engine.state.cards[id("b")].damage, 0);
  });
});

describe("Brainbath (Seed): unchanged, 'your opponent' still binds one opponent", () => {
  test("RECUR with three players names the opponent", () => {
    const { engine, id } = table([
      { key: "bb", def: cd("Seed", "Brainbath"), owner: P1, zone: "discard" },
      ...bank("obsession", 6, P1),
      ...chars("a", 2, P1, {}, "deck"),
      ...chars("h", 2, P2, {}, "hand"),
      ...chars("k", 2, P3, {}, "hand")
    ]);
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bb"), abilityId: "recur", opponentId: P3 });
    resolvePendingResponses(engine);
    drain(engine, pickFirst(engine));
    assert.equal(handOf(engine, P3), 1);
    assert.equal(handOf(engine, P2), 2);
  });
});

// ===========================================================================
// c — any opponent may pay
// ===========================================================================

describe("Additional Tribute: any opponent may pay 1", () => {
  const board = (players: 2 | 3) =>
    table(
      [
        { key: "at", def: cd("Holy Heist", "Additional Tribute"), owner: P1, zone: "hand" },
        { key: "foe", def: character({ name: "Foe", cost: 0 }), owner: P2, zone: "hand" },
        ...bank("obsession", 4, P1),
        ...bank("rage", 3, P2),
        ...(players === 3 ? bank("rage", 3, P3) : []),
        ...chars("a", 4, P1, {}, "deck")
      ],
      { activePlayerId: P2, players }
    );
  const respond = (g: Game) => {
    g.engine.perform({ type: "playCard", playerId: P2, cardId: g.id("foe"), selected: {} } as never);
    // Priority goes round the table from the actor: p3 passes, then p1 responds.
    if (g.engine.state.responseWindow?.priorityPlayerId === P3) g.engine.perform({ type: "passPriority", playerId: P3 });
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("at"), selected: {} } as never);
    resolvePendingResponses(g.engine);
  };
  const ready = (g: Game, owner: PlayerId) => g.engine.getAvailableResourceCount(owner);

  test("the third player may pay when the second declines; the card is terminated and its controller draws", () => {
    const g = board(3);
    const handBefore = handOf(g.engine, P1);
    respond(g);
    const asked = drain(g.engine, payWith(P3));
    assert.deepEqual(asked, ["p2:mayPay", "p3:mayPay"]);
    assert.equal(zoneOf(g.engine, g.id("foe")), "play", "the deployed card was not terminated");
    assert.equal(handOf(g.engine, P1), handBefore, "the controller drew (and Additional Tribute left the hand)");
    assert.equal(ready(g, P3), 2);
    assert.equal(ready(g, P2), 3);
    assert.equal(Object.values(g.engine.state.cards).filter(c => Object.keys(c.counters).length > 0).length, 0, "no bookkeeping left on any card");
  });

  test("the first opponent to pay settles it: nobody else is offered the payment", () => {
    const g = board(3);
    respond(g);
    const asked = drain(g.engine, payWith(P2, P3));
    assert.deepEqual(asked, ["p2:mayPay"]);
    assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  });

  test("when every opponent declines the deployed card is terminated", () => {
    const g = board(3);
    respond(g);
    assert.deepEqual(drain(g.engine), ["p2:mayPay", "p3:mayPay"]);
    assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  });

  test("two players: unchanged", () => {
    const g = board(2);
    respond(g);
    assert.deepEqual(drain(g.engine, payWith(P2)), ["p2:mayPay"]);
    assert.equal(zoneOf(g.engine, g.id("foe")), "play");
    const h = board(2);
    respond(h);
    drain(h.engine);
    assert.equal(zoneOf(h.engine, h.id("foe")), "discard");
  });
});

describe("Offering of False Friendship: any opponent may pay 2", () => {
  const board = (players: 2 | 3) =>
    table(
      [
        { key: "off", def: cd("Holy Heist", "Offering of False Friendship"), owner: P1, zone: "hand" },
        { key: "tw", def: character({ name: "Twin", cost: 0 }), owner: P2 },
        ...bank("obsession", 4, P1),
        ...bank("rage", 3, P2),
        ...(players === 3 ? bank("rage", 3, P3) : []),
        ...chars("a", 2, P2, {}, "deck")
      ],
      { players }
    );
  const run = (g: Game, answer: Answer) => {
    play(g.engine, P1, g.id("off"), { selected: { c: [g.id("tw")] } });
    return drain(g.engine, answer);
  };

  test("p3 may pay after p2 declines: the character stays", () => {
    const g = board(3);
    assert.deepEqual(run(g, payWith(P3)), ["p2:mayPay", "p3:mayPay"]);
    assert.equal(zoneOf(g.engine, g.id("tw")), "play");
  });

  test("everyone declines: the character goes to the bottom of its owner's deck", () => {
    const g = board(3);
    assert.deepEqual(run(g, () => undefined), ["p2:mayPay", "p3:mayPay"]);
    assert.equal(zoneOf(g.engine, g.id("tw")), "deck");
  });

  test("two players: unchanged", () => {
    const g = board(2);
    assert.deepEqual(run(g, payWith(P2)), ["p2:mayPay"]);
    assert.equal(zoneOf(g.engine, g.id("tw")), "play");
    const h = board(2);
    run(h, () => undefined);
    assert.equal(zoneOf(h.engine, h.id("tw")), "deck");
  });
});

describe("Thabbashite Barbeque: any opponent may pay 2", () => {
  const board = () =>
    table([
      { key: "bq", def: cd("Holy Heist", "Thabbashite Barbeque"), owner: P1, zone: "hand" },
      { key: "pick", def: character({ name: "Pick", cost: 0 }), owner: P2 },
      ...banks(3, P1),
      ...bank("rage", 3, P2),
      ...bank("rage", 3, P3),
      ...chars("h", 1, P3, {}, "hand")
    ]);

  test("p3 pays after p2 declines: the Barbeque returns to its owner's hand and nothing else happens", () => {
    const g = board();
    play(g.engine, P1, g.id("bq"), { selected: { picked: [g.id("pick")] } });
    assert.deepEqual(drain(g.engine, payWith(P3)), ["p2:mayPay", "p3:mayPay"]);
    assert.equal(zoneOf(g.engine, g.id("bq")), "hand");
    assert.equal(zoneOf(g.engine, g.id("pick")), "play");
    assert.equal(handOf(g.engine, P3), 1);
  });

  test("nobody pays: the picked card returns to hand, then a card from an opponent's hand is discarded", () => {
    const g = board();
    play(g.engine, P1, g.id("bq"), { selected: { picked: [g.id("pick")] } });
    drain(g.engine, combine(payWith(), pc => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: candidatesOf(g.engine, pc).filter(c => g.engine.state.cards[c].ownerId === P3) } : undefined)));
    assert.equal(zoneOf(g.engine, g.id("pick")), "hand");
    assert.equal(zoneOf(g.engine, g.id("bq")), "discard");
    assert.equal(handOf(g.engine, P3), 0, "the card taken from p3's hand was discarded");
  });
});

describe("Tedious TriAdic Truculence: any opponent may pay 3", () => {
  const board = (players: 2 | 3) =>
    table(
      [
        { key: "tt", def: cd("Shade of the Devoured Emperor", "Tedious TriAdic Truculence"), owner: P1, zone: "hand" },
        ...banks(3, P1),
        ...chars("v", 1, P2, { strength: 1 }),
        ...chars("w", 1, P2, { strength: 2 }),
        ...chars("x", 1, P2, { strength: 3 }),
        ...bank("rage", 4, P2),
        ...(players === 3 ? bank("rage", 4, P3) : []),
        ...chars("d", 3, P1, {}, "deck")
      ],
      { players }
    );
  const run = (g: Game, answer: Answer) => {
    play(g.engine, P1, g.id("tt"), { selected: { picks: [g.id("v0"), g.id("w0"), g.id("x0")] } });
    return drain(g.engine, answer);
  };
  const dead = (g: Game) => ["v0", "w0", "x0"].filter(k => zoneOf(g.engine, g.id(k)) === "discard").length;

  test("p3 may pay once p2 declines: no character is destroyed", () => {
    const g = board(3);
    const asked = run(g, combine(payWith(P3), pc => (pc.kind === "reorderDeck" ? { kind: "reorderDeck", order: pc.cardIds } : undefined)));
    assert.deepEqual(asked.slice(0, 2), ["p2:mayPay", "p3:mayPay"]);
    assert.equal(dead(g), 0);
  });

  test("everyone declines: every picked character with 3 strength or less is destroyed", () => {
    const g = board(3);
    assert.deepEqual(run(g, () => undefined), ["p2:mayPay", "p3:mayPay"]);
    assert.equal(dead(g), 3);
  });

  test("two players: unchanged", () => {
    const g = board(2);
    assert.deepEqual(run(g, () => undefined), ["p2:mayPay"]);
    assert.equal(dead(g), 3);
  });
});

// ===========================================================================
// c — attacks, comparisons, picked players
// ===========================================================================

function attack(engine: SpoilsEngine, attackerId: PlayerId, attackers: string[], defender: PlayerId): void {
  engine.perform({ type: "declareAttack", playerId: attackerId, attackerIds: attackers, target: { type: "faction", playerId: defender } });
}

describe("Runivoltaic Accumulator: 'when an opponent attacks'", () => {
  for (const set of ["Seed", "Seed Saga"]) {
    const board = () =>
      table(
        [
          { key: "ra", def: cd(set, "Runivoltaic Accumulator"), owner: P1 },
          ...chars("a", 1, P1),
          ...chars("b", 1, P2),
          ...chars("c", 1, P3)
        ],
        { activePlayerId: P2 }
      );

    test(`${set}: fires when an opponent attacks someone else`, () => {
      const { engine, id } = board();
      attack(engine, P2, [id("b0")], P3);
      const asked = drain(engine, pc => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : undefined));
      assert.deepEqual(asked, ["p1:chooserSelectsOption"]);
      assert.equal(engine.state.cards[id("ra")].counters.token, 1);
    });

    test(`${set}: does not fire when its controller attacks`, () => {
      const { engine, id } = table([{ key: "ra", def: cd(set, "Runivoltaic Accumulator"), owner: P1 }, ...chars("a", 1, P1), ...chars("b", 1, P2)], {});
      attack(engine, P1, [id("a0")], P2);
      assert.deepEqual(drain(engine), []);
      assert.equal(engine.state.cards[id("ra")].counters.token ?? 0, 0);
    });

    test(`${set}: two players, the opponent's attack still fires it`, () => {
      const { engine, id } = table([{ key: "ra", def: cd(set, "Runivoltaic Accumulator"), owner: P1 }, ...chars("b", 1, P2)], { activePlayerId: P2, players: 2 });
      attack(engine, P2, [id("b0")], P1);
      assert.deepEqual(drain(engine), ["p1:chooserSelectsOption"]);
    });
  }
});

describe("Candy Skull Commander: 'whenever an opponent forms an attacking party'", () => {
  const def = cd("Ungodly Mess", "Candy Skull Commander");
  test("fires for an opponent's party aimed at a third player", () => {
    const { engine, id } = table([{ key: "csc", def, owner: P1 }, ...chars("b", 1, P2), ...bank("rage", 3, P1)], { activePlayerId: P2 });
    attack(engine, P2, [id("b0")], P3);
    const pc = pending(engine);
    assert.equal(pc?.kind, "mayPay");
    assert.equal(pc?.playerId, P1);
  });
  test("does not fire for its controller's own party", () => {
    const { engine, id } = table([{ key: "csc", def, owner: P1 }, ...chars("a", 1, P1), ...bank("rage", 3, P1)]);
    attack(engine, P1, [id("a0")], P2);
    assert.equal(pending(engine), undefined);
  });
});

describe("Martial Arts Wannabe: 'more characters than any opponent'", () => {
  const def = cd("Shade of the Devoured Emperor", "Martial Arts Wannabe");
  /** Whether p2 may pick the Wannabe. */
  const pickable = (g: Game) => {
    const probe = g.id("b0");
    return g.engine
      .targetCandidates({ type: "character", controller: "any" }, { sourceId: probe, controllerId: P2, abilityId: "x", selected: {} }, P2)
      .some(c => c.id === g.id("w"));
  };
  test("hidden only while it beats every opponent", () => {
    const hidden = table([{ key: "w", def, owner: P1 }, ...chars("a", 2, P1), ...chars("b", 2, P2), ...chars("c", 1, P3)]);
    assert.equal(pickable(hidden), false, "3 vs 2 and 1");
  });
  test("an opponent with as many characters leaves it pickable", () => {
    const tied = table([{ key: "w", def, owner: P1 }, ...chars("a", 2, P1), ...chars("b", 2, P2), ...chars("c", 3, P3)]);
    assert.equal(pickable(tied), true, "3 vs 2 and 3");
  });
  test("two players: unchanged", () => {
    assert.equal(pickable(table([{ key: "w", def, owner: P1 }, ...chars("a", 1, P1), ...chars("b", 1, P2)], { players: 2 })), false);
    assert.equal(pickable(table([{ key: "w", def, owner: P1 }, ...chars("a", 1, P1), ...chars("b", 2, P2)], { players: 2 })), true);
  });
});

describe("Rocket Lawnchair: 'a member of an opponent's attacking party'", () => {
  test("a party of a third player that includes the picked character is destroyed, whoever the 'theirs' pick belongs to", () => {
    const { engine, id } = table(
      [
        { key: "rl", def: cd("Shade of the Devoured Emperor", "Rocket Lawnchair"), owner: P1 },
        { key: "mine", def: character({ name: "Stolen", strength: 1, life: 9 }), owner: P1, controller: P3 },
        ...chars("c", 1, P3),
        ...chars("b", 1, P2)
      ],
      { activePlayerId: P3 }
    );
    attack(engine, P3, [id("mine"), id("c0")], P2);
    // The attacker and the defender have their say first; then p1 may respond.
    for (const passer of [P3, P2]) engine.perform({ type: "passPriority", playerId: passer });
    activate(engine, P1, id("rl"), "rocket-lawnchair-no-eject", { selected: { mine: [id("mine")], theirs: [id("b0")] } });
    drain(engine);
    assert.equal(zoneOf(engine, id("mine")), "discard");
    assert.equal(zoneOf(engine, id("b0")), "discard");
    assert.equal(zoneOf(engine, id("c0")), "discard", "the rest of the attacking party is destroyed too");
  });

  test("on its controller's own turn the party is not 'an opponent's'", () => {
    const { engine, id } = table([
      { key: "rl", def: cd("Shade of the Devoured Emperor", "Rocket Lawnchair"), owner: P1 },
      ...chars("a", 2, P1),
      ...chars("b", 1, P2)
    ]);
    attack(engine, P1, [id("a0"), id("a1")], P2);
    activate(engine, P1, id("rl"), "rocket-lawnchair-no-eject", { selected: { mine: [id("a0")], theirs: [id("b0")] } });
    drain(engine);
    assert.equal(zoneOf(engine, id("a0")), "discard");
    assert.equal(zoneOf(engine, id("a1")), "play", "only the two picks die");
  });
});

describe("Mass Confusion (Seed Saga): 'that player controls minus the number of characters you control'", () => {
  test("Y follows the picked player, not some other opponent", () => {
    const { engine, id } = table([
      { key: "mc", def: cd("Seed Saga", "Mass Confusion"), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1),
      ...chars("a", 1, P1),
      ...chars("b", 6, P2),
      ...chars("c", 3, P3)
    ]);
    const factionP3 = engine.state.players.p3.factionId!;
    play(engine, P1, id("mc"), { variables: { x: 1 }, selected: { pl: [factionP3], cs: [id("c0")] } });
    drain(engine, pc => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("c0")]: 2 } } : undefined));
    assert.equal(engine.state.cards[id("c0")].damage, 2, "3 - 1, not 6 - 1");
  });

  test("picking yourself deals nothing", () => {
    const { engine, id } = table([
      { key: "mc", def: cd("Seed Saga", "Mass Confusion"), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1),
      ...chars("a", 2, P1),
      ...chars("b", 6, P2)
    ]);
    const factionP1 = engine.state.players.p1.factionId!;
    play(engine, P1, id("mc"), { variables: { x: 1 }, selected: { pl: [factionP1], cs: [id("a0")] } });
    drain(engine);
    assert.equal(engine.state.cards[id("a0")].damage, 0);
  });
});

describe("Raging Ferocity: 'X is number of resources that player controls'", () => {
  test("the damage follows the picked player's resources", () => {
    const { engine, id } = table([
      { key: "rf", def: cd("Holy Heist", "Raging Ferocity"), owner: P1, faceDown: true },
      ...bank("rage", 5, P1),
      ...bank("greed", 9, P2),
      ...bank("greed", 12, P3)
    ]);
    const factionP3 = engine.state.players.p3.factionId!;
    const before = influence(engine);
    activate(engine, P1, id("rf"), "flip-it", { selected: { fac: [factionP3] } });
    drain(engine);
    const mine = Object.values(engine.state.cards).filter(c => c.controllerId === P1 && c.zone === "play" && engine.getDefinition(c.id).type === "resource").length;
    const after = influence(engine);
    assert.equal(before.p3 - after.p3, 12 - mine, "X (p3's 12) - Y (mine)");
    assert.equal(after.p2, before.p2);
  });
});

describe("Cheats, the Dirty Rotten: searches the player picked as part of its cost", () => {
  test("the search reaches into the picked player's deck only", () => {
    const { engine, id } = table([
      { key: "ch", def: cd("Holy Heist", "Cheats, the Dirty Rotten"), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1),
      ...chars("b", 5, P2, {}, "deck"),
      ...chars("c", 5, P3, {}, "deck")
    ]);
    const factionP3 = engine.state.players.p3.factionId!;
    play(engine, P1, id("ch"), { selected: { opp: [factionP3] } });
    let sawSearch = false;
    drain(engine, pc => {
      if (pc.kind === "chooserSelectsTarget") {
        sawSearch = true;
        const candidates = candidatesOf(engine, pc);
        assert.ok(candidates.length > 0 && candidates.every(c => engine.state.cards[c].ownerId === P3), "only p3's deck");
        return { kind: "chooserSelectsTarget", selected: candidates.slice(0, 4) };
      }
      if (pc.kind === "chooseOpponent") throw new Error("no opponent should be asked for");
      return undefined;
    });
    assert.ok(sawSearch);
    const voided = Object.values(engine.state.cards).filter(c => c.zone === "void" || c.zone === "discard").filter(c => c.ownerId === P3);
    assert.equal(voided.length, 4, "four of p3's cards left the deck (two voided, two to its discard)");
    assert.ok(Object.values(engine.state.cards).filter(c => c.ownerId === P2 && c.zone === "deck").length === 5, "p2's deck untouched");
  });
});

describe("Shriever General: 'if an opponent's faction lost influence this turn'", () => {
  const lose = (engine: SpoilsEngine, playerId: PlayerId, amount: number) =>
    (engine as unknown as { resolveEffect(e: object, c: object): void }).resolveEffect(
      { type: "modifyInfluence", player: { type: "player", id: playerId }, amount: -amount },
      { sourceId: engine.state.players[P1].factionId, controllerId: P1, selected: {} }
    );
  const board = (players: 2 | 3) =>
    table(
      [
        { key: "sg", def: cd("Decade of Deckadence", "Shriever General"), owner: P1, zone: "hand" },
        ...banks(3, P1),
        ...chars("b", 1, P2),
        ...(players === 3 ? chars("c", 1, P3) : [])
      ],
      { players }
    );

  test("only the opponent whose faction lost influence is a candidate: no prompt for the faction, then the usual 'may'", () => {
    const { engine, id } = board(3);
    lose(engine, P3, 2);
    const before = influence(engine);
    play(engine, P1, id("sg"));
    const asked = drain(engine, combine(payWith(P1), pickFirst(engine)));
    assert.deepEqual(asked, ["p1:mayPay", "p1:chooserSelectsTarget"]);
    const after = influence(engine);
    assert.equal(after.p3, before.p3 - 2);
    assert.equal(after.p2, before.p2);
    assert.equal(engine.state.cards[id("c0")].damage, 2, "a character of that faction's controller");
    assert.equal(engine.state.cards[id("b0")].damage, 0);
  });

  test("with two qualifying opponents the controller picks the faction, and the character is that player's", () => {
    const { engine, id } = board(3);
    lose(engine, P2, 1);
    lose(engine, P3, 1);
    const before = influence(engine);
    play(engine, P1, id("sg"));
    const factionP3 = engine.state.players.p3.factionId!;
    const asked = drain(engine, pc => {
      if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
      if (pc.kind === "chooserSelectsTarget") {
        const candidates = candidatesOf(engine, pc);
        if ((pc.declaration as { id: string }).id === "f") {
          assert.equal(candidates.length, 2);
          return { kind: "chooserSelectsTarget", selected: [factionP3] };
        }
        assert.deepEqual(candidates, [id("c0")], "only p3's character");
        return { kind: "chooserSelectsTarget", selected: candidates };
      }
      return undefined;
    });
    assert.deepEqual(asked, ["p1:chooserSelectsTarget", "p1:mayPay", "p1:chooserSelectsTarget"]);
    assert.equal(influence(engine).p3, before.p3 - 2);
    assert.equal(influence(engine).p2, before.p2);
  });

  test("it is a 'may': declining inflicts nothing", () => {
    const { engine, id } = board(3);
    lose(engine, P3, 2);
    const before = influence(engine);
    play(engine, P1, id("sg"));
    drain(engine);
    assert.equal(influence(engine).p3, before.p3);
    assert.equal(engine.state.cards[id("c0")].damage, 0);
  });

  test("nothing happens when no opponent lost influence", () => {
    const { engine, id } = board(3);
    play(engine, P1, id("sg"));
    assert.deepEqual(drain(engine), []);
  });

  test("two players: unchanged (the yes/no first, then the character)", () => {
    const { engine, id } = board(2);
    lose(engine, P2, 1);
    const before = influence(engine);
    play(engine, P1, id("sg"));
    const asked = drain(engine, combine(payWith(P1), pickFirst(engine)));
    assert.deepEqual(asked, ["p1:mayPay", "p1:chooserSelectsTarget"]);
    assert.equal(influence(engine).p2, before.p2 - 2);
    assert.equal(engine.state.cards[id("b0")].damage, 2);
  });
});

void item;
void volition;
