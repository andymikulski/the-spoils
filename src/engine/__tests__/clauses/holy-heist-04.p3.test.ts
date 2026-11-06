// Clause tests — batch holy-heist-04, part p3 (groups 15-19, missing clauses). See docs/TESTING.md and
// `npm run card-tests -- manifest holy-heist-04 --groups 15-19 --missing`. Expectations come from each card's
// PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdCostChoices } from "./_clause.js";
import { answerPending, declareBlockers, pending, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { endTurn, factionOf } from "./_turn.js";
import type { CardDefinition, PlayerId, SpoilsEngine } from "../../../engine.js";

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1) => engine.getAvailableResourceCount(player);

/** Raw `activateAbility` WITHOUT draining the response window. */
function activateRaw(engine: SpoilsEngine, player: PlayerId, cardId: string, abilityId: string, selected: Record<string, string[]> = {}) {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);
}

/** Raw `flipUp` WITHOUT draining the response window. */
function flipRaw(engine: SpoilsEngine, player: PlayerId, cardId: string, selected: Record<string, string[]> = {}) {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
}

const influence = (engine: SpoilsEngine, player: PlayerId = P1) => engine.state.players[player].influence;
const stat = (engine: SpoilsEngine, cardId: string) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const typesOf = (engine: SpoilsEngine, cardId: string) => [...engine.getCardTypes(cardId)].sort();
const tokenCount = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId].counters?.token ?? 0;

/** Micromajig tokens a player controls in play. */
const majigs = (engine: SpoilsEngine, player: PlayerId = P1) =>
  engine.state.players[player].play.filter((c) => engine.getDefinition(c).name === "Micromajig" && engine.state.cards[c].controllerId === player);

// ===============================================================================
// Heavy Fists of Robotic Pounding — Item (gear), cost 5, threshold [E]. ATTACH TO CHARACTER.
// The attached character gains 3 strength and 3 life.
// Treat the attached character as though it has no rules text. (This includes abilities.)
// HAND OFF -- COST: Pay 2. Deplete a character you control that is not in a battle.
//   EFFECT: Attach this card to the character.
// ===============================================================================

const FISTS = "5a6b4473-eb1d-4e71-86ee-49f9462d9d35";

/** A character with a keyword, an activated ability (`act`: +3 influence), a self-stat continuous rule, and a triggered rule (+2 influence whenever another character enters play). */
function rulefulCharacter(name: string): CardDefinition {
  return character({
    name,
    strength: 2,
    life: 3,
    speed: 2,
    behavior: {
      keywords: ["covert"],
      abilities: [
        { id: "act", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: 3 }] },
        { id: "bulk", type: "continuous", modifiers: [{ target: "source", stat: "life", operation: "add", value: 2 }] },
        {
          id: "watch",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "not", condition: { type: "sourceIsEventCard" } },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
        }
      ]
    }
  });
}

