// `SpoilsEngine.perform` and `checkAction` (and the read-only queries that take an action) treat what they are
// handed as read-only: they work on their own copy, never write into the caller's object, and never keep a live
// reference to any part of it. Observed once with Epic Smackdown, whose `playCard` action used to gain the
// variable (`oppHad`) the engine worked out itself, so sending the same object again, or checking it and then
// performing it, behaved differently.
//
// Every scenario here drives two copies of the same game through the same actions:
//   - the "frozen" engine is handed deep-frozen actions (a write into one throws),
//   - the "live" engine is handed ordinary objects that are inspected afterwards.
// and asserts they end in the same state, that no action was altered, that nothing in the game state aliases an
// action, that scribbling over an action afterwards cannot change the game, and that a save -> JSON -> load of the
// result is the same game.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpoilsEngine, answerPlayRequirement, loadGame, saveGame } from "../../../engine.js";
import type { CardInstanceId, GameAction, PendingChoice } from "../../../engine.js";
import {
  P1,
  P2,
  bank,
  buildGame,
  cardDef,
  character,
  developFaction,
  killTactic,
  location,
  resourceCard,
  tactic
} from "../per-card/_harness.js";
import { digestState } from "../support/digest.js";
import { createEngine } from "../support/driver.js";
import { REPLAY_FORMAT_VERSION, digestAt, type ReplayFile } from "../support/replay.js";

type Choice = Extract<GameAction, { type: "resolvePendingChoice" }>["choice"];
type Answer = (pending: PendingChoice) => Choice | undefined;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** Every object and array reachable from `value` (primitives are not identities). */
function objectsIn(value: unknown, into = new Set<object>()): Set<object> {
  if (value && typeof value === "object" && !into.has(value)) {
    into.add(value);
    for (const inner of Object.values(value)) objectsIn(inner, into);
  }
  return into;
}

/** Changes everything it can reach: numbers, strings, booleans, array lengths, extra keys. */
function scribble(value: unknown): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] && typeof value[i] === "object") scribble(value[i]);
      else value[i] = "scribbled";
    }
    value.push("scribbled");
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const inner = record[key];
      if (inner && typeof inner === "object") scribble(inner);
      else if (typeof inner === "number") record[key] = inner + 1000;
      else if (typeof inner === "boolean") record[key] = !inner;
      else record[key] = "scribbled";
    }
    record["__scribbled"] = "scribbled";
  }
}

function digestOf(engine: SpoilsEngine): string {
  return digestState(engine.state);
}

/** The same game twice, so one copy can be given frozen actions and the other ordinary ones. */
class Pair {
  readonly frozen: SpoilsEngine;
  readonly performed: GameAction[] = [];
  private steps = 0;

  constructor(
    readonly live: SpoilsEngine,
    private readonly rebuild: () => SpoilsEngine
  ) {
    this.frozen = new SpoilsEngine(Object.values(live.definitions), structuredClone(live.state));
  }

  /** Sends `action` to both engines and checks everything the engine promises about its input. */
  act(action: GameAction): void {
    const snapshot = structuredClone(action);
    const frozenAction = deepFreeze(structuredClone(action));
    const label = `step ${this.steps} (${action.type}${action.type === "resolvePendingChoice" ? ` / ${action.choice.kind}` : ""})`;

    // Checking first changes nothing: not the game, not the action.
    const before = digestOf(this.frozen);
    assert.deepEqual(this.frozen.checkAction(frozenAction), { ok: true }, `${label}: checkAction on a frozen action`);
    assert.equal(digestOf(this.frozen), before, `${label}: checkAction left the game changed`);
    assert.deepEqual(this.live.checkAction(action), { ok: true }, `${label}: checkAction on a live action`);
    assert.deepEqual(action, snapshot, `${label}: checkAction wrote into the action`);

    this.frozen.perform(frozenAction);
    this.live.perform(action);

    assert.deepEqual(frozenAction, snapshot, `${label}: perform altered the frozen action`);
    assert.deepEqual(action, snapshot, `${label}: perform wrote into the action`);
    assert.equal(digestOf(this.frozen), digestOf(this.live), `${label}: a frozen action played differently from a live one`);

    const mine = objectsIn(action);
    for (const object of objectsIn(this.live.state)) {
      assert.ok(!mine.has(object), `${label}: the game state keeps a live reference into the action`);
    }

    // The same object sent again, to a game that has not seen it, does what it did the first time.
    if (this.steps === 0) {
      const again = this.rebuild();
      again.perform(action);
      assert.equal(digestOf(again), digestOf(this.live), `${label}: sending the same action object again played differently`);
    }

    // Whatever the caller does to its object afterwards cannot reach the game.
    const settled = digestOf(this.live);
    scribble(action);
    assert.equal(digestOf(this.live), settled, `${label}: changing the action afterwards changed the game`);

    this.performed.push(snapshot);
    this.steps++;
  }

