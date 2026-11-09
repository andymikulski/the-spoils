// Multiplayer clause tests for Shade of the Devoured Emperor, part 4: the clauses whose data already says what the printed
// text means at any table size (card-relative players, "each player", "any player"): they still prove it at 3 and 4 seats.
import assert from "node:assert/strict";
import { character, resourceCard } from "../../support/fixtures.js";
import { bank } from "../../per-card/_harness.js";
import { mpClause, printing } from "../_clause.js";
import { 
  answer, filler, go, hand, deck, infl, needs, offered, pay, pcOf, pickCandidates, pickCards, pickOption, play, table, unit, zone, P1, P2, P3, P4, type Board, type Pid, type Placement
 } from "./_shade.js";
import { resolvePendingResponses } from "../../support/fixtures.js";

const EXPEDITION = "e0a7e6af-da4e-4442-ade8-d1b0547deb11";
const TRANSPOSITION = "5da75ce7-9ae6-484f-8bd5-ee7deeba9532";
const STUDY_DISTURBANCE = "9107d563-b481-4bb2-8878-64589951e341";
const UNDERWHELMING = "734238ce-7a57-4fda-b9a8-86c4aef822c2";
const AUDACIOUS = "0a308026-4ef1-4c86-ad13-64df84f0f6cd";
const CONTRACTUAL = "fd6b9183-805b-44d0-a3c0-dbb0758bd4b8";

const attachedTo = (b: Board, key: string): string | undefined => b.engine.state.cards[b.id(key)]!.attachedTo;
const onFaction = (owner: Pid, n: number): Placement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `att-${owner}-${i}`,
    def: resourceCard({ name: `Attached ${owner} ${i}` }),
    owner,
    attachedToKey: owner === P1 ? "__factionA" : owner === P2 ? "__factionB" : `__faction_${owner}`
  }));
const faction = (b: Board, who: Pid): string => b.engine.state.players[who].factionId!;
/** Passes priority until `who` holds it (a response window opened by someone else's play). */
function reachPriority(b: Board, who: Pid): void {
  for (let guard = 0; guard < 8 && b.engine.state.responseWindow?.priorityPlayerId !== who; guard++) b.engine.perform({ type: "passPriority", playerId: b.engine.state.responseWindow!.priorityPlayerId });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, who);
}

// --- Expedition Endeavour ----------------------------------------------------------------------

const expedition = (): Board =>
  table(3, [
    { key: "ee", def: printing(EXPEDITION), owner: P1, zone: "hand" },
    ...bank("obsession", 3, P1),
    { key: "arc", def: character({ name: "Arcanist", trade: "arcanist" }), owner: P1, zone: "deck" },
    ...filler(P1, "deck", 2),
    unit(P1, "c1"),
    unit(P1, "c1b"),
    unit(P2, "c2"),
    unit(P3, "c3"),
    ...onFaction(P1, 6),
    ...onFaction(P2, 3),
    ...onFaction(P3, 3)
  ]);

