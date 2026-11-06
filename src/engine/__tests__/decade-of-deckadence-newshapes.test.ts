// Integration tests for the Decade of Deckadence cards flagged
// `reusesProvenShape: false` — ability shapes that are new to the engine and
// need their own case (the convention `card-behaviors.test.ts` and
// `holy-heist-newshapes.test.ts` follow). Each card is loaded from the real
// catalog by printing id and driven through the engine; the expected
// behavior is the printed card text. Clause-by-clause coverage lives in
// `clauses/decade-of-deckadence-0N.test.ts`; these are the "does the new
// shape work end to end" smoke tests.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  activate,
  autoResolveBattle,
  bank,
  banks,
  buildGame,
  character,
  developFaction,
  item,
  killTactic,
  P1,
  P2,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition
} from "./per-card/_harness.js";
import { declineAll, drain, printing } from "./clauses/_clause.js";
import { answerPending, fillers, pending, zoneOf } from "./clauses/_board.js";
import { declareAttackBy, fight, finishBattle, playRaw } from "./clauses/_battle.js";
import { developPlay, endTurn } from "./clauses/_turn.js";

// --- catalog printings (Decade of Deckadence unless noted) -------------------
const ID = {
  aristocracy: "702e82d6-140f-49b9-8122-f1201dd790d7",
  avarice: "84888b76-c5fc-4824-bd6d-9f6a68a38ba8",
  blackMarketBroker: "983463ac-8bd9-4e79-8562-0a45e615748f",
  dualBladeAssassin: "ca0987a9-99ab-462e-8d61-cc898b3441dc",
  duplicity: "d0cbce25-31b1-412a-b257-77d467f053ed",
  engorgedSarcophyle: "3ad8995c-8bd2-4e07-9e64-1be39cc38f0d",
  entitlement: "464bf4f2-32a0-4f92-91b0-6488af0b2f0c",
  escapeArtist: "8a4d4fdb-4402-468b-9808-4711a2362116",
  escortAlly: "0007c001-1606-422f-b1a8-cdc4c7afbce9",
  fanaticism: "f74aeb87-5b92-4b66-b413-bafd0a13bc94",
  fieryDoomDevice: "58acea18-dc3a-441e-b76b-f95ac57137a3",
  graspOfRantzigore: "fa348715-0409-4c8e-8776-ff4e8220ec4a",
  insanity: "9e2b11d9-0be3-4309-8889-a650999b836e",
  luteorunicBehemoth: "40841abf-5c44-4a67-8597-2675a2cad9bb",
  micromajigParty: "91d503b5-cb0a-41ee-9ea1-7282d63ce6da",
  mrGreenThumb: "ed2f9dd9-d085-43df-a2d6-8de7ec4957d4",
  researchAssistant: "2293a8a9-0b10-43ef-a03b-82a54c3b1d36",
  shrieverGeneral: "2ac6e84e-f9c7-4c31-9cbb-c7572cb99858",
  siluriformesIncarnate: "c22da748-842e-4938-9cb8-0d3fe8e3306d",
  temperedRage: "79e1db0c-a18b-4a66-ad29-1fd522a41f2e",
  thabbashiteDesertCreature: "60129e7c-90d7-44cd-a802-bde674ae0887",
  unwelcomeHero: "2d1c8e0c-5c8e-4c6a-b1d6-e867c28a1334"
};

type Engine = ReturnType<typeof buildGame>["engine"];

const duo = (cards: any[], extra: Record<string, unknown> = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, cards, ...extra } as any);
const plain = (name: string, extra: Record<string, unknown> = {}) =>
  character({ name, text: "plain", strength: 1, life: 3, ...extra } as any);
const influence = (e: Engine, p: string) => (e.state.players as any)[p].influence as number;
const thresholds = (e: Engine, p: string = P1) => e.getThresholds(p as never) as Record<string, number>;
const answerTargets = (e: Engine, who: string, ids: string[]) => {
  e.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  resolvePendingResponses(e);
};
/** The cards the engine currently offers for the open chooserSelectsTarget prompt. */
const offered = (e: Engine): string[] => {
  const pc = e.state.pendingChoice as any;
  return (e as any).targetCandidates(pc.declaration.selector, pc.context, pc.playerId).map((c: { id: string }) => c.id);
};
const noPending = (e: Engine) => assert.equal(e.state.pendingChoice, undefined, "no pending choice is left");

// ---------------------------------------------------------------------------
// The six two-icon "name" resources: when a resource enters play under your
// control, name one of two icons; this turn this card gains "PROVIDES: X".
// ---------------------------------------------------------------------------
const NAMERS: Array<[string, string, string[]]> = [
  ["Aristocracy", ID.aristocracy, ["deception", "elitism"]],
  ["Avarice", ID.avarice, ["greed", "obsession"]],
  ["Duplicity", ID.duplicity, ["deception", "rage"]],
  ["Entitlement", ID.entitlement, ["elitism", "rage"]],
  ["Fanaticism", ID.fanaticism, ["greed", "rage"]],
  ["Insanity", ID.insanity, ["obsession", "rage"]]
];

