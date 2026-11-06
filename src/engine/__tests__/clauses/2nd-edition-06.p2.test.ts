// Clause tests, batch 2nd-edition-06 part p2 (groups 16-26, clauses not yet covered).
// Expected behavior comes from the PRINTED text (see docs/TESTING.md).
import assert from "node:assert/strict";
import { buildGame, bank, character, developFaction, item, location, play, resolvePendingResponses, tactic, P1, P2 } from "../per-card/_harness.js";
import { clause, printing, refused } from "./_clause.js";
import { answerPending, declareBlockers, pending, readyResources } from "./_board.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fight, finishBattle, playRaw } from "./_battle.js";
import { endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].damage;

/** Answers the open `chooserSelectsTarget` pick with `selected` (and drains response windows afterwards). */
function pick(engine: SpoilsEngine, player: PlayerId, selected: CardInstanceId[]): void {
  const pc = pending(engine);
  assert.ok(pc, "a pick is pending");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, player, "the card's controller makes the pick");
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  // drain any response window left open by the trigger
  let guard = 0;
  while (engine.state.responseWindow && !engine.state.pendingChoice && guard++ < 50) {
    const window = engine.state.responseWindow;
    engine.perform(window.phase === "acceptingResponses" ? { type: "passPriority", playerId: window.priorityPlayerId } : { type: "advanceFlow" });
  }
}

// =====================================================================================
// Dragon Tank
// =====================================================================================
const DRAGON_TANK = "3e949563-8af2-40f0-8dde-212932256134"; // warlord character, dragon, cost 12 · str 10 / spd 4 / life 10 -- At the start of your turn, you may pick a character your opponent controls. If you do, destroy it. Otherwise, destroy this card.

/** P2's turn is ending, so P1's turn (P1 controls the Tank) is about to start. */
function tankBoard(opts: { opponentChars?: boolean; tankController?: PlayerId; active?: PlayerId } = {}) {
  const controller = opts.tankController ?? P1;
  const mine = controller;
  const theirs = controller === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? (controller === P1 ? P2 : P1),
    cards: [
      { key: "tank", def: printing(DRAGON_TANK), owner: controller, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: mine, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: mine, zone: "play" },
      ...(opts.opponentChars === false
        ? []
        : [
            { key: "victim", def: character({ name: "Victim", life: 3 }), owner: theirs, zone: "play" as const },
            { key: "victim2", def: character({ name: "Victim2", life: 3 }), owner: theirs, zone: "play" as const },
            { key: "theirDragon", def: character({ name: "TheirDragon", subtype: ["dragon"] }), owner: theirs, zone: "play" as const },
            // owned by the Tank's controller but controlled by the opponent: "a character your opponent controls"
            { key: "lentOut", def: character({ name: "LentOut", life: 3 }), owner: mine, zone: "play" as const, controller: theirs },
            // owned by the opponent but controlled by the Tank's controller: not a character the opponent controls
            { key: "stolen", def: character({ name: "Stolen", life: 3 }), owner: theirs, zone: "play" as const, controller: mine }
          ]),
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: theirs, zone: "play" },
      { key: "theirHand", def: character({ name: "TheirHand" }), owner: theirs, zone: "hand" },
      { key: "theirDeck", def: character({ name: "TheirDeck" }), owner: theirs, zone: "deck" },
      { key: "mineDeck", def: character({ name: "MineDeck" }), owner: mine, zone: "deck" }
    ]
  });
}

clause(DRAGON_TANK, "0:rule", "at the start of your turn you may pick a character your opponent controls; if you do, destroy it (and the Tank survives)", () => {
  const { engine, id } = tankBoard();
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "P1's turn started");
  const pc = pending(engine);
  assert.ok(pc, "the Tank asks for a pick");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "its controller picks");
  pick(engine, P1, [id("victim")]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("victim")), "discard", "the picked opposing character is destroyed");
  assert.equal(zoneOf(engine, id("tank")), "play", "the Tank survives when a pick was made");
  for (const k of ["mine", "victim2", "theirDragon", "myItem", "theirItem"]) assert.equal(zoneOf(engine, id(k)), "play", `${k} is untouched`);
});

clause(DRAGON_TANK, "0:rule", "the pick can be any opposing character (a different one each time, dragons included)", () => {
  for (const key of ["victim", "victim2", "theirDragon", "lentOut"]) {
    const { engine, id } = tankBoard();
    endTurn(engine, P2);
    pick(engine, P1, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "discard", `${key} can be picked and is destroyed`);
    assert.equal(zoneOf(engine, id("tank")), "play");
    const others = ["victim", "victim2", "theirDragon", "lentOut", "stolen", "mine"].filter((k) => k !== key);
    for (const k of others) assert.equal(zoneOf(engine, id(k)), "play", `only the picked character (${key}) is destroyed, not ${k}`);
  }
});

clause(DRAGON_TANK, "0:rule", "the pick is restricted to characters your opponent controls: own characters, the Tank itself, items and out-of-play cards are refused", () => {
  const { engine, id } = tankBoard();
  endTurn(engine, P2);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "control: the pick is open");
  for (const [key, why] of [
    ["mine", "my own character"],
    ["tank", "the Tank itself"],
    ["myItem", "my item"],
    ["theirItem", "an opposing item"],
    ["theirHand", "an opposing character in hand"],
    ["theirDeck", "an opposing character in the deck"],
    ["mineDeck", "my character in the deck"],
    ["stolen", "a character the opponent owns but I control"]
  ] as const) {
    refused(() => pick(engine, P1, [id(key)]), `${why} is not a legal pick`, /Illegal target/);
    assert.ok(pending(engine), `${why}: the pick is still pending`);
  }
  refused(() => pick(engine, P1, [id("victim"), id("victim2")]), "only ONE character may be picked", /selection/);
  pick(engine, P1, [id("victim")]);
  assert.equal(zoneOf(engine, id("victim")), "discard", "control: a legal pick works");
});

clause(DRAGON_TANK, "0:rule", "if you decline to pick, the Tank itself is destroyed and no opposing character is", () => {
  const { engine, id } = tankBoard();
  endTurn(engine, P2);
  pick(engine, P1, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("tank")), "discard", "Otherwise: destroy this card");
  for (const k of ["mine", "victim", "victim2", "theirDragon"]) assert.equal(zoneOf(engine, id(k)), "play", `${k} is untouched`);
});

clause(DRAGON_TANK, "0:rule", "with no opposing character to pick, the pick can't be made, so the Tank is destroyed (Otherwise)", () => {
  const { engine, id } = tankBoard({ opponentChars: false });
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  // The opponent controls no character: nothing can be picked ("If you do" is false) -> Otherwise, destroy this card.
  if (pending(engine)) pick(engine, P1, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("tank")), "discard", "no pick could be made, so the Tank is destroyed");
  assert.equal(zoneOf(engine, id("mine")), "play", "my own character is not touched");
});

clause(DRAGON_TANK, "0:rule", "does NOT trigger at the start of the opponent's turn", () => {
  const { engine, id } = tankBoard({ active: P1 });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "P2's turn started");
  assert.equal(engine.state.pendingChoice, undefined, "the Tank (P1's) does nothing on P2's turn");
  assert.equal(zoneOf(engine, id("tank")), "play");
  for (const k of ["mine", "victim", "victim2", "theirDragon"]) assert.equal(zoneOf(engine, id(k)), "play");
});

clause(DRAGON_TANK, "0:rule", "'your turn' and 'your opponent' follow the controller: a Tank controlled by P2 asks P2 to pick among P1's characters on P2's turn", () => {
  const { engine, id } = tankBoard({ tankController: P2, active: P1 });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2, "the controlling player picks");
  refused(() => pick(engine, P2, [id("mine")]), "P2's own character is not pickable", /Illegal target/);
  pick(engine, P2, [id("victim")]);
  assert.equal(zoneOf(engine, id("victim")), "discard", "an opposing (P1) character was destroyed");
  assert.equal(zoneOf(engine, id("tank")), "play");
});

clause(DRAGON_TANK, "0:rule", "vanilla stats of the printing: dragon warlord character cost 12 · str 10 / spd 4 / life 10", () => {
  const def = printing(DRAGON_TANK);
  assert.deepEqual([def.cost, def.strength, def.speed, def.life, def.threshold, def.subtype], [12, 10, 4, 10, "rrrrr", ["dragon"]]);
});

// =====================================================================================
// Dragon's Quarters
// =====================================================================================
const QUARTERS = "34f23377-a197-40f0-984d-031c8e439b45"; // warlord location, cost 2, structure 4 -- At the start of your turn, you may pick a character. If you do, this card inflicts X+1 damage to it, where X is the number of dragon cards you control.

const dragon = (name: string, life = 20): CardDefinition => character({ name, subtype: ["dragon"], life });

function quartersBoard(opts: { cards?: CardPlacement[]; active?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "quarters", def: printing(QUARTERS), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 20 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", life: 20 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "theirHand", def: character({ name: "TheirHand", life: 20 }), owner: P2, zone: "hand" },
      { key: "mineDeck", def: character({ name: "MineDeck", life: 20 }), owner: P1, zone: "deck" },
      ...(opts.cards ?? [])
    ]
  });
}

clause(QUARTERS, "0:rule", "with no dragons you control, the picked character takes X+1 = 1 damage", () => {
  const { engine, id } = quartersBoard();
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine)?.playerId, P1, "its controller picks");
  pick(engine, P1, [id("theirs")]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(damageOn(engine, id("theirs")), 1, "X = 0, so 0 + 1 = 1 damage");
  assert.equal(damageOn(engine, id("mine")), 0, "the other character is not damaged");
});

clause(QUARTERS, "0:rule", "X counts the dragon cards you control: with 2 dragons the pick takes 3, with 3 dragons it takes 4", () => {
  for (const n of [1, 2, 3]) {
    const { engine, id } = quartersBoard({ cards: Array.from({ length: n }, (_, i) => ({ key: `dr${i}`, def: dragon(`Dr${i}`), owner: P1, zone: "play" as const })) });
    endTurn(engine, P2);
    pick(engine, P1, [id("theirs")]);
    assert.equal(damageOn(engine, id("theirs")), n + 1, `${n} dragon(s) -> X+1 = ${n + 1} damage`);
    for (let i = 0; i < n; i++) assert.equal(damageOn(engine, id(`dr${i}`)), 0, "the dragons themselves are not damaged");
  }
});

clause(QUARTERS, "0:rule", "X counts only dragon cards you control: opponent's dragons, dragons in hand/deck/discard and non-dragons don't count", () => {
  const { engine, id } = quartersBoard({
    cards: [
      { key: "dr", def: dragon("Dr"), owner: P1, zone: "play" },
      { key: "theirDragon", def: dragon("TheirDragon"), owner: P2, zone: "play" },
      { key: "handDragon", def: dragon("HandDragon"), owner: P1, zone: "hand" },
      { key: "deckDragon", def: dragon("DeckDragon"), owner: P1, zone: "deck" },
      { key: "discardDragon", def: dragon("DiscardDragon"), owner: P1, zone: "discard" },
      { key: "fighter", def: character({ name: "Fighter", subtype: ["fighter"], life: 20 }), owner: P1, zone: "play" }
    ]
  });
  endTurn(engine, P2);
  pick(engine, P1, [id("theirs")]);
  assert.equal(damageOn(engine, id("theirs")), 2, "only the one in-play, face-up dragon I control counts: X = 1, damage 2");
});

