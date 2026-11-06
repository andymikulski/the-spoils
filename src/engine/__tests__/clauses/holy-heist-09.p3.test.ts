// Clause tests: holy-heist-09 part p3 (groups 7-8, missing clauses).
// The Primitive Tribes of Thabbash (tactic redirect rule, FLIP UP tax rule), Micromajig (vanilla, 9 printings).

import assert from "node:assert/strict";
import { buildGame, answer, bank, character, developFaction, item, resolvePendingResponses, tactic, P1, P2, play, activate } from "../per-card/_harness.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { zoneOf } from "./_board.js";
import { fight } from "./_battle.js";
import { attachedCount } from "./_turn.js";
import type { SpoilsEngine } from "../../../engine.js";

const PRIMITIVE = "94296fb0-a890-4503-8146-9c7cacc079d0";
const HASTY = "8f8af0b4-2e83-48e5-9c84-4fdcecfbbbd1"; // tactic, cost 2 [E][E][E], FLIP UP 4 [E][E][E]
const MEH = "ac36f169-a54b-4992-aa1e-b9a4cf2aac70"; // character, cost 8 [O], FLIP UP 7 [O]

const ready = (engine: SpoilsEngine, p: string = P1) => engine.getAvailableResourceCount(p as never);

// ===============================================================================
// Rule: If you deployed a tactic and it would go to a discard pile, you may pay 3.
// If you do, put that tactic into play under its owner's control as a face-down
// resource instead of into their discard pile. Attached it to their faction.
// ===============================================================================

function redirectBoard(opts: { rage?: number; second?: boolean; active?: string; tacticOwner?: string; bFaction?: "primitive" | "dev" } = {}) {
  const active = (opts.active ?? P1) as never;
  return buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    playerB: { faction: opts.bFaction === "primitive" ? printing(PRIMITIVE) : developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "t", def: tactic({ name: "Zap", cost: 1 }), owner: (opts.tacticOwner ?? opts.active ?? P1) as never, controller: (opts.active ?? P1) as never, zone: "hand" },
      { key: "ch", def: character({ name: "Hand Char", cost: 1 }), owner: P1, zone: "hand" },
      { key: "disc", def: item({ name: "Discarder", cost: 0, behavior: { abilities: [{ id: "dd", type: "activated", costs: [{ type: "discard", id: "d", player: "controller", selector: { owner: "self", zone: "hand" }, count: 1 }], effects: [] }] } }), owner: P1, zone: "play" },
      { key: "foeChar", def: character({ name: "Foe", cost: 0, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 4, active)
    ]
  });
}
const spentBanks = (engine: SpoilsEngine, except: string) => engine.state.players[P1].play.filter((c) => c !== except && engine.isResource(c) && engine.state.cards[c].attachedTo === engine.state.players[P1].factionId).length;
const pcKind = (engine: SpoilsEngine) => (engine.state.pendingChoice as unknown as { kind?: string } | undefined)?.kind;

clause(PRIMITIVE, "6:rule", "deploying a tactic offers a 'may pay 3' choice to its controller; paying puts that tactic into play face-down instead of the discard pile", () => {
  const { engine, id } = redirectBoard({ rage: 4 });
  play(engine, P1, id("t"), {});
  assert.equal(pcKind(engine), "mayPay", "offered the payment");
  assert.equal((engine.state.pendingChoice as unknown as { playerId: string }).playerId, P1);
  answer(engine, P1, { kind: "mayPay", pay: true } as never);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("t")), "play", "in play, not in a discard pile");
  assert.equal(engine.state.cards[id("t")].faceDown, true, "face-down");
  assert.equal(engine.isResource(id("t")), true, "as a resource");
  assert.equal(engine.state.players[P1].discard.includes(id("t")), false, "not in the discard pile");
  assert.equal(engine.state.players[P1].play.includes(id("t")), true);
});

clause(PRIMITIVE, "6:rule", "the 3 is actually paid on top of the tactic's own cost 1: all 4 banks are spent", () => {
  const { engine, id } = redirectBoard({ rage: 4 });
  play(engine, P1, id("t"), {});
  assert.equal(ready(engine), 3, "tactic cost 1 paid before the choice");
  answer(engine, P1, { kind: "mayPay", pay: true } as never);
  assert.equal(spentBanks(engine, id("t")), 4, "3 more paid: all 4 banks spent");
});

