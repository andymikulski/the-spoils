// Clause tests — batch seed-saga-02, part p3 (groups 11-15).
import assert from "node:assert/strict";
import { buildGame, activate, autoResolveBattle, bank, character, developFaction, item, play, resolvePendingResponses, tactic, P1, P2 } from "../per-card/_harness.js";
import { killTactic } from "../per-card/_harness.js";
import { clause, printing, refused, flipUpNow, holdResourceFace } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fight, covertHasKeyword, covertCannotBeBlockedByNonCovert, covertPartyNeedsEveryMemberCovert, covertBlocksOnlyCovertParties } from "./_battle.js";
import { declareBlockers, pending } from "./_board.js";
import { endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

const NATTER = "bffab378-d737-4064-a1cb-58e89b1ea6eb"; // character cost 5 "oo" 3/3/3 monstrosity, COVERT, FLIP UP 3 oo
const HORROR = "6a568b43-e53e-4c0f-915d-df90aa61872e"; // character cost 4 "o" 2/3/2 monstrosity, COVERT
const ASTROLOGER = "714539aa-b01d-4d6e-8d48-dc0cdc94d649"; // character cost 2 "o" 1/3/2 wizard
const COMMUNION = "65721d28-4626-40df-a980-d153c8e5fd15"; // item cost 2 "oo"
const OBSCURE = "1abadfc1-9405-48d3-a867-93a2b0e662ef"; // tactic cost 0 "o", FLIP UP 2 o

// --- helpers ---------------------------------------------------------------------
const O = (n: number, owner: PlayerId = P1): CardPlacement[] => bank("obsession", n, owner);
const R = (n: number, owner: PlayerId = P1): CardPlacement[] => bank("rage", n, owner);
/** n obsession resources already SPENT (attached to the faction): they count for the threshold but cannot pay. */
const spentO = (n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank("obsession", n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const brd = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });
const zoneNow = (engine: SpoilsEngine, id: CardInstanceId): string => engine.state.cards[id].zone as string;
const kws = (engine: SpoilsEngine, id: CardInstanceId): string[] => [...(engine.getKeywords(id) as Iterable<string>)].map((k) => String(k).toLowerCase());
const stats = (engine: SpoilsEngine, id: CardInstanceId): number[] => [engine.getStat(id, "strength"), engine.getStat(id, "speed"), engine.getStat(id, "life")];
const tokens = (engine: SpoilsEngine, id: CardInstanceId): number => engine.state.cards[id].counters?.token ?? 0;
const isFaceDown = (engine: SpoilsEngine, id: CardInstanceId): boolean => engine.state.cards[id].faceDown === true;
const ctrl = (engine: SpoilsEngine, id: CardInstanceId): string => (engine.state.cards[id] as unknown as { controllerId: string }).controllerId;
const flipUpRaw = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void => {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
};
const ch = (name: string, extra: Record<string, unknown> = {}) => character({ name, strength: 2, speed: 2, life: 3, ...extra } as never);
const covertCh = (name: string, s = 2, sp = 2, l = 3) => character({ name, strength: s, speed: sp, life: l, behavior: { keywords: ["covert"] } } as never);
const killAbility = (id: string) => ({ id, type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] });

// =================================================================================
// Nattering Stoopswaggler
// =================================================================================
const natter = (opts: { faceDown?: boolean; zone?: "play" | "hand"; counters?: Record<string, number>; owner?: PlayerId; controller?: PlayerId } = {}, res: CardPlacement[] = [], extra: CardPlacement[] = [], g: Parameters<typeof buildGame>[0] = {}) =>
  brd(
    [
      {
        key: "n",
        def: printing(NATTER),
        owner: opts.owner ?? P1,
        zone: opts.zone ?? "play",
        ...(opts.faceDown ? { faceDown: true } : {}),
        ...(opts.counters ? { counters: opts.counters } : {}),
        ...(opts.controller ? { controller: opts.controller } : {})
      },
      ...res,
      ...extra
    ],
    g
  );
const nFlip = (res: CardPlacement[], extra: CardPlacement[] = [], g: Parameters<typeof buildGame>[0] = {}) => natter({ faceDown: true }, res, extra, g);

clause(NATTER, "0:kw:COVERT", "COVERT: cannot be blocked by non-covert characters; covert ones can", () => covertCannotBeBlockedByNonCovert(NATTER));
clause(NATTER, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(NATTER));
clause(NATTER, "0:kw:COVERT", "COVERT: a party needs every member covert", () => covertPartyNeedsEveryMemberCovert(NATTER));
clause(NATTER, "0:kw:COVERT", "COVERT: as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(NATTER));

clause(NATTER, "0:kw:COVERT", "printed card: character, monstrosity, 3 strength / 3 speed / 3 life, no token when deployed from hand", () => {
  const def = printing(NATTER);
  assert.equal(def.type, "character");
  assert.deepEqual([...(def.subtype ?? [])], ["monstrosity"]);
  const g = natter({ zone: "hand" }, [...O(2), ...R(3)]);
  play(g.engine, P1, g.id("n"));
  assert.equal(zoneNow(g.engine, g.id("n")), "play");
  assert.deepEqual(stats(g.engine, g.id("n")), [3, 3, 3]);
  assert.equal(g.engine.getStat(g.id("n"), "speed"), 3);
  assert.equal(tokens(g.engine, g.id("n")), 0, "deployed from hand: no token");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "cost 5 was paid in full");
});

clause(NATTER, "0:kw:COVERT", "deploy cost 5: one resource short is refused", () => {
  const g = natter({ zone: "hand" }, [...O(2), ...R(2)]);
  refused(() => play(g.engine, P1, g.id("n")), "4 resources for cost 5", /Costs cannot be paid/);
  assert.equal(zoneNow(g.engine, g.id("n")), "hand");
  const ok = natter({ zone: "hand" }, [...O(2), ...R(3)]);
  play(ok.engine, P1, ok.id("n"));
  assert.equal(zoneNow(ok.engine, ok.id("n")), "play", "positive control");
});

clause(NATTER, "0:kw:COVERT", "deploy threshold [O][O]: five resources with only one [O] (or none) is refused", () => {
  const one = natter({ zone: "hand" }, [...O(1), ...R(4)]);
  refused(() => play(one.engine, P1, one.id("n")), "one [O] only");
  assert.equal(zoneNow(one.engine, one.id("n")), "hand");
  const none = natter({ zone: "hand" }, [...R(5)]);
  refused(() => play(none.engine, P1, none.id("n")), "no [O]");
  assert.equal(zoneNow(none.engine, none.id("n")), "hand");
});

