// Clause tests: batch shade-of-the-devoured-emperor-02, part p1 (groups 1-7, missing clauses only).
// Expected behavior comes from the PRINTED text (see docs/TESTING.md), never from the behavior JSON.

import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import {
  buildGame,
  activate,
  bank,
  character,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  tactic,
  volition
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { answerPending, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import {
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  playRaw
} from "./_battle.js";
import { attachedCount, endTurn, readyCount, spentResources } from "./_turn.js";

// ---------------------------------------------------------------------------------------------
// Printings
// ---------------------------------------------------------------------------------------------

const COUNCIL = "e2b65004-fb6d-40f2-8f4c-18ee79e934fd"; // The Lugubrian Council of Quotidian Affairs: character, cost 2, threshold oooo, 2/3/2, UNIQUE COUNCIL, CONVENE / CAST VOTE / PASS
const THIS_THAT = "684d1547-6f13-461a-b03a-5c1cad4cd4bb"; // This, That, and the Other Thing: tactic, cost 5, threshold ooo
const UNDERWHELMING = "734238ce-7a57-4fda-b9a8-86c4aef822c2"; // Underwhelming Performance: tactic, cost 3, threshold oo
const GARGANTUAN = "0070ffff-bc96-4245-a7e8-d376941be247"; // Undevoted Gargantuan: character, cost 5, threshold oooo, 5/3/5, COVERT
const RITUAL = "ee97a193-2abc-4f68-880f-bb128a536f28"; // Violating Ritual: tactic, cost 3, threshold ooo
const TRINKET = "e7db74e2-02ff-4297-ac9a-860b2bd3c263"; // Voidal Trinket: item, cost 1, threshold oo, AUGUR
const LAW_OFFICE = "6283dc6d-d26b-4f08-9ded-17581481b6e6"; // Ancient and Disreputable Law Office: location, cost 3, threshold g, structure 3, UNIQUE A & D LAW

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

type Id = (key: string) => CardInstanceId;

const resourcesOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => engine.state.players[p].play.filter((c) => engine.isResource(c));
const attachedIdsOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] =>
  resourcesOf(engine, p).filter((c) => engine.state.cards[c].attachedTo !== undefined);
const isAttached = (engine: SpoilsEngine, c: CardInstanceId): boolean => engine.state.cards[c].attachedTo !== undefined;
const handOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => engine.state.players[p].hand;
const deckOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => engine.state.players[p].deck;

/** Deterministic pseudo-random source (LCG), for seeded shuffles. */
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** Placements for `n` rage resources of `owner`'s that are already spent (attached to the faction). */
const spent = (owner: PlayerId, n: number): CardPlacement[] => spentResources(owner, n);

/** A spent FACE-DOWN resource for `owner`. */
const spentFaceDown = (owner: PlayerId): CardPlacement[] =>
  volition(1, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

/** The open prompt must be a "may detach" pick belonging to `who`; answer with `picks`. */
function detachWith(engine: SpoilsEngine, who: PlayerId, picks: CardInstanceId[]): void {
  const pc = pending(engine);
  assert.ok(pc, "a 'may detach up to N resources' prompt is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, who, "the player who may detach is the one asked");
  answerPending(engine, "chooserSelectsTarget", { selected: picks });
}

/** Revealed card-id lists from the game log (`cardsRevealed` events). */
const revealedLists = (engine: SpoilsEngine): string[][] =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "cardsRevealed")
    .map((entry) => [...(entry.event as unknown as { cardIds: string[] }).cardIds]);

/** A synthetic strength booster/weakener gear item (attach to a character). */
const strengthGear = (name: string, amount: number) =>
  item({
    name,
    attachTo: "character",
    behavior: { abilities: [{ id: "gear", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: amount }] }] }
  });

/** A free tactic that destroys one chosen location (decl `t`, ability `k`). */
const razeTactic = () =>
  tactic({
    name: "Raze",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** A free tactic that puts a chosen character from its controller's hand into play (optionally face-down). */
const summonTactic = (faceDown: boolean) =>
  tactic({
    name: faceDown ? "Summon Face-down" : "Summon",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { controller: "self", zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller", ...(faceDown ? { faceDown: true } : {}) }]
        }
      ]
    }
  });

// =============================================================================================
// The Lugubrian Council of Quotidian Affairs
// =============================================================================================

interface CouncilOpts {
  ready?: number;
  tokens?: number;
  oppSpent?: number;
  oppReady?: number;
  random?: () => number;
  extra?: CardPlacement[];
}

function councilBoard(opts: CouncilOpts = {}) {
  const oppSpent = spent(P2, opts.oppSpent ?? 0);
  const oppReady = bank("greed", opts.oppReady ?? 0, P2);
  const built = buildGame({
    ...(opts.random ? { random: opts.random } : {}),
    cards: [
      { key: "co", def: printing(COUNCIL), owner: P1, zone: "play", ...(opts.tokens ? { counters: { token: opts.tokens } } : {}) },
      ...bank("obsession", opts.ready ?? 6, P1),
      ...oppSpent,
      ...oppReady,
      ...(opts.extra ?? [])
    ]
  });
  return { ...built, oppSpent: oppSpent.map((p) => built.id(p.key)), oppReady: oppReady.map((p) => built.id(p.key)) };
}

// --- UNIQUE COUNCIL -------------------------------------------------------------------------

function councilDeployBoard(extra: CardPlacement[]) {
  return buildGame({
    cards: [
      { key: "co", def: printing(COUNCIL), owner: P1, zone: "play" },
      { key: "co2", def: printing(COUNCIL), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1),
      ...extra
    ]
  });
}

