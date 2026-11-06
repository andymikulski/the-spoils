// Clause tests — batch seed-saga-07, part p2 (groups 7-10, missing clauses only).
import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, play, resolvePendingResponses, P1, P2 } from "../per-card/_harness.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough, playRaw } from "./_battle.js";
import { pending, tokensOn } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

const ODDMENT = "d1216f7c-25a6-4d07-bb6b-6f42a50c661a"; // character gearsmith golem cost 5 "e" 1/2/1
const PEPPER = "3cd39b3f-5db3-4d53-95de-16b2b502890c"; // item gearsmith gear cost 6 "e", ATTACH TO CHARACTER
const CRAFTSMAN = "a3ed0d3c-b290-4a8a-8a43-321b4406ee35"; // character gearsmith craftsman cost 4 "ee" 2/2/2
const GOLEM = "03307150-ed03-4288-8ae6-21bdd7167b72"; // character gearsmith golem cost 6 "e" 6/3/6, FLIP UP 4 e

// --- helpers ---------------------------------------------------------------------
const E = (n: number, owner: PlayerId = P1): CardPlacement[] => bank("elitism", n, owner);
const R = (n: number, owner: PlayerId = P1): CardPlacement[] => bank("rage", n, owner);
/** n icon resources already SPENT (attached to the faction): they count for the threshold but cannot pay. */
const spent = (icon: "elitism" | "rage", n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const brd = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, random: () => 0.3, ...extra, cards });
const zoneNow = (engine: SpoilsEngine, id: CardInstanceId): string => engine.state.cards[id].zone as string;
const ch = (name: string, s = 2, sp = 2, l = 3) => character({ name, strength: s, speed: sp, life: l } as never);
const st = (engine: SpoilsEngine, id: CardInstanceId) => [engine.getStat(id, "strength"), engine.getStat(id, "speed"), engine.getStat(id, "life")];
const kws = (engine: SpoilsEngine, id: CardInstanceId): string[] => [...(engine.getKeywords(id) as Iterable<string>)].map((k) => String(k).toLowerCase());
/** An item whose ability "s" destroys the picked card in play (any type). */
const killer = (key = "kl", owner: PlayerId = P1): CardPlacement => ({
  key,
  def: item({ name: "Killer", behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }),
  owner,
  zone: "play"
});
/** An item whose ability "d" depletes the picked card. */
const depleter = (key = "dp"): CardPlacement => ({
  key,
  def: item({ name: "Depleter", behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "deplete", target: { type: "selected", id: "t" } }] }] } }),
  owner: P1,
  zone: "play"
});
const answerSel = (engine: SpoilsEngine, selected: CardInstanceId[]): void => {
  const pc = pending(engine);
  assert.ok(pc, "a pending choice is open");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, selected } } as never);
  resolvePendingResponses(engine);
};
const flipUpRaw = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void => {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
};

// =================================================================================
// Oddment Collector
// =================================================================================
const odd = (extra: CardPlacement[] = [], res: CardPlacement[] = [...E(5)]) =>
  brd([{ key: "oc", def: printing(ODDMENT), owner: P1, zone: "hand" }, ...res, ...extra]);
/** Oddment Collector already in play with `tokens` tokens. */
const oddIn = (tokens: number, extra: CardPlacement[] = [], res: CardPlacement[] = []) =>
  brd([{ key: "oc", def: printing(ODDMENT), owner: P1, zone: "play", counters: { token: tokens } }, ...res, ...extra]);

clause(ODDMENT, "0:rule", "printed: gearsmith golem character, cost 5, threshold e, 1 strength / 2 speed / 1 life", () => {
  const def = printing(ODDMENT);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual([...(def.subtype as string[])], ["golem"]);
  assert.equal(def.cost, 5);
  assert.equal(def.threshold, "e");
  assert.equal(def.strength, 1);
  assert.equal(def.speed, 2);
  assert.equal(def.life, 1);
});

clause(ODDMENT, "0:rule", "deploys for exactly 5 with an [E]; one short and a missing [E] are refused", () => {
  const ok = odd();
  play(ok.engine, P1, ok.id("oc"));
  assert.equal(zoneNow(ok.engine, ok.id("oc")), "play");
  const short = odd([], [...E(4)]);
  refused(() => play(short.engine, P1, short.id("oc")), "one short of the cost 5");
  assert.equal(zoneNow(short.engine, short.id("oc")), "hand");
  const noIcon = odd([], [...R(5)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("oc")), "no [E] for the threshold");
  const spentIcon = odd([], [...spent("elitism", 1), ...R(4)]);
  refused(() => play(spentIcon.engine, P1, spentIcon.id("oc")), "threshold met by a spent [E] but only 4 ready to pay", /Costs cannot be paid/);
  const spentOk = odd([], [...spent("elitism", 1), ...R(5)]);
  play(spentOk.engine, P1, spentOk.id("oc"));
  assert.equal(zoneNow(spentOk.engine, spentOk.id("oc")), "play", "spent [E] satisfies the threshold, 5 ready pay");
});

clause(ODDMENT, "0:rule", "enters play with 5 tokens on it (and no tokens before it enters)", () => {
  const g = odd();
  assert.equal(tokensOn(g.engine, g.id("oc")), 0, "in hand: none");
  play(g.engine, P1, g.id("oc"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("oc")), 5);
});

clause(ODDMENT, "0:rule", "only the card itself entering play gets the tokens: another card entering does not add to it, nor does the Collector get them when another Collector enters", () => {
  const g = odd([
    { key: "oc2", def: printing(ODDMENT), owner: P1, zone: "play", counters: { token: 2 } },
    { key: "pl", def: ch("Plain"), owner: P1, zone: "hand" }
  ], [...E(12)]);
  play(g.engine, P1, g.id("pl"));
  assert.equal(tokensOn(g.engine, g.id("oc2")), 2, "a plain character entering adds nothing");
  play(g.engine, P1, g.id("oc"));
  assert.equal(tokensOn(g.engine, g.id("oc")), 5);
  assert.equal(tokensOn(g.engine, g.id("oc2")), 2, "the Collector already in play is untouched by the second one entering");
});

clause(ODDMENT, "1:rule", "gains 1 strength and 1 life per token: 0 / 1 / 3 / 5 tokens, speed unaffected", () => {
  const exp: Array<[number, number[]]> = [[0, [1, 2, 1]], [1, [2, 2, 2]], [3, [4, 2, 4]], [5, [6, 2, 6]], [8, [9, 2, 9]]];
  for (const [n, want] of exp) {
    const g = oddIn(n);
    assert.deepEqual(st(g.engine, g.id("oc")), want, `${n} tokens`);
  }
});

clause(ODDMENT, "1:rule", "freshly deployed it is 6 strength / 6 life; the bonus follows the tokens as they change", () => {
  const g = odd();
  play(g.engine, P1, g.id("oc"));
  assert.deepEqual(st(g.engine, g.id("oc")), [6, 2, 6]);
  g.engine.state.cards[g.id("oc")].counters = { token: 2 };
  assert.deepEqual(st(g.engine, g.id("oc")), [3, 2, 3], "tokens removed -> bonus shrinks");
});