// 1:rule — enters play with a token when deployed using FLIP UP
clause(NATTER, "1:rule", "deployed using FLIP UP it enters play with a token; deployed from hand it has none", () => {
  const g = nFlip([...spentO(2), ...R(3)]);
  assert.equal(tokens(g.engine, g.id("n")), 0, "face-down: none yet");
  flipUpRaw(g.engine, P1, g.id("n"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isFaceDown(g.engine, g.id("n")), false);
  assert.equal(tokens(g.engine, g.id("n")), 1, "exactly one token");
  const h = natter({ zone: "hand" }, [...O(2), ...R(3)]);
  play(h.engine, P1, h.id("n"));
  assert.equal(tokens(h.engine, h.id("n")), 0);
});

clause(NATTER, "1:rule", "a flipped-up Stoopswaggler is therefore 4/3/4 and has lost COVERT", () => {
  const g = nFlip([...spentO(2), ...R(3)]);
  flipUpRaw(g.engine, P1, g.id("n"));
  resolvePendingResponses(g.engine);
  assert.deepEqual(stats(g.engine, g.id("n")), [4, 3, 4]);
  assert.ok(!kws(g.engine, g.id("n")).includes("covert"), "!kws(g.engine, g.id(\"n\")).includes(\"covert\")");
});

// 2:rule — token buff
clause(NATTER, "2:rule", "with a token: +1 strength and +1 life (speed unchanged) and it loses COVERT", () => {
  const g = natter({ counters: { token: 1 } }, [], [{ key: "o", def: ch("Other"), owner: P1, zone: "play" }]);
  assert.deepEqual(stats(g.engine, g.id("n")), [4, 3, 4]);
  assert.ok(!kws(g.engine, g.id("n")).includes("covert"), "COVERT suppressed");
  assert.deepEqual(stats(g.engine, g.id("o")), [2, 2, 3], "other characters are not buffed");
});

clause(NATTER, "2:rule", "without a token: printed 3/3/3 and COVERT", () => {
  const g = natter({});
  assert.deepEqual(stats(g.engine, g.id("n")), [3, 3, 3]);
  assert.ok(kws(g.engine, g.id("n")).includes("covert"), "kws(g.engine, g.id(\"n\")).includes(\"covert\")");
});

clause(NATTER, "2:rule", "two tokens still give only +1 / +1; removing the tokens ends the buff and restores COVERT", () => {
  const g = natter({ counters: { token: 2 } });
  assert.deepEqual(stats(g.engine, g.id("n")), [4, 3, 4], "while there is a token: +1 / +1 (not per token)");
  g.engine.state.cards[g.id("n")].counters = {};
  assert.deepEqual(stats(g.engine, g.id("n")), [3, 3, 3], "no token: buff off");
  assert.ok(kws(g.engine, g.id("n")).includes("covert"), "COVERT back");
  const again = natter({ counters: { token: 1 } });
  again.engine.state.cards[again.id("n")].counters = {};
  assert.deepEqual(stats(again.engine, again.id("n")), [3, 3, 3]);
});

clause(NATTER, "2:rule", "with a token it is no longer covert in battle: a non-covert character may block it; without one it may not", () => {
  const withTok = brd(
    [{ key: "n", def: printing(NATTER), owner: P1, zone: "play", counters: { token: 1 } }, { key: "blk", def: ch("Plain"), owner: P2, zone: "play" }]
  );
  declareAttackBy(withTok.engine, P1, [withTok.id("n")]);
  withTok.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [withTok.id("blk")] });
  assert.deepEqual(withTok.engine.state.battle?.blockingParty, [withTok.id("blk")]);
  const noTok = brd([{ key: "n", def: printing(NATTER), owner: P1, zone: "play" }, { key: "blk", def: ch("Plain"), owner: P2, zone: "play" }]);
  declareAttackBy(noTok.engine, P1, [noTok.id("n")]);
  refused(() => noTok.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [noTok.id("blk")] }), "covert: unblockable by plain");
});

clause(NATTER, "2:rule", "the +1 life is real: with a token, 3 damage does not destroy it", () => {
  const tok = brd([
    { key: "n", def: printing(NATTER), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "atk", def: ch("Atk", { strength: 3, speed: 1, life: 9 }), owner: P2, zone: "play" }
  ], { turn: 2, activePlayerId: P2 });
  fight(tok.engine, P2, [tok.id("atk")], { type: "faction", playerId: P1 }, [tok.id("n")]);
  assert.equal(zoneNow(tok.engine, tok.id("n")), "play");
  assert.equal(isFaceDown(tok.engine, tok.id("n")), false, "survived normally, not flipped");
  assert.equal(tok.engine.state.cards[tok.id("n")].damage, 3);
});

// 3:rule — flip face-down instead of being destroyed
clause(NATTER, "3:rule", "no tokens and it would be destroyed (battle): it is flipped face-down instead and stays in play", () => {
  const g = brd([
    { key: "n", def: printing(NATTER), owner: P1, zone: "play" },
    { key: "atk", def: covertCh("Atk", 5, 1, 9), owner: P2, zone: "play" }
  ], { turn: 2, activePlayerId: P2 });
  fight(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("n")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("n")), "play", "not in the discard pile");
  assert.equal(isFaceDown(g.engine, g.id("n")), true);
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("n")), "!g.engine.state.players[P1].discard.includes(g.id(\"n\"))");
  assert.equal(ctrl(g.engine, g.id("n")), P1);
});

clause(NATTER, "3:rule", "no tokens and destroyed by an effect: flipped face-down instead (still in play, not discarded)", () => {
  const g = brd([
    { key: "n", def: printing(NATTER), owner: P1, zone: "play" },
    { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
  ], { turn: 2, activePlayerId: P2 });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("n")] } });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("n")), "play");
  assert.equal(isFaceDown(g.engine, g.id("n")), true);
  assert.equal(ctrl(g.engine, g.id("n")), P1);
});

clause(NATTER, "3:rule", "with a token the replacement does not apply: it is destroyed normally", () => {
  const g = brd([
    { key: "n", def: printing(NATTER), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
  ], { turn: 2, activePlayerId: P2 });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("n")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneNow(g.engine, g.id("n")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("n")), false);
});

clause(NATTER, "3:rule", "another character being destroyed is not replaced (only this card)", () => {
  const g = brd([
    { key: "n", def: printing(NATTER), owner: P1, zone: "play" },
    { key: "o", def: ch("Other"), owner: P1, zone: "play" },
    { key: "kill", def: killTactic(), owner: P2, zone: "hand" }
  ], { turn: 2, activePlayerId: P2 });
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("o")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneNow(g.engine, g.id("o")), "discard");
  assert.equal(zoneNow(g.engine, g.id("n")), "play");
  assert.equal(isFaceDown(g.engine, g.id("n")), false);
});

clause(NATTER, "3:rule", "an opponent-controlled Stoopswaggler is flipped face-down under its OWNER's control", () => {
  const g = brd([
    { key: "n", def: printing(NATTER), owner: P1, controller: P2, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
  ]);
  assert.equal(ctrl(g.engine, g.id("n")), P2, "setup: P2 controls it");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("n")] } });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("n")), "play");
  assert.equal(isFaceDown(g.engine, g.id("n")), true);
  assert.equal(ctrl(g.engine, g.id("n")), P1, "face-down under its owner's control");
});

// 4:flipUp
clause(NATTER, "4:flipUp", "FLIP UP 3 [O][O]: exact cost with the card paying for itself (2 other resources) works", () => {
  const g = nFlip([...spentO(2), ...R(2)]);
  flipUpRaw(g.engine, P1, g.id("n"));
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("n")), false);
  assert.equal(zoneNow(g.engine, g.id("n")), "play");
  assert.equal(tokens(g.engine, g.id("n")), 1);
});

clause(NATTER, "4:flipUp", "FLIP UP cost 3: one resource short is refused; with spares exactly 3 are spent", () => {
  const short = nFlip([...spentO(2), ...R(1)]);
  refused(() => flipUpRaw(short.engine, P1, short.id("n")), "cost short", /FLIP UP costs cannot be paid/);
  assert.equal(isFaceDown(short.engine, short.id("n")), true);
  const spare = nFlip([...spentO(2), ...R(5)]);
  flipUpRaw(spare.engine, P1, spare.id("n"));
  resolvePendingResponses(spare.engine);
  const ready = spare.engine.getAvailableResourceCount(P1);
  assert.ok(ready === 3 || ready === 2, `five spares minus a cost of 3 (itself may pay): ${ready}`);
});

clause(NATTER, "4:flipUp", "FLIP UP threshold [O][O]: one [O] or none is refused even with plenty of resources", () => {
  const one = nFlip([...spentO(1), ...R(6)]);
  refused(() => flipUpRaw(one.engine, P1, one.id("n")), "one [O]");
  assert.equal(isFaceDown(one.engine, one.id("n")), true);
  const none = nFlip([...R(7)]);
  refused(() => flipUpRaw(none.engine, P1, none.id("n")), "no [O]");
  const ok = nFlip([...spentO(2), ...R(2)]);
  flipUpRaw(ok.engine, P1, ok.id("n"));
  resolvePendingResponses(ok.engine);
  assert.equal(isFaceDown(ok.engine, ok.id("n")), false, "positive control");
});

clause(NATTER, "4:flipUp", "a face-up Stoopswaggler cannot be flipped up", () => {
  const g = natter({}, [...spentO(2), ...R(3)]);
  refused(() => flipUpRaw(g.engine, P1, g.id("n")), "already face up");
  assert.equal(tokens(g.engine, g.id("n")), 0);
});

