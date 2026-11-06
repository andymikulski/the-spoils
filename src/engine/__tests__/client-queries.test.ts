// Read-only queries for clients. Each query answers what `perform()` would do, so every
// test here is an AGREEMENT test: the query's answer is compared with the action being accepted or refused on a
// throw-away copy of the game. Real catalog cards are used where the audit names them (Department of Rejections,
// Witty Worm, Community Chest, the Holy Heist FLIP IT staples).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTACH_TARGET_ID,
  isStapleResourceDefinition,
  SpoilsEngine,
  withBuiltInFactionDefaults,
  createFactionGame
} from "../../engine.js";
import type {
  ActivatedAbility,
  AbilityUnavailableReason,
  BattleDamageAssignment,
  CardCatalogEntry,
  CardDefinition,
  CardInstanceId,
  GameAction,
  GameFlowView,
  PendingChoice,
  PlayerId
} from "../../engine.js";
import {
  bank,
  buildGame,
  cardDef,
  character,
  developFaction,
  factionCard,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "./per-card/_harness.js";
import type { StapleIcon } from "./per-card/_harness.js";
import { defaultFactionDefinition } from "./support/fixtures.js";
import type { CardPlacement } from "./support/fixtures.js";
import { setupGame } from "./clauses/_turn.js";
import { playGameToCompletion } from "./support/autoplay.js";
import { chooseDevelopOption, developPlay, openDevelop } from "./support/develop.js";
import { mulberry32 } from "./support/prng.js";
import cardsJson from "../../data/cards.js";
import { ARCANIST_DECK_IDS as arcanistDeckIds, WARLORD_DECK_IDS as warlordDeckIds } from "./support/decks.js";

// --- helpers ------------------------------------------------------------------------------------------------

// NOTE: this file must not import clauses/_clause.js or clauses/_battle.js: the clause suite patches
// `SpoilsEngine.prototype.perform` to answer the face-up / cost prompts by itself, and these tests are about those prompts.

/** The catalog printing with this id (a deep copy). */
const printing = (cardId: string): CardDefinition => structuredClone((cardsJson as CardDefinition[]).find(card => card.id === cardId)!);

/** `player` attacks the other faction; the declaration's response window is drained, so blockers can be declared next. */
function declareAttackBy(engine: SpoilsEngine, player: PlayerId, attackerIds: CardInstanceId[]): void {
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target: { type: "faction", playerId: player === P1 ? P2 : P1 } });
  resolvePendingResponses(engine);
}

/** A throw-away copy of the game (the same pattern the engine's own probes use). */
function probe(engine: SpoilsEngine): SpoilsEngine {
  const copy = new SpoilsEngine(Object.values(engine.definitions), structuredClone(engine.state), () => 0.5);
  copy.setCardCatalog((engine as unknown as { cardCatalog?: CardCatalogEntry[] }).cardCatalog);
  return copy;
}

/** Whether `perform(action)` is accepted, tried on a copy so the live game is untouched. */
function accepts(engine: SpoilsEngine, action: GameAction): boolean {
  try {
    probe(engine).perform(action);
    return true;
  } catch {
    return false;
  }
}

const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

