// Clause tests, batch seed-saga-05, part p2 (groups 9-13, missing clauses only).
// Subordinate Demotivation, The Brotherhood of the Mau, Theocratic Senate of Marduun, Tiny Shiny, Treasure Brokerage.
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, location, play, resourceCard, tactic, P1, P2 } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { declareAttackBy, covertBlocksOnlyCovertParties, covertCannotBeBlockedByNonCovert, covertHasKeyword, covertPartyNeedsEveryMemberCovert, fightThrough } from "./_battle.js";
import { developResource, endTurn } from "./_turn.js";

const DEMOT = "4d54e821-c642-4b77-86a2-58514c2f1173"; // tactic banker cost 3 "g" -- destroy opp's lowest-cost character; tie: you decide
const MAU = "57887333-13d3-48eb-8e97-e78ee95d3e13"; // character banker advisor/politician/mau cost 3 "gg" 4/1/4 COVERT, 7 tokens, can't attack with a token, start of turn: pay X, remove X tokens, another character +X life
const SENATE = "01fc9f16-7ec3-4ace-a6f4-47689cb8e3ed"; // location banker cost 5 "ggg" structure 5 UNIQUE; opponents can't attack your faction; damage to it is reflected
const SHINY = "ea6200e2-179c-4399-9711-faf266b41a12"; // tactic banker cost 3 "g" -- EXTRA COST pick a character; next damage to it this turn -2; becomes a face-down resource
const BROKER = "8f6f62a4-64ee-402d-be0e-1ac69b151b84"; // location banker cost 2 "g" structure 5 -- character enters under your control: may pay 1, search staple resource to hand

const mk = (cards: CardPlacement[], o: { active?: PlayerId; random?: () => number } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: o.active ?? P1,
    turn: o.active === P2 ? 2 : 3,
    random: o.random ?? (() => 0.5),
    cards
  });
const ch = (name: string, cost: number, over: Partial<CardDefinition> = {}) => character({ name, cost, strength: 1, speed: 1, life: 3, ...over });
const zones = (engine: SpoilsEngine, ids: CardInstanceId[]) => ids.map(i => engine.state.cards[i].zone);
/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const hand = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].hand];
const sel = (decl: string, ...ids: CardInstanceId[]) => ({ selected: { [decl]: ids } });

// ===================== Subordinate Demotivation =====================
const demotBoard = (extra: CardPlacement[], opts: { greed?: number; rage?: number } = {}) =>
  mk([
    { key: "sd", def: printing(DEMOT), owner: P1, zone: "hand" },
    ...bank("greed", opts.greed ?? 3, P1),
    ...bank("rage", opts.rage ?? 0, P1),
    ...extra
  ]);

clause(DEMOT, "0:rule", "printed cost 3, threshold [G], a tactic; payable exactly, refused one short and with the icon short", () => {
  assert.equal(printing(DEMOT).type, "tactic");
  assert.equal(printing(DEMOT).cost, 3);
  const foe = (): CardPlacement[] => [{ key: "a", def: ch("A", 1), owner: P2, zone: "play" }];
  const ok = demotBoard(foe());
  play(ok.engine, P1, ok.id("sd"), sel("c", ok.id("a")));
  assert.equal(readyResources(ok.engine, P1), 0, "all 3 paid");
  assert.equal(zoneOf(ok.engine, ok.id("a")), "discard");
  const short = demotBoard(foe(), { greed: 2 });
  refused(() => play(short.engine, P1, short.id("sd"), sel("c", short.id("a"))), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("a")), "play");
  const noIcon = demotBoard(foe(), { greed: 0, rage: 3 });
  refused(() => play(noIcon.engine, P1, noIcon.id("sd"), sel("c", noIcon.id("a"))), "3 resources but no [G]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("a")), "play");
});

clause(DEMOT, "0:rule", "destroys the opponent's lowest-cost character (and only it); other characters and non-characters stay", () => {
  const b = demotBoard([
    { key: "hi", def: ch("Hi", 4), owner: P2, zone: "play" },
    { key: "lo", def: ch("Lo", 1), owner: P2, zone: "play" },
    { key: "mid", def: ch("Mid", 2), owner: P2, zone: "play" },
    { key: "itm", def: item({ name: "Junk", cost: 0 }), owner: P2, zone: "play" },
    { key: "mine", def: ch("Mine", 0), owner: P1, zone: "play" }
  ]);
  play(b.engine, P1, b.id("sd"), sel("c", b.id("lo")));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(zones(b.engine, ["lo", "hi", "mid", "itm", "mine"].map(b.id)), ["discard", "play", "play", "play", "play"]);
  assert.equal(zoneOf(b.engine, b.id("sd")), "discard", "the tactic is spent");
});

