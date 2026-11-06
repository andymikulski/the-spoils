// Three-player checks for the catalog cards the multiplayer audit (data/multiplayer-audit/g1.json, g2.json) flagged
// b / c / d, against the rules in RULES.md §16 and docs/MULTIPLAYER-PLAN.md (D4 binding, E1-E5). Each card is loaded from
// the real catalog by printing id. Where the fix changed the data, a two-player assertion pins that classic play is
// unchanged.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../../data/cards.js";
import { createFactionGame } from "../../../engine.js";
import type { CardDefinition, PlayerId } from "../../../engine.js";
import { banks, bank, buildGame, character, factionCard, noDevelopFaction, resolvePendingResponses, resourceCard, tactic } from "./_harness.js";

const CATALOG = cardsJson as CardDefinition[];

/** A real catalog printing, by id (a deep clone, safe to mutate). */
function printing(id: string): CardDefinition {
  const def = CATALOG.find(card => card.id === id);
  if (!def) throw new Error(`no printing ${id}`);
  return structuredClone(def);
}

const SEATS = ["p1", "p2", "p3"].map(id => ({ id, faction: noDevelopFaction() }));
const ONE_ON_ONE = ["p1", "p2"].map(id => ({ id, faction: noDevelopFaction() }));

type Engine = ReturnType<typeof buildGame>["engine"];
type Pending = { kind: string; playerId: PlayerId; [key: string]: unknown };

function pending(engine: Engine): Pending | undefined {
  return engine.state.pendingChoice as Pending | undefined;
}

/** Answer the open choice (which must be for `playerId`), then drain any response window. */
function reply(engine: Engine, playerId: PlayerId, choice: unknown): void {
  const open = pending(engine);
  assert.ok(open, `expected an open choice for ${playerId}`);
  assert.equal(open.playerId, playerId, `the open ${open.kind} choice is for ${open.playerId}, not ${playerId}`);
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);
  resolvePendingResponses(engine);
}

function pick(engine: Engine, playerId: PlayerId, ...cardIds: string[]): void {
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  reply(engine, playerId, { kind: "chooserSelectsTarget", selected: cardIds });
}

function activate(engine: Engine, playerId: PlayerId, cardId: string, abilityId: string, extra: Record<string, unknown> = {}): void {
  engine.perform({ type: "activateAbility", playerId, cardId, abilityId, ...extra } as never);
  resolvePendingResponses(engine);
}

/** Settle a turn start's simultaneous triggers: resolve the one named `abilityId` first, then any others in the offered order. */
function settleTriggers(engine: Engine, abilityId: string): void {
  for (let guard = 0; guard < 10 && pending(engine)?.kind === "orderTriggers"; guard++) {
    const open = pending(engine)!;
    const triggers = open.triggers as Array<{ abilityId: string }>;
    const next = triggers.find(trigger => trigger.abilityId === abilityId) ?? triggers[0];
    reply(engine, open.playerId, { kind: "orderTriggers", next });
  }
}

const zoneOf =(engine: Engine, cardId: string) => engine.state.cards[cardId].zone;
const influence = (engine: Engine, playerId: PlayerId) => engine.state.players[playerId].influence;

const chars = (...keys: Array<[string, PlayerId]>) =>
  keys.map(([key, owner]) => ({ key, def: character({ name: key, strength: 2, life: 3 }), owner, zone: "play" as const }));

describe("\"Both players\" is the controller and one opponent (MP 3)", () => {
  const ASHES = ["7a368a4d-0aa8-42bc-83d9-7bd529db7d62", "b175a535-2a58-4df1-806d-6828e76d2868", "b3c323b0-c7ea-4970-a286-92df7d2fe2f3"];

  for (const id of ASHES) {
    test(`Ashes of Zenobia ${id.slice(0, 6)}: you and the named opponent each bounce a character; the third player does not`, () => {
      const { engine, id: card } = buildGame({
        players: SEATS,
        cards: [{ key: "ash", def: printing(id), owner: "p1" }, ...chars(["c1", "p1"], ["c2", "p2"], ["c3", "p3"]), ...banks(1)]
      });
      assert.throws(() => activate(engine, "p1", card("ash"), "nullify"), /Choose which opponent/);
      activate(engine, "p1", card("ash"), "nullify", { opponentId: "p3" });
      pick(engine, "p1", card("c1"));
      pick(engine, "p3", card("c3"));
      assert.equal(pending(engine), undefined);
      assert.equal(zoneOf(engine, card("c1")), "hand");
      assert.equal(zoneOf(engine, card("c3")), "hand");
      assert.equal(zoneOf(engine, card("c2")), "play", "the other opponent keeps their character");
    });
  }

  test("Ashes of Zenobia: classic two-player play is unchanged (both bounce, nothing asked)", () => {
    const { engine, id: card } = buildGame({
      players: ONE_ON_ONE,
      cards: [{ key: "ash", def: printing(ASHES[1]), owner: "p1" }, ...chars(["c1", "p1"], ["c2", "p2"]), ...banks(1)]
    });
    activate(engine, "p1", card("ash"), "nullify");
    pick(engine, "p1", card("c1"));
    pick(engine, "p2", card("c2"));
    assert.equal(zoneOf(engine, card("c1")), "hand");
    assert.equal(zoneOf(engine, card("c2")), "hand");
  });

  const SPASTIC = ["b817ac26-bdd5-4f11-8c48-e71cb58ef421", "9b955719-5c5a-4401-8a40-d41c7390829e"];
  for (const id of SPASTIC) {
    test(`Spastic Tentacles ${id.slice(0, 6)}: only you and the chosen opponent bounce a resource`, () => {
      const { engine, id: card } = buildGame({
        players: SEATS,
        activePlayerId: "p1",
        cards: [
          { key: "tent", def: printing(id), owner: "p1", zone: "hand" },
          ...bank("obsession", 5), ...["r1", "r2", "r3"].map((key, i) => ({ key, def: resourceCard({ name: key, resource: { provides: ["rage"], staple: true } }), owner: `p${i + 1}` as PlayerId, zone: "play" as const }))
        ]
      });
      engine.perform({ type: "playCard", playerId: "p1", cardId: card("tent"), opponentId: "p2" } as never);
      resolvePendingResponses(engine);
      // The enter-play trigger asks which opponent (nothing names one), then each of the two chooses a resource.
      if (pending(engine)?.kind === "chooseOpponent") reply(engine, "p1", { kind: "chooseOpponent", opponentId: "p2" });
      pick(engine, "p1", card("r1"));
      pick(engine, "p2", card("r2"));
      assert.equal(pending(engine), undefined);
      assert.equal(zoneOf(engine, card("r1")), "hand");
      assert.equal(zoneOf(engine, card("r2")), "hand");
      assert.equal(zoneOf(engine, card("r3")), "play");
    });
  }
});

