import assert from "node:assert/strict";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  play,
  activate,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdFlipUp } from "./_clause.js";
import { declareAttackOpenWindow, playRaw } from "./_battle.js";
import { fillers, pending } from "./_board.js";
import { endTurn } from "./_turn.js";

const IGN = "b22d2e91-49fe-44e7-8a1b-8034d0e9a324"; // Ignatious, Tactician Crafter
const VOID = "a0136d6a-a42b-4cb6-bc8c-c0eee4026f95"; // Interpret the Void
const LGA = "85d845d7-6c4f-4d53-90d1-d15a67e3598f"; // Little God of Answers
const LOCK = "2475968c-7bb5-43c1-8225-1bf9d8fdc059"; // Lockbox of the Aeons
const LOCK2 = "0049c804-79a6-4981-85fe-3137949e3970"; // Lockbox of the Aeons (2nd printing)
const QUIP = "a4f3c203-5e83-4af9-9bda-6d85d8413732"; // Quipster D'Genie
const QUAG = "e89bc47b-90e9-48c3-8da8-1ce22e2847e0"; // Quotidian Quagmire
const RITUAL = "f1f28210-b596-4182-a158-cfbb567e1700"; // Ritual of the Sucking Skull

type Engine = ReturnType<typeof buildGame>["engine"];
type Cards = CardPlacement[];

const ready = (e: Engine, p: string = P1) => e.getAvailableResourceCount(p as never);
const zoneOf = (e: Engine, id: string) => e.state.cards[id as never].zone as string;
const handOf = (e: Engine, p: string) => [...e.state.players[p as never].hand] as string[];
const deckOf = (e: Engine, p: string) => [...e.state.players[p as never].deck] as string[];
const sel = (selected: string[]) => ({ kind: "chooserSelectsTarget", selected });
/** Answers every chooserSelectsTarget with `ids` (declines everything else). */
const pick = (e: Engine, ids: string[]) => drain(e, (pc) => (pc.kind === "chooserSelectsTarget" ? sel(ids) : declineAll(pc)));
const answer = (e: Engine, choice: Record<string, unknown>) => {
  const pc = pending(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  resolvePendingResponses(e);
};
const factionKey = (owner: string) => (owner === P1 ? "__factionA" : "__factionB");
/** A resource already attached to (spent on) `owner`'s faction. */
const attached = (key: string, owner: string): CardPlacement => ({ ...bank("rage", 1, owner as never)[0], key, attachedToKey: factionKey(owner) });
const isAttached = (e: Engine, id: string, owner: string) => e.state.cards[id as never].attachedTo === e.state.players[owner as never].factionId;
const revealedIds = (e: Engine) =>
  e.getLog().filter((entry) => entry.event?.type === "cardsRevealed").flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);

/** A staple/non-staple resource card with an explicit icon and trade. */
const res = (key: string, icon: string, trade: string, owner: string = P1, staple = true): CardPlacement => ({
  key,
  def: resourceCard({ id: `p3-res-${key}`, name: `Res ${key}`, trade, resource: { provides: [icon], staple } } as never),
  owner: owner as never,
  zone: "play"
});

const drawTactic = (name = "Draw1", cost = 0) =>
  tactic({ name, cost, behavior: { abilities: [{ id: "b", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never);
const smash = (selector: Record<string, unknown>) =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
/** A free tactic that moves one picked card (from `zone`) to its owner's hand. */
const mover = (zone: string) =>
  tactic({
    name: `Mover ${zone}`,
    cost: 0,
    behavior: { abilities: [{ id: "m", type: "activated", targets: [{ id: "t", selector: { zone }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  } as never);

/* ====================================================================== */
/* Ignatious, Tactician Crafter                                           */
/* character · arcanist · ignatious / blade of questionable morality      */
/* cost 4 · [O][O][O][O] · 1 str / 3 spd / 5 life                         */
/* ====================================================================== */
const ignHand = (extra: Cards) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, cards: [{ key: "ign", def: printing(IGN), owner: P1, zone: "hand" }, ...extra] });

clause(IGN, "0:unique", "printed card: character, arcanist, cost 4, threshold oooo, 1 str / 3 spd / 5 life, subtypes ignatious + blade of questionable morality", () => {
  const d = printing(IGN);
  assert.equal(d.type, "character");
  assert.equal(d.trade, "arcanist");
  assert.equal(d.cost, 4);
  assert.equal(d.threshold, "oooo");
  assert.deepEqual([...(d.subtype ?? [])], ["ignatious", "blade of questionable morality"]);
  const { engine, id } = buildGame({ cards: [{ key: "ign", def: d, owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("ign"), "strength"), 1, "the aura is for UHLUHTC only");
  assert.equal(engine.getStat(id("ign"), "speed"), 3);
  assert.equal(engine.getStat(id("ign"), "life"), 5);
});

clause(IGN, "0:unique", "deploys for exactly 4 resources with 4 obsession icons; 3 resources, or 4 with one icon short, are refused", () => {
  const ok = ignHand([...bank("obsession", 6, P1)]);
  play(ok.engine, P1, ok.id("ign"));
  assert.equal(zoneOf(ok.engine, ok.id("ign")), "play");
  assert.equal(ready(ok.engine), 2, "exactly 4 of 6 paid");
  const short = ignHand([...bank("obsession", 3, P1), ...bank("obsession", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))]); // threshold oooo met by a spent [O]
  refused(() => play(short.engine, P1, short.id("ign")), "cost one short (3 ready, threshold met by a spent [O])", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("ign")), "hand");
  const icon = ignHand([...bank("obsession", 3, P1), ...bank("rage", 1, P1)]);
  refused(() => play(icon.engine, P1, icon.id("ign")), "one obsession icon short (cost is covered)");
  assert.equal(zoneOf(icon.engine, icon.id("ign")), "hand");
  const exact = ignHand([...bank("obsession", 4, P1)]);
  play(exact.engine, P1, exact.id("ign"));
  assert.equal(zoneOf(exact.engine, exact.id("ign")), "play", "control: 4 obsession exactly");
});

clause(IGN, "0:unique", "a second Ignatious makes you choose one to keep: the new one survives, or the old one", () => {
  for (const keep of ["ign2", "ign"] as const) {
    const b = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "ign", def: printing(IGN), owner: P1, zone: "play" },
        { key: "ign2", def: printing(IGN), owner: P1, zone: "hand" },
        ...bank("obsession", 4, P1)
      ]
    });
    play(b.engine, P1, b.id("ign2"));
    const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses");
    assert.deepEqual([...pc.candidates].sort(), [b.id("ign"), b.id("ign2")].sort());
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id(keep) } } as never);
    const other = keep === "ign" ? "ign2" : "ign";
    assert.equal(zoneOf(b.engine, b.id(keep)), "play");
    assert.equal(zoneOf(b.engine, b.id(other)), "discard", "the other copy is destroyed");
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(IGN, "0:unique", "the designation is IGNATIOUS: any other card carrying unique \"ignatious\" is a duplicate too", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "other", def: character({ name: "Not Ignatious", unique: "ignatious" } as never), owner: P1, zone: "play" },
      { key: "ign", def: printing(IGN), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  play(b.engine, P1, b.id("ign"));
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates].sort(), [b.id("other"), b.id("ign")].sort());
});

clause(IGN, "0:unique", "UNIQUE is per player (the opponent's own Ignatious is fine) and a different designation is not a duplicate", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ign", def: printing(IGN), owner: P1, zone: "play" },
      { key: "theirs", def: printing(IGN), owner: P2, zone: "play" },
      { key: "other", def: character({ name: "Other", unique: "someone else" } as never), owner: P1, zone: "play" },
      { key: "uhl", def: character({ name: "Uhl", unique: "uhluhtc" } as never), owner: P1, zone: "play" }
    ]
  });
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["ign", "theirs", "other", "uhl"]) assert.equal(zoneOf(b.engine, b.id(k)), "play");
});

// --- FEALTY ---
const distinct4 = (): Cards => [
  res("fo", "obsession", "arcanist"),
  res("fr", "rage", "rogue"),
  res("fg", "greed", "banker"),
  res("fd", "deception", "gearsmith")
];

clause(IGN, "1:fealty", "with 4 staple resources of 4 different trades, one obsession icon is enough for the oooo threshold (cost 4 still paid)", () => {
  const b = ignHand([...distinct4(), res("extra", "rage", "rogue")]);
  play(b.engine, P1, b.id("ign"));
  assert.equal(zoneOf(b.engine, b.id("ign")), "play");
  assert.equal(ready(b.engine), 1, "exactly the printed cost 4 is paid");
});

clause(IGN, "1:fealty", "the reduction is only 3 icons: 4 different trades but no obsession icon at all is still refused", () => {
  const b = ignHand([res("fr", "rage", "rogue"), res("fg", "greed", "banker"), res("fd", "deception", "gearsmith"), res("fe", "elitism", "warlord")]);
  refused(() => play(b.engine, P1, b.id("ign")), "0 obsession icons");
  assert.equal(zoneOf(b.engine, b.id("ign")), "hand");
  const ok = ignHand([res("fo", "obsession", "arcanist"), res("fg", "greed", "banker"), res("fd", "deception", "gearsmith"), res("fe", "elitism", "warlord")]);
  play(ok.engine, P1, ok.id("ign"));
  assert.equal(zoneOf(ok.engine, ok.id("ign")), "play", "control: one obsession icon");
});

