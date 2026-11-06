// ungodly-mess-03, part p2 (groups 6-8, missing clauses): Ghosts of Loot, God's Blessing of Moola,
// Gosche's Retained Earnings Vault.
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate, bank, character, developFaction, item, P1, P2, play, resolvePendingResponses, tactic, volition
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough } from "./_battle.js";
import { answerPending, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { endTurn, spentResources } from "./_turn.js";

const GHOST = "f536d2ec-e175-4834-a32c-643fecba715f"; // UNIQUE GHOSTS, cost 2, ggg, 1/3/1 ghost
const BLESSING = "effd6ee4-acf3-413e-b2c9-c6d2332e807d"; // UNIQUE BLESSING, tactic cost 6, ggg, ATTACH TO CHARACTER
const VAULT = "c8ff2521-ffd3-46e7-b3a4-9c6642e7d23b"; // location cost 2, g, structure 2

// ---------------------------------------------------------------- shared helpers

const influenceOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].influence;
const handOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].hand.length;
const stateOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c];
const ready = (engine: SpoilsEngine, p: PlayerId) => engine.getAvailableResourceCount(p);

function game(cards: CardPlacement[], over: { turn?: number; active?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards,
    turn: over.turn ?? 2,
    activePlayerId: over.active ?? P1
  });
}

function flipUp(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, variables: {} });
  resolvePendingResponses(engine);
}

function resolveChoice(engine: SpoilsEngine, player: PlayerId, choice: Record<string, unknown>): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice } as never);
  resolvePendingResponses(engine);
}

/** A free tactic that destroys any one card in play (decl `t`). */
const smash = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        { id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

/** A free tactic that returns any one character in play to its owner's hand (decl `t`). */
const bounce = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        { id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }
      ]
    }
  });

/** A free tactic that restores any one character in play (decl `t`). */
const refresh = () =>
  tactic({
    name: "Refresh",
    cost: 0,
    behavior: {
      abilities: [
        { id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

/** A free tactic that puts one of my discard-pile characters into play (decl `t`). */
const reanimate = () =>
  tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { owner: "self", zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

const SPEED_STRIKE_LAST = (name: string, strength: number, life: number) => character({ name, strength, life, speed: 1 });

// =====================================================================================
// Ghosts of Loot
// =====================================================================================

const deployGhost = (extra: CardPlacement[]) =>
  game([{ key: "gh", def: printing(GHOST), owner: P1, zone: "hand" }, ...extra, ...fillers("dk", 8, P1, "deck")]);

clause(GHOST, "0:unique", "printed card: character 1/3/1 ghost, cost 2, ggg: three greed deploys it and pays exactly 2; stats read 1/3/1", () => {
  const { engine, id } = deployGhost(bank("greed", 3, P1));
  assert.equal(ready(engine, P1), 3);
  play(engine, P1, id("gh"));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("gh")), "play");
  assert.equal(ready(engine, P1), 1, "cost 2 paid");
  assert.equal(engine.state.cards[id("gh")].faceDown ?? false, false);
  assert.equal(engine.getStat(id("gh"), "strength"), 1);
  assert.equal(engine.getStat(id("gh"), "speed"), 3);
  assert.equal(engine.getStat(id("gh"), "life"), 1);
  assert.equal(engine.getDefinition(id("gh")).type, "character");
  assert.deepEqual([...(engine.getDefinition(id("gh")).subtype ?? [])], ["ghost"]);
  assert.equal(engine.getDefinition(id("gh")).cost, 2);
  assert.equal(engine.getDefinition(id("gh")).threshold, "ggg");
});

clause(GHOST, "0:unique", "deploy is refused one [G] short (cost payable) and one resource short (threshold met)", () => {
  const okBoard = deployGhost(bank("greed", 3, P1));
  play(okBoard.engine, P1, okBoard.id("gh"));
  assert.equal(zoneOf(okBoard.engine, okBoard.id("gh")), "play", "control");

  const twoGreedOneRage = deployGhost([...bank("greed", 2, P1), ...bank("rage", 1, P1)]);
  assert.equal(ready(twoGreedOneRage.engine, P1), 3, "cost is payable");
  refused(() => play(twoGreedOneRage.engine, P1, twoGreedOneRage.id("gh")), "only 2 [G] of 3", /threshold|icon/i);
  assert.equal(zoneOf(twoGreedOneRage.engine, twoGreedOneRage.id("gh")), "hand");

  const twoGreed = deployGhost(bank("greed", 2, P1));
  refused(() => play(twoGreed.engine, P1, twoGreed.id("gh")), "only 2 greed", /threshold|icon|afford|resource|cost/i);
  assert.equal(zoneOf(twoGreed.engine, twoGreed.id("gh")), "hand");

  // Cost 2 with the icons met: 3 greed attached (spent) leaves 1 ready, which is one short of the cost.
  const spent = deployGhost([...spentResources(P1, 0), ...bank("greed", 1, P1), ...bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))]);
  assert.equal(ready(spent.engine, P1), 1);
  refused(() => play(spent.engine, P1, spent.id("gh")), "1 ready resource of the 2 cost", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(spent.engine, spent.id("gh")), "hand");
});

clause(GHOST, "0:unique", "UNIQUE GHOSTS: a second Ghosts of Loot makes me choose which to keep; the other is destroyed", () => {
  const mk = () => deployGhost([...bank("greed", 3, P1), { key: "g1", def: printing(GHOST), owner: P1, zone: "play" }]);
  const a = mk();
  play(a.engine, P1, a.id("gh"));
  const pc = pending(a.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [a.id("g1"), a.id("gh")].sort());
  resolveChoice(a.engine, P1, { kind: "uniqueSurvivor", keep: a.id("g1") });
  assert.equal(zoneOf(a.engine, a.id("g1")), "play");
  assert.equal(zoneOf(a.engine, a.id("gh")), "discard");
  const b = mk();
  play(b.engine, P1, b.id("gh"));
  resolveChoice(b.engine, P1, { kind: "uniqueSurvivor", keep: b.id("gh") });
  assert.equal(zoneOf(b.engine, b.id("g1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("gh")), "play");
});

clause(GHOST, "0:unique", "the UNIQUE identifier is GHOSTS: another card of mine carrying the identifier 'ghosts' (a different name) also forces the choice", () => {
  const b = deployGhost([...bank("greed", 3, P1), { key: "imposter", def: character({ name: "Imposter", unique: "ghosts" }), owner: P1, zone: "play" }]);
  play(b.engine, P1, b.id("gh"));
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor", "sharing the identifier GHOSTS forces a survivor choice");
  assert.deepEqual([...pc.candidates].sort(), [b.id("gh"), b.id("imposter")].sort());
});

clause(GHOST, "0:unique", "UNIQUE is per player: the opponent's Ghosts of Loot forces no choice", () => {
  const b = deployGhost([...bank("greed", 3, P1), { key: "theirs", def: printing(GHOST), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("gh"));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("gh")), "play");
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
});

// ---- 1:rule  When this card blocks, your faction loses 2 influence and this card gains 4 life this turn.

const blockBoard = (extra: CardPlacement[] = []) =>
  game([
    { key: "gh", def: printing(GHOST), owner: P2, zone: "play" },
    { key: "atk", def: SPEED_STRIKE_LAST("Atk", 4, 9), owner: P1, zone: "play" },
    { key: "alt", def: character({ name: "Alt", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" },
    ...extra
  ]);

clause(GHOST, "1:rule", "when it blocks, its controller's faction loses exactly 2 influence and it gains exactly 4 life (survives 4 damage)", () => {
  const { engine, id } = blockBoard();
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  declareAttackBy(engine, P1, [id("atk")]);
  assert.equal(influenceOf(engine, P2), theirs, "nothing yet: it hasn't blocked");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("gh")] });
  resolvePendingResponses(engine);
  assert.equal(influenceOf(engine, P2), theirs - 2, "blocker's faction loses 2");
  assert.equal(influenceOf(engine, P1), mine, "attacker's faction unaffected");
  assert.equal(engine.getStat(id("gh"), "life"), 5, "1 + 4");
  finishBattle(engine);
  assert.equal(zoneOf(engine, id("gh")), "play", "survived the 4 damage");
});

clause(GHOST, "1:rule", "the +4 life is what lets it survive a 4-strength attacker; the blocked battle then ends with the Ghost alive and 4 damaged", () => {
  const { engine, id } = blockBoard();
  const theirs = influenceOf(engine, P2);
  fightThrough(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("gh")]);
  assert.equal(zoneOf(engine, id("gh")), "play");
  assert.equal(stateOf(engine, id("gh")).damage, 4);
  assert.equal(influenceOf(engine, P2), theirs - 2, "blocked: no combat damage to the faction, only the 2 loss");
});

clause(GHOST, "1:rule", "the life bonus lasts only this turn", () => {
  const { engine, id } = blockBoard();
  fightThrough(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("gh")]);
  assert.equal(engine.getStat(id("gh"), "life"), 5, "still this turn");
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("gh"), "life"), 1, "back to printed life next turn");
});

clause(GHOST, "1:rule", "does not trigger when another character blocks, or when the Ghost doesn't block", () => {
  const { engine, id } = blockBoard();
  const theirs = influenceOf(engine, P2);
  declareAttackBy(engine, P1, [id("atk")]);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("alt")] });
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(engine, P2), theirs, "no loss");
  assert.equal(engine.getStat(id("gh"), "life"), 1, "no bonus");
});

