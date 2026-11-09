// Multiplayer clause tests, Holy Heist part 4: Akashic Coin, Akashic Notes, Phantasmagoric Tollbooth, Lunk Nut, Final
// Countdown and Leaping Sarume at 3 and 4 seats. Written from the printed text: who is affected, who is not, and when an
// opponent prompt appears. Real printings, real games, `perform` only.

import assert from "node:assert/strict";
import { mpClause, printing } from "../_clause.js";
import type { CardDefinition, PlayerId } from "../../../../engine.js";
import { buildGame, noDevelopFaction, tactic } from "../../support/fixtures.js";
import { developFaction, resourceCard } from "../../per-card/_harness.js";
import { developResource } from "../_turn.js";
import {
  P1, P2, P3, P4, answer, attackOpen, bank, character, choosePlayer, candidates, damageOf, deckOf, discardOf, factionOf, filler, handOf, influenceOf, pending, pick, pickIds,
  play, playOpen, playRequirements, refusal, resolvePendingResponses, seatsOf, table, volition, zoneOf,
  type CardPlacement, type Seats, type Table
} from "./_holy-heist.js";

const READY = (t: Table, who: PlayerId): number => t.engine.getAvailableResourceCount(who);

/** A game of `count` seats where every seat's faction has a develop rule (so any seat can play a resource) with `cards` placed; `active` takes the turn. */
function devTable(count: Seats, cards: CardPlacement[], active: PlayerId = P1): Table {
  const built = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: developFaction() })),
    cards,
    activePlayerId: active
  });
  return { engine: built.engine, id: built.id, seats: seatsOf(count) };
}

const voidResource = (name: string): CardDefinition => resourceCard({ name, resource: { provides: ["volition"], staple: false } });
const rageResource = (name: string): CardDefinition => resourceCard({ name, resource: { provides: ["rage"], staple: true } });

// --- Akashic Coin --------------------------------------------------------------------------------------------------
// UNIQUE AKASHIC OBJECT -- When a card that provides at least [V] enters play under an opponent's control, that player may pay 2.
// If they don't, you may have your faction lose 1 influence. If you do, draw a card. Otherwise, flip this card face-down under its owner's control.

const COIN = "21274c5d-a966-4303-a9e6-9db01061d7a0";

function coinTable(): Table {
  return devTable(3, [
    { key: "coin", def: printing(COIN), owner: P1, zone: "play" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "hand" },
    { key: "v2", def: voidResource("V Two"), owner: P2, zone: "hand" },
    { key: "v3", def: voidResource("V Three"), owner: P3, zone: "hand" },
    { key: "r2", def: rageResource("R Two"), owner: P2, zone: "hand" },
    { key: "r3", def: rageResource("R Three"), owner: P3, zone: "hand" },
    { key: "v1", def: voidResource("V One"), owner: P1, zone: "hand" },
    ...bank("rage", 3, P2),
    ...bank("rage", 3, P3),
    ...filler("dk", 4, P1, "deck")
  ]);
}

const faceUp = (t: Table, key: string): boolean => t.engine.state.cards[t.id(key)]!.faceDown !== true;

mpClause(COIN, "1:rule", 3, "3 seats: a [V] card entering play under P2 asks P2 (not P1, not P3) to pay 2; if P2 pays nothing else happens and P3 is never asked; the same for P3", () => {
  for (const [who, other, key] of [[P2, P3, "v2"], [P3, P2, "v3"]] as const) {
    const t = coinTable();
    developResource(t.engine, who, t.id(key), false);
    resolvePendingResponses(t.engine);
    assert.equal(pending(t)?.kind, "mayPay");
    assert.equal(pending(t)?.playerId, who, `${who}, whose card entered, is asked to pay`);
    const before = { [who]: READY(t, who), [other]: READY(t, other) };
    const handBefore = handOf(t, P1).length;
    const influenceBefore = influenceOf(t, P1);
    answer(t, "mayPay", who, { kind: "mayPay", pay: true });
    assert.equal(pending(t), undefined, "nobody else is asked");
    assert.equal(before[who]! - READY(t, who), 2, `${who} paid 2`);
    assert.equal(before[other], READY(t, other), `${other} paid nothing`);
    assert.equal(handOf(t, P1).length, handBefore, "P1 drew nothing");
    assert.equal(influenceOf(t, P1), influenceBefore, "P1 lost nothing");
    assert.equal(faceUp(t, "coin"), true, "the Coin stays face-up");
  }
});