for (const [name, id, opts] of NAMERS) {
  describe(name, () => {
    test("names one of its two icons when a resource enters play and gains PROVIDES of it", () => {
      const { engine, id: k } = duo([
        { key: "c", def: printing(id), owner: P1, zone: "play" },
        { key: "hr", def: resourceCard({ name: "Plain", resource: { provides: ["rage"], staple: true } } as any), owner: P1, zone: "hand" }
      ]);
      const before = thresholds(engine);
      developPlay(engine, P1, k("hr"));
      const pc = pending(engine) as any;
      assert.equal(pc?.kind, "nameValue");
      assert.deepEqual([...pc.options].sort(), [...opts].sort(), "only the two printed icons are offered");
      const bad = ["rage", "greed", "deception", "elitism", "obsession", "volition"].find((i) => !opts.includes(i))!;
      assert.throws(() => answerPending(engine, "nameValue", { value: bad }), Error, "an icon the card does not print is refused");
      answerPending(engine, "nameValue", { value: opts[0] });
      resolvePendingResponses(engine);
      noPending(engine);
      const after = thresholds(engine);
      assert.equal((after[opts[0]] ?? 0) - (before[opts[0]] ?? 0), 1, `gains PROVIDES: ${opts[0]}`);
      assert.equal(engine.state.provideGrants.length, 1);
    });

    test("its own entry and the opponent's resources do not trigger it", () => {
      const { engine, id: k } = duo([
        { key: "c", def: printing(id), owner: P1, zone: "hand" },
        { key: "oc", def: resourceCard({ name: "OppRes" } as any), owner: P2, zone: "play" }
      ]);
      developPlay(engine, P1, k("c"));
      resolvePendingResponses(engine);
      noPending(engine);
      assert.equal(engine.state.provideGrants.length, 0);
    });
  });
}

