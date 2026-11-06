// Clause tests — batch 1st-edition-04. See docs/TESTING.md and
// `npm run card-tests -- manifest 1st-edition-04`. Expectations come from each
// card's PRINTED text (1st Edition printing) and RULES.md / the CR; engine data
// is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, exempt, printing, refused, holdResourceFace } from "./_clause.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  fight,
  playRaw
} from "./_battle.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, setupGame, spentResources, developOffers, endTurnRaw, developDrawLeft } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: Pid = P1) => engine.getAvailableResourceCount(player);
const influence = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].influence;
const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const handOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].discard;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].damage ?? 0;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => (engine.getKeywords(cardId) as string[]).includes(keyword);
const tokens = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].counters?.token ?? 0;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].controllerId;
const ownerOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].ownerId;

/** `n` plain characters for `owner` in `zone`, keyed `<prefix>0..n-1` (so deck order is top = 0). */
function fillers(prefix: string, n: number, owner: Pid, zone: "deck" | "hand" | "discard" | "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}` }), owner, zone }));
}

/** The pending choice, loosely typed. */
const pending = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as { kind: string; playerId: string; [k: string]: unknown } | undefined;

/** Answers the open `chooserSelectsTarget` choice with `selected` (and drains the response window afterwards). */
function pick(engine: SpoilsEngine, player: Pid, selected: CardInstanceId[]): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
  developDrawLeft(engine, player); // a turn start's Develop Rule is offered once the card's pick is done: skip it
}

/** Answers the open `distributeAmong` choice with `shares` (and drains the response window afterwards). */
function distribute(engine: SpoilsEngine, player: Pid, shares: Record<CardInstanceId, number>): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "distributeAmong", shares } } as never);
  resolvePendingResponses(engine);
}

/** Answers the open `uniqueSurvivor` choice. */
function keepUnique(engine: SpoilsEngine, player: Pid, keep: CardInstanceId): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "uniqueSurvivor", keep } } as never);
  resolvePendingResponses(engine);
}

/** A free tactic that destroys one picked character (id `k`, declaration `t`) — for "destroyed in response" scenarios. */
const killer = (): CardDefinition => killTactic({ name: "Killer" });

/** A free tactic that deals `amount` damage to one picked character (id `hit`, declaration `t`). */
function hitTactic(amount: number): CardDefinition {
  return tactic({
    name: `Hit${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "hit",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic that adds `amount` strength to one picked character until end of turn (id `pump`, declaration `t`). */
function pumpTactic(amount: number): CardDefinition {
  return tactic({
    name: `Pump${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pump",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

/** A free tactic that moves one picked character to its owner's hand (id `b`, declaration `t`). */
function bounceTactic(): CardDefinition {
  return tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
}

/**
 * P2's turn: P2 declares an attack on P1's faction with `attackerIds` and passes its own priority, so P1 (the
 * defender) may now respond. Returns once it is P1's turn to act in the window.
 */
function openDefenderWindow(engine: SpoilsEngine, attackerIds: CardInstanceId[], target?: { type: "faction"; playerId: Pid } | { type: "card"; cardId: CardInstanceId }): void {
  engine.perform({ type: "declareAttack", playerId: P2, attackerIds, target: target ?? { type: "faction", playerId: P1 } });
  engine.perform({ type: "passPriority", playerId: P2 });
}

/** Declares `blockerIds` (as `player`), leaving the first battle response window open. */
function declareBlockersBy(engine: SpoilsEngine, player: Pid, blockerIds: CardInstanceId[]): void {
  engine.perform({ type: "declareBlockers", playerId: player, blockerIds });
}

/**
 * After `perform`ing a response (an ability or tactic) inside an open response window: lets the opponent pass
 * and the response stack drain, so the response has RESOLVED, while leaving the window itself (e.g. a battle
 * response window) open for its next responder.
 */
function settleStack(engine: SpoilsEngine): void {
  let guard = 0;
  while (engine.state.responseStack.length > 0 && !engine.state.pendingChoice) {
    if (++guard > 100) throw new Error("settleStack did not converge");
    const window = engine.state.responseWindow;
    if (!window) break;
    if (window.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
}

/** Uses `abilityId` of `cardId` as `player` WITHOUT draining the surrounding window. */
function useAbilityRaw(engine: SpoilsEngine, player: Pid, cardId: CardInstanceId, abilityId: string, opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} });
}

/** A small deterministic random source (mulberry32): every game that can flip, shuffle or pick at random gets one, so no test depends on a fresh seed. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The events of `type` in the game log. */
function eventsOf(engine: SpoilsEngine, type: string): Array<Record<string, unknown>> {
  return engine
    .getLog()
    .map((entry) => entry.event as unknown as Record<string, unknown> | undefined)
    .filter((event): event is Record<string, unknown> => !!event && event.type === type);
}

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const ICON_FOR = { r: "rage", g: "greed", d: "deception", e: "elitism", o: "obsession" } as const;
type IconKey = keyof typeof ICON_FOR;

/**
 * A card in hand deploys for exactly its printed numeric cost and threshold: allowed with exactly that (and
 * the cost is paid, not more), refused one resource short, refused without the threshold icons even with
 * plenty of other resources. Used for the printed cost / threshold line of permanents.
 */
function deploysForPrintedCost(printingId: string, extra: CardPlacement[] = []): void {
  const def = printing(printingId);
  const threshold = String(def.threshold ?? "");
  const icon = ICON_FOR[threshold[0] as IconKey];
  const need = threshold.length;
  const cost = def.cost ?? 0;
  const otherIcon = icon === "rage" ? "greed" : "rage";
  const board = (iconCount: number, otherCount: number, spentIcons = 0) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "c", def, owner: P1, zone: "hand" },
        ...extra,
        ...bank(icon, iconCount, P1),
        ...bank(otherIcon, otherCount, P1),
        // already-spent icons count toward the threshold but cannot pay the cost
        ...bank(icon, spentIcons, P1).map((placement) => ({ ...placement, attachedToKey: "__factionA" }))
      ]
    });

  const ok = board(need, Math.max(0, cost - need));
  assert.equal(ok.engine.getCardPlayability(P1, ok.id("c")).playable, true, `playable with ${need} ${icon} and ${cost} resources in total`);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play", "deployed");
  assert.equal(before - ready(ok.engine), cost, `exactly the printed cost of ${cost} was paid`);

  if (cost > 0) {
    // threshold fully met by spent icons, so the ONLY thing missing is one ready resource for the cost
    const short = board(0, cost - 1, need);
    assert.equal(short.engine.getCardPlayability(P1, short.id("c")).playable, false, "one resource short of the cost is not playable");
    refused(() => playRaw(short.engine, P1, short.id("c")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
    assert.equal(zoneOf(short.engine, short.id("c")), "hand", "nothing was played");
  }

  const noThreshold = board(need - 1, cost + 3);
  assert.equal(noThreshold.engine.getCardPlayability(P1, noThreshold.id("c")).playable, false, `${need - 1} ${icon} is not enough for the threshold of ${need}`);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("c")), "the threshold icons are required even with plenty of other resources", /Threshold requirements are not met/);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("c")), "hand");
}

/** A character in play has exactly its printed strength / life / speed. */
function hasPrintedStats(printingId: string): void {
  const def = printing(printingId);
  const { engine, id } = buildGame({ cards: [{ key: "c", def, owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("c"), "strength"), def.strength, "printed strength");
  assert.equal(engine.getStat(id("c"), "life"), def.life, "printed life");
  assert.equal(engine.getStat(id("c"), "speed"), def.speed, "printed speed");
}

// =============================================================================
// Defenestrate
// Tactic, rogue, cost 3, threshold [D].
// "Put the top 2 cards of your opponent's deck into their discard pile. Draw a card."
// =============================================================================

const DEFENESTRATE = "df57b23c-8f1a-4743-8b7c-1b2a1ceaf52c";

function defenestrateBoard(opts: { deception?: number; greed?: number; myDeck?: number; oppDeck?: number; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "df", def: printing(DEFENESTRATE), owner: P1, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      { key: "oppOld", def: character({ name: "OppOld" }), owner: P2, zone: "discard" },
      { key: "myOld", def: character({ name: "MyOld" }), owner: P1, zone: "discard" },
      ...fillers("a", opts.myDeck ?? 5, P1, "deck"),
      ...fillers("b", opts.oppDeck ?? 5, P2, "deck"),
      ...bank("deception", opts.deception ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}

clause(DEFENESTRATE, "0:rule", "pays its cost of 3, puts exactly the top 2 cards of the opponent's deck into THEIR discard pile and ends in its owner's discard pile", () => {
  const { engine, id } = defenestrateBoard();
  const before = ready(engine);
  const oppDeckBefore = [...deckOf(engine, P2)];
  const oppDiscardBefore = [...discardOf(engine, P2)];
  play(engine, P1, id("df"));

  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.deepEqual(oppDeckBefore.slice(0, 2).map((cardId) => zoneOf(engine, cardId)), ["discard", "discard"], "the top 2 cards left the deck for the discard pile");
  assert.deepEqual(deckOf(engine, P2), oppDeckBefore.slice(2), "the rest of the opponent's deck is untouched and in order");
  assert.deepEqual([...discardOf(engine, P2)].sort(), [...oppDiscardBefore, ...oppDeckBefore.slice(0, 2)].sort(), "the opponent's discard pile gains exactly the two cards");
  assert.equal(zoneOf(engine, id("df")), "discard");
  assert.equal(discardOf(engine, P1).includes(id("df")), true, "the tactic goes to its owner's discard pile");
  assert.equal(discardOf(engine, P1).length, 2, "my discard pile gains only the tactic (the opponent's cards did not go to mine)");
});

clause(DEFENESTRATE, "0:rule", "the milled cards are the TOP two, in order — not random cards of the deck", () => {
  for (const random of [() => 0, () => 0.99]) {
    const { engine, id } = buildGame({
      random,
      playerA: { faction: developFaction() },
      cards: [
        { key: "df", def: printing(DEFENESTRATE), owner: P1, zone: "hand" },
        ...fillers("a", 3, P1, "deck"),
        ...fillers("b", 6, P2, "deck"),
        ...bank("deception", 3, P1)
      ]
    });
    play(engine, P1, id("df"));
    assert.equal(zoneOf(engine, id("b0")), "discard");
    assert.equal(zoneOf(engine, id("b1")), "discard");
    for (const key of ["b2", "b3", "b4", "b5"]) assert.equal(zoneOf(engine, id(key)), "deck", `${key} stays in the deck`);
  }
});

clause(DEFENESTRATE, "0:rule", "draws exactly one card for its controller: the top card of their own deck; the opponent draws nothing and my deck is otherwise untouched", () => {
  const { engine, id } = defenestrateBoard();
  const myHandBefore = [...handOf(engine, P1)];
  const myDeckBefore = [...deckOf(engine, P1)];
  const oppHandBefore = [...handOf(engine, P2)];
  play(engine, P1, id("df"));

  assert.deepEqual(handOf(engine, P1), [...myHandBefore.filter((cardId) => cardId !== id("df")), myDeckBefore[0]], "Defenestrate left my hand, one card (the top of my deck) arrived");
  assert.deepEqual(deckOf(engine, P1), myDeckBefore.slice(1), "only one card left my deck");
  assert.deepEqual(handOf(engine, P2), oppHandBefore, "the opponent's hand is unchanged");
  assert.equal(discardOf(engine, P1).filter((cardId) => cardId !== id("df") && cardId !== id("myOld")).length, 0, "none of MY deck's cards were milled");
});

clause(DEFENESTRATE, "0:rule", "the opponent's deck has only 1 card: that card is milled and the draw still happens", () => {
  const { engine, id } = defenestrateBoard({ oppDeck: 1 });
  const myTop = deckOf(engine, P1)[0];
  play(engine, P1, id("df"));
  assert.equal(zoneOf(engine, id("b0")), "discard");
  assert.equal(deckOf(engine, P2).length, 0);
  assert.equal(zoneOf(engine, myTop), "hand", "the draw still happens");
});

clause(DEFENESTRATE, "0:rule", "the opponent's deck is empty: nothing is milled, no loss, and the draw still happens", () => {
  const { engine, id } = defenestrateBoard({ oppDeck: 0 });
  const myTop = deckOf(engine, P1)[0];
  play(engine, P1, id("df"));
  assert.equal(deckOf(engine, P2).length, 0);
  assert.equal(engine.state.winner, undefined, "running out of cards does not lose the game");
  assert.equal(zoneOf(engine, myTop), "hand", "the draw still happens");
});

clause(DEFENESTRATE, "0:rule", "my own deck is empty: the 2 cards are still milled and no card is drawn (and the game goes on)", () => {
  const { engine, id } = defenestrateBoard({ myDeck: 0 });
  const handBefore = handOf(engine, P1).length;
  const oppTop = deckOf(engine, P2).slice(0, 2);
  play(engine, P1, id("df"));
  assert.deepEqual(oppTop.map((cardId) => zoneOf(engine, cardId)), ["discard", "discard"]);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "Defenestrate left the hand and nothing could be drawn");
  assert.equal(engine.state.winner, undefined);
});

clause(DEFENESTRATE, "0:rule", "its rules text is an effect, not a cost: nothing is milled or drawn while the opponent can still respond", () => {
  const { engine, id } = defenestrateBoard();
  const oppDeckBefore = [...deckOf(engine, P2)];
  const myDeckBefore = [...deckOf(engine, P1)];
  playRaw(engine, P1, id("df"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.deepEqual(deckOf(engine, P2), oppDeckBefore, "the opponent's deck is intact while the tactic waits");
  assert.deepEqual(deckOf(engine, P1), myDeckBefore, "I have not drawn yet");
  resolvePendingResponses(engine);
  assert.deepEqual(deckOf(engine, P2), oppDeckBefore.slice(2));
  assert.deepEqual(deckOf(engine, P1), myDeckBefore.slice(1));
});

clause(DEFENESTRATE, "0:rule", "is refused one resource short of its cost of 3, and allowed with exactly 3", () => {
  const short = defenestrateBoard({ deception: 2 });
  refused(() => playRaw(short.engine, P1, short.id("df")));
  assert.equal(zoneOf(short.engine, short.id("df")), "hand", "nothing was played");
  assert.equal(deckOf(short.engine, P2).length, 5, "nothing was milled");
  assert.equal(short.engine.getCardPlayability(P1, short.id("df")).playable, false);

  const exact = defenestrateBoard({ deception: 3 });
  assert.equal(exact.engine.getCardPlayability(P1, exact.id("df")).playable, true);
  play(exact.engine, P1, exact.id("df"));
  assert.equal(zoneOf(exact.engine, exact.id("df")), "discard");
});

clause(DEFENESTRATE, "0:rule", "is refused without [D], even with plenty of other resources, and allowed with a single [D] among them", () => {
  const noThreshold = defenestrateBoard({ deception: 0, greed: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("df")));
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("df")), "hand");

  const oneD = defenestrateBoard({ deception: 1, greed: 2 });
  play(oneD.engine, P1, oneD.id("df"));
  assert.equal(zoneOf(oneD.engine, oneD.id("df")), "discard", "one [D] satisfies the threshold of [D] (3 resources in total pay the cost)");
});

clause(DEFENESTRATE, "0:rule", "as a tactic it can be played in response on the opponent's turn: the caster still mills the OPPONENT's deck and draws", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "df", def: printing(DEFENESTRATE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...fillers("a", 4, P1, "deck"),
      ...fillers("b", 4, P2, "deck"),
      ...bank("deception", 3, P1)
    ]
  });
  refused(() => playRaw(engine, P1, id("df")), "nothing to respond to yet");
  openDefenderWindow(engine, [id("atk")]);
  const myTop = deckOf(engine, P1)[0];
  playRaw(engine, P1, id("df"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("b0")), "discard");
  assert.equal(zoneOf(engine, id("b1")), "discard");
  assert.equal(zoneOf(engine, id("b2")), "deck");
  assert.equal(zoneOf(engine, myTop), "hand", "I (the caster) drew");
});

clause(DEFENESTRATE, "0:rule", "the opponent's deck is the one milled whoever the caster is (P2 casting mills P1's deck and P2 draws)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "df", def: printing(DEFENESTRATE), owner: P2, zone: "hand" },
      ...fillers("a", 4, P1, "deck"),
      ...fillers("b", 4, P2, "deck"),
      ...bank("deception", 3, P2)
    ]
  });
  const p2Top = deckOf(engine, P2)[0];
  play(engine, P2, id("df"));
  assert.equal(zoneOf(engine, id("a0")), "discard");
  assert.equal(zoneOf(engine, id("a1")), "discard");
  assert.equal(zoneOf(engine, id("a2")), "deck");
  assert.equal(zoneOf(engine, p2Top), "hand", "P2 drew from P2's own deck");
  assert.equal(deckOf(engine, P2).length, 3, "P2's deck lost only the drawn card");
});

// =============================================================================
// Face in the Crowd
// Character, rogue, cost 6, threshold [D][D], 4/3/5 (strength / speed / life).
// "While your opponent controls at least 4 characters and this card is the only
// member of an attacking party, this card cannot be blocked."
// =============================================================================

const CROWD = "9eefa81d-6214-47bf-af77-7bb5ca92c8d4";

function crowdBoard(opts: { oppChars?: number; ally?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "fc", def: printing(CROWD), owner: P1, zone: "play" },
      ...(opts.ally ? [{ key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" as const }] : []),
      ...fillers("o", opts.oppChars ?? 4, P2, "play"),
      ...(opts.extra ?? [])
    ]
  });
}

const tryBlock = (engine: SpoilsEngine, blockerIds: CardInstanceId[]) => () => declareBlockersBy(engine, P2, blockerIds);

clause(CROWD, "0:rule", "deploys for its printed cost of 6 and [D][D], and has its printed stats", () => {
  deploysForPrintedCost(CROWD);
  hasPrintedStats(CROWD);
});

clause(CROWD, "0:rule", "with 4 opponent characters and attacking alone it cannot be blocked: no blocker (alone or in a group) may be declared; declaring no blockers is fine", () => {
  for (const group of [["o0"], ["o3"], ["o0", "o1"], ["o0", "o1", "o2", "o3"]]) {
    const { engine, id } = crowdBoard();
    declareAttackBy(engine, P1, [id("fc")]);
    refused(tryBlock(engine, group.map(id)), `blockers ${group.join("+")} are refused`);
    assert.deepEqual(battleOf(engine)?.blockingParty ?? [], [], "no blocking party was formed");
  }
  const { engine, id } = crowdBoard();
  const influenceBefore = influence(engine, P2);
  declareAttackBy(engine, P1, [id("fc")]);
  declareBlockersBy(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), influenceBefore - 4, "unblocked, its 4 strength hits the faction");
});

clause(CROWD, "0:rule", "with 5 opponent characters it is still unblockable (at least 4)", () => {
  const { engine, id } = crowdBoard({ oppChars: 5 });
  declareAttackBy(engine, P1, [id("fc")]);
  refused(tryBlock(engine, [id("o0")]), "a block against 5 characters");
  declareBlockersBy(engine, P2, []); // control: declaring no blockers is fine
  assert.deepEqual(battleOf(engine)?.blockingParty ?? [], []);
});

clause(CROWD, "0:rule", "with only 3 opponent characters it can be blocked (control for the 4-character threshold)", () => {
  const { engine, id } = crowdBoard({ oppChars: 3 });
  declareAttackBy(engine, P1, [id("fc")]);
  declareBlockersBy(engine, P2, [id("o0")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("o0")]);
});

clause(CROWD, "0:rule", "with 4 opponent characters but attacking in a party of 2 it can be blocked (it must be the ONLY member)", () => {
  const { engine, id } = crowdBoard({ ally: true });
  declareAttackBy(engine, P1, [id("fc"), id("ally")]);
  declareBlockersBy(engine, P2, [id("o0")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("o0")], "a party of two has no 'cannot be blocked'");
});

clause(CROWD, "0:rule", "its ally attacking alone (the Face in the Crowd staying home) is blockable: the card only protects itself", () => {
  const { engine, id } = crowdBoard({ ally: true });
  declareAttackBy(engine, P1, [id("ally")]);
  declareBlockersBy(engine, P2, [id("o0")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("o0")]);
});

clause(CROWD, "0:rule", "only characters count toward the 4: items, locations and face-down resources the opponent controls do not", () => {
  const { engine, id } = crowdBoard({
    oppChars: 3,
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(2, P2)
    ]
  });
  declareAttackBy(engine, P1, [id("fc")]);
  declareBlockersBy(engine, P2, [id("o0")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("o0")], "3 characters + 4 non-characters is still blockable");
});

clause(CROWD, "0:rule", "my own characters do not count: it is the OPPONENT's characters that must number 4", () => {
  const { engine, id } = crowdBoard({
    oppChars: 3,
    extra: fillers("mine", 5, P1, "play")
  });
  declareAttackBy(engine, P1, [id("fc")]);
  declareBlockersBy(engine, P2, [id("o0")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("o0")]);
});

clause(CROWD, "0:rule", "depleted opponent characters still count as characters they control (3 depleted + 1 ready = 4)", () => {
  const { engine, id } = crowdBoard({
    oppChars: 1,
    extra: ["d0", "d1", "d2"].map((key) => ({ key, def: character({ name: key }), owner: P2, zone: "play" as const, depleted: true }))
  });
  declareAttackBy(engine, P1, [id("fc")]);
  refused(tryBlock(engine, [id("o0")]), "unblockable: the three depleted characters are still controlled, so the ready one may not block");

  const three = crowdBoard({
    oppChars: 1,
    extra: ["d0", "d1"].map((key) => ({ key, def: character({ name: key }), owner: P2, zone: "play" as const, depleted: true }))
  });
  declareAttackBy(three.engine, P1, [three.id("fc")]);
  declareBlockersBy(three.engine, P2, [three.id("o0")]);
  assert.deepEqual(battleOf(three.engine)?.blockingParty, [three.id("o0")], "control: 2 depleted + 1 ready is only 3 characters");
});

clause(CROWD, "0:rule", "'controls' not 'owns': three of their own characters plus one of mine that they control make 4; one of theirs that I control does not count", () => {
  const stolenIn = crowdBoard({
    oppChars: 3,
    extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P1, controller: P2, zone: "play" }]
  });
  declareAttackBy(stolenIn.engine, P1, [stolenIn.id("fc")]);
  refused(tryBlock(stolenIn.engine, [stolenIn.id("o0")]), "3 + 1 (a character I own but they control) = 4");

  const stolenOut = crowdBoard({
    oppChars: 3,
    extra: [{ key: "taken", def: character({ name: "Taken" }), owner: P2, controller: P1, zone: "play" }]
  });
  declareAttackBy(stolenOut.engine, P1, [stolenOut.id("fc")]);
  declareBlockersBy(stolenOut.engine, P2, [stolenOut.id("o0")]);
  assert.deepEqual(battleOf(stolenOut.engine)?.blockingParty, [stolenOut.id("o0")], "a character they own but I control is not one they 'control'");
});

clause(CROWD, "0:rule", "it is a WHILE condition: if the opponent drops to 3 characters in response to the attack, it becomes blockable", () => {
  const { engine, id } = crowdBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fc")], target: { type: "faction", playerId: P2 } });
  play(engine, P1, id("kill"), { selected: { t: [id("o0")] } });
  assert.equal(zoneOf(engine, id("o0")), "discard", "one of the four was destroyed in the attacker's response window");
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P2, [id("o1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("o1")], "only 3 characters remain: blockable");
});

clause(CROWD, "0:rule", "it is a WHILE condition: a 4th opponent character arriving in response to the attack makes it unblockable", () => {
  const putIn = tactic({
    name: "PutInPlay",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "opponent" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "opponent" }]
        }
      ]
    }
  });
  const { engine, id } = crowdBoard({
    oppChars: 3,
    extra: [
      { key: "put", def: putIn, owner: P1, zone: "hand" },
      { key: "fourth", def: character({ name: "Fourth" }), owner: P2, zone: "hand" }
    ]
  });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("fc")], target: { type: "faction", playerId: P2 } });
  play(engine, P1, id("put"), { selected: { t: [id("fourth")] } });
  assert.equal(zoneOf(engine, id("fourth")), "play", "the fourth character is in play");
  resolvePendingResponses(engine);
  refused(tryBlock(engine, [id("o0")]), "4 opponent characters: now unblockable");
});

clause(CROWD, "0:rule", "it cannot be blocked whatever it attacks: a location of the opponent's too", () => {
  const { engine, id } = crowdBoard({ extra: [{ key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" }] });
  declareAttackBy(engine, P1, [id("fc")], { type: "card", cardId: id("place") });
  refused(tryBlock(engine, [id("o0")]));
  declareBlockersBy(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("place")), 4, "its 4 strength hits the location");
});

clause(CROWD, "0:rule", "the protection is its own: a different attacker alone is blockable even while Face in the Crowd is in play and the opponent has 4 characters", () => {
  const { engine, id } = crowdBoard({ ally: true });
  assert.equal(hasKeyword(engine, id("fc"), "cannotBeBlocked"), false, "outside a battle it is not unblockable");
  declareAttackBy(engine, P1, [id("ally")]);
  assert.equal(hasKeyword(engine, id("fc"), "cannotBeBlocked"), false, "not attacking: not unblockable");
  declareBlockersBy(engine, P2, [id("o0")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("o0")]);
});

clause(CROWD, "0:rule", "off again once the card is gone: after it leaves play a later lone attacker is blockable", () => {
  const { engine, id } = crowdBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("fc")] } });
  assert.equal(zoneOf(engine, id("fc")), "hand");
  assert.equal(hasKeyword(engine, id("fc"), "cannotBeBlocked"), false);
});

// =============================================================================
// Forced Recruitment
// Tactic, rogue, cost 2, threshold [D][D].
// COST: Play this only in response to a character being played. X is that
// character's numeric cost. Pay X. -- EFFECT: The character enters play under your control.
// =============================================================================

const RECRUITMENT = "f5358eec-0dbc-45f4-8ca9-1b7dd6539d51";

/** An ETB-draw character: "When this card enters play, its controller draws a card." */
function etbDrawer(cost: number): CardDefinition {
  return character({
    name: `Gifter${cost}`,
    cost,
    strength: 2,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [
        {
          id: "etb",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
}

function recruitBoard(opts: { victimCost?: number; victim?: CardDefinition; deception?: number; greed?: number; extra?: CardPlacement[]; p2Rage?: number } = {}) {
  const victim = opts.victim ?? character({ name: "Victim", cost: opts.victimCost ?? 3, strength: 2, life: 3, speed: 2 });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "fr", def: printing(RECRUITMENT), owner: P1, zone: "hand" },
      { key: "victim", def: victim, owner: P2, zone: "hand" },
      ...fillers("a", 3, P1, "deck"),
      ...fillers("b", 3, P2, "deck"),
      ...bank("rage", opts.p2Rage ?? 9, P2),
      ...bank("deception", opts.deception ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

for (const victimCost of [0, 1, 3, 5]) {
  clause(RECRUITMENT, "0:ability", `responding to a cost-${victimCost} character: pays 2 + ${victimCost}, and that character enters play under MY control (it is still the opponent's card)`, () => {
    const { engine, id } = recruitBoard({ victimCost });
    playRaw(engine, P2, id("victim"));
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the character being played");
    const mine = ready(engine, P1);
    const theirs = ready(engine, P2);
    playRaw(engine, P1, id("fr"));
    assert.equal(mine - ready(engine, P1), 2 + victimCost, `COST: the printed 2 plus X = ${victimCost}`);
    resolvePendingResponses(engine);

    assert.equal(zoneOf(engine, id("victim")), "play", "the character entered play");
    assert.equal(controllerOf(engine, id("victim")), P1, "under my control");
    assert.equal(ownerOf(engine, id("victim")), P2, "it still belongs to the opponent");
    assert.equal(engine.state.players[P1].play.includes(id("victim")), true);
    assert.equal(engine.state.players[P2].play.includes(id("victim")), false);
    assert.equal(zoneOf(engine, id("fr")), "discard", "the tactic goes to its owner's discard pile");
    assert.equal(ready(engine, P2), theirs, "the opponent's payment for the character stays paid (not refunded)");
    assert.equal(handOf(engine, P2).includes(id("victim")), false, "it did not return to their hand");
  });
}

clause(RECRUITMENT, "0:ability", "the character enters play ONCE: the opponent's own deployment does not also put it into play, and it is not in their discard pile", () => {
  const { engine, id } = recruitBoard();
  playRaw(engine, P2, id("victim"));
  playRaw(engine, P1, id("fr"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.players[P1].play.filter((cardId) => cardId === id("victim")).length, 1);
  assert.equal(discardOf(engine, P2).includes(id("victim")), false);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.responseWindow, undefined, "nothing is left on the stack");
});

clause(RECRUITMENT, "0:ability", "'enters play under your control' means its enters-play trigger is mine: I draw, the opponent does not", () => {
  const { engine, id } = recruitBoard({ victim: etbDrawer(2) });
  const mineBefore = handOf(engine, P1).length;
  const theirsBefore = handOf(engine, P2).length;
  playRaw(engine, P2, id("victim"));
  playRaw(engine, P1, id("fr"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("victim")), "play");
  assert.equal(handOf(engine, P1).length, mineBefore - 1 + 1, "Forced Recruitment left my hand, and I drew from the stolen character's trigger");
  assert.equal(handOf(engine, P2).length, theirsBefore - 1, "the opponent drew nothing (the character left their hand when it was played)");
});

clause(RECRUITMENT, "0:ability", "after their turn the stolen character is mine to attack with (it has been under my control since my turn started)", () => {
  const { engine, id } = recruitBoard({ victimCost: 1 });
  playRaw(engine, P2, id("victim"));
  playRaw(engine, P1, id("fr"));
  resolvePendingResponses(engine);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  declareAttackBy(engine, P1, [id("victim")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("victim")]);
});

clause(RECRUITMENT, "0:ability", "the opponent's remaining cards are untouched: their other hand cards and play stay put", () => {
  const { engine, id } = recruitBoard({ extra: [{ key: "oh", def: character({ name: "OppHand" }), owner: P2, zone: "hand" }, { key: "op", def: character({ name: "OppPlay" }), owner: P2, zone: "play" }] });
  playRaw(engine, P2, id("victim"));
  playRaw(engine, P1, id("fr"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("oh")), "hand");
  assert.equal(controllerOf(engine, id("op")), P2);
});

clause(RECRUITMENT, "0:ability", "is refused one resource short of 2 + X (X = 3 here), and allowed with exactly 2 + X", () => {
  const short = recruitBoard({ victimCost: 3, deception: 4 });
  playRaw(short.engine, P2, short.id("victim"));
  refused(() => playRaw(short.engine, P1, short.id("fr")), "4 resources, 2 + 3 = 5 needed");
  assert.equal(zoneOf(short.engine, short.id("fr")), "hand", "nothing was played");
  assert.equal(ready(short.engine, P1), 4, "nothing was paid");
  resolvePendingResponses(short.engine);
  assert.equal(controllerOf(short.engine, short.id("victim")), P2, "without Forced Recruitment the character enters play under its player's control");

  const exact = recruitBoard({ victimCost: 3, deception: 5 });
  playRaw(exact.engine, P2, exact.id("victim"));
  playRaw(exact.engine, P1, exact.id("fr"));
  resolvePendingResponses(exact.engine);
  assert.equal(controllerOf(exact.engine, exact.id("victim")), P1);
  assert.equal(ready(exact.engine, P1), 0);
});

clause(RECRUITMENT, "0:ability", "is refused without [D][D] even with plenty of other resources, and allowed with exactly two [D]", () => {
  const one = recruitBoard({ victimCost: 1, deception: 1, greed: 8 });
  playRaw(one.engine, P2, one.id("victim"));
  refused(() => playRaw(one.engine, P1, one.id("fr")), "only one [D]");

  const two = recruitBoard({ victimCost: 1, deception: 2, greed: 1 });
  playRaw(two.engine, P2, two.id("victim"));
  playRaw(two.engine, P1, two.id("fr"));
  resolvePendingResponses(two.engine);
  assert.equal(controllerOf(two.engine, two.id("victim")), P1);
});

clause(RECRUITMENT, "0:ability", "can only be played in response to a CHARACTER being played: not to a tactic, an item or a location", () => {
  const drawTactic = tactic({
    name: "TheirTactic",
    cost: 1,
    behavior: { abilities: [{ id: "draw", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  for (const [label, def] of [
    ["tactic", drawTactic],
    ["item", item({ name: "TheirItem", cost: 1 })],
    ["location", location({ name: "TheirPlace", cost: 1 })]
  ] as const) {
    const { engine, id } = recruitBoard({ victim: def });
    playRaw(engine, P2, id("victim"));
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, `I may respond to the ${label}`);
    refused(() => playRaw(engine, P1, id("fr")), `refused in response to a ${label}`);
    assert.equal(zoneOf(engine, id("fr")), "hand", "nothing was played");
    assert.equal(ready(engine, P1), 8, "nothing was paid");
  }
  // control: the same board with a character is accepted
  const { engine, id } = recruitBoard({ victimCost: 1 });
  playRaw(engine, P2, id("victim"));
  playRaw(engine, P1, id("fr"));
  assert.equal(zoneOf(engine, id("fr")), "deploying");
});

clause(RECRUITMENT, "0:ability", "cannot be played in response to an ability being used", () => {
  const abilityChar = character({
    name: "Abilitous",
    behavior: { abilities: [{ id: "poke", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = recruitBoard({ extra: [{ key: "ab", def: abilityChar, owner: P2, zone: "play" }] });
  engine.perform({ type: "activateAbility", playerId: P2, cardId: id("ab"), abilityId: "poke", selected: {}, variables: {} });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to their ability");
  refused(() => playRaw(engine, P1, id("fr")), "an ability is not a character being played: the card's own condition is unmet", /cannot be deployed right now/);
});

clause(RECRUITMENT, "0:ability", "cannot be played when nothing is being played: not on the opponent's turn with an empty stack, not on my own turn", () => {
  const idle = recruitBoard();
  refused(() => playRaw(idle.engine, P1, idle.id("fr")), "no character is being played, and it is the opponent's turn with no window", /Only the active player may deploy/);

  const mine = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "fr", def: printing(RECRUITMENT), owner: P1, zone: "hand" }, { key: "own", def: character({ name: "Own", cost: 1 }), owner: P1, zone: "hand" }, ...bank("deception", 8, P1)]
  });
  playRaw(mine.engine, P1, mine.id("own"));
  assert.throws(() => playRaw(mine.engine, P1, mine.id("fr")), /not your priority/, "I can never respond to my own action (CR 607.1): the engine's reason is priority");
});

clause(RECRUITMENT, "0:ability", "the opponent's own character cannot be taken when it is not 'being played': a character already in play is not affected by later use", () => {
  const { engine, id } = recruitBoard({ extra: [{ key: "inplay", def: character({ name: "InPlay" }), owner: P2, zone: "play" }] });
  refused(() => playRaw(engine, P1, id("fr")), "no character is being played (opponent's turn, no window)", /Only the active player may deploy/);
  assert.equal(controllerOf(engine, id("inplay")), P2);
});

// =============================================================================
// Hangdog Alley
// Location, rogue, cost 3, threshold [D], structure 2.
// "When an attacking party is formed, it must have only 1 member."
// =============================================================================

const ALLEY = "7fb4d6d1-0499-4098-a1f6-9d38151a595a";

function alleyBoard(opts: { alleyFor?: Pid | "none"; attacker?: Pid; extra?: CardPlacement[] } = {}) {
  const attacker = opts.attacker ?? P1;
  const defender = other(attacker);
  const alleyFor = opts.alleyFor ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      ...(alleyFor === "none" ? [] : [{ key: "alley", def: printing(ALLEY), owner: alleyFor as Pid, zone: "play" as const }]),
      ...["a1", "a2", "a3"].map((key) => ({ key, def: character({ name: key, strength: 1, life: 5, speed: 2 }), owner: attacker, zone: "play" as const })),
      ...["b1", "b2", "b3"].map((key) => ({ key, def: character({ name: key, strength: 1, life: 5, speed: 2 }), owner: defender, zone: "play" as const })),
      ...(opts.extra ?? [])
    ]
  });
}

const attackWith = (engine: SpoilsEngine, player: Pid, ids: CardInstanceId[]) =>
  engine.perform({ type: "declareAttack", playerId: player, attackerIds: ids, target: { type: "faction", playerId: other(player) } });

clause(ALLEY, "0:rule", "deploys for its printed cost of 3 and [D]", () => {
  deploysForPrintedCost(ALLEY);
});

clause(ALLEY, "0:rule", "has structure 2: one damage leaves it standing, two destroy it", () => {
  for (const [strength, destroyed] of [[1, false], [2, true]] as const) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      cards: [
        { key: "alley", def: printing(ALLEY), owner: P2, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength, life: 5, speed: 2 }), owner: P1, zone: "play" }
      ]
    });
    declareAttackBy(engine, P1, [id("atk")], { type: "card", cardId: id("alley") });
    declareBlockersBy(engine, P2, []);
    autoResolveBattle(engine);
    assert.equal(zoneOf(engine, id("alley")), destroyed ? "discard" : "play", `${strength} damage`);
  }
});

clause(ALLEY, "0:rule", "an attacking party must have exactly 1 member: 1 is allowed, 2 and 3 are refused", () => {
  for (const [size, legal] of [[1, true], [2, false], [3, false]] as const) {
    const { engine, id } = alleyBoard();
    const party = ["a1", "a2", "a3"].slice(0, size).map(id);
    if (legal) {
      attackWith(engine, P1, party);
      assert.deepEqual(battleOf(engine)?.attackingParty, party, `${size} attacker is legal`);
    } else {
      refused(() => attackWith(engine, P1, party), `${size} attackers are refused`);
      assert.equal(battleOf(engine), undefined, "no battle was started");
      for (const cardId of party) assert.equal(isDepleted(engine, cardId), false, "the refused attack depleted nothing");
    }
  }
});

clause(ALLEY, "0:rule", "applies to the opponent's attack too (the Alley is controlled by the DEFENDER), and to its controller's own attack", () => {
  for (const [alleyFor, attacker] of [
    [P1, P2],
    [P2, P2],
    [P1, P1],
    [P2, P1]
  ] as const) {
    const { engine, id } = alleyBoard({ alleyFor, attacker });
    const a = ["a1", "a2"].map(id);
    refused(() => attackWith(engine, attacker, a), `a 2-member party is refused (Alley controlled by ${alleyFor}, ${attacker} attacking)`);
    attackWith(engine, attacker, [a[0]]);
    assert.deepEqual(battleOf(engine)?.attackingParty, [a[0]]);
  }
});

clause(ALLEY, "0:rule", "without the Alley a party of any size may attack", () => {
  const { engine, id } = alleyBoard({ alleyFor: "none" });
  attackWith(engine, P1, ["a1", "a2", "a3"].map(id));
  assert.equal(battleOf(engine)?.attackingParty.length, 3);
});

clause(ALLEY, "0:rule", "only attacking parties are restricted: the defender may block with several characters", () => {
  const { engine, id } = alleyBoard();
  attackWith(engine, P1, [id("a1")]);
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P2, ["b1", "b2", "b3"].map(id));
  assert.equal(battleOf(engine)?.blockingParty.length, 3);
});

clause(ALLEY, "0:rule", "each new attack must again be a single member (a second battle in the same turn is also limited to 1)", () => {
  const { engine, id } = alleyBoard();
  fight(engine, P1, [id("a1")], { type: "faction", playerId: P2 }, []);
  assert.equal(battleOf(engine), undefined);
  refused(() => attackWith(engine, P1, [id("a2"), id("a3")]), "two more attackers together are still refused");
  attackWith(engine, P1, [id("a2")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("a2")]);
});

clause(ALLEY, "0:rule", "off once the Alley is destroyed", () => {
  const smash = tactic({
    name: "SmashLocation",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "smash",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const { engine, id } = alleyBoard({ extra: [{ key: "smash", def: smash, owner: P1, zone: "hand" }] });
  refused(() => attackWith(engine, P1, [id("a1"), id("a2")]), "control: refused while the Alley stands");
  play(engine, P1, id("smash"), { selected: { t: [id("alley")] } });
  assert.equal(zoneOf(engine, id("alley")), "discard");
  attackWith(engine, P1, [id("a1"), id("a2")]);
  assert.equal(battleOf(engine)?.attackingParty.length, 2, "a party of 2 may attack now");
});

// =============================================================================
// Jackmove
// Tactic, rogue, cost 0, threshold [D][D][D][D][D].
// COST: Pick a number for X. Pay twice X.
// EFFECT: Reveal the top X cards of your opponent's deck. Put all revealed
// characters and items into play under your control, and the remaining cards
// into your opponent's discard pile.
// =============================================================================

const JACKMOVE = "66b79f2b-629d-4f94-9b59-598b2abfd05b";

// The opponent's deck, top to bottom: C0 T1 I2 L3 R4 C5 I6 T7.
const MIXED_KINDS = ["character", "tactic", "item", "location", "resource", "character", "item", "tactic"] as const;
function mixedDeck(): CardDefinition[] {
  return [
    character({ name: "C0", strength: 2, life: 3, speed: 2 }),
    tactic({ name: "T1" }),
    item({ name: "I2" }),
    location({ name: "L3" }),
    resourceCard({ name: "R4" }),
    character({ name: "C5", strength: 1, life: 2, speed: 1 }),
    item({ name: "I6" }),
    tactic({ name: "T7" })
  ];
}

function jackmoveBoard(opts: { deception?: number; greed?: number; oppDeck?: CardDefinition[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "jm", def: printing(JACKMOVE), owner: P1, zone: "hand" },
      ...(opts.oppDeck ?? mixedDeck()).map((def, i) => ({ key: `d${i}`, def, owner: P2, zone: "deck" as const })),
      ...fillers("a", 3, P1, "deck"),
      { key: "oppHand", def: character({ name: "OH" }), owner: P2, zone: "hand" },
      { key: "oppOld", def: character({ name: "OppOld" }), owner: P2, zone: "discard" },
      ...bank("deception", opts.deception ?? 5, P1),
      ...bank("greed", opts.greed ?? 12, P1),
      ...(opts.extra ?? [])
    ]
  });
}

for (const x of [0, 1, 2, 3, 4, 5, 8]) {
  clause(JACKMOVE, "0:ability", `X=${x}: pays ${2 * x}, reveals the top ${x}; the characters and items among them enter play under my control, every other revealed card goes to the opponent's discard pile, the rest stays on top of their deck`, () => {
    const { engine, id } = jackmoveBoard();
    const before = ready(engine);
    const deckBefore = [...deckOf(engine, P2)];
    const oppHandBefore = [...handOf(engine, P2)];
    const myDeckBefore = [...deckOf(engine, P1)];
    play(engine, P1, id("jm"), { variables: { x } });
    drain(engine, declineAll);

    assert.equal(before - ready(engine), 2 * x, `pays twice X = ${2 * x}`);
    MIXED_KINDS.forEach((kind, i) => {
      const cardId = id(`d${i}`);
      if (i >= x) {
        assert.equal(zoneOf(engine, cardId), "deck", `d${i} (${kind}) is below the top ${x}: untouched`);
      } else if (kind === "character" || kind === "item") {
        assert.equal(zoneOf(engine, cardId), "play", `d${i} (${kind}) enters play`);
        assert.equal(controllerOf(engine, cardId), P1, `d${i} is under MY control`);
      } else {
        assert.equal(zoneOf(engine, cardId), "discard", `d${i} (${kind}) is put into a discard pile`);
        assert.equal(discardOf(engine, P2).includes(cardId), true, `d${i} went to the OPPONENT's discard pile`);
      }
    });
    assert.deepEqual(deckOf(engine, P2), deckBefore.slice(x), "the cards below the revealed ones are still in the opponent's deck, in order");
    assert.deepEqual(handOf(engine, P2), oppHandBefore, "the opponent's hand is untouched");
    assert.deepEqual(deckOf(engine, P1), myDeckBefore, "my deck is untouched");
    assert.equal(zoneOf(engine, id("jm")), "discard", "the tactic ends in its owner's discard pile");
    assert.equal(discardOf(engine, P1).filter((cardId) => cardId !== id("jm")).length, 0, "nothing went to MY discard pile but the tactic");
  });
}

clause(JACKMOVE, "0:ability", "the taken characters and items still belong to the opponent (only control changes)", () => {
  const { engine, id } = jackmoveBoard();
  play(engine, P1, id("jm"), { variables: { x: 3 } });
  drain(engine, declineAll);
  for (const key of ["d0", "d2"]) {
    assert.equal(ownerOf(engine, id(key)), P2, `${key} is still the opponent's card`);
    assert.equal(engine.state.players[P1].play.includes(id(key)), true, `${key} is in my play area`);
    assert.equal(engine.state.players[P2].play.includes(id(key)), false);
  }
});

clause(JACKMOVE, "0:ability", "a taken character is a character in play: it has its printed stats and a taken item is an item in play", () => {
  const { engine, id } = jackmoveBoard();
  play(engine, P1, id("jm"), { variables: { x: 3 } });
  drain(engine, declineAll);
  assert.deepEqual([engine.getStat(id("d0"), "strength"), engine.getStat(id("d0"), "life"), engine.getStat(id("d0"), "speed")], [2, 3, 2]);
  assert.equal(engine.getDefinition(id("d2")).type, "item");
});

clause(JACKMOVE, "0:ability", "a character put into play this turn cannot attack this turn (it did not start the turn under my control)", () => {
  const { engine, id } = jackmoveBoard();
  play(engine, P1, id("jm"), { variables: { x: 1 } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("d0")), "play");
  refused(() => declareAttackBy(engine, P1, [id("d0")]), "summoning sickness: entered play this turn, no AGGRO", /did not start the turn in play/);
});

clause(JACKMOVE, "0:ability", "the revealed cards are revealed to everyone (exactly the top X)", () => {
  const { engine, id } = jackmoveBoard();
  play(engine, P1, id("jm"), { variables: { x: 3 } });
  drain(engine, declineAll);
  const reveals = eventsOf(engine, "cardsRevealed");
  const revealed = reveals.flatMap((event) => (event.cardIds as string[]) ?? []);
  assert.deepEqual([...revealed].sort(), ["d0", "d1", "d2"].map(id).sort(), "exactly the top 3 cards of the opponent's deck are revealed");
  for (const event of reveals) assert.equal(event.viewerId, "all", "revealed to all players");
  for (const event of reveals) assert.equal(event.ownerId, P2, "from the opponent's deck");
});

clause(JACKMOVE, "0:ability", "X is a cost: the 2X resources are paid when it is played; the opponent's deck is only revealed and taken from when it resolves", () => {
  const { engine, id } = jackmoveBoard();
  const before = ready(engine);
  const deckBefore = [...deckOf(engine, P2)];
  playRaw(engine, P1, id("jm"), { variables: { x: 3 } });
  assert.equal(before - ready(engine), 6, "pay twice X up front");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.deepEqual(deckOf(engine, P2), deckBefore, "nothing has been taken yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("d0")), "play");
});

clause(JACKMOVE, "0:ability", "X larger than the opponent's deck: every card there is revealed and sorted; the deck ends empty (the cost is still 2X)", () => {
  const oppDeck = [character({ name: "OnlyC" }), tactic({ name: "OnlyT" })];
  const { engine, id } = jackmoveBoard({ oppDeck });
  const before = ready(engine);
  play(engine, P1, id("jm"), { variables: { x: 4 } });
  drain(engine, declineAll);
  assert.equal(before - ready(engine), 8, "pay twice X = 8 as X was 4");
  assert.equal(zoneOf(engine, id("d0")), "play");
  assert.equal(zoneOf(engine, id("d1")), "discard");
  assert.equal(deckOf(engine, P2).length, 0);
  assert.equal(engine.state.winner, undefined, "an empty deck does not lose the game");
});

clause(JACKMOVE, "0:ability", "an empty opponent deck: nothing happens, no error", () => {
  const { engine, id } = jackmoveBoard({ oppDeck: [] });
  play(engine, P1, id("jm"), { variables: { x: 2 } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("jm")), "discard");
  assert.equal(engine.state.winner, undefined);
});

clause(JACKMOVE, "0:ability", "a taken character's enters-play trigger is mine (it enters play under my control)", () => {
  const { engine, id } = jackmoveBoard({ oppDeck: [etbDrawer(2), tactic({ name: "T" })] });
  const mineBefore = handOf(engine, P1).length;
  const theirsBefore = handOf(engine, P2).length;
  play(engine, P1, id("jm"), { variables: { x: 1 } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("d0")), "play");
  assert.equal(handOf(engine, P1).length, mineBefore - 1 + 1, "Jackmove left my hand; the stolen character's draw trigger gave me a card");
  assert.equal(handOf(engine, P2).length, theirsBefore, "the opponent drew nothing");
});

clause(JACKMOVE, "0:ability", "is refused when 2X resources cannot be paid: X=2 with 3 resources, allowed with exactly 4", () => {
  const short = jackmoveBoard({ deception: 5, greed: 0 });
  refused(() => playRaw(short.engine, P1, short.id("jm"), { variables: { x: 3 } }), "6 resources needed, 5 owned");
  assert.equal(zoneOf(short.engine, short.id("jm")), "hand", "nothing was played");
  assert.equal(ready(short.engine), 5, "nothing was paid");
  assert.deepEqual(deckOf(short.engine, P2).length, 8, "nothing was revealed or taken");

  const exact = jackmoveBoard({ deception: 5, greed: 1 });
  play(exact.engine, P1, exact.id("jm"), { variables: { x: 3 } });
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("d0")), "play", "6 resources pay for X=3");
  assert.equal(ready(exact.engine), 0);
});