mpClause(COIN, "1:rule", 3, "3 seats: if the opponent does not pay, P1 (alone) may lose 1 influence to draw a card; the other opponent is not asked; declining flips the Coin face-down", () => {
  for (const [who, other, key] of [[P2, P3, "v2"], [P3, P2, "v3"]] as const) {
    const draws = coinTable();
    developResource(draws.engine, who, draws.id(key), false);
    resolvePendingResponses(draws.engine);
    answer(draws, "mayPay", who, { kind: "mayPay", pay: false });
    assert.equal(pending(draws)?.kind, "mayPay");
    assert.equal(pending(draws)?.playerId, P1, "P1 is asked about the influence");
    const top = deckOf(draws, P1)[0]!;
    const influence = Object.fromEntries(draws.seats.map((seat) => [seat, influenceOf(draws, seat)]));
    answer(draws, "mayPay", P1, { kind: "mayPay", pay: true });
    assert.equal(pending(draws), undefined, `${other} is never asked`);
    assert.equal(influence[P1]! - influenceOf(draws, P1), 1, "P1's faction lost 1");
    assert.equal(influence[who], influenceOf(draws, who), `${who} lost nothing`);
    assert.equal(influence[other], influenceOf(draws, other), `${other} lost nothing`);
    assert.deepEqual(handOf(draws, P1).slice(-1), [top], "P1 drew the top card");
    assert.equal(faceUp(draws, "coin"), true);

    const flips = coinTable();
    developResource(flips.engine, who, flips.id(key), false);
    resolvePendingResponses(flips.engine);
    answer(flips, "mayPay", who, { kind: "mayPay", pay: false });
    answer(flips, "mayPay", P1, { kind: "mayPay", pay: false });
    assert.equal(pending(flips), undefined);
    assert.equal(flips.engine.state.cards[flips.id("coin")]!.faceDown, true, "otherwise the Coin flips face-down");
    assert.equal(flips.engine.state.cards[flips.id("coin")]!.controllerId, P1);
    assert.equal(influenceOf(flips, P1), influence[P1], "no influence lost");
  }
});

mpClause(COIN, "1:rule", 3, "3 seats: P1's own [V] card does not trigger it, and neither does an opponent's card that provides no [V]", () => {
  const own = coinTable();
  developResource(own.engine, P1, own.id("v1"), false);
  resolvePendingResponses(own.engine);
  assert.equal(pending(own), undefined, "P1's own [V] card: no trigger");
  assert.equal(faceUp(own, "coin"), true);

  for (const [who, key] of [[P2, "r2"], [P3, "r3"]] as const) {
    const t = coinTable();
    developResource(t.engine, who, t.id(key), false);
    resolvePendingResponses(t.engine);
    assert.equal(pending(t), undefined, `a face-up [R] card entering under ${who}: no trigger`);
    assert.equal(faceUp(t, "coin"), true);
  }
});

// --- Akashic Notes -------------------------------------------------------------------------------------------------
// UNIQUE AKASHIC OBJECT -- When a card that provides at least [V] enters play under an opponent's control, you may pay 1. If you do, play a
// face-down resource attached to your faction. Otherwise, flip this card face-down under its owner's control.

const NOTES = "27d42a55-adb9-43ca-95b6-6778af1648f0";

