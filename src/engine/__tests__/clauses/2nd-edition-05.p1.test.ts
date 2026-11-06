import assert from "node:assert/strict";
import type { CardDefinition } from "../../../engine.js";
import { buildGame, activate, autoResolveBattle, bank, character, developFaction, drawerChar, item, killTactic, location, P1, P2, play, resourceCard, tactic } from "../per-card/_harness.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { clause, printing, refused } from "./_clause.js";
import { endTurn } from "./_turn.js";

// ---------------------------------------------------------------------------
// Carnival King
// ---------------------------------------------------------------------------

const CARNIVAL_KING = "4a9df555-6306-4b9b-bc2a-f86897258769"; // CONGA LINE -- COST: Pay 3. Deplete this card. Pick a character not in a battle. -- EFFECT: This turn, all characters able to block the character must do so. When an attacking party is formed including the character, it must have only 1 member.

const COVERT = { keywords: ["covert" as const] };

/** P1's turn. King + attackers a/d/e (P1), blockers b1/b2 (ready) and b3 (depleted) for P2, 5 resources for P1 (3 rage + 2 greed). */
function congaBoard(resources = 5) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "king", def: printing(CARNIVAL_KING), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "Picked" }), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "Other" }), owner: P1, zone: "play" },
      { key: "e", def: character({ name: "Another" }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "Blocker1" }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "Blocker2" }), owner: P2, zone: "play" },
      { key: "b3", def: character({ name: "SpentBlocker" }), owner: P2, zone: "play", depleted: true },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
      ...bank("rage", Math.min(resources, 3), P1),
      ...bank("greed", Math.max(0, resources - 3), P1),
      ...fillers("p1deck", 3, P1, "deck"),
      ...fillers("p2deck", 3, P2, "deck")
    ]
  });
}

type Built = ReturnType<typeof congaBoard>;
const conga = (b: Built, target: string) => activate(b.engine, P1, b.id("king"), "conga", { selected: { c: [b.id(target)] } });

clause(CARNIVAL_KING, "0:ability:conga", "COST: pays exactly 3 resources and depletes the King; the pick is made", () => {
  const b = congaBoard(5);
  assert.equal(readyResources(b.engine, P1), 5);
  assert.equal(b.engine.state.cards[b.id("king")].depleted, false);
  conga(b, "a");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(b.engine, P1), 2, "3 of 5 resources spent");
  assert.equal(b.engine.state.cards[b.id("king")].depleted, true, "the King is depleted");
  // the pick took effect: A's party is capped at one member
  declareAttackBy(b.engine, P1, [b.id("a")]);
  assert.deepEqual(b.engine.state.battle?.attackingParty, [b.id("a")]);
});

clause(CARNIVAL_KING, "0:ability:conga", "COST: refused with only 2 resources (3 works) and when the King is already depleted", () => {
  const short = congaBoard(2);
  refused(() => conga(short, "a"), "Pay 3 with 2 resources");
  assert.equal(short.engine.state.cards[short.id("king")].depleted, false, "nothing was spent");
  assert.equal(readyResources(short.engine, P1), 2);
  const exact = congaBoard(3);
  conga(exact, "a");
  assert.equal(readyResources(exact.engine, P1), 0, "control: exactly 3 resources is enough");

  const spent = congaBoard(5);
  spent.engine.state.cards[spent.id("king")].depleted = true;
  refused(() => conga(spent, "a"), "the King is depleted (cost: deplete this card)");
  assert.equal(readyResources(spent.engine, P1), 5);
});

clause(CARNIVAL_KING, "0:ability:conga", "Pick: any character not in a battle (own, opponent's, the King itself); never a non-character", () => {
  for (const key of ["a", "b1", "king"]) {
    const b = congaBoard(5);
    conga(b, key);
    assert.equal(b.engine.state.cards[b.id("king")].depleted, true, `${key} is a legal pick`);
  }
  const b = congaBoard(5);
  refused(() => conga(b, "gadget"), "an item is not a character");
  assert.equal(b.engine.state.cards[b.id("king")].depleted, false, "nothing was paid for the refused pick");
  assert.equal(readyResources(b.engine, P1), 5);
  conga(b, "a");
  assert.equal(b.engine.state.cards[b.id("king")].depleted, true, "control: a character works");
});

clause(CARNIVAL_KING, "0:ability:conga", "Pick: a character in a battle (attacker or blocker) is refused; one outside the battle is fine", () => {
  const b = congaBoard(5);
  declareAttackBy(b.engine, P1, [b.id("d")]);
  declareBlockers(b.engine, P2, [b.id("b1")]);
  const act = (target: string) =>
    b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("king"), abilityId: "conga", selected: { c: [b.id(target)] }, variables: {} });
  refused(() => act("d"), "an attacking character is in a battle");
  refused(() => act("b1"), "a blocking character is in a battle");
  assert.equal(b.engine.state.cards[b.id("king")].depleted, false, "nothing paid for refused picks");
  act("a");
  assert.equal(b.engine.state.cards[b.id("king")].depleted, true, "control: a character outside the battle is a legal pick");
});

clause(CARNIVAL_KING, "0:ability:conga", "EFFECT: every character able to block the picked character must do so (declaring fewer is refused)", () => {
  const b = congaBoard(5);
  conga(b, "a");
  declareAttackBy(b.engine, P1, [b.id("a")]);
  refused(() => declareBlockers(b.engine, P2, []), "no blockers declared while two characters can block", /must block/);
  refused(() => declareBlockers(b.engine, P2, [b.id("b1")]), "only one of the two able blockers", /must block/);
  refused(() => declareBlockers(b.engine, P2, [b.id("b2")]), "only the other able blocker", /must block/);
  declareBlockers(b.engine, P2, [b.id("b1"), b.id("b2")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("b1"), b.id("b2")], "both able characters block; the depleted one (unable) was not required");
});

clause(CARNIVAL_KING, "0:ability:conga", "EFFECT: only characters ABLE to block must; a covert picked character can only be blocked by covert characters", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "king", def: printing(CARNIVAL_KING), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "SneakyPicked", behavior: COVERT }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "PlainBlocker" }), owner: P2, zone: "play" },
      { key: "covertB", def: character({ name: "CovertBlocker", behavior: COVERT }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  conga(b, "a");
  declareAttackBy(b.engine, P1, [b.id("a")]);
  refused(() => declareBlockers(b.engine, P2, []), "the covert blocker is able to block and must", /must block/);
  declareBlockers(b.engine, P2, [b.id("covertB")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("covertB")], "the plain character cannot block a covert party, so it is not required to");
});

clause(CARNIVAL_KING, "0:ability:conga", "EFFECT: the forced block is only for the picked character; other attackers can still go unblocked", () => {
  const b = congaBoard(5);
  conga(b, "a");
  declareAttackBy(b.engine, P1, [b.id("d")]);
  declareBlockers(b.engine, P2, []);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [], "D is not the picked character, so nobody must block it");
});

clause(CARNIVAL_KING, "0:ability:conga", "EFFECT: a party that includes the picked character must have only 1 member (others are unrestricted)", () => {
  const before = congaBoard(5);
  declareAttackBy(before.engine, P1, [before.id("a"), before.id("d")]);
  assert.deepEqual(before.engine.state.battle?.attackingParty, [before.id("a"), before.id("d")], "control: before the ability a 2-member party is fine");

  const b = congaBoard(5);
  conga(b, "a");
  refused(() => declareAttackBy(b.engine, P1, [b.id("a"), b.id("d")]), "a 2-member party including the picked character", /member|party/i);
  refused(() => declareAttackBy(b.engine, P1, [b.id("d"), b.id("a"), b.id("e")]), "a 3-member party including the picked character", /member|party/i);
  assert.equal(b.engine.state.battle, undefined, "no attack was declared");
  // a party without the picked character is unrestricted
  declareAttackBy(b.engine, P1, [b.id("d"), b.id("e")]);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("d"), b.id("e")]);
});

clause(CARNIVAL_KING, "0:ability:conga", "EFFECT: the picked character may attack alone", () => {
  const b = congaBoard(5);
  conga(b, "a");
  declareAttackBy(b.engine, P1, [b.id("a")]);
  assert.deepEqual(b.engine.state.battle?.attackingParty, [b.id("a")]);
});

clause(CARNIVAL_KING, "0:ability:conga", "Duration: both effects end with the turn", () => {
  const b = congaBoard(5);
  conga(b, "a");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.ok(b.engine.state.turn > 2, "a new turn began");
  // party limit is gone
  declareAttackBy(b.engine, P1, [b.id("a"), b.id("d")]);
  assert.deepEqual(b.engine.state.battle?.attackingParty, [b.id("a"), b.id("d")], "a 2-member party including the picked character is legal again");
  // forced block is gone
  declareBlockers(b.engine, P2, []);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [], "nobody is forced to block any more");
});

