// Clause tests, batch seed-saga-11, part p2 (groups 6-12, missing clauses only):
// Adriel Defender of Marduun, Adriel Supreme General, Aroused Stiffbone, Ascendant Madcap,
// Balking Foecrusher, Barrier of Benevolence, Boilstorm.
// Every expectation is read from the PRINTED text.

import assert from "node:assert/strict";
import { buildGame, activate, character, developFaction, item, play, resolvePendingResponses, resourceCard, P1, P2 } from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, printing, refused } from "./_clause.js";
import { declareBlockers, fillers, pending, zoneOf, tokensOn } from "./_board.js";
import { declareAttackBy, finishBattle, playRaw } from "./_battle.js";
import { developResource, endTurn } from "./_turn.js";
import type { PlayerId } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

const ADD = "c2b83b16-2930-4a91-a5ed-2c18592846f9"; // Adriel, Defender of Marduun
const ADS = "43577d05-e346-4a27-aa5b-0e49212de88c"; // Adriel, Supreme General of the Imperial Army
const STIFF = "688b07ff-0f17-4eaa-a74d-ac5b08989400"; // Aroused Stiffbone
const MAD = "2705acfc-4cfc-4c24-92c2-a90f369bcd09"; // Ascendant Madcap
const FOE = "5fd5992b-e2f5-4594-ac06-9ec4d7dbcaa1"; // Balking Foecrusher
const BAR = "a802758a-6421-4f46-bf34-6a91e67a5751"; // Barrier of Benevolence
const BOIL = "914afe0b-9ce0-476d-a11d-3091536474c9"; // Boilstorm

type Icons = Partial<Record<StapleIcon, number>>;
const FK: Record<string, string> = { [P1]: "__factionA", [P2]: "__factionB" };

/** Resource placements: `ready` ones can pay, `spent` ones are attached to the owner's faction (count for thresholds only). */
function res(owner: PlayerId, ready: Icons, spent: Icons = {}, prefix = "res"): CardPlacement[] {
  const out: CardPlacement[] = [];
  for (const [kind, set] of [["r", ready], ["s", spent]] as const) {
    for (const [icon, n] of Object.entries(set) as [StapleIcon, number][]) {
      for (let i = 0; i < n; i++) {
        out.push({
          key: `${prefix}-${kind}-${icon}-${i}`,
          def: resourceCard({ name: `${prefix}-${kind}-${icon}-${i}`, resource: { provides: [icon], staple: true } }),
          owner,
          zone: "play",
          ...(kind === "s" ? { attachedToKey: FK[owner] } : {})
        });
      }
    }
  }
  return out;
}

function deployBoard(id: string, ready: Icons, spent: Icons = {}, extra: CardPlacement[] = []) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    cards: [{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...res(P1, ready, spent), ...extra]
  });
}

/** Printed cost / threshold (all rage) / type / stats, asserted by deploying with exact, short and wrong-icon boards. */
function printedBody(id: string, cost: number, thr: number, type: string, stats?: { str: number; spd: number; life: number; subtype: string[] }) {
  return () => {
    const ok = deployBoard(id, { rage: cost }, thr > cost ? { rage: thr - cost } : {});
    play(ok.engine, P1, ok.id("c"));
    assert.equal(zoneOf(ok.engine, ok.id("c")), type === "tactic" ? "discard" : "play", "deploys with exactly the cost and threshold");
    assert.equal(ok.engine.getDefinition(ok.id("c")).type, type);
    assert.equal(ok.engine.getDefinition(ok.id("c")).trade, "warlord");
    if (stats) {
      assert.equal(ok.engine.getStat(ok.id("c"), "strength"), stats.str, "printed strength");
      assert.equal(ok.engine.getStat(ok.id("c"), "speed"), stats.spd, "printed speed");
      assert.equal(ok.engine.getStat(ok.id("c"), "life"), stats.life, "printed life");
      assert.deepEqual([...(ok.engine.getDefinition(ok.id("c")).subtype ?? [])], stats.subtype);
    }
    if (cost >= thr) {
      // the threshold is exactly thr icons: thr rage + the rest in other icons deploys
      const min = deployBoard(id, { rage: thr, greed: cost - thr });
      play(min.engine, P1, min.id("c"));
      assert.equal(zoneOf(min.engine, min.id("c")), type === "tactic" ? "discard" : "play", `${thr} [R] icon(s) are enough`);
    }
    if (cost > 0) {
      const short = deployBoard(id, { rage: cost - 1 }, { rage: Math.max(0, thr - (cost - 1)) });
      refused(() => play(short.engine, P1, short.id("c")), `one resource short of cost ${cost}`);
      assert.equal(zoneOf(short.engine, short.id("c")), "hand");
    }
    const rageReady = Math.min(cost, thr - 1);
    const lowThr = deployBoard(id, { rage: rageReady, greed: cost - rageReady }, { rage: thr - 1 - rageReady });
    refused(() => play(lowThr.engine, P1, lowThr.id("c")), `one [R] short of threshold ${thr}`);
    assert.equal(zoneOf(lowThr.engine, lowThr.id("c")), "hand");
    if (thr > cost) {
      const wrong = deployBoard(id, { rage: cost }, { greed: thr - cost });
      refused(() => play(wrong.engine, P1, wrong.id("c")), "spent resources of the wrong icon don't meet the threshold");
    }
  };
}

const uniqueBoard = (id: string, secondOwner: PlayerId = P1, secondZone: "hand" | "play" = "hand") =>
  buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "a1", def: printing(id), owner: P1, zone: "play" },
      { key: "a2", def: printing(id), owner: secondOwner, zone: secondZone },
      { key: "other", def: character({ name: "Other", unique: "highlander" } as never), owner: P1, zone: "hand" },
      ...res(P1, { rage: 4 })
    ]
  });

function uniqueBody(id: string) {
  return () => {
    for (const keep of ["a2", "a1"] as const) {
      const g = uniqueBoard(id);
      play(g.engine, P1, g.id("a2"));
      const pc = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
      assert.equal(pc.kind, "uniqueSurvivor");
      assert.equal(pc.playerId, P1, "the controller chooses");
      assert.deepEqual([...pc.candidates].sort(), [g.id("a1"), g.id("a2")].sort());
      g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id(keep) } } as never);
      const lost = keep === "a1" ? "a2" : "a1";
      if (pending(g.engine)) {
        // a card with its own "would be destroyed" replacement (Supreme General) offers it; decline it
        assert.equal((pending(g.engine) as unknown as { kind: string }).kind, "replacementChoice");
        g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "replacementChoice", apply: false } } as never);
      }
      assert.equal(zoneOf(g.engine, g.id(keep)), "play");
      assert.equal(zoneOf(g.engine, g.id(lost)), "discard", "the other copy is destroyed");
      assert.equal(pending(g.engine), undefined);
    }
    // the opponent's own copy is fine
    const opp = buildGame({
      random: () => 0,
      playerA: { faction: developFaction() },
      cards: [
        { key: "a1", def: printing(id), owner: P1, zone: "play" },
        { key: "a2", def: printing(id), owner: P2, zone: "play" }
      ]
    });
    assert.equal(pending(opp.engine), undefined, "opponent's copy raises no choice");
    assert.equal(zoneOf(opp.engine, opp.id("a1")), "play");
    assert.equal(zoneOf(opp.engine, opp.id("a2")), "play");
  };
}

// ---------------------------------------------------------------------------------------------
// Adriel, Defender of Marduun  (cost 2 "rrr", 3/3/3, UNIQUE ADRIEL)
// ---------------------------------------------------------------------------------------------

clause(ADD, "0:unique", "printed cost 2 / threshold rrr / warlord character adriel+sword of great justice 3/3/3; UNIQUE ADRIEL keeps one copy per controller", () => {
  printedBody(ADD, 2, 3, "character", { str: 3, spd: 3, life: 3, subtype: ["adriel", "sword of great justice"] })();
  uniqueBody(ADD)();
});

clause(ADD, "0:unique", "UNIQUE ADRIEL is shared with the other Adriel: Supreme General in play conflicts with Defender", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    cards: [
      { key: "sup", def: printing(ADS), owner: P1, zone: "play" },
      { key: "def", def: printing(ADD), owner: P1, zone: "hand" },
      ...res(P1, { rage: 3 })
    ]
  });
  play(g.engine, P1, g.id("def"));
  const pc = pending(g.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates].sort(), [g.id("def"), g.id("sup")].sort());
});