mpClause(EXPEDITION, "1:option:OPTION 1", 3, "3 seats: the controller picks the opponent before the cost; only that opponent may detach up to 3 of their own resources; then P1 may search for an Arcanist", () => {
  for (const [picked, other] of [[P3, P2], [P2, P3]] as const) {
    const b = expedition();
    assert.deepEqual(needs(b, play(b, P1, "ee", { mode: 0 }))[0], { kind: "players", choices: [{ id: "opponent", candidates: [P2, P3] }] });
    go(b, play(b, P1, "ee", { mode: 0, players: { opponent: picked }, selected: { c: [b.id("arc")] } }));
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
    assert.equal(pcOf(b.engine)?.playerId, picked, "the chosen opponent decides the detach");
    assert.deepEqual(new Set(offered(b)), new Set([0, 1, 2].map((i) => b.id(`att-${picked}-${i}`))), "only that opponent's own attached resources");
    pickCards(b, picked, [`att-${picked}-0`, `att-${picked}-1`, `att-${picked}-2`]);
    for (const i of [0, 1, 2]) assert.equal(attachedTo(b, `att-${picked}-${i}`), undefined);
    for (const i of [0, 1, 2]) assert.notEqual(attachedTo(b, `att-${other}-${i}`), undefined, "the other opponent's resources are untouched");
    assert.equal(hand(b.engine, P1).includes(b.id("arc")), true, "P1 found the Arcanist");
  }
  const none = expedition();
  go(none, play(none, P1, "ee", { mode: 0, players: { opponent: P3 }, selected: { c: [] } }));
  pickCards(none, P3, []);
  for (const i of [0, 1, 2]) assert.notEqual(attachedTo(none, `att-${P3}-${i}`), undefined, "P3 may detach none");
});
mpClause(EXPEDITION, ["0:rule", "2:option:OPTION 2"], 3, "3 seats: OPTION 2 asks for no opponent; P1 chooses X, depletes X characters and detaches X+3 of P1's own resources; P2 and P3 are not asked or affected", () => {
  const b = expedition();
  const action = play(b, P1, "ee", { mode: 1, variables: { x: 1 } });
  assert.equal(needs(b, action).some((r) => r.kind === "players"), false, "no opponent is chosen");
  go(b, play(b, P1, "ee", { mode: 1, variables: { x: 1 }, selected: { dep: [b.id("c1")] } }));
  assert.equal(pcOf(b.engine)?.playerId, P1);
  const offeredNow = offered(b);
  for (const i of [0, 1, 2, 3, 4, 5]) assert.equal(offeredNow.includes(b.id(`att-${P1}-${i}`)), true, "P1's own attached resources are offered");
  assert.equal(offeredNow.every((id) => b.engine.state.cards[id]!.ownerId === P1), true, "nothing of P2's or P3's");
  pickCards(b, P1, [0, 1, 2, 3].map((i) => `att-${P1}-${i}`));
  assert.equal(b.engine.state.cards[b.id("c1")]!.depleted, true);
  assert.equal(b.engine.state.cards[b.id("c2")]!.depleted, false);
  for (const owner of [P2, P3]) for (const i of [0, 1, 2]) assert.notEqual(attachedTo(b, `att-${owner}-${i}`), undefined);
});
mpClause(EXPEDITION, ["0:rule", "3:option:OPTION 3"], 3, "3 seats: OPTION 3 asks for no opponent; P1 picks any character (P1's, P2's or P3's) and it gains COVERT this turn", () => {
  for (const key of ["c1", "c2", "c3"]) {
    const b = expedition();
    const action = play(b, P1, "ee", { mode: 2 });
    assert.equal(needs(b, action).some((r) => r.kind === "players"), false);
    assert.deepEqual(new Set(pickCandidates(b, action)), new Set([b.id("c1"), b.id("c1b"), b.id("c2"), b.id("c3")]));
    go(b, play(b, P1, "ee", { mode: 2, selected: { ch: [b.id(key)] } }));
    assert.equal((b.engine.getKeywords(b.id(key)) as string[]).includes("covert"), true);
    for (const other of ["c1", "c2", "c3"].filter((k) => k !== key)) assert.equal((b.engine.getKeywords(b.id(other)) as string[]).includes("covert"), false);
    assert.equal(pcOf(b.engine), undefined);
  }
});

// --- Quotidian Transposition -------------------------------------------------------------------

const transposition = (seats: 3 | 4, owned: Partial<Record<Pid, number>>, active: Pid = P1): Board =>
  table(
    seats,
    [
      { key: "qt", def: printing(TRANSPOSITION), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1),
      { key: "bait", def: character({ name: "Bait", cost: 0 }), owner: active, zone: "hand" },
      ...([P1, P2, P3, P4] as Pid[]).slice(0, seats).flatMap((owner) => Array.from({ length: owned[owner] ?? 0 }, (_, i) => unit(owner, `u-${owner}-${i}`)))
    ],
    { active, turn: [P1, P2, P3, P4].indexOf(active) + 1 }
  );