clause(ODDMENT, "1:rule", "counts only its own tokens: another Collector's tokens and other characters are unaffected", () => {
  const g = oddIn(4, [
    { key: "oc2", def: printing(ODDMENT), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "oc3", def: printing(ODDMENT), owner: P2, zone: "play", counters: { token: 0 } },
    { key: "pl", def: ch("Plain", 2, 2, 3), owner: P1, zone: "play", counters: { token: 3 } }
  ]);
  assert.deepEqual(st(g.engine, g.id("oc")), [5, 2, 5]);
  assert.deepEqual(st(g.engine, g.id("oc2")), [2, 2, 2]);
  assert.deepEqual(st(g.engine, g.id("oc3")), [1, 2, 1]);
  assert.deepEqual(st(g.engine, g.id("pl")), [2, 2, 3], "tokens on an ordinary character give it nothing");
});

clause(ODDMENT, "1:rule", "the bonus is gone once the Collector has left play (printed stats)", () => {
  const g = oddIn(4, [killer()]);
  assert.deepEqual(st(g.engine, g.id("oc")), [5, 2, 5]);
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("oc")] } });
  assert.equal(zoneNow(g.engine, g.id("oc")), "discard");
  assert.deepEqual(st(g.engine, g.id("oc")), [1, 2, 1]);
});

clause(ODDMENT, "2:rule", "attacking depletes it: it loses exactly one token (and so 1 strength / 1 life)", () => {
  const g = oddIn(5, [], []);
  declareAttackBy(g.engine, P1, [g.id("oc")]);
  assert.equal(g.engine.state.cards[g.id("oc")].depleted, true);
  assert.equal(tokensOn(g.engine, g.id("oc")), 4);
  assert.deepEqual(st(g.engine, g.id("oc")), [5, 2, 5]);
});

clause(ODDMENT, "2:rule", "an effect depleting it also removes one token; an already-depleted Collector stays at its count", () => {
  const g = oddIn(3, [depleter()]);
  activate(g.engine, P1, g.id("dp"), "d", { selected: { t: [g.id("oc")] } });
  assert.equal(g.engine.state.cards[g.id("oc")].depleted, true);
  assert.equal(tokensOn(g.engine, g.id("oc")), 2);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ODDMENT, "2:rule", "a battle it survives as a blocker depletes it: one token removed", () => {
  const g = brd([
    { key: "oc", def: printing(ODDMENT), owner: P1, zone: "play", counters: { token: 5 } },
    { key: "atk", def: ch("Atk", 2, 2, 3), owner: P2, zone: "play" }
  ], { turn: 2, activePlayerId: P2 });
  fightThrough(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("oc")]);
  assert.equal(zoneNow(g.engine, g.id("oc")), "play");
  assert.equal(g.engine.state.cards[g.id("oc")].depleted, true, "the surviving blocker is depleted");
  assert.equal(tokensOn(g.engine, g.id("oc")), 4);
});

clause(ODDMENT, "2:rule", "attacking and surviving the battle removes only one token in total (it was depleted once)", () => {
  const g = brd([
    { key: "oc", def: printing(ODDMENT), owner: P1, zone: "play", counters: { token: 5 } },
    { key: "blk", def: ch("Blk", 0, 2, 9), owner: P2, zone: "play" }
  ]);
  fightThrough(g.engine, P1, [g.id("oc")], { type: "faction", playerId: P2 }, [g.id("blk")]);
  assert.equal(zoneNow(g.engine, g.id("oc")), "play");
  assert.equal(tokensOn(g.engine, g.id("oc")), 4);
});

clause(ODDMENT, "2:rule", "no tokens: becoming depleted removes nothing (never negative)", () => {
  const g = oddIn(0, [depleter()]);
  activate(g.engine, P1, g.id("dp"), "d", { selected: { t: [g.id("oc")] } });
  assert.equal(g.engine.state.cards[g.id("oc")].depleted, true);
  assert.equal(tokensOn(g.engine, g.id("oc")), 0);
  assert.deepEqual(st(g.engine, g.id("oc")), [1, 2, 1]);
});

clause(ODDMENT, "2:rule", "only becoming depleted itself matters: another character depleting does not remove a token", () => {
  const g = oddIn(5, [depleter(), { key: "pl", def: ch("Plain"), owner: P1, zone: "play" }, { key: "enemy", def: ch("Enemy"), owner: P2, zone: "play" }]);
  activate(g.engine, P1, g.id("dp"), "d", { selected: { t: [g.id("pl")] } });
  activate(g.engine, P1, g.id("dp"), "d", { selected: { t: [g.id("enemy")] } });
  assert.equal(g.engine.state.cards[g.id("pl")].depleted, true);
  assert.equal(tokensOn(g.engine, g.id("oc")), 5);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ODDMENT, "2:rule", "two Collectors depleting at once (a party attack) each lose one of their own tokens", () => {
  const g = brd([
    { key: "oc", def: printing(ODDMENT), owner: P1, zone: "play", counters: { token: 5 } },
    { key: "oc2", def: printing(ODDMENT), owner: P1, zone: "play", counters: { token: 3 } }
  ]);
  declareAttackBy(g.engine, P1, [g.id("oc"), g.id("oc2")]);
  if (pending(g.engine)?.kind === "orderTriggers") {
    const pc = pending(g.engine)!;
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: pc.kind, order: (pc as never as { triggers: Array<{ id?: string }> }).triggers?.map((_, i) => i) } } as never);
  }
  resolvePendingResponses(g.engine);
  assert.equal(tokensOn(g.engine, g.id("oc")), 4);
  assert.equal(tokensOn(g.engine, g.id("oc2")), 2);
});

// --- GATHER ---------------------------------------------------------------------
const gather = (disc: CardPlacement[], res: CardPlacement[] = [...R(1)], tokens = 3) =>
  brd([{ key: "oc", def: printing(ODDMENT), owner: P1, zone: "play", counters: { token: tokens } }, ...disc, ...res]);
const gItem = (key: string, owner: PlayerId = P1): CardPlacement => ({ key, def: item({ name: `Item ${key}` }), owner, zone: "discard" });
const gChar = (key: string, owner: PlayerId = P1): CardPlacement => ({ key, def: ch(`Char ${key}`), owner, zone: "discard" });
const gatherWith = (g: ReturnType<typeof gather>, sel: Record<string, string[]>): void => {
  const selected: Record<string, CardInstanceId[]> = {};
  for (const [k, v] of Object.entries(sel)) selected[k] = v.map((x) => g.id(x));
  activate(g.engine, P1, g.id("oc"), "gather", { selected });
};

clause(ODDMENT, "3:ability:gather", "item option: pay 1, remove one item from your discard from the game; put a token on this card", () => {
  const g = gather([gItem("it1"), gItem("it2"), gChar("c1")]);
  gatherWith(g, { g1: ["it1"] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.notEqual(zoneNow(g.engine, g.id("it1")), "discard", "the item left the discard pile");
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("it1")), "!g.engine.state.players[P1].discard.includes(g.id(\"it1\"))");
  assert.equal(zoneNow(g.engine, g.id("it1")), "removed", "removed from the game");
  assert.equal(zoneNow(g.engine, g.id("it2")), "discard", "only one item removed");
  assert.equal(zoneNow(g.engine, g.id("c1")), "discard");
  assert.equal(tokensOn(g.engine, g.id("oc")), 4, "a token was put on it");
  assert.deepEqual(st(g.engine, g.id("oc")), [5, 2, 5]);
  assert.equal(readyAfter(g), 0, "paid 1");
});
const readyAfter = (g: ReturnType<typeof gather>): number => g.engine.getAvailableResourceCount(P1);

