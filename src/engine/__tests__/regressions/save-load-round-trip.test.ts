// saveGame -> JSON -> loadGame at any moment, mid-resolution included, must give a game that carries on exactly as
// the original would. A save used to lose what the engine held outside `GameState` (the triggers waiting behind an
// open choice) and, through JSON, the objects a parked resolution shares between its effect frames, its stack item
// and the open choice (an answer written into one was no longer seen by the others).
//
// 1. The 41 save points the replay recorder found that did not survive the round trip (data/replays/2p/index.json
//    listed them as `roundTripFailures` before the fix), replayed against the recorded digests.
// 2. Focused fixtures: triggers waiting behind a choice, a nested effect frame waiting on a pick.
// 3. A sweep over the recorded games: save at mid-resolution moments and play on.
//
// `SAVE_LOAD_SWEEP=full` makes the sweep try every mid-resolution moment of every game (about ten minutes of CPU);
// the default is a deterministic sample of games and moments.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGame, saveGame, type SpoilsEngine } from "../../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses, resourceCard, tactic } from "../support/fixtures.js";
import { developFaction } from "../per-card/_harness.js";
import { developPlay } from "../support/develop.js";
import { findAliases } from "../support/aliases.js";
import { replayAgainstDigests, sweepRoundTrips, type ReplayFile } from "../support/replay.js";

const REPLAYS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "data", "replays", "2p");

/** `[recorder slot, saved after N actions, first action that then failed]`: the save points that used to fail. */
const FORMER_FAILURES: ReadonlyArray<readonly [number, number, number]> = [
  [4, 84, 85], [8, 216, 217], [8, 217, 219], [8, 218, 219], [16, 204, 205], [17, 276, 277], [17, 277, 278],
  [21, 102, 103], [21, 103, 104], [25, 296, 297], [25, 297, 298], [26, 67, 68], [27, 86, 88], [27, 87, 88],
  [27, 260, 261], [37, 213, 214], [37, 319, 320], [46, 105, 106], [46, 106, 107], [46, 107, 108], [57, 83, 84],
  [57, 84, 86], [57, 85, 86], [61, 282, 283], [72, 64, 65], [72, 192, 193], [72, 193, 195], [72, 194, 195],
  [74, 207, 208], [74, 208, 210], [74, 209, 210], [78, 195, 197], [78, 196, 197], [78, 293, 294], [80, 74, 75],
  [80, 75, 76], [87, 107, 108], [87, 108, 110], [87, 109, 110], [88, 327, 328], [99, 120, 121]
];

const replayFiles = new Map<number, ReplayFile>();
function replayFor(slot: number): ReplayFile {
  let file = replayFiles.get(slot);
  if (!file) {
    file = JSON.parse(fs.readFileSync(path.join(REPLAYS, `game-${String(slot).padStart(3, "0")}.json`), "utf8")) as ReplayFile;
    replayFiles.set(slot, file);
  }
  return file;
}

/** Saves `engine`, pushes the save through JSON text and loads it into a new engine. */
function roundTrip(engine: SpoilsEngine): SpoilsEngine {
  return loadGame(JSON.parse(JSON.stringify(saveGame(engine))), Object.values(engine.definitions));
}

/** The whole state as JSON text: what a save would hold. */
const snapshot = (engine: SpoilsEngine): string => JSON.stringify(engine.state);

type Choice = Extract<Parameters<SpoilsEngine["perform"]>[0], { type: "resolvePendingChoice" }>["choice"];

/** Performs the same action on both engines and requires them to be in the same state afterwards. */
function both(live: SpoilsEngine, loaded: SpoilsEngine, action: Parameters<SpoilsEngine["perform"]>[0], what: string): void {
  live.perform(structuredClone(action));
  loaded.perform(structuredClone(action));
  assert.equal(snapshot(loaded), snapshot(live), `${what}: the loaded game diverged from the original`);
  assert.deepEqual(findAliases(live.state, live.definitions), [], `${what}: the state shares an object between two places`);
}

const answer = (playerId: string, choice: Choice) => ({ type: "resolvePendingChoice", playerId, choice }) as const;