clause(CARNIVAL_KING, "0:ability:conga", "Opponent's character picked: its party is limited to 1 and my characters must block it", () => {
  // P2's turn; P1 responds to a P2 ability by picking P2's character with Conga Line.
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 3,
    activePlayerId: P2,
    cards: [
      { key: "king", def: printing(CARNIVAL_KING), owner: P1, zone: "play" },
      { key: "x", def: character({ name: "TheirPicked" }), owner: P2, zone: "play" },
      { key: "y", def: character({ name: "TheirOther" }), owner: P2, zone: "play" },
      {
        key: "tinker",
        def: character({
          name: "Tinker",
          behavior: { abilities: [{ id: "tink", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
        }),
        owner: P2,
        zone: "play"
      },
      { key: "m1", def: character({ name: "MyBlocker1" }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "MyBlocker2" }), owner: P1, zone: "play" },
      ...bank("rage", 3, P1),
      ...fillers("p2deck", 3, P2, "deck")
    ]
  });
  b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("tinker"), abilityId: "tink", selected: {}, variables: {} });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "P1 holds priority in the response window");
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("king"), abilityId: "conga", selected: { c: [b.id("x")] }, variables: {} });
  assert.equal(b.engine.state.cards[b.id("king")].depleted, true);
  while (b.engine.state.responseWindow) {
    const w = b.engine.state.responseWindow;
    b.engine.perform(w.phase === "acceptingResponses" ? { type: "passPriority", playerId: w.priorityPlayerId } : { type: "advanceFlow" });
  }
  refused(() => declareAttackBy(b.engine, P2, [b.id("x"), b.id("y")]), "their picked character in a 2-member party", /member|party/i);
  declareAttackBy(b.engine, P2, [b.id("x")]);
  refused(() => declareBlockers(b.engine, P1, []), "P1's characters must block the picked attacker", /must block/);
  declareBlockers(b.engine, P1, [b.id("m1"), b.id("m2")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("m1"), b.id("m2")]);
});

clause(CARNIVAL_KING, "0:ability:conga", "EFFECT: a character that comes into play later this turn and is able to block the picked character must block it too", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "king", def: printing(CARNIVAL_KING), owner: P1, zone: "play" },
      { key: "a", def: character({ name: "Picked" }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "Blocker1" }), owner: P2, zone: "play" },
      { key: "late", def: character({ name: "LateArrival" }), owner: P2, zone: "hand" },
      {
        key: "summon",
        def: tactic({
          name: "Summon",
          cost: 0,
          behavior: {
            abilities: [
              {
                id: "s",
                type: "activated",
                targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }],
                effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
              }
            ]
          }
        }),
        owner: P2,
        zone: "hand"
      },
      ...bank("rage", 3, P1)
    ]
  });
  conga(b, "a");
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("a")], target: { type: "faction", playerId: P2 } });
  b.engine.perform({ type: "passPriority", playerId: P1 });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("summon"), selected: { t: [b.id("late")] }, variables: {} } as never);
  while (b.engine.state.responseWindow) {
    const w = b.engine.state.responseWindow;
    b.engine.perform(w.phase === "acceptingResponses" ? { type: "passPriority", playerId: w.priorityPlayerId } : { type: "advanceFlow" });
  }
  assert.equal(zoneOf(b.engine, b.id("late")), "play", "the late arrival is in play");
  refused(() => declareBlockers(b.engine, P2, [b.id("b1")]), "the late arrival is able to block and so must", /must block/);
  declareBlockers(b.engine, P2, [b.id("b1"), b.id("late")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("b1"), b.id("late")]);
});

// ---------------------------------------------------------------------------
// Catastrophic Betrayal
// ---------------------------------------------------------------------------

const BETRAYAL = "a2c972fc-f5de-4976-a2c6-a0518fa1a0e4"; // COST: Play this only while you are attacking. Pick a character in your opponent's discard pile. -- EFFECT: Put the character into play under your control as a member of the attacking party. Deplete it.

/** P1's turn, cost 5 / threshold d: 1 deception + 4 rage by default. */
function betrayalBoard(opts: { deception?: number; rage?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "bt", def: printing(BETRAYAL), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "Attacker", strength: 2 }), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker" }), owner: P2, zone: "play" },
      { key: "fallen", def: character({ name: "FallenFoe", strength: 3, life: 2 }), owner: P2, zone: "discard" },
      { key: "fallen2", def: character({ name: "FallenFoe2" }), owner: P2, zone: "discard" },
      { key: "relic", def: item({ name: "Relic" }), owner: P2, zone: "discard" },
      { key: "mine", def: character({ name: "MyFallen" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "TheirHand" }), owner: P2, zone: "hand" },
      { key: "theirDeck", def: character({ name: "TheirDeck" }), owner: P2, zone: "deck" },
      ...bank("deception", opts.deception ?? 1, P1),
      ...bank("rage", opts.rage ?? 4, P1),
      ...fillers("p1deck", 3, P1, "deck")
    ]
  });
}
type BetrayalBoard = ReturnType<typeof betrayalBoard>;
/** P1 declares an attack and (as the attacker) still holds priority. */
const attackWith = (b: BetrayalBoard, ...keys: string[]) =>
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: keys.map(b.id), target: { type: "faction", playerId: P2 } });
const betray = (b: BetrayalBoard, target: string) => play(b.engine, P1, b.id("bt"), { selected: { c: [b.id(target)] } });

clause(BETRAYAL, "0:ability", "EFFECT: the picked discard-pile character enters under my control, in the attacking party, depleted; COST 5 is paid", () => {
  const b = betrayalBoard();
  attackWith(b, "a");
  assert.equal(readyResources(b.engine, P1), 5);
  betray(b, "fallen");
  assert.equal(b.engine.state.pendingChoice, undefined);
  const fallen = b.engine.state.cards[b.id("fallen")];
  assert.equal(fallen.zone, "play", "put into play");
  assert.equal(fallen.controllerId, P1, "under my control");
  assert.equal(fallen.ownerId, P2, "still owned by the opponent");
  assert.equal(fallen.depleted, true, "deplete it");
  assert.deepEqual(b.engine.state.battle?.attackingParty, [b.id("a"), b.id("fallen")], "a member of the attacking party");
  assert.equal(zoneOf(b.engine, b.id("bt")), "discard", "the tactic was played");
  assert.equal(readyResources(b.engine, P1), 0, "COST 5 paid");
  assert.equal(b.engine.state.cards[b.id("d")].depleted, false, "control: a bystander is not depleted");
  assert.equal(zoneOf(b.engine, b.id("fallen2")), "discard", "control: the other discard-pile character stays");
  assert.equal(zoneOf(b.engine, b.id("relic")), "discard", "control: the item stays");
});

clause(BETRAYAL, "0:ability", "EFFECT: the betrayed character fights in the attack (its strength is dealt to the defender's faction)", () => {
  const b = betrayalBoard();
  const before = b.engine.state.players[P2].influence;
  attackWith(b, "a");
  betray(b, "fallen");
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(b.engine.state.players[P2].influence, before - 5, "Attacker 2 + FallenFoe 3 damage the faction");
  assert.equal(zoneOf(b.engine, b.id("fallen")), "play", "it survives and stays under my control");
  assert.equal(b.engine.state.cards[b.id("fallen")].controllerId, P1);
});

clause(BETRAYAL, "0:ability", "EFFECT: any character in the opponent's discard pile can be picked (a second one works too)", () => {
  const b = betrayalBoard();
  attackWith(b, "a");
  betray(b, "fallen2");
  assert.equal(zoneOf(b.engine, b.id("fallen2")), "play");
  assert.equal(b.engine.state.cards[b.id("fallen2")].controllerId, P1);
  assert.deepEqual(b.engine.state.battle?.attackingParty, [b.id("a"), b.id("fallen2")]);
  assert.equal(zoneOf(b.engine, b.id("fallen")), "discard", "control: the other one stays");
});

clause(BETRAYAL, "0:ability", "Pick: only a CHARACTER in the OPPONENT'S DISCARD PILE (not my discard, their hand/deck/play, or an item)", () => {
  const b = betrayalBoard();
  attackWith(b, "a");
  for (const [key, why] of [
    ["mine", "a character in my own discard pile"],
    ["theirHand", "a character in their hand"],
    ["theirDeck", "a character in their deck"],
    ["blocker", "a character in play"],
    ["relic", "an item in their discard pile"]
  ] as const) {
    refused(() => betray(b, key), why);
  }
  assert.equal(zoneOf(b.engine, b.id("bt")), "hand", "nothing was played or paid for the refused picks");
  assert.equal(readyResources(b.engine, P1), 5);
  betray(b, "fallen");
  assert.equal(zoneOf(b.engine, b.id("fallen")), "play", "control: a character in their discard pile is a legal pick");
});

clause(BETRAYAL, "0:ability", "Play only while attacking: refused outside a battle and while defending; works while attacking, also after blockers", () => {
  const idle = betrayalBoard();
  refused(() => betray(idle, "fallen"), "no battle: I am not attacking");
  assert.equal(zoneOf(idle.engine, idle.id("fallen")), "discard");

  // The opponent attacks me: I am defending.
  const defending = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 3,
    activePlayerId: P2,
    cards: [
      { key: "bt", def: printing(BETRAYAL), owner: P1, zone: "hand" },
      { key: "theirAttacker", def: character({ name: "TheirAttacker" }), owner: P2, zone: "play" },
      { key: "fallen", def: character({ name: "FallenFoe" }), owner: P2, zone: "discard" },
      ...bank("deception", 1, P1),
      ...bank("rage", 4, P1)
    ]
  });
  declareAttackOpenWindow(defending.engine, P2, [defending.id("theirAttacker")]);
  assert.equal(defending.engine.state.responseWindow?.priorityPlayerId, P1, "P1 can respond to their attack");
  refused(
    () => defending.engine.perform({ type: "playCard", playerId: P1, cardId: defending.id("bt"), selected: { c: [defending.id("fallen")] }, variables: {} } as never),
    "I am defending, not attacking"
  );
  assert.equal(zoneOf(defending.engine, defending.id("fallen")), "discard");

  // Positive controls: while attacking, at declaration and again after blockers.
  const atDeclare = betrayalBoard();
  attackWith(atDeclare, "a");
  betray(atDeclare, "fallen");
  assert.equal(zoneOf(atDeclare.engine, atDeclare.id("fallen")), "play");

  const afterBlock = betrayalBoard();
  declareAttackBy(afterBlock.engine, P1, [afterBlock.id("a")]);
  declareBlockers(afterBlock.engine, P2, [afterBlock.id("blocker")]);
  betray(afterBlock, "fallen");
  assert.equal(zoneOf(afterBlock.engine, afterBlock.id("fallen")), "play", "still attacking after blockers are declared");
  assert.deepEqual(afterBlock.engine.state.battle?.attackingParty, [afterBlock.id("a"), afterBlock.id("fallen")]);
});