clause(GHOST, "1:rule", "attacking does not trigger the block clause (no life bonus, influence rises instead)", () => {
  const { engine, id } = game([
    { key: "gh", def: printing(GHOST), owner: P1, zone: "play" },
    { key: "blk", def: character({ name: "Blk", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }
  ]);
  declareAttackBy(engine, P1, [id("gh")]);
  assert.equal(engine.getStat(id("gh"), "life"), 1);
});

// ---- 2:rule  When this card attacks, your faction gains 1 influence and this card gains 2 strength this turn.

const attackBoard = (extra: CardPlacement[] = []) =>
  game([
    { key: "gh", def: printing(GHOST), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
    { key: "blk", def: character({ name: "Blk", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" },
    ...extra
  ]);

clause(GHOST, "2:rule", "when it attacks, its controller's faction gains exactly 1 influence and it gains exactly 2 strength (blocker takes 3)", () => {
  const { engine, id } = attackBoard();
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  declareAttackBy(engine, P1, [id("gh")]);
  assert.equal(influenceOf(engine, P1), mine + 1);
  assert.equal(influenceOf(engine, P2), theirs, "defender unaffected");
  assert.equal(engine.getStat(id("gh"), "strength"), 3, "1 + 2");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("blk")] });
  resolvePendingResponses(engine);
  finishBattle(engine);
  assert.equal(stateOf(engine, id("blk")).damage, 3, "struck for 3");
});

clause(GHOST, "2:rule", "unblocked, the strength bonus is dealt to the faction (3 damage)", () => {
  const { engine, id } = attackBoard();
  const theirs = influenceOf(engine, P2);
  fightThrough(engine, P1, [id("gh")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(engine, P2), theirs - 3);
});

clause(GHOST, "2:rule", "the strength bonus lasts only this turn", () => {
  const { engine, id } = attackBoard();
  declareAttackBy(engine, P1, [id("gh")]);
  assert.equal(engine.getStat(id("gh"), "strength"), 3);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  finishBattle(engine);
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("gh"), "strength"), 1);
});

clause(GHOST, "2:rule", "does not trigger when another character attacks, or when the Ghost blocks (block gives no strength)", () => {
  const { engine, id } = attackBoard();
  const mine = influenceOf(engine, P1);
  declareAttackBy(engine, P1, [id("other")]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(engine, P1), mine, "no gain");
  assert.equal(engine.getStat(id("gh"), "strength"), 1, "no bonus");

  const b = game([
    { key: "gh", def: printing(GHOST), owner: P2, zone: "play" },
    { key: "atk", def: character({ name: "Atk", strength: 0, life: 9, speed: 1 }), owner: P1, zone: "play" }
  ]);
  const theirs = influenceOf(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("gh")] });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("gh"), "strength"), 1, "blocking gives no strength");
  assert.equal(influenceOf(b.engine, P2), theirs - 2, "(the block clause's loss only, no attack gain)");
});

// ---- 3:rule@vv  [V][V]: When this card enters play, draw a card.

const etbBoard = (vols: number) => deployGhost([...bank("greed", 3, P1), ...volition(vols, P1)]);

clause(GHOST, "3:rule@vv", "with [V][V] when it enters play (deployed) I draw exactly 1 card", () => {
  const { engine, id } = etbBoard(2);
  const hand = handOf(engine, P1);
  const deck = engine.state.players[P1].deck.length;
  play(engine, P1, id("gh"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("gh")), "play");
  assert.equal(handOf(engine, P1), hand - 1 + 1, "ghost left hand, one card drawn");
  assert.equal(engine.state.players[P1].deck.length, deck - 1);
});

clause(GHOST, "3:rule@vv", "with only one [V] or none, entering draws nothing", () => {
  for (const vols of [0, 1]) {
    const { engine, id } = etbBoard(vols);
    const hand = handOf(engine, P1);
    play(engine, P1, id("gh"));
    drain(engine, declineAll);
    assert.equal(zoneOf(engine, id("gh")), "play");
    assert.equal(handOf(engine, P1), hand - 1, `${vols} [V]: no draw`);
  }
  const more = etbBoard(3);
  const hand = handOf(more.engine, P1);
  play(more.engine, P1, more.id("gh"));
  drain(more.engine, declineAll);
  assert.equal(handOf(more.engine, P1), hand, "3 [V] still draws exactly one card");
});