describe("the save points that used to fail to round-trip", () => {
  for (const [slot, savedAfter, failedAt] of FORMER_FAILURES) {
    test(`slot ${slot}: saved after action ${savedAfter}, played on through ${failedAt + 20}`, () => {
      const file = replayFor(slot);
      const mismatch = replayAgainstDigests(file, { roundTripAfter: [savedAfter], stopAfter: failedAt + 20 });
      assert.equal(
        mismatch,
        undefined,
        mismatch === undefined
          ? "replay matches"
          : `diverged at step ${mismatch.index} (${JSON.stringify(mismatch.action)}): expected ${mismatch.expected}, got ${mismatch.actual}` +
            (mismatch.error ? `; ${mismatch.error}` : "")
      );
    });
  }
});

describe("a save taken mid-resolution", () => {
  test("keeps the triggers waiting behind an open choice", () => {
    const drawOnEnter = (id: string) => ({
      id,
      type: "triggered" as const,
      event: "cardEnteredPlay" as const,
      condition: { type: "sourceIsEventCard" as const },
      effects: [{ type: "draw" as const, player: "controller" as const, amount: 1 }]
    });
    const { engine, id } = buildGame({
      cards: [
        {
          key: "triple",
          def: character({ name: "Triple Drawer", behavior: { abilities: [drawOnEnter("a"), drawOnEnter("b"), drawOnEnter("c")] } }),
          owner: P1,
          zone: "hand"
        },
        ...Array.from({ length: 5 }, (_, i) => ({ key: `deck${i}`, def: character({ name: `Deck Card ${i}` }), owner: P1, zone: "deck" as const }))
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("triple") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "orderTriggers");
    assert.equal(engine.state.engineMemory.immediateQueue.length, 3, "all three triggers wait behind the ordering prompt");

    const loaded = roundTrip(engine);
    assert.equal(loaded.immediateQueue.length, 3, "the loaded game has the waiting triggers");
    assert.equal(snapshot(loaded), snapshot(engine));

    const handBefore = engine.state.players[P1].hand.length;
    for (let guard = 0; guard < 50 && (engine.state.responseWindow || engine.state.pendingChoice); guard++) {
      const pending = engine.state.pendingChoice;
      if (pending?.kind === "orderTriggers") {
        const next = pending.triggers[pending.triggers.length - 1]!;
        both(engine, loaded, answer(pending.playerId, { kind: "orderTriggers", next }), "ordering the triggers");
      } else {
        const window = engine.state.responseWindow!;
        both(engine, loaded, window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" }, "closing the window");
      }
    }
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(loaded.state.players[P1].hand.length, handBefore + 3, "all three triggers resolved on the loaded game");
  });

  test("keeps a sibling trigger held back while the first one's pick is answered", () => {
    const watcher = (name: string) =>
      character({
        name,
        behavior: {
          abilities: [
            {
              id: "watch",
              type: "triggered",
              event: "cardEnteredPlay",
              condition: {
                type: "and",
                conditions: [
                  { type: "eventCardControlledBy", player: "controller" },
                  { type: "cardTypeIs", target: "eventCard", cardType: "resource" }
                ]
              },
              effects: [
                { type: "nameValue", chooser: "controller", valueKind: "resourceIcon", storeAs: "x" },
                { type: "modifyInfluence", player: "controller", amount: 2 }
              ]
            }
          ]
        } as never
      });
    const { engine, id: k } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "w1", def: watcher("Watcher One"), owner: P1, zone: "play" },
        { key: "w2", def: watcher("Watcher Two"), owner: P1, zone: "play" },
        { key: "r", def: resourceCard({ name: "Plain" }), owner: P1, zone: "hand" }
      ]
    });
    const influence = engine.state.players[P1].influence;
    developPlay(engine, P1, k("r"));
    // The two triggers are ordered, then the first asks for its name while the other waits.
    let guard = 0;
    for (let pending = engine.state.pendingChoice; pending?.kind === "orderTriggers" && guard++ < 4; pending = engine.state.pendingChoice) {
      engine.perform(answer(pending.playerId, { kind: "orderTriggers", next: pending.triggers[0]! }));
    }
    assert.equal(engine.state.pendingChoice?.kind, "nameValue");
    assert.ok(engine.state.engineMemory.immediateQueue.some(queued => queued.held), "the sibling trigger is held behind the pending name");

    const loaded = roundTrip(engine);
    assert.ok(loaded.immediateQueue.some(queued => queued.held), "the loaded game still holds it");
    for (let i = 0; i < 6 && engine.state.pendingChoice; i++) {
      const pending = engine.state.pendingChoice as NonNullable<SpoilsEngine["state"]["pendingChoice"]>;
      if (pending.kind === "nameValue") {
        both(engine, loaded, answer(pending.playerId, { kind: "nameValue", value: "rage" }), "naming");
      } else if (pending.kind === "orderTriggers") {
        both(engine, loaded, answer(pending.playerId, { kind: "orderTriggers", next: pending.triggers[0]! }), "ordering");
      } else {
        assert.fail(`unexpected prompt ${pending.kind}`);
      }
      resolvePendingResponses(engine);
      resolvePendingResponses(loaded);
      assert.equal(snapshot(loaded), snapshot(engine));
    }
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(loaded.state.players[P1].influence, influence + 4, "each trigger ran once on the loaded game");
  });

  test("sees a pick answered after the load in every effect frame that waits on it", () => {
    // The outer effect list's second effect acts on the card the nested pick chose: the pick has to reach the outer
    // frame, which is parked while the nested list waits for the answer.
    const prune = tactic({
      name: "Prune",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "prune",
            type: "activated",
            effects: [
              {
                type: "chooserSelectsTarget",
                chooser: "controller",
                declaration: { id: "victim", selector: { controller: "opponent", zone: "play" }, count: 1 },
                effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }]
              },
              { type: "destroy", target: { type: "selected", id: "victim" } }
            ]
          }
        ]
      } as never
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "prune", def: prune, owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "Bystander A" }), owner: P2 },
        { key: "b", def: character({ name: "Bystander B" }), owner: P2 }
      ]
    });
    const influence = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("prune") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
    assert.ok(engine.state.pendingEffectFrames.length > 0, "the outer effect list is parked");

    const loaded = roundTrip(engine);
    assert.equal(snapshot(loaded), snapshot(engine));

    const pending = engine.state.pendingChoice!;
    both(engine, loaded, answer(pending.playerId, { kind: "chooserSelectsTarget", selected: [id("b")] }), "answering the pick");
    resolvePendingResponses(engine);
    resolvePendingResponses(loaded);
    assert.equal(snapshot(loaded), snapshot(engine));
    assert.equal(loaded.state.cards[id("b")]!.zone, "discard", "the picked card was destroyed by the outer list on the loaded game");
    assert.equal(loaded.state.cards[id("a")]!.zone, "play");
    assert.equal(loaded.state.players[P1].influence, influence + 1);
  });

  test("keeps a coin flip waiting on a reflip decision, with the context it resolves in", () => {
    const coin = item({
      name: "Two-Headed Coin",
      behavior: {
        abilities: [
          {
            id: "reflip",
            type: "replacement",
            replaces: { event: "coinFlip", result: "lose" },
            optional: true,
            optionalCost: [{ type: "deplete", target: "source" }],
            effects: [{ type: "draw", player: "controller", amount: 1 }]
          }
        ]
      } as never
    });
    const flipper = tactic({
      name: "Flippy",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "flip",
            type: "activated",
            effects: [
              {
                type: "flipCoin",
                winEffects: [{ type: "modifyInfluence", player: "controller", amount: 1 }],
                loseEffects: [{ type: "modifyInfluence", player: "controller", amount: -1 }]
              },
              { type: "modifyInfluence", player: "controller", amount: 10 }
            ]
          }
        ]
      } as never
    });
    // The first flip loses, the reflip wins.
    let calls = 0;
    const { engine, id } = buildGame({
      cards: [
        { key: "coin", def: coin, owner: P1 },
        { key: "flip", def: flipper, owner: P1, zone: "hand" },
        { key: "d0", def: tactic({ name: "D0" }), owner: P1, zone: "deck" }
      ],
      random: () => (calls++ === 0 ? 0.9 : 0.1)
    });
    const before = engine.state.players[P1].influence;
    engine.perform({ type: "playCard", playerId: P1, cardId: id("flip") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.pendingChoice?.kind, "coinFlipReplace");
    assert.ok(engine.state.pendingCoinFlip);

    const loaded = loadGame(JSON.parse(JSON.stringify(saveGame(engine))), Object.values(engine.definitions), () => 0.1);
    assert.equal(snapshot(loaded), snapshot(engine));
    both(engine, loaded, answer(P1, { kind: "coinFlipReplace", reflip: true }), "reflipping");
    resolvePendingResponses(engine);
    resolvePendingResponses(loaded);
    assert.equal(snapshot(loaded), snapshot(engine));
    assert.equal(loaded.state.players[P1].influence, before + 11, "the winning flip and the effect after it, once each");
  });

  test("a loaded game can be saved again at once and still continues identically", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "t", def: tactic({ name: "Pick Two", cost: 0, behavior: { abilities: [{
          id: "pick", type: "activated",
          effects: [
            { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "one", selector: { controller: "opponent", zone: "play" }, count: 1 }, effects: [] },
            { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "two", selector: { controller: "opponent", zone: "play" }, count: 1 }, effects: [] },
            { type: "destroy", target: { type: "selected", id: "one" } },
            { type: "destroy", target: { type: "selected", id: "two" } }
          ]
        }] } as never }), owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "Bystander A" }), owner: P2 },
        { key: "b", def: character({ name: "Bystander B" }), owner: P2 },
        { key: "c", def: character({ name: "Bystander C" }), owner: P2 }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("t") });
    resolvePendingResponses(engine);
    let loaded = roundTrip(engine);
    for (const pick of ["a", "c"]) {
      const pending = engine.state.pendingChoice;
      assert.equal(pending?.kind, "chooserSelectsTarget");
      both(engine, loaded, answer(pending!.playerId, { kind: "chooserSelectsTarget", selected: [id(pick)] }), `picking ${pick}`);
      loaded = roundTrip(loaded);
      assert.equal(snapshot(loaded), snapshot(engine), "a freshly loaded game saves back to the same state");
    }
    resolvePendingResponses(engine);
    resolvePendingResponses(loaded);
    assert.equal(snapshot(loaded), snapshot(engine));
    assert.equal(loaded.state.cards[id("a")]!.zone, "discard");
    assert.equal(loaded.state.cards[id("c")]!.zone, "discard");
    assert.equal(loaded.state.cards[id("b")]!.zone, "play");
    void P2;
  });
});