// ---------------------------------------------------------------------------
describe("Black Market Broker", () => {
  test("every resource you control gains PROVIDES [D], only yours, and only while it is in play", () => {
    const { engine, id } = duo([
      { key: "br", def: printing(ID.blackMarketBroker), owner: P1, zone: "play" },
      { key: "k", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("rage", 2, P1),
      ...bank("deception", 1, P1),
      ...bank("greed", 1, P2)
    ]);
    assert.equal(thresholds(engine).deception, 3, "all three of my resources provide [D]");
    assert.equal(thresholds(engine).rage, 2, "they keep what they already provided");
    assert.equal(thresholds(engine, P2).deception ?? 0, 0, "the opponent's resources are untouched");
    play(engine, P1, id("k"), { selected: { t: [id("br")] } });
    drain(engine, declineAll);
    noPending(engine);
    assert.equal(zoneOf(engine, id("br")), "discard");
    assert.equal(thresholds(engine).deception, 1, "only the resource that printed [D] keeps it");
  });
});

// ---------------------------------------------------------------------------
describe("Dual Blade Assassin", () => {
  const board = () =>
    duo([
      { key: "dba", def: printing(ID.dualBladeAssassin), owner: P1, zone: "hand" },
      { key: "atk", def: plain("Atk", { strength: 2 }), owner: P1, zone: "play" },
      ...bank("rage", 2, P1)
    ]);

  test("cannot be deployed before damaging the opponent's faction this turn", () => {
    const b = board();
    assert.throws(() => play(b.engine, P1, b.id("dba")));
    assert.equal(zoneOf(b.engine, b.id("dba")), "hand");
  });

  test("can be deployed after an attack inflicted damage to the opponent's faction", () => {
    const b = board();
    fight(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, []);
    drain(b.engine, declineAll);
    noPending(b.engine);
    play(b.engine, P1, b.id("dba"));
    assert.equal(zoneOf(b.engine, b.id("dba")), "play");
  });
});

// ---------------------------------------------------------------------------
describe("Engorged Sarcophyle", () => {
  test("when destroyed, the opponent destroys a character of their own choosing", () => {
    const { engine, id } = duo([
      { key: "eng", def: printing(ID.engorgedSarcophyle), owner: P1, zone: "play" },
      { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
      { key: "t1", def: plain("T1"), owner: P2, zone: "play" },
      { key: "t2", def: plain("T2"), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]);
    play(engine, P1, id("kill"), { selected: { t: [id("eng")] } });
    // The pick of the opponent is automatic (2 players); the opponent then chooses which of their characters dies.
    let steps = 0;
    while (engine.state.pendingChoice && steps++ < 10) {
      const pc = pending(engine)! as any;
      if (pc.kind === "chooserSelectsTarget") {
        assert.equal(pc.playerId, P2, "the opponent chooses their own victim");
        answerTargets(engine, P2, [id("t2")]);
      } else if (pc.kind === "selectTargets") {
        engine.perform({
          type: "resolvePendingChoice",
          playerId: pc.playerId,
          choice: { kind: "selectTargets", selected: { opp: [engine.state.players[P2].factionId] } }
        } as never);
        resolvePendingResponses(engine);
      } else drain(engine, declineAll);
    }
    noPending(engine);
    assert.equal(zoneOf(engine, id("eng")), "discard");
    assert.equal(zoneOf(engine, id("t2")), "discard", "the chosen character is destroyed");
    assert.equal(zoneOf(engine, id("t1")), "play");
    assert.equal(zoneOf(engine, id("mine")), "play", "my own characters are not affected");
  });

  test("an opponent with no characters destroys nothing", () => {
    const { engine, id } = duo([
      { key: "eng", def: printing(ID.engorgedSarcophyle), owner: P1, zone: "play" },
      { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]);
    play(engine, P1, id("kill"), { selected: { t: [id("eng")] } });
    drain(engine, declineAll);
    noPending(engine);
    assert.equal(zoneOf(engine, id("eng")), "discard");
    assert.equal(zoneOf(engine, id("mine")), "play");
  });
});

// ---------------------------------------------------------------------------
describe("Escape Artist", () => {
  // Opponent's tactic picks a character as part of its extra cost (a target
  // declaration); Escape Artist, deployed in response, terminates it iff the
  // picked character is one I control.
  const picker = () =>
    tactic({
      name: "Picker",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "p",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    } as any);

  for (const pickOwn of [true, false]) {
    test(`a tactic that picked ${pickOwn ? "my" : "their own"} character is ${pickOwn ? "terminated" : "left alone"}`, () => {
      const b = duo(
        [
          { key: "esc", def: printing(ID.escapeArtist), owner: P1, zone: "hand" },
          { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
          { key: "theirs", def: plain("Theirs"), owner: P2, zone: "play" },
          { key: "pick", def: picker(), owner: P2, zone: "hand" },
          ...bank("deception", 5, P1)
        ],
        { activePlayerId: P2 }
      );
      const e = b.engine;
      const target = pickOwn ? b.id("mine") : b.id("theirs");
      playRaw(e, P2, b.id("pick"), { selected: { t: [target] } });
      playRaw(e, P1, b.id("esc"));
      resolvePendingResponses(e);
      drain(e, declineAll);
      noPending(e);
      assert.equal(zoneOf(e, b.id("esc")), "play");
      assert.equal(zoneOf(e, b.id("pick")), "discard");
      assert.equal(zoneOf(e, target), pickOwn ? "play" : "hand", pickOwn ? "the terminated tactic did nothing" : "the tactic resolved");
    });
  }

  test("an ability that picked my character is terminated; one that picked theirs is not; no response needed otherwise", () => {
    const poker = character({
      name: "Poker",
      text: "x",
      strength: 1,
      life: 3,
      behavior: {
        abilities: [
          {
            id: "poke",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
          }
        ]
      }
    } as any);
    const mk = () =>
      duo(
        [
          { key: "esc", def: printing(ID.escapeArtist), owner: P1, zone: "hand" },
          { key: "mine", def: plain("Mine"), owner: P1, zone: "play" },
          { key: "theirs", def: plain("Theirs"), owner: P2, zone: "play" },
          { key: "poker", def: poker, owner: P2, zone: "play" },
          ...bank("deception", 5, P1)
        ],
        { activePlayerId: P2 }
      );
    for (const pickOwn of [true, false]) {
      const b = mk();
      const e = b.engine;
      const target = pickOwn ? b.id("mine") : b.id("theirs");
      e.perform({ type: "activateAbility", playerId: P2, cardId: b.id("poker"), abilityId: "poke", selected: { t: [target] }, variables: {} } as never);
      playRaw(e, P1, b.id("esc"));
      resolvePendingResponses(e);
      drain(e, declineAll);
      noPending(e);
      assert.equal(zoneOf(e, b.id("esc")), "play");
      assert.equal(zoneOf(e, target), pickOwn ? "play" : "hand");
    }
    // Deployed on my own turn with nothing to respond to: it simply enters play.
    const b3 = duo([{ key: "esc", def: printing(ID.escapeArtist), owner: P1, zone: "hand" }, ...bank("deception", 5, P1)]);
    play(b3.engine, P1, b3.id("esc"));
    drain(b3.engine, declineAll);
    noPending(b3.engine);
    assert.equal(zoneOf(b3.engine, b3.id("esc")), "play");
  });
});

// ---------------------------------------------------------------------------
describe("Escort Ally", () => {
  const ABILITY = "escort-ally-substitute";
  const passTo = (e: Engine, p: string) => {
    for (let i = 0; i < 6 && (e.state.responseWindow as any)?.priorityPlayerId !== p; i++) {
      e.perform({ type: "passPriority", playerId: (e.state.responseWindow as any).priorityPlayerId } as never);
    }
    assert.equal((e.state.responseWindow as any)?.priorityPlayerId, p);
  };
  const setup = () =>
    duo(
      [
        { key: "esc", def: printing(ID.escortAlly), owner: P1, zone: "play" },
        { key: "victim", def: plain("Victim", { life: 2 }), owner: P1, zone: "play" },
        { key: "foe", def: plain("Foe", { strength: 5, life: 9 }), owner: P2, zone: "play" },
        { key: "foe2", def: plain("Foe2"), owner: P2, zone: "play" },
        { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
      ],
      { activePlayerId: P2 }
    );

  test("the opponent's destroy tactic cannot destroy my character; Escort Ally itself is the cost", () => {
    const b = setup();
    const e = b.engine;
    e.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("victim")] } } as never);
    passTo(e, P1);
    e.perform({ type: "activateAbility", playerId: P1, cardId: b.id("esc"), abilityId: ABILITY, selected: {} } as never);
    assert.equal(zoneOf(e, b.id("esc")), "discard", "destroyed as the cost");
    resolvePendingResponses(e);
    noPending(e);
    assert.equal(zoneOf(e, b.id("victim")), "play");
    assert.equal(zoneOf(e, b.id("kill")), "discard", "the tactic still resolved, it just failed to destroy");
  });

  test("control: without Escort Ally's effect the tactic destroys", () => {
    const b = setup();
    const e = b.engine;
    e.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("victim")] } } as never);
    resolvePendingResponses(e);
    assert.equal(zoneOf(e, b.id("victim")), "discard");
  });

  test("only my characters are protected: the opponent can still destroy their own", () => {
    const b = setup();
    const e = b.engine;
    e.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("foe2")] } } as never);
    passTo(e, P1);
    e.perform({ type: "activateAbility", playerId: P1, cardId: b.id("esc"), abilityId: ABILITY, selected: {} } as never);
    resolvePendingResponses(e);
    assert.equal(zoneOf(e, b.id("foe2")), "discard");
  });

  test("lethal battle damage from an opposing character does not destroy my blocker", () => {
    const b = setup();
    const e = b.engine;
    e.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("foe")], target: { type: "faction", playerId: P1 } } as never);
    passTo(e, P1);
    e.perform({ type: "activateAbility", playerId: P1, cardId: b.id("esc"), abilityId: ABILITY, selected: {} } as never);
    resolvePendingResponses(e);
    e.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("victim")] } as never);
    autoResolveBattle(e);
    assert.equal(e.state.battle, undefined);
    assert.equal(zoneOf(e, b.id("victim")), "play");
  });

  test("control: an unprotected blocker dies to lethal battle damage", () => {
    const b = setup();
    const e = b.engine;
    e.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("foe")], target: { type: "faction", playerId: P1 } } as never);
    resolvePendingResponses(e);
    e.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("victim")] } as never);
    autoResolveBattle(e);
    assert.equal(zoneOf(e, b.id("victim")), "discard");
  });
});

