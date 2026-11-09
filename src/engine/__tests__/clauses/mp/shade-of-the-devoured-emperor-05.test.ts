// Multiplayer clause tests for Shade of the Devoured Emperor, part 5: "a player" / "any player" / "each opponent" restrictions,
// searches, offers and the remaining clauses whose data already reads correctly at any table size.
import assert from "node:assert/strict";
import { character, item, tactic } from "../../support/fixtures.js";
import { bank } from "../../per-card/_harness.js";
import { clause, printing, refused } from "../_clause.js";
import { 
  answer, controllerOf, deck, filler, fight, go, hand, infl, offered, pay, pcOf, pickCandidates, pickOption, play, table, unit, use, zone, P1, P2, P3, P4, type Board, type Pid, type Placement
 } from "./_shade.js";
import { resolvePendingResponses } from "../../support/fixtures.js";

const GOLDEN_CHARM = "b36130ca-d095-4cda-98b4-e6a1de823e40";
const GEAR_TACTIC = "97a5cad1-4663-414c-b230-9348968f6fb1";
const RECYCLING = "fd3fea1f-448c-405d-96c3-e6aa6e1395ef";
const GIANT_GIANT = "2a13a6f0-29b9-4f5d-a155-2b6bdea55257";
const SOCKEM_BOT = "a981c172-6c40-43d4-b941-0a336e4924fb";
const BANANA_PEEL = "386bbf0c-3e4d-4db2-b476-70ce87b7e228";
const LARCENY = "d2d83970-7b96-41ba-affd-ac69466455e4";
const RANDOM_KID = "fc31573d-7f46-4e68-ab94-9ea36a3dbe90";
const BARRACKS = "ab8e1b7d-a47b-4ffa-a8ff-0536a17627ca";
const SHADE = "506f383f-ef35-467b-8554-dd6b4b9729df";
const ROCKET_LAWNCHAIR = "1dd0bbbc-1202-41c2-9073-5ce87acaf67e";

const faction = (b: Board, who: Pid): string => b.engine.state.players[who].factionId!;
const readyOf = (b: Board, who: Pid): number => b.engine.getAvailableResourceCount(who);
function reachPriority(b: Board, who: Pid): void {
  for (let guard = 0; guard < 8 && b.engine.state.responseWindow?.priorityPlayerId !== who; guard++) b.engine.perform({ type: "passPriority", playerId: b.engine.state.responseWindow!.priorityPlayerId });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, who);
}
const turnNo = (who: Pid): number => [P1, P2, P3, P4].indexOf(who) + 1;

// --- Golden Charm ------------------------------------------------------------------------------

