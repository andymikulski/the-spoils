import assert from "node:assert/strict";
import {
  buildGame,
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
import { clause, drain, printing, refused } from "./_clause.js";
import { declareAttackBy, finishBattle, playRaw } from "./_battle.js";
import { declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { attachedCount, endTurn, readyCount } from "./_turn.js";

const CM = "e2f8e482-c1c5-48fa-949c-6a7bc7cc0e09"; // Fantastic Über Kool Creator Majig
const FLEET = "49eef7ab-5fec-40a7-968e-0731d97067c4"; // Fleet Majig
const JERRY = "a9c7ba1c-1080-4a81-932a-ab573c7a193f"; // Frantic Jerryrigging
const READY = "c71f0071-5ef8-4b3b-9356-149cad14c9bd"; // God's Blessing of Readiness

type Engine = ReturnType<typeof buildGame>["engine"];
type Pc = { kind: string; playerId: string; triggers?: { abilityId: string }[]; declaration?: { id: string }; [k: string]: unknown };

const spentE = (n: number): CardPlacement[] => bank("elitism", n, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
const stats = (e: Engine, id: string) => [e.getStat(id, "strength"), e.getStat(id, "speed"), e.getStat(id, "life")];
const keysOf = (ps: CardPlacement[]) => ps.map((p) => p.key);

// A free tactic that destroys any one card in play.
const smash = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  } as never);

/* ====================================================================== */
/* Fantastic Über Kool Creator Majig                                      */
/* ====================================================================== */

function cmCast(o: { e?: number; rage?: number; spent?: number; oppE?: number; vol?: number; extra?: CardPlacement[] }) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cm", def: printing(CM), owner: P1, zone: "hand" },
      ...bank("elitism", o.e ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...spentE(o.spent ?? 0),
      ...bank("elitism", o.oppE ?? 0, P2),
      ...volition(o.vol ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
const cmCostOf = (b: ReturnType<typeof cmCast>) => b.engine.getCardPlayability(P1, b.id("cm")).numericCost;
const cmCastNow = (b: ReturnType<typeof cmCast>) => play(b.engine, P1, b.id("cm"), {});

clause(CM, "0:unique", "is a gearsmith item with printed cost 10, threshold e, UNIQUE CREATOR MAJIG", () => {
  const p = printing(CM);
  assert.equal(p.type, "item");
  assert.equal(p.trade, "gearsmith");
  assert.equal(p.cost, 10);
  assert.equal(p.threshold, "e");
  assert.deepEqual(p.subtype, []);
  assert.equal((p as unknown as { unique?: string }).unique, "creator majig");
});

clause(CM, "0:unique", "threshold e: with no [E] among ten resources it cannot be deployed; one [E] among them (cost 9) can", () => {
  const none = cmCast({ rage: 10 });
  assert.equal(none.engine.getCardPlayability(P1, none.id("cm")).playable, false);
  refused(() => cmCastNow(none), "no [E] icon");
  assert.equal(zoneOf(none.engine, none.id("cm")), "hand");
  const one = cmCast({ e: 1, rage: 9 });
  cmCastNow(one);
  assert.equal(zoneOf(one.engine, one.id("cm")), "play");
  assert.equal(attachedCount(one.engine, P1), 9, "cost 10 minus the one [E] = 9 spent");
});

clause(CM, "0:unique", "cost: 5 [E] pays all five (printed 10 - 5); one resource short (4 [E], cost 6) is refused", () => {
  const ok = cmCast({ e: 5 });
  cmCastNow(ok);
  assert.equal(zoneOf(ok.engine, ok.id("cm")), "play");
  assert.equal(attachedCount(ok.engine, P1), 5);
  const short = cmCast({ e: 4 });
  assert.equal(cmCostOf(short), 6);
  refused(() => cmCastNow(short), "6 needed, 4 ready");
  assert.equal(zoneOf(short.engine, short.id("cm")), "hand");
  const one = cmCast({ e: 1, rage: 7 });
  refused(() => cmCastNow(one), "cost 9 with 8 resources");
});

clause(CM, "0:unique", "you cannot control two UNIQUE CREATOR MAJIGs: the second forces a choice and destroys the other", () => {
  const b = cmCast({ e: 10, extra: [{ key: "cm0", def: printing(CM), owner: P1, zone: "play" }] });
  cmCastNow(b);
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("cm"), b.id("cm0")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("cm") } } as never);
  assert.equal(zoneOf(b.engine, b.id("cm")), "play");
  assert.equal(zoneOf(b.engine, b.id("cm0")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CM, "0:unique", "choosing the older copy keeps it and destroys the new one", () => {
  const b = cmCast({ e: 10, extra: [{ key: "cm0", def: printing(CM), owner: P1, zone: "play" }] });
  cmCastNow(b);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("cm0") } } as never);
  assert.equal(zoneOf(b.engine, b.id("cm0")), "play");
  assert.equal(zoneOf(b.engine, b.id("cm")), "discard");
});

clause(CM, "0:unique", "UNIQUE is per player: the opponent may control their own Creator Majig", () => {
  const b = cmCast({ e: 10, extra: [{ key: "cm0", def: printing(CM), owner: P2, zone: "play" }] });
  cmCastNow(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("cm")), "play");
  assert.equal(zoneOf(b.engine, b.id("cm0")), "play");
});

clause(CM, "1:extraCost", "numeric cost is 10 minus the number of [E] you control", () => {
  for (const [n, cost] of [[0, 10], [1, 9], [3, 7], [7, 3], [9, 1]] as const) {
    const b = cmCast({ e: n });
    assert.equal(cmCostOf(b), cost, `${n} [E] -> cost ${cost}`);
  }
});

clause(CM, "1:extraCost", "the reduction cannot take the cost below 0: 12 [E] means a free deploy", () => {
  const b = cmCast({ e: 12 });
  assert.equal(cmCostOf(b), 0);
  cmCastNow(b);
  assert.equal(zoneOf(b.engine, b.id("cm")), "play");
  assert.equal(attachedCount(b.engine, P1), 0, "nothing was spent");
});

clause(CM, "1:extraCost", "only [E] reduces the cost: other icons and face-down (Volition) resources do not", () => {
  const b = cmCast({ e: 1, rage: 4, vol: 3 });
  assert.equal(cmCostOf(b), 9);
  const r = cmCast({ rage: 6 });
  assert.equal(cmCostOf(r), 10);
});

clause(CM, "1:extraCost", "spent (attached) [E] resources are still controlled and still reduce the cost", () => {
  const b = cmCast({ spent: 4, rage: 6 });
  assert.equal(cmCostOf(b), 6);
  cmCastNow(b);
  assert.equal(zoneOf(b.engine, b.id("cm")), "play");
  assert.equal(attachedCount(b.engine, P1), 10, "4 already spent + 6 paid");
  const short = cmCast({ spent: 4, rage: 5 });
  refused(() => cmCastNow(short), "cost 6, only 5 ready");
});

clause(CM, "1:extraCost", "only [E] YOU control counts: the opponent's [E] does not reduce it", () => {
  const b = cmCast({ e: 4, oppE: 6 });
  assert.equal(cmCostOf(b), 6);
  refused(() => cmCastNow(b), "cost 6 with 4 ready");
});