describe("save/load sweep over the recorded games", () => {
  test("every sampled mid-resolution moment saves, loads and plays on to the recorded digests", () => {
    const full = process.env.SAVE_LOAD_SWEEP === "full";
    const stride = full ? 1 : 8;
    // Playing a game to its end costs about as much as all the saves tried in it, so the default sample covers every
    // third game; the moments within those are sampled by `stride` plus the first of each kind.
    const names = fs
      .readdirSync(REPLAYS)
      .filter(name => /^game-\d+\.json$/.test(name))
      .sort()
      .filter((_, index) => full || index % 3 === 0);
    const seenKinds = new Set<string>();
    let moments = 0;
    let tried = 0;
    const failures: string[] = [];
    for (const name of names) {
      const file = JSON.parse(fs.readFileSync(path.join(REPLAYS, name), "utf8")) as ReplayFile;
      const result = sweepRoundTrips(file, { stride, lookahead: 2, seenKinds });
      moments += result.moments;
      tried += result.tried;
      for (const { savedAfter, mismatch } of result.failures) {
        failures.push(
          `${name} saved after ${savedAfter}: step ${mismatch.index} ${JSON.stringify(mismatch.action ?? null)} expected ${mismatch.expected} got ${mismatch.actual}` +
            (mismatch.error ? ` (${mismatch.error})` : "")
        );
      }
    }
    assert.ok(moments > 1500, `only ${moments} mid-resolution moments in the corpus`);
    assert.ok(tried >= 100, `only ${tried} saves tried`);
    assert.deepEqual(failures, [], `${failures.length} of ${tried} saves did not continue to the recorded digests`);
  });
});