clause(BETRAYAL, "0:ability", "Cost 5 / threshold d: refused with 4 resources and with 5 resources lacking the d icon", () => {
  const short = betrayalBoard({ deception: 1, rage: 3 });
  attackWith(short, "a");
  refused(() => betray(short, "fallen"), "only 4 resources");
  assert.equal(zoneOf(short.engine, short.id("bt")), "hand");
  assert.equal(readyResources(short.engine, P1), 4);

  const noIcon = betrayalBoard({ deception: 0, rage: 5 });
  attackWith(noIcon, "a");
  refused(() => betray(noIcon, "fallen"), "5 resources but no deception icon");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("bt")), "hand");
  assert.equal(readyResources(noIcon.engine, P1), 5);

  const ok = betrayalBoard({ deception: 1, rage: 4 });
  attackWith(ok, "a");
  betray(ok, "fallen");
  assert.equal(zoneOf(ok.engine, ok.id("bt")), "discard", "control: 5 resources with a d icon works");
});

// ---------------------------------------------------------------------------
// Cheats McGuillicutty
// ---------------------------------------------------------------------------

const CHEATS = "078b8b9a-b559-44b9-b86d-7cee8727b3ad"; // UNIQUE PLUCK -- The top card of your deck is revealed at all times. -- BOTTOM DEAL -- COST: Pay 1. -- EFFECT: Put the top card of your deck on the bottom. -- CHEAT -- COST: Deplete this card. -- EFFECT: Reveal the top card of your deck. You may play it. (You can't play resources with this ability.) -- CHANGE COSTUME -- COST: Pay 3. Shuffle this card into its owner's deck. -- EFFECT: Search your deck for a "pluck" card with a different name than this card and put it into play.

/** P1's turn: Cheats in play, `rage` rage resources, `deck` (top first) as P1's deck, two fillers as P2's deck. */
function cheatsBoard(deck: CardDefinition[], opts: { rage?: number; deception?: number; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: opts.random,
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 5, P1),
      ...bank("deception", opts.deception ?? 0, P1),
      ...deck.map((def, i) => ({ key: `d${i}`, def, owner: P1, zone: "deck" as const })),
      ...fillers("o", 2, P2, "deck")
    ]
  });
}
type CheatsBoard = ReturnType<typeof cheatsBoard>;
const deckOf = (b: CheatsBoard, p = P1) => b.engine.state.players[p].deck;
const deckKeys = (b: CheatsBoard, keys: string[], p = P1) => deckOf(b, p).map((cardId) => keys.find((k) => b.id(k) === cardId) ?? cardId);
const revealedTop = (b: CheatsBoard) => b.engine.getFlowView().revealed.deckTop.map((e) => [e.playerId, e.cardId]);
const revealEvents = (b: CheatsBoard) => b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
const cheatsDeck = [character({ name: "Top", cost: 2 }), character({ name: "Second", cost: 2 }), character({ name: "Third", cost: 2 }), character({ name: "Fourth", cost: 2 })];

// --- 0:unique --------------------------------------------------------------

/** P1 controls Cheats; P2 controls their own Cheats; P1 has a second Cheats, another UNIQUE PLUCK card, a UNIQUE LONE card, in hand. */
function uniqueBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "theirs", def: printing(CHEATS), owner: P2, zone: "play" },
      { key: "copy", def: printing(CHEATS), owner: P1, zone: "hand" },
      { key: "otherPluck", def: character({ name: "OtherPluck", unique: "pluck", subtype: ["pluck"], cost: 1 }), owner: P1, zone: "hand" },
      { key: "lone", def: character({ name: "LoneWolf", unique: "lone", cost: 1 }), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1),
      ...bank("rage", 5, P1)
    ]
  });
}
const keepOf = (b: ReturnType<typeof uniqueBoard>, key: string) => {
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses which to keep");
  answerPending(b.engine, "uniqueSurvivor", { keep: b.id(key) });
};

clause(CHEATS, "0:unique", "a second copy under my control: I choose which to keep (either), the other is destroyed", () => {
  for (const [keep, lose] of [["cheats", "copy"], ["copy", "cheats"]] as const) {
    const b = uniqueBoard();
    play(b.engine, P1, b.id("copy"));
    const pc = pending(b.engine)!;
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.deepEqual([...(pc.candidates as string[])].sort(), [b.id("cheats"), b.id("copy")].sort(), "both copies are candidates");
    keepOf(b, keep);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id(keep)), "play", `${keep} kept`);
    assert.equal(zoneOf(b.engine, b.id(lose)), "discard", `${lose} destroyed`);
    assert.equal(zoneOf(b.engine, b.id("theirs")), "play", "the opponent's own copy is untouched");
  }
});

clause(CHEATS, "0:unique", "a different card carrying UNIQUE PLUCK also conflicts; a different Unique identifier does not", () => {
  const b = uniqueBoard();
  play(b.engine, P1, b.id("otherPluck"));
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.unique, "pluck");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [b.id("cheats"), b.id("otherPluck")].sort());
  keepOf(b, "otherPluck");
  assert.equal(zoneOf(b.engine, b.id("cheats")), "discard", "Cheats destroyed");
  assert.equal(zoneOf(b.engine, b.id("otherPluck")), "play");

  const c = uniqueBoard();
  play(c.engine, P1, c.id("lone"));
  assert.equal(c.engine.state.pendingChoice, undefined, "UNIQUE LONE does not conflict with UNIQUE PLUCK");
  assert.equal(zoneOf(c.engine, c.id("lone")), "play");
  assert.equal(zoneOf(c.engine, c.id("cheats")), "play");
  assert.equal(zoneOf(c.engine, c.id("theirs")), "play", "my single copy next to the opponent's single copy is legal");
});

// --- 1:rule ----------------------------------------------------------------

clause(CHEATS, "1:rule", "the top card of the controller's deck (and only theirs) is revealed; it follows the top as the deck changes", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "reader", def: drawerChar(), owner: P1, zone: "play" },
      ...cheatsDeck.map((def, i) => ({ key: `d${i}`, def, owner: P1, zone: "deck" as const })),
      ...fillers("o", 2, P2, "deck")
    ]
  });
  assert.equal(b.engine.state.players[P1].deck[0], b.id("d0"), "d0 is the top");
  assert.deepEqual(revealedTop(b), [[P1, b.id("d0")]], "my top card is public; the opponent's is not");
  activate(b.engine, P1, b.id("reader"), "draw1");
  assert.equal(zoneOf(b.engine, b.id("d0")), "hand", "the top card was drawn");
  assert.deepEqual(revealedTop(b), [[P1, b.id("d1")]], "the next card is now the revealed one");
});

clause(CHEATS, "1:rule", "revealed while Cheats is in play, not before it arrives, not after it leaves", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1),
      ...bank("rage", 4, P1),
      ...fillers("d", 3, P1, "deck"),
      ...fillers("o", 2, P2, "deck")
    ]
  });
  assert.deepEqual(b.engine.getFlowView().revealed.deckTop, [], "Cheats in hand: nothing revealed");
  play(b.engine, P1, b.id("cheats"));
  assert.deepEqual(revealedTop(b), [[P1, b.id("d0")]], "Cheats in play: revealed");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("cheats")] } });
  assert.equal(zoneOf(b.engine, b.id("cheats")), "discard");
  assert.deepEqual(b.engine.getFlowView().revealed.deckTop, [], "Cheats gone: not revealed");
  b.engine.state.players[P1].deck.reverse();
  assert.deepEqual(b.engine.getFlowView().revealed.deckTop, [], "still not revealed after the deck changes");
});

clause(CHEATS, "1:rule", "'your deck' is the CONTROLLER'S deck", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, controller: P2, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("o", 2, P2, "deck")
    ]
  });
  assert.deepEqual(revealedTop(b), [[P2, b.id("o0")]], "P2 controls Cheats, so P2's top card is the revealed one");
});

// --- 2:ability:bottomdeal ---------------------------------------------------

