// Clause tests — batch open-beta-06 (Open Beta rogue cards, Bipolar Sarcophyle
// to Red Raven). See docs/TESTING.md and `npm run card-tests -- manifest
// open-beta-06`. Expectations come from each card's PRINTED text and RULES.md;
// engine data (ability ids, declaration ids, choice kinds) is only used to
// drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, flipUpNow } from "./_clause.js";
import { CATALOG } from "./_manifest.js";
import { endTurn } from "./_turn.js";
import type { CardDefinition, CardSelector, Effect, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Player = typeof P1 | typeof P2;

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Player = P1) => engine.getAvailableResourceCount(player);

/** Raw `playCard` without draining the response window (use `play` from the harness to drain it). */
function playRaw(engine: SpoilsEngine, player: Player, cardId: string, opts: { selected?: Record<string, string[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "playCard", playerId: player, cardId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** Raw `activateAbility` without draining the response window. */
function activateRaw(engine: SpoilsEngine, player: Player, cardId: string, abilityId: string, selected: Record<string, string[]> = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);
}

/**
 * Asserts `fn` is refused by the engine -- and not for a test-driving mistake
 * (acting out of priority, an unknown card, a TypeError).
 */
function refused(fn: () => unknown, why = "was refused"): void {
  assert.throws(
    () => {
      fn();
    },
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      assert.ok(!(err instanceof TypeError) && !/priority|not found|unknown|undefined|already ended/i.test(message), `${why}: refused for the wrong reason (${message})`);
      return true;
    },
    why
  );
}

/** A seeded RNG that always wins a coin flip (`random() < 0.5`) / always loses it. */
const WIN = () => 0.1;
const LOSE = () => 0.9;

/** Current battle / pending choice, read through functions so TypeScript does not narrow them after an earlier assertion. */
const battleOf = (engine: SpoilsEngine) => engine.state.battle;
const pendingOf = (engine: SpoilsEngine) => engine.state.pendingChoice;

/** The coin flips the log has recorded so far. */
const coinFlips = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "coinFlipped")
    .map((entry) => {
      const ev = entry.event as unknown as { playerId: string; won: boolean };
      return { playerId: ev.playerId, won: ev.won };
    });

const tokens = (engine: SpoilsEngine, cardId: string): number => engine.state.cards[cardId].counters?.token ?? 0;

/** `n` filler characters for `owner`'s deck, top first (keys `<prefix>0` ... `<prefix>n-1`). */
const deckCards = (owner: Player, n: number, prefix: string): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "deck" as const }));

interface HandOpts {
  deception?: number;
  greed?: number;
  random?: () => number;
  turn?: number;
  extra?: CardPlacement[];
}

/** The printing under test in P1's hand (key `me`), with `deception` Deception resources (default 10) and the usual Develop faction. */
function handBoard(printingId: string, opts: HandOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    cards: [
      { key: "me", def: printing(printingId), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/**
 * The deploy-cost checks every printed card has: it needs its numeric cost (one
 * short is refused), its threshold (enough resources of the wrong icon is
 * refused) and it pays exactly the printed cost.
 */
function deployCostChecks(
  make: (res: { deception: number; greed: number }) => { engine: SpoilsEngine; id: (key: string) => string },
  cost: number,
  thresholdIcons: number,
  selected: (id: (key: string) => string) => Record<string, string[]> = () => ({})
) {
  const short = make({ deception: cost - 1, greed: 0 });
  refused(() => playRaw(short.engine, P1, short.id("me"), { selected: selected(short.id) }), `one resource short of ${cost}`);
  assert.equal(short.engine.state.cards[short.id("me")].zone, "hand", "nothing was played");

  const noIcons = make({ deception: thresholdIcons - 1, greed: cost + 4 });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("me"), { selected: selected(noIcons.id) }), `${thresholdIcons - 1} Deception icons is below the threshold even with ${cost + 4} Greed`);
  assert.equal(noIcons.engine.state.cards[noIcons.id("me")].zone, "hand");

  const total = Math.max(cost, thresholdIcons);
  const exact = make({ deception: total, greed: 0 });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("me"), { selected: selected(exact.id) });
  assert.equal(before - ready(exact.engine), cost, `exactly ${cost} is paid`);
  assert.equal(ready(exact.engine), total - cost);
  return exact;
}

// --- Bipolar Sarcophyle ----------------------------------------------------
// When this card enters play, flip a coin. If you win, put a token on this
// card. -- This card gains 1 strength and 1 life for each token on it.
// Character, rogue, cost 4, threshold [D], 2/4/3.

const BIPOLAR = "5359cb31-a9ad-4ba9-b7fb-257887be1b4a";

const bipolarBoard = (opts: HandOpts = {}) => handBoard(BIPOLAR, opts);

clause(BIPOLAR, "0:rule", "winning the coin flip on entering play puts exactly one token on the card", () => {
  const { engine, id } = bipolarBoard({ random: WIN });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("me")].zone, "play");
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: true }], "one coin flip, flipped by the controller, and won");
  assert.equal(tokens(engine, id("me")), 1, "exactly one token");
});

clause(BIPOLAR, "0:rule", "losing the coin flip puts no token on the card", () => {
  const { engine, id } = bipolarBoard({ random: LOSE });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("me")].zone, "play");
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: false }]);
  assert.equal(tokens(engine, id("me")), 0);
});

clause(BIPOLAR, "0:rule", "a won flip is reflected in its stats right away: 3/5/4 (one token), a lost flip leaves the printed 2/4/3", () => {
  const printed = printing(BIPOLAR);
  const won = bipolarBoard({ random: WIN });
  play(won.engine, P1, won.id("me"));
  drain(won.engine, declineAll);
  assert.equal(won.engine.getStat(won.id("me"), "strength"), printed.strength! + 1);
  assert.equal(won.engine.getStat(won.id("me"), "life"), printed.life! + 1);
  assert.equal(won.engine.getStat(won.id("me"), "speed"), printed.speed!, "speed is not scaled");

  const lost = bipolarBoard({ random: LOSE });
  play(lost.engine, P1, lost.id("me"));
  drain(lost.engine, declineAll);
  assert.equal(lost.engine.getStat(lost.id("me"), "strength"), printed.strength);
  assert.equal(lost.engine.getStat(lost.id("me"), "life"), printed.life);
  assert.equal(lost.engine.getStat(lost.id("me"), "speed"), printed.speed);
});

clause(BIPOLAR, "0:rule", "the coin is flipped when the card enters play, not when it is played from hand: no flip while the opponent can still respond", () => {
  const { engine, id } = bipolarBoard({ random: WIN });
  playRaw(engine, P1, id("me"));
  assert.equal(engine.state.cards[id("me")].zone, "deploying", "still being deployed");
  assert.equal(coinFlips(engine).length, 0, "no flip yet");
  assert.equal(tokens(engine, id("me")), 0);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(coinFlips(engine).length, 1, "flipped once, on entering play");
  assert.equal(tokens(engine, id("me")), 1);
});

clause(BIPOLAR, "0:rule", "pays exactly its printed cost of 4, needs [D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => bipolarBoard({ ...res, random: LOSE }), 4, 1);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

clause(BIPOLAR, "0:rule", "only the card itself entering play flips a coin: another card entering play does not, mine or the opponent's", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: WIN,
    cards: [
      { key: "bs", def: printing(BIPOLAR), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", cost: 1 }), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" },
      ...bank("deception", 3, P1),
      ...bank("greed", 3, P2)
    ]
  });
  play(engine, P1, id("mine"));
  assert.equal(engine.state.cards[id("mine")].zone, "play");
  assert.equal(coinFlips(engine).length, 0, "my other character entering play does not flip");
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  play(engine, P2, id("theirs"));
  assert.equal(engine.state.cards[id("theirs")].zone, "play");
  assert.equal(coinFlips(engine).length, 0, "the opponent's character entering play does not flip");
  assert.equal(tokens(engine, id("bs")), 0);
});

clause(BIPOLAR, "0:rule", "a second Sarcophyle entering play does not give the first one a token, and gets its own flip", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: WIN,
    cards: [
      { key: "a", def: printing(BIPOLAR), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "b", def: printing(BIPOLAR), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1)
    ]
  });
  play(engine, P1, id("b"));
  drain(engine, declineAll);
  assert.equal(coinFlips(engine).length, 1, "only the new card flips");
  assert.equal(tokens(engine, id("a")), 1, "the one already in play is untouched");
  assert.equal(tokens(engine, id("b")), 1, "the new one got its own token");
});

clause(BIPOLAR, "0:rule", "the flip happens on entering play only: no new flip or token on later turns", () => {
  const { engine, id } = bipolarBoard({ random: WIN });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(tokens(engine, id("me")), 1);
  endTurn(engine, P1);
  drain(engine, declineAll);
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(coinFlips(engine).length, 1, "no further flips");
  assert.equal(tokens(engine, id("me")), 1);
});

clause(BIPOLAR, "1:rule", "gains 1 strength and 1 life for each token on it (0, 1, 2 and 5 tokens); speed is unchanged", () => {
  const printed = printing(BIPOLAR);
  for (const n of [0, 1, 2, 5]) {
    const { engine, id } = buildGame({ cards: [{ key: "bs", def: printing(BIPOLAR), owner: P1, zone: "play", counters: { token: n } }] });
    assert.equal(engine.getStat(id("bs"), "strength"), printed.strength! + n, `strength with ${n} tokens`);
    assert.equal(engine.getStat(id("bs"), "life"), printed.life! + n, `life with ${n} tokens`);
    assert.equal(engine.getStat(id("bs"), "speed"), printed.speed, `speed with ${n} tokens`);
  }
});

clause(BIPOLAR, "1:rule", "only this card gains the stats: another character of mine and an opponent's character do not", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "bs", def: printing(BIPOLAR), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 2, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 2, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  for (const key of ["mine", "foe"]) {
    assert.equal(engine.getStat(id(key), "strength"), 1, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), 2, `${key} life`);
  }
});

clause(BIPOLAR, "1:rule", "the bonus is live: removing the token takes it away again", () => {
  const printed = printing(BIPOLAR);
  const { engine, id } = buildGame({ cards: [{ key: "bs", def: printing(BIPOLAR), owner: P1, zone: "play", counters: { token: 2 } }] });
  assert.equal(engine.getStat(id("bs"), "strength"), printed.strength! + 2);
  engine.state.cards[id("bs")].counters = { token: 1 };
  assert.equal(engine.getStat(id("bs"), "strength"), printed.strength! + 1);
  assert.equal(engine.getStat(id("bs"), "life"), printed.life! + 1);
  engine.state.cards[id("bs")].counters = {};
  assert.equal(engine.getStat(id("bs"), "strength"), printed.strength);
  assert.equal(engine.getStat(id("bs"), "life"), printed.life);
});

clause(BIPOLAR, "1:rule", "the extra life counts for survival: with 1 token (life 4) it survives 3 damage and dies at 4; with no token it dies at 3", () => {
  const damage = (n: number, token: number) => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bs", def: printing(BIPOLAR), owner: P1, zone: "play", counters: token ? { token } : {} },
        { key: "foe", def: character({ name: "Foe", strength: n, life: 9, speed: 5 }), owner: P2, zone: "play", attackEligible: true }
      ],
      turn: 2,
      activePlayerId: P2
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe")], target: { type: "faction", playerId: P1 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("bs")] });
    autoResolveBattle(engine);
    return engine.state.cards[id("bs")];
  };
  const noToken = damage(3, 0);
  assert.equal(noToken.zone, "discard", "printed life 3: 3 damage kills it");
  const survivor = damage(3, 1);
  assert.equal(survivor.zone, "play", "one token: life 4 survives 3 damage");
  assert.equal(survivor.damage, 3);
  const dead = damage(4, 1);
  assert.equal(dead.zone, "discard", "one token: 4 damage kills it");
});

clause(BIPOLAR, "1:rule", "the bonus is lost with the card: put into its owner's hand, the tokens do not come back with it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: LOSE,
    cards: [
      { key: "bs", def: printing(BIPOLAR), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "bounce", def: tactic({ name: "Bounce", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" },
      ...bank("deception", 4, P1)
    ]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("bs")] } });
  assert.equal(engine.state.cards[id("bs")].zone, "hand");
  assert.equal(tokens(engine, id("bs")), 0, "tokens disappear when the card leaves play (CR 409.2)");
  play(engine, P1, id("bs"));
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("bs")].zone, "play");
  assert.equal(tokens(engine, id("bs")), 0, "lost flip: a fresh card with no tokens");
  assert.equal(engine.getStat(id("bs"), "strength"), printing(BIPOLAR).strength);
});

// --- Card Counter ----------------------------------------------------------
// When this card enters play, flip a coin. If you win, X is 3 otherwise X is 2.
// Put the top X cards of your opponent's deck into their discard pile.
// Character, rogue, cost 3, threshold [D], 2/3/1.

const COUNTER = "6120a36b-4cbf-423a-b667-b6ca1df81879";

const counterBoard = (opts: HandOpts & { oppDeck?: number; myDeck?: number } = {}) =>
  handBoard(COUNTER, {
    ...opts,
    extra: [...deckCards(P2, opts.oppDeck ?? 8, "o"), ...deckCards(P1, opts.myDeck ?? 4, "m"), ...(opts.extra ?? [])]
  });

clause(COUNTER, "0:rule", "winning the flip: X is 3, the top 3 cards of the opponent's deck go to their discard pile, in order, and the rest stay", () => {
  const { engine, id } = counterBoard({ random: WIN });
  const oppDeck = [...engine.state.players[P2].deck];
  const myDeck = [...engine.state.players[P1].deck];
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: true }]);
  assert.deepEqual(engine.state.players[P2].discard.slice().sort(), oppDeck.slice(0, 3).sort(), "exactly the top 3 are milled");
  for (const cardId of oppDeck.slice(0, 3)) assert.equal(engine.state.cards[cardId].zone, "discard");
  assert.deepEqual(engine.state.players[P2].deck, oppDeck.slice(3), "the rest of the opponent's deck is untouched and in order");
  assert.deepEqual(engine.state.players[P1].deck, myDeck, "my own deck is untouched");
  assert.deepEqual(engine.state.players[P1].discard, [], "nothing went to my discard pile");
});

clause(COUNTER, "0:rule", "losing the flip: X is 2, exactly the top 2 cards are milled and the third is not", () => {
  const { engine, id } = counterBoard({ random: LOSE });
  const oppDeck = [...engine.state.players[P2].deck];
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: false }]);
  assert.deepEqual(engine.state.players[P2].discard.slice().sort(), oppDeck.slice(0, 2).sort(), "exactly the top 2 are milled");
  assert.deepEqual(engine.state.players[P2].deck, oppDeck.slice(2));
  assert.equal(engine.state.cards[oppDeck[2]].zone, "deck", "the third card stays");
  assert.deepEqual(engine.state.players[P1].deck.length, 4, "my deck is untouched");
});

clause(COUNTER, "0:rule", "the milled cards go to the opponent's discard pile (their owner's), never to the Counter's controller", () => {
  const { engine, id } = counterBoard({ random: WIN });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(engine.state.players[P1].discard.length, 0);
  assert.equal(engine.state.players[P2].discard.length, 3);
  for (const cardId of engine.state.players[P2].discard) assert.equal(engine.state.cards[cardId].ownerId, P2);
});

clause(COUNTER, "0:rule", "an opponent's deck smaller than X: as many as it has are milled (3-flip against 2 cards, 2-flip against 1 card)", () => {
  const win = counterBoard({ random: WIN, oppDeck: 2 });
  play(win.engine, P1, win.id("me"));
  drain(win.engine, declineAll);
  assert.equal(win.engine.state.players[P2].deck.length, 0);
  assert.equal(win.engine.state.players[P2].discard.length, 2);
  assert.equal(win.engine.state.cards[win.id("me")].zone, "play");

  const lose = counterBoard({ random: LOSE, oppDeck: 1 });
  play(lose.engine, P1, lose.id("me"));
  drain(lose.engine, declineAll);
  assert.equal(lose.engine.state.players[P2].deck.length, 0);
  assert.equal(lose.engine.state.players[P2].discard.length, 1);
});

clause(COUNTER, "0:rule", "an empty opponent deck is harmless (nothing to mill)", () => {
  const { engine, id } = counterBoard({ random: WIN, oppDeck: 0 });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("me")].zone, "play");
  assert.equal(engine.state.players[P2].discard.length, 0);
});

clause(COUNTER, "0:rule", "exactly X cards: a 3-card deck is emptied by a won flip, and a lost flip leaves 1", () => {
  const win = counterBoard({ random: WIN, oppDeck: 3 });
  play(win.engine, P1, win.id("me"));
  drain(win.engine, declineAll);
  assert.equal(win.engine.state.players[P2].deck.length, 0);
  assert.equal(win.engine.state.players[P2].discard.length, 3);

  const lose = counterBoard({ random: LOSE, oppDeck: 3 });
  play(lose.engine, P1, lose.id("me"));
  drain(lose.engine, declineAll);
  assert.equal(lose.engine.state.players[P2].deck.length, 1);
  assert.equal(lose.engine.state.players[P2].discard.length, 2);
});

clause(COUNTER, "0:rule", "pays exactly its printed cost of 3, needs [D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => counterBoard({ ...res, random: LOSE }), 3, 1);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

clause(COUNTER, "0:rule", "the mill happens when this card enters play, not on being played from hand", () => {
  const { engine, id } = counterBoard({ random: WIN });
  playRaw(engine, P1, id("me"));
  assert.equal(engine.state.players[P2].discard.length, 0, "nothing milled while the opponent can still respond");
  assert.equal(coinFlips(engine).length, 0);
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(engine.state.players[P2].discard.length, 3);
});

clause(COUNTER, "0:rule", "another card entering play does not mill: no flip and no discard", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: WIN,
    cards: [
      { key: "cc", def: printing(COUNTER), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" },
      ...deckCards(P2, 5, "o"),
      ...bank("deception", 2, P1)
    ]
  });
  play(engine, P1, id("other"));
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("other")].zone, "play");
  assert.equal(coinFlips(engine).length, 0);
  assert.equal(engine.state.players[P2].discard.length, 0);
});

// --- Catastrophic Betrayal -------------------------------------------------
// COST: Play this only when you are attacking. Pick a character in your
// opponent's discard pile. (You cannot attack with 0 characters.) -- EFFECT: Put
// the character into play under your control. Add the character to the
// attacking party, depleted. Tactic, rogue, cost 5, threshold [D].

const BETRAYAL = "8a59c571-2e1d-4d25-8627-befb70cf925e";

function betrayalBoard(opts: { deception?: number; greed?: number; extra?: CardPlacement[]; corpse?: CardDefinition } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "me", def: printing(BETRAYAL), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "corpse", def: opts.corpse ?? character({ name: "Corpse", strength: 3, life: 4, speed: 2 }), owner: P2, zone: "discard" },
      { key: "corpse2", def: character({ name: "Corpse2", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "discard" },
      { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      ...bank("deception", opts.deception ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const declareAttack = (engine: SpoilsEngine, player: Player, ids: string[]) =>
  engine.perform({ type: "declareAttack", playerId: player, attackerIds: ids, target: { type: "faction", playerId: player === P1 ? P2 : P1 } });

const declareBlockers = (engine: SpoilsEngine, player: Player, ids: string[]) =>
  engine.perform({ type: "declareBlockers", playerId: player, blockerIds: ids });

clause(BETRAYAL, "0:ability", "played in the attack-declaration window: the picked character enters play under my control, joins the attacking party, depleted; the tactic is discarded", () => {
  const { engine, id } = betrayalBoard();
  declareAttack(engine, P1, [id("a1")]);
  const before = ready(engine);
  play(engine, P1, id("me"), { selected: { c: [id("corpse")] } });
  const corpse = engine.state.cards[id("corpse")];
  assert.equal(before - ready(engine), 5, "the printed cost of 5 is paid");
  assert.equal(corpse.zone, "play", "put into play");
  assert.equal(corpse.controllerId, P1, "under my control");
  assert.equal(corpse.ownerId, P2, "ownership never changes");
  assert.equal(corpse.depleted, true, "depleted");
  assert.ok(engine.state.battle?.attackingParty.includes(id("corpse")), "added to the attacking party");
  assert.ok(engine.state.battle?.attackingParty.includes(id("a1")), "the real attacker is still in the party");
  assert.equal(engine.state.cards[id("me")].zone, "discard", "the tactic ends in its owner's discard pile");
  assert.equal(engine.state.cards[id("corpse2")].zone, "discard", "an unpicked character stays in the opponent's discard pile");
  assert.ok(engine.state.players[P2].discard.includes(id("corpse2")), "engine.state.players[P2].discard.includes(id(\"corpse2\"))");
  assert.ok(!engine.state.players[P2].discard.includes(id("corpse")), "the picked one left the discard pile");
});

clause(BETRAYAL, "0:ability", "also playable after blockers are declared (still attacking): the blocking party is unchanged", () => {
  const { engine, id } = betrayalBoard();
  declareAttack(engine, P1, [id("a1")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("blocker")]);
  play(engine, P1, id("me"), { selected: { c: [id("corpse")] } });
  assert.equal(engine.state.cards[id("corpse")].zone, "play");
  assert.equal(engine.state.cards[id("corpse")].controllerId, P1);
  assert.equal(engine.state.cards[id("corpse")].depleted, true);
  assert.ok(engine.state.battle?.attackingParty.includes(id("corpse")), "engine.state.battle?.attackingParty.includes(id(\"corpse\"))");
  assert.deepEqual(engine.state.battle?.blockingParty, [id("blocker")], "the blocking party is unchanged");
});

clause(BETRAYAL, "0:ability", "the added character fights in the battle: it assigns its strength at its speed", () => {
  const { engine, id } = betrayalBoard();
  const influence = engine.state.players[P2].influence;
  declareAttack(engine, P1, [id("a1")]);
  play(engine, P1, id("me"), { selected: { c: [id("corpse")] } });
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, []);
  const sources: string[] = [];
  autoResolveBattle(engine, (source) => {
    sources.push(source.cardId);
    return [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }];
  });
  assert.ok(sources.includes(id("corpse")), "the reanimated character was a battle damage source");
  assert.ok(sources.includes(id("a1")), "sources.includes(id(\"a1\"))");
  assert.equal(engine.state.players[P2].influence, influence - (3 + 1), "its 3 strength plus the real attacker's 1 reach the faction");
});

clause(BETRAYAL, "0:ability", "it joins the party even when the real attack is by several characters, and the existing attackers stay depleted from attacking", () => {
  const { engine, id } = betrayalBoard();
  declareAttack(engine, P1, [id("a1"), id("a2")]);
  play(engine, P1, id("me"), { selected: { c: [id("corpse")] } });
  assert.deepEqual([...(engine.state.battle?.attackingParty ?? [])].sort(), [id("a1"), id("a2"), id("corpse")].sort());
});

clause(BETRAYAL, "0:ability", "entering play for real: the character's own 'when this enters play' ability happens", () => {
  const entrant = character({
    name: "Entrant",
    strength: 1,
    life: 2,
    speed: 2,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });
  const { engine, id } = betrayalBoard({ corpse: entrant, extra: deckCards(P1, 3, "m") });
  const hand = engine.state.players[P1].hand.length;
  declareAttack(engine, P1, [id("a1")]);
  play(engine, P1, id("me"), { selected: { c: [id("corpse")] } });
  drain(engine, declineAll);
  assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1, "the tactic left my hand, the entering character drew me a card");
});

clause(BETRAYAL, "0:ability", "the pick can be any character in the opponent's discard pile (the second one works as well)", () => {
  const { engine, id } = betrayalBoard();
  declareAttack(engine, P1, [id("a1")]);
  play(engine, P1, id("me"), { selected: { c: [id("corpse2")] } });
  assert.equal(engine.state.cards[id("corpse2")].zone, "play");
  assert.equal(engine.state.cards[id("corpse")].zone, "discard", "the other one stays in the discard pile");
  assert.ok(engine.state.battle?.attackingParty.includes(id("corpse2")), "engine.state.battle?.attackingParty.includes(id(\"corpse2\"))");
  assert.ok(!engine.state.battle?.attackingParty.includes(id("corpse")), "!engine.state.battle?.attackingParty.includes(id(\"corpse\"))");
});

clause(BETRAYAL, "0:ability", "the pick must be a CHARACTER in the OPPONENT'S discard pile: items, locations, tactics, my own discard pile, play, hand and deck are refused", () => {
  const { engine, id } = betrayalBoard({
    extra: [
      { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "discard" },
      { key: "oppPlace", def: location({ name: "OppPlace" }), owner: P2, zone: "discard" },
      { key: "oppTactic", def: tactic({ name: "OppTactic" }), owner: P2, zone: "discard" },
      { key: "myCorpse", def: character({ name: "MyCorpse" }), owner: P1, zone: "discard" },
      { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      { key: "oppDeck", def: character({ name: "OppDeck" }), owner: P2, zone: "deck" }
    ]
  });
  declareAttack(engine, P1, [id("a1")]);
  const attempt = (key: string) => () => playRaw(engine, P1, id("me"), { selected: { c: [id(key)] } });
  for (const key of ["oppItem", "oppPlace", "oppTactic", "myCorpse", "oppHand", "oppDeck", "blocker"]) {
    refused(attempt(key), `${key} is not a character in the opponent's discard pile`);
  }
  refused(() => playRaw(engine, P1, id("me"), { selected: { c: [engine.state.players[P2].factionId!] } }), "a faction is not a character in a discard pile");
  assert.equal(engine.state.cards[id("me")].zone, "hand", "nothing was played");
  refused(() => playRaw(engine, P1, id("me"), { selected: { c: [] } }), "a pick is required");
  refused(() => playRaw(engine, P1, id("me"), { selected: { c: [id("corpse"), id("corpse2")] } }), "only one character may be picked");
  playRaw(engine, P1, id("me"), { selected: { c: [id("corpse")] } });
  assert.ok(engine.state.responseWindow, "a legal pick is accepted");
});

clause(BETRAYAL, "0:ability", "cannot be played with no character in the opponent's discard pile", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "me", def: printing(BETRAYAL), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", speed: 3 }), owner: P1, zone: "play" },
      { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "discard" },
      ...bank("deception", 8, P1)
    ]
  });
  declareAttack(engine, P1, [id("a1")]);
  refused(() => playRaw(engine, P1, id("me"), { selected: { c: [] } }));
  assert.equal(engine.state.cards[id("me")].zone, "hand");
});

clause(BETRAYAL, "0:ability", "PLAY THIS ONLY WHEN YOU ARE ATTACKING: refused on my turn when no battle is happening", () => {
  const { engine, id } = betrayalBoard();
  assert.equal(engine.state.battle, undefined);
  refused(() => playRaw(engine, P1, id("me"), { selected: { c: [id("corpse")] } }));
  assert.equal(engine.state.cards[id("me")].zone, "hand");
  assert.equal(engine.state.cards[id("corpse")].zone, "discard");
});

clause(BETRAYAL, "0:ability", "PLAY THIS ONLY WHEN YOU ARE ATTACKING: refused while the OPPONENT is attacking me", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "me", def: printing(BETRAYAL), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", speed: 2 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", speed: 3 }), owner: P2, zone: "play" },
      { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
      ...bank("deception", 8, P1)
    ]
  });
  declareAttack(engine, P2, [id("theirs")]);
  // The opponent has just attacked; once they pass priority I get to respond, but I am the defender.
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "it is my turn to respond");
  refused(() => playRaw(engine, P1, id("me"), { selected: { c: [id("corpse")] } }), "defending is not attacking (declaration window)");
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("mine")]);
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "it is my turn to respond again");
  refused(() => playRaw(engine, P1, id("me"), { selected: { c: [id("corpse")] } }), "defending is not attacking (battle window)");
  assert.equal(engine.state.cards[id("me")].zone, "hand");
  assert.equal(engine.state.cards[id("corpse")].zone, "discard");
});

clause(BETRAYAL, "0:ability", "PLAY THIS ONLY WHEN YOU ARE ATTACKING: refused on the opponent's turn with no battle", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "me", def: printing(BETRAYAL), owner: P1, zone: "hand" },
      { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
      ...bank("deception", 8, P1)
    ]
  });
  refused(() => playRaw(engine, P1, id("me"), { selected: { c: [id("corpse")] } }));
});

clause(BETRAYAL, "0:ability", "'You cannot attack with 0 characters': an attack needs at least one attacker, so there is no way to 'attack' with only this card", () => {
  const { engine, id } = betrayalBoard();
  refused(() => declareAttack(engine, P1, []), "an attack with 0 characters is not legal");
  assert.equal(engine.state.battle, undefined);
  refused(() => playRaw(engine, P1, id("me"), { selected: { c: [id("corpse")] } }), "so this cannot be played to start an attack");
});

clause(BETRAYAL, "0:ability", "pays exactly its printed cost of 5, needs [D], and is refused one resource short", () => {
  const prep = (res: { deception: number; greed: number }) => {
    const board = betrayalBoard(res);
    declareAttack(board.engine, P1, [board.id("a1")]);
    return board;
  };
  const exact = deployCostChecks(prep, 5, 1, (id) => ({ c: [id("corpse")] }));
  assert.equal(exact.engine.state.cards[exact.id("corpse")].zone, "play");
});

// --- vanilla helpers -----------------------------------------------------------

/** A board with the vanilla character under test in hand and `deception` / `greed` resources. */
const vanillaBoard = (printingId: string, deception: number, greed = 0) => handBoard(printingId, { deception, greed });

/** Deploys for exactly the printed cost and threshold, as a character under the player's control. */
function vanillaDeploys(printingId: string, cost: number) {
  const { engine, id } = vanillaBoard(printingId, cost);
  const before = ready(engine);
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(before - ready(engine), cost, `the printed cost of ${cost} is paid`);
  assert.equal(engine.state.cards[id("me")].zone, "play");
  assert.equal(engine.state.cards[id("me")].controllerId, P1);
  assert.equal(engine.getDefinition(id("me")).type, "character");
}

/** Refused one resource short of the cost, with the right icons. */
function vanillaShort(printingId: string, cost: number) {
  const { engine, id } = vanillaBoard(printingId, cost - 1);
  refused(() => playRaw(engine, P1, id("me")), `${cost - 1} resources is one short of ${cost}`);
  assert.equal(engine.state.cards[id("me")].zone, "hand");
  assert.equal(ready(engine), cost - 1, "nothing was paid");
}