// E10b: test corrected because the printed card picks nothing when played (seed-04-16): the lowest-cost character is chosen when the tactic resolves, and only a tie asks "you decide". The "cannot be picked" cases are now exercised through that tie prompt.
const pickLowest = (b: ReturnType<typeof demotBoard>, id: string) => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(id)] });
clause(DEMOT, "0:rule", "a character that is not the lowest cost cannot be picked; neither can your own character, an item, or one that left play", () => {
  const b = demotBoard([
    { key: "hi", def: ch("Hi", 4), owner: P2, zone: "play" },
    { key: "lo", def: ch("Lo", 1), owner: P2, zone: "play" },
    { key: "lo2", def: ch("Lo2", 1), owner: P2, zone: "play" },
    { key: "mid", def: ch("Mid", 2), owner: P2, zone: "play" },
    { key: "itm", def: item({ name: "Junk", cost: 0 }), owner: P2, zone: "play" },
    { key: "mine", def: ch("Mine", 0), owner: P1, zone: "play" }
  ]);
  play(b.engine, P1, b.id("sd"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the tie asks the caster to decide");
  for (const bad of ["hi", "mid", "itm", "mine"]) {
    refused(() => pickLowest(b, bad), `${bad} is not a legal pick`);
    assert.equal(zoneOf(b.engine, b.id(bad)), "play");
    assert.equal(zoneOf(b.engine, b.id("lo")), "play", "nothing was destroyed");
  }
  pickLowest(b, "lo");
  assert.equal(zoneOf(b.engine, b.id("lo")), "discard", "control: a tied-lowest character is legal");
  assert.equal(zoneOf(b.engine, b.id("lo2")), "play");
});

clause(DEMOT, "0:rule", "only characters in play count: a cheaper character in the opponent's discard, or a face-down one, does not make the minimum", () => {
  const b = demotBoard([
    { key: "gone", def: ch("Gone", 0), owner: P2, zone: "discard" },
    { key: "fd", def: ch("FaceDown", 0), owner: P2, zone: "play", faceDown: true },
    { key: "two", def: ch("Two", 2), owner: P2, zone: "play" },
    { key: "five", def: ch("Five", 5), owner: P2, zone: "play" }
  ]);
  play(b.engine, P1, b.id("sd"), sel("c", b.id("two")));
  assert.equal(zoneOf(b.engine, b.id("two")), "discard", "the lowest cost among characters in play");
  assert.equal(zoneOf(b.engine, b.id("five")), "play");
  assert.equal(b.engine.state.cards[b.id("fd")].zone, "play");
});

clause(DEMOT, "0:rule", "tie: both lowest-cost characters can be picked and you (the caster) choose which one is destroyed", () => {
  for (const pick of ["t1", "t2"]) {
    const b = demotBoard([
      { key: "t1", def: ch("T1", 1), owner: P2, zone: "play" },
      { key: "t2", def: ch("T2", 1), owner: P2, zone: "play" },
      { key: "hi", def: ch("Hi", 3), owner: P2, zone: "play" }
    ]);
    play(b.engine, P1, b.id("sd"));
    pickLowest(b, pick);
    const other = pick === "t1" ? "t2" : "t1";
    assert.equal(zoneOf(b.engine, b.id(pick)), "discard", `${pick} destroyed`);
    assert.equal(zoneOf(b.engine, b.id(other)), "play", `${other} survives`);
    assert.equal(zoneOf(b.engine, b.id("hi")), "play");
  }
  const b = demotBoard([
    { key: "t1", def: ch("T1", 1), owner: P2, zone: "play" },
    { key: "t2", def: ch("T2", 1), owner: P2, zone: "play" },
    { key: "hi", def: ch("Hi", 3), owner: P2, zone: "play" }
  ]);
  play(b.engine, P1, b.id("sd"));
  refused(() => pickLowest(b, "hi"), "a tie only allows the tied characters");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the caster must name which tied character: you decide");
  assert.equal(zoneOf(b.engine, b.id("t1")), "play");
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
});

clause(DEMOT, "0:rule", "control, not ownership, decides 'an opponent controls': a stolen character is a candidate, a character you took from them is not", () => {
  const b = demotBoard([
    { key: "stolen", def: ch("Stolen", 1), owner: P1, zone: "play", controller: P2 },
    { key: "taken", def: ch("Taken", 0), owner: P2, zone: "play", controller: P1 },
    { key: "foe", def: ch("Foe", 2), owner: P2, zone: "play" },
    { key: "foe1", def: ch("Foe1", 1), owner: P2, zone: "play" }
  ]);
  play(b.engine, P1, b.id("sd"));
  refused(() => pickLowest(b, "foe"), "cost 2 is not tied for the lowest (Stolen and Foe1 are, at cost 1)");
  refused(() => pickLowest(b, "taken"), "a character you control is never a target");
  pickLowest(b, "stolen");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "discard");
  assert.equal(zoneOf(b.engine, b.id("taken")), "play");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(DEMOT, "0:rule", "with no opponent character there is nothing to destroy: the tactic is still cast (3 paid, tactic to the discard pile) and your own characters are untouched", () => {
  // The printed text has no "pick": it just destroys the lowest-cost opponent character, if there is one.
  const b = demotBoard([{ key: "mine", def: ch("Mine", 0), owner: P1, zone: "play" }]);
  play(b.engine, P1, b.id("sd"));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("sd")), "discard", "the tactic was cast");
  assert.equal(readyResources(b.engine, P1), 0, "its cost of 3 was paid");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "my own character is untouched");
});

// ===================== The Brotherhood of the Mau =====================
const mauBoard = (extra: CardPlacement[], opts: { tokens?: number; greed?: number; active?: PlayerId; zone?: "play" | "hand"; rage?: number; controller?: PlayerId } = {}) =>
  mk(
    [
      { key: "mau", def: printing(MAU), owner: P1, zone: opts.zone ?? "play", controller: opts.controller, counters: opts.tokens ? { token: opts.tokens } : undefined },
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...extra
    ],
    { active: opts.active }
  );
const numberKind = (pc: PendingChoiceLike) => /number/i.test(pc.kind);
/** Answers the start-of-turn prompts: X, whether to pay, who to pick. */
const shareAnswer = (x: number, pay: boolean, pick?: CardInstanceId) => (pc: PendingChoiceLike): unknown =>
  numberKind(pc)
    ? { kind: "chooseNumber", value: x }
    : pc.kind === "mayPay"
      ? { kind: "mayPay", pay }
      : pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: pick ? [pick] : [] }
        : declineAll(pc);
const noShare = shareAnswer(0, false);

clause(MAU, "0:kw:COVERT", "printed cost 3, threshold [G][G], character advisor/politician/mau, 4 strength / 1 speed / 4 life; payable exactly, refused one short and with an icon short", () => {
  const d = printing(MAU);
  assert.equal(d.type, "character");
  assert.deepEqual([...(d.subtype ?? [])].sort(), ["advisor", "mau", "politician"]);
  assert.equal(d.cost, 3);
  const ok = mauBoard([], { zone: "hand", greed: 3 });
  play(ok.engine, P1, ok.id("mau"));
  drain(ok.engine, noShare);
  assert.equal(zoneOf(ok.engine, ok.id("mau")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "3 paid");
  assert.equal(ok.engine.getStat(ok.id("mau"), "strength"), 4);
  assert.equal(ok.engine.getStat(ok.id("mau"), "speed"), 1);
  assert.equal(ok.engine.getStat(ok.id("mau"), "life"), 4);
  const short = mauBoard([], { zone: "hand", greed: 2 });
  refused(() => play(short.engine, P1, short.id("mau")), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("mau")), "hand");
  const oneIcon = mauBoard([], { zone: "hand", greed: 1, rage: 2 });
  refused(() => play(oneIcon.engine, P1, oneIcon.id("mau")), "3 resources but only one [G] of [G][G]");
  assert.equal(zoneOf(oneIcon.engine, oneIcon.id("mau")), "hand");
});

clause(MAU, "0:kw:COVERT", "has COVERT", () => covertHasKeyword(MAU));
clause(MAU, "0:kw:COVERT", "a COVERT party can't be blocked by non-covert characters", () => covertCannotBeBlockedByNonCovert(MAU));
clause(MAU, "0:kw:COVERT", "a party with a non-covert member is not covert", () => covertPartyNeedsEveryMemberCovert(MAU));
clause(MAU, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(MAU));

clause(MAU, "1:rule", "enters play with exactly 7 tokens on it; other characters entering don't add tokens to it; re-entering gives 7, not more", () => {
  const b = mauBoard(
    [
      { key: "other", def: ch("Other", 0), owner: P1, zone: "hand" },
      { key: "oth2", def: ch("Other2", 0), owner: P2, zone: "play" }
    ],
    { zone: "hand", greed: 3 }
  );
  play(b.engine, P1, b.id("mau"));
  drain(b.engine, noShare);
  assert.equal(tokensOn(b.engine, b.id("mau")), 7);
  assert.equal(tokensOn(b.engine, b.id("oth2")), 0, "no tokens elsewhere");
  play(b.engine, P1, b.id("other"));
  drain(b.engine, noShare);
  assert.equal(tokensOn(b.engine, b.id("mau")), 7, "another character entering doesn't change it");
  assert.equal(tokensOn(b.engine, b.id("other")), 0, "and the other character gets none");
});

clause(MAU, "1:rule", "entering play again (after leaving) gives it exactly 7 tokens, not 7 more on top of stale ones", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const r = mauBoard([{ key: "bn", def: bounce, owner: P1, zone: "hand" }], { zone: "play", greed: 3, tokens: 7 });
  play(r.engine, P1, r.id("bn"), sel("t", r.id("mau")));
  drain(r.engine, noShare);
  assert.equal(zoneOf(r.engine, r.id("mau")), "hand", "bounced");
  play(r.engine, P1, r.id("mau"));
  drain(r.engine, noShare);
  assert.equal(tokensOn(r.engine, r.id("mau")), 7, "replayed: 7 tokens");
});