function charm(searcher: Pid): Board {
  const seats: Pid[] = [P1, P2, P3];
  return table(
    3,
    [
      { key: "charm", def: printing(GOLDEN_CHARM), owner: P1, zone: "play" },
      ...bank("greed", 3, P1),
      { key: "gear", def: printing(GEAR_TACTIC), owner: searcher, zone: "hand" },
      ...bank("elitism", 1, searcher),
      ...bank("greed", 2, searcher),
      ...seats.flatMap((owner) => [
        { key: `${owner}-c0`, def: character({ name: `${owner} c0` }), owner, zone: "deck" as const },
        { key: `${owner}-g`, def: item({ name: `${owner} Gear`, subtype: ["gear"] }), owner, zone: "deck" as const },
        { key: `${owner}-c1`, def: character({ name: `${owner} c1` }), owner, zone: "deck" as const }
      ])
    ],
    { active: searcher, turn: turnNo(searcher) }
  );
}
/** Plays "I Got the Gear!", answers the Charm's may-pay with `yes` and the search with the owner's gear; returns who was offered the may-pay. */
function searchWithCharm(b: Board, searcher: Pid, yes: boolean): Pid[] {
  go(b, play(b, searcher, "gear"));
  const offeredTo: Pid[] = [];
  for (let guard = 0; guard < 10 && pcOf(b.engine); guard++) {
    const pc = pcOf(b.engine)!;
    if (pc.kind === "mayPay") {
      offeredTo.push(pc.playerId);
      pay(b, pc.playerId, yes);
    } else if (pc.kind === "chooserSelectsTarget") {
      assert.equal(pc.playerId, searcher, "the searching player searches");
      answer(b, pc.playerId, { kind: "chooserSelectsTarget", selected: [b.id(`${searcher}-g`)] });
    } else assert.fail(`unexpected ${pc.kind}`);
  }
  return offeredTo;
}
clause(GOLDEN_CHARM, "1:rule", "3 seats: P3 would search P3's deck: only P1 (the Charm's controller) is offered the 1-payment; paying draws P1 a card, then P3 searches", () => {
  const b = charm(P3);
  const before = readyOf(b, P1);
  const offeredTo = searchWithCharm(b, P3, true);
  assert.deepEqual(offeredTo, [P1], "only P1; P2 is not offered");
  assert.equal(before - readyOf(b, P1), 1, "P1 paid 1");
  assert.deepEqual(hand(b.engine, P1), [b.id("p1-c0")], "P1 drew the top card of P1's own deck");
  assert.equal(hand(b.engine, P3).includes(b.id("p3-g")), true, "P3 still searched P3's deck");
  assert.equal(deck(b.engine, P2).length, 3);
});
clause(GOLDEN_CHARM, "1:rule", "3 seats: declining costs nothing and P3's search happens; P1 searching its own deck gets the same offer; P2 searching offers it to P1 only", () => {
  const declined = charm(P3);
  const before = readyOf(declined, P1);
  assert.deepEqual(searchWithCharm(declined, P3, false), [P1]);
  assert.equal(readyOf(declined, P1), before);
  assert.equal(hand(declined.engine, P1).length, 0, "nothing drawn");
  assert.equal(hand(declined.engine, P3).includes(declined.id("p3-g")), true);
  assert.deepEqual(searchWithCharm(charm(P1), P1, true), [P1], "P1's own search: the offer goes to P1");
  assert.deepEqual(searchWithCharm(charm(P2), P2, true), [P1], "P2's search: the offer goes to P1 only");
});

// --- Recycling Scheme Facility -----------------------------------------------------------------

const slayCharacter = (owner: Pid): Placement => ({
  key: "kill",
  owner,
  zone: "hand",
  def: tactic({ name: "Kill", behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { type: "character", controller: "any" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } })
});
function recycling(active: Pid): Board {
  return table(
    3,
    [
      { key: "rsf", def: printing(RECYCLING), owner: P1, zone: "play" },
      slayCharacter(active),
      unit(P3, "victim", { name: "Victim" }),
      ...bank("rage", 4, P1),
      ...bank("rage", 4, P2),
      ...bank("rage", 4, P3),
      ...filler(P3, "deck", 2)
    ],
    { active, turn: turnNo(active) }
  );
}
clause(RECYCLING, "0:rule", "3 seats: when it enters play only P1 may draw a card; P2 and P3 are not offered anything", () => {
  const b = table(3, [{ key: "rsf", def: printing(RECYCLING), owner: P1, zone: "hand" }, ...bank("greed", 4, P1), ...filler(P1, "deck", 2), ...filler(P2, "deck", 2), ...filler(P3, "deck", 2)]);
  go(b, play(b, P1, "rsf"));
  assert.equal(pcOf(b.engine)?.kind, "chooserSelectsOption");
  assert.equal(pcOf(b.engine)?.playerId, P1);
  pickOption(b, P1, 1);
  assert.equal(pcOf(b.engine), undefined);
  assert.deepEqual([P1, P2, P3].map((p) => hand(b.engine, p).length), [1, 0, 0]);
});
clause(RECYCLING, "1:rule", "3 seats: a character goes to P3's discard pile while P2 is active: the 4-payment is offered P2, P3, P1 (active first, then clockwise, P1 included); P3 pays and the card goes on top of P3's deck; P1 is not asked", () => {
  const b = recycling(P2);
  go(b, play(b, P2, "kill", { selected: { t: [b.id("victim")] } }));
  assert.deepEqual([pcOf(b.engine)?.kind, pcOf(b.engine)?.playerId], ["anyPlayerMayPay", P2]);
  pay(b, P2, false, "anyPlayerMayPay");
  assert.deepEqual([pcOf(b.engine)?.kind, pcOf(b.engine)?.playerId], ["anyPlayerMayPay", P3]);
  pay(b, P3, true, "anyPlayerMayPay");
  assert.equal(pcOf(b.engine), undefined, "P1 is not offered once P3 paid");
  assert.equal(deck(b.engine, P3)[0], b.id("victim"), "on top of its owner's deck");
  assert.equal(readyOf(b, P3), 0, "P3 paid 4 from P3's resources");
  assert.equal(readyOf(b, P1), 4);
});
clause(RECYCLING, "1:rule", "3 seats: another player may pay for P3's card, which still goes on top of P3's deck; if everyone declines nothing happens; with P1 active the order is P1, P2, P3", () => {
  const paidBy2 = recycling(P2);
  go(paidBy2, play(paidBy2, P2, "kill", { selected: { t: [paidBy2.id("victim")] } }));
  pay(paidBy2, P2, true, "anyPlayerMayPay");
  assert.equal(pcOf(paidBy2.engine), undefined, "P3 and P1 are not offered");
  assert.equal(deck(paidBy2.engine, P3)[0], paidBy2.id("victim"), "P3's card, on top of P3's deck");
  assert.deepEqual([readyOf(paidBy2, P2), readyOf(paidBy2, P3)], [0, 4], "P2 paid, P3 did not");
  const none = recycling(P2);
  go(none, play(none, P2, "kill", { selected: { t: [none.id("victim")] } }));
  for (const who of [P2, P3, P1]) {
    assert.equal(pcOf(none.engine)?.playerId, who);
    pay(none, who, false, "anyPlayerMayPay");
  }
  assert.equal(zone(none, "victim"), "discard", "everyone declined: nothing happens");
  const p1First = recycling(P1);
  go(p1First, play(p1First, P1, "kill", { selected: { t: [p1First.id("victim")] } }));
  const order: Pid[] = [];
  for (let guard = 0; guard < 3 && pcOf(p1First.engine)?.kind === "anyPlayerMayPay"; guard++) {
    order.push(pcOf(p1First.engine)!.playerId);
    pay(p1First, pcOf(p1First.engine)!.playerId, false, "anyPlayerMayPay");
  }
  assert.deepEqual(order, [P1, P2, P3]);
});