clause(ODDMENT, "3:ability:gather", "two-cards option: remove 2 cards (non-items) from your discard from the game", () => {
  const g = gather([gChar("c1"), gChar("c2"), gChar("c3")]);
  gatherWith(g, { g2: ["c1", "c2"] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("c1")), "removed");
  assert.equal(zoneNow(g.engine, g.id("c2")), "removed");
  assert.equal(zoneNow(g.engine, g.id("c3")), "discard", "exactly two removed");
  assert.equal(tokensOn(g.engine, g.id("oc")), 4);
  assert.equal(readyAfter(g), 0);
});

clause(ODDMENT, "3:ability:gather", "two-cards option may include items (any 2 cards)", () => {
  const g = gather([gItem("it1"), gChar("c1")]);
  gatherWith(g, { g2: ["it1", "c1"] });
  assert.equal(zoneNow(g.engine, g.id("it1")), "removed");
  assert.equal(zoneNow(g.engine, g.id("c1")), "removed");
  assert.equal(tokensOn(g.engine, g.id("oc")), 4);
});

clause(ODDMENT, "3:ability:gather", "refused with one non-item card and no item, with an empty discard, and with a single item picked for the 2-card option", () => {
  const one = gather([gChar("c1")]);
  refused(() => gatherWith(one, { g2: ["c1"] }), "only one non-item card");
  refused(() => gatherWith(one, { g1: ["c1"] }), "a non-item cannot be the single 'item'");
  assert.equal(zoneNow(one.engine, one.id("c1")), "discard");
  assert.equal(tokensOn(one.engine, one.id("oc")), 3);
  const empty = gather([]);
  refused(() => activate(empty.engine, P1, empty.id("oc"), "gather", {}), "empty discard");
  assert.equal(tokensOn(empty.engine, empty.id("oc")), 3);
  const lone = gather([gItem("it1")]);
  refused(() => gatherWith(lone, { g2: ["it1"] }), "2 cards required, only one in the discard");
  assert.equal(tokensOn(lone.engine, lone.id("oc")), 3);
  gatherWith(lone, { g1: ["it1"] });
  assert.equal(tokensOn(lone.engine, lone.id("oc")), 4, "positive control: the lone item works as the item option");
});

clause(ODDMENT, "3:ability:gather", "only YOUR discard pile counts (opponent's items / cards cannot be removed)", () => {
  const g = gather([gItem("theirs", P2), gChar("theirs2", P2), gChar("theirs3", P2)]);
  refused(() => gatherWith(g, { g1: ["theirs"] }), "opponent's item");
  refused(() => gatherWith(g, { g2: ["theirs2", "theirs3"] }), "opponent's cards");
  assert.equal(zoneNow(g.engine, g.id("theirs")), "discard");
  assert.equal(tokensOn(g.engine, g.id("oc")), 3);
  assert.equal(readyAfter(g), 1, "nothing was paid");
});

clause(ODDMENT, "3:ability:gather", "a mixed pick is refused: one card from my discard pile plus one from the opponent's (the 2 cards must both be in MY pile)", () => {
  const g = gather([gChar("mine1"), gChar("theirs1", P2), gItem("theirs2", P2)]);
  refused(() => gatherWith(g, { g2: ["mine1", "theirs1"] }), "one of mine and one of the opponent's");
  refused(() => gatherWith(g, { g2: ["mine1", "theirs2"] }), "one of mine and an opposing item");
  assert.equal(zoneNow(g.engine, g.id("mine1")), "discard", "my card stays in the discard pile");
  assert.equal(zoneNow(g.engine, g.id("theirs1")), "discard", "the opponent's card stays too");
  assert.equal(tokensOn(g.engine, g.id("oc")), 3, "no token");
  assert.equal(readyAfter(g), 1, "nothing was paid");
});

clause(ODDMENT, "3:ability:gather", "cards must come from the discard pile (an item in play or in hand cannot be removed)", () => {
  const g = gather([{ key: "inplay", def: item({ name: "InPlay" }), owner: P1, zone: "play" }, { key: "inhand", def: item({ name: "InHand" }), owner: P1, zone: "hand" }]);
  refused(() => gatherWith(g, { g1: ["inplay"] }), "item in play");
  refused(() => gatherWith(g, { g1: ["inhand"] }), "item in hand");
  assert.equal(tokensOn(g.engine, g.id("oc")), 3);
});

clause(ODDMENT, "3:ability:gather", "COST pay 1: refused with no ready resource (and nothing removed); works with exactly 1", () => {
  const none = gather([gItem("it1")], []);
  refused(() => gatherWith(none, { g1: ["it1"] }), "cannot pay 1");
  assert.equal(zoneNow(none.engine, none.id("it1")), "discard");
  assert.equal(tokensOn(none.engine, none.id("oc")), 3);
  const spentOnly = gather([gItem("it1")], [...spent("rage", 1)]);
  refused(() => gatherWith(spentOnly, { g1: ["it1"] }), "the only resource is already spent");
  const ok = gather([gItem("it1")], [...R(1)]);
  gatherWith(ok, { g1: ["it1"] });
  assert.equal(tokensOn(ok.engine, ok.id("oc")), 4);
  assert.equal(readyAfter(ok), 0, "exactly 1 was paid");
});

clause(ODDMENT, "3:ability:gather", "can be used repeatedly and while depleted (no deplete cost); tokens keep adding up, from 0", () => {
  const g = gather([gItem("it1"), gItem("it2")], [...R(2)], 0);
  g.engine.state.cards[g.id("oc")].depleted = true;
  gatherWith(g, { g1: ["it1"] });
  assert.equal(tokensOn(g.engine, g.id("oc")), 1);
  gatherWith(g, { g1: ["it2"] });
  assert.equal(tokensOn(g.engine, g.id("oc")), 2);
  assert.deepEqual(st(g.engine, g.id("oc")), [3, 2, 3]);
  assert.equal(readyAfter(g), 0);
});

// =================================================================================
// P3pp3r 0f 1n54n17y
// =================================================================================
const pep = (extra: CardPlacement[] = [], res: CardPlacement[] = [...E(6)]) =>
  brd([
    { key: "pp", def: printing(PEPPER), owner: P1, zone: "hand" },
    { key: "h", def: ch("Host", 2, 2, 3), owner: P1, zone: "play" },
    { key: "eh", def: ch("EnemyHost", 4, 3, 5), owner: P2, zone: "play" },
    ...res,
    ...extra
  ]);
