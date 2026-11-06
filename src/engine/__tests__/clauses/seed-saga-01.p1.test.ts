// Clause tests, batch seed-saga-01, part p1 (groups 1-6):
// A Death Fit for a King, Anathematize, Arcane Monkey Ritual, Confounding Conjurer,
// Cryptic Athenaeum (Seed Saga), Day of the Tentacle.
// Every expectation is read from the PRINTED text.

import assert from "node:assert/strict";
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
  uniqueChar,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, clauseMismatch, printing, refused } from "./_clause.js";
import { answerPending, fillers, pending, zoneOf } from "./_board.js";
import { fightThrough } from "./_battle.js";
import { endTurn, factionOf } from "./_turn.js";
import type { PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ------------------------------------------------

const FACTION_KEY: Record<string, string> = { [P1]: "__factionA", [P2]: "__factionB" };

/** `n` already-SPENT resources (attached to the owner's faction): they count toward thresholds but can't pay. */
function spent(icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] {
  return bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: FACTION_KEY[owner] }));
}

const handOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].hand];
const deckOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].deck];
const discardOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].discard];
const ready = (engine: SpoilsEngine, p: PlayerId = P1): number => engine.getAvailableResourceCount(p);

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pickTarget = (engine: SpoilsEngine, selected: string[]): void =>
  answerPending(engine, "chooserSelectsTarget", { selected });

const revealsOf = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

const uchar = (name: string) => uniqueChar({ name, unique: name.toLowerCase() });

// =========================================================================================
// A DEATH FIT FOR A KING
// =========================================================================================

const DF = "605554df-72a7-4b72-91cc-f6983165d620";

function dfBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[]; zone?: "hand" | "discard" } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "df", def: printing(DF), owner: P1, zone: o.zone ?? "hand" },
      ...(o.res ?? bank("obsession", 3)),
      ...(o.extra ?? [])
    ]
  });
}

const dfPlay = (b: ReturnType<typeof dfBoard>, victim: string[]) => play(b.engine, P1, b.id("df"), { selected: { victim: victim.map((k) => b.id(k)) } });

clause(DF, "0:extraCost", "the printed card has no subtype", () => {
  assert.deepEqual(printing(DF).subtype, [], "A Death Fit for a King prints no subtype");
});

clause(DF, "0:extraCost", "printed type / trade / cost 1 / threshold [O][O]; exact cost works (isolated with a spent icon), one short or one icon short is refused", () => {
  const d0 = dfBoard();
  const def = d0.engine.getDefinition(d0.id("df"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "arcanist", 1, "oo"]);
  const victim = { key: "u", def: uchar("Highlander"), owner: P2, zone: "play" } as CardPlacement;
  // exact: one ready icon pays the 1, a second (spent) obsession supplies the threshold's second icon
  const b = dfBoard({ res: [...bank("obsession", 1), ...spent("obsession", 1)], extra: [victim] });
  assert.equal(ready(b.engine), 1);
  dfPlay(b, ["u"]);
  assert.equal(ready(b.engine), 0, "COST: 1 resource was paid");
  assert.equal(zoneOf(b.engine, b.id("df")), "discard");
  assert.equal(zoneOf(b.engine, b.id("u")), "void");
  // one short: threshold met by spent icons, but nothing left to pay
  const s = dfBoard({ res: spent("obsession", 2), extra: [victim] });
  refused(() => dfPlay(s, ["u"]), "cost 1 with nothing ready", /Costs cannot be paid/);
  // one icon short: plenty to pay, only one [O]
  const t = dfBoard({ res: [...bank("obsession", 1), ...bank("rage", 2)], extra: [victim] });
  refused(() => dfPlay(t, ["u"]), "threshold [O][O] with one [O]", /Threshold requirements/);
  const ok = dfBoard({ res: [...bank("obsession", 2)], extra: [victim] });
  dfPlay(ok, ["u"]);
  assert.equal(zoneOf(ok.engine, ok.id("u")), "void");
});

clause(DF, "0:extraCost", "you can pick a character with UNIQUE in play (yours or theirs) or ANY character in an opponent's discard pile", () => {
  const cases: Array<{ label: string; card: CardPlacement }> = [
    { label: "opponent's UNIQUE character in play", card: { key: "x", def: uchar("Highlander"), owner: P2, zone: "play" } },
    { label: "my own UNIQUE character in play", card: { key: "x", def: uchar("Highlander"), owner: P1, zone: "play" } },
    { label: "non-UNIQUE character in the opponent's discard", card: { key: "x", def: character({ name: "Plain" }), owner: P2, zone: "discard" } },
    { label: "UNIQUE character in the opponent's discard", card: { key: "x", def: uchar("Highlander"), owner: P2, zone: "discard" } }
  ];
  for (const c of cases) {
    const b = dfBoard({ extra: [c.card] });
    dfPlay(b, ["x"]);
    assert.equal(b.engine.state.pendingChoice, undefined, c.label);
    assert.equal(zoneOf(b.engine, b.id("x")), "void", c.label);
    assert.equal(zoneOf(b.engine, b.id("df")), "discard", c.label);
  }
});

clause(DF, "0:extraCost", "everything else is refused: non-UNIQUE characters in play, my own discard, hands, decks, items, tactics, factions", () => {
  const ok: CardPlacement = { key: "ok", def: uchar("Highlander"), owner: P2, zone: "play" };
  const bad: Array<{ label: string; card?: CardPlacement; faction?: boolean }> = [
    { label: "non-UNIQUE opponent character in play", card: { key: "x", def: character({ name: "Plain" }), owner: P2, zone: "play" } },
    { label: "non-UNIQUE own character in play", card: { key: "x", def: character({ name: "Plain" }), owner: P1, zone: "play" } },
    { label: "non-UNIQUE character in MY discard", card: { key: "x", def: character({ name: "Plain" }), owner: P1, zone: "discard" } },
    { label: "UNIQUE character in the opponent's hand", card: { key: "x", def: uchar("Hidden"), owner: P2, zone: "hand" } },
    { label: "character in the opponent's deck", card: { key: "x", def: character({ name: "Plain" }), owner: P2, zone: "deck" } },
    { label: "item in the opponent's discard", card: { key: "x", def: item({ name: "Sword" }), owner: P2, zone: "discard" } },
    { label: "UNIQUE item in play", card: { key: "x", def: item({ name: "Relic", unique: "relic" }), owner: P2, zone: "play" } },
    { label: "tactic in the opponent's discard", card: { key: "x", def: tactic({ name: "Spell" }), owner: P2, zone: "discard" } },
    { label: "the opponent's faction", faction: true }
  ];
  for (const c of bad) {
    const b = dfBoard({ extra: c.card ? [ok, c.card] : [ok] });
    const target = c.faction ? factionOf(b.engine, P2) : b.id("x");
    refused(() => play(b.engine, P1, b.id("df"), { selected: { victim: [target] } }), c.label);
    assert.equal(zoneOf(b.engine, b.id("df")), "hand", `${c.label}: the tactic was not cast`);
    dfPlay(b, ["ok"]); // positive control: the same board accepts a legal pick
    assert.equal(zoneOf(b.engine, b.id("ok")), "void", c.label);
  }
});

clause(DF, "0:extraCost", "the pick is required: with no pick the tactic can't be cast", () => {
  const b = dfBoard({ extra: [{ key: "u", def: uchar("Highlander"), owner: P2, zone: "play" }] });
  refused(() => play(b.engine, P1, b.id("df"), { selected: { victim: [] } }), "no pick", /requires 1 selection/);
  refused(() => play(b.engine, P1, b.id("df"), {}), "no pick at all");
  assert.equal(ready(b.engine), 3, "nothing was paid");
  dfPlay(b, ["u"]);
  assert.equal(zoneOf(b.engine, b.id("u")), "void");
});