/** An item-destroying tactic and a character-bouncing tactic. */
const itemKiller = () =>
  tactic({
    name: "ItemKiller",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
const charKiller = () =>
  tactic({
    name: "CharKiller",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
const charBouncer = () =>
  tactic({
    name: "CharBouncer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });

function fistsBoard(opts: { zone?: "hand" | "play"; attachedTo?: string; elitism?: number; greed?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 2,
    cards: [
      { key: "hf", def: printing(FISTS), owner: P1, zone: opts.zone ?? "play", attachedToKey: opts.zone === "hand" ? undefined : opts.attachedTo ?? "holder" },
      { key: "holder", def: character({ name: "Holder", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "ruleA", def: rulefulCharacter("RulefulA"), owner: P1, zone: "play" },
      { key: "ruleB", def: rulefulCharacter("RulefulB"), owner: P1, zone: "play" },
      { key: "foeRule", def: rulefulCharacter("FoeRuleful"), owner: P2, zone: "play" },
      { key: "plainHost", def: character({ name: "PlainHost", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "foePlain", def: character({ name: "FoePlain", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "res", def: resourceCard({ name: "Rage" }), owner: P2, zone: "play" },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      { key: "killItem", def: itemKiller(), owner: P1, zone: "hand" },
      { key: "kill", def: charKiller(), owner: P1, zone: "hand" },
      { key: "bounce", def: charBouncer(), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 8, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}
type FistsGame = ReturnType<typeof fistsBoard>;
const attachedTo = (g: FistsGame) => g.engine.state.cards[g.id("hf")].attachedTo;
const deployFists = (g: FistsGame, host: string) => play(g.engine, P1, g.id("hf"), { selected: { attachTo: [g.id(host)] } });
const handOff = (g: FistsGame, host: string) => activate(g.engine, P1, g.id("hf"), "heavy-fists-handoff", { selected: { hf: [g.id(host)] } });
const handOffRaw = (g: FistsGame, host: string, player: PlayerId = P1) => activateRaw(g.engine, player, g.id("hf"), "heavy-fists-handoff", { hf: [g.id(host)] });

// -- 0:attach -----------------------------------------------------------------

clause(FISTS, "0:attach", "deploys attached to a character you control, paying its printed cost of 5", () => {
  const g = fistsBoard({ zone: "hand" });
  const before = ready(g.engine);
  deployFists(g, "plainHost");
  assert.equal(zoneOf(g.engine, g.id("hf")), "play");
  assert.equal(attachedTo(g), g.id("plainHost"), "attached to the picked character");
  assert.equal(before - ready(g.engine), 5, "cost 5 paid");
  assert.equal(g.engine.state.cards[g.id("ruleA")].attachedTo, undefined);
  assert.equal(g.engine.state.cards[g.id("plainHost")].attachedTo, undefined, "the host is not itself attached to anything");
});

clause(FISTS, "0:attach", "attaches to an opponent's character too (ATTACH TO CHARACTER names no controller) and I keep control of the item", () => {
  const g = fistsBoard({ zone: "hand" });
  deployFists(g, "foePlain");
  assert.equal(attachedTo(g), g.id("foePlain"));
  assert.equal(g.engine.state.cards[g.id("hf")].controllerId, P1);
});

clause(FISTS, "0:attach", "a non-character host is refused: item, location, either faction, face-down card, resource, and characters in hand or discard", () => {
  const g = fistsBoard({ zone: "hand" });
  const attempt = (hostId: string) => () => playRaw(g.engine, P1, g.id("hf"), { selected: { attachTo: [hostId] } });
  refused(attempt(g.id("thing")), "an item");
  refused(attempt(g.id("place")), "a location");
  refused(attempt(factionOf(g.engine, P1)), "my faction");
  refused(attempt(factionOf(g.engine, P2)), "their faction");
  refused(attempt(g.id("fd")), "a face-down card is only a resource");
  refused(attempt(g.id("res")), "a resource");
  refused(attempt(g.id("handChar")), "a character in hand");
  refused(attempt(g.id("discChar")), "a character in the discard pile");
  refused(() => playRaw(g.engine, P1, g.id("hf"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(g.engine, P1, g.id("hf"), { selected: { attachTo: [g.id("ruleA"), g.id("ruleB")] } }), "two hosts");
  assert.equal(zoneOf(g.engine, g.id("hf")), "hand", "nothing was played");
  assert.equal(ready(g.engine), 8, "nothing was paid");
  attempt(g.id("plainHost"))();
  assert.ok(g.engine.state.responseWindow, "control: a character is accepted");
});

clause(FISTS, "0:attach", "cost 5 with [E]: one resource short is refused, and 5 resources without [E] are refused", () => {
  const short = fistsBoard({ zone: "hand", elitism: 4 });
  refused(() => playRaw(short.engine, P1, short.id("hf"), { selected: { attachTo: [short.id("plainHost")] } }), "4 resources for cost 5");
  assert.equal(zoneOf(short.engine, short.id("hf")), "hand");
  const noE = fistsBoard({ zone: "hand", elitism: 0, greed: 6 });
  refused(() => playRaw(noE.engine, P1, noE.id("hf"), { selected: { attachTo: [noE.id("plainHost")] } }), "no [E]");
  assert.equal(zoneOf(noE.engine, noE.id("hf")), "hand");
  const exact = fistsBoard({ zone: "hand", elitism: 1, greed: 4 });
  deployFists(exact, "plainHost");
  assert.equal(attachedTo(exact), exact.id("plainHost"), "one [E] among exactly 5 resources works");
  assert.equal(ready(exact.engine), 0);
});

// -- 1:rule: +3 strength and +3 life ------------------------------------------

clause(FISTS, "1:rule", "the attached character gains 3 strength and 3 life, nothing else (speed unchanged)", () => {
  const g = fistsBoard({ attachedTo: "plainHost" });
  assert.deepEqual(stat(g.engine, g.id("plainHost")), [5, 5, 2], "2/2/2 becomes 5 strength, 5 life, 2 speed");
  assert.deepEqual(stat(g.engine, g.id("foePlain")), [2, 2, 2], "an unequipped character is unchanged");
});

clause(FISTS, "1:rule", "a Fists in play changes no one's stats but its host's", () => {
  const g = fistsBoard();
  assert.equal(attachedTo(g), g.id("holder"));
  assert.deepEqual(stat(g.engine, g.id("plainHost")), [2, 2, 2]);
  assert.deepEqual(stat(g.engine, g.id("foePlain")), [2, 2, 2]);
});

clause(FISTS, "1:rule", "the bonus applies to an opponent's host, and only to it", () => {
  const g = fistsBoard({ attachedTo: "foePlain" });
  assert.deepEqual(stat(g.engine, g.id("foePlain")), [5, 5, 2]);
  assert.deepEqual(stat(g.engine, g.id("plainHost")), [2, 2, 2]);
});

clause(FISTS, "1:rule", "two Fists on one character stack: +6 strength and +6 life", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "hf1", def: printing(FISTS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "hf2", def: printing(FISTS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual(stat(g.engine, g.id("host")), [8, 8, 2]);
});

clause(FISTS, "1:rule", "the bonus is gone once the Fists leave play", () => {
  const g = fistsBoard({ attachedTo: "plainHost" });
  assert.equal(g.engine.getStat(g.id("plainHost"), "strength"), 5);
  play(g.engine, P1, g.id("killItem"), { selected: { t: [g.id("hf")] } });
  assert.equal(zoneOf(g.engine, g.id("hf")), "discard");
  assert.deepEqual(stat(g.engine, g.id("plainHost")), [2, 2, 2]);
  assert.equal(zoneOf(g.engine, g.id("plainHost")), "play");
  // gone again after it has left play
  assert.deepEqual(stat(g.engine, g.id("plainHost")), [2, 2, 2]);
});

clause(FISTS, "1:rule", "the +3/+3 is real life: a 5-life host survives 4 damage and dies at 5", () => {
  const g = fistsBoard({ attachedTo: "plainHost" });
  g.engine.state.cards[g.id("plainHost")].damage = 4;
  assert.equal(g.engine.getStat(g.id("plainHost"), "life") - 4, 1);
  g.engine.state.cards[g.id("plainHost")].damage = 0;
  const un = fistsBoard();
  assert.equal(un.engine.getStat(un.id("plainHost"), "life"), 2, "control: without the Fists life is 2");
});

clause(FISTS, "1:rule", "when the host leaves play the Fists leave with it (an attached card follows its host)", () => {
  const g = fistsBoard({ attachedTo: "plainHost" });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("plainHost")] } });
  assert.equal(zoneOf(g.engine, g.id("plainHost")), "discard");
  assert.equal(zoneOf(g.engine, g.id("hf")), "discard", "the attached Fists leave play with their host");
});

clause(FISTS, "1:rule", "when the host returns to hand the Fists leave play the same way", () => {
  const g = fistsBoard({ attachedTo: "plainHost" });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("plainHost")] } });
  assert.equal(zoneOf(g.engine, g.id("plainHost")), "hand");
  assert.notEqual(zoneOf(g.engine, g.id("hf")), "play", "the Fists no longer sit in play attached to nothing");
});

// -- 2:rule: no rules text ------------------------------------------------------

clause(FISTS, "2:rule", "control: a character without the Fists uses its rules text (keyword, ability, extra life, trigger)", () => {
  const g = fistsBoard();
  assert.ok(g.engine.getKeywords(g.id("ruleA")).includes("covert"), "g.engine.getKeywords(g.id(\"ruleA\")).includes(\"covert\")");
  assert.equal(g.engine.getStat(g.id("ruleA"), "life"), 5, "its own continuous rule: +2 life");
  const before = influence(g.engine);
  activate(g.engine, P1, g.id("ruleA"), "act");
  assert.equal(influence(g.engine) - before, 3, "its ability works");
  const beforeTrig = influence(g.engine);
  play(g.engine, P1, g.id("plain"), {});
  drain(g.engine, declineAll);
  assert.equal(influence(g.engine) - beforeTrig, 4, "both Ruleful characters' triggers fire for the newcomer");
});

clause(FISTS, "2:rule", "the attached character loses its keywords (a keyword is printed rules text)", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  assert.ok(g.engine.getKeywords(g.id("ruleB")).includes("covert"), "control: another character keeps its keyword");
  assert.equal(g.engine.getKeywords(g.id("ruleA")).includes("covert"), false, "no COVERT");
});

clause(FISTS, "2:rule", "the attached character cannot use its activated abilities (the rules text includes abilities)", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  const before = influence(g.engine);
  refused(() => activateRaw(g.engine, P1, g.id("ruleA"), "act"), "the ability is gone", /Activated ability not found/);
  assert.equal(influence(g.engine), before);
  activate(g.engine, P1, g.id("ruleB"), "act");
  assert.equal(influence(g.engine) - before, 3, "control: another character's ability works");
});

clause(FISTS, "2:rule", "the attached character loses its continuous rules (the +2 life); only the Fists' +3 remains", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  assert.equal(g.engine.getStat(g.id("ruleA"), "life"), 6, "printed 3 + 3 from the Fists, no +2");
  assert.equal(g.engine.getStat(g.id("ruleB"), "life"), 5, "another character keeps its +2 life");
});

clause(FISTS, "2:rule", "the attached character loses its triggered rules", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  const before = influence(g.engine);
  play(g.engine, P1, g.id("plain"), {});
  drain(g.engine, declineAll);
  assert.equal(influence(g.engine) - before, 2, "only RulefulB's trigger fires (+2); RulefulA's does not");
});

clause(FISTS, "2:rule", "only rules text goes: name, type and printed stats stay (plus the Fists' bonus)", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  assert.deepEqual(stat(g.engine, g.id("ruleA")), [5, 6, 2]);
  assert.deepEqual(typesOf(g.engine, g.id("ruleA")), ["character"]);
  assert.equal(g.engine.getDefinition(g.id("ruleA")).name, "RulefulA");
});

clause(FISTS, "2:rule", "it only affects its own host: other characters, and the opponent's, keep their text", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  assert.ok(g.engine.getKeywords(g.id("foeRule")).includes("covert"), "g.engine.getKeywords(g.id(\"foeRule\")).includes(\"covert\")");
  assert.equal(g.engine.getStat(g.id("foeRule"), "life"), 5);
  assert.equal(g.engine.getStat(g.id("ruleB"), "life"), 5);
});

clause(FISTS, "2:rule", "works on an opponent's character too: its rule text is off and its ability is gone", () => {
  const g = fistsBoard({ attachedTo: "foeRule" });
  assert.equal(g.engine.getStat(g.id("foeRule"), "life"), 6, "3 + 3, its +2 rule is off");
  assert.equal(g.engine.getStat(g.id("ruleA"), "life"), 5, "mine keep theirs");
  g.engine.state.activePlayerId = P2;
  g.engine.state.priorityPlayerId = P2;
  refused(() => activateRaw(g.engine, P2, g.id("foeRule"), "act"), "their ability is gone", /Activated ability not found/);
});

clause(FISTS, "2:rule", "when the Fists leave play the host has its rules text again", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  assert.equal(g.engine.getStat(g.id("ruleA"), "life"), 6);
  play(g.engine, P1, g.id("killItem"), { selected: { t: [g.id("hf")] } });
  assert.equal(zoneOf(g.engine, g.id("hf")), "discard");
  assert.equal(g.engine.getStat(g.id("ruleA"), "life"), 5, "its +2 life rule is back");
  const before = influence(g.engine);
  activate(g.engine, P1, g.id("ruleA"), "act");
  assert.equal(influence(g.engine) - before, 3, "its ability works again");
});

clause(FISTS, "2:rule", "the Fists' own HAND OFF is not muted by the rule (it is the item's text, not the host's)", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  handOff(g, "ruleB");
  assert.equal(attachedTo(g), g.id("ruleB"));
});

// -- 3:ability HAND OFF ---------------------------------------------------------

clause(FISTS, "3:ability:heavy-fists-handoff", "pays 2, depletes the picked character and attaches the Fists to it (taking +3/+3 and the muting with it)", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  const before = ready(g.engine);
  handOff(g, "ruleB");
  assert.equal(before - ready(g.engine), 2, "COST: pay 2");
  assert.equal(g.engine.state.cards[g.id("ruleB")].depleted, true, "COST: the picked character is depleted");
  assert.equal(g.engine.state.cards[g.id("ruleA")].depleted, false, "the old host is not depleted");
  assert.equal(attachedTo(g), g.id("ruleB"), "EFFECT: attached to the character");
  assert.equal(zoneOf(g.engine, g.id("hf")), "play");
  assert.deepEqual(stat(g.engine, g.id("ruleA")), [2, 5, 2], "the old host lost +3/+3 and regained its +2 life rule");
  assert.deepEqual(stat(g.engine, g.id("ruleB")), [5, 6, 2], "the new host got +3/+3 and lost its +2 life rule");
  assert.equal(g.engine.state.cards[g.id("hf")].depleted, false, "the Fists themselves are not depleted");
});

clause(FISTS, "3:ability:heavy-fists-handoff", "works from a Fists in play, attached to another character (an unattached ATTACH TO card is not a legal state, CR 507.2c)", () => {
  const g = fistsBoard();
  handOff(g, "plainHost");
  assert.equal(attachedTo(g), g.id("plainHost"));
  assert.deepEqual(stat(g.engine, g.id("plainHost")), [5, 5, 2]);
});

clause(FISTS, "3:ability:heavy-fists-handoff", "the 2 are paid as a cost before responses; the attach happens when it resolves", () => {
  const g = fistsBoard();
  const before = ready(g.engine);
  handOffRaw(g, "ruleA");
  assert.equal(before - ready(g.engine), 2, "paid already");
  assert.equal(g.engine.state.cards[g.id("ruleA")].depleted, true, "depleted already");
  assert.equal(attachedTo(g), g.id("holder"), "not handed off yet");
  resolvePendingResponses(g.engine);
  assert.equal(attachedTo(g), g.id("ruleA"));
});

clause(FISTS, "3:ability:heavy-fists-handoff", "it can be handed to the character it is already attached to", () => {
  const g = fistsBoard({ attachedTo: "ruleA" });
  handOff(g, "ruleA");
  assert.equal(attachedTo(g), g.id("ruleA"));
  assert.equal(g.engine.state.cards[g.id("ruleA")].depleted, true);
});

clause(FISTS, "3:ability:heavy-fists-handoff", "the Fists can be taken off an opponent's character and handed to one of mine", () => {
  const g = fistsBoard({ attachedTo: "foePlain" });
  handOff(g, "plainHost");
  assert.equal(attachedTo(g), g.id("plainHost"));
  assert.deepEqual(stat(g.engine, g.id("foePlain")), [2, 2, 2]);
  assert.deepEqual(stat(g.engine, g.id("plainHost")), [5, 5, 2]);
});

clause(FISTS, "3:ability:heavy-fists-handoff", "the depleted character must be one YOU control: an opponent's character is refused", () => {
  const g = fistsBoard({ attachedTo: "plainHost" });
  const before = ready(g.engine);
  refused(() => handOffRaw(g, "foePlain"), "an opponent's character");
  assert.equal(attachedTo(g), g.id("plainHost"));
  assert.equal(g.engine.state.cards[g.id("foePlain")].depleted, false);
  assert.equal(ready(g.engine), before, "nothing paid");
});

clause(FISTS, "3:ability:heavy-fists-handoff", "it must be a character: item, location, either faction, face-down card, resource, hand and discard cards are refused", () => {
  const g = fistsBoard();
  const attempt = (picked: string) => () => activateRaw(g.engine, P1, g.id("hf"), "heavy-fists-handoff", { hf: [picked] });
  refused(attempt(g.id("thing")), "an item");
  refused(attempt(g.id("place")), "a location");
  refused(attempt(factionOf(g.engine, P1)), "my faction");
  refused(attempt(factionOf(g.engine, P2)), "their faction");
  refused(attempt(g.id("fd")), "a face-down card");
  refused(attempt(g.id("res")), "a resource");
  refused(attempt(g.id("handChar")), "a character in hand");
  refused(attempt(g.id("discChar")), "a character in the discard pile");
  refused(attempt(g.id("hf")), "the Fists themselves");
  assert.equal(ready(g.engine), 8, "nothing was spent");
  attempt(g.id("ruleA"))();
  assert.ok(g.engine.state.responseWindow, "control: a character is accepted");
});

clause(FISTS, "3:ability:heavy-fists-handoff", "exactly one character: none or two is refused", () => {
  const g = fistsBoard();
  refused(() => activateRaw(g.engine, P1, g.id("hf"), "heavy-fists-handoff", { hf: [] }), "none");
  refused(() => activateRaw(g.engine, P1, g.id("hf"), "heavy-fists-handoff", {}), "no selection");
  refused(() => activateRaw(g.engine, P1, g.id("hf"), "heavy-fists-handoff", { hf: [g.id("ruleA"), g.id("ruleB")] }), "two");
  assert.equal(attachedTo(g), g.id("holder"));
  assert.equal(g.engine.state.cards[g.id("ruleA")].depleted, false);
});

clause(FISTS, "3:ability:heavy-fists-handoff", "a character that is already depleted cannot be depleted again, so it is refused", () => {
  const g = fistsBoard();
  g.engine.state.cards[g.id("ruleA")].depleted = true;
  refused(() => handOffRaw(g, "ruleA"), "already depleted");
  assert.equal(attachedTo(g), g.id("holder"));
  assert.equal(ready(g.engine), 8);
  handOff(g, "ruleB");
  assert.equal(attachedTo(g), g.id("ruleB"), "control: a ready character works");
});

clause(FISTS, "3:ability:heavy-fists-handoff", "pay 2 exactly: refused with 1 resource, accepted with 2; no threshold needed", () => {
  const one = fistsBoard({ elitism: 1 });
  refused(() => handOffRaw(one, "ruleA"), "1 resource");
  assert.equal(attachedTo(one), one.id("holder"));
  assert.equal(one.engine.state.cards[one.id("ruleA")].depleted, false);
  assert.equal(ready(one.engine), 1);
  const two = fistsBoard({ elitism: 0, greed: 2 });
  handOff(two, "ruleA");
  assert.equal(attachedTo(two), two.id("ruleA"), "two Greed resources pay for it");
  assert.equal(ready(two.engine), 0);
});

clause(FISTS, "3:ability:heavy-fists-handoff", "it can be used again and again: each use costs 2 and depletes a different character", () => {
  const g = fistsBoard({ elitism: 4 });
  handOff(g, "ruleA");
  handOff(g, "ruleB");
  assert.equal(attachedTo(g), g.id("ruleB"));
  assert.equal(ready(g.engine), 0);
  refused(() => handOffRaw(g, "plainHost"), "a third use cannot be paid");
});

clause(FISTS, "3:ability:heavy-fists-handoff", "a character in a battle cannot be depleted for it: a blocker is refused, a character outside the battle is accepted", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "hf", def: printing(FISTS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", 6, P1)
    ]
  });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("blocker")]);
  while (g.engine.state.responseWindow && g.engine.state.responseWindow.priorityPlayerId !== P1) g.engine.perform({ type: "passPriority", playerId: g.engine.state.responseWindow.priorityPlayerId } as never);
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may use abilities now");
  refused(() => activateRaw(g.engine, P1, g.id("hf"), "heavy-fists-handoff", { hf: [g.id("blocker")] }), "the blocker is in a battle");
  assert.equal(g.engine.state.cards[g.id("blocker")].depleted, false);
  assert.equal(ready(g.engine), 6, "nothing was paid by the refusal");
});