function eachPicks(b: Board, expected: Pid[]): void {
  const order: Pid[] = [];
  for (let guard = 0; guard < 4 && pcOf(b.engine)?.kind === "chooserSelectsTarget"; guard++) {
    const who = pcOf(b.engine)!.playerId;
    order.push(who);
    const own = offered(b);
    assert.equal(own.length > 0 && own.every((id) => b.engine.state.cards[id]!.ownerId === who && b.engine.state.cards[id]!.controllerId === who), true, `${who} picks among their own characters only`);
    answer(b, who, { kind: "chooserSelectsTarget", selected: [own[0]] });
  }
  assert.deepEqual(order, expected);
}
mpClause(TRANSPOSITION, "0:rule", 3, "3 seats: P1, P2 and P3 each in turn pick a character they own and return it to their hand; a player with no character skips", () => {
  const b = transposition(3, { [P1]: 2, [P2]: 2, [P3]: 2 });
  go(b, play(b, P1, "qt"));
  eachPicks(b, [P1, P2, P3]);
  for (const owner of [P1, P2, P3]) assert.equal([0, 1].filter((i) => zone(b, `u-${owner}-${i}`) === "hand").length, 1, `${owner} returned exactly one of their own`);
  assert.deepEqual([P1, P2, P3].map((p) => b.engine.state.players[p].play.filter((id) => b.engine.getDefinition(id).type === "character").length), [1, 1, 1]);
  const skip = transposition(3, { [P1]: 1, [P2]: 1 });
  go(skip, play(skip, P1, "qt"));
  eachPicks(skip, [P1, P2]);
  assert.equal(pcOf(skip.engine), undefined, "P3 owns no character: nothing is asked");
});
mpClause(TRANSPOSITION, "0:rule", 4, "4 seats: played during P3's turn, the picks go P3, P4, P1, P2 (active player first, then clockwise); each returns one of their own", () => {
  const b = transposition(4, { [P1]: 1, [P2]: 1, [P3]: 1, [P4]: 1 }, P3);
  b.engine.perform(play(b, P3, "bait"));
  reachPriority(b, P1);
  b.engine.perform(play(b, P1, "qt"));
  resolvePendingResponses(b.engine);
  eachPicks(b, [P3, P4, P1, P2]);
  for (const owner of [P1, P2, P3, P4]) assert.equal(zone(b, `u-${owner}-0`), "hand", `${owner} returned their own character`);
});

// --- Study Disturbance -------------------------------------------------------------------------

function study(active: Pid = P1): Board {
  return table(
    3,
    [
      { key: "sd", def: printing(STUDY_DISTURBANCE), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1),
      ...bank("rage", 2, P2),
      ...bank("rage", 2, P3),
      ...filler(P1, "deck", 3),
      ...filler(P2, "deck", 3),
      ...filler(P3, "deck", 3),
      { key: "char1", def: character({ name: "P1 char", cost: 0 }), owner: P1, zone: "hand" },
      { key: "bait", def: character({ name: "Bait", cost: 0 }), owner: active, zone: "hand" }
    ],
    { active, turn: [P1, P2, P3].indexOf(active) + 1 }
  );
}
const looks = (b: Board) => b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").map((entry) => entry.event as unknown as { ownerId: Pid; viewerId: Pid; cardIds: string[] });