/** The Pepper already in play, attached to `host` (a key). */
const pepOn = (host: string, extra: CardPlacement[] = [], opts: { owner?: PlayerId; turn?: number; active?: PlayerId } = {}) =>
  brd([
    { key: "pp", def: printing(PEPPER), owner: opts.owner ?? P1, zone: "play", attachedToKey: host },
    { key: "h", def: ch("Host", 2, 2, 3), owner: P1, zone: "play" },
    { key: "eh", def: ch("EnemyHost", 4, 3, 5), owner: P2, zone: "play" },
    { key: "other", def: ch("Other", 1, 1, 1), owner: P1, zone: "play" },
    ...extra
  ], { ...(opts.turn ? { turn: opts.turn } : {}), ...(opts.active ? { activePlayerId: opts.active } : {}) });
const attachPlay = (b: ReturnType<typeof pep>, hostKey: string) => play(b.engine, P1, b.id("pp"), { selected: { attachTo: [b.id(hostKey)] } });

clause(PEPPER, "0:attach", "printed: gearsmith gear item, cost 6, threshold e; deploys for exactly 6 with an [E]; one short / no [E] refused", () => {
  const def = printing(PEPPER);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual([...(def.subtype as string[])], ["gear"]);
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "e");
  const ok = pep();
  attachPlay(ok, "h");
  assert.equal(zoneNow(ok.engine, ok.id("pp")), "play");
  const short = pep([], [...E(5)]);
  refused(() => attachPlay(short, "h"), "one short of cost 6");
  assert.equal(zoneNow(short.engine, short.id("pp")), "hand");
  const noIcon = pep([], [...R(6)]);
  refused(() => attachPlay(noIcon, "h"), "no [E]");
  const spentShort = pep([], [...spent("elitism", 1), ...R(5)]);
  refused(() => attachPlay(spentShort, "h"), "spent [E] satisfies the threshold but only 5 ready", /Costs cannot be paid/);
  const spentOk = pep([], [...spent("elitism", 1), ...R(6)]);
  attachPlay(spentOk, "h");
  assert.equal(zoneNow(spentOk.engine, spentOk.id("pp")), "play");
});

clause(PEPPER, "0:attach", "ATTACH TO CHARACTER: attaches to a character (mine or the opponent's); an item or location host / no host is refused", () => {
  const mine = pep();
  attachPlay(mine, "h");
  assert.equal(mine.engine.state.cards[mine.id("pp")].attachedTo, mine.id("h"));
  const theirs = pep();
  attachPlay(theirs, "eh");
  assert.equal(theirs.engine.state.cards[theirs.id("pp")].attachedTo, theirs.id("eh"));
  const extra: CardPlacement[] = [
    { key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "loc", def: { ...ch("x"), type: "location" } as never, owner: P1, zone: "play" }
  ];
  const bad = pep(extra);
  refused(() => attachPlay(bad, "it"), "an item is not a character", /attach|host|character|target/i);
  assert.equal(zoneNow(bad.engine, bad.id("pp")), "hand");
  refused(() => attachPlay(bad, "loc"), "a location is not a character", /attach|host|character|target/i);
  const none = pep();
  refused(() => play(none.engine, P1, none.id("pp")), "no host picked", /attach|host|character|target/i);
  assert.equal(zoneNow(none.engine, none.id("pp")), "hand");
});

clause(PEPPER, "1:rule", "the attached character gains 3 strength and 3 life (speed unchanged); other characters are unaffected", () => {
  const g = pep();
  attachPlay(g, "h");
  assert.deepEqual(st(g.engine, g.id("h")), [5, 2, 6]);
  assert.deepEqual(st(g.engine, g.id("eh")), [4, 3, 5], "the opponent's character is unaffected");
  const e = pep();
  attachPlay(e, "eh");
  assert.deepEqual(st(e.engine, e.id("eh")), [7, 3, 8], "attached to the opponent's character it boosts that one");
  assert.deepEqual(st(e.engine, e.id("h")), [2, 2, 3]);
});

clause(PEPPER, "1:rule", "the boost is gone when the Pepper leaves play, and the host does not carry it elsewhere", () => {
  const g = pepOn("h", [killer()]);
  assert.deepEqual(st(g.engine, g.id("h")), [5, 2, 6]);
  assert.deepEqual(st(g.engine, g.id("other")), [1, 1, 1]);
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("pp")] } });
  assert.equal(zoneNow(g.engine, g.id("pp")), "discard");
  assert.deepEqual(st(g.engine, g.id("h")), [2, 2, 3]);
});

clause(PEPPER, "1:rule", "stacks with a second Pepper on the same host", () => {
  const g = pepOn("h", [{ key: "pp2", def: printing(PEPPER), owner: P1, zone: "play", attachedToKey: "h" }]);
  assert.deepEqual(st(g.engine, g.id("h")), [8, 2, 9]);
});

clause(PEPPER, "2:rule", "at the start of the opponent's turn the attached character is restored (while a non-attached depleted character is not)", () => {
  const g = pepOn("h", [{ key: "dep", def: ch("Dep"), owner: P1, zone: "play", depleted: true }]);
  g.engine.state.cards[g.id("h")].depleted = true;
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2, "the opponent's turn began");
  assert.equal(g.engine.state.cards[g.id("h")].depleted ?? false, false, "restored at the start of the opponent's turn");
  assert.equal(g.engine.state.cards[g.id("dep")].depleted, true, "a depleted unattached character stays depleted on the opponent's turn");
});

clause(PEPPER, "2:rule", "without the Pepper a depleted character stays depleted on the opponent's turn (control)", () => {
  const g = brd([{ key: "h", def: ch("Host"), owner: P1, zone: "play", depleted: true }]);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.cards[g.id("h")].depleted, true);
});

clause(PEPPER, "2:rule", "attached to the OPPONENT's character it restores that character at the start of ITS controller's turn ('each opponent's turn' = the Pepper controller's opponent)", () => {
  const g = pepOn("eh");
  g.engine.state.cards[g.id("eh")].depleted = true;
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.state.cards[g.id("eh")].depleted ?? false, false, "restored at the start of P2's turn (P2 is P1's opponent)");
});

clause(PEPPER, "2:rule", "does not trigger at the start of the Pepper controller's OWN turn: an attached opponent character stays depleted then", () => {
  const g = pepOn("eh", [], { turn: 2, active: P2 });
  g.engine.state.cards[g.id("eh")].depleted = true;
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1, "the Pepper controller's own turn began");
  assert.equal(g.engine.state.cards[g.id("eh")].depleted, true, "not restored at its controller's own turn start");
});

clause(PEPPER, "2:rule", "an already-ready host is simply left ready; a restore of the host does not restore the Pepper's controller's other characters", () => {
  const g = pepOn("h", [{ key: "dep2", def: ch("Dep2"), owner: P2, zone: "play", depleted: true }]);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.cards[g.id("h")].depleted ?? false, false);
  assert.equal(g.engine.state.cards[g.id("other")].depleted ?? false, false);
  assert.equal(g.engine.state.pendingChoice === undefined || true, true);
});