/** Refused with plenty of resources but too few Deception icons. */
function vanillaThreshold(printingId: string, cost: number, icons: number) {
  const { engine, id } = vanillaBoard(printingId, icons - 1, cost + 5);
  refused(() => playRaw(engine, P1, id("me")), `${icons - 1} Deception is below the threshold of ${icons}`);
  assert.equal(engine.state.cards[id("me")].zone, "hand");
  const enough = vanillaBoard(printingId, icons, cost + 5);
  play(enough.engine, P1, enough.id("me"));
  assert.equal(enough.engine.state.cards[enough.id("me")].zone, "play", `${icons} Deception icons meet the threshold`);
}

/** The printed strength / life / speed (and nothing else) are in play. */
function vanillaStats(printingId: string, strength: number, speed: number, life: number) {
  const { engine, id } = buildGame({ cards: [{ key: "me", def: printing(printingId), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("me"), "strength"), strength, "strength");
  assert.equal(engine.getStat(id("me"), "speed"), speed, "speed");
  assert.equal(engine.getStat(id("me"), "life"), life, "life");
  assert.deepEqual(engine.getKeywords(id("me")), [], "no keywords");
  assert.deepEqual(engine.getRestrictions(id("me")), [], "no restrictions");
}

/** No rules text: entering play changes nothing on the board but the card itself. */
function vanillaNothingHappens(printingId: string, cost: number) {
  const { engine, id } = handBoard(printingId, {
    deception: cost,
    extra: [...deckCards(P1, 3, "m"), ...deckCards(P2, 3, "o"), { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }, { key: "friend", def: character({ name: "Friend" }), owner: P1, zone: "play" }]
  });
  const snapshot = () => JSON.stringify([engine.state.players[P1].deck, engine.state.players[P2].deck, engine.state.players[P1].discard, engine.state.players[P2].discard, engine.state.players[P2].hand, engine.state.players[P1].influence, engine.state.players[P2].influence, engine.state.cards[id("foe")], engine.state.cards[id("friend")]]);
  const before = snapshot();
  play(engine, P1, id("me"));
  assert.equal(engine.state.pendingChoice, undefined, "no choice is raised");
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(coinFlips(engine).length, 0);
  assert.equal(snapshot(), before, "no deck, discard, hand, influence or other card changed");
  assert.equal(engine.state.players[P1].hand.length, 0, "the card itself left the hand");
}

/** Its strength and life are real in battle: it kills a foe with life = its strength and dies to strength = its life. */
function vanillaBattle(printingId: string, strength: number, speed: number, life: number) {
  const run = (foeStrength: number, foeLife: number) => {
    const { engine, id } = buildGame({
      turn: 2,
      cards: [
        { key: "me", def: printing(printingId), owner: P1, zone: "play" },
        { key: "foe", def: character({ name: "Foe", strength: foeStrength, life: foeLife, speed }), owner: P2, zone: "play" }
      ]
    });
    declareAttack(engine, P1, [id("me")]);
    resolvePendingResponses(engine);
    declareBlockers(engine, P2, [id("foe")]);
    autoResolveBattle(engine);
    return { me: engine.state.cards[id("me")], foe: engine.state.cards[id("foe")] };
  };
  const exact = run(life, strength);
  assert.equal(exact.foe.zone, "discard", "strength damage equal to the foe's life destroys it");
  assert.equal(exact.me.zone, "discard", "the foe's strength equal to its life destroys it");
  const survives = run(life - 1, strength + 1);
  assert.equal(survives.foe.zone, "play", "one point short of the foe's life: it survives");
  assert.equal(survives.foe.damage, strength);
  assert.equal(survives.me.zone, "play", "damage one short of its life: it survives");
  assert.equal(survives.me.damage, life - 1);
}

// --- Costly Filcher --------------------------------------------------------
// No rules text. Character, rogue, thief, cost 5, threshold [D], 3/4/1.

const FILCHER = "94d257e6-d664-4f24-8582-b468eb08eabc";

clause(FILCHER, "vanilla", "deploys for exactly its printed cost of 5 and threshold [D], as a character under my control", () => vanillaDeploys(FILCHER, 5));
clause(FILCHER, "vanilla", "is refused one resource short of 5", () => vanillaShort(FILCHER, 5));
clause(FILCHER, "vanilla", "is refused without [D], however many other resources I have", () => vanillaThreshold(FILCHER, 5, 1));
clause(FILCHER, "vanilla", "has its printed 3 strength, 4 speed and 1 life, and no keywords or restrictions", () => vanillaStats(FILCHER, 3, 4, 1));
clause(FILCHER, "vanilla", "has no rules text: entering play changes nothing else", () => vanillaNothingHappens(FILCHER, 5));
clause(FILCHER, "vanilla", "its strength and life count in battle", () => vanillaBattle(FILCHER, 3, 4, 1));

// --- Defenestrate ----------------------------------------------------------
// Put the top 2 cards of your opponent's deck into their discard pile. Then,
// draw a card. Tactic, rogue, cost 3, threshold [D].

const DEFENESTRATE = "d74f6b0f-58d5-4e07-b5bc-dbd1a17df192";

const defenestrateBoard = (opts: HandOpts & { oppDeck?: number; myDeck?: number } = {}) =>
  handBoard(DEFENESTRATE, {
    ...opts,
    extra: [...deckCards(P2, opts.oppDeck ?? 6, "o"), ...deckCards(P1, opts.myDeck ?? 4, "m"), { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" }, ...(opts.extra ?? [])]
  });

clause(DEFENESTRATE, "0:rule", "mills exactly the top 2 cards of the opponent's deck into THEIR discard pile, in order, and leaves the rest", () => {
  const { engine, id } = defenestrateBoard();
  const oppDeck = [...engine.state.players[P2].deck];
  play(engine, P1, id("me"));
  assert.deepEqual([...engine.state.players[P2].discard].sort(), oppDeck.slice(0, 2).sort(), "exactly the top 2 are milled");
  assert.deepEqual(engine.state.players[P2].deck, oppDeck.slice(2), "the rest of their deck is untouched, in order");
  assert.equal(engine.state.players[P1].discard.filter((c) => c !== id("me")).length, 0, "nothing of theirs went to my discard pile");
  assert.equal(engine.state.players[P2].hand.length, 1, "the opponent's hand is untouched");
});

clause(DEFENESTRATE, "0:rule", "then I draw exactly one card, the top card of MY deck; the opponent draws nothing", () => {
  const { engine, id } = defenestrateBoard();
  const myDeck = [...engine.state.players[P1].deck];
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("me"));
  assert.equal(engine.state.players[P1].hand.length, handBefore - 1 + 1, "the tactic left my hand, one card was drawn");
  assert.ok(engine.state.players[P1].hand.includes(myDeck[0]), "the drawn card is the top of my deck");
  assert.deepEqual(engine.state.players[P1].deck, myDeck.slice(1), "only one card left my deck");
  assert.equal(engine.state.players[P2].hand.length, 1, "the opponent drew nothing");
});

clause(DEFENESTRATE, "0:rule", "the mill happens first, then the draw ('Then, draw a card')", () => {
  const { engine, id } = defenestrateBoard();
  play(engine, P1, id("me"));
  const moves = engine
    .getLog()
    .map((entry) => entry.event as unknown as { type: string; from?: string; to?: string } | undefined)
    .filter((ev): ev is { type: string; from?: string; to?: string } => !!ev && (ev.type === "cardsDrawn" || (ev.type === "cardMoved" && ev.from === "deck")));
  const firstDraw = moves.findIndex((ev) => ev.type === "cardsDrawn");
  const lastMill = moves.map((ev, i) => (ev.type === "cardMoved" && ev.to === "discard" ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(lastMill >= 0 && firstDraw >= 0, "both a mill and a draw happened");
  assert.ok(lastMill < firstDraw, "both cards were milled before the draw");
});

clause(DEFENESTRATE, "0:rule", "the tactic ends in my discard pile and is paid for exactly 3", () => {
  const { engine, id } = defenestrateBoard();
  const before = ready(engine);
  play(engine, P1, id("me"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(engine.state.cards[id("me")].zone, "discard");
  assert.ok(engine.state.players[P1].discard.includes(id("me")), "engine.state.players[P1].discard.includes(id(\"me\"))");
});

clause(DEFENESTRATE, "0:rule", "an opponent deck of 1 card: it is milled and the draw still happens", () => {
  const { engine, id } = defenestrateBoard({ oppDeck: 1 });
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("me"));
  assert.equal(engine.state.players[P2].deck.length, 0);
  assert.equal(engine.state.players[P2].discard.length, 1);
  assert.equal(engine.state.players[P1].hand.length, handBefore, "the draw still happened (-1 tactic, +1 drawn)");
});

clause(DEFENESTRATE, "0:rule", "an empty opponent deck: nothing to mill, the draw still happens", () => {
  const { engine, id } = defenestrateBoard({ oppDeck: 0 });
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("me"));
  assert.equal(engine.state.players[P2].discard.length, 0);
  assert.equal(engine.state.players[P1].hand.length, handBefore);
});

clause(DEFENESTRATE, "0:rule", "my own deck empty: the mill happens, I draw nothing and do not lose (CR 102.1a)", () => {
  const { engine, id } = defenestrateBoard({ myDeck: 0 });
  play(engine, P1, id("me"));
  assert.equal(engine.state.players[P2].discard.length, 2);
  assert.equal(engine.state.players[P1].hand.length, 0, "nothing to draw");
  assert.equal(engine.state.result, undefined, "running out of cards does not lose the game");
});

clause(DEFENESTRATE, "0:rule", "is refused one resource short of 3, and without [D]", () => {
  const exact = deployCostChecks((res) => defenestrateBoard(res), 3, 1);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "discard");
});

clause(DEFENESTRATE, "0:rule", "it is a tactic: it can be played in response to the opponent on their turn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "me", def: printing(DEFENESTRATE), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" },
      ...deckCards(P2, 4, "o"),
      ...deckCards(P1, 2, "m"),
      ...bank("deception", 3, P1),
      ...bank("greed", 3, P2)
    ]
  });
  playRaw(engine, P2, id("theirs"));
  playRaw(engine, P1, id("me"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.players[P2].discard.length, 2, "two of the opponent's cards were milled");
  assert.equal(engine.state.cards[id("me")].zone, "discard");
});

// --- Dock Sentinel ---------------------------------------------------------
// No rules text. Character, rogue, guard, cost 7, threshold [D][D], 5/4/4.

const SENTINEL = "dca4e0b3-c3fa-4907-b6c9-5fd0de2a9f97";

clause(SENTINEL, "vanilla", "deploys for exactly its printed cost of 7 and threshold [D][D], as a character under my control", () => vanillaDeploys(SENTINEL, 7));
clause(SENTINEL, "vanilla", "is refused one resource short of 7", () => vanillaShort(SENTINEL, 7));
clause(SENTINEL, "vanilla", "is refused with only one [D], however many other resources I have", () => vanillaThreshold(SENTINEL, 7, 2));
clause(SENTINEL, "vanilla", "has its printed 5 strength, 4 speed and 4 life, and no keywords or restrictions", () => vanillaStats(SENTINEL, 5, 4, 4));
clause(SENTINEL, "vanilla", "has no rules text: entering play changes nothing else", () => vanillaNothingHappens(SENTINEL, 7));
clause(SENTINEL, "vanilla", "its strength and life count in battle", () => vanillaBattle(SENTINEL, 5, 4, 4));

// --- Emergency Obfuscation -------------------------------------------------
// You may play this card whenever you could play a tactic. -- While this card is
// in play, both players switch seats. Both players are in control of their
// opponent's side. If the game ends, the owner of the winning deck wins the
// game. -- At the start of your turn, you must put a token on this card. -- At
// the end of your turn, if there are at least 2 tokens on this card, destroy it.
// Item, rogue, cost 3, threshold [D][D][D].

const OBFUSCATION = "1999770c-5f2d-415d-8da1-8efe44ef3e41";

/** A free tactic that destroys one chosen item (declaration `t`). */
const smashItem = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });

/** A character with a free "draw 1" ability (`draw1`). */
const drawer = (name: string) =>
  character({ name, strength: 1, life: 3, speed: 1, behavior: { abilities: [{ id: "draw1", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });

interface ObfOpts {
  deception?: number;
  /** Extra Deception resources the OPPONENT starts with (they are mine to pay with once the seats are swapped). */
  theirDeception?: number;
  turn?: number;
  active?: Player;
  copies?: number;
  extra?: CardPlacement[];
}

function obfBoard(opts: ObfOpts = {}) {
  const myRes = bank("deception", opts.deception ?? 5, P1);
  const theirRes = [...bank("greed", 4, P2), ...bank("deception", opts.theirDeception ?? 0, P2)];
  const built = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 12 },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "me", def: printing(OBFUSCATION), owner: P1, zone: "hand" },
      ...(opts.copies && opts.copies > 1 ? [{ key: "me2", def: printing(OBFUSCATION), owner: P1, zone: "hand" as const }] : []),
      { key: "m1", def: drawer("MyDrawer"), owner: P1, zone: "play" },
      { key: "t1", def: drawer("TheirDrawer"), owner: P2, zone: "play" },
      { key: "mi", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "ti", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      ...myRes,
      ...theirRes,
      { key: "ph", def: character({ name: "PH", cost: 1 }), owner: P1, zone: "hand" },
      { key: "oh", def: character({ name: "OH", cost: 1 }), owner: P2, zone: "hand" },
      { key: "smash", def: smashItem(), owner: P1, zone: "hand" },
      ...deckCards(P1, 3, "pk"),
      ...deckCards(P2, 3, "ok"),
      { key: "pd", def: character({ name: "PD" }), owner: P1, zone: "discard" },
      { key: "od", def: character({ name: "OD" }), owner: P2, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
  return { ...built, myRes: myRes.map((p) => p.key), theirRes: theirRes.map((p) => p.key) };
}

/** Plays the Obfuscation (from hand) on the active player's turn and lets it resolve. */
const playObfuscation = (b: ReturnType<typeof obfBoard>, key = "me", player: Player = P1) => {
  play(b.engine, player, b.id(key));
  assert.equal(b.engine.state.cards[b.id(key)].zone, "play", "the Obfuscation is in play");
};

const controllerOf = (b: ReturnType<typeof obfBoard>, key: string) => b.engine.state.cards[b.id(key)].controllerId;

// -- 0:rule — tactical -----------------------------------------------------------

clause(OBFUSCATION, "0:rule", "it is an item that can be played in response to the opponent's card on their turn, like a tactic", () => {
  const b = obfBoard({ turn: 2, active: P2 });
  const { engine, id } = b;
  playRaw(engine, P2, id("oh"));
  assert.ok(engine.state.responseWindow, "the opponent's card is on the stack and I may respond");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("me"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("me")].zone, "play", "the item resolved into play");
  assert.equal(engine.state.cards[id("oh")].zone, "play", "the original card also resolved");
});

clause(OBFUSCATION, "0:rule", "a plain item cannot be played in that same window (only the Tactical card can)", () => {
  const b = obfBoard({ turn: 2, active: P2, extra: [{ key: "plain", def: item({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }] });
  const { engine, id } = b;
  playRaw(engine, P2, id("oh"));
  assert.ok(engine.state.responseWindow, "engine.state.responseWindow");
  refused(() => playRaw(engine, P1, id("plain")), "an ordinary item cannot be played on the opponent's turn");
  playRaw(engine, P1, id("me"));
  assert.ok(engine.state.responseWindow, "but the Obfuscation can");
});

clause(OBFUSCATION, "0:rule", "it can be played at a battle response point, like a tactic (the opponent has just attacked)", () => {
  const b = obfBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk", speed: 3 }), owner: P2, zone: "play" }] });
  const { engine, id } = b;
  declareAttack(engine, P2, [id("atk")]);
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "now it is my turn to respond");
  playRaw(engine, P1, id("me"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("me")].zone, "play");
});

clause(OBFUSCATION, "0:rule", "it is NOT playable when no tactic could be played: the opponent's turn with nothing happening", () => {
  const b = obfBoard({ turn: 2, active: P2 });
  assert.equal(b.engine.state.responseWindow, undefined);
  refused(() => playRaw(b.engine, P1, b.id("me")));
  assert.equal(b.engine.state.cards[b.id("me")].zone, "hand");
});

clause(OBFUSCATION, "0:rule", "on my own turn it is played like any item: pays exactly 3 (attaching three of my resources), needs [D][D][D]", () => {
  const short = obfBoard({ deception: 2 });
  refused(() => playRaw(short.engine, P1, short.id("me")), "two resources is one short of 3");
  assert.equal(short.engine.state.cards[short.id("me")].zone, "hand");

  const noIcons = obfBoard({ deception: 2, extra: bank("greed", 6, P1) });
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("me")), "only two [D], however many other resources");

  const b = obfBoard({ deception: 3 });
  const attachedBefore = b.myRes.filter((key) => b.engine.state.cards[b.id(key)].attachedTo !== undefined).length;
  playObfuscation(b);
  const attached = b.myRes.filter((key) => b.engine.state.cards[b.id(key)].attachedTo !== undefined).length;
  assert.equal(attached - attachedBefore, 3, "exactly three of my resources were spent");
});

// -- 1:rule — the seat swap ------------------------------------------------------

clause(OBFUSCATION, "1:rule", "before it is in play nothing is swapped; the moment it enters play every card in play changes controller: characters, items, resources, both factions and the Obfuscation itself", () => {
  const b = obfBoard();
  const { engine, id } = b;
  const f1 = engine.state.players[P1].factionId!;
  const f2 = engine.state.players[P2].factionId!;
  for (const key of ["m1", "mi", ...b.myRes]) assert.equal(controllerOf(b, key), P1, `${key} starts under P1`);
  for (const key of ["t1", "ti", ...b.theirRes]) assert.equal(controllerOf(b, key), P2, `${key} starts under P2`);
  assert.equal(engine.state.cards[f1].controllerId, P1);

  playObfuscation(b);

  for (const key of ["m1", "mi", ...b.myRes]) assert.equal(controllerOf(b, key), P2, `${key} is now controlled by P2`);
  for (const key of ["t1", "ti", ...b.theirRes]) assert.equal(controllerOf(b, key), P1, `${key} is now controlled by P1`);
  assert.equal(engine.state.cards[f1].controllerId, P2, "P1's faction is now under P2");
  assert.equal(engine.state.cards[f2].controllerId, P1, "P2's faction is now under P1");
  assert.equal(engine.state.cards[id("me")].controllerId, P2, "the Obfuscation itself passes to the other player too");
});

clause(OBFUSCATION, "1:rule", "'your faction' follows control: the players hold each other's faction card and influence", () => {
  const b = obfBoard();
  const { engine } = b;
  const f1 = engine.state.players[P1].factionId!;
  const f2 = engine.state.players[P2].factionId!;
  assert.equal(engine.state.players[P1].influence, 20);
  assert.equal(engine.state.players[P2].influence, 12);
  playObfuscation(b);
  assert.equal(engine.state.players[P1].factionId, f2, "P1 now holds P2's faction");
  assert.equal(engine.state.players[P2].factionId, f1, "P2 now holds P1's faction");
  assert.equal(engine.state.players[P1].influence, 12, "and its influence");
  assert.equal(engine.state.players[P2].influence, 20);
});

clause(OBFUSCATION, "1:rule", "ownership never changes, and hands, decks and discard piles stay with their owners", () => {
  const b = obfBoard();
  const { engine, id } = b;
  const piles = () => ({
    p1Deck: [...engine.state.players[P1].deck],
    p2Deck: [...engine.state.players[P2].deck],
    p1Discard: [...engine.state.players[P1].discard],
    p2Discard: [...engine.state.players[P2].discard],
    p1Hand: engine.state.players[P1].hand.filter((c) => c !== id("me")),
    p2Hand: [...engine.state.players[P2].hand]
  });
  const before = piles();
  playObfuscation(b);
  for (const key of ["m1", "mi", "me", ...b.myRes]) assert.equal(engine.state.cards[id(key)].ownerId, P1, `${key} is still owned by P1`);
  for (const key of ["t1", "ti", ...b.theirRes]) assert.equal(engine.state.cards[id(key)].ownerId, P2, `${key} is still owned by P2`);
  assert.deepEqual(piles(), before, "every deck, hand and discard pile is still its owner's, unchanged");
  assert.ok(engine.state.players[P1].hand.includes(id("ph")), "my hand card is still in my hand");
  assert.ok(engine.state.players[P2].hand.includes(id("oh")), "their hand card is still in their hand");
  assert.ok(engine.state.players[P1].discard.includes(id("pd")), "engine.state.players[P1].discard.includes(id(\"pd\"))");
  assert.ok(engine.state.players[P2].discard.includes(id("od")), "engine.state.players[P2].discard.includes(id(\"od\"))");
});

clause(OBFUSCATION, "1:rule", "each player now controls the OTHER side's resources: my available resources are the ones the opponent had, and theirs the ones I had left", () => {
  const b = obfBoard({ deception: 5 });
  const { engine } = b;
  assert.equal(ready(engine, P1), 5);
  assert.equal(ready(engine, P2), 4);
  playObfuscation(b);
  // 3 of my 5 Deception were spent on the Obfuscation; 2 are left, under P2 now.
  assert.equal(ready(engine, P1), 4, "P1 now has the 4 Greed the opponent had");
  assert.equal(ready(engine, P2), 2, "P2 now has the 2 Deception I had left");
});

clause(OBFUSCATION, "1:rule", "both players are in control of their opponent's side: I can use the abilities of the characters that were the opponent's, and not those of my own former characters (and vice versa)", () => {
  const b = obfBoard({ turn: 1 });
  const { engine, id } = b;
  playObfuscation(b);
  const hand = (player: Player) => engine.state.players[player].hand.length;
  const p1Hand = hand(P1);
  refused(() => activate(engine, P1, id("m1"), "draw1"), "my former character is under P2 now");
  assert.equal(hand(P1), p1Hand);
  activate(engine, P1, id("t1"), "draw1");
  assert.equal(hand(P1), p1Hand + 1, "I can use the character that was the opponent's");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const p2Hand = hand(P2);
  refused(() => activate(engine, P2, id("t1"), "draw1"), "on their own turn the opponent cannot use the character I took over");
  activate(engine, P2, id("m1"), "draw1");
  assert.equal(hand(P2), p2Hand + 1, "the opponent uses the character that was mine");
});

clause(OBFUSCATION, "1:rule", "when the Obfuscation leaves play the seats switch back: control, factions and influence all return", () => {
  const b = obfBoard();
  const { engine, id } = b;
  const f1 = engine.state.players[P1].factionId!;
  const f2 = engine.state.players[P2].factionId!;
  playObfuscation(b);
  assert.equal(controllerOf(b, "m1"), P2);
  // The Obfuscation is now under P2, whose items I can destroy; P1 plays Smash on it.
  play(engine, P1, id("smash"), { selected: { t: [id("me")] } });
  assert.equal(engine.state.cards[id("me")].zone, "discard", "the Obfuscation is destroyed");
  for (const key of ["m1", "mi", ...b.myRes]) assert.equal(controllerOf(b, key), P1, `${key} is back under P1`);
  for (const key of ["t1", "ti", ...b.theirRes]) assert.equal(controllerOf(b, key), P2, `${key} is back under P2`);
  assert.equal(engine.state.players[P1].factionId, f1);
  assert.equal(engine.state.players[P2].factionId, f2);
  assert.equal(engine.state.players[P1].influence, 20);
  assert.equal(engine.state.players[P2].influence, 12);
  assert.equal(engine.state.cards[f1].controllerId, P1);
  assert.equal(engine.state.cards[f2].controllerId, P2);
});

clause(OBFUSCATION, "1:rule", "two Obfuscations in play cancel out (everyone back in their own seat); removing one swaps again; removing both swaps back", () => {
  const b = obfBoard({ copies: 2, deception: 3, theirDeception: 6, extra: [{ key: "smash2", def: smashItem(), owner: P1, zone: "hand" }] });
  const { engine, id } = b;
  const f1 = engine.state.players[P1].factionId!;
  playObfuscation(b, "me");
  assert.equal(controllerOf(b, "m1"), P2, "one copy: swapped");
  playObfuscation(b, "me2");
  assert.equal(controllerOf(b, "m1"), P1, "two copies: back in their own seats");
  assert.equal(controllerOf(b, "t1"), P2);
  assert.equal(engine.state.players[P1].factionId, f1);
  assert.equal(engine.state.players[P1].influence, 20);

  play(engine, P1, id("smash"), { selected: { t: [id("me")] } });
  assert.equal(engine.state.cards[id("me")].zone, "discard");
  assert.equal(controllerOf(b, "m1"), P2, "one copy left: swapped again");
  assert.notEqual(engine.state.players[P1].factionId, f1, "P1 holds the other faction again");

  play(engine, P1, id("smash2"), { selected: { t: [id("me2")] } });
  assert.equal(engine.state.cards[id("me2")].zone, "discard");
  assert.equal(controllerOf(b, "m1"), P1, "no copies left: back in their own seats");
  assert.equal(engine.state.players[P1].factionId, f1);
});

clause(OBFUSCATION, "1:rule", "a card that enters play while the seats are swapped is controlled by whoever played it, and is not moved when the swap ends", () => {
  const b = obfBoard({ deception: 5 });
  const { engine, id } = b;
  playObfuscation(b);
  // I now pay with the 4 Greed that used to be the opponent's.
  play(engine, P1, id("ph"));
  assert.equal(engine.state.cards[id("ph")].zone, "play");
  assert.equal(controllerOf(b, "ph"), P1, "controlled by the player who played it");
  play(engine, P1, id("smash"), { selected: { t: [id("me")] } });
  assert.equal(controllerOf(b, "ph"), P1, "still mine after the swap is lifted");
  assert.equal(controllerOf(b, "m1"), P1);
});

clause(OBFUSCATION, "1:rule", "a swap in the middle of a battle removes everyone from it (a control change takes a character out of the battle)", () => {
  const b = obfBoard({ turn: 2, extra: [{ key: "a1", def: character({ name: "A1", speed: 3 }), owner: P1, zone: "play" }, { key: "blk", def: character({ name: "Blk", speed: 1 }), owner: P2, zone: "play" }] });
  const { engine, id } = b;
  declareAttack(engine, P1, [id("a1")]);
  assert.deepEqual(engine.state.battle?.attackingParty, [id("a1")]);
  playRaw(engine, P1, id("me"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("me")].zone, "play");
  assert.deepEqual(engine.state.battle?.attackingParty ?? [], [], "the attacker changed controller, so it left the battle");
  assert.deepEqual(engine.state.battle?.blockingParty ?? [], []);
});

clause(OBFUSCATION, "1:rule", "if the game ends, the owner of the winning deck wins: an attack on the faction I hold from my own deck's side costs ME the game", () => {
  // Without the Obfuscation: P1 hits P2's faction for lethal and wins.
  const control = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 4 },
    turn: 2,
    cards: [{ key: "hit", def: character({ name: "Hit", strength: 6, life: 3, speed: 3 }), owner: P1, zone: "play" }]
  });
  declareAttack(control.engine, P1, [control.id("hit")]);
  resolvePendingResponses(control.engine);
  declareBlockers(control.engine, P2, []);
  autoResolveBattle(control.engine);
  assert.deepEqual(control.engine.state.result, { outcome: "victory", winners: [P1] }, "control: the attacker wins when the defender's faction hits 0");

  // With the Obfuscation in play the seats are swapped: P1 controls P2's character and attacks the faction P2
  // holds, which is the faction P1 OWNS. When it reaches 0 its owner (P1) loses, so P2 wins.
  const b = obfBoard({ turn: 2, extra: [{ key: "killer", def: character({ name: "Killer", strength: 6, life: 3, speed: 3 }), owner: P2, zone: "play" }] });
  const { engine, id } = b;
  playObfuscation(b);
  assert.equal(controllerOf(b, "killer"), P1, "I control the opponent's character now");
  engine.state.players[P2].influence = 4; // the faction P2 holds is P1's own faction
  engine.state.cards[id("killer")].attackEligibleTurn = engine.state.turn;
  declareAttack(engine, P1, [id("killer")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P2] }, "the faction of P1's deck hit 0, so the owner of the other deck wins");
});

// -- 2:rule — upkeep -------------------------------------------------------------

clause(OBFUSCATION, "2:rule", "at the start of the turn of the player who controls it (after the swap, the player who did NOT play it) it gets exactly one token, with no choice", () => {
  const b = obfBoard();
  const { engine, id } = b;
  playObfuscation(b);
  assert.equal(tokens(engine, id("me")), 0, "no token when it enters play");
  assert.equal(controllerOf(b, "me"), P2);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined, "'you must': there is no choice to make");
  assert.equal(tokens(engine, id("me")), 1, "its controller's turn started: one token");
});

clause(OBFUSCATION, "2:rule", "no token at the start of the turn of the player who does not control it", () => {
  const b = obfBoard();
  const { engine, id } = b;
  playObfuscation(b);
  endTurn(engine, P1); // P2's turn: token 1
  endTurn(engine, P2); // P1's turn
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(tokens(engine, id("me")), 1, "P1's turn start gives it nothing (P2 controls it)");
});

clause(OBFUSCATION, "2:rule", "one token per controller turn: 2 tokens after its controller's second turn", () => {
  const b = obfBoard();
  const { engine, id } = b;
  playObfuscation(b);
  endTurn(engine, P1);
  assert.equal(tokens(engine, id("me")), 1);
  endTurn(engine, P2);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(tokens(engine, id("me")), 2);
});

// -- 3:rule — expiry -------------------------------------------------------------

clause(OBFUSCATION, "3:rule", "at the end of its controller's turn with only 1 token it stays; with 2 tokens it is destroyed", () => {
  const b = obfBoard();
  const { engine, id } = b;
  playObfuscation(b);
  endTurn(engine, P1);
  assert.equal(tokens(engine, id("me")), 1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("me")].zone, "play", "one token: not destroyed at the end of its controller's first turn");
  endTurn(engine, P1);
  assert.equal(tokens(engine, id("me")), 2);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("me")].zone, "play", "two tokens now, but its controller's turn has not ended yet");
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("me")].zone, "discard", "two tokens at the end of its controller's turn: destroyed");
  assert.ok(engine.state.players[P1].discard.includes(id("me")), "it goes to its owner's discard pile");
});

