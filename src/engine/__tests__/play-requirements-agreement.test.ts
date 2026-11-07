// The read-only queries agree with `perform()`.
//
// For a spread of REAL catalog cards, the action built from `getPlayRequirements` answers is accepted by
// `checkAction` (a `perform` on a probe copy), and an answer outside the offered candidates is refused. Also:
// `checkAction` and `previewNumber` leave the live game alone (state, `rngState`, log), and
// `getPlayRequirements` does not throw for any card of the catalog.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { answerPlayRequirement } from "../../engine.js";
import type { ActivatedAbility, CardDefinition, CardInstanceId, NumberExpression, PickStep, PlayAction, SpoilsEngine } from "../../engine.js";
import cardsJson from "../../data/cards.js";
import { bank, cardDef, developFaction } from "./per-card/_harness.js";
import { character, item, tactic } from "./support/fixtures.js";
import { abilityOf as unboundAbilityOf, completePlay, playOf as unboundPlayOf, richBoard, P1, P2 } from "./support/requirements-kit.js";
import type { CardPlacement } from "./support/fixtures.js";

const CATALOG = cardsJson as CardDefinition[];

// These queries and checks bypass the table-mode wrapper's `perform`, so each play names its opponent (the other
// original player) itself: left unbound, a bigger table would first ask which opponent the play is about.
const opponentOf = (playerId: string) => (playerId === P1 ? P2 : P1);
const playOf = (playerId: string, cardId: CardInstanceId): PlayAction => ({ ...unboundPlayOf(playerId, cardId), opponentId: opponentOf(playerId) });
const abilityOf = (playerId: string, cardId: CardInstanceId, abilityId: string): PlayAction => ({
  ...unboundAbilityOf(playerId, cardId, abilityId),
  opponentId: opponentOf(playerId)
});

type Built = ReturnType<typeof richBoard>;

interface Case {
  label: string;
  /** Real card (set, name). */
  card: [set: string, name: string];
  /** Where it starts: in the hand to be played, or in play to use an ability. */
  start: "hand" | "play";
  abilityId?: string;
  /** Extra placements and tweaks for the position. */
  extra?: (place: (key: string, def: CardDefinition, over?: Partial<CardPlacement>) => void) => void;
  /** What the first requirements must look like, so the case is the one it claims to be. */
  expects: (asked: Array<{ kind: string; step?: PickStep }>) => void;
}

const steps = (asked: Array<{ kind: string; step?: PickStep }>) => asked.filter((entry) => entry.step).map((entry) => entry.step!);

