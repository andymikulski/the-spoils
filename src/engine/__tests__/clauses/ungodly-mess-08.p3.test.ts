// Batch ungodly-mess-08, part p3 (groups 9-12: Big McLargehuge, Bloodcrazed Berserker, Breath of the Barduse, Bursting Bask).
// Every test is written from the PRINTED text of the printing under test.

import assert from "node:assert/strict";
import type { CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, killTactic, location, P1, P2, play, resolvePendingResponses, resourceCard, tactic } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, type PendingChoiceLike, flipUpNow, holdCostChoices } from "./_clause.js";
import { declareAttackOpenWindow } from "./_battle.js";
import { answerPending, pending, zoneOf } from "./_board.js";

type Pid = typeof P1 | typeof P2;

const stat = (engine: SpoilsEngine, c: CardInstanceId, s: "strength" | "life" | "speed") => engine.getStat(c, s);
const triple = (engine: SpoilsEngine, c: CardInstanceId) => [stat(engine, c, "strength"), stat(engine, c, "life"), stat(engine, c, "speed")];
const dmg = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].damage ?? 0;
/** Resources in play, or cards in the discard pile (only destroyed resources are ever discarded on these boards; a discarded card is no longer a "resource"). */
const resIn = (engine: SpoilsEngine, p: Pid, zone: "play" | "discard") => (zone === "play" ? engine.state.players[p].play.filter((c) => engine.isResource(c)).length : engine.state.players[p].discard.length);

const R = (n: number, owner: Pid = P1) => bank("rage", n, owner);
const G = (n: number, owner: Pid = P1) => bank("greed", n, owner);
/** `n` rage resources of `owner` that are already spent (attached to the faction): they count for thresholds but cannot pay. */
const spentR = (n: number, owner: Pid = P1): CardPlacement[] =>
  bank("rage", n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const pickTargets = (ids: string[]) => (pc: PendingChoiceLike) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc));
const flipUpOf = (engine: SpoilsEngine, cardId: CardInstanceId, player: Pid = P1) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, variables: {} });

const baseBoard = (cards: CardPlacement[], o: { active?: Pid; turn?: number; random?: () => number } = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, turn: o.turn ?? 2, activePlayerId: o.active ?? P1, cards, random: o.random });

// =================================================================================
// Big McLargehuge -- warlord dragon character, cost 2, [R][R][R][R], 4 str / 3 spd / 5 life
// UNIQUE MCLARGEHUGE; EXTRA COST destroy 2 resources you control; leaves play: play a resource OR
// opponent destroys a face-down resource of theirs; FLIP UP 4 [R]
// =================================================================================

const MC = "9f159c52-0b48-4661-b3cd-9269e4bad55d";

type McOpts = { zone?: "hand" | "play"; faceDown?: boolean; res?: CardPlacement[]; extra?: CardPlacement[]; active?: Pid; turn?: number; random?: () => number };
const mcBoard = (o: McOpts = {}) =>
  baseBoard([{ key: "mc", def: printing(MC), owner: P1, zone: o.zone ?? "hand", faceDown: o.faceDown }, ...(o.res ?? []), ...(o.extra ?? [])], o);
type MC = ReturnType<typeof mcBoard>;
const deployMc = (g: MC) => play(g.engine, P1, g.id("mc"), {});

clause(MC, "0:unique", "is a warlord dragon character with printed cost 2, threshold rrrr, 4 str / 3 spd / 5 life, UNIQUE MCLARGEHUGE", () => {
  const p = printing(MC);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual(p.subtype, ["dragon"]);
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "rrrr");
  assert.equal((p as unknown as { unique?: string }).unique, "mclargehuge");
  const g = mcBoard({ zone: "play" });
  assert.deepEqual(triple(g.engine, g.id("mc")), [4, 5, 3]);
});

clause(MC, "0:unique", "deploys for exactly 2 (two ready [R] pay it while two spent [R] complete the threshold)", () => {
  const g = mcBoard({ res: [...spentR(2), ...R(2)] });
  deployMc(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "the two ready resources were spent");
});

clause(MC, "0:unique", "is refused with one ready resource short of the cost 2 (the threshold is still met by spent [R])", () => {
  const g = mcBoard({ res: [...spentR(3), ...R(1)] });
  refused(() => deployMc(g), "cost 2 with 1 ready resource", /cost|afford|resource|pay/i);
  assert.equal(zoneOf(g.engine, g.id("mc")), "hand");
  assert.equal(resIn(g.engine, P1, "discard"), 0, "nothing was destroyed");
  const ok = mcBoard({ res: [...spentR(3), ...R(2)] });
  deployMc(ok);
  assert.equal(zoneOf(ok.engine, ok.id("mc")), "play", "control: 2 ready is enough");
});

clause(MC, "0:unique", "threshold rrrr: three [R] among six ready resources is one icon short and is refused; four works", () => {
  const g = mcBoard({ res: [...R(3), ...G(3)] });
  refused(() => deployMc(g), "only 3 [R]", /threshold|icon/i);
  assert.equal(zoneOf(g.engine, g.id("mc")), "hand");
  assert.equal(g.engine.getAvailableResourceCount(P1), 6, "nothing was paid");
  const none = mcBoard({ res: G(6) });
  refused(() => deployMc(none), "no [R]", /threshold|icon/i);
  const spent = mcBoard({ res: [...spentR(2), ...R(1), ...G(3)] });
  refused(() => deployMc(spent), "spent [R] count, but 3 icons are still short of 4", /threshold|icon/i);
  const ok = mcBoard({ res: [...R(4), ...G(2)] });
  deployMc(ok);
  assert.equal(zoneOf(ok.engine, ok.id("mc")), "play", "control: four [R]");
});

clause(MC, "1:extraCost", "deploying destroys exactly 2 of your resources (they go to the discard pile) and leaves the opponent's resources alone", () => {
  const g = mcBoard({ res: [...R(6)], extra: [...R(3, P2)] });
  assert.equal(resIn(g.engine, P1, "play"), 6);
  deployMc(g);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
  assert.equal(resIn(g.engine, P1, "discard"), 2, "exactly 2 resources destroyed");
  assert.equal(resIn(g.engine, P1, "play"), 4, "the 2 spent to pay stay in play");
  assert.equal(resIn(g.engine, P2, "play"), 3, "the opponent's resources are untouched");
  assert.equal(resIn(g.engine, P2, "discard"), 0);
});

// The destroy is random (ungodly-mess-08-p3-1), so these boards pin the seed. The counts below hold for every seed.
clause(MC, "1:extraCost", "the destroy is paid in addition to the normal cost: of 6 resources, 2 are destroyed and 4 stay in play", () => {
  for (const r of [0, 0.5, 0.99]) {
    const g = mcBoard({ res: R(6), random: () => r });
    deployMc(g);
    assert.equal(resIn(g.engine, P1, "discard"), 2, `2 destroyed (seed ${r})`);
    assert.equal(resIn(g.engine, P1, "play"), 4, `the other 4 stay in play (seed ${r})`);
  }
});

// Extra costs come before the numeric cost, which is paid last (SYS-23). So the 2 destroyed come from the 6 ready
// resources and the 2 paid come from the 4 left: exactly 2 stay ready, whichever resources are destroyed.
clause(MC, "1:extraCost", "the numeric cost is paid after the destroy, so exactly 2 of the 6 stay ready (the destroy can't take a resource already spent on the cost)", () => {
  for (const r of [0, 0.3, 0.99]) {
    const g = mcBoard({ res: R(6), random: () => r });
    deployMc(g);
    assert.equal(g.engine.getAvailableResourceCount(P1), 2, `exactly 2 ready (seed ${r})`);
  }
});