function defBoard(over: { blkStr?: number } = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: over.blkStr ?? 4, life: 6, speed: 3 }), owner: P1, zone: "play" },
      { key: "ad", def: printing(ADD), owner: P2, zone: "play" },
      { key: "ctl", def: character({ name: "Ctl", strength: 4, life: 3, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
}

clause(ADD, "1:rule", "while blocking, battle damage inflicted to it is reduced to 0 (it takes none and survives; a plain blocker with the same stats dies; it still deals its strength)", () => {
  const g = defBoard();
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("ad")]);
  finishBattle(g.engine);
  assert.equal(g.engine.state.cards[g.id("ad")].damage, 0, "no damage marked");
  assert.equal(zoneOf(g.engine, g.id("ad")), "play", "survives 4 strength against 3 life");
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 3, "it still deals its 3 strength");
  const c = defBoard();
  declareAttackBy(c.engine, P1, [c.id("atk")]);
  declareBlockers(c.engine, P2, [c.id("ctl")]);
  finishBattle(c.engine);
  assert.equal(zoneOf(c.engine, c.id("ctl")), "discard", "control: an ordinary 3-life blocker dies to 4 strength");
});

clause(ADD, "1:rule", "every battle damage amount is reduced to 0 while it blocks: a 1-point hit and a 9-point hit both leave it undamaged", () => {
  for (const hit of [1, 9]) {
    const g = defBoard({ blkStr: hit });
    declareAttackBy(g.engine, P1, [g.id("atk")]);
    declareBlockers(g.engine, P2, [g.id("ad")]);
    finishBattle(g.engine);
    assert.equal(g.engine.state.cards[g.id("ad")].damage, 0, `a ${hit}-strength hit marks no damage`);
    assert.equal(zoneOf(g.engine, g.id("ad")), "play", `survives a ${hit}-strength hit`);
    assert.equal(g.engine.state.cards[g.id("atk")].damage, 3, "it still deals its 3 strength");
  }
});

clause(ADD, "1:rule", "the reduction only applies while it is blocking: as the attacker (blocked) it takes the battle damage; unblocked-defender and a blocker elsewhere take it normally", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ad", def: printing(ADD), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(g.engine, P1, [g.id("ad")]);
  declareBlockers(g.engine, P2, [g.id("blk")]);
  finishBattle(g.engine);
  assert.equal(g.engine.state.cards[g.id("ad")].damage, 2, "attacking and blocked: takes the 2 damage");
  assert.equal(g.engine.state.cards[g.id("blk")].damage, 3, "blocker takes 3");
});

clause(ADD, "1:rule", "only BATTLE damage is reduced: a non-battle effect (Boilstorm) still damages it, outside a battle and while it is blocking", () => {
  // outside battle
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    cards: [
      { key: "ad", def: printing(ADD), owner: P2, zone: "play" },
      ...res(P1, { rage: 5 }),
      { key: "other", def: character({ name: "Other", life: 9 }), owner: P2, zone: "play" },
      { key: "boil", def: printing(BOIL), owner: P1, zone: "hand" }
    ]
  });
  play(g.engine, P1, g.id("boil"), { selected: { cs: [g.id("ad"), g.id("other")] } });
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [g.id("ad")]: 2, [g.id("other")]: 3 } } } as never);
  assert.equal(g.engine.state.cards[g.id("ad")].damage, 2, "non-battle damage applies in full");
  // while blocking
  const b = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 0, life: 6, speed: 3 }), owner: P1, zone: "play" },
      { key: "ad", def: printing(ADD), owner: P2, zone: "play" },
      ...res(P1, { rage: 5 }),
      { key: "other", def: character({ name: "Other", life: 9 }), owner: P2, zone: "play" },
      { key: "boil", def: printing(BOIL), owner: P1, zone: "hand" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, [b.id("ad")]);
  play(b.engine, P1, b.id("boil"), { selected: { cs: [b.id("ad"), b.id("other")] } });
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [b.id("ad")]: 2, [b.id("other")]: 3 } } } as never);
  assert.equal(b.engine.state.cards[b.id("ad")].damage, 2, "Boilstorm damage to a blocker is not battle damage");
});

clause(ADD, "1:rule", "only the blocking Defender is protected: a party-mate blocker takes its damage, and a second Defender not blocking is unaffected by the first", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 5, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "ad", def: printing(ADD), owner: P2, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 2, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("ad"), g.id("mate")]);
  // the attacker assigns 5 damage; give 2 to the mate and 3 to the Defender
  finishBattle(g.engine, (source) => {
    const to = (key: string, amount: number) => ({
      sourceId: source.cardId,
      target: source.legalTargets.find((t) => JSON.stringify(t).includes(g.id(key)))!,
      amount
    });
    return source.cardId === g.id("atk")
      ? [to("ad", 3), to("mate", 2)]
      : [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }];
  });
  assert.equal(g.engine.state.cards[g.id("ad")].damage, 0, "the Defender takes none of the 3 assigned");
  assert.equal(zoneOf(g.engine, g.id("ad")), "play");
  assert.equal(zoneOf(g.engine, g.id("mate")), "discard", "its party-mate takes 2 and dies (2 life)");
});

// ---------------------------------------------------------------------------------------------
// Adriel, Supreme General of the Imperial Army  (cost 1 "rr", 2/3/1, UNIQUE ADRIEL)
// ---------------------------------------------------------------------------------------------

const pick = (g: { engine: ReturnType<typeof buildGame>["engine"] }, player: PlayerId, selected: string[]) =>
  g.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
const kindOf = (g: { engine: ReturnType<typeof buildGame>["engine"] }) => (pending(g.engine) as unknown as { kind: string } | undefined)?.kind;
const pplayer = (g: { engine: ReturnType<typeof buildGame>["engine"] }) => (pending(g.engine) as unknown as { playerId: string } | undefined)?.playerId;

clause(ADS, "0:unique", "printed cost 1 / threshold rr / warlord character adriel+general 2/3/1; UNIQUE ADRIEL keeps one copy per controller", () => {
  printedBody(ADS, 1, 2, "character", { str: 2, spd: 3, life: 1, subtype: ["adriel", "general"] })();
  uniqueBody(ADS)();
});

/** P1 attacks with `atk` (0 strength); P2's Supreme `ad` is available to block. */
function supBlockBoard() {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 0, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 0, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "ad", def: printing(ADS), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 0, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "hnd", def: character({ name: "InHand", life: 5 }), owner: P2, zone: "hand" },
      { key: "dsc", def: character({ name: "InDiscard", life: 5 }), owner: P2, zone: "discard" },
      ...fillers("d1", 3, P1, "deck"),
      ...fillers("d2", 3, P2, "deck")
    ]
  });
}

clause(ADS, "1:rule", "when it blocks: its controller is asked (may) to pick; a character picked takes 1 damage (any character: theirs, mine, the attacker)", () => {
  for (const target of ["theirs", "mine", "atk"] as const) {
    const g = supBlockBoard();
    declareAttackBy(g.engine, P1, [g.id("atk")]);
    assert.equal(pending(g.engine), undefined, "nothing is asked before blockers are declared");
    declareBlockers(g.engine, P2, [g.id("ad")]);
    assert.equal(kindOf(g), "chooserSelectsTarget");
    assert.equal(pplayer(g), P2, "the blocker's controller picks");
    pick(g, P2, [g.id(target)]);
    assert.equal(pending(g.engine), undefined, "asked once");
    finishBattle(g.engine);
    for (const k of ["theirs", "mine", "atk", "ad"] as const) {
      // the attacker also takes the blocker's 2 battle damage
      const expected = (k === target ? 1 : 0) + (k === "atk" ? 2 : 0);
      assert.equal(g.engine.state.cards[g.id(k)].damage, expected, `${k} damage when picking ${target}`);
    }
  }
});

