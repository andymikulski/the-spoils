// More read-only queries for clients.
//
//   Q1  checkSelection / checkPlaySelection      the engine's own validation of one pick
//   Q2  getPlaySelectionInput                    a card's own play block as a SelectionRequirementsInput
//   Q3  getResourcePlayFaces / canPlayResource*  the playResourceCard face rules for any card
//   Q4  getMulliganLimit                         how many cards a seat may send back, before its turn too
//   Q5  previewBlockOptions                      getBlockOptions for a hypothetical attack
//   Q6  DeckConstructionIssue count / max        on a copyLimit issue
//
// Every test is an AGREEMENT test: the query's answer is compared with what perform() does with the same thing
// on a probe copy of the game (real catalog cards where the audit names them).
//
// NOTE: this file must not import clauses/_clause.js or clauses/_battle.js: the clause suite patches
// `SpoilsEngine.prototype.perform` to answer prompts by itself, and these tests are about those prompts.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SpoilsEngine, answerPlayRequirement, findDeckConstructionIssues, isStapleResourceDefinition } from "../../engine.js";
import type {
  AttackTarget,
  BlockOptions,
  CardDefinition,
  CardInstanceId,
  GameAction,
  PendingChoice,
  PickStep,
  PlayAction,
  PlayerId,
  SelectionCheck,
  SelectionRequirementsInput
} from "../../engine.js";
import cardsJson from "../../data/cards.js";
import {
  bank,
  buildGame,
  cardDef,
  character,
  developFaction,
  factionCard,
  item,
  location,
  play,
  resourceCard,
  resolvePendingResponses,
  tactic,
  P1,
  P2
} from "./per-card/_harness.js";
import { defaultFactionDefinition } from "./support/fixtures.js";
import type { CardPlacement } from "./support/fixtures.js";
import { abilityOf, completePlay, playOf, richBoard } from "./support/requirements-kit.js";
import { setupGame } from "./clauses/_turn.js";
import { developPlay, openDevelop } from "./support/develop.js";

const CATALOG = cardsJson as CardDefinition[];

/** The whole live game as it would be saved, plus the trigger queue and the log length. */
const fingerprint = (engine: SpoilsEngine): string =>
  JSON.stringify({ state: engine.state, queue: engine.immediateQueue, log: engine.state.gameLog.length });

/** The query's verdict equals perform's on the same answer: same yes / no, and the same words when both refuse. */
function sameVerdict(label: string, query: SelectionCheck, real: { ok: true } | { ok: false; error: string }, words = true): void {
  assert.equal(query.ok, real.ok, `${label}: checkSelection says ${JSON.stringify(query)}, perform says ${JSON.stringify(real)}`);
  if (words && !query.ok && !real.ok) assert.equal(query.error, real.error, `${label}: the same words`);
}

/** The play with one pick's answer replaced. */
const withPick = (action: PlayAction, id: string, cardIds: CardInstanceId[]): PlayAction =>
  answerPlayRequirement(action, { kind: "pick", id, cardIds });

// ---------------------------------------------------------------------------
// Q1: checkSelection / checkPlaySelection
// ---------------------------------------------------------------------------