clause(QUARTERS, "0:rule", "a face-down card is a resource, not a dragon: it does not count toward X", () => {
  const { engine, id } = quartersBoard({
    cards: [
      { key: "dr", def: dragon("Dr"), owner: P1, zone: "play" },
      { key: "faceDownDragon", def: dragon("FaceDownDragon"), owner: P1, zone: "play", faceDown: true }
    ]
  });
  endTurn(engine, P2);
  pick(engine, P1, [id("theirs")]);
  assert.equal(damageOn(engine, id("theirs")), 2, "only the face-up dragon counts: X = 1 -> 2 damage (the face-down card has no subtype)");
});

clause(QUARTERS, "0:rule", "'dragon cards you control' is by controller, not owner: a dragon I own but the opponent controls doesn't count; one I control but they own does", () => {
  const { engine, id } = quartersBoard({
    cards: [
      { key: "lentOut", def: dragon("LentOut"), owner: P1, zone: "play", controller: P2 },
      { key: "stolen", def: dragon("Stolen"), owner: P2, zone: "play", controller: P1 },
      { key: "stolen2", def: dragon("Stolen2"), owner: P2, zone: "play", controller: P1 }
    ]
  });
  endTurn(engine, P2);
  pick(engine, P1, [id("theirs")]);
  assert.equal(damageOn(engine, id("theirs")), 3, "two dragons I control (X = 2) -> 3 damage");
});

clause(QUARTERS, "0:rule", "'dragon cards' are not limited to characters: a dragon item I control counts", () => {
  const { engine, id } = quartersBoard({ cards: [{ key: "dragonItem", def: item({ name: "DragonIdol", subtype: ["dragon"] }), owner: P1, zone: "play" }] });
  endTurn(engine, P2);
  pick(engine, P1, [id("theirs")]);
  assert.equal(damageOn(engine, id("theirs")), 2, "a dragon item counts: X = 1 -> 2 damage");
});

clause(QUARTERS, "0:rule", "any character may be picked, yours or the opponent's, a dragon included (which then counts in X); items, locations, and out-of-play cards are refused", () => {
  for (const [key, expected] of [
    ["mine", 2],
    ["theirs", 2],
    ["dr", 2]
  ] as const) {
    const { engine, id } = quartersBoard({ cards: [{ key: "dr", def: dragon("Dr"), owner: P1, zone: "play" }] });
    endTurn(engine, P2);
    pick(engine, P1, [id(key)]);
    assert.equal(damageOn(engine, id(key)), expected, `${key} can be picked and takes X+1 = 2 damage`);
  }
  const { engine, id } = quartersBoard();
  endTurn(engine, P2);
  for (const [key, why] of [
    ["quarters", "the Quarters itself (a location)"],
    ["myItem", "an item"],
    ["theirHand", "a character in hand"],
    ["mineDeck", "a character in the deck"]
  ] as const) {
    refused(() => pick(engine, P1, [id(key)]), `${why} is not a legal pick`, /Illegal target/);
  }
  refused(() => pick(engine, P1, [id("mine"), id("theirs")]), "only one character may be picked", /selection/);
  pick(engine, P1, [id("mine")]);
  assert.equal(damageOn(engine, id("mine")), 1, "control: a legal pick works");
});

clause(QUARTERS, "0:rule", "'you may': declining the pick deals no damage to anything", () => {
  const { engine, id } = quartersBoard({ cards: [{ key: "dr", def: dragon("Dr"), owner: P1, zone: "play" }] });
  endTurn(engine, P2);
  pick(engine, P1, []);
  assert.equal(engine.state.pendingChoice, undefined);
  for (const k of ["mine", "theirs", "dr"]) assert.equal(damageOn(engine, id(k)), 0, `${k} takes no damage`);
  assert.equal(zoneOf(engine, id("quarters")), "play");
});

clause(QUARTERS, "0:rule", "damage can destroy: X+1 damage on a character with that much life destroys it", () => {
  const { engine, id } = quartersBoard({
    cards: [
      { key: "dr0", def: dragon("Dr0"), owner: P1, zone: "play" },
      { key: "dr1", def: dragon("Dr1"), owner: P1, zone: "play" },
      { key: "frail", def: character({ name: "Frail", life: 3 }), owner: P2, zone: "play" },
      { key: "sturdy", def: character({ name: "Sturdy", life: 4 }), owner: P2, zone: "play" }
    ]
  });
  endTurn(engine, P2);
  pick(engine, P1, [id("frail")]);
  assert.equal(zoneOf(engine, id("frail")), "discard", "3 damage (X = 2) kills a 3-life character");
  assert.equal(zoneOf(engine, id("sturdy")), "play");
});

clause(QUARTERS, "0:rule", "does NOT trigger at the start of the opponent's turn", () => {
  const { engine, id } = quartersBoard({ active: P1 });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined, "no pick is offered on the opponent's turn");
  assert.equal(damageOn(engine, id("theirs")), 0);
  assert.equal(damageOn(engine, id("mine")), 0);
});

clause(QUARTERS, "0:rule", "it triggers every one of my turns (the next turn start asks for a pick again)", () => {
  const { engine, id } = quartersBoard();
  endTurn(engine, P2);
  pick(engine, P1, [id("theirs")]);
  assert.equal(damageOn(engine, id("theirs")), 1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined, "nothing on the opponent's turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(damageOn(engine, id("theirs")), 0, "damage from the earlier turn wore off");
  assert.ok(pending(engine), "the pick is offered again");
  pick(engine, P1, [id("mine")]);
  assert.equal(damageOn(engine, id("mine")), 1, "a fresh X+1 = 1 damage on the second pick");
});

clause(QUARTERS, "0:rule", "a location leaves no trigger behind: once it has left play it no longer asks for a pick", () => {
  const { engine } = quartersBoard();
  // Control: it is in play and asks.
  endTurn(engine, P2);
  assert.ok(pending(engine), "control: with the Quarters in play the pick is offered");
  const gone = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "quarters", def: printing(QUARTERS), owner: P1, zone: "discard" },
      { key: "theirs", def: character({ name: "Theirs", life: 20 }), owner: P2, zone: "play" }
    ]
  });
  endTurn(gone.engine, P2);
  assert.equal(gone.engine.state.pendingChoice, undefined, "a Quarters in the discard pile does nothing");
  assert.equal(damageOn(gone.engine, gone.id("theirs")), 0);
});

clause(QUARTERS, "0:rule", "printed stats: warlord location, cost 2, structure 4", () => {
  const def = printing(QUARTERS);
  assert.deepEqual([def.type, def.cost, def.structure, def.threshold], ["location", 2, 4, "rrr"]);
});

// =====================================================================================
// Explosive Fury
// =====================================================================================
const EXPLOSIVE_FURY = "257d1460-056e-49cc-90f1-902fa5214312"; // warlord tactic, cost 2, threshold r -- COST: Pick a character you control. X is its strength. Destroy it. Pick another character. -- EFFECT: Inflict X damage to the character.

/** A free tactic that adds `amount` strength to one picked character until end of turn (id `pump`, declaration `t`). */
function pumpTactic(amount: number): CardDefinition {
  return tactic({
    name: `Pump${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pump",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
}

function furyBoard(opts: { resources?: number; icon?: "rage" | "greed"; sacStrength?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ef", def: printing(EXPLOSIVE_FURY), owner: P1, zone: "hand" },
      ...bank(opts.icon ?? "rage", opts.resources ?? 2, P1),
      { key: "sac", def: character({ name: "Sac", strength: opts.sacStrength ?? 3, life: 5 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "foeHand", def: character({ name: "FoeHand", life: 9 }), owner: P2, zone: "hand" },
      { key: "foeDeck", def: character({ name: "FoeDeck", life: 9 }), owner: P2, zone: "deck" },
      ...(opts.extra ?? [])
    ]
  });
}

clause(EXPLOSIVE_FURY, "0:ability", "destroys the character you control, then inflicts X (its strength) damage to the other picked character", () => {
  const { engine, id } = furyBoard();
  play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id("foe")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("sac")), "discard", "COST: the character I controlled is destroyed");
  assert.equal(damageOn(engine, id("foe")), 3, "X = the destroyed character's strength (3)");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(zoneOf(engine, id("ef")), "discard", "the tactic is spent");
  for (const k of ["ally", "foe2"]) assert.equal(damageOn(engine, id(k)), 0, `${k} is not damaged`);
  assert.equal(readyResources(engine, P1), 0, "the 2 resources were paid");
});

clause(EXPLOSIVE_FURY, "0:ability", "X is the picked character's strength: different strengths give different damage (1, 5, and a damage-killing 9)", () => {
  for (const strength of [1, 5, 9]) {
    const { engine, id } = furyBoard({ sacStrength: strength });
    play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id("foe")] } });
    if (strength < 9) assert.equal(damageOn(engine, id("foe")), strength, `X = ${strength}`);
    else assert.equal(zoneOf(engine, id("foe")), "discard", "9 damage destroys a 9-life character");
    assert.equal(zoneOf(engine, id("sac")), "discard");
  }
});

clause(EXPLOSIVE_FURY, "0:ability", "X is the picked character's CURRENT strength (a +2 pump counts)", () => {
  const { engine, id } = furyBoard({ extra: [{ key: "pump", def: pumpTactic(2), owner: P1, zone: "hand" }] });
  play(engine, P1, id("pump"), { selected: { t: [id("sac")] } });
  assert.equal(engine.getStat(id("sac"), "strength"), 5, "control: the pump made Sac 5 strength");
  play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id("foe")] } });
  assert.equal(damageOn(engine, id("foe")), 5, "X = 5 (3 printed + 2)");
});

clause(EXPLOSIVE_FURY, "0:ability", "the victim can be any OTHER character: one I control, or an opposing one", () => {
  for (const key of ["ally", "foe", "foe2"]) {
    const { engine, id } = furyBoard();
    play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id(key)] } });
    assert.equal(damageOn(engine, id(key)), 3, `${key} takes X = 3`);
    for (const other of ["ally", "foe", "foe2"].filter((k) => k !== key)) assert.equal(damageOn(engine, id(other)), 0, `only the picked character takes damage, not ${other}`);
  }
});

clause(EXPLOSIVE_FURY, "0:ability", "'Pick another character': the character picked for the cost can't also be the damaged character", () => {
  const { engine, id } = furyBoard();
  refused(() => play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id("sac")] } }), "the same character can't be both picks");
  assert.equal(zoneOf(engine, id("ef")), "hand", "the tactic was not played");
  assert.equal(zoneOf(engine, id("sac")), "play");
  play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id("foe")] } });
  assert.equal(zoneOf(engine, id("sac")), "discard", "control: two different characters is fine");
});

clause(EXPLOSIVE_FURY, "0:ability", "the first pick must be a character I control: opposing characters, items and out-of-play cards are refused", () => {
  const { engine, id } = furyBoard();
  for (const [key, why] of [
    ["foe", "an opposing character"],
    ["myItem", "my item"],
    ["foeHand", "a character in the opponent's hand"]
  ] as const) {
    refused(() => play(engine, P1, id("ef"), { selected: { sac: [id(key)], victim: [id("foe2")] } }), `${why} can't be the destroyed character`);
  }
  assert.equal(zoneOf(engine, id("ef")), "hand");
  assert.equal(readyResources(engine, P1), 2, "nothing was paid by the refused attempts");
  play(engine, P1, id("ef"), { selected: { sac: [id("ally")], victim: [id("foe2")] } });
  assert.equal(zoneOf(engine, id("ally")), "discard", "control: another character I control works as the sacrifice");
  assert.equal(damageOn(engine, id("foe2")), 1, "X = Ally's strength (1)");
});