/** `n` filler cards in `zone` for `owner` (hands, decks, discard piles). */
const stock = (owner: PlayerId, zone: "hand" | "deck" | "discard", n: number, prefix = `${owner}-${zone}`) =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}` }), owner, zone }));

const inZone = (engine: Engine, owner: PlayerId, zone: string) =>
  Object.values(engine.state.cards).filter(c => c.ownerId === owner && c.zone === zone).length;

describe("\"Both players\" cards, continued", () => {
  const RESEARCH = ["ec646752-561a-4ba7-9c0c-69eb41457d56", "8debcbf9-ef88-4e7a-b25e-5b7d69629a96", "828a6b95-9e5f-4035-b348-6258c1937c87"];

  for (const [id, limit] of [[RESEARCH[0], 3], [RESEARCH[1], 3], [RESEARCH[2], 5]] as const) {
    test(`Research Investment ${id.slice(0, 6)}: you and the named opponent fetch up to ${limit} staples; the third player does not`, () => {
      const staples = (owner: PlayerId) =>
        Array.from({ length: 6 }, (_, i) => ({
          key: `${owner}-s${i}`,
          def: resourceCard({ name: `Staple${owner}${i}`, resource: { provides: ["rage"], staple: true } }),
          owner,
          zone: "deck" as const
        }));
      const { engine, id: card } = buildGame({
        players: SEATS,
        cards: [{ key: "ri", def: printing(id), owner: "p1", zone: "hand" }, ...bank("elitism", 6), ...staples("p1"), ...staples("p2"), ...staples("p3")]
      });
      const play = (opponentId?: string) =>
        engine.perform({ type: "playCard", playerId: "p1", cardId: card("ri"), ...(opponentId ? { opponentId } : {}) } as never);
      assert.throws(() => play(), /Choose which opponent/);
      play("p3");
      resolvePendingResponses(engine);
      pick(engine, "p1", ...[0, 1, 2, 3, 4, 5].slice(0, limit).map(i => card(`p1-s${i}`)));
      pick(engine, "p3", ...[0, 1, 2, 3, 4, 5].slice(0, limit).map(i => card(`p3-s${i}`)));
      assert.equal(pending(engine), undefined);
      const resourcesInPlay = (owner: PlayerId) =>
        Object.values(engine.state.cards).filter(c => c.controllerId === owner && c.zone === "play" && engine.getDefinition(c.id).type === "resource").length;
      assert.equal(resourcesInPlay("p1"), 6 + limit);
      assert.equal(resourcesInPlay("p3"), limit);
      assert.equal(resourcesInPlay("p2"), 0, "the third player fetches nothing");
    });
  }

  const TREMOR = ["37a2c6f2-a2aa-434c-92d3-0d5e7ab38cbc", "de074019-381e-4229-85db-46d2d7c30eb4", "f58d1a64-ffe6-44e6-a0fb-7fee920c215d"];

  for (const id of TREMOR) {
    test(`Tremor Engine ${id.slice(0, 6)}: at the start of your turn only you and the chosen opponent mill 2`, () => {
      const { engine } = buildGame({
        players: SEATS,
        activePlayerId: "p3",
        cards: [{ key: "te", def: printing(id), owner: "p1" }, ...stock("p1", "deck", 5), ...stock("p2", "deck", 5), ...stock("p3", "deck", 5)]
      });
      engine.perform({ type: "endTurn", playerId: "p3" });
      resolvePendingResponses(engine);
      settleTriggers(engine, "grind");
      assert.equal(pending(engine)?.kind, "chooseOpponent", "nothing names the opponent: the controller is asked");
      reply(engine, "p1", { kind: "chooseOpponent", opponentId: "p2" });
      assert.equal(inZone(engine, "p1", "discard"), 2);
      assert.equal(inZone(engine, "p2", "discard"), 2);
      assert.equal(inZone(engine, "p3", "discard"), 0, "the third player's deck is untouched");
    });
  }

  test("Tremor Engine: classic two-player play is unchanged (both mill, nothing asked)", () => {
    const { engine } = buildGame({
      players: ONE_ON_ONE,
      activePlayerId: "p2",
      cards: [{ key: "te", def: printing(TREMOR[1]), owner: "p1" }, ...stock("p1", "deck", 5), ...stock("p2", "deck", 5)]
    });
    engine.perform({ type: "endTurn", playerId: "p2" });
    resolvePendingResponses(engine);
    settleTriggers(engine, "grind");
    assert.equal(pending(engine), undefined);
    assert.equal(inZone(engine, "p1", "discard"), 2);
    assert.equal(inZone(engine, "p2", "discard"), 2);
  });

  const HEXAPEDE_BOTH = "de6f188a-119d-4da0-9965-70b258c40ec5";
  const HEXAPEDE_ALL = "0aaa4b25-4774-48c8-89ee-6c6884d96435";

  for (const [id, third] of [[HEXAPEDE_BOTH, "keeps"], [HEXAPEDE_ALL, "loses"]] as const) {
    test(`Hideous Hexapede of Horror ${id.slice(0, 6)}: ${id === HEXAPEDE_BOTH ? "\"Both players\"" : "\"All players\""} - the third player ${third} their cards`, () => {
      const { engine, id: card } = buildGame({
        players: SEATS,
        cards: [
          { key: "hex", def: printing(id), owner: "p1" },
          ...bank("obsession", 6),
          ...Array.from({ length: 6 }, (_, i) => ({ key: `v${i}`, def: character({ name: `V${i}`, life: 1 }), owner: "p2" as PlayerId, zone: "play" as const })),
          ...["p1", "p2", "p3"].flatMap(p => [...stock(p, "hand", 6), ...stock(p, "discard", 6), ...stock(p, "deck", 6)])
        ]
      });
      const victims = [0, 1, 2, 3, 4, 5].map(i => card(`v${i}`));
      const act = (opponentId?: string) =>
        activate(engine, "p1", card("hex"), "hellish-hex", { selected: { victims }, ...(opponentId ? { opponentId } : {}) });
      if (id === HEXAPEDE_BOTH) assert.throws(() => act(), /Choose which opponent/);
      act("p2");
      let guard = 0;
      while (pending(engine) && guard++ < 20) {
        const open = pending(engine)!;
        assert.equal(open.kind, "chooserSelectsTarget");
        const zone = (open.declaration as { id: string }).id === "rfgHand" ? "hand" : "discard";
        const cards = [0, 1, 2, 3, 4, 5].map(i => card(`${open.playerId}-${zone}${i}`));
        reply(engine, open.playerId, { kind: "chooserSelectsTarget", selected: cards });
      }
      // The Hexapede itself (p1) and the six destroyed victims (p2) reach a discard pile before the removal.
      for (const [owner, left] of [["p1", 1], ["p2", 6]] as Array<[PlayerId, number]>) {
        assert.equal(inZone(engine, owner, "hand"), 0, `${owner} removed their hand`);
        assert.equal(inZone(engine, owner, "discard"), left, `${owner} removed 6 from their discard pile`);
        assert.equal(inZone(engine, owner, "deck"), 0, `${owner} removed the top 6 of their deck`);
      }
      const expected = third === "keeps" ? 6 : 0;
      assert.equal(inZone(engine, "p3", "hand"), expected);
      assert.equal(inZone(engine, "p3", "discard"), expected);
      assert.equal(inZone(engine, "p3", "deck"), expected);
    });
  }
});

describe("3p1ph4ny 31f - \"If you do, your opponent may do the same\" (one opponent)", () => {
  const PRINTINGS = ["579cf37c-1b99-47a8-b090-96bc06ea81b9", "3398fc6e-d1fd-487d-85f2-59486e3256eb", "0de292e7-cc1a-481a-ad01-697f928caac1"];
  const free = (key: string, owner: PlayerId) => ({ key, def: character({ name: key, cost: 0 }), owner, zone: "hand" as const });

  for (const id of PRINTINGS) {
    test(`${id.slice(0, 6)}: only the chosen opponent may deploy a free card after you do`, () => {
      const { engine, id: card } = buildGame({
        players: SEATS,
        cards: [{ key: "x", def: printing(id), owner: "p1", zone: "hand" }, ...bank("elitism", 5), free("h1", "p1"), free("h2", "p2"), free("h3", "p3")]
      });
      engine.perform({ type: "playCard", playerId: "p1", cardId: card("x") } as never);
      resolvePendingResponses(engine);
      if (pending(engine)?.kind === "chooseOpponent") reply(engine, "p1", { kind: "chooseOpponent", opponentId: "p3" });
      reply(engine, "p1", { kind: "deployForFree", cardId: card("h1") });
      assert.equal(pending(engine)?.kind, "deployForFree");
      assert.equal(pending(engine)?.playerId, "p3", "the opponent chosen, not every opponent");
      reply(engine, "p3", { kind: "deployForFree", cardId: card("h3") });
      assert.equal(pending(engine), undefined, "p2 is never asked");
      assert.equal(zoneOf(engine, card("h1")), "play");
      assert.equal(zoneOf(engine, card("h3")), "play");
      assert.equal(zoneOf(engine, card("h2")), "hand");
    });
  }

  test("a declined deploy ends it: the opponent is not offered one", () => {
    const { engine, id: card } = buildGame({
      players: SEATS,
      cards: [{ key: "x", def: printing(PRINTINGS[1]), owner: "p1", zone: "hand" }, ...bank("elitism", 5), free("h1", "p1"), free("h3", "p3")]
    });
    engine.perform({ type: "playCard", playerId: "p1", cardId: card("x") } as never);
    resolvePendingResponses(engine);
    if (pending(engine)?.kind === "chooseOpponent") reply(engine, "p1", { kind: "chooseOpponent", opponentId: "p3" });
    reply(engine, "p1", { kind: "deployForFree" });
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, card("h3")), "hand");
  });

  test("classic two-player play is unchanged (the opponent is offered a free deploy, nothing asked)", () => {
    const { engine, id: card } = buildGame({
      players: ONE_ON_ONE,
      cards: [{ key: "x", def: printing(PRINTINGS[1]), owner: "p1", zone: "hand" }, ...bank("elitism", 5), free("h1", "p1"), free("h2", "p2")]
    });
    engine.perform({ type: "playCard", playerId: "p1", cardId: card("x") } as never);
    resolvePendingResponses(engine);
    assert.equal(pending(engine)?.kind, "deployForFree");
    reply(engine, "p1", { kind: "deployForFree", cardId: card("h1") });
    assert.equal(pending(engine)?.playerId, "p2");
    reply(engine, "p2", { kind: "deployForFree", cardId: card("h2") });
    assert.equal(zoneOf(engine, card("h2")), "play");
  });
});

/** A battle at a three-player table: `attacker` hits `defender`'s faction with `attackerIds`, who declares `blockerIds`. */
function startBattle(engine: Engine, attacker: PlayerId, defender: PlayerId, attackerIds: string[], blockerIds: string[]): void {
  engine.perform({ type: "declareAttack", playerId: attacker, attackerIds, target: { type: "faction", playerId: defender } } as never);
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: defender, blockerIds } as never);
}

const fighter = (key: string, owner: PlayerId, over: Partial<CardDefinition> = {}) => ({
  key,
  def: character({ name: key, strength: 2, life: 9, speed: 2, ...over }),
  owner,
  zone: "play" as const
});

describe("Bask Bomb - \"your opponent\" is the player blocking this battle", () => {
  const BASK_BOMB = "a67ac7f3-66f3-4c84-ab2a-761c577fe776";

  test("the blocking player (not the bystander) divides the Y damage; no opponent need be named", () => {
    const { engine, id } = buildGame({
      players: SEATS,
      cards: [
        { key: "bb", def: printing(BASK_BOMB), owner: "p1", zone: "hand" },
        fighter("a1", "p1", { strength: 3 }),
        fighter("a2", "p1"),
        fighter("x2", "p2"),
        fighter("b3", "p3"),
        ...bank("rage", 3)
      ]
    });
    startBattle(engine, "p1", "p3", [id("a1"), id("a2")], [id("b3")]);
    engine.perform({
      type: "playCard",
      playerId: "p1",
      cardId: id("bb"),
      selected: { c: [id("a1")], bl: [id("b3")], at: [id("a1"), id("a2")] }
    } as never);
    resolvePendingResponses(engine);
    assert.equal(pending(engine)?.kind, "distributeAmong");
    assert.equal(pending(engine)?.playerId, "p1", "you divide X");
    engine.perform({ type: "resolvePendingChoice", playerId: "p1", choice: { kind: "distributeAmong", shares: { [id("b3")]: 6 } } } as never);
    assert.equal(pending(engine)?.kind, "distributeAmong");
    assert.equal(pending(engine)?.playerId, "p3", "the blocking player divides Y, not the other opponent");
    engine.perform({ type: "resolvePendingChoice", playerId: "p3", choice: { kind: "distributeAmong", shares: { [id("a2")]: 3 } } } as never);
    assert.equal(engine.state.cards[id("b3")].damage, 6);
    assert.equal(engine.state.cards[id("a2")].damage, 3);
    assert.equal(zoneOf(engine, id("a1")), "discard");
  });
});

describe("Draconarius Slitherform - \"your opponents' characters\" (every opponent, one distribution)", () => {
  const SLITHER = "b6a07adb-0334-454a-a8d4-019dabbdcc8b";
  const KILL = tactic({
    name: "Kill",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

  const kill = (seats: typeof SEATS, extra: ReturnType<typeof fighter>[]) => {
    const { engine, id } = buildGame({
      players: seats,
      cards: [{ key: "dr", def: printing(SLITHER), owner: "p1", zone: "play" }, { key: "kill", def: KILL, owner: "p1", zone: "hand" }, ...extra]
    });
    engine.perform({ type: "playCard", playerId: "p1", cardId: id("kill"), selected: { t: [id("dr")] } } as never);
    resolvePendingResponses(engine);
    return { engine, id };
  };

  test("the damage is divided among the characters of both opponents, with no opponent asked for", () => {
    const { engine, id } = kill(SEATS, [fighter("x2", "p2"), fighter("y2", "p2"), fighter("z3", "p3")]);
    assert.equal(pending(engine)?.kind, "distributeAmong", "every opponent's character is in the pool; no opponent is asked for");
    assert.deepEqual([...(pending(engine)?.targets as string[])].sort(), [id("x2"), id("y2"), id("z3")].sort());
    assert.equal(pending(engine)?.amount, engine.getStat(id("dr"), "strength"));
    reply(engine, "p1", { kind: "distributeAmong", shares: { [id("x2")]: 1, [id("y2")]: 1, [id("z3")]: 2 } });
    assert.deepEqual([id("x2"), id("y2"), id("z3")].map(card => engine.state.cards[card].damage), [1, 1, 2]);
  });

  test("a character you control is not a legal pick", () => {
    const { engine, id } = kill(SEATS, [fighter("own", "p1"), fighter("x2", "p2"), fighter("z3", "p3")]);
    assert.equal(pending(engine)?.kind, "distributeAmong");
    assert.deepEqual([...(pending(engine)?.targets as string[])].sort(), [id("x2"), id("z3")].sort());
    assert.throws(() => reply(engine, "p1", { kind: "distributeAmong", shares: { [id("own")]: 4 } }));
  });

  test("classic two-player play is unchanged: the single opponent's characters", () => {
    const { engine, id } = kill(ONE_ON_ONE, [fighter("x2", "p2"), fighter("y2", "p2")]);
    assert.equal(pending(engine)?.kind, "distributeAmong");
    reply(engine, "p1", { kind: "distributeAmong", shares: { [id("x2")]: 3, [id("y2")]: 1 } });
    assert.deepEqual([id("x2"), id("y2")].map(card => engine.state.cards[card].damage), [3, 1]);
  });
});

const ownedBy = (engine: Engine, owner: PlayerId, name: string) =>
  Object.values(engine.state.cards).filter(c => c.controllerId === owner && c.zone === "play" && engine.getDefinition(c.id).name === name).length;

describe("Hilarious Refrigerator Alarm - \"each opponent may put 3 Micromajig tokens\"", () => {
  const ALARM = "febadb33-11cf-4dec-815b-5e86d03488f0";

  test("every opponent is offered the tokens, in turn order, each deciding for themselves", () => {
    const { engine, id } = buildGame({
      players: SEATS,
      cards: [{ key: "al", def: printing(ALARM), owner: "p1", zone: "hand" }, ...bank("elitism", 2)]
    });
    engine.perform({ type: "playCard", playerId: "p1", cardId: id("al"), opponentId: "p2" } as never);
    resolvePendingResponses(engine);
    assert.equal(pending(engine)?.kind, "mayPay");
    assert.equal(pending(engine)?.playerId, "p2");
    reply(engine, "p2", { kind: "mayPay", pay: true });
    assert.equal(pending(engine)?.kind, "mayPay");
    assert.equal(pending(engine)?.playerId, "p3", "the other opponent is offered it too");
    reply(engine, "p3", { kind: "mayPay", pay: false });
    assert.equal(pending(engine), undefined);
    assert.equal(ownedBy(engine, "p2", "Micromajig"), 3);
    assert.equal(ownedBy(engine, "p3", "Micromajig"), 0);
    assert.equal(ownedBy(engine, "p1", "Micromajig"), 0);
  });

  test("classic two-player play is unchanged (the opponent is offered the tokens, nothing asked)", () => {
    const { engine, id } = buildGame({
      players: ONE_ON_ONE,
      cards: [{ key: "al", def: printing(ALARM), owner: "p1", zone: "hand" }, ...bank("elitism", 2)]
    });
    engine.perform({ type: "playCard", playerId: "p1", cardId: id("al") } as never);
    resolvePendingResponses(engine);
    assert.equal(pending(engine)?.playerId, "p2");
    reply(engine, "p2", { kind: "mayPay", pay: true });
    assert.equal(ownedBy(engine, "p2", "Micromajig"), 3);
  });
});

describe("Spatchcocking RECUR - \"Each opponent reveals their hand, chooses a card of each non-resource type ...\"", () => {
  const SPATCH = "d23a3fbd-0bf3-4937-9b29-570c55a418b8";

  const board = (seats: typeof SEATS) =>
    buildGame({
      players: seats,
      cards: [
        { key: "sp", def: printing(SPATCH), owner: "p1", zone: "discard" },
        ...bank("obsession", 4),
        ...seats.flatMap(seat => stock(seat.id, "hand", 3))
      ]
    });

  test("each opponent keeps one character from their hand and discards the rest; you are untouched", () => {
    const { engine, id } = board(SEATS);
    activate(engine, "p1", id("sp"), "spatchcocking-recur");
    for (const opponent of ["p2", "p3"] as PlayerId[]) {
      assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
      assert.equal(pending(engine)?.playerId, opponent, "each opponent chooses for themselves, in turn order");
      pick(engine, opponent, id(`${opponent}-hand0`));
    }
    assert.equal(pending(engine), undefined);
    for (const opponent of ["p2", "p3"] as PlayerId[]) {
      assert.equal(zoneOf(engine, id(`${opponent}-hand0`)), "hand");
      assert.equal(zoneOf(engine, id(`${opponent}-hand1`)), "discard");
      assert.equal(zoneOf(engine, id(`${opponent}-hand2`)), "discard");
    }
    assert.equal(inZone(engine, "p1", "hand"), 3);
    assert.equal(zoneOf(engine, id("sp")), "removed");
  });

  test("classic two-player play is unchanged (the opponent chooses, nothing asked)", () => {
    const { engine, id } = board(ONE_ON_ONE);
    activate(engine, "p1", id("sp"), "spatchcocking-recur");
    pick(engine, "p2", id("p2-hand1"));
    assert.equal(zoneOf(engine, id("p2-hand1")), "hand");
    assert.equal(zoneOf(engine, id("p2-hand0")), "discard");
    assert.equal(inZone(engine, "p1", "hand"), 3);
  });
});

describe("Epic Smackdown", () => {
  const SEED_2 = "0642737a-cb86-402f-bca9-293ea6c252cc";
  const SEED_SAGA = "74da08f9-ea6b-4ac6-af80-2734f1860cae";

  /** p2 controls three characters; p3 (when seated) controls `p3Count`. */
  const board = (seats: typeof SEATS, id: string, p3Count = 3) =>
    buildGame({
      players: seats,
      cards: [
        { key: "es", def: printing(id), owner: "p1", zone: "hand" },
        ...bank("rage", 3),
        fighter("m1", "p1"),
        fighter("m2", "p1"),
        ...["a", "b", "c"].map(suffix => fighter(`p2${suffix}`, "p2")),
        ...(seats.length > 2 ? ["a", "b", "c"].slice(0, p3Count).map(suffix => fighter(`p3${suffix}`, "p3")) : []),
        ...stock("p1", "deck", 2)
      ]
    });

  test("Seed Saga: each opponent destroys X of their own characters (or all, with fewer than X)", () => {
    // X = 2: p2 has 3 characters (chooses 2 to destroy); p3 has only 1 (loses all of them).
    const { engine, id } = board(SEATS, SEED_SAGA, 1);
    engine.perform({
      type: "playCard",
      playerId: "p1",
      cardId: id("es"),
      selected: { sacX: [id("m1"), id("m2")] },
      variables: { x: 2 }
    } as never);
    resolvePendingResponses(engine);
    assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
    assert.equal(pending(engine)?.playerId, "p2");
    pick(engine, "p2", id("p2a"), id("p2b"));
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, id("p2a")), "discard");
    assert.equal(zoneOf(engine, id("p2b")), "discard");
    assert.equal(zoneOf(engine, id("p2c")), "play");
    assert.equal(zoneOf(engine, id("p3a")), "discard", "an opponent with fewer than X loses every character");
    assert.equal(inZone(engine, "p1", "hand"), 1, "and you draw once");
  });

  test("Seed 2 (singular \"your opponent\"): only the named opponent is affected", () => {
    const { engine, id } = board(SEATS, SEED_2);
    engine.perform({
      type: "playCard",
      playerId: "p1",
      cardId: id("es"),
      selected: { sacX: [id("m1"), id("m2")] },
      variables: { x: 2 },
      opponentId: "p3"
    } as never);
    resolvePendingResponses(engine);
    assert.equal(pending(engine)?.playerId, "p3");
    pick(engine, "p3", id("p3a"), id("p3b"));
    assert.equal(zoneOf(engine, id("p3a")), "discard");
    assert.equal(zoneOf(engine, id("p2a")), "play");
    assert.equal(zoneOf(engine, id("p2b")), "play");
    assert.equal(zoneOf(engine, id("p2c")), "play");
  });

  test("Seed Saga: classic two-player play is unchanged", () => {
    const { engine, id } = board(ONE_ON_ONE, SEED_SAGA);
    engine.perform({
      type: "playCard",
      playerId: "p1",
      cardId: id("es"),
      selected: { sacX: [id("m1"), id("m2")] },
      variables: { x: 2 }
    } as never);
    resolvePendingResponses(engine);
    assert.equal(pending(engine)?.playerId, "p2");
    pick(engine, "p2", id("p2a"), id("p2c"));
    assert.equal(zoneOf(engine, id("p2b")), "play");
    assert.equal(inZone(engine, "p1", "hand"), 1);
  });
});

const KILL_TACTIC = tactic({
  name: "Kill",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "k",
        type: "activated",
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
      }
    ]
  }
});

describe("Lucky Bastard - compare numeric costs of the removed cards", () => {
  const SEED_2 = "85fcf752-5566-427e-a993-49531a2f38b0";
  const SEED_SAGA = "4513085a-6185-4ef5-ba9c-7af3c3af30d4";

  /** Each deck is a top card of the given cost over one spare card; the Bastard is destroyed by a Kill. */
  const destroy = (id: string, costs: Record<string, number>, kill = true) => {
    const seats = Object.keys(costs).map(playerId => ({ id: playerId, faction: noDevelopFaction() }));
    const built = buildGame({
      players: seats,
      cards: [
        { key: "lb", def: printing(id), owner: "p1", zone: "play" },
        { key: "kill", def: KILL_TACTIC, owner: "p1", zone: "hand" },
        ...Object.entries(costs).flatMap(([owner, cost]) => [
          { key: `${owner}-top`, def: character({ name: `${owner}Top`, cost }), owner, zone: "deck" as const },
          { key: `${owner}-spare`, def: character({ name: `${owner}Spare`, cost: 0 }), owner, zone: "deck" as const }
        ])
      ]
    });
    if (kill) {
      built.engine.perform({ type: "playCard", playerId: "p1", cardId: built.id("kill"), selected: { t: [built.id("lb")] } } as never);
      resolvePendingResponses(built.engine);
    }
    return built;
  };

  test("Seed Saga: it survives when your removed card costs at least as much as each opponent's", () => {
    const { engine, id } = destroy(SEED_SAGA, { p1: 5, p2: 2, p3: 5 });
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, id("lb")), "play");
    for (const owner of ["p1", "p2", "p3"]) assert.equal(zoneOf(engine, id(`${owner}-top`)), "removed", `${owner}'s top card is removed`);
    assert.equal(inZone(engine, "p1", "hand"), 1, "and you draw a card");
  });

  test("Seed Saga: it is removed when ANY opponent's removed card costs more", () => {
    const { engine, id } = destroy(SEED_SAGA, { p1: 5, p2: 2, p3: 6 });
    assert.equal(zoneOf(engine, id("lb")), "removed");
    for (const owner of ["p1", "p2", "p3"]) assert.equal(zoneOf(engine, id(`${owner}-top`)), "removed");
    assert.equal(inZone(engine, "p1", "hand"), 0);
  });

  test("Seed Saga: classic two-player play is unchanged", () => {
    const survives = destroy(SEED_SAGA, { p1: 4, p2: 4 });
    assert.equal(zoneOf(survives.engine, survives.id("lb")), "play");
    const dies = destroy(SEED_SAGA, { p1: 3, p2: 4 });
    assert.equal(zoneOf(dies.engine, dies.id("lb")), "removed");
  });

  for (const printed of [SEED_SAGA, SEED_2]) {
    test(`${printed.slice(0, 6)}: lethal damage is replaced too - a won comparison at three players leaves it in play with 0 damage`, () => {
      const HIT = tactic({
        name: "Hit",
        cost: 0,
        behavior: {
          abilities: [
            {
              id: "h",
              type: "activated",
              targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
              effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 4 }]
            }
          ]
        }
      });
      const { engine, id } = buildGame({
        players: SEATS,
        activePlayerId: "p2",
        cards: [
          { key: "lb", def: printing(printed), owner: "p1", zone: "play" },
          { key: "hit", def: HIT, owner: "p2", zone: "hand" },
          ...["p1", "p2", "p3"].flatMap((owner, i) => [
            { key: `${owner}-top`, def: character({ name: `${owner}Top`, cost: i === 0 ? 5 : 3 }), owner, zone: "deck" as const },
            { key: `${owner}-spare`, def: character({ name: `${owner}Spare`, cost: 0 }), owner, zone: "deck" as const }
          ])
        ]
      });
      engine.perform({ type: "playCard", playerId: "p2", cardId: id("hit"), selected: { t: [id("lb")] } } as never);
      resolvePendingResponses(engine);
      assert.equal(zoneOf(engine, id("lb")), "play");
      assert.equal(engine.state.cards[id("lb")].damage, 0);
      for (const owner of ["p1", "p2", "p3"]) assert.equal(zoneOf(engine, id(`${owner}-top`)), "removed");
    });
  }

  test("Seed 2 (prints \"both players\" / \"your opponent's\"): a replacement cannot ask which opponent, so it too compares against every opponent", () => {
    const survives = destroy(SEED_2, { p1: 5, p2: 2, p3: 5 });
    assert.equal(pending(survives.engine), undefined);
    assert.equal(zoneOf(survives.engine, survives.id("lb")), "play");
    const dies = destroy(SEED_2, { p1: 5, p2: 2, p3: 6 });
    assert.equal(zoneOf(dies.engine, dies.id("lb")), "removed");
    const classic = destroy(SEED_2, { p1: 3, p2: 4 });
    assert.equal(zoneOf(classic.engine, classic.id("lb")), "removed");
  });
});