clause(CHEATS, "2:ability:bottomdeal", "COST pay 1; EFFECT the top card goes to the bottom (twice in a row rotates two)", () => {
  const b = cheatsBoard(cheatsDeck);
  const keys = ["d0", "d1", "d2", "d3"];
  const theirs = [...deckOf(b, P2)];
  assert.deepEqual(deckKeys(b, keys), keys);
  assert.equal(readyResources(b.engine, P1), 5);
  activate(b.engine, P1, b.id("cheats"), "bottomdeal");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckKeys(b, keys), ["d1", "d2", "d3", "d0"], "top card to the bottom");
  assert.equal(readyResources(b.engine, P1), 4, "pay 1");
  assert.equal(b.engine.state.cards[b.id("cheats")].depleted, false, "no deplete in the cost");
  assert.deepEqual(revealedTop(b), [[P1, b.id("d1")]], "the new top card is the revealed one");
  activate(b.engine, P1, b.id("cheats"), "bottomdeal");
  assert.deepEqual(deckKeys(b, keys), ["d2", "d3", "d0", "d1"]);
  assert.equal(readyResources(b.engine, P1), 3);
  assert.deepEqual(deckOf(b, P2), theirs, "the opponent's deck is untouched");
});

clause(CHEATS, "2:ability:bottomdeal", "refused without a resource to pay 1 (exactly 1 works)", () => {
  const none = cheatsBoard(cheatsDeck, { rage: 0 });
  refused(() => activate(none.engine, P1, none.id("cheats"), "bottomdeal"), "no resources to pay 1");
  assert.deepEqual(deckKeys(none, ["d0", "d1", "d2", "d3"]), ["d0", "d1", "d2", "d3"], "deck unchanged");
  const one = cheatsBoard(cheatsDeck, { rage: 1 });
  activate(one.engine, P1, one.id("cheats"), "bottomdeal");
  assert.equal(readyResources(one.engine, P1), 0);
  assert.deepEqual(deckKeys(one, ["d0", "d1", "d2", "d3"]), ["d1", "d2", "d3", "d0"]);
});

// --- 3:ability:cheat --------------------------------------------------------

const acceptTop = (b: CheatsBoard) => answerPending(b.engine, "deployForFree", { cardId: b.id("d0") });
const declineTop = (b: CheatsBoard) => answerPending(b.engine, "deployForFree", {});

clause(CHEATS, "3:ability:cheat", "COST deplete; EFFECT reveals my top card to everyone and offers to play exactly that card", () => {
  const b = cheatsBoard(cheatsDeck);
  const theirs = [...deckOf(b, P2)];
  assert.equal(b.engine.state.cards[b.id("cheats")].depleted, false);
  activate(b.engine, P1, b.id("cheats"), "cheat");
  assert.equal(b.engine.state.cards[b.id("cheats")].depleted, true, "deplete this card");
  const reveals = revealEvents(b);
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; zone: string; ownerId: string; viewerId: string; byCardId: string };
  assert.deepEqual([ev.cardIds, ev.zone, ev.ownerId, ev.viewerId, ev.byCardId], [[b.id("d0")], "deck", P1, "all", b.id("cheats")], "the top card is revealed to all players");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "deployForFree");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.candidates, [b.id("d0")], "only the revealed top card may be played");
  assert.deepEqual(deckOf(b, P2), theirs, "the opponent's deck is untouched");
});

clause(CHEATS, "3:ability:cheat", "'You may play it' (accept): it is played and its cost paid", () => {
  const b = cheatsBoard(cheatsDeck);
  activate(b.engine, P1, b.id("cheats"), "cheat");
  acceptTop(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("d0")), "play", "the character entered play");
  assert.equal(b.engine.state.cards[b.id("d0")].controllerId, P1);
  assert.equal(readyResources(b.engine, P1), 3, "its cost 2 was paid");
  assert.deepEqual(deckKeys(b, ["d1", "d2", "d3"]), ["d1", "d2", "d3"], "the rest of the deck is unchanged");
  assert.equal(b.engine.state.cards[b.id("cheats")].depleted, true);
});

clause(CHEATS, "3:ability:cheat", "'You may play it' (decline): the card stays on top, nothing is paid", () => {
  const b = cheatsBoard(cheatsDeck);
  activate(b.engine, P1, b.id("cheats"), "cheat");
  declineTop(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckKeys(b, ["d0", "d1", "d2", "d3"]), ["d0", "d1", "d2", "d3"], "still on top");
  assert.equal(zoneOf(b.engine, b.id("d0")), "deck");
  assert.equal(readyResources(b.engine, P1), 5, "nothing paid");
  assert.equal(b.engine.state.cards[b.id("cheats")].depleted, true, "the cost was paid anyway");
  assert.equal(revealEvents(b).length, 1, "it was still revealed");
});

clause(CHEATS, "3:ability:cheat", "COST: refused while Cheats is depleted; needs no resources", () => {
  const spent = cheatsBoard(cheatsDeck);
  spent.engine.state.cards[spent.id("cheats")].depleted = true;
  refused(() => activate(spent.engine, P1, spent.id("cheats"), "cheat"), "already depleted");
  assert.equal(spent.engine.state.pendingChoice, undefined);
  assert.equal(revealEvents(spent).length, 0);

  const broke = cheatsBoard(cheatsDeck, { rage: 0 });
  activate(broke.engine, P1, broke.id("cheats"), "cheat");
  assert.equal(pending(broke.engine)?.kind, "deployForFree", "control: with no resources it still reveals and offers the card");
  assert.equal(revealEvents(broke).length, 1);
});

for (const [kind, make] of [
  ["character", () => character({ name: "TopChar", cost: 2 })],
  ["item", () => item({ name: "TopItem", cost: 2 })],
  ["location", () => location({ name: "TopLocation", cost: 2, structure: 3 })]
] as const) {
  clause(CHEATS, "3:ability:cheat", `a ${kind} on top can be played with Cheat (enters play, cost paid)`, () => {
    const b = cheatsBoard([make(), ...cheatsDeck]);
    activate(b.engine, P1, b.id("cheats"), "cheat");
    acceptTop(b);
    assert.equal(zoneOf(b.engine, b.id("d0")), "play");
    assert.equal(b.engine.state.cards[b.id("d0")].controllerId, P1);
    assert.equal(readyResources(b.engine, P1), 3);
  });
}

clause(CHEATS, "3:ability:cheat", "a tactic on top can be played with Cheat (its effect happens, cost paid)", () => {
  const drawTactic = tactic({
    name: "TopTactic",
    cost: 2,
    behavior: { abilities: [{ id: "t", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = cheatsBoard([drawTactic, ...cheatsDeck]);
  activate(b.engine, P1, b.id("cheats"), "cheat");
  acceptTop(b);
  assert.equal(zoneOf(b.engine, b.id("d0")), "discard", "the tactic was played and is in the discard pile");
  assert.equal(zoneOf(b.engine, b.id("d1")), "hand", "its effect drew a card");
  assert.equal(readyResources(b.engine, P1), 3, "its cost 2 was paid");
});

clause(CHEATS, "3:ability:cheat", "(You can't play resources with this ability): a resource on top can't be played", () => {
  const spare = resourceCard({ name: "SpareResource", resource: { provides: ["rage"], staple: true } });
  const b = cheatsBoard([spare, ...cheatsDeck]);
  activate(b.engine, P1, b.id("cheats"), "cheat");
  assert.equal(revealEvents(b).length, 1, "it is still revealed");
  if (pending(b.engine)) {
    refused(() => acceptTop(b), "Cheat cannot play a resource");
    declineTop(b);
  }
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("d0")), "deck", "the resource was not played");
  assert.equal(deckOf(b)[0], b.id("d0"), "and is still on top");
  assert.equal(b.engine.state.cards[b.id("cheats")].depleted, true);
});

clause(CHEATS, "3:ability:cheat", "'play it' means pay its cost: an unaffordable top card can't be played (affordable one can)", () => {
  const dear = cheatsBoard([character({ name: "Dear", cost: 4 }), ...cheatsDeck], { rage: 3 });
  activate(dear.engine, P1, dear.id("cheats"), "cheat");
  if (pending(dear.engine)) {
    refused(() => acceptTop(dear), "cost 4 with 3 resources");
    declineTop(dear);
  }
  assert.equal(zoneOf(dear.engine, dear.id("d0")), "deck", "stays in the deck");
  assert.equal(readyResources(dear.engine, P1), 3);

  const fair = cheatsBoard([character({ name: "Fair", cost: 3 }), ...cheatsDeck], { rage: 3 });
  activate(fair.engine, P1, fair.id("cheats"), "cheat");
  acceptTop(fair);
  assert.equal(zoneOf(fair.engine, fair.id("d0")), "play", "control: cost 3 with 3 resources");
  assert.equal(readyResources(fair.engine, P1), 0);
});

clause(CHEATS, "3:ability:cheat", "'play it' respects the card's threshold: refused without the icons, played with them", () => {
  const gated = () => character({ name: "Gated", cost: 2, threshold: "dd" });
  const without = cheatsBoard([gated(), ...cheatsDeck], { rage: 5 });
  activate(without.engine, P1, without.id("cheats"), "cheat");
  if (pending(without.engine)) {
    refused(() => acceptTop(without), "threshold dd with no deception");
    declineTop(without);
  }
  assert.equal(zoneOf(without.engine, without.id("d0")), "deck");
  assert.equal(readyResources(without.engine, P1), 5);

  const withIcons = cheatsBoard([gated(), ...cheatsDeck], { rage: 3, deception: 2 });
  activate(withIcons.engine, P1, withIcons.id("cheats"), "cheat");
  acceptTop(withIcons);
  assert.equal(zoneOf(withIcons.engine, withIcons.id("d0")), "play", "control: with two deception icons");
  assert.equal(readyResources(withIcons.engine, P1), 3);
});

// --- 4:ability:costume ------------------------------------------------------

const pluck = (name: string, extra: Partial<CardDefinition> = {}) => character({ name, subtype: ["pluck"], cost: 1, ...extra });

/** Cheats in play (P1) + 3 rage; P1's deck: two pluck cards, a same-named pluck card, a non-pluck; pluck decoys in hand/discard/opponent's deck. */
function costumeBoard(opts: { rage?: number; random?: () => number; cheatsOwner?: typeof P1 | typeof P2 } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: opts.random,
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: opts.cheatsOwner ?? P1, controller: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 3, P1),
      { key: "pluckA", def: pluck("Pluck Alpha"), owner: P1, zone: "deck" },
      { key: "pluckB", def: pluck("Pluck Beta"), owner: P1, zone: "deck" },
      { key: "namesake", def: pluck("Cheats McGuillicutty"), owner: P1, zone: "deck" },
      { key: "plain", def: character({ name: "Plain Joe", cost: 1 }), owner: P1, zone: "deck" },
      { key: "handPluck", def: pluck("Hand Pluck"), owner: P1, zone: "hand" },
      { key: "discardPluck", def: pluck("Discard Pluck"), owner: P1, zone: "discard" },
      { key: "theirPluck", def: pluck("Their Pluck"), owner: P2, zone: "deck" },
      ...fillers("o", 2, P2, "deck")
    ]
  });
}
type CostumeBoard = ReturnType<typeof costumeBoard>;
// The Change Costume data makes the player name the card to shuffle (see finding 2nd-edition-05-p1-4), so the driver supplies it.
const costume = (b: CostumeBoard) => activate(b.engine, P1, b.id("cheats"), "costume", { selected: { self: [b.id("cheats")] } });
const choose = (b: CostumeBoard, key?: string) =>
  answerPending(b.engine, "chooserSelectsTarget", { selected: key ? [b.id(key)] : [] });