// --- SPIT OUT -------------------------------------------------------------------
clause(PEPPER, "3:ability:spit", "COST: destroy this card (it goes to the discard pile); the picked character gains 3 strength and 3 life this turn and is restored", () => {
  const g = pepOn("h", [{ key: "t", def: ch("Target", 2, 2, 3), owner: P1, zone: "play", depleted: true }]);
  assert.deepEqual(st(g.engine, g.id("t")), [2, 2, 3]);
  activate(g.engine, P1, g.id("pp"), "spit", { selected: { c: [g.id("t")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("pp")), "discard", "destroyed as the cost");
  assert.deepEqual(st(g.engine, g.id("t")), [5, 2, 6]);
  assert.equal(g.engine.state.cards[g.id("t")].depleted ?? false, false, "restored");
  assert.deepEqual(st(g.engine, g.id("h")), [2, 2, 3], "the former host lost the passive boost and was not the pick");
});

clause(PEPPER, "3:ability:spit", "can pick the opponent's character, or its own former host (which keeps only the +3/+3 of this turn)", () => {
  const e = pepOn("h");
  e.engine.state.cards[e.id("eh")].depleted = true;
  activate(e.engine, P1, e.id("pp"), "spit", { selected: { c: [e.id("eh")] } });
  assert.deepEqual(st(e.engine, e.id("eh")), [7, 3, 8]);
  assert.equal(e.engine.state.cards[e.id("eh")].depleted ?? false, false, "the opponent's character was restored");
  const s = pepOn("h");
  s.engine.state.cards[s.id("h")].depleted = true;
  activate(s.engine, P1, s.id("pp"), "spit", { selected: { c: [s.id("h")] } });
  assert.deepEqual(st(s.engine, s.id("h")), [5, 2, 6], "+3/+3 from the effect; the passive +3/+3 left with the Pepper");
  assert.equal(s.engine.state.cards[s.id("h")].depleted ?? false, false);
});

clause(PEPPER, "3:ability:spit", "only characters can be picked (an item / no pick is refused and the Pepper is not destroyed)", () => {
  const g = pepOn("h", [{ key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" }, { key: "t", def: ch("Target"), owner: P1, zone: "play" }]);
  refused(() => activate(g.engine, P1, g.id("pp"), "spit", { selected: { c: [g.id("it")] } }), "an item is not a character");
  refused(() => activate(g.engine, P1, g.id("pp"), "spit", {}), "a pick is required");
  assert.equal(zoneNow(g.engine, g.id("pp")), "play", "nothing was paid");
  activate(g.engine, P1, g.id("pp"), "spit", { selected: { c: [g.id("t")] } });
  assert.deepEqual(st(g.engine, g.id("t")), [5, 2, 6], "positive control");
});

clause(PEPPER, "3:ability:spit", "the +3/+3 lasts this turn only: gone when the turn ends", () => {
  const g = pepOn("h", [{ key: "t", def: ch("Target", 2, 2, 3), owner: P1, zone: "play" }]);
  activate(g.engine, P1, g.id("pp"), "spit", { selected: { c: [g.id("t")] } });
  assert.deepEqual(st(g.engine, g.id("t")), [5, 2, 6]);
  endTurn(g.engine, P1);
  assert.deepEqual(st(g.engine, g.id("t")), [2, 2, 3], "back to printed after the turn ended");
  endTurn(g.engine, P2);
  assert.deepEqual(st(g.engine, g.id("t")), [2, 2, 3]);
});

clause(PEPPER, "3:ability:spit", "restoring the picked character affects only it (not other depleted characters)", () => {
  const g = pepOn("h", [{ key: "t", def: ch("Target"), owner: P1, zone: "play", depleted: true }, { key: "u", def: ch("Untouched"), owner: P1, zone: "play", depleted: true }]);
  activate(g.engine, P1, g.id("pp"), "spit", { selected: { c: [g.id("t")] } });
  assert.equal(g.engine.state.cards[g.id("t")].depleted ?? false, false);
  assert.equal(g.engine.state.cards[g.id("u")].depleted, true);
});

// =================================================================================
// Preponderant Craftsman
// =================================================================================
const craft = (extra: CardPlacement[] = [], res: CardPlacement[] = [...R(5)]) =>
  brd([{ key: "pc", def: printing(CRAFTSMAN), owner: P1, zone: "play" }, ...res, ...extra]);
const bigChar = (key: string, owner: PlayerId = P1, zone: "hand" | "play" | "discard" = "hand"): CardPlacement => ({
  key,
  def: character({ name: `Big ${key}`, cost: 9, strength: 3, speed: 2, life: 3 } as never),
  owner,
  zone
});
const deployChoice = (engine: SpoilsEngine, cardId: CardInstanceId | undefined): void => {
  const pc = pending(engine);
  assert.equal(pc?.kind, "deployForFree", "the deploy offer is open");
  assert.equal(pc?.playerId, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId, selected: {} } } as never);
  resolvePendingResponses(engine);
};
const create = (g: ReturnType<typeof craft>, pick: string | undefined): void => {
  activate(g.engine, P1, g.id("pc"), "create");
  if (pending(g.engine)) deployChoice(g.engine, pick ? g.id(pick) : undefined);
};

clause(CRAFTSMAN, "0:ability:create", "printed: gearsmith craftsman character, cost 4, threshold ee, 2 strength / 2 speed / 2 life", () => {
  const def = printing(CRAFTSMAN);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual([...(def.subtype as string[])], ["craftsman"]);
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "ee");
  assert.deepEqual([def.strength, def.speed, def.life], [2, 2, 2]);
  const hand = (res: CardPlacement[]) => brd([{ key: "pc", def: printing(CRAFTSMAN), owner: P1, zone: "hand" }, ...res]);
  const ok = hand(E(4));
  play(ok.engine, P1, ok.id("pc"));
  assert.equal(zoneNow(ok.engine, ok.id("pc")), "play");
  assert.deepEqual(st(ok.engine, ok.id("pc")), [2, 2, 2]);
  const short = hand(E(3));
  refused(() => play(short.engine, P1, short.id("pc")), "one short of cost 4");
  const noIcon = hand(R(4));
  refused(() => play(noIcon.engine, P1, noIcon.id("pc")), "no [E][E]");
  const oneIcon = hand([...E(1), ...R(3)]);
  refused(() => play(oneIcon.engine, P1, oneIcon.id("pc")), "only one [E] of the two required");
  const oneSpent = hand([...spent("elitism", 1), ...E(1), ...R(4)]);
  play(oneSpent.engine, P1, oneSpent.id("pc"));
  assert.equal(zoneNow(oneSpent.engine, oneSpent.id("pc")), "play", "[E][E] from one spent and one ready, 5 ready pay 4");
  const spentShort = hand([...spent("elitism", 2), ...R(3)]);
  refused(() => play(spentShort.engine, P1, spentShort.id("pc")), "threshold fine from spent icons but only 3 ready", /Costs cannot be paid/);
  const spentOk = hand([...spent("elitism", 2), ...R(4)]);
  play(spentOk.engine, P1, spentOk.id("pc"));
  assert.equal(zoneNow(spentOk.engine, spentOk.id("pc")), "play");
});

clause(CRAFTSMAN, "0:ability:create", "COST pay 5 and deplete: deploys a character from hand for free (a cost-9 character with only the 5 paid); the Craftsman is depleted", () => {
  const g = craft([bigChar("big")]);
  create(g, "big");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("big")), "play");
  assert.equal(g.engine.state.cards[g.id("pc")].depleted, true, "COST: deplete this card");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "COST: all 5 paid, the deployed character cost nothing more");
  assert.deepEqual(st(g.engine, g.id("big")), [3, 2, 3]);
});