const CASES: Case[] = [
  {
    label: "Rapine: a sacrifice, then a pick judged after it",
    card: ["1st Edition", "Rapine"],
    start: "hand",
    expects: (asked) => {
      const [sac, target] = steps(asked);
      assert.deepEqual([sac.requirement.id, target.requirement.id], ["sac", "c"]);
      assert.equal(target.requirement.afterCost, true);
      assert.ok(target.blocked.length >= 1, "the card the cost destroys is held back");
    }
  },
  {
    label: "Tri-Pole Magnet (played): an attach-to pick",
    card: ["1st Edition", "Tri-Pole Magnet"],
    start: "hand",
    expects: (asked) => assert.equal(steps(asked)[0].requirement.id, "attachTo")
  },
  {
    label: "Tri-Pole Magnet (grapple): a forced pick, then a pick after the cost",
    card: ["1st Edition", "Tri-Pole Magnet"],
    start: "play",
    abilityId: "grapple",
    extra: (place) => place("magnet-host", character({ name: "Host" }), { owner: P1 }),
    expects: (asked) => {
      const [g, host] = steps(asked);
      assert.equal(g.requirement.id, "g");
      assert.equal(g.forced, true);
      assert.equal(host.requirement.id, "host");
    }
  },
  {
    label: "Mephitic Nullifier (flash-bang): destroy this card, then pick one of yours",
    card: ["1st Edition", "Mephitic Nullifier"],
    start: "play",
    abilityId: "mephitic-nullifier-flash-bang",
    expects: (asked) => {
      const [target] = steps(asked);
      assert.equal(target.requirement.afterCost, true);
      assert.equal(target.blocked.length, 1, "this card is destroyed first");
    }
  },
  {
    label: "Sharpey Pointy Lethal Army Tool: attachToController",
    card: ["Shade of the Devoured Emperor", "Sharpey Pointy Lethal Army Tool"],
    start: "hand",
    expects: (asked) => {
      const [attach] = steps(asked);
      assert.equal(attach.requirement.id, "attachTo");
      assert.equal(attach.candidates.length, 3, "only your own characters");
    }
  },
  {
    label: "Hammer Smash: the random-sized pick is the engine's",
    card: ["1st Edition", "Hammer Smash"],
    start: "hand",
    expects: (asked) => assert.deepEqual(asked, [])
  },
  {
    label: "Miraculous Regeneration: two picks that must differ (distinctPicks)",
    card: ["Seed 2", "Miraculous Regeneration"],
    start: "hand",
    expects: (asked) => {
      const [first, second] = steps(asked);
      assert.equal(first.requirement.distinctPicks, true);
      assert.ok(second.blocked.length >= 1, "the first pick is held back from the second");
    }
  },
  {
    label: "Delectable Boon: X, then two picks that must differ",
    card: ["Seed 2", "Delectable Boon"],
    start: "hand",
    expects: (asked) => assert.equal(asked[0].kind, "variables")
  },
  {
    label: "Tedious TriAdic Truculence: three characters with different names",
    card: ["Shade of the Devoured Emperor", "Tedious TriAdic Truculence"],
    start: "hand",
    expects: (asked) => {
      const [picks] = steps(asked);
      assert.equal(picks.distinctNames, true);
      assert.equal(picks.min, 3);
    }
  },
  {
    label: "Defenders of Marduun (rally): three characters of different trades",
    card: ["Seed Saga", "Defenders of Marduun"],
    start: "play",
    abilityId: "defenders-rally",
    expects: (asked) => {
      const [picks] = steps(asked);
      assert.equal(picks.distinctTrades, true);
      assert.equal(picks.min, 3);
    }
  },
  {
    label: "Overindulge: a mode, then its pick",
    card: ["Seed", "Overindulge"],
    start: "hand",
    expects: (asked) => assert.equal(asked[0].kind, "mode")
  },
  {
    label: "Cash Out: choose a number",
    card: ["1st Edition", "Cash Out"],
    start: "hand",
    expects: (asked) => assert.equal(asked[0].kind, "variables")
  },
  {
    label: "Micromajig Avalanche: choose a bounded number",
    card: ["1st Edition", "Micromajig Avalanche"],
    start: "hand",
    expects: (asked) => assert.equal(asked[0].kind, "variables")
  },
  {
    label: "I Drink Your Milkshake!: an optional search of the opponent's deck",
    card: ["Seed 2", "I Drink Your Milkshake!"],
    start: "hand",
    expects: (asked) => {
      const [dig] = steps(asked);
      assert.equal(dig.declinable, true);
      assert.equal(dig.min, 0);
    }
  },
  {
    label: "Profane Proposal: a forced pick (their faction)",
    card: ["Holy Heist", "Profane Proposal"],
    start: "hand",
    expects: (asked) => assert.equal(steps(asked)[0].forced, true)
  },
  {
    label: "Tad Disingenuous (deal): a cost that takes a card from the hand",
    card: ["1st Edition Part 2", "Tad Disingenuous"],
    start: "play",
    abilityId: "deal",
    expects: (asked) => assert.ok(steps(asked).length >= 1)
  }
];

function build(testCase: Case): { built: Built; action: PlayAction } {
  const [set, name] = testCase.card;
  const definition = cardDef(set, name);
  const placements: CardPlacement[] = [];
  const place = (key: string, def: CardDefinition, over: Partial<CardPlacement> = {}) => {
    placements.push({ key, def, owner: P1, ...over });
  };
  testCase.extra?.(place);
  const isFaction = definition.type === "faction";
  const attachedKey = testCase.start === "play" && definition.attachTo ? "magnet-host" : undefined;
  if (!isFaction) {
    placements.push({
      key: "card",
      def: definition,
      owner: P1,
      zone: testCase.start,
      ...(attachedKey ? { attachedToKey: attachedKey } : {})
    });
  }
  const built = richBoard(placements, isFaction ? { playerA: { faction: definition } } : {});
  const cardId = isFaction ? built.engine.state.players[P1].factionId! : built.id("card");
  return { built, action: testCase.abilityId ? abilityOf(P1, cardId, testCase.abilityId) : playOf(P1, cardId) };
}