clause(NATTER, "4:flipUp", "FLIP UP of a character is not allowed inside the opponent's response window (non-tactic)", () => {
  const atk = { key: "atk", def: ch("Atk"), owner: P2, zone: "play" as const };
  const g = nFlip([...spentO(2), ...R(3)], [atk], { turn: 2, activePlayerId: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => flipUpRaw(g.engine, P1, g.id("n")), "non-tactic in opponent's window");
  assert.equal(isFaceDown(g.engine, g.id("n")), true);
});

// =================================================================================
// Nefarious Horror
// =================================================================================
const horror = (mine: number, theirs: number, extra: CardPlacement[] = [], g: Parameters<typeof buildGame>[0] = {}) =>
  brd(
    [
      { key: "h", def: printing(HORROR), owner: P1, zone: "play" },
      ...Array.from({ length: mine }, (_, i) => ({ key: `m${i}`, def: ch(`Mine${i}`), owner: P1, zone: "play" as const })),
      ...Array.from({ length: theirs }, (_, i) => ({ key: `t${i}`, def: ch(`Theirs${i}`), owner: P2, zone: "play" as const })),
      ...extra
    ],
    g
  );
const hCard = (engine: SpoilsEngine, id: (k: string) => CardInstanceId) => ({ s: stats(engine, id("h")), k: kws(engine, id("h")) });

clause(HORROR, "0:kw:COVERT", "COVERT: cannot be blocked by non-covert characters; covert ones can", () => covertCannotBeBlockedByNonCovert(HORROR));
clause(HORROR, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(HORROR));
clause(HORROR, "0:kw:COVERT", "COVERT: a party needs every member covert", () => covertPartyNeedsEveryMemberCovert(HORROR));
clause(HORROR, "0:kw:COVERT", "COVERT: as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(HORROR));

clause(HORROR, "0:kw:COVERT", "printed card: character, monstrosity, 2 strength / 3 speed / 2 life; deploy cost 4 paid in full", () => {
  const def = printing(HORROR);
  assert.equal(def.type, "character");
  assert.deepEqual([...(def.subtype ?? [])], ["monstrosity"]);
  const g = brd([{ key: "h", def: printing(HORROR), owner: P1, zone: "hand" }, ...O(1), ...R(3)]);
  play(g.engine, P1, g.id("h"));
  assert.equal(zoneNow(g.engine, g.id("h")), "play");
  assert.deepEqual(stats(g.engine, g.id("h")), [2, 3, 2]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 0);
});

clause(HORROR, "0:kw:COVERT", "deploy cost 4: one resource short is refused", () => {
  const g = brd([{ key: "h", def: printing(HORROR), owner: P1, zone: "hand" }, ...O(1), ...R(2)]);
  refused(() => play(g.engine, P1, g.id("h")), "3 resources for cost 4", /Costs cannot be paid/);
  assert.equal(zoneNow(g.engine, g.id("h")), "hand");
});

clause(HORROR, "0:kw:COVERT", "deploy threshold [O]: four resources with no [O] is refused", () => {
  const g = brd([{ key: "h", def: printing(HORROR), owner: P1, zone: "hand" }, ...R(4)]);
  refused(() => play(g.engine, P1, g.id("h")), "no [O]");
  assert.equal(zoneNow(g.engine, g.id("h")), "hand");
  const spent = brd([{ key: "h", def: printing(HORROR), owner: P1, zone: "hand" }, ...spentO(1), ...R(4)]);
  play(spent.engine, P1, spent.id("h"));
  assert.equal(zoneNow(spent.engine, spent.id("h")), "play", "a spent [O] satisfies the threshold");
});

clause(HORROR, "1:rule", "an opponent with MORE characters than you: +2 strength, +2 life (speed unchanged) and COVERT is lost", () => {
  const g = horror(0, 2);
  assert.deepEqual(stats(g.engine, g.id("h")), [4, 3, 4]);
  assert.ok(!hCard(g.engine, g.id).k.includes("covert"), "!hCard(g.engine, g.id).k.includes(\"covert\")");
  const g3 = horror(1, 3);
  assert.deepEqual(stats(g3.engine, g3.id("h")), [4, 3, 4], "3 vs 2 also counts");
  assert.ok(!kws(g3.engine, g3.id("h")).includes("covert"), "!kws(g3.engine, g3.id(\"h\")).includes(\"covert\")");
});

clause(HORROR, "1:rule", "equal numbers of characters (including the Horror itself): no bonus, COVERT kept", () => {
  const g = horror(0, 1);
  assert.deepEqual(stats(g.engine, g.id("h")), [2, 3, 2]);
  assert.ok(kws(g.engine, g.id("h")).includes("covert"), "kws(g.engine, g.id(\"h\")).includes(\"covert\")");
  const g2 = horror(1, 2);
  assert.deepEqual(stats(g2.engine, g2.id("h")), [2, 3, 2]);
  assert.ok(kws(g2.engine, g2.id("h")).includes("covert"), "kws(g2.engine, g2.id(\"h\")).includes(\"covert\")");
});

clause(HORROR, "1:rule", "the opponent controlling fewer characters than you: no bonus", () => {
  const g = horror(2, 0);
  assert.deepEqual(stats(g.engine, g.id("h")), [2, 3, 2]);
  assert.ok(kws(g.engine, g.id("h")).includes("covert"), "kws(g.engine, g.id(\"h\")).includes(\"covert\")");
});

clause(HORROR, "1:rule", "only characters are counted: opposing items and my own items do not change the comparison", () => {
  const theirItems: CardPlacement[] = [
    { key: "ti1", def: item({ name: "TI1" }), owner: P2, zone: "play" },
    { key: "ti2", def: item({ name: "TI2" }), owner: P2, zone: "play" }
  ];
  const g = horror(0, 1, theirItems);
  assert.deepEqual(stats(g.engine, g.id("h")), [2, 3, 2], "1 vs 1 character (2 items don't count)");
  const myItems = horror(0, 2, [{ key: "mi", def: item({ name: "MI" }), owner: P1, zone: "play" }]);
  assert.deepEqual(stats(myItems.engine, myItems.id("h")), [4, 3, 4], "my item doesn't offset their 2nd character");
});

clause(HORROR, "1:rule", "face-down cards the opponent controls are not characters", () => {
  const g = horror(0, 1, [{ key: "fd", def: ch("Hidden"), owner: P2, zone: "play", faceDown: true }]);
  assert.deepEqual(stats(g.engine, g.id("h")), [2, 3, 2]);
  assert.ok(kws(g.engine, g.id("h")).includes("covert"), "kws(g.engine, g.id(\"h\")).includes(\"covert\")");
});

clause(HORROR, "1:rule", "the bonus applies to the Horror only, and it no longer has COVERT in battle (a plain character may block it)", () => {
  const g = horror(1, 3, [], {});
  assert.deepEqual(stats(g.engine, g.id("m0")), [2, 2, 3], "my other character is not buffed");
  declareAttackBy(g.engine, P1, [g.id("h")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("t0")] });
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("t0")]);
  const calm = horror(0, 1);
  declareAttackBy(calm.engine, P1, [calm.id("h")]);
  refused(() => calm.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [calm.id("t0")] }), "still covert");
});

