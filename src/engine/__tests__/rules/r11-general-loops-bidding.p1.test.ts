// Batch r11-general-loops-bidding (docs/TESTING.md): CR 101 The Most Important
// Rule, 102 Object of the Game, 103 Deck Construction, 104 Tournaments,
// 105 Errata, 413 Bidding, 414 Action Loops.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import { findDeckConstructionIssues, getMaxCopies, getMinimumDeckSize } from "../../../engine.js";
import {
  buildGame,
  character,
  factionCard,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import { refused, rule, ruleExempt, ruleMismatch, ruleOpen } from "./_rule.js";

const ACTIVATED = (effects: unknown[], extra: Record<string, unknown> = {}) =>
  ({ abilities: [{ id: "go", type: "activated", effects, ...extra }] }) as CardDefinition["behavior"];

/** A tactic that makes `amount` influence of the opponent's faction disappear (damage to the faction). */
const pingOpponent = (name: string, amount: number) =>
  tactic({ name, behavior: ACTIVATED([{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount }]) });

/** Plays the tactic `key` for P1 and lets every response window close. */
function playAndResolve(engine: SpoilsEngine, id: (key: string) => string, key: string): void {
  engine.perform({ type: "playCard", playerId: P1, cardId: id(key) });
  resolvePendingResponses(engine);
}

describe("CR 101 — the most important rule", () => {
  rule("CR 101.1", "a card's text overrides CR 102.1: a faction at 0 influence does not lose while a card says it does not (control: it loses without the card)", () => {
    const shield = character({
      name: "Shield",
      behavior: { abilities: [{ id: "keep", type: "continuous", modifiers: [], preventsDefeat: { player: "self" } }] }
    });
    const withShield = buildGame({
      playerB: { influence: 1 },
      cards: [
        { key: "ping", def: pingOpponent("Ping", 1), owner: P1, zone: "hand" },
        { key: "shield", def: shield, owner: P2 }
      ]
    });
    playAndResolve(withShield.engine, withShield.id, "ping");
    assert.equal(withShield.engine.state.players[P2].influence, 0, "the faction is at 0 influence");
    assert.equal(withShield.engine.state.result, undefined, "the card takes precedence over the rule that 0 influence loses");

    const control = buildGame({
      playerB: { influence: 1 },
      cards: [{ key: "ping", def: pingOpponent("Ping", 1), owner: P1, zone: "hand" }]
    });
    playAndResolve(control.engine, control.id, "ping");
    assert.deepEqual(control.engine.state.result, { outcome: "victory", winners: [P1] }, "control: with no such card the same board ends the game");
  });

  rule("CR 101.1", "a card's text overrides CR 102.1a: with a card that says an empty deck loses, the player with no cards in their deck loses (control: no loss without it)", () => {
    const globe = character({
      name: "Doom Globe",
      behavior: { abilities: [{ id: "doom", type: "continuous", modifiers: [], emptyDeckLoses: true }] }
    });
    const withGlobe = buildGame({
      cards: [
        { key: "globe", def: globe, owner: P1 },
        { key: "top", def: character({ name: "Top" }), owner: P2, zone: "deck" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "deck" },
        { key: "ping", def: pingOpponent("Ping", 0), owner: P1, zone: "hand" }
      ]
    });
    // Both decks hold a card: nobody has run out, so the game goes on.
    playAndResolve(withGlobe.engine, withGlobe.id, "ping");
    assert.equal(withGlobe.engine.state.result, undefined, "no player has an empty deck");

    const empty = buildGame({
      cards: [
        { key: "globe", def: globe, owner: P1 },
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "deck" },
        { key: "ping", def: pingOpponent("Ping", 0), owner: P1, zone: "hand" }
      ]
    });
    playAndResolve(empty.engine, empty.id, "ping");
    assert.equal(empty.engine.state.players[P2].deck.length, 0, "the opponent has no cards in their deck");
    assert.deepEqual(empty.engine.state.result, { outcome: "victory", winners: [P1] }, "the card says the player with an empty deck loses");

    const control = buildGame({
      cards: [
        { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "deck" },
        { key: "ping", def: pingOpponent("Ping", 0), owner: P1, zone: "hand" }
      ]
    });
    playAndResolve(control.engine, control.id, "ping");
    assert.equal(control.engine.state.result, undefined, "control: without the card an empty deck does not lose (CR 102.1a)");
  });

  rule("CR 101.1", "a card's text overrides the rule that any number of characters may attack together: Hangdog Alley limits an attacking party to 1 member (control: 2 attackers without it)", () => {
    const alley = location({
      name: "Solo Alley",
      behavior: {
        abilities: [
          { id: "solo", type: "continuous", modifiers: [], partyRestriction: { role: "attacking", minMembers: 1, maxMembers: 1, scope: "allParties" } }
        ]
      }
    });
    const board = (withAlley: boolean) =>
      buildGame({
        cards: [
          { key: "a", def: character({ name: "A" }), owner: P1 },
          { key: "b", def: character({ name: "B" }), owner: P1 },
          ...(withAlley ? [{ key: "alley", def: alley, owner: P2 }] : [])
        ]
      });
    const control = board(false);
    control.engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [control.id("a"), control.id("b")],
      target: { type: "faction", playerId: P2 }
    });
    assert.ok(control.engine.state.battle, "control: a two-member attacking party is legal by the rules alone");

    const restricted = board(true);
    refused(
      () =>
        restricted.engine.perform({
          type: "declareAttack",
          playerId: P1,
          attackerIds: [restricted.id("a"), restricted.id("b")],
          target: { type: "faction", playerId: P2 }
        }),
      "two attackers while the card allows only 1",
      /at most 1/
    );
    restricted.engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [restricted.id("a")],
      target: { type: "faction", playerId: P2 }
    });
    assert.ok(restricted.engine.state.battle, "a one-member party is still allowed");
  });
});