clause(GHOST, "3:rule@vv", "also draws when it enters play by an effect (put into play from the discard pile)", () => {
  const { engine, id } = game([
    { key: "gh", def: printing(GHOST), owner: P1, zone: "discard" },
    { key: "re", def: reanimate(), owner: P1, zone: "hand" },
    ...volition(2, P1),
    ...fillers("dk", 8, P1, "deck")
  ]);
  const hand = handOf(engine, P1);
  play(engine, P1, id("re"), { selected: { t: [id("gh")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("gh")), "play");
  assert.equal(handOf(engine, P1), hand - 1 + 1, "tactic left hand, one card drawn");
});

clause(GHOST, "3:rule@vv", "another card entering play doesn't draw (only 'this card')", () => {
  const { engine, id } = game([
    { key: "gh", def: printing(GHOST), owner: P1, zone: "play" },
    { key: "nc", def: character({ name: "NewChar", cost: 0 }), owner: P1, zone: "hand" },
    ...volition(2, P1),
    ...fillers("dk", 8, P1, "deck")
  ]);
  const hand = handOf(engine, P1);
  play(engine, P1, id("nc"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("nc")), "play");
  assert.equal(handOf(engine, P1), hand - 1, "no draw");
});

// ---- 4:rule@vvvvv  [V]x5: When this card is destroyed, draw 4 cards.

const dieBoard = (vols: number) =>
  game([
    { key: "gh", def: printing(GHOST), owner: P1, zone: "play" },
    { key: "oth", def: character({ name: "Oth" }), owner: P1, zone: "play" },
    { key: "sm", def: smash(), owner: P1, zone: "hand" },
    { key: "bn", def: bounce(), owner: P1, zone: "hand" },
    ...volition(vols, P1),
    ...fillers("dk", 10, P1, "deck")
  ]);

clause(GHOST, "4:rule@vvvvv", "with [V]x5, destroyed it draws exactly 4 cards", () => {
  const { engine, id } = dieBoard(5);
  const hand = handOf(engine, P1);
  const deck = engine.state.players[P1].deck.length;
  play(engine, P1, id("sm"), { selected: { t: [id("gh")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("gh")), "discard");
  assert.equal(handOf(engine, P1), hand - 1 + 4, "smash left hand, four drawn");
  assert.equal(engine.state.players[P1].deck.length, deck - 4);
});

clause(GHOST, "4:rule@vvvvv", "with four [V] (one short) or none, destroyed it draws nothing", () => {
  for (const vols of [0, 4]) {
    const { engine, id } = dieBoard(vols);
    const hand = handOf(engine, P1);
    play(engine, P1, id("sm"), { selected: { t: [id("gh")] } });
    drain(engine, declineAll);
    assert.equal(zoneOf(engine, id("gh")), "discard");
    assert.equal(handOf(engine, P1), hand - 1, `${vols} [V]: no draw`);
  }
  const six = dieBoard(6);
  const hand = handOf(six.engine, P1);
  play(six.engine, P1, six.id("sm"), { selected: { t: [six.id("gh")] } });
  drain(six.engine, declineAll);
  assert.equal(handOf(six.engine, P1), hand - 1 + 4, "6 [V] draws exactly 4");
});

clause(GHOST, "4:rule@vvvvv", "only when it is destroyed: another character dying, or the Ghost leaving play without being destroyed, draws nothing", () => {
  const a = dieBoard(5);
  const hand = handOf(a.engine, P1);
  play(a.engine, P1, a.id("sm"), { selected: { t: [a.id("oth")] } });
  drain(a.engine, declineAll);
  assert.equal(zoneOf(a.engine, a.id("oth")), "discard");
  assert.equal(handOf(a.engine, P1), hand - 1, "another character destroyed: no draw");

  const b = dieBoard(5);
  const handB = handOf(b.engine, P1);
  play(b.engine, P1, b.id("bn"), { selected: { t: [b.id("gh")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("gh")), "hand");
  assert.equal(handOf(b.engine, P1), handB - 1 + 1, "bounced (not destroyed): only the card itself returned to hand, nothing drawn");
  assert.equal(b.engine.state.players[P1].deck.length, 10);
});

clause(GHOST, "4:rule@vvvvv", "destroyed in battle it also draws 4 (its controller draws)", () => {
  const { engine, id } = game([
    { key: "gh", def: printing(GHOST), owner: P2, zone: "play" },
    { key: "atk", def: character({ name: "Atk", strength: 9, life: 9, speed: 1 }), owner: P1, zone: "play" },
    ...volition(5, P2),
    ...fillers("dk", 10, P2, "deck")
  ]);
  const hand = handOf(engine, P2);
  fightThrough(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("gh")]);
  assert.equal(zoneOf(engine, id("gh")), "discard");
  assert.equal(handOf(engine, P2), hand + 4);
});

// ---- 5:flipUp  FLIP UP: 3 [G]

const faceDownGhost = (extra: CardPlacement[], over: { active?: PlayerId } = {}) =>
  game([{ key: "gh", def: printing(GHOST), owner: P1, zone: "play", faceDown: true }, ...extra, ...fillers("dk", 8, P1, "deck")], over);

clause(GHOST, "5:flipUp", "FLIP UP pays exactly 3 and needs [G]: one greed + two volition flips it up; it is deployed (CR 507.4) so with [V][V] the enters-play draw happens", () => {
  const { engine, id } = faceDownGhost([...bank("greed", 1, P1), ...volition(2, P1)]);
  const hand = handOf(engine, P1);
  assert.equal(ready(engine, P1), 4, "greed + 2 volition + the face-down Ghost");
  assert.equal(stateOf(engine, id("gh")).faceDown, true);
  flipUp(engine, P1, id("gh"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(stateOf(engine, id("gh")).faceDown, false);
  assert.equal(zoneOf(engine, id("gh")), "play");
  assert.equal(ready(engine, P1), 0, "3 paid, and the flipped Ghost is no longer a resource");
  assert.equal(handOf(engine, P1), hand + 1, "FLIP UP deploys the card (CR 507.4): its [V][V] enters-play draw happens");
  assert.equal(engine.getStat(id("gh"), "strength"), 1);
  assert.equal(engine.getStat(id("gh"), "life"), 1);
});

clause(GHOST, "5:flipUp", "flipped up without [V][V] nothing is drawn (the enters-play clause stays gated)", () => {
  const { engine, id } = faceDownGhost([...bank("greed", 3, P1)]);
  const hand = handOf(engine, P1);
  flipUp(engine, P1, id("gh"));
  assert.equal(stateOf(engine, id("gh")).faceDown, false);
  assert.equal(handOf(engine, P1), hand, "no draw");
});

clause(GHOST, "5:flipUp", "the face-down Ghost may pay for its own FLIP UP (2 others + itself = 3), but one resource less is refused", () => {
  const ok = faceDownGhost([...bank("greed", 1, P1), ...volition(1, P1)]);
  flipUp(ok.engine, P1, ok.id("gh"));
  assert.equal(stateOf(ok.engine, ok.id("gh")).faceDown, false, "N-1 others + itself pays the cost");
  const short = faceDownGhost([...bank("greed", 1, P1)]);
  refused(() => flipUp(short.engine, P1, short.id("gh")), "1 other + itself = 2 of the 3 cost", /afford|resource|pay|cost/i);
  assert.equal(stateOf(short.engine, short.id("gh")).faceDown, true);
  assert.equal(ready(short.engine, P1), 2, "nothing was paid");
});

clause(GHOST, "5:flipUp", "FLIP UP is refused with no [G] (cost payable)", () => {
  const ok = faceDownGhost([...bank("greed", 3, P1)]);
  flipUp(ok.engine, P1, ok.id("gh"));
  assert.equal(stateOf(ok.engine, ok.id("gh")).faceDown, false, "control");
  const noG = faceDownGhost([...bank("rage", 3, P1)]);
  assert.equal(ready(noG.engine, P1), 4, "cost is payable");
  refused(() => flipUp(noG.engine, P1, noG.id("gh")), "no [G]", /threshold|icon/i);
  assert.equal(stateOf(noG.engine, noG.id("gh")).faceDown, true);
  assert.equal(ready(noG.engine, P1), 4, "nothing was paid");
});

clause(GHOST, "5:flipUp", "a face-up Ghost can't be flipped up again", () => {
  const { engine, id } = game([{ key: "gh", def: printing(GHOST), owner: P1, zone: "play" }, ...bank("greed", 3, P1)]);
  refused(() => flipUp(engine, P1, id("gh")), "already face-up");
});

clause(GHOST, "5:flipUp", "FLIP UP of a non-tactic is refused inside the opponent's response window (positive control: allowed on my own turn)", () => {
  const own = faceDownGhost(bank("greed", 3, P1));
  flipUp(own.engine, P1, own.id("gh"));
  assert.equal(stateOf(own.engine, own.id("gh")).faceDown, false, "control");
  const b = faceDownGhost([...bank("greed", 3, P1), { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }], { active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => flipUp(b.engine, P1, b.id("gh")), "opponent's response window", /response|window|turn|tactic|only/i);
  assert.equal(stateOf(b.engine, b.id("gh")).faceDown, true);
});

// =====================================================================================
// God's Blessing of Moola
// =====================================================================================

const castBless = (resources: CardPlacement[], extra: CardPlacement[] = []) =>
  game([
    { key: "bl", def: printing(BLESSING), owner: P1, zone: "hand" },
    { key: "host", def: character({ name: "Host", strength: 3, life: 5 }), owner: P1, zone: "play" },
    ...resources,
    ...extra
  ]);
const sixGood = () => [...bank("greed", 3, P1), ...bank("rage", 3, P1)];

clause(BLESSING, "0:unique", "printed card: tactic (mutation) cost 6, ggg: deploys attached to the host for exactly 6 resources", () => {
  const { engine, id } = castBless(sixGood());
  assert.equal(ready(engine, P1), 6);
  play(engine, P1, id("bl"), { selected: { attachTo: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("bl")), "play");
  assert.equal(stateOf(engine, id("bl")).attachedTo, id("host"));
  assert.equal(ready(engine, P1), 0, "cost 6 paid");
  const def = engine.getDefinition(id("bl"));
  assert.equal(def.type, "tactic");
  assert.equal(def.cost, 6);
  assert.equal(def.threshold, "ggg");
  assert.deepEqual([...(def.subtype ?? [])], ["mutation"]);
});

clause(BLESSING, "0:unique", "deploy is refused one resource short (threshold met) and one [G] short (cost payable)", () => {
  const short = castBless([...bank("greed", 3, P1), ...bank("rage", 2, P1)]);
  assert.equal(ready(short.engine, P1), 5);
  refused(() => play(short.engine, P1, short.id("bl"), { selected: { attachTo: [short.id("host")] } }), "5 of the 6 cost", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("bl")), "hand");
  const noG = castBless([...bank("greed", 2, P1), ...bank("rage", 4, P1)]);
  assert.equal(ready(noG.engine, P1), 6, "cost is payable");
  refused(() => play(noG.engine, P1, noG.id("bl"), { selected: { attachTo: [noG.id("host")] } }), "2 [G] of 3", /threshold|icon/i);
  assert.equal(zoneOf(noG.engine, noG.id("bl")), "hand");
});

clause(BLESSING, "0:unique", "UNIQUE BLESSING: a second Blessing of Moola makes me choose which to keep", () => {
  const mk = () =>
    castBless(sixGood(), [
      { key: "host2", def: character({ name: "Host2" }), owner: P1, zone: "play" },
      { key: "b1", def: printing(BLESSING), owner: P1, zone: "play", attachedToKey: "host2" }
    ]);
  const a = mk();
  play(a.engine, P1, a.id("bl"), { selected: { attachTo: [a.id("host")] } });
  const pc = pending(a.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [a.id("b1"), a.id("bl")].sort());
  resolveChoice(a.engine, P1, { kind: "uniqueSurvivor", keep: a.id("b1") });
  assert.equal(zoneOf(a.engine, a.id("b1")), "play");
  assert.equal(zoneOf(a.engine, a.id("bl")), "discard");
  const b = mk();
  play(b.engine, P1, b.id("bl"), { selected: { attachTo: [b.id("host")] } });
  resolveChoice(b.engine, P1, { kind: "uniqueSurvivor", keep: b.id("bl") });
  assert.equal(zoneOf(b.engine, b.id("b1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("bl")), "play");
});

clause(BLESSING, "0:unique", "the UNIQUE identifier is BLESSING: another card of mine carrying the identifier 'blessing' (a different name) also forces the choice", () => {
  const b = castBless(sixGood(), [{ key: "imposter", def: character({ name: "Imposter", unique: "blessing" }), owner: P1, zone: "play" }]);
  play(b.engine, P1, b.id("bl"), { selected: { attachTo: [b.id("host")] } });
  const pc = pending(b.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor", "sharing the identifier BLESSING forces a survivor choice");
  assert.deepEqual([...pc.candidates].sort(), [b.id("bl"), b.id("imposter")].sort());
});

clause(BLESSING, "1:attach", "ATTACH TO CHARACTER: any character may host it (mine or the opponent's); an item or a location may not", () => {
  const mine = castBless(sixGood());
  play(mine.engine, P1, mine.id("bl"), { selected: { attachTo: [mine.id("host")] } });
  assert.equal(stateOf(mine.engine, mine.id("bl")).attachedTo, mine.id("host"), "control: my character");

  const theirs = castBless(sixGood(), [{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }]);
  play(theirs.engine, P1, theirs.id("bl"), { selected: { attachTo: [theirs.id("foe")] } });
  assert.equal(stateOf(theirs.engine, theirs.id("bl")).attachedTo, theirs.id("foe"), "opponent's character");

  const onItem = castBless(sixGood(), [{ key: "it", def: item({ name: "It" }), owner: P1, zone: "play" }]);
  refused(() => play(onItem.engine, P1, onItem.id("bl"), { selected: { attachTo: [onItem.id("it")] } }), "an item host", /attach|character|target|host/i);
  assert.equal(zoneOf(onItem.engine, onItem.id("bl")), "hand");

  const noHost = castBless(sixGood());
  refused(() => play(noHost.engine, P1, noHost.id("bl"), { selected: {} }), "no host chosen", /attach|character|target|host/i);
  assert.equal(zoneOf(noHost.engine, noHost.id("bl")), "hand");
});

clause(BLESSING, "2:rule", "the attached character gains the text: only while attached (a Blessing in play but unattached grants nothing; a character without it has no such rules)", () => {
  // With the Blessing attached to the host the host's controller's characters can't be restored by the rule; without it they can.
  const { engine, id } = blessedTurn();
  endTurn(engine, P2);
  assert.equal(stateOf(engine, id("ally")).depleted, true, "attached: lock applies");
  const control = blessedTurn({ blessed: false });
  endTurn(control.engine, P2);
  assert.equal(stateOf(control.engine, control.id("ally")).depleted, false, "control: no Blessing, the Restore Rule restores it");
});

// ---- the grant

/** P2's turn, P1 has a Blessing on `host`, `ally` (P1) and `foe` (P2) depleted; ending P2's turn starts P1's. */
function blessedTurn(over: { blessed?: boolean; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  return game(
    [
      { key: "host", def: character({ name: "Host", strength: 3, life: 5 }), owner: P1, zone: "play", depleted: true },
      ...(over.blessed === false ? [] : [{ key: "bl", def: printing(BLESSING), owner: P1, zone: "play" as const, attachedToKey: "host" }]),
      { key: "ally", def: character({ name: "Ally", strength: 3, life: 5 }), owner: P1, zone: "play", depleted: true },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5 }), owner: P2, zone: "play", depleted: true },
      ...(over.extra ?? []),
      ...fillers("dk", 10, P1, "deck"),
      ...fillers("dq", 10, P2, "deck")
    ],
    { active: over.active ?? P2, turn: 3 }
  );
}

// 3.0  When a character you control restores, it loses 1 strength this turn and you draw a card.

const refreshBoard = (extra: CardPlacement[] = []) =>
  game(
    [
      { key: "host", def: character({ name: "Host", strength: 3, life: 5 }), owner: P1, zone: "play", depleted: true },
      { key: "bl", def: printing(BLESSING), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "ally", def: character({ name: "Ally", strength: 3, life: 5 }), owner: P1, zone: "play", depleted: true },
      { key: "fresh", def: character({ name: "Fresh", strength: 3, life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5 }), owner: P2, zone: "play", depleted: true },
      { key: "rf", def: refresh(), owner: P1, zone: "hand" },
      { key: "rf2", def: refresh(), owner: P2, zone: "hand" },
      ...extra,
      ...fillers("dk", 10, P1, "deck"),
      ...fillers("dq", 10, P2, "deck")
    ],
    { turn: 3 }
  );

clause(BLESSING, "3.0:grant-rule", "when another character I control restores, it loses exactly 1 strength this turn and I draw exactly 1 card", () => {
  const { engine, id } = refreshBoard();
  const hand = handOf(engine, P1);
  play(engine, P1, id("rf"), { selected: { t: [id("ally")] } });
  drain(engine, declineAll);
  assert.equal(stateOf(engine, id("ally")).depleted, false, "restored");
  assert.equal(engine.getStat(id("ally"), "strength"), 2, "3 - 1");
  assert.equal(handOf(engine, P1), hand - 1 + 1, "refresh left hand, one card drawn");
  assert.equal(engine.getStat(id("fresh"), "strength"), 3, "other characters unaffected");
  assert.equal(engine.getStat(id("host"), "strength"), 3);
});

clause(BLESSING, "3.0:grant-rule", "the host itself restoring also triggers it (-1 strength, draw 1)", () => {
  const { engine, id } = refreshBoard();
  const hand = handOf(engine, P1);
  play(engine, P1, id("rf"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(stateOf(engine, id("host")).depleted, false);
  assert.equal(engine.getStat(id("host"), "strength"), 2);
  assert.equal(handOf(engine, P1), hand, "one drawn");
});

clause(BLESSING, "3.0:grant-rule", "the strength loss lasts only this turn", () => {
  const { engine, id } = refreshBoard();
  play(engine, P1, id("rf"), { selected: { t: [id("ally")] } });
  drain(engine, declineAll);
  assert.equal(engine.getStat(id("ally"), "strength"), 2);
  endTurn(engine, P1);
  assert.equal(engine.getStat(id("ally"), "strength"), 3);
});

clause(BLESSING, "3.0:grant-rule", "an opponent's character restoring does not trigger it (no strength loss, no draw for me)", () => {
  const { engine, id } = refreshBoard();
  const hand = handOf(engine, P1);
  play(engine, P1, id("rf"), { selected: { t: [id("foe")] } });
  drain(engine, declineAll);
  assert.equal(stateOf(engine, id("foe")).depleted, false, "restored");
  assert.equal(engine.getStat(id("foe"), "strength"), 3);
  assert.equal(handOf(engine, P1), hand - 1, "no draw");
});

clause(BLESSING, "3.0:grant-rule", "a character that was not depleted can't restore, so nothing triggers", () => {
  const { engine, id } = refreshBoard();
  const hand = handOf(engine, P1);
  play(engine, P1, id("rf"), { selected: { t: [id("fresh")] } });
  drain(engine, declineAll);
  assert.equal(engine.getStat(id("fresh"), "strength"), 3);
  assert.equal(handOf(engine, P1), hand - 1, "no draw");
});

clause(BLESSING, "3.0:grant-rule", "the host's controller is who draws: when the opponent controls the host, the opponent draws on their characters restoring", () => {
  const { engine, id } = game(
    [
      { key: "foeHost", def: character({ name: "FoeHost", strength: 3, life: 5 }), owner: P2, zone: "play" },
      { key: "bl", def: printing(BLESSING), owner: P1, zone: "play", attachedToKey: "foeHost" },
      { key: "foeAlly", def: character({ name: "FoeAlly", strength: 3, life: 5 }), owner: P2, zone: "play", depleted: true },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 5 }), owner: P1, zone: "play", depleted: true },
      { key: "rf", def: refresh(), owner: P1, zone: "hand" },
      ...fillers("dk", 10, P1, "deck"),
      ...fillers("dq", 10, P2, "deck")
    ],
    { turn: 3 }
  );
  const myHand = handOf(engine, P1);
  const theirHand = handOf(engine, P2);
  play(engine, P1, id("rf"), { selected: { t: [id("foeAlly")] } });
  drain(engine, declineAll);
  assert.equal(engine.getStat(id("foeAlly"), "strength"), 2, "the host's controller's character loses 1");
  assert.equal(handOf(engine, P2), theirHand + 1, "the host's controller draws");
  assert.equal(handOf(engine, P1), myHand - 1, "I (the Blessing's owner, not the host's controller) draw nothing");
  const before = engine.getStat(id("mine"), "strength");
  assert.equal(before, 3);
});

clause(BLESSING, "3.0:grant-rule", "without the Blessing attached a restore does nothing extra (control)", () => {
  const { engine, id } = game(
    [
      { key: "host", def: character({ name: "Host", strength: 3, life: 5 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 3, life: 5 }), owner: P1, zone: "play", depleted: true },
      { key: "rf", def: refresh(), owner: P1, zone: "hand" },
      ...fillers("dk", 10, P1, "deck")
    ],
    { turn: 3 }
  );
  const hand = handOf(engine, P1);
  play(engine, P1, id("rf"), { selected: { t: [id("ally")] } });
  drain(engine, declineAll);
  assert.equal(stateOf(engine, id("ally")).depleted, false);
  assert.equal(engine.getStat(id("ally"), "strength"), 3);
  assert.equal(handOf(engine, P1), hand - 1);
});

// 3.1  Characters you control cannot be restored by your faction's RESTORE RULE.

clause(BLESSING, "3.1:grant-rule", "my characters (host and others) stay depleted through my RESTORE RULE; my non-character permanents still restore", () => {
  const { engine, id } = blessedTurn();
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(stateOf(engine, id("host")).depleted, true, "host stays depleted");
  assert.equal(stateOf(engine, id("ally")).depleted, true, "ally stays depleted");
  assert.equal(stateOf(engine, id("gear")).depleted, false, "an item is not a character: it restores");
});

clause(BLESSING, "3.1:grant-rule", "the opponent's characters still restore at their own Restore Rule", () => {
  const { engine, id } = blessedTurn({ active: P1 });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(stateOf(engine, id("foe")).depleted, false, "opponent's character restored");
  assert.equal(stateOf(engine, id("ally")).depleted, true, "mine untouched");
});

clause(BLESSING, "3.1:grant-rule", "the lock is only the Restore Rule: an effect can still restore my character", () => {
  const { engine, id } = refreshBoard();
  play(engine, P1, id("rf"), { selected: { t: [id("ally")] } });
  drain(engine, declineAll);
  assert.equal(stateOf(engine, id("ally")).depleted, false);
});

clause(BLESSING, "3.1:grant-rule", "the lock ends when the Blessing leaves play (destroyed): my characters restore again", () => {
  const { engine, id } = blessedTurn({ extra: [{ key: "sm", def: smash(), owner: P2, zone: "hand" }] });
  play(engine, P2, id("sm"), { selected: { t: [id("bl")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("bl")), "discard");
  endTurn(engine, P2);
  assert.equal(stateOf(engine, id("ally")).depleted, false, "restored by the rule");
  assert.equal(stateOf(engine, id("host")).depleted, false);
});

clause(BLESSING, "3.1:grant-rule", "the lock ends when the host leaves play: my other characters restore again", () => {
  const { engine, id } = blessedTurn({ extra: [{ key: "sm", def: smash(), owner: P2, zone: "hand" }] });
  play(engine, P2, id("sm"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("host")), "discard");
  endTurn(engine, P2);
  assert.equal(stateOf(engine, id("ally")).depleted, false, "restored by the rule");
});

// 3.2  At the start of your turn, you may inflict 1 damage to your faction and restore a character you control. Repeat this once for each character you control.

/** Accepts every optional prompt and picks the first offered candidate. */
// The pending choice lists no candidates, so a real answer to "restore a character you control" names a depleted one itself.
const acceptAll = (pickIds: () => string[] = () => []) => (pc: { kind: string; [key: string]: unknown }): unknown => {
  switch (pc.kind) {
    case "mayPay":
      return { kind: "mayPay", pay: true };
    case "chooserSelectsOption":
      return { kind: "chooserSelectsOption", index: 0 };
    case "chooserSelectsTarget":
      return { kind: "chooserSelectsTarget", selected: pickIds().slice(0, 1) };
    default:
      return declineAll(pc);
  }
};

const turnBoard = (extra: CardPlacement[] = []) =>
  game(
    [
      { key: "host", def: character({ name: "Host", strength: 3, life: 5 }), owner: P1, zone: "play", depleted: true },
      { key: "bl", def: printing(BLESSING), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "ally", def: character({ name: "Ally", strength: 3, life: 5 }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5 }), owner: P2, zone: "play", depleted: true },
      ...extra,
      ...fillers("dk", 10, P1, "deck"),
      ...fillers("dq", 10, P2, "deck")
    ],
    { active: P2, turn: 3 }
  );

const damagedChars = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, keys: string[]) => keys.filter((k) => stateOf(engine, id(k)).depleted === false);

clause(BLESSING, "3.2:grant-rule", "at the start of my turn I may inflict 1 damage to my faction and restore a character I control (offered, accepted)", () => {
  const { engine, id } = turnBoard();
  const mine = influenceOf(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.ok(pending(engine), "the 'you may' is offered");
  drain(engine, acceptAll(() => ["host", "ally"].map(id).filter((c) => stateOf(engine, c).depleted)));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.ok(influenceOf(engine, P1) <= mine - 1, "my faction took damage");
  assert.ok(damagedChars(engine, id, ["host", "ally"]).length >= 1, "a character I control was restored");
});

clause(BLESSING, "3.2:grant-rule", "declining the 'may' costs nothing and restores nothing", () => {
  const { engine, id } = turnBoard();
  const mine = influenceOf(engine, P1);
  endTurn(engine, P2);
  const pc = pending(engine);
  assert.ok(pc, "the 'you may' is offered");
  drain(engine, (p) => (p.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(p)));
  assert.equal(influenceOf(engine, P1), mine);
  assert.equal(damagedChars(engine, id, ["host", "ally"]).length, 0);
});

clause(BLESSING, "3.2:grant-rule", "the whole sequence repeats once for each character I control (two characters: 1 + 2 = 3 damage, both restored)", () => {
  const { engine, id } = turnBoard();
  const mine = influenceOf(engine, P1);
  endTurn(engine, P2);
  assert.ok(pending(engine), "offered");
  drain(engine, acceptAll(() => ["host", "ally"].map(id).filter((c) => stateOf(engine, c).depleted)));
  assert.equal(influenceOf(engine, P1), mine - 3, "initial + 2 repeats, 1 damage each");
  assert.equal(stateOf(engine, id("host")).depleted, false);
  assert.equal(stateOf(engine, id("ally")).depleted, false);
});

clause(BLESSING, "3.2:grant-rule", "the first iteration: its controller answers the 'may' and the pick, 1 damage, exactly the picked character is restored (the other stays depleted); the repeats can then be declined", () => {
  const { engine, id } = turnBoard();
  const mine = influenceOf(engine, P1);
  endTurn(engine, P2);
  const may = pending(engine) as unknown as { kind: string; playerId: string };
  assert.equal(may.kind, "mayPay", "the 'you may' is offered");
  assert.equal(may.playerId, P1, "the controller decides whether to pay");
  answerPending(engine, "mayPay", { pay: true });
  const pick = pending(engine) as unknown as { kind: string; playerId: string };
  assert.equal(pick.kind, "chooserSelectsTarget", "then a character to restore is picked");
  assert.equal(pick.playerId, P1, "the controller picks the character");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("host")] });
  assert.equal(influenceOf(engine, P1), mine - 1, "1 damage to my faction");
  assert.equal(stateOf(engine, id("host")).depleted, false, "the picked character is restored");
  assert.equal(stateOf(engine, id("ally")).depleted, true, "the other one is not");
  drain(engine, (p) => (p.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(p)));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(engine, P1), mine - 1, "declined repeats cost nothing");
  assert.equal(stateOf(engine, id("ally")).depleted, true, "still depleted");
  assert.equal(stateOf(engine, id("foe")).depleted, true, "the opponent's character is untouched");
});

clause(BLESSING, "3.2:grant-rule", "'a character you control': the restore pick refuses the opponent's character, my item and two cards (control: one of mine is accepted)", () => {
  const { engine, id } = turnBoard([{ key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play", depleted: true }]);
  endTurn(engine, P2);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the pick is open");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("foe")] }), "the opponent's character");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("myItem")] }), "an item is not a character");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("host"), id("ally")] }), "one character only");
  assert.equal(stateOf(engine, id("foe")).depleted, true, "foe untouched");
  assert.equal(stateOf(engine, id("host")).depleted, true, "host not yet restored");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("ally")] });
  assert.equal(stateOf(engine, id("ally")).depleted, false, "control: a character of mine is restored");
});

clause(BLESSING, "3.2:grant-rule", "a repeat: declining the first, accepting the second prompt costs 1 damage and restores exactly the picked character, decided and picked by its controller", () => {
  const { engine, id } = turnBoard();
  const mine = influenceOf(engine, P1);
  endTurn(engine, P2);
  const first = pending(engine) as unknown as { kind: string; playerId: string };
  assert.equal(first.kind, "mayPay", "first prompt");
  answerPending(engine, "mayPay", { pay: false });
  const rep = pending(engine) as unknown as { kind: string; playerId: string };
  assert.equal(rep.kind, "mayPay", "the repeat prompt is offered");
  assert.equal(rep.playerId, P1, "the controller decides each repeat");
  answerPending(engine, "mayPay", { pay: true });
  const pick = pending(engine) as unknown as { kind: string; playerId: string };
  assert.equal(pick.kind, "chooserSelectsTarget", "a character to restore is picked");
  assert.equal(pick.playerId, P1, "the controller picks");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("foe")] }), "the opponent's character");
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("host"), id("ally")] }), "one character only");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("ally")] });
  assert.equal(influenceOf(engine, P1), mine - 1, "1 damage");
  assert.equal(stateOf(engine, id("ally")).depleted, false, "the picked character is restored");
  assert.equal(stateOf(engine, id("host")).depleted, true, "the other is not");
  drain(engine, (p) => (p.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(p)));
  assert.equal(influenceOf(engine, P1), mine - 1, "the last repeat declined");
  assert.equal(stateOf(engine, id("host")).depleted, true, "host still depleted");
});