clause(CM, "1:extraCost", "a resource providing two [E] counts as two [E]", () => {
  const dual = resourceCard({ name: "Dual E", resource: { provides: ["elitism", "elitism"], staple: false } } as never);
  const b = cmCast({ e: 1, extra: [{ key: "dual", def: dual, owner: P1, zone: "play" }] });
  assert.equal(cmCostOf(b), 7, "1 + 2 [E] icons");
});

// ---- triggered abilities (turn start) ----

type Ans = { r?: string[]; e?: string[]; s?: string[]; first?: "harvest" | "reforge" };
function startTurn(b: { engine: Engine }, a: Ans = {}, active: string = P2): string[] {
  const seen: string[] = [];
  endTurn(b.engine, active);
  let g = 0;
  while (b.engine.state.pendingChoice && g++ < 12) {
    const pc = pending(b.engine) as unknown as Pc;
    if (pc.kind === "orderTriggers") {
      const next = pc.triggers!.find((t) => t.abilityId === (a.first ?? "harvest")) ?? pc.triggers![0];
      b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next } } as never);
    } else if (pc.kind === "chooserSelectsTarget") {
      const id = pc.declaration!.id;
      seen.push(id);
      const selected = (id === "r" ? a.r : id === "e" ? a.e : a.s) ?? [];
      b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);
    } else {
      throw new Error(`unexpected pending choice ${pc.kind}`);
    }
    resolvePendingResponses(b.engine);
  }
  return seen;
}

function cmTurn(o: { e?: number; spent?: number; rage?: number; oppE?: number; cmZone?: "play" | "hand"; owner?: string; extra?: CardPlacement[] } = {}) {
  const e = bank("elitism", o.e ?? 0, P1);
  const rage = bank("rage", o.rage ?? 0, P1);
  const sp = spentE(o.spent ?? 0);
  const oppE = bank("elitism", o.oppE ?? 0, P2);
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "cm", def: printing(CM), owner: P1, zone: o.cmZone ?? "play" },
      ...e, ...rage, ...sp, ...oppE,
      { key: "hres", def: resourceCard({ name: "HandRes" }), owner: P1, zone: "hand" },
      { key: "hch", def: character({ name: "HandCh" }), owner: P1, zone: "hand" },
      { key: "tchar", def: character({ name: "TutorChar" }), owner: P1, zone: "deck" },
      { key: "titem", def: item({ name: "TutorItem" }), owner: P1, zone: "deck" },
      { key: "tloc", def: location({ name: "TutorLoc" }), owner: P1, zone: "deck" },
      ...fillers("d", 3, P1, "deck"),
      { key: "otc", def: character({ name: "OppDeck" }), owner: P2, zone: "deck" },
      ...(o.extra ?? [])
    ]
  });
  return { ...b, e: keysOf(e), rage: keysOf(rage), sp: keysOf(sp), oppE: keysOf(oppE) };
}

clause(CM, "2:rule", "at the start of your turn you may play a resource from your hand (accept)", () => {
  const b = cmTurn();
  const dec = cmTurn();
  const before = readyCount(b.engine, P1);
  assert.equal(zoneOf(b.engine, b.id("hres")), "hand");
  const seen = startTurn(b, { r: [b.id("hres")] });
  assert.ok(seen.includes("r"), "asked which resource to play");
  assert.equal(zoneOf(b.engine, b.id("hres")), "play");
  assert.equal(b.engine.isResource(b.id("hres")), true);
  assert.ok(!b.engine.state.players[P1].hand.includes(b.id("hres")), "!b.engine.state.players[P1].hand.includes(b.id(\"hres\"))");
  startTurn(dec, {});
  assert.equal(readyCount(b.engine, P1), readyCount(dec.engine, P1) + 1, "it is an extra resource");
  assert.ok(before >= 0, "before >= 0");
});

clause(CM, "2:rule", "declining plays nothing", () => {
  const b = cmTurn();
  const seen = startTurn(b, { r: [] });
  assert.ok(seen.includes("r"), "the choice is offered");
  assert.equal(zoneOf(b.engine, b.id("hres")), "hand");
  assert.equal(zoneOf(b.engine, b.id("hch")), "hand");
});

clause(CM, "2:rule", "any card may be played as a resource, face-down (CR 203.2): a character card from hand is accepted and ends in play face-down", () => {
  const b = cmTurn();
  endTurn(b.engine, P2);
  let pc = pending(b.engine) as unknown as Pc;
  while (pc.kind === "orderTriggers") {
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: pc.triggers![0] } } as never);
    pc = pending(b.engine) as unknown as Pc;
  }
  assert.equal(pc.declaration!.id, "r");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("hch")] } } as never);
  assert.equal(zoneOf(b.engine, b.id("hch")), "play", "the character card was played as a resource");
  assert.equal(b.engine.state.cards[b.id("hch")].faceDown, true, "only face-down: it is a Volition resource, not a character");
});

clause(CM, "2:rule", "it triggers at the start of YOUR turn only: no prompt at the opponent's turn start", () => {
  const b = cmTurn();
  endTurn(b.engine, P2); // P1's turn starts; resolve it
  drain(b.engine, (pc) => (pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : { kind: pc.kind, selected: [] }));
  assert.equal(b.engine.state.activePlayerId, P1);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing at the opponent's turn start");
  assert.equal(zoneOf(b.engine, b.id("hres")), "hand");
});

clause(CM, "2:rule", "the card must be in play: from hand it does nothing at the start of your turn", () => {
  const b = cmTurn({ cmZone: "hand" });
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("hres")), "hand");
});

clause(CM, "2:rule", "it stops when the Creator Majig leaves play", () => {
  const b = cmTurn({ extra: [{ key: "sm", def: smash(), owner: P1, zone: "hand" }] });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("cm")] } });
  assert.equal(zoneOf(b.engine, b.id("cm")), "discard");
  b.engine.state.activePlayerId = P2;
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("hres")), "hand");
});

clause(CM, "3:rule", "at the start of your turn you may destroy a card you control that provides [E] and, if you do, search for any card into your hand", () => {
  const b = cmTurn({ e: 2 });
  const seen = startTurn(b, { e: [b.id(b.e[0])], s: [b.id("tloc")] });
  assert.deepEqual(seen.filter((x) => x !== "r"), ["e", "__s"]);
  assert.equal(zoneOf(b.engine, b.id(b.e[0])), "discard", "the [E] resource was destroyed");
  assert.equal(zoneOf(b.engine, b.id(b.e[1])), "play", "the other one was not");
  assert.ok(b.engine.state.players[P1].hand.includes(b.id("tloc")), "searched card is in hand");
  assert.ok(!b.engine.state.players[P1].deck.includes(b.id("tloc")), "!b.engine.state.players[P1].deck.includes(b.id(\"tloc\"))");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(CM, "3:rule", "the search is for ANY card: a character, an item and a location can all be taken", () => {
  for (const k of ["tchar", "titem", "tloc"]) {
    const b = cmTurn({ e: 1 });
    startTurn(b, { e: [b.id(b.e[0])], s: [b.id(k)] });
    assert.ok(b.engine.state.players[P1].hand.includes(b.id(k)), `${k} fetched`);
  }
});

clause(CM, "3:rule", "the searched card comes from YOUR deck only, and the rest of the deck is kept", () => {
  const b = cmTurn({ e: 1 });
  const deckBefore = b.engine.state.players[P1].deck.length;
  const oppDeck = [...b.engine.state.players[P2].deck];
  startTurn(b, { e: [b.id(b.e[0])], s: [b.id("titem")] });
  assert.equal(b.engine.state.players[P1].deck.length, deckBefore - 1);
  assert.deepEqual(b.engine.state.players[P2].deck, oppDeck);
  refused(() => {
    const b2 = cmTurn({ e: 1 });
    endTurn(b2.engine, P2);
    let pc = pending(b2.engine) as unknown as Pc;
    const answerOrder = () => b2.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: pc.triggers!.find((t) => t.abilityId === "reforge") } } as never);
    answerOrder();
    pc = pending(b2.engine) as unknown as Pc;
    assert.equal(pc.declaration!.id, "e");
    b2.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b2.id(b2.e[0])] } } as never);
    pc = pending(b2.engine) as unknown as Pc;
    assert.equal(pc.declaration!.id, "__s");
    b2.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b2.id("otc")] } } as never);
  }, "the opponent's deck is not searched");
});