function notesTable(): Table {
  return devTable(3, [
    { key: "notes", def: printing(NOTES), owner: P1, zone: "play" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "hand" },
    { key: "v2", def: voidResource("V Two"), owner: P2, zone: "hand" },
    { key: "v3", def: voidResource("V Three"), owner: P3, zone: "hand" },
    { key: "v1", def: voidResource("V One"), owner: P1, zone: "hand" },
    ...bank("rage", 3, P1),
    ...bank("rage", 3, P2),
    ...bank("rage", 3, P3)
  ]);
}

mpClause(NOTES, "1:rule", 3, "3 seats: a [V] card entering play under P2 asks P1 (alone) to pay 1; paying has P1 play a hand card face-down attached to P1's faction; the same for a card under P3; P2 and P3 are never asked", () => {
  for (const [who, other, key] of [[P2, P3, "v2"], [P3, P2, "v3"]] as const) {
    const t = notesTable();
    developResource(t.engine, who, t.id(key), false);
    resolvePendingResponses(t.engine);
    assert.equal(pending(t)?.kind, "mayPay");
    assert.equal(pending(t)?.playerId, P1, "P1 decides, whichever opponent's card entered");
    const ready = Object.fromEntries(t.seats.map((seat) => [seat, READY(t, seat)]));
    answer(t, "mayPay", P1, { kind: "mayPay", pay: true });
    assert.equal(pending(t)?.kind, "chooserSelectsTarget");
    assert.equal(pending(t)?.playerId, P1, "P1 picks the resource");
    pick(t, P1, "mine");
    assert.equal(pending(t), undefined);
    const mine = t.engine.state.cards[t.id("mine")]!;
    assert.equal(mine.zone, "play");
    assert.equal(mine.faceDown, true);
    assert.equal(mine.controllerId, P1);
    assert.equal(mine.attachedTo, factionOf(t, P1), "attached to P1's faction");
    assert.equal(ready[P1]! - READY(t, P1), 1, "P1 paid 1 (the new resource arrives spent)");
    assert.equal(READY(t, who) - ready[who]!, 0, `${who} paid nothing`);
    assert.equal(READY(t, other), ready[other], `${other} paid nothing`);
    assert.equal(t.engine.state.cards[t.id("notes")]!.faceDown !== true, true, "Notes stays face-up");
  }
});

mpClause(NOTES, "1:rule", 3, "3 seats: if P1 does not pay, Notes flips face-down and nothing is played; P1's own [V] card does not trigger it", () => {
  for (const [who, key] of [[P2, "v2"], [P3, "v3"]] as const) {
    const t = notesTable();
    developResource(t.engine, who, t.id(key), false);
    resolvePendingResponses(t.engine);
    answer(t, "mayPay", P1, { kind: "mayPay", pay: false });
    assert.equal(pending(t), undefined);
    assert.equal(t.engine.state.cards[t.id("notes")]!.faceDown, true, "flipped face-down");
    assert.equal(zoneOf(t, "mine"), "hand", "no resource was played");
  }
  const own = notesTable();
  developResource(own.engine, P1, own.id("v1"), false);
  resolvePendingResponses(own.engine);
  assert.equal(pending(own), undefined, "P1's own [V] card: no trigger");
  assert.equal(own.engine.state.cards[own.id("notes")]!.faceDown !== true, true);
});

// --- Phantasmagoric Tollbooth --------------------------------------------------------------------------------------
// UNIQUE TOLLBOOTH -- If a non-token character would enter play under an opponent's control, they may pay 1. If they don't, put that character
// into its owner's discard pile instead.

const TOLL = "d70efc6c-9a6e-41ab-92a2-cb97662f172f";