const res = (icons: Partial<Record<StapleIcon, number>>, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

const activateAction = (playerId: PlayerId, cardId: CardInstanceId, abilityId: string): GameAction => ({
  type: "activateAbility",
  playerId,
  cardId,
  abilityId,
  selected: {},
  variables: {}
});

/** A character whose single ability `use` has the given costs / extras. */
const abilityChar = (name: string, ability: Partial<ActivatedAbility> = {}): CardDefinition =>
  character({
    name,
    behavior: { abilities: [{ id: "use", type: "activated", effects: [], ...ability }] }
  });

// --- 1. activated ability statuses --------------------------------------------------------------------------

describe("getCardActivatedAbilities / getActivatedAbilityStatuses", () => {
  test("getCardActivatedAbilities lists printed + granted abilities and leaves out a suppressed one", () => {
    const granter = item({
      name: "Granter",
      behavior: {
        abilities: [
          {
            id: "grant",
            type: "continuous",
            modifiers: [],
            grantedAbilities: [
              {
                selector: { zone: "play", type: "character", name: "Bearer" },
                abilities: [{ id: "granted", type: "activated", effects: [] }]
              }
            ]
          }
        ]
      }
    });
    const { engine, id } = devBoard([
      { key: "bearer", def: abilityChar("Bearer"), owner: P1, zone: "play" },
      { key: "granter", def: granter, owner: P1, zone: "play" }
    ]);
    assert.deepEqual(
      engine.getCardActivatedAbilities(id("bearer")).map(a => a.id),
      ["use", "granted"]
    );
    engine.state.abilitySuppressions.push({
      id: "sup1",
      targetId: id("bearer"),
      duration: { type: "untilEndOfTurn" },
      createdTurn: 1
    });
    assert.deepEqual(engine.getCardActivatedAbilities(id("bearer")).map(a => a.id), ["granted"]);
  });

  test("every reason is reported, and `available` agrees with getAvailableActivatedAbilities and with activateAbility", () => {
    const wanted: Array<[string, Partial<ActivatedAbility>, AbilityUnavailableReason | undefined]> = [
      ["Free", {}, undefined],
      ["Costly", { costs: [{ type: "payResources", amount: 3 }] }, "cost"],
      ["Gated", { condition: { type: "battleActive" } }, "condition"],
      ["Aimless", { targets: [{ id: "t", selector: { zone: "play", name: "Nobody At All" }, count: 1 }] }, "targets"],
      ["Tapper", { costs: [{ type: "deplete", target: "source" }] }, undefined],
      ["Once", { usesPerTurn: 1 }, undefined]
    ];
    const { engine, id } = devBoard([
      ...wanted.map(([name, ability]): CardPlacement => ({ key: name, def: abilityChar(name, ability), owner: P1, zone: "play" })),
      { key: "Muted", def: abilityChar("Muted"), owner: P1, zone: "play" },
      { key: "Frozen", def: abilityChar("Frozen"), owner: P1, zone: "play" },
      { key: "Hidden", def: abilityChar("Hidden"), owner: P1, zone: "play", faceDown: true },
      ...res({ rage: 1 })
    ]);
    engine.state.abilitySuppressions.push({ id: "s", targetId: id("Muted"), duration: { type: "untilEndOfTurn" }, createdTurn: 1 });
    engine.state.restrictions.push({ id: "r", targetId: id("Frozen"), restriction: "cannotUseAbilities", duration: { type: "untilEndOfTurn" }, createdTurn: 1 });

    // Use the tapper and the once-per-turn ability, so they are now "depleted" / "usesSpent".
    engine.perform(activateAction(P1, id("Tapper"), "use"));
    resolvePendingResponses(engine);
    engine.perform(activateAction(P1, id("Once"), "use"));
    resolvePendingResponses(engine);

    const statuses = engine.getActivatedAbilityStatuses(P1);
    const reasonOf = (key: string) => statuses.find(s => s.cardId === id(key))?.unavailableBecause;
    const availableOf = (key: string) => statuses.find(s => s.cardId === id(key))?.available;

    assert.equal(availableOf("Free"), true);
    assert.equal(reasonOf("Free"), undefined);
    assert.equal(reasonOf("Costly"), "cost");
    assert.equal(reasonOf("Gated"), "condition");
    assert.equal(reasonOf("Aimless"), "targets");
    assert.equal(reasonOf("Tapper"), "depleted");
    assert.equal(reasonOf("Once"), "usesSpent");
    assert.equal(reasonOf("Muted"), "suppressed");
    assert.equal(reasonOf("Frozen"), "restricted");
    assert.equal(reasonOf("Hidden"), "faceDown");

    // `getAvailableActivatedAbilities` is exactly the available statuses (same order, same ability objects).
    const available = statuses.filter(s => s.available).map(s => ({ cardId: s.cardId, ability: s.ability }));
    assert.deepEqual(engine.getAvailableActivatedAbilities(P1), available);
    for (const s of available) assert.ok(engine.getAvailableActivatedAbilities(P1).some(a => a.ability === s.ability));

    // Each listing agrees with what `activateAbility` accepts (the abilities here need no picks).
    for (const s of statuses) {
      assert.equal(
        accepts(engine, activateAction(P1, s.cardId, s.ability.id)),
        s.available,
        `${engine.getDefinition(s.cardId).name}: available=${s.available} (${s.unavailableBecause ?? "ok"})`
      );
    }
  });

  test("timing: while the opponent holds the turn every ability is out, for 'timing'", () => {
    const { engine, id } = devBoard([{ key: "c", def: abilityChar("Idle"), owner: P1, zone: "play" }], { activePlayerId: P2 });
    assert.deepEqual(engine.getAvailableActivatedAbilities(P1), []);
    const statuses = engine.getActivatedAbilityStatuses(P1);
    assert.deepEqual(statuses.map(s => [s.cardId, s.available, s.unavailableBecause]), [[id("c"), false, "timing"]]);
    assert.equal(accepts(engine, activateAction(P1, id("c"), "use")), false);
  });

  test("Department of Rejections: its tax makes a free character ability cost 2, and the status follows the resources", () => {
    const dept = cardDef("Seed", "Department of Rejections");
    const worker = abilityChar("Worker");
    const board = (ready: number) =>
      devBoard(
        [
          { key: "dept", def: dept, owner: P1, zone: "play" },
          { key: "worker", def: worker, owner: P2, zone: "play" },
          ...res({ rage: ready }, P2)
        ],
        { activePlayerId: P2, turn: 2 }
      );
    for (const ready of [0, 1, 2, 3]) {
      const { engine, id } = board(ready);
      const status = engine.getActivatedAbilityStatuses(P2).find(s => s.cardId === id("worker"))!;
      assert.equal(status.available, ready >= 2, `${ready} resources vs a tax of 2`);
      if (ready < 2) assert.equal(status.unavailableBecause, "cost");
      assert.equal(accepts(engine, activateAction(P2, id("worker"), "use")), ready >= 2);
      assert.equal(engine.getAvailableActivatedAbilities(P2).length, ready >= 2 ? 1 : 0);
    }
    // Control: without the Department the same ability is free.
    const free = devBoard([{ key: "worker", def: worker, owner: P2, zone: "play" }], { activePlayerId: P2, turn: 2 });
    assert.equal(free.engine.getActivatedAbilityStatuses(P2)[0].available, true);
  });

  test("a face-down card of the opponent's is not described; the owner sees it as 'faceDown'", () => {
    const { engine, id } = devBoard([{ key: "h", def: abilityChar("Secret", { usableBy: "anyPlayer" }), owner: P1, zone: "play", faceDown: true }]);
    assert.deepEqual(engine.getActivatedAbilityStatuses(P2), []);
    assert.equal(engine.getActivatedAbilityStatuses(P1).find(s => s.cardId === id("h"))?.unavailableBecause, "faceDown");
  });

  test("a FLIP IT staple face-down is offered face-down (fromFaceDown), and the status agrees with perform", () => {
    const upgrade = cardDef("Holy Heist", "Elitist Upgrade");
    const { engine, id } = devBoard([
      { key: "u", def: upgrade, owner: P1, zone: "play", faceDown: true },
      ...res({ elitism: 2 })
    ]);
    for (const s of engine.getActivatedAbilityStatuses(P1).filter(s => s.cardId === id("u"))) {
      assert.equal(accepts(engine, activateAction(P1, s.cardId, s.ability.id)), s.available, `${s.ability.id}: ${s.unavailableBecause ?? "ok"}`);
    }
  });

  test("api-fix: a printed ability threshold is judged by both listings, and agrees with activateAbility (Research Intern, RESEARCH HARDER [E]x5)", () => {
    const intern = cardDef("Seed 2", "Research Intern");
    for (const elitism of [0, 4, 5, 6]) {
      const { engine, id } = devBoard([{ key: "intern", def: intern, owner: P1, zone: "play" }, ...res({ elitism })]);
      const met = elitism >= 5;
      const statuses = engine.getActivatedAbilityStatuses(P1).filter(s => s.cardId === id("intern"));
      const harder = statuses.find(s => s.ability.id === "research-harder")!;
      const plain = statuses.find(s => s.ability.id === "research")!;
      assert.equal(harder.available, met, `${elitism} elitism vs [E]x5`);
      assert.equal(harder.unavailableBecause, met ? undefined : "threshold");
      assert.equal(plain.available, true, "the same card's ability without a threshold is unaffected");
      const listed = engine.getAvailableActivatedAbilities(P1).filter(a => a.cardId === id("intern")).map(a => a.ability.id);
      assert.deepEqual(listed, met ? ["research", "research-harder"] : ["research"]);
      for (const s of statuses) {
        assert.equal(accepts(engine, activateAction(P1, s.cardId, s.ability.id)), s.available, `${s.ability.id} at ${elitism} elitism`);
      }
    }
  });

  test("api-fix: the threshold reason sits where activateAbility checks it: after timing, before uses / condition / cost", () => {
    // A threshold nobody meets, plus a condition that fails and a cost that cannot be paid: the threshold is named.
    const unmet = abilityChar("Gated", {
      threshold: "ooooo",
      condition: { type: "battleActive" },
      costs: [{ type: "payResources", amount: 9 }]
    });
    const { engine, id } = devBoard([{ key: "g", def: unmet, owner: P1, zone: "play" }]);
    assert.equal(engine.getActivatedAbilityStatuses(P1)[0].unavailableBecause, "threshold");
    assert.equal(accepts(engine, activateAction(P1, id("g"), "use")), false);
    assert.throws(() => probe(engine).perform(activateAction(P1, id("g"), "use")), /threshold/i);
    // Not the player's moment: timing outranks the threshold, as in activateAbility.
    const idle = devBoard([{ key: "g", def: unmet, owner: P1, zone: "play" }], { activePlayerId: P2 });
    assert.equal(idle.engine.getActivatedAbilityStatuses(P1)[0].unavailableBecause, "timing");
    // A threshold of 0 is no threshold.
    const zero = devBoard([{ key: "z", def: abilityChar("Zero", { threshold: 0 }), owner: P1, zone: "play" }]);
    assert.equal(zero.engine.getActivatedAbilityStatuses(P1)[0].available, true);
  });
  test("REFACTOR ORACLE: getAvailableActivatedAbilities equals the pre-refactor implementation through whole games", () => {
    // The pre-Wave-3 body of getAvailableActivatedAbilities, kept verbatim as an oracle over the engine's private helpers.
    const oracle = (engine: SpoilsEngine, playerId: PlayerId) => {
      const e = engine as unknown as Record<string, (...args: unknown[]) => unknown> & { state: SpoilsEngine["state"] };
      const call = <T,>(name: string, ...args: unknown[]) => e[name].apply(engine, args) as T;
      if (!call<boolean>("canUseAbilityAtCurrentTiming", playerId)) return [];
      const result: Array<{ cardId: CardInstanceId; ability: ActivatedAbility }> = [];
      for (const card of Object.values(engine.state.cards)) {
        if (card.zone !== "play") continue;
        if (call<boolean>("hasRestriction", card.id, "cannotUseAbilities")) continue;
        const controlsIt = card.controllerId === playerId;
        for (const ability of call<ActivatedAbility[]>("getCardActivatedAbilities", card.id)) {
          if (card.faceDown && !ability.fromFaceDown) continue;
          const borrowMode = call<"ownNumeric" | "asOpponent" | undefined>("borrowedAbilityMode", playerId, card, ability);
          if (!controlsIt && ability.usableBy !== "anyPlayer" && ability.usableBy !== "opponent" && !borrowMode) continue;
          if (controlsIt && ability.usableBy === "opponent") continue;
          {
            const uses = engine.state.abilityUsesThisTurn[`${card.id}:${ability.id}`] ?? 0;
            if (uses >= Number.MAX_SAFE_INTEGER) continue;
            if (ability.usesPerTurn !== undefined && uses >= ability.usesPerTurn) continue;
          }
          const asPlayerId = borrowMode ? card.controllerId : playerId;
          const context = { sourceId: card.id, controllerId: asPlayerId, abilityId: ability.id, selected: {} as Record<string, CardInstanceId[]> };
          let costs = call<never[]>(
            "applyAbilityCostModifiers",
            card.id,
            ability.costs ?? [],
            asPlayerId,
            context,
            call("reductionAdjusts", call("pendingCostReductions", borrowMode === "ownNumeric" ? playerId : asPlayerId, engine.getDefinition(card.id).type, true)),
            playerId
          );
          let numericAffordable = true;
          if (borrowMode === "ownNumeric") {
            const split = call<{ numeric: number; rest: never[] }>("splitBorrowedNumericCost", costs, context);
            numericAffordable = engine.getAvailableResourceIds(playerId).length >= split.numeric;
            costs = split.rest;
          }
          if (
            numericAffordable &&
            (!ability.condition || engine.evaluateCondition(ability.condition, context)) &&
            call<boolean>("provisionalProbeTargets", ability.targets ?? [], context, call("pickStepIds", costs)) &&
            call<boolean>("provisionalProbeDiscardCosts", costs, context) &&
            call<boolean>("canPayCosts", (costs as Array<{ type: string }>).filter(c => c.type !== "pick"), context)
          ) {
            result.push({ cardId: card.id, ability });
          }
        }
      }
      return result;
    };

    const defs = cardsJson as CardDefinition[];
    const byId = new Map(defs.map(card => [card.id, card]));
    const needed = [...new Set([...arcanistDeckIds, ...warlordDeckIds])].map(cardId => byId.get(cardId)!);
    let compared = 0;
    let nonEmpty = 0;
    for (const [seed, first] of [[3, "arcanist"], [11, "warlord"]] as const) {
      const engine = createFactionGame(
        needed,
        [{ id: "arcanist", name: "A", deckDefinitionIds: arcanistDeckIds },
        { id: "warlord", name: "W", deckDefinitionIds: warlordDeckIds }],
        { firstPlayerId: first, seed }
      );
      const flowOf = engine.getFlowView.bind(engine);
      engine.getFlowView = () => {
        for (const player of ["arcanist", "warlord"]) {
          const now = engine.getAvailableActivatedAbilities(player);
          assert.deepEqual(now, oracle(engine, player));
          compared++;
          if (now.length > 0) nonEmpty++;
        }
        return flowOf();
      };
      playGameToCompletion(engine, { botRandom: mulberry32(seed ^ 0x5eed), maxActions: 4000 });
    }
    assert.ok(compared > 100, `compared ${compared} states`);
    assert.ok(nonEmpty > 10, `${nonEmpty} states had an available ability`);
  });
});

// --- 2. develop options -------------------------------------------------------------------------------------

describe("the Develop Rule's resource play", () => {
  const plainRes = resourceCard({ name: "Plain Rage", resource: { provides: ["rage"], staple: true } });
  const noFaceUp = resourceCard({ name: "Never Up", resource: { provides: ["rage"], staple: true, faceDownOnly: true } });
  const body = character({ name: "A Body" });

  const board = (extra: CardPlacement[] = [], options: Parameters<typeof buildGame>[0] = {}) =>
    devBoard(
      [
        { key: "res", def: plainRes, owner: P1, zone: "hand" },
        { key: "fdo", def: noFaceUp, owner: P1, zone: "hand" },
        { key: "body", def: body, owner: P1, zone: "hand" },
        ...extra
      ],
      options
    );

  /** Whether the Develop Rule, run on a copy of the game, puts `cardId` into play as a resource on the asked side. */
  function developAccepts(engine: SpoilsEngine, cardId: CardInstanceId, faceDown: boolean): boolean {
    const copy = probe(engine);
    try {
      developPlay(copy, P1, cardId, faceDown);
    } catch {
      return false;
    }
    const card = copy.state.cards[cardId];
    return card.zone === "play" && (card.faceDown ?? false) === faceDown;
  }

  /** The labels of the options the Develop Rule offers, on a copy of the game. */
  function developLabels(engine: SpoilsEngine): string[] {
    const copy = probe(engine);
    openDevelop(copy, P1);
    const pending = copy.state.pendingChoice;
    return pending?.kind === "chooserSelectsOption" ? pending.options.map(option => option.label ?? "") : [];
  }

  test("resource play: face-up / face-down rules per card agree with getResourcePlayFaces", () => {
    const { engine, id } = board();
    assert.deepEqual(developLabels(engine), ["Draw 1 card", "Play a resource"]);
    assert.deepEqual(engine.getResourcePlayFaces(P1, id("res")), { canFaceUp: true, canFaceDown: true });
    assert.equal(engine.getResourcePlayFaces(P1, id("fdo")).forcedFaceDown, "faceDownOnly");
    assert.equal(engine.getResourcePlayFaces(P1, id("body")).forcedFaceDown, "notAResource");
    for (const key of ["res", "fdo", "body"]) {
      const faces = engine.getResourcePlayFaces(P1, id(key));
      assert.equal(developAccepts(engine, id(key), false), faces.canFaceUp, `face-up ${key}`);
      assert.equal(developAccepts(engine, id(key), true), faces.canFaceDown, `face-down ${key}`);
    }
  });

  test("a real FLIP IT staple is face-down only", () => {
    const real = cardDef("Holy Heist", "Elitist Upgrade");
    const { engine, id } = board([{ key: "real", def: real, owner: P1, zone: "hand" }]);
    const faces = engine.getResourcePlayFaces(P1, id("real"));
    assert.equal(faces.canFaceUp, false);
    assert.equal(faces.forcedFaceDown, "faceDownOnly");
    assert.equal(developAccepts(engine, id("real"), false), false);
    assert.equal(developAccepts(engine, id("real"), true), true);
  });

  test("no resource play once the Develop Rule is used, or when the hand is empty", () => {
    const { engine, id } = board();
    developPlay(engine, P1, id("res"), false);
    // Used: the trigger's one use is spent, so nothing re-offers it.
    assert.equal(engine.state.pendingChoice, undefined);

    const empty = devBoard([]);
    assert.deepEqual(developLabels(empty.engine), ["Draw 1 card"]);
  });

  // Witty Worm: "While this card is in your hand you may reveal this card as you are playing a resource. If you do,
  // you may play this card for 1." Character, cost 4, threshold [O][O].
  const WORM = "5161057f-2ee8-4f52-be3d-1c983ac1e2e0";
  const wormBoard = (icons: Partial<Record<StapleIcon, number>>, spent: Partial<Record<StapleIcon, number>> = {}, withHand = true) =>
    devBoard([
      { key: "w", def: printing(WORM), owner: P1, zone: "hand" },
      ...(withHand ? [{ key: "hres", def: resourceCard({ name: "Hand Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" } as CardPlacement] : []),
      ...res(icons),
      ...res(spent).map((p): CardPlacement => ({ ...p, attachedToKey: "__factionA" }))
    ]);

  /** Plays the Develop Rule's resource on a copy of the game, up to the point the Worm's reveal would be offered. */
  function developToReveal(engine: SpoilsEngine, resourceId?: CardInstanceId): SpoilsEngine {
    const copy = probe(engine);
    openDevelop(copy, P1);
    chooseDevelopOption(copy, P1, "Play a resource");
    if (copy.state.pendingChoice?.kind === "chooserSelectsTarget") {
      copy.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [resourceId!] } });
    }
    return copy;
  }

  test("Witty Worm reveal: offered only with its threshold [O][O] and a resource to pay the 1, and taken when offered", () => {
    const cases: Array<{ name: string; game: ReturnType<typeof wormBoard>; playable: boolean }> = [
      { name: "three [O]", game: wormBoard({ obsession: 3 }), playable: true },
      { name: "exactly two [O], one to spare", game: wormBoard({ obsession: 2 }), playable: true },
      { name: "one [O] among others", game: wormBoard({ obsession: 1, greed: 5 }), playable: false },
      { name: "no [O]", game: wormBoard({ greed: 6 }), playable: false },
      { name: "all spent, no hand resource", game: wormBoard({}, { obsession: 2 }, false), playable: false }
    ];
    for (const { name, game, playable } of cases) {
      const wormId = game.id("w");
      // With no other hand card the Worm is itself the resource played, so it is never offered for a reveal.
      const copy = developToReveal(game.engine, game.engine.state.players[P1].hand.find(cardId => cardId !== wormId));
      const pending = copy.state.pendingChoice;
      const offered = pending?.kind === "resourceReveal" && pending.candidates.includes(wormId);
      assert.equal(offered, playable, `${name}: the reveal is offered exactly when playable`);
      if (offered) {
        copy.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "resourceReveal", cardId: wormId } });
        assert.equal(copy.state.cards[wormId].zone, "play", `${name}: the reveal deploys the Worm`);
      }
    }
  });

  test("Witty Worm reveal: threshold met by spent resources, nothing ready: the reveal is not offered, the resource played along has not entered play to pay the 1", () => {
    const { engine, id } = wormBoard({}, { obsession: 2 });
    const copy = developToReveal(engine, id("hres"));
    // CR 605.1c: the reveal happens after the resource is chosen and before it enters play, so with every resource
    // spent there is nothing to pay the 1 with yet; the resource simply enters play afterwards.
    const pending = copy.state.pendingChoice;
    assert.equal(pending?.kind === "resourceReveal" && pending.candidates.includes(id("w")), false);
    assert.equal(pending?.kind, "playResource");
    copy.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown: false } });
    assert.equal(copy.state.pendingChoice, undefined);
    assert.equal(copy.state.cards[id("hres")].zone, "play");
    assert.equal(copy.state.cards[id("w")].zone, "hand");
  });

  test("Witty Worm reveal is not offered again when the Develop Rule is spent", () => {
    const { engine, id } = wormBoard({ obsession: 3 });
    const copy = developToReveal(engine, id("hres"));
    assert.equal(copy.state.pendingChoice?.kind, "resourceReveal");
    // Declining the reveal leaves the face choice; once the resource is in play the rule is spent.
    copy.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "resourceReveal" } });
    copy.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown: false } });
    assert.equal(copy.state.pendingChoice, undefined);
    assert.equal(copy.state.cards[id("hres")].zone, "play");
    assert.equal(copy.state.cards[id("w")].zone, "hand");
  });

  test("the effect-made reveal offer (resourceRevealCandidates) is unchanged by the shared check", () => {
    // A hand with the Worm and a resource to put into play by an effect: the engine still opens the same offer.
    const putter = item({
      name: "Putter",
      behavior: {
        abilities: [
          {
            id: "use",
            type: "activated",
            targets: [{ id: "h", selector: { zone: "hand", owner: "self", type: "resource" }, count: 1 }],
            effects: [{ type: "playResource", target: { type: "selected", id: "h" } }]
          }
        ]
      }
    });
    const game = (obsession: number) =>
      devBoard([
        { key: "w", def: printing(WORM), owner: P1, zone: "hand" },
        { key: "hres", def: plainRes, owner: P1, zone: "hand" },
        { key: "putter", def: putter, owner: P1, zone: "play" },
        ...res({ obsession })
      ]);
    for (const [obsession, offered] of [[3, true], [1, false]] as const) {
      const g = game(obsession);
      g.engine.perform({ ...activateAction(P1, g.id("putter"), "use"), selected: { h: [g.id("hres")] } } as GameAction);
      resolvePendingResponses(g.engine);
      assert.equal(g.engine.state.pendingChoice?.kind === "resourceReveal", offered, `${obsession} [O]`);
      if (!offered) {
        // The face choice comes instead, with the new hint.
        const choice = g.engine.state.pendingChoice as Extract<PendingChoice, { kind: "playResource" }>;
        assert.equal(choice.kind, "playResource");
        assert.equal(choice.canFaceUp, true);
      }
    }
  });
});