describe("Meat of the Mountain - \"If a player draws any number of cards, that player ...\"", () => {
  const MEAT = "60eab41e-55d8-428c-991a-de347296fa4f";
  const DRAWER = character({
    name: "Drawer",
    behavior: { abilities: [{ id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

  const board = (seats: typeof SEATS, tokens: number, active: PlayerId) =>
    buildGame({
      players: seats,
      activePlayerId: active,
      cards: [
        { key: "meat", def: printing(MEAT), owner: "p1", counters: { token: tokens } },
        ...seats.map(seat => ({ key: `d-${seat.id}`, def: character({ ...DRAWER, id: `drawer-${seat.id}` }), owner: seat.id, zone: "play" as const })),
        ...seats.flatMap(seat => [...stock(seat.id, "deck", 3), ...stock(seat.id, "hand", 3)])
      ]
    });

  const draw = (engine: Engine, id: (key: string) => string, player: PlayerId) => activate(engine, player, id(`d-${player}`), "draw1");

  test("another player's draw lets THAT player use the token effects (3 tokens: they play a resource)", () => {
    const { engine, id } = board(SEATS, 2, "p2");
    draw(engine, id, "p2");
    assert.equal(pending(engine)?.kind, "chooserSelectsOption");
    assert.equal(pending(engine)?.playerId, "p2", "the drawing player decides, not the Meat's controller");
    reply(engine, "p2", { kind: "chooserSelectsOption", index: 1 });
    assert.equal(engine.state.cards[id("meat")].counters.token, 3);
    assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
    assert.equal(pending(engine)?.playerId, "p2");
  });

  test("a third player's draw is also theirs (and not the controller's)", () => {
    const { engine, id } = board(SEATS, 2, "p3");
    draw(engine, id, "p3");
    assert.equal(pending(engine)?.kind, "chooserSelectsOption");
    assert.equal(pending(engine)?.playerId, "p3");
    reply(engine, "p3", { kind: "chooserSelectsOption", index: 0 });
    assert.equal(pending(engine), undefined);
  });

  test("the controller's own draw works the same way", () => {
    const { engine, id } = board(SEATS, 2, "p1");
    draw(engine, id, "p1");
    assert.equal(pending(engine)?.playerId, "p1");
    reply(engine, "p1", { kind: "chooserSelectsOption", index: 1 });
    assert.equal(engine.state.cards[id("meat")].counters.token, 3);
  });

  test("0 TOKENS: the drawing player's opponents (not the drawer) discard a card", () => {
    const { engine, id } = board(SEATS, 1, "p2");
    draw(engine, id, "p2");
    reply(engine, "p2", { kind: "chooserSelectsOption", index: 2 });
    // p2's opponents (p3, then p1, in seat order from p2) each choose their own discard.
    assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
    assert.equal(pending(engine)?.playerId, "p3");
    pick(engine, "p3", id("p3-hand0"));
    assert.equal(pending(engine)?.playerId, "p1");
    pick(engine, "p1", id("p1-hand0"));
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, id("p1-hand0")), "discard");
    assert.equal(zoneOf(engine, id("p3-hand0")), "discard");
    assert.equal(inZone(engine, "p2", "hand"), 4, "the drawer discards nothing (3 + the card drawn)");
  });

  test("classic two-player play is unchanged: the opponent's draw makes the Meat's controller discard at 0 tokens", () => {
    const { engine, id } = board(ONE_ON_ONE, 1, "p2");
    draw(engine, id, "p2");
    reply(engine, "p2", { kind: "chooserSelectsOption", index: 2 });
    assert.equal(pending(engine)?.playerId, "p1");
    pick(engine, "p1", id("p1-hand1"));
    assert.equal(zoneOf(engine, id("p1-hand1")), "discard");
  });
});

describe("attack triggers that say \"your opponent\" mean the player being attacked (E3: the battle's sides)", () => {
  const SPRY_ARCHER = "98321c0c-3aef-4820-8636-9353e3c8a3b0";
  const WYRMFANGS = ["b5fbadf6-df3d-42bd-b55a-daaa1321b076", "97177f3a-80ff-480f-a12e-385472acf43b"];
  const BRIGAND = "fd6ca900-19ab-4786-b4db-7e3c7dbac204";
  const DETHM = ["43a51ff8-16f5-4752-aa41-94d0977d219d", "4451d916-1994-4429-b7f6-cef245cf8a5a"];

  test("Spry Archer: attacking p3 inflicts 1 damage to p3's faction only (nothing asked)", () => {
    const { engine, id } = buildGame({
      players: SEATS,
      cards: [{ key: "sa", def: printing(SPRY_ARCHER), owner: "p1", zone: "play" }, fighter("x2", "p2"), fighter("b3", "p3")]
    });
    const before = { p2: influence(engine, "p2"), p3: influence(engine, "p3") };
    engine.perform({ type: "declareAttack", playerId: "p1", attackerIds: [id("sa")], target: { type: "faction", playerId: "p3" } } as never);
    resolvePendingResponses(engine);
    assert.notEqual(pending(engine)?.kind, "chooseOpponent");
    assert.equal(influence(engine, "p3"), before.p3 - 1);
    assert.equal(influence(engine, "p2"), before.p2);
  });

  for (const wid of WYRMFANGS) {
    test(`Wyrmfang Deathskull ${wid.slice(0, 6)}: the attacked player, not a bystander, picks the characters that must block`, () => {
      const { engine, id } = buildGame({
        players: SEATS,
        cards: [{ key: "wf", def: printing(wid), owner: "p1", zone: "play" }, fighter("x2", "p2"), fighter("b3", "p3"), fighter("c3", "p3")]
      });
      engine.perform({ type: "declareAttack", playerId: "p1", attackerIds: [id("wf")], target: { type: "faction", playerId: "p3" } } as never);
      resolvePendingResponses(engine);
      const open = pending(engine);
      assert.ok(open, "the trigger asks someone to pick blockers");
      assert.notEqual(open.kind, "chooseOpponent");
      assert.equal(open.playerId, "p3", "the defending player is the one who must pick");
    });
  }

  test("Mendacious Brigand: swaps a blocker for a character of the BLOCKING player's that is not in the battle", () => {
    const build = () =>
      buildGame({
        players: SEATS,
        cards: [{ key: "mb", def: printing(BRIGAND), owner: "p1", zone: "play" }, fighter("x2", "p2"), fighter("b3", "p3"), fighter("c3", "p3")]
      });
    {
      const { engine, id } = build();
      startBattle(engine, "p1", "p3", [id("mb")], [id("b3")]);
      assert.equal(pending(engine)?.kind, "selectTargets", "nothing to ask but the picks");
      assert.throws(
        () => reply(engine, "p1", { kind: "selectTargets", selected: { blk: [id("b3")], add: [id("x2")] } }),
        /./,
        "a bystander's character is not a legal pick"
      );
    }
    const { engine, id } = build();
    startBattle(engine, "p1", "p3", [id("mb")], [id("b3")]);
    reply(engine, "p1", { kind: "selectTargets", selected: { blk: [id("b3")], add: [id("c3")] } });
    assert.deepEqual(engine.state.battle?.blockingParty, [id("c3")]);
  });

  for (const did of DETHM) {
    test(`Dethmurderbludgeon ${did.slice(0, 6)}: when blocked, the blocking player's faction loses 2 influence`, () => {
      const { engine, id } = buildGame({
        players: SEATS,
        cards: [
          fighter("a1", "p1"),
          { key: "dm", def: printing(did), owner: "p1", zone: "play", attachedToKey: "a1" },
          fighter("x2", "p2"),
          fighter("b3", "p3")
        ]
      });
      const before = { p2: influence(engine, "p2"), p3: influence(engine, "p3") };
      startBattle(engine, "p1", "p3", [id("a1")], [id("b3")]);
      resolvePendingResponses(engine);
      assert.notEqual(pending(engine)?.kind, "chooseOpponent");
      assert.equal(influence(engine, "p3"), before.p3 - 2);
      assert.equal(influence(engine, "p2"), before.p2);
    });
  }
});

describe("I Drink Your Milkshake! - the echo is tied to the opponent whose deck was searched (E2 + E3)", () => {
  const PRINTINGS = ["6f1bdb80-2506-4724-bf83-950a81cc531a", "83807d38-2e87-4c3e-9167-5488979e4267"];

  for (const mid of PRINTINGS) {
    test(`${mid.slice(0, 6)}: a same-named card played by the OTHER opponent does not trigger it; the searched opponent's does`, () => {
      const twin = (owner: PlayerId, key: string, zone: "deck" | "hand") => ({ key, def: character({ name: "Twin", cost: 0 }), owner, zone });
      const { engine, id } = buildGame({
        players: SEATS,
        cards: [
          { key: "ms", def: printing(mid), owner: "p1", zone: "hand" },
          ...bank("deception", 4),
          twin("p2", "p2-deck-twin", "deck"),
          twin("p2", "p2-hand-twin", "hand"),
          twin("p3", "p3-hand-twin", "hand"),
          ...stock("p2", "deck", 2)
        ]
      });
      // Pick a card of p2's deck: that settles p2 as the opponent this is about (no opponent need be named).
      engine.perform({ type: "playCard", playerId: "p1", cardId: id("ms"), selected: { dig: [id("p2-deck-twin")] } } as never);
      resolvePendingResponses(engine);
      assert.equal(pending(engine), undefined);
      assert.notEqual(zoneOf(engine, id("p2-deck-twin")), "deck", "p2's card was searched out");

      // p3 plays a card with the same name: no echo for p1.
      engine.state.activePlayerId = "p3";
      engine.perform({ type: "playCard", playerId: "p3", cardId: id("p3-hand-twin") } as never);
      resolvePendingResponses(engine);
      assert.equal(pending(engine), undefined, "p3 is not the opponent whose deck was searched");

      // p2 plays one: p1 may reveal the removed card and deploy it.
      engine.state.activePlayerId = "p2";
      engine.perform({ type: "playCard", playerId: "p2", cardId: id("p2-hand-twin") } as never);
      resolvePendingResponses(engine);
      assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
      assert.equal(pending(engine)?.playerId, "p1");
      pick(engine, "p1", id("p2-deck-twin"));
      reply(engine, "p1", { kind: "deployForFree", cardId: id("p2-deck-twin") });
      assert.equal(engine.state.cards[id("p2-deck-twin")].controllerId, "p1", "you deploy the removed card");
    });
  }
});

/** End `playerId`'s turn and settle the start of the next one, resolving the trigger `abilityId` first. */
function nextTurn(engine: Engine, playerId: PlayerId, abilityId: string): void {
  engine.perform({ type: "endTurn", playerId } as never);
  resolvePendingResponses(engine);
  settleTriggers(engine, abilityId);
}

describe("d rulings kept as encoded: \"both players\" / \"their opponent\" at the start of EACH player's turn means every player", () => {
  const CHEST = "fe7095e0-d918-420c-9303-fbc5054d2564";
  const FTA = ["72056e1f-62f5-41e1-865f-6a40a18a609e", "6a09105b-8cde-488e-ae5b-89ebc81beade", "234559f8-329c-4c05-bc09-c34e087a4182"];
  const EMBIGGENER = "88ddad6c-4df5-4baa-b1b8-c7492f67d42e";

  const withStock = (seats: typeof SEATS, extra: ReturnType<typeof stock>) => [
    ...seats.flatMap(seat => [...stock(seat.id, "deck", 4), ...stock(seat.id, "hand", 2)]),
    ...extra
  ];
  const handSize = (engine: Engine, owner: PlayerId) => inZone(engine, owner, "hand");

  test("Community Chest: at p2's turn start every player (p2, p3, p1 in seat order) may draw a card or play a resource", () => {
    const { engine } = buildGame({
      players: SEATS,
      cards: [{ key: "cc", def: printing(CHEST), owner: "p1" }, ...withStock(SEATS, [])]
    });
    nextTurn(engine, "p1", "chest-boon");
    const offered: string[] = [];
    while (pending(engine)?.kind === "mayPay") {
      offered.push(pending(engine)!.playerId);
      reply(engine, pending(engine)!.playerId, { kind: "mayPay", pay: true });
      assert.equal(pending(engine)?.kind, "chooserSelectsOption");
      reply(engine, pending(engine)!.playerId, { kind: "chooserSelectsOption", index: 0 });
    }
    assert.deepEqual(offered, ["p2", "p3", "p1"]);
    for (const owner of ["p1", "p2", "p3"] as PlayerId[]) assert.equal(handSize(engine, owner), 3, `${owner} drew`);
  });

  test("Free Trade Agreement: with option 1 the active player draws and every other player may play a resource", () => {
    for (const id of FTA) {
      const resource = (owner: PlayerId) => ({ key: `${owner}-res`, def: resourceCard({ name: `Res${owner}`, resource: { provides: ["rage"], staple: true } }), owner, zone: "hand" as const });
      const { engine, id: card } = buildGame({
        players: SEATS,
        cards: [{ key: "fta", def: printing(id), owner: "p1" }, ...withStock(SEATS, [resource("p1"), resource("p3")])]
      });
      nextTurn(engine, "p1", "modal");
      assert.equal(pending(engine)?.kind, "chooserSelectsOption");
      assert.equal(pending(engine)?.playerId, "p2", "the turn's player chooses");
      reply(engine, "p2", { kind: "chooserSelectsOption", index: 0 });
      reply(engine, "p2", { kind: "mayPay", pay: true });
      // Every other player (p3 then p1) is offered the resource play.
      assert.equal(pending(engine)?.playerId, "p3");
      reply(engine, "p3", { kind: "chooserSelectsTarget", selected: [card("p3-res")], faceDown: true });
      assert.equal(pending(engine)?.playerId, "p1");
      reply(engine, "p1", { kind: "chooserSelectsTarget", selected: [card("p1-res")], faceDown: true });
      assert.equal(zoneOf(engine, card("p3-res")), "play");
      assert.equal(zoneOf(engine, card("p1-res")), "play");
      assert.equal(handSize(engine, "p2"), 3, "the active player drew");
    }
  });

  test("Free Trade Agreement: with option 3 every player may draw up to 2 cards", () => {
    const { engine } = buildGame({ players: SEATS, cards: [{ key: "fta", def: printing(FTA[1]), owner: "p1" }, ...withStock(SEATS, [])] });
    nextTurn(engine, "p1", "modal");
    reply(engine, "p2", { kind: "chooserSelectsOption", index: 2 });
    const offered: string[] = [];
    while (pending(engine)?.kind === "mayPay") {
      offered.push(pending(engine)!.playerId);
      reply(engine, pending(engine)!.playerId, { kind: "mayPay", pay: true });
    }
    assert.deepEqual(offered, ["p2", "p2", "p3", "p3", "p1", "p1"]);
    for (const owner of ["p1", "p2", "p3"] as PlayerId[]) assert.equal(handSize(engine, owner), 4);
  });

  test("Ambiguity Embiggener: the turn's player picks X, then every player bottoms X cards and draws that many", () => {
    const { engine, id } = buildGame({
      players: SEATS,
      cards: [{ key: "ae", def: printing(EMBIGGENER), owner: "p1" }, ...withStock(SEATS, [])]
    });
    nextTurn(engine, "p1", "wheel");
    assert.equal(pending(engine)?.kind, "chooseNumber");
    assert.equal(pending(engine)?.playerId, "p2");
    reply(engine, "p2", { kind: "chooseNumber", value: 1 });
    for (const player of ["p2", "p3", "p1"] as PlayerId[]) {
      assert.equal(pending(engine)?.playerId, player, "every player in seat order from the turn's player");
      pick(engine, player, id(`${player}-hand0`));
    }
    assert.equal(pending(engine), undefined);
    for (const owner of ["p1", "p2", "p3"] as PlayerId[]) {
      assert.equal(zoneOf(engine, id(`${owner}-hand0`)), "deck");
      assert.equal(handSize(engine, owner), 2, `${owner} put one on the bottom and drew one`);
    }
  });
});

describe("d rulings: \"Your opponent cannot respond to this card\" denies a response to every player (noResponse kept)", () => {
  const VACATION = ["f5b4db56-d972-48de-b1b5-7f16b7d427aa", "4181e922-7ffb-4c71-aef6-17adf4f006c7", "5ca25182-e910-4f21-97d0-b30298e7d4af"];
  const MOLESTATION = ["d0f8ae01-7941-4b39-9292-1ad30f8eec9d", "12cfc4e1-e8f7-431e-a37a-593210181b0c", "f77f9b48-ebfb-4f8f-a32d-46a0309da781"];
  const SOCK_PUPPET = ["ab111049-6ba1-430e-8d27-f647bcd5ac35", "300ab3d1-3214-4fa5-9000-d657e6e7816d"];
  const SUBSECTION = ["8fbf09c1-9f8e-4c2e-8695-fd6f95a4fa8a", "23fe59c9-9bf1-49d1-bfc4-084c556aca80"];
  const VOIDAL = ["7416a581-63a8-495f-a845-f79eeddf2eea", "63369e53-e89b-4b7d-beb0-7110cb1290ce", "b9e94612-3cbd-44ff-9aac-a553a49c0955"];

  /** After the card is played, nobody holds priority to respond to it: it is not left on the stack. */
  const resolvedWithoutAWindow = (engine: Engine) => engine.state.responseWindow === undefined && engine.state.responseStack.length === 0;

  for (const id of VACATION) {
    test(`Tactician Vacation ${id.slice(0, 6)}: resolves at once for a table of three, restricting tactics for every player`, () => {
      const { engine, id: card } = buildGame({
        players: SEATS,
        cards: [{ key: "tv", def: printing(id), owner: "p1", zone: "hand" }, ...bank("rage", 4), { key: "t1", def: KILL_TACTIC, owner: "p1", zone: "hand" }, fighter("x", "p3")]
      });
      engine.perform({ type: "playCard", playerId: "p1", cardId: card("tv") } as never);
      assert.ok(resolvedWithoutAWindow(engine), "no response window is opened on the card");
      assert.equal(zoneOf(engine, card("tv")), "discard");
      // Every player is restricted, the controller included: no tactic may be played this turn.
      assert.throws(
        () => engine.perform({ type: "playCard", playerId: "p1", cardId: card("t1"), selected: { t: [card("x")] } } as never),
        /tactic/i,
        "no tactics can be played afterwards"
      );
    });
  }

  for (const id of MOLESTATION) {
    test(`Degenerate Molestation ${id.slice(0, 6)}: the named opponent discards their whole hand, unanswerable; the other opponent is untouched`, () => {
      const { engine, id: card } = buildGame({
        players: SEATS,
        cards: [{ key: "dm", def: printing(id), owner: "p1", zone: "hand" }, ...bank("obsession", 10), ...stock("p2", "hand", 2), ...stock("p3", "hand", 2)]
      });
      engine.perform({ type: "playCard", playerId: "p1", cardId: card("dm"), opponentId: "p3" } as never);
      for (let guard = 0; guard < 6 && pending(engine); guard++) {
        const open = pending(engine)!;
        if (open.kind === "chooserSelectsTarget") {
          assert.equal(open.playerId, "p3");
          const hand = Object.values(engine.state.cards).find(c => c.ownerId === "p3" && c.zone === "hand")!;
          reply(engine, "p3", { kind: "chooserSelectsTarget", selected: [hand.id] });
        } else {
          reply(engine, open.playerId, { kind: "deployForFree" });
        }
      }
      assert.equal(inZone(engine, "p3", "hand"), 0);
      assert.equal(inZone(engine, "p2", "hand"), 2);
    });
  }

  /** p2's character ability is on the stack, p3 has passed, and p1 (holding `tacticDef`) is to respond. */
  const respondAfterP3Passes = (tacticDef: CardDefinition) => {
    const ZAP = character({
      name: "Zapper",
      behavior: { abilities: [{ id: "zap", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
    });
    const built = buildGame({
      players: SEATS,
      activePlayerId: "p2",
      cards: [
        { key: "zap", def: ZAP, owner: "p2", zone: "play" },
        { key: "resp", def: tacticDef, owner: "p1", zone: "hand" },
        ...stock("p1", "deck", 3),
        ...stock("p2", "deck", 3),
        ...banks(2)
      ]
    });
    built.engine.perform({ type: "activateAbility", playerId: "p2", cardId: built.id("zap"), abilityId: "zap" } as never);
    assert.equal(built.engine.state.responseWindow?.priorityPlayerId, "p3", "priority rotates to the next seat first");
    built.engine.perform({ type: "passPriority", playerId: "p3" } as never);
    assert.equal(built.engine.state.responseWindow?.priorityPlayerId, "p1");
    return built;
  };

  for (const [name, ids] of [["Exploding Sock Puppet!", SOCK_PUPPET], ["Subsection 5, Paragraph 12", SUBSECTION]] as const) {
    for (const pid of ids) {
      test(`${name} ${pid.slice(0, 6)}: played in response, it resolves at once - no window opens for the third player to answer it`, () => {
        const { engine, id } = respondAfterP3Passes(printing(pid));
        engine.perform({ type: "playCard", playerId: "p1", cardId: id("resp") } as never);
        assert.equal(pending(engine), undefined);
        assert.equal(zoneOf(engine, id("resp")), "discard", "it has already resolved");
        assert.ok(
          engine.state.responseStack.every(item => item.sourceId !== id("resp")),
          "it was never left on the stack for the other players to respond to"
        );
      });
    }
  }

  for (const pid of VOIDAL) {
    test(`Voidal Replication ${pid.slice(0, 6)}: duplicates the last tactic with no window for anyone to respond`, () => {
      const SPARK = tactic({
        name: "Spark",
        cost: 0,
        behavior: { abilities: [{ id: "spark", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
      });
      const { engine, id } = buildGame({
        players: SEATS,
        cards: [
          { key: "spark", def: SPARK, owner: "p1", zone: "hand" },
          { key: "vr", def: printing(pid), owner: "p1", zone: "hand" },
          ...stock("p1", "deck", 4),
          ...bank("obsession", 3)
        ]
      });
      engine.perform({ type: "playCard", playerId: "p1", cardId: id("spark") } as never);
      resolvePendingResponses(engine);
      assert.equal(inZone(engine, "p1", "hand"), 2, "Spark drew once (Voidal Replication is still in hand)");
      engine.perform({ type: "playCard", playerId: "p1", cardId: id("vr") } as never);
      assert.equal(zoneOf(engine, id("vr")), "discard", "it resolved without a response window");
      assert.equal(inZone(engine, "p1", "hand"), 2, "the duplicate drew once more");
    });
  }
});

describe("engine-side two-party and standing constructs (no card data change)", () => {
  const CREEDS = ["837d5a93-213d-4e5d-af65-0a6c14c55c7c", "82b3462a-12d5-463b-8984-25059e30ac9a"];
  const AUCTION_HOUSES = ["71886432-9edb-44a6-b9aa-7890b3267cf3", "ae9ae5db-e784-4193-ad45-400f7ba900bc"];
  const MUSTACHES = ["1dffc074-b158-4134-b52e-9e6e56541cf0", "f276a0be-6c30-4276-a743-30e63619dc41"];

  for (const creed of CREEDS) {
    test(`Mercenary's Creed ${creed.slice(0, 6)} (d: "Both players may use this ability" = every player): the third player may Bribe`, () => {
      const { engine, id } = buildGame({
        players: SEATS,
        activePlayerId: "p3",
        cards: [
          fighter("victim", "p2"),
          { key: "creed", def: printing(creed), owner: "p1", attachedToKey: "victim" },
          ...bank("greed", 3, "p3")
        ]
      });
      activate(engine, "p3", id("creed"), "bribe");
      assert.equal(engine.state.cards[id("victim")].controllerId, "p3", "the activating player takes control");
    });
  }

  for (const house of AUCTION_HOUSES) {
    test(`Auction House ${house.slice(0, 6)}: every player bids in seat order from the active player`, () => {
      const { engine, id } = buildGame({
        players: SEATS,
        cards: [
          { key: "ah", def: printing(house), owner: "p1" },
          { key: "skipped", def: tactic({ name: "Skipped" }), owner: "p2", zone: "deck" },
          { key: "prize", def: character({ name: "Prize" }), owner: "p2", zone: "deck" },
          ...bank("greed", 4, "p1"),
          ...bank("greed", 4, "p2"),
          ...bank("greed", 4, "p3")
        ]
      });
      nextTurn(engine, "p1", "auction");
      const bidFor = (player: PlayerId, bid: number) => {
        assert.equal(pending(engine)?.kind, "auctionBid");
        assert.equal(pending(engine)?.playerId, player);
        reply(engine, player, { kind: "auctionBid", bid });
      };
      bidFor("p2", 1);
      bidFor("p3", 2);
      bidFor("p1", 0);
      bidFor("p2", 0);
      assert.equal(pending(engine), undefined);
      assert.equal(engine.state.cards[id("prize")].controllerId, "p3", "the standing high bidder wins");
      assert.equal(engine.state.cards[id("prize")].zone, "play");
    });
  }

  for (const mustache of MUSTACHES) {
    test(`Mustache Aficionado ${mustache.slice(0, 6)}: only you and the named opponent divide piles`, () => {
      const { engine, id } = buildGame({
        players: SEATS,
        cards: [{ key: "mu", def: printing(mustache), owner: "p1" }, ...stock("p1", "deck", 4), ...stock("p2", "deck", 4), ...stock("p3", "deck", 4)]
      });
      activate(engine, "p1", id("mu"), "mustache-showdown", { opponentId: "p3" });
      const askedOf: string[] = [];
      for (let guard = 0; guard < 8 && pending(engine); guard++) {
        const open = pending(engine)!;
        askedOf.push(open.playerId);
        if (open.kind === "pileAssignment") {
          const cards = (open.cardIds ?? open.cards) as string[];
          reply(engine, open.playerId, { kind: "pileAssignment", pile1: cards.slice(0, 1), pile2: cards.slice(1) });
        } else {
          break;
        }
      }
      assert.ok(askedOf.length > 0, "someone is asked to divide");
      assert.ok(askedOf.every(player => player === "p1" || player === "p3"), "only p1 and p3 are asked: " + askedOf.join(","));
    });
  }
});

describe("faction rules naming \"your opponent\" reach every opponent (D9)", () => {
  const KNITTING = "c58d0e3c-4f76-4665-aca4-2ba01a42d863";
  const UNION = "71038369-24cc-48d9-a58c-e658edc01944";
  const RAGE = resourceCard({ id: "g12-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
  const GREED = resourceCard({ id: "g12-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });
  const DECEPTION = resourceCard({ id: "g12-deception", name: "Deception", resource: { provides: ["deception"], staple: true } });
  const FILLER = character({ id: "g12-filler", name: "Filler", life: 2 });
  const PLAIN = factionCard({
    id: "g12-plain",
    name: "Plain",
    faction: {
      ...printing(KNITTING).faction!,
      setup: { startingResources: { count: 2, stapleOnly: true }, openingHand: { goingFirst: 7, goingSecond: 8 }, mulligan: { count: 1, mode: "replaceAny" } },
      overridesOpponent: undefined,
      abilities: []
    }
  });
  const deckOf = (factionId: string) => [
    factionId,
    ...Array.from({ length: 4 }, () => RAGE.id),
    ...Array.from({ length: 4 }, () => GREED.id),
    ...Array.from({ length: 2 }, () => DECEPTION.id),
    ...Array.from({ length: 20 }, () => FILLER.id)
  ];
  const resourcesInPlay = (engine: ReturnType<typeof createFactionGame>, playerId: PlayerId) =>
    engine.state.players[playerId].play.filter(cardId => engine.getDefinition(cardId).type === "resource").length;

  test("The Knitting Coalition: every opponent's STARTING DRAW is replaced and their DEVELOP RULE is ignored", () => {
    const knitting = printing(KNITTING);
    const engine = createFactionGame(
      [knitting, PLAIN, RAGE, GREED, DECEPTION, FILLER],
      [
        { id: "p1", name: "P1", deckDefinitionIds: deckOf(knitting.id) },
        { id: "p2", name: "P2", deckDefinitionIds: deckOf(PLAIN.id) },
        { id: "p3", name: "P3", deckDefinitionIds: deckOf(PLAIN.id) }
      ],
      { firstPlayerId: "p1", seed: 1 }
    );
    assert.equal(engine.state.players.p1.hand.length, 3, "Knitting's own going-first hand");
    assert.equal(engine.state.players.p2.hand.length, 4, "an opponent uses Knitting's going-second hand, not its own 8");
    assert.equal(engine.state.players.p3.hand.length, 4, "so does the other opponent");
    assert.deepEqual(engine.getDevelopChoices("p2"), []);
    assert.deepEqual(engine.getDevelopChoices("p3"), []);
  });

  test("The Knitting Coalition: any player at the table may use DRAW, each paying from their own resources", () => {
    const { engine, id } = buildGame({
      players: [
        { id: "p1", faction: printing(KNITTING) },
        { id: "p2", faction: noDevelopFaction() },
        { id: "p3", faction: noDevelopFaction() }
      ],
      activePlayerId: "p3",
      cards: [...bank("greed", 2, "p3"), ...stock("p3", "deck", 3)]
    });
    const knittingFaction = engine.state.players.p1.factionId!;
    void id;
    const before = engine.state.players.p3.hand.length;
    activate(engine, "p3", knittingFaction, "knitting-draw");
    assert.equal(engine.state.players.p3.hand.length, before + 1);
  });

  test("The Union of Unextraordinary Miners: every opponent is topped up with staples to match the Union player's starting resources", () => {
    const union = printing(UNION);
    const engine = createFactionGame(
      [union, PLAIN, RAGE, GREED, DECEPTION, FILLER],
      [
        { id: "p1", name: "P1", deckDefinitionIds: deckOf(union.id) },
        { id: "p2", name: "P2", deckDefinitionIds: deckOf(PLAIN.id) },
        { id: "p3", name: "P3", deckDefinitionIds: deckOf(PLAIN.id) }
      ],
      { firstPlayerId: "p1", seed: 1, startingResourceX: { p1: 3 } }
    );
    const mine = resourcesInPlay(engine, "p1");
    assert.equal(mine, 4, "X = 3 staples and 1 Deception");
    assert.equal(resourcesInPlay(engine, "p2"), mine);
    assert.equal(resourcesInPlay(engine, "p3"), mine);
  });
});

describe("Emergency Obfuscation - \"both players switch seats\" (MP 3: the controller and the opponent it was played against)", () => {
  const OBFUSCATION = ["9df5c987-d2c0-45d4-86ae-1d487cc7f937", "1999770c-5f2d-415d-8da1-8efe44ef3e41"];

  for (const oid of OBFUSCATION) {
    test(`${oid.slice(0, 6)}: with three players it names an opponent and swaps seats with that one player only`, () => {
      const built = buildGame({
        players: SEATS,
        cards: [
          { key: "eo", def: printing(oid), owner: "p1", zone: "hand" },
          ...bank("deception", 3),
          fighter("m1", "p1"),
          fighter("m2", "p2"),
          fighter("m3", "p3")
        ]
      });
      assert.throws(
        () => built.engine.perform({ type: "playCard", playerId: "p1", cardId: built.id("eo") } as never),
        /Choose which opponent/
      );
      built.engine.perform({ type: "playCard", playerId: "p1", cardId: built.id("eo"), opponentId: "p3" } as never);
      resolvePendingResponses(built.engine);
      assert.deepEqual(built.engine.state.seatSwap?.players, ["p1", "p3"]);
      assert.equal(built.engine.state.cards[built.id("m1")].controllerId, "p3");
      assert.equal(built.engine.state.cards[built.id("m3")].controllerId, "p1");
      assert.equal(built.engine.state.cards[built.id("m2")].controllerId, "p2", "the third player is untouched");
    });

    test(`${oid.slice(0, 6)}: with two players it swaps with the only opponent, unnamed`, () => {
      const built = buildGame({
        players: ONE_ON_ONE,
        cards: [{ key: "eo", def: printing(oid), owner: "p1", zone: "hand" }, ...bank("deception", 3), fighter("m1", "p1"), fighter("m2", "p2")]
      });
      built.engine.perform({ type: "playCard", playerId: "p1", cardId: built.id("eo") } as never);
      resolvePendingResponses(built.engine);
      assert.notEqual(built.engine.state.seatSwap, undefined);
      assert.equal(built.engine.state.cards[built.id("m1")].controllerId, "p2");
    });
  }
});