clause(OBFUSCATION, "3:rule", "'at least 2': three tokens also destroy it at the end of its controller's turn", () => {
  const b = obfBoard();
  const { engine, id } = b;
  playObfuscation(b);
  endTurn(engine, P1);
  engine.state.cards[id("me")].counters = { token: 3 };
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("me")].zone, "discard");
});

clause(OBFUSCATION, "3:rule", "the check is at the end of ITS CONTROLLER'S turn only: with 5 tokens it survives the end of the other player's turn", () => {
  const b = obfBoard();
  const { engine, id } = b;
  playObfuscation(b);
  engine.state.cards[id("me")].counters = { token: 5 };
  assert.equal(controllerOf(b, "me"), P2);
  endTurn(engine, P1);
  assert.equal(engine.state.cards[id("me")].zone, "play", "P1's turn ended but P2 controls it");
});

clause(OBFUSCATION, "3:rule", "when it is destroyed at the end of the turn the seats switch back", () => {
  const b = obfBoard();
  const { engine } = b;
  const f1 = engine.state.players[P1].factionId!;
  playObfuscation(b);
  endTurn(engine, P1);
  endTurn(engine, P2);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(b.engine.state.cards[b.id("me")].zone, "discard");
  assert.equal(engine.state.players[P1].factionId, f1, "P1 has its own faction again");
  assert.equal(controllerOf(b, "m1"), P1);
  assert.equal(controllerOf(b, "t1"), P2);
});

// --- Entrancing Harlot -----------------------------------------------------
// If this card attacks, all other members of its party gain 1 speed this turn.
// Character, rogue, dancer, cost 5, threshold [D][D][D], 3/5/2.

const HARLOT = "717fbb2b-0b48-4153-aadd-5a5256db61c7";

function harlotBoard(opts: { harlot?: boolean; a1Life?: number; a1Speed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      ...(opts.harlot === false ? [] : [{ key: "h", def: printing(HARLOT), owner: P1, zone: "play" as const }]),
      { key: "a1", def: character({ name: "A1", strength: 1, life: opts.a1Life ?? 3, speed: opts.a1Speed ?? 3 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 3 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(HARLOT, "0:rule", "when it attacks with one other character, that character gains 1 speed and the Harlot's own speed is unchanged", () => {
  const { engine, id } = harlotBoard();
  declareAttack(engine, P1, [id("h"), id("a1")]);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("a1"), "speed"), 4, "the other party member gains 1 speed (3 -> 4)");
  assert.equal(engine.getStat(id("h"), "speed"), printing(HARLOT).speed, "the Harlot is not an 'other' member");
});

clause(HARLOT, "0:rule", "ALL other members of the party gain the speed (two allies both do)", () => {
  const { engine, id } = harlotBoard();
  declareAttack(engine, P1, [id("h"), id("a1"), id("a2")]);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("a1"), "speed"), 4);
  assert.equal(engine.getStat(id("a2"), "speed"), 3);
  assert.equal(engine.getStat(id("h"), "speed"), printing(HARLOT).speed);
});

clause(HARLOT, "0:rule", "only the +1 speed: strength and life of the other members are unchanged", () => {
  const { engine, id } = harlotBoard();
  declareAttack(engine, P1, [id("h"), id("a1")]);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("a1"), "strength"), 1);
  assert.equal(engine.getStat(id("a1"), "life"), 3);
});

clause(HARLOT, "0:rule", "only members of ITS party: a character that stays home, and the opponent's characters, gain nothing", () => {
  const { engine, id } = harlotBoard();
  declareAttack(engine, P1, [id("h"), id("a1")]);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("a2"), "speed"), 2, "my character that did not attack");
  assert.equal(engine.getStat(id("bystander"), "speed"), 3, "my character that did not attack");
  assert.equal(engine.getStat(id("foe"), "speed"), 3, "the opponent's character");
});

clause(HARLOT, "0:rule", "attacking alone is fine: nothing else gains speed", () => {
  const { engine, id } = harlotBoard();
  declareAttack(engine, P1, [id("h")]);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("h"), "speed"), printing(HARLOT).speed);
  assert.equal(engine.getStat(id("a1"), "speed"), 3);
  assert.equal(engine.getStat(id("a2"), "speed"), 2);
  assert.equal(engine.getStat(id("bystander"), "speed"), 3);
});

clause(HARLOT, "0:rule", "it triggers only if THIS card attacks: other characters attacking while the Harlot stays home gain nothing", () => {
  const { engine, id } = harlotBoard();
  declareAttack(engine, P1, [id("a1"), id("a2")]);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("a1"), "speed"), 3);
  assert.equal(engine.getStat(id("a2"), "speed"), 2);
  assert.equal(engine.getStat(id("h"), "speed"), printing(HARLOT).speed);
});

clause(HARLOT, "0:rule", "it triggers on attacking, not on blocking: the Harlot blocking alongside another blocker gives no speed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "h", def: printing(HARLOT), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", speed: 3 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", speed: 3, life: 9 }), owner: P2, zone: "play" }
    ]
  });
  declareAttack(engine, P2, [id("atk")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("h"), id("ally")]);
  assert.equal(engine.getStat(id("ally"), "speed"), 3, "the blocking ally gains no speed");
});

clause(HARLOT, "0:rule", "each Harlot gives the OTHER Harlot +1 speed, and itself nothing (two Harlots attacking together)", () => {
  const { engine, id } = harlotBoard({ extra: [{ key: "h2", def: printing(HARLOT), owner: P1, zone: "play" }] });
  declareAttack(engine, P1, [id("h"), id("h2")]);
  resolvePendingResponses(engine);
  const base = printing(HARLOT).speed!;
  assert.equal(engine.getStat(id("h"), "speed"), base + 1, "gains 1 from the other Harlot, not 2");
  assert.equal(engine.getStat(id("h2"), "speed"), base + 1);
});

clause(HARLOT, "0:rule", "the speed bonus is real in battle: a speed-5 ally with the Harlot strikes together with a speed-6 blocker instead of being struck first", () => {
  const fight = (withHarlot: boolean) => {
    const { engine, id } = harlotBoard({
      harlot: withHarlot,
      a1Life: 1,
      a1Speed: 5,
      extra: [
        { key: "fast", def: character({ name: "Fast", strength: 1, life: 4, speed: 6 }), owner: P2, zone: "play" },
        ...(withHarlot ? [] : [{ key: "h", def: character({ name: "H", strength: 3, life: 9, speed: 5 }), owner: P1, zone: "play" as const }])
      ]
    });
    declareAttack(engine, P1, [id("h"), id("a1")]);
    resolvePendingResponses(engine);
    declareBlockers(engine, P2, [id("fast")]);
    autoResolveBattle(engine, (source) => {
      if (!source.legalTargets.length || source.strength <= 0) return [];
      const target = source.legalTargets.find((t) => t.type === "card" && t.cardId === id("a1")) ?? source.legalTargets[0];
      return [{ sourceId: source.cardId, target, amount: source.strength }];
    });
    return { ally: engine.state.cards[id("a1")], fast: engine.state.cards[id("fast")] };
  };
  const control = fight(false);
  assert.equal(control.ally.zone, "discard", "control: the speed-6 blocker strikes first and kills the speed-5 ally");
  assert.equal(control.fast.zone, "play", "control: the ally never gets to hit back, so the blocker survives the 3 from the other attacker");
  const buffed = fight(true);
  assert.equal(buffed.ally.zone, "discard", "with the Harlot the ally is at speed 6 too: both strike together (the ally still dies)");
  assert.equal(buffed.fast.zone, "discard", "and the ally's 1 damage plus the Harlot's 3 now destroys the blocker");
});

clause(HARLOT, "0:rule", "'this turn': the bonus is gone when the turn is over", () => {
  const { engine, id } = harlotBoard();
  declareAttack(engine, P1, [id("h"), id("a1")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(engine.getStat(id("a1"), "speed"), 4, "still boosted later in the same turn");
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("a1"), "speed"), 3, "back to its printed speed when the turn ends");
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("a1"), "speed"), 3);
});

clause(HARLOT, "0:rule", "pays exactly its printed cost of 5, needs [D][D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(HARLOT, res), 5, 3);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Ferrous Ferret --------------------------------------------------------
// While this card is in play, anything that could pick it must pick it. -- If
// this card is picked, put a token on it. -- This card gains 1 strength and 1
// life for each token on it. Character, rogue, beast, cost 2, threshold [D][D],
// 1/4/1.

const FERRET = "f63f84a2-39e0-4358-81c9-e15a525a5ae6";

/** A free tactic that picks `count` cards matching `selector` (declaration `t`) and then just draws a card. */
const pickerTactic = (selector: CardSelector = { zone: "play", type: "character" }, count = 1, effects?: Effect[]): CardDefinition =>
  tactic({
    name: "Picker",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "p",
          type: "activated",
          targets: [{ id: "t", selector, count }],
          effects: effects ?? [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });

/** A free tactic whose EFFECT makes `chooser` pick a character (a `chooserSelectsTarget` effect) and then draws a card. */
const chooserPickerTactic = (chooser: "controller" | "opponent" = "controller"): CardDefinition =>
  tactic({
    name: "ChooserPicker",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "p",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser,
              declaration: { id: "c", selector: { zone: "play", type: "character" }, count: 1 },
              effects: [{ type: "draw", player: "controller", amount: 1 }]
            }
          ]
        }
      ]
    }
  });

/** A character whose "when this enters play" picks a character (declaration `t`) and gives it +1 speed this turn. */
const entrantPicker = (): CardDefinition =>
  character({
    name: "EntrantPicker",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "speed", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

interface FerretOpts {
  ferretOwner?: Player;
  ferretZone?: "play" | "hand" | "discard";
  turn?: number;
  active?: Player;
  extra?: CardPlacement[];
}

function ferretBoard(opts: FerretOpts = {}) {
  const owner = opts.ferretOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ferret", def: printing(FERRET), owner, zone: opts.ferretZone ?? "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...deckCards(P1, 4, "pk"),
      ...deckCards(P2, 4, "ok"),
      ...(opts.extra ?? [])
    ]
  });
}

const inHand = (key: string, def: CardDefinition, owner: Player = P1): CardPlacement => ({ key, def, owner, zone: "hand" });

// -- 0:rule — must be picked -------------------------------------------------------

clause(FERRET, "0:rule", "a pick of 'a character' must be the Ferret: another of my characters and the opponent's character are refused, the Ferret is accepted", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", pickerTactic())] });
  refused(() => playRaw(engine, P1, id("pick"), { selected: { t: [id("mine")] } }), "my other character");
  refused(() => playRaw(engine, P1, id("pick"), { selected: { t: [id("foe")] } }), "the opponent's character");
  assert.equal(engine.state.cards[id("pick")].zone, "hand");
  playRaw(engine, P1, id("pick"), { selected: { t: [id("ferret")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("pick")].zone, "discard", "picking the Ferret works");
});

clause(FERRET, "0:rule", "the legal candidates offered for such a pick are exactly the Ferret", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", pickerTactic())] });
  const candidates = engine.targetCandidates({ zone: "play", type: "character" }, { sourceId: id("pick"), controllerId: P1, abilityId: "p", selected: {} }).map((card) => card.id);
  assert.deepEqual(candidates, [id("ferret")]);
});

clause(FERRET, "0:rule", "'anything': the opponent's picks must pick it too (a tactic they play on their turn)", () => {
  const { engine, id } = ferretBoard({ turn: 2, active: P2, extra: [inHand("pick", pickerTactic(), P2)] });
  refused(() => playRaw(engine, P2, id("pick"), { selected: { t: [id("mine")] } }), "my other character, picked by the opponent");
  refused(() => playRaw(engine, P2, id("pick"), { selected: { t: [id("foe")] } }), "their own character");
  playRaw(engine, P2, id("pick"), { selected: { t: [id("ferret")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("pick")].zone, "discard");
});

clause(FERRET, "0:rule", "it works for a Ferret controlled by the opponent as well: my pick of 'a character' must be their Ferret", () => {
  const { engine, id } = ferretBoard({ ferretOwner: P2, extra: [inHand("pick", pickerTactic())] });
  refused(() => playRaw(engine, P1, id("pick"), { selected: { t: [id("mine")] } }), "my own character");
  refused(() => playRaw(engine, P1, id("pick"), { selected: { t: [id("foe")] } }), "their other character");
  playRaw(engine, P1, id("pick"), { selected: { t: [id("ferret")] } });
  assert.ok(engine.state.responseWindow, "picking the opponent's Ferret is accepted");
});

clause(FERRET, "0:rule", "only picks that COULD pick it: 'a character you control' while the Ferret is the opponent's is a free choice", () => {
  const { engine, id } = ferretBoard({ ferretOwner: P2, extra: [inHand("pick", pickerTactic({ zone: "play", type: "character", controller: "self" }))] });
  playRaw(engine, P1, id("pick"), { selected: { t: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("pick")].zone, "discard", "my own character is a legal pick: the Ferret is not a candidate for this effect");
});

clause(FERRET, "0:rule", "only picks that COULD pick it: 'a character with 3 or more strength' cannot pick the 1-strength Ferret, so it is a free choice", () => {
  const strong = (name: string) => character({ name, strength: 5, life: 3, speed: 1 });
  const pick = pickerTactic({
    zone: "play",
    type: "character",
    conditions: [{ type: "statCompare", target: { type: "selected", id: "__candidate" }, stat: "strength", operator: ">=", value: 3 }]
  });
  const { engine, id } = ferretBoard({ extra: [inHand("pick", pick), { key: "strong1", def: strong("Strong1"), owner: P1, zone: "play" }, { key: "strong2", def: strong("Strong2"), owner: P2, zone: "play" }] });
  refused(() => playRaw(engine, P1, id("pick"), { selected: { t: [id("ferret")] } }), "the Ferret is not a legal candidate for this selector");
  playRaw(engine, P1, id("pick"), { selected: { t: [id("strong2")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("pick")].zone, "discard", "a strong character may be picked while the Ferret is on the board");
});

clause(FERRET, "0:rule", "picks of other types are unaffected: 'an item' is a free choice", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", pickerTactic({ zone: "play", type: "item" }))] });
  playRaw(engine, P1, id("pick"), { selected: { t: [id("thing")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("pick")].zone, "discard");
});

clause(FERRET, "0:rule", "picking two characters: the Ferret must be one of them, the other can be anything", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", pickerTactic({ zone: "play", type: "character" }, 2))] });
  refused(() => playRaw(engine, P1, id("pick"), { selected: { t: [id("mine"), id("foe")] } }), "two non-Ferret characters");
  playRaw(engine, P1, id("pick"), { selected: { t: [id("ferret"), id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("pick")].zone, "discard", "the Ferret plus another is accepted");
});

clause(FERRET, "0:rule", "a pick made by an effect (the player chooses a character as the effect resolves) must also be the Ferret", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", chooserPickerTactic())] });
  play(engine, P1, id("pick"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("mine")] } } as never), "another of my characters");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("foe")] } } as never), "the opponent's character");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("ferret")] } } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(FERRET, "0:rule", "a pick the OPPONENT makes (they choose a character as the effect resolves) must be the Ferret too", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", chooserPickerTactic("opponent"))] });
  play(engine, P1, id("pick"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2);
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("foe")] } } as never), "their own character");
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [id("ferret")] } } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(FERRET, "0:rule", "a triggered ability's pick must be the Ferret as well", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("entrant", entrantPicker())] });
  play(engine, P1, id("entrant"));
  const open = engine.state.pendingChoice as unknown as { kind: string; declarations?: { id: string }[] } | undefined;
  if (open) {
    assert.equal(open.kind, "selectTargets");
    refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { t: [id("mine")] } } } as never), "another of my characters");
    refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { t: [id("foe")] } } } as never), "the opponent's character");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { t: [id("ferret")] } } } as never);
  }
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.getStat(id("ferret"), "speed"), printing(FERRET).speed! + 1, "the Ferret was the one picked");
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "my other character was not");
  assert.equal(engine.getStat(id("foe"), "speed"), 2, "neither was the opponent's");
});

clause(FERRET, "0:rule", "an activated ability of a character in play: its pick must be the Ferret too", () => {
  const zapper = character({
    name: "Zapper",
    behavior: { abilities: [{ id: "zap", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = ferretBoard({ extra: [{ key: "zapper", def: zapper, owner: P1, zone: "play" }] });
  refused(() => activate(engine, P1, id("zapper"), "zap", { selected: { t: [id("mine")] } }), "another character");
  refused(() => activate(engine, P1, id("zapper"), "zap", { selected: { t: [id("zapper")] } }), "the Zapper itself");
  const handBefore = engine.state.players[P1].hand.length;
  activate(engine, P1, id("zapper"), "zap", { selected: { t: [id("ferret")] } });
  assert.equal(engine.state.players[P1].hand.length, handBefore + 1, "the ability resolved on the Ferret");
});

clause(FERRET, "0:rule", "with two Ferrets in play either one may be picked, but not a plain character", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", pickerTactic()), { key: "ferret2", def: printing(FERRET), owner: P2, zone: "play" }] });
  refused(() => playRaw(engine, P1, id("pick"), { selected: { t: [id("mine")] } }), "a plain character");
  refused(() => playRaw(engine, P1, id("pick"), { selected: { t: [id("foe")] } }), "a plain character");
  playRaw(engine, P1, id("pick"), { selected: { t: [id("ferret2")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("pick")].zone, "discard", "the second Ferret is a fine pick");
  const other = ferretBoard({ extra: [inHand("pick", pickerTactic()), { key: "ferret2", def: printing(FERRET), owner: P2, zone: "play" }] });
  playRaw(other.engine, P1, other.id("pick"), { selected: { t: [other.id("ferret")] } });
  assert.ok(other.engine.state.responseWindow, "and so is the first");
});

clause(FERRET, "0:rule", "'while this card is in play': in hand, in the discard pile, or being deployed it forces nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = ferretBoard({ ferretZone: zone, extra: [inHand("pick", pickerTactic())] });
    playRaw(engine, P1, id("pick"), { selected: { t: [id("mine")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("pick")].zone, "discard", `a free pick while the Ferret is in the ${zone}`);
  }
});

clause(FERRET, "0:rule", "once the Ferret leaves play the pick is free again", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = ferretBoard({ extra: [inHand("bounce", bounce), inHand("pick", pickerTactic())] });
  playRaw(engine, P1, id("bounce"), { selected: { t: [id("ferret")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("ferret")].zone, "hand", "the Ferret was picked and bounced");
  playRaw(engine, P1, id("pick"), { selected: { t: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("pick")].zone, "discard", "now another character can be picked");
});

// -- 1:rule — token when picked ----------------------------------------------------

clause(FERRET, "1:rule", "picked by my tactic: exactly one token", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", pickerTactic())] });
  play(engine, P1, id("pick"), { selected: { t: [id("ferret")] } });
  assert.equal(tokens(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "picked by the opponent's tactic: a token as well", () => {
  const { engine, id } = ferretBoard({ turn: 2, active: P2, extra: [inHand("pick", pickerTactic(), P2)] });
  play(engine, P2, id("pick"), { selected: { t: [id("ferret")] } });
  assert.equal(tokens(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "picked by an effect that has a player choose a character: a token", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", chooserPickerTactic())] });
  play(engine, P1, id("pick"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("ferret")] } } as never);
  resolvePendingResponses(engine);
  assert.equal(tokens(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "picked by a triggered ability: a token", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("entrant", entrantPicker())] });
  play(engine, P1, id("entrant"));
  drain(engine, (pc) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { t: [id("ferret")] } } : declineAll(pc)));
  assert.equal(tokens(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "picked by an activated ability of a character: a token", () => {
  const zapper = character({
    name: "Zapper",
    behavior: { abilities: [{ id: "zap", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = ferretBoard({ extra: [{ key: "zapper", def: zapper, owner: P1, zone: "play" }] });
  activate(engine, P1, id("zapper"), "zap", { selected: { t: [id("ferret")] } });
  assert.equal(tokens(engine, id("ferret")), 1);
});

clause(FERRET, "1:rule", "each pick puts one more token on it: picked three times it has three tokens", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("p1", pickerTactic()), inHand("p2", pickerTactic()), inHand("p3", pickerTactic()), ...deckCards(P1, 3, "dd")] });
  for (const [n, key] of ["p1", "p2", "p3"].entries()) {
    play(engine, P1, id(key), { selected: { t: [id("ferret")] } });
    assert.equal(tokens(engine, id("ferret")), n + 1, `after pick ${n + 1}`);
  }
});

clause(FERRET, "1:rule", "picked along with another card in one two-card pick it still gets just one token", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", pickerTactic({ zone: "play", type: "character" }, 2))] });
  play(engine, P1, id("pick"), { selected: { t: [id("ferret"), id("foe")] } });
  assert.equal(tokens(engine, id("ferret")), 1);
  assert.equal(tokens(engine, id("foe")), 0, "only the Ferret has this rule");
});

clause(FERRET, "1:rule", "NOT picked, no token: an effect that merely affects every character (nothing is picked) leaves it without a token", () => {
  const sweep = tactic({
    name: "Sweep",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "createModifier", target: { type: "selected", id: "__candidate" }, stat: "speed", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }] }]
        }
      ]
    }
  });
  const { engine, id } = ferretBoard({ extra: [inHand("sweep", sweep)] });
  play(engine, P1, id("sweep"));
  assert.equal(engine.getStat(id("mine"), "speed"), 3, "the sweep did happen");
  assert.equal(engine.getStat(id("ferret"), "speed"), printing(FERRET).speed! + 1, "and it reached the Ferret");
  assert.equal(tokens(engine, id("ferret")), 0, "but nothing picked it");
});

clause(FERRET, "1:rule", "NOT picked, no token: a pick that cannot include it (an item, or a character it does not qualify as) leaves it alone", () => {
  const { engine, id } = ferretBoard({ extra: [inHand("pick", pickerTactic({ zone: "play", type: "item" }))] });
  play(engine, P1, id("pick"), { selected: { t: [id("thing")] } });
  assert.equal(tokens(engine, id("ferret")), 0);
});

clause(FERRET, "1:rule", "the token is there before the picking card's effect happens: a 1-damage tactic that picks the 1-life Ferret does not kill it", () => {
  const ping = pickerTactic({ zone: "play", type: "character" }, 1, [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]);
  const { engine, id } = ferretBoard({ extra: [inHand("ping", ping)] });
  assert.equal(engine.getStat(id("ferret"), "life"), 1);
  play(engine, P1, id("ping"), { selected: { t: [id("ferret")] } });
  assert.equal(tokens(engine, id("ferret")), 1);
  assert.equal(engine.state.cards[id("ferret")].zone, "play", "picked => token => life 2, so 1 damage does not destroy it");
  assert.equal(engine.state.cards[id("ferret")].damage, 1);
});

// -- 2:rule — scaling --------------------------------------------------------------

clause(FERRET, "2:rule", "gains 1 strength and 1 life for each token on it (0, 1, 3 and 6 tokens); speed is unchanged", () => {
  const printed = printing(FERRET);
  for (const n of [0, 1, 3, 6]) {
    const { engine, id } = buildGame({ cards: [{ key: "f", def: printing(FERRET), owner: P1, zone: "play", counters: { token: n } }] });
    assert.equal(engine.getStat(id("f"), "strength"), printed.strength! + n, `strength with ${n} tokens`);
    assert.equal(engine.getStat(id("f"), "life"), printed.life! + n, `life with ${n} tokens`);
    assert.equal(engine.getStat(id("f"), "speed"), printed.speed, `speed with ${n} tokens`);
  }
});

clause(FERRET, "2:rule", "only the Ferret gains the stats, not other characters of either player", () => {
  const { engine, id } = ferretBoard();
  engine.state.cards[id("ferret")].counters = { token: 3 };
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
  assert.equal(engine.getStat(id("mine"), "life"), 4);
  assert.equal(engine.getStat(id("foe"), "strength"), 2);
  assert.equal(engine.getStat(id("foe"), "life"), 4);
});

clause(FERRET, "2:rule", "the extra life counts for survival: with 2 tokens (life 3) it survives 2 damage and is destroyed by 3; with no token 1 damage kills it", () => {
  const blockAgainst = (strength: number, token: number) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "ferret", def: printing(FERRET), owner: P1, zone: "play", counters: token ? { token } : {} },
        { key: "atk", def: character({ name: "Atk", strength, life: 9, speed: 5 }), owner: P2, zone: "play" }
      ]
    });
    declareAttack(engine, P2, [id("atk")]);
    resolvePendingResponses(engine);
    declareBlockers(engine, P1, [id("ferret")]);
    autoResolveBattle(engine);
    return engine.state.cards[id("ferret")];
  };
  assert.equal(blockAgainst(1, 0).zone, "discard", "printed life 1: 1 damage kills it");
  const survivor = blockAgainst(2, 2);
  assert.equal(survivor.zone, "play", "two tokens: life 3 survives 2 damage");
  assert.equal(survivor.damage, 2);
  assert.equal(blockAgainst(3, 2).zone, "discard", "two tokens: 3 damage destroys it");
});

clause(FERRET, "2:rule", "the bonus follows the tokens: take a token away and it shrinks", () => {
  const printed = printing(FERRET);
  const { engine, id } = buildGame({ cards: [{ key: "f", def: printing(FERRET), owner: P1, zone: "play", counters: { token: 3 } }] });
  engine.state.cards[id("f")].counters = { token: 1 };
  assert.equal(engine.getStat(id("f"), "strength"), printed.strength! + 1);
  assert.equal(engine.getStat(id("f"), "life"), printed.life! + 1);
  engine.state.cards[id("f")].counters = {};
  assert.equal(engine.getStat(id("f"), "strength"), printed.strength);
  assert.equal(engine.getStat(id("f"), "life"), printed.life);
});