  /** Drives windows, battles and prompts to rest, answering prompts with `answer`; stops at a prompt `answer` declines. */
  settle(answer: Answer = () => undefined): void {
    for (let guard = 0; guard < 500; guard++) {
      const { state } = this.live;
      if (state.pendingChoice) {
        const choice = answer(state.pendingChoice);
        if (!choice) return;
        this.act({ type: "resolvePendingChoice", playerId: state.pendingChoice.playerId, choice });
      } else if (state.responseWindow) {
        const window = state.responseWindow;
        this.act(
          window.phase === "acceptingResponses"
            ? { type: "passPriority", playerId: window.priorityPlayerId }
            : { type: "advanceFlow" }
        );
      } else if (state.battle) {
        const battle = state.battle;
        const view = this.live.getBattleView();
        if (battle.phase === "blocking") {
          this.act({ type: "declareBlockers", playerId: battle.defenderPlayerId, blockerIds: this.blockers });
        } else if (battle.phase === "attackerDamageAssignment" || battle.phase === "defenderDamageAssignment") {
          assert.ok(view?.actingPlayerId, "an acting player during damage assignment");
          this.act({
            type: "assignBattleDamage",
            playerId: view.actingPlayerId,
            assignments: view.damageSources.flatMap(source =>
              source.legalTargets.length > 0 && source.strength > 0
                ? [{ sourceId: source.cardId, target: source.legalTargets[0]!, amount: source.strength }]
                : []
            )
          });
        } else if (battle.phase === "finished") {
          this.act({ type: "advanceFlow" });
        } else {
          this.act({ type: "advanceBattle", playerId: battle.attackerPlayerId });
        }
      } else {
        return;
      }
    }
    throw new Error("settle did not converge");
  }

  /** Who the defender blocks with when a battle reaches blocking. */
  blockers: CardInstanceId[] = [];

  /** The finished game saves, goes through JSON and loads back as the same game. */
  assertSaveRoundTrip(): void {
    const save = JSON.parse(JSON.stringify(saveGame(this.live)));
    const loaded = loadGame(save, Object.values(this.live.definitions));
    assert.equal(digestOf(loaded), digestOf(this.live), "save -> JSON -> load changed the game");
    assert.equal(digestOf(this.frozen), digestOf(this.live), "the frozen and live games ended differently");
  }
}

function pairOf(build: () => ReturnType<typeof buildGame>): { pair: Pair; id: (key: string) => CardInstanceId } {
  const built = build();
  // `again` rebuilds a game in the state this one started in.
  const start = structuredClone(built.engine.state);
  const rebuild = () => new SpoilsEngine(Object.values(built.engine.definitions), structuredClone(start));
  return { pair: new Pair(built.engine, rebuild), id: built.id };
}

const def = (name: string) => cardDef("Seed 2", name);
const discarded = (engine: SpoilsEngine, id: CardInstanceId) => engine.state.cards[id]!.zone === "discard";

