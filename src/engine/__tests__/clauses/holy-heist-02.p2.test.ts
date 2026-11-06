// Clause tests, batch holy-heist-02, part p2 (groups 7-11, missing clauses only).
// Uhluhtc Niudla, Vexing Nullifier, Voidal Humour Redistribution, Will of a Living God, Abecedarian Investor.
import assert from "node:assert/strict";
import type { PlayerId } from "../../../engine.js";
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
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, printing, refused } from "./_clause.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { declareAttackBy, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { endTurn, factionOf } from "./_turn.js";

type Board = ReturnType<typeof buildGame>;

const NIUDLA = "7be95bf9-e696-4f1d-82cd-e9f23c94f346"; // character arcanist cost 6 "ooo" 5/3/4 -- UNIQUE UHLUHTC; PREVAIL UPON; AVAIL ANEW
const NULLIFIER = "63bfbe3f-f1ad-48f7-a905-81dd2ce8b0ac"; // character arcanist cost 2 "o" 1/3/1 -- battle damage dealt / received puts the other / this into hand
const VHR = "cdaffb25-1b2d-4ecd-9c1e-472bbb07e44b"; // tactic arcanist cost 3 "ooo" -- EXTRA COST: choose X, remove X tokens from your cards; put X tokens on non-resources; draw
const WOLG = "ea29b4da-eebf-4020-ba8e-bf61d58445c8"; // tactic arcanist cost 5 "oo" -- ATTACH TO CHARACTER; 3 tokens; +1/+1 per token; start of your turn
const INVESTOR = "f1be6c74-f6b8-4dee-8b3b-c276ed72382f"; // character banker cost 2 "g" 2/3/2 -- EXTRA COST: may pick a card; remove a token from it

// --------------------------------------------------------------------------------------
// shared helpers
// --------------------------------------------------------------------------------------

/** `n` obsession resources of P1 that are already spent (attached to P1's faction). */
const spentObsession = (n: number): CardPlacement[] => bank("obsession", n, P1).map(c => ({ ...c, attachedToKey: "__factionA" }));

const handOf = (b: Board, p: PlayerId) => b.engine.state.players[p].hand as string[];
const deckOf = (b: Board, p: PlayerId) => b.engine.state.players[p].deck as string[];
const influenceOf = (b: Board, p: PlayerId) => b.engine.state.players[p].influence as number;

/** A plain resource card placement (provides rage) in play unless `extra` says otherwise. */
const res = (key: string, owner: PlayerId, extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: resourceCard({ name: `Res ${key}` }),
  owner,
  zone: "play",
  ...extra
});

const foes = (key: string, over: Parameters<typeof character>[0], owner: PlayerId = P2, extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key,
  def: character({ name: key, ...over }),
  owner,
  zone: "play",
  ...extra
});

/** Answers a chooserSelectsTarget pending choice with the given keys (drains response windows afterwards). */
const choose = (b: Board, keys: string[]) => answerPending(b.engine, "chooserSelectsTarget", { selected: keys.map(b.id) });
/** The same, but raw (no drain) so a refusal leaves the choice open. */
const chooseRaw = (b: Board, keys: string[]) => {
  const pc = pending(b.engine)!;
  b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: keys.map(b.id) } } as never);
};
const activateRaw = (b: Board, player: PlayerId, key: string, ability: string, selected: Record<string, string[]> = {}, variables: Record<string, number> = {}) =>
  b.engine.perform({ type: "activateAbility", playerId: player, cardId: b.id(key), abilityId: ability, selected, variables } as never);

// --------------------------------------------------------------------------------------
// Uhluhtc Niudla
// --------------------------------------------------------------------------------------

const niudlaBoard = (extra: CardPlacement[] = [], opts: { random?: () => number; turn?: number; active?: PlayerId } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [{ key: "un", def: printing(NIUDLA), owner: P1, zone: "play" }, ...extra]
  });

// ---- 0:unique ----

const uniqueBoard = (extra: CardPlacement[], opts: { turn?: number; active?: PlayerId } = {}) => niudlaBoard([...bank("obsession", 6, P1), ...bank("obsession", 6, P2), ...extra], opts);