clause(COUNCIL, "0:unique", "a second copy of the Council: its controller is asked which to keep, and keeping the new one destroys the old one", () => {
  const { engine, id } = councilDeployBoard([]);
  play(engine, P1, id("co2"));
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("co"), id("co2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("co2") });
  assert.equal(zoneOf(engine, id("co2")), "play");
  assert.equal(zoneOf(engine, id("co")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(COUNCIL, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = councilDeployBoard([]);
  play(engine, P1, id("co2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("co") });
  assert.equal(zoneOf(engine, id("co")), "play");
  assert.equal(zoneOf(engine, id("co2")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(COUNCIL, "0:unique", "the survivor choice may not name a card that isn't one of the copies", () => {
  const { engine, id } = councilDeployBoard([{ key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" }]);
  play(engine, P1, id("co2"));
  refused(() => answerPending(engine, "uniqueSurvivor", { keep: id("bystander") }), "a bystander isn't a candidate");
  assert.ok(pending(engine), "still waiting for a real answer");
  assert.equal(zoneOf(engine, id("bystander")), "play");
  answerPending(engine, "uniqueSurvivor", { keep: id("co") });
  assert.equal(zoneOf(engine, id("co")), "play");
});

clause(COUNCIL, "0:unique", "UNIQUE is per player: the opponent may control their own Council with no choice and no destruction", () => {
  const { engine, id } = councilDeployBoard([{ key: "theirs", def: printing(COUNCIL), owner: P2, zone: "play" }]);
  play(engine, P1, id("co2"));
  const pc = pending(engine);
  assert.ok(pc && pc.kind === "uniqueSurvivor", "pc && pc.kind === \"uniqueSurvivor\"");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("co"), id("co2")].sort(), "only MY copies are candidates");
  answerPending(engine, "uniqueSurvivor", { keep: id("co2") });
  assert.equal(zoneOf(engine, id("theirs")), "play", "the opponent's own copy is untouched");

  // With only the opponent holding a copy, my first copy enters with no prompt at all.
  const solo = buildGame({
    cards: [
      { key: "co2", def: printing(COUNCIL), owner: P1, zone: "hand" },
      { key: "theirs", def: printing(COUNCIL), owner: P2, zone: "play" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(solo.engine, P1, solo.id("co2"));
  assert.equal(solo.engine.state.pendingChoice, undefined, "no uniqueness conflict across players");
  assert.equal(zoneOf(solo.engine, solo.id("co2")), "play");
  assert.equal(zoneOf(solo.engine, solo.id("theirs")), "play");
});

clause(COUNCIL, "0:unique", "the identifier is COUNCIL: another card carrying COUNCIL conflicts, a card with a different identifier does not", () => {
  const board = (unique: string) =>
    buildGame({
      cards: [
        { key: "other", def: character({ name: "Other Councillor", unique }), owner: P1, zone: "play" },
        { key: "co2", def: printing(COUNCIL), owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
  const same = board("council");
  play(same.engine, P1, same.id("co2"));
  const pc = pending(same.engine);
  assert.ok(pc && pc.kind === "uniqueSurvivor", "a different card with the same UNIQUE identifier conflicts");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [same.id("other"), same.id("co2")].sort());

  const different = board("not-council");
  play(different.engine, P1, different.id("co2"));
  assert.equal(different.engine.state.pendingChoice, undefined, "a different identifier doesn't conflict");
  assert.equal(zoneOf(different.engine, different.id("other")), "play");
  assert.equal(zoneOf(different.engine, different.id("co2")), "play");
});

clause(COUNCIL, "0:unique", "deploys for its printed cost 2 with threshold oooo (refused with 1 resource, refused with only 3 obsession), entering play with printed 2 strength / 3 speed / 2 life", () => {
  const council = (obsession: number, other: number) =>
    buildGame({ cards: [{ key: "co", def: printing(COUNCIL), owner: P1, zone: "hand" }, ...bank("obsession", obsession, P1), ...bank("rage", other, P1)] });
  const poor = council(1, 0);
  refused(() => play(poor.engine, P1, poor.id("co")), "1 resource");
  assert.equal(zoneOf(poor.engine, poor.id("co")), "hand");
  const short = council(3, 2);
  refused(() => play(short.engine, P1, short.id("co")), "threshold oooo unmet (3 obsession)");
  assert.equal(zoneOf(short.engine, short.id("co")), "hand");
  const ok = council(4, 0);
  play(ok.engine, P1, ok.id("co"));
  assert.equal(zoneOf(ok.engine, ok.id("co")), "play");
  assert.equal(attachedCount(ok.engine, P1), 2, "cost 2 paid");
  assert.equal(ok.engine.getStat(ok.id("co"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("co"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("co"), "life"), 2);
});

// --- CONVENE ---------------------------------------------------------------------------------

clause(COUNCIL, "1:ability:council-convene", "pays 2 resources, discards exactly the 2 chosen cards from my hand (not the third, nor the opponent's) and puts 2 tokens on this card", () => {
  const { engine, id } = councilBoard({ extra: [...fillers("h", 3, P1, "hand"), ...fillers("oh", 2, P2, "hand")] });
  const oppHand = [...handOf(engine, P2)];
  assert.equal(tokensOn(engine, id("co")), 0);
  activate(engine, P1, id("co"), "council-convene", { selected: { convene: [id("h0"), id("h2")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(attachedCount(engine, P1), 2, "Pay 2: exactly two resources are spent");
  assert.equal(zoneOf(engine, id("h0")), "discard");
  assert.equal(zoneOf(engine, id("h2")), "discard");
  assert.equal(zoneOf(engine, id("h1")), "hand", "the card I didn't choose stays");
  assert.deepEqual(handOf(engine, P2), oppHand, "the opponent's hand is untouched");
  assert.equal(tokensOn(engine, id("co")), 2, "Put 2 tokens on this card");
  assert.equal(zoneOf(engine, id("co")), "play");
});

clause(COUNCIL, "1:ability:council-convene", "the tokens add up: a second CONVENE leaves 4 tokens (and 4 resources spent, 4 cards discarded)", () => {
  const { engine, id } = councilBoard({ extra: fillers("h", 4, P1, "hand") });
  activate(engine, P1, id("co"), "council-convene", { selected: { convene: [id("h0"), id("h1")] } });
  assert.equal(tokensOn(engine, id("co")), 2);
  activate(engine, P1, id("co"), "council-convene", { selected: { convene: [id("h2"), id("h3")] } });
  assert.equal(tokensOn(engine, id("co")), 4);
  assert.equal(attachedCount(engine, P1), 4);
  assert.deepEqual(handOf(engine, P1), []);
});

clause(COUNCIL, "1:ability:council-convene", "the discard cost needs exactly 2 cards of MY hand: one card, a deck card, or the opponent's card is refused (nothing is paid)", () => {
  const board = () => councilBoard({ extra: [...fillers("h", 3, P1, "hand"), ...fillers("d", 2, P1, "deck"), ...fillers("oh", 2, P2, "hand")] });
  const unchanged = (b: ReturnType<typeof board>) => {
    assert.equal(tokensOn(b.engine, b.id("co")), 0, "no tokens");
    assert.equal(attachedCount(b.engine, P1), 0, "nothing was paid");
    assert.equal(handOf(b.engine, P1).length, 3, "no card was discarded");
  };
  for (const [label, picks] of [
    ["only one card", ["h0"]],
    ["a deck card as the second", ["h0", "d0"]],
    ["the opponent's hand card as the second", ["h0", "oh0"]],
    ["three cards", ["h0", "h1", "h2"]]
  ] as const) {
    const b = board();
    refused(() => activate(b.engine, P1, b.id("co"), "council-convene", { selected: { convene: picks.map((k) => b.id(k)) } }), label);
    unchanged(b);
  }
  const ok = board();
  activate(ok.engine, P1, ok.id("co"), "council-convene", { selected: { convene: [ok.id("h0"), ok.id("h1")] } });
  assert.equal(tokensOn(ok.engine, ok.id("co")), 2, "positive control: two cards from my hand works");
});

clause(COUNCIL, "1:ability:council-convene", "with only 1 card in hand the ability can't be used (can't discard 2)", () => {
  const b = councilBoard({ extra: fillers("h", 1, P1, "hand") });
  refused(() => activate(b.engine, P1, b.id("co"), "council-convene", { selected: { convene: [b.id("h0")] } }), "one card in hand");
  assert.equal(tokensOn(b.engine, b.id("co")), 0);
  assert.equal(zoneOf(b.engine, b.id("h0")), "hand");
});

clause(COUNCIL, "1:ability:council-convene", "Pay 2 is a real cost: with only 1 ready resource it's refused (and nothing is discarded); with exactly 2 it works", () => {
  const poor = councilBoard({ ready: 1, extra: fillers("h", 2, P1, "hand") });
  refused(() => activate(poor.engine, P1, poor.id("co"), "council-convene", { selected: { convene: [poor.id("h0"), poor.id("h1")] } }), "1 resource");
  assert.equal(tokensOn(poor.engine, poor.id("co")), 0);
  assert.equal(handOf(poor.engine, P1).length, 2, "the discard wasn't paid either");
  const exact = councilBoard({ ready: 2, extra: fillers("h", 2, P1, "hand") });
  activate(exact.engine, P1, exact.id("co"), "council-convene", { selected: { convene: [exact.id("h0"), exact.id("h1")] } });
  assert.equal(tokensOn(exact.engine, exact.id("co")), 2);
  assert.equal(readyCount(exact.engine, P1), 0);
});

// --- CAST VOTE -------------------------------------------------------------------------------

function voteBoard(opts: { tokens?: number; ready?: number; random?: () => number; plainDeck?: boolean } = {}) {
  return councilBoard({
    tokens: opts.tokens ?? 2,
    ready: opts.ready,
    random: opts.random,
    extra: [
      { key: "t1", def: tactic({ name: "Tactic One" }), owner: P1, zone: "deck" },
      { key: "t2", def: tactic({ name: "Tactic Two" }), owner: P1, zone: "deck" },
      { key: "ch", def: character({ name: "Deck Character" }), owner: P1, zone: "deck" },
      { key: "it", def: item({ name: "Deck Item" }), owner: P1, zone: "deck" },
      ...fillers("f", 6, P1, "deck"),
      { key: "ot", def: tactic({ name: "Opponent Tactic" }), owner: P2, zone: "deck" },
      { key: "dt", def: tactic({ name: "Discarded Tactic" }), owner: P1, zone: "discard" },
      { key: "ht", def: tactic({ name: "Handed Tactic" }), owner: P1, zone: "hand" }
    ]
  });
}
const castVote = (b: ReturnType<typeof voteBoard>, picks: string[]) =>
  activate(b.engine, P1, b.id("co"), "council-cast-vote", { selected: picks.length ? { tac: picks.map((k) => b.id(k)) } : {} });

clause(COUNCIL, "2:ability:council-cast-vote", "pays 2 and removes exactly 2 tokens (4 → 2); the searched tactic goes from my deck to my hand and is revealed", () => {
  const b = voteBoard({ tokens: 4 });
  const deckBefore = [...deckOf(b.engine, P1)];
  const handBefore = [...handOf(b.engine, P1)];
  castVote(b, ["t2"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(b.engine, b.id("co")), 2, "Remove 2 tokens from this card (4 - 2)");
  assert.equal(attachedCount(b.engine, P1), 2, "Pay 2");
  assert.equal(zoneOf(b.engine, b.id("t2")), "hand");
  assert.deepEqual([...handOf(b.engine, P1)].sort(), [...handBefore, b.id("t2")].sort(), "exactly that one card joined my hand");
  assert.equal(deckOf(b.engine, P1).length, deckBefore.length - 1);
  assert.ok(!deckOf(b.engine, P1).includes(b.id("t2")), "!deckOf(b.engine, P1).includes(b.id(\"t2\"))");
  assert.equal(zoneOf(b.engine, b.id("t1")), "deck", "the other tactic stays in the deck");
  assert.deepEqual(revealedLists(b.engine), [[b.id("t2")]], "the found tactic is revealed (once, and only it)");
});

clause(COUNCIL, "2:ability:council-cast-vote", "with exactly 2 tokens: both are removed", () => {
  const b = voteBoard({ tokens: 2 });
  castVote(b, ["t1"]);
  assert.equal(tokensOn(b.engine, b.id("co")), 0);
  assert.equal(zoneOf(b.engine, b.id("t1")), "hand");
});

clause(COUNCIL, "2:ability:council-cast-vote", "needs 2 tokens: with 1 or 0 tokens it's refused (nothing paid, nothing found)", () => {
  for (const tokens of [1, 0]) {
    const b = voteBoard({ tokens });
    refused(() => castVote(b, ["t1"]), `${tokens} token(s)`);
    assert.equal(tokensOn(b.engine, b.id("co")), tokens, "tokens untouched");
    assert.equal(attachedCount(b.engine, P1), 0, "nothing paid");
    assert.equal(zoneOf(b.engine, b.id("t1")), "deck");
  }
});

clause(COUNCIL, "2:ability:council-cast-vote", "Pay 2 is a real cost: with 1 ready resource it's refused and the tokens stay; with exactly 2 it works", () => {
  const poor = voteBoard({ ready: 1 });
  refused(() => castVote(poor, ["t1"]), "1 resource");
  assert.equal(tokensOn(poor.engine, poor.id("co")), 2, "tokens not removed");
  assert.equal(zoneOf(poor.engine, poor.id("t1")), "deck");
  const exact = voteBoard({ ready: 2 });
  castVote(exact, ["t1"]);
  assert.equal(zoneOf(exact.engine, exact.id("t1")), "hand");
  assert.equal(readyCount(exact.engine, P1), 0);
});

clause(COUNCIL, "2:ability:council-cast-vote", "only a TACTIC in MY DECK can be found: a deck character/item, the opponent's deck tactic, my discard-pile tactic and my hand tactic are all refused", () => {
  for (const key of ["ch", "it", "ot", "dt", "ht", "f0"]) {
    const b = voteBoard();
    const handBefore = [...handOf(b.engine, P1)];
    refused(() => castVote(b, [key]), `${key} is not a tactic in my deck`);
    assert.equal(tokensOn(b.engine, b.id("co")), 2, `${key}: tokens untouched after the refusal`);
    assert.deepEqual(handOf(b.engine, P1), handBefore);
  }
  const ok = voteBoard();
  castVote(ok, ["t1"]);
  assert.equal(zoneOf(ok.engine, ok.id("t1")), "hand", "positive control");
});

clause(COUNCIL, "2:ability:council-cast-vote", "finds ONE tactic: two at once are refused", () => {
  const b = voteBoard();
  refused(() => castVote(b, ["t1", "t2"]), "two tactics");
  assert.equal(zoneOf(b.engine, b.id("t1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("t2")), "deck");
});

clause(COUNCIL, "2:ability:council-cast-vote", "the search may fail (CR 312.2): with a tactic present I can find nothing; the costs are still paid and nothing joins my hand", () => {
  const b = voteBoard({ tokens: 2 });
  const handBefore = [...handOf(b.engine, P1)];
  castVote(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(b.engine, b.id("co")), 0, "tokens removed even though nothing was found");
  assert.equal(attachedCount(b.engine, P1), 2);
  assert.deepEqual(handOf(b.engine, P1), handBefore);
  assert.equal(zoneOf(b.engine, b.id("t1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("t2")), "deck");
});

clause(COUNCIL, "2:ability:council-cast-vote", "with no tactic in the deck at all the ability still resolves (costs paid, nothing found)", () => {
  const b = councilBoard({ tokens: 2, extra: [...fillers("f", 5, P1, "deck"), { key: "ch", def: character({ name: "Only Character" }), owner: P1, zone: "deck" }] });
  const handBefore = [...handOf(b.engine, P1)];
  activate(b.engine, P1, b.id("co"), "council-cast-vote", { selected: {} });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(b.engine, b.id("co")), 0);
  assert.deepEqual(handOf(b.engine, P1), handBefore);
  assert.equal(deckOf(b.engine, P1).length, 6);
});

clause(COUNCIL, "2:ability:council-cast-vote", "a searched deck is shuffled afterward (CR 312.1) when a tactic was found", () => {
  const b = voteBoard({ random: lcg(7) });
  const before = [...deckOf(b.engine, P1)];
  castVote(b, ["t1"]);
  const after = deckOf(b.engine, P1);
  assert.deepEqual([...after].sort(), before.filter((c) => c !== b.id("t1")).sort(), "same cards minus the tactic");
  assert.notDeepEqual(after, before.filter((c) => c !== b.id("t1")), "the deck was shuffled");
});

clause(COUNCIL, "2:ability:council-cast-vote", "a searched deck is shuffled afterward (CR 312.1) even when the search fails", () => {
  const b = voteBoard({ random: lcg(7) });
  const before = [...deckOf(b.engine, P1)];
  castVote(b, []);
  const after = deckOf(b.engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(after, before, "the deck was shuffled even though nothing was found");
});

clause(COUNCIL, "2:ability:council-cast-vote", "the opponent's deck is not searched or shuffled", () => {
  const b = voteBoard({ random: lcg(7) });
  const oppDeck = [...deckOf(b.engine, P2)];
  castVote(b, ["t1"]);
  assert.deepEqual(deckOf(b.engine, P2), oppDeck);
});

// --- PASS ------------------------------------------------------------------------------------

interface PassOpts {
  ready?: number;
  oppSpent?: number;
  oppReady?: number;
  extra?: CardPlacement[];
}

function passBoard(opts: PassOpts = {}) {
  return councilBoard({
    ready: opts.ready,
    oppSpent: opts.oppSpent ?? 4,
    oppReady: opts.oppReady ?? 2,
    extra: [
      { key: "tac3", def: tactic({ name: "Cost Three", cost: 3 }), owner: P1, zone: "hand" },
      { key: "tac2", def: tactic({ name: "Cost Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "tac0", def: tactic({ name: "Cost Zero", cost: 0 }), owner: P1, zone: "hand" },
      { key: "hc", def: character({ name: "Hand Character", cost: 3 }), owner: P1, zone: "hand" },
      { key: "dtac", def: tactic({ name: "Discarded Tactic", cost: 3 }), owner: P1, zone: "discard" },
      { key: "s0", def: character({ name: "Str Zero", strength: 0, life: 4 }), owner: P2, zone: "play" },
      { key: "s1", def: character({ name: "Str One", strength: 1, life: 4 }), owner: P2, zone: "play" },
      { key: "s2", def: character({ name: "Str Two", strength: 2, life: 4 }), owner: P2, zone: "play" },
      { key: "s3", def: character({ name: "Str Three", strength: 3, life: 4 }), owner: P2, zone: "play" },
      { key: "s4", def: character({ name: "Str Four", strength: 4, life: 4 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "My Character", strength: 1, life: 4 }), owner: P1, zone: "play" },
      { key: "oitem", def: item({ name: "Opponent Item" }), owner: P2, zone: "play" },
      { key: "oloc", def: location({ name: "Opponent Location" }), owner: P2, zone: "play" },
      { key: "odisc", def: character({ name: "Opponent Discarded", strength: 1 }), owner: P2, zone: "discard" },
      { key: "ohandc", def: character({ name: "Opponent Hand Character", strength: 1 }), owner: P2, zone: "hand" },
      { key: "stolen", def: character({ name: "Stolen", strength: 1, life: 4 }), owner: P2, controller: P1, zone: "play" },
      ...(opts.extra ?? [])
    ]
  });
}
const passRun = (b: ReturnType<typeof passBoard>, tacKey: string, targetKey: string) =>
  activate(b.engine, P1, b.id("co"), "council-pass", { selected: { t: [b.id(tacKey)], v: [b.id(targetKey)] } });

clause(COUNCIL, "3:ability:council-pass", "X = the discarded tactic's cost (3): pays 2, discards that tactic, returns the strength-3 opponent character to its owner's hand, and its controller detaches exactly the 3 chosen resources", () => {
  const b = passBoard();
  const handBefore = [...handOf(b.engine, P2)];
  passRun(b, "tac3", "s3");
  assert.equal(attachedCount(b.engine, P1), 2, "Pay 2");
  assert.equal(zoneOf(b.engine, b.id("tac3")), "discard", "the tactic was discarded as a cost");
  assert.equal(zoneOf(b.engine, b.id("tac2")), "hand", "the other tactics stay");
  assert.equal(zoneOf(b.engine, b.id("s3")), "hand");
  assert.deepEqual([...handOf(b.engine, P2)].sort(), [...handBefore, b.id("s3")].sort(), "it went to its owner's hand");
  const picks = b.oppSpent.slice(0, 3);
  detachWith(b.engine, P2, picks);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const c of picks) assert.equal(isAttached(b.engine, c), false, "the chosen resource was detached");
  assert.equal(isAttached(b.engine, b.oppSpent[3]), true, "the 4th spent resource stays attached");
  for (const c of b.oppReady) assert.equal(isAttached(b.engine, c), false, "ready resources are untouched");
  assert.equal(attachedCount(b.engine, P1), 2, "my own resources are not detached");
});

clause(COUNCIL, "3:ability:council-pass", "'may detach up to X': detaching fewer is allowed (1 of 3), and so is detaching none; the character is returned to hand either way", () => {
  const one = passBoard();
  passRun(one, "tac3", "s3");
  detachWith(one.engine, P2, [one.oppSpent[2]]);
  assert.equal(isAttached(one.engine, one.oppSpent[2]), false);
  assert.equal(attachedIdsOf(one.engine, P2).length, 3, "exactly one resource detached");
  assert.equal(zoneOf(one.engine, one.id("s3")), "hand");

  const none = passBoard();
  passRun(none, "tac3", "s3");
  detachWith(none.engine, P2, []);
  assert.equal(attachedIdsOf(none.engine, P2).length, 4, "nothing detached");
  assert.equal(zoneOf(none.engine, none.id("s3")), "hand");
  assert.equal(none.engine.state.pendingChoice, undefined);
});

clause(COUNCIL, "3:ability:council-pass", "'up to X' is a limit: with X = 3 a fourth pick is refused (the prompt stays open), then 3 are accepted", () => {
  const b = passBoard();
  passRun(b, "tac3", "s3");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: b.oppSpent.slice(0, 4) }), "four picks for X = 3");
  assert.ok(pending(b.engine), "the prompt is still open");
  assert.equal(attachedIdsOf(b.engine, P2).length, 4, "nothing detached by the refused answer");
  detachWith(b.engine, P2, b.oppSpent.slice(0, 3));
  assert.equal(attachedIdsOf(b.engine, P2).length, 1);
});

clause(COUNCIL, "3:ability:council-pass", "X = the tactic's cost: a cost-2 tactic gives X = 2 (strength-3 target refused, strength-2 target and a limit of 2 detaches)", () => {
  const tooStrong = passBoard();
  refused(() => passRun(tooStrong, "tac2", "s3"), "strength 3 > X = 2");
  assert.equal(zoneOf(tooStrong.engine, tooStrong.id("tac2")), "hand", "the cost wasn't paid");
  assert.equal(attachedCount(tooStrong.engine, P1), 0);

  const b = passBoard();
  passRun(b, "tac2", "s2");
  assert.equal(zoneOf(b.engine, b.id("s2")), "hand");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: b.oppSpent.slice(0, 3) }), "three picks for X = 2");
  detachWith(b.engine, P2, b.oppSpent.slice(0, 2));
  assert.equal(attachedIdsOf(b.engine, P2).length, 2, "exactly the two picked were detached");
});

clause(COUNCIL, "3:ability:council-pass", "X = 0 (a cost-0 tactic): only a strength-0 character can be picked and nothing can be detached", () => {
  const tooStrong = passBoard();
  refused(() => passRun(tooStrong, "tac0", "s1"), "strength 1 > X = 0");
  const b = passBoard();
  passRun(b, "tac0", "s0");
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined, "no stuck prompt for a detach of up to 0");
  assert.equal(zoneOf(b.engine, b.id("s0")), "hand");
  assert.equal(attachedIdsOf(b.engine, P2).length, 4, "nothing detached with X = 0");
  assert.equal(zoneOf(b.engine, b.id("tac0")), "discard");
});

clause(COUNCIL, "3:ability:council-pass", "the pick is an opponent's character with strength X or less: strengths 0..3 are pickable for X = 3, strength 4 is refused", () => {
  for (const key of ["s0", "s1", "s2", "s3"]) {
    const b = passBoard();
    passRun(b, "tac3", key);
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} (strength ≤ 3) can be picked`);
  }
  const b = passBoard();
  refused(() => passRun(b, "tac3", "s4"), "strength 4 > X = 3");
  assert.equal(zoneOf(b.engine, b.id("s4")), "play");
  assert.equal(zoneOf(b.engine, b.id("tac3")), "hand", "the discard cost wasn't paid for an illegal pick");
});

clause(COUNCIL, "3:ability:council-pass", "targets: my own character, an opponent's item or location, an opponent's character in the discard pile or hand, and a character the opponent OWNS but I control are all refused", () => {
  for (const key of ["mine", "oitem", "oloc", "odisc", "ohandc", "stolen"]) {
    const b = passBoard();
    refused(() => passRun(b, "tac3", key), `${key} is not an opponent's character in play`);
    assert.equal(attachedCount(b.engine, P1), 0, `${key}: nothing paid`);
    assert.equal(zoneOf(b.engine, b.id("tac3")), "hand");
  }
});

clause(COUNCIL, "3:ability:council-pass", "'strength X or less' compares CURRENT strength: a printed-2 character boosted to 4 is refused for X = 3; a printed-5 character weakened to 2 is allowed", () => {
  const boosted = passBoard({
    extra: [
      { key: "bo", def: character({ name: "Boosted", strength: 2, life: 4 }), owner: P2, zone: "play" },
      { key: "bg", def: strengthGear("Booster2", 2), owner: P2, zone: "play", attachedToKey: "bo" }
    ]
  });
  assert.equal(boosted.engine.getStat(boosted.id("bo"), "strength"), 4, "setup: printed 2 + 2");
  refused(() => passRun(boosted, "tac3", "bo"), "current strength 4 > 3");

  const weakened = passBoard({
    extra: [
      { key: "we", def: character({ name: "Weakened", strength: 5, life: 4 }), owner: P2, zone: "play" },
      { key: "wg", def: strengthGear("Weakener3", -3), owner: P2, zone: "play", attachedToKey: "we" }
    ]
  });
  assert.equal(weakened.engine.getStat(weakened.id("we"), "strength"), 2, "setup: printed 5 - 3");
  passRun(weakened, "tac3", "we");
  drain(weakened.engine, declineAll);
  assert.equal(zoneOf(weakened.engine, weakened.id("we")), "hand");
});

clause(COUNCIL, "3:ability:council-pass", "the discard cost must be a TACTIC from my hand: a non-tactic hand card, a tactic in my discard pile, two tactics, or no tactic are refused", () => {
  for (const [label, picks] of [
    ["a character from hand", ["hc"]],
    ["a tactic that's in the discard pile", ["dtac"]],
    ["two tactics", ["tac3", "tac2"]],
    ["no discard chosen", []]
  ] as const) {
    const b = passBoard();
    refused(
      () => activate(b.engine, P1, b.id("co"), "council-pass", { selected: { ...(picks.length ? { t: picks.map((k) => b.id(k)) } : {}), v: [b.id("s1")] } }),
      label
    );
    assert.equal(zoneOf(b.engine, b.id("s1")), "play", `${label}: target untouched`);
    assert.equal(attachedCount(b.engine, P1), 0, `${label}: nothing paid`);
  }
});

clause(COUNCIL, "3:ability:council-pass", "Pay 2 is a real cost: with 1 ready resource it's refused and the tactic stays in hand; with exactly 2 it works", () => {
  const poor = passBoard({ ready: 1 });
  refused(() => passRun(poor, "tac3", "s3"), "1 resource");
  assert.equal(zoneOf(poor.engine, poor.id("tac3")), "hand");
  assert.equal(zoneOf(poor.engine, poor.id("s3")), "play");
  const exact = passBoard({ ready: 2 });
  passRun(exact, "tac3", "s3");
  assert.equal(zoneOf(exact.engine, exact.id("s3")), "hand");
  assert.equal(readyCount(exact.engine, P1), 0);
});

clause(COUNCIL, "3:ability:council-pass", "the detach is of the controller's OWN faction: my resource can't be picked, and a face-down resource of theirs can be", () => {
  const b = passBoard({ extra: spentFaceDown(P2) });
  const faceDown = attachedIdsOf(b.engine, P2).find((c) => b.engine.state.cards[c].faceDown);
  assert.ok(faceDown, "setup: a spent face-down resource");
  passRun(b, "tac3", "s3");
  const mine = attachedIdsOf(b.engine, P1)[0];
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [mine] }), "my own resource");
  assert.ok(pending(b.engine), "pending(b.engine)");
  detachWith(b.engine, P2, [faceDown]);
  assert.equal(isAttached(b.engine, faceDown), false, "a face-down resource is a resource too");
  assert.equal(isAttached(b.engine, mine), true);
});

clause(COUNCIL, "3:ability:council-pass", "only resources ATTACHED to the faction can be detached: a ready (unattached) resource can't be picked", () => {
  const b = passBoard();
  passRun(b, "tac3", "s3");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.oppReady[0]] }), "a ready resource isn't attached to the faction");
  assert.ok(pending(b.engine), "the prompt stays open for a real answer");
});

clause(COUNCIL, "3:ability:council-pass", "'That character's controller may detach': when the opponent controls a character I OWN, they (the controller) decide, and it goes to its owner's (my) hand", () => {
  const b = passBoard({
    extra: [{ key: "mine2", def: character({ name: "Mine But Theirs", strength: 2, life: 4 }), owner: P1, controller: P2, zone: "play" }]
  });
  passRun(b, "tac3", "mine2");
  assert.equal(zoneOf(b.engine, b.id("mine2")), "hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("mine2")), "returned to its OWNER's hand");
  assert.ok(!handOf(b.engine, P2).includes(b.id("mine2")), "!handOf(b.engine, P2).includes(b.id(\"mine2\"))");
  const pc = pending(b.engine);
  assert.ok(pc, "a detach prompt is open");
  assert.equal(pc.playerId, P2, "the character's CONTROLLER (the opponent) decides about detaching");
});

// =============================================================================================
// This, That, and the Other Thing
// =============================================================================================

function thisThatBoard(opts: { ready?: number; obsession?: number; random?: () => number } = {}) {
  const ready = opts.ready ?? 7;
  const obsession = opts.obsession ?? ready;
  return buildGame({
    ...(opts.random ? { random: opts.random } : {}),
    cards: [
      { key: "tt", def: printing(THIS_THAT), owner: P1, zone: "hand" },
      { key: "t1", def: tactic({ name: "Discarded One" }), owner: P1, zone: "discard" },
      { key: "t2", def: tactic({ name: "Discarded Two" }), owner: P1, zone: "discard" },
      { key: "t3", def: tactic({ name: "Discarded Three" }), owner: P1, zone: "discard" },
      { key: "t4", def: tactic({ name: "Discarded Four" }), owner: P1, zone: "discard" },
      { key: "dc", def: character({ name: "Discarded Character" }), owner: P1, zone: "discard" },
      { key: "ot", def: tactic({ name: "Opponent Discarded" }), owner: P2, zone: "discard" },
      { key: "ht", def: tactic({ name: "Hand Tactic" }), owner: P1, zone: "hand" },
      ...fillers("dk", 7, P1, "deck"),
      ...fillers("ek", 3, P2, "deck"),
      ...bank("obsession", obsession, P1),
      ...bank("rage", ready - obsession, P1)
    ]
  });
}
type TTBoard = ReturnType<typeof thisThatBoard>;
const ttPlay = (b: TTBoard, picks: string[]) => play(b.engine, P1, b.id("tt"), { selected: { three: picks.map((k) => b.id(k)) } });

/** Answers the two "choose one of the picked cards" prompts in order: first → deck, second → face-down resource. */
function ttChoose(b: TTBoard, toDeck: string, toPlay: string): void {
  const first = pending(b.engine);
  assert.ok(first, "the first choice (the card to shuffle into the deck) is open");
  assert.equal(first.kind, "chooserSelectsTarget");
  assert.equal(first.playerId, P1, "I choose");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(toDeck)] });
  const second = pending(b.engine);
  assert.ok(second, "the second choice (the card to put into play face-down) is open");
  assert.equal(second.kind, "chooserSelectsTarget");
  assert.equal(second.playerId, P1);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(toPlay)] });
}

function ttOutcome(deckKey: string, resourceKey: string, handKey: string): void {
  const b = thisThatBoard({ random: lcg(11) });
  const deckBefore = [...deckOf(b.engine, P1)];
  const oppDiscardBefore = [...b.engine.state.players[P2].discard];
  const oppDeckBefore = [...deckOf(b.engine, P2)];
  assert.equal(readyCount(b.engine, P1), 7);
  ttPlay(b, ["t1", "t2", "t3"]);
  ttChoose(b, deckKey, resourceKey);
  assert.equal(b.engine.state.pendingChoice, undefined, "the third card needs no choice");

  assert.equal(attachedCount(b.engine, P1), 5, "the printed cost of 5 is paid");
  // 1 card shuffled into the deck
  assert.equal(zoneOf(b.engine, b.id(deckKey)), "deck", `${deckKey}: shuffled into my deck`);
  assert.equal(deckOf(b.engine, P1).length, deckBefore.length + 1);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...deckBefore, b.id(deckKey)].sort(), "my deck gained exactly that card");
  assert.notDeepEqual(deckOf(b.engine, P1), [...deckBefore, b.id(deckKey)], "...and was shuffled (not just put on the bottom)");
  assert.notDeepEqual(deckOf(b.engine, P1), [b.id(deckKey), ...deckBefore], "...and was shuffled (not just put on top)");
  // 1 card in play under my control as a face-down resource
  const r = b.engine.state.cards[b.id(resourceKey)];
  assert.equal(r.zone, "play", `${resourceKey}: in play`);
  assert.equal(r.faceDown, true, "face-down");
  assert.ok(b.engine.state.players[P1].play.includes(b.id(resourceKey)), "under my control");
  assert.ok(!b.engine.state.players[P2].play.includes(b.id(resourceKey)), "!b.engine.state.players[P2].play.includes(b.id(resourceKey))");
  assert.equal(b.engine.isResource(b.id(resourceKey)), true, "as a resource");
  assert.equal(isAttached(b.engine, b.id(resourceKey)), false, "unspent: available to pay");
  assert.equal(readyCount(b.engine, P1), 3, "7 - 5 spent + the new face-down resource");
  // 1 card into my hand
  assert.equal(zoneOf(b.engine, b.id(handKey)), "hand", `${handKey}: put into my hand`);
  assert.ok(handOf(b.engine, P1).includes(b.id(handKey)), "handOf(b.engine, P1).includes(b.id(handKey))");
  // everything else
  assert.equal(zoneOf(b.engine, b.id("t4")), "discard", "the unpicked fourth tactic stays in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("dc")), "discard");
  assert.equal(zoneOf(b.engine, b.id("tt")), "discard", "the spent tactic itself goes to the discard pile");
  assert.deepEqual(b.engine.state.players[P2].discard, oppDiscardBefore, "the opponent's discard pile is untouched");
  assert.deepEqual(deckOf(b.engine, P2), oppDeckBefore, "the opponent's deck is untouched");
}

clause(THIS_THAT, "0:ability", "of the 3 picked tactics: t1 is shuffled into my deck, t2 goes into play face-down as my resource, t3 goes to my hand (cost 5 paid, others untouched)", () => ttOutcome("t1", "t2", "t3"));
clause(THIS_THAT, "0:ability", "a different distribution (t3 → deck, t1 → face-down resource, t2 → hand): the choices are mine", () => ttOutcome("t3", "t1", "t2"));

clause(THIS_THAT, "0:ability", "each choice takes exactly one of the picked cards: an unpicked card, an already-moved card, two cards, or none are refused", () => {
  const b = thisThatBoard();
  ttPlay(b, ["t1", "t2", "t3"]);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("t4")] }), "t4 wasn't one of the 3 picked");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("t1"), b.id("t2")] }), "two cards for 'shuffle 1 card'");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "'shuffle 1 card' isn't optional");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("t1")] });
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("t1")] }), "t1 already went into the deck");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "'put 1 card into play' isn't optional");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("t2"), b.id("t3")] }), "two cards for 'put 1 card into play'");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("t3")] });
  assert.equal(zoneOf(b.engine, b.id("t2")), "hand", "the card left over goes to my hand");
  assert.equal(b.engine.state.cards[b.id("t3")].faceDown, true);
});