clause(JACKMOVE, "0:ability", "is refused with four [D] even with plenty of other resources, and allowed with five", () => {
  const four = jackmoveBoard({ deception: 4, greed: 12 });
  refused(() => playRaw(four.engine, P1, four.id("jm"), { variables: { x: 0 } }));
  assert.equal(zoneOf(four.engine, four.id("jm")), "hand");
  assert.equal(four.engine.getCardPlayability(P1, four.id("jm")).playable, false);

  const five = jackmoveBoard({ deception: 5, greed: 0 });
  assert.equal(five.engine.getCardPlayability(P1, five.id("jm")).playable, true);
  play(five.engine, P1, five.id("jm"), { variables: { x: 2 } });
  drain(five.engine, declineAll);
  assert.equal(zoneOf(five.engine, five.id("jm")), "discard");
});

clause(JACKMOVE, "0:ability", "X cannot be negative", () => {
  const { engine, id } = jackmoveBoard();
  refused(() => playRaw(engine, P1, id("jm"), { variables: { x: -1 } }));
  assert.equal(zoneOf(engine, id("jm")), "hand");
  assert.equal(ready(engine), 17, "nothing was paid (or refunded)");
  playRaw(engine, P1, id("jm"), { variables: { x: 0 } }); // control: X = 0 is a legal choice
  assert.equal(zoneOf(engine, id("jm")), "deploying");
});

clause(JACKMOVE, "0:ability", "as a tactic it may be played in response on the opponent's turn; the caster takes the cards", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "jm", def: printing(JACKMOVE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...mixedDeck().map((def, i) => ({ key: `d${i}`, def, owner: P2, zone: "deck" as const })),
      ...bank("deception", 7, P1)
    ]
  });
  refused(() => playRaw(engine, P1, id("jm"), { variables: { x: 1 } }), "nothing to respond to yet");
  openDefenderWindow(engine, [id("atk")]);
  playRaw(engine, P1, id("jm"), { variables: { x: 1 } });
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("d0")), P1);
  assert.equal(zoneOf(engine, id("d0")), "play");
});

// =============================================================================
// Jumping Screamspider
// Character, rogue, cost 2, threshold [D][D], 1/4/1 (strength / speed / life), beast.
// COVERT
// SCREAM -- COST: Pay 0. -- EFFECT: This turn, this card loses COVERT and while
// it's in a battle, all characters in the opposing party lose 2 speed.
// =============================================================================

const SPIDER = "bb218756-23cf-43e5-bb27-c18398a251c1";

function spiderBoard(active: Pid = P1, extra: CardPlacement[] = []) {
  const mine = active; // the player whose turn it is gets the spider-side attacker cards
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    cards: [
      { key: "ss", def: printing(SPIDER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 9, speed: 5 }), owner: P2, zone: "play" },
      { key: "pb1", def: character({ name: "PB1", strength: 1, life: 9, speed: 4 }), owner: P2, zone: "play" },
      { key: "pb2", def: character({ name: "PB2", strength: 1, life: 9, speed: 6 }), owner: P2, zone: "play" },
      { key: "cb", def: character({ name: "CB", strength: 1, life: 9, speed: 5, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...(mine === P2 ? [{ key: "catk", def: character({ name: "CAtk", strength: 1, life: 9, speed: 5, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" as const }] : []),
      ...extra
    ]
  });
}

const speed = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getStat(cardId, "speed");
const scream = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, player: Pid = P1) => {
  useAbilityRaw(engine, player, id("ss"), "scream");
  settleStack(engine);
};

clause(SPIDER, "0:kw:COVERT", "has the COVERT keyword (an ordinary character does not)", () => covertHasKeyword(SPIDER));
clause(SPIDER, "0:kw:COVERT", "attacking alone it cannot be blocked by non-covert characters (alone or alongside a covert one); a covert character can block it", () => covertCannotBeBlockedByNonCovert(SPIDER));
clause(SPIDER, "0:kw:COVERT", "a party with a non-covert member is not a covert party", () => covertPartyNeedsEveryMemberCovert(SPIDER));
clause(SPIDER, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(SPIDER));
clause(SPIDER, "0:kw:COVERT", "deploys for its printed cost of 2 and [D][D], and has its printed stats", () => {
  deploysForPrintedCost(SPIDER);
  hasPrintedStats(SPIDER);
});

clause(SPIDER, "1:ability:scream", "costs nothing: usable with no resources at all, and it spends none", () => {
  const { engine, id } = spiderBoard();
  assert.equal(ready(engine), 0, "this board has no resources");
  useAbilityRaw(engine, P1, id("ss"), "scream");
  assert.equal(engine.state.responseStack.length, 1, "the ability was used (it is on the stack for the opponent to respond to)");
  settleStack(engine);
  assert.equal(hasKeyword(engine, id("ss"), "covert"), false, "...and resolved");
});

clause(SPIDER, "1:ability:scream", "does not deplete the card (its cost is only 'Pay 0'): it can still attack afterwards", () => {
  const { engine, id } = spiderBoard();
  scream(engine, id);
  assert.equal(isDepleted(engine, id("ss")), false);
  declareAttackBy(engine, P1, [id("ss")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("ss")]);
});

clause(SPIDER, "1:ability:scream", "this turn it loses COVERT: a non-covert character may now block it", () => {
  const before = spiderBoard();
  assert.equal(hasKeyword(before.engine, before.id("ss"), "covert"), true, "control: covert before");
  declareAttackBy(before.engine, P1, [before.id("ss")]);
  refused(() => declareBlockersBy(before.engine, P2, [before.id("pb1")]), "control: non-covert blockers are refused before SCREAM");

  const { engine, id } = spiderBoard();
  scream(engine, id);
  assert.equal(hasKeyword(engine, id("ss"), "covert"), false, "COVERT is lost");
  declareAttackBy(engine, P1, [id("ss")]);
  declareBlockersBy(engine, P2, [id("pb1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("pb1")], "a plain character blocks it");
});

clause(SPIDER, "1:ability:scream", "losing COVERT affects only this card (other covert characters keep it)", () => {
  const { engine, id } = spiderBoard();
  scream(engine, id);
  assert.equal(hasKeyword(engine, id("cb"), "covert"), true);
});

clause(SPIDER, "1:ability:scream", "it loses COVERT for THIS turn only: it is covert again on the opponent's turn and on my next turn", () => {
  const { engine, id } = spiderBoard();
  scream(engine, id);
  assert.equal(hasKeyword(engine, id("ss"), "covert"), false);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(hasKeyword(engine, id("ss"), "covert"), true, "covert again on the opponent's turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(hasKeyword(engine, id("ss"), "covert"), true, "and on my next turn");
});

clause(SPIDER, "1:ability:scream", "used after attacking, the party stops being covert at once (CR 302.11a): a plain character can then block", () => {
  const { engine, id } = spiderBoard();
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("ss")], target: { type: "faction", playerId: P2 } });
  useAbilityRaw(engine, P1, id("ss"), "scream");
  settleStack(engine);
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P2, [id("pb1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("pb1")]);
});

clause(SPIDER, "1:ability:scream", "while it is attacking in a battle, every character of the opposing (blocking) party loses 2 speed — and no one else does", () => {
  const { engine, id } = spiderBoard();
  scream(engine, id);
  declareAttackBy(engine, P1, [id("ss"), id("ally")]);
  declareBlockersBy(engine, P2, [id("pb1"), id("pb2")]);
  assert.equal(speed(engine, id("pb1")), 4 - 2, "blocker 1");
  assert.equal(speed(engine, id("pb2")), 6 - 2, "blocker 2");
  assert.equal(speed(engine, id("cb")), 5, "a covert character that is not in the battle is untouched");
  assert.equal(speed(engine, id("ss")), 4, "its own speed is untouched");
  assert.equal(speed(engine, id("ally")), 3, "a member of its own party is untouched");
  assert.equal(speed(engine, id("bystander")), 5, "an opposing character that is not in the battle is untouched");
});

clause(SPIDER, "1:ability:scream", "used during the battle (after blockers are declared) the blockers lose 2 speed immediately", () => {
  const { engine, id } = spiderBoard();
  declareAttackBy(engine, P1, [id("ss"), id("ally")]);
  declareBlockersBy(engine, P2, [id("pb1"), id("pb2")]);
  assert.equal(speed(engine, id("pb1")), 4, "control: full speed before SCREAM");
  scream(engine, id);
  assert.equal(speed(engine, id("pb1")), 2);
  assert.equal(speed(engine, id("pb2")), 4);
  assert.equal(speed(engine, id("bystander")), 5);
});

clause(SPIDER, "1:ability:scream", "the lost speed changes the battle damage order: a 4-speed blocker is slowed to 2, so the 4-speed spider deals its damage first", () => {
  const steps = (useScream: boolean): Array<[number | undefined, string]> => {
    const { engine, id } = spiderBoard(P1, []);
    if (useScream) scream(engine, id);
    // a non-covert party (spider + ally), so the plain blocker may block
    declareAttackBy(engine, P1, [id("ss"), id("ally")]);
    declareBlockersBy(engine, P2, [id("pb1")]);
    const recorded: Array<[number | undefined, string]> = [];
    autoResolveBattle(engine, (source) => {
      recorded.push([engine.getBattleView()?.speed, engine.getDefinition(source.cardId).name]);
      return source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : [];
    });
    return recorded;
  };
  assert.deepEqual(steps(false), [[4, "Jumping Screamspider"], [4, "PB1"], [3, "Ally"]], "control: without SCREAM the 4-speed blocker assigns in the same speed-4 group as the spider");
  assert.deepEqual(steps(true), [[4, "Jumping Screamspider"], [3, "Ally"], [2, "PB1"]], "after SCREAM the blocker (speed 2) assigns last");
});

clause(SPIDER, "1:ability:scream", "when the card is blocking, the attackers (the opposing party) lose 2 speed", () => {
  const { engine, id } = spiderBoard(P2);
  declareAttackBy(engine, P2, [id("catk")]);
  declareBlockersBy(engine, P1, [id("ss")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("ss")], "a covert spider blocks the covert attacker");
  assert.equal(speed(engine, id("catk")), 5, "control: full speed before SCREAM");
  engine.perform({ type: "passPriority", playerId: P2 });
  scream(engine, id);
  assert.equal(speed(engine, id("catk")), 5 - 2, "the attacker loses 2 speed");
  assert.equal(speed(engine, id("ss")), 4, "the spider itself does not");
});

clause(SPIDER, "1:ability:scream", "it applies only while the spider is in the battle: another character of mine attacking is unaffected", () => {
  const { engine, id } = spiderBoard();
  scream(engine, id);
  declareAttackBy(engine, P1, [id("ally")]);
  declareBlockersBy(engine, P2, [id("pb1")]);
  assert.equal(speed(engine, id("pb1")), 4, "the spider is not in this battle");
});

clause(SPIDER, "1:ability:scream", "an unblocked spider has no opposing party: nobody loses speed", () => {
  const { engine, id } = spiderBoard();
  scream(engine, id);
  declareAttackBy(engine, P1, [id("ss")]);
  declareBlockersBy(engine, P2, []);
  for (const key of ["pb1", "pb2", "cb", "bystander"]) assert.equal(speed(engine, id(key)), key === "pb1" ? 4 : key === "pb2" ? 6 : 5, `${key} is untouched`);
});

clause(SPIDER, "1:ability:scream", "without using SCREAM nobody loses speed", () => {
  const { engine, id } = spiderBoard();
  declareAttackBy(engine, P1, [id("ss"), id("ally")]);
  declareBlockersBy(engine, P2, [id("pb1")]);
  assert.equal(speed(engine, id("pb1")), 4);
});

clause(SPIDER, "1:ability:scream", "the speed loss lasts only while it is in the battle: once the battle is over everyone is back to normal", () => {
  const { engine, id } = spiderBoard();
  scream(engine, id);
  fight(engine, P1, [id("ss"), id("ally")], { type: "faction", playerId: P2 }, [id("pb1")]);
  assert.equal(battleOf(engine), undefined, "the battle is over");
  assert.equal(speed(engine, id("pb1")), 4);
  assert.equal(zoneOf(engine, id("pb1")), "play");
});

clause(SPIDER, "1:ability:scream", "the effect is 'this turn': on the next turns the spider's battles no longer lower speed", () => {
  const { engine, id } = spiderBoard();
  scream(engine, id);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  declareAttackBy(engine, P1, [id("ss"), id("ally")]);
  declareBlockersBy(engine, P2, [id("pb1")]);
  assert.equal(speed(engine, id("pb1")), 4, "the previous turn's SCREAM has ended");
});

clause(SPIDER, "1:ability:scream", "on the opponent's following turn the effect is over too: a spider blocking a covert attacker does not slow it", () => {
  const { engine, id } = spiderBoard(P1);
  scream(engine, id);
  endTurn(engine, P1);
  declareAttackBy(engine, P2, [id("cb")]);
  declareBlockersBy(engine, P1, [id("ss")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("ss")], "covert again, so it may block the covert attacker");
  assert.equal(speed(engine, id("cb")), 5, "no speed loss: SCREAM was last turn");
});

clause(SPIDER, "1:ability:scream", "using it twice stacks: two uses make the opposing party lose 4 speed", () => {
  const { engine, id } = spiderBoard();
  scream(engine, id);
  scream(engine, id);
  declareAttackBy(engine, P1, [id("ss"), id("ally")]);
  declareBlockersBy(engine, P2, [id("pb2")]);
  assert.equal(speed(engine, id("pb2")), 6 - 4);
});

clause(SPIDER, "1:ability:scream", "only its controller can use it", () => {
  const { engine, id } = spiderBoard();
  endTurn(engine, P1); // P2's turn
  refused(() => useAbilityRaw(engine, P2, id("ss"), "scream"), "the opponent cannot use my spider's ability");
  assert.equal(hasKeyword(engine, id("ss"), "covert"), true);
});

clause(SPIDER, "1:ability:scream", "cannot be used from the hand", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ss", def: printing(SPIDER), owner: P1, zone: "hand" }]
  });
  refused(() => useAbilityRaw(engine, P1, id("ss"), "scream"));
});

// =============================================================================
// Pluck
// Character, rogue, cost 2, threshold [D][D], 1/3/2 (strength / speed / life), pluck grifter.
// UNIQUE PLUCK
// GRIFT -- COST: Use this only during your turn. Pay 5. Deplete this card. Pick a
// non-tactic card in your opponent's discard pile.
// EFFECT: Put the card into play under your control.
// =============================================================================

const PLUCK = "f4ccc8f6-f59d-47f3-8972-48d83770de94";
const BILLIONAIRE = "ff195e18-a459-4594-b155-8572b869f368";

function pluckBoard(opts: { greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[]; pluckDepleted?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "pl", def: printing(PLUCK), owner: P1, zone: "play", depleted: opts.pluckDepleted },
      { key: "dChar", def: character({ name: "DChar", strength: 3, life: 4, speed: 2 }), owner: P2, zone: "discard" },
      { key: "dItem", def: item({ name: "DItem" }), owner: P2, zone: "discard" },
      { key: "dPlace", def: location({ name: "DPlace" }), owner: P2, zone: "discard" },
      { key: "dRes", def: resourceCard({ name: "DRes", resource: { provides: ["elitism"], staple: false } }), owner: P2, zone: "discard" },
      { key: "dTactic", def: tactic({ name: "DTactic" }), owner: P2, zone: "discard" },
      { key: "myChar", def: character({ name: "MyDiscardedChar" }), owner: P1, zone: "discard" },
      { key: "oppHand", def: character({ name: "OppHandChar" }), owner: P2, zone: "hand" },
      { key: "oppDeck", def: character({ name: "OppDeckChar" }), owner: P2, zone: "deck" },
      { key: "oppPlay", def: character({ name: "OppPlayChar" }), owner: P2, zone: "play" },
      ...bank("greed", opts.greed ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const grift = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, target: string) => activate(engine, P1, id("pl"), "grift", { selected: { c: [id(target)] } });

clause(PLUCK, "0:unique", "deploys for its printed cost of 2 and [D][D], and has its printed stats", () => {
  deploysForPrintedCost(PLUCK);
  hasPrintedStats(PLUCK);
});

clause(PLUCK, "0:unique", "a second Pluck forces a choice: I keep one and the other is destroyed (keep the new one)", () => {
  const { engine, id } = pluckBoard({ extra: [{ key: "pl2", def: printing(PLUCK), owner: P1, zone: "hand" }, ...bank("deception", 2, P1)] });
  play(engine, P1, id("pl2"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [id("pl"), id("pl2")].sort());
  keepUnique(engine, P1, id("pl2"));
  assert.equal(zoneOf(engine, id("pl2")), "play");
  assert.equal(zoneOf(engine, id("pl")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(PLUCK, "0:unique", "keeping the old Pluck destroys the new one", () => {
  const { engine, id } = pluckBoard({ extra: [{ key: "pl2", def: printing(PLUCK), owner: P1, zone: "hand" }, ...bank("deception", 2, P1)] });
  play(engine, P1, id("pl2"));
  keepUnique(engine, P1, id("pl"));
  assert.equal(zoneOf(engine, id("pl")), "play");
  assert.equal(zoneOf(engine, id("pl2")), "discard");
});

clause(PLUCK, "0:unique", "UNIQUE PLUCK is shared with The Billionaire: deploying one while controlling the other forces the same choice", () => {
  const { engine, id } = pluckBoard({ extra: [{ key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "hand" }, ...bank("deception", 4, P1)] });
  play(engine, P1, id("bill"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor", "Pluck and The Billionaire both carry UNIQUE PLUCK");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [id("pl"), id("bill")].sort());
  keepUnique(engine, P1, id("bill"));
  assert.equal(zoneOf(engine, id("bill")), "play");
  assert.equal(zoneOf(engine, id("pl")), "discard");
});

clause(PLUCK, "0:unique", "only my own copies count: the opponent may control their own Pluck with no choice and no destruction", () => {
  const { engine, id } = pluckBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "pl2", def: printing(PLUCK), owner: P2, zone: "hand" }, ...bank("deception", 2, P2)]
  });
  play(engine, P2, id("pl2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("pl2")), "play");
  assert.equal(zoneOf(engine, id("pl")), "play");
});

clause(PLUCK, "0:unique", "a card with a different UNIQUE designation does not conflict", () => {
  const { engine, id } = pluckBoard({
    extra: [
      { key: "uniq", def: character({ name: "OtherUnique", unique: "somethingelse", cost: 1 }), owner: P1, zone: "hand" },
      { key: "uniqIn", def: character({ name: "OtherUniqueIn", unique: "anotherone" }), owner: P1, zone: "play" }
    ]
  });
  play(engine, P1, id("uniq"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("uniq")), "play");
  assert.equal(zoneOf(engine, id("pl")), "play");
});

clause(PLUCK, "1:ability:grift", "pays 5, depletes Pluck, and puts the picked character from the opponent's discard pile into play under my control", () => {
  const { engine, id } = pluckBoard();
  const before = ready(engine);
  grift(engine, id, "dChar");
  assert.equal(before - ready(engine), 5, "COST: pay 5");
  assert.equal(isDepleted(engine, id("pl")), true, "COST: deplete this card");
  assert.equal(zoneOf(engine, id("dChar")), "play");
  assert.equal(controllerOf(engine, id("dChar")), P1);
  assert.equal(ownerOf(engine, id("dChar")), P2, "it is still the opponent's card");
  assert.equal(discardOf(engine, P2).includes(id("dChar")), false, "it left the discard pile");
  assert.deepEqual([engine.getStat(id("dChar"), "strength"), engine.getStat(id("dChar"), "life"), engine.getStat(id("dChar"), "speed")], [3, 4, 2]);
  for (const key of ["dItem", "dPlace", "dRes", "dTactic"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key} stays in the discard pile`);
});

clause(PLUCK, "1:ability:grift", "can pick an item from the opponent's discard pile", () => {
  const { engine, id } = pluckBoard();
  grift(engine, id, "dItem");
  assert.equal(zoneOf(engine, id("dItem")), "play");
  assert.equal(controllerOf(engine, id("dItem")), P1);
});

clause(PLUCK, "1:ability:grift", "can pick a location from the opponent's discard pile", () => {
  const { engine, id } = pluckBoard();
  grift(engine, id, "dPlace");
  assert.equal(zoneOf(engine, id("dPlace")), "play");
  assert.equal(controllerOf(engine, id("dPlace")), P1);
});

clause(PLUCK, "1:ability:grift", "can pick a resource card (any non-tactic card): it is put into play under my control", () => {
  const { engine, id } = pluckBoard();
  grift(engine, id, "dRes");
  assert.equal(zoneOf(engine, id("dRes")), "play");
  assert.equal(controllerOf(engine, id("dRes")), P1);
});

clause(PLUCK, "1:ability:grift", "cannot pick a TACTIC in the opponent's discard pile", () => {
  const { engine, id } = pluckBoard();
  refused(() => grift(engine, id, "dTactic"));
  assert.equal(zoneOf(engine, id("dTactic")), "discard");
  assert.equal(isDepleted(engine, id("pl")), false, "nothing was paid");
  assert.equal(ready(engine), 6);
  grift(engine, id, "dChar"); // control: a legal pick works on the same board
  assert.equal(zoneOf(engine, id("dChar")), "play");
});

clause(PLUCK, "1:ability:grift", "the card must be in the OPPONENT's discard pile: not my own discard pile, not a hand, a deck or play", () => {
  const { engine, id } = pluckBoard();
  for (const key of ["myChar", "oppHand", "oppDeck", "oppPlay"]) {
    refused(() => grift(engine, id, key), `${key} is not in the opponent's discard pile`);
  }
  assert.equal(zoneOf(engine, id("myChar")), "discard");
  assert.equal(isDepleted(engine, id("pl")), false);
  assert.equal(ready(engine), 6, "no failed attempt spent anything");
  grift(engine, id, "dChar");
  assert.equal(zoneOf(engine, id("dChar")), "play", "control: a legal pick works");
});

clause(PLUCK, "1:ability:grift", "exactly one card is picked: none or two are refused", () => {
  const { engine, id } = pluckBoard();
  refused(() => activate(engine, P1, id("pl"), "grift", { selected: { c: [] } }), "a pick is required");
  refused(() => activate(engine, P1, id("pl"), "grift", { selected: { c: [id("dChar"), id("dItem")] } }), "only one card is picked");
  assert.equal(zoneOf(engine, id("dChar")), "discard");
  grift(engine, id, "dChar"); // control: one pick works
  assert.equal(zoneOf(engine, id("dChar")), "play");
});

clause(PLUCK, "1:ability:grift", "use this only during your turn: refused on the opponent's turn (in response), allowed on mine", () => {
  const theirs = pluckBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }] });
  openDefenderWindow(theirs.engine, [theirs.id("atk")]);
  assert.equal(theirs.engine.state.responseWindow?.priorityPlayerId, P1, "I can respond to their attack");
  refused(() => useAbilityRaw(theirs.engine, P1, theirs.id("pl"), "grift", { selected: { c: [theirs.id("dChar")] } }), "not during the opponent's turn");
  assert.equal(isDepleted(theirs.engine, theirs.id("pl")), false);
  assert.equal(ready(theirs.engine), 6, "nothing was paid");

  const mine = pluckBoard();
  grift(mine.engine, mine.id, "dChar");
  assert.equal(zoneOf(mine.engine, mine.id("dChar")), "play", "control: my own turn works");
});

clause(PLUCK, "1:ability:grift", "an already-depleted Pluck cannot use it, and using it depletes Pluck so it cannot be used twice", () => {
  const dep = pluckBoard({ pluckDepleted: true });
  refused(() => grift(dep.engine, dep.id, "dChar"));
  assert.equal(dep.engine.state.cards[dep.id("dChar")].zone, "discard");
  assert.equal(ready(dep.engine), 6, "nothing was paid");

  const { engine, id } = pluckBoard({ greed: 12 });
  grift(engine, id, "dChar");
  refused(() => grift(engine, id, "dItem"), "depleted by the first use");
  assert.equal(zoneOf(engine, id("dItem")), "discard");
  assert.equal(ready(engine), 7, "the second attempt cost nothing");
});

clause(PLUCK, "1:ability:grift", "is refused one resource short of 5, and allowed with exactly 5", () => {
  const short = pluckBoard({ greed: 4 });
  refused(() => grift(short.engine, short.id, "dChar"));
  assert.equal(isDepleted(short.engine, short.id("pl")), false, "nothing was half-paid");
  assert.equal(ready(short.engine), 4);
  assert.equal(zoneOf(short.engine, short.id("dChar")), "discard");

  const exact = pluckBoard({ greed: 5 });
  grift(exact.engine, exact.id, "dChar");
  assert.equal(zoneOf(exact.engine, exact.id("dChar")), "play");
  assert.equal(ready(exact.engine), 0);
});

clause(PLUCK, "1:ability:grift", "the costs are paid when it is used (before the opponent responds); the card only moves when the ability resolves", () => {
  const { engine, id } = pluckBoard();
  useAbilityRaw(engine, P1, id("pl"), "grift", { selected: { c: [id("dChar")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(ready(engine), 1, "5 paid up front");
  assert.equal(isDepleted(engine, id("pl")), true, "depleted up front");
  assert.equal(zoneOf(engine, id("dChar")), "discard", "the card has not moved yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("dChar")), "play");
});

clause(PLUCK, "1:ability:grift", "only its controller can use it", () => {
  const { engine, id } = pluckBoard({ turn: 2, active: P2, extra: bank("greed", 6, P2) });
  refused(() => activate(engine, P2, id("pl"), "grift", { selected: { c: [id("myChar")] } }), "the opponent cannot use my Pluck's ability");
  assert.equal(zoneOf(engine, id("myChar")), "discard");
});

clause(PLUCK, "1:ability:grift", "a stolen character is a normal card under my control: it cannot attack this turn but is mine to use afterwards", () => {
  const { engine, id } = pluckBoard({ turn: 2 });
  grift(engine, id, "dChar");
  refused(() => declareAttackBy(engine, P1, [id("dChar")]), "it entered play this turn");
});

// =============================================================================
// Rapine
// Tactic, rogue, cost 5, threshold [D][D].
// COST: Destroy a character or item you control. Pick a character.
// EFFECT: Take control of the picked character.
// =============================================================================

const RAPINE = "ada1c199-5610-4f56-8756-8557119f8a95";

function rapineBoard(opts: { deception?: number; greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "rp", def: printing(RAPINE), owner: P1, zone: "hand" },
      { key: "sac", def: character({ name: "Sac", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "sacItem", def: item({ name: "SacItem" }), owner: P1, zone: "play" },
      { key: "myPlace", def: location({ name: "MyPlace" }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      // (the opponent's characters did not start MY turn in play under my control)
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play", attackEligible: false },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play", attackEligible: false },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "foeFaceDown" })),
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 5, P1),
      ...bank("greed", opts.greed ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const rapine = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, sac: string, picked: string) =>
  play(engine, P1, id("rp"), { selected: { sac: [id(sac)], c: [id(picked)] } });

clause(RAPINE, "0:ability", "pays 5, destroys the character I sacrificed, and takes control of the picked opposing character", () => {
  const { engine, id } = rapineBoard();
  const before = ready(engine);
  rapine(engine, id, "sac", "foe");
  assert.equal(before - ready(engine), 5, "the printed cost of 5 is paid");
  assert.equal(zoneOf(engine, id("sac")), "discard", "COST: the character I control is destroyed");
  assert.equal(discardOf(engine, P1).includes(id("sac")), true, "into its owner's discard pile");
  assert.equal(zoneOf(engine, id("foe")), "play", "the picked character stays in play");
  assert.equal(controllerOf(engine, id("foe")), P1, "...under my control");
  assert.equal(ownerOf(engine, id("foe")), P2, "...though it is still the opponent's card");
  assert.equal(engine.state.players[P1].play.includes(id("foe")), true);
  assert.equal(engine.state.players[P2].play.includes(id("foe")), false);
  assert.equal(zoneOf(engine, id("rp")), "discard", "the tactic ends in its owner's discard pile");
  assert.equal(controllerOf(engine, id("foe2")), P2, "another opposing character is untouched");
  assert.equal(zoneOf(engine, id("mine")), "play", "my other character is untouched");
});

clause(RAPINE, "0:ability", "the destroyed card may be an ITEM I control instead of a character", () => {
  const { engine, id } = rapineBoard();
  rapine(engine, id, "sacItem", "foe");
  assert.equal(zoneOf(engine, id("sacItem")), "discard");
  assert.equal(controllerOf(engine, id("foe")), P1);
  assert.equal(zoneOf(engine, id("sac")), "play", "my characters are untouched when an item is sacrificed");
});

clause(RAPINE, "0:ability", "the card to destroy must be a character or item I control: not a location, not the opponent's card, not a card in hand", () => {
  const { engine, id } = rapineBoard();
  for (const key of ["myPlace", "foe2", "foeItem", "foePlace", "inHand", "rp"]) {
    refused(() => rapine(engine, id, key, "foe"), `${key} cannot be the sacrifice`);
  }
  assert.equal(zoneOf(engine, id("rp")), "hand", "nothing was played");
  assert.equal(controllerOf(engine, id("foe")), P2, "nothing was taken");
  assert.equal(ready(engine), 8, "no failed attempt spent anything");
  for (const key of ["myPlace", "foe2", "foeItem", "inHand"]) assert.notEqual(zoneOf(engine, id(key)), "discard", `${key} was not destroyed by a refused play`);
  rapine(engine, id, "sac", "foe"); // control: a legal sacrifice works on the same board
  assert.equal(controllerOf(engine, id("foe")), P1);
});

clause(RAPINE, "0:ability", "the sacrifice cannot be a face-down resource or a faction (neither is a character or item)", () => {
  const { engine, id } = rapineBoard({ extra: volition(1, P1).map((p) => ({ ...p, key: "myFaceDown" })) });
  refused(() => rapine(engine, id, "myFaceDown", "foe"));
  refused(() => play(engine, P1, id("rp"), { selected: { sac: [engine.state.players[P1].factionId!], c: [id("foe")] } }));
  assert.equal(zoneOf(engine, id("myFaceDown")), "play");
  assert.equal(controllerOf(engine, id("foe")), P2);
});

clause(RAPINE, "0:ability", "exactly one card is sacrificed: none or two are refused", () => {
  const { engine, id } = rapineBoard();
  refused(() => play(engine, P1, id("rp"), { selected: { sac: [], c: [id("foe")] } }), "a sacrifice is required");
  refused(() => play(engine, P1, id("rp"), { selected: { sac: [id("sac"), id("sacItem")], c: [id("foe")] } }), "only one");
  assert.equal(zoneOf(engine, id("sac")), "play");
  assert.equal(zoneOf(engine, id("sacItem")), "play");
  rapine(engine, id, "sac", "foe"); // control: one sacrifice works
  assert.equal(controllerOf(engine, id("foe")), P1);
});

clause(RAPINE, "0:ability", "the picked card must be a character: not an item, a location, a face-down resource or a faction", () => {
  const { engine, id } = rapineBoard();
  for (const key of ["foeItem", "foePlace", "foeFaceDown"]) {
    refused(() => rapine(engine, id, "sac", key), `${key} cannot be picked`);
  }
  refused(() => play(engine, P1, id("rp"), { selected: { sac: [id("sac")], c: [engine.state.players[P2].factionId!] } }), "a faction cannot be picked (CR 202.9)");
  assert.equal(zoneOf(engine, id("sac")), "play", "nothing was destroyed by a refused play");
  assert.equal(controllerOf(engine, id("foeItem")), P2);
  refused(() => play(engine, P1, id("rp"), { selected: { sac: [id("sac")], c: [id("foe"), id("foe2")] } }), "exactly one character is picked");
  refused(() => play(engine, P1, id("rp"), { selected: { sac: [id("sac")], c: [] } }), "a pick is required");
});

clause(RAPINE, "0:ability", "'a character' may be any character in play, including one of mine (nothing changes hands)", () => {
  const { engine, id } = rapineBoard();
  rapine(engine, id, "sac", "mine");
  assert.equal(zoneOf(engine, id("sac")), "discard");
  assert.equal(controllerOf(engine, id("mine")), P1);
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(RAPINE, "0:ability", "the destroying is a COST: it is done when the tactic is played, before the opponent can respond; control changes only on resolution", () => {
  const { engine, id } = rapineBoard();
  playRaw(engine, P1, id("rp"), { selected: { sac: [id("sac")], c: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("sac")), "discard", "the sacrifice is already destroyed");
  assert.equal(ready(engine), 3, "5 resources already paid");
  assert.equal(controllerOf(engine, id("foe")), P2, "control has not changed yet");
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("foe")), P1);
});

clause(RAPINE, "0:ability", "if the picked character left play in response, the cost stays paid and nothing else happens", () => {
  const { engine, id } = rapineBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("rp"), { selected: { sac: [id("sac")], c: [id("foe")] } });
  playRaw(engine, P2, id("bounce"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "hand", "bounced by the opponent in response");
  assert.equal(zoneOf(engine, id("sac")), "discard", "the sacrifice was a cost and stays destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(RAPINE, "0:ability", "is refused one resource short of 5, and allowed with exactly 5", () => {
  const short = rapineBoard({ deception: 2, greed: 2 });
  refused(() => rapine(short.engine, short.id, "sac", "foe"));
  assert.equal(zoneOf(short.engine, short.id("sac")), "play", "the sacrifice was not destroyed");
  assert.equal(controllerOf(short.engine, short.id("foe")), P2);
  assert.equal(ready(short.engine), 4);

  const exact = rapineBoard({ deception: 2, greed: 3 });
  rapine(exact.engine, exact.id, "sac", "foe");
  assert.equal(controllerOf(exact.engine, exact.id("foe")), P1);
  assert.equal(ready(exact.engine), 0);
});

clause(RAPINE, "0:ability", "is refused without [D][D] even with plenty of other resources, and allowed with two [D]", () => {
  const one = rapineBoard({ deception: 1, greed: 8 });
  refused(() => rapine(one.engine, one.id, "sac", "foe"), "only one [D]");
  assert.equal(zoneOf(one.engine, one.id("sac")), "play");
  assert.equal(one.engine.getCardPlayability(P1, one.id("rp")).playable, false);

  const two = rapineBoard({ deception: 2, greed: 6 });
  assert.equal(two.engine.getCardPlayability(P1, two.id("rp")).playable, true);
  rapine(two.engine, two.id, "sac", "foe");
  assert.equal(controllerOf(two.engine, two.id("foe")), P1);
});

clause(RAPINE, "0:ability", "with nothing of mine to destroy it cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rp", def: printing(RAPINE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "myPlace", def: location({ name: "MyPlace" }), owner: P1, zone: "play" },
      ...bank("deception", 5, P1)
    ]
  });
  refused(() => play(engine, P1, id("rp"), { selected: { sac: [], c: [id("foe")] } }));
  assert.equal(controllerOf(engine, id("foe")), P2);
});

clause(RAPINE, "0:ability", "a character taken this turn cannot attack this turn (it did not start the turn under my control)", () => {
  const { engine, id } = rapineBoard({ turn: 2 });
  rapine(engine, id, "sac", "foe");
  refused(() => declareAttackBy(engine, P1, [id("foe")]), "summoning sickness: entered play this turn, no AGGRO", /did not start the turn in play/);
});

clause(RAPINE, "0:ability", "as a tactic it can be played in response on the opponent's turn: taking control of an attacker removes it from the battle", () => {
  const { engine, id } = rapineBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 4, life: 5, speed: 3 }), owner: P2, zone: "play" }]
  });
  refused(() => rapine(engine, id, "sac", "atk"), "nothing to respond to yet");
  openDefenderWindow(engine, [id("atk")]);
  const influenceBefore = influence(engine, P1);
  rapine(engine, id, "sac", "atk");
  assert.equal(controllerOf(engine, id("atk")), P1, "I took the attacker");
  assert.equal(battleOf(engine)?.attackingParty?.includes(id("atk")) ?? false, false, "it is no longer in the attacking party (CR 407.4)");
  autoResolveBattle(engine);
  assert.equal(influence(engine, P1), influenceBefore, "the attack deals no damage to me");
});

// =============================================================================
// Sarcophyle Matriculation
// Tactic, rogue, cost 4, threshold [D][D].
// COST: Play this only when you are being attacked. Pick a character your opponent controls.
// EFFECT: If the character would be destroyed during this battle, instead put it
// into play under your control, depleted. It becomes a "sarcophyle".
// =============================================================================

const MATRICULATION = "4c74c015-d20e-4558-95d0-e5d31d414b5b";

function matriculationBoard(opts: { deception?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sm", def: printing(MATRICULATION), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 2, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 3, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 3, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 3, life: 6, speed: 1 }), owner: P1, zone: "play" },
      ...bank("deception", opts.deception ?? 4, P1),
      ...bank("greed", opts.greed ?? 2, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 attacks P1's faction with `attackers`; P1 (the defender) may respond. */
function beingAttacked(engine: SpoilsEngine, id: (key: string) => CardInstanceId, attackers: string[] = ["atk"]) {
  openDefenderWindow(engine, attackers.map(id));
}

/** Plays Matriculation inside the open battle window and lets it resolve, leaving the window open. */
function matriculate(engine: SpoilsEngine, id: (key: string) => CardInstanceId, picked: string) {
  playRaw(engine, P1, id("sm"), { selected: { c: [id(picked)] } });
  settleStack(engine);
}

/** Plays a response tactic of mine inside the open window and lets it resolve, leaving the window open. */
function respond(engine: SpoilsEngine, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}, player: Pid = P1) {
  playRaw(engine, player, cardId, { selected });
  settleStack(engine);
}

clause(MATRICULATION, "0:ability", "pays 4; the picked attacker killed in the battle is not destroyed: it enters play under my control, depleted, undamaged", () => {
  const { engine, id } = matriculationBoard();
  beingAttacked(engine, id);
  const before = ready(engine);
  matriculate(engine, id, "atk");
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(zoneOf(engine, id("sm")), "discard", "the tactic ends in its owner's discard pile");
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P1, [id("blk")]);
  autoResolveBattle(engine);

  assert.equal(zoneOf(engine, id("atk")), "play", "it was not destroyed");
  assert.equal(discardOf(engine, P2).includes(id("atk")), false, "...and is not in its owner's discard pile");
  assert.equal(controllerOf(engine, id("atk")), P1, "it is under MY control");
  assert.equal(ownerOf(engine, id("atk")), P2, "though still the opponent's card");
  assert.equal(isDepleted(engine, id("atk")), true, "it enters play depleted");
  assert.equal(damageOf(engine, id("atk")), 0, "as a new object it carries no damage");
  assert.equal(engine.getSubtypes(id("atk")).includes("sarcophyle"), true, "it becomes a sarcophyle");
});

clause(MATRICULATION, "0:ability", "only the picked character is saved: another attacker destroyed in the same battle goes to the discard pile as usual", () => {
  const { engine, id } = matriculationBoard();
  beingAttacked(engine, id, ["atk", "atk2"]);
  matriculate(engine, id, "atk");
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P1, [id("blk"), id("blk2")]);
  autoResolveBattle(engine);
  assert.equal(controllerOf(engine, id("atk")), P1, "the picked attacker is mine");
  assert.equal(zoneOf(engine, id("atk")), "play");
  assert.equal(zoneOf(engine, id("atk2")), "discard", "the other attacker (3 damage vs life 2) is destroyed normally");
});

clause(MATRICULATION, "0:ability", "the picked character need not be in the battle: if it is destroyed during the battle (by a tactic) it is taken instead", () => {
  const { engine, id } = matriculationBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  beingAttacked(engine, id);
  matriculate(engine, id, "bystander");
  respond(engine, id("kill"), { t: [id("bystander")] });
  assert.equal(zoneOf(engine, id("bystander")), "play", "not destroyed");
  assert.equal(controllerOf(engine, id("bystander")), P1);
  assert.equal(isDepleted(engine, id("bystander")), true);
  assert.equal(engine.getSubtypes(id("bystander")).includes("sarcophyle"), true);
  assert.equal(discardOf(engine, P2).includes(id("bystander")), false);
});

clause(MATRICULATION, "0:ability", "a character that is NOT the picked one and is destroyed during the battle is destroyed normally", () => {
  const { engine, id } = matriculationBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  beingAttacked(engine, id);
  matriculate(engine, id, "atk");
  respond(engine, id("kill"), { t: [id("bystander")] });
  assert.equal(zoneOf(engine, id("bystander")), "discard");
  assert.equal(controllerOf(engine, id("atk")), P2, "the picked character is untouched until it would be destroyed");
});

clause(MATRICULATION, "0:ability", "it lasts for this battle only: once the battle is over a destroyed picked character is simply destroyed", () => {
  const { engine, id } = matriculationBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  beingAttacked(engine, id);
  matriculate(engine, id, "bystander");
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(battleOf(engine), undefined, "the battle is over");
  engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the end of their turn");
  respond(engine, id("kill"), { t: [id("bystander")] });
  assert.equal(zoneOf(engine, id("bystander")), "discard", "no longer protected after the battle");
});

clause(MATRICULATION, "0:ability", "if the picked character is not destroyed it just stays where it is, under its owner's control", () => {
  const { engine, id } = matriculationBoard();
  beingAttacked(engine, id);
  matriculate(engine, id, "bystander");
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(controllerOf(engine, id("bystander")), P2);
  assert.equal(isDepleted(engine, id("bystander")), false);
  assert.equal(engine.getSubtypes(id("bystander")).includes("sarcophyle"), false, "it does not become a sarcophyle unless it would have been destroyed");
});

clause(MATRICULATION, "0:ability", "only when I am being attacked: refused when there is no battle, and when I am the attacker", () => {
  const idle = matriculationBoard();
  refused(() => matriculate(idle.engine, idle.id, "atk"), "no battle");
  assert.equal(zoneOf(idle.engine, idle.id("sm")), "hand");

  const mine = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sm", def: printing(MATRICULATION), owner: P1, zone: "hand" },
      { key: "me", def: character({ name: "Me" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("deception", 6, P1)
    ]
  });
  mine.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [mine.id("me")], target: { type: "faction", playerId: P2 } });
  refused(() => play(mine.engine, P1, mine.id("sm"), { selected: { c: [mine.id("foe")] } }), "I am the one attacking");
  assert.equal(zoneOf(mine.engine, mine.id("sm")), "hand");

  const control = matriculationBoard();
  beingAttacked(control.engine, control.id); // control: the same pick works once I am the one being attacked
  matriculate(control.engine, control.id, "atk");
  assert.equal(zoneOf(control.engine, control.id("sm")), "discard");
});

clause(MATRICULATION, "0:ability", "allowed once I am being attacked and after the blockers are declared too", () => {
  const { engine, id } = matriculationBoard();
  beingAttacked(engine, id);
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P1, [id("blk")]);
  // the attacker's window first, then mine
  engine.perform({ type: "passPriority", playerId: P2 });
  matriculate(engine, id, "atk");
  autoResolveBattle(engine);
  assert.equal(controllerOf(engine, id("atk")), P1, "saved from destruction even though it was already blocked");
  assert.equal(zoneOf(engine, id("atk")), "play");
});