clause(FERRET, "2:rule", "tokens go away when the Ferret leaves play: put into hand and redeployed it is a fresh 1/4/1 with no tokens", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = ferretBoard({ extra: [inHand("bounce", bounce), ...bank("deception", 3, P1)] });
  engine.state.cards[id("ferret")].counters = { token: 2 };
  playRaw(engine, P1, id("bounce"), { selected: { t: [id("ferret")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("ferret")].zone, "hand");
  assert.equal(tokens(engine, id("ferret")), 0, "its tokens disappeared when it left play (CR 409.2)");
  play(engine, P1, id("ferret"));
  assert.equal(engine.state.cards[id("ferret")].zone, "play");
  assert.equal(tokens(engine, id("ferret")), 0, "a fresh Ferret has no tokens");
  assert.equal(engine.getStat(id("ferret"), "strength"), printing(FERRET).strength);
  assert.equal(engine.getStat(id("ferret"), "life"), printing(FERRET).life);
});

clause(FERRET, "2:rule", "pays exactly its printed cost of 2, needs [D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(FERRET, res), 2, 2);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Forced Recruitment ----------------------------------------------------
// COST: Play this only in response to a character being played. X is that
// character's cost. Pay X. -- EFFECT: The character enters play under your
// control. Tactic, rogue, cost 2, threshold [D][D].

const RECRUITMENT = "3d8b7973-4c92-433f-be56-a0cb0fd911ea";

interface RecruitOpts {
  guyCost?: number;
  deception?: number;
  greed?: number;
  guy?: CardDefinition;
  extra?: CardPlacement[];
}

function recruitBoard(opts: RecruitOpts = {}) {
  const guyCost = opts.guyCost ?? 2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "me", def: printing(RECRUITMENT), owner: P1, zone: "hand" },
      { key: "guy", def: opts.guy ?? character({ name: "Guy", cost: guyCost, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "hand" },
      { key: "oppTactic", def: tactic({ name: "OppTactic", cost: 0 }), owner: P2, zone: "hand" },
      { key: "oppItem", def: item({ name: "OppItem", cost: 0 }), owner: P2, zone: "hand" },
      { key: "oppPlace", def: location({ name: "OppPlace", cost: 0 }), owner: P2, zone: "hand" },
      { key: "oppChar", def: drawer("OppDrawer"), owner: P2, zone: "play" },
      ...bank("deception", opts.deception ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("greed", 10, P2),
      ...deckCards(P1, 3, "pk"),
      ...deckCards(P2, 3, "ok"),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 starts playing `guy`; P1 may now respond. */
function opponentPlaysGuy(b: ReturnType<typeof recruitBoard>) {
  playRaw(b.engine, P2, b.id("guy"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
}

for (const guyCost of [0, 1, 2, 4]) {
  clause(RECRUITMENT, "0:ability", `X is the character's cost (${guyCost}): I pay ${2 + guyCost} in total (the card's 2 plus X), and the character enters play under my control`, () => {
    const b = recruitBoard({ guyCost });
    const { engine, id } = b;
    opponentPlaysGuy(b);
    const myBefore = ready(engine, P1);
    const theirBefore = ready(engine, P2);
    playRaw(engine, P1, id("me"));
    assert.equal(myBefore - ready(engine, P1), 2 + guyCost, "2 for the card plus X for the extra cost");
    resolvePendingResponses(engine);
    const guy = engine.state.cards[id("guy")];
    assert.equal(guy.zone, "play", "it entered play");
    assert.equal(guy.controllerId, P1, "under my control");
    assert.equal(guy.ownerId, P2, "ownership never changes");
    assert.ok(engine.state.players[P1].play.includes(id("guy")), "engine.state.players[P1].play.includes(id(\"guy\"))");
    assert.ok(!engine.state.players[P2].play.includes(id("guy")), "!engine.state.players[P2].play.includes(id(\"guy\"))");
    assert.equal(engine.state.cards[id("me")].zone, "discard", "the tactic ends in my discard pile");
    assert.equal(ready(engine, P2), theirBefore, "what the opponent paid for the character is not refunded");
  });
}

clause(RECRUITMENT, "0:ability", "the character enters play ONCE: it is not also deployed for the opponent, and nothing else changes hands", () => {
  const b = recruitBoard();
  const { engine, id } = b;
  opponentPlaysGuy(b);
  playRaw(engine, P1, id("me"));
  resolvePendingResponses(engine);
  const copies = Object.values(engine.state.cards).filter((card) => card.id === id("guy"));
  assert.equal(copies.length, 1);
  assert.equal(engine.state.cards[id("oppChar")].controllerId, P2, "the opponent's other character is still theirs");
  assert.equal(engine.state.cards[id("guy")].zone, "play");
  assert.ok(!engine.state.players[P2].discard.includes(id("guy")), "it did not end up in the opponent's discard pile");
  assert.ok(!engine.state.players[P2].hand.includes(id("guy")), "or back in their hand");
});

clause(RECRUITMENT, "0:ability", "it really enters play under my control: its 'when this enters play' ability happens for ME", () => {
  const entrant = character({
    name: "Drawer ETB",
    cost: 1,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = recruitBoard({ guy: entrant });
  const { engine, id } = b;
  opponentPlaysGuy(b);
  const myHand = engine.state.players[P1].hand.length;
  const theirHand = engine.state.players[P2].hand.length;
  playRaw(engine, P1, id("me"));
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(engine.state.players[P1].hand.length, myHand - 1 + 1, "the tactic left my hand and the stolen character drew me a card");
  assert.equal(engine.state.players[P2].hand.length, theirHand, "the opponent drew nothing");
});

clause(RECRUITMENT, "0:ability", "only in response to a CHARACTER being played: refused against an item, a tactic and a location", () => {
  for (const key of ["oppItem", "oppTactic", "oppPlace"]) {
    const b = recruitBoard();
    playRaw(b.engine, P2, b.id(key));
    assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
    refused(() => playRaw(b.engine, P1, b.id("me")), `${key} is not a character`);
    assert.equal(b.engine.state.cards[b.id("me")].zone, "hand");
  }
});

clause(RECRUITMENT, "0:ability", "only in response to a character being PLAYED: refused against an ability activation, an attack, and an end-of-turn announcement", () => {
  const ability = recruitBoard();
  activateRaw(ability.engine, P2, ability.id("oppChar"), "draw1");
  assert.equal(ability.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => playRaw(ability.engine, P1, ability.id("me")), "an ability is not a character being played");

  const attack = recruitBoard({ extra: [{ key: "atk", def: character({ name: "Atk", speed: 3 }), owner: P2, zone: "play" }] });
  declareAttack(attack.engine, P2, [attack.id("atk")]);
  attack.engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(attack.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => playRaw(attack.engine, P1, attack.id("me")), "an attack is not a character being played");

  const end = recruitBoard();
  end.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(end.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => playRaw(end.engine, P1, end.id("me")), "ending the turn is not a character being played");
});

clause(RECRUITMENT, "0:ability", "refused when nothing is being played: the opponent's turn with no action, and my own turn", () => {
  const idle = recruitBoard();
  assert.equal(idle.engine.state.responseWindow, undefined);
  refused(() => playRaw(idle.engine, P1, idle.id("me")), "no response window on the opponent's turn");

  const mine = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "me", def: printing(RECRUITMENT), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", cost: 1 }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: 1 }), owner: P2, zone: "play" },
      ...bank("deception", 10, P1)
    ]
  });
  refused(() => playRaw(mine.engine, P1, mine.id("me")), "my own turn, nothing to respond to");
  playRaw(mine.engine, P1, mine.id("mine"));
  assert.equal(mine.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond to my character, I may not");
  // CR 607.1: you can never respond to your own action (the engine models it as the opponent holding priority).
  assert.throws(() => playRaw(mine.engine, P1, mine.id("me")), "I cannot respond to my own character being played");
});

clause(RECRUITMENT, "0:ability", "is refused when I cannot afford 2 + X: with a 3-cost character, 4 resources is one short of 5", () => {
  const short = recruitBoard({ guyCost: 3, deception: 4 });
  opponentPlaysGuy(short);
  refused(() => playRaw(short.engine, P1, short.id("me")), "4 resources for 2 + 3");
  assert.equal(short.engine.state.cards[short.id("me")].zone, "hand");
  assert.equal(ready(short.engine, P1), 4, "nothing was paid");

  const exact = recruitBoard({ guyCost: 3, deception: 5 });
  opponentPlaysGuy(exact);
  playRaw(exact.engine, P1, exact.id("me"));
  resolvePendingResponses(exact.engine);
  assert.equal(exact.engine.state.cards[exact.id("guy")].controllerId, P1, "5 resources is exactly enough");
  assert.equal(ready(exact.engine, P1), 0);
});

clause(RECRUITMENT, "0:ability", "needs [D][D] even with plenty of other resources", () => {
  const noIcons = recruitBoard({ guyCost: 1, deception: 1, greed: 10 });
  opponentPlaysGuy(noIcons);
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("me")), "one [D] is below the threshold");
  const ok = recruitBoard({ guyCost: 1, deception: 2, greed: 10 });
  opponentPlaysGuy(ok);
  playRaw(ok.engine, P1, ok.id("me"));
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("guy")].controllerId, P1);
});

clause(RECRUITMENT, "0:ability", "X is read from the character being played, not from some other card: a 0-cost character costs just the card's 2 even when a pricey one sits in play", () => {
  const b = recruitBoard({ guyCost: 0, extra: [{ key: "pricey", def: character({ name: "Pricey", cost: 7 }), owner: P2, zone: "play" }] });
  opponentPlaysGuy(b);
  const before = ready(b.engine, P1);
  playRaw(b.engine, P1, b.id("me"));
  assert.equal(before - ready(b.engine, P1), 2);
});

// --- Grand Theft All -------------------------------------------------------
// Put up to 4 characters, items, locations, and/or resources from your
// opponent's discard pile into play under your control. Tactic, rogue, cost 10,
// threshold [D][D][D][D].

const GTA = "3f6972bf-88bd-4b14-af92-d6356979c155";

interface GtaOpts {
  deception?: number;
  greed?: number;
  discard?: CardPlacement[];
  extra?: CardPlacement[];
}

/** The opponent's discard pile (keys `c1 c2 i1 i2 l1 r1 t1`): two characters, two items, a location, a resource and a tactic. */
const oppDiscard = (): CardPlacement[] => [
  { key: "c1", def: character({ name: "DiscardChar1", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "discard" },
  { key: "c2", def: character({ name: "DiscardChar2", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "discard" },
  { key: "i1", def: item({ name: "DiscardItem1" }), owner: P2, zone: "discard" },
  { key: "i2", def: item({ name: "DiscardItem2" }), owner: P2, zone: "discard" },
  { key: "l1", def: location({ name: "DiscardPlace", structure: 3 }), owner: P2, zone: "discard" },
  { key: "r1", def: resourceCard({ name: "DiscardRage" }), owner: P2, zone: "discard" },
  { key: "t1", def: tactic({ name: "DiscardTactic" }), owner: P2, zone: "discard" }
];

function gtaBoard(opts: GtaOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "me", def: printing(GTA), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 10, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.discard ?? oppDiscard()),
      { key: "mycorpse", def: character({ name: "MyCorpse" }), owner: P1, zone: "discard" },
      { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      { key: "oppDeck", def: character({ name: "OppDeck" }), owner: P2, zone: "deck" },
      { key: "oppPlay", def: character({ name: "OppPlay" }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays the tactic and returns the open pick (a `chooserSelectsTarget` for me). */
function gtaOpenPick(b: ReturnType<typeof gtaBoard>) {
  play(b.engine, P1, b.id("me"));
  const pc = b.engine.state.pendingChoice as unknown as { kind: string; playerId: string; declaration: { id: string; selector: CardSelector; count: number }; context: never } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget", "I am asked to pick the cards");
  assert.equal(pc?.playerId, P1, "I do the picking");
  return pc!;
}

const gtaChoose = (b: ReturnType<typeof gtaBoard>, keys: string[]) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map((key) => b.id(key)) } } as never);
  resolvePendingResponses(b.engine);
};

clause(GTA, "0:rule", "puts the 4 picked cards (a character, an item, a location, a resource) into play under my control and leaves the other discards where they were", () => {
  const b = gtaBoard();
  const { engine, id } = b;
  gtaOpenPick(b);
  gtaChoose(b, ["c1", "i1", "l1", "r1"]);
  for (const key of ["c1", "i1", "l1", "r1"]) {
    const card = engine.state.cards[id(key)];
    assert.equal(card.zone, "play", `${key} is in play`);
    assert.equal(card.controllerId, P1, `${key} is under my control`);
    assert.equal(card.ownerId, P2, `${key} is still owned by the opponent`);
    assert.ok(engine.state.players[P1].play.includes(id(key)), `${key} is in my play area`);
    assert.ok(!engine.state.players[P2].discard.includes(id(key)), `${key} left the opponent's discard pile`);
  }
  for (const key of ["c2", "i2", "t1"]) {
    assert.equal(engine.state.cards[id(key)].zone, "discard", `${key} was not picked and stays in their discard pile`);
    assert.equal(engine.state.cards[id(key)].controllerId, P2);
  }
  assert.equal(engine.state.cards[id("me")].zone, "discard", "the tactic goes to my discard pile");
});

clause(GTA, "0:rule", "each of the four kinds can be picked on its own: character, item, location and resource", () => {
  for (const key of ["c1", "i1", "l1", "r1"]) {
    const b = gtaBoard();
    gtaOpenPick(b);
    gtaChoose(b, [key]);
    assert.equal(b.engine.state.cards[b.id(key)].zone, "play", `${key} can be picked`);
    assert.equal(b.engine.state.cards[b.id(key)].controllerId, P1);
  }
});

clause(GTA, "0:rule", "the offered cards are exactly the characters, items, locations and resources in the opponent's discard pile: no tactic, nothing of mine, nothing from their hand, deck or play", () => {
  const b = gtaBoard();
  const pc = gtaOpenPick(b);
  const offered = b.engine.targetCandidates(pc.declaration.selector, pc.context, P1).map((card) => card.id).sort();
  assert.deepEqual(offered, ["c1", "c2", "i1", "i2", "l1", "r1"].map(b.id).sort());
});

clause(GTA, "0:rule", "a tactic in their discard pile, or any card that is not in their discard pile, is refused", () => {
  const b = gtaBoard();
  gtaOpenPick(b);
  for (const key of ["t1", "mycorpse", "oppHand", "oppDeck", "oppPlay"]) {
    refused(() => gtaChoose(b, [key]), `${key} cannot be picked`);
  }
  assert.ok(b.engine.state.pendingChoice, "the pick is still open");
  assert.equal(b.engine.state.cards[b.id("mycorpse")].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("oppPlay")].controllerId, P2);
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.engine.state.players[P2].factionId!] } } as never),
    "the opponent's faction card is not in their discard pile"
  );
});

clause(GTA, "0:rule", "'up to 4': five cards are refused, exactly four are accepted", () => {
  const b = gtaBoard();
  gtaOpenPick(b);
  refused(() => gtaChoose(b, ["c1", "c2", "i1", "i2", "l1"]), "five cards");
  assert.equal(b.engine.state.cards[b.id("c1")].zone, "discard", "nothing moved");
  gtaChoose(b, ["c1", "c2", "i1", "i2"]);
  for (const key of ["c1", "c2", "i1", "i2"]) assert.equal(b.engine.state.cards[b.id(key)].controllerId, P1);
  assert.equal(b.engine.state.cards[b.id("l1")].zone, "discard");
});

for (const n of [0, 1, 2, 3]) {
  clause(GTA, "0:rule", `'up to 4': picking only ${n} card${n === 1 ? "" : "s"} is fine and moves exactly those`, () => {
    const b = gtaBoard();
    gtaOpenPick(b);
    const keys = ["c1", "i1", "l1"].slice(0, n);
    gtaChoose(b, keys);
    assert.equal(b.engine.state.pendingChoice, undefined);
    for (const key of ["c1", "c2", "i1", "i2", "l1", "r1", "t1"]) {
      assert.equal(b.engine.state.cards[b.id(key)].zone, keys.includes(key) ? "play" : "discard", `${key}`);
    }
    assert.equal(b.engine.state.cards[b.id("me")].zone, "discard");
  });
}

clause(GTA, "0:rule", "a picked resource enters play as a resource I control: it adds an available resource and provides its icon", () => {
  const b = gtaBoard({ deception: 10 });
  const { engine, id } = b;
  assert.equal(engine.getThresholds(P1).rage ?? 0, 0, "no Rage icon before");
  gtaOpenPick(b);
  assert.equal(ready(engine, P1), 0, "the 10 Deception were spent on the tactic");
  gtaChoose(b, ["r1"]);
  assert.equal(engine.state.cards[id("r1")].zone, "play");
  assert.equal(engine.state.cards[id("r1")].faceDown, false);
  assert.equal(ready(engine, P1), 1, "the resource is available to spend");
  assert.equal(engine.getThresholds(P1).rage, 1, "and provides its Rage icon");
});

clause(GTA, "0:rule", "a picked character really enters play: its 'when this enters play' ability happens for me", () => {
  const entrant = character({
    name: "EntrantChar",
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = gtaBoard({ discard: [{ key: "ec", def: entrant, owner: P2, zone: "discard" }], extra: deckCards(P1, 3, "pk") });
  const { engine, id } = b;
  const hand = engine.state.players[P1].hand.length;
  gtaOpenPick(b);
  gtaChoose(b, ["ec"]);
  drain(engine, declineAll);
  assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1, "the tactic left my hand; the entering character drew me a card");
  assert.equal(engine.state.cards[id("ec")].controllerId, P1);
});

clause(GTA, "0:rule", "only the opponent's discard pile: my own discard pile is untouched and the opponent's hand, deck and board stay theirs", () => {
  const b = gtaBoard();
  const { engine, id } = b;
  const oppHand = [...engine.state.players[P2].hand];
  const oppDeck = [...engine.state.players[P2].deck];
  gtaOpenPick(b);
  gtaChoose(b, ["c1", "c2", "i1", "i2"]);
  assert.equal(engine.state.cards[id("mycorpse")].zone, "discard");
  assert.deepEqual(engine.state.players[P2].hand, oppHand);
  assert.deepEqual(engine.state.players[P2].deck, oppDeck);
  assert.equal(engine.state.cards[id("oppPlay")].controllerId, P2);
});

clause(GTA, "0:rule", "an empty opponent discard pile: the tactic can still be played and simply does nothing", () => {
  const b = gtaBoard({ discard: [] });
  const { engine, id } = b;
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("me")].zone, "discard", "played and discarded");
  assert.equal(engine.state.cards[id("mycorpse")].zone, "discard");
});

clause(GTA, "0:rule", "pays exactly its printed cost of 10, needs [D][D][D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => gtaBoard(res), 10, 4);
  drain(exact.engine, declineAll);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "discard");
});

clause(GTA, "0:rule", "a tactic: it can be played in response to the opponent's action on their turn", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "me", def: printing(GTA), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" },
      { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
      ...bank("deception", 10, P1),
      ...bank("greed", 2, P2)
    ]
  });
  playRaw(b.engine, P2, b.id("theirs"));
  playRaw(b.engine, P1, b.id("me"));
  resolvePendingResponses(b.engine);
  gtaChoose(b, ["corpse"]);
  assert.equal(b.engine.state.cards[b.id("corpse")].controllerId, P1);
});

// --- Hangdog Alley ---------------------------------------------------------
// Attacking parties can only have 1 member. Location, rogue, cost 3, threshold
// [D], structure 2.

const ALLEY = "39f985a8-fac4-4c7f-8c01-3c908c6d1103";

function alleyBoard(opts: { alley?: Player | false; active?: Player } = {}) {
  const active = opts.active ?? P1;
  const other = active === P1 ? P2 : P1;
  const owner = (name: string, who: Player): CardPlacement => ({ key: name, def: character({ name, strength: 1, life: 3, speed: 2 }), owner: who, zone: "play" });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    cards: [
      ...(opts.alley === false ? [] : [{ key: "alley", def: printing(ALLEY), owner: opts.alley ?? P1, zone: "play" as const }]),
      owner("a1", active),
      owner("a2", active),
      owner("a3", active),
      owner("b1", other),
      owner("b2", other)
    ]
  });
}

clause(ALLEY, "0:rule", "an attacking party of 1 member is fine", () => {
  const { engine, id } = alleyBoard();
  declareAttack(engine, P1, [id("a1")]);
  assert.deepEqual(engine.state.battle?.attackingParty, [id("a1")]);
});

clause(ALLEY, "0:rule", "an attacking party of 2 or 3 members is refused, and nothing is depleted or started", () => {
  const { engine, id } = alleyBoard();
  refused(() => declareAttack(engine, P1, [id("a1"), id("a2")]), "two attackers");
  refused(() => declareAttack(engine, P1, [id("a1"), id("a2"), id("a3")]), "three attackers");
  assert.equal(engine.state.battle, undefined, "no battle started");
  for (const key of ["a1", "a2", "a3"]) assert.equal(engine.state.cards[id(key)].depleted, false, `${key} was not depleted`);
});

clause(ALLEY, "0:rule", "without the Alley a party of 2 or 3 is fine (the control for the refusals above)", () => {
  const two = alleyBoard({ alley: false });
  declareAttack(two.engine, P1, [two.id("a1"), two.id("a2")]);
  assert.equal(two.engine.state.battle?.attackingParty.length, 2);
  const three = alleyBoard({ alley: false });
  declareAttack(three.engine, P1, [three.id("a1"), three.id("a2"), three.id("a3")]);
  assert.equal(three.engine.state.battle?.attackingParty.length, 3);
});

clause(ALLEY, "0:rule", "it limits the OPPONENT's attacking parties too (the Alley is mine, they attack with 2: refused; with 1: fine)", () => {
  const { engine, id } = alleyBoard({ alley: P1, active: P2 });
  refused(() => declareAttack(engine, P2, [id("a1"), id("a2")]), "the opponent attacking with two");
  assert.equal(engine.state.battle, undefined);
  declareAttack(engine, P2, [id("a1")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("a1")]);
});

clause(ALLEY, "0:rule", "it limits MY attacking parties when the OPPONENT controls the Alley", () => {
  const { engine, id } = alleyBoard({ alley: P2, active: P1 });
  refused(() => declareAttack(engine, P1, [id("a1"), id("a2")]), "me attacking with two");
  declareAttack(engine, P1, [id("a1")]);
  assert.deepEqual(engine.state.battle?.attackingParty, [id("a1")]);
});

clause(ALLEY, "0:rule", "only ATTACKING parties: a blocking party can have 2 or more members", () => {
  const { engine, id } = alleyBoard();
  declareAttack(engine, P1, [id("a1")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("b1"), id("b2")]);
  assert.deepEqual([...(engine.state.battle?.blockingParty ?? [])].sort(), [id("b1"), id("b2")].sort());
});

clause(ALLEY, "0:rule", "when the Alley leaves play, parties of 2 are legal again", () => {
  const smash = tactic({
    name: "SmashLocation",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "alley", def: printing(ALLEY), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", speed: 2 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", speed: 2 }), owner: P1, zone: "play" },
      { key: "smash", def: smash, owner: P1, zone: "hand" }
    ]
  });
  refused(() => declareAttack(engine, P1, [id("a1"), id("a2")]), "refused while the Alley is in play");
  play(engine, P1, id("smash"), { selected: { t: [id("alley")] } });
  assert.equal(engine.state.cards[id("alley")].zone, "discard");
  declareAttack(engine, P1, [id("a1"), id("a2")]);
  assert.equal(engine.state.battle?.attackingParty.length, 2);
});

clause(ALLEY, "0:rule", "a party of 1 may attack the Alley itself, and its printed structure 2 is real: 1 damage leaves it standing, 2 destroys it", () => {
  const strike = (strength: number) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "alley", def: printing(ALLEY), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength, life: 3, speed: 2 }), owner: P2, zone: "play" }
      ]
    });
    engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "card", cardId: id("alley") } } as never);
    resolvePendingResponses(engine);
    declareBlockers(engine, P1, []);
    autoResolveBattle(engine);
    return engine.state.cards[id("alley")];
  };
  const hurt = strike(1);
  assert.equal(hurt.zone, "play", "1 damage: structure 2 holds");
  assert.equal(hurt.damage, 1);
  assert.equal(strike(2).zone, "discard", "2 damage: destroyed");
});

clause(ALLEY, "0:rule", "pays exactly its printed cost of 3, needs [D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(ALLEY, res), 3, 1);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
  assert.equal(exact.engine.state.cards[exact.id("me")].controllerId, P1);
});

// --- Headlong Purloiner ----------------------------------------------------
// No rules text. Character, rogue, thief, cost 3, threshold [D][D], 2/4/2.

const PURLOINER = "830d3c0a-52dd-423b-a713-73a16f4ed80f";

clause(PURLOINER, "vanilla", "deploys for exactly its printed cost of 3 and threshold [D][D], as a character under my control", () => vanillaDeploys(PURLOINER, 3));
clause(PURLOINER, "vanilla", "is refused one resource short of 3", () => vanillaShort(PURLOINER, 3));
clause(PURLOINER, "vanilla", "is refused with only one [D], however many other resources I have", () => vanillaThreshold(PURLOINER, 3, 2));
clause(PURLOINER, "vanilla", "has its printed 2 strength, 4 speed and 2 life, and no keywords or restrictions", () => vanillaStats(PURLOINER, 2, 4, 2));
clause(PURLOINER, "vanilla", "has no rules text: entering play changes nothing else", () => vanillaNothingHappens(PURLOINER, 3));
clause(PURLOINER, "vanilla", "its strength and life count in battle", () => vanillaBattle(PURLOINER, 2, 4, 2));

// --- Heist Planner ---------------------------------------------------------
// When this card enters play, you may search your opponent's deck for up to 3
// cards with different names and put them into your opponent's discard pile.
// Character, rogue, thief, cost 3, threshold [D][D], 2/3/1.

const PLANNER = "5f93b923-bd32-4591-9a90-67c68a1e7c88";

/** The opponent's deck: top to bottom Alpha, Alpha (same name), Beta, Gamma, Delta, a tactic, an item and a resource. */
const plannerDeck = (): CardPlacement[] => [
  { key: "d1", def: character({ name: "Alpha" }), owner: P2, zone: "deck" },
  { key: "d2", def: character({ name: "Alpha" }), owner: P2, zone: "deck" },
  { key: "d3", def: character({ name: "Beta" }), owner: P2, zone: "deck" },
  { key: "d4", def: character({ name: "Gamma" }), owner: P2, zone: "deck" },
  { key: "d5", def: character({ name: "Delta" }), owner: P2, zone: "deck" },
  { key: "d6", def: tactic({ name: "Epsilon" }), owner: P2, zone: "deck" },
  { key: "d7", def: item({ name: "Zeta" }), owner: P2, zone: "deck" },
  { key: "d8", def: resourceCard({ name: "Eta" }), owner: P2, zone: "deck" }
];

function plannerBoard(opts: { deck?: CardPlacement[]; random?: () => number; deception?: number; greed?: number } = {}) {
  return handBoard(PLANNER, {
    deception: opts.deception,
    greed: opts.greed,
    random: opts.random,
    extra: [
      ...(opts.deck ?? plannerDeck()),
      ...deckCards(P1, 3, "pk"),
      { key: "oppHand", def: character({ name: "Beta" }), owner: P2, zone: "hand" },
      { key: "oppDiscard", def: character({ name: "Theta" }), owner: P2, zone: "discard" },
      { key: "oppPlay", def: character({ name: "Iota" }), owner: P2, zone: "play" }
    ]
  });
}

/** Plays the Planner and returns the open search (a `chooserSelectsTarget` for me). */
function plannerOpenSearch(b: ReturnType<typeof plannerBoard>) {
  play(b.engine, P1, b.id("me"));
  const pc = b.engine.state.pendingChoice as unknown as { kind: string; playerId: string; declaration: { selector: CardSelector }; context: never } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget", "I am asked what to search for");
  assert.equal(pc?.playerId, P1, "I do the searching");
  return pc!;
}

const plannerChoose = (b: ReturnType<typeof plannerBoard>, keys: string[]) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map((key) => b.id(key)) } } as never);
  resolvePendingResponses(b.engine);
};

clause(PLANNER, "0:rule", "three cards with different names are put into the opponent's discard pile; everything else stays in their deck", () => {
  const b = plannerBoard();
  const { engine, id } = b;
  const deckBefore = [...engine.state.players[P2].deck];
  plannerOpenSearch(b);
  plannerChoose(b, ["d1", "d3", "d5"]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual([...engine.state.players[P2].discard].sort(), [id("d1"), id("d3"), id("d5"), id("oppDiscard")].sort(), "exactly the three picks join the opponent's discard pile");
  for (const key of ["d1", "d3", "d5"]) assert.equal(engine.state.cards[id(key)].zone, "discard", key);
  assert.deepEqual([...engine.state.players[P2].deck].sort(), deckBefore.filter((c) => ![id("d1"), id("d3"), id("d5")].includes(c)).sort(), "the other five stay in their deck");
  assert.equal(engine.state.players[P1].discard.length, 0, "nothing goes to my discard pile");
});

clause(PLANNER, "0:rule", "any kind of card can be found: a tactic, an item and a resource are legal picks", () => {
  const b = plannerBoard();
  plannerOpenSearch(b);
  plannerChoose(b, ["d6", "d7", "d8"]);
  for (const key of ["d6", "d7", "d8"]) assert.equal(b.engine.state.cards[b.id(key)].zone, "discard", key);
});

clause(PLANNER, "0:rule", "the cards must have DIFFERENT names: two copies of Alpha are refused, one Alpha with others is fine", () => {
  const b = plannerBoard();
  plannerOpenSearch(b);
  refused(() => plannerChoose(b, ["d1", "d2"]), "two Alphas");
  refused(() => plannerChoose(b, ["d1", "d2", "d3"]), "two Alphas plus a Beta");
  assert.ok(b.engine.state.pendingChoice, "the search is still open");
  assert.equal(b.engine.state.cards[b.id("d1")].zone, "deck", "nothing moved");
  plannerChoose(b, ["d2", "d3", "d4"]);
  assert.equal(b.engine.state.cards[b.id("d2")].zone, "discard");
});

clause(PLANNER, "0:rule", "'up to 3': four cards are refused", () => {
  const b = plannerBoard();
  plannerOpenSearch(b);
  refused(() => plannerChoose(b, ["d1", "d3", "d4", "d5"]), "four cards");
  assert.equal(b.engine.state.cards[b.id("d1")].zone, "deck");
});

for (const n of [0, 1, 2]) {
  clause(PLANNER, "0:rule", `'up to 3' (and 'you may'): ${n} card${n === 1 ? "" : "s"} is fine, exactly those move`, () => {
    const b = plannerBoard();
    const { engine, id } = b;
    plannerOpenSearch(b);
    const keys = ["d1", "d3", "d4"].slice(0, n);
    plannerChoose(b, keys);
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(engine.state.cards[id("me")].zone, "play", "the Planner stays in play");
    for (const key of ["d1", "d2", "d3", "d4", "d5"]) assert.equal(engine.state.cards[id(key)].zone, keys.includes(key) ? "discard" : "deck", key);
  });
}

clause(PLANNER, "0:rule", "the offered cards are exactly the cards in the OPPONENT'S DECK: not my deck, their hand, their discard pile or their board", () => {
  const b = plannerBoard();
  const pc = plannerOpenSearch(b);
  const offered = b.engine.targetCandidates(pc.declaration.selector, pc.context, P1).map((card) => card.id).sort();
  assert.deepEqual(offered, ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8"].map(b.id).sort());
  for (const key of ["pk0", "oppHand", "oppDiscard", "oppPlay"]) {
    refused(() => plannerChoose(b, [key]), `${key} is not in the opponent's deck`);
  }
});

clause(PLANNER, "0:rule", "the searched deck is shuffled afterwards (a seeded RNG that rotates the deck shows it)", () => {
  const b = plannerBoard({ random: () => 0 });
  const { engine, id } = b;
  const before = [...engine.state.players[P2].deck];
  plannerOpenSearch(b);
  plannerChoose(b, ["d3"]);
  const remaining = before.filter((c) => c !== id("d3"));
  const after = [...engine.state.players[P2].deck];
  assert.deepEqual([...after].sort(), [...remaining].sort(), "same cards");
  assert.notDeepEqual(after, remaining, "but no longer in the original order: the deck was shuffled");
});

clause(PLANNER, "0:rule", "my own deck is not searched or shuffled", () => {
  const b = plannerBoard({ random: () => 0 });
  const { engine } = b;
  const mine = [...engine.state.players[P1].deck];
  plannerOpenSearch(b);
  plannerChoose(b, ["d1"]);
  assert.deepEqual(engine.state.players[P1].deck, mine);
});

clause(PLANNER, "0:rule", "an opponent deck with fewer than 3 distinct names: pick what exists (a 2-card deck, both picked)", () => {
  const b = plannerBoard({ deck: plannerDeck().slice(2, 4) });
  plannerOpenSearch(b);
  plannerChoose(b, ["d3", "d4"]);
  assert.equal(b.engine.state.players[P2].deck.length, 0);
  assert.equal(b.engine.state.cards[b.id("d3")].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("d4")].zone, "discard");
});

clause(PLANNER, "0:rule", "an empty opponent deck: the Planner enters play and nothing else happens", () => {
  const b = plannerBoard({ deck: [] });
  play(b.engine, P1, b.id("me"));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("me")].zone, "play");
  assert.equal(b.engine.state.players[P2].discard.length, 1, "only the discard pile the opponent already had");
});

clause(PLANNER, "0:rule", "the search happens when this card enters play, not when it is played from hand", () => {
  const b = plannerBoard();
  playRaw(b.engine, P1, b.id("me"));
  assert.equal(b.engine.state.pendingChoice, undefined, "no search while the opponent can still respond");
  assert.equal(b.engine.state.cards[b.id("d1")].zone, "deck");
  resolvePendingResponses(b.engine);
  assert.equal(pendingOf(b.engine)?.kind, "chooserSelectsTarget", "now it enters play and I search");
});

clause(PLANNER, "0:rule", "another card entering play does not trigger a search", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hp", def: printing(PLANNER), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" },
      ...plannerDeck(),
      ...bank("deception", 2, P1)
    ]
  });
  play(engine, P1, id("other"));
  assert.equal(engine.state.cards[id("other")].zone, "play");
  assert.equal(engine.state.pendingChoice, undefined, "no search");
  assert.equal(engine.state.players[P2].discard.length, 0);
});