clause(PRIMITIVE, "6:rule", "declining the payment leaves the tactic in the discard pile, pays nothing, and creates no resource", () => {
  const { engine, id } = redirectBoard({ rage: 4 });
  play(engine, P1, id("t"), {});
  answer(engine, P1, { kind: "mayPay", pay: false } as never);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("t")), "discard");
  assert.equal(engine.state.players[P1].discard.includes(id("t")), true);
  assert.equal(engine.state.players[P1].play.includes(id("t")), false);
  assert.equal(ready(engine), 3, "only the tactic's own cost 1 was paid");
});

clause(PRIMITIVE, "6:rule", "cost is exactly 3: with 4 banks (3 left after the tactic) the payment works; with 3 banks (2 left) it cannot be paid and the tactic stays in the discard pile", () => {
  const ok = redirectBoard({ rage: 4 });
  play(ok.engine, P1, ok.id("t"), {});
  answer(ok.engine, P1, { kind: "mayPay", pay: true } as never);
  assert.equal(zoneOf(ok.engine, ok.id("t")), "play", "exactly 3 left is enough");
  const short = redirectBoard({ rage: 3 });
  play(short.engine, P1, short.id("t"), {});
  if (short.engine.state.pendingChoice) answer(short.engine, P1, { kind: "mayPay", pay: true } as never);
  assert.equal(short.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(short.engine, short.id("t")), "discard", "2 left is one short of 3");
  assert.equal(ready(short.engine), 2, "nothing extra was paid");
});