describe("CR 102 — object of the game", () => {
  rule("CR 102.1", "a faction whose influence is reduced to 0 loses at once, mid-turn: the opponent wins", () => {
    const { engine, id } = buildGame({
      playerB: { influence: 3 },
      cards: [{ key: "ping", def: pingOpponent("Ping", 3), owner: P1, zone: "hand" }]
    });
    playAndResolve(engine, id, "ping");
    assert.equal(engine.state.players[P2].influence, 0, "influence is 0");
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P1] }, "the owner of the 0-influence faction lost");
    assert.equal(engine.state.activePlayerId, P1, "the game ended right away, not at the end of the turn");
    assert.equal(engine.state.turn, 1, "no turn passed");
  });

  rule("CR 102.1", "boundary: a faction at 1 influence has not lost; dropping from 2 to 1 does not end the game, the next point does", () => {
    const { engine, id } = buildGame({
      playerB: { influence: 2 },
      cards: [
        { key: "one", def: pingOpponent("One", 1), owner: P1, zone: "hand" },
        { key: "two", def: pingOpponent("Two", 1), owner: P1, zone: "hand" }
      ]
    });
    playAndResolve(engine, id, "one");
    assert.equal(engine.state.players[P2].influence, 1);
    assert.equal(engine.state.result, undefined, "1 influence left: still in the game");
    playAndResolve(engine, id, "two");
    assert.equal(engine.state.players[P2].influence, 0);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P1] }, "0 influence: lost");
  });

  rule("CR 102.1", "the loser is the owner of the 0-influence faction, whoever caused it: a player who reduces their own faction to 0 loses", () => {
    const selfHarm = tactic({ name: "Self Harm", behavior: ACTIVATED([{ type: "modifyInfluence", player: "controller", amount: -4 }]) });
    const { engine, id } = buildGame({
      playerA: { influence: 4 },
      cards: [{ key: "harm", def: selfHarm, owner: P1, zone: "hand" }]
    });
    playAndResolve(engine, id, "harm");
    assert.equal(engine.state.players[P1].influence, 0);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P2] }, "the opponent of the player who hit 0 wins");
  });

  rule("CR 102.1", "influence lost as a COST also ends the game when it reaches 0", () => {
    const costly = tactic({
      name: "Costly",
      behavior: ACTIVATED([], { costs: [{ type: "loseInfluence", amount: 5 }] })
    });
    const { engine, id } = buildGame({
      playerA: { influence: 5 },
      cards: [{ key: "costly", def: costly, owner: P1, zone: "hand" }]
    });
    playAndResolve(engine, id, "costly");
    assert.equal(engine.state.players[P1].influence, 0);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P2] }, "paying the last of your influence loses the game");
  });

  rule("CR 102.1", "reducing the opponent's faction to 0 in battle wins the game; no further actions are accepted", () => {
    const { engine, id } = buildGame({
      playerB: { influence: 2 },
      cards: [{ key: "hitter", def: character({ name: "Hitter", strength: 2 }), owner: P1 }]
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("hitter")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    // Drive the damage steps by hand: the attacker assigns 2 to the faction.
    for (let guard = 0; engine.state.battle && guard < 50; guard++) {
      if (engine.state.responseWindow) {
        resolvePendingResponses(engine);
        continue;
      }
      const view = engine.getBattleView();
      if (view?.actingPlayerId) {
        engine.perform({
          type: "assignBattleDamage",
          playerId: view.actingPlayerId,
          assignments: view.damageSources
            .filter(s => s.strength > 0 && s.legalTargets.length > 0)
            .map(s => ({ sourceId: s.cardId, target: s.legalTargets[0]!, amount: s.strength }))
        });
      } else {
        engine.perform({ type: "advanceFlow" });
      }
    }
    assert.equal(engine.state.players[P2].influence, 0);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P1] });
    refused(() => engine.perform({ type: "endTurn", playerId: P1 }), "acting after the game has ended", /game|over|ended|winner/i);
  });

  rule("CR 102.1a", "running out of cards does not lose the game: drawing from an empty deck draws nothing and nobody loses", () => {
    const drawThree = tactic({ name: "Draw Three", behavior: ACTIVATED([{ type: "draw", player: "controller", amount: 3 }]) });
    const { engine, id } = buildGame({
      cards: [
        { key: "draw", def: drawThree, owner: P1, zone: "hand" },
        { key: "only", def: character({ name: "Only" }), owner: P1, zone: "deck" }
      ]
    });
    playAndResolve(engine, id, "draw");
    assert.equal(engine.state.players[P1].deck.length, 0, "the deck ran out mid-draw");
    assert.equal(engine.state.cards[id("only")]!.zone, "hand", "the one card that was there was drawn");
    assert.equal(engine.state.result, undefined, "running out of cards is not a loss");
  });

  rule("CR 102.1a", "you simply cannot draw any more: with an empty deck a draw effect puts nothing in hand and the game continues", () => {
    const drawOne = tactic({ name: "Draw One", behavior: ACTIVATED([{ type: "draw", player: "controller", amount: 1 }]) });
    const { engine, id } = buildGame({ cards: [{ key: "draw", def: drawOne, owner: P1, zone: "hand" }] });
    const handBefore = engine.state.players[P1].hand.length;
    playAndResolve(engine, id, "draw");
    assert.equal(engine.state.players[P1].hand.length, handBefore - 1, "the tactic left the hand and nothing came in");
    assert.equal(engine.state.result, undefined);
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2, "play continues into the next turn");
  });

  /** "Inflict N damage to all factions": one forEach over every faction in play, as the real card is authored. */
  const allFactionsLose = (name: string, amount: number) =>
    tactic({
      name,
      behavior: ACTIVATED([
        { type: "forEach", selector: { zone: "play", type: "faction" }, effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount }] }
      ])
    });

  rule("CR 102.2", "if every player in the game loses at the same time, the game is a draw", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [{ key: "mutual", def: allFactionsLose("Mutual", 3), owner: P1, zone: "hand" }]
    });
    playAndResolve(engine, id, "mutual");
    assert.equal(engine.state.players[P1].influence, 0);
    assert.equal(engine.state.players[P2].influence, 0);
    assert.deepEqual(engine.state.result, { outcome: "draw", winners: [] }, "both factions hit 0 together: a draw, not a win for either");
  });

  rule("CR 102.2", "a draw needs both to lose: when only one of the two reaches 0 the other wins (control)", () => {
    const { engine, id } = buildGame({
      playerA: { influence: 4 },
      playerB: { influence: 3 },
      cards: [{ key: "mutual", def: allFactionsLose("Uneven", 3), owner: P1, zone: "hand" }]
    });
    playAndResolve(engine, id, "mutual");
    assert.equal(engine.state.players[P1].influence, 1);
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P1] }, "only the opponent reached 0");
  });

  rule("CR 102.2", "a faction already at 0 that is shielded does not stop the other from losing: only the unshielded player loses (not a draw)", () => {
    const shield = character({
      name: "Keep",
      behavior: { abilities: [{ id: "keep", type: "continuous", modifiers: [], preventsDefeat: { player: "self" } }] }
    });
    const { engine, id } = buildGame({
      playerA: { influence: 3 },
      playerB: { influence: 3 },
      cards: [
        { key: "mutual", def: allFactionsLose("Shielded", 3), owner: P1, zone: "hand" },
        { key: "keep", def: shield, owner: P1 }
      ]
    });
    playAndResolve(engine, id, "mutual");
    assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P1] }, "P2 lost alone, so P1 wins rather than a draw");
  });

  ruleOpen(
    "CR 102.2",
    "RQ-r11-2",
    "'each player's faction loses N influence' written as forEachPlayer + modifyInfluence is one simultaneous loss: a draw",
    () => {
      const mutual = tactic({
        name: "Each Player Loses",
        behavior: ACTIVATED([{ type: "forEachPlayer", effects: [{ type: "modifyInfluence", player: "controller", amount: -3 }] }])
      });
      const { engine, id } = buildGame({
        playerA: { influence: 3 },
        playerB: { influence: 3 },
        cards: [{ key: "mutual", def: mutual, owner: P1, zone: "hand" }]
      });
      playAndResolve(engine, id, "mutual");
      assert.deepEqual(engine.state.result, { outcome: "draw", winners: [] }, "both factions reached 0 within one resolving instruction");
    }
  );
});