clause(CM, "3:rule", "declining destroys nothing and searches nothing", () => {
  const b = cmTurn({ e: 2 });
  const handBefore = [...b.engine.state.players[P1].hand];
  const deckBefore = [...b.engine.state.players[P1].deck];
  const seen = startTurn(b, { e: [] });
  assert.ok(seen.includes("e"), "seen.includes(\"e\")");
  assert.ok(!seen.includes("__s"), "no search without the destroy");
  assert.equal(zoneOf(b.engine, b.id(b.e[0])), "play");
  assert.equal(zoneOf(b.engine, b.id(b.e[1])), "play");
  assert.deepEqual(b.engine.state.players[P1].hand, handBefore);
  assert.deepEqual(b.engine.state.players[P1].deck, deckBefore);
});

clause(CM, "3:rule", "only a card that provides [E] can be destroyed: your [rage] resource is refused", () => {
  const b = cmTurn({ e: 1, rage: 1 });
  const seen = startTurn(b, {});
  assert.ok(seen.includes("e"), "seen.includes(\"e\")");
  const c = cmTurn({ e: 1, rage: 1 });
  endTurn(c.engine, P2);
  let pc = pending(c.engine) as unknown as Pc;
  c.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: pc.triggers!.find((t) => t.abilityId === "reforge") } } as never);
  pc = pending(c.engine) as unknown as Pc;
  assert.equal(pc.declaration!.id, "e");
  refused(() => c.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [c.id(c.rage[0])] } } as never), "rage does not provide [E]");
  assert.equal(zoneOf(c.engine, c.id(c.rage[0])), "play");
  c.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [c.id(c.e[0])] } } as never);
  assert.equal(zoneOf(c.engine, c.id(c.e[0])), "discard", "control: the [E] one works");
});

clause(CM, "3:rule", "only a card YOU control: the opponent's [E] resource is refused", () => {
  const c = cmTurn({ e: 1, oppE: 1 });
  endTurn(c.engine, P2);
  let pc = pending(c.engine) as unknown as Pc;
  c.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: pc.triggers!.find((t) => t.abilityId === "reforge") } } as never);
  pc = pending(c.engine) as unknown as Pc;
  assert.equal(pc.declaration!.id, "e");
  refused(() => c.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [c.id(c.oppE[0])] } } as never), "opponent's [E]");
  assert.equal(zoneOf(c.engine, c.id(c.oppE[0])), "play");
});

clause(CM, "3:rule", "a spent (attached) [E] resource still provides [E] and can be destroyed", () => {
  const b = cmTurn({ spent: 1 });
  startTurn(b, { e: [b.id(b.sp[0])], s: [b.id("titem")] });
  assert.equal(zoneOf(b.engine, b.id(b.sp[0])), "discard");
  assert.ok(b.engine.state.players[P1].hand.includes(b.id("titem")), "b.engine.state.players[P1].hand.includes(b.id(\"titem\"))");
});

clause(CM, "3:rule", "a card in hand that would provide [E] is not a card you control: refused", () => {
  const b = cmTurn({ e: 1, extra: [{ key: "hand-e", def: bank("elitism", 1, P1)[0].def, owner: P1, zone: "hand" }] });
  endTurn(b.engine, P2);
  let pc = pending(b.engine) as unknown as Pc;
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "orderTriggers", next: pc.triggers!.find((t) => t.abilityId === "reforge") } } as never);
  pc = pending(b.engine) as unknown as Pc;
  assert.equal(pc.declaration!.id, "e");
  refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("hand-e")] } } as never), "a hand card is not controlled");
  assert.equal(zoneOf(b.engine, b.id("hand-e")), "hand");
});

clause(CM, "3:rule", "a face-down [E] resource provides Volition, not [E]: refused", () => {
  const fd = { ...bank("elitism", 1, P1)[0], key: "fd-e", faceDown: true } as CardPlacement;
  const b = cmTurn({ extra: [fd] });
  const seen = startTurn(b, {});
  assert.ok(!seen.includes("e"), "no legal [E] card, so nothing to destroy");
  assert.equal(zoneOf(b.engine, b.id("fd-e")), "play");
  const c = cmTurn({ e: 1, extra: [{ ...fd, key: "fd-e2" }] });
  assert.ok(startTurn(c, {}).includes("e"), "control: a face-up [E] resource gives the prompt");
});

clause(CM, "3:rule", "it triggers only at the start of your turn and only while in play", () => {
  const b = cmTurn({ e: 1 });
  endTurn(b.engine, P2);
  drain(b.engine, (pc) => (pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : { kind: pc.kind, selected: [] }));
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.pendingChoice, undefined, "opponent's turn start: no prompt");
  const h = cmTurn({ e: 1, cmZone: "hand" });
  endTurn(h.engine, P2);
  assert.equal(h.engine.state.pendingChoice, undefined, "from hand: no prompt");
});

/* ====================================================================== */
/* Fleet Majig                                                            */
/* ====================================================================== */

function fleetBoard(o: { e?: number; rage?: number; spent?: number; oppE?: number; zone?: "hand" | "play"; fdE?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fl", def: printing(FLEET), owner: P1, zone: o.zone ?? "play" },
      ...bank("elitism", o.e ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...spentE(o.spent ?? 0),
      ...bank("elitism", o.oppE ?? 0, P2),
      ...Array.from({ length: o.fdE ?? 0 }, (_, i) => ({ ...bank("elitism", 1, P1)[0], key: `fd${i}`, faceDown: true }) as CardPlacement),
      ...(o.extra ?? [])
    ]
  });
}

clause(FLEET, "0:rule", "is a gearsmith majig character, cost 2, threshold ee, 1 strength / 2 speed / 1 life", () => {
  const p = printing(FLEET);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "gearsmith");
  assert.deepEqual(p.subtype, ["majig"]);
  assert.equal(p.cost, 2);
  assert.equal(p.threshold, "ee");
  const b = fleetBoard();
  assert.deepEqual(stats(b.engine, b.id("fl")), [1, 2, 1]);
});