clause(MC, "1:extraCost", "the controller chooses which 2 resources are destroyed", () => holdCostChoices(() => {
  const g = mcBoard({ res: R(6) });
  deployMc(g);
  const pc = pending(g.engine);
  assert.ok(pc, "a choice of which resources to destroy is offered");
  assert.equal(pc.playerId, P1);
}));

clause(MC, "1:extraCost", "a spent (attached) resource is still a resource you control and may be destroyed: with every resource spent but two, the deploy works", () => {
  const g = mcBoard({ res: [...spentR(4), ...G(2)] });
  deployMc(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
  assert.equal(resIn(g.engine, P1, "discard"), 2);
});

const mcDupBoard = (extra: CardPlacement[] = [], o: Partial<McOpts> = {}) =>
  mcBoard({ res: R(8), extra: [{ key: "mc2", def: printing(MC), owner: P1, zone: "play" }, ...extra], ...o });

clause(MC, "0:unique", "you cannot control two McLargehuges: a second copy forces a choice, the unchosen one is destroyed", () => {
  const g = mcDupBoard();
  deployMc(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("mc"), g.id("mc2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("mc") } } as never);
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
  assert.equal(zoneOf(g.engine, g.id("mc2")), "discard");
});

clause(MC, "0:unique", "choosing the old McLargehuge keeps it and destroys the new one", () => {
  const g = mcDupBoard();
  deployMc(g);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("mc2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("mc2")), "play");
  assert.equal(zoneOf(g.engine, g.id("mc")), "discard");
});

clause(MC, "0:unique", "UNIQUE is per player: the opponent may control their own McLargehuge, and a card with another designation is not a duplicate", () => {
  const g = baseBoard(
    [
      { key: "mc", def: printing(MC), owner: P2, zone: "hand" },
      { key: "mc2", def: printing(MC), owner: P1, zone: "play" },
      { key: "oth", def: item({ name: "Other", unique: "something else" } as never), owner: P2, zone: "play" },
      ...R(6, P2)
    ],
    { active: P2, turn: 3 }
  );
  play(g.engine, P2, g.id("mc"), {});
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
  assert.equal(zoneOf(g.engine, g.id("mc2")), "play");
  const same = mcDupBoard([{ key: "fake", def: item({ name: "FakeMc", unique: "mclargehuge" } as never), owner: P1, zone: "play" }]);
  assert.equal(pending(same.engine)?.kind ?? "none", "none", "setup alone raises nothing");
});

clause(MC, "0:unique", "another card with the MCLARGEHUGE designation counts as a duplicate", () => {
  const g = mcBoard({
    res: R(4),
    extra: [{ key: "fake", def: item({ name: "FakeMc", unique: "mclargehuge", cost: 0 } as never), owner: P1, zone: "hand" }, { key: "mc2", def: printing(MC), owner: P1, zone: "play" }]
  });
  play(g.engine, P1, g.id("fake"), {});
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
});

// --- leaves play ---------------------------------------------------------------------

const leaveBoard = (o: { hand?: CardPlacement[]; foeRes?: CardPlacement[]; mcFaceDown?: boolean; extra?: CardPlacement[]; active?: Pid } = {}) =>
  baseBoard(
    [
      { key: "mc", def: printing(MC), owner: P1, zone: "play", faceDown: o.mcFaceDown },
      { key: "k", def: killTactic(), owner: P1, zone: "hand" },
      { key: "hr", def: resourceCard({ name: "SpareRes" }), owner: P1, zone: "hand" },
      { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "f1", def: resourceCard({ name: "Fd1" }), owner: P2, zone: "play", faceDown: true },
      { key: "f2", def: resourceCard({ name: "Fd2" }), owner: P2, zone: "play", faceDown: true },
      { key: "up", def: resourceCard({ name: "FaceUpRes" }), owner: P2, zone: "play" },
      { key: "mine", def: resourceCard({ name: "MineFd" }), owner: P1, zone: "play", faceDown: true },
      ...(o.hand ?? []),
      ...(o.foeRes ?? []),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
type LB = ReturnType<typeof leaveBoard>;
const killMc = (g: LB) => play(g.engine, P1, g.id("k"), { selected: { t: [g.id("mc")] } });
const chooseOption = (g: LB, index: number) => answerPending(g.engine, "chooserSelectsOption", { index });

clause(MC, "2:rule", "when it is destroyed its controller is offered the two options: play a resource, or the opponent destroys a face-down resource", () => {
  const g = leaveBoard();
  killMc(g);
  assert.equal(zoneOf(g.engine, g.id("mc")), "discard");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  const labels = (pc.options as { label: string }[]).map((o) => o.label.toLowerCase());
  assert.ok(labels.some((l) => /play a resource/.test(l)), "option: play a resource");
  assert.ok(labels.some((l) => /destroy/.test(l) && /face-down/.test(l)), "option: opponent destroys a face-down resource");
});

clause(MC, "2:rule", "play a resource: a resource card from the hand enters play as a resource", () => {
  const g = leaveBoard();
  killMc(g);
  chooseOption(g, 0);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(g.engine)?.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hr")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("hr")), "play");
  assert.equal(g.engine.isResource(g.id("hr")), true);
  assert.equal(resIn(g.engine, P2, "discard"), 0, "the opponent destroyed nothing");
  assert.equal(zoneOf(g.engine, g.id("hc")), "hand");
});

clause(MC, "2:rule", "play a resource: any card from the hand may be played face-down (CR 203.2), so a character in hand is accepted and ends in play face-down", () => {
  const g = leaveBoard();
  killMc(g);
  chooseOption(g, 0);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hc")] });
  assert.equal(zoneOf(g.engine, g.id("hc")), "play", "the character card was played as a resource");
  assert.equal(g.engine.state.cards[g.id("hc")].faceDown, true, "only face-down: it is a Volition resource, not a character");
});

clause(MC, "2:rule", "play a resource: it comes from the controller's hand, not the opponent's (the card played is the one picked)", () => {
  const g = leaveBoard({ hand: [{ key: "oh", def: resourceCard({ name: "OppHandRes" }), owner: P2, zone: "hand" }] });
  killMc(g);
  chooseOption(g, 0);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh")] }), "the opponent's hand card", /select|target|invalid|candidate|legal/i);
  assert.equal(zoneOf(g.engine, g.id("oh")), "hand");
});

clause(MC, "2:rule", "opponent destroys a face-down resource: the OPPONENT chooses which of their face-down resources, and only face-down ones", () => {
  const g = leaveBoard();
  killMc(g);
  chooseOption(g, 1);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "that player destroys, so that player chooses");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("up")] }), "a face-up resource", /select|target|invalid|candidate|legal|face/i);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mine")] }), "the controller's own face-down resource", /select|target|invalid|candidate|legal|controller/i);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("f2")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("f2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("f1")), "play", "only one is destroyed");
  assert.equal(zoneOf(g.engine, g.id("up")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(zoneOf(g.engine, g.id("hr")), "hand", "no resource was played");
});

clause(MC, "2:rule", "opponent destroys a face-down resource: with a single face-down resource that one is destroyed", () => {
  const g = baseBoard([
    { key: "mc", def: printing(MC), owner: P1, zone: "play" },
    { key: "k", def: killTactic(), owner: P1, zone: "hand" },
    { key: "f1", def: resourceCard({ name: "Fd1" }), owner: P2, zone: "play", faceDown: true },
    { key: "up", def: resourceCard({ name: "FaceUpRes" }), owner: P2, zone: "play" }
  ]);
  play(g.engine, P1, g.id("k"), { selected: { t: [g.id("mc")] } });
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  drain(g.engine, pickTargets([g.id("f1")]));
  assert.equal(zoneOf(g.engine, g.id("f1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("up")), "play");
});

clause(MC, "2:rule", "opponent destroys a face-down resource: with no face-down resource nothing happens and nothing hangs", () => {
  const g = baseBoard([
    { key: "mc", def: printing(MC), owner: P1, zone: "play" },
    { key: "k", def: killTactic(), owner: P1, zone: "hand" },
    { key: "up", def: resourceCard({ name: "FaceUpRes" }), owner: P2, zone: "play" }
  ]);
  play(g.engine, P1, g.id("k"), { selected: { t: [g.id("mc")] } });
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("up")), "play", "a face-up resource is never destroyed");
});

clause(MC, "2:rule", "'you may': the controller can decline both options and nothing happens", () => {
  const g = leaveBoard();
  killMc(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  const labels = (pc.options as { label: string }[]).map((o) => o.label.toLowerCase());
  assert.ok(labels.length >= 3 || labels.some((l) => /decline|nothing|neither|no\b|skip/.test(l)), `a decline is offered (options: ${labels.join(" | ")})`);
});

clause(MC, "2:rule", "the play-a-resource branch can be passed with an empty pick: no card is played", () => {
  const g = leaveBoard();
  killMc(g);
  chooseOption(g, 0);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("hr")), "hand");
  assert.equal(resIn(g.engine, P2, "discard"), 0);
});

clause(MC, "2:rule", "triggers when the opponent destroys it on their own turn: its controller still makes the choice", () => {
  const g = baseBoard([
    { key: "mc", def: printing(MC), owner: P1, zone: "play" },
    { key: "k", def: killTactic(), owner: P2, zone: "hand" },
    { key: "f1", def: resourceCard({ name: "Fd1" }), owner: P2, zone: "play", faceDown: true },
    { key: "hr", def: resourceCard({ name: "SpareRes" }), owner: P1, zone: "hand" }
  ], { active: P2, turn: 3 });
  play(g.engine, P2, g.id("k"), { selected: { t: [g.id("mc")] } });
  assert.equal(zoneOf(g.engine, g.id("mc")), "discard");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the McLargehuge's controller chooses, even on the opponent's turn");
});

clause(MC, "2:rule", "does not trigger when another card leaves play, nor while McLargehuge stays in play", () => {
  const g = leaveBoard({ extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  play(g.engine, P1, g.id("k"), { selected: { t: [g.id("other")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("other")), "discard");
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
  assert.equal(pending(g.engine), undefined, "no leave-play trigger from a different card");
});

clause(MC, "2:rule", "a face-down McLargehuge (an anonymous resource) leaving play fires no trigger", () => {
  const killRes = tactic({
    name: "KillRes",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
  const g = baseBoard([
    { key: "mc", def: printing(MC), owner: P1, zone: "play", faceDown: true },
    { key: "kr", def: killRes, owner: P1, zone: "hand" },
    { key: "f1", def: resourceCard({ name: "Fd1" }), owner: P2, zone: "play", faceDown: true },
    { key: "hr", def: resourceCard({ name: "SpareRes" }), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("kr"), { selected: { t: [g.id("mc")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mc")), "discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("f1")), "play");
});

// --- FLIP UP: 4 [R] ------------------------------------------------------------------

const mcFd = (res: CardPlacement[], extra: CardPlacement[] = []) => mcBoard({ zone: "play", faceDown: true, res, extra });

clause(MC, "3:flipUp", "a face-down McLargehuge flips up for 4 with [R]: itself plus three others pay, it becomes a face-up character with its printed stats", () => {
  const g = mcFd([...R(3), ...G(2)]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 6, "setup: the face-down card and 5 resources");
  flipUpOf(g.engine, g.id("mc"));
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  const c = g.engine.state.cards[g.id("mc")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("mc")), ["character"]);
  assert.deepEqual(triple(g.engine, g.id("mc")), [4, 5, 3]);
});

clause(MC, "3:flipUp", "pays exactly 4 (itself + 3 others), then the EXTRA COST destroys 2 resources (CR 507.4c)", () => {
  const g = mcFd([...R(3), ...G(2)]);
  flipUpOf(g.engine, g.id("mc"));
  resolvePendingResponses(g.engine);
  assert.equal(resIn(g.engine, P1, "discard"), 2, "2 resources destroyed as the regular extra cost");
  assert.equal(resIn(g.engine, P1, "play") + resIn(g.engine, P1, "discard"), 5, "the face-down card left the pool; 5 others remain, 2 of them destroyed");
});

clause(MC, "3:flipUp", "is refused when one short: the card plus two ready [R] is only three ready resources, and nothing is paid", () => {
  const g = mcFd([...R(2), ...spentR(2)]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 3);
  refused(() => flipUpOf(g.engine, g.id("mc")), "3 ready resources for a FLIP UP cost of 4", /cost|resource|afford|pay/i);
  assert.equal(g.engine.state.cards[g.id("mc")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 3, "nothing was paid");
  assert.equal(resIn(g.engine, P1, "discard"), 0);
  // Numeric costs are paid last (CR 406.3a): the two destroyed resources must be the spent ones, so 4 ready are left to pay.
  const ok = mcFd([...R(3), ...spentR(2)]);
  flipUpOf(ok.engine, ok.id("mc"));
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("mc")].faceDown, false, "control: the card + 3 ready resources, with two spent ones to destroy");
});

clause(MC, "3:flipUp", "needs [R]: Greed resources are not the threshold, and the card's own Volition icon is not [R]; the opponent's [R] do not count", () => {
  const noR = mcFd(G(5));
  refused(() => flipUpOf(noR.engine, noR.id("mc")), "no [R] among the resources", /threshold|icon/i);
  assert.equal(noR.engine.state.cards[noR.id("mc")].faceDown, true);
  assert.equal(noR.engine.getAvailableResourceCount(P1), 6, "nothing was paid");
  const opp = mcFd(G(5), R(4, P2));
  refused(() => flipUpOf(opp.engine, opp.id("mc")), "the opponent's [R] do not count", /threshold|icon/i);
  const one = mcFd([...G(4), ...R(1)]);
  flipUpOf(one.engine, one.id("mc"));
  resolvePendingResponses(one.engine);
  assert.equal(one.engine.state.cards[one.id("mc")].faceDown, false, "control: a single [R] among the resources is enough");
});

clause(MC, "3:flipUp", "FLIP UP does not change when a character can be deployed: refused on the opponent's turn", () => {
  const g = mcBoard({ zone: "play", faceDown: true, res: R(5), active: P2, turn: 3 });
  refused(() => flipUpOf(g.engine, g.id("mc")), "a character cannot be played on the opponent's turn", /timing|turn|priority/i);
  assert.equal(g.engine.state.cards[g.id("mc")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 6, "nothing was paid");
});

clause(MC, "3:flipUp", "a non-tactic cannot be flipped up inside the opponent's response window", () => {
  const g = mcBoard({
    zone: "play",
    faceDown: true,
    res: R(5),
    active: P2,
    turn: 3,
    extra: [{ key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => flipUpOf(g.engine, g.id("mc")), "a character cannot be played in a response window", /response|window|turn|priority|play/i);
  assert.equal(g.engine.state.cards[g.id("mc")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 6, "nothing was paid");
});

clause(MC, "3:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const theirs = mcFd([...R(3), ...G(2)], [...R(5, P2)]);
  refused(() => flipUpOf(theirs.engine, theirs.id("mc"), P2), "the opponent cannot flip my card", /control|player|not/i);
  assert.equal(theirs.engine.state.cards[theirs.id("mc")].faceDown, true);
  const up = mcBoard({ zone: "play", res: R(5) });
  refused(() => flipUpOf(up.engine, up.id("mc")), "already face-up", /face|flip/i);
  const inHand = mcBoard({ zone: "hand", res: R(5) });
  refused(() => flipUpOf(inHand.engine, inHand.id("mc")), "in the hand it is not a face-down resource", /face|flip|play|zone/i);
});

clause(MC, "3:flipUp", "flipping up a second McLargehuge while one is in play raises the UNIQUE choice", () => {
  const g = mcFd([...R(3), ...G(2)], [{ key: "mc2", def: printing(MC), owner: P1, zone: "play" }]);
  flipUpOf(g.engine, g.id("mc"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
});

clause(MC, "3:flipUp", "FLIP UP is an alternative: from the hand it deploys for its normal cost of 2 with [R][R][R][R]", () => {
  const g = mcBoard({ res: R(4) });
  deployMc(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mc")), "play");
  assert.equal(g.engine.state.cards[g.id("mc")].faceDown, false);
});

// =================================================================================
// Bloodcrazed Berserker -- warlord berserker character, cost 5, [R][R][R], 6 str / 3 spd / 2 life
// HEMORAGE -- COST: Destroy this card. Pick a faction or character. -- EFFECT: Inflict 4 damage to that card.
// FLIP UP: 4 [R]
// =================================================================================

const BZ = "3a8f423f-cc90-4571-876a-4320760f748f";

const bzBoard = (o: { zone?: "hand" | "play"; faceDown?: boolean; depleted?: boolean; res?: CardPlacement[]; extra?: CardPlacement[]; active?: Pid; turn?: number } = {}) =>
  baseBoard([{ key: "bz", def: printing(BZ), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown, depleted: o.depleted }, ...(o.res ?? []), ...(o.extra ?? [])], o);
type BZ = ReturnType<typeof bzBoard>;
const foeChar = (life: number, key = "foe", owner: Pid = P2): CardPlacement => ({ key, def: character({ name: `Char ${key}`, strength: 1, life, speed: 1 }), owner, zone: "play" });
const hemorage = (g: BZ, target: CardInstanceId) => activate(g.engine, P1, g.id("bz"), "hemorage", { selected: { t: [target] } });

clause(BZ, "0:ability:hemorage", "is a warlord berserker character with printed cost 5, threshold rrr, 6 str / 3 spd / 2 life", () => {
  const p = printing(BZ);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual(p.subtype, ["berserker"]);
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "rrr");
  const g = bzBoard();
  assert.deepEqual(triple(g.engine, g.id("bz")), [6, 2, 3]);
});

clause(BZ, "0:ability:hemorage", "deploys for exactly 5 with [R][R][R]; one resource short is refused; three [R] needed, two is one icon short", () => {
  const g = bzBoard({ zone: "hand", res: [...R(3), ...G(2)] });
  play(g.engine, P1, g.id("bz"), {});
  assert.equal(zoneOf(g.engine, g.id("bz")), "play");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "all 5 spent");
  const short = bzBoard({ zone: "hand", res: [...R(3), ...G(1)] });
  refused(() => play(short.engine, P1, short.id("bz"), {}), "cost 5 with 4 resources", /cost|afford|resource|pay/i);
  assert.equal(zoneOf(short.engine, short.id("bz")), "hand");
  const icon2 = bzBoard({ zone: "hand", res: [...R(2), ...G(3)] });
  refused(() => play(icon2.engine, P1, icon2.id("bz"), {}), "only 2 [R]", /threshold|icon/i);
  assert.equal(zoneOf(icon2.engine, icon2.id("bz")), "hand");
  assert.equal(icon2.engine.getAvailableResourceCount(P1), 5, "nothing was paid");
});

clause(BZ, "0:ability:hemorage", "COST: destroys itself; EFFECT: 4 damage to the picked opposing faction", () => {
  const g = bzBoard();
  const fac = g.engine.state.players[P2].factionId!;
  const inf = g.engine.state.players[P2].influence;
  hemorage(g, fac);
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.players[P2].influence, inf - 4);
  assert.equal(zoneOf(g.engine, g.id("bz")), "discard", "COST: Berserker destroyed");
});

clause(BZ, "0:ability:hemorage", "a faction is a legal pick for either side: your own faction takes 4 and the opponent's is untouched", () => {
  const g = bzBoard();
  const mine = g.engine.state.players[P1].factionId!;
  const inf1 = g.engine.state.players[P1].influence;
  const inf2 = g.engine.state.players[P2].influence;
  hemorage(g, mine);
  assert.equal(g.engine.state.players[P1].influence, inf1 - 4);
  assert.equal(g.engine.state.players[P2].influence, inf2);
  assert.equal(zoneOf(g.engine, g.id("bz")), "discard");
});

clause(BZ, "0:ability:hemorage", "an opposing character takes exactly 4: life 5 survives with 4 damage, life 4 is destroyed", () => {
  const g = bzBoard({ extra: [foeChar(5, "big"), foeChar(4, "mid"), foeChar(9, "far")] });
  hemorage(g, g.id("big"));
  assert.equal(dmg(g.engine, g.id("big")), 4);
  assert.equal(zoneOf(g.engine, g.id("big")), "play");
  assert.equal(dmg(g.engine, g.id("far")), 0, "the other characters are untouched");
  const h = bzBoard({ extra: [foeChar(4, "mid"), foeChar(9, "far")] });
  hemorage(h, h.id("mid"));
  assert.equal(zoneOf(h.engine, h.id("mid")), "discard");
  assert.equal(zoneOf(h.engine, h.id("far")), "play");
  assert.equal(dmg(h.engine, h.id("far")), 0);
});

clause(BZ, "0:ability:hemorage", "your own character is a legal pick too", () => {
  const g = bzBoard({ extra: [foeChar(9, "ally", P1), foeChar(9, "foe")] });
  hemorage(g, g.id("ally"));
  assert.equal(dmg(g.engine, g.id("ally")), 4);
  assert.equal(dmg(g.engine, g.id("foe")), 0);
  assert.equal(zoneOf(g.engine, g.id("bz")), "discard");
});

clause(BZ, "0:ability:hemorage", "only a faction or character can be picked: an item and a location are refused, and nothing is destroyed", () => {
  const g = bzBoard({
    extra: [
      { key: "it", def: item({ name: "AnItem", structure: 9 } as never), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "ALoc", structure: 9 } as never), owner: P2, zone: "play" },
      foeChar(9)
    ]
  });
  refused(() => hemorage(g, g.id("it")), "an item is neither a faction nor a character", /target|select|valid|legal|pick/i);
  refused(() => hemorage(g, g.id("loc")), "a location is neither a faction nor a character", /target|select|valid|legal|pick/i);
  assert.equal(zoneOf(g.engine, g.id("bz")), "play", "the cost was not paid");
  hemorage(g, g.id("foe"));
  assert.equal(dmg(g.engine, g.id("foe")), 4, "control: a character works");
});

clause(BZ, "0:ability:hemorage", "a face-down resource is not a character: it cannot be picked", () => {
  const g = bzBoard({ extra: [{ key: "fd", def: resourceCard({ name: "Fd" }), owner: P2, zone: "play", faceDown: true }, foeChar(9)] });
  refused(() => hemorage(g, g.id("fd")), "a face-down resource is not a character", /target|select|valid|legal|pick/i);
  assert.equal(zoneOf(g.engine, g.id("bz")), "play");
  assert.equal(zoneOf(g.engine, g.id("fd")), "play");
});

clause(BZ, "0:ability:hemorage", "a target must be picked: activating without one is refused and nothing is paid", () => {
  const g = bzBoard({ extra: [foeChar(9)] });
  refused(() => activate(g.engine, P1, g.id("bz"), "hemorage", { selected: {} }), "no pick", /target|select|pick/i);
  assert.equal(zoneOf(g.engine, g.id("bz")), "play");
});

clause(BZ, "0:ability:hemorage", "it has no deplete cost: a depleted Berserker can still use HEMORAGE", () => {
  const g = bzBoard({ depleted: true, extra: [foeChar(9)] });
  hemorage(g, g.id("foe"));
  assert.equal(dmg(g.engine, g.id("foe")), 4);
  assert.equal(zoneOf(g.engine, g.id("bz")), "discard");
});

clause(BZ, "0:ability:hemorage", "it can be used in response on the opponent's turn: an attacker is picked and destroyed", () => {
  const g = bzBoard({ turn: 3, active: P2, extra: [foeChar(3, "atk")] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  hemorage(g, g.id("atk"));
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
  assert.equal(zoneOf(g.engine, g.id("bz")), "discard");
});

clause(BZ, "0:ability:hemorage", "the opponent cannot use my Berserker's ability, and it is unusable face-down or from the hand", () => {
  const g = bzBoard({ extra: [foeChar(9)] });
  refused(() => activate(g.engine, P2, g.id("bz"), "hemorage", { selected: { t: [g.id("foe")] } }), "not the controller", /control|player|priority|not/i);
  assert.equal(zoneOf(g.engine, g.id("bz")), "play");
  const fd = bzBoard({ faceDown: true, extra: [foeChar(9)] });
  refused(() => hemorage(fd, fd.id("foe")), "a face-down card has no abilities", /ability|face|not/i);
  const hand = bzBoard({ zone: "hand", extra: [foeChar(9)] });
  refused(() => hemorage(hand, hand.id("foe")), "not in play", /ability|play|zone|not/i);
});

clause(BZ, "0:ability:hemorage", "picking itself: the cost destroys it, so it deals the damage to nothing and the opponent is untouched", () => {
  const g = bzBoard({ extra: [foeChar(9)] });
  const inf2 = g.engine.state.players[P2].influence;
  hemorage(g, g.id("bz"));
  assert.equal(zoneOf(g.engine, g.id("bz")), "discard");
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.players[P2].influence, inf2);
  assert.equal(dmg(g.engine, g.id("foe")), 0);
});

const bzFd = (res: CardPlacement[], extra: CardPlacement[] = [], o: { active?: Pid; turn?: number } = {}) => bzBoard({ faceDown: true, res, extra, ...o });

clause(BZ, "1:flipUp", "a face-down Berserker flips up for 4 with [R]: itself plus three others pay, and it becomes a face-up character with its printed stats", () => {
  const g = bzFd([...R(1), ...G(2), ...G(1)]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
  flipUpOf(g.engine, g.id("bz"));
  resolvePendingResponses(g.engine);
  const c = g.engine.state.cards[g.id("bz")];
  assert.equal(c.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("bz")), ["character"]);
  assert.deepEqual(triple(g.engine, g.id("bz")), [6, 2, 3]);
});

clause(BZ, "1:flipUp", "is refused when one short: the card plus two ready resources is three, and nothing is paid", () => {
  const g = bzFd([...R(2), ...spentR(2)]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 3);
  refused(() => flipUpOf(g.engine, g.id("bz")), "3 ready resources for FLIP UP cost 4", /cost|resource|afford|pay/i);
  assert.equal(g.engine.state.cards[g.id("bz")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 3);
  const ok = bzFd([...R(3), ...spentR(1)]);
  flipUpOf(ok.engine, ok.id("bz"));
  assert.equal(ok.engine.state.cards[ok.id("bz")].faceDown, false, "control: card + 3 ready");
});

clause(BZ, "1:flipUp", "needs [R]: Greed resources are not the threshold, the card's own Volition is not [R], and the opponent's [R] do not count", () => {
  const noR = bzFd(G(4));
  refused(() => flipUpOf(noR.engine, noR.id("bz")), "no [R]", /threshold|icon/i);
  assert.equal(noR.engine.state.cards[noR.id("bz")].faceDown, true);
  assert.equal(noR.engine.getAvailableResourceCount(P1), 5);
  const opp = bzFd(G(4), R(4, P2));
  refused(() => flipUpOf(opp.engine, opp.id("bz")), "the opponent's [R]", /threshold|icon/i);
  const one = bzFd([...G(3), ...R(1)]);
  flipUpOf(one.engine, one.id("bz"));
  assert.equal(one.engine.state.cards[one.id("bz")].faceDown, false, "control: one [R]");
});

clause(BZ, "1:flipUp", "FLIP UP does not change when a character can be deployed: refused on the opponent's turn", () => {
  const g = bzFd(R(4), [], { active: P2, turn: 3 });
  refused(() => flipUpOf(g.engine, g.id("bz")), "a character cannot be played on the opponent's turn", /timing|turn|priority/i);
  assert.equal(g.engine.state.cards[g.id("bz")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
});

clause(BZ, "1:flipUp", "a non-tactic cannot be flipped up inside the opponent's response window", () => {
  const g = bzFd(R(4), [foeChar(3, "foe")], { active: P2, turn: 3 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => flipUpOf(g.engine, g.id("bz")), "a character cannot be played in a response window", /response|window|turn|priority|play/i);
  assert.equal(g.engine.state.cards[g.id("bz")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
});

clause(BZ, "1:flipUp", "only its controller can flip it, and only while face-down in play", () => {
  const g = bzFd(R(4), R(4, P2));
  refused(() => flipUpOf(g.engine, g.id("bz"), P2), "the opponent cannot flip my card", /control|player|not/i);
  assert.equal(g.engine.state.cards[g.id("bz")].faceDown, true);
  const up = bzBoard({ res: R(4) });
  refused(() => flipUpOf(up.engine, up.id("bz")), "already face-up", /face|flip/i);
  const hand = bzBoard({ zone: "hand", res: R(4) });
  refused(() => flipUpOf(hand.engine, hand.id("bz")), "in hand", /face|flip|play|zone/i);
});

clause(BZ, "1:flipUp", "FLIP UP is an alternative: from the hand it deploys for its normal cost of 5, not 4", () => {
  const g = bzBoard({ zone: "hand", res: R(4) });
  refused(() => play(g.engine, P1, g.id("bz"), {}), "4 resources for the normal cost of 5", /cost|afford|resource|pay/i);
});

// =================================================================================
// Breath of the Barduse -- warlord tactic, cost 4, [R][R]
// EXTRA COST: Deploy this only during your turn.
// Each player destroys 2 characters they own. Otherwise, destroy all of that player's characters.
// =================================================================================

const BR = "f28ced68-ff65-4257-8e08-178a51d9e15e";

const ch = (key: string, owner: Pid, over: { controller?: Pid } = {}): CardPlacement => ({
  key,
  def: character({ name: `C ${key}`, strength: 1, life: 3, speed: 1 }),
  owner,
  zone: "play",
  controller: over.controller
});
const brBoard = (o: { res?: CardPlacement[]; extra?: CardPlacement[]; active?: Pid; turn?: number } = {}) =>
  baseBoard([{ key: "br", def: printing(BR), owner: P1, zone: "hand" }, ...(o.res ?? R(4)), ...(o.extra ?? [])], o);
type BR = ReturnType<typeof brBoard>;
const threeEach = (): CardPlacement[] => [ch("a1", P1), ch("a2", P1), ch("a3", P1), ch("b1", P2), ch("b2", P2), ch("b3", P2)];
/** Casts Breath; each player's pick-prompt is answered from `picks[player]`, and the players prompted are recorded in order. */
function castBreath(g: BR, picks: Partial<Record<Pid, string[]>>): Pid[] {
  const seen: Pid[] = [];
  play(g.engine, P1, g.id("br"), {});
  drain(g.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    seen.push(pc.playerId as Pid);
    return { kind: "chooserSelectsTarget", selected: (picks[pc.playerId as Pid] ?? []).map((k) => g.id(k)) };
  });
  return seen;
}

clause(BR, "0:extraCost", "is a warlord tactic with printed cost 4 and threshold rr, and no subtype", () => {
  const p = printing(BR);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "rr");
  assert.deepEqual(p.subtype ?? [], []);
});

clause(BR, "0:extraCost", "costs exactly 4: castable with 4 resources, all spent; refused with 3", () => {
  const g = brBoard({ extra: [ch("a1", P1)] });
  // The destroy pick is mandatory now (SYS-20), so the caster destroys their one character instead of declining.
  castBreath(g, { [P1]: ["a1"] });
  assert.equal(zoneOf(g.engine, g.id("br")), "discard");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "all 4 spent");
  const s = brBoard({ res: R(3), extra: [ch("a1", P1)] });
  refused(() => play(s.engine, P1, s.id("br"), {}), "cost 4 with 3 resources", /cost|afford|resource|pay/i);
  assert.equal(zoneOf(s.engine, s.id("br")), "hand");
  assert.equal(zoneOf(s.engine, s.id("a1")), "play");
});

clause(BR, "0:extraCost", "threshold rr: two [R] among the four works; one [R] and none are refused", () => {
  const ok = brBoard({ res: [...R(2), ...G(2)], extra: [ch("a1", P1)] });
  // The destroy pick is mandatory now (SYS-20), so the caster destroys their one character instead of declining.
  castBreath(ok, { [P1]: ["a1"] });
  assert.equal(zoneOf(ok.engine, ok.id("br")), "discard", "control: 2 [R] + 2 [G]");
  const one = brBoard({ res: [...R(1), ...G(3)], extra: [ch("a1", P1)] });
  refused(() => play(one.engine, P1, one.id("br"), {}), "one [R] short of rr", /threshold|icon/i);
  assert.equal(zoneOf(one.engine, one.id("br")), "hand");
  assert.equal(one.engine.getAvailableResourceCount(P1), 4, "nothing was paid");
  const none = brBoard({ res: G(4), extra: [ch("a1", P1)] });
  refused(() => play(none.engine, P1, none.id("br"), {}), "no [R]", /threshold|icon/i);
});

clause(BR, "0:extraCost", "can be deployed during your own turn but not during the opponent's turn (response window)", () => {
  const own = brBoard({ extra: [ch("a1", P1)] });
  // The destroy pick is mandatory now (SYS-20), so the caster destroys their one character instead of declining.
  castBreath(own, { [P1]: ["a1"] });
  assert.equal(zoneOf(own.engine, own.id("br")), "discard", "control: own turn");
  const g = brBoard({ active: P2, turn: 3, extra: [ch("a1", P1), ch("foe", P2)] });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => play(g.engine, P1, g.id("br"), {}), "only during your turn", /cannot be deployed/i);
  assert.equal(zoneOf(g.engine, g.id("br")), "hand");
  assert.equal(zoneOf(g.engine, g.id("a1")), "play");
  assert.equal(g.engine.getAvailableResourceCount(P1), 4, "nothing was paid");
});

clause(BR, "1:rule", "each player destroys 2 characters THEY choose of those they own: you choose yours, the opponent chooses theirs, the third of each survives", () => {
  const g = brBoard({ extra: threeEach() });
  const seen = castBreath(g, { [P1]: ["a1", "a2"], [P2]: ["b1", "b3"] });
  assert.deepEqual(seen, [P1, P2], "I choose first, then the opponent");
  assert.deepEqual(["a1", "a2", "a3"].map((k) => zoneOf(g.engine, g.id(k))), ["discard", "discard", "play"]);
  assert.deepEqual(["b1", "b2", "b3"].map((k) => zoneOf(g.engine, g.id(k))), ["discard", "play", "discard"]);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("br")), "discard");
});

clause(BR, "1:rule", "a player destroys only their own characters: picking the opponent's character is refused", () => {
  const g = brBoard({ extra: threeEach() });
  play(g.engine, P1, g.id("br"), {});
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("b1"), g.id("a1")] }), "b1 is the opponent's", /select|target|invalid|candidate|legal|own/i);
  assert.equal(zoneOf(g.engine, g.id("b1")), "play");
  assert.equal(zoneOf(g.engine, g.id("a1")), "play");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a1"), g.id("a2")] });
  assert.equal(pending(g.engine)?.playerId, P2);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a3"), g.id("b1")] }), "a3 is mine", /select|target|invalid|candidate|legal|own/i);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("b1"), g.id("b2")] });
  assert.equal(zoneOf(g.engine, g.id("a3")), "play");
  assert.deepEqual(["b1", "b2", "b3"].map((k) => zoneOf(g.engine, g.id(k))), ["discard", "discard", "play"]);
});

clause(BR, "1:rule", "a player must destroy exactly 2: selecting fewer than 2 (or none) of three is refused", () => {
  const g = brBoard({ extra: threeEach() });
  play(g.engine, P1, g.id("br"), {});
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "destroying 0 of 3 is not allowed", /select|target|invalid|count|exactly|legal|must/i);
  assert.equal(zoneOf(g.engine, g.id("a1")), "play");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("a1")] }), "destroying 1 of 3 is not allowed", /select|target|invalid|count|exactly|legal|must/i);
  assert.equal(zoneOf(g.engine, g.id("a1")), "play");
});

clause(BR, "1:rule", "the 'otherwise': a player with exactly 1 character loses it (all of that player's characters), the other with 3 still picks 2", () => {
  const g = brBoard({ extra: [ch("a1", P1), ch("b1", P2), ch("b2", P2), ch("b3", P2)] });
  castBreath(g, { [P2]: ["b1", "b3"] });
  assert.equal(zoneOf(g.engine, g.id("a1")), "discard", "my only character is destroyed");
  assert.deepEqual(["b1", "b2", "b3"].map((k) => zoneOf(g.engine, g.id(k))), ["discard", "play", "discard"]);
});

clause(BR, "1:rule", "the 'otherwise' without any pick: with 1 character each, both are destroyed even when the picks are declined", () => {
  const g = brBoard({ extra: [ch("a1", P1), ch("b1", P2)] });
  play(g.engine, P1, g.id("br"), {});
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("a1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("b1")), "discard");
});

clause(BR, "1:rule", "exactly 2 characters each: both of each player's are destroyed", () => {
  const g = brBoard({ extra: [ch("a1", P1), ch("a2", P1), ch("b1", P2), ch("b2", P2)] });
  castBreath(g, { [P1]: ["a1", "a2"], [P2]: ["b1", "b2"] });
  for (const k of ["a1", "a2", "b1", "b2"]) assert.equal(zoneOf(g.engine, g.id(k)), "discard", k);
});

clause(BR, "1:rule", "a player with no characters is unaffected and the other still destroys 2 of 3", () => {
  const g = brBoard({ extra: [ch("b1", P2), ch("b2", P2), ch("b3", P2)] });
  castBreath(g, { [P2]: ["b2", "b3"] });
  assert.deepEqual(["b1", "b2", "b3"].map((k) => zoneOf(g.engine, g.id(k))), ["play", "discard", "discard"]);
  assert.equal(zoneOf(g.engine, g.id("br")), "discard");
});

clause(BR, "1:rule", "with 0 characters on both sides it resolves with no effect and no pending choice", () => {
  const g = brBoard({ extra: [{ key: "it", def: item({ name: "OnlyItem" }), owner: P2, zone: "play" }] });
  play(g.engine, P1, g.id("br"), {});
  drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("it")), "play");
});

clause(BR, "1:rule", "only characters are destroyed: items, locations and a face-down resource of the same owners stay", () => {
  const g = brBoard({
    extra: [
      ...threeEach(),
      { key: "i1", def: item({ name: "I1" }), owner: P1, zone: "play" },
      { key: "l2", def: location({ name: "L2", structure: 3 } as never), owner: P2, zone: "play" },
      { key: "fd", def: resourceCard({ name: "FdRes" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  castBreath(g, { [P1]: ["a1", "a2"], [P2]: ["b1", "b2"] });
  for (const k of ["i1", "l2", "fd"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", k);
});

clause(BR, "1:rule", "'they own': a character I control but the opponent owns is the opponent's to destroy, and one I own but they control is mine", () => {
  const g = brBoard({
    extra: [ch("a1", P1), ch("a2", P1), ch("a3", P1), ch("b1", P2), ch("b2", P2), ch("b3", P2), ch("stolen", P2, { controller: P1 }), ch("lent", P1, { controller: P2 })]
  });
  play(g.engine, P1, g.id("br"), {});
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("stolen"), g.id("a1")] }), "I control it but the opponent owns it", /select|target|invalid|candidate|legal|own/i);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("lent"), g.id("a1")] });
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("lent"), g.id("b1")] }), "already gone / mine", /select|target|invalid|candidate|legal|own|zone/i);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("stolen"), g.id("b1")] });
  assert.equal(zoneOf(g.engine, g.id("lent")), "discard");
  assert.equal(zoneOf(g.engine, g.id("stolen")), "discard");
  assert.equal(zoneOf(g.engine, g.id("a2")), "play");
  assert.equal(zoneOf(g.engine, g.id("b2")), "play");
});