describe("Q1 checkPlaySelection agrees with perform on a probe", () => {
  /** Every variant is run through the query and through perform; both must say the same. Returns the verdicts. */
  function agree(
    engine: SpoilsEngine,
    action: PlayAction,
    pickId: string,
    variants: Array<[label: string, cardIds: CardInstanceId[]]>,
    words = true
  ): Map<string, SelectionCheck> {
    const verdicts = new Map<string, SelectionCheck>();
    for (const [label, cardIds] of variants) {
      const query = engine.checkPlaySelection(action, pickId, cardIds);
      const real = engine.checkAction(withPick(action, pickId, cardIds));
      sameVerdict(`${pickId} / ${label}`, query, real, words);
      verdicts.set(label, query);
    }
    return verdicts;
  }

  test("distinct names: Tedious TriAdic Truculence ('Pick 3 characters', different names)", () => {
    const built = richBoard([
      { key: "ttt", def: cardDef("Shade of the Devoured Emperor", "Tedious TriAdic Truculence"), owner: P1, zone: "hand" },
      { key: "ann2", def: character({ name: "Ann", trade: "rogue", strength: 1, life: 4 }), owner: P2 }
    ]);
    const { engine, id } = built;
    const action = playOf(P1, id("ttt"));
    const before = fingerprint(engine);
    const verdicts = agree(engine, action, "picks", [
      ["three different names", [id("a1"), id("a2"), id("a3")]],
      ["across both sides", [id("a1"), id("b1"), id("b2")]],
      ["two cards share the name Ann", [id("a1"), id("ann2"), id("a2")]],
      ["too few", [id("a1"), id("a2")]],
      ["too many", [id("a1"), id("a2"), id("a3"), id("b1")]],
      ["none", []],
      ["a card twice", [id("a1"), id("a1"), id("a2")]],
      ["an item, not a character", [id("a1"), id("a2"), id("gear")]],
      ["a card out of play", [id("a1"), id("a2"), id("h1")]]
    ]);
    assert.equal(verdicts.get("three different names")!.ok, true);
    assert.equal(verdicts.get("across both sides")!.ok, true);
    const shared = verdicts.get("two cards share the name Ann")!;
    assert.equal(shared.ok, false);
    assert.match((shared as { error: string }).error, /different names/);
    assert.equal(verdicts.get("an item, not a character")!.ok, false);
    assert.equal(fingerprint(engine), before, "the live game is untouched");
  });

  test("distinct trades: Defenders of Marduun RALLY ('3 characters you control that don't share a trade')", () => {
    const defenders = cardDef("Seed Saga", "Defenders of Marduun");
    const built = richBoard(
      [{ key: "ann2", def: character({ name: "Ann Two", trade: "rogue", strength: 1, life: 4 }), owner: P1 }],
      { playerA: { faction: defenders } }
    );
    const { engine, id } = built;
    const factionId = engine.state.players[P1].factionId!;
    const action = abilityOf(P1, factionId, "defenders-rally");
    const [pick] = engine.getPlayRequirements(action) as PickStep[];
    assert.equal(pick.distinctTrades, true, "the engine says the trades must differ");
    const verdicts = agree(engine, action, pick.requirement.id, [
      ["rogue, banker, arcanist", [id("a1"), id("a2"), id("a3")]],
      ["two rogues", [id("a1"), id("ann2"), id("a2")]],
      ["one short", [id("a1"), id("a2")]],
      ["one of the opponent's", [id("a1"), id("a2"), id("b1")]]
    ]);
    assert.equal(verdicts.get("rogue, banker, arcanist")!.ok, true);
    const twoRogues = verdicts.get("two rogues")!;
    assert.equal(twoRogues.ok, false);
    assert.match((twoRogues as { error: string }).error, /share a trade/);
    assert.equal(verdicts.get("one of the opponent's")!.ok, false);
  });

  test("a card that must be picked (Ferrous Ferret) is required in an optional pick", () => {
    const pair = tactic({
      name: "Pair",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "pair",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 2, optional: true }],
            effects: []
          }
        ]
      }
    });
    const built = richBoard([
      { key: "pair", def: pair, owner: P1, zone: "hand" },
      { key: "ferret", def: cardDef("1st Edition", "Ferrous Ferret"), owner: P2 }
    ]);
    const { engine, id } = built;
    const action = playOf(P1, id("pair"));
    const [step] = engine.getPlayRequirements(action) as PickStep[];
    assert.equal(step.min, 1, "the engine raises the minimum while the Ferret can be picked");
    const verdicts = agree(engine, action, "t", [
      ["the Ferret alone", [id("ferret")]],
      ["the Ferret and another", [id("ferret"), id("a1")]],
      ["another without the Ferret", [id("a1")]],
      ["two others without the Ferret", [id("a1"), id("a2")]],
      ["none", []]
    ]);
    assert.equal(verdicts.get("the Ferret alone")!.ok, true);
    assert.equal(verdicts.get("another without the Ferret")!.ok, false);
    assert.equal(verdicts.get("none")!.ok, false);
  });

  test("a pick written after a cost step is judged after it (Rapine), and a pick before it is judged up front", () => {
    const built = richBoard([{ key: "rapine", def: cardDef("1st Edition", "Rapine"), owner: P1, zone: "hand" }]);
    const { engine, id } = built;
    const base = withPick(playOf(P1, id("rapine")), "sac", [id("a2")]);
    // 'c' is placed after the cost that destroys the sacrificed character.
    const afterCost = agree(engine, withPick(base, "c", [id("b1")]), "c", [
      ["an opposing character", [id("b1")]],
      ["the character the cost destroys", [id("a2")]],
      ["another of mine", [id("a1")]],
      ["an item", [id("bgear")]],
      ["none", []]
    ]);
    assert.equal(afterCost.get("an opposing character")!.ok, true);
    assert.equal(afterCost.get("the character the cost destroys")!.ok, false, "gone once the cost is paid");
    // 'sac' is judged up front; the answer to 'c' stays the opposing character.
    const upFront = agree(engine, withPick(base, "c", [id("b1")]), "sac", [
      ["my character", [id("a1")]],
      ["my item", [id("gear")]],
      ["an opposing character", [id("b2")]],
      ["two cards", [id("a1"), id("a2")]]
    ]);
    assert.equal(upFront.get("my item")!.ok, true);
    assert.equal(upFront.get("an opposing character")!.ok, false);
  });

  test("a cost step that takes cards is a pick too (Tad Disingenuous: discard a card)", () => {
    const built = richBoard([{ key: "tad", def: cardDef("1st Edition Part 2", "Tad Disingenuous"), owner: P1 }]);
    const { engine, id } = built;
    const action = abilityOf(P1, id("tad"), "deal");
    const [pick] = engine.getPlayRequirements(action) as PickStep[];
    assert.equal(pick.requirement.source, "discardCost");
    const verdicts = agree(
      engine,
      action,
      "d",
      [
        ["a card from my hand", [id("h1")]],
        ["a card from my discard pile", [id("d1")]],
        ["a card from the opponent's hand", [id("bh1")]],
        ["two cards", [id("h1"), id("h2")]],
        ["none", []],
        ["a card twice", [id("h1"), id("h1")]]
      ],
      false
    );
    assert.equal(verdicts.get("a card from my hand")!.ok, true);
    assert.match((verdicts.get("none") as { error: string }).error, /Discard cost 'd' requires selecting exactly 1 card/);
    assert.match((verdicts.get("a card from my discard pile") as { error: string }).error, /Illegal discard-cost selection/);
  });

  test("an unknown pick, a modal card with no mode and an ability the card lacks are answered, not thrown", () => {
    const built = richBoard([
      { key: "ttt", def: cardDef("Shade of the Devoured Emperor", "Tedious TriAdic Truculence"), owner: P1, zone: "hand" },
      { key: "over", def: cardDef("Seed", "Overindulge"), owner: P1, zone: "hand" }
    ]);
    const { engine, id } = built;
    const nothing = engine.checkPlaySelection(playOf(P1, id("ttt")), "nope", []);
    assert.equal(nothing.ok, false);
    assert.match((nothing as { error: string }).error, /no pick 'nope'/);
    const modal = engine.checkPlaySelection(playOf(P1, id("over")), "anything", []);
    assert.equal(modal.ok, false);
    assert.match((modal as { error: string }).error, /modal/);
    const noAbility = engine.checkPlaySelection(abilityOf(P1, id("ttt"), "missing"), "picks", []);
    assert.equal(noAbility.ok, false);
  });
});