clause(FLEET, "0:rule", "cost 2: two [E] deploy it and spend both; one resource short is refused", () => {
  const ok = fleetBoard({ zone: "hand", e: 2 });
  play(ok.engine, P1, ok.id("fl"), {});
  assert.equal(zoneOf(ok.engine, ok.id("fl")), "play");
  assert.equal(attachedCount(ok.engine, P1), 2);
  const short = fleetBoard({ zone: "hand", e: 1 });
  refused(() => play(short.engine, P1, short.id("fl"), {}), "cost 2, 1 resource");
  assert.equal(zoneOf(short.engine, short.id("fl")), "hand");
});

clause(FLEET, "0:rule", "threshold ee: one [E] plus one other icon, or no [E], is refused", () => {
  const one = fleetBoard({ zone: "hand", e: 1, rage: 1 });
  refused(() => play(one.engine, P1, one.id("fl"), {}), "only one [E]");
  const none = fleetBoard({ zone: "hand", rage: 2 });
  refused(() => play(none.engine, P1, none.id("fl"), {}), "no [E]");
  const ok = fleetBoard({ zone: "hand", e: 2, rage: 1 });
  play(ok.engine, P1, ok.id("fl"), {});
  assert.equal(zoneOf(ok.engine, ok.id("fl")), "play");
});

clause(FLEET, "0:rule", "cost isolated from the threshold: two spent [E] meet ee but one ready resource cannot pay 2", () => {
  const short = fleetBoard({ zone: "hand", spent: 2, rage: 1 });
  refused(() => play(short.engine, P1, short.id("fl"), {}), "cost 2 with one ready resource");
  const ok = fleetBoard({ zone: "hand", spent: 2, rage: 2 });
  play(ok.engine, P1, ok.id("fl"), {});
  assert.equal(zoneOf(ok.engine, ok.id("fl")), "play");
  assert.equal(attachedCount(ok.engine, P1), 4);
});

function fleetBattle(extraAttacker = false) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fl", def: printing(FLEET), owner: P1, zone: "play" },
      { key: "norm", def: character({ name: "Norm", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      ...(extraAttacker ? [] : [])
    ]
  });
}

clause(FLEET, "0:rule", "cannot be blocked: the opponent's untapped character cannot block it, and the damage goes through", () => {
  const b = fleetBattle();
  const life = b.engine.state.players[P2].influence;
  declareAttackBy(b.engine, P1, [b.id("fl")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("blk")]), "Fleet Majig cannot be blocked");
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(b.engine.state.players[P2].influence, life - 1, "unblocked: 1 strength to the faction");
  assert.ok(b.engine.getKeywords(b.id("fl")).includes("cannotBeBlocked"), "b.engine.getKeywords(b.id(\"fl\")).includes(\"cannotBeBlocked\")");
});

clause(FLEET, "0:rule", "control: an ordinary attacker CAN be blocked by the same blocker", () => {
  const b = fleetBattle();
  declareAttackBy(b.engine, P1, [b.id("norm")]);
  declareBlockers(b.engine, P2, [b.id("blk")]);
  assert.equal(b.engine.getKeywords(b.id("norm")).includes("cannotBeBlocked"), false);
});

clause(FLEET, "0:rule", "a party of only unblockable members cannot be blocked (CR 412)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fl", def: printing(FLEET), owner: P1, zone: "play" },
      { key: "fl2", def: printing(FLEET), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("fl"), b.id("fl2")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("blk")]), "party of two unblockable Fleets");
});

clause(FLEET, "0:rule", "a party mixing Fleet Majig with an ordinary attacker can be blocked (CR 412: every member must be unblockable)", () => {
  const b = fleetBattle();
  declareAttackBy(b.engine, P1, [b.id("fl"), b.id("norm")]);
  declareBlockers(b.engine, P2, [b.id("blk")]);
});

clause(FLEET, "1:rule@eeeeee", "with six [E] it gains 2 strength and 2 life (3 / 2 / 3) and no speed", () => {
  const b = fleetBoard({ e: 6 });
  assert.deepEqual(stats(b.engine, b.id("fl")), [3, 2, 3]);
});

clause(FLEET, "1:rule@eeeeee", "five [E] (and any number of other icons) do not turn it on", () => {
  const b = fleetBoard({ e: 5, rage: 4 });
  assert.deepEqual(stats(b.engine, b.id("fl")), [1, 2, 1]);
});

clause(FLEET, "1:rule@eeeeee", "more than six [E] still gives only +2/+2", () => {
  const b = fleetBoard({ e: 9 });
  assert.deepEqual(stats(b.engine, b.id("fl")), [3, 2, 3]);
});

clause(FLEET, "1:rule@eeeeee", "spent (attached) [E] count toward the threshold", () => {
  const b = fleetBoard({ e: 3, spent: 3 });
  assert.deepEqual(stats(b.engine, b.id("fl")), [3, 2, 3]);
});

clause(FLEET, "1:rule@eeeeee", "face-down [E] resources and the opponent's [E] do not count", () => {
  const fd = fleetBoard({ e: 5, fdE: 1 });
  assert.deepEqual(stats(fd.engine, fd.id("fl")), [1, 2, 1]);
  const opp = fleetBoard({ e: 5, oppE: 3 });
  assert.deepEqual(stats(opp.engine, opp.id("fl")), [1, 2, 1]);
});

clause(FLEET, "1:rule@eeeeee", "the bonus turns off when a resource is destroyed, and is off after Fleet leaves play", () => {
  const e = bank("elitism", 6, P1);
  const b = fleetBoard({ extra: [...e, { key: "sm", def: smash(), owner: P1, zone: "hand" }, { key: "sm2", def: smash(), owner: P1, zone: "hand" }] });
  assert.deepEqual(stats(b.engine, b.id("fl")), [3, 2, 3]);
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id(e[0].key)] } });
  assert.equal(zoneOf(b.engine, b.id(e[0].key)), "discard");
  assert.deepEqual(stats(b.engine, b.id("fl")), [1, 2, 1], "five [E] left");
  assert.deepEqual(stats(b.engine, b.id("fl")), [1, 2, 1], "still off");
  play(b.engine, P1, b.id("sm2"), { selected: { t: [b.id("fl")] } });
  assert.equal(zoneOf(b.engine, b.id("fl")), "discard");
  assert.equal(b.engine.getStat(b.id("fl"), "strength"), 1, "a card that left play reads printed stats");
});

clause(FLEET, "1:rule@eeeeee", "the bonus applies only to Fleet Majig itself, not to other characters", () => {
  const b = fleetBoard({ e: 6, extra: [{ key: "oth", def: character({ name: "Other", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" }] });
  assert.deepEqual(stats(b.engine, b.id("oth")), [1, 1, 1]);
});

/* ====================================================================== */
/* Frantic Jerryrigging                                                   */
/* ====================================================================== */

function jBoard(o: { ready?: CardPlacement[]; mine?: CardPlacement[]; opp?: CardPlacement[]; deck?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "j", def: printing(JERRY), owner: P1, zone: "hand" },
      ...(o.ready ?? [...bank("elitism", 3, P1)]),
      ...(o.mine ?? [{ key: "my1", def: item({ name: "Mine1", cost: 1 }), owner: P1, zone: "play" }]),
      ...(o.opp ?? []),
      ...(o.deck ?? []),
      ...fillers("d", 2, P1, "deck"),
      ...fillers("e", 2, P2, "deck")
    ]
  });
}
type JB = ReturnType<typeof jBoard>;
const castJ = (b: JB, mine = "my1") => play(b.engine, P1, b.id("j"), { selected: { it: [b.id(mine)] } });
const answerOpt = (b: JB, index: number) => {
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index } } as never);
  resolvePendingResponses(b.engine);
};
const answerPick = (b: JB, ids: string[]) => {
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  resolvePendingResponses(b.engine);
};
const itm = (key: string, cost: number, owner: string, zone: "play" | "deck" = "play"): CardPlacement => ({ key, def: item({ name: key, cost }), owner, zone });