clause(ADS, "1:rule", "when it blocks it may pick a faction: 1 damage to that faction (either player's)", () => {
  for (const who of [P1, P2] as const) {
    const g = supBlockBoard();
    const infl = [g.engine.state.players[P1].influence, g.engine.state.players[P2].influence];
    declareAttackBy(g.engine, P1, [g.id("atk")]);
    declareBlockers(g.engine, P2, [g.id("ad")]);
    pick(g, P2, [g.engine.state.players[who].factionId!]);
    finishBattle(g.engine);
    assert.equal(g.engine.state.players[who].influence, infl[who === P1 ? 0 : 1] - 1, `${who}'s faction took 1`);
    const other = who === P1 ? P2 : P1;
    assert.equal(g.engine.state.players[other].influence, infl[other === P1 ? 0 : 1], "the other faction is untouched");
    for (const k of ["theirs", "mine", "atk", "ad"] as const) assert.equal(g.engine.state.cards[g.id(k)].damage, k === "atk" ? 2 : 0, `${k} untouched (the attacker only has the battle damage)`);
  }
});

clause(ADS, "1:rule", "'you may': declining the pick (empty selection) inflicts no damage anywhere", () => {
  const g = supBlockBoard();
  const infl = [g.engine.state.players[P1].influence, g.engine.state.players[P2].influence];
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("ad")]);
  pick(g, P2, []);
  assert.equal(pending(g.engine), undefined);
  finishBattle(g.engine);
  for (const k of ["theirs", "mine", "atk", "ad"] as const) assert.equal(g.engine.state.cards[g.id(k)].damage, k === "atk" ? 2 : 0, `${k} untouched (the attacker only has the battle damage)`);
  assert.deepEqual([g.engine.state.players[P1].influence, g.engine.state.players[P2].influence], infl);
});

clause(ADS, "1:rule", "only a character or a faction can be picked: an item, a card in hand, a card in the discard pile and a second pick are refused", () => {
  const g = supBlockBoard();
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("ad")]);
  for (const bad of ["it", "hnd", "dsc"] as const) {
    refused(() => pick(g, P2, [g.id(bad)]), `${bad} is not a character in play or a faction`);
  }
  refused(() => pick(g, P2, [g.id("theirs"), g.id("mine")]), "only one card may be picked");
  assert.equal(kindOf(g), "chooserSelectsTarget", "still waiting for a legal pick");
  pick(g, P2, [g.id("theirs")]);
  assert.equal(pending(g.engine), undefined);
});

clause(ADS, "1:rule", "it may pick itself: it takes 1 damage (and, with 1 life, would be destroyed)", () => {
  const g = supBlockBoard();
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("ad")]);
  pick(g, P2, [g.id("ad")]);
  assert.equal(kindOf(g), "replacementChoice", "1 damage on 1 life: the destroy replacement is offered");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "replacementChoice", apply: false } } as never);
  assert.equal(zoneOf(g.engine, g.id("ad")), "discard");
});

const supAtkBoard = () =>
  buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ad", def: printing(ADS), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 0, life: 5, speed: 3 }), owner: P1, zone: "play" }
    ]
  });

clause(ADS, "1:rule", "when it is blocked (it attacked): its controller is asked after the block", () => {
  const g = supAtkBoard();
  declareAttackBy(g.engine, P1, [g.id("ad")]);
  assert.equal(pending(g.engine), undefined, "not asked at the attack declaration: nothing has blocked it yet");
  declareBlockers(g.engine, P2, [g.id("blk")]);
  assert.equal(kindOf(g), "chooserSelectsTarget", "asked once it is blocked");
  assert.equal(pplayer(g), P1, "its controller picks");
  pick(g, P1, [g.id("blk")]);
  finishBattle(g.engine);
  assert.equal(g.engine.state.cards[g.id("blk")].damage, 3, "1 from the pick + 2 battle damage from its strength");
});

clause(ADS, "1:rule", "as a blocked attacker: whenever the prompt appears, its controller picks, the picked character takes exactly 1 damage, and declining deals none", () => {
  for (const choose of [true, false]) {
    const g = supAtkBoard();
    declareAttackBy(g.engine, P1, [g.id("ad")]);
    let asked = false;
    const answerIfAsked = () => {
      if (!pending(g.engine)) return;
      assert.equal(kindOf(g), "chooserSelectsTarget");
      assert.equal(pplayer(g), P1, "its controller picks");
      pick(g, P1, choose ? [g.id("blk")] : []);
      resolvePendingResponses(g.engine);
      asked = true;
    };
    answerIfAsked();
    declareBlockers(g.engine, P2, [g.id("blk")]);
    if (!asked) answerIfAsked();
    assert.ok(asked, "the controller was asked once it attacked and was blocked");
    finishBattle(g.engine);
    assert.equal(dmg(g, "blk"), choose ? 3 : 2, "2 battle damage, +1 from the pick when taken");
    assert.equal(dmg(g, "mine"), 0);
    assert.equal(dmg(g, "ad"), 0);
  }
});

clause(ADS, "1:rule", "when it attacks and nobody blocks it, its controller is never asked", () => {
  const u = supAtkBoard();
  declareAttackBy(u.engine, P1, [u.id("ad")]);
  assert.equal(pending(u.engine), undefined, "unblocked attack: not asked at the declaration");
  declareBlockers(u.engine, P2, []);
  assert.equal(pending(u.engine), undefined, "unblocked attack: never asked (nothing blocked it)");
});

clause(ADS, "1:rule", "only its own blocks/being-blocked count: another character blocking, or being blocked, does not trigger it", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "adp", def: printing(ADS), owner: P1, zone: "play" },
      { key: "ado", def: printing(ADS), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 0, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 9, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("blk")]);
  assert.equal(pending(g.engine), undefined, "neither Supreme General was involved in the block");
});

// --- replacement ---

function supDestroyBoard(over: { ownerOfSup?: PlayerId; controller?: PlayerId; active?: PlayerId } = {}) {
  const caster = over.active ?? P1;
  return buildGame({
    random: () => 0,
    activePlayerId: caster,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ad", def: printing(ADS), owner: over.ownerOfSup ?? P1, zone: "play", ...(over.controller ? { controller: over.controller } : {}) },
      ...fillers("d1", 3, P1, "deck"),
      ...fillers("d2", 3, P2, "deck"),
      ...res(caster, { rage: 6 }),
      { key: "boil", def: printing(BOIL), owner: caster, zone: "hand" }
    ]
  });
}
const killWithBoil = (g: ReturnType<typeof supDestroyBoard>, caster: PlayerId = P1) => {
  play(g.engine, caster, g.id("boil"), { selected: { cs: [g.id("ad")] } });
  g.engine.perform({ type: "resolvePendingChoice", playerId: caster, choice: { kind: "distributeAmong", shares: { [g.id("ad")]: 6 } } } as never);
};
const replace = (g: ReturnType<typeof supDestroyBoard>, player: PlayerId, apply: boolean) =>
  g.engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "replacementChoice", apply } } as never);

clause(ADS, "1:rule", "as a blocked attacker: only a character or faction in play can be picked (an item, a hand card, a discard card, a second pick are refused); a faction pick inflicts 1 damage to it", () => {
  for (const who of [P1, P2] as const) {
    const g = buildGame({
      random: () => 0,
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "ad", def: printing(ADS), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 0, life: 9, speed: 3 }), owner: P2, zone: "play" },
        { key: "mine", def: character({ name: "Mine", strength: 0, life: 5, speed: 3 }), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "Gear" }), owner: P1, zone: "play" },
        { key: "hnd", def: character({ name: "InHand", life: 5 }), owner: P1, zone: "hand" },
        { key: "dsc", def: character({ name: "InDiscard", life: 5 }), owner: P1, zone: "discard" },
        ...fillers("d1", 3, P1, "deck"),
        ...fillers("d2", 3, P2, "deck")
      ]
    });
    const infl = [g.engine.state.players[P1].influence, g.engine.state.players[P2].influence];
    declareAttackBy(g.engine, P1, [g.id("ad")]);
    declareBlockers(g.engine, P2, [g.id("blk")]);
    assert.equal(kindOf(g), "chooserSelectsTarget", "asked once it is blocked");
    for (const bad of ["it", "hnd", "dsc"] as const) {
      refused(() => pick(g, P1, [g.id(bad)]), `${bad} is not a character in play or a faction`);
    }
    refused(() => pick(g, P1, [g.id("blk"), g.id("mine")]), "only one card may be picked");
    assert.equal(kindOf(g), "chooserSelectsTarget", "still waiting for a legal pick");
    pick(g, P1, [g.engine.state.players[who].factionId!]);
    assert.equal(pending(g.engine), undefined, "the pick resolved");
    finishBattle(g.engine);
    assert.equal(g.engine.state.players[who].influence, infl[who === P1 ? 0 : 1] - 1, `${who}'s faction took 1`);
    const other = who === P1 ? P2 : P1;
    assert.equal(g.engine.state.players[other].influence, infl[other === P1 ? 0 : 1], "the other faction is untouched");
    assert.equal(dmg(g, "blk"), 2, "the blocker took only the 2 battle damage");
  }
});