describe("Q1 checkSelection agrees with resolvePendingChoice for a prompt's pick", () => {
  /** The prompt's pick as a SelectionRequirementsInput, the way a client builds it from the pending choice. */
  const inputOf = (pending: Extract<PendingChoice, { kind: "chooserSelectsTarget" }>): SelectionRequirementsInput => ({
    sourceId: pending.context.sourceId,
    controllerId: pending.context.controllerId,
    pickerId: pending.playerId,
    declarations: [pending.declaration],
    costs: [],
    selected: {},
    variables: {},
    context: pending.context
  });
  const answerOf = (pending: PendingChoice, cardIds: CardInstanceId[]): GameAction => ({
    type: "resolvePendingChoice",
    playerId: pending.playerId,
    choice: { kind: "chooserSelectsTarget", selected: cardIds }
  });

  test("distinct types: Goutflame Talonclaw ('a location, item and/or character')", () => {
    const game = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "talon", def: cardDef("Seed Saga", "Goutflame Talonclaw"), owner: P1, zone: "hand" },
        ...bank("rage", 9, P1),
        { key: "ch1", def: character({ name: "Ch One" }), owner: P2 },
        { key: "ch2", def: character({ name: "Ch Two" }), owner: P2 },
        { key: "it", def: item({ name: "It" }), owner: P2 },
        { key: "loc", def: location({ name: "Loc" }), owner: P2 }
      ]
    });
    play(game.engine, P1, game.id("talon"));
    const pending = game.engine.state.pendingChoice as Extract<PendingChoice, { kind: "chooserSelectsTarget" }>;
    assert.equal(pending?.kind, "chooserSelectsTarget");
    const input = inputOf(pending);
    const before = fingerprint(game.engine);
    const variants: Array<[string, CardInstanceId[], boolean]> = [
      ["one of each type", [game.id("ch1"), game.id("it"), game.id("loc")], true],
      ["two types", [game.id("it"), game.id("loc")], true],
      ["one card", [game.id("ch1")], true],
      ["none (optional)", [], true],
      ["two characters", [game.id("ch1"), game.id("ch2")], false],
      ["two characters and an item", [game.id("ch1"), game.id("ch2"), game.id("it")], false],
      ["a card twice", [game.id("it"), game.id("it")], false]
    ];
    for (const [label, cardIds, expected] of variants) {
      const query = game.engine.checkSelection(input, pending.declaration.id, cardIds);
      const real = game.engine.checkAction(answerOf(pending, cardIds));
      sameVerdict(label, query, real, false);
      assert.equal(query.ok, expected, label);
      if (label === "two characters") assert.match((query as { error: string }).error, /different types/);
    }
    assert.equal(fingerprint(game.engine), before);
  });

  test("distinct names: Heist Planner searches an opponent's deck for cards with different names", () => {
    const game = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "planner", def: cardDef("1st Edition", "Heist Planner"), owner: P1, zone: "hand" },
        ...bank("deception", 3, P1),
        { key: "k1", def: character({ name: "Dup" }), owner: P2, zone: "deck" },
        { key: "k2", def: character({ name: "Dup" }), owner: P2, zone: "deck" },
        { key: "k3", def: character({ name: "Solo" }), owner: P2, zone: "deck" },
        { key: "k4", def: item({ name: "Other" }), owner: P2, zone: "deck" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "deck" }
      ]
    });
    play(game.engine, P1, game.id("planner"));
    const pending = game.engine.state.pendingChoice as Extract<PendingChoice, { kind: "chooserSelectsTarget" }>;
    assert.equal(pending?.kind, "chooserSelectsTarget");
    const input = inputOf(pending);
    const variants: Array<[string, CardInstanceId[], boolean]> = [
      ["three different names", [game.id("k1"), game.id("k3"), game.id("k4")], true],
      ["two different names", [game.id("k2"), game.id("k3")], true],
      ["two copies of one name", [game.id("k1"), game.id("k2")], false],
      ["a duplicate among three", [game.id("k1"), game.id("k2"), game.id("k3")], false],
      ["four cards", [game.id("k1"), game.id("k2"), game.id("k3"), game.id("k4")], false],
      ["my own deck", [game.id("mine")], false]
    ];
    for (const [label, cardIds, expected] of variants) {
      const query = game.engine.checkSelection(input, pending.declaration.id, cardIds);
      const real = game.engine.checkAction(answerOf(pending, cardIds));
      sameVerdict(label, query, real, false);
      assert.equal(query.ok, expected, label);
    }
  });
});

describe("Q1 over the real card catalog", () => {
  test("every pick of every completed play and ability use is accepted by checkPlaySelection when perform accepts the whole", () => {
    const mismatches: string[] = [];
    let picks = 0;
    let plays = 0;
    const abilitiesOf = (definition: CardDefinition) =>
      (definition.behavior?.abilities ?? []).filter((ability) => ability.type === "activated");
    const sweep = (label: string, built: ReturnType<typeof richBoard>, start: PlayAction, strategy: "min" | "max"): void => {
      const { action, asked } = completePlay(built.engine, start, strategy);
      const verdict = built.engine.checkAction(action);
      plays++;
      for (const requirement of asked) {
        if (requirement.kind !== "pick") continue;
        const cardIds = action.selected?.[requirement.requirement.id];
        if (cardIds === undefined) continue;
        picks++;
        const query = built.engine.checkPlaySelection(action, requirement.requirement.id, cardIds);
        // perform accepted the whole play, so it accepted every pick in it.
        if (verdict.ok && !query.ok) mismatches.push(`${label} [${strategy}] '${requirement.requirement.id}': ${query.error}`);
      }
    };
    for (const definition of CATALOG) {
      if (definition.type === "faction") continue;
      const inHand = richBoard([{ key: "card", def: definition, owner: P1, zone: "hand" }]);
      for (const strategy of ["min", "max"] as const) {
        sweep(`${definition.name} [${definition.set}] play`, inHand, playOf(P1, inHand.id("card")), strategy);
      }
      const activated = abilitiesOf(definition);
      if (activated.length > 0) {
        const inPlay = richBoard([{ key: "card", def: definition, owner: P1, zone: "play" }]);
        for (const ability of activated) {
          sweep(`${definition.name} [${definition.set}] ${ability.id}`, inPlay, abilityOf(P1, inPlay.id("card"), ability.id), "max");
        }
      }
    }
    assert.deepEqual(mismatches.slice(0, 20), []);
    assert.ok(plays > 3000 && picks > 1000, `swept ${plays} plays, ${picks} picks`);
  });
});

// ---------------------------------------------------------------------------
// Q2: getPlaySelectionInput
// ---------------------------------------------------------------------------

