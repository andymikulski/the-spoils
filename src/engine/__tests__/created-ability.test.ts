// Q51B: the ability both players create for The Open R&D Faction is picked from a CLOSED MENU
// (`CREATED_ABILITY_MENU`), never typed. `buildCreatedAbility` turns a `CreatedAbilitySpec` into an
// engine-native `ActivatedAbility` plus generated rules text; `validateCreatedAbilitySpec` refuses
// anything off the menu; setup takes the spec (`FactionGameSetupOptions.createdAbility`).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  bank,
  buildGame,
  character,
  P1,
  P2
} from "./per-card/_harness.js";
import { resolvePendingResponses, defaultFactionDefinition, factionCard } from "./support/fixtures.js";
import {
  buildCreatedAbility,
  CREATED_ABILITY_ID,
  CREATED_ABILITY_MENU,
  createTwoPlayerFactionGame,
  validateCreatedAbilitySpec
} from "../../engine.js";
import type {
  CardInstanceId,
  CreatedAbilitySpec,
  CreatedEffectKind,
  PlayerId,
  SpoilsEngine
} from "../../engine.js";

const PICK = "created-pick";
const DISCARD = "created-discard";

const rdFaction = () =>
  factionCard({
    id: "q51b-rd",
    name: "Q51B R&D",
    faction: defaultFactionDefinition({
      playerCreatedAbility: true,
      startingInfluence: 20,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 1, goingSecond: 1 } }
    })
  });

/**
 * A mid-game board with the R&D faction for P1: 6 ready resources each, 3 cards in each hand, 6 in each deck,
 * and one healthy character each (P1's `mine`, P2's `theirs`) plus one depleted character each.
 */
function board(spec: CreatedAbilitySpec) {
  const cards = [
    ...bank("rage", 6, P1),
    ...bank("rage", 6, P2),
    ...[P1, P2].flatMap((owner) => [
      ...Array.from({ length: 3 }, (_, i) => ({ key: `hand-${owner}-${i}`, def: character({ name: `Hand ${owner} ${i}` }), owner, zone: "hand" as const })),
      ...Array.from({ length: 6 }, (_, i) => ({ key: `deck-${owner}-${i}`, def: character({ name: `Deck ${owner} ${i}` }), owner, zone: "deck" as const })),
      { key: `char-${owner}`, def: character({ name: `Char ${owner}`, life: 5 }), owner, zone: "play" as const },
      { key: `tired-${owner}`, def: character({ name: `Tired ${owner}`, life: 5 }), owner, zone: "play" as const, depleted: true }
    ])
  ];
  const built = buildGame({ playerA: { faction: rdFaction() }, cards });
  assert.equal(built.engine.applyCreatedFactionAbility(spec), 1, "exactly the one R&D faction card receives the ability");
  return built;
}

type Built = ReturnType<typeof board>;

const factionOf = (engine: SpoilsEngine, pid: PlayerId): CardInstanceId => engine.state.players[pid].factionId!;
// The R&D faction card is P1's; both players use THAT card's ability.
const rdCard = (engine: SpoilsEngine): CardInstanceId => factionOf(engine, P1);
const turnOf = (engine: SpoilsEngine, pid: PlayerId): void => {
  engine.state.activePlayerId = pid;
  engine.state.priorityPlayerId = pid;
};
const listed = (engine: SpoilsEngine, pid: PlayerId): string[] =>
  engine.getAvailableActivatedAbilities(pid).filter((a) => a.cardId === rdCard(engine)).map((a) => a.ability.id);
const ready = (engine: SpoilsEngine, pid: PlayerId): number => engine.getAvailableResourceCount(pid);

function use(b: Built, pid: PlayerId, selected: Record<string, CardInstanceId[]> = {}): void {
  turnOf(b.engine, pid);
  b.engine.perform({ type: "activateAbility", playerId: pid, cardId: rdCard(b.engine), abilityId: CREATED_ABILITY_ID, selected, variables: {} } as never);
  resolvePendingResponses(b.engine);
}