clause(HORROR, "1:rule", "counts by control: a Horror controlled by the opponent compares ITS controller's characters", () => {
  const g = brd([
    { key: "h", def: printing(HORROR), owner: P1, controller: P2, zone: "play" },
    { key: "m0", def: ch("Mine0"), owner: P1, zone: "play" },
    { key: "m1", def: ch("Mine1"), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(stats(g.engine, g.id("h")), [4, 3, 4], "P1 controls 2, its controller P2 controls only the Horror");
  const eq = brd([
    { key: "h", def: printing(HORROR), owner: P1, controller: P2, zone: "play" },
    { key: "m0", def: ch("Mine0"), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(stats(eq.engine, eq.id("h")), [2, 3, 2]);
});

clause(HORROR, "1:rule", "the bonus turns off the moment the opponent's character count drops, and on when mine drops", () => {
  const g = horror(0, 2, [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  assert.deepEqual(stats(g.engine, g.id("h")), [4, 3, 4]);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("t0")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneNow(g.engine, g.id("t0")), "discard");
  assert.deepEqual(stats(g.engine, g.id("h")), [2, 3, 2], "1 vs 1 now");
  assert.ok(kws(g.engine, g.id("h")).includes("covert"), "kws(g.engine, g.id(\"h\")).includes(\"covert\")");
  const turn = horror(1, 2, [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }], { turn: 2, activePlayerId: P2 });
  assert.deepEqual(stats(turn.engine, turn.id("h")), [2, 3, 2]);
  play(turn.engine, P2, turn.id("kill"), { selected: { t: [turn.id("m0")] } });
  resolvePendingResponses(turn.engine);
  assert.deepEqual(stats(turn.engine, turn.id("h")), [4, 3, 4], "I lost a character: 1 vs 2 now");
  assert.ok(!kws(turn.engine, turn.id("h")).includes("covert"), "!kws(turn.engine, turn.id(\"h\")).includes(\"covert\")");
});

// =================================================================================
// Obscene Astrologer
// =================================================================================
const tac = (name: string, cost: number) =>
  tactic({ name, cost, behavior: { abilities: [{ id: `t${cost}`, type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never);
const astro = (res: CardPlacement[], extra: CardPlacement[] = [], tacCosts: number[] = [0, 1, 2, 3, 4, 5, 6]) =>
  brd([
    { key: "a", def: printing(ASTROLOGER), owner: P1, zone: "play" },
    ...tacCosts.map((c) => ({ key: `t${c}`, def: tac(`Tac${c}`, c), owner: P1, zone: "hand" as const })),
    ...Array.from({ length: 4 }, (_, i) => ({ key: `dk${i}`, def: ch(`Deck${i}`), owner: P1, zone: "deck" as const })),
    ...res,
    ...extra
  ]);
const offeredCosts = (engine: SpoilsEngine): number[] => {
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: CardInstanceId[] };
  assert.equal(pc?.kind, "deployForFree");
  assert.equal(pc.playerId, P1);
  return pc.candidates.map((c) => engine.getDefinition(c).cost ?? 0).sort((a, b) => a - b);
};
const gaze = (g: ReturnType<typeof astro>) => activate(g.engine, P1, g.id("a"), "gaze", {});
const freePlay = (engine: SpoilsEngine, cardId?: CardInstanceId) => {
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId } } as never);
  resolvePendingResponses(engine);
};

clause(ASTROLOGER, "0:ability:gaze", "printed card: wizard character 1 strength / 3 speed / 2 life; deploy cost 2 paid in full", () => {
  const def = printing(ASTROLOGER);
  assert.equal(def.type, "character");
  assert.deepEqual([...(def.subtype ?? [])], ["wizard"]);
  const g = brd([{ key: "a", def: printing(ASTROLOGER), owner: P1, zone: "hand" }, ...O(1), ...R(1)]);
  play(g.engine, P1, g.id("a"));
  assert.equal(zoneNow(g.engine, g.id("a")), "play");
  assert.deepEqual(stats(g.engine, g.id("a")), [1, 3, 2]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 0);
});

clause(ASTROLOGER, "0:ability:gaze", "deploy cost 2 (one short) and threshold [O] (none) are refused", () => {
  const short = brd([{ key: "a", def: printing(ASTROLOGER), owner: P1, zone: "hand" }, ...O(1)]);
  refused(() => play(short.engine, P1, short.id("a")), "1 resource for cost 2", /Costs cannot be paid/);
  const noIcon = brd([{ key: "a", def: printing(ASTROLOGER), owner: P1, zone: "hand" }, ...R(2)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("a")), "no [O]");
  assert.equal(zoneNow(noIcon.engine, noIcon.id("a")), "hand");
});

clause(ASTROLOGER, "0:ability:gaze", "COST: deplete this card; it cannot be used again while depleted", () => {
  const g = astro([...O(2)]);
  gaze(g);
  assert.equal(g.engine.state.cards[g.id("a")].depleted, true, "COST: deplete");
  freePlay(g.engine, undefined);
  g.engine.state.cards[g.id("a")].depleted = true;
  refused(() => gaze(g), "already depleted", /Ability costs cannot be paid/);
  const pre = astro([...O(2)]);
  pre.engine.state.cards[pre.id("a")].depleted = true;
  refused(() => gaze(pre), "starting depleted", /Ability costs cannot be paid/);
});

clause(ASTROLOGER, "0:ability:gaze", "X = number of [O] I control (2): tactics of cost 0..2 are offered, 3+ are not", () => {
  const g = astro([...O(2), ...R(4)]);
  gaze(g);
  assert.deepEqual(offeredCosts(g.engine), [0, 1, 2]);
});

clause(ASTROLOGER, "0:ability:gaze", "X counts every [O] I control including spent ones, not other icons or the opponent's", () => {
  const g = astro([...O(1), ...spentO(2), ...R(4), ...O(5, P2)]);
  gaze(g);
  assert.deepEqual(offeredCosts(g.engine), [0, 1, 2, 3], "3 [O] (1 ready + 2 spent)");
  const none = astro([...R(4)]);
  gaze(none);
  assert.deepEqual(offeredCosts(none.engine), [0], "no [O]: X = 0");
});

clause(ASTROLOGER, "0:ability:gaze", "X is capped at 5: with 5 [O] cost 5 is the highest; with 8 [O] cost 6 is still not offered", () => {
  const five = astro([...O(5)]);
  gaze(five);
  assert.deepEqual(offeredCosts(five.engine), [0, 1, 2, 3, 4, 5]);
  const six = astro([...O(6)]);
  gaze(six);
  assert.deepEqual(offeredCosts(six.engine), [0, 1, 2, 3, 4, 5], "6 [O] is still capped at 5");
  const eight = astro([...O(8)]);
  gaze(eight);
  assert.deepEqual(offeredCosts(eight.engine), [0, 1, 2, 3, 4, 5]);
  const four = astro([...O(4)]);
  gaze(four);
  assert.deepEqual(offeredCosts(four.engine), [0, 1, 2, 3, 4], "4 [O]: lower than 5 so X = 4");
});

clause(ASTROLOGER, "0:ability:gaze", "deploys the chosen tactic for free: no resources spent, the tactic resolves, and goes to the discard pile", () => {
  const g = astro([...O(3), ...R(2)]);
  const handBefore = g.engine.state.players[P1].hand.length;
  gaze(g);
  freePlay(g.engine, g.id("t3"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.getAvailableResourceCount(P1), 5, "a cost-3 tactic was deployed for free");
  assert.equal(zoneNow(g.engine, g.id("t3")), "discard");
  assert.equal(g.engine.state.players[P1].hand.length, handBefore - 1 + 1, "tactic left the hand, its effect drew a card");
});

clause(ASTROLOGER, "0:ability:gaze", "a tactic costing more than X cannot be chosen", () => {
  const g = astro([...O(2)]);
  gaze(g);
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("t3") } } as never), "cost 3 > X=2");
  assert.equal(zoneNow(g.engine, g.id("t3")), "hand");
  freePlay(g.engine, g.id("t2"));
  assert.equal(zoneNow(g.engine, g.id("t2")), "discard", "positive control: cost 2 = X");
});

clause(ASTROLOGER, "0:ability:gaze", "\"you may\": declining deploys nothing (the ability's cost is still paid)", () => {
  const g = astro([...O(3)]);
  const handBefore = g.engine.state.players[P1].hand.length;
  gaze(g);
  freePlay(g.engine, undefined);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.state.players[P1].hand.length, handBefore);
  assert.ok([0, 1, 2, 3].every((c) => zoneNow(g.engine, g.id(`t${c}`)) === "hand"), "[0, 1, 2, 3].every((c) => zoneNow(g.engine, g.id(`t${c}`)) === \"hand\")");
  assert.equal(g.engine.state.cards[g.id("a")].depleted, true);
});

clause(ASTROLOGER, "0:ability:gaze", "only a tactic can be deployed: cheap characters, items and locations in hand are not offered", () => {
  const g = astro([...O(5)], [
    { key: "hc", def: ch("CheapChar"), owner: P1, zone: "hand" },
    { key: "hi", def: item({ name: "CheapItem" }), owner: P1, zone: "hand" }
  ], [1]);
  gaze(g);
  const pc = pending(g.engine) as unknown as { candidates: CardInstanceId[] };
  assert.deepEqual([...pc.candidates], [g.id("t1")]);
});

clause(ASTROLOGER, "0:ability:gaze", "the tactic comes from my hand: tactics in my deck, my discard pile or the opponent's hand are not offered", () => {
  const g = astro([...O(5)], [
    { key: "xd", def: tac("InDeck", 1), owner: P1, zone: "deck" },
    { key: "xg", def: tac("InDiscard", 1), owner: P1, zone: "discard" },
    { key: "xo", def: tac("TheirHand", 1), owner: P2, zone: "hand" }
  ], [1]);
  gaze(g);
  const pc = pending(g.engine) as unknown as { candidates: CardInstanceId[] };
  assert.deepEqual([...pc.candidates], [g.id("t1")]);
});

clause(ASTROLOGER, "0:ability:gaze", "only its controller can use it", () => {
  const g = astro([...O(2), ...O(2, P2)]);
  g.engine.state.activePlayerId = P2;
  refused(() => activate(g.engine, P2, g.id("a"), "gaze", {}), "opponent's ability");
  assert.equal(g.engine.state.cards[g.id("a")].depleted ?? false, false);
});

// =================================================================================
// Obscure
// =================================================================================
const obscure = (res: CardPlacement[], extra: CardPlacement[] = [], opts: { faceDown?: boolean } = {}, g: Parameters<typeof buildGame>[0] = {}) =>
  brd(
    [
      { key: "ob", def: printing(OBSCURE), owner: P1, zone: opts.faceDown ? "play" : "hand", ...(opts.faceDown ? { faceDown: true } : {}) },
      { key: "mine", def: ch("Mine"), owner: P1, zone: "play" },
      { key: "mine2", def: ch("Mine2"), owner: P1, zone: "play" },
      { key: "theirs", def: ch("Theirs"), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      ...res,
      ...extra
    ],
    g
  );
const playObs = (g: ReturnType<typeof obscure>, pick: string) => {
  play(g.engine, P1, g.id("ob"), { selected: { c: [g.id(pick)] } });
  resolvePendingResponses(g.engine);
};

clause(OBSCURE, "0:extraCost", "printed card: a tactic of cost 0 and threshold [O]: playable with one spent [O] and nothing ready, spends nothing", () => {
  const def = printing(OBSCURE);
  assert.equal(def.type, "tactic");
  const g = obscure([...spentO(1), ...R(2)]);
  playObs(g, "mine");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("ob")), "discard", "it resolved");
  assert.equal(g.engine.getAvailableResourceCount(P1), 2, "cost 0: nothing spent");
});

clause(OBSCURE, "0:extraCost", "threshold [O]: without any [O] resource it is refused, however many other resources there are", () => {
  const g = obscure([...R(5)]);
  refused(() => playObs(g, "mine"), "no [O]");
  assert.equal(zoneNow(g.engine, g.id("ob")), "hand");
  assert.ok(!kws(g.engine, g.id("mine")).includes("covert"), "!kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
  const none = obscure([]);
  refused(() => playObs(none, "mine"), "no resources at all");
  const ok = obscure([...O(1)]);
  playObs(ok, "mine");
  assert.ok(kws(ok.engine, ok.id("mine")).includes("covert"), "positive control");
});

clause(OBSCURE, "0:extraCost", "EXTRA COST: pick a character — no pick or a non-character pick is refused; mine and the opponent's both work", () => {
  const none = obscure([...O(1)]);
  refused(() => play(none.engine, P1, none.id("ob"), { selected: {} }), "no pick");
  assert.equal(zoneNow(none.engine, none.id("ob")), "hand");
  const itemPick = obscure([...O(1)]);
  refused(() => playObs(itemPick, "it"), "an item is not a character");
  assert.equal(zoneNow(itemPick.engine, itemPick.id("ob")), "hand");
  const theirs = obscure([...O(1)]);
  playObs(theirs, "theirs");
  assert.ok(kws(theirs.engine, theirs.id("theirs")).includes("covert"), "opponent's character may be picked");
  const mine = obscure([...O(1)]);
  playObs(mine, "mine");
  assert.ok(kws(mine.engine, mine.id("mine")).includes("covert"), "kws(mine.engine, mine.id(\"mine\")).includes(\"covert\")");
});

clause(OBSCURE, "1:rule", "the picked character gains COVERT; other characters do not", () => {
  const g = obscure([...O(1)]);
  assert.ok(!kws(g.engine, g.id("mine")).includes("covert"), "setup: not covert");
  playObs(g, "mine");
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
  assert.ok(!kws(g.engine, g.id("mine2")).includes("covert"), "!kws(g.engine, g.id(\"mine2\")).includes(\"covert\")");
  assert.ok(!kws(g.engine, g.id("theirs")).includes("covert"), "!kws(g.engine, g.id(\"theirs\")).includes(\"covert\")");
  assert.deepEqual(stats(g.engine, g.id("mine")), [2, 2, 3], "stats unchanged");
});

clause(OBSCURE, "1:rule", "COVERT in battle: the picked attacker cannot be blocked by a non-covert character", () => {
  const g = obscure([...O(1)]);
  playObs(g, "mine");
  declareAttackBy(g.engine, P1, [g.id("mine")]);
  refused(() => g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("theirs")] }), "covert attacker");
  const ctl = obscure([...O(1)]);
  declareAttackBy(ctl.engine, P1, [ctl.id("mine")]);
  ctl.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [ctl.id("theirs")] });
  assert.deepEqual(ctl.engine.state.battle?.blockingParty, [ctl.id("theirs")], "without Obscure it can be blocked");
});