/** Cards that are not among `offered`, taken from the whole game, to stand in for an illegal answer. */
const outsiders = (engine: SpoilsEngine, offered: readonly CardInstanceId[], count: number, not: CardInstanceId): CardInstanceId[] =>
  Object.keys(engine.state.cards)
    .filter((id) => !offered.includes(id) && id !== not)
    .slice(0, count);

describe("getPlayRequirements agrees with perform on real cards", () => {
  for (const testCase of CASES) {
    for (const strategy of ["min", "max"] as const) {
      test(`${testCase.label} (${strategy})`, () => {
        const { built, action } = build(testCase);
        const { engine } = built;
        const { action: finished, asked } = completePlay(engine, action, strategy);
        testCase.expects(asked.map((requirement) => ({ kind: requirement.kind, ...(requirement.kind === "pick" ? { step: requirement } : {}) })));

        // 1. What the requirements led to is accepted.
        const verdict = engine.checkAction(finished);
        assert.deepEqual(verdict, { ok: true }, `the engine refused the action the requirements built: ${JSON.stringify(verdict)}`);
        assert.deepEqual(engine.getPlayRequirements(finished), [], "nothing is left to ask");

        // 2. An answer outside what was offered is refused.
        for (const step of steps(asked.map((requirement) => ({ kind: requirement.kind, ...(requirement.kind === "pick" ? { step: requirement } : {}) })))) {
          const wrong = outsiders(engine, [...step.candidates], Math.max(1, step.min), finished.cardId);
          if (wrong.length < Math.max(1, step.min)) continue;
          const refused = engine.checkAction(answerPlayRequirement(finished, { kind: "pick", id: step.requirement.id, cardIds: wrong }));
          assert.equal(refused.ok, false, `an answer outside the candidates of '${step.requirement.id}' was accepted`);
          // ...and so is a card the picker was told is blocked.
          if (step.blocked.length >= Math.max(1, step.min) && step.requirement.source === "target") {
            const held = engine.checkAction(
              answerPlayRequirement(finished, { kind: "pick", id: step.requirement.id, cardIds: step.blocked.slice(0, Math.max(1, step.min)) })
            );
            assert.equal(held.ok, false, `a blocked card was accepted for '${step.requirement.id}'`);
          }
        }

        // 3. Every card offered for the LAST single pick is accepted on its own (nothing after it depends on it).
        const last = steps(asked.map((requirement) => ({ kind: requirement.kind, ...(requirement.kind === "pick" ? { step: requirement } : {}) }))).slice(-1)[0];
        if (last && last.min === 1 && last.max === 1 && !last.requirement.distinctPicks && last.requirement.source === "target") {
          for (const candidate of last.candidates) {
            const verdictOne = engine.checkAction(answerPlayRequirement(finished, { kind: "pick", id: last.requirement.id, cardIds: [candidate] }));
            assert.deepEqual(verdictOne, { ok: true }, `offered card ${candidate} for '${last.requirement.id}' was refused`);
          }
        }
      });
    }
  }

  test("an optional search can be declined or answered with a card, and both are accepted", () => {
    const { built, action } = build(CASES.find((c) => c.card[1] === "I Drink Your Milkshake!")!);
    const { engine } = built;
    const [dig] = engine.getPlayRequirements(action) as PickStep[];
    const declined = answerPlayRequirement(action, { kind: "pick", id: dig.requirement.id, cardIds: [], declined: true });
    const found = answerPlayRequirement(action, { kind: "pick", id: dig.requirement.id, cardIds: [dig.candidates[0]] });
    assert.deepEqual(engine.checkAction(declined), { ok: true });
    assert.deepEqual(engine.checkAction(found), { ok: true });
    assert.deepEqual(engine.getPlayRequirements(declined), []);
  });

  test("a mode and a number the card asks for are exactly what the engine demands", () => {
    // Overindulge without a mode, Cash Out without X: refused with the engine's own words.
    const modal = build(CASES.find((c) => c.card[1] === "Overindulge")!);
    assert.match((modal.built.engine.checkAction(modal.action) as { error: string }).error, /modal/);
    const x = build(CASES.find((c) => c.card[1] === "Cash Out")!);
    assert.match((x.built.engine.checkAction(x.action) as { error: string }).error, /choose a number for X/i);
  });
});