describe("playCard", () => {
  test("Epic Smackdown: the engine's own variable stays out of the caller's action", () => {
    const { pair, id } = pairOf(() =>
      buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "es", def: def("Epic Smackdown"), owner: P1, zone: "hand" },
          { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
          { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
          { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" },
          { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
          { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
          ...bank("rage", 8, P1)
        ]
      })
    );
    pair.act({
      type: "playCard",
      playerId: P1,
      cardId: id("es"),
      variables: { x: 1 },
      selected: { sacX: [id("mine")] }
    });
    pair.settle(pending =>
      pending.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("o1")] } : undefined
    );
    assert.ok(discarded(pair.live, id("mine")), "the sacrificed character is in the discard pile");
    assert.ok(discarded(pair.live, id("o1")), "the opponent's pick is in the discard pile");
    assert.equal(pair.live.state.cards[id("o2")]!.zone, "play");
    pair.assertSaveRoundTrip();
  });

  test("Epic Smackdown with X larger than the opponent's board: the other branch", () => {
    const { pair, id } = pairOf(() =>
      buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "es", def: def("Epic Smackdown"), owner: P1, zone: "hand" },
          { key: "m1", def: character({ name: "M1" }), owner: P1, zone: "play" },
          { key: "m2", def: character({ name: "M2" }), owner: P1, zone: "play" },
          { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
          { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
          ...bank("rage", 8, P1)
        ]
      })
    );
    pair.act({
      type: "playCard",
      playerId: P1,
      cardId: id("es"),
      variables: { x: 2 },
      selected: { sacX: [id("m1"), id("m2")] }
    });
    pair.settle();
    assert.ok(discarded(pair.live, id("o1")), "an opponent with fewer than X characters loses them all");
    pair.assertSaveRoundTrip();
  });

  test("a play with payWith and selected picks", () => {
    const { pair, id } = pairOf(() =>
      buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "kill", def: killTactic({ cost: 2 }), owner: P1, zone: "hand" },
          { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
          { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "play" },
          { key: "r2", def: resourceCard({ name: "R2" }), owner: P1, zone: "play" },
          { key: "r3", def: resourceCard({ name: "R3" }), owner: P1, zone: "play" }
        ]
      })
    );
    pair.act({
      type: "playCard",
      playerId: P1,
      cardId: id("kill"),
      selected: { t: [id("victim")] },
      payWith: [id("r2"), id("r3")]
    });
    pair.settle();
    assert.ok(discarded(pair.live, id("victim")), "the pick was destroyed");
    assert.equal(pair.live.state.cards[id("r2")]!.attachedTo !== undefined, true, "the named resource paid");
    assert.equal(pair.live.state.cards[id("r1")]!.attachedTo, undefined, "the unnamed one did not");
    pair.assertSaveRoundTrip();
  });

  const namingTactic = () =>
    tactic({
      name: "Namer",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "n",
            type: "activated",
            costs: [{ type: "nameValue", valueKind: "resourceIcon", storeAs: "icon" }],
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });
  const namingBoard = () =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "namer", def: namingTactic(), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" }
      ]
    });

  test("a play that names a value up front", () => {
    const { pair, id } = pairOf(namingBoard);
    pair.act({
      type: "playCard",
      playerId: P1,
      cardId: id("namer"),
      selected: { t: [id("victim")] },
      named: { icon: "rage" }
    });
    pair.settle();
    assert.ok(discarded(pair.live, id("victim")));
    pair.assertSaveRoundTrip();
  });

  test("a play the engine pauses for a name: the prompt keeps its own copy of the action", () => {
    const { pair, id } = pairOf(namingBoard);
    const play: GameAction = {
      type: "playCard",
      playerId: P1,
      cardId: id("namer"),
      selected: { t: [id("victim")] }
    };
    pair.act(play);
    assert.equal(pair.live.state.pendingChoice?.kind, "nameValue", "the engine asked for the name");
    pair.settle(pending => (pending.kind === "nameValue" ? { kind: "nameValue", value: "rage" } : undefined));
    assert.ok(discarded(pair.live, id("victim")));
    pair.assertSaveRoundTrip();
  });
});