clause(FISTS, "3:ability:heavy-fists-handoff", "a character outside the battle is accepted while a battle is going on", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "hf", def: printing(FISTS), owner: P1, zone: "play", attachedToKey: "holder" },
      { key: "holder", def: character({ name: "Holder", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", 6, P1)
    ]
  });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("blocker")]);
  while (g.engine.state.responseWindow && g.engine.state.responseWindow.priorityPlayerId !== P1) g.engine.perform({ type: "passPriority", playerId: g.engine.state.responseWindow.priorityPlayerId } as never);
  activateRaw(g.engine, P1, g.id("hf"), "heavy-fists-handoff", { hf: [g.id("bystander")] });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("hf")].attachedTo, g.id("bystander"));
  assert.equal(g.engine.state.cards[g.id("bystander")].depleted, true);
});

clause(FISTS, "3:ability:heavy-fists-handoff", "an attacker is also in a battle: it cannot be depleted for HAND OFF once the battle is on, an idle character can", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    cards: [
      { key: "hf", def: printing(FISTS), owner: P1, zone: "play", attachedToKey: "holder" },
      { key: "holder", def: character({ name: "Holder", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", 6, P1)
    ]
  });
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("blk")]);
  assert.ok(g.engine.state.battle, "the battle is on");
  g.engine.state.cards[g.id("atk")].depleted = false;
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority");
  refused(() => activateRaw(g.engine, P1, g.id("hf"), "heavy-fists-handoff", { hf: [g.id("atk")] }), "the attacker is in the battle");
  activateRaw(g.engine, P1, g.id("hf"), "heavy-fists-handoff", { hf: [g.id("idle")] });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("hf")].attachedTo, g.id("idle"), "control: a character outside the battle works");
});