describe("Q2 getPlaySelectionInput agrees with getPlayRequirements", () => {
  const picksOf = (engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, mode?: number) =>
    engine.getSelectionRequirements(engine.getPlaySelectionInput(playerId, cardId, mode, playerId === P1 ? P2 : P1));
  const requirementsOf = (engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, mode?: number) =>
    // The play names its opponent (the other original player) up front: at a bigger table an unbound play would first ask which.
    engine.getPlayRequirements({ type: "playCard", playerId, cardId, opponentId: playerId === P1 ? P2 : P1, ...(mode !== undefined ? { mode } : {}) });

  test("named cards: reveal-from-hand, ATTACH TO, a pick after a cost, X, distinct picks, modes", () => {
    const cases: Array<[label: string, set: string, name: string, mode?: number]> = [
      ["Witty Worm (reveal from hand)", "Seed 2", "Witty Worm"],
      ["Tri-Pole Magnet (ATTACH TO CHARACTER)", "1st Edition", "Tri-Pole Magnet"],
      ["Sharpey Pointy Lethal Army Tool (attachToController)", "Shade of the Devoured Emperor", "Sharpey Pointy Lethal Army Tool"],
      ["Rapine (a pick after a cost step)", "1st Edition", "Rapine"],
      ["Tedious TriAdic Truculence (distinct names)", "Shade of the Devoured Emperor", "Tedious TriAdic Truculence"],
      ["Miraculous Regeneration (distinctPicks)", "Seed 2", "Miraculous Regeneration"],
      ["Delectable Boon (choose X, then picks)", "Seed 2", "Delectable Boon"],
      ["Cash Out (choose X)", "1st Edition", "Cash Out"],
      ["Hammer Smash (the random-sized pick is the engine's)", "1st Edition", "Hammer Smash"],
      ["I Drink Your Milkshake! (an optional search)", "Seed 2", "I Drink Your Milkshake!"],
      ["Overindulge, mode 0", "Seed", "Overindulge", 0],
      ["Overindulge, mode 1", "Seed", "Overindulge", 1]
    ];
    for (const [label, set, name, mode] of cases) {
      const built = richBoard([{ key: "card", def: cardDef(set, name), owner: P1, zone: "hand" }]);
      const { engine, id } = built;
      const before = fingerprint(engine);
      const fromInput = picksOf(engine, P1, id("card"), mode);
      const fromAction = requirementsOf(engine, P1, id("card"), mode);
      assert.deepEqual(fromInput, fromAction, label);
      assert.equal(fingerprint(engine), before, `${label}: the live game is untouched`);
    }
  });

  test("the ATTACH TO host pick is in the input, with attachToController", () => {
    const built = richBoard([
      { key: "tool", def: cardDef("Shade of the Devoured Emperor", "Sharpey Pointy Lethal Army Tool"), owner: P1, zone: "hand" },
      { key: "magnet", def: cardDef("1st Edition", "Tri-Pole Magnet"), owner: P1, zone: "hand" }
    ]);
    const { engine, id } = built;
    const tool = engine.getPlaySelectionInput(P1, id("tool"));
    const attach = tool.declarations.find((declaration) => declaration.id === "attachTo");
    assert.ok(attach, "an attachTo declaration");
    assert.equal(attach!.selector.controller, "self", "'ATTACH TO CHARACTER YOU CONTROL'");
    const [pick] = engine.getSelectionRequirements(tool) as PickStep[];
    assert.deepEqual([...pick.candidates].sort(), [id("a1"), id("a2"), id("a3")].sort(), "only my characters");
    const magnet = engine.getPlaySelectionInput(P1, id("magnet"));
    const anyHost = magnet.declarations.find((declaration) => declaration.id === "attachTo");
    assert.equal(anyHost!.selector.controller, undefined, "any character");
    // The same input checks the host pick like the play does.
    assert.equal(engine.checkSelection(tool, "attachTo", [id("a1")]).ok, true);
    assert.equal(engine.checkSelection(tool, "attachTo", [id("b1")]).ok, false);
    assert.equal(engine.checkAction(withPick(playOf(P1, id("tool")), "attachTo", [id("b1")])).ok, false);
  });

  test("Witty Worm: the reveal deploy's picks are the Worm's own play block (none), judged for the player", () => {
    const worm = cardDef("Seed 2", "Witty Worm");
    const built = richBoard([{ key: "worm", def: worm, owner: P1, zone: "hand" }]);
    const input = built.engine.getPlaySelectionInput(P1, built.id("worm"));
    assert.equal(input.sourceId, built.id("worm"));
    assert.equal(input.controllerId, P1);
    assert.deepEqual(input.declarations, []);
    assert.deepEqual(input.selected, {});
    assert.deepEqual(built.engine.getSelectionRequirements(input), []);
  });

  test("the card being played is never a candidate for its own picks", () => {
    // A pick from the hand: the played card itself sits there and is the engine's to leave out.
    const picker = tactic({
      name: "Hand Picker",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "hp",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "hand", owner: "self" }, count: 1 }],
            effects: []
          }
        ]
      }
    });
    const { engine, id } = richBoard([{ key: "picker", def: picker, owner: P1, zone: "hand" }]);
    const [viaInput] = picksOf(engine, P1, id("picker")) as PickStep[];
    const [viaAction] = requirementsOf(engine, P1, id("picker")) as PickStep[];
    assert.ok(!viaInput.candidates.includes(id("picker")));
    assert.deepEqual(viaInput.candidates, viaAction.candidates);
    assert.equal(engine.checkSelection(engine.getPlaySelectionInput(P1, id("picker")), "t", [id("picker")]).ok, false);
    assert.equal(engine.checkAction(withPick(playOf(P1, id("picker")), "t", [id("picker")])).ok, false);
  });

  test("it throws for a card that is not in the game or a mode the card does not have", () => {
    const { engine, id } = richBoard([{ key: "over", def: cardDef("Seed", "Overindulge"), owner: P1, zone: "hand" }]);
    assert.throws(() => engine.getPlaySelectionInput(P1, "nope"), /not found/);
    assert.throws(() => engine.getPlaySelectionInput(P1, id("over"), 7), /no mode/);
  });

  test("over the real catalog: the input's picks equal getPlayRequirements for every card and mode", () => {
    const mismatches: string[] = [];
    let checked = 0;
    for (const definition of CATALOG) {
      if (definition.type === "faction") continue;
      const modeCount = definition.behavior?.modes?.length ?? 0;
      const { engine, id } = richBoard([{ key: "card", def: definition, owner: P1, zone: "hand" }]);
      const modes: Array<number | undefined> = modeCount > 1 ? Array.from({ length: modeCount }, (_, mode) => mode) : [undefined];
      for (const mode of modes) {
        let fromInput: unknown;
        let fromAction: unknown;
        try {
          fromInput = picksOf(engine, P1, id("card"), mode);
          fromAction = requirementsOf(engine, P1, id("card"), mode);
        } catch (error) {
          mismatches.push(`${definition.name} [${definition.set}] mode ${mode}: threw ${(error as Error).message}`);
          continue;
        }
        checked++;
        if (JSON.stringify(fromInput) !== JSON.stringify(fromAction)) {
          mismatches.push(`${definition.name} [${definition.set}] mode ${mode}`);
        }
      }
    }
    assert.deepEqual(mismatches.slice(0, 20), []);
    assert.ok(checked > 1500, `checked ${checked} plays`);
  });
});