clause(EXPLOSIVE_FURY, "0:ability", "'a character you control' is by controller: one I own but the opponent controls is refused, one I control but they own can be destroyed", () => {
  const extra: CardPlacement[] = [
    { key: "lentOut", def: character({ name: "LentOut", strength: 4, life: 5 }), owner: P1, zone: "play", controller: P2 },
    { key: "stolen", def: character({ name: "Stolen", strength: 4, life: 5 }), owner: P2, zone: "play", controller: P1 }
  ];
  const b = furyBoard({ extra });
  refused(() => play(b.engine, P1, b.id("ef"), { selected: { sac: [b.id("lentOut")], victim: [b.id("foe")] } }), "a character the opponent controls can't be the cost pick");
  assert.equal(zoneOf(b.engine, b.id("ef")), "hand");
  play(b.engine, P1, b.id("ef"), { selected: { sac: [b.id("stolen")], victim: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("stolen")), "discard", "control: a character I control (though they own it) is destroyed");
  assert.equal(damageOn(b.engine, b.id("foe")), 4, "X = its strength (4)");
});

clause(EXPLOSIVE_FURY, "0:ability", "the damaged character must be a character: items and cards out of play are refused", () => {
  const { engine, id } = furyBoard();
  for (const [key, why] of [
    ["theirItem", "an opposing item"],
    ["myItem", "my item"],
    ["foeHand", "a character in hand"],
    ["foeDeck", "a character in a deck"]
  ] as const) {
    refused(() => play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id(key)] } }), `${why} can't be the damaged character`);
  }
  assert.equal(zoneOf(engine, id("sac")), "play", "the refused attempts destroyed nothing");
  assert.equal(zoneOf(engine, id("ef")), "hand");
});

clause(EXPLOSIVE_FURY, "0:ability", "both picks are required: no sacrifice, or no second character, is refused", () => {
  const { engine, id } = furyBoard();
  refused(() => play(engine, P1, id("ef"), { selected: { sac: [], victim: [id("foe")] } }), "no character picked to destroy");
  refused(() => play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [] } }), "no second character picked");
  assert.equal(zoneOf(engine, id("ef")), "hand");
  assert.equal(zoneOf(engine, id("sac")), "play");
});

clause(EXPLOSIVE_FURY, "0:ability", "COST: the resources (cost 2) must be affordable, and the threshold 'r' (rage) met", () => {
  const short = furyBoard({ resources: 1 });
  refused(() => play(short.engine, P1, short.id("ef"), { selected: { sac: [short.id("sac")], victim: [short.id("foe")] } }), "one resource is short of the cost of 2");
  assert.equal(zoneOf(short.engine, short.id("sac")), "play", "nothing was destroyed");
  const noRage = furyBoard({ icon: "greed", resources: 3 });
  refused(() => play(noRage.engine, P1, noRage.id("ef"), { selected: { sac: [noRage.id("sac")], victim: [noRage.id("foe")] } }), "threshold r needs a rage icon");
  const ok = furyBoard({ resources: 3 });
  play(ok.engine, P1, ok.id("ef"), { selected: { sac: [ok.id("sac")], victim: [ok.id("foe")] } });
  assert.equal(readyResources(ok.engine, P1), 1, "control: 3 rage resources pay the cost of 2, leaving 1");
});

clause(EXPLOSIVE_FURY, "0:ability", "it needs a second character: with only one character in play it can't be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ef", def: printing(EXPLOSIVE_FURY), owner: P1, zone: "hand" },
      ...bank("rage", 2, P1),
      { key: "sac", def: character({ name: "Sac", strength: 3, life: 5 }), owner: P1, zone: "play" }
    ]
  });
  refused(() => play(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id("sac")] } }), "no other character to damage");
  assert.equal(zoneOf(engine, id("sac")), "play");
});

clause(EXPLOSIVE_FURY, "0:ability", "COST timing: the character is destroyed and the resources spent when the tactic is played, before the response window resolves", () => {
  const { engine, id } = furyBoard();
  playRaw(engine, P1, id("ef"), { selected: { sac: [id("sac")], victim: [id("foe")] } });
  assert.ok(engine.state.responseWindow, "the tactic waits for responses");
  assert.equal(zoneOf(engine, id("sac")), "discard", "COST: the picked character is already destroyed");
  assert.equal(readyResources(engine, P1), 0, "COST: the resources are already spent");
  assert.equal(damageOn(engine, id("foe")), 0, "the EFFECT has not happened yet");
});

// =====================================================================================
// Flaming Barduse (N = 2) and Really Big Barduse (N = 5)
// =====================================================================================
const FLAMING_BARDUSE = "94aedb92-432b-4e38-b65e-d5053455a55f"; // warlord character, dragon, cost 3 · threshold rr · str 1 / spd 2 / life 1 -- COST: You may pick 2 or fewer characters. -- When this card enters play, if you picked characters as part of its cost, inflict up to 2 damage divided however you want to those characters.
const REALLY_BIG_BARDUSE = "39ead032-c4c2-4b53-9ffa-1c54791f2a50"; // warlord character, dragon, cost 6 · threshold rrrrrr · str 5 / spd 2 / life 4 -- COST: You may pick 2 or fewer characters. -- When this card enters play, if you picked characters as part of its cost, inflict up to 5 damage divided however you want to those characters.

/** The Barduse (`bar`) in P1's hand with `cost` rage resources; characters on both sides are tough enough (life 20) to survive the damage. */
function barduseBoard(printingId: string, cost: number, opts: { resources?: number; icon?: "rage" | "greed"; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "bar", def: printing(printingId), owner: P1, zone: "hand" },
      ...bank(opts.icon ?? "rage", opts.resources ?? cost, P1),
      { key: "mine", def: character({ name: "Mine", life: 20 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 20 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", life: 20 }), owner: P2, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", life: 20 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "theirItem", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      { key: "foeHand", def: character({ name: "FoeHand", life: 20 }), owner: P2, zone: "hand" },
      { key: "foeDeck", def: character({ name: "FoeDeck", life: 20 }), owner: P2, zone: "deck" },
      ...(opts.extra ?? [])
    ]
  });
}

/** The engine data names the cost-pick declaration differently per printing (picked / picks) — used only to DRIVE the play. */
const pickKey = (printingId: string) => (printingId === REALLY_BIG_BARDUSE ? "picks" : "picked");

type BarduseGame = ReturnType<typeof barduseBoard>;
const distribute = (b: BarduseGame, shares: Record<string, number>) => {
  const pc = pending(b.engine);
  assert.ok(pc, "the damage division is pending");
  assert.equal(pc.kind, "distributeAmong");
  const byId: Record<string, number> = {};
  for (const [key, n] of Object.entries(shares)) byId[b.id(key)] = n;
  answerPending(b.engine, "distributeAmong", { shares: byId });
};

/** No characters picked: it enters play and no damage is inflicted, and nothing is asked. */
const barduseNoPicks = (printingId: string, cost: number) => () => {
  const b = barduseBoard(printingId, cost);
  play(b.engine, P1, b.id("bar"), { selected: { [pickKey(printingId)]: [] } });
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing to divide: no prompt");
  assert.equal(zoneOf(b.engine, b.id("bar")), "play", "it entered play");
  for (const k of ["mine", "foe", "foe2", "bystander", "bar"]) assert.equal(damageOn(b.engine, b.id(k)), 0, `${k} took no damage`);
  assert.equal(readyResources(b.engine, P1), 0, "its cost was paid");
};

/** One picked character: the controller divides (up to N); the whole N can go to it. */
const barduseOnePick = (printingId: string, cost: number, n: number) => () => {
  const b = barduseBoard(printingId, cost);
  play(b.engine, P1, b.id("bar"), { selected: { [pickKey(printingId)]: [b.id("foe")] } });
  const pc = pending(b.engine);
  assert.ok(pc, "a damage division is asked");
  assert.equal(pc.kind, "distributeAmong");
  assert.equal(pc.playerId, P1, "the Barduse's controller divides the damage");
  assert.equal(pc.amount, n, `up to ${n} damage`);
  assert.deepEqual(pc.targets, [b.id("foe")], "only the picked character receives damage");
  assert.equal(zoneOf(b.engine, b.id("bar")), "play", "it is already in play when the damage is divided");
  distribute(b, { foe: n });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(b.engine, b.id("foe")), n, `all ${n} damage went to the picked character`);
  for (const k of ["mine", "foe2", "bystander", "bar"]) assert.equal(damageOn(b.engine, b.id(k)), 0, `${k} (not picked) took no damage`);
};

/** Two picked characters: any division of N between them. */
const barduseSplits = (printingId: string, cost: number, n: number) => () => {
  const splits: Array<[number, number]> = [
    [n, 0],
    [0, n],
    [Math.floor(n / 2), n - Math.floor(n / 2)],
    [1, n - 1]
  ];
  for (const [a, c] of splits) {
    const b = barduseBoard(printingId, cost);
    play(b.engine, P1, b.id("bar"), { selected: { [pickKey(printingId)]: [b.id("foe"), b.id("mine")] } });
    const pc = pending(b.engine);
    assert.ok(pc, "pc");
    assert.deepEqual([...(pc.targets as string[])].sort(), [b.id("foe"), b.id("mine")].sort(), "both picked characters are offered");
    distribute(b, { foe: a, mine: c });
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(damageOn(b.engine, b.id("foe")), a, `foe takes ${a} of ${n}`);
    assert.equal(damageOn(b.engine, b.id("mine")), c, `my own picked character takes ${c} of ${n}`);
    for (const k of ["foe2", "bystander", "bar"]) assert.equal(damageOn(b.engine, b.id(k)), 0, `${k} (not picked) took no damage`);
  }
};