clause(CHEATS, "4:ability:costume", "COST: Shuffle this card needs no pick: activating with nothing selected works", () => {
  const b = costumeBoard({ rage: 5 });
  activate(b.engine, P1, b.id("cheats"), "costume");
  assert.equal(zoneOf(b.engine, b.id("cheats")), "deck", "Cheats shuffled itself into the deck");
  assert.equal(readyResources(b.engine, P1), 2, "pay 3 of 5");
});

clause(CHEATS, "4:ability:costume", "COST: pays 3 and shuffles Cheats into its owner's deck before the search", () => {
  const b = costumeBoard({ rage: 5 });
  const before = deckOf(b).length;
  costume(b);
  assert.equal(readyResources(b.engine, P1), 2, "pay 3 of 5");
  assert.equal(zoneOf(b.engine, b.id("cheats")), "deck", "Cheats shuffled into the deck");
  assert.ok(deckOf(b).includes(b.id("cheats")), "deckOf(b).includes(b.id(\"cheats\"))");
  assert.equal(deckOf(b).length, before + 1);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the search follows the cost");
});

clause(CHEATS, "4:ability:costume", "COST: the shuffle really shuffles (position depends on the shuffle, not a fixed top/bottom insertion)", () => {
  const positions = [() => 0, () => 0.999].map((random) => {
    const b = costumeBoard({ random });
    costume(b);
    return deckOf(b).indexOf(b.id("cheats"));
  });
  assert.ok(positions.every((p) => p >= 0), "positions.every((p) => p >= 0)");
  assert.notEqual(positions[0], positions[1], "Cheats lands in different places under different shuffles");
});

clause(CHEATS, "4:ability:costume", "COST: refused with only 2 resources (nothing leaves play); Cheats need not be undepleted", () => {
  const short = costumeBoard({ rage: 2 });
  refused(() => costume(short), "pay 3 with 2 resources");
  assert.equal(zoneOf(short.engine, short.id("cheats")), "play");
  assert.equal(readyResources(short.engine, P1), 2);
  const exact = costumeBoard({ rage: 3 });
  exact.engine.state.cards[exact.id("cheats")].depleted = true;
  costume(exact);
  assert.equal(readyResources(exact.engine, P1), 0, "control: 3 resources suffice, even with Cheats depleted (no deplete cost)");
  assert.equal(zoneOf(exact.engine, exact.id("cheats")), "deck");
});