clause(THIS_THAT, "0:ability", "the cost picks exactly 3 tactics from MY discard pile: 2, 4, a non-tactic, the opponent's discard tactic, or a hand tactic are refused", () => {
  for (const [label, picks] of [
    ["only two tactics", ["t1", "t2"]],
    ["four tactics", ["t1", "t2", "t3", "t4"]],
    ["a discarded character among them", ["t1", "t2", "dc"]],
    ["the opponent's discarded tactic among them", ["t1", "t2", "ot"]],
    ["a tactic from my hand among them", ["t1", "t2", "ht"]],
    ["no tactics", []]
  ] as const) {
    const b = thisThatBoard();
    refused(() => ttPlay(b, [...picks]), label);
    assert.equal(zoneOf(b.engine, b.id("tt")), "hand", `${label}: not played`);
    assert.equal(attachedCount(b.engine, P1), 0, `${label}: nothing paid`);
  }
  const ok = thisThatBoard();
  ttPlay(ok, ["t2", "t3", "t4"]);
  assert.ok(pending(ok.engine), "positive control: any three of my discarded tactics work");
});

clause(THIS_THAT, "0:ability", "cost 5: with 4 ready resources it's refused (nothing moves); with exactly 5 it works", () => {
  const poor = thisThatBoard({ ready: 4 });
  refused(() => ttPlay(poor, ["t1", "t2", "t3"]), "4 resources");
  assert.equal(zoneOf(poor.engine, poor.id("tt")), "hand");
  assert.equal(zoneOf(poor.engine, poor.id("t1")), "discard");
  const exact = thisThatBoard({ ready: 5 });
  ttPlay(exact, ["t1", "t2", "t3"]);
  ttChoose(exact, "t1", "t2");
  assert.equal(readyCount(exact.engine, P1), 1, "all 5 spent, +1 new face-down resource");
});