// =================================================================================
// Bursting Bask -- warlord dragon character, cost 7, [R], 5 str / 2 spd / 5 life
// [R][R][R][R][R][R]: When this card enters play, you may pick a character. If you do, inflict 5 damage to it.
// FLIP UP: 4 [R][R][R]
// =================================================================================

const BK = "51a2c73b-4459-4678-8e2e-d464f967a8fa";

const bkBoard = (o: { zone?: "hand" | "play"; faceDown?: boolean; res?: CardPlacement[]; extra?: CardPlacement[]; active?: Pid; turn?: number } = {}) =>
  baseBoard([{ key: "bk", def: printing(BK), owner: P1, zone: o.zone ?? "hand", faceDown: o.faceDown }, ...(o.res ?? []), ...(o.extra ?? [])], o);
type BK = ReturnType<typeof bkBoard>;
const deployBk = (g: BK) => play(g.engine, P1, g.id("bk"), {});
const bkVictims = (): CardPlacement[] => [foeChar(9, "foe"), foeChar(9, "ally", P1), { key: "it", def: item({ name: "AnItem", structure: 9 } as never), owner: P2, zone: "play" }];

clause(BK, "0:rule@rrrrrr", "is a warlord dragon character with printed cost 7, threshold r, 5 str / 2 spd / 5 life", () => {
  const p = printing(BK);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual(p.subtype, ["dragon"]);
  assert.equal(p.cost, 7);
  assert.equal(p.threshold, "r");
  const g = bkBoard({ zone: "play" });
  assert.deepEqual(triple(g.engine, g.id("bk")), [5, 5, 2]);
});