/** Synthetic decklist helpers (never the real card data). */
let defCounter = 0;
const filler = (): CardDefinition => {
  defCounter += 1;
  return character({ id: `filler-${defCounter}`, name: `Filler ${defCounter}` });
};
const copiesOf = (card: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => card);
const FACTION = factionCard({ id: "faction-a", name: "Faction A" });
const OTHER_FACTION = factionCard({ id: "faction-b", name: "Faction B" });
const STAPLE = resourceCard({ id: "staple-x", name: "Synthetic Staple", resource: { provides: ["rage"], staple: true } });
const kinds = (cards: readonly CardDefinition[], options?: Parameters<typeof findDeckConstructionIssues>[1]) =>
  findDeckConstructionIssues(cards, { factionRules: false, ...options }).map(issue => issue.kind);
/** A deck of `size` distinct-ish non-faction cards (4 copies each) plus a faction card. */
function deckOf(size: number, faction: CardDefinition = FACTION): CardDefinition[] {
  const cards: CardDefinition[] = [faction];
  while (cards.length - 1 < size) {
    const card = filler();
    cards.push(...copiesOf(card, Math.min(4, size - (cards.length - 1))));
  }
  return cards;
}

describe("CR 103 — deck construction", () => {
  rule(["CR 103.1", "CR 103.1a"], "a Constructed deck uses exactly one faction card: none and two are both reported, one is fine", () => {
    const body = deckOf(75).slice(1);
    assert.deepEqual(kinds([FACTION, ...body], { minimumSize: 75 }), [], "control: one faction card, 75 other cards");
    assert.ok(kinds(body, { minimumSize: 75 }).includes("factionCount"), "no faction card is reported");
    assert.ok(kinds([FACTION, OTHER_FACTION, ...body], { minimumSize: 75 }).includes("factionCount"), "two faction cards are reported");
  });

  rule("CR 103.1b", "a Constructed deck needs at least 75 cards not counting the faction card: 74 is short, 75 and 76 are fine", () => {
    assert.deepEqual(kinds(deckOf(75), { minimumSize: 75 }), [], "exactly 75");
    assert.deepEqual(kinds(deckOf(76), { minimumSize: 75 }), [], "76: there is no maximum");
    assert.deepEqual(kinds(deckOf(74), { minimumSize: 75 }), ["minimumSize"], "74 is one short");
  });

  rule("CR 103.1b", "the faction card does not count toward the 75: 74 other cards plus the faction is still short", () => {
    const deck = deckOf(74);
    assert.equal(deck.length, 75, "75 cards in the list including the faction");
    assert.deepEqual(kinds(deck, { minimumSize: 75 }), ["minimumSize"]);
  });

  rule("CR 103.1b", "there is no maximum deck size", () => {
    assert.deepEqual(kinds(deckOf(400), { minimumSize: 75 }), [], "400 cards");
    assert.equal(getMinimumDeckSize(FACTION), undefined, "no maximum is printed on a faction either");
  });

  rule("CR 103.1c", "no more than 4 copies of a card with the same name: 4 is legal, 5 is reported with the card and the count", () => {
    const card = filler();
    const base = deckOf(75);
    assert.deepEqual(kinds([...base, ...copiesOf(card, 4)], { minimumSize: 75 }), [], "4 copies");
    const issues = findDeckConstructionIssues([...base, ...copiesOf(card, 5)], { factionRules: false, minimumSize: 75 });
    assert.deepEqual(issues.map(i => i.kind), ["copyLimit"], "5 copies");
    assert.equal(issues[0]!.cardId, card.id);
    assert.equal(issues[0]!.count, 5);
    assert.equal(issues[0]!.max, 4);
    assert.equal(getMaxCopies(card), 4, "the limit for an ordinary card is 4");
  });

  rule("CR 103.1c", "the copy limit is per card, not per deck: two different cards at 4 copies each are legal", () => {
    const a = filler();
    const b = filler();
    assert.deepEqual(kinds([...deckOf(75), ...copiesOf(a, 4), ...copiesOf(b, 4)], { minimumSize: 75 }), []);
  });

  rule("CR 103.1c", "staple resources are exempt from the 4-copy limit", () => {
    assert.equal(getMaxCopies(STAPLE), null, "no limit");
    assert.deepEqual(kinds([...deckOf(75), ...copiesOf(STAPLE, 30)], { minimumSize: 75 }), [], "30 staples");
    const nonStaple = resourceCard({ id: "plain-res", name: "Plain Resource", resource: { provides: ["rage"], staple: false } });
    assert.ok(kinds([...deckOf(75), ...copiesOf(nonStaple, 5)], { minimumSize: 75 }).includes("copyLimit"), "control: a non-staple resource is limited");
  });

  rule("CR 103.1c", "a card that specifically notes otherwise is exempt from the 4-copy limit", () => {
    const party = character({ id: "party-clowns", name: "Party Clowns", deckLimit: "unlimited" });
    assert.equal(getMaxCopies(party), null);
    assert.deepEqual(kinds([...deckOf(75), ...copiesOf(party, 12)], { minimumSize: 75 }), [], "12 copies");
  });

  ruleExempt(
    "CR 103.1d",
    "The banned list lives in the official Tournament Rules online; the engine ships no banned list (findDeckConstructionIssues documents that admin-disabled cards are host policy), so there is no engine behavior to verify."
  );

  rule(["CR 103.2", "CR 103.2a"], "a Limited deck also uses exactly one faction card", () => {
    const body = deckOf(40).slice(1);
    assert.deepEqual(kinds([FACTION, ...body], { minimumSize: 40 }), [], "control: one faction card");
    assert.ok(kinds(body, { minimumSize: 40 }).includes("factionCount"), "none");
    assert.ok(kinds([FACTION, OTHER_FACTION, ...body], { minimumSize: 40 }).includes("factionCount"), "two");
  });

  rule("CR 103.2b", "a Limited deck needs at least 40 cards not counting the faction card: 39 is short, 40 is fine", () => {
    assert.deepEqual(kinds(deckOf(40), { minimumSize: 40 }), [], "exactly 40");
    assert.deepEqual(kinds(deckOf(39), { minimumSize: 40 }), ["minimumSize"], "39");
    assert.deepEqual(kinds(deckOf(200), { minimumSize: 40 }), [], "no maximum");
  });

  ruleOpen(
    "CR 103.2c",
    "RQ-r11-1",
    "a Limited deck has no copy limit: 12 copies of an ordinary card are legal",
    () => {
      const card = filler();
      // The engine has no way to say "Limited"; the intended call names a format.
      const issues = findDeckConstructionIssues([...deckOf(40), ...copiesOf(card, 12)], {
        factionRules: false,
        minimumSize: 40,
        format: "limited"
      } as never);
      assert.ok(!issues.some(i => i.kind === "copyLimit"), "no copy limit in Limited");
    }
  );

  ruleExempt(
    "CR 103.2d",
    "Which cards are banned from Constructed or Limited is the official Tournament Rules list; the engine ships no banned list (see CR 103.1d), so there is nothing to verify."
  );

  ruleOpen(
    "CR 103.1b",
    "RQ-r11-1",
    "the engine holds a Constructed deck to 75 cards without being told the minimum",
    () => {
      const issues = findDeckConstructionIssues(deckOf(60), { factionRules: false });
      assert.ok(issues.some(i => i.kind === "minimumSize"), "60 cards is under the Constructed minimum of 75");
    }
  );

  ruleExempt(
    ["CR 103.3", "CR 103.3a"],
    "Two Headed Majig constructed decks are 'Coming Soon' in the Comprehensive Rules: the rule has no content, and the engine is two-player."
  );
});

describe("CR 104 / 105 — tournaments and errata", () => {
  ruleExempt(
    "CR 104.1",
    "A pointer to the Tournament Rules: the document says it covers rules of play only; tournament organisation is outside the engine."
  );
  ruleExempt(
    "CR 105.1",
    "Errata policy: the engine plays whatever card definitions it is given, and keeping those at the latest wording is a data-maintenance task (checked by the card-data audits), not engine behavior."
  );
});