clause(THIS_THAT, "0:ability", "threshold ooo: 5 resources with only 2 obsession can't pay for it; with 3 obsession (+2 other) it can", () => {
  const short = thisThatBoard({ ready: 5, obsession: 2 });
  refused(() => ttPlay(short, ["t1", "t2", "t3"]), "threshold ooo unmet");
  assert.equal(zoneOf(short.engine, short.id("tt")), "hand");
  const enough = thisThatBoard({ ready: 5, obsession: 3 });
  ttPlay(enough, ["t1", "t2", "t3"]);
  assert.ok(pending(enough.engine), "threshold met");
});

// =============================================================================================
// Underwhelming Performance
// =============================================================================================

interface UpOpts {
  ready?: number;
  obsession?: number;
  mySpent?: number;
  oppSpent?: number;
  oppReady?: number;
  random?: () => number;
}

function upBoard(opts: UpOpts = {}) {
  const ready = opts.ready ?? 5;
  const obsession = opts.obsession ?? ready;
  const mySpent = spent(P1, opts.mySpent ?? 3);
  const oppSpent = spent(P2, opts.oppSpent ?? 3);
  const oppReady = bank("greed", opts.oppReady ?? 2, P2);
  const built = buildGame({
    ...(opts.random ? { random: opts.random } : {}),
    cards: [
      { key: "up", def: printing(UNDERWHELMING), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 8, life: 8 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 8, life: 8 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 4, life: 8 }), owner: P2, zone: "play" },
      { key: "by", def: character({ name: "Bystander", strength: 8, life: 8 }), owner: P2, zone: "play" },
      { key: "myby", def: character({ name: "My Bystander", strength: 8, life: 8 }), owner: P1, zone: "play" },
      { key: "oitem", def: item({ name: "Opponent Item" }), owner: P2, zone: "play" },
      { key: "oloc", def: location({ name: "Opponent Location" }), owner: P2, zone: "play" },
      { key: "odisc", def: character({ name: "Opponent Discarded" }), owner: P2, zone: "discard" },
      { key: "ohand", def: character({ name: "Opponent Hand Character" }), owner: P2, zone: "hand" },
      ...fillers("dk", 3, P1, "deck"),
      ...fillers("ek", 3, P2, "deck"),
      ...bank("obsession", obsession, P1),
      ...bank("rage", ready - obsession, P1),
      ...mySpent,
      ...oppSpent,
      ...oppReady
    ]
  });
  return { ...built, mySpent: mySpent.map((p) => built.id(p.key)), oppSpent: oppSpent.map((p) => built.id(p.key)), oppReady: oppReady.map((p) => built.id(p.key)) };
}
type UpBoard = ReturnType<typeof upBoard>;
const upPlay = (b: UpBoard, target: string) => play(b.engine, P1, b.id("up"), { selected: { ch: [b.id(target)] } });
const strength = (b: { engine: SpoilsEngine; id: Id }, key: string) => b.engine.getStat(b.id(key), "strength");