const other = (pid: PlayerId): PlayerId => (pid === P1 ? P2 : P1);

// One cheap, always-payable cost so each effect test isolates the effect.
const lose1 = { kind: "loseInfluence", amount: 1 } as const;

describe("Q51B: the menu is data", () => {
  test("every part has a label, bounds a UI can render, and the menu is plain JSON", () => {
    const kinds = new Set<string>();
    for (const entry of [...CREATED_ABILITY_MENU.costs, ...CREATED_ABILITY_MENU.effects]) {
      assert.ok(!kinds.has(entry.kind), `kind "${entry.kind}" is listed once`);
      kinds.add(entry.kind);
      assert.ok(entry.label.length > 0);
      if (entry.min !== undefined || entry.max !== undefined || entry.defaultAmount !== undefined) {
        assert.ok(Number.isInteger(entry.min) && Number.isInteger(entry.max) && Number.isInteger(entry.defaultAmount), `${entry.kind}: bounds and default are whole numbers`);
        assert.ok(entry.min! >= 1 && entry.min! <= entry.defaultAmount! && entry.defaultAmount! <= entry.max!, `${entry.kind}: min <= default <= max`);
      }
    }
    assert.deepEqual(JSON.parse(JSON.stringify(CREATED_ABILITY_MENU)), CREATED_ABILITY_MENU);
    assert.deepEqual(CREATED_ABILITY_MENU.costs.map((c) => c.kind), ["pay", "loseInfluence", "discardCard"]);
    assert.equal(CREATED_ABILITY_MENU.effects.length, 9);
    assert.deepEqual(CREATED_ABILITY_MENU.limits, { minCosts: 1, maxCosts: 3, uniqueCostKinds: true });
  });

  test("every menu part, at its minimum, default and maximum, validates and builds", () => {
    for (const cost of CREATED_ABILITY_MENU.costs) {
      for (const amount of [cost.min!, cost.defaultAmount!, cost.max!]) {
        const spec: CreatedAbilitySpec = { costs: [{ kind: cost.kind, amount }], effect: { kind: "draw", amount: 1 } };
        assert.deepEqual(validateCreatedAbilitySpec(spec), [], `${cost.kind} ${amount}`);
        buildCreatedAbility(spec);
      }
    }
    for (const effect of CREATED_ABILITY_MENU.effects) {
      const amounts = effect.min === undefined ? [undefined] : [effect.min, effect.defaultAmount, effect.max];
      for (const amount of amounts) {
        const spec: CreatedAbilitySpec = { costs: [lose1], effect: { kind: effect.kind, ...(amount !== undefined ? { amount } : {}) } };
        assert.deepEqual(validateCreatedAbilitySpec(spec), [], `${effect.kind} ${amount}`);
        buildCreatedAbility(spec);
      }
    }
  });

  test("the picksCharacter flag matches the built ability's targets", () => {
    for (const effect of CREATED_ABILITY_MENU.effects) {
      const { ability } = buildCreatedAbility({
        costs: [lose1],
        effect: { kind: effect.kind, ...(effect.min !== undefined ? { amount: effect.defaultAmount } : {}) }
      });
      assert.equal((ability.targets?.length ?? 0) > 0, effect.picksCharacter === true, effect.kind);
    }
  });
});