clause(FISTS, "3:ability:heavy-fists-handoff", "only the Fists' controller can use it, and only from play", () => {
  const g = fistsBoard();
  g.engine.state.activePlayerId = P2;
  g.engine.state.priorityPlayerId = P2;
  refused(() => handOffRaw(g, "foePlain", P2), "the opponent");
  const inHand = fistsBoard({ zone: "hand" });
  refused(() => handOffRaw(inHand, "ruleA"), "from hand");
  assert.equal(attachedTo(g), g.id("holder"));
});

// ===============================================================================
// I See You! — Tactic, cost 2, threshold [E][E].
// EXTRA COST: Pick a character with COVERT.
// This turn, the character loses COVERT. If you control [V][V][V], this turn, the character loses 1 speed.
// Put this card into play under its owner's control as a face-down resource instead of into their discard pile.
// FLIP UP: 3 [E][E] and destroy another resource you control.
// ===============================================================================

const ISY = "1866ab78-bc4c-4181-8556-73a0f675686e";

function isyBoard(opts: { zone?: "hand" | "faceDown"; elitism?: number; greed?: number; vol?: number; oppVol?: number; obs?: number; spares?: number; active?: PlayerId } = {}) {
  const active = opts.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      opts.zone === "faceDown"
        ? { key: "isy", def: printing(ISY), owner: P1, zone: "play" as const, faceDown: true }
        : { key: "isy", def: printing(ISY), owner: P1, zone: "hand" as const },
      { key: "sneak", def: character({ name: "Sneak", strength: 2, life: 3, speed: 3, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "mySneak", def: character({ name: "MySneak", strength: 2, life: 3, speed: 3, behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
      { key: "sneak2", def: character({ name: "Sneak2", strength: 2, life: 3, speed: 3, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "plainFoe", def: character({ name: "PlainFoe", strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "plainMine", def: character({ name: "PlainMine", strength: 2, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand", behavior: { keywords: ["covert"] } }), owner: P1, zone: "hand" },
      { key: "foeRes", def: resourceCard({ name: "FoeRes" }), owner: P2, zone: "play" },
      ...Array.from({ length: opts.spares ?? 0 }, (_, i) => ({ key: `spare${i}`, def: resourceCard({ name: `Spare${i}` }), owner: P1, zone: "play" as const })),
      ...bank("elitism", opts.elitism ?? 2, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...bank("obsession", opts.obs ?? 0, P1),
      ...volition(opts.vol ?? 0, P1),
      ...volition(opts.oppVol ?? 0, P2)
    ]
  });
}
type IsyGame = ReturnType<typeof isyBoard>;
const castIsy = (g: IsyGame, target: string) => play(g.engine, P1, g.id("isy"), { selected: { c: [g.id(target)] } });
const castIsyRaw = (g: IsyGame, target: string) => playRaw(g.engine, P1, g.id("isy"), { selected: { c: [g.id(target)] } });
const hasCovert = (g: IsyGame, key: string) => g.engine.getKeywords(g.id(key)).includes("covert");
const speedOf = (g: IsyGame, key: string) => g.engine.getStat(g.id(key), "speed");

// -- 0:extraCost ----------------------------------------------------------------

clause(ISY, "0:extraCost", "any character with COVERT can be picked: an opponent's and my own", () => {
  const foe = isyBoard();
  castIsy(foe, "sneak");
  assert.equal(zoneOf(foe.engine, foe.id("isy")) !== "hand", true, "the tactic was played");
  assert.equal(hasCovert(foe, "sneak"), false);
  const mine = isyBoard();
  castIsy(mine, "mySneak");
  assert.equal(hasCovert(mine, "mySneak"), false);
});

clause(ISY, "0:extraCost", "a character without COVERT is refused", () => {
  const g = isyBoard();
  refused(() => castIsyRaw(g, "plainFoe"), "an opponent's plain character");
  refused(() => castIsyRaw(g, "plainMine"), "my plain character");
  assert.equal(zoneOf(g.engine, g.id("isy")), "hand");
  assert.equal(ready(g.engine), 2, "nothing was paid");
  castIsyRaw(g, "sneak");
  assert.ok(g.engine.state.responseWindow, "control: a COVERT character is accepted");
});

clause(ISY, "0:extraCost", "only characters: an item with COVERT, a location, either faction, a face-down card and a card in hand are refused", () => {
  const g = isyBoard();
  refused(() => castIsyRaw(g, "thing"), "an item with COVERT");
  refused(() => castIsyRaw(g, "place"), "a location");
  refused(() => playRaw(g.engine, P1, g.id("isy"), { selected: { c: [factionOf(g.engine, P2)] } }), "their faction");
  refused(() => playRaw(g.engine, P1, g.id("isy"), { selected: { c: [factionOf(g.engine, P1)] } }), "my faction");
  refused(() => castIsyRaw(g, "hidden"), "a face-down card");
  refused(() => castIsyRaw(g, "inHand"), "a character in hand");
  assert.equal(zoneOf(g.engine, g.id("isy")), "hand");
  assert.equal(ready(g.engine), 2);
});

clause(ISY, "0:extraCost", "exactly one character is picked: none or two is refused", () => {
  const g = isyBoard();
  refused(() => playRaw(g.engine, P1, g.id("isy"), {}), "no pick");
  refused(() => playRaw(g.engine, P1, g.id("isy"), { selected: { c: [] } }), "empty pick");
  refused(() => playRaw(g.engine, P1, g.id("isy"), { selected: { c: [g.id("sneak"), g.id("sneak2")] } }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("isy")), "hand");
  assert.equal(hasCovert(g, "sneak"), true);
  assert.equal(hasCovert(g, "sneak2"), true);
});

clause(ISY, "0:extraCost", "the cost of 2 with [E][E]: one resource short is refused, two resources without [E][E] are refused", () => {
  const short = isyBoard({ elitism: 1 });
  refused(() => castIsyRaw(short, "sneak"), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("isy")), "hand");
  const oneE = isyBoard({ elitism: 1, greed: 3 });
  refused(() => castIsyRaw(oneE, "sneak"), "one [E] is not [E][E]");
  const none = isyBoard({ elitism: 0, greed: 5 });
  refused(() => castIsyRaw(none, "sneak"), "no [E]");
  assert.equal(hasCovert(none, "sneak"), true);
  const exact = isyBoard({ elitism: 2 });
  const before = ready(exact.engine);
  castIsy(exact, "sneak");
  assert.equal(before - ready(exact.engine), 2 - 1, "2 paid and the new face-down resource is ready again (net -1)");
});

// -- 1:rule: loses COVERT -------------------------------------------------------

clause(ISY, "1:rule", "this turn, the picked character loses COVERT; other COVERT characters keep it", () => {
  const g = isyBoard();
  assert.equal(hasCovert(g, "sneak"), true, "control");
  castIsy(g, "sneak");
  assert.equal(hasCovert(g, "sneak"), false);
  assert.equal(hasCovert(g, "sneak2"), true);
  assert.equal(hasCovert(g, "mySneak"), true);
  assert.deepEqual(stat(g.engine, g.id("sneak")), [2, 3, 3], "no other change: 2/3/3 (fewer than 3 volition)");
});

clause(ISY, "1:rule", "the COVERT loss lasts only this turn: it is back on the opponent's turn", () => {
  const g = isyBoard();
  castIsy(g, "sneak");
  assert.equal(hasCovert(g, "sneak"), false);
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.activePlayerId, P2, "the next turn began");
  assert.equal(hasCovert(g, "sneak"), true, "COVERT is back");
});

clause(ISY, "1:rule", "functionally: a COVERT attacker can be blocked by a non-COVERT character once I See You! is played in response to the attack", () => {
  const g = isyBoard({ active: P2 });
  const withoutIsy = isyBoard({ active: P2 });
  declareAttackBy(withoutIsy.engine, P2, [withoutIsy.id("sneak")]);
  refused(() => declareBlockers(withoutIsy.engine, P1, [withoutIsy.id("plainMine")]), "control: a plain character cannot block a COVERT attacker");
  declareAttackOpenWindow(g.engine, P2, [g.id("sneak")]);
  castIsyRaw(g, "sneak");
  resolvePendingResponses(g.engine);
  assert.equal(hasCovert(g, "sneak"), false);
  declareBlockers(g.engine, P1, [g.id("plainMine")]);
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("plainMine")], "a non-COVERT character may now block");
});

// -- 1:rule: speed ---------------------------------------------------------------

clause(ISY, "1:rule", "if I control [V][V][V] the character loses 1 speed this turn (3 face-down cards, 4 as well: still just 1)", () => {
  for (const vol of [3, 4]) {
    const g = isyBoard({ vol });
    castIsy(g, "sneak");
    assert.equal(hasCovert(g, "sneak"), false, "COVERT lost");
    assert.equal(speedOf(g, "sneak"), 2, `${vol} [V]: 3 speed becomes 2`);
    assert.equal(speedOf(g, "sneak2"), 3, "another character is unaffected");
    assert.equal(g.engine.getStat(g.id("sneak"), "strength"), 2);
    assert.equal(g.engine.getStat(g.id("sneak"), "life"), 3);
  }
});

clause(ISY, "1:rule", "with only 2 [V] the speed is not reduced; the COVERT is still lost", () => {
  const g = isyBoard({ vol: 2 });
  castIsy(g, "sneak");
  assert.equal(hasCovert(g, "sneak"), false);
  assert.equal(speedOf(g, "sneak"), 3);
});

clause(ISY, "1:rule", "[V] comes only from face-down cards: three face-up Obsession resources are not [V][V][V]", () => {
  const g = isyBoard({ obs: 3 });
  castIsy(g, "sneak");
  assert.equal(hasCovert(g, "sneak"), false);
  assert.equal(speedOf(g, "sneak"), 3);
});

clause(ISY, "1:rule", "the opponent's [V] does not count: only mine do", () => {
  const g = isyBoard({ vol: 0, oppVol: 3 });
  castIsy(g, "sneak");
  assert.equal(speedOf(g, "sneak"), 3);
});

clause(ISY, "1:rule", "the speed loss applies to my own character too, and ends with the turn", () => {
  const g = isyBoard({ vol: 3 });
  castIsy(g, "mySneak");
  assert.equal(speedOf(g, "mySneak"), 2);
  assert.equal(hasCovert(g, "mySneak"), false);
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(speedOf(g, "mySneak"), 3, "the speed is back");
  assert.equal(hasCovert(g, "mySneak"), true, "COVERT is back");
});

// -- 1:rule: face-down resource instead of discard -------------------------------

clause(ISY, "1:rule", "afterwards the card is in play under its owner's control as a face-down resource, not in the discard pile", () => {
  const g = isyBoard();
  const before = ready(g.engine);
  castIsy(g, "sneak");
  const c = g.engine.state.cards[g.id("isy")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1);
  assert.equal(c.ownerId, P1);
  assert.equal(g.engine.isResource(g.id("isy")), true, "it is a resource");
  assert.equal(g.engine.state.players[P1].discard.includes(g.id("isy")), false, "not in the discard pile");
  assert.equal(g.engine.state.players[P1].play.includes(g.id("isy")), true);
  assert.equal(before - ready(g.engine), 1, "2 spent, +1 for the new face-down resource");
});

clause(ISY, "1:rule", "the new face-down resource is a real resource: it can pay for something later", () => {
  const g = isyBoard({ elitism: 3 });
  castIsy(g, "sneak");
  assert.equal(ready(g.engine), 2, "3 banks - 2 + 1 face-down resource");
  assert.equal(g.engine.state.cards[g.id("isy")].faceDown, true);
});

// -- 2:flipUp -----------------------------------------------------------------------

const flipIsy = (g: IsyGame, target?: string) => flipRaw(g.engine, P1, g.id("isy"), target ? { c: [g.id(target)] } : {});
type BurnPick = { kind: string; playerId: string; [k: string]: unknown };
const myResources = (g: IsyGame) => g.engine.state.players[P1].play.filter((c) => g.engine.isResource(c) && c !== g.id("isy"));
const answerBurnRaw = (g: IsyGame, chosen: string) =>
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [chosen] } } as never);
/** Answers the open "destroy another resource" pick with `chosen`, then lets everything resolve. */
function pickBurn(g: IsyGame, chosen: string) {
  const pc = pending(g.engine) as unknown as BurnPick;
  assert.ok(pc, "the destroy pick is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  answerBurnRaw(g, chosen);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
}
/** flip up (picking `target`) and destroy `burn`. */
function flipAndBurn(g: IsyGame, target: string, burn: string) {
  flipIsy(g, target);
  resolvePendingResponses(g.engine);
  pickBurn(g, burn);
}

clause(ISY, "2:flipUp", "a face-down I See You! flips up for 3 with [E][E]: with exactly itself + 2 Elitism all are spent, the tactic's text resolves and the picked other resource is destroyed", () => {
  const g = isyBoard({ zone: "faceDown", elitism: 2 });
  assert.equal(ready(g.engine), 3, "setup: itself + 2 Elitism");
  const banks = myResources(g);
  assert.equal(banks.length, 2);
  flipAndBurn(g, "sneak", banks[0]);
  assert.equal(zoneOf(g.engine, banks[0]), "discard", "the picked resource was destroyed");
  assert.equal(zoneOf(g.engine, banks[1]), "play", "the other resource was not");
  assert.equal(hasCovert(g, "sneak"), false, "the tactic's text resolved: it loses COVERT");
});

clause(ISY, "2:flipUp", "the destroyed resource is my choice among my other resources: any of them can be picked, and only one is destroyed", () => {
  for (let n = 0; n < 4; n++) {
    const g = isyBoard({ zone: "faceDown", elitism: 2, greed: 1, spares: 1 });
    const mine = myResources(g);
    assert.equal(mine.length, 4);
    flipAndBurn(g, "sneak", mine[n]);
    assert.equal(zoneOf(g.engine, mine[n]), "discard", `resource #${n} was destroyed`);
    for (const m of mine.filter((c) => c !== mine[n])) assert.equal(zoneOf(g.engine, m), "play", "the others stay");
    assert.equal(zoneOf(g.engine, g.id("foeRes")), "play", "their resource untouched");
  }
});

clause(ISY, "2:flipUp", "'another resource you control': the opponent's resource and I See You! itself cannot be picked", () => {
  const g = isyBoard({ zone: "faceDown", elitism: 2, greed: 1 });
  flipIsy(g, "sneak");
  resolvePendingResponses(g.engine);
  assert.ok(pending(g.engine), "the pick is open");
  refused(() => answerBurnRaw(g, g.id("foeRes")), "an opponent's resource");
  refused(() => answerBurnRaw(g, g.id("isy")), "itself is not 'another' resource");
  assert.equal(zoneOf(g.engine, g.id("foeRes")), "play");
  assert.equal(zoneOf(g.engine, g.id("isy")), "deploying", "I See You! is mid-resolution (flipped up = being played), not discarded");
  answerBurnRaw(g, myResources(g)[0]);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined, "control: one of mine is accepted");
});

clause(ISY, "2:flipUp", "FLIP UP costs 3 and no more: with 7 resources exactly 3 are spent", () => {
  const g = isyBoard({ zone: "faceDown", elitism: 4, greed: 2 });
  const before = ready(g.engine);
  assert.equal(before, 7);
  flipIsy(g, "sneak");
  assert.equal(before - ready(g.engine), 4, "3 paid + the card itself stopped being a resource");
});

clause(ISY, "2:flipUp", "FLIP UP is refused one resource short (itself + 1 Elitism = 2)", () => {
  const g = isyBoard({ zone: "faceDown", elitism: 1 });
  assert.equal(ready(g.engine), 2);
  refused(() => flipIsy(g, "sneak"), "2 resources for 3");
  assert.equal(g.engine.state.cards[g.id("isy")].faceDown, true, "still face-down");
  assert.equal(ready(g.engine), 2, "nothing was paid");
  assert.equal(hasCovert(g, "sneak"), true);
});

clause(ISY, "2:flipUp", "FLIP UP needs [E][E]: enough resources with only one [E], or none, are refused", () => {
  const oneE = isyBoard({ zone: "faceDown", elitism: 1, greed: 2 });
  refused(() => flipIsy(oneE, "sneak"), "one [E]");
  assert.equal(oneE.engine.state.cards[oneE.id("isy")].faceDown, true);
  assert.equal(ready(oneE.engine), 4);
  const none = isyBoard({ zone: "faceDown", elitism: 0, greed: 5 });
  refused(() => flipIsy(none, "sneak"), "no [E]");
  assert.equal(none.engine.state.cards[none.id("isy")].faceDown, true);
  assert.equal(hasCovert(none, "sneak"), true);
  const ok = isyBoard({ zone: "faceDown", elitism: 2, greed: 4 });
  flipAndBurn(ok, "sneak", myResources(ok)[0]);
  assert.equal(hasCovert(ok, "sneak"), false, "control: [E][E] plus other resources works");
});

clause(ISY, "2:flipUp", "a flipped-up I See You! still needs its extra cost: a COVERT character pick (none, a non-COVERT one, or a non-character is refused)", () => {
  const g = isyBoard({ zone: "faceDown", elitism: 2, greed: 2 });
  refused(() => flipIsy(g), "no pick");
  refused(() => flipIsy(g, "plainFoe"), "a non-COVERT character");
  refused(() => flipIsy(g, "thing"), "an item");
  refused(() => flipIsy(g, "hidden"), "a face-down card");
  assert.equal(g.engine.state.cards[g.id("isy")].faceDown, true);
  assert.equal(ready(g.engine), 5, "nothing was paid by the refusals");
  flipAndBurn(g, "mySneak", myResources(g)[0]);
  assert.equal(hasCovert(g, "mySneak"), false, "control: a COVERT character is accepted");
});

clause(ISY, "2:flipUp", "after flipping up, the tactic's own text runs: the character loses COVERT and, with [V][V][V], 1 speed", () => {
  const g = isyBoard({ zone: "faceDown", elitism: 2, vol: 3 });
  const banks = myResources(g).filter((c) => g.engine.state.cards[c].faceDown !== true);
  flipAndBurn(g, "sneak", banks[0]);
  assert.equal(hasCovert(g, "sneak"), false);
  assert.equal(speedOf(g, "sneak"), 2, "[V][V][V]: -1 speed");
  assert.equal(speedOf(g, "sneak2"), 3);
});

clause(ISY, "2:flipUp", "and it returns to play as a face-down resource instead of going to the discard pile", () => {
  const g = isyBoard({ zone: "faceDown", elitism: 2 });
  flipAndBurn(g, "sneak", myResources(g)[0]);
  const c = g.engine.state.cards[g.id("isy")];
  assert.equal(c.zone, "play", "put into play, not discarded");
  assert.equal(c.faceDown, true, "as a face-down resource");
  assert.equal(g.engine.state.players[P1].discard.includes(g.id("isy")), false);
  assert.equal(g.engine.isResource(g.id("isy")), true);
});

clause(ISY, "2:flipUp", "a tactic: refused on the opponent's turn outside a response window, allowed in response to their attack", () => {
  const g = isyBoard({ zone: "faceDown", elitism: 2, greed: 1, active: P2 });
  refused(() => flipIsy(g, "sneak"), "no response window open on the opponent's turn");
  assert.equal(g.engine.state.cards[g.id("isy")].faceDown, true);
  declareAttackOpenWindow(g.engine, P2, [g.id("sneak")]);
  flipAndBurn(g, "sneak", myResources(g)[0]);
  assert.equal(hasCovert(g, "sneak"), false, "control: allowed in response to the attack");
});

// ===============================================================================
// Improved Micromajig — Character (majig), cost 2, threshold [E][E], 1 strength / 3 speed / 1 life.
// This card gains 1 strength and 1 life for each token on it.
// ASSEMBLE -- COST: Pay 2. Destroy a Micromajig token you control. EFFECT: Put a token on this card.
// DETACH -- COST: Pay 2. Remove a token from this card. EFFECT: Put a Micromajig token into play under your control.
// ===============================================================================

const IMM = "fd7b002f-06a7-4a9e-b9ee-cdbd9897a7c9";

function immBoard(opts: { tokens?: number; banks?: number; foreignMajig?: boolean } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 2,
    cards: [
      { key: "imm", def: printing(IMM), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : undefined },
      { key: "src", def: printing(IMM), owner: P1, zone: "play", counters: { token: 6 } },
      { key: "foeSrc", def: printing(IMM), owner: P2, zone: "play", counters: { token: 6 } },
      { key: "other", def: character({ name: "Other", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      ...(opts.foreignMajig ? [{ key: "fake", def: character({ name: "Micromajig", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" as const }] : []),
      ...bank("elitism", opts.banks ?? 12, P1),
      ...bank("greed", opts.banks ?? 12, P2)
    ]
  });
}
type ImmGame = ReturnType<typeof immBoard>;
/** Makes `n` real Micromajig tokens for `player` through the source IMM's DETACH. */
function spawn(g: ImmGame, player: PlayerId, n: number) {
  const src = player === P1 ? "src" : "foeSrc";
  if (player === P2) {
    g.engine.state.activePlayerId = P2;
    g.engine.state.priorityPlayerId = P2;
  }
  for (let i = 0; i < n; i++) activate(g.engine, player, g.id(src), "improved-mm-detach");
  g.engine.state.activePlayerId = P1;
  g.engine.state.priorityPlayerId = P1;
}
const assemble = (g: ImmGame) => activate(g.engine, P1, g.id("imm"), "improved-mm-assemble");
const assembleRaw = (g: ImmGame, player: PlayerId = P1) => activateRaw(g.engine, player, g.id("imm"), "improved-mm-assemble");
const detach = (g: ImmGame) => activate(g.engine, P1, g.id("imm"), "improved-mm-detach");
const detachRaw = (g: ImmGame, player: PlayerId = P1) => activateRaw(g.engine, player, g.id("imm"), "improved-mm-detach");

clause(IMM, "0:rule", "gains 1 strength and 1 life for each token on it (0, 1, 3, 6 tokens)", () => {
  for (const tokens of [0, 1, 3, 6]) {
    const g = immBoard({ tokens });
    assert.deepEqual(stat(g.engine, g.id("imm")), [1 + tokens, 1 + tokens, 3], `${tokens} tokens: speed stays 3`);
  }
});

clause(IMM, "0:rule", "tokens on other cards do not count; other cards are not buffed", () => {
  const g = immBoard({ tokens: 0 });
  g.engine.state.cards[g.id("other")].counters = { token: 4 };
  assert.deepEqual(stat(g.engine, g.id("imm")), [1, 1, 3]);
  assert.deepEqual(stat(g.engine, g.id("other")), [1, 1, 1]);
  const withTokens = immBoard({ tokens: 2 });
  assert.deepEqual(stat(withTokens.engine, withTokens.id("other")), [1, 1, 1], "its tokens do not buff other cards");
});

clause(IMM, "0:rule", "the bonus follows the tokens: it shrinks when a token is removed", () => {
  const g = immBoard({ tokens: 3 });
  assert.equal(g.engine.getStat(g.id("imm"), "life"), 4);
  g.engine.state.cards[g.id("imm")].counters = { token: 1 };
  assert.deepEqual(stat(g.engine, g.id("imm")), [2, 2, 3]);
});

// -- ASSEMBLE -------------------------------------------------------------------

clause(IMM, "1:ability:improved-mm-assemble", "pays 2, destroys one Micromajig token I control and puts a token on this card (+1/+1)", () => {
  const g = immBoard();
  spawn(g, P1, 2);
  assert.equal(majigs(g.engine).length, 2, "setup: two real tokens");
  const before = ready(g.engine);
  assemble(g);
  assert.equal(before - ready(g.engine), 2, "COST: pay 2");
  assert.equal(majigs(g.engine).length, 1, "COST: one token destroyed (not both)");
  assert.equal(tokenCount(g.engine, g.id("imm")), 1, "EFFECT: a token on this card");
  assert.deepEqual(stat(g.engine, g.id("imm")), [2, 2, 3]);
  assert.equal(zoneOf(g.engine, g.id("other")), "play", "no other card was destroyed");
  assert.equal(zoneOf(g.engine, g.id("src")), "play");
  assert.equal(zoneOf(g.engine, g.id("imm")), "play");
});

clause(IMM, "1:ability:improved-mm-assemble", "the cost is paid before responses; the token is put on at resolution", () => {
  const g = immBoard();
  spawn(g, P1, 1);
  const before = ready(g.engine);
  assembleRaw(g);
  assert.equal(before - ready(g.engine), 2, "paid already");
  assert.equal(majigs(g.engine).length, 0, "destroyed already");
  assert.equal(tokenCount(g.engine, g.id("imm")), 0, "not on the card yet");
  resolvePendingResponses(g.engine);
  assert.equal(tokenCount(g.engine, g.id("imm")), 1);
});

clause(IMM, "1:ability:improved-mm-assemble", "refused with no Micromajig token to destroy (nothing paid, no token put on)", () => {
  const g = immBoard();
  const before = ready(g.engine);
  refused(() => assembleRaw(g), "no token");
  assert.equal(ready(g.engine), before, "nothing paid");
  assert.equal(tokenCount(g.engine, g.id("imm")), 0);
});

clause(IMM, "1:ability:improved-mm-assemble", "only a token I CONTROL: the opponent's Micromajig token cannot be destroyed for it", () => {
  const g = immBoard();
  spawn(g, P2, 1);
  assert.equal(majigs(g.engine, P2).length, 1, "setup: the opponent has a token");
  refused(() => assembleRaw(g), "only their token exists");
  assert.equal(majigs(g.engine, P2).length, 1, "their token survives");
  assert.equal(tokenCount(g.engine, g.id("imm")), 0);
  spawn(g, P1, 1);
  assemble(g);
  assert.equal(majigs(g.engine, P2).length, 1, "control: with my own token, mine is destroyed and theirs stays");
  assert.equal(majigs(g.engine, P1).length, 0);
  assert.equal(tokenCount(g.engine, g.id("imm")), 1);
});

clause(IMM, "1:ability:improved-mm-assemble", "only a Micromajig TOKEN: a real (non-token) card named Micromajig is not destroyed for it", () => {
  const g = immBoard({ foreignMajig: true });
  refused(() => assembleRaw(g), "no token, only a printed card named Micromajig");
  assert.equal(zoneOf(g.engine, g.id("fake")), "play");
  assert.equal(tokenCount(g.engine, g.id("imm")), 0);
});

clause(IMM, "1:ability:improved-mm-assemble", "I choose which Micromajig token to destroy (the cost reads 'Destroy a Micromajig token you control')", () => holdCostChoices(() => {
  const g = immBoard();
  spawn(g, P1, 2);
  activateRaw(g.engine, P1, g.id("imm"), "improved-mm-assemble");
  assert.ok(pending(g.engine), "the controller is asked which token to destroy");
  assert.equal((pending(g.engine) as unknown as BurnPick).playerId, P1);
}));

clause(IMM, "1:ability:improved-mm-assemble", "is refused with 1 ready resource (one short), accepted with exactly 2", () => {
  const short = immBoard({ banks: 3 });
  spawn(short, P1, 1);
  assert.equal(ready(short.engine), 1);
  refused(() => assembleRaw(short), "1 resource");
  assert.equal(majigs(short.engine).length, 1, "the token survives a refused activation");
  assert.equal(tokenCount(short.engine, short.id("imm")), 0);
  const tight = immBoard({ banks: 4 });
  spawn(tight, P1, 1);
  assert.equal(ready(tight.engine), 2);
  assemble(tight);
  assert.equal(tokenCount(tight.engine, tight.id("imm")), 1);
  assert.equal(ready(tight.engine), 0);
});

clause(IMM, "1:ability:improved-mm-assemble", "can be done again: each use costs 2, eats another token and grows it further (+2/+2 after two)", () => {
  const g = immBoard();
  spawn(g, P1, 3);
  const before = ready(g.engine);
  assemble(g);
  assemble(g);
  assert.equal(before - ready(g.engine), 4);
  assert.equal(majigs(g.engine).length, 1);
  assert.equal(tokenCount(g.engine, g.id("imm")), 2);
  assert.deepEqual(stat(g.engine, g.id("imm")), [3, 3, 3]);
});

clause(IMM, "1:ability:improved-mm-assemble", "only its controller can use it", () => {
  const g = immBoard();
  spawn(g, P1, 1);
  spawn(g, P2, 1);
  g.engine.state.activePlayerId = P2;
  g.engine.state.priorityPlayerId = P2;
  refused(() => assembleRaw(g, P2), "the opponent");
  assert.equal(tokenCount(g.engine, g.id("imm")), 0);
  assert.equal(majigs(g.engine, P2).length, 1);
});

// -- DETACH -----------------------------------------------------------------------

clause(IMM, "2:ability:improved-mm-detach", "pays 2, removes one token from this card and puts a Micromajig token into play under my control", () => {
  const g = immBoard({ tokens: 3 });
  const before = ready(g.engine);
  detach(g);
  assert.equal(before - ready(g.engine), 2, "COST: pay 2");
  assert.equal(tokenCount(g.engine, g.id("imm")), 2, "COST: one token removed");
  const made = majigs(g.engine);
  assert.equal(made.length, 1, "EFFECT: one Micromajig token");
  const t = made[0];
  assert.equal(g.engine.getDefinition(t).name, "Micromajig");
  assert.deepEqual(typesOf(g.engine, t), ["character"]);
  assert.deepEqual(g.engine.getSubtypes(t), ["majig"]);
  assert.deepEqual(stat(g.engine, t), [1, 1, 3], "a 1 strength / 3 speed / 1 life token");
  assert.equal(g.engine.state.cards[t].controllerId, P1);
  assert.equal(g.engine.state.cards[t].zone, "play");
  assert.deepEqual(stat(g.engine, g.id("imm")), [3, 3, 3], "the bonus shrank to 2 tokens");
  assert.equal(majigs(g.engine, P2).length, 0, "none for the opponent");
});

clause(IMM, "2:ability:improved-mm-detach", "the cost is paid before responses; the Micromajig appears at resolution", () => {
  const g = immBoard({ tokens: 1 });
  const before = ready(g.engine);
  detachRaw(g);
  assert.equal(before - ready(g.engine), 2);
  assert.equal(tokenCount(g.engine, g.id("imm")), 0, "token removed already");
  assert.equal(majigs(g.engine).length, 0, "no Micromajig yet");
  resolvePendingResponses(g.engine);
  assert.equal(majigs(g.engine).length, 1);
});

clause(IMM, "2:ability:improved-mm-detach", "refused with no token on the card (nothing paid, no Micromajig made)", () => {
  const g = immBoard({ tokens: 0 });
  const before = ready(g.engine);
  refused(() => detachRaw(g), "no token to remove");
  assert.equal(ready(g.engine), before, "nothing paid");
  assert.equal(majigs(g.engine).length, 0);
});

clause(IMM, "2:ability:improved-mm-detach", "is refused with 1 resource (one short), accepted with exactly 2", () => {
  const mk = (left: number) => {
    const g = immBoard({ tokens: 1, banks: left });
    return g;
  };
  const short = mk(1);
  assert.equal(ready(short.engine), 1);
  refused(() => detachRaw(short), "1 resource");
  assert.equal(tokenCount(short.engine, short.id("imm")), 1);
  assert.equal(majigs(short.engine).length, 0);
  const exact = mk(2);
  detach(exact);
  assert.equal(majigs(exact.engine).length, 1);
  assert.equal(ready(exact.engine), 0);
});

clause(IMM, "2:ability:improved-mm-detach", "can be done again: two tokens, two uses, two Micromajigs; a third use has no token to remove", () => {
  const g = immBoard({ tokens: 2 });
  detach(g);
  detach(g);
  assert.equal(majigs(g.engine).length, 2);
  assert.equal(tokenCount(g.engine, g.id("imm")), 0);
  assert.deepEqual(stat(g.engine, g.id("imm")), [1, 1, 3]);
  refused(() => detachRaw(g), "no token left");
  assert.equal(majigs(g.engine).length, 2);
});

clause(IMM, "2:ability:improved-mm-detach", "the Micromajig token can be assembled back: Detach then Assemble returns the token", () => {
  const g = immBoard({ tokens: 1 });
  detach(g);
  assert.equal(majigs(g.engine).length, 1);
  assemble(g);
  assert.equal(majigs(g.engine).length, 0);
  assert.equal(tokenCount(g.engine, g.id("imm")), 1);
});

clause(IMM, "2:ability:improved-mm-detach", "only its controller can use it", () => {
  const g = immBoard({ tokens: 2 });
  g.engine.state.activePlayerId = P2;
  g.engine.state.priorityPlayerId = P2;
  refused(() => detachRaw(g, P2), "the opponent");
  assert.equal(tokenCount(g.engine, g.id("imm")), 2);
  assert.equal(majigs(g.engine, P2).length, 0);
});

// ===============================================================================
// Lunk Nut — Character (machine), cost 4, threshold [E], 3 strength / 2 speed / 4 life.
// At the start of each opponent's turn, restore this card.
// ===============================================================================

const LUNK = "f2e09c65-9f7c-4826-bec1-d1cdb59fa0ea";

function lunkBoard(opts: { lunkOwner?: PlayerId; lunkController?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    turn: 1,
    cards: [
      { key: "ln", def: printing(LUNK), owner: opts.lunkOwner ?? P1, controller: opts.lunkController, zone: "play", depleted: true },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play", depleted: true },
      { key: "theirs", def: character({ name: "Theirs", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play", depleted: true }
    ]
  });
}
const nextTurn = (g: ReturnType<typeof lunkBoard>) => {
  g.engine.perform({ type: "endTurn", playerId: g.engine.state.activePlayerId });
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
};

clause(LUNK, "0:rule", "at the start of the opponent's turn, a depleted Lunk Nut is restored", () => {
  const g = lunkBoard();
  assert.equal(g.engine.state.cards[g.id("ln")].depleted, true);
  nextTurn(g);
  assert.equal(g.engine.state.activePlayerId, P2, "the opponent's turn began");
  assert.equal(g.engine.state.cards[g.id("ln")].depleted, false, "restored");
  assert.equal(g.engine.state.cards[g.id("mine")].depleted, true, "another depleted character of mine is not restored");
  assert.equal(pending(g.engine), undefined);
});

clause(LUNK, "0:rule", "it triggers again at the start of EVERY opponent's turn: deplete it, play on, restored again next time", () => {
  const g = lunkBoard();
  nextTurn(g);
  assert.equal(g.engine.state.cards[g.id("ln")].depleted, false);
  g.engine.state.cards[g.id("ln")].depleted = true;
  nextTurn(g);
  assert.equal(g.engine.state.activePlayerId, P1, "back to my turn");
  g.engine.state.cards[g.id("ln")].depleted = true;
  nextTurn(g);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.state.cards[g.id("ln")].depleted, false, "restored again on the following opponent turn");
});

clause(LUNK, "0:rule", "the opponent's own Lunk Nut is restored at the start of MY turn (the turn of its owner's opponent)", () => {
  const g = lunkBoard({ lunkOwner: P2 });
  nextTurn(g);
  assert.equal(g.engine.state.activePlayerId, P2);
  g.engine.state.cards[g.id("ln")].depleted = true;
  nextTurn(g);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.cards[g.id("ln")].depleted, false, "restored at the start of my turn");
});

clause(LUNK, "0:rule", "a Lunk Nut I own but the opponent controls is restored at the start of MY turn ('opponent' is relative to its controller)", () => {
  const g = lunkBoard({ lunkOwner: P1, lunkController: P2 });
  nextTurn(g);
  assert.equal(g.engine.state.activePlayerId, P2);
  g.engine.state.cards[g.id("ln")].depleted = true;
  nextTurn(g);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.cards[g.id("ln")].depleted, false, "my turn is its controller's opponent's turn");
});

clause(LUNK, "0:rule", "a Lunk Nut that is not depleted stays ready and nothing else happens (no prompt)", () => {
  const g = lunkBoard();
  g.engine.state.cards[g.id("ln")].depleted = false;
  nextTurn(g);
  assert.equal(g.engine.state.cards[g.id("ln")].depleted, false);
  assert.equal(pending(g.engine), undefined);
});

// ===============================================================================
// Microdefense Autosystem — Location, cost 5, threshold [E][E], 3 structure.
// When you form a blocking party with at least 1 character, you may pay 1. If you do, put a Micromajig token
// into play under your control. Add it to the blocking party.
// ===============================================================================

const MDA = "bb150c67-60c5-4582-8712-224ea083393f";

function mdaBoard(opts: { banks?: number; mdaOwner?: PlayerId; attackerSide?: PlayerId } = {}) {
  const attacker = opts.attackerSide ?? P2;
  const defender = attacker === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: attacker,
    turn: attacker === P1 ? 1 : 2,
    cards: [
      { key: "mda", def: printing(MDA), owner: opts.mdaOwner ?? P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: defender, zone: "play" },
      { key: "blk2", def: character({ name: "Blk2", strength: 1, life: 5, speed: 1 }), owner: defender, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 9, speed: 2 }), owner: attacker, zone: "play" },
      ...bank("elitism", opts.banks ?? 3, P1),
      ...bank("elitism", 3, P2)
    ]
  });
}
type MdaGame = ReturnType<typeof mdaBoard>;
const payYes = (pc: { kind: string }) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc as never));
const payNo = (pc: { kind: string }) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(pc as never));
function blockWith(g: MdaGame, answer: (pc: { kind: string }) => unknown, blockers = ["blk"], defender: PlayerId = P1) {
  declareAttackBy(g.engine, defender === P1 ? P2 : P1, [g.id("atk")]);
  declareBlockers(g.engine, defender, blockers.map((k) => g.id(k)));
  drain(g.engine, answer as never);
  resolvePendingResponses(g.engine);
}

clause(MDA, "0:rule", "forming a blocking party: I may pay 1; if I do, a Micromajig token comes into play under my control and joins the blocking party", () => {
  const g = mdaBoard();
  const before = ready(g.engine);
  blockWith(g, payYes);
  assert.equal(before - ready(g.engine), 1, "paid 1");
  const made = majigs(g.engine);
  assert.equal(made.length, 1, "one Micromajig token");
  const t = made[0];
  assert.deepEqual(stat(g.engine, t), [1, 1, 3]);
  assert.deepEqual(typesOf(g.engine, t), ["character"]);
  assert.equal(g.engine.state.cards[t].controllerId, P1);
  const party = g.engine.state.battle?.blockingParty ?? [];
  assert.ok(party.includes(g.id("blk")), "the declared blocker is still in the party");
  assert.ok(party.includes(t), "the token was added to the blocking party");
  assert.equal(party.length, 2);
});

clause(MDA, "0:rule", "declining the payment: no token, nothing paid, the party stays as declared", () => {
  const g = mdaBoard();
  const before = ready(g.engine);
  blockWith(g, payNo);
  assert.equal(ready(g.engine), before);
  assert.equal(majigs(g.engine).length, 0);
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("blk")]);
});