clause(MAU, "2:rule", "while it has a token it cannot attack (1 token or 7 tokens); with none it can; other characters can", () => {
  for (const tokens of [7, 1]) {
    const b = mauBoard([{ key: "ally", def: ch("Ally", 0), owner: P1, zone: "play" }], { tokens });
    refused(() => declareAttackBy(b.engine, P1, [b.id("mau")]), `Mau with ${tokens} token(s) cannot attack`);
    assert.equal(b.engine.state.battle, undefined);
    refused(() => declareAttackBy(b.engine, P1, [b.id("mau"), b.id("ally")]), "nor can it join a party");
    assert.equal(b.engine.state.battle, undefined);
    declareAttackBy(b.engine, P1, [b.id("ally")]);
    assert.ok(b.engine.state.battle, "control: an ordinary character attacks");
  }
  const free = mauBoard([], { tokens: 0 });
  declareAttackBy(free.engine, P1, [free.id("mau")]);
  assert.deepEqual(free.engine.state.battle?.attackingParty, [free.id("mau")], "no token: it can attack");
});

clause(MAU, "2:rule", "the restriction ends when the last token is removed (by its own start-of-turn ability)", () => {
  const b = mauBoard([{ key: "ally", def: ch("Ally", 0), owner: P1, zone: "play" }], { tokens: 2, greed: 3, active: P2 });
  endTurn(b.engine, P2); // P1's turn: start-of-turn trigger
  drain(b.engine, shareAnswer(2, true, b.id("ally")));
  assert.equal(tokensOn(b.engine, b.id("mau")), 0);
  declareAttackBy(b.engine, P1, [b.id("mau")]);
  assert.deepEqual(b.engine.state.battle?.attackingParty, [b.id("mau")]);
});

clause(MAU, "3:rule", "at the start of your own turn: pay X (X resources spent), remove X tokens, another character gains X life this turn", () => {
  const b = mauBoard(
    [
      { key: "ally", def: ch("Ally", 0, { life: 3 }), owner: P1, zone: "play" },
      { key: "ally2", def: ch("Ally2", 0, { life: 3 }), owner: P1, zone: "play" }
    ],
    { tokens: 7, greed: 5, active: P2 }
  );
  endTurn(b.engine, P2);
  const pc = pending(b.engine)!;
  assert.ok(pc && numberKind(pc), "asked for X");
  assert.equal(pc.playerId, P1, "the Mau's controller chooses X");
  drain(b.engine, shareAnswer(2, true, b.id("ally")));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(b.engine, P1), 3, "exactly X=2 paid");
  assert.equal(tokensOn(b.engine, b.id("mau")), 5, "2 tokens removed");
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 5, "picked character gains 2 life");
  assert.equal(b.engine.getStat(b.id("ally2"), "life"), 3, "an unpicked character gains nothing");
  assert.equal(b.engine.getStat(b.id("mau"), "life"), 4, "the Mau itself gains nothing");
});

clause(MAU, "3:rule", "also at the start of the opponent's turn ('each turn'), and X can be a different number each time", () => {
  const b = mauBoard([{ key: "ally", def: ch("Ally", 0, { life: 3 }), owner: P1, zone: "play" }], { tokens: 7, greed: 5 });
  endTurn(b.engine, P1); // P2's turn begins
  drain(b.engine, shareAnswer(3, true, b.id("ally")));
  assert.equal(tokensOn(b.engine, b.id("mau")), 4, "3 removed on the opponent's turn start");
  assert.equal(readyResources(b.engine, P1), 2, "3 paid");
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 6);
});

clause(MAU, "3:rule", "the life gain lasts only this turn", () => {
  const b = mauBoard([{ key: "ally", def: ch("Ally", 0, { life: 3 }), owner: P1, zone: "play" }], { tokens: 7, greed: 5, active: P2 });
  endTurn(b.engine, P2);
  drain(b.engine, shareAnswer(2, true, b.id("ally")));
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 5);
  endTurn(b.engine, P1);
  drain(b.engine, noShare);
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 3, "gone after the turn ends");
});

clause(MAU, "3:rule", "'may pay X': declining the payment spends nothing, removes no tokens, and gives no life", () => {
  const b = mauBoard([{ key: "ally", def: ch("Ally", 0, { life: 3 }), owner: P1, zone: "play" }], { tokens: 7, greed: 5, active: P2 });
  endTurn(b.engine, P2);
  drain(b.engine, shareAnswer(4, false, b.id("ally")));
  assert.equal(readyResources(b.engine, P1), 5);
  assert.equal(tokensOn(b.engine, b.id("mau")), 7);
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 3);
});

clause(MAU, "3:rule", "X can't exceed the tokens on it, and can't be paid with fewer resources than X", () => {
  const b = mauBoard([{ key: "ally", def: ch("Ally", 0, { life: 3 }), owner: P1, zone: "play" }], { tokens: 2, greed: 5, active: P2 });
  endTurn(b.engine, P2);
  const pc = pending(b.engine) as unknown as { max?: number; min?: number };
  assert.equal(pc.max, 2, "X ranges up to the 2 tokens");
  assert.equal(pc.min, 0);
  const short = mauBoard([{ key: "ally", def: ch("Ally", 0, { life: 3 }), owner: P1, zone: "play" }], { tokens: 7, greed: 1, active: P2 });
  endTurn(short.engine, P2);
  answerPending(short.engine, "chooseNumber", { value: 3 });
  refused(() => answerPending(short.engine, "mayPay", { pay: true }), "cannot pay 3 with 1 resource");
  assert.equal(tokensOn(short.engine, short.id("mau")), 7);
  assert.equal(short.engine.getStat(short.id("ally"), "life"), 3);
});

clause(MAU, "3:rule", "X = 0 pays and removes nothing and gives +0 life", () => {
  const b = mauBoard([{ key: "ally", def: ch("Ally", 0, { life: 3 }), owner: P1, zone: "play" }], { tokens: 7, greed: 5, active: P2 });
  endTurn(b.engine, P2);
  drain(b.engine, shareAnswer(0, true, b.id("ally")));
  assert.equal(readyResources(b.engine, P1), 5);
  assert.equal(tokensOn(b.engine, b.id("mau")), 7);
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 3);
});

clause(MAU, "3:rule", "the picked character must be 'another' character: the Mau itself is not pickable", () => {
  const b = mauBoard([{ key: "ally", def: ch("Ally", 0, { life: 3 }), owner: P1, zone: "play" }], { tokens: 7, greed: 5, active: P2 });
  endTurn(b.engine, P2);
  answerPending(b.engine, "chooseNumber", { value: 2 });
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mau")] }), "itself is not 'another'");
  assert.equal(b.engine.getStat(b.id("mau"), "life"), 4);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("ally")] });
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 5, "control: another character is fine");
});

clause(MAU, "3:rule", "'pick another character' is not limited to your own: an opponent's character can be picked and gains the life", () => {
  const b = mauBoard([{ key: "foe", def: ch("Foe", 0, { life: 3 }), owner: P2, zone: "play" }], { tokens: 7, greed: 5, active: P2 });
  endTurn(b.engine, P2);
  drain(b.engine, shareAnswer(2, true, b.id("foe")));
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 5, "the opponent's character gains 2 life");
  assert.equal(tokensOn(b.engine, b.id("mau")), 5);
});