/** "Up to N": fewer is allowed (including none); more than N is refused. */
const barduseUpTo = (printingId: string, cost: number, n: number) => () => {
  for (const total of [n - 1, 1, 0]) {
    const b = barduseBoard(printingId, cost);
    play(b.engine, P1, b.id("bar"), { selected: { [pickKey(printingId)]: [b.id("foe"), b.id("foe2")] } });
    distribute(b, total === 0 ? {} : { foe: total });
    assert.equal(b.engine.state.pendingChoice, undefined, `dividing only ${total} is accepted`);
    assert.equal(damageOn(b.engine, b.id("foe")), total, `foe takes ${total}`);
    assert.equal(damageOn(b.engine, b.id("foe2")), 0);
  }
  const over = barduseBoard(printingId, cost);
  play(over.engine, P1, over.id("bar"), { selected: { [pickKey(printingId)]: [over.id("foe"), over.id("foe2")] } });
  assert.ok(pending(over.engine), "pending(over.engine)");
  refused(() => distribute(over, { foe: n, foe2: 1 }), `${n + 1} damage is more than "up to ${n}"`, /at most/);
  refused(() => distribute(over, { foe: n + 1 }), `${n + 1} to a single character is more than "up to ${n}"`, /at most/);
  assert.ok(pending(over.engine), "the division is still pending after the refusals");
  distribute(over, { foe: n - 1, foe2: 1 });
  assert.equal(damageOn(over.engine, over.id("foe")), n - 1, "control: exactly N in total is accepted");
  assert.equal(damageOn(over.engine, over.id("foe2")), 1);
};

/** Cost pick restrictions: characters only (either side), at most 2, no repeats. */
const bardusePickRestrictions = (printingId: string, cost: number) => () => {
  const b = barduseBoard(printingId, cost);
  const tryPick = (keys: string[]) => play(b.engine, P1, b.id("bar"), { selected: { [pickKey(printingId)]: keys.map((k) => b.id(k)) } });
  refused(() => tryPick(["foe", "foe2", "bystander"]), "3 characters is more than '2 or fewer'");
  refused(() => tryPick(["myItem"]), "my item is not a character");
  refused(() => tryPick(["theirItem"]), "an opposing item is not a character");
  refused(() => tryPick(["foeHand"]), "a character in hand can't be picked");
  refused(() => tryPick(["foeDeck"]), "a character in a deck can't be picked");
  refused(() => tryPick(["foe", "theirItem"]), "a legal character plus an item is refused");
  refused(() => tryPick(["foe", "foe"]), "the same character twice is not two characters");
  assert.equal(zoneOf(b.engine, b.id("bar")), "hand", "the refused attempts did not play the card");
  assert.equal(readyResources(b.engine, P1), cost, "nothing was paid");
  tryPick(["foe", "foe2"]);
  assert.equal(zoneOf(b.engine, b.id("bar")), "play", "control: exactly 2 characters is fine");
};

/** Printed cost: one resource short is refused; wrong icons for the threshold are refused. */
const barduseCost = (printingId: string, cost: number) => () => {
  // threshold met by already-spent rage, so only the cost can refuse
  const thr = String(printing(printingId).threshold ?? "").length;
  const short = barduseBoard(printingId, cost, { resources: cost - 1, extra: bank("rage", thr, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  refused(() => play(short.engine, P1, short.id("bar"), { selected: { [pickKey(printingId)]: [] } }), `${cost - 1} ready resources can't pay the cost of ${cost}`, /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("bar")), "hand");
  const wrongIcons = barduseBoard(printingId, cost, { icon: "greed" });
  refused(() => play(wrongIcons.engine, P1, wrongIcons.id("bar"), { selected: { [pickKey(printingId)]: [] } }), "the rage threshold is not met by greed resources", /Threshold requirements are not met/);
  const ok = barduseBoard(printingId, cost, { resources: cost + 1 });
  play(ok.engine, P1, ok.id("bar"), { selected: { [pickKey(printingId)]: [] } });
  assert.equal(zoneOf(ok.engine, ok.id("bar")), "play", "control: the exact cost plus one spare works");
  assert.equal(readyResources(ok.engine, P1), 1, `${cost} resources were paid`);
};

/** The damage is real damage: a picked character with life <= the damage dealt is destroyed. */
const barduseKills = (printingId: string, cost: number, n: number) => () => {
  const b = barduseBoard(printingId, cost, { extra: [{ key: "frail", def: character({ name: "Frail", life: n }), owner: P2, zone: "play" }] });
  play(b.engine, P1, b.id("bar"), { selected: { [pickKey(printingId)]: [b.id("frail"), b.id("foe")] } });
  distribute(b, { frail: n });
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard", `${n} damage destroys a ${n}-life character`);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(damageOn(b.engine, b.id("foe")), 0);
  assert.equal(zoneOf(b.engine, b.id("bar")), "play");
};

/** Printed stats. */
const barduseStats = (printingId: string, expected: [number, string, number, number, number]) => () => {
  const def = printing(printingId);
  assert.deepEqual([def.cost, def.threshold, def.strength, def.speed, def.life], expected);
  assert.deepEqual(def.subtype, ["dragon"]);
  assert.equal(def.type, "character");
};

clause(FLAMING_BARDUSE, "0:ability", "EXTRA COST: you may pick no characters (and then no damage is inflicted)", barduseNoPicks(FLAMING_BARDUSE, 3));
clause(FLAMING_BARDUSE, "0:ability", "EXTRA COST: you may pick 2 or fewer characters, of either side, but not items/out-of-play cards/duplicates", bardusePickRestrictions(FLAMING_BARDUSE, 3));
clause(FLAMING_BARDUSE, "0:ability", "printed cost 3 / threshold rr is required to deploy it", barduseCost(FLAMING_BARDUSE, 3));
clause(FLAMING_BARDUSE, "1:rule", "with 1 picked character, the controller divides up to 2 damage: all 2 can go to it; unpicked characters are untouched", barduseOnePick(FLAMING_BARDUSE, 3, 2));
clause(FLAMING_BARDUSE, "1:rule", "with 2 picked characters the 2 damage is divided however the controller wants (2/0, 0/2, 1/1)", barduseSplits(FLAMING_BARDUSE, 3, 2));
clause(FLAMING_BARDUSE, "1:rule", "'up to 2': less than 2 in total is accepted, more than 2 is refused", barduseUpTo(FLAMING_BARDUSE, 3, 2));
clause(FLAMING_BARDUSE, "1:rule", "the damage can destroy a picked character (2 damage on a 2-life character)", barduseKills(FLAMING_BARDUSE, 3, 2));
clause(FLAMING_BARDUSE, "1:rule", "'if you picked characters': with no pick it enters play and inflicts no damage", barduseNoPicks(FLAMING_BARDUSE, 3));
clause(FLAMING_BARDUSE, "0:ability", "printed stats: dragon warlord character cost 3 · rr · str 1 / spd 2 / life 1", barduseStats(FLAMING_BARDUSE, [3, "rr", 1, 2, 1]));

clause(REALLY_BIG_BARDUSE, "0:ability", "EXTRA COST: you may pick no characters (and then no damage is inflicted)", barduseNoPicks(REALLY_BIG_BARDUSE, 6));
clause(REALLY_BIG_BARDUSE, "0:ability", "EXTRA COST: you may pick 2 or fewer characters, of either side, but not items/out-of-play cards/duplicates", bardusePickRestrictions(REALLY_BIG_BARDUSE, 6));
clause(REALLY_BIG_BARDUSE, "0:ability", "printed cost 6 / threshold rrrrrr is required to deploy it", barduseCost(REALLY_BIG_BARDUSE, 6));
clause(REALLY_BIG_BARDUSE, "1:rule", "with 1 picked character, the controller divides up to 5 damage: all 5 can go to it; unpicked characters are untouched", barduseOnePick(REALLY_BIG_BARDUSE, 6, 5));
clause(REALLY_BIG_BARDUSE, "1:rule", "with 2 picked characters the 5 damage is divided however the controller wants (5/0, 0/5, 2/3, 1/4)", barduseSplits(REALLY_BIG_BARDUSE, 6, 5));
clause(REALLY_BIG_BARDUSE, "1:rule", "'up to 5': less than 5 in total is accepted, more than 5 is refused", barduseUpTo(REALLY_BIG_BARDUSE, 6, 5));
clause(REALLY_BIG_BARDUSE, "1:rule", "the damage can destroy a picked character (5 damage on a 5-life character)", barduseKills(REALLY_BIG_BARDUSE, 6, 5));
clause(REALLY_BIG_BARDUSE, "1:rule", "'if you picked characters': with no pick it enters play and inflicts no damage", barduseNoPicks(REALLY_BIG_BARDUSE, 6));
clause(REALLY_BIG_BARDUSE, "0:ability", "printed stats: dragon warlord character cost 6 · rrrrrr · str 5 / spd 2 / life 4", barduseStats(REALLY_BIG_BARDUSE, [6, "rrrrrr", 5, 2, 4]));

// =====================================================================================
// Fleshripping Scenepuller
// =====================================================================================
const SCENEPULLER = "ec6fc140-76f5-4aa9-9277-f729235b4475"; // warlord character, fighter, cost 4 · rrrr · str 4 / spd 3 / life 4 -- If this card is blocked, this turn it gains 4 strength for each member in the opposing party.

/** P1 attacks with the Scenepuller (`sp`) [and `ally`]; P2 has 3 tough blockers `b0..b2`. */
function scenepullerBoard(printingId: string = SCENEPULLER) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "sp", def: printing(printingId), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 30 }), owner: P1, zone: "play" },
      ...Array.from({ length: 3 }, (_, i) => ({ key: `b${i}`, def: character({ name: `B${i}`, strength: 1, life: 30 }), owner: P2, zone: "play" as const }))
    ]
  });
}

/** The Scenepuller attacks (with `ally` when `party`), and `blockers` of P2's characters block it; returns the board with the battle open. */
function scenepullerBlocked(blockers: number, party = false) {
  const b = scenepullerBoard();
  declareAttackBy(b.engine, P1, party ? [b.id("sp"), b.id("ally")] : [b.id("sp")]);
  declareBlockers(b.engine, P2, Array.from({ length: blockers }, (_, i) => b.id(`b${i}`)));
  return b;
}

clause(SCENEPULLER, "0:rule", "if it is blocked by 1 character it gains 4 strength (4 -> 8) this turn", () => {
  const b = scenepullerBlocked(1);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 8, "4 printed + 4 x 1 blocker");
});

clause(SCENEPULLER, "0:rule", "the gain is 4 per member of the opposing (blocking) party: 2 blockers -> +8, 3 blockers -> +12", () => {
  for (const [n, expected] of [
    [2, 12],
    [3, 16]
  ] as const) {
    const b = scenepullerBlocked(n);
    assert.equal(b.engine.getStat(b.id("sp"), "strength"), expected, `${n} blockers: 4 + 4 x ${n}`);
  }
});

clause(SCENEPULLER, "0:rule", "only the opposing party counts: attacking in a party with another character doesn't add to the gain", () => {
  const b = scenepullerBlocked(3, true);
  assert.deepEqual([...battleOf(b.engine)!.attackingParty].sort(), [b.id("sp"), b.id("ally")].sort(), "control: the Scenepuller attacks in a party of 2");
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 16, "4 + 4 x 3 blockers (its own 2-member party doesn't count)");
  const small = scenepullerBlocked(1, true);
  assert.equal(small.engine.getStat(small.id("sp"), "strength"), 8, "a 2-member attacking party blocked by 1: 4 + 4 x 1 (the opposing party's size, not its own)");
});