clause(DF, "1:rule", "the picked character goes into the VOID (not the discard pile); the tactic itself is discarded; other cards are untouched", () => {
  const b = dfBoard({
    extra: [
      { key: "u", def: uchar("Highlander"), owner: P2, zone: "play" },
      { key: "u2", def: uchar("Other Highlander"), owner: P2, zone: "play" },
      { key: "mine", def: uchar("Mine"), owner: P1, zone: "play" }
    ]
  });
  dfPlay(b, ["u"]);
  assert.equal(zoneOf(b.engine, b.id("u")), "void");
  assert.ok(!discardOf(b.engine, P2).includes(b.id("u")), "not in the discard pile");
  assert.ok(!b.engine.state.players[P2].play.includes(b.id("u")), "no longer in play");
  assert.equal(zoneOf(b.engine, b.id("u2")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("df")), "discard");
});

clause(DF, "1:rule", "a character picked from the opponent's discard pile also goes into the void; the rest of that discard pile stays", () => {
  const b = dfBoard({
    extra: [
      { key: "a", def: character({ name: "A" }), owner: P2, zone: "discard" },
      { key: "b", def: character({ name: "B" }), owner: P2, zone: "discard" }
    ]
  });
  dfPlay(b, ["a"]);
  assert.equal(zoneOf(b.engine, b.id("a")), "void");
  assert.equal(zoneOf(b.engine, b.id("b")), "discard");
  assert.deepEqual(discardOf(b.engine, P2), [b.id("b")]);
});

// --- RECUR ---

function recurBoard(o: { res?: CardPlacement[]; zone?: "hand" | "discard"; noUnique?: boolean } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "df", def: printing(DF), owner: P1, zone: o.zone ?? "discard" },
      ...(o.res ?? bank("obsession", 3)),
      { key: "n1", def: character({ name: "Plain One" }), owner: P1, zone: "deck" },
      { key: "u1", def: o.noUnique ? character({ name: "Alpha" }) : uchar("Alpha"), owner: P1, zone: "deck" },
      { key: "i1", def: item({ name: "Relic", unique: "relic" }), owner: P1, zone: "deck" },
      { key: "u2", def: o.noUnique ? character({ name: "Beta" }) : uchar("Beta"), owner: P1, zone: "deck" },
      { key: "n2", def: character({ name: "Plain Two" }), owner: P1, zone: "deck" },
      { key: "ou", def: uchar("Gamma"), owner: P2, zone: "deck" },
      { key: "hu", def: uchar("Delta"), owner: P1, zone: "hand" },
      { key: "h0", def: character({ name: "H0" }), owner: P1, zone: "hand" }
    ]
  });
}

clause(DF, "2:ability:recur", "RECUR can only be used from the discard pile", () => {
  const h = recurBoard({ zone: "hand" });
  refused(() => activate(h.engine, P1, h.id("df"), "recur", {}), "in hand", /zone 'discard'/);
  const d = recurBoard();
  activate(d.engine, P1, d.id("df"), "recur", {});
  assert.equal(pending(d.engine)?.kind, "chooserSelectsTarget", "positive control: usable from the discard pile");
});

clause(DF, "2:ability:recur", "COST: pay exactly 3 and remove this card from the game; threshold [O][O]", () => {
  const b = recurBoard({ res: bank("obsession", 5) });
  assert.equal(ready(b.engine), 5);
  activate(b.engine, P1, b.id("df"), "recur", {});
  assert.equal(zoneOf(b.engine, b.id("df")), "removed", "removed from the game");
  assert.equal(ready(b.engine), 2, "exactly 3 paid");
  pickTarget(b.engine, []);
  // one short: threshold met (3 [O]) but only 2 ready
  const s = recurBoard({ res: [...bank("obsession", 2), ...spent("obsession", 1)] });
  refused(() => activate(s.engine, P1, s.id("df"), "recur", {}), "pay 3 with 2 ready", /costs cannot be paid/i);
  assert.equal(zoneOf(s.engine, s.id("df")), "discard");
  // one icon short: 3 ready, only one [O]
  const t = recurBoard({ res: [...bank("obsession", 1), ...bank("rage", 2)] });
  refused(() => activate(t.engine, P1, t.id("df"), "recur", {}), "threshold with one [O]", /threshold requirements/i);
  // exactly two [O] and one more icon works
  const e = recurBoard({ res: [...bank("obsession", 2), ...bank("rage", 1)] });
  activate(e.engine, P1, e.id("df"), "recur", {});
  assert.equal(ready(e.engine), 0);
});

clause(DF, "2:ability:recur", "EFFECT: search your deck for a UNIQUE character and reveal it, put it into your hand; only UNIQUE characters of YOUR deck are offered", () => {
  for (const pick of ["u1", "u2"]) {
    const b = recurBoard();
    activate(b.engine, P1, b.id("df"), "recur", {});
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc?.playerId, P1, "you choose");
    for (const bad of ["n1", "n2", "i1", "ou", "hu", "h0"]) {
      refused(() => pickTarget(b.engine, [b.id(bad)]), `${bad} is not a legal find`);
    }
    refused(() => pickTarget(b.engine, [b.id("u1"), b.id("u2")]), "only one card is found");
    const before = deckOf(b.engine, P1);
    pickTarget(b.engine, [b.id(pick)]);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id(pick)), "hand", `${pick} is in hand`);
    assert.equal(handOf(b.engine, P1).length, 3, "hand: hu, h0 and the found card");
    const other = pick === "u1" ? "u2" : "u1";
    assert.equal(zoneOf(b.engine, b.id(other)), "deck", "the other UNIQUE character stays");
    assert.equal(zoneOf(b.engine, b.id("ou")), "deck");
    assert.equal(zoneOf(b.engine, b.id("i1")), "deck");
    assert.equal(deckOf(b.engine, P1).length, before.length - 1);
    const reveals = revealsOf(b.engine);
    assert.equal(reveals.length, 1, "revealed once");
    assert.deepEqual((reveals[0].event as unknown as { cardIds: string[] }).cardIds, [b.id(pick)], "the found card is revealed");
  }
});

clause(DF, "2:ability:recur", "searching shuffles the deck afterwards (CR 312.1): the same remaining cards in a shuffled order", () => {
  const b = recurBoard();
  const remaining = deckOf(b.engine, P1).filter((c) => c !== b.id("u1"));
  activate(b.engine, P1, b.id("df"), "recur", {});
  pickTarget(b.engine, [b.id("u1")]);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...remaining].sort());
  assert.deepEqual(deckOf(b.engine, P1), shuffledWithConstant(remaining, 0), "shuffled");
});

clause(DF, "2:ability:recur", "you may fail the search: nothing enters your hand, but the cost stays paid and the deck is shuffled (CR 312.2)", () => {
  const b = recurBoard();
  const before = deckOf(b.engine, P1);
  const handBefore = handOf(b.engine, P1);
  activate(b.engine, P1, b.id("df"), "recur", {});
  pickTarget(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b.engine, P1), handBefore);
  assert.equal(zoneOf(b.engine, b.id("df")), "removed");
  assert.equal(ready(b.engine), 0);
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(b.engine, P1), before, "the deck was shuffled");
  assert.equal(revealsOf(b.engine).length, 0, "nothing to reveal");
});