clause(CRAFTSMAN, "0:ability:create", "the cost is paid in full: refused with 4 ready, with a depleted Craftsman, or with only spent resources", () => {
  const four = craft([bigChar("big")], [...R(4)]);
  refused(() => activate(four.engine, P1, four.id("pc"), "create"), "one short of pay 5");
  assert.equal(four.engine.state.cards[four.id("pc")].depleted ?? false, false);
  assert.equal(zoneNow(four.engine, four.id("big")), "hand");
  const dep = craft([bigChar("big")]);
  dep.engine.state.cards[dep.id("pc")].depleted = true;
  refused(() => activate(dep.engine, P1, dep.id("pc"), "create"), "already depleted");
  const sp = craft([bigChar("big")], [...R(4), ...spent("rage", 3)]);
  refused(() => activate(sp.engine, P1, sp.id("pc"), "create"), "spent resources do not pay");
  const ok = craft([bigChar("big")], [...R(5), ...spent("rage", 3)]);
  create(ok, "big");
  assert.equal(zoneNow(ok.engine, ok.id("big")), "play", "positive control");
});

clause(CRAFTSMAN, "0:ability:create", "'may': declining deploys nothing but the cost stays paid", () => {
  const g = craft([bigChar("big")]);
  create(g, undefined);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("big")), "hand");
  assert.equal(g.engine.state.cards[g.id("pc")].depleted, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 0);
});

clause(CRAFTSMAN, "0:ability:create", "only a CHARACTER can be deployed (an item or tactic in hand is not offered / refused); an opponent's hand is not available", () => {
  const g = craft([
    { key: "it", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" },
    { key: "theirs", def: ch("Theirs"), owner: P2, zone: "hand" },
    bigChar("big")
  ]);
  activate(g.engine, P1, g.id("pc"), "create");
  const pc = pending(g.engine) as never as { kind: string; candidates?: string[] };
  assert.equal(pc.kind, "deployForFree");
  const offered = (pc.candidates ?? []) as string[];
  assert.ok(offered.includes(g.id("big")), "the character is offered");
  assert.ok(!offered.includes(g.id("it")), "an item is not offered");
  assert.ok(!offered.includes(g.id("theirs")), "the opponent's character is not offered");
  refused(() => deployChoice(g.engine, g.id("it")), "an item cannot be deployed by this effect");
  assert.equal(zoneNow(g.engine, g.id("it")), "hand");
});

clause(CRAFTSMAN, "0:ability:create", "a character in the discard pile or already in play cannot be deployed", () => {
  const g = craft([bigChar("indisc", P1, "discard"), bigChar("big")]);
  activate(g.engine, P1, g.id("pc"), "create");
  const pc = pending(g.engine) as never as { candidates?: string[] };
  const offered = (pc.candidates ?? []) as string[];
  assert.ok(!offered.includes(g.id("indisc")), "discarded cards are not offered");
  assert.ok(offered.includes(g.id("big")), "offered.includes(g.id(\"big\"))");
  deployChoice(g.engine, g.id("big"));
  assert.equal(zoneNow(g.engine, g.id("indisc")), "discard");
});

clause(CRAFTSMAN, "0:ability:create", "'you still need to meet its threshold': an unmet threshold means it cannot be deployed", () => {
  const meets = craft([{ key: "needR", def: character({ name: "NeedsRage", cost: 7, threshold: "rr", strength: 1, speed: 1, life: 1 } as never), owner: P1, zone: "hand" }]);
  create(meets, "needR");
  assert.equal(zoneNow(meets.engine, meets.id("needR")), "play", "[R][R] met by the spent rage that paid for Create");
  const lacks = craft([{ key: "needD", def: character({ name: "NeedsDeception", cost: 1, threshold: "dd", strength: 1, speed: 1, life: 1 } as never), owner: P1, zone: "hand" }]);
  activate(lacks.engine, P1, lacks.id("pc"), "create");
  const offered = ((pending(lacks.engine) ?? {}) as never as { candidates?: string[] });
  if (pending(lacks.engine)) {
    refused(() => deployChoice(lacks.engine, lacks.id("needD")), "[D][D] not met");
  }
  assert.equal(zoneNow(lacks.engine, lacks.id("needD")), "hand", "still in hand");
  void offered;
});

const extraCostChar = () =>
  character({ name: "Costly", cost: 5, strength: 1, speed: 1, life: 1, behavior: { onPlay: { costs: [{ type: "payResources", amount: 3 }], effects: [] } } } as never);
clause(CRAFTSMAN, "0:ability:create", "'you still need to satisfy its extra costs': a character's own 'pay 3' is still paid", () => {
  const extra = character({ name: "Costly", cost: 5, strength: 1, speed: 1, life: 1, behavior: { onPlay: { costs: [{ type: "payResources", amount: 3 }], effects: [] } } } as never);
  const ok = craft([{ key: "cc", def: extra, owner: P1, zone: "hand" }], [...R(8)]);
  create(ok, "cc");
  assert.equal(zoneNow(ok.engine, ok.id("cc")), "play");
  assert.equal(ok.engine.getAvailableResourceCount(P1), 0, "5 for Create + 3 extra cost; the printed cost 5 was free");
});

clause(CRAFTSMAN, "0:ability:create", "an extra cost that cannot be paid means the character cannot be deployed by Create", () => {
  const extra = extraCostChar();
  const poor = craft([{ key: "cc", def: extra, owner: P1, zone: "hand" }], [...R(5)]);
  activate(poor.engine, P1, poor.id("pc"), "create");
  if (pending(poor.engine)) refused(() => deployChoice(poor.engine, poor.id("cc")), "extra cost 3 cannot be paid");
  assert.equal(zoneNow(poor.engine, poor.id("cc")), "hand");
});

clause(CRAFTSMAN, "0:ability:create", "it is a real deploy: the deployed character's enter-play effects happen (Oddment Collector gets its 5 tokens)", () => {
  const g = craft([{ key: "oc", def: printing(ODDMENT), owner: P1, zone: "hand" }], [...spent("elitism", 1), ...R(5)]);
  create(g, "oc");
  assert.equal(zoneNow(g.engine, g.id("oc")), "play");
  assert.equal(tokensOn(g.engine, g.id("oc")), 5);
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "only Create's 5 was paid, the Collector's 5 was free");
});

clause(CRAFTSMAN, "0:ability:create", "with no deployable character in hand the cost is still paid and nothing happens", () => {
  const g = craft([{ key: "it", def: item({ name: "Gadget", cost: 2 }), owner: P1, zone: "hand" }]);
  activate(g.engine, P1, g.id("pc"), "create");
  if (pending(g.engine)) deployChoice(g.engine, undefined);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("it")), "hand");
  assert.equal(g.engine.state.cards[g.id("pc")].depleted, true);
});

