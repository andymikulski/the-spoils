// Multiplayer clause tests for Shade of the Devoured Emperor, part 2: "each opponent" iterations, "any opponent may pay",
// "that character's controller", "an opponent's attacking party" and the start-of-turn pick.
import assert from "node:assert/strict";
import { character, resourceCard, tactic } from "../../support/fixtures.js";
import { bank } from "../../per-card/_harness.js";
import { clause, clauseMismatch, printing, refused } from "../_clause.js";
import { 
  answer, choosePlayer, filler, go, hand, needs, offered, pay, pcOf, pickCandidates, pickCards, play, settleOrder, table, unit, use, zone, P1, P2, P3, P4, type Board, type Pid, type Placement
 } from "./_shade.js";
import { resolvePendingResponses } from "../../support/fixtures.js";

const TEDIOUS = "5379e1b4-5ccc-457d-8490-82d85615143e";
const LUGUBRIAN_COUNCIL = "e2b65004-fb6d-40f2-8f4c-18ee79e934fd";
const GARGANTUAN = "0070ffff-bc96-4245-a7e8-d376941be247";
const HASSAN_I = "337f6b9c-02ac-4c53-aaf2-e8301635cc03";
const SWINDLE = "f84cac2d-0eb2-4fc8-af31-9a6754c889d6";
const ROCKET_LAWNCHAIR = "1dd0bbbc-1202-41c2-9073-5ce87acaf67e";
const RUNIC_JUNKER = "12b25597-1514-4fc3-9a33-3b32fc436ecb";

const attachedTo = (b: Board, key: string): string | undefined => b.engine.state.cards[b.id(key)]!.attachedTo;
/** `n` resources of `owner` attached to their faction (`factionKey`: __factionA / __factionB / __faction_p3 / __faction_p4). */
const onFaction = (owner: Pid, n: number): Placement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `att-${owner}-${i}`,
    def: resourceCard({ name: `Attached ${owner} ${i}` }),
    owner,
    attachedToKey: owner === P1 ? "__factionA" : owner === P2 ? "__factionB" : `__faction_${owner}`
  }));

// --- Tedious TriAdic Truculence ----------------------------------------------------------------

clauseMismatch(TEDIOUS, "0:ability", "MP-shade-of-the-devoured-emperor-1", "3 seats: no opponent is chosen; the payment of 3 is offered to P2 then P3 (clockwise from P1's left, never P1); the first to pay settles it, the rest are not asked; if all decline each picked character with strength 3 or less is destroyed", () => {
  const board = () =>
    table(3, [
      { key: "ttt", def: printing(TEDIOUS), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1),
      ...bank("rage", 3, P2),
      ...bank("rage", 3, P3),
      ...filler(P1, "deck", 5),
      unit(P1, "weak1", { name: "Weak 1", strength: 2 }),
      unit(P2, "weak2", { name: "Weak 2", strength: 3 }),
      unit(P3, "strong", { name: "Strong", strength: 5 })
    ]);
  const picks = (b: Board) => ({ picks: [b.id("weak1"), b.id("weak2"), b.id("strong")] });
  // P3 pays; P2 declined
  const paid = board();
  assert.equal(needs(paid, play(paid, P1, "ttt")).some((r) => r.kind === "players"), false, "'Any opponent may pay' names no opponent when the card is played");
  go(paid, play(paid, P1, "ttt", { selected: picks(paid) }));
  assert.deepEqual([pcOf(paid.engine)?.kind, pcOf(paid.engine)?.playerId], ["anyPlayerMayPay", P2], "offered to P2 first, never to P1");
  pay(paid, P2, false, "anyPlayerMayPay");
  assert.deepEqual([pcOf(paid.engine)?.kind, pcOf(paid.engine)?.playerId], ["anyPlayerMayPay", P3], "then to P3");
  pay(paid, P3, true, "anyPlayerMayPay");
  assert.equal(paid.engine.state.players[P3].play.filter((id) => paid.engine.state.cards[id]!.attachedTo === undefined).length >= 0, true);
  assert.equal(pcOf(paid.engine)?.kind, "reorderDeck", "the controller looks at the top 3 of their own deck");
  assert.equal(pcOf(paid.engine)?.playerId, P1);
  for (const key of ["weak1", "weak2", "strong"]) assert.equal(zone(paid, key), "play", "the picked characters survive");
  // everyone declines
  const declined = board();
  go(declined, play(declined, P1, "ttt", { selected: picks(declined) }));
  pay(declined, P2, false, "anyPlayerMayPay");
  pay(declined, P3, false, "anyPlayerMayPay");
  assert.deepEqual(["weak1", "weak2", "strong"].map((key) => zone(declined, key)), ["discard", "discard", "play"]);
  // P2 pays: P3 is never asked
  const first = board();
  go(first, play(first, P1, "ttt", { selected: picks(first) }));
  pay(first, P2, true, "anyPlayerMayPay");
  assert.notEqual(pcOf(first.engine)?.playerId, P3, "P3 is never offered once P2 paid");
});

