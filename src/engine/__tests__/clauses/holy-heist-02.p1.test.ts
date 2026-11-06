// Clause tests, batch holy-heist-02, part p1 (groups 1-6, missing clauses only).
// Seance Sensor, Seriously Weird Crystalline Artefact, Serpentine Scepter,
// Thabbashite Barbeque, Thabbashite Communicant, Thabbashite Temple.
import assert from "node:assert/strict";
import type { PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { declareAttackBy } from "./_battle.js";
import { developResource, endTurn, factionOf } from "./_turn.js";

type Cards = CardPlacement[];

const SENSOR = "5a8d4a87-61b2-4e20-899c-250830e15eca"; // item arcanist cost 2 "oo" -- enters play with 2 tokens; SEIZE; ABSORB HUMOUR
const SWCA = "a341e5b6-b513-45f6-b25b-d27edbe20305"; // item arcanist cost 2 "oo" -- RECYCLE JUNK; SERAPHIM FUSION
const SCEPTER = "03d18824-daf1-4546-88bc-bc8e0a8d2502"; // item gear cost 1 "o" -- ATTACH TO CHARACTER; SOUL DRAIN; SOUL CHARGE
const BBQ = "cb0c54e5-f40b-4fb7-aeb2-01d0ab697f4f"; // tactic cost 4 "ooo" -- pick non-resource; opponent may pay 2 ...
const COMM = "aa6ad3ba-84aa-417a-9e0c-538d4faa34ca"; // character ritualist cost 4 "o" 2/3/3 -- V card enters play: look at top card
const TEMPLE = "9b446e06-feec-456a-a2e5-399ef156a523"; // location cost 4 "o" structure 6 -- CALL UPON THE GODS; VOLATE
// Cards used only as board pieces (not under test).
const IGNATIUS = "7b6a4bfc-b116-4695-a4d8-86f59e0b140c"; // Ignatius Gloamspike -- UNIQUE IGNATIOUS
const IGNATIOUS2 = "b22d2e91-49fe-44e7-8a1b-8034d0e9a324"; // Ignatious, Tactician Crafter -- UNIQUE IGNATIOUS
const NIUDLA = "7be95bf9-e696-4f1d-82cd-e9f23c94f346"; // Uhluhtc Niudla -- UNIQUE UHLUHTC

// --- shared helpers -----------------------------------------------------------------------------------------------

const handOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].hand;
const discardOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].discard;
const deckOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].deck;
const isDepleted = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].depleted;

/** Starts an ability WITHOUT draining the response window: what is true while it waits on the stack. */
function activateRaw(engine: SpoilsEngine, player: PlayerId, cardId: string, abilityId: string, selected: Record<string, string[]> = {}): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} });
}

/** A synthetic item in play with one activated ability that applies `effect` to the picked card `t`. */
const remote = (name: string, selector: Record<string, unknown>, effect: Record<string, unknown>) =>
  item({
    name,
    behavior: {
      abilities: [{ id: "go", type: "activated", targets: [{ id: "t", selector, count: 1 }], effects: [effect] }]
    } as never
  });
const picked = { type: "selected", id: "t" };

// =====================================================================================================================
// Seance Sensor
// =====================================================================================================================

function sensorBoard(over: { tokens?: number; oppHand?: number; resources?: number; depleted?: boolean; extra?: Cards } = {}) {
  return buildGame({
    cards: [
      { key: "s", def: printing(SENSOR), owner: P1, zone: "play", counters: { token: over.tokens ?? 2 }, depleted: over.depleted ?? false },
      ...fillers("h", 2, P1, "hand"),
      ...fillers("o", over.oppHand ?? 2, P2, "hand", (i) => character({ name: `Opp ${i}` })),
      { key: "by", def: character({ name: "Bystander" }), owner: P2, zone: "play" },
      ...bank("rage", over.resources ?? 0),
      ...(over.extra ?? [])
    ]
  });
}

clause(SENSOR, "0:rule", "played from hand it enters play with exactly 2 tokens; it is a 2-cost item needing two Obsession", () => {
  const { engine, id } = buildGame({ cards: [{ key: "s", def: printing(SENSOR), owner: P1, zone: "hand" }, ...bank("obsession", 2)] });
  play(engine, P1, id("s"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("s")), "play");
  assert.equal(tokensOn(engine, id("s")), 2);
  assert.equal(readyResources(engine, P1), 0, "cost 2 was paid");
  // one short of the cost
  const short = buildGame({ cards: [{ key: "s", def: printing(SENSOR), owner: P1, zone: "hand" }, ...bank("obsession", 1)] });
  refused(() => play(short.engine, P1, short.id("s")), "cost 2 with one resource");
  // threshold "oo": two resources but only one Obsession icon
  const wrong = buildGame({ cards: [{ key: "s", def: printing(SENSOR), owner: P1, zone: "hand" }, ...bank("obsession", 1), ...bank("rage", 1)] });
  refused(() => play(wrong.engine, P1, wrong.id("s")), "threshold oo with one Obsession");
});

clause(SENSOR, "0:rule", "put into play by an effect (not played) it still enters with 2 tokens", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "s", def: printing(SENSOR), owner: P1, zone: "hand" },
      { key: "put", def: remote("Putter", { owner: "self", zone: "hand" }, { type: "putIntoPlay", target: picked, controller: "controller" }), owner: P1, zone: "play" }
    ]
  });
  activate(engine, P1, id("put"), "go", { selected: { t: [id("s")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("s")), "play");
  assert.equal(tokensOn(engine, id("s")), 2);
});

clause(SENSOR, "0:rule", "only the card that enters gets the tokens: a Sensor already in play keeps its own count", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "old", def: printing(SENSOR), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "new", def: printing(SENSOR), owner: P1, zone: "hand" },
      ...bank("obsession", 2)
    ]
  });
  play(engine, P1, id("new"));
  assert.equal(tokensOn(engine, id("new")), 2);
  assert.equal(tokensOn(engine, id("old")), 1, "the older Sensor is untouched");
  // and a different card entering play gets no tokens
  const other = buildGame({
    cards: [
      { key: "s", def: printing(SENSOR), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "c", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(other.engine, P1, other.id("c"));
  assert.equal(tokensOn(other.engine, other.id("c")), 0);
  assert.equal(tokensOn(other.engine, other.id("s")), 1);
});

clause(SENSOR, "1:ability:seance-seize", "COST removes exactly one token and depletes it; the picked opponent is the one asked to discard, and discards the card they choose", () => {
  const { engine, id } = sensorBoard();
  activate(engine, P1, id("s"), "seance-seize", { selected: { p: [factionOf(engine, P2)] } });
  assert.equal(tokensOn(engine, id("s")), 1, "COST: one token removed (2 -> 1)");
  assert.equal(isDepleted(engine, id("s")), true, "COST: deplete");
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "that player discards, so that player chooses the card");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("o1")] });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("o1")), "discard");
  assert.equal(zoneOf(engine, id("o0")), "hand", "exactly one card is discarded");
  assert.deepEqual(discardOf(engine, P2), [id("o1")]);
  assert.equal(handOf(engine, P1).length, 2, "my hand is untouched");
  assert.equal(zoneOf(engine, id("by")), "play");
});

clause(SENSOR, "1:ability:seance-seize", "the player may be me: I discard a card of my choice and the opponent keeps their hand", () => {
  const { engine, id } = sensorBoard();
  activate(engine, P1, id("s"), "seance-seize", { selected: { p: [factionOf(engine, P1)] } });
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h1")] });
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(handOf(engine, P2).length, 2, "the opponent discards nothing");
  assert.equal(tokensOn(engine, id("s")), 1);
});

clause(SENSOR, "1:ability:seance-seize", "the discarded card cannot be a card in play or a card in the picked player's discard pile", () => {
  const { engine, id } = sensorBoard({ extra: [{ key: "od", def: character({ name: "Opp Dead" }), owner: P2, zone: "discard" }] });
  activate(engine, P1, id("s"), "seance-seize", { selected: { p: [factionOf(engine, P2)] } });
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("by")] }), "a card in play");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("od")] }), "a card in their discard pile");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("o0")] });
  assert.equal(zoneOf(engine, id("o0")), "discard");
  assert.equal(handOf(engine, P1).length, 2);
});

clause(SENSOR, "1:ability:seance-seize", "the discarded card must come from the picked player's own hand: the opponent cannot discard from MY hand", () => {
  const { engine, id } = sensorBoard();
  activate(engine, P1, id("s"), "seance-seize", { selected: { p: [factionOf(engine, P2)] } });
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("h0")] }), "a card in the caster's hand is not in THAT player's hand");
});

clause(SENSOR, "1:ability:seance-seize", "picking myself, I cannot discard a card from the opponent's hand", () => {
  const { engine, id } = sensorBoard();
  activate(engine, P1, id("s"), "seance-seize", { selected: { p: [factionOf(engine, P1)] } });
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("o0")] }), "a card in the opponent's hand is not in MY hand");
});

clause(SENSOR, "1:ability:seance-seize", "the pick is a player: a character in play or a card in hand cannot be picked", () => {
  const { engine, id } = sensorBoard();
  refused(() => activate(engine, P1, id("s"), "seance-seize", { selected: { p: [id("by")] } }), "a character is not a player");
  refused(() => activate(engine, P1, id("s"), "seance-seize", { selected: { p: [id("o0")] } }), "a card in hand is not a player");
  assert.equal(tokensOn(engine, id("s")), 2, "nothing was paid");
  activate(engine, P1, id("s"), "seance-seize", { selected: { p: [factionOf(engine, P2)] } }); // control
  assert.equal(tokensOn(engine, id("s")), 1);
});