clause(JERRY, "0:extraCost", "is a gearsmith tactic with printed cost 3 and threshold ee", () => {
  const p = printing(JERRY);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "gearsmith");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "ee");
  assert.deepEqual(p.subtype, []);
});

clause(JERRY, "0:extraCost", "cost 3: three resources (ee + 1) pay and spend three; two resources are refused", () => {
  const ok = jBoard({ ready: [...bank("elitism", 2, P1), ...bank("rage", 1, P1)] });
  castJ(ok);
  answerOpt(ok, 0);
  if (pending(ok.engine)) answerPick(ok, []);
  assert.equal(attachedCount(ok.engine, P1), 3);
  assert.equal(zoneOf(ok.engine, ok.id("j")), "discard", "a resolved tactic goes to the discard pile");
  const short = jBoard({ ready: [...bank("elitism", 2, P1)] });
  refused(() => castJ(short), "cost 3 with 2 resources");
  assert.equal(zoneOf(short.engine, short.id("my1")), "play", "nothing was destroyed");
});

clause(JERRY, "0:extraCost", "threshold ee: one [E] among three resources is refused", () => {
  const b = jBoard({ ready: [...bank("elitism", 1, P1), ...bank("rage", 2, P1)] });
  refused(() => castJ(b), "only one [E]");
  assert.equal(zoneOf(b.engine, b.id("j")), "hand");
  assert.equal(zoneOf(b.engine, b.id("my1")), "play");
});

clause(JERRY, "0:extraCost", "cost isolated from the threshold: two spent [E] plus two ready resources cannot pay 3", () => {
  const short = jBoard({ ready: [...spentE(2), ...bank("rage", 2, P1)] });
  refused(() => castJ(short), "cost 3 with 2 ready");
  const ok = jBoard({ ready: [...spentE(2), ...bank("rage", 3, P1)] });
  castJ(ok);
  assert.equal(zoneOf(ok.engine, ok.id("j")) === "hand", false);
});

clause(JERRY, "0:extraCost", "the item you control is destroyed as a cost, before the effect resolves", () => {
  const b = jBoard();
  playRaw(b.engine, P1, b.id("j"), { selected: { it: [b.id("my1")] } });
  assert.equal(zoneOf(b.engine, b.id("my1")), "discard", "destroyed already");
});

clause(JERRY, "0:extraCost", "needs an item you control: none, or only non-items / the opponent's items, is refused", () => {
  const none = jBoard({ mine: [] });
  refused(() => play(none.engine, P1, none.id("j"), { selected: {} }), "no item to destroy");
  const wrong = jBoard({
    mine: [{ key: "ch", def: character({ name: "Ch" }), owner: P1, zone: "play" }, { key: "lo", def: location({ name: "Lo" }), owner: P1, zone: "play" }, itm("my1", 1, P1)],
    opp: [itm("op1", 1, P2)]
  });
  refused(() => castJ(wrong, "ch"), "character is not an item");
  refused(() => castJ(wrong, "lo"), "location is not an item");
  refused(() => castJ(wrong, "op1"), "opponent's item");
  assert.equal(zoneOf(wrong.engine, wrong.id("j")), "hand");
  castJ(wrong, "my1");
  assert.equal(zoneOf(wrong.engine, wrong.id("my1")), "discard", "control");
});

clause(JERRY, "1:rule", "search branch: fetches an item whose cost is X+2 or less, where X is the destroyed item's cost", () => {
  const b = jBoard({ mine: [itm("my1", 1, P1)], deck: [itm("i3", 3, P1, "deck"), itm("i0", 0, P1, "deck"), itm("i4", 4, P1, "deck")] });
  castJ(b);
  answerOpt(b, 0);
  answerPick(b, [b.id("i3")]);
  assert.ok(b.engine.state.players[P1].hand.includes(b.id("i3")), "cost 3 = X+2 is allowed");
  assert.ok(!b.engine.state.players[P1].deck.includes(b.id("i3")), "!b.engine.state.players[P1].deck.includes(b.id(\"i3\"))");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("i0")), "deck");
});

clause(JERRY, "1:rule", "search branch: an item costing X+3 is not pickable, a cheaper one is", () => {
  const b = jBoard({ mine: [itm("my1", 1, P1)], deck: [itm("i4", 4, P1, "deck"), itm("i2", 2, P1, "deck")] });
  castJ(b);
  answerOpt(b, 0);
  refused(() => answerPick(b, [b.id("i4")]), "cost 4 > X+2 = 3");
  assert.equal(zoneOf(b.engine, b.id("i4")), "deck");
  answerPick(b, [b.id("i2")]);
  assert.ok(b.engine.state.players[P1].hand.includes(b.id("i2")), "b.engine.state.players[P1].hand.includes(b.id(\"i2\"))");
});

clause(JERRY, "1:rule", "X is the destroyed item's cost: destroying a cost-5 item allows cost 7 but not 8; cost 0 allows 2 but not 3", () => {
  const hi = jBoard({ mine: [itm("my5", 5, P1)], deck: [itm("i7", 7, P1, "deck"), itm("i8", 8, P1, "deck")] });
  castJ(hi, "my5");
  answerOpt(hi, 0);
  refused(() => answerPick(hi, [hi.id("i8")]), "8 > 7");
  answerPick(hi, [hi.id("i7")]);
  assert.ok(hi.engine.state.players[P1].hand.includes(hi.id("i7")), "hi.engine.state.players[P1].hand.includes(hi.id(\"i7\"))");
  const lo = jBoard({ mine: [itm("my0", 0, P1)], deck: [itm("i2", 2, P1, "deck"), itm("i3", 3, P1, "deck")] });
  castJ(lo, "my0");
  answerOpt(lo, 0);
  refused(() => answerPick(lo, [lo.id("i3")]), "3 > 2");
  answerPick(lo, [lo.id("i2")]);
  assert.ok(lo.engine.state.players[P1].hand.includes(lo.id("i2")), "lo.engine.state.players[P1].hand.includes(lo.id(\"i2\"))");
});

clause(JERRY, "1:rule", "search branch: only items from YOUR deck: a character, a location and the opponent's deck item are refused", () => {
  const b = jBoard({
    mine: [itm("my1", 1, P1)],
    deck: [{ key: "dch", def: character({ name: "DeckCh", cost: 0 }), owner: P1, zone: "deck" }, { key: "dlo", def: location({ name: "DeckLo", cost: 0 }), owner: P1, zone: "deck" }, itm("odi", 1, P2, "deck"), itm("ok", 1, P1, "deck")]
  });
  castJ(b);
  answerOpt(b, 0);
  refused(() => answerPick(b, [b.id("dch")]), "character");
  refused(() => answerPick(b, [b.id("dlo")]), "location");
  refused(() => answerPick(b, [b.id("odi")]), "opponent's deck");
  answerPick(b, [b.id("ok")]);
  assert.ok(b.engine.state.players[P1].hand.includes(b.id("ok")), "b.engine.state.players[P1].hand.includes(b.id(\"ok\"))");
});

