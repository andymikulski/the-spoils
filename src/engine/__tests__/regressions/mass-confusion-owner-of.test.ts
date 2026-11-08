// A pick whose selector reads an earlier pick's player ("Pick a player. Pick X characters that player controls")
// is judged before that player is picked. The read-only queries must answer, not throw, and once the player is
// picked the characters on offer must be exactly the ones the printed text allows.
//
// Found by the random-play driver (data/replays/2p/index.json, slot 0 seed 2): `getPlayRequirements` threw
// "Unable to resolve ownerOf target." for Mass Confusion with X >= 1.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { answerPlayRequirement } from "../../../engine.js";
import type { ActivatedAbility, CardDefinition, CardInstanceId, PickStep, PlayAction, SpoilsEngine } from "../../../engine.js";
import cardsJson from "../../../data/cards.js";
import { bank, cardDef, developFaction } from "../per-card/_harness.js";
import { buildGame, character, item, resolvePendingResponses, P1, P2 } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { ELIGIBLE_FACTIONS, SET_NAMES, playRandomGame, randomSetup } from "../support/driver.js";
import { abilityOf, chooseCards, playOf, richBoard } from "../support/requirements-kit.js";

const CATALOG = cardsJson as CardDefinition[];

// Mass Confusion (Seed Saga), tactic, cost 0, [R][R]
// EXTRA COST: Choose a number for X. Pay X. Pick a player. Pick X characters that player controls.
// Inflict Y damage divided however you want to the characters, where Y is the number of characters that player
// controls minus the number of characters you control.
function board(opts: { stolen?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mc", def: cardDef("Seed Saga", "Mass Confusion"), owner: P1, zone: "hand" },
      { key: "m0", def: character({ name: "M0", life: 8 }), owner: P1, zone: "play" },
      { key: "m1", def: character({ name: "M1", life: 8 }), owner: P1, zone: "play" },
      ...["o0", "o1", "o2", "o3"].map(key => ({ key, def: character({ name: key.toUpperCase(), life: 8 }), owner: P2, zone: "play" as const })),
      { key: "mitem", def: item({ name: "MItem" }), owner: P1, zone: "play" },
      { key: "oitem", def: item({ name: "OItem" }), owner: P2, zone: "play" },
      // A character P2 owns that P1 controls: "characters that player controls" follows control, not ownership.
      ...(opts.stolen ? [{ key: "stolen", def: character({ name: "Stolen", life: 8 }), owner: P2, controller: P1, zone: "play" as const }] : []),
      ...bank("rage", 5, P1)
    ]
  });
}

type Board = ReturnType<typeof board>;

const factionIdOf = (engine: SpoilsEngine, player: string): CardInstanceId => engine.state.players[player].factionId!;
const mcPlay = (b: Board, x: number | undefined, selected: Record<string, CardInstanceId[]> = {}): PlayAction => ({
  ...playOf(P1, b.id("mc")),
  ...(x === undefined ? {} : { variables: { x } }),
  selected
});
const pickSteps = (b: Board, action: PlayAction): PickStep[] =>
  b.engine.getPlayRequirements(action).filter((requirement): requirement is PickStep => requirement.kind === "pick");
const idsOf = (b: Board, keys: string[]): CardInstanceId[] => keys.map(key => b.id(key)).sort();
const sorted = (ids: readonly CardInstanceId[]): CardInstanceId[] => [...ids].sort();