clause(SCENEPULLER, "0:rule", "only the Scenepuller gains the strength, not a party member that attacks alongside it", () => {
  const b = scenepullerBlocked(2, true);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 1, "the ally keeps its printed strength 1");
  for (const k of ["b0", "b1"]) assert.equal(b.engine.getStat(b.id(k), "strength"), 1, "the blockers are unaffected");
});

clause(SCENEPULLER, "0:rule", "if it is not blocked it gains nothing", () => {
  const b = scenepullerBoard();
  declareAttackBy(b.engine, P1, [b.id("sp")]);
  declareBlockers(b.engine, P2, []);
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 4, "unblocked: still its printed 4 strength");
  finishBattle(b.engine);
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 4, "and still 4 after the battle");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(SCENEPULLER, "0:rule", "the gain is not there before the block is declared (the attack alone gives nothing)", () => {
  const b = scenepullerBoard();
  declareAttackBy(b.engine, P1, [b.id("sp")]);
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 4, "attacking, not yet blocked: 4");
  declareBlockers(b.engine, P2, [b.id("b0")]);
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 8, "once blocked: 8");
});

clause(SCENEPULLER, "0:rule", "the extra strength is real battle damage: blocked by 1 character it inflicts 8, by 2 characters (split) its full 12", () => {
  const one = scenepullerBlocked(1);
  finishBattle(one.engine);
  assert.equal(damageOn(one.engine, one.id("b0")), 8, "the lone blocker took the boosted 8 damage");
  const two = scenepullerBlocked(2);
  finishBattle(two.engine);
  assert.equal(damageOn(two.engine, two.id("b0")) + damageOn(two.engine, two.id("b1")), 12, "the two blockers took 12 damage between them");
  assert.equal(zoneOf(two.engine, two.id("sp")), "play", "the Scenepuller (life 4) survived 2 damage from the two 1-strength blockers");
});

clause(SCENEPULLER, "0:rule", "'this turn': the gain lasts through the rest of the turn, then ends", () => {
  const b = scenepullerBlocked(2);
  finishBattle(b.engine);
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 12, "after the battle, still boosted this turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 4, "the next turn it is back to its printed 4");
});

clause(SCENEPULLER, "0:rule", "it only triggers when THIS card is blocked: as a blocker it gains nothing", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "sp", def: printing(SCENEPULLER), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 30 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("sp")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 4, "blocking, not blocked: no gain");
});

clause(SCENEPULLER, "0:rule", "another attacker being blocked doesn't boost it: the boost needs the Scenepuller itself blocked", () => {
  const b = scenepullerBoard();
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  declareBlockers(b.engine, P2, [b.id("b0"), b.id("b1")]);
  assert.equal(b.engine.getStat(b.id("sp"), "strength"), 4, "the Scenepuller isn't in the battle: no gain");
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 1);
});

clause(SCENEPULLER, "0:rule", "printed stats: fighter warlord character cost 4 · rrrr · str 4 / spd 3 / life 4", () => {
  const def = printing(SCENEPULLER);
  assert.deepEqual([def.cost, def.threshold, def.strength, def.speed, def.life, def.subtype], [4, "rrrr", 4, 3, 4, ["fighter"]]);
});

// =====================================================================================
// Hammer Smash
// =====================================================================================
const HAMMER_SMASH = "5a63b50a-1a12-4637-a962-e5e25ea4ba75"; // warlord tactic, cost 2, threshold rr -- COST: Flip a coin. If you win, X is 2. Otherwise, X is 1. Pick X or fewer items. -- EFFECT: Destroy the items.

/** `roll` is what the seeded RNG returns (0.1 and 0.9 give the two different coin results). */
function smashBoard(roll: number, opts: { resources?: number; icon?: "rage" | "greed"; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    random: () => roll,
    cards: [
      { key: "hs", def: printing(HAMMER_SMASH), owner: P1, zone: "hand" },
      ...bank(opts.icon ?? "rage", opts.resources ?? 2, P1),
      { key: "i1", def: item({ name: "I1" }), owner: P1, zone: "play" },
      { key: "i2", def: item({ name: "I2" }), owner: P2, zone: "play" },
      { key: "i3", def: item({ name: "I3" }), owner: P2, zone: "play" },
      { key: "char", def: character({ name: "Char", life: 9 }), owner: P2, zone: "play" },
      { key: "myChar", def: character({ name: "MyChar", life: 9 }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P2, zone: "play" },
      { key: "handItem", def: item({ name: "HandItem" }), owner: P2, zone: "hand" },
      { key: "deckItem", def: item({ name: "DeckItem" }), owner: P2, zone: "deck" },
      { key: "discardItem", def: item({ name: "DiscardItem" }), owner: P2, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

type SmashGame = ReturnType<typeof smashBoard>;

/** Plays Hammer Smash; the coin is flipped and the engine then asks which items to pick. */
function smashStart(b: SmashGame): void {
  playRaw(b.engine, P1, b.id("hs"));
  const pc = pending(b.engine);
  assert.ok(pc, "the engine asks for the item picks");
  assert.equal(pc.kind, "selectDeployTargets");
  assert.equal(pc.playerId, P1, "the card's controller picks");
}

/** Answers the pending item pick with `keys` (throws if the engine refuses it) and lets the tactic resolve. */
function smashPick(b: SmashGame, keys: string[]): void {
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: keys.map((k) => b.id(k)) } } } as never);
  resolvePendingResponses(b.engine);
}

/** The X the card rolled for this RNG value, found by behavior: only X = 2 accepts a pick of 2 items. */
function smashX(roll: number): 1 | 2 {
  const b = smashBoard(roll);
  smashStart(b);
  try {
    smashPick(b, ["i1", "i2"]);
    return 2;
  } catch {
    return 1;
  }
}

/** A board where the coin flip gave X = `x` (whichever RNG value produces it), with the item pick pending. */
function smashWith(x: 1 | 2, opts: { resources?: number; icon?: "rage" | "greed" } = {}): SmashGame {
  const roll = smashX(0.1) === x ? 0.1 : 0.9;
  assert.equal(smashX(roll), x, "control: the chosen RNG value gives the wanted X");
  const b = smashBoard(roll, opts);
  smashStart(b);
  return b;
}

clause(HAMMER_SMASH, "0:ability", "X is 1 or 2 depending on the flip: the two coin results give different pick limits, and 3 items is never allowed", () => {
  assert.deepEqual([smashX(0.1), smashX(0.9)].sort(), [1, 2], "one flip result gives X = 1 and the other X = 2");
  for (const x of [1, 2] as const) {
    const b = smashWith(x);
    refused(() => smashPick(b, ["i1", "i2", "i3"]), `3 items is more than X (${x})`);
    assert.ok(pending(b.engine), "the pick is still open after the refusal");
  }
});

clause(HAMMER_SMASH, "0:ability", "EFFECT: destroys exactly the X picked items (X = 2: both; X = 1: the one), leaving the other items alone", () => {
  for (const x of [1, 2] as const) {
    const picks = ["i1", "i2"].slice(0, x);
    const b = smashWith(x);
    smashPick(b, picks);
    assert.equal(b.engine.state.pendingChoice, undefined);
    for (const k of picks) assert.equal(zoneOf(b.engine, b.id(k)), "discard", `X = ${x}: ${k} is destroyed`);
    for (const k of ["i1", "i2", "i3"].filter((k) => !picks.includes(k))) assert.equal(zoneOf(b.engine, b.id(k)), "play", `X = ${x}: ${k} (not picked) survives`);
    assert.equal(zoneOf(b.engine, b.id("hs")), "discard", "the tactic is spent");
    assert.equal(readyResources(b.engine, P1), 0, "the 2 resources were paid");
  }
});

clause(HAMMER_SMASH, "0:ability", "X = 2 allows exactly 2 items; X = 1 refuses 2 items", () => {
  const two = smashWith(2);
  smashPick(two, ["i2", "i3"]);
  assert.deepEqual([zoneOf(two.engine, two.id("i2")), zoneOf(two.engine, two.id("i3"))], ["discard", "discard"], "X = 2: two items destroyed");
  assert.equal(zoneOf(two.engine, two.id("i1")), "play");
  const one = smashWith(1);
  refused(() => smashPick(one, ["i2", "i3"]), "X = 1: two items is too many");
  assert.deepEqual([zoneOf(one.engine, one.id("i2")), zoneOf(one.engine, one.id("i3"))], ["play", "play"], "the refusal destroyed nothing");
  smashPick(one, ["i3"]);
  assert.equal(zoneOf(one.engine, one.id("i3")), "discard", "control: one item works");
  assert.equal(zoneOf(one.engine, one.id("i2")), "play");
});

clause(HAMMER_SMASH, "0:ability", "'X or fewer': picking fewer than X (one item, or none) is allowed", () => {
  for (const x of [1, 2] as const) {
    const one = smashWith(x);
    smashPick(one, ["i2"]);
    assert.equal(zoneOf(one.engine, one.id("i2")), "discard", `X = ${x}: one picked item is destroyed`);
    assert.equal(zoneOf(one.engine, one.id("i1")), "play");
    const none = smashWith(x);
    smashPick(none, []);
    assert.equal(none.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(none.engine, none.id("hs")), "discard", `X = ${x}: the tactic resolved with no picks`);
    for (const k of ["i1", "i2", "i3"]) assert.equal(zoneOf(none.engine, none.id(k)), "play", `${k} untouched`);
  }
});

clause(HAMMER_SMASH, "0:ability", "the picks must be items in play: characters, locations, and items in hand/deck/discard are refused; either player's items work", () => {
  for (const [key, why] of [
    ["char", "an opposing character"],
    ["myChar", "my character"],
    ["loc", "a location"],
    ["handItem", "an item in hand"],
    ["deckItem", "an item in a deck"],
    ["discardItem", "an item in a discard pile"]
  ] as const) {
    const b = smashWith(2);
    refused(() => smashPick(b, [key]), `${why} is not an item in play`);
    assert.ok(pending(b.engine), `${why}: the pick is still open`);
  }
  const mine = smashWith(2);
  smashPick(mine, ["i1"]);
  assert.equal(zoneOf(mine.engine, mine.id("i1")), "discard", "control: my own item can be picked");
  const theirs = smashWith(2);
  smashPick(theirs, ["i3"]);
  assert.equal(zoneOf(theirs.engine, theirs.id("i3")), "discard", "control: an opposing item can be picked");
});

clause(HAMMER_SMASH, "0:ability", "COST: the resources (cost 2) must be affordable, and the threshold 'rr' met", () => {
  const short = smashBoard(0.1, { resources: 1, extra: bank("rage", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  // the cost is checked when the item pick is answered: the threshold check (rr, met by spent icons) passed at play time
  smashStart(short);
  refused(() => smashPick(short, ["i1"]), "one ready resource is short of the cost of 2 (rr met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("hs")), "hand");
  const noRage = smashBoard(0.1, { icon: "greed", resources: 3 });
  refused(() => playRaw(noRage.engine, P1, noRage.id("hs")), "greed resources don't meet the rr threshold", /Threshold requirements are not met/);
  assert.equal(zoneOf(noRage.engine, noRage.id("hs")), "hand");
  const ok = smashBoard(0.1, { resources: 3 });
  smashStart(ok);
  smashPick(ok, ["i1"]);
  assert.equal(readyResources(ok.engine, P1), 1, "control: 3 rage resources pay 2, leaving 1");
});

clause(HAMMER_SMASH, "0:ability", "the items are destroyed by the EFFECT (on resolution), after the resources are paid and the picks made", () => {
  const b = smashWith(2);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectDeployTargets", selected: { picked: [b.id("i1"), b.id("i2")] } } } as never);
  assert.ok(b.engine.state.responseWindow, "the tactic waits for responses");
  assert.equal(readyResources(b.engine, P1), 0, "COST: resources already spent");
  assert.equal(zoneOf(b.engine, b.id("i1")), "play", "EFFECT: not destroyed until the tactic resolves");
  assert.equal(zoneOf(b.engine, b.id("i2")), "play");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("i1")), "discard", "destroyed on resolution");
  assert.equal(zoneOf(b.engine, b.id("i2")), "discard");
});

const coinFlips = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "coinFlipped")
    .map((entry) => entry.event as unknown as { playerId: string; won: boolean });

clause(HAMMER_SMASH, "0:ability", "COST: a real coin is flipped (coinFlipped for its controller): a win makes X = 2, otherwise X = 1", () => {
  for (const roll of [0.1, 0.9]) {
    const b = smashBoard(roll);
    smashStart(b);
    let two = true;
    try {
      smashPick(b, ["i1", "i2"]);
    } catch {
      two = false;
    }
    const flips = coinFlips(b.engine);
    assert.equal(flips.length, 1, `RNG ${roll}: exactly one coin flip is recorded`);
    assert.equal(flips[0].playerId, P1, "the player who played the card flips it");
    assert.equal(two, flips[0].won, `RNG ${roll}: X is 2 exactly when the flip is won (picking 2 items ${two ? "worked" : "was refused"}, flip won = ${flips[0].won})`);
  }
});

// =====================================================================================
// Heirloom Incinerator
// =====================================================================================
const INCINERATOR = "0e70f3be-4c51-4880-b03e-8cf1dd2bcb5c"; // warlord character, tyrant, cost 1 · r · str 1 / spd 3 / life 1 -- If this card inflicts damage to a faction, you may pick an item. If you do, destroy it.

function incineratorBoard(opts: { items?: boolean; extra?: CardPlacement[]; hiOwner?: PlayerId } = {}) {
  const owner = opts.hiOwner ?? P1;
  const foe = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    cards: [
      { key: "hi", def: printing(INCINERATOR), owner, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 30 }), owner, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 30 }), owner: foe, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc", structure: 30 }), owner: foe, zone: "play" },
      ...(opts.items === false
        ? []
        : [
            { key: "myItem", def: item({ name: "MyItem" }), owner, zone: "play" as const },
            { key: "theirItem", def: item({ name: "TheirItem" }), owner: foe, zone: "play" as const }
          ]),
      { key: "foeHandItem", def: item({ name: "FoeHandItem" }), owner: foe, zone: "hand" },
      { key: "foeDiscardItem", def: item({ name: "FoeDiscardItem" }), owner: foe, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;

function pickTarget(engine: SpoilsEngine, player: PlayerId, selected: CardInstanceId[]): void {
  const pc = pending(engine);
  assert.ok(pc, "an item pick is pending");
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, player, "the Incinerator's controller picks");
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "selectTargets", selected: { target: selected } } } as never);
  resolvePendingResponses(engine);
}