clause(ADS, "2:rule", "the replacement is only for THIS card: another of my characters being destroyed is not offered the put-on-top-of-deck choice", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "ad", def: printing(ADS), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 0, life: 1, speed: 3 }), owner: P2, zone: "play" },
      ...fillers("d2", 3, P2, "deck")
    ]
  });
  const deck = [...g.engine.state.players[P2].deck];
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("mine")]);
  let offered = false;
  finishBattle(g.engine, undefined, (pc) => {
    if (pc.kind === "replacementChoice") {
      offered = true;
      return { kind: "replacementChoice", apply: true };
    }
    return { kind: pc.kind };
  });
  assert.equal(offered, false, "Adriel's replacement was not offered for another character");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "the other character is destroyed normally");
  assert.equal(zoneOf(g.engine, g.id("ad")), "play", "Adriel itself is untouched");
  assert.deepEqual(g.engine.state.players[P2].deck, deck, "nothing was put on top of the deck");
});

clause(ADS, "2:rule", "if it would be destroyed its owner may put it on top of their deck instead: accepting leaves it as the top card of the deck (not in the discard pile)", () => {
  const g = supDestroyBoard();
  const deckBefore = g.engine.state.players[P1].deck.length;
  killWithBoil(g);
  assert.equal(kindOf(g), "replacementChoice");
  assert.equal(pplayer(g), P1);
  assert.equal(zoneOf(g.engine, g.id("ad")), "play", "still in play while the choice is pending");
  replace(g, P1, true);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("ad")), "deck");
  assert.equal(g.engine.state.players[P1].deck[0], g.id("ad"), "on TOP of the deck");
  assert.equal(g.engine.state.players[P1].deck.length, deckBefore + 1);
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("ad")), "not in the discard pile");
  assert.ok(!g.engine.state.players[P1].play.includes(g.id("ad")), "no longer in play");
});

clause(ADS, "2:rule", "declining the replacement: it is destroyed as normal (discard pile), deck untouched", () => {
  const g = supDestroyBoard();
  const deckBefore = [...g.engine.state.players[P1].deck];
  killWithBoil(g);
  replace(g, P1, false);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("ad")), "discard");
  assert.deepEqual(g.engine.state.players[P1].deck, deckBefore);
});

clause(ADS, "2:rule", "its OWNER (not its controller) is the one who decides when the opponent controls it", () => {
  const g = supDestroyBoard({ ownerOfSup: P1, controller: P2, active: P2 });
  killWithBoil(g, P2);
  assert.equal(kindOf(g), "replacementChoice");
  assert.equal(pplayer(g), P1, "the owner (not the controller) is asked");
});

clause(ADS, "2:rule", "when the opponent controls it, the accepted replacement still puts it on top of its OWNER's deck, not the controller's", () => {
  const g = supDestroyBoard({ ownerOfSup: P1, controller: P2, active: P2 });
  const p1Deck = g.engine.state.players[P1].deck.length;
  const p2Deck = g.engine.state.players[P2].deck.length;
  killWithBoil(g, P2);
  assert.equal(kindOf(g), "replacementChoice");
  replace(g, pplayer(g) as PlayerId, true);
  assert.equal(g.engine.state.players[P1].deck[0], g.id("ad"), "top of the OWNER's deck");
  assert.equal(g.engine.state.players[P1].deck.length, p1Deck + 1);
  assert.equal(g.engine.state.players[P2].deck.length, p2Deck, "the controller's deck is untouched");
});

clause(ADS, "2:rule", "it also applies to destruction by battle damage", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "ad", def: printing(ADS), owner: P1, zone: "play" },
      ...fillers("d1", 3, P1, "deck")
    ]
  });
  g.engine.state.activePlayerId = P2;
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("ad")]);
  pick(g, P1, []);
  finishBattle(g.engine, undefined, (pc) => (pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : { kind: pc.kind }));
  assert.equal(zoneOf(g.engine, g.id("ad")), "deck");
  assert.equal(g.engine.state.players[P1].deck[0], g.id("ad"));
});

// ---------------------------------------------------------------------------------------------
// Aroused Stiffbone  (cost 0 "r", 4/3/4 dragon; EXTRA COST: Pay X, X = 7 - number of [R] you control)
// ---------------------------------------------------------------------------------------------

const down = (prefix: string, n: number, owner: PlayerId): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: resourceCard({ name: `${prefix}${i}`, resource: { provides: ["greed"], staple: true } }),
    owner,
    zone: "play" as const,
    faceDown: true
  }));
const ready = (g: { engine: ReturnType<typeof buildGame>["engine"] }, p: PlayerId = P1) => g.engine.getAvailableResourceCount(p);

/** Deploys Stiffbone from a board of the given resources; returns the game. */
const stiff = (cards: CardPlacement[]) => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "c", def: printing(STIFF), owner: P1, zone: "hand" }, ...cards]
  });
  return g;
};

clause(STIFF, "0:extraCost", "printed cost 0 / threshold r / warlord character dragon 4/3/4; needs an [R] icon and pays 7 minus the [R] count", () => {
  const g = stiff(res(P1, { rage: 7 }));
  play(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(g.engine.getDefinition(g.id("c")).type, "character");
  assert.equal(g.engine.getDefinition(g.id("c")).trade, "warlord");
  assert.deepEqual([...(g.engine.getDefinition(g.id("c")).subtype ?? [])], ["dragon"]);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("c"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("c"), "life"), 4);
  // threshold: seven greed resources can pay X=7 but there is no [R]
  const noR = stiff(res(P1, { greed: 7 }));
  refused(() => play(noR.engine, P1, noR.id("c")), "no [R] icon: threshold r unmet");
  assert.equal(zoneOf(noR.engine, noR.id("c")), "hand");
  // no resources at all
  const none = stiff([]);
  refused(() => play(none.engine, P1, none.id("c")), "nothing to meet the threshold");
});

clause(STIFF, "0:extraCost", "7 [R] controlled: X is 0, nothing is paid; 8 [R]: X does not go negative", () => {
  for (const n of [7, 8]) {
    const g = stiff(res(P1, { rage: n }));
    play(g.engine, P1, g.id("c"));
    assert.equal(zoneOf(g.engine, g.id("c")), "play");
    assert.equal(ready(g), n, `${n} [R]: no resources spent`);
  }
});

clause(STIFF, "0:extraCost", "pays exactly 7 minus the [R] count: 5 [R] pays 2; 3 [R] pays 4; 1 [R] pays 6", () => {
  for (const [n, extraGreed] of [[6, 0], [5, 0], [3, 2], [1, 5]] as const) {
    const g = stiff(res(P1, { rage: n, greed: extraGreed }));
    const total = n + extraGreed;
    play(g.engine, P1, g.id("c"));
    assert.equal(zoneOf(g.engine, g.id("c")), "play");
    assert.equal(ready(g), total - (7 - n), `${n} [R]: ${7 - n} spent`);
  }
});

clause(STIFF, "0:extraCost", "one resource short of X is refused (nothing is spent): 5 [R] with only 1 other ready; 1 [R] with 4 others", () => {
  for (const [n, others] of [[3, 0], [2, 2], [1, 4]] as const) {
    const g = stiff(res(P1, { rage: n, greed: others }));
    refused(() => play(g.engine, P1, g.id("c")), `X=${7 - n} but only ${n + others} resources`);
    assert.equal(zoneOf(g.engine, g.id("c")), "hand");
    assert.equal(ready(g), n + others, "nothing was spent");
  }
  // the minimal exact boards succeed
  for (const [n, others] of [[3, 1], [2, 3], [1, 5]] as const) {
    const g = stiff(res(P1, { rage: n, greed: others }));
    play(g.engine, P1, g.id("c"));
    assert.equal(ready(g), n + others - (7 - n));
  }
});