clause(MDA, "0:rule", "it is optional but offered: a pay prompt is raised for me when I form the party", () => {
  const g = mdaBoard();
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("blk")]);
  resolvePendingResponses(g.engine);
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string } | undefined;
  assert.ok(pc, "a prompt is open");
  assert.equal(pc!.kind, "mayPay");
  assert.equal(pc!.playerId, P1);
});

clause(MDA, "0:rule", "with exactly 1 resource I can pay it; with no resource there is nothing to pay and no token", () => {
  const one = mdaBoard({ banks: 1 });
  blockWith(one, payYes);
  assert.equal(majigs(one.engine).length, 1);
  assert.equal(ready(one.engine), 0);
  const none = mdaBoard({ banks: 0 });
  declareAttackBy(none.engine, P2, [none.id("atk")]);
  declareBlockers(none.engine, P1, [none.id("blk")]);
  drain(none.engine, payYes as never);
  resolvePendingResponses(none.engine);
  assert.equal(majigs(none.engine).length, 0, "cannot pay 1 with 0 resources");
  assert.deepEqual(none.engine.state.battle?.blockingParty, [none.id("blk")]);
});

clause(MDA, "0:rule", "one token for one party, however many characters block", () => {
  const g = mdaBoard();
  blockWith(g, payYes, ["blk", "blk2"]);
  assert.equal(majigs(g.engine).length, 1);
  const party = g.engine.state.battle?.blockingParty ?? [];
  assert.equal(party.length, 3, "two declared blockers and the token");
});