clause(MAU, "3:rule", "a Mau you don't control doesn't trigger for you; its controller is the one who pays", () => {
  const b = mauBoard([{ key: "ally", def: ch("Ally", 0, { life: 3 }), owner: P2, zone: "play" }, ...bank("greed", 3, P2)], { tokens: 7, greed: 0, active: P1, controller: P2 });
  endTurn(b.engine, P1);
  const pc = pending(b.engine)!;
  assert.ok(pc && numberKind(pc), "pc && numberKind(pc)");
  assert.equal(pc.playerId, P2, "the controller (P2) decides X");
  drain(b.engine, shareAnswer(1, true, b.id("ally")));
  assert.equal(readyResources(b.engine, P2), 2, "the controller pays");
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 4);
});

// ===================== Theocratic Senate of Marduun =====================
const senateBoard = (extra: CardPlacement[], opts: { greed?: number; rage?: number; active?: PlayerId; senateZone?: "play" | "hand" | "discard"; faceDown?: boolean; controller?: PlayerId } = {}) =>
  mk(
    [
      { key: "sen", def: printing(SENATE), owner: P1, zone: opts.senateZone ?? "play", faceDown: opts.faceDown, controller: opts.controller },
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...extra
    ],
    { active: opts.active }
  );

clause(SENATE, "0:unique", "printed cost 5, threshold [G][G][G], location, structure 5; payable exactly, refused one short and with an icon short", () => {
  const d = printing(SENATE);
  assert.equal(d.type, "location");
  assert.equal(d.cost, 5);
  assert.equal(d.structure, 5);
  const ok = senateBoard([], { senateZone: "hand", greed: 5 });
  play(ok.engine, P1, ok.id("sen"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("sen")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "5 paid");
  assert.equal(ok.engine.getStat(ok.id("sen"), "structure"), 5);
  const short = senateBoard([], { senateZone: "hand", greed: 4 });
  refused(() => play(short.engine, P1, short.id("sen")), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("sen")), "hand");
  const icon = senateBoard([], { senateZone: "hand", greed: 2, rage: 3 });
  refused(() => play(icon.engine, P1, icon.id("sen")), "5 resources but only two [G] of [G][G][G]");
  assert.equal(zoneOf(icon.engine, icon.id("sen")), "hand");
});

