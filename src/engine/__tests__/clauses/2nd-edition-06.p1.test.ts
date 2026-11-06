// Batch 2nd-edition-06, part p1 (groups 8-15, clauses not covered elsewhere).
// Every test is written from the PRINTED text of the printing under test.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, killTactic, location, P1, P2, play, resolvePendingResponses, tactic } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, drain, printing, refused } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fight, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";
import { developDraw } from "../support/develop.js";

type Pid = typeof P1 | typeof P2;
const other = (p: Pid): Pid => (p === P1 ? P2 : P1);
const handOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].hand];
const discardOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].discard];
const deckOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].deck];
const controllerOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].controllerId;
const damageOf = (engine: SpoilsEngine, c: CardInstanceId): number => engine.state.cards[c].damage;

/** A tactic that does nothing: playing it opens a response window for the opponent. */
const nothingTactic = () => tactic({ name: "Nothing", cost: 0 });

// =================================================================================
// Unexpected Boobysnake
// You may play this card whenever you could play a tactic. If you do, when this card enters play discard a card or destroy this card.
// Character, rogue, subtype beast, cost 4, threshold [D][D], 3/2/4.
// =================================================================================

const SNAKE = "0da66705-4bbd-49c7-981a-3bf32eb437b7";

function snakeBoard(opts: { deception?: number; rage?: number; hand?: number; active?: Pid; bare?: boolean; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    cards: [
      { key: "snake", def: printing(SNAKE), owner: P1, zone: "hand" },
      ...fillers("h", opts.hand ?? 2, P1, "hand"),
      { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" },
      ...(opts.bare ? [] : [{ key: "nothingMine", def: nothingTactic(), owner: P1, zone: "hand" as const }]),
      { key: "attacker", def: character({ name: "Attacker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "oppCard", def: character({ name: "OppCard" }), owner: P2, zone: "hand" },
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      ...(opts.bare ? [] : [{ key: "plain", def: character({ name: "PlainChar", cost: 0 }), owner: P1, zone: "hand" as const }]),
      ...fillers("m", 3, P1, "deck"),
      ...bank("deception", opts.deception ?? 6, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 plays Nothing; P1 plays the Snake in response and lets it resolve: stops at the Snake's "discard a card or destroy this card" prompt. */
function snakeInResponse(game: ReturnType<typeof snakeBoard>) {
  playRaw(game.engine, P2, game.id("nothing"));
  playRaw(game.engine, P1, game.id("snake"));
  resolvePendingResponses(game.engine);
}

clause(SNAKE, "0:rule", "it has TACTICAL (an ordinary character does not)", () => {
  const { engine, id } = snakeBoard();
  assert.ok(engine.getKeywords(id("snake")).includes("tactical"), "engine.getKeywords(id(\"snake\")).includes(\"tactical\")");
  assert.equal(engine.getKeywords(id("plain")).includes("tactical"), false, "control: an ordinary character has no TACTICAL");
});

clause(SNAKE, "0:rule", "whenever a tactic could be played (in response on the opponent's turn) I can play it from my hand: it enters play under my control with 3/2/4", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const { engine, id } = game;
  assert.equal(zoneOf(engine, id("snake")), "play");
  assert.equal(controllerOf(engine, id("snake")), P1);
  assert.equal(engine.getStat(id("snake"), "strength"), 3);
  assert.equal(engine.getStat(id("snake"), "life"), 2);
  assert.equal(engine.getStat(id("snake"), "speed"), 4);
});

clause(SNAKE, "0:rule", "when no tactic could be played (the opponent's turn, nothing to respond to) it cannot be played; an ordinary character cannot be played in a response window", () => {
  const { engine, id } = snakeBoard();
  refused(() => playRaw(engine, P1, id("snake")), "no window is open for me, and it is not my turn");
  assert.equal(zoneOf(engine, id("snake")), "hand");
  playRaw(engine, P2, id("nothing"));
  refused(() => playRaw(engine, P1, id("plain")), "an ordinary character is not a tactic: not deployable in a response window");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  playRaw(engine, P1, id("snake"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("snake")), "play", "control: the Snake itself is deployable in the same window");
});

clause(SNAKE, "0:rule", "the printed cost of 4 is paid when it is played at tactic timing; one resource short it is refused", () => {
  const short = snakeBoard({ deception: 3 });
  playRaw(short.engine, P2, short.id("nothing"));
  refused(() => playRaw(short.engine, P1, short.id("snake")), "3 resources is one short of the cost of 4", /cost|resource|afford|pay/i);
  assert.equal(zoneOf(short.engine, short.id("snake")), "hand");
  const exact = snakeBoard({ deception: 4 });
  const ready = exact.engine.getAvailableResourceCount(P1);
  assert.equal(ready, 4, "control: 4 resources available");
  snakeInResponse(exact);
  assert.equal(zoneOf(exact.engine, exact.id("snake")), "play");
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0, "all 4 were spent");
});

clause(SNAKE, "0:rule", "the threshold [D][D] is required at tactic timing: four rage resources are refused, one deception is not enough, two deception are", () => {
  const noIcons = snakeBoard({ deception: 0, rage: 4 });
  playRaw(noIcons.engine, P2, noIcons.id("nothing"));
  refused(() => playRaw(noIcons.engine, P1, noIcons.id("snake")), "no deception icons", /threshold|icon/i);
  const one = snakeBoard({ deception: 1, rage: 3 });
  playRaw(one.engine, P2, one.id("nothing"));
  refused(() => playRaw(one.engine, P1, one.id("snake")), "only one deception icon", /threshold|icon/i);
  const two = snakeBoard({ deception: 2, rage: 2 });
  snakeInResponse(two);
  assert.equal(zoneOf(two.engine, two.id("snake")), "play", "control: two deception icons meet the threshold");
});

clause(SNAKE, "0:rule", "'If you do': having played it at tactic timing I must discard a card or destroy it, and I (the Snake's controller) choose between exactly those two", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const pc = pending(game.engine)!;
  assert.ok(pc, "a choice is pending");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.optionCount, 2, "discard a card, or destroy this card");
  assert.equal(zoneOf(game.engine, game.id("snake")), "play", "it has already entered play when the choice is made");
});

clause(SNAKE, "0:rule", "choosing to discard: I pick a card from my hand, it goes to my discard pile, and the Snake stays in play", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const { engine, id } = game;
  answerPending(engine, "chooserSelectsOption", { index: 0 });
  const pc = pending(engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h1")] });
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("h1")), "discardOf(engine, P1).includes(id(\"h1\"))");
  assert.equal(zoneOf(engine, id("h0")), "hand", "only the chosen card is discarded");
  assert.equal(zoneOf(engine, id("snake")), "play", "the Snake survives");
  assert.equal(pending(engine), undefined);
});

clause(SNAKE, "0:rule", "choosing to destroy it: the Snake goes to my discard pile and nothing else is discarded", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const { engine, id } = game;
  const hand = handOf(engine, P1);
  answerPending(engine, "chooserSelectsOption", { index: 1 });
  assert.equal(zoneOf(engine, id("snake")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("snake")), "discardOf(engine, P1).includes(id(\"snake\"))");
  assert.deepEqual(handOf(engine, P1), hand, "no other card was discarded");
  assert.equal(pending(engine), undefined);
});

clause(SNAKE, "0:rule", "the discarded card must be a card from my hand: an opponent's card, my deck, a card in play, the Snake itself, and zero or two cards are refused", () => {
  const game = snakeBoard();
  snakeInResponse(game);
  const { engine, id } = game;
  answerPending(engine, "chooserSelectsOption", { index: 0 });
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("oppCard")] }), "the opponent's hand card");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("m0")] }), "a card in my deck");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("inPlay")] }), "a card in play");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("snake")] }), "the Snake itself is in play, not in my hand");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("h0"), id("h1")] }), "two cards");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [] }), "'discard a card' is not optional once chosen");
  assert.equal(zoneOf(engine, id("oppCard")), "hand");
  assert.equal(zoneOf(engine, id("inPlay")), "play");
  assert.equal(zoneOf(engine, id("snake")), "play");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h0")] });
  assert.equal(zoneOf(engine, id("h0")), "discard", "control: a card from my hand is accepted");
});

clause(SNAKE, "0:rule", "with no other card in my hand I cannot discard, so the only way left is destroying the Snake", () => {
  const game = snakeBoard({ hand: 0, bare: true });
  const { engine, id } = game;
  snakeInResponse(game);
  assert.equal(handOf(engine, P1).length, 0, "control: my hand is empty");
  assert.equal(pending(engine)?.kind, "chooserSelectsOption");
  try {
    answerPending(engine, "chooserSelectsOption", { index: 0 });
    if (pending(engine)) answerPending(engine, "chooserSelectsTarget", { selected: [] });
  } catch {
    // refusing the impossible discard is fine
  }
  if (pending(engine)) answerPending(engine, "chooserSelectsOption", { index: 1 });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("snake")), "discard", "with nothing to discard the Snake must be destroyed");
});