clause(UNDERWHELMING, "0:ability", "the picked opponent character loses 6 strength this turn (8 → 2), nobody else does, and I draw the top card of my deck", () => {
  const b = upBoard();
  const top = deckOf(b.engine, P1)[0];
  const oppHand = [...handOf(b.engine, P2)];
  assert.deepEqual(handOf(b.engine, P1), [b.id("up")]);
  upPlay(b, "theirs");
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(strength(b, "theirs"), 2, "8 - 6");
  assert.equal(strength(b, "by"), 8, "another opponent character is unaffected");
  assert.equal(strength(b, "mine"), 8, "my characters are unaffected");
  assert.equal(strength(b, "weak"), 4);
  assert.deepEqual(handOf(b.engine, P1), [top], "Draw a card: the tactic left my hand and I drew the top card");
  assert.deepEqual(handOf(b.engine, P2), oppHand, "the opponent draws nothing");
  assert.equal(deckOf(b.engine, P1).length, 2);
  assert.equal(zoneOf(b.engine, b.id("up")), "discard");
  assert.equal(attachedCount(b.engine, P1), 3 + 3, "cost 3 paid (+3 resources I'd already spent)");
});

clause(UNDERWHELMING, "0:ability", "'Pick a character': my own character can be picked too (8 → 2), and I draw", () => {
  const b = upBoard();
  const top = deckOf(b.engine, P1)[0];
  upPlay(b, "mine");
  drain(b.engine, declineAll);
  assert.equal(strength(b, "mine"), 2);
  assert.equal(strength(b, "myby"), 8);
  assert.equal(strength(b, "theirs"), 8);
  assert.deepEqual(handOf(b.engine, P1), [top]);
});

clause(UNDERWHELMING, "0:ability", "a stat can't go below 0 (CR 410.4): a strength-4 character that loses 6 strength is at 0", () => {
  const b = upBoard();
  upPlay(b, "weak");
  drain(b.engine, declineAll);
  assert.equal(strength(b, "weak"), 0, "4 - 6 stays at 0");
});

clause(UNDERWHELMING, "0:ability", "'This turn': the loss lasts through this turn and the character has its full strength again once the turn is over", () => {
  const b = upBoard();
  upPlay(b, "theirs");
  drain(b.engine, declineAll);
  assert.equal(strength(b, "theirs"), 2, "still reduced later in the same turn");
  endTurn(b.engine, P1);
  drain(b.engine, declineAll);
  assert.equal(strength(b, "theirs"), 8, "back to the printed 8 after the turn");
});

clause(UNDERWHELMING, "0:ability", "targets: only a character in play can be picked (not an item, location, or a character in the discard pile or hand)", () => {
  for (const key of ["oitem", "oloc", "odisc", "ohand"]) {
    const b = upBoard();
    refused(() => upPlay(b, key), `${key} is not a character in play`);
    assert.equal(zoneOf(b.engine, b.id("up")), "hand", `${key}: tactic not played`);
    assert.equal(attachedCount(b.engine, P1), 3, `${key}: nothing paid`);
  }
  const ok = upBoard();
  upPlay(ok, "theirs");
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("up")), "discard", "positive control");
});

clause(UNDERWHELMING, "0:ability", "cost 3: with 2 ready resources it's refused (nothing happens); with exactly 3 it works", () => {
  const poor = upBoard({ ready: 2 });
  refused(() => upPlay(poor, "theirs"), "2 resources");
  assert.equal(zoneOf(poor.engine, poor.id("up")), "hand");
  assert.equal(strength(poor, "theirs"), 8);
  const exact = upBoard({ ready: 3 });
  upPlay(exact, "theirs");
  drain(exact.engine, declineAll);
  assert.equal(strength(exact, "theirs"), 2);
  assert.equal(readyCount(exact.engine, P1), 0);
});

clause(UNDERWHELMING, "0:ability", "threshold oo: 3 resources with only 1 obsession can't pay for it; with 2 obsession (+1 other) it can", () => {
  const short = upBoard({ ready: 3, obsession: 1 });
  refused(() => upPlay(short, "theirs"), "threshold oo unmet");
  assert.equal(zoneOf(short.engine, short.id("up")), "hand");
  const enough = upBoard({ ready: 3, obsession: 2 });
  upPlay(enough, "theirs");
  drain(enough.engine, declineAll);
  assert.equal(strength(enough, "theirs"), 2);
});

clause(UNDERWHELMING, "0:ability", "the opponent's character's controller (the opponent) may detach up to 2 of their resources: accepting 2 detaches exactly the chosen two, not mine", () => {
  const b = upBoard();
  upPlay(b, "theirs");
  const picks = b.oppSpent.slice(0, 2);
  detachWith(b.engine, P2, picks);
  drain(b.engine, declineAll);
  for (const c of picks) assert.equal(isAttached(b.engine, c), false, "chosen resource detached");
  assert.equal(isAttached(b.engine, b.oppSpent[2]), true, "the third spent resource stays attached");
  for (const c of b.mySpent) assert.equal(isAttached(b.engine, c), true, "my resources are untouched");
  assert.equal(strength(b, "theirs"), 2, "the strength loss still happens");
});

clause(UNDERWHELMING, "0:ability", "'may detach up to 2': 1 is allowed, 0 (declining) is allowed, 3 is refused; the strength loss and the draw happen regardless", () => {
  const one = upBoard();
  upPlay(one, "theirs");
  detachWith(one.engine, P2, [one.oppSpent[1]]);
  drain(one.engine, declineAll);
  assert.equal(attachedIdsOf(one.engine, P2).length, 2, "exactly one detached");
  assert.equal(strength(one, "theirs"), 2);

  const none = upBoard();
  upPlay(none, "theirs");
  detachWith(none.engine, P2, []);
  drain(none.engine, declineAll);
  assert.equal(attachedIdsOf(none.engine, P2).length, 3, "nothing detached");
  assert.equal(strength(none, "theirs"), 2);
  assert.equal(handOf(none.engine, P1).length, 1, "I still drew");

  const many = upBoard();
  upPlay(many, "theirs");
  refused(() => answerPending(many.engine, "chooserSelectsTarget", { selected: many.oppSpent }), "three picks for 'up to 2'");
  assert.ok(pending(many.engine), "the prompt stays open");
});

clause(UNDERWHELMING, "0:ability", "when I pick MY OWN character, I (its controller) may detach up to 2 of MY resources, and the opponent's stay put", () => {
  const b = upBoard();
  upPlay(b, "mine");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: b.mySpent }), "three picks for 'up to 2'");
  assert.ok(pending(b.engine), "the prompt stays open");
  const picks = b.mySpent.slice(0, 2);
  detachWith(b.engine, P1, picks);
  drain(b.engine, declineAll);
  for (const c of picks) assert.equal(isAttached(b.engine, c), false);
  assert.equal(isAttached(b.engine, b.mySpent[2]), true);
  for (const c of b.oppSpent) assert.equal(isAttached(b.engine, c), true, "the opponent's resources are untouched");
  assert.equal(strength(b, "mine"), 2);
});

clause(UNDERWHELMING, "0:ability", "the controller may only detach from their OWN faction: when the opponent decides, my resource can't be picked", () => {
  const b = upBoard();
  upPlay(b, "theirs");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.mySpent[0]] }), "my resource isn't theirs to detach");
  assert.ok(pending(b.engine), "pending(b.engine)");
  assert.equal(isAttached(b.engine, b.mySpent[0]), true);
});

clause(UNDERWHELMING, "0:ability", "only resources ATTACHED to the faction can be detached: a ready (unattached) resource can't be picked", () => {
  const b = upBoard();
  upPlay(b, "theirs");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.oppReady[0]] }), "a ready resource isn't attached to the faction");
  assert.ok(pending(b.engine), "the prompt stays open for a real answer");
});