function tollTable(active: PlayerId): Table {
  const maker = (name: string): CardDefinition =>
    tactic({
      name,
      cost: 0,
      behavior: { abilities: [{ id: "mk", type: "activated", effects: [{ type: "createTokens", controller: "controller", count: 1, token: { name: "Tok", cardType: "character", strength: 0, life: 1, speed: 1 } }] }] } as never
    });
  return table(
    3,
    [
      { key: "pt", def: printing(TOLL), owner: P1, zone: "play" },
      { key: "c1", def: character({ name: "C One", cost: 0 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "C Two", cost: 0 }), owner: P2, zone: "hand" },
      { key: "c3", def: character({ name: "C Three", cost: 0 }), owner: P3, zone: "hand" },
      { key: "mk2", def: maker("Maker Two"), owner: P2, zone: "hand" },
      { key: "mk3", def: maker("Maker Three"), owner: P3, zone: "hand" },
      ...bank("rage", 3, P1),
      ...bank("rage", 3, P2),
      ...bank("rage", 3, P3)
    ],
    { active }
  );
}

mpClause(TOLL, "1:rule", 3, "3 seats: a non-token character P2 deploys asks P2 (not P1, not P3) to pay 1; paying keeps it, declining sends it to P2's discard pile; the same for P3's characters", () => {
  for (const [who, other, key] of [[P2, P3, "c2"], [P3, P2, "c3"]] as const) {
    const paid = tollTable(who);
    const ready = Object.fromEntries(paid.seats.map((seat) => [seat, READY(paid, seat)]));
    play(paid, who, key);
    assert.equal(pending(paid)?.kind, "mayPay");
    assert.equal(pending(paid)?.playerId, who, `${who}, the controller-to-be, decides`);
    answer(paid, "mayPay", who, { kind: "mayPay", pay: true });
    assert.equal(pending(paid), undefined);
    assert.equal(zoneOf(paid, key), "play");
    assert.equal(ready[who]! - READY(paid, who), 1, `${who} paid 1`);
    assert.equal(READY(paid, P1), ready[P1], "P1 paid nothing");
    assert.equal(READY(paid, other), ready[other], `${other} paid nothing`);

    const declined = tollTable(who);
    play(declined, who, key);
    answer(declined, "mayPay", who, { kind: "mayPay", pay: false });
    assert.equal(pending(declined), undefined);
    assert.equal(zoneOf(declined, key), "discard", "put into its owner's discard pile instead");
    assert.deepEqual(discardOf(declined, who).includes(declined.id(key)), true);
    assert.equal(discardOf(declined, other).length, 0);
    assert.equal(READY(declined, who), ready[who], "nothing paid");
  }
});

mpClause(TOLL, "1:rule", 3, "3 seats: P1's own characters and token characters under P2 or P3 are not affected", () => {
  const own = tollTable(P1);
  play(own, P1, "c1");
  assert.equal(pending(own), undefined, "no toll question for P1's own character");
  assert.equal(zoneOf(own, "c1"), "play");

  for (const [who, key] of [[P2, "mk2"], [P3, "mk3"]] as const) {
    const t = tollTable(who);
    play(t, who, key);
    assert.equal(pending(t), undefined, `no toll question for ${who}'s token`);
    const toks = Object.values(t.engine.state.cards).filter((c) => c.zone === "play" && c.controllerId === who && t.engine.getDefinition(c.id).name === "Tok");
    assert.equal(toks.length, 1, "the token is in play");
  }
});

// --- Lunk Nut ------------------------------------------------------------------------------------------------------
// At the start of each opponent's turn, restore this card.

const LUNK = "f2e09c65-9f7c-4826-bec1-d1cdb59fa0ea";

type Trigger = { sourceId: string; abilityId: string };

/** Ends the active player's turn; returns the start-of-turn triggers the new active player was asked to order (settled in the order offered). */
function pass(t: Table): Trigger[] {
  t.engine.perform({ type: "endTurn", playerId: t.engine.state.activePlayerId } as never);
  resolvePendingResponses(t.engine);
  const offered: Trigger[] = [];
  for (let guard = 0; guard < 20 && pending(t)?.kind === "orderTriggers"; guard++) {
    const triggers = (pending(t) as unknown as { triggers: Trigger[] }).triggers;
    if (offered.length === 0) offered.push(...triggers);
    answer(t, "orderTriggers", pending(t)!.playerId as PlayerId, { kind: "orderTriggers", next: triggers[0] });
  }
  return offered;
}