clause(BK, "0:rule@rrrrrr", "costs exactly 7 and needs [R]: 7 resources with one [R] deploy it (no trigger), 6 are refused, and 7 without any [R] are refused", () => {
  const g = bkBoard({ res: [...R(1), ...G(6)] });
  deployBk(g);
  assert.equal(zoneOf(g.engine, g.id("bk")), "play");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "all 7 spent");
  assert.equal(pending(g.engine), undefined, "only 1 [R] icon: the 6-[R] ability is off");
  const short = bkBoard({ res: R(6) });
  refused(() => deployBk(short), "cost 7 with 6 resources", /cost|afford|resource|pay/i);
  assert.equal(zoneOf(short.engine, short.id("bk")), "hand");
  const none = bkBoard({ res: G(7) });
  refused(() => deployBk(none), "no [R] for threshold r", /threshold|icon/i);
  assert.equal(none.engine.getAvailableResourceCount(P1), 7, "nothing was paid");
});

clause(BK, "0:rule@rrrrrr", "with six [R] icons (7 resources, 6 of them [R]) entering play lets you pick a character, and 5 damage is inflicted on it", () => {
  const g = bkBoard({ res: [...R(6), ...G(1)], extra: bkVictims() });
  deployBk(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(dmg(g.engine, g.id("foe")), 5);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(dmg(g.engine, g.id("ally")), 0, "only the picked character takes damage");
});

clause(BK, "0:rule@rrrrrr", "exactly 5 damage: a life-5 character dies, a life-6 character survives with 5 damage", () => {
  const g = bkBoard({ res: R(7), extra: [foeChar(5, "five"), foeChar(6, "six")] });
  deployBk(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("five")] });
  assert.equal(zoneOf(g.engine, g.id("five")), "discard");
  assert.equal(dmg(g.engine, g.id("six")), 0);
  const h = bkBoard({ res: R(7), extra: [foeChar(6, "six")] });
  deployBk(h);
  answerPending(h.engine, "chooserSelectsTarget", { selected: [h.id("six")] });
  assert.equal(dmg(h.engine, h.id("six")), 5);
  assert.equal(zoneOf(h.engine, h.id("six")), "play");
});