clause(UNDERWHELMING, "0:ability", "'That character's controller': a character the opponent controls but I own → the opponent decides about detaching; one I control but they own → I decide", () => {
  const theirs = buildGame({
    cards: [
      { key: "up", def: printing(UNDERWHELMING), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Mine But Theirs", strength: 8, life: 8 }), owner: P1, controller: P2, zone: "play" },
      ...fillers("dk", 2, P1, "deck"),
      ...bank("obsession", 3, P1),
      ...spent(P2, 2)
    ]
  });
  play(theirs.engine, P1, theirs.id("up"), { selected: { ch: [theirs.id("c")] } });
  const pc1 = pending(theirs.engine);
  assert.ok(pc1, "a detach prompt is open");
  assert.equal(pc1.playerId, P2, "the controller (the opponent) decides");

  const mine = buildGame({
    cards: [
      { key: "up", def: printing(UNDERWHELMING), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Theirs But Mine", strength: 8, life: 8 }), owner: P2, controller: P1, zone: "play" },
      ...fillers("dk", 2, P1, "deck"),
      ...bank("obsession", 3, P1),
      ...spent(P1, 2)
    ]
  });
  play(mine.engine, P1, mine.id("up"), { selected: { ch: [mine.id("c")] } });
  const pc2 = pending(mine.engine);
  assert.ok(pc2, "a detach prompt is open");
  assert.equal(pc2.playerId, P1, "I control it, so I decide");
});

clause(UNDERWHELMING, "0:ability", "the detach is part of the COST: while the tactic is still waiting for responses, the controller has already been asked / has already detached (SYS-2)", () => {
  const b = upBoard();
  playRaw(b.engine, P1, b.id("up"), { selected: { ch: [b.id("theirs")] } });
  const pc = pending(b.engine);
  assert.ok(pc, "the opponent's detach decision is made while paying costs, before the tactic can be responded to");
  assert.equal(pc.playerId, P2);
  assert.equal(strength(b, "theirs"), 8, "the effect hasn't happened yet");
  resolvePendingResponses(b.engine);
});

// =============================================================================================
// Undevoted Gargantuan
// =============================================================================================

interface GargOpts {
  ready?: number;
  obsession?: number;
  oppSpent?: number;
  oppReady?: number;
  extra?: CardPlacement[];
}

function gargBoard(opts: GargOpts = {}) {
  const ready = opts.ready ?? 5;
  const obsession = opts.obsession ?? ready;
  const oppSpent = spent(P2, opts.oppSpent ?? 4);
  const oppReady = bank("greed", opts.oppReady ?? 2, P2);
  const built = buildGame({
    cards: [
      { key: "ug", def: printing(GARGANTUAN), owner: P1, zone: "hand" },
      ...bank("obsession", obsession, P1),
      ...bank("rage", ready - obsession, P1),
      ...oppSpent,
      ...oppReady,
      ...(opts.extra ?? [])
    ]
  });
  return { ...built, oppSpent: oppSpent.map((p) => built.id(p.key)), oppReady: oppReady.map((p) => built.id(p.key)) };
}
type GargBoard = ReturnType<typeof gargBoard>;

clause(GARGANTUAN, "0:kw:COVERT", "has the COVERT keyword (and an ordinary character does not)", () => covertHasKeyword(GARGANTUAN));
clause(GARGANTUAN, "0:kw:COVERT", "attacking alone, it can't be blocked by a non-covert character; a covert one can block it", () => covertCannotBeBlockedByNonCovert(GARGANTUAN));
clause(GARGANTUAN, "0:kw:COVERT", "in a party with a non-covert member the party isn't covert", () => covertPartyNeedsEveryMemberCovert(GARGANTUAN));
clause(GARGANTUAN, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(GARGANTUAN));

clause(GARGANTUAN, "1:rule", "deploys for its printed cost 5 with 4 obsession threshold, entering play with printed 5 strength / 3 speed / 5 life", () => {
  const b = gargBoard({ oppSpent: 0 });
  play(b.engine, P1, b.id("ug"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ug")), "play");
  assert.equal(attachedCount(b.engine, P1), 5, "cost 5 paid");
  assert.equal(b.engine.getStat(b.id("ug"), "strength"), 5);
  assert.equal(b.engine.getStat(b.id("ug"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("ug"), "life"), 5);
});

clause(GARGANTUAN, "1:rule", "cost 5: with 4 ready resources it's refused; threshold oooo: 5 resources with only 3 obsession is refused", () => {
  const poor = gargBoard({ ready: 4, oppSpent: 0 });
  refused(() => play(poor.engine, P1, poor.id("ug")), "4 resources");
  assert.equal(zoneOf(poor.engine, poor.id("ug")), "hand");
  const short = gargBoard({ ready: 5, obsession: 3, oppSpent: 0 });
  refused(() => play(short.engine, P1, short.id("ug")), "threshold oooo unmet");
  assert.equal(zoneOf(short.engine, short.id("ug")), "hand");
  const ok = gargBoard({ ready: 5, obsession: 4, oppSpent: 0 });
  play(ok.engine, P1, ok.id("ug"));
  assert.equal(zoneOf(ok.engine, ok.id("ug")), "play", "4 obsession + 1 other is enough");
});

clause(GARGANTUAN, "1:rule", "when it enters play the opponent is asked (not me) and may detach up to 3 of their resources: accepting 3 of 4 detaches exactly the chosen three", () => {
  const b = gargBoard();
  play(b.engine, P1, b.id("ug"));
  assert.equal(zoneOf(b.engine, b.id("ug")), "play");
  const picks = b.oppSpent.slice(0, 3);
  detachWith(b.engine, P2, picks);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const c of picks) assert.equal(isAttached(b.engine, c), false, "chosen resource detached");
  assert.equal(isAttached(b.engine, b.oppSpent[3]), true, "the fourth stays attached");
  for (const c of b.oppReady) assert.equal(isAttached(b.engine, c), false);
  assert.equal(attachedCount(b.engine, P1), 5, "my own resources (paid for it) stay attached");
});

clause(GARGANTUAN, "1:rule", "'may … up to 3': detaching fewer (1) or none is allowed, more than 3 is refused; the Gargantuan stays in play regardless", () => {
  const one = gargBoard();
  play(one.engine, P1, one.id("ug"));
  detachWith(one.engine, P2, [one.oppSpent[0]]);
  assert.equal(attachedIdsOf(one.engine, P2).length, 3, "exactly one detached");

  const none = gargBoard();
  play(none.engine, P1, none.id("ug"));
  detachWith(none.engine, P2, []);
  assert.equal(attachedIdsOf(none.engine, P2).length, 4, "nothing detached");
  assert.equal(zoneOf(none.engine, none.id("ug")), "play");

  const many = gargBoard({ oppSpent: 5 });
  play(many.engine, P1, many.id("ug"));
  refused(() => answerPending(many.engine, "chooserSelectsTarget", { selected: many.oppSpent.slice(0, 4) }), "four picks for 'up to 3'");
  assert.ok(pending(many.engine), "the prompt stays open");
  detachWith(many.engine, P2, many.oppSpent.slice(0, 3));
  assert.equal(attachedIdsOf(many.engine, P2).length, 2);
});

clause(GARGANTUAN, "1:rule", "with nothing of theirs to detach the Gargantuan still enters play and nothing is left pending", () => {
  const b = gargBoard({ oppSpent: 0, oppReady: 2 });
  play(b.engine, P1, b.id("ug"));
  if (pending(b.engine)) detachWith(b.engine, P2, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ug")), "play");
});

clause(GARGANTUAN, "1:rule", "only the opponent's faction is affected: my own resources can't be picked", () => {
  const b = gargBoard();
  play(b.engine, P1, b.id("ug"));
  const mine = attachedIdsOf(b.engine, P1)[0];
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [mine] }), "my resource isn't an opponent's");
  assert.ok(pending(b.engine), "pending(b.engine)");
  assert.equal(isAttached(b.engine, mine), true);
});

clause(GARGANTUAN, "1:rule", "only resources ATTACHED to the faction can be detached: a ready (unattached) resource can't be picked", () => {
  const b = gargBoard();
  play(b.engine, P1, b.id("ug"));
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.oppReady[0]] }), "a ready resource isn't attached to the faction");
  assert.ok(pending(b.engine), "the prompt stays open for a real answer");
});

clause(GARGANTUAN, "1:rule", "'When THIS card enters play': another character entering play while a Gargantuan is already out doesn't trigger it", () => {
  const b = buildGame({
    cards: [
      { key: "ug", def: printing(GARGANTUAN), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Newcomer", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1),
      ...spent(P2, 4)
    ]
  });
  play(b.engine, P1, b.id("other"));
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no detach prompt for another card entering play");
  assert.equal(attachedIdsOf(b.engine, P2).length, 4);
});

clause(GARGANTUAN, "1:rule", "'enters play' includes being put into play by an effect (not just deployed)", () => {
  const b = gargBoard({ extra: [{ key: "sm", def: summonTactic(false), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("ug")] } });
  assert.equal(zoneOf(b.engine, b.id("ug")), "play");
  assert.equal(b.engine.state.cards[b.id("ug")].faceDown, false);
  const pc = pending(b.engine);
  assert.ok(pc, "the opponent is asked about detaching");
  assert.equal(pc.playerId, P2);
});

clause(GARGANTUAN, "1:rule", "entering play face-down (as a resource) doesn't trigger it: a face-down card has no rules text", () => {
  const b = gargBoard({ extra: [{ key: "sm", def: summonTactic(true), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("ug")] } });
  assert.equal(zoneOf(b.engine, b.id("ug")), "play");
  assert.equal(b.engine.state.cards[b.id("ug")].faceDown, true, "setup: it entered face-down");
  assert.equal(b.engine.state.pendingChoice, undefined, "no detach prompt");
  assert.equal(attachedIdsOf(b.engine, P2).length, 4);
});

// =============================================================================================
// Violating Ritual
// =============================================================================================

function ritualBoard(opts: { ready?: number; obsession?: number; oppHand?: number } = {}) {
  const ready = opts.ready ?? 3;
  const obsession = opts.obsession ?? ready;
  return buildGame({
    cards: [
      { key: "vr", def: printing(RITUAL), owner: P1, zone: "hand" },
      { key: "mh", def: character({ name: "My Other Card" }), owner: P1, zone: "hand" },
      ...fillers("o", opts.oppHand ?? 4, P2, "hand"),
      ...fillers("dk", 3, P1, "deck"),
      ...fillers("ek", 3, P2, "deck"),
      ...bank("obsession", obsession, P1),
      ...bank("rage", ready - obsession, P1)
    ]
  });
}
type RitualBoard = ReturnType<typeof ritualBoard>;

clause(RITUAL, "0:ability", "the opponent discards exactly 2 cards of THEIR choice, then I draw 1 (the top card of my deck); my own hand isn't discarded from", () => {
  const b = ritualBoard();
  const top = deckOf(b.engine, P1)[0];
  const oppDeck = [...deckOf(b.engine, P2)];
  play(b.engine, P1, b.id("vr"));
  const pc = pending(b.engine);
  assert.ok(pc, "the opponent must choose cards to discard");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the discarding player (the opponent) chooses which cards");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o1"), b.id("o3")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("o3")), "discard");
  assert.deepEqual(handOf(b.engine, P2), [b.id("o0"), b.id("o2")], "the other two stay in their hand");
  assert.deepEqual([...handOf(b.engine, P1)].sort(), [b.id("mh"), top].sort(), "I drew the top card; my own other card is still here");
  assert.equal(zoneOf(b.engine, b.id("vr")), "discard", "the tactic goes to my discard pile");
  assert.equal(attachedCount(b.engine, P1), 3, "cost 3 paid");
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "the opponent's deck is untouched (they don't draw)");
});

clause(RITUAL, "0:ability", "the choice is the opponent's: discarding a different pair (o0 and o2) leaves o1 and o3", () => {
  const b = ritualBoard();
  play(b.engine, P1, b.id("vr"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o0"), b.id("o2")] });
  assert.deepEqual(handOf(b.engine, P2), [b.id("o1"), b.id("o3")]);
});

clause(RITUAL, "0:ability", "'discards 2 cards': one pick, three picks, none, or cards that aren't in their hand are refused", () => {
  const b = ritualBoard();
  play(b.engine, P1, b.id("vr"));
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o0")] }), "only one card");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o0"), b.id("o1"), b.id("o2")] }), "three cards");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "'discards 2 cards' isn't optional");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o0"), b.id("mh")] }), "my card isn't theirs to discard");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o0"), b.id("ek0")] }), "a deck card isn't in their hand");
  assert.equal(handOf(b.engine, P2).length, 4, "nothing was discarded by the refused answers");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("o0"), b.id("o1")] });
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(RITUAL, "0:ability", "an opponent holding exactly 1 card discards that card, and I still draw", () => {
  const b = ritualBoard({ oppHand: 1 });
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("vr"));
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("o0")] } : declineAll(pc)));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("o0")), "discard");
  assert.deepEqual(handOf(b.engine, P2), []);
  assert.ok(handOf(b.engine, P1).includes(top), "I drew a card");
});

clause(RITUAL, "0:ability", "an opponent with an empty hand discards nothing, and I still draw", () => {
  const b = ritualBoard({ oppHand: 0 });
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("vr"));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("vr")), "discard");
  assert.ok(handOf(b.engine, P1).includes(top), "I drew a card");
});