clause(MDA, "0:rule", "the token really fights in the blocking party: the attacker takes its strength as well", () => {
  const g = mdaBoard();
  blockWith(g, payYes, ["blk"]);
  const t = majigs(g.engine)[0];
  finishBattle(g.engine);
  assert.equal(g.engine.state.cards[g.id("atk")].damage ?? 0, 2, "1 from Blk and 1 from the Micromajig token");
  assert.ok(t, "t");
});

clause(MDA, "0:rule", "does not trigger for the other player's blocking party (when YOU form one): their Autosystem is not mine, and my party forming does not trigger theirs", () => {
  const g = mdaBoard({ mdaOwner: P2 });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("blk")]);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined, "their Autosystem does not trigger on my blocking party");
  assert.equal(majigs(g.engine, P2).length, 0);
  assert.equal(majigs(g.engine, P1).length, 0);
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("blk")]);
});

clause(MDA, "0:rule", "does not trigger when I form no blocking party (no blockers declared)", () => {
  const g = mdaBoard();
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, []);
  assert.equal(pending(g.engine), undefined);
  assert.equal(majigs(g.engine).length, 0);
});

clause(MDA, "0:rule", "does not trigger when I attack (I form an attacking party, not a blocking party)", () => {
  const g = mdaBoard({ attackerSide: P1 });
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  assert.equal(pending(g.engine), undefined);
  assert.equal(majigs(g.engine).length, 0);
});