// ---------------------------------------------------------------------------
// Q3: getResourcePlayFaces / canPlayResourceFaceUp / canPlayResourceFaceDown
// ---------------------------------------------------------------------------

describe("Q3 resource face rules agree with playResourceCard", () => {
  /** Whether the Develop Rule, run on a probe copy of the game, puts `cardId` into play as a resource on the asked side. */
  const developAccepts = (engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, faceDown: boolean): boolean => {
    const probe = new SpoilsEngine(Object.values(engine.definitions), structuredClone(engine.state), () => 0.5);
    try {
      developPlay(probe, playerId, cardId, faceDown);
    } catch {
      return false;
    }
    const card = probe.state.cards[cardId];
    return card.zone === "play" && (card.faceDown ?? false) === faceDown;
  };

  const staple = resourceCard({ name: "Plain Staple", resource: { provides: ["greed"], staple: true } });
  const faceDownOnly = resourceCard({ name: "Flip It Staple", resource: { provides: ["greed"], staple: true, faceDownOnly: true } });

  test("a staple, a faceDownOnly staple and a non-resource", () => {
    const { engine, id } = richBoard([
      { key: "staple", def: staple, owner: P1, zone: "hand" },
      { key: "fdo", def: faceDownOnly, owner: P1, zone: "hand" },
      { key: "body", def: character({ name: "Body" }), owner: P1, zone: "hand" },
      { key: "real", def: CATALOG.find((card) => card.type === "resource" && card.resource?.faceDownOnly)!, owner: P1, zone: "hand" }
    ]);
    const before = fingerprint(engine);
    assert.deepEqual(engine.getResourcePlayFaces(P1, id("staple")), { canFaceUp: true, canFaceDown: true });
    assert.deepEqual(engine.getResourcePlayFaces(P1, id("fdo")), {
      canFaceUp: false,
      canFaceDown: true,
      forcedFaceDown: "faceDownOnly",
      reason: "This resource may only be played from your hand face-down."
    });
    assert.deepEqual(engine.getResourcePlayFaces(P1, id("body")), {
      canFaceUp: false,
      canFaceDown: true,
      forcedFaceDown: "notAResource",
      reason: "Only a resource card can be played face-up as a resource."
    });
    assert.equal(engine.getResourcePlayFaces(P1, id("real")).forcedFaceDown, "faceDownOnly", "a printed FLIP IT staple");
    assert.equal(engine.canPlayResourceFaceUp(P1, id("staple")), true);
    assert.equal(engine.canPlayResourceFaceUp(P1, id("fdo")), false);
    assert.equal(engine.canPlayResourceFaceDown(P1, id("fdo")), true);
    assert.equal(fingerprint(engine), before, "the live game is untouched");
    // ...and what the Develop Rule does with each side is the same answer.
    for (const key of ["staple", "fdo", "body", "real"]) {
      const faces = engine.getResourcePlayFaces(P1, id(key));
      assert.equal(developAccepts(engine, P1, id(key), false), faces.canFaceUp, `${key} face-up`);
      assert.equal(developAccepts(engine, P1, id(key), true), faces.canFaceDown, `${key} face-down`);
    }
  });

  test("a card that is not in that player's hand allows neither side, with the engine's words", () => {
    const { engine, id } = richBoard([{ key: "staple", def: staple, owner: P1, zone: "hand" }]);
    const inPlay = engine.getResourcePlayFaces(P1, id("a1"));
    assert.equal(inPlay.canFaceUp, false);
    assert.equal(inPlay.canFaceDown, false);
    assert.equal(inPlay.reason, "A resource must be played from hand.");
    const theirs = engine.getResourcePlayFaces(P2, id("staple"));
    assert.deepEqual(theirs, { canFaceUp: false, canFaceDown: false, reason: "That card is not in this player's hand." });
    assert.equal(engine.canPlayResourceFaceDown(P2, id("staple")), false);
    const missing = engine.getResourcePlayFaces(P1, "nope");
    assert.equal(missing.canFaceUp, false);
    assert.equal(missing.canFaceDown, false);
    // The play itself says the same.
    assert.equal(developAccepts(engine, P2, id("staple"), true), false);
  });

  test("over the real catalog: agrees with the Develop Rule's resource play, side by side, for every card in hand", () => {
    const mismatches: string[] = [];
    let checked = 0;
    for (const definition of CATALOG) {
      if (definition.type === "faction") continue;
      const { engine, id } = richBoard([{ key: "card", def: definition, owner: P1, zone: "hand" }]);
      const cardId = id("card");
      const faces = engine.getResourcePlayFaces(P1, cardId);
      const label = `${definition.name} [${definition.set}]`;
      const probe = new SpoilsEngine(Object.values(engine.definitions), structuredClone(engine.state), () => 0.5);
      openDevelop(probe, P1);
      const offered = probe.state.pendingChoice?.kind === "chooserSelectsOption" &&
        probe.state.pendingChoice.options.some((option) => option.label === "Play a resource");
      if (!offered) {
        mismatches.push(`${label}: the Develop Rule does not offer to play a resource`);
        continue;
      }
      for (const faceDown of [false, true]) {
        const accepted = developAccepts(engine, P1, cardId, faceDown);
        if (accepted !== (faceDown ? faces.canFaceDown : faces.canFaceUp)) {
          mismatches.push(`${label}: the Develop Rule ${faceDown ? "face-down" : "face-up"} ${accepted}`);
        }
      }
      checked++;
    }
    assert.deepEqual(mismatches.slice(0, 20), []);
    assert.ok(checked > 1500, `checked ${checked} cards`);
  });
});