clause(PRIMITIVE, "6:rule", "the tactic's own effect still resolves before it is redirected (Hasty draws a card, then goes face-down)", () => {
  const g = buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    cards: [
      { key: "hp", def: printing(HASTY), owner: P1, zone: "hand" },
      ...bank("elitism", 5, P1),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Deck${i}` }), owner: P1, zone: "deck" as const }))
    ]
  });
  play(g.engine, P1, g.id("hp"), {});
  if (pcKind(g.engine) !== "mayPay") assert.fail(`expected mayPay, got ${pcKind(g.engine)}`);
  answer(g.engine, P1, { kind: "mayPay", pay: true } as never);
  assert.equal(g.engine.state.players[P1].hand.length, 1, "drew a card from its text");
  assert.equal(zoneOf(g.engine, g.id("hp")), "play");
  assert.equal(g.engine.state.cards[g.id("hp")].faceDown, true);
  assert.equal(spentBanks(g.engine, g.id("hp")), 5, "2 + 3 paid from 5 banks");
});

clause(PRIMITIVE, "6:rule", "under its owner's control: a tactic owned by the opponent but deployed by me enters play under the opponent's control, attached to THEIR faction", () => {
  const { engine, id } = redirectBoard({ rage: 4, tacticOwner: P2 });
  play(engine, P1, id("t"), {});
  assert.equal(pcKind(engine), "mayPay");
  answer(engine, P1, { kind: "mayPay", pay: true } as never);
  assert.equal(zoneOf(engine, id("t")), "play");
  assert.equal(engine.state.cards[id("t")].controllerId, P2, "under its owner's control");
  assert.equal(engine.state.cards[id("t")].ownerId, P2);
  assert.equal(engine.state.players[P2].discard.includes(id("t")), false);
});

clause(PRIMITIVE, "6:rule", "'If you deployed': the opponent's tactic going to their discard pile gives me no payment choice", () => {
  const b2 = buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "t2", def: tactic({ name: "Zap2", cost: 1 }), owner: P2, zone: "hand" },
      ...bank("rage", 4, P2),
      ...bank("rage", 4, P1)
    ]
  });
  play(b2.engine, P2, b2.id("t2"), {});
  assert.equal(b2.engine.state.pendingChoice, undefined, "no choice for me");
  assert.equal(zoneOf(b2.engine, b2.id("t2")), "discard");
});

clause(PRIMITIVE, "6:rule", "the redirected tactic is attached to their faction (spent), as printed", () => {
  const { engine, id } = redirectBoard({ rage: 4 });
  play(engine, P1, id("t"), {});
  answer(engine, P1, { kind: "mayPay", pay: true } as never);
  assert.equal(engine.state.cards[id("t")].attachedTo, engine.state.players[P1].factionId, "Attached it to their faction");
  assert.equal(attachedCount(engine, P1), 5, "4 spent banks plus the attached tactic");
  assert.equal(ready(engine), 0, "it arrives attached, so no ready resource");
});

clause(PRIMITIVE, "6:rule", "owner's faction: an opponent-owned tactic is attached to THEIR faction", () => {
  const { engine, id } = redirectBoard({ rage: 4, tacticOwner: P2 });
  play(engine, P1, id("t"), {});
  answer(engine, P1, { kind: "mayPay", pay: true } as never);
  assert.equal(engine.state.cards[id("t")].attachedTo, engine.state.players[P2].factionId);
});
clause(PRIMITIVE, "6:rule", "the rule belongs to the Primitive faction's controller only: without it a deployed tactic simply goes to the discard pile", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "t", def: tactic({ name: "Zap", cost: 1 }), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
  });
  play(g.engine, P1, g.id("t"), {});
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("t")), "discard");
});

clause(PRIMITIVE, "6:rule", "the opponent's own Primitive faction works for them: each player's rule applies to the tactics THEY deployed", () => {
  const g = buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    playerB: { faction: printing(PRIMITIVE) },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "t2", def: tactic({ name: "Zap2", cost: 1 }), owner: P2, zone: "hand" },
      ...bank("rage", 4, P2),
      ...bank("rage", 4, P1)
    ]
  });
  play(g.engine, P2, g.id("t2"), {});
  assert.equal(pcKind(g.engine), "mayPay");
  assert.equal((g.engine.state.pendingChoice as unknown as { playerId: string }).playerId, P2, "offered to the deployer, not the other Primitive player");
  answer(g.engine, P2, { kind: "mayPay", pay: true } as never);
  assert.equal(zoneOf(g.engine, g.id("t2")), "play");
  assert.equal(g.engine.state.cards[g.id("t2")].controllerId, P2);
  assert.equal(ready(g.engine, P1), 4, "my resources were untouched");
});

clause(PRIMITIVE, "6:rule", "a non-tactic going to the discard pile (a character discarded from hand as a cost) offers no payment", () => {
  const { engine, id } = redirectBoard({ rage: 4 });
  activate(engine, P1, id("disc"), "dd", { selected: { d: [id("ch")] } });
  assert.equal(zoneOf(engine, id("ch")), "discard", "the character was discarded");
  assert.equal(engine.state.pendingChoice, undefined, "no payment choice for a character");
  assert.equal(engine.state.cards[id("ch")].faceDown, false);
});

clause(PRIMITIVE, "6:rule", "'If you deployed a tactic': a tactic discarded from hand without being deployed is NOT redirected", () => {
  const { engine, id } = redirectBoard({ rage: 4 });
  activate(engine, P1, id("disc"), "dd", { selected: { d: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "discard", "discarded from hand");
  assert.equal(engine.state.pendingChoice, undefined, "it was never deployed, so there is no payment offer");
});

// ===============================================================================
// Rule: You must pay 2 to deploy tactics using FLIP UP.
// ===============================================================================

function flipBoard(opts: { faction: "primitive" | "dev"; elitism?: number; rage?: number; hastyFirst?: boolean; oppFaction?: "primitive" | "dev" }) {
  return buildGame({
    playerA: { faction: opts.faction === "primitive" ? printing(PRIMITIVE) : developFaction() },
    playerB: { faction: opts.oppFaction === "primitive" ? printing(PRIMITIVE) : developFaction() },
    turn: 1,
    cards: [
      { key: "hp", def: printing(HASTY), owner: P1, zone: "play", faceDown: true },
      ...bank("elitism", opts.elitism ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Deck${i}` }), owner: P1, zone: "deck" as const }))
    ]
  });
}
type FlipGame = ReturnType<typeof flipBoard>;
const flip = (g: FlipGame, key = "hp") => {
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id(key), selected: {}, variables: {} });
  if (pcKind(g.engine) === "chooserSelectsTarget") answer(g.engine, P1, { kind: "chooserSelectsTarget", selected: [] } as never);
  resolvePendingResponses(g.engine);
};