clause(DF, "2:ability:recur", "with no UNIQUE character in the deck the ability can still be used (cost paid, nothing found, deck shuffled)", () => {
  const b = recurBoard({ noUnique: true });
  const before = deckOf(b.engine, P1);
  activate(b.engine, P1, b.id("df"), "recur", {});
  if (pending(b.engine)) pickTarget(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("df")), "removed");
  assert.equal(ready(b.engine), 0);
  assert.equal(handOf(b.engine, P1).length, 2, "nothing was found");
  assert.deepEqual([...deckOf(b.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(b.engine, P1), before, "searched decks are shuffled even when nothing is found");
});

// =========================================================================================
// ANATHEMATIZE
// =========================================================================================

const AN = "4650f2a3-3cbb-4de5-9fa9-cc38722ea3d6";

function anBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "an", def: printing(AN), owner: P1, zone: "hand" },
      ...(o.res ?? [...bank("obsession", 1), ...bank("rage", 4)]),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...fillers("oh", 2, P2, "hand"),
      ...(o.extra ?? [])
    ]
  });
}
const anPlay = (b: ReturnType<typeof anBoard>, key: string) => play(b.engine, P1, b.id("an"), { selected: { c: [b.id(key)] } });
const target6 = (owner: PlayerId = P2): CardPlacement => ({ key: "t", def: character({ name: "Target", strength: 6, life: 4, speed: 2 }), owner, zone: "play" });

clause(AN, "0:extraCost", "the printed card has no subtype", () => {
  assert.deepEqual(printing(AN).subtype, [], "Anathematize prints no subtype");
});

clause(AN, "0:extraCost", "printed type / trade / cost 4 / threshold [O]; exact cost works, one short or no [O] is refused", () => {
  const b0 = anBoard({ extra: [target6()] });
  const def = b0.engine.getDefinition(b0.id("an"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "arcanist", 4, "o"]);
  const exact = anBoard({ res: [...bank("obsession", 1), ...bank("rage", 3)], extra: [target6()] });
  anPlay(exact, "t");
  assert.equal(ready(exact.engine), 0, "COST: 4 paid");
  assert.equal(zoneOf(exact.engine, exact.id("an")), "discard");
  const short = anBoard({ res: [...bank("obsession", 1), ...bank("rage", 2)], extra: [target6()] });
  refused(() => anPlay(short, "t"), "cost 4 with 3 ready", /Costs cannot be paid/);
  const thr = anBoard({ res: bank("rage", 4), extra: [target6()] });
  refused(() => anPlay(thr, "t"), "no [O]", /Threshold requirements/);
});

clause(AN, "0:extraCost", "you pick a character in play: yours or theirs; items, factions, and characters in other zones are refused; the pick is required", () => {
  for (const owner of [P1, P2]) {
    const b = anBoard({ extra: [target6(owner)] });
    anPlay(b, "t");
    assert.equal(b.engine.getStat(b.id("t"), "strength"), 1, `${owner}'s character`);
  }
  const bad: Array<{ label: string; card?: CardPlacement; faction?: boolean }> = [
    { label: "item in play", card: { key: "x", def: item({ name: "Sword" }), owner: P2, zone: "play" } },
    { label: "character in the opponent's hand", card: { key: "x", def: character({ name: "Plain" }), owner: P2, zone: "hand" } },
    { label: "character in the opponent's discard", card: { key: "x", def: character({ name: "Plain" }), owner: P2, zone: "discard" } },
    { label: "the opponent's faction", faction: true }
  ];
  for (const c of bad) {
    const b = anBoard({ extra: c.card ? [target6(), c.card] : [target6()] });
    const target = c.faction ? factionOf(b.engine, P2) : b.id("x");
    refused(() => play(b.engine, P1, b.id("an"), { selected: { c: [target] } }), c.label);
    assert.equal(zoneOf(b.engine, b.id("an")), "hand", c.label);
    anPlay(b, "t");
    assert.equal(b.engine.getStat(b.id("t"), "strength"), 1, c.label);
  }
  const n = anBoard({ extra: [target6()] });
  refused(() => play(n.engine, P1, n.id("an"), { selected: { c: [] } }), "no pick", /requires 1 selection/);
  assert.equal(ready(n.engine), 5, "nothing paid");
});