clause(CHEATS, "4:ability:costume", "EFFECT: search my deck for a pluck card with a different name and put it into play (either candidate)", () => {
  for (const key of ["pluckA", "pluckB"]) {
    const b = costumeBoard();
    costume(b);
    choose(b, key);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} put into play`);
    assert.equal(b.engine.state.cards[b.id(key)].controllerId, P1);
    assert.equal(zoneOf(b.engine, b.id("cheats")), "deck", "Cheats stays shuffled in");
    for (const other of ["pluckA", "pluckB"].filter((k) => k !== key)) assert.equal(zoneOf(b.engine, b.id(other)), "deck", `control: ${other} not chosen`);
  }
});

clause(CHEATS, "4:ability:costume", "EFFECT: a same-named pluck card, a non-pluck card and pluck cards outside my deck can't be picked", () => {
  const b = costumeBoard();
  costume(b);
  for (const [key, why] of [
    ["namesake", "a pluck card with the SAME name as Cheats"],
    ["plain", "a non-pluck card"],
    ["handPluck", "a pluck card in my hand"],
    ["discardPluck", "a pluck card in my discard pile"],
    ["theirPluck", "a pluck card in the opponent's deck"]
  ] as const) {
    refused(() => choose(b, key), why);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `${why}: the search is still open`);
  }
  choose(b, "pluckA");
  assert.equal(zoneOf(b.engine, b.id("pluckA")), "play", "control: a legal pick works");
  for (const key of ["namesake", "plain"]) assert.equal(zoneOf(b.engine, b.id(key)), "deck");
  for (const key of ["handPluck"]) assert.equal(zoneOf(b.engine, b.id(key)), "hand");
  assert.equal(zoneOf(b.engine, b.id("discardPluck")), "discard");
  assert.equal(zoneOf(b.engine, b.id("theirPluck")), "deck");
});

clause(CHEATS, "4:ability:costume", "EFFECT: the search may come up empty (nothing is put into play); the cost stays paid", () => {
  const b = costumeBoard();
  costume(b);
  choose(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const key of ["pluckA", "pluckB"]) assert.equal(zoneOf(b.engine, b.id(key)), "deck");
  assert.equal(zoneOf(b.engine, b.id("cheats")), "deck");
  assert.equal(readyResources(b.engine, P1), 0);
});

clause(CHEATS, "4:ability:costume", "its OWNER's deck: a Cheats I control but don't own is shuffled into its owner's deck; the search is of MY deck", () => {
  const b = costumeBoard({ cheatsOwner: P2 });
  const mine = [...deckOf(b, P1)];
  const theirs = [...deckOf(b, P2)];
  costume(b);
  assert.equal(zoneOf(b.engine, b.id("cheats")), "deck");
  assert.deepEqual(deckOf(b, P1), mine, "my deck did not get Cheats");
  assert.equal(deckOf(b, P2).length, theirs.length + 1, "the owner's deck got Cheats");
  assert.ok(deckOf(b, P2).includes(b.id("cheats")), "deckOf(b, P2).includes(b.id(\"cheats\"))");
  refused(() => choose(b, "theirPluck"), "the search is of my deck, not theirs");
  choose(b, "pluckA");
  assert.equal(zoneOf(b.engine, b.id("pluckA")), "play");
});

// ---------------------------------------------------------------------------
// Clockman Pickpocket and Cute Cutpurse (shared "cannot be blocked" rule + their damage-to-a-faction rule)
// ---------------------------------------------------------------------------

const CLOCKMAN = "e7a5575f-c91c-4ae5-afc7-3368a860ea56"; // While your opponent controls an item, this card cannot be blocked. -- If this card inflicts damage to a faction, your opponent picks an item they control if they can. If they do, take control of it and destroy this card.
const CUTPURSE = "db118e14-f80e-4895-96b6-ec2eab18e0cc"; // While your opponent controls an item, this card cannot be blocked. -- If this card inflicts damage to a faction, pick an item your opponent controls if you can. If you do, destroy it.

type ItemKey = "i1" | "i2" | "stolen";
/**
 * P1's turn: the thief + a speed-4 ally attack; P2 has a blocker, a location, and the listed items (i1 / i2 are P2's;
 * "stolen" is owned by P1 but controlled by P2). P1 also has "mine" (own item) and "lent" (owned by P2, controlled by P1).
 */
function thiefBoard(id: string, items: ItemKey[] = ["i1", "i2", "stolen"], extra: Array<{ key: string; def: CardDefinition; owner: typeof P1; zone: "hand" }> = []) {
  const itemCards = {
    i1: { key: "i1", def: item({ name: "Idol" }), owner: P2, zone: "play" as const },
    i2: { key: "i2", def: item({ name: "Statue" }), owner: P2, zone: "play" as const },
    stolen: { key: "stolen", def: item({ name: "StolenItem" }), owner: P1, controller: P2, zone: "play" as const }
  };
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "thief", def: printing(id), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, speed: 4, life: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Guard", life: 5 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Fort", structure: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "lent", def: item({ name: "LentItem" }), owner: P2, controller: P1, zone: "play" },
      ...items.map((k) => itemCards[k]),
      ...extra,
      ...fillers("p1d", 2, P1, "deck"),
      ...fillers("p2d", 2, P2, "deck")
    ]
  });
}
type ThiefBoard = ReturnType<typeof thiefBoard>;

/** An item-destroying free tactic. */
const smashTactic = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

const blockedBy = (b: ThiefBoard, ...keys: string[]) => declareBlockers(b.engine, P2, keys.map(b.id));

function unblockableWithOpponentItem(id: string) {
  const b = thiefBoard(id);
  declareAttackBy(b.engine, P1, [b.id("thief")]);
  refused(() => blockedBy(b, "blk"), "the opponent controls an item, so the thief cannot be blocked", /cannot be blocked/);
  blockedBy(b);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [], "control: declaring no blockers is fine");
}

function blockableWithoutOpponentItem(id: string) {
  // The opponent controls a location and a character, and "lent" (owned by them, controlled by me); I control "mine". No item of theirs.
  const b = thiefBoard(id, []);
  declareAttackBy(b.engine, P1, [b.id("thief")]);
  blockedBy(b, "blk");
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("blk")], "no item under their control: the thief can be blocked");
}

function stolenItemCounts(id: string) {
  // An item I own but THEY control makes the opponent "control an item".
  const b = thiefBoard(id, ["stolen"]);
  declareAttackBy(b.engine, P1, [b.id("thief")]);
  refused(() => blockedBy(b, "blk"), "they control the stolen item", /cannot be blocked/);
}

function ruleTurnsOffWhenTheItemLeaves(id: string) {
  const b = thiefBoard(id, ["i1"], [{ key: "smash", def: smashTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("i1")] } });
  assert.equal(zoneOf(b.engine, b.id("i1")), "discard", "their only item is gone");
  declareAttackBy(b.engine, P1, [b.id("thief")]);
  blockedBy(b, "blk");
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("blk")], "no item left: blockable again");
}

function mixedPartyCanBeBlocked(id: string) {
  const b = thiefBoard(id);
  declareAttackBy(b.engine, P1, [b.id("thief"), b.id("ally")]);
  blockedBy(b, "blk");
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("blk")], "CR 412.1: only a party of ONLY unblockable characters can't be blocked");
}

clause(CLOCKMAN, "0:rule", "while the opponent controls an item the Pickpocket cannot be blocked", () => unblockableWithOpponentItem(CLOCKMAN));
clause(CLOCKMAN, "0:rule", "without an item under the opponent's control it can be blocked (my items / their other cards don't count)", () => blockableWithoutOpponentItem(CLOCKMAN));
clause(CLOCKMAN, "0:rule", "an item I own but the opponent controls counts", () => stolenItemCounts(CLOCKMAN));
clause(CLOCKMAN, "0:rule", "the rule turns off when their last item leaves play", () => ruleTurnsOffWhenTheItemLeaves(CLOCKMAN));
clause(CLOCKMAN, "0:rule", "in a party with a blockable ally the party can still be blocked", () => mixedPartyCanBeBlocked(CLOCKMAN));

clause(CUTPURSE, "0:rule", "while the opponent controls an item the Cutpurse cannot be blocked", () => unblockableWithOpponentItem(CUTPURSE));
clause(CUTPURSE, "0:rule", "without an item under the opponent's control it can be blocked (my items / their other cards don't count)", () => blockableWithoutOpponentItem(CUTPURSE));
clause(CUTPURSE, "0:rule", "an item I own but the opponent controls counts", () => stolenItemCounts(CUTPURSE));
clause(CUTPURSE, "0:rule", "the rule turns off when their last item leaves play", () => ruleTurnsOffWhenTheItemLeaves(CUTPURSE));
clause(CUTPURSE, "0:rule", "in a party with a blockable ally the party can still be blocked", () => mixedPartyCanBeBlocked(CUTPURSE));

/** Attacks with `keys` and no blockers; runs the battle until it ends or a pending choice appears. */
function attackUnblocked(b: ThiefBoard, ...keys: string[]) {
  declareAttackBy(b.engine, P1, keys.map(b.id));
  blockedBy(b);
  autoResolveBattle(b.engine);
}
const pick = (b: ThiefBoard, key?: string) => answerPending(b.engine, "chooserSelectsTarget", { selected: key ? [b.id(key)] : [] });

/** P2 attacks; the thief (P1's) blocks a strength-0 raider. P2 has an item. */
function thiefBlocks(id: string) {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 3,
    activePlayerId: P2,
    cards: [
      { key: "thief", def: printing(id), owner: P1, zone: "play" },
      { key: "raider", def: character({ name: "Raider", strength: 0, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "idol", def: item({ name: "Idol" }), owner: P2, zone: "play" },
      ...fillers("p1d", 2, P1, "deck"),
      ...fillers("p2d", 2, P2, "deck")
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("raider")]);
  declareBlockers(b.engine, P1, [b.id("thief")]);
  autoResolveBattle(b.engine);
  return b;
}

// --- Clockman: "your opponent picks ... take control of it and destroy this card" ---

clause(CLOCKMAN, "1:rule", "damage to the faction: the OPPONENT picks one of their items; I take control of it and the Pickpocket is destroyed", () => {
  const b = thiefBoard(CLOCKMAN);
  const before = b.engine.state.players[P2].influence;
  attackUnblocked(b, "thief");
  assert.equal(b.engine.state.players[P2].influence, before - 1, "the Pickpocket (strength 1) damaged the faction");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the OPPONENT makes the pick");
  assert.equal(zoneOf(b.engine, b.id("thief")), "play", "not destroyed until they pick");
  pick(b, "i2");
  assert.equal(b.engine.state.pendingChoice, undefined);
  const stolen = b.engine.state.cards[b.id("i2")];
  assert.equal(stolen.zone, "play");
  assert.equal(stolen.controllerId, P1, "I took control of it");
  assert.equal(stolen.ownerId, P2, "still owned by the opponent");
  assert.equal(zoneOf(b.engine, b.id("thief")), "discard", "the Pickpocket is destroyed");
  assert.equal(b.engine.state.cards[b.id("i1")].controllerId, P2, "control: their other item is untouched");
  assert.equal(zoneOf(b.engine, b.id("i1")), "play");
  assert.equal(zoneOf(b.engine, b.id("ally")), "play", "control: the ally isn't affected");
  finishBattle(b.engine);
});

clause(CLOCKMAN, "1:rule", "the opponent can pick any item they control (including one I own but they control)", () => {
  for (const key of ["i1", "stolen"] as const) {
    const b = thiefBoard(CLOCKMAN);
    attackUnblocked(b, "thief");
    pick(b, key);
    assert.equal(b.engine.state.cards[b.id(key)].controllerId, P1, `${key} is now under my control`);
    assert.equal(zoneOf(b.engine, b.id("thief")), "discard");
    finishBattle(b.engine);
  }
});

clause(CLOCKMAN, "1:rule", "the pick is only an item the opponent controls (not a character, location, my items, or an item they own but I control); and it is mandatory", () => {
  const b = thiefBoard(CLOCKMAN);
  attackUnblocked(b, "thief");
  for (const [key, why] of [
    ["blk", "a character"],
    ["loc", "a location"],
    ["mine", "my own item"],
    ["lent", "an item they own but I control"],
    ["thief", "the Pickpocket itself"]
  ] as const) {
    refused(() => pick(b, key), why);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `${why}: the pick is still open`);
  }
  refused(() => pick(b), "they must pick an item if they can");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for the pick");
  assert.equal(zoneOf(b.engine, b.id("thief")), "play");
  pick(b, "i1");
  assert.equal(b.engine.state.cards[b.id("i1")].controllerId, P1, "control: a legal pick works");
  finishBattle(b.engine);
});

clause(CLOCKMAN, "1:rule", "if they control no item to pick, nothing happens (the Pickpocket is NOT destroyed)", () => {
  const b = thiefBoard(CLOCKMAN, []);
  const before = b.engine.state.players[P2].influence;
  attackUnblocked(b, "thief");
  finishBattle(b.engine);
  assert.equal(b.engine.state.players[P2].influence, before - 1, "it did damage the faction");
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick was offered");
  assert.equal(zoneOf(b.engine, b.id("thief")), "play", "'If they do' - they didn't, so it isn't destroyed");
  assert.equal(b.engine.state.cards[b.id("lent")].controllerId, P1);
  assert.equal(b.engine.state.cards[b.id("mine")].controllerId, P1);
});

clause(CLOCKMAN, "1:rule", "only the Pickpocket's own damage counts: an ally's damage doesn't trigger it, and it triggers once", () => {
  const b = thiefBoard(CLOCKMAN);
  const before = b.engine.state.players[P2].influence;
  attackUnblocked(b, "ally");
  finishBattle(b.engine);
  assert.equal(b.engine.state.players[P2].influence, before - 2);
  assert.equal(b.engine.state.pendingChoice, undefined, "the ally's damage doesn't trigger the Pickpocket (which is not in the battle)");
  assert.equal(zoneOf(b.engine, b.id("thief")), "play");

  const c = thiefBoard(CLOCKMAN);
  const beforeC = c.engine.state.players[P2].influence;
  attackUnblocked(c, "thief", "ally");
  assert.equal(c.engine.state.players[P2].influence, beforeC - 3, "both damaged the faction (1 + 2)");
  assert.equal(pending(c.engine)?.kind, "chooserSelectsTarget");
  pick(c, "i1");
  finishBattle(c.engine);
  assert.equal(c.engine.state.pendingChoice, undefined, "one steal only");
  assert.equal(zoneOf(c.engine, c.id("thief")), "discard");
  assert.equal(zoneOf(c.engine, c.id("ally")), "play", "the ally is not destroyed");
  assert.equal(c.engine.state.cards[c.id("i2")].controllerId, P2, "only the one picked item changed hands");
});

clause(CLOCKMAN, "1:rule", "damage to a character does not trigger it (the Pickpocket blocking an attacker)", () => {
  const b = thiefBlocks(CLOCKMAN);
  assert.equal(b.engine.state.pendingChoice, undefined, "damage to a character is not damage to a faction");
  assert.equal(b.engine.state.battle, undefined);
  assert.equal(b.engine.state.cards[b.id("raider")].damage, 1, "it did damage the raider");
  assert.equal(b.engine.state.cards[b.id("idol")].controllerId, P2, "their item is untouched");
  assert.equal(zoneOf(b.engine, b.id("thief")), "play", "the Pickpocket is not destroyed");
});

// --- Cutpurse: "pick an item your opponent controls if you can. If you do, destroy it" ---

clause(CUTPURSE, "1:rule", "damage to the faction: I (the controller) pick an item the opponent controls and it is destroyed; the Cutpurse survives", () => {
  const b = thiefBoard(CUTPURSE);
  const before = b.engine.state.players[P2].influence;
  attackUnblocked(b, "thief");
  assert.equal(b.engine.state.players[P2].influence, before - 3, "the Cutpurse (strength 3) damaged the faction");
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I make the pick");
  pick(b, "i2");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("i2")), "discard", "destroyed");
  assert.equal(zoneOf(b.engine, b.id("i1")), "play", "control: their other item stays");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "play", "control: the stolen item stays");
  assert.equal(zoneOf(b.engine, b.id("thief")), "play", "the Cutpurse is not destroyed");
  finishBattle(b.engine);
});

clause(CUTPURSE, "1:rule", "any item the opponent controls can be picked (an item I own but they control goes to MY discard pile)", () => {
  for (const key of ["i1", "stolen"] as const) {
    const b = thiefBoard(CUTPURSE);
    attackUnblocked(b, "thief");
    pick(b, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} destroyed`);
    finishBattle(b.engine);
  }
  const b = thiefBoard(CUTPURSE);
  attackUnblocked(b, "thief");
  pick(b, "stolen");
  assert.ok(b.engine.state.players[P1].discard.includes(b.id("stolen")), "an item goes to its owner's discard pile");
});