/** The Incinerator attacks the opposing faction unblocked and the battle runs until its trigger asks for a pick. */
function incineratorHits(b: ReturnType<typeof incineratorBoard>, owner: PlayerId = P1): void {
  const foe = owner === P1 ? P2 : P1;
  fight(b.engine, owner, [b.id("hi")], { type: "faction", playerId: foe }, []);
}

clause(INCINERATOR, "0:rule", "when it damages a faction, its controller may pick an item; the picked item is destroyed (an opposing item)", () => {
  const b = incineratorBoard();
  const before = influenceOf(b.engine, P2);
  incineratorHits(b);
  assert.equal(influenceOf(b.engine, P2), before - 1, "it inflicted its 1 damage to the faction");
  pickTarget(b.engine, P1, [b.id("theirItem")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "discard", "the picked item is destroyed");
  assert.equal(zoneOf(b.engine, b.id("myItem")), "play", "the other item is untouched");
  finishBattle(b.engine);
});

clause(INCINERATOR, "0:rule", "the picked item may be one of the controller's own items too (any item)", () => {
  const b = incineratorBoard();
  incineratorHits(b);
  pickTarget(b.engine, P1, [b.id("myItem")]);
  assert.equal(zoneOf(b.engine, b.id("myItem")), "discard", "my own item is destroyed");
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "play");
});

clause(INCINERATOR, "0:rule", "'you may': declining the pick destroys nothing", () => {
  const b = incineratorBoard();
  incineratorHits(b);
  pickTarget(b.engine, P1, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["myItem", "theirItem"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} survives`);
});

clause(INCINERATOR, "0:rule", "only items in play can be picked: characters, locations, and items in hand/discard are refused; 2 items are too many", () => {
  const b = incineratorBoard();
  incineratorHits(b);
  assert.equal(pending(b.engine)?.kind, "selectTargets", "control: the pick is open");
  for (const [key, why] of [
    ["blk", "an opposing character"],
    ["ally", "my character"],
    ["hi", "the Incinerator itself"],
    ["foeLoc", "a location"],
    ["foeHandItem", "an item in hand"],
    ["foeDiscardItem", "an item in a discard pile"]
  ] as const) {
    refused(() => pickTarget(b.engine, P1, [b.id(key)]), `${why} is not a legal pick`);
    assert.ok(pending(b.engine), `${why}: the pick is still pending`);
  }
  refused(() => pickTarget(b.engine, P1, [b.id("myItem"), b.id("theirItem")]), "only ONE item may be picked");
  pickTarget(b.engine, P1, [b.id("theirItem")]);
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "discard", "control: an item works");
});

clause(INCINERATOR, "0:rule", "does NOT trigger when it is blocked (its damage goes to the blocker, not a faction)", () => {
  const b = incineratorBoard();
  const before = influenceOf(b.engine, P2);
  fight(b.engine, P1, [b.id("hi")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(b.engine.state.pendingChoice, undefined, "no item pick is offered");
  assert.equal(b.engine.state.battle, undefined);
  assert.equal(damageOn(b.engine, b.id("blk")), 1, "control: its damage hit the blocker");
  assert.equal(influenceOf(b.engine, P2), before, "the faction was not damaged");
  for (const k of ["myItem", "theirItem"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} survives`);
});

clause(INCINERATOR, "0:rule", "does NOT trigger when it damages a location rather than a faction", () => {
  const b = incineratorBoard();
  fight(b.engine, P1, [b.id("hi")], { type: "card", cardId: b.id("foeLoc") }, []);
  assert.equal(damageOn(b.engine, b.id("foeLoc")), 1, "control: the location took its damage");
  assert.equal(b.engine.state.pendingChoice, undefined, "no item pick is offered");
  for (const k of ["myItem", "theirItem"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} survives`);
});

clause(INCINERATOR, "0:rule", "does NOT trigger when ANOTHER character damages a faction", () => {
  const b = incineratorBoard();
  const before = influenceOf(b.engine, P2);
  fight(b.engine, P1, [b.id("ally")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(b.engine, P2), before - 1, "control: the ally damaged the faction");
  assert.equal(b.engine.state.pendingChoice, undefined, "the Incinerator didn't inflict it: no pick");
  for (const k of ["myItem", "theirItem"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} survives`);
});

clause(INCINERATOR, "0:rule", "when it attacks in a party with another character and both damage the faction, it still triggers (once)", () => {
  const b = incineratorBoard();
  const before = influenceOf(b.engine, P2);
  fight(b.engine, P1, [b.id("hi"), b.id("ally")], { type: "faction", playerId: P2 }, []);
  pickTarget(b.engine, P1, [b.id("theirItem")]);
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "discard", "its trigger fired and destroyed the picked item");
  finishBattle(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined, "only one pick (the ally has no such ability)");
  assert.equal(influenceOf(b.engine, P2), before - 2, "control: both characters damaged the faction (1 + 1)");
});

clause(INCINERATOR, "0:rule", "damage to EITHER player's faction counts: an Incinerator attacking my faction triggers for its controller", () => {
  const b = incineratorBoard({ hiOwner: P2 });
  const before = influenceOf(b.engine, P1);
  fight(b.engine, P2, [b.id("hi")], { type: "faction", playerId: P1 }, []);
  assert.equal(influenceOf(b.engine, P1), before - 1);
  pickTarget(b.engine, P2, [b.id("theirItem")]);
  assert.equal(zoneOf(b.engine, b.id("theirItem")), "discard", "the controller (P2) destroyed the picked item");
});

clause(INCINERATOR, "0:rule", "with no item in play there is nothing to pick: the trigger does nothing and asks for nothing", () => {
  const b = incineratorBoard({ items: false });
  const before = influenceOf(b.engine, P2);
  incineratorHits(b);
  assert.equal(influenceOf(b.engine, P2), before - 1, "control: the faction was damaged");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.battle, undefined);
  assert.equal(zoneOf(b.engine, b.id("foeHandItem")), "hand");
});