clause(IGN, "1:fealty", "only 3 different trades among your staples gives no reduction", () => {
  const b = ignHand([res("fo", "obsession", "arcanist"), res("fr", "rage", "rogue"), res("fr2", "greed", "rogue"), res("fd", "deception", "banker")]);
  refused(() => play(b.engine, P1, b.id("ign")), "3 trades");
  assert.equal(zoneOf(b.engine, b.id("ign")), "hand");
  const ok = ignHand([res("fo", "obsession", "arcanist"), res("fr", "rage", "rogue"), res("fr2", "greed", "gearsmith"), res("fd", "deception", "banker")]);
  play(ok.engine, P1, ok.id("ign"));
  assert.equal(zoneOf(ok.engine, ok.id("ign")), "play", "control: the same board with a 4th trade");
});

clause(IGN, "1:fealty", "the resources must be staples: a non-staple resource does not count as a 4th trade", () => {
  const b = ignHand([res("fo", "obsession", "arcanist"), res("fr", "rage", "rogue"), res("fg", "greed", "banker"), res("fd", "deception", "gearsmith", P1, false)]);
  refused(() => play(b.engine, P1, b.id("ign")), "non-staple 4th trade");
  assert.equal(zoneOf(b.engine, b.id("ign")), "hand");
});

clause(IGN, "1:fealty", "only resources YOU control count: an opponent's staple of the 4th trade gives no reduction", () => {
  const b = ignHand([res("fo", "obsession", "arcanist"), res("fr", "rage", "rogue"), res("fr2", "greed", "rogue"), res("fd", "deception", "banker"), res("theirs", "deception", "gearsmith", P2)]);
  refused(() => play(b.engine, P1, b.id("ign")), "opponent's resource");
  assert.equal(zoneOf(b.engine, b.id("ign")), "hand");
});

// --- the UHLUHTC aura ---
const uhl = (name: string, extra: Record<string, unknown> = {}) => character({ name, strength: 2, life: 2, speed: 3, unique: "uhluhtc", ...extra } as never);

clause(IGN, "2:rule", "every UNIQUE UHLUHTC (yours and the opponent's) gains 3 strength and 3 life; others do not", () => {
  const b = buildGame({
    cards: [
      { key: "ign", def: printing(IGN), owner: P1, zone: "play" },
      { key: "mine", def: uhl("MyUhl"), owner: P1, zone: "play" },
      { key: "theirs", def: uhl("TheirUhl"), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "otherUnique", def: character({ name: "OtherU", strength: 2, life: 2, unique: "other" } as never), owner: P1, zone: "play" }
    ]
  });
  for (const k of ["mine", "theirs"]) {
    assert.equal(b.engine.getStat(b.id(k), "strength"), 5, `${k} strength`);
    assert.equal(b.engine.getStat(b.id(k), "life"), 5, `${k} life`);
    assert.equal(b.engine.getStat(b.id(k), "speed"), 3, `${k} speed untouched`);
  }
  for (const k of ["plain", "otherUnique"]) {
    assert.equal(b.engine.getStat(b.id(k), "strength"), 2);
    assert.equal(b.engine.getStat(b.id(k), "life"), 2);
  }
  assert.equal(b.engine.getStat(b.id("ign"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("ign"), "life"), 5);
});

clause(IGN, "2:rule", "the boost is off while Ignatious is in hand, on once it is in play, and gone again after it leaves", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ign", def: printing(IGN), owner: P1, zone: "hand" },
      { key: "mine", def: uhl("MyUhl"), owner: P1, zone: "play" },
      { key: "smash", def: smash({ zone: "play", type: "character", name: "Ignatious, Tactician Crafter" }), owner: P1, zone: "hand" },
      ...bank("obsession", 4, P1)
    ]
  });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "in hand: no boost");
  play(b.engine, P1, b.id("ign"));
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 5);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 5);
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("ign")] } });
  assert.equal(zoneOf(b.engine, b.id("ign")), "discard");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "gone after Ignatious leaves");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 2);
});

clause(IGN, "2:rule", "the +3 life really keeps a UHLUHTC alive: it dies once Ignatious leaves", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "ign", def: printing(IGN), owner: P1, zone: "play" },
      { key: "mine", def: uhl("MyUhl"), owner: P1, zone: "play", damage: 4 },
      { key: "smash", def: smash({ zone: "play", type: "character", name: "Ignatious, Tactician Crafter" }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "4 damage on 5 life");
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("ign")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "4 damage on 2 life");
});

// --- CIPHER ---
const t3 = () => drawTactic("Cheap Draw", 3);
function cipherBoard(extra: Cards = [], banks = 3) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ign", def: printing(IGN), owner: P1, zone: "play" },
      { key: "tac", def: t3(), owner: P1, zone: "discard" },
      ...fillers("dk", 3, P1, "deck"),
      ...bank("rage", banks, P1),
      ...extra
    ]
  });
}
const cipher = (b: ReturnType<typeof cipherBoard>, pickKey: string | null = "tac") =>
  activate(b.engine, P1, b.id("ign"), "cipher", { selected: pickKey ? { t: [b.id(pickKey)] } : {} });
/** Activates CIPHER WITHOUT draining the response window (the ability waits on the stack with its costs paid). */
const cipherRaw = (b: ReturnType<typeof cipherBoard>, pickKey: string | null = "tac") =>
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("ign"), abilityId: "cipher", selected: pickKey ? { t: [b.id(pickKey)] } : {}, variables: {} } as never);
const deployIt = (b: ReturnType<typeof cipherBoard>, key = "tac") => drain(b.engine, (pc) => (pc.kind === "deployForFree" ? { kind: "deployForFree", cardId: b.id(key) } : declineAll(pc)));

clause(IGN, "3:ability:cipher", "pays 2, depletes Ignatious, and deploys the picked discarded tactic for free: its effect happens", () => {
  const b = cipherBoard();
  const hand = handOf(b.engine, P1).length;
  cipher(b);
  assert.equal(pending(b.engine)?.kind, "deployForFree");
  deployIt(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("ign")].depleted, true, "COST: deplete");
  assert.equal(ready(b.engine), 1, "COST: pay 2 (the tactic's own cost 3 was not paid)");
  assert.equal(handOf(b.engine, P1).length, hand + 1, "the tactic resolved: drew a card");
});

clause(IGN, "3:ability:cipher", "the deployed tactic is removed from the game instead of going to its owner's discard pile", () => {
  const b = cipherBoard();
  cipher(b);
  deployIt(b);
  assert.equal(handOf(b.engine, P1).length, 1, "it resolved");
  assert.notEqual(zoneOf(b.engine, b.id("tac")), "discard", "must not go to the discard pile");
  assert.equal(zoneOf(b.engine, b.id("tac")), "removed");
});

clause(IGN, "3:ability:cipher", "\"you may deploy\": declining leaves the tactic in the discard pile, no effect, but the cost stays paid", () => {
  const b = cipherBoard();
  const hand = handOf(b.engine, P1).length;
  cipher(b);
  answer(b.engine, { kind: "deployForFree" });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tac")), "discard");
  assert.equal(handOf(b.engine, P1).length, hand);
  assert.equal(b.engine.state.cards[b.id("ign")].depleted, true);
  assert.equal(ready(b.engine), 1);
});

clause(IGN, "3:ability:cipher", "the pick must be a tactic in YOUR discard pile", () => {
  const b = cipherBoard([
    { key: "theirTac", def: drawTactic("TheirDraw"), owner: P2, zone: "discard" },
    { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "discard" },
    { key: "handTac", def: drawTactic("HandDraw"), owner: P1, zone: "hand" },
    { key: "deckTac", def: drawTactic("DeckDraw"), owner: P1, zone: "deck" }
  ]);
  for (const k of ["theirTac", "myChar", "handTac", "deckTac"]) {
    refused(() => cipherRaw(b, k), `pick ${k}`);
    assert.equal(b.engine.state.cards[b.id("ign")].depleted, false, `${k}: nothing paid`);
  }
  refused(() => cipherRaw(b, null), "no pick");
  assert.equal(ready(b.engine), 3);
  cipherRaw(b);
  assert.equal(b.engine.state.cards[b.id("ign")].depleted, true, "control: the right pick is accepted and the cost paid");
  assert.equal(ready(b.engine), 1, "pay 2");
});

clause(IGN, "3:ability:cipher", "costs: refused with only 1 resource, and while already depleted", () => {
  const short = cipherBoard([], 1);
  refused(() => cipherRaw(short), "pay 2 with 1");
  assert.equal(short.engine.state.cards[short.id("ign")].depleted, false);
  assert.equal(ready(short.engine), 1);
  const dep = cipherBoard();
  dep.engine.state.cards[dep.id("ign")].depleted = true;
  refused(() => cipherRaw(dep), "depleted");
  assert.equal(ready(dep.engine), 3, "nothing paid");
  const exact = cipherBoard([], 2);
  cipherRaw(exact);
  assert.equal(exact.engine.state.cards[exact.id("ign")].depleted, true, "control: exactly 2 resources");
  assert.equal(ready(exact.engine), 0);
});

