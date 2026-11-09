// Multiplayer (free-for-all) clause tests: Ungodly Mess, part 6: more clauses the spec marks `unchanged`: God's Blessing of Readiness,
// Undesirable Intrusion, Camouflaged Urchin, Carnival Funhouse, Cicibeo the Implicator, Lost on Floor 3, Trickster's Globe,
// Breath of the Barduse and Silencer.
import assert from "node:assert/strict";
import type { PlayerId } from "../../../../engine.js";
import { autoResolveBattle, bank, character, resolvePendingResponses, tactic } from "../../per-card/_harness.js";
import { zoneOf } from "../_board.js";
import { clause, printing, refused } from "../_clause.js";
import { P1, P2, P3, P4, act, activate, answerChoice, choose, chooseIndex, handOf, influence, mayPay, offered, pass, pending, play, playRaw, playerAsk, requirements, seated, spent, table, type Table } from "./_ungodly-mess.js";

const BLESSING = "c71f0071-5ef8-4b3b-9356-149cad14c9bd"; // God's Blessing of Readiness
const INTRUSION = "cbffb937-448e-425e-ac37-fa1d856a07c8"; // Undesirable Intrusion
const URCHIN = "a138d554-4fdb-4234-9362-d120f7b13bd2"; // Camouflaged Urchin
const FUNHOUSE = "b58eb946-a9fe-4661-bc06-c4607cc448cd"; // Carnival Funhouse
const CICIBEO = "f0e7f09c-4354-4042-9454-0aea33e7d133"; // Cicibeo, The Implicator
const LOST = "62ddcc7c-6229-43a5-b656-2c1fd2593b05"; // Lost on Floor 3
const GLOBE = "c47c8579-7fdc-49e7-b934-f3e86c37dc13"; // Trickster's Globe
const BREATH = "f28ced68-ff65-4257-8e08-178a51d9e15e"; // Breath of the Barduse
const SILENCER = "dae21a35-cc0b-4da5-8a97-1a178ce4a9a0"; // Silencer

const idle = (name: string) => tactic({ name, cost: 0 });
const declareAttack = (t: Table, who: PlayerId, attackers: string[], target: PlayerId) =>
  t.engine.perform({ type: "declareAttack", playerId: who, attackerIds: attackers.map(key => t.id(key)), target: { type: "faction", playerId: target } } as never);