// --- Gigantitect's Giant Giant -----------------------------------------------------------------

const grabber = (owner: Pid): Placement => ({
  key: `grab-${owner}`,
  owner,
  zone: "play",
  def: item({
    name: `Grabber ${owner}`,
    behavior: { abilities: [{ id: "grab", type: "activated", targets: [{ id: "t", selector: { type: "character", name: "Gigantitect's Giant Giant" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  })
});
clause(GIANT_GIANT, "1:rule", "3 seats: neither P2 nor P3 can take control of it; it stays under P1's control", () => {
  for (const taker of [P2, P3]) {
    const b = table(3, [{ key: "giant", def: printing(GIANT_GIANT), owner: P1, zone: "play" }, grabber(taker)], { active: taker, turn: turnNo(taker) });
    go(b, use(b, taker, `grab-${taker}`, "grab", { selected: { t: [b.id("giant")] } }));
    assert.equal(controllerOf(b, "giant"), P1, `${taker}'s attempt is refused`);
  }
  const control = table(3, [{ key: "plain", def: character({ name: "Gigantitect's Giant Giant" }), owner: P2, zone: "play" }, grabber(P1)]);
  go(control, use(control, P1, "grab-p1", "grab", { selected: { t: [control.id("plain")] } }));
  assert.equal(controllerOf(control, "plain"), P1, "control: the same effect does take an ordinary card (one without the restriction)");
  const toOpponent = table(3, [{ key: "giant", def: printing(GIANT_GIANT), owner: P2, zone: "play" }, grabber(P1)]);
  go(toOpponent, use(toOpponent, P1, "grab-p1", "grab", { selected: { t: [toOpponent.id("giant")] } }));
  assert.equal(controllerOf(toOpponent, "giant"), P2, "P1 is an opponent of the Giant Giant's controller P2, so P1 cannot take it either");
});
clause(GIANT_GIANT, "1:rule", "4 seats: P2, P3 and P4 each fail to take control of it", () => {
  for (const taker of [P2, P3, P4]) {
    const b = table(4, [{ key: "giant", def: printing(GIANT_GIANT), owner: P1, zone: "play" }, grabber(taker)], { active: taker, turn: turnNo(taker) });
    go(b, use(b, taker, `grab-${taker}`, "grab", { selected: { t: [b.id("giant")] } }));
    assert.equal(controllerOf(b, "giant"), P1, `${taker}'s attempt fails`);
  }
});

// --- Sockem Bot --------------------------------------------------------------------------------

clause(SOCKEM_BOT, "0:ability:sb-payoff", "3 seats: P1, P2 and P3 can each use PAY OFF, each paying 1 of their own resources; only the user loses a resource", () => {
  for (const user of [P1, P2, P3]) {
    const b = table(
      3,
      [{ key: "bot", def: printing(SOCKEM_BOT), owner: P1, zone: "play" }, ...bank("rage", 3, P1), ...bank("rage", 3, P2), ...bank("rage", 3, P3)],
      { active: user, turn: turnNo(user) }
    );
    const before = Object.fromEntries([P1, P2, P3].map((p) => [p, readyOf(b, p)]));
    go(b, use(b, user, "bot", "sb-payoff"));
    for (const p of [P1, P2, P3]) assert.equal(before[p]! - readyOf(b, p), p === user ? 1 : 0, `${p}`);
  }
});
clause(SOCKEM_BOT, "0:ability:sb-payoff", "3 seats: each use reduces the damage the Bot inflicts this turn by 1 and the uses stack", () => {
  const swing = table(3, [{ key: "real", def: printing(SOCKEM_BOT), owner: P1, zone: "play" }, ...bank("rage", 3, P1), ...bank("rage", 3, P2), ...bank("rage", 3, P3)]);
  const strength = swing.engine.getStat(swing.id("real"), "strength");
  swing.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [swing.id("real")], target: { type: "faction", playerId: P3 } });
  // each of the three players uses PAY OFF when the response window gives them priority; the rest pass
  const used = new Set<Pid>();
  for (let guard = 0; guard < 30 && used.size < 3 && swing.engine.state.responseWindow?.phase === "acceptingResponses"; guard++) {
    const who = swing.engine.state.responseWindow.priorityPlayerId as Pid;
    if (used.has(who)) swing.engine.perform({ type: "passPriority", playerId: who });
    else {
      swing.engine.perform(use(swing, who, "real", "sb-payoff"));
      used.add(who);
    }
  }
  assert.equal(used.size, 3, "all three players got to use it");
  assert.deepEqual([P1, P2, P3].map((p) => 3 - readyOf(swing, p)), [1, 1, 1], "each paid 1 of their own");
  resolvePendingResponses(swing.engine);
  fight(swing, () => undefined);
  assert.equal(infl(swing.engine, P3), 25 - Math.max(0, strength - 3), "three uses by three different players: damage reduced by 3");
  assert.equal(infl(swing.engine, P2), 25);
});

// --- Banana Peel -------------------------------------------------------------------------------

clause(BANANA_PEEL, "1:ability", "3 seats: played during P2's or P3's turn, only P1 may pay 1 (else it is terminated); during P1's own turn nothing is asked", () => {
  const board = (active: Pid) =>
    table(
      3,
      [
        { key: "peel", def: printing(BANANA_PEEL), owner: P1, zone: "hand" },
        ...bank("deception", 5, P1),
        { key: "bait", def: character({ name: "Bait", cost: 0 }), owner: active, zone: "hand" }
      ],
      { active, turn: turnNo(active) }
    );
  for (const active of [P2, P3]) {
    const paid = board(active);
    paid.engine.perform(play(paid, active, "bait"));
    reachPriority(paid, P1);
    go(paid, play(paid, P1, "peel"));
    assert.deepEqual([pcOf(paid.engine)?.kind, pcOf(paid.engine)?.playerId], ["mayPay", P1], `during ${active}'s turn P1 is asked`);
    const readyBefore = readyOf(paid, P1);
    pay(paid, P1, true);
    assert.equal(zone(paid, "peel"), "play");
    assert.equal(readyBefore - readyOf(paid, P1), 1);
    const declined = board(active);
    declined.engine.perform(play(declined, active, "bait"));
    reachPriority(declined, P1);
    go(declined, play(declined, P1, "peel"));
    pay(declined, P1, false);
    assert.equal(zone(declined, "peel"), "discard", "not paid: terminated");
  }
  const own = board(P1);
  go(own, play(own, P1, "peel"));
  assert.equal(pcOf(own.engine), undefined, "on P1's own turn no payment is asked");
  assert.equal(zone(own, "peel"), "play");
});

// --- Surreptitious Larceny ---------------------------------------------------------------------

clause(LARCENY, "1:option:OPTION 1", "3 seats: P1 may pick any player (P1, P2 or P3); that player cannot play cards using FLIP UP this turn; P1 looks at the top card of any deck", () => {
  const board = (active: Pid) =>
    table(
      3,
      [
        { key: "sl", def: printing(LARCENY), owner: P1, zone: "hand" },
        ...bank("deception", 5, P1),
        { key: "bait", def: character({ name: "Bait", cost: 0 }), owner: active, zone: "hand" },
        { key: "down", def: printing(ROCKET_LAWNCHAIR), owner: P3, zone: "play", faceDown: true },
        ...bank("elitism", 4, P3),
        ...filler(P1, "deck", 2),
        ...filler(P2, "deck", 2),
        ...filler(P3, "deck", 2)
      ],
      { active, turn: turnNo(active) }
    );
  const flipOf = (b: Board) => ({ type: "flipUp", playerId: P3, cardId: b.id("down") }) as never;
  /** P3 plays a bait during their turn; P1 answers with Larceny OPTION 1 on `picked`, looking at `deckOf`'s deck; everything then resolves. */
  const cast = (picked: Pid, deckOf: Pid): { b: Board; look: { deckOwnerId?: Pid; playerId: Pid } } => {
    const b = board(P3);
    b.engine.perform(play(b, P3, "bait"));
    reachPriority(b, P1);
    go(b, play(b, P1, "sl", { mode: 0, selected: { p: [faction(b, picked)] } }));
    answer(b, P1, { kind: "chooserSelectsTarget", selected: [faction(b, deckOf)] });
    const look = pcOf(b.engine) as unknown as { kind: string; playerId: Pid; deckOwnerId?: Pid; cardIds: string[] };
    assert.equal(look.kind, "reorderDeck");
    answer(b, P1, { kind: "reorderDeck", order: look.cardIds });
    resolvePendingResponses(b.engine);
    return { b, look };
  };
  const control = board(P3);
  assert.equal(control.engine.checkAction(flipOf(control)).ok, true, "control: P3 can FLIP UP on their own turn");
  assert.deepEqual(new Set(pickCandidates(control, play(control, P1, "sl", { mode: 0 }))), new Set([faction(control, P1), faction(control, P2), faction(control, P3)]), "any player may be picked");
  const picked3 = cast(P3, P2);
  assert.equal(picked3.look.playerId, P1);
  assert.equal(picked3.look.deckOwnerId, P2, "the top card of the deck P1 chose (independent of the picked player)");
  assert.equal(picked3.b.engine.checkAction(flipOf(picked3.b)).ok, false, "P3 cannot FLIP UP this turn");
  const pickedSelf = cast(P1, P3);
  assert.equal(pickedSelf.look.deckOwnerId, P3);
  assert.equal(pickedSelf.b.engine.checkAction(flipOf(pickedSelf.b)).ok, true, "P1 picked itself: P3 is unrestricted");
  const picked2 = cast(P2, P1);
  assert.equal(picked2.b.engine.checkAction(flipOf(picked2.b)).ok, true, "P2 picked: P3 is unrestricted");
});

// --- Totally Random Kid ------------------------------------------------------------------------

clause(RANDOM_KID, "0:rule", "3 seats: battle damage to P3's faction mills the top cards of P3's deck (not P2's); P1 may pick any player's item with cost 3 or less and destroy it", () => {
  for (const [victim, other] of [[P3, P2], [P2, P3]] as const) {
    const b = table(3, [
      { key: "kid", def: printing(RANDOM_KID), owner: P1, zone: "play" },
      ...filler(P2, "deck", 5),
      ...filler(P3, "deck", 5),
      { key: "trinket", def: item({ name: "Trinket", cost: 1 }), owner: P2, zone: "play" },
      { key: "pricey", def: item({ name: "Pricey", cost: 2 }), owner: P3, zone: "play" }
    ]);
    const strength = b.engine.getStat(b.id("kid"), "strength");
    b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("kid")], target: { type: "faction", playerId: victim } });
    fight(b, (pc) => {
      if (pc.kind === "selectTargets") return { kind: "selectTargets", selected: { it: [b.id("trinket")] } };
      if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [b.id("trinket")] };
      return undefined;
    });
    assert.equal(deck(b.engine, victim).length, 5 - strength, "the victim's deck lost the top X cards");
    assert.equal(b.engine.state.players[victim].discard.length, strength + (victim === P2 ? 1 : 0), "into the victim's discard pile (P2's own item, once destroyed, lands there too)");
    assert.equal(deck(b.engine, other).length, 5, "the other opponent's deck is untouched");
    assert.equal(zone(b, "trinket"), "discard", "P1 destroyed the item (cost 1, any player's)");
    assert.equal(zone(b, "pricey"), "play", "an item costing more than the damage was not pickable");
  }
});