clause(MATRICULATION, "0:ability", "the pick must be a character my opponent controls: not my own character, not an item, not a faction", () => {
  const { engine, id } = matriculationBoard();
  beingAttacked(engine, id);
  for (const key of ["blk", "foeItem"]) refused(() => matriculate(engine, id, key), `${key} cannot be picked`);
  refused(() => play(engine, P1, id("sm"), { selected: { c: [engine.state.players[P2].factionId!] } }), "a faction cannot be picked");
  refused(() => play(engine, P1, id("sm"), { selected: { c: [] } }), "a pick is required");
  refused(() => play(engine, P1, id("sm"), { selected: { c: [id("atk"), id("bystander")] } }), "one character only");
  assert.equal(zoneOf(engine, id("sm")), "hand", "nothing was played");
  assert.equal(ready(engine), 6, "nothing was paid");
  matriculate(engine, id, "atk"); // control
  assert.equal(zoneOf(engine, id("sm")), "discard");
});

clause(MATRICULATION, "0:ability", "a character I own but my opponent controls is a legal pick; one I control but they own is not", () => {
  const { engine, id } = matriculationBoard({
    extra: [
      { key: "lentOut", def: character({ name: "LentOut", strength: 1, life: 3 }), owner: P1, controller: P2, zone: "play" },
      { key: "borrowed", def: character({ name: "Borrowed", strength: 1, life: 3 }), owner: P2, controller: P1, zone: "play" }
    ]
  });
  beingAttacked(engine, id);
  refused(() => matriculate(engine, id, "borrowed"), "I control it");
  matriculate(engine, id, "lentOut");
  assert.equal(zoneOf(engine, id("sm")), "discard");
});

clause(MATRICULATION, "0:ability", "is refused one resource short of 4, and allowed with exactly 4", () => {
  const short = matriculationBoard({ deception: 2, greed: 1 });
  beingAttacked(short.engine, short.id);
  refused(() => matriculate(short.engine, short.id, "atk"));
  assert.equal(zoneOf(short.engine, short.id("sm")), "hand");

  const exact = matriculationBoard({ deception: 2, greed: 2 });
  beingAttacked(exact.engine, exact.id);
  matriculate(exact.engine, exact.id, "atk");
  assert.equal(zoneOf(exact.engine, exact.id("sm")), "discard");
  assert.equal(ready(exact.engine), 0);
});

clause(MATRICULATION, "0:ability", "is refused without [D][D] even with plenty of other resources", () => {
  const one = matriculationBoard({ deception: 1, greed: 8 });
  beingAttacked(one.engine, one.id);
  refused(() => matriculate(one.engine, one.id, "atk"));
  assert.equal(one.engine.getCardPlayability(P1, one.id("sm")).playable, false);

  const two = matriculationBoard({ deception: 2, greed: 2 });
  beingAttacked(two.engine, two.id);
  assert.equal(two.engine.getCardPlayability(P1, two.id("sm")).playable, true);
});

clause(MATRICULATION, "0:ability", "the pick is a cost: made when the tactic is played, before the opponent can respond", () => {
  const { engine, id } = matriculationBoard();
  beingAttacked(engine, id);
  playRaw(engine, P1, id("sm"), { selected: { c: [id("atk")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(ready(engine), 2, "4 already paid");
  assert.equal(zoneOf(engine, id("sm")), "deploying");
});

// =============================================================================
// Snake Eyes
// Tactic, rogue, cost 3, threshold [D].
// COST: Pick a character.
// EFFECT: If the character has received damage this turn, destroy it. Draw a card.
// =============================================================================

const SNAKE_EYES = "bfaca5bc-5275-4060-9a22-1f9324e2dfb6";

/** Deals `amount` real damage to `targetKey` (with one of the board's free hit tactics) so it "has received damage this turn". */
function hurt(engine: SpoilsEngine, id: (key: string) => CardInstanceId, targetKey: string, hitKey: "hit1" | "hit2" = "hit1"): void {
  play(engine, P1, id(hitKey), { selected: { t: [id(targetKey)] } });
  assert.ok(damageOf(engine, id(targetKey)) > 0, `${targetKey} took damage`);
}

function snakeBoard(opts: { deception?: number; greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[]; myDeck?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "se", def: printing(SNAKE_EYES), owner: P1, zone: "hand" },
      { key: "hurt", def: character({ name: "Hurt", strength: 1, life: 5 }), owner: P2, zone: "play" },
      { key: "fresh", def: character({ name: "Fresh", strength: 1, life: 5 }), owner: P2, zone: "play" },
      { key: "myHurt", def: character({ name: "MyHurt", strength: 1, life: 5 }), owner: P1, zone: "play" },
      { key: "myFresh", def: character({ name: "MyFresh", strength: 1, life: 5 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 5 }), owner: P2, zone: "play" },
      // free tactics used to deal REAL damage to a character before Snake Eyes is played
      { key: "hit1", def: hitTactic(1), owner: P1, zone: "hand" },
      { key: "hit2", def: hitTactic(2), owner: P1, zone: "hand" },
      ...fillers("a", opts.myDeck ?? 4, P1, "deck"),
      ...fillers("b", 3, P2, "deck"),
      ...bank("deception", opts.deception ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(SNAKE_EYES, "0:ability", "a picked character that has received damage this turn is destroyed; the tactic costs 3 and draws a card", () => {
  const { engine, id } = snakeBoard();
  hurt(engine, id, "hurt");
  const before = ready(engine);
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("se"), { selected: { c: [id("hurt")] } });
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(zoneOf(engine, id("hurt")), "discard", "destroyed");
  assert.equal(discardOf(engine, P2).includes(id("hurt")), true, "into its owner's discard pile");
  assert.equal(zoneOf(engine, top), "hand", "I drew the top card of my deck");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
  assert.equal(zoneOf(engine, id("se")), "discard");
  assert.equal(zoneOf(engine, id("fresh")), "play", "other characters are untouched");
});

clause(SNAKE_EYES, "0:ability", "a picked character that has NOT received damage this turn survives — and I still draw a card", () => {
  const { engine, id } = snakeBoard();
  const top = deckOf(engine, P1)[0];
  play(engine, P1, id("se"), { selected: { c: [id("fresh")] } });
  assert.equal(zoneOf(engine, id("fresh")), "play", "no damage: not destroyed");
  assert.equal(damageOf(engine, id("fresh")), 0);
  assert.equal(zoneOf(engine, top), "hand", "the draw is not conditional");
  assert.equal(deckOf(engine, P1).length, 3, "exactly one card drawn");
});

clause(SNAKE_EYES, "0:ability", "works on my own characters too (any character)", () => {
  const { engine, id } = snakeBoard();
  hurt(engine, id, "myHurt", "hit2");
  play(engine, P1, id("se"), { selected: { c: [id("myHurt")] } });
  assert.equal(zoneOf(engine, id("myHurt")), "discard");
  assert.equal(discardOf(engine, P1).includes(id("myHurt")), true);

  const second = snakeBoard();
  play(second.engine, P1, second.id("se"), { selected: { c: [second.id("myFresh")] } });
  assert.equal(zoneOf(second.engine, second.id("myFresh")), "play", "an undamaged character of mine survives");
});

clause(SNAKE_EYES, "0:ability", "any amount of damage counts: 1 damage on a 5-life character is enough", () => {
  const { engine, id } = snakeBoard();
  hurt(engine, id, "hurt", "hit1");
  assert.equal(damageOf(engine, id("hurt")), 1);
  play(engine, P1, id("se"), { selected: { c: [id("hurt")] } });
  assert.equal(zoneOf(engine, id("hurt")), "discard");
});

clause(SNAKE_EYES, "0:ability", "damage dealt earlier THIS turn by a battle counts: a blocker that survived a battle is destroyed afterwards", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "se", def: printing(SNAKE_EYES), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...fillers("a", 2, P1, "deck"),
      ...bank("deception", 3, P1)
    ]
  });
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(damageOf(engine, id("blk")), 1, "the blocker survived with 1 damage");
  play(engine, P1, id("se"), { selected: { c: [id("blk")] } });
  assert.equal(zoneOf(engine, id("blk")), "discard");
});

clause(SNAKE_EYES, "0:ability", "a battle-damaged blocker is destroyed, but a character that was in no battle and took no damage is not", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "se", def: printing(SNAKE_EYES), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...fillers("a", 2, P1, "deck"),
      ...bank("deception", 3, P1)
    ]
  });
  fight(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("blk")]);
  play(engine, P1, id("se"), { selected: { c: [id("bystander")] } });
  assert.equal(zoneOf(engine, id("bystander")), "play", "it was never damaged");
});

clause(SNAKE_EYES, "0:ability", "damage from an earlier turn does not count (damage clears at the start of a turn)", () => {
  const { engine, id } = snakeBoard();
  hurt(engine, id, "hurt");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(damageOf(engine, id("hurt")), 0, "the damage was cleared when the turn started");
  play(engine, P1, id("se"), { selected: { c: [id("hurt")] } });
  assert.equal(zoneOf(engine, id("hurt")), "play", "no damage THIS turn: not destroyed");
});

clause(SNAKE_EYES, "0:ability", "the condition is checked when the tactic resolves: a character that takes damage in response is destroyed", () => {
  const { engine, id } = snakeBoard({ extra: [{ key: "hit", def: hitTactic(1), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("se"), { selected: { c: [id("fresh")] } });
  assert.equal(damageOf(engine, id("fresh")), 0, "undamaged when I play it");
  playRaw(engine, P2, id("hit"), { selected: { t: [id("fresh")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("fresh")), "discard", "it received damage this turn before Snake Eyes resolved");
});

clause(SNAKE_EYES, "0:ability", "damage to a DIFFERENT character does not count", () => {
  const { engine, id } = snakeBoard();
  hurt(engine, id, "hurt");
  hurt(engine, id, "myHurt", "hit2");
  play(engine, P1, id("se"), { selected: { c: [id("fresh")] } });
  assert.equal(zoneOf(engine, id("fresh")), "play", "Hurt and MyHurt took damage, Fresh did not");
});

clause(SNAKE_EYES, "0:ability", "the pick must be a character: not an item, a location, a face-down resource or a faction", () => {
  const { engine, id } = snakeBoard({ extra: volition(1, P2).map((p) => ({ ...p, key: "faceDown" })) });
  for (const key of ["thing", "place", "faceDown"]) refused(() => play(engine, P1, id("se"), { selected: { c: [id(key)] } }), `${key} cannot be picked`);
  refused(() => play(engine, P1, id("se"), { selected: { c: [engine.state.players[P2].factionId!] } }), "a faction cannot be picked");
  refused(() => play(engine, P1, id("se"), { selected: { c: [id("hurt"), id("fresh")] } }), "exactly one");
  refused(() => play(engine, P1, id("se"), { selected: { c: [] } }), "a pick is required");
  assert.equal(zoneOf(engine, id("se")), "hand", "nothing was played");
  assert.equal(zoneOf(engine, id("place")), "play");
  play(engine, P1, id("se"), { selected: { c: [id("fresh")] } }); // control: a character pick is accepted
  assert.equal(zoneOf(engine, id("se")), "discard");
});

clause(SNAKE_EYES, "0:ability", "draws even when my deck is empty (nothing to draw) and still destroys", () => {
  const { engine, id } = snakeBoard({ myDeck: 0 });
  hurt(engine, id, "hurt");
  play(engine, P1, id("se"), { selected: { c: [id("hurt")] } });
  assert.equal(zoneOf(engine, id("hurt")), "discard");
  assert.equal(engine.state.winner, undefined);
});

clause(SNAKE_EYES, "0:ability", "is refused one resource short of 3, and allowed with exactly 3", () => {
  const short = snakeBoard({ deception: 2 });
  hurt(short.engine, short.id, "hurt");
  refused(() => play(short.engine, P1, short.id("se"), { selected: { c: [short.id("hurt")] } }));
  assert.equal(zoneOf(short.engine, short.id("se")), "hand");
  assert.equal(zoneOf(short.engine, short.id("hurt")), "play");

  const exact = snakeBoard({ deception: 3 });
  hurt(exact.engine, exact.id, "hurt");
  assert.equal(exact.engine.getCardPlayability(P1, exact.id("se")).playable, true);
  play(exact.engine, P1, exact.id("se"), { selected: { c: [exact.id("hurt")] } });
  assert.equal(zoneOf(exact.engine, exact.id("hurt")), "discard");
});

clause(SNAKE_EYES, "0:ability", "is refused without [D], even with plenty of other resources; one [D] among them is enough", () => {
  const none = snakeBoard({ deception: 0, greed: 6 });
  refused(() => play(none.engine, P1, none.id("se"), { selected: { c: [none.id("hurt")] } }));
  assert.equal(none.engine.getCardPlayability(P1, none.id("se")).playable, false);

  const one = snakeBoard({ deception: 1, greed: 2 });
  hurt(one.engine, one.id, "hurt");
  play(one.engine, P1, one.id("se"), { selected: { c: [one.id("hurt")] } });
  assert.equal(zoneOf(one.engine, one.id("hurt")), "discard");
});

clause(SNAKE_EYES, "0:ability", "the pick is a cost (made when played, before the opponent responds); the destroy and the draw wait for resolution", () => {
  const { engine, id } = snakeBoard();
  hurt(engine, id, "hurt");
  const deckBefore = [...deckOf(engine, P1)];
  playRaw(engine, P1, id("se"), { selected: { c: [id("hurt")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  assert.equal(zoneOf(engine, id("hurt")), "play", "not destroyed yet");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "not drawn yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("hurt")), "discard");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1));
});

clause(SNAKE_EYES, "0:ability", "can be played in response on the opponent's turn", () => {
  const { engine, id } = snakeBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 5 }), owner: P2, zone: "play" }]
  });
  refused(() => play(engine, P1, id("se"), { selected: { c: [id("atk")] } }), "nothing to respond to yet");
  openDefenderWindow(engine, [id("atk")]);
  respond(engine, id("hit1"), { t: [id("atk")] });
  assert.equal(damageOf(engine, id("atk")), 1);
  respond(engine, id("se"), { c: [id("atk")] });
  assert.equal(zoneOf(engine, id("atk")), "discard", "the damaged attacker is destroyed");
});

// =============================================================================
// The Billionaire
// Character, rogue, cost 5, threshold [D][D][D][D], 2/4/3 (strength / speed / life), pluck grifter.
// UNIQUE PLUCK
// You may use abilities on your opponent's cards as though you were your opponent.
// (The effect still happens to your opponent.)
// CHANGE COSTUME -- COST: Pay 3. Shuffle this card into its owner's deck.
// EFFECT: Search your deck for a "pluck" card with a different name than this card and put it into play.
// =============================================================================

const wizardDef = (cost = 2): CardDefinition =>
  character({
    name: "Wizard",
    strength: 1,
    life: 5,
    behavior: { abilities: [{ id: "zap", type: "activated", costs: [{ type: "payResources", amount: cost }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function billionaireBoard(opts: { rage?: number; oppRage?: number; billionaire?: "mine" | "theirs" | "none"; active?: Pid; extra?: CardPlacement[] } = {}) {
  const who = opts.billionaire ?? "mine";
  const holder: Pid = who === "theirs" ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      ...(who === "none" ? [] : [{ key: "bill", def: printing(BILLIONAIRE), owner: holder, zone: "play" as const }]),
      { key: "wizard", def: wizardDef(), owner: who === "theirs" ? P1 : P2, zone: "play" },
      { key: "myWizard", def: wizardDef(), owner: holder, zone: "play" },
      ...fillers("a", 4, P1, "deck"),
      ...fillers("b", 4, P2, "deck"),
      ...bank("rage", opts.rage ?? 5, P1),
      ...bank("rage", opts.oppRage ?? 3, P2),
      ...(opts.extra ?? [])
    ]
  });
}

clause(BILLIONAIRE, "0:unique", "deploys for its printed cost of 5 and [D][D][D][D], and has its printed stats", () => {
  deploysForPrintedCost(BILLIONAIRE);
  hasPrintedStats(BILLIONAIRE);
});

clause(BILLIONAIRE, "0:unique", "a second Billionaire forces a choice: one is kept, the other destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b1", def: printing(BILLIONAIRE), owner: P1, zone: "play" },
      { key: "b2", def: printing(BILLIONAIRE), owner: P1, zone: "hand" },
      ...bank("deception", 5, P1)
    ]
  });
  play(engine, P1, id("b2"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [id("b1"), id("b2")].sort());
  keepUnique(engine, P1, id("b1"));
  assert.equal(zoneOf(engine, id("b1")), "play");
  assert.equal(zoneOf(engine, id("b2")), "discard");
});

clause(BILLIONAIRE, "0:unique", "UNIQUE PLUCK is shared with Pluck: deploying a Pluck while I control The Billionaire forces the choice", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "play" },
      { key: "pl", def: printing(PLUCK), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1)
    ]
  });
  play(engine, P1, id("pl"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  keepUnique(engine, P1, id("bill"));
  assert.equal(zoneOf(engine, id("bill")), "play");
  assert.equal(zoneOf(engine, id("pl")), "discard");
});

clause(BILLIONAIRE, "0:unique", "the opponent may control their own Billionaire with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "b1", def: printing(BILLIONAIRE), owner: P1, zone: "play" },
      { key: "b2", def: printing(BILLIONAIRE), owner: P2, zone: "hand" },
      ...bank("deception", 5, P2)
    ]
  });
  play(engine, P2, id("b2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("b1")), "play");
  assert.equal(zoneOf(engine, id("b2")), "play");
});

clause(BILLIONAIRE, "1:rule", "I can use an ability of my opponent's card: it is paid with THEIR resources and its effect happens to THEM", () => {
  const { engine, id } = billionaireBoard();
  const mineBefore = ready(engine, P1);
  const theirsBefore = ready(engine, P2);
  const myHand = handOf(engine, P1).length;
  const theirHand = handOf(engine, P2).length;
  const theirTop = deckOf(engine, P2)[0];
  activate(engine, P1, id("wizard"), "zap");
  assert.equal(theirsBefore - ready(engine, P2), 2, "the opponent's resources pay (as though I were my opponent)");
  assert.equal(ready(engine, P1), mineBefore, "none of mine are spent");
  assert.equal(handOf(engine, P2).length, theirHand + 1, "the effect still happens to my opponent: THEY draw");
  assert.equal(zoneOf(engine, theirTop), "hand");
  assert.equal(handOf(engine, P1).length, myHand, "I draw nothing");
});

clause(BILLIONAIRE, "1:rule", "without The Billionaire I cannot use the opponent's ability (control)", () => {
  const { engine, id } = billionaireBoard({ billionaire: "none" });
  refused(() => activate(engine, P1, id("wizard"), "zap"));
  assert.equal(handOf(engine, P2).length, 0);
  assert.equal(ready(engine, P2), 3, "nothing was paid");
});

clause(BILLIONAIRE, "1:rule", "the opponent must be able to pay: with 1 resource for a cost of 2 it is refused even though I have plenty", () => {
  const short = billionaireBoard({ rage: 9, oppRage: 1 });
  refused(() => activate(short.engine, P1, short.id("wizard"), "zap"));
  assert.equal(ready(short.engine, P1), 9);
  assert.equal(ready(short.engine, P2), 1);
  assert.equal(handOf(short.engine, P2).length, 0);

  const exact = billionaireBoard({ rage: 0, oppRage: 2 });
  activate(exact.engine, P1, exact.id("wizard"), "zap");
  assert.equal(handOf(exact.engine, P2).length, 1, "with exactly 2 of THEIR resources it works, though I have none");
});