clause(INCINERATOR, "0:rule", "if its damage is reduced to 0 it inflicts no damage to the faction, so nothing triggers", () => {
  const b = incineratorBoard({ extra: [{ key: "shrink", def: pumpTactic(-1), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("shrink"), { selected: { t: [b.id("hi")] } });
  assert.equal(b.engine.getStat(b.id("hi"), "strength"), 0, "control: the Incinerator now has 0 strength");
  const before = influenceOf(b.engine, P2);
  fight(b.engine, P1, [b.id("hi")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(b.engine, P2), before, "no damage inflicted");
  assert.equal(b.engine.state.pendingChoice, undefined, "no damage inflicted, so no trigger");
  for (const k of ["myItem", "theirItem"]) assert.equal(zoneOf(b.engine, b.id(k)), "play");
});

clause(INCINERATOR, "0:rule", "printed stats: tyrant warlord character cost 1 · r · str 1 / spd 3 / life 1", () => {
  const def = printing(INCINERATOR);
  assert.deepEqual([def.cost, def.threshold, def.strength, def.speed, def.life, def.subtype], [1, "r", 1, 3, 1, ["tyrant"]]);
});

// =====================================================================================
// Battle-damage redirect helpers (Penetrate, Raging Bask)
// =====================================================================================
type DamageTarget = { type: "card"; cardId: CardInstanceId } | { type: "faction"; playerId: PlayerId };
const cardTarget = (cardId: CardInstanceId): DamageTarget => ({ type: "card", cardId });
const factionTarget = (playerId: PlayerId): DamageTarget => ({ type: "faction", playerId });

/** Drains response windows until the battle waits for damage to be assigned. */
function toDamageAssignment(engine: SpoilsEngine): void {
  resolvePendingResponses(engine);
  assert.ok(engine.state.battle, "a battle is under way");
  assert.match(engine.state.battle.phase, /DamageAssignment$/, "the battle is waiting for damage to be assigned");
}

/** Where `cardId`'s battle damage may legally be assigned right now. */
function legalTargets(engine: SpoilsEngine, cardId: CardInstanceId): DamageTarget[] {
  const source = engine.getBattleView()?.damageSources.find((s) => s.cardId === cardId);
  assert.ok(source, "the card has battle damage to assign now");
  return source.legalTargets as DamageTarget[];
}

/** The acting player assigns each source's damage: `{ [sourceId]: [target, amount][] }`. */
function assignDamage(engine: SpoilsEngine, plan: Record<CardInstanceId, Array<[DamageTarget, number]>>): void {
  const view = engine.getBattleView();
  assert.ok(view?.actingPlayerId, "someone is assigning damage");
  const assignments = Object.entries(plan).flatMap(([sourceId, parts]) => parts.map(([target, amount]) => ({ sourceId, target, amount })));
  engine.perform({ type: "assignBattleDamage", playerId: view.actingPlayerId, assignments } as never);
}

// =====================================================================================
// Penetrate
// =====================================================================================
const PENETRATE = "c321876c-3c6d-4b2c-9d04-26448c97bbd6"; // warlord tactic, cost 1, threshold rr -- COST: Pick an attacking character you control. -- EFFECT: If the character assigns battle damage to the blocking party during this battle, assign it to the target of the attack instead.

function penetrateBoard(opts: { resources?: number; icon?: "rage" | "greed" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "pen", def: printing(PENETRATE), owner: P1, zone: "hand" },
      ...bank(opts.icon ?? "rage", opts.resources ?? 2, P1),
      { key: "atk", def: character({ name: "Atk", strength: 3, speed: 2, life: 30 }), owner: P1, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 2, speed: 2, life: 30 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 30 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, speed: 1, life: 30 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, speed: 1, life: 30 }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc", structure: 30 }), owner: P2, zone: "play" }
    ]
  });
}
type PenetrateGame = ReturnType<typeof penetrateBoard>;

/** `attackers` attack (the faction, or the location `foeLoc`); `blockers` block; the attacker has priority in the window after blocks. */
function penetrateBattle(b: PenetrateGame, attackers: string[], blockers: string[], target: "faction" | "loc" = "faction"): void {
  declareAttackBy(b.engine, P1, attackers.map((k) => b.id(k)), target === "loc" ? cardTarget(b.id("foeLoc")) : factionTarget(P2));
  declareBlockers(b.engine, P2, blockers.map((k) => b.id(k)));
}
const penPlay = (b: PenetrateGame, key = "atk") => play(b.engine, P1, b.id("pen"), { selected: { atk: [b.id(key)] } });

clause(PENETRATE, "0:ability", "control: without Penetrate a blocked attacker's damage goes to the blocking party only", () => {
  const b = penetrateBoard();
  penetrateBattle(b, ["atk"], ["blk"]);
  toDamageAssignment(b.engine);
  assert.deepEqual(legalTargets(b.engine, b.id("atk")), [cardTarget(b.id("blk"))], "the blocker is the only target");
});

clause(PENETRATE, "0:ability", "the picked attacker CAN assign its battle damage to the target of the attack (the faction) while blocked; an unpicked attacker can't", () => {
  const b = penetrateBoard();
  const influence = influenceOf(b.engine, P2);
  penetrateBattle(b, ["atk", "atk2"], ["blk"]);
  penPlay(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("pen")), "discard", "the tactic is spent");
  assert.equal(readyResources(b.engine, P1), 1, "its cost of 1 was paid");
  toDamageAssignment(b.engine);
  assert.ok(legalTargets(b.engine, b.id("atk")).some((t) => t.type === "faction" && t.playerId === P2), "the picked attacker may assign to the target of the attack");
  assert.equal(legalTargets(b.engine, b.id("atk2")).some((t) => t.type === "faction"), false, "the other attacker may not");
  assignDamage(b.engine, { [b.id("atk")]: [[factionTarget(P2), 3]], [b.id("atk2")]: [[cardTarget(b.id("blk")), 2]] });
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), influence - 3, "the faction took the picked attacker's 3 damage");
  assert.equal(damageOn(b.engine, b.id("blk")), 2, "the blocker took only the other attacker's 2");
});

clause(PENETRATE, "0:ability", "the picked attacker must assign its battle damage to the target of the attack (the faction) instead of the blocking party", () => {
  const b = penetrateBoard();
  const influence = influenceOf(b.engine, P2);
  penetrateBattle(b, ["atk"], ["blk"]);
  penPlay(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("pen")), "discard", "the tactic is spent");
  assert.equal(readyResources(b.engine, P1), 1, "its cost of 1 was paid");
  toDamageAssignment(b.engine);
  assert.deepEqual(legalTargets(b.engine, b.id("atk")), [factionTarget(P2)], "the only place its damage can go is the target of the attack");
  refused(() => assignDamage(b.engine, { [b.id("atk")]: [[cardTarget(b.id("blk")), 3]] }), "it can't assign to the blocking party any more");
  assignDamage(b.engine, { [b.id("atk")]: [[factionTarget(P2), 3]] });
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), influence - 3, "the faction took the full 3 damage");
  assert.equal(damageOn(b.engine, b.id("blk")), 0, "the blocker took none of it");
});

clause(PENETRATE, "0:ability", "with several blockers none of them can be damaged by the picked attacker: all of its damage goes to the target of the attack", () => {
  const b = penetrateBoard();
  const influence = influenceOf(b.engine, P2);
  penetrateBattle(b, ["atk"], ["blk", "blk2"]);
  penPlay(b);
  toDamageAssignment(b.engine);
  assert.deepEqual(legalTargets(b.engine, b.id("atk")), [factionTarget(P2)]);
  assignDamage(b.engine, { [b.id("atk")]: [[factionTarget(P2), 3]] });
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), influence - 3);
  assert.equal(damageOn(b.engine, b.id("blk")) + damageOn(b.engine, b.id("blk2")), 0, "neither blocker took damage");
});

clause(PENETRATE, "0:ability", "'the target of the attack' can be a location: the damage goes to the attacked location instead of the blockers", () => {
  const b = penetrateBoard();
  penetrateBattle(b, ["atk"], ["blk"], "loc");
  toDamageAssignment(b.engine);
  assert.deepEqual(legalTargets(b.engine, b.id("atk")), [cardTarget(b.id("blk"))], "control: unaided, only the blocker");
  const c = penetrateBoard();
  penetrateBattle(c, ["atk"], ["blk"], "loc");
  penPlay(c);
  toDamageAssignment(c.engine);
  assert.deepEqual(legalTargets(c.engine, c.id("atk")), [cardTarget(c.id("foeLoc"))], "with Penetrate, only the attacked location");
  assignDamage(c.engine, { [c.id("atk")]: [[cardTarget(c.id("foeLoc")), 3]] });
  finishBattle(c.engine);
  assert.equal(damageOn(c.engine, c.id("foeLoc")), 3, "the location took the 3 damage");
  assert.equal(damageOn(c.engine, c.id("blk")), 0, "the blocker took none");
});

clause(PENETRATE, "0:ability", "only the picked character is affected: another attacker in the party still assigns its damage to the blocking party", () => {
  const b = penetrateBoard();
  penetrateBattle(b, ["atk", "atk2"], ["blk"]);
  penPlay(b);
  toDamageAssignment(b.engine);
  assert.deepEqual(legalTargets(b.engine, b.id("atk")), [factionTarget(P2)], "the picked attacker redirects");
  assert.deepEqual(legalTargets(b.engine, b.id("atk2")), [cardTarget(b.id("blk"))], "the other attacker still hits the blocker");
  assignDamage(b.engine, { [b.id("atk")]: [[factionTarget(P2), 3]], [b.id("atk2")]: [[cardTarget(b.id("blk")), 2]] });
  finishBattle(b.engine);
  assert.equal(damageOn(b.engine, b.id("blk")), 2, "only the other attacker's 2 damage reached the blocker");
});

clause(PENETRATE, "0:ability", "the pick must be an ATTACKING character I control: an idle character of mine, a blocker, and 'no battle' are refused", () => {
  const b = penetrateBoard();
  penetrateBattle(b, ["atk"], ["blk"]);
  refused(() => penPlay(b, "idle"), "my non-attacking character can't be picked");
  refused(() => penPlay(b, "blk"), "an opposing blocker can't be picked");
  refused(() => penPlay(b, "atk2"), "a character of mine that isn't in the battle can't be picked");
  assert.equal(zoneOf(b.engine, b.id("pen")), "hand", "nothing was played");
  assert.equal(readyResources(b.engine, P1), 2, "nothing was paid");
  penPlay(b, "atk");
  assert.equal(zoneOf(b.engine, b.id("pen")), "discard", "control: the attacking character works");

  const none = penetrateBoard();
  refused(() => penPlay(none, "atk"), "outside a battle no character is attacking");
  assert.equal(zoneOf(none.engine, none.id("pen")), "hand");
});

clause(PENETRATE, "0:ability", "an attacking character I DON'T control can't be picked (an opponent's attacker, played from the defender's window)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "pen", def: printing(PENETRATE), owner: P1, zone: "hand" },
      ...bank("rage", 2, P1),
      { key: "foeAtk", def: character({ name: "FoeAtk", strength: 3, life: 30 }), owner: P2, zone: "play" },
      { key: "myBlk", def: character({ name: "MyBlk", strength: 1, life: 30 }), owner: P1, zone: "play" }
    ]
  });
  declareAttackOpenWindow(engine, P2, [id("foeAtk")], factionTarget(P1));
  refused(() => play(engine, P1, id("pen"), { selected: { atk: [id("foeAtk")] } }), "the picked attacker must be one I control", /target/i);
  assert.equal(zoneOf(engine, id("pen")), "hand");
});

clause(PENETRATE, "0:ability", "COST: 1 resource must be available, and the threshold 'rr' (two rage icons) must be met even though only 1 is paid", () => {
  const none = penetrateBoard({ resources: 0 });
  penetrateBattle(none, ["atk"], ["blk"]);
  refused(() => penPlay(none), "no resource to pay the cost of 1");
  const one = penetrateBoard({ resources: 1 });
  penetrateBattle(one, ["atk"], ["blk"]);
  refused(() => penPlay(one), "one rage resource can't meet the rr threshold");
  const wrong = penetrateBoard({ icon: "greed", resources: 3 });
  penetrateBattle(wrong, ["atk"], ["blk"]);
  refused(() => penPlay(wrong), "greed resources don't meet the rr threshold", /Threshold requirements are not met/);
  const ok = penetrateBoard({ resources: 2 });
  penetrateBattle(ok, ["atk"], ["blk"]);
  penPlay(ok);
  assert.equal(readyResources(ok.engine, P1), 1, "control: two rage resources work, and only 1 is paid");
});