// ============================================================================
// Interpret the Void — tactic · arcanist · cost 1 · [O][O] · FLIP UP 5 [O][O]
// ============================================================================
function voidBoard(o: { hand?: boolean; banks?: Cards; extra?: Cards; turn?: number; active?: string } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active as never,
    cards: [
      o.hand === false
        ? { key: "itv", def: printing(VOID), owner: P1, zone: "play", faceDown: true }
        : { key: "itv", def: printing(VOID), owner: P1, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      { key: "d1", def: item({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "d2", def: tactic({ name: "D2 Tac" }), owner: P1, zone: "deck" },
      { key: "d3", def: character({ name: "D3" }), owner: P1, zone: "deck" },
      { key: "d4", def: character({ name: "D4" }), owner: P1, zone: "deck" },
      { key: "od0", def: character({ name: "OD0" }), owner: P2, zone: "deck" },
      ...(o.banks ?? bank("obsession", 3, P1)),
      ...(o.extra ?? [])
    ]
  });
}
const flip = (b: ReturnType<typeof voidBoard>, key = "itv", player: string = P1) =>
  flipUpNow(b.engine, { type: "flipUp", playerId: player as never, cardId: b.id(key), selected: {}, variables: {} });

clause(VOID, "0:rule", "printed card: tactic, arcanist, cost 1, threshold oo (1 resource, or 2 with one icon short, is refused)", () => {
  const d = printing(VOID);
  assert.equal(d.type, "tactic");
  assert.equal(d.trade, "arcanist");
  assert.equal(d.cost, 1);
  assert.equal(d.threshold, "oo");
  const ok = voidBoard({ banks: bank("obsession", 3, P1) });
  play(ok.engine, P1, ok.id("itv"));
  pick(ok.engine, []);
  assert.equal(zoneOf(ok.engine, ok.id("itv")), "discard");
  assert.equal(ready(ok.engine), 2, "exactly 1 paid");
  const one = voidBoard({ banks: bank("obsession", 1, P1) });
  refused(() => play(one.engine, P1, one.id("itv")), "1 resource");
  assert.equal(zoneOf(one.engine, one.id("itv")), "hand");
  const icon = voidBoard({ banks: [...bank("obsession", 1, P1), ...bank("rage", 3, P1)] });
  refused(() => play(icon.engine, P1, icon.id("itv")), "one obsession icon short");
  assert.equal(zoneOf(icon.engine, icon.id("itv")), "hand");
  const two = voidBoard({ banks: bank("obsession", 2, P1) });
  play(two.engine, P1, two.id("itv"));
  pick(two.engine, []);
  assert.equal(zoneOf(two.engine, two.id("itv")), "discard", "control: 2 obsession");
});

clause(VOID, "0:rule", "searches your deck for up to 3 cards (any type) and puts them into the void; the rest stay", () => {
  const b = voidBoard();
  play(b.engine, P1, b.id("itv"));
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(b.engine)?.playerId, P1, "you search");
  pick(b.engine, [b.id("d0"), b.id("d1"), b.id("d2")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["d0", "d1", "d2"]) assert.equal(zoneOf(b.engine, b.id(k)), "void", k);
  for (const k of ["d3", "d4"]) assert.equal(zoneOf(b.engine, b.id(k)), "deck", k);
  assert.equal(zoneOf(b.engine, b.id("od0")), "deck", "the opponent's deck is not searched");
  assert.equal(deckOf(b.engine, P1).length, 2);
});

clause(VOID, "0:rule", "\"up to 3\": picking 2, 1 or 0 cards works; picking 4 is refused", () => {
  for (const n of [2, 1, 0]) {
    const b = voidBoard();
    play(b.engine, P1, b.id("itv"));
    const ids = ["d0", "d3", "d4"].slice(0, n).map((k) => b.id(k));
    pick(b.engine, ids);
    assert.equal(b.engine.state.pendingChoice, undefined, `n=${n}`);
    assert.equal(deckOf(b.engine, P1).length, 5 - n, `n=${n}: only the picked cards leave the deck`);
    for (const x of ids) assert.equal(zoneOf(b.engine, x), "void");
  }
  const over = voidBoard();
  play(over.engine, P1, over.id("itv"));
  refused(() => pick(over.engine, ["d0", "d1", "d2", "d3"].map((k) => over.id(k))), "4 cards");
  assert.equal(deckOf(over.engine, P1).length, 5, "nothing moved");
});

clause(VOID, "0:rule", "only your own deck can be searched: an opponent's deck card is refused", () => {
  const b = voidBoard();
  play(b.engine, P1, b.id("itv"));
  refused(() => pick(b.engine, [b.id("od0")]), "opponent's deck card");
  assert.equal(zoneOf(b.engine, b.id("od0")), "deck");
});

clause(VOID, "0:rule", "deployed from hand (not FLIP UP) you do NOT get to pick a tactic from the void", () => {
  const b = voidBoard({ extra: [{ key: "vt", def: tactic({ name: "VoidTac" }), owner: P1, zone: "void" }] });
  play(b.engine, P1, b.id("itv"));
  pick(b.engine, [b.id("d0")]);
  assert.equal(b.engine.state.pendingChoice, undefined, "no second pick offered");
  assert.equal(zoneOf(b.engine, b.id("vt")), "void");
  assert.equal(zoneOf(b.engine, b.id("d0")), "void");
});

const voidFlipBoard = (extra: Cards = []) =>
  voidBoard({
    hand: false,
    banks: bank("obsession", 6, P1),
    extra: [
      { key: "myVt", def: tactic({ name: "MyVoidTac" }), owner: P1, zone: "void" },
      { key: "theirVt", def: tactic({ name: "TheirVoidTac" }), owner: P2, zone: "void" },
      { key: "voidChar", def: character({ name: "VoidChar" }), owner: P1, zone: "void" },
      ...extra
    ]
  });

clause(VOID, "0:rule", "deployed with FLIP UP you may then pick a tactic in the void (searched or older, any owner) and it goes to its owner's hand", () => {
  const own = voidFlipBoard();
  flip(own);
  resolvePendingResponses(own.engine);
  pick(own.engine, [own.id("d2")]); // searched d2 (a tactic) into the void...
  assert.equal(own.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(own.engine, own.id("d2")), "hand", "...and the same tactic is then fetched");
  assert.equal(zoneOf(own.engine, own.id("myVt")), "void");

  const theirs = voidFlipBoard();
  flip(theirs);
  resolvePendingResponses(theirs.engine);
  let step = 0;
  drain(theirs.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? sel(step++ === 0 ? [theirs.id("d0")] : [theirs.id("theirVt")]) : declineAll(pc)));
  assert.equal(zoneOf(theirs.engine, theirs.id("theirVt")), "hand");
  assert.ok(handOf(theirs.engine, P2).includes(theirs.id("theirVt")), "into its OWNER's hand");
  assert.equal(handOf(theirs.engine, P1).includes(theirs.id("theirVt")), false);
  assert.equal(zoneOf(theirs.engine, theirs.id("d0")), "void");
});

clause(VOID, "0:rule", "after FLIP UP the tactic pick is a \"may\": declining moves nothing; a non-tactic or 2 cards are refused", () => {
  const dec = voidFlipBoard();
  flip(dec);
  resolvePendingResponses(dec.engine);
  let step = 0;
  drain(dec.engine, (pc) => {
    if (pc.kind !== "chooserSelectsTarget") return declineAll(pc);
    assert.equal(pc.playerId, P1, `pick #${step}: you choose`);
    step++;
    return sel([]);
  });
  assert.equal(step, 2, "the search and the tactic pick were both offered");
  assert.equal(dec.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(dec.engine, dec.id("myVt")), "void");
  assert.equal(zoneOf(dec.engine, dec.id("theirVt")), "void");

  const bad = voidFlipBoard();
  flip(bad);
  resolvePendingResponses(bad.engine);
  answer(bad.engine, sel([]));
  assert.equal(pending(bad.engine)?.kind, "chooserSelectsTarget", "the tactic pick is open");
  refused(() => answer(bad.engine, sel([bad.id("voidChar")])), "non-tactic in the void");
  refused(() => answer(bad.engine, sel([bad.id("myVt"), bad.id("theirVt")])), "two tactics");
  assert.equal(zoneOf(bad.engine, bad.id("voidChar")), "void");
  answer(bad.engine, sel([bad.id("myVt")]));
  assert.equal(zoneOf(bad.engine, bad.id("myVt")), "hand", "control: one tactic");
});

clause(VOID, "1:flipUp", "FLIP UP costs 5 with [O][O]: 5 obsession resources pay it; the card is deployed as a tactic and ends in the discard pile", () => {
  const b = voidBoard({ hand: false, banks: bank("obsession", 5, P1) });
  flip(b);
  resolvePendingResponses(b.engine);
  pick(b.engine, [b.id("d0")]);
  assert.equal(zoneOf(b.engine, b.id("itv")), "discard");
  assert.equal(zoneOf(b.engine, b.id("d0")), "void", "the search happened");
  assert.equal(ready(b.engine), 0, "all 5 banks paid");
});