// --- 3. mulligan preview ------------------------------------------------------------------------------------

describe("previewMulligan", () => {
  const CHEST = "fe7095e0-d918-420c-9303-fbc5054d2564";
  const DEC = resourceCard({ id: "cq-dec", name: "Dec", resource: { provides: ["deception"], staple: true } });
  const RGE = resourceCard({ id: "cq-rge", name: "Rge", resource: { provides: ["rage"], staple: true } });
  const FILL = character({ id: "cq-fill", name: "Filler", life: 2 });
  const repeat = <T,>(x: T, n: number): T[] => Array.from({ length: n }, () => x);
  const mulliganFaction = (startName: string) =>
    factionCard({
      id: `cq-faction-${startName}`,
      name: `Faction ${startName}`,
      faction: defaultFactionDefinition({
        startingInfluence: 20,
        setup: {
          startingResources: { count: 2, names: [startName] },
          openingHand: { goingFirst: 4, goingSecond: 4 },
          mulligan: { count: 3, mode: "replaceAny" }
        },
        turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "draw", count: 1 }] } }
      })
    });
  function chestInHand(holder: PlayerId, startName: "Dec" | "Rge") {
    const faction = mulliganFaction(startName);
    const withChest = [DEC, DEC, RGE, RGE, printing(CHEST), ...repeat(FILL, 8)];
    const without = [DEC, DEC, RGE, RGE, ...repeat(FILL, 9)];
    for (let seed = 1; seed < 400; seed++) {
      const engine = setupGame(
        { faction, deck: holder === P1 ? withChest : without },
        { faction, deck: holder === P2 ? withChest : without },
        { seed }
      );
      const chestId = engine.state.players[holder].hand.find(cardId => engine.getDefinition(cardId).name === "Community Chest");
      if (chestId) return { engine, chestId };
    }
    throw new Error("no seed put the Community Chest into the opening hand");
  }
  const mulliganAction = (playerId: PlayerId, cardIds: CardInstanceId[]): GameAction => ({ type: "mulligan", playerId, cardIds }) as GameAction;

  test("a plain mulligan: the incoming cards are exactly what the real mulligan draws, and the live game is untouched", () => {
    const { engine } = chestInHand(P1, "Rge");
    const hand = [...engine.state.players[P1].hand];
    const send = hand.slice(0, 2);
    const before = structuredClone(engine.state);
    const preview = engine.previewMulligan(P1, send);
    assert.deepEqual(engine.state, before, "the live game did not change");
    assert.equal(preview.maxCards, hand.length);
    assert.equal(preview.pausesForPrompt, false);
    assert.equal(preview.incoming.length, 2);

    engine.perform(mulliganAction(P1, send));
    const drawn = engine.state.players[P1].hand.filter(cardId => !hand.includes(cardId));
    assert.deepEqual(preview.incoming, drawn);
  });

  test("keeping the hand: nothing comes in", () => {
    const { engine } = chestInHand(P1, "Rge");
    assert.deepEqual(engine.previewMulligan(P1, []), { incoming: [], maxCards: 4, pausesForPrompt: false });
  });

  test("Community Chest bottomed with [D]: the preview says a prompt holds the redraw, and the real mulligan agrees", () => {
    const { engine, chestId } = chestInHand(P1, "Dec");
    const hand = [...engine.state.players[P1].hand];
    const preview = engine.previewMulligan(P1, [chestId]);
    assert.equal(preview.pausesForPrompt, true);
    assert.equal(preview.incoming.length, 1);

    engine.perform(mulliganAction(P1, [chestId]));
    assert.equal(engine.state.pendingChoice?.kind, "mayPay", "the real mulligan stops at the Chest's reveal question");
    assert.equal(engine.state.players[P1].hand.length, 3, "the redraw is held");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } } as GameAction);
    const drawn = engine.state.players[P1].hand.filter(cardId => !hand.includes(cardId));
    assert.deepEqual(preview.incoming, drawn, "answering it draws the cards the preview named");
  });

  test("Community Chest bottomed WITHOUT [D]: no prompt, and the preview says so", () => {
    const { engine, chestId } = chestInHand(P1, "Rge");
    const preview = engine.previewMulligan(P1, [chestId]);
    assert.equal(preview.pausesForPrompt, false);
    engine.perform(mulliganAction(P1, [chestId]));
    assert.equal(engine.state.pendingChoice, undefined);
  });

  test("it refuses what mulligan refuses", () => {
    const { engine, chestId } = chestInHand(P1, "Rge");
    const hand = engine.state.players[P1].hand;
    const foreign = engine.state.players[P2].hand[0];
    assert.throws(() => engine.previewMulligan(P1, [foreign]));
    assert.throws(() => engine.previewMulligan(P1, [chestId, chestId]));
    assert.throws(() => engine.previewMulligan(P2, []), /not this player's mulligan/);
    assert.ok(hand.length > 0);
  });
});