describe("Mass Confusion: queries while the player is not picked yet", () => {
  for (const x of [0, 1, 2]) {
    test(`X = ${x}: getPlayRequirements does not throw and asks for the player first`, () => {
      const b = board();
      const steps = pickSteps(b, mcPlay(b, x));
      assert.equal(steps[0].requirement.id, "pl");
      assert.deepEqual(sorted(steps[0].candidates), sorted([factionIdOf(b.engine, P1), factionIdOf(b.engine, P2)]));
      // X = 0 picks no characters at all; otherwise the character pick follows and is sized by X.
      assert.deepEqual(
        steps.map(step => step.requirement.id),
        x === 0 ? ["pl"] : ["pl", "cs"]
      );
      if (x > 0) assert.equal(steps[1].requirement.count, x);
    });

    test(`X = ${x}: checkAction and the card's playability answer without throwing`, () => {
      const b = board();
      assert.doesNotThrow(() => b.engine.checkAction(mcPlay(b, x)));
      assert.doesNotThrow(() => b.engine.getCardPlayability(P1, b.id("mc")));
      assert.doesNotThrow(() => b.engine.getPlayableHandCards(P1));
      assert.equal(b.engine.checkAction(mcPlay(b, x)).ok, false, "the player is still to be picked");
    });
  }

  test("before X is chosen the variables gate is the only thing asked", () => {
    const b = board();
    const requirements = b.engine.getPlayRequirements(mcPlay(b, undefined));
    assert.deepEqual(
      requirements.map(requirement => requirement.kind),
      ["variables"]
    );
  });

  test("the character pick, asked for on its own before the player, has nothing to offer rather than throwing", () => {
    const b = board();
    assert.deepEqual(b.engine.getPickCandidates({ ...mcPlay(b, 1), type: "playCard" } as never, "cs"), []);
  });
});

describe("Mass Confusion: the legal characters are the picked player's, exactly", () => {
  for (const x of [1, 2]) {
    test(`X = ${x}, player = opponent: only the opponent's characters in play`, () => {
      const b = board({ stolen: true });
      const action = mcPlay(b, x, { pl: [factionIdOf(b.engine, P2)] });
      const [cs, ...rest] = pickSteps(b, action);
      assert.equal(rest.length, 0);
      assert.equal(cs.requirement.id, "cs");
      assert.equal(cs.requirement.count, x);
      assert.deepEqual(sorted(cs.candidates), idsOf(b, ["o0", "o1", "o2", "o3"]));
      assert.deepEqual(sorted(b.engine.getPickCandidates(action as never, "cs")), idsOf(b, ["o0", "o1", "o2", "o3"]));
      assert.equal(cs.min, x);
      assert.equal(cs.max, x);
      assert.equal(cs.forced, false);
    });

    test(`X = ${x}, player = me: only the characters I control, a stolen one included`, () => {
      const b = board({ stolen: true });
      const action = mcPlay(b, x, { pl: [factionIdOf(b.engine, P1)] });
      const [cs] = pickSteps(b, action);
      assert.deepEqual(sorted(cs.candidates), idsOf(b, ["m0", "m1", "stolen"]));
    });
  }

  test("X = 0: nothing more to pick once the player is named, and the play is accepted", () => {
    const b = board();
    for (const who of [P1, P2]) {
      const action = mcPlay(b, 0, { pl: [factionIdOf(b.engine, who)] });
      assert.deepEqual(b.engine.getPlayRequirements(action), []);
      assert.deepEqual(b.engine.checkAction(action), { ok: true });
    }
  });

  test("walking the queries to the end builds an action the engine accepts and plays", () => {
    for (const x of [1, 2]) {
      const b = board();
      let action = mcPlay(b, x);
      for (let guard = 0; guard < 6; guard++) {
        const next = b.engine.getPlayRequirements(action)[0];
        if (!next) break;
        assert.equal(next.kind, "pick");
        const step = next as PickStep;
        const cardIds = chooseCards(b.engine, step, "max");
        action = answerPlayRequirement(action, { kind: "pick", id: step.requirement.id, cardIds });
      }
      assert.deepEqual(b.engine.checkAction(action), { ok: true });
      b.engine.perform(action as never);
      resolvePendingResponses(b.engine);
      assert.equal(b.engine.state.cards[b.id("mc")].zone, "discard");
    }
  });

  test("playing it at X = 2 on the opponent deals Y = their characters minus mine, divided as chosen", () => {
    const b = board();
    // Opponent controls 4 characters, I control 2: Y = 2.
    b.engine.perform({
      ...mcPlay(b, 2, { pl: [factionIdOf(b.engine, P2)], cs: [b.id("o0"), b.id("o1")] })
    } as never);
    resolvePendingResponses(b.engine);
    const pending = b.engine.state.pendingChoice as { kind: string; playerId: string; amount?: number } | undefined;
    assert.equal(pending?.kind, "distributeAmong");
    assert.equal(pending?.amount, 2);
    b.engine.perform({
      type: "resolvePendingChoice",
      playerId: pending!.playerId,
      choice: { kind: "distributeAmong", shares: { [b.id("o0")]: 1, [b.id("o1")]: 1 } }
    } as never);
    resolvePendingResponses(b.engine);
    assert.deepEqual(
      ["o0", "o1", "o2", "o3", "m0", "m1"].map(key => b.engine.state.cards[b.id(key)].damage),
      [1, 1, 0, 0, 0, 0]
    );
  });
});