clause(VOID, "1:flipUp", "FLIP UP is refused with 3 banks (cost short under any reading) and with 5 banks but one obsession icon short", () => {
  const short = voidBoard({ hand: false, banks: bank("obsession", 3, P1) });
  refused(() => flip(short), "3 banks");
  assert.equal(short.engine.state.cards[short.id("itv")].faceDown, true);
  assert.equal(ready(short.engine), 4, "nothing paid (3 banks + the face-down card)");
  const icon = voidBoard({ hand: false, banks: [...bank("obsession", 1, P1), ...bank("rage", 5, P1)] });
  refused(() => flip(icon), "threshold oo with a single obsession icon");
  assert.equal(icon.engine.state.cards[icon.id("itv")].faceDown, true);
  const ok = voidBoard({ hand: false, banks: [...bank("obsession", 2, P1), ...bank("rage", 3, P1)] });
  flip(ok);
  resolvePendingResponses(ok.engine);
  pick(ok.engine, []);
  assert.equal(zoneOf(ok.engine, ok.id("itv")), "discard", "control: oo + 3 other");
});

// CR 507.4b (RULES.md FLIP UP): the FLIP UP cost is paid before flipping, so the card may pay for itself.
clause(VOID, "1:flipUp", "the face-down card may help pay its own FLIP UP cost: 4 banks + itself pays the 5", () => {
  const b = voidBoard({ hand: false, banks: bank("obsession", 4, P1) });
  flip(b);
  resolvePendingResponses(b.engine);
  pick(b.engine, []);
  assert.equal(zoneOf(b.engine, b.id("itv")), "discard", "flipped up and resolved with itself as one of the 5 payers");
});

clause(VOID, "1:flipUp", "being a tactic, it may be flipped up inside the opponent's response window", () => {
  const b = voidBoard({ hand: false, banks: bank("obsession", 6, P1), turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  flip(b);
  resolvePendingResponses(b.engine);
  pick(b.engine, [b.id("d0")]);
  assert.equal(zoneOf(b.engine, b.id("itv")), "discard");
  assert.equal(zoneOf(b.engine, b.id("d0")), "void");
});

// ============================================================================
// Little God of Answers — character · arcanist · god · cost 4 · [O]x5 · 0 str / 3 spd / 5 life
// ============================================================================
function lgaBoard(o: { depleted?: boolean; banks?: number; turn?: number; active?: string; extra?: Cards; owner?: string } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active as never,
    cards: [
      { key: "lga", def: printing(LGA), owner: (o.owner ?? P1) as never, zone: "play", depleted: o.depleted ?? true },
      { key: "tac1", def: tactic({ name: "Tac1" }), owner: P1, zone: "deck" },
      { key: "tac2", def: tactic({ name: "Tac2" }), owner: P1, zone: "deck" },
      { key: "ch", def: character({ name: "Ch" }), owner: P1, zone: "deck" },
      { key: "otac", def: tactic({ name: "OTac" }), owner: P2, zone: "deck" },
      ...bank("rage", o.banks ?? 3, P1),
      ...bank("rage", 3, P2),
      ...(o.extra ?? [])
    ]
  });
}
const lgaAnswer = (b: ReturnType<typeof lgaBoard>, o: { pay?: boolean; pickKey?: string | null } = {}) =>
  drain(b.engine, (pc) => {
    if (pc.kind === "mayPay") return { kind: "mayPay", pay: o.pay ?? true };
    if (pc.kind === "chooserSelectsTarget") return sel(o.pickKey ? [b.id(o.pickKey)] : []);
    return declineAll(pc);
  });

clause(LGA, "0:rule", "printed card: character, arcanist, god, cost 4, threshold ooooo, 0 str / 3 spd / 5 life; deploys for 4 with five obsession icons", () => {
  const d = printing(LGA);
  assert.equal(d.type, "character");
  assert.equal(d.trade, "arcanist");
  assert.equal(d.cost, 4);
  assert.equal(d.threshold, "ooooo");
  assert.deepEqual([...(d.subtype ?? [])], ["god"]);
  const { engine, id } = buildGame({ cards: [{ key: "l", def: d, owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("l"), "strength"), 0);
  assert.equal(engine.getStat(id("l"), "speed"), 3);
  assert.equal(engine.getStat(id("l"), "life"), 5);
  const hand = (banks: Cards) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "l", def: d, owner: P1, zone: "hand" }, ...banks] });
  const ok = hand(bank("obsession", 6, P1));
  play(ok.engine, P1, ok.id("l"));
  assert.equal(zoneOf(ok.engine, ok.id("l")), "play");
  assert.equal(ready(ok.engine), 2, "exactly 4 paid");
  const icon = hand([...bank("obsession", 4, P1), ...bank("rage", 1, P1)]);
  refused(() => play(icon.engine, P1, icon.id("l")), "one obsession icon short");
  const cost = hand([...bank("obsession", 3, P1), ...bank("obsession", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))]);
  refused(() => play(cost.engine, P1, cost.id("l")), "cost short (3 ready, threshold met by a spent [O])", /Costs cannot be paid/);
  const exact = hand(bank("obsession", 5, P1));
  play(exact.engine, P1, exact.id("l"));
  assert.equal(zoneOf(exact.engine, exact.id("l")), "play", "control: five obsession");
});

clause(LGA, "0:rule", "at the end of your turn, depleted, you may pay 1: the searched tactic is revealed and goes to your hand", () => {
  const b = lgaBoard();
  const before = ready(b.engine);
  endTurn(b.engine, P1);
  assert.equal(pending(b.engine)?.kind, "mayPay");
  assert.equal(pending(b.engine)?.playerId, P1);
  lgaAnswer(b, { pickKey: "tac2" });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tac2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("tac1")), "deck", "only one tactic");
  assert.equal(before - ready(b.engine), 1, "exactly 1 paid");
  assert.deepEqual(revealedIds(b.engine), [b.id("tac2")], "the found tactic is revealed");
});

clause(LGA, "0:rule", "you may decline to pay: nothing is paid and nothing is searched", () => {
  const b = lgaBoard();
  const before = ready(b.engine);
  endTurn(b.engine, P1);
  assert.equal(pending(b.engine)?.kind, "mayPay");
  lgaAnswer(b, { pay: false });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), before);
  assert.equal(zoneOf(b.engine, b.id("tac1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("tac2")), "deck");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(LGA, "0:rule", "only a TACTIC can be found: a character, or an opponent's tactic, is refused", () => {
  const b = lgaBoard();
  endTurn(b.engine, P1);
  answer(b.engine, { kind: "mayPay", pay: true });
  refused(() => answer(b.engine, sel([b.id("ch")])), "character");
  refused(() => answer(b.engine, sel([b.id("otac")])), "opponent's tactic");
  assert.equal(zoneOf(b.engine, b.id("ch")), "deck");
  answer(b.engine, sel([b.id("tac1")]));
  assert.equal(zoneOf(b.engine, b.id("tac1")), "hand", "control");
});

clause(LGA, "0:rule", "the search may come up empty: paying but choosing no tactic leaves the deck intact", () => {
  const b = lgaBoard();
  endTurn(b.engine, P1);
  lgaAnswer(b, { pay: true, pickKey: null });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tac1")), "deck");
  assert.equal(zoneOf(b.engine, b.id("tac2")), "deck");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(LGA, "0:rule", "if this card is not depleted at the end of the turn nothing happens", () => {
  const b = lgaBoard({ depleted: false });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tac1")), "deck");
});

clause(LGA, "0:rule", "you must be able to pay 1: with no resources there is nothing to pay and no tactic is found", () => {
  const b = lgaBoard({ banks: 0 });
  endTurn(b.engine, P1);
  lgaAnswer(b, { pay: true, pickKey: "tac1" });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("tac1")), "deck");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(LGA, "0:rule", "it is the end of YOUR turn: the opponent's turn ending does not trigger it, and the opponent's own copy does not trigger on yours", () => {
  const mine = lgaBoard({ turn: 2, active: P2 });
  endTurn(mine.engine, P2);
  assert.equal(mine.engine.state.pendingChoice, undefined, "my Little God on the opponent's turn end");
  assert.equal(zoneOf(mine.engine, mine.id("tac1")), "deck");
  const theirs = lgaBoard({ owner: P2, extra: [{ key: "x", def: character({ name: "X" }), owner: P2, zone: "deck" }] });
  endTurn(theirs.engine, P1);
  assert.equal(theirs.engine.state.pendingChoice, undefined, "their Little God on my turn end");
  assert.equal(zoneOf(theirs.engine, theirs.id("otac")), "deck");
});

// ============================================================================
// Lockbox of the Aeons — item · arcanist · cost 2 · [O]
// ============================================================================
const lockBoard = (id: string, o: { owner?: string; extra?: Cards; lockbox?: boolean } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...(o.lockbox === false ? [] : [{ key: "lb", def: printing(id), owner: (o.owner ?? P1) as never, zone: "play" as const }]),
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
      { key: "theirsDis", def: character({ name: "TheirsDis" }), owner: P2, zone: "discard" },
      { key: "theirsVoid", def: character({ name: "TheirsVoid" }), owner: P2, zone: "void" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "mineDis", def: character({ name: "MineDis" }), owner: P1, zone: "discard" },
      { key: "mineVoid", def: character({ name: "MineVoid" }), owner: P1, zone: "void" },
      { key: "mvPlay", def: mover("play"), owner: P1, zone: "hand" },
      { key: "mvDis", def: mover("discard"), owner: P1, zone: "hand" },
      { key: "mvVoid", def: mover("void"), owner: P1, zone: "hand" },
      { key: "mvDeck", def: mover("deck"), owner: P1, zone: "hand" },
      { key: "theirDeck", def: character({ name: "TheirDeck" }), owner: P2, zone: "deck" },
      ...(o.extra ?? [])
    ]
  });
const useMover = (b: ReturnType<typeof lockBoard>, mv: string, target: string) => play(b.engine, P1, b.id(mv), { selected: { t: [b.id(target)] } });

function lockPrinted(pid: string) {
  const d = printing(pid);
  assert.equal(d.type, "item");
  assert.equal(d.trade, "arcanist");
  assert.equal(d.cost, 2);
  assert.equal(d.threshold, "o");
  const hand = (banks: Cards) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "lb", def: d, owner: P1, zone: "hand" }, ...banks] });
  const ok = hand(bank("obsession", 3, P1));
  play(ok.engine, P1, ok.id("lb"));
  assert.equal(zoneOf(ok.engine, ok.id("lb")), "play");
  assert.equal(ready(ok.engine), 1, "exactly 2 paid");
  const one = hand([...bank("obsession", 1, P1), ...bank("obsession", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))]);
  refused(() => play(one.engine, P1, one.id("lb")), "cost short (1 ready, threshold met by spent [O])", /Costs cannot be paid/);
  assert.equal(zoneOf(one.engine, one.id("lb")), "hand");
  const icon = hand(bank("rage", 3, P1));
  refused(() => play(icon.engine, P1, icon.id("lb")), "no obsession icon");
  const exact = hand([...bank("obsession", 1, P1), ...bank("rage", 1, P1)]);
  play(exact.engine, P1, exact.id("lb"));
  assert.equal(zoneOf(exact.engine, exact.id("lb")), "play", "control: one icon is enough");
}
clause(LOCK, "0:rule", "printed card: item, arcanist, cost 2, threshold o", () => lockPrinted(LOCK));
clause(LOCK2, "0:rule", "printed card: item, arcanist, cost 2, threshold o", () => lockPrinted(LOCK2));