// --- 4. cost affordability ----------------------------------------------------------------------------------

describe("getCostAffordability", () => {
  test("ability mode counts Department of Rejections' tax, and agrees with activateAbility", () => {
    const dept = cardDef("Seed", "Department of Rejections");
    const worker = abilityChar("Worker", { costs: [{ type: "payResources", amount: 1 }] });
    for (const ready of [1, 2, 3, 4]) {
      const { engine, id } = devBoard(
        [
          { key: "dept", def: dept, owner: P1, zone: "play" },
          { key: "worker", def: worker, owner: P2, zone: "play" },
          ...res({ rage: ready }, P2)
        ],
        { activePlayerId: P2, turn: 2 }
      );
      const answer = engine.getCostAffordability(P2, [{ type: "payResources", amount: 1 }], { sourceId: id("worker"), abilityId: "use", as: "ability" });
      assert.equal(answer.need, 3, "1 printed + 2 tax");
      assert.equal(answer.have, ready);
      assert.equal(answer.payable, ready >= 3);
      assert.equal(answer.reason === undefined, answer.payable);
      assert.equal(accepts(engine, activateAction(P2, id("worker"), "use")), answer.payable, `${ready} resources`);
      // Without the tax the same cost is 1.
      const plain = engine.getCostAffordability(P2, [{ type: "payResources", amount: 1 }], { sourceId: id("worker") });
      assert.equal(plain.need, 1);
      assert.equal(plain.payable, ready >= 1);
    }
  });

  test("mayPay mode counts a pending 'reduce the next numeric cost', and agrees with whether the offer is made", () => {
    const gizmo = item({
      name: "Gizmo",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            effects: [
              {
                type: "mayPay",
                player: "controller",
                costs: [{ type: "payResources", amount: 3 }],
                effects: [{ type: "draw", player: "controller", amount: 1 }],
                elseEffects: []
              }
            ]
          }
        ]
      }
    });
    for (const reduced of [false, true]) {
      const { engine, id } = devBoard([{ key: "g", def: gizmo, owner: P1, zone: "play" }, ...res({ rage: 2 })]);
      if (reduced) {
        engine.state.costReductions.push({ id: "red", playerId: P1, amount: 1, cardType: "item", includeAbilities: true, createdTurn: 1 });
      }
      const answer = engine.getCostAffordability(P1, [{ type: "payResources", amount: 3 }], { sourceId: id("g") });
      assert.equal(answer.need, reduced ? 2 : 3);
      assert.equal(answer.have, 2);
      assert.equal(answer.payable, reduced);
      engine.perform(activateAction(P1, id("g"), "go"));
      resolvePendingResponses(engine);
      assert.equal(engine.state.pendingChoice?.kind === "mayPay", answer.payable, "the offer is made exactly when the cost is payable");
    }
  });

  test("a cost without a numeric part has no need; a discard it cannot pay says why", () => {
    const { engine, id } = devBoard([{ key: "c", def: abilityChar("C"), owner: P1, zone: "play" }]);
    const none = engine.getCostAffordability(P1, [], { sourceId: id("c") });
    assert.deepEqual(none, { payable: true, have: 0 });
    const discard = engine.getCostAffordability(
      P1,
      [{ type: "discard", id: "d", player: "controller", selector: {}, count: 1 }],
      { sourceId: id("c"), as: "ability" }
    );
    assert.equal(discard.payable, false);
    assert.ok(discard.reason);
  });
});