clause(NIUDLA, "0:unique", "controlling a second Niudla makes you choose which to keep: choosing the new one destroys the old one", () => {
  const b = uniqueBoard([{ key: "un2", def: printing(NIUDLA), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("un2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("un"), b.id("un2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("un2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("un2")), "play");
  assert.equal(zoneOf(b.engine, b.id("un")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(NIUDLA, "0:unique", "choosing the old Niudla keeps it and destroys the new one", () => {
  const b = uniqueBoard([{ key: "un2", def: printing(NIUDLA), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("un2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("un") } } as never);
  assert.equal(zoneOf(b.engine, b.id("un")), "play");
  assert.equal(zoneOf(b.engine, b.id("un2")), "discard");
});

clause(NIUDLA, "0:unique", "the UNIQUE designation is UHLUHTC: any other card carrying it (whatever its name) is a duplicate", () => {
  const cousin = character({ name: "Some Other Uhluhtc", unique: "uhluhtc", cost: 0 });
  const b = uniqueBoard([{ key: "cousin", def: cousin, owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("cousin"));
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor", "a different card with the same designation is a duplicate");
  assert.deepEqual([...pc.candidates].sort(), [b.id("un"), b.id("cousin")].sort());
});

clause(NIUDLA, "0:unique", "a card with a different designation is not a duplicate of Niudla", () => {
  const other = character({ name: "Uhluhtd Niudla", unique: "uhluhtd", cost: 0 });
  const b = uniqueBoard([{ key: "other", def: other, owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("other"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("un")), "play");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
});

clause(NIUDLA, "0:unique", "the restriction is per player: the opponent may control their own Niudla with no choice and no destruction", () => {
  const b = uniqueBoard([{ key: "un2", def: printing(NIUDLA), owner: P2, zone: "hand" }], { turn: 2, active: P2 });
  play(b.engine, P2, b.id("un2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("un")), "play");
  assert.equal(zoneOf(b.engine, b.id("un2")), "play");
});

clause(NIUDLA, "0:unique", "a single Niudla deploys for its printed cost 6 (refused one short) and has the printed 5/3/4", () => {
  const mk = (n: number) => niudlaBoard([{ key: "n2", def: printing(NIUDLA), owner: P2, zone: "hand" }, ...bank("obsession", n, P2)], { turn: 2, active: P2 });
  const short = mk(5);
  refused(() => play(short.engine, P2, short.id("n2")), "5 resources is one short of the cost 6");
  const ok = mk(6);
  play(ok.engine, P2, ok.id("n2"));
  assert.equal(zoneOf(ok.engine, ok.id("n2")), "play");
  assert.equal(ok.engine.getStat(ok.id("n2"), "strength"), 5);
  assert.equal(ok.engine.getStat(ok.id("n2"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("n2"), "life"), 4);
});

clause(NIUDLA, "0:unique", "Niudla needs the threshold [o][o][o]: 6 resources with only two obsession are refused", () => {
  const mk = (obsession: number, greed: number) =>
    niudlaBoard([{ key: "n2", def: printing(NIUDLA), owner: P2, zone: "hand" }, ...bank("obsession", obsession, P2), ...bank("greed", greed, P2)], { turn: 2, active: P2 });
  const short = mk(2, 4);
  refused(() => play(short.engine, P2, short.id("n2")), "only two obsession icons");
  assert.equal(zoneOf(short.engine, short.id("n2")), "hand");
  const ok = mk(3, 3);
  play(ok.engine, P2, ok.id("n2"));
  assert.equal(zoneOf(ok.engine, ok.id("n2")), "play", "control: three obsession + three other pays 6");
});

// ---- 1:ability:uhluhtc-prevail ----

/** P1: r1, r2 face-up resources; f1, f2 face-down. P2: up face-up, g1, g2 face-down. */
const prevailCards = (): CardPlacement[] => [
  res("r1", P1),
  res("r2", P1),
  res("f1", P1, { faceDown: true }),
  res("f2", P1, { faceDown: true }),
  res("up", P2),
  res("g1", P2, { faceDown: true }),
  res("g2", P2, { faceDown: true })
];
const prevail = (b: Board, spent: string, picked: PlayerId = P1) =>
  activate(b.engine, P1, b.id("un"), "uhluhtc-prevail", { selected: { spent: [b.id(spent)], p: [factionOf(b.engine, picked)] } });

clause(NIUDLA, "1:ability:uhluhtc-prevail", "COST: the chosen resource goes to its owner's hand and 1 more resource is paid, both before the effect resolves", () => {
  const b = niudlaBoard(prevailCards());
  const before = readyResources(b.engine, P1);
  assert.equal(before, 4);
  prevail(b, "r1");
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand");
  assert.ok(handOf(b, P1).includes(b.id("r1")), "handOf(b, P1).includes(b.id(\"r1\"))");
  assert.equal(before - readyResources(b.engine, P1), 2, "r1 left play (1) and Pay 1 spent one more");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget", "the effect is waiting on the picked player");
  assert.equal(pc.playerId, P1);
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "COST: a face-down resource you control can be the one put into hand (it comes back face-up in hand)", () => {
  const b = niudlaBoard(prevailCards());
  prevail(b, "f1");
  assert.equal(zoneOf(b.engine, b.id("f1")), "hand");
  assert.ok(handOf(b, P1).includes(b.id("f1")), "handOf(b, P1).includes(b.id(\"f1\"))");
  assert.equal(b.engine.state.cards[b.id("f1")].faceDown, false);
  // f1 is already in hand, so it is not a candidate for the effect any more
  refused(() => chooseRaw(b, ["f1"]), "f1 has already left play");
  choose(b, ["f2"]);
  assert.equal(zoneOf(b.engine, b.id("f2")), "hand");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "COST: the resource must be one you control, in play (the opponent's, a non-resource, one in hand and no pick are refused)", () => {
  const mk = () =>
    niudlaBoard([
      ...prevailCards(),
      { key: "chr", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "inHand", def: resourceCard({ name: "InHand" }), owner: P1, zone: "hand" }
    ]);
  const control = mk();
  prevail(control, "r1");
  assert.equal(zoneOf(control.engine, control.id("r1")), "hand", "control: r1 is legal");
  for (const bad of ["up", "g1", "chr", "inHand"]) {
    const b = mk();
    refused(() => prevail(b, bad), `${bad} is not a resource you control in play`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
  const none = mk();
  refused(() => activate(none.engine, P1, none.id("un"), "uhluhtc-prevail", { selected: { p: [factionOf(none.engine, P1)] } }), "the resource must be chosen");
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "COST: the resource goes to its OWNER's hand (a resource you control but do not own returns to the other player)", () => {
  const b = niudlaBoard([res("r2", P1), res("borrowed", P2, { controller: P1 })]);
  prevail(b, "borrowed", P1);
  assert.equal(zoneOf(b.engine, b.id("borrowed")), "hand");
  assert.ok(handOf(b, P2).includes(b.id("borrowed")), "P2 owns it, so it goes to P2's hand");
  assert.ok(!handOf(b, P1).includes(b.id("borrowed")), "!handOf(b, P1).includes(b.id(\"borrowed\"))");
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "COST: Pay 1 is a separate resource: with a single resource in play (the one being put into hand) it is refused", () => {
  const one = niudlaBoard([res("r1", P1)]);
  refused(() => prevail(one, "r1"), "no resource left to pay 1 once r1 is put into hand");
  assert.equal(zoneOf(one.engine, one.id("r1")), "play", "nothing was paid or moved");
  const two = niudlaBoard([res("r1", P1), res("r2", P1)]);
  prevail(two, "r1");
  assert.equal(zoneOf(two.engine, two.id("r1")), "hand");
  assert.equal(readyResources(two.engine, P1), 0, "r2 was spent on Pay 1");
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "Pick a player: you may pick either player; a non-player card, no pick, or two picks are refused", () => {
  const mk = () => niudlaBoard([...prevailCards(), { key: "chr", def: character({ name: "Mine" }), owner: P1, zone: "play" }]);
  const self = mk();
  prevail(self, "r1", P1);
  assert.equal(pending(self.engine)?.playerId, P1);
  const opp = mk();
  prevail(opp, "r1", P2);
  assert.equal(pending(opp.engine)?.playerId, P2);
  const ch = mk();
  refused(() => activate(ch.engine, P1, ch.id("un"), "uhluhtc-prevail", { selected: { spent: [ch.id("r1")], p: [ch.id("chr")] } }), "a character is not a player");
  const nobody = mk();
  refused(() => activate(nobody.engine, P1, nobody.id("un"), "uhluhtc-prevail", { selected: { spent: [nobody.id("r1")] } }), "a player must be picked");
  const both = mk();
  refused(
    () => activate(both.engine, P1, both.id("un"), "uhluhtc-prevail", { selected: { spent: [both.id("r1")], p: [factionOf(both.engine, P1), factionOf(both.engine, P2)] } }),
    "exactly one player"
  );
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "EFFECT (you pick yourself): you put one face-down resource you control into its owner's hand; nothing else moves", () => {
  const b = niudlaBoard([...prevailCards(), res("inVoid", P1, { zone: "void", faceDown: true })]);
  prevail(b, "r1", P1);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  refused(() => chooseRaw(b, ["r2"]), "a face-up resource is not a legal pick");
  refused(() => chooseRaw(b, ["inVoid"]), "a face-down card in the void is not in play (CR 403.7b)");
  refused(() => chooseRaw(b, []), "the player must put a face-down resource into hand (not optional)");
  refused(() => chooseRaw(b, ["f1", "f2"]), "only one resource");
  assert.equal(b.engine.state.pendingChoice?.kind, "chooserSelectsTarget", "the choice stays open after refused answers");
  choose(b, ["f1"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("f1")), "hand");
  assert.ok(handOf(b, P1).includes(b.id("f1")), "handOf(b, P1).includes(b.id(\"f1\"))");
  for (const k of ["f2", "r2", "up", "g1", "g2"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} stays in play`);
  assert.equal(b.engine.state.cards[b.id("f2")].faceDown, true, "f2 is still face-down");
  assert.equal(b.engine.state.cards[b.id("g1")].faceDown, true);
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "EFFECT (you pick the opponent): the opponent makes the choice and puts one of THEIR face-down resources into its owner's hand", () => {
  const b = niudlaBoard(prevailCards());
  prevail(b, "r1", P2);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the picked player chooses, not you");
  refused(() => chooseRaw(b, ["up"]), "their face-up resource is not a legal pick");
  refused(() => chooseRaw(b, []), "they must put one in");
  choose(b, ["g2"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("g2")), "hand");
  assert.ok(handOf(b, P2).includes(b.id("g2")), "handOf(b, P2).includes(b.id(\"g2\"))");
  for (const k of ["g1", "up", "f1", "f2", "r2"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} is unaffected`);
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "EFFECT: the resource goes into its OWNER's hand (a face-down resource the picked player controls but does not own)", () => {
  const b = niudlaBoard([
    ...prevailCards(),
    res("stolen", P1, { controller: P2, faceDown: true }), // P1 owns it, P2 controls it
    res("lent", P2, { controller: P1, faceDown: true }) // P2 owns it, P1 controls it
  ]);
  prevail(b, "r1", P2);
  choose(b, ["stolen"]);
  assert.equal(zoneOf(b.engine, b.id("stolen")), "hand");
  assert.ok(handOf(b, P1).includes(b.id("stolen")), "it goes to its owner's (P1's) hand");
  assert.ok(!handOf(b, P2).includes(b.id("stolen")), "!handOf(b, P2).includes(b.id(\"stolen\"))");
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "EFFECT: a picked player with no face-down resource does nothing (the costs stay paid, nothing hangs)", () => {
  const b = niudlaBoard([res("r1", P1), res("r2", P1), res("up", P2)]);
  prevail(b, "r1", P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand", "the cost was still paid");
  assert.equal(zoneOf(b.engine, b.id("up")), "play", "their face-up resource is untouched");
  const self = niudlaBoard([res("r1", P1), res("r2", P1)]);
  prevail(self, "r1", P1);
  assert.equal(self.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(self.engine, self.id("r2")), "play");
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "EFFECT: a player picking themselves cannot pick the opponent's face-down resource (it must be one THEY control)", () => {
  const b = niudlaBoard(prevailCards());
  prevail(b, "r1", P1);
  assert.equal(pending(b.engine)?.playerId, P1);
  refused(() => chooseRaw(b, ["g1"]), "g1 is controlled by the opponent, not by the player who must put one in hand");
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "EFFECT: the picked opponent cannot put YOUR face-down resource into hand (it must be one THEY control)", () => {
  const b = niudlaBoard(prevailCards());
  prevail(b, "r1", P2);
  assert.equal(pending(b.engine)?.playerId, P2);
  refused(() => chooseRaw(b, ["f1"]), "f1 is controlled by the other player");
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "EFFECT: 'they control' means control, not ownership (a face-down resource the picked player owns but you control is not a legal pick)", () => {
  const b = niudlaBoard([...prevailCards(), res("lent", P2, { controller: P1, faceDown: true })]);
  prevail(b, "r1", P2);
  refused(() => chooseRaw(b, ["lent"]), "P2 does not control 'lent'");
});

clause(NIUDLA, "1:ability:uhluhtc-prevail", "has no deplete cost or once-a-turn limit: it can be used twice in one turn", () => {
  const b = niudlaBoard([res("r1", P1), res("r2", P1), res("r3", P1), res("r4", P1), res("f1", P1, { faceDown: true }), res("f2", P1, { faceDown: true })]);
  prevail(b, "r1", P1);
  choose(b, ["f1"]);
  assert.equal(b.engine.state.cards[b.id("un")].depleted, false, "no deplete cost");
  prevail(b, "r2", P1);
  choose(b, ["f2"]);
  assert.equal(zoneOf(b.engine, b.id("r1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("r2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("f1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("f2")), "hand");
});

// ---- 2:ability:uhluhtc-avail ----

const OBSESSION = () => resourceCard({ name: "Obsession", resource: { provides: ["obsession"], staple: true } });
const availCards = (hand: CardPlacement[], deck = 5): CardPlacement[] => [...hand, ...fillers("c", deck, P1, "deck"), ...bank("greed", 1, P1)];
const hr = (name = "Obsession", extra: Partial<CardPlacement> = {}): CardPlacement => ({
  key: "hr",
  def: name === "Obsession" ? OBSESSION() : resourceCard({ name }),
  owner: P1,
  zone: "hand",
  ...extra
});
const avail = (b: Board, rev = "hr") => activate(b.engine, P1, b.id("un"), "uhluhtc-avail", { selected: { rev: [b.id(rev)] } });

clause(NIUDLA, "2:ability:uhluhtc-avail", "COST: the revealed hand resource is revealed to everyone and shuffled into your deck, and 1 resource is paid, before the effect resolves", () => {
  const b = niudlaBoard(availCards([hr()]), { random: () => 0 });
  const ready = readyResources(b.engine, P1);
  const unshuffled = [...deckOf(b, P1), b.id("hr")];
  activateRaw(b, P1, "un", "uhluhtc-avail", { rev: [b.id("hr")] });
  assert.equal(zoneOf(b.engine, b.id("hr")), "deck", "the resource is in the deck already (cost)");
  assert.equal(handOf(b, P1).length, 0, "nothing has been drawn yet");
  assert.equal(ready - readyResources(b.engine, P1), 1, "Pay 1");
  assert.deepEqual([...deckOf(b, P1)].sort(), [...unshuffled].sort(), "the deck is the old deck plus the resource");
  assert.notDeepEqual(deckOf(b, P1), unshuffled, "the deck was shuffled (seeded: order changed)");
  assert.ok(!b.engine.getKeywords(b.id("un")).includes("covert"), "the effect has not resolved yet");
  const reveals = b.engine.getLog().filter(entry => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("hr")]);
  assert.equal(ev.viewerId, "all", "revealed to everyone");
});

clause(NIUDLA, "2:ability:uhluhtc-avail", "EFFECT: revealing a card named Obsession gives this card COVERT this turn and draws a card", () => {
  const b = niudlaBoard(availCards([hr()]), { random: () => 0 });
  const decklen = deckOf(b, P1).length;
  assert.ok(!b.engine.getKeywords(b.id("un")).includes("covert"), "control: no covert before");
  avail(b);
  assert.ok(b.engine.getKeywords(b.id("un")).includes("covert"), "covert gained");
  assert.equal(handOf(b, P1).length, 1, "drew exactly one card");
  assert.equal(deckOf(b, P1).length, decklen, "deck: +1 shuffled in, -1 drawn");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(NIUDLA, "2:ability:uhluhtc-avail", "EFFECT: a revealed resource with any other name gives no COVERT but still draws a card", () => {
  for (const name of ["Rage", "Greed", "Obsession Engine", "Obsessions"]) {
    const b = niudlaBoard(availCards([hr(name)]), { random: () => 0 });
    avail(b);
    assert.ok(!b.engine.getKeywords(b.id("un")).includes("covert"), `${name}: no covert`);
    assert.equal(handOf(b, P1).length, 1, `${name}: still drew a card`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(NIUDLA, "2:ability:uhluhtc-avail", "EFFECT: only this card gains COVERT, and only until end of turn", () => {
  const b = niudlaBoard([...availCards([hr()]), { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }], { random: () => 0 });
  avail(b);
  assert.ok(b.engine.getKeywords(b.id("un")).includes("covert"), "b.engine.getKeywords(b.id(\"un\")).includes(\"covert\")");
  assert.ok(!b.engine.getKeywords(b.id("ally")).includes("covert"), "another character does not gain covert");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.ok(!b.engine.getKeywords(b.id("un")).includes("covert"), "covert is gone once the turn ends");
});

clause(NIUDLA, "2:ability:uhluhtc-avail", "EFFECT: the COVERT it gains is real: a non-covert character cannot block it, a covert one can", () => {
  const b = niudlaBoard(
    [
      ...availCards([hr()]),
      foes("plain", {}),
      foes("sneak", { behavior: { keywords: ["covert"] } })
    ],
    { random: () => 0 }
  );
  avail(b);
  declareAttackBy(b.engine, P1, [b.id("un")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("plain")]), "a non-covert character cannot block a covert attacker", /covert/i);
  declareBlockers(b.engine, P2, [b.id("sneak")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("sneak")]);
});

clause(NIUDLA, "2:ability:uhluhtc-avail", "EFFECT: the draw happens after the shuffle (an empty deck draws back the card just shuffled in)", () => {
  const b = niudlaBoard(availCards([hr()], 0));
  avail(b);
  assert.equal(handOf(b, P1).length, 1);
  assert.equal(deckOf(b, P1).length, 0);
  assert.equal(zoneOf(b.engine, b.id("hr")), "hand", "the only card in the deck is the one drawn");
  assert.ok(b.engine.getKeywords(b.id("un")).includes("covert"), "b.engine.getKeywords(b.id(\"un\")).includes(\"covert\")");
});

clause(NIUDLA, "2:ability:uhluhtc-avail", "COST: it must be a resource in your hand (a non-resource, an opponent's hand card and a resource in play are refused)", () => {
  const mk = () =>
    niudlaBoard(
      [
        ...availCards([hr()]),
        { key: "chr", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
        { key: "theirs", def: resourceCard({ name: "Theirs" }), owner: P2, zone: "hand" },
        res("inPlay", P1)
      ],
      { random: () => 0 }
    );
  const control = mk();
  avail(control);
  assert.equal(handOf(control, P1).includes(control.id("hr")), false, "control: hr was shuffled away");
  for (const bad of ["chr", "theirs", "inPlay"]) {
    const b = mk();
    refused(() => avail(b, bad), `${bad} is not a resource in your hand`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
  const none = mk();
  refused(() => activate(none.engine, P1, none.id("un"), "uhluhtc-avail", { selected: {} }), "a resource must be revealed");
});

clause(NIUDLA, "2:ability:uhluhtc-avail", "COST: Pay 1 is required: refused with no resource in play, allowed with one", () => {
  const none = niudlaBoard([hr(), ...fillers("c", 3, P1, "deck")]);
  refused(() => avail(none), "no resource to pay 1 with");
  assert.equal(zoneOf(none.engine, none.id("hr")), "hand", "nothing was moved");
  const one = niudlaBoard(availCards([hr()]));
  avail(one);
  assert.equal(readyResources(one.engine, P1), 0, "the one resource was spent");
});

// --------------------------------------------------------------------------------------
// Vexing Nullifier
// --------------------------------------------------------------------------------------

/** P1 deploys the Nullifier from hand (the printed rules are installed as it enters play). */
function nullBoard(extra: CardPlacement[] = []) {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "vn", def: printing(NULLIFIER), owner: P1, zone: "hand" }, ...bank("obsession", 4, P1), ...extra]
  });
  play(b.engine, P1, b.id("vn"));
  assert.equal(zoneOf(b.engine, b.id("vn")), "play", "the Nullifier deployed for its printed cost 2");
  return b;
}
/** The Nullifier just entered play; summoning sickness is not under test, so let it attack this turn. */
const armed = (b: Board) => {
  b.engine.state.cards[b.id("vn")].attackEligibleTurn = b.engine.state.turn;
  return b;
};
const F2 = (): { type: "faction"; playerId: PlayerId } => ({ type: "faction", playerId: P2 });
/** On P2's turn, P2's `attacker` attacks P1's faction, P1 blocks with `blockers`. */
function p2Attacks(b: Board, attacker: string, blockers: string[]) {
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  declareAttackBy(b.engine, P2, [b.id(attacker)], { type: "faction", playerId: P1 });
  declareBlockers(b.engine, P1, blockers.map(b.id));
  finishBattle(b.engine);
}

clause(NULLIFIER, "0:rule", "a blocker it would damage goes to its owner's hand instead of taking the damage (attacking)", () => {
  const b = armed(nullBoard([foes("wall", { strength: 0, life: 3, speed: 1 })]));
  fightThrough(b.engine, P1, [b.id("vn")], F2(), [b.id("wall")]);
  assert.equal(zoneOf(b.engine, b.id("wall")), "hand");
  assert.ok(handOf(b, P2).includes(b.id("wall")), "it went to its owner's hand");
  assert.equal(zoneOf(b.engine, b.id("vn")), "play", "the Nullifier took no damage (the wall deals 0)");
  assert.equal(b.engine.state.cards[b.id("vn")].damage ?? 0, 0);
  assert.equal(b.engine.state.battle, undefined);
});

clause(NULLIFIER, "0:rule", "it bounces a character it would damage even when the damage would not have killed it (life 3 vs strength 1) and it is not 'destroyed'", () => {
  const b = armed(nullBoard([foes("wall", { strength: 0, life: 3, speed: 1 })]));
  fightThrough(b.engine, P1, [b.id("vn")], F2(), [b.id("wall")]);
  assert.notEqual(zoneOf(b.engine, b.id("wall")), "discard");
  assert.notEqual(zoneOf(b.engine, b.id("wall")), "play");
});

clause(NULLIFIER, "0:rule", "the character goes to its OWNER's hand (a stolen blocker returns to the player who owns it)", () => {
  const b = armed(nullBoard([foes("wall", { strength: 0, life: 3, speed: 1 }, P1, { controller: P2 })]));
  fightThrough(b.engine, P1, [b.id("vn")], F2(), [b.id("wall")]);
  assert.ok(handOf(b, P1).includes(b.id("wall")), "owner P1's hand");
  assert.ok(!handOf(b, P2).includes(b.id("wall")), "!handOf(b, P2).includes(b.id(\"wall\"))");
});

clause(NULLIFIER, "0:rule", "it also applies when the Nullifier BLOCKS: the attacker it would damage goes to its owner's hand", () => {
  const b = nullBoard([foes("atk", { strength: 0, life: 3, speed: 1 })]);
  p2Attacks(b, "atk", ["vn"]);
  assert.equal(zoneOf(b.engine, b.id("atk")), "hand");
  assert.ok(handOf(b, P2).includes(b.id("atk")), "handOf(b, P2).includes(b.id(\"atk\"))");
  assert.equal(zoneOf(b.engine, b.id("vn")), "play");
});

clause(NULLIFIER, "0:rule", "battle damage to a faction is not replaced: an unblocked Nullifier still costs the faction 1 influence", () => {
  const b = armed(nullBoard());
  const before = influenceOf(b, P2);
  fightThrough(b.engine, P1, [b.id("vn")], F2(), []);
  assert.equal(before - influenceOf(b, P2), 1);
  assert.equal(zoneOf(b.engine, b.id("vn")), "play");
});

clause(NULLIFIER, "0:rule", "battle damage to a location is not replaced: the location takes 1 damage and stays in play", () => {
  const b = armed(nullBoard([{ key: "loc", def: location({ name: "Foe Loc", structure: 5 }), owner: P2, zone: "play" }]));
  fightThrough(b.engine, P1, [b.id("vn")], { type: "card", cardId: b.id("loc") }, []);
  assert.equal(zoneOf(b.engine, b.id("loc")), "play");
  assert.equal(b.engine.state.cards[b.id("loc")].damage, 1);
});

clause(NULLIFIER, "0:rule", "only the Nullifier's own damage is replaced: another character's battle damage to a blocker is dealt normally", () => {
  const b = nullBoard([
    { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
    foes("wall", { strength: 0, life: 4, speed: 1 })
  ]);
  fightThrough(b.engine, P1, [b.id("ally")], F2(), [b.id("wall")]);
  assert.equal(zoneOf(b.engine, b.id("wall")), "play", "the wall was not bounced");
  assert.equal(b.engine.state.cards[b.id("wall")].damage, 2, "it took the 2 battle damage");
});

clause(NULLIFIER, "0:rule", "against a blocking party of two, only the character that actually receives the Nullifier's damage is bounced", () => {
  const b = armed(nullBoard([foes("w1", { strength: 0, life: 3, speed: 1 }), foes("w2", { strength: 0, life: 3, speed: 1 })]));
  fightThrough(b.engine, P1, [b.id("vn")], F2(), [b.id("w1"), b.id("w2")]);
  const bounced = ["w1", "w2"].filter(k => zoneOf(b.engine, b.id(k)) === "hand");
  const stayed = ["w1", "w2"].filter(k => zoneOf(b.engine, b.id(k)) === "play");
  assert.equal(bounced.length, 1, "exactly one blocker received the 1 damage and was bounced");
  assert.equal(stayed.length, 1, "the other blocker was not damaged and stays");
  assert.equal(b.engine.state.cards[b.id(stayed[0])].damage ?? 0, 0);
});

clause(NULLIFIER, "1:rule", "a character that would damage the Nullifier (and strikes first) sends the Nullifier to its owner's hand instead of destroying it", () => {
  const b = nullBoard([foes("atk", { strength: 2, life: 3, speed: 5 })]);
  p2Attacks(b, "atk", ["vn"]);
  assert.equal(zoneOf(b.engine, b.id("vn")), "hand");
  assert.ok(handOf(b, P1).includes(b.id("vn")), "to its owner's hand");
  assert.equal(b.engine.state.cards[b.id("atk")].damage ?? 0, 0, "the Nullifier never got to strike back");
  assert.equal(zoneOf(b.engine, b.id("atk")), "play");
});

clause(NULLIFIER, "1:rule", "it applies when the Nullifier attacks and is blocked by a faster character", () => {
  const b = armed(nullBoard([foes("blk", { strength: 2, life: 3, speed: 5 })]));
  fightThrough(b.engine, P1, [b.id("vn")], F2(), [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("vn")), "hand");
  assert.ok(handOf(b, P1).includes(b.id("vn")), "handOf(b, P1).includes(b.id(\"vn\"))");
  assert.equal(zoneOf(b.engine, b.id("blk")), "play");
  assert.equal(b.engine.state.cards[b.id("blk")].damage ?? 0, 0);
});

clause(NULLIFIER, "1:rule", "both rules at once: a same-speed fight bounces both characters", () => {
  const b = armed(nullBoard([foes("blk", { strength: 2, life: 3, speed: 3 })]));
  fightThrough(b.engine, P1, [b.id("vn")], F2(), [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("vn")), "hand", "the Nullifier is bounced by the blocker's damage");
  assert.equal(zoneOf(b.engine, b.id("blk")), "hand", "the blocker is bounced by the Nullifier's damage");
  assert.ok(handOf(b, P1).includes(b.id("vn")), "handOf(b, P1).includes(b.id(\"vn\"))");
  assert.ok(handOf(b, P2).includes(b.id("blk")), "handOf(b, P2).includes(b.id(\"blk\"))");
});

clause(NULLIFIER, "1:rule", "only BATTLE damage is replaced: lethal non-battle damage still destroys the Nullifier (it goes to the discard pile)", () => {
  const shoot = tactic({
    name: "Shoot",
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
  });
  const b = nullBoard([{ key: "shoot", def: shoot, owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("shoot"), { selected: { t: [b.id("vn")] } });
  assert.equal(zoneOf(b.engine, b.id("vn")), "discard");
});

clause(NULLIFIER, "1:rule", "after being bounced, redeploying it installs the rules again (exactly once): it bounces a blocker again", () => {
  const b = armed(nullBoard([foes("blk", { strength: 2, life: 3, speed: 5 }), foes("wall", { strength: 0, life: 3, speed: 1 })]));
  fightThrough(b.engine, P1, [b.id("vn")], F2(), [b.id("blk")]);
  assert.ok(handOf(b, P1).includes(b.id("vn")), "bounced by the faster blocker");
  play(b.engine, P1, b.id("vn"));
  assert.equal(zoneOf(b.engine, b.id("vn")), "play");
  armed(b);
  fightThrough(b.engine, P1, [b.id("vn")], F2(), [b.id("wall")]);
  assert.ok(handOf(b, P2).includes(b.id("wall")), "the redeployed Nullifier bounces the wall");
  assert.equal(zoneOf(b.engine, b.id("vn")), "play");
});

clause(NULLIFIER, "0:rule", "a Nullifier turned face-up by an effect (not deployed from hand) has the rule too", () => {
  const flipper = tactic({
    name: "Flipper",
    cost: 0,
    behavior: { abilities: [{ id: "f", type: "activated", targets: [{ id: "t", selector: { controller: "self", zone: "play", faceDown: true }, count: 1 }], effects: [{ type: "flipFaceUp", target: { type: "selected", id: "t" } }] }] }
  });
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "vn", def: printing(NULLIFIER), owner: P1, zone: "play", faceDown: true },
      { key: "flip", def: flipper, owner: P1, zone: "hand" },
      foes("wall", { strength: 0, life: 3, speed: 1 })
    ]
  });
  play(b.engine, P1, b.id("flip"), { selected: { t: [b.id("vn")] } });
  assert.equal(b.engine.state.cards[b.id("vn")].faceDown, false, "the Nullifier is face-up now");
  armed(b);
  fightThrough(b.engine, P1, [b.id("vn")], F2(), [b.id("wall")]);
  assert.ok(handOf(b, P2).includes(b.id("wall")), "its battle damage bounces the wall");
});

// --------------------------------------------------------------------------------------
// Voidal Humour Redistribution
// --------------------------------------------------------------------------------------

const shares = (b: Board, m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [b.id(k), v]));
const mkMe = (key: string, tokens = 0): CardPlacement => ({ key, def: character({ name: key }), owner: P1, zone: "play", counters: tokens ? { token: tokens } : undefined });
const mkFoe = (key: string, tokens = 0): CardPlacement => ({ key, def: character({ name: key }), owner: P2, zone: "play", counters: tokens ? { token: tokens } : undefined });

function vhrBoard(extra: CardPlacement[] = [], resources = 3) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "vhr", def: printing(VHR), owner: P1, zone: "hand" }, ...fillers("d", 4, P1, "deck"), ...fillers("e", 3, P2, "deck"), ...bank("obsession", resources, P1), ...extra]
  });
}
/** Plays Voidal Humour with X, `src` / `dest` picks and the two divisions (what is removed, what is put). */
function vhr(b: Board, x: number, src: string[], dest: string[], take: Record<string, number>, give: Record<string, number>) {
  play(b.engine, P1, b.id("vhr"), { variables: { x }, selected: { src: src.map(b.id), dest: dest.map(b.id) } });
  if (x > 0 && src.length) answerPending(b.engine, "distributeAmong", { shares: shares(b, take) });
  if (x > 0 && dest.length) answerPending(b.engine, "distributeAmong", { shares: shares(b, give) });
  assert.equal(b.engine.state.pendingChoice, undefined, "everything was answered");
}

clause(VHR, "0:extraCost", "X tokens are removed from the card you control that holds them, and the tokens appear where you put them", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d")]);
  vhr(b, 2, ["a"], ["d"], { a: 2 }, { d: 2 });
  assert.equal(tokensOn(b.engine, b.id("a")), 0, "2 removed");
  assert.equal(tokensOn(b.engine, b.id("d")), 2, "2 put");
});

clause(VHR, "0:extraCost", "the tokens can be removed from several cards you control in any split (X=3 from 1 + 2)", () => {
  const b = vhrBoard([mkMe("a", 1), mkMe("b", 2), mkMe("d")]);
  vhr(b, 3, ["a", "b"], ["d"], { a: 1, b: 2 }, { d: 3 });
  assert.equal(tokensOn(b.engine, b.id("a")), 0);
  assert.equal(tokensOn(b.engine, b.id("b")), 0);
  assert.equal(tokensOn(b.engine, b.id("d")), 3);
});

clause(VHR, "0:extraCost", "X tokens may come from fewer than all tokens: X=1 from a card with 3 leaves 2", () => {
  const b = vhrBoard([mkMe("a", 3), mkMe("d")]);
  vhr(b, 1, ["a"], ["d"], { a: 1 }, { d: 1 });
  assert.equal(tokensOn(b.engine, b.id("a")), 2);
  assert.equal(tokensOn(b.engine, b.id("d")), 1);
});

clause(VHR, "0:extraCost", "X can be 0: nothing is removed or put, and the card still draws", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d")]);
  const hand0 = handOf(b, P1).length;
  vhr(b, 0, [], [], {}, {});
  assert.equal(tokensOn(b.engine, b.id("a")), 2);
  assert.equal(tokensOn(b.engine, b.id("d")), 0);
  assert.equal(handOf(b, P1).length, hand0 - 1 + 1, "tactic out, one card drawn");
});

clause(VHR, "0:extraCost", "X is bounded by the number of tokens on cards you control (X=3 with only 2 is refused; the opponent's tokens do not count)", () => {
  const over = vhrBoard([mkMe("a", 2), mkMe("d"), mkFoe("theirs", 5)]);
  refused(() => play(over.engine, P1, over.id("vhr"), { variables: { x: 3 }, selected: { src: [over.id("a")], dest: [over.id("d")] } }), "X=3 > 2 tokens you control");
  assert.equal(zoneOf(over.engine, over.id("vhr")), "hand", "not played");
  assert.equal(tokensOn(over.engine, over.id("a")), 2);
  const ok = vhrBoard([mkMe("a", 2), mkMe("d"), mkFoe("theirs", 5)]);
  vhr(ok, 2, ["a"], ["d"], { a: 2 }, { d: 2 });
  assert.equal(tokensOn(ok.engine, ok.id("d")), 2);
});

clause(VHR, "0:extraCost", "X must be a non-negative number: -1 is refused", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d")]);
  refused(() => play(b.engine, P1, b.id("vhr"), { variables: { x: -1 }, selected: { src: [b.id("a")], dest: [b.id("d")] } }), "X=-1");
  assert.equal(zoneOf(b.engine, b.id("vhr")), "hand");
  assert.equal(tokensOn(b.engine, b.id("a")), 2);
});

clause(VHR, "0:extraCost", "X must be a whole number: 1.5 is refused", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d")]);
  refused(() => play(b.engine, P1, b.id("vhr"), { variables: { x: 1.5 }, selected: { src: [b.id("a")], dest: [b.id("d")] } }), "X=1.5");
  assert.equal(zoneOf(b.engine, b.id("vhr")), "hand");
  assert.equal(tokensOn(b.engine, b.id("a")), 2);
});

clause(VHR, "0:extraCost", "tokens can only be removed from cards you control: an opponent's card is refused as a source", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d"), mkFoe("theirs", 2)]);
  refused(() => play(b.engine, P1, b.id("vhr"), { variables: { x: 2 }, selected: { src: [b.id("theirs")], dest: [b.id("d")] } }), "the opponent's tokens cannot be removed");
  assert.equal(tokensOn(b.engine, b.id("theirs")), 2);
});

clause(VHR, "0:extraCost", "tokens can be removed from any card you control, resources included", () => {
  const b = vhrBoard([res("rr", P1, { counters: { token: 1 } }), mkMe("d")]);
  vhr(b, 1, ["rr"], ["d"], { rr: 1 }, { d: 1 });
  assert.equal(tokensOn(b.engine, b.id("rr")), 0);
  assert.equal(tokensOn(b.engine, b.id("d")), 1);
});

clause(VHR, "0:extraCost", "the X tokens are removed as the card is played (extra cost), before it resolves", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d")]);
  playRaw(b.engine, P1, b.id("vhr"), { variables: { x: 2 }, selected: { src: [b.id("a")], dest: [b.id("d")] } });
  // The division of the cost is asked as the card is played (nothing is removed until it is answered).
  assert.equal(b.engine.state.pendingChoice?.kind, "distributeAmong", "the division of the removed tokens is asked while playing");
  assert.equal(tokensOn(b.engine, b.id("a")), 2, "nothing is removed before the division is made");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: shares(b, { a: 2 }) } } as never);
  assert.equal(tokensOn(b.engine, b.id("a")), 0, "the tokens were removed when the card was played");
  assert.equal(zoneOf(b.engine, b.id("vhr")) !== "hand", true);
});

clause(VHR, "0:extraCost", "the tactic itself costs 3 with [o][o][o]: refused with 2 ready resources (a third is already spent) and with 2 obsession + 1 greed", () => {
  const args = (b: Board) => ({ variables: { x: 1 }, selected: { src: [b.id("a")], dest: [b.id("d")] } });
  const cheap = vhrBoard([mkMe("a", 1), mkMe("d"), ...spentObsession(1), ...bank("obsession", 2, P1)], 0);
  assert.equal(readyResources(cheap.engine, P1), 2);
  refused(() => play(cheap.engine, P1, cheap.id("vhr"), args(cheap)), "only 2 resources are ready: one short of the cost 3");
  const wrong = vhrBoard([mkMe("a", 1), mkMe("d"), ...bank("obsession", 2, P1), ...bank("greed", 1, P1)], 0);
  refused(() => play(wrong.engine, P1, wrong.id("vhr"), args(wrong)), "only two obsession icons for [o][o][o]");
  const ok = vhrBoard([mkMe("a", 1), mkMe("d")], 3);
  vhr(ok, 1, ["a"], ["d"], { a: 1 }, { d: 1 });
  assert.equal(zoneOf(ok.engine, ok.id("vhr")), "discard", "control: castable with three obsession");
});

clause(VHR, "1:rule", "the tokens are divided however you want: all on one card, or split across several (including the opponent's cards)", () => {
  const all = vhrBoard([mkMe("a", 3), mkMe("d1"), mkMe("d2")]);
  vhr(all, 3, ["a"], ["d1", "d2"], { a: 3 }, { d1: 3, d2: 0 });
  assert.equal(tokensOn(all.engine, all.id("d1")), 3);
  assert.equal(tokensOn(all.engine, all.id("d2")), 0);
  const split = vhrBoard([mkMe("a", 3), mkMe("d1"), mkFoe("d2")]);
  vhr(split, 3, ["a"], ["d1", "d2"], { a: 3 }, { d1: 1, d2: 2 });
  assert.equal(tokensOn(split.engine, split.id("d1")), 1);
  assert.equal(tokensOn(split.engine, split.id("d2")), 2, "the opponent's character may receive tokens");
  assert.equal(tokensOn(split.engine, split.id("a")), 0);
});

clause(VHR, "1:rule", "tokens go on any non-resource card: items, locations and a card that already has tokens (which keeps them)", () => {
  const b = vhrBoard([
    mkMe("a", 3),
    { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
    { key: "lo", def: location({ name: "Lo" }), owner: P2, zone: "play" },
    mkFoe("hasSome", 4)
  ]);
  vhr(b, 3, ["a"], ["it", "lo", "hasSome"], { a: 3 }, { it: 1, lo: 1, hasSome: 1 });
  assert.equal(tokensOn(b.engine, b.id("it")), 1);
  assert.equal(tokensOn(b.engine, b.id("lo")), 1);
  assert.equal(tokensOn(b.engine, b.id("hasSome")), 5, "4 + 1");
});

clause(VHR, "1:rule", "a card the tokens were taken from may also receive them back (net no change)", () => {
  const b = vhrBoard([mkMe("a", 2)]);
  vhr(b, 2, ["a"], ["a"], { a: 2 }, { a: 2 });
  assert.equal(tokensOn(b.engine, b.id("a")), 2);
});

clause(VHR, "1:rule", "resources (face-up or face-down), factions and cards outside play are not valid destinations", () => {
  const mk = () =>
    vhrBoard([
      mkMe("a", 2),
      mkMe("d"),
      res("up", P1),
      { key: "fdChar", def: character({ name: "FdChar" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDisc", def: character({ name: "InDisc" }), owner: P1, zone: "discard" }
    ]);
  const control = mk();
  vhr(control, 2, ["a"], ["d"], { a: 2 }, { d: 2 });
  assert.equal(tokensOn(control.engine, control.id("d")), 2, "control: a character is fine");
  for (const bad of ["up", "fdChar", "inHand", "inDisc"]) {
    const b = mk();
    refused(() => play(b.engine, P1, b.id("vhr"), { variables: { x: 2 }, selected: { src: [b.id("a")], dest: [bad].map(b.id) } }), `${bad} is not a non-resource card in play`);
  }
  const fac = mk();
  refused(() => play(fac.engine, P1, fac.id("vhr"), { variables: { x: 2 }, selected: { src: [fac.id("a")], dest: [factionOf(fac.engine, P2)] } }), "a faction is not affected unless named (CR 202.9)");
});

const dividePrompt = (b: Board, x: number, src: Record<string, number>, dest: string[]) => {
  play(b.engine, P1, b.id("vhr"), { variables: { x }, selected: { src: Object.keys(src).map(b.id), dest: dest.map(b.id) } });
  answerPending(b.engine, "distributeAmong", { shares: shares(b, src) });
};
const submitShares = (b: Board, m: Record<string, number>) =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: shares(b, m) } } as never);

clause(VHR, "1:rule", "all X tokens must be put: dividing MORE than X is refused (and the exact division then works)", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d1"), mkMe("d2")]);
  dividePrompt(b, 2, { a: 2 }, ["d1", "d2"]);
  refused(() => submitShares(b, { d1: 2, d2: 1 }), "3 tokens for X=2");
  assert.equal(b.engine.state.pendingChoice?.kind, "distributeAmong", "the choice is still open");
  submitShares(b, { d1: 1, d2: 1 });
  assert.equal(tokensOn(b.engine, b.id("d1")), 1);
  assert.equal(tokensOn(b.engine, b.id("d2")), 1);
});

clause(VHR, "1:rule", "all X tokens must be put: dividing FEWER than X (1 of 2, or 0 of 2) is refused", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d1"), mkMe("d2")]);
  dividePrompt(b, 2, { a: 2 }, ["d1", "d2"]);
  refused(() => submitShares(b, { d1: 1, d2: 0 }), "only 1 of the 2 tokens put anywhere");
});

clause(VHR, "1:rule", "all X tokens must be put: a negative share (2 + -1) is refused", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d1"), mkMe("d2")]);
  dividePrompt(b, 2, { a: 2 }, ["d1", "d2"]);
  refused(() => submitShares(b, { d1: 2, d2: -1 }), "a negative share");
});

clause(VHR, "0:extraCost", "all X tokens must be removed: removing FEWER than X (1 of 2) is refused", () => {
  const b = vhrBoard([mkMe("a", 2), mkMe("d1")]);
  play(b.engine, P1, b.id("vhr"), { variables: { x: 2 }, selected: { src: [b.id("a")], dest: [b.id("d1")] } });
  refused(() => submitShares(b, { a: 1 }), "only 1 of the 2 tokens removed");
});

clause(VHR, "0:extraCost", "the tokens removed must really be on the cards: taking more from a card than it holds is refused", () => {
  const b = vhrBoard([mkMe("a", 1), mkMe("b", 2), mkMe("d")]);
  play(b.engine, P1, b.id("vhr"), { variables: { x: 3 }, selected: { src: [b.id("a"), b.id("b")], dest: [b.id("d")] } });
  refused(() => submitShares(b, { a: 2, b: 1 }), "'a' only holds 1 token");
});

clause(VHR, "1:rule", "then draw a card (exactly one, from your own deck)", () => {
  const b = vhrBoard([mkMe("a", 1), mkMe("d")]);
  const hand0 = handOf(b, P1).length;
  const deck0 = deckOf(b, P1).length;
  const oppDeck0 = deckOf(b, P2).length;
  vhr(b, 1, ["a"], ["d"], { a: 1 }, { d: 1 });
  assert.equal(handOf(b, P1).length, hand0 - 1 + 1, "tactic played, one card drawn");
  assert.equal(deckOf(b, P1).length, deck0 - 1);
  assert.equal(deckOf(b, P2).length, oppDeck0, "the opponent draws nothing");
  assert.equal(zoneOf(b.engine, b.id("vhr")), "discard");
});

// --------------------------------------------------------------------------------------
// Will of a Living God
// --------------------------------------------------------------------------------------

function wolgBoard(extra: CardPlacement[] = [], resources = 5) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "w", def: printing(WOLG), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 4, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("obsession", resources, P1),
      ...extra
    ]
  });
}
const cast = (b: Board, host: string) => play(b.engine, P1, b.id("w"), { selected: { attachTo: [b.id(host)] } });
const hostOf = (b: Board, key: string) => b.engine.state.cards[b.id(key)].attachedTo;
const stats = (b: Board, key: string) => [b.engine.getStat(b.id(key), "strength"), b.engine.getStat(b.id(key), "life"), b.engine.getStat(b.id(key), "speed")];

clause(WOLG, "0:attach", "it attaches to a character: yours or the opponent's", () => {
  for (const host of ["mine", "theirs"]) {
    const b = wolgBoard();
    cast(b, host);
    assert.equal(zoneOf(b.engine, b.id("w")), "play");
    assert.equal(hostOf(b, "w"), b.id(host), `attached to ${host}`);
  }
});

clause(WOLG, "0:attach", "the host must be a character: items, locations, resources (face-up or face-down) and factions are refused; a card in hand is refused", () => {
  const mk = () =>
    wolgBoard([
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "lo", def: location({ name: "Lo" }), owner: P2, zone: "play" },
      res("up", P1),
      res("down", P1, { faceDown: true }),
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" }
    ]);
  const control = mk();
  cast(control, "mine");
  assert.equal(hostOf(control, "w"), control.id("mine"), "control: a character host works");
  for (const bad of ["it", "lo", "up", "down", "inHand"]) {
    const b = mk();
    refused(() => cast(b, bad), `${bad} is not a character in play`);
    assert.equal(zoneOf(b.engine, b.id("w")), "hand", `${bad}: the card was not played`);
  }
  const fac = mk();
  refused(() => play(fac.engine, P1, fac.id("w"), { selected: { attachTo: [factionOf(fac.engine, P2)] } }), "a faction is not a character");
  const none = mk();
  refused(() => play(none.engine, P1, none.id("w"), {}), "a host must be picked");
});

clause(WOLG, "0:attach", "with no character in play there is no host to pick, so it cannot be played (CR 507.2a)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "w", def: printing(WOLG), owner: P1, zone: "hand" }, ...bank("obsession", 5, P1), { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" }]
  });
  refused(() => play(b.engine, P1, b.id("w"), { selected: { attachTo: [b.id("it")] } }), "no character exists to attach to");
  assert.equal(zoneOf(b.engine, b.id("w")), "hand");
});

clause(WOLG, "0:attach", "it costs 5 with [o][o]: refused with 4 resources, with 4 ready of 5, and with only one obsession icon", () => {
  const short = wolgBoard([], 4);
  refused(() => cast(short, "mine"), "4 resources is one short");
  const spent = wolgBoard([...spentObsession(1)], 4);
  assert.equal(readyResources(spent.engine, P1), 4);
  refused(() => cast(spent, "mine"), "only 4 of the 5 resources are ready");
  const wrong = wolgBoard([...bank("greed", 4, P1)], 1);
  refused(() => cast(wrong, "mine"), "one obsession icon is short of [o][o]");
  const allGreed = wolgBoard([...bank("greed", 5, P1)], 0);
  refused(() => cast(allGreed, "mine"), "no obsession threshold at all");
  const mixed = wolgBoard([...bank("greed", 3, P1)], 2);
  cast(mixed, "mine");
  assert.equal(hostOf(mixed, "w"), mixed.id("mine"), "control: 2 obsession + 3 greed pays 5 with the threshold");
});

clause(WOLG, "1:rule", "it ends up in play attached to the host, not in its owner's discard pile", () => {
  const b = wolgBoard();
  cast(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("w")), "play");
  assert.equal(hostOf(b, "w"), b.id("mine"));
  assert.ok(!(b.engine.state.players[P1].discard as string[]).includes(b.id("w")), "!(b.engine.state.players[P1].discard as string[]).includes(b.id(\"w\"))");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(WOLG, "1:rule", "if the chosen host is gone by the time it would enter play, it goes to the discard pile instead (CR 507.2c)", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const b = wolgBoard([{ key: "bounce", def: bounce, owner: P2, zone: "hand" }]);
  playRaw(b.engine, P1, b.id("w"), { selected: { attachTo: [b.id("theirs")] } });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("bounce"), selected: { t: [b.id("theirs")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "hand", "the host left play in response");
  assert.equal(zoneOf(b.engine, b.id("w")), "discard", "it can't attach, so it goes to its owner's discard pile");
});

clause(WOLG, "2:rule", "it enters play with 3 tokens on it", () => {
  const b = wolgBoard();
  cast(b, "mine");
  assert.equal(tokensOn(b.engine, b.id("w")), 3);
  const opp = wolgBoard();
  cast(opp, "theirs");
  assert.equal(tokensOn(opp.engine, opp.id("w")), 3, "the same on an opposing host");
});

clause(WOLG, "2:rule", "only the Mutation's own entering adds tokens: another card entering play afterwards (yours or the opponent's) adds none", () => {
  const b = wolgBoard([
    { key: "late", def: character({ name: "Late", cost: 0 }), owner: P1, zone: "hand" },
    { key: "foeLate", def: character({ name: "FoeLate", cost: 0 }), owner: P2, zone: "hand" }
  ]);
  cast(b, "mine");
  assert.equal(tokensOn(b.engine, b.id("w")), 3);
  play(b.engine, P1, b.id("late"));
  assert.equal(zoneOf(b.engine, b.id("late")), "play");
  assert.equal(tokensOn(b.engine, b.id("w")), 3, "still 3 after another card of yours entered play");
  endTurn(b.engine, P1);
  play(b.engine, P2, b.id("foeLate"));
  assert.equal(zoneOf(b.engine, b.id("foeLate")), "play");
  assert.equal(tokensOn(b.engine, b.id("w")), 3, "still 3 after an opposing card entered play");
});

clause(WOLG, "3:rule", "the attached character gains 1 strength and 1 life per token (3 tokens: +3/+3); speed is unchanged", () => {
  const b = wolgBoard();
  assert.deepEqual(stats(b, "mine"), [2, 3, 1]);
  cast(b, "mine");
  assert.deepEqual(stats(b, "mine"), [5, 6, 1]);
  assert.deepEqual(stats(b, "theirs"), [4, 5, 2], "the other character is untouched");
  const opp = wolgBoard();
  cast(opp, "theirs");
  assert.deepEqual(stats(opp, "theirs"), [7, 8, 2]);
  assert.deepEqual(stats(opp, "mine"), [2, 3, 1]);
});

clause(WOLG, "3:rule", "the bonus follows the token count (2 tokens: +2/+2, 1: +1/+1, 0: none)", () => {
  const b = wolgBoard();
  cast(b, "mine");
  for (const [tokens, expected] of [[2, [4, 5, 1]], [1, [3, 4, 1]], [0, [2, 3, 1]], [4, [6, 7, 1]]] as const) {
    b.engine.state.cards[b.id("w")].counters = { token: tokens };
    assert.deepEqual(stats(b, "mine"), [...expected], `${tokens} tokens`);
  }
});

clause(WOLG, "3:rule", "the bonus ends when the card leaves play", () => {
  const killer = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "tactic" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = wolgBoard([{ key: "smash", def: killer, owner: P1, zone: "hand" }]);
  cast(b, "mine");
  assert.deepEqual(stats(b, "mine"), [5, 6, 1]);
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("w")] } });
  assert.equal(zoneOf(b.engine, b.id("w")), "discard");
  assert.deepEqual(stats(b, "mine"), [2, 3, 1], "back to the printed stats");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

const hostRemoval = (kind: "destroy" | "bounce") =>
  tactic({
    name: `Host ${kind}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "h",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [kind === "destroy" ? { type: "destroy", target: { type: "selected", id: "t" } } : { type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });

clause(WOLG, "0:attach", "if the host is destroyed the attached card leaves play the same way (discard pile)", () => {
  const b = wolgBoard([{ key: "rm", def: hostRemoval("destroy"), owner: P1, zone: "hand" }]);
  cast(b, "mine");
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("w")), "discard", "it follows its host to the discard pile");
  assert.ok((b.engine.state.players[P1].discard as string[]).includes(b.id("w")), "(b.engine.state.players[P1].discard as string[]).includes(b.id(\"w\"))");
});

clause(WOLG, "2:rule", "the 3 tokens disappear when the card leaves play (a card in the discard pile carries none)", () => {
  const b = wolgBoard([{ key: "rm", def: hostRemoval("destroy"), owner: P1, zone: "hand" }]);
  cast(b, "mine");
  assert.equal(tokensOn(b.engine, b.id("w")), 3);
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("w")), "discard");
  assert.equal(tokensOn(b.engine, b.id("w")), 0, "tokens disappear when the card leaves play (CR 409.2)");
});

clause(WOLG, "0:attach", "if the host is put into its owner's hand the attached card leaves play the same way (into ITS owner's hand), not into the discard pile", () => {
  const b = wolgBoard([{ key: "rm", def: hostRemoval("bounce"), owner: P1, zone: "hand" }]);
  cast(b, "theirs");
  play(b.engine, P1, b.id("rm"), { selected: { t: [b.id("theirs")] } });
  assert.equal(zoneOf(b.engine, b.id("theirs")), "hand");
  assert.ok(handOf(b, P2).includes(b.id("theirs")), "the host went to its owner's hand");
  assert.equal(zoneOf(b.engine, b.id("w")), "hand", "the Mutation left play the same way");
  assert.ok(handOf(b, P1).includes(b.id("w")), "into its owner's hand");
});

/** A WOLG already in play on `host` carrying `tokens` (player P1 controls it). */
function wolgInPlay(host: string, tokens: number) {
  return wolgBoard([{ key: "w2", def: printing(WOLG), owner: P1, zone: "play", attachedToKey: host, counters: { token: tokens } }]);
}

clause(WOLG, "4:rule", "at the start of YOUR turn it loses a token (not at the opponent's turn start)", () => {
  const b = wolgInPlay("mine", 3);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(tokensOn(b.engine, b.id("w2")), 3, "the opponent's turn start does not remove a token");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(tokensOn(b.engine, b.id("w2")), 2, "your turn start removes exactly one");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.deepEqual(stats(b, "mine"), [4, 5, 1], "and the bonus shrinks with it");
});

clause(WOLG, "4:rule", "removing the LAST token does not destroy the character; the turn after, with none left, it is destroyed (3 tokens last 3 turn starts)", () => {
  const b = wolgInPlay("mine", 3);
  for (let i = 3; i >= 1; i -= 1) {
    endTurn(b.engine, P1);
    endTurn(b.engine, P2);
    assert.equal(tokensOn(b.engine, b.id("w2")), i - 1, `after your turn start #${4 - i}`);
    assert.equal(zoneOf(b.engine, b.id("mine")), "play", `still alive with ${i - 1} tokens`);
  }
  assert.deepEqual(stats(b, "mine"), [2, 3, 1]);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "no token to remove: the attached character is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.notEqual(zoneOf(b.engine, b.id("w2")), "play", "the Mutation does not stay behind");
});

clause(WOLG, "4:rule", "with 0 tokens at the start of your turn the attached character is destroyed and no token count goes negative", () => {
  const b = wolgInPlay("mine", 0);
  endTurn(b.engine, P1);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "the opponent's turn start does nothing");
  endTurn(b.engine, P2);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.ok(tokensOn(b.engine, b.id("w2")) >= 0, "tokensOn(b.engine, b.id(\"w2\")) >= 0");
});

clause(WOLG, "4:rule", "it counts down on YOUR turns even when it is attached to the opponent's character, and destroys that character", () => {
  const b = wolgInPlay("theirs", 1);
  endTurn(b.engine, P1);
  assert.equal(tokensOn(b.engine, b.id("w2")), 1, "the host's controller's turn start does not tick it");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  endTurn(b.engine, P2);
  assert.equal(tokensOn(b.engine, b.id("w2")), 0, "your turn start ticks it");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard", "the opponent's attached character is destroyed (to its owner's discard)");
  assert.ok((b.engine.state.players[P2].discard as string[]).includes(b.id("theirs")), "(b.engine.state.players[P2].discard as string[]).includes(b.id(\"theirs\"))");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "your own character is untouched");
});

// --------------------------------------------------------------------------------------
// Abecedarian Investor
// --------------------------------------------------------------------------------------

function invBoard(extra: CardPlacement[] = [], greed = 2) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "ai", def: printing(INVESTOR), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...extra]
  });
}
const invest = (b: Board, picked: string[] = []) => play(b.engine, P1, b.id("ai"), { selected: { picked: picked.map(b.id) } });

clause(INVESTOR, "0:extraCost", "the pick is optional: declining still deploys it (printed 2/3/2) for its cost of 2 with [g]", () => {
  const b = invBoard([mkMe("c", 2), mkFoe("x", 1)]);
  invest(b);
  assert.equal(zoneOf(b.engine, b.id("ai")), "play");
  assert.equal(b.engine.getStat(b.id("ai"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("ai"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("ai"), "life"), 2);
  assert.equal(readyResources(b.engine, P1), 0, "cost 2 paid");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(INVESTOR, "0:extraCost", "any card in play can be picked: your character, an opponent's character, an item, a location, a resource", () => {
  const mk = () =>
    invBoard([
      mkMe("mineC", 1),
      mkFoe("theirC", 1),
      { key: "it", def: item({ name: "It" }), owner: P2, zone: "play", counters: { token: 1 } },
      { key: "lo", def: location({ name: "Lo" }), owner: P1, zone: "play", counters: { token: 1 } },
      res("rr", P2, { counters: { token: 1 } })
    ]);
  for (const k of ["mineC", "theirC", "it", "lo", "rr"]) {
    const b = mk();
    invest(b, [k]);
    assert.equal(zoneOf(b.engine, b.id("ai")), "play", `${k} pick accepted`);
    assert.equal(tokensOn(b.engine, b.id(k)), 0, `${k} lost its token`);
  }
});

clause(INVESTOR, "0:extraCost", "you may pick only ONE card, and only a card in play: two picks, a hand card, a discard card and a faction are refused", () => {
  const mk = () => invBoard([mkMe("c1", 2), mkMe("c2", 2), { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" }, { key: "inDisc", def: character({ name: "InDisc" }), owner: P1, zone: "discard" }]);
  refused(() => invest(mk(), ["c1", "c2"]), "only one card may be picked");
  const hand = mk();
  refused(() => invest(hand, ["inHand"]), "a card in hand is not in play");
  const disc = mk();
  refused(() => invest(disc, ["inDisc"]), "a card in the discard pile is not in play");
  const fac = mk();
  refused(() => play(fac.engine, P1, fac.id("ai"), { selected: { picked: [factionOf(fac.engine, P2)] } }), "a faction cannot be picked (CR 202.9a)");
  const ok = mk();
  invest(ok, ["c1"]);
  assert.equal(zoneOf(ok.engine, ok.id("ai")), "play", "control");
});

clause(INVESTOR, "0:extraCost", "it costs 2 with [g]: refused with one resource and with two non-greed resources", () => {
  const one = invBoard([], 1);
  refused(() => invest(one), "one resource is short");
  const wrong = invBoard([...bank("rage", 2, P1)], 0);
  refused(() => invest(wrong), "no greed threshold");
  const ok = invBoard([...bank("rage", 1, P1)], 1);
  invest(ok);
  assert.equal(zoneOf(ok.engine, ok.id("ai")), "play", "control: 1 greed + 1 other");
});

clause(INVESTOR, "1:rule", "when it enters play with a pick, one token is removed from the picked card (3 -> 2), and only that card", () => {
  const b = invBoard([mkMe("c", 3), mkFoe("other", 4), { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play", counters: { token: 2 } }]);
  invest(b, ["c"]);
  assert.equal(tokensOn(b.engine, b.id("c")), 2);
  assert.equal(tokensOn(b.engine, b.id("other")), 4, "unpicked cards keep their tokens");
  assert.equal(tokensOn(b.engine, b.id("ally")), 2);
  assert.equal(tokensOn(b.engine, b.id("ai")), 0);
});

clause(INVESTOR, "1:rule", "an opponent's picked card loses one token too", () => {
  const b = invBoard([mkFoe("c", 2)]);
  invest(b, ["c"]);
  assert.equal(tokensOn(b.engine, b.id("c")), 1);
});

clause(INVESTOR, "1:rule", "picking a card without tokens removes nothing (no negative count)", () => {
  const b = invBoard([mkMe("c", 0)]);
  invest(b, ["c"]);
  assert.equal(tokensOn(b.engine, b.id("c")), 0);
  assert.equal(zoneOf(b.engine, b.id("ai")), "play");
});

clause(INVESTOR, "1:rule", "with no pick, no token is removed from anything", () => {
  const b = invBoard([mkMe("c", 2), mkFoe("x", 2)]);
  invest(b);
  assert.equal(tokensOn(b.engine, b.id("c")), 2);
  assert.equal(tokensOn(b.engine, b.id("x")), 2);
});

clause(INVESTOR, "1:rule", "only the entering Investor's own pick matters: another Investor already in play does not remove a second token", () => {
  const b = invBoard([mkMe("c", 3), { key: "ai0", def: printing(INVESTOR), owner: P1, zone: "play" }]);
  invest(b, ["c"]);
  assert.equal(tokensOn(b.engine, b.id("c")), 2, "exactly one token, not two");
});

clause(INVESTOR, "1:rule", "another card entering play does not trigger it (no token removed when a different character is played afterwards)", () => {
  const b = invBoard([mkMe("c", 3), { key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }]);
  invest(b, ["c"]);
  assert.equal(tokensOn(b.engine, b.id("c")), 2);
  play(b.engine, P1, b.id("other"));
  assert.equal(tokensOn(b.engine, b.id("c")), 2, "the Investor's trigger is for itself entering only");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