clause(STIFF, "0:extraCost", "[R] you control includes already-spent [R] resources: 3 spent [R] + 4 ready greed pays X=4", () => {
  const g = stiff(res(P1, { greed: 4 }, { rage: 3 }));
  play(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(ready(g), 0, "X = 7 - 3 = 4 paid from the 4 ready resources");
  const short = stiff(res(P1, { greed: 3 }, { rage: 3 }));
  refused(() => play(short.engine, P1, short.id("c")), "X=4 but only 3 ready");
});

clause(STIFF, "0:extraCost", "[R] count is by icons: a resource providing [R][R] counts twice; face-down Volition and greed resources do not count", () => {
  const dual: CardPlacement = {
    key: "dual",
    def: resourceCard({ name: "Dual", resource: { provides: ["rage", "rage"], staple: true } }),
    owner: P1,
    zone: "play"
  };
  const g = stiff([dual, ...res(P1, { greed: 4 })]);
  play(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(ready(g), 0, "2 [R] icons: X=5 paid from the 5 ready resources");
  const short = stiff([dual, ...res(P1, { greed: 2 })]);
  refused(() => play(short.engine, P1, short.id("c")), "X=5 but only 3 ready");
  // face-down Volition resources do not provide [R]
  const fd = stiff([...res(P1, { rage: 2 }), ...down("fd", 3, P1)]);
  play(fd.engine, P1, fd.id("c"));
  assert.equal(ready(fd), 0, "2 [R] only: X=5 paid from 2 + 3 face-down");
});

clause(STIFF, "0:extraCost", "only my own [R] icons are compared with 7: seven [R] on the opponent's side or seven resources of another icon on mine do not make X zero", () => {
  const opp = stiff([...res(P1, { rage: 1, greed: 7 }), ...res(P2, { rage: 7 }, {}, "opp")]);
  play(opp.engine, P1, opp.id("c"));
  assert.equal(zoneOf(opp.engine, opp.id("c")), "play", "deployed");
  assert.equal(ready(opp), 2, "X = 7 - 1 = 6 spent from my 8 resources (7 greed do not count as [R]; the opponent's 7 [R] do not count for me)");
  assert.equal(ready(opp, P2), 7, "the opponent's resources are untouched");
  const short = stiff([...res(P1, { rage: 1, greed: 4 }), ...res(P2, { rage: 7 }, {}, "opp")]);
  refused(() => play(short.engine, P1, short.id("c")), "X=6 but only 5 ready: the opponent's seven [R] do not make it free");
});

clause(STIFF, "0:extraCost", "only [R] YOU control count: the opponent's [R] resources do not reduce X", () => {
  const g = stiff([...res(P1, { rage: 2, greed: 3 }), ...res(P2, { rage: 5 }, {}, "opp")]);
  play(g.engine, P1, g.id("c"));
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(ready(g), 0, "X = 7 - 2 = 5, all five of my resources");
  assert.equal(ready(g, P2), 5, "the opponent's resources are untouched");
  const short = stiff([...res(P1, { rage: 2, greed: 2 }), ...res(P2, { rage: 5 }, {}, "opp")]);
  refused(() => play(short.engine, P1, short.id("c")), "X=5 but only 4 ready: the opponent's [R] don't help");
});

// ---------------------------------------------------------------------------------------------
// Ascendant Madcap  (cost 5 "r", 3/3/4 soldier)
// ---------------------------------------------------------------------------------------------

const rageRes = (name = "RageRes") => resourceCard({ name, resource: { provides: ["rage"], staple: true } });

function madBoard(hand: { key: string; def: ReturnType<typeof resourceCard> }[], opts: { active?: PlayerId; tokens?: number } = {}) {
  return buildGame({
    random: () => 0,
    activePlayerId: opts.active ?? P1,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mad", def: printing(MAD), owner: P1, zone: "play", ...(opts.tokens ? { counters: { token: opts.tokens } } : {}) },
      ...hand.map((h) => ({ key: h.key, def: h.def, owner: opts.active ?? P1, zone: "hand" as const }))
    ]
  });
}

clause(MAD, "0:rule", "printed cost 5 / threshold r / warlord character soldier 3/3/4", () => {
  printedBody(MAD, 5, 1, "character", { str: 3, spd: 3, life: 4, subtype: ["soldier"] })();
});

clause(MAD, "0:rule", "my face-up resource providing [R] entering play puts exactly one token on it (and +1 strength); [R][R] and greed+rage resources count once", () => {
  const cases: [string, ReturnType<typeof resourceCard>, number][] = [
    ["rage", rageRes(), 1],
    ["double rage", resourceCard({ name: "RR", resource: { provides: ["rage", "rage"], staple: true } }), 1],
    ["greed+rage", resourceCard({ name: "GR", resource: { provides: ["greed", "rage"], staple: true } }), 1],
    ["greed", resourceCard({ name: "G", resource: { provides: ["greed"], staple: true } }), 0],
    ["obsession", resourceCard({ name: "O", resource: { provides: ["obsession"], staple: true } }), 0]
  ];
  for (const [label, def, tokens] of cases) {
    const g = madBoard([{ key: "r", def }]);
    assert.equal(tokensOn(g.engine, g.id("mad")), 0);
    developResource(g.engine, P1, g.id("r"), false);
    assert.equal(zoneOf(g.engine, g.id("r")), "play");
    assert.equal(tokensOn(g.engine, g.id("mad")), tokens, `${label}: tokens`);
    assert.equal(g.engine.getStat(g.id("mad"), "strength"), 3 + tokens, `${label}: strength`);
  }
});

clause(MAD, "0:rule", "a face-down resource (Volition) does not provide [R]: no token", () => {
  const g = madBoard([{ key: "r", def: rageRes() }]);
  developResource(g.engine, P1, g.id("r"), true);
  assert.equal(zoneOf(g.engine, g.id("r")), "play");
  assert.equal(tokensOn(g.engine, g.id("mad")), 0);
  assert.equal(g.engine.getStat(g.id("mad"), "strength"), 3);
});

clause(MAD, "0:rule", "only cards entering under MY control: the opponent's rage resource gives nothing", () => {
  const g = madBoard([{ key: "r", def: rageRes() }], { active: P2 });
  developResource(g.engine, P2, g.id("r"), false);
  assert.equal(zoneOf(g.engine, g.id("r")), "play");
  assert.equal(tokensOn(g.engine, g.id("mad")), 0);
  assert.equal(g.engine.getStat(g.id("mad"), "strength"), 3);
});

clause(MAD, "0:rule", "any card providing at least [R] counts, not just developed resources: a deployed item providing [R] gives a token; [G] or nothing does not; the opponent's does not", () => {
  const mk = (provides: string[] | undefined, active: PlayerId = P1) =>
    buildGame({
      random: () => 0,
      activePlayerId: active,
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "mad", def: printing(MAD), owner: P1, zone: "play" },
        { key: "it", def: item({ name: "Prov", cost: 0, ...(provides ? { resource: { provides, staple: false } } : {}) } as never), owner: active, zone: "hand" }
      ]
    });
  const yes = mk(["rage"]);
  play(yes.engine, P1, yes.id("it"));
  assert.equal(zoneOf(yes.engine, yes.id("it")), "play");
  assert.equal(tokensOn(yes.engine, yes.id("mad")), 1, "item providing [R]");
  assert.equal(yes.engine.getStat(yes.id("mad"), "strength"), 4);
  const dbl = mk(["rage", "rage"]);
  play(dbl.engine, P1, dbl.id("it"));
  assert.equal(tokensOn(dbl.engine, dbl.id("mad")), 1, "[R][R] is still one token");
  const gr = mk(["greed"]);
  play(gr.engine, P1, gr.id("it"));
  assert.equal(tokensOn(gr.engine, gr.id("mad")), 0, "item providing only [G]");
  const plain = mk(undefined);
  play(plain.engine, P1, plain.id("it"));
  assert.equal(zoneOf(plain.engine, plain.id("it")), "play");
  assert.equal(tokensOn(plain.engine, plain.id("mad")), 0, "an item that provides nothing");
  const opp = mk(["rage"], P2);
  play(opp.engine, P2, opp.id("it"));
  assert.equal(zoneOf(opp.engine, opp.id("it")), "play");
  assert.equal(tokensOn(opp.engine, opp.id("mad")), 0, "the opponent's [R] card");
});