clause(PLANNER, "0:rule", "pays exactly its printed cost of 3, needs [D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => plannerBoard(res), 3, 2);
  drain(exact.engine, declineAll);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Hyperphagic Sarcophyle ------------------------------------------------
// If this card inflicts damage to a faction, you may put a token on this card.
// -- This card gains 1 strength and 1 life for each token on it. Character,
// rogue, sarcophyle, cost 3, threshold [D][D], 2/2/2.

const HYPER = "a743615f-6309-4e62-be44-6531e7630e47";

/** Runs the battle to its end, answering every "put a token?" option choice with `option` (0 = decline, 1 = put a token). */
function finishBattle(engine: SpoilsEngine, option: number, seen: { kind: string; playerId: string }[] = []) {
  for (let guard = 0; guard < 20; guard++) {
    autoResolveBattle(engine);
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
    if (!pc) return;
    seen.push({ kind: pc.kind, playerId: pc.playerId });
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsOption", index: option } } as never);
    resolvePendingResponses(engine);
  }
  throw new Error("battle did not finish");
}

interface HyperOpts {
  owner?: Player;
  extra?: CardPlacement[];
  counters?: number;
}

function hyperBoard(opts: HyperOpts = {}) {
  const owner = opts.owner ?? P1;
  const other = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    cards: [
      { key: "hs", def: printing(HYPER), owner, zone: "play", counters: opts.counters ? { token: opts.counters } : {} },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6, speed: 1 }), owner: other, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

const attackFaction = (engine: SpoilsEngine, player: Player, attackers: string[], blockers: string[] = []) => {
  declareAttack(engine, player, attackers);
  resolvePendingResponses(engine);
  declareBlockers(engine, player === P1 ? P2 : P1, blockers);
};

clause(HYPER, "0:rule", "damaging the faction and accepting the 'may': exactly one token, and the faction lost the damage as influence", () => {
  const { engine, id } = hyperBoard();
  const influence = engine.state.players[P2].influence;
  attackFaction(engine, P1, [id("hs")]);
  const seen: { kind: string; playerId: string }[] = [];
  finishBattle(engine, 1, seen);
  assert.equal(engine.state.players[P2].influence, influence - 2, "the faction took the Sarcophyle's 2 damage");
  assert.equal(tokens(engine, id("hs")), 1, "one token");
  assert.deepEqual(seen, [{ kind: "chooserSelectsOption", playerId: P1 }], "my choice, asked once");
});

clause(HYPER, "0:rule", "damaging the faction and declining the 'may': no token", () => {
  const { engine, id } = hyperBoard();
  const influence = engine.state.players[P2].influence;
  attackFaction(engine, P1, [id("hs")]);
  finishBattle(engine, 0);
  assert.equal(engine.state.players[P2].influence, influence - 2);
  assert.equal(tokens(engine, id("hs")), 0, "declined");
});

clause(HYPER, "0:rule", "the choice belongs to the Sarcophyle's controller: the opponent's Sarcophyle attacking me asks THEM", () => {
  const { engine, id } = hyperBoard({ owner: P2 });
  attackFaction(engine, P2, [id("hs")]);
  const seen: { kind: string; playerId: string }[] = [];
  finishBattle(engine, 1, seen);
  assert.deepEqual(seen, [{ kind: "chooserSelectsOption", playerId: P2 }]);
  assert.equal(tokens(engine, id("hs")), 1);
});

clause(HYPER, "0:rule", "only damage to a FACTION counts: blocked by a character, the damage goes to the blocker and there is no token and no choice", () => {
  const { engine, id } = hyperBoard();
  attackFaction(engine, P1, [id("hs")], [id("foe")]);
  const seen: { kind: string; playerId: string }[] = [];
  finishBattle(engine, 1, seen);
  assert.equal(engine.state.cards[id("foe")].damage, 2, "the blocker took the damage");
  assert.equal(seen.length, 0, "no choice was offered");
  assert.equal(tokens(engine, id("hs")), 0);
});

clause(HYPER, "0:rule", "damage to a location is not damage to a faction: no token", () => {
  const { engine, id } = hyperBoard({ extra: [{ key: "place", def: location({ name: "Place", structure: 5 }), owner: P2, zone: "play" }] });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("hs")], target: { type: "card", cardId: id("place") } } as never);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, []);
  const seen: { kind: string; playerId: string }[] = [];
  finishBattle(engine, 1, seen);
  assert.equal(engine.state.cards[id("place")].damage, 2, "the location took the damage");
  assert.equal(seen.length, 0);
  assert.equal(tokens(engine, id("hs")), 0);
});

clause(HYPER, "0:rule", "a Sarcophyle that inflicts 0 damage inflicts none: no token and no choice", () => {
  const shrink = tactic({
    name: "Shrink",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: -2, duration: { type: "untilEndOfTurn" } }] }] }
  });
  const { engine, id } = hyperBoard({ extra: [{ key: "shrink", def: shrink, owner: P1, zone: "hand" }] });
  play(engine, P1, id("shrink"), { selected: { t: [id("hs")] } });
  assert.equal(engine.getStat(id("hs"), "strength"), 0);
  const influence = engine.state.players[P2].influence;
  attackFaction(engine, P1, [id("hs")]);
  const seen: { kind: string; playerId: string }[] = [];
  finishBattle(engine, 1, seen);
  assert.equal(engine.state.players[P2].influence, influence, "no damage");
  assert.equal(seen.length, 0, "no choice offered");
  assert.equal(tokens(engine, id("hs")), 0);
});

clause(HYPER, "0:rule", "if THIS card inflicts the damage: an ally that hits the faction does not give the Sarcophyle a token when the Sarcophyle itself hit a blocker", () => {
  const ally = character({ name: "Ally", strength: 1, life: 3, speed: 1 });
  // The blocker (speed 0, 1 life) dies to the Sarcophyle (speed 2) first; the ally (speed 1) then hits the faction.
  const weakFoe = character({ name: "Weak", strength: 0, life: 1, speed: 0 });
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "hs", def: printing(HYPER), owner: P1, zone: "play" },
      { key: "ally", def: ally, owner: P1, zone: "play" },
      { key: "weak", def: weakFoe, owner: P2, zone: "play" }
    ]
  });
  const influence = board.engine.state.players[P2].influence;
  attackFaction(board.engine, P1, [board.id("hs"), board.id("ally")], [board.id("weak")]);
  const seen: { kind: string; playerId: string }[] = [];
  finishBattle(board.engine, 1, seen);
  assert.equal(board.engine.state.cards[board.id("weak")].zone, "discard", "the blocker died to the Sarcophyle");
  assert.equal(board.engine.state.players[P2].influence, influence - 1, "the ally damaged the faction for 1");
  assert.equal(seen.length, 0, "the Sarcophyle itself damaged no faction, so no choice");
  assert.equal(tokens(board.engine, board.id("hs")), 0);
});

clause(HYPER, "0:rule", "when both the Sarcophyle and an ally hit the faction there is just one choice, for the Sarcophyle's own damage", () => {
  const ally = character({ name: "Ally", strength: 1, life: 3, speed: 1 });
  const { engine, id } = hyperBoard({ extra: [{ key: "ally", def: ally, owner: P1, zone: "play" }] });
  const influence = engine.state.players[P2].influence;
  attackFaction(engine, P1, [id("hs"), id("ally")]);
  const seen: { kind: string; playerId: string }[] = [];
  finishBattle(engine, 1, seen);
  assert.equal(engine.state.players[P2].influence, influence - 3);
  assert.equal(seen.length, 1, "asked once");
  assert.equal(tokens(engine, id("hs")), 1);
  assert.equal(tokens(engine, id("ally")), 0);
});

clause(HYPER, "0:rule", "each damaging hit can add a token: a second battle on a later turn adds a second token, with the first token's extra strength dealt", () => {
  const { engine, id } = hyperBoard();
  const influence = engine.state.players[P2].influence;
  attackFaction(engine, P1, [id("hs")]);
  finishBattle(engine, 1);
  assert.equal(tokens(engine, id("hs")), 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  attackFaction(engine, P1, [id("hs")]);
  finishBattle(engine, 1);
  assert.equal(engine.state.players[P2].influence, influence - 2 - 3, "2 damage the first time, 3 (strength 2 + 1 token) the second");
  assert.equal(tokens(engine, id("hs")), 2);
});

clause(HYPER, "0:rule", "the token is optional every time: accept once, decline the next, and it keeps exactly one token", () => {
  const { engine, id } = hyperBoard();
  attackFaction(engine, P1, [id("hs")]);
  finishBattle(engine, 1);
  endTurn(engine, P1);
  endTurn(engine, P2);
  attackFaction(engine, P1, [id("hs")]);
  finishBattle(engine, 0);
  assert.equal(tokens(engine, id("hs")), 1);
});

clause(HYPER, "1:rule", "gains 1 strength and 1 life for each token on it (0, 1, 2 and 5 tokens); speed is unchanged", () => {
  const printed = printing(HYPER);
  for (const n of [0, 1, 2, 5]) {
    const { engine, id } = buildGame({ cards: [{ key: "hs", def: printing(HYPER), owner: P1, zone: "play", counters: { token: n } }] });
    assert.equal(engine.getStat(id("hs"), "strength"), printed.strength! + n, `strength with ${n} tokens`);
    assert.equal(engine.getStat(id("hs"), "life"), printed.life! + n, `life with ${n} tokens`);
    assert.equal(engine.getStat(id("hs"), "speed"), printed.speed, `speed with ${n} tokens`);
  }
});

clause(HYPER, "1:rule", "only this card gains the stats, not other characters", () => {
  const { engine, id } = hyperBoard({ counters: 3, extra: [{ key: "mine", def: character({ name: "Mine", strength: 1, life: 2, speed: 3 }), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("mine"), "strength"), 1);
  assert.equal(engine.getStat(id("mine"), "life"), 2);
  assert.equal(engine.getStat(id("foe"), "strength"), 1);
  assert.equal(engine.getStat(id("foe"), "life"), 6);
});

clause(HYPER, "1:rule", "the extra life counts for survival: with 1 token (life 3) it survives 2 damage and dies to 3; without a token 2 damage kills it", () => {
  const blockAgainst = (strength: number, token: number) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "hs", def: printing(HYPER), owner: P1, zone: "play", counters: token ? { token } : {} },
        { key: "atk", def: character({ name: "Atk", strength, life: 9, speed: 5 }), owner: P2, zone: "play" }
      ]
    });
    declareAttack(engine, P2, [id("atk")]);
    resolvePendingResponses(engine);
    declareBlockers(engine, P1, [id("hs")]);
    autoResolveBattle(engine);
    return engine.state.cards[id("hs")];
  };
  assert.equal(blockAgainst(2, 0).zone, "discard", "printed life 2: 2 damage kills it");
  const survivor = blockAgainst(2, 1);
  assert.equal(survivor.zone, "play", "one token: life 3 survives 2 damage");
  assert.equal(survivor.damage, 2);
  assert.equal(blockAgainst(3, 1).zone, "discard", "one token: 3 damage destroys it");
});

clause(HYPER, "1:rule", "tokens go away when the card leaves play: put into hand and redeployed it is a fresh 2/2/2 with no tokens", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = hyperBoard({ counters: 2, extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }, ...bank("deception", 3, P1)] });
  play(engine, P1, id("bounce"), { selected: { t: [id("hs")] } });
  assert.equal(engine.state.cards[id("hs")].zone, "hand");
  assert.equal(tokens(engine, id("hs")), 0, "its tokens disappeared when it left play (CR 409.2)");
  play(engine, P1, id("hs"));
  assert.equal(engine.state.cards[id("hs")].zone, "play");
  assert.equal(tokens(engine, id("hs")), 0, "a fresh Sarcophyle has no tokens");
  assert.equal(engine.getStat(id("hs"), "strength"), printing(HYPER).strength);
});

clause(HYPER, "1:rule", "pays exactly its printed cost of 3, needs [D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(HYPER, res), 3, 2);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Impulsive Abductress --------------------------------------------------
// KIDNAP -- COST: Destroy this card. Pick an attacking or blocking character. --
// EFFECT: Destroy the character. Character, rogue, pirate, cost 5, threshold
// [D][D], 2/3/2.

const ABDUCTRESS = "3efac444-67eb-4131-a1a8-e884db6d79b3";

interface AbductOpts {
  /** Who is the active (attacking) player; the Abductress is always P1's. */
  attacker?: Player;
  extra?: CardPlacement[];
}

function abductBoard(opts: AbductOpts = {}) {
  const attacker = opts.attacker ?? P2;
  const defender = attacker === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "ab", def: printing(ABDUCTRESS), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 3 }), owner: attacker, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 1, life: 5, speed: 3 }), owner: attacker, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 2 }), owner: defender, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, life: 5, speed: 2 }), owner: defender, zone: "play" },
      { key: "home", def: character({ name: "Home", strength: 1, life: 5, speed: 2 }), owner: defender, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: defender, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

/** The opponent (P2) attacks me with `attackers`, passes priority, and I get to respond. */
function opponentAttacks(b: ReturnType<typeof abductBoard>, attackers: string[]) {
  declareAttack(b.engine, P2, attackers.map(b.id));
  b.engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the attack");
}

clause(ABDUCTRESS, "0:ability:kidnap", "destroys an ATTACKING character: the Abductress is destroyed as the cost, the attacker is destroyed by the effect and leaves the battle", () => {
  const b = abductBoard();
  const { engine, id } = b;
  opponentAttacks(b, ["atk", "atk2"]);
  activate(engine, P1, id("ab"), "kidnap", { selected: { c: [id("atk")] } });
  assert.equal(engine.state.cards[id("ab")].zone, "discard", "COST: this card is destroyed");
  assert.equal(engine.state.cards[id("atk")].zone, "discard", "EFFECT: the picked attacker is destroyed");
  assert.ok(engine.state.players[P2].discard.includes(id("atk")), "to its owner's discard pile");
  assert.equal(engine.state.cards[id("atk2")].zone, "play", "the other attacker is untouched");
  assert.deepEqual(engine.state.battle?.attackingParty, [id("atk2")], "the destroyed attacker left the attacking party");
});

clause(ABDUCTRESS, "0:ability:kidnap", "destroys a BLOCKING character", () => {
  const b = abductBoard({ attacker: P1 });
  const { engine, id } = b;
  declareAttack(engine, P1, [id("atk")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("blk"), id("blk2")]);
  activate(engine, P1, id("ab"), "kidnap", { selected: { c: [id("blk")] } });
  assert.equal(engine.state.cards[id("ab")].zone, "discard");
  assert.equal(engine.state.cards[id("blk")].zone, "discard", "the picked blocker is destroyed");
  assert.equal(engine.state.cards[id("blk2")].zone, "play", "the other blocker is untouched");
  assert.ok(!engine.state.battle?.blockingParty.includes(id("blk")), "it left the blocking party");
});

clause(ABDUCTRESS, "0:ability:kidnap", "the picked character may be MY OWN attacking character (any attacking or blocking character)", () => {
  const b = abductBoard({ attacker: P1, extra: [] });
  const { engine, id } = b;
  declareAttack(engine, P1, [id("atk"), id("atk2")]);
  activate(engine, P1, id("ab"), "kidnap", { selected: { c: [id("atk2")] } });
  assert.equal(engine.state.cards[id("atk2")].zone, "discard");
  assert.equal(engine.state.cards[id("ab")].zone, "discard");
});

clause(ABDUCTRESS, "0:ability:kidnap", "usable by the defender, in response to the attack, before blockers are declared", () => {
  const b = abductBoard();
  const { engine, id } = b;
  opponentAttacks(b, ["atk"]);
  activate(engine, P1, id("ab"), "kidnap", { selected: { c: [id("atk")] } });
  assert.equal(engine.state.cards[id("atk")].zone, "discard");
});

clause(ABDUCTRESS, "0:ability:kidnap", "only an ATTACKING or BLOCKING character: a character in play that is in no battle, and an item, are refused", () => {
  const b = abductBoard({ attacker: P1 });
  const { engine, id } = b;
  declareAttack(engine, P1, [id("atk")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("blk")]);
  for (const key of ["home", "atk2", "blk2", "thing"]) {
    refused(() => activateRaw(engine, P1, id("ab"), "kidnap", { c: [id(key)] }), `${key} is not an attacking or blocking character`);
  }
  assert.equal(engine.state.cards[id("ab")].zone, "play", "refused: the Abductress was not destroyed either");
  assert.equal(engine.state.cards[id("home")].zone, "play");
  activateRaw(engine, P1, id("ab"), "kidnap", { c: [id("blk")] });
  assert.ok(engine.state.responseWindow, "a blocking character is accepted");
});

clause(ABDUCTRESS, "0:ability:kidnap", "a faction cannot be picked (it is not a character)", () => {
  const b = abductBoard();
  const { engine, id } = b;
  opponentAttacks(b, ["atk"]);
  refused(() => activateRaw(engine, P1, id("ab"), "kidnap", { c: [engine.state.players[P2].factionId!] }), "the attacked/attacking faction");
  refused(() => activateRaw(engine, P1, id("ab"), "kidnap", { c: [engine.state.players[P1].factionId!] }), "my own faction");
});

clause(ABDUCTRESS, "0:ability:kidnap", "needs a pick: with none the ability is refused and the Abductress survives", () => {
  const b = abductBoard();
  const { engine, id } = b;
  opponentAttacks(b, ["atk"]);
  refused(() => activateRaw(engine, P1, id("ab"), "kidnap", { c: [] }), "no pick");
  refused(() => activateRaw(engine, P1, id("ab"), "kidnap", { c: [id("atk"), id("atk")] }), "one pick only");
  assert.equal(engine.state.cards[id("ab")].zone, "play");
});

clause(ABDUCTRESS, "0:ability:kidnap", "not usable when nobody is attacking or blocking (no battle)", () => {
  const b = abductBoard({ attacker: P1 });
  const { engine, id } = b;
  refused(() => activateRaw(engine, P1, id("ab"), "kidnap", { c: [id("atk")] }), "no battle on my turn");
  assert.equal(engine.state.cards[id("ab")].zone, "play");
  assert.equal(engine.state.cards[id("atk")].zone, "play");
});

clause(ABDUCTRESS, "0:ability:kidnap", "the cost is destroying THIS card first: the Abductress cannot pick itself even while it is a blocker in the battle", () => {
  const b = abductBoard();
  const { engine, id } = b;
  opponentAttacks(b, ["atk"]);
  // Let the opponent's attack go through and block with the Abductress.
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("ab")]);
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  assert.ok(engine.state.battle?.blockingParty.includes(id("ab")), "the Abductress is blocking");
  // Costs are paid in printed order: "Destroy this card" first, so it is no longer a blocking character to pick.
  refused(() => activateRaw(engine, P1, id("ab"), "kidnap", { c: [id("ab")] }), "she is already destroyed when the pick is made");
  assert.equal(engine.state.cards[id("ab")].zone, "play", "nothing was paid");
});

clause(ABDUCTRESS, "0:ability:kidnap", "usable only from play: the Abductress in my hand cannot Kidnap", () => {
  const b = abductBoard({ extra: [{ key: "abHand", def: printing(ABDUCTRESS), owner: P1, zone: "hand" }] });
  const { engine, id } = b;
  opponentAttacks(b, ["atk"]);
  refused(() => activateRaw(engine, P1, id("abHand"), "kidnap", { c: [id("atk")] }), "from hand");
  assert.equal(engine.state.cards[id("atk")].zone, "play");
});