// ---------------------------------------------------------------------------
describe("Fiery Doom Device", () => {
  const FACTION = (p: string) => ({ type: "faction", playerId: p }) as const;
  const chr = (name: string, over: Record<string, unknown> = {}) =>
    character({ name, strength: 2, life: 5, speed: 2, cost: 0, ...over } as any);

  test("attached character gains 3 strength, zaps a picked character for 2 on each attack, restores once per turn", () => {
    const { engine, id } = duo(
      [
        { key: "fd", def: printing(ID.fieryDoomDevice), owner: P1, zone: "play", attachedToKey: "host" },
        { key: "host", def: chr("Host"), owner: P1, zone: "play" },
        { key: "victim", def: chr("Victim", { life: 6 }), owner: P2, zone: "play" }
      ],
      { turn: 2, activePlayerId: P1 }
    );
    const answer = (pc: any): unknown => {
      if (pc.kind === "selectTargets") return { kind: "selectTargets", selected: { [pc.declarations[0].id]: [id("victim")] } };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [id("victim")] };
      return declineAll(pc);
    };
    assert.equal(engine.getStat(id("host") as never, "strength" as never), 5, "2 + 3 strength");

    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("host")], target: FACTION(P2) } as never);
    drain(engine, answer);
    resolvePendingResponses(engine);
    drain(engine, answer);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
    finishBattle(engine, undefined, answer);
    noPending(engine);
    assert.equal(engine.state.cards[id("victim")].damage, 2, "2 damage to the picked character");
    assert.equal(engine.state.cards[id("host")].depleted, false, "restored at end of battle");

    // Second attack the same turn: the zap happens again but the restore is once per turn.
    engine.state.cards[id("host")].depleted = false;
    declareAttackBy(engine, P1, [id("host")], FACTION(P2) as never);
    drain(engine, answer);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
    finishBattle(engine, undefined, answer);
    noPending(engine);
    assert.equal(engine.state.cards[id("victim")].damage, 4, "zapped again");
    assert.equal(engine.state.cards[id("host")].depleted, true, "not restored a second time this turn");

    // A new turn clears the once-per-turn marker.
    endTurn(engine, P1);
    assert.ok(!(engine.state.cards[id("fd")].counters as any)?.onceThisTurn, "marker is cleared at turn end");
  });
});

// ---------------------------------------------------------------------------
describe("Grasp of Rantzigore", () => {
  const zap = (n: number) =>
    tactic({
      name: "Zap" + n,
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "z",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
          }
        ]
      }
    } as any);
  const board = (life: number, oppHand = 2) =>
    duo([
      { key: "gr", def: printing(ID.graspOfRantzigore), owner: P1, zone: "hand" },
      ...bank("obsession", 2, P1),
      { key: "foe", def: character({ name: "Foe", life } as any), owner: P2, zone: "play" },
      ...fillers("h", oppHand, P2, "hand"),
      { key: "k1", def: zap(1), owner: P1, zone: "hand" },
      { key: "k2", def: zap(2), owner: P1, zone: "hand" }
    ]);

  test("the picked character loses 2 life this turn and, if it would be destroyed, its controller discards a card", () => {
    const b = board(4);
    play(b.engine, P1, b.id("gr"), { selected: { c: [b.id("foe")] } });
    assert.equal(b.engine.getStat(b.id("foe") as never, "life" as never), 2, "4 life - 2");
    play(b.engine, P1, b.id("k1"), { selected: { t: [b.id("foe")] } });
    assert.equal(zoneOf(b.engine, b.id("foe")), "play", "1 damage of 2 life: still alive");
    play(b.engine, P1, b.id("k2"), { selected: { t: [b.id("foe")] } });
    // The destruction is replaced by a discard first: the controller picks the card.
    const pc = pending(b.engine) as any;
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P2, "the character's controller discards");
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("h0")] });
    noPending(b.engine);
    assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "destroyed after the discard");
    assert.equal(zoneOf(b.engine, b.id("h0")), "discard");
    assert.equal(b.engine.state.players[P2].hand.length, 1, "exactly one card was discarded");
  });

  test("a controller with an empty hand is destroyed with nothing to discard", () => {
    const b = board(3, 0);
    play(b.engine, P1, b.id("gr"), { selected: { c: [b.id("foe")] } });
    play(b.engine, P1, b.id("k1"), { selected: { t: [b.id("foe")] } });
    drain(b.engine, declineAll);
    noPending(b.engine);
    assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  });
});