// --- Barracks of Precipitancy ------------------------------------------------------------------

clause(BARRACKS, "0:ability:bop-gotime", "3 seats: GO TIME! shuffles and reveals the top card of P1's deck to every player; a character enters under P1's control with AGGRO; P2's and P3's decks are untouched", () => {
  const b = table(3, [
    { key: "bop", def: printing(BARRACKS), owner: P1, zone: "play" },
    { key: "top", def: character({ name: "Top character" }), owner: P1, zone: "deck" },
    ...filler(P2, "deck", 3),
    ...filler(P3, "deck", 3)
  ]);
  const before = [P2, P3].map((p) => deck(b.engine, p).slice());
  go(b, use(b, P1, "bop", "bop-gotime"));
  const reveals = b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").map((entry) => entry.event as unknown as { viewerId: string; cardIds: string[] });
  assert.equal(reveals.length, 1);
  assert.equal(reveals[0]!.viewerId, "all", "revealed to every player");
  assert.deepEqual(reveals[0]!.cardIds, [b.id("top")]);
  assert.equal(zone(b, "top"), "play");
  assert.equal(controllerOf(b, "top"), P1);
  assert.equal((b.engine.getKeywords(b.id("top")) as string[]).includes("aggro"), true);
  assert.deepEqual([P2, P3].map((p) => deck(b.engine, p)), before);
});