function lunkCheck(count: Seats): void {
  const t = table(count, [{ key: "ln", def: printing(LUNK), owner: P1, zone: "play", depleted: true }], { active: P1 });
  const depleted = (): boolean => t.engine.state.cards[t.id("ln")]!.depleted;
  const seats = seatsOf(count);
  assert.equal(depleted(), true);
  for (const opponent of seats.slice(1)) {
    const offered = pass(t);
    assert.equal(t.engine.state.activePlayerId, opponent, `${opponent}'s turn began`);
    assert.ok(offered.some((trigger) => trigger.abilityId === "lunk-nut-restore" && trigger.sourceId === t.id("ln")), `Lunk Nut triggers at the start of ${opponent}'s turn`);
    assert.equal(pending(t), undefined);
    assert.equal(depleted(), false, `restored at the start of ${opponent}'s turn (${opponent}'s Restore Rule restores only ${opponent}'s cards)`);
    t.engine.state.cards[t.id("ln")]!.depleted = true;
  }
  const own = pass(t);
  assert.equal(t.engine.state.activePlayerId, P1, "back to P1");
  assert.equal(own.some((trigger) => trigger.abilityId === "lunk-nut-restore"), false, "Lunk Nut's trigger does not fire at the start of its controller's own turn");
  assert.equal(pending(t), undefined);
}

mpClause(LUNK, "0:rule", 3, "3 seats: P1's depleted Lunk Nut is restored by its trigger at the start of P2's turn and again at the start of P3's; the trigger is not queued at the start of P1's own turn", () => lunkCheck(3));
mpClause(LUNK, "0:rule", 4, "4 seats: its trigger restores it at the start of P2's, P3's and P4's turns and is not queued at P1's", () => lunkCheck(4));

// --- Final Countdown -----------------------------------------------------------------------------------------------
// EXTRA COST: Deploy this card only during your turn.
// Draw 4 cards. At the start of your opponent's next turn detach up to 3 staple resources you control, a character you control gains 2 life that turn,
// and restore a character you control.

const FC = "66238cd1-a654-4900-8cb0-775bb6df6c17";

function fcTable(): Table {
  return table(3, [
    { key: "fc", def: printing(FC), owner: P1, zone: "hand" },
    ...bank("greed", 6, P1),
    { key: "c1", def: character({ name: "C One", life: 9 }), owner: P1, zone: "play", depleted: true },
    { key: "c2", def: character({ name: "C Two", life: 9 }), owner: P1, zone: "play" },
    { key: "f2", def: character({ name: "Foe Two", life: 9 }), owner: P2, zone: "play", depleted: true },
    { key: "f3", def: character({ name: "Foe Three", life: 9 }), owner: P3, zone: "play", depleted: true },
    ...filler("dk", 8, P1, "deck"),
    ...filler("z2-", 3, P2, "deck"),
    ...filler("z3-", 3, P3, "deck")
  ]);
}

/** The ids of P1's resources that are spent (attached to its faction). */
const spentStaples = (t: Table): string[] =>
  t.engine.state.players[P1]!.play.filter((id) => t.engine.isResource(id) && t.engine.state.cards[id]!.attachedTo === factionOf(t, P1));

const declarationId = (t: Table): string | undefined => (pending(t) as unknown as { declaration?: { id: string } } | undefined)?.declaration?.id;