clause(SNAKE, "0:rule", "played at tactic timing during a battle (the attack's response window) it also costs a discard or its own destruction", () => {
  const { engine, id } = snakeBoard();
  declareAttackOpenWindow(engine, P2, [id("attacker")]);
  playRaw(engine, P1, id("snake"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("snake")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsOption", "the same 'discard a card or destroy this card' choice");
  assert.equal(pending(engine)?.playerId, P1);
  answerPending(engine, "chooserSelectsOption", { index: 1 });
  assert.equal(zoneOf(engine, id("snake")), "discard");
});

clause(SNAKE, "0:rule", "also in response on MY OWN turn (a tactic could be played): the same discard-or-destroy choice", () => {
  const game = snakeBoard({ active: P1 });
  const { engine, id } = game;
  // I play Nothing; the opponent responds with a tactic of their own; now I may respond to THEIR response.
  playRaw(engine, P1, id("nothingMine"));
  playRaw(engine, P2, id("nothing"));
  playRaw(engine, P1, id("snake"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("snake")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsOption", "I played it at tactic timing");
  assert.equal(pending(engine)?.playerId, P1);
});

clause(SNAKE, "0:rule", "'If you do': deployed the ordinary way on my own turn (not as a tactic) there is no discard-or-destroy choice", () => {
  const game = snakeBoard({ active: P1 });
  const { engine, id } = game;
  const hand = handOf(engine, P1).filter((c) => c !== id("snake"));
  play(engine, P1, id("snake"));
  assert.equal(zoneOf(engine, id("snake")), "play", "deployed");
  assert.equal(pending(engine), undefined, "no choice is offered");
  assert.deepEqual(handOf(engine, P1), hand, "nothing was discarded");
  assert.equal(zoneOf(engine, id("snake")), "play", "and it is not destroyed");
  assert.deepEqual(discardOf(engine, P1), []);
});

// =================================================================================
// Vander Malagut
// UNIQUE EVONDAN
// All your other "sarcophyle" characters gain 1 speed.
// If a character is destroyed during a turn when this card damaged it, take control of that character instead. Reduce the amount of damage inflicted to it this turn to 0. It gains the "sarcophyle" subtype.
// If this card is destroyed, destroy all other "sarcophyle" characters.
// Character, rogue, subtype sarcophyle, cost 9, threshold [D][D][D][D], 5/7/6 (str/life/speed).
// =================================================================================

const VANDER = "20d39d7a-26b9-4094-824f-502ccb0da29a";

/** A tactic that inflicts `amount` damage to one chosen character (declaration `t`). */
const damageTactic = (amount: number, name = "Zap") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A tactic that returns one chosen character to its owner's hand (declaration `t`). */
const bounceTactic = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        { id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }
      ]
    }
  });

const sarcophyle = (name: string, over: Partial<CardDefinition> = {}) =>
  character({ name, subtype: ["sarcophyle"], strength: 2, life: 3, speed: 2, ...over });