describe("Mass Confusion: negative control", () => {
  test("a character of the other player, an item, and the faction are refused for the picked player", () => {
    const b = board();
    const opponent = factionIdOf(b.engine, P2);
    const refused = (selected: Record<string, CardInstanceId[]>, x = 1) => {
      const verdict = b.engine.checkAction(mcPlay(b, x, selected));
      assert.equal(verdict.ok, false, JSON.stringify(selected));
    };
    refused({ pl: [opponent], cs: [b.id("m0")] });
    refused({ pl: [opponent], cs: [b.id("oitem")] });
    refused({ pl: [opponent], cs: [factionIdOf(b.engine, P2)] });
    refused({ pl: [factionIdOf(b.engine, P1)], cs: [b.id("o0")] });
    refused({ pl: [opponent], cs: [b.id("o0"), b.id("m0")] }, 2);
    refused({ pl: [opponent], cs: [b.id("o0")] }, 2);
    assert.deepEqual(b.engine.checkAction(mcPlay(b, 1, { pl: [opponent], cs: [b.id("o0")] })), { ok: true });
    assert.deepEqual(b.engine.checkAction(mcPlay(b, 2, { pl: [opponent], cs: [b.id("o0"), b.id("o3")] })), { ok: true });
  });
});

// Every card whose pick is judged against an earlier pick's player: the same `ownerOf` / `controllerOf` a
// `selected` pick shape, in a selector's conditions or its `owner` / `controller`.
const readsEarlierPicksPlayer = (node: unknown): boolean => {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(readsEarlierPicksPlayer);
  const record = node as Record<string, unknown>;
  const target = record.target as { type?: string; id?: string } | undefined;
  if ((record.type === "ownerOf" || record.type === "controllerOf") && target?.type === "selected" && target.id !== "__candidate") return true;
  return Object.values(record).some(readsEarlierPicksPlayer);
};
const declarationsOf = (node: unknown, found: Array<{ id: string; selector: unknown }> = []): Array<{ id: string; selector: unknown }> => {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const entry of node) declarationsOf(entry, found);
    return found;
  }
  const record = node as { id?: unknown; selector?: unknown };
  if (typeof record.id === "string" && record.selector && ("count" in record || "optional" in record)) {
    found.push({ id: record.id, selector: record.selector });
  }
  for (const value of Object.values(record)) declarationsOf(value, found);
  return found;
};