clause(SENSOR, "1:ability:seance-seize", "the picked player has no cards in hand: the cost is still paid and nothing breaks", () => {
  const { engine, id } = sensorBoard({ oppHand: 0 });
  activate(engine, P1, id("s"), "seance-seize", { selected: { p: [factionOf(engine, P2)] } });
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("s")), 1);
  assert.equal(isDepleted(engine, id("s")), true);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(SENSOR, "1:ability:seance-seize", "needs a token and an undepleted Sensor; tokens run out after two uses", () => {
  const none = sensorBoard({ tokens: 0 });
  refused(() => activate(none.engine, P1, none.id("s"), "seance-seize", { selected: { p: [factionOf(none.engine, P2)] } }), "no tokens");
  const dep = sensorBoard({ depleted: true });
  refused(() => activate(dep.engine, P1, dep.id("s"), "seance-seize", { selected: { p: [factionOf(dep.engine, P2)] } }), "depleted");
  assert.equal(tokensOn(dep.engine, dep.id("s")), 2, "a refused activation removes no token");
  // two uses (restoring in between) spend both tokens; a third is refused
  const { engine, id } = sensorBoard();
  const target = { selected: { p: [factionOf(engine, P2)] } };
  activate(engine, P1, id("s"), "seance-seize", target);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("o0")] });
  assert.equal(tokensOn(engine, id("s")), 1);
  engine.state.cards[id("s")].depleted = false;
  activate(engine, P1, id("s"), "seance-seize", target);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("o1")] });
  assert.equal(tokensOn(engine, id("s")), 0);
  assert.deepEqual(discardOf(engine, P2), [id("o0"), id("o1")]);
  engine.state.cards[id("s")].depleted = false;
  refused(() => activate(engine, P1, id("s"), "seance-seize", target), "tokens exhausted");
});

clause(SENSOR, "2:ability:seance-absorb", "COST pays 2 and depletes (already paid while it waits); EFFECT puts exactly one token on the Sensor", () => {
  const { engine, id } = sensorBoard({ tokens: 0, resources: 3 });
  activateRaw(engine, P1, id("s"), "seance-absorb");
  assert.equal(readyResources(engine, P1), 1, "COST: Pay 2 (3 -> 1)");
  assert.equal(isDepleted(engine, id("s")), true, "COST: deplete");
  assert.equal(tokensOn(engine, id("s")), 0, "no token until it resolves");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("s")), 1);
  const more = sensorBoard({ tokens: 2, resources: 2 });
  activate(more.engine, P1, more.id("s"), "seance-absorb");
  assert.equal(tokensOn(more.engine, more.id("s")), 3, "it adds to what is there; there is no cap at 2");
});

clause(SENSOR, "2:ability:seance-absorb", "refused when depleted or with only 1 resource; repeatable after restoring, each use costing 2", () => {
  const dep = sensorBoard({ resources: 2, depleted: true });
  refused(() => activate(dep.engine, P1, dep.id("s"), "seance-absorb"), "depleted");
  const poor = sensorBoard({ resources: 1 });
  refused(() => activate(poor.engine, P1, poor.id("s"), "seance-absorb"), "only 1 resource");
  assert.equal(tokensOn(poor.engine, poor.id("s")), 2);
  const { engine, id } = sensorBoard({ tokens: 0, resources: 4 });
  activate(engine, P1, id("s"), "seance-absorb");
  engine.state.cards[id("s")].depleted = false;
  activate(engine, P1, id("s"), "seance-absorb");
  assert.equal(tokensOn(engine, id("s")), 2);
  assert.equal(readyResources(engine, P1), 0, "2 + 2 resources spent");
  engine.state.cards[id("s")].depleted = false;
  refused(() => activate(engine, P1, id("s"), "seance-absorb"), "no resources left");
});

// =====================================================================================================================
// Seriously Weird Crystalline Artefact
// =====================================================================================================================

const recycleDeck = (): Cards => [
  { key: "c0", def: character({ name: "Deck Char 0", cost: 0 }), owner: P1, zone: "deck" },
  { key: "c2", def: character({ name: "Deck Char 2", cost: 2 }), owner: P1, zone: "deck" },
  { key: "c3", def: character({ name: "Deck Char 3", cost: 3 }), owner: P1, zone: "deck" },
  { key: "c4", def: character({ name: "Deck Char 4", cost: 4 }), owner: P1, zone: "deck" },
  { key: "i1", def: item({ name: "Deck Item 1", cost: 1 }), owner: P1, zone: "deck" },
  { key: "i3", def: item({ name: "Deck Item 3", cost: 3 }), owner: P1, zone: "deck" },
  { key: "t2", def: tactic({ name: "Deck Tactic 2", cost: 2 }), owner: P1, zone: "deck" },
  { key: "t5", def: tactic({ name: "Deck Tactic 5", cost: 5 }), owner: P1, zone: "deck" },
  { key: "l2", def: location({ name: "Deck Location 2", cost: 2 }), owner: P1, zone: "deck" },
  { key: "l5", def: location({ name: "Deck Location 5", cost: 5 }), owner: P1, zone: "deck" },
  { key: "r0", def: resourceCard({ name: "Deck Resource" }), owner: P1, zone: "deck" }
];

function recycleBoard(over: { resources?: number; deck?: Cards } = {}) {
  return buildGame({
    random: () => 0,
    cards: [
      { key: "w", def: printing(SWCA), owner: P1, zone: "play" },
      ...bank("rage", over.resources ?? 5),
      { key: "jc", def: character({ name: "Junk Char", cost: 3 }), owner: P1, zone: "discard" },
      { key: "ji", def: item({ name: "Junk Item", cost: 1 }), owner: P1, zone: "discard" },
      { key: "jt", def: tactic({ name: "Junk Tactic", cost: 2 }), owner: P1, zone: "discard" },
      { key: "jl", def: location({ name: "Junk Location", cost: 4 }), owner: P1, zone: "discard" },
      { key: "jr", def: resourceCard({ name: "Junk Resource" }), owner: P1, zone: "discard" },
      { key: "oj", def: character({ name: "Opp Junk", cost: 3 }), owner: P2, zone: "discard" },
      { key: "hj", def: character({ name: "Hand Junk", cost: 3 }), owner: P1, zone: "hand" },
      { key: "pj", def: character({ name: "Play Junk", cost: 3 }), owner: P1, zone: "play" },
      ...(over.deck ?? recycleDeck()),
      { key: "oc", def: character({ name: "Opp Deck Char", cost: 1 }), owner: P2, zone: "deck" }
    ]
  });
}

/** Activates RECYCLE JUNK on `junk`; then every `invalid` find is refused and a fresh board accepts each `valid` find. */
function recycleCase(junk: string, valid: string[], invalid: string[]): void {
  {
    const { engine, id } = recycleBoard();
    activate(engine, P1, id("w"), "swca-recycle", { selected: { junk: [id(junk)] } });
    const pc = pending(engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget", "I get to choose what to find");
    assert.equal(pc.playerId, P1);
    for (const key of [...invalid, "oc", "hj", "pj"]) {
      refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] }), `${key} is not a legal find for ${junk}`);
    }
  }
  for (const key of valid) {
    const { engine, id } = recycleBoard();
    activate(engine, P1, id("w"), "swca-recycle", { selected: { junk: [id(junk)] } });
    answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] });
    assert.equal(pending(engine), undefined);
    assert.equal(zoneOf(engine, id(key)), "discard", `${key} is a legal find for ${junk} and goes to my discard pile`);
  }
}

clause(SWCA, "0:ability:swca-recycle", "COST: the picked card is removed from the game as a cost, already done while the ability waits", () => {
  const { engine, id } = recycleBoard();
  activateRaw(engine, P1, id("w"), "swca-recycle", { junk: [id("jc")] });
  assert.equal(readyResources(engine, P1), 2, "COST: Pay 3 (5 -> 2)");
  assert.equal(zoneOf(engine, id("jc")), "removed", "COST: the picked card is removed from the game");
});

clause(SWCA, "0:ability:swca-recycle", "COST pays 3; EFFECT removes the picked card, finds a legal card into the discard pile and draws one", () => {
  const { engine, id } = recycleBoard();
  const deckBefore = [...deckOf(engine, P1)];
  const handBefore = [...handOf(engine, P1)];
  activateRaw(engine, P1, id("w"), "swca-recycle", { junk: [id("jc")] });
  assert.equal(readyResources(engine, P1), 2, "COST: Pay 3 (5 -> 2)");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "the deck is not touched until it resolves");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)!.kind, "chooserSelectsTarget");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("c3")] });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("c3")), "discard", "found card goes to the discard pile, not hand or play");
  assert.ok(discardOf(engine, P1).includes(id("c3")), "discardOf(engine, P1).includes(id(\"c3\"))");
  assert.ok(!discardOf(engine, P1).includes(id("jc")), "the removed card is gone from the discard pile");
  for (const key of ["ji", "jt", "jl", "jr"]) assert.equal(zoneOf(engine, id(key)), "discard", "other discards untouched");
  assert.equal(zoneOf(engine, id("w")), "play", "the Artefact stays in play");
  assert.equal(handOf(engine, P1).length, handBefore.length + 1, "Draw a card");
  const drawn = handOf(engine, P1).find((c) => !handBefore.includes(c))!;
  assert.ok(deckBefore.includes(drawn) && drawn !== id("c3"), "the drawn card came off my deck");
  assert.equal(deckOf(engine, P1).length, deckBefore.length - 2, "one card found, one drawn");
});

clause(SWCA, "0:ability:swca-recycle", "X is the numeric cost of the picked card and the find must share its type: a cost-3 character", () => {
  recycleCase("jc", ["c0", "c2", "c3"], ["c4", "i1", "i3", "t2", "t5", "l2", "r0"]);
});

clause(SWCA, "0:ability:swca-recycle", "X is the numeric cost of the picked card: a cost-1 item finds only an item of cost 1 or less", () => {
  recycleCase("ji", ["i1"], ["i3", "c0", "c2", "t2", "l2", "r0"]);
});

clause(SWCA, "0:ability:swca-recycle", "same type for tactics and locations too (cost 2 tactic, cost 4 location)", () => {
  recycleCase("jt", ["t2"], ["t5", "c0", "i1", "l2", "r0"]);
  recycleCase("jl", ["l2"], ["l5", "c0", "i1", "t2", "r0"]);
});