const smash = (name: string) =>
  tactic({
    name: `Smash ${name}`,
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", name }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  } as never);
/** Answers every "order your triggers" prompt (first trigger first). */
const orderTriggers = (t: Table): void => {
  while (pending(t)?.kind === "orderTriggers") answerChoice(t, { kind: "orderTriggers", next: (pending(t)!.triggers as unknown[])[0] });
};
const controllerOf = (t: Table, key: string): PlayerId => t.engine.state.cards[t.id(key)]!.controllerId;

// ===================================================================================================================
// God's Blessing of Readiness: The attached character gains the following rules text: "... At the start of each opponent's turn, you
// may restore all characters you control."
// ===================================================================================================================

function blessingTable(seats: number, holder: PlayerId) {
  const owned = (owner: PlayerId) => (seated(owner, seats) ? [{ key: `ch-${owner}`, def: character({ name: `Char ${owner}` }), owner, depleted: true }] : []);
  return table(seats, [
    ...owned(P1),
    ...owned(P2),
    ...owned(P3),
    ...owned(P4),
    { key: "bl", def: printing(BLESSING), owner: holder, zone: "play" as const, attachedToKey: `ch-${holder}` }
  ]);
}
/** `ender` ends their turn; reports whether `holder` is offered the Blessing's restore, taking it when it is. */
function turnStart(t: Table, ender: PlayerId, holder: PlayerId): boolean {
  act(t, { type: "endTurn", playerId: ender });
  orderTriggers(t);
  const offer = pending(t);
  if (offer?.kind !== "chooserSelectsOption" || offer.playerId !== holder) {
    assert.equal(offer, undefined, "nothing else is asked at a turn start");
    return false;
  }
  chooseIndex(t, 0);
  return true;
}
function blessingRound(seats: number, holder: PlayerId): Record<PlayerId, boolean> {
  const t = blessingTable(seats, holder);
  const order = [P1, P2, P3, P4].slice(0, seats);
  const fired: Record<string, boolean> = {};
  for (let i = 0; i < seats; i++) {
    const ender = order[i]!;
    const next = order[(i + 1) % seats]!;
    fired[next] = turnStart(t, ender, holder);
  }
  assert.equal(t.engine.state.cards[t.id(`ch-${holder}`)]!.depleted, false, "the holder's characters were restored");
  return fired as Record<PlayerId, boolean>;
}

clause(BLESSING, "3.1:grant-rule", "3 seats: for P1's character it triggers at the start of P2's turn and of P3's turn, not at P1's own; attached to P2's character it triggers at P1's and P3's turns for P2, not at P2's own", () => {
  assert.deepEqual(blessingRound(3, P1), { [P2]: true, [P3]: true, [P1]: false });
  assert.deepEqual(blessingRound(3, P2), { [P2]: false, [P3]: true, [P1]: true });
});
clause(BLESSING, "3.1:grant-rule", "4 seats: for P1's character it triggers at the starts of P2's, P3's and P4's turns, and not at P1's own", () => {
  assert.deepEqual(blessingRound(4, P1), { [P2]: true, [P3]: true, [P4]: true, [P1]: false });
});

// ===================================================================================================================
// Undesirable Intrusion: EXTRA COST: Your opponents cannot respond to this card. Deploy this only in response to a character's ability.
// ===================================================================================================================

function intrusionTable(seats: number) {
  return table(
    seats,
    [
      { key: "ui", def: printing(INTRUSION), owner: P1, zone: "hand" },
      { key: "ctl", def: idle("Control tactic"), owner: P1, zone: "hand" },
      { key: "mage", def: character({ name: "Mage", behavior: { abilities: [{ id: "poke", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as never }), owner: P2 },
      { key: "dk", def: character({ name: "Deck card" }), owner: P2, zone: "deck" },
      { key: "spell", def: idle("P2 spell"), owner: P2, zone: "hand" },
      ...bank("elitism", 3, P1)
    ],
    P2
  );
}
/** P2 uses the Mage's ability and the priority passes round to P1. */
function intrusionSpot(seats: number): Table {
  const t = intrusionTable(seats);
  t.engine.perform({ type: "activateAbility", playerId: P2, cardId: t.id("mage"), abilityId: "poke", selected: {}, variables: {} } as never);
  for (const who of [P3, P4].slice(0, seats - 2)) pass(t, who);
  assert.equal(t.engine.state.responseWindow!.priorityPlayerId, P1);
  return t;
}
const intrusionClause = (seats: number) => () => {
  const t = intrusionSpot(seats);
  playRaw(t, P1, "ui");
  // nobody was offered a response window for it: it has resolved at once, before any player passed
  assert.equal(t.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(t.engine, t.id("ui")), "discard", "resolved at once");
  assert.notEqual(zoneOf(t.engine, t.id("mage")), "play", "the character is destroyed");
  assert.equal(handOf(t.engine, P2).includes(t.id("dk")), false, "the ability was terminated");
  const token = Object.values(t.engine.state.cards).find(card => card.controllerId === P2 && card.zone === "play" && t.engine.getDefinition(card.id).name === "Micromajig");
  assert.ok(token, "its controller puts a micromajig token into play");

  const ordinary = intrusionSpot(seats);
  playRaw(ordinary, P1, "ctl");
  assert.notEqual(zoneOf(ordinary.engine, ordinary.id("ctl")), "discard", "an ordinary tactic in the same spot waits on the stack");
  assert.equal(ordinary.engine.state.responseWindow?.phase, "acceptingResponses", "and gives the opponents a response window");
  assert.notEqual(ordinary.engine.state.responseWindow?.priorityPlayerId, P1);
};
clause(INTRUSION, "0:extraCost", "3 seats: neither P2 nor P3 gets a response window for it; an ordinary tactic in the same spot gives them one", intrusionClause(3));
clause(INTRUSION, "0:extraCost", "4 seats: P2, P3 and P4 get no response window for it", intrusionClause(4));
clause(INTRUSION, "0:extraCost", "3 seats: it is refused in response to something that is not a character's ability", () => {
  const t = intrusionTable(3);
  playRaw(t, P2, "spell");
  pass(t, P3);
  assert.equal(t.engine.state.responseWindow!.priorityPlayerId, P1);
  refused(() => playRaw(t, P1, "ui"), "in response to a tactic");
});

// ===================================================================================================================
// Camouflaged Urchin: While this card is depleted, your opponents cannot pick this card.
// ===================================================================================================================

function urchinPickers(seats: number, depleted: boolean): Record<string, boolean> {
  const pickers = [P2, P3, P4].slice(0, seats - 1);
  const poke = (name: string) => tactic({ name, cost: 0, behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [] }] } as never });
  const t = table(seats, [
    { key: "ur", def: printing(URCHIN), owner: P1, depleted },
    { key: "mine", def: poke("P1 picker"), owner: P1, zone: "hand" },
    ...pickers.map(who => ({ key: `poke-${who}`, def: poke(`${who} picker`), owner: who, zone: "hand" as const }))
  ]);
  const canPick = (who: PlayerId, key: string): boolean => {
    const pick = requirements(t, { type: "playCard", playerId: who, cardId: t.id(key) }).find(need => need.kind === "pick");
    return !!pick?.candidates?.includes(t.id("ur"));
  };
  return { ...Object.fromEntries(pickers.map(who => [who, canPick(who, `poke-${who}`)])), [P1]: canPick(P1, "mine") };
}
clause(URCHIN, "0:rule", "3 seats: while depleted neither P2 nor P3 can pick it but P1 can; while ready both can", () => {
  assert.deepEqual(urchinPickers(3, true), { [P2]: false, [P3]: false, [P1]: true });
  assert.deepEqual(urchinPickers(3, false), { [P2]: true, [P3]: true, [P1]: true });
});
clause(URCHIN, "0:rule", "4 seats: P2, P3 and P4 cannot pick the depleted Urchin; P1 can", () => {
  assert.deepEqual(urchinPickers(4, true), { [P2]: false, [P3]: false, [P4]: false, [P1]: true });
});

// ===================================================================================================================
// Carnival Funhouse: When this card enters play, pick one character your opponent controls and one character you control.
// -- Switch the picked characters' strength, life, and speed for as long as this card is in play.
// ===================================================================================================================

function funhouseTable() {
  return table(3, [
    { key: "fh", def: printing(FUNHOUSE), owner: P1, zone: "hand" },
    { key: "smash", def: smash("Carnival Funhouse"), owner: P1, zone: "hand" },
    ...bank("deception", 4, P1),
    { key: "mine", def: character({ name: "Mine", strength: 1, life: 4, speed: 2 }), owner: P1 },
    { key: "c2", def: character({ name: "C2", strength: 3, life: 2, speed: 1 }), owner: P2 },
    { key: "c3", def: character({ name: "C3", strength: 5, life: 6, speed: 4 }), owner: P3 }
  ]);
}
const funhouse = (t: Table, opponent: PlayerId | undefined, a: string) => ({ type: "playCard", playerId: P1, cardId: t.id("fh"), selected: { a: [t.id(a)], b: [t.id("mine")] }, variables: {}, ...(opponent ? { players: { opponent } } : {}) });
const stats = (t: Table, key: string): number[] => ["strength", "life", "speed"].map(stat => t.engine.getStat(t.id(key), stat as never));

clause(FUNHOUSE, ["0:rule", "1:rule"], "3 seats: the opponent is chosen when it is played (P2 or P3); only that opponent's character can be the first pick; the stats are switched while it is in play", () => {
  const t = funhouseTable();
  assert.deepEqual(playerAsk(t, funhouse(t, undefined, "c2")), { id: "opponent", candidates: [P2, P3] });
  refused(() => t.engine.perform(funhouse(t, P2, "c3") as never), "P3's character when P2 is the chosen opponent");
  assert.equal(zoneOf(t.engine, t.id("fh")), "hand");
  act(t, funhouse(t, P2, "c2"));
  assert.deepEqual(stats(t, "c2"), [1, 4, 2], "P2's character takes P1's stats");
  assert.deepEqual(stats(t, "mine"), [3, 2, 1], "P1's character takes P2's stats");
  assert.deepEqual(stats(t, "c3"), [5, 6, 4], "P3's character is unaffected");
  play(t, P1, "smash", { selected: { t: [t.id("fh")] } });
  assert.deepEqual(stats(t, "c2"), [3, 2, 1], "the switch ends when Funhouse leaves play");
  assert.deepEqual(stats(t, "mine"), [1, 4, 2]);

  const second = funhouseTable();
  refused(() => second.engine.perform(funhouse(second, P3, "c2") as never), "P2's character when P3 is the chosen opponent");
  act(second, funhouse(second, P3, "c3"));
  assert.deepEqual(stats(second, "c3"), [1, 4, 2]);
  assert.deepEqual(stats(second, "c2"), [3, 2, 1], "P2's character is unaffected");
});

// ===================================================================================================================
// Cicibeo, The Implicator: IMPLY -- COST: Deplete this card. Pick a character. -- EFFECT: That character's controller depletes that
// character or reveals the top card of their deck. If they reveal ... a character, take control of the picked character this turn.
// ===================================================================================================================

function cicibeoTable(topIsCharacter: boolean) {
  return table(3, [
    { key: "ci", def: printing(CICIBEO), owner: P1 },
    { key: "mine", def: character({ name: "P1 char" }), owner: P1 },
    { key: "c2", def: character({ name: "P2 char" }), owner: P2 },
    { key: "c3", def: character({ name: "P3 char" }), owner: P3 },
    { key: "top3", def: topIsCharacter ? character({ name: "P3 top" }) : tactic({ name: "P3 top tactic" }), owner: P3, zone: "deck" }
  ]);
}
clause(CICIBEO, "1:ability:imply", "3 seats: the picked character's controller (P3, not P2) chooses; revealing a character gives P1 control of it this turn; P2 is never asked", () => {
  const t = cicibeoTable(true);
  activate(t, P1, "ci", "imply", { selected: { c: [t.id("c3")] } });
  assert.equal(pending(t)!.kind, "chooserSelectsOption");
  assert.equal(pending(t)!.playerId, P3, "P3, the character's controller, chooses");
  chooseIndex(t, 1);
  assert.equal(pending(t), undefined);
  assert.equal(controllerOf(t, "c3"), P1, "a revealed character: P1 takes control of the picked character");
  assert.equal(controllerOf(t, "c2"), P2);
  const log = t.engine.getLog().filter(entry => entry.event?.type === "cardsRevealed");
  assert.equal(log.length, 1, "the top card is revealed");

  const tactic3 = cicibeoTable(false);
  activate(tactic3, P1, "ci", "imply", { selected: { c: [tactic3.id("c3")] } });
  chooseIndex(tactic3, 1);
  assert.equal(controllerOf(tactic3, "c3"), P3, "not a character: nothing more");

  const deplete = cicibeoTable(true);
  activate(deplete, P1, "ci", "imply", { selected: { c: [deplete.id("c2")] } });
  assert.equal(pending(deplete)!.playerId, P2, "P2's character: P2 chooses");
  chooseIndex(deplete, 0);
  assert.equal(deplete.engine.state.cards[deplete.id("c2")]!.depleted, true, "depleted");
  assert.equal(controllerOf(deplete, "c2"), P2);
});

// ===================================================================================================================
// Lost on Floor 3: EXTRA COST: Play this only on your turn, after you have declared the end of your turn. -- Terminate your end of
// turn declaration. Detach a resource from your faction.
// ===================================================================================================================

function lostTable(active: PlayerId) {
  return table(
    3,
    [
      { key: "lf", def: printing(LOST), owner: P1, zone: "hand" },
      ...bank("deception", 3, P1),
      ...spent(P1, 1, 3),
      { key: "t2", def: idle("P2 tactic"), owner: P2, zone: "hand" },
      { key: "t3", def: idle("P3 tactic"), owner: P3, zone: "hand" }
    ],
    active
  );
}
for (const payer of [P2, P3] as const)
  clause(LOST, "0:extraCost", `3 seats: after P1 declares the end of the turn and ${payer} responds, P1 may play it in response, whichever opponent responded; no opponent is chosen`, () => {
    const t = lostTable(P1);
    assert.equal(playerAsk(t, { type: "playCard", playerId: P1, cardId: t.id("lf") }), undefined, "no chooseOpponent step");
    refused(() => playRaw(t, P1, "lf"), "before P1 has declared the end of the turn");
    t.engine.perform({ type: "endTurn", playerId: P1 } as never);
    if (payer === P3) pass(t, P2);
    playRaw(t, payer, payer === P2 ? "t2" : "t3");
    while (t.engine.state.responseWindow?.priorityPlayerId !== P1) pass(t, t.engine.state.responseWindow!.priorityPlayerId as PlayerId);
    playRaw(t, P1, "lf");
    resolvePendingResponses(t.engine);
    if (pending(t)) choose(t, offered(t).slice(0, 1));
    resolvePendingResponses(t.engine);
    assert.equal(t.engine.state.activePlayerId, P1, "the end of turn declaration was terminated: it is still P1's turn");
    assert.equal(zoneOf(t.engine, t.id("lf")), "discard");
  });
clause(LOST, "0:extraCost", "3 seats: it is refused during another player's turn", () => {
  for (const active of [P2, P3] as const) {
    const t = lostTable(active);
    t.engine.perform({ type: "endTurn", playerId: active } as never);
    const responder = t.engine.state.responseWindow!.priorityPlayerId as PlayerId;
    if (responder !== P1) pass(t, responder);
    while (t.engine.state.responseWindow?.priorityPlayerId !== P1 && t.engine.state.responseWindow) pass(t, t.engine.state.responseWindow.priorityPlayerId as PlayerId);
    if (t.engine.state.responseWindow?.priorityPlayerId === P1) refused(() => playRaw(t, P1, "lf"), `during ${active}'s turn`);
  }
});

// ===================================================================================================================
// Trickster's Globe: If you would inflict damage to an opponent's faction, for each damage you would inflict, you may put up to that many
// cards from the top of its owner's deck into their discard pile instead. -- When a player has no cards in their deck, they lose the game.
// ===================================================================================================================

function globeTable(active: PlayerId) {
  const deck = (owner: PlayerId, n: number) => Array.from({ length: n }, (_, i) => ({ key: `dk-${owner}-${i}`, def: character({ name: `Deck ${owner} ${i}` }), owner, zone: "deck" as const }));
  return table(
    3,
    [
      { key: "gl", def: printing(GLOBE), owner: P1 },
      { key: "atk-p1", def: character({ name: "Atk P1", strength: 3, life: 5, speed: 2 }), owner: P1 },
      { key: "atk-p2", def: character({ name: "Atk P2", strength: 3, life: 5, speed: 2 }), owner: P2 },
      ...deck(P1, 5),
      ...deck(P2, 5),
      ...deck(P3, 6)
    ],
    active
  );
}
const attackUnblocked = (t: Table, who: PlayerId, target: PlayerId) => {
  declareAttack(t, who, [`atk-${who}`], target);
  resolvePendingResponses(t.engine);
  t.engine.perform({ type: "declareBlockers", playerId: target, blockerIds: [] } as never);
  autoResolveBattle(t.engine);
};
clause(GLOBE, "0:rule", "3 seats: damage P1 inflicts to P3's faction may be replaced by milling P3's deck (P2's deck untouched); damage P2 inflicts, and damage to P1's faction, is not replaced", () => {
  const t = globeTable(P1);
  const p3Deck = t.engine.state.players[P3]!.deck.length;
  const p2Deck = t.engine.state.players[P2]!.deck.length;
  const p3Influence = influence(t.engine, P3);
  attackUnblocked(t, P1, P3);
  assert.equal(pending(t)!.kind, "millInsteadOfDamage");
  assert.equal(pending(t)!.playerId, P1);
  answerChoice(t, { kind: "millInsteadOfDamage", count: 3 });
  assert.equal(t.engine.state.players[P3]!.deck.length, p3Deck - 3, "3 cards of P3's deck are milled");
  assert.equal(t.engine.state.players[P3]!.discard.length, 3);
  assert.equal(t.engine.state.players[P2]!.deck.length, p2Deck, "P2's deck is untouched");
  assert.equal(influence(t.engine, P3), p3Influence, "no damage instead");

  const other = globeTable(P2);
  const before = influence(other.engine, P3);
  attackUnblocked(other, P2, P3);
  assert.equal(pending(other), undefined, "damage inflicted by P2 is not replaced by P1's Globe");
  assert.equal(influence(other.engine, P3), before - 3);

  const toP1 = globeTable(P2);
  const own = influence(toP1.engine, P1);
  attackUnblocked(toP1, P2, P1);
  assert.equal(pending(toP1), undefined, "damage to P1's own faction is not replaced");
  assert.equal(influence(toP1.engine, P1), own - 3);
});
clause(GLOBE, "1:rule", "3 seats: only the player whose deck is empty (P2) loses and is eliminated; P1 and P3 play on; the Globe's controller is not special", () => {
  const build = (empty: PlayerId): Table => {
    const t = table(3, [
      { key: "gl", def: printing(GLOBE), owner: P1 },
      { key: "idle", def: idle("Idle"), owner: P1, zone: "hand" },
      ...[P1, P2, P3].filter(who => who !== empty).flatMap(who => Array.from({ length: 3 }, (_, i) => ({ key: `dk-${who}-${i}`, def: character({ name: `Deck ${who} ${i}` }), owner: who, zone: "deck" as const })))
    ]);
    play(t, P1, "idle");
    return t;
  };
  const p2 = build(P2);
  const eliminated = (t: Table, who: PlayerId): boolean => !!t.engine.state.players[who]!.eliminated;
  assert.deepEqual([eliminated(p2, P1), eliminated(p2, P2), eliminated(p2, P3)], [false, true, false]);
  assert.equal(p2.engine.state.winner, undefined, "the game goes on");
  const p1 = build(P1);
  assert.deepEqual([eliminated(p1, P1), eliminated(p1, P2), eliminated(p1, P3)], [true, false, false], "the Globe's own controller loses with an empty deck");
});

// ===================================================================================================================
// Breath of the Barduse: EXTRA COST: Deploy this only during your turn. -- Each player destroys 2 character they own. Otherwise,
// destroy all of that player's characters.
// ===================================================================================================================

function breathTable(seats: number, active: PlayerId = P1) {
  const own = (owner: PlayerId, n: number) => (seated(owner, seats) ? Array.from({ length: n }, (_, i) => ({ key: `${owner}-${i}`, def: character({ name: `${owner} char ${i}` }), owner })) : []);
  return table(
    seats,
    [
      { key: "bb", def: printing(BREATH), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1),
      ...own(P1, 3),
      ...own(P2, 2),
      { key: "p2-stolen", def: character({ name: "P2 owns, P3 controls" }), owner: P2, controller: P3 },
      ...own(P3, 1),
      ...own(P4, 3),
      { key: "idle", def: idle("Idle"), owner: active, zone: "hand" }
    ],
    active
  );
}
const survivors = (t: Table, who: PlayerId): number => Object.values(t.engine.state.cards).filter(card => card.zone === "play" && card.ownerId === who && t.engine.getDefinition(card.id).type === "character").length;

for (const seats of [3, 4] as const)
  clause(BREATH, "1:rule", `${seats} seats: in order P1, P2, ${seats === 3 ? "P3" : "P3, P4"} each player chooses 2 characters they own and destroys them, or loses all of them when owning fewer than 2`, () => {
    const t = breathTable(seats);
    play(t, P1, "bb");
    assert.equal(pending(t)!.playerId, P1, "the active player first");
    assert.ok(offered(t).every(id => t.engine.state.cards[id]!.ownerId === P1), "only characters P1 owns");
    choose(t, [t.id("p1-0"), t.id("p1-1")]);
    assert.equal(pending(t)!.playerId, P2, "then P2");
    assert.ok(offered(t).includes(t.id("p2-stolen")), "a character P2 owns but P3 controls counts as P2's");
    assert.ok(offered(t).every(id => t.engine.state.cards[id]!.ownerId === P2));
    choose(t, [t.id("p2-0"), t.id("p2-stolen")]);
    if (seats === 4) {
      assert.equal(pending(t)!.playerId, P4);
      assert.ok(offered(t).every(id => t.engine.state.cards[id]!.ownerId === P4));
      choose(t, [t.id("p4-0"), t.id("p4-1")]);
    }
    assert.equal(pending(t), undefined, "P3 owns only 1 character: it is destroyed without a choice");
    assert.deepEqual([P1, P2, P3].map(who => survivors(t, who)), [1, 1, 0]);
    if (seats === 4) assert.equal(survivors(t, P4), 1);
  });
clause(BREATH, "0:extraCost", "3 seats: it is refused during P2's or P3's turn (P1 could only deploy it in response there) and allowed during P1's own", () => {
  for (const active of [P2, P3] as const) {
    const t = breathTable(3, active);
    playRaw(t, active, "idle");
    while (t.engine.state.responseWindow?.priorityPlayerId !== P1) pass(t, t.engine.state.responseWindow!.priorityPlayerId as PlayerId);
    refused(() => playRaw(t, P1, "bb"), `during ${active}'s turn`);
    assert.equal(zoneOf(t.engine, t.id("bb")), "hand");
  }
  const own = breathTable(3);
  play(own, P1, "bb");
  assert.equal(pending(own)!.kind, "chooserSelectsTarget", "on P1's own turn it is played and P1 starts choosing");
  assert.equal(pending(own)!.playerId, P1);
});

// ===================================================================================================================
// Silencer: Characters with a token on them cannot block this card. -- If a character enters play under your opponent's control, you
// may pay 1. If you do, put a token on it.
// ===================================================================================================================

clause(SILENCER, "0:rule", "3 seats: a character with a token cannot block it (whichever player's), one without can", () => {
  for (const target of [P3, P2] as const) {
    const t = table(3, [
      { key: "sil", def: printing(SILENCER), owner: P1 },
      { key: "marked", def: character({ name: "Marked" }), owner: target, counters: { token: 1 } },
      { key: "plain", def: character({ name: "Plain" }), owner: target }
    ]);
    declareAttack(t, P1, ["sil"], target);
    resolvePendingResponses(t.engine);
    refused(() => t.engine.perform({ type: "declareBlockers", playerId: target, blockerIds: [t.id("marked")] } as never), `${target}'s character with a token blocking`);
    t.engine.perform({ type: "declareBlockers", playerId: target, blockerIds: [t.id("plain")] } as never);
  }
});

function silencerEntry(entering: PlayerId) {
  const t = table(
    3,
    [
      { key: "sil", def: printing(SILENCER), owner: P1 },
      ...bank("rage", 2, P1),
      { key: "new", def: character({ name: "Newcomer" }), owner: entering, zone: "hand" }
    ],
    entering
  );
  return t;
}
clause(SILENCER, "1:rule", "3 seats: a character entering play under ANY opponent's control (P2's or P3's) lets P1 pay 1 to put a token on it, and no opponent is chosen; P1's own does nothing", () => {
  for (const entering of [P2, P3] as const) {
    const t = silencerEntry(entering);
    play(t, entering, "new");
    assert.equal(pending(t)!.kind, "mayPay", `${entering}'s character entering play triggers it`);
    assert.equal(pending(t)!.playerId, P1);
    mayPay(t, true);
    assert.equal(t.engine.state.cards[t.id("new")]!.counters?.token, 1);
    assert.equal(t.engine.getAvailableResourceCount(P1), 1, "P1 paid 1");
  }
  const declined = silencerEntry(P2);
  play(declined, P2, "new");
  mayPay(declined, false);
  assert.equal(declined.engine.state.cards[declined.id("new")]!.counters?.token ?? 0, 0);
  const own = silencerEntry(P1);
  play(own, P1, "new");
  assert.equal(pending(own), undefined, "P1's own character entering does nothing");
});

// ===================================================================================================================
// Big McLargehuge: EXTRA COST: Destroy 2 resources you control.
// ===================================================================================================================

const BIG = "9f159c52-0b48-4661-b3cd-9269e4bad55d"; // Big McLargehuge
clause(BIG, "1:extraCost", "3 seats: the extra cost destroys 2 resources P1 controls; P2's and P3's resources are untouched", () => {
  const t = table(3, [{ key: "big", def: printing(BIG), owner: P1, zone: "hand" }, ...bank("rage", 8, P1), ...bank("rage", 3, P2), ...bank("rage", 3, P3)]);
  const resources = (who: PlayerId): number =>
    Object.values(t.engine.state.cards).filter(card => card.zone === "play" && card.controllerId === who && t.engine.getDefinition(card.id).type === "resource").length;
  play(t, P1, "big");
  assert.equal(zoneOf(t.engine, t.id("big")), "play");
  assert.equal(resources(P1), 6, "2 of P1's 8 resources are destroyed");
  assert.equal(resources(P2), 3);
  assert.equal(resources(P3), 3);
});