clause(RITUAL, "0:ability", "cost 3: with 2 ready resources it's refused (hand untouched); with exactly 3 it works", () => {
  const poor = ritualBoard({ ready: 2 });
  refused(() => play(poor.engine, P1, poor.id("vr")), "2 resources");
  assert.equal(zoneOf(poor.engine, poor.id("vr")), "hand");
  assert.equal(handOf(poor.engine, P2).length, 4);
  const exact = ritualBoard({ ready: 3 });
  play(exact.engine, P1, exact.id("vr"));
  assert.ok(pending(exact.engine), "works with exactly 3");
  assert.equal(readyCount(exact.engine, P1), 0);
});

clause(RITUAL, "0:ability", "threshold ooo: 3 resources with only 2 obsession can't pay for it", () => {
  const short = ritualBoard({ ready: 3, obsession: 2 });
  refused(() => play(short.engine, P1, short.id("vr")), "threshold ooo unmet");
  assert.equal(zoneOf(short.engine, short.id("vr")), "hand");
  const enough = ritualBoard({ ready: 4, obsession: 3 });
  play(enough.engine, P1, enough.id("vr"));
  assert.ok(pending(enough.engine), "3 obsession (+1 other) is enough");
});

// =============================================================================================
// Voidal Trinket
// =============================================================================================

interface TrinketOpts {
  deck?: number;
  oppSpent?: number;
  oppReady?: number;
  inPlay?: boolean;
  ready?: number;
  obsession?: number;
}

function trinketBoard(opts: TrinketOpts = {}) {
  const oppSpent = spent(P2, opts.oppSpent ?? 3);
  const oppReady = bank("greed", opts.oppReady ?? 1, P2);
  const ready = opts.ready ?? 4;
  const obsession = opts.obsession ?? ready;
  const built = buildGame({
    cards: [
      { key: "vt", def: printing(TRINKET), owner: P1, zone: opts.inPlay === false ? "hand" : "play" },
      ...fillers("d", opts.deck ?? 8, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...bank("obsession", obsession, P1),
      ...bank("rage", ready - obsession, P1),
      ...oppSpent,
      ...oppReady
    ]
  });
  return { ...built, oppSpent: oppSpent.map((p) => built.id(p.key)), oppReady: oppReady.map((p) => built.id(p.key)) };
}
type TrinketBoard = ReturnType<typeof trinketBoard>;

/** Activates AUGUR with X, optional keep card, the order (keys, top→bottom) for the bottom pile, and the opponent's detach picks. */
function augur(b: TrinketBoard, x: number, keepKey?: string, order?: string[], detachPicks: CardInstanceId[] = []): void {
  activate(b.engine, P1, b.id("vt"), "voidal-trinket-augur", { selected: keepKey ? { keep: [b.id(keepKey)] } : {}, variables: { x } });
  drain(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: detachPicks };
    if (pc.kind === "reorderDeck") {
      const ids = pc.cardIds as string[];
      const wanted = order ? order.map(b.id).filter((c) => ids.includes(c)) : [];
      return { kind: "reorderDeck", order: [...wanted, ...ids.filter((c) => !wanted.includes(c))] };
    }
    return declineAll(pc);
  });
}
const deckNames = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "e0", "e1", "e2"];
const keys = (b: TrinketBoard, ids: CardInstanceId[]): string[] => ids.map((c) => deckNames.find((k) => b.id(k) === c) ?? c);
const deckKeys = (b: TrinketBoard, p: PlayerId = P1): string[] => keys(b, deckOf(b.engine, p));

