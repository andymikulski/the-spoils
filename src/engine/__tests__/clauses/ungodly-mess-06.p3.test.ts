// Clause tests: Ungodly Mess batch 06, part p3 (groups 12-18, missing clauses only).
import assert from "node:assert/strict";
import type { SpoilsEngine } from "../../SpoilsEngine.js";
import { buildGame, activate, bank, character, developFaction, item, location, play, resolvePendingResponses, resourceCard, tactic, volition, P1, P2 } from "../per-card/_harness.js";
import { declareAttackOpenWindow, fightThrough } from "./_battle.js";
import { answerPending, pending, zoneOf } from "./_board.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { endTurn } from "./_turn.js";

type Cards = NonNullable<NonNullable<Parameters<typeof buildGame>[0]>["cards"]>;
const ready = (e: SpoilsEngine, p: string) => e.getAvailableResourceCount(p as never);
const isDepleted = (e: SpoilsEngine, id: string) => e.state.cards[id as never].depleted === true;
const isFaceDown = (e: SpoilsEngine, id: string) => e.state.cards[id as never].faceDown === true;
const controllerOf = (e: SpoilsEngine, id: string) => e.state.cards[id as never].controllerId;
const handOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].hand] as string[];
const deckOf = (e: SpoilsEngine, p: string) => [...e.state.players[p as never].deck] as string[];
const spentD = (owner: string, n: number): Cards =>
  bank("deception", n, owner as never).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const game = (cards: Cards, o: { turn?: number; active?: string } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active as never,
    cards
  });
const flipUp = (b: ReturnType<typeof game>, key: string, player: string = P1) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id(key), selected: {}, variables: {} });

// ============================================================================
// Chosen Reaper of Thabbash
// CONSUME FORCE -- COST: Pay 1. Deplete another character you control. -- EFFECT: This turn, this card gains 1 speed.
// FLIP UP: 4 [D]
// Character, rogue, outcast, cost 6, [D][D], 5 str / 3 spd / 3 life.
// ============================================================================
const REAPER = "d4daefff-38f6-41f4-a353-fef5677f4aae";

clause(REAPER, "0:ability:consume-force", "printed card: character / rogue / outcast, cost 6, threshold [D][D], 5 str / 3 spd / 3 life", () => {
  const d = printing(REAPER);
  assert.deepEqual([d.type, d.trade, d.subtype, d.cost, d.threshold], ["character", "rogue", ["outcast"], 6, "dd"]);
  const ok = game([{ key: "r", def: printing(REAPER), owner: P1, zone: "hand" }, ...bank("deception", 7, P1)]);
  play(ok.engine, P1, ok.id("r"));
  assert.equal(zoneOf(ok.engine, ok.id("r")), "play");
  assert.equal(ready(ok.engine, P1), 1, "exactly 6 of 7 paid");
  assert.deepEqual(
    [ok.engine.getStat(ok.id("r"), "strength"), ok.engine.getStat(ok.id("r"), "speed"), ok.engine.getStat(ok.id("r"), "life")],
    [5, 3, 3]
  );
  const exact = game([{ key: "r", def: printing(REAPER), owner: P1, zone: "hand" }, ...bank("deception", 6, P1)]);
  play(exact.engine, P1, exact.id("r"));
  assert.equal(zoneOf(exact.engine, exact.id("r")), "play", "6 resources is enough");
  assert.equal(ready(exact.engine, P1), 0);
  const short = game([{ key: "r", def: printing(REAPER), owner: P1, zone: "hand" }, ...bank("deception", 5, P1)]);
  refused(() => play(short.engine, P1, short.id("r")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("r")), "hand");
  const noIcon = game([{ key: "r", def: printing(REAPER), owner: P1, zone: "hand" }, ...bank("deception", 1, P1), ...bank("rage", 5, P1)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("r")), "one [D] short of the threshold");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("r")), "hand");
  const two = game([{ key: "r", def: printing(REAPER), owner: P1, zone: "hand" }, ...bank("deception", 2, P1), ...bank("rage", 4, P1)]);
  play(two.engine, P1, two.id("r"));
  assert.equal(zoneOf(two.engine, two.id("r")), "play", "control: two [D] plus anything is enough");
});

const reaperBoard = (extra: Cards = [], res = 3) =>
  game([
    { key: "r", def: printing(REAPER), owner: P1, zone: "play" },
    { key: "ally", def: character({ name: "Ally", speed: 2 }), owner: P1, zone: "play" },
    ...bank("deception", res, P1),
    ...extra
  ]);

clause(REAPER, "0:ability:consume-force", "pays 1, depletes the chosen other character (not itself), and this card gains 1 speed", () => {
  const b = reaperBoard();
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 3);
  activate(b.engine, P1, b.id("r"), "consume-force", { selected: { c: [b.id("ally")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 4, "+1 speed");
  assert.equal(b.engine.getStat(b.id("r"), "strength"), 5);
  assert.equal(b.engine.getStat(b.id("r"), "life"), 3);
  assert.equal(isDepleted(b.engine, b.id("ally")), true, "the other character is depleted");
  assert.equal(isDepleted(b.engine, b.id("r")), false, "this card is not depleted");
  assert.equal(ready(b.engine, P1), 2, "exactly 1 paid");
  assert.equal(b.engine.getStat(b.id("ally"), "speed"), 2, "the ally gains nothing");
});

clause(REAPER, "0:ability:consume-force", "cost and targets: needs 1 resource; the target must be another, undepleted character you control", () => {
  const foe = { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" as const };
  const it = { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" as const };
  const dep = { key: "dep", def: character({ name: "Dep" }), owner: P1, zone: "play" as const, depleted: true };
  const b = reaperBoard([foe, it, dep], 1);
  const go = (sel: Record<string, string[]>) => activate(b.engine, P1, b.id("r"), "consume-force", { selected: sel });
  refused(() => go({ c: [b.id("r")] }), "cannot deplete itself as the other character");
  refused(() => go({ c: [b.id("foe")] }), "an opponent's character");
  refused(() => go({ c: [b.id("it")] }), "an item");
  refused(() => go({ c: [b.id("dep")] }), "an already depleted character can't be depleted again");
  refused(() => go({}), "no character picked");
  assert.equal(ready(b.engine, P1), 1, "nothing was paid by the refusals");
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 3);
  go({ c: [b.id("ally")] });
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 4, "control: a legal pick works");
  const none = reaperBoard([], 0);
  refused(() => activate(none.engine, P1, none.id("r"), "consume-force", { selected: { c: [none.id("ally")] } }), "pay 1 with no resources");
  assert.equal(isDepleted(none.engine, none.id("ally")), false);
});

clause(REAPER, "0:ability:consume-force", "the speed bonus lasts this turn only", () => {
  const b = reaperBoard();
  activate(b.engine, P1, b.id("r"), "consume-force", { selected: { c: [b.id("ally")] } });
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 4);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 3, "gone at the opponent's turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 3, "and on the next own turn");
});

clause(REAPER, "0:ability:consume-force", "(T3c9) the speed bonus lasts the whole turn, not just one battle", () => {
  const b = reaperBoard();
  activate(b.engine, P1, b.id("r"), "consume-force", { selected: { c: [b.id("ally")] } });
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 4);
  fightThrough(b.engine, P1, [b.id("r")], { type: "faction", playerId: P2 }, []);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 4, "still +1 after the battle");
});

clause(REAPER, "0:ability:consume-force", "can be used repeatedly (bonuses stack) and while this card is depleted", () => {
  const b = reaperBoard([{ key: "ally2", def: character({ name: "Ally2" }), owner: P1, zone: "play" }]);
  b.engine.state.cards[b.id("r")].depleted = true;
  activate(b.engine, P1, b.id("r"), "consume-force", { selected: { c: [b.id("ally")] } });
  activate(b.engine, P1, b.id("r"), "consume-force", { selected: { c: [b.id("ally2")] } });
  assert.equal(b.engine.getStat(b.id("r"), "speed"), 5, "two activations give +2");
  assert.equal(ready(b.engine, P1), 1);
});