// --- 5. life remaining ----------------------------------------------------------------------------------------

describe("getLifeRemaining", () => {
  test("life or structure minus damage, floored at 0", () => {
    const { engine, id } = devBoard([
      { key: "c", def: character({ name: "Soldier", life: 3 }), owner: P1, zone: "play", damage: 1 },
      { key: "dead", def: character({ name: "Doomed", life: 3 }), owner: P1, zone: "play", damage: 5 },
      { key: "loc", def: location({ name: "Keep", structure: 4 }), owner: P1, zone: "play", damage: 3 },
      { key: "it", def: item({ name: "Trinket" }), owner: P1, zone: "play" }
    ]);
    assert.equal(engine.getLifeRemaining(id("c")), 2);
    assert.equal(engine.getLifeRemaining(id("dead")), 0);
    assert.equal(engine.getLifeRemaining(id("loc")), 1);
    assert.equal(engine.getLifeRemaining(id("it")), 0);
    // Effective life counts: a modifier changes it.
    engine.state.modifiers.push({
      id: "m",
      targetId: id("c"),
      stat: "life",
      operation: "add",
      value: 2,
      duration: { type: "untilEndOfTurn" },
      createdTurn: 1
    } as never);
    assert.equal(engine.getLifeRemaining(id("c")), 4);
  });
});