clause(OBSCURE, "1:rule", "the grant lasts only this turn", () => {
  const g = obscure([...O(1)]);
  playObs(g, "mine");
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
  endTurn(g.engine, P1);
  assert.ok(!kws(g.engine, g.id("mine")).includes("covert"), "gone at the next turn");
});

clause(OBSCURE, "1:rule", "played on the opponent's turn it lasts until that turn ends", () => {
  const g = obscure([...O(1)], [{ key: "atk", def: ch("Atk"), owner: P2, zone: "play" }], {}, { turn: 2, activePlayerId: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  playObs(g, "mine");
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "gained during their turn");
  declareBlockers(g.engine, P1, []);
  autoResolveBattle(g.engine);
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "still there for the rest of their turn");
  endTurn(g.engine, P2);
  assert.ok(!kws(g.engine, g.id("mine")).includes("covert"), "gone when their turn ends");
});

clause(OBSCURE, "2:flipUp", "FLIP UP 2 [O]: a face-down Obscure flipped up (pick a character) gives that character COVERT this turn", () => {
  const g = obscure([...spentO(1), ...R(1)], [], { faceDown: true });
  flipUpRaw(g.engine, P1, g.id("ob"), { c: [g.id("mine")] });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
  assert.ok(!kws(g.engine, g.id("mine2")).includes("covert"), "!kws(g.engine, g.id(\"mine2\")).includes(\"covert\")");
  assert.notEqual(zoneNow(g.engine, g.id("ob")) === "play" && isFaceDown(g.engine, g.id("ob")), true, "no longer a face-down card in play");
});

clause(OBSCURE, "2:flipUp", "FLIP UP cost 2: exact (one other + itself) works, one short is refused; spares leave 1 or 2 ready", () => {
  const short = obscure([...spentO(1)], [], { faceDown: true });
  refused(() => flipUpRaw(short.engine, P1, short.id("ob"), { c: [short.id("mine")] }), "cost short", /FLIP UP costs cannot be paid/);
  assert.ok(!kws(short.engine, short.id("mine")).includes("covert"), "!kws(short.engine, short.id(\"mine\")).includes(\"covert\")");
  const spare = obscure([...spentO(1), ...R(3)], [], { faceDown: true });
  flipUpRaw(spare.engine, P1, spare.id("ob"), { c: [spare.id("mine")] });
  resolvePendingResponses(spare.engine);
  const ready = spare.engine.getAvailableResourceCount(P1);
  assert.ok(ready === 1 || ready === 2, `three spares minus a cost of 2: ${ready}`);
  assert.ok(kws(spare.engine, spare.id("mine")).includes("covert"), "kws(spare.engine, spare.id(\"mine\")).includes(\"covert\")");
});