function lockReturns(pid: string) {
  const cases: Array<[string, string, string]> = [
    ["mvPlay", "theirs", "play"],
    ["mvDis", "theirsDis", "discard"],
    ["mvVoid", "theirsVoid", "void"]
  ];
  for (const [mv, target, zone] of cases) {
    const locked = lockBoard(pid);
    useMover(locked, mv, target);
    assert.equal(zoneOf(locked.engine, locked.id(target)), zone, `${zone}: the opponent's card cannot be returned to hand`);
    assert.equal(handOf(locked.engine, P2).includes(locked.id(target)), false);
    const free = lockBoard(pid, { lockbox: false });
    useMover(free, mv, target);
    assert.equal(zoneOf(free.engine, free.id(target)), "hand", `${zone} control: without the Lockbox it returns`);
  }
}
clause(LOCK, "0:rule", "your opponents' cards cannot be returned to their hands from play, the discard pile or the void", () => lockReturns(LOCK));
clause(LOCK2, "0:rule", "your opponents' cards cannot be returned to their hands from play, the discard pile or the void", () => lockReturns(LOCK2));

function lockOwn(pid: string) {
  for (const [mv, target, zone] of [["mvPlay", "mine", "play"], ["mvDis", "mineDis", "discard"], ["mvVoid", "mineVoid", "void"]] as const) {
    const b = lockBoard(pid);
    useMover(b, mv, target);
    assert.equal(zoneOf(b.engine, b.id(target)), "hand", `your own card from ${zone} still returns`);
  }
}
clause(LOCK, "0:rule", "your own cards can still be returned to your hand", () => lockOwn(LOCK));
clause(LOCK2, "0:rule", "your own cards can still be returned to your hand", () => lockOwn(LOCK2));

function lockOther(pid: string) {
  // the opponent may still draw and search (those are not "returning")
  const b = lockBoard(pid, { extra: [{ key: "theirDraw", def: drawTactic("TheirDraw"), owner: P2, zone: "hand" }, { key: "dd", def: character({ name: "DD" }), owner: P2, zone: "deck" }] });
  b.engine.state.activePlayerId = P2 as never;
  play(b.engine, P2, b.id("theirDraw"));
  assert.ok(handOf(b.engine, P2).includes(b.id("dd")) || handOf(b.engine, P2).includes(b.id("theirDeck")), "the opponent can still draw");
  // owner vs controller: a card OWNED by the opponent but controlled by me goes to THEIR hand => blocked
  const stolen = lockBoard(pid, { extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  useMover(stolen, "mvPlay", "stolen");
  assert.equal(zoneOf(stolen.engine, stolen.id("stolen")), "play", "owned by an opponent: it would go to their hand");
  // a card OWNED by me but controlled by the opponent returns to MY hand => allowed
  const mine = lockBoard(pid, { extra: [{ key: "lent", def: character({ name: "Lent" }), owner: P1, zone: "play", controller: P2 }] });
  useMover(mine, "mvPlay", "lent");
  assert.equal(zoneOf(mine.engine, mine.id("lent")), "hand");
  assert.ok(handOf(mine.engine, P1).includes(mine.id("lent")), "handOf(mine.engine, P1).includes(mine.id(\"lent\"))");
}
clause(LOCK, "0:rule", "drawing is not 'returning'; blocking follows the owner's hand (owner vs controller)", () => lockOther(LOCK));
clause(LOCK2, "0:rule", "drawing is not 'returning'; blocking follows the owner's hand (owner vs controller)", () => lockOther(LOCK2));


function lockDeck(pid: string) {
  // deck -> hand (a tutor) is not "returned to hand": the opponent's still works
  const b = lockBoard(pid);
  useMover(b, "mvDeck", "theirDeck");
  assert.equal(zoneOf(b.engine, b.id("theirDeck")), "hand", "from the deck it is not a return");
  assert.ok(handOf(b.engine, P2).includes(b.id("theirDeck")), "handOf(b.engine, P2).includes(b.id(\"theirDeck\"))");
}
clause(LOCK, "0:rule", "only returns are stopped: the opponent putting a card from their deck into their hand is unaffected", () => lockDeck(LOCK));
clause(LOCK2, "0:rule", "only returns are stopped: the opponent putting a card from their deck into their hand is unaffected", () => lockDeck(LOCK2));

function lockFlip(pid: string) {
  const ft = () => tactic({ name: "FT", cost: 3, flipUp: { cost: 1, threshold: "r" } as never, behavior: { abilities: [{ id: "b", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never);
  const mk = (o: { lockbox?: boolean; owner?: string; flipper: string }) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        ...(o.lockbox === false ? [] : [{ key: "lb", def: printing(pid), owner: (o.owner ?? P1) as never, zone: "play" as const }]),
        { key: "ft", def: ft(), owner: o.flipper as never, zone: "play", faceDown: true },
        ...bank("rage", 3, o.flipper as never),
        { key: "dk", def: character({ name: "Dk" }), owner: o.flipper as never, zone: "deck" }
      ]
    });
  const flipIt = (b: ReturnType<typeof mk>, p: string) => flipUpNow(b.engine, { type: "flipUp", playerId: p as never, cardId: b.id("ft"), selected: {}, variables: {} });
  const blocked = mk({ flipper: P2 });
  refused(() => flipIt(blocked, P2), "opponent's FLIP UP under my Lockbox", /cannot play cards using FLIP UP right now/);
  assert.equal(blocked.engine.state.cards[blocked.id("ft")].faceDown, true);
  assert.equal(ready(blocked.engine, P2), 4, "nothing paid");
  const free = mk({ flipper: P2, lockbox: false });
  flipIt(free, P2);
  assert.equal(zoneOf(free.engine, free.id("ft")), "discard", "control: without the Lockbox the flip works");
  // the Lockbox's own controller is not an opponent of itself
  const mine = mk({ flipper: P2, owner: P2 });
  flipIt(mine, P2);
  assert.equal(zoneOf(mine.engine, mine.id("ft")), "discard", "my own FLIP UP is unaffected by my own Lockbox");
}
clause(LOCK, "0:rule", "your opponents cannot use FLIP UP; you (and anyone without your Lockbox in play) can", () => lockFlip(LOCK));
clause(LOCK2, "0:rule", "your opponents cannot use FLIP UP; you (and anyone without your Lockbox in play) can", () => lockFlip(LOCK2));

function lockGone(pid: string) {
  const b = lockBoard(pid, { extra: [{ key: "smash", def: smash({ zone: "play", type: "item" }), owner: P1, zone: "hand" }] });
  useMover(b, "mvPlay", "theirs");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play", "on");
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("lb")] } });
  assert.equal(zoneOf(b.engine, b.id("lb")), "discard");
  b.engine.state.cards[b.id("mvDis")].zone = "hand";
  play(b.engine, P1, b.id("mvDis"), { selected: { t: [b.id("theirsDis")] } });
  assert.equal(zoneOf(b.engine, b.id("theirsDis")), "hand", "off after the Lockbox leaves play");
  // as long as YOU control it: the opponent's Lockbox restricts me, not them
  const theirLock = lockBoard(pid, { owner: P2 });
  useMover(theirLock, "mvPlay", "mine");
  assert.equal(zoneOf(theirLock.engine, theirLock.id("mine")), "play", "their Lockbox blocks returns to MY hand");
  const nothing = lockBoard(pid, { owner: P2 });
  useMover(nothing, "mvPlay", "theirs");
  assert.equal(zoneOf(nothing.engine, nothing.id("theirs")), "hand", "their Lockbox does not restrict their own cards");
}
clause(LOCK, "0:rule", "the lock lasts exactly while its controller controls it, and works for either player", () => lockGone(LOCK));
clause(LOCK2, "0:rule", "the lock lasts exactly while its controller controls it, and works for either player", () => lockGone(LOCK2));

