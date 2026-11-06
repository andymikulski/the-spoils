// Batch 2nd-edition-06, part p3 (groups 27-32, clauses not covered elsewhere).
// Every test is written from the PRINTED text of the printing under test.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, location, P1, P2, play, resolvePendingResponses, tactic, volition } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, clauseMismatch, printing, refused } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, pending, readyResources, zoneOf } from "./_board.js";
import { endTurn, factionOf } from "./_turn.js";

type Pid = typeof P1 | typeof P2;
const damageOf = (engine: SpoilsEngine, c: CardInstanceId): number => engine.state.cards[c].damage;
const handOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].hand];
const influenceOf = (engine: SpoilsEngine, p: Pid): number => engine.state.players[p].influence;

/** `activateAbility` WITHOUT draining the response window (the opponent holds priority afterwards). */
function activateRaw(engine: SpoilsEngine, player: Pid, cardId: CardInstanceId, abilityId: string, opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** A free tactic giving one chosen character `amount` strength until end of turn (id `buff`, declaration `t`). */
const buffTactic = (name: string, amount: number): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "buff",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

/** A tactic dealing `amount` damage to one chosen character (id `hit`, declaration `t`), costing `cost` resources. */
const hitTactic = (name: string, amount: number, cost = 0): CardDefinition =>
  tactic({
    name,
    cost,
    behavior: {
      abilities: [
        {
          id: "hit",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

// =================================================================================
// Rudo Mangod
// UNIQUE RUDOLPHUS
// PUNCH -- COST: Pay 2. Deplete this card. Pick a character. X is its strength. Y is this card's strength.
//          EFFECT: Inflict X damage to this card. Inflict Y damage to the character.
// Character, warlord, subtype fighter, cost 5, threshold [R][R][R], 4/3/3 (str / spd / life).
// =================================================================================

const RUDO = "c7769a50-296a-41e3-ac62-02e8fec8bc96";

function rudoBoard(o: { foeStr?: number; foeLife?: number; rage?: number; rudoDepleted?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "rudo", def: printing(RUDO), owner: P1, zone: "play", depleted: o.rudoDepleted },
      { key: "foe", def: character({ name: "Foe", strength: o.foeStr ?? 2, life: o.foeLife ?? 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "foeItem", def: item({ name: "Foe Item" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "Foe Loc", structure: 9 }), owner: P2, zone: "play" },
      { key: "handGuy", def: character({ name: "Hand Guy", strength: 2, life: 9 }), owner: P2, zone: "hand" },
      { key: "gone", def: character({ name: "Gone", strength: 2, life: 9 }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 4, P1),
      ...(o.extra ?? [])
    ]
  });
}

clause(RUDO, "0:unique", "deploys from hand for the printed cost 5 and threshold [R][R][R], with printed stats 4 / 3 / 3", () => {
  const cards = (rage: number, greed: number): CardPlacement[] => [
    { key: "rudo", def: printing(RUDO), owner: P1, zone: "hand" },
    ...bank("rage", rage, P1),
    ...bank("greed", greed, P1)
  ];
  const short = buildGame({ playerA: { faction: developFaction() }, cards: cards(4, 0) });
  refused(() => play(short.engine, P1, short.id("rudo")), "cost 5 with only 4 resources");
  assert.equal(zoneOf(short.engine, short.id("rudo")), "hand");
  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: cards(2, 3) });
  refused(() => play(noThreshold.engine, P1, noThreshold.id("rudo")), "five resources but only two [R] icons of [R][R][R]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("rudo")), "hand");
  const ok = buildGame({ playerA: { faction: developFaction() }, cards: cards(3, 2) });
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("rudo"));
  assert.equal(zoneOf(ok.engine, ok.id("rudo")), "play");
  assert.equal(before - readyResources(ok.engine, P1), 5, "five resources paid");
  assert.deepEqual([ok.engine.getStat(ok.id("rudo"), "strength"), ok.engine.getStat(ok.id("rudo"), "speed"), ok.engine.getStat(ok.id("rudo"), "life")], [4, 3, 3]);
});

clause(RUDO, "0:unique", "a second Rudo Mangod under my control: I choose which to keep (keep the new one: the old one is destroyed)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rudo", def: printing(RUDO), owner: P1, zone: "play" },
      { key: "rudo2", def: printing(RUDO), owner: P1, zone: "hand" },
      ...bank("rage", 5, P1)
    ]
  });
  play(engine, P1, id("rudo2"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("rudo"), id("rudo2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("rudo2") });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("rudo2")), "play");
  assert.equal(zoneOf(engine, id("rudo")), "discard", "the other copy is destroyed");
});

clause(RUDO, "0:unique", "keeping the old copy destroys the new one; the choice may not name a card that is not a copy", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rudo", def: printing(RUDO), owner: P1, zone: "play" },
      { key: "rudo2", def: printing(RUDO), owner: P1, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      ...bank("rage", 5, P1)
    ]
  });
  play(engine, P1, id("rudo2"));
  assert.equal(pending(engine)?.kind, "uniqueSurvivor");
  refused(() => answerPending(engine, "uniqueSurvivor", { keep: id("bystander") }), "a bystander is not a copy", /./);
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.ok(pending(engine), "still waiting for a real answer");
  answerPending(engine, "uniqueSurvivor", { keep: id("rudo") });
  assert.equal(zoneOf(engine, id("rudo")), "play");
  assert.equal(zoneOf(engine, id("rudo2")), "discard");
});

clause(RUDO, "0:unique", "UNIQUE is per player: the opponent may control their own Rudo Mangod with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "rudo", def: printing(RUDO), owner: P1, zone: "play" },
      { key: "rudo2", def: printing(RUDO), owner: P2, zone: "hand" },
      ...bank("rage", 5, P2)
    ]
  });
  play(engine, P2, id("rudo2"));
  assert.equal(pending(engine), undefined, "no survivor choice");
  assert.equal(zoneOf(engine, id("rudo")), "play");
  assert.equal(zoneOf(engine, id("rudo2")), "play");
});

clause(RUDO, "0:unique", "a different UNIQUE identifier does not conflict", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "rudo", def: printing(RUDO), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other Unique", unique: "someoneelse" }), owner: P1, zone: "hand" },
      ...bank("rage", 5, P1)
    ]
  });
  play(engine, P1, id("other"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("rudo")), "play");
  assert.equal(zoneOf(engine, id("other")), "play");
});

clause(RUDO, "0:unique", "taking control of the opponent's Rudo Mangod leaves me with two: I choose one to keep and play carries on", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "mine", def: printing(RUDO), owner: P1, zone: "play" },
      { key: "theirs", def: printing(RUDO), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("theirs")] } });
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("mine"), id("theirs")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("mine") } } as never);
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "discard");
  resolvePendingResponses(engine);
  assert.equal(engine.state.responseWindow, undefined, "the Steal tactic finished resolving");
  assert.equal(pending(engine), undefined);
});

// --- PUNCH --------------------------------------------------------------------------