clause(PRIMITIVE, "7:rule", "FLIP UP of a tactic costs 2 more: Hasty (FLIP UP 4) costs 6 under Primitive: 5 banks plus itself pay exactly 6", () => {
  const g = flipBoard({ faction: "primitive", elitism: 5 });
  assert.equal(ready(g.engine), 6, "5 banks and the face-down tactic");
  flip(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.notEqual(g.engine.state.cards[g.id("hp")].faceDown, true, "flipped up");
  assert.equal(ready(g.engine), 0, "all 6 resources used");
  assert.equal(attachedCount(g.engine, P1), 5, "5 banks spent");
});

clause(PRIMITIVE, "7:rule", "refused one resource short (4 banks plus itself is 5, not 6): nothing is paid and it stays face-down", () => {
  const g = buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    cards: [{ key: "hp", def: printing(HASTY), owner: P1, zone: "play", faceDown: true }, ...bank("elitism", 4, P1)]
  });
  refused(() => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("hp"), selected: {}, variables: {} }), "5 resources of 6", /resource|afford|cost|threshold/i);
  assert.equal(g.engine.state.cards[g.id("hp")].faceDown, true);
  assert.equal(ready(g.engine), 5, "nothing was paid");
});

clause(PRIMITIVE, "7:rule", "the tax is on top of the printed cost, not instead: the same 4 banks without the Primitive faction flip Hasty fine (positive control)", () => {
  const dev = flipBoard({ faction: "dev", elitism: 3 });
  flip(dev);
  assert.notEqual(dev.engine.state.cards[dev.id("hp")].faceDown, true, "3 banks plus itself pay FLIP UP 4");
  assert.equal(ready(dev.engine), 0);
  const devShort = flipBoard({ faction: "dev", elitism: 2 });
  refused(() => flipUpNow(devShort.engine, { type: "flipUp", playerId: P1, cardId: devShort.id("hp"), selected: {}, variables: {} }), "3 of 4", /resource|afford|cost|threshold/i);
  const prim4 = flipBoard({ faction: "primitive", elitism: 3 });
  refused(() => flipUpNow(prim4.engine, { type: "flipUp", playerId: P1, cardId: prim4.id("hp"), selected: {}, variables: {} }), "the same 3 banks are 2 short under Primitive", /resource|afford|cost|threshold/i);
  assert.equal(prim4.engine.state.cards[prim4.id("hp")].faceDown, true);
});

clause(PRIMITIVE, "7:rule", "the tax adds only generic cost: the [E][E][E] threshold is unchanged (3 Elitism + 3 Rage works; 2 Elitism + 4 Rage is refused)", () => {
  const ok = flipBoard({ faction: "primitive", elitism: 3, rage: 3 });
  flip(ok);
  assert.notEqual(ok.engine.state.cards[ok.id("hp")].faceDown, true);
  const noThreshold = flipBoard({ faction: "primitive", elitism: 2, rage: 4 });
  refused(() => flipUpNow(noThreshold.engine, { type: "flipUp", playerId: P1, cardId: noThreshold.id("hp"), selected: {}, variables: {} }), "7 resources but only two E", /threshold|icon|elitism|cost/i);
  assert.equal(noThreshold.engine.state.cards[noThreshold.id("hp")].faceDown, true);
});

clause(PRIMITIVE, "7:rule", "'deploy tactics using FLIP UP' only: deploying the same tactic from hand costs its normal 2 (no tax)", () => {
  const g = buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    cards: [
      { key: "hp", def: printing(HASTY), owner: P1, zone: "hand" },
      ...bank("elitism", 3, P1),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `dk${i}`, def: character({ name: `Deck${i}` }), owner: P1, zone: "deck" as const }))
    ]
  });
  play(g.engine, P1, g.id("hp"), {});
  if (pcKind(g.engine) === "mayPay") answer(g.engine, P1, { kind: "mayPay", pay: false } as never);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("hp")), "discard", "deployed");
  assert.equal(ready(g.engine), 1, "3 banks minus the printed cost 2: no tax");
});

clause(PRIMITIVE, "7:rule", "only tactics are taxed: FLIP UP of a character (Meh, FLIP UP 7 [O]) is 7, not 9", () => {
  const mk = (n: number) => buildGame({
    playerA: { faction: printing(PRIMITIVE) },
    cards: [{ key: "meh", def: printing(MEH), owner: P1, zone: "play", faceDown: true }, ...bank("obsession", n, P1)]
  });
  const ok = mk(6);
  flipUpNow(ok.engine, { type: "flipUp", playerId: P1, cardId: ok.id("meh"), selected: {}, variables: {} });
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("meh")].faceDown, false, "6 banks plus itself pay exactly 7");
  assert.equal(ready(ok.engine), 0);
  const short = mk(5);
  refused(() => flipUpNow(short.engine, { type: "flipUp", playerId: P1, cardId: short.id("meh"), selected: {}, variables: {} }), "6 resources of 7", /resource|afford|cost|threshold/i);
});