// ============================================================================
// Quipster D'Genie — character · arcanist · muddler · cost 2 · [O][O] · 1 str / 3 spd / 2 life
// ============================================================================
function quipBoard(o: { banks?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "qd", def: printing(QUIP), owner: P1, zone: "play" },
      { key: "tac1", def: tactic({ name: "Tac1" }), owner: P1, zone: "deck" },
      { key: "tac2", def: tactic({ name: "Tac2" }), owner: P1, zone: "deck" },
      { key: "ch", def: character({ name: "Ch" }), owner: P1, zone: "deck" },
      { key: "otac", def: tactic({ name: "OTac" }), owner: P2, zone: "deck" },
      ...bank("rage", o.banks ?? 3, P1),
      ...(o.extra ?? [])
    ]
  });
}
const wish = (b: ReturnType<typeof quipBoard>) => activate(b.engine, P1, b.id("qd"), "wish");

clause(QUIP, "0:ability:wish", "printed card: character, arcanist, muddler, cost 2, threshold oo, 1 str / 3 spd / 2 life; deploys for 2 with oo", () => {
  const d = printing(QUIP);
  assert.equal(d.type, "character");
  assert.equal(d.trade, "arcanist");
  assert.equal(d.cost, 2);
  assert.equal(d.threshold, "oo");
  assert.deepEqual([...(d.subtype ?? [])], ["muddler"]);
  const { engine, id } = buildGame({ cards: [{ key: "q", def: d, owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("q"), "strength"), 1);
  assert.equal(engine.getStat(id("q"), "speed"), 3);
  assert.equal(engine.getStat(id("q"), "life"), 2);
  const hand = (banks: Cards) => buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "q", def: d, owner: P1, zone: "hand" }, ...banks] });
  const ok = hand(bank("obsession", 3, P1));
  play(ok.engine, P1, ok.id("q"));
  assert.equal(zoneOf(ok.engine, ok.id("q")), "play");
  assert.equal(ready(ok.engine), 1, "exactly 2 paid");
  const one = hand([...bank("obsession", 1, P1), ...bank("obsession", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))]);
  refused(() => play(one.engine, P1, one.id("q")), "cost short (1 ready, threshold met by spent [O])", /Costs cannot be paid/);
  const icon = hand([...bank("obsession", 1, P1), ...bank("rage", 2, P1)]);
  refused(() => play(icon.engine, P1, icon.id("q")), "one obsession icon short");
  const exact = hand(bank("obsession", 2, P1));
  play(exact.engine, P1, exact.id("q"));
  assert.equal(zoneOf(exact.engine, exact.id("q")), "play", "control: oo");
});

clause(QUIP, "0:ability:wish", "WISH pays 2, destroys Quipster, and puts a chosen tactic from your deck into your hand (revealed)", () => {
  const b = quipBoard();
  wish(b);
  pick(b.engine, [b.id("tac2")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("qd")), "discard", "COST: destroyed");
  assert.equal(ready(b.engine), 1, "COST: pay 2");
  assert.equal(zoneOf(b.engine, b.id("tac2")), "hand");
  assert.equal(zoneOf(b.engine, b.id("tac1")), "deck", "just one tactic");
  assert.deepEqual(handOf(b.engine, P1), [b.id("tac2")]);
  assert.deepEqual(revealedIds(b.engine), [b.id("tac2")], "revealed");
});

clause(QUIP, "0:ability:wish", "only a tactic of YOUR deck can be found: a character and an opponent's tactic are refused", () => {
  const b = quipBoard();
  wish(b);
  refused(() => pick(b.engine, [b.id("ch")]), "character");
  refused(() => pick(b.engine, [b.id("otac")]), "opponent's tactic");
  assert.equal(zoneOf(b.engine, b.id("ch")), "deck");
  pick(b.engine, [b.id("tac1")]);
  assert.equal(zoneOf(b.engine, b.id("tac1")), "hand", "control");
});

clause(QUIP, "0:ability:wish", "the search may fail: choosing nothing finds no tactic (the cost is still paid)", () => {
  const b = quipBoard();
  wish(b);
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.equal(zoneOf(b.engine, b.id("qd")), "discard");
  assert.equal(ready(b.engine), 1);
});

clause(QUIP, "0:ability:wish", "with no tactic in the deck WISH still costs, finds nothing, and leaves nothing pending", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "qd", def: printing(QUIP), owner: P1, zone: "play" }, { key: "ch", def: character({ name: "Ch" }), owner: P1, zone: "deck" }, ...bank("rage", 2, P1)]
  });
  wish(b);
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("qd")), "discard");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(QUIP, "0:ability:wish", "WISH needs 2 resources: refused with 1, and Quipster stays in play", () => {
  const b = quipBoard({ banks: 1 });
  refused(() => wish(b), "pay 2 with 1");
  assert.equal(zoneOf(b.engine, b.id("qd")), "play");
  assert.equal(ready(b.engine), 1);
  const ok = quipBoard({ banks: 2 });
  wish(ok);
  pick(ok.engine, [ok.id("tac1")]);
  assert.equal(zoneOf(ok.engine, ok.id("tac1")), "hand", "control: exactly 2");
  assert.equal(ready(ok.engine), 0);
});

// ============================================================================
// Quotidian Quagmire — tactic · arcanist · cost 4 · [O][O]
// ============================================================================
function quagBoard(o: { banks?: Cards; extra?: Cards; theirAttached?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "qq", def: printing(QUAG), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OC", speed: 4 }), owner: P2, zone: "play" },
      { key: "oc2", def: character({ name: "OC2", speed: 4 }), owner: P2, zone: "play" },
      { key: "mc", def: character({ name: "MC", speed: 4 }), owner: P1, zone: "play" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
      ...Array.from({ length: o.theirAttached ?? 3 }, (_, i) => attached(`t${i}`, P2)),
      ...(o.banks ?? [...bank("obsession", 2, P1), ...bank("rage", 2, P1)]),
      // E3c: listed after the banks: the detach is a cost paid before the numeric cost, and the numeric cost takes the
      // first ready resources, so the two just detached are the last ones it would use.
      attached("m0", P1),
      attached("m1", P1),
      ...(o.extra ?? [])
    ]
  });
}
const quag = (b: ReturnType<typeof quagBoard>, target: string) => play(b.engine, P1, b.id("qq"), { selected: { c: [b.id(target)] } });
const detachAnswer = (b: ReturnType<typeof quagBoard>, ids: string[]) =>
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? sel(ids.map((k) => b.id(k))) : declineAll(pc)));

clause(QUAG, "0:extraCost", "printed card: tactic, arcanist, cost 4, threshold oo (3 resources, or 4 with one icon short, are refused)", () => {
  const d = printing(QUAG);
  assert.equal(d.type, "tactic");
  assert.equal(d.trade, "arcanist");
  assert.equal(d.cost, 4);
  assert.equal(d.threshold, "oo");
  const ok = quagBoard({ banks: [...bank("obsession", 2, P1), ...bank("rage", 3, P1)] });
  quag(ok, "oc");
  detachAnswer(ok, []);
  assert.equal(zoneOf(ok.engine, ok.id("qq")), "discard");
  assert.equal(ready(ok.engine), 1, "exactly 4 paid");
  const cost = quagBoard({ banks: [...bank("obsession", 2, P1), ...bank("rage", 1, P1)] });
  refused(() => quag(cost, "oc"), "cost short", /Costs cannot be paid/);
  assert.equal(zoneOf(cost.engine, cost.id("qq")), "hand");
  const icon = quagBoard({ banks: [...bank("obsession", 1, P1), ...bank("rage", 3, P1)] });
  refused(() => quag(icon, "oc"), "one icon short");
  const exact = quagBoard();
  quag(exact, "oc");
  detachAnswer(exact, []);
  assert.equal(zoneOf(exact.engine, exact.id("qq")), "discard", "control: oo + 2 other");
});