clause(MAD, "0:rule", "a token is not put on a card that merely was already in play, and Madcap's own entry (provides nothing) gives itself none", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    cards: [
      { key: "mad", def: printing(MAD), owner: P1, zone: "hand" },
      { key: "r0", def: rageRes("Existing"), owner: P1, zone: "play" },
      ...res(P1, { rage: 5 })
    ]
  });
  play(g.engine, P1, g.id("mad"));
  assert.equal(zoneOf(g.engine, g.id("mad")), "play");
  assert.equal(tokensOn(g.engine, g.id("mad")), 0, "no tokens for cards that were already in play");
  assert.equal(g.engine.getStat(g.id("mad"), "strength"), 3);
});

clause(MAD, "1:rule", "gains exactly 1 strength per token: 0/1/3/6 tokens; a token on another card does not count; speed and life are unchanged", () => {
  for (const n of [0, 1, 3, 6]) {
    const g = buildGame({
      random: () => 0,
      playerA: { faction: developFaction() },
      cards: [
        { key: "mad", def: printing(MAD), owner: P1, zone: "play", ...(n ? { counters: { token: n } } : {}) },
        { key: "other", def: character({ name: "Other", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play", counters: { token: 4 } }
      ]
    });
    assert.equal(g.engine.getStat(g.id("mad"), "strength"), 3 + n, `${n} tokens`);
    assert.equal(g.engine.getStat(g.id("mad"), "life"), 4);
    assert.equal(g.engine.getStat(g.id("mad"), "speed"), 3);
    assert.equal(g.engine.getStat(g.id("other"), "strength"), 2, "other cards' tokens give nothing to Madcap and Madcap's bonus does not reach them");
  }
});

clause(MAD, "1:rule", "only THIS card gains the strength: other characters (mine and the opponent's) and their stats are unchanged by its tokens", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mad", def: printing(MAD), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("mad"), "strength"), 6, "3 base + 3 tokens");
  for (const k of ["mine", "theirs"] as const) {
    assert.equal(g.engine.getStat(g.id(k), "strength"), 2, `${k} gains no strength from Madcap's tokens`);
    assert.equal(g.engine.getStat(g.id(k), "life"), 4, `${k} life unchanged`);
  }
});

clause(MAD, "1:rule", "the strength bonus follows the tokens: removing/adding them changes it, and it does not apply to an opponent's copy's tokens", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    cards: [
      { key: "mad", def: printing(MAD), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "omad", def: printing(MAD), owner: P2, zone: "play" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("mad"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("omad"), "strength"), 3, "the opponent's Madcap has its own (zero) tokens");
  g.engine.state.cards[g.id("mad")].counters = { token: 0 };
  assert.equal(g.engine.getStat(g.id("mad"), "strength"), 3, "no tokens: printed strength");
});

// ---------------------------------------------------------------------------------------------
// Balking Foecrusher  (cost 4 "rr", 2/3/2 soldier)
// ---------------------------------------------------------------------------------------------

type Eng = ReturnType<typeof buildGame>["engine"];
const dmg = (g: { engine: Eng; id: (k: string) => string }, k: string) => g.engine.state.cards[g.id(k)].damage;

/** Foecrusher (key "fc") in play for `controller` (owned by `owner`) with characters on both sides, an item, and decks. */
function foeBoard(o: { owner?: PlayerId; controller?: PlayerId; active?: PlayerId; rage?: number } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    random: () => 0,
    activePlayerId: active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fc", def: printing(FOE), owner: o.owner ?? P1, zone: "play", ...(o.controller ? { controller: o.controller } : {}) },
      { key: "m1", def: character({ name: "M1", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "M2", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "o1", def: character({ name: "O1", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "o2", def: character({ name: "O2", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HandChar", life: 5 }), owner: P2, zone: "hand" },
      ...fillers("d1", 4, P1, "deck"),
      ...fillers("d2", 4, P2, "deck"),
      ...res(active, { rage: o.rage ?? 6 }),
      { key: "boil", def: printing(BOIL), owner: active, zone: "hand" }
    ]
  });
}
const boilFoe = (g: ReturnType<typeof foeBoard>, caster: PlayerId = P1) => {
  play(g.engine, caster, g.id("boil"), { selected: { cs: [g.id("fc")] } });
  g.engine.perform({ type: "resolvePendingChoice", playerId: caster, choice: { kind: "distributeAmong", shares: { [g.id("fc")]: 6 } } } as never);
};

clause(FOE, "0:rule", "printed cost 4 / threshold rr / warlord character soldier 2/3/2", () => {
  printedBody(FOE, 4, 2, "character", { str: 2, spd: 3, life: 2, subtype: ["soldier"] })();
});

clause(FOE, "0:rule", "when it leaves play (destroyed): 1 damage to ALL characters in play (both sides), none to items / cards in hand; its controller draws 1", () => {
  const g = foeBoard();
  const hand = g.engine.state.players[P1].hand.length;
  const top = g.engine.state.players[P1].deck[0];
  boilFoe(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("fc")), "discard");
  assert.equal(dmg(g, "m1"), 1, "my character");
  assert.equal(dmg(g, "o1"), 1, "the opponent's character");
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "1-life character destroyed by the 1 damage");
  assert.equal(dmg(g, "o2"), 1);
  assert.equal(zoneOf(g.engine, g.id("o2")), "play", "2 life survives 1 damage");
  assert.equal(dmg(g, "it"), 0, "items are not characters");
  assert.equal(dmg(g, "hc"), 0, "a character in hand is not in play");
  assert.equal(g.engine.state.players[P1].hand.length, hand - 1 + 1, "Boilstorm left the hand, then 1 card was drawn");
  assert.ok(g.engine.state.players[P1].hand.includes(top), "the drawn card is the top of the deck");
  assert.equal(g.engine.state.players[P2].hand.length, 1, "the opponent drew nothing");
});

clause(FOE, "0:rule", "only when THIS card leaves play: another card leaving play while it is in play deals no damage and draws nothing", () => {
  const g = foeBoard();
  const hand = g.engine.state.players[P1].hand.length;
  play(g.engine, P1, g.id("boil"), { selected: { cs: [g.id("m2")] } });
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [g.id("m2")]: 6 } } } as never);
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("fc")), "play");
  assert.equal(pending(g.engine), undefined);
  for (const k of ["fc", "m1", "o1", "o2"]) assert.equal(dmg(g, k), 0, `${k} untouched`);
  assert.equal(g.engine.state.players[P1].hand.length, hand - 1, "no card drawn (only Boilstorm left the hand)");
});

clause(FOE, "0:rule", "entering play does not trigger it: deploying it from hand deals no damage and draws nothing", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "fc", def: printing(FOE), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "M1", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "o1", def: character({ name: "O1", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...fillers("d1", 4, P1, "deck"),
      ...res(P1, { rage: 4 })
    ]
  });
  const deck = g.engine.state.players[P1].deck.length;
  play(g.engine, P1, g.id("fc"));
  assert.equal(zoneOf(g.engine, g.id("fc")), "play", "deployed (cost 4, rr)");
  assert.equal(dmg(g, "m1"), 0, "no damage to my character on entering");
  assert.equal(dmg(g, "o1"), 0, "no damage to the opponent's character on entering");
  assert.equal(dmg(g, "fc"), 0, "no damage to itself on entering");
  assert.equal(g.engine.state.players[P1].deck.length, deck, "no card drawn on entering");
});

clause(FOE, "0:rule", "it deals exactly 1 (not more) damage per character and draws exactly 1 card", () => {
  const g = foeBoard();
  const deck = g.engine.state.players[P1].deck.length;
  boilFoe(g);
  assert.equal(dmg(g, "m1"), 1);
  assert.equal(dmg(g, "o1"), 1);
  assert.equal(g.engine.state.players[P1].deck.length, deck - 1, "exactly one card drawn");
});

clause(FOE, "0:rule", "the trigger belongs to its controller: when the opponent controls it, the controller draws and the owner does not", () => {
  const g = foeBoard({ owner: P1, controller: P2, active: P2 });
  const own = g.engine.state.players[P1].hand.length;
  const ctl = g.engine.state.players[P2].hand.length;
  boilFoe(g, P2);
  assert.equal(zoneOf(g.engine, g.id("fc")), "discard");
  assert.equal(g.engine.state.players[P2].hand.length, ctl - 1 + 1, "the controller drew 1 (Boilstorm left the hand)");
  assert.equal(g.engine.state.players[P1].hand.length, own, "the owner drew nothing");
  assert.equal(dmg(g, "m1"), 1);
});

const crushBoard = (rage = 2) => foeBoard({ rage });