clause(JERRY, "1:rule", "search branch: the item is revealed", () => {
  const b = jBoard({ deck: [itm("i2", 2, P1, "deck")] });
  castJ(b);
  answerOpt(b, 0);
  answerPick(b, [b.id("i2")]);
  const reveals = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "revealed once");
  assert.deepEqual((reveals[0].event as unknown as { cardIds: string[] }).cardIds, [b.id("i2")]);
});

clause(JERRY, "1:rule", "search branch: no opposing item is destroyed and the rest of the deck stays", () => {
  const b = jBoard({ opp: [itm("op1", 1, P2)], deck: [itm("i2", 2, P1, "deck")] });
  const deckBefore = b.engine.state.players[P1].deck.length;
  castJ(b);
  answerOpt(b, 0);
  answerPick(b, [b.id("i2")]);
  assert.equal(zoneOf(b.engine, b.id("op1")), "play");
  assert.equal(b.engine.state.players[P1].deck.length, deckBefore - 1);
});

clause(JERRY, "1:rule", "you may fail a search for an item (CR 312.2): choosing nothing leaves the deck and hand unchanged", () => {
  const b = jBoard({ deck: [itm("i2", 2, P1, "deck")] });
  const handBefore = [...b.engine.state.players[P1].hand];
  castJ(b);
  answerOpt(b, 0);
  answerPick(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("i2")), "deck", "nothing taken");
  assert.deepEqual(b.engine.state.players[P1].hand.filter((c) => c !== b.id("j")), handBefore.filter((c) => c !== b.id("j")));
});

clause(JERRY, "1:rule", "search branch with no legal item resolves without a stall and fetches nothing", () => {
  const b = jBoard({ deck: [itm("i9", 9, P1, "deck")] });
  castJ(b);
  answerOpt(b, 0);
  if (pending(b.engine)) answerPick(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("i9")), "deck");
  assert.equal(zoneOf(b.engine, b.id("j")), "discard");
});