clause(ABDUCTRESS, "0:ability:kidnap", "the opponent cannot use my Abductress", () => {
  const b = abductBoard({ attacker: P1 });
  const { engine, id } = b;
  declareAttack(engine, P1, [id("atk")]);
  engine.perform({ type: "passPriority", playerId: P1 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent has priority now");
  refused(() => activateRaw(engine, P2, id("ab"), "kidnap", { c: [id("atk")] }), "not their card");
  assert.equal(engine.state.cards[id("atk")].zone, "play");
});

clause(ABDUCTRESS, "0:ability:kidnap", "destroying the only attacker ends the battle (an attack cannot go on with 0 characters)", () => {
  const b = abductBoard();
  const { engine, id } = b;
  opponentAttacks(b, ["atk"]);
  activate(engine, P1, id("ab"), "kidnap", { selected: { c: [id("atk")] } });
  assert.equal(engine.state.cards[id("atk")].zone, "discard");
  assert.deepEqual(engine.state.battle?.attackingParty ?? [], []);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ABDUCTRESS, "0:ability:kidnap", "pays exactly the Abductress's printed cost of 5, needs [D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(ABDUCTRESS, res), 5, 2);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Incriminating Photograph ----------------------------------------------
// When this card enters play, name a non-resource card. -- The named card cannot
// be played. Item, rogue, cost 3, threshold [D].

const PHOTOGRAPH = "e2e4ccac-ad74-483f-ae30-520a67cada44";

/** What a host app passes as `cardCatalog`: the real cards' names and types (data/cards.json), plus the board's own made-up cards. */
function photoBoard(opts: { deception?: number; extra?: CardPlacement[] } = {}) {
  const game = buildGameForPhoto(opts);
  game.engine.setCardCatalog([
    ...CATALOG.map((c) => ({ name: c.name, cardType: c.type })),
    ...Object.values(game.engine.definitions).map((d) => ({ name: d.name, cardType: d.type }))
  ]);
  return game;
}

function buildGameForPhoto(opts: { deception?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "me", def: printing(PHOTOGRAPH), owner: P1, zone: "hand" },
      { key: "banned", def: character({ name: "Banned Beast", cost: 0 }), owner: P1, zone: "hand" },
      { key: "fine", def: character({ name: "Fine Fellow", cost: 0 }), owner: P1, zone: "hand" },
      { key: "oppBanned", def: character({ name: "Banned Beast", cost: 0 }), owner: P2, zone: "hand" },
      { key: "oppFine", def: character({ name: "Fine Fellow", cost: 0 }), owner: P2, zone: "hand" },
      ...bank("deception", opts.deception ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const nameCard = (b: ReturnType<typeof photoBoard>, value: string, player: Player = P1) => {
  b.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "nameValue", value } } as never);
  resolvePendingResponses(b.engine);
};

/** Plays the Photograph and names `value`. */
function photoNames(b: ReturnType<typeof photoBoard>, value: string, key = "me", player: Player = P1) {
  play(b.engine, player, b.id(key));
  assert.equal(pendingOf(b.engine)?.kind, "nameValue");
  nameCard(b, value, player);
  assert.equal(b.engine.state.pendingChoice, undefined);
}

clause(PHOTOGRAPH, "0:rule", "when it enters play its controller is asked to name a card", () => {
  const b = photoBoard();
  play(b.engine, P1, b.id("me"));
  const pc = b.engine.state.pendingChoice as unknown as { kind: string; playerId: string; valueKind: string } | undefined;
  assert.equal(b.engine.state.cards[b.id("me")].zone, "play");
  assert.equal(pc?.kind, "nameValue");
  assert.equal(pc?.playerId, P1, "the controller names the card");
  assert.equal(pc?.valueKind, "cardName", "a card is named (not a trade or an icon)");
});

clause(PHOTOGRAPH, "0:rule", "the naming happens when it enters play, not while it is still being played", () => {
  const b = photoBoard();
  playRaw(b.engine, P1, b.id("me"));
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is named while the opponent can still respond");
  resolvePendingResponses(b.engine);
  assert.equal(pendingOf(b.engine)?.kind, "nameValue");
});

clause(PHOTOGRAPH, "0:rule", "if the opponent controls it, THEY name the card", () => {
  const b = photoBoard({ extra: [{ key: "oppPhoto", def: printing(PHOTOGRAPH), owner: P2, zone: "hand" }, ...bank("deception", 3, P2)] });
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  b.engine.state.turn = 2;
  play(b.engine, P2, b.id("oppPhoto"));
  const pc = b.engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.equal(pc?.kind, "nameValue");
  assert.equal(pc?.playerId, P2);
});

clause(PHOTOGRAPH, "0:rule", "only the Photograph itself entering play asks for a name: another card entering play (mine or the opponent's) asks nothing and changes nothing", () => {
  const b = photoBoard();
  photoNames(b, "Banned Beast");
  playRaw(b.engine, P1, b.id("fine"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("fine")].zone, "play");
  assert.equal(pendingOf(b.engine), undefined, "no second naming");
  refused(() => playRaw(b.engine, P1, b.id("banned")), "the first name still stands");
});

clause(PHOTOGRAPH, "0:rule", "it names a NON-RESOURCE card: naming a resource card (Obsession, Rage, Greed, Deception, Elitism) is refused", () => {
  const b = photoBoard();
  play(b.engine, P1, b.id("me"));
  assert.equal(pendingOf(b.engine)?.kind, "nameValue");
  for (const value of ["Obsession", "Rage", "Greed", "Deception", "Elitism"]) {
    refused(() => nameCard(b, value), `${value} is a resource card`);
  }
  assert.equal(pendingOf(b.engine)?.kind, "nameValue", "still waiting for a legal name");
  nameCard(b, "Banned Beast");
  assert.equal(pendingOf(b.engine), undefined);
});

clause(PHOTOGRAPH, "0:rule", "it names a non-resource CARD: a name that is not any card's name is refused", () => {
  const b = photoBoard();
  play(b.engine, P1, b.id("me"));
  refused(() => nameCard(b, "Card That Does Not Exist"), "not a card");
  refused(() => nameCard(b, "xyzzy"), "not a card");
  assert.equal(pendingOf(b.engine)?.kind, "nameValue", "still waiting for a legal name");
});

clause(PHOTOGRAPH, "0:rule", "it names a real non-resource card: a character, an item, a location, a tactic and a real printed card are all accepted", () => {
  for (const value of ["Banned Beast", "Arcanist's Almanac", "Catastrophic Betrayal", "Hangdog Alley"]) {
    const b = photoBoard();
    play(b.engine, P1, b.id("me"));
    nameCard(b, value);
    assert.equal(b.engine.state.pendingChoice, undefined, `${value} is accepted`);
  }
});

clause(PHOTOGRAPH, "1:rule", "the named card cannot be played by me: refused for the named character, while another card is fine", () => {
  const b = photoBoard();
  const { engine, id } = b;
  playRaw(engine, P1, id("banned"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("banned")].zone, "play", "control: before the Photograph it can be played");

  const b2 = photoBoard();
  photoNames(b2, "Banned Beast");
  refused(() => playRaw(b2.engine, P1, b2.id("banned")), "the named card");
  assert.equal(b2.engine.state.cards[b2.id("banned")].zone, "hand");
  playRaw(b2.engine, P1, b2.id("fine"));
  resolvePendingResponses(b2.engine);
  assert.equal(b2.engine.state.cards[b2.id("fine")].zone, "play", "a differently named card is unaffected");
});

clause(PHOTOGRAPH, "1:rule", "the named card cannot be played by the OPPONENT either", () => {
  const b = photoBoard();
  photoNames(b, "Banned Beast");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  refused(() => playRaw(b.engine, P2, b.id("oppBanned")), "the opponent's copy of the named card");
  assert.equal(b.engine.state.cards[b.id("oppBanned")].zone, "hand");
  playRaw(b.engine, P2, b.id("oppFine"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("oppFine")].zone, "play", "their other card is fine");
});

clause(PHOTOGRAPH, "1:rule", "it is the card NAME that is banned: a second, different copy of the same name is banned too, and a name that merely resembles it is not", () => {
  const b = photoBoard({
    extra: [
      { key: "banned2", def: character({ name: "Banned Beast", cost: 0, strength: 5 }), owner: P1, zone: "hand" },
      { key: "similar", def: character({ name: "Banned Beasts", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  photoNames(b, "Banned Beast");
  refused(() => playRaw(b.engine, P1, b.id("banned")), "first copy");
  refused(() => playRaw(b.engine, P1, b.id("banned2")), "a copy with a different definition but the same name");
  playRaw(b.engine, P1, b.id("similar"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("similar")].zone, "play");
});

clause(PHOTOGRAPH, "1:rule", "any non-resource card can be named and banned: an item, a location and a tactic are refused too", () => {
  const types: [string, CardDefinition][] = [
    ["item", item({ name: "Banned Gadget", cost: 0 })],
    ["location", location({ name: "Banned Hall", cost: 0 })],
    ["tactic", tactic({ name: "Banned Trick", cost: 0 })]
  ];
  for (const [kind, def] of types) {
    const b = photoBoard({ extra: [{ key: "target", def, owner: P1, zone: "hand" }] });
    playRaw(b.engine, P1, b.id("target"));
    resolvePendingResponses(b.engine);
    assert.notEqual(b.engine.state.cards[b.id("target")].zone, "hand", `control: the ${kind} can be played before it is named`);

    const named = photoBoard({ extra: [{ key: "target", def, owner: P1, zone: "hand" }] });
    photoNames(named, def.name);
    refused(() => playRaw(named.engine, P1, named.id("target")), `the named ${kind}`);
    assert.equal(named.engine.state.cards[named.id("target")].zone, "hand");
  }
});

clause(PHOTOGRAPH, "1:rule", "'cannot be PLAYED': the named card can still be put into play by an effect", () => {
  const summon = tactic({
    name: "Summon",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const b = photoBoard({ extra: [{ key: "summon", def: summon, owner: P1, zone: "hand" }] });
  photoNames(b, "Banned Beast");
  refused(() => playRaw(b.engine, P1, b.id("banned")), "cannot be played");
  play(b.engine, P1, b.id("summon"), { selected: { t: [b.id("banned")] } });
  assert.equal(b.engine.state.cards[b.id("banned")].zone, "play", "but an effect may put it into play");
  assert.equal(b.engine.state.cards[b.id("banned")].controllerId, P1);
});

clause(PHOTOGRAPH, "1:rule", "the ban lasts only while the Photograph is in play: destroyed, the named card can be played again", () => {
  const smash = tactic({
    name: "SmashItem",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = photoBoard({ extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }] });
  photoNames(b, "Banned Beast");
  refused(() => playRaw(b.engine, P1, b.id("banned")), "banned while it is in play");
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("me")] } });
  assert.equal(b.engine.state.cards[b.id("me")].zone, "discard");
  playRaw(b.engine, P1, b.id("banned"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("banned")].zone, "play", "no longer banned");
});

clause(PHOTOGRAPH, "1:rule", "it only bans the card that was named: a second Photograph names a second card, and both are banned", () => {
  const b = photoBoard({
    deception: 8,
    extra: [
      { key: "me2", def: printing(PHOTOGRAPH), owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Other Ogre", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  photoNames(b, "Banned Beast");
  photoNames(b, "Other Ogre", "me2");
  refused(() => playRaw(b.engine, P1, b.id("banned")), "the first named card");
  refused(() => playRaw(b.engine, P1, b.id("other")), "the second named card");
  playRaw(b.engine, P1, b.id("fine"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("fine")].zone, "play");
});

clause(PHOTOGRAPH, "1:rule", "the opponent's Photograph bans cards for me as well", () => {
  const b = photoBoard({ extra: [{ key: "oppPhoto", def: printing(PHOTOGRAPH), owner: P2, zone: "play" }] });
  b.engine.state.cards[b.id("oppPhoto")].namedValues = { banned: "Banned Beast" };
  refused(() => playRaw(b.engine, P1, b.id("banned")), "my copy of the card the opponent's Photograph named");
  playRaw(b.engine, P1, b.id("fine"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("fine")].zone, "play");
});

clause(PHOTOGRAPH, "1:rule", "FLIP UP is playing the card: a named card face-down in play cannot be flipped up", () => {
  const flippy = character({ name: "Banned Beast", cost: 0, strength: 1, life: 1, speed: 1, flipUp: { cost: 0, threshold: 0 } });
  const b = photoBoard({ extra: [{ key: "fd", def: flippy, owner: P1, zone: "play", faceDown: true }] });
  photoNames(b, "Banned Beast");
  refused(() => flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("fd"), selected: {}, variables: {} }), "flipping up the named card");
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true, "it stays face-down");
});

clause(PHOTOGRAPH, "1:rule", "control for the FLIP UP test: the same face-down card flips up fine when it is not named", () => {
  const flippy = character({ name: "Banned Beast", cost: 0, strength: 1, life: 1, speed: 1, flipUp: { cost: 0, threshold: 0 } });
  const b = photoBoard({ extra: [{ key: "fd", def: flippy, owner: P1, zone: "play", faceDown: true }] });
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("fd"), selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, false);
});

clause(PHOTOGRAPH, "1:rule", "pays exactly its printed cost of 3, needs [D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => photoBoard(res) as never, 3, 1);
  drain(exact.engine, (pc) => (pc.kind === "nameValue" ? { kind: "nameValue", value: "Banned Beast" } : declineAll(pc)));
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Jackmove --------------------------------------------------------------
// COST: Pick a value for X. Pay twice X. -- EFFECT: Reveal the top X cards of
// your opponent's deck. Put all revealed characters and items into play under
// your control, and the remaining cards into your opponent's discard pile.
// Tactic, rogue, cost 0, threshold [D][D][D][D][D].

const JACKMOVE = "63358d71-4e67-40e8-811c-6d1d8ce36f3f";

/** The opponent's deck, top first: character, tactic, item, location, resource, character, item, tactic. */
const jackDeck = (): CardPlacement[] => [
  { key: "c1", def: character({ name: "JackChar1", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "deck" },
  { key: "t1", def: tactic({ name: "JackTactic1" }), owner: P2, zone: "deck" },
  { key: "i1", def: item({ name: "JackItem1" }), owner: P2, zone: "deck" },
  { key: "l1", def: location({ name: "JackPlace", structure: 3 }), owner: P2, zone: "deck" },
  { key: "r1", def: resourceCard({ name: "JackRage" }), owner: P2, zone: "deck" },
  { key: "c2", def: character({ name: "JackChar2" }), owner: P2, zone: "deck" },
  { key: "i2", def: item({ name: "JackItem2" }), owner: P2, zone: "deck" },
  { key: "t2", def: tactic({ name: "JackTactic2" }), owner: P2, zone: "deck" }
];

function jackBoard(opts: { deception?: number; greed?: number; deck?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return handBoard(JACKMOVE, {
    deception: opts.deception ?? 12,
    greed: opts.greed,
    extra: [...(opts.deck ?? jackDeck()), ...deckCards(P1, 3, "pk"), { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" }, ...(opts.extra ?? [])]
  });
}

const jackPlay = (b: ReturnType<typeof jackBoard>, x: number) => {
  play(b.engine, P1, b.id("me"), { variables: { x } });
  drain(b.engine, declineAll);
};

/** Which of the 8 deck cards are in play under my control (c/i), in the opponent's discard pile, or still in their deck. */
const jackWhere = (b: ReturnType<typeof jackBoard>) => {
  const out: Record<string, string> = {};
  for (const key of ["c1", "t1", "i1", "l1", "r1", "c2", "i2", "t2"]) {
    const card = b.engine.state.cards[b.id(key)];
    out[key] = card.zone === "play" ? `play:${card.controllerId}` : card.zone;
  }
  return out;
};

const jackExpected = (x: number): Record<string, string> => {
  const types: Record<string, "keep" | "toss"> = { c1: "keep", t1: "toss", i1: "keep", l1: "toss", r1: "toss", c2: "keep", i2: "keep", t2: "toss" };
  const order = ["c1", "t1", "i1", "l1", "r1", "c2", "i2", "t2"];
  const out: Record<string, string> = {};
  order.forEach((key, i) => {
    out[key] = i >= x ? "deck" : types[key] === "keep" ? `play:${P1}` : "discard";
  });
  return out;
};

for (const x of [0, 1, 2, 3, 4, 5, 8]) {
  clause(JACKMOVE, "0:ability", `X=${x}: pays ${2 * x} (twice X), reveals the top ${x} of the opponent's deck, characters and items enter play under my control and the rest go to their discard pile`, () => {
    const b = jackBoard({ deception: 2 * x + 5 });
    const { engine, id } = b;
    const before = ready(engine);
    jackPlay(b, x);
    assert.equal(before - ready(engine), 2 * x, `twice X = ${2 * x} is paid`);
    assert.deepEqual(jackWhere(b), jackExpected(x));
    assert.equal(engine.state.cards[id("me")].zone, "discard", "the tactic ends in my discard pile");
  });
}

clause(JACKMOVE, "0:ability", "exactly the top X cards are REVEALED, to everyone", () => {
  const b = jackBoard();
  const { engine, id } = b;
  jackPlay(b, 3);
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string; ownerId: string };
  assert.deepEqual([...ev.cardIds].sort(), ["c1", "t1", "i1"].map(id).sort(), "the top 3 cards of the opponent's deck");
  assert.equal(ev.viewerId, "all");
  assert.equal(ev.ownerId, P2, "from the opponent's deck");
});

clause(JACKMOVE, "0:ability", "X=0 reveals nothing and moves nothing", () => {
  const b = jackBoard();
  const before = [...b.engine.state.players[P2].deck];
  jackPlay(b, 0);
  assert.deepEqual(b.engine.state.players[P2].deck, before);
  assert.equal(b.engine.state.players[P2].discard.length, 0);
  assert.equal(b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed" && (entry.event as unknown as { cardIds: string[] }).cardIds.length > 0).length, 0);
});

clause(JACKMOVE, "0:ability", "characters and items I take keep their type and are mine: the item is an item, the character is a character", () => {
  const b = jackBoard();
  jackPlay(b, 3);
  assert.equal(b.engine.getDefinition(b.id("c1")).type, "character");
  assert.equal(b.engine.state.cards[b.id("c1")].ownerId, P2, "ownership never changes");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("c1")), "b.engine.state.players[P1].play.includes(b.id(\"c1\"))");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("i1")), "b.engine.state.players[P1].play.includes(b.id(\"i1\"))");
  assert.ok(!b.engine.state.players[P2].play.includes(b.id("c1")), "!b.engine.state.players[P2].play.includes(b.id(\"c1\"))");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("t1")), "the tactic is in THEIR discard pile");
  assert.ok(!b.engine.state.players[P1].discard.includes(b.id("t1")), "!b.engine.state.players[P1].discard.includes(b.id(\"t1\"))");
});

clause(JACKMOVE, "0:ability", "a location, a resource and a tactic are NOT put into play: all three go to the opponent's discard pile", () => {
  const b = jackBoard();
  jackPlay(b, 5);
  for (const key of ["t1", "l1", "r1"]) assert.equal(b.engine.state.cards[b.id(key)].zone, "discard", key);
});

clause(JACKMOVE, "0:ability", "only the top X: the cards below stay in the opponent's deck in order, and my own deck, their hand and their board are untouched", () => {
  const b = jackBoard({ extra: [{ key: "oppPlay", def: character({ name: "OppPlay" }), owner: P2, zone: "play" }] });
  const { engine, id } = b;
  const mine = [...engine.state.players[P1].deck];
  const theirHand = [...engine.state.players[P2].hand];
  jackPlay(b, 2);
  assert.deepEqual(engine.state.players[P2].deck, ["i1", "l1", "r1", "c2", "i2", "t2"].map(id), "the rest of the deck, in order");
  assert.deepEqual(engine.state.players[P1].deck, mine);
  assert.deepEqual(engine.state.players[P2].hand, theirHand);
  assert.equal(engine.state.cards[id("oppPlay")].controllerId, P2);
});

clause(JACKMOVE, "0:ability", "X larger than the opponent's deck: all of it is revealed and handled, no error", () => {
  const b = jackBoard({ deck: jackDeck().slice(0, 3) });
  jackPlay(b, 5);
  assert.equal(b.engine.state.players[P2].deck.length, 0);
  assert.equal(b.engine.state.cards[b.id("c1")].controllerId, P1);
  assert.equal(b.engine.state.cards[b.id("i1")].controllerId, P1);
  assert.equal(b.engine.state.cards[b.id("t1")].zone, "discard");
});

clause(JACKMOVE, "0:ability", "an entering character really enters play: its 'when this enters play' ability happens for ME", () => {
  const entrant = character({
    name: "JackEntrant",
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = jackBoard({ deck: [{ key: "c1", def: entrant, owner: P2, zone: "deck" }, ...jackDeck().slice(1)] });
  const hand = b.engine.state.players[P1].hand.length;
  jackPlay(b, 1);
  assert.equal(b.engine.state.players[P1].hand.length, hand - 1 + 1, "the tactic left my hand; the entering character drew me a card");
});

clause(JACKMOVE, "0:ability", "X is my choice and pays twice X: with 5 resources X=2 (cost 4) works, X=3 (cost 6) is refused", () => {
  const ok = jackBoard({ deception: 5 });
  play(ok.engine, P1, ok.id("me"), { variables: { x: 2 } });
  assert.equal(ok.engine.state.cards[ok.id("me")].zone, "discard");
  assert.equal(ready(ok.engine), 1, "5 - 4");

  const short = jackBoard({ deception: 5 });
  refused(() => playRaw(short.engine, P1, short.id("me"), { variables: { x: 3 } }), "twice 3 is 6, one more than I have");
  assert.equal(short.engine.state.cards[short.id("me")].zone, "hand");
  assert.equal(ready(short.engine), 5, "nothing was paid");
});

clause(JACKMOVE, "0:ability", "twice X exactly: X=3 with exactly 6 resources works, with 5 it does not (one short)", () => {
  const exact = jackBoard({ deception: 6 });
  play(exact.engine, P1, exact.id("me"), { variables: { x: 3 } });
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "discard");
  assert.equal(ready(exact.engine), 0);
  const short = jackBoard({ deception: 5 });
  refused(() => playRaw(short.engine, P1, short.id("me"), { variables: { x: 3 } }), "5 resources for twice 3");
});

clause(JACKMOVE, "0:ability", "X cannot be negative", () => {
  const b = jackBoard();
  refused(() => playRaw(b.engine, P1, b.id("me"), { variables: { x: -1 } }), "X = -1");
  assert.equal(b.engine.state.cards[b.id("me")].zone, "hand");
  assert.equal(b.engine.state.cards[b.id("c1")].zone, "deck");
});

clause(JACKMOVE, "0:ability", "X is a whole number (CR 410.2)", () => {
  const b = jackBoard();
  refused(() => playRaw(b.engine, P1, b.id("me"), { variables: { x: 1.5 } }), "X = 1.5");
  assert.equal(b.engine.state.cards[b.id("me")].zone, "hand");
});

clause(JACKMOVE, "0:ability", "needs [D][D][D][D][D]: four Deception and plenty of other resources is refused, five is enough", () => {
  const four = jackBoard({ deception: 4, greed: 10 });
  refused(() => playRaw(four.engine, P1, four.id("me"), { variables: { x: 1 } }), "only 4 [D]");
  assert.equal(four.engine.state.cards[four.id("me")].zone, "hand");
  const five = jackBoard({ deception: 5, greed: 10 });
  play(five.engine, P1, five.id("me"), { variables: { x: 1 } });
  drain(five.engine, declineAll);
  assert.equal(five.engine.state.cards[five.id("me")].zone, "discard");
});

clause(JACKMOVE, "0:ability", "its numeric cost is 0: X=0 with exactly the five [D] threshold resources pays nothing", () => {
  const b = jackBoard({ deception: 5 });
  jackPlay(b, 0);
  assert.equal(ready(b.engine), 5, "nothing was paid");
  assert.equal(b.engine.state.cards[b.id("me")].zone, "discard");
});

clause(JACKMOVE, "0:ability", "a tactic: it can be played in response to the opponent on their turn", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "me", def: printing(JACKMOVE), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" },
      ...jackDeck(),
      ...bank("deception", 5, P1),
      ...bank("greed", 2, P2)
    ]
  });
  playRaw(b.engine, P2, b.id("theirs"));
  playRaw(b.engine, P1, b.id("me"), { variables: { x: 1 } });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("c1")].controllerId, P1);
});

// --- Jumping Screamspider --------------------------------------------------
// COVERT -- SCREAM -- COST: Use this only once each turn. Pay 0. -- EFFECT: For
// the rest of this turn, this card loses COVERT and while it is in a battle, all
// characters in the opposing party lose 2 speed this turn. Character, rogue,
// beast, cost 2, threshold [D][D], 1/4/1.

const SPIDER = "f06da0b2-9539-4171-b968-38dfb9ae9523";

const covertChar = (name: string, over: Partial<CardDefinition> = {}) => character({ name, strength: 1, life: 3, speed: 2, behavior: { keywords: ["covert"] }, ...over });

interface SpiderOpts {
  turn?: number;
  active?: Player;
  extra?: CardPlacement[];
  spiderOwner?: Player;
}

function spiderBoard(opts: SpiderOpts = {}) {
  const owner = opts.spiderOwner ?? P1;
  const other = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? owner,
    cards: [
      { key: "sp", def: printing(SPIDER), owner, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 3 }), owner, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 5 }), owner: other, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 3, speed: 4 }), owner: other, zone: "play" },
      { key: "cov", def: covertChar("CovertFoe", { speed: 4 }), owner: other, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 3, speed: 4 }), owner: other, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

const scream = (b: ReturnType<typeof spiderBoard>, player: Player = P1) => activate(b.engine, player, b.id("sp"), "scream");

// -- 0:kw:COVERT -----------------------------------------------------------------

clause(SPIDER, "0:kw:COVERT", "has COVERT", () => {
  const { engine, id } = spiderBoard();
  assert.ok(engine.getKeywords(id("sp")).includes("covert"), "engine.getKeywords(id(\"sp\")).includes(\"covert\")");
});

clause(SPIDER, "0:kw:COVERT", "a party made only of the Screamspider is covert: a non-covert character cannot block it", () => {
  const { engine, id } = spiderBoard();
  declareAttack(engine, P1, [id("sp")]);
  resolvePendingResponses(engine);
  refused(() => declareBlockers(engine, P2, [id("foe")]), "a plain character blocking a covert party");
  refused(() => declareBlockers(engine, P2, [id("foe"), id("foe2")]), "two plain characters");
  assert.deepEqual(engine.state.battle?.blockingParty ?? [], []);
});

clause(SPIDER, "0:kw:COVERT", "a covert character CAN block it", () => {
  const { engine, id } = spiderBoard();
  declareAttack(engine, P1, [id("sp")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("cov")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("cov")]);
});

clause(SPIDER, "0:kw:COVERT", "control: a plain attacker can be blocked by a plain character", () => {
  const { engine, id } = spiderBoard();
  declareAttack(engine, P1, [id("ally")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("foe")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("foe")]);
});

clause(SPIDER, "0:kw:COVERT", "a party is covert only if EVERY member is: the Screamspider with a plain ally can be blocked by a plain character", () => {
  const { engine, id } = spiderBoard();
  declareAttack(engine, P1, [id("sp"), id("ally")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("foe")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("foe")]);
});

clause(SPIDER, "0:kw:COVERT", "a covert character may block only a covert party: the Screamspider cannot block a plain attacker", () => {
  const { engine, id } = spiderBoard({ spiderOwner: P1, active: P2 });
  declareAttack(engine, P2, [id("foe")]);
  resolvePendingResponses(engine);
  refused(() => declareBlockers(engine, P1, [id("sp")]), "covert blocking a non-covert party");
  declareBlockers(engine, P1, [id("ally")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("ally")], "the plain ally blocks fine");
});

clause(SPIDER, "0:kw:COVERT", "the Screamspider can block a covert attacker", () => {
  const { engine, id } = spiderBoard({ spiderOwner: P1, active: P2 });
  declareAttack(engine, P2, [id("cov")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("sp")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("sp")]);
});

// -- 1:ability:scream ------------------------------------------------------------

clause(SPIDER, "1:ability:scream", "SCREAM makes the Screamspider lose COVERT, and the keyword is truly gone", () => {
  const b = spiderBoard();
  assert.ok(b.engine.getKeywords(b.id("sp")).includes("covert"), "b.engine.getKeywords(b.id(\"sp\")).includes(\"covert\")");
  scream(b);
  assert.equal(b.engine.getKeywords(b.id("sp")).includes("covert"), false);
});

clause(SPIDER, "1:ability:scream", "used before blockers are declared, a plain character can now block the Screamspider alone", () => {
  const { engine, id } = spiderBoard();
  declareAttack(engine, P1, [id("sp")]);
  activate(engine, P1, id("sp"), "scream");
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("foe")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("foe")], "no longer a covert party");
});

clause(SPIDER, "1:ability:scream", "only the Screamspider loses COVERT: another covert character of mine keeps it", () => {
  const b = spiderBoard({ extra: [{ key: "mycov", def: covertChar("MyCovert"), owner: P1, zone: "play" }] });
  scream(b);
  assert.ok(b.engine.getKeywords(b.id("mycov")).includes("covert"), "b.engine.getKeywords(b.id(\"mycov\")).includes(\"covert\")");
});

clause(SPIDER, "1:ability:scream", "COVERT is back when the turn is over ('for the rest of this turn')", () => {
  const b = spiderBoard();
  scream(b);
  assert.equal(b.engine.getKeywords(b.id("sp")).includes("covert"), false);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.ok(b.engine.getKeywords(b.id("sp")).includes("covert"), "back on the opponent's turn");
  endTurn(b.engine, P2);
  assert.ok(b.engine.getKeywords(b.id("sp")).includes("covert"), "and on my next turn");
});

clause(SPIDER, "1:ability:scream", "the opposing party loses 2 speed: scream after blockers are declared, the blocker (speed 5) is at speed 3 and the Screamspider's allies are unchanged", () => {
  const { engine, id } = spiderBoard();
  declareAttack(engine, P1, [id("sp"), id("ally")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("foe"), id("foe2")]);
  activate(engine, P1, id("sp"), "scream");
  assert.equal(engine.getStat(id("foe"), "speed"), 3, "5 - 2");
  assert.equal(engine.getStat(id("foe2"), "speed"), 2, "4 - 2: ALL characters in the opposing party");
  assert.equal(engine.getStat(id("ally"), "speed"), 3, "my own party member is not in the opposing party");
  assert.equal(engine.getStat(id("sp"), "speed"), 4, "the Screamspider itself is unchanged");
  assert.equal(engine.getStat(id("idle"), "speed"), 4, "a character in no battle is not affected");
  assert.equal(engine.getStat(id("cov"), "speed"), 4);
});

clause(SPIDER, "1:ability:scream", "used BEFORE blockers: the characters that then block are in the opposing party and are slowed", () => {
  const { engine, id } = spiderBoard();
  declareAttack(engine, P1, [id("sp"), id("ally")]);
  activate(engine, P1, id("sp"), "scream");
  assert.equal(engine.getStat(id("foe"), "speed"), 5, "not in the battle yet: unchanged");
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("foe")]);
  assert.equal(engine.getStat(id("foe"), "speed"), 3, "now a blocker, so it lost 2 speed");
  assert.equal(engine.getStat(id("foe2"), "speed"), 4, "the one that did not block is untouched");
});

clause(SPIDER, "1:ability:scream", "when the Screamspider BLOCKS, the attacking party is the opposing party and loses 2 speed", () => {
  const { engine, id } = spiderBoard({ spiderOwner: P1, active: P2, extra: [{ key: "pa", def: covertChar("CovertAtk", { speed: 6 }), owner: P2, zone: "play" }] });
  declareAttack(engine, P2, [id("pa")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("sp")]);
  engine.perform({ type: "passPriority", playerId: P2 });
  activate(engine, P1, id("sp"), "scream");
  assert.equal(engine.getStat(id("pa"), "speed"), 4, "the attacker lost 2 speed");
  assert.equal(engine.getStat(id("foe"), "speed"), 5, "an opposing character that is not attacking is unaffected");
});

clause(SPIDER, "1:ability:scream", "'while it is in a battle': used with no battle going on, nobody loses speed", () => {
  const b = spiderBoard();
  scream(b);
  for (const key of ["foe", "foe2", "idle", "cov", "ally"]) {
    assert.equal(b.engine.getStat(b.id(key), "speed"), key === "foe" ? 5 : key === "ally" ? 3 : 4, `${key} is unaffected`);
  }
});

clause(SPIDER, "1:ability:scream", "the speed loss starts once it IS in a battle later the same turn (it lasts 'this turn')", () => {
  const b = spiderBoard();
  const { engine, id } = b;
  scream(b);
  assert.equal(engine.getStat(id("foe"), "speed"), 5);
  declareAttack(engine, P1, [id("sp")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("foe")]);
  assert.equal(engine.getStat(id("foe"), "speed"), 3, "the blocker is slowed in the battle the Screamspider is in");
});

clause(SPIDER, "1:ability:scream", "the speed loss lasts only while it is in the battle: once the battle is over the speeds are back", () => {
  const { engine, id } = spiderBoard();
  declareAttack(engine, P1, [id("sp")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("cov")]);
  activate(engine, P1, id("sp"), "scream");
  assert.equal(engine.getStat(id("cov"), "speed"), 2);
  autoResolveBattle(engine);
  assert.equal(engine.state.battle, undefined, "the battle is over");
  assert.equal(engine.getStat(id("cov"), "speed"), 4, "back to its printed speed");
});

clause(SPIDER, "1:ability:scream", "the speed loss is gone next turn", () => {
  const { engine, id } = spiderBoard();
  declareAttack(engine, P1, [id("sp")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("cov")]);
  activate(engine, P1, id("sp"), "scream");
  assert.equal(engine.getStat(id("cov"), "speed"), 2);
  autoResolveBattle(engine);
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("cov"), "speed"), 4, "gone as soon as the turn ends");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.getStat(id("cov"), "speed"), 4);
  assert.ok(engine.getKeywords(id("sp")).includes("covert"), "and COVERT is back");
});

clause(SPIDER, "1:ability:scream", "a speed that would drop below 0 stays at 0 (a speed-1 blocker loses 2 speed)", () => {
  const { engine, id } = spiderBoard({ extra: [{ key: "slow", def: covertChar("Slow", { speed: 1 }), owner: P2, zone: "play" }] });
  declareAttack(engine, P1, [id("sp")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("slow")]);
  activate(engine, P1, id("sp"), "scream");
  assert.equal(engine.getStat(id("slow"), "speed"), 0);
});

clause(SPIDER, "1:ability:scream", "the speed loss changes who strikes first: a speed-5 blocker kills the 1-life Screamspider before it can strike, but after SCREAM (speed 3 < 4) the Screamspider kills it first", () => {
  const duel = (screams: boolean) => {
    // Without SCREAM the Screamspider is covert, so the control blocker must be covert too; the stats are identical.
    const foeDef = screams ? character({ name: "DuelFoe", strength: 1, life: 1, speed: 5 }) : covertChar("DuelFoe", { strength: 1, life: 1, speed: 5 });
    const { engine, id } = spiderBoard({ extra: [{ key: "duel", def: foeDef, owner: P2, zone: "play" }] });
    declareAttack(engine, P1, [id("sp")]);
    if (screams) activate(engine, P1, id("sp"), "scream");
    resolvePendingResponses(engine);
    declareBlockers(engine, P2, [id("duel")]);
    autoResolveBattle(engine);
    return { sp: engine.state.cards[id("sp")], foe: engine.state.cards[id("duel")] };
  };
  const control = duel(false);
  assert.equal(control.sp.zone, "discard", "control: the speed-5 blocker strikes first and kills the 1-life Screamspider");
  assert.equal(control.foe.zone, "play", "control: the Screamspider never strikes");
  const screamed = duel(true);
  assert.equal(screamed.foe.zone, "discard", "with SCREAM the blocker is at speed 3, the Screamspider (4) strikes first and kills it");
  assert.equal(screamed.sp.zone, "play", "so the Screamspider survives");
  assert.equal(screamed.sp.damage, 0);
});