// ---------------------------------------------------------------------------
// Q4: getMulliganLimit
// ---------------------------------------------------------------------------

describe("Q4 getMulliganLimit", () => {
  const CHEST = "fe7095e0-d918-420c-9303-fbc5054d2564";
  const DEC = resourceCard({ id: "w4-dec", name: "Dec", resource: { provides: ["deception"], staple: true } });
  const RGE = resourceCard({ id: "w4-rge", name: "Rge", resource: { provides: ["rage"], staple: true } });
  const FILL = character({ id: "w4-fill", name: "Filler", life: 2 });
  const repeat = <T,>(x: T, n: number): T[] => Array.from({ length: n }, () => x);
  const mulliganFaction = (id: string, openingHand: number, mulligan?: { count: number; mode: "replaceAny" }) =>
    factionCard({
      id,
      name: `Faction ${id}`,
      faction: defaultFactionDefinition({
        startingInfluence: 20,
        setup: {
          startingResources: { count: 2, names: ["Dec"] },
          openingHand: { goingFirst: openingHand, goingSecond: openingHand },
          ...(mulligan ? { mulligan } : {})
        },
        turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "draw", count: 1 }] } }
      })
    });
  const mulliganAction = (playerId: PlayerId, cardIds: CardInstanceId[]): GameAction => ({ type: "mulligan", playerId, cardIds }) as GameAction;

  function chestGame(holder: PlayerId) {
    const faction = mulliganFaction("w4-faction", 4, { count: 3, mode: "replaceAny" });
    const withChest = [DEC, DEC, RGE, RGE, cardsJson.find((card) => card.id === CHEST) as CardDefinition, ...repeat(FILL, 8)];
    const without = [DEC, DEC, RGE, RGE, ...repeat(FILL, 9)];
    for (let seed = 1; seed < 400; seed++) {
      const engine = setupGame(
        { faction, deck: holder === P1 ? withChest : without },
        { faction, deck: holder === P2 ? withChest : without },
        { seed }
      );
      const chestId = engine.state.players[holder].hand.find((cardId) => engine.getDefinition(cardId).name === "Community Chest");
      if (chestId) return { engine, chestId };
    }
    throw new Error("no seed put the Community Chest into the opening hand");
  }

  test("the seat that is up: the limit is what previewMulligan reports as maxCards", () => {
    const { engine, chestId } = chestGame(P1);
    const hand = engine.state.players[P1].hand.length;
    assert.equal(engine.state.setup.phase, "mulligan");
    assert.equal(engine.getMulliganLimit(P1), hand);
    assert.equal(engine.previewMulligan(P1, []).maxCards, hand);
    assert.equal(engine.previewMulligan(P1, [chestId]).maxCards, hand);
  });

  test("a seat whose turn has not come yet: the limit is its hand, previewMulligan refuses, and the real mulligan agrees once it is up", () => {
    const { engine } = chestGame(P1);
    const first = engine.state.setup.phase === "mulligan" ? engine.state.setup.order[0] : P1;
    const second = first === P1 ? P2 : P1;
    const before = fingerprint(engine);
    assert.equal(engine.getMulliganLimit(second), engine.state.players[second].hand.length);
    assert.throws(() => engine.previewMulligan(second, []), /not this player's mulligan/, "the old behavior for a seat that is not up is kept");
    assert.equal(engine.checkAction(mulliganAction(second, [])).ok, false, "and so is the real action");
    assert.equal(fingerprint(engine), before);

    // The first seat decides; the second is up and its limit is what its preview says.
    engine.perform(mulliganAction(first, []));
    assert.equal(engine.getMulliganLimit(first), 0, "a seat that has decided has nothing left to send back");
    assert.equal(engine.getMulliganLimit(second), engine.state.players[second].hand.length);
    assert.equal(engine.previewMulligan(second, []).maxCards, engine.getMulliganLimit(second));
    const hand = [...engine.state.players[second].hand];
    assert.deepEqual(engine.checkAction(mulliganAction(second, hand)), { ok: true }, "the whole hand may go back");
    engine.perform(mulliganAction(second, []));
    assert.equal(engine.state.setup.phase, "complete");
    assert.equal(engine.getMulliganLimit(P1), 0, "not the mulligan step any more");
    assert.equal(engine.getMulliganLimit(P2), 0);
  });

  test("Community Chest: the limit ignores what is in the hand, and the preview's prompt note still holds", () => {
    const { engine, chestId } = chestGame(P2);
    const holder = P2;
    const limit = engine.getMulliganLimit(holder);
    assert.equal(limit, engine.state.players[holder].hand.length);
    const first = engine.state.setup.phase === "mulligan" ? engine.state.setup.order[0] : P1;
    if (first !== holder) engine.perform(mulliganAction(first, []));
    const preview = engine.previewMulligan(holder, [chestId]);
    assert.equal(preview.maxCards, limit);
    assert.equal(preview.incoming.length, 1);
  });

  test("a faction with no replace-any mulligan: 0, and the real mulligan refuses it", () => {
    const faction = mulliganFaction("w4-nomull", 4);
    const engine = setupGame({ faction, deck: [DEC, DEC, RGE, RGE, ...repeat(FILL, 9)] }, { faction, deck: [DEC, DEC, RGE, RGE, ...repeat(FILL, 9)] }, { seed: 3 });
    if (engine.state.setup.phase !== "mulligan") {
      // This faction has no mulligan step at all: nothing to send back either way.
      assert.equal(engine.getMulliganLimit(P1), 0);
      return;
    }
    assert.equal(engine.getMulliganLimit(P1), 0);
    assert.equal(engine.getMulliganLimit(P2), 0);
    const seat = engine.state.setup.order[engine.state.setup.currentIndex];
    assert.match((engine.checkAction(mulliganAction(seat, [])) as { error: string }).error, /replace-any mulligan/);
  });
});

// ---------------------------------------------------------------------------
// Q5: previewBlockOptions
// ---------------------------------------------------------------------------