clause(OBSCURE, "2:flipUp", "FLIP UP threshold [O]: no [O] is refused even with plenty of resources", () => {
  const g = obscure([...R(6)], [], { faceDown: true });
  refused(() => flipUpRaw(g.engine, P1, g.id("ob"), { c: [g.id("mine")] }), "no [O]");
  assert.ok(!kws(g.engine, g.id("mine")).includes("covert"), "!kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
  const ok = obscure([...spentO(1), ...R(1)], [], { faceDown: true });
  flipUpRaw(ok.engine, P1, ok.id("ob"), { c: [ok.id("mine")] });
  resolvePendingResponses(ok.engine);
  assert.ok(kws(ok.engine, ok.id("mine")).includes("covert"), "positive control");
});

clause(OBSCURE, "2:flipUp", "flipped up it still needs a character pick (none or an item is refused)", () => {
  const g = obscure([...spentO(1), ...R(2)], [], { faceDown: true });
  refused(() => flipUpRaw(g.engine, P1, g.id("ob"), {}), "no pick");
  refused(() => flipUpRaw(g.engine, P1, g.id("ob"), { c: [g.id("it")] }), "item");
  assert.ok(isFaceDown(g.engine, g.id("ob")), "still face down");
});

clause(OBSCURE, "2:flipUp", "as a tactic it can be flipped up in the opponent's response window and the grant ends with that turn", () => {
  const g = obscure([...spentO(1), ...R(2)], [{ key: "atk", def: ch("Atk"), owner: P2, zone: "play" }], { faceDown: true }, { turn: 2, activePlayerId: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  flipUpRaw(g.engine, P1, g.id("ob"), { c: [g.id("mine")] });
  resolvePendingResponses(g.engine);
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
  declareBlockers(g.engine, P1, []);
  autoResolveBattle(g.engine);
  endTurn(g.engine, P2);
  assert.ok(!kws(g.engine, g.id("mine")).includes("covert"), "!kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
});

clause(OBSCURE, "2:flipUp", "the FLIP UP grant also lasts only this turn", () => {
  const g = obscure([...spentO(1), ...R(2)], [], { faceDown: true });
  flipUpRaw(g.engine, P1, g.id("ob"), { c: [g.id("mine")] });
  resolvePendingResponses(g.engine);
  assert.ok(kws(g.engine, g.id("mine")).includes("covert"), "kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
  endTurn(g.engine, P1);
  assert.ok(!kws(g.engine, g.id("mine")).includes("covert"), "!kws(g.engine, g.id(\"mine\")).includes(\"covert\")");
});

// =================================================================================
// Obscene Communion
// =================================================================================
const comBoard = (extra: CardPlacement[] = [], opts: { zone?: "play" | "hand"; controller?: PlayerId; p1Hand?: number; p2Hand?: number; res?: boolean } = {}) =>
  brd(
    [
      { key: "c", def: printing(COMMUNION), owner: P1, zone: opts.zone ?? "play", ...(opts.controller ? { controller: opts.controller } : {}) },
      ...Array.from({ length: opts.p1Hand ?? 2 }, (_, i) => ({ key: `h1_${i}`, def: ch(`H1_${i}`), owner: P1, zone: "hand" as const })),
      ...Array.from({ length: opts.p2Hand ?? 2 }, (_, i) => ({ key: `h2_${i}`, def: ch(`H2_${i}`), owner: P2, zone: "hand" as const })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `d1_${i}`, def: ch(`D1_${i}`), owner: P1, zone: "deck" as const })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `d2_${i}`, def: ch(`D2_${i}`), owner: P2, zone: "deck" as const })),
      ...(opts.res === false
        ? []
        : [
            { key: "r1", def: bank("rage", 1, P1)[0].def, owner: P1, zone: "play" as const },
            { key: "r1b", def: bank("greed", 1, P1)[0].def, owner: P1, zone: "play" as const },
            { key: "r2", def: bank("greed", 1, P2)[0].def, owner: P2, zone: "play" as const },
            { key: "r2b", def: bank("rage", 1, P2)[0].def, owner: P2, zone: "play" as const }
          ]),
      ...extra
    ],
    { turn: 1, activePlayerId: P1 }
  );
type Ans = number | CardInstanceId[];
/** Answers every prompt in order from per-player queues; returns the (kind:player) log. */
const runPrompts = (engine: SpoilsEngine, q: Record<string, Ans[]>): string[] => {
  const log: string[] = [];
  for (let n = 0; n < 20; n++) {
    const pc = pending(engine);
    if (!pc) break;
    log.push(`${pc.kind}:${pc.playerId}`);
    const ans = q[pc.playerId].shift();
    assert.ok(ans !== undefined, `unexpected prompt ${pc.kind} for ${pc.playerId} (log ${log.join(" ")})`);
    const choice = typeof ans === "number" ? { kind: pc.kind, index: ans } : { kind: pc.kind, selected: ans };
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
    resolvePendingResponses(engine);
  }
  return log;
};
const hand = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].hand];
const deck = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] => [...engine.state.players[p].deck];
const sameSet = (a: string[], b: string[]) => assert.deepEqual([...a].sort(), [...b].sort());
const answer = (engine: SpoilsEngine, player: PlayerId, choice: Record<string, unknown>) => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice } as never);
  resolvePendingResponses(engine);
};
/**
 * Ends `player`'s turn so that the OTHER original player's turn starts next. Communion triggers at EVERY seat's turn
 * start, so at a bigger table the extra seats' own turns (which the two-player game never has) would each raise its
 * own four-option prompt for everyone; these tests are about the option semantics between the two original players,
 * so play passes straight between them (the extra seats stay in the game and are still asked "each player" prompts).
 */
const endTurnBetweenOriginals = (engine: SpoilsEngine, player: PlayerId): void => {
  const seats = engine.state.turnOrder;
  engine.state.turnOrder = seats.filter((id) => id === P1 || id === P2);
  try {
    endTurn(engine, player);
  } finally {
    engine.state.turnOrder = seats;
  }
};
/** Ends P1's turn: P2's turn starts and Communion asks P2 which option. */
const toP2Turn = (g: ReturnType<typeof comBoard>) => endTurnBetweenOriginals(g.engine, P1);

clause(COMMUNION, "0:rule", "printed card: an item, cost 2 [O][O], paid in full when deployed", () => {
  const def = printing(COMMUNION);
  assert.equal(def.type, "item");
  const g = brd([{ key: "c", def: printing(COMMUNION), owner: P1, zone: "hand" }, ...spentO(2), ...R(2)]);
  play(g.engine, P1, g.id("c"));
  assert.equal(zoneNow(g.engine, g.id("c")), "play");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0);
});

clause(COMMUNION, "0:rule", "deploy cost 2 (one short) and threshold [O][O] (one icon short) are refused", () => {
  const short = brd([{ key: "c", def: printing(COMMUNION), owner: P1, zone: "hand" }, ...spentO(2), ...R(1)]);
  refused(() => play(short.engine, P1, short.id("c")), "1 ready resource for cost 2", /Costs cannot be paid/);
  const oneIcon = brd([{ key: "c", def: printing(COMMUNION), owner: P1, zone: "hand" }, ...spentO(1), ...R(3)]);
  refused(() => play(oneIcon.engine, P1, oneIcon.id("c")), "only one [O]");
  assert.equal(zoneNow(oneIcon.engine, oneIcon.id("c")), "hand");
  const none = brd([{ key: "c", def: printing(COMMUNION), owner: P1, zone: "hand" }, ...R(4)]);
  refused(() => play(none.engine, P1, none.id("c")), "no [O]");
});

clause(COMMUNION, "0:rule", "at the start of an opponent's turn THAT player (not the controller) chooses one of four options", () => {
  const g = comBoard();
  toP2Turn(g);
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; optionCount: number };
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "the player whose turn it is chooses");
  assert.equal(pc.optionCount, 4);
  refused(() => answer(g.engine, P1, { kind: "chooserSelectsOption", index: 2 }), "the controller may not choose for them");
});

clause(COMMUNION, "0:rule", "at the start of the controller's own turn the controller chooses; it triggers on each player's turn", () => {
  const g = comBoard();
  toP2Turn(g);
  runPrompts(g.engine, { [P1]: [[g.id("h1_0")]], [P2]: [2, [g.id("h2_0")]] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  endTurnBetweenOriginals(g.engine, P2);
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; optionCount: number };
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "P1's turn: P1 chooses");
  assert.equal(pc.optionCount, 4);
});