// --- Shade of the Devoured Emperor -------------------------------------------------------------

function shade(active: Pid): Board {
  return table(
    3,
    [
      { key: "shade", def: printing(SHADE), owner: P1, zone: "play" },
      { key: "eustace3", def: character({ name: "Eustace of P3", unique: "eustace" }), owner: P3, zone: "deck" },
      ...filler(P3, "deck", 2),
      { key: "eustace2", def: character({ name: "Eustace of P2", unique: "eustace" }), owner: P2, zone: "deck" },
      ...filler(P2, "deck", 2),
      ...filler(P1, "deck", 2)
    ],
    { active, turn: turnNo(active) }
  );
}
function endTurn(b: Board, who: Pid): void {
  b.engine.perform({ type: "endTurn", playerId: who });
  resolvePendingResponses(b.engine);
}
clause(SHADE, "1:rule", "3 seats: at the end of P2's turn and at the end of P3's turn it may be removed; P1 then chooses any player and finds a UNIQUE character in that player's deck; it never fires at the end of P1's own turn", () => {
  for (const ender of [P2, P3]) {
    const b = shade(ender);
    endTurn(b, ender);
    assert.equal(pcOf(b.engine)?.kind, "mayPay", `it fires at the end of ${ender}'s turn`);
    assert.equal(pcOf(b.engine)?.playerId, P1);
    pay(b, P1, true);
    assert.equal(zone(b, "shade"), "removed", "removed from the game");
    assert.deepEqual(new Set(offered(b)), new Set(Object.values(b.engine.state.players).map((p) => p.factionId!)), "P1 may choose any player, itself included");
    answer(b, P1, { kind: "chooserSelectsTarget", selected: [faction(b, P3)] });
    assert.deepEqual(offered(b), [b.id("eustace3")], "only the chosen player's deck is searched");
    answer(b, P1, { kind: "chooserSelectsTarget", selected: [b.id("eustace3")] });
    assert.equal(zone(b, "eustace3"), "play");
    assert.equal(controllerOf(b, "eustace3"), P1, "under P1's control");
    assert.equal(zone(b, "eustace2"), "deck", "P2's deck is untouched");
  }
  const own = shade(P1);
  endTurn(own, P1);
  assert.equal(pcOf(own.engine), undefined, "not at the end of P1's own turn");
  assert.equal(zone(own, "shade"), "play");
});

// <<END>>