describe("checkAction leaves the live game alone", () => {
  /** The whole live game, as it would be saved: state (rngState and log included) plus the trigger queue. */
  const fingerprint = (engine: SpoilsEngine) => JSON.stringify({ state: engine.state, queue: engine.immediateQueue });

  function seeded() {
    // An action that flips a coin (Hammer Smash), one that shuffles a deck (an optional search), and a plain one.
    const smash = cardDef("1st Edition", "Hammer Smash");
    const milkshake = cardDef("Seed 2", "I Drink Your Milkshake!");
    const built = richBoard([
      { key: "smash", def: smash, owner: P1, zone: "hand" },
      { key: "shake", def: milkshake, owner: P1, zone: "hand" },
      { key: "i1", def: item({ name: "Some Item" }), owner: P2 }
    ]);
    built.engine.state.rngState = 20261021;
    return { ...built, idSeq: built.engine.state.idSeq };
  }

  test("accepting, refusing, rolling and shuffling actions change nothing, rngState included", () => {
    const { engine, id } = seeded();
    const before = fingerprint(engine);
    const rngBefore = engine.state.rngState;

    const smash = engine.checkAction(playOf(P1, id("smash")));
    assert.deepEqual(smash, { ok: true }, "opens the follow-up pick on the copy");
    const [dig] = engine.getPlayRequirements(playOf(P1, id("shake"))) as PickStep[];
    const shuffled = engine.checkAction({ ...playOf(P1, id("shake")), selected: { [dig.requirement.id]: [dig.candidates[0]] } });
    assert.deepEqual(shuffled, { ok: true });
    const refused = engine.checkAction({ type: "playCard", playerId: P2, cardId: id("smash") });
    assert.equal(refused.ok, false);
    const endTurn = engine.checkAction({ type: "endTurn", playerId: P1 });
    assert.ok(endTurn.ok === true || typeof endTurn.error === "string");

    assert.equal(engine.state.rngState, rngBefore, "the random stream did not move");
    assert.equal(fingerprint(engine), before, "nothing about the live game changed");
  });

  test("the live game then plays on exactly as one that was never asked", () => {
    const asked = seeded();
    const control = seeded();
    for (let round = 0; round < 3; round++) {
      asked.engine.checkAction(playOf(P1, asked.id("smash")));
      asked.engine.checkAction({ ...playOf(P1, asked.id("shake")), selected: {} });
      asked.engine.getPlayRequirements(playOf(P1, asked.id("shake")));
      asked.engine.previewNumber({ type: "random", min: 1, max: 6 }, { sourceId: asked.id("smash"), controllerId: P1, selected: {} });
    }
    for (const built of [asked, control]) {
      built.engine.perform(playOf(P1, built.id("smash")));
    }
    assert.equal(asked.engine.state.rngState, control.engine.state.rngState);
    const prompt = (built: ReturnType<typeof seeded>) => {
      const pending = built.engine.state.pendingChoice;
      assert.equal(pending?.kind, "selectDeployTargets");
      return pending?.kind === "selectDeployTargets" ? pending.variables : undefined;
    };
    assert.deepEqual(prompt(asked), prompt(control), "the same roll, so the same prompt");
    assert.equal(asked.engine.state.gameLog.length, control.engine.state.gameLog.length, "the same log");
    assert.equal(
      asked.engine.state.idSeq - asked.idSeq,
      control.engine.state.idSeq - control.idSeq,
      "no ids were minted by the questions"
    );
  });

  test("a pending choice can be checked with the trigger queue it waits on", () => {
    const { engine, id } = seeded();
    engine.perform(playOf(P1, id("smash")));
    const pending = engine.state.pendingChoice;
    assert.equal(pending?.kind, "selectDeployTargets");
    const before = fingerprint(engine);
    assert.deepEqual(
      engine.checkAction({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: [id("i1")] } } }),
      { ok: true }
    );
    assert.equal(
      engine.checkAction({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: [id("a1")] } } }).ok,
      false,
      "a character is not an item"
    );
    assert.equal(fingerprint(engine), before);
    // Any other action while the choice is open is refused, with the engine's words.
    assert.match((engine.checkAction({ type: "endTurn", playerId: P1 }) as { error: string }).error, /pending choice/i);
  });
});