clause(SWCA, "0:ability:swca-recycle", "the search is of my own deck only: the opponent's deck is not touched, even for a matching card", () => {
  const { engine, id } = recycleBoard();
  const oppDeck = [...deckOf(engine, P2)];
  activate(engine, P1, id("w"), "swca-recycle", { selected: { junk: [id("jc")] } });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("c2")] });
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.equal(handOf(engine, P2).length, 0);
});

clause(SWCA, "0:ability:swca-recycle", "the pick: only a non-resource card in my own discard pile (not a resource, not the opponent's discard, not hand/play/deck)", () => {
  const { engine, id } = recycleBoard();
  for (const [key, why] of [["jr", "a resource card in my discard pile"], ["oj", "a card in the opponent's discard pile"], ["hj", "a card in my hand"], ["pj", "a card in play"], ["c3", "a card in my deck"]] as const) {
    refused(() => activate(engine, P1, id("w"), "swca-recycle", { selected: { junk: [id(key)] } }), why);
  }
  assert.equal(readyResources(engine, P1), 5, "nothing was paid by the refused attempts");
  for (const key of ["jc", "ji", "jt", "jl"]) {
    const g = recycleBoard();
    activate(g.engine, P1, g.id("w"), "swca-recycle", { selected: { junk: [g.id(key)] } });
    assert.equal(zoneOf(g.engine, g.id(key)), "removed", `${key} can be picked`);
  }
});

clause(SWCA, "0:ability:swca-recycle", "cannot be used with only 2 resources (Pay 3); with exactly 3 it works", () => {
  const poor = recycleBoard({ resources: 2 });
  refused(() => activate(poor.engine, P1, poor.id("w"), "swca-recycle", { selected: { junk: [poor.id("jc")] } }), "2 resources");
  assert.equal(zoneOf(poor.engine, poor.id("jc")), "discard", "the picked card was not removed");
  const ok = recycleBoard({ resources: 3 });
  activate(ok.engine, P1, ok.id("w"), "swca-recycle", { selected: { junk: [ok.id("jc")] } });
  assert.equal(readyResources(ok.engine, P1), 0);
  assert.equal(zoneOf(ok.engine, ok.id("jc")), "removed");
});

clause(SWCA, "0:ability:swca-recycle", "the search may be failed (CR 312.2), yet the picked card is still gone, a card is still drawn and the deck is shuffled", () => {
  const { engine, id } = recycleBoard();
  const deckBefore = [...deckOf(engine, P1)];
  const handBefore = [...handOf(engine, P1)];
  activate(engine, P1, id("w"), "swca-recycle", { selected: { junk: [id("jc")] } });
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("jc")), "removed");
  for (const key of ["c0", "c2", "c3"]) assert.ok(deckOf(engine, P1).includes(id(key)) || handOf(engine, P1).includes(id(key)), `${key} was not discarded`);
  for (const key of ["c0", "c2", "c3"]) assert.notEqual(zoneOf(engine, id(key)), "discard");
  assert.equal(handOf(engine, P1).length, handBefore.length + 1, "Draw a card still happens");
  const drawn = handOf(engine, P1).find((c) => !handBefore.includes(c))!;
  assert.notEqual(drawn, deckBefore[0], "the deck was shuffled before the draw (with a rotating shuffle the old top card is not drawn)");
  assert.equal(deckOf(engine, P1).length, deckBefore.length - 1);
});

clause(SWCA, "0:ability:swca-recycle", "a found card shuffles the deck before the draw", () => {
  const { engine, id } = recycleBoard();
  const deckBefore = [...deckOf(engine, P1)];
  const handBefore = [...handOf(engine, P1)];
  activate(engine, P1, id("w"), "swca-recycle", { selected: { junk: [id("jc")] } });
  answerPending(engine, "chooserSelectsTarget", { selected: [id("c3")] });
  const remaining = deckBefore.filter((c) => c !== id("c3"));
  const drawn = handOf(engine, P1).find((c) => !handBefore.includes(c))!;
  assert.notEqual(drawn, remaining[0], "the old top card was not drawn: the deck was shuffled after the search");
  assert.deepEqual([...deckOf(engine, P1), drawn].sort(), [...remaining].sort(), "same cards, minus the drawn one");
});

clause(SWCA, "0:ability:swca-recycle", "no legal card in the deck: nothing to find, but the cost is paid, the card is removed and a card is drawn", () => {
  const deck: Cards = [
    { key: "c4", def: character({ name: "Big Char", cost: 4 }), owner: P1, zone: "deck" },
    { key: "i1", def: item({ name: "Small Item", cost: 1 }), owner: P1, zone: "deck" },
    { key: "c5", def: character({ name: "Bigger Char", cost: 5 }), owner: P1, zone: "deck" }
  ];
  const { engine, id } = recycleBoard({ deck });
  const handBefore = handOf(engine, P1).length;
  activate(engine, P1, id("w"), "swca-recycle", { selected: { junk: [id("jc")] } });
  assert.equal(pending(engine), undefined, "no legal find, no prompt");
  assert.equal(zoneOf(engine, id("jc")), "removed");
  assert.equal(readyResources(engine, P1), 2);
  assert.equal(handOf(engine, P1).length, handBefore + 1, "a card is still drawn");
  assert.equal(deckOf(engine, P1).length, 2);
  assert.equal(discardOf(engine, P1).includes(id("c4")), false);
});

// --- Seraphim Fusion

function fusionBoard(over: { resources?: number; ign?: Cards; noNiudla?: boolean; extra?: Cards } = {}) {
  return buildGame({
    random: () => 0,
    cards: [
      { key: "w", def: printing(SWCA), owner: P1, zone: "play" },
      ...bank("rage", over.resources ?? 5),
      ...(over.ign ?? [{ key: "ign", def: printing(IGNATIUS), owner: P1, zone: "play" } as CardPlacement]),
      { key: "mine", def: character({ name: "Plain Ally" }), owner: P1, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...(over.noNiudla ? [] : [{ key: "nid", def: printing(NIUDLA), owner: P1, zone: "deck" } as CardPlacement]),
      { key: "decoy", def: character({ name: "Uhluhtc", cost: 1 }), owner: P1, zone: "deck" },
      { key: "onid", def: printing(NIUDLA), owner: P2, zone: "deck" },
      { key: "hnid", def: printing(NIUDLA), owner: P1, zone: "hand" },
      ...(over.extra ?? [])
    ]
  });
}
const fuse = (g: ReturnType<typeof fusionBoard>, ign = "ign", nid = "nid") =>
  ({ selected: { ign: [g.id(ign)], tut2: [g.id(nid)] } });

clause(SWCA, "1:ability:swca-fusion", "COST: pay 4 and destroy the Artefact (already done while it waits); EFFECT puts Uhluhtc Niudla from my deck into play under my control", () => {
  const g = fusionBoard();
  const { engine, id } = g;
  const deckBefore = [...deckOf(engine, P1)];
  activateRaw(engine, P1, id("w"), "swca-fusion", fuse(g).selected);
  assert.equal(readyResources(engine, P1), 1, "COST: Pay 4 (5 -> 1)");
  assert.equal(zoneOf(engine, id("w")), "discard", "COST: destroy this card");
  assert.equal(zoneOf(engine, id("nid")), "deck", "nothing is found until it resolves");
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("nid")), "play");
  assert.equal(engine.state.cards[id("nid")].controllerId, P1);
  assert.equal(zoneOf(engine, id("ign")), "play", "the IGNATIOUS I picked is not destroyed");
  assert.equal(zoneOf(engine, id("onid")), "deck", "the opponent's deck is not searched");
  assert.equal(zoneOf(engine, id("hnid")), "hand", "a copy in hand is not the one found");
  const remaining = deckBefore.filter((c) => c !== id("nid"));
  assert.notDeepEqual(deckOf(engine, P1), remaining, "the deck was shuffled after the search");
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...remaining].sort());
});