function vanderBoard(opts: { tLife?: number; tStr?: number; tSpeed?: number; active?: Pid; vanderZone?: "play" | "hand" | "discard"; deception?: number; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "vander", def: printing(VANDER), owner: P1, zone: opts.vanderZone ?? "play" },
      { key: "t", def: character({ name: "Target", strength: opts.tStr ?? 1, life: opts.tLife ?? 3, speed: opts.tSpeed ?? 1 }), owner: P2, zone: "play" },
      { key: "u", def: character({ name: "Untouched", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "sa", def: sarcophyle("MySarcophyle"), owner: P1, zone: "play" },
      { key: "so", def: sarcophyle("TheirSarcophyle"), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "MyPlain", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic({ name: "KillA" }), owner: P1, zone: "hand" },
      { key: "zap3", def: damageTactic(3), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const speedOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.getStat(c, "speed");

/** Vander (attacking) is blocked by `t`; the battle runs to the end. */
function vanderFightsT(game: ReturnType<typeof vanderBoard>) {
  fightThrough(game.engine, P1, [game.id("vander")], { type: "faction", playerId: P2 }, [game.id("t")]);
}

clause(VANDER, "0:unique", "controlling a second Vander makes me choose which one to keep (the controller chooses); the other is destroyed", () => {
  const b = vanderBoard({ deception: 9, extra: [{ key: "v2", def: printing(VANDER), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("v2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("vander"), b.id("v2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("v2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("vander")), "discard", "the copy that was not kept is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(VANDER, "0:unique", "choosing the old copy instead keeps it and destroys the new one", () => {
  const b = vanderBoard({ deception: 9, extra: [{ key: "v2", def: printing(VANDER), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("v2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("vander") } } as never);
  assert.equal(zoneOf(b.engine, b.id("v2")), "discard", "the new copy is destroyed");
});

clause(VANDER, "0:unique", "the restriction is per player: the opponent may control their own Vander with no choice and no destruction", () => {
  const b = vanderBoard({ extra: [{ key: "v2", def: printing(VANDER), owner: P2, zone: "play" }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("vander")), "play");
  assert.equal(zoneOf(b.engine, b.id("v2")), "play");
});

clause(VANDER, "1:rule", "my other sarcophyle characters have +1 speed; Vander himself (6), an ordinary character of mine, and the opponent's sarcophyle do not", () => {
  const { engine, id } = vanderBoard();
  assert.equal(speedOf(engine, id("sa")), 3, "printed speed 2 + 1");
  assert.equal(speedOf(engine, id("vander")), 6, "'other': Vander does not boost himself");
  assert.equal(speedOf(engine, id("plain")), 2, "not a sarcophyle");
  assert.equal(speedOf(engine, id("so")), 2, "'your': the opponent's sarcophyle is not boosted");
  assert.equal(speedOf(engine, id("t")), 1);
});

clause(VANDER, "1:rule", "the speed bonus needs Vander in play: none while he is in hand, and it ends when he leaves play", () => {
  const inHand = vanderBoard({ vanderZone: "hand" });
  assert.equal(speedOf(inHand.engine, inHand.id("sa")), 2, "Vander in hand: no bonus");
  const { engine, id } = vanderBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  assert.equal(speedOf(engine, id("sa")), 3, "control: bonus while Vander is in play");
  play(engine, P1, id("bounce"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "hand");
  assert.equal(zoneOf(engine, id("sa")), "play", "(bounced, not destroyed: sarcophyles stay)");
  assert.equal(speedOf(engine, id("sa")), 2, "bonus gone once Vander left play");
  assert.equal(speedOf(engine, id("sa")), 2, "...and stays gone");
});

clause(VANDER, "1:rule", "a sarcophyle character that enters play afterwards is also boosted", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "late", def: sarcophyle("LateComer", { cost: 0, speed: 4 }), owner: P1, zone: "hand" }] });
  play(engine, P1, id("late"));
  assert.equal(zoneOf(engine, id("late")), "play");
  assert.equal(speedOf(engine, id("late")), 5, "printed 4 + 1");
});

clause(VANDER, "2:rule", "my attacking Vander damages a blocker that is destroyed: I take control of it instead, so it stays in play under my control", () => {
  const game = vanderBoard();
  const { engine, id } = game;
  vanderFightsT(game);
  assert.equal(zoneOf(engine, id("t")), "play", "not destroyed");
  assert.equal(controllerOf(engine, id("t")), P1, "I took control of it");
  assert.equal(engine.state.cards[id("t")].ownerId, P2, "the owner is unchanged");
  assert.equal(discardOf(engine, P2).includes(id("t")), false, "it did not go to its owner's discard pile");
});

clause(VANDER, "2:rule", "...and the damage inflicted to it this turn is reduced to 0, so it is not destroyed again", () => {
  const game = vanderBoard();
  const { engine, id } = game;
  vanderFightsT(game);
  assert.equal(damageOf(engine, id("t")), 0, "its 5 damage was reduced to 0");
  assert.equal(zoneOf(engine, id("t")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(VANDER, "2:rule", "...and it gains the sarcophyle subtype (so it also gets Vander's +1 speed)", () => {
  const game = vanderBoard({ tSpeed: 1 });
  const { engine, id } = game;
  assert.equal(engine.getSubtypes(id("t")).includes("sarcophyle"), false, "control: not a sarcophyle before");
  vanderFightsT(game);
  assert.ok(engine.getSubtypes(id("t")).includes("sarcophyle"), "engine.getSubtypes(id(\"t\")).includes(\"sarcophyle\")");
  assert.equal(speedOf(engine, id("t")), 2, "printed speed 1 + 1 from Vander now that it is mine and a sarcophyle");
});

clause(VANDER, "2:rule", "Vander as the BLOCKER damaging an attacker that is destroyed: I take control of that attacker", () => {
  const game = vanderBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }] });
  const { engine, id } = game;
  fightThrough(engine, P2, [id("atk")], { type: "faction", playerId: P1 }, [id("vander")]);
  assert.equal(zoneOf(engine, id("atk")), "play");
  assert.equal(controllerOf(engine, id("atk")), P1);
  assert.equal(damageOf(engine, id("atk")), 0);
  assert.ok(engine.getSubtypes(id("atk")).includes("sarcophyle"), "engine.getSubtypes(id(\"atk\")).includes(\"sarcophyle\")");
});

clause(VANDER, "2:rule", "a character that Vander damaged this turn and that is then destroyed by another source (a kill effect) is taken instead", () => {
  const game = vanderBoard({ tLife: 10 });
  const { engine, id } = game;
  vanderFightsT(game);
  assert.equal(damageOf(engine, id("t")), 5, "control: Vander's 5 damage did not kill it");
  assert.equal(controllerOf(engine, id("t")), P2, "control: still the opponent's");
  play(engine, P1, id("kill"), { selected: { t: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "play", "not destroyed");
  assert.equal(controllerOf(engine, id("t")), P1);
  assert.equal(damageOf(engine, id("t")), 0, "damage inflicted this turn reduced to 0");
  assert.ok(engine.getSubtypes(id("t")).includes("sarcophyle"), "engine.getSubtypes(id(\"t\")).includes(\"sarcophyle\")");
});

clause(VANDER, "2:rule", "...also when the destroying damage comes from another source after Vander damaged it", () => {
  const game = vanderBoard({ tLife: 8 });
  const { engine, id } = game;
  vanderFightsT(game);
  assert.equal(damageOf(engine, id("t")), 5, "control: 5 of its 8 life");
  play(engine, P1, id("zap3"), { selected: { t: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "play", "the lethal 3 damage did not destroy it");
  assert.equal(controllerOf(engine, id("t")), P1);
  assert.equal(damageOf(engine, id("t")), 0);
});

clause(VANDER, "2:rule", "a character Vander did NOT damage that is destroyed this turn goes to its owner's discard pile as usual (no control change, no subtype)", () => {
  const { engine, id } = vanderBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("u")] } });
  assert.equal(zoneOf(engine, id("u")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("u")), "discardOf(engine, P2).includes(id(\"u\"))");
  assert.equal(engine.getSubtypes(id("u")).includes("sarcophyle"), false);
  assert.equal(zoneOf(engine, id("sa")), "play", "only Vander's own destruction destroys the other sarcophyles");
  assert.equal(zoneOf(engine, id("so")), "play");
  assert.equal(zoneOf(engine, id("vander")), "play");
});

clause(VANDER, "2:rule", "a character destroyed by other damage while Vander damaged a DIFFERENT character is destroyed normally", () => {
  const game = vanderBoard({ tLife: 10 });
  const { engine, id } = game;
  vanderFightsT(game);
  play(engine, P1, id("zap3"), { selected: { t: [id("u")] } });
  assert.equal(zoneOf(engine, id("u")), "discard", "u (never damaged by Vander) dies normally to 3 damage");
  assert.equal(controllerOf(engine, id("u")), P2);
});

clause(VANDER, "2:rule", "damage Vander dealt on an EARLIER turn does not count: the character is destroyed normally on a later turn", () => {
  const game = vanderBoard({ tLife: 10, extra: [{ key: "kill2", def: killTactic({ name: "KillB" }), owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  vanderFightsT(game);
  assert.equal(damageOf(engine, id("t")), 5, "control: Vander damaged it this turn");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(damageOf(engine, id("t")), 0, "control: damage does not carry over to the next turn");
  play(engine, P2, id("kill2"), { selected: { t: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "discard", "Vander did not damage it THIS turn: destroyed normally");
  assert.equal(controllerOf(engine, id("t")), P2);
});

clause(VANDER, "2:rule", "if Vander has left play, a character he damaged earlier this turn is destroyed normally", () => {
  const game = vanderBoard({ tLife: 10, extra: [{ key: "kill3", def: killTactic({ name: "KillC" }), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  vanderFightsT(game);
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "discard");
  play(engine, P1, id("kill3"), { selected: { t: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "discard", "no Vander in play: no replacement");
  assert.equal(controllerOf(engine, id("t")), P2);
});

clause(VANDER, "3:rule", "if Vander is destroyed, every other sarcophyle character is destroyed (mine and the opponent's); other characters are not", () => {
  const { engine, id } = vanderBoard();
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "discard");
  assert.equal(zoneOf(engine, id("sa")), "discard", "my sarcophyle is destroyed");
  assert.equal(zoneOf(engine, id("so")), "discard", "the opponent's sarcophyle is destroyed");
  assert.equal(zoneOf(engine, id("plain")), "play", "an ordinary character of mine stays");
  assert.equal(zoneOf(engine, id("t")), "play", "an ordinary opposing character stays");
  assert.equal(zoneOf(engine, id("u")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(VANDER, "3:rule", "Vander destroyed in battle by lethal damage also destroys the other sarcophyle characters", () => {
  const game = vanderBoard({ active: P2, extra: [{ key: "big", def: character({ name: "BigBrute", strength: 9, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  const { engine, id } = game;
  fightThrough(engine, P2, [id("big")], { type: "faction", playerId: P1 }, [id("vander")]);
  assert.equal(zoneOf(engine, id("vander")), "discard", "control: 9 damage kills the 7-life Vander");
  assert.equal(zoneOf(engine, id("sa")), "discard");
  assert.equal(zoneOf(engine, id("so")), "discard");
  assert.equal(zoneOf(engine, id("plain")), "play");
});

clause(VANDER, "3:rule", "'destroyed' only: Vander returned to hand does not destroy the other sarcophyle characters", () => {
  const { engine, id } = vanderBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "hand");
  assert.equal(zoneOf(engine, id("sa")), "play");
  assert.equal(zoneOf(engine, id("so")), "play");
});

clause(VANDER, "3:rule", "a character Vander took (now a sarcophyle) is destroyed with him", () => {
  const game = vanderBoard();
  const { engine, id } = game;
  vanderFightsT(game);
  assert.equal(zoneOf(engine, id("t")), "play", "control: taken");
  play(engine, P1, id("kill"), { selected: { t: [id("vander")] } });
  assert.equal(zoneOf(engine, id("vander")), "discard");
  assert.equal(zoneOf(engine, id("t")), "discard", "it is a sarcophyle now, so it dies with Vander");
  assert.equal(zoneOf(engine, id("u")), "play");
});

clause(VANDER, "3:rule", "the duplicate Vander that UNIQUE destroys is a destroyed Vander: it also destroys the other sarcophyle characters, the surviving copy included", () => {
  const b = vanderBoard({ deception: 9, extra: [{ key: "v2", def: printing(VANDER), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("v2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("v2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("vander")), "discard", "the old copy is destroyed by UNIQUE");
  assert.equal(zoneOf(b.engine, b.id("sa")), "discard", "so every other sarcophyle character dies");
  assert.equal(zoneOf(b.engine, b.id("so")), "discard");
  assert.equal(zoneOf(b.engine, b.id("v2")), "discard", "the kept copy is another sarcophyle character");
  assert.equal(zoneOf(b.engine, b.id("plain")), "play");
});

// =================================================================================
// Yoink!
// COST: Pick a "gear" card. Pick a character.
// EFFECT: Take control of the "gear" card. Attach it to the character.
// Tactic, rogue, cost 1, threshold [D].
// =================================================================================

const YOINK = "0781658d-62fd-4fa3-a963-5100de7269da";

/** A gear item: +2 strength to the character it is attached to. */
const gearDef = (name: string, over: Partial<CardDefinition> = {}) =>
  item({
    name,
    subtype: ["gear"],
    attachTo: "character",
    behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] },
    ...over
  } as Partial<CardDefinition>);

function yoinkBoard(opts: { deception?: number; rage?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "yoink", def: printing(YOINK), owner: P1, zone: "hand" },
      { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" },
      { key: "myChar", def: character({ name: "MyChar", strength: 2, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "myChar2", def: character({ name: "MyChar2", strength: 2, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "oppChar", def: character({ name: "OppChar", strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "oppChar2", def: character({ name: "OppChar2", strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "gearOpp", def: gearDef("OppGear"), owner: P2, zone: "play", attachedToKey: "oppChar" },
      { key: "gearMine", def: gearDef("MyGear"), owner: P1, zone: "play", attachedToKey: "myChar" },
      { key: "notGear", def: item({ name: "NotGear" }), owner: P2, zone: "play" },
      { key: "gearHand", def: gearDef("HandGear"), owner: P2, zone: "hand" },
      { key: "gearDisc", def: gearDef("DiscGear"), owner: P2, zone: "discard" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...bank("deception", opts.deception ?? 3, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const attachedToOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].attachedTo;

clause(YOINK, "0:ability", "I take control of an opponent's gear card and attach it to a character: it is mine and sits on that character", () => {
  const { engine, id } = yoinkBoard();
  assert.equal(controllerOf(engine, id("gearOpp")), P2, "control: it starts as the opponent's");
  assert.equal(engine.getStat(id("oppChar"), "strength"), 4, "control: the gear gives its host +2");
  play(engine, P1, id("yoink"), { selected: { g: [id("gearOpp")], c: [id("myChar2")] } });
  assert.equal(controllerOf(engine, id("gearOpp")), P1, "I took control");
  assert.equal(attachedToOf(engine, id("gearOpp")), id("myChar2"), "attached to the chosen character");
  assert.equal(zoneOf(engine, id("gearOpp")), "play");
  assert.equal(engine.getStat(id("myChar2"), "strength"), 4, "the gear now boosts its new host");
  assert.equal(engine.getStat(id("oppChar"), "strength"), 2, "the old host lost the gear's bonus");
});

clause(YOINK, "0:ability", "the character may be any character, including an opponent's: the gear goes there but under MY control", () => {
  const { engine, id } = yoinkBoard();
  play(engine, P1, id("yoink"), { selected: { g: [id("gearOpp")], c: [id("oppChar2")] } });
  assert.equal(controllerOf(engine, id("gearOpp")), P1);
  assert.equal(attachedToOf(engine, id("gearOpp")), id("oppChar2"));
  assert.equal(engine.getStat(id("oppChar2"), "strength"), 4);
  assert.equal(engine.getStat(id("oppChar"), "strength"), 2);
});

clause(YOINK, "0:ability", "a gear card I already control can be picked too and moved to another character", () => {
  const { engine, id } = yoinkBoard();
  play(engine, P1, id("yoink"), { selected: { g: [id("gearMine")], c: [id("myChar2")] } });
  assert.equal(controllerOf(engine, id("gearMine")), P1);
  assert.equal(attachedToOf(engine, id("gearMine")), id("myChar2"));
  assert.equal(engine.getStat(id("myChar"), "strength"), 2, "the old host is back to its printed strength");
  assert.equal(engine.getStat(id("myChar2"), "strength"), 4);
});

clause(YOINK, "0:ability", "the cost of 1 is paid (the Yoink! resolves into my discard pile), and only the picked gear moves", () => {
  const { engine, id } = yoinkBoard({ deception: 3 });
  const before = engine.getAvailableResourceCount(P1);
  play(engine, P1, id("yoink"), { selected: { g: [id("gearOpp")], c: [id("myChar")] } });
  assert.equal(before - engine.getAvailableResourceCount(P1), 1, "exactly 1 resource spent");
  assert.equal(zoneOf(engine, id("yoink")), "discard");
  assert.equal(attachedToOf(engine, id("gearMine")), id("myChar"), "my other gear stays where it was");
  assert.equal(controllerOf(engine, id("notGear")), P2);
});

clause(YOINK, "0:ability", "with no resource it cannot be played; with one resource but not [D] (threshold) it cannot; one [D] suffices", () => {
  const none = yoinkBoard({ deception: 0 });
  refused(() => play(none.engine, P1, none.id("yoink"), { selected: { g: [none.id("gearOpp")], c: [none.id("myChar")] } }), "no resource at all", /threshold|cost|resource|afford|pay/i);
  assert.equal(zoneOf(none.engine, none.id("yoink")), "hand");
  const spent = yoinkBoard({ deception: 0, extra: bank("deception", 1, P1).map((placement) => ({ ...placement, attachedToKey: "__factionA" })) });
  assert.equal(spent.engine.getAvailableResourceCount(P1), 0, "control: the only [D] is already spent");
  refused(() => play(spent.engine, P1, spent.id("yoink"), { selected: { g: [spent.id("gearOpp")], c: [spent.id("myChar")] } }), "threshold met but no resource left to pay 1", /cost|resource|afford|pay/i);
  assert.equal(controllerOf(spent.engine, spent.id("gearOpp")), P2);
  const wrong = yoinkBoard({ deception: 0, rage: 3 });
  refused(() => play(wrong.engine, P1, wrong.id("yoink"), { selected: { g: [wrong.id("gearOpp")], c: [wrong.id("myChar")] } }), "no deception icon", /threshold|icon/i);
  assert.equal(controllerOf(wrong.engine, wrong.id("gearOpp")), P2);
  const ok = yoinkBoard({ deception: 1 });
  play(ok.engine, P1, ok.id("yoink"), { selected: { g: [ok.id("gearOpp")], c: [ok.id("myChar")] } });
  assert.equal(controllerOf(ok.engine, ok.id("gearOpp")), P1, "control: one [D] is enough");
});

clause(YOINK, "0:ability", "the first pick must be a gear card in play: a non-gear item, a location, a gear in hand or in the discard pile, and a character are refused", () => {
  const { engine, id } = yoinkBoard();
  const tryG = (g: CardInstanceId) => () => play(engine, P1, id("yoink"), { selected: { g: [g], c: [id("myChar")] } });
  refused(tryG(id("notGear")), "an item without the gear subtype");
  refused(tryG(id("place")), "a location");
  refused(tryG(id("gearHand")), "a gear card in a hand: 'pick' means a card in play");
  refused(tryG(id("gearDisc")), "a gear card in a discard pile");
  refused(tryG(id("oppChar")), "a character is not a gear card");
  refused(() => play(engine, P1, id("yoink"), { selected: { g: [id("gearOpp"), id("gearMine")], c: [id("myChar")] } }), "two gear cards: pick a gear card");
  refused(() => play(engine, P1, id("yoink"), { selected: { c: [id("myChar")] } }), "the gear pick is a cost: it cannot be skipped");
  assert.equal(zoneOf(engine, id("yoink")), "hand", "nothing was paid by the refused attempts");
  assert.equal(controllerOf(engine, id("gearOpp")), P2);
  play(engine, P1, id("yoink"), { selected: { g: [id("gearOpp")], c: [id("myChar")] } });
  assert.equal(controllerOf(engine, id("gearOpp")), P1, "control: a real gear card in play works");
});

clause(YOINK, "0:ability", "the second pick must be a character in play: an item, a location, a gear card, a character in hand, the faction and two characters are refused", () => {
  const { engine, id } = yoinkBoard({ extra: [{ key: "handChar", def: character({ name: "HandChar" }), owner: P2, zone: "hand" }] });
  const tryC = (c: CardInstanceId[]) => () => play(engine, P1, id("yoink"), { selected: { g: [id("gearOpp")], c } });
  refused(tryC([id("notGear")]), "an item is not a character");
  refused(tryC([id("place")]), "a location is not a character");
  refused(tryC([id("gearMine")]), "a gear card is not a character");
  refused(tryC([id("handChar")]), "a character in hand is not in play");
  refused(tryC([engine.state.players[P2].factionId!]), "a faction cannot be picked unless instructed (CR 202.9a)");
  refused(tryC([id("myChar"), id("myChar2")]), "pick a character: exactly one");
  refused(tryC([]), "the character pick is a cost: it cannot be skipped");
  assert.equal(zoneOf(engine, id("yoink")), "hand");
  assert.equal(controllerOf(engine, id("gearOpp")), P2, "nothing happened in the refused attempts");
  play(engine, P1, id("yoink"), { selected: { g: [id("gearOpp")], c: [id("myChar")] } });
  assert.equal(attachedToOf(engine, id("gearOpp")), id("myChar"), "control: a character in play works");
});

clause(YOINK, "0:ability", "it is a tactic: on the opponent's turn I can play it in response, and it works the same", () => {
  const { engine, id } = yoinkBoard({ active: P2 });
  playRaw(engine, P2, id("nothing"));
  playRaw(engine, P1, id("yoink"), { selected: { g: [id("gearOpp")], c: [id("myChar")] } });
  resolvePendingResponses(engine);
  assert.equal(controllerOf(engine, id("gearOpp")), P1);
  assert.equal(attachedToOf(engine, id("gearOpp")), id("myChar"));
  assert.equal(zoneOf(engine, id("yoink")), "discard");
});

clause(YOINK, "0:ability", "outside a response window on the opponent's turn it cannot be played", () => {
  const { engine, id } = yoinkBoard({ active: P2 });
  refused(() => playRaw(engine, P1, id("yoink"), { selected: { g: [id("gearOpp")], c: [id("myChar")] } }), "no window is open for me");
  assert.equal(controllerOf(engine, id("gearOpp")), P2);
});

// =================================================================================
// Assimilation Center
// RECRUIT -- COST: Pay 1. Deplete this card. -- EFFECT: Search your deck for a character and reveal it. Put it on the top of your deck.
// Location, warlord, cost 2, threshold [R][R], structure 4.
// =================================================================================

const CENTER = "00881fe6-5de2-4709-ab6f-bffc7e76c525";

function centerBoard(opts: { rage?: number; chars?: number; noChars?: boolean; active?: Pid; depleted?: boolean } = {}) {
  const chars = opts.noChars ? 0 : opts.chars ?? 6;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "ac", def: printing(CENTER), owner: P1, zone: "play", depleted: opts.depleted },
      ...fillers("c", chars, P1, "deck", (i) => character({ name: `DeckChar${i}`, strength: i + 1 })),
      ...fillers("i", opts.noChars ? 8 : 2, P1, "deck", (i) => item({ name: `DeckItem${i}` })),
      ...fillers("t", 2, P1, "deck", (i) => tactic({ name: `DeckTactic${i}`, cost: 0 })),
      ...fillers("oc", 3, P2, "deck", (i) => character({ name: `OppDeckChar${i}` })),
      { key: "handChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "discChar", def: character({ name: "DiscChar" }), owner: P1, zone: "discard" },
      { key: "playChar", def: character({ name: "PlayChar" }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 3, P1),
      ...bank("rage", 2, P2)
    ]
  });
}

const recruit = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, selected: Record<string, CardInstanceId[]> = {}) =>
  activate(engine, P1, id("ac"), "recruit", { selected });

clause(CENTER, "0:ability:recruit", "COST: pay 1 and deplete this card (it is depleted afterwards and exactly 1 resource is spent)", () => {
  const { engine, id } = centerBoard();
  assert.equal(engine.state.cards[id("ac")].depleted, false, "control: ready");
  const ready = engine.getAvailableResourceCount(P1);
  recruit(engine, id);
  assert.equal(engine.state.cards[id("ac")].depleted, true, "deplete this card");
  assert.equal(ready - engine.getAvailableResourceCount(P1), 1, "pay 1: exactly one resource spent");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "then the search asks me to pick");
  assert.equal(pending(engine)?.playerId, P1);
});

clause(CENTER, "0:ability:recruit", "it cannot be used while depleted", () => {
  const { engine, id } = centerBoard({ depleted: true });
  assert.equal(engine.state.cards[id("ac")].depleted, true, "control: depleted");
  refused(() => recruit(engine, id), "Deplete this card is a cost", /deplet|cost|cannot/i);
  assert.equal(engine.getAvailableResourceCount(P1), 3, "no resource was paid by the refused attempt");
  assert.equal(pending(engine), undefined);
});

clause(CENTER, "0:ability:recruit", "it cannot be used without a resource to pay 1", () => {
  const { engine, id } = centerBoard({ rage: 0 });
  refused(() => recruit(engine, id), "no resource to pay 1", /cost|resource|afford|pay/i);
  assert.equal(engine.state.cards[id("ac")].depleted, false, "nothing was paid");
  const ok = centerBoard({ rage: 1 });
  recruit(ok.engine, ok.id);
  assert.equal(ok.engine.state.cards[ok.id("ac")].depleted, true, "control: one resource is enough");
});

clause(CENTER, "0:ability:recruit", "only its controller can use it: the opponent cannot", () => {
  const { engine, id } = centerBoard({ active: P2 });
  refused(() => activate(engine, P2, id("ac"), "recruit"), "the opponent does not control it", /control|your|owner|cannot/i);
  assert.equal(engine.state.cards[id("ac")].depleted, false);
});

clause(CENTER, "0:ability:recruit", "EFFECT: I pick a character from my deck and it is put on top of the deck (deck size unchanged, all other cards still there)", () => {
  const { engine, id } = centerBoard();
  const before = deckOf(engine, P1);
  recruit(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("c3")] });
  const after = deckOf(engine, P1);
  assert.equal(after[0], id("c3"), "the chosen character is on top");
  assert.equal(after.length, before.length, "no card left or entered the deck");
  assert.deepEqual([...after].sort(), [...before].sort(), "the very same cards");
  assert.equal(zoneOf(engine, id("c3")), "deck");
  assert.equal(pending(engine), undefined);
});

clause(CENTER, "0:ability:recruit", "any character of the deck can be the one: also the one already on the bottom, and a different one each time", () => {
  for (const key of ["c0", "c5"]) {
    const { engine, id } = centerBoard();
    recruit(engine, id);
    answerPending(engine, "chooserSelectsTarget", { selected: [id(key)] });
    assert.equal(deckOf(engine, P1)[0], id(key), `${key} is now on top`);
  }
});

clause(CENTER, "0:ability:recruit", "'reveal it': exactly the found character is revealed to everyone", () => {
  const { engine, id } = centerBoard();
  recruit(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("c2")] });
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "one reveal");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("c2")], "exactly the found card");
  assert.equal(ev.viewerId, "all");
});

clause(CENTER, "0:ability:recruit", "only a character of MY deck can be found: items, tactics, the opponent's characters, and characters in hand, discard or play are refused; so is more than one", () => {
  const { engine, id } = centerBoard();
  recruit(engine, id);
  const tryPick = (selected: CardInstanceId[]) => () => answerPending(engine, "chooserSelectsTarget", { selected });
  refused(tryPick([id("i0")]), "an item in my deck");
  refused(tryPick([id("t0")]), "a tactic in my deck");
  refused(tryPick([id("oc0")]), "a character in the opponent's deck");
  refused(tryPick([id("handChar")]), "a character in my hand");
  refused(tryPick([id("discChar")]), "a character in my discard pile");
  refused(tryPick([id("playChar")]), "a character in play");
  refused(tryPick([id("c0"), id("c1")]), "one character only");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search is still waiting for a valid pick");
  tryPick([id("c1")])();
  assert.equal(deckOf(engine, P1)[0], id("c1"), "control: a character of my deck works");
});

clause(CENTER, "0:ability:recruit", "the deck is shuffled by the search (CR 312.1) and THEN the found card is put on top: the rest of the deck is reordered", () => {
  const { engine, id } = centerBoard({ chars: 8 });
  const before = deckOf(engine, P1);
  recruit(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("c4")] });
  const rest = deckOf(engine, P1).slice(1);
  const restBefore = before.filter((c) => c !== id("c4"));
  assert.deepEqual([...rest].sort(), [...restBefore].sort(), "same other cards");
  assert.notDeepEqual(rest, restBefore, "the other cards were shuffled");
});

clause(CENTER, "0:ability:recruit", "a search with specific criteria may be failed (CR 312.2): picking nothing finds nothing, costs stay paid, and the deck is still shuffled (CR 312.1)", () => {
  const { engine, id } = centerBoard({ chars: 8 });
  const before = deckOf(engine, P1);
  recruit(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [] });
  const after = deckOf(engine, P1);
  assert.equal(engine.state.cards[id("ac")].depleted, true, "the cost was paid");
  assert.equal(pending(engine), undefined);
  assert.equal(after.length, before.length);
  assert.deepEqual([...after].sort(), [...before].sort(), "no card left the deck");
  assert.notDeepEqual(after, before, "a searched deck is shuffled afterwards even when nothing was found");
});

clause(CENTER, "0:ability:recruit", "a deck with no character in it: the search finds nothing, nothing moves, and the deck is still shuffled", () => {
  const { engine, id } = centerBoard({ noChars: true });
  const before = deckOf(engine, P1);
  recruit(engine, id);
  if (pending(engine)) answerPending(engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(pending(engine), undefined);
  const after = deckOf(engine, P1);
  assert.equal(engine.state.cards[id("ac")].depleted, true, "the cost was paid");
  assert.deepEqual([...after].sort(), [...before].sort(), "the same cards are in the deck");
  assert.notDeepEqual(after, before, "searched, so shuffled");
});

clause(CENTER, "0:ability:recruit", "the found character is on top of the deck, so my next draw takes it", () => {
  const { engine, id } = centerBoard();
  recruit(engine, id);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("c5")] });
  const top = deckOf(engine, P1)[0];
  developDraw(engine, P1);
  assert.ok(handOf(engine, P1).includes(top), "the top card is now in my hand");
  assert.equal(top, id("c5"));
});

// =================================================================================
// Berserker Corps
// This card gains 1 strength for each token on it.
// At the start of your turn, you may pick a character you control. If you do, destroy it. Put X tokens on this card, where X is the destroyed character's strength when it was destroyed. Otherwise, destroy this card.
// Character, warlord, subtype berserker, cost 3, threshold [R][R][R], 5/5/3 (str/life/speed).
// =================================================================================

const CORPS = "69472020-1ebf-4f3c-bf48-ff1a608af1e6";

/** A static +2 strength for each character its controller controls. */
const bannerDef = () =>
  item({
    name: "Banner",
    behavior: { abilities: [{ id: "banner", type: "continuous", modifiers: [{ selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: 2 }] }] }
  });

function corpsBoard(opts: { tokens?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "bc", def: printing(CORPS), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : undefined },
      { key: "a", def: character({ name: "Ally A", strength: 3, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "Ally B", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "handChar", def: character({ name: "HandChar", strength: 7 }), owner: P1, zone: "hand" },
      ...(opts.extra ?? [])
    ]
  });
}

/** The opponent ends their turn; my start-of-turn triggers run (stopping at the first prompt). */
function corpsTurnStart(game: ReturnType<typeof corpsBoard>) {
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1, "it is my turn now");
}

const pickCorps = (game: ReturnType<typeof corpsBoard>, selected: CardInstanceId[]) => answerPending(game.engine, "selectTargets", { selected: { picked: selected } });

clause(CORPS, "0:rule", "it gains 1 strength for each token on it: 0 tokens 5, 1 token 6, 4 tokens 9", () => {
  for (const [tokens, expected] of [[0, 5], [1, 6], [4, 9]] as const) {
    const { engine, id } = corpsBoard({ tokens });
    assert.equal(engine.getStat(id("bc"), "strength"), expected, `${tokens} tokens`);
  }
});

clause(CORPS, "0:rule", "only tokens on THIS card count: tokens on other characters don't change its strength, nor does it boost them", () => {
  const { engine, id } = corpsBoard({ extra: [{ key: "tokened", def: character({ name: "Tokened", strength: 3, life: 3, speed: 1 }), owner: P1, zone: "play", counters: { token: 3 } }] });
  assert.equal(engine.getStat(id("bc"), "strength"), 5, "no tokens on it");
  assert.equal(engine.getStat(id("tokened"), "strength"), 3, "its own tokens do not boost another character");
  assert.equal(engine.getStat(id("bc"), "life"), 5);
  const withTokens = corpsBoard({ tokens: 2 });
  assert.equal(withTokens.engine.getStat(withTokens.id("bc"), "life"), 5, "tokens add strength only");
  assert.equal(withTokens.engine.getStat(withTokens.id("bc"), "speed"), 3);
});

clause(CORPS, "1:rule", "start of my turn: I'm asked (me, not the opponent) to pick one of my characters, and the pick is optional", () => {
  const game = corpsBoard();
  corpsTurnStart(game);
  const pc = pending(game.engine)!;
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P1);
  const decl = (pc.declarations as { id: string; count: number; optional?: boolean }[])[0];
  assert.equal(decl.count, 1);
  assert.equal(decl.optional, true, "'you may pick'");
});

clause(CORPS, "1:rule", "picking one of my characters destroys it and puts X tokens on this card, X = the destroyed character's strength (3), making it 8 strength", () => {
  const game = corpsBoard();
  corpsTurnStart(game);
  pickCorps(game, [game.id("a")]);
  const { engine, id } = game;
  assert.equal(zoneOf(engine, id("a")), "discard", "the picked character is destroyed");
  assert.equal(tokensOn(engine, id("bc")), 3, "3 tokens = its strength");
  assert.equal(engine.getStat(id("bc"), "strength"), 8, "5 + 3 tokens");
  assert.equal(zoneOf(engine, id("bc")), "play", "this card is not destroyed");
  assert.equal(zoneOf(engine, id("b")), "play", "no other character is destroyed");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(pending(engine), undefined);
});

clause(CORPS, "1:rule", "a different character gives a different X (strength 2 gives 2 tokens), and the tokens are ADDED to those already on this card", () => {
  const game = corpsBoard({ tokens: 2 });
  corpsTurnStart(game);
  pickCorps(game, [game.id("b")]);
  const { engine, id } = game;
  assert.equal(zoneOf(engine, id("b")), "discard");
  assert.equal(tokensOn(engine, id("bc")), 4, "2 existing + 2");
  assert.equal(engine.getStat(id("bc"), "strength"), 9, "5 + 4");
});

clause(CORPS, "1:rule", "X is the destroyed character's strength when it was destroyed, including bonuses (+2 from a static effect: 3+2 = 5 tokens)", () => {
  const game = corpsBoard({ extra: [{ key: "banner", def: bannerDef(), owner: P1, zone: "play" }] });
  const { engine, id } = game;
  assert.equal(engine.getStat(id("a"), "strength"), 5, "control: the Banner gives +2");
  corpsTurnStart(game);
  pickCorps(game, [id("a")]);
  assert.equal(zoneOf(engine, id("a")), "discard");
  assert.equal(tokensOn(engine, id("bc")), 5, "its modified strength of 5");
  assert.equal(engine.getStat(id("bc"), "strength"), 12, "5 + 2 (Banner) + 5 tokens");
});

clause(CORPS, "1:rule", "X counts the picked character's own tokens: a destroyed Berserker Corps with 2 tokens (strength 7) gives 7 tokens", () => {
  const game = corpsBoard({ extra: [{ key: "bc2", def: printing(CORPS), owner: P1, zone: "play", counters: { token: 2 } }] });
  const { engine, id } = game;
  assert.equal(engine.getStat(id("bc2"), "strength"), 7, "control");
  corpsTurnStart(game);
  // Both Corps trigger at my turn start; answer each prompt, in whatever order they come.
  let n = 0;
  while (pending(engine) && n++ < 6) {
    const pc = pending(engine)!;
    if (pc.kind === "orderTriggers") {
      const triggers = pc.triggers as { sourceId: string }[];
      answerPending(engine, "orderTriggers", { next: triggers.find((t) => t.sourceId === id("bc")) });
    } else {
      const mine = pc.sourceId === id("bc");
      answerPending(engine, "selectTargets", { selected: { picked: mine ? [id("bc2")] : [] } });
    }
  }
  assert.equal(zoneOf(engine, id("bc2")), "discard", "the second Corps was picked and destroyed by the first (or declined and destroyed itself)");
  assert.equal(zoneOf(engine, id("bc")), "play");
  assert.equal(tokensOn(engine, id("bc")), 7, "7 tokens: the destroyed Corps' strength (5 + 2 tokens)");
});

clause(CORPS, "1:rule", "'Otherwise': declining to pick destroys THIS card; no other character is destroyed and no tokens are put anywhere", () => {
  const game = corpsBoard({ tokens: 2 });
  corpsTurnStart(game);
  pickCorps(game, []);
  const { engine, id } = game;
  assert.equal(zoneOf(engine, id("bc")), "discard", "this card is destroyed");
  assert.equal(zoneOf(engine, id("a")), "play");
  assert.equal(zoneOf(engine, id("b")), "play");
  assert.equal(tokensOn(engine, id("a")), 0);
  assert.equal(tokensOn(engine, id("b")), 0);
  assert.equal(pending(engine), undefined);
});

clause(CORPS, "1:rule", "'If you do': when I pick, this card is NOT destroyed too", () => {
  const game = corpsBoard();
  corpsTurnStart(game);
  pickCorps(game, [game.id("b")]);
  assert.equal(zoneOf(game.engine, game.id("bc")), "play");
});

clause(CORPS, "1:rule", "I may pick this card itself (a character I control): it is destroyed", () => {
  const game = corpsBoard();
  corpsTurnStart(game);
  pickCorps(game, [game.id("bc")]);
  assert.equal(zoneOf(game.engine, game.id("bc")), "discard");
  assert.equal(zoneOf(game.engine, game.id("a")), "play", "nothing else is destroyed");
  assert.equal(pending(game.engine), undefined);
});

clause(CORPS, "1:rule", "...and the tokens put on it then disappear with it, since a card that left play keeps no tokens (CR 409.2)", () => {
  const game = corpsBoard();
  corpsTurnStart(game);
  pickCorps(game, [game.id("bc")]);
  assert.equal(zoneOf(game.engine, game.id("bc")), "discard");
  assert.equal(tokensOn(game.engine, game.id("bc")), 0, "no tokens on a card in the discard pile");
});

clause(CORPS, "1:rule", "the pick is limited to characters I control in play: the opponent's character, a character in my hand, my item, my location and two characters are refused", () => {
  const game = corpsBoard();
  corpsTurnStart(game);
  const { engine, id } = game;
  refused(() => pickCorps(game, [id("foe")]), "the opponent's character");
  refused(() => pickCorps(game, [id("handChar")]), "a character in my hand");
  refused(() => pickCorps(game, [id("myItem")]), "my item");
  refused(() => pickCorps(game, [id("myLoc")]), "my location");
  refused(() => pickCorps(game, [engine.state.players[P1].factionId!]), "my faction (CR 202.9a)");
  refused(() => pickCorps(game, [id("a"), id("b")]), "pick a character: exactly one");
  assert.equal(pending(engine)?.kind, "selectTargets", "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("foe")), "play");
  pickCorps(game, [id("a")]);
  assert.equal(zoneOf(engine, id("a")), "discard", "control: my character works");
});

clause(CORPS, "1:rule", "it triggers only at the start of MY turn: at the start of the opponent's turn nothing happens", () => {
  const game = corpsBoard({ active: P1, tokens: 1 });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(pending(game.engine), undefined, "no prompt for anyone");
  assert.equal(zoneOf(game.engine, game.id("bc")), "play");
  assert.equal(tokensOn(game.engine, game.id("bc")), 1);
  assert.equal(zoneOf(game.engine, game.id("a")), "play");
});

clause(CORPS, "1:rule", "a Berserker Corps controlled by the opponent triggers on THEIR turn start, not mine", () => {
  const game = corpsBoard({ extra: [{ key: "theirs", def: printing(CORPS), owner: P2, zone: "play" }] });
  corpsTurnStart(game);
  const pcs: string[] = [];
  let n = 0;
  while (pending(game.engine) && n++ < 6) {
    const pc = pending(game.engine)!;
    pcs.push(`${pc.playerId}:${pc.sourceId === game.id("bc") ? "mine" : "theirs"}`);
    answerPending(game.engine, "selectTargets", { selected: { picked: [game.id("b")] } });
  }
  assert.deepEqual(pcs, ["p1:mine"], "only my own Corps asks me, once");
  assert.equal(zoneOf(game.engine, game.id("theirs")), "play", "the opponent's Corps was not destroyed on my turn");
});

// =================================================================================
// Bladefist Doomwing
// UNIQUE BLADEFIST
// FIREBREATHING -- COST: Choose a number for X. Pay X+X. Deplete this card. Pick a character. -- EFFECT: Inflict X damage to the character.
// Character, warlord, subtype dragon, cost 9, threshold [R][R], 6/6/3 (str/life/speed).
// =================================================================================

const DOOMWING = "6aedf9d7-250b-40ff-8af8-7bcb83452456";

function wingBoard(opts: { rage?: number; depleted?: boolean; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "bf", def: printing(DOOMWING), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe5", def: character({ name: "Foe5", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" },
      ...bank("rage", opts.rage ?? 12, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const breathe = (g: ReturnType<typeof wingBoard>, target: string, x: number) =>
  activate(g.engine, P1, g.id("bf"), "firebreathing", { selected: { c: [g.id(target)] }, variables: { x } });

clause(DOOMWING, "0:unique", "controlling a second Doomwing makes me choose which to keep; the other is destroyed", () => {
  const b = wingBoard({ extra: [{ key: "bf2", def: printing(DOOMWING), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bf2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("bf"), b.id("bf2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bf") } } as never);
  assert.equal(zoneOf(b.engine, b.id("bf")), "play");
  assert.equal(zoneOf(b.engine, b.id("bf2")), "discard", "the copy that was not kept is destroyed");
});

clause(DOOMWING, "0:unique", "the restriction is per player: the opponent may control their own Doomwing", () => {
  const b = wingBoard({ extra: [{ key: "bf2", def: printing(DOOMWING), owner: P2, zone: "play" }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("bf")), "play");
  assert.equal(zoneOf(b.engine, b.id("bf2")), "play");
});

clause(DOOMWING, "1:ability:firebreathing", "X=2: pay X+X = 4 resources, deplete this card, inflict 2 damage to the picked character (and only to it)", () => {
  const g = wingBoard();
  const { engine, id } = g;
  const ready = engine.getAvailableResourceCount(P1);
  breathe(g, "foe5", 2);
  assert.equal(ready - engine.getAvailableResourceCount(P1), 4, "X+X = 4 resources spent");
  assert.equal(engine.state.cards[id("bf")].depleted, true, "this card is depleted");
  assert.equal(damageOf(engine, id("foe5")), 2, "X = 2 damage");
  assert.equal(zoneOf(engine, id("foe5")), "play");
  for (const key of ["foe", "mine", "bf"]) assert.equal(damageOf(engine, id(key)), 0, `${key} takes no damage`);
  assert.equal(pending(engine), undefined);
});

clause(DOOMWING, "1:ability:firebreathing", "other values of X: X=1 pays 2 and deals 1; X=3 pays 6 and deals 3, destroying a 3-life character", () => {
  const one = wingBoard();
  const ready1 = one.engine.getAvailableResourceCount(P1);
  breathe(one, "foe5", 1);
  assert.equal(ready1 - one.engine.getAvailableResourceCount(P1), 2);
  assert.equal(damageOf(one.engine, one.id("foe5")), 1);
  const three = wingBoard();
  const ready3 = three.engine.getAvailableResourceCount(P1);
  breathe(three, "foe", 3);
  assert.equal(ready3 - three.engine.getAvailableResourceCount(P1), 6);
  assert.equal(zoneOf(three.engine, three.id("foe")), "discard", "3 damage destroys the 3-life character");
});

clause(DOOMWING, "1:ability:firebreathing", "X=0 is a legal number: it pays nothing, still depletes, and inflicts no damage", () => {
  const g = wingBoard();
  const ready = g.engine.getAvailableResourceCount(P1);
  breathe(g, "foe", 0);
  assert.equal(ready - g.engine.getAvailableResourceCount(P1), 0, "pays 0");
  assert.equal(g.engine.state.cards[g.id("bf")].depleted, true);
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(DOOMWING, "1:ability:firebreathing", "a large X: X=6 (12 resources) destroys a 6-life character", () => {
  const g = wingBoard({ rage: 12 });
  breathe(g, "mine", 6);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "all 12 resources spent");
});

clause(DOOMWING, "1:ability:firebreathing", "X+X must be affordable: 5 resources cannot pay for X=3 (6); 6 can; 3 cannot pay X=2 (4)", () => {
  const short = wingBoard({ rage: 5 });
  refused(() => breathe(short, "foe", 3), "5 resources is one short of 6", /cost|resource|afford|pay/i);
  assert.equal(short.engine.state.cards[short.id("bf")].depleted, false, "nothing was paid or depleted");
  assert.equal(damageOf(short.engine, short.id("foe")), 0);
  const few = wingBoard({ rage: 3 });
  refused(() => breathe(few, "foe", 2), "X+X is 4, not X", /cost|resource|afford|pay/i);
  assert.equal(damageOf(few.engine, few.id("foe")), 0);
  const exact = wingBoard({ rage: 6 });
  breathe(exact, "foe", 3);
  assert.equal(zoneOf(exact.engine, exact.id("foe")), "discard", "control: exactly 6 resources do pay for X=3");
});

clause(DOOMWING, "1:ability:firebreathing", "it cannot be used while depleted (and again right after using it)", () => {
  const g = wingBoard({ depleted: true });
  refused(() => breathe(g, "foe", 1), "Deplete this card is a cost", /deplet|cost|cannot/i);
  assert.equal(damageOf(g.engine, g.id("foe")), 0);
  assert.equal(g.engine.getAvailableResourceCount(P1), 12, "nothing was paid");
  const used = wingBoard();
  breathe(used, "foe5", 1);
  refused(() => breathe(used, "foe5", 1), "now depleted", /deplet|cost|cannot/i);
  assert.equal(damageOf(used.engine, used.id("foe5")), 1, "only the first use inflicted damage");
});

clause(DOOMWING, "1:ability:firebreathing", "the picked character may be any character in play: my own character and the Doomwing itself take the damage too", () => {
  const own = wingBoard();
  breathe(own, "mine", 2);
  assert.equal(damageOf(own.engine, own.id("mine")), 2, "my own character");
  const self = wingBoard();
  breathe(self, "bf", 2);
  assert.equal(damageOf(self.engine, self.id("bf")), 2, "the Doomwing itself");
  assert.equal(zoneOf(self.engine, self.id("bf")), "play");
});

clause(DOOMWING, "1:ability:firebreathing", "only a character can be picked: a location, an item, a character in hand, a faction, and no pick at all are refused", () => {
  const g = wingBoard();
  refused(() => breathe(g, "loc", 1), "a location");
  refused(() => breathe(g, "thing", 1), "an item");
  refused(() => breathe(g, "handChar", 1), "a character in a hand");
  refused(() => activate(g.engine, P1, g.id("bf"), "firebreathing", { selected: { c: [g.engine.state.players[P2].factionId!] }, variables: { x: 1 } }), "a faction (CR 202.9a)");
  refused(() => activate(g.engine, P1, g.id("bf"), "firebreathing", { selected: {}, variables: { x: 1 } }), "'pick a character' is part of the cost");
  refused(() => activate(g.engine, P1, g.id("bf"), "firebreathing", { selected: { c: [g.id("foe"), g.id("foe5")] }, variables: { x: 1 } }), "one character only");
  assert.equal(g.engine.state.cards[g.id("bf")].depleted, false, "nothing was paid by the refused attempts");
  assert.equal(damageOf(g.engine, g.id("loc")), 0);
  breathe(g, "foe", 1);
  assert.equal(damageOf(g.engine, g.id("foe")), 1, "control: a character works");
});

clause(DOOMWING, "1:ability:firebreathing", "X cannot be negative: -1 is refused and nothing is paid", () => {
  const neg = wingBoard();
  refused(() => breathe(neg, "foe5", -1), "negative X");
  assert.equal(damageOf(neg.engine, neg.id("foe5")), 0);
  assert.equal(neg.engine.getAvailableResourceCount(P1), 12, "nothing paid");
  assert.equal(neg.engine.state.cards[neg.id("bf")].depleted, false);
});

clause(DOOMWING, "1:ability:firebreathing", "X must be a whole number (CR 410.2): a fraction (1.5) is refused and nothing is paid", () => {
  const frac = wingBoard();
  refused(() => breathe(frac, "foe5", 1.5), "a fractional number");
  assert.equal(damageOf(frac.engine, frac.id("foe5")), 0);
  assert.equal(frac.engine.getAvailableResourceCount(P1), 12, "nothing paid");
  assert.equal(frac.engine.state.cards[frac.id("bf")].depleted, false);
});

clause(DOOMWING, "1:ability:firebreathing", "it is an ability: usable in response on the opponent's turn too", () => {
  const g = wingBoard({ active: P2 });
  const { engine, id } = g;
  playRaw(engine, P2, id("nothing"));
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("bf"), abilityId: "firebreathing", selected: { c: [id("foe5")] }, variables: { x: 2 } });
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("foe5")), 2);
  assert.equal(engine.state.cards[id("bf")].depleted, true);
});

// =================================================================================
// Bloodcurdling Bulldozer
// If this card attacks, you may pick a character. If you do, deplete it.
// Character, warlord, subtype berserker, cost 3, threshold [R], 2/1/3 (str/life/speed).
// =================================================================================

const BULLDOZER = "0e7b6eac-0639-4486-b820-8e33a2c53dfd";

function dozerBoard(opts: { active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "bd", def: printing(BULLDOZER), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "BlockerA", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "BlockerB", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "handChar", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      ...(opts.extra ?? [])
    ]
  });
}

const dozerAttacks = (g: ReturnType<typeof dozerBoard>, party: string[] = ["bd"]) => declareAttackBy(g.engine, P1, party.map((k) => g.id(k)));
const dozerPick = (g: ReturnType<typeof dozerBoard>, selected: CardInstanceId[]) => answerPending(g.engine, "selectTargets", { selected: { target: selected } });
const isDepleted = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].depleted;
const battleDeclared = (engine: SpoilsEngine) => engine.state.battle?.blockingParty;

clause(BULLDOZER, "0:rule", "when it attacks I am asked whether to pick a character: the pick is optional and limited to one", () => {
  const g = dozerBoard();
  dozerAttacks(g);
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P1);
  const decl = (pc.declarations as { id: string; count: number; optional?: boolean }[])[0];
  assert.equal(decl.count, 1);
  assert.equal(decl.optional, true, "'you may pick'");
});

clause(BULLDOZER, "0:rule", "picking an opposing character depletes it, so it cannot block (the other character still can)", () => {
  const g = dozerBoard();
  dozerAttacks(g);
  assert.equal(isDepleted(g.engine, g.id("blk")), false, "control: ready before the pick");
  dozerPick(g, [g.id("blk")]);
  assert.equal(isDepleted(g.engine, g.id("blk")), true, "depleted");
  assert.equal(isDepleted(g.engine, g.id("blk2")), false, "only the picked character is depleted");
  refused(() => declareBlockers(g.engine, P2, [g.id("blk")]), "a depleted character cannot block", /deplet|block|cannot/i);
  declareBlockers(g.engine, P2, [g.id("blk2")]);
  assert.deepEqual(battleDeclared(g.engine), [g.id("blk2")], "control: the other one blocks");
});

clause(BULLDOZER, "0:rule", "'may': declining deplets nothing, and the character can block", () => {
  const g = dozerBoard();
  dozerAttacks(g);
  dozerPick(g, []);
  assert.equal(isDepleted(g.engine, g.id("blk")), false);
  assert.equal(isDepleted(g.engine, g.id("blk2")), false);
  assert.equal(pending(g.engine), undefined);
  declareBlockers(g.engine, P2, [g.id("blk")]);
  assert.deepEqual(battleDeclared(g.engine), [g.id("blk")]);
});

clause(BULLDOZER, "0:rule", "'pick a character' is not limited to opponents: one of my own characters can be picked and depleted", () => {
  const g = dozerBoard();
  dozerAttacks(g);
  dozerPick(g, [g.id("ally")]);
  assert.equal(isDepleted(g.engine, g.id("ally")), true);
  assert.equal(isDepleted(g.engine, g.id("blk")), false);
});

clause(BULLDOZER, "0:rule", "only a character in play can be picked: an item, a location, a character in hand, a faction and two characters are refused", () => {
  const g = dozerBoard();
  dozerAttacks(g);
  refused(() => dozerPick(g, [g.id("thing")]), "an item");
  refused(() => dozerPick(g, [g.id("loc")]), "a location");
  refused(() => dozerPick(g, [g.id("handChar")]), "a character in a hand");
  refused(() => dozerPick(g, [g.engine.state.players[P2].factionId!]), "a faction (CR 202.9a)");
  refused(() => dozerPick(g, [g.id("blk"), g.id("blk2")]), "pick a character: at most one");
  assert.equal(pending(g.engine)?.kind, "selectTargets", "still waiting for a legal pick");
  assert.equal(isDepleted(g.engine, g.id("blk")), false);
  dozerPick(g, [g.id("blk")]);
  assert.equal(isDepleted(g.engine, g.id("blk")), true, "control: a character works");
});

clause(BULLDOZER, "0:rule", "it triggers when it attacks as part of a party with another character too", () => {
  const g = dozerBoard();
  dozerAttacks(g, ["bd", "ally"]);
  assert.equal(pending(g.engine)?.kind, "selectTargets");
  dozerPick(g, [g.id("blk")]);
  assert.equal(isDepleted(g.engine, g.id("blk")), true);
});

clause(BULLDOZER, "0:rule", "it triggers whatever it attacks: also when it attacks a location", () => {
  const g = dozerBoard();
  declareAttackBy(g.engine, P1, [g.id("bd")], { type: "card", cardId: g.id("loc") });
  assert.equal(pending(g.engine)?.kind, "selectTargets");
  assert.equal(pending(g.engine)?.playerId, P1);
  dozerPick(g, [g.id("blk2")]);
  assert.equal(isDepleted(g.engine, g.id("blk2")), true);
});

clause(BULLDOZER, "0:rule", "it does NOT trigger when another character attacks without it", () => {
  const g = dozerBoard();
  dozerAttacks(g, ["ally"]);
  assert.equal(pending(g.engine), undefined, "no prompt");
  assert.equal(isDepleted(g.engine, g.id("blk")), false);
  assert.equal(isDepleted(g.engine, g.id("bd")), false, "the Bulldozer stayed home");
});

clause(BULLDOZER, "0:rule", "it does NOT trigger when it blocks (only when it attacks)", () => {
  const g = dozerBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  assert.equal(pending(g.engine), undefined);
  declareBlockers(g.engine, P1, [g.id("bd")]);
  assert.equal(pending(g.engine), undefined, "blocking triggers nothing");
  assert.equal(isDepleted(g.engine, g.id("atk")), true, "(the attacker is only depleted by having attacked)");
  assert.equal(isDepleted(g.engine, g.id("ally")), false);
});

// =================================================================================
// Dragon Catheter
// At the start of your turn, put a token on the character with the highest strength. If there is a tie, you decide which character gets the token.
// All characters gain 1 strength for each token on them.
// Item, warlord, cost 3, threshold [R][R].
// =================================================================================

const CATHETER = "7b901516-9995-416d-8fdc-0d6e6fd38af8";

type CatChar = { key: string; owner: Pid; strength: number; tokens?: number; zone?: "play" | "hand" };

function catBoard(chars: CatChar[], opts: { catOwner?: Pid; catZone?: "play" | "hand"; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "ct", def: printing(CATHETER), owner: opts.catOwner ?? P1, zone: opts.catZone ?? "play" },
      ...chars.map((c): CardPlacement => ({
        key: c.key,
        def: character({ name: `Char ${c.key}`, strength: c.strength, life: 9, speed: 1 }),
        owner: c.owner,
        zone: c.zone ?? "play",
        counters: c.tokens ? { token: c.tokens } : undefined
      })),
      ...(opts.extra ?? [])
    ]
  });
}

const catPick = (g: ReturnType<typeof catBoard>, selected: CardInstanceId[]) => answerPending(g.engine, "chooserSelectsTarget", { selected });
const strengthOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.getStat(c, "strength");
/** The opponent ends their turn so MY turn starts: stops at my first prompt. */
const catMyTurnStarts = (g: ReturnType<typeof catBoard>) => endTurn(g.engine, P2);

clause(CATHETER, "0:rule", "at the start of my turn the character with the highest strength gets a token, even an opponent's: 4 beats 3 and 1", () => {
  const g = catBoard([{ key: "m1", owner: P1, strength: 3 }, { key: "f1", owner: P2, strength: 4 }, { key: "f2", owner: P2, strength: 1 }]);
  catMyTurnStarts(g);
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I am the one asked");
  catPick(g, [g.id("f1")]);
  assert.equal(tokensOn(g.engine, g.id("f1")), 1, "the highest-strength character gets the token");
  assert.equal(tokensOn(g.engine, g.id("m1")), 0);
  assert.equal(tokensOn(g.engine, g.id("f2")), 0);
  assert.equal(pending(g.engine), undefined);
});

clause(CATHETER, "0:rule", "...and when my own character is the highest, mine gets it", () => {
  const g = catBoard([{ key: "m1", owner: P1, strength: 5 }, { key: "f1", owner: P2, strength: 4 }]);
  catMyTurnStarts(g);
  catPick(g, [g.id("m1")]);
  assert.equal(tokensOn(g.engine, g.id("m1")), 1);
  assert.equal(tokensOn(g.engine, g.id("f1")), 0);
});

clause(CATHETER, "0:rule", "only the highest can be picked when there is no tie: another character is refused", () => {
  const g = catBoard([{ key: "m1", owner: P1, strength: 3 }, { key: "f1", owner: P2, strength: 4 }]);
  catMyTurnStarts(g);
  refused(() => catPick(g, [g.id("m1")]), "not the highest strength");
  refused(() => catPick(g, [g.id("m1"), g.id("f1")]), "one character only");
  refused(() => catPick(g, []), "the token is not optional");
  assert.equal(tokensOn(g.engine, g.id("m1")), 0);
  catPick(g, [g.id("f1")]);
  assert.equal(tokensOn(g.engine, g.id("f1")), 1, "control: the highest works");
});

clause(CATHETER, "0:rule", "a tie: I decide which of the tied characters gets the token, mine or the opponent's, and only one gets it", () => {
  for (const [pick, loser] of [["m1", "f1"], ["f1", "m1"]] as const) {
    const g = catBoard([{ key: "m1", owner: P1, strength: 4 }, { key: "f1", owner: P2, strength: 4 }, { key: "low", owner: P2, strength: 2 }]);
    catMyTurnStarts(g);
    assert.equal(pending(g.engine)?.playerId, P1, "the Catheter's controller decides");
    catPick(g, [g.id(pick)]);
    assert.equal(tokensOn(g.engine, g.id(pick)), 1, `${pick} got the token`);
    assert.equal(tokensOn(g.engine, g.id(loser)), 0, `${loser} did not`);
    assert.equal(tokensOn(g.engine, g.id("low")), 0);
  }
});

clause(CATHETER, "0:rule", "a tie excludes the lower character: it can't be picked, and neither can two at once", () => {
  const g = catBoard([{ key: "m1", owner: P1, strength: 4 }, { key: "f1", owner: P2, strength: 4 }, { key: "low", owner: P2, strength: 3 }]);
  catMyTurnStarts(g);
  refused(() => catPick(g, [g.id("low")]), "not tied for the highest");
  refused(() => catPick(g, [g.id("m1"), g.id("f1")]), "one token to one character");
  assert.equal(tokensOn(g.engine, g.id("m1")) + tokensOn(g.engine, g.id("f1")) + tokensOn(g.engine, g.id("low")), 0);
});

clause(CATHETER, "0:rule", "'highest strength' is the current strength: a character whose tokens raise it above a printed-higher one is the highest", () => {
  const g = catBoard([{ key: "m1", owner: P1, strength: 3, tokens: 2 }, { key: "f1", owner: P2, strength: 4 }]);
  assert.equal(strengthOf(g.engine, g.id("m1")), 5, "control: 3 + 2 tokens");
  catMyTurnStarts(g);
  refused(() => catPick(g, [g.id("f1")]), "4 is not the highest any more");
  catPick(g, [g.id("m1")]);
  assert.equal(tokensOn(g.engine, g.id("m1")), 3, "the new token is added to its existing ones");
  assert.equal(strengthOf(g.engine, g.id("m1")), 6);
});

clause(CATHETER, "0:rule", "only characters in play are considered: a stronger character in hand is ignored", () => {
  const g = catBoard([{ key: "m1", owner: P1, strength: 2 }, { key: "f1", owner: P2, strength: 1 }, { key: "big", owner: P1, strength: 9, zone: "hand" }]);
  catMyTurnStarts(g);
  refused(() => catPick(g, [g.id("big")]), "a character in hand");
  catPick(g, [g.id("m1")]);
  assert.equal(tokensOn(g.engine, g.id("m1")), 1);
});

clause(CATHETER, "0:rule", "it triggers every one of my turns: two turns later the (now stronger) character has 2 tokens", () => {
  const g = catBoard([{ key: "m1", owner: P1, strength: 3 }, { key: "f1", owner: P2, strength: 2 }]);
  catMyTurnStarts(g);
  catPick(g, [g.id("m1")]);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tokensOn(g.engine, g.id("m1")), 1, "nothing happens at the start of the opponent's turn");
  assert.equal(pending(g.engine), undefined);
  endTurn(g.engine, P2);
  catPick(g, [g.id("m1")]);
  assert.equal(tokensOn(g.engine, g.id("m1")), 2);
  assert.equal(strengthOf(g.engine, g.id("m1")), 5);
});

clause(CATHETER, "0:rule", "it triggers only at the start of ITS CONTROLLER's turn: an opposing Catheter does nothing on my turn, and works on theirs", () => {
  const g = catBoard([{ key: "m1", owner: P1, strength: 3 }, { key: "f1", owner: P2, strength: 2 }], { catOwner: P2 });
  catMyTurnStarts(g);
  assert.equal(pending(g.engine), undefined, "my turn: the opponent's Catheter is silent");
  assert.equal(tokensOn(g.engine, g.id("m1")), 0);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine)?.playerId, P2, "their turn: they decide");
  catPick(g, [g.id("m1")]);
  assert.equal(tokensOn(g.engine, g.id("m1")), 1, "the token goes on the highest, here mine");
});

clause(CATHETER, "0:rule", "with no character in play nothing happens (no prompt, no error); with the Catheter not in play there is no token either", () => {
  const empty = catBoard([]);
  catMyTurnStarts(empty);
  assert.equal(pending(empty.engine), undefined);
  const inHand = catBoard([{ key: "m1", owner: P1, strength: 3 }], { catZone: "hand" });
  catMyTurnStarts(inHand);
  assert.equal(pending(inHand.engine), undefined, "Catheter in hand: no trigger");
  assert.equal(tokensOn(inHand.engine, inHand.id("m1")), 0);
});

clause(CATHETER, "1:rule", "every character gains 1 strength per token on it, whoever controls it; characters without tokens are unchanged", () => {
  const g = catBoard([
    { key: "m1", owner: P1, strength: 3, tokens: 2 },
    { key: "f1", owner: P2, strength: 4, tokens: 1 },
    { key: "m2", owner: P1, strength: 2 },
    { key: "f2", owner: P2, strength: 1, tokens: 4 }
  ]);
  assert.equal(strengthOf(g.engine, g.id("m1")), 5);
  assert.equal(strengthOf(g.engine, g.id("f1")), 5);
  assert.equal(strengthOf(g.engine, g.id("m2")), 2, "no tokens: unchanged");
  assert.equal(strengthOf(g.engine, g.id("f2")), 5);
  assert.equal(g.engine.getStat(g.id("m1"), "life"), 9, "strength only");
  assert.equal(g.engine.getStat(g.id("m1"), "speed"), 1);
});

clause(CATHETER, "1:rule", "a token placed by the Catheter itself raises the character's strength by 1", () => {
  const g = catBoard([{ key: "m1", owner: P1, strength: 3 }]);
  catMyTurnStarts(g);
  catPick(g, [g.id("m1")]);
  assert.equal(strengthOf(g.engine, g.id("m1")), 4);
});

clause(CATHETER, "1:rule", "the bonus needs the Catheter in play: tokens give nothing while it is in hand, and the bonus ends when it is destroyed", () => {
  const inHand = catBoard([{ key: "m1", owner: P1, strength: 3, tokens: 2 }], { catZone: "hand" });
  assert.equal(strengthOf(inHand.engine, inHand.id("m1")), 3, "Catheter in hand: tokens are just tokens");
  const destroyItem = tactic({
    name: "Smash",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = catBoard([{ key: "m1", owner: P1, strength: 3, tokens: 2 }], { active: P1, extra: [{ key: "smash", def: destroyItem, owner: P1, zone: "hand" }] });
  assert.equal(strengthOf(g.engine, g.id("m1")), 5, "control: bonus with the Catheter in play");
  play(g.engine, P1, g.id("smash"), { selected: { t: [g.id("ct")] } });
  assert.equal(zoneOf(g.engine, g.id("ct")), "discard");
  assert.equal(strengthOf(g.engine, g.id("m1")), 3, "bonus gone");
  assert.equal(strengthOf(g.engine, g.id("m1")), 3, "...and stays gone");
});