clause(RUDO, "1:ability:punch", "pays 2 and depletes this card; X (the character's strength 2) hits this card and Y (this card's strength 4) hits the character", () => {
  const { engine, id } = rudoBoard({ foeStr: 2, foeLife: 9 });
  const before = readyResources(engine, P1);
  activate(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(before - readyResources(engine, P1), 2, "Pay 2");
  assert.equal(engine.state.cards[id("rudo")].depleted, true, "Deplete this card");
  assert.equal(damageOf(engine, id("rudo")), 2, "X = the character's strength 2 to this card");
  assert.equal(damageOf(engine, id("foe")), 4, "Y = this card's strength 4 to the character");
  assert.equal(zoneOf(engine, id("rudo")), "play");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(damageOf(engine, id("ally")), 0, "an uninvolved character is untouched");
});

clause(RUDO, "1:ability:punch", "X follows the picked character's strength: strength 1 and strength 0", () => {
  for (const [foeStr, expectedSelf] of [[1, 1], [0, 0]] as const) {
    const { engine, id } = rudoBoard({ foeStr });
    activate(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
    assert.equal(damageOf(engine, id("rudo")), expectedSelf, `X = ${foeStr}`);
    assert.equal(damageOf(engine, id("foe")), 4, "Y is still 4");
  }
});

clause(RUDO, "1:ability:punch", "X and Y are the CURRENT strengths: a buffed picked character (1 + 1) and a buffed Rudo (4 + 2)", () => {
  const { engine, id } = rudoBoard({
    foeStr: 1,
    foeLife: 9,
    extra: [
      { key: "buffFoe", def: buffTactic("BuffFoe", 1), owner: P1, zone: "hand" },
      { key: "buffRudo", def: buffTactic("BuffRudo", 2), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("buffFoe"), { selected: { t: [id("foe")] } });
  play(engine, P1, id("buffRudo"), { selected: { t: [id("rudo")] } });
  assert.equal(engine.getStat(id("foe"), "strength"), 2);
  assert.equal(engine.getStat(id("rudo"), "strength"), 6);
  activate(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  assert.equal(damageOf(engine, id("rudo")), 2, "X = 2");
  assert.equal(damageOf(engine, id("foe")), 6, "Y = 6");
});

clause(RUDO, "1:ability:punch", "enough damage destroys: both Rudo (3 life, takes 3) and the character (4 life, takes 4) are destroyed", () => {
  const { engine, id } = rudoBoard({ foeStr: 3, foeLife: 4 });
  activate(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  assert.equal(zoneOf(engine, id("rudo")), "discard", "X = 3 destroys this card");
  assert.equal(zoneOf(engine, id("foe")), "discard", "Y = 4 (read before this card left play) destroys the character");
});

clause(RUDO, "1:ability:punch", "a character strong enough to kill Rudo takes the punch anyway; a weak one is only damaged (survivors keep their damage)", () => {
  const strong = rudoBoard({ foeStr: 5, foeLife: 9 });
  activate(strong.engine, P1, strong.id("rudo"), "punch", { selected: { c: [strong.id("foe")] } });
  assert.equal(zoneOf(strong.engine, strong.id("rudo")), "discard", "X = 5 destroys Rudo");
  assert.equal(zoneOf(strong.engine, strong.id("foe")), "play");
  assert.equal(damageOf(strong.engine, strong.id("foe")), 4, "Y = 4 still inflicted");
});

clause(RUDO, "1:ability:punch", "any character can be picked: my own ally (strength 1) or a depleted opposing character", () => {
  const own = rudoBoard();
  activate(own.engine, P1, own.id("rudo"), "punch", { selected: { c: [own.id("ally")] } });
  assert.equal(damageOf(own.engine, own.id("rudo")), 1, "X = the ally's strength 1");
  assert.equal(damageOf(own.engine, own.id("ally")), 4, "Y = 4 to my own ally");
  const dep = rudoBoard({ extra: [{ key: "tired", def: character({ name: "Tired", strength: 2, life: 9 }), owner: P2, zone: "play", depleted: true }] });
  activate(dep.engine, P1, dep.id("rudo"), "punch", { selected: { c: [dep.id("tired")] } });
  assert.equal(damageOf(dep.engine, dep.id("rudo")), 2);
  assert.equal(damageOf(dep.engine, dep.id("tired")), 4);
});

clause(RUDO, "1:ability:punch", "Rudo can pick itself (it is a character): X = Y = 4, both inflicted on itself, destroying it", () => {
  const { engine, id } = rudoBoard();
  activate(engine, P1, id("rudo"), "punch", { selected: { c: [id("rudo")] } });
  assert.equal(zoneOf(engine, id("rudo")), "discard");
  assert.equal(engine.state.cards[id("rudo")].depleted, false, "(a card that left play is no longer depleted)");
});

clause(RUDO, "1:ability:punch", "only a character in play can be picked: not an item, a location, a faction, a card in hand or in the discard pile, and a pick is required", () => {
  const { engine, id } = rudoBoard();
  const rageBefore = readyResources(engine, P1);
  const targets: Array<[string, CardInstanceId[]]> = [
    ["an item", [id("foeItem")]],
    ["a location", [id("foeLoc")]],
    ["a faction", [factionOf(engine, P2)]],
    ["my own faction", [factionOf(engine, P1)]],
    ["a character in a hand", [id("handGuy")]],
    ["a character in the discard pile", [id("gone")]],
    ["nothing", []]
  ];
  for (const [what, picked] of targets) {
    refused(() => activate(engine, P1, id("rudo"), "punch", { selected: { c: picked } }), `${what} is not a legal pick`);
  }
  assert.equal(readyResources(engine, P1), rageBefore, "nothing was paid by a refused use");
  assert.equal(engine.state.cards[id("rudo")].depleted, false);
  activate(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  assert.equal(damageOf(engine, id("foe")), 4, "control: a character in play works");
});

clause(RUDO, "1:ability:punch", "COST: Deplete this card: an already depleted Rudo cannot PUNCH", () => {
  const dep = rudoBoard({ rudoDepleted: true });
  refused(() => activate(dep.engine, P1, dep.id("rudo"), "punch", { selected: { c: [dep.id("foe")] } }), "depleted");
  assert.equal(damageOf(dep.engine, dep.id("foe")), 0);
  assert.equal(readyResources(dep.engine, P1), 4, "nothing paid");
  const ready = rudoBoard();
  activate(ready.engine, P1, ready.id("rudo"), "punch", { selected: { c: [ready.id("foe")] } });
  assert.equal(damageOf(ready.engine, ready.id("foe")), 4, "control: ready Rudo works");
});

clause(RUDO, "1:ability:punch", "COST: Pay 2: one resource is not enough, exactly two is, and it is spent", () => {
  const one = rudoBoard({ rage: 1 });
  refused(() => activate(one.engine, P1, one.id("rudo"), "punch", { selected: { c: [one.id("foe")] } }), "only one resource");
  assert.equal(damageOf(one.engine, one.id("foe")), 0);
  assert.equal(one.engine.state.cards[one.id("rudo")].depleted, false, "no cost was kept");
  const two = rudoBoard({ rage: 2 });
  activate(two.engine, P1, two.id("rudo"), "punch", { selected: { c: [two.id("foe")] } });
  assert.equal(damageOf(two.engine, two.id("foe")), 4);
  assert.equal(readyResources(two.engine, P1), 0, "both resources were spent");
});

clause(RUDO, "1:ability:punch", "the cost is paid before the opponent can respond: Rudo is already depleted and the 2 already spent", () => {
  const { engine, id } = rudoBoard({ foeStr: 2 });
  activateRaw(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(engine.state.cards[id("rudo")].depleted, true);
  assert.equal(readyResources(engine, P1), 2);
  assert.equal(damageOf(engine, id("foe")), 0, "the effect has not happened yet");
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe")), 4);
});

clause(RUDO, "1:ability:punch", "X (the character's strength) is fixed when the cost is paid: a response buffing the character does not change it", () => {
  const { engine, id } = rudoBoard({
    foeStr: 2,
    foeLife: 9,
    extra: [{ key: "boost", def: buffTactic("Boost", 3), owner: P2, zone: "hand" }]
  });
  activateRaw(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(engine, P2, id("boost"), { selected: { t: [id("foe")] } });
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.getStat(id("foe"), "strength"), 5, "the response did buff the character");
  assert.equal(zoneOf(engine, id("rudo")), "play", "X was 2 when the cost was paid, so Rudo (3 life) survives");
  assert.equal(damageOf(engine, id("rudo")), 2, "X was 2 when the cost was paid");
});

clause(RUDO, "1:ability:punch", "Y (this card's strength) is fixed when the cost is paid: a response buffing Rudo does not change it", () => {
  const { engine, id } = rudoBoard({
    foeStr: 2,
    foeLife: 9,
    extra: [{ key: "boost", def: buffTactic("Boost", 2), owner: P2, zone: "hand" }]
  });
  activateRaw(engine, P1, id("rudo"), "punch", { selected: { c: [id("foe")] } });
  playRaw(engine, P2, id("boost"), { selected: { t: [id("rudo")] } });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("rudo"), "strength"), 6, "the response did buff Rudo");
  assert.equal(damageOf(engine, id("foe")), 4, "Y was 4 when the cost was paid");
});

// =================================================================================
// Skewer
// COST: Choose a number for X. Pay X+X. Pick a character.
// EFFECT: Inflict X damage to the character.
// Tactic, warlord, cost 0, threshold [R].
// =================================================================================

const SKEWER = "88dc9da3-3f11-4a36-b026-2c1ee1528822";

function skewerBoard(o: { rage?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "skewer", def: printing(SKEWER), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 3 }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "Foe Item" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "Foe Loc", structure: 9 }), owner: P2, zone: "play" },
      { key: "handGuy", def: character({ name: "Hand Guy", life: 9 }), owner: P2, zone: "hand" },
      { key: "gone", def: character({ name: "Gone", life: 9 }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 6, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

clause(SKEWER, "0:ability", "X = 2: pays X+X = 4 resources and inflicts 2 damage to the picked opposing character; the tactic goes to the discard pile", () => {
  const { engine, id } = skewerBoard();
  const before = readyResources(engine, P1);
  play(engine, P1, id("skewer"), { selected: { target: [id("foe")] }, variables: { x: 2 } });
  assert.equal(pending(engine), undefined);
  assert.equal(before - readyResources(engine, P1), 4, "X + X = 4");
  assert.equal(damageOf(engine, id("foe")), 2, "X damage");
  assert.equal(zoneOf(engine, id("skewer")), "discard");
  assert.equal(damageOf(engine, id("mine")), 0, "other characters are untouched");
  assert.equal(damageOf(engine, id("weak")), 0);
});

clause(SKEWER, "0:ability", "X = 1 pays 2 for 1 damage and X = 3 pays 6 for 3 damage", () => {
  for (const x of [1, 3]) {
    const { engine, id } = skewerBoard();
    const before = readyResources(engine, P1);
    play(engine, P1, id("skewer"), { selected: { target: [id("foe")] }, variables: { x } });
    assert.equal(before - readyResources(engine, P1), 2 * x, `X = ${x} pays ${2 * x}`);
    assert.equal(damageOf(engine, id("foe")), x, `X = ${x} damage`);
  }
});

clause(SKEWER, "0:ability", "X = 0 is a legal number: pays nothing and inflicts no damage", () => {
  const { engine, id } = skewerBoard();
  const before = readyResources(engine, P1);
  play(engine, P1, id("skewer"), { selected: { target: [id("foe")] }, variables: { x: 0 } });
  assert.equal(zoneOf(engine, id("skewer")), "discard", "the tactic was played");
  assert.equal(before - readyResources(engine, P1), 0);
  assert.equal(damageOf(engine, id("foe")), 0);
});

clause(SKEWER, "0:ability", "enough damage destroys the character (X = 3 on a 3-life character)", () => {
  const { engine, id } = skewerBoard();
  play(engine, P1, id("skewer"), { selected: { target: [id("weak")] }, variables: { x: 3 } });
  assert.equal(zoneOf(engine, id("weak")), "discard");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(SKEWER, "0:ability", "Pay X+X: three resources cannot pay for X = 2 (needs 4), exactly four can; one fewer than 2X is always refused", () => {
  const short = skewerBoard({ rage: 3 });
  refused(() => play(short.engine, P1, short.id("skewer"), { selected: { target: [short.id("foe")] }, variables: { x: 2 } }), "needs 4 resources");
  assert.equal(zoneOf(short.engine, short.id("skewer")), "hand");
  assert.equal(readyResources(short.engine, P1), 3, "nothing was spent");
  assert.equal(damageOf(short.engine, short.id("foe")), 0);
  const exact = skewerBoard({ rage: 4 });
  play(exact.engine, P1, exact.id("skewer"), { selected: { target: [exact.id("foe")] }, variables: { x: 2 } });
  assert.equal(readyResources(exact.engine, P1), 0);
  assert.equal(damageOf(exact.engine, exact.id("foe")), 2);
  const tight = skewerBoard({ rage: 5 });
  refused(() => play(tight.engine, P1, tight.id("skewer"), { selected: { target: [tight.id("foe")] }, variables: { x: 3 } }), "X = 3 needs 6, only 5");
  assert.equal(readyResources(tight.engine, P1), 5);
});

clause(SKEWER, "0:ability", "threshold [R]: with no [R] icon among the resources Skewer cannot be played; one [R] is enough", () => {
  const noRage = skewerBoard({ rage: 0, greed: 6 });
  refused(() => play(noRage.engine, P1, noRage.id("skewer"), { selected: { target: [noRage.id("foe")] }, variables: { x: 1 } }), "no [R] icon");
  assert.equal(zoneOf(noRage.engine, noRage.id("skewer")), "hand");
  const oneRage = skewerBoard({ rage: 1, greed: 5 });
  play(oneRage.engine, P1, oneRage.id("skewer"), { selected: { target: [oneRage.id("foe")] }, variables: { x: 2 } });
  assert.equal(damageOf(oneRage.engine, oneRage.id("foe")), 2);
});

clause(SKEWER, "0:ability", "Choose a number: it must be a whole number, so -1 and 1.5 are refused (CR 410.2) and nothing is spent", () => {
  const { engine, id } = skewerBoard();
  refused(() => play(engine, P1, id("skewer"), { selected: { target: [id("foe")] }, variables: { x: -1 } }), "X = -1 is not a whole number");
  assert.equal(zoneOf(engine, id("skewer")), "hand");
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(readyResources(engine, P1), 6);
});

clause(SKEWER, "0:ability", "Choose a number: a fractional X (1.5) is refused (CR 410.2)", () => {
  const { engine, id } = skewerBoard();
  refused(() => play(engine, P1, id("skewer"), { selected: { target: [id("foe")] }, variables: { x: 1.5 } }), "X = 1.5 is not a whole number");
  assert.equal(zoneOf(engine, id("skewer")), "hand");
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(readyResources(engine, P1), 6);
});

clause(SKEWER, "0:ability", "Pick a character: any character in play, mine included", () => {
  const own = skewerBoard();
  play(own.engine, P1, own.id("skewer"), { selected: { target: [own.id("mine")] }, variables: { x: 2 } });
  assert.equal(damageOf(own.engine, own.id("mine")), 2);
  const depleted = skewerBoard({ extra: [{ key: "tired", def: character({ name: "Tired", life: 9 }), owner: P2, zone: "play", depleted: true }] });
  play(depleted.engine, P1, depleted.id("skewer"), { selected: { target: [depleted.id("tired")] }, variables: { x: 1 } });
  assert.equal(damageOf(depleted.engine, depleted.id("tired")), 1);
});

clause(SKEWER, "0:ability", "Pick a character: not an item, a location, a faction, a card in hand or in the discard pile, and a pick is required", () => {
  const { engine, id } = skewerBoard();
  const targets: Array<[string, CardInstanceId[]]> = [
    ["an item", [id("foeItem")]],
    ["a location", [id("foeLoc")]],
    ["a faction", [factionOf(engine, P2)]],
    ["a character in a hand", [id("handGuy")]],
    ["a character in the discard pile", [id("gone")]],
    ["nothing", []]
  ];
  for (const [what, picked] of targets) {
    refused(() => play(engine, P1, id("skewer"), { selected: { target: picked }, variables: { x: 1 } }), `${what} is not a legal pick`);
  }
  assert.equal(zoneOf(engine, id("skewer")), "hand");
  assert.equal(readyResources(engine, P1), 6, "nothing was spent");
  play(engine, P1, id("skewer"), { selected: { target: [id("foe")] }, variables: { x: 1 } });
  assert.equal(damageOf(engine, id("foe")), 1, "control: a character in play works");
});

// =================================================================================
// Skin Suit
// COST: Pick a character you control. X is its strength. Pick a character your opponent controls. Y is its strength.
// EFFECT: Inflict X damage to your opponent's character and Y damage to your character simultaneously.
//   If only 1 of the characters is destroyed by this damage, remove it from the game instead.
//   The surviving character gains all rules text of the removed character.
// Tactic, warlord, cost 2, threshold [R][R][R][R].
// =================================================================================

const SKIN_SUIT = "c553043b-2514-42cf-9fa9-f2524b4a1ee2";

/** A character with a free "draw a card" activated ability (id `zap`). */
const zapper = (name: string, strength: number, life: number): CardDefinition =>
  character({
    name,
    strength,
    life,
    speed: 1,
    behavior: { abilities: [{ id: "zap", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function suitBoard(o: { mine?: CardDefinition; theirs?: CardDefinition; rage?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "suit", def: printing(SKIN_SUIT), owner: P1, zone: "hand" },
      { key: "mine", def: o.mine ?? character({ name: "Mine", strength: 2, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "theirs", def: o.theirs ?? character({ name: "Theirs", strength: 3, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 1, life: 9 }), owner: P1, zone: "play" },
      { key: "theirs2", def: character({ name: "Theirs Two", strength: 1, life: 9 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "foeItem", def: item({ name: "Foe Item" }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "Foe Loc", structure: 9 }), owner: P2, zone: "play" },
      { key: "myHandGuy", def: character({ name: "My Hand Guy", strength: 2, life: 9 }), owner: P1, zone: "hand" },
      { key: "foeHandGuy", def: character({ name: "Foe Hand Guy", strength: 2, life: 9 }), owner: P2, zone: "hand" },
      { key: "foeGone", def: character({ name: "Foe Gone", strength: 2, life: 9 }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...Array.from({ length: 4 }, (_, i): CardPlacement => ({ key: `d1-${i}`, def: character({ name: `P1 Deck ${i}` }), owner: P1, zone: "deck" })),
      ...Array.from({ length: 4 }, (_, i): CardPlacement => ({ key: `d2-${i}`, def: character({ name: `P2 Deck ${i}` }), owner: P2, zone: "deck" })),
      ...(o.extra ?? [])
    ]
  });
}

const playSuit = (b: ReturnType<typeof suitBoard>, mine = "mine", theirs = "theirs") =>
  play(b.engine, P1, b.id("suit"), { selected: { mine: [b.id(mine)], theirs: [b.id(theirs)] } });

clause(SKIN_SUIT, "0:ability", "cost 2 is paid (4 ready -> 2 ready) and the tactic goes to the discard pile; neither character is destroyed with 9 life each", () => {
  const b = suitBoard();
  const before = readyResources(b.engine, P1);
  playSuit(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(before - readyResources(b.engine, P1), 2, "cost 2");
  assert.equal(zoneOf(b.engine, b.id("suit")), "discard");
});

clause(SKIN_SUIT, "0:ability", "cost 2 and threshold [R][R][R][R]: one resource is too few, six resources with only three [R] fail, four [R] work", () => {
  const poor = suitBoard({ rage: 1 });
  refused(() => playSuit(poor), "cost 2 with one resource");
  assert.equal(zoneOf(poor.engine, poor.id("suit")), "hand");
  const noThreshold = suitBoard({ rage: 3, greed: 3 });
  refused(() => playSuit(noThreshold), "six resources but only three [R] icons");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("suit")), "hand");
  assert.equal(damageOf(noThreshold.engine, noThreshold.id("theirs")), 0);
  const ok = suitBoard({ rage: 4 });
  playSuit(ok);
  assert.equal(zoneOf(ok.engine, ok.id("suit")), "discard");
});

clause(SKIN_SUIT, "0:ability", "X (my character's strength 2) is inflicted on THEIR character and Y (their character's strength 3) on MINE; others are untouched", () => {
  const b = suitBoard();
  playSuit(b);
  assert.equal(damageOf(b.engine, b.id("theirs")), 2, "X = my character's strength 2, to the opponent's character");
  assert.equal(damageOf(b.engine, b.id("mine")), 3, "Y = their character's strength 3, to mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  assert.equal(damageOf(b.engine, b.id("mine2")), 0);
  assert.equal(damageOf(b.engine, b.id("theirs2")), 0);
});

clause(SKIN_SUIT, "0:ability", "the picks are free: a different pair (strengths 1 and 1) is hit for 1 each", () => {
  const b = suitBoard();
  playSuit(b, "mine2", "theirs2");
  assert.equal(damageOf(b.engine, b.id("theirs2")), 1);
  assert.equal(damageOf(b.engine, b.id("mine2")), 1);
  assert.equal(damageOf(b.engine, b.id("mine")), 0);
  assert.equal(damageOf(b.engine, b.id("theirs")), 0);
});

clause(SKIN_SUIT, "0:ability", "neither destroyed: nothing is removed from the game and no rules text is gained", () => {
  const b = suitBoard({ mine: character({ name: "Mine", strength: 2, life: 9 }), theirs: zapper("Zap Theirs", 3, 9) });
  playSuit(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  refused(() => activate(b.engine, P1, b.id("mine"), "zap"), "my character did not gain the other's ability", /./);
  assert.equal(handOf(b.engine, P1).length, 1, "no card drawn (only the hand guy is in hand)");
});

clause(SKIN_SUIT, "0:ability", "both destroyed by the damage: neither is removed from the game, both go to their discard piles", () => {
  const b = suitBoard({ mine: character({ name: "Mine", strength: 4, life: 3 }), theirs: character({ name: "Theirs", strength: 3, life: 4 }) });
  playSuit(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "Y = 3 destroys my 3-life character");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "discard", "X = 4 destroys their 4-life character");
});

clause(SKIN_SUIT, "0:ability", "only THEIR character destroyed: it is removed from the game (not the discard pile); mine survives with the damage", () => {
  const b = suitBoard({ mine: character({ name: "Mine", strength: 3, life: 9 }), theirs: character({ name: "Theirs", strength: 2, life: 3 }) });
  playSuit(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed", "exactly lethal X = 3 on 3 life, removed instead");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(damageOf(b.engine, b.id("mine")), 2, "Y = 2 inflicted on the survivor");
  assert.ok(!b.engine.state.players[P2].discard.includes(b.id("theirs")), "not in the discard pile");
});

clause(SKIN_SUIT, "0:ability", "only MY character destroyed: it is removed from the game; theirs survives with the damage", () => {
  const b = suitBoard({ mine: character({ name: "Mine", strength: 2, life: 3 }), theirs: character({ name: "Theirs", strength: 5, life: 9 }) });
  playSuit(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "removed", "Y = 5 destroys my 3-life character, removed instead");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  assert.equal(damageOf(b.engine, b.id("theirs")), 2, "X = 2 inflicted on the survivor");
  assert.ok(!b.engine.state.players[P1].discard.includes(b.id("mine")), "not in the discard pile");
});

clause(SKIN_SUIT, "0:ability", "'remove it instead' replaces the destruction: its 'when destroyed' trigger does not fire (but fires when BOTH are destroyed)", () => {
  const dying = (name: string, strength: number, life: number): CardDefinition =>
    character({
      name,
      strength,
      life,
      behavior: { abilities: [{ id: "last", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] }] }
    });
  // Only theirs destroyed: removed instead, so no destroyed trigger (it would cost ME 3 influence).
  const removed = suitBoard({ mine: character({ name: "Mine", strength: 3, life: 9 }), theirs: dying("Theirs", 2, 3) });
  const influence = influenceOf(removed.engine, P1);
  playSuit(removed);
  assert.equal(zoneOf(removed.engine, removed.id("theirs")), "removed");
  assert.equal(influenceOf(removed.engine, P1), influence, "no 'when destroyed' trigger: the card was removed instead");
  // Control: both destroyed, so the trigger does fire.
  const both = suitBoard({ mine: character({ name: "Mine", strength: 4, life: 3 }), theirs: dying("Theirs", 3, 4) });
  const bothInfluence = influenceOf(both.engine, P1);
  playSuit(both);
  assert.equal(zoneOf(both.engine, both.id("theirs")), "discard");
  assert.equal(influenceOf(both.engine, P1), bothInfluence - 3, "control: destroyed normally, the trigger fires");
});

clause(SKIN_SUIT, "0:ability", "the survivor gains the removed character's ACTIVATED ability (and keeps it past this turn)", () => {
  const b = suitBoard({ mine: character({ name: "Mine", strength: 3, life: 9 }), theirs: zapper("Zap Theirs", 2, 3) });
  playSuit(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed");
  const before = handOf(b.engine, P1).length;
  activate(b.engine, P1, b.id("mine"), "zap");
  assert.equal(handOf(b.engine, P1).length, before + 1, "my character used the gained ability");
  // ...still there on my next turn.
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  const later = handOf(b.engine, P1).length;
  activate(b.engine, P1, b.id("mine"), "zap");
  assert.equal(handOf(b.engine, P1).length, later + 1, "the gained text lasts");
});

clause(SKIN_SUIT, "0:ability", "the survivor gains the removed character's TRIGGERED ability", () => {
  const attackDrawer = character({
    name: "Attack Drawer",
    strength: 2,
    life: 3,
    behavior: { abilities: [{ id: "onattack", type: "triggered", event: "characterAttacked", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const b = suitBoard({ mine: character({ name: "Mine", strength: 3, life: 9 }), theirs: attackDrawer });
  playSuit(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed");
  const before = handOf(b.engine, P1).length;
  declareAttackBy(b.engine, P1, [b.id("mine")]);
  assert.equal(handOf(b.engine, P1).length, before + 1, "my character drew when it attacked");
});

clause(SKIN_SUIT, "0:ability", "the survivor gains the removed character's CONTINUOUS text (+2 strength to itself)", () => {
  const bulky = character({
    name: "Bulky",
    strength: 2,
    life: 3,
    behavior: { abilities: [{ id: "bulk", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }] }] }
  });
  const b = suitBoard({ mine: character({ name: "Mine", strength: 3, life: 9 }), theirs: bulky });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
  playSuit(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 5, "3 + the gained +2");
});

clause(SKIN_SUIT, "0:ability", "the survivor gains the removed character's KEYWORD (COVERT)", () => {
  const sneaky = character({ name: "Sneaky", strength: 2, life: 3, behavior: { keywords: ["covert"] } });
  const b = suitBoard({ mine: character({ name: "Mine", strength: 3, life: 9 }), theirs: sneaky });
  assert.equal(b.engine.hasKeyword(b.id("mine"), "covert"), false);
  playSuit(b);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "removed");
  assert.equal(b.engine.hasKeyword(b.id("mine"), "covert"), true);
});

clause(SKIN_SUIT, "0:ability", "when MY character is removed, THEIR surviving character gains its text and its controller can use it", () => {
  const b = suitBoard({ mine: zapper("Zap Mine", 2, 3), theirs: character({ name: "Theirs", strength: 5, life: 9 }) });
  playSuit(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "removed");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  endTurn(b.engine, P1);
  const before = handOf(b.engine, P2).length;
  activate(b.engine, P2, b.id("theirs"), "zap");
  assert.equal(handOf(b.engine, P2).length, before + 1, "the opponent's character drew with my removed character's ability");
});

clause(SKIN_SUIT, "0:ability", "Pick a character you control / your opponent controls: the sides cannot be swapped, and nothing else can be picked", () => {
  const b = suitBoard();
  const sel = (mine: CardInstanceId[], theirs: CardInstanceId[]) => () => play(b.engine, P1, b.id("suit"), { selected: { mine, theirs } });
  refused(sel([b.id("theirs")], [b.id("theirs2")]), "an opposing character as 'mine'");
  refused(sel([b.id("mine")], [b.id("mine2")]), "my own character as 'theirs'");
  refused(sel([b.id("myItem")], [b.id("theirs")]), "an item as 'mine'");
  refused(sel([b.id("mine")], [b.id("foeItem")]), "an item as 'theirs'");
  refused(sel([b.id("mine")], [b.id("foeLoc")]), "a location as 'theirs'");
  refused(sel([factionOf(b.engine, P1)], [b.id("theirs")]), "my faction as 'mine'");
  refused(sel([b.id("mine")], [factionOf(b.engine, P2)]), "their faction as 'theirs'");
  refused(sel([b.id("myHandGuy")], [b.id("theirs")]), "a character in my hand as 'mine'");
  refused(sel([b.id("mine")], [b.id("foeHandGuy")]), "a character in their hand as 'theirs'");
  refused(sel([b.id("mine")], [b.id("foeGone")]), "a character in their discard pile as 'theirs'");
  refused(sel([], [b.id("theirs")]), "no pick for 'mine'");
  refused(sel([b.id("mine")], []), "no pick for 'theirs'");
  assert.equal(zoneOf(b.engine, b.id("suit")), "hand");
  assert.equal(readyResources(b.engine, P1), 4, "nothing was paid by any refused play");
  assert.equal(damageOf(b.engine, b.id("theirs")), 0);
  sel([b.id("mine2")], [b.id("theirs2")])();
  assert.equal(zoneOf(b.engine, b.id("suit")), "discard", "control: a legal pair works");
});

clause(SKIN_SUIT, "0:ability", "a depleted character can be picked on either side", () => {
  const b = suitBoard({
    extra: [
      { key: "tiredMine", def: character({ name: "Tired Mine", strength: 1, life: 9 }), owner: P1, zone: "play", depleted: true },
      { key: "tiredTheirs", def: character({ name: "Tired Theirs", strength: 1, life: 9 }), owner: P2, zone: "play", depleted: true }
    ]
  });
  playSuit(b, "tiredMine", "tiredTheirs");
  assert.equal(damageOf(b.engine, b.id("tiredMine")), 1);
  assert.equal(damageOf(b.engine, b.id("tiredTheirs")), 1);
});

clause(SKIN_SUIT, "0:ability", "X (my character's strength) is fixed when the cost is paid: a response buffing it does not change X", () => {
  const b = suitBoard({
    mine: character({ name: "Mine", strength: 2, life: 9 }),
    theirs: character({ name: "Theirs", strength: 3, life: 9 }),
    extra: [{ key: "boost", def: buffTactic("Boost", 3), owner: P2, zone: "hand" }]
  });
  playRaw(b.engine, P1, b.id("suit"), { selected: { mine: [b.id("mine")], theirs: [b.id("theirs")] } });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  playRaw(b.engine, P2, b.id("boost"), { selected: { t: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 5, "the response did buff my character");
  assert.equal(damageOf(b.engine, b.id("theirs")), 2, "X was 2 when the cost was paid");
});

clause(SKIN_SUIT, "0:ability", "Y (their character's strength) is fixed when the cost is paid: a response buffing it does not change Y", () => {
  const b = suitBoard({
    mine: character({ name: "Mine", strength: 2, life: 4 }),
    theirs: character({ name: "Theirs", strength: 3, life: 9 }),
    extra: [{ key: "boost", def: buffTactic("Boost", 3), owner: P2, zone: "hand" }]
  });
  playRaw(b.engine, P1, b.id("suit"), { selected: { mine: [b.id("mine")], theirs: [b.id("theirs")] } });
  playRaw(b.engine, P2, b.id("boost"), { selected: { t: [b.id("theirs")] } });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("theirs"), "strength"), 6, "the response did buff their character");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "Y was 3 when the cost was paid, so my 4-life character survives");
  assert.equal(damageOf(b.engine, b.id("mine")), 3);
});

// =================================================================================
// Tactician Vacation
// Your opponent cannot respond to this card.
// If you played this card in response to a tactic, terminate the tactic. This turn, tactics cannot be played.
// Tactic, warlord, cost 4, threshold [R].
// =================================================================================

const VACATION = "4181e922-7ffb-4c71-aef6-17adf4f006c7";
const NOOP = tactic({ name: "Noop", cost: 0, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });
const TACTICAL_GUY = character({ name: "Tactical Guy", cost: 0, strength: 1, life: 2, speed: 1, behavior: { keywords: ["tactical"] } });
/** A character whose free ability (id `ping`, declaration `t`) deals 1 damage to a chosen character. */
const PINGER = character({
  name: "Pinger",
  strength: 1,
  life: 9,
  behavior: {
    abilities: [
      {
        id: "ping",
        type: "activated",
        costs: [],
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
      }
    ]
  }
});

function vacBoard(o: { active?: Pid; rage?: number; greed?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "vac", def: printing(VACATION), owner: P1, zone: "hand" },
      { key: "noop1", def: NOOP, owner: P1, zone: "hand" },
      { key: "p1hit", def: hitTactic("P1 Hit", 1), owner: P1, zone: "hand" },
      { key: "tg1", def: TACTICAL_GUY, owner: P1, zone: "hand" },
      { key: "cheap", def: character({ name: "Cheap", cost: 0 }), owner: P1, zone: "hand" },
      { key: "noop2", def: NOOP, owner: P2, zone: "hand" },
      { key: "p2hit", def: hitTactic("P2 Hit", 2, 1), owner: P2, zone: "hand" },
      { key: "tg2", def: TACTICAL_GUY, owner: P2, zone: "hand" },
      { key: "newGuy", def: character({ name: "New Guy", cost: 0 }), owner: P2, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5 }), owner: P2, zone: "play" },
      { key: "pinger1", def: PINGER, owner: P1, zone: "play" },
      { key: "pinger2", def: PINGER, owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 8, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", 6, P2),
      ...(o.extra ?? [])
    ]
  });
}

clause(VACATION, "0:rule", "control: an ordinary tactic leaves a response window in which the opponent can respond with a tactic or an ability", () => {
  const a = vacBoard();
  playRaw(a.engine, P1, a.id("noop1"));
  assert.equal(a.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  playRaw(a.engine, P2, a.id("p2hit"), { selected: { t: [a.id("mine")] } });
  resolvePendingResponses(a.engine);
  assert.equal(damageOf(a.engine, a.id("mine")), 2, "their tactic response happened");
  const b = vacBoard();
  playRaw(b.engine, P1, b.id("noop1"));
  activateRaw(b.engine, P2, b.id("pinger2"), "ping", { selected: { t: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(damageOf(b.engine, b.id("mine")), 1, "their ability response happened");
});

clause(VACATION, "0:rule", "the opponent cannot respond to it: no response window opens and it resolves at once", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  assert.equal(engine.state.responseWindow, undefined, "no window for the opponent");
  assert.equal(zoneOf(engine, id("vac")), "discard", "it has already resolved");
});

clause(VACATION, "0:rule", "the opponent cannot respond to it with an ABILITY either (a response is a tactic or an ability)", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  refused(() => activateRaw(engine, P2, id("pinger2"), "ping", { selected: { t: [id("mine")] } }), "no response is possible", /./);
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(VACATION, "0:rule", "played in response to the opponent's action, they still cannot respond to the Vacation", () => {
  const { engine, id } = vacBoard({ active: P2 });
  playRaw(engine, P2, id("noop2"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to their tactic");
  playRaw(engine, P1, id("vac"));
  refused(() => activateRaw(engine, P2, id("pinger2"), "ping", { selected: { t: [id("mine")] } }), "they cannot respond to the Vacation with an ability", /./);
  refused(() => playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } }), "they cannot respond to the Vacation with a tactic", /./);
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0);
});

clause(VACATION, "1:rule", "played in response to a tactic: that tactic is terminated (no damage), goes to its owner's discard pile, and its cost stays paid", () => {
  const { engine, id } = vacBoard({ active: P2 });
  const before = readyResources(engine, P2);
  playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } });
  assert.equal(before - readyResources(engine, P2), 1, "their tactic cost 1");
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the tactic had no effect");
  assert.equal(zoneOf(engine, id("p2hit")), "discard", "a terminated card goes to its owner's discard pile");
  assert.ok(engine.state.players[P2].discard.includes(id("p2hit")), "engine.state.players[P2].discard.includes(id(\"p2hit\"))");
  assert.equal(before - readyResources(engine, P2), 1, "its cost stays paid");
  assert.equal(zoneOf(engine, id("vac")), "discard");
});

clause(VACATION, "1:rule", "control: without the Vacation the same tactic does hit", () => {
  const { engine, id } = vacBoard({ active: P2 });
  playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } });
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 2);
});

clause(VACATION, "1:rule", "only THAT tactic is terminated: a tactic played earlier in the chain still resolves afterwards", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("p1hit"), { selected: { t: [id("foe")] } });
  playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } });
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 0, "the tactic Vacation responded to has no effect");
  assert.equal(zoneOf(engine, id("p2hit")), "discard");
  assert.equal(damageOf(engine, id("foe")), 1, "my own earlier tactic, lower in the chain, still resolves");
  assert.equal(zoneOf(engine, id("p1hit")), "discard");
});

clause(VACATION, "1:rule", "in response to an ABILITY (not a tactic) the ability still resolves", () => {
  const { engine, id } = vacBoard({ active: P2 });
  activateRaw(engine, P2, id("pinger2"), "ping", { selected: { t: [id("mine")] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("mine")), 1, "the ability was not a tactic, so it was not terminated");
});

clause(VACATION, "1:rule", "in response to a character being deployed it does not stop the character", () => {
  const { engine, id } = vacBoard({ active: P2 });
  playRaw(engine, P2, id("newGuy"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("vac"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("newGuy")), "play");
});

clause(VACATION, "1:rule", "played with nothing to respond to on my own turn: nothing is terminated and it resolves", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  assert.equal(zoneOf(engine, id("vac")), "discard");
  assert.equal(damageOf(engine, id("mine")), 0);
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(VACATION, "1:rule", "this turn, tactics cannot be played: not by me on my own turn", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  refused(() => playRaw(engine, P1, id("noop1")), "my own tactic", /./);
  refused(() => playRaw(engine, P1, id("p1hit"), { selected: { t: [id("foe")] } }), "my own damaging tactic", /./);
  assert.equal(zoneOf(engine, id("noop1")), "hand");
  assert.equal(damageOf(engine, id("foe")), 0);
  // control: before any Vacation the same tactic is playable
  const control = vacBoard();
  playRaw(control.engine, P1, control.id("noop1"));
  resolvePendingResponses(control.engine);
  assert.equal(zoneOf(control.engine, control.id("noop1")), "discard");
});

clause(VACATION, "1:rule", "this turn, tactics cannot be played: not by the OPPONENT either (in response to my next action)", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  playRaw(engine, P1, id("cheap"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "they may respond to a character");
  refused(() => playRaw(engine, P2, id("noop2")), "a tactic is not allowed", /./);
  refused(() => playRaw(engine, P2, id("p2hit"), { selected: { t: [id("mine")] } }), "a damaging tactic is not allowed", /./);
  assert.equal(zoneOf(engine, id("noop2")), "hand");
  assert.equal(damageOf(engine, id("mine")), 0);
  // control: without the Vacation they can respond with a tactic
  const control = vacBoard();
  playRaw(control.engine, P1, control.id("cheap"));
  playRaw(control.engine, P2, control.id("noop2"));
  resolvePendingResponses(control.engine);
  assert.equal(zoneOf(control.engine, control.id("noop2")), "discard");
});

clause(VACATION, "1:rule", "this turn, tactics cannot be played: also in the opponent's response window during my attack", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  declareAttackOpenWindow(engine, P1, [id("mine")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "they hold priority after my attack");
  refused(() => playRaw(engine, P2, id("noop2")), "no tactics in the battle window", /./);
  assert.equal(zoneOf(engine, id("noop2")), "hand");
  const control = vacBoard();
  declareAttackOpenWindow(control.engine, P1, [control.id("mine")]);
  playRaw(control.engine, P2, control.id("noop2"));
  resolvePendingResponses(control.engine);
  assert.equal(zoneOf(control.engine, control.id("noop2")), "discard", "control: without the Vacation they can");
});

clause(VACATION, "1:rule", "this turn, a TACTICAL card cannot be played as a response either (FAQ: the window for tactics is closed for the whole turn)", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  playRaw(engine, P1, id("cheap"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2);
  refused(() => playRaw(engine, P2, id("tg2")), "the tactics window is closed for the whole turn", /./);
  assert.equal(zoneOf(engine, id("tg2")), "hand");
  const control = vacBoard();
  playRaw(control.engine, P1, control.id("cheap"));
  playRaw(control.engine, P2, control.id("tg2"));
  resolvePendingResponses(control.engine);
  assert.equal(zoneOf(control.engine, control.id("tg2")), "play", "control: without the Vacation the TACTICAL character is a legal response");
});

clause(VACATION, "1:rule", "a TACTICAL character can still be deployed the normal way in my main phase after the Vacation (FAQ)", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  playRaw(engine, P1, id("tg1"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("tg1")), "play");
});

clause(VACATION, "1:rule", "only tactics are barred: abilities can still be used the rest of the turn", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  activate(engine, P1, id("pinger1"), "ping", { selected: { t: [id("foe")] } });
  assert.equal(damageOf(engine, id("foe")), 1);
});

clause(VACATION, "1:rule", "'this turn' ends: on the next turn both players can play tactics again", () => {
  const { engine, id } = vacBoard();
  playRaw(engine, P1, id("vac"));
  refused(() => playRaw(engine, P1, id("noop1")), "still this turn", /./);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  playRaw(engine, P2, id("noop2"));
  assert.notEqual(zoneOf(engine, id("noop2")), "hand", "they can play a tactic on their turn");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("noop1"));
  assert.notEqual(zoneOf(engine, id("noop1")), "hand", "and I can respond with one");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("noop2")), "discard");
  assert.equal(zoneOf(engine, id("noop1")), "discard");
});

clause(VACATION, "1:rule", "cost 4 and threshold [R]: three resources are too few, four [G] have no [R], one [R] among four works", () => {
  const poor = vacBoard({ rage: 3 });
  refused(() => playRaw(poor.engine, P1, poor.id("vac")), "cost 4 with three resources");
  assert.equal(zoneOf(poor.engine, poor.id("vac")), "hand");
  const noRage = vacBoard({ rage: 0, greed: 4 });
  refused(() => playRaw(noRage.engine, P1, noRage.id("vac")), "no [R] icon");
  assert.equal(zoneOf(noRage.engine, noRage.id("vac")), "hand");
  const ok = vacBoard({ rage: 1, greed: 3 });
  const before = readyResources(ok.engine, P1);
  playRaw(ok.engine, P1, ok.id("vac"));
  assert.equal(zoneOf(ok.engine, ok.id("vac")), "discard");
  assert.equal(before - readyResources(ok.engine, P1), 4);
});

// =================================================================================
// Thundering Nilpha
// While this card is attacking a location, it gains 1 strength and cannot be blocked.
// Character, warlord, subtype dragon, cost 5, threshold [R], 4/3/3 (str / spd / life).
// =================================================================================

const NILPHA = "70d2df5e-43c5-43d7-a8ce-5b2c95097f61";

function nilphaBoard(o: { structure?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  const foe: Pid = active === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    cards: [
      { key: "nilpha", def: printing(NILPHA), owner: active, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 9, speed: 1 }), owner: active, zone: "play" },
      { key: "fort", def: location({ name: "Fort", structure: o.structure ?? 9 }), owner: foe, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 9, speed: 1 }), owner: foe, zone: "play" },
      { key: "blocker2", def: character({ name: "Blocker Two", strength: 1, life: 9, speed: 1 }), owner: foe, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

const atFort = (b: ReturnType<typeof nilphaBoard>) => ({ type: "card" as const, cardId: b.id("fort") });

clause(NILPHA, "0:rule", "deploys from hand for the printed cost 5 and threshold [R], with printed stats 4 / 3 / 3", () => {
  const cards = (rage: number, greed: number): CardPlacement[] => [
    { key: "nilpha", def: printing(NILPHA), owner: P1, zone: "hand" },
    ...bank("rage", rage, P1),
    ...bank("greed", greed, P1)
  ];
  const short = buildGame({ playerA: { faction: developFaction() }, cards: cards(4, 0) });
  refused(() => play(short.engine, P1, short.id("nilpha")), "cost 5 with 4 resources");
  const noRage = buildGame({ playerA: { faction: developFaction() }, cards: cards(0, 5) });
  refused(() => play(noRage.engine, P1, noRage.id("nilpha")), "no [R] icon");
  assert.equal(zoneOf(noRage.engine, noRage.id("nilpha")), "hand");
  const ok = buildGame({ playerA: { faction: developFaction() }, cards: cards(1, 4) });
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("nilpha"));
  assert.equal(zoneOf(ok.engine, ok.id("nilpha")), "play");
  assert.equal(before - readyResources(ok.engine, P1), 5);
  assert.deepEqual([ok.engine.getStat(ok.id("nilpha"), "strength"), ok.engine.getStat(ok.id("nilpha"), "speed"), ok.engine.getStat(ok.id("nilpha"), "life")], [4, 3, 3]);
});