clause(COMMUNION, "0:rule", "it triggers whoever controls the item (an opponent-controlled Communion still asks the active player)", () => {
  const g = comBoard([], { controller: P2 });
  endTurnBetweenOriginals(g.engine, P1);
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string };
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2);
});

clause(COMMUNION, "0:rule", "it does nothing while not in play (in hand: no prompt at turn start)", () => {
  const g = comBoard([], { zone: "hand" });
  toP2Turn(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(COMMUNION, "1:option:OPTION 1", "OPTION 1: each player draws a card, then puts a card from their hand on the bottom of their deck", () => {
  const g = comBoard();
  const d1 = deck(g.engine, P1), d2 = deck(g.engine, P2);
  toP2Turn(g);
  runPrompts(g.engine, { [P1]: [[g.id("h1_0")]], [P2]: [0, [g.id("h2_1")]] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  const d1After = deck(g.engine, P1), d2After = deck(g.engine, P2);
  assert.equal(hand(g.engine, P1).length, 2, "drew one, put one back");
  assert.equal(hand(g.engine, P2).length, 2, "P2: drew one, put one back");
  sameSet(hand(g.engine, P1), [g.id("h1_1"), d1[0]]);
  sameSet(hand(g.engine, P2), [g.id("h2_0"), d2[0]]);
  assert.equal(d1After[d1After.length - 1], g.id("h1_0"), "P1's card is on the BOTTOM of P1's deck");
  assert.equal(d1After.length, d1.length, "deck size unchanged");
  assert.equal(d2After[d2After.length - 1], g.id("h2_1"), "P2's card is on the bottom of P2's deck");
  assert.equal(d2After.length, d2.length);
});

clause(COMMUNION, "1:option:OPTION 1", "OPTION 1: the card put back may be the one just drawn", () => {
  const g = comBoard();
  const d1 = deck(g.engine, P1), d2 = deck(g.engine, P2);
  toP2Turn(g);
  runPrompts(g.engine, { [P1]: [[d1[0]]], [P2]: [0, [d2[0]]] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  sameSet(hand(g.engine, P1), [g.id("h1_0"), g.id("h1_1")]);
  assert.equal(deck(g.engine, P1)[deck(g.engine, P1).length - 1], d1[0]);
  assert.equal(deck(g.engine, P2)[deck(g.engine, P2).length - 1], d2[0]);
});

clause(COMMUNION, "1:option:OPTION 1", "OPTION 1 does only that: no resources move, nobody discards", () => {
  const g = comBoard();
  toP2Turn(g);
  const discards = [g.engine.state.players[P1].discard.length, g.engine.state.players[P2].discard.length];
  runPrompts(g.engine, { [P1]: [[g.id("h1_0")]], [P2]: [0, [g.id("h2_0")]] });
  assert.deepEqual([g.engine.state.players[P1].discard.length, g.engine.state.players[P2].discard.length], discards);
  for (const k of ["r1", "r1b", "r2", "r2b"]) assert.equal(zoneNow(g.engine, g.id(k)), "play");
});

clause(COMMUNION, "3:option:OPTION 3", "OPTION 3: each player discards a card of their choice from their own hand; nothing else", () => {
  const g = comBoard();
  const d1 = deck(g.engine, P1), d2 = deck(g.engine, P2);
  toP2Turn(g);
  const log = runPrompts(g.engine, { [P1]: [[g.id("h1_1")]], [P2]: [2, [g.id("h2_0")]] });
  assert.deepEqual(log.filter((l) => l.startsWith("chooserSelectsTarget")).sort(), ["chooserSelectsTarget:p1", "chooserSelectsTarget:p2"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("h1_1")), "discard");
  assert.equal(zoneNow(g.engine, g.id("h2_0")), "discard");
  assert.equal(zoneNow(g.engine, g.id("h1_0")), "hand", "the unchosen card stays");
  assert.equal(zoneNow(g.engine, g.id("h2_1")), "hand");
  assert.deepEqual(deck(g.engine, P1), d1, "no drawing");
  assert.deepEqual(deck(g.engine, P2), d2);
});

clause(COMMUNION, "3:option:OPTION 3", "OPTION 3: a player with an empty hand discards nothing and the other still does", () => {
  const g = comBoard([], { p1Hand: 0 });
  toP2Turn(g);
  answer(g.engine, P2, { kind: "chooserSelectsOption", index: 2 });
  answer(g.engine, P2, { kind: "chooserSelectsTarget", selected: [g.id("h2_0")] });
  assert.equal(g.engine.state.pendingChoice, undefined, "P1 has no card in hand to discard: no prompt for them");
  assert.equal(zoneNow(g.engine, g.id("h2_0")), "discard");
});

clause(COMMUNION, "4:option:OPTION 4", "OPTION 4: each player puts a card from their hand on the TOP of their own deck", () => {
  const g = comBoard();
  const d1 = deck(g.engine, P1), d2 = deck(g.engine, P2);
  toP2Turn(g);
  runPrompts(g.engine, { [P1]: [[g.id("h1_1")]], [P2]: [3, [g.id("h2_0")]] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(deck(g.engine, P1), [g.id("h1_1"), ...d1], "on top of P1's deck");
  assert.deepEqual(deck(g.engine, P2), [g.id("h2_0"), ...d2], "on top of P2's deck");
  assert.deepEqual(hand(g.engine, P1), [g.id("h1_0")]);
  assert.deepEqual(hand(g.engine, P2), [g.id("h2_1")]);
});

clause(COMMUNION, "4:option:OPTION 4", "OPTION 4: a player with an empty hand does nothing, the other still puts one on top", () => {
  const g = comBoard([], { p2Hand: 0 });
  toP2Turn(g);
  const d2 = deck(g.engine, P2);
  answer(g.engine, P2, { kind: "chooserSelectsOption", index: 3 });
  const pc = pending(g.engine);
  assert.equal(pc?.playerId, P1, "P2 has no card in hand to put on top: the only prompt is P1's");
  answer(g.engine, P1, { kind: "chooserSelectsTarget", selected: [g.id("h1_0")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(deck(g.engine, P1)[0], g.id("h1_0"));
  assert.deepEqual(deck(g.engine, P2), d2);
});

clause(COMMUNION, "2:option:OPTION 2", "OPTION 2: each player returns a resource they control to its owner's hand, and may then decline to play a resource", () => {
  const g = comBoard();
  toP2Turn(g);
  const log = runPrompts(g.engine, { [P1]: [[g.id("r1")], []], [P2]: [1, [g.id("r2")], []] });
  assert.equal(g.engine.state.pendingChoice, undefined, log.join(" "));
  assert.equal(zoneNow(g.engine, g.id("r1")), "hand");
  assert.equal(zoneNow(g.engine, g.id("r2")), "hand");
  assert.ok(g.engine.state.players[P1].hand.includes(g.id("r1")), "g.engine.state.players[P1].hand.includes(g.id(\"r1\"))");
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("r2")), "g.engine.state.players[P2].hand.includes(g.id(\"r2\"))");
  assert.equal(zoneNow(g.engine, g.id("r1b")), "play", "the other resources stay");
  assert.equal(zoneNow(g.engine, g.id("r2b")), "play");
});

clause(COMMUNION, "2:option:OPTION 2", "OPTION 2: a non-resource (a character in play, a card in hand) cannot be picked; a resource can", () => {
  const g = comBoard([{ key: "pc", def: ch("PlayChar"), owner: P2, zone: "play" }]);
  toP2Turn(g);
  answer(g.engine, P2, { kind: "chooserSelectsOption", index: 1 });
  const pick = pending(g.engine)!;
  assert.equal(pick.kind, "chooserSelectsTarget");
  assert.equal(pick.playerId, P2);
  refused(() => answer(g.engine, P2, { kind: pick.kind, selected: [g.id("pc")] }), "a character is not a resource");
  refused(() => answer(g.engine, P2, { kind: pick.kind, selected: [g.id("h2_0")] }), "a card in hand is not a resource in play");
  answer(g.engine, P2, { kind: pick.kind, selected: [g.id("r2")] });
  assert.equal(zoneNow(g.engine, g.id("r2")), "hand", "positive control");
});

clause(COMMUNION, "2:option:OPTION 2", "OPTION 2: only a resource THEY control can be picked — the opponent's resource is refused", () => {
  const g = comBoard();
  toP2Turn(g);
  answer(g.engine, P2, { kind: "chooserSelectsOption", index: 1 });
  const pick = pending(g.engine)!;
  refused(() => answer(g.engine, P2, { kind: pick.kind, selected: [g.id("r1")] }), "the opponent's resource");
  assert.equal(zoneNow(g.engine, g.id("r1")), "play");
});

clause(COMMUNION, "2:option:OPTION 2", "OPTION 2: it is a resource THEY CONTROL — a stolen resource is picked by its controller and goes to its OWNER's hand", () => {
  const g = comBoard([{ key: "stolen", def: bank("rage", 1, P2)[0].def, owner: P2, controller: P1, zone: "play" }]);
  toP2Turn(g);
  runPrompts(g.engine, { [P1]: [[g.id("stolen")], []], [P2]: [1, [g.id("r2")], []] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneNow(g.engine, g.id("stolen")), "hand");
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("stolen")), "into its owner's hand");
  assert.ok(!g.engine.state.players[P1].hand.includes(g.id("stolen")), "!g.engine.state.players[P1].hand.includes(g.id(\"stolen\"))");
});

clause(COMMUNION, "2:option:OPTION 2", "OPTION 2: a resource I own but the opponent controls cannot be picked by me", () => {
  const g = comBoard([{ key: "lent", def: bank("rage", 1, P1)[0].def, owner: P1, controller: P2, zone: "play" }]);
  toP2Turn(g);
  answer(g.engine, P2, { kind: "chooserSelectsOption", index: 1 });
  answer(g.engine, P2, { kind: "chooserSelectsTarget", selected: [g.id("r2")] });
  answer(g.engine, P2, { kind: "chooserSelectsTarget", selected: [] });
  const p1pick = pending(g.engine)!;
  assert.equal(p1pick.playerId, P1);
  refused(() => answer(g.engine, P1, { kind: p1pick.kind, selected: [g.id("lent")] }), "I don't control it");
});

clause(COMMUNION, "2:option:OPTION 2", "OPTION 2: putting a resource into hand is mandatory for a player who controls one (an empty pick is refused)", () => {
  const g = comBoard();
  toP2Turn(g);
  answer(g.engine, P2, { kind: "chooserSelectsOption", index: 1 });
  refused(() => answer(g.engine, P2, { kind: "chooserSelectsTarget", selected: [] }), "must put a resource into hand");
});

clause(COMMUNION, "2:option:OPTION 2", "OPTION 2: a player with no resources is not asked to return one", () => {
  const g = comBoard([], { res: false });
  toP2Turn(g);
  const log = runPrompts(g.engine, { [P1]: [[]], [P2]: [1, []] });
  assert.equal(g.engine.state.pendingChoice, undefined, log.join(" "));
});

for (const [key, opt, title] of [
  ["1:option:OPTION 1", 0, "OPTION 1", "seed-saga-02-p3-7"],
  ["3:option:OPTION 3", 2, "OPTION 3", "seed-saga-02-p3-8"],
  ["4:option:OPTION 4", 3, "OPTION 4", "seed-saga-02-p3-9"]
] as const) {
  clause(COMMUNION, key, `${title}: each player chooses a card from THEIR OWN hand (the other player's hand card is refused)`, () => {
    const g = comBoard();
    toP2Turn(g);
    answer(g.engine, P2, { kind: "chooserSelectsOption", index: opt });
    const pick = pending(g.engine)!;
    assert.equal(pick.playerId, P2);
    refused(() => answer(g.engine, P2, { kind: pick.kind, selected: [g.id("h1_0")] }), "opponent's hand card");
    assert.equal(zoneNow(g.engine, g.id("h1_0")), "hand");
  });
}

clause(COMMUNION, "2:option:OPTION 2", "OPTION 2: \"Each player may play a resource\" — accepting plays a resource from hand (the one just returned)", () => {
  const g = comBoard();
  toP2Turn(g);
  answer(g.engine, P2, { kind: "chooserSelectsOption", index: 1 });
  answer(g.engine, P2, { kind: "chooserSelectsTarget", selected: [g.id("r2")] });
  assert.equal(zoneNow(g.engine, g.id("r2")), "hand", "setup: returned to hand");
  // "may play a resource": an optional pick from hand; pick the returned resource
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  answer(g.engine, P2, { kind: "chooserSelectsTarget", selected: [g.id("r2")] });
  assert.equal(zoneNow(g.engine, g.id("r2")), "play", "the player played a resource from hand");
  assert.ok(!hand(g.engine, P2).includes(g.id("r2")), "!hand(g.engine, P2).includes(g.id(\"r2\"))");
  assert.equal(zoneNow(g.engine, g.id("h2_0")), "hand", "only a resource is played");
});

clause(COMMUNION, "2:option:OPTION 2", "OPTION 2: 'may play a resource' follows the Play a Resource steps (CR 605.1): the player decides face-up or face-down for a real resource card; any card from their own hand may be played face-down; the opponent's hand card is refused", () => {
  for (const faceDown of [false, true]) {
    const g = comBoard();
    holdResourceFace(() => {
      toP2Turn(g);
      answer(g.engine, P2, { kind: "chooserSelectsOption", index: 1 });
      answer(g.engine, P2, { kind: "chooserSelectsTarget", selected: [g.id("r2")] });
      answer(g.engine, P2, { kind: "chooserSelectsTarget", selected: [g.id("r2")] });
      const pc = pending(g.engine) as unknown as { kind: string; playerId: string };
      assert.equal(pc.kind, "playResource", "a real resource card asks face-up or face-down");
      assert.equal(pc.playerId, P2, "the playing player decides");
      answer(g.engine, P2, { kind: "playResource", faceDown });
    });
    assert.equal(zoneNow(g.engine, g.id("r2")), "play", "the resource entered play");
    assert.equal(isFaceDown(g.engine, g.id("r2")), faceDown, `played ${faceDown ? "face-down" : "face-up"} as chosen`);
  }
  const any = comBoard();
  holdResourceFace(() => {
    toP2Turn(any);
    answer(any.engine, P2, { kind: "chooserSelectsOption", index: 1 });
    answer(any.engine, P2, { kind: "chooserSelectsTarget", selected: [any.id("r2")] });
    refused(() => answer(any.engine, P2, { kind: "chooserSelectsTarget", selected: [any.id("h1_0")] }), "the opponent's hand card is not playable by me");
    assert.equal(zoneNow(any.engine, any.id("h1_0")), "hand");
    answer(any.engine, P2, { kind: "chooserSelectsTarget", selected: [any.id("h2_0")] });
    if (pending(any.engine)?.kind === "playResource") answer(any.engine, P2, { kind: "playResource", faceDown: true });
  });
  assert.equal(zoneNow(any.engine, any.id("h2_0")), "play", "any card of mine can be played as a resource");
  assert.equal(isFaceDown(any.engine, any.id("h2_0")), true, "a non-resource card can only be played face-down");
});

for (const [key, opt, title] of [
  ["1:option:OPTION 1", 0, "OPTION 1"],
  ["3:option:OPTION 3", 2, "OPTION 3"],
  ["4:option:OPTION 4", 3, "OPTION 4"]
] as const) {
  clause(COMMUNION, key, `${title}: the card pick is mandatory for a player with cards in hand (an empty pick is refused), and a card of their own hand is accepted`, () => {
    const g = comBoard();
    toP2Turn(g);
    answer(g.engine, P2, { kind: "chooserSelectsOption", index: opt });
    const pick = pending(g.engine)!;
    assert.equal(pick.kind, "chooserSelectsTarget");
    assert.equal(pick.playerId, P2);
    refused(() => answer(g.engine, P2, { kind: pick.kind, selected: [] }), "a card must be put/discarded; declining is not allowed");
    assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "still waiting for the pick");
    answer(g.engine, P2, { kind: pick.kind, selected: [g.id("h2_0")] });
    assert.notEqual(zoneNow(g.engine, g.id("h2_0")), "hand", "control: the picked card left the hand");
  });
}

void killAbility;