clause(FOE, "1:ability:crush-wave", "CRUSH WAVE costs 2 (exactly 2 resources spent) and destroys the card; refused with only 1 resource, nothing is spent", () => {
  const short = crushBoard(1);
  refused(() => activate(short.engine, P1, short.id("fc"), "crush-wave"), "1 resource for 'Pay 2'");
  assert.equal(zoneOf(short.engine, short.id("fc")), "play", "not destroyed when the cost can't be paid");
  assert.equal(ready(short), 1);
  const g = crushBoard(5);
  activate(g.engine, P1, g.id("fc"), "crush-wave");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("fc")), "discard", "destroyed as a cost");
  assert.equal(ready(g), 3, "exactly 2 of 5 resources spent");
});

clause(FOE, "1:ability:crush-wave", "its effect inflicts 1 damage to all characters (both sides, not items); with the leave-play trigger each character takes 1 from the ability and 1 from the trigger", () => {
  const g = crushBoard(2);
  const hand = g.engine.state.players[P1].hand.length;
  activate(g.engine, P1, g.id("fc"), "crush-wave");
  assert.equal(pending(g.engine), undefined);
  assert.equal(dmg(g, "m1"), 2, "1 (Crush Wave) + 1 (leaves play)");
  assert.equal(dmg(g, "o1"), 2, "the opponent's character too");
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("o2")), "discard", "2 life, 2 damage");
  assert.equal(dmg(g, "it"), 0);
  assert.equal(dmg(g, "hc"), 0);
  assert.equal(g.engine.state.players[P1].hand.length, hand + 1, "and the leaves-play trigger draws a card");
});

clause(FOE, "1:ability:crush-wave", "only its controller can use it, only while it is in play and on their turn", () => {
  const g = crushBoard(2);
  refused(() => activate(g.engine, P2, g.id("fc"), "crush-wave"), "the opponent can't use my ability");
  assert.equal(zoneOf(g.engine, g.id("fc")), "play");
  const hand = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    cards: [{ key: "fc", def: printing(FOE), owner: P1, zone: "hand" }, ...res(P1, { rage: 4 })]
  });
  refused(() => activate(hand.engine, P1, hand.id("fc"), "crush-wave"), "not in play");
  // positive control
  activate(g.engine, P1, g.id("fc"), "crush-wave");
  assert.equal(zoneOf(g.engine, g.id("fc")), "discard");
});

// ---------------------------------------------------------------------------------------------
// Barrier of Benevolence  (tactic, cost 0 "rr"; X chosen, pay X+X, pick 2 or fewer characters)
// ---------------------------------------------------------------------------------------------

function barBoard(ready: Icons, spent: Icons = {}) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bar", def: printing(BAR), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "c", def: character({ name: "C", strength: 3, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      ...res(P1, ready, spent)
    ]
  });
}
const barPlay = (g: ReturnType<typeof barBoard>, x: number, picked: string[]) =>
  play(g.engine, P1, g.id("bar"), { selected: { picked: picked.map((k) => g.id(k)) }, variables: { x } });
const st = (g: ReturnType<typeof barBoard>, k: string) => [g.engine.getStat(g.id(k), "strength"), g.engine.getStat(g.id(k), "life")];

clause(BAR, "0:extraCost", "printed tactic, cost 0 / threshold rr: playable with X=0 and two spent [R] only; one [R] short is refused", () => {
  const ok = barBoard({}, { rage: 2 });
  barPlay(ok, 0, []);
  assert.equal(zoneOf(ok.engine, ok.id("bar")), "discard", "played");
  assert.equal(ok.engine.getDefinition(ok.id("bar")).type, "tactic");
  assert.equal(ok.engine.getDefinition(ok.id("bar")).trade, "warlord");
  const one = barBoard({}, { rage: 1 });
  refused(() => barPlay(one, 0, []), "only one [R]: threshold rr unmet");
  assert.equal(zoneOf(one.engine, one.id("bar")), "hand");
  const wrong = barBoard({ greed: 2 }, { rage: 1 });
  refused(() => barPlay(wrong, 0, []), "rr needs two [R] icons; greed doesn't count");
});

clause(BAR, "0:extraCost", "Pay X+X: X=1 spends 2, X=2 spends 4, X=3 spends 6 (not X)", () => {
  for (const x of [1, 2, 3]) {
    const g = barBoard({ rage: 6 });
    barPlay(g, x, ["a"]);
    assert.equal(zoneOf(g.engine, g.id("bar")), "discard");
    assert.equal(ready(g), 6 - 2 * x, `X=${x}: ${2 * x} spent`);
  }
});

clause(BAR, "0:extraCost", "one resource short of X+X is refused with nothing spent or applied (X=2 needs 4; X=3 needs 6)", () => {
  for (const [x, have] of [[2, 3], [3, 5], [1, 1]] as const) {
    const g = barBoard({ rage: have > 2 ? 2 : have, greed: have > 2 ? have - 2 : 0 }, have < 2 ? { rage: 1 } : {});
    refused(() => barPlay(g, x, ["a"]), `X=${x} needs ${2 * x}, only ${have} ready`);
    assert.equal(zoneOf(g.engine, g.id("bar")), "hand");
    assert.deepEqual(st(g, "a"), [2, 3], "no bonus applied");
  }
  const ctl = barBoard({ rage: 4 });
  barPlay(ctl, 2, ["a"]);
  assert.deepEqual(st(ctl, "a"), [4, 5], "control: exactly 4 resources suffice for X=2");
});

clause(BAR, "0:extraCost", "the cost is already paid while the tactic waits on the stack (not at resolution)", () => {
  const g = barBoard({ rage: 6 });
  playRaw(g.engine, P1, g.id("bar"), { selected: { picked: [g.id("a")] }, variables: { x: 2 } });
  assert.equal(ready(g), 2, "4 resources spent up front");
  assert.deepEqual(st(g, "a"), [2, 3], "effect not applied yet");
});

clause(BAR, "0:extraCost", "'pick 2 or fewer characters': 0, 1 and 2 are accepted (either player's); 3 and non-characters are refused", () => {
  for (const picked of [[], ["a"], ["a", "c"]]) {
    const g = barBoard({ rage: 6 });
    barPlay(g, 1, picked);
    assert.equal(zoneOf(g.engine, g.id("bar")), "discard", `${picked.length} picked`);
  }
  const three = barBoard({ rage: 6 });
  refused(() => barPlay(three, 1, ["a", "b", "c"]), "three characters exceed 'or fewer than 2'");
  assert.equal(zoneOf(three.engine, three.id("bar")), "hand");
  assert.equal(ready(three), 6, "nothing spent");
  const gear = barBoard({ rage: 6 });
  refused(() => barPlay(gear, 1, ["it"]), "an item is not a character");
  assert.equal(zoneOf(gear.engine, gear.id("bar")), "hand");
});

clause(BAR, "0:extraCost", "only characters IN PLAY can be picked: a character in hand or in the discard pile is refused", () => {
  const g = buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bar", def: printing(BAR), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "hnd", def: character({ name: "InHand", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "hand" },
      { key: "dsc", def: character({ name: "InDiscard", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "discard" },
      ...res(P1, { rage: 6 })
    ]
  });
  for (const bad of ["hnd", "dsc"]) {
    refused(() => play(g.engine, P1, g.id("bar"), { selected: { picked: [g.id(bad)] }, variables: { x: 1 } }), `${bad} is not a character in play`);
    assert.equal(zoneOf(g.engine, g.id("bar")), "hand", "still in hand");
    assert.equal(g.engine.getAvailableResourceCount(P1), 6, "nothing spent");
  }
  play(g.engine, P1, g.id("bar"), { selected: { picked: [g.id("a")] }, variables: { x: 1 } });
  assert.equal(g.engine.getStat(g.id("a"), "strength"), 3, "control: a character in play is pickable");
});

clause(BAR, "1:rule", "the picked characters gain X strength and X life (X=1, 2, 3); unpicked characters and items are unchanged", () => {
  for (const x of [1, 2, 3]) {
    const g = barBoard({ rage: 6 });
    barPlay(g, x, ["a", "c"]);
    assert.deepEqual(st(g, "a"), [2 + x, 3 + x], `A at X=${x}`);
    assert.deepEqual(st(g, "c"), [3 + x, 4 + x], `the opponent's character C at X=${x}`);
    assert.deepEqual(st(g, "b"), [1, 2], "B not picked");
    assert.equal(g.engine.getStat(g.id("a"), "speed"), 2, "speed unchanged");
  }
  const one = barBoard({ rage: 6 });
  barPlay(one, 2, ["b"]);
  assert.deepEqual(st(one, "b"), [3, 4]);
  assert.deepEqual(st(one, "a"), [2, 3]);
});