clause(NILPHA, "0:rule", "attacking a location: it has 5 strength (4 + 1), cannot be blocked, and inflicts 5 damage to the location", () => {
  const b = nilphaBoard();
  assert.equal(b.engine.getStat(b.id("nilpha"), "strength"), 4, "4 before attacking");
  declareAttackBy(b.engine, P1, [b.id("nilpha")], atFort(b));
  assert.ok(battleOf(b.engine), "the battle is on");
  assert.equal(b.engine.getStat(b.id("nilpha"), "strength"), 5, "gains 1 strength while attacking a location");
  refused(() => declareBlockers(b.engine, P2, [b.id("blocker")]), "it cannot be blocked");
  refused(() => declareBlockers(b.engine, P2, [b.id("blocker"), b.id("blocker2")]), "not even by a blocking party");
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("fort")), 5, "5 damage to the location");
  assert.equal(damageOf(b.engine, b.id("nilpha")), 0);
  assert.equal(damageOf(b.engine, b.id("blocker")), 0);
});

clause(NILPHA, "0:rule", "the bonus ends with the battle: strength is 4 again afterwards", () => {
  const b = nilphaBoard();
  declareAttackBy(b.engine, P1, [b.id("nilpha")], atFort(b));
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(b.engine.getStat(b.id("nilpha"), "strength"), 4);
});