clause(TRINKET, "0:ability:voidal-trinket-augur", "deploys for its printed cost 1 with threshold oo (refused with no resources, refused with only rage), entering play undepleted", () => {
  const none = trinketBoard({ inPlay: false, ready: 0 });
  refused(() => play(none.engine, P1, none.id("vt")), "0 resources");
  assert.equal(zoneOf(none.engine, none.id("vt")), "hand");
  const rage = trinketBoard({ inPlay: false, ready: 3, obsession: 0 });
  refused(() => play(rage.engine, P1, rage.id("vt")), "threshold oo unmet (no obsession)");
  const oneOb = trinketBoard({ inPlay: false, ready: 3, obsession: 1 });
  refused(() => play(oneOb.engine, P1, oneOb.id("vt")), "threshold oo unmet (only one obsession)");
  assert.equal(zoneOf(oneOb.engine, oneOb.id("vt")), "hand");
  const ok = trinketBoard({ inPlay: false, ready: 2, obsession: 2 });
  play(ok.engine, P1, ok.id("vt"));
  assert.equal(zoneOf(ok.engine, ok.id("vt")), "play");
  assert.equal(attachedCount(ok.engine, P1), 1, "cost 1 paid");
  assert.equal(ok.engine.state.cards[ok.id("vt")].depleted ?? false, false);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "X = 3: depletes this card, then lets me order the top 3 cards: the kept one goes on top, the other two to the bottom in the order I choose", () => {
  const b = trinketBoard();
  augur(b, 3, "d1", ["d2", "d1", "d0"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("vt")].depleted, true, "COST: deplete this card");
  assert.deepEqual(deckKeys(b), ["d1", "d3", "d4", "d5", "d6", "d7", "d2", "d0"], "kept d1 on top; d2 then d0 on the bottom as ordered");
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "'in any order': the other order for the bottom cards gives the other result", () => {
  const b = trinketBoard();
  augur(b, 3, "d1", ["d0", "d1", "d2"]);
  assert.deepEqual(deckKeys(b), ["d1", "d3", "d4", "d5", "d6", "d7", "d0", "d2"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "'you may': keeping none puts all 3 looked-at cards on the bottom in the chosen order", () => {
  const b = trinketBoard();
  augur(b, 3, undefined, ["d2", "d0", "d1"]);
  assert.deepEqual(deckKeys(b), ["d3", "d4", "d5", "d6", "d7", "d2", "d0", "d1"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "keeping the top card itself leaves it on top; the other two go to the bottom", () => {
  const b = trinketBoard();
  augur(b, 3, "d0", ["d1", "d2"]);
  assert.deepEqual(deckKeys(b), ["d0", "d3", "d4", "d5", "d6", "d7", "d1", "d2"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "keeping the third card of three puts it on top", () => {
  const b = trinketBoard();
  augur(b, 3, "d2", ["d1", "d0"]);
  assert.deepEqual(deckKeys(b), ["d2", "d3", "d4", "d5", "d6", "d7", "d1", "d0"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "the prompt shows exactly the top X cards of my deck (X = 3: the first three, in order), and the opponent's deck is untouched", () => {
  const c = trinketBoard();
  const oppDeck = [...deckOf(c.engine, P2)];
  activate(c.engine, P1, c.id("vt"), "voidal-trinket-augur", { selected: { keep: [c.id("d1")] }, variables: { x: 3 } });
  let seen: string[] | undefined;
  drain(c.engine, (pc) => {
    if (pc.kind === "reorderDeck") {
      seen = [...(pc.cardIds as string[])];
      assert.equal(pc.playerId, P1, "I order my own cards");
    }
    return declineAll(pc);
  });
  assert.deepEqual(seen, ["d0", "d1", "d2"].map(c.id), "the top 3 cards, top first");
  assert.deepEqual(deckOf(c.engine, P2), oppDeck);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "X = 1: I look at only the top card; keeping it leaves the deck as it was, not keeping it sends it to the bottom", () => {
  const keep = trinketBoard();
  augur(keep, 1, "d0");
  assert.deepEqual(deckKeys(keep), ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
  const bottom = trinketBoard();
  augur(bottom, 1);
  assert.deepEqual(deckKeys(bottom), ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d0"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "X = 2: only the top 2 cards are looked at; keeping the second puts it on top and the first goes to the bottom", () => {
  const b = trinketBoard();
  augur(b, 2, "d1");
  assert.deepEqual(deckKeys(b), ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d0"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "X = 0: no cards are looked at and the deck is unchanged (the card is still depleted)", () => {
  const b = trinketBoard();
  augur(b, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("vt")].depleted, true);
  assert.deepEqual(deckKeys(b), ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "'one of those cards': with X = 1 a card I wasn't looking at (the 2nd or 3rd) can't be put on top", () => {
  for (const key of ["d1", "d2"]) {
    const b = trinketBoard();
    const before = [...deckOf(b.engine, P1)];
    refused(() => augur(b, 1, key), `${key} is not among the top 1 cards`);
    assert.deepEqual(deckOf(b.engine, P1), before, "the deck is untouched by the refusal");
    assert.notEqual(b.engine.state.cards[b.id("vt")].depleted, true, "the cost wasn't paid for a refused use");
  }
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "'one of those cards': a card deeper in the deck than X can't be kept (even with X = 3), and only one card can be kept", () => {
  const deep = trinketBoard();
  refused(() => augur(deep, 3, "d4"), "d4 is not among the top 3");
  assert.deepEqual(deckKeys(deep), ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
  const two = trinketBoard();
  refused(() => activate(two.engine, P1, two.id("vt"), "voidal-trinket-augur", { selected: { keep: [two.id("d0"), two.id("d1")] }, variables: { x: 3 } }), "two kept cards");
  assert.deepEqual(deckKeys(two), ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "X is 3 or less: X = 4 and X = 5 are refused (the cost isn't paid); X = 3 and X = 0 work", () => {
  for (const x of [4, 5]) {
    const b = trinketBoard();
    refused(() => augur(b, x), `X = ${x}`);
    assert.notEqual(b.engine.state.cards[b.id("vt")].depleted, true, `X = ${x}: not depleted`);
    assert.deepEqual(deckKeys(b), ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
  }
  for (const x of [3, 0]) {
    const ok = trinketBoard();
    augur(ok, x);
    assert.equal(ok.engine.state.cards[ok.id("vt")].depleted, true, `positive control: X = ${x} works`);
  }
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "X is a number you choose: a negative X is refused (the cost isn't paid)", () => {
  const b = trinketBoard();
  refused(() => augur(b, -1), "X = -1");
  assert.notEqual(b.engine.state.cards[b.id("vt")].depleted, true, "not depleted");
  assert.deepEqual(deckKeys(b), ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "X is a number you choose: a fractional X is refused (the cost isn't paid)", () => {
  const b = trinketBoard();
  refused(() => augur(b, 1.5), "X = 1.5");
  assert.notEqual(b.engine.state.cards[b.id("vt")].depleted, true, "not depleted");
  assert.deepEqual(deckKeys(b), ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "a depleted Voidal Trinket can't be used again (the deplete cost), and it can't be used twice in one turn", () => {
  const b = trinketBoard();
  b.engine.state.cards[b.id("vt")].depleted = true;
  refused(() => augur(b, 2), "already depleted");
  assert.deepEqual(deckKeys(b), ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
  const twice = trinketBoard();
  augur(twice, 1);
  refused(() => augur(twice, 1), "depleted by the first use");
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "X larger than the deck: with a 2-card deck and X = 3, I look at both cards and the kept one goes on top", () => {
  const b = trinketBoard({ deck: 2 });
  augur(b, 3, "d1", ["d0"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckKeys(b), ["d1", "d0"]);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "the opponent may detach up to X of their resources: X = 2 accepted for exactly the two picked, and mine are not touched", () => {
  const b = trinketBoard();
  const picks = b.oppSpent.slice(0, 2);
  augur(b, 2, undefined, undefined, picks);
  for (const c of picks) assert.equal(isAttached(b.engine, c), false, "chosen resource detached");
  assert.equal(isAttached(b.engine, b.oppSpent[2]), true, "the third stays attached");
  assert.equal(attachedCount(b.engine, P1), 0, "my own resources are untouched (the cost is only deplete)");
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "'may … up to X': detaching fewer or none is allowed, more than X is refused, and the opponent is the one asked", () => {
  const one = trinketBoard();
  augur(one, 3, undefined, undefined, [one.oppSpent[0]]);
  assert.equal(attachedIdsOf(one.engine, P2).length, 2, "exactly one detached");

  const none = trinketBoard();
  augur(none, 3, undefined, undefined, []);
  assert.equal(attachedIdsOf(none.engine, P2).length, 3, "nothing detached");

  const many = trinketBoard();
  activate(many.engine, P1, many.id("vt"), "voidal-trinket-augur", { selected: {}, variables: { x: 2 } });
  const pc = pending(many.engine);
  assert.ok(pc, "the opponent is asked");
  assert.equal(pc.playerId, P2);
  refused(() => answerPending(many.engine, "chooserSelectsTarget", { selected: many.oppSpent }), "three picks for X = 2");
  assert.ok(pending(many.engine), "the prompt stays open");
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "X = 0: the opponent can detach nothing", () => {
  const b = trinketBoard();
  augur(b, 0, undefined, undefined, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(attachedIdsOf(b.engine, P2).length, 3);
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "the opponent can only detach from their own faction, and only resources that are attached to it (a ready resource can't be picked)", () => {
  // give me a spent resource to try to pick
  const b = buildGame({
    cards: [
      { key: "vt", def: printing(TRINKET), owner: P1, zone: "play" },
      ...fillers("d", 5, P1, "deck"),
      ...spent(P1, 2),
      ...spent(P2, 3),
      ...bank("greed", 1, P2)
    ]
  });
  activate(b.engine, P1, b.id("vt"), "voidal-trinket-augur", { selected: {}, variables: { x: 2 } });
  const myResource = attachedIdsOf(b.engine, P1)[0];
  const readyOpp = resourcesOf(b.engine, P2).find((c) => !isAttached(b.engine, c))!;
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [myResource] }), "my resource isn't theirs");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [readyOpp] }), "a ready resource isn't attached to the faction");
  assert.ok(pending(b.engine), "the prompt stays open for a real answer");
});

clause(TRINKET, "0:ability:voidal-trinket-augur", "the opponent's detach is part of the COST: right after activating (before any response), the opponent has already been asked (SYS-2)", () => {
  const b = trinketBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("vt"), abilityId: "voidal-trinket-augur", selected: {}, variables: { x: 2 } });
  assert.equal(b.engine.state.cards[b.id("vt")].depleted, true, "the deplete cost is paid up front");
  const pc = pending(b.engine);
  assert.ok(pc, "the opponent's detach choice is part of paying the cost, before the ability resolves");
  assert.equal(pc.playerId, P2);
  resolvePendingResponses(b.engine);
});

// =============================================================================================
// Ancient and Disreputable Law Office
// =============================================================================================

function lawDeployBoard(extra: CardPlacement[] = [], greed = 3) {
  return buildGame({
    cards: [
      { key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "play" },
      { key: "law2", def: printing(LAW_OFFICE), owner: P1, zone: "hand" },
      ...bank("greed", greed, P1),
      ...extra
    ]
  });
}

clause(LAW_OFFICE, "0:unique", "a second Law Office: its controller chooses which to keep (keeping the new one destroys the old; keeping the old destroys the new)", () => {
  const keepNew = lawDeployBoard();
  play(keepNew.engine, P1, keepNew.id("law2"));
  const pc = pending(keepNew.engine);
  assert.ok(pc, "pc");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [keepNew.id("law"), keepNew.id("law2")].sort());
  answerPending(keepNew.engine, "uniqueSurvivor", { keep: keepNew.id("law2") });
  assert.equal(zoneOf(keepNew.engine, keepNew.id("law2")), "play");
  assert.equal(zoneOf(keepNew.engine, keepNew.id("law")), "discard");

  const keepOld = lawDeployBoard();
  play(keepOld.engine, P1, keepOld.id("law2"));
  answerPending(keepOld.engine, "uniqueSurvivor", { keep: keepOld.id("law") });
  assert.equal(zoneOf(keepOld.engine, keepOld.id("law")), "play");
  assert.equal(zoneOf(keepOld.engine, keepOld.id("law2")), "discard");
  assert.equal(keepOld.engine.state.pendingChoice, undefined);
});

clause(LAW_OFFICE, "0:unique", "UNIQUE is per player: the opponent's own Law Office causes no choice and isn't destroyed", () => {
  const b = buildGame({
    cards: [
      { key: "theirs", def: printing(LAW_OFFICE), owner: P2, zone: "play" },
      { key: "law2", def: printing(LAW_OFFICE), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  play(b.engine, P1, b.id("law2"));
  assert.equal(b.engine.state.pendingChoice, undefined, "no uniqueness conflict across players");
  assert.equal(zoneOf(b.engine, b.id("law2")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
});

clause(LAW_OFFICE, "0:unique", "the identifier is 'A & D LAW': another card carrying it conflicts, a different identifier doesn't", () => {
  const board = (unique: string) =>
    buildGame({
      cards: [
        { key: "twin", def: location({ name: "Lookalike Office", unique }), owner: P1, zone: "play" },
        { key: "law2", def: printing(LAW_OFFICE), owner: P1, zone: "hand" },
        ...bank("greed", 3, P1)
      ]
    });
  const same = board("a & d law");
  play(same.engine, P1, same.id("law2"));
  const pc = pending(same.engine);
  assert.ok(pc && pc.kind === "uniqueSurvivor", "a different card with the same identifier conflicts");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [same.id("twin"), same.id("law2")].sort());

  const different = board("some other office");
  play(different.engine, P1, different.id("law2"));
  assert.equal(different.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(different.engine, different.id("twin")), "play");
  assert.equal(zoneOf(different.engine, different.id("law2")), "play");
});

clause(LAW_OFFICE, "1:rule", "deploys for its printed cost 3 with threshold g (refused with 2 resources, refused with no greed), entering play with printed structure 3", () => {
  const poor = buildGame({ cards: [{ key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)] });
  refused(() => play(poor.engine, P1, poor.id("law")), "2 resources");
  assert.equal(zoneOf(poor.engine, poor.id("law")), "hand");
  const noGreed = buildGame({ cards: [{ key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)] });
  refused(() => play(noGreed.engine, P1, noGreed.id("law")), "threshold g unmet");
  const ok = buildGame({ cards: [{ key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)] });
  play(ok.engine, P1, ok.id("law"));
  assert.equal(zoneOf(ok.engine, ok.id("law")), "play");
  assert.equal(attachedCount(ok.engine, P1), 3, "cost 3 paid");
  assert.equal(ok.engine.getStat(ok.id("law"), "structure"), 3);
});

function lawAttackBoard(cost: number, extra: CardPlacement[] = []) {
  return buildGame({
    cards: [
      { key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", cost, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "big", def: character({ name: "Big Attacker", cost: 3, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...extra
    ]
  });
}

clause(LAW_OFFICE, "1:rule", "characters with numeric cost 0, 1 or 2 cannot attack (refused, nothing becomes depleted)", () => {
  for (const cost of [0, 1, 2]) {
    const b = lawAttackBoard(cost);
    refused(() => declareAttackBy(b.engine, P1, [b.id("atk")]), `cost ${cost} can't attack`);
    assert.equal(b.engine.state.battle, undefined, `cost ${cost}: no battle began`);
  }
});

clause(LAW_OFFICE, "1:rule", "a character with numeric cost 3 can still attack", () => {
  const b = lawAttackBoard(3);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  assert.ok(b.engine.state.battle, "the attack was declared");
});

clause(LAW_OFFICE, "1:rule", "a party with a cost-2 member can't attack (that member cannot), but the cost-3 character attacking alone can", () => {
  const b = lawAttackBoard(2);
  refused(() => declareAttackBy(b.engine, P1, [b.id("atk"), b.id("big")]), "party including a cost-2 character");
  assert.equal(b.engine.state.battle, undefined);
  declareAttackBy(b.engine, P1, [b.id("big")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
});

clause(LAW_OFFICE, "1:rule", "it applies to every player's characters: the opponent's cost-2 character can't attack, their cost-3 character can", () => {
  const cheap = buildGame({
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Their Cheap", cost: 2, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  refused(() => declareAttackBy(cheap.engine, P2, [cheap.id("atk")]), "the opponent's cost-2 character");
  const pricey = buildGame({
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Their Pricey", cost: 3, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(pricey.engine, P2, [pricey.id("atk")]);
  assert.ok(pricey.engine.state.battle, "pricey.engine.state.battle");
});

clause(LAW_OFFICE, "1:rule", "it only stops attacking: a cost-2 character can still block", () => {
  const b = buildGame({
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "play" },
      { key: "cheap", def: character({ name: "Cheap Blocker", cost: 2, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Their Pricey", cost: 4, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("cheap")] });
  resolvePendingResponses(b.engine);
  const battle = b.engine.state.battle as unknown as { blockers?: Record<string, string[]> | string[] } | undefined;
  assert.ok(battle, "the battle goes on with the cost-2 character blocking");
  assert.ok(JSON.stringify(battle).includes(b.id("cheap")), "the cheap character is part of the battle as a blocker");
});

clause(LAW_OFFICE, "1:rule", "the restriction is on while the Law Office is in play, off before it enters, and off again after it leaves", () => {
  const b = buildGame({
    cards: [
      { key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "hand" },
      { key: "raze", def: razeTactic(), owner: P1, zone: "hand" },
      { key: "cheap", def: character({ name: "Cheap", cost: 2, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "cheapItem", def: item({ name: "Cheap Item", cost: 1 }), owner: P1, zone: "play" },
      { key: "cheapLoc", def: location({ name: "Cheap Location", cost: 1 }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  const cannotAttack = () => b.engine.getRestrictions(b.id("cheap")).includes("cannotAttack");
  assert.equal(cannotAttack(), false, "before the Law Office enters");
  play(b.engine, P1, b.id("law"));
  assert.equal(zoneOf(b.engine, b.id("law")), "play");
  assert.equal(cannotAttack(), true, "while it's in play");
  assert.equal(b.engine.getRestrictions(b.id("cheapItem")).includes("cannotAttack"), false, "only CHARACTERS are restricted (not a cost-1 item)");
  assert.equal(b.engine.getRestrictions(b.id("cheapLoc")).includes("cannotAttack"), false, "...nor a cost-1 location");
  play(b.engine, P1, b.id("raze"), { selected: { t: [b.id("law")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("law")), "discard", "setup: the Law Office left play");
  assert.equal(cannotAttack(), false, "after it left play");
  declareAttackBy(b.engine, P1, [b.id("cheap")]);
  assert.ok(b.engine.state.battle, "the cost-2 character really can attack again");
});

clause(LAW_OFFICE, "1:rule", "a cost-2 character that enters play after the Law Office is covered too", () => {
  const b = buildGame({
    cards: [
      { key: "law", def: printing(LAW_OFFICE), owner: P1, zone: "play" },
      { key: "late", def: character({ name: "Latecomer", cost: 2, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "hand" },
      ...bank("obsession", 2, P1)
    ]
  });
  play(b.engine, P1, b.id("late"));
  assert.equal(zoneOf(b.engine, b.id("late")), "play");
  assert.equal(b.engine.getRestrictions(b.id("late")).includes("cannotAttack"), true);
});