describe("Q51B: generated rules text", () => {
  const text = (spec: CreatedAbilitySpec) => buildCreatedAbility(spec).text;

  test("reads like a printed ability: COST lines, then EFFECT", () => {
    assert.equal(text({ costs: [{ kind: "pay", amount: 2 }], effect: { kind: "draw", amount: 1 } }), "COST: Pay 2. EFFECT: Draw a card.");
    assert.equal(
      text({ costs: [{ kind: "pay", amount: 3 }, { kind: "loseInfluence", amount: 1 }, { kind: "discardCard", amount: 2 }], effect: { kind: "draw", amount: 3 } }),
      "COST: Pay 3. Lose 1 influence. Discard 2 cards. EFFECT: Draw 3 cards."
    );
    assert.equal(
      text({ costs: [{ kind: "discardCard", amount: 1 }], effect: { kind: "gainInfluence", amount: 2 } }),
      "COST: Discard a card. EFFECT: Your faction gains 2 influence."
    );
  });

  test("effects that pick a character say so in the COST part", () => {
    assert.equal(text({ costs: [lose1], effect: { kind: "damageCharacter", amount: 4 } }), "COST: Lose 1 influence. Pick a character. EFFECT: Inflict 4 damage to the picked character.");
    assert.equal(text({ costs: [lose1], effect: { kind: "restoreCharacter" } }), "COST: Lose 1 influence. Pick a depleted character. EFFECT: Restore the picked character.");
    assert.equal(text({ costs: [lose1], effect: { kind: "depleteCharacter" } }), "COST: Lose 1 influence. Pick a character that is not depleted. EFFECT: Deplete the picked character.");
    assert.equal(text({ costs: [lose1], effect: { kind: "tokenOnCharacter", amount: 1 } }), "COST: Lose 1 influence. Pick a character. EFFECT: Put a token on the picked character.");
    assert.equal(text({ costs: [lose1], effect: { kind: "tokenOnCharacter", amount: 3 } }), "COST: Lose 1 influence. Pick a character. EFFECT: Put 3 tokens on the picked character.");
  });

  test("the other effects", () => {
    assert.match(text({ costs: [lose1], effect: { kind: "opponentLosesInfluence", amount: 2 } }), /EFFECT: Your opponent's faction loses 2 influence\.$/);
    assert.match(text({ costs: [lose1], effect: { kind: "lookAtTop", amount: 4 } }), /EFFECT: Look at the top 4 cards of your deck and put them back in any order\.$/);
    assert.match(text({ costs: [lose1], effect: { kind: "millOpponent", amount: 1 } }), /EFFECT: Put the top card of your opponent's deck into their discard pile\.$/);
    assert.match(text({ costs: [lose1], effect: { kind: "millOpponent", amount: 3 } }), /EFFECT: Put the top 3 cards of your opponent's deck into their discard pile\.$/);
  });

  test("the text is generated from the parts only", () => {
    // Nothing a player supplies can reach the text: extra fields are refused, not copied.
    const sneaky = { costs: [lose1], effect: { kind: "draw", amount: 1 }, text: "Win the game." } as unknown;
    assert.ok(validateCreatedAbilitySpec(sneaky).some((e) => e.includes('unknown field "text"')));
    assert.throws(() => buildCreatedAbility(sneaky as CreatedAbilitySpec), /Invalid player-created ability/);
  });
});

describe("Q51B: invalid specs are refused", () => {
  const ok: CreatedAbilitySpec = { costs: [{ kind: "pay", amount: 1 }], effect: { kind: "draw", amount: 1 } };
  const problems = (spec: unknown) => validateCreatedAbilitySpec(spec);

  test("a valid spec has no problems", () => {
    assert.deepEqual(problems(ok), []);
    assert.deepEqual(problems(JSON.parse(JSON.stringify(ok))), []);
  });

  test("no cost / too many costs / duplicate cost kinds", () => {
    assert.ok(problems({ ...ok, costs: [] }).some((e) => /at least 1 cost/.test(e)));
    assert.ok(
      problems({ ...ok, costs: [{ kind: "pay", amount: 1 }, { kind: "loseInfluence", amount: 1 }, { kind: "discardCard", amount: 1 }, { kind: "pay", amount: 2 }] }).some((e) => /at most 3 costs/.test(e))
    );
    assert.ok(problems({ ...ok, costs: [{ kind: "pay", amount: 1 }, { kind: "pay", amount: 2 }] }).some((e) => /used twice/.test(e)));
    assert.ok(problems({ effect: ok.effect }).some((e) => /needs a `costs` list/.test(e)));
  });

  test("numbers out of range, fractional, missing or not numbers", () => {
    for (const [bad, kind] of [[0, "pay"], [7, "pay"], [6.5, "pay"], [-1, "loseInfluence"], [6, "loseInfluence"], [4, "discardCard"]] as const) {
      assert.ok(problems({ ...ok, costs: [{ kind, amount: bad }] }).length > 0, `${kind} ${bad}`);
    }
    for (const bad of [0, 4, 1.5, Number.NaN, Infinity, "2", null, undefined]) {
      assert.ok(problems({ ...ok, effect: { kind: "draw", amount: bad } }).length > 0, `draw ${String(bad)}`);
    }
    assert.ok(problems({ ...ok, effect: { kind: "lookAtTop", amount: 1 } }).length > 0, "look at 1 card is below the menu's 2");
    assert.ok(problems({ ...ok, effect: { kind: "damageCharacter", amount: 6 } }).length > 0);
    assert.ok(problems({ ...ok, effect: { kind: "damageCharacter" } }).length > 0, "a numbered part needs its number");
    assert.ok(problems({ ...ok, effect: { kind: "restoreCharacter", amount: 1 } }).length > 0, "a part without a number refuses one");
  });

  test("unknown kinds, shapes and fields", () => {
    assert.ok(problems({ ...ok, costs: [{ kind: "sacrificeYourFaction", amount: 1 }] }).some((e) => /unknown cost kind/.test(e)));
    assert.ok(problems({ ...ok, effect: { kind: "winTheGame", amount: 1 } }).some((e) => /unknown effect kind/.test(e)));
    assert.ok(problems({ ...ok, effect: { kind: "draw", amount: 1, custom: "x" } }).some((e) => /unknown field "custom"/.test(e)));
    assert.ok(problems({ ...ok, effects: [ok.effect] }).some((e) => /unknown field "effects"/.test(e)));
    assert.ok(problems({ costs: ok.costs }).some((e) => /exactly one `effect`/.test(e)));
    assert.ok(problems({ ...ok, costs: ["pay 1"] }).length > 0);
    assert.ok(problems(null).length > 0);
    assert.ok(problems("Pay 1: draw a card").length > 0, "free text is not a spec");
    assert.ok(problems([]).length > 0);
    // A raw engine ability is not a spec.
    assert.ok(problems({ id: "x", type: "activated", effects: [] }).length > 0);
  });

  test("every problem is listed, not just the first", () => {
    const list = problems({ costs: [{ kind: "pay", amount: 99 }, { kind: "nope", amount: 1 }], effect: { kind: "draw", amount: 0 } });
    assert.ok(list.length >= 3, list.join(" | "));
  });

  test("buildCreatedAbility, applyCreatedFactionAbility and setup all refuse an invalid spec with a clear error", () => {
    const bad = { costs: [], effect: { kind: "draw", amount: 1 } } as CreatedAbilitySpec;
    assert.throws(() => buildCreatedAbility(bad), /Invalid player-created ability: .*at least 1 cost/);
    const b = buildGame({ playerA: { faction: rdFaction() } });
    assert.throws(() => b.engine.applyCreatedFactionAbility(bad), /Invalid player-created ability/);
    assert.equal(b.engine.state.cards[rdCard(b.engine)].createdAbility, undefined, "nothing was stored");

    const filler = character({ id: "q51b-filler", name: "Filler" });
    const plain = factionCard({ id: "q51b-plain", name: "Plain", faction: defaultFactionDefinition({ setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 1, goingSecond: 1 } } }) });
    const rd = rdFaction();
    assert.throws(
      () =>
        createTwoPlayerFactionGame(
          [rd, plain, filler],
          { id: P1, name: "A", deckDefinitionIds: [rd.id, ...Array(8).fill(filler.id)] },
          { id: P2, name: "B", deckDefinitionIds: [plain.id, ...Array(8).fill(filler.id)] },
          { seed: 1, createdAbility: bad }
        ),
      /Invalid player-created ability/
    );
  });
});

describe("Q51B: the built ability, in play", () => {
  test("it is an activated ability usable by anyPlayer, stored with its spec and text, and survives a JSON round trip", () => {
    const spec: CreatedAbilitySpec = { costs: [{ kind: "pay", amount: 2 }, lose1], effect: { kind: "damageCharacter", amount: 2 } };
    const { ability, text } = buildCreatedAbility(spec);
    assert.equal(ability.type, "activated");
    assert.equal(ability.id, CREATED_ABILITY_ID);
    assert.equal(ability.usableBy, "anyPlayer");
    assert.deepEqual(JSON.parse(JSON.stringify(ability)), ability, "plain JSON");
    const b = board(spec);
    const stored = b.engine.state.cards[rdCard(b.engine)].createdAbility!;
    assert.deepEqual(stored.spec, spec);
    assert.equal(stored.text, text);
    assert.deepEqual(stored.ability, ability);
    // Later edits to the caller's spec do not reach the stored copy.
    spec.costs[0].amount = 6;
    assert.equal(b.engine.state.cards[rdCard(b.engine)].createdAbility!.spec.costs[0].amount, 2);
    // Save/replay: the whole state is JSON.
    const copy = JSON.parse(JSON.stringify(b.engine.state.cards[rdCard(b.engine)].createdAbility));
    assert.deepEqual(copy, b.engine.state.cards[rdCard(b.engine)].createdAbility);
  });

  test("setup takes the spec, gives it to the R&D faction only, and the same spec always builds the same ability", () => {
    const filler = character({ id: "q51b-filler2", name: "Filler" });
    const plain = factionCard({ id: "q51b-plain2", name: "Plain", faction: defaultFactionDefinition({ setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 1, goingSecond: 1 } } }) });
    const rd = rdFaction();
    const spec: CreatedAbilitySpec = { costs: [{ kind: "discardCard", amount: 1 }], effect: { kind: "lookAtTop", amount: 3 } };
    const make = () =>
      createTwoPlayerFactionGame(
        [rd, plain, filler],
        { id: P1, name: "A", deckDefinitionIds: [rd.id, ...Array(8).fill(filler.id)] },
        { id: P2, name: "B", deckDefinitionIds: [plain.id, ...Array(8).fill(filler.id)] },
        { seed: 7, createdAbility: spec }
      );
    const a = make();
    const rdId = a.state.players[P1].factionId!;
    assert.equal(a.state.cards[rdId].createdAbility?.text, "COST: Discard a card. EFFECT: Look at the top 3 cards of your deck and put them back in any order.");
    assert.equal(a.state.cards[a.state.players[P2].factionId!].createdAbility, undefined);
    assert.deepEqual(make().state.cards[rdId].createdAbility, a.state.cards[rdId].createdAbility);
  });

  describe("costs: each kind is paid by whoever uses the ability", () => {
    for (const user of [P1, P2]) {
      test(`pay N: ${user} pays N resources of their own`, () => {
        const b = board({ costs: [{ kind: "pay", amount: 3 }], effect: { kind: "gainInfluence", amount: 1 } });
        const before = [ready(b.engine, P1), ready(b.engine, P2)];
        use(b, user);
        const after = [ready(b.engine, P1), ready(b.engine, P2)];
        assert.equal(before[user === P1 ? 0 : 1] - after[user === P1 ? 0 : 1], 3, "the user paid 3");
        assert.equal(before[user === P1 ? 1 : 0], after[user === P1 ? 1 : 0], "the other player paid nothing");
      });

      test(`lose N influence: ${user} loses N`, () => {
        const b = board({ costs: [{ kind: "loseInfluence", amount: 4 }], effect: { kind: "draw", amount: 1 } });
        const before = [b.engine.state.players[P1].influence, b.engine.state.players[P2].influence];
        use(b, user);
        const i = user === P1 ? 0 : 1;
        assert.equal(b.engine.state.players[user].influence, before[i] - 4);
        assert.equal(b.engine.state.players[other(user)].influence, before[1 - i]);
      });

      test(`discard N cards: ${user} discards N cards from their own hand`, () => {
        const b = board({ costs: [{ kind: "discardCard", amount: 2 }], effect: { kind: "gainInfluence", amount: 1 } });
        const mine = b.engine.state.players[user].hand.slice(0, 2);
        const theirHand = [...b.engine.state.players[other(user)].hand];
        use(b, user, { [DISCARD]: mine });
        assert.equal(b.engine.state.players[user].hand.length, 1);
        for (const id of mine) assert.equal(b.engine.state.cards[id].zone, "discard");
        assert.deepEqual(b.engine.state.players[other(user)].hand, theirHand);
      });
    }

    test("discarding the other player's card is refused", () => {
      const b = board({ costs: [{ kind: "discardCard", amount: 1 }], effect: { kind: "gainInfluence", amount: 1 } });
      const theirs = b.engine.state.players[P2].hand.slice(0, 1);
      assert.throws(() => use(b, P1, { [DISCARD]: theirs }));
    });

    test("all three costs together are all paid", () => {
      const b = board({ costs: [{ kind: "pay", amount: 2 }, { kind: "loseInfluence", amount: 1 }, { kind: "discardCard", amount: 1 }], effect: { kind: "gainInfluence", amount: 3 } });
      const hand = b.engine.state.players[P2].hand[0];
      const readyBefore = ready(b.engine, P2);
      const influenceBefore = b.engine.state.players[P2].influence;
      use(b, P2, { [DISCARD]: [hand] });
      assert.equal(readyBefore - ready(b.engine, P2), 2);
      assert.equal(b.engine.state.players[P2].influence, influenceBefore - 1 + 3);
      assert.equal(b.engine.state.cards[hand].zone, "discard");
    });

    test("a cost the user cannot afford means the ability is not offered to them", () => {
      const b = board({ costs: [{ kind: "pay", amount: 6 }], effect: { kind: "draw", amount: 1 } });
      for (const p of [P1, P2]) {
        turnOf(b.engine, p);
        assert.deepEqual(listed(b.engine, p), [CREATED_ABILITY_ID], `${p} can afford Pay 6 with 6 resources`);
      }
      const poor = buildGame({ playerA: { faction: rdFaction() }, cards: [...bank("rage", 2, P1), ...bank("rage", 2, P2)] });
      poor.engine.applyCreatedFactionAbility({ costs: [{ kind: "pay", amount: 3 }], effect: { kind: "draw", amount: 1 } });
      for (const p of [P1, P2]) {
        turnOf(poor.engine, p);
        assert.deepEqual(listed(poor.engine, p), [], `${p} has 2 resources and cannot pay 3`);
      }
    });
  });

  describe("effects: each kind does its job for whoever uses the ability", () => {
    const effectSpec = (kind: CreatedEffectKind, amount?: number): CreatedAbilitySpec => ({ costs: [lose1], effect: { kind, ...(amount !== undefined ? { amount } : {}) } });

    for (const user of [P1, P2]) {
      const them = other(user);
      const mineChar = (b: Built) => b.id(`char-${user}`);
      const theirChar = (b: Built) => b.id(`char-${them}`);

      test(`draw N cards: ${user} draws`, () => {
        const b = board(effectSpec("draw", 3));
        const [mine, theirs] = [b.engine.state.players[user].hand.length, b.engine.state.players[them].hand.length];
        use(b, user);
        assert.equal(b.engine.state.players[user].hand.length, mine + 3);
        assert.equal(b.engine.state.players[them].hand.length, theirs);
      });

      test(`your faction gains N influence: ${user}'s, not the R&D card's controller by default`, () => {
        const b = board(effectSpec("gainInfluence", 3));
        const before = [b.engine.state.players[user].influence, b.engine.state.players[them].influence];
        use(b, user);
        assert.equal(b.engine.state.players[user].influence, before[0] - 1 + 3);
        assert.equal(b.engine.state.players[them].influence, before[1]);
      });

      test(`your opponent's faction loses N influence: ${them} loses`, () => {
        const b = board(effectSpec("opponentLosesInfluence", 2));
        const before = [b.engine.state.players[user].influence, b.engine.state.players[them].influence];
        use(b, user);
        assert.equal(b.engine.state.players[them].influence, before[1] - 2);
        assert.equal(b.engine.state.players[user].influence, before[0] - 1);
      });

      test(`inflict N damage to a picked character: either side's character can be picked`, () => {
        for (const target of [mineChar, theirChar]) {
          const b = board(effectSpec("damageCharacter", 3));
          const id = target(b);
          use(b, user, { [PICK]: [id] });
          assert.equal(b.engine.state.cards[id].damage, 3);
        }
      });

      test(`restore a picked depleted character`, () => {
        const b = board(effectSpec("restoreCharacter"));
        const tired = b.id(`tired-${them}`);
        assert.equal(b.engine.state.cards[tired].depleted, true);
        use(b, user, { [PICK]: [tired] });
        assert.equal(b.engine.state.cards[tired].depleted, false);
        // A character that is not depleted is not a legal pick.
        const c = board(effectSpec("restoreCharacter"));
        assert.throws(() => use(c, user, { [PICK]: [theirChar(c)] }));
      });

      test(`deplete a picked character`, () => {
        const b = board(effectSpec("depleteCharacter"));
        const id = theirChar(b);
        use(b, user, { [PICK]: [id] });
        assert.equal(b.engine.state.cards[id].depleted, true);
        const c = board(effectSpec("depleteCharacter"));
        assert.throws(() => use(c, user, { [PICK]: [c.id(`tired-${them}`)] }));
      });

      test(`put N tokens on a picked character`, () => {
        const b = board(effectSpec("tokenOnCharacter", 2));
        const id = mineChar(b);
        use(b, user, { [PICK]: [id] });
        assert.equal(b.engine.state.cards[id].counters?.token, 2);
      });

      test(`look at the top N cards of your deck: ${user} reorders their own deck`, () => {
        const b = board(effectSpec("lookAtTop", 3));
        const deck = [...b.engine.state.players[user].deck];
        const theirDeck = [...b.engine.state.players[them].deck];
        use(b, user);
        const pending = b.engine.state.pendingChoice as { kind: string; playerId: string; cardIds: string[] } | undefined;
        assert.equal(pending?.kind, "reorderDeck");
        assert.equal(pending?.playerId, user);
        assert.deepEqual(pending?.cardIds, deck.slice(0, 3), "the top 3 of the user's own deck");
        const order = [...pending!.cardIds].reverse();
        b.engine.perform({ type: "resolvePendingChoice", playerId: user, choice: { kind: "reorderDeck", order } } as never);
        assert.deepEqual(b.engine.state.players[user].deck.slice(0, 3), order);
        assert.deepEqual(b.engine.state.players[them].deck, theirDeck);
      });

      test(`put the top N cards of your opponent's deck into their discard pile`, () => {
        const b = board(effectSpec("millOpponent", 2));
        const theirDeck = [...b.engine.state.players[them].deck];
        const myDeck = [...b.engine.state.players[user].deck];
        use(b, user);
        assert.equal(b.engine.state.players[them].deck.length, theirDeck.length - 2);
        for (const id of theirDeck.slice(0, 2)) assert.equal(b.engine.state.cards[id].zone, "discard");
        assert.deepEqual(b.engine.state.players[user].deck, myDeck);
      });
    }
  });

  test("both players can use the ability in the same game, each under themselves", () => {
    const b = board({ costs: [{ kind: "pay", amount: 1 }], effect: { kind: "gainInfluence", amount: 2 } });
    assert.deepEqual(listed(b.engine, P1), [CREATED_ABILITY_ID]);
    turnOf(b.engine, P2);
    assert.deepEqual(listed(b.engine, P2), [CREATED_ABILITY_ID]);
    const before = [b.engine.state.players[P1].influence, b.engine.state.players[P2].influence];
    use(b, P1);
    assert.deepEqual([b.engine.state.players[P1].influence, b.engine.state.players[P2].influence], [before[0] + 2, before[1]]);
    use(b, P2);
    assert.deepEqual([b.engine.state.players[P1].influence, b.engine.state.players[P2].influence], [before[0] + 2, before[1] + 2]);
  });
});