function fcCheck(chosen: PlayerId, skipped: PlayerId): void {
  const t = fcTable();
  const deck =[...deckOf(t, P1)];
  play(t, P1, "fc", { players: { opponent: chosen } });
  assert.equal(pending(t), undefined, "no prompt at play: the opponent came with the action");
  assert.deepEqual(handOf(t, P1), deck.slice(0, 4), "P1 drew 4 at once");
  assert.equal(spentStaples(t).length, 6, "the cost was paid");
  assert.equal(t.engine.state.cards[t.id("c1")]!.depleted, true, "nothing else yet");

  // The turn passes to each opponent in turn; only the chosen one's start fires it.
  let guard = 0;
  while (t.engine.state.activePlayerId !== chosen && guard++ < 5) {
    pass(t);
    if (t.engine.state.activePlayerId === skipped) {
      assert.equal(pending(t), undefined, `nothing happens at the start of ${skipped}'s turn`);
      assert.equal(spentStaples(t).length, 6);
      assert.equal(t.engine.state.cards[t.id("c1")]!.depleted, true);
    }
  }
  assert.equal(t.engine.state.activePlayerId, chosen);
  assert.equal(pending(t)?.kind, "chooserSelectsTarget");
  assert.equal(pending(t)?.playerId, P1, "P1 makes the choices on the chosen opponent's turn");
  assert.equal(declarationId(t), "det");
  const staples = spentStaples(t);
  pickIds(t, P1, ...staples.slice(0, 3));
  assert.equal(declarationId(t), "buff");
  pick(t, P1, "c2");
  assert.equal(declarationId(t), "res");
  pick(t, P1, "c1");
  assert.equal(pending(t), undefined);
  assert.equal(spentStaples(t).length, 3, "three staples detached");
  assert.equal(t.engine.getStat(t.id("c2"), "life"), 11, "the picked character gained 2 life");
  assert.equal(t.engine.getStat(t.id("c1"), "life"), 9);
  assert.equal(t.engine.state.cards[t.id("c1")]!.depleted, false, "the picked character was restored");

  // It does not repeat: a full round later, nothing is asked at any opponent's turn start.
  for (let i = 0; i < 4; i++) {
    pass(t);
    assert.equal(pending(t), undefined, "it fired once only");
  }
}

mpClause(FC, "1:rule", 3, "3 seats: with two opponents the block's opponent is a required step at play (a players step comes first and the play is refused without it), and a stated opponent is accepted", () => {
  const t = fcTable();
  assert.equal(playRequirements(t, P1, "fc").map((r) => r.kind)[0], "players", "the block's opponent is asked first");
  refusal(() => play(t, P1, "fc"));
  assert.equal(zoneOf(t, "fc"), "hand", "refused without an opponent");
  play(t, P1, "fc", { players: { opponent: P3 } });
  assert.equal(zoneOf(t, "fc"), "discard");
});

mpClause(FC, "1:rule", 3, "3 seats: P1 plays it choosing P3 through the action's players field, draws 4 at once, and the rest fires only at the start of P3's next turn, once; P2's turn start does nothing", () => fcCheck(P3, P2));
mpClause(FC, "1:rule", 3, "3 seats: choosing P2 instead, the effect fires at the start of P2's turn only, once, and not at P3's", () => fcCheck(P2, P3));

// --- Leaping Sarume ------------------------------------------------------------------------------------------------
// TACTICAL -- EXTRA COST: Deploy this only not during a battle. -- When this card enters play, inflict 1 damage to all characters.
// [R][R][R][R][R][R]: When this card enters play, inflict 1 damage to all your opponent's characters.

const SARU = "3a90b12f-8ecf-42eb-b67b-9b1c5abf0ddf";

function saruTable(active: PlayerId, rage = 6): Table {
  return table(
    3,
    [
      { key: "sa", def: printing(SARU), owner: P1, zone: "hand" },
      { key: "m1", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "Theirs Two", life: 9 }), owner: P2, zone: "play" },
      { key: "m2b", def: character({ name: "Theirs Two B", life: 9 }), owner: P2, zone: "play" },
      { key: "m3", def: character({ name: "Theirs Three", life: 9 }), owner: P3, zone: "play" },
      { key: "ping", def: tactic({ name: "Ping", cost: 0, behavior: { abilities: [{ id: "p", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } as never }), owner: P1, zone: "hand" },
      ...filler("dk", 2, P1, "deck"),
      ...bank("rage", rage, P1)
    ],
    { active }
  );
}