clause(NILPHA, "0:rule", "attacking a FACTION instead: strength stays 4 and it can be blocked", () => {
  const blocked = nilphaBoard();
  declareAttackBy(blocked.engine, P1, [blocked.id("nilpha")]);
  assert.equal(blocked.engine.getStat(blocked.id("nilpha"), "strength"), 4, "no bonus against a faction");
  declareBlockers(blocked.engine, P2, [blocked.id("blocker")]);
  finishBattle(blocked.engine);
  assert.equal(damageOf(blocked.engine, blocked.id("blocker")), 4, "the blocker took Nilpha's 4 strength");
  const unblocked = nilphaBoard();
  const before = influenceOf(unblocked.engine, P2);
  declareAttackBy(unblocked.engine, P1, [unblocked.id("nilpha")]);
  declareBlockers(unblocked.engine, P2, []);
  finishBattle(unblocked.engine);
  assert.equal(before - influenceOf(unblocked.engine, P2), 4, "4 damage to the faction");
});

clause(NILPHA, "0:rule", "only while ATTACKING a location: a Nilpha that blocks an attack on a location does not gain strength", () => {
  const b = nilphaBoard({
    extra: [{ key: "defNilpha", def: printing(NILPHA), owner: P2, zone: "play" }]
  });
  declareAttackBy(b.engine, P1, [b.id("ally")], atFort(b));
  declareBlockers(b.engine, P2, [b.id("defNilpha")]);
  assert.equal(b.engine.getStat(b.id("defNilpha"), "strength"), 4, "blocking is not attacking");
  assert.equal(b.engine.getStat(b.id("nilpha"), "strength"), 4, "a Nilpha that stayed home is unaffected");
  finishBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("ally")), 4, "the blocking Nilpha hit for 4");
});