clause(JERRY, "1:rule", "destroy branch: destroys an opponent's item of cost X+2 or less", () => {
  const b = jBoard({ mine: [itm("my1", 1, P1)], opp: [itm("op3", 3, P2), itm("op4", 4, P2)] });
  castJ(b);
  answerOpt(b, 1);
  answerPick(b, [b.id("op3")]);
  assert.equal(zoneOf(b.engine, b.id("op3")), "discard", "cost 3 = X+2");
  assert.equal(zoneOf(b.engine, b.id("op4")), "play", "the other stays");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(JERRY, "1:rule", "destroy branch: an opposing item costing X+3 is refused", () => {
  const b = jBoard({ mine: [itm("my1", 1, P1)], opp: [itm("op4", 4, P2), itm("op2", 2, P2)] });
  castJ(b);
  answerOpt(b, 1);
  refused(() => answerPick(b, [b.id("op4")]), "cost 4 > 3");
  assert.equal(zoneOf(b.engine, b.id("op4")), "play");
  answerPick(b, [b.id("op2")]);
  assert.equal(zoneOf(b.engine, b.id("op2")), "discard");
});

clause(JERRY, "1:rule", "destroy branch: X comes from the destroyed item (cost 5 reaches 7, not 8)", () => {
  const b = jBoard({ mine: [itm("my5", 5, P1)], opp: [itm("op7", 7, P2), itm("op8", 8, P2)] });
  castJ(b, "my5");
  answerOpt(b, 1);
  refused(() => answerPick(b, [b.id("op8")]), "8 > 7");
  answerPick(b, [b.id("op7")]);
  assert.equal(zoneOf(b.engine, b.id("op7")), "discard");
});

clause(JERRY, "1:rule", "destroy branch: only an OPPONENT's ITEM: your other item, their character and their location are refused", () => {
  const b = jBoard({
    mine: [itm("my1", 1, P1), itm("my2", 1, P1)],
    opp: [{ key: "och", def: character({ name: "OCh", cost: 0 }), owner: P2, zone: "play" }, { key: "olo", def: location({ name: "OLo", cost: 0 }), owner: P2, zone: "play" }, itm("op1", 1, P2)]
  });
  castJ(b);
  answerOpt(b, 1);
  refused(() => answerPick(b, [b.id("my2")]), "your own item");
  refused(() => answerPick(b, [b.id("och")]), "character");
  refused(() => answerPick(b, [b.id("olo")]), "location");
  answerPick(b, [b.id("op1")]);
  assert.equal(zoneOf(b.engine, b.id("op1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("my2")), "play");
  assert.equal(zoneOf(b.engine, b.id("och")), "play");
});

clause(JERRY, "1:rule", "destroy branch: nothing is fetched from the deck", () => {
  const b = jBoard({ opp: [itm("op1", 1, P2)], deck: [itm("i2", 2, P1, "deck")] });
  const handBefore = b.engine.state.players[P1].hand.length;
  castJ(b);
  answerOpt(b, 1);
  answerPick(b, [b.id("op1")]);
  assert.equal(zoneOf(b.engine, b.id("i2")), "deck");
  assert.equal(b.engine.state.players[P1].hand.length, handBefore - 1, "only the tactic left the hand");
});

clause(JERRY, "1:rule", "destroy branch with no legal opposing item resolves without a stall", () => {
  const b = jBoard({ opp: [itm("op9", 9, P2)] });
  castJ(b);
  answerOpt(b, 1);
  if (pending(b.engine)) answerPick(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("op9")), "play");
  assert.equal(zoneOf(b.engine, b.id("j")), "discard");
});

/* ====================================================================== */
/* God's Blessing of Readiness                                            */
/* ====================================================================== */

function rBoard(o: { attached?: string; e?: number; rage?: number; active?: string; turn?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 2,
    activePlayerId: o.active ?? P1,
    cards: [
      o.attached
        ? { key: "bl", def: printing(READY), owner: P1, zone: "play", attachedToKey: o.attached }
        : { key: "bl", def: printing(READY), owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host", strength: 3, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "zero", def: character({ name: "Zero", strength: 0, life: 1, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...bank("elitism", o.e ?? 6, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("e", 3, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
type RB = ReturnType<typeof rBoard>;
const castR = (b: RB, host = "host") => play(b.engine, P1, b.id("bl"), { selected: { attachTo: [b.id(host)] } });
const st = (b: RB, k: string) => [b.engine.getStat(b.id(k), "strength"), b.engine.getStat(b.id(k), "life")];

clause(READY, "0:unique", "is a gearsmith mutation tactic, printed cost 6, threshold eee, UNIQUE BLESSING", () => {
  const p = printing(READY);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "gearsmith");
  assert.deepEqual(p.subtype, ["mutation"]);
  assert.equal(p.cost, 6);
  assert.equal(p.threshold, "eee");
  assert.equal((p as unknown as { unique?: string }).unique, "blessing");
});

clause(READY, "0:unique", "costs exactly 6: castable with 6 resources (all spent), refused with 5", () => {
  const ok = rBoard({ e: 6 });
  castR(ok);
  assert.equal(attachedCount(ok.engine, P1), 6);
  const short = rBoard({ e: 5 });
  refused(() => castR(short), "cost 6, 5 resources");
  assert.equal(zoneOf(short.engine, short.id("bl")), "hand");
});

clause(READY, "0:unique", "threshold eee: three [E] among the six work, two do not", () => {
  const ok = rBoard({ e: 3, rage: 3 });
  castR(ok);
  assert.equal(ok.engine.state.cards[ok.id("bl")].attachedTo, ok.id("host"));
  const short = rBoard({ e: 2, rage: 4 });
  refused(() => castR(short), "ee short of eee", /Threshold requirements are not met/);
  assert.equal(zoneOf(short.engine, short.id("bl")), "hand");
  const none = rBoard({ e: 0, rage: 6 });
  refused(() => castR(none), "no [E]");
});

clause(READY, "0:unique", "you cannot control two BLESSINGs: a second one forces a choice and destroys the other", () => {
  const b = rBoard({ attached: "host", extra: [{ key: "bl2", def: printing(READY), owner: P1, zone: "hand" }, { key: "host2", def: character({ name: "Host2" }), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("bl2"), { selected: { attachTo: [b.id("host2")] } });
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("bl"), b.id("bl2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bl2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("bl2")), "play");
  assert.equal(zoneOf(b.engine, b.id("bl")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(READY, "0:unique", "keeping the old Blessing destroys the new one", () => {
  const b = rBoard({ attached: "host", extra: [{ key: "bl2", def: printing(READY), owner: P1, zone: "hand" }, { key: "host2", def: character({ name: "Host2" }), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("bl2"), { selected: { attachTo: [b.id("host2")] } });
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bl") } } as never);
  assert.equal(zoneOf(b.engine, b.id("bl")), "play");
  assert.equal(zoneOf(b.engine, b.id("bl2")), "discard");
});

clause(READY, "0:unique", "UNIQUE is per player: the opponent may control their own Blessing", () => {
  const b = rBoard({
    attached: "host",
    turn: 3,
    active: P2,
    extra: [{ key: "bl2", def: printing(READY), owner: P2, zone: "hand" }, ...bank("elitism", 6, P2)]
  });
  play(b.engine, P2, b.id("bl2"), { selected: { attachTo: [b.id("foe")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("bl")), "play");
  assert.equal(zoneOf(b.engine, b.id("bl2")), "play");
});

clause(READY, "1:attach", "attaches to the chosen character and stays in play attached", () => {
  const b = rBoard();
  castR(b);
  assert.equal(zoneOf(b.engine, b.id("bl")), "play");
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("host"));
});

clause(READY, "1:attach", "any character may host it, including an opponent's", () => {
  const b = rBoard();
  castR(b, "foe");
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("foe"));
});

clause(READY, "1:attach", "cannot attach to a non-character", () => {
  const b = rBoard({ extra: [{ key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" }, { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" }] });
  refused(() => castR(b, "itm"), "item host");
  refused(() => castR(b, "loc"), "location host");
  assert.equal(zoneOf(b.engine, b.id("bl")), "hand");
  castR(b);
  assert.equal(b.engine.state.cards[b.id("bl")].attachedTo, b.id("host"), "control");
});

clause(READY, "2:rule", "the text applies only while attached: nothing changes before it is cast, the aura is on after", () => {
  const b = rBoard();
  assert.deepEqual(st(b, "ally"), [2, 4]);
  castR(b);
  assert.deepEqual(st(b, "ally"), [1, 5]);
});

clause(READY, "2:rule", "the text is gone when the Blessing is destroyed, and stays gone", () => {
  const b = rBoard({ attached: "host", extra: [{ key: "sm", def: smash(), owner: P1, zone: "hand" }] });
  assert.deepEqual(st(b, "ally"), [1, 5]);
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("bl")] } });
  assert.equal(zoneOf(b.engine, b.id("bl")), "discard");
  assert.deepEqual(st(b, "ally"), [2, 4]);
  assert.deepEqual(st(b, "ally"), [2, 4]);
});

clause(READY, "2:rule", "the text leaves with the host: destroying the host removes the aura", () => {
  const b = rBoard({ attached: "host", extra: [{ key: "sm", def: smash(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("bl")), "discard");
  assert.deepEqual(st(b, "ally"), [2, 4]);
});

clause(READY, "3.0:grant-rule", "all your characters (host included) lose 1 strength and gain 1 life", () => {
  const b = rBoard({ attached: "host" });
  assert.deepEqual(st(b, "host"), [2, 6]);
  assert.deepEqual(st(b, "ally"), [1, 5]);
  assert.equal(b.engine.getStat(b.id("host"), "speed"), 2, "speed untouched");
});

clause(READY, "3.0:grant-rule", "the opponent's characters are not affected", () => {
  const b = rBoard({ attached: "host" });
  assert.deepEqual(st(b, "foe"), [2, 4]);
});

clause(READY, "3.0:grant-rule", "strength cannot go below 0", () => {
  const b = rBoard({ attached: "host" });
  assert.deepEqual(st(b, "zero"), [0, 2]);
});

clause(READY, "3.0:grant-rule", "only characters: a non-character you control is unaffected", () => {
  const b = rBoard({ attached: "host", extra: [{ key: "itm", def: item({ name: "Itm", life: 3 } as never), owner: P1, zone: "play" }] });
  assert.equal(b.engine.getStat(b.id("itm"), "life"), 3);
});

clause(READY, "3.0:grant-rule", "a character entering later is also affected", () => {
  const b = rBoard({ attached: "host", e: 6, extra: [{ key: "late", def: character({ name: "Late", strength: 4, life: 2, speed: 1, cost: 0 }), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("late"), {});
  assert.deepEqual(st(b, "late"), [3, 3]);
});

clause(READY, "3.0:grant-rule", "attached to an opponent's character, the text's \"your\" is that character's controller", () => {
  const b = rBoard();
  castR(b, "foe");
  assert.deepEqual(st(b, "foe"), [1, 5], "the host's controller's characters change");
  assert.deepEqual(st(b, "ally"), [2, 4], "the caster's characters do not");
});

function turnStart(b: RB, active: string) {
  endTurn(b.engine, active);
}

clause(READY, "3.1:grant-rule", "at the start of each opponent's turn your depleted characters are restored", () => {
  const b = rBoard({ attached: "host" });
  for (const k of ["host", "ally", "zero"]) b.engine.state.cards[b.id(k)].depleted = true;
  turnStart(b, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  if (pending(b.engine)) drain(b.engine, () => ({ kind: "chooserSelectsOption", index: 0 }));
  for (const k of ["host", "ally", "zero"]) assert.equal(b.engine.state.cards[b.id(k)].depleted, false, `${k} restored`);
});

clause(READY, "3.1:grant-rule", "it restores only characters: a depleted item you control stays depleted", () => {
  const b = rBoard({ attached: "host", extra: [{ key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play", depleted: true }] });
  b.engine.state.cards[b.id("host")].depleted = true;
  turnStart(b, P1);
  if (pending(b.engine)) drain(b.engine, () => ({ kind: "chooserSelectsOption", index: 0 }));
  assert.equal(b.engine.state.cards[b.id("host")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("itm")].depleted, true);
});

clause(READY, "3.1:grant-rule", "\"you may\": the restore is optional, so it is offered and declining leaves the characters depleted", () => {
  const b = rBoard({ attached: "host" });
  for (const k of ["host", "ally"]) b.engine.state.cards[b.id(k)].depleted = true;
  turnStart(b, P1);
  assert.ok(pending(b.engine), "a may-prompt is offered");
  drain(b.engine, (pc) => (pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 1 } : { kind: pc.kind, selected: [] }));
  for (const k of ["host", "ally"]) assert.equal(b.engine.state.cards[b.id(k)].depleted, true, `${k} stays depleted`);
});

clause(READY, "3.1:grant-rule", "it does not trigger at the start of your own turn", () => {
  const b = rBoard({ attached: "host", active: P2, turn: 3 });
  for (const k of ["host", "ally"]) b.engine.state.cards[b.id(k)].depleted = true;
  turnStart(b, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.pendingChoice, undefined, "no trigger at my own turn start");
});

clause(READY, "3.1:grant-rule", "it ends when the Blessing leaves play: no restore at the opponent's next turn start", () => {
  const b = rBoard({ attached: "host", extra: [{ key: "sm", def: smash(), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("sm"), { selected: { t: [b.id("bl")] } });
  b.engine.state.cards[b.id("ally")].depleted = true;
  turnStart(b, P1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("ally")].depleted, true);
});

/* ---- additions from the mutation pass ---- */

function openPrompt(b: { engine: Engine }, first: "harvest" | "reforge", declId: string, active: string = P2): Pc {
  endTurn(b.engine, active);
  let pc = pending(b.engine) as unknown as Pc;
  while (pc.kind === "orderTriggers") {
    b.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: pc.triggers!.find((t) => t.abilityId === first) } } as never);
    pc = pending(b.engine) as unknown as Pc;
  }
  assert.equal(pc.declaration!.id, declId);
  return pc;
}
const sel = (b: { engine: Engine }, selected: string[]) =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);

clause(CM, "2:rule", "you play ONE resource, not two", () => {
  const b = cmTurn({ extra: [{ key: "hres2", def: resourceCard({ name: "HandRes2" }), owner: P1, zone: "hand" }] });
  openPrompt(b, "harvest", "r");
  refused(() => sel(b, [b.id("hres"), b.id("hres2")]), "two resources");
  assert.equal(zoneOf(b.engine, b.id("hres")), "hand");
  assert.equal(zoneOf(b.engine, b.id("hres2")), "hand");
  sel(b, [b.id("hres2")]);
  assert.equal(zoneOf(b.engine, b.id("hres2")), "play", "control: one works");
  assert.equal(zoneOf(b.engine, b.id("hres")), "hand");
});

clause(CM, "2:rule", "the resource enters play face up (it provides its own icon, not Volition)", () => {
  const b = cmTurn();
  startTurn(b, { r: [b.id("hres")] });
  assert.notEqual(b.engine.state.cards[b.id("hres")].faceDown, true);
});

clause(CM, "3:rule", "you destroy ONE card, not two", () => {
  const b = cmTurn({ e: 2 });
  openPrompt(b, "reforge", "e");
  refused(() => sel(b, [b.id(b.e[0]), b.id(b.e[1])]), "two [E] cards");
  assert.equal(zoneOf(b.engine, b.id(b.e[0])), "play");
  assert.equal(zoneOf(b.engine, b.id(b.e[1])), "play");
});

clause(CM, "3:rule", "\"search your deck for a card\" must find one: choosing nothing is refused", () => {
  const b = cmTurn({ e: 1 });
  openPrompt(b, "reforge", "e");
  sel(b, [b.id(b.e[0])]);
  // Destroying the Elitism card sets off the sibling start-of-turn trigger ("you may play a resource"),
  // whose prompt now surfaces (it used to be overwritten and lost) before the search prompt: decline it.
  if ((pending(b.engine) as unknown as Pc).declaration!.id === "r") sel(b, []);
  const pc = pending(b.engine) as unknown as Pc;
  assert.equal(pc.declaration!.id, "__s");
  refused(() => sel(b, []), "an unconditional search finds a card (CR 312.2)");
  sel(b, [b.id("titem")]);
  assert.ok(b.engine.state.players[P1].hand.includes(b.id("titem")), "control");
});

clause(JERRY, "1:rule", "destroy branch: with a legal opposing item you must choose one (\"destroy an item\" is not optional)", () => {
  const b = jBoard({ opp: [itm("op1", 1, P2)] });
  castJ(b);
  answerOpt(b, 1);
  refused(() => answerPick(b, []), "picking nothing");
  assert.equal(zoneOf(b.engine, b.id("op1")), "play");
  answerPick(b, [b.id("op1")]);
  assert.equal(zoneOf(b.engine, b.id("op1")), "discard", "control");
});

clause(READY, "3.0:grant-rule", "an item you control keeps its strength too (characters only)", () => {
  const b = rBoard({ attached: "host", extra: [{ key: "itm", def: item({ name: "StrItm", strength: 3, life: 3 } as never), owner: P1, zone: "play" }] });
  assert.equal(b.engine.getStat(b.id("itm"), "strength"), 3);
});

/** The faction's own Restore Rule is a trigger too ("Restore Rule" resolves): only the cards' triggers are counted here. */
const isFactionRule = (message: string): boolean => /"Restore Rule"|"Develop Rule"/.test(message);

function restoredByTriggers(engine: Engine): string[] {
  const out: string[] = [];
  let inTrigger = false;
  for (const entry of engine.getLog()) {
    if (entry.marker === "triggerResolving") inTrigger = !isFactionRule(entry.message);
    else if (inTrigger && entry.event?.type === "cardRestored") out.push((entry.event as unknown as { cardId: string }).cardId);
    else inTrigger = false;
  }
  return out;
}

clause(READY, "3.1:grant-rule", "the trigger does not fire at your own turn start (no restore effect resolves)", () => {
  const b = rBoard({ attached: "host", active: P2, turn: 3 });
  for (const k of ["host", "ally"]) b.engine.state.cards[b.id(k)].depleted = true;
  turnStart(b, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.deepEqual(restoredByTriggers(b.engine), []);
  assert.equal(b.engine.getLog().filter((e) => e.marker === "triggerResolving" && !isFactionRule(e.message)).length, 0, "the Blessing's trigger never resolves at my own turn start");
});

clause(READY, "3.1:grant-rule", "only characters YOU control are restored: the opponent's depleted character is not restored by the trigger", () => {
  const b = rBoard({ attached: "host" });
  for (const k of ["host", "ally"]) b.engine.state.cards[b.id(k)].depleted = true;
  b.engine.state.cards[b.id("foe")].depleted = true;
  turnStart(b, P1);
  if (pending(b.engine)) drain(b.engine, () => ({ kind: "chooserSelectsOption", index: 0 }));
  const restored = restoredByTriggers(b.engine);
  assert.deepEqual([...restored].sort(), [b.id("host"), b.id("ally")].sort());
});