clause(PRIMITIVE, "7:rule", "'You must pay': the opponent's Primitive faction does not tax MY tactic FLIP UP", () => {
  const g = flipBoard({ faction: "dev", elitism: 3, oppFaction: "primitive" });
  flip(g);
  assert.notEqual(g.engine.state.cards[g.id("hp")].faceDown, true, "3 banks plus itself pay 4");
  assert.equal(ready(g.engine), 0);
});

// ===============================================================================
// Micromajig â€” vanilla. Character (majig), Gearsmith, cost 0, 1 strength / 3 speed / 1 life.
// ===============================================================================

function micromajig(ID: string) {
  const board = () => buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: [{ key: "mm", def: printing(ID), owner: P1, zone: "hand" }]
  });
  return {
    cost: () => {
      const { engine, id } = board();
      assert.equal(ready(engine), 0, "no resources at all");
      play(engine, P1, id("mm"), {});
      assert.equal(zoneOf(engine, id("mm")), "play", "deploys for its printed cost of 0");
      assert.equal(engine.state.cards[id("mm")].controllerId, P1);
      assert.equal(engine.state.pendingChoice, undefined);
    },
    stats: () => {
      const { engine, id } = board();
      play(engine, P1, id("mm"), {});
      assert.equal(engine.getStat(id("mm"), "strength"), 1);
      assert.equal(engine.getStat(id("mm"), "speed"), 3);
      assert.equal(engine.getStat(id("mm"), "life"), 1);
    },
    identity: () => {
      const { engine, id } = board();
      play(engine, P1, id("mm"), {});
      assert.deepEqual(engine.getCardTypes(id("mm")), ["character"]);
      assert.deepEqual(engine.getSubtypes(id("mm")), ["majig"]);
      assert.equal(engine.getDefinition(id("mm")).trade, "gearsmith");
      assert.deepEqual(engine.getKeywords(id("mm")), [], "no keywords");
      assert.equal(engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === id("mm")).length, 0, "no abilities");
      assert.equal(engine.state.cards[id("mm")].depleted, false);
    },
    damage: () => {
      const g = buildGame({
        playerA: { faction: developFaction() },
        playerB: { faction: developFaction() },
        turn: 1,
        cards: [{ key: "mm", def: printing(ID), owner: P1, zone: "play" }]
      });
      const before = g.engine.state.players[P2].influence;
      fight(g.engine, P1, [g.id("mm")], { type: "faction", playerId: P2 }, []);
      assert.equal(before - g.engine.state.players[P2].influence, 1, "1 strength of battle damage");
    }  };
}

for (const ID of [
  "60e8c57d-7aca-47ca-8f9c-501f2c924ead", "5236666d-2501-4a39-a589-65411db5b9b4", "bda66736-27d7-485d-ad43-9f2e59c0728a",
  "19dd7e78-ae75-4dc8-8e3b-ca23319af6ad", "b2a14305-5ac6-4b72-bc54-5195ba611a30", "b7e98afc-099c-43e5-b6a4-1c4a50ecfc0f",
  "0e6035a3-f04a-4f2c-bdc4-7f472c1aff97", "422d34c7-653e-498a-a0b1-e16db17e0841", "91fffae8-ab15-43a2-90ac-48ef49f9f039"
]) void ID;

const MM1 = "60e8c57d-7aca-47ca-8f9c-501f2c924ead";
const MM2 = "5236666d-2501-4a39-a589-65411db5b9b4";
const MM3 = "bda66736-27d7-485d-ad43-9f2e59c0728a";
const MM4 = "19dd7e78-ae75-4dc8-8e3b-ca23319af6ad";
const MM5 = "b2a14305-5ac6-4b72-bc54-5195ba611a30";
const MM6 = "b7e98afc-099c-43e5-b6a4-1c4a50ecfc0f";
const MM7 = "0e6035a3-f04a-4f2c-bdc4-7f472c1aff97";
const MM8 = "422d34c7-653e-498a-a0b1-e16db17e0841";
const MM9 = "91fffae8-ab15-43a2-90ac-48ef49f9f039";