clause(SPIDER, "1:ability:scream", "a blocker pushed below speed 0 strikes in the speed-0 group with the other speed-0 characters, not after them", () => {
  const run = () => {
    const { engine, id } = spiderBoard({
      extra: [
        { key: "z", def: character({ name: "Z", strength: 1, life: 1, speed: 0 }), owner: P1, zone: "play" },
        { key: "slow", def: character({ name: "SlowBlocker", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" }
      ]
    });
    declareAttack(engine, P1, [id("sp"), id("z")]);
    activate(engine, P1, id("sp"), "scream");
    resolvePendingResponses(engine);
    declareBlockers(engine, P2, [id("slow")]);
    autoResolveBattle(engine, (source) => {
      if (!source.legalTargets.length || source.strength <= 0) return [];
      // the blocker hits Z (not the Screamspider): that is what the test observes
      const atZ = source.legalTargets.find((t) => t.type === "card" && t.cardId === id("z"));
      return [{ sourceId: source.cardId, target: atZ ?? source.legalTargets[0], amount: source.strength }];
    });
    return { z: engine.state.cards[id("z")], slow: engine.state.cards[id("slow")] };
  };
  const { z, slow } = run();
  assert.equal(slow.zone, "discard", "the blocker took 1 from the Screamspider and 1 from Z");
  assert.equal(z.zone, "discard", "Z (speed 0) and the blocker (speed 1 - 2, held at 0) strike together, so the blocker still hits Z");
});

clause(SPIDER, "1:ability:scream", "once each turn: a second SCREAM in the same turn is refused", () => {
  const b = spiderBoard();
  scream(b);
  refused(() => activateRaw(b.engine, P1, b.id("sp"), "scream"), "second use this turn");
});

clause(SPIDER, "1:ability:scream", "once each turn: after a turn has passed it can be used again", () => {
  const b = spiderBoard();
  scream(b);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.ok(b.engine.getKeywords(b.id("sp")).includes("covert"), "b.engine.getKeywords(b.id(\"sp\")).includes(\"covert\")");
  scream(b);
  assert.equal(b.engine.getKeywords(b.id("sp")).includes("covert"), false);
});

clause(SPIDER, "1:ability:scream", "'each turn' includes the opponent's turn: used on my turn and again on theirs", () => {
  const b = spiderBoard({ extra: [{ key: "pa", def: covertChar("CovertAtk", { speed: 6 }), owner: P2, zone: "play" }] });
  scream(b);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  declareAttack(b.engine, P2, [b.id("pa")]);
  b.engine.perform({ type: "passPriority", playerId: P2 });
  activate(b.engine, P1, b.id("sp"), "scream");
  assert.equal(b.engine.getKeywords(b.id("sp")).includes("covert"), false);
});

clause(SPIDER, "1:ability:scream", "pay 0: usable with no resources at all and nothing is paid", () => {
  const b = spiderBoard({ extra: [...bank("deception", 3, P1)] });
  const before = ready(b.engine);
  scream(b);
  assert.equal(ready(b.engine), before, "no resources attached");
  const empty = spiderBoard();
  assert.equal(ready(empty.engine), 0);
  scream(empty);
  assert.equal(empty.engine.getKeywords(empty.id("sp")).includes("covert"), false, "works with 0 resources");
});

clause(SPIDER, "1:ability:scream", "only its controller may use it", () => {
  const b = spiderBoard();
  declareAttack(b.engine, P1, [b.id("sp")]);
  b.engine.perform({ type: "passPriority", playerId: P1 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  refused(() => activateRaw(b.engine, P2, b.id("sp"), "scream"), "the opponent using my Screamspider");
  assert.ok(b.engine.getKeywords(b.id("sp")).includes("covert"), "b.engine.getKeywords(b.id(\"sp\")).includes(\"covert\")");
});

clause(SPIDER, "1:ability:scream", "pays exactly the Screamspider's printed cost of 2, needs [D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(SPIDER, res), 2, 2);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Master Scavenger ------------------------------------------------------
// RECLAIM -- COST: Remove 3 cards in your opponent's discard pile from the game.
// -- EFFECT: This card gains 1 strength and 1 life this turn. Character, rogue,
// outcast, cost 2, threshold [D][D][D], 1/3/1.

const SCAVENGER = "93b8631a-c2f2-4c9b-8c22-c5d12672a329";

interface ScavOpts {
  oppDiscard?: number;
  extra?: CardPlacement[];
  turn?: number;
  active?: Player;
}

/** The opponent's discard pile holds `oppDiscard` (default 5) cards `g0...`: characters, an item and a tactic mixed. */
function scavBoard(opts: ScavOpts = {}) {
  const n = opts.oppDiscard ?? 5;
  const defs: CardDefinition[] = [character({ name: "G0" }), tactic({ name: "G1" }), item({ name: "G2" }), character({ name: "G3" }), location({ name: "G4" }), character({ name: "G5" }), tactic({ name: "G6" })];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ms", def: printing(SCAVENGER), owner: P1, zone: "play" },
      { key: "friend", def: character({ name: "Friend", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...Array.from({ length: n }, (_, i) => ({ key: `g${i}`, def: defs[i % defs.length], owner: P2, zone: "discard" as const })),
      { key: "mine1", def: character({ name: "Mine1" }), owner: P1, zone: "discard" },
      { key: "mine2", def: character({ name: "Mine2" }), owner: P1, zone: "discard" },
      { key: "mine3", def: character({ name: "Mine3" }), owner: P1, zone: "discard" },
      { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" },
      { key: "od", def: character({ name: "OD" }), owner: P2, zone: "deck" },
      ...(opts.extra ?? [])
    ]
  });
}

const reclaim = (b: ReturnType<typeof scavBoard>, keys: string[]) => activate(b.engine, P1, b.id("ms"), "reclaim", { selected: { cs: keys.map(b.id) } });
const reclaimRaw = (b: ReturnType<typeof scavBoard>, keys: string[]) => activateRaw(b.engine, P1, b.id("ms"), "reclaim", { cs: keys.map(b.id) });

clause(SCAVENGER, "0:ability:reclaim", "removes exactly the 3 chosen cards of the opponent's discard pile from the game, and leaves the rest of the pile", () => {
  const b = scavBoard();
  const { engine, id } = b;
  reclaim(b, ["g0", "g2", "g4"]);
  for (const key of ["g0", "g2", "g4"]) {
    assert.equal(engine.state.cards[id(key)].zone, "removed", `${key} is out of the game`);
    assert.ok(!engine.state.players[P2].discard.includes(id(key)), `${key} left the discard pile`);
  }
  assert.deepEqual([...engine.state.players[P2].discard].sort(), [id("g1"), id("g3")].sort(), "the other discarded cards stay");
});

clause(SCAVENGER, "0:ability:reclaim", "this card gains exactly 1 strength and 1 life (not speed)", () => {
  const b = scavBoard();
  const printed = printing(SCAVENGER);
  assert.equal(b.engine.getStat(b.id("ms"), "strength"), printed.strength);
  reclaim(b, ["g0", "g1", "g2"]);
  assert.equal(b.engine.getStat(b.id("ms"), "strength"), printed.strength! + 1);
  assert.equal(b.engine.getStat(b.id("ms"), "life"), printed.life! + 1);
  assert.equal(b.engine.getStat(b.id("ms"), "speed"), printed.speed);
});

clause(SCAVENGER, "0:ability:reclaim", "only this card gains the stats: my other character and the opponent's are unchanged", () => {
  const b = scavBoard();
  reclaim(b, ["g0", "g1", "g2"]);
  assert.equal(b.engine.getStat(b.id("friend"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("friend"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
});

clause(SCAVENGER, "0:ability:reclaim", "'this turn': the bonus is gone when the turn ends", () => {
  const b = scavBoard();
  reclaim(b, ["g0", "g1", "g2"]);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("ms"), "strength"), printing(SCAVENGER).strength);
  assert.equal(b.engine.getStat(b.id("ms"), "life"), printing(SCAVENGER).life);
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("ms"), "strength"), printing(SCAVENGER).strength);
});

clause(SCAVENGER, "0:ability:reclaim", "it can be used again: a second RECLAIM in the same turn (3 more cards) gives +2/+2 in total", () => {
  const b = scavBoard({ oppDiscard: 6 });
  reclaim(b, ["g0", "g1", "g2"]);
  reclaim(b, ["g3", "g4", "g5"]);
  assert.equal(b.engine.getStat(b.id("ms"), "strength"), printing(SCAVENGER).strength! + 2);
  assert.equal(b.engine.getStat(b.id("ms"), "life"), printing(SCAVENGER).life! + 2);
  for (const key of ["g0", "g1", "g2", "g3", "g4", "g5"]) assert.equal(b.engine.state.cards[b.id(key)].zone, "removed");
});

clause(SCAVENGER, "0:ability:reclaim", "needs exactly 3 cards: 2 or 4 chosen cards are refused, and nothing is removed", () => {
  const b = scavBoard();
  refused(() => reclaimRaw(b, ["g0", "g1"]), "two cards");
  refused(() => reclaimRaw(b, ["g0", "g1", "g2", "g3"]), "four cards");
  refused(() => reclaimRaw(b, []), "no cards");
  refused(() => reclaimRaw(b, ["g0", "g0", "g1"]), "the same card twice");
  for (const key of ["g0", "g1", "g2", "g3"]) assert.equal(b.engine.state.cards[b.id(key)].zone, "discard", key);
  assert.equal(b.engine.getStat(b.id("ms"), "strength"), printing(SCAVENGER).strength);
});

clause(SCAVENGER, "0:ability:reclaim", "cannot be used when the opponent's discard pile has fewer than 3 cards, even with cards in MY discard pile", () => {
  const b = scavBoard({ oppDiscard: 2 });
  refused(() => reclaimRaw(b, ["g0", "g1"]), "only two cards");
  refused(() => reclaimRaw(b, ["g0", "g1", "mine1"]), "two of theirs and one of mine");
  assert.equal(b.engine.state.cards[b.id("g0")].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("mine1")].zone, "discard");
});

clause(SCAVENGER, "0:ability:reclaim", "exactly 3 cards in their discard pile is enough", () => {
  const b = scavBoard({ oppDiscard: 3 });
  reclaim(b, ["g0", "g1", "g2"]);
  assert.equal(b.engine.state.players[P2].discard.length, 0);
  assert.equal(b.engine.getStat(b.id("ms"), "life"), printing(SCAVENGER).life! + 1);
});

clause(SCAVENGER, "0:ability:reclaim", "the cards must be in the OPPONENT'S discard pile: my discard pile, their hand, their deck and their board are refused", () => {
  const b = scavBoard();
  for (const key of ["mine1", "oh", "od", "foe", "friend"]) {
    refused(() => reclaimRaw(b, ["g0", "g1", key]), `${key} is not in the opponent's discard pile`);
  }
  assert.equal(b.engine.state.cards[b.id("mine1")].zone, "discard", "my own discard pile is untouched");
  assert.equal(b.engine.state.cards[b.id("g0")].zone, "discard");
});

clause(SCAVENGER, "0:ability:reclaim", "any kind of card in their discard pile can be removed: a tactic, an item, a location and characters alike", () => {
  const b = scavBoard({ oppDiscard: 5 });
  reclaim(b, ["g1", "g2", "g4"]);
  assert.equal(b.engine.state.cards[b.id("g1")].zone, "removed", "a tactic");
  assert.equal(b.engine.state.cards[b.id("g2")].zone, "removed", "an item");
  assert.equal(b.engine.state.cards[b.id("g4")].zone, "removed", "a location");
  const chars = scavBoard({ oppDiscard: 6 });
  reclaim(chars, ["g0", "g3", "g5"]);
  for (const key of ["g0", "g3", "g5"]) assert.equal(chars.engine.state.cards[chars.id(key)].zone, "removed", `character ${key}`);
});

clause(SCAVENGER, "0:ability:reclaim", "removed cards are gone for good: out of the discard pile and not in play", () => {
  const b = scavBoard();
  reclaim(b, ["g0", "g1", "g2"]);
  for (const key of ["g0", "g1", "g2"]) {
    assert.notEqual(b.engine.state.cards[b.id(key)].zone, "discard");
    assert.notEqual(b.engine.state.cards[b.id(key)].zone, "play");
  }
});

clause(SCAVENGER, "0:ability:reclaim", "costs no resources: usable with none, and nothing is paid", () => {
  const b = scavBoard({ extra: bank("deception", 3, P1) });
  const before = ready(b.engine);
  reclaim(b, ["g0", "g1", "g2"]);
  assert.equal(ready(b.engine), before);
  const none = scavBoard();
  assert.equal(ready(none.engine), 0);
  reclaim(none, ["g0", "g1", "g2"]);
  assert.equal(none.engine.getStat(none.id("ms"), "strength"), printing(SCAVENGER).strength! + 1);
});

clause(SCAVENGER, "0:ability:reclaim", "has no tap/deplete cost: usable while depleted", () => {
  const b = scavBoard({ extra: [] });
  b.engine.state.cards[b.id("ms")].depleted = true;
  reclaim(b, ["g0", "g1", "g2"]);
  assert.equal(b.engine.getStat(b.id("ms"), "life"), printing(SCAVENGER).life! + 1);
  assert.equal(b.engine.state.cards[b.id("ms")].depleted, true, "and it does not restore itself");
});

clause(SCAVENGER, "0:ability:reclaim", "the bonus is real in battle: a 1-strength attacker kills the 1-life Scavenger, but not after RECLAIM (life 2)", () => {
  const block = (reclaimFirst: boolean) => {
    const b = scavBoard({ turn: 2, active: P2 });
    declareAttack(b.engine, P2, [b.id("foe")]);
    resolvePendingResponses(b.engine);
    declareBlockers(b.engine, P1, [b.id("ms")]);
    if (reclaimFirst) {
      b.engine.perform({ type: "passPriority", playerId: P2 });
      reclaim(b, ["g0", "g1", "g2"]);
    }
    autoResolveBattle(b.engine);
    return b;
  };
  const plain = block(false);
  assert.equal(plain.engine.state.cards[plain.id("ms")].zone, "discard", "1 damage kills the 1-life Scavenger");
  const boosted = block(true);
  assert.equal(boosted.engine.state.cards[boosted.id("ms")].zone, "play", "after RECLAIM it has 2 life");
  assert.equal(boosted.engine.state.cards[boosted.id("ms")].damage, 1);
  assert.equal(boosted.engine.state.cards[boosted.id("foe")].damage, 2, "and it hits for 2");
});

clause(SCAVENGER, "0:ability:reclaim", "only its controller may use it", () => {
  const b = scavBoard({ turn: 2, active: P2 });
  refused(() => activateRaw(b.engine, P2, b.id("ms"), "reclaim", { cs: ["g0", "g1", "g2"].map(b.id) }), "the opponent using my Scavenger");
  assert.equal(b.engine.state.cards[b.id("g0")].zone, "discard");
});

clause(SCAVENGER, "0:ability:reclaim", "pays exactly the Scavenger's printed cost of 2, needs [D][D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(SCAVENGER, res), 2, 3);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Pillaging Pirate ------------------------------------------------------
// When this card enters play, put the top 2 cards of your opponent's deck into
// their discard pile. Character, rogue, pirate, cost 2, threshold [D][D], 2/4/1.

const PIRATE = "ca14cfec-3ab4-4da6-af9b-2966b31b6716";

const pirateBoard = (opts: HandOpts & { oppDeck?: number; myDeck?: number } = {}) =>
  handBoard(PIRATE, {
    ...opts,
    extra: [...deckCards(P2, opts.oppDeck ?? 6, "o"), ...deckCards(P1, opts.myDeck ?? 4, "m"), { key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" }, ...(opts.extra ?? [])]
  });

clause(PIRATE, "0:rule", "mills exactly the top 2 cards of the opponent's deck into THEIR discard pile; the rest of their deck stays in order", () => {
  const { engine, id } = pirateBoard();
  const oppDeck = [...engine.state.players[P2].deck];
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.deepEqual([...engine.state.players[P2].discard].sort(), oppDeck.slice(0, 2).sort());
  for (const cardId of oppDeck.slice(0, 2)) assert.equal(engine.state.cards[cardId].zone, "discard");
  assert.deepEqual(engine.state.players[P2].deck, oppDeck.slice(2));
  assert.equal(engine.state.cards[oppDeck[2]].zone, "deck", "the third card is not milled");
});

clause(PIRATE, "0:rule", "my own deck, my discard pile and the opponent's hand are untouched", () => {
  const { engine, id } = pirateBoard();
  const mine = [...engine.state.players[P1].deck];
  const theirHand = [...engine.state.players[P2].hand];
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.deepEqual(engine.state.players[P1].deck, mine);
  assert.deepEqual(engine.state.players[P1].discard, []);
  assert.deepEqual(engine.state.players[P2].hand, theirHand);
});

clause(PIRATE, "0:rule", "no coin is flipped and no choice is offered (the 2 is fixed)", () => {
  const { engine, id } = pirateBoard();
  play(engine, P1, id("me"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(coinFlips(engine).length, 0);
  assert.equal(engine.state.players[P2].discard.length, 2);
});

clause(PIRATE, "0:rule", "an opponent deck with only 1 card: it is milled, no error", () => {
  const { engine, id } = pirateBoard({ oppDeck: 1 });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(engine.state.players[P2].deck.length, 0);
  assert.equal(engine.state.players[P2].discard.length, 1);
  assert.equal(engine.state.cards[id("me")].zone, "play");
});

clause(PIRATE, "0:rule", "an opponent deck with exactly 2 cards is emptied", () => {
  const { engine, id } = pirateBoard({ oppDeck: 2 });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(engine.state.players[P2].deck.length, 0);
  assert.equal(engine.state.players[P2].discard.length, 2);
});

clause(PIRATE, "0:rule", "an empty opponent deck: nothing happens (and nobody loses)", () => {
  const { engine, id } = pirateBoard({ oppDeck: 0 });
  play(engine, P1, id("me"));
  drain(engine, declineAll);
  assert.equal(engine.state.players[P2].discard.length, 0);
  assert.equal(engine.state.result, undefined);
  assert.equal(engine.state.cards[id("me")].zone, "play");
});

clause(PIRATE, "0:rule", "it triggers when the Pirate enters play, not while it is being played", () => {
  const { engine, id } = pirateBoard();
  playRaw(engine, P1, id("me"));
  assert.equal(engine.state.players[P2].discard.length, 0, "still being deployed: nothing milled yet");
  resolvePendingResponses(engine);
  assert.equal(engine.state.players[P2].discard.length, 2);
});

clause(PIRATE, "0:rule", "another card entering play does not mill", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pp", def: printing(PIRATE), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "hand" },
      ...deckCards(P2, 5, "o"),
      ...bank("deception", 2, P1)
    ]
  });
  play(engine, P1, id("other"));
  assert.equal(engine.state.cards[id("other")].zone, "play");
  assert.equal(engine.state.players[P2].discard.length, 0);
});

clause(PIRATE, "0:rule", "a second Pirate entering play mills 2 more (each Pirate's own entering)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "p1", def: printing(PIRATE), owner: P1, zone: "hand" },
      { key: "p2", def: printing(PIRATE), owner: P1, zone: "hand" },
      ...deckCards(P2, 8, "o"),
      ...bank("deception", 4, P1)
    ]
  });
  play(engine, P1, id("p1"));
  assert.equal(engine.state.players[P2].discard.length, 2);
  play(engine, P1, id("p2"));
  assert.equal(engine.state.players[P2].discard.length, 4, "2 + 2: only the entering Pirate triggers");
});

clause(PIRATE, "0:rule", "pays exactly its printed cost of 2, needs [D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => pirateBoard(res), 2, 2);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Pluck -----------------------------------------------------------------
// UNIQUE PLUCK -- GRIFT -- COST: Use this only during your turn. Pay 5, deplete
// this card, pick a non-tactic card in your opponent's discard pile. -- EFFECT:
// Put the card into play under your control. Character, rogue, pluck/grifter,
// cost 2, threshold [D][D], 1/3/2.

const PLUCK = "428fa533-f143-4d22-8069-13695bfc6763";

interface PluckOpts {
  deception?: number;
  turn?: number;
  active?: Player;
  extra?: CardPlacement[];
}

function pluckBoard(opts: PluckOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "pl", def: printing(PLUCK), owner: P1, zone: "play" },
      { key: "corpse", def: character({ name: "Corpse", strength: 3, life: 3, speed: 2 }), owner: P2, zone: "discard" },
      { key: "oItem", def: item({ name: "OppItem" }), owner: P2, zone: "discard" },
      { key: "oPlace", def: location({ name: "OppPlace", structure: 3 }), owner: P2, zone: "discard" },
      { key: "oRes", def: resourceCard({ name: "OppRage" }), owner: P2, zone: "discard" },
      { key: "oTactic", def: tactic({ name: "OppTactic" }), owner: P2, zone: "discard" },
      { key: "mine", def: character({ name: "MyCorpse" }), owner: P1, zone: "discard" },
      { key: "oHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      { key: "oDeck", def: character({ name: "OppDeck" }), owner: P2, zone: "deck" },
      { key: "oPlay", def: character({ name: "OppPlay" }), owner: P2, zone: "play" },
      ...bank("deception", opts.deception ?? 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const grift = (b: ReturnType<typeof pluckBoard>, key: string) => activate(b.engine, P1, b.id("pl"), "grift", { selected: { c: [b.id(key)] } });
const griftRaw = (b: ReturnType<typeof pluckBoard>, keys: string[], player: Player = P1) => activateRaw(b.engine, player, b.id("pl"), "grift", { c: keys.map(b.id) });

clause(PLUCK, "0:unique", "a second Pluck in play: the controller chooses which to keep and the other is destroyed (keep the new one)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "a", def: printing(PLUCK), owner: P1, zone: "play" },
      { key: "b", def: printing(PLUCK), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1)
    ]
  });
  play(engine, P1, id("b"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("a"), id("b")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("b") } } as never);
  assert.equal(engine.state.cards[id("b")].zone, "play");
  assert.equal(engine.state.cards[id("a")].zone, "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(PLUCK, "0:unique", "keeping the old Pluck destroys the new one", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "a", def: printing(PLUCK), owner: P1, zone: "play" },
      { key: "b", def: printing(PLUCK), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1)
    ]
  });
  play(engine, P1, id("b"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("a") } } as never);
  assert.equal(engine.state.cards[id("a")].zone, "play");
  assert.equal(engine.state.cards[id("b")].zone, "discard");
});

clause(PLUCK, "0:unique", "UNIQUE is per player: the opponent controlling their own Pluck is fine and nothing is asked", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "a", def: printing(PLUCK), owner: P1, zone: "play" },
      { key: "b", def: printing(PLUCK), owner: P2, zone: "play" },
      { key: "x", def: character({ name: "X", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("x"));
  endTurn(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("a")].zone, "play");
  assert.equal(engine.state.cards[id("b")].zone, "play");
});

clause(PLUCK, "0:unique", "a Pluck in hand is not a second copy in play: no choice is raised until it enters play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "a", def: printing(PLUCK), owner: P1, zone: "play" },
      { key: "b", def: printing(PLUCK), owner: P1, zone: "hand" },
      { key: "x", def: character({ name: "X", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("x"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("a")].zone, "play");
});

clause(PLUCK, "1:ability:grift", "GRIFT: pays 5, depletes Pluck, and puts the picked character from the opponent's discard pile into play under my control", () => {
  const b = pluckBoard();
  const { engine, id } = b;
  const before = ready(engine);
  grift(b, "corpse");
  assert.equal(before - ready(engine), 5, "5 resources are paid");
  assert.equal(engine.state.cards[id("pl")].depleted, true, "COST: deplete this card");
  const card = engine.state.cards[id("corpse")];
  assert.equal(card.zone, "play");
  assert.equal(card.controllerId, P1, "under my control");
  assert.equal(card.ownerId, P2, "ownership never changes");
  assert.ok(!engine.state.players[P2].discard.includes(id("corpse")), "it left their discard pile");
  assert.ok(engine.state.players[P1].play.includes(id("corpse")), "engine.state.players[P1].play.includes(id(\"corpse\"))");
});

clause(PLUCK, "1:ability:grift", "any NON-TACTIC card can be picked: an item, a location and a resource as well as a character", () => {
  for (const key of ["corpse", "oItem", "oPlace", "oRes"]) {
    const b = pluckBoard();
    grift(b, key);
    assert.equal(b.engine.state.cards[b.id(key)].zone, "play", key);
    assert.equal(b.engine.state.cards[b.id(key)].controllerId, P1, key);
  }
});

clause(PLUCK, "1:ability:grift", "a TACTIC in their discard pile cannot be picked, and nothing is paid", () => {
  const b = pluckBoard();
  refused(() => griftRaw(b, ["oTactic"]), "a tactic");
  assert.equal(b.engine.state.cards[b.id("oTactic")].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("pl")].depleted, false);
  assert.equal(ready(b.engine), 8);
});

clause(PLUCK, "1:ability:grift", "the card must be in the OPPONENT'S discard pile: my own discard pile, their hand, deck and board are refused", () => {
  const b = pluckBoard();
  for (const key of ["mine", "oHand", "oDeck", "oPlay"]) {
    refused(() => griftRaw(b, [key]), `${key} is not in the opponent's discard pile`);
  }
  refused(() => activateRaw(b.engine, P1, b.id("pl"), "grift", { c: [b.engine.state.players[P2].factionId!] }), "a faction");
  assert.equal(b.engine.state.cards[b.id("pl")].depleted, false);
});

clause(PLUCK, "1:ability:grift", "exactly one card is picked: none or two are refused", () => {
  const b = pluckBoard();
  refused(() => griftRaw(b, []), "no pick");
  refused(() => griftRaw(b, ["corpse", "oItem"]), "two picks");
  assert.equal(b.engine.state.cards[b.id("corpse")].zone, "discard");
});

clause(PLUCK, "1:ability:grift", "ONLY DURING YOUR TURN: refused on the opponent's turn (in response to something they do)", () => {
  const b = pluckBoard({ turn: 2, active: P2, extra: [{ key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" }, ...bank("greed", 2, P2)] });
  playRaw(b.engine, P2, b.id("theirs"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  refused(() => griftRaw(b, ["corpse"]), "not my turn");
  assert.equal(b.engine.state.cards[b.id("corpse")].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("pl")].depleted, false);
  assert.equal(ready(b.engine, P1), 8, "nothing was paid");
});

clause(PLUCK, "1:ability:grift", "during my own turn it works (control for the opponent's-turn refusal)", () => {
  const b = pluckBoard({ turn: 3, active: P1 });
  grift(b, "corpse");
  assert.equal(b.engine.state.cards[b.id("corpse")].controllerId, P1);
});

clause(PLUCK, "1:ability:grift", "pay 5: with 4 resources it is refused and nothing is depleted, with exactly 5 it works", () => {
  const short = pluckBoard({ deception: 4 });
  refused(() => griftRaw(short, ["corpse"]), "4 resources");
  assert.equal(short.engine.state.cards[short.id("pl")].depleted, false);
  assert.equal(ready(short.engine), 4);
  const exact = pluckBoard({ deception: 5 });
  grift(exact, "corpse");
  assert.equal(ready(exact.engine), 0);
  assert.equal(exact.engine.state.cards[exact.id("corpse")].controllerId, P1);
});

clause(PLUCK, "1:ability:grift", "deplete this card: a depleted Pluck cannot Grift, and a second Grift in one turn is impossible", () => {
  const b = pluckBoard({ deception: 12 });
  b.engine.state.cards[b.id("pl")].depleted = true;
  refused(() => griftRaw(b, ["corpse"]), "already depleted");
  assert.equal(b.engine.state.cards[b.id("corpse")].zone, "discard");
  b.engine.state.cards[b.id("pl")].depleted = false;
  grift(b, "corpse");
  refused(() => griftRaw(b, ["oItem"]), "depleted by the first Grift");
  assert.equal(b.engine.state.cards[b.id("oItem")].zone, "discard");
});

clause(PLUCK, "1:ability:grift", "Pluck restores next turn and can Grift again", () => {
  const b = pluckBoard({ deception: 5 });
  grift(b, "corpse");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.cards[b.id("pl")].depleted, false, "restored by the Restore Rule");
  assert.ok(ready(b.engine) >= 5, "and my resources are detached again");
  grift(b, "oItem");
  assert.equal(b.engine.state.cards[b.id("oItem")].controllerId, P1);
});

clause(PLUCK, "1:ability:grift", "a character brought in this way really enters play: its 'when this enters play' ability happens for me", () => {
  const entrant = character({
    name: "GriftEntrant",
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = pluckBoard({ extra: [{ key: "ec", def: entrant, owner: P2, zone: "discard" }, ...deckCards(P1, 3, "pk")] });
  const hand = b.engine.state.players[P1].hand.length;
  grift(b, "ec");
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.players[P1].hand.length, hand + 1);
});

clause(PLUCK, "1:ability:grift", "with no non-tactic card in the opponent's discard pile it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pl", def: printing(PLUCK), owner: P1, zone: "play" },
      { key: "oTactic", def: tactic({ name: "OppTactic" }), owner: P2, zone: "discard" },
      ...bank("deception", 8, P1)
    ]
  });
  refused(() => activateRaw(engine, P1, id("pl"), "grift", { c: [] }), "no legal pick");
  refused(() => activateRaw(engine, P1, id("pl"), "grift", { c: [id("oTactic")] }), "a tactic");
  assert.equal(engine.state.cards[id("pl")].depleted, false);
});

clause(PLUCK, "1:ability:grift", "only its controller may use it", () => {
  const b = pluckBoard();
  refused(() => griftRaw(b, ["corpse"], P2), "the opponent using my Pluck");
  assert.equal(b.engine.state.cards[b.id("corpse")].zone, "discard");
});

clause(PLUCK, "1:ability:grift", "usable the turn Pluck comes into play (abilities are not held back by summoning)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pl", def: printing(PLUCK), owner: P1, zone: "hand" },
      { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
      ...bank("deception", 9, P1)
    ]
  });
  play(b.engine, P1, b.id("pl"));
  assert.equal(b.engine.state.cards[b.id("pl")].zone, "play");
  activate(b.engine, P1, b.id("pl"), "grift", { selected: { c: [b.id("corpse")] } });
  assert.equal(b.engine.state.cards[b.id("corpse")].controllerId, P1);
});

clause(PLUCK, "1:ability:grift", "pays exactly Pluck's printed cost of 2, needs [D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(PLUCK, res), 2, 2);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Rapine ----------------------------------------------------------------
// COST: Destroy a character or item you control, pick a character. -- EFFECT:
// Take control of the picked character. Tactic, rogue, cost 5, threshold [D][D].

const RAPINE = "061701fc-b6df-4fff-9204-20e1a7bfeaa6";

interface RapineOpts {
  deception?: number;
  greed?: number;
  extra?: CardPlacement[];
}

function rapineBoard(opts: RapineOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "me", def: printing(RAPINE), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine1", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Mine2", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "mi", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "mp", def: location({ name: "MyPlace", structure: 3 }), owner: P1, zone: "play" },
      { key: "t1", def: drawer("TheirDrawer"), owner: P2, zone: "play", attackEligible: false },
      { key: "t2", def: character({ name: "Their2", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play", attackEligible: false },
      { key: "ti", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      { key: "tp", def: location({ name: "TheirPlace", structure: 3 }), owner: P2, zone: "play" },
      ...deckCards(P1, 3, "pk"),
      ...bank("deception", opts.deception ?? 7, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const rapine = (b: ReturnType<typeof rapineBoard>, sac: string, pick: string) => play(b.engine, P1, b.id("me"), { selected: { sac: [b.id(sac)], c: [b.id(pick)] } });
const rapineRaw = (b: ReturnType<typeof rapineBoard>, sac: string[], pick: string[]) => playRaw(b.engine, P1, b.id("me"), { selected: { sac: sac.map(b.id), c: pick.map(b.id) } });

clause(RAPINE, "0:ability", "destroying one of my characters takes control of the picked opponent's character, and pays 5", () => {
  const b = rapineBoard();
  const { engine, id } = b;
  const before = ready(engine);
  rapine(b, "m1", "t2");
  assert.equal(before - ready(engine), 5, "the printed cost of 5 is paid");
  assert.equal(engine.state.cards[id("m1")].zone, "discard", "COST: the character I control is destroyed");
  assert.ok(engine.state.players[P1].discard.includes(id("m1")), "into its owner's discard pile");
  const stolen = engine.state.cards[id("t2")];
  assert.equal(stolen.controllerId, P1, "EFFECT: I control the picked character");
  assert.equal(stolen.ownerId, P2, "ownership never changes");
  assert.equal(stolen.zone, "play");
  assert.ok(engine.state.players[P1].play.includes(id("t2")), "engine.state.players[P1].play.includes(id(\"t2\"))");
  assert.ok(!engine.state.players[P2].play.includes(id("t2")), "!engine.state.players[P2].play.includes(id(\"t2\"))");
  assert.equal(engine.state.cards[id("me")].zone, "discard", "the tactic goes to my discard pile");
});

clause(RAPINE, "0:ability", "an ITEM I control can be destroyed instead of a character", () => {
  const b = rapineBoard();
  rapine(b, "mi", "t2");
  assert.equal(b.engine.state.cards[b.id("mi")].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("t2")].controllerId, P1);
  assert.equal(b.engine.state.cards[b.id("m1")].zone, "play", "my characters are untouched");
});

clause(RAPINE, "0:ability", "only the one card I pick is destroyed and only the one picked character is taken", () => {
  const b = rapineBoard();
  rapine(b, "m1", "t2");
  assert.equal(b.engine.state.cards[b.id("m2")].zone, "play");
  assert.equal(b.engine.state.cards[b.id("mi")].zone, "play");
  assert.equal(b.engine.state.cards[b.id("t1")].controllerId, P2, "their other character is theirs");
  assert.equal(b.engine.state.cards[b.id("ti")].controllerId, P2);
});

clause(RAPINE, "0:ability", "the card I destroy must be a character or item I CONTROL: the opponent's character or item, my location, a faction, a card in hand and nothing at all are refused", () => {
  const b = rapineBoard({ extra: [{ key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" }] });
  const { engine, id } = b;
  for (const key of ["t1", "ti", "mp", "tp", "handChar"]) {
    refused(() => rapineRaw(b, [key], ["t2"]), `${key} cannot be the card destroyed`);
  }
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [engine.state.players[P1].factionId!], c: [id("t2")] } }), "my faction");
  refused(() => rapineRaw(b, [], ["t2"]), "no card to destroy");
  refused(() => rapineRaw(b, ["m1", "m2"], ["t2"]), "two cards to destroy");
  assert.equal(engine.state.cards[id("me")].zone, "hand", "nothing was played");
  assert.equal(engine.state.cards[id("t2")].controllerId, P2);
  assert.equal(engine.state.cards[id("m1")].zone, "play");
});

clause(RAPINE, "0:ability", "a face-down card I control is just a resource, not a character or item, so it cannot be destroyed for the cost", () => {
  const b = rapineBoard({ extra: [{ key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }] });
  refused(() => rapineRaw(b, ["fd"], ["t2"]), "a face-down card");
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true);
});

clause(RAPINE, "0:ability", "the picked card must be a character: an item, a location, a faction and nothing are refused", () => {
  const b = rapineBoard();
  const { engine, id } = b;
  for (const key of ["ti", "tp", "mi", "mp"]) {
    refused(() => rapineRaw(b, ["m1"], [key]), `${key} is not a character`);
  }
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("m1")], c: [engine.state.players[P2].factionId!] } }), "a faction");
  refused(() => rapineRaw(b, ["m1"], []), "no pick");
  refused(() => rapineRaw(b, ["m1"], ["t1", "t2"]), "two picks");
  assert.equal(engine.state.cards[id("m1")].zone, "play");
  assert.equal(engine.state.cards[id("me")].zone, "hand");
});