clause(QUAG, "0:extraCost", "you must pick a character: none, a non-character, or a card not in play is refused", () => {
  const b = quagBoard({ extra: [{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play" }, { key: "hc", def: character({ name: "HC" }), owner: P2, zone: "hand" }] });
  refused(() => play(b.engine, P1, b.id("qq"), { selected: {} }), "no pick");
  refused(() => quag(b, "it"), "item");
  refused(() => quag(b, "hc"), "character in hand");
  refused(() => play(b.engine, P1, b.id("qq"), { selected: { c: [b.engine.state.players[P2].factionId!] } }), "faction");
  assert.equal(zoneOf(b.engine, b.id("qq")), "hand");
  assert.equal(ready(b.engine), 4, "nothing paid");
  quag(b, "oc");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "control: a character in play is accepted");
});

clause(QUAG, "0:extraCost", "that character's controller (the opponent) chooses; they may detach up to 2 of THEIR faction's resources", () => {
  for (const [picked, expectDetached] of [[["t0", "t1"], 2], [["t2"], 1], [[], 0]] as const) {
    const b = quagBoard();
    quag(b, "oc");
    const pc = pending(b.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P2, "the character's controller chooses");
    detachAnswer(b, [...picked]);
    assert.equal(b.engine.state.pendingChoice, undefined);
    const stillOn = ["t0", "t1", "t2"].filter((k) => isAttached(b.engine, b.id(k), P2)).length;
    assert.equal(3 - stillOn, expectDetached, `detached ${picked.length}`);
    assert.ok(isAttached(b.engine, b.id("m0"), P1) && isAttached(b.engine, b.id("m1"), P1), "my attached resources untouched");
  }
});

clause(QUAG, "0:extraCost", "up to 2 only: 3 resources are refused", () => {
  const b = quagBoard();
  quag(b, "oc");
  refused(() => answer(b.engine, sel(["t0", "t1", "t2"].map((k) => b.id(k)))), "3 resources");
  for (const k of ["t0", "t1", "t2"]) assert.ok(isAttached(b.engine, b.id(k), P2), k);
  answer(b.engine, sel([b.id("t0"), b.id("t1")]));
  assert.equal(isAttached(b.engine, b.id("t0"), P2), false, "control: 2 are fine");
});

clause(QUAG, "0:extraCost", "if you pick your own character, YOU decide about your faction's resources", () => {
  const b = quagBoard();
  quag(b, "mc");
  const pc = pending(b.engine)!;
  assert.equal(pc.playerId, P1);
  detachAnswer(b, ["m0", "m1"]);
  assert.equal(isAttached(b.engine, b.id("m0"), P1), false);
  assert.equal(isAttached(b.engine, b.id("m1"), P1), false);
  for (const k of ["t0", "t1", "t2"]) assert.ok(isAttached(b.engine, b.id(k), P2), "the opponent's stay attached");
});

const freeRes = (e: Engine, owner: string) =>
  Object.keys(e.state.cards).find((k) => e.state.cards[k as never].ownerId === owner && e.getDefinition(k as never).type === "resource" && !e.state.cards[k as never].attachedTo)!;

clause(QUAG, "0:extraCost", "the detach cannot pick another faction's attached resource", () => {
  const b = quagBoard();
  quag(b, "oc");
  refused(() => answer(b.engine, sel([b.id("m0")])), "my own attached resource");
  assert.ok(isAttached(b.engine, b.id("m0"), P1), "isAttached(b.engine, b.id(\"m0\"), P1)");
});

clause(QUAG, "0:extraCost", "the detach cannot pick a card that is not a resource", () => {
  const b = quagBoard();
  quag(b, "oc");
  refused(() => answer(b.engine, sel([b.id("mc")])), "a non-resource card");
  assert.equal(zoneOf(b.engine, b.id("mc")), "play");
});

clause(QUAG, "0:extraCost", "the detach cannot pick a resource that is not attached to a faction", () => {
  const b = quagBoard({ extra: bank("rage", 1, P2) });
  quag(b, "oc");
  refused(() => answer(b.engine, sel([freeRes(b.engine, P2)])), "a ready (unattached) resource");
  answer(b.engine, sel([b.id("t0")]));
  assert.equal(isAttached(b.engine, b.id("t0"), P2), false, "control");
});

clause(QUAG, "0:extraCost", "the detach is an EXTRA COST: it is chosen and paid on deployment, before responses", () => {
  const b = quagBoard();
  playRaw(b.engine, P1, b.id("qq"), { selected: { c: [b.id("oc")] } });
  // As an extra cost the controller's choice is made now, while the Quagmire still waits on the stack.
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the detach choice is open immediately");
  assert.equal(b.engine.getStat(b.id("oc"), "speed"), 4, "the effect has not resolved");
});

clause(QUAG, "1:rule", "this turn the picked character loses 1 speed (others do not), and you draw a card", () => {
  const b = quagBoard();
  quag(b, "oc");
  detachAnswer(b, []);
  assert.equal(b.engine.getStat(b.id("oc"), "speed"), 3, "4 - 1");
  assert.equal(b.engine.getStat(b.id("oc2"), "speed"), 4, "other opposing character unaffected");
  assert.equal(b.engine.getStat(b.id("mc"), "speed"), 4, "my character unaffected");
  assert.equal(handOf(b.engine, P1).length, 1, "drew exactly one card (the Quagmire left the hand)");
  assert.equal(deckOf(b.engine, P1).length, 1);
});

clause(QUAG, "1:rule", "the speed loss lasts only this turn", () => {
  const b = quagBoard();
  quag(b, "oc");
  detachAnswer(b, []);
  assert.equal(b.engine.getStat(b.id("oc"), "speed"), 3);
  endTurn(b.engine, P1);
  drain(b.engine, declineAll);
  assert.equal(b.engine.getStat(b.id("oc"), "speed"), 4, "back to 4 after the turn ends");
});

clause(QUAG, "1:rule", "your own character can be the one that slows (it still loses 1 speed)", () => {
  const b = quagBoard({ extra: [{ key: "slow", def: character({ name: "Slow", speed: 0 }), owner: P2, zone: "play" }] });
  quag(b, "mc");
  detachAnswer(b, []);
  assert.equal(b.engine.getStat(b.id("mc"), "speed"), 3);
});

clause(QUAG, "1:rule", "a character with 0 speed does not go below 0", () => {
  const z = quagBoard({ extra: [{ key: "slow", def: character({ name: "Slow", speed: 0 }), owner: P2, zone: "play" }] });
  quag(z, "slow");
  detachAnswer(z, []);
  assert.equal(z.engine.getStat(z.id("slow"), "speed"), 0, "stats never go below 0");
});

// ============================================================================
// Ritual of the Sucking Skull — tactic · arcanist · cost 1 · [O] · FLIP UP 4 [O]
// ============================================================================
/**
 * P2 (active) deploys `x` (cost `xCost`) and P1 holds Ritual (hand or face-down) with the response window open.
 * Ritual's extra cost: "Deploy this card only in response to a card being deployed using FLIP UP", so by default `x` is
 * a face-down card of P2 that `startX` flips up (with the window held open); `normalX` puts `x` in P2's hand instead, to
 * be deployed normally (`startXNormal`).
 */
function ritualBoard(o: { xCost?: number; flipCost?: number; banks?: Cards; faceDown?: boolean; theirAttached?: number; xIsTactic?: boolean; normalX?: boolean } = {}) {
  const flipUp = { cost: o.flipCost ?? 1, threshold: "r" } as never;
  const xDef = o.xIsTactic
    ? tactic({ name: "X", cost: o.xCost ?? 2, flipUp, behavior: { abilities: [{ id: "b", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never)
    : character({ name: "X", cost: o.xCost ?? 2, flipUp } as never);
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      o.faceDown ? { key: "rs", def: printing(RITUAL), owner: P1, zone: "play", faceDown: true } : { key: "rs", def: printing(RITUAL), owner: P1, zone: "hand" },
      o.normalX ? { key: "x", def: xDef, owner: P2, zone: "hand" } : { key: "x", def: xDef, owner: P2, zone: "play", faceDown: true },
      { key: "pd", def: character({ name: "PD" }), owner: P2, zone: "deck" },
      { key: "pd2", def: character({ name: "PD2" }), owner: P2, zone: "deck" },
      ...bank("rage", 6, P2),
      ...Array.from({ length: o.theirAttached ?? 4 }, (_, i) => attached(`t${i}`, P2)),
      attached("m0", P1),
      ...(o.banks ?? bank("obsession", 1, P1))
    ]
  });
  return b;
}
const startXNormal = (b: ReturnType<typeof ritualBoard>) => playRaw(b.engine, P2, b.id("x"));
/** P2 deploys `x` using FLIP UP and the response window stays open for P1. */
const startX = (b: ReturnType<typeof ritualBoard>) =>
  holdFlipUp(() => flipUpNow(b.engine, { type: "flipUp", playerId: P2, cardId: b.id("x"), selected: {}, variables: {} }));
const ritual = (b: ReturnType<typeof ritualBoard>) => b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("rs"), selected: {}, variables: {} } as never);
const ritualFlip = (b: ReturnType<typeof ritualBoard>) => flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("rs"), selected: {}, variables: {} });
const detachFor = (b: ReturnType<typeof ritualBoard>, ids: string[]) =>
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? sel(ids.map((k) => b.id(k))) : declineAll(pc)));