const flipBoard = (cards: Cards, o: { turn?: number; active?: string } = {}) =>
  game([{ key: "r", def: printing(REAPER), owner: P1, zone: "play", faceDown: true }, ...cards], o);

clause(REAPER, "1:flipUp", "FLIP UP costs exactly 4 (this face-down card may help pay) and needs a [D]", () => {
  const exact = flipBoard(bank("deception", 3, P1));
  assert.equal(ready(exact.engine, P1), 4, "three banks plus the face-down card");
  flipUp(exact, "r");
  assert.equal(isFaceDown(exact.engine, exact.id("r")), false, "3 others plus itself pays 4");
  assert.equal(zoneOf(exact.engine, exact.id("r")), "play");
  assert.equal(ready(exact.engine, P1), 0, "all 4 paid");
  assert.deepEqual(
    [exact.engine.getStat(exact.id("r"), "strength"), exact.engine.getStat(exact.id("r"), "speed"), exact.engine.getStat(exact.id("r"), "life")],
    [5, 3, 3]
  );
  const short = flipBoard(bank("deception", 2, P1));
  refused(() => flipUp(short, "r"), "one resource short");
  assert.equal(isFaceDown(short.engine, short.id("r")), true);
  assert.equal(ready(short.engine, P1), 3, "nothing paid");
  const noIcon = flipBoard(bank("rage", 3, P1));
  refused(() => flipUp(noIcon, "r"), "no [D] among the resources");
  assert.equal(isFaceDown(noIcon.engine, noIcon.id("r")), true);
  const vol = flipBoard(volition(3, P1));
  refused(() => flipUp(vol, "r"), "volition and its own face-down icon are not [D]");
  const ok = flipBoard([...bank("rage", 2, P1), ...bank("deception", 1, P1)]);
  flipUp(ok, "r");
  assert.equal(isFaceDown(ok.engine, ok.id("r")), false, "control: one [D] among the others is enough");
});

clause(REAPER, "1:flipUp", "a face-up card can't be flipped up", () => {
  const up = game([{ key: "r", def: printing(REAPER), owner: P1, zone: "play" }, ...bank("deception", 5, P1)]);
  refused(() => flipUp(up, "r"), "already face-up");
  assert.equal(ready(up.engine, P1), 5);
});

clause(REAPER, "1:flipUp", "a non-tactic can't be flipped up inside the opponent's response window", () => {
  const b = flipBoard(
    [...bank("deception", 5, P1), { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }],
    { turn: 2, active: P2 }
  );
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => flipUp(b, "r"), "a character can't be flipped up in the opponent's window");
  assert.equal(isFaceDown(b.engine, b.id("r")), true);
  assert.equal(ready(b.engine, P1), 6, "nothing paid");
});

// ============================================================================
// Cicibeo, The Implicator
// UNIQUE CICIBEO -- IMPLY -- COST: Deplete this card. Pick a character. -- EFFECT: That character's controller depletes that character or reveals the top
// card of their deck. If they reveal the top card of their deck and it's a character, take control of the picked character this turn.
// [D][D][D][D]: When another "cicibeo" card enters play, if it was deployed from your hand, you may pick a depleted character. If you do, destroy that character.
// Character, rogue, grifter/cicibeo/sarcophyle, cost 2, [D][D][D], 2 str / 3 spd / 3 life.
// ============================================================================
const CICI = "f0e7f09c-4354-4042-9454-0aea33e7d133";

const impBoard = (o: { top?: "character" | "item" | "tactic" | "location" | "none"; p1Top?: "character" | "item"; stolen?: boolean; extra?: Cards } = {}) => {
  const defs = { character: character({ name: "TopC" }), item: item({ name: "TopI" }), tactic: tactic({ name: "TopT" }), location: location({ name: "TopL" }) };
  const cards: Cards = [
    { key: "cb", def: printing(CICI), owner: P1, zone: "play" },
    o.stolen
      ? { key: "oc", def: character({ name: "OC" }), owner: P1, zone: "play", controller: P2 }
      : { key: "oc", def: character({ name: "OC" }), owner: P2, zone: "play" },
    ...(o.top === "none" ? [] : [{ key: "top", def: defs[o.top ?? "character"], owner: P2, zone: "deck" as const }]),
    { key: "under", def: character({ name: "Under" }), owner: P2, zone: "deck" },
    { key: "p1top", def: o.p1Top === "item" ? item({ name: "P1TopI" }) : character({ name: "P1TopC" }), owner: P1, zone: "deck" },
    { key: "p1under", def: character({ name: "P1Under" }), owner: P1, zone: "deck" },
    ...(o.extra ?? [])
  ];
  const b = game(cards);
  if (o.top !== "none") b.engine.state.players[P2].deck = [b.id("top"), b.id("under")] as never;
  b.engine.state.players[P1].deck = [b.id("p1top"), b.id("p1under")] as never;
  return b;
};
const imply = (b: ReturnType<typeof impBoard>, pick = "oc") => activate(b.engine, P1, b.id("cb"), "imply", { selected: { c: [b.id(pick)] } });