clause(BAR, "1:rule", "'This turn': the bonus is gone after the turn ends", () => {
  const g = barBoard({ rage: 6 });
  barPlay(g, 2, ["a", "b"]);
  assert.deepEqual(st(g, "a"), [4, 5]);
  endTurn(g.engine, P1);
  assert.deepEqual(st(g, "a"), [2, 3], "back to printed values");
  assert.deepEqual(st(g, "b"), [1, 2]);
});

// ---------------------------------------------------------------------------------------------
// Boilstorm  (tactic, cost 5 "r"; pick up to 3 characters; X damage divided, X = number of [R] you control)
// ---------------------------------------------------------------------------------------------

function boilBoard(cards: CardPlacement[] = []) {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bs", def: printing(BOIL), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "A", life: 9 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "B", life: 9 }), owner: P1, zone: "play" },
      { key: "c", def: character({ name: "C", life: 9 }), owner: P2, zone: "play" },
      { key: "d", def: character({ name: "D", life: 9 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      ...cards
    ]
  });
}
const shares = (g: ReturnType<typeof boilBoard>, s: Record<string, number>) =>
  g.engine.perform({
    type: "resolvePendingChoice",
    playerId: P1,
    choice: { kind: "distributeAmong", shares: Object.fromEntries(Object.entries(s).map(([k, v]) => [g.id(k), v])) }
  } as never);
const xOf = (g: ReturnType<typeof boilBoard>) => (pending(g.engine) as unknown as { amount: number; kind: string }).amount;
const castBoil = (g: ReturnType<typeof boilBoard>, picked: string[]) =>
  play(g.engine, P1, g.id("bs"), { selected: { cs: picked.map((k) => g.id(k)) } });

clause(BOIL, "0:extraCost", "printed tactic, cost 5 / threshold r: exact, one short, and no [R] are handled", () => {
  printedBody(BOIL, 5, 1, "tactic")();
});

clause(BOIL, "0:extraCost", "'pick 3 or fewer characters': 0..3 characters from either side are accepted; 4, an item, or a card not in play are refused", () => {
  for (const picked of [["a"], ["c"], ["a", "c"], ["a", "b", "c"]]) {
    const g = boilBoard(res(P1, { rage: 6 }));
    castBoil(g, picked);
    const pc = pending(g.engine) as unknown as { kind: string; targets: string[] };
    assert.equal(pc.kind, "distributeAmong");
    assert.deepEqual([...pc.targets].sort(), picked.map((k) => g.id(k)).sort());
    shares(g, { [picked[0]]: 6 });
    assert.equal(zoneOf(g.engine, g.id("bs")), "discard", `${picked.length} picked`);
  }
  const none = boilBoard(res(P1, { rage: 6 }));
  castBoil(none, []);
  assert.equal(zoneOf(none.engine, none.id("bs")), "discard", "zero picks is allowed");
  assert.equal(pending(none.engine), undefined, "nothing to divide among");
  const four = boilBoard(res(P1, { rage: 6 }));
  refused(() => castBoil(four, ["a", "b", "c", "d"]), "4 characters exceed 3");
  assert.equal(zoneOf(four.engine, four.id("bs")), "hand");
  const gear = boilBoard(res(P1, { rage: 6 }));
  refused(() => castBoil(gear, ["it"]), "an item is not a character");
  const inHand = boilBoard([...res(P1, { rage: 6 }), { key: "hc", def: character({ name: "H" }), owner: P1, zone: "hand" }]);
  refused(() => castBoil(inHand, ["hc"]), "a character in hand isn't in play");
});

clause(BOIL, "1:rule", "X is the number of [R] you control: 6 rage -> 6 (cost-spent resources still count), 8 rage -> 8", () => {
  for (const n of [6, 8]) {
    const g = boilBoard(res(P1, { rage: n }));
    castBoil(g, ["a"]);
    assert.equal(xOf(g), n, `${n} [R] controlled`);
  }
  const spent = boilBoard(res(P1, { rage: 5 }, { rage: 3 }));
  castBoil(spent, ["a"]);
  assert.equal(xOf(spent), 8, "spent [R] resources are still controlled");
});

clause(BOIL, "1:rule", "X counts [R] icons only: non-[R] resources, the opponent's [R] and face-down cards don't count; [R][R] counts twice", () => {
  const mixed = boilBoard([...res(P1, { rage: 3, greed: 4 }), ...res(P2, { rage: 5 }, {}, "opp")]);
  castBoil(mixed, ["a"]);
  assert.equal(xOf(mixed), 3, "3 own [R]: greed and the opponent's [R] don't count");
  const dual: CardPlacement = { key: "dual", def: resourceCard({ name: "Dual", resource: { provides: ["rage", "rage"], staple: true } }), owner: P1, zone: "play" };
  const dbl = boilBoard([dual, ...res(P1, { rage: 5 })]);
  castBoil(dbl, ["a"]);
  assert.equal(xOf(dbl), 7, "5 + the [R][R] resource");
  const fd = boilBoard([...res(P1, { rage: 5 }), ...down("fd", 2, P1)]);
  castBoil(fd, ["a"]);
  assert.equal(xOf(fd), 5, "face-down Volition cards provide no [R]");
});

clause(BOIL, "1:rule", "the caster divides the X damage however they want among the picked characters: all on one, an even split, an uneven split across three; unpicked characters and the item take nothing", () => {
  const all = boilBoard(res(P1, { rage: 6 }));
  castBoil(all, ["a", "c"]);
  shares(all, { c: 6 });
  assert.deepEqual(["a", "b", "c", "d", "it"].map((k) => all.engine.state.cards[all.id(k)].damage), [0, 0, 6, 0, 0]);
  const even = boilBoard(res(P1, { rage: 6 }));
  castBoil(even, ["a", "c"]);
  shares(even, { a: 3, c: 3 });
  assert.deepEqual(["a", "b", "c", "d"].map((k) => even.engine.state.cards[even.id(k)].damage), [3, 0, 3, 0]);
  const three = boilBoard(res(P1, { rage: 6 }));
  castBoil(three, ["a", "c", "d"]);
  assert.equal(pending(three.engine) && (pending(three.engine) as unknown as { playerId: string }).playerId, P1, "the caster divides");
  shares(three, { a: 1, c: 2, d: 3 });
  assert.deepEqual(["a", "b", "c", "d"].map((k) => three.engine.state.cards[three.id(k)].damage), [1, 0, 2, 3]);
  assert.equal(pending(three.engine), undefined);
});

clause(BOIL, "1:rule", "damage that reaches a character's life destroys it (opponent's too)", () => {
  const g = boilBoard([...res(P1, { rage: 6 }), { key: "w", def: character({ name: "W", life: 2 }), owner: P2, zone: "play" }]);
  castBoil(g, ["w", "a"]);
  shares(g, { w: 2, a: 4 });
  assert.equal(zoneOf(g.engine, g.id("w")), "discard");
  assert.equal(zoneOf(g.engine, g.id("a")), "play");
  assert.equal(g.engine.state.cards[g.id("a")].damage, 4);
});

clause(BOIL, "1:rule", "'divided': shares may not be more than X, may not go to an unpicked character, may not be negative", () => {
  const over = boilBoard(res(P1, { rage: 6 }));
  castBoil(over, ["a", "c"]);
  refused(() => shares(over, { a: 4, c: 3 }), "7 > X=6");
  refused(() => shares(over, { a: 3, b: 3 }), "b was not picked");
  refused(() => shares(over, { a: 7, c: -1 }), "a negative share");
  assert.equal(kindOf(over), "distributeAmong", "still waiting");
  shares(over, { a: 4, c: 2 });
  assert.equal(dmg(over, "a"), 4);
  assert.equal(dmg(over, "c"), 2);
});

clause(BOIL, "1:rule", "all X damage must be divided: dividing fewer than X is refused", () => {
  const g = boilBoard(res(P1, { rage: 6 }));
  castBoil(g, ["a", "c"]);
  refused(() => shares(g, { a: 2, c: 2 }), "only 4 of 6 damage divided");
  assert.equal(kindOf(g), "distributeAmong");
});