clause(SWCA, "1:ability:swca-fusion", "any UNIQUE IGNATIOUS I control works: the second printing (Ignatious, Tactician Crafter) is accepted too", () => {
  const g = fusionBoard({ ign: [{ key: "ign", def: printing(IGNATIOUS2), owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("w"), "swca-fusion", fuse(g));
  assert.equal(zoneOf(g.engine, g.id("nid")), "play");
  assert.equal(zoneOf(g.engine, g.id("w")), "discard");
});

clause(SWCA, "1:ability:swca-fusion", "the pick must be a UNIQUE IGNATIOUS that I control: not another card, another UNIQUE, the opponent's, one in hand", () => {
  const control = fusionBoard();
  activate(control.engine, P1, control.id("w"), "swca-fusion", fuse(control)); // positive control
  assert.equal(zoneOf(control.engine, control.id("nid")), "play");

  const none = fusionBoard({ ign: [] });
  refused(() => activate(none.engine, P1, none.id("w"), "swca-fusion", fuse(none, "mine")), "an ordinary character is not an IGNATIOUS");
  assert.equal(zoneOf(none.engine, none.id("w")), "play");
  assert.equal(readyResources(none.engine, P1), 5, "nothing paid");

  const otherUnique = fusionBoard({ ign: [{ key: "ign", def: printing(NIUDLA), owner: P1, zone: "play" }] });
  refused(() => activate(otherUnique.engine, P1, otherUnique.id("w"), "swca-fusion", fuse(otherUnique, "ign", "decoy")), "UNIQUE UHLUHTC is not UNIQUE IGNATIOUS");

  const opp = fusionBoard({ ign: [{ key: "ign", def: printing(IGNATIUS), owner: P2, zone: "play" }] });
  refused(() => activate(opp.engine, P1, opp.id("w"), "swca-fusion", fuse(opp)), "the opponent's IGNATIOUS");

  const hand = fusionBoard({ ign: [{ key: "ign", def: printing(IGNATIUS), owner: P1, zone: "hand" }] });
  refused(() => activate(hand.engine, P1, hand.id("w"), "swca-fusion", fuse(hand)), "an IGNATIOUS in hand");
});

clause(SWCA, "1:ability:swca-fusion", "the found card must be named exactly Uhluhtc Niudla and be in my own deck", () => {
  const g = fusionBoard();
  for (const key of ["decoy", "onid", "hnid", "mine", "d0"]) {
    refused(() => activate(g.engine, P1, g.id("w"), "swca-fusion", fuse(g, "ign", key)), `${key} is not Uhluhtc Niudla in my deck`);
  }
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(readyResources(g.engine, P1), 5);
});

clause(SWCA, "1:ability:swca-fusion", "cannot be used with only 3 resources (Pay 4)", () => {
  const poor = fusionBoard({ resources: 3 });
  refused(() => activate(poor.engine, P1, poor.id("w"), "swca-fusion", fuse(poor)), "3 resources");
  assert.equal(zoneOf(poor.engine, poor.id("w")), "play", "the Artefact was not destroyed");
  const ok = fusionBoard({ resources: 4 });
  activate(ok.engine, P1, ok.id("w"), "swca-fusion", fuse(ok));
  assert.equal(zoneOf(ok.engine, ok.id("nid")), "play");
  assert.equal(readyResources(ok.engine, P1), 0);
});

clause(SWCA, "1:ability:swca-fusion", "no Uhluhtc Niudla in the deck: a search can find nothing, so the cost is still paid and nothing enters play (CR 312.2)", () => {
  const g = fusionBoard({ noNiudla: true });
  activate(g.engine, P1, g.id("w"), "swca-fusion", { selected: { ign: [g.id("ign")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("w")), "discard", "the Artefact is destroyed as the cost");
  assert.equal(readyResources(g.engine, P1), 1, "Pay 4");
  assert.equal(zoneOf(g.engine, g.id("onid")), "deck");
  assert.equal(zoneOf(g.engine, g.id("hnid")), "hand");
});

clause(SWCA, "1:ability:swca-fusion", "a search with specific criteria may be failed even when the card is there (CR 312.2)", () => {
  const g = fusionBoard();
  activate(g.engine, P1, g.id("w"), "swca-fusion", { selected: { ign: [g.id("ign")], tut2: [] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("w")), "discard");
  assert.equal(readyResources(g.engine, P1), 1);
  assert.equal(zoneOf(g.engine, g.id("nid")), "deck", "the search was declined");
});

// =====================================================================================================================
// Serpentine Scepter
// =====================================================================================================================

const KILL = { type: "destroy", target: picked };
const BOUNCE = { type: "moveCard", target: picked, to: "hand" };
const FLIP = { type: "flipFaceDown", target: picked };

function scepterBoard(over: { resources?: number; hostDepleted?: boolean; oppHostDepleted?: boolean; extra?: Cards; deck?: number } = {}) {
  return buildGame({
    cards: [
      { key: "sc", def: printing(SCEPTER), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", cost: 1, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play", depleted: over.hostDepleted ?? false },
      { key: "other", def: character({ name: "Other", cost: 1, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "oppHost", def: character({ name: "Opp Host", cost: 1, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play", depleted: over.oppHostDepleted ?? false },
      { key: "osc", def: printing(SCEPTER), owner: P1, zone: "play", attachedToKey: "oppHost" },
      ...bank("rage", over.resources ?? 3),
      ...fillers("d", over.deck ?? 6, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...(over.extra ?? [])
    ]
  });
}

function attachBoard(over: { resources?: Cards; extra?: Cards } = {}) {
  return buildGame({
    cards: [
      { key: "sc", def: printing(SCEPTER), owner: P1, zone: "hand" },
      ...(over.resources ?? bank("obsession", 1)),
      { key: "mine", def: character({ name: "My Char" }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Their Char" }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "An Item" }), owner: P1, zone: "play" },
      { key: "lo", def: location({ name: "A Location" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "hc", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "Dead Char" }), owner: P1, zone: "discard" },
      ...(over.extra ?? [])
    ]
  });
}

clause(SCEPTER, "0:attach", "deployed at cost 1 (Obsession) it enters play attached to the character I pick", () => {
  const { engine, id } = attachBoard();
  const before = readyResources(engine, P1);
  play(engine, P1, id("sc"), { selected: { attachTo: [id("mine")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("sc")), "play");
  assert.equal(engine.state.cards[id("sc")].attachedTo, id("mine"));
  assert.equal(readyResources(engine, P1), before - 1, "cost 1 was paid");
  assert.equal(engine.state.cards[id("theirs")].attachedTo, undefined);
});

clause(SCEPTER, "0:attach", "it can attach to any character, including the opponent's", () => {
  const { engine, id } = attachBoard();
  play(engine, P1, id("sc"), { selected: { attachTo: [id("theirs")] } });
  assert.equal(zoneOf(engine, id("sc")), "play");
  assert.equal(engine.state.cards[id("sc")].attachedTo, id("theirs"));
});

clause(SCEPTER, "0:attach", "a non-character cannot be the host: item, location, either faction, a face-down card, a card in hand or discard", () => {
  const { engine, id } = attachBoard();
  const before = readyResources(engine, P1);
  const bad: Array<[string, string]> = [
    ["it", "an item"], ["lo", "a location"], ["fd", "a face-down card (a resource)"], ["hc", "a character in hand"], ["dc", "a character in the discard pile"]
  ];
  for (const [key, why] of bad) refused(() => play(engine, P1, id("sc"), { selected: { attachTo: [id(key)] } }), why);
  refused(() => play(engine, P1, id("sc"), { selected: { attachTo: [factionOf(engine, P2)] } }), "the opponent's faction");
  refused(() => play(engine, P1, id("sc"), { selected: { attachTo: [factionOf(engine, P1)] } }), "my own faction");
  assert.equal(zoneOf(engine, id("sc")), "hand");
  assert.equal(readyResources(engine, P1), before, "refused attempts cost nothing");
  play(engine, P1, id("sc"), { selected: { attachTo: [id("mine")] } }); // control
  assert.equal(zoneOf(engine, id("sc")), "play");
});

clause(SCEPTER, "0:attach", "with no character in play there is nothing to attach to", () => {
  const { engine, id } = buildGame({ cards: [{ key: "sc", def: printing(SCEPTER), owner: P1, zone: "hand" }, ...bank("obsession", 1), { key: "it", def: item({ name: "An Item" }), owner: P1, zone: "play" }] });
  refused(() => play(engine, P1, id("sc"), { selected: {} }), "no character to attach to");
  assert.equal(zoneOf(engine, id("sc")), "hand");
});

clause(SCEPTER, "0:attach", "it is a 1-cost item with an Obsession threshold: refused with no resource, refused with a Rage", () => {
  const none = attachBoard({ resources: [] });
  refused(() => play(none.engine, P1, none.id("sc"), { selected: { attachTo: [none.id("mine")] } }), "no resources");
  const rage = attachBoard({ resources: bank("rage", 1) });
  refused(() => play(rage.engine, P1, rage.id("sc"), { selected: { attachTo: [rage.id("mine")] } }), "threshold o with a Rage");
  assert.equal(zoneOf(rage.engine, rage.id("sc")), "hand");
});

clause(SCEPTER, "0:attach", "when the host is destroyed the Scepter leaves play too (to the discard pile)", () => {
  const g = scepterBoard({ extra: [{ key: "rm", def: remote("Killer", { zone: "play", type: "character" }, KILL), owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("rm"), "go", { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "discard");
  assert.equal(zoneOf(g.engine, g.id("sc")), "discard", "the attached Scepter goes with its host");
  assert.equal(zoneOf(g.engine, g.id("osc")), "play", "a Scepter on another host stays");
});

clause(SCEPTER, "0:attach", "when the host returns to hand the Scepter leaves play the same way (to its owner's hand)", () => {
  const g = scepterBoard({ extra: [{ key: "rm", def: remote("Bouncer", { zone: "play", type: "character" }, BOUNCE), owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("rm"), "go", { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "hand");
  assert.equal(zoneOf(g.engine, g.id("sc")), "hand", "CR 301.4: it leaves play the same way its host did");
});

clause(SCEPTER, "0:attach", "if the host stops being a character (flipped face-down) the Scepter is flipped face-down with it", () => {
  const g = scepterBoard({ extra: [{ key: "rm", def: remote("Flipper", { zone: "play", type: "character" }, FLIP), owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("rm"), "go", { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("sc")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(g.engine.state.cards[g.id("sc")].faceDown, true, "...and is flipped face-down along with its host");
});

clause(SCEPTER, "1:ability:serpentine-drain", "Pay 1 (already paid while it waits); EFFECT depletes the attached character and nobody else", () => {
  const { engine, id } = scepterBoard();
  activateRaw(engine, P1, id("sc"), "serpentine-drain");
  assert.equal(readyResources(engine, P1), 2, "COST: Pay 1 (3 -> 2)");
  assert.equal(isDepleted(engine, id("host")), false, "not depleted until it resolves");
  resolvePendingResponses(engine);
  assert.equal(isDepleted(engine, id("host")), true);
  assert.equal(isDepleted(engine, id("oppHost")), false, "the other Scepter's host is untouched");
  assert.equal(isDepleted(engine, id("sc")), false, "the Scepter itself is not depleted");
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(SCEPTER, "1:ability:serpentine-drain", "works on an opponent's character the Scepter is attached to, and on an already-depleted host (still costs 1)", () => {
  const { engine, id } = scepterBoard();
  activate(engine, P1, id("osc"), "serpentine-drain");
  assert.equal(isDepleted(engine, id("oppHost")), true);
  assert.equal(isDepleted(engine, id("host")), false);
  const dep = scepterBoard({ hostDepleted: true });
  activate(dep.engine, P1, dep.id("sc"), "serpentine-drain");
  assert.equal(isDepleted(dep.engine, dep.id("host")), true);
  assert.equal(readyResources(dep.engine, P1), 2, "Pay 1 even though there was nothing to deplete");
});

clause(SCEPTER, "1:ability:serpentine-drain", "no once-per-turn limit: it can be used again (paying 1 each time) and needs a resource", () => {
  const { engine, id } = scepterBoard({ resources: 2 });
  activate(engine, P1, id("sc"), "serpentine-drain");
  engine.state.cards[id("host")].depleted = false;
  activate(engine, P1, id("sc"), "serpentine-drain");
  assert.equal(isDepleted(engine, id("host")), true);
  assert.equal(readyResources(engine, P1), 0);
  engine.state.cards[id("host")].depleted = false;
  refused(() => activate(engine, P1, id("sc"), "serpentine-drain"), "no resource left to Pay 1");
  assert.equal(isDepleted(engine, id("host")), false);
});

clause(SCEPTER, "2:ability:serpentine-charge", "Pay 1 (already paid while it waits); EFFECT restores the attached character only", () => {
  const { engine, id } = scepterBoard({ hostDepleted: true });
  activateRaw(engine, P1, id("sc"), "serpentine-charge");
  assert.equal(readyResources(engine, P1), 2, "COST: Pay 1 (3 -> 2)");
  assert.equal(isDepleted(engine, id("host")), true, "not restored until it resolves");
  resolvePendingResponses(engine);
  assert.equal(isDepleted(engine, id("host")), false, "restored");
  assert.equal(isDepleted(engine, id("other")), true, "an unrelated depleted character stays depleted");
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(SCEPTER, "2:ability:serpentine-charge", "it restores an opponent's depleted host too", () => {
  const { engine, id } = scepterBoard({ oppHostDepleted: true });
  activate(engine, P1, id("osc"), "serpentine-charge");
  assert.equal(isDepleted(engine, id("oppHost")), false);
});

clause(SCEPTER, "2:ability:serpentine-charge", "the restored character cannot attack this turn, while others can", () => {
  const control = scepterBoard({ hostDepleted: true });
  control.engine.state.cards[control.id("host")].depleted = false;
  declareAttackBy(control.engine, P1, [control.id("host")]);
  assert.ok(control.engine.state.battle, "without Soul Charge the host attacks normally");

  const { engine, id } = scepterBoard({ hostDepleted: true });
  activate(engine, P1, id("sc"), "serpentine-charge");
  assert.equal(isDepleted(engine, id("host")), false);
  refused(() => declareAttackBy(engine, P1, [id("host")]), "the host cannot attack this turn");
  assert.equal(engine.state.battle, undefined);
  engine.state.cards[id("other")].depleted = false;
  declareAttackBy(engine, P1, [id("other")]);
  assert.ok(engine.state.battle, "another character is not restricted");
});

clause(SCEPTER, "2:ability:serpentine-charge", "the host is restricted even if it was not depleted (the restore does nothing, the restriction and cost still apply)", () => {
  const { engine, id } = scepterBoard({ hostDepleted: false });
  activate(engine, P1, id("sc"), "serpentine-charge");
  assert.equal(readyResources(engine, P1), 2);
  refused(() => declareAttackBy(engine, P1, [id("host")]), "the host cannot attack this turn");
});

clause(SCEPTER, "2:ability:serpentine-charge", "usable only once each turn, but again on the next turn; the attack restriction ends with the turn", () => {
  const { engine, id } = scepterBoard({ hostDepleted: true, resources: 4 });
  activate(engine, P1, id("sc"), "serpentine-charge");
  activate(engine, P1, id("sc"), "serpentine-drain"); // deplete the host again so a second restore would be meaningful
  assert.equal(isDepleted(engine, id("host")), true);
  refused(() => activate(engine, P1, id("sc"), "serpentine-charge"), "second use in the same turn", /only 1 time/);
  assert.equal(isDepleted(engine, id("host")), true, "the refused second use restored nothing");
  assert.equal(readyResources(engine, P1), 2, "and cost nothing");
  // the copy on the other host has its own limit
  activate(engine, P1, id("osc"), "serpentine-charge");
  // next turn
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("host")), false, "restored by the normal turn start");
  engine.state.cards[id("host")].depleted = true;
  activate(engine, P1, id("sc"), "serpentine-charge");
  assert.equal(isDepleted(engine, id("host")), false, "usable again on a new turn");
});

clause(SCEPTER, "2:ability:serpentine-charge", "the attack restriction lasts only this turn: next turn the host attacks", () => {
  const { engine, id } = scepterBoard({ hostDepleted: true });
  activate(engine, P1, id("sc"), "serpentine-charge");
  refused(() => declareAttackBy(engine, P1, [id("host")]), "restricted this turn");
  endTurn(engine, P1);
  endTurn(engine, P2);
  declareAttackBy(engine, P1, [id("host")]);
  assert.ok(engine.state.battle, "the restriction is gone on my next turn");
});

clause(SCEPTER, "2:ability:serpentine-charge", "needs a resource to Pay 1", () => {
  const poor = scepterBoard({ hostDepleted: true, resources: 0 });
  refused(() => activate(poor.engine, P1, poor.id("sc"), "serpentine-charge"), "no resources");
  assert.equal(isDepleted(poor.engine, poor.id("host")), true);
});

// =====================================================================================================================
// Thabbashite Barbeque
// =====================================================================================================================

function bbqBoard(over: { oppResources?: number; myResources?: Cards; oppHand?: Cards; extra?: Cards } = {}) {
  return buildGame({
    cards: [
      { key: "bq", def: printing(BBQ), owner: P1, zone: "hand" },
      ...(over.myResources ?? bank("obsession", 4)),
      { key: "mine", def: character({ name: "My Char" }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Their Char" }), owner: P2, zone: "play" },
      { key: "theirItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "theirLoc", def: location({ name: "Their Loc" }), owner: P2, zone: "play" },
      ...bank("rage", over.oppResources ?? 2, P2),
      ...(over.oppHand ?? [
        { key: "oc", def: character({ name: "Opp Hand Char" }), owner: P2, zone: "hand" } as CardPlacement,
        { key: "oi", def: item({ name: "Opp Hand Item" }), owner: P2, zone: "hand" } as CardPlacement,
        { key: "or", def: resourceCard({ name: "Opp Hand Res" }), owner: P2, zone: "hand" } as CardPlacement
      ]),
      { key: "mh", def: character({ name: "My Other Hand Card" }), owner: P1, zone: "hand" },
      ...(over.extra ?? [])
    ]
  });
}
const castBbq = (g: ReturnType<typeof bbqBoard>, pick: string) => play(g.engine, P1, g.id("bq"), { selected: { picked: [g.id(pick)] } });

clause(BBQ, "0:extraCost", "any non-resource card in play can be picked: my character, their character, their item, their location", () => {
  for (const key of ["mine", "theirs", "theirItem", "theirLoc"]) {
    const g = bbqBoard();
    castBbq(g, key);
    const pc = pending(g.engine)!;
    assert.equal(pc.kind, "mayPay", `${key}: played with that pick, the opponent is asked`);
    assert.equal(pc.playerId, P2);
    assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key}: the pick itself changes nothing yet`);
  }
});

clause(BBQ, "0:extraCost", "a resource, a face-down card, a faction, or a card outside play cannot be picked", () => {
  const g = bbqBoard({
    extra: [
      { key: "myRes", def: resourceCard({ name: "My Staple" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "dc", def: character({ name: "Dead Char" }), owner: P1, zone: "discard" }
    ]
  });
  refused(() => castBbq(g, "myRes"), "a face-up resource");
  refused(() => castBbq(g, "fd"), "a face-down card is a resource");
  refused(() => castBbq(g, "oc"), "a card in the opponent's hand");
  refused(() => castBbq(g, "mh"), "a card in my own hand");
  refused(() => castBbq(g, "dc"), "a card in a discard pile");
  refused(() => play(g.engine, P1, g.id("bq"), { selected: { picked: [factionOf(g.engine, P2)] } }), "a faction");
  assert.equal(zoneOf(g.engine, g.id("bq")), "hand", "still in hand after every refusal");
  assert.equal(readyResources(g.engine, P1), 5, "4 Obsession + my face-up staple; refused attempts paid nothing");
  castBbq(g, "theirs"); // control
  assert.equal(pending(g.engine)!.kind, "mayPay");
});

clause(BBQ, "0:extraCost", "with no non-resource card in play it cannot be played; it costs 4 with three Obsession", () => {
  const empty = buildGame({
    cards: [{ key: "bq", def: printing(BBQ), owner: P1, zone: "hand" }, ...bank("obsession", 4), ...bank("rage", 2, P2)]
  });
  refused(() => play(empty.engine, P1, empty.id("bq"), { selected: {} }), "nothing to pick");
  const short = bbqBoard({ myResources: bank("obsession", 3) });
  refused(() => castBbq(short, "theirs"), "cost 4 with 3 resources");
  const noIcons = bbqBoard({ myResources: [...bank("obsession", 2), ...bank("rage", 2)] });
  refused(() => castBbq(noIcons, "theirs"), "threshold ooo with two Obsession");
  const ok = bbqBoard({ myResources: [...bank("obsession", 3), ...bank("rage", 1)] });
  castBbq(ok, "theirs");
  assert.equal(readyResources(ok.engine, P1), 0, "cost 4 paid");
});

clause(BBQ, "1:rule", "opponent PAYS 2: this card goes back to its owner's hand, nothing else happens", () => {
  const g = bbqBoard();
  const { engine, id } = g;
  castBbq(g, "theirs");
  assert.equal(pending(engine)!.kind, "mayPay");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(pending(engine), undefined, "terminated: no look at the hand, no further prompt");
  assert.equal(readyResources(engine, P2), 0, "the opponent paid 2 resources");
  assert.equal(zoneOf(engine, id("bq")), "hand", "put into its owner's hand");
  assert.ok(handOf(engine, P1).includes(id("bq")), "handOf(engine, P1).includes(id(\"bq\"))");
  assert.ok(!discardOf(engine, P1).includes(id("bq")), "and not discarded");
  assert.equal(zoneOf(engine, id("theirs")), "play", "the picked card stays");
  for (const key of ["oc", "oi", "or"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} untouched`);
  assert.equal(discardOf(engine, P2).length, 0);
  assert.equal(readyResources(engine, P1), 0, "I do not get the 4 back");
});

clause(BBQ, "1:rule", "opponent DECLINES: the picked card goes to its owner's hand, then I look at their hand and they discard the non-resource card I choose", () => {
  const g = bbqBoard();
  const { engine, id } = g;
  castBbq(g, "theirs");
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(zoneOf(engine, id("theirs")), "hand", "the picked card is put into its owner's hand");
  assert.equal(readyResources(engine, P2), 2, "the opponent paid nothing");
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose the card");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oi")] });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("oi")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("oi")), "they discard it into their own discard pile");
  for (const key of ["oc", "or", "theirs"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in their hand`);
  assert.equal(zoneOf(engine, id("bq")), "discard", "the tactic ends in its owner's discard pile, not hand");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("mh")), "hand");
});

clause(BBQ, "1:rule", "my own character picked: it returns to MY hand, and my hand is not part of the opponent's-hand choice", () => {
  const g = bbqBoard();
  const { engine, id } = g;
  castBbq(g, "mine");
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.ok(handOf(engine, P1).includes(id("mine")), "handOf(engine, P1).includes(id(\"mine\"))");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("mine")] }), "my own card is not in the opponent's hand");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("mh")] }), "my hand card");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
  assert.equal(zoneOf(engine, id("oc")), "discard");
  assert.equal(zoneOf(engine, id("mine")), "hand", "my bounced character is safe");
});

clause(BBQ, "1:rule", "item and location picks return to their owner's hand too", () => {
  for (const key of ["theirItem", "theirLoc"]) {
    const g = bbqBoard();
    castBbq(g, key);
    answerPending(g.engine, "mayPay", { pay: false });
    assert.equal(zoneOf(g.engine, g.id(key)), "hand", key);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oc")] });
  }
});

clause(BBQ, "1:rule", "the picked card goes to its OWNER's hand even when I control it", () => {
  const g = bbqBoard({ extra: [{ key: "stolen", def: character({ name: "Borrowed" }), owner: P2, zone: "play", controller: P1 }] });
  const { engine, id } = g;
  castBbq(g, "stolen");
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(zoneOf(engine, id("stolen")), "hand");
  assert.ok(handOf(engine, P2).includes(id("stolen")), "its owner (the opponent) gets it");
  assert.ok(!handOf(engine, P1).includes(id("stolen")), "!handOf(engine, P1).includes(id(\"stolen\"))");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("oc")] });
});

clause(BBQ, "1:rule", "the bounced card is already in their hand when I look: I may choose it to be discarded", () => {
  const g = bbqBoard({ oppHand: [{ key: "or", def: resourceCard({ name: "Opp Hand Res" }), owner: P2, zone: "hand" }] });
  const { engine, id } = g;
  castBbq(g, "theirs");
  answerPending(engine, "mayPay", { pay: false });
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget", "the bounced card is a legal choice");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("or")] }), "a resource in their hand cannot be chosen");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("theirs")] });
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("theirs")), "discardOf(engine, P2).includes(id(\"theirs\"))");
  assert.equal(zoneOf(engine, id("or")), "hand");
});

clause(BBQ, "1:rule", "only non-resource cards in their hand can be chosen: the resource card is refused, every other card accepted", () => {
  const g = bbqBoard();
  castBbq(g, "theirs");
  answerPending(g.engine, "mayPay", { pay: false });
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("or")] }), "a resource card in their hand");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("theirItem")] }), "a card in play");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oc")] });
  assert.equal(zoneOf(g.engine, g.id("oc")), "discard", "a character is a legal choice");
  const h = bbqBoard();
  castBbq(h, "theirs");
  answerPending(h.engine, "mayPay", { pay: false });
  answerPending(h.engine, "chooserSelectsTarget", { selected: [h.id("theirs")] });
  assert.equal(zoneOf(h.engine, h.id("theirs")), "discard", "the card bounced a moment ago is a legal choice too");
});

clause(BBQ, "1:rule", "their hand holds only resources (or nothing): no card can be discarded, nothing breaks, the picked card still returns", () => {
  const resOnly = bbqBoard({ oppHand: [{ key: "or", def: resourceCard({ name: "Opp Hand Res" }), owner: P2, zone: "hand" }], extra: [{ key: "stolen", def: character({ name: "Borrowed" }), owner: P1, zone: "play", controller: P2 }] });
  castBbq(resOnly, "stolen"); // owner P1: goes to MY hand, so their hand is resources only
  answerPending(resOnly.engine, "mayPay", { pay: false });
  assert.equal(pending(resOnly.engine), undefined, "no legal card to choose, so nothing is asked");
  assert.equal(zoneOf(resOnly.engine, resOnly.id("or")), "hand");
  assert.equal(zoneOf(resOnly.engine, resOnly.id("stolen")), "hand");
  assert.equal(zoneOf(resOnly.engine, resOnly.id("bq")), "discard");
  const empty = bbqBoard({ oppHand: [], extra: [{ key: "stolen", def: character({ name: "Borrowed" }), owner: P1, zone: "play", controller: P2 }] });
  castBbq(empty, "stolen");
  answerPending(empty.engine, "mayPay", { pay: false });
  assert.equal(pending(empty.engine), undefined);
  assert.equal(discardOf(empty.engine, P2).length, 0);
});

clause(BBQ, "1:rule", "an opponent with fewer than 2 resources cannot pay: the else branch happens", () => {
  const g = bbqBoard({ oppResources: 1 });
  castBbq(g, "theirs");
  const first = pending(g.engine)!;
  assert.equal(first.kind, "chooserSelectsTarget", "the opponent is not offered a payment they cannot make");
  assert.equal(first.playerId, P1);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "hand", "the pick was returned");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oc")] });
  assert.equal(zoneOf(g.engine, g.id("oc")), "discard");
  assert.equal(readyResources(g.engine, P2), 1);
  assert.equal(zoneOf(g.engine, g.id("bq")), "discard");
});

clause(BBQ, "1:rule", "the payment is exactly 2 of their resources (a third stays ready)", () => {
  const g = bbqBoard({ oppResources: 3 });
  castBbq(g, "theirs");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(readyResources(g.engine, P2), 1);
  assert.equal(zoneOf(g.engine, g.id("bq")), "hand");
});

// =====================================================================================================================
// Thabbashite Communicant
// =====================================================================================================================

function commBoard(over: { p2Active?: boolean; deck?: number; copies?: number; extra?: Cards; inHand?: boolean } = {}) {
  const copies = over.copies ?? 1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: over.p2Active ? P2 : P1,
    cards: [
      ...Array.from({ length: copies }, (_, i): CardPlacement => ({ key: `cm${i}`, def: printing(COMM), owner: P1, zone: over.inHand ? "hand" : "play" })),
      { key: "hRes", def: resourceCard({ name: "Hand Staple" }), owner: P1, zone: "hand" },
      { key: "hChar", def: character({ name: "Hand Char", cost: 0 }), owner: P1, zone: "hand" },
      { key: "oRes", def: resourceCard({ name: "Opp Staple" }), owner: P2, zone: "hand" },
      { key: "oChar", def: character({ name: "Opp Char", cost: 0 }), owner: P2, zone: "hand" },
      ...fillers("d", over.deck ?? 5, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...(over.extra ?? [])
    ]
  });
}

clause(COMM, "0:rule", "a 4-cost Obsession character, 2 strength / 3 speed / 3 life", () => {
  const { engine, id } = buildGame({ cards: [{ key: "cm", def: printing(COMM), owner: P1, zone: "hand" }, ...bank("obsession", 1), ...bank("rage", 3)] });
  play(engine, P1, id("cm"));
  assert.equal(zoneOf(engine, id("cm")), "play");
  assert.equal(engine.getStat(id("cm"), "strength"), 2);
  assert.equal(engine.getStat(id("cm"), "speed"), 3);
  assert.equal(engine.getStat(id("cm"), "life"), 3);
  assert.equal(readyResources(engine, P1), 0, "cost 4");
  const short = buildGame({ cards: [{ key: "cm", def: printing(COMM), owner: P1, zone: "hand" }, ...bank("obsession", 1), ...bank("rage", 2)] });
  refused(() => play(short.engine, P1, short.id("cm")), "3 resources");
  const noIcon = buildGame({ cards: [{ key: "cm", def: printing(COMM), owner: P1, zone: "hand" }, ...bank("rage", 4)] });
  refused(() => play(noIcon.engine, P1, noIcon.id("cm")), "no Obsession");
});

clause(COMM, "0:rule", "a face-down card (provides [V]) entering play under my control lets me look at the top card of my deck, and put it on the bottom", () => {
  const { engine, id } = commBoard();
  const deck = [...deckOf(engine, P1)];
  developResource(engine, P1, id("hChar"), true);
  const pc = pending(engine)!;
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cardIds, [deck[0]], "I look at exactly the top card");
  answerPending(engine, "reorderDeck", { order: [deck[0]] });
  assert.equal(pending(engine), undefined, "one look per card entering");
  assert.deepEqual(deckOf(engine, P1), [...deck.slice(1), deck[0]], "the top card is now on the bottom, the rest keep their order");
});

clause(COMM, "0:rule", "I may decline: I can look and leave the top card where it is", () => {
  const { engine, id } = commBoard();
  const deck = [...deckOf(engine, P1)];
  developResource(engine, P1, id("hChar"), true);
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deckOf(engine, P1), deck, "declining leaves the deck exactly as it was");
});

clause(COMM, "0:rule", "a real resource card played face-down also provides [V] and triggers it", () => {
  const { engine, id } = commBoard();
  developResource(engine, P1, id("hRes"), true);
  assert.equal(engine.state.cards[id("hRes")].faceDown, true);
  assert.equal(pending(engine)?.kind, "reorderDeck");
});

clause(COMM, "0:rule", "a face-up staple resource provides no [V]: no look", () => {
  const { engine, id } = commBoard();
  const deck = [...deckOf(engine, P1)];
  developResource(engine, P1, id("hRes"), false);
  assert.equal(zoneOf(engine, id("hRes")), "play");
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deckOf(engine, P1), deck);
});

clause(COMM, "0:rule", "a character entering play (provides no [V]) does not trigger it", () => {
  const { engine, id } = commBoard();
  play(engine, P1, id("hChar"));
  assert.equal(zoneOf(engine, id("hChar")), "play");
  assert.equal(pending(engine), undefined);
});

clause(COMM, "0:rule", "a [V] card entering play under the OPPONENT's control does not trigger it", () => {
  const { engine, id } = commBoard({ p2Active: true });
  const deck = [...deckOf(engine, P1)];
  developResource(engine, P2, id("oChar"), true);
  assert.equal(engine.state.cards[id("oChar")].faceDown, true);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deckOf(engine, P1), deck);
});

clause(COMM, "0:rule", "it does nothing while it is not in play (in hand)", () => {
  const { engine, id } = commBoard({ inHand: true });
  developResource(engine, P1, id("hChar"), true);
  assert.equal(pending(engine), undefined);
});

clause(COMM, "0:rule", "a [V] card put into play by flipping a resource face-down counts as entering play (CR 411.3)", () => {
  const flip = remote("Flipper", { zone: "play", type: "resource", controller: "self", faceDown: false }, FLIP);
  const { engine, id } = commBoard({ extra: [{ key: "up", def: resourceCard({ name: "Face-up Staple" }), owner: P1, zone: "play" }, { key: "fl", def: flip, owner: P1, zone: "play" }] });
  const deck = [...deckOf(engine, P1)];
  activate(engine, P1, id("fl"), "go", { selected: { t: [id("up")] } });
  assert.equal(engine.state.cards[id("up")].faceDown, true);
  const pc = pending(engine);
  assert.equal(pc?.kind, "reorderDeck", "the new face-down card entered play");
  assert.deepEqual(pc?.cardIds, [deck[0]]);
});

clause(COMM, "0:rule", "a card put into play face-down by an effect (not the Develop Rule) under my control triggers it too, with exactly one look", () => {
  const putter = remote("Putter", { owner: "self", zone: "hand" }, { type: "putIntoPlay", target: picked, controller: "controller", faceDown: true });
  const { engine, id } = commBoard({ extra: [{ key: "pt", def: putter, owner: P1, zone: "play" }] });
  const deck = [...deckOf(engine, P1)];
  activate(engine, P1, id("pt"), "go", { selected: { t: [id("hChar")] } });
  assert.equal(engine.state.cards[id("hChar")].faceDown, true);
  assert.equal(engine.state.cards[id("hChar")].controllerId, P1);
  const pc = pending(engine);
  assert.equal(pc?.kind, "reorderDeck", "a face-down card entered play under my control");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual(pc?.cardIds, [deck[0]]);
  answerPending(engine, "reorderDeck", { order: [deck[0]] });
  assert.equal(pending(engine), undefined, "one look for one card entering");
  assert.deepEqual(deckOf(engine, P1), [...deck.slice(1), deck[0]]);
});

clause(COMM, "0:rule", "a [V] card put into play under the OPPONENT's control by an effect does not trigger it", () => {
  const putter = remote("Giver", { owner: "self", zone: "hand" }, { type: "putIntoPlay", target: picked, controller: "opponent", faceDown: true });
  const { engine, id } = commBoard({ extra: [{ key: "pt", def: putter, owner: P1, zone: "play" }] });
  const deck = [...deckOf(engine, P1)];
  activate(engine, P1, id("pt"), "go", { selected: { t: [id("hChar")] } });
  assert.equal(engine.state.cards[id("hChar")].controllerId, P2, "it entered under the opponent's control");
  assert.equal(engine.state.cards[id("hChar")].faceDown, true);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deckOf(engine, P1), deck);
});

clause(COMM, "0:rule", "a face-up card put into play by an effect provides no [V]: no look", () => {
  const putter = remote("Putter", { owner: "self", zone: "hand" }, { type: "putIntoPlay", target: picked, controller: "controller" });
  const { engine, id } = commBoard({ extra: [{ key: "pt", def: putter, owner: P1, zone: "play" }] });
  activate(engine, P1, id("pt"), "go", { selected: { t: [id("hChar")] } });
  assert.equal(zoneOf(engine, id("hChar")), "play");
  assert.equal(engine.state.cards[id("hChar")].faceDown, false);
  assert.equal(pending(engine), undefined);
});

clause(COMM, "0:rule", "an empty deck: nothing to look at, nothing breaks", () => {
  const { engine, id } = commBoard({ deck: 0 });
  developResource(engine, P1, id("hChar"), true);
  assert.equal(pending(engine), undefined);
  assert.equal(deckOf(engine, P1).length, 0);
});

clause(COMM, "0:rule", "each Communicant in play triggers separately: two copies give two looks", () => {
  const { engine, id } = commBoard({ copies: 2 });
  const deck = [...deckOf(engine, P1)];
  developResource(engine, P1, id("hChar"), true);
  let looks = 0;
  const seen: string[][] = [];
  drain(engine, (pc) => {
    if (pc.kind === "orderTriggers") return declineAll(pc);
    assert.equal(pc.kind, "reorderDeck");
    looks += 1;
    seen.push([...(pc.cardIds as string[])]);
    return { kind: "reorderDeck", order: [...(pc.cardIds as string[])] };
  });
  assert.equal(looks, 2, "one look per Communicant");
  assert.deepEqual(seen, [[deck[0]], [deck[1]]], "the second look sees the new top card");
  assert.deepEqual(deckOf(engine, P1), [...deck.slice(2), deck[0], deck[1]]);
});

// =====================================================================================================================
// Thabbashite Temple
// =====================================================================================================================

function templeBoard(over: { vol?: number; spentVol?: number; rage?: number; oppVol?: number; depleted?: boolean; deck?: Cards } = {}) {
  return buildGame({
    random: () => 0,
    cards: [
      { key: "tp", def: printing(TEMPLE), owner: P1, zone: "play", depleted: over.depleted ?? false },
      ...volition(over.vol ?? 0),
      ...volition(over.spentVol ?? 0).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("rage", over.rage ?? 0),
      ...volition(over.oppVol ?? 0, P2),
      ...(over.deck ?? templeDeck()),
      { key: "oc1", def: character({ name: "Opp Deck Char", cost: 1 }), owner: P2, zone: "deck" }
    ]
  });
}
const templeDeck = (): Cards => [
  { key: "c0", def: character({ name: "T Char 0", cost: 0 }), owner: P1, zone: "deck" },
  { key: "c2", def: character({ name: "T Char 2", cost: 2 }), owner: P1, zone: "deck" },
  { key: "c3", def: character({ name: "T Char 3", cost: 3 }), owner: P1, zone: "deck" },
  { key: "c4", def: character({ name: "T Char 4", cost: 4 }), owner: P1, zone: "deck" },
  { key: "c6", def: character({ name: "T Char 6", cost: 6 }), owner: P1, zone: "deck" },
  { key: "c11", def: character({ name: "T Char 11", cost: 11 }), owner: P1, zone: "deck" },
  { key: "i1", def: item({ name: "T Item 1", cost: 1 }), owner: P1, zone: "deck" },
  { key: "t1", def: tactic({ name: "T Tactic 1", cost: 1 }), owner: P1, zone: "deck" }
];
const call = (g: ReturnType<typeof templeBoard>, key: string) => activate(g.engine, P1, g.id("tp"), "temple-call", { selected: { found: [g.id(key)] } });

clause(TEMPLE, "0:ability:temple-call", "X is my [V] count and the cost is 10-X: with 3 face-down it pays 7, depletes the Temple, and puts a cost-3 character into play depleted", () => {
  const g = templeBoard({ vol: 3, rage: 7 });
  const { engine, id } = g;
  const deckBefore = [...deckOf(engine, P1)];
  activateRaw(engine, P1, id("tp"), "temple-call", { found: [id("c3")] });
  assert.equal(readyResources(engine, P1), 3, "COST: Pay 10-X = 7 (10 -> 3)");
  assert.equal(isDepleted(engine, id("tp")), true, "COST: deplete this card");
  assert.equal(zoneOf(engine, id("c3")), "deck", "nothing found until it resolves");
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("c3")), "play");
  assert.equal(isDepleted(engine, id("c3")), true, "put into play depleted");
  assert.equal(engine.state.cards[id("c3")].controllerId, P1);
  const remaining = deckBefore.filter((c) => c !== id("c3"));
  assert.notDeepEqual(deckOf(engine, P1), remaining, "the deck is shuffled after the search");
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...remaining].sort());
  assert.equal(zoneOf(engine, id("oc1")), "deck", "the opponent's deck is not searched");
});

clause(TEMPLE, "0:ability:temple-call", "a different X: 6 face-down means pay 4 and a cost-6 character is findable", () => {
  const g = templeBoard({ vol: 6, rage: 4 });
  call(g, "c6");
  assert.equal(readyResources(g.engine, P1), 6, "10 resources, paid 4");
  assert.equal(zoneOf(g.engine, g.id("c6")), "play");
  assert.equal(isDepleted(g.engine, g.id("c6")), true);
});

clause(TEMPLE, "0:ability:temple-call", "X = 0 pays the full 10 and only a cost-0 character can be found", () => {
  const g = templeBoard({ rage: 10 });
  refused(() => call(g, "c2"), "cost 2 with X = 0");
  assert.equal(readyResources(g.engine, P1), 10);
  call(g, "c0");
  assert.equal(readyResources(g.engine, P1), 0, "Pay 10");
  assert.equal(zoneOf(g.engine, g.id("c0")), "play");
  assert.equal(isDepleted(g.engine, g.id("c0")), true);
});

clause(TEMPLE, "0:ability:temple-call", "the found character costs X or less: exactly X and below are legal, above X, non-characters and the opponent's deck are not", () => {
  const g = templeBoard({ vol: 3, rage: 7 });
  for (const key of ["c4", "c6", "i1", "t1", "oc1"]) refused(() => call(g, key), `${key} is not a character of cost 3 or less in my deck`);
  assert.equal(readyResources(g.engine, P1), 10, "refused attempts pay nothing");
  assert.equal(isDepleted(g.engine, g.id("tp")), false);
  for (const key of ["c0", "c2", "c3"]) {
    const h = templeBoard({ vol: 3, rage: 7 });
    call(h, key);
    assert.equal(zoneOf(h.engine, h.id(key)), "play", `${key} can be found`);
  }
});

clause(TEMPLE, "0:ability:temple-call", "X counts only [V] I control: the opponent's face-down cards and my face-up staples do not count", () => {
  const g = templeBoard({ vol: 2, rage: 8, oppVol: 5 });
  refused(() => call(g, "c3"), "X is 2, not 7 or 5");
  call(g, "c2");
  assert.equal(readyResources(g.engine, P1), 2, "paid 10-2 = 8");
});

clause(TEMPLE, "0:ability:temple-call", "X counts face-down cards that are already spent", () => {
  const g = templeBoard({ vol: 2, spentVol: 1, rage: 7 });
  call(g, "c3");
  assert.equal(zoneOf(g.engine, g.id("c3")), "play", "X = 3 including the spent face-down card");
  assert.equal(readyResources(g.engine, P1), 2, "pay 7 of the 9 ready resources");
});

clause(TEMPLE, "0:ability:temple-call", "with X = 10 the cost is 0 resources", () => {
  const ten = templeBoard({ vol: 10 });
  call(ten, "c6");
  assert.equal(readyResources(ten.engine, P1), 10, "Pay 0");
  assert.equal(isDepleted(ten.engine, ten.id("tp")), true);
  assert.equal(zoneOf(ten.engine, ten.id("c6")), "play");
});

clause(TEMPLE, "0:ability:temple-call", "with X above 10 the cost is still 0 (never a negative payment)", () => {
  const eleven = templeBoard({ vol: 11 });
  call(eleven, "c11");
  assert.equal(readyResources(eleven.engine, P1), 11, "no payment and no refund");
  assert.equal(zoneOf(eleven.engine, eleven.id("c11")), "play");
});

clause(TEMPLE, "0:ability:temple-call", "needs the Temple undepleted and enough resources for 10-X", () => {
  const dep = templeBoard({ vol: 3, rage: 7, depleted: true });
  refused(() => call(dep, "c3"), "Temple is depleted");
  const poor = templeBoard({ vol: 2, rage: 5 });
  refused(() => call(poor, "c2"), "needs 8 resources, has 7");
  assert.equal(isDepleted(poor.engine, poor.id("tp")), false, "no cost was paid");
  const exact = templeBoard({ vol: 2, rage: 6 });
  call(exact, "c2");
  assert.equal(readyResources(exact.engine, P1), 0);
});

clause(TEMPLE, "0:ability:temple-call", "no character of cost X or less in the deck: the cost is still paid and nothing is put into play (CR 312.2)", () => {
  const deck: Cards = [
    { key: "c4", def: character({ name: "T Char 4", cost: 4 }), owner: P1, zone: "deck" },
    { key: "i1", def: item({ name: "T Item 1", cost: 1 }), owner: P1, zone: "deck" }
  ];
  const g = templeBoard({ vol: 3, rage: 7, deck });
  activate(g.engine, P1, g.id("tp"), "temple-call", { selected: {} });
  assert.equal(pending(g.engine), undefined);
  assert.equal(isDepleted(g.engine, g.id("tp")), true, "COST: deplete");
  assert.equal(readyResources(g.engine, P1), 3, "COST: Pay 7");
  assert.equal(zoneOf(g.engine, g.id("c4")), "deck");
});

clause(TEMPLE, "0:ability:temple-call", "a search with criteria may be failed even when a legal character exists (CR 312.2)", () => {
  const g = templeBoard({ vol: 3, rage: 7 });
  activate(g.engine, P1, g.id("tp"), "temple-call", { selected: { found: [] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(isDepleted(g.engine, g.id("tp")), true);
  assert.equal(readyResources(g.engine, P1), 3);
  for (const key of ["c0", "c2", "c3"]) assert.equal(zoneOf(g.engine, g.id(key)), "deck", `${key} not taken`);
});

function volateBoard(over: { rage?: number; extra?: Cards } = {}) {
  const rage = over.rage ?? 4;
  return buildGame({
    cards: [
      { key: "tp", def: printing(TEMPLE), owner: P1, zone: "play" },
      ...Array.from({ length: rage }, (_, i): CardPlacement => ({ key: `r${i}`, def: resourceCard({ name: `Rage Res ${i}` }), owner: P1, zone: "play" })),
      { key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "or", def: resourceCard({ name: "Opp Staple" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "My Char" }), owner: P1, zone: "play" },
      { key: "hr", def: resourceCard({ name: "Hand Staple" }), owner: P1, zone: "hand" },
      { key: "dr", def: resourceCard({ name: "Dead Staple" }), owner: P1, zone: "discard" },
      ...(over.extra ?? [])
    ]
  });
}
const volate = (g: ReturnType<typeof volateBoard>, key: string) => activate(g.engine, P1, g.id("tp"), "temple-volate", { selected: { res: [g.id(key)] } });

clause(TEMPLE, "1:ability:temple-volate", "Pay 2 (already paid while it waits); EFFECT flips the picked face-up resource face-down: it stops providing its icon and provides Volition", () => {
  const g = volateBoard();
  const { engine, id } = g;
  const before = engine.getThresholds(P1);
  activateRaw(engine, P1, id("tp"), "temple-volate", { res: [id("r0")] });
  assert.equal(readyResources(engine, P1), 3, "COST: Pay 2 (5 -> 3; the hidden card is a resource too)");
  assert.equal(engine.state.cards[id("r0")].faceDown, false, "not flipped until it resolves");
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.cards[id("r0")].faceDown, true);
  assert.equal(zoneOf(engine, id("r0")), "play");
  const after = engine.getThresholds(P1);
  assert.equal(after.rage ?? 0, (before.rage ?? 0) - 1, "one fewer Rage");
  assert.equal(after.volition ?? 0, (before.volition ?? 0) + 1, "one more Volition");
  for (const key of ["r1", "r2", "r3"]) assert.equal(engine.state.cards[id(key)].faceDown, false, `${key} stays face-up`);
  assert.equal(engine.state.cards[id("or")].faceDown, false, "the opponent's resource is untouched");
});

clause(TEMPLE, "1:ability:temple-volate", "only a face-up resource I control can be picked: not face-down, not the opponent's, not a character, not in hand or discard", () => {
  const g = volateBoard();
  const bad: Array<[string, string]> = [
    ["fd", "a face-down card"], ["or", "the opponent's resource"], ["mine", "a character"], ["hr", "a resource in hand"], ["dr", "a resource in the discard pile"], ["tp", "the Temple (a location)"]
  ];
  for (const [key, why] of bad) refused(() => volate(g, key), why);
  assert.equal(readyResources(g.engine, P1), 5, "refused attempts pay nothing");
  volate(g, "r1"); // control
  assert.equal(g.engine.state.cards[g.id("r1")].faceDown, true);
});

clause(TEMPLE, "1:ability:temple-volate", "a resource I control but do not own is flipped face-down under its OWNER's control", () => {
  const g = volateBoard({ extra: [{ key: "stolen", def: resourceCard({ name: "Borrowed Staple" }), owner: P2, zone: "play", controller: P1 }] });
  assert.equal(g.engine.state.cards[g.id("stolen")].controllerId, P1);
  volate(g, "stolen");
  assert.equal(g.engine.state.cards[g.id("stolen")].faceDown, true, "flipped face-down");
  assert.equal(g.engine.state.cards[g.id("stolen")].controllerId, P2, "and now under its owner's control");
});

clause(TEMPLE, "1:ability:temple-volate", "needs 2 resources: refused with 1, no limit per turn (two uses flip two resources and cost 4)", () => {
  const poor = volateBoard({ rage: 0 });
  // the only resources are the hidden card (1): one short of Pay 2
  assert.equal(readyResources(poor.engine, P1), 1);
  refused(() => activate(poor.engine, P1, poor.id("tp"), "temple-volate", { selected: { res: [poor.id("or")] } }), "one resource, and not even a legal pick");
  const one = buildGame({ cards: [{ key: "tp", def: printing(TEMPLE), owner: P1, zone: "play" }, { key: "r0", def: resourceCard({ name: "Only Staple" }), owner: P1, zone: "play" }] });
  refused(() => activate(one.engine, P1, one.id("tp"), "temple-volate", { selected: { res: [one.id("r0")] } }), "Pay 2 with 1 resource");
  assert.equal(one.engine.state.cards[one.id("r0")].faceDown, false);
  const g = volateBoard({ rage: 6 });
  const start = readyResources(g.engine, P1);
  activateRaw(g.engine, P1, g.id("tp"), "temple-volate", { res: [g.id("r0")] });
  assert.equal(readyResources(g.engine, P1), start - 2, "first use paid 2");
  resolvePendingResponses(g.engine);
  const mid = readyResources(g.engine, P1);
  activateRaw(g.engine, P1, g.id("tp"), "temple-volate", { res: [g.id("r1")] });
  assert.equal(readyResources(g.engine, P1), mid - 2, "second use paid 2 more");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("r0")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("r1")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("r2")].faceDown, false);
});

clause(TEMPLE, "1:ability:temple-volate", "the Temple is a 4-cost Obsession location with 6 structure", () => {
  const { engine, id } = buildGame({ cards: [{ key: "tp", def: printing(TEMPLE), owner: P1, zone: "hand" }, ...bank("obsession", 1), ...bank("rage", 3)] });
  play(engine, P1, id("tp"));
  assert.equal(zoneOf(engine, id("tp")), "play");
  assert.equal(engine.getStat(id("tp"), "structure"), 6);
  assert.equal(readyResources(engine, P1), 0);
  const short = buildGame({ cards: [{ key: "tp", def: printing(TEMPLE), owner: P1, zone: "hand" }, ...bank("obsession", 1), ...bank("rage", 2)] });
  refused(() => play(short.engine, P1, short.id("tp")), "3 resources");
  const noIcon = buildGame({ cards: [{ key: "tp", def: printing(TEMPLE), owner: P1, zone: "hand" }, ...bank("rage", 4)] });
  refused(() => play(noIcon.engine, P1, noIcon.id("tp")), "no Obsession");
});