clause(CUTPURSE, "1:rule", "the pick is only an item the opponent controls (not a character, location, my items, or an item they own but I control); and it is mandatory", () => {
  const b = thiefBoard(CUTPURSE);
  attackUnblocked(b, "thief");
  for (const [key, why] of [
    ["blk", "a character"],
    ["loc", "a location"],
    ["mine", "my own item"],
    ["lent", "an item they own but I control"],
    ["thief", "the Cutpurse itself"]
  ] as const) {
    refused(() => pick(b, key), why);
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", `${why}: the pick is still open`);
  }
  refused(() => pick(b), "I must pick an item if I can");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for the pick");
  pick(b, "i1");
  assert.equal(zoneOf(b.engine, b.id("i1")), "discard", "control: a legal pick works");
  for (const key of ["blk", "loc", "mine", "lent", "thief"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} survives`);
  finishBattle(b.engine);
});

clause(CUTPURSE, "1:rule", "if the opponent controls no item to pick, nothing happens", () => {
  const b = thiefBoard(CUTPURSE, []);
  const before = b.engine.state.players[P2].influence;
  attackUnblocked(b, "thief");
  finishBattle(b.engine);
  assert.equal(b.engine.state.players[P2].influence, before - 3, "it did damage the faction");
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick was offered");
  for (const key of ["thief", "mine", "lent", "blk", "loc"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} untouched`);
});

clause(CUTPURSE, "1:rule", "only the Cutpurse's own damage counts: an ally's damage doesn't trigger it, and it triggers once", () => {
  const b = thiefBoard(CUTPURSE);
  const before = b.engine.state.players[P2].influence;
  attackUnblocked(b, "ally");
  finishBattle(b.engine);
  assert.equal(b.engine.state.players[P2].influence, before - 2);
  assert.equal(b.engine.state.pendingChoice, undefined, "the ally's damage doesn't trigger the Cutpurse (which is not in the battle)");
  for (const key of ["i1", "i2", "stolen"]) assert.equal(zoneOf(b.engine, b.id(key)), "play");

  const c = thiefBoard(CUTPURSE);
  const beforeC = c.engine.state.players[P2].influence;
  attackUnblocked(c, "thief", "ally");
  assert.equal(c.engine.state.players[P2].influence, beforeC - 5, "both damaged the faction (3 + 2)");
  assert.equal(pending(c.engine)?.kind, "chooserSelectsTarget");
  pick(c, "i1");
  finishBattle(c.engine);
  assert.equal(c.engine.state.pendingChoice, undefined, "one destroy only");
  assert.equal(zoneOf(c.engine, c.id("i1")), "discard");
  assert.equal(zoneOf(c.engine, c.id("i2")), "play", "only one item was destroyed");
  assert.equal(zoneOf(c.engine, c.id("stolen")), "play");
});

clause(CUTPURSE, "1:rule", "damage to a character does not trigger it (the Cutpurse blocking an attacker)", () => {
  const b = thiefBlocks(CUTPURSE);
  assert.equal(b.engine.state.pendingChoice, undefined, "damage to a character is not damage to a faction");
  assert.equal(b.engine.state.battle, undefined);
  assert.equal(b.engine.state.cards[b.id("raider")].damage, 3, "it did damage the raider");
  assert.equal(zoneOf(b.engine, b.id("idol")), "play", "their item is untouched");
});

// ---------------------------------------------------------------------------
// Early Retirement
// ---------------------------------------------------------------------------

const EARLY_RETIREMENT = "a35a5b39-8cb9-4171-a8ab-2f2ab1fdc818"; // COST: Pick a character you control. X is its strength. Destroy it. -- EFFECT: Draw X cards.