// ---------------------------------------------------------------------------
describe("Luteorunic Behemoth", () => {
  test("when deployed, the opponent picks and destroys 4 non-staple cards they control", () => {
    const b = duo([
      { key: "b", def: printing(ID.luteorunicBehemoth), owner: P1, zone: "hand" },
      ...bank("elitism", 10, P1),
      ...fillers("oc", 5, P2, "play"),
      ...bank("greed", 2, P2),
      { key: "ores", def: resourceCard({ name: "Weird", resource: { provides: ["rage"], staple: false } } as any), owner: P2, zone: "play" }
    ]);
    play(b.engine, P1, b.id("b"));
    const pc = pending(b.engine) as any;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P2, "the opponent chooses");
    assert.deepEqual(
      offered(b.engine).sort(),
      ["oc0", "oc1", "oc2", "oc3", "oc4", "ores"].map((k) => b.id(k)).sort(),
      "only non-staple cards the opponent controls are offered; staple resources are not"
    );
    answerTargets(b.engine, P2, [b.id("oc0"), b.id("oc1"), b.id("oc2"), b.id("ores")]);
    noPending(b.engine);
    for (const k of ["oc0", "oc1", "oc2", "ores"]) assert.equal(zoneOf(b.engine, b.id(k)), "discard", `${k} destroyed`);
    assert.equal(zoneOf(b.engine, b.id("oc3")), "play", "only four are destroyed");
    assert.equal(zoneOf(b.engine, b.id("b")), "play");
    const staples = Object.values(b.engine.state.cards).filter(
      (c: any) => c.ownerId === P2 && c.zone === "play" && b.engine.getDefinition(c.id).type === "resource"
    );
    assert.equal(staples.length, 2, "staple resources were never at risk");
  });

  test("with fewer than 4 candidates they destroy all of them", () => {
    const b = duo([
      { key: "b", def: printing(ID.luteorunicBehemoth), owner: P1, zone: "hand" },
      ...bank("elitism", 10, P1),
      ...fillers("oc", 2, P2, "play")
    ]);
    play(b.engine, P1, b.id("b"));
    if (pending(b.engine)) answerTargets(b.engine, P2, [b.id("oc0"), b.id("oc1")]);
    noPending(b.engine);
    assert.equal(zoneOf(b.engine, b.id("oc0")), "discard");
    assert.equal(zoneOf(b.engine, b.id("oc1")), "discard");
  });

  test("being put into play by an effect (not deployed) does not trigger it", () => {
    const put = tactic({
      name: "Put",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "x",
            type: "activated",
            targets: [{ id: "c", selector: { owner: "self", zone: "hand", type: "character" }, count: 1 }],
            effects: [{ type: "putIntoPlay", target: { type: "selected", id: "c" }, controller: "controller" }]
          }
        ]
      }
    } as any);
    const b = duo([
      { key: "b", def: printing(ID.luteorunicBehemoth), owner: P1, zone: "hand" },
      { key: "p", def: put, owner: P1, zone: "hand" },
      ...fillers("oc", 5, P2, "play")
    ]);
    play(b.engine, P1, b.id("p"), { selected: { c: [b.id("b")] } });
    noPending(b.engine);
    assert.equal(zoneOf(b.engine, b.id("b")), "play");
    assert.equal(zoneOf(b.engine, b.id("oc0")), "play");
  });

  test("TRY AGAIN TOMORROW NIGHT: pay 2 and destroy a resource to put it into its owner's hand", () => {
    const b = duo([{ key: "b", def: printing(ID.luteorunicBehemoth), owner: P1, zone: "play" }, ...bank("rage", 3, P1)]);
    const res = Object.values(b.engine.state.cards).find((c: any) => c.zone === "play" && b.engine.getDefinition(c.id).type === "resource") as any;
    activate(b.engine, P1, b.id("b"), "try-again", { selected: { r: [res.id] } });
    noPending(b.engine);
    assert.equal(zoneOf(b.engine, b.id("b")), "hand");
    assert.equal(zoneOf(b.engine, res.id), "discard", "the resource was destroyed");
  });

  test("TRY AGAIN TOMORROW NIGHT is refused when the cost cannot be paid (pay 2 and destroy needs 3 resources)", () => {
    const b = duo([{ key: "b", def: printing(ID.luteorunicBehemoth), owner: P1, zone: "play" }, ...bank("rage", 2, P1)]);
    const res = Object.values(b.engine.state.cards).find((c: any) => c.zone === "play" && b.engine.getDefinition(c.id).type === "resource") as any;
    assert.throws(() => activate(b.engine, P1, b.id("b"), "try-again", { selected: { r: [res.id] } }));
    assert.equal(zoneOf(b.engine, b.id("b")), "play");
  });
});

// ---------------------------------------------------------------------------
describe("Micromajig Party", () => {
  const token = (i: number, depleted: boolean) => ({
    key: "t" + i,
    def: character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 } as any),
    owner: P1,
    zone: "play",
    isToken: true,
    depleted
  });
  const board = (n: number, depletedCount = 0, extra: any[] = []) => {
    const g = duo([
      { key: "mp", def: printing(ID.micromajigParty), owner: P1, zone: "hand" },
      ...bank("elitism", 2, P1),
      ...Array.from({ length: n }, (_, i) => token(i, i < depletedCount)),
      ...extra
    ]);
    for (let i = 0; i < n; i++) g.engine.state.cards[g.id("t" + i)].isToken = true;
    return g;
  };
  const tokens = (b: ReturnType<typeof board>) =>
    Object.values(b.engine.state.cards).filter(
      (c: any) => c.zone === "play" && c.controllerId === P1 && b.engine.getDefinition(c.id).name === "Micromajig" && c.isToken
    ) as any[];

  test("without depleting tokens: makes a Micromajig token and goes to the discard pile", () => {
    const b = board(3);
    play(b.engine, P1, b.id("mp"), { selected: { tok: [] } });
    noPending(b.engine);
    assert.equal(tokens(b).length, 4);
    assert.equal(zoneOf(b.engine, b.id("mp")), "discard");
    assert.equal(tokens(b).filter((t) => t.depleted).length, 0);
  });

  test("depleting 3 tokens as part of the cost returns it to its owner's hand instead", () => {
    const b = board(3);
    play(b.engine, P1, b.id("mp"), { selected: { tok: [b.id("t0"), b.id("t1"), b.id("t2")] } });
    noPending(b.engine);
    assert.equal(tokens(b).length, 4);
    assert.equal(tokens(b).filter((t) => t.depleted).length, 3);
    assert.equal(zoneOf(b.engine, b.id("mp")), "hand");
  });

  test("the optional cost is all-or-nothing and only accepts untapped Micromajig tokens", () => {
    // an already-depleted token cannot be picked
    let b = board(3, 1);
    assert.throws(() => play(b.engine, P1, b.id("mp"), { selected: { tok: [b.id("t0"), b.id("t1"), b.id("t2")] } }));
    // a card named Micromajig that is not a token cannot be picked
    b = board(2, 0, [{ key: "real", def: character({ name: "Micromajig", subtype: ["majig"] } as any), owner: P1, zone: "play" }]);
    assert.throws(() => play(b.engine, P1, b.id("mp"), { selected: { tok: [b.id("t0"), b.id("t1"), b.id("real")] } }));
    // 1 or 2 of 3 is refused and nothing is paid
    for (const n of [1, 2]) {
      b = board(3);
      assert.throws(() => play(b.engine, P1, b.id("mp"), { selected: { tok: ["t0", "t1"].slice(0, n).map((k) => b.id(k)) } }));
      assert.equal(zoneOf(b.engine, b.id("mp")), "hand");
      assert.equal(tokens(b).filter((t) => t.depleted).length, 0);
    }
    const req: any = (b.engine as any)
      .getPlayRequirements({ type: "playCard", playerId: P1, cardId: b.id("mp") })
      .find((r: any) => r.kind === "pick");
    assert.deepEqual([req.min, req.max, req.orNone], [3, 3, true]);
  });
});