describe("activateAbility", () => {
  const smasher = () =>
    character({
      name: "Smasher",
      behavior: {
        abilities: [
          {
            id: "smash",
            type: "activated",
            targets: [
              {
                id: "t",
                selector: { controller: "opponent", zone: "play", type: "character" },
                count: { type: "variable", id: "x" }
              }
            ],
            effects: [
              {
                type: "bind",
                id: "seen",
                value: { type: "count", selector: { controller: "opponent", zone: "play", type: "character" } }
              },
              {
                type: "forEach",
                selected: "t",
                effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }]
              }
            ]
          }
        ]
      }
    });

  test("an ability with picks and a chosen number", () => {
    const { pair, id } = pairOf(() =>
      buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "smasher", def: smasher(), owner: P1, zone: "play" },
          { key: "o1", def: character({ name: "O1" }), owner: P2, zone: "play" },
          { key: "o2", def: character({ name: "O2" }), owner: P2, zone: "play" }
        ]
      })
    );
    pair.act({
      type: "activateAbility",
      playerId: P1,
      cardId: id("smasher"),
      abilityId: "smash",
      selected: { t: [id("o1")] },
      variables: { x: 1 }
    });
    pair.settle();
    assert.ok(discarded(pair.live, id("o1")));
    assert.equal(pair.live.state.cards[id("o2")]!.zone, "play");
    pair.assertSaveRoundTrip();
  });

  test("an ability whose cost asks for a name: the paused action is the engine's own copy", () => {
    const naming = () =>
      character({
        name: "Namer",
        behavior: {
          abilities: [
            {
              id: "n",
              type: "activated",
              costs: [{ type: "nameValue", valueKind: "resourceIcon", storeAs: "icon" }],
              effects: []
            }
          ]
        }
      });
    const { pair, id } = pairOf(() =>
      buildGame({
        playerA: { faction: developFaction() },
        cards: [{ key: "namer", def: naming(), owner: P1, zone: "play" }]
      })
    );
    pair.act({ type: "activateAbility", playerId: P1, cardId: id("namer"), abilityId: "n" });
    assert.equal(pair.live.state.pendingChoice?.kind, "nameValue");
    pair.settle(pending => (pending.kind === "nameValue" ? { kind: "nameValue", value: "greed" } : undefined));
    pair.assertSaveRoundTrip();
  });
});

describe("flipUp", () => {
  test("a FLIP UP with a pick, an option and named payers", () => {
    const flipper = () => ({
      ...killTactic({ cost: 3, threshold: "o", flipUp: { cost: 1, threshold: "o" } }),
      id: "immutability-flipper"
    });
    const { pair, id } = pairOf(() =>
      buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "fd", def: flipper(), owner: P1, zone: "play", faceDown: true },
          { key: "victim", def: character({ name: "Victim" }), owner: P2, zone: "play" },
          ...bank("obsession", 4, P1)
        ]
      })
    );
    const payer = [...Object.values(pair.live.state.cards)].find(card => card.zone === "play" && !card.faceDown && card.controllerId === P1 && pair.live.isResource(card.id));
    assert.ok(payer, "a face-up resource to pay with");
    pair.act({
      type: "flipUp",
      playerId: P1,
      cardId: id("fd"),
      selected: { t: [id("victim")] },
      flipUpOption: 0,
      payWith: [payer.id]
    });
    pair.settle();
    assert.ok(discarded(pair.live, id("victim")), "the flipped tactic destroyed its pick");
    pair.assertSaveRoundTrip();
  });
});