// --- 6. view additions ----------------------------------------------------------------------------------------

/** The client's old rule table (core views.ts getActingPlayerId), as an independent oracle. */
function clientActingPlayer(flow: GameFlowView): PlayerId | undefined {
  switch (flow.mode) {
    case "setup":
      return flow.setup.phase === "mulligan" || flow.setup.phase === "chooseStartingResources" || flow.setup.phase === "startingDrawSearch"
        ? flow.setup.order[flow.setup.currentIndex]
        : undefined;
    case "main":
      return flow.activePlayerId;
    case "response":
      return flow.responseWindow?.priorityPlayerId;
    case "battleChoice":
      return flow.battle?.actingPlayerId;
    case "pendingChoice":
      return flow.pendingChoice?.playerId;
    default:
      return undefined;
  }
}

describe("GameFlowView.actingPlayerId", () => {
  const check = (engine: SpoilsEngine, mode: GameFlowView["mode"], who: PlayerId | undefined) => {
    const flow = engine.getFlowView();
    assert.equal(flow.mode, mode);
    assert.equal(flow.actingPlayerId, who, `${mode}`);
    assert.equal(flow.actingPlayerId, clientActingPlayer(flow), `${mode}: same as the client's table`);
  };

  test("main, response, resolvingResponses, pendingChoice, battle modes and game over", () => {
    const bolt = tactic({ name: "Idle Tactic", cost: 0, behavior: { abilities: [{ id: "x", type: "activated", effects: [] }] } });
    const asker = tactic({
      name: "Asker",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "ask",
            type: "activated",
            effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [], elseEffects: [] }]
          }
        ]
      }
    });
    const { engine, id } = devBoard(
      [
        { key: "bolt", def: bolt, owner: P1, zone: "hand" },
        { key: "asker", def: asker, owner: P1, zone: "hand" },
        { key: "atk", def: character({ name: "Attacker", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blocker", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
        ...res({ rage: 2 })
      ],
      { turn: 1 }
    );
    check(engine, "main", P1);

    // A tactic into the window: P2 holds priority.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bolt"), selected: {}, variables: {} } as GameAction);
    check(engine, "response", P2);
    engine.perform({ type: "passPriority", playerId: P2 });
    const mid = engine.getFlowView();
    if (mid.mode === "response") check(engine, "response", mid.responseWindow!.priorityPlayerId);
    else check(engine, "resolvingResponses", undefined);
    resolvePendingResponses(engine);
    check(engine, "main", P1);

    // A question for P1.
    engine.perform({ type: "playCard", playerId: P1, cardId: id("asker"), selected: {}, variables: {} } as GameAction);
    resolvePendingResponses(engine);
    check(engine, "pendingChoice", P1);
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: false } } as GameAction);
    resolvePendingResponses(engine);

    // A battle: declared, then P2 blocks, then each side assigns.
    declareAttackBy(engine, P1, [id("atk")]);
    const modes = new Set<string>();
    for (let guard = 0; guard < 40 && engine.state.battle; guard++) {
      const flow = engine.getFlowView();
      modes.add(flow.mode);
      assert.equal(flow.actingPlayerId, clientActingPlayer(flow), `${flow.mode} / ${flow.battle?.phase}`);
      if (flow.mode === "battleChoice" && flow.battle!.phase === "blocking") {
        assert.equal(flow.actingPlayerId, P2);
        engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
      } else if (flow.battle?.phase === "attackerDamageAssignment") {
        assert.equal(flow.actingPlayerId, P1);
        engine.perform({ type: "assignBattleDamage", playerId: P1, assignments: flow.battle.forcedAssignments ?? [] });
      } else if (flow.battle?.phase === "defenderDamageAssignment") {
        assert.equal(flow.actingPlayerId, P2);
        engine.perform({ type: "assignBattleDamage", playerId: P2, assignments: flow.battle.forcedAssignments ?? [] });
      } else if (flow.mode === "response") {
        engine.perform({ type: "passPriority", playerId: flow.actingPlayerId! });
      } else {
        engine.perform({ type: "advanceFlow" });
      }
    }
    assert.ok(modes.has("battleChoice"), "saw a battle decision");

    engine.state.winner = P1;
    check(engine, "gameOver", undefined);
  });

  test("setup: mulligan seat order", () => {
    const FILL = character({ id: "cq-aps-fill", name: "Filler" });
    const faction = factionCard({
      id: "cq-aps-faction",
      name: "Aps",
      faction: defaultFactionDefinition({
        startingInfluence: 10,
        setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 2, goingSecond: 2 }, mulligan: { count: 1, mode: "replaceAny" } }
      })
    });
    const engine = setupGame({ faction, deck: Array.from({ length: 8 }, () => FILL) }, { faction, deck: Array.from({ length: 8 }, () => FILL) }, { first: P2 });
    check(engine, "setup", P2);
    engine.perform({ type: "mulligan", playerId: P2, cardIds: [] } as GameAction);
    check(engine, "setup", P1);
  });

  test("setup: choosing starting resources", () => {
    const RAGE = resourceCard({ id: "cq-sr-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
    const GREED = resourceCard({ id: "cq-sr-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });
    const FILLER = character({ id: "cq-sr-filler", name: "Filler" });
    const FACTION = factionCard({
      id: "cq-sr-faction",
      name: "Choosers",
      faction: defaultFactionDefinition({
        startingInfluence: 10,
        setup: { startingResources: { count: 2, stapleOnly: true }, openingHand: { goingFirst: 2, goingSecond: 2 }, mulligan: { count: 1, mode: "replaceAny" } }
      })
    });
    const deck = [FACTION.id, ...Array(4).fill(RAGE.id), ...Array(4).fill(GREED.id), ...Array(5).fill(FILLER.id)] as string[];
    const engine = createFactionGame(
      [FACTION, RAGE, GREED, FILLER],
      [{ id: P1, name: "Alice", deckDefinitionIds: deck },
      { id: P2, name: "Bob", deckDefinitionIds: deck }],
      { firstPlayerId: P1, chooseStartingResources: true }
    );
    assert.equal(engine.state.setup.phase, "chooseStartingResources");
    check(engine, "setup", P1);
  });
});

describe("BattleView.forcedAssignments / upcomingSpeeds", () => {
  /** A battle driven to its first damage-assignment step. */
  function toAssignment(blockers: string[], attackers = ["atk"]) {
    const game = devBoard([
      ...attackers.map((key, i): CardPlacement => ({ key, def: character({ name: `Attacker ${i}`, strength: 2, life: 9, speed: 3 }), owner: P1, zone: "play" })),
      { key: "b1", def: character({ name: "Blocker 1", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "Blocker 2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "zero", def: character({ name: "Zero", strength: 0, life: 9, speed: 3 }), owner: P1, zone: "play" }
    ]);
    const { engine, id } = game;
    declareAttackBy(engine, P1, attackers.map(id));
    let guard = 0;
    while (engine.state.battle && guard++ < 50) {
      const view = engine.getBattleView()!;
      if (view.phase === "blocking") {
        engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blockers.map(id) });
      } else if (view.phase === "attackerDamageAssignment" || view.phase === "defenderDamageAssignment") {
        break;
      } else if (engine.state.responseWindow) {
        resolvePendingResponses(engine);
      } else {
        engine.perform({ type: "advanceFlow" });
      }
    }
    return game;
  }

  test("unblocked, the only legal target is the faction: forced, and perform accepts exactly that", () => {
    const { engine, id } = toAssignment([]);
    const view = engine.getBattleView()!;
    assert.equal(view.phase, "attackerDamageAssignment");
    assert.deepEqual(view.forcedAssignments, [{ sourceId: id("atk"), target: { type: "faction", playerId: P2 }, amount: 2 }]);
    assert.ok(accepts(engine, { type: "assignBattleDamage", playerId: P1, assignments: view.forcedAssignments as BattleDamageAssignment[] }));
    assert.equal(engine.getFlowView().battle?.forcedAssignments?.length, 1);
  });

  test("blocked by one character: forced onto it, on both sides", () => {
    const { engine, id } = toAssignment(["b1"]);
    const view = engine.getBattleView()!;
    assert.deepEqual(view.forcedAssignments, [{ sourceId: id("atk"), target: { type: "card", cardId: id("b1") }, amount: 2 }]);
    assert.ok(accepts(engine, { type: "assignBattleDamage", playerId: P1, assignments: view.forcedAssignments as BattleDamageAssignment[] }));
    engine.perform({ type: "assignBattleDamage", playerId: P1, assignments: view.forcedAssignments as BattleDamageAssignment[] });
  });

  test("blocked by two characters: a real choice, so null; both splits are legal", () => {
    const { engine, id } = toAssignment(["b1", "b2"]);
    const view = engine.getBattleView()!;
    assert.equal(view.forcedAssignments, null);
    const allOnOne: BattleDamageAssignment[] = [{ sourceId: id("atk"), target: { type: "card", cardId: id("b1") }, amount: 2 }];
    const split: BattleDamageAssignment[] = [
      { sourceId: id("atk"), target: { type: "card", cardId: id("b1") }, amount: 1 },
      { sourceId: id("atk"), target: { type: "card", cardId: id("b2") }, amount: 1 }
    ];
    assert.ok(accepts(engine, { type: "assignBattleDamage", playerId: P1, assignments: allOnOne }));
    assert.ok(accepts(engine, { type: "assignBattleDamage", playerId: P1, assignments: split }));
  });

  test("a zero-strength source deals nothing: forced is the empty assignment, and perform takes it", () => {
    const { engine } = toAssignment([], ["zero"]);
    const view = engine.getBattleView()!;
    assert.deepEqual(view.forcedAssignments, []);
    assert.ok(accepts(engine, { type: "assignBattleDamage", playerId: P1, assignments: [] }));
  });

  test("outside a damage step it is null; upcomingSpeeds lists the speeds still to strike, highest first", () => {
    const { engine, id } = devBoard([
      { key: "atk", def: character({ name: "Fast", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Slow", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "mid", def: character({ name: "Middle", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ]);
    declareAttackBy(engine, P1, [id("atk")]);
    const blocking = engine.getBattleView()!;
    assert.equal(blocking.phase, "blocking");
    assert.equal(blocking.forcedAssignments, null);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk"), id("mid")] });
    let guard = 0;
    while (engine.getBattleView()?.phase !== "attackerDamageAssignment" && guard++ < 30) {
      if (engine.state.responseWindow) resolvePendingResponses(engine);
      else engine.perform({ type: "advanceFlow" });
    }
    const view = engine.getBattleView()!;
    assert.equal(view.speed, 3);
    assert.deepEqual(view.upcomingSpeeds, [2, 1]);
  });
});

// --- 7. pending-choice hints --------------------------------------------------------------------------------

describe("pending choice hints", () => {
  const ask = (effect: Record<string, unknown>) => {
    const asker = item({
      name: "Asker",
      behavior: { abilities: [{ id: "ask", type: "activated", effects: [effect as never] }] }
    });
    const game = devBoard([{ key: "a", def: asker, owner: P1, zone: "play" }]);
    game.engine.perform(activateAction(P1, game.id("a"), "ask"));
    resolvePendingResponses(game.engine);
    return game;
  };
  const resolveAction = (choice: unknown): GameAction => ({ type: "resolvePendingChoice", playerId: P1, choice }) as GameAction;

  test("nameValue.options lists exactly the icons that are accepted, and checkNameValue agrees with perform", () => {
    const { engine } = ask({ type: "nameValue", chooser: "controller", valueKind: "resourceIcon", storeAs: "icon", exclude: ["volition"] });
    const pending = engine.state.pendingChoice as Extract<PendingChoice, { kind: "nameValue" }>;
    assert.equal(pending.kind, "nameValue");
    assert.deepEqual(pending.options, ["rage", "greed", "deception", "elitism", "obsession"]);
    assert.deepEqual(engine.getFlowView().pendingChoice, pending);
    for (const value of [...pending.options!, "volition", "banana", "", "RAGE"]) {
      const check = engine.checkNameValue(pending, value);
      assert.equal(check.ok, accepts(engine, resolveAction({ kind: "nameValue", value })), `'${value}'`);
      if (!check.ok) assert.ok(check.error.length > 0);
    }
  });

  test("trade options, and an open kind has no list", () => {
    const trade = ask({ type: "nameValue", chooser: "controller", valueKind: "trade", storeAs: "t", exclude: ["universal"] });
    const pending = trade.engine.state.pendingChoice as Extract<PendingChoice, { kind: "nameValue" }>;
    assert.deepEqual(pending.options, ["arcanist", "banker", "gearsmith", "rogue", "warlord"]);
    for (const value of [...pending.options!, "universal", "Banker", "nobody"]) {
      assert.equal(trade.engine.checkNameValue(pending, value).ok, accepts(trade.engine, resolveAction({ kind: "nameValue", value })), value);
    }
    const open = ask({ type: "nameValue", chooser: "controller", valueKind: "cardName", storeAs: "n", nonResource: true });
    const openPending = open.engine.state.pendingChoice as Extract<PendingChoice, { kind: "nameValue" }>;
    assert.equal(openPending.options, undefined);
  });

  test("a non-resource card name is checked against the catalog, the same way for the query and perform", () => {
    const { engine } = ask({ type: "nameValue", chooser: "controller", valueKind: "cardName", storeAs: "n", nonResource: true });
    engine.setCardCatalog([
      { name: "Some Tactic", cardType: "tactic" },
      { name: "Some Resource", cardType: "resource" }
    ]);
    const pending = engine.state.pendingChoice as Extract<PendingChoice, { kind: "nameValue" }>;
    for (const value of ["Some Tactic", "some tactic", "Some Resource", "No Such Card", ""]) {
      assert.equal(engine.checkNameValue(pending, value).ok, accepts(engine, resolveAction({ kind: "nameValue", value })), `'${value}'`);
    }
    assert.equal(engine.checkNameValue(pending, "Some Tactic").ok, true);
    assert.equal(engine.checkNameValue(pending, "Some Resource").ok, false);
  });

  test("chooserSelectsOption.style: authored list = oneOf; the yes of an otherPlayerChooses may = yesNo; a oneOf cost = costBranch", () => {
    const list = ask({
      type: "chooserSelectsOption",
      chooser: "controller",
      options: [
        { label: "One", effects: [] },
        { label: "Two", effects: [] }
      ]
    });
    assert.equal((list.engine.state.pendingChoice as Extract<PendingChoice, { kind: "chooserSelectsOption" }>).style, "oneOf");

    // A oneOf COST ("Pay 1 or pay 2"): both branches payable, so the payer is asked which.
    const brancher = item({
      name: "Brancher",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            costs: [{ type: "oneOf", options: [[{ type: "payResources", amount: 1 }], [{ type: "payResources", amount: 2 }]] }],
            effects: []
          }
        ]
      }
    });
    const costGame = devBoard([{ key: "b", def: brancher, owner: P1, zone: "play" }, ...res({ rage: 3 })]);
    costGame.engine.perform(activateAction(P1, costGame.id("b"), "go"));
    const costChoice = costGame.engine.state.pendingChoice as Extract<PendingChoice, { kind: "chooserSelectsOption" }>;
    assert.equal(costChoice.kind, "chooserSelectsOption");
    assert.equal(costChoice.style, "costBranch");

    // "Your opponent may pay ..." as an otherPlayerChooses `may` cost step.
    const maybe = item({
      name: "Maybe",
      behavior: {
        abilities: [
          {
            id: "go",
            type: "activated",
            costs: [{ type: "otherPlayerChooses", chooser: "opponent", may: true, effects: [] }],
            effects: []
          }
        ]
      }
    });
    const mayGame = devBoard([{ key: "m", def: maybe, owner: P1, zone: "play" }]);
    mayGame.engine.perform(activateAction(P1, mayGame.id("m"), "go"));
    const mayChoice = mayGame.engine.state.pendingChoice as Extract<PendingChoice, { kind: "chooserSelectsOption" }>;
    assert.equal(mayChoice.kind, "chooserSelectsOption");
    assert.equal(mayChoice.style, "yesNo");
    assert.equal(mayChoice.optionCount, 2);
  });

  test("playResource.canFaceUp: a real resource card may go up; the choice is only raised for those", () => {
    const putter = item({
      name: "Putter",
      behavior: {
        abilities: [
          {
            id: "use",
            type: "activated",
            targets: [{ id: "h", selector: { zone: "hand", owner: "self" }, count: 1 }],
            effects: [{ type: "playResource", target: { type: "selected", id: "h" } }]
          }
        ]
      }
    });
    const plain = resourceCard({ name: "Plain", resource: { provides: ["rage"], staple: true } });
    const game = devBoard([
      { key: "p", def: putter, owner: P1, zone: "play" },
      { key: "r", def: plain, owner: P1, zone: "hand" }
    ]);
    game.engine.perform({ ...activateAction(P1, game.id("p"), "use"), selected: { h: [game.id("r")] } } as GameAction);
    resolvePendingResponses(game.engine);
    const choice = game.engine.state.pendingChoice as Extract<PendingChoice, { kind: "playResource" }>;
    assert.equal(choice.kind, "playResource");
    assert.equal(choice.canFaceUp, true);
    assert.ok(accepts(game.engine, resolveAction({ kind: "playResource", faceDown: false })));
  });
});

// --- 8. exports ---------------------------------------------------------------------------------------------

describe("new exports", () => {
  test("withBuiltInFactionDefaults, isStapleResourceDefinition and ATTACH_TARGET_ID are public", () => {
    assert.equal(ATTACH_TARGET_ID, "attachTo");
    assert.equal(isStapleResourceDefinition(resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } })), true);
    assert.equal(isStapleResourceDefinition(character({ name: "Nobody" })), false);
    const faction = factionCard({ name: "Tournament Faction" });
    assert.ok(withBuiltInFactionDefaults(faction).faction);
  });
});