clause(BLESSING, "3.2:grant-rule", "it is MY start of turn only: nothing is offered at the start of the opponent's turn", () => {
  const b = game(
    [
      { key: "host", def: character({ name: "Host", strength: 3, life: 5 }), owner: P1, zone: "play", depleted: true },
      { key: "bl", def: printing(BLESSING), owner: P1, zone: "play", attachedToKey: "host" },
      ...fillers("dk", 10, P1, "deck"),
      ...fillers("dq", 10, P2, "deck")
    ],
    { active: P1, turn: 2 }
  );
  const before = influenceOf(b.engine, P1);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing offered at the opponent's turn start");
  assert.equal(influenceOf(b.engine, P1), before);
  assert.equal(stateOf(b.engine, b.id("host")).depleted, true, "still depleted");
});

// =====================================================================================
// Gosche's Retained Earnings Vault
// =====================================================================================

const castVault = (resources: CardPlacement[]) => game([{ key: "v", def: printing(VAULT), owner: P1, zone: "hand" }, ...resources]);

clause(VAULT, "0:rule", "printed card: location, cost 2, [G], structure 2: one greed + one other deploys it and pays exactly 2", () => {
  const { engine, id } = castVault([...bank("greed", 1, P1), ...bank("rage", 1, P1)]);
  play(engine, P1, id("v"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("v")), "play");
  assert.equal(ready(engine, P1), 0, "cost 2 paid");
  assert.equal(engine.getStat(id("v"), "structure"), 2);
  const def = engine.getDefinition(id("v"));
  assert.equal(def.type, "location");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "g");
});