clause(PENETRATE, "0:ability", "'during this battle': the redirect ends with the battle (a later battle the same turn assigns to the blocking party)", () => {
  const b = penetrateBoard();
  penetrateBattle(b, ["atk"], ["blk"]);
  penPlay(b);
  toDamageAssignment(b.engine);
  assignDamage(b.engine, { [b.id("atk")]: [[factionTarget(P2), 3]] });
  finishBattle(b.engine);
  // Second attack by the same character in the same turn (it is readied by the test).
  for (const k of ["atk", "blk", "blk2"]) b.engine.state.cards[b.id(k)].depleted = false;
  declareAttackBy(b.engine, P1, [b.id("atk")], factionTarget(P2));
  declareBlockers(b.engine, P2, [b.id("blk2")]);
  toDamageAssignment(b.engine);
  assert.deepEqual(legalTargets(b.engine, b.id("atk")), [cardTarget(b.id("blk2"))], "in the next battle its damage goes to the blocking party again");
});

clause(PENETRATE, "0:ability", "the redirect does not outlast the turn: attacking again on a later turn, the character's damage goes to the blocking party", () => {
  const b = penetrateBoard();
  penetrateBattle(b, ["atk"], ["blk"]);
  penPlay(b);
  toDamageAssignment(b.engine);
  assert.ok(legalTargets(b.engine, b.id("atk")).some((t) => t.type === "faction"), "control: the redirect applies in the battle");
  assignDamage(b.engine, { [b.id("atk")]: [[factionTarget(P2), 3]] });
  finishBattle(b.engine);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "back to P1's turn");
  declareAttackBy(b.engine, P1, [b.id("atk")], factionTarget(P2));
  declareBlockers(b.engine, P2, [b.id("blk2")]);
  toDamageAssignment(b.engine);
  assert.deepEqual(legalTargets(b.engine, b.id("atk")), [cardTarget(b.id("blk2"))], "a turn later: only the blocking party");
});

// =====================================================================================
// Raging Bask
// =====================================================================================
const RAGING_BASK = "9c45e654-4e91-46de-82ec-30a6997d45fe"; // warlord character, dragon, cost 6 · rr · str 4 / spd 3 / life 4 -- While this card is attacking, you may assign its battle damage to the target of the attack instead of the blocking party.

function baskBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "bask", def: printing(RAGING_BASK), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 2, speed: 3, life: 30 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, speed: 1, life: 30 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, speed: 1, life: 30 }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "FoeLoc", structure: 30 }), owner: P2, zone: "play" }
    ]
  });
}
type BaskGame = ReturnType<typeof baskBoard>;
function baskBattle(b: BaskGame, attackers: string[], blockers: string[], target: "faction" | "loc" = "faction"): void {
  declareAttackBy(b.engine, P1, attackers.map((k) => b.id(k)), target === "loc" ? cardTarget(b.id("foeLoc")) : factionTarget(P2));
  declareBlockers(b.engine, P2, blockers.map((k) => b.id(k)));
  toDamageAssignment(b.engine);
}
const sameTargets = (actual: DamageTarget[], expected: DamageTarget[]) =>
  assert.deepEqual([...actual].map((t) => JSON.stringify(t)).sort(), [...expected].map((t) => JSON.stringify(t)).sort());

clause(RAGING_BASK, "0:rule", "while attacking and blocked, it MAY assign its damage to the target of the attack (the faction) instead of the blocking party", () => {
  const b = baskBoard();
  const influence = influenceOf(b.engine, P2);
  baskBattle(b, ["bask"], ["blk"]);
  sameTargets(legalTargets(b.engine, b.id("bask")), [cardTarget(b.id("blk")), factionTarget(P2)]);
  assignDamage(b.engine, { [b.id("bask")]: [[factionTarget(P2), 4]] });
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), influence - 4, "the faction took the whole 4");
  assert.equal(damageOn(b.engine, b.id("blk")), 0, "the blocker took none of it");
});

clause(RAGING_BASK, "0:rule", "'you may': it can still assign its damage to the blocking party as normal", () => {
  const b = baskBoard();
  const influence = influenceOf(b.engine, P2);
  baskBattle(b, ["bask"], ["blk"]);
  assignDamage(b.engine, { [b.id("bask")]: [[cardTarget(b.id("blk")), 4]] });
  finishBattle(b.engine);
  assert.equal(damageOn(b.engine, b.id("blk")), 4, "the blocker took the 4 damage");
  assert.equal(influenceOf(b.engine, P2), influence, "the faction took none");
});

clause(RAGING_BASK, "0:rule", "against a blocking party of several characters, all of its damage can still go to the target of the attack", () => {
  const b = baskBoard();
  const influence = influenceOf(b.engine, P2);
  baskBattle(b, ["bask"], ["blk", "blk2"]);
  sameTargets(legalTargets(b.engine, b.id("bask")), [cardTarget(b.id("blk")), cardTarget(b.id("blk2")), factionTarget(P2)]);
  assignDamage(b.engine, { [b.id("bask")]: [[factionTarget(P2), 4]] });
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), influence - 4);
  assert.equal(damageOn(b.engine, b.id("blk")) + damageOn(b.engine, b.id("blk2")), 0, "neither blocker took damage");
});

clause(RAGING_BASK, "0:rule", "when the attack's target is a location, the damage may go to that location instead of the blocking party", () => {
  const b = baskBoard();
  baskBattle(b, ["bask"], ["blk"], "loc");
  sameTargets(legalTargets(b.engine, b.id("bask")), [cardTarget(b.id("blk")), cardTarget(b.id("foeLoc"))]);
  assignDamage(b.engine, { [b.id("bask")]: [[cardTarget(b.id("foeLoc")), 4]] });
  finishBattle(b.engine);
  assert.equal(damageOn(b.engine, b.id("foeLoc")), 4, "the location took the damage");
  assert.equal(damageOn(b.engine, b.id("blk")), 0);
});

clause(RAGING_BASK, "0:rule", "only the Bask can redirect: another attacker in its party must assign to the blocking party", () => {
  const b = baskBoard();
  baskBattle(b, ["bask", "ally"], ["blk"]);
  sameTargets(legalTargets(b.engine, b.id("bask")), [cardTarget(b.id("blk")), factionTarget(P2)]);
  assert.deepEqual(legalTargets(b.engine, b.id("ally")), [cardTarget(b.id("blk"))], "the ally has no redirect option");
});

clause(RAGING_BASK, "0:rule", "unblocked, its damage goes to the target of the attack as usual", () => {
  const b = baskBoard();
  const influence = influenceOf(b.engine, P2);
  baskBattle(b, ["bask"], []);
  assert.deepEqual(legalTargets(b.engine, b.id("bask")), [factionTarget(P2)]);
  assignDamage(b.engine, { [b.id("bask")]: [[factionTarget(P2), 4]] });
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), influence - 4);
});

clause(RAGING_BASK, "0:rule", "'while this card is attacking': as a blocker it gets no such option (its damage goes to the attacking party only)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "bask", def: printing(RAGING_BASK), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, speed: 1, life: 30 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")], factionTarget(P1));
  declareBlockers(b.engine, P1, [b.id("bask")]);
  toDamageAssignment(b.engine);
  assert.deepEqual(legalTargets(b.engine, b.id("bask")), [cardTarget(b.id("atk"))], "blocking: its only target is the attacker");
});

clause(RAGING_BASK, "0:rule", "printed stats: dragon warlord character cost 6 · rr · str 4 / spd 3 / life 4", () => {
  const def = printing(RAGING_BASK);
  assert.deepEqual([def.cost, def.threshold, def.strength, def.speed, def.life, def.subtype], [6, "rr", 4, 3, 4, ["dragon"]]);
});

// =====================================================================================
// Reckless Challenger
// =====================================================================================
const CHALLENGER = "95ac4d0d-5f22-4442-80e8-7962abd7304e"; // warlord character, fighter, cost 4 · r · str 7 / spd 3 / life 1 -- At the end of your turn, if this card started the turn under your control and did not attack this turn, destroy it.

function challengerBoard(opts: { active?: PlayerId; rc?: Partial<CardPlacement> } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "rc", def: printing(CHALLENGER), owner: P1, zone: "play", ...opts.rc },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 30 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 30 }), owner: P2, zone: "play" }
    ]
  });
}

clause(CHALLENGER, "0:rule", "at the end of your turn, if it started the turn under your control and did not attack, it is destroyed", () => {
  const { engine, id } = challengerBoard();
  assert.equal(zoneOf(engine, id("rc")), "play", "mid-turn it is still in play");
  endTurn(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("rc")), "discard", "destroyed at the end of its controller's turn");
  assert.equal(zoneOf(engine, id("ally")), "play", "other characters are untouched");
  assert.equal(engine.state.activePlayerId, P2, "the turn passed");
});

clause(CHALLENGER, "0:rule", "if it attacked this turn it survives the end of the turn", () => {
  const { engine, id } = challengerBoard();
  fight(engine, P1, [id("rc")], { type: "faction", playerId: P2 }, []);
  assert.equal(zoneOf(engine, id("rc")), "play", "control: it survived the unblocked attack");
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "play", "it attacked, so it is not destroyed");
});

clause(CHALLENGER, "0:rule", "it must be IT that attacked: another character attacking doesn't save it", () => {
  const { engine, id } = challengerBoard();
  fight(engine, P1, [id("ally")], { type: "faction", playerId: P2 }, []);
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "discard", "it didn't attack: destroyed");
  assert.equal(zoneOf(engine, id("ally")), "play");
});

clause(CHALLENGER, "0:rule", "attacking in a party with another character counts as attacking", () => {
  const { engine, id } = challengerBoard();
  fight(engine, P1, [id("rc"), id("ally")], { type: "faction", playerId: P2 }, []);
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "play", "it attacked (in a party): not destroyed");
});

clause(CHALLENGER, "0:rule", "if it entered play this turn (didn't start the turn under your control) it survives the end of the turn", () => {
  const { engine, id } = challengerBoard({ rc: { attackEligible: false } });
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "play", "it did not start the turn under my control");
});

clause(CHALLENGER, "0:rule", "if I took control of it this turn (didn't start the turn under my control) it survives the end of my turn", () => {
  const { engine, id } = challengerBoard({ rc: { owner: P2, controller: P1, attackEligible: false } });
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "play", "it didn't start the turn under my control");
});

clause(CHALLENGER, "0:rule", "'your turn': it is not destroyed at the end of the OPPONENT's turn, even if it didn't attack", () => {
  const { engine, id } = challengerBoard({ active: P2 });
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("rc")), "play", "P2's turn ended; the Challenger (P1's) isn't affected");
});

clause(CHALLENGER, "0:rule", "'your' follows the controller: a Challenger P2 controls (owned by P1) is destroyed at the end of P2's turn, not P1's", () => {
  const { engine, id } = challengerBoard({ rc: { controller: P2 } });
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("rc")), "play", "the end of its owner's turn doesn't touch it");
  endTurn(engine, P2);
  assert.equal(zoneOf(engine, id("rc")), "discard", "destroyed at the end of its controller's turn (into its owner's discard)");
  assert.equal(engine.state.cards[id("rc")].ownerId, P1);
});

clause(CHALLENGER, "0:rule", "printed stats: fighter warlord character cost 4 · r · str 7 / spd 3 / life 1", () => {
  const def = printing(CHALLENGER);
  assert.deepEqual([def.cost, def.threshold, def.strength, def.speed, def.life, def.subtype], [4, "r", 7, 3, 1, ["fighter"]]);
});