mpClause(STUDY_DISTURBANCE, "0:ability", 3, "3 seats: P1 may pick any player (P1, P2 or P3); only the picked player is asked to pay 2", () => {
  const b = study();
  assert.deepEqual(new Set(pickCandidates(b, play(b, P1, "sd"))), new Set([faction(b, P1), faction(b, P2), faction(b, P3)]), "every player's faction is a legal pick");
  for (const picked of [P2, P3]) {
    const c = study();
    go(c, play(c, P1, "sd", { selected: { p: [faction(c, picked)] } }));
    assert.equal(pcOf(c.engine)?.kind, "mayPay");
    assert.equal(pcOf(c.engine)?.playerId, picked, "only the picked player is asked");
  }
});
mpClause(STUDY_DISTURBANCE, "0:ability", 3, "3 seats: if the picked P3 pays 2, P1 looks at the top card of P1's own deck; otherwise P3 cannot play characters this turn (not P1 or P2) and P1 draws a card", () => {
  const paid = study();
  go(paid, play(paid, P1, "sd", { selected: { p: [faction(paid, P3)] } }));
  pay(paid, P3, true);
  assert.equal(paid.engine.getAvailableResourceCount(P3), 0, "P3 paid 2");
  assert.equal(paid.engine.getAvailableResourceCount(P2), 2, "P2 paid nothing");
  assert.deepEqual(looks(paid).map((entry) => [entry.ownerId, entry.viewerId]), [[P1, P1]], "P1 looks at the top card of P1's own deck");
  assert.equal(hand(paid.engine, P1).includes(paid.id("char1")), true);
  assert.equal(paid.engine.getCardPlayability(P1, paid.id("char1")).playable, true, "no restriction on P1 when P3 paid");

  const declined = study();
  const handBefore = hand(declined.engine, P1).length;
  go(declined, play(declined, P1, "sd", { selected: { p: [faction(declined, P3)] } }));
  pay(declined, P3, false);
  assert.equal(hand(declined.engine, P1).length, handBefore, "P1 drew a card (and spent the played one)");
  assert.equal(deck(declined.engine, P1).length, 2);
  assert.equal(declined.engine.getCardPlayability(P1, declined.id("char1")).playable, true, "P1 can still play characters");
  const restricted = study(P3);
  restricted.engine.perform(play(restricted, P3, "bait"));
  reachPriority(restricted, P1);
  go(restricted, play(restricted, P1, "sd", { selected: { p: [faction(restricted, P3)] } }));
  pay(restricted, P3, false);
  assert.equal(looks(restricted).length, 0);
});
mpClause(STUDY_DISTURBANCE, "0:ability", 3, "3 seats: P1 may pick P1 itself; then P1 decides, and declining stops P1 from playing characters this turn", () => {
  const b = study();
  go(b, play(b, P1, "sd", { selected: { p: [faction(b, P1)] } }));
  assert.equal(pcOf(b.engine)?.playerId, P1);
  pay(b, P1, false);
  assert.equal(b.engine.getCardPlayability(P1, b.id("char1")).playable, false, "P1 cannot play characters this turn");
});

// --- Underwhelming Performance -----------------------------------------------------------------

mpClause(UNDERWHELMING, "0:ability", 3, "3 seats: the picked character's controller (P3, not P2 or P1) may detach up to 2 of their own resources; the character loses 6 strength and P1 draws", () => {
  for (const victim of [P3, P2, P1]) {
    const b = table(3, [
      { key: "up", def: printing(UNDERWHELMING), owner: P1, zone: "hand" },
      ...bank("obsession", 3, P1),
      ...filler(P1, "deck", 2),
      unit(P1, "c1", { strength: 7 }),
      unit(P2, "c2", { strength: 7 }),
      unit(P3, "c3", { strength: 7 }),
      ...onFaction(P1, 2),
      ...onFaction(P2, 2),
      ...onFaction(P3, 2)
    ]);
    const key = `c${victim.slice(1)}`;
    go(b, play(b, P1, "up", { selected: { ch: [b.id(key)] } }));
    assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
    assert.equal(pcOf(b.engine)?.playerId, victim, "that character's controller, nobody else");
    assert.deepEqual(new Set(offered(b)), new Set([0, 1].map((i) => b.id(`att-${victim}-${i}`))), "their own attached resources");
    pickCards(b, victim, [`att-${victim}-0`, `att-${victim}-1`]);
    assert.equal(b.engine.getStat(b.id(key), "strength"), 1, "loses 6 strength");
    assert.equal(hand(b.engine, P1).length, 1, "P1 drew a card");
    assert.equal(attachedTo(b, `att-${victim}-0`), undefined);
    for (const other of [P1, P2, P3].filter((p) => p !== victim)) assert.notEqual(attachedTo(b, `att-${other}-0`), undefined, `${other}'s resources untouched`);
  }
});