clause(BILLIONAIRE, "1:rule", "other costs are satisfied as though I were the opponent: it depletes THEIR card and needs THEIR character", () => {
  const depleter = character({
    name: "Depleter",
    behavior: {
      abilities: [
        {
          id: "tap",
          type: "activated",
          costs: [{ type: "deplete", target: "source" }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = billionaireBoard({ extra: [{ key: "dep", def: depleter, owner: P2, zone: "play" }] });
  activate(engine, P1, id("dep"), "tap");
  assert.equal(isDepleted(engine, id("dep")), true, "the opponent's card is the one depleted");
  assert.equal(handOf(engine, P2).length, 1, "the opponent drew");
  refused(() => activate(engine, P1, id("dep"), "tap"), "it is depleted now");
});

clause(BILLIONAIRE, "1:rule", "'you control' in a borrowed cost means the OPPONENT's cards: it can be paid with their character, not with mine", () => {
  const sacrificer = character({
    name: "Sacrificer",
    behavior: {
      abilities: [
        {
          id: "sac",
          type: "activated",
          targets: [{ id: "d", selector: { controller: "self", type: "character" }, count: 1 }],
          costs: [{ type: "deplete", target: { type: "selected", id: "d" } }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = billionaireBoard({ extra: [{ key: "sacr", def: sacrificer, owner: P2, zone: "play" }] });
  refused(() => activate(engine, P1, id("sacr"), "sac", { selected: { d: [id("myWizard")] } }), "my character is not a character 'you' (the opponent) control");
  assert.equal(isDepleted(engine, id("myWizard")), false);
  activate(engine, P1, id("sacr"), "sac", { selected: { d: [id("wizard")] } });
  assert.equal(isDepleted(engine, id("wizard")), true, "their character was depleted");
  assert.equal(handOf(engine, P2).length, 1);
});

clause(BILLIONAIRE, "1:rule", "my own cards' abilities are unaffected: they still use MY resources and MY draw", () => {
  const { engine, id } = billionaireBoard();
  const theirs = ready(engine, P2);
  activate(engine, P1, id("myWizard"), "zap");
  assert.equal(ready(engine, P1), 3, "I paid 2 of my own");
  assert.equal(handOf(engine, P1).length, 1, "I drew");
  assert.equal(ready(engine, P2), theirs);
  assert.equal(handOf(engine, P2).length, 0);
});

clause(BILLIONAIRE, "1:rule", "only while The Billionaire is in play: once it is destroyed I can no longer use their abilities", () => {
  const { engine, id } = billionaireBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  activate(engine, P1, id("wizard"), "zap");
  assert.equal(handOf(engine, P2).length, 1, "control: works while it is in play");
  play(engine, P1, id("kill"), { selected: { t: [id("bill")] } });
  assert.equal(zoneOf(engine, id("bill")), "discard");
  refused(() => activate(engine, P1, id("wizard"), "zap"));
  assert.equal(handOf(engine, P2).length, 1);
});

clause(BILLIONAIRE, "1:rule", "it works for whoever controls it: the opponent's Billionaire lets THEM use MY abilities, paid with my resources, happening to me", () => {
  const { engine, id } = billionaireBoard({ billionaire: "theirs", active: P2 });
  const theirs = ready(engine, P2);
  const mine = ready(engine, P1);
  activate(engine, P2, id("wizard"), "zap");
  assert.equal(mine - ready(engine, P1), 2, "MY resources pay");
  assert.equal(ready(engine, P2), theirs, "theirs are untouched");
  assert.equal(handOf(engine, P1).length, 1, "the effect happens to me");
  assert.equal(handOf(engine, P2).length, 0);
});

clause(BILLIONAIRE, "1:rule", "a Billionaire in my hand does nothing", () => {
  const { engine, id } = billionaireBoard({ billionaire: "none", extra: [{ key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "hand" }] });
  refused(() => activate(engine, P1, id("wizard"), "zap"));
});

// --- CHANGE COSTUME ---------------------------------------------------------

const PLUCK_ONLY = (name: string, subtype: string[] = ["pluck"]) => character({ name, subtype, strength: 1, life: 2, speed: 1 });

function costumeBoard(opts: { rage?: number; billOwner?: Pid; seed?: number; deck?: CardPlacement[]; random?: () => number } = {}) {
  const board = buildGame({
    random: opts.random ?? mulberry(opts.seed ?? 4242),
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bill", def: printing(BILLIONAIRE), owner: opts.billOwner ?? P1, controller: P1, zone: "play" },
      ...(opts.deck ?? [
        { key: "pluckA", def: PLUCK_ONLY("PluckA"), owner: P1, zone: "deck" as const },
        { key: "plain1", def: character({ name: "Plain1" }), owner: P1, zone: "deck" as const },
        { key: "pluckB", def: PLUCK_ONLY("PluckB", ["pluck", "grifter"]), owner: P1, zone: "deck" as const },
        { key: "grifterOnly", def: PLUCK_ONLY("GrifterOnly", ["grifter"]), owner: P1, zone: "deck" as const },
        { key: "bill2", def: printing(BILLIONAIRE), owner: P1, zone: "deck" as const },
        { key: "plain2", def: character({ name: "Plain2" }), owner: P1, zone: "deck" as const },
        { key: "realPluck", def: printing(PLUCK), owner: P1, zone: "deck" as const }
      ]),
      { key: "pluckHand", def: PLUCK_ONLY("PluckHand"), owner: P1, zone: "hand" },
      { key: "pluckDiscard", def: PLUCK_ONLY("PluckDiscard"), owner: P1, zone: "discard" },
      { key: "pluckOpp", def: PLUCK_ONLY("PluckOpp"), owner: P2, zone: "deck" },
      { key: "oppPlain", def: character({ name: "OppPlain" }), owner: P2, zone: "deck" },
      ...bank("greed", opts.rage ?? 3, P1)
    ]
  });
  return board;
}

const costume = (engine: SpoilsEngine, id: (key: string) => CardInstanceId) => activate(engine, P1, id("bill"), "costume");

clause(BILLIONAIRE, "2:ability:costume", "pays 3, shuffles The Billionaire into its owner's deck, and lets me search my deck for a 'pluck' card (only those are offered)", () => {
  const { engine, id } = costumeBoard();
  const before = ready(engine);
  costume(engine, id);
  assert.equal(before - ready(engine), 3, "COST: pay 3");
  assert.equal(zoneOf(engine, id("bill")), "deck", "COST: The Billionaire is shuffled into the deck");
  assert.equal(deckOf(engine, P1).includes(id("bill")), true, "...its owner's deck");
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "I am asked what to search for");
  assert.equal(pc?.playerId, P1);
  for (const key of ["plain1", "plain2", "grifterOnly", "bill2", "pluckHand", "pluckDiscard", "pluckOpp", "oppPlain", "bill"]) {
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } } as never),
      `${key} is not a legal pick`
    );
  }
  assert.ok(engine.state.pendingChoice, "refused picks leave the choice open");
  pick(engine, P1, [id("pluckA")]);
  assert.equal(zoneOf(engine, id("pluckA")), "play", "the found card enters play");
  assert.equal(controllerOf(engine, id("pluckA")), P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("pluckB")), "deck", "the other pluck cards stay in the deck");
  assert.equal(zoneOf(engine, id("bill")), "deck", "The Billionaire stays in the deck");
});

clause(BILLIONAIRE, "2:ability:costume", "a card with the pluck subtype among several (pluck, grifter) is legal, and so is the real Pluck (a different name)", () => {
  const first = costumeBoard();
  costume(first.engine, first.id);
  pick(first.engine, P1, [first.id("pluckB")]);
  assert.equal(zoneOf(first.engine, first.id("pluckB")), "play");

  const second = costumeBoard();
  costume(second.engine, second.id);
  pick(second.engine, P1, [second.id("realPluck")]);
  assert.equal(zoneOf(second.engine, second.id("realPluck")), "play");
  assert.equal(second.engine.state.pendingChoice, undefined, "no UNIQUE PLUCK conflict: The Billionaire is already out of play");
  assert.equal(zoneOf(second.engine, second.id("bill")), "deck");
});

clause(BILLIONAIRE, "2:ability:costume", "the search may be declined (a search with criteria may fail): nothing enters play, The Billionaire still went into the deck", () => {
  const { engine, id } = costumeBoard();
  costume(engine, id);
  pick(engine, P1, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.players[P1].play.filter((cardId) => engine.getSubtypes(cardId).includes("pluck")).length, 0, "no pluck card entered play");
  assert.equal(zoneOf(engine, id("bill")), "deck");
});

clause(BILLIONAIRE, "2:ability:costume", "no pluck card in my deck: nothing to find, but the cost is still paid and The Billionaire is still shuffled away", () => {
  const { engine, id } = costumeBoard({ deck: [{ key: "plain1", def: character({ name: "Plain1" }), owner: P1, zone: "deck" }] });
  const before = ready(engine);
  costume(engine, id);
  drain(engine, declineAll);
  assert.equal(before - ready(engine), 3);
  assert.equal(zoneOf(engine, id("bill")), "deck");
  assert.equal(zoneOf(engine, id("plain1")), "deck", "nothing else moved");
});

clause(BILLIONAIRE, "2:ability:costume", "'its owner's deck': a Billionaire I control but the opponent owns is shuffled into THE OPPONENT's deck, while I search MY deck", () => {
  const { engine, id } = costumeBoard({ billOwner: P2 });
  const oppDeckSize = deckOf(engine, P2).length;
  costume(engine, id);
  assert.equal(zoneOf(engine, id("bill")), "deck");
  assert.equal(deckOf(engine, P2).includes(id("bill")), true, "it went into its owner's (the opponent's) deck");
  assert.equal(deckOf(engine, P2).length, oppDeckSize + 1);
  assert.equal(deckOf(engine, P1).includes(id("bill")), false, "not into mine");
  pick(engine, P1, [id("pluckA")]);
  assert.equal(controllerOf(engine, id("pluckA")), P1, "the search was of MY deck");
});

clause(BILLIONAIRE, "2:ability:costume", "the deck really is shuffled with The Billionaire in it: its position varies with the random stream", () => {
  const positions = new Set<number>();
  for (let seed = 1; seed <= 24; seed++) {
    const { engine, id } = costumeBoard({ seed: seed * 7919 });
    costume(engine, id);
    pick(engine, P1, []);
    positions.add(deckOf(engine, P1).indexOf(id("bill")));
  }
  assert.ok(positions.size > 3, `The Billionaire ended up at ${positions.size} different positions over 24 shuffles`);
});

clause(BILLIONAIRE, "2:ability:costume", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const { engine, id } = costumeBoard({ seed: seed * 104729 });
    costume(engine, id);
    pick(engine, P1, [id("pluckA")]);
    orders.add(deckOf(engine, P1).join(","));
  }
  assert.ok(orders.size > 3, `the remaining deck came out in ${orders.size} different orders`);
});

clause(BILLIONAIRE, "2:ability:costume", "is refused one resource short of 3 (The Billionaire stays in play), and allowed with exactly 3", () => {
  const short = costumeBoard({ rage: 2 });
  refused(() => costume(short.engine, short.id));
  assert.equal(zoneOf(short.engine, short.id("bill")), "play");
  assert.equal(ready(short.engine), 2);
  assert.equal(short.engine.state.pendingChoice, undefined);

  const exact = costumeBoard({ rage: 3 });
  costume(exact.engine, exact.id);
  assert.equal(zoneOf(exact.engine, exact.id("bill")), "deck");
  assert.equal(ready(exact.engine), 0);
});

clause(BILLIONAIRE, "2:ability:costume", "shuffling itself into the deck is a COST: it has left play before the opponent can respond", () => {
  const { engine, id } = costumeBoard();
  useAbilityRaw(engine, P1, id("bill"), "costume");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(ready(engine), 0, "3 paid up front");
  assert.equal(zoneOf(engine, id("bill")), "deck", "The Billionaire was shuffled away as a cost, before any response");
});

clause(BILLIONAIRE, "2:ability:costume", "only its controller can use it, and not from my hand", () => {
  const { engine, id } = costumeBoard({ rage: 3 });
  engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(engine);
  assert.equal(engine.state.activePlayerId, P2);
  refused(() => activate(engine, P2, id("bill"), "costume"), "the opponent cannot use my Billionaire's ability");
  assert.equal(zoneOf(engine, id("bill")), "play");

  const inHand = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]
  });
  refused(() => activate(inHand.engine, P1, inHand.id("bill"), "costume"));
});

// =============================================================================
// Thief Doyen
// Character, rogue, cost 4, threshold [D][D], 0/3/0 (strength / speed / life), thief.
// COST: Discard a character or item. X is that card's numeric cost.
// This card enters play with X tokens on it.
// This card gains 1 strength and 1 life for each token on it.
// =============================================================================

const DOYEN = "22a812b3-ef95-4590-9e60-7c1d9266e97b";