describe("every card that judges a pick by an earlier pick's player answers the queries", () => {
  const cards = CATALOG.filter(
    definition =>
      definition.type !== "faction" &&
      declarationsOf(definition.behavior).some(declaration => readsEarlierPicksPlayer(declaration.selector))
  );

  test("the cards found are the ones with this shape", () => {
    assert.ok(cards.length >= 10, `found ${cards.length}: ${cards.map(card => card.name).join(", ")}`);
    const names = new Set(cards.map(card => card.name));
    for (const name of ["Mass Confusion", "Demolition Investment", "Engorged Sarcophyle", "Arcane Monkey Ritual", "Arrakis Eternity"]) {
      assert.ok(names.has(name), name);
    }
  });

  test("no query throws at any X, before and after each pick", () => {
    const failures: string[] = [];
    let walked = 0;
    const walk = (label: string, make: () => { engine: SpoilsEngine; start: PlayAction }): void => {
      for (const x of [0, 1, 2]) {
        try {
          const { engine, start } = make();
          let action: PlayAction = start;
          for (let guard = 0; guard < 12; guard++) {
            engine.checkAction(action);
            const next = engine.getPlayRequirements(action)[0];
            if (!next) break;
            switch (next.kind) {
              case "variables":
                action = answerPlayRequirement(action, {
                  kind: "variables",
                  values: Object.fromEntries(next.variables.map(variable => [variable.id, Math.max(variable.min, Math.min(variable.max, x))]))
                });
                break;
              case "pick":
                action = answerPlayRequirement(action, {
                  kind: "pick",
                  id: next.requirement.id,
                  cardIds: chooseCards(engine, next, "max"),
                  declined: next.declinable && next.candidates.length === 0
                });
                break;
              case "mode":
                action = answerPlayRequirement(action, { kind: "mode", index: next.options[0].index });
                break;
              default:
                action = answerPlayRequirement(action, { kind: "flipUpOption", index: 0 });
            }
          }
          engine.checkAction(action);
          walked++;
        } catch (error) {
          failures.push(`${label} X=${x}: ${(error as Error).message}`);
        }
      }
    };
    for (const definition of cards) {
      const label = `${definition.name} [${definition.set}]`;
      const modeCount = definition.behavior?.modes?.length ?? 0;
      const inHand = (): { engine: SpoilsEngine; id: (key: string) => CardInstanceId } =>
        richBoard([{ key: "card", def: definition, owner: P1, zone: "hand" } as CardPlacement]);
      for (let mode = 0; mode < Math.max(1, modeCount); mode++) {
        walk(`${label} play`, () => {
          const built = inHand();
          return { engine: built.engine, start: { ...playOf(P1, built.id("card")), ...(modeCount > 0 ? { mode } : {}) } as PlayAction };
        });
      }
      const activated = (definition.behavior?.abilities ?? []).filter((ability): ability is ActivatedAbility => ability.type === "activated");
      for (const ability of activated) {
        walk(`${label} ability ${ability.id}`, () => {
          const built = richBoard([{ key: "card", def: definition, owner: P1, zone: "play" } as CardPlacement]);
          return { engine: built.engine, start: abilityOf(P1, built.id("card"), ability.id) };
        });
      }
    }
    assert.deepEqual(failures, []);
    assert.ok(walked > 30, `walked ${walked} plays`);
  });
});

describe("the driver game that found it", () => {
  // Slot 0, seed 2 of scripts/record-replays.ts.
  const slotSetup = (slot: number, seed: number) => {
    const nf = ELIGIBLE_FACTIONS.length;
    const ns = SET_NAMES.length;
    return randomSetup(seed, {
      factions: [ELIGIBLE_FACTIONS[slot % nf], ELIGIBLE_FACTIONS[(slot + 13 + Math.floor(slot / nf)) % nf]],
      featuredSets: [SET_NAMES[slot % ns], SET_NAMES[(slot * 5 + 3 + Math.floor(slot / ns)) % ns]]
    });
  };

  test("random play of slot 0 / seed 2 no longer ends in an engine finding", () => {
    const seed = 2;
    const result = playRandomGame(JSON.parse(JSON.stringify(slotSetup(0, seed))), Math.imul(seed, 2654435761) >>> 0, { maxActions: 450 });
    assert.notEqual(result.status, "finding", result.status === "finding" ? JSON.stringify(result.finding) : "");
  });
});