clause(CICI, "0:unique", "controlling a second Cicibeo makes you keep one (you choose); the other is destroyed", () => {
  const b = game([
    { key: "cb", def: printing(CICI), owner: P1, zone: "play" },
    { key: "cb2", def: printing(CICI), owner: P1, zone: "hand" },
    ...bank("deception", 3, P1)
  ]);
  play(b.engine, P1, b.id("cb2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("cb"), b.id("cb2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("cb2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("cb2")), "play");
  assert.equal(zoneOf(b.engine, b.id("cb")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  const keepOld = game([
    { key: "cb", def: printing(CICI), owner: P1, zone: "play" },
    { key: "cb2", def: printing(CICI), owner: P1, zone: "hand" },
    ...bank("deception", 3, P1)
  ]);
  play(keepOld.engine, P1, keepOld.id("cb2"));
  keepOld.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: keepOld.id("cb") } } as never);
  assert.equal(zoneOf(keepOld.engine, keepOld.id("cb")), "play");
  assert.equal(zoneOf(keepOld.engine, keepOld.id("cb2")), "discard");
});

clause(CICI, "0:unique", "(T3c9) the designation is CICIBEO: any other card with UNIQUE CICIBEO conflicts with Cicibeo, one with another designation does not", () => {
  const imposter = (unique: string) => character({ name: "Imposter", cost: 0, unique } as never);
  const b = game([{ key: "cb", def: printing(CICI), owner: P1, zone: "play" }, { key: "im", def: imposter("cicibeo"), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("im"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor", "a card with UNIQUE CICIBEO duplicates Cicibeo");
  assert.deepEqual([...pc.candidates].sort(), [b.id("cb"), b.id("im")].sort());
  const other = game([{ key: "cb", def: printing(CICI), owner: P1, zone: "play" }, { key: "im", def: imposter("something-else"), owner: P1, zone: "hand" }]);
  play(other.engine, P1, other.id("im"));
  assert.equal(other.engine.state.pendingChoice, undefined, "another designation does not conflict");
  assert.equal(zoneOf(other.engine, other.id("cb")), "play");
  assert.equal(zoneOf(other.engine, other.id("im")), "play");
});

clause(CICI, "0:unique", "the restriction is per player: the opponent may control their own Cicibeo", () => {
  const b = game(
    [
      { key: "cb", def: printing(CICI), owner: P1, zone: "play" },
      { key: "cb2", def: printing(CICI), owner: P2, zone: "hand" },
      ...bank("deception", 3, P2)
    ],
    { turn: 2, active: P2 }
  );
  play(b.engine, P2, b.id("cb2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("cb")), "play");
  assert.equal(zoneOf(b.engine, b.id("cb2")), "play");
});

clause(CICI, "0:unique", "printed card: character / rogue / grifter, cicibeo, sarcophyle, cost 2, threshold [D][D][D], 2 str / 3 spd / 3 life; deploy cost and threshold", () => {
  const d = printing(CICI);
  assert.deepEqual([d.type, d.trade, d.subtype, d.cost, d.threshold], ["character", "rogue", ["grifter", "cicibeo", "sarcophyle"], 2, "ddd"]);
  const hand = { key: "cb", def: printing(CICI), owner: P1, zone: "hand" as const };
  const ok = game([hand, ...bank("deception", 2, P1), ...spentD(P1, 1)]);
  play(ok.engine, P1, ok.id("cb"));
  assert.equal(zoneOf(ok.engine, ok.id("cb")), "play", "2 ready plus a spent [D] is enough");
  assert.equal(ready(ok.engine, P1), 0);
  assert.deepEqual(
    [ok.engine.getStat(ok.id("cb"), "strength"), ok.engine.getStat(ok.id("cb"), "speed"), ok.engine.getStat(ok.id("cb"), "life")],
    [2, 3, 3]
  );
  const short = game([hand, ...bank("deception", 1, P1), ...spentD(P1, 2)]);
  refused(() => play(short.engine, P1, short.id("cb")), "one resource short of the cost 2");
  assert.equal(zoneOf(short.engine, short.id("cb")), "hand");
  const noIcon = game([hand, ...bank("deception", 2, P1), ...bank("rage", 1, P1)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("cb")), "one [D] short of the threshold");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("cb")), "hand");
});

clause(CICI, "1:ability:imply", "COST: deplete this card; the controller of the picked character chooses, and choosing 'deplete' depletes it", () => {
  const b = impBoard();
  imply(b);
  assert.equal(isDepleted(b.engine, b.id("cb")), true, "cost: Cicibeo is depleted");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "the picked character's controller chooses");
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(b.engine, b.id("oc")), true, "the picked character is depleted");
  assert.equal(controllerOf(b.engine, b.id("oc")), P2, "control did not change");
  assert.deepEqual(deckOf(b.engine, P2), [b.id("top"), b.id("under")], "the deck is untouched");
});

clause(CICI, "1:ability:imply", "choosing to reveal with a character on top: you take control of the picked character this turn only", () => {
  const b = impBoard({ top: "character" });
  imply(b);
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(controllerOf(b.engine, b.id("oc")), P1, "taken");
  assert.equal(isDepleted(b.engine, b.id("oc")), false, "revealing doesn't deplete it");
  assert.equal(b.engine.state.cards[b.id("oc")].ownerId, P2);
  assert.equal(deckOf(b.engine, P2)[0], b.id("top"), "the card is only revealed, it stays on top");
  endTurn(b.engine, P1);
  assert.equal(controllerOf(b.engine, b.id("oc")), P2, "control returns at the end of the turn");
});

for (const kind of ["item", "tactic", "location", "none"] as const) {
  clause(CICI, "1:ability:imply", `choosing to reveal with ${kind === "none" ? "an empty deck" : `a${kind === "item" ? "n" : ""} ${kind}`} on top: no control change`, () => {
    const b = impBoard({ top: kind });
    if (kind === "none") b.engine.state.players[P2].deck = [] as never;
    imply(b);
    answerPending(b.engine, "chooserSelectsOption", { index: 1 });
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(controllerOf(b.engine, b.id("oc")), P2);
    assert.equal(isDepleted(b.engine, b.id("oc")), false);
  });
}

clause(CICI, "1:ability:imply", "only the TOP card counts: a character below a non-character top gives nothing", () => {
  const b = impBoard({ top: "item" });
  assert.equal(deckOf(b.engine, P2)[1], b.id("under"));
  imply(b);
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(controllerOf(b.engine, b.id("oc")), P2);
});

clause(CICI, "1:ability:imply", "the controller (not the owner) of the picked character chooses and reveals from THEIR deck", () => {
  const b = impBoard({ stolen: true, top: "character", p1Top: "item" });
  imply(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.playerId, P2, "P2 controls the picked character");
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(controllerOf(b.engine, b.id("oc")), P1, "P2's top card is a character, so Cicibeo's controller takes control");
  const other = impBoard({ stolen: true, top: "item", p1Top: "character" });
  imply(other);
  answerPending(other.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(controllerOf(other.engine, other.id("oc")), P2, "P2's top card is an item: no control change even though the owner's top is a character");
});

clause(CICI, "1:ability:imply", "(T3c9) revealing shows exactly the top card of the controller's deck (one card, to everyone), even when it is not a character", () => {
  for (const top of ["character", "item"] as const) {
    const b = impBoard({ top });
    imply(b);
    answerPending(b.engine, "chooserSelectsOption", { index: 1 });
    const reveals = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
    assert.equal(reveals.length, 1, `the top card (${top}) is revealed`);
    const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
    assert.deepEqual(ev.cardIds, [b.id("top")], "exactly the top card");
    assert.equal(ev.viewerId, "all", "to everyone");
  }
  const dep = impBoard({ top: "character" });
  imply(dep);
  answerPending(dep.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(dep.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").length, 0, "choosing 'deplete' reveals nothing");
});

clause(CICI, "1:ability:imply", "(T3c9) control lasts the whole turn: through a battle, and even after Cicibeo leaves play", () => {
  const kill = tactic({
    name: "Kill",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
  const b = impBoard({
    top: "character",
    extra: [
      { key: "atk", def: character({ name: "Atk" }), owner: P1, zone: "play" },
      { key: "kill", def: kill, owner: P1, zone: "hand" }
    ]
  });
  imply(b);
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(controllerOf(b.engine, b.id("oc")), P1, "taken");
  fightThrough(b.engine, P1, [b.id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  assert.equal(controllerOf(b.engine, b.id("oc")), P1, "still mine after the battle");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("cb")] } });
  assert.equal(zoneOf(b.engine, b.id("cb")), "discard", "Cicibeo left play");
  assert.equal(controllerOf(b.engine, b.id("oc")), P1, "control does not depend on Cicibeo staying in play");
  endTurn(b.engine, P1);
  assert.equal(controllerOf(b.engine, b.id("oc")), P2, "back at the end of the turn");
});

clause(CICI, "1:ability:imply", "may pick any character: your own (you choose), a depleted one, or Cicibeo itself; not a non-character", () => {
  const own = impBoard({ extra: [{ key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }] });
  imply(own, "mine");
  assert.equal(pending(own.engine)!.playerId, P1, "you choose for your own character");
  answerPending(own.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(isDepleted(own.engine, own.id("mine")), true);
  const dep = impBoard({ top: "character", extra: [] });
  dep.engine.state.cards[dep.id("oc")].depleted = true;
  imply(dep);
  answerPending(dep.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(controllerOf(dep.engine, dep.id("oc")), P1, "a depleted character can be picked and taken");
  const self = impBoard({ extra: [] });
  self.engine.perform({ type: "activateAbility", playerId: P1, cardId: self.id("cb"), abilityId: "imply", selected: { c: [self.id("cb")] }, variables: {} } as never);
  resolvePendingResponses(self.engine);
  assert.equal(pending(self.engine)!.kind, "chooserSelectsOption", "Cicibeo is a character and can be picked");
  assert.equal(pending(self.engine)!.playerId, P1);
  const bad = impBoard({ extra: [{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }] });
  refused(() => imply(bad, "it"), "an item is not a character");
  refused(() => activate(bad.engine, P1, bad.id("cb"), "imply", { selected: {} }), "no pick");
  assert.equal(isDepleted(bad.engine, bad.id("cb")), false, "nothing paid when refused");
});

clause(CICI, "1:ability:imply", "can't be used while Cicibeo is depleted, nor twice", () => {
  const b = impBoard();
  b.engine.state.cards[b.id("cb")].depleted = true;
  refused(() => imply(b), "the cost can't be paid while depleted");
  const c = impBoard();
  imply(c);
  answerPending(c.engine, "chooserSelectsOption", { index: 0 });
  refused(() => imply(c), "already depleted by the first use");
});

const OTHER_CICI = character({ name: "Other Cicibeo", subtype: ["cicibeo"], cost: 1 });
const ruleBoard = (o: { d?: number; rage?: number; cb?: "play" | "discard" | "hand"; extra?: Cards; turn?: number; active?: string; ocOwner?: string } = {}) =>
  game(
    [
      { key: "cb", def: printing(CICI), owner: P1, zone: o.cb ?? "play" },
      { key: "oc", def: OTHER_CICI, owner: (o.ocOwner ?? P1) as never, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", depleted: true },
      { key: "fresh", def: character({ name: "Fresh" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "ditem", def: item({ name: "DItem" }), owner: P2, zone: "play", depleted: true },
      ...bank("deception", o.d ?? 4, (o.ocOwner ?? P1) as never),
      ...bank("rage", o.rage ?? 0, (o.ocOwner ?? P1) as never),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, active: o.active }
  );

clause(CICI, "2:rule@dddd", "with [D][D][D][D], another cicibeo deployed from your hand lets you pick a depleted character and destroy it", () => {
  const b = ruleBoard();
  play(b.engine, P1, b.id("oc"));
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  for (const k of ["fresh", "mine", "ditem", "cb", "oc"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} untouched`);
});

clause(CICI, "2:rule@dddd", "the pick may be your own depleted character or Cicibeo itself; it must be a depleted character", () => {
  const own = ruleBoard();
  play(own.engine, P1, own.id("oc"));
  answerPending(own.engine, "chooserSelectsTarget", { selected: [own.id("mine")] });
  assert.equal(zoneOf(own.engine, own.id("mine")), "discard");
  const self = ruleBoard();
  self.engine.state.cards[self.id("cb")].depleted = true;
  play(self.engine, P1, self.id("oc"));
  answerPending(self.engine, "chooserSelectsTarget", { selected: [self.id("cb")] });
  assert.equal(zoneOf(self.engine, self.id("cb")), "discard");
  const b = ruleBoard();
  play(b.engine, P1, b.id("oc"));
  for (const k of ["fresh", "ditem", "oc"]) {
    refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(k)] }), `${k} is not a depleted character`);
  }
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "control: a depleted character works");
});

clause(CICI, "2:rule@dddd", "'you may': declining the pick destroys nothing", () => {
  const b = ruleBoard();
  play(b.engine, P1, b.id("oc"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["foe", "mine", "cb", "oc"]) assert.equal(zoneOf(b.engine, b.id(k)), "play");
});

clause(CICI, "2:rule@dddd", "needs [D][D][D][D]: three [D] plus other icons does nothing", () => {
  const b = ruleBoard({ d: 3, rage: 1 });
  play(b.engine, P1, b.id("oc"));
  assert.equal(zoneOf(b.engine, b.id("oc")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  const ok = ruleBoard({ d: 4 });
  play(ok.engine, P1, ok.id("oc"));
  assert.equal(pending(ok.engine)?.kind, "chooserSelectsTarget", "control: four [D]");
});

clause(CICI, "2:rule@dddd", "only another cicibeo card: a card without the subtype and Cicibeo itself do not trigger it", () => {
  const plain = ruleBoard({ extra: [{ key: "plain", def: character({ name: "Plain", subtype: ["grifter"], cost: 1 }), owner: P1, zone: "hand" }] });
  play(plain.engine, P1, plain.id("plain"));
  assert.equal(plain.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(plain.engine, plain.id("foe")), "play");
  const self = ruleBoard({ cb: "hand" });
  play(self.engine, P1, self.id("cb"));
  assert.equal(zoneOf(self.engine, self.id("cb")), "play");
  assert.equal(self.engine.state.pendingChoice, undefined, "Cicibeo entering itself is not 'another'");
  assert.equal(zoneOf(self.engine, self.id("foe")), "play");
});

clause(CICI, "2:rule@dddd", "a second copy of Cicibeo (same name) counts as another cicibeo card", () => {
  const b = ruleBoard({ extra: [{ key: "cb2", def: printing(CICI), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("cb2"));
  drain(b.engine, (pc) =>
    pc.kind === "uniqueSurvivor"
      ? { kind: "uniqueSurvivor", keep: b.id("cb") }
      : pc.kind === "chooserSelectsTarget"
        ? { kind: "chooserSelectsTarget", selected: [b.id("foe")] }
        : declineAll(pc)
  );
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "the rule fired for the second copy");
});

clause(CICI, "2:rule@dddd", "(T3c9) the opponent's cicibeo deployed from THEIR hand does nothing even when I have [D][D][D][D]", () => {
  const b = ruleBoard({ ocOwner: P2, turn: 2, active: P2, extra: bank("deception", 4, P1) });
  play(b.engine, P2, b.id("oc"));
  assert.equal(zoneOf(b.engine, b.id("oc")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick offered to me for their deployment");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(CICI, "2:rule@dddd", "(T3c9) you pick one depleted character, not two", () => {
  const b = ruleBoard();
  play(b.engine, P1, b.id("oc"));
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe"), b.id("mine")] }), "only one character may be picked");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "control: one pick works");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "the other depleted character is untouched");
});

clause(CICI, "2:rule@dddd", "only for your own hand: a cicibeo the opponent deploys does nothing", () => {
  const b = ruleBoard({ ocOwner: P2, turn: 2, active: P2 });
  play(b.engine, P2, b.id("oc"));
  assert.equal(zoneOf(b.engine, b.id("oc")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(CICI, "2:rule@dddd", "only when deployed from hand: a cicibeo put into play from the discard pile does nothing", () => {
  const revive = tactic({
    name: "Revive",
    behavior: {
      abilities: [
        {
          id: "rev",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = ruleBoard({
    extra: [
      { key: "rv", def: revive, owner: P1, zone: "hand" },
      { key: "dead", def: OTHER_CICI, owner: P1, zone: "discard" }
    ]
  });
  play(b.engine, P1, b.id("rv"), { selected: { t: [b.id("dead")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("dead")), "play", "it entered play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  const hand = ruleBoard();
  play(hand.engine, P1, hand.id("oc"));
  assert.equal(pending(hand.engine)?.kind, "chooserSelectsTarget", "control: from hand it triggers");
});

clause(CICI, "2:rule@dddd", "only while Cicibeo is in play", () => {
  const b = ruleBoard({ cb: "discard" });
  play(b.engine, P1, b.id("oc"));
  assert.equal(zoneOf(b.engine, b.id("oc")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

// ============================================================================
// Conniving Puppeteer
// BETRAY -- COST: Pick a non-tactic card in an opponent's discard pile. Destroy this card. -- EFFECT: Put the card into play under your control.
// Character, rogue, performer, cost 5, [D][D][D], 3 str / 3 spd / 3 life.
// ============================================================================
const PUPP = "540939e9-45c3-4f51-bc1c-2078048463e2";

const puppBoard = (extra: Cards = []) =>
  game([
    { key: "cp", def: printing(PUPP), owner: P1, zone: "play" },
    { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" },
    ...extra
  ]);
const betray = (b: ReturnType<typeof puppBoard>, pick: string) => activate(b.engine, P1, b.id("cp"), "betray", { selected: { c: [b.id(pick)] } });

clause(PUPP, "0:ability:betray", "printed card: character / rogue / performer, cost 5, threshold [D][D][D], 3 str / 3 spd / 3 life; deploy cost and threshold", () => {
  const d = printing(PUPP);
  assert.deepEqual([d.type, d.trade, d.subtype, d.cost, d.threshold], ["character", "rogue", ["performer"], 5, "ddd"]);
  const hand = { key: "cp", def: printing(PUPP), owner: P1, zone: "hand" as const };
  const ok = game([hand, ...bank("deception", 5, P1)]);
  play(ok.engine, P1, ok.id("cp"));
  assert.equal(zoneOf(ok.engine, ok.id("cp")), "play");
  assert.equal(ready(ok.engine, P1), 0);
  assert.deepEqual(
    [ok.engine.getStat(ok.id("cp"), "strength"), ok.engine.getStat(ok.id("cp"), "speed"), ok.engine.getStat(ok.id("cp"), "life")],
    [3, 3, 3]
  );
  const short = game([hand, ...bank("deception", 4, P1)]);
  refused(() => play(short.engine, P1, short.id("cp")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("cp")), "hand");
  const noIcon = game([hand, ...bank("deception", 2, P1), ...bank("rage", 3, P1)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("cp")), "one [D] short of the threshold");
  const icons = game([hand, ...bank("deception", 3, P1), ...bank("rage", 2, P1)]);
  play(icons.engine, P1, icons.id("cp"));
  assert.equal(zoneOf(icons.engine, icons.id("cp")), "play", "control: three [D] plus anything");
});

clause(PUPP, "0:ability:betray", "destroys itself as the cost, then puts the opponent's discarded character into play under your control", () => {
  const b = puppBoard();
  betray(b, "corpse");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("cp")), "discard", "this card is destroyed");
  assert.equal(zoneOf(b.engine, b.id("corpse")), "play");
  assert.equal(controllerOf(b.engine, b.id("corpse")), P1, "under your control");
  assert.equal(b.engine.state.cards[b.id("corpse")].ownerId, P2, "still owned by the opponent");
  assert.ok(!b.engine.state.players[P2].discard.includes(b.id("corpse") as never), "left the opponent's discard pile");
});

clause(PUPP, "0:ability:betray", "any non-tactic card qualifies: an item, a location and a resource card too", () => {
  for (const [name, def] of [
    ["item", item({ name: "DI" })],
    ["location", location({ name: "DL" })],
    ["resource", resourceCard({ name: "DC", resource: { provides: ["rage"], staple: true } })]
  ] as const) {
    const b = puppBoard([{ key: "pick", def, owner: P2, zone: "discard" }]);
    betray(b, "pick");
    assert.equal(zoneOf(b.engine, b.id("pick")), "play", `${name} enters play`);
    assert.equal(controllerOf(b.engine, b.id("pick")), P1, `${name} under your control`);
    assert.equal(zoneOf(b.engine, b.id("cp")), "discard");
  }
});

clause(PUPP, "0:ability:betray", "the pick must be a non-tactic card in an OPPONENT's discard pile", () => {
  const b = puppBoard([
    { key: "tac", def: tactic({ name: "DT" }), owner: P2, zone: "discard" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "discard" },
    { key: "inplay", def: character({ name: "InPlay" }), owner: P2, zone: "play" },
    { key: "inhand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "indeck", def: character({ name: "InDeck" }), owner: P2, zone: "deck" }
  ]);
  for (const k of ["tac", "mine", "inplay", "inhand", "indeck"]) {
    refused(() => betray(b, k), `${k} is not a legal pick`);
  }
  refused(() => activate(b.engine, P1, b.id("cp"), "betray", { selected: {} }), "no pick");
  assert.equal(zoneOf(b.engine, b.id("cp")), "play", "nothing was destroyed by the refusals");
  betray(b, "corpse");
  assert.equal(zoneOf(b.engine, b.id("corpse")), "play", "control: a legal pick works");
});

clause(PUPP, "0:ability:betray", "no other cost: usable while depleted and with no resources", () => {
  const b = puppBoard();
  b.engine.state.cards[b.id("cp")].depleted = true;
  assert.equal(ready(b.engine, P1), 0);
  betray(b, "corpse");
  assert.equal(controllerOf(b.engine, b.id("corpse")), P1);
});

// ============================================================================
// Crow With Fists
// You may include as many copies of this card in your deck as you want.
// Character, rogue, beast, cost 1, [D], 1 str / 3 spd / 1 life.
// ============================================================================
const CROW = "9c89be7e-b125-4008-ab4b-8b716f98d62f";

clause(CROW, "0:rule", "printed card: character / rogue / beast, cost 1, threshold [D], 1 str / 3 spd / 1 life; deploy cost and threshold", () => {
  const d = printing(CROW);
  assert.deepEqual([d.type, d.trade, d.subtype, d.cost, d.threshold], ["character", "rogue", ["beast"], 1, "d"]);
  const hand = { key: "cw", def: printing(CROW), owner: P1, zone: "hand" as const };
  const ok = game([hand, ...bank("deception", 2, P1)]);
  play(ok.engine, P1, ok.id("cw"));
  assert.equal(ready(ok.engine, P1), 1, "exactly 1 paid");
  assert.deepEqual(
    [ok.engine.getStat(ok.id("cw"), "strength"), ok.engine.getStat(ok.id("cw"), "speed"), ok.engine.getStat(ok.id("cw"), "life")],
    [1, 3, 1]
  );
  assert.deepEqual(ok.engine.getKeywords(ok.id("cw")), []);
  const none = game([hand]);
  refused(() => play(none.engine, P1, none.id("cw")), "no resource");
  assert.equal(zoneOf(none.engine, none.id("cw")), "hand");
  const spentOnly = game([hand, ...spentD(P1, 1)]);
  refused(() => play(spentOnly.engine, P1, spentOnly.id("cw")), "the [D] is spent: nothing left to pay");
  const noIcon = game([hand, ...bank("rage", 2, P1)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("cw")), "no [D] among the resources");
  const iso = game([hand, ...spentD(P1, 1), ...bank("rage", 1, P1)]);
  play(iso.engine, P1, iso.id("cw"));
  assert.equal(zoneOf(iso.engine, iso.id("cw")), "play", "control: a spent [D] meets the threshold, a ready rage pays");
});

clause(CROW, "0:rule", "no copy limit in play: several copies can be deployed and none is Unique or has abilities", () => {
  const b = game([
    { key: "c1", def: printing(CROW), owner: P1, zone: "hand" },
    { key: "c2", def: printing(CROW), owner: P1, zone: "hand" },
    { key: "c3", def: printing(CROW), owner: P1, zone: "hand" },
    { key: "c4", def: printing(CROW), owner: P1, zone: "hand" },
    ...bank("deception", 4, P1)
  ]);
  for (const k of ["c1", "c2", "c3", "c4"]) play(b.engine, P1, b.id(k));
  assert.equal(b.engine.state.pendingChoice, undefined, "no unique prompt");
  for (const k of ["c1", "c2", "c3", "c4"]) {
    assert.equal(zoneOf(b.engine, b.id(k)), "play");
    assert.deepEqual(b.engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === b.id(k)), [], "no abilities");
  }
  assert.equal(printing(CROW).unique, undefined);
});

// ============================================================================
// Cunning Ruse
// EXTRA COST: Pick an item. -- Flip the item face-down under its owner's control.
// Tactic, rogue, cost 2, [D][D][D].
// ============================================================================
const RUSE = "19fa3b83-2708-4d40-9928-0a02f46c7cb0";

const ruseBoard = (extra: Cards = [], res = 4) =>
  game([
    { key: "ruse", def: printing(RUSE), owner: P1, zone: "hand" },
    { key: "oi", def: item({ name: "OI" }), owner: P2, zone: "play" },
    ...bank("deception", res, P1),
    ...extra
  ]);

clause(RUSE, "0:extraCost", "printed card: tactic / rogue, cost 2, threshold [D][D][D]; cost and threshold are enforced", () => {
  const d = printing(RUSE);
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold], ["tactic", "rogue", 2, "ddd"]);
  const sel = (b: ReturnType<typeof ruseBoard>) => ({ selected: { it: [b.id("oi")] } });
  const exact = ruseBoard([...spentD(P1, 1)], 2);
  play(exact.engine, P1, exact.id("ruse"), sel(exact));
  assert.equal(zoneOf(exact.engine, exact.id("ruse")), "discard", "2 ready plus a spent [D] is enough");
  assert.equal(ready(exact.engine, P1), 0, "exactly 2 paid");
  const short = ruseBoard([...spentD(P1, 2)], 1);
  refused(() => play(short.engine, P1, short.id("ruse"), sel(short)), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("ruse")), "hand");
  assert.equal(isFaceDown(short.engine, short.id("oi")), false);
  const noIcon = ruseBoard([...bank("rage", 1, P1)], 2);
  refused(() => play(noIcon.engine, P1, noIcon.id("ruse"), sel(noIcon)), "one [D] short of the threshold");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("ruse")), "hand");
  const rage = ruseBoard([...bank("rage", 3, P1)], 0);
  refused(() => play(rage.engine, P1, rage.id("ruse"), sel(rage)), "no [D] at all");
});

clause(RUSE, "0:extraCost", "the extra cost is picking an item: any item in play qualifies, nothing else does", () => {
  const b = ruseBoard([
    { key: "ch", def: character({ name: "Ch" }), owner: P2, zone: "play" },
    { key: "lo", def: location({ name: "Lo" }), owner: P2, zone: "play" },
    { key: "idisc", def: item({ name: "IDisc" }), owner: P2, zone: "discard" },
    { key: "ihand", def: item({ name: "IHand" }), owner: P2, zone: "hand" },
    { key: "ifd", def: item({ name: "IFd" }), owner: P2, zone: "play", faceDown: true }
  ]);
  for (const k of ["ch", "lo", "idisc", "ihand", "ifd"]) {
    refused(() => play(b.engine, P1, b.id("ruse"), { selected: { it: [b.id(k)] } }), `${k} is not an item in play`);
  }
  refused(() => play(b.engine, P1, b.id("ruse")), "no item picked");
  assert.equal(zoneOf(b.engine, b.id("ruse")), "hand");
  assert.equal(ready(b.engine, P1), 4, "nothing paid by the refusals");
  play(b.engine, P1, b.id("ruse"), { selected: { it: [b.id("oi")] } });
  assert.equal(isFaceDown(b.engine, b.id("oi")), true, "control: an opponent's item works");
  const own = ruseBoard([{ key: "mi", def: item({ name: "Mine" }), owner: P1, zone: "play" }]);
  play(own.engine, P1, own.id("ruse"), { selected: { it: [own.id("mi")] } });
  assert.equal(isFaceDown(own.engine, own.id("mi")), true, "your own item works too");
});

clause(RUSE, "1:rule", "flips the item face-down; it stays in play (as a resource) and the tactic is spent", () => {
  const b = ruseBoard();
  play(b.engine, P1, b.id("ruse"), { selected: { it: [b.id("oi")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(isFaceDown(b.engine, b.id("oi")), true);
  assert.equal(zoneOf(b.engine, b.id("oi")), "play");
  assert.equal(zoneOf(b.engine, b.id("ruse")), "discard");
  assert.equal(ready(b.engine, P1), 2, "4 minus the 2 paid; it does not give you the resource");
});

clause(RUSE, "1:rule", "under its OWNER's control: the opponent's item stays theirs and becomes their resource", () => {
  const b = ruseBoard();
  const before = ready(b.engine, P2);
  play(b.engine, P1, b.id("ruse"), { selected: { it: [b.id("oi")] } });
  assert.equal(controllerOf(b.engine, b.id("oi")), P2);
  assert.equal(ready(b.engine, P2), before + 1, "a face-down card is a Volition resource for its owner");
});

clause(RUSE, "1:rule", "an item you stole is flipped face-down under its owner's (not your) control", () => {
  const b = ruseBoard([{ key: "stolen", def: item({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }]);
  const p1 = ready(b.engine, P1);
  const p2 = ready(b.engine, P2);
  play(b.engine, P1, b.id("ruse"), { selected: { it: [b.id("stolen")] } });
  assert.equal(isFaceDown(b.engine, b.id("stolen")), true);
  assert.equal(controllerOf(b.engine, b.id("stolen")), P2, "back under its owner's control");
  assert.equal(ready(b.engine, P2), p2 + 1, "it is the owner's resource");
  assert.equal(ready(b.engine, P1), p1 - 2, "and not yours: only the 2 paid for the tactic changed");
});

clause(RUSE, "1:rule", "your own item that the opponent controls goes back to you face-down", () => {
  const b = ruseBoard([{ key: "lent", def: item({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }]);
  play(b.engine, P1, b.id("ruse"), { selected: { it: [b.id("lent")] } });
  assert.equal(controllerOf(b.engine, b.id("lent")), P1);
  assert.equal(isFaceDown(b.engine, b.id("lent")), true);
});

// ============================================================================
// Efficacious Gunslinger
// When this card inflicts damage to a character, destroy that character.
// Character, rogue, vigilante, cost 1, [D][D], 1 str / 3 spd / 1 life.
// ============================================================================
const GUN = "357c2e36-8f77-4126-bcda-afc6ac1ef485";
const FACTION_P2 = { type: "faction", playerId: P2 } as const;

const gunBoard = (extra: Cards = [], o: { turn?: number; active?: string } = {}) =>
  game([{ key: "eg", def: printing(GUN), owner: P1, zone: "play" }, ...extra], { turn: o.turn ?? 2, active: o.active });

clause(GUN, "0:rule", "printed card: character / rogue / vigilante, cost 1, threshold [D][D], 1 str / 3 spd / 1 life; deploy cost and threshold", () => {
  const d = printing(GUN);
  assert.deepEqual([d.type, d.trade, d.subtype, d.cost, d.threshold], ["character", "rogue", ["vigilante"], 1, "dd"]);
  const hand = { key: "eg", def: printing(GUN), owner: P1, zone: "hand" as const };
  const ok = game([hand, ...bank("deception", 1, P1), ...spentD(P1, 1)]);
  play(ok.engine, P1, ok.id("eg"));
  assert.equal(zoneOf(ok.engine, ok.id("eg")), "play", "1 ready [D] plus a spent [D]");
  assert.equal(ready(ok.engine, P1), 0, "exactly 1 paid");
  assert.deepEqual(
    [ok.engine.getStat(ok.id("eg"), "strength"), ok.engine.getStat(ok.id("eg"), "speed"), ok.engine.getStat(ok.id("eg"), "life")],
    [1, 3, 1]
  );
  const short = game([hand, ...spentD(P1, 2)]);
  refused(() => play(short.engine, P1, short.id("eg")), "nothing ready to pay the cost");
  assert.equal(zoneOf(short.engine, short.id("eg")), "hand");
  const noIcon = game([hand, ...bank("deception", 1, P1), ...bank("rage", 1, P1)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("eg")), "one [D] short of the threshold");
  const noIcon2 = game([hand, ...bank("deception", 1, P1)]);
  refused(() => play(noIcon2.engine, P1, noIcon2.id("eg")), "a single [D]");
});

clause(GUN, "0:rule", "a character it damages in battle (as attacker) is destroyed even if the damage wouldn't kill it", () => {
  const b = gunBoard([{ key: "blk", def: character({ name: "Blk", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" }]);
  fightThrough(b.engine, P1, [b.id("eg")], FACTION_P2, [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("blk")), "discard", "1 damage to a 10-life blocker still destroys it");
  assert.equal(zoneOf(b.engine, b.id("eg")), "play", "the Gunslinger survives (0 strength blocker)");
});

clause(GUN, "0:rule", "also when it defends: the character it damages as a blocker is destroyed", () => {
  const b = gunBoard(
    [{ key: "atk", def: character({ name: "Atk", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" }],
    { active: P2 }
  );
  fightThrough(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("eg")]);
  assert.equal(zoneOf(b.engine, b.id("atk")), "discard");
  assert.equal(zoneOf(b.engine, b.id("eg")), "play");
});

clause(GUN, "0:rule", "damage dealt at the same speed still counts: both the Gunslinger and its victim are destroyed", () => {
  const b = gunBoard([{ key: "blk", def: character({ name: "Blk", strength: 5, life: 10, speed: 3 }), owner: P2, zone: "play" }]);
  fightThrough(b.engine, P1, [b.id("eg")], FACTION_P2, [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("blk")), "discard");
  assert.equal(zoneOf(b.engine, b.id("eg")), "discard");
});

clause(GUN, "0:rule", "if it dies before dealing damage (a faster blocker), it destroys nothing", () => {
  const b = gunBoard([{ key: "blk", def: character({ name: "Blk", strength: 5, life: 10, speed: 5 }), owner: P2, zone: "play" }]);
  fightThrough(b.engine, P1, [b.id("eg")], FACTION_P2, [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("eg")), "discard");
  assert.equal(zoneOf(b.engine, b.id("blk")), "play", "it never struck");
});

clause(GUN, "0:rule", "only the damaged character: with two blockers just one dies", () => {
  const b = gunBoard([
    { key: "b1", def: character({ name: "B1", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" },
    { key: "b2", def: character({ name: "B2", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" }
  ]);
  fightThrough(b.engine, P1, [b.id("eg")], FACTION_P2, [b.id("b1"), b.id("b2")]);
  const dead = ["b1", "b2"].filter((k) => zoneOf(b.engine, b.id(k)) === "discard");
  assert.equal(dead.length, 1, "1 damage goes to one blocker only");
});

clause(GUN, "0:rule", "only damage from this card: another attacker's damage doesn't destroy; damage to a faction or location destroys nothing", () => {
  const ally = { key: "ally", def: character({ name: "Ally", strength: 1, speed: 1 }), owner: P1, zone: "play" as const };
  const blk = { key: "blk", def: character({ name: "Blk", strength: 0, life: 10, speed: 1 }), owner: P2, zone: "play" as const };
  const b = gunBoard([ally, blk]);
  fightThrough(b.engine, P1, [b.id("ally")], FACTION_P2, [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("blk")), "play", "an ally's damage with the Gunslinger idle does nothing special");
  const f = gunBoard([{ key: "by", def: character({ name: "By" }), owner: P2, zone: "play" }]);
  fightThrough(f.engine, P1, [f.id("eg")], FACTION_P2, []);
  assert.equal(zoneOf(f.engine, f.id("by")), "play");
  assert.equal(zoneOf(f.engine, f.id("eg")), "play");
  assert.equal(zoneOf(f.engine, f.engine.state.players[P2].factionId as string), "play");
  const loc = gunBoard([{ key: "lo", def: location({ name: "Lo", structure: 10 }), owner: P2, zone: "play" }]);
  fightThrough(loc.engine, P1, [loc.id("eg")], { type: "card", cardId: loc.id("lo") }, []);
  assert.equal(zoneOf(loc.engine, loc.id("lo")), "play", "a location it damages is not a character");
});

// ============================================================================
// Expedition AutoBlind
// HUNKER DOWN -- COST: Pay 1. Deplete this card. Pick a character or tactic in a discard pile. -- EFFECT: Remove that card from the game. Draw a card, then put a card from your hand on the bottom of your deck.
// BUY TIME: [D][D][D] -- COST: Pay 1. -- EFFECT: Restore this card.
// FLIP UP: 1 [D]
// Item, rogue, cost 0, [D].
// ============================================================================
const AUTO = "82bd80a1-9222-42d4-89a8-9b8696a26c90";

const autoBoard = (o: { res?: number; extra?: Cards; hand?: number; deck?: number } = {}) =>
  game([
    { key: "ab", def: printing(AUTO), owner: P1, zone: "play" },
    { key: "gone", def: character({ name: "Gone" }), owner: P2, zone: "discard" },
    ...Array.from({ length: o.hand ?? 1 }, (_, i) => ({ key: `h${i}`, def: character({ name: `H${i}` }), owner: P1, zone: "hand" as const })),
    ...Array.from({ length: o.deck ?? 3 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" as const })),
    ...bank("deception", o.res ?? 3, P1),
    ...(o.extra ?? [])
  ]);
const hunker = (b: ReturnType<typeof autoBoard>, pick = "gone") => activate(b.engine, P1, b.id("ab"), "hunker-down", { selected: { c: [b.id(pick)] } });

clause(AUTO, "0:ability:hunker-down", "printed card: item / rogue, cost 0, threshold [D]; deploys for free with a [D], refused without one", () => {
  const d = printing(AUTO);
  assert.deepEqual([d.type, d.trade, d.cost, d.threshold], ["item", "rogue", 0, "d"]);
  const hand = { key: "ab", def: printing(AUTO), owner: P1, zone: "hand" as const };
  const ok = game([hand, ...bank("deception", 1, P1)]);
  play(ok.engine, P1, ok.id("ab"));
  assert.equal(zoneOf(ok.engine, ok.id("ab")), "play");
  assert.equal(ready(ok.engine, P1), 1, "cost 0 pays nothing");
  const spent = game([hand, ...spentD(P1, 1)]);
  play(spent.engine, P1, spent.id("ab"));
  assert.equal(zoneOf(spent.engine, spent.id("ab")), "play", "a spent [D] meets the threshold");
  const noIcon = game([hand, ...bank("rage", 3, P1)]);
  refused(() => play(noIcon.engine, P1, noIcon.id("ab")), "no [D]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("ab")), "hand");
});

clause(AUTO, "0:ability:hunker-down", "pays 1 and depletes itself; removes the picked card from the game, draws 1, then puts a hand card on the bottom of the deck", () => {
  const b = autoBoard();
  const deck = deckOf(b.engine, P1);
  const topCard = deck[0];
  hunker(b);
  assert.equal(isDepleted(b.engine, b.id("ab")), true, "cost: deplete this card");
  assert.equal(ready(b.engine, P1), 2, "cost: exactly 1 paid");
  assert.equal(zoneOf(b.engine, b.id("gone")), "removed", "removed from the game");
  assert.ok(handOf(b.engine, P1).includes(topCard), "drew the top card");
  assert.equal(handOf(b.engine, P1).length, 2);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("h0")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("h0")), "deck");
  const after = deckOf(b.engine, P1);
  assert.equal(after[after.length - 1], b.id("h0"), "on the bottom");
  assert.equal(after.length, deck.length, "net deck size unchanged");
  assert.deepEqual(handOf(b.engine, P1), [topCard], "the drawn card stays in hand");
});

clause(AUTO, "0:ability:hunker-down", "the drawn card is already in hand when you choose: it can be the one put back", () => {
  const b = autoBoard({ hand: 0 });
  const topCard = deckOf(b.engine, P1)[0];
  hunker(b);
  assert.deepEqual(handOf(b.engine, P1), [topCard]);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [topCard] });
  const after = deckOf(b.engine, P1);
  assert.equal(after[after.length - 1], topCard);
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(AUTO, "0:ability:hunker-down", "putting a card from your hand on the bottom is mandatory (not 'up to')", () => {
  const b = autoBoard();
  hunker(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [] }), "choosing nothing is not allowed while the hand has cards");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a card");
  assert.equal(handOf(b.engine, P1).length, 2);
});

clause(AUTO, "0:ability:hunker-down", "the card put back must come from your hand", () => {
  const b = autoBoard({ extra: [{ key: "oh", def: character({ name: "OH" }), owner: P2, zone: "hand" }] });
  hunker(b);
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("oh")] }), "the opponent's hand card");
  refused(() => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("d2")] }), "a deck card");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
});

clause(AUTO, "0:ability:hunker-down", "the pick: a character or tactic in ANY discard pile; nothing else", () => {
  const own = autoBoard({ extra: [{ key: "ownc", def: character({ name: "OwnC" }), owner: P1, zone: "discard" }] });
  hunker(own, "ownc");
  assert.equal(zoneOf(own.engine, own.id("ownc")), "removed", "your own discard pile works");
  const tac = autoBoard({ extra: [{ key: "gt", def: tactic({ name: "GT" }), owner: P2, zone: "discard" }] });
  hunker(tac, "gt");
  assert.equal(zoneOf(tac.engine, tac.id("gt")), "removed", "a tactic works");
  const b = autoBoard({
    extra: [
      { key: "di", def: item({ name: "DI" }), owner: P2, zone: "discard" },
      { key: "dl", def: location({ name: "DL" }), owner: P2, zone: "discard" },
      { key: "ip", def: character({ name: "IP" }), owner: P2, zone: "play" },
      { key: "ih", def: character({ name: "IH" }), owner: P2, zone: "hand" }
    ]
  });
  for (const k of ["di", "dl", "ip", "ih", "d0"]) refused(() => hunker(b, k), `${k} is not a legal pick`);
  refused(() => activate(b.engine, P1, b.id("ab"), "hunker-down", { selected: {} }), "no pick");
  assert.equal(isDepleted(b.engine, b.id("ab")), false);
  assert.equal(ready(b.engine, P1), 3, "nothing paid by the refusals");
});

clause(AUTO, "0:ability:hunker-down", "can't be used without a resource to pay or while this card is depleted", () => {
  const none = autoBoard({ res: 0 });
  refused(() => hunker(none), "pay 1 with no resources");
  assert.equal(zoneOf(none.engine, none.id("gone")), "discard");
  const dep = autoBoard();
  dep.engine.state.cards[dep.id("ab")].depleted = true;
  refused(() => hunker(dep), "already depleted");
  const one = autoBoard({ res: 1 });
  hunker(one);
  assert.equal(zoneOf(one.engine, one.id("gone")), "removed", "control: exactly 1 resource is enough");
});

clause(AUTO, "0:ability:hunker-down", "with an empty deck nothing is drawn but a hand card is still put on the bottom", () => {
  const b = autoBoard({ deck: 0 });
  hunker(b);
  assert.equal(zoneOf(b.engine, b.id("gone")), "removed");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("h0")] });
  assert.deepEqual(deckOf(b.engine, P1), [b.id("h0")]);
});

const buyBoard = (o: { d?: number; spent?: number; rage?: number; depleted?: boolean } = {}) =>
  game([
    { key: "ab", def: printing(AUTO), owner: P1, zone: "play", depleted: o.depleted ?? true },
    ...bank("deception", o.d ?? 3, P1),
    ...spentD(P1, o.spent ?? 0),
    ...bank("rage", o.rage ?? 0, P1)
  ]);
const buy = (b: ReturnType<typeof buyBoard>) => activate(b.engine, P1, b.id("ab"), "buy-time");

clause(AUTO, "1:ability:buy-time", "with [D][D][D], pays 1 and restores this card", () => {
  const b = buyBoard();
  buy(b);
  assert.equal(isDepleted(b.engine, b.id("ab")), false, "restored");
  assert.equal(ready(b.engine, P1), 2, "exactly 1 paid");
  assert.equal(zoneOf(b.engine, b.id("ab")), "play");
});

clause(AUTO, "1:ability:buy-time", "the cost is 1 (a spent [D] meets the threshold; with nothing ready it is refused) and needs three [D]", () => {
  const ok = buyBoard({ d: 1, spent: 2 });
  buy(ok);
  assert.equal(isDepleted(ok.engine, ok.id("ab")), false, "1 ready plus 2 spent [D]");
  const none = buyBoard({ d: 0, spent: 3 });
  refused(() => buy(none), "nothing left to pay");
  assert.equal(isDepleted(none.engine, none.id("ab")), true);
  const two = buyBoard({ d: 2, rage: 1 });
  refused(() => buy(two), "only two [D]");
  assert.equal(isDepleted(two.engine, two.id("ab")), true);
  assert.equal(ready(two.engine, P1), 3, "nothing paid");
});

clause(AUTO, "1:ability:buy-time", "usable while not depleted: it simply stays restored (and Hunker Down can be re-used after it)", () => {
  const b = buyBoard({ depleted: false });
  buy(b);
  assert.equal(isDepleted(b.engine, b.id("ab")), false);
  assert.equal(ready(b.engine, P1), 2, "the 1 is still paid");
  const c = game([
    { key: "ab", def: printing(AUTO), owner: P1, zone: "play" },
    { key: "g1", def: character({ name: "G1" }), owner: P2, zone: "discard" },
    { key: "g2", def: character({ name: "G2" }), owner: P2, zone: "discard" },
    { key: "h", def: character({ name: "H" }), owner: P1, zone: "hand" },
    { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
    { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
    ...bank("deception", 5, P1)
  ]);
  activate(c.engine, P1, c.id("ab"), "hunker-down", { selected: { c: [c.id("g1")] } });
  drain(c.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [c.id("h")] } : declineAll(pc)));
  assert.equal(isDepleted(c.engine, c.id("ab")), true);
  activate(c.engine, P1, c.id("ab"), "buy-time");
  assert.equal(isDepleted(c.engine, c.id("ab")), false);
  activate(c.engine, P1, c.id("ab"), "hunker-down", { selected: { c: [c.id("g2")] } });
  assert.equal(zoneOf(c.engine, c.id("g2")), "removed", "usable again after the restore");
});

const autoFlip = (cards: Cards, o: { turn?: number; active?: string } = {}) =>
  game([{ key: "ab", def: printing(AUTO), owner: P1, zone: "play", faceDown: true }, ...cards], o);

clause(AUTO, "2:flipUp", "FLIP UP costs 1 (this face-down card may pay it) and needs a [D] among the other resources", () => {
  const spent = autoFlip(spentD(P1, 1));
  assert.equal(ready(spent.engine, P1), 1, "only the face-down card is ready");
  flipUp(spent, "ab");
  assert.equal(isFaceDown(spent.engine, spent.id("ab")), false, "itself pays 1, the spent [D] meets the threshold");
  assert.equal(zoneOf(spent.engine, spent.id("ab")), "play");
  const ok = autoFlip(bank("deception", 2, P1));
  flipUp(ok, "ab");
  assert.equal(isFaceDown(ok.engine, ok.id("ab")), false);
  const noIcon = autoFlip(bank("rage", 2, P1));
  refused(() => flipUp(noIcon, "ab"), "no [D]: its own face-down card isn't one");
  assert.equal(isFaceDown(noIcon.engine, noIcon.id("ab")), true);
  assert.equal(ready(noIcon.engine, P1), 3, "nothing paid");
  const alone = autoFlip([]);
  refused(() => flipUp(alone, "ab"), "no [D] at all");
  const vol = autoFlip(volition(2, P1));
  refused(() => flipUp(vol, "ab"), "volition isn't [D]");
});

clause(AUTO, "2:flipUp", "(T3c9) FLIP UP really costs 1: with the card and the [D] spent nothing can pay it and it is refused; one ready Rage pays exactly 1", () => {
  const spendSelf = (b: ReturnType<typeof autoFlip>) => {
    b.engine.state.cards[b.id("ab")].attachedTo = b.engine.state.players[P1].factionId!;
  };
  const dry = autoFlip(spentD(P1, 1));
  spendSelf(dry);
  assert.equal(ready(dry.engine, P1), 0, "nothing is ready");
  refused(() => flipUp(dry, "ab"), "the cost 1 cannot be paid with nothing ready", /./);
  assert.equal(isFaceDown(dry.engine, dry.id("ab")), true, "still face-down");
  const one = autoFlip([...spentD(P1, 1), ...bank("rage", 1, P1)]);
  spendSelf(one);
  assert.equal(ready(one.engine, P1), 1);
  flipUp(one, "ab");
  assert.equal(isFaceDown(one.engine, one.id("ab")), false, "one ready resource pays the cost");
  assert.equal(ready(one.engine, P1), 0, "exactly 1 was paid");
});

clause(AUTO, "2:flipUp", "a face-up item can't be flipped up", () => {
  const up = game([{ key: "ab", def: printing(AUTO), owner: P1, zone: "play" }, ...bank("deception", 2, P1)]);
  refused(() => flipUp(up, "ab"), "already face-up");
  assert.equal(ready(up.engine, P1), 2);
});

clause(AUTO, "2:flipUp", "a non-tactic can't be flipped up inside the opponent's response window", () => {
  const b = autoFlip([...bank("deception", 2, P1), { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }], { turn: 2, active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => flipUp(b, "ab"), "an item can't be flipped up in the opponent's window");
  assert.equal(isFaceDown(b.engine, b.id("ab")), true);
  assert.equal(ready(b.engine, P1), 3);
});