clause(SENATE, "0:unique", "UNIQUE: a second copy under your control makes you keep one (either), the other is destroyed", () => {
  for (const keep of ["sen", "sen2"]) {
    const b = senateBoard([{ key: "sen2", def: printing(SENATE), owner: P1, zone: "hand" }], { greed: 5 });
    play(b.engine, P1, b.id("sen2"));
    const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1);
    assert.deepEqual([...pc.candidates].sort(), [b.id("sen"), b.id("sen2")].sort());
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id(keep) } } as never);
    const lost = keep === "sen" ? "sen2" : "sen";
    assert.equal(zoneOf(b.engine, b.id(keep)), "play");
    assert.equal(zoneOf(b.engine, b.id(lost)), "discard");
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(SENATE, "0:unique", "UNIQUE is per player: the opponent may control their own Senate, no choice and no destruction", () => {
  const b = senateBoard([{ key: "sen2", def: printing(SENATE), owner: P2, zone: "hand" }, ...bank("greed", 5, P2)], { active: P2 });
  play(b.engine, P2, b.id("sen2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("sen")), "play");
  assert.equal(zoneOf(b.engine, b.id("sen2")), "play");
});

clause(SENATE, "1:rule", "opponents cannot attack your faction (alone or in a party); you can still attack theirs; they can attack your other things", () => {
  const b = senateBoard(
    [
      { key: "a1", def: ch("Atk1", 0, { strength: 2, life: 5 }), owner: P2, zone: "play" },
      { key: "a2", def: ch("Atk2", 0, { strength: 2, life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: ch("Mine", 0, { life: 5 }), owner: P1, zone: "play" }
    ],
    { active: P2 }
  );
  refused(() => declareAttackBy(b.engine, P2, [b.id("a1")]), "a lone attacker can't attack P1's faction", /faction|attack/i);
  refused(() => declareAttackBy(b.engine, P2, [b.id("a1"), b.id("a2")]), "a party can't either", /faction|attack/i);
  assert.equal(b.engine.state.battle, undefined);
  declareAttackBy(b.engine, P2, [b.id("a1")], { type: "card", cardId: b.id("sen") });
  assert.ok(b.engine.state.battle, "control: attacking a card other than the faction is fine");
  // and the other direction: the Senate's controller's own attacks are unaffected
  const c = senateBoard([{ key: "mine", def: ch("Mine", 0, { life: 5 }), owner: P1, zone: "play" }], { active: P1 });
  declareAttackBy(c.engine, P1, [c.id("mine")]);
  assert.ok(c.engine.state.battle, "its controller may attack the opponent's faction");
});

clause(SENATE, "1:rule", "'your faction': a Senate protects only its controller's faction, so the opponent's own Senate leaves yours attackable", () => {
  const b = mk(
    [
      { key: "sen2", def: printing(SENATE), owner: P2, zone: "play" },
      { key: "a1", def: ch("Atk1", 0), owner: P2, zone: "play" },
      { key: "m1", def: ch("Mine", 0), owner: P1, zone: "play" }
    ],
    { active: P2 }
  );
  declareAttackBy(b.engine, P2, [b.id("a1")]);
  assert.ok(b.engine.state.battle, "P2 may attack P1's faction: only P2's faction is protected by P2's Senate");
  const c = mk(
    [
      { key: "sen2", def: printing(SENATE), owner: P2, zone: "play" },
      { key: "m1", def: ch("Mine", 0), owner: P1, zone: "play" }
    ],
    { active: P1 }
  );
  refused(() => declareAttackBy(c.engine, P1, [c.id("m1")]), "P1 can't attack P2's faction while P2 controls a Senate", /faction|attack/i);
});

clause(SENATE, "1:rule", "control, not ownership: a Senate you took from them protects YOUR faction, and no longer theirs", () => {
  const b = mk(
    [
      { key: "sen", def: printing(SENATE), owner: P2, zone: "play", controller: P1 },
      { key: "a1", def: ch("Atk1", 0), owner: P2, zone: "play" },
      { key: "m1", def: ch("Mine", 0), owner: P1, zone: "play" }
    ],
    { active: P2 }
  );
  refused(() => declareAttackBy(b.engine, P2, [b.id("a1")]), "P1 controls the Senate", /faction|attack/i);
  const c = mk(
    [
      { key: "sen", def: printing(SENATE), owner: P1, zone: "play", controller: P2 },
      { key: "a1", def: ch("Atk1", 0), owner: P2, zone: "play" },
      { key: "m1", def: ch("Mine", 0), owner: P1, zone: "play" }
    ],
    { active: P1 }
  );
  refused(() => declareAttackBy(c.engine, P1, [c.id("m1")]), "P2 controls it and is protected", /faction|attack/i);
});

clause(SENATE, "1:rule", "the protection is only active while the Senate is in play face-up: off in hand, in the discard pile and face-down", () => {
  for (const variant of [{ senateZone: "hand" as const }, { senateZone: "discard" as const }, { senateZone: "play" as const, faceDown: true }]) {
    const b = senateBoard([{ key: "a1", def: ch("Atk1", 0), owner: P2, zone: "play" }], { active: P2, ...variant });
    declareAttackBy(b.engine, P2, [b.id("a1")]);
    assert.ok(b.engine.state.battle, `attackable when the Senate is ${JSON.stringify(variant)}`);
  }
  const on = senateBoard([{ key: "a1", def: ch("Atk1", 0), owner: P2, zone: "play" }], { active: P2 });
  refused(() => declareAttackBy(on.engine, P2, [on.id("a1")]), "control: face-up in play protects", /faction|attack/i);
});

clause(SENATE, "1:rule", "the protection ends when the Senate is destroyed by damage", () => {
  const b = senateBoard(
    [
      { key: "a1", def: ch("Big", 0, { strength: 6, life: 20 }), owner: P2, zone: "play" },
      { key: "a2", def: ch("Second", 0, { strength: 1, life: 5 }), owner: P2, zone: "play" }
    ],
    { active: P2 }
  );
  fightThrough(b.engine, P2, [b.id("a1")], { type: "card", cardId: b.id("sen") }, []);
  assert.equal(zoneOf(b.engine, b.id("sen")), "discard", "6 damage destroys the structure-5 Senate");
  endTurn(b.engine, P2);
  drain(b.engine, declineAll);
  endTurn(b.engine, P1);
  drain(b.engine, declineAll);
  declareAttackBy(b.engine, P2, [b.id("a2")]);
  assert.ok(b.engine.state.battle, "now the faction is attackable");
});

const damageTo = (name: string, amount: number) =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
  });

clause(SENATE, "2:rule", "a character that inflicts damage to the Senate takes the same amount of damage (several amounts, and each attacker separately)", () => {
  for (const strength of [1, 2, 4]) {
    const b = senateBoard([{ key: "a1", def: ch("Atk", 0, { strength, life: 9 }), owner: P2, zone: "play" }], { active: P2 });
    fightThrough(b.engine, P2, [b.id("a1")], { type: "card", cardId: b.id("sen") }, []);
    assert.equal(b.engine.state.cards[b.id("sen")].damage, strength, `Senate took ${strength}`);
    assert.equal(b.engine.state.cards[b.id("a1")].damage, strength, `the attacker takes the same ${strength}`);
    assert.equal(zoneOf(b.engine, b.id("a1")), "play");
  }
  const two = senateBoard(
    [
      { key: "a1", def: ch("Atk1", 0, { strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "a2", def: ch("Atk2", 0, { strength: 3, life: 9 }), owner: P2, zone: "play" }
    ],
    { active: P2 }
  );
  fightThrough(two.engine, P2, [two.id("a1"), two.id("a2")], { type: "card", cardId: two.id("sen") }, []);
  assert.equal(two.engine.state.cards[two.id("a1")].damage, 1, "each attacker takes its own damage");
  assert.equal(two.engine.state.cards[two.id("a2")].damage, 3);
});

clause(SENATE, "2:rule", "the reflected damage is the full damage inflicted, so it can kill the attacker (and the Senate too when it takes lethal)", () => {
  const b = senateBoard([{ key: "a1", def: ch("Frail", 0, { strength: 3, life: 3 }), owner: P2, zone: "play" }], { active: P2 });
  fightThrough(b.engine, P2, [b.id("a1")], { type: "card", cardId: b.id("sen") }, []);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard", "3 damage back on a 3-life attacker kills it");
  assert.equal(b.engine.state.cards[b.id("sen")].damage, 3);
  assert.equal(zoneOf(b.engine, b.id("sen")), "play");
  const big = senateBoard([{ key: "a1", def: ch("Big", 0, { strength: 7, life: 20 }), owner: P2, zone: "play" }], { active: P2 });
  fightThrough(big.engine, P2, [big.id("a1")], { type: "card", cardId: big.id("sen") }, []);
  assert.equal(zoneOf(big.engine, big.id("sen")), "discard", "7 destroys the structure-5 Senate");
  assert.equal(big.engine.state.cards[big.id("a1")].damage, 7, "the attacker still takes the full 7 inflicted");
});

clause(SENATE, "2:rule", "any character, including one you control, is hit when it damages the Senate (via an ability)", () => {
  const shooter = character({
    name: "Shooter",
    cost: 0,
    strength: 1,
    speed: 1,
    life: 6,
    behavior: { abilities: [{ id: "shoot", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] }
  });
  const b = senateBoard([{ key: "sh", def: shooter, owner: P1, zone: "play" }], {});
  activate(b.engine, P1, b.id("sh"), "shoot", sel("t", b.id("sen")));
  assert.equal(b.engine.state.cards[b.id("sen")].damage, 2, "Senate was damaged");
  assert.equal(b.engine.state.cards[b.id("sh")].damage, 2, "the character that inflicted it takes 2 as well");
});

clause(SENATE, "2:rule", "damage inflicted by a non-character (a tactic) is not reflected; damage to another card doesn't trigger it", () => {
  const b = senateBoard(
    [
      { key: "bolt", def: damageTo("Bolt", 2), owner: P2, zone: "hand" },
      { key: "bystander", def: ch("Bystander", 0, { life: 9 }), owner: P1, zone: "play" },
      { key: "mine", def: ch("Mine", 0, { life: 9 }), owner: P2, zone: "play" }
    ],
    { active: P2 }
  );
  play(b.engine, P2, b.id("bolt"), sel("t", b.id("sen")));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("sen")].damage, 2);
  assert.equal(b.engine.state.cards[b.id("mine")].damage ?? 0, 0, "no character inflicted it");
  assert.equal(b.engine.state.cards[b.id("bystander")].damage ?? 0, 0);
  assert.equal(b.engine.state.cards[b.id("bolt")].damage ?? 0, 0, "nor is the tactic itself damaged in return");
  assert.equal(b.engine.state.pendingChoice, undefined);
  const cannon = item({
    name: "Cannon",
    cost: 0,
    structure: 9,
    behavior: { abilities: [{ id: "boom", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] }
  });
  const i = senateBoard([{ key: "cn", def: cannon, owner: P2, zone: "play" }], { active: P2 });
  activate(i.engine, P2, i.id("cn"), "boom", sel("t", i.id("sen")));
  assert.equal(i.engine.state.cards[i.id("sen")].damage, 2, "an item's ability damaged the Senate");
  assert.equal(i.engine.state.cards[i.id("cn")].damage ?? 0, 0, "an item is not a character: nothing is reflected onto it");
  const c = senateBoard(
    [
      { key: "atk", def: ch("Atk", 0, { strength: 3, life: 9 }), owner: P2, zone: "play" },
      { key: "mine", def: location({ name: "Other Place", structure: 9 }), owner: P1, zone: "play" }
    ],
    { active: P2 }
  );
  fightThrough(c.engine, P2, [c.id("atk")], { type: "card", cardId: c.id("mine") }, []);
  assert.equal(c.engine.state.cards[c.id("mine")].damage, 3);
  assert.equal(c.engine.state.cards[c.id("atk")].damage ?? 0, 0, "damaging another card of yours doesn't reflect");
  assert.equal(c.engine.state.cards[c.id("sen")].damage ?? 0, 0);
});

clause(SENATE, "2:rule", "a face-down or not-in-play Senate reflects nothing", () => {
  const b = senateBoard([{ key: "atk", def: ch("Atk", 0, { strength: 3, life: 9 }), owner: P2, zone: "play" }, { key: "loc", def: location({ name: "Loc", structure: 9 }), owner: P1, zone: "play" }], { active: P2, senateZone: "discard" });
  fightThrough(b.engine, P2, [b.id("atk")], { type: "card", cardId: b.id("loc") }, []);
  assert.equal(b.engine.state.cards[b.id("atk")].damage ?? 0, 0);
});

// ===================== Tiny Shiny =====================
const shinyBoard = (extra: CardPlacement[], opts: { greed?: number; rage?: number; active?: PlayerId } = {}) =>
  mk(
    [
      { key: "ts", def: printing(SHINY), owner: P1, zone: "hand" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      { key: "hurt", def: damageTo("Hurt3", 3), owner: P1, zone: "hand" },
      { key: "hurt2", def: damageTo("Hurt3b", 3), owner: P1, zone: "hand" },
      { key: "hurt1", def: damageTo("Hurt1", 1), owner: P1, zone: "hand" },
      { key: "mine", def: ch("Mine", 0, { life: 6 }), owner: P1, zone: "play" },
      { key: "foe", def: ch("Foe", 0, { life: 6 }), owner: P2, zone: "play" },
      ...extra
    ],
    { active: opts.active }
  );
const dmgOf = (engine: SpoilsEngine, id: CardInstanceId) => engine.state.cards[id].damage ?? 0;

clause(SHINY, "0:extraCost", "printed cost 3, threshold [G], a tactic; payable exactly, refused one short and with the icon short", () => {
  assert.equal(printing(SHINY).type, "tactic");
  assert.equal(printing(SHINY).cost, 3);
  const ok = shinyBoard([]);
  play(ok.engine, P1, ok.id("ts"), sel("t", ok.id("mine")));
  assert.equal(readyResources(ok.engine, P1) - 1, 0, "3 paid (the new face-down resource is the only ready one)");
  const short = shinyBoard([], { greed: 2 });
  refused(() => play(short.engine, P1, short.id("ts"), sel("t", short.id("mine"))), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("ts")), "hand");
  const icon = shinyBoard([], { greed: 0, rage: 3 });
  refused(() => play(icon.engine, P1, icon.id("ts"), sel("t", icon.id("mine"))), "3 resources but no [G]");
  assert.equal(zoneOf(icon.engine, icon.id("ts")), "hand");
});

clause(SHINY, "0:extraCost", "EXTRA COST: you must pick a character (yours or theirs); non-characters and characters out of play can't be picked; no pick, no cast", () => {
  for (const good of ["mine", "foe"]) {
    const b = shinyBoard([]);
    play(b.engine, P1, b.id("ts"), sel("t", b.id(good)));
    assert.equal(zoneOf(b.engine, b.id("ts")), "play", `${good} is a legal pick`);
  }
  for (const [key, def, zone] of [
    ["itm", item({ name: "Gadget", cost: 0 }), "play"],
    ["gone", ch("Gone", 0), "discard"]
  ] as const) {
    const b = shinyBoard([{ key, def, owner: P2, zone }]);
    refused(() => play(b.engine, P1, b.id("ts"), sel("t", b.id(key))), `${key} is not a character in play`);
    assert.equal(zoneOf(b.engine, b.id("ts")), "hand");
    assert.equal(readyResources(b.engine, P1), 3, "nothing was paid");
  }
  const none = shinyBoard([]);
  refused(() => play(none.engine, P1, none.id("ts")), "no character picked");
  assert.equal(zoneOf(none.engine, none.id("ts")), "hand");
  const lonely = mk([{ key: "ts", def: printing(SHINY), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]);
  refused(() => play(lonely.engine, P1, lonely.id("ts")), "with no character in play there is nothing to pick");
  assert.equal(zoneOf(lonely.engine, lonely.id("ts")), "hand");
});

clause(SHINY, "1:rule", "the next damage inflicted to the picked character this turn is reduced by 2 (3 becomes 1); other characters are not protected", () => {
  for (const who of ["mine", "foe"]) {
    const b = shinyBoard([]);
    play(b.engine, P1, b.id("ts"), sel("t", b.id(who)));
    const other = who === "mine" ? "foe" : "mine";
    play(b.engine, P1, b.id("hurt"), sel("t", b.id(who)));
    assert.equal(dmgOf(b.engine, b.id(who)), 1, `${who}: 3 - 2 = 1`);
    play(b.engine, P1, b.id("hurt2"), sel("t", b.id(other)));
    assert.equal(dmgOf(b.engine, b.id(other)), 3, "the other character takes the full 3");
  }
});

clause(SHINY, "1:rule", "only the NEXT damage: a second hit is not reduced; damage of 1 is reduced to 0 and still uses it up", () => {
  const b = shinyBoard([]);
  play(b.engine, P1, b.id("ts"), sel("t", b.id("mine")));
  play(b.engine, P1, b.id("hurt"), sel("t", b.id("mine")));
  play(b.engine, P1, b.id("hurt2"), sel("t", b.id("mine")));
  assert.equal(dmgOf(b.engine, b.id("mine")), 4, "1 + full 3");
  const c = shinyBoard([]);
  play(c.engine, P1, c.id("ts"), sel("t", c.id("mine")));
  play(c.engine, P1, c.id("hurt1"), sel("t", c.id("mine")));
  assert.equal(dmgOf(c.engine, c.id("mine")), 0, "1 - 2 floors at 0");
});

clause(SHINY, "1:rule", "a damage of 1 uses up the whole reduction: the following damage is not reduced by the leftover", () => {
  const c = shinyBoard([]);
  play(c.engine, P1, c.id("ts"), sel("t", c.id("mine")));
  play(c.engine, P1, c.id("hurt1"), sel("t", c.id("mine")));
  play(c.engine, P1, c.id("hurt"), sel("t", c.id("mine")));
  assert.equal(dmgOf(c.engine, c.id("mine")), 3, "the reduction was used up by the 1-damage hit");
});

clause(SHINY, "1:rule", "battle damage counts as damage: the next damage the character takes in a fight is reduced by 2", () => {
  const b = shinyBoard([{ key: "blk", def: ch("Blocker", 0, { strength: 4, life: 9, speed: 1 }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("ts"), sel("t", b.id("mine")));
  fightThrough(b.engine, P1, [b.id("mine")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(dmgOf(b.engine, b.id("mine")), 2, "4 - 2 = 2");
  assert.equal(dmgOf(b.engine, b.id("blk")), 1, "the blocker still takes the attacker's 1");
});

clause(SHINY, "1:rule", "'this turn': an unused reduction is gone on the next turn", () => {
  const b = shinyBoard([{ key: "hurtP2", def: damageTo("HurtP2", 3), owner: P2, zone: "hand" }]);
  play(b.engine, P1, b.id("ts"), sel("t", b.id("mine")));
  endTurn(b.engine, P1);
  drain(b.engine, declineAll);
  play(b.engine, P2, b.id("hurtP2"), sel("t", b.id("mine")));
  assert.equal(dmgOf(b.engine, b.id("mine")), 3, "the full 3 on the next turn");
});

clause(SHINY, "1:rule", "instead of the discard pile, it goes into play under its owner's control as a face-down resource", () => {
  const b = shinyBoard([]);
  play(b.engine, P1, b.id("ts"), sel("t", b.id("mine")));
  const card = b.engine.state.cards[b.id("ts")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true, "face-down");
  assert.equal(card.ownerId, P1);
  assert.equal(card.controllerId, P1);
  assert.ok(!b.engine.state.players[P1].discard.includes(b.id("ts")), "not in the discard pile");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("ts")), "b.engine.state.players[P1].play.includes(b.id(\"ts\"))");
  assert.ok(b.engine.isResource(b.id("ts")), "it is a resource");
  assert.equal(readyResources(b.engine, P1), 1, "and it provides a resource");
});

clause(SHINY, "1:rule", "the face-down resource is also kept when the tactic's owner is the opponent's player (P2 casting their own copy)", () => {
  const b = mk(
    [
      { key: "ts", def: printing(SHINY), owner: P2, zone: "hand" },
      ...bank("greed", 3, P2),
      { key: "mine", def: ch("Mine", 0, { life: 6 }), owner: P1, zone: "play" }
    ],
    { active: P2 }
  );
  play(b.engine, P2, b.id("ts"), sel("t", b.id("mine")));
  const card = b.engine.state.cards[b.id("ts")];
  assert.deepEqual([card.zone, card.faceDown, card.controllerId], ["play", true, P2]);
  assert.ok(!b.engine.state.players[P2].discard.includes(b.id("ts")), "!b.engine.state.players[P2].discard.includes(b.id(\"ts\"))");
});

// ===================== Treasure Brokerage =====================
const gold = () => resourceCard({ name: "Gold", resource: { provides: ["greed"], staple: true } });
const silver = () => resourceCard({ name: "Silver", resource: { provides: ["elitism"], staple: true } });
const rare = () => resourceCard({ name: "Rare Gem", resource: { provides: ["greed"], staple: false } });
const brokerBoard = (extra: CardPlacement[] = [], opts: { greed?: number; brokerController?: PlayerId; active?: PlayerId } = {}) =>
  mk(
    [
      { key: "bro", def: printing(BROKER), owner: P1, zone: "play", controller: opts.brokerController },
      { key: "c0", def: ch("Free", 0), owner: P1, zone: "hand" },
      { key: "c1", def: ch("One", 1), owner: P1, zone: "hand" },
      { key: "gold", def: gold(), owner: P1, zone: "deck" },
      { key: "silver", def: silver(), owner: P1, zone: "deck" },
      { key: "rare", def: rare(), owner: P1, zone: "deck" },
      { key: "dude", def: ch("Dude", 0), owner: P1, zone: "deck" },
      { key: "ogold", def: gold(), owner: P2, zone: "deck" },
      ...bank("greed", opts.greed ?? 2, P1),
      ...extra
    ],
    { active: opts.active, random: () => 0.5 }
  );

clause(BROKER, "0:rule", "printed cost 2, threshold [G], a location with structure 5; payable exactly, refused one short and with the icon short", () => {
  const d = printing(BROKER);
  assert.equal(d.type, "location");
  assert.equal(d.cost, 2);
  assert.equal(d.structure, 5);
  const mkH = (greed: number, rage: number) =>
    mk([{ key: "bro", def: printing(BROKER), owner: P1, zone: "hand" }, ...bank("greed", greed, P1), ...bank("rage", rage, P1)]);
  const ok = mkH(2, 0);
  play(ok.engine, P1, ok.id("bro"));
  assert.equal(zoneOf(ok.engine, ok.id("bro")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "2 paid");
  assert.equal(ok.engine.getStat(ok.id("bro"), "structure"), 5);
  const short = mkH(1, 0);
  refused(() => play(short.engine, P1, short.id("bro")), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("bro")), "hand");
  const icon = mkH(0, 2);
  refused(() => play(icon.engine, P1, icon.id("bro")), "2 resources but no [G]");
  assert.equal(zoneOf(icon.engine, icon.id("bro")), "hand");
});

clause(BROKER, "0:rule", "when your character enters play you may pay 1 (exactly 1): you pick one staple resource from your deck, it is revealed and goes to your hand", () => {
  const b = brokerBoard();
  const deckBefore = [...b.engine.state.players[P1].deck];
  play(b.engine, P1, b.id("c0"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1);
  answerPending(b.engine, "mayPay", { pay: true });
  const pick = pending(b.engine) as unknown as { kind: string; playerId: string };
  assert.equal(pick.kind, "chooserSelectsTarget");
  assert.equal(pick.playerId, P1, "you choose");
  // (A search for a staple resource has specific criteria, so CR 312.2 lets the player fail it: an empty pick is no longer refused here.)
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("silver")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.ok(hand(b.engine, P1).includes(b.id("silver")), "in hand");
  assert.ok(!b.engine.state.players[P1].deck.includes(b.id("silver")), "gone from the deck");
  assert.ok(b.engine.state.players[P1].deck.includes(b.id("gold")), "the other staple stays");
  assert.equal(b.engine.state.players[P1].deck.length, deckBefore.length - 1, "only one card left the deck");
  assert.equal(readyResources(b.engine, P1), 1, "exactly 1 paid (2 -> 1)");
  const reveals = b.engine.getLog().filter(e => e.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1);
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [b.id("silver")], "the found card is revealed");
  assert.equal(ev.viewerId, "all", "to everyone");
});

clause(BROKER, "0:rule", "non-staple resources, non-resource cards and the opponent's deck are not searchable", () => {
  const b = brokerBoard();
  play(b.engine, P1, b.id("c0"));
  answerPending(b.engine, "mayPay", { pay: true });
  for (const bad of ["rare", "dude", "ogold"]) {
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(bad)] }), `${bad} is not a staple resource in your deck`);
  }
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("gold")] });
  assert.ok(hand(b.engine, P1).includes(b.id("gold")), "control: a staple is fine");
  assert.ok(!hand(b.engine, P1).includes(b.id("rare")), "!hand(b.engine, P1).includes(b.id(\"rare\"))");
});

clause(BROKER, "0:rule", "'may': declining the payment finds nothing and spends nothing", () => {
  const b = brokerBoard();
  const handBefore = hand(b.engine, P1).length;
  play(b.engine, P1, b.id("c0"));
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(hand(b.engine, P1).length, handBefore - 1, "only the played character left the hand");
  assert.equal(readyResources(b.engine, P1), 2);
  assert.ok(b.engine.state.players[P1].deck.includes(b.id("gold")), "b.engine.state.players[P1].deck.includes(b.id(\"gold\"))");
  assert.ok(b.engine.state.players[P1].deck.includes(b.id("silver")), "b.engine.state.players[P1].deck.includes(b.id(\"silver\"))");
});

clause(BROKER, "0:rule", "you can't pay 1 with no resource left: no payment is offered, nothing is searched, nothing enters your hand, the deck keeps its order", () => {
  const b = brokerBoard([], { greed: 1 });
  const deckBefore = [...b.engine.state.players[P1].deck];
  play(b.engine, P1, b.id("c1")); // spends the only resource
  assert.equal(readyResources(b.engine, P1), 0);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing to pay with: no 'may pay' is offered");
  assert.deepEqual([...b.engine.state.players[P1].deck], deckBefore, "no search, so no shuffle either");
  assert.ok(!hand(b.engine, P1).includes(b.id("gold")) && !hand(b.engine, P1).includes(b.id("silver")), "no staple found");
  // control: one more resource and the same play does offer the payment
  const c = brokerBoard([], { greed: 2 });
  play(c.engine, P1, c.id("c1"));
  assert.equal(pending(c.engine)?.kind, "mayPay", "with 1 left after the play the payment is offered");
});

clause(BROKER, "0:rule", "after finding a staple the rest of the deck is shuffled (CR 312.1); declining the payment searches nothing and leaves the order alone", () => {
  const b = brokerBoard();
  const before = [...b.engine.state.players[P1].deck];
  play(b.engine, P1, b.id("c0"));
  answerPending(b.engine, "mayPay", { pay: true });
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("silver")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  const remaining = before.filter(c => c !== b.id("silver"));
  assert.deepEqual([...b.engine.state.players[P1].deck].sort(), [...remaining].sort(), "same remaining cards");
  assert.notDeepEqual(shuffledWithConstant(remaining, 0.5), remaining, "the fixture's shuffle changes the order");
  assert.deepEqual(b.engine.state.players[P1].deck, shuffledWithConstant(remaining, 0.5), "shuffled after the search");
  // declined payment: no search, no shuffle
  const d = brokerBoard();
  const dBefore = [...d.engine.state.players[P1].deck];
  play(d.engine, P1, d.id("c0"));
  answerPending(d.engine, "mayPay", { pay: false });
  assert.deepEqual(d.engine.state.players[P1].deck, dBefore, "no search, order untouched");
});

clause(BROKER, "0:rule", "a paid search that finds nothing still shuffles the deck (CR 312.1 / 312.2)", () => {
  const n = mk(
    [
      { key: "bro", def: printing(BROKER), owner: P1, zone: "play" },
      { key: "c0", def: ch("Free", 0), owner: P1, zone: "hand" },
      { key: "rare", def: rare(), owner: P1, zone: "deck" },
      { key: "dude", def: ch("Dude", 0), owner: P1, zone: "deck" },
      { key: "dude2", def: ch("Dude2", 0), owner: P1, zone: "deck" },
      ...bank("greed", 2, P1)
    ],
    { random: () => 0.5 }
  );
  const nBefore = [...n.engine.state.players[P1].deck];
  assert.notDeepEqual(shuffledWithConstant(nBefore, 0.5), nBefore, "the fixture's shuffle changes the order");
  play(n.engine, P1, n.id("c0"));
  drain(n.engine, c => (c.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(c)));
  assert.equal(n.engine.state.pendingChoice, undefined);
  assert.deepEqual(n.engine.state.players[P1].deck, shuffledWithConstant(nBefore, 0.5), "shuffled even though nothing was found");
});

clause(BROKER, "0:rule", "no staple resource in the deck: paying finds nothing and the game goes on", () => {
  const b = mk([
    { key: "bro", def: printing(BROKER), owner: P1, zone: "play" },
    { key: "c0", def: ch("Free", 0), owner: P1, zone: "hand" },
    { key: "rare", def: rare(), owner: P1, zone: "deck" },
    { key: "dude", def: ch("Dude", 0), owner: P1, zone: "deck" },
    ...bank("greed", 2, P1)
  ]);
  play(b.engine, P1, b.id("c0"));
  drain(b.engine, c => (c.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(c)));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(b.engine.state.players[P1].deck.length, 2, "deck unchanged in size");
  assert.ok(!hand(b.engine, P1).includes(b.id("rare")), "!hand(b.engine, P1).includes(b.id(\"rare\"))");
});

clause(BROKER, "0:rule", "each character entering triggers it separately", () => {
  const b = brokerBoard([], { greed: 4 });
  play(b.engine, P1, b.id("c0"));
  answerPending(b.engine, "mayPay", { pay: true });
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("gold")] });
  play(b.engine, P1, b.id("c1"));
  assert.equal(pending(b.engine)?.kind, "mayPay", "a second character triggers it again");
  answerPending(b.engine, "mayPay", { pay: true });
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("silver")] });
  assert.ok(hand(b.engine, P1).includes(b.id("gold")) && hand(b.engine, P1).includes(b.id("silver")), "hand(b.engine, P1).includes(b.id(\"gold\")) && hand(b.engine, P1).includes(b.id(\"silver\"))");
});