describe("previewNumber", () => {
  const context = (engine: SpoilsEngine, sourceId: CardInstanceId) => ({ sourceId, controllerId: P1, selected: {}, variables: { x: 4 } });
  const board = () => {
    const built = richBoard();
    built.engine.state.rngState = 777;
    return built;
  };

  test("reads a number without touching anything", () => {
    const { engine, id } = board();
    const before = JSON.stringify(engine.state);
    const ctx = context(engine, id("a1"));
    assert.equal(engine.previewNumber(3, ctx), 3);
    assert.equal(engine.previewNumber({ type: "variable", id: "x" }, ctx), 4);
    assert.equal(
      engine.previewNumber({ type: "add", values: [2, { type: "variable", id: "x" }] }, ctx),
      6
    );
    assert.equal(
      engine.previewNumber({ type: "count", selector: { controller: "self", zone: "play", type: "character" } }, ctx),
      3,
      "reads the board: Ann, Bo and Cy"
    );
    assert.equal(
      engine.previewNumber({ type: "conditional", if: { type: "numberCompare", left: 1, operator: "<", right: 2 }, then: 5, else: 9 }, ctx),
      5
    );
    assert.equal(JSON.stringify(engine.state), before);
  });

  test("returns undefined for anything that rolls, however deep, and does not move the random stream", () => {
    const { engine, id } = board();
    const ctx = context(engine, id("a1"));
    const rolls: NumberExpression[] = [
      { type: "random", min: 1, max: 6 },
      { type: "coinFlip", win: 2, lose: 1 },
      { type: "add", values: [1, { type: "random", min: 1, max: 6 }] },
      { type: "multiply", values: [{ type: "coinFlip", win: 2, lose: 1 }, 3] },
      { type: "divide", value: 8, by: { type: "random", min: 1, max: 2 }, rounding: "down" }
    ];
    const rngBefore = engine.state.rngState;
    const logBefore = engine.state.gameLog.length;
    for (const expression of rolls) {
      assert.equal(engine.previewNumber(expression, ctx), undefined, JSON.stringify(expression));
    }
    assert.equal(engine.state.rngState, rngBefore);
    assert.equal(engine.state.gameLog.length, logBefore, "no coinFlipped event either");
  });

  test("evaluateNumber on the live engine is the thing it replaces: it eats the random stream", () => {
    const { engine, id } = board();
    const ctx = context(engine, id("a1"));
    const rngBefore = engine.state.rngState;
    engine.evaluateNumber({ type: "random", min: 1, max: 6 }, ctx);
    assert.notEqual(engine.state.rngState, rngBefore);
    const mark = engine.state.rngState;
    engine.previewNumber({ type: "random", min: 1, max: 6 }, ctx);
    assert.equal(engine.state.rngState, mark);
  });

  test("an expression that cannot be read yet is undefined, not a throw", () => {
    const { engine } = board();
    assert.equal(engine.previewNumber({ type: "selectionCount", id: "t" }, {} as never), undefined);
  });
});