clause(NILPHA, "0:rule", "in a party with another attacker: Nilpha still gains 1 strength, the ally does not, and the party (not all unblockable) can be blocked", () => {
  const b = nilphaBoard();
  declareAttackBy(b.engine, P1, [b.id("nilpha"), b.id("ally")], atFort(b));
  assert.equal(b.engine.getStat(b.id("nilpha"), "strength"), 5);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 1, "the ally gains nothing");
  declareBlockers(b.engine, P2, [b.id("blocker")]);
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("fort")), "play");
});

clause(NILPHA, "0:rule", "a party made only of unblockable characters (two Nilphas at a location) cannot be blocked, and deals 5 + 5 damage", () => {
  const b = nilphaBoard({
    structure: 12,
    extra: [{ key: "nilpha2", def: printing(NILPHA), owner: P1, zone: "play" }]
  });
  declareAttackBy(b.engine, P1, [b.id("nilpha"), b.id("nilpha2")], atFort(b));
  assert.equal(b.engine.getStat(b.id("nilpha"), "strength"), 5);
  assert.equal(b.engine.getStat(b.id("nilpha2"), "strength"), 5);
  refused(() => declareBlockers(b.engine, P2, [b.id("blocker")]), "every member of the party cannot be blocked");
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("fort")), 10);
});