describe("Q5 previewBlockOptions agrees with the real battle's getBlockOptions", () => {
  const faction = (playerId: PlayerId): AttackTarget => ({ type: "faction", playerId });
  const attack = (attackerIds: CardInstanceId[], playerId: PlayerId = P1): GameAction => ({
    type: "declareAttack",
    playerId,
    attackerIds,
    target: faction(playerId === P1 ? P2 : P1)
  });

  /** A throw-away copy of the game: the real attack is declared on it. */
  const copyOf = (engine: SpoilsEngine): SpoilsEngine =>
    new SpoilsEngine(Object.values(engine.definitions), structuredClone(engine.state), () => 0.5);

  /** The preview, with the live game checked untouched around it. */
  function previewOf(game: ReturnType<typeof buildGame>, attackerKeys: string[]): BlockOptions | undefined {
    const { engine } = game;
    const before = fingerprint(engine);
    const rngBefore = engine.state.rngState;
    const preview = engine.previewBlockOptions(P1, attackerKeys.map((key) => game.id(key)), faction(P2));
    assert.equal(fingerprint(engine), before, "the live game, its queue and its log are untouched");
    assert.equal(engine.state.rngState, rngBefore, "the random stream did not move");
    assert.equal(engine.state.battle, undefined, "no battle was started on the live game");
    return preview;
  }

  /** The attack declared for real (on a copy), both sides passing, read at the blocking step. */
  function realOptions(game: ReturnType<typeof buildGame>, attackerKeys: string[]): BlockOptions | undefined {
    const copy = copyOf(game.engine);
    copy.perform(attack(attackerKeys.map((key) => game.id(key))));
    resolvePendingResponses(copy);
    return copy.getBlockOptions();
  }

  const scenarios: Array<{ label: string; build: () => ReturnType<typeof buildGame>; attackers: string[] }> = [
    {
      label: "an ordinary board",
      attackers: ["a"],
      build: () =>
        buildGame({
          cards: [
            { key: "a", def: character({ name: "A" }), owner: P1 },
            { key: "b1", def: character({ name: "B1" }), owner: P2 },
            { key: "b2", def: character({ name: "B2" }), owner: P2 },
            { key: "tired", def: character({ name: "Tired" }), owner: P2, depleted: true }
          ]
        })
    },
    {
      label: "a COVERT attacker (Ominous Oozling): only COVERT-capable characters may block",
      attackers: ["oozling"],
      build: () =>
        buildGame({
          cards: [
            { key: "oozling", def: cardDef("1st Edition", "Ominous Oozling"), owner: P1 },
            { key: "plain", def: character({ name: "Plain" }), owner: P2 },
            { key: "flashlight", def: cardDef("Holy Heist", "RC Flashlight"), owner: P2 },
            { key: "spider", def: cardDef("1st Edition", "Sneaking Spitspider"), owner: P2 }
          ]
        })
    },
    {
      label: "a must-block character (Defense Attorney)",
      attackers: ["a"],
      build: () =>
        buildGame({
          cards: [
            { key: "a", def: character({ name: "A" }), owner: P1 },
            { key: "attorney", def: cardDef("1st Edition", "Defense Attorney"), owner: P2 },
            { key: "other", def: character({ name: "Other" }), owner: P2 }
          ]
        })
    },
    {
      label: "a must-block character that has no legal block (COVERT attacker)",
      attackers: ["oozling"],
      build: () =>
        buildGame({
          cards: [
            { key: "oozling", def: cardDef("1st Edition", "Ominous Oozling"), owner: P1 },
            { key: "attorney", def: cardDef("1st Edition", "Defense Attorney"), owner: P2 }
          ]
        })
    },
    {
      label: "an unblockable party (RC Flashlight)",
      attackers: ["flashlight"],
      build: () =>
        buildGame({
          cards: [
            { key: "flashlight", def: cardDef("Holy Heist", "RC Flashlight"), owner: P1 },
            { key: "other", def: character({ name: "Other" }), owner: P2 }
          ]
        })
    },
    {
      label: "cannotBlock (Rapacious Soldier) next to a free character",
      attackers: ["a"],
      build: () =>
        buildGame({
          cards: [
            { key: "a", def: character({ name: "A" }), owner: P1 },
            { key: "soldier", def: cardDef("Holy Heist", "Rapacious Soldier"), owner: P2 },
            { key: "fine", def: character({ name: "Fine" }), owner: P2 }
          ]
        })
    },
    {
      label: "nobody left to block",
      attackers: ["a"],
      build: () =>
        buildGame({
          cards: [
            { key: "a", def: character({ name: "A" }), owner: P1 },
            { key: "tired", def: character({ name: "Tired" }), owner: P2, depleted: true }
          ]
        })
    }
  ];

  for (const scenario of scenarios) {
    test(scenario.label, () => {
      const game = scenario.build();
      const preview = previewOf(game, scenario.attackers);
      assert.ok(preview, "a declaration the engine accepts has a blocking step");
      assert.deepEqual(preview, realOptions(game, scenario.attackers));
    });
  }

  test("COVERT and must-block read out the way the engine states them", () => {
    const covert = scenarios[1].build();
    const options = covert.engine.previewBlockOptions(P1, [covert.id("oozling")], faction(P2))!;
    assert.deepEqual([...options.blockers].sort(), [covert.id("flashlight"), covert.id("spider")].sort());
    const must = scenarios[2].build();
    const mustOptions = must.engine.previewBlockOptions(P1, [must.id("a")], faction(P2))!;
    assert.deepEqual(mustOptions.mustBlock, [must.id("attorney")]);
    assert.equal(mustOptions.canBlock, true);
  });

  test("undefined exactly when declareAttack would refuse the declaration", () => {
    const game = buildGame({
      cards: [
        { key: "a", def: character({ name: "A" }), owner: P1 },
        { key: "b", def: character({ name: "B" }), owner: P1 },
        { key: "tired", def: character({ name: "Tired" }), owner: P1, depleted: true },
        { key: "foe", def: character({ name: "Foe" }), owner: P2 },
        { key: "sentinels", def: cardDef("Ungodly Mess", "Silent Sentinels"), owner: P1 }
      ]
    });
    const { engine } = game;
    const cases: Array<[string, PlayerId, CardInstanceId[], AttackTarget]> = [
      ["a depleted attacker", P1, [game.id("tired")], faction(P2)],
      ["no attackers", P1, [], faction(P2)],
      ["the opponent's character (not my turn, not mine)", P1, [game.id("foe")], faction(P2)],
      ["it is the other player's turn to attack", P2, [game.id("foe")], faction(P1)],
      ["a card twice", P1, [game.id("a"), game.id("a")], faction(P2)],
      ["attacking myself", P1, [game.id("a"), game.id("sentinels")], faction(P1)],
      ["Silent Sentinels must attack and was left out", P1, [game.id("a")], faction(P2)],
      ["Silent Sentinels and the rest", P1, [game.id("a"), game.id("b"), game.id("sentinels")], faction(P2)]
    ];
    for (const [label, playerId, ids, target] of cases) {
      const refused = engine.checkAction({ type: "declareAttack", playerId, attackerIds: ids, target }).ok === false;
      const preview = engine.previewBlockOptions(playerId, ids, target);
      assert.equal(preview === undefined, refused, `${label}: preview ${preview ? "answered" : "undefined"}, declareAttack ${refused ? "refused" : "accepted"}`);
    }
    // ...and the same declaration works once the refusal is gone.
    assert.ok(engine.previewBlockOptions(P1, [game.id("a"), game.id("b"), game.id("sentinels")], faction(P2)));
  });

  test("an attack tax that cannot be paid: undefined; one that can: answered, and nothing is paid on the live game", () => {
    const ministry = cardDef("1st Edition", "The Ministry of Other Smaller Ministries");
    const game = (greed: number) =>
      buildGame({
        playerA: { faction: developFaction() },
        playerB: { faction: developFaction() },
        cards: [
          { key: "a", def: character({ name: "A" }), owner: P1 },
          { key: "foe", def: character({ name: "Foe" }), owner: P2 },
          { key: "ministry", def: ministry, owner: P2 },
          ...bank("greed", greed, P1)
        ]
      });
    const broke = game(0);
    const brokeRefused = broke.engine.checkAction(attack([broke.id("a")])).ok === false;
    assert.equal(brokeRefused, true, "perform refuses it");
    assert.equal(broke.engine.previewBlockOptions(P1, [broke.id("a")], faction(P2)), undefined);

    const rich = game(3);
    const resources = () => Object.values(rich.engine.state.cards).filter((card) => card.controllerId === P1 && card.depleted).length;
    const depletedBefore = resources();
    const preview = rich.engine.previewBlockOptions(P1, [rich.id("a")], faction(P2));
    assert.ok(preview, "the tax is payable");
    assert.deepEqual(preview!.blockers, [rich.id("foe")]);
    assert.equal(resources(), depletedBefore, "the tax was paid on the copy, not on the live game");
    assert.equal(rich.engine.state.cards[rich.id("a")].depleted, false, "the attacker was depleted on the copy only");
  });

  test("asking again, with the log and the random stream as they were, changes nothing for the live game that follows", () => {
    const asked = scenarios[2].build();
    const control = scenarios[2].build();
    asked.engine.state.rngState = 20261021;
    control.engine.state.rngState = 20261021;
    const seqBefore = { asked: asked.engine.state.idSeq, control: control.engine.state.idSeq };
    for (let round = 0; round < 3; round++) asked.engine.previewBlockOptions(P1, [asked.id("a")], faction(P2));
    for (const game of [asked, control]) {
      game.engine.perform(attack([game.id("a")]));
      resolvePendingResponses(game.engine);
    }
    assert.equal(asked.engine.state.rngState, control.engine.state.rngState);
    assert.equal(asked.engine.state.gameLog.length, control.engine.state.gameLog.length);
    const keyed = (game: typeof asked): unknown => {
      const options = game.engine.getBlockOptions()!;
      const keyOf = (cardId: CardInstanceId) => ["a", "attorney", "other"].find((key) => game.id(key) === cardId);
      return { ...options, blockers: options.blockers.map(keyOf), mustBlock: options.mustBlock.map(keyOf) };
    };
    assert.deepEqual(keyed(asked), keyed(control), "the same blockers, whichever game was asked");
    assert.equal(
      asked.engine.state.idSeq - seqBefore.asked,
      control.engine.state.idSeq - seqBefore.control,
      "no ids were minted by the questions"
    );
  });
});