mpClause(SARU, "1:extraCost", 3, "3 seats: refused during a battle between P2 and P3 that P1 is not in (even though it is TACTICAL), allowed outside a battle", () => {
  const t = saruTable(P2);
  attackOpen(t, P2, ["m2"], { type: "faction", playerId: P3 });
  assert.ok(t.engine.state.battle, "a battle between P2 and P3 is under way");
  while (t.engine.state.responseWindow && t.engine.state.responseWindow.priorityPlayerId !== P1) t.engine.perform({ type: "passPriority", playerId: t.engine.state.responseWindow.priorityPlayerId } as never);
  assert.equal(t.engine.getCardPlayability(P1, t.id("sa")).legalTiming, false, "not during a battle");
  refusal(() => playOpen(t, P1, "sa"));
  assert.equal(zoneOf(t, "sa"), "hand");
  assert.equal(t.engine.getCardPlayability(P1, t.id("ping")).legalTiming, true, "control: an ordinary tactic can be deployed by P1 in this same window");

  const idle = saruTable(P1);
  assert.equal(idle.engine.getCardPlayability(P1, idle.id("sa")).legalTiming, true, "outside a battle");
  play(idle, P1, "sa");
  assert.equal(zoneOf(idle, "sa"), "play");
});

mpClause(SARU, "2:rule", 3, "3 seats: entering play inflicts 1 damage to all characters: P1's, P2's and P3's each take 1 (below six [R], no opponent is chosen)", () => {
  const t = saruTable(P1, 4);
  assert.deepEqual(playRequirements(t, P1, "sa").filter((r) => r.kind === "players"), []);
  play(t, P1, "sa");
  assert.equal(pending(t), undefined, "no opponent prompt without the threshold");
  for (const key of ["m1", "m2", "m2b", "m3", "sa"]) assert.equal(damageOf(t, key), 1, `${key} took 1`);
});

mpClause(SARU, "3:rule@rrrrrr", 3, "3 seats: with six [R] P1 is offered P2 and P3 when the trigger resolves and picks P2: P2's characters take a second damage (2 total), P3's and P1's only the first; a second run picking P3 does the reverse", () => {
  for (const [picked, bystander, pickedKeys, bystanderKeys] of [[P2, P3, ["m2", "m2b"], ["m3"]], [P3, P2, ["m3"], ["m2", "m2b"]]] as const) {
    const t = saruTable(P1);
    assert.deepEqual(playRequirements(t, P1, "sa").filter((r) => r.kind === "players"), [], "no opponent is selected at play");
    playOpen(t, P1, "sa");
    resolvePendingResponses(t.engine);
    for (let guard = 0; guard < 5 && pending(t)?.kind === "orderTriggers"; guard++)
      answer(t, "orderTriggers", P1, { kind: "orderTriggers", next: (pending(t) as unknown as { triggers: unknown[] }).triggers[0] });
    assert.equal(pending(t)?.kind, "choosePlayer");
    assert.equal(pending(t)?.playerId, P1);
    assert.deepEqual(candidates(t), [P2, P3]);
    choosePlayer(t, P1, picked);
    assert.equal(pending(t), undefined);
    for (const key of pickedKeys) assert.equal(damageOf(t, key), 2, `${key} (${picked}) took both`);
    for (const key of bystanderKeys) assert.equal(damageOf(t, key), 1, `${key} (${bystander}) took only the first`);
    assert.equal(damageOf(t, "m1"), 1, "P1's own character took only the first");
    assert.equal(damageOf(t, "sa"), 1);
  }
});