clause(NILPHA, "0:rule", "the same holds for the other player's Nilpha attacking my location", () => {
  const b = nilphaBoard({ active: P2 });
  declareAttackBy(b.engine, P2, [b.id("nilpha")], { type: "card", cardId: b.id("fort") });
  assert.equal(b.engine.getStat(b.id("nilpha"), "strength"), 5);
  refused(() => declareBlockers(b.engine, P1, [b.id("blocker")]), "it cannot be blocked");
  declareBlockers(b.engine, P1, []);
  finishBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("fort")), 5);
});

// =================================================================================
// Wyrmfang Deathskull
// UNIQUE WYRMFANG
// If you attack, your opponent picks any number of characters they control. Those characters must block during
// this battle if they can, and only those characters can block.
// Character, warlord, subtype dragon, cost 7, threshold [R][R][R][R], 6/3/6 (str / spd / life).
// =================================================================================

const WYRMFANG = "97177f3a-80ff-480f-a12e-385472acf43b";

function wyrmBoard(o: { active?: Pid; foes?: boolean; extra?: CardPlacement[] } = {}) {
  const foes = o.foes !== false;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "wyrm", def: printing(WYRMFANG), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      ...(foes
        ? [
            { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" as const },
            { key: "b2", def: character({ name: "B2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" as const },
            { key: "b3", def: character({ name: "B3", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" as const },
            { key: "tired", def: character({ name: "Tired", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" as const, depleted: true }
          ]
        : []),
      { key: "foeItem", def: item({ name: "Foe Item" }), owner: P2, zone: "play" },
      { key: "fort", def: location({ name: "Fort", structure: 30 }), owner: P2, zone: "play" },
      { key: "foeHandGuy", def: character({ name: "Foe Hand Guy", life: 9 }), owner: P2, zone: "hand" },
      { key: "foeGone", def: character({ name: "Foe Gone", life: 9 }), owner: P2, zone: "discard" },
      ...(o.extra ?? [])
    ]
  });
}

type WBoard = ReturnType<typeof wyrmBoard>;
/** Wyrmfang attacks the opponent's faction; the opponent's pick is now pending. */
const wyrmAttacks = (b: WBoard, attackers = ["wyrm"], target?: { type: "card"; cardId: CardInstanceId }) => {
  declareAttackBy(b.engine, P1, attackers.map((k) => b.id(k)), target);
  assert.equal(pending(b.engine)?.kind, "chooseChosenBlockers", "the opponent is asked to pick blockers");
};
const pick = (b: WBoard, keys: string[]) => answerPending(b.engine, "chooseChosenBlockers", { cardIds: keys.map((k) => b.id(k)) });
const blockWith = (b: WBoard, keys: string[]) => () => declareBlockers(b.engine, P2, keys.map((k) => b.id(k)));

clause(WYRMFANG, "0:unique", "deploys from hand for the printed cost 7 and threshold [R][R][R][R], with printed stats 6 / 3 / 6", () => {
  const cards = (rage: number, greed: number): CardPlacement[] => [
    { key: "wyrm", def: printing(WYRMFANG), owner: P1, zone: "hand" },
    ...bank("rage", rage, P1),
    ...bank("greed", greed, P1)
  ];
  const short = buildGame({ playerA: { faction: developFaction() }, cards: cards(6, 0) });
  refused(() => play(short.engine, P1, short.id("wyrm")), "cost 7 with 6 resources");
  const noThreshold = buildGame({ playerA: { faction: developFaction() }, cards: cards(3, 4) });
  refused(() => play(noThreshold.engine, P1, noThreshold.id("wyrm")), "only three [R] icons of [R][R][R][R]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("wyrm")), "hand");
  const ok = buildGame({ playerA: { faction: developFaction() }, cards: cards(4, 3) });
  const before = readyResources(ok.engine, P1);
  play(ok.engine, P1, ok.id("wyrm"));
  assert.equal(zoneOf(ok.engine, ok.id("wyrm")), "play");
  assert.equal(before - readyResources(ok.engine, P1), 7);
  assert.deepEqual([ok.engine.getStat(ok.id("wyrm"), "strength"), ok.engine.getStat(ok.id("wyrm"), "speed"), ok.engine.getStat(ok.id("wyrm"), "life")], [6, 3, 6]);
});

clause(WYRMFANG, "0:unique", "a second Wyrmfang Deathskull under my control: I choose which to keep", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "wyrm", def: printing(WYRMFANG), owner: P1, zone: "play" },
      { key: "wyrm2", def: printing(WYRMFANG), owner: P1, zone: "hand" },
      { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      ...bank("rage", 7, P1)
    ]
  });
  play(engine, P1, id("wyrm2"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("wyrm"), id("wyrm2")].sort());
  refused(() => answerPending(engine, "uniqueSurvivor", { keep: id("bystander") }), "a bystander is not a copy", /./);
  answerPending(engine, "uniqueSurvivor", { keep: id("wyrm") });
  assert.equal(zoneOf(engine, id("wyrm")), "play");
  assert.equal(zoneOf(engine, id("wyrm2")), "discard", "the other copy is destroyed");
  assert.equal(zoneOf(engine, id("bystander")), "play");
});

clause(WYRMFANG, "0:unique", "UNIQUE is per player (the opponent may control their own), and a different UNIQUE identifier (Rudo's) does not conflict", () => {
  const per = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "wyrm", def: printing(WYRMFANG), owner: P1, zone: "play" },
      { key: "wyrm2", def: printing(WYRMFANG), owner: P2, zone: "hand" },
      ...bank("rage", 7, P2)
    ]
  });
  play(per.engine, P2, per.id("wyrm2"));
  assert.equal(pending(per.engine), undefined, "no survivor choice");
  assert.equal(zoneOf(per.engine, per.id("wyrm")), "play");
  assert.equal(zoneOf(per.engine, per.id("wyrm2")), "play");
  const other = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "wyrm", def: printing(WYRMFANG), owner: P1, zone: "play" },
      { key: "rudo", def: printing(RUDO), owner: P1, zone: "hand" },
      ...bank("rage", 5, P1)
    ]
  });
  play(other.engine, P1, other.id("rudo"));
  assert.equal(pending(other.engine), undefined);
  assert.equal(zoneOf(other.engine, other.id("wyrm")), "play");
  assert.equal(zoneOf(other.engine, other.id("rudo")), "play");
});