clause(VAULT, "0:rule", "deploy is refused one resource short (threshold met) and with no [G] (cost payable)", () => {
  const short = castVault(bank("greed", 1, P1));
  refused(() => play(short.engine, P1, short.id("v")), "1 of the 2 cost", /afford|resource|pay|cost/i);
  assert.equal(zoneOf(short.engine, short.id("v")), "hand");
  const noG = castVault(bank("rage", 2, P1));
  refused(() => play(noG.engine, P1, noG.id("v")), "no [G]", /threshold|icon/i);
  assert.equal(zoneOf(noG.engine, noG.id("v")), "hand");
});

const vaultBoard = (extra: CardPlacement[] = [], over: { active?: PlayerId } = {}) =>
  game(
    [
      { key: "v", def: printing(VAULT), owner: P1, zone: "play" },
      { key: "tok", def: character({ name: "Tok" }), owner: P1, zone: "play", counters: { token: 1 } },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      { key: "sm", def: smash(), owner: P1, zone: "hand" },
      { key: "bn", def: bounce(), owner: P1, zone: "hand" },
      ...extra
    ],
    over
  );

const kill = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, target: string) => {
  play(engine, P1, id("sm"), { selected: { t: [id(target)] } });
  drain(engine, declineAll);
};

clause(VAULT, "0:rule", "when a character I control with a token on it leaves play (destroyed), my faction gains exactly 2 influence", () => {
  const { engine, id } = vaultBoard();
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  kill(engine, id, "tok");
  assert.equal(zoneOf(engine, id("tok")), "discard");
  assert.equal(influenceOf(engine, P1), mine + 2);
  assert.equal(influenceOf(engine, P2), theirs);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(VAULT, "0:rule", "leaving play any way counts: returned to hand also gains 2", () => {
  const { engine, id } = vaultBoard();
  const mine = influenceOf(engine, P1);
  play(engine, P1, id("bn"), { selected: { t: [id("tok")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("tok")), "hand");
  assert.equal(influenceOf(engine, P1), mine + 2);
});

clause(VAULT, "0:rule", "a character with several tokens still gains only 2 (once per leaving)", () => {
  const { engine, id } = vaultBoard([{ key: "multi", def: character({ name: "Multi" }), owner: P1, zone: "play", counters: { token: 3 } }]);
  const mine = influenceOf(engine, P1);
  kill(engine, id, "multi");
  assert.equal(influenceOf(engine, P1), mine + 2);
});

clause(VAULT, "0:rule", "a character without a token, or with only a different counter, gains nothing", () => {
  const { engine, id } = vaultBoard([{ key: "marked", def: character({ name: "Marked" }), owner: P1, zone: "play", counters: { marker: 2 } }]);
  const mine = influenceOf(engine, P1);
  kill(engine, id, "plain");
  assert.equal(zoneOf(engine, id("plain")), "discard");
  assert.equal(influenceOf(engine, P1), mine, "no token");
  const b = vaultBoard([{ key: "marked", def: character({ name: "Marked" }), owner: P1, zone: "play", counters: { marker: 2 } }]);
  const before = influenceOf(b.engine, P1);
  kill(b.engine, b.id, "marked");
  assert.equal(zoneOf(b.engine, b.id("marked")), "discard");
  assert.equal(influenceOf(b.engine, P1), before, "a non-token counter doesn't count");
});

clause(VAULT, "0:rule", "the opponent's character with a token leaving play gains me nothing", () => {
  const { engine, id } = vaultBoard([{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", counters: { token: 1 } }]);
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  kill(engine, id, "foe");
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(influenceOf(engine, P1), mine, "opponent's token character");
  assert.equal(influenceOf(engine, P2), theirs, "nor does the opponent gain");
});

clause(VAULT, "0:rule", "a non-character of mine with a token (an item) leaving play gains nothing: only characters count", () => {
  const b = vaultBoard([{ key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play", counters: { token: 1 } }]);
  const before = influenceOf(b.engine, P1);
  kill(b.engine, b.id, "gear");
  assert.equal(zoneOf(b.engine, b.id("gear")), "discard");
  assert.equal(influenceOf(b.engine, P1), before, "an item with a token");
});

clause(VAULT, "0:rule", "control, not ownership, decides: a token character I control but the opponent owns pays 2; one I own but the opponent controls pays 0", () => {
  const a = vaultBoard([{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play", counters: { token: 1 } }]);
  const mineA = influenceOf(a.engine, P1);
  kill(a.engine, a.id, "stolen");
  assert.equal(zoneOf(a.engine, a.id("stolen")), "discard");
  assert.equal(influenceOf(a.engine, P1), mineA + 2, "controlled by me");
  const b = vaultBoard([{ key: "lent", def: character({ name: "Lent" }), owner: P1, controller: P2, zone: "play", counters: { token: 1 } }]);
  const mineB = influenceOf(b.engine, P1);
  kill(b.engine, b.id, "lent");
  assert.equal(zoneOf(b.engine, b.id("lent")), "discard");
  assert.equal(influenceOf(b.engine, P1), mineB, "controlled by the opponent");
});

clause(VAULT, "0:rule", "my faction gains it even when the opponent destroys the character", () => {
  const { engine, id } = vaultBoard([{ key: "osm", def: smash(), owner: P2, zone: "hand" }], { active: P2 });
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  play(engine, P2, id("osm"), { selected: { t: [id("tok")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("tok")), "discard");
  assert.equal(influenceOf(engine, P1), mine + 2);
  assert.equal(influenceOf(engine, P2), theirs);
});

clause(VAULT, "0:rule", "only LEAVING play counts: a token character entering play from the discard pile gains nothing, and neither does one moving between non-play zones", () => {
  const { engine, id } = vaultBoard([
    { key: "dead", def: character({ name: "Dead" }), owner: P1, zone: "discard", counters: { token: 1 } },
    { key: "re", def: reanimate(), owner: P1, zone: "hand" },
    { key: "inhand", def: character({ name: "InHand" }), owner: P1, zone: "hand", counters: { token: 1 } }
  ]);
  const mine = influenceOf(engine, P1);
  play(engine, P1, id("re"), { selected: { t: [id("dead")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("dead")), "play", "it entered play");
  assert.equal(influenceOf(engine, P1), mine, "entering play is not leaving play");

  const tossHand = tactic({
    name: "TossHand",
    cost: 0,
    behavior: {
      abilities: [
        { id: "th", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }
      ]
    }
  });
  const b = vaultBoard([
    { key: "inhand", def: character({ name: "InHand" }), owner: P1, zone: "hand", counters: { token: 1 } },
    { key: "th", def: tossHand, owner: P1, zone: "hand" }
  ]);
  const before = influenceOf(b.engine, P1);
  play(b.engine, P1, b.id("th"), { selected: { t: [b.id("inhand")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("inhand")), "discard", "moved hand -> discard");
  assert.equal(influenceOf(b.engine, P1), before, "not from play: nothing gained");
});

clause(VAULT, "0:rule", "a token character of mine moving from the discard pile to my hand is not leaving play: nothing gained", () => {
  const retrieve = tactic({
    name: "Retrieve",
    cost: 0,
    behavior: {
      abilities: [
        { id: "rt", type: "activated", targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }
      ]
    }
  });
  const b = vaultBoard([
    { key: "dead", def: character({ name: "Dead" }), owner: P1, zone: "discard", counters: { token: 1 } },
    { key: "rt", def: retrieve, owner: P1, zone: "hand" }
  ]);
  const before = influenceOf(b.engine, P1);
  play(b.engine, P1, b.id("rt"), { selected: { t: [b.id("dead")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("dead")), "hand", "moved discard -> hand");
  assert.equal(influenceOf(b.engine, P1), before, "not from play: nothing gained");
});

clause(VAULT, "0:rule", "a token character of mine deployed from my hand is entering play, not leaving it: nothing gained", () => {
  const b = vaultBoard([
    { key: "handTok", def: character({ name: "HandTok", cost: 0 }), owner: P1, zone: "hand", counters: { token: 1 } }
  ]);
  const before = influenceOf(b.engine, P1);
  play(b.engine, P1, b.id("handTok"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("handTok")), "play", "deployed");
  assert.equal(influenceOf(b.engine, P1), before, "entering play gains nothing");
});

clause(VAULT, "0:rule", "the Vault must be in play: with no Vault a token character leaving play gains nothing; once the Vault is destroyed it stops", () => {
  const { engine, id } = game([
    { key: "tok", def: character({ name: "Tok" }), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "sm", def: smash(), owner: P1, zone: "hand" }
  ]);
  const mine = influenceOf(engine, P1);
  kill(engine, id, "tok");
  assert.equal(zoneOf(engine, id("tok")), "discard");
  assert.equal(influenceOf(engine, P1), mine);
  const gone = vaultBoard([{ key: "sm2", def: smash(), owner: P1, zone: "hand" }]);
  kill(gone.engine, gone.id, "v");
  assert.equal(zoneOf(gone.engine, gone.id("v")), "discard");
  const before = influenceOf(gone.engine, P1);
  play(gone.engine, P1, gone.id("sm2"), { selected: { t: [gone.id("tok")] } });
  drain(gone.engine, declineAll);
  assert.equal(zoneOf(gone.engine, gone.id("tok")), "discard");
  assert.equal(influenceOf(gone.engine, P1), before, "no Vault, no gain");
});

// ---- 1:ability:seed  INVEST -- COST: Deplete this card. Pay 2. Pick a character you control. -- EFFECT: Put a token on that character.

const investBoard = (resources: CardPlacement[], extra: CardPlacement[] = []) =>
  game([
    { key: "v", def: printing(VAULT), owner: P1, zone: "play" },
    { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "play" },
    { key: "c2", def: character({ name: "C2" }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
    ...resources,
    ...extra
  ]);

clause(VAULT, "1:ability:seed", "Invest: deplete the Vault, pay exactly 2, and the picked character gets exactly one token (others none)", () => {
  const { engine, id } = investBoard(bank("rage", 3, P1));
  assert.equal(ready(engine, P1), 3);
  activate(engine, P1, id("v"), "seed", { selected: { c: [id("c1")] } });
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(stateOf(engine, id("v")).depleted, true, "deplete");
  assert.equal(ready(engine, P1), 1, "pay 2");
  assert.equal(tokensOn(engine, id("c1")), 1);
  assert.equal(tokensOn(engine, id("c2")), 0);
  assert.equal(tokensOn(engine, id("foe")), 0);
  assert.equal(tokensOn(engine, id("v")), 0);
  assert.equal(zoneOf(engine, id("v")), "play");
});

clause(VAULT, "1:ability:seed", "any character I control may be picked (the second one too, and a character that already has a token gets another)", () => {
  const { engine, id } = investBoard(bank("rage", 4, P1), [{ key: "c3", def: character({ name: "C3" }), owner: P1, zone: "play", counters: { token: 1 } }]);
  activate(engine, P1, id("v"), "seed", { selected: { c: [id("c2")] } });
  drain(engine, declineAll);
  assert.equal(tokensOn(engine, id("c2")), 1);
  stateOf(engine, id("v")).depleted = false;
  activate(engine, P1, id("v"), "seed", { selected: { c: [id("c3")] } });
  drain(engine, declineAll);
  assert.equal(tokensOn(engine, id("c3")), 2, "tokens stack");
  assert.equal(tokensOn(engine, id("c1")), 0);
});

clause(VAULT, "1:ability:seed", "refused with only 1 resource (positive control: 2 works); nothing is depleted or paid on refusal", () => {
  const ok = investBoard(bank("rage", 2, P1));
  activate(ok.engine, P1, ok.id("v"), "seed", { selected: { c: [ok.id("c1")] } });
  drain(ok.engine, declineAll);
  assert.equal(tokensOn(ok.engine, ok.id("c1")), 1, "control");
  const short = investBoard(bank("rage", 1, P1));
  refused(() => activate(short.engine, P1, short.id("v"), "seed", { selected: { c: [short.id("c1")] } }), "1 resource of 2", /afford|resource|pay|cost/i);
  assert.equal(stateOf(short.engine, short.id("v")).depleted ?? false, false);
  assert.equal(tokensOn(short.engine, short.id("c1")), 0);
  assert.equal(ready(short.engine, P1), 1);
});

clause(VAULT, "1:ability:seed", "refused while the Vault is depleted (and so only once per untap)", () => {
  const { engine, id } = investBoard(bank("rage", 4, P1));
  activate(engine, P1, id("v"), "seed", { selected: { c: [id("c1")] } });
  drain(engine, declineAll);
  assert.equal(tokensOn(engine, id("c1")), 1);
  refused(() => activate(engine, P1, id("v"), "seed", { selected: { c: [id("c2")] } }), "depleted Vault", /deplet|cost|afford|activate|ability|use/i);
  assert.equal(tokensOn(engine, id("c2")), 0);
  assert.equal(ready(engine, P1), 2, "no second payment");
});

clause(VAULT, "1:ability:seed", "the pick must be a character I control: the opponent's character, an item, or no pick is refused", () => {
  const mk = () => investBoard(bank("rage", 2, P1));
  const foe = mk();
  refused(() => activate(foe.engine, P1, foe.id("v"), "seed", { selected: { c: [foe.id("foe")] } }), "opponent's character", /target|select|pick|valid|control|character/i);
  assert.equal(tokensOn(foe.engine, foe.id("foe")), 0);
  assert.equal(ready(foe.engine, P1), 2);
  const gear = mk();
  refused(() => activate(gear.engine, P1, gear.id("v"), "seed", { selected: { c: [gear.id("gear")] } }), "an item", /target|select|pick|valid|control|character/i);
  assert.equal(tokensOn(gear.engine, gear.id("gear")), 0);
  const none = mk();
  refused(() => activate(none.engine, P1, none.id("v"), "seed", { selected: { c: [] } }), "no pick", /target|select|pick|valid|control|character|require/i);
  assert.equal(stateOf(none.engine, none.id("v")).depleted ?? false, false);
  assert.equal(ready(none.engine, P1), 2);
});

clause(VAULT, "1:ability:seed", "only one character may be picked (two picks refused)", () => {
  const { engine, id } = investBoard(bank("rage", 2, P1));
  refused(() => activate(engine, P1, id("v"), "seed", { selected: { c: [id("c1"), id("c2")] } }), "two picks", /target|select|pick|count|one|valid/i);
  assert.equal(tokensOn(engine, id("c1")), 0);
  assert.equal(tokensOn(engine, id("c2")), 0);
});

clause(VAULT, "1:ability:seed", "the Vault's two clauses work together: a character Invested in and then destroyed pays 2 influence", () => {
  const { engine, id } = investBoard(bank("rage", 2, P1), [{ key: "sm", def: smash(), owner: P1, zone: "hand" }]);
  activate(engine, P1, id("v"), "seed", { selected: { c: [id("c1")] } });
  drain(engine, declineAll);
  const mine = influenceOf(engine, P1);
  play(engine, P1, id("sm"), { selected: { t: [id("c1")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("c1")), "discard");
  assert.equal(influenceOf(engine, P1), mine + 2);
});

// Unused-import guards keep the helper list honest.
void answerPending;
void ({} as CardDefinition);