/** P1's turn, cost 5 / threshold dd: 2 deception + 3 rage by default. */
function retireBoard(opts: { deception?: number; rage?: number; characters?: boolean } = {}) {
  const buffed = character({
    name: "Buffed",
    strength: 2,
    behavior: { abilities: [{ id: "self-buff", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "er", def: printing(EARLY_RETIREMENT), owner: P1, zone: "hand" },
      ...(opts.characters === false
        ? []
        : [
            { key: "c0", def: character({ name: "Zero", strength: 0 }), owner: P1, zone: "play" as const },
            { key: "c1", def: character({ name: "One", strength: 1 }), owner: P1, zone: "play" as const },
            { key: "c3", def: character({ name: "Three", strength: 3 }), owner: P1, zone: "play" as const },
            { key: "c4", def: buffed, owner: P1, zone: "play" as const },
            { key: "borrowed", def: character({ name: "Borrowed", strength: 2 }), owner: P2, controller: P1, zone: "play" as const }
          ]),
      { key: "foe", def: character({ name: "Foe", strength: 2 }), owner: P2, zone: "play" },
      { key: "lentOut", def: character({ name: "LentOut", strength: 2 }), owner: P1, controller: P2, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" },
      ...bank("deception", opts.deception ?? 2, P1),
      ...bank("rage", opts.rage ?? 3, P1),
      ...fillers("p1d", 6, P1, "deck"),
      ...fillers("p2d", 6, P2, "deck")
    ]
  });
}
type RetireBoard = ReturnType<typeof retireBoard>;
const retire = (b: RetireBoard, target: string) => play(b.engine, P1, b.id("er"), { selected: { pick: [b.id(target)] } });
const handOf = (b: RetireBoard, p = P1) => b.engine.state.players[p].hand;

clause(EARLY_RETIREMENT, "0:ability", "COST+EFFECT: destroys the picked character and draws X = its strength (3) cards; the cost 5 is paid", () => {
  const b = retireBoard();
  const top = b.engine.state.players[P1].deck.slice(0, 3);
  const theirHand = [...handOf(b, P2)];
  const theirDeck = [...b.engine.state.players[P2].deck];
  assert.equal(handOf(b).length, 1, "only the tactic in hand");
  retire(b, "c3");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c3")), "discard", "destroyed");
  assert.deepEqual(handOf(b), top, "drew exactly the top 3 cards, in order");
  assert.equal(b.engine.state.players[P1].deck.length, 3, "6 - 3 left in the deck");
  assert.equal(zoneOf(b.engine, b.id("er")), "discard", "the tactic was played");
  assert.equal(readyResources(b.engine, P1), 0, "cost 5 paid");
  for (const key of ["c0", "c1", "c4", "borrowed", "foe"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `control: ${key} not destroyed`);
  assert.deepEqual(handOf(b, P2), theirHand, "the opponent drew nothing");
  assert.deepEqual(b.engine.state.players[P2].deck, theirDeck);
});

clause(EARLY_RETIREMENT, "0:ability", "X is the picked character's strength: 1 draws 1, a buffed 2+2 draws 4, 0 draws 0", () => {
  for (const [key, x] of [["c1", 1], ["c4", 4], ["c0", 0]] as const) {
    const b = retireBoard();
    assert.equal(b.engine.getStat(b.id(key), "strength"), x, `${key} currently has strength ${x}`);
    const top = b.engine.state.players[P1].deck.slice(0, x);
    retire(b, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard");
    assert.deepEqual(handOf(b), top, `X=${x}: drew ${x} card(s)`);
    assert.equal(b.engine.state.players[P1].deck.length, 6 - x);
  }
});

clause(EARLY_RETIREMENT, "0:ability", "Pick: a character I control (including one I don't own); not an opponent's character, a character I own but don't control, or an item", () => {
  const b = retireBoard();
  for (const [key, why] of [
    ["foe", "an opponent's character"],
    ["lentOut", "a character I own but the opponent controls"],
    ["gadget", "an item"]
  ] as const) {
    refused(() => retire(b, key), why);
    assert.equal(zoneOf(b.engine, b.id("er")), "hand", `${why}: not played`);
    assert.equal(zoneOf(b.engine, b.id(key)), "play", `${why}: not destroyed`);
  }
  assert.equal(readyResources(b.engine, P1), 5, "nothing paid for the refused picks");
  assert.equal(handOf(b).length, 1);
  retire(b, "borrowed");
  assert.equal(zoneOf(b.engine, b.id("borrowed")), "discard", "control: a character I control but don't own is a legal pick");
  assert.equal(handOf(b).length, 2, "and X is its strength 2 (the tactic left the hand, 2 cards were drawn)");
});

clause(EARLY_RETIREMENT, "0:ability", "Refused with no character I control, with 4 resources, and without the dd threshold", () => {
  const none = retireBoard({ characters: false });
  refused(() => retire(none, "foe"), "only the opponent's characters to pick");
  assert.equal(zoneOf(none.engine, none.id("er")), "hand");

  const short = retireBoard({ deception: 2, rage: 2 });
  refused(() => retire(short, "c3"), "4 resources");
  assert.equal(zoneOf(short.engine, short.id("c3")), "play");
  assert.equal(zoneOf(short.engine, short.id("er")), "hand");

  const oneIcon = retireBoard({ deception: 1, rage: 4 });
  refused(() => retire(oneIcon, "c3"), "5 resources but only one deception icon for dd");
  assert.equal(zoneOf(oneIcon.engine, oneIcon.id("c3")), "play");
  assert.equal(readyResources(oneIcon.engine, P1), 5);

  const ok = retireBoard({ deception: 2, rage: 3 });
  retire(ok, "c3");
  assert.equal(zoneOf(ok.engine, ok.id("c3")), "discard", "control: 5 resources with dd works");
});

clause(EARLY_RETIREMENT, "0:ability", "COST: the pick is destroyed as a cost, so it is already gone while the tactic waits for responses", () => {
  const b = retireBoard();
  const top = b.engine.state.players[P1].deck.slice(0, 3);
  playRaw(b.engine, P1, b.id("er"), { selected: { pick: [b.id("c3")] } });
  assert.ok(b.engine.state.responseWindow, "the tactic is waiting for responses");
  assert.equal(zoneOf(b.engine, b.id("c3")), "discard", "COST: the character is destroyed when the tactic is played");
  assert.deepEqual(handOf(b), [], "EFFECT: nothing is drawn until the tactic resolves");
  assert.equal(readyResources(b.engine, P1), 0, "the numeric cost is paid at the same time");
  while (b.engine.state.responseWindow) {
    const w = b.engine.state.responseWindow;
    b.engine.perform(w.phase === "acceptingResponses" ? { type: "passPriority", playerId: w.priorityPlayerId } : { type: "advanceFlow" });
  }
  assert.deepEqual(handOf(b), top, "then it draws X = 3");
});

clause(EARLY_RETIREMENT, "0:ability", "COST: an opponent's response can't target the already-destroyed character", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "er", def: printing(EARLY_RETIREMENT), owner: P1, zone: "hand" },
      { key: "c3", def: character({ name: "Three", strength: 3 }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      ...bank("deception", 2, P1),
      ...bank("rage", 3, P1),
      ...fillers("p1d", 6, P1, "deck"),
      ...fillers("p2d", 3, P2, "deck")
    ]
  });
  playRaw(b.engine, P1, b.id("er"), { selected: { pick: [b.id("c3")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "P2 may respond");
  refused(
    () => b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("c3")] }, variables: {} } as never),
    "the character was destroyed as a cost, so it is not in play to be targeted"
  );
});

// ---------------------------------------------------------------------------
// Face in the Crowd
// ---------------------------------------------------------------------------

const FACE_IN_THE_CROWD = "10b2d3fb-c61b-4c10-99ed-7d81de0c6b7e"; // While your opponent controls at least 4 characters, this card cannot be blocked.

/** P1's turn: Face in the Crowd + an ally + 6 more of mine; P2 controls `foes` characters (f0..), plus optional extras. */
function crowdBoard(foes: number, extra: Array<{ key: string; def: CardDefinition; owner: typeof P1; controller?: typeof P1; zone: "play" | "hand"; faceDown?: boolean }> = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "face", def: printing(FACE_IN_THE_CROWD), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `m${i}`, def: character({ name: `Mine${i}` }), owner: P1, zone: "play" as const })),
      ...Array.from({ length: foes }, (_, i) => ({ key: `f${i}`, def: character({ name: `Foe${i}` }), owner: P2, zone: "play" as const })),
      ...extra,
      ...fillers("p1d", 2, P1, "deck"),
      ...fillers("p2d", 2, P2, "deck")
    ]
  });
}
type CrowdBoard = ReturnType<typeof crowdBoard>;
const crowdAttack = (b: CrowdBoard, ...keys: string[]) => declareAttackBy(b.engine, P1, (keys.length ? keys : ["face"]).map(b.id));
const crowdBlock = (b: CrowdBoard, ...keys: string[]) => declareBlockers(b.engine, P2, keys.map(b.id));

clause(FACE_IN_THE_CROWD, "0:rule", "with 4 characters on the opponent's side it cannot be blocked (boundary: exactly 4), nor with 5", () => {
  for (const foes of [4, 5]) {
    const b = crowdBoard(foes);
    crowdAttack(b);
    refused(() => crowdBlock(b, "f0"), `${foes} opposing characters`, /cannot be blocked/);
    crowdBlock(b);
    assert.deepEqual(b.engine.state.battle?.blockingParty, [], "control: declaring no blockers is fine");
  }
});

clause(FACE_IN_THE_CROWD, "0:rule", "with only 3 (or fewer) opposing characters it can be blocked", () => {
  for (const foes of [3, 1]) {
    const b = crowdBoard(foes);
    crowdAttack(b);
    crowdBlock(b, "f0");
    assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("f0")], `${foes} opposing characters: blockable`);
  }
});

clause(FACE_IN_THE_CROWD, "0:rule", "only the opponent's CHARACTERS they CONTROL count (not my characters, their items/locations/face-down resources/hand; one I own but they control counts)", () => {
  // 3 real foes + lots that must not count => still blockable
  const near = crowdBoard(3, [
    { key: "gadget", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
    { key: "fort", def: location({ name: "Fort", structure: 3 }), owner: P2, zone: "play" },
    { key: "vol", def: character({ name: "HiddenResource" }), owner: P2, zone: "play", faceDown: true },
    { key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" }
  ]);
  crowdAttack(near);
  crowdBlock(near, "f0");
  assert.deepEqual(near.engine.state.battle?.blockingParty, [near.id("f0")], "6 of my characters, an item, a location, a face-down card, a borrowed character, a hand card: still only 3");

  // 3 real foes + one owned by me but controlled by them = 4 => unblockable
  const lent = crowdBoard(3, [{ key: "lentOut", def: character({ name: "LentOut" }), owner: P1, controller: P2, zone: "play" }]);
  crowdAttack(lent);
  refused(() => crowdBlock(lent, "f0"), "they control 4 characters (one is mine)", /cannot be blocked/);
});

clause(FACE_IN_THE_CROWD, "0:rule", "the rule turns off when the count drops below 4", () => {
  const b = crowdBoard(4, [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("f3")] } });
  assert.equal(zoneOf(b.engine, b.id("f3")), "discard");
  crowdAttack(b);
  crowdBlock(b, "f0");
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("f0")], "down to 3 characters: blockable");
});

clause(FACE_IN_THE_CROWD, "0:rule", "the rule turns on when a 4th opposing character arrives", () => {
  const summon = tactic({
    name: "Summon",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "opponent", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "opponent" }]
        }
      ]
    }
  });
  const b = crowdBoard(3, [
    { key: "summon", def: summon, owner: P1, zone: "hand" },
    { key: "late", def: character({ name: "LateFoe" }), owner: P2, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("summon"), { selected: { t: [b.id("late")] } });
  assert.equal(zoneOf(b.engine, b.id("late")), "play");
  assert.equal(b.engine.state.cards[b.id("late")].controllerId, P2, "the opponent now controls 4 characters");
  crowdAttack(b);
  refused(() => crowdBlock(b, "f0"), "4 characters again", /cannot be blocked/);
});

clause(FACE_IN_THE_CROWD, "0:rule", "in a party with a blockable ally the party can still be blocked", () => {
  const b = crowdBoard(4);
  crowdAttack(b, "face", "ally");
  crowdBlock(b, "f0");
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("f0")], "CR 412.1: only a party of ONLY unblockable characters can't be blocked");
});