describe("battle actions", () => {
  test("declareAttack, passPriority, declareBlockers, assignBattleDamage, advanceFlow", () => {
    const { pair, id } = pairOf(() =>
      buildGame({
        playerA: { faction: developFaction() },
        playerB: { faction: developFaction() },
        turn: 2,
        activePlayerId: P1,
        cards: [
          { key: "a1", def: character({ name: "A1", strength: 2, life: 3 }), owner: P1, zone: "play" },
          { key: "a2", def: character({ name: "A2", strength: 1, life: 3 }), owner: P1, zone: "play" },
          { key: "b1", def: character({ name: "B1", strength: 1, life: 3 }), owner: P2, zone: "play" },
          { key: "loc", def: location({ name: "Fort" }), owner: P2, zone: "play" }
        ]
      })
    );
    pair.blockers = [id("b1")];
    pair.act({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [id("a1"), id("a2")],
      target: { type: "card", cardId: id("loc") }
    });
    pair.settle();
    assert.equal(pair.live.state.battle, undefined, "the battle finished");
    assert.ok(pair.performed.some(a => a.type === "declareBlockers"), "blockers were declared");
    assert.ok(pair.performed.some(a => a.type === "assignBattleDamage"), "damage was assigned");
    pair.assertSaveRoundTrip();
  });

  test("an attack with no target named defaults to the faction without the default being written into the action", () => {
    const { pair, id } = pairOf(() =>
      buildGame({
        playerA: { faction: developFaction() },
        playerB: { faction: developFaction() },
        turn: 2,
        activePlayerId: P1,
        cards: [{ key: "a1", def: character({ name: "A1", strength: 2 }), owner: P1, zone: "play" }]
      })
    );
    pair.act({ type: "declareAttack", playerId: P1, attackerIds: [id("a1")] });
    pair.settle();
    pair.assertSaveRoundTrip();
  });

  test("the queries that take an action or a target also leave them alone", () => {
    const { pair, id } = pairOf(() =>
      buildGame({
        playerA: { faction: developFaction() },
        playerB: { faction: developFaction() },
        turn: 2,
        activePlayerId: P1,
        cards: [
          { key: "kill", def: killTactic({ cost: 1 }), owner: P1, zone: "hand" },
          { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "play" },
          { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "play" },
          { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "play" }
        ]
      })
    );
    const engine = pair.live;
    const before = digestOf(engine);
    const play = deepFreeze({ type: "playCard" as const, playerId: P1, cardId: id("kill"), selected: { t: [id("b1")] } });
    const frozenTarget = deepFreeze({ type: "card" as const, cardId: id("b1") });
    engine.getPlayRequirements(play);
    engine.getPaymentOptions(play);
    engine.getPickCandidates(play, "t");
    engine.checkPlaySelection(play, "t", [id("b1")]);
    engine.previewBlockOptions(P1, [id("a1")], frozenTarget);
    engine.previewNumber({ type: "count", selector: { zone: "play", type: "character" } }, deepFreeze({ sourceId: id("a1"), controllerId: P1, selected: {}, variables: {} }));
    const input = deepFreeze(engine.getPlaySelectionInput(P1, id("kill")));
    engine.getSelectionRequirements(input);
    engine.checkSelection(input, "t", [id("b1")]);
    assert.equal(digestOf(engine), before, "queries never change the game");
  });
});

describe("answerPlayRequirement", () => {
  test("folds an answer into a copy that shares nothing with its inputs", () => {
    const action = deepFreeze({
      type: "playCard" as const,
      playerId: P1,
      cardId: "c",
      selected: { a: ["1"] },
      variables: { x: 1 }
    });
    const pick = deepFreeze({ kind: "pick" as const, id: "t", cardIds: ["2", "3"] });
    const picked = answerPlayRequirement(action, pick);
    assert.deepEqual(picked.selected, { a: ["1"], t: ["2", "3"] });
    const owned = objectsIn(picked);
    for (const input of [action, pick]) {
      for (const object of objectsIn(input)) assert.ok(!owned.has(object), "the result shares an object with an input");
    }
    // An answer that changes nothing still hands back a new object.
    const unchanged = answerPlayRequirement(
      deepFreeze({ type: "activateAbility" as const, playerId: P1, cardId: "c", abilityId: "a" }),
      deepFreeze({ kind: "mode" as const, index: 1 })
    );
    assert.equal(Object.isFrozen(unchanged), false, "a fresh, writable object");
  });
});

// --- Setup answers and every kind of pending-choice answer, through recorded games ---------------------------

const REPLAYS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "data", "replays", "2p");

/** The action's type (and pending-choice kind), plus which optional fields it carries: `playCard[selected,variables]`. */
function kindOf(action: GameAction): string {
  const carried = (value: object): string =>
    Object.entries(value)
      .filter(([key, inner]) => key !== "type" && key !== "playerId" && key !== "kind" && inner !== undefined)
      .filter(([, inner]) => !(typeof inner === "object" && inner !== null && Object.keys(inner).length === 0))
      .map(([key]) => key)
      .sort()
      .join(",");
  return action.type === "resolvePendingChoice"
    ? `${action.type}:${action.choice.kind}[${carried(action.choice)}]`
    : `${action.type}[${carried(action)}]`;
}