// --- Audacious Appraisal -----------------------------------------------------------------------

mpClause(AUDACIOUS, "0:ability", 3, "3 seats: the picked character's controller chooses X; P1 chooses: that controller's faction loses X, or the character is destroyed and P1's faction loses 2X; the other opponent's faction is untouched", () => {
  for (const victim of [P3, P2]) {
    const other = victim === P3 ? P2 : P3;
    const board = () =>
      table(3, [
        { key: "aa", def: printing(AUDACIOUS), owner: P1, zone: "hand" },
        ...bank("greed", 2, P1),
        unit(P2, "c2"),
        unit(P3, "c3")
      ]);
    const key = `c${victim.slice(1)}`;
    const a = board();
    go(a, play(a, P1, "aa", { selected: { ch: [a.id(key)] } }));
    assert.equal(pcOf(a.engine)?.kind, "chooseNumber");
    assert.equal(pcOf(a.engine)?.playerId, victim, "the character's controller chooses X");
    answer(a, victim, { kind: "chooseNumber", value: 4 });
    assert.equal(pcOf(a.engine)?.playerId, P1, "P1 chooses the branch");
    pickOption(a, P1, 0);
    assert.deepEqual([P1, victim, other].map((p) => infl(a.engine, p)), [25, 21, 25]);
    assert.equal(zone(a, key), "play");
    const b = board();
    go(b, play(b, P1, "aa", { selected: { ch: [b.id(key)] } }));
    answer(b, victim, { kind: "chooseNumber", value: 3 });
    pickOption(b, P1, 1);
    assert.deepEqual([P1, victim, other].map((p) => infl(b.engine, p)), [19, 25, 25]);
    assert.equal(zone(b, key), "discard");
  }
});

// --- Contractual Execution ---------------------------------------------------------------------

mpClause(CONTRACTUAL, "0:ability", 3, "3 seats: the picked character's controller picks a resource they control, which goes to its owner's hand (a loaned one to its owner P3); then the character is flipped face down", () => {
  const board = () =>
    table(3, [
      { key: "ce", def: printing(CONTRACTUAL), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1),
      unit(P2, "c2"),
      unit(P3, "c3"),
      ...[P2, P3].flatMap((owner) => [0, 1].map((i): Placement => ({ key: `res-${owner}-${i}`, def: resourceCard({ name: `Res ${owner} ${i}` }), owner, zone: "play" }))),
      { key: "loaned", def: resourceCard({ name: "Loaned" }), owner: P3, controller: P2, zone: "play" }
    ]);
  const b = board();
  go(b, play(b, P1, "ce", { selected: { ch: [b.id("c2")] } }));
  assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pcOf(b.engine)?.playerId, P2, "the character's controller picks, not P3");
  assert.deepEqual(new Set(offered(b)), new Set([b.id("res-p2-0"), b.id("res-p2-1"), b.id("loaned")]), "resources P2 controls");
  pickCards(b, P2, ["loaned"]);
  assert.equal(hand(b.engine, P3).includes(b.id("loaned")), true, "to its owner's hand");
  assert.equal(b.engine.state.cards[b.id("c2")]!.faceDown, true, "the character is flipped face down");
  const c = board();
  go(c, play(c, P1, "ce", { selected: { ch: [c.id("c3")] } }));
  assert.equal(pcOf(c.engine)?.playerId, P3, "a P3-controlled character: P3 picks");
  assert.deepEqual(new Set(offered(c)), new Set([c.id("res-p3-0"), c.id("res-p3-1")]));
});

// <<END>>