clause(BK, "0:rule@rrrrrr", "any character may be picked: your own character is legal", () => {
  const g = bkBoard({ res: R(7), extra: bkVictims() });
  deployBk(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally")] });
  assert.equal(dmg(g.engine, g.id("ally")), 5);
  assert.equal(dmg(g.engine, g.id("foe")), 0);
});

clause(BK, "0:rule@rrrrrr", "the Bask itself is on the board when the trigger resolves, so it can pick itself (5 damage, life 5: destroyed)", () => {
  const g = bkBoard({ res: R(7), extra: bkVictims() });
  deployBk(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("bk")] });
  assert.equal(zoneOf(g.engine, g.id("bk")), "discard");
});

clause(BK, "0:rule@rrrrrr", "only a character can be picked: an item and a faction are refused, and the pick can still be made afterwards", () => {
  const g = bkBoard({ res: R(7), extra: bkVictims() });
  deployBk(g);
  const fac = g.engine.state.players[P2].factionId!;
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("it")] }), "an item", /select|target|invalid|candidate|legal/i);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [fac] }), "a faction", /select|target|invalid|candidate|legal/i);
  assert.equal(dmg(g.engine, g.id("it")), 0);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(dmg(g.engine, g.id("foe")), 5, "control");
});

clause(BK, "0:rule@rrrrrr", "'you may': declining the pick inflicts no damage", () => {
  const g = bkBoard({ res: R(7), extra: bkVictims() });
  deployBk(g);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(dmg(g.engine, g.id("foe")), 0);
  assert.equal(dmg(g.engine, g.id("ally")), 0);
  assert.equal(dmg(g.engine, g.id("bk")), 0);
  assert.equal(zoneOf(g.engine, g.id("bk")), "play");
});