clause(WYRMFANG, "1:rule", "when Wyrmfang attacks, the OPPONENT picks, from exactly the characters they control (not mine, items, locations, face-down resources, hands or discard)", () => {
  const b = wyrmBoard({ extra: [...volition(1, P2)] });
  wyrmAttacks(b);
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.playerId, P2, "my opponent makes the pick, not me");
  assert.deepEqual([...pc.candidates].sort(), [b.id("b1"), b.id("b2"), b.id("b3"), b.id("tired")].sort());
  refused(() => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooseChosenBlockers", cardIds: [] } } as never), "I do not make their pick", /./);
  for (const bad of ["ally", "wyrm", "foeItem", "fort", "foeHandGuy", "foeGone"]) {
    refused(() => pick(b, [bad]), `${bad} is not a character they control in play`, /./);
  }
  assert.equal(pending(b.engine)?.kind, "chooseChosenBlockers", "still waiting for a valid pick");
  pick(b, ["b1"]);
  assert.equal(pending(b.engine), undefined);
});

clause(WYRMFANG, "1:rule", "picked b1 and b2: both must block (declaring none, one of them, or all three is refused) and only those two may — declaring exactly them works", () => {
  const b = wyrmBoard();
  wyrmAttacks(b);
  pick(b, ["b1", "b2"]);
  refused(blockWith(b, []), "picked characters must block if they can");
  refused(blockWith(b, ["b1"]), "b2 must block too");
  refused(blockWith(b, ["b2"]), "b1 must block too");
  refused(blockWith(b, ["b1", "b2", "b3"]), "b3 was not picked, so it cannot block");
  refused(blockWith(b, ["b3"]), "b3 was not picked");
  refused(blockWith(b, ["b1", "b3"]), "b2 must block and b3 cannot");
  blockWith(b, ["b1", "b2"])();
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("wyrm")), "play");
  assert.equal(damageOf(b.engine, b.id("wyrm")), 2, "both blockers hit Wyrmfang for 1");
});