// ---------------------------------------------------------------------------
// Q6: DeckConstructionIssue count / max
// ---------------------------------------------------------------------------

describe("Q6 a copyLimit issue carries count and max", () => {
  const faction = CATALOG.find((card) => card.type === "faction" && card.name === "The Tournament Faction") ?? CATALOG.find((card) => card.type === "faction")!;
  const planner = cardDef("1st Edition", "Heist Planner");
  const repeat = <T,>(x: T, n: number): T[] => Array.from({ length: n }, () => x);

  test("five copies of a normal card: count 5, max 4; four are fine; a staple is never over", () => {
    const five = findDeckConstructionIssues([faction, ...repeat(planner, 5)], { factionRules: false, minimumSize: false });
    const [issue] = five.filter((entry) => entry.kind === "copyLimit");
    assert.ok(issue);
    assert.equal(issue.cardId, planner.id);
    assert.equal(issue.count, 5);
    assert.equal(issue.max, 4);
    assert.match(issue.message, /5 copies of Heist Planner is over the 4-copy limit/);

    const four = findDeckConstructionIssues([faction, ...repeat(planner, 4)], { factionRules: false, minimumSize: false });
    assert.deepEqual(four.filter((entry) => entry.kind === "copyLimit"), []);
    const staple = CATALOG.find((card) => isStapleResourceDefinition(card))!;
    const many = findDeckConstructionIssues([faction, ...repeat(staple, 9)], { factionRules: false, minimumSize: false });
    assert.deepEqual(many.filter((entry) => entry.kind === "copyLimit"), []);
  });

  test("the other issue kinds carry neither field", () => {
    const issues = findDeckConstructionIssues([], { unknownCardIds: ["ghost"] });
    assert.ok(issues.length >= 2);
    for (const issue of issues) {
      assert.equal(issue.count, undefined);
      assert.equal(issue.max, undefined);
    }
  });
});

// The placements helper type is imported for the scenarios above.
void ([] as CardPlacement[]);
void [item, location];