clause(BROKER, "0:rule", "does not trigger for a non-character entering, nor for the opponent's character entering", () => {
  const b = brokerBoard(
    [
      { key: "itm", def: item({ name: "Gadget", cost: 0 }), owner: P1, zone: "hand" },
      { key: "loc", def: location({ name: "Place", cost: 0 }), owner: P1, zone: "hand" }
    ]
  );
  play(b.engine, P1, b.id("itm"));
  assert.equal(b.engine.state.pendingChoice, undefined, "item");
  play(b.engine, P1, b.id("loc"));
  assert.equal(b.engine.state.pendingChoice, undefined, "location");
  const o = mk(
    [
      { key: "bro", def: printing(BROKER), owner: P1, zone: "play" },
      { key: "oc", def: ch("Their", 0), owner: P2, zone: "hand" },
      { key: "gold", def: gold(), owner: P1, zone: "deck" },
      ...bank("greed", 2, P1)
    ],
    { active: P2 }
  );
  play(o.engine, P2, o.id("oc"));
  assert.equal(o.engine.state.pendingChoice, undefined, "opponent's character");
  assert.ok(!hand(o.engine, P1).includes(o.id("gold")), "!hand(o.engine, P1).includes(o.id(\"gold\"))");
});

clause(BROKER, "0:rule", "'under your control' means the Brokerage's controller: a Brokerage you took serves you, and not its owner", () => {
  const b = brokerBoard([], { brokerController: P2 });
  play(b.engine, P1, b.id("c0"));
  assert.equal(b.engine.state.pendingChoice, undefined, "P2 controls the Brokerage: P1's character doesn't trigger it");
  const c = mk(
    [
      { key: "bro", def: printing(BROKER), owner: P1, zone: "play", controller: P2 },
      { key: "oc", def: ch("Their", 0), owner: P2, zone: "hand" },
      { key: "ogold", def: gold(), owner: P2, zone: "deck" },
      ...bank("greed", 2, P2)
    ],
    { active: P2 }
  );
  play(c.engine, P2, c.id("oc"));
  const pc = pending(c.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "its controller P2 gets the offer");
  answerPending(c.engine, "mayPay", { pay: true });
  answerPending(c.engine, "chooserSelectsTarget", { selected: [c.id("ogold")] });
  assert.ok(hand(c.engine, P2).includes(c.id("ogold")), "hand(c.engine, P2).includes(c.id(\"ogold\"))");
});

clause(BROKER, "0:rule", "a card developed face-down is a resource, not an entering character: no trigger", () => {
  const mkD = (faceDown: boolean) => {
    const b = mk(
      [
        { key: "bro", def: printing(BROKER), owner: P1, zone: "play" },
        { key: "dev", def: ch("Dev", 2), owner: P1, zone: "hand" },
        { key: "gold", def: gold(), owner: P1, zone: "deck" },
        ...bank("greed", 2, P1)
      ],
      { active: P1 }
    );
    developResource(b.engine, P1, b.id("dev"), faceDown);
    return b;
  };
  const down = mkD(true);
  assert.equal(zoneOf(down.engine, down.id("dev")), "play", "the develop worked");
  assert.equal(down.engine.state.cards[down.id("dev")].faceDown, true);
  assert.equal(down.engine.state.pendingChoice, undefined, "a face-down resource is not a character entering play");
  assert.ok(!hand(down.engine, P1).includes(down.id("gold")), "!hand(down.engine, P1).includes(down.id(\"gold\"))");
});