clause(BK, "0:rule@rrrrrr", "only one character is picked: two picks are refused", () => {
  const g = bkBoard({ res: R(7), extra: bkVictims() });
  deployBk(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe"), g.id("ally")] }), "'a character' is one", /select|target|invalid|count|legal|too many/i);
  assert.equal(dmg(g.engine, g.id("foe")), 0);
  assert.equal(dmg(g.engine, g.id("ally")), 0);
});

clause(BK, "0:rule@rrrrrr", "threshold: with only five [R] icons the ability is off (no pick, no damage)", () => {
  const g = bkBoard({ res: [...R(5), ...G(2)], extra: bkVictims() });
  deployBk(g);
  assert.equal(zoneOf(g.engine, g.id("bk")), "play");
  assert.equal(pending(g.engine), undefined);
  assert.equal(dmg(g.engine, g.id("foe")), 0);
  assert.equal(dmg(g.engine, g.id("ally")), 0);
});

clause(BK, "0:rule@rrrrrr", "threshold: exactly six [R] among seven resources is enough", () => {
  const g = bkBoard({ res: [...R(6), ...G(1)], extra: bkVictims() });
  deployBk(g);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
});

clause(BK, "0:rule@rrrrrr", "threshold counts spent [R] too: seven ready [G] pay the cost while six spent [R] meet the threshold", () => {
  const g = bkBoard({ res: [...spentR(6), ...G(7)], extra: bkVictims() });
  deployBk(g);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
});

clause(BK, "0:rule@rrrrrr", "threshold counts only my own resources: the opponent's [R] do not turn it on", () => {
  const g = bkBoard({ res: [...R(3), ...G(4)], extra: [...bkVictims(), ...R(6, P2)] });
  deployBk(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(dmg(g.engine, g.id("foe")), 0);
});

clause(BK, "0:rule@rrrrrr", "only triggers when THIS card enters play: another character entering while Bask is in play does nothing", () => {
  const g = bkBoard({
    zone: "play",
    res: R(7),
    extra: [...bkVictims(), { key: "newbie", def: character({ name: "Newbie", cost: 1, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("newbie"), {});
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("newbie")), "play");
  assert.equal(pending(g.engine), undefined);
  assert.equal(dmg(g.engine, g.id("foe")), 0);
});

const bkFd = (res: CardPlacement[], extra: CardPlacement[] = [], o: { active?: Pid; turn?: number } = {}) => bkBoard({ zone: "play", faceDown: true, res, extra, ...o });

clause(BK, "1:flipUp", "a face-down Bask flips up for 4 with [R][R][R]: itself plus three others pay, and it becomes a face-up character with its printed stats", () => {
  const g = bkFd([...R(3), ...G(1)]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
  flipUpOf(g.engine, g.id("bk"));
  resolvePendingResponses(g.engine);
  const c = g.engine.state.cards[g.id("bk")];
  assert.equal(c.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("bk")), ["character"]);
  assert.deepEqual(triple(g.engine, g.id("bk")), [5, 5, 2]);
  assert.equal(pending(g.engine), undefined, "only 3 [R] icons: the 6-[R] ability is off");
});

clause(BK, "1:flipUp", "flipped up with six [R] icons in total (3 ready + 3 spent), its enter-play ability fires (it re-enters play)", () => {
  const g = bkFd([...R(3), ...spentR(3), ...G(1)], bkVictims());
  flipUpOf(g.engine, g.id("bk"));
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("foe")] });
  assert.equal(dmg(g.engine, g.id("foe")), 5);
});

clause(BK, "1:flipUp", "is refused when one short: the card plus two ready [R] is three, and nothing is paid", () => {
  const g = bkFd([...R(2), ...spentR(2)]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 3);
  refused(() => flipUpOf(g.engine, g.id("bk")), "3 ready resources for cost 4", /cost|resource|afford|pay/i);
  assert.equal(g.engine.state.cards[g.id("bk")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 3);
  const ok = bkFd([...R(3), ...spentR(1)]);
  flipUpOf(ok.engine, ok.id("bk"));
  assert.equal(ok.engine.state.cards[ok.id("bk")].faceDown, false, "control");
});

clause(BK, "1:flipUp", "needs [R][R][R]: only two [R] among the others is one icon short; the card's own Volition and the opponent's [R] do not count", () => {
  const two = bkFd([...R(2), ...G(2)]);
  refused(() => flipUpOf(two.engine, two.id("bk")), "2 [R] of the needed 3", /threshold|icon/i);
  assert.equal(two.engine.state.cards[two.id("bk")].faceDown, true);
  assert.equal(two.engine.getAvailableResourceCount(P1), 5, "nothing was paid");
  const opp = bkFd([...R(2), ...G(2)], R(4, P2));
  refused(() => flipUpOf(opp.engine, opp.id("bk")), "the opponent's [R]", /threshold|icon/i);
  const ok = bkFd([...R(3), ...G(1)]);
  flipUpOf(ok.engine, ok.id("bk"));
  assert.equal(ok.engine.state.cards[ok.id("bk")].faceDown, false, "control: three [R]");
});

clause(BK, "1:flipUp", "FLIP UP does not change when a character can be deployed: refused on the opponent's turn", () => {
  const g = bkFd(R(4), [], { active: P2, turn: 3 });
  refused(() => flipUpOf(g.engine, g.id("bk")), "a character cannot be played on the opponent's turn", /timing|turn|priority/i);
  assert.equal(g.engine.state.cards[g.id("bk")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
});

clause(BK, "1:flipUp", "a non-tactic cannot be flipped up inside the opponent's response window", () => {
  const g = bkFd(R(4), [foeChar(3, "foe")], { active: P2, turn: 3 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => flipUpOf(g.engine, g.id("bk")), "a character cannot be played in a response window", /response|window|turn|priority|play/i);
  assert.equal(g.engine.state.cards[g.id("bk")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
});

clause(BK, "1:flipUp", "only its controller can flip it, and only while face-down in play", () => {
  const g = bkFd(R(4), R(4, P2));
  refused(() => flipUpOf(g.engine, g.id("bk"), P2), "the opponent cannot flip my card", /control|player|not/i);
  assert.equal(g.engine.state.cards[g.id("bk")].faceDown, true);
  const up = bkBoard({ zone: "play", res: R(4) });
  refused(() => flipUpOf(up.engine, up.id("bk")), "already face-up", /face|flip/i);
  const hand = bkBoard({ res: R(4) });
  refused(() => flipUpOf(hand.engine, hand.id("bk")), "in hand", /face|flip|play|zone/i);
});

clause(BK, "1:flipUp", "FLIP UP is an alternative: from the hand it deploys for its normal cost of 7, not 4", () => {
  const g = bkBoard({ res: R(4) });
  refused(() => deployBk(g), "4 resources for the normal cost of 7", /cost|afford|resource|pay/i);
  assert.equal(zoneOf(g.engine, g.id("bk")), "hand");
});