clause(RAPINE, "0:ability", "the picked character may also be any other character in play (one of mine: control simply stays with me)", () => {
  const b = rapineBoard();
  rapine(b, "m1", "m2");
  assert.equal(b.engine.state.cards[b.id("m1")].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("m2")].controllerId, P1);
  assert.equal(b.engine.state.cards[b.id("m2")].zone, "play");
});

clause(RAPINE, "0:ability", "the destroy cost comes first: the card destroyed cannot also be the character picked afterwards", () => {
  const b = rapineBoard();
  refused(() => rapineRaw(b, ["m1"], ["m1"]), "the destroyed card is gone, so it cannot be picked");
  assert.equal(b.engine.state.cards[b.id("m1")].zone, "play", "nothing was paid");
  assert.equal(b.engine.state.cards[b.id("me")].zone, "hand");
});

clause(RAPINE, "0:ability", "control is permanent: still mine after the turn passes and comes round again", () => {
  const b = rapineBoard();
  rapine(b, "m1", "t2");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.cards[b.id("t2")].controllerId, P1);
  assert.equal(b.engine.state.cards[b.id("t2")].zone, "play");
});

clause(RAPINE, "0:ability", "I can use the stolen character's abilities, and the opponent no longer can", () => {
  const b = rapineBoard();
  rapine(b, "m1", "t1");
  const hand = b.engine.state.players[P1].hand.length;
  activate(b.engine, P1, b.id("t1"), "draw1");
  assert.equal(b.engine.state.players[P1].hand.length, hand + 1);
  endTurn(b.engine, P1);
  refused(() => activateRaw(b.engine, P2, b.id("t1"), "draw1"), "the old controller");
});

clause(RAPINE, "0:ability", "a stolen character that is destroyed goes to its OWNER's discard pile", () => {
  const smash = tactic({
    name: "SmashChar",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const withSmash = rapineBoard({ extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }] });
  rapine(withSmash, "m1", "t2");
  play(withSmash.engine, P1, withSmash.id("smash"), { selected: { t: [withSmash.id("t2")] } });
  assert.ok(withSmash.engine.state.players[P2].discard.includes(withSmash.id("t2")), "owner's discard pile");
  assert.ok(!withSmash.engine.state.players[P1].discard.includes(withSmash.id("t2")), "!withSmash.engine.state.players[P1].discard.includes(withSmash.id(\"t2\"))");
});

clause(RAPINE, "0:ability", "a character taken mid-battle leaves that battle (a control change takes a character out of a battle)", () => {
  const b = rapineBoard({ extra: [] });
  const { engine, id } = b;
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  engine.state.cards[id("t1")].attackEligibleTurn = engine.state.turn;
  engine.state.cards[id("t2")].attackEligibleTurn = engine.state.turn;
  declareAttack(engine, P2, [id("t2"), id("t1")]);
  engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  rapine(b, "m1", "t2");
  assert.deepEqual(engine.state.battle?.attackingParty, [id("t1")], "the stolen attacker left the attacking party");
});

clause(RAPINE, "0:ability", "a character taken this turn cannot attack this turn (it has not been under my control since the turn began)", () => {
  const b = rapineBoard();
  rapine(b, "m1", "t2");
  refused(() => declareAttack(b.engine, P1, [b.id("t2")]), "attacking with the stolen character");
  assert.equal(b.engine.state.battle, undefined);
});

clause(RAPINE, "0:ability", "a stolen character can attack on my next turn", () => {
  const b = rapineBoard();
  rapine(b, "m1", "t2");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  declareAttack(b.engine, P1, [b.id("t2")]);
  assert.deepEqual(b.engine.state.battle?.attackingParty, [b.id("t2")]);
});

clause(RAPINE, "0:ability", "cannot be played when I control no character or item to destroy", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "me", def: printing(RAPINE), owner: P1, zone: "hand" },
      { key: "mp", def: location({ name: "MyPlace" }), owner: P1, zone: "play" },
      { key: "t2", def: character({ name: "Their2" }), owner: P2, zone: "play" },
      ...bank("deception", 7, P1)
    ]
  });
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [], c: [id("t2")] } }), "nothing to destroy");
  refused(() => playRaw(engine, P1, id("me"), { selected: { sac: [id("mp")], c: [id("t2")] } }), "only a location");
});

clause(RAPINE, "0:ability", "a tactic: it can be played in response to the opponent on their turn", () => {
  const b = rapineBoard({ extra: [{ key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" }, ...bank("greed", 2, P2)] });
  b.engine.state.activePlayerId = P2;
  b.engine.state.priorityPlayerId = P2;
  playRaw(b.engine, P2, b.id("theirs"));
  playRaw(b.engine, P1, b.id("me"), { selected: { sac: [b.id("m1")], c: [b.id("t2")] } });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("t2")].controllerId, P1);
});

clause(RAPINE, "0:ability", "pays exactly its printed cost of 5, needs [D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => rapineBoard(res), 5, 2, (id) => ({ sac: [id("m1")], c: [id("t2")] }));
  assert.equal(exact.engine.state.cards[exact.id("t2")].controllerId, P1);
});

// --- Ravenous Wolf ---------------------------------------------------------
// COVERT -- You may play this card whenever you could play a tactic. If you do,
// destroy a card named "Deception" you control or destroy this card. Character,
// rogue, beast, cost 4, threshold [D][D], 2/4/2.

const WOLF = "8ccb3e92-e728-48e0-a631-c2b87c06e5f6";

interface WolfOpts {
  deception?: number;
  greed?: number;
  /** P2 is the active player and plays a card I respond to. */
  respond?: boolean;
  extra?: CardPlacement[];
}

function wolfBoard(opts: WolfOpts = {}) {
  const respond = opts.respond ?? true;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: respond ? 2 : 1,
    activePlayerId: respond ? P2 : P1,
    cards: [
      { key: "me", def: printing(WOLF), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 3, speed: 3 }), owner: P2, zone: "play" },
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("deception", 2, P2),
      ...bank("greed", 2, P2),
      ...(opts.extra ?? [])
    ]
  });
}

/** Names of the P1 resources (face-up Deception) in play, in play order. */
const deceptionIds = (b: ReturnType<typeof wolfBoard>) =>
  b.engine.state.players[P1].play.filter((cardId) => b.engine.state.cards[cardId].zone === "play" && b.engine.getDefinition(cardId).name === "Deception" && !b.engine.state.cards[cardId].faceDown);

/** The opponent plays a card; I respond with the Wolf; both resolve. Returns the open pick (if any). */
function wolfInResponse(b: ReturnType<typeof wolfBoard>) {
  playRaw(b.engine, P2, b.id("theirs"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  playRaw(b.engine, P1, b.id("me"));
  resolvePendingResponses(b.engine);
  return b.engine.state.pendingChoice as unknown as { kind: string; playerId: string; declaration: { selector: CardSelector }; context: never } | undefined;
}

clause(WOLF, "0:kw:COVERT", "has COVERT", () => {
  const { engine, id } = buildGame({ cards: [{ key: "w", def: printing(WOLF), owner: P1, zone: "play" }] });
  assert.ok(engine.getKeywords(id("w")).includes("covert"), "engine.getKeywords(id(\"w\")).includes(\"covert\")");
});

clause(WOLF, "0:kw:COVERT", "a party made only of the Wolf cannot be blocked by a non-covert character; a covert one can block it", () => {
  const make = () =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      cards: [
        { key: "w", def: printing(WOLF), owner: P1, zone: "play" },
        { key: "plain", def: character({ name: "Plain", speed: 2 }), owner: P2, zone: "play" },
        { key: "cov", def: covertChar("Covert"), owner: P2, zone: "play" }
      ]
    });
  const a = make();
  declareAttack(a.engine, P1, [a.id("w")]);
  resolvePendingResponses(a.engine);
  refused(() => declareBlockers(a.engine, P2, [a.id("plain")]), "a plain character blocking a covert party");
  const b = make();
  declareAttack(b.engine, P1, [b.id("w")]);
  resolvePendingResponses(b.engine);
  declareBlockers(b.engine, P2, [b.id("cov")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("cov")]);
});

clause(WOLF, "0:kw:COVERT", "a covert character may block only a covert party: the Wolf cannot block a plain attacker but can block a covert one", () => {
  const make = () =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "w", def: printing(WOLF), owner: P1, zone: "play" },
        { key: "plain", def: character({ name: "Plain", speed: 2 }), owner: P2, zone: "play" },
        { key: "cov", def: covertChar("Covert"), owner: P2, zone: "play" }
      ]
    });
  const a = make();
  declareAttack(a.engine, P2, [a.id("plain")]);
  resolvePendingResponses(a.engine);
  refused(() => declareBlockers(a.engine, P1, [a.id("w")]), "the covert Wolf blocking a plain party");
  const b = make();
  declareAttack(b.engine, P2, [b.id("cov")]);
  resolvePendingResponses(b.engine);
  declareBlockers(b.engine, P1, [b.id("w")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("w")]);
});

clause(WOLF, "1:rule", "it can be played as a response on the opponent's turn, like a tactic, and then it is a character in play (not discarded)", () => {
  const b = wolfBoard();
  const pc = wolfInResponse(b);
  assert.equal(b.engine.state.cards[b.id("me")].zone, "play", "the Wolf resolved into play");
  assert.equal(pc?.kind, "chooserSelectsTarget", "and its price is asked for");
  assert.equal(b.engine.getDefinition(b.id("me")).type, "character");
});

clause(WOLF, "1:rule", "a character that is NOT a tactic cannot be played at that time when it has no such permission: control with a plain character", () => {
  const b = wolfBoard({ extra: [{ key: "plain", def: character({ name: "PlainCard", cost: 0 }), owner: P1, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("theirs"));
  refused(() => playRaw(b.engine, P1, b.id("plain")), "an ordinary character in a response window");
});

clause(WOLF, "1:rule", "not playable when no tactic could be played: the opponent's turn with nothing going on", () => {
  const b = wolfBoard();
  assert.equal(b.engine.state.responseWindow, undefined);
  refused(() => playRaw(b.engine, P1, b.id("me")), "no window");
  assert.equal(b.engine.state.cards[b.id("me")].zone, "hand");
});

clause(WOLF, "1:rule", "played that way, I may destroy a Deception I control and the Wolf stays", () => {
  const b = wolfBoard();
  const decs = deceptionIds(b);
  const pc = wolfInResponse(b);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "my choice");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [decs[0]] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[decs[0]].zone, "discard", "the chosen Deception is destroyed");
  assert.equal(b.engine.state.cards[b.id("me")].zone, "play", "the Wolf survives");
  for (const cardId of decs.slice(1)) assert.equal(b.engine.state.cards[cardId].zone, "play", "the other Deception cards stay");
});

clause(WOLF, "1:rule", "played that way, if I do not destroy a Deception the Wolf itself is destroyed and the Deception stays", () => {
  const b = wolfBoard();
  const decs = deceptionIds(b);
  wolfInResponse(b);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("me")].zone, "discard", "the Wolf is destroyed");
  for (const cardId of decs) assert.equal(b.engine.state.cards[cardId].zone, "play", "no Deception was destroyed");
});

clause(WOLF, "1:rule", "exactly one Deception is destroyed, not two", () => {
  const b = wolfBoard();
  const decs = deceptionIds(b);
  wolfInResponse(b);
  refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [decs[0], decs[1]] } } as never), "two cards");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [decs[2]] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(decs.filter((cardId) => b.engine.state.cards[cardId].zone === "discard").length, 1);
});

clause(WOLF, "1:rule", "the cards that can be chosen are exactly the Deception cards I control: not Greed, not the opponent's Deception, not other cards", () => {
  const b = wolfBoard({ greed: 3, extra: [{ key: "friend", def: character({ name: "Friend" }), owner: P1, zone: "play" }] });
  const decs = deceptionIds(b);
  const pc = wolfInResponse(b)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  const offered = b.engine.targetCandidates(pc.declaration.selector, pc.context, P1).map((card) => card.id).sort();
  assert.deepEqual(offered, [...decs].sort(), "only my Deception cards");
  const theirDeception = b.engine.state.players[P2].play.find((cardId) => b.engine.getDefinition(cardId).name === "Deception")!;
  refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [theirDeception] } } as never), "the opponent's Deception");
  const greed = b.engine.state.players[P1].play.find((cardId) => b.engine.getDefinition(cardId).name === "Greed")!;
  refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [greed] } } as never), "a Greed");
  refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("friend")] } } as never), "a character");
});

clause(WOLF, "1:rule", "a face-down card has no name, so it is not 'a card named Deception' even if it really is one", () => {
  const b = wolfBoard({ extra: [{ key: "fd", def: resourceCard({ id: "wolf-fd-deception", name: "Deception", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "play", faceDown: true }] });
  const pc = wolfInResponse(b)!;
  const offered = b.engine.targetCandidates(pc.declaration.selector, pc.context, P1).map((card) => card.id);
  assert.ok(!offered.includes(b.id("fd")), "the face-down card is not offered");
});

clause(WOLF, "1:rule", "with no card named Deception under my control, played that way the Wolf is simply destroyed", () => {
  // Four non-staple resources that provide the Deception icon (so the Wolf's [D][D] is met) but are not named "Deception".
  const fakes = Array.from({ length: 4 }, (_, i) => ({
    key: `fake${i}`,
    def: resourceCard({ id: `wolf-fake-${i}`, name: "Duplicity", resource: { provides: ["deception"], staple: false } }),
    owner: P1,
    zone: "play" as const
  }));
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "me", def: printing(WOLF), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", cost: 1 }), owner: P2, zone: "hand" },
      ...fakes,
      ...bank("greed", 2, P2)
    ]
  });
  playRaw(engine, P2, id("theirs"));
  playRaw(engine, P1, id("me"));
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(engine.state.cards[id("me")].zone, "discard", "nothing to destroy but itself");
  for (const fake of fakes) assert.equal(engine.state.cards[id(fake.key)].zone, "play", "the other resources are untouched");
});

clause(WOLF, "1:rule", "the Deception it destroys can be one that was just spent to pay for the Wolf", () => {
  const b = wolfBoard({ deception: 4 });
  const decs = deceptionIds(b);
  wolfInResponse(b);
  assert.equal(ready(b.engine, P1), 0, "all four Deception were spent paying for the Wolf");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [decs[3]] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[decs[3]].zone, "discard");
  assert.equal(b.engine.state.cards[b.id("me")].zone, "play");
});

clause(WOLF, "1:rule", "also playable at a battle response point (the opponent attacks), and the same price applies", () => {
  const b = wolfBoard();
  declareAttack(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "passPriority", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("me"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("me")].zone, "play");
  assert.equal(b.engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the price is asked for here too");
});

clause(WOLF, "1:rule", "'If you do': deployed normally on my own turn (when a character may be played anyway) there is no price", () => {
  const b = wolfBoard({ respond: false });
  const decs = deceptionIds(b);
  play(b.engine, P1, b.id("me"));
  assert.equal(b.engine.state.cards[b.id("me")].zone, "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing to pay");
  for (const cardId of decs) assert.equal(b.engine.state.cards[cardId].zone, "play");
});

clause(WOLF, "1:rule", "pays exactly its printed cost of 4, needs [D][D], and is refused one resource short (own turn)", () => {
  const exact = deployCostChecks((res) => wolfBoard({ ...res, respond: false }), 4, 2);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

clause(WOLF, "1:rule", "the response play also pays exactly 4", () => {
  const b = wolfBoard({ deception: 5 });
  playRaw(b.engine, P2, b.id("theirs"));
  const before = ready(b.engine, P1);
  playRaw(b.engine, P1, b.id("me"));
  assert.equal(before - ready(b.engine, P1), 4);
});

// --- Recondite Hunter ------------------------------------------------------
// COVERT -- If this card attacks, it loses COVERT this turn. Character, rogue,
// hunter, cost 4, threshold [D], 2/3/3.

const HUNTER = "a245b36b-d2f0-48f2-9892-331dbb3d84b1";

function hunterBoard(opts: { active?: Player; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    cards: [
      { key: "hu", def: printing(HUNTER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mycov", def: covertChar("MyCovert", { speed: 2 }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "cov", def: covertChar("TheirCovert", { speed: 2 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(HUNTER, "0:kw:COVERT", "has COVERT while at home", () => {
  const { engine, id } = hunterBoard();
  assert.ok(engine.getKeywords(id("hu")).includes("covert"), "engine.getKeywords(id(\"hu\")).includes(\"covert\")");
});

clause(HUNTER, "0:kw:COVERT", "a covert character may block only a covert party: the Hunter cannot block a plain attacker", () => {
  const { engine, id } = hunterBoard({ active: P2 });
  declareAttack(engine, P2, [id("plain")]);
  resolvePendingResponses(engine);
  refused(() => declareBlockers(engine, P1, [id("hu")]), "the covert Hunter blocking a plain party");
  declareBlockers(engine, P1, [id("ally")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("ally")], "a plain blocker is fine");
});

clause(HUNTER, "0:kw:COVERT", "the Hunter can block a covert attacker, and keeps COVERT while blocking", () => {
  const { engine, id } = hunterBoard({ active: P2 });
  declareAttack(engine, P2, [id("cov")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("hu")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("hu")]);
  assert.ok(engine.getKeywords(id("hu")).includes("covert"), "blocking does not remove COVERT");
});

clause(HUNTER, "1:rule", "when it attacks it loses COVERT, and a plain character can block it", () => {
  const { engine, id } = hunterBoard();
  declareAttack(engine, P1, [id("hu")]);
  assert.equal(engine.getKeywords(id("hu")).includes("covert"), false, "COVERT is lost the moment it attacks");
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("plain")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("plain")], "so a non-covert character can block it");
});

clause(HUNTER, "1:rule", "attacking with a covert ally: the Hunter loses COVERT, so the party is no longer covert and a plain character can block", () => {
  const { engine, id } = hunterBoard();
  declareAttack(engine, P1, [id("hu"), id("mycov")]);
  resolvePendingResponses(engine);
  assert.equal(engine.getKeywords(id("hu")).includes("covert"), false);
  assert.ok(engine.getKeywords(id("mycov")).includes("covert"), "only the Hunter loses COVERT");
  declareBlockers(engine, P2, [id("plain")]);
  assert.deepEqual(engine.state.battle?.blockingParty, [id("plain")]);
});

clause(HUNTER, "1:rule", "'this turn': COVERT is back after the turn", () => {
  const { engine, id } = hunterBoard();
  declareAttack(engine, P1, [id("hu")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(engine.getKeywords(id("hu")).includes("covert"), false, "still lost later in the same turn");
  endTurn(engine, P1);
  assert.ok(engine.getKeywords(id("hu")).includes("covert"), "back on the opponent\x27s turn");
  endTurn(engine, P2);
  assert.ok(engine.getKeywords(id("hu")).includes("covert"), "engine.getKeywords(id(\"hu\")).includes(\"covert\")");
});

clause(HUNTER, "1:rule", "it triggers only when THIS card attacks: other characters attacking leave the Hunter at home with COVERT", () => {
  const { engine, id } = hunterBoard();
  declareAttack(engine, P1, [id("ally")]);
  resolvePendingResponses(engine);
  assert.ok(engine.getKeywords(id("hu")).includes("covert"), "engine.getKeywords(id(\"hu\")).includes(\"covert\")");
});

clause(HUNTER, "1:rule", "the Hunter's attack does not take COVERT from other characters", () => {
  const { engine, id } = hunterBoard();
  declareAttack(engine, P1, [id("hu"), id("mycov")]);
  resolvePendingResponses(engine);
  assert.ok(engine.getKeywords(id("mycov")).includes("covert"), "engine.getKeywords(id(\"mycov\")).includes(\"covert\")");
  assert.ok(engine.getKeywords(id("cov")).includes("covert"), "engine.getKeywords(id(\"cov\")).includes(\"covert\")");
});

clause(HUNTER, "1:rule", "blocking is not attacking: the Hunter blocking a covert attacker keeps COVERT", () => {
  const { engine, id } = hunterBoard({ active: P2 });
  declareAttack(engine, P2, [id("cov")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("hu")]);
  resolvePendingResponses(engine);
  assert.ok(engine.getKeywords(id("hu")).includes("covert"), "engine.getKeywords(id(\"hu\")).includes(\"covert\")");
});

clause(HUNTER, "1:rule", "pays exactly its printed cost of 4, needs [D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(HUNTER, res), 4, 1);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

// --- Red Raven -------------------------------------------------------------
// If a coin is flipped, you may put a token on this card. -- This card gains 1
// strength and 1 life for each token on it. Character, rogue, beast, cost 3,
// threshold [D][D], 2/3/2.

const RAVEN = "8dafb23c-7d22-4580-862b-d7641f7ab338";

/** A free tactic whose effect flips a coin for its controller. */
const coinTactic = (name = "Flipper") =>
  tactic({ name, cost: 0, behavior: { abilities: [{ id: "f", type: "activated", effects: [{ type: "flipCoin", player: "controller", winEffects: [], loseEffects: [] }] }] } });

interface RavenOpts {
  random?: () => number;
  ravens?: number;
  extra?: CardPlacement[];
  turn?: number;
  active?: Player;
}

function ravenBoard(opts: RavenOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "rv", def: printing(RAVEN), owner: P1, zone: "play" },
      ...(opts.ravens && opts.ravens > 1 ? [{ key: "rv2", def: printing(RAVEN), owner: P1, zone: "play" as const }] : []),
      { key: "flip", def: coinTactic(), owner: P1, zone: "hand" },
      { key: "oflip", def: coinTactic("OppFlipper"), owner: P2, zone: "hand" },
      ...(opts.extra ?? [])
    ]
  });
}

/** Answers the Raven's "may" option choice with `index` (0 = decline, 1 = put a token). */
const answerOption = (engine: SpoilsEngine, index: number) => {
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.equal(pc?.kind, "chooserSelectsOption");
  engine.perform({ type: "resolvePendingChoice", playerId: pc!.playerId, choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(engine);
};

for (const [label, random, won] of [
  ["won", WIN, true],
  ["lost", LOSE, false]
] as const) {
  clause(RAVEN, "0:rule", `my own coin flip (${label}): I am asked, and accepting puts exactly one token on the Raven`, () => {
    const { engine, id } = ravenBoard({ random });
    play(engine, P1, id("flip"));
    assert.deepEqual(coinFlips(engine), [{ playerId: P1, won }]);
    const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.equal(pc.kind, "chooserSelectsOption");
    assert.equal(pc.playerId, P1, "the Raven\x27s controller decides");
    answerOption(engine, 1);
    assert.equal(tokens(engine, id("rv")), 1);
  });

  clause(RAVEN, "0:rule", `my own coin flip (${label}): declining puts no token`, () => {
    const { engine, id } = ravenBoard({ random });
    play(engine, P1, id("flip"));
    answerOption(engine, 0);
    assert.equal(tokens(engine, id("rv")), 0);
    assert.equal(engine.state.pendingChoice, undefined);
  });
}

clause(RAVEN, "0:rule", "'a coin' means ANY coin flip: the OPPONENT's flip gives ME the choice, and a token if I accept", () => {
  const { engine, id } = ravenBoard({ random: WIN, turn: 2, active: P2 });
  play(engine, P2, id("oflip"));
  assert.deepEqual(coinFlips(engine), [{ playerId: P2, won: true }]);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the Raven\x27s controller, not the flipper");
  answerOption(engine, 1);
  assert.equal(tokens(engine, id("rv")), 1);
});

clause(RAVEN, "0:rule", "every flip is its own chance: two flips, accept the first and decline the second, leave one token; accept both, two tokens", () => {
  const { engine, id } = ravenBoard({ random: WIN, extra: [{ key: "flip2", def: coinTactic("Flipper2"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("flip"));
  answerOption(engine, 1);
  play(engine, P1, id("flip2"));
  answerOption(engine, 1);
  assert.equal(tokens(engine, id("rv")), 2);
  const other = ravenBoard({ random: WIN, extra: [{ key: "flip2", def: coinTactic("Flipper2"), owner: P1, zone: "hand" }] });
  play(other.engine, P1, other.id("flip"));
  answerOption(other.engine, 1);
  play(other.engine, P1, other.id("flip2"));
  answerOption(other.engine, 0);
  assert.equal(tokens(other.engine, other.id("rv")), 1);
});

clause(RAVEN, "0:rule", "a coin flipped by a real card counts: Bipolar Sarcophyle's enters-play flip offers the Raven a token", () => {
  const { engine, id } = ravenBoard({ random: LOSE, extra: [{ key: "bs", def: printing(BIPOLAR), owner: P1, zone: "hand" }, ...bank("deception", 4, P1)] });
  play(engine, P1, id("bs"));
  assert.deepEqual(coinFlips(engine), [{ playerId: P1, won: false }]);
  const pc = engine.state.pendingChoice as unknown as { kind: string };
  assert.equal(pc?.kind, "chooserSelectsOption");
  answerOption(engine, 1);
  assert.equal(tokens(engine, id("rv")), 1, "a token even though the flip was lost");
  assert.equal(tokens(engine, id("bs")), 0, "the lost flip gave the Sarcophyle nothing");
});

clause(RAVEN, "0:rule", "no flip, no token: ordinary play and a whole turn cycle never offer a token", () => {
  const { engine, id } = ravenBoard();
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokens(engine, id("rv")), 0);
});

clause(RAVEN, "0:rule", "only a Raven in play reacts: one in hand gets no choice and no token", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: WIN,
    cards: [
      { key: "rv", def: printing(RAVEN), owner: P1, zone: "hand" },
      { key: "flip", def: coinTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("flip"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokens(engine, id("rv")), 0);
});

clause(RAVEN, "0:rule", "two Ravens each get their own choice for the one flip", () => {
  const { engine, id } = ravenBoard({ random: WIN, ravens: 2 });
  play(engine, P1, id("flip"));
  let answered = 0;
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") answered++;
    return pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : declineAll(pc);
  });
  assert.equal(answered, 2, "asked twice");
  assert.equal(tokens(engine, id("rv")), 1);
  assert.equal(tokens(engine, id("rv2")), 1);
});

clause(RAVEN, "0:rule", "the opponent's Raven reacts to a flip too, and the choice is theirs", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    random: WIN,
    cards: [
      { key: "rv", def: printing(RAVEN), owner: P2, zone: "play" },
      { key: "flip", def: coinTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("flip"));
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "the Raven\x27s own controller");
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 1 } } as never);
  resolvePendingResponses(engine);
  assert.equal(tokens(engine, id("rv")), 1);
});

clause(RAVEN, "1:rule", "gains 1 strength and 1 life for each token on it (0, 1, 2 and 5 tokens); speed is unchanged", () => {
  const printed = printing(RAVEN);
  for (const n of [0, 1, 2, 5]) {
    const { engine, id } = buildGame({ cards: [{ key: "rv", def: printing(RAVEN), owner: P1, zone: "play", counters: { token: n } }] });
    assert.equal(engine.getStat(id("rv"), "strength"), printed.strength! + n, `strength with ${n} tokens`);
    assert.equal(engine.getStat(id("rv"), "life"), printed.life! + n, `life with ${n} tokens`);
    assert.equal(engine.getStat(id("rv"), "speed"), printed.speed, `speed with ${n} tokens`);
  }
});

clause(RAVEN, "1:rule", "a token put on by a flip immediately raises the stats to 3/4 (and only for the Raven)", () => {
  const { engine, id } = ravenBoard({ random: WIN, extra: [{ key: "friend", def: character({ name: "Friend", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" }] });
  play(engine, P1, id("flip"));
  answerOption(engine, 1);
  assert.equal(engine.getStat(id("rv"), "strength"), printing(RAVEN).strength! + 1);
  assert.equal(engine.getStat(id("rv"), "life"), printing(RAVEN).life! + 1);
  assert.equal(engine.getStat(id("friend"), "strength"), 1);
  assert.equal(engine.getStat(id("friend"), "life"), 2);
});

clause(RAVEN, "1:rule", "the extra life counts for survival: with 1 token (life 3) it survives 2 damage and dies to 3; with none 2 damage kills it", () => {
  const blockAgainst = (strength: number, token: number) => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "rv", def: printing(RAVEN), owner: P1, zone: "play", counters: token ? { token } : {} },
        { key: "atk", def: character({ name: "Atk", strength, life: 9, speed: 5 }), owner: P2, zone: "play" }
      ]
    });
    declareAttack(engine, P2, [id("atk")]);
    resolvePendingResponses(engine);
    declareBlockers(engine, P1, [id("rv")]);
    autoResolveBattle(engine);
    return engine.state.cards[id("rv")];
  };
  assert.equal(blockAgainst(2, 0).zone, "discard", "printed life 2");
  const survivor = blockAgainst(2, 1);
  assert.equal(survivor.zone, "play");
  assert.equal(survivor.damage, 2);
  assert.equal(blockAgainst(3, 1).zone, "discard");
});

clause(RAVEN, "1:rule", "tokens go away when the card leaves play: put into hand and redeployed it is a fresh 2/3/2 with no tokens", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = ravenBoard({ extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }, ...bank("deception", 3, P1)] });
  engine.state.cards[id("rv")].counters = { token: 2 };
  play(engine, P1, id("bounce"), { selected: { t: [id("rv")] } });
  assert.equal(engine.state.cards[id("rv")].zone, "hand");
  assert.equal(tokens(engine, id("rv")), 0, "its tokens disappeared when it left play (CR 409.2)");
  play(engine, P1, id("rv"));
  assert.equal(engine.state.cards[id("rv")].zone, "play");
  assert.equal(tokens(engine, id("rv")), 0, "a fresh Raven has no tokens");
  assert.equal(engine.getStat(id("rv"), "strength"), printing(RAVEN).strength);
});

clause(RAVEN, "1:rule", "pays exactly its printed cost of 3, needs [D][D], and is refused one resource short", () => {
  const exact = deployCostChecks((res) => handBoard(RAVEN, res), 3, 2);
  assert.equal(exact.engine.state.cards[exact.id("me")].zone, "play");
});