// --- The Lugubrian Council of Quotidian Affairs -----------------------------------------------

clause(LUGUBRIAN_COUNCIL, "3:ability:council-pass", "3 seats: the picked character may belong to either opponent (not the controller); its controller, not the other opponent, may detach up to X resources", () => {
  for (const [victim, other] of [[P3, P2], [P2, P3]] as const) {
    const b = table(3, [
      { key: "council", def: printing(LUGUBRIAN_COUNCIL), owner: P1, zone: "play" },
      { key: "tac", def: tactic({ name: "Cost two", cost: 2 }), owner: P1, zone: "hand" },
      ...bank("rage", 2, P1),
      unit(P1, "mine", { strength: 1 }),
      unit(P2, "v2", { strength: 2 }),
      unit(P3, "v3", { strength: 2 }),
      unit(P2, "big2", { strength: 4 }),
      ...onFaction(P2, 3),
      ...onFaction(P3, 3),
      ...onFaction(P1, 3)
    ]);
    const action = use(b, P1, "council", "council-pass", { selected: { t: [b.id("tac")] } });
    assert.deepEqual(new Set(pickCandidates(b, action)), new Set([b.id("v2"), b.id("v3")]), "both opponents' characters with strength 2 or less; not the controller's, not strength 4");
    go(b, use(b, P1, "council", "council-pass", { selected: { t: [b.id("tac")], v: [b.id(`v${victim.slice(1)}`)] } }));
    assert.equal(zone(b, `v${victim.slice(1)}`), "hand", "returned to its owner's hand");
    assert.equal(pcOf(b.engine)?.playerId, victim, "its controller decides the detach");
    assert.deepEqual(new Set(offered(b)), new Set([0, 1, 2].map((i) => b.id(`att-${victim}-${i}`))), "that player's own attached resources only");
    pickCards(b, victim, [`att-${victim}-0`, `att-${victim}-1`]);
    assert.equal(attachedTo(b, `att-${victim}-0`), undefined);
    assert.equal(attachedTo(b, `att-${victim}-1`), undefined);
    assert.notEqual(attachedTo(b, `att-${victim}-2`), undefined, "X = 2 at most");
    for (const i of [0, 1, 2]) assert.notEqual(attachedTo(b, `att-${other}-${i}`), undefined, "the other opponent detaches nothing");
    assert.equal(pcOf(b.engine), undefined);
  }
});
clause(LUGUBRIAN_COUNCIL, "3:ability:council-pass", "3 seats: a character P3 controls but P2 owns goes to P2's hand while P3, its controller, detaches", () => {
  const b = table(3, [
    { key: "council", def: printing(LUGUBRIAN_COUNCIL), owner: P1, zone: "play" },
    { key: "tac", def: tactic({ name: "Cost two", cost: 2 }), owner: P1, zone: "hand" },
    ...bank("rage", 2, P1),
    unit(P1, "mine"),
    { key: "stolen", def: character({ name: "Stolen", strength: 1 }), owner: P2, controller: P3, zone: "play" },
    ...onFaction(P2, 2),
    ...onFaction(P3, 2)
  ]);
  go(b, use(b, P1, "council", "council-pass", { selected: { t: [b.id("tac")], v: [b.id("stolen")] } }));
  assert.equal(zone(b, "stolen"), "hand");
  assert.equal(b.engine.state.cards[b.id("stolen")]!.ownerId, P2);
  assert.equal(hand(b.engine, P2).includes(b.id("stolen")), true, "in its owner's hand");
  assert.equal(pcOf(b.engine)?.playerId, P3, "its controller P3, not its owner P2, detaches");
  assert.deepEqual(new Set(offered(b)), new Set([b.id("att-p3-0"), b.id("att-p3-1")]));
});