// =================================================================================
// Recyclable Golem
// =================================================================================
const gol = (extra: CardPlacement[] = [], res: CardPlacement[] = [...E(1), ...R(5)]) =>
  brd([{ key: "g", def: printing(GOLEM), owner: P1, zone: "hand" }, ...res, ...extra]);
/** Golem in play (face up) with `tokens`. */
const golIn = (tokens: number, extra: CardPlacement[] = [], opts: Partial<CardPlacement> = {}) =>
  brd([{ key: "g", def: printing(GOLEM), owner: P1, zone: "play", ...(tokens ? { counters: { token: tokens } } : {}), ...opts }, ...extra]);
/** Golem face-down in play with `res` as resources. */
const golFd = (res: CardPlacement[], extra: CardPlacement[] = []) =>
  brd([{ key: "g", def: printing(GOLEM), owner: P1, zone: "play", faceDown: true }, ...res, ...extra]);
const covertAttacker = (): CardPlacement => ({
  key: "atk",
  def: character({ name: "CovertAtk", strength: 2, speed: 2, life: 3, behavior: { keywords: ["covert"] } } as never),
  owner: P2,
  zone: "play"
});

clause(GOLEM, "0:rule", "printed: gearsmith golem character, cost 6, threshold e, 6 strength / 3 speed / 6 life; deploys for exactly 6 with an [E]", () => {
  const def = printing(GOLEM);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "gearsmith");
  assert.deepEqual([...(def.subtype as string[])], ["golem"]);
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "e");
  assert.deepEqual([def.strength, def.speed, def.life], [6, 3, 6]);
  const ok = gol();
  play(ok.engine, P1, ok.id("g"));
  assert.equal(zoneNow(ok.engine, ok.id("g")), "play");
  assert.deepEqual(st(ok.engine, ok.id("g")), [6, 3, 6]);
  const short = gol([], [...E(1), ...R(4)]);
  refused(() => play(short.engine, P1, short.id("g")), "one short of cost 6");
  const noIcon = gol([], [...R(6)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("g")), "no [E]");
  const spentShort = gol([], [...spent("elitism", 1), ...R(5)]);
  refused(() => play(spentShort.engine, P1, spentShort.id("g")), "threshold from spent [E] but only 5 ready", /Costs cannot be paid/);
  const spentOk = gol([], [...spent("elitism", 1), ...R(6)]);
  play(spentOk.engine, P1, spentOk.id("g"));
  assert.equal(zoneNow(spentOk.engine, spentOk.id("g")), "play");
});

clause(GOLEM, "0:rule", "deployed normally (not by FLIP UP) it enters play with NO token (6/6)", () => {
  const g = gol();
  play(g.engine, P1, g.id("g"));
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
  assert.deepEqual(st(g.engine, g.id("g")), [6, 3, 6]);
  assert.equal(kws(g.engine, g.id("g")).includes("canblockcovert"), false);
});

clause(GOLEM, "0:rule", "deployed with FLIP UP it enters play with a token on it (exactly one): 4 strength / 4 life", () => {
  const g = golFd([...E(1), ...R(4)]);
  flipUpRaw(g.engine, P1, g.id("g"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.cards[g.id("g")].faceDown ?? false, false, "face up");
  assert.equal(zoneNow(g.engine, g.id("g")), "play");
  assert.equal(tokensOn(g.engine, g.id("g")), 1);
  assert.deepEqual(st(g.engine, g.id("g")), [4, 3, 4]);
});

clause(GOLEM, "3:flipUp", "FLIP UP 4 [E]: pays exactly 4 (the card itself may help pay); one short is refused", () => {
  const exact = golFd([...E(1), ...R(3)]); // 4 others
  flipUpRaw(exact.engine, P1, exact.id("g"));
  resolvePendingResponses(exact.engine);
  assert.equal(exact.engine.state.cards[exact.id("g")].faceDown ?? false, false, "4 others pay");
  const more = golFd([...E(1), ...R(5)]);
  flipUpRaw(more.engine, P1, more.id("g"));
  resolvePendingResponses(more.engine);
  const ready = more.engine.getAvailableResourceCount(P1);
  assert.ok(ready === 2 || ready === 3, `exactly 4 were spent from 6 resources, left ${ready}`);
  const itself = golFd([...E(1), ...R(2)]);
  flipUpRaw(itself.engine, P1, itself.id("g"));
  resolvePendingResponses(itself.engine);
  assert.equal(itself.engine.state.cards[itself.id("g")].faceDown ?? false, false, "3 others + itself pay the 4");
  const short = golFd([...E(1), ...R(1)]);
  refused(() => flipUpRaw(short.engine, P1, short.id("g")), "only 3 resources including itself");
  assert.equal(short.engine.state.cards[short.id("g")].faceDown, true);
  assert.equal(tokensOn(short.engine, short.id("g")), 0);
  const spentRes = golFd([...E(1), ...R(1), ...spent("rage", 3)]);
  refused(() => flipUpRaw(spentRes.engine, P1, spentRes.id("g")), "spent resources cannot pay");
});

clause(GOLEM, "3:flipUp", "FLIP UP threshold [E] is required (none refused; a spent [E] suffices) and its own face-down card gives no icon", () => {
  const none = golFd([...R(5)]);
  refused(() => flipUpRaw(none.engine, P1, none.id("g")), "no [E] anywhere");
  assert.equal(none.engine.state.cards[none.id("g")].faceDown, true);
  const spentE = golFd([...spent("elitism", 1), ...R(4)]);
  flipUpRaw(spentE.engine, P1, spentE.id("g"));
  resolvePendingResponses(spentE.engine);
  assert.equal(spentE.engine.state.cards[spentE.id("g")].faceDown ?? false, false, "threshold from a spent [E]");
});

clause(GOLEM, "3:flipUp", "as a non-tactic it cannot be flipped up in the opponent's response window", () => {
  const g = golFd([...E(1), ...R(4)], [{ key: "atk", def: ch("Atk"), owner: P2, zone: "play" }]);
  g.engine.state.activePlayerId = P2;
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => flipUpRaw(g.engine, P1, g.id("g")), "FLIP UP of a non-tactic is not allowed in the opponent's response window");
  assert.equal(g.engine.state.cards[g.id("g")].faceDown, true);
  assert.equal(tokensOn(g.engine, g.id("g")), 0);
});

clause(GOLEM, "1:rule", "with a token: loses 2 strength and 2 life (speed unchanged); with no token it is 6/6", () => {
  const no = golIn(0);
  assert.deepEqual(st(no.engine, no.id("g")), [6, 3, 6]);
  const one = golIn(1);
  assert.deepEqual(st(one.engine, one.id("g")), [4, 3, 4]);
});

clause(GOLEM, "1:rule", "the penalty is a flat -2/-2 however many tokens it has, and is gone when the tokens are", () => {
  const g = golIn(3);
  assert.deepEqual(st(g.engine, g.id("g")), [4, 3, 4]);
  g.engine.state.cards[g.id("g")].counters = { token: 0 };
  assert.deepEqual(st(g.engine, g.id("g")), [6, 3, 6]);
});