// ---------------------------------------------------------------------------
describe("Mr. Green Thumb", () => {
  const res = (i: number) => resourceCard({ name: "R" + i, resource: { provides: ["rage"] } } as any);
  // Deck, top first: r0, z0, r1, r2, c0..c5. The top 4 are r0, z0, r1, r2.
  const board = () =>
    duo([
      { key: "t", def: printing(ID.mrGreenThumb), owner: P1, zone: "hand" },
      ...bank("greed", 2, P1),
      { key: "r0", def: res(0), owner: P1, zone: "deck" },
      ...fillers("z", 1, P1, "deck"),
      { key: "r1", def: res(1), owner: P1, zone: "deck" },
      { key: "r2", def: res(2), owner: P1, zone: "deck" },
      ...fillers("c", 6, P1, "deck")
    ]);

  test("reveals the top 4, puts up to two revealed resources into hand and the rest into the discard pile", () => {
    const b = board();
    const e = b.engine;
    assert.deepEqual(e.state.players[P1].deck.slice(0, 4), ["r0", "z0", "r1", "r2"].map((k) => b.id(k)), "deck order is as arranged");
    play(e, P1, b.id("t"));
    const pc = pending(e) as any;
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.deepEqual(offered(e).sort(), ["r0", "r1", "r2"].map((k) => b.id(k)).sort(), "only the revealed resources are offered");
    assert.throws(() => answerTargets(e, P1, [b.id("z0"), b.id("r0")]), Error, "a non-resource is refused");
    answerTargets(e, P1, [b.id("r0"), b.id("r1")]);
    noPending(e);
    const p = e.state.players[P1];
    assert.ok(p.hand.includes(b.id("r0")) && p.hand.includes(b.id("r1")), "both picked resources are in hand");
    assert.equal(zoneOf(e, b.id("r2")), "discard", "the unpicked revealed resource is discarded");
    assert.equal(zoneOf(e, b.id("z0")), "discard", "the unpicked revealed non-resource is discarded");
    assert.equal(p.deck.length, 6, "only the four revealed cards left the deck");
    assert.equal(p.deck[0], b.id("c0"), "the rest of the deck is untouched");
  });

  test("taking one resource, or none, discards the other revealed cards", () => {
    for (const [picked, hands] of [[["r2"], 1], [[], 0]] as Array<[string[], number]>) {
      const b = board();
      const e = b.engine;
      play(e, P1, b.id("t"));
      answerTargets(e, P1, picked.map((k) => b.id(k)));
      noPending(e);
      const p = e.state.players[P1];
      assert.equal(p.hand.filter((c) => ["r0", "r1", "r2"].map((k) => b.id(k)).includes(c)).length, hands);
      for (const k of ["r0", "z0", "r1", "r2"]) {
        assert.equal(zoneOf(e, b.id(k)), picked.includes(k) ? "hand" : "discard", `${k}`);
      }
      assert.equal(p.deck.length, 6);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Research Assistant", () => {
  const board = () =>
    duo([
      { key: "ra", def: printing(ID.researchAssistant), owner: P1, zone: "play" },
      { key: "big", def: plain("Big", { cost: 3 }), owner: P1, zone: "hand" },
      { key: "big2", def: plain("Big2", { cost: 3 }), owner: P1, zone: "hand" },
      ...banks(1, P1)
    ]);

  test("RESEARCH depletes it and reduces the next numeric cost this turn by 1", () => {
    const b = board();
    activate(b.engine, P1, b.id("ra"), "research");
    noPending(b.engine);
    assert.equal(b.engine.state.cards[b.id("ra")].depleted, true, "cost: deplete this card");
    play(b.engine, P1, b.id("big"));
    assert.equal(b.engine.getAvailableResourceCount(P1), 3, "paid 2 of 5 instead of 3");
  });

  test("only the next numeric cost is reduced", () => {
    const b = board();
    activate(b.engine, P1, b.id("ra"), "research");
    play(b.engine, P1, b.id("big"));
    play(b.engine, P1, b.id("big2"));
    assert.equal(b.engine.getAvailableResourceCount(P1), 0, "paid 2 then the full 3");
  });
});

// ---------------------------------------------------------------------------
describe("Shriever General", () => {
  // A lever item that costs the opponent / me influence so the "an opponent's
  // faction lost influence this turn" condition can be driven.
  const lever = () =>
    item({
      name: "Lever",
      text: "",
      behavior: {
        abilities: [
          { id: "drain-opp", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -1 }] },
          { id: "boost-opp", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: 2 }] },
          { id: "drain-me", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }
        ]
      }
    } as any);
  const board = () =>
    duo([
      { key: "sg", def: printing(ID.shrieverGeneral), owner: P1, zone: "hand" },
      { key: "lever", def: lever(), owner: P1, zone: "play" },
      { key: "foe", def: plain("Foe", { life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: plain("Foe2", { life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: plain("Mine", { life: 5 }), owner: P1, zone: "play" },
      ...bank("rage", 6, P1)
    ]);
  const pickFoe = (b: ReturnType<typeof board>, pay: boolean) => (pc: any): unknown =>
    pc.kind === "mayPay"
      ? { kind: "mayPay", pay }
      : pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [b.id("foe")] }
        : declineAll(pc);

  test("without an opposing influence loss this turn nothing is offered", () => {
    const b = board();
    play(b.engine, P1, b.id("sg"));
    noPending(b.engine);
    assert.equal(zoneOf(b.engine, b.id("sg")), "play");
    assert.equal(influence(b.engine, P2), 30);
  });

  test("after the opponent's faction lost influence: 2 damage to the faction and 2 to a picked character", () => {
    const b = board();
    activate(b.engine, P1, b.id("lever"), "drain-opp");
    drain(b.engine, declineAll);
    assert.equal(influence(b.engine, P2), 29);
    play(b.engine, P1, b.id("sg"));
    drain(b.engine, pickFoe(b, true));
    noPending(b.engine);
    assert.equal(influence(b.engine, P2), 27, "2 damage to the faction");
    assert.equal(b.engine.state.cards[b.id("foe")].damage, 2, "2 damage to the picked character");
    assert.equal(b.engine.state.cards[b.id("foe2")].damage, 0);
    assert.equal(b.engine.state.cards[b.id("mine")].damage, 0);
  });

  test("the effect is optional", () => {
    const b = board();
    activate(b.engine, P1, b.id("lever"), "drain-opp");
    drain(b.engine, declineAll);
    play(b.engine, P1, b.id("sg"));
    drain(b.engine, pickFoe(b, false));
    noPending(b.engine);
    assert.equal(influence(b.engine, P2), 29);
    assert.equal(b.engine.state.cards[b.id("foe")].damage, 0);
  });

  test("an influence gain, or a loss of my own faction, does not enable it", () => {
    const b = board();
    activate(b.engine, P1, b.id("lever"), "boost-opp");
    drain(b.engine, declineAll);
    activate(b.engine, P1, b.id("lever"), "drain-me");
    drain(b.engine, declineAll);
    play(b.engine, P1, b.id("sg"));
    noPending(b.engine);
    assert.equal(influence(b.engine, P2), 32);
  });
});

// ---------------------------------------------------------------------------
describe("Siluriformes Incarnate", () => {
  const board = (greed: number) =>
    duo([
      { key: "sl", def: printing(ID.siluriformesIncarnate), owner: P1, zone: "play" },
      { key: "kt", def: killTactic(), owner: P1, zone: "hand" },
      { key: "foe", def: plain("Foe"), owner: P2, zone: "play" },
      ...bank("greed", greed, P1)
    ]);

  test("INCARNATE (pay 1, needs [G][G][G][G]) makes it unpickable by tactics and abilities this turn", () => {
    const x = board(5);
    activate(x.engine, P1, x.id("sl"), "incarnate");
    drain(x.engine, declineAll);
    noPending(x.engine);
    assert.equal(x.engine.getAvailableResourceCount(P1), 4, "paid 1");
    assert.throws(() => play(x.engine, P1, x.id("kt"), { selected: { t: [x.id("sl")] } }), Error, "cannot be picked");
    play(x.engine, P1, x.id("kt"), { selected: { t: [x.id("foe")] } });
    assert.equal(zoneOf(x.engine, x.id("foe")), "discard", "other characters can still be picked");
  });

  test("control: without INCARNATE it can be picked; and INCARNATE needs the [G][G][G][G] threshold", () => {
    const y = board(5);
    play(y.engine, P1, y.id("kt"), { selected: { t: [y.id("sl")] } });
    assert.equal(zoneOf(y.engine, y.id("sl")), "discard");
    const z = board(3);
    assert.throws(() => activate(z.engine, P1, z.id("sl"), "incarnate"), Error, "threshold [G][G][G][G] required");
  });

  test("when it enters play, your influence is set to your faction's starting influence", () => {
    for (const start of [10, 40]) {
      const x = duo([{ key: "sl", def: printing(ID.siluriformesIncarnate), owner: P1, zone: "hand" }, ...bank("greed", 7, P1)]);
      x.engine.state.players[P1].influence = start;
      const expected = x.engine.getDefinition(x.engine.state.players[P1].factionId!).faction!.startingInfluence;
      play(x.engine, P1, x.id("sl"));
      drain(x.engine, declineAll);
      noPending(x.engine);
      assert.equal(zoneOf(x.engine, x.id("sl")), "play");
      assert.equal(influence(x.engine, P1), expected, `influence ${start} is set to the faction's starting influence`);
      assert.equal(influence(x.engine, P2), expected, "the opponent is untouched");
    }
  });
});

// ---------------------------------------------------------------------------
describe("Tempered Rage", () => {
  const facedown = (extra: any[] = [], down = true) =>
    duo([{ key: "t", def: printing(ID.temperedRage), owner: P1, zone: "play", faceDown: down }, ...extra]);

  test("FIRE UP: pay 2 and reveal it to put it into play face-up", () => {
    const g = facedown(bank("rage", 3));
    activate(g.engine, P1, g.id("t"), "fire-up");
    noPending(g.engine);
    assert.equal(g.engine.state.cards[g.id("t")].faceDown, false);
  });

  test("FIRE UP is refused when short of resources (it cannot pay with itself) or when already face-up", () => {
    const h = facedown();
    assert.throws(() => activate(h.engine, P1, h.id("t"), "fire-up"));
    assert.equal(h.engine.state.cards[h.id("t")].faceDown, true);
    const f = facedown(bank("rage", 3), false);
    assert.throws(() => activate(f.engine, P1, f.id("t"), "fire-up"));
  });

  test("each faction loses X influence, X = characters destroyed this turn (including before it was flipped; items do not count)", () => {
    const killer = character({
      name: "Killer",
      behavior: {
        abilities: [
          {
            id: "kill",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    } as any);
    const mk = (n: number) => {
      const g = duo([
        { key: "t", def: printing(ID.temperedRage), owner: P1, zone: "play", faceDown: true },
        { key: "k", def: killer, owner: P1, zone: "play" },
        { key: "a", def: character({ name: "A" } as any), owner: P1, zone: "play" },
        { key: "b", def: character({ name: "B" } as any), owner: P2, zone: "play" },
        { key: "c", def: character({ name: "C" } as any), owner: P2, zone: "play" },
        { key: "it", def: item({ name: "Gizmo" } as any), owner: P2, zone: "play" },
        ...bank("rage", 3)
      ]);
      for (const k of ["a", "b", "c"].slice(0, n)) activate(g.engine, P1, g.id("k"), "kill", { selected: { t: [g.id(k)] } });
      return g;
    };
    for (const n of [0, 1, 3]) {
      const g = mk(n);
      const i1 = influence(g.engine, P1);
      const i2 = influence(g.engine, P2);
      activate(g.engine, P1, g.id("t"), "fire-up");
      noPending(g.engine);
      assert.equal(g.engine.state.cards[g.id("t")].faceDown, false);
      assert.equal(influence(g.engine, P1), i1 - n, `P1 loses ${n}`);
      assert.equal(influence(g.engine, P2), i2 - n, `P2 loses ${n}`);
    }
    const g = mk(0);
    activate(g.engine, P1, g.id("k"), "kill", { selected: { t: [g.id("it")] } });
    const i1 = influence(g.engine, P1);
    activate(g.engine, P1, g.id("t"), "fire-up");
    assert.equal(influence(g.engine, P1), i1, "a destroyed item does not count");
  });
});

// ---------------------------------------------------------------------------
describe("Thabbashite Desert Creature", () => {
  const vchar = () => character({ name: "VProvider", cost: 0, resource: { provides: ["volition"] } } as any);
  for (const [label, reveal, pay] of [
    ["reveal and pay 2 to deploy it", true, true],
    ["reveal, decline to pay: it stays in hand", true, false],
    ["decline to reveal: it stays in hand", false, false]
  ] as const) {
    test(label, () => {
      const { engine, id } = duo([
        { key: "td", def: printing(ID.thabbashiteDesertCreature), owner: P1, zone: "hand" },
        { key: "v", def: vchar(), owner: P1, zone: "hand" },
        ...bank("obsession", 3, P1)
      ]);
      play(engine, P1, id("v"));
      let mayPays = 0;
      drain(engine, (pc: any) => {
        if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: pc.triggers[0] };
        if (pc.kind === "mayPay") return { kind: "mayPay", pay: mayPays++ === 0 ? reveal : pay };
        if (pc.kind === "deployForFree") return { kind: "deployForFree", cardId: pc.candidates[0] };
        return declineAll(pc);
      });
      noPending(engine);
      assert.equal(zoneOf(engine, id("td")), pay ? "play" : "hand");
      if (pay) assert.equal(engine.getAvailableResourceCount(P1), 1, "paid 2 of 3");
      else assert.equal(engine.getAvailableResourceCount(P1), 3, "nothing paid");
    });
  }
});

// ---------------------------------------------------------------------------
describe("Unwelcome Hero", () => {
  const etb = (name: string) =>
    character({
      name,
      cost: 0,
      life: 4,
      behavior: {
        abilities: [
          {
            id: "etb",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "sourceIsEventCard" },
            effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
          }
        ]
      }
    } as any);
  const watcher = () =>
    character({
      name: "Watcher",
      cost: 0,
      life: 4,
      behavior: {
        abilities: [
          {
            id: "see",
            type: "triggered",
            event: "cardEnteredPlay",
            condition: { type: "not", condition: { type: "sourceIsEventCard" } },
            effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
          }
        ]
      }
    } as any);

  test("can be deployed with its printed cost (5, with [V])", () => {
    const b = duo([{ key: "c", def: printing(ID.unwelcomeHero), owner: P1, zone: "hand" }, ...volition(1, P1), ...banks(2, P1)]);
    play(b.engine, P1, b.id("c"));
    noPending(b.engine);
    assert.equal(zoneOf(b.engine, b.id("c")), "play");
  });

  test("control: a card's own 'when this card enters play' trigger fires without the Hero in play", () => {
    const b = duo([{ key: "e", def: etb("Etb"), owner: P1, zone: "hand" }]);
    const start = influence(b.engine, P1);
    play(b.engine, P1, b.id("e"));
    drain(b.engine, declineAll);
    noPending(b.engine);
    assert.equal(zoneOf(b.engine, b.id("e")), "play");
    assert.equal(influence(b.engine, P1), start - 1);
  });

  test("while it is in play (even the opponent's), a card's own enters-play trigger is ignored; other triggers still fire", () => {
    const b = duo([
      { key: "hero", def: printing(ID.unwelcomeHero), owner: P2, zone: "play" },
      { key: "e", def: etb("Etb"), owner: P1, zone: "hand" },
      { key: "w", def: watcher(), owner: P1, zone: "play" }
    ]);
    const start = influence(b.engine, P1);
    play(b.engine, P1, b.id("e"));
    drain(b.engine, declineAll);
    noPending(b.engine);
    assert.equal(zoneOf(b.engine, b.id("e")), "play");
    // Etb's own trigger is ignored (no -1), but the Watcher's "another card entered" trigger is not.
    assert.equal(influence(b.engine, P1), start - 1, "only the other (non-self) trigger fired");
  });
});