function doyenBoard(opts: { deception?: number; greed?: number; extra?: CardPlacement[]; random?: () => number } = {}) {
  return buildGame({
    random: opts.random,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "td", def: printing(DOYEN), owner: P1, zone: "hand" },
      { key: "dChar3", def: character({ name: "DChar3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "dChar6", def: character({ name: "DChar6", cost: 6 }), owner: P1, zone: "hand" },
      { key: "dChar0", def: character({ name: "DChar0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "dItem2", def: item({ name: "DItem2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "dTactic", def: tactic({ name: "DTactic", cost: 3 }), owner: P1, zone: "hand" },
      { key: "dPlace", def: location({ name: "DPlace", cost: 4 }), owner: P1, zone: "hand" },
      { key: "dRes", def: resourceCard({ name: "DRes" }), owner: P1, zone: "hand" },
      { key: "oppHand", def: character({ name: "OppHand", cost: 5 }), owner: P2, zone: "hand" },
      { key: "inPlay", def: character({ name: "InPlay", cost: 5 }), owner: P1, zone: "play" },
      { key: "inDeck", def: character({ name: "InDeck", cost: 5 }), owner: P1, zone: "deck" },
      ...bank("deception", opts.deception ?? 4, P1),
      ...bank("greed", opts.greed ?? 2, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const deployDoyen = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, discard: string) =>
  play(engine, P1, id("td"), { selected: { d: [id(discard)] } });

clause(DOYEN, "0:ability", "deploys for its printed cost of 4 and [D][D] (plus the discard), refused one resource short or without [D][D]", () => {
  const ok = doyenBoard({ deception: 2, greed: 2 });
  const before = ready(ok.engine);
  deployDoyen(ok.engine, ok.id, "dChar3");
  assert.equal(zoneOf(ok.engine, ok.id("td")), "play");
  assert.equal(before - ready(ok.engine), 4, "the printed numeric cost of 4 is paid");

  const short = doyenBoard({ deception: 2, greed: 1 });
  refused(() => deployDoyen(short.engine, short.id, "dChar3"), "3 resources are not enough");
  assert.equal(zoneOf(short.engine, short.id("td")), "hand");
  assert.equal(zoneOf(short.engine, short.id("dChar3")), "hand", "the discard cost was not paid for a refused play");

  const noThreshold = doyenBoard({ deception: 1, greed: 8 });
  refused(() => deployDoyen(noThreshold.engine, noThreshold.id, "dChar3"), "one [D] is not [D][D]");
  assert.equal(noThreshold.engine.getCardPlayability(P1, noThreshold.id("td")).playable, false);
});

for (const [key, x, label] of [
  ["dChar3", 3, "a cost-3 character"],
  ["dChar6", 6, "a cost-6 character"],
  ["dItem2", 2, "a cost-2 item"]
] as const) {
  clause(DOYEN, "0:ability", `discarding ${label}: X is ${x} — it is discarded and Doyen enters play with ${x} tokens, ${x} strength and ${x + 0} life`, () => {
    const { engine, id } = doyenBoard();
    deployDoyen(engine, id, key);
    assert.equal(zoneOf(engine, id(key)), "discard", "the discarded card is in its owner's discard pile");
    assert.equal(discardOf(engine, P1).includes(id(key)), true);
    assert.equal(zoneOf(engine, id("td")), "play");
    assert.equal(tokens(engine, id("td")), x, `enters play with X = ${x} tokens`);
    assert.equal(engine.getStat(id("td"), "strength"), x, "0 printed + 1 per token");
    assert.equal(engine.getStat(id("td"), "life"), x, "0 printed + 1 per token");
    assert.equal(engine.getStat(id("td"), "speed"), 3, "speed is not affected by tokens");
  });
}

clause(DOYEN, "0:ability", "discarding a cost-0 character: X is 0 — it is discarded and Doyen enters play with no tokens", () => {
  const { engine, id } = doyenBoard();
  deployDoyen(engine, id, "dChar0");
  assert.equal(zoneOf(engine, id("dChar0")), "discard");
  assert.equal(tokens(engine, id("td")), 0, "X = 0: no tokens");
});

clause(DOYEN, "0:ability", "only one card is discarded: the other character / item cards in hand stay", () => {
  const { engine, id } = doyenBoard();
  deployDoyen(engine, id, "dChar3");
  for (const key of ["dChar6", "dChar0", "dItem2", "dTactic", "dPlace", "dRes"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in hand`);
});

clause(DOYEN, "0:ability", "the discard must be a character or item from my hand: a tactic, a location, a resource, the opponent's card or a card elsewhere is refused", () => {
  const { engine, id } = doyenBoard();
  for (const key of ["dTactic", "dPlace", "dRes", "oppHand", "inPlay", "inDeck"]) {
    refused(() => deployDoyen(engine, id, key), `${key} cannot be the discard`);
  }
  assert.equal(zoneOf(engine, id("td")), "hand", "nothing was played");
  assert.equal(ready(engine), 6, "nothing was paid");
  for (const key of ["dTactic", "dPlace", "dRes"]) assert.equal(zoneOf(engine, id(key)), "hand");
  deployDoyen(engine, id, "dChar3"); // control: a character is accepted
  assert.equal(zoneOf(engine, id("td")), "play");
});

clause(DOYEN, "0:ability", "Doyen cannot discard ITSELF as its own cost (it is being played, not in my hand)", () => {
  const { engine, id } = doyenBoard();
  refused(() => deployDoyen(engine, id, "td"), "the card being played is not a card in my hand to discard");
  assert.equal(zoneOf(engine, id("td")), "hand", "nothing was played");
  assert.equal(ready(engine), 6, "nothing was paid");
});

clause(DOYEN, "0:ability", "exactly one card must be discarded: none or two are refused", () => {
  const { engine, id } = doyenBoard();
  refused(() => play(engine, P1, id("td"), { selected: { d: [] } }), "a discard is required");
  refused(() => play(engine, P1, id("td"), { selected: { d: [id("dChar3"), id("dChar6")] } }), "only one");
  assert.equal(zoneOf(engine, id("td")), "hand");
  assert.equal(zoneOf(engine, id("dChar3")), "hand");
  deployDoyen(engine, id, "dChar3"); // control: one card works
  assert.equal(zoneOf(engine, id("td")), "play");
});

clause(DOYEN, "0:ability", "with no character or item in hand it cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "td", def: printing(DOYEN), owner: P1, zone: "hand" },
      { key: "dTactic", def: tactic({ name: "DTactic", cost: 3 }), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1)
    ]
  });
  refused(() => play(engine, P1, id("td"), { selected: { d: [] } }));
  refused(() => play(engine, P1, id("td"), { selected: { d: [id("dTactic")] } }));
  assert.equal(zoneOf(engine, id("td")), "hand");
  const control = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "td", def: printing(DOYEN), owner: P1, zone: "hand" },
      { key: "dChar", def: character({ name: "DChar", cost: 3 }), owner: P1, zone: "hand" },
      ...bank("deception", 6, P1)
    ]
  });
  play(control.engine, P1, control.id("td"), { selected: { d: [control.id("dChar")] } }); // control: with a character in hand it works
  assert.equal(zoneOf(control.engine, control.id("td")), "play");
});

clause(DOYEN, "0:ability", "the discard is a cost: the card is discarded when Doyen is played, before the opponent can respond", () => {
  const { engine, id } = doyenBoard();
  playRaw(engine, P1, id("td"), { selected: { d: [id("dChar3")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("dChar3")), "discard", "already discarded");
  assert.equal(zoneOf(engine, id("td")), "deploying", "Doyen is not in play yet");
  resolvePendingResponses(engine);
  assert.equal(tokens(engine, id("td")), 3);
});

for (const tokenCount of [0, 1, 2, 5]) {
  clause(DOYEN, "2:rule", `with ${tokenCount} tokens on it Doyen has ${tokenCount} strength and ${tokenCount} life (printed 0 / 0); speed stays 3`, () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "td", def: printing(DOYEN), owner: P1, zone: "play", counters: tokenCount ? { token: tokenCount } : {} },
        { key: "other", def: character({ name: "Other", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play", counters: { token: 3 } }
      ]
    });
    assert.equal(engine.getStat(id("td"), "strength"), tokenCount);
    assert.equal(engine.getStat(id("td"), "life"), tokenCount);
    assert.equal(engine.getStat(id("td"), "speed"), 3);
    assert.equal(engine.getStat(id("other"), "strength"), 2, "another card's tokens give nothing to Doyen and Doyen's rule gives nothing to others");
    assert.equal(engine.getStat(id("other"), "life"), 4);
  });
}

clause(DOYEN, "2:rule", "the bonus follows the tokens: a Doyen that entered with 3 tokens is 3/3, and once it leaves play it is no longer in play", () => {
  const { engine, id } = doyenBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  deployDoyen(engine, id, "dChar3");
  assert.equal(engine.getStat(id("td"), "strength"), 3);
  assert.equal(engine.getStat(id("td"), "life"), 3);
  play(engine, P1, id("bounce"), { selected: { t: [id("td")] } });
  assert.equal(zoneOf(engine, id("td")), "hand");
});

clause(DOYEN, "1:rule", "tokens disappear when the card leaves play (CR 409.2): a bounced Doyen has no tokens", () => {
  const { engine, id } = doyenBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  deployDoyen(engine, id, "dChar3");
  assert.equal(tokens(engine, id("td")), 3);
  play(engine, P1, id("bounce"), { selected: { t: [id("td")] } });
  assert.equal(zoneOf(engine, id("td")), "hand");
  assert.equal(tokens(engine, id("td")), 0, "tokens disappear when the card leaves play");
});

clause(DOYEN, "1:rule", "a Doyen played again after leaving play enters with only its NEW X tokens (not the old ones plus the new)", () => {
  const { engine, id } = doyenBoard({ greed: 6, extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  deployDoyen(engine, id, "dChar3");
  play(engine, P1, id("bounce"), { selected: { t: [id("td")] } });
  deployDoyen(engine, id, "dItem2");
  assert.equal(tokens(engine, id("td")), 2, "the new X = 2 only, not 3 + 2");
  assert.equal(engine.getStat(id("td"), "strength"), 2);
  assert.equal(engine.getStat(id("td"), "life"), 2);
});

clause(DOYEN, "1:rule", "the tokens are put on it as it enters play — the damage-free 3/3 can take 2 damage and survive, the third destroys it", () => {
  const { engine, id } = doyenBoard({ extra: [{ key: "h2", def: hitTactic(2), owner: P1, zone: "hand" }, { key: "h1", def: hitTactic(1), owner: P1, zone: "hand" }] });
  deployDoyen(engine, id, "dChar3");
  play(engine, P1, id("h2"), { selected: { t: [id("td")] } });
  assert.equal(zoneOf(engine, id("td")), "play", "2 damage vs 3 life");
  play(engine, P1, id("h1"), { selected: { t: [id("td")] } });
  assert.equal(zoneOf(engine, id("td")), "discard", "3 damage vs 3 life");
});

// =============================================================================
// Tremor Engine
// Item, rogue, cost 2, threshold [D].
// "At the start of your turn, both players must put the top 2 cards of their deck into their discard pile."
// =============================================================================

const TREMOR = "37a2c6f2-a2aa-434c-92d3-0d5e7ab38cbc";

function tremorBoard(opts: { controller?: Pid; faceDown?: boolean; zone?: "play" | "hand" | "discard"; myDeck?: number; oppDeck?: number; second?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "te", def: printing(TREMOR), owner: P1, controller: opts.controller ?? P1, zone: opts.zone ?? "play", faceDown: opts.faceDown },
      ...(opts.second ? [{ key: "te2", def: printing(TREMOR), owner: P1, zone: "play" as const }] : []),
      ...fillers("a", opts.myDeck ?? 6, P1, "deck"),
      ...fillers("b", opts.oppDeck ?? 6, P2, "deck"),
      { key: "myOld", def: character({ name: "MyOld" }), owner: P1, zone: "discard" },
      { key: "oppOld", def: character({ name: "OppOld" }), owner: P2, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(TREMOR, "0:rule", "deploys for its printed cost of 2 and [D]", () => {
  deploysForPrintedCost(TREMOR);
});

clause(TREMOR, "0:rule", "at the start of MY turn both players put the top 2 cards of their own deck into their own discard pile", () => {
  const { engine, id } = tremorBoard();
  const myDeck = [...deckOf(engine, P1)];
  const oppDeck = [...deckOf(engine, P2)];
  assert.equal(discardOf(engine, P1).length, 1);
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(engine.state.activePlayerId, P1, "my turn has started");
  assert.deepEqual(deckOf(engine, P1), myDeck.slice(2), "my top 2 cards left my deck");
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(2), "their top 2 cards left their deck");
  assert.deepEqual(myDeck.slice(0, 2).map((cardId) => zoneOf(engine, cardId)), ["discard", "discard"]);
  assert.deepEqual(oppDeck.slice(0, 2).map((cardId) => zoneOf(engine, cardId)), ["discard", "discard"]);
  assert.equal(discardOf(engine, P1).includes(myDeck[0]) && discardOf(engine, P1).includes(myDeck[1]), true, "into MY discard pile");
  assert.equal(discardOf(engine, P2).includes(oppDeck[0]) && discardOf(engine, P2).includes(oppDeck[1]), true, "into THEIR discard pile");
  assert.equal(discardOf(engine, P1).length, 3, "mine: the old card plus 2");
  assert.equal(discardOf(engine, P2).length, 3, "theirs: the old card plus 2");
  assert.equal(zoneOf(engine, id("te")), "play", "the Engine stays in play");
});

clause(TREMOR, "0:rule", "it is 'must': it happens every one of my turns", () => {
  const { engine } = tremorBoard();
  const myDeck = [...deckOf(engine, P1)];
  endTurn(engine, P2);
  drain(engine, declineAll);
  endTurn(engine, P1);
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(engine.state.activePlayerId, P1);
  assert.deepEqual(deckOf(engine, P1), myDeck.slice(4), "4 cards milled over my two turn starts");
});

clause(TREMOR, "0:rule", "not at the start of the OPPONENT's turn", () => {
  const { engine } = tremorBoard();
  const myDeck = [...deckOf(engine, P1)];
  const oppDeck = [...deckOf(engine, P2)];
  endTurn(engine, P2);
  drain(engine, declineAll);
  endTurn(engine, P1); // the opponent's turn starts
  drain(engine, declineAll);
  assert.equal(engine.state.activePlayerId, P2);
  assert.deepEqual(deckOf(engine, P1), myDeck.slice(2), "only my own turn start milled");
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(2));
});

clause(TREMOR, "0:rule", "'your turn' is its CONTROLLER's: an Engine I own but the opponent controls mills at THEIR turn start only", () => {
  const { engine } = tremorBoard({ controller: P2 });
  const myDeck = [...deckOf(engine, P1)];
  const oppDeck = [...deckOf(engine, P2)];
  endTurn(engine, P2); // my turn starts
  drain(engine, declineAll);
  assert.deepEqual(deckOf(engine, P1), myDeck, "it is not my Engine to trigger: my turn start mills nothing");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  endTurn(engine, P1); // their turn starts
  drain(engine, declineAll);
  assert.deepEqual(deckOf(engine, P1), myDeck.slice(2), "at their turn start both decks are milled");
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(2));
});

clause(TREMOR, "0:rule", "a deck with only 1 card mills that card; an empty deck mills nothing — neither loses the game", () => {
  const one = tremorBoard({ myDeck: 1, oppDeck: 0 });
  endTurn(one.engine, P2);
  drain(one.engine, declineAll);
  assert.equal(deckOf(one.engine, P1).length, 0);
  assert.equal(zoneOf(one.engine, one.id("a0")), "discard");
  assert.equal(deckOf(one.engine, P2).length, 0);
  assert.equal(one.engine.state.winner, undefined);
});

clause(TREMOR, "0:rule", "two Engines each trigger: 4 cards from each deck", () => {
  const { engine } = tremorBoard({ second: true });
  const myDeck = [...deckOf(engine, P1)];
  const oppDeck = [...deckOf(engine, P2)];
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.deepEqual(deckOf(engine, P1), myDeck.slice(4));
  assert.deepEqual(deckOf(engine, P2), oppDeck.slice(4));
});

clause(TREMOR, "0:rule", "only while it is in play: not from my hand or discard pile, and not while face-down (a face-down card is only a resource)", () => {
  for (const board of [tremorBoard({ zone: "hand" }), tremorBoard({ zone: "discard" }), tremorBoard({ faceDown: true })]) {
    const myDeck = [...deckOf(board.engine, P1)];
    const oppDeck = [...deckOf(board.engine, P2)];
    endTurn(board.engine, P2);
    drain(board.engine, declineAll);
    assert.deepEqual(deckOf(board.engine, P1), myDeck);
    assert.deepEqual(deckOf(board.engine, P2), oppDeck);
  }
});

clause(TREMOR, "0:rule", "off once the Engine leaves play", () => {
  const bye = tactic({
    name: "DestroyItem",
    cost: 0,
    behavior: {
      abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
  const { engine, id } = tremorBoard({ extra: [{ key: "bye", def: bye, owner: P2, zone: "hand" }] });
  const myDeck = [...deckOf(engine, P1)];
  play(engine, P2, id("bye"), { selected: { t: [id("te")] } });
  assert.equal(zoneOf(engine, id("te")), "discard");
  const before = discardOf(engine, P1).length;
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.deepEqual(deckOf(engine, P1), myDeck, "nothing milled");
  assert.equal(discardOf(engine, P1).length, before);
});

// =============================================================================
// Vander Malagut
// Character, rogue, cost 9, threshold [D][D][D][D], 5/6/7 (strength / speed / life), sarcophyle.
// UNIQUE EVONDAN
// All your other "sarcophyle" characters gain 1 speed.
// If a character would be destroyed during a turn when this card damaged it, take
// control of that character instead. Treat that character as though it has received
// no damage this turn. It becomes a "sarcophyle".
// If this card is destroyed, destroy all other "sarcophyle" characters.
// =============================================================================

const VANDER = "c6149b35-2ff8-43f0-9b08-1162eb3b8352";

const sarc = (name: string, subtype: string[] = ["sarcophyle"], speed = 2) => character({ name, subtype, strength: 1, life: 3, speed });

function vanderBoard(opts: { turn?: number; active?: Pid; vanderFor?: Pid; extra?: CardPlacement[] } = {}) {
  const vanderFor = opts.vanderFor ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? vanderFor,
    cards: [
      { key: "vander", def: printing(VANDER), owner: vanderFor, zone: "play" },
      { key: "sarcAlly", def: sarc("SarcAlly"), owner: vanderFor, zone: "play" },
      { key: "sarcAlly2", def: sarc("SarcAlly2", ["sarcophyle", "soldier"]), owner: vanderFor, zone: "play" },
      { key: "plainAlly", def: character({ name: "PlainAlly", strength: 1, life: 3, speed: 2 }), owner: vanderFor, zone: "play" },
      { key: "sarcFoe", def: sarc("SarcFoe"), owner: other(vanderFor), zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: other(vanderFor), zone: "play" },
      { key: "bigFoe", def: character({ name: "BigFoe", strength: 1, life: 9, speed: 2 }), owner: other(vanderFor), zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem", subtype: ["sarcophyle"] }), owner: other(vanderFor), zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(VANDER, "0:unique", "deploys for its printed cost of 9 and [D][D][D][D], and has its printed stats", () => {
  deploysForPrintedCost(VANDER);
  hasPrintedStats(VANDER);
});

clause(VANDER, "0:unique", "a second Vander forces a choice of which to keep; the one not kept is destroyed — and its 'if this card is destroyed' rule then destroys the survivor too (a sarcophyle character)", () => {
  for (const keep of ["v1", "v2"] as const) {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "v1", def: printing(VANDER), owner: P1, zone: "play" },
        { key: "v2", def: printing(VANDER), owner: P1, zone: "hand" },
        ...bank("deception", 9, P1)
      ]
    });
    play(engine, P1, id("v2"));
    const pc = pending(engine);
    assert.equal(pc?.kind, "uniqueSurvivor");
    assert.equal(pc?.playerId, P1, "the controller chooses");
    assert.deepEqual([...(pc?.candidates as string[])].sort(), [id("v1"), id("v2")].sort());
    keepUnique(engine, P1, id(keep));
    const dropped = keep === "v1" ? "v2" : "v1";
    assert.equal(zoneOf(engine, id(dropped)), "discard", "the copy that was not kept is destroyed");
    // E11b: test corrected because the user's Q53 follow-up ruling says a NEW copy removed by UNIQUE never entered play, so
    // its "if this card is destroyed" rule does not fire: keeping the old Vander (v1) leaves it in play. Removing the OLD copy
    // (keep v2) is a normal destruction, so its death rule still destroys the kept new Vander.
    assert.equal(
      zoneOf(engine, id(keep)),
      keep === "v1" ? "play" : "discard",
      keep === "v1"
        ? "...the new copy never entered play, so its death rule does not destroy the kept old Vander"
        : "...and the old copy's death rule destroys the other sarcophyle character, the kept Vander"
    );
  }
});

clause(VANDER, "0:unique", "the opponent may control their own Vander Malagut: no choice, no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "v1", def: printing(VANDER), owner: P1, zone: "play" },
      { key: "v2", def: printing(VANDER), owner: P2, zone: "hand" },
      ...bank("deception", 9, P2)
    ]
  });
  play(engine, P2, id("v2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("v1")), "play");
  assert.equal(zoneOf(engine, id("v2")), "play");
});

clause(VANDER, "1:rule", "my other sarcophyle characters gain 1 speed (a sarcophyle among several subtypes too)", () => {
  const { engine, id } = vanderBoard();
  assert.equal(speed(engine, id("sarcAlly")), 3, "2 + 1");
  assert.equal(speed(engine, id("sarcAlly2")), 3, "2 + 1 (subtypes sarcophyle + soldier)");
});

clause(VANDER, "1:rule", "...but not Vander itself ('other'), my non-sarcophyle characters, or the opponent's sarcophyles", () => {
  const { engine, id } = vanderBoard();
  assert.equal(speed(engine, id("vander")), 6, "Vander's own speed is its printed 6");
  assert.equal(speed(engine, id("plainAlly")), 2, "a non-sarcophyle character of mine");
  assert.equal(speed(engine, id("sarcFoe")), 2, "the opponent's sarcophyle");
  assert.equal(speed(engine, id("foe")), 2);
});

clause(VANDER, "1:rule", "it is the CONTROLLER's sarcophyles that gain speed: an opposing Vander boosts the opponent's sarcophyles instead", () => {
  const { engine, id } = vanderBoard({ vanderFor: P2 });
  assert.equal(speed(engine, id("sarcAlly")), 3, "the Vander controller's sarcophyle");
  assert.equal(speed(engine, id("sarcFoe")), 2, "the other player's sarcophyle");
});

clause(VANDER, "1:rule", "the bonus ends when Vander leaves play", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  assert.equal(speed(engine, id("sarcAlly")), 3);
  play(engine, P1, id("bounce"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "hand");
  assert.equal(speed(engine, id("sarcAlly")), 2, "the +1 is gone with Vander");
  assert.equal(speed(engine, id("sarcAlly2")), 2);
});

clause(VANDER, "1:rule", "a sarcophyle character that comes into play later gets the bonus too", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "newSarc", def: sarc("NewSarc", ["sarcophyle"], 4), owner: P1, zone: "hand" }] });
  play(engine, P1, id("newSarc"));
  assert.equal(speed(engine, id("newSarc")), 5, "4 + 1");
});

// --- the take-control replacement ------------------------------------------

clause(VANDER, "2:rule", "a character whose lethal damage comes from Vander in battle is not destroyed: I take control of it, undamaged, as a sarcophyle", () => {
  const { engine, id } = vanderBoard();
  fight(engine, P1, [id("vander")], { type: "faction", playerId: P2 }, [id("foe")]);
  assert.equal(battleOf(engine), undefined, "the battle is over");
  assert.equal(zoneOf(engine, id("foe")), "play", "not destroyed");
  assert.equal(discardOf(engine, P2).includes(id("foe")), false, "not in its owner's discard pile");
  assert.equal(controllerOf(engine, id("foe")), P1, "I control it now");
  assert.equal(ownerOf(engine, id("foe")), P2, "it is still the opponent's card");
  assert.equal(engine.state.players[P1].play.includes(id("foe")), true);
  assert.equal(engine.state.players[P2].play.includes(id("foe")), false);
  assert.equal(damageOf(engine, id("foe")), 0, "treated as though it has received no damage this turn");
  assert.equal(engine.getSubtypes(id("foe")).includes("sarcophyle"), true, "it becomes a sarcophyle");
  assert.equal(speed(engine, id("foe")), 3, "as my sarcophyle it now gets Vander's +1 speed (2 + 1)");
  assert.equal(damageOf(engine, id("vander")), 0, "Vander took no damage: the blocker was taken before it could strike");
});

clause(VANDER, "2:rule", "the taken character did not die: its own 'when destroyed' trigger does not fire", () => {
  const dying = character({
    name: "Dying",
    strength: 1,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [{ id: "last", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });
  const { engine, id } = vanderBoard({ extra: [{ key: "dying", def: dying, owner: P2, zone: "play" }, ...fillers("a", 3, P1, "deck"), ...fillers("b", 3, P2, "deck")] });
  const mine = handOf(engine, P1).length;
  const theirs = handOf(engine, P2).length;
  fight(engine, P1, [id("vander")], { type: "faction", playerId: P2 }, [id("dying")]);
  assert.equal(controllerOf(engine, id("dying")), P1);
  assert.equal(handOf(engine, P1).length, mine, "no destruction, no draw for me");
  assert.equal(handOf(engine, P2).length, theirs, "no destruction, no draw for the opponent");
});

clause(VANDER, "2:rule", "'during a turn when this card damaged it': damage from Vander earlier in the turn is enough — a later destruction by another effect is replaced too", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  fight(engine, P1, [id("vander")], { type: "faction", playerId: P2 }, [id("bigFoe")]);
  assert.equal(damageOf(engine, id("bigFoe")), 5, "Vander damaged it (5 of its 9 life)");
  assert.equal(zoneOf(engine, id("bigFoe")), "play");
  play(engine, P1, id("kill"), { selected: { t: [id("bigFoe")] } });
  assert.equal(zoneOf(engine, id("bigFoe")), "play", "the destruction was replaced");
  assert.equal(controllerOf(engine, id("bigFoe")), P1);
  assert.equal(damageOf(engine, id("bigFoe")), 0);
  assert.equal(engine.getSubtypes(id("bigFoe")).includes("sarcophyle"), true);
});

clause(VANDER, "2:rule", "a character Vander did NOT damage this turn is destroyed normally (other damage does not count)", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }, { key: "hit", def: hitTactic(1), owner: P1, zone: "hand" }] });
  play(engine, P1, id("hit"), { selected: { t: [id("foe")] } });
  assert.equal(damageOf(engine, id("foe")), 1, "damaged, but not by Vander");
  play(engine, P1, id("kill"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard", "destroyed as usual");
  assert.equal(discardOf(engine, P2).includes(id("foe")), true);
});

clause(VANDER, "2:rule", "...and so is a character Vander damaged on an EARLIER turn (it is a rule about a turn when Vander damaged it)", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  fight(engine, P1, [id("vander")], { type: "faction", playerId: P2 }, [id("bigFoe")]);
  assert.equal(damageOf(engine, id("bigFoe")), 5);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(damageOf(engine, id("bigFoe")), 0, "the damage cleared at the start of the turn");
  play(engine, P1, id("kill"), { selected: { t: [id("bigFoe")] } });
  assert.equal(zoneOf(engine, id("bigFoe")), "discard", "no longer 'a turn when this card damaged it'");
});

clause(VANDER, "2:rule", "if Vander has left play the replacement is gone: a character it damaged is destroyed normally", () => {
  const { engine, id } = vanderBoard({
    extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }, { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]
  });
  fight(engine, P1, [id("vander")], { type: "faction", playerId: P2 }, [id("bigFoe")]);
  play(engine, P1, id("bounce"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "hand");
  play(engine, P1, id("kill"), { selected: { t: [id("bigFoe")] } });
  assert.equal(zoneOf(engine, id("bigFoe")), "discard");
});

clause(VANDER, "2:rule", "only characters are taken: a location Vander destroys is destroyed normally", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "place", def: location({ name: "Place", structure: 2 }), owner: P2, zone: "play" }] });
  declareAttackBy(engine, P1, [id("vander")], { type: "card", cardId: id("place") });
  declareBlockersBy(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("place")), "discard");
  assert.equal(controllerOf(engine, id("place")), P2);
});

clause(VANDER, "2:rule", "it works for whoever controls Vander: the opponent's Vander takes MY blocker", () => {
  const { engine, id } = vanderBoard({ vanderFor: P2, active: P2, extra: [{ key: "myBlocker", def: character({ name: "MyBlocker", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" }] });
  fight(engine, P2, [id("vander")], { type: "faction", playerId: P1 }, [id("myBlocker")]);
  assert.equal(controllerOf(engine, id("myBlocker")), P2, "the Vander controller took it");
  assert.equal(zoneOf(engine, id("myBlocker")), "play");
  assert.equal(ownerOf(engine, id("myBlocker")), P1);
});

clause(VANDER, "2:rule", "a character that survives Vander's damage is simply damaged: nothing is taken", () => {
  const { engine, id } = vanderBoard();
  fight(engine, P1, [id("vander")], { type: "faction", playerId: P2 }, [id("bigFoe")]);
  assert.equal(controllerOf(engine, id("bigFoe")), P2);
  assert.equal(damageOf(engine, id("bigFoe")), 5);
  assert.equal(engine.getSubtypes(id("bigFoe")).includes("sarcophyle"), false);
});

// --- the death trigger -----------------------------------------------------

clause(VANDER, "3:rule", "when Vander is destroyed every other sarcophyle character is destroyed — mine and the opponent's; other characters live", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "discard");
  for (const key of ["sarcAlly", "sarcAlly2", "sarcFoe"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key} is destroyed`);
  for (const key of ["plainAlly", "foe", "bigFoe"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} is not a sarcophyle and survives`);
  assert.equal(zoneOf(engine, id("foeItem")), "play", "only 'characters': a sarcophyle item survives");
  assert.equal(discardOf(engine, P2).includes(id("sarcFoe")), true, "into its owner's discard pile");
});

clause(VANDER, "3:rule", "destroyed by damage counts as destroyed", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "hit", def: hitTactic(7), owner: P1, zone: "hand" }] });
  play(engine, P1, id("hit"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "discard", "7 damage vs 7 life");
  for (const key of ["sarcAlly", "sarcAlly2", "sarcFoe"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key} is destroyed`);
  assert.equal(zoneOf(engine, id("plainAlly")), "play");
});

clause(VANDER, "3:rule", "a sarcophyle I took with Vander's replacement is destroyed too when Vander is destroyed", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  fight(engine, P1, [id("vander")], { type: "faction", playerId: P2 }, [id("foe")]);
  assert.equal(controllerOf(engine, id("foe")), P1);
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard", "it is a sarcophyle character: destroyed");
});

clause(VANDER, "3:rule", "only when it is DESTROYED: if Vander is returned to hand the other sarcophyles live", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "hand");
  for (const key of ["sarcAlly", "sarcAlly2", "sarcFoe"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} survives`);
});

clause(VANDER, "3:rule", "the trigger is Vander's own: another sarcophyle being destroyed does not destroy the rest", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("sarcAlly")] } });
  assert.equal(zoneOf(engine, id("sarcAlly")), "discard");
  assert.equal(zoneOf(engine, id("sarcAlly2")), "play");
  assert.equal(zoneOf(engine, id("sarcFoe")), "play");
  assert.equal(zoneOf(engine, id("vander")), "play");
});

// =============================================================================
// Warehouse Raid
// Tactic, rogue, cost 3, threshold [D].
// COST: Flip a coin. If you win X is 2, otherwise X is 1.
// EFFECT: Your opponent must discard X cards at random. Put any items discarded
// this way into play under your control.
// =============================================================================

const RAID = "85c0b848-9bca-4d6a-89e7-f43e39e22c84";

// A constant random source: 0 wins the coin flip, 0.99 loses it (the engine flips with `random() < 0.5`).
const WIN = () => 0;
const LOSE = () => 0.99;

function oppHandOf(kinds: Array<"character" | "item" | "tactic" | "location" | "resource">): CardDefinition[] {
  return kinds.map((kind, i) => {
    const name = `H${i}${kind}`;
    switch (kind) {
      case "character":
        return character({ name });
      case "item":
        return item({ name });
      case "tactic":
        return tactic({ name });
      case "location":
        return location({ name });
      case "resource":
        return resourceCard({ name });
    }
  });
}

function raidBoard(opts: { random?: () => number; hand?: Array<"character" | "item" | "tactic" | "location" | "resource">; deception?: number; greed?: number; active?: Pid; extra?: CardPlacement[]; seed?: number } = {}) {
  const board = buildGame({
    random: opts.random ?? mulberry(opts.seed ?? 777),
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active,
    cards: [
      { key: "wr", def: printing(RAID), owner: P1, zone: "hand" },
      { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
      ...oppHandOf(opts.hand ?? ["character", "character", "character", "character"]).map((def, i) => ({ key: `h${i}`, def, owner: P2, zone: "hand" as const })),
      ...fillers("a", 2, P1, "deck"),
      ...fillers("b", 2, P2, "deck"),
      { key: "oppOld", def: character({ name: "OppOld" }), owner: P2, zone: "discard" },
      ...bank("deception", opts.deception ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
  return board;
}

clause(RAID, "0:ability", "coin WON: X is 2 — pays 3 and the opponent discards exactly 2 cards from their hand (into their discard pile)", () => {
  const { engine, id } = raidBoard({ random: WIN });
  const before = ready(engine);
  const hand = [...handOf(engine, P2)];
  const myHand = [...handOf(engine, P1)];
  play(engine, P1, id("wr"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(handOf(engine, P2).length, hand.length - 2, "exactly 2 cards were discarded");
  const gone = hand.filter((cardId) => !handOf(engine, P2).includes(cardId));
  assert.equal(gone.length, 2);
  for (const cardId of gone) assert.equal(discardOf(engine, P2).includes(cardId), true, "into the OPPONENT's discard pile");
  assert.deepEqual(handOf(engine, P1), myHand.filter((cardId) => cardId !== id("wr")), "my hand is untouched (apart from the tactic)");
  assert.equal(zoneOf(engine, id("wr")), "discard");
  assert.equal(deckOf(engine, P2).length, 2, "their deck is untouched");
});

clause(RAID, "0:ability", "coin LOST: X is 1 — the opponent discards exactly 1 card", () => {
  const { engine, id } = raidBoard({ random: LOSE });
  const hand = [...handOf(engine, P2)];
  play(engine, P1, id("wr"));
  assert.equal(handOf(engine, P2).length, hand.length - 1, "exactly 1 card was discarded");
  const gone = hand.filter((cardId) => !handOf(engine, P2).includes(cardId));
  assert.equal(discardOf(engine, P2).includes(gone[0]), true);
});

clause(RAID, "0:ability", "the coin really is fair and the cards really are random: over many games both X=1 and X=2 happen and different cards go", () => {
  const counts = new Set<number>();
  const firstDiscards = new Set<string>();
  for (let seed = 1; seed <= 48; seed++) {
    const { engine, id } = raidBoard({ seed: seed * 7919 + 13 });
    const hand = [...handOf(engine, P2)];
    play(engine, P1, id("wr"));
    const gone = hand.filter((cardId) => !handOf(engine, P2).includes(cardId));
    counts.add(gone.length);
    if (gone.length === 1) firstDiscards.add(gone[0]);
  }
  assert.deepEqual([...counts].sort(), [1, 2], "winning and losing the flip both occur, giving X = 2 and X = 1");
  assert.ok(firstDiscards.size >= 3, `with X=1 the discarded card varies (${firstDiscards.size} different cards of 4)`);
});

clause(RAID, "0:ability", "a coin flip is recorded for the player who played it", () => {
  const { engine, id } = raidBoard({ random: WIN });
  play(engine, P1, id("wr"));
  const flips = eventsOf(engine, "coinFlipped");
  assert.equal(flips.length, 1, "exactly one coin is flipped");
  assert.equal(flips[0].playerId, P1, "by me");
  assert.equal(flips[0].won, true);
  const lost = raidBoard({ random: LOSE });
  play(lost.engine, P1, lost.id("wr"));
  assert.equal(eventsOf(lost.engine, "coinFlipped")[0].won, false);
});

clause(RAID, "0:ability", "the coin is flipped as a COST: when the tactic is played, before the opponent can respond", () => {
  const { engine, id } = raidBoard({ random: WIN });
  const hand = [...handOf(engine, P2)];
  playRaw(engine, P1, id("wr"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(eventsOf(engine, "coinFlipped").length, 1, "the coin has already been flipped (it is in the cost section)");
  assert.deepEqual(handOf(engine, P2), hand, "...but nothing is discarded until the effect resolves");
});

clause(RAID, "0:ability", "items discarded this way go into play under MY control (and not into the opponent's discard pile)", () => {
  const { engine, id } = raidBoard({ random: WIN, hand: ["item", "item"] });
  play(engine, P1, id("wr"));
  for (const key of ["h0", "h1"]) {
    assert.equal(zoneOf(engine, id(key)), "play", `${key} (an item) is in play`);
    assert.equal(controllerOf(engine, id(key)), P1, "under my control");
    assert.equal(ownerOf(engine, id(key)), P2, "still the opponent's card");
    assert.equal(engine.state.players[P1].play.includes(id(key)), true);
    assert.equal(discardOf(engine, P2).includes(id(key)), false);
  }
  assert.equal(handOf(engine, P2).length, 0);
});

clause(RAID, "0:ability", "with X=1 only one item is taken, the other stays in their hand", () => {
  const { engine, id } = raidBoard({ random: LOSE, hand: ["item", "item"] });
  play(engine, P1, id("wr"));
  const inPlay = ["h0", "h1"].filter((key) => zoneOf(engine, id(key)) === "play");
  assert.equal(inPlay.length, 1, "exactly one item entered play");
  assert.equal(handOf(engine, P2).length, 1, "the other item is still in their hand");
});

clause(RAID, "0:ability", "only ITEMS are taken: other discarded cards (character, tactic, location, resource) go to the opponent's discard pile", () => {
  for (const kind of ["character", "tactic", "location", "resource"] as const) {
    const { engine, id } = raidBoard({ random: WIN, hand: [kind, kind] });
    play(engine, P1, id("wr"));
    for (const key of ["h0", "h1"]) {
      assert.equal(zoneOf(engine, id(key)), "discard", `${kind}: ${key} is discarded`);
      assert.equal(discardOf(engine, P2).includes(id(key)), true);
    }
  }
});

clause(RAID, "0:ability", "a mixed hand: with X=2 the item is taken and the character discarded", () => {
  const { engine, id } = raidBoard({ random: WIN, hand: ["item", "character"] });
  play(engine, P1, id("wr"));
  assert.equal(zoneOf(engine, id("h0")), "play");
  assert.equal(controllerOf(engine, id("h0")), P1);
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.equal(handOf(engine, P2).length, 0);
});

clause(RAID, "0:ability", "the opponent has fewer cards than X: they discard what they have and the rest of the effect is skipped", () => {
  const one = raidBoard({ random: WIN, hand: ["character"] });
  play(one.engine, P1, one.id("wr"));
  assert.equal(zoneOf(one.engine, one.id("h0")), "discard");
  assert.equal(handOf(one.engine, P2).length, 0);

  const none = raidBoard({ random: WIN, hand: [] });
  play(none.engine, P1, none.id("wr"));
  assert.equal(zoneOf(none.engine, none.id("wr")), "discard", "with an empty hand nothing happens, and nothing breaks");
  assert.equal(none.engine.state.pendingChoice, undefined);
});

clause(RAID, "0:ability", "it is the OPPONENT's hand: my own hand and both decks are untouched", () => {
  const { engine, id } = raidBoard({ random: WIN });
  const myDeck = [...deckOf(engine, P1)];
  const oppDeck = [...deckOf(engine, P2)];
  play(engine, P1, id("wr"));
  assert.equal(zoneOf(engine, id("myHand")), "hand");
  assert.deepEqual(deckOf(engine, P1), myDeck);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(RAID, "0:ability", "the cards are discarded at resolution: while the opponent can still respond their hand is intact", () => {
  const { engine, id } = raidBoard({ random: WIN });
  const hand = [...handOf(engine, P2)];
  playRaw(engine, P1, id("wr"));
  assert.deepEqual(handOf(engine, P2), hand, "nothing discarded yet");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P2).length, hand.length - 2);
});

clause(RAID, "0:ability", "is refused one resource short of 3, and allowed with exactly 3", () => {
  const short = raidBoard({ deception: 2, random: WIN });
  refused(() => playRaw(short.engine, P1, short.id("wr")));
  assert.equal(zoneOf(short.engine, short.id("wr")), "hand");
  assert.equal(handOf(short.engine, P2).length, 4);
  assert.equal(eventsOf(short.engine, "coinFlipped").length, 0, "no coin is flipped for a play that was refused");

  const exact = raidBoard({ deception: 3, random: WIN });
  assert.equal(exact.engine.getCardPlayability(P1, exact.id("wr")).playable, true);
  play(exact.engine, P1, exact.id("wr"));
  assert.equal(handOf(exact.engine, P2).length, 2);
});

clause(RAID, "0:ability", "is refused without [D] even with plenty of other resources; one [D] among them is enough", () => {
  const none = raidBoard({ deception: 0, greed: 6, random: WIN });
  refused(() => playRaw(none.engine, P1, none.id("wr")));
  assert.equal(none.engine.getCardPlayability(P1, none.id("wr")).playable, false);

  const one = raidBoard({ deception: 1, greed: 2, random: WIN });
  play(one.engine, P1, one.id("wr"));
  assert.equal(handOf(one.engine, P2).length, 2);
});

clause(RAID, "0:ability", "as a tactic it may be played in response on the opponent's turn", () => {
  const { engine, id } = raidBoard({
    active: P2,
    random: WIN,
    extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }]
  });
  refused(() => playRaw(engine, P1, id("wr")), "nothing to respond to yet");
  openDefenderWindow(engine, [id("atk")]);
  playRaw(engine, P1, id("wr"));
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P2).length, 2);
});

// =============================================================================
// Bask Bomb
// Tactic, warlord, cost 0, threshold [R][R][R].
// COST: Play this only when you are attacking and your opponent is blocking. Destroy
// an attacking character you control. X is twice that character's strength. Y is
// that character's strength.
// EFFECT: Inflict X damage divided however you want to the blocking party. Inflict Y
// damage divided however your opponent wants to the attacking party.
// =============================================================================

const BASK_BOMB = "a67ac7f3-66f3-4c84-ab2a-761c577fe776";

function bombBoard(opts: { rage?: number; aStrength?: number; blockerLife?: number; extra?: CardPlacement[]; party?: string[]; blockers?: string[] } = {}) {
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "bb", def: printing(BASK_BOMB), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", strength: opts.aStrength ?? 3, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 2, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: opts.blockerLife ?? 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: opts.blockerLife ?? 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "b3", def: character({ name: "B3", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
  declareAttackBy(board.engine, P1, (opts.party ?? ["a1", "a2"]).map(board.id));
  declareBlockersBy(board.engine, P2, (opts.blockers ?? ["b1", "b2"]).map(board.id));
  return board;
}

/** Plays Bask Bomb inside the open battle window (sacrificing `c`, picking the blocking party `bl` and attacking party `at`) and lets it resolve up to the first pick. */
function bomb(engine: SpoilsEngine, id: (key: string) => CardInstanceId, c: string, bl: string[] = ["b1", "b2"], at: string[] = ["a1", "a2"]) {
  playRaw(engine, P1, id("bb"), { selected: { c: [id(c)], bl: bl.map(id), at: at.map(id) } });
  settleStack(engine);
}

/** Answers the open `distributeAmong` choice with `shares`, WITHOUT draining the window. */
function distributeRaw(engine: SpoilsEngine, player: Pid, shares: Record<CardInstanceId, number>): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "distributeAmong", shares } } as never);
}

clause(BASK_BOMB, "0:ability", "destroys the sacrificed attacker; X (twice its strength) is divided by me over the blocking party, Y (its strength) by the opponent over the attacking party", () => {
  const { engine, id } = bombBoard();
  const before = ready(engine);
  bomb(engine, id, "a1");
  const first = pending(engine);
  assert.equal(first?.kind, "distributeAmong");
  assert.equal(first?.playerId, P1, "I divide the X damage");
  assert.equal(first?.amount, 6, "X = twice A1's strength of 3");
  assert.deepEqual([...(first?.targets as string[])].sort(), [id("b1"), id("b2")].sort(), "among the blocking party");
  distributeRaw(engine, P1, { [id("b1")]: 4, [id("b2")]: 2 });

  const second = pending(engine);
  assert.equal(second?.kind, "distributeAmong");
  assert.equal(second?.playerId, P2, "my OPPONENT divides the Y damage");
  assert.equal(second?.amount, 3, "Y = A1's strength of 3");
  distributeRaw(engine, P2, { [id("a2")]: 3 });

  assert.equal(zoneOf(engine, id("a1")), "discard", "the sacrificed attacker is destroyed");
  assert.equal(discardOf(engine, P1).includes(id("a1")), true);
  assert.equal(damageOf(engine, id("b1")), 4);
  assert.equal(damageOf(engine, id("b2")), 2);
  assert.equal(damageOf(engine, id("a2")), 3);
  assert.equal(damageOf(engine, id("b3")), 0, "a character not in the blocking party is untouched");
  assert.equal(before - ready(engine), 0, "its numeric cost is 0: no resources are spent");
  assert.equal(zoneOf(engine, id("bb")), "discard");
});

clause(BASK_BOMB, "0:ability", "destroying the attacker is a COST: it is gone as soon as the tactic is played, before the opponent can respond", () => {
  const { engine, id } = bombBoard();
  playRaw(engine, P1, id("bb"), { selected: { c: [id("a1")], bl: [id("b1"), id("b2")], at: [id("a1"), id("a2")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("a1")), "discard", "the attacker is already destroyed (it is part of the cost)");
});

clause(BASK_BOMB, "0:ability", "the attacking party the opponent divides Y over no longer contains the destroyed attacker", () => {
  const { engine, id } = bombBoard();
  bomb(engine, id, "a1");
  distributeRaw(engine, P1, { [id("b1")]: 3, [id("b2")]: 3 });
  const second = pending(engine);
  assert.equal(second?.kind, "distributeAmong");
  assert.deepEqual(second?.targets, [id("a2")], "only A2 is left in the attacking party to take the damage");
  refused(() => distributeRaw(engine, P2, { [id("a1")]: 3 }), "the opponent cannot dump the damage on the card that was destroyed as the cost");
});

clause(BASK_BOMB, "0:ability", "X and Y use the sacrificed character's CURRENT strength (a +2 pump makes X=10, Y=5)", () => {
  const { engine, id } = bombBoard({ extra: [{ key: "pump", def: pumpTactic(2), owner: P1, zone: "hand" }] });
  respond(engine, id("pump"), { t: [id("a1")] });
  assert.equal(engine.getStat(id("a1"), "strength"), 5);
  bomb(engine, id, "a1");
  assert.equal(pending(engine)?.amount, 10, "X = 2 x 5");
  distributeRaw(engine, P1, { [id("b1")]: 10 });
  assert.equal(pending(engine)?.amount, 5, "Y = 5");
  distributeRaw(engine, P2, { [id("a2")]: 5 });
  assert.equal(zoneOf(engine, id("b1")), "discard", "10 damage destroyed the 9-life blocker");
});

clause(BASK_BOMB, "0:ability", "X damage that is lethal destroys the blockers it is assigned to", () => {
  const { engine, id } = bombBoard({ blockerLife: 3 });
  bomb(engine, id, "a1");
  distributeRaw(engine, P1, { [id("b1")]: 3, [id("b2")]: 3 });
  distributeRaw(engine, P2, { [id("a2")]: 3 });
  assert.equal(zoneOf(engine, id("b1")), "discard");
  assert.equal(zoneOf(engine, id("b2")), "discard");
  assert.equal(zoneOf(engine, id("b3")), "play");
});

clause(BASK_BOMB, "0:ability", "I may put all of X on one blocker, leaving the other undamaged", () => {
  const { engine, id } = bombBoard();
  bomb(engine, id, "a1");
  distributeRaw(engine, P1, { [id("b2")]: 6 });
  distributeRaw(engine, P2, { [id("a2")]: 3 });
  assert.equal(damageOf(engine, id("b1")), 0);
  assert.equal(damageOf(engine, id("b2")), 6);
  assert.equal(zoneOf(engine, id("b2")), "play", "6 damage on a 9-life blocker leaves it alive");
});

clause(BASK_BOMB, "0:ability", "the X damage may not exceed X and may go only to blocking-party members", () => {
  const tooMuch = bombBoard();
  bomb(tooMuch.engine, tooMuch.id, "a1");
  refused(() => distributeRaw(tooMuch.engine, P1, { [tooMuch.id("b1")]: 7 }), "7 is more than X = 6");
  const wrongTarget = bombBoard();
  bomb(wrongTarget.engine, wrongTarget.id, "a1");
  refused(() => distributeRaw(wrongTarget.engine, P1, { [wrongTarget.id("b3")]: 6 }), "B3 is not in the blocking party");
  const ownTarget = bombBoard();
  bomb(ownTarget.engine, ownTarget.id, "a1");
  refused(() => distributeRaw(ownTarget.engine, P1, { [ownTarget.id("a2")]: 6 }), "my own attacker is not in the blocking party");
  const control = bombBoard();
  bomb(control.engine, control.id, "a1");
  distributeRaw(control.engine, P1, { [control.id("b1")]: 6 });
  assert.equal(pending(control.engine)?.playerId, P2, "control: exactly X is accepted");
});

clause(BASK_BOMB, "0:ability", "all X damage must be inflicted: dividing only 5 of the 6 is refused", () => {
  const { engine, id } = bombBoard();
  bomb(engine, id, "a1");
  refused(() => distributeRaw(engine, P1, { [id("b1")]: 5 }), "5 is not X = 6: 'Inflict X damage' means all of it");
});

clause(BASK_BOMB, "0:ability", "the Y damage may not exceed Y and may go only to the attacking party", () => {
  const outsider = bombBoard();
  bomb(outsider.engine, outsider.id, "a1");
  distributeRaw(outsider.engine, P1, { [outsider.id("b1")]: 6 });
  refused(() => distributeRaw(outsider.engine, P2, { [outsider.id("a3")]: 3 }), "A3 is not in the attacking party");
  const blockerTarget = bombBoard();
  bomb(blockerTarget.engine, blockerTarget.id, "a1");
  distributeRaw(blockerTarget.engine, P1, { [blockerTarget.id("b1")]: 6 });
  refused(() => distributeRaw(blockerTarget.engine, P2, { [blockerTarget.id("b2")]: 3 }), "the opponent's own blockers are not the attacking party");
  const tooMuch = bombBoard();
  bomb(tooMuch.engine, tooMuch.id, "a1");
  distributeRaw(tooMuch.engine, P1, { [tooMuch.id("b1")]: 6 });
  refused(() => distributeRaw(tooMuch.engine, P2, { [tooMuch.id("a2")]: 4 }), "4 is more than Y = 3");
});

clause(BASK_BOMB, "0:ability", "all Y damage must be inflicted: my opponent may not decline to divide any of it (0 of the 3 is refused)", () => {
  const { engine, id } = bombBoard();
  bomb(engine, id, "a1");
  distributeRaw(engine, P1, { [id("b1")]: 6 });
  refused(() => distributeRaw(engine, P2, {}), "'Inflict Y damage divided however your opponent wants' has to be inflicted");
});

clause(BASK_BOMB, "0:ability", "with a larger attacking party the opponent may split Y between the survivors", () => {
  const { engine, id } = bombBoard({ party: ["a1", "a2", "a3"] });
  bomb(engine, id, "a1", ["b1", "b2"], ["a1", "a2", "a3"]);
  distributeRaw(engine, P1, { [id("b1")]: 3, [id("b2")]: 3 });
  const second = pending(engine);
  assert.equal(second?.amount, 3);
  distributeRaw(engine, P2, { [id("a2")]: 2, [id("a3")]: 1 });
  assert.equal(damageOf(engine, id("a2")), 2);
  assert.equal(damageOf(engine, id("a3")), 1);
});

clause(BASK_BOMB, "0:ability", "a sacrificed attacker with 0 strength gives X = 0 and Y = 0: nothing is dealt and nothing gets stuck", () => {
  const { engine, id } = bombBoard({ aStrength: 0 });
  bomb(engine, id, "a1");
  drain(engine, (pc) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: {} } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("a1")), "discard", "still destroyed (the cost)");
  assert.equal(damageOf(engine, id("b1")), 0);
  assert.equal(damageOf(engine, id("b2")), 0);
  assert.equal(damageOf(engine, id("a2")), 0);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(BASK_BOMB, "0:ability", "a lone attacker may sacrifice itself: the blockers still take X (and no one is left to take Y)", () => {
  const { engine, id } = bombBoard({ party: ["a1"], blockers: ["b1"] });
  playRaw(engine, P1, id("bb"), { selected: { c: [id("a1")], bl: [id("b1")], at: [id("a1")] } });
  settleStack(engine);
  distributeRaw(engine, P1, { [id("b1")]: 6 });
  drain(engine, (pc) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [(pc.targets as string[])[0]]: pc.amount as number } } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("a1")), "discard");
  assert.equal(damageOf(engine, id("b1")), 6);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(BASK_BOMB, "0:ability", "the character to destroy must be an attacking character I control: not one that stays home, not an opposing character", () => {
  const stayHome = bombBoard();
  refused(() => bomb(stayHome.engine, stayHome.id, "a3"), "A3 is not attacking");
  assert.equal(zoneOf(stayHome.engine, stayHome.id("a3")), "play");
  const blocker = bombBoard();
  refused(() => bomb(blocker.engine, blocker.id, "b1"), "a blocker is not an attacking character I control");
  assert.equal(zoneOf(blocker.engine, blocker.id("b1")), "play");
  const control = bombBoard();
  bomb(control.engine, control.id, "a2"); // either attacker may be the sacrifice
  assert.equal(pending(control.engine)?.amount, 4, "A2 has strength 2, so X = 4");
});

clause(BASK_BOMB, "0:ability", "only when I am attacking and the opponent is blocking: refused with no blockers declared, before blocking, as the defender and outside a battle", () => {
  // attacking, no blockers declared
  const unblocked = bombBoard({ blockers: [] });
  refused(() => playRaw(unblocked.engine, P1, unblocked.id("bb"), { selected: { c: [unblocked.id("a1")], bl: [], at: [unblocked.id("a1"), unblocked.id("a2")] } }), "nobody is blocking");
  assert.equal(zoneOf(unblocked.engine, unblocked.id("a1")), "play");

  // before blockers are declared
  const early = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "bb", def: printing(BASK_BOMB), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", strength: 3, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1" }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  early.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [early.id("a1")], target: { type: "faction", playerId: P2 } });
  refused(() => playRaw(early.engine, P1, early.id("bb"), { selected: { c: [early.id("a1")], bl: [early.id("b1")], at: [early.id("a1")] } }), "the opponent has not blocked yet");

  // outside a battle
  const idle = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "bb", def: printing(BASK_BOMB), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1" }), owner: P1, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  refused(() => playRaw(idle.engine, P1, idle.id("bb"), { selected: { c: [idle.id("a1")], bl: [], at: [] } }), "no battle");
  assert.equal(zoneOf(idle.engine, idle.id("a1")), "play");

  const control = bombBoard(); // control: attacking with the opponent blocking is exactly when it can be played
  bomb(control.engine, control.id, "a1");
  assert.equal(pending(control.engine)?.kind, "distributeAmong");
});

clause(BASK_BOMB, "0:ability", "refused when I am the one being attacked, even though I am blocking", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "bb", def: printing(BASK_BOMB), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  declareAttackBy(engine, P2, [id("atk")], { type: "faction", playerId: P1 });
  declareBlockersBy(engine, P1, [id("mine")]);
  engine.perform({ type: "passPriority", playerId: P2 });
  refused(() => playRaw(engine, P1, id("bb"), { selected: { c: [id("mine")], bl: [id("mine")], at: [id("atk")] } }), "I am blocking, not attacking");
  assert.equal(zoneOf(engine, id("mine")), "play");
  const control = bombBoard(); // control: the same card works when I am the attacker
  bomb(control.engine, control.id, "a1");
  assert.equal(pending(control.engine)?.kind, "distributeAmong");
});

clause(BASK_BOMB, "0:ability", "costs no resources but needs [R][R][R]: refused with two [R] (however many other resources), allowed with three", () => {
  const two = bombBoard({ rage: 2, extra: bank("greed", 8, P1) });
  refused(() => bomb(two.engine, two.id, "a1"));
  assert.equal(zoneOf(two.engine, two.id("a1")), "play");
  assert.equal(two.engine.getCardPlayability(P1, two.id("bb")).playable, false);

  const three = bombBoard({ rage: 3 });
  assert.equal(three.engine.getCardPlayability(P1, three.id("bb")).playable, true);
  const before = ready(three.engine);
  bomb(three.engine, three.id, "a1");
  assert.equal(before - ready(three.engine), 0, "numeric cost 0: nothing is spent, the threshold is only a requirement");
  assert.equal(pending(three.engine)?.kind, "distributeAmong");
});

// =============================================================================
// Bladefist Doomwing
// Character, warlord, cost 9, threshold [R][R], 6/3/6 (strength / speed / life), dragon.
// UNIQUE BLADEFIST
// FIREBREATHING -- COST: Pick a number for X. Pay twice X. Deplete this card. Pick a character.
// EFFECT: Inflict X damage to the character.
// =============================================================================

const BLADEFIST = "5d828684-b493-46b0-ae83-01402264b8d5";

function bladefistBoard(opts: { rage?: number; turn?: number; active?: Pid; depleted?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "bd", def: printing(BLADEFIST), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "faceDown" })),
      ...bank("rage", opts.rage ?? 8, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const firebreathing = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, x: number, target: string) =>
  activate(engine, P1, id("bd"), "firebreathing", { variables: { x }, selected: { c: [id(target)] } });

clause(BLADEFIST, "0:unique", "deploys for its printed cost of 9 and [R][R], and has its printed stats", () => {
  deploysForPrintedCost(BLADEFIST);
  hasPrintedStats(BLADEFIST);
});

clause(BLADEFIST, "0:unique", "a second Bladefist Doomwing forces a choice: one is kept, the other destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "b1", def: printing(BLADEFIST), owner: P1, zone: "play" },
      { key: "b2", def: printing(BLADEFIST), owner: P1, zone: "hand" },
      ...bank("rage", 9, P1)
    ]
  });
  play(engine, P1, id("b2"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [id("b1"), id("b2")].sort());
  keepUnique(engine, P1, id("b2"));
  assert.equal(zoneOf(engine, id("b2")), "play");
  assert.equal(zoneOf(engine, id("b1")), "discard");
});

clause(BLADEFIST, "0:unique", "the opponent may control their own Bladefist Doomwing", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "b1", def: printing(BLADEFIST), owner: P1, zone: "play" },
      { key: "b2", def: printing(BLADEFIST), owner: P2, zone: "hand" },
      ...bank("rage", 9, P2)
    ]
  });
  play(engine, P2, id("b2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("b1")), "play");
  assert.equal(zoneOf(engine, id("b2")), "play");
});

for (const x of [0, 1, 2, 3, 4]) {
  clause(BLADEFIST, "1:ability:firebreathing", `X=${x}: pays twice X (${2 * x}), depletes Doomwing, and inflicts ${x} damage to the picked character`, () => {
    const { engine, id } = bladefistBoard();
    const before = ready(engine);
    firebreathing(engine, id, x, "foe");
    assert.equal(before - ready(engine), 2 * x, `pays X+X = ${2 * x}`);
    assert.equal(isDepleted(engine, id("bd")), true, "COST: deplete this card");
    assert.equal(damageOf(engine, id("foe")), x, `${x} damage`);
    assert.equal(zoneOf(engine, id("foe")), "play", "9 life survives 4 damage");
    assert.equal(damageOf(engine, id("mine")), 0, "other characters are untouched");
    assert.equal(damageOf(engine, id("bd")), 0, "Doomwing itself is not damaged");
  });
}

clause(BLADEFIST, "1:ability:firebreathing", "lethal damage destroys the character (X=3 on a 3-life character)", () => {
  const { engine, id } = bladefistBoard();
  firebreathing(engine, id, 3, "weak");
  assert.equal(zoneOf(engine, id("weak")), "discard");
  const less = bladefistBoard();
  firebreathing(less.engine, less.id, 2, "weak");
  assert.equal(zoneOf(less.engine, less.id("weak")), "play", "2 damage does not kill a 3-life character");
});

clause(BLADEFIST, "1:ability:firebreathing", "any character may be picked: mine, the opponent's, and Doomwing itself", () => {
  const own = bladefistBoard();
  firebreathing(own.engine, own.id, 2, "mine");
  assert.equal(damageOf(own.engine, own.id("mine")), 2);
  const self = bladefistBoard();
  firebreathing(self.engine, self.id, 2, "bd");
  assert.equal(damageOf(self.engine, self.id("bd")), 2);
  assert.equal(isDepleted(self.engine, self.id("bd")), true);
});

clause(BLADEFIST, "1:ability:firebreathing", "the pick must be a character: not an item, a location, a face-down resource or a faction", () => {
  const { engine, id } = bladefistBoard();
  for (const key of ["thing", "place", "faceDown"]) refused(() => firebreathing(engine, id, 1, key), `${key} cannot be picked`);
  refused(() => activate(engine, P1, id("bd"), "firebreathing", { variables: { x: 1 }, selected: { c: [engine.state.players[P2].factionId!] } }), "a faction cannot be picked");
  refused(() => activate(engine, P1, id("bd"), "firebreathing", { variables: { x: 1 }, selected: { c: [id("foe"), id("weak")] } }), "exactly one");
  assert.equal(isDepleted(engine, id("bd")), false, "nothing was paid by the refused attempts");
  assert.equal(ready(engine), 8);
  firebreathing(engine, id, 1, "foe"); // control
  assert.equal(damageOf(engine, id("foe")), 1);
});

clause(BLADEFIST, "1:ability:firebreathing", "needs 2X resources: refused one short (X=3 with 5), allowed with exactly 6", () => {
  const short = bladefistBoard({ rage: 5 });
  refused(() => firebreathing(short.engine, short.id, 3, "foe"));
  assert.equal(isDepleted(short.engine, short.id("bd")), false, "not depleted by a refused use");
  assert.equal(ready(short.engine), 5, "nothing was paid");
  assert.equal(damageOf(short.engine, short.id("foe")), 0);

  const exact = bladefistBoard({ rage: 6 });
  firebreathing(exact.engine, exact.id, 3, "foe");
  assert.equal(damageOf(exact.engine, exact.id("foe")), 3);
  assert.equal(ready(exact.engine), 0);
});

clause(BLADEFIST, "1:ability:firebreathing", "X cannot be negative", () => {
  const { engine, id } = bladefistBoard();
  refused(() => firebreathing(engine, id, -1, "foe"));
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(isDepleted(engine, id("bd")), false);
  firebreathing(engine, id, 0, "foe"); // control: X = 0 is a legal choice
  assert.equal(isDepleted(engine, id("bd")), true);
});

clause(BLADEFIST, "1:ability:firebreathing", "it cannot be used while depleted, and using it depletes (so no second use until restored)", () => {
  const dep = bladefistBoard({ depleted: true });
  refused(() => firebreathing(dep.engine, dep.id, 1, "foe"));
  assert.equal(damageOf(dep.engine, dep.id("foe")), 0);
  assert.equal(ready(dep.engine), 8, "nothing was paid");

  const { engine, id } = bladefistBoard();
  firebreathing(engine, id, 1, "foe");
  refused(() => firebreathing(engine, id, 1, "foe"), "already depleted by the first use");
  assert.equal(damageOf(engine, id("foe")), 1);
});

clause(BLADEFIST, "1:ability:firebreathing", "the costs are paid when it is used (before the opponent can respond); the damage comes at resolution", () => {
  const { engine, id } = bladefistBoard();
  useAbilityRaw(engine, P1, id("bd"), "firebreathing", { variables: { x: 3 }, selected: { c: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(ready(engine), 2, "6 paid");
  assert.equal(isDepleted(engine, id("bd")), true);
  assert.equal(damageOf(engine, id("foe")), 0, "no damage yet");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe")), 3);
});

clause(BLADEFIST, "1:ability:firebreathing", "only its controller can use it", () => {
  const { engine, id } = bladefistBoard({ turn: 2, active: P2, extra: bank("rage", 8, P2) });
  refused(() => activate(engine, P2, id("bd"), "firebreathing", { variables: { x: 1 }, selected: { c: [id("mine")] } }));
  assert.equal(isDepleted(engine, id("bd")), false);
});

clause(BLADEFIST, "1:ability:firebreathing", "can be used in response (an ability can be used whenever you could respond)", () => {
  const { engine, id } = bladefistBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" }]
  });
  openDefenderWindow(engine, [id("atk")]);
  firebreathing(engine, id, 2, "atk");
  assert.equal(zoneOf(engine, id("atk")), "discard", "2 damage destroyed the 2-life attacker");
});

// =============================================================================
// Cannon Squadron
// Character, warlord, cost 9, threshold [R][R], 1/3/1 (strength / speed / life), soldier.
// FIRE! -- COST: Deplete this card. Pick 2 or fewer characters.
// EFFECT: Inflict up to 2 damage divided however you want to the characters.
// =============================================================================

const CANNON = "91bc411b-c8f7-48dd-b544-7232d091b9de";

function cannonBoard(opts: { depleted?: boolean; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "cs", def: printing(CANNON), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "t1", def: character({ name: "T1", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "t2", def: character({ name: "T2", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "t3", def: character({ name: "T3", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "faceDown" })),
      ...(opts.extra ?? [])
    ]
  });
}

/** Uses FIRE! picking `targets`, and answers any damage-division prompt with `shares` (keys are board keys). */
function fire(engine: SpoilsEngine, id: (key: string) => CardInstanceId, targets: string[], shares: Record<string, number>): void {
  activate(engine, P1, id("cs"), "cannon-squadron-fire", { selected: { picked: targets.map(id) } });
  drain(engine, (pc) => {
    if (pc.kind !== "distributeAmong") return declineAll(pc);
    const mapped: Record<string, number> = {};
    for (const [key, amount] of Object.entries(shares)) mapped[id(key)] = amount;
    return { kind: "distributeAmong", shares: mapped };
  });
}

clause(CANNON, "0:ability:cannon-squadron-fire", "deploys for its printed cost of 9 and [R][R], and has its printed stats", () => {
  deploysForPrintedCost(CANNON);
  hasPrintedStats(CANNON);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "depletes itself and inflicts 2 damage divided as I want between 2 picked characters (1 and 1)", () => {
  const { engine, id } = cannonBoard();
  fire(engine, id, ["t1", "t2"], { t1: 1, t2: 1 });
  assert.equal(isDepleted(engine, id("cs")), true, "COST: deplete this card");
  assert.equal(damageOf(engine, id("t1")), 1);
  assert.equal(damageOf(engine, id("t2")), 1);
  assert.equal(damageOf(engine, id("t3")), 0, "an unpicked character is untouched");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "...or 2 and 0, or 0 and 2: 'however you want'", () => {
  const first = cannonBoard();
  fire(first.engine, first.id, ["t1", "t2"], { t1: 2, t2: 0 });
  assert.equal(damageOf(first.engine, first.id("t1")), 2);
  assert.equal(damageOf(first.engine, first.id("t2")), 0);

  const second = cannonBoard();
  fire(second.engine, second.id, ["t1", "t2"], { t1: 0, t2: 2 });
  assert.equal(damageOf(second.engine, second.id("t1")), 0);
  assert.equal(damageOf(second.engine, second.id("t2")), 2);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "one picked character takes the damage (up to 2)", () => {
  const { engine, id } = cannonBoard();
  fire(engine, id, ["t1"], { t1: 2 });
  assert.equal(damageOf(engine, id("t1")), 2);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "'up to 2': I may inflict only 1 damage in total", () => {
  const { engine, id } = cannonBoard();
  fire(engine, id, ["t1", "t2"], { t1: 1 });
  assert.equal(engine.state.pendingChoice, undefined, "1 damage in total was accepted");
  assert.equal(damageOf(engine, id("t1")), 1);
  assert.equal(damageOf(engine, id("t2")), 0);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "'up to 2': I may inflict no damage at all", () => {
  const { engine, id } = cannonBoard();
  fire(engine, id, ["t1"], {});
  assert.equal(engine.state.pendingChoice, undefined, "no damage was accepted");
  assert.equal(damageOf(engine, id("t1")), 0);
  assert.equal(isDepleted(engine, id("cs")), true, "the card was depleted all the same");
});

clause(CANNON, "0:ability:cannon-squadron-fire", "'2 or fewer': picking no characters at all is allowed (it just depletes)", () => {
  const { engine, id } = cannonBoard();
  activate(engine, P1, id("cs"), "cannon-squadron-fire", { selected: { picked: [] } });
  drain(engine, declineAll);
  assert.equal(isDepleted(engine, id("cs")), true);
  assert.equal(engine.state.pendingChoice, undefined);
  for (const key of ["t1", "t2", "mine"]) assert.equal(damageOf(engine, id(key)), 0);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "it cannot inflict more than 2 damage in total, nor damage a character that was not picked", () => {
  const tooMuch = cannonBoard();
  refused(() => fire(tooMuch.engine, tooMuch.id, ["t1", "t2"], { t1: 2, t2: 1 }), "3 damage in total");
  const outsider = cannonBoard();
  refused(() => fire(outsider.engine, outsider.id, ["t1", "t2"], { t3: 2 }), "T3 was not picked");
  const control = cannonBoard();
  fire(control.engine, control.id, ["t1", "t2"], { t1: 1, t2: 1 });
  assert.equal(damageOf(control.engine, control.id("t1")), 1);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "at most 2 characters may be picked", () => {
  const { engine, id } = cannonBoard();
  refused(() => activate(engine, P1, id("cs"), "cannon-squadron-fire", { selected: { picked: [id("t1"), id("t2"), id("t3")] } }), "three picks");
  assert.equal(isDepleted(engine, id("cs")), false, "nothing was paid");
  fire(engine, id, ["t1", "t2"], { t1: 1, t2: 1 }); // control: two picks work
  assert.equal(isDepleted(engine, id("cs")), true);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "picks must be characters: not an item, a location, a face-down resource or a faction", () => {
  const { engine, id } = cannonBoard();
  for (const key of ["thing", "place", "faceDown"]) {
    refused(() => activate(engine, P1, id("cs"), "cannon-squadron-fire", { selected: { picked: [id(key)] } }), `${key} cannot be picked`);
  }
  refused(() => activate(engine, P1, id("cs"), "cannon-squadron-fire", { selected: { picked: [engine.state.players[P2].factionId!] } }), "a faction cannot be picked");
  assert.equal(isDepleted(engine, id("cs")), false);
  fire(engine, id, ["t1"], { t1: 2 }); // control: a character pick works
  assert.equal(damageOf(engine, id("t1")), 2);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "any characters may be picked: mine, the opponent's, and the Squadron itself", () => {
  const mixed = cannonBoard();
  fire(mixed.engine, mixed.id, ["mine", "t1"], { mine: 1, t1: 1 });
  assert.equal(damageOf(mixed.engine, mixed.id("mine")), 1);
  assert.equal(damageOf(mixed.engine, mixed.id("t1")), 1);
  const self = cannonBoard();
  fire(self.engine, self.id, ["cs"], { cs: 1 });
  assert.equal(zoneOf(self.engine, self.id("cs")), "discard", "1 damage destroys the 1-life Squadron");
});

clause(CANNON, "0:ability:cannon-squadron-fire", "lethal damage destroys the character", () => {
  const { engine, id } = cannonBoard();
  fire(engine, id, ["weak"], { weak: 2 });
  assert.equal(zoneOf(engine, id("weak")), "discard");
});

clause(CANNON, "0:ability:cannon-squadron-fire", "cannot be used while depleted, and using it depletes (once per restore)", () => {
  const dep = cannonBoard({ depleted: true });
  refused(() => fire(dep.engine, dep.id, ["t1"], { t1: 2 }));
  assert.equal(damageOf(dep.engine, dep.id("t1")), 0);

  const { engine, id } = cannonBoard();
  fire(engine, id, ["t1"], { t1: 2 });
  refused(() => fire(engine, id, ["t2"], { t2: 2 }), "already depleted");
  assert.equal(damageOf(engine, id("t2")), 0);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "it costs no resources", () => {
  const { engine, id } = cannonBoard();
  assert.equal(ready(engine), 0, "there are no resources on this board");
  fire(engine, id, ["t1"], { t1: 2 });
  assert.equal(damageOf(engine, id("t1")), 2);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "the deplete is a cost (done when used), the damage is dealt at resolution", () => {
  const { engine, id } = cannonBoard();
  useAbilityRaw(engine, P1, id("cs"), "cannon-squadron-fire", { selected: { picked: [id("t1")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(isDepleted(engine, id("cs")), true);
  assert.equal(damageOf(engine, id("t1")), 0);
  resolvePendingResponses(engine);
  drain(engine, (pc) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("t1")]: 2 } } : declineAll(pc)));
  assert.equal(damageOf(engine, id("t1")), 2);
});

clause(CANNON, "0:ability:cannon-squadron-fire", "only its controller can use it", () => {
  const { engine, id } = cannonBoard({ turn: 2, active: P2 });
  refused(() => activate(engine, P2, id("cs"), "cannon-squadron-fire", { selected: { picked: [id("t1")] } }));
  assert.equal(isDepleted(engine, id("cs")), false);
});

// =============================================================================
// Dragon Catheter
// Item, warlord, cost 3, threshold [R][R].
// At the start of your turn, you must put a token on the character with the highest
// strength. If there is a tie, you decide which character gets the token.
// All characters gain 1 strength for each token on them.
// =============================================================================

const CATHETER = "c7ef1925-48a4-4781-a41a-7e10cb079e1b";

type Chr = { key: string; owner: Pid; strength: number; tokens?: number; life?: number };
function catheterBoard(chars: Chr[], opts: { controller?: Pid; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "cath", def: printing(CATHETER), owner: P1, controller: opts.controller ?? P1, zone: "play" },
      ...chars.map((c) => ({
        key: c.key,
        def: character({ name: c.key, strength: c.strength, life: c.life ?? 9, speed: 2 }),
        owner: c.owner,
        zone: "play" as const,
        counters: (c.tokens ? { token: c.tokens } : {}) as Record<string, number>
      })),
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(CATHETER, "0:rule", "deploys for its printed cost of 3 and [R][R]", () => {
  deploysForPrintedCost(CATHETER);
});

/** Starts my turn (P2 ends theirs). If the engine asks which character gets the token, answers `pickKey`; returns whether it asked. */
function myTurnStarts(engine: SpoilsEngine, id: (key: string) => CardInstanceId, pickKey?: string, player: Pid = P1): boolean {
  endTurn(engine, other(player));
  const asked = pending(engine)?.kind === "chooserSelectsTarget";
  if (asked) {
    assert.ok(pickKey, "the engine asked for a pick but the test has no answer");
    pick(engine, player, [id(pickKey!)]);
  }
  return asked;
}

clause(CATHETER, "0:rule", "at the start of my turn the character with the highest strength (the only legal choice) gets a token", () => {
  const { engine, id } = catheterBoard([
    { key: "A", owner: P1, strength: 3 },
    { key: "B", owner: P2, strength: 2 },
    { key: "C", owner: P1, strength: 1 }
  ]);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "my turn has started");
  if (pending(engine)) {
    for (const key of ["B", "C"]) {
      refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id(key)] } } as never), `${key} is not the highest: it cannot get the token`);
    }
    pick(engine, P1, [id("A")]);
  }
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokens(engine, id("A")), 1);
  assert.equal(tokens(engine, id("B")), 0);
  assert.equal(tokens(engine, id("C")), 0);
});

clause(CATHETER, "0:rule", "...whoever controls that character: the opponent's strongest character gets the token", () => {
  const { engine, id } = catheterBoard([
    { key: "A", owner: P1, strength: 2 },
    { key: "B", owner: P2, strength: 5 }
  ]);
  myTurnStarts(engine, id, "B");
  assert.equal(tokens(engine, id("B")), 1);
  assert.equal(tokens(engine, id("A")), 0);
});

clause(CATHETER, "0:rule", "a tie: I decide which of the tied characters gets the token (only tied characters may be chosen)", () => {
  const { engine, id } = catheterBoard([
    { key: "A", owner: P1, strength: 3 },
    { key: "B", owner: P2, strength: 3 },
    { key: "C", owner: P1, strength: 1 }
  ]);
  endTurn(engine, P2);
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "I am asked which character gets the token");
  assert.equal(pc?.playerId, P1, "I decide");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("C")] } } as never), "a weaker character cannot be chosen");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("thing")] } } as never), "an item cannot be chosen");
  assert.ok(engine.state.pendingChoice, "refused picks keep the choice open");
  pick(engine, P1, [id("B")]);
  assert.equal(tokens(engine, id("B")), 1, "the opponent's tied character was my choice");
  assert.equal(tokens(engine, id("A")), 0);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(CATHETER, "0:rule", "...and I may choose either tied character", () => {
  const { engine, id } = catheterBoard([
    { key: "A", owner: P1, strength: 3 },
    { key: "B", owner: P2, strength: 3 }
  ]);
  endTurn(engine, P2);
  pick(engine, P1, [id("A")]);
  assert.equal(tokens(engine, id("A")), 1);
  assert.equal(tokens(engine, id("B")), 0);
});

clause(CATHETER, "0:rule", "'you must': in a tie the token cannot be declined", () => {
  const { engine } = catheterBoard([
    { key: "A", owner: P1, strength: 3 },
    { key: "B", owner: P2, strength: 3 }
  ]);
  endTurn(engine, P2);
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never), "picking nothing is not allowed");
});

clause(CATHETER, "0:rule", "'highest strength' is the CURRENT strength: a character at 2 with a token (so 3) ties a printed 3", () => {
  const { engine, id } = catheterBoard([
    { key: "A", owner: P1, strength: 3 },
    { key: "B", owner: P2, strength: 2, tokens: 1 },
    { key: "C", owner: P1, strength: 2 }
  ]);
  assert.equal(engine.getStat(id("B"), "strength"), 3, "the token already makes B a 3");
  endTurn(engine, P2);
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "A (3) and B (2+1) tie");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("C")] } } as never), "C (2) is not tied");
  pick(engine, P1, [id("B")]);
  assert.equal(tokens(engine, id("B")), 2);
});

clause(CATHETER, "0:rule", "a printed 2 that is boosted by another effect to 4 is the highest even though a printed 3 exists", () => {
  const { engine, id } = catheterBoard(
    [
      { key: "A", owner: P1, strength: 3 },
      { key: "B", owner: P2, strength: 2 }
    ],
    { extra: [{ key: "pump", def: pumpTactic(2), owner: P2, zone: "hand" }] }
  );
  play(engine, P2, id("pump"), { selected: { t: [id("B")] } });
  assert.equal(engine.getStat(id("B"), "strength"), 4);
  assert.equal(engine.state.activePlayerId, P2);
  // the pump lasts "this turn": it is gone by the time my turn starts, so A is the highest again
  myTurnStarts(engine, id, "A");
  assert.equal(tokens(engine, id("A")), 1);
});

clause(CATHETER, "0:rule", "only at the start of MY turn: nothing happens at the start of the opponent's turn", () => {
  const { engine, id } = catheterBoard(
    [
      { key: "A", owner: P1, strength: 3 },
      { key: "B", owner: P2, strength: 2 }
    ],
    { active: P1 }
  );
  endTurn(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokens(engine, id("A")) + tokens(engine, id("B")), 0, "no token at their turn start");
  myTurnStarts(engine, id, "A"); // mine
  assert.equal(tokens(engine, id("A")), 1);
});

clause(CATHETER, "0:rule", "tokens accumulate turn after turn on the strongest character (each token also raises its strength)", () => {
  const { engine, id } = catheterBoard([
    { key: "A", owner: P1, strength: 3 },
    { key: "B", owner: P2, strength: 2 }
  ]);
  myTurnStarts(engine, id, "A");
  assert.equal(tokens(engine, id("A")), 1);
  endTurn(engine, P1);
  myTurnStarts(engine, id, "A");
  assert.equal(tokens(engine, id("A")), 2);
  assert.equal(engine.getStat(id("A"), "strength"), 5);
});

clause(CATHETER, "0:rule", "with no characters in play nothing happens", () => {
  const { engine, id } = catheterBoard([]);
  endTurn(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(tokens(engine, id("thing")), 0, "an item never gets the token");
});

clause(CATHETER, "0:rule", "'your turn' is its controller's: a Catheter I own but the opponent controls triggers at THEIR turn start only", () => {
  const { engine, id } = catheterBoard(
    [
      { key: "A", owner: P1, strength: 3 },
      { key: "B", owner: P2, strength: 2 }
    ],
    { controller: P2 }
  );
  endTurn(engine, P2); // my turn: the Catheter is not mine to trigger
  assert.equal(tokens(engine, id("A")) + tokens(engine, id("B")), 0);
  endTurn(engine, P1); // their turn
  assert.equal(pending(engine)?.playerId, P2, "the Catheter's controller decides");
  pick(engine, P2, [id("A")]);
  assert.equal(tokens(engine, id("A")), 1, "at their turn start the strongest character gets the token");
});

clause(CATHETER, "0:rule", "no token when the Catheter is gone", () => {
  const smash = tactic({
    name: "SmashItem",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = catheterBoard(
    [
      { key: "A", owner: P1, strength: 3 },
      { key: "B", owner: P2, strength: 2 }
    ],
    { extra: [{ key: "smash", def: smash, owner: P2, zone: "hand" }] }
  );
  play(engine, P2, id("smash"), { selected: { t: [id("cath")] } });
  assert.equal(zoneOf(engine, id("cath")), "discard");
  endTurn(engine, P2);
  assert.equal(tokens(engine, id("A")), 0);
});

clause(CATHETER, "1:rule", "every character gains 1 strength per token on it — mine and the opponent's; speed and life are unchanged", () => {
  const { engine, id } = catheterBoard([
    { key: "A", owner: P1, strength: 3, tokens: 2, life: 4 },
    { key: "B", owner: P2, strength: 2, tokens: 1, life: 5 },
    { key: "C", owner: P1, strength: 1, tokens: 0 }
  ]);
  assert.equal(engine.getStat(id("A"), "strength"), 5);
  assert.equal(engine.getStat(id("B"), "strength"), 3);
  assert.equal(engine.getStat(id("C"), "strength"), 1);
  assert.equal(engine.getStat(id("A"), "life"), 4);
  assert.equal(engine.getStat(id("B"), "life"), 5);
  assert.equal(engine.getStat(id("A"), "speed"), 2);
});

clause(CATHETER, "1:rule", "the bonus is a static rule of the Catheter: with it gone the tokens stay but no longer add strength", () => {
  const bounceItem = tactic({
    name: "BounceItem",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = catheterBoard([{ key: "A", owner: P1, strength: 3, tokens: 2 }], { extra: [{ key: "bounce", def: bounceItem, owner: P2, zone: "hand" }] });
  assert.equal(engine.getStat(id("A"), "strength"), 5);
  play(engine, P2, id("bounce"), { selected: { t: [id("cath")] } });
  assert.equal(zoneOf(engine, id("cath")), "hand");
  assert.equal(engine.getStat(id("A"), "strength"), 3, "back to its printed strength");
});

// =============================================================================
// Dragon's Strategy
// Tactic, warlord, cost 3, threshold [R].
// "Your opponent's faction loses 2 influence. Draw a card."
// =============================================================================

const STRATEGY = "b737b07a-6d80-47cd-b27e-c0406883ca20";

function strategyBoard(opts: { rage?: number; greed?: number; oppInfluence?: number; myDeck?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: opts.oppInfluence ?? 20 },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ds", def: printing(STRATEGY), owner: P1, zone: "hand" },
      ...fillers("a", opts.myDeck ?? 3, P1, "deck"),
      ...fillers("b", 3, P2, "deck"),
      ...bank("rage", opts.rage ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

clause(STRATEGY, "0:rule", "pays 3, my opponent's faction loses exactly 2 influence (mine loses none) and I draw a card", () => {
  const { engine, id } = strategyBoard();
  const before = ready(engine);
  const top = deckOf(engine, P1)[0];
  const theirHand = handOf(engine, P2).length;
  play(engine, P1, id("ds"));
  assert.equal(before - ready(engine), 3, "the printed cost of 3 is paid");
  assert.equal(influence(engine, P2), 18, "the opponent's faction lost 2 influence");
  assert.equal(influence(engine, P1), 20, "mine is untouched");
  assert.equal(zoneOf(engine, top), "hand", "I drew the top card of my deck");
  assert.equal(handOf(engine, P2).length, theirHand, "the opponent drew nothing");
  assert.equal(zoneOf(engine, id("ds")), "discard");
});

clause(STRATEGY, "0:rule", "it is the same when the opponent is the one with less influence: it always hits the OPPONENT of the caster", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "ds", def: printing(STRATEGY), owner: P2, zone: "hand" },
      ...fillers("a", 3, P1, "deck"),
      ...fillers("b", 3, P2, "deck"),
      ...bank("rage", 3, P2)
    ]
  });
  play(engine, P2, id("ds"));
  assert.equal(influence(engine, P1), 18);
  assert.equal(influence(engine, P2), 20);
});

clause(STRATEGY, "0:rule", "the influence loss and the draw happen at resolution, not while the opponent can still respond", () => {
  const { engine, id } = strategyBoard();
  const deck = [...deckOf(engine, P1)];
  playRaw(engine, P1, id("ds"));
  assert.equal(influence(engine, P2), 20);
  assert.deepEqual(deckOf(engine, P1), deck);
  resolvePendingResponses(engine);
  assert.equal(influence(engine, P2), 18);
  assert.deepEqual(deckOf(engine, P1), deck.slice(1));
});

clause(STRATEGY, "0:rule", "an opponent on exactly 2 influence is reduced to 0 and loses the game", () => {
  const { engine, id } = strategyBoard({ oppInfluence: 2 });
  play(engine, P1, id("ds"));
  assert.equal(influence(engine, P2), 0);
  assert.equal(engine.state.winner, P1);
});

clause(STRATEGY, "0:rule", "an opponent on 3 influence survives with 1", () => {
  const { engine, id } = strategyBoard({ oppInfluence: 3 });
  play(engine, P1, id("ds"));
  assert.equal(influence(engine, P2), 1);
  assert.equal(engine.state.winner, undefined);
});

clause(STRATEGY, "0:rule", "it is not damage: damage-reduction effects do not reduce it (CR 408.3b)", () => {
  const shield = character({
    name: "Shield",
    behavior: { abilities: [{ id: "shield", type: "continuous", modifiers: [], damageModifiers: [{ target: { type: "faction" }, delta: -5 }] } as never] }
  });
  const { engine, id } = strategyBoard({ extra: [{ key: "shield", def: shield, owner: P2, zone: "play" }] });
  play(engine, P1, id("ds"));
  assert.equal(influence(engine, P2), 18, "damage reduction does not apply to 'loses influence'");
});

clause(STRATEGY, "0:rule", "the draw still happens when my deck is empty (no card to draw, no loss) and the influence is still lost", () => {
  const { engine, id } = strategyBoard({ myDeck: 0 });
  play(engine, P1, id("ds"));
  assert.equal(influence(engine, P2), 18);
  assert.equal(engine.state.winner, undefined);
});

clause(STRATEGY, "0:rule", "is refused one resource short of 3, and allowed with exactly 3", () => {
  const short = strategyBoard({ rage: 2 });
  refused(() => playRaw(short.engine, P1, short.id("ds")));
  assert.equal(zoneOf(short.engine, short.id("ds")), "hand");
  assert.equal(influence(short.engine, P2), 20);

  const exact = strategyBoard({ rage: 3 });
  assert.equal(exact.engine.getCardPlayability(P1, exact.id("ds")).playable, true);
  play(exact.engine, P1, exact.id("ds"));
  assert.equal(influence(exact.engine, P2), 18);
});

clause(STRATEGY, "0:rule", "is refused without [R] even with plenty of other resources; one [R] among them is enough", () => {
  const none = strategyBoard({ rage: 0, greed: 6 });
  refused(() => playRaw(none.engine, P1, none.id("ds")));
  assert.equal(none.engine.getCardPlayability(P1, none.id("ds")).playable, false);

  const one = strategyBoard({ rage: 1, greed: 2 });
  play(one.engine, P1, one.id("ds"));
  assert.equal(influence(one.engine, P2), 18);
});

clause(STRATEGY, "0:rule", "as a tactic it can be played in response on the opponent's turn", () => {
  const { engine, id } = strategyBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }]
  });
  refused(() => playRaw(engine, P1, id("ds")), "nothing to respond to yet");
  openDefenderWindow(engine, [id("atk")]);
  playRaw(engine, P1, id("ds"));
  resolvePendingResponses(engine);
  assert.equal(influence(engine, P2), 18);
});

// =============================================================================
// Flaming Barduse
// Character, warlord, cost 3, threshold [R][R], 1/2/1 (strength / speed / life), dragon.
// COST: You may pick 2 or fewer characters.
// When this card enters play, if you picked characters as part of this card's cost
// then inflict up to 2 damage divided however you want to the characters.
// (If you didn't pay this card's cost then you cannot inflict damage.)
// =============================================================================

const BARDUSE = "6ed81213-d928-4296-9161-8a86b43fc659";

function barduseBoard(opts: { rage?: number; greed?: number; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "fb", def: printing(BARDUSE), owner: P1, zone: "hand" },
      { key: "t1", def: character({ name: "T1", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "t2", def: character({ name: "T2", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "t3", def: character({ name: "T3", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "faceDown" })),
      ...bank("rage", opts.rage ?? 2, P1),
      ...bank("greed", opts.greed ?? 1, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Deploys Barduse picking `picks` and answers the damage-division prompt with `shares` (board keys). */
function deployBarduse(engine: SpoilsEngine, id: (key: string) => CardInstanceId, picks: string[], shares: Record<string, number>): void {
  play(engine, P1, id("fb"), { selected: { picked: picks.map(id) } });
  drain(engine, (pc) => {
    if (pc.kind !== "distributeAmong") return declineAll(pc);
    const mapped: Record<string, number> = {};
    for (const [key, amount] of Object.entries(shares)) mapped[id(key)] = amount;
    return { kind: "distributeAmong", shares: mapped };
  });
}

clause(BARDUSE, "0:ability", "deploys for its printed cost of 3 and [R][R], and has its printed stats", () => {
  const { engine, id } = barduseBoard({ greed: 1 });
  const before = ready(engine);
  play(engine, P1, id("fb"), { selected: { picked: [] } });
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(before - ready(engine), 3);
  assert.deepEqual([engine.getStat(id("fb"), "strength"), engine.getStat(id("fb"), "speed"), engine.getStat(id("fb"), "life")], [1, 2, 1]);

  const short = barduseBoard({ rage: 2, greed: 0 });
  refused(() => play(short.engine, P1, short.id("fb"), { selected: { picked: [] } }), "2 resources are one short");
  const noThreshold = barduseBoard({ rage: 1, greed: 8 });
  refused(() => play(noThreshold.engine, P1, noThreshold.id("fb"), { selected: { picked: [] } }), "one [R] is not [R][R]");
  assert.equal(noThreshold.engine.getCardPlayability(P1, noThreshold.id("fb")).playable, false);
});

clause(BARDUSE, "0:ability", "picking nothing is allowed ('you may'): it enters play and nothing is damaged", () => {
  const { engine, id } = barduseBoard();
  play(engine, P1, id("fb"), { selected: { picked: [] } });
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "no damage to divide");
  for (const key of ["t1", "t2", "t3", "weak", "mine"]) assert.equal(damageOf(engine, id(key)), 0);
});

clause(BARDUSE, "0:ability", "playing it with no `picked` selection at all also works (the pick is optional)", () => {
  const { engine, id } = barduseBoard();
  play(engine, P1, id("fb"));
  assert.equal(zoneOf(engine, id("fb")), "play");
  for (const key of ["t1", "t2", "t3", "weak", "mine"]) assert.equal(damageOf(engine, id(key)), 0);
});

clause(BARDUSE, "1:rule", "one picked character takes up to 2 damage when it enters play", () => {
  const { engine, id } = barduseBoard();
  deployBarduse(engine, id, ["t1"], { t1: 2 });
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(damageOf(engine, id("t1")), 2);
  assert.equal(damageOf(engine, id("t2")), 0);
});

clause(BARDUSE, "1:rule", "two picked characters share the 2 damage however I want (1 and 1, 2 and 0, 0 and 2)", () => {
  for (const shares of [{ t1: 1, t2: 1 }, { t1: 2, t2: 0 }, { t1: 0, t2: 2 }]) {
    const { engine, id } = barduseBoard();
    deployBarduse(engine, id, ["t1", "t2"], shares);
    assert.equal(damageOf(engine, id("t1")), shares.t1, `T1 takes ${shares.t1}`);
    assert.equal(damageOf(engine, id("t2")), shares.t2, `T2 takes ${shares.t2}`);
    assert.equal(damageOf(engine, id("t3")), 0);
  }
});

clause(BARDUSE, "1:rule", "'up to 2': I may inflict only 1 damage, or none", () => {
  const one = barduseBoard();
  deployBarduse(one.engine, one.id, ["t1", "t2"], { t1: 1 });
  assert.equal(one.engine.state.pendingChoice, undefined, "1 damage in total was accepted");
  assert.equal(damageOf(one.engine, one.id("t1")), 1);
  assert.equal(damageOf(one.engine, one.id("t2")), 0);

  const none = barduseBoard();
  deployBarduse(none.engine, none.id, ["t1"], {});
  assert.equal(none.engine.state.pendingChoice, undefined, "no damage was accepted");
  assert.equal(damageOf(none.engine, none.id("t1")), 0);
});

clause(BARDUSE, "1:rule", "it cannot inflict more than 2 damage in total, nor damage a character that was not picked", () => {
  const tooMuch = barduseBoard();
  refused(() => deployBarduse(tooMuch.engine, tooMuch.id, ["t1", "t2"], { t1: 2, t2: 1 }));
  const outsider = barduseBoard();
  refused(() => deployBarduse(outsider.engine, outsider.id, ["t1", "t2"], { t3: 2 }));
});

clause(BARDUSE, "1:rule", "lethal damage destroys the character", () => {
  const { engine, id } = barduseBoard();
  deployBarduse(engine, id, ["weak"], { weak: 2 });
  assert.equal(zoneOf(engine, id("weak")), "discard");
});

clause(BARDUSE, "0:ability", "at most 2 characters may be picked, only characters (any controller)", () => {
  const { engine, id } = barduseBoard();
  refused(() => play(engine, P1, id("fb"), { selected: { picked: [id("t1"), id("t2"), id("t3")] } }), "three picks");
  for (const key of ["thing", "place", "faceDown"]) refused(() => play(engine, P1, id("fb"), { selected: { picked: [id(key)] } }), `${key} cannot be picked`);
  refused(() => play(engine, P1, id("fb"), { selected: { picked: [engine.state.players[P2].factionId!] } }), "a faction cannot be picked");
  assert.equal(zoneOf(engine, id("fb")), "hand", "nothing was played");
  assert.equal(ready(engine), 3, "nothing was paid");
  deployBarduse(engine, id, ["mine", "t1"], { mine: 1, t1: 1 }); // control: my own characters may be picked too
  assert.equal(damageOf(engine, id("mine")), 1);
  assert.equal(damageOf(engine, id("t1")), 1);
});

clause(BARDUSE, "0:ability", "Barduse itself cannot be one of its own picks (it is not in play when the pick is made)", () => {
  const { engine, id } = barduseBoard();
  refused(() => play(engine, P1, id("fb"), { selected: { picked: [id("fb")] } }));
  assert.equal(zoneOf(engine, id("fb")), "hand");
});

clause(BARDUSE, "0:ability", "the picks are made when it is played (before the opponent responds); the damage comes when it enters play", () => {
  const { engine, id } = barduseBoard();
  playRaw(engine, P1, id("fb"), { selected: { picked: [id("t1")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("fb")), "deploying");
  assert.equal(damageOf(engine, id("t1")), 0, "no damage yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("fb")), "play");
  drain(engine, (pc) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("t1")]: 2 } } : declineAll(pc)));
  assert.equal(damageOf(engine, id("t1")), 2);
});

clause(BARDUSE, "1:rule", "if a picked character left play in response, the rest still works and nothing breaks", () => {
  const { engine, id } = barduseBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("fb"), { selected: { picked: [id("t1"), id("t2")] } });
  playRaw(engine, P2, id("bounce"), { selected: { t: [id("t1")] } });
  resolvePendingResponses(engine);
  drain(engine, (pc) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("t2")]: 2 } } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(damageOf(engine, id("t2")), 2);
  assert.equal(zoneOf(engine, id("t1")), "hand");
});

clause(BARDUSE, "1:rule", "if you did not pay its cost you cannot inflict damage: put into play by an effect it damages nothing and asks for nothing", () => {
  const putIntoPlay = tactic({
    name: "SummonFromHand",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "summon",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = barduseBoard({ extra: [{ key: "summon", def: putIntoPlay, owner: P1, zone: "hand" }] });
  play(engine, P1, id("summon"), { selected: { t: [id("fb")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("fb")), "play", "Barduse entered play without being deployed");
  assert.equal(engine.state.pendingChoice, undefined, "no damage to divide");
  for (const key of ["t1", "t2", "t3", "weak", "mine"]) assert.equal(damageOf(engine, id(key)), 0, `${key} took no damage`);
});

// =============================================================================
// Hammer Smash
// Tactic, warlord, cost 2, threshold [R][R].
// COST: Flip a coin. If you win X is 2, otherwise X is 1. Pick X or fewer items.
// EFFECT: Destroy the items.
// =============================================================================

const HAMMER = "9457ab04-726b-49b3-8ac4-f15a160fb7fe";

function hammerBoard(opts: { random?: () => number; rage?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    random: opts.random ?? mulberry(31337),
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hs", def: printing(HAMMER), owner: P1, zone: "hand" },
      { key: "i1", def: item({ name: "I1" }), owner: P2, zone: "play" },
      { key: "i2", def: item({ name: "I2" }), owner: P2, zone: "play" },
      { key: "i3", def: item({ name: "I3" }), owner: P2, zone: "play" },
      { key: "m1", def: item({ name: "M1" }), owner: P1, zone: "play" },
      { key: "chr", def: character({ name: "Chr" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "faceDown" })),
      ...bank("rage", opts.rage ?? 2, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** Answers the open "pick X or fewer items" prompt with `keys`. */
function smashPick(engine: SpoilsEngine, id: (key: string) => CardInstanceId, keys: string[]): void {
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: keys.map(id) } } } as never);
  resolvePendingResponses(engine);
}

/** Plays Hammer Smash and returns the open prompt (the coin has been flipped; X items may now be picked). */
function smashPlay(engine: SpoilsEngine, id: (key: string) => CardInstanceId) {
  playRaw(engine, P1, id("hs"));
  const pc = pending(engine);
  assert.ok(pc, "I am asked which items to pick once the coin is flipped");
  return pc;
}

/** Which X the coin gave, found by trying to pick 3, 2 then 1 items on a throwaway board. */
function observedX(random: () => number): number {
  for (const x of [3, 2, 1]) {
    const { engine, id } = hammerBoard({ random });
    smashPlay(engine, id);
    try {
      smashPick(engine, id, ["i1", "i2", "i3"].slice(0, x));
      return x;
    } catch {
      /* too many picks for this roll: try fewer */
    }
  }
  return 0;
}

/** A constant random source for which the flip gives `x`, found by trying a spread of values. */
function randomGiving(x: number): (() => number) | undefined {
  for (const value of [0, 0.1, 0.25, 0.45, 0.55, 0.75, 0.9, 0.99]) {
    if (observedX(() => value) === x) return () => value;
  }
  return undefined;
}

clause(HAMMER, "0:ability", "the coin gives X = 2 on one result and X = 1 on the other (never 0 or 3)", () => {
  const seen = new Set<number>();
  for (const value of [0, 0.1, 0.25, 0.45, 0.55, 0.75, 0.9, 0.99]) seen.add(observedX(() => value));
  assert.deepEqual([...seen].sort(), [1, 2]);
});

clause(HAMMER, "0:ability", "the coin is fair: with the engine's own random stream both X=1 and X=2 occur", () => {
  const seen = new Set<number>();
  for (let seed = 1; seed <= 40 && seen.size < 2; seed++) {
    const { engine, id } = hammerBoard({ random: mulberry(seed * 7919 + 17) });
    smashPlay(engine, id);
    let x = 1;
    try {
      smashPick(engine, id, ["i1", "i2"]);
      x = 2;
    } catch {
      /* X = 1 */
    }
    seen.add(x);
  }
  assert.deepEqual([...seen].sort(), [1, 2]);
});

clause(HAMMER, "0:ability", "X=2: pays 2, destroys the two picked items (the opponent's, into THEIR discard pile) and ends in my discard pile", () => {
  const random = randomGiving(2);
  assert.ok(random, "X = 2 is reachable");
  const { engine, id } = hammerBoard({ random });
  const before = ready(engine);
  smashPlay(engine, id);
  smashPick(engine, id, ["i1", "i2"]);
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(zoneOf(engine, id("i1")), "discard");
  assert.equal(zoneOf(engine, id("i2")), "discard");
  assert.equal(discardOf(engine, P2).includes(id("i1")) && discardOf(engine, P2).includes(id("i2")), true, "into their owner's discard pile");
  assert.equal(zoneOf(engine, id("i3")), "play", "an unpicked item is untouched");
  assert.equal(zoneOf(engine, id("m1")), "play");
  assert.equal(zoneOf(engine, id("hs")), "discard");
});

clause(HAMMER, "0:ability", "X=2: 'X or fewer' — one item, or none, may be picked instead", () => {
  const random = randomGiving(2);
  assert.ok(random, "random");
  const one = hammerBoard({ random });
  smashPlay(one.engine, one.id);
  smashPick(one.engine, one.id, ["i1"]);
  assert.equal(zoneOf(one.engine, one.id("i1")), "discard");
  assert.equal(zoneOf(one.engine, one.id("i2")), "play");

  const none = hammerBoard({ random });
  smashPlay(none.engine, none.id);
  smashPick(none.engine, none.id, []);
  for (const key of ["i1", "i2", "i3", "m1"]) assert.equal(zoneOf(none.engine, none.id(key)), "play", `${key} survives`);
  assert.equal(zoneOf(none.engine, none.id("hs")), "discard", "the tactic is still spent");
});

clause(HAMMER, "0:ability", "X=1: one item is destroyed; picking two is refused", () => {
  const random = randomGiving(1);
  assert.ok(random, "X = 1 is reachable");
  const tooMany = hammerBoard({ random });
  smashPlay(tooMany.engine, tooMany.id);
  refused(() => smashPick(tooMany.engine, tooMany.id, ["i1", "i2"]), "only X = 1 item may be picked");
  assert.equal(zoneOf(tooMany.engine, tooMany.id("i1")), "play");

  const { engine, id } = hammerBoard({ random });
  smashPlay(engine, id);
  smashPick(engine, id, ["i3"]);
  assert.equal(zoneOf(engine, id("i3")), "discard");
  assert.equal(zoneOf(engine, id("i1")), "play");
  assert.equal(zoneOf(engine, id("i2")), "play");
});

clause(HAMMER, "0:ability", "three items are never allowed", () => {
  for (const x of [1, 2]) {
    const random = randomGiving(x);
    assert.ok(random, "random");
    const { engine, id } = hammerBoard({ random });
    smashPlay(engine, id);
    refused(() => smashPick(engine, id, ["i1", "i2", "i3"]), `X = ${x}`);
    const control = hammerBoard({ random });
    smashPlay(control.engine, control.id);
    smashPick(control.engine, control.id, ["i1"]); // control: one item is always fine
    assert.equal(zoneOf(control.engine, control.id("i1")), "discard");
  }
});

clause(HAMMER, "0:ability", "items of both players may be picked (mine too), and only items", () => {
  const random = randomGiving(2);
  assert.ok(random, "random");
  const mixed = hammerBoard({ random });
  smashPlay(mixed.engine, mixed.id);
  smashPick(mixed.engine, mixed.id, ["i1", "m1"]);
  assert.equal(zoneOf(mixed.engine, mixed.id("m1")), "discard", "my own item");
  assert.equal(discardOf(mixed.engine, P1).includes(mixed.id("m1")), true, "into MY discard pile");
  assert.equal(zoneOf(mixed.engine, mixed.id("i1")), "discard");

  for (const key of ["chr", "place", "faceDown"]) {
    const board = hammerBoard({ random });
    smashPlay(board.engine, board.id);
    refused(() => smashPick(board.engine, board.id, [key]), `${key} is not an item`);
  }
  const faction = hammerBoard({ random });
  smashPlay(faction.engine, faction.id);
  refused(() => faction.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: [faction.engine.state.players[P2].factionId!] } } } as never), "a faction is not an item");
});

clause(HAMMER, "0:ability", "the destruction happens at resolution: the picked items are still in play while the opponent can respond", () => {
  const random = randomGiving(2);
  assert.ok(random, "random");
  const { engine, id } = hammerBoard({ random });
  playRaw(engine, P1, id("hs"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: [id("i1"), id("i2")] } } } as never);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(ready(engine), 0, "the 2 resources are paid");
  assert.equal(zoneOf(engine, id("i1")), "play", "not destroyed yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("i1")), "discard");
});

clause(HAMMER, "0:ability", "'Flip a coin' is a real coin flip: the game records a coin flip by me (Two-Headed Coin / Red Raven can see it)", () => {
  const { engine, id } = hammerBoard();
  smashPlay(engine, id);
  const flips = eventsOf(engine, "coinFlipped");
  assert.equal(flips.length, 1, "exactly one coin was flipped");
  assert.equal(flips[0].playerId, P1, "by me, the player of the tactic");
});

clause(HAMMER, "0:ability", "is refused one resource short of 2 and without [R][R] (however many other resources), allowed with exactly [R][R]", () => {
  const short = hammerBoard({ rage: 1 });
  refused(() => playRaw(short.engine, P1, short.id("hs")));
  assert.equal(zoneOf(short.engine, short.id("hs")), "hand");
  assert.equal(short.engine.getCardPlayability(P1, short.id("hs")).playable, false);

  const noThreshold = hammerBoard({ rage: 1, greed: 8 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("hs")), "one [R] is not [R][R]");
  assert.equal(noThreshold.engine.getCardPlayability(P1, noThreshold.id("hs")).playable, false);

  const exact = hammerBoard({ rage: 2 });
  assert.equal(exact.engine.getCardPlayability(P1, exact.id("hs")).playable, true);
  smashPlay(exact.engine, exact.id);
  smashPick(exact.engine, exact.id, []);
  assert.equal(zoneOf(exact.engine, exact.id("hs")), "discard");
});

clause(HAMMER, "0:ability", "with no items in play it can still be played (it flips a coin and picks nothing)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "hs", def: printing(HAMMER), owner: P1, zone: "hand" }, { key: "chr", def: character({ name: "Chr" }), owner: P2, zone: "play" }, ...bank("rage", 2, P1)]
  });
  playRaw(engine, P1, id("hs"));
  if (pending(engine)) smashPick(engine, id, []);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("hs")), "discard");
  assert.equal(zoneOf(engine, id("chr")), "play");
});

// =============================================================================
// Kettinger
// Item, warlord, gear, cost 2, threshold [R].
// ATTACH TO CHARACTER
// The attached character gains 2 strength.
// HANDOFF -- COST: Pay 3. Deplete a character you control that is not in a battle.
// EFFECT: Attach this card to the character.
// =============================================================================

const KETTINGER = "5bec2993-a7b0-4ad5-9561-ff218c61de11";

function kettingerBoard(opts: { rage?: number; greed?: number; zone?: "hand" | "play"; host?: string; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "kt", def: printing(KETTINGER), owner: P1, zone: opts.zone ?? "hand", attachedToKey: opts.zone === "play" ? opts.host ?? "mine" : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine3", def: character({ name: "Mine3", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "faceDown" })),
      ...bank("rage", opts.rage ?? 2, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const hostOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].attachedTo;
const strengthOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.getStat(cardId, "strength");
const handoff = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, wearer: string) => activate(engine, P1, id("kt"), "kettinger-handoff", { selected: { newWearer: [id(wearer)] } });

clause(KETTINGER, "0:attach", "deploys for its printed cost of 2 and [R], attached to the chosen character", () => {
  const { engine, id } = kettingerBoard();
  const before = ready(engine);
  play(engine, P1, id("kt"), { selected: { attachTo: [id("mine")] } });
  assert.equal(zoneOf(engine, id("kt")), "play");
  assert.equal(before - ready(engine), 2);
  assert.equal(hostOf(engine, id("kt")), id("mine"), "attached to the picked character");

  const short = kettingerBoard({ rage: 1 });
  refused(() => play(short.engine, P1, short.id("kt"), { selected: { attachTo: [short.id("mine")] } }));
  assert.equal(zoneOf(short.engine, short.id("kt")), "hand");
  const noThreshold = kettingerBoard({ rage: 0, greed: 8 });
  refused(() => play(noThreshold.engine, P1, noThreshold.id("kt"), { selected: { attachTo: [noThreshold.id("mine")] } }));
  assert.equal(noThreshold.engine.getCardPlayability(P1, noThreshold.id("kt")).playable, false);
});

clause(KETTINGER, "0:attach", "it may be attached to ANY character: the opponent's too", () => {
  const { engine, id } = kettingerBoard();
  play(engine, P1, id("kt"), { selected: { attachTo: [id("foe")] } });
  assert.equal(hostOf(engine, id("kt")), id("foe"));
  assert.equal(controllerOf(engine, id("kt")), P1, "I still control Kettinger");
  assert.equal(strengthOf(engine, id("foe")), 5, "the opponent's character gains the 2 strength");
});

clause(KETTINGER, "0:attach", "it can only be attached to a character: not an item, a location, a face-down resource or a faction", () => {
  const { engine, id } = kettingerBoard();
  for (const key of ["thing", "place", "faceDown"]) refused(() => play(engine, P1, id("kt"), { selected: { attachTo: [id(key)] } }), `${key} is not a character`);
  refused(() => play(engine, P1, id("kt"), { selected: { attachTo: [engine.state.players[P2].factionId!] } }), "a faction cannot be the host");
  refused(() => play(engine, P1, id("kt"), { selected: { attachTo: [] } }), "a host must be chosen");
  refused(() => play(engine, P1, id("kt"), { selected: { attachTo: [id("mine"), id("foe")] } }), "only one host");
  assert.equal(zoneOf(engine, id("kt")), "hand", "nothing was played");
  assert.equal(ready(engine), 2, "nothing was paid");
});

clause(KETTINGER, "0:attach", "with no character in play to attach to it cannot be deployed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "kt", def: printing(KETTINGER), owner: P1, zone: "hand" }, { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" }, ...bank("rage", 2, P1)]
  });
  refused(() => play(engine, P1, id("kt"), { selected: { attachTo: [id("thing")] } }));
  refused(() => play(engine, P1, id("kt")));
  assert.equal(zoneOf(engine, id("kt")), "hand");
});

clause(KETTINGER, "0:attach", "when the host is destroyed, Kettinger is destroyed with it (into its owner's discard pile)", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", extra: [{ key: "kill", def: killer(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("kt")), "discard");
  assert.equal(discardOf(engine, P1).includes(id("kt")), true);
});

clause(KETTINGER, "0:attach", "when the host is returned to hand, Kettinger leaves play the same way: it goes to its owner's HAND (CR 301.4a)", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.equal(zoneOf(engine, id("kt")), "hand", "Kettinger leaves play the same way its host did: to its owner's hand");
});

clause(KETTINGER, "1:rule", "the attached character gains 2 strength — and only that stat", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine" });
  assert.equal(strengthOf(engine, id("mine")), 4, "2 + 2");
  assert.equal(engine.getStat(id("mine"), "life"), 4);
  assert.equal(engine.getStat(id("mine"), "speed"), 2);
});

clause(KETTINGER, "1:rule", "other characters (mine, the opponent's) gain nothing", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine" });
  assert.equal(strengthOf(engine, id("mine2")), 1);
  assert.equal(strengthOf(engine, id("foe")), 3);
  assert.equal(strengthOf(engine, id("foe2")), 1);
});

clause(KETTINGER, "1:rule", "an opponent's host gains the strength too (Kettinger gives it to whoever wears it)", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "foe" });
  assert.equal(strengthOf(engine, id("foe")), 5);
  assert.equal(strengthOf(engine, id("mine")), 2);
});

clause(KETTINGER, "1:rule", "the bonus is real in a battle: a 1-strength host with Kettinger deals 3 damage to a blocker", () => {
  const { engine, id } = kettingerBoard({
    turn: 2,
    zone: "play",
    host: "mine2",
    extra: [{ key: "wall", def: character({ name: "Wall", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  fight(engine, P1, [id("mine2")], { type: "faction", playerId: P2 }, [id("wall")]);
  assert.equal(damageOf(engine, id("wall")), 3, "1 + 2 strength");
});

clause(KETTINGER, "1:rule", "the bonus ends when Kettinger leaves play", () => {
  const bounceItem = tactic({
    name: "BounceItem",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", extra: [{ key: "bounce", def: bounceItem, owner: P1, zone: "hand" }] });
  assert.equal(strengthOf(engine, id("mine")), 4);
  play(engine, P1, id("bounce"), { selected: { t: [id("kt")] } });
  assert.equal(zoneOf(engine, id("kt")), "hand");
  assert.equal(strengthOf(engine, id("mine")), 2, "back to its printed strength");
});

clause(KETTINGER, "2:ability:kettinger-handoff", "pays 3, depletes the chosen character, and Kettinger moves to it (the old host loses the 2 strength, the new one gains it)", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", rage: 5 });
  const before = ready(engine);
  handoff(engine, id, "mine2");
  assert.equal(before - ready(engine), 3, "COST: pay 3");
  assert.equal(isDepleted(engine, id("mine2")), true, "COST: the chosen character is depleted");
  assert.equal(hostOf(engine, id("kt")), id("mine2"), "attached to the character");
  assert.equal(strengthOf(engine, id("mine")), 2, "the old host loses the bonus");
  assert.equal(strengthOf(engine, id("mine2")), 3, "the new host gains it (1 + 2)");
  assert.equal(isDepleted(engine, id("mine")), false, "the old host is not depleted");
  assert.equal(zoneOf(engine, id("kt")), "play");
});

clause(KETTINGER, "2:ability:kettinger-handoff", "works when Kettinger is on an OPPONENT's character: I can take it back to one of mine", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "foe", rage: 5 });
  assert.equal(strengthOf(engine, id("foe")), 5);
  handoff(engine, id, "mine");
  assert.equal(hostOf(engine, id("kt")), id("mine"));
  assert.equal(strengthOf(engine, id("foe")), 3);
  assert.equal(strengthOf(engine, id("mine")), 4);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "the new wearer must be a character I control: not the opponent's, an item, a location, a face-down resource or a faction", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", rage: 5 });
  for (const key of ["foe", "thing", "place", "faceDown"]) refused(() => handoff(engine, id, key), `${key} cannot be the new wearer`);
  refused(() => activate(engine, P1, id("kt"), "kettinger-handoff", { selected: { newWearer: [engine.state.players[P1].factionId!] } }), "a faction cannot be the new wearer");
  refused(() => activate(engine, P1, id("kt"), "kettinger-handoff", { selected: { newWearer: [] } }), "a wearer is required");
  refused(() => activate(engine, P1, id("kt"), "kettinger-handoff", { selected: { newWearer: [id("mine2"), id("mine3")] } }), "only one");
  assert.equal(hostOf(engine, id("kt")), id("mine"), "nothing moved");
  assert.equal(ready(engine), 5, "nothing was paid");
  handoff(engine, id, "mine3"); // control
  assert.equal(hostOf(engine, id("kt")), id("mine3"));
});

clause(KETTINGER, "2:ability:kettinger-handoff", "the new wearer must be able to be depleted: an already-depleted character is refused", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", rage: 5, extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  refused(() => handoff(engine, id, "tired"));
  assert.equal(hostOf(engine, id("kt")), id("mine"));
  assert.equal(ready(engine), 5);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "the new wearer must not be in a battle: an attacker is refused, a bystander is accepted", () => {
  const { engine, id } = kettingerBoard({ turn: 2, zone: "play", host: "mine", rage: 5 });
  declareAttackBy(engine, P1, [id("mine2")]);
  declareBlockersBy(engine, P2, [id("foe")]);
  refused(() => handoff(engine, id, "mine2"), "mine2 is in the battle");
  refused(() => handoff(engine, id, "mine2"), "(still refused)");
  assert.equal(hostOf(engine, id("kt")), id("mine"));
  assert.equal(ready(engine), 5, "nothing was paid");
  useAbilityRaw(engine, P1, id("kt"), "kettinger-handoff", { selected: { newWearer: [id("mine3")] } });
  settleStack(engine);
  assert.equal(hostOf(engine, id("kt")), id("mine3"), "a character not in the battle can be the new wearer");
});

clause(KETTINGER, "2:ability:kettinger-handoff", "the current wearer may be chosen: it is depleted and Kettinger stays on it", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", rage: 5 });
  handoff(engine, id, "mine");
  assert.equal(hostOf(engine, id("kt")), id("mine"));
  assert.equal(isDepleted(engine, id("mine")), true);
  assert.equal(strengthOf(engine, id("mine")), 4);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "is refused one resource short of 3, and allowed with exactly 3", () => {
  const short = kettingerBoard({ zone: "play", host: "mine", rage: 2 });
  refused(() => handoff(short.engine, short.id, "mine2"));
  assert.equal(isDepleted(short.engine, short.id("mine2")), false, "not depleted by a refused use");
  assert.equal(hostOf(short.engine, short.id("kt")), short.id("mine"));
  assert.equal(ready(short.engine), 2);

  const exact = kettingerBoard({ zone: "play", host: "mine", rage: 3 });
  handoff(exact.engine, exact.id, "mine2");
  assert.equal(hostOf(exact.engine, exact.id("kt")), exact.id("mine2"));
  assert.equal(ready(exact.engine), 0);
});

clause(KETTINGER, "2:ability:kettinger-handoff", "the costs are paid when it is used; Kettinger moves when the ability resolves", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", rage: 3 });
  useAbilityRaw(engine, P1, id("kt"), "kettinger-handoff", { selected: { newWearer: [id("mine2")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(ready(engine), 0, "3 paid up front");
  assert.equal(isDepleted(engine, id("mine2")), true, "the character is depleted up front");
  assert.equal(hostOf(engine, id("kt")), id("mine"), "not moved yet");
  resolvePendingResponses(engine);
  assert.equal(hostOf(engine, id("kt")), id("mine2"));
});

clause(KETTINGER, "2:ability:kettinger-handoff", "only its controller can use it, and not from my hand", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", rage: 5, turn: 2, active: P2, extra: bank("rage", 5, P2) });
  refused(() => activate(engine, P2, id("kt"), "kettinger-handoff", { selected: { newWearer: [id("foe")] } }), "the opponent cannot use my Kettinger");
  assert.equal(hostOf(engine, id("kt")), id("mine"));

  const inHand = kettingerBoard({ rage: 5 });
  refused(() => handoff(inHand.engine, inHand.id, "mine2"));
});

clause(KETTINGER, "2:ability:kettinger-handoff", "can be used again to move on once the next wearer is ready (each use needs a fresh ready character)", () => {
  const { engine, id } = kettingerBoard({ zone: "play", host: "mine", rage: 9 });
  handoff(engine, id, "mine2");
  handoff(engine, id, "mine3");
  assert.equal(hostOf(engine, id("kt")), id("mine3"));
  refused(() => handoff(engine, id, "mine2"), "mine2 was depleted by the first handoff");
  assert.equal(ready(engine), 3, "two uses cost 6");
});

// =============================================================================
// Menacing Mauler
// Character, warlord, cost 5, threshold [R][R][R], 5/3/4 (strength / speed / life), berserker.
// "If this card is blocked, inflict 1 damage to each member of the blocking party."
// =============================================================================

const MAULER = "7e3dff77-f6f5-4c8c-bdc6-4163e2f46071";

function maulerBoard(opts: { extra?: CardPlacement[]; blockerLife?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "mm", def: printing(MAULER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: opts.blockerLife ?? 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: opts.blockerLife ?? 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(MAULER, "0:rule", "deploys for its printed cost of 5 and [R][R][R], and has its printed stats", () => {
  deploysForPrintedCost(MAULER);
  hasPrintedStats(MAULER);
});

clause(MAULER, "0:rule", "blocked by one character: that blocker takes 1 damage (as soon as blockers are declared)", () => {
  const { engine, id } = maulerBoard();
  declareAttackBy(engine, P1, [id("mm")]);
  assert.equal(damageOf(engine, id("b1")), 0, "control: nothing before the block");
  declareBlockersBy(engine, P2, [id("b1")]);
  assert.equal(damageOf(engine, id("b1")), 1, "inflicted when the block is declared, before any battle damage");
  assert.equal(damageOf(engine, id("idle")), 0, "a character that is not blocking is untouched");
  assert.equal(damageOf(engine, id("mm")), 0);
});

clause(MAULER, "0:rule", "blocked by two characters: EACH member of the blocking party takes 1 damage", () => {
  const { engine, id } = maulerBoard();
  declareAttackBy(engine, P1, [id("mm")]);
  declareBlockersBy(engine, P2, [id("b1"), id("b2")]);
  assert.equal(damageOf(engine, id("b1")), 1);
  assert.equal(damageOf(engine, id("b2")), 1);
  assert.equal(damageOf(engine, id("idle")), 0);
});

clause(MAULER, "0:rule", "the 1 damage is on top of the battle damage: a blocker is hit by 1, then by Mauler's 5", () => {
  const { engine, id } = maulerBoard();
  fight(engine, P1, [id("mm")], { type: "faction", playerId: P2 }, [id("b1")]);
  assert.equal(damageOf(engine, id("b1")), 6, "1 from the rule + 5 battle damage");
});

clause(MAULER, "0:rule", "a blocker with 1 life is destroyed by it before battle damage", () => {
  const { engine, id } = maulerBoard({ blockerLife: 1 });
  declareAttackBy(engine, P1, [id("mm")]);
  declareBlockersBy(engine, P2, [id("b1"), id("b2")]);
  assert.equal(zoneOf(engine, id("b1")), "discard");
  assert.equal(zoneOf(engine, id("b2")), "discard");
  assert.equal(zoneOf(engine, id("idle")), "play");
});

clause(MAULER, "0:rule", "not blocked: nobody takes the 1 damage", () => {
  const { engine, id } = maulerBoard();
  const influenceBefore = influence(engine, P2);
  declareAttackBy(engine, P1, [id("mm")]);
  declareBlockersBy(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("b1")) + damageOf(engine, id("b2")) + damageOf(engine, id("idle")), 0);
  assert.equal(influence(engine, P2), influenceBefore - 5, "it hit the faction for its strength");
});

clause(MAULER, "0:rule", "in a party with another attacker, a blocked party still triggers it (this card is blocked)", () => {
  const { engine, id } = maulerBoard();
  declareAttackBy(engine, P1, [id("mm"), id("ally")]);
  declareBlockersBy(engine, P2, [id("b1")]);
  assert.equal(damageOf(engine, id("b1")), 1);
});

clause(MAULER, "0:rule", "only when THIS card is blocked: another attacker being blocked while Mauler stays home does nothing", () => {
  const { engine, id } = maulerBoard();
  declareAttackBy(engine, P1, [id("ally")]);
  declareBlockersBy(engine, P2, [id("b1")]);
  assert.equal(damageOf(engine, id("b1")), 0);
});

clause(MAULER, "0:rule", "only when it is BLOCKED: as a blocker itself it deals no extra damage to the attacker", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mm", def: printing(MAULER), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("atk")], { type: "faction", playerId: P1 });
  declareBlockersBy(engine, P1, [id("mm")]);
  assert.equal(damageOf(engine, id("atk")), 0, "no 'blocked' damage: Mauler is the blocker");
});

clause(MAULER, "0:rule", "the blocking party is the one damaged: an opposing Mauler blocked by MY characters damages mine", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mm", def: printing(MAULER), owner: P2, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("mm")], { type: "faction", playerId: P1 });
  declareBlockersBy(engine, P1, [id("b1"), id("b2")]);
  assert.equal(damageOf(engine, id("b1")), 1);
  assert.equal(damageOf(engine, id("b2")), 1);
});

// =============================================================================
// Raging Bask
// Character, warlord, cost 6, threshold [R][R], 4/3/4 (strength / speed / life), dragon.
// "If this card is blocked, you may assign its damage to the faction or location you
// are attacking instead of the blocking party."
// =============================================================================

const BASK = "2a9daa10-ec29-4d9f-b578-f86028adcce3";

function baskBoard(opts: { extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active,
    cards: [
      { key: "rb", def: printing(BASK), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

/** The legal targets for the first damage source of the open battle step. */
function baskTargets(engine: SpoilsEngine, sourceId: CardInstanceId) {
  const view = engine.getBattleView();
  assert.ok(view, "a battle is in progress");
  return view.damageSources.find((source) => source.cardId === sourceId)?.legalTargets;
}

clause(BASK, "0:rule", "deploys for its printed cost of 6 and [R][R], and has its printed stats", () => {
  deploysForPrintedCost(BASK);
  hasPrintedStats(BASK);
});

clause(BASK, "0:rule", "blocked while attacking a faction: it may assign its damage to that faction instead of the blocker", () => {
  const { engine, id } = baskBoard();
  const before = influence(engine, P2);
  declareAttackBy(engine, P1, [id("rb")]);
  declareBlockersBy(engine, P2, [id("blk")]);
  resolvePendingResponses(engine);
  const targets = baskTargets(engine, id("rb"));
  assert.ok(targets?.some((t) => t.type === "faction" && t.playerId === P2), "the attacked faction is a legal target");
  assert.ok(targets?.some((t) => t.type === "card" && t.cardId === id("blk")), "...and so is the blocker (it MAY assign to the target instead)");
  engine.perform({ type: "assignBattleDamage", playerId: P1, assignments: [{ sourceId: id("rb"), target: { type: "faction", playerId: P2 }, amount: 4 }] });
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), before - 4, "the faction lost 4 influence");
  assert.equal(damageOf(engine, id("blk")), 0, "the blocker took none of Bask's damage");
});

clause(BASK, "0:rule", "...it may still assign its damage to the blocker as usual ('may')", () => {
  const { engine, id } = baskBoard();
  const before = influence(engine, P2);
  declareAttackBy(engine, P1, [id("rb")]);
  declareBlockersBy(engine, P2, [id("blk")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "assignBattleDamage", playerId: P1, assignments: [{ sourceId: id("rb"), target: { type: "card", cardId: id("blk") }, amount: 4 }] });
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("blk")), 4);
  assert.equal(influence(engine, P2), before);
});

clause(BASK, "0:rule", "blocked while attacking a location: it may assign its damage to that location instead", () => {
  const { engine, id } = baskBoard();
  declareAttackBy(engine, P1, [id("rb")], { type: "card", cardId: id("place") });
  declareBlockersBy(engine, P2, [id("blk")]);
  resolvePendingResponses(engine);
  const targets = baskTargets(engine, id("rb"));
  assert.ok(targets?.some((t) => t.type === "card" && t.cardId === id("place")), "the attacked location is a legal target");
  assert.ok(targets?.some((t) => t.type === "card" && t.cardId === id("blk")), "targets?.some((t) => t.type === \"card\" && t.cardId === id(\"blk\"))");
  engine.perform({ type: "assignBattleDamage", playerId: P1, assignments: [{ sourceId: id("rb"), target: { type: "card", cardId: id("place") }, amount: 4 }] });
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("place")), 4, "the location took the damage");
  assert.equal(damageOf(engine, id("blk")), 0);
});

clause(BASK, "0:rule", "blocked by several characters: still may assign everything to the faction", () => {
  const { engine, id } = baskBoard();
  const before = influence(engine, P2);
  declareAttackBy(engine, P1, [id("rb")]);
  declareBlockersBy(engine, P2, [id("blk"), id("blk2")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "assignBattleDamage", playerId: P1, assignments: [{ sourceId: id("rb"), target: { type: "faction", playerId: P2 }, amount: 4 }] });
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), before - 4);
  assert.equal(damageOf(engine, id("blk")) + damageOf(engine, id("blk2")), 0);
});

clause(BASK, "0:rule", "the blocker still deals its own damage to Bask (the redirection is only for Bask's damage)", () => {
  const { engine, id } = baskBoard();
  declareAttackBy(engine, P1, [id("rb")]);
  declareBlockersBy(engine, P2, [id("blk")]);
  resolvePendingResponses(engine);
  engine.perform({ type: "assignBattleDamage", playerId: P1, assignments: [{ sourceId: id("rb"), target: { type: "faction", playerId: P2 }, amount: 4 }] });
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("rb")), 1, "the 1-strength blocker hit Bask");
});

clause(BASK, "0:rule", "not blocked: its damage simply goes to the target (nothing to choose)", () => {
  const { engine, id } = baskBoard();
  const before = influence(engine, P2);
  declareAttackBy(engine, P1, [id("rb")]);
  declareBlockersBy(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influence(engine, P2), before - 4);
});

clause(BASK, "0:rule", "only for Bask: another attacker of mine in the same blocked party must assign to the blockers", () => {
  const { engine, id } = baskBoard();
  declareAttackBy(engine, P1, [id("rb"), id("ally")]);
  declareBlockersBy(engine, P2, [id("blk")]);
  resolvePendingResponses(engine);
  const view = engine.getBattleView();
  const allyTargets = view?.damageSources.find((source) => source.cardId === id("ally"))?.legalTargets ?? [];
  const baskTargetsNow = view?.damageSources.find((source) => source.cardId === id("rb"))?.legalTargets ?? [];
  assert.ok(baskTargetsNow.some((t) => t.type === "faction"), "control: Bask can reach the faction");
  assert.equal(allyTargets.some((t) => t.type === "faction"), false, "the ally cannot");
  assert.ok(allyTargets.some((t) => t.type === "card" && t.cardId === id("blk")), "the ally can hit the blocker");
});

clause(BASK, "0:rule", "it is an attacking ability: as a BLOCKER Bask can only assign to the attackers", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "rb", def: printing(BASK), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(engine, P2, [id("atk")], { type: "faction", playerId: P1 });
  declareBlockersBy(engine, P1, [id("rb")]);
  resolvePendingResponses(engine);
  const view = engine.getBattleView();
  const targets = view?.damageSources.find((source) => source.cardId === id("rb"))?.legalTargets ?? [];
  assert.equal(targets.some((t) => t.type === "faction"), false, "it cannot hit the attacking player's faction");
  assert.deepEqual(targets, [{ type: "card", cardId: id("atk") }]);
});

// =============================================================================
// Rudo Mangod
// Character, warlord, cost 5, threshold [R][R][R], 4/3/3 (strength / speed / life), fighter.
// UNIQUE RUDOLPHUS
// PUNCH -- COST: Pay 2. Deplete this card. Pick a character. X is that character's
// strength. Y is this card's strength.
// EFFECT: Inflict X damage to this card. Inflict Y damage to the character.
// =============================================================================

const RUDO = "ae4f6e1e-19c6-4151-be5c-edc185640deb";

function rudoBoard(opts: { rage?: number; depleted?: boolean; turn?: number; active?: Pid; extra?: CardPlacement[]; targetStrength?: number; targetLife?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "rudo", def: printing(RUDO), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "foe", def: character({ name: "Foe", strength: opts.targetStrength ?? 2, life: opts.targetLife ?? 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "faceDown" })),
      ...bank("rage", opts.rage ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const punch = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, target: string) => activate(engine, P1, id("rudo"), "punch", { selected: { c: [id(target)] } });

clause(RUDO, "0:unique", "deploys for its printed cost of 5 and [R][R][R], and has its printed stats", () => {
  deploysForPrintedCost(RUDO);
  hasPrintedStats(RUDO);
});

clause(RUDO, "0:unique", "a second Rudo Mangod forces a choice: one is kept, the other destroyed", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "r1", def: printing(RUDO), owner: P1, zone: "play" },
      { key: "r2", def: printing(RUDO), owner: P1, zone: "hand" },
      ...bank("rage", 5, P1)
    ]
  });
  play(engine, P1, id("r2"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [id("r1"), id("r2")].sort());
  keepUnique(engine, P1, id("r1"));
  assert.equal(zoneOf(engine, id("r1")), "play");
  assert.equal(zoneOf(engine, id("r2")), "discard");
});

clause(RUDO, "0:unique", "the opponent may control their own Rudo Mangod", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "r1", def: printing(RUDO), owner: P1, zone: "play" },
      { key: "r2", def: printing(RUDO), owner: P2, zone: "hand" },
      ...bank("rage", 5, P2)
    ]
  });
  play(engine, P2, id("r2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("r1")), "play");
  assert.equal(zoneOf(engine, id("r2")), "play");
});

clause(RUDO, "1:ability:punch", "pays 2, depletes Rudo; Rudo takes X (the target's strength 2), the target takes Y (Rudo's strength 4)", () => {
  const { engine, id } = rudoBoard();
  const before = ready(engine);
  punch(engine, id, "foe");
  assert.equal(before - ready(engine), 2, "COST: pay 2");
  assert.equal(isDepleted(engine, id("rudo")), true, "COST: deplete this card");
  assert.equal(damageOf(engine, id("rudo")), 2, "X = the character's strength, inflicted to this card");
  assert.equal(damageOf(engine, id("foe")), 4, "Y = this card's strength, inflicted to the character");
  assert.equal(zoneOf(engine, id("rudo")), "play");
});

clause(RUDO, "1:ability:punch", "a character with 0 strength: X = 0, Rudo takes nothing", () => {
  const { engine, id } = rudoBoard({ targetStrength: 0 });
  punch(engine, id, "foe");
  assert.equal(damageOf(engine, id("rudo")), 0);
  assert.equal(damageOf(engine, id("foe")), 4);
});

clause(RUDO, "1:ability:punch", "a lethal punch back: X >= Rudo's life destroys Rudo, yet the target still takes Y (the values were fixed as costs)", () => {
  const { engine, id } = rudoBoard({ targetStrength: 5 });
  punch(engine, id, "foe");
  assert.equal(zoneOf(engine, id("rudo")), "discard", "5 damage vs 3 life");
  assert.equal(damageOf(engine, id("foe")), 4, "Y was fixed at 4 when the costs were paid");
});

clause(RUDO, "1:ability:punch", "Y is Rudo's CURRENT strength (a +2 pump makes the target take 6) and X the target's current strength", () => {
  const { engine, id } = rudoBoard({ extra: [{ key: "pump", def: pumpTactic(2), owner: P1, zone: "hand" }] });
  play(engine, P1, id("pump"), { selected: { t: [id("rudo")] } });
  assert.equal(strengthOf(engine, id("rudo")), 6);
  punch(engine, id, "foe");
  assert.equal(damageOf(engine, id("foe")), 6);
  assert.equal(damageOf(engine, id("rudo")), 2);
});

clause(RUDO, "1:ability:punch", "X and Y are fixed when the costs are paid: a strength change in response does not change them", () => {
  const { engine, id } = rudoBoard({ extra: [{ key: "pump", def: pumpTactic(3), owner: P2, zone: "hand" }] });
  useAbilityRaw(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  playRaw(engine, P2, id("pump"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(strengthOf(engine, id("foe")), 5, "the pump resolved first");
  assert.equal(zoneOf(engine, id("rudo")), "play", "X was the target's strength WHEN THE COST WAS PAID (2): Rudo (3 life) survives; with the pumped 5 it would die");
  assert.equal(damageOf(engine, id("rudo")), 2, "X was the target's strength WHEN THE COST WAS PAID (2), not after the pump (5)");
  assert.equal(damageOf(engine, id("foe")), 4);
});

clause(RUDO, "1:ability:punch", "Rudo may pick itself: it takes X and Y (both its own strength) and, at 3 life, is destroyed", () => {
  const { engine, id } = rudoBoard();
  punch(engine, id, "rudo");
  assert.equal(zoneOf(engine, id("rudo")), "discard", "4 + 4 damage");
});

clause(RUDO, "1:ability:punch", "any character may be picked: mine too", () => {
  const { engine, id } = rudoBoard();
  punch(engine, id, "mine");
  assert.equal(damageOf(engine, id("mine")), 4);
  assert.equal(damageOf(engine, id("rudo")), 1);
});

clause(RUDO, "1:ability:punch", "the pick must be a character: not an item, a location, a face-down resource or a faction", () => {
  const { engine, id } = rudoBoard();
  for (const key of ["thing", "place", "faceDown"]) refused(() => punch(engine, id, key), `${key} cannot be picked`);
  refused(() => activate(engine, P1, id("rudo"), "punch", { selected: { c: [engine.state.players[P2].factionId!] } }), "a faction cannot be picked");
  refused(() => activate(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe"), id("mine")] } }), "exactly one");
  assert.equal(isDepleted(engine, id("rudo")), false);
  assert.equal(ready(engine), 3, "nothing was paid by the refused attempts");
  punch(engine, id, "foe"); // control: a character pick works
  assert.equal(damageOf(engine, id("foe")), 4);
});

clause(RUDO, "1:ability:punch", "is refused one resource short of 2, and allowed with exactly 2", () => {
  const short = rudoBoard({ rage: 1 });
  refused(() => punch(short.engine, short.id, "foe"));
  assert.equal(isDepleted(short.engine, short.id("rudo")), false, "not depleted by a refused use");
  assert.equal(damageOf(short.engine, short.id("foe")), 0);
  assert.equal(ready(short.engine), 1);

  const exact = rudoBoard({ rage: 2 });
  punch(exact.engine, exact.id, "foe");
  assert.equal(damageOf(exact.engine, exact.id("foe")), 4);
  assert.equal(ready(exact.engine), 0);
});

clause(RUDO, "1:ability:punch", "cannot be used while depleted, and using it depletes (no second punch)", () => {
  const dep = rudoBoard({ depleted: true });
  refused(() => punch(dep.engine, dep.id, "foe"));
  assert.equal(damageOf(dep.engine, dep.id("foe")), 0);
  assert.equal(ready(dep.engine), 3);

  const { engine, id } = rudoBoard({ rage: 5 });
  punch(engine, id, "foe");
  refused(() => punch(engine, id, "foe"));
  assert.equal(damageOf(engine, id("foe")), 4);
});

clause(RUDO, "1:ability:punch", "the costs are paid when it is used; the damage is inflicted at resolution", () => {
  const { engine, id } = rudoBoard();
  useAbilityRaw(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(ready(engine), 1);
  assert.equal(isDepleted(engine, id("rudo")), true);
  assert.equal(damageOf(engine, id("foe")), 0, "no damage yet");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe")), 4);
});

clause(RUDO, "1:ability:punch", "only its controller can use it", () => {
  const { engine, id } = rudoBoard({ turn: 2, active: P2, extra: bank("rage", 3, P2) });
  refused(() => activate(engine, P2, id("rudo"), "punch", { selected: { c: [id("mine")] } }));
  assert.equal(isDepleted(engine, id("rudo")), false);
});

// =============================================================================
// Siege Machine
// Item, warlord, cost 0, threshold [R][R][R][R].
// BATTERING RAM -- COST: Pay 2. Destroy a resource you control.
// EFFECT: Your opponent's faction loses 1 influence.
// =============================================================================

const SIEGE = "6167b5f8-5c3e-4426-8e30-afcd756ffbcb";

function siegeBoard(opts: { rage?: number; greed?: number; oppInfluence?: number; extra?: CardPlacement[]; turn?: number; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: opts.oppInfluence ?? 20 },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "sm", def: printing(SIEGE), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 2, P1),
      ...volition(1, P1).map((p) => ({ ...p, key: "myFaceDown" })),
      ...bank("greed", 2, P2).map((p, i) => ({ ...p, key: `opp${i}` })),
      { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}

const resourcesInPlay = (engine: SpoilsEngine, player: Pid) => engine.state.players[player].play.filter((cardId) => engine.isResource(cardId)).length;
const ram = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, resource: CardInstanceId) => activate(engine, P1, id("sm"), "ram", { selected: { r: [resource] } });
const lastResource = (engine: SpoilsEngine, player: Pid) => [...engine.state.players[player].play].reverse().find((cardId) => engine.isResource(cardId) && !engine.state.cards[cardId].faceDown)!;

clause(SIEGE, "0:ability:ram", "deploys for cost 0 with [R][R][R][R] (spending nothing), refused with only three [R]", () => {
  deploysForPrintedCost(SIEGE);
});

clause(SIEGE, "0:ability:ram", "pays 2, destroys the chosen resource, and the opponent's faction loses exactly 1 influence (mine loses none)", () => {
  const { engine, id } = siegeBoard();
  const total = resourcesInPlay(engine, P1);
  const doomed = lastResource(engine, P1);
  const before = ready(engine);
  ram(engine, id, doomed);
  assert.equal(zoneOf(engine, doomed), "discard", "the chosen resource is destroyed");
  assert.equal(discardOf(engine, P1).includes(doomed), true);
  assert.equal(resourcesInPlay(engine, P1), total - 1, "exactly one of my resources is gone");
  assert.equal(influence(engine, P2), 19, "the opponent's faction lost 1 influence");
  assert.equal(influence(engine, P1), 20);
  assert.ok(before - ready(engine) >= 2, "at least the 2 resources paid are no longer ready");
  assert.equal(attachedCount(engine, P1), 2, "2 resources were paid (attached to the faction)");
  assert.equal(resourcesInPlay(engine, P2), 2, "the opponent's resources are untouched");
});

clause(SIEGE, "0:ability:ram", "any resource of mine: a face-down resource too", () => {
  const { engine, id } = siegeBoard();
  ram(engine, id, id("myFaceDown"));
  assert.equal(zoneOf(engine, id("myFaceDown")), "discard");
  assert.equal(influence(engine, P2), 19);
});

clause(SIEGE, "0:ability:ram", "the destroyed card must be a resource I control: not the opponent's resource, nor a character or an item", () => {
  const { engine, id } = siegeBoard();
  for (const target of [id("opp0"), id("myChar"), id("thing")]) {
    refused(() => ram(engine, id, target), "not one of my resources");
  }
  refused(() => ram(engine, id, engine.state.players[P1].factionId!), "the faction is not a resource");
  refused(() => activate(engine, P1, id("sm"), "ram", { selected: { r: [] } }), "a resource must be chosen");
  assert.equal(influence(engine, P2), 20);
  assert.equal(ready(engine), 7, "no refused attempt spent anything");
  assert.equal(zoneOf(engine, id("opp0")), "play");
});

clause(SIEGE, "0:ability:ram", "exactly one resource is destroyed per use", () => {
  const { engine, id } = siegeBoard();
  const [a, b] = engine.state.players[P1].play.filter((cardId) => engine.isResource(cardId) && !engine.state.cards[cardId].faceDown);
  refused(() => activate(engine, P1, id("sm"), "ram", { selected: { r: [a, b] } }), "two at once");
  assert.equal(zoneOf(engine, a), "play");
  assert.equal(zoneOf(engine, b), "play");
  ram(engine, id, lastResource(engine, P1)); // control: one resource works
  assert.equal(influence(engine, P2), 19);
});

clause(SIEGE, "0:ability:ram", "the destroying is a cost: done when it is used, the influence is lost at resolution", () => {
  const { engine, id } = siegeBoard();
  const doomed = lastResource(engine, P1);
  useAbilityRaw(engine, P1, id("sm"), "ram", { selected: { r: [doomed] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, doomed), "discard", "destroyed up front");
  assert.equal(attachedCount(engine, P1), 2, "2 paid up front");
  assert.equal(influence(engine, P2), 20, "the influence is lost when it resolves");
  resolvePendingResponses(engine);
  assert.equal(influence(engine, P2), 19);
});

function bareSiegeBoard(resources: number) {
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [{ key: "sm", def: printing(SIEGE), owner: P1, zone: "play" }, ...bank("rage", resources, P1)]
  });
}

clause(SIEGE, "0:ability:ram", "numeric costs are paid LAST (CR 406.3a): with exactly 2 ready resources one cannot be destroyed and 2 still paid", () => {
  for (let which = 0; which < 2; which++) {
    const { engine, id } = bareSiegeBoard(2);
    const resources = engine.state.players[P1].play.filter((cardId) => engine.isResource(cardId));
    refused(() => ram(engine, id, resources[which]), `destroying resource ${which} first leaves only 1 resource to pay 2 with`);
    assert.equal(influence(engine, P2), 20, "nothing happened");
    assert.equal(resourcesInPlay(engine, P1), 2, "nothing was destroyed");
  }
});

clause(SIEGE, "0:ability:ram", "with exactly 3 ready resources: one is destroyed, the other two are paid, none is left ready", () => {
  const { engine, id } = bareSiegeBoard(3);
  const resources = engine.state.players[P1].play.filter((cardId) => engine.isResource(cardId));
  ram(engine, id, resources[0]);
  assert.equal(zoneOf(engine, resources[0]), "discard");
  assert.equal(influence(engine, P2), 19);
  assert.equal(resourcesInPlay(engine, P1), 2, "two resources remain in play");
  assert.equal(ready(engine), 0, "both remaining resources were paid (attached to the faction)");
});

clause(SIEGE, "0:ability:ram", "with 5 ready resources: one destroyed, two paid, two left ready (the destroyed one is not among the paid)", () => {
  const { engine, id } = bareSiegeBoard(5);
  const resources = engine.state.players[P1].play.filter((cardId) => engine.isResource(cardId));
  ram(engine, id, resources[4]);
  assert.equal(zoneOf(engine, resources[4]), "discard");
  assert.equal(influence(engine, P2), 19);
  assert.equal(ready(engine), 2);
  assert.equal(attachedCount(engine, P1), 2);
});

clause(SIEGE, "0:ability:ram", "is refused when 2 resources cannot be paid (one ready resource), without spending or destroying anything", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    cards: [
      { key: "sm", def: printing(SIEGE), owner: P1, zone: "play" },
      ...bank("rage", 4, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("rage", 1, P1)
    ]
  });
  const loose = engine.state.players[P1].play.find((cardId) => engine.isResource(cardId) && !engine.state.cards[cardId].attachedTo)!;
  assert.equal(ready(engine), 1);
  refused(() => ram(engine, id, loose));
  assert.equal(zoneOf(engine, loose), "play");
  assert.equal(influence(engine, P2), 20);
});

clause(SIEGE, "0:ability:ram", "an opponent on 1 influence loses the game", () => {
  const { engine, id } = siegeBoard({ oppInfluence: 1 });
  ram(engine, id, lastResource(engine, P1));
  assert.equal(influence(engine, P2), 0);
  assert.equal(engine.state.winner, P1);
});

clause(SIEGE, "0:ability:ram", "it can be used again: each use destroys another resource and costs the opponent another influence", () => {
  const { engine, id } = siegeBoard({ rage: 4, greed: 6 });
  ram(engine, id, lastResource(engine, P1));
  const next = engine.state.players[P1].play.find((cardId) => engine.isResource(cardId) && !engine.state.cards[cardId].attachedTo)!;
  ram(engine, id, next);
  assert.equal(influence(engine, P2), 18);
});

clause(SIEGE, "0:ability:ram", "only its controller can use it", () => {
  const { engine, id } = siegeBoard({ turn: 2, active: P2, extra: bank("rage", 4, P2) });
  refused(() => activate(engine, P2, id("sm"), "ram", { selected: { r: [id("opp0")] } }));
  assert.equal(influence(engine, P1), 20);
});

// =============================================================================
// Skewer
// Tactic, warlord, cost 0, threshold [R].
// COST: Pick a number for X. Pay twice X. Pick a character.
// EFFECT: Inflict X damage to the character.
// =============================================================================

const SKEWER = "0f8f178d-72e2-465c-8275-9b8a3dea0420";

function skewerBoard(opts: { rage?: number; greed?: number; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "sk", def: printing(SKEWER), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...volition(1, P2).map((p) => ({ ...p, key: "faceDown" })),
      ...bank("rage", opts.rage ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

for (const x of [0, 1, 2, 4]) {
  clause(SKEWER, "0:ability", `X=${x}: pays twice X (${2 * x}) and inflicts ${x} damage to the picked character`, () => {
    const { engine, id } = skewerBoard();
    const before = ready(engine);
    play(engine, P1, id("sk"), { variables: { x }, selected: { target: [id("foe")] } });
    assert.equal(before - ready(engine), 2 * x, `X+X = ${2 * x}`);
    assert.equal(damageOf(engine, id("foe")), x);
    assert.equal(zoneOf(engine, id("foe")), "play");
    assert.equal(damageOf(engine, id("weak")), 0, "other characters are untouched");
    assert.equal(zoneOf(engine, id("sk")), "discard", "the tactic ends in its owner's discard pile");
  });
}

clause(SKEWER, "0:ability", "lethal damage destroys the character (X=3 on a 3-life character), X=2 does not", () => {
  const { engine, id } = skewerBoard();
  play(engine, P1, id("sk"), { variables: { x: 3 }, selected: { target: [id("weak")] } });
  assert.equal(zoneOf(engine, id("weak")), "discard");
  const less = skewerBoard();
  play(less.engine, P1, less.id("sk"), { variables: { x: 2 }, selected: { target: [less.id("weak")] } });
  assert.equal(zoneOf(less.engine, less.id("weak")), "play");
});

clause(SKEWER, "0:ability", "any character may be picked: mine too", () => {
  const { engine, id } = skewerBoard();
  play(engine, P1, id("sk"), { variables: { x: 2 }, selected: { target: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2);
});

clause(SKEWER, "0:ability", "the pick must be a character: not an item, a location, a face-down resource or a faction", () => {
  const { engine, id } = skewerBoard();
  for (const key of ["thing", "place", "faceDown"]) refused(() => play(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [id(key)] } }), `${key} cannot be picked`);
  refused(() => play(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [engine.state.players[P2].factionId!] } }), "a faction cannot be picked");
  refused(() => play(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [id("foe"), id("weak")] } }), "exactly one");
  refused(() => play(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [] } }), "a pick is required");
  assert.equal(zoneOf(engine, id("sk")), "hand");
  assert.equal(ready(engine), 8, "nothing was paid");
  play(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [id("foe")] } }); // control: a character pick works
  assert.equal(damageOf(engine, id("foe")), 1);
});

clause(SKEWER, "0:ability", "needs 2X resources: X=3 with 5 resources is refused, with exactly 6 allowed", () => {
  const short = skewerBoard({ rage: 5 });
  refused(() => playRaw(short.engine, P1, short.id("sk"), { variables: { x: 3 }, selected: { target: [short.id("foe")] } }));
  assert.equal(zoneOf(short.engine, short.id("sk")), "hand");
  assert.equal(ready(short.engine), 5);

  const exact = skewerBoard({ rage: 6 });
  play(exact.engine, P1, exact.id("sk"), { variables: { x: 3 }, selected: { target: [exact.id("foe")] } });
  assert.equal(damageOf(exact.engine, exact.id("foe")), 3);
  assert.equal(ready(exact.engine), 0);
});

clause(SKEWER, "0:ability", "needs [R]: refused without it even with plenty of other resources; allowed with one [R] among them", () => {
  const none = skewerBoard({ rage: 0, greed: 8 });
  refused(() => playRaw(none.engine, P1, none.id("sk"), { variables: { x: 1 }, selected: { target: [none.id("foe")] } }));
  assert.equal(none.engine.getCardPlayability(P1, none.id("sk")).playable, false);
  const one = skewerBoard({ rage: 1, greed: 1 });
  play(one.engine, P1, one.id("sk"), { variables: { x: 1 }, selected: { target: [one.id("foe")] } });
  assert.equal(damageOf(one.engine, one.id("foe")), 1);
});

clause(SKEWER, "0:ability", "X cannot be negative", () => {
  const { engine, id } = skewerBoard();
  refused(() => playRaw(engine, P1, id("sk"), { variables: { x: -1 }, selected: { target: [id("foe")] } }));
  assert.equal(zoneOf(engine, id("sk")), "hand");
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(ready(engine), 8, "nothing was paid (or refunded)");
  play(engine, P1, id("sk"), { variables: { x: 0 }, selected: { target: [id("foe")] } }); // control: X = 0 is a legal choice
  assert.equal(zoneOf(engine, id("sk")), "discard");
});

clause(SKEWER, "0:ability", "the 2X is paid when it is played; the damage comes when it resolves", () => {
  const { engine, id } = skewerBoard();
  playRaw(engine, P1, id("sk"), { variables: { x: 3 }, selected: { target: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(ready(engine), 2, "6 paid up front");
  assert.equal(damageOf(engine, id("foe")), 0, "no damage yet");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe")), 3);
});

clause(SKEWER, "0:ability", "as a tactic it can be played in response on the opponent's turn", () => {
  const { engine, id } = skewerBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" }] });
  refused(() => playRaw(engine, P1, id("sk"), { variables: { x: 1 }, selected: { target: [id("atk")] } }), "nothing to respond to yet");
  openDefenderWindow(engine, [id("atk")]);
  playRaw(engine, P1, id("sk"), { variables: { x: 2 }, selected: { target: [id("atk")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("atk")), "discard");
});

// =============================================================================
// Strength In Numbers
// Tactic, warlord, cost 4, threshold [R][R][R].
// COST: Play this only when you are attacking. X is the number of members in the attacking party.
// EFFECT: This turn, all members of the attacking party gain X strength and X life.
// =============================================================================

const NUMBERS = "075dd510-edd1-412a-aff3-a162effd41f6";

function numbersBoard(opts: { rage?: number; greed?: number; party?: string[]; extra?: CardPlacement[] } = {}) {
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "sin", def: printing(NUMBERS), owner: P1, zone: "hand" },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" },
      { key: "home", def: character({ name: "Home", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
  board.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: (opts.party ?? ["a1", "a2"]).map(board.id), target: { type: "faction", playerId: P2 } });
  return board;
}

const statsOf = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];

for (const [party, x] of [
  [["a1"], 1],
  [["a1", "a2"], 2],
  [["a1", "a2", "a3"], 3]
] as const) {
  clause(NUMBERS, "0:ability", `a party of ${x}: X = ${x}, every member gains ${x} strength and ${x} life, nobody else does`, () => {
    const { engine, id } = numbersBoard({ party: [...party] });
    const before = ready(engine);
    const base: Record<string, number[]> = { a1: [2, 4, 3], a2: [1, 3, 2], a3: [1, 2, 1], home: [1, 3, 1], b1: [1, 9, 1] };
    respond(engine, id("sin"));
    assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
    for (const key of Object.keys(base)) {
      const member = (party as readonly string[]).includes(key);
      const [strength, life, speed] = base[key];
      assert.deepEqual(statsOf(engine, id(key)), member ? [strength + x, life + x, speed] : [strength, life, speed], `${key}${member ? " (member)" : ""}`);
    }
    assert.equal(zoneOf(engine, id("sin")), "discard");
  });
}

clause(NUMBERS, "0:ability", "the bonus is real in the battle: a 2-strength lone attacker deals 3 damage", () => {
  const { engine, id } = numbersBoard({ party: ["a1"] });
  respond(engine, id("sin"));
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P2, [id("b1")]);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("b1")), 3, "2 + X(1)");
});

clause(NUMBERS, "0:ability", "the extra life is real: a 4-life attacker with X=2 survives 5 damage", () => {
  const { engine, id } = numbersBoard();
  respond(engine, id("sin"));
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P2, []);
  assert.equal(engine.getStat(id("a1"), "life"), 6);
  assert.equal(engine.getStat(id("a2"), "life"), 5);
});

clause(NUMBERS, "0:ability", "'this turn': the bonus is gone when the next turn starts", () => {
  const { engine, id } = numbersBoard();
  respond(engine, id("sin"));
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P2, []);
  autoResolveBattle(engine);
  assert.deepEqual(statsOf(engine, id("a1")), [4, 6, 3], "still boosted later in the same turn");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.deepEqual(statsOf(engine, id("a1")), [2, 4, 3], "back to normal");
  assert.deepEqual(statsOf(engine, id("a2")), [1, 3, 2]);
});

clause(NUMBERS, "0:ability", "can be played later in the battle too (after blockers are declared), X being the attacking party", () => {
  const { engine, id } = numbersBoard();
  resolvePendingResponses(engine);
  declareBlockersBy(engine, P2, [id("b1")]);
  respond(engine, id("sin"));
  assert.deepEqual(statsOf(engine, id("a1")), [4, 6, 3]);
  assert.deepEqual(statsOf(engine, id("a2")), [3, 5, 2]);
});

clause(NUMBERS, "0:ability", "X is fixed when the cost is paid: a member destroyed in response does not shrink X", () => {
  const { engine, id } = numbersBoard({ party: ["a1", "a2", "a3"], extra: [{ key: "kill", def: killer(), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("sin"));
  playRaw(engine, P2, id("kill"), { selected: { t: [id("a3")] } });
  settleStack(engine);
  assert.equal(zoneOf(engine, id("a3")), "discard", "a member was destroyed in response");
  assert.equal(engine.getStat(id("a1"), "strength"), 2 + 3, "X was 3 (the party size when the cost was paid), not 2");
  assert.equal(engine.getStat(id("a2"), "life"), 3 + 3);
});

clause(NUMBERS, "0:ability", "only when I am attacking: refused as the defender, and outside a battle", () => {
  const defender = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sin", def: printing(NUMBERS), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", life: 9 }), owner: P2, zone: "play" },
      ...bank("rage", 4, P1)
    ]
  });
  openDefenderWindow(defender.engine, [defender.id("atk")]);
  refused(() => playRaw(defender.engine, P1, defender.id("sin")), "I am being attacked");
  assert.equal(zoneOf(defender.engine, defender.id("sin")), "hand");
  assert.equal(ready(defender.engine), 4);

  const idle = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sin", def: printing(NUMBERS), owner: P1, zone: "hand" }, { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }, ...bank("rage", 4, P1)]
  });
  refused(() => playRaw(idle.engine, P1, idle.id("sin")), "no battle");

  const control = numbersBoard(); // control: while I am attacking it can be played
  respond(control.engine, control.id("sin"));
  assert.equal(zoneOf(control.engine, control.id("sin")), "discard");
});

clause(NUMBERS, "0:ability", "is refused one resource short of 4, and allowed with exactly 4", () => {
  const short = numbersBoard({ rage: 3 });
  refused(() => playRaw(short.engine, P1, short.id("sin")));
  assert.equal(zoneOf(short.engine, short.id("sin")), "hand");
  assert.equal(statsOf(short.engine, short.id("a1"))[0], 2);

  const exact = numbersBoard({ rage: 3, greed: 1 });
  respond(exact.engine, exact.id("sin"));
  assert.equal(exact.engine.getStat(exact.id("a1"), "strength"), 4);
});

clause(NUMBERS, "0:ability", "is refused without [R][R][R] even with plenty of other resources; allowed with exactly three [R]", () => {
  const two = numbersBoard({ rage: 2, greed: 6 });
  refused(() => playRaw(two.engine, P1, two.id("sin")));
  assert.equal(two.engine.getCardPlayability(P1, two.id("sin")).playable, false);

  const three = numbersBoard({ rage: 3, greed: 1 });
  assert.equal(three.engine.getCardPlayability(P1, three.id("sin")).playable, true);
});

clause(NUMBERS, "0:ability", "the boost happens at resolution: while the opponent can still respond the party is unchanged", () => {
  const { engine, id } = numbersBoard();
  playRaw(engine, P1, id("sin"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(engine.getStat(id("a1"), "strength"), 2, "not boosted yet");
  settleStack(engine);
  assert.equal(engine.getStat(id("a1"), "strength"), 4);
});

// =============================================================================
// The Tournament Faction
// Faction, Universal.
// STARTING RESOURCES: Any 2 staple resources.
// STARTING DRAW: 8 going first, 9 going second.
// RESTORE RULE: At the start of your turn, restore all your depleted cards and detach all resources from your faction.
// DEVELOP RULE: At the start of your turn, pick one of the following: draw a card or play a resource.
// DRAW -- COST: Pay 3. EFFECT: Draw a card.
// RESOURCE -- COST: Pay 4. EFFECT: Play a resource.
// =============================================================================

const TOURNAMENT = "c6ea7e77-6ac0-4baa-9ba2-866726230426";

// The real staple resources.
const RAGE_CARD = printing("3be26b3f-2c78-4d0c-8849-0b4ca48951fd");
const GREED_CARD = printing("61766da9-6482-4ecb-8306-becda47294ec");
const DECEPTION_CARD = printing("ebcdd443-efdf-4a16-a0b9-b1307cd13d0b");
const ELITISM_CARD = printing("b4ddcf43-e508-4a11-9953-697acdcaf116");
// A resource card that is NOT a staple, and a plain card.
const ODD_RESOURCE = resourceCard({ id: "t104-odd", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER_CARD = character({ id: "t104-filler", name: "Filler" });

const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

// A plain opponent: 2 staples, 7 going first / 8 going second.
const PLAIN_OPP = factionCard({
  id: "t104-plain-opp",
  name: "Plain Opponent",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: {
      startingResources: { count: 2, stapleOnly: true },
      openingHand: { goingFirst: 7, goingSecond: 8 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
    }
  })
});
const plainOppDeck = (): CardDefinition[] => [RAGE_CARD, RAGE_CARD, ...repeat(FILLER_CARD, 40)];
const tournamentSeat = () => ({ faction: printing(TOURNAMENT), deck: [RAGE_CARD, RAGE_CARD, ...repeat(FILLER_CARD, 40)] });

const playCards = (engine: SpoilsEngine, pid: Pid): CardInstanceId[] => engine.state.players[pid].play.filter((cardId) => engine.getDefinition(cardId).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: CardInstanceId[]): string[] => ids.map((cardId) => engine.getDefinition(cardId).name).sort();
const handSize = (engine: SpoilsEngine, pid: Pid): number => engine.state.players[pid].hand.length;
const readyCount = (engine: SpoilsEngine, pid: Pid): number => engine.getAvailableResourceCount(pid);

// --- STARTING RESOURCES: "Any 2 staple resources."

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "starts with 2 staple resources in play (face-up); non-staple resources and other cards are not taken", () => {
  const engine = setupGame(
    { faction: printing(TOURNAMENT), deck: [ODD_RESOURCE, FILLER_CARD, RAGE_CARD, GREED_CARD, ELITISM_CARD, ...repeat(FILLER_CARD, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting resources");
  for (const cardId of mine) {
    assert.ok(["Rage", "Greed", "Elitism"].includes(engine.getDefinition(cardId).name), `${engine.getDefinition(cardId).name} is a staple`);
    assert.equal(engine.state.cards[cardId].faceDown, false, "flipped face-up after setup");
  }
  assert.ok(!namesIn(engine, mine).includes("Odd Resource"), "the non-staple resource is not a staple");
  const total = Object.values(engine.getThresholds(P1)).reduce((sum, n) => sum + (n ?? 0), 0);
  assert.equal(total, 2, "two icons");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the two staples may be of the same kind ('any 2', not 'different')", () => {
  const engine = setupGame(
    { faction: printing(TOURNAMENT), deck: [RAGE_CARD, RAGE_CARD, GREED_CARD, GREED_CARD, ...repeat(FILLER_CARD, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"]);
  assert.equal(engine.getThresholds(P1).rage, 2);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the starting resources come out of the deck (they are not extra cards)", () => {
  const deck = [RAGE_CARD, RAGE_CARD, ...repeat(FILLER_CARD, 40)];
  const engine = setupGame({ faction: printing(TOURNAMENT), deck }, { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.equal(deckOf(engine, P1).length, 42 - 2 - 8, "42 cards, 2 starting resources, 8 in the opening hand");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "with the choose-starting-resources step on, the player picks which 2 staples (two of one kind is legal)", () => {
  const engine = setupGame(
    { faction: printing(TOURNAMENT), deck: [ODD_RESOURCE, RAGE_CARD, RAGE_CARD, RAGE_CARD, GREED_CARD, GREED_CARD, GREED_CARD, ...repeat(FILLER_CARD, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "'any' 2 staples: I am asked which");
  const choice = engine.getStartingResourceChoice(P1);
  assert.ok(choice, "P1 is offered a choice");
  assert.equal(choice.count, 2, "two starting resources");
  assert.equal(choice.candidateCardIds.length, 6, "the six staples in the deck (not the non-staple resource, not the characters)");
  assert.ok(choice.candidateCardIds.every((cardId) => ["Rage", "Greed"].includes(engine.getDefinition(cardId).name)), "choice.candidateCardIds.every((cardId) => [\"Rage\", \"Greed\"].includes(engine.getDefinition(cardId).name))");
  const greeds = choice.candidateCardIds.filter((cardId) => engine.getDefinition(cardId).name === "Greed").slice(0, 2);
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: greeds });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Greed"], "exactly the picked staples are in play");
  assert.equal(handSize(engine, P1), 8, "then the opening hand is drawn");
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the choice must be exactly 2 staple resources from my deck (not 1, not 3, not a non-staple)", () => {
  const engine = setupGame(
    { faction: printing(TOURNAMENT), deck: [ODD_RESOURCE, RAGE_CARD, RAGE_CARD, GREED_CARD, GREED_CARD, ...repeat(FILLER_CARD, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  const [r1, r2, g1] = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const odd = deckOf(engine, P1).find((cardId) => engine.getDefinition(cardId).name === "Odd Resource")!;
  const filler = deckOf(engine, P1).find((cardId) => engine.getDefinition(cardId).name === "Filler")!;
  const choose = (cardIds: string[]) => () => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds });
  refused(choose([r1]), "one is too few", /exactly 2/);
  refused(choose([r1, r2, g1]), "three is too many", /exactly 2/);
  refused(choose([r1, odd]), "a non-staple resource", /staple/);
  refused(choose([r1, filler]), "a non-resource card", /staple/);
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "still waiting for a legal choice");
  assert.equal(playCards(engine, P1).length, 0);
  choose([r1, r2])(); // control: a legal choice is accepted
  assert.equal(playCards(engine, P1).length, 2);
});

clause(TOURNAMENT, "0:rule:STARTING RESOURCES", "the opponent starts with their own resources", () => {
  const engine = setupGame(
    { faction: printing(TOURNAMENT), deck: [RAGE_CARD, RAGE_CARD, ...repeat(FILLER_CARD, 40)] },
    { faction: PLAIN_OPP, deck: [ELITISM_CARD, DECEPTION_CARD, ...repeat(FILLER_CARD, 40)] }
  );
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"]);
});

// --- STARTING DRAW: "8 going first, 9 going second."

clause(TOURNAMENT, "1:rule:STARTING DRAW", "draws 8 cards going first", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P1), 8);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "draws 9 cards going second", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P1), 9);
});

clause(TOURNAMENT, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", () => {
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P2), 8, "opponent going second");
  assert.equal(handSize(setupGame(tournamentSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P2), 7, "opponent going first");
});

// --- RESTORE RULE

function restoreBoard(faction: CardDefinition, active: Pid) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spentResources(P1, 3),
      ...volition(1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1), // not attached: stays that way
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: P2, depleted: true },
      // control differs from ownership: "your depleted cards" are the ones YOU control
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spentResources(P2, 2),
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck")
    ]
  });
}

clause(TOURNAMENT, "2:rule:RESTORE RULE", "at the start of my turn: my depleted cards are restored and every resource is detached from my faction", () => {
  const { engine, id } = restoreBoard(printing(TOURNAMENT), P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "3 rage + 1 face-down resource are attached before my turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "my depleted character is restored");
  assert.equal(engine.state.cards[id("mineItem")].depleted, false, "my depleted item is restored");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control (owned by the opponent) is mine to restore");
  assert.equal(attachedCount(engine, P1), 0, "every resource is detached from my faction (face-up and face-down)");
  assert.equal(readyCount(engine, P1), 6, "all six of my resources are ready again");
});

clause(TOURNAMENT, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", () => {
  const { engine, id } = restoreBoard(printing(TOURNAMENT), P2);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("theirChar")].depleted, true, "'your depleted cards': the opponent's character stays depleted");
  assert.equal(engine.state.cards[id("theirItem")].depleted, true);
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true, "a card I own but the opponent controls is not 'my' card to restore");
  assert.equal(attachedCount(engine, P2), 2, "'your faction': the opponent's resources stay attached");
});

clause(TOURNAMENT, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  const { engine, id } = restoreBoard(printing(TOURNAMENT), P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "my depleted character does not restore at the opponent's turn start");
  assert.equal(engine.state.cards[id("mineItem")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "my resources stay attached at the opponent's turn start");
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true, "nor a card the opponent owns but I control");
  assert.equal(engine.state.cards[id("theirChar")].depleted, false, "(the opponent's own restore rule ran for them)");
  assert.equal(attachedCount(engine, P2), 0);
});

// --- DEVELOP RULE

function developBoard(faction: CardDefinition, active: Pid = P1) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }
    ]
  });
}

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", () => {
  const { engine, id } = developBoard(printing(TOURNAMENT));
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  const theirHand = handSize(engine, P2);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck is the one drawn");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1), "only the top card left the deck");
  assert.equal(handSize(engine, P2), theirHand, "the opponent draws nothing");
  assert.equal(playCards(engine, P1).length, 0, "no resource was played");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", () => {
  const { engine, id } = developBoard(printing(TOURNAMENT));
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  developResource(engine, P1, id("handRes"), false);
  assert.equal(zoneOf(engine, id("handRes")), "play", "the resource is now in play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "played face-up");
  assert.equal(engine.getThresholds(P1).greed, 1, "and it provides its icon");
  assert.equal(handSize(engine, P1), handBefore - 1, "one card left my hand");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "no card was drawn");
  assert.equal(zoneOf(engine, id("handRes2")), "hand", "only one resource is played");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition), even an actual resource card", () => {
  const { engine, id } = developBoard(printing(TOURNAMENT));
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1, "a face-down resource provides one Volition");
  const real = developBoard(printing(TOURNAMENT));
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(real.engine.state.cards[real.id("handRes")].faceDown, true);
  assert.equal(real.engine.getThresholds(P1).volition, 1);
  assert.equal(real.engine.getThresholds(P1).greed ?? 0, 0, "face-down, it no longer provides its Greed");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", () => {
  const { engine, id } = developBoard(printing(TOURNAMENT));
  developResource(engine, P1, id("handChar"), false); // asked to play it face-up
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "only an actual resource card may be played face-up: a non-resource card enters face-down");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
  developResource(engine, P1, id("handRes"), false); // control
  assert.equal(zoneOf(engine, id("handRes")), "play");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "draw OR play a resource: not both", () => {
  const drawn = developBoard(printing(TOURNAMENT));
  developDraw(drawn.engine, P1);
  assert.equal(drawn.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.equal(zoneOf(drawn.engine, drawn.id("handRes")), "hand");

  const played = developBoard(printing(TOURNAMENT));
  const deckBefore = [...deckOf(played.engine, P1)];
  developResource(played.engine, P1, played.id("handRes"), false);
  assert.equal(played.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.deepEqual(deckOf(played.engine, P1), deckBefore);
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "can be used only once per turn", () => {
  const draws = developBoard(printing(TOURNAMENT));
  developDraw(draws.engine, P1);
  const hand = handSize(draws.engine, P1);
  assert.equal(draws.engine.state.pendingChoice, undefined, "a second draw is not offered");
  assert.equal(handSize(draws.engine, P1), hand);
  const plays = developBoard(printing(TOURNAMENT));
  developResource(plays.engine, P1, plays.id("handRes"), false);
  assert.equal(plays.engine.state.pendingChoice, undefined, "a second resource play is not offered");
  assert.equal(zoneOf(plays.engine, plays.id("handRes2")), "hand");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "can be used only on my own turn", () => {
  const { engine, id } = developBoard(printing(TOURNAMENT));
  const handBefore = engine.state.players[P1].hand.length;
  endTurnRaw(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  const pending = engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(pending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.players[P1].hand.length, handBefore, "I draw nothing at the opponent's turn start");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
  const mine = developBoard(printing(TOURNAMENT)); // control: on my own turn the same plays work
  developResource(mine.engine, P1, mine.id("handRes"), false);
  assert.equal(zoneOf(mine.engine, mine.id("handRes")), "play");
});

clause(TOURNAMENT, "3:rule:DEVELOP RULE", "is optional and available again every turn", () => {
  const { engine } = developBoard(printing(TOURNAMENT));
  const hand = handSize(engine, P1);
  endTurn(engine, P1);
  assert.equal(handSize(engine, P1), hand, "skipping it costs nothing and gives nothing");
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(handSize(engine, P1), hand + 1, "available again on my next turn: the Develop Rule offered a draw at the start of my turn");
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(handSize(engine, P1), hand + 2, "and renews every turn");
});

// --- DRAW and RESOURCE abilities

function abilityBoard(faction: CardDefinition, resources: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}

function activateFaction(engine: SpoilsEngine, pid: Pid, abilityId: string, owner: Pid = pid, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({ type: "activateAbility", playerId: pid, cardId: factionOf(engine, owner), abilityId, selected, variables: {} });
  resolvePendingResponses(engine);
}

clause(TOURNAMENT, "4:ability:tournament-draw", "pays exactly 3 resources and draws one card", () => {
  const { engine, id } = abilityBoard(printing(TOURNAMENT), 5);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  assert.equal(readyCount(engine, P1), 5);
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(readyCount(engine, P1), 2, "exactly 3 resources were paid");
  assert.equal(attachedCount(engine, P1), 3, "paid resources are attached to the faction");
  assert.equal(handSize(engine, P1), handBefore + 1, "drew one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1));
  assert.equal(handSize(engine, P2), 1, "the opponent drew nothing");
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "the faction isn't depleted by it");
});

clause(TOURNAMENT, "4:ability:tournament-draw", "is refused when the 3 can't be paid (2 resources, 3 with 2 already spent, none)", () => {
  const two = abilityBoard(printing(TOURNAMENT), 2);
  refused(() => activateFaction(two.engine, P1, "tournament-draw"), "2 resources", /cannot be paid/);
  assert.equal(handSize(two.engine, P1), 2, "nothing is drawn");
  assert.equal(attachedCount(two.engine, P1), 0, "nothing was half-paid");
  assert.equal(readyCount(two.engine, P1), 2);

  const spent = abilityBoard(printing(TOURNAMENT), 4);
  for (const rid of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[rid].attachedTo = factionOf(spent.engine, P1);
  assert.equal(readyCount(spent.engine, P1), 2);
  refused(() => activateFaction(spent.engine, P1, "tournament-draw"), "4 resources, 2 already spent", /cannot be paid/);

  const none = abilityBoard(printing(TOURNAMENT), 0);
  refused(() => activateFaction(none.engine, P1, "tournament-draw"), "no resources", /cannot be paid/);

  const exact = abilityBoard(printing(TOURNAMENT), 3);
  activateFaction(exact.engine, P1, "tournament-draw"); // control
  assert.equal(handSize(exact.engine, P1), 3);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "can be used again the same turn (no once-per-turn limit is printed)", () => {
  const { engine } = abilityBoard(printing(TOURNAMENT), 7);
  const handBefore = handSize(engine, P1);
  activateFaction(engine, P1, "tournament-draw");
  activateFaction(engine, P1, "tournament-draw");
  assert.equal(handSize(engine, P1), handBefore + 2);
  assert.equal(attachedCount(engine, P1), 6);
  assert.equal(readyCount(engine, P1), 1);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "is separate from the Develop Rule (either order)", () => {
  const first = abilityBoard(printing(TOURNAMENT), 3);
  const base = handSize(first.engine, P1);
  activateFaction(first.engine, P1, "tournament-draw");
  assert.ok(developOffers(first.engine, P1).length > 0, "using the ability doesn't use up the Develop Rule");
  developDraw(first.engine, P1);
  assert.equal(handSize(first.engine, P1), base + 2);
  const second = abilityBoard(printing(TOURNAMENT), 3);
  developDraw(second.engine, P1);
  activateFaction(second.engine, P1, "tournament-draw");
  assert.equal(handSize(second.engine, P1), base + 2);
});

clause(TOURNAMENT, "4:ability:tournament-draw", "only its controller can use it", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), ...fillers("theirdeck", 4, P2, "deck")]
  });
  const theirHand = handSize(engine, P2);
  refused(() => activateFaction(engine, P2, "tournament-draw", P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(handSize(engine, P2), theirHand);
  assert.equal(attachedCount(engine, P2), 0);
});

clause(TOURNAMENT, "5:ability:tournament-resource", "pays exactly 4 resources and plays a resource card from my hand face-up", () => {
  const { engine, id } = abilityBoard(printing(TOURNAMENT), 6);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  activateFaction(engine, P1, "tournament-resource", P1, { resource: [id("handRes")] });
  assert.equal(attachedCount(engine, P1), 4, "exactly 4 resources were paid");
  assert.equal(zoneOf(engine, id("handRes")), "play", "the resource was played");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(engine.getThresholds(P1).greed, 1, "providing its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(deckOf(engine, P1), deckBefore, "nothing was drawn");
  assert.equal(zoneOf(engine, id("handChar")), "hand", "only the chosen card was played");
  assert.equal(readyCount(engine, P1), 6 - 4 + 1, "the new resource is ready to pay for things");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "plays a non-resource card face-down as a resource", () => {
  const { engine, id } = abilityBoard(printing(TOURNAMENT), 4);
  activateFaction(engine, P1, "tournament-resource", P1, { resource: [id("handChar")] });
  assert.equal(zoneOf(engine, id("handChar")), "play", "any card can be played as a resource");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "a non-resource goes in face-down");
  assert.equal(engine.getThresholds(P1).volition, 1);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "'Play a resource' lets me choose face-up or face-down for an actual resource card", () => holdResourceFace(() => {
  const { engine, id } = abilityBoard(printing(TOURNAMENT), 4);
  activateFaction(engine, P1, "tournament-resource", P1, { resource: [id("handRes")] });
  const asked = engine.state.pendingChoice !== undefined && zoneOf(engine, id("handRes")) === "hand";
  const faceDown = zoneOf(engine, id("handRes")) === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(TOURNAMENT, "5:ability:tournament-resource", "the card must come from my own hand", () => {
  const { engine, id } = abilityBoard(printing(TOURNAMENT), 4);
  refused(() => activateFaction(engine, P1, "tournament-resource", P1, { resource: [id("theirHand")] }), "the opponent's hand card");
  refused(() => activateFaction(engine, P1, "tournament-resource", P1, { resource: [id("mydeck0")] }), "a card in my deck");
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid by the refused attempts");
  activateFaction(engine, P1, "tournament-resource", P1, { resource: [id("handChar")] }); // control
  assert.equal(zoneOf(engine, id("handChar")), "play");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "is refused when the 4 can't be paid", () => {
  const short = abilityBoard(printing(TOURNAMENT), 3);
  refused(() => activateFaction(short.engine, P1, "tournament-resource", P1, { resource: [short.id("handRes")] }), "3 resources", /cannot be paid/);
  assert.equal(short.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(short.engine, short.id("handRes")), "hand", "no resource was played");
  assert.equal(attachedCount(short.engine, P1), 0);
  assert.equal(readyCount(short.engine, P1), 3);
  const none = abilityBoard(printing(TOURNAMENT), 0);
  refused(() => activateFaction(none.engine, P1, "tournament-resource", P1, { resource: [none.id("handRes")] }), "no resources", /cannot be paid/);
  const exact = abilityBoard(printing(TOURNAMENT), 4);
  activateFaction(exact.engine, P1, "tournament-resource", P1, { resource: [exact.id("handRes")] }); // control
  assert.equal(zoneOf(exact.engine, exact.id("handRes")), "play", "with exactly 4 it works");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "can be used again the same turn", () => {
  const { engine, id } = abilityBoard(printing(TOURNAMENT), 8);
  activateFaction(engine, P1, "tournament-resource", P1, { resource: [id("handRes")] });
  activateFaction(engine, P1, "tournament-resource", P1, { resource: [id("handChar")] });
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(attachedCount(engine, P1), 8, "no once-per-turn limit is printed");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "is separate from the Develop Rule", () => {
  const { engine, id } = abilityBoard(printing(TOURNAMENT), 4);
  activateFaction(engine, P1, "tournament-resource", P1, { resource: [id("handRes")] });
  assert.ok(developOffers(engine, P1).length > 0, "the ability's resource play isn't the Develop Rule's");
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
});

clause(TOURNAMENT, "5:ability:tournament-resource", "only its controller can use it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(TOURNAMENT) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      ...bank("rage", 8, P2),
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
    ]
  });
  refused(() => activateFaction(engine, P2, "tournament-resource", P1, { resource: [id("theirHand")] }), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(attachedCount(engine, P2), 0);
});

// =============================================================================
// Cross-cutting clauses recorded once more per card (see docs/TESTING.md "Systemic root causes")
// =============================================================================

// X is a whole number (CR 410.2, SYS-17): Jackmove, Bladefist Doomwing and Skewer all say "Pick a number for X".
clause(JACKMOVE, "0:ability", "X is a whole number (CR 410.2): a fractional X is refused", () => {
  const { engine, id } = jackmoveBoard();
  const control = jackmoveBoard(); // control: a whole X is accepted
  playRaw(control.engine, P1, control.id("jm"), { variables: { x: 1 } });
  assert.equal(control.engine.state.responseWindow?.priorityPlayerId, P2);
  refused(() => playRaw(engine, P1, id("jm"), { variables: { x: 1.5 } }), "X = 1.5");
  refused(() => playRaw(engine, P1, id("jm"), { variables: { x: 0.5 } }), "X = 0.5");
  assert.equal(zoneOf(engine, id("jm")), "hand", "nothing was played");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
});

clause(BLADEFIST, "1:ability:firebreathing", "X is a whole number (CR 410.2): a fractional X is refused", () => {
  const { engine, id } = bladefistBoard();
  const control = bladefistBoard(); // control: a whole X is accepted
  firebreathing(control.engine, control.id, 1, "foe");
  assert.equal(damageOf(control.engine, control.id("foe")), 1);
  refused(() => activate(engine, P1, id("bd"), "firebreathing", { variables: { x: 1.5 }, selected: { c: [id("foe")] } }), "X = 1.5");
  refused(() => activate(engine, P1, id("bd"), "firebreathing", { variables: { x: 0.5 }, selected: { c: [id("foe")] } }), "X = 0.5");
  assert.equal(isDepleted(engine, id("bd")), false, "nothing was paid");
  assert.equal(damageOf(engine, id("foe")), 0);
});

clause(SKEWER, "0:ability", "X is a whole number (CR 410.2): a fractional X is refused", () => {
  const { engine, id } = skewerBoard();
  const control = skewerBoard(); // control: a whole X is accepted
  play(control.engine, P1, control.id("sk"), { variables: { x: 1 }, selected: { target: [control.id("foe")] } });
  assert.equal(damageOf(control.engine, control.id("foe")), 1);
  refused(() => playRaw(engine, P1, id("sk"), { variables: { x: 1.5 }, selected: { target: [id("foe")] } }), "X = 1.5");
  refused(() => playRaw(engine, P1, id("sk"), { variables: { x: 0.5 }, selected: { target: [id("foe")] } }), "X = 0.5");
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
});

// The cost comes first (SYS-16): the card destroyed for Rapine's cost cannot also be the card it picks.
clause(RAPINE, "0:ability", "the destroy cost comes first: the card destroyed cannot also be the character picked afterwards", () => {
  const control = rapineBoard(); // control: a different sacrifice and pick work
  rapine(control.engine, control.id, "sac", "mine");
  assert.equal(zoneOf(control.engine, control.id("sac")), "discard");
  const { engine, id } = rapineBoard();
  refused(() => play(engine, P1, id("rp"), { selected: { sac: [id("mine")], c: [id("mine")] } }), "the destroyed character is no longer a character in play to pick");
  assert.equal(zoneOf(engine, id("mine")), "play", "nothing was destroyed by a refused play");
  assert.equal(zoneOf(engine, id("rp")), "hand");
  assert.equal(ready(engine), 8, "nothing was paid");
});

// 0 life (SYS-3): Thief Doyen is printed 0 strength / 0 life and only becomes sturdy through its tokens.
clause(DOYEN, "1:rule", "discarding a cost-0 card gives Doyen X = 0 tokens, so 0 life: it is destroyed at once (0 damage >= 0 life)", () => {
  const { engine, id } = doyenBoard();
  deployDoyen(engine, id, "dChar0");
  assert.equal(tokens(engine, id("td")), 0);
  assert.equal(zoneOf(engine, id("td")), "discard", "a character with 0 life is destroyed as soon as it is in play");
});

// Flaming Barduse put into play for free still pays its extra cost (the picks) and so still damages.
clause(BARDUSE, "1:rule", "deployed for free (its cost 'paid' as 0) it still asks for its optional picks and inflicts the damage", () => {
  const freeDeploy = tactic({
    name: "FreeDeploy",
    cost: 0,
    behavior: {
      abilities: [
        { id: "free", type: "activated", effects: [{ type: "deployForFree", player: "controller", maxCost: 99, selector: { owner: "self", zone: "hand", type: "character" } }] }
      ]
    }
  });
  const { engine, id } = barduseBoard({ extra: [{ key: "free", def: freeDeploy, owner: P1, zone: "hand" }] });
  play(engine, P1, id("free"));
  const choice = pending(engine);
  assert.equal(choice?.kind, "deployForFree", "I am offered a free deploy");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("fb"), selected: { picked: [id("t1")] } } } as never);
  resolvePendingResponses(engine);
  drain(engine, (pc) => (pc.kind === "distributeAmong" ? { kind: "distributeAmong", shares: { [id("t1")]: 2 } } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(damageOf(engine, id("t1")), 2, "the picks made as part of the (free) deployment still count");
});

// --- more of the Billionaire's borrowing: items, and the opponent's faction card -----------------

clause(BILLIONAIRE, "1:rule", "'abilities on your opponent's cards': an ITEM's ability can be borrowed too (their resources pay, they draw)", () => {
  const gadget = item({
    name: "Gadget",
    behavior: { abilities: [{ id: "whir", type: "activated", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const { engine, id } = billionaireBoard({ extra: [{ key: "gadget", def: gadget, owner: P2, zone: "play" }] });
  const theirs = ready(engine, P2);
  const mine = ready(engine, P1);
  activate(engine, P1, id("gadget"), "whir");
  assert.equal(theirs - ready(engine, P2), 1, "their resource pays");
  assert.equal(ready(engine, P1), mine, "none of mine");
  assert.equal(handOf(engine, P2).length, 1, "they draw");
  assert.equal(handOf(engine, P1).length, 0);
});

clause(BILLIONAIRE, "1:rule", "the opponent's FACTION is a card too: I can use its printed ability (The Tournament Faction's DRAW) — they pay 3 and they draw", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: printing(TOURNAMENT) },
    turn: 2,
    cards: [
      { key: "bill", def: printing(BILLIONAIRE), owner: P1, zone: "play" },
      ...fillers("a", 4, P1, "deck"),
      ...fillers("b", 4, P2, "deck"),
      ...bank("rage", 5, P1),
      ...bank("rage", 3, P2)
    ]
  });
  const theirs = ready(engine, P2);
  const mine = ready(engine, P1);
  const theirTop = deckOf(engine, P2)[0];
  activate(engine, P1, engine.state.players[P2].factionId!, "tournament-draw");
  assert.equal(theirs - ready(engine, P2), 3, "their faction's DRAW costs THEM 3");
  assert.equal(ready(engine, P1), mine, "none of mine are spent");
  assert.equal(zoneOf(engine, theirTop), "hand", "they drew the top card of their deck");
  assert.equal(handOf(engine, P1).length, 0);
});

clause(BILLIONAIRE, "1:rule", "the same faction ability without The Billionaire is refused (control)", () => {
  const { engine } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: printing(TOURNAMENT) },
    turn: 2,
    cards: [...fillers("b", 4, P2, "deck"), ...bank("rage", 5, P1), ...bank("rage", 3, P2)]
  });
  refused(() => activate(engine, P1, engine.state.players[P2].factionId!, "tournament-draw"), "not my faction's ability");
  assert.equal(ready(engine, P2), 3);
});