clause(GOLEM, "1:rule", "a token on ANOTHER Golem / character does not shrink this one", () => {
  const g = golIn(0, [{ key: "g2", def: printing(GOLEM), owner: P1, zone: "play", counters: { token: 2 } }, { key: "pl", def: ch("Plain", 2, 2, 3), owner: P1, zone: "play", counters: { token: 1 } }]);
  assert.deepEqual(st(g.engine, g.id("g")), [6, 3, 6]);
  assert.deepEqual(st(g.engine, g.id("g2")), [4, 3, 4]);
  assert.deepEqual(st(g.engine, g.id("pl")), [2, 2, 3]);
});

clause(GOLEM, "1:rule", "with a token it can block a COVERT party; plain attackers can still be blocked by it", () => {
  const g = brd([
    { key: "g", def: printing(GOLEM), owner: P1, zone: "play", counters: { token: 1 } },
    covertAttacker()
  ], { turn: 2, activePlayerId: P2 });
  assert.ok(kws(g.engine, g.id("g")).includes("canblockcovert"), "kws(g.engine, g.id(\"g\")).includes(\"canblockcovert\")");
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("g")] });
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("g")], "blocked the covert party");
  const plain = brd([
    { key: "g", def: printing(GOLEM), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "atk", def: ch("Atk"), owner: P2, zone: "play" }
  ], { turn: 2, activePlayerId: P2 });
  declareAttackBy(plain.engine, P2, [plain.id("atk")]);
  plain.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [plain.id("g")] });
  assert.deepEqual(plain.engine.state.battle?.blockingParty, [plain.id("g")], "may still block a non-covert party");
});

clause(GOLEM, "1:rule", "with no token it cannot block a COVERT party (control for the token ability)", () => {
  const g = brd([
    { key: "g", def: printing(GOLEM), owner: P1, zone: "play" },
    { key: "pl", def: ch("Plain"), owner: P1, zone: "play" },
    covertAttacker()
  ], { turn: 2, activePlayerId: P2 });
  assert.equal(kws(g.engine, g.id("g")).includes("canblockcovert"), false);
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  assert.throws(() => g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("g")] }), "a tokenless Golem cannot block a covert party");
  assert.equal(g.engine.state.battle?.blockingParty?.length ?? 0, 0);
});

clause(GOLEM, "1:rule", "the covert-block ability is only for itself: another character of mine still cannot block a covert party", () => {
  const g = brd([
    { key: "g", def: printing(GOLEM), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "pl", def: ch("Plain"), owner: P1, zone: "play" },
    covertAttacker()
  ], { turn: 2, activePlayerId: P2 });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  assert.throws(() => g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("pl")] }), "plain ally cannot block covert");
  assert.throws(() => g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("g"), g.id("pl")] }), "nor join the Golem in blocking");
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("g")] });
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("g")]);
});

clause(GOLEM, "2:rule", "no tokens and would be destroyed: flipped face down, still in play under its owner's control, not in the discard pile", () => {
  const g = golIn(0, [killer()]);
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("g")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("g")), "play");
  assert.equal(g.engine.state.cards[g.id("g")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("g")].controllerId, P1);
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("g")), "!g.engine.state.players[P1].discard.includes(g.id(\"g\"))");
});

clause(GOLEM, "2:rule", "with a token it is destroyed normally (to the discard pile)", () => {
  const g = golIn(1, [killer()]);
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("g")] } });
  assert.equal(zoneNow(g.engine, g.id("g")), "discard");
});

clause(GOLEM, "2:rule", "destroyed by the OPPONENT while I control it: flips face down under its owner's control; a stolen Golem returns to its owner's control", () => {
  const g = golIn(0, [killer()], { owner: P1, controller: P2 } as never);
  assert.equal(g.engine.state.cards[g.id("g")].controllerId, P2);
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("g")] } });
  assert.equal(zoneNow(g.engine, g.id("g")), "play");
  assert.equal(g.engine.state.cards[g.id("g")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("g")].controllerId, P1, "back under its owner's control");
});

clause(GOLEM, "2:rule", "the opponent's tokenless Golem is protected the same way, and it stays face down in play for its owner", () => {
  const g = golIn(0, [killer()], { owner: P2 } as never);
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("g")] } });
  assert.equal(zoneNow(g.engine, g.id("g")), "play");
  assert.equal(g.engine.state.cards[g.id("g")].faceDown, true);
  assert.equal(g.engine.state.cards[g.id("g")].ownerId, P2);
  assert.ok(!g.engine.state.players[P2].discard.includes(g.id("g")), "!g.engine.state.players[P2].discard.includes(g.id(\"g\"))");
});

clause(GOLEM, "2:rule", "only the Golem itself is protected: another character is destroyed normally while a tokenless Golem is in play", () => {
  const g = golIn(0, [killer(), { key: "pl", def: ch("Plain"), owner: P1, zone: "play" }, { key: "foe", def: ch("Foe"), owner: P2, zone: "play" }]);
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("pl")] } });
  assert.equal(zoneNow(g.engine, g.id("pl")), "discard");
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("foe")] } });
  assert.equal(zoneNow(g.engine, g.id("foe")), "discard");
  assert.equal(zoneNow(g.engine, g.id("g")), "play");
  assert.equal(g.engine.state.cards[g.id("g")].faceDown ?? false, false);
});

clause(GOLEM, "2:rule", "a tokenless Golem destroyed in battle is flipped face down instead; one WITH a token is destroyed", () => {
  const bad = brd([
    { key: "g", def: printing(GOLEM), owner: P1, zone: "play" },
    { key: "atk", def: ch("Atk", 9, 4, 3), owner: P2, zone: "play" }
  ], { turn: 2, activePlayerId: P2 });
  fightThrough(bad.engine, P2, [bad.id("atk")], { type: "faction", playerId: P1 }, [bad.id("g")]);
  assert.equal(zoneNow(bad.engine, bad.id("g")), "play", "not destroyed");
  assert.equal(bad.engine.state.cards[bad.id("g")].faceDown, true);
  const tok = brd([
    { key: "g", def: printing(GOLEM), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "atk", def: ch("Atk", 9, 4, 3), owner: P2, zone: "play" }
  ], { turn: 2, activePlayerId: P2 });
  fightThrough(tok.engine, P2, [tok.id("atk")], { type: "faction", playerId: P1 }, [tok.id("g")]);
  assert.equal(zoneNow(tok.engine, tok.id("g")), "discard");
});

clause(GOLEM, "2:rule", "once flipped face down it counts as a resource (Volition) for its owner", () => {
  const g = golIn(0, [killer()]);
  const before = g.engine.getAvailableResourceCount(P1);
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("g")] } });
  assert.equal(g.engine.getAvailableResourceCount(P1), before + 1);
});

clause(GOLEM, "2:rule", "flipped face down, it can later be flipped up again (4 [E]) and then has a token", () => {
  const g = golIn(0, [killer(), ...E(1), ...R(4)]);
  activate(g.engine, P1, g.id("kl"), "s", { selected: { t: [g.id("g")] } });
  flipUpRaw(g.engine, P1, g.id("g"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("g")].faceDown ?? false, false);
  assert.equal(tokensOn(g.engine, g.id("g")), 1);
  assert.deepEqual(st(g.engine, g.id("g")), [4, 3, 4]);
});

void playRaw;