clause(AN, "1:rule", "the character loses exactly 5 strength (6 becomes 1); life and speed are untouched; other characters are not affected", () => {
  const b = anBoard({
    extra: [target6(), { key: "o", def: character({ name: "Bystander", strength: 6, life: 4, speed: 2 }), owner: P2, zone: "play" }, { key: "m", def: character({ name: "Mine", strength: 6, life: 4, speed: 2 }), owner: P1, zone: "play" }]
  });
  anPlay(b, "t");
  assert.equal(b.engine.getStat(b.id("t"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("t"), "life"), 4);
  assert.equal(b.engine.getStat(b.id("t"), "speed"), 2);
  assert.equal(b.engine.getStat(b.id("o"), "strength"), 6);
  assert.equal(b.engine.getStat(b.id("m"), "strength"), 6);
  assert.equal(zoneOf(b.engine, b.id("t")), "play");
});

clause(AN, "1:rule", "strength never goes below 0 (a 3-strength character reads 0, not -2)", () => {
  const b = anBoard({ extra: [{ key: "t", def: character({ name: "Weak", strength: 3, life: 4 }), owner: P2, zone: "play" }] });
  anPlay(b, "t");
  assert.equal(b.engine.getStat(b.id("t"), "strength"), 0);
  assert.equal(zoneOf(b.engine, b.id("t")), "play", "0 strength doesn't remove it");
});

clause(AN, "1:rule", "'this turn' is the whole turn, not just the battle: after a battle ends the character still has 5 less strength until the turn is over", () => {
  const b = anBoard({ extra: [target6(), { key: "att", def: character({ name: "Attacker", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" }] });
  anPlay(b, "t");
  fightThrough(b.engine, P1, [b.id("att")], { type: "faction", playerId: P2 }, []);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.equal(b.engine.getStat(b.id("t"), "strength"), 1, "still reduced after the battle, later in the same turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("t"), "strength"), 6, "back to printed once the turn ended");
});

clause(AN, "1:rule", "the loss lasts THIS turn only: it is gone once the turn ends", () => {
  const b = anBoard({ extra: [target6()] });
  anPlay(b, "t");
  assert.equal(b.engine.getStat(b.id("t"), "strength"), 1, "still reduced later in the same turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.getStat(b.id("t"), "strength"), 6, "back to printed once the turn ended");
});

clause(AN, "1:rule", "you draw a card: exactly one, the top of YOUR deck; the opponent draws nothing", () => {
  const b = anBoard({ extra: [target6()] });
  const deck = deckOf(b.engine, P1);
  const oppHand = handOf(b.engine, P2);
  const oppDeck = deckOf(b.engine, P2);
  anPlay(b, "t");
  assert.deepEqual(handOf(b.engine, P1), [deck[0]], "drew the top card only");
  assert.deepEqual(deckOf(b.engine, P1), deck.slice(1));
  assert.deepEqual(handOf(b.engine, P2), oppHand);
  assert.deepEqual(deckOf(b.engine, P2), oppDeck);
});

// =========================================================================================
// ARCANE MONKEY RITUAL
// =========================================================================================

const ARM = "0f2882a3-7f34-43ff-9547-0c05b40c365d";

function armBoard(o: { res?: CardPlacement[]; zone?: "hand" | "discard"; tactics?: number; oppHand?: number } = {}) {
  const tactics = Array.from({ length: o.tactics ?? 3 }, (_, i) => ({ key: `t${i + 1}`, def: tactic({ name: `Tac ${i + 1}` }), owner: P1, zone: "deck" as const }));
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "arm", def: printing(ARM), owner: P1, zone: o.zone ?? "hand" },
      ...(o.res ?? bank("obsession", 4)),
      ...tactics,
      { key: "c1", def: character({ name: "Char" }), owner: P1, zone: "deck" },
      { key: "i1", def: item({ name: "Gizmo" }), owner: P1, zone: "deck" },
      { key: "ot", def: tactic({ name: "Opp Tac" }), owner: P2, zone: "deck" },
      { key: "th", def: tactic({ name: "Hand Tac" }), owner: P1, zone: "hand" },
      { key: "td", def: tactic({ name: "Discard Tac" }), owner: P1, zone: "discard" },
      ...fillers("mh", 2, P1, "hand"),
      ...fillers("oh", o.oppHand ?? 3, P2, "hand")
    ]
  });
}
const armPlay = (b: ReturnType<typeof armBoard>, picks: string[]) => {
  play(b.engine, P1, b.id("arm"), {});
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1, "I choose which tactics to find in my own deck");
  pickTarget(b.engine, picks.map((k) => b.id(k)));
};

clause(ARM, "0:rule", "the printed card has no subtype", () => {
  assert.deepEqual(printing(ARM).subtype, [], "Arcane Monkey Ritual prints no subtype");
});

clause(ARM, "0:rule", "printed type / trade / cost 1 / threshold [O]; exact cost works (isolated with a spent [O]), one short or no [O] is refused", () => {
  const a0 = armBoard();
  const def = a0.engine.getDefinition(a0.id("arm"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "arcanist", 1, "o"]);
  const exact = armBoard({ res: [...bank("rage", 1), ...spent("obsession", 1)] });
  assert.equal(ready(exact.engine), 1);
  armPlay(exact, ["t1"]);
  assert.equal(ready(exact.engine), 0, "COST: 1 paid");
  assert.equal(zoneOf(exact.engine, exact.id("arm")), "discard");
  const short = armBoard({ res: spent("obsession", 1) });
  refused(() => play(short.engine, P1, short.id("arm"), {}), "cost 1 with nothing ready", /Costs cannot be paid/);
  const thr = armBoard({ res: bank("rage", 2) });
  refused(() => play(thr.engine, P1, thr.id("arm"), {}), "no [O]", /Threshold requirements/);
});

clause(ARM, "0:rule", "search your deck for UP TO 2 tactics and put them into your discard pile: two, one or none", () => {
  const two = armBoard();
  armPlay(two, ["t1", "t2"]);
  assert.equal(two.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(two.engine, two.id("t1")), "discard");
  assert.equal(zoneOf(two.engine, two.id("t2")), "discard");
  assert.equal(zoneOf(two.engine, two.id("t3")), "deck", "only two");
  assert.equal(zoneOf(two.engine, two.id("c1")), "deck");
  assert.equal(zoneOf(two.engine, two.id("i1")), "deck");
  assert.ok(discardOf(two.engine, P1).includes(two.id("t1")) && discardOf(two.engine, P1).includes(two.id("t2")), "in MY discard pile");
  assert.equal(handOf(two.engine, P1).length, 3, "nothing went to hand (th, mh0, mh1 remain)");
  const one = armBoard();
  armPlay(one, ["t3"]);
  assert.equal(zoneOf(one.engine, one.id("t3")), "discard");
  assert.equal(zoneOf(one.engine, one.id("t1")), "deck");
  assert.equal(zoneOf(one.engine, one.id("t2")), "deck");
  const none = armBoard();
  armPlay(none, []);
  assert.equal(none.engine.state.pendingChoice, undefined);
  for (const t of ["t1", "t2", "t3"]) assert.equal(zoneOf(none.engine, none.id(t)), "deck");
  assert.equal(zoneOf(none.engine, none.id("arm")), "discard");
});

clause(ARM, "0:rule", "a third tactic can't be taken, and only TACTICS of YOUR deck are legal finds", () => {
  const b = armBoard();
  play(b.engine, P1, b.id("arm"), {});
  refused(() => pickTarget(b.engine, ["t1", "t2", "t3"].map((k) => b.id(k))), "three tactics");
  for (const bad of ["c1", "i1", "ot", "th", "td"]) {
    refused(() => pickTarget(b.engine, [b.id(bad)]), `${bad} is not a tactic of my deck`);
    refused(() => pickTarget(b.engine, [b.id("t1"), b.id(bad)]), `${bad} alongside a tactic`);
  }
  pickTarget(b.engine, [b.id("t1"), b.id("t2")]);
  assert.equal(zoneOf(b.engine, b.id("t1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("t2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ot")), "deck");
});

clause(ARM, "0:rule", "searching shuffles the deck afterwards (CR 312.1), also when nothing is taken (CR 312.2)", () => {
  const a = armBoard();
  const remaining = deckOf(a.engine, P1).filter((c) => c !== a.id("t1") && c !== a.id("t2"));
  armPlay(a, ["t1", "t2"]);
  assert.deepEqual(deckOf(a.engine, P1), shuffledWithConstant(remaining, 0));
  const n = armBoard();
  const before = deckOf(n.engine, P1);
  armPlay(n, []);
  assert.deepEqual([...deckOf(n.engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(n.engine, P1), before, "shuffled even though nothing was taken");
});

clause(ARM, "0:rule", "with only one tactic in the deck you take it; with none the card still resolves and the deck is shuffled", () => {
  const one = armBoard({ tactics: 1 });
  armPlay(one, ["t1"]);
  assert.equal(zoneOf(one.engine, one.id("t1")), "discard");
  const zero = armBoard({ tactics: 0 });
  const before = deckOf(zero.engine, P1);
  play(zero.engine, P1, zero.id("arm"), {});
  if (pending(zero.engine)) pickTarget(zero.engine, []);
  assert.equal(zero.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(zero.engine, zero.id("arm")), "discard");
  assert.notDeepEqual(deckOf(zero.engine, P1), before, "searched decks are shuffled even with no tactic to find");
});

// --- RECUR ---

clause(ARM, "1:ability:recur", "RECUR can only be used from the discard pile", () => {
  const h = armBoard();
  refused(() => activate(h.engine, P1, h.id("arm"), "recur", { selected: { player: [factionOf(h.engine, P2)] } }), "in hand", /zone 'discard'/);
  const d = armBoard({ zone: "discard" });
  activate(d.engine, P1, d.id("arm"), "recur", { selected: { player: [factionOf(d.engine, P2)] } });
  assert.equal(zoneOf(d.engine, d.id("arm")), "removed", "positive control: usable from the discard pile");
});

clause(ARM, "1:ability:recur", "COST: pay exactly 4 and remove this card from the game; threshold [O][O][O][O]", () => {
  const b = armBoard({ zone: "discard", res: bank("obsession", 6) });
  activate(b.engine, P1, b.id("arm"), "recur", { selected: { player: [factionOf(b.engine, P2)] } });
  assert.equal(ready(b.engine), 2, "exactly 4 paid");
  assert.equal(zoneOf(b.engine, b.id("arm")), "removed");
  const s = armBoard({ zone: "discard", res: [...bank("obsession", 3), ...spent("obsession", 1)] });
  refused(() => activate(s.engine, P1, s.id("arm"), "recur", { selected: { player: [factionOf(s.engine, P2)] } }), "pay 4 with 3 ready", /costs cannot be paid/i);
  assert.equal(zoneOf(s.engine, s.id("arm")), "discard");
  const t = armBoard({ zone: "discard", res: [...bank("obsession", 3), ...bank("rage", 1)] });
  refused(() => activate(t.engine, P1, t.id("arm"), "recur", { selected: { player: [factionOf(t.engine, P2)] } }), "threshold with three [O]", /threshold requirements/i);
  const e = armBoard({ zone: "discard", res: bank("obsession", 4) });
  activate(e.engine, P1, e.id("arm"), "recur", { selected: { player: [factionOf(e.engine, P2)] } });
  assert.equal(ready(e.engine), 0);
});

function discardPrompt(b: ReturnType<typeof armBoard>, who: PlayerId) {
  activate(b.engine, P1, b.id("arm"), "recur", { selected: { player: [factionOf(b.engine, who)] } });
}

clause(ARM, "1:ability:recur", "EFFECT: the picked opponent discards 2 cards of THEIR choice (exactly two, from their hand); my hand is untouched", () => {
  const b = armBoard({ zone: "discard" });
  const myHand = handOf(b.engine, P1);
  discardPrompt(b, P2);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the discarding player chooses the cards");
  refused(() => pickTarget(b.engine, [b.id("oh0")]), "only one card");
  refused(() => pickTarget(b.engine, ["oh0", "oh1", "oh2"].map((k) => b.id(k))), "three cards");
  refused(() => pickTarget(b.engine, [b.id("th"), b.id("oh0")]), "a card of my hand");
  pickTarget(b.engine, [b.id("oh0"), b.id("oh2")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("oh0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("oh2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("oh1")), "hand", "the third stays");
  assert.deepEqual(handOf(b.engine, P1), myHand);
  assert.deepEqual(discardOf(b.engine, P2).sort(), [b.id("oh0"), b.id("oh2")].sort());
});

clause(ARM, "1:ability:recur", "'Pick a player' can pick YOURSELF: you discard 2 cards of your choice and the opponent discards nothing", () => {
  const b = armBoard({ zone: "discard" });
  const oppHand = handOf(b.engine, P2);
  discardPrompt(b, P1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I am the player picked, so I choose what I discard");
  pickTarget(b.engine, [b.id("mh0"), b.id("mh1")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("mh0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mh1")), "discard");
  assert.deepEqual(handOf(b.engine, P2), oppHand, "the opponent discards nothing");
});

clause(ARM, "1:ability:recur", "with fewer than 2 cards in hand the player discards what they have (1 card: that card; none: nothing) and nothing locks", () => {
  const one = armBoard({ zone: "discard", oppHand: 1 });
  discardPrompt(one, P2);
  if (pending(one.engine)) pickTarget(one.engine, [one.id("oh0")]);
  assert.equal(one.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(one.engine, one.id("oh0")), "discard");
  const zero = armBoard({ zone: "discard", oppHand: 0 });
  discardPrompt(zero, P2);
  if (pending(zero.engine)) pickTarget(zero.engine, []);
  assert.equal(zero.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(zero.engine, zero.id("arm")), "removed", "the ability still resolved");
});

// =========================================================================================
// CONFOUNDING CONJURER
// =========================================================================================

const CC = "d36cacfb-e77a-4a5c-910a-43d4e40312cc";

function ccBoard(o: { res?: CardPlacement[]; extra?: CardPlacement[] } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cc", def: printing(CC), owner: P1, zone: "hand" },
      ...(o.res ?? [...bank("obsession", 2), ...bank("rage", 3)]),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
const ccPlay = (b: ReturnType<typeof ccBoard>, pick?: string) =>
  play(b.engine, P1, b.id("cc"), { selected: { c: pick ? [b.id(pick)] : [] } });

clause(CC, "0:extraCost", "printed character / arcanist wizard / cost 4 / [O][O] / 1 strength 2 speed 3 life; exact cost works, one short or one icon short is refused", () => {
  const b0 = ccBoard();
  const def = b0.engine.getDefinition(b0.id("cc"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold, def.subtype], ["character", "arcanist", 4, "oo", ["wizard"]]);
  const exact = ccBoard({ res: [...bank("obsession", 2), ...bank("rage", 2)] });
  ccPlay(exact);
  assert.equal(zoneOf(exact.engine, exact.id("cc")), "play");
  assert.equal(ready(exact.engine), 0, "COST: 4 paid");
  assert.equal(exact.engine.getStat(exact.id("cc"), "strength"), 1);
  assert.equal(exact.engine.getStat(exact.id("cc"), "speed"), 2);
  assert.equal(exact.engine.getStat(exact.id("cc"), "life"), 3);
  const short = ccBoard({ res: [...bank("obsession", 2), ...bank("rage", 1)] });
  refused(() => ccPlay(short), "cost 4 with 3 ready", /Costs cannot be paid/);
  const thr = ccBoard({ res: [...bank("obsession", 1), ...bank("rage", 3)] });
  refused(() => ccPlay(thr), "threshold with one [O]", /threshold requirements/i);
});

clause(CC, "0:extraCost", "you MAY pick a character in play (any controller); items, factions and cards in other zones are refused", () => {
  for (const pick of ["mine", "theirs", "stolen"]) {
    const b = ccBoard();
    ccPlay(b, pick);
    assert.equal(b.engine.state.pendingChoice, undefined, pick);
    assert.equal(zoneOf(b.engine, b.id("cc")), "play", pick);
    assert.equal(zoneOf(b.engine, b.id(pick)), "hand", `${pick} was returned`);
  }
  const none = ccBoard();
  ccPlay(none);
  assert.equal(zoneOf(none.engine, none.id("cc")), "play", "the pick is optional");
  const two = ccBoard();
  refused(() => play(two.engine, P1, two.id("cc"), { selected: { c: [two.id("mine"), two.id("theirs")] } }), "a character, not two");
  assert.equal(zoneOf(two.engine, two.id("cc")), "hand");
  const bad: Array<{ label: string; card?: CardPlacement; faction?: boolean }> = [
    { label: "item in play", card: { key: "x", def: item({ name: "Sword" }), owner: P2, zone: "play" } },
    { label: "character in the opponent's hand", card: { key: "x", def: character({ name: "Plain" }), owner: P2, zone: "hand" } },
    { label: "character in my discard", card: { key: "x", def: character({ name: "Plain" }), owner: P1, zone: "discard" } },
    { label: "the opponent's faction", faction: true }
  ];
  for (const c of bad) {
    const b = ccBoard({ extra: c.card ? [c.card] : [] });
    const target = c.faction ? factionOf(b.engine, P2) : b.id("x");
    refused(() => play(b.engine, P1, b.id("cc"), { selected: { c: [target] } }), c.label);
    assert.equal(zoneOf(b.engine, b.id("cc")), "hand", c.label);
    ccPlay(b, "theirs");
    assert.equal(zoneOf(b.engine, b.id("theirs")), "hand", c.label);
  }
});

clause(CC, "1:rule", "when this enters play and you picked a character: it goes into its OWNER's hand (the Conjurer stays, nothing else moves)", () => {
  const mine = ccBoard();
  ccPlay(mine, "mine");
  assert.ok(handOf(mine.engine, P1).includes(mine.id("mine")), "handOf(mine.engine, P1).includes(mine.id(\"mine\"))");
  assert.equal(zoneOf(mine.engine, mine.id("cc")), "play");
  assert.equal(zoneOf(mine.engine, mine.id("theirs")), "play");
  assert.equal(zoneOf(mine.engine, mine.id("stolen")), "play");
  const theirs = ccBoard();
  ccPlay(theirs, "theirs");
  assert.ok(handOf(theirs.engine, P2).includes(theirs.id("theirs")), "the opponent's hand");
  assert.ok(!handOf(theirs.engine, P1).includes(theirs.id("theirs")), "!handOf(theirs.engine, P1).includes(theirs.id(\"theirs\"))");
  assert.equal(zoneOf(theirs.engine, theirs.id("mine")), "play");
  const stolen = ccBoard();
  ccPlay(stolen, "stolen");
  assert.ok(handOf(stolen.engine, P2).includes(stolen.id("stolen")), "owner's hand, not the controller's");
  assert.ok(!handOf(stolen.engine, P1).includes(stolen.id("stolen")), "!handOf(stolen.engine, P1).includes(stolen.id(\"stolen\"))");
});

clause(CC, "1:rule", "if you picked nothing, no character is returned", () => {
  const b = ccBoard();
  ccPlay(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["mine", "theirs", "stolen"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", k);
  assert.equal(handOf(b.engine, P2).length, 0);
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(CC, "1:rule", "it only triggers for THIS card entering: another character (or another Conjurer) entering later does not return anything extra", () => {
  const b = ccBoard({
    res: [...bank("obsession", 2), ...bank("rage", 6)],
    extra: [
      { key: "cc2", def: printing(CC), owner: P1, zone: "hand" },
      { key: "vanilla", def: character({ name: "Vanilla" }), owner: P1, zone: "hand" }
    ]
  });
  ccPlay(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "hand");
  play(b.engine, P1, b.id("vanilla"), {});
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("vanilla")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play", "nothing else returned");
  play(b.engine, P1, b.id("cc2"), { selected: { c: [b.id("stolen")] } });
  assert.equal(zoneOf(b.engine, b.id("stolen")), "hand");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play", "the first Conjurer does not trigger again");
  assert.equal(zoneOf(b.engine, b.id("vanilla")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

// =========================================================================================
// CRYPTIC ATHENAEUM
// =========================================================================================

const CA = "746d863d-9b90-4cca-8896-a111523d4f7a";

/** P2's turn is active; `endTurn(P2)` starts P1's turn, when the Athenaeum's rules trigger. */
function caBoard(o: { obs?: number; rage?: number; extra?: CardPlacement[]; oppHand?: number; active?: PlayerId; caZone?: "play" | "discard" } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P2,
    cards: [
      { key: "ca", def: printing(CA), owner: P1, zone: o.caZone ?? "play" },
      ...bank("obsession", o.obs ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...fillers("h", 2, P1, "hand"),
      ...fillers("d", 4, P1, "deck"),
      ...fillers("oh", o.oppHand ?? 3, P2, "hand"),
      ...fillers("od", 4, P2, "deck"),
      { key: "mc", def: character({ name: "My Char" }), owner: P1, zone: "play" },
      { key: "oc", def: character({ name: "Their Char" }), owner: P2, zone: "play" },
      { key: "sc", def: character({ name: "Stolen Char" }), owner: P2, controller: P1, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

type Pc = NonNullable<ReturnType<typeof pending>>;

/** Plays out P1's turn-start prompts; `answerFor` may return a choice, or undefined for "decline". */
function turnStart(b: ReturnType<typeof caBoard>, answerFor: (pc: Pc) => Record<string, unknown> | undefined = () => undefined): Pc[] {
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "P1's turn has started");
  const seen: Pc[] = [];
  for (let i = 0; i < 12; i++) {
    const pc = pending(b.engine);
    if (!pc) return seen;
    seen.push({ ...pc } as Pc);
    let choice = answerFor(pc);
    if (!choice) {
      choice =
        pc.kind === "chooserSelectsOption"
          ? { kind: "chooserSelectsOption", index: 0 }
          : pc.kind === "chooserSelectsTarget"
            ? { kind: "chooserSelectsTarget", selected: [] }
            : pc.kind === "orderTriggers"
              ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] }
              : { kind: pc.kind };
    }
    b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(b.engine);
  }
  throw new Error("turn start prompts did not finish");
}

/** Answers prompts (decline options, trigger order, empty picks) until `stop` is true for the open one. */
function settleUntil(engine: SpoilsEngine, stop: (pc: Pc) => boolean): void {
  for (let i = 0; i < 12; i++) {
    const pc = pending(engine);
    if (!pc || stop(pc)) return;
    const choice =
      pc.kind === "chooserSelectsOption"
        ? { kind: pc.kind, index: 0 }
        : pc.kind === "chooserSelectsTarget"
          ? { kind: pc.kind, selected: [] }
          : pc.kind === "orderTriggers"
            ? { kind: pc.kind, next: (pc.triggers as unknown[])[0] }
            : { kind: pc.kind };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  throw new Error("prompts did not settle");
}

const asDraw = (): Record<string, unknown> => ({ kind: "chooserSelectsOption", index: 1 });

clause(CA, "0:unique", "the printed card has no subtype", () => {
  assert.deepEqual(printing(CA).subtype, [], "Cryptic Athenaeum prints no subtype");
});

clause(CA, "0:unique", "printed location / arcanist / cost 3 / [O] / structure 5; exact cost works, one short or no [O] is refused", () => {
  const mk = (res: CardPlacement[]) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "ca", def: printing(CA), owner: P1, zone: "hand" }, ...res]
    });
  const e = mk([...bank("obsession", 1), ...bank("rage", 2)]);
  const def = e.engine.getDefinition(e.id("ca"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold, def.structure], ["location", "arcanist", 3, "o", 5]);
  play(e.engine, P1, e.id("ca"), {});
  assert.equal(zoneOf(e.engine, e.id("ca")), "play");
  assert.equal(ready(e.engine), 0, "COST: 3 paid");
  assert.equal(e.engine.getStat(e.id("ca"), "structure"), 5);
  const s = mk([...bank("obsession", 1), ...bank("rage", 1)]);
  refused(() => play(s.engine, P1, s.id("ca"), {}), "cost 3 with 2 ready", /Costs cannot be paid/);
  const t = mk(bank("rage", 3));
  refused(() => play(t.engine, P1, t.id("ca"), {}), "no [O]", /Threshold requirements/);
});

function twoCa(second: "hand" | "oppPlay") {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: (
      [
        { key: "ca", def: printing(CA), owner: P1, zone: "play" },
        { key: "ca2", def: printing(CA), owner: P1, zone: "hand" },
        { key: "oppCa", def: printing(CA), owner: P2, zone: "play" },
        ...bank("obsession", 3, P1)
      ] as CardPlacement[]
    ).filter((c) => (second === "oppPlay" ? c.key !== "ca2" : c.key !== "oppCa"))
  });
}

clause(CA, "0:unique", "UNIQUE: deploying a second copy makes you choose which to keep (keep the new one: the old is destroyed)", () => {
  const b = twoCa("hand");
  assert.equal(b.engine.getDefinition(b.id("ca")).unique, "cryptic athenaeum");
  play(b.engine, P1, b.id("ca2"), {});
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [b.id("ca"), b.id("ca2")].sort());
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id("ca2") });
  assert.equal(zoneOf(b.engine, b.id("ca2")), "play");
  assert.equal(zoneOf(b.engine, b.id("ca")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CA, "0:unique", "UNIQUE: keeping the old copy destroys the new one", () => {
  const b = twoCa("hand");
  play(b.engine, P1, b.id("ca2"), {});
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id("ca") });
  assert.equal(zoneOf(b.engine, b.id("ca")), "play");
  assert.equal(zoneOf(b.engine, b.id("ca2")), "discard");
});

clause(CA, "0:unique", "UNIQUE only concerns your own cards: the opponent's copy neither blocks nor is destroyed", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: [
      { key: "oppCa", def: printing(CA), owner: P2, zone: "play" },
      { key: "ca2", def: printing(CA), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1)
    ]
  });
  play(b.engine, P1, b.id("ca2"), {});
  assert.equal(b.engine.state.pendingChoice, undefined, "no UNIQUE prompt");
  assert.equal(zoneOf(b.engine, b.id("ca2")), "play");
  assert.equal(zoneOf(b.engine, b.id("oppCa")), "play");
});

clause(CA, "1:rule@ooo", "with [O][O][O], at the start of your turn you MAY draw a card; if you do the opponent MAY also draw a card (both draw)", () => {
  const b = caBoard({ obs: 3 });
  const myDeck = deckOf(b.engine, P1);
  const oppDeck = deckOf(b.engine, P2);
  const seen = turnStart(b, asDraw);
  assert.deepEqual(seen.map((pc) => [pc.kind, pc.playerId]), [["chooserSelectsOption", P1], ["chooserSelectsOption", P2]], "you are asked first, then the opponent");
  assert.deepEqual(handOf(b.engine, P1).slice(-1), [myDeck[0]], "I drew the top card");
  assert.equal(handOf(b.engine, P1).length, 3);
  assert.deepEqual(handOf(b.engine, P2).slice(-1), [oppDeck[0]], "the opponent drew their top card");
  assert.equal(handOf(b.engine, P2).length, 4);
});

clause(CA, "1:rule@ooo", "the draw is optional for you: declining means neither of you draws and the opponent is never asked", () => {
  const b = caBoard({ obs: 3 });
  const seen = turnStart(b, () => ({ kind: "chooserSelectsOption", index: 0 }));
  assert.deepEqual(seen.map((pc) => pc.playerId), [P1]);
  assert.equal(handOf(b.engine, P1).length, 2);
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.equal(deckOf(b.engine, P1).length, 4);
  assert.equal(deckOf(b.engine, P2).length, 4);
});

clause(CA, "1:rule@ooo", "the opponent's draw is optional: they can decline while you still draw", () => {
  const b = caBoard({ obs: 3 });
  const seen = turnStart(b, (pc) => (pc.playerId === P1 ? { kind: "chooserSelectsOption", index: 1 } : { kind: "chooserSelectsOption", index: 0 }));
  assert.deepEqual(seen.map((pc) => pc.playerId), [P1, P2]);
  assert.equal(handOf(b.engine, P1).length, 3, "I drew");
  assert.equal(handOf(b.engine, P2).length, 3, "they didn't");
  assert.equal(deckOf(b.engine, P2).length, 4);
});

clause(CA, "1:rule@ooo", "draws exactly one card each", () => {
  const b = caBoard({ obs: 3 });
  turnStart(b, asDraw);
  assert.equal(deckOf(b.engine, P1).length, 3);
  assert.equal(deckOf(b.engine, P2).length, 3);
});

clause(CA, "1:rule@ooo", "needs three [O]: two [O] (plus other icons) does nothing", () => {
  const b = caBoard({ obs: 2, rage: 3 });
  const seen = turnStart(b, asDraw);
  assert.deepEqual(seen, []);
  assert.equal(handOf(b.engine, P1).length, 2);
  assert.equal(handOf(b.engine, P2).length, 3);
  const r = caBoard({ obs: 0, rage: 4 });
  assert.deepEqual(turnStart(r, asDraw), []);
});

clause(CA, "1:rule@ooo", "only at the start of YOUR turn: nothing happens at the start of the opponent's turn", () => {
  const b = caBoard({ obs: 7, active: P1 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, 2);
  assert.equal(handOf(b.engine, P2).length, 3);
  assert.equal(deckOf(b.engine, P2).length, 4);
});

clause(CA, ["1:rule@ooo", "2:rule@ooooo", "3:rule@ooooooo"], "the rules are static to the Athenaeum: once it has left play, none of them triggers at the start of your turn", () => {
  const b = caBoard({ obs: 7, caZone: "discard" });
  const seen = turnStart(b, asDraw);
  assert.deepEqual(seen, []);
  assert.equal(handOf(b.engine, P1).length, 2);
  assert.deepEqual(discardOf(b.engine, P2), []);
});

clause(CA, "2:rule@ooooo", "with five [O], at the start of your turn an opponent discards a card, and they choose which", () => {
  const b = caBoard({ obs: 5 });
  const seen = turnStart(b, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("oh1")] } : undefined));
  const discardPrompts = seen.filter((pc) => pc.kind === "chooserSelectsTarget");
  assert.equal(discardPrompts.length, 1);
  assert.equal(discardPrompts[0].playerId, P2, "the opponent chooses the card");
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oh1")]);
  assert.equal(handOf(b.engine, P2).length, 2);
  assert.equal(handOf(b.engine, P1).length, 2, "my hand is untouched");
});

clause(CA, "2:rule@ooooo", "the discard is mandatory and exactly one card", () => {
  const b = caBoard({ obs: 5 });
  endTurn(b.engine, P2);
  settleUntil(b.engine, (p) => p.kind === "chooserSelectsTarget"); // decline the optional draw, order the triggers
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  refused(() => pickTarget(b.engine, []), "can't decline", /requires 1 selection/);
  refused(() => pickTarget(b.engine, [b.id("oh0"), b.id("oh1")]), "two cards");
  pickTarget(b.engine, [b.id("oh0")]);
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oh0")]);
});

clause(CA, "2:rule@ooooo", "four [O] is not enough, and an empty opponent hand just discards nothing", () => {
  const a = caBoard({ obs: 4, rage: 1 });
  const seen = turnStart(a);
  assert.ok(!seen.some((pc) => pc.kind === "chooserSelectsTarget"), "no discard prompt");
  assert.deepEqual(discardOf(a.engine, P2), []);
  const e = caBoard({ obs: 5, oppHand: 0 });
  turnStart(e);
  assert.equal(e.engine.state.pendingChoice, undefined);
  assert.deepEqual(discardOf(e.engine, P2), []);
});

clause(CA, "2:rule@ooooo", "the five-[O] rule fires on its own, in addition to the three-[O] rule, and not on the opponent's turn", () => {
  const b = caBoard({ obs: 5 });
  const seen = turnStart(b, (pc) =>
    pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("oh2")] } : undefined
  );
  assert.ok(seen.some((pc) => pc.kind === "chooserSelectsOption"), "the [O][O][O] rule also applies");
  assert.deepEqual(discardOf(b.engine, P2), [b.id("oh2")]);
  assert.equal(handOf(b.engine, P1).length, 3, "I drew");
  const o = caBoard({ obs: 5, active: P1 });
  endTurn(o.engine, P1);
  assert.equal(o.engine.state.pendingChoice, undefined);
  assert.deepEqual(discardOf(o.engine, P2), []);
});

clause(CA, "3:rule@ooooooo", "with seven [O], at the start of your turn you MAY pick a character and put it into its owner's hand", () => {
  for (const [pick, owner] of [["mc", P1], ["oc", P2], ["sc", P2]] as const) {
    const b = caBoard({ obs: 7 });
    const seen = turnStart(b, (pc) => {
      if (pc.kind === "chooserSelectsTarget" && pc.playerId === P1) return { kind: "chooserSelectsTarget", selected: [b.id(pick)] };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [b.id("oh0")] };
      return undefined;
    });
    assert.ok(seen.some((pc) => pc.kind === "chooserSelectsTarget" && pc.playerId === P1), "I was asked to pick");
    assert.equal(zoneOf(b.engine, b.id(pick)), "hand", pick);
    assert.ok(handOf(b.engine, owner).includes(b.id(pick)), `${pick} is in ${owner}'s hand`);
    for (const other of ["mc", "oc", "sc"].filter((k) => k !== pick)) assert.equal(zoneOf(b.engine, b.id(other)), "play", `${other} stays`);
  }
});

clause(CA, "3:rule@ooooooo", "the pick is optional: declining returns nothing", () => {
  const b = caBoard({ obs: 7 });
  turnStart(b, (pc) => (pc.kind === "chooserSelectsTarget" && pc.playerId === P2 ? { kind: "chooserSelectsTarget", selected: [b.id("oh0")] } : undefined));
  for (const k of ["mc", "oc", "sc"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", k);
});

clause(CA, "3:rule@ooooooo", "only characters in play can be picked (items, factions, hand cards are refused)", () => {
  const b = caBoard({ obs: 7, extra: [{ key: "it", def: item({ name: "Sword" }), owner: P2, zone: "play" }] });
  endTurn(b.engine, P2);
  for (let i = 0; i < 12; i++) {
    settleUntil(b.engine, (p) => p.kind === "chooserSelectsTarget");
    const pc = pending(b.engine);
    if (!pc || pc.playerId === P1) break;
    pickTarget(b.engine, [b.id("oh0")]); // the opponent's own discard prompt
  }
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(() => pickTarget(b.engine, [b.id("it")]), "an item");
  refused(() => pickTarget(b.engine, [factionOf(b.engine, P2)]), "a faction");
  refused(() => pickTarget(b.engine, [b.id("h0")]), "a card in my hand");
  refused(() => pickTarget(b.engine, [b.id("oc"), b.id("mc")]), "a character, not two");
  pickTarget(b.engine, [b.id("oc")]);
  assert.equal(zoneOf(b.engine, b.id("oc")), "hand");
});

clause(CA, "3:rule@ooooooo", "six [O] is not enough, and the rule is only for the start of your own turn", () => {
  const a = caBoard({ obs: 6, rage: 1 });
  const seen = turnStart(a, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [a.id("oh0")] } : undefined));
  assert.ok(!seen.some((pc) => pc.kind === "chooserSelectsTarget" && pc.playerId === P1), "no pick prompt for me");
  for (const k of ["mc", "oc", "sc"]) assert.equal(zoneOf(a.engine, a.id(k)), "play", k);
  const o = caBoard({ obs: 7, active: P1 });
  endTurn(o.engine, P1);
  assert.equal(o.engine.state.pendingChoice, undefined);
  for (const k of ["mc", "oc", "sc"]) assert.equal(zoneOf(o.engine, o.id(k)), "play", k);
});

// =========================================================================================
// DAY OF THE TENTACLE
// =========================================================================================

const DT = "d5690716-c88f-4297-8a2a-54392c6ac1b5";

function dtBoard(o: { res?: CardPlacement[]; oppHand?: CardPlacement[] } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "dt", def: printing(DT), owner: P1, zone: "hand" },
      ...(o.res ?? bank("obsession", 2)),
      { key: "mh", def: character({ name: "My Card" }), owner: P1, zone: "hand" },
      ...(o.oppHand ?? [
        { key: "c", def: character({ name: "Opp Char" }), owner: P2, zone: "hand" as const },
        { key: "i", def: item({ name: "Opp Item" }), owner: P2, zone: "hand" as const },
        { key: "t", def: tactic({ name: "Opp Tactic" }), owner: P2, zone: "hand" as const },
        { key: "l", def: location({ name: "Opp Location" }), owner: P2, zone: "hand" as const },
        { key: "r", def: resourceCard({ name: "Opp Resource" }), owner: P2, zone: "hand" as const }
      ]),
      { key: "od", def: character({ name: "Opp Deck Card" }), owner: P2, zone: "deck" }
    ]
  });
}
const dtPlay = (b: ReturnType<typeof dtBoard>, pick: string) => {
  play(b.engine, P1, b.id("dt"), {});
  pickTarget(b.engine, [b.id(pick)]);
};

clause(DT, "0:rule", "the printed card has no subtype", () => {
  assert.deepEqual(printing(DT).subtype, [], "Day of the Tentacle prints no subtype");
});

clause(DT, "0:rule", "printed type / trade / cost 0 / threshold [O]: costs nothing (even with only a spent [O]), refused without an [O]", () => {
  const b0 = dtBoard();
  const def = b0.engine.getDefinition(b0.id("dt"));
  assert.deepEqual([def.type, def.trade, def.cost, def.threshold], ["tactic", "arcanist", 0, "o"]);
  const free = dtBoard({ res: spent("obsession", 1) });
  assert.equal(ready(free.engine), 0);
  dtPlay(free, "c");
  assert.equal(zoneOf(free.engine, free.id("dt")), "discard", "castable with nothing ready: cost 0");
  const paid = dtBoard({ res: bank("obsession", 2) });
  dtPlay(paid, "c");
  assert.equal(ready(paid.engine), 2, "nothing was paid");
  const thr = dtBoard({ res: bank("rage", 3) });
  refused(() => play(thr.engine, P1, thr.id("dt"), {}), "no [O]", /Threshold requirements/);
});

clause(DT, "0:rule", "you choose a NON-RESOURCE card in the opponent's hand (character, item, location or tactic) and it enters play under their control face-down as a resource", () => {
  for (const pick of ["c", "i", "t", "l"]) {
    const b = dtBoard();
    const before = ready(b.engine, P2);
    play(b.engine, P1, b.id("dt"), {});
    const pc = pending(b.engine);
    assert.equal(pc?.kind, "chooserSelectsTarget");
    assert.equal(pc?.playerId, P1, "I choose");
    pickTarget(b.engine, [b.id(pick)]);
    assert.equal(b.engine.state.pendingChoice, undefined);
    const card = b.engine.state.cards[b.id(pick)];
    assert.equal(card.zone, "play", pick);
    assert.equal(card.faceDown, true, `${pick} is face-down`);
    assert.equal(card.controllerId, P2, `${pick} is under the opponent's control`);
    assert.equal(card.ownerId, P2);
    assert.deepEqual(b.engine.getCardTypes(b.id(pick)), ["resource"], `${pick} is a resource`);
    assert.ok(b.engine.state.players[P2].play.includes(b.id(pick)), "in the opponent's play");
    assert.ok(!handOf(b.engine, P2).includes(b.id(pick)), "out of their hand");
    assert.equal(ready(b.engine, P2), before + 1, "it gives them a resource");
    assert.equal(zoneOf(b.engine, b.id("dt")), "discard");
  }
});

clause(DT, "0:rule", "only the chosen card moves; and resources, my own cards and other zones can't be chosen", () => {
  const b = dtBoard();
  play(b.engine, P1, b.id("dt"), {});
  refused(() => pickTarget(b.engine, []), "the choice is mandatory while a legal card exists", /requires 1 selection/);
  for (const bad of ["r", "mh", "od"]) refused(() => pickTarget(b.engine, [b.id(bad)]), `${bad} is not a legal choice`);
  refused(() => pickTarget(b.engine, [b.id("c"), b.id("i")]), "two cards");
  pickTarget(b.engine, [b.id("c")]);
  for (const stay of ["i", "t", "l", "r"]) assert.equal(zoneOf(b.engine, b.id(stay)), "hand", `${stay} stays in hand`);
  assert.equal(zoneOf(b.engine, b.id("mh")), "hand");
  assert.equal(zoneOf(b.engine, b.id("od")), "deck");
});

clause(DT, "0:rule", "if the opponent's hand has no non-resource card (only resources, or empty) nothing happens and nothing locks", () => {
  const only = dtBoard({ oppHand: [{ key: "r", def: resourceCard({ name: "Opp Resource" }), owner: P2, zone: "hand" }] });
  play(only.engine, P1, only.id("dt"), {});
  assert.equal(only.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(only.engine, only.id("r")), "hand");
  assert.equal(zoneOf(only.engine, only.id("dt")), "discard");
  const empty = dtBoard({ oppHand: [] });
  play(empty.engine, P1, empty.id("dt"), {});
  assert.equal(empty.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(empty.engine, empty.id("dt")), "discard");
});