// --- Undevoted Gargantuan ----------------------------------------------------------------------

function gargantuan(seats: 3 | 4, active: Pid = P1): Board {
  return table(
    seats,
    [
      { key: "garg", def: printing(GARGANTUAN), owner: P1, zone: "hand" },
      ...bank("obsession", 5, P1),
      ...onFaction(P1, 3),
      ...onFaction(P2, 4),
      ...onFaction(P3, 4),
      ...(seats === 4 ? onFaction(P4, 4) : [])
    ],
    { active }
  );
}

clause(GARGANTUAN, "1:rule", "3 seats: each opponent in turn (P2 then P3, never P1) may detach up to 3 of their own resources; their choices are independent", () => {
  const b = gargantuan(3);
  go(b, play(b, P1, "garg"));
  const order: Pid[] = [];
  assert.equal(pcOf(b.engine)?.playerId, P2);
  order.push(P2);
  assert.deepEqual(new Set(offered(b)), new Set([0, 1, 2, 3].map((i) => b.id(`att-p2-${i}`))), "only P2's own attached resources");
  pickCards(b, P2, []);
  assert.equal(pcOf(b.engine)?.playerId, P3, "then P3");
  order.push(P3);
  assert.deepEqual(new Set(offered(b)), new Set([0, 1, 2, 3].map((i) => b.id(`att-p3-${i}`))));
  pickCards(b, P3, ["att-p3-0", "att-p3-1", "att-p3-2"]);
  assert.equal(pcOf(b.engine), undefined, "P1 is never asked");
  assert.deepEqual(order, [P2, P3]);
  for (const i of [0, 1, 2, 3]) assert.notEqual(attachedTo(b, `att-p2-${i}`), undefined, "P2 declined: nothing detached");
  for (const i of [0, 1, 2]) assert.equal(attachedTo(b, `att-p3-${i}`), undefined, "P3 detached 3");
  assert.notEqual(attachedTo(b, "att-p3-3"), undefined);
  for (const i of [0, 1, 2]) assert.notEqual(attachedTo(b, `att-p1-${i}`), undefined, "the controller's resources are unchanged");
});
clause(GARGANTUAN, "1:rule", "4 seats: P2, P3 and P4 each may detach up to 3 of their own, active player first and then clockwise; P1 is skipped", () => {
  const b = gargantuan(4);
  go(b, play(b, P1, "garg"));
  const order: Pid[] = [];
  for (let i = 0; i < 3; i++) {
    const pc = pcOf(b.engine)!;
    order.push(pc.playerId);
    assert.deepEqual(new Set(offered(b)), new Set([0, 1, 2, 3].map((n) => b.id(`att-${pc.playerId}-${n}`))), "own resources only");
    pickCards(b, pc.playerId, [`att-${pc.playerId}-0`]);
  }
  assert.deepEqual(order, [P2, P3, P4]);
  assert.equal(pcOf(b.engine), undefined);
  for (const owner of [P2, P3, P4]) assert.equal(attachedTo(b, `att-${owner}-0`), undefined);
  for (const i of [0, 1, 2]) assert.notEqual(attachedTo(b, `att-p1-${i}`), undefined);
});
clause(GARGANTUAN, "1:rule", "4 seats: entering play during P3's turn, the opponents are asked P3, P4, P2 (the active player first, then clockwise)", () => {
  const b = table(
    4,
    [
      { key: "garg", def: printing(GARGANTUAN), owner: P1, zone: "hand" },
      {
        key: "summon",
        owner: P1,
        zone: "hand",
        def: tactic({
          name: "Summon",
          behavior: {
            abilities: [
              {
                id: "summon",
                type: "activated",
                targets: [{ id: "g", selector: { zone: "hand", type: "character", controller: "self" }, count: 1 }],
                effects: [{ type: "putIntoPlay", target: { type: "selected", id: "g" }, controller: "controller" }]
              }
            ]
          }
        })
      },
      { key: "bait", def: character({ name: "Bait" }), owner: P3, zone: "hand" },
      ...onFaction(P2, 2),
      ...onFaction(P3, 2),
      ...onFaction(P4, 2)
    ],
    { active: P3, turn: 3 }
  );
  b.engine.perform(play(b, P3, "bait"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId !== P3, true);
  while (b.engine.state.responseWindow?.priorityPlayerId !== P1) b.engine.perform({ type: "passPriority", playerId: b.engine.state.responseWindow!.priorityPlayerId });
  b.engine.perform(play(b, P1, "summon", { selected: { g: [b.id("garg")] } }));
  resolvePendingResponses(b.engine);
  const order: Pid[] = [];
  for (let guard = 0; guard < 3 && pcOf(b.engine)?.kind === "chooserSelectsTarget"; guard++) {
    order.push(pcOf(b.engine)!.playerId);
    pickCards(b, pcOf(b.engine)!.playerId, []);
  }
  assert.deepEqual(order, [P3, P4, P2], "the active player first, then clockwise, P1 skipped");
});

// --- Hassan-i of Thabbash ----------------------------------------------------------------------

const slay = (): Placement => ({
  key: "slay",
  owner: P1,
  zone: "hand",
  def: tactic({
    name: "Slay",
    behavior: {
      abilities: [
        { id: "slay", type: "activated", targets: [{ id: "t", selector: { type: "character", controller: "self", name: "Hassan-i of Thabbash" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  })
});
function hassan(seats: 3 | 4, counts: Partial<Record<Pid, number>>): Board {
  return table(seats, [
    { key: "hassan", def: printing(HASSAN_I), owner: P1, zone: "play" },
    slay(),
    unit(P1, "mine", { name: "Mine" }),
    ...([P2, P3, P4] as Pid[]).slice(0, seats - 1).flatMap((owner) => Array.from({ length: counts[owner] ?? 0 }, (_, i) => unit(owner, `${owner}-c${i}`, { name: `${owner} char ${i}` })))
  ]);
}
clause(HASSAN_I, "0:rule", "3 seats: each opponent in turn (P2 then P3, never P1) destroys a character they control, picked from their own characters; an opponent with none destroys nothing", () => {
  const b = hassan(3, { [P2]: 2, [P3]: 2 });
  go(b, play(b, P1, "slay", { selected: { t: [b.id("hassan")] } }));
  assert.equal(pcOf(b.engine)?.playerId, P2);
  assert.deepEqual(new Set(offered(b)), new Set([b.id("p2-c0"), b.id("p2-c1")]), "only P2's own characters");
  pickCards(b, P2, ["p2-c1"]);
  assert.equal(pcOf(b.engine)?.playerId, P3);
  assert.deepEqual(new Set(offered(b)), new Set([b.id("p3-c0"), b.id("p3-c1")]), "only P3's own characters");
  pickCards(b, P3, ["p3-c0"]);
  assert.equal(pcOf(b.engine), undefined);
  assert.deepEqual(["p2-c0", "p2-c1", "p3-c0", "p3-c1", "mine"].map((key) => zone(b, key)), ["play", "discard", "discard", "play", "play"]);
  const empty = hassan(3, { [P2]: 1 });
  go(empty, play(empty, P1, "slay", { selected: { t: [empty.id("hassan")] } }));
  pickCards(empty, P2, ["p2-c0"]);
  assert.equal(pcOf(empty.engine), undefined, "P3 has no character: nothing is asked of them");
  assert.equal(zone(empty, "mine"), "play");
});
clause(HASSAN_I, "0:rule", "4 seats: P2, P3 and P4 each destroy one of their own characters in turn; P1's characters are untouched", () => {
  const b = hassan(4, { [P2]: 1, [P3]: 1, [P4]: 2 });
  go(b, play(b, P1, "slay", { selected: { t: [b.id("hassan")] } }));
  const order: Pid[] = [];
  for (let guard = 0; guard < 3 && pcOf(b.engine); guard++) {
    const who = pcOf(b.engine)!.playerId;
    order.push(who);
    assert.equal(offered(b).every((id) => b.engine.state.cards[id]!.controllerId === who), true, "own characters only");
    pickCards(b, who, [offered(b)[0] === b.id(`${who}-c0`) ? `${who}-c0` : `${who}-c1`]);
  }
  assert.deepEqual(order, [P2, P3, P4]);
  assert.deepEqual([zone(b, "p2-c0"), zone(b, "p3-c0"), zone(b, "p4-c0"), zone(b, "p4-c1"), zone(b, "mine")], ["discard", "discard", "discard", "play", "play"]);
});

// --- Swindle -----------------------------------------------------------------------------------

const spareResources = (owner: Pid, n: number): Placement[] => Array.from({ length: n }, (_, i) => ({ key: `spare-${owner}-${i}`, def: resourceCard({ name: `Spare ${owner} ${i}` }), owner, zone: "play" as const }));
function swindle(seats: 3 | 4, spare: Partial<Record<Pid, number>>): Board {
  return table(seats, [
    { key: "sw", def: printing(SWINDLE), owner: P1, zone: "hand" },
    ...bank("greed", 2, P1),
    ...bank("rage", 2, P1),
    ...filler(P1, "deck", 2),
    ...filler(P1, "hand", 1),
    ...([P1, P2, P3, P4] as Pid[]).slice(0, seats).flatMap((owner) => spareResources(owner, spare[owner] ?? 0))
  ]);
}
clauseMismatch(SWINDLE, "0:ability", "MP-shade-of-the-devoured-emperor-2", "3 seats: nobody may respond; each opponent in turn attaches one of their own unattached resources to their own faction; P1 then draws and discards once", () => {
  const b = swindle(3, { [P1]: 2, [P2]: 2, [P3]: 2 });
  b.engine.perform(play(b, P1, "sw"));
  assert.equal(b.engine.state.responseWindow, undefined, "no opponent may respond to it");
  assert.equal(pcOf(b.engine)?.playerId, P2);
  assert.deepEqual(new Set(offered(b)), new Set([b.id("spare-p2-0"), b.id("spare-p2-1")]), "P2's own unattached resources only");
  pickCards(b, P2, ["spare-p2-1"]);
  assert.equal(pcOf(b.engine)?.playerId, P3);
  assert.deepEqual(new Set(offered(b)), new Set([b.id("spare-p3-0"), b.id("spare-p3-1")]));
  pickCards(b, P3, ["spare-p3-0"]);
  assert.equal(attachedTo(b, "spare-p2-1"), b.engine.state.players[P2].factionId, "attached to their own faction");
  assert.equal(attachedTo(b, "spare-p3-0"), b.engine.state.players[P3].factionId);
  assert.equal(attachedTo(b, "spare-p2-0"), undefined);
  assert.equal(attachedTo(b, "spare-p1-0"), undefined, "the controller's resources are not touched");
  assert.equal(pcOf(b.engine)?.playerId, P1, "the controller discards once");
  assert.equal(hand(b.engine, P1).length, 2, "and drew exactly one card");
  pickCards(b, P1, [`hand-p1-0`]);
  assert.equal(pcOf(b.engine), undefined);
  const none = swindle(3, { [P2]: 1 });
  go(none, play(none, P1, "sw"));
  pickCards(none, P2, ["spare-p2-0"]);
  assert.equal(pcOf(none.engine)?.playerId, P1, "P3 has no unattached resource and attaches nothing: straight to the controller's discard");
});
clauseMismatch(SWINDLE, "0:ability", "MP-shade-of-the-devoured-emperor-2", "4 seats: none of the three opponents may respond; each attaches one of their own in turn; P1 draws and discards once", () => {
  const b = swindle(4, { [P2]: 1, [P3]: 1, [P4]: 1 });
  b.engine.perform(play(b, P1, "sw"));
  assert.equal(b.engine.state.responseWindow, undefined);
  const order: Pid[] = [];
  for (let guard = 0; guard < 4 && pcOf(b.engine); guard++) {
    const who = pcOf(b.engine)!.playerId;
    order.push(who);
    answer(b, who, { kind: "chooserSelectsTarget", selected: [offered(b)[0]] });
  }
  assert.deepEqual(order, [P2, P3, P4, P1], "every opponent attaches, then the controller discards");
  assert.equal(hand(b.engine, P1).length, 1);
});

// --- Rocket Lawnchair --------------------------------------------------------------------------

function lawnchair(): Board {
  return table(
    3,
    [
      { key: "chair", def: printing(ROCKET_LAWNCHAIR), owner: P1, zone: "play" },
      unit(P1, "mine"),
      unit(P2, "a1", { name: "Attacker 1" }),
      unit(P2, "a2", { name: "Attacker 2" }),
      unit(P3, "c3", { name: "Char 3" })
    ],
    { active: P2, turn: 2 }
  );
}
function attackAndGetPriority(b: Board): void {
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("a1"), b.id("a2")], target: { type: "faction", playerId: P3 } });
  for (let guard = 0; guard < 4 && b.engine.state.responseWindow?.priorityPlayerId !== P1; guard++) b.engine.perform({ type: "passPriority", playerId: b.engine.state.responseWindow!.priorityPlayerId });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond to the attack");
}
clause(ROCKET_LAWNCHAIR, "1:ability:rocket-lawnchair-no-eject", "3 seats: P1 picks the opponent first (P2 or P3) and the second pick is limited to that opponent's characters; a member of P2's attacking party takes the whole party with it", () => {
  const b = lawnchair();
  attackAndGetPriority(b);
  const base = use(b, P1, "chair", "rocket-lawnchair-no-eject");
  assert.deepEqual(needs(b, base)[0], { kind: "players", choices: [{ id: "opponent", candidates: [P2, P3] }] }, "the opponent is asked first");
  assert.deepEqual(new Set(pickCandidates(b, { ...base, players: { opponent: P2 } } as never, "theirs")), new Set([b.id("a1"), b.id("a2")]), "only P2's characters when P2 is the opponent");
  assert.deepEqual(pickCandidates(b, { ...base, players: { opponent: P3 } } as never, "theirs"), [b.id("c3")], "only P3's characters when P3 is the opponent");
  assert.deepEqual(pickCandidates(b, { ...base, players: { opponent: P3 } } as never, "mine"), [b.id("mine")], "the first pick is the controller's own character");
  refused(() => b.engine.perform({ ...base, players: { opponent: P2 }, selected: { mine: [b.id("mine")], theirs: [b.id("c3")] } } as never), "a character of the opponent who was not chosen");
  b.engine.perform({ ...base, players: { opponent: P2 }, selected: { mine: [b.id("mine")], theirs: [b.id("a1")] } } as never);
  resolvePendingResponses(b.engine);
  assert.deepEqual(["chair", "mine", "a1", "a2", "c3"].map((key) => zone(b, key)), ["discard", "discard", "discard", "discard", "play"], "both picked and the whole attacking party are destroyed; P3's character is not");
});
clause(ROCKET_LAWNCHAIR, "1:ability:rocket-lawnchair-no-eject", "3 seats: with P3 chosen and a P3 character picked, the picked pair dies but P2's attacking party survives", () => {
  const b = lawnchair();
  attackAndGetPriority(b);
  b.engine.perform(use(b, P1, "chair", "rocket-lawnchair-no-eject", { players: { opponent: P3 }, selected: { mine: [b.id("mine")], theirs: [b.id("c3")] } }));
  resolvePendingResponses(b.engine);
  assert.deepEqual(["mine", "c3", "a1", "a2"].map((key) => zone(b, key)), ["discard", "discard", "play", "play"], "neither picked character was in the party");
});

// --- Runic Junker ------------------------------------------------------------------------------

function junker(downs: number, resources = 4): Board {
  return table(
    3,
    [
      { key: "junker", def: printing(RUNIC_JUNKER), owner: P1, zone: "play" },
      ...bank("rage", resources, P1),
      ...Array.from({ length: downs }, (_, i): Placement => ({ key: `dn-${i}`, def: character({ name: `Down ${i}`, cost: 0 }), owner: P1, zone: "play", faceDown: true })),
      ...onFaction(P2, 0)
    ],
    { active: P3, turn: 3 }
  );
}
function startP1Turn(b: Board): void {
  b.engine.perform({ type: "endTurn", playerId: P3 });
  resolvePendingResponses(b.engine);
  settleOrder(b);
}
clause(RUNIC_JUNKER, "0:rule", "3 seats: at the start of P1's turn, after paying 4 with 2 face-down resources controlled, P1 picks an opponent; only that opponent picks the face-down resource", () => {
  for (const [picked, other] of [[P2, P3], [P3, P2]] as const) {
    const b = junker(2);
    startP1Turn(b);
    assert.equal(pcOf(b.engine)?.kind, "mayPay");
    assert.equal(pcOf(b.engine)?.playerId, P1);
    pay(b, P1, true);
    assert.equal(pcOf(b.engine)?.kind, "choosePlayer", "now the controller picks an opponent");
    assert.equal(pcOf(b.engine)?.playerId, P1);
    assert.deepEqual((pcOf(b.engine) as unknown as { candidates: Pid[] }).candidates, [P2, P3]);
    choosePlayer(b, P1, picked);
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
    assert.equal(pcOf(b.engine)?.playerId, picked, "the picked opponent (not the other one) picks");
    assert.notEqual(pcOf(b.engine)?.playerId, other);
    assert.deepEqual(new Set(offered(b)), new Set([b.id("dn-0"), b.id("dn-1")]), "among the controller's face-down resources");
    pickCards(b, picked, ["dn-0"]);
  }
});
clause(RUNIC_JUNKER, "0:rule", "3 seats: no opponent is picked when P1 does not pay 4, or controls fewer than 2 face-down resources", () => {
  const declined = junker(2);
  startP1Turn(declined);
  pay(declined, P1, false);
  assert.equal(pcOf(declined.engine), undefined, "no payment, nothing happens and nobody is asked");
  const few = junker(1);
  startP1Turn(few);
  assert.equal(pcOf(few.engine)?.kind, "mayPay");
  pay(few, P1, true);
  assert.notEqual(pcOf(few.engine)?.kind, "choosePlayer", "with fewer than 2 face-down resources no opponent is picked");
  assert.equal(pcOf(few.engine), undefined);
});

// <<END>>