function vanillaTests(ID: string) {
  const m = micromajig(ID);
  return { m };
}
void vanillaTests;

clause(MM1, "vanilla", "deploys for its printed cost of 0 with no resources", micromajig(MM1).cost);
clause(MM1, "vanilla", "has its printed stats 1 strength / 3 speed / 1 life", micromajig(MM1).stats);
clause(MM1, "vanilla", "is a Gearsmith majig character with no keywords or abilities", micromajig(MM1).identity);
clause(MM1, "vanilla", "attacking unblocked deals its 1 strength to the faction", micromajig(MM1).damage);
clause(MM2, "vanilla", "deploys for its printed cost of 0 with no resources", micromajig(MM2).cost);
clause(MM2, "vanilla", "has its printed stats 1 strength / 3 speed / 1 life", micromajig(MM2).stats);
clause(MM2, "vanilla", "is a Gearsmith majig character with no keywords or abilities", micromajig(MM2).identity);
clause(MM2, "vanilla", "attacking unblocked deals its 1 strength to the faction", micromajig(MM2).damage);
clause(MM3, "vanilla", "deploys for its printed cost of 0 with no resources", micromajig(MM3).cost);
clause(MM3, "vanilla", "has its printed stats 1 strength / 3 speed / 1 life", micromajig(MM3).stats);
clause(MM3, "vanilla", "is a Gearsmith majig character with no keywords or abilities", micromajig(MM3).identity);
clause(MM3, "vanilla", "attacking unblocked deals its 1 strength to the faction", micromajig(MM3).damage);
clause(MM4, "vanilla", "deploys for its printed cost of 0 with no resources", micromajig(MM4).cost);
clause(MM4, "vanilla", "has its printed stats 1 strength / 3 speed / 1 life", micromajig(MM4).stats);
clause(MM4, "vanilla", "is a Gearsmith majig character with no keywords or abilities", micromajig(MM4).identity);
clause(MM4, "vanilla", "attacking unblocked deals its 1 strength to the faction", micromajig(MM4).damage);
clause(MM5, "vanilla", "deploys for its printed cost of 0 with no resources", micromajig(MM5).cost);
clause(MM5, "vanilla", "has its printed stats 1 strength / 3 speed / 1 life", micromajig(MM5).stats);
clause(MM5, "vanilla", "is a Gearsmith majig character with no keywords or abilities", micromajig(MM5).identity);
clause(MM5, "vanilla", "attacking unblocked deals its 1 strength to the faction", micromajig(MM5).damage);
clause(MM6, "vanilla", "deploys for its printed cost of 0 with no resources", micromajig(MM6).cost);
clause(MM6, "vanilla", "has its printed stats 1 strength / 3 speed / 1 life", micromajig(MM6).stats);
clause(MM6, "vanilla", "is a Gearsmith majig character with no keywords or abilities", micromajig(MM6).identity);
clause(MM6, "vanilla", "attacking unblocked deals its 1 strength to the faction", micromajig(MM6).damage);
clause(MM7, "vanilla", "deploys for its printed cost of 0 with no resources", micromajig(MM7).cost);
clause(MM7, "vanilla", "has its printed stats 1 strength / 3 speed / 1 life", micromajig(MM7).stats);
clause(MM7, "vanilla", "is a Gearsmith majig character with no keywords or abilities", micromajig(MM7).identity);
clause(MM7, "vanilla", "attacking unblocked deals its 1 strength to the faction", micromajig(MM7).damage);
clause(MM8, "vanilla", "deploys for its printed cost of 0 with no resources", micromajig(MM8).cost);
clause(MM8, "vanilla", "has its printed stats 1 strength / 3 speed / 1 life", micromajig(MM8).stats);
clause(MM8, "vanilla", "is a Gearsmith majig character with no keywords or abilities", micromajig(MM8).identity);
clause(MM8, "vanilla", "attacking unblocked deals its 1 strength to the faction", micromajig(MM8).damage);
clause(MM9, "vanilla", "deploys for its printed cost of 0 with no resources", micromajig(MM9).cost);
clause(MM9, "vanilla", "has its printed stats 1 strength / 3 speed / 1 life", micromajig(MM9).stats);
clause(MM9, "vanilla", "is a Gearsmith majig character with no keywords or abilities", micromajig(MM9).identity);
clause(MM9, "vanilla", "attacking unblocked deals its 1 strength to the faction", micromajig(MM9).damage);