/** A small set of recorded games that between them contain every kind of action the corpus has (and every combination of optional fields on it), picked greedily. */
function coveringGames(): { name: string; file: ReplayFile }[] {
  const all = fs
    .readdirSync(REPLAYS)
    .filter(name => /^game-\d+\.json$/.test(name))
    .sort()
    .map(name => ({ name, file: JSON.parse(fs.readFileSync(path.join(REPLAYS, name), "utf8")) as ReplayFile }))
    .map(game => ({ ...game, kinds: new Set(game.file.actions.map(kindOf)) }));
  const missing = new Set(all.flatMap(game => [...game.kinds]));
  const chosen: typeof all = [];
  while (missing.size > 0) {
    // Most uncovered kinds first; the shorter game on a tie, to keep the sweep quick.
    const best = [...all]
      .map(game => ({ game, gain: [...game.kinds].filter(kind => missing.has(kind)).length }))
      .sort((a, b) => b.gain - a.gain || a.game.file.actions.length - b.game.file.actions.length)[0]!;
    if (best.gain === 0) break;
    chosen.push(best.game);
    for (const kind of best.game.kinds) missing.delete(kind);
  }
  return chosen;
}

describe("recorded games, played with deep-frozen actions", () => {
  const games = coveringGames();

  test("the chosen games contain every action and pending-choice kind of the whole corpus", () => {
    const wanted = new Set<string>();
    for (const name of fs.readdirSync(REPLAYS).filter(n => /^game-\d+\.json$/.test(n))) {
      const file = JSON.parse(fs.readFileSync(path.join(REPLAYS, name), "utf8")) as ReplayFile;
      for (const action of file.actions) wanted.add(kindOf(action));
    }
    const got = new Set(games.flatMap(game => game.file.actions.map(kindOf)));
    assert.deepEqual([...wanted].filter(kind => !got.has(kind)), [], "action kinds missing from the sweep");
    for (const type of [
      "mulligan",
      "chooseStartingResources",
      "chooseFirstPlayer",
      "declareAttack",
      "declareBlockers",
      "assignBattleDamage",
      "activateAbility",
      "flipUp",
      "playCard",
      "passPriority",
      "advanceFlow",
      "endTurn"
    ]) {
      assert.ok([...got].some(kind => kind.startsWith(`${type}[`)), `the sweep has a ${type} action`);
    }
  });

  for (const { name, file } of games) {
    test(`${name}: every action is checked, then performed, frozen, to the recorded digests (${file.actions.length} actions)`, () => {
      assert.equal(file.formatVersion, REPLAY_FORMAT_VERSION);
      const engine = createEngine(file.setup);
      assert.equal(digestOf(engine), digestAt(file, 0), "setup digest");
      for (let i = 0; i < file.actions.length; i++) {
        const action = deepFreeze(structuredClone(file.actions[i]!));
        const label = `${name} action ${i} (${kindOf(action)})`;
        const before = digestOf(engine);
        assert.deepEqual(engine.checkAction(action), { ok: true }, `${label}: checkAction`);
        assert.equal(digestOf(engine), before, `${label}: checkAction changed the game`);
        engine.perform(action);
        assert.equal(digestOf(engine), digestAt(file, i + 1), `${label}: digest after the action`);
        assert.deepEqual(action, file.actions[i], `${label}: the action was altered`);
      }
    });
  }
});

// Compile-time: the public parameters take deeply read-only input (this only has to typecheck).
export function acceptsReadonlyInput(engine: SpoilsEngine): void {
  const play = { type: "playCard", playerId: P1, cardId: "x", selected: { t: ["a"] }, payWith: ["b"] } as const;
  const answer = { type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: ["a", "b"] } } as const;
  engine.checkAction(play);
  engine.perform(answer);
  engine.getPlayRequirements(play);
}