describe("getPlayRequirements is total over the real card catalog", () => {
  const abilitiesOf = (definition: CardDefinition): ActivatedAbility[] =>
    [...(definition.behavior?.abilities ?? []), ...(definition.faction?.abilities ?? [])].filter(
      (ability): ability is ActivatedAbility => ability.type === "activated"
    );

  test("no card in hand, no mode, no ability and no FLIP UP makes it throw, and every answer makes progress", () => {
    const failures: string[] = [];
    let plays = 0;
    let abilities = 0;
    let flips = 0;
    const attempt = (label: string, run: () => void): void => {
      try {
        run();
      } catch (error) {
        failures.push(`${label}: ${(error as Error).message}`);
      }
    };
    for (const definition of CATALOG) {
      if (definition.type === "faction") continue;
      const modeCount = definition.behavior?.modes?.length ?? 0;
      attempt(`${definition.name} [${definition.set}] play`, () => {
        const built = richBoard([{ key: "card", def: definition, owner: P1, zone: "hand" }]);
        const start = playOf(P1, built.id("card"));
        completePlay(built.engine, start, "max");
        completePlay(built.engine, start, "min");
        for (let mode = 0; mode < modeCount; mode++) {
          completePlay(built.engine, { ...start, mode } as PlayAction, "max");
        }
        plays++;
      });
      const activated = abilitiesOf(definition);
      if (activated.length > 0) {
        attempt(`${definition.name} [${definition.set}] abilities`, () => {
          const built = richBoard([{ key: "card", def: definition, owner: P1, zone: "play" }]);
          for (const ability of activated) {
            completePlay(built.engine, abilityOf(P1, built.id("card"), ability.id), "max");
            abilities++;
          }
        });
      }
      if (definition.flipUp) {
        attempt(`${definition.name} [${definition.set}] flipUp`, () => {
          const built = richBoard([{ key: "card", def: definition, owner: P1, zone: "play", faceDown: true }]);
          const start: PlayAction = { type: "flipUp", playerId: P1, cardId: built.id("card") };
          completePlay(built.engine, start, "max");
          for (let mode = 0; mode < modeCount; mode++) completePlay(built.engine, { ...start, mode }, "min");
          flips++;
        });
      }
    }
    for (const faction of CATALOG.filter((definition) => definition.type === "faction" && abilitiesOf(definition).length > 0)) {
      attempt(`${faction.name} [${faction.set}] faction abilities`, () => {
        const built = richBoard([], { playerA: { faction } });
        const cardId = built.engine.state.players[P1].factionId!;
        for (const ability of abilitiesOf(faction)) {
          completePlay(built.engine, abilityOf(P1, cardId, ability.id), "max");
          abilities++;
        }
      });
    }
    assert.deepEqual(failures.slice(0, 20), []);
    assert.ok(plays > 1500 && abilities > 500 && flips > 50, `swept ${plays} plays, ${abilities} abilities, ${flips} FLIP UPs`);
  });
});

describe("the engine never refuses a pick the queries offered, over the real catalog", () => {
  test("every completed play and ability use is free of pick, target and distinct refusals", () => {
    const refusal = /Illegal|requires \d|different|must include|same card|selection/;
    const mismatches: string[] = [];
    let checked = 0;
    const probe = (label: string, built: Built, start: PlayAction, strategy: "min" | "max"): void => {
      const { action, asked } = completePlay(built.engine, start, strategy);
      const picks = asked.filter((requirement): requirement is PickStep => requirement.kind === "pick");
      // A mandatory pick the board cannot fill is the player's problem, and the engine says so; skip those.
      const fillable = picks.every((pick) => pick.min === 0 || pick.candidates.length >= pick.requirement.count);
      const verdict = built.engine.checkAction(action);
      checked++;
      if (!verdict.ok && fillable && refusal.test(verdict.error)) {
        mismatches.push(`${label} [${strategy}]: ${verdict.error}`);
      }
    };
    for (const definition of CATALOG) {
      if (definition.type === "faction") continue;
      const inHand = richBoard([{ key: "card", def: definition, owner: P1, zone: "hand" }]);
      for (const strategy of ["min", "max"] as const) probe(`${definition.name} [${definition.set}] play`, inHand, playOf(P1, inHand.id("card")), strategy);
      const activated = (definition.behavior?.abilities ?? []).filter((ability): ability is ActivatedAbility => ability.type === "activated");
      if (activated.length > 0) {
        const inPlay = richBoard([{ key: "card", def: definition, owner: P1, zone: "play" }]);
        for (const ability of activated) {
          for (const strategy of ["min", "max"] as const) {
            probe(`${definition.name} [${definition.set}] ability ${ability.id}`, inPlay, abilityOf(P1, inPlay.id("card"), ability.id), strategy);
          }
        }
      }
    }
    assert.deepEqual(mismatches.slice(0, 20), []);
    assert.ok(checked > 5000, `checked ${checked} actions`);
  });
});

// Keep these imports referenced for the type-only helpers above.
void [bank, developFaction, tactic];