clause(WYRMFANG, "1:rule", "picking nobody: nobody can block, so the attack goes through", () => {
  const b = wyrmBoard();
  const before = influenceOf(b.engine, P2);
  wyrmAttacks(b);
  pick(b, []);
  refused(blockWith(b, ["b1"]), "nobody was picked, so nobody can block");
  refused(blockWith(b, ["b1", "b2", "b3"]), "nobody was picked");
  blockWith(b, [])();
  finishBattle(b.engine);
  assert.equal(before - influenceOf(b.engine, P2), 6, "Wyrmfang's 6 strength hit the faction");
});

clause(WYRMFANG, "1:rule", "picking all three characters: all three must block", () => {
  const b = wyrmBoard();
  wyrmAttacks(b);
  pick(b, ["b1", "b2", "b3"]);
  refused(blockWith(b, ["b1", "b2"]), "b3 must block too");
  refused(blockWith(b, []), "all must block");
  blockWith(b, ["b1", "b2", "b3"])();
  finishBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("wyrm")), 3, "all three blockers hit Wyrmfang");
});

clause(WYRMFANG, "1:rule", "'if they can': a picked depleted character cannot block, so it is not forced to (and nobody else may block)", () => {
  const b = wyrmBoard();
  wyrmAttacks(b);
  pick(b, ["b1", "tired"]);
  refused(blockWith(b, []), "b1 can block, so it must");
  refused(blockWith(b, ["b1", "b2"]), "b2 was not picked");
  blockWith(b, ["b1"])();
  finishBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("wyrm")), 1);
  // Picking only the depleted character: nobody can block, and declaring no block is fine.
  const only = wyrmBoard();
  wyrmAttacks(only);
  pick(only, ["tired"]);
  refused(blockWith(only, ["b1"]), "b1 was not picked");
  blockWith(only, [])();
  finishBattle(only.engine);
  assert.equal(zoneOf(only.engine, only.id("wyrm")), "play");
});

clause(WYRMFANG, "1:rule", "an attack on a LOCATION triggers it too", () => {
  const b = wyrmBoard();
  wyrmAttacks(b, ["wyrm"], { type: "card", cardId: b.id("fort") });
  pick(b, ["b2"]);
  refused(blockWith(b, []), "b2 must block");
  refused(blockWith(b, ["b1"]), "only b2 may block");
  blockWith(b, ["b2"])();
  finishBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("fort")), 0, "blocked, so the location took nothing");
  assert.equal(damageOf(b.engine, b.id("b2")), 6, "Wyrmfang's strength hit the blocker");
});

clause(WYRMFANG, "1:rule", "Wyrmfang attacking in a party with another character: the pick still applies to the whole battle", () => {
  const b = wyrmBoard();
  wyrmAttacks(b, ["wyrm", "ally"]);
  pick(b, ["b3"]);
  refused(blockWith(b, ["b1"]), "only b3 may block");
  refused(blockWith(b, []), "b3 must block");
  blockWith(b, ["b3"])();
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("wyrm")), "play");
});

clause(WYRMFANG, "1:rule", "it is per battle: next turn's attack asks for a fresh pick and the earlier one does not carry over", () => {
  const b = wyrmBoard();
  wyrmAttacks(b);
  pick(b, ["b1"]);
  blockWith(b, ["b1"])();
  finishBattle(b.engine);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  wyrmAttacks(b);
  pick(b, ["b3"]);
  refused(blockWith(b, ["b1"]), "this time only b3 may block");
  blockWith(b, ["b3"])();
  finishBattle(b.engine);
  assert.ok(damageOf(b.engine, b.id("b3")) > 0, "b3 took the damage");
});

clause(WYRMFANG, "1:rule", "the opponent attacking me does not trigger it: no pick is asked and I block freely", () => {
  const b = wyrmBoard({ active: P2 });
  declareAttackBy(b.engine, P2, [b.id("b1")]);
  assert.equal(pending(b.engine), undefined, "nobody picks anything");
  declareBlockers(b.engine, P1, [b.id("ally")]);
  finishBattle(b.engine);
});

clause(WYRMFANG, "1:rule", "with no opposing characters, nobody can block and the attack goes through", () => {
  const b = wyrmBoard({ foes: false });
  const before = influenceOf(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("wyrm")]);
  if (pending(b.engine)) pick(b, []);
  assert.equal(pending(b.engine), undefined);
  blockWith(b, [])();
  finishBattle(b.engine);
  assert.equal(before - influenceOf(b.engine, P2), 6);
});

clause(WYRMFANG, "1:rule", "'If YOU attack' (any attack of mine, even without Wyrmfang in the party): my opponent still picks the blockers", () => {
  const b = wyrmBoard();
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  assert.equal(pending(b.engine)?.kind, "chooseChosenBlockers", "I attacked with another character while Wyrmfang is in play");
  pick(b, ["b2"]);
  refused(blockWith(b, ["b1"]), "only b2 may block");
  blockWith(b, ["b2"])();
  finishBattle(b.engine);
});