clause(RITUAL, "0:extraCost", "printed card: tactic, arcanist, cost 1, threshold o; deploys for 1 [O] in response; refused with no resources or no obsession icon", () => {
  const d = printing(RITUAL);
  assert.equal(d.type, "tactic");
  assert.equal(d.trade, "arcanist");
  assert.equal(d.cost, 1);
  assert.equal(d.threshold, "o");
  const ok = ritualBoard({ banks: bank("obsession", 3, P1) });
  startX(ok);
  ritual(ok);
  assert.equal(zoneOf(ok.engine, ok.id("rs")), "deploying");
  resolvePendingResponses(ok.engine);
  detachFor(ok, []);
  assert.equal(zoneOf(ok.engine, ok.id("rs")), "discard");
  assert.equal(ready(ok.engine), 2, "exactly 1 paid");
  const none = ritualBoard({ banks: [] });
  startX(none);
  refused(() => ritual(none), "no resources");
  assert.equal(zoneOf(none.engine, none.id("rs")), "hand");
  const icon = ritualBoard({ banks: bank("rage", 3, P1) });
  startX(icon);
  refused(() => ritual(icon), "no obsession icon");
  assert.equal(zoneOf(icon.engine, icon.id("rs")), "hand");
});

clause(RITUAL, "0:extraCost", "it cannot be deployed except in response to a card being deployed: on its own turn, or with an empty stack, it is refused", () => {
  const own = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "rs", def: printing(RITUAL), owner: P1, zone: "hand" }, ...bank("obsession", 3, P1)]
  });
  refused(() => play(own.engine, P1, own.id("rs")), "nothing to respond to", /cannot be deployed right now/i);
  assert.equal(zoneOf(own.engine, own.id("rs")), "hand");
  const theirTurn = ritualBoard({ banks: bank("obsession", 3, P1) });
  refused(() => ritual(theirTurn), "no deployment on the stack yet", /active player/i);
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("rs")), "hand");
});

clause(RITUAL, "0:extraCost", "it is refused in response to a card deployed normally (not using FLIP UP)", () => {
  const b = ritualBoard({ banks: bank("obsession", 3, P1), normalX: true });
  startXNormal(b); // X is deployed from hand, NOT with FLIP UP
  refused(() => ritual(b), "the response is to a normal deployment", /cannot be deployed right now/i);
  assert.equal(zoneOf(b.engine, b.id("rs")), "hand");
});

clause(RITUAL, "0:extraCost", "it can be deployed in response to a card deployed using FLIP UP (a response window opens)", () => {
  const ft = tactic({ name: "FT", cost: 3, flipUp: { cost: 1, threshold: "r" } as never, behavior: { abilities: [{ id: "b", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } } as never);
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "rs", def: printing(RITUAL), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1),
      { key: "ft", def: ft, owner: P2, zone: "play", faceDown: true },
      ...bank("rage", 3, P2)
    ]
  });
  holdFlipUp(() => flipUpNow(b.engine, { type: "flipUp", playerId: P2, cardId: b.id("ft"), selected: {}, variables: {} }));
  ritual(b);
  assert.equal(zoneOf(b.engine, b.id("rs")), "deploying");
});

// E7b: a card deployed with FLIP UP has the running total of CR 406.7, seeded with its FLIP UP cost, as its numeric cost
// while it is being played (Q9). The first version read the printed cost number (2 / 3) of a card whose FLIP UP costs 1;
// the FLIP UP cost now equals the cost asserted, and a third case shows the printed number (5) is not X.
clause(RITUAL, "0:extraCost", "X is the card's numeric cost: the controller may detach up to X (=cost of the terminated card) resources, not X+1", () => {
  for (const [xCost, flipCost, ids] of [[2, 2, ["t0", "t1"]], [3, 3, ["t0", "t1", "t2"]], [5, 1, ["t0"]]] as const) {
    const b = ritualBoard({ xCost, flipCost });
    startX(b);
    ritual(b);
    resolvePendingResponses(b.engine);
    const pc = pending(b.engine)!;
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P2, "the terminated card's controller chooses");
    refused(() => answer(b.engine, sel(["t0", "t1", "t2", "t3"].slice(0, ids.length + 1).map((k) => b.id(k)))), `X+1 = ${ids.length + 1}`);
    answer(b.engine, sel(ids.map((k) => b.id(k))));
    assert.equal(b.engine.state.pendingChoice, undefined);
    for (const k of ids) assert.equal(isAttached(b.engine, b.id(k), P2), false, `X=${ids.length}: ${k} detached`);
    assert.ok(isAttached(b.engine, b.id("t3"), P2), "an unpicked one stays");
  }
});

clause(RITUAL, "1:rule", "terminates the card: a deployed character never enters play (goes to its owner's discard pile) and its controller's detach is optional", () => {
  const b = ritualBoard();
  startX(b);
  ritual(b);
  resolvePendingResponses(b.engine);
  detachFor(b, []);
  assert.equal(zoneOf(b.engine, b.id("x")), "discard", "terminated");
  for (const k of ["t0", "t1", "t2", "t3"]) assert.ok(isAttached(b.engine, b.id(k), P2), `"may": nothing detached (${k})`);
  assert.ok(isAttached(b.engine, b.id("m0"), P1), "isAttached(b.engine, b.id(\"m0\"), P1)");
});

clause(RITUAL, "1:rule", "terminates a tactic too: its effect does not happen", () => {
  const b = ritualBoard({ xIsTactic: true });
  startX(b);
  ritual(b);
  resolvePendingResponses(b.engine);
  detachFor(b, []);
  assert.equal(zoneOf(b.engine, b.id("x")), "discard");
  assert.deepEqual(handOf(b.engine, P2), [], "the terminated draw tactic drew nothing");
});

const ritualAsk = () => {
  const b = ritualBoard();
  startX(b);
  ritual(b);
  resolvePendingResponses(b.engine);
  return b;
};
clause(RITUAL, "1:rule", "the detach cannot pick another faction's attached resource", () => {
  const b = ritualAsk();
  refused(() => answer(b.engine, sel([b.id("m0")])), "my own attached resource");
  assert.ok(isAttached(b.engine, b.id("m0"), P1), "isAttached(b.engine, b.id(\"m0\"), P1)");
});
clause(RITUAL, "1:rule", "the detach cannot pick a card that is not a resource", () => {
  const b = ritualAsk();
  refused(() => answer(b.engine, sel([b.id("x")])), "a non-resource card");
});
clause(RITUAL, "1:rule", "the detach cannot pick a resource that is not attached to a faction", () => {
  const b = ritualAsk();
  refused(() => answer(b.engine, sel([freeRes(b.engine, P2)])), "a ready (unattached) resource");
  answer(b.engine, sel([b.id("t0")]));
  assert.equal(isAttached(b.engine, b.id("t0"), P2), false, "control");
});

// FLIP UP (Ritual face-down in play; the window is the opponent's normal deployment)
const flipBoard = (banks: Cards) => ritualBoard({ faceDown: true, banks });

clause(RITUAL, "2:flipUp", "FLIP UP for 4 [O] terminates the card and, because Ritual WAS deployed with FLIP UP, the controller detaches nothing", () => {
  const b = flipBoard(bank("obsession", 4, P1));
  startX(b);
  ritualFlip(b);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined, "no detach prompt after a FLIP UP deploy");
  assert.equal(zoneOf(b.engine, b.id("x")), "discard", "terminated");
  assert.equal(zoneOf(b.engine, b.id("rs")), "discard");
  for (const k of ["t0", "t1", "t2", "t3"]) assert.ok(isAttached(b.engine, b.id(k), P2), `${k} stays attached`);
  assert.equal(ready(b.engine), 0, "all 4 banks paid");
});

clause(RITUAL, "2:flipUp", "FLIP UP is refused with 2 banks (cost short under any reading) and with 4 banks but no obsession icon", () => {
  const short = flipBoard(bank("obsession", 2, P1));
  startX(short);
  refused(() => ritualFlip(short), "2 banks");
  assert.equal(short.engine.state.cards[short.id("rs")].faceDown, true);
  assert.equal(ready(short.engine), 3, "nothing paid");
  const icon = flipBoard(bank("rage", 5, P1));
  startX(icon);
  refused(() => ritualFlip(icon), "threshold o");
  assert.equal(icon.engine.state.cards[icon.id("rs")].faceDown, true);
  const ok = flipBoard([...bank("obsession", 1, P1), ...bank("rage", 3, P1)]);
  startX(ok);
  ritualFlip(ok);
  assert.equal(zoneOf(ok.engine, ok.id("rs")), "discard", "control: [O] + 3 other");
});

// CR 507.4b (RULES.md FLIP UP): the FLIP UP cost is paid before flipping, so the card may pay for itself.
clause(RITUAL, "2:flipUp", "the face-down card may help pay its own FLIP UP cost: 3 banks + itself pays the 4", () => {
  const b = flipBoard(bank("obsession", 3, P1));
  startX(b);
  ritualFlip(b);
  assert.equal(zoneOf(b.engine, b.id("rs")), "discard", "flipped up and resolved with itself as one of the 4 payers");
});
