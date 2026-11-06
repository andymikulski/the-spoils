// Clause tests — batch seed-2-04. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-2-04`. Expectations come from each
// card's PRINTED text (markup); engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow, holdCostChoices, holdFlipUp, holdResourceFace } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fight, finishBattle, playRaw } from "./_battle.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developResource, endTurn, developOffers } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ elitism: 2, deception: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** `n` staple resources already spent (attached to `owner`'s faction): they still count as icons controlled but are not ready. */
const spent = (icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const playOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].play];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted === true;
const isFaceDown = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].faceDown === true;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId;
const idOfFn = (g: { id: (key: string) => CardInstanceId }) => g.id;
type IdOf = (key: string) => CardInstanceId;

/** Raw `activateAbility` WITHOUT draining the response window. */
function actRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

/** Raw `flipUp` WITHOUT draining the response window. */
function flipUpRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables });
}

/** The sole open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
function pickTargets(selected: CardInstanceId[]) {
  return (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc));
}

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** A player responds to the open window by playing a tactic from hand; the chain is then drained. */
function respondWith(
  engine: SpoilsEngine,
  responder: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "playCard", playerId: responder, cardId, selected, variables } as never);
  resolvePendingResponses(engine);
}

/** A free tactic (id "pump", pick "t"): the picked character gets `amount` strength this turn. */
function pumpTactic(amount: number, name = `Pump ${amount}`): CardDefinition {
  return tactic({
    name,
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

/** A free tactic (id "mv", pick "t"): moves one picked card in play to `to` (top of the deck when `to` is "deck"). */
function moverTactic(to: Zone, name = `Mover to ${to}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to, position: "top" }]
        }
      ]
    }
  });
}

/** A free tactic (id "rm", pick "t"): removes one picked card in play from the game. */
function removerTactic(name = "Remover"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "kill-item", pick "t"): destroys one picked item in play. */
function itemKillerTactic(name = "Item Killer"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kill-item",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "tg", pick "t"): puts `n` tokens on the picked card in play. */
function tokenGiver(n: number, name = `Give ${n} tokens`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "tg",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: n }]
        }
      ]
    }
  });
}

/** Answers the choices a turn boundary raises: the order of triggers (first listed), then each yes/no offer from `script` ("accept" / "decline", default decline). Anything else fails the test. Returns the offers seen. */
function answerOffers(engine: SpoilsEngine, script: Array<"accept" | "decline"> = [], players: PlayerId[] = [], replace = false): number {
  let seen = 0;
  drain(engine, (pc) => {
    if (pc.kind === "orderTriggers") return declineAll(pc);
    if (pc.kind === "replacementChoice") return { kind: "replacementChoice", apply: replace };
    if (pc.kind === "chooserSelectsOption") {
      players.push(pc.playerId as PlayerId);
      const answer = script[seen++] ?? "decline";
      const options = (pc.options as Array<{ label?: string }> | undefined) ?? [];
      const declineIndex = options.findIndex((option) => /decline/i.test(option.label ?? ""));
      const acceptIndex = options.findIndex((option) => !/decline/i.test(option.label ?? ""));
      return { kind: "chooserSelectsOption", index: answer === "accept" ? (acceptIndex < 0 ? 1 : acceptIndex) : declineIndex < 0 ? 0 : declineIndex };
    }
    throw new Error(`unexpected pending choice ${pc.kind}`);
  });
  return seen;
}

// =================================================================================
// Gewgawed Gimcrack
// At the start of your turn, you may put a token on this card.
// [E][E][E]: At the start of your turn, you may put a token on this card.
// DO...SOMETHING! -- COST: X is the number of tokens on this card. Destroy this card.
//   -- EFFECT: Destroy all characters with numeric cost X.
// Item, cost 3, [E].
// =================================================================================

const GIMCRACK = "38060403-d6bc-450e-9644-94be30d5ddb9";

interface GimOpts {
  tokens?: number;
  zone?: "play" | "hand" | "discard" | "deck";
  faceDown?: boolean;
  /** who controls (and owns) the Gimcrack; default P1 */
  owner?: PlayerId;
  controller?: PlayerId;
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
  second?: boolean;
}

/**
 * P1: the Gimcrack (key "gim") and `icons`. By default it is P2's turn (turn 2), so ending it starts P1's turn
 * ("At the start of your turn"). P2: `oppIcons`.
 */
function gimBoard(o: GimOpts = {}) {
  return devBoard(
    [
      {
        key: "gim",
        def: printing(GIMCRACK),
        owner: o.owner ?? P1,
        controller: o.controller,
        zone: o.zone ?? "play",
        faceDown: o.faceDown,
        counters: o.tokens ? { token: o.tokens } : undefined
      },
      ...(o.second ? [{ key: "gim2", def: printing(GIMCRACK), owner: P1, zone: "play" as const }] : []),
      ...res(o.icons ?? {}),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn ?? 2, activePlayerId: o.active ?? P2 }
  );
}

type GimGame = ReturnType<typeof gimBoard>;

/** The opponent's turn ends, my turn starts: returns the offers I was made (answering with `script`). */
function myTurnStarts(g: GimGame, script: Array<"accept" | "decline"> = []): number {
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1, "setup: it is my turn now");
  return answerOffers(g.engine, script);
}

// --- 0:rule  At the start of your turn, you may put a token on this card. ---------------

clause(GIMCRACK, "0:rule", "at the start of my turn I may put a token on it: accepting puts exactly one token on the Gimcrack", () => {
  const g = gimBoard();
  assert.equal(tokensOn(g.engine, g.id("gim")), 0);
  endTurn(g.engine, P2);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the offer is made to the Gimcrack's controller");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(g.engine.state.pendingChoice, undefined, "one offer only");
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
});

clause(GIMCRACK, "0:rule", "it is a 'may': declining puts no token on it", () => {
  const g = gimBoard();
  assert.equal(myTurnStarts(g, ["decline"]), 1, "the offer was made");
  assert.equal(tokensOn(g.engine, g.id("gim")), 0);
  assert.equal(zoneOf(g.engine, g.id("gim")), "play");
});

clause(GIMCRACK, "0:rule", "the token goes on the Gimcrack itself and nowhere else", () => {
  const g = gimBoard({ extra: [{ key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }, { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }] });
  myTurnStarts(g, ["accept"]);
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
  assert.equal(tokensOn(g.engine, g.id("ally")), 0);
  assert.equal(tokensOn(g.engine, g.id("foe")), 0);
  assert.equal(tokensOn(g.engine, g.engine.state.players[P1].factionId!), 0);
});

clause(GIMCRACK, "0:rule", "tokens already on it stay: with 2 tokens, accepting makes 3", () => {
  const g = gimBoard({ tokens: 2 });
  myTurnStarts(g, ["accept"]);
  assert.equal(tokensOn(g.engine, g.id("gim")), 3);
});

clause(GIMCRACK, "0:rule", "declining keeps the tokens it already has", () => {
  const g = gimBoard({ tokens: 2 });
  myTurnStarts(g, ["decline"]);
  assert.equal(tokensOn(g.engine, g.id("gim")), 2);
});

clause(GIMCRACK, "0:rule", "it is offered again every one of my turns: accepting on two consecutive turns makes two tokens", () => {
  const g = gimBoard();
  myTurnStarts(g, ["accept"]);
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.pendingChoice, undefined, "nothing is offered at the start of my opponent's turn");
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(answerOffers(g.engine, ["accept"]), 1);
  assert.equal(tokensOn(g.engine, g.id("gim")), 2);
});

clause(GIMCRACK, "0:rule", "I can decline one turn and accept the next", () => {
  const g = gimBoard();
  myTurnStarts(g, ["decline"]);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  answerOffers(g.engine, ["accept"]);
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
});

clause(GIMCRACK, "0:rule", "'your turn' only: at the start of my OPPONENT'S turn no offer is made and no token is added", () => {
  const g = gimBoard({ turn: 1, active: P1 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(g.engine.state.pendingChoice, undefined, "nobody is asked anything");
  assert.equal(tokensOn(g.engine, g.id("gim")), 0);
});

clause(GIMCRACK, "0:rule", "with no [E] at all (nothing but the Gimcrack) exactly one offer is made at the start of my turn", () => {
  const g = gimBoard({ icons: {} });
  assert.equal(myTurnStarts(g, ["accept"]), 1);
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
});

clause(GIMCRACK, "0:rule", "it works from play only: a Gimcrack in my hand, deck or discard pile offers nothing", () => {
  for (const zone of ["hand", "deck", "discard"] as const) {
    const g = gimBoard({ zone });
    endTurn(g.engine, P2);
    assert.equal(g.engine.state.pendingChoice, undefined, `${zone}: no offer`);
    assert.equal(tokensOn(g.engine, g.id("gim")), 0, `${zone}: no token`);
  }
  const control = gimBoard({ zone: "play" });
  endTurn(control.engine, P2);
  assert.equal(expectPending(control.engine, "chooserSelectsOption").playerId, P1, "control: in play it is offered");
});

clause(GIMCRACK, "0:rule", "a face-down Gimcrack is only a resource (CR 411.1) with no rules text: nothing is offered", () => {
  const g = gimBoard({ faceDown: true });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("gim")), 0);
});

clause(GIMCRACK, "0:rule", "'your turn' is its controller's turn: a Gimcrack I own but my opponent controls offers nothing at my turn start", () => {
  const g = gimBoard({ controller: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.pendingChoice, undefined, "it is not 'my' Gimcrack right now");
  assert.equal(tokensOn(g.engine, g.id("gim")), 0);
});

clause(GIMCRACK, "0:rule", "...and the controller (my opponent) is the one offered the token at the start of THEIR turn", () => {
  const g = gimBoard({ controller: P2, turn: 1, active: P1 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "the offer is made to the controller");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
});

clause(GIMCRACK, "0:rule", "a Gimcrack I stole from my opponent offers me the token on my turn", () => {
  const g = gimBoard({ owner: P2, controller: P1 });
  assert.equal(myTurnStarts(g, ["accept"]), 1);
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
});

clause(GIMCRACK, "0:rule", "two Gimcracks each make their own offer: accepting both gives each of them one token", () => {
  const g = gimBoard({ second: true });
  assert.equal(myTurnStarts(g, ["accept", "accept"]), 2);
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
  assert.equal(tokensOn(g.engine, g.id("gim2")), 1);
});

clause(GIMCRACK, "0:rule", "two Gimcracks: accepting one offer and declining the other gives exactly one token in total", () => {
  const g = gimBoard({ second: true });
  assert.equal(myTurnStarts(g, ["accept", "decline"]), 2);
  assert.equal(tokensOn(g.engine, g.id("gim")) + tokensOn(g.engine, g.id("gim2")), 1);
});

// --- 1:rule@eee  [E][E][E]: At the start of your turn, you may put a token on this card. ---

clause(GIMCRACK, "1:rule@eee", "with [E][E][E] there is a second offer at the start of my turn: accepting both puts two tokens on it", () => {
  const g = gimBoard({ icons: { elitism: 3 } });
  assert.equal(myTurnStarts(g, ["accept", "accept"]), 2, "two paragraphs, two offers");
  assert.equal(tokensOn(g.engine, g.id("gim")), 2);
});

clause(GIMCRACK, "1:rule@eee", "with [E][E][E] both offers are 'may's: accepting one and declining the other gives one token", () => {
  const g = gimBoard({ icons: { elitism: 3 } });
  myTurnStarts(g, ["accept", "decline"]);
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
  const h = gimBoard({ icons: { elitism: 3 } });
  myTurnStarts(h, ["decline", "accept"]);
  assert.equal(tokensOn(h.engine, h.id("gim")), 1);
});

clause(GIMCRACK, "1:rule@eee", "with [E][E][E] declining both offers puts no token on it", () => {
  const g = gimBoard({ icons: { elitism: 3 } });
  assert.equal(myTurnStarts(g, ["decline", "decline"]), 2);
  assert.equal(tokensOn(g.engine, g.id("gim")), 0);
});

clause(GIMCRACK, "1:rule@eee", "more than [E][E][E] does not give a third offer: six [E] still make exactly two offers", () => {
  const g = gimBoard({ icons: { elitism: 6 } });
  assert.equal(myTurnStarts(g, ["accept", "accept", "accept"]), 2);
  assert.equal(tokensOn(g.engine, g.id("gim")), 2);
});

clause(GIMCRACK, "1:rule@eee", "the [E][E][E] paragraph is off with only two [E]: one offer, one token at most", () => {
  const g = gimBoard({ icons: { elitism: 2, greed: 4 } });
  assert.equal(myTurnStarts(g, ["accept", "accept"]), 1);
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
});

clause(GIMCRACK, "1:rule@eee", "the three icons must be [E]: three Greed give no second offer", () => {
  const g = gimBoard({ icons: { greed: 3, elitism: 1 } });
  assert.equal(myTurnStarts(g, ["accept", "accept"]), 1);
});

clause(GIMCRACK, "1:rule@eee", "my opponent's [E] do not count: they have three, I have none", () => {
  const g = gimBoard({ oppIcons: { elitism: 4 } });
  assert.equal(myTurnStarts(g, ["accept", "accept"]), 1);
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
});

clause(GIMCRACK, "1:rule@eee", "face-down resources are Volition, not [E]: three of them give no second offer", () => {
  const g = gimBoard({ extra: volition(3) });
  assert.equal(myTurnStarts(g, ["accept", "accept"]), 1);
});

clause(GIMCRACK, "1:rule@eee", "spent resources still count as [E] I control (icons are never spent, CR 405.6)", () => {
  const g = gimBoard({ extra: [...spent("elitism", 2), ...res({ elitism: 1 })] });
  assert.equal(myTurnStarts(g, ["accept", "accept"]), 2);
});

clause(GIMCRACK, "1:rule@eee", "it turns off again when the [E] are gone: with [E][E][E] two offers, after losing one [E] only one", () => {
  const g = gimBoard({ icons: { elitism: 3 }, extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  assert.equal(myTurnStarts(g, ["decline", "decline"]), 2, "[E][E][E]: two offers");
  const elitism = playOf(g.engine, P1).filter((cardId) => g.engine.getDefinition(cardId).name === "Elitism");
  assert.equal(elitism.length, 3);
  play(g.engine, P1, g.id("rm"), { selected: { t: [elitism[0]] } });
  assert.equal(zoneOf(g.engine, elitism[0]), "removed", "setup: an [E] is gone");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(answerOffers(g.engine, ["accept", "accept"]), 1, "only the base paragraph is left");
  assert.equal(tokensOn(g.engine, g.id("gim")), 1);
});

clause(GIMCRACK, "1:rule@eee", "the second paragraph is also 'your turn' only: no offer at my opponent's turn start even with [E][E][E]", () => {
  const g = gimBoard({ icons: { elitism: 3 }, turn: 1, active: P1 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("gim")), 0);
});

clause(GIMCRACK, "1:rule@eee", "two Gimcracks with [E][E][E]: four offers, up to four tokens between them", () => {
  const g = gimBoard({ icons: { elitism: 3 }, second: true });
  assert.equal(myTurnStarts(g, ["accept", "accept", "accept", "accept"]), 4);
  assert.equal(tokensOn(g.engine, g.id("gim")) + tokensOn(g.engine, g.id("gim2")), 4);
});

// --- 2:ability:do-something  DO...SOMETHING! ---------------------------------------------
// COST: X is the number of tokens on this card. Destroy this card.
// EFFECT: Destroy all characters with numeric cost X.

/** P1: Gimcrack (key "gim", `tokens` tokens) and characters m0..m4 (printed cost = the digit). P2: f0..f4 likewise. All life 9. */
function doBoard(o: { tokens?: number; zone?: "play" | "hand"; faceDown?: boolean; turn?: number; active?: PlayerId; extra?: CardPlacement[]; icons?: Icons; gimOwner?: PlayerId } = {}) {
  const chars = (prefix: string, owner: PlayerId): CardPlacement[] =>
    [0, 1, 2, 3, 4].map((cost) => ({ key: `${prefix}${cost}`, def: character({ name: `${prefix.toUpperCase()} Cost ${cost}`, cost, strength: 1, life: 9, speed: 1 }), owner, zone: "play" as const }));
  return devBoard(
    [
      { key: "gim", def: printing(GIMCRACK), owner: o.gimOwner ?? P1, controller: P1, zone: o.zone ?? "play", faceDown: o.faceDown, counters: o.tokens ? { token: o.tokens } : undefined },
      ...chars("m", P1),
      ...chars("f", P2),
      ...res(o.icons ?? {}),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type DoGame = ReturnType<typeof doBoard>;

const doSomething = (g: DoGame, player: PlayerId = P1) => activate(g.engine, player, g.id("gim"), "do-something");
const doSomethingAttempt = (g: DoGame, player: PlayerId = P1) => () => actRaw(g.engine, player, g.id("gim"), "do-something");

/** After DO...SOMETHING! with X = `cost`: exactly the characters of printed cost `cost` (both players') are in the discard pile, every other character is still in play. */
function assertDestroyedWithCost(g: DoGame, cost: number): void {
  for (const prefix of ["m", "f"]) {
    for (let c = 0; c <= 4; c++) {
      const expected = c === cost ? "discard" : "play";
      assert.equal(zoneOf(g.engine, g.id(`${prefix}${c}`)), expected, `${prefix}${c} (cost ${c}) with X = ${cost}`);
    }
  }
}

clause(GIMCRACK, "2:ability:do-something", "3 tokens: X = 3 destroys every character with numeric cost 3, mine and my opponent's, and no other", () => {
  const g = doBoard({ tokens: 3 });
  doSomething(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assertDestroyedWithCost(g, 3);
});

clause(GIMCRACK, "2:ability:do-something", "1 token: X = 1 destroys exactly the cost-1 characters", () => {
  const g = doBoard({ tokens: 1 });
  doSomething(g);
  assertDestroyedWithCost(g, 1);
});

clause(GIMCRACK, "2:ability:do-something", "2 tokens: X = 2 destroys exactly the cost-2 characters", () => {
  const g = doBoard({ tokens: 2 });
  doSomething(g);
  assertDestroyedWithCost(g, 2);
});

clause(GIMCRACK, "2:ability:do-something", "4 tokens: X = 4 destroys exactly the cost-4 characters", () => {
  const g = doBoard({ tokens: 4 });
  doSomething(g);
  assertDestroyedWithCost(g, 4);
});

clause(GIMCRACK, "2:ability:do-something", "no tokens: X = 0, which is a legal count: exactly the cost-0 characters are destroyed (X is not 'unset')", () => {
  const g = doBoard({ tokens: 0 });
  doSomething(g);
  assertDestroyedWithCost(g, 0);
});

clause(GIMCRACK, "2:ability:do-something", "more tokens than any character costs: X = 7 destroys no character, the cost is still paid", () => {
  const g = doBoard({ tokens: 7 });
  doSomething(g);
  assertDestroyedWithCost(g, 7);
  assert.equal(zoneOf(g.engine, g.id("gim")), "discard", "the Gimcrack was still destroyed as the cost");
});

clause(GIMCRACK, "2:ability:do-something", "the cost destroys the Gimcrack itself: it ends in its owner's discard pile", () => {
  const g = doBoard({ tokens: 3 });
  doSomething(g);
  assert.equal(zoneOf(g.engine, g.id("gim")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("gim")), "discardOf(g.engine, P1).includes(g.id(\"gim\"))");
});

clause(GIMCRACK, "2:ability:do-something", "the cost is only 'destroy this card': no resource is spent", () => {
  const g = doBoard({ tokens: 3, icons: { elitism: 3 } });
  const before = ready(g.engine);
  doSomething(g);
  assert.equal(ready(g.engine), before);
  assert.equal(zoneOf(g.engine, g.id("m3")), "discard", "control: the effect happened");
});

clause(GIMCRACK, "2:ability:do-something", "it can be used with no resources at all", () => {
  const g = doBoard({ tokens: 2, icons: {} });
  assert.equal(ready(g.engine), 0);
  doSomething(g);
  assert.equal(zoneOf(g.engine, g.id("f2")), "discard");
});

clause(GIMCRACK, "2:ability:do-something", "'all characters': several characters of the same cost on both sides are all destroyed", () => {
  const g = doBoard({
    tokens: 2,
    extra: [
      { key: "m2b", def: character({ name: "Mine Two B", cost: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "m2c", def: character({ name: "Mine Two C", cost: 2, life: 9 }), owner: P1, zone: "play" },
      { key: "f2b", def: character({ name: "Foe Two B", cost: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "f2c", def: character({ name: "Foe Two C", cost: 2, life: 9 }), owner: P2, zone: "play" },
      { key: "f2d", def: character({ name: "Foe Two D", cost: 2, life: 9 }), owner: P2, zone: "play" }
    ]
  });
  doSomething(g);
  for (const key of ["m2", "m2b", "m2c", "f2", "f2b", "f2c", "f2d"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} destroyed`);
  for (const key of ["m1", "m3", "f1", "f3"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} survives`);
});

clause(GIMCRACK, "2:ability:do-something", "only CHARACTERS are destroyed: an item, a location and a resource of numeric cost X stay in play, and so do the factions", () => {
  const g = doBoard({
    tokens: 3,
    extra: [
      { key: "thing", def: item({ name: "Thing", cost: 3 }), owner: P2, zone: "play" },
      { key: "myThing", def: item({ name: "My Thing", cost: 3 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", cost: 3 }), owner: P2, zone: "play" },
      { key: "rsrc", def: resourceCard({ name: "Costly Resource", cost: 3 }), owner: P1, zone: "play" }
    ]
  });
  doSomething(g);
  assert.equal(zoneOf(g.engine, g.id("m3")), "discard", "control: characters were destroyed");
  for (const key of ["thing", "myThing", "place", "rsrc"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
  assert.equal(zoneOf(g.engine, g.engine.state.players[P1].factionId!), "play");
  assert.equal(zoneOf(g.engine, g.engine.state.players[P2].factionId!), "play");
});

clause(GIMCRACK, "2:ability:do-something", "a face-down character with printed cost X is only a resource (CR 411.1): it is not destroyed", () => {
  const g = doBoard({
    tokens: 3,
    extra: [{ key: "hidden", def: character({ name: "Hidden", cost: 3, life: 9 }), owner: P2, zone: "play", faceDown: true }]
  });
  doSomething(g);
  assert.equal(zoneOf(g.engine, g.id("f3")), "discard", "control: the face-up cost-3 character was destroyed");
  assert.equal(zoneOf(g.engine, g.id("hidden")), "play");
  assert.equal(isFaceDown(g.engine, g.id("hidden")), true);
});

clause(GIMCRACK, "2:ability:do-something", "only characters in play: cost-X characters in hands, decks and discard piles stay where they are", () => {
  const g = doBoard({
    tokens: 3,
    extra: [
      { key: "h1", def: character({ name: "Hand One", cost: 3 }), owner: P1, zone: "hand" },
      { key: "h2", def: character({ name: "Hand Two", cost: 3 }), owner: P2, zone: "hand" },
      { key: "d1", def: character({ name: "Deck One", cost: 3 }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "Deck Two", cost: 3 }), owner: P2, zone: "deck" },
      { key: "x1", def: character({ name: "Disc One", cost: 3 }), owner: P1, zone: "discard" },
      { key: "x2", def: character({ name: "Disc Two", cost: 3 }), owner: P2, zone: "discard" }
    ]
  });
  doSomething(g);
  assert.equal(zoneOf(g.engine, g.id("m3")), "discard", "control: the effect happened");
  assert.equal(zoneOf(g.engine, g.id("h1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("h2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("d1")), "deck");
  assert.equal(zoneOf(g.engine, g.id("d2")), "deck");
  assert.equal(zoneOf(g.engine, g.id("x1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("x2")), "discard");
});

clause(GIMCRACK, "2:ability:do-something", "destroyed characters go to their OWNER's discard pile: a character I stole goes to my opponent's pile, one I lost goes to mine", () => {
  const g = doBoard({
    tokens: 3,
    extra: [
      { key: "stolenIn", def: character({ name: "Stolen In", cost: 3, life: 9 }), owner: P2, controller: P1, zone: "play" },
      { key: "stolenOut", def: character({ name: "Stolen Out", cost: 3, life: 9 }), owner: P1, controller: P2, zone: "play" }
    ]
  });
  doSomething(g);
  assert.ok(discardOf(g.engine, P2).includes(g.id("stolenIn")), "owned by my opponent: their discard pile");
  assert.equal(discardOf(g.engine, P1).includes(g.id("stolenIn")), false);
  assert.ok(discardOf(g.engine, P1).includes(g.id("stolenOut")), "owned by me: my discard pile");
  assert.ok(discardOf(g.engine, P1).includes(g.id("m3")), "discardOf(g.engine, P1).includes(g.id(\"m3\"))");
  assert.ok(discardOf(g.engine, P2).includes(g.id("f3")), "discardOf(g.engine, P2).includes(g.id(\"f3\"))");
});

clause(GIMCRACK, "2:ability:do-something", "damage and stats do not matter: a damaged or high-life character of cost X is destroyed, a 'cost X' printed number is what counts", () => {
  const g = doBoard({
    tokens: 3,
    extra: [
      { key: "tank", def: character({ name: "Tank", cost: 3, life: 30, strength: 9 }), owner: P2, zone: "play" },
      { key: "cheap", def: character({ name: "Cheap But Strong", cost: 1, life: 1, strength: 9 }), owner: P2, zone: "play" }
    ]
  });
  doSomething(g);
  assert.equal(zoneOf(g.engine, g.id("tank")), "discard");
  assert.equal(zoneOf(g.engine, g.id("cheap")), "play", "a strong cost-1 character is not a cost-3 character");
});

clause(GIMCRACK, "2:ability:do-something", "a character that is not X by cost is untouched whatever its strength, life or speed equals X", () => {
  const g = doBoard({
    tokens: 3,
    extra: [{ key: "stats3", def: character({ name: "Three Stats", cost: 5, strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" }]
  });
  doSomething(g);
  assert.equal(zoneOf(g.engine, g.id("stats3")), "play", "3/3/3 but cost 5");
  assert.equal(zoneOf(g.engine, g.id("f3")), "discard", "control: cost 3 destroyed");
});

clause(GIMCRACK, "2:ability:do-something", "the number of tokens is taken when I use it: with the tokens gone from the destroyed Gimcrack the effect still uses X = 3 (a cost-0 character survives)", () => {
  const g = doBoard({ tokens: 3 });
  doSomething(g);
  assert.equal(zoneOf(g.engine, g.id("m0")), "play", "X is not re-read as 0 after the Gimcrack left play");
  assert.equal(zoneOf(g.engine, g.id("f0")), "play");
  assert.equal(zoneOf(g.engine, g.id("m3")), "discard");
});

clause(GIMCRACK, "2:ability:do-something", "it resolves after my opponent's response: they may respond, and the effect still destroys the cost-X characters present when it resolves", () => {
  const g = doBoard({
    tokens: 3,
    extra: [
      { key: "late", def: character({ name: "Late Arrival", cost: 3, life: 9 }), owner: P2, zone: "hand" },
      { key: "bounce", def: tactic({ name: "Bounce Mine", cost: 0, behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P2, zone: "hand" }
    ]
  });
  actRaw(g.engine, P1, g.id("gim"), "do-something");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("gim")), "discard", "the cost was paid when I used it");
  assert.equal(zoneOf(g.engine, g.id("f3")), "play", "the effect has not happened yet");
  respondWith(g.engine, P2, g.id("bounce"), { t: [g.id("f3")] });
  assert.equal(zoneOf(g.engine, g.id("f3")), "hand", "they bounced their own cost-3 character in response");
  assert.equal(zoneOf(g.engine, g.id("m3")), "discard", "my cost-3 character was still destroyed");
});

clause(GIMCRACK, "2:ability:do-something", "only its controller can use it: my opponent cannot, in a response window of their own (control: I can)", () => {
  const g = doBoard({ tokens: 3, turn: 1, active: P1 });
  declareAttackOpenWindow(g.engine, P1, [g.id("m1")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(doSomethingAttempt(g, P2), "the Gimcrack is mine, not theirs", /control|owner|yours|your/i);
  assert.equal(zoneOf(g.engine, g.id("gim")), "play", "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("f3")), "play");
});

clause(GIMCRACK, "2:ability:do-something", "a Gimcrack I stole from my opponent is mine to use: its tokens are X and the cost-X characters die; it goes to ITS owner's discard pile", () => {
  const g = doBoard({ tokens: 3, gimOwner: P2 });
  assert.equal(controllerOf(g.engine, g.id("gim")), P1);
  doSomething(g);
  assertDestroyedWithCost(g, 3);
  assert.ok(discardOf(g.engine, P2).includes(g.id("gim")), "destroyed, it goes to its owner's discard pile");
});

clause(GIMCRACK, "2:ability:do-something", "it can be used from play only: refused while the Gimcrack is in my hand", () => {
  const bad = doBoard({ tokens: 0, zone: "hand" });
  refused(doSomethingAttempt(bad), "in hand", /Activated ability not found|not in play|play/i);
  assert.equal(zoneOf(bad.engine, bad.id("m0")), "play");
  const good = doBoard({ tokens: 0 });
  doSomething(good);
  assert.equal(zoneOf(good.engine, good.id("m0")), "discard", "control: from play it works");
});

clause(GIMCRACK, "2:ability:do-something", "a face-down Gimcrack is only a resource with no rules text: DO...SOMETHING! cannot be used", () => {
  const g = doBoard({ tokens: 0, faceDown: true });
  refused(doSomethingAttempt(g), "face-down", /Activated ability not found|face-down|rules text/i);
  assert.equal(zoneOf(g.engine, g.id("m0")), "play");
});

clause(GIMCRACK, "2:ability:do-something", "an ability: usable at any time, so also in response on my opponent's turn - the attacker of cost X dies before blockers", () => {
  const g = doBoard({ tokens: 2, turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("f2")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in their attack");
  actRaw(g.engine, P1, g.id("gim"), "do-something");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("f2")), "discard", "their attacker (cost 2) was destroyed");
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "so was my own cost-2 character");
  assert.equal(zoneOf(g.engine, g.id("f1")), "play");
});

clause(GIMCRACK, "2:ability:do-something", "it is not limited to once per turn or once per restore, and needs no untapped Gimcrack: with two Gimcracks I can use both in one turn", () => {
  const g = doBoard({ tokens: 1, extra: [{ key: "gim2", def: printing(GIMCRACK), owner: P1, zone: "play", counters: { token: 3 } }] });
  doSomething(g);
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard");
  activate(g.engine, P1, g.id("gim2"), "do-something");
  assert.equal(zoneOf(g.engine, g.id("m3")), "discard");
  assert.equal(zoneOf(g.engine, g.id("f3")), "discard");
  assert.equal(zoneOf(g.engine, g.id("gim2")), "discard");
});

// =================================================================================
// Golemizer
// ATTACH TO CHARACTER
// The attached character loses 1 speed for each token on it.
// At the end of your turn, you may put a token on the attached character. If it has 0 speed, destroy it.
// If this card is destroyed, you may flip it face-down under its owner's control instead.
// FLIP UP: 4 [E][E][E]
// Item (gear), cost 1, [E].
// =================================================================================

const GOLEMIZER = "84ffcb2a-5b0a-42d2-97e6-c6358f6faf41";

/** A free tactic (id "flipdown", pick "t"): flips one picked character face-down (it stops being a character). */
function flipperTactic(name = "Flipper"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "flipdown",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** An item whose ability (id "sac", pick "v") destroys one picked item as its COST, then draws a card. */
function sacrificerItem(name = "Sacrificer"): CardDefinition {
  return item({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sac",
          type: "activated",
          targets: [{ id: "v", selector: { zone: "play", type: "item" }, count: 1 }],
          costs: [{ type: "destroy", target: { type: "selected", id: "v" } }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
}

interface GzOpts {
  gz?: "hand" | "play" | "faceDown";
  host?: "mine" | "foe";
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  mineSpeed?: number;
  foeSpeed?: number;
  mineTokens?: number;
  foeTokens?: number;
  second?: boolean;
  gzOwner?: PlayerId;
  gzController?: PlayerId;
  gzTokens?: number;
  /** a face-down Golemizer already spent (attached to my faction) */
  gzSpent?: boolean;
  foeStrength?: number;
  foeLife?: number;
  extra?: CardPlacement[];
}

/**
 * P1: gz (the Golemizer; attached to `host` when in play), mine / mine2 (characters), mh (character in hand).
 * P2: foe / foe2 (characters), thing (item), place (location), fd (face-down character), oc (character in hand).
 * Default: P1's turn 1, `icons` Elitism.
 */
function gzBoard(o: GzOpts = {}) {
  const where = o.gz ?? "hand";
  const host = o.host ?? "mine";
  return devBoard(
    [
      {
        key: "gz",
        def: printing(GOLEMIZER),
        owner: o.gzOwner ?? P1,
        controller: o.gzController,
        zone: where === "hand" ? "hand" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: where === "play" ? host : o.gzSpent ? "__factionA" : undefined,
        counters: o.gzTokens ? { token: o.gzTokens } : undefined
      },
      ...(o.second ? [{ key: "gz2", def: printing(GOLEMIZER), owner: P1, zone: "play" as const, attachedToKey: host }] : []),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 9, speed: o.mineSpeed ?? 3 }), owner: P1, zone: "play", counters: o.mineTokens ? { token: o.mineTokens } : undefined },
      { key: "mine2", def: character({ name: "Mine Two", strength: 2, life: 9, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: o.foeStrength ?? 2, life: o.foeLife ?? 9, speed: o.foeSpeed ?? 3 }), owner: P2, zone: "play", counters: o.foeTokens ? { token: o.foeTokens } : undefined },
      { key: "foe2", def: character({ name: "Foe Two", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden", life: 9 }), owner: P2, zone: "play", faceDown: true },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OppHandChar" }), owner: P2, zone: "hand" },
      ...res(o.icons ?? { elitism: 5 }),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type GzGame = ReturnType<typeof gzBoard>;

const deployGz = (g: GzGame, host: string = "mine") => play(g.engine, P1, g.id("gz"), { selected: { attachTo: [g.id(host)] } });
const deployGzRaw = (g: GzGame, host: CardInstanceId) => () => playRaw(g.engine, P1, g.id("gz"), { selected: { attachTo: [host] } });
const speedOf = (g: GzGame, key: string): number => g.engine.getStat(g.id(key), "speed");

/** My turn ends: returns the offers made (answering with `script`; replacement offers are answered with `replace`). */
function myTurnEnds(g: GzGame, script: Array<"accept" | "decline"> = [], replace = false): number {
  endTurn(g.engine, P1);
  return answerOffers(g.engine, script, [], replace);
}

// --- 0:attach  ATTACH TO CHARACTER -------------------------------------------------------

clause(GOLEMIZER, "0:attach", "deploys for exactly its printed cost of 1 and enters play attached to the picked character (one of mine)", () => {
  const g = gzBoard({ icons: { elitism: 3 } });
  const before = ready(g.engine);
  deployGz(g);
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, g.id("mine"), "attached to the picked character");
  assert.equal(before - ready(g.engine), 1, "the printed cost of 1");
  assert.equal(g.engine.state.cards[g.id("mine2")].attachedTo, undefined, "no other character gets it");
  assert.equal(controllerOf(g.engine, g.id("gz")), P1);
});

clause(GOLEMIZER, "0:attach", "it can attach to an opponent's character (ATTACH TO CHARACTER names no controller): I still control the Golemizer", () => {
  const g = gzBoard();
  deployGz(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, g.id("foe"));
  assert.equal(controllerOf(g.engine, g.id("gz")), P1);
  assert.equal(g.engine.state.cards[g.id("foe")].controllerId, P2, "the host stays theirs");
});

clause(GOLEMIZER, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card and cards outside play", () => {
  const g = gzBoard();
  refused(deployGzRaw(g, g.id("thing")), "an item");
  refused(deployGzRaw(g, g.id("place")), "a location");
  refused(deployGzRaw(g, g.engine.state.players[P2].factionId!), "a faction");
  refused(deployGzRaw(g, g.engine.state.players[P1].factionId!), "my own faction");
  refused(deployGzRaw(g, g.id("fd")), "a face-down card (only a resource)");
  refused(deployGzRaw(g, g.id("mh")), "a character in my hand");
  refused(deployGzRaw(g, g.id("oc")), "a character in the opponent's hand");
  assert.equal(zoneOf(g.engine, g.id("gz")), "hand", "nothing was played");
  deployGzRaw(g, g.id("mine"))();
  assert.ok(g.engine.state.responseWindow, "control: a character is accepted");
});

clause(GOLEMIZER, "0:attach", "a host must be picked, exactly one", () => {
  const g = gzBoard();
  refused(() => playRaw(g.engine, P1, g.id("gz"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(g.engine, P1, g.id("gz"), { selected: {} }), "no host declared");
  refused(() => playRaw(g.engine, P1, g.id("gz"), { selected: { attachTo: [g.id("mine"), g.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(g.engine, g.id("gz")), "hand");
});

clause(GOLEMIZER, "0:attach", "with no character in play at all it cannot be deployed", () => {
  const { engine, id } = devBoard([{ key: "gz", def: printing(GOLEMIZER), owner: P1, zone: "hand" }, ...res({ elitism: 3 })]);
  refused(() => playRaw(engine, P1, id("gz"), { selected: { attachTo: [] } }), "no host available");
  assert.equal(zoneOf(engine, id("gz")), "hand");
  assert.equal(ready(engine), 3, "nothing was paid");
});

clause(GOLEMIZER, "0:attach", "if the picked host is destroyed in response, the Golemizer never enters play: it goes to its owner's discard pile (CR 507.2c)", () => {
  const g = gzBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }, ...res({ elitism: 0 })] });
  playRaw(g.engine, P1, g.id("gz"), { selected: { attachTo: [g.id("foe")] } });
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("foe")] });
  assert.equal(g.engine.state.pendingChoice, undefined, "it was put into the discard pile, not destroyed: no offer to flip it");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(zoneOf(g.engine, g.id("gz")), "discard", "no host left: put into its owner's discard pile");
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, undefined);
});

clause(GOLEMIZER, "0:attach", "when the host is destroyed later, the Golemizer leaves play with it (to its owner's discard pile if I decline to flip it)", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("kill"), { selected: { t: [g.id("mine")] } });
  resolvePendingResponses(g.engine);
  answerOffers(g.engine, [], [], false);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("gz")), "discard", "attached cards leave play the same way their host does (CR 301.4)");
});

clause(GOLEMIZER, "0:attach", "when the host is put into its owner's hand, the Golemizer follows it to its owner's hand (CR 301.4a), not to the discard pile", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
  assert.equal(zoneOf(g.engine, g.id("gz")), "hand", "the attached card leaves play the same way: put into its owner's hand");
});

clause(GOLEMIZER, "0:attach", "when the host is removed from the game, the Golemizer is removed from the game too (CR 301.4a)", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("rm"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "removed");
  assert.equal(zoneOf(g.engine, g.id("gz")), "removed", "the attached card leaves play the same way");
});

clause(GOLEMIZER, "0:attach", "if the host stops being a character (flipped face-down into a resource) the Golemizer is flipped face-down with it", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "flip", def: flipperTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("flip"), { selected: { t: [g.id("mine")] } });
  answerOffers(g.engine, [], [], false);
  assert.equal(isFaceDown(g.engine, g.id("mine")), true, "the host is a face-down resource now");
  assert.equal(zoneOf(g.engine, g.id("gz")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(g.engine.state.cards[g.id("gz")].faceDown, true, "...and is flipped face-down along with its host");
});

clause(GOLEMIZER, "0:attach", "its cost is 1 with [E]: Greed alone is refused, no resources is refused, one [E] is enough", () => {
  const greed = gzBoard({ icons: { greed: 5 } });
  refused(deployGzRaw(greed, greed.id("mine")), "no [E]");
  const none = gzBoard({ icons: {} });
  refused(deployGzRaw(none, none.id("mine")), "no resources");
  assert.equal(zoneOf(none.engine, none.id("gz")), "hand");
  const one = gzBoard({ icons: { elitism: 1 } });
  deployGz(one);
  assert.equal(zoneOf(one.engine, one.id("gz")), "play");
  assert.equal(ready(one.engine), 0);
});

clause(GOLEMIZER, "0:attach", "an item is deployed on its controller's own turn only: refused on the opponent's turn", () => {
  const g = gzBoard({ turn: 2, active: P2 });
  refused(deployGzRaw(g, g.id("foe")), "the opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("gz")), "hand");
});

// --- 1:rule  The attached character loses 1 speed for each token on it. --------------------

clause(GOLEMIZER, "1:rule", "with no tokens on the host its speed is unchanged", () => {
  const g = gzBoard({ gz: "play" });
  assert.equal(speedOf(g, "mine"), 3);
});

clause(GOLEMIZER, "1:rule", "one token on the host: it loses exactly 1 speed", () => {
  const g = gzBoard({ gz: "play", mineTokens: 1 });
  assert.equal(speedOf(g, "mine"), 2);
});

clause(GOLEMIZER, "1:rule", "two tokens on the host: it loses 2 speed", () => {
  const g = gzBoard({ gz: "play", mineTokens: 2 });
  assert.equal(speedOf(g, "mine"), 1);
});

clause(GOLEMIZER, "1:rule", "three tokens on a 3-speed host: speed 0", () => {
  const g = gzBoard({ gz: "play", mineTokens: 3 });
  assert.equal(speedOf(g, "mine"), 0);
});

clause(GOLEMIZER, "1:rule", "speed cannot go below 0 (CR 410.4): five tokens on a 2-speed host leave it at 0, not -3", () => {
  const g = gzBoard({ gz: "play", mineSpeed: 2, mineTokens: 5 });
  assert.equal(speedOf(g, "mine"), 0);
});

clause(GOLEMIZER, "1:rule", "only speed changes: strength and life are untouched", () => {
  const g = gzBoard({ gz: "play", mineTokens: 2 });
  assert.equal(g.engine.getStat(g.id("mine"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("mine"), "life"), 9);
});

clause(GOLEMIZER, "1:rule", "'tokens on it' means tokens on the attached character: tokens on the Golemizer itself do nothing", () => {
  const g = gzBoard({ gz: "play", gzTokens: 4 });
  assert.equal(tokensOn(g.engine, g.id("gz")), 4, "setup");
  assert.equal(speedOf(g, "mine"), 3);
});

clause(GOLEMIZER, "1:rule", "only the attached character is slowed: other characters with tokens keep their speed", () => {
  const g = gzBoard({ gz: "play", mineTokens: 1, foeTokens: 2 });
  assert.equal(speedOf(g, "mine"), 2);
  assert.equal(speedOf(g, "foe"), 3, "an unattached opposing character with tokens");
  assert.equal(speedOf(g, "mine2"), 3);
  assert.equal(speedOf(g, "foe2"), 3);
});

clause(GOLEMIZER, "1:rule", "it works on an opponent's host just the same", () => {
  const g = gzBoard({ gz: "play", host: "foe", foeTokens: 2 });
  assert.equal(speedOf(g, "foe"), 1);
  assert.equal(speedOf(g, "mine"), 3);
});

clause(GOLEMIZER, "1:rule", "it is live: tokens added later slow the host at once", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "tg", def: tokenGiver(2), owner: P1, zone: "hand" }] });
  assert.equal(speedOf(g, "mine"), 3);
  play(g.engine, P1, g.id("tg"), { selected: { t: [g.id("mine")] } });
  assert.equal(tokensOn(g.engine, g.id("mine")), 2);
  assert.equal(speedOf(g, "mine"), 1);
});

clause(GOLEMIZER, "1:rule", "it is not permanent: once the Golemizer has left play the host has its speed back (the tokens stay)", () => {
  const g = gzBoard({ gz: "play", mineTokens: 2, extra: [{ key: "kill", def: itemKillerTactic(), owner: P1, zone: "hand" }] });
  assert.equal(speedOf(g, "mine"), 1);
  playRaw(g.engine, P1, g.id("kill"), { selected: { t: [g.id("gz")] } });
  resolvePendingResponses(g.engine);
  answerOffers(g.engine, [], [], false);
  assert.equal(zoneOf(g.engine, g.id("gz")), "discard");
  assert.equal(tokensOn(g.engine, g.id("mine")), 2, "the tokens stay on the character");
  assert.equal(speedOf(g, "mine"), 3);
});

clause(GOLEMIZER, "1:rule", "two Golemizers on one host each take 1 speed per token: 1 token and 2 Golemizers is -2", () => {
  const g = gzBoard({ gz: "play", second: true, mineTokens: 1 });
  assert.equal(speedOf(g, "mine"), 1);
});

clause(GOLEMIZER, "1:rule", "a Golemizer that is not in play (in hand) slows nobody", () => {
  const g = gzBoard({ gz: "hand", mineTokens: 2 });
  assert.equal(speedOf(g, "mine"), 3);
});

clause(GOLEMIZER, "1:rule", "a slowed host is slower in a battle: with 2 tokens its speed 3 is 1, so my speed-2 attacker strikes first and kills it before it deals damage", () => {
  const board = (gz: "play" | "hand") =>
    gzBoard({
      gz,
      host: "foe",
      foeTokens: 2,
      foeStrength: 5,
      foeLife: 3,
      turn: 1,
      active: P1,
      extra: [{ key: "atk", def: character({ name: "Attacker", strength: 5, life: 3, speed: 2 }), owner: P1, zone: "play" }]
    });
  const slowed = board("play");
  fight(slowed.engine, P1, [slowed.id("atk")], { type: "faction", playerId: P2 }, [slowed.id("foe")]);
  assert.equal(zoneOf(slowed.engine, slowed.id("foe")), "discard", "the slowed blocker (speed 1) is killed by the speed-2 attacker");
  assert.equal(zoneOf(slowed.engine, slowed.id("atk")), "play", "...before it can deal its damage");
  const control = board("hand");
  fight(control.engine, P1, [control.id("atk")], { type: "faction", playerId: P2 }, [control.id("foe")]);
  assert.equal(zoneOf(control.engine, control.id("atk")), "discard", "control: without the Golemizer the speed-3 blocker strikes first");
  assert.equal(zoneOf(control.engine, control.id("foe")), "play");
});

// --- 2:rule  At the end of your turn, you may put a token on the attached character. If it has 0 speed, destroy it. ---

clause(GOLEMIZER, "2:rule", "at the end of my turn I may put a token on the attached character: accepting puts exactly one token on my character", () => {
  const g = gzBoard({ gz: "play" });
  endTurn(g.engine, P1);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the offer is made to the Golemizer's controller");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("mine")), 1, "the token is on the attached character");
  assert.equal(tokensOn(g.engine, g.id("gz")), 0, "not on the Golemizer");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "speed 2 is not 0");
});

clause(GOLEMIZER, "2:rule", "accepting also works on an opponent's character: the token goes on it", () => {
  const g = gzBoard({ gz: "play", host: "foe" });
  assert.equal(myTurnEnds(g, ["accept"]), 1);
  assert.equal(tokensOn(g.engine, g.id("foe")), 1);
  assert.equal(tokensOn(g.engine, g.id("mine")), 0);
  assert.equal(speedOf(g, "foe"), 2);
});

clause(GOLEMIZER, "2:rule", "it is a 'may': declining puts no token on the host", () => {
  const g = gzBoard({ gz: "play" });
  assert.equal(myTurnEnds(g, ["decline"]), 1);
  assert.equal(tokensOn(g.engine, g.id("mine")), 0);
  assert.equal(speedOf(g, "mine"), 3);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

clause(GOLEMIZER, "2:rule", "only the attached character gets the token", () => {
  const g = gzBoard({ gz: "play" });
  myTurnEnds(g, ["accept"]);
  for (const key of ["mine2", "foe", "foe2"]) assert.equal(tokensOn(g.engine, g.id(key)), 0, `${key} gets nothing`);
});

clause(GOLEMIZER, "2:rule", "'your turn' only: at the end of my OPPONENT'S turn nothing is offered", () => {
  const g = gzBoard({ gz: "play", turn: 2, active: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("mine")), 0);
});

clause(GOLEMIZER, "2:rule", "the token it puts slows the host: after two accepted turns a 3-speed host has 2 tokens and speed 1", () => {
  const g = gzBoard({ gz: "play" });
  myTurnEnds(g, ["accept"]);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  myTurnEnds(g, ["accept"]);
  assert.equal(tokensOn(g.engine, g.id("mine")), 2);
  assert.equal(speedOf(g, "mine"), 1);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

clause(GOLEMIZER, "2:rule", "a host that reaches 0 speed with the token is destroyed: speed 1 and a new token is speed 0", () => {
  const g = gzBoard({ gz: "play", mineSpeed: 1 });
  assert.equal(myTurnEnds(g, ["accept"]), 1);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "0 speed: destroyed");
  assert.ok(discardOf(g.engine, P1).includes(g.id("mine")), "discardOf(g.engine, P1).includes(g.id(\"mine\"))");
});

clause(GOLEMIZER, "2:rule", "a host that is slowed to exactly 0 over several turns is destroyed on the turn it gets there, not before", () => {
  const g = gzBoard({ gz: "play", mineSpeed: 2 });
  myTurnEnds(g, ["accept"]);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "speed 1 after the first token");
  endTurn(g.engine, P2);
  myTurnEnds(g, ["accept"]);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "speed 0 after the second token");
});

clause(GOLEMIZER, "2:rule", "an opponent's host slowed to 0 is destroyed, into ITS owner's discard pile", () => {
  const g = gzBoard({ gz: "play", host: "foe", foeSpeed: 1 });
  myTurnEnds(g, ["accept"]);
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.ok(discardOf(g.engine, P2).includes(g.id("foe")), "discardOf(g.engine, P2).includes(g.id(\"foe\"))");
});

clause(GOLEMIZER, "2:rule", "a host with speed left (3, then 2 after the token) is not destroyed", () => {
  const g = gzBoard({ gz: "play", host: "foe", foeSpeed: 3 });
  myTurnEnds(g, ["accept"]);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(speedOf(g, "foe"), 2);
});

clause(GOLEMIZER, "2:rule", "other characters at 0 speed are not destroyed: only the attached character is checked", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "slug", def: character({ name: "Slug", speed: 0, life: 9 }), owner: P2, zone: "play" }] });
  myTurnEnds(g, ["accept"]);
  assert.equal(zoneOf(g.engine, g.id("slug")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

clause(GOLEMIZER, "2:rule", "'If it has 0 speed, destroy it' is its own sentence: a host that already has 0 speed is destroyed at the end of my turn even if I decline the token", () => {
  const g = gzBoard({ gz: "play", mineSpeed: 0 });
  assert.equal(speedOf(g, "mine"), 0, "setup: the host has 0 speed");
  assert.equal(myTurnEnds(g, ["decline"]), 1);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "literal reading: the second sentence does not depend on the 'may'");
});

clause(GOLEMIZER, "2:rule", "a host that already has 0 speed is destroyed when I accept the token too", () => {
  const g = gzBoard({ gz: "play", mineSpeed: 0 });
  myTurnEnds(g, ["accept"]);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
});

clause(GOLEMIZER, "2:rule", "two Golemizers on one host: each makes its own offer, accepting both puts two tokens on the host", () => {
  const g = gzBoard({ gz: "play", second: true });
  assert.equal(myTurnEnds(g, ["accept", "accept"]), 2);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "two tokens at -2 speed each: the host reaches 0 speed and is destroyed (Golemizer text)");
  assert.equal(tokensOn(g.engine, g.id("mine")), 0, "its two tokens vanished when it left play (CR 409.2)");
});

clause(GOLEMIZER, "2:rule", "'your turn' is its controller's: a Golemizer my opponent controls offers nothing at the end of my turn, and its controller is offered at the end of theirs", () => {
  const g = gzBoard({ gz: "play", host: "mine", gzOwner: P1, gzController: P2 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.pendingChoice, undefined, "not my Golemizer right now");
  assert.equal(g.engine.state.activePlayerId, P2);
  endTurn(g.engine, P2);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "its controller is offered the token at the end of their turn");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(tokensOn(g.engine, g.id("mine")), 1);
});

clause(GOLEMIZER, "2:rule", "a face-down Golemizer or one in my hand has no rules text: nothing is offered at the end of my turn", () => {
  for (const gz of ["hand", "faceDown"] as const) {
    const g = gzBoard({ gz });
    endTurn(g.engine, P1);
    assert.equal(g.engine.state.pendingChoice, undefined, gz);
    assert.equal(tokensOn(g.engine, g.id("mine")), 0, gz);
  }
});

clause(GOLEMIZER, "2:rule", "'at the END of your turn': the token is offered when the turn actually ends (after my opponent's responses), not when the end of turn is announced (CR 610.1a)", () => {
  const g = gzBoard({ gz: "play" });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(g.engine.state.activePlayerId, P1, "the turn has not ended yet; the opponent may respond");
  assert.ok(g.engine.state.responseWindow, "the opponent's chance to respond to the end of turn");
  assert.equal(g.engine.state.pendingChoice, undefined, "end-of-turn triggers happen after the opponent's responses");
  resolvePendingResponses(g.engine);
  expectPending(g.engine, "chooserSelectsOption");
  assert.equal(g.engine.state.responseWindow, undefined, "the window is over: the offer comes as the turn ends");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 1 } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.activePlayerId, P2, "the turn passes once the end-of-turn effects are done");
});

// --- 3:rule  If this card is destroyed, you may flip it face-down under its owner's control instead. ---

/** Destroys the Golemizer with a free "destroy an item" tactic. */
function destroyGz(g: GzGame, player: PlayerId = P1): void {
  playRaw(g.engine, player, g.id("kill"), { selected: { t: [g.id("gz")] } });
  resolvePendingResponses(g.engine);
}

const withKiller = (o: GzOpts = {}) => gzBoard({ ...o, extra: [...(o.extra ?? []), { key: "kill", def: itemKillerTactic(), owner: P1, zone: "hand" }] });

clause(GOLEMIZER, "3:rule", "when it is destroyed I am offered the flip (a 'may'): accepting leaves it in play as a face-down card", () => {
  const g = withKiller({ gz: "play" });
  destroyGz(g);
  const pc = expectPending(g.engine, "replacementChoice");
  assert.equal(pc.playerId, P1, "its controller decides");
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gz")), "play", "it was not destroyed");
  assert.equal(isFaceDown(g.engine, g.id("gz")), true, "it is face-down");
  assert.equal(discardOf(g.engine, P1).includes(g.id("gz")), false);
});

clause(GOLEMIZER, "3:rule", "declining the flip lets it be destroyed: it goes to its owner's discard pile", () => {
  const g = withKiller({ gz: "play" });
  destroyGz(g);
  expectPending(g.engine, "replacementChoice");
  answerPending(g.engine, "replacementChoice", { apply: false });
  assert.equal(zoneOf(g.engine, g.id("gz")), "discard");
  assert.equal(g.engine.state.cards[g.id("gz")].faceDown, false);
});

clause(GOLEMIZER, "3:rule", "a flipped Golemizer is a face-down resource: it provides Volition and is in my resource pool", () => {
  const g = withKiller({ gz: "play", icons: { elitism: 2 } });
  const readyBefore = ready(g.engine);
  destroyGz(g);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(g.engine.isResource(g.id("gz")), true);
  assert.deepEqual(g.engine.getCardTypes(g.id("gz")), ["resource"]);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
  assert.equal(ready(g.engine), readyBefore + 1);
});

clause(GOLEMIZER, "3:rule", "a flipped Golemizer is not attached to its old host any more, and the host has its speed back (tokens stay)", () => {
  const g = withKiller({ gz: "play", mineTokens: 2 });
  assert.equal(speedOf(g, "mine"), 1);
  destroyGz(g);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, undefined);
  assert.equal(tokensOn(g.engine, g.id("mine")), 2);
  assert.equal(speedOf(g, "mine"), 3, "a face-down resource slows nobody");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

clause(GOLEMIZER, "3:rule", "'under its owner's control': a Golemizer my opponent controls and I own is offered to ITS controller, and ends up under MY control", () => {
  const g = withKiller({ gz: "play", gzOwner: P1, gzController: P2 });
  playRaw(g.engine, P1, g.id("kill"), { selected: { t: [g.id("gz")] } });
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "replacementChoice");
  assert.equal(pc.playerId, P2, "'you' is the player who controls the Golemizer");
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(isFaceDown(g.engine, g.id("gz")), true);
  assert.equal(controllerOf(g.engine, g.id("gz")), P1, "flipped face-down under its owner's control");
  assert.ok(playOf(g.engine, P1).includes(g.id("gz")), "it is in my play area");
  assert.equal(playOf(g.engine, P2).includes(g.id("gz")), false);
});

clause(GOLEMIZER, "3:rule", "when its host is destroyed the Golemizer is destroyed with it (CR 301.4a), and the offer to flip it face-down is made then too", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("kill"), { selected: { t: [g.id("mine")] } });
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "replacementChoice");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "the host was destroyed");
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(isFaceDown(g.engine, g.id("gz")), true);
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, undefined, "its host is gone: it is a loose face-down resource");
});

clause(GOLEMIZER, "3:rule", "only THIS card: with two Golemizers in play, destroying one asks about that one only (the other cannot flip it for me)", () => {
  const g = withKiller({ gz: "play", second: true });
  playRaw(g.engine, P1, g.id("kill"), { selected: { t: [g.id("gz")] } });
  resolvePendingResponses(g.engine);
  const seen: string[] = [];
  drain(g.engine, (pc) => {
    if (pc.kind === "replacementChoice") {
      seen.push(`${String(pc.sourceId)}->${String(pc.affectedCardId)}`);
      // say yes to any offer that is not the destroyed Golemizer's own
      return { kind: "replacementChoice", apply: pc.sourceId !== g.id("gz") };
    }
    return declineAll(pc);
  });
  assert.equal(zoneOf(g.engine, g.id("gz")), "discard", "I declined its own offer: it is destroyed");
  assert.deepEqual(seen.filter((entry) => !entry.startsWith(`${g.id("gz")}->`)), [], "no other card offered to flip the destroyed Golemizer");
  assert.equal(zoneOf(g.engine, g.id("gz2")), "play");
  assert.equal(isFaceDown(g.engine, g.id("gz2")), false, "the other Golemizer is untouched");
});

clause(GOLEMIZER, "3:rule", "it covers only this card: another item destroyed while a Golemizer is in play is simply destroyed, with no offer", () => {
  const g = withKiller({ gz: "play" });
  playRaw(g.engine, P1, g.id("kill"), { selected: { t: [g.id("thing")] } });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined, "no offer for somebody else's item");
  assert.equal(zoneOf(g.engine, g.id("thing")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("thing")), false);
});

clause(GOLEMIZER, "3:rule", "...also for another item of MINE (an item the Golemizer's controller controls): destroyed, no offer, no flip", () => {
  const g = withKiller({ gz: "play", extra: [{ key: "otherMine", def: item({ name: "My Other Item" }), owner: P1, zone: "play" }] });
  playRaw(g.engine, P1, g.id("kill"), { selected: { t: [g.id("otherMine")] } });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined, "the Golemizer does not offer to flip my other items");
  assert.equal(zoneOf(g.engine, g.id("otherMine")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("otherMine")), false);
  assert.equal(isFaceDown(g.engine, g.id("gz")), false, "the Golemizer itself is untouched");
});

clause(GOLEMIZER, "3:rule", "...and my Golemizer does not answer for my opponent's Golemizer: destroying theirs asks THEM, about THEIR card only", () => {
  const g = withKiller({ gz: "play", extra: [{ key: "ogz", def: printing(GOLEMIZER), owner: P2, zone: "play", attachedToKey: "foe" }] });
  playRaw(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ogz")] } });
  resolvePendingResponses(g.engine);
  const asked: string[] = [];
  drain(g.engine, (pc) => {
    if (pc.kind === "replacementChoice") {
      asked.push(`${String(pc.playerId)}:${String(pc.sourceId)}:${String(pc.affectedCardId)}`);
      return { kind: "replacementChoice", apply: false };
    }
    return declineAll(pc);
  });
  assert.deepEqual(asked.filter((entry) => !entry.startsWith(`${P2}:${g.id("ogz")}:${g.id("ogz")}`)), [], "only their Golemizer's own offer, made to them");
  assert.equal(zoneOf(g.engine, g.id("ogz")), "discard", "they declined: it is destroyed");
  assert.equal(zoneOf(g.engine, g.id("gz")), "play", "my Golemizer is untouched");
  assert.equal(isFaceDown(g.engine, g.id("gz")), false);
});

clause(GOLEMIZER, "3:rule", "a destroy paid as a COST is not replaced (CR 506.2): it goes straight to the discard pile with no offer", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "sacer", def: sacrificerItem(), owner: P1, zone: "play" }, ...fillers("dk", 2, P1, "deck")] });
  activate(g.engine, P1, g.id("sacer"), "sac", { selected: { v: [g.id("gz")] } });
  assert.equal(g.engine.state.pendingChoice, undefined, "a cost is not replaced");
  assert.equal(zoneOf(g.engine, g.id("gz")), "discard");
});

clause(GOLEMIZER, "3:rule", "it is about being DESTROYED only: put into its owner's hand (not destroyed) it just goes to the hand, with no offer", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("gz")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gz")), "hand");
});

clause(GOLEMIZER, "3:rule", "removed from the game (not destroyed) it is simply removed, with no offer", () => {
  const g = gzBoard({ gz: "play", extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("rm"), { selected: { t: [g.id("gz")] } });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gz")), "removed");
});

// --- 4:flipUp  FLIP UP: 4 [E][E][E] -----------------------------------------------------

const flipGz = (g: GzGame, host: CardInstanceId | undefined, player: PlayerId = P1) => () =>
  flipUpRaw(g.engine, player, g.id("gz"), host ? { attachTo: [host] } : {});

/** A face-down Golemizer in play with `icons` of mine. */
const gzFaceDown = (icons: Icons, o: GzOpts = {}) => gzBoard({ ...o, gz: "faceDown", icons });

clause(GOLEMIZER, "4:flipUp", "face-down in play it is a resource: one Volition, in the resource pool, with no rules text", () => {
  const g = gzFaceDown({ elitism: 2 });
  assert.equal(g.engine.isResource(g.id("gz")), true);
  assert.equal(ready(g.engine), 3, "two [E] plus the face-down Golemizer");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(GOLEMIZER, "4:flipUp", "flipping it up puts the item into play face-up, attached to the picked character, under my control", () => {
  const g = gzFaceDown({ elitism: 7 });
  flipGz(g, g.id("mine"))();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("gz")), "play");
  assert.equal(isFaceDown(g.engine, g.id("gz")), false, "face-up");
  assert.equal(g.engine.isResource(g.id("gz")), false, "an item now, not a resource");
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, g.id("mine"), "ATTACH TO applies: it is attached to the picked character");
  assert.equal(controllerOf(g.engine, g.id("gz")), P1);
});

clause(GOLEMIZER, "4:flipUp", "it can be flipped onto an opponent's character", () => {
  const g = gzFaceDown({ elitism: 7 });
  flipGz(g, g.id("foe"))();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, g.id("foe"));
  assert.equal(controllerOf(g.engine, g.id("gz")), P1);
});

clause(GOLEMIZER, "4:flipUp", "a flipped-up Golemizer is a working Golemizer: it slows its host at once (2 tokens: speed 3 becomes 1)", () => {
  const g = gzFaceDown({ elitism: 7 }, { mineTokens: 2 });
  assert.equal(speedOf(g, "mine"), 3, "face-down it slows nobody");
  flipGz(g, g.id("mine"))();
  resolvePendingResponses(g.engine);
  assert.equal(speedOf(g, "mine"), 1);
});

clause(GOLEMIZER, "4:flipUp", "it pays the FLIP UP cost of 4, not the printed cost of 1", () => {
  const g = gzFaceDown({ elitism: 8 });
  const before = ready(g.engine);
  assert.equal(before, 9, "eight [E] plus the face-down Golemizer");
  flipGz(g, g.id("mine"))();
  resolvePendingResponses(g.engine);
  const after = ready(g.engine);
  // The card stops being a resource (-1) and 4 resources are paid; the paid ones may include the card itself (CR 507.4b), so 4 or 5 remain.
  assert.ok(after === 4 || after === 5, `expected 4 or 5 resources left (4 paid), got ${after}`);
});

clause(GOLEMIZER, "4:flipUp", "the cost is exactly 4: three [E] plus the card itself (4 resources) is enough, two [E] and one other plus itself... is one short", () => {
  const enough = gzFaceDown({ elitism: 3 });
  assert.equal(ready(enough.engine), 4);
  flipGz(enough, enough.id("mine"))();
  resolvePendingResponses(enough.engine);
  assert.equal(isFaceDown(enough.engine, enough.id("gz")), false, "the card paid for its own FLIP UP (CR 507.4b)");
  const short = gzBoard({ gz: "faceDown", icons: { greed: 2 }, extra: spent("elitism", 3) });
  assert.equal(ready(short.engine), 3, "setup: three [E] are spent (they only meet the threshold), two Greed and the card are ready");
  refused(flipGz(short, short.id("mine")), "one resource short");
  assert.equal(isFaceDown(short.engine, short.id("gz")), true, "still face-down");
  assert.equal(ready(short.engine), 3, "nothing was paid");
  const exact = gzBoard({ gz: "faceDown", icons: { greed: 3 }, extra: spent("elitism", 3) });
  flipGz(exact, exact.id("mine"))();
  resolvePendingResponses(exact.engine);
  assert.equal(isFaceDown(exact.engine, exact.id("gz")), false, "control: one more ready resource is enough");
});

clause(GOLEMIZER, "4:flipUp", "FLIP UP needs [E][E][E]: two [E] among many other resources is refused, so is none, three are accepted", () => {
  const two = gzFaceDown({ elitism: 2, greed: 6 });
  refused(flipGz(two, two.id("mine")), "two [E]");
  assert.equal(isFaceDown(two.engine, two.id("gz")), true);
  assert.equal(ready(two.engine), 9, "nothing was paid");
  const none = gzFaceDown({ greed: 8 });
  refused(flipGz(none, none.id("mine")), "no [E]");
  const three = gzFaceDown({ elitism: 3, greed: 3 });
  flipGz(three, three.id("mine"))();
  resolvePendingResponses(three.engine);
  assert.equal(isFaceDown(three.engine, three.id("gz")), false, "control: three [E] are enough");
});

clause(GOLEMIZER, "4:flipUp", "the card's own Volition is not [E], and the opponent's [E] do not count", () => {
  const onlyVolition = gzFaceDown({ greed: 6 });
  refused(flipGz(onlyVolition, onlyVolition.id("mine")), "no [E] of my own");
  const theirs = gzBoard({ gz: "faceDown", icons: { elitism: 1, greed: 6 }, extra: res({ elitism: 8 }, P2) });
  refused(flipGz(theirs, theirs.id("mine")), "only one [E] of mine");
  assert.equal(isFaceDown(theirs.engine, theirs.id("gz")), true);
});

clause(GOLEMIZER, "4:flipUp", "spent [E] still meet the threshold while ready resources pay the 4", () => {
  const g = gzBoard({ gz: "faceDown", icons: { greed: 4 }, extra: spent("elitism", 3) });
  flipGz(g, g.id("mine"))();
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("gz")), false, "a spent [E] still meets the threshold (CR 405.6)");
});

clause(GOLEMIZER, "4:flipUp", "ATTACH TO still applies: the host must be a character - an item, a location, a faction and a face-down card are refused", () => {
  const g = gzFaceDown({ elitism: 7 });
  refused(flipGz(g, g.id("thing")), "an item");
  refused(flipGz(g, g.id("place")), "a location");
  refused(flipGz(g, g.engine.state.players[P2].factionId!), "a faction");
  refused(flipGz(g, g.id("fd")), "a face-down card");
  refused(flipGz(g, g.id("mh")), "a character in my hand");
  assert.equal(isFaceDown(g.engine, g.id("gz")), true, "still face-down after every refusal");
  assert.equal(ready(g.engine), 8, "nothing was paid by the refused attempts");
  flipGz(g, g.id("mine"))();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, g.id("mine"), "control: a character is accepted");
});

clause(GOLEMIZER, "4:flipUp", "exactly one host must be picked", () => {
  const g = gzFaceDown({ elitism: 7 });
  refused(flipGz(g, undefined), "no host");
  refused(() => flipUpRaw(g.engine, P1, g.id("gz"), { attachTo: [g.id("mine"), g.id("mine2")] }), "two hosts");
  assert.equal(isFaceDown(g.engine, g.id("gz")), true);
});

clause(GOLEMIZER, "4:flipUp", "with no character in play to attach to, FLIP UP cannot be done", () => {
  const { engine, id } = devBoard([{ key: "gz", def: printing(GOLEMIZER), owner: P1, zone: "play", faceDown: true }, ...res({ elitism: 6 })]);
  refused(() => flipUpRaw(engine, P1, id("gz"), {}), "no character to attach to");
  assert.equal(isFaceDown(engine, id("gz")), true);
  assert.equal(ready(engine), 7);
});

clause(GOLEMIZER, "4:flipUp", "FLIP UP of an item on the opponent's turn with no response window open is refused (an item is deployed on its controller's turn)", () => {
  const g = gzFaceDown({ elitism: 7 }, { turn: 2, active: P2 });
  refused(flipGz(g, g.id("foe")), "nothing to respond to");
  assert.equal(isFaceDown(g.engine, g.id("gz")), true);
  const mine = gzFaceDown({ elitism: 7 });
  flipGz(mine, mine.id("foe"))();
  resolvePendingResponses(mine.engine);
  assert.equal(isFaceDown(mine.engine, mine.id("gz")), false, "control: on my own turn it flips up");
});

clause(GOLEMIZER, "4:flipUp", "FLIP UP does not change WHEN an item can be deployed: not even in response during the opponent's attack (CR 507.4d)", () => {
  const g = gzFaceDown({ elitism: 7 }, { turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in their attack");
  refused(flipGz(g, g.id("foe")), "an item is not a tactic: FLIP UP does not let it be deployed in response (CR 507.4d)");
  assert.equal(isFaceDown(g.engine, g.id("gz")), true);
  assert.equal(ready(g.engine), 8, "nothing was paid");
});

clause(GOLEMIZER, "4:flipUp", "only its controller can flip it, and only while it is face-down in play (not face-up, not in hand)", () => {
  const theirs = gzFaceDown({ elitism: 7 });
  refused(flipGz(theirs, theirs.id("foe"), P2), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("gz")), true);
  const inHand = gzBoard({ gz: "hand", icons: { elitism: 7 } });
  refused(flipGz(inHand, inHand.id("mine")), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("gz")), "hand");
  const faceUp = gzBoard({ gz: "play", icons: { elitism: 7 } });
  refused(flipGz(faceUp, faceUp.id("foe")), "already face-up");
  assert.equal(faceUp.engine.state.cards[faceUp.id("gz")].attachedTo, faceUp.id("mine"), "it stays on its host");
});

clause(GOLEMIZER, "4:flipUp", "a face-down Golemizer that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = gzBoard({ gz: "faceDown", gzSpent: true, icons: { elitism: 6 } });
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, g.engine.state.players[P1].factionId, "setup: the face-down card was spent on my faction");
  flipGz(g, g.id("mine"))();
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("gz")), false, "flipped up");
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, g.id("mine"));
});

clause(GOLEMIZER, "4:flipUp", "a flipped-up card is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it enters play", () => {
  const g = gzFaceDown({ elitism: 7 });
  holdFlipUp(() => flipGz(g, g.id("mine"))());
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("gz")), "deploying", "the item is being deployed, it has not entered play yet");
});

// =================================================================================
// Goloam
// UNIQUE GOLOAM
// This card gains 1 strength and 1 life for each item in play.
// Character (golem), cost 4, [E][E][E][E], 3 strength / 3 speed / 3 life.
// =================================================================================

const GOLOAM = "372d7e22-04be-4a71-a2bc-a6cbd3bfd506";

/** A free tactic (id "steal", pick "t"): the caster takes control of the picked character. */
function stealTactic(name = "Steal"): CardDefinition {
  return tactic({
    name,
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
}

/** `n` plain items named "<prefix> i" for `owner` in play. */
const itemsFor = (prefix: string, n: number, owner: PlayerId): CardPlacement[] =>
  Array.from({ length: n }, (_, index) => ({ key: `${prefix}${index}`, def: item({ name: `${prefix} item ${index}` }), owner, zone: "play" as const }));

interface GoloamOpts {
  goloam?: "play" | "hand" | "faceDown";
  icons?: Icons;
  mineItems?: number;
  foeItems?: number;
  turn?: number;
  active?: PlayerId;
  owner?: PlayerId;
  damage?: number;
  extra?: CardPlacement[];
}

/** P1: goloam (key "go"), the items "mi0..", resources. P2: items "fi0..". Default: P1's turn 1 with [E][E][E][E]. */
function goloamBoard(o: GoloamOpts = {}) {
  const where = o.goloam ?? "play";
  const owner = o.owner ?? P1;
  return devBoard(
    [
      { key: "go", def: printing(GOLOAM), owner, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined, damage: o.damage },
      ...itemsFor("mi", o.mineItems ?? 0, P1),
      ...itemsFor("fi", o.foeItems ?? 0, P2),
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...res(o.icons ?? { elitism: 4 }),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type GoloamGame = ReturnType<typeof goloamBoard>;
const goStats = (g: GoloamGame, key = "go") => ({
  strength: g.engine.getStat(g.id(key), "strength"),
  speed: g.engine.getStat(g.id(key), "speed"),
  life: g.engine.getStat(g.id(key), "life")
});

// --- 0:unique  UNIQUE GOLOAM -----------------------------------------------------------

function goloamPair() {
  return goloamBoard({ extra: [{ key: "go2", def: printing(GOLOAM), owner: P1, zone: "hand" }, { key: "other", def: character({ name: "Bystander" }), owner: P1, zone: "play" }] });
}

for (const keep of ["go", "go2"] as const) {
  clause(GOLOAM, "0:unique", `a second copy: its controller is asked which to keep (keeping ${keep === "go" ? "the old" : "the new"} one) and the other is destroyed`, () => {
    const { engine, id } = goloamPair();
    play(engine, P1, id("go2"));
    const pc = expectPending(engine, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "its controller chooses");
    assert.deepEqual([...(pc.candidates as string[])].sort(), [id("go"), id("go2")].sort());
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    const lost = keep === "go" ? "go2" : "go";
    assert.equal(zoneOf(engine, id(keep)), "play", "the kept copy stays");
    assert.equal(zoneOf(engine, id(lost)), "discard", "the other copy is destroyed");
    assert.equal(engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(engine, id("other")), "play", "no other card is affected");
  });
}

clause(GOLOAM, "0:unique", "after I choose which copy to keep (a second copy deployed from my hand), the game goes on: the response window closes", () => {
  const { engine, id } = goloamPair();
  play(engine, P1, id("go2"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("go") } } as never);
  resolvePendingResponses(engine); // throws "did not converge" when the game is soft-locked
  assert.equal(engine.state.responseWindow, undefined, "the game is not stuck");
});

clause(GOLOAM, "0:unique", "the 'keep' answer must name one of the copies", () => {
  const { engine, id } = goloamPair();
  play(engine, P1, id("go2"));
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("other") } } as never), "keeping a bystander");
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.ok(pending(engine), "still waiting for a real answer");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("go") } } as never);
  assert.equal(zoneOf(engine, id("go")), "play", "control: a real copy is accepted");
});

clause(GOLOAM, "0:unique", "UNIQUE is per player: my opponent may control their own Goloam with no choice and no destruction", () => {
  const { engine, id } = devBoard(
    [
      { key: "go", def: printing(GOLOAM), owner: P1, zone: "play" },
      { key: "go2", def: printing(GOLOAM), owner: P2, zone: "hand" },
      ...res({ elitism: 4 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(engine, P2, id("go2"));
  assert.equal(engine.state.pendingChoice, undefined, "no 'keep one' choice");
  assert.equal(zoneOf(engine, id("go")), "play");
  assert.equal(zoneOf(engine, id("go2")), "play");
});

clause(GOLOAM, "0:unique", "a second copy in my hand or my discard pile is no conflict (only cards I control in play count)", () => {
  const { engine, id } = devBoard([
    { key: "go", def: printing(GOLOAM), owner: P1, zone: "play" },
    { key: "inHand", def: printing(GOLOAM), owner: P1, zone: "hand" },
    { key: "inDisc", def: printing(GOLOAM), owner: P1, zone: "discard" },
    { key: "inDeck", def: printing(GOLOAM), owner: P1, zone: "deck" }
  ]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("go")), "play");
  assert.equal(zoneOf(engine, id("inHand")), "hand");
  assert.equal(zoneOf(engine, id("inDisc")), "discard");
});

clause(GOLOAM, "0:unique", "after the first copy is destroyed a new one can be played with no conflict", () => {
  const { engine, id } = devBoard([
    { key: "go", def: printing(GOLOAM), owner: P1, zone: "discard" },
    { key: "go2", def: printing(GOLOAM), owner: P1, zone: "hand" },
    ...res({ elitism: 4 })
  ]);
  play(engine, P1, id("go2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("go2")), "play");
});

clause(GOLOAM, "0:unique", "a different Unique card is not a conflict: only the same designation GOLOAM counts", () => {
  const { engine, id } = devBoard([
    { key: "go", def: printing(GOLOAM), owner: P1, zone: "play" },
    { key: "uniq", def: character({ name: "Someone Else", unique: "someone else" }), owner: P1, zone: "play" },
    { key: "uniq2", def: character({ name: "Someone Else 2", unique: "someone else" }), owner: P1, zone: "play" }
  ]);
  assert.equal(engine.state.pendingChoice, undefined, "two cards of another designation: that is that designation's own business");
  assert.equal(zoneOf(engine, id("go")), "play");
});

clause(GOLOAM, "0:unique", "taking control of my opponent's Goloam while I control one makes me choose which to keep (FAQ: the controller chooses), and the game goes on", () => {
  const { engine, id } = devBoard([
    { key: "go", def: printing(GOLOAM), owner: P1, zone: "play" },
    { key: "foeGo", def: printing(GOLOAM), owner: P2, zone: "play" },
    { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("steal"), { selected: { t: [id("foeGo")] } });
  const pc = expectPending(engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("go") } } as never);
  assert.equal(zoneOf(engine, id("go")), "play");
  assert.equal(zoneOf(engine, id("foeGo")), "discard", "the extra copy is destroyed (to its owner's discard pile)");
  assert.equal(engine.state.pendingChoice, undefined);
  resolvePendingResponses(engine); // throws "did not converge" when the game is soft-locked
  assert.equal(engine.state.responseWindow, undefined, "the game is not stuck");
  assert.equal(zoneOf(engine, id("steal")), "discard", "the stealing tactic finished resolving");
});

clause(GOLOAM, "0:unique", "a face-down Goloam is only a resource (CR 411.1): it does not conflict with a face-up one", () => {
  const { engine, id } = devBoard([
    { key: "go", def: printing(GOLOAM), owner: P1, zone: "play" },
    { key: "goFd", def: printing(GOLOAM), owner: P1, zone: "play", faceDown: true }
  ]);
  endTurn(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("go")), "play");
  assert.equal(zoneOf(engine, id("goFd")), "play");
});

// --- 1:rule  This card gains 1 strength and 1 life for each item in play. -----------------

clause(GOLOAM, "1:rule", "with no item in play it has its printed 3 strength / 3 speed / 3 life", () => {
  const g = goloamBoard();
  assert.deepEqual(goStats(g), { strength: 3, speed: 3, life: 3 });
});

clause(GOLOAM, "1:rule", "one item in play: 4 strength and 4 life, speed unchanged", () => {
  const g = goloamBoard({ mineItems: 1 });
  assert.deepEqual(goStats(g), { strength: 4, speed: 3, life: 4 });
});

clause(GOLOAM, "1:rule", "three items in play: 6 strength and 6 life", () => {
  const g = goloamBoard({ mineItems: 3 });
  assert.deepEqual(goStats(g), { strength: 6, speed: 3, life: 6 });
});

clause(GOLOAM, "1:rule", "'in play' covers every player's items: my opponent's items count too (2 mine + 3 theirs = +5)", () => {
  const g = goloamBoard({ mineItems: 2, foeItems: 3 });
  assert.deepEqual(goStats(g), { strength: 8, speed: 3, life: 8 });
});

clause(GOLOAM, "1:rule", "only their items: 4 of the opponent's items alone give +4/+4", () => {
  const g = goloamBoard({ foeItems: 4 });
  assert.deepEqual(goStats(g), { strength: 7, speed: 3, life: 7 });
});

clause(GOLOAM, "1:rule", "only ITEMS count: characters, locations, resources and the factions add nothing", () => {
  const g = goloamBoard({
    mineItems: 1,
    extra: [
      { key: "loc", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "loc2", def: location({ name: "Place Two" }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...res({ greed: 2 }),
      ...res({ greed: 2 }, P2)
    ]
  });
  assert.deepEqual(goStats(g), { strength: 4, speed: 3, life: 4 }, "only the single item counts");
});

clause(GOLOAM, "1:rule", "items outside play do not count: hand, deck and discard pile items add nothing", () => {
  const g = goloamBoard({
    extra: [
      { key: "ih", def: item({ name: "Hand Item" }), owner: P1, zone: "hand" },
      { key: "id", def: item({ name: "Deck Item" }), owner: P1, zone: "deck" },
      { key: "ix", def: item({ name: "Discarded Item" }), owner: P1, zone: "discard" },
      { key: "oh", def: item({ name: "Their Hand Item" }), owner: P2, zone: "hand" },
      { key: "ox", def: item({ name: "Their Discarded Item" }), owner: P2, zone: "discard" }
    ]
  });
  assert.deepEqual(goStats(g), { strength: 3, speed: 3, life: 3 });
});

clause(GOLOAM, "1:rule", "a face-down card is only a resource (CR 411.1), not an item: a face-down item card adds nothing", () => {
  const g = goloamBoard({ mineItems: 1, extra: [{ key: "fdItem", def: item({ name: "Hidden Item" }), owner: P2, zone: "play", faceDown: true }] });
  assert.deepEqual(goStats(g), { strength: 4, speed: 3, life: 4 });
});

clause(GOLOAM, "1:rule", "an item attached to a character (gear) is an item in play and counts", () => {
  const g = goloamBoard({
    extra: [{ key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P2, zone: "play", attachedToKey: "foe" }]
  });
  assert.deepEqual(goStats(g), { strength: 4, speed: 3, life: 4 });
});

clause(GOLOAM, "1:rule", "an item counts once however many tokens it has", () => {
  const g = goloamBoard({ extra: [{ key: "ti", def: item({ name: "Token Item" }), owner: P1, zone: "play", counters: { token: 5 } }] });
  assert.deepEqual(goStats(g), { strength: 4, speed: 3, life: 4 });
});

clause(GOLOAM, "1:rule", "it is live: an item entering play raises it at once, an item leaving play lowers it again", () => {
  const g = goloamBoard({ mineItems: 1, extra: [{ key: "newItem", def: item({ name: "New Item", cost: 0 }), owner: P1, zone: "hand" }, { key: "kill", def: itemKillerTactic(), owner: P1, zone: "hand" }] });
  assert.equal(goStats(g).strength, 4);
  play(g.engine, P1, g.id("newItem"));
  assert.deepEqual(goStats(g), { strength: 5, speed: 3, life: 5 });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("mi0")] } });
  assert.equal(zoneOf(g.engine, g.id("mi0")), "discard");
  assert.deepEqual(goStats(g), { strength: 4, speed: 3, life: 4 });
});

clause(GOLOAM, "1:rule", "an item that stops being an item (flipped face-down) stops counting", () => {
  const flipItem = tactic({
    name: "Item Flipper",
    cost: 0,
    behavior: { abilities: [{ id: "fi", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }] }
  });
  const g = goloamBoard({ mineItems: 2, extra: [{ key: "flip", def: flipItem, owner: P1, zone: "hand" }] });
  assert.equal(goStats(g).strength, 5);
  play(g.engine, P1, g.id("flip"), { selected: { t: [g.id("mi0")] } });
  assert.equal(isFaceDown(g.engine, g.id("mi0")), true);
  assert.deepEqual(goStats(g), { strength: 4, speed: 3, life: 4 });
});

clause(GOLOAM, "1:rule", "the bonus is life too: a Goloam with 4 damage survives while 2 items make its life 5, and is destroyed the moment an item goes (life 4)", () => {
  const g = goloamBoard({
    mineItems: 2,
    damage: 4,
    extra: [{ key: "kill", def: itemKillerTactic(), owner: P1, zone: "hand" }, { key: "pump", def: pumpTactic(1), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("pump"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("go")), "play", "life 5: 4 damage is not lethal");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("mi0")] } });
  assert.equal(zoneOf(g.engine, g.id("mi0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("go")), "discard", "life 4 with 4 damage: destroyed");
});

clause(GOLOAM, "1:rule", "only this card gets the bonus: another character does not, and each Goloam counts its own", () => {
  const g = goloamBoard({ mineItems: 2, extra: [{ key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" }, { key: "foeGo", def: printing(GOLOAM), owner: P2, zone: "play" }] });
  assert.deepEqual(goStats(g, "ally"), { strength: 2, speed: 2, life: 2 }, "an ordinary character is untouched");
  assert.deepEqual(goStats(g, "go"), { strength: 5, speed: 3, life: 5 });
  assert.deepEqual(goStats(g, "foeGo"), { strength: 5, speed: 3, life: 5 }, "the opponent's Goloam counts the same items in play");
});

clause(GOLOAM, "1:rule", "a Goloam deployed from my hand counts the items in play as soon as it enters", () => {
  const g = goloamBoard({ goloam: "hand", mineItems: 2 });
  play(g.engine, P1, g.id("go"));
  assert.equal(zoneOf(g.engine, g.id("go")), "play");
  assert.deepEqual(goStats(g), { strength: 5, speed: 3, life: 5 });
});

clause(GOLOAM, "1:rule", "a face-down Goloam is only a resource with no rules text: it gets no bonus", () => {
  const g = goloamBoard({ goloam: "faceDown", mineItems: 2 });
  assert.equal(g.engine.isResource(g.id("go")), true);
  assert.ok(g.engine.getStat(g.id("go"), "strength") <= 3, "no +1/+1 per item while face-down");
});

clause(GOLOAM, "1:rule", "the bonus is real in battle: with 2 items my Goloam hits the faction for 5", () => {
  const g = goloamBoard({ mineItems: 2, turn: 1, active: P1 });
  const before = influenceOf(g.engine, P2);
  fight(g.engine, P1, [g.id("go")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influenceOf(g.engine, P2), 5);
});

clause(GOLOAM, "1:rule", "the extra life is real in battle: blocking a 4-strength attacker, a Goloam with 2 items (life 5) survives, with no items (life 3) it is destroyed", () => {
  const board = (items: number) =>
    goloamBoard({
      mineItems: items,
      turn: 2,
      active: P2,
      extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 1 }), owner: P2, zone: "play" }]
    });
  const buffed = board(2);
  fight(buffed.engine, P2, [buffed.id("atk")], { type: "faction", playerId: P1 }, [buffed.id("go")]);
  assert.equal(zoneOf(buffed.engine, buffed.id("go")), "play", "life 5 takes 4 damage");
  assert.equal(buffed.engine.state.cards[buffed.id("go")].damage, 4);
  const plain = board(0);
  fight(plain.engine, P2, [plain.id("atk")], { type: "faction", playerId: P1 }, [plain.id("go")]);
  assert.equal(zoneOf(plain.engine, plain.id("go")), "discard", "control: life 3 takes 4 damage");
});

clause(GOLOAM, "1:rule", "deploys for its printed cost of 4 with [E][E][E][E]: refused one short and without the [E]", () => {
  const exact = goloamBoard({ goloam: "hand", icons: { elitism: 4 } });
  play(exact.engine, P1, exact.id("go"));
  assert.equal(zoneOf(exact.engine, exact.id("go")), "play");
  assert.equal(ready(exact.engine), 0, "cost 4 paid");
  const threeE = goloamBoard({ goloam: "hand", icons: { elitism: 3, greed: 3 } });
  refused(() => playRaw(threeE.engine, P1, threeE.id("go")), "three [E] is not [E][E][E][E]", /Threshold requirements are not met/);
  // [E][E][E][E] met by already-spent Elitism, so only the cost (3 ready of 4) can refuse
  const short = goloamBoard({ goloam: "hand", icons: { greed: 3 }, extra: spent("elitism", 4) });
  refused(() => playRaw(short.engine, P1, short.id("go")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("go")), "hand");
});

// =================================================================================
// Lab of Luxury
// INNOVATE -- COST: Pay 1. Discard a card.
//   -- EFFECT: If the discarded card is a resource, search your deck for a location. If it is a location,
//      search your deck for a character. If it is a character, search your deck for a tactic. If it is a
//      tactic, search your deck for an item. If it is an item, search your deck for a resource. Reveal the
//      card you searched for and put it into your hand.
// Location, cost 3, [E][E], structure 4.
// =================================================================================

const LAB = "194bea41-c877-4b84-a14d-80b8caba8cb8";

type LabType = "res" | "loc" | "char" | "tac" | "item";
const LAB_TYPES: LabType[] = ["res", "loc", "char", "tac", "item"];
/** discarded type -> the type INNOVATE searches for */
const LAB_NEXT: Record<LabType, LabType> = { res: "loc", loc: "char", char: "tac", tac: "item", item: "res" };
const LAB_NAME: Record<LabType, string> = { res: "resource", loc: "location", char: "character", tac: "tactic", item: "item" };

function labDef(type: LabType, name: string): CardDefinition {
  switch (type) {
    case "res":
      return resourceCard({ name });
    case "loc":
      return location({ name });
    case "char":
      return character({ name });
    case "tac":
      return tactic({ name });
    default:
      return item({ name });
  }
}

interface LabOpts {
  lab?: "play" | "hand" | "discard" | "faceDown";
  icons?: Icons;
  noHand?: boolean;
  noDeck?: LabType[];
  turn?: number;
  active?: PlayerId;
  random?: () => number;
  extra?: CardPlacement[];
}

/**
 * P1: the Lab (key "lab"), a hand of one card of every type (h<type>), a deck of two cards of every type (d<type>0, d<type>1),
 * resources (default 3 [E]). P2: a deck with one card of every type (o<type>) and a hand card (oh).
 */
function labBoard(o: LabOpts = {}) {
  const hand: CardPlacement[] = o.noHand ? [] : LAB_TYPES.map((t) => ({ key: `h${t}`, def: labDef(t, `Hand ${LAB_NAME[t]}`), owner: P1, zone: "hand" as const }));
  const deck: CardPlacement[] = LAB_TYPES.filter((t) => !(o.noDeck ?? []).includes(t)).flatMap((t) =>
    [0, 1].map((n) => ({ key: `d${t}${n}`, def: labDef(t, `Deck ${LAB_NAME[t]} ${n}`), owner: P1, zone: "deck" as const }))
  );
  const oppDeck: CardPlacement[] = LAB_TYPES.map((t) => ({ key: `o${t}`, def: labDef(t, `Their ${LAB_NAME[t]}`), owner: P2, zone: "deck" as const }));
  const where = o.lab ?? "play";
  return devBoard(
    [
      { key: "lab", def: printing(LAB), owner: P1, zone: where === "hand" ? "hand" : where === "discard" ? "discard" : "play", faceDown: where === "faceDown" ? true : undefined },
      ...hand,
      ...deck,
      ...oppDeck,
      { key: "oh", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" },
      ...res(o.icons ?? { elitism: 3 }),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active, random: o.random }
  );
}

type LabGame = ReturnType<typeof labBoard>;

/** A fixed pseudo-random stream (deterministic shuffles). */
function lcg(seed = 12345): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Uses INNOVATE discarding `discardKey`, then answers the search with `pickKey` (or none). Returns after the search is answered. */
function innovate(g: LabGame, discardKey: string, pickKey?: string): void {
  activate(g.engine, P1, g.id("lab"), "innovate", { selected: { pitched: [g.id(discardKey)] } });
  if (pending(g.engine)) {
    assert.equal(pending(g.engine)!.playerId, P1, "the search is mine: I pick the card");
    answerPending(g.engine, "chooserSelectsTarget", { selected: pickKey ? [g.id(pickKey)] : [] });
  }
}

const innovateAttempt = (g: LabGame, discard: CardInstanceId[] | undefined, player: PlayerId = P1) => () =>
  actRaw(g.engine, player, g.id("lab"), "innovate", discard ? { pitched: discard } : {});

const labRevealed = (g: LabGame): string[] =>
  g.engine.getLog().flatMap((entry) => (entry.event?.type === "cardsRevealed" ? ((entry.event as { cardIds: string[] }).cardIds as string[]) : []));

// --- the five branches -------------------------------------------------------------------

function branchTest(t: LabType): void {
  const target = LAB_NEXT[t];
  clause(LAB, "0:ability:innovate", `discarding a ${LAB_NAME[t]}: I search my deck for a ${LAB_NAME[target]}, reveal it and put it into my hand`, () => {
    const g = labBoard();
    const handBefore = handOf(g.engine, P1).length;
    innovate(g, `h${t}`, `d${target}0`);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id(`d${target}0`)), "hand", `the ${LAB_NAME[target]} is in my hand`);
    assert.equal(zoneOf(g.engine, g.id(`h${t}`)), "discard", "the discarded card is in my discard pile");
    assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 1, "one card left my hand, one joined it");
    assert.equal(zoneOf(g.engine, g.id(`d${target}1`)), "deck", "only ONE card is fetched");
    assert.deepEqual(labRevealed(g), [g.id(`d${target}0`)], "the card I searched for is revealed");
    assert.equal(zoneOf(g.engine, g.id("lab")), "play", "the Lab stays in play");
  });

  clause(LAB, "0:ability:innovate", `discarding a ${LAB_NAME[t]}: only ${LAB_NAME[target]} cards can be picked - any other type is refused (and the second ${LAB_NAME[target]} works as well)`, () => {
    const g = labBoard();
    activate(g.engine, P1, g.id("lab"), "innovate", { selected: { pitched: [g.id(`h${t}`)] } });
    expectPending(g.engine, "chooserSelectsTarget");
    for (const other of LAB_TYPES.filter((x) => x !== target)) {
      refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(`d${other}0`)] }), `a ${LAB_NAME[other]} is not a ${LAB_NAME[target]}`);
      assert.ok(pending(g.engine), "the search is still open");
    }
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(`d${target}1`)] });
    assert.equal(zoneOf(g.engine, g.id(`d${target}1`)), "hand", "control: a card of the right type is accepted");
    for (const other of LAB_TYPES.filter((x) => x !== target)) assert.equal(zoneOf(g.engine, g.id(`d${other}0`)), "deck", `${LAB_NAME[other]} untouched`);
  });

  clause(LAB, "0:ability:innovate", `discarding a ${LAB_NAME[t]}: the search may fail - picking nothing puts no card into my hand`, () => {
    const g = labBoard();
    const handBefore = handOf(g.engine, P1).length;
    innovate(g, `h${t}`);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(handOf(g.engine, P1).length, handBefore - 1, "only the discard changed my hand");
    assert.equal(zoneOf(g.engine, g.id(`h${t}`)), "discard");
    assert.equal(zoneOf(g.engine, g.id(`d${target}0`)), "deck");
    assert.equal(zoneOf(g.engine, g.id(`d${target}1`)), "deck");
  });

  clause(LAB, "0:ability:innovate", `discarding a ${LAB_NAME[t]} with no ${LAB_NAME[target]} in my deck: nothing is found, the cost is still paid, and nothing breaks`, () => {
    const g = labBoard({ noDeck: [target] });
    const readyBefore = ready(g.engine);
    const handBefore = handOf(g.engine, P1).length;
    innovate(g, `h${t}`);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(readyBefore - ready(g.engine), 1);
    assert.equal(handOf(g.engine, P1).length, handBefore - 1);
    assert.equal(zoneOf(g.engine, g.id(`h${t}`)), "discard");
  });

  clause(LAB, "0:ability:innovate", `discarding a ${LAB_NAME[t]}: only MY deck is searched - a ${LAB_NAME[target]} in my opponent's deck cannot be picked`, () => {
    const g = labBoard();
    activate(g.engine, P1, g.id("lab"), "innovate", { selected: { pitched: [g.id(`h${t}`)] } });
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(`o${target}`)] }), "their deck");
    assert.equal(zoneOf(g.engine, g.id(`o${target}`)), "deck");
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(`d${target}0`)] });
    assert.equal(zoneOf(g.engine, g.id(`d${target}0`)), "hand", "control: my own deck works");
  });
}
for (const t of LAB_TYPES) branchTest(t);

clause(LAB, "0:ability:innovate", "the search never picks from anywhere but the deck: cards of the right type in my hand, discard pile or in play cannot be picked", () => {
  const g = labBoard({
    extra: [
      { key: "xloc", def: location({ name: "Discarded Location" }), owner: P1, zone: "discard" },
      { key: "ploc", def: location({ name: "Location In Play" }), owner: P1, zone: "play" },
      { key: "hloc2", def: location({ name: "Another Hand Location" }), owner: P1, zone: "hand" }
    ]
  });
  activate(g.engine, P1, g.id("lab"), "innovate", { selected: { pitched: [g.id("hres")] } });
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("xloc")] }), "my discard pile");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ploc")] }), "in play");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hloc2")] }), "my hand");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("dloc0")] });
  assert.equal(zoneOf(g.engine, g.id("dloc0")), "hand", "control");
});

clause(LAB, "0:ability:innovate", "only one card is put into my hand: a pick of two cards is refused", () => {
  const g = labBoard();
  activate(g.engine, P1, g.id("lab"), "innovate", { selected: { pitched: [g.id("hres")] } });
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("dloc0"), g.id("dloc1")] }), "two cards");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("dloc0")] });
  assert.equal(zoneOf(g.engine, g.id("dloc1")), "deck");
});

clause(LAB, "0:ability:innovate", "the deck is shuffled after the search (CR 312.1): with a fixed random stream the remaining cards are no longer in their old order", () => {
  const g = labBoard({ random: lcg() });
  const before = deckOf(g.engine, P1);
  innovate(g, "hres", "dloc0");
  const after = deckOf(g.engine, P1);
  const expectedWithout = before.filter((cardId) => cardId !== g.id("dloc0"));
  assert.equal(after.length, expectedWithout.length);
  assert.deepEqual([...after].sort(), [...expectedWithout].sort(), "the same cards, minus the one fetched");
  assert.notDeepEqual(after, expectedWithout, "shuffled");
});

clause(LAB, "0:ability:innovate", "the deck is shuffled even when I decline to fetch anything", () => {
  const g = labBoard({ random: lcg() });
  const before = deckOf(g.engine, P1);
  innovate(g, "hres");
  const after = deckOf(g.engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "a searched deck is shuffled");
});

clause(LAB, "0:ability:innovate", "my opponent's deck is not touched: same cards in the same order", () => {
  const g = labBoard({ random: lcg() });
  const before = deckOf(g.engine, P2);
  innovate(g, "hres", "dloc0");
  assert.deepEqual(deckOf(g.engine, P2), before);
});

// --- the cost: Pay 1. Discard a card. ------------------------------------------------------

clause(LAB, "0:ability:innovate", "the cost pays exactly 1 resource", () => {
  const g = labBoard({ icons: { elitism: 3 } });
  const before = ready(g.engine);
  innovate(g, "hres", "dloc0");
  assert.equal(before - ready(g.engine), 1);
});

clause(LAB, "0:ability:innovate", "any resource pays the 1: Greed works as well as [E]", () => {
  const g = labBoard({ icons: { greed: 1 } });
  innovate(g, "hres", "dloc0");
  assert.equal(zoneOf(g.engine, g.id("dloc0")), "hand");
  assert.equal(ready(g.engine), 0);
});

clause(LAB, "0:ability:innovate", "with no ready resource it cannot be used, and nothing is discarded", () => {
  const g = labBoard({ icons: {} });
  refused(innovateAttempt(g, [g.id("hres")]), "nothing to pay with");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
  const spentOnly = labBoard({ icons: {}, extra: spent("elitism", 3) });
  refused(innovateAttempt(spentOnly, [spentOnly.id("hres")]), "all resources are already spent");
  assert.equal(zoneOf(spentOnly.engine, spentOnly.id("hres")), "hand");
  const one = labBoard({ icons: { elitism: 1 } });
  innovate(one, "hres", "dloc0");
  assert.equal(zoneOf(one.engine, one.id("hres")), "discard", "control: one ready resource is enough");
});

clause(LAB, "0:ability:innovate", "the discard is a cost: with no card in my hand it cannot be used, and no resource is paid", () => {
  const g = labBoard({ noHand: true });
  const before = ready(g.engine);
  refused(innovateAttempt(g, undefined), "no card to discard");
  refused(innovateAttempt(g, []), "empty pick");
  assert.equal(ready(g.engine), before, "nothing was paid");
});

clause(LAB, "0:ability:innovate", "exactly one card is discarded: two are refused", () => {
  const g = labBoard();
  const before = ready(g.engine);
  refused(innovateAttempt(g, [g.id("hres"), g.id("hloc")]), "two cards");
  assert.equal(ready(g.engine), before);
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
  assert.equal(zoneOf(g.engine, g.id("hloc")), "hand");
});

clause(LAB, "0:ability:innovate", "the discarded card must come from my hand: cards in play, my discard pile, my deck and my opponent's hand are refused", () => {
  const g = labBoard({ extra: [{ key: "pc", def: character({ name: "In Play" }), owner: P1, zone: "play" }, { key: "dc", def: character({ name: "In Discard" }), owner: P1, zone: "discard" }] });
  refused(innovateAttempt(g, [g.id("pc")]), "a character in play");
  refused(innovateAttempt(g, [g.id("dc")]), "my discard pile");
  refused(innovateAttempt(g, [g.id("dres0")]), "my deck");
  refused(innovateAttempt(g, [g.id("oh")]), "my opponent's hand");
  assert.equal(ready(g.engine), 3, "nothing was paid");
  innovate(g, "hchar", "dtac0");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "discard", "control: a hand card works");
});

clause(LAB, "0:ability:innovate", "the discarded card goes to its owner's discard pile, the cost is paid before my opponent can respond", () => {
  const g = labBoard();
  const before = ready(g.engine);
  actRaw(g.engine, P1, g.id("lab"), "innovate", { pitched: [g.id("hloc")] });
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("hloc")), "discard", "the cost was paid when I used it");
  assert.equal(before - ready(g.engine), 1);
  assert.equal(zoneOf(g.engine, g.id("dchar0")), "deck", "the effect has not happened yet");
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("dchar0")] });
  assert.equal(zoneOf(g.engine, g.id("dchar0")), "hand");
});

clause(LAB, "0:ability:innovate", "it can be used again the same turn with another card: there is no depletion", () => {
  const g = labBoard();
  innovate(g, "hres", "dloc0");
  innovate(g, "hloc", "dchar0");
  assert.equal(zoneOf(g.engine, g.id("dloc0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("dchar0")), "hand");
  assert.equal(ready(g.engine), 1, "paid 1 twice");
});

clause(LAB, "0:ability:innovate", "a card fetched by INNOVATE can itself be discarded to INNOVATE again (a chain: resource > location > character)", () => {
  const g = labBoard();
  innovate(g, "hres", "dloc0");
  innovate(g, "dloc0", "dchar0");
  assert.equal(zoneOf(g.engine, g.id("dloc0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("dchar0")), "hand");
});

// --- who and when ----------------------------------------------------------------------------

clause(LAB, "0:ability:innovate", "only its controller can use it: my opponent cannot (control: I can)", () => {
  const g = labBoard({ turn: 1, active: P1, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(innovateAttempt(g, [g.id("oh")], P2), "the Lab is mine", /control|owner|yours|your/i);
  assert.equal(zoneOf(g.engine, g.id("oh")), "hand");
});

clause(LAB, "0:ability:innovate", "an ability: it can be used in response on my opponent's turn", () => {
  const g = labBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker" }), owner: P2, zone: "play" }, ...res({ elitism: 0 })] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("lab"), "innovate", { pitched: [g.id("hres")] });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("dloc0")] });
  assert.equal(zoneOf(g.engine, g.id("dloc0")), "hand");
});

clause(LAB, "0:ability:innovate", "it works from play only: refused while the Lab is in my hand or my discard pile", () => {
  for (const lab of ["hand", "discard"] as const) {
    const g = labBoard({ lab });
    refused(innovateAttempt(g, [g.id("hres")]), `the Lab is in my ${lab}`, /Activated ability not found|not in play|play/i);
    assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
  }
});

clause(LAB, "0:ability:innovate", "a face-down Lab is only a resource with no rules text: INNOVATE cannot be used", () => {
  const g = labBoard({ lab: "faceDown" });
  refused(innovateAttempt(g, [g.id("hres")]), "face-down", /Activated ability not found|face-down|rules text/i);
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
});

clause(LAB, "0:ability:innovate", "a Lab I took from my opponent is mine to use: it searches MY deck and puts the card into MY hand", () => {
  const stolen = devBoard([
    { key: "lab", def: printing(LAB), owner: P2, controller: P1, zone: "play" },
    { key: "hres", def: resourceCard({ name: "Hand Resource" }), owner: P1, zone: "hand" },
    { key: "dloc", def: location({ name: "My Deck Location" }), owner: P1, zone: "deck" },
    { key: "oloc", def: location({ name: "Their Deck Location" }), owner: P2, zone: "deck" },
    ...res({ elitism: 2 })
  ]);
  activate(stolen.engine, P1, stolen.id("lab"), "innovate", { selected: { pitched: [stolen.id("hres")] } });
  refused(() => answerPending(stolen.engine, "chooserSelectsTarget", { selected: [stolen.id("oloc")] }), "their deck");
  answerPending(stolen.engine, "chooserSelectsTarget", { selected: [stolen.id("dloc")] });
  assert.equal(zoneOf(stolen.engine, stolen.id("dloc")), "hand");
});

// =================================================================================
// Recyclable Golem
// If you played this card using FLIP UP, it enters play with a token on it.
// While there is a token on this card, it loses 2 strength and 2 life and can block COVERT parties.
// If there are no tokens on this card and it's destroyed, flip it face-down under its owner's control instead.
// FLIP UP: 4 [E]
// Character (golem), cost 6, [E], 6 strength / 3 speed / 6 life.
// =================================================================================

const RECYCLABLE = "778e9579-eb05-4391-9d2c-2851f79b635d";

/** A free tactic (id "untoken", pick "t"): removes every token from the picked card in play. */
function tokenRemover(name = "Token Remover"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "untoken",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 99 }]
        }
      ]
    }
  });
}

/** A free tactic (id "put", pick "t"): puts one character card from the caster's hand into play (it is not deployed). */
function putterTactic(name = "Putter"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", controller: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

/** A character whose ability (id "sac", pick "v") destroys one picked character as its COST, then draws a card. */
function sacrificerChar(name = "Character Sacrificer"): CardDefinition {
  return character({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sac",
          type: "activated",
          targets: [{ id: "v", selector: { zone: "play", type: "character" }, count: 1 }],
          costs: [{ type: "destroy", target: { type: "selected", id: "v" } }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
}

interface RgOpts {
  rg?: "hand" | "play" | "faceDown";
  tokens?: number;
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  rgOwner?: PlayerId;
  rgController?: PlayerId;
  rgSpent?: boolean;
  damage?: number;
  second?: boolean;
  extra?: CardPlacement[];
}

/**
 * P1: rg (the Recyclable Golem), ally (character), mh (character in hand). P2: foe (character), thing (item), fd (face-down character).
 * Default P1's turn 1, [E] x6.
 */
function rgBoard(o: RgOpts = {}) {
  const where = o.rg ?? "play";
  return devBoard(
    [
      {
        key: "rg",
        def: printing(RECYCLABLE),
        owner: o.rgOwner ?? P1,
        controller: o.rgController,
        zone: where === "hand" ? "hand" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        counters: o.tokens ? { token: o.tokens } : undefined,
        damage: o.damage,
        attachedToKey: where === "faceDown" && o.rgSpent ? "__factionA" : undefined
      },
      ...(o.second ? [{ key: "rg2", def: printing(RECYCLABLE), owner: P1, zone: "play" as const }] : []),
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden", life: 9 }), owner: P2, zone: "play", faceDown: true },
      ...res(o.icons ?? { elitism: 6 }),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type RgGame = ReturnType<typeof rgBoard>;
const rgStats = (g: RgGame, key = "rg") => ({
  strength: g.engine.getStat(g.id(key), "strength"),
  speed: g.engine.getStat(g.id(key), "speed"),
  life: g.engine.getStat(g.id(key), "life")
});
const flipRg = (g: RgGame, player: PlayerId = P1, key = "rg") => () => flipUpRaw(g.engine, player, g.id(key), {});
const flipRgNow = (g: RgGame) => {
  flipUpRaw(g.engine, P1, g.id("rg"), {});
  resolvePendingResponses(g.engine);
};
const killChar = (g: RgGame, targetKey: string, player: PlayerId = P1) => {
  playRaw(g.engine, player, g.id("kill"), { selected: { t: [g.id(targetKey)] } });
  resolvePendingResponses(g.engine);
};
const rgWithKiller = (o: RgOpts = {}) => rgBoard({ ...o, extra: [...(o.extra ?? []), { key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });

// --- 3:flipUp  FLIP UP: 4 [E] ---------------------------------------------------------------

clause(RECYCLABLE, "3:flipUp", "face-down in play it is a resource: one Volition, in the resource pool, with no rules text", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 2 } });
  assert.equal(g.engine.isResource(g.id("rg")), true);
  assert.deepEqual(g.engine.getCardTypes(g.id("rg")), ["resource"]);
  assert.equal(ready(g.engine), 3, "two [E] plus the face-down Golem");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(RECYCLABLE, "3:flipUp", "flipping it up puts the character into play face-up under my control, ready, as a real character", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 6 } });
  flipRgNow(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("rg")), "play");
  assert.equal(isFaceDown(g.engine, g.id("rg")), false);
  assert.deepEqual(g.engine.getCardTypes(g.id("rg")), ["character"]);
  assert.equal(g.engine.isResource(g.id("rg")), false);
  assert.equal(isDepleted(g.engine, g.id("rg")), false);
  assert.equal(controllerOf(g.engine, g.id("rg")), P1);
});

clause(RECYCLABLE, "3:flipUp", "it pays the FLIP UP cost of 4, not the printed cost of 6", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 8 } });
  const before = ready(g.engine);
  assert.equal(before, 9, "eight [E] plus the face-down Golem");
  flipRgNow(g);
  const after = ready(g.engine);
  // The card stops being a resource (-1) and 4 resources are paid; the paid ones may include the card itself (CR 507.4b), so 4 or 5 remain.
  assert.ok(after === 4 || after === 5, `expected 4 or 5 resources left (4 paid), got ${after}`);
});

clause(RECYCLABLE, "3:flipUp", "the cost is exactly 4: three [E] plus the card itself is enough, two plus itself is refused", () => {
  const enough = rgBoard({ rg: "faceDown", icons: { elitism: 3 } });
  flipRgNow(enough);
  assert.equal(isFaceDown(enough.engine, enough.id("rg")), false, "the card paid for its own FLIP UP (CR 507.4b)");
  const short = rgBoard({ rg: "faceDown", icons: { elitism: 2 } });
  refused(flipRg(short), "three resources for a cost of 4");
  assert.equal(isFaceDown(short.engine, short.id("rg")), true, "still face-down");
  assert.equal(ready(short.engine), 3, "nothing was paid by the refused attempt");
});

clause(RECYCLABLE, "3:flipUp", "FLIP UP needs [E]: plenty of Greed and no [E] is refused, one [E] among them is enough", () => {
  const none = rgBoard({ rg: "faceDown", icons: { greed: 8 } });
  refused(flipRg(none), "no [E]");
  assert.equal(isFaceDown(none.engine, none.id("rg")), true);
  assert.equal(ready(none.engine), 9, "nothing was paid");
  const one = rgBoard({ rg: "faceDown", icons: { elitism: 1, greed: 3 } });
  flipRgNow(one);
  assert.equal(isFaceDown(one.engine, one.id("rg")), false, "control: one [E] among the others is enough");
});

clause(RECYCLABLE, "3:flipUp", "its own face-down Volition, other Volition and the opponent's [E] are not my [E]", () => {
  const own = rgBoard({ rg: "faceDown", icons: {}, extra: volition(6) });
  refused(flipRg(own), "Volition is not [E]");
  const theirs = rgBoard({ rg: "faceDown", icons: { greed: 6 }, oppIcons: { elitism: 6 } });
  refused(flipRg(theirs), "the opponent's [E]");
  assert.equal(isFaceDown(theirs.engine, theirs.id("rg")), true);
});

clause(RECYCLABLE, "3:flipUp", "a spent [E] still meets the threshold while ready resources pay the 4", () => {
  const g = rgBoard({ rg: "faceDown", icons: { greed: 4 }, extra: spent("elitism", 1) });
  flipRgNow(g);
  assert.equal(isFaceDown(g.engine, g.id("rg")), false, "a spent [E] still meets the threshold (CR 405.6)");
});

clause(RECYCLABLE, "3:flipUp", "FLIP UP is an alternative: deployed from my hand the Golem costs its printed 6 with [E]", () => {
  const g = rgBoard({ rg: "hand", icons: { elitism: 6 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("rg"));
  assert.equal(zoneOf(g.engine, g.id("rg")), "play");
  assert.equal(before - ready(g.engine), 6, "the printed cost, not the FLIP UP cost");
  const short = rgBoard({ rg: "hand", icons: { elitism: 5 } });
  refused(() => playRaw(short.engine, P1, short.id("rg")), "one short of the printed cost");
  const noE = rgBoard({ rg: "hand", icons: { greed: 8 } });
  refused(() => playRaw(noE.engine, P1, noE.id("rg")), "no [E]");
});

clause(RECYCLABLE, "3:flipUp", "a flipped-up Golem is a new arrival: it cannot attack the turn it flipped", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 6 } });
  flipRgNow(g);
  refused(
    () => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("rg")], target: { type: "faction", playerId: P2 } }),
    "a card that just flipped up is a new arrival and cannot attack (CR 411.3, 204.3)",
  /did not start the turn in play/
  );
});

clause(RECYCLABLE, "3:flipUp", "FLIP UP does not change WHEN a character can be deployed: refused on the opponent's turn with no response window (CR 507.4d)", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 6 }, turn: 2, active: P2 });
  refused(flipRg(g), "on the opponent's turn");
  assert.equal(isFaceDown(g.engine, g.id("rg")), true);
  assert.equal(ready(g.engine), 7, "nothing was paid");
  const mine = rgBoard({ rg: "faceDown", icons: { elitism: 6 } });
  flipRgNow(mine);
  assert.equal(isFaceDown(mine.engine, mine.id("rg")), false, "control: on my own turn it flips up");
});

clause(RECYCLABLE, "3:flipUp", "FLIP UP does not change WHEN a character can be deployed: not even in response during the opponent's attack (CR 507.4d)", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 6 }, turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in their attack");
  refused(flipRg(g), "a character is not a tactic: FLIP UP does not let it be deployed in response (CR 507.4d)");
  assert.equal(isFaceDown(g.engine, g.id("rg")), true);
  assert.equal(ready(g.engine), 7, "nothing was paid");
});

clause(RECYCLABLE, "3:flipUp", "only its controller can flip it, and only while it is face-down in play (not face-up, not in hand)", () => {
  const theirs = rgBoard({ rg: "faceDown", icons: { elitism: 6 }, oppIcons: { elitism: 6 } });
  refused(flipRg(theirs, P2), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("rg")), true);
  const inHand = rgBoard({ rg: "hand", icons: { elitism: 6 } });
  refused(flipRg(inHand), "in my hand it is not a face-down resource");
  const faceUp = rgBoard({ rg: "play", icons: { elitism: 6 } });
  refused(flipRg(faceUp), "already face-up");
});

clause(RECYCLABLE, "3:flipUp", "a face-down Recyclable Golem that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = rgBoard({ rg: "faceDown", rgSpent: true, icons: { elitism: 6 } });
  assert.equal(g.engine.state.cards[g.id("rg")].attachedTo, g.engine.state.players[P1].factionId, "setup: spent on my faction");
  flipRgNow(g);
  assert.equal(isFaceDown(g.engine, g.id("rg")), false);
});

clause(RECYCLABLE, "3:flipUp", "a flipped-up card is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it enters play", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 6 } });
  holdFlipUp(() => flipUpRaw(g.engine, P1, g.id("rg"), {}));
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("rg")), "deploying", "the character is being deployed, it has not entered play yet");
});

// --- 0:rule  If you played this card using FLIP UP, it enters play with a token on it. -------

clause(RECYCLABLE, "0:rule", "flipped up with FLIP UP it enters play with exactly one token on it", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 6 } });
  assert.equal(tokensOn(g.engine, g.id("rg")), 0);
  flipRgNow(g);
  assert.equal(tokensOn(g.engine, g.id("rg")), 1);
});

clause(RECYCLABLE, "0:rule", "deployed from my hand it enters play with NO token", () => {
  const g = rgBoard({ rg: "hand", icons: { elitism: 6 } });
  play(g.engine, P1, g.id("rg"));
  assert.equal(zoneOf(g.engine, g.id("rg")), "play");
  assert.equal(tokensOn(g.engine, g.id("rg")), 0);
  assert.deepEqual(rgStats(g), { strength: 6, speed: 3, life: 6 });
});

clause(RECYCLABLE, "0:rule", "put into play by an effect (not played with FLIP UP) it enters with no token", () => {
  const g = rgBoard({ rg: "hand", extra: [{ key: "put", def: putterTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("put"), { selected: { t: [g.id("rg")] } });
  assert.equal(zoneOf(g.engine, g.id("rg")), "play", "setup: it was put into play");
  assert.equal(tokensOn(g.engine, g.id("rg")), 0);
});

clause(RECYCLABLE, "0:rule", "a Golem that is face-down again flips up with a token again: the token is for every FLIP UP", () => {
  const g = rgWithKiller({ rg: "play", icons: { elitism: 6 } });
  killChar(g, "rg");
  assert.equal(isFaceDown(g.engine, g.id("rg")), true, "setup: it was destroyed and flipped face-down (no tokens)");
  flipRgNow(g);
  assert.equal(isFaceDown(g.engine, g.id("rg")), false);
  assert.equal(tokensOn(g.engine, g.id("rg")), 1);
});

clause(RECYCLABLE, "0:rule", "the token is on the Golem itself, and only one token enters", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 6 } });
  flipRgNow(g);
  assert.equal(tokensOn(g.engine, g.id("rg")), 1);
  for (const key of ["ally", "foe", "thing"]) assert.equal(tokensOn(g.engine, g.id(key)), 0, `${key} gets no token`);
  assert.equal(tokensOn(g.engine, g.engine.state.players[P1].factionId!), 0);
});

clause(RECYCLABLE, "0:rule", "the token is already there when it enters: right after the flip it has 4 strength / 4 life", () => {
  const g = rgBoard({ rg: "faceDown", icons: { elitism: 6 } });
  flipRgNow(g);
  assert.deepEqual(rgStats(g), { strength: 4, speed: 3, life: 4 });
});

// --- 1:rule  While there is a token on this card, it loses 2 strength and 2 life and can block COVERT parties. ---

clause(RECYCLABLE, "1:rule", "with no token it has its printed 6 strength / 3 speed / 6 life", () => {
  const g = rgBoard();
  assert.deepEqual(rgStats(g), { strength: 6, speed: 3, life: 6 });
});

clause(RECYCLABLE, "1:rule", "with a token it loses 2 strength and 2 life (4 / 3 / 4), speed unchanged", () => {
  const g = rgBoard({ tokens: 1 });
  assert.deepEqual(rgStats(g), { strength: 4, speed: 3, life: 4 });
});

clause(RECYCLABLE, "1:rule", "'while there is a token' is not 'per token': three tokens still cost it only 2 strength and 2 life", () => {
  const g = rgBoard({ tokens: 3 });
  assert.deepEqual(rgStats(g), { strength: 4, speed: 3, life: 4 });
});

clause(RECYCLABLE, "1:rule", "it is live: a token added later shrinks it at once, and removing the token restores it", () => {
  const g = rgBoard({ extra: [{ key: "tg", def: tokenGiver(1), owner: P1, zone: "hand" }, { key: "rt", def: tokenRemover(), owner: P1, zone: "hand" }] });
  assert.deepEqual(rgStats(g), { strength: 6, speed: 3, life: 6 });
  play(g.engine, P1, g.id("tg"), { selected: { t: [g.id("rg")] } });
  assert.deepEqual(rgStats(g), { strength: 4, speed: 3, life: 4 });
  play(g.engine, P1, g.id("rt"), { selected: { t: [g.id("rg")] } });
  assert.equal(tokensOn(g.engine, g.id("rg")), 0);
  assert.deepEqual(rgStats(g), { strength: 6, speed: 3, life: 6 });
});

clause(RECYCLABLE, "1:rule", "only a token ON THIS CARD counts: tokens on other cards change nothing", () => {
  const g = rgBoard({ extra: [{ key: "tk", def: character({ name: "Tokened" }), owner: P1, zone: "play", counters: { token: 4 } }] });
  assert.deepEqual(rgStats(g), { strength: 6, speed: 3, life: 6 });
});

clause(RECYCLABLE, "1:rule", "only this card is shrunk: other characters (and a second Golem without a token) keep their stats", () => {
  const g = rgBoard({ tokens: 1, second: true });
  assert.deepEqual(rgStats(g, "rg"), { strength: 4, speed: 3, life: 4 });
  assert.deepEqual(rgStats(g, "rg2"), { strength: 6, speed: 3, life: 6 });
  assert.deepEqual(rgStats(g, "ally"), { strength: 2, speed: 2, life: 3 });
});

clause(RECYCLABLE, "1:rule", "a Golem my opponent controls is shrunk the same way", () => {
  const g = rgBoard({ rgOwner: P2, tokens: 1 });
  assert.deepEqual(rgStats(g), { strength: 4, speed: 3, life: 4 });
});

clause(RECYCLABLE, "1:rule", "the lost life is real in battle: attacked by 4 damage a Golem with a token is destroyed, one without survives", () => {
  const board = (tokens: number) => rgBoard({ tokens, turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  const withToken = board(1);
  fight(withToken.engine, P2, [withToken.id("atk")], { type: "faction", playerId: P1 }, [withToken.id("rg")]);
  assert.equal(zoneOf(withToken.engine, withToken.id("rg")), "discard", "4 life takes 4 damage: destroyed (and a token means it is not flipped instead)");
  const plain = board(0);
  fight(plain.engine, P2, [plain.id("atk")], { type: "faction", playerId: P1 }, [plain.id("rg")]);
  assert.equal(zoneOf(plain.engine, plain.id("rg")), "play", "6 life takes 4 damage");
  assert.equal(isFaceDown(plain.engine, plain.id("rg")), false);
});

clause(RECYCLABLE, "1:rule", "the lost strength is real in battle: unblocked, a Golem with a token hits the faction for 4, one without for 6", () => {
  const withToken = rgBoard({ tokens: 1, turn: 1, active: P1 });
  const before = influenceOf(withToken.engine, P2);
  fight(withToken.engine, P1, [withToken.id("rg")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - influenceOf(withToken.engine, P2), 4);
  const plain = rgBoard({ turn: 1, active: P1 });
  fight(plain.engine, P1, [plain.id("rg")], { type: "faction", playerId: P2 }, []);
  assert.equal(influenceOf(plain.engine, P2) , before - 6);
});

/** P2 attacks with a COVERT character (and optionally a non-covert one): P1's Golem and bystanders may be asked to block. */
function covertAttackBoard(o: { tokens?: number; withPlainAttacker?: boolean; extra?: CardPlacement[] } = {}) {
  return rgBoard({
    tokens: o.tokens,
    turn: 2,
    active: P2,
    extra: [
      ...(o.extra ?? []),
      { key: "cov", def: character({ name: "Covert Attacker", strength: 1, life: 9, speed: 1, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...(o.withPlainAttacker ? [{ key: "plain", def: character({ name: "Plain Attacker", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" as const }] : []),
      { key: "covBlocker", def: character({ name: "Covert Blocker", strength: 1, life: 9, speed: 1, behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" }
    ]
  });
}
const blockWith = (g: RgGame, ids: CardInstanceId[]) => () => g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: ids });

clause(RECYCLABLE, "1:rule", "with a token it can block a COVERT party (alone)", () => {
  const g = covertAttackBoard({ tokens: 1 });
  declareAttackBy(g.engine, P2, [g.id("cov")]);
  blockWith(g, [g.id("rg")])();
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("rg")]);
});

clause(RECYCLABLE, "1:rule", "without a token it cannot block a COVERT party (an ordinary character cannot, CR 507.3b)", () => {
  const g = covertAttackBoard({ tokens: 0 });
  declareAttackBy(g.engine, P2, [g.id("cov")]);
  refused(blockWith(g, [g.id("rg")]), "no token: an ordinary character cannot block a covert party");
  refused(blockWith(g, [g.id("ally")]), "an ordinary ally cannot either");
  blockWith(g, [g.id("covBlocker")])();
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("covBlocker")], "control: a COVERT blocker can");
});

clause(RECYCLABLE, "1:rule", "with a token it can join a COVERT blocker in the blocking party", () => {
  const g = covertAttackBoard({ tokens: 1 });
  declareAttackBy(g.engine, P2, [g.id("cov")]);
  blockWith(g, [g.id("covBlocker"), g.id("rg")])();
  assert.deepEqual([...(battleOf(g.engine)?.blockingParty ?? [])].sort(), [g.id("covBlocker"), g.id("rg")].sort());
});

clause(RECYCLABLE, "1:rule", "the permission is for the Golem only: an ordinary ally still cannot block a COVERT party next to it", () => {
  const g = covertAttackBoard({ tokens: 1 });
  declareAttackBy(g.engine, P2, [g.id("cov")]);
  refused(blockWith(g, [g.id("rg"), g.id("ally")]), "the ally is not covert");
  assert.equal(battleOf(g.engine)?.blockingParty.length, 0, "no block was declared");
  blockWith(g, [g.id("rg")])();
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("rg")], "control: the Golem alone is fine");
});

clause(RECYCLABLE, "1:rule", "it can still block a party that is not covert, token or not (the permission only adds)", () => {
  for (const tokens of [0, 1]) {
    const g = rgBoard({ tokens, turn: 2, active: P2 });
    declareAttackBy(g.engine, P2, [g.id("foe")]);
    blockWith(g, [g.id("rg")])();
    assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("rg")], `tokens ${tokens}`);
  }
});

clause(RECYCLABLE, "1:rule", "a party with one non-covert member is not a covert party: anyone may block it, token or not", () => {
  const g = covertAttackBoard({ tokens: 0, withPlainAttacker: true });
  declareAttackBy(g.engine, P2, [g.id("cov"), g.id("plain")]);
  blockWith(g, [g.id("rg")])();
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("rg")]);
});

clause(RECYCLABLE, "1:rule", "the permission ends with the token: removing the token before blockers are declared makes the covert block illegal again", () => {
  const g = covertAttackBoard({ tokens: 1, extra: [{ key: "rt", def: tokenRemover(), owner: P1, zone: "hand" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("cov")]);
  respondWith(g.engine, P1, g.id("rt"), { t: [g.id("rg")] });
  assert.equal(tokensOn(g.engine, g.id("rg")), 0, "setup: the token is gone");
  refused(blockWith(g, [g.id("rg")]), "no token any more");
  blockWith(g, [g.id("covBlocker")])();
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("covBlocker")], "control: a covert blocker still can");
});

// --- 2:rule  If there are no tokens on this card and it's destroyed, flip it face-down under its owner's control instead. ---

clause(RECYCLABLE, "2:rule", "destroyed with no token on it: it is flipped face-down instead, still in play, not in the discard pile (no question asked)", () => {
  const g = rgWithKiller();
  killChar(g, "rg");
  assert.equal(g.engine.state.pendingChoice, undefined, "not a 'may': nothing to decide");
  assert.equal(zoneOf(g.engine, g.id("rg")), "play");
  assert.equal(isFaceDown(g.engine, g.id("rg")), true);
  assert.equal(discardOf(g.engine, P1).includes(g.id("rg")), false);
});

clause(RECYCLABLE, "2:rule", "destroyed WITH a token on it: it is destroyed as usual, into its owner's discard pile", () => {
  const g = rgWithKiller({ tokens: 1 });
  killChar(g, "rg");
  assert.equal(zoneOf(g.engine, g.id("rg")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("rg")), false);
});

clause(RECYCLABLE, "2:rule", "two tokens also mean 'tokens on this card': destroyed as usual", () => {
  const g = rgWithKiller({ tokens: 2 });
  killChar(g, "rg");
  assert.equal(zoneOf(g.engine, g.id("rg")), "discard");
});

clause(RECYCLABLE, "2:rule", "a flipped Golem is a face-down resource: Volition, in my resource pool, no longer a character", () => {
  const g = rgWithKiller({ icons: { elitism: 2 } });
  const readyBefore = ready(g.engine);
  killChar(g, "rg");
  assert.equal(g.engine.isResource(g.id("rg")), true);
  assert.deepEqual(g.engine.getCardTypes(g.id("rg")), ["resource"]);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
  assert.equal(ready(g.engine), readyBefore + 1);
});

clause(RECYCLABLE, "2:rule", "'under its owner's control': a Golem I own that my opponent controls ends up face-down under MY control", () => {
  const g = rgWithKiller({ rgOwner: P1, rgController: P2 });
  killChar(g, "rg");
  assert.equal(isFaceDown(g.engine, g.id("rg")), true);
  assert.equal(controllerOf(g.engine, g.id("rg")), P1);
  assert.ok(playOf(g.engine, P1).includes(g.id("rg")), "playOf(g.engine, P1).includes(g.id(\"rg\"))");
  assert.equal(playOf(g.engine, P2).includes(g.id("rg")), false);
});

clause(RECYCLABLE, "2:rule", "...and a Golem my opponent owns that I control ends up face-down under THEIR control", () => {
  const g = rgWithKiller({ rgOwner: P2, rgController: P1 });
  killChar(g, "rg");
  assert.equal(isFaceDown(g.engine, g.id("rg")), true);
  assert.equal(controllerOf(g.engine, g.id("rg")), P2);
});

clause(RECYCLABLE, "2:rule", "the damage it had is forgotten when it flips (it is a new card): flipped up again it has no damage", () => {
  const g = rgWithKiller({ damage: 3, icons: { elitism: 6 } });
  killChar(g, "rg");
  assert.equal(g.engine.state.cards[g.id("rg")].damage, 0);
  flipRgNow(g);
  assert.equal(g.engine.state.cards[g.id("rg")].damage, 0);
});

clause(RECYCLABLE, "2:rule", "lethal battle damage with no token also flips it: it ends face-down in play instead of in the discard pile", () => {
  const g = rgBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 6, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  fight(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("rg")]);
  assert.equal(zoneOf(g.engine, g.id("rg")), "play", "6 damage on 6 life: destroyed, so flipped instead");
  assert.equal(isFaceDown(g.engine, g.id("rg")), true);
  assert.equal(g.engine.state.cards[g.id("rg")].damage, 0);
  assert.equal(g.engine.state.battle, undefined);
});

clause(RECYCLABLE, "2:rule", "a flipped Golem that was blocking leaves the battle (it is not a character any more, CR 208.4)", () => {
  const g = rgBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }]
  });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  blockWith(g, [g.id("rg")])();
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("rg")]);
  g.engine.perform({ type: "passPriority", playerId: P2 }); // the attacker has nothing to add; now I hold priority in the battle window
  respondWith(g.engine, P1, g.id("kill"), { t: [g.id("rg")] });
  assert.equal(isFaceDown(g.engine, g.id("rg")), true);
  assert.equal(battleOf(g.engine)?.blockingParty.includes(g.id("rg")) ?? false, false, "it left the battle");
});

clause(RECYCLABLE, "2:rule", "only THIS card: a different character that is destroyed goes to the discard pile as usual", () => {
  const g = rgWithKiller();
  killChar(g, "ally");
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("ally")), false);
  assert.equal(zoneOf(g.engine, g.id("rg")), "play");
  assert.equal(isFaceDown(g.engine, g.id("rg")), false);
});

clause(RECYCLABLE, "2:rule", "with two Golems (neither has a token) destroying one flips only that one", () => {
  const g = rgWithKiller({ second: true });
  killChar(g, "rg");
  assert.equal(isFaceDown(g.engine, g.id("rg")), true);
  assert.equal(isFaceDown(g.engine, g.id("rg2")), false, "the other Golem stays face-up");
  assert.equal(zoneOf(g.engine, g.id("rg2")), "play");
});

clause(RECYCLABLE, "2:rule", "a token on ANOTHER Golem does not matter: a tokenless Golem is still flipped, a tokened one is destroyed", () => {
  const g = rgWithKiller({ second: true, tokens: 1 });
  killChar(g, "rg2");
  assert.equal(isFaceDown(g.engine, g.id("rg2")), true, "rg2 has no token: flipped");
  const h = rgWithKiller({ second: true, tokens: 1 });
  killChar(h, "rg");
  assert.equal(zoneOf(h.engine, h.id("rg")), "discard", "rg has a token: destroyed");
});

clause(RECYCLABLE, "2:rule", "destroying it as a COST is not replaced (CR 506.2): it goes straight to the discard pile", () => {
  const g = rgBoard({ extra: [{ key: "sacer", def: sacrificerChar(), owner: P1, zone: "play" }, ...fillers("dk", 2, P1, "deck")] });
  activate(g.engine, P1, g.id("sacer"), "sac", { selected: { v: [g.id("rg")] } });
  assert.equal(zoneOf(g.engine, g.id("rg")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("rg")), false);
});

clause(RECYCLABLE, "2:rule", "only DESTROYED is replaced: bounced to hand it goes to its owner's hand, removed from the game it is removed", () => {
  const g = rgBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }, { key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("rg")] } });
  assert.equal(zoneOf(g.engine, g.id("rg")), "hand");
  const h = rgBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(h.engine, P1, h.id("rm"), { selected: { t: [h.id("rg")] } });
  assert.equal(zoneOf(h.engine, h.id("rg")), "removed");
});

clause(RECYCLABLE, "2:rule", "the flipped Golem can be flipped up again for 4 [E] and then has a token", () => {
  const g = rgWithKiller({ icons: { elitism: 5 } });
  killChar(g, "rg");
  flipRgNow(g);
  assert.equal(zoneOf(g.engine, g.id("rg")), "play");
  assert.equal(isFaceDown(g.engine, g.id("rg")), false);
  assert.equal(tokensOn(g.engine, g.id("rg")), 1);
  assert.deepEqual(rgStats(g), { strength: 4, speed: 3, life: 4 });
});

// =================================================================================
// Research Intern
// RESEARCH -- COST: Deplete this card. -- EFFECT: Reduce the next numeric cost you pay this turn by 1.
// RESEARCH HARDER: [E][E][E][E][E] -- COST: Deplete this card. -- EFFECT: Reduce the next numeric cost you pay this turn by 2.
// Character (31f), cost 3, [E], 2 strength / 3 speed / 2 life.
// =================================================================================

const INTERN = "6ef1f956-2ea5-4c1f-943f-6a1b3338ae98";

interface RiOpts {
  ri?: "play" | "hand" | "faceDown";
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  second?: boolean;
  depleted?: boolean;
  fresh?: boolean;
  extra?: CardPlacement[];
}

/** P1: ri (+ ri2), hand: big / big2 (items cost 5), small (2), one (1), zero (0). P2: foe, oppBig (item cost 5 in hand). Default P1's turn 1 with twelve [E]. */
function riBoard(o: RiOpts = {}) {
  const where = o.ri ?? "play";
  return devBoard(
    [
      { key: "ri", def: printing(INTERN), owner: P1, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined, depleted: o.depleted, attackEligible: o.fresh ? false : undefined },
      ...(o.second ? [{ key: "ri2", def: printing(INTERN), owner: P1, zone: "play" as const }] : []),
      { key: "big", def: item({ name: "Big Five", cost: 5 }), owner: P1, zone: "hand" },
      { key: "big2", def: item({ name: "Big Five Again", cost: 5 }), owner: P1, zone: "hand" },
      { key: "small", def: item({ name: "Small Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "one", def: item({ name: "Cheap One", cost: 1 }), owner: P1, zone: "hand" },
      { key: "zero", def: item({ name: "Free Zero", cost: 0 }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "oppBig", def: item({ name: "Their Five", cost: 5 }), owner: P2, zone: "hand" },
      ...res(o.icons ?? { elitism: 12 }),
      ...res(o.oppIcons ?? { elitism: 12 }, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type RiGame = ReturnType<typeof riBoard>;
const research = (g: RiGame, key = "ri") => activate(g.engine, P1, g.id(key), "research");
const researchHarder = (g: RiGame, key = "ri") => activate(g.engine, P1, g.id(key), "research-harder");
const researchAttempt = (g: RiGame, abilityId: string, key = "ri") => () => actRaw(g.engine, P1, g.id(key), abilityId);

/** Plays `key` and returns how many resources it cost. */
function paid(g: RiGame, key: string): number {
  const before = ready(g.engine);
  play(g.engine, P1, g.id(key));
  assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} was deployed`);
  return before - ready(g.engine);
}

// --- RESEARCH ---------------------------------------------------------------------------

clause(INTERN, "0:ability:research", "the cost is only 'deplete this card': no resource is spent, the Intern is depleted and stays in play", () => {
  const g = riBoard();
  const before = ready(g.engine);
  assert.equal(isDepleted(g.engine, g.id("ri")), false);
  research(g);
  assert.equal(isDepleted(g.engine, g.id("ri")), true, "depleted by its own cost");
  assert.equal(ready(g.engine), before, "no resource was paid");
  assert.equal(zoneOf(g.engine, g.id("ri")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(INTERN, "0:ability:research", "the next numeric cost I pay is reduced by exactly 1: a cost-5 item costs 4", () => {
  const g = riBoard();
  research(g);
  assert.equal(paid(g, "big"), 4);
});

clause(INTERN, "0:ability:research", "...without research the same item costs its full 5 (control)", () => {
  const g = riBoard();
  assert.equal(paid(g, "big"), 5);
});

clause(INTERN, "0:ability:research", "a numeric cost can never go below 0 (CR 406.6): a cost-1 item becomes free, and a cost-0 item stays free", () => {
  for (const key of ["one", "zero"]) {
    const g = riBoard();
    research(g);
    assert.equal(paid(g, key), 0, `${key} is free`);
  }
  const small = riBoard();
  research(small);
  assert.equal(paid(small, "small"), 1, "a cost-2 item costs 1");
});

clause(INTERN, "0:ability:research", "only the NEXT cost is reduced: after the first card the second pays full price", () => {
  const g = riBoard();
  research(g);
  assert.equal(paid(g, "big"), 4, "the first card gets the reduction");
  assert.equal(paid(g, "big2"), 5, "the second does not");
});

clause(INTERN, "0:ability:research", "a cost-1 card absorbs the whole reduction: nothing is left over for the next card", () => {
  const g = riBoard();
  research(g);
  assert.equal(paid(g, "one"), 0);
  assert.equal(paid(g, "big"), 5, "nothing is left over");
});

clause(INTERN, "0:ability:research", "'this turn': an unused reduction is gone when the turn is over", () => {
  const g = riBoard();
  research(g);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(g.engine, g.id("ri")), false, "the Intern was restored at the start of my turn");
  assert.equal(paid(g, "big"), 5, "the old reduction did not carry over");
});

clause(INTERN, "0:ability:research", "it cannot be used while the Intern is depleted (the cost cannot be paid); once restored it can be used again", () => {
  const g = riBoard();
  research(g);
  refused(researchAttempt(g, "research"), "already depleted");
  assert.equal(paid(g, "big"), 4, "still only one reduction was applied");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  research(g);
  assert.equal(paid(g, "big2"), 4, "usable again after being restored");
});

clause(INTERN, "0:ability:research", "an Intern that starts depleted cannot use it", () => {
  const g = riBoard({ depleted: true });
  refused(researchAttempt(g, "research"), "depleted");
  assert.equal(paid(g, "big"), 5);
});

clause(INTERN, "0:ability:research", "'you pay': the opponent's costs are not reduced", () => {
  const g = riBoard();
  research(g);
  assert.equal(g.engine.getCardPlayability(P2, g.id("oppBig")).numericCost, 5, "their cost-5 item still costs 5");
  assert.equal(g.engine.getCardPlayability(P1, g.id("big")).numericCost, 4, "mine costs 4");
});

clause(INTERN, "0:ability:research", "the reduction is for the numeric cost only: the card's threshold must still be met", () => {
  const g = riBoard({ extra: [{ key: "gated", def: item({ name: "Gated", cost: 2, threshold: "g" }), owner: P1, zone: "hand" }] });
  research(g);
  refused(() => playRaw(g.engine, P1, g.id("gated")), "no [G] among the twelve [E]");
  assert.equal(zoneOf(g.engine, g.id("gated")), "hand");
});

clause(INTERN, "0:ability:research", "it still applies after the Intern has left play (an ability resolves as written when it was used, CR 502.4)", () => {
  const shredder = item({
    name: "Shredder",
    cost: 0,
    behavior: { abilities: [{ id: "shred", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = riBoard({ extra: [{ key: "shredder", def: shredder, owner: P1, zone: "play" }] });
  research(g);
  activate(g.engine, P1, g.id("shredder"), "shred", { selected: { t: [g.id("ri")] } });
  assert.equal(zoneOf(g.engine, g.id("ri")), "discard");
  assert.equal(paid(g, "big"), 4, "the reduction is still waiting for my next numeric cost");
});

clause(INTERN, "0:ability:research", "an ability with no 'pay' in its cost has no numeric cost (CR 406.4), so using one does not use the reduction up", () => {
  const shredder = item({
    name: "Shredder",
    cost: 0,
    behavior: { abilities: [{ id: "shred", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const g = riBoard({ extra: [{ key: "shredder", def: shredder, owner: P1, zone: "play" }, { key: "junk", def: item({ name: "Junk" }), owner: P1, zone: "play" }] });
  research(g);
  activate(g.engine, P1, g.id("shredder"), "shred", { selected: { t: [g.id("junk")] } });
  assert.equal(zoneOf(g.engine, g.id("junk")), "discard");
  assert.equal(paid(g, "big"), 4, "the reduction is still waiting");
});

clause(INTERN, "0:ability:research", "every card has a numeric cost (CR 406.2: 0 if none is printed), so a free card played next absorbs the reduction: a later costly card pays full price", () => {
  const freeTactic = tactic({
    name: "Free Zap",
    cost: 0,
    behavior: { abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
  });
  const g = riBoard({ extra: [{ key: "freeTactic", def: freeTactic, owner: P1, zone: "hand" }] });
  research(g);
  play(g.engine, P1, g.id("freeTactic"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("freeTactic")), "discard");
  assert.equal(paid(g, "big"), 5, "the free tactic was the next numeric cost");
});

clause(INTERN, "0:ability:research", "it can be used in response on the opponent's turn: the reduction then applies to my costs that turn", () => {
  const g = riBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("ri"), "research");
  resolvePendingResponses(g.engine);
  assert.equal(isDepleted(g.engine, g.id("ri")), true);
  assert.equal(g.engine.getCardPlayability(P1, g.id("big")).numericCost, 4, "the next cost I pay on their turn is reduced");
});

clause(INTERN, "0:ability:research", "a response to a tactic: the next numeric cost is the tactic I play in response, which is reduced by 1", () => {
  const bolt = tactic({
    name: "Cost Three Bolt",
    cost: 3,
    behavior: { abilities: [{ id: "bolt", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
  });
  const g = riBoard({ turn: 2, active: P2, extra: [{ key: "bolt", def: bolt, owner: P1, zone: "hand" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  actRaw(g.engine, P1, g.id("ri"), "research");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.getCardPlayability(P1, g.id("bolt")).numericCost, 2);
});

clause(INTERN, "0:ability:research", "it can be used the turn the Intern enters play: abilities do not need the character to have been in play since the start of the turn (CR 204.3a)", () => {
  const g = riBoard({ fresh: true });
  research(g);
  assert.equal(isDepleted(g.engine, g.id("ri")), true);
  assert.equal(paid(g, "big"), 4);
});

clause(INTERN, "0:ability:research", "it needs no resources at all and no threshold: an Intern with nothing else in play can use it", () => {
  const g = riBoard({ icons: {}, oppIcons: {} });
  assert.equal(ready(g.engine), 0);
  research(g);
  assert.equal(isDepleted(g.engine, g.id("ri")), true);
  assert.equal(g.engine.getCardPlayability(P1, g.id("big")).numericCost, 4);
});

clause(INTERN, "0:ability:research", "two Interns used together both apply to the one 'next numeric cost': it is reduced by 2 (CR 410.3)", () => {
  const g = riBoard({ second: true });
  research(g, "ri");
  research(g, "ri2");
  assert.equal(paid(g, "big"), 3);
});

clause(INTERN, "0:ability:research", "'pay N' is a numeric cost (CR 406.5): the reduction lowers the cost of an ability that says 'pay 3' to 2", () => {
  const gadget = item({
    name: "Pay Three Gadget",
    cost: 0,
    behavior: { abilities: [{ id: "go", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = riBoard({ extra: [{ key: "gadget", def: gadget, owner: P1, zone: "play" }, ...fillers("dk", 3, P1, "deck")] });
  research(g);
  const before = ready(g.engine);
  activate(g.engine, P1, g.id("gadget"), "go");
  assert.equal(before - ready(g.engine), 2, "pay 3 reduced by 1 is pay 2");
});

clause(INTERN, "0:ability:research", "a face-down Intern is only a resource with no rules text (CR 411.1): RESEARCH cannot be used", () => {
  const g = riBoard({ ri: "faceDown" });
  refused(researchAttempt(g, "research"), "face-down", /Activated ability not found|face-down|rules text/i);
  assert.equal(paid(g, "big"), 5);
});

clause(INTERN, "0:ability:research", "it works from play only: an Intern in my hand cannot use it", () => {
  const g = riBoard({ ri: "hand" });
  refused(researchAttempt(g, "research"), "in hand", /Activated ability not found|not in play|play/i);
});

clause(INTERN, "0:ability:research", "only its controller can use it", () => {
  const g = riBoard({ turn: 1, active: P1, extra: [{ key: "atk", def: character({ name: "My Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(() => actRaw(g.engine, P2, g.id("ri"), "research"), "the Intern is mine", /control|owner|yours|your/i);
  assert.equal(isDepleted(g.engine, g.id("ri")), false);
});

// --- RESEARCH HARDER ----------------------------------------------------------------------

clause(INTERN, "1:ability:research-harder", "the next numeric cost I pay is reduced by exactly 2: a cost-5 item costs 3", () => {
  const g = riBoard();
  researchHarder(g);
  assert.equal(paid(g, "big"), 3);
});

clause(INTERN, "1:ability:research-harder", "the cost is only 'deplete this card': no resource is spent", () => {
  const g = riBoard();
  const before = ready(g.engine);
  researchHarder(g);
  assert.equal(isDepleted(g.engine, g.id("ri")), true);
  assert.equal(ready(g.engine), before);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(INTERN, "1:ability:research-harder", "it reduces by 2, not by 3: it does not add to RESEARCH's 1 (they share the Intern's one deplete)", () => {
  const g = riBoard();
  researchHarder(g);
  refused(researchAttempt(g, "research"), "the Intern is already depleted");
  assert.equal(paid(g, "big"), 3);
});

clause(INTERN, "1:ability:research-harder", "a numeric cost never goes below 0: cost-2, cost-1 and cost-0 items are free, a cost-5 item costs 3", () => {
  for (const key of ["small", "one", "zero"]) {
    const g = riBoard();
    researchHarder(g);
    assert.equal(paid(g, key), 0, `${key} is free`);
  }
});

clause(INTERN, "1:ability:research-harder", "only the NEXT cost is reduced: after the first card the second pays full price", () => {
  const g = riBoard();
  researchHarder(g);
  assert.equal(paid(g, "big"), 3);
  assert.equal(paid(g, "big2"), 5);
});

clause(INTERN, "1:ability:research-harder", "a cost-1 card absorbs the whole 2-reduction: nothing is left for the next card", () => {
  const g = riBoard();
  researchHarder(g);
  assert.equal(paid(g, "one"), 0);
  assert.equal(paid(g, "big"), 5);
});

clause(INTERN, "1:ability:research-harder", "'this turn': an unused reduction is gone when the turn is over", () => {
  const g = riBoard();
  researchHarder(g);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(paid(g, "big"), 5);
});

clause(INTERN, "1:ability:research-harder", "needs [E][E][E][E][E]: four [E] among plenty of other resources is refused, five are accepted", () => {
  const four = riBoard({ icons: { elitism: 4, greed: 8 } });
  refused(researchAttempt(four, "research-harder"), "four [E]");
  assert.equal(isDepleted(four.engine, four.id("ri")), false, "nothing was depleted");
  assert.equal(four.engine.getCardPlayability(P1, four.id("big")).numericCost, 5);
  const five = riBoard({ icons: { elitism: 5 } });
  researchHarder(five);
  assert.equal(paid(five, "big"), 3, "control: five [E] are enough");
});

clause(INTERN, "1:ability:research-harder", "the five icons must be [E]: five Greed are not enough, and neither are five face-down Volition", () => {
  const greed = riBoard({ icons: { greed: 8, elitism: 0 } });
  refused(researchAttempt(greed, "research-harder"), "no [E]");
  const volitionOnly = riBoard({ icons: {}, extra: volition(8) });
  refused(researchAttempt(volitionOnly, "research-harder"), "Volition is not [E]");
});

clause(INTERN, "1:ability:research-harder", "my opponent's [E] do not count towards the five", () => {
  const g = riBoard({ icons: { elitism: 2 }, oppIcons: { elitism: 12 } });
  refused(researchAttempt(g, "research-harder"), "only two of my own");
  assert.equal(isDepleted(g.engine, g.id("ri")), false);
});

clause(INTERN, "1:ability:research-harder", "spent [E] still count towards the five (icons are never spent, CR 405.6)", () => {
  const g = riBoard({ icons: {}, extra: [...spent("elitism", 5)] });
  assert.equal(ready(g.engine), 0, "setup: every resource is spent");
  researchHarder(g);
  assert.equal(isDepleted(g.engine, g.id("ri")), true);
  assert.equal(g.engine.getCardPlayability(P1, g.id("big")).numericCost, 3);
});

clause(INTERN, "1:ability:research-harder", "RESEARCH needs no threshold: with only two [E] RESEARCH works while RESEARCH HARDER does not", () => {
  const g = riBoard({ icons: { elitism: 2 } });
  refused(researchAttempt(g, "research-harder"), "two [E]");
  research(g);
  assert.equal(g.engine.getCardPlayability(P1, g.id("big")).numericCost, 4);
});

clause(INTERN, "1:ability:research-harder", "it cannot be used while the Intern is depleted; once restored it can be used again", () => {
  const g = riBoard();
  researchHarder(g);
  refused(researchAttempt(g, "research-harder"), "already depleted");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  researchHarder(g);
  assert.equal(paid(g, "big"), 3);
});

clause(INTERN, "1:ability:research-harder", "'you pay': the opponent's costs are not reduced", () => {
  const g = riBoard();
  researchHarder(g);
  assert.equal(g.engine.getCardPlayability(P2, g.id("oppBig")).numericCost, 5);
  assert.equal(g.engine.getCardPlayability(P1, g.id("big")).numericCost, 3);
});

clause(INTERN, "1:ability:research-harder", "the threshold of the card I play next must still be met", () => {
  const g = riBoard({ extra: [{ key: "gated", def: item({ name: "Gated", cost: 3, threshold: "g" }), owner: P1, zone: "hand" }] });
  researchHarder(g);
  refused(() => playRaw(g.engine, P1, g.id("gated")), "no [G]");
});

clause(INTERN, "1:ability:research-harder", "two Interns: RESEARCH (1) and RESEARCH HARDER (2) used together both apply to the one 'next numeric cost': a cost-5 item costs 2 (CR 410.3)", () => {
  const g = riBoard({ second: true });
  research(g, "ri");
  researchHarder(g, "ri2");
  assert.equal(paid(g, "big"), 2);
});

clause(INTERN, "1:ability:research-harder", "'pay N' is a numeric cost (CR 406.5): the 2-reduction lowers the cost of an ability that says 'pay 3' to 1", () => {
  const gadget = item({
    name: "Pay Three Gadget",
    cost: 0,
    behavior: { abilities: [{ id: "go", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const g = riBoard({ extra: [{ key: "gadget", def: gadget, owner: P1, zone: "play" }, ...fillers("dk", 3, P1, "deck")] });
  researchHarder(g);
  const before = ready(g.engine);
  activate(g.engine, P1, g.id("gadget"), "go");
  assert.equal(before - ready(g.engine), 1, "pay 3 reduced by 2 is pay 1");
});

clause(INTERN, "1:ability:research-harder", "a face-down Intern has no rules text: RESEARCH HARDER cannot be used", () => {
  const g = riBoard({ ri: "faceDown", icons: { elitism: 8 } });
  refused(researchAttempt(g, "research-harder"), "face-down", /Activated ability not found|face-down|rules text/i);
});

clause(INTERN, "1:ability:research-harder", "it can be used in response on the opponent's turn", () => {
  const g = riBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  actRaw(g.engine, P1, g.id("ri"), "research-harder");
  resolvePendingResponses(g.engine);
  assert.equal(isDepleted(g.engine, g.id("ri")), true);
  assert.equal(g.engine.getCardPlayability(P1, g.id("big")).numericCost, 3);
});

// =================================================================================
// Rewarding Salvage
// COST: Pick 2 or fewer items in your discard pile. -- EFFECT: Put the items into your hand.
// FLIP UP: 2 [E][E] and play a resource.
// Tactic, cost 4, [E][E].
// =================================================================================

const SALVAGE = "63046a8b-0158-4148-89db-49f18cbe470e";

/** A free tactic (id "grave-robber", pick "t"): moves one picked item from a discard pile to the top of its owner's deck. */
function graveRobber(name = "Grave Robber"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grave-robber",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "item" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "deck", position: "top" }]
        }
      ]
    }
  });
}

interface RsOpts {
  rs?: "hand" | "faceDown" | "play";
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  noHand?: boolean;
  rsSpent?: boolean;
  extra?: CardPlacement[];
}

/**
 * P1: rs (the Salvage), discard pile: i1 i2 i3 (items) + xc (character) xt (tactic) xl (location) xr (resource); play: pi (item);
 * hand: hi (item), hres (Greed resource), hchar (character); deck: di (item) + 3 fillers. P2: oi (item in their discard pile), oplay (item in play), foe.
 * Default P1's turn 1, [E] x6.
 */
function rsBoard(o: RsOpts = {}) {
  const where = o.rs ?? "hand";
  return devBoard(
    [
      {
        key: "rs",
        def: printing(SALVAGE),
        owner: P1,
        zone: where === "hand" ? "hand" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: where === "faceDown" && o.rsSpent ? "__factionA" : undefined
      },
      { key: "i1", def: item({ name: "Salvage Item 1" }), owner: P1, zone: "discard" },
      { key: "i2", def: item({ name: "Salvage Item 2" }), owner: P1, zone: "discard" },
      { key: "i3", def: item({ name: "Salvage Item 3" }), owner: P1, zone: "discard" },
      { key: "xc", def: character({ name: "Dead Character" }), owner: P1, zone: "discard" },
      { key: "xt", def: tactic({ name: "Dead Tactic" }), owner: P1, zone: "discard" },
      { key: "xl", def: location({ name: "Dead Location" }), owner: P1, zone: "discard" },
      { key: "xr", def: resourceCard({ name: "Dead Resource" }), owner: P1, zone: "discard" },
      { key: "pi", def: item({ name: "Item In Play" }), owner: P1, zone: "play" },
      ...(o.noHand
        ? []
        : [
            { key: "hi", def: item({ name: "Item In Hand" }), owner: P1, zone: "hand" as const },
            { key: "hres", def: resourceCard({ name: "Hand Greed", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "hchar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" as const }
          ]),
      { key: "di", def: item({ name: "Item In Deck" }), owner: P1, zone: "deck" },
      ...fillers("dk", 3, P1, "deck"),
      { key: "oi", def: item({ name: "Their Discarded Item" }), owner: P2, zone: "discard" },
      { key: "oplay", def: item({ name: "Their Item In Play" }), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res(o.icons ?? { elitism: 6 }),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type RsGame = ReturnType<typeof rsBoard>;
const salvage = (g: RsGame, picks: string[]) => play(g.engine, P1, g.id("rs"), { selected: { haul: picks.map((key) => g.id(key)) } });
const salvageAttempt = (g: RsGame, picks: string[]) => () => playRaw(g.engine, P1, g.id("rs"), { selected: { haul: picks.map((key) => g.id(key)) } });

// --- 0:ability  COST: Pick 2 or fewer items in your discard pile. EFFECT: Put the items into your hand. ---

clause(SALVAGE, "0:ability", "picking 2 items in my discard pile puts both into my hand", () => {
  const g = rsBoard();
  salvage(g, ["i1", "i2"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("i2")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("i1")) && handOf(g.engine, P1).includes(g.id("i2")), "handOf(g.engine, P1).includes(g.id(\"i1\")) && handOf(g.engine, P1).includes(g.id(\"i2\"))");
});

clause(SALVAGE, "0:ability", "'2 or fewer': picking just 1 item puts that one into my hand", () => {
  const g = rsBoard();
  salvage(g, ["i2"]);
  assert.equal(zoneOf(g.engine, g.id("i2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("i3")), "discard");
});

clause(SALVAGE, "0:ability", "'2 or fewer' includes 0: picking nothing is legal, the tactic resolves, the cost is paid and no card moves", () => {
  const g = rsBoard();
  const before = ready(g.engine);
  const discardBefore = discardOf(g.engine, P1).length;
  salvage(g, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(g.engine), 4, "the cost is paid");
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard", "the tactic resolved");
  assert.equal(discardOf(g.engine, P1).length, discardBefore + 1, "only the tactic joined the discard pile");
  assert.equal(handOf(g.engine, P1).includes(g.id("i1")), false);
});

clause(SALVAGE, "0:ability", "three items are too many: the pick is refused (control: two are accepted)", () => {
  const g = rsBoard();
  refused(salvageAttempt(g, ["i1", "i2", "i3"]), "3 items");
  assert.equal(zoneOf(g.engine, g.id("rs")), "hand", "nothing was played");
  assert.equal(ready(g.engine), 6);
  salvage(g, ["i1", "i3"]);
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand", "control");
  assert.equal(zoneOf(g.engine, g.id("i3")), "hand");
});

clause(SALVAGE, "0:ability", "unpicked items stay in the discard pile", () => {
  const g = rsBoard();
  salvage(g, ["i1"]);
  assert.equal(zoneOf(g.engine, g.id("i2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("i3")), "discard");
});

clause(SALVAGE, "0:ability", "only ITEMS can be picked: a character, a tactic, a location and a resource in my discard pile are refused", () => {
  const g = rsBoard();
  for (const key of ["xc", "xt", "xl", "xr"]) {
    refused(salvageAttempt(g, [key]), `${key} is not an item`);
    refused(salvageAttempt(g, ["i1", key]), `${key} next to an item`);
  }
  assert.equal(zoneOf(g.engine, g.id("rs")), "hand");
  salvage(g, ["i1"]);
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand", "control: an item is accepted");
  for (const key of ["xc", "xt", "xl", "xr"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} stays`);
});

clause(SALVAGE, "0:ability", "only items in MY discard pile: an item in my opponent's discard pile is refused", () => {
  const g = rsBoard();
  refused(salvageAttempt(g, ["oi"]), "their discard pile");
  refused(salvageAttempt(g, ["i1", "oi"]), "one of mine and one of theirs");
  assert.equal(zoneOf(g.engine, g.id("oi")), "discard");
  salvage(g, ["i1"]);
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand");
});

clause(SALVAGE, "0:ability", "only the discard pile: items in play, in my hand and in my deck are refused", () => {
  const g = rsBoard();
  refused(salvageAttempt(g, ["pi"]), "an item in play");
  refused(salvageAttempt(g, ["hi"]), "an item in my hand");
  refused(salvageAttempt(g, ["di"]), "an item in my deck");
  refused(salvageAttempt(g, ["oplay"]), "their item in play");
  assert.equal(zoneOf(g.engine, g.id("pi")), "play");
  salvage(g, ["i2"]);
  assert.equal(zoneOf(g.engine, g.id("i2")), "hand", "control");
});

clause(SALVAGE, "0:ability", "the same card cannot be picked twice", () => {
  const g = rsBoard();
  refused(salvageAttempt(g, ["i1", "i1"]), "the same item twice");
  assert.equal(zoneOf(g.engine, g.id("rs")), "hand");
  assert.equal(ready(g.engine), 6);
});

clause(SALVAGE, "0:ability", "it costs exactly 4", () => {
  const g = rsBoard();
  const before = ready(g.engine);
  salvage(g, ["i1"]);
  assert.equal(before - ready(g.engine), 4);
});

clause(SALVAGE, "0:ability", "it needs [E][E]: one [E] among plenty of other resources is refused, so is none; two [E] and two others are enough", () => {
  const one = rsBoard({ icons: { elitism: 1, greed: 6 } });
  refused(salvageAttempt(one, ["i1"]), "one [E]");
  assert.equal(zoneOf(one.engine, one.id("rs")), "hand");
  assert.equal(ready(one.engine), 7, "nothing was paid");
  const none = rsBoard({ icons: { greed: 8 } });
  refused(salvageAttempt(none, ["i1"]), "no [E]");
  const two = rsBoard({ icons: { elitism: 2, greed: 2 } });
  salvage(two, ["i1"]);
  assert.equal(zoneOf(two.engine, two.id("i1")), "hand", "control: two [E] among four resources");
  assert.equal(ready(two.engine), 0);
});

clause(SALVAGE, "0:ability", "its cost is 4: three ready resources are refused even with the [E][E]", () => {
  const g = rsBoard({ icons: { elitism: 3 } });
  refused(salvageAttempt(g, ["i1"]), "one resource short");
  assert.equal(zoneOf(g.engine, g.id("rs")), "hand");
  assert.equal(ready(g.engine), 3);
  const spentIcons = rsBoard({ icons: { greed: 2 }, extra: spent("elitism", 2) });
  refused(salvageAttempt(spentIcons, ["i1"]), "the spent [E] meet the threshold but only two ready resources pay", /Costs cannot be paid/);
  const enough = rsBoard({ icons: { greed: 4 }, extra: spent("elitism", 2) });
  salvage(enough, ["i1"]);
  assert.equal(zoneOf(enough.engine, enough.id("i1")), "hand", "spent [E] still meet the threshold");
});

clause(SALVAGE, "0:ability", "my opponent's [E] and my Volition are not my [E][E]", () => {
  const theirs = rsBoard({ icons: { greed: 6 }, oppIcons: { elitism: 6 } });
  refused(salvageAttempt(theirs, ["i1"]), "their [E]");
  const vol = rsBoard({ icons: {}, extra: volition(6) });
  refused(salvageAttempt(vol, ["i1"]), "Volition");
});

clause(SALVAGE, "0:ability", "the picks are a cost: they are chosen when I play it, and the items stay in the discard pile until it resolves", () => {
  const g = rsBoard();
  playRaw(g.engine, P1, g.id("rs"), { selected: { haul: [g.id("i1"), g.id("i2")] } });
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard", "not in my hand yet");
  assert.equal(zoneOf(g.engine, g.id("rs")), "deploying", "the tactic is waiting to resolve");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("i2")), "hand");
});

clause(SALVAGE, "0:ability", "if a picked item leaves the discard pile in response (it is put on top of my deck), the effect loses track of it (CR 402.4): it stays in the deck; the other item still comes to my hand", () => {
  const g = rsBoard({ extra: [{ key: "robber", def: graveRobber(), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("rs"), { selected: { haul: [g.id("i1"), g.id("i2")] } });
  respondWith(g.engine, P2, g.id("robber"), { t: [g.id("i1")] });
  assert.equal(zoneOf(g.engine, g.id("i2")), "hand", "the other item is put into my hand");
  assert.equal(zoneOf(g.engine, g.id("i1")), "deck", "the moved item is not fetched back out of my deck");
});

clause(SALVAGE, "0:ability", "the tactic ends in its owner's discard pile when it has resolved", () => {
  const g = rsBoard();
  salvage(g, ["i1"]);
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("rs")), "discardOf(g.engine, P1).includes(g.id(\"rs\"))");
});

clause(SALVAGE, "0:ability", "being a tactic it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = rsBoard({ turn: 2, active: P2 });
  refused(salvageAttempt(g, ["i1"]), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("rs"), { haul: [g.id("i1"), g.id("i2")] });
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("i2")), "hand");
});

clause(SALVAGE, "0:ability", "it cannot be played from the discard pile (it is played from my hand)", () => {
  const inDiscard = devBoard([{ key: "rs", def: printing(SALVAGE), owner: P1, zone: "discard" }, { key: "i1", def: item({ name: "Salvage Item 1" }), owner: P1, zone: "discard" }, ...res({ elitism: 6 })]);
  refused(() => playRaw(inDiscard.engine, P1, inDiscard.id("rs"), { selected: { haul: [inDiscard.id("i1")] } }), "from the discard pile");
  assert.equal(zoneOf(inDiscard.engine, inDiscard.id("rs")), "discard");
});

// --- 1:flipUp  FLIP UP: 2 [E][E] and play a resource. ---------------------------------------

const flipRs = (g: RsGame, picks: string[] = [], player: PlayerId = P1) => () =>
  flipUpRaw(g.engine, player, g.id("rs"), picks.length ? { haul: picks.map((key) => g.id(key)) } : {});

/** Flips the face-down Salvage up with `picks`, then plays `handCard` as the resource the FLIP UP asks for. */
function flipRsFully(g: RsGame, picks: string[], handCard: string = "hres"): void {
  flipRs(g, picks)();
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(handCard)] });
  assert.equal(g.engine.state.pendingChoice, undefined);
}

const rsFaceDown = (o: RsOpts = {}) => rsBoard({ ...o, rs: "faceDown" });

clause(SALVAGE, "1:flipUp", "a face-down Salvage is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = rsFaceDown({ icons: { elitism: 2 } });
  assert.equal(g.engine.isResource(g.id("rs")), true);
  assert.equal(ready(g.engine), 3, "two [E] plus the face-down Salvage");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(SALVAGE, "1:flipUp", "flipping it up resolves it as the tactic: the picked items go to my hand and Salvage ends in my discard pile", () => {
  const g = rsFaceDown();
  flipRsFully(g, ["i1", "i2"]);
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("i2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("i3")), "discard");
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard", "a flipped-up tactic goes to its owner's discard pile when it has resolved");
  assert.equal(isFaceDown(g.engine, g.id("rs")), false);
});

clause(SALVAGE, "1:flipUp", "FLIP UP pays 2 and no more: the printed cost of 4 is not paid", () => {
  const g = rsFaceDown({ icons: { elitism: 6 } });
  assert.equal(ready(g.engine), 7);
  flipRsFully(g, ["i1"]);
  const spentNow = attachedCount(g.engine, P1);
  assert.ok(spentNow <= 2, `at most two resources are spent (the Salvage may pay for itself), got ${spentNow}`);
  // Salvage left the pool, the played resource joined: 7 - 1 + 1, minus whatever was spent
  assert.equal(ready(g.engine), 7 - spentNow);
});

clause(SALVAGE, "1:flipUp", "the picks work as for a hand-played Salvage: 2 or fewer items, only items from my discard pile", () => {
  const g = rsFaceDown();
  refused(flipRs(g, ["i1", "i2", "i3"]), "three items");
  refused(flipRs(g, ["xc"]), "a character");
  refused(flipRs(g, ["oi"]), "their item");
  refused(flipRs(g, ["pi"]), "an item in play");
  assert.equal(isFaceDown(g.engine, g.id("rs")), true, "still face-down after every refusal");
  assert.equal(ready(g.engine), 7, "nothing was paid by the refused attempts");
  flipRsFully(g, ["i3"]);
  assert.equal(zoneOf(g.engine, g.id("i3")), "hand", "control");
});

clause(SALVAGE, "1:flipUp", "'2 or fewer' includes 0 when flipping up too", () => {
  const g = rsFaceDown();
  flipRsFully(g, []);
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard");
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard");
});

clause(SALVAGE, "1:flipUp", "the face-down Salvage can pay for its own FLIP UP cost (CR 507.4b): with [E][E] spent and one Greed ready, Greed plus the Salvage itself pay the 2", () => {
  const g = rsBoard({ rs: "faceDown", icons: {}, extra: [...spent("elitism", 2), ...res({ greed: 1 })] });
  assert.equal(ready(g.engine), 2, "setup: one Greed and the face-down Salvage are ready");
  flipRsFully(g, ["i1"]);
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard");
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand");
});

clause(SALVAGE, "1:flipUp", "one resource short is refused: only the spent [E][E] and the face-down card itself (1 ready resource) for a cost of 2", () => {
  const g = rsBoard({ rs: "faceDown", icons: {}, extra: spent("elitism", 2) });
  assert.equal(ready(g.engine), 1);
  refused(flipRs(g, ["i1"]), "one resource short");
  assert.equal(isFaceDown(g.engine, g.id("rs")), true);
  assert.equal(ready(g.engine), 1, "nothing was paid");
});

clause(SALVAGE, "1:flipUp", "FLIP UP needs [E][E]: one [E] among many other resources is refused, so is none, two are accepted", () => {
  const one = rsFaceDown({ icons: { elitism: 1, greed: 6 } });
  refused(flipRs(one, ["i1"]), "one [E]");
  assert.equal(isFaceDown(one.engine, one.id("rs")), true);
  assert.equal(ready(one.engine), 8, "nothing was paid");
  const none = rsFaceDown({ icons: { greed: 7 } });
  refused(flipRs(none, ["i1"]), "no [E]");
  const two = rsFaceDown({ icons: { elitism: 2, greed: 2 } });
  flipRsFully(two, ["i1"]);
  assert.equal(zoneOf(two.engine, two.id("i1")), "hand", "control: two [E] are enough");
});

clause(SALVAGE, "1:flipUp", "the card's own Volition does not provide the [E], and the opponent's [E] do not count", () => {
  const onlyVolition = rsFaceDown({ icons: { greed: 6 } });
  refused(flipRs(onlyVolition, ["i1"]), "no [E] anywhere");
  const theirs = rsFaceDown({ icons: { elitism: 1, greed: 4 }, oppIcons: { elitism: 6 } });
  refused(flipRs(theirs, ["i1"]), "only one [E] of mine");
  assert.equal(isFaceDown(theirs.engine, theirs.id("rs")), true);
});

clause(SALVAGE, "1:flipUp", "'play a resource': a resource card from my hand enters play face-up and provides its icon", () => {
  const g = rsFaceDown();
  const greedBefore = g.engine.getThresholds(P1).greed ?? 0;
  flipRsFully(g, ["i1"], "hres");
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
  assert.equal(isFaceDown(g.engine, g.id("hres")), false, "an actual resource card is played face-up");
  assert.ok(playOf(g.engine, P1).includes(g.id("hres")), "playOf(g.engine, P1).includes(g.id(\"hres\"))");
  assert.equal(g.engine.getThresholds(P1).greed ?? 0, greedBefore + 1, "it provides its Greed icon");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "hand", "the other hand card stays");
});

clause(SALVAGE, "1:flipUp", "'play a resource': a card that is not a resource enters play face-down and provides Volition", () => {
  const g = rsFaceDown();
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  flipRsFully(g, ["i1"], "hchar");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "play");
  assert.equal(isFaceDown(g.engine, g.id("hchar")), true, "a non-resource can only be played face-down");
  assert.equal(g.engine.isResource(g.id("hchar")), true);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore - 1 + 1, "Salvage's own Volition left, the new face-down card's arrived");
});

clause(SALVAGE, "1:flipUp", "'play a resource' is not a 'may': the player cannot decline to play one when they have a card in hand", () => {
  const g = rsFaceDown();
  flipRs(g, ["i1"])();
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining to play a resource");
  assert.ok(pending(g.engine), "the demand to play a resource is still standing");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
});

clause(SALVAGE, "1:flipUp", "the resource to play is a Flip Up cost, so FLIP UP with no card in my hand to play is refused", () => {
  const g = rsBoard({ rs: "faceDown", noHand: true });
  assert.equal(handOf(g.engine, P1).length, 0, "control: my hand is empty");
  refused(flipRs(g, ["i1"]), "no card to play as the resource");
  assert.equal(isFaceDown(g.engine, g.id("rs")), true, "still face-down");
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard", "nothing happened");
});

clause(SALVAGE, "1:flipUp", "playing the resource this way does not use up my Develop Rule", () => {
  const g = rsFaceDown();
  flipRsFully(g, ["i1"]);
  assert.ok(developOffers(g.engine, P1).length > 0, "the Develop Rule offers something");
  developResource(g.engine, P1, g.id("hchar"), true);
  assert.equal(zoneOf(g.engine, g.id("hchar")), "play", "I can still develop a resource afterwards");
});

clause(SALVAGE, "1:flipUp", "'play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2, 605.1b)", () => holdResourceFace(() => {
  const g = rsFaceDown();
  flipRs(g, ["i1"])();
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  const asked = g.engine.state.pendingChoice !== undefined && g.engine.state.cards[g.id("hres")].zone === "hand";
  const faceDown = g.engine.state.cards[g.id("hres")].zone === "play" && g.engine.state.cards[g.id("hres")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(SALVAGE, "1:flipUp", "a tactic's FLIP UP can be done whenever a tactic could be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const g = rsFaceDown({ turn: 2, active: P2 });
  refused(flipRs(g, ["i1"]), "nothing to respond to yet");
  assert.equal(isFaceDown(g.engine, g.id("rs")), true);
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  flipRs(g, ["i1"])();
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand", "flipped up in response to the attack");
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard");
});

clause(SALVAGE, "1:flipUp", "a face-down Salvage that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = rsBoard({ rs: "faceDown", rsSpent: true });
  assert.equal(g.engine.state.cards[g.id("rs")].attachedTo, g.engine.state.players[P1].factionId, "setup: spent on my faction");
  flipRsFully(g, ["i1"]);
  assert.equal(zoneOf(g.engine, g.id("rs")), "discard", "flipped up and resolved");
  assert.equal(zoneOf(g.engine, g.id("i1")), "hand");
});

clause(SALVAGE, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = rsFaceDown({ extra: [{ key: "robber", def: graveRobber(), owner: P2, zone: "hand" }] });
  holdFlipUp(() => flipRs(g, ["i1"])());
  // the Flip Up extra cost (play a resource) is paid first: the pick is asked before the flip, and answering it flips the card
  if (pending(g.engine)) g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("hres")] } } as never);
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("i1")), "discard", "the effect has not happened yet");
});

clause(SALVAGE, "1:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not from my hand, not face-up)", () => {
  const theirs = rsFaceDown();
  refused(flipRs(theirs, ["i1"], P2), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("rs")), true);
  const inHand = rsBoard({ rs: "hand" });
  refused(flipRs(inHand, ["i1"]), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("rs")), "hand");
});

// =================================================================================
// Thorough Sanitization
// COST: Pick an item. -- EFFECT: Flip the item face-down under its owner's control.
// FLIP UP: 1 [E] and draw a card.
// Tactic, cost 1, [E].
// =================================================================================

const SANITIZE = "8e6f51ba-81da-4014-990b-953835ac6816";

/** A free tactic (id "destroy-item", pick "t"): destroys one picked item. Alias of the item killer with its own name. */
const itemDestroyer = (name = "Item Destroyer"): CardDefinition => itemKillerTactic(name);

interface TsOpts {
  ts?: "hand" | "faceDown";
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  tsSpent?: boolean;
  deck?: number;
  extra?: CardPlacement[];
}

/**
 * P1: ts (the Sanitization), mi (item), mi2 (item), mt (item with 3 tokens), gear (item attached to foe), stolen (item P2 owns, I control),
 * ally (character), mh (item in hand), a deck. P2: fi (item), lost (item I own, they control), place (location), foe (character),
 * fdItem (an item card face-down), fdChar (a character card face-down). Default P1's turn 1, [E] x4.
 */
function tsBoard(o: TsOpts = {}) {
  const where = o.ts ?? "hand";
  return devBoard(
    [
      {
        key: "ts",
        def: printing(SANITIZE),
        owner: P1,
        zone: where === "hand" ? "hand" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: where === "faceDown" && o.tsSpent ? "__factionA" : undefined
      },
      { key: "mi", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "mi2", def: item({ name: "My Other Item" }), owner: P1, zone: "play" },
      { key: "mt", def: item({ name: "My Tokened Item" }), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "stolen", def: item({ name: "Stolen Item" }), owner: P2, controller: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P1, zone: "play" },
      { key: "mh", def: item({ name: "Item In Hand" }), owner: P1, zone: "hand" },
      { key: "mx", def: item({ name: "Item In Discard" }), owner: P1, zone: "discard" },
      ...fillers("dk", o.deck ?? 3, P1, "deck"),
      { key: "fi", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "lost", def: item({ name: "Lost Item" }), owner: P1, controller: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P1, zone: "play", attachedToKey: "foe", counters: { token: 2 } },
      { key: "fdItem", def: item({ name: "Hidden Item" }), owner: P2, zone: "play", faceDown: true },
      { key: "fdChar", def: character({ name: "Hidden Character" }), owner: P2, zone: "play", faceDown: true },
      ...res(o.icons ?? { elitism: 4 }),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type TsGame = ReturnType<typeof tsBoard>;
const sanitize = (g: TsGame, key: string) => play(g.engine, P1, g.id("ts"), { selected: { grime: [g.id(key)] } });
const sanitizeAttempt = (g: TsGame, ...keys: string[]) => () => playRaw(g.engine, P1, g.id("ts"), { selected: { grime: keys.map((key) => g.id(key)) } });

// --- 0:ability  COST: Pick an item. EFFECT: Flip the item face-down under its owner's control. ---

clause(SANITIZE, "0:ability", "flips my own item face-down: it stays in play as a face-down card", () => {
  const g = tsBoard();
  sanitize(g, "mi");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("mi")), "play", "flipped, not destroyed");
  assert.equal(isFaceDown(g.engine, g.id("mi")), true);
  assert.equal(discardOf(g.engine, P1).includes(g.id("mi")), false);
});

clause(SANITIZE, "0:ability", "flips an opponent's item face-down too", () => {
  const g = tsBoard();
  sanitize(g, "fi");
  assert.equal(zoneOf(g.engine, g.id("fi")), "play");
  assert.equal(isFaceDown(g.engine, g.id("fi")), true);
  assert.equal(controllerOf(g.engine, g.id("fi")), P2, "it stays under its owner's control");
});

clause(SANITIZE, "0:ability", "the flipped item is a face-down resource: only a resource (CR 411.1), one Volition for its controller", () => {
  const g = tsBoard({ icons: { elitism: 2 } });
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  sanitize(g, "mi");
  assert.equal(g.engine.isResource(g.id("mi")), true);
  assert.deepEqual(g.engine.getCardTypes(g.id("mi")), ["resource"]);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore + 1);
});

clause(SANITIZE, "0:ability", "'under its owner's control': an item my opponent owns that I control ends up face-down under THEIR control", () => {
  const g = tsBoard();
  sanitize(g, "stolen");
  assert.equal(isFaceDown(g.engine, g.id("stolen")), true);
  assert.equal(controllerOf(g.engine, g.id("stolen")), P2);
  assert.ok(playOf(g.engine, P2).includes(g.id("stolen")), "playOf(g.engine, P2).includes(g.id(\"stolen\"))");
  assert.equal(playOf(g.engine, P1).includes(g.id("stolen")), false);
});

clause(SANITIZE, "0:ability", "...and an item I own that my opponent controls ends up face-down under MY control", () => {
  const g = tsBoard();
  sanitize(g, "lost");
  assert.equal(isFaceDown(g.engine, g.id("lost")), true);
  assert.equal(controllerOf(g.engine, g.id("lost")), P1);
  assert.ok(playOf(g.engine, P1).includes(g.id("lost")), "playOf(g.engine, P1).includes(g.id(\"lost\"))");
});

clause(SANITIZE, "0:ability", "the item is a new card when it flips: tokens on it are gone", () => {
  const g = tsBoard();
  sanitize(g, "mt");
  assert.equal(isFaceDown(g.engine, g.id("mt")), true);
  assert.equal(tokensOn(g.engine, g.id("mt")), 0);
});

clause(SANITIZE, "0:ability", "an item attached to a character (gear) flips too and is no longer attached; the character stays", () => {
  const g = tsBoard();
  sanitize(g, "gear");
  assert.equal(isFaceDown(g.engine, g.id("gear")), true);
  assert.equal(g.engine.state.cards[g.id("gear")].attachedTo, undefined);
  assert.equal(tokensOn(g.engine, g.id("gear")), 0);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(isFaceDown(g.engine, g.id("foe")), false);
});

clause(SANITIZE, "0:ability", "only the picked item flips: every other card is untouched", () => {
  const g = tsBoard();
  sanitize(g, "mi");
  for (const key of ["mi2", "mt", "stolen", "fi", "lost", "ally", "foe", "place", "gear"]) assert.equal(isFaceDown(g.engine, g.id(key)), false, `${key} stays face-up`);
});

clause(SANITIZE, "0:ability", "only ITEMS can be picked: a character, a location, a faction, a resource and a tactic are refused", () => {
  const g = tsBoard({ extra: [{ key: "res", def: resourceCard({ name: "Plain Resource" }), owner: P1, zone: "play" }] });
  refused(sanitizeAttempt(g, "ally"), "my character");
  refused(sanitizeAttempt(g, "foe"), "their character");
  refused(sanitizeAttempt(g, "place"), "a location");
  refused(sanitizeAttempt(g, "res"), "a resource");
  refused(() => playRaw(g.engine, P1, g.id("ts"), { selected: { grime: [g.engine.state.players[P2].factionId!] } }), "a faction");
  assert.equal(zoneOf(g.engine, g.id("ts")), "hand", "nothing was played");
  assert.equal(ready(g.engine), 5);
  sanitize(g, "mi");
  assert.equal(isFaceDown(g.engine, g.id("mi")), true, "control: an item is accepted");
});

clause(SANITIZE, "0:ability", "a face-down card is only a resource (CR 411.1), not an item: it cannot be picked even if it is an item card", () => {
  const g = tsBoard();
  refused(sanitizeAttempt(g, "fdItem"), "a face-down item card");
  refused(sanitizeAttempt(g, "fdChar"), "a face-down character card");
  assert.equal(zoneOf(g.engine, g.id("ts")), "hand");
  sanitize(g, "fi");
  assert.equal(isFaceDown(g.engine, g.id("fi")), true, "control");
});

clause(SANITIZE, "0:ability", "only items in play: an item in my hand and one in my discard pile are refused", () => {
  const g = tsBoard();
  refused(sanitizeAttempt(g, "mh"), "in my hand");
  refused(sanitizeAttempt(g, "mx"), "in my discard pile");
  assert.equal(zoneOf(g.engine, g.id("mh")), "hand");
  assert.equal(zoneOf(g.engine, g.id("mx")), "discard");
});

clause(SANITIZE, "0:ability", "exactly one item must be picked: none and two are refused", () => {
  const g = tsBoard();
  refused(sanitizeAttempt(g), "no pick");
  refused(sanitizeAttempt(g, "mi", "mi2"), "two items");
  assert.equal(zoneOf(g.engine, g.id("ts")), "hand");
  assert.equal(ready(g.engine), 4);
  sanitize(g, "mi2");
  assert.equal(isFaceDown(g.engine, g.id("mi2")), true, "control");
  assert.equal(isFaceDown(g.engine, g.id("mi")), false);
});

clause(SANITIZE, "0:ability", "it costs exactly 1 (flipping my opponent's item, so no new Volition of mine muddies the count)", () => {
  const g = tsBoard();
  const before = ready(g.engine);
  sanitize(g, "fi");
  assert.equal(before - ready(g.engine), 1);
  assert.equal(attachedCount(g.engine, P1), 1, "one resource was spent");
});

clause(SANITIZE, "0:ability", "it needs [E]: Greed alone is refused, no resources is refused, one [E] among others is enough", () => {
  const greed = tsBoard({ icons: { greed: 4 } });
  refused(sanitizeAttempt(greed, "mi"), "no [E]");
  const none = tsBoard({ icons: {} });
  refused(sanitizeAttempt(none, "mi"), "no resources");
  assert.equal(zoneOf(none.engine, none.id("ts")), "hand");
  const spentOnly = tsBoard({ icons: {}, extra: spent("elitism", 2) });
  refused(sanitizeAttempt(spentOnly, "mi"), "the [E] is spent: nothing ready to pay the 1");
  const one = tsBoard({ icons: { elitism: 1, greed: 2 } });
  sanitize(one, "mi");
  assert.equal(isFaceDown(one.engine, one.id("mi")), true);
});

clause(SANITIZE, "0:ability", "my opponent's [E] and Volition are not my [E]", () => {
  const theirs = tsBoard({ icons: { greed: 4 }, oppIcons: { elitism: 4 } });
  refused(sanitizeAttempt(theirs, "mi"), "their [E]");
  const vol = tsBoard({ icons: {}, extra: volition(4) });
  refused(sanitizeAttempt(vol, "mi"), "Volition");
});

clause(SANITIZE, "0:ability", "the pick is a cost: the item is still face-up while my opponent may respond, and flips when the tactic resolves", () => {
  const g = tsBoard();
  playRaw(g.engine, P1, g.id("ts"), { selected: { grime: [g.id("mi")] } });
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(isFaceDown(g.engine, g.id("mi")), false);
  assert.equal(zoneOf(g.engine, g.id("ts")), "deploying");
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("mi")), true);
});

clause(SANITIZE, "0:ability", "the tactic ends in its owner's discard pile", () => {
  const g = tsBoard();
  sanitize(g, "mi");
  assert.equal(zoneOf(g.engine, g.id("ts")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("ts")), "discardOf(g.engine, P1).includes(g.id(\"ts\"))");
});

clause(SANITIZE, "0:ability", "if the picked item is destroyed in response, the tactic still resolves and does nothing (CR 402.5a): the item stays in the discard pile, face-up", () => {
  const g = tsBoard({ extra: [{ key: "kill", def: itemDestroyer(), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("ts"), { selected: { grime: [g.id("fi")] } });
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("fi")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("fi")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("fi")), false);
  assert.equal(zoneOf(g.engine, g.id("ts")), "discard", "the tactic resolved");
});

clause(SANITIZE, "0:ability", "if the picked item is put into its owner's hand in response, it stays in the hand (CR 402.4): it is not flipped", () => {
  const g = tsBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("ts"), { selected: { grime: [g.id("mi")] } });
  respondWith(g.engine, P2, g.id("bounce"), { t: [g.id("mi")] });
  assert.equal(zoneOf(g.engine, g.id("mi")), "hand");
  assert.equal(isFaceDown(g.engine, g.id("mi")), false);
});

clause(SANITIZE, "0:ability", "being a tactic it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = tsBoard({ turn: 2, active: P2 });
  refused(sanitizeAttempt(g, "mi"), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("ts"), { grime: [g.id("fi")] });
  assert.equal(isFaceDown(g.engine, g.id("fi")), true);
});

clause(SANITIZE, "0:ability", "the flipped item is out of the battle/board effects like any resource: an item that gave +1/+1 stops giving it", () => {
  const buffGear = item({
    name: "Buff Gear",
    attachTo: "character",
    behavior: { abilities: [{ id: "buff", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] }
  });
  const g = tsBoard({ extra: [{ key: "buff", def: buffGear, owner: P1, zone: "play", attachedToKey: "ally" }] });
  assert.equal(g.engine.getStat(g.id("ally"), "strength"), 1 + 2);
  sanitize(g, "buff");
  assert.equal(g.engine.getStat(g.id("ally"), "strength"), 1, "the face-down card has no rules text");
});

// --- 1:flipUp  FLIP UP: 1 [E] and draw a card. -----------------------------------------------

const flipTs = (g: TsGame, pick?: string, player: PlayerId = P1) => () => flipUpRaw(g.engine, player, g.id("ts"), pick ? { grime: [g.id(pick)] } : {});
const tsFaceDown = (o: TsOpts = {}) => tsBoard({ ...o, ts: "faceDown" });

clause(SANITIZE, "1:flipUp", "a face-down Sanitization is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = tsFaceDown({ icons: { elitism: 2 } });
  assert.equal(g.engine.isResource(g.id("ts")), true);
  assert.equal(ready(g.engine), 3);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(SANITIZE, "1:flipUp", "flipping it up resolves it as the tactic: the picked item flips face-down and Sanitization ends in my discard pile", () => {
  const g = tsFaceDown();
  flipTs(g, "fi")();
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isFaceDown(g.engine, g.id("fi")), true);
  assert.equal(zoneOf(g.engine, g.id("ts")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("ts")), false);
});

clause(SANITIZE, "1:flipUp", "'and draw a card': exactly one card is drawn from my deck", () => {
  const g = tsFaceDown({ deck: 3 });
  const top = deckOf(g.engine, P1)[0];
  const handBefore = handOf(g.engine, P1).length;
  flipTs(g, "fi")();
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P1).length, handBefore + 1, "one card drawn");
  assert.equal(zoneOf(g.engine, top), "hand", "the top card of my deck");
  assert.equal(deckOf(g.engine, P1).length, 2);
});

clause(SANITIZE, "1:flipUp", "the card is drawn by me, not by my opponent", () => {
  const g = tsFaceDown({ deck: 3, extra: fillers("od", 3, P2, "deck") });
  const theirHand = handOf(g.engine, P2).length;
  const theirDeck = deckOf(g.engine, P2).length;
  flipTs(g, "fi")();
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, theirHand);
  assert.equal(deckOf(g.engine, P2).length, theirDeck);
});

clause(SANITIZE, "1:flipUp", "FLIP UP pays 1: the printed cost (also 1) is not paid on top of it - at most one resource is spent", () => {
  const g = tsFaceDown({ icons: { elitism: 4 } });
  const before = ready(g.engine);
  assert.equal(before, 5);
  flipTs(g, "fi")();
  resolvePendingResponses(g.engine);
  const spentNow = attachedCount(g.engine, P1);
  assert.ok(spentNow <= 1, `at most one resource is spent (the Sanitization may pay for itself), got ${spentNow}`);
  // the Sanitization left the pool (-1), the flipped opposing item is THEIR resource, and `spentNow` of mine were spent
  assert.equal(ready(g.engine), before - 1 - spentNow);
});

clause(SANITIZE, "1:flipUp", "the face-down Sanitization can pay for its own FLIP UP cost (CR 507.4b): with every other resource spent it still flips up", () => {
  const g = tsBoard({ ts: "faceDown", icons: {}, extra: spent("elitism", 2) });
  assert.equal(ready(g.engine), 1, "only the face-down Sanitization is ready");
  flipTs(g, "fi")();
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ts")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("fi")), true);
});

clause(SANITIZE, "1:flipUp", "FLIP UP needs [E]: plenty of Greed and no [E] is refused (the card stays face-down), one [E] is accepted", () => {
  const none = tsFaceDown({ icons: { greed: 5 } });
  refused(flipTs(none, "fi"), "no [E]");
  assert.equal(isFaceDown(none.engine, none.id("ts")), true);
  assert.equal(ready(none.engine), 6, "nothing was paid");
  const one = tsFaceDown({ icons: { elitism: 1, greed: 2 } });
  flipTs(one, "fi")();
  resolvePendingResponses(one.engine);
  assert.equal(isFaceDown(one.engine, one.id("fi")), true, "control: one [E] is enough");
});

clause(SANITIZE, "1:flipUp", "the card's own Volition does not provide the [E], and the opponent's [E] do not count", () => {
  const onlyVolition = tsFaceDown({ icons: {} });
  refused(flipTs(onlyVolition, "fi"), "the only resource is its own Volition");
  const theirs = tsFaceDown({ icons: { greed: 4 }, oppIcons: { elitism: 4 } });
  refused(flipTs(theirs, "fi"), "their [E]");
  assert.equal(isFaceDown(theirs.engine, theirs.id("ts")), true);
});

clause(SANITIZE, "1:flipUp", "a spent [E] still meets the threshold while another ready resource pays the 1", () => {
  const g = tsBoard({ ts: "faceDown", icons: { greed: 1 }, extra: spent("elitism", 1) });
  flipTs(g, "fi")();
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ts")), "discard", "a spent [E] meets the threshold (CR 405.6)");
});

clause(SANITIZE, "1:flipUp", "the regular extra cost applies: one item must be picked, and only an item", () => {
  const g = tsFaceDown();
  refused(flipTs(g), "no pick");
  refused(flipTs(g, "ally"), "a character");
  refused(flipTs(g, "place"), "a location");
  refused(flipTs(g, "fdItem"), "a face-down card");
  refused(flipTs(g, "mh"), "an item in my hand");
  refused(() => flipUpRaw(g.engine, P1, g.id("ts"), { grime: [g.id("mi"), g.id("mi2")] }), "two items");
  assert.equal(isFaceDown(g.engine, g.id("ts")), true, "still face-down after every refusal");
  assert.equal(ready(g.engine), 5, "nothing was paid");
  flipTs(g, "mi")();
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("mi")), true, "control: an item is accepted");
});

clause(SANITIZE, "1:flipUp", "'draw a card' with an empty deck: there is nothing to draw, I do not lose (CR 306.2), and the flip up still works", () => {
  const g = tsFaceDown({ deck: 0 });
  assert.equal(deckOf(g.engine, P1).length, 0);
  const handBefore = handOf(g.engine, P1).length;
  flipTs(g, "fi")();
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P1).length, handBefore);
  assert.equal(isFaceDown(g.engine, g.id("fi")), true);
  assert.equal(g.engine.state.winner, undefined, "no one lost");
});

clause(SANITIZE, "1:flipUp", "a tactic's FLIP UP can be done whenever a tactic could be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const g = tsFaceDown({ turn: 2, active: P2 });
  refused(flipTs(g, "fi"), "nothing to respond to yet");
  assert.equal(isFaceDown(g.engine, g.id("ts")), true);
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  flipTs(g, "fi")();
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("fi")), true, "flipped up in response to the attack");
  assert.equal(zoneOf(g.engine, g.id("ts")), "discard");
});

clause(SANITIZE, "1:flipUp", "a face-down Sanitization that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = tsBoard({ ts: "faceDown", tsSpent: true });
  assert.equal(g.engine.state.cards[g.id("ts")].attachedTo, g.engine.state.players[P1].factionId, "setup: spent on my faction");
  flipTs(g, "fi")();
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ts")), "discard", "flipped up and resolved");
});

clause(SANITIZE, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = tsFaceDown();
  holdFlipUp(() => flipTs(g, "fi")());
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(isFaceDown(g.engine, g.id("fi")), false, "the effect has not happened yet");
});

clause(SANITIZE, "1:flipUp", "it can only be flipped by its controller, and only while it is face-down in play", () => {
  const theirs = tsFaceDown({ oppIcons: { elitism: 4 } });
  refused(flipTs(theirs, "fi", P2), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("ts")), true);
  const inHand = tsBoard({ ts: "hand" });
  refused(flipTs(inHand, "fi"), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("ts")), "hand");
});

// =================================================================================
// Time Traveler Tourist Trap
// ENSNARE -- COST: Pay 1 or destroy a Micromajig token you control. -- EFFECT: Put a token on this card.
// MICROMAJIG APOCALYPSE: [E][E][E][E][E][E] -- COST: Use this only if there are at least 20 tokens on this card.
//   Destroy this card. -- EFFECT: Put X Micromajig tokens into play under your control, where X is the number
//   of cards in your opponent's deck.
// Location, cost 2, [E], structure 12.
// =================================================================================

const TRAP = "95faefae-3b2a-454b-a2a5-f10544095ff8";

/** A Micromajig token as the engine's own token cards define it (name Micromajig, character, majig subtype, 1/1/3). */
const microDef = (): CardDefinition => character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3, set: "Token" });

interface TrapOpts {
  trap?: "play" | "hand" | "discard" | "faceDown";
  tokens?: number;
  icons?: Icons;
  oppIcons?: Icons;
  myMicros?: number;
  foeMicros?: number;
  otherTokens?: number;
  oppDeck?: number;
  myDeck?: number;
  trapOwner?: PlayerId;
  turn?: number;
  active?: PlayerId;
  random?: () => number;
  extra?: CardPlacement[];
}

/**
 * P1: the Trap (key "trap" with `tokens` tokens), Micromajig tokens mm0.. (mine), ordinary character ally, resources (default none).
 * P2: Micromajig tokens fm0.., a character foe, oppDeck cards in their deck (default 6), hand card oh. Default P1's turn 1.
 */
function trapBoard(o: TrapOpts = {}) {
  const where = o.trap ?? "play";
  const micros = (prefix: string, n: number, owner: PlayerId): CardPlacement[] =>
    Array.from({ length: n }, (_, index) => ({ key: `${prefix}${index}`, def: microDef(), owner, zone: "play" as const }));
  const board = devBoard(
    [
      {
        key: "trap",
        def: printing(TRAP),
        owner: o.trapOwner ?? P1,
        controller: P1,
        zone: where === "hand" ? "hand" : where === "discard" ? "discard" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        counters: o.tokens ? { token: o.tokens } : undefined
      },
      ...micros("mm", o.myMicros ?? 0, P1),
      ...micros("fm", o.foeMicros ?? 0, P2),
      ...(o.otherTokens ? [{ key: "other", def: character({ name: "Other Token", subtype: ["spiderling"], set: "Token" }), owner: P1, zone: "play" as const }] : []),
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "oh", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" },
      ...fillers("od", o.oppDeck ?? 6, P2, "deck"),
      ...fillers("md", o.myDeck ?? 4, P1, "deck"),
      ...res(o.icons ?? {}),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active, random: o.random }
  );
  // The stand-in Micromajigs count as real tokens for the cost selector (it asks for `isToken`).
  for (const [prefix, n] of [["mm", o.myMicros ?? 0], ["fm", o.foeMicros ?? 0]] as const) {
    for (let i = 0; i < n; i++) board.engine.state.cards[board.id(`${prefix}${i}`)].isToken = true;
  }
  return board;
}

type TrapGame = ReturnType<typeof trapBoard>;
const ensnare = (g: TrapGame) => activate(g.engine, P1, g.id("trap"), "ensnare");
const ensnareAttempt = (g: TrapGame, player: PlayerId = P1) => () => actRaw(g.engine, player, g.id("trap"), "ensnare");
const apocalypse = (g: TrapGame) => activate(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
const apocalypseAttempt = (g: TrapGame, player: PlayerId = P1) => () => actRaw(g.engine, player, g.id("trap"), "micromajig-apocalypse");
const micromajigs = (g: TrapGame, player: PlayerId): CardInstanceId[] =>
  playOf(g.engine, player).filter((cardId) => g.engine.getDefinition(cardId).name === "Micromajig" && g.engine.state.cards[cardId].controllerId === player);

// --- 0:ability:ensnare  COST: Pay 1 or destroy a Micromajig token you control. EFFECT: Put a token on this card. ---

clause(TRAP, "0:ability:ensnare", "paying 1 puts a token on the Trap: exactly one resource is spent and exactly one token is added", () => {
  const g = trapBoard({ icons: { greed: 3 } });
  const before = ready(g.engine);
  ensnare(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(before - ready(g.engine), 1, "paid 1");
  assert.equal(tokensOn(g.engine, g.id("trap")), 1);
});

clause(TRAP, "0:ability:ensnare", "any resource pays the 1: it needs no [E]", () => {
  const g = trapBoard({ icons: { rage: 1 } });
  ensnare(g);
  assert.equal(tokensOn(g.engine, g.id("trap")), 1);
  assert.equal(ready(g.engine), 0);
});

clause(TRAP, "0:ability:ensnare", "it can be used again and again: four uses cost 4 and put four tokens on the Trap", () => {
  const g = trapBoard({ icons: { greed: 5 } });
  for (let i = 0; i < 4; i++) ensnare(g);
  assert.equal(tokensOn(g.engine, g.id("trap")), 4);
  assert.equal(ready(g.engine), 1);
});

clause(TRAP, "0:ability:ensnare", "tokens already on the Trap stay: 5 tokens and one more makes 6", () => {
  const g = trapBoard({ tokens: 5, icons: { greed: 1 } });
  ensnare(g);
  assert.equal(tokensOn(g.engine, g.id("trap")), 6);
});

clause(TRAP, "0:ability:ensnare", "the token goes on the Trap itself and on no other card", () => {
  const g = trapBoard({ icons: { greed: 1 }, myMicros: 1 });
  ensnare(g);
  assert.equal(tokensOn(g.engine, g.id("ally")), 0);
  assert.equal(tokensOn(g.engine, g.id("foe")), 0);
  assert.equal(tokensOn(g.engine, g.id("mm0")), 0);
});

clause(TRAP, "0:ability:ensnare", "with nothing to pay with (no ready resource, no Micromajig token) it cannot be used", () => {
  const g = trapBoard({ icons: {} });
  refused(ensnareAttempt(g), "no resources, no token");
  assert.equal(tokensOn(g.engine, g.id("trap")), 0);
  const spentOnly = trapBoard({ icons: {}, extra: spent("greed", 2) });
  refused(ensnareAttempt(spentOnly), "all resources spent");
  assert.equal(tokensOn(spentOnly.engine, spentOnly.id("trap")), 0);
});

clause(TRAP, "0:ability:ensnare", "its cost is a cost: when it is refused, nothing is paid or destroyed", () => {
  const g = trapBoard({ icons: {}, otherTokens: 1, foeMicros: 1 });
  refused(ensnareAttempt(g), "an ordinary token and the opponent's Micromajig do not pay");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(zoneOf(g.engine, g.id("fm0")), "play");
});

clause(TRAP, "0:ability:ensnare", "with no ready resource, I can pay by destroying a Micromajig token I control: the token is destroyed, a token goes on the Trap and no resource is spent", () => {
  const g = trapBoard({ icons: {}, myMicros: 1 });
  ensnare(g);
  assert.equal(tokensOn(g.engine, g.id("trap")), 1);
  assert.notEqual(g.engine.state.cards[g.id("mm0")]?.zone, "play", "the Micromajig token was destroyed (a token vanishes when it leaves play)");
});

clause(TRAP, "0:ability:ensnare", "'Pay 1 OR destroy a Micromajig token': with resources AND a token available I choose which way to pay (either way works, and only one is paid)", () => holdCostChoices(() => {
  const optionFor = (g: TrapGame, label: RegExp): number => {
    const pc = pending(g.engine) as unknown as { kind: string; playerId: string; options: Array<{ label?: string }> };
    assert.ok(pc, "the choice between paying 1 and destroying the token is mine to make: it should be offered to me");
    assert.equal(pc.kind, "chooserSelectsOption");
    assert.equal(pc.playerId, P1);
    assert.equal(pc.options.length, 2, "two ways to pay");
    const index = pc.options.findIndex((o) => label.test(o.label ?? ""));
    assert.ok(index >= 0, "the options are labelled for the player");
    return index;
  };
  const viaToken = trapBoard({ icons: { greed: 2 }, myMicros: 1 });
  actRaw(viaToken.engine, P1, viaToken.id("trap"), "ensnare");
  assert.equal(tokensOn(viaToken.engine, viaToken.id("trap")), 0, "nothing is paid before I choose");
  assert.equal(zoneOf(viaToken.engine, viaToken.id("mm0")), "play", "nothing is destroyed before I choose");
  answerPending(viaToken.engine, "chooserSelectsOption", { index: optionFor(viaToken, /destroy/i) });
  resolvePendingResponses(viaToken.engine);
  assert.equal(pending(viaToken.engine), undefined);
  assert.equal(tokensOn(viaToken.engine, viaToken.id("trap")), 1);
  assert.notEqual(viaToken.engine.state.cards[viaToken.id("mm0")]?.zone, "play", "I chose to destroy the token");
  assert.equal(ready(viaToken.engine), 2, "and no resource was spent");

  const viaPay = trapBoard({ icons: { greed: 2 }, myMicros: 1 });
  actRaw(viaPay.engine, P1, viaPay.id("trap"), "ensnare");
  answerPending(viaPay.engine, "chooserSelectsOption", { index: optionFor(viaPay, /pay/i) });
  resolvePendingResponses(viaPay.engine);
  assert.equal(pending(viaPay.engine), undefined);
  assert.equal(tokensOn(viaPay.engine, viaPay.id("trap")), 1);
  assert.equal(zoneOf(viaPay.engine, viaPay.id("mm0")), "play", "I chose to pay, so the token stays");
  assert.equal(ready(viaPay.engine), 1, "one resource was spent");
}));

clause(TRAP, "0:ability:ensnare", "'destroy a Micromajig token you control': with several tokens (and nothing to pay with) I choose WHICH one is destroyed (tokens that carry both subtypes, so the destroy branch can see them)", () => holdCostChoices(() => {
  const both = (): CardDefinition => character({ name: "Micromajig", subtype: ["majig", "micromajig"], strength: 1, life: 1, speed: 3, set: "Token" });
  for (const keep of ["t1", "t2"]) {
    const gone = keep === "t1" ? "t2" : "t1";
    const g = trapBoard({
      icons: {},
      extra: [
        { key: "t1", def: both(), owner: P1, zone: "play" },
        { key: "t2", def: both(), owner: P1, zone: "play" }
      ]
    });
    for (const k of ["t1", "t2"]) g.engine.state.cards[g.id(k)].isToken = true;
    actRaw(g.engine, P1, g.id("trap"), "ensnare");
    const pc = pending(g.engine) as unknown as { kind: string; playerId: string };
    assert.ok(pc, "the token to destroy is my pick, not a random one");
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    assert.equal(zoneOf(g.engine, g.id("t1")), "play", "nothing is destroyed before I pick");
    assert.equal(zoneOf(g.engine, g.id("t2")), "play");
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(gone)] });
    resolvePendingResponses(g.engine);
    assert.equal(pending(g.engine), undefined);
    assert.equal(tokensOn(g.engine, g.id("trap")), 1);
    assert.notEqual(g.engine.state.cards[g.id(gone)]?.zone, "play", `the token I picked (${gone}) was destroyed`);
    assert.equal(zoneOf(g.engine, g.id(keep)), "play", `the other token (${keep}) survives`);
  }
}));

clause(TRAP, "0:ability:ensnare", "'a Micromajig token YOU control': with nothing to pay with, my opponent's token cannot pay the cost (tokens that carry both subtypes, so the destroy branch can see them)", () => {
  const both = (): CardDefinition => character({ name: "Micromajig", subtype: ["majig", "micromajig"], strength: 1, life: 1, speed: 3, set: "Token" });
  const theirs = trapBoard({ icons: {}, extra: [{ key: "ot", def: both(), owner: P2, zone: "play" }] });
  theirs.engine.state.cards[theirs.id("ot")].isToken = true;
  refused(ensnareAttempt(theirs), "only my opponent's token is in play");
  assert.equal(zoneOf(theirs.engine, theirs.id("ot")), "play");
  assert.equal(tokensOn(theirs.engine, theirs.id("trap")), 0);
  const mine = trapBoard({ icons: {}, extra: [{ key: "mt", def: both(), owner: P1, zone: "play" }, { key: "ot", def: both(), owner: P2, zone: "play" }] });
  for (const k of ["mt", "ot"]) mine.engine.state.cards[mine.id(k)].isToken = true;
  ensnare(mine);
  assert.equal(tokensOn(mine.engine, mine.id("trap")), 1);
  assert.notEqual(mine.engine.state.cards[mine.id("mt")]?.zone, "play", "my token was destroyed (a token vanishes when it leaves play)");
  assert.equal(zoneOf(mine.engine, mine.id("ot")), "play", "their token was not");
});

clause(TRAP, "0:ability:ensnare", "only the Trap's controller can use it", () => {
  const g = trapBoard({ icons: { greed: 2 }, turn: 1, active: P1, extra: [...res({ greed: 2 }, P2), { key: "atk", def: character({ name: "My Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(ensnareAttempt(g, P2), "the Trap is mine", /control|owner|yours|your/i);
  assert.equal(tokensOn(g.engine, g.id("trap")), 0);
});

clause(TRAP, "0:ability:ensnare", "an ability: it can be used in response on my opponent's turn", () => {
  const g = trapBoard({ icons: { greed: 2 }, turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("trap"), "ensnare");
  resolvePendingResponses(g.engine);
  assert.equal(tokensOn(g.engine, g.id("trap")), 1);
});

clause(TRAP, "0:ability:ensnare", "it works from play only: a Trap in my hand or discard pile cannot be used", () => {
  for (const trap of ["hand", "discard"] as const) {
    const g = trapBoard({ trap, icons: { greed: 2 } });
    refused(ensnareAttempt(g), `the Trap is in my ${trap}`, /Activated ability not found|not in play|play/i);
    assert.equal(ready(g.engine), 2);
  }
});

clause(TRAP, "0:ability:ensnare", "a face-down Trap is only a resource with no rules text: ENSNARE cannot be used", () => {
  const g = trapBoard({ trap: "faceDown", icons: { greed: 2 } });
  refused(ensnareAttempt(g), "face-down", /Activated ability not found|face-down|rules text/i);
});

clause(TRAP, "0:ability:ensnare", "a Trap I stole is mine to use: I pay, and the token goes on it", () => {
  const g = trapBoard({ trapOwner: P2, icons: { greed: 2 } });
  assert.equal(controllerOf(g.engine, g.id("trap")), P1);
  ensnare(g);
  assert.equal(tokensOn(g.engine, g.id("trap")), 1);
  assert.equal(ready(g.engine), 1);
});

// --- 1:ability:micromajig-apocalypse -------------------------------------------------------

clause(TRAP, "1:ability:micromajig-apocalypse", "with 20 tokens and [E] x6: the Trap is destroyed and X Micromajig tokens (X = cards in my opponent's deck) enter play under my control", () => {
  const g = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: 6 });
  apocalypse(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("trap")), "discard", "destroyed as the cost");
  assert.equal(micromajigs(g, P1).length, 6);
  assert.equal(micromajigs(g, P2).length, 0, "none for my opponent");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "X is the size of my opponent's deck: 3 cards make 3 tokens, 11 cards make 11", () => {
  for (const n of [3, 11]) {
    const g = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: n });
    apocalypse(g);
    assert.equal(micromajigs(g, P1).length, n, `${n} cards`);
  }
});

clause(TRAP, "1:ability:micromajig-apocalypse", "an empty opposing deck makes X = 0: no tokens, and the Trap is still destroyed", () => {
  const g = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: 0 });
  apocalypse(g);
  assert.equal(micromajigs(g, P1).length, 0);
  assert.equal(zoneOf(g.engine, g.id("trap")), "discard");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "X counts my OPPONENT's deck only: my own deck size, their hand and their discard pile do not count", () => {
  const g = trapBoard({
    tokens: 20,
    icons: { elitism: 6 },
    oppDeck: 4,
    myDeck: 9,
    extra: [
      { key: "oh2", def: character({ name: "More Hand" }), owner: P2, zone: "hand" },
      { key: "ox", def: character({ name: "Their Discard" }), owner: P2, zone: "discard" },
      { key: "ox2", def: character({ name: "Their Discard Two" }), owner: P2, zone: "discard" }
    ]
  });
  apocalypse(g);
  assert.equal(micromajigs(g, P1).length, 4);
});

clause(TRAP, "1:ability:micromajig-apocalypse", "the tokens are proper Micromajigs: characters named Micromajig with the majig subtype, 1 strength / 1 life / 3 speed", () => {
  const g = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: 2 });
  apocalypse(g);
  const tokens = micromajigs(g, P1);
  assert.equal(tokens.length, 2);
  for (const token of tokens) {
    const def = g.engine.getDefinition(token);
    assert.equal(def.name, "Micromajig");
    assert.equal(def.type, "character");
    assert.ok(def.subtype.includes("majig"), "the majig subtype (CR 409.3c)");
    assert.equal(g.engine.getStat(token, "strength"), 1);
    assert.equal(g.engine.getStat(token, "life"), 1);
    assert.equal(g.engine.getStat(token, "speed"), 3);
    assert.equal(zoneOf(g.engine, token), "play");
    assert.equal(g.engine.state.cards[token].ownerId, P1, "I own them (I made them)");
  }
});

clause(TRAP, "1:ability:micromajig-apocalypse", "the tokens are Gearsmith cards (CR 409.3c: a Micromajig is a Gearsmith character)", () => {
  const g = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: 2 });
  apocalypse(g);
  const tokens = micromajigs(g, P1);
  assert.equal(tokens.length, 2);
  for (const token of tokens) assert.equal(g.engine.getDefinition(token).trade, "gearsmith");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "'at least 20': 19 tokens are refused, 20 and 25 are accepted", () => {
  const nineteen = trapBoard({ tokens: 19, icons: { elitism: 6 } });
  refused(apocalypseAttempt(nineteen), "19 tokens");
  assert.equal(zoneOf(nineteen.engine, nineteen.id("trap")), "play", "nothing was destroyed");
  assert.equal(micromajigs(nineteen, P1).length, 0);
  const twenty = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: 2 });
  apocalypse(twenty);
  assert.equal(micromajigs(twenty, P1).length, 2, "control: 20 tokens work");
  const more = trapBoard({ tokens: 25, icons: { elitism: 6 }, oppDeck: 2 });
  apocalypse(more);
  assert.equal(micromajigs(more, P1).length, 2, "25 tokens work too");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "with no tokens at all it is refused", () => {
  const g = trapBoard({ tokens: 0, icons: { elitism: 6 } });
  refused(apocalypseAttempt(g), "no tokens");
  assert.equal(zoneOf(g.engine, g.id("trap")), "play");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "only tokens ON THE TRAP count: 20 tokens elsewhere do not enable it", () => {
  const g = trapBoard({ tokens: 3, icons: { elitism: 6 }, extra: [{ key: "pile", def: character({ name: "Token Pile" }), owner: P1, zone: "play", counters: { token: 30 } }] });
  refused(apocalypseAttempt(g), "the tokens are on another card");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "it needs [E][E][E][E][E][E]: five [E] among plenty of other resources is refused, six are accepted", () => {
  const five = trapBoard({ tokens: 20, icons: { elitism: 5, greed: 6 } });
  refused(apocalypseAttempt(five), "five [E]");
  assert.equal(zoneOf(five.engine, five.id("trap")), "play");
  assert.equal(tokensOn(five.engine, five.id("trap")), 20);
  const six = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: 1 });
  apocalypse(six);
  assert.equal(micromajigs(six, P1).length, 1, "control: six [E] are enough");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "the six icons must be [E]: six Greed or six Volition do not work, and neither do my opponent's [E]", () => {
  const greed = trapBoard({ tokens: 20, icons: { greed: 8 } });
  refused(apocalypseAttempt(greed), "no [E]");
  const vol = trapBoard({ tokens: 20, icons: {}, extra: volition(8) });
  refused(apocalypseAttempt(vol), "Volition");
  const theirs = trapBoard({ tokens: 20, icons: { elitism: 2 }, oppIcons: { elitism: 8 } });
  refused(apocalypseAttempt(theirs), "their [E]");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "spent [E] still count towards the six (icons are never spent, CR 405.6), and no resource is paid", () => {
  const g = trapBoard({ tokens: 20, icons: { greed: 1 }, oppDeck: 1, extra: spent("elitism", 6) });
  const before = ready(g.engine);
  apocalypse(g);
  assert.equal(micromajigs(g, P1).length, 1);
  assert.equal(ready(g.engine), before, "the cost is only 'destroy this card': no resource is paid");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "the Trap's destruction is the cost: it leaves play when I use it, before my opponent can respond", () => {
  const g = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: 3 });
  actRaw(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("trap")), "discard", "the cost was paid when I used it");
  assert.equal(micromajigs(g, P1).length, 0, "the tokens have not been created yet");
  resolvePendingResponses(g.engine);
  assert.equal(micromajigs(g, P1).length, 3);
});

clause(TRAP, "1:ability:micromajig-apocalypse", "X is counted when the effect resolves: if my opponent draws a card in response, one fewer token is made", () => {
  const draw1 = tactic({ name: "Quick Draw", cost: 0, behavior: { abilities: [{ id: "qd", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const g = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: 5, extra: [{ key: "qd", def: draw1, owner: P2, zone: "hand" }] });
  actRaw(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
  respondWith(g.engine, P2, g.id("qd"));
  assert.equal(deckOf(g.engine, P2).length, 4, "setup: they drew");
  assert.equal(micromajigs(g, P1).length, 4);
});

clause(TRAP, "1:ability:micromajig-apocalypse", "the tokens enter under the control of the player who used it: a Trap I stole makes MY tokens", () => {
  const g = trapBoard({ trapOwner: P2, tokens: 20, icons: { elitism: 6 }, oppDeck: 2 });
  apocalypse(g);
  assert.equal(micromajigs(g, P1).length, 2);
  assert.equal(micromajigs(g, P2).length, 0);
  assert.ok(discardOf(g.engine, P2).includes(g.id("trap")), "the Trap goes to its owner's discard pile");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "only its controller can use it", () => {
  const g = trapBoard({ tokens: 20, icons: { elitism: 6 }, turn: 1, active: P1, extra: [...res({ elitism: 6 }, P2), { key: "atk", def: character({ name: "My Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  refused(apocalypseAttempt(g, P2), "the Trap is mine", /control|owner|yours|your/i);
  assert.equal(zoneOf(g.engine, g.id("trap")), "play");
});

clause(TRAP, "1:ability:micromajig-apocalypse", "it works from play only", () => {
  for (const trap of ["hand", "discard"] as const) {
    const g = trapBoard({ trap, tokens: 20, icons: { elitism: 6 } });
    refused(apocalypseAttempt(g), `the Trap is in my ${trap}`, /Activated ability not found|not in play|play/i);
  }
});

clause(TRAP, "1:ability:micromajig-apocalypse", "a face-down Trap has no rules text: MICROMAJIG APOCALYPSE cannot be used", () => {
  const g = trapBoard({ trap: "faceDown", tokens: 20, icons: { elitism: 6 } });
  refused(apocalypseAttempt(g), "face-down", /Activated ability not found|face-down|rules text/i);
});

clause(TRAP, "1:ability:micromajig-apocalypse", "an ability: it can be used in response on my opponent's turn", () => {
  const g = trapBoard({ tokens: 20, icons: { elitism: 6 }, oppDeck: 2, turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  actRaw(g.engine, P1, g.id("trap"), "micromajig-apocalypse");
  resolvePendingResponses(g.engine);
  assert.equal(micromajigs(g, P1).length, 2);
});

clause(TRAP, "1:ability:micromajig-apocalypse", "ENSNARE builds up to it: twenty uses (paying 1 each) make the 20 tokens, and then it can be used", () => {
  const g = trapBoard({ icons: { elitism: 6, greed: 20 }, oppDeck: 2 });
  for (let i = 0; i < 19; i++) ensnare(g);
  refused(apocalypseAttempt(g), "19 tokens");
  ensnare(g);
  assert.equal(tokensOn(g.engine, g.id("trap")), 20);
  apocalypse(g);
  assert.equal(micromajigs(g, P1).length, 2);
});

// =================================================================================
// Ass
// At the end of your turn, your opponent picks a character they control and own if they can. If they do,
// take control of that character.
// At the end of your turn, your opponent takes control of this card.
// Item, cost 4, [D][D].
// =================================================================================

const ASS = "e3fae5c4-c6ed-4c28-af91-2d85d11fceb1";

interface AssOpts {
  ass?: "play" | "hand" | "faceDown" | "discard";
  assOwner?: PlayerId;
  assController?: PlayerId;
  noFoes?: boolean;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * P1: ass, ally (character). P2: f1, f2 (characters they own and control), lent (P1 owns, P2 controls), fd (face-down character), thing (item).
 * P1 also controls taken (P2 owns it). Default: P1's turn 1.
 */
function assBoard(o: AssOpts = {}) {
  const where = o.ass ?? "play";
  return devBoard(
    [
      { key: "ass", def: printing(ASS), owner: o.assOwner ?? P1, controller: o.assController, zone: where === "play" || where === "faceDown" ? "play" : where, faceDown: where === "faceDown" ? true : undefined },
      { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P1, zone: "play" },
      ...(o.noFoes
        ? []
        : [
            { key: "f1", def: character({ name: "Foe One", life: 5 }), owner: P2, zone: "play" as const },
            { key: "f2", def: character({ name: "Foe Two", life: 5 }), owner: P2, zone: "play" as const }
          ]),
      { key: "lent", def: character({ name: "Lent To Foe", life: 5 }), owner: P1, controller: P2, zone: "play" },
      { key: "taken", def: character({ name: "Taken From Foe", life: 5 }), owner: P2, controller: P1, zone: "play" },
      { key: "fd", def: character({ name: "Hidden", life: 5 }), owner: P2, zone: "play", faceDown: true },
      { key: "thing", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type AssGame = ReturnType<typeof assBoard>;

/**
 * Ends `player`'s turn and answers what follows: the order of the two Ass triggers (`first` goes first), and the opponent's pick
 * (`pick` = a key, or none). Returns the pending choices that were answered.
 */
function assTurnEnds(g: AssGame, o: { player?: PlayerId; first?: "borrowed-body" | "changing-hands"; pick?: string } = {}): string[] {
  const seen: string[] = [];
  endTurn(g.engine, o.player ?? P1);
  drain(g.engine, (pc) => {
    seen.push(`${pc.kind}:${pc.playerId}`);
    if (pc.kind === "orderTriggers") {
      const triggers = pc.triggers as Array<{ sourceId: string; abilityId: string }>;
      const want = triggers.find((trigger) => trigger.abilityId === o.first) ?? triggers[0];
      return { kind: "orderTriggers", next: want };
    }
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: o.pick ? [g.id(o.pick)] : [] };
    throw new Error(`unexpected pending choice ${pc.kind}`);
  });
  return seen;
}

// --- 0:rule  At the end of your turn, your opponent picks a character they control and own if they can. If they do, take control of that character. ---

clause(ASS, "0:rule", "at the end of my turn my opponent picks one of their characters and I take control of it", () => {
  const g = assBoard();
  const seen = assTurnEnds(g, { pick: "f1" });
  assert.ok(seen.includes("chooserSelectsTarget:p2"), "the PICK is made by my opponent");
  assert.equal(controllerOf(g.engine, g.id("f1")), P1, "I control it now");
  assert.ok(playOf(g.engine, P1).includes(g.id("f1")), "it is in my play area");
  assert.equal(playOf(g.engine, P2).includes(g.id("f1")), false);
  assert.equal(g.engine.state.cards[g.id("f1")].ownerId, P2, "ownership never changes");
});

clause(ASS, "0:rule", "the pick is theirs to make: either of their characters can be picked", () => {
  const g = assBoard();
  assTurnEnds(g, { pick: "f2" });
  assert.equal(controllerOf(g.engine, g.id("f2")), P1);
  assert.equal(controllerOf(g.engine, g.id("f1")), P2, "the other one stays theirs");
});

clause(ASS, "0:rule", "exactly one character changes hands", () => {
  const g = assBoard();
  assTurnEnds(g, { pick: "f1" });
  assert.equal(controllerOf(g.engine, g.id("f2")), P2);
  assert.equal(controllerOf(g.engine, g.id("lent")), P2);
  assert.equal(controllerOf(g.engine, g.id("ally")), P1);
});

clause(ASS, "0:rule", "only characters THEY control AND own can be picked: a character they control but I own, and one they own but I control, are refused", () => {
  const g = assBoard();
  endTurn(g.engine, P1);
  // first the order prompt, if any
  if (pending(g.engine)?.kind === "orderTriggers") answerPending(g.engine, "orderTriggers", { next: (pending(g.engine)!.triggers as Array<{ sourceId: string; abilityId: string }>)[0] });
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("lent")] }), "they control it but I own it");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("taken")] }), "they own it but I control it");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ally")] }), "my character");
  assert.ok(pending(g.engine), "still waiting for a legal pick");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("f1")] });
  assert.equal(controllerOf(g.engine, g.id("f1")), P1, "control: a character they control and own works");
  assert.equal(controllerOf(g.engine, g.id("lent")), P2, "the lent character was not touched");
  assert.equal(controllerOf(g.engine, g.id("taken")), P1);
});

clause(ASS, "0:rule", "a face-down card, an item and a faction cannot be picked: only characters", () => {
  const g = assBoard();
  endTurn(g.engine, P1);
  if (pending(g.engine)?.kind === "orderTriggers") answerPending(g.engine, "orderTriggers", { next: (pending(g.engine)!.triggers as Array<{ sourceId: string; abilityId: string }>)[0] });
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("fd")] }), "a face-down card");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("thing")] }), "an item");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.engine.state.players[P2].factionId!] }), "their faction");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("f2")] });
  assert.equal(controllerOf(g.engine, g.id("f2")), P1, "control");
  assert.equal(isFaceDown(g.engine, g.id("fd")), true);
});

clause(ASS, "0:rule", "'if they can' - it is not optional: when they can pick a character they have to (an empty pick is refused)", () => {
  const g = assBoard();
  endTurn(g.engine, P1);
  if (pending(g.engine)?.kind === "orderTriggers") answerPending(g.engine, "orderTriggers", { next: (pending(g.engine)!.triggers as Array<{ sourceId: string; abilityId: string }>)[0] });
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining the pick");
  assert.ok(pending(g.engine), "the pick is still demanded");
  assert.equal(controllerOf(g.engine, g.id("f1")), P2);
});

clause(ASS, "0:rule", "'if they can': with no character they both control and own nothing is asked and nothing is taken", () => {
  const g = assBoard({ noFoes: true });
  const seen = assTurnEnds(g);
  assert.equal(seen.some((entry) => entry.startsWith("chooserSelectsTarget")), false, "no pick is asked of them");
  assert.equal(controllerOf(g.engine, g.id("lent")), P2, "the lent character is not stolen");
  assert.equal(controllerOf(g.engine, g.id("taken")), P1);
  assert.equal(controllerOf(g.engine, g.id("ally")), P1);
});

clause(ASS, "0:rule", "'if they can': with exactly one candidate I take exactly that character", () => {
  const g = assBoard({ noFoes: true, extra: [{ key: "only", def: character({ name: "Only Child", life: 5 }), owner: P2, zone: "play" }] });
  assTurnEnds(g, { pick: "only" });
  assert.equal(controllerOf(g.engine, g.id("only")), P1);
  assert.equal(controllerOf(g.engine, g.id("lent")), P2, "the lent character is not a candidate");
});

clause(ASS, "0:rule", "the control change is permanent, not 'this turn': I still control the character a full round later", () => {
  const g = assBoard();
  assTurnEnds(g, { pick: "f1" });
  assert.equal(g.engine.state.activePlayerId, P2);
  // their turn ends: the Ass is theirs now, so I pick one of MY characters for them
  const seen: string[] = [];
  endTurn(g.engine, P2);
  drain(g.engine, (pc) => {
    seen.push(pc.kind);
    if (pc.kind === "orderTriggers") return declineAll(pc);
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [g.id("ally")] };
    throw new Error(`unexpected ${pc.kind}`);
  });
  assert.equal(g.engine.state.activePlayerId, P1, "a full round has gone by");
  assert.equal(controllerOf(g.engine, g.id("f1")), P1, "the character I took is still mine");
  assert.equal(controllerOf(g.engine, g.id("ally")), P2, "(the Ass came back and took one of mine, see the next test)");
});

clause(ASS, "0:rule", "a character I took is destroyed into its OWNER's discard pile, not mine", () => {
  const g = assBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assTurnEnds(g, { pick: "f1" });
  declareAttackOpenWindow(g.engine, P2, [g.id("f2")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("kill"), { t: [g.id("f1")] });
  assert.ok(discardOf(g.engine, P2).includes(g.id("f1")), "its owner's discard pile");
  assert.equal(discardOf(g.engine, P1).includes(g.id("f1")), false);
});

clause(ASS, "0:rule", "it works from play only: an Ass in my hand, face-down or in my discard pile does nothing at the end of my turn", () => {
  for (const ass of ["hand", "faceDown", "discard"] as const) {
    const g = assBoard({ ass });
    endTurn(g.engine, P1);
    assert.equal(g.engine.state.pendingChoice, undefined, `${ass}: nothing to decide`);
    assert.equal(controllerOf(g.engine, g.id("f1")), P2, `${ass}: no character was taken`);
    assert.equal(controllerOf(g.engine, g.id("f2")), P2);
  }
});

clause(ASS, "0:rule", "only at the end of MY turn: at the end of my opponent's turn an Ass I still control triggers nothing for me", () => {
  const g = assBoard({ turn: 2, active: P2 });
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(controllerOf(g.engine, g.id("ass")), P1, "the Ass did not move on their turn's end");
  assert.equal(controllerOf(g.engine, g.id("ally")), P1);
});

clause(ASS, "0:rule", "the Ass has gone to my opponent: at the end of THEIR turn it triggers for them, and I pick one of my characters I control and own for them to take", () => {
  const g = assBoard({ noFoes: true, extra: [{ key: "ally2", def: character({ name: "Ally Two", life: 5 }), owner: P1, zone: "play" }] });
  assTurnEnds(g, { first: "borrowed-body" }); // the Ass changes hands; nothing to pick for them
  assert.equal(controllerOf(g.engine, g.id("ass")), P2, "setup: the Ass is theirs now");
  assert.equal(g.engine.state.activePlayerId, P2);
  const seen: string[] = [];
  endTurn(g.engine, P2);
  drain(g.engine, (pc) => {
    seen.push(`${pc.kind}:${pc.playerId}`);
    if (pc.kind === "orderTriggers") return declineAll(pc);
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [g.id("ally2")] };
    throw new Error(`unexpected ${pc.kind}`);
  });
  assert.ok(seen.includes("chooserSelectsTarget:p1"), "now I am the opponent: I make the pick");
  assert.equal(controllerOf(g.engine, g.id("ally2")), P2, "they took the character I picked");
  assert.equal(controllerOf(g.engine, g.id("ass")), P1, "and the Ass came back to me");
});

clause(ASS, "0:rule", "whichever Ass trigger I order first, my opponent still makes the pick and I still take the character", () => {
  for (const first of ["borrowed-body", "changing-hands"] as const) {
    const g = assBoard();
    const seen = assTurnEnds(g, { first, pick: "f1" });
    assert.ok(seen.includes("chooserSelectsTarget:p2"), `${first} first: they pick`);
    assert.equal(controllerOf(g.engine, g.id("f1")), P1, `${first} first: I take their character`);
    assert.equal(controllerOf(g.engine, g.id("ass")), P2, `${first} first: they get the Ass`);
    assert.equal(controllerOf(g.engine, g.id("ally")), P1);
  }
});

clause(ASS, "0:rule", "'at the END of your turn': the pick happens when the turn actually ends (after my opponent's responses), not when the end of turn is announced (CR 610.1a)", () => {
  const g = assBoard();
  g.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(g.engine.state.activePlayerId, P1, "the turn has not ended yet; the opponent may respond");
  assert.ok(g.engine.state.responseWindow, "the opponent's chance to respond to the end of turn");
  assert.equal(g.engine.state.pendingChoice, undefined, "end-of-turn triggers happen after the opponent's responses");
  assert.equal(controllerOf(g.engine, g.id("ass")), P1, "the Ass is still mine while they respond");
});

// --- 1:rule  At the end of your turn, your opponent takes control of this card. ---------------

clause(ASS, "1:rule", "at the end of my turn my opponent takes control of the Ass: it is in their play area, they control it, I still own it", () => {
  const g = assBoard();
  assTurnEnds(g, { pick: "f1" });
  assert.equal(controllerOf(g.engine, g.id("ass")), P2);
  assert.ok(playOf(g.engine, P2).includes(g.id("ass")), "playOf(g.engine, P2).includes(g.id(\"ass\"))");
  assert.equal(playOf(g.engine, P1).includes(g.id("ass")), false);
  assert.equal(g.engine.state.cards[g.id("ass")].ownerId, P1);
  assert.equal(zoneOf(g.engine, g.id("ass")), "play");
});

clause(ASS, "1:rule", "it happens even when they had no character for the first rule", () => {
  const g = assBoard({ noFoes: true });
  assTurnEnds(g);
  assert.equal(controllerOf(g.engine, g.id("ass")), P2);
});

clause(ASS, "1:rule", "it changes hands every turn: it comes back to me at the end of THEIR turn", () => {
  const g = assBoard({ noFoes: true });
  assTurnEnds(g);
  assert.equal(controllerOf(g.engine, g.id("ass")), P2);
  const seen: string[] = [];
  endTurn(g.engine, P2);
  drain(g.engine, (pc) => {
    seen.push(pc.kind);
    if (pc.kind === "orderTriggers") return declineAll(pc);
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [g.id("ally")] };
    throw new Error(`unexpected ${pc.kind}`);
  });
  assert.equal(controllerOf(g.engine, g.id("ass")), P1, "back to me");
});

clause(ASS, "1:rule", "'your turn' is its controller's turn: an Ass I own that my opponent controls does nothing at the end of MY turn", () => {
  const g = assBoard({ assOwner: P1, assController: P2 });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(controllerOf(g.engine, g.id("ass")), P2, "it stays with them");
  assert.equal(controllerOf(g.engine, g.id("f1")), P2);
});

clause(ASS, "1:rule", "a face-down or hand Ass has no rules text: control does not move", () => {
  for (const ass of ["hand", "faceDown"] as const) {
    const g = assBoard({ ass });
    endTurn(g.engine, P1);
    assert.equal(controllerOf(g.engine, g.id("ass")), P1, ass);
  }
});

clause(ASS, "1:rule", "the Ass stays in play (it only changes controller): it is not destroyed, depleted or flipped", () => {
  const g = assBoard();
  assTurnEnds(g, { pick: "f1" });
  assert.equal(zoneOf(g.engine, g.id("ass")), "play");
  assert.equal(isFaceDown(g.engine, g.id("ass")), false);
  assert.equal(isDepleted(g.engine, g.id("ass")), false);
});

clause(ASS, "1:rule", "an Ass that is destroyed goes to its OWNER's discard pile even while my opponent controls it", () => {
  const g = assBoard({ noFoes: true, extra: [{ key: "kill", def: itemKillerTactic(), owner: P2, zone: "hand" }] });
  assTurnEnds(g);
  assert.equal(controllerOf(g.engine, g.id("ass")), P2);
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("ass")] });
  assert.ok(discardOf(g.engine, P1).includes(g.id("ass")), "the owner's discard pile");
  assert.equal(discardOf(g.engine, P2).includes(g.id("ass")), false);
});

clause(ASS, "1:rule", "'at the END of your turn': my opponent takes control of the Ass when the turn actually ends, not while they can still respond to the end of turn (CR 610.1a)", () => {
  const g = assBoard({ noFoes: true });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  // answer whatever the engine asks right now (the order of the two triggers), WITHOUT letting the response window run
  let guard = 0;
  while (g.engine.state.pendingChoice && guard++ < 5) {
    const pc = pending(g.engine)!;
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
  }
  assert.ok(g.engine.state.responseWindow, "the opponent's chance to respond to the end of turn is still open");
  assert.equal(controllerOf(g.engine, g.id("ass")), P1, "still mine during their response window");
  resolvePendingResponses(g.engine);
  answerOffers(g.engine);
  assert.equal(controllerOf(g.engine, g.id("ass")), P2, "theirs once the turn has ended");
});

// =================================================================================
// Burly Assailment
// COST: Reveal a face-down character you control. -- EFFECT: You may play the character. Draw a card.
// While this card is in your discard pile, if a card that provides at least [D] enters play under your control,
// you may pay 2. If you do, put this card into play under your control as a face-down resource.
// FLIP UP: 1 [D]
// Tactic, cost 1, [D].
// =================================================================================

const BURLY = "1c5c411a-4655-4284-b1b2-b38a73713292";

/** A character with an "enters play" trigger: when it enters play its controller draws a card. */
const etbDrawer = (name: string, cost = 0): CardDefinition =>
  character({
    name,
    cost,
    behavior: { abilities: [{ id: "etb-draw", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

interface BurlyOpts {
  ba?: "hand" | "faceDown" | "discard" | "play" | "deck";
  baOwner?: PlayerId;
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  baSpent?: boolean;
  noDeck?: boolean;
  extra?: CardPlacement[];
}

/**
 * P1: ba (the Burly Assailment), face-down characters fc (cost 3), fcg (cost 1, threshold [G]), fcd (a character with an ETB draw); face-down non-characters
 * fitem / floc / ftac / fres; a face-up character ally; deck of 3. P2: ofc (face-down character), foe. Default P1's turn 1, [D] x8.
 */
function burlyBoard(o: BurlyOpts = {}) {
  const where = o.ba ?? "hand";
  return devBoard(
    [
      {
        key: "ba",
        def: printing(BURLY),
        owner: o.baOwner ?? P1,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: where === "faceDown" && o.baSpent ? "__factionA" : undefined
      },
      { key: "fc", def: character({ name: "Hidden Brute", cost: 3, strength: 3, life: 3 }), owner: P1, zone: "play", faceDown: true },
      { key: "fcg", def: character({ name: "Hidden Gated", cost: 1, threshold: "g" }), owner: P1, zone: "play", faceDown: true },
      { key: "fcd", def: etbDrawer("Hidden Drawer"), owner: P1, zone: "play", faceDown: true },
      { key: "fitem", def: item({ name: "Hidden Item" }), owner: P1, zone: "play", faceDown: true },
      { key: "floc", def: location({ name: "Hidden Location" }), owner: P1, zone: "play", faceDown: true },
      { key: "ftac", def: tactic({ name: "Hidden Tactic" }), owner: P1, zone: "play", faceDown: true },
      { key: "fres", def: resourceCard({ name: "Hidden Resource" }), owner: P1, zone: "play", faceDown: true },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      { key: "mh", def: character({ name: "MyHandChar", cost: 0 }), owner: P1, zone: "hand" },
      ...(o.noDeck ? [] : fillers("dk", 3, P1, "deck")),
      { key: "ofc", def: character({ name: "Their Hidden Brute", cost: 1 }), owner: P2, zone: "play", faceDown: true },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res(o.icons ?? { deception: 8 }),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type BurlyGame = ReturnType<typeof burlyBoard>;

/** Plays Burly revealing `key`, then answers the "may play it" question (accept = deploy it, else decline). */
function burly(g: BurlyGame, key: string, accept: boolean): void {
  playRaw(g.engine, P1, g.id("ba"), { selected: { rev: [g.id(key)] } });
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) {
    const pc = expectPending(g.engine, "deployForFree");
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: accept ? { kind: "deployForFree", cardId: g.id(key) } : { kind: "deployForFree" } } as never);
    resolvePendingResponses(g.engine);
  }
}
const burlyAttempt = (g: BurlyGame, ...keys: string[]) => () => playRaw(g.engine, P1, g.id("ba"), { selected: { rev: keys.map((key) => g.id(key)) } });
const revealedIds = (g: BurlyGame): string[] =>
  g.engine.getLog().flatMap((entry) => (entry.event?.type === "cardsRevealed" ? ((entry.event as { cardIds: string[] }).cardIds as string[]) : []));

// --- 0:ability  COST: Reveal a face-down character you control. EFFECT: You may play the character. Draw a card. ---

clause(BURLY, "0:ability", "playing the revealed character: it enters play face-up as a character under my control", () => {
  const g = burlyBoard();
  burly(g, "fc", true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("fc")), "play");
  assert.equal(isFaceDown(g.engine, g.id("fc")), false);
  assert.deepEqual(g.engine.getCardTypes(g.id("fc")), ["character"]);
  assert.equal(controllerOf(g.engine, g.id("fc")), P1);
  assert.equal(g.engine.getStat(g.id("fc"), "strength"), 3);
});

clause(BURLY, "0:ability", "'draw a card': exactly one card is drawn from my deck when I play the character", () => {
  const g = burlyBoard();
  const top = deckOf(g.engine, P1)[0];
  const handBefore = handOf(g.engine, P1).length;
  burly(g, "fc", true);
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 1, "Burly left my hand, one card was drawn");
  assert.equal(zoneOf(g.engine, top), "hand", "the top card of my deck");
  assert.equal(deckOf(g.engine, P1).length, 2);
});

clause(BURLY, "0:ability", "'You may play the character': declining leaves it face-down in play, and I still draw a card", () => {
  const g = burlyBoard();
  const top = deckOf(g.engine, P1)[0];
  burly(g, "fc", false);
  assert.equal(isFaceDown(g.engine, g.id("fc")), true, "still a face-down resource");
  assert.equal(zoneOf(g.engine, g.id("fc")), "play");
  assert.equal(zoneOf(g.engine, top), "hand", "the draw is not part of the 'may'");
});

clause(BURLY, "0:ability", "revealing is not flipping: the character is not turned face-up unless I play it", () => {
  const g = burlyBoard();
  burly(g, "fc", false);
  assert.equal(isFaceDown(g.engine, g.id("fc")), true);
  assert.equal(g.engine.isResource(g.id("fc")), true);
  assert.equal(tokensOn(g.engine, g.id("fc")), 0);
});

clause(BURLY, "0:ability", "'play' is a normal deploy: the character's numeric cost is paid (3 for the Brute, on top of Burly's 1) - it is not free", () => {
  const g = burlyBoard();
  const before = ready(g.engine);
  burly(g, "fc", true);
  assert.equal(zoneOf(g.engine, g.id("fc")), "play", "setup: it was played");
  // Burly (1) + the Brute's cost (3) are paid; the face-down Brute also stops being a resource (-1) unless it paid for itself
  assert.ok(before - ready(g.engine) >= 4, `at least 4 resources were paid (1 + 3), got ${before - ready(g.engine)}`);
});

clause(BURLY, "0:ability", "'play' is a normal deploy: with nothing left to pay the character's cost it cannot be played and stays face-down (the card is still drawn)", () => {
  const g = burlyBoard({ icons: { deception: 1 } });
  // E3b: test corrected: every other face-down card on this board is a resource too, so "nothing left to pay" needs them spent.
  for (const key of ["fcg", "fcd", "fitem", "floc", "ftac", "fres"]) g.engine.state.cards[g.id(key)].attachedTo = g.engine.state.players[P1].factionId;
  const top = deckOf(g.engine, P1)[0];
  // E3b: driven like the other unplayable "you may play" cases: the play is offered, accepting it is refused and the player declines.
  playRaw(g.engine, P1, g.id("ba"), { selected: { rev: [g.id("fc")] } });
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "deployForFree");
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "deployForFree", cardId: g.id("fc") } } as never), "a cost of 3 with 1 resource left");
  g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "deployForFree" } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("fc")), true, "the cost of 3 cannot be paid: the character is not played");
  assert.equal(zoneOf(g.engine, top), "hand", "the draw still happens");
});

clause(BURLY, "0:ability", "'play' still needs the character's threshold: a character that needs [G] cannot be played with only [D] (accepting the play is refused)", () => {
  const g = burlyBoard();
  playRaw(g.engine, P1, g.id("ba"), { selected: { rev: [g.id("fcg")] } });
  resolvePendingResponses(g.engine);
  expectPending(g.engine, "deployForFree");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("fcg") } } as never),
    "no [G]: it cannot be played",
    /threshold/i
  );
  const control = burlyBoard({ icons: { deception: 6, greed: 1 } });
  burly(control, "fcg", true);
  assert.equal(isFaceDown(control.engine, control.id("fcg")), false, "control: with a [G] it can be played");
});

clause(BURLY, "0:ability", "a refused play leaves everything as it was: after being refused for its threshold the character is still face-down, I can decline, and the card is drawn", () => {
  const g = burlyBoard();
  const top = deckOf(g.engine, P1)[0];
  playRaw(g.engine, P1, g.id("ba"), { selected: { rev: [g.id("fcg")] } });
  resolvePendingResponses(g.engine);
  expectPending(g.engine, "deployForFree");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: g.id("fcg") } } as never),
    "no [G]: it cannot be played",
    /threshold/i
  );
  assert.equal(isFaceDown(g.engine, g.id("fcg")), true, "the refused attempt changed nothing: still a face-down resource");
  if (pending(g.engine)) {
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree" } } as never);
    resolvePendingResponses(g.engine);
  }
  assert.equal(isFaceDown(g.engine, g.id("fcg")), true, "declined: not played");
  assert.equal(zoneOf(g.engine, top), "hand", "but the card is drawn");
});

clause(BURLY, "0:ability", "...and a character whose threshold I do meet can be played", () => {
  const g = burlyBoard({ icons: { deception: 6, greed: 1 } });
  burly(g, "fcg", true);
  assert.equal(isFaceDown(g.engine, g.id("fcg")), false);
  assert.equal(zoneOf(g.engine, g.id("fcg")), "play");
});

clause(BURLY, "0:ability", "the played character is a new card entering play: its 'enters play' trigger fires (a second card is drawn on top of Burly's)", () => {
  const g = burlyBoard();
  const handBefore = handOf(g.engine, P1).length;
  burly(g, "fcd", true);
  assert.equal(isFaceDown(g.engine, g.id("fcd")), false, "setup: it was played");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 2, "Burly left my hand, Burly drew one, the character's trigger drew another");
});

clause(BURLY, "0:ability", "a character played this way is a new arrival: it cannot attack the turn it entered", () => {
  const g = burlyBoard();
  burly(g, "fc", true);
  refused(() => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("fc")], target: { type: "faction", playerId: P2 } }), "it just entered play (CR 411.3, 204.3)", /did not start the turn in play/);
});

clause(BURLY, "0:ability", "the revealed card is the picked one: it is revealed to everyone (a reveal event for exactly that card)", () => {
  const g = burlyBoard();
  burly(g, "fc", false);
  assert.deepEqual(revealedIds(g), [g.id("fc")]);
});

clause(BURLY, "0:ability", "'Reveal' is part of the COST: the card is already revealed while my opponent decides how to respond", () => {
  const g = burlyBoard();
  playRaw(g.engine, P1, g.id("ba"), { selected: { rev: [g.id("fc")] } });
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.deepEqual(revealedIds(g), [g.id("fc")], "revealed when I played Burly, before the opponent responds");
});

clause(BURLY, "0:ability", "only a face-down CHARACTER can be revealed: face-down items, locations, tactics and resource cards are refused", () => {
  const g = burlyBoard();
  const before = ready(g.engine);
  for (const key of ["fitem", "floc", "ftac", "fres"]) refused(burlyAttempt(g, key), `${key} is not a character`);
  assert.equal(zoneOf(g.engine, g.id("ba")), "hand", "nothing was played");
  assert.equal(ready(g.engine), before, "nothing was paid");
  burly(g, "fc", false);
  assert.equal(revealedIds(g).length, 1, "control: a face-down character is accepted");
});

clause(BURLY, "0:ability", "the card must be FACE-DOWN: a face-up character is refused", () => {
  const g = burlyBoard();
  refused(burlyAttempt(g, "ally"), "a face-up character");
  refused(burlyAttempt(g, "mh"), "a character in my hand");
  assert.equal(zoneOf(g.engine, g.id("ba")), "hand");
});

clause(BURLY, "0:ability", "the face-down character must be MINE: my opponent's face-down character is refused", () => {
  const g = burlyBoard();
  refused(burlyAttempt(g, "ofc"), "their face-down character");
  assert.equal(zoneOf(g.engine, g.id("ba")), "hand");
  burly(g, "fc", false);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard", "control");
});

clause(BURLY, "0:ability", "exactly one character must be revealed: none and two are refused", () => {
  const g = burlyBoard();
  refused(burlyAttempt(g), "no reveal");
  refused(burlyAttempt(g, "fc", "fcd"), "two characters");
  assert.equal(zoneOf(g.engine, g.id("ba")), "hand");
});

clause(BURLY, "0:ability", "with no face-down character of mine at all it cannot be played", () => {
  const g = devBoard([{ key: "ba", def: printing(BURLY), owner: P1, zone: "hand" }, { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }, ...res({ deception: 3 })]);
  refused(() => playRaw(g.engine, P1, g.id("ba"), { selected: { rev: [] } }), "nothing to reveal");
  assert.equal(zoneOf(g.engine, g.id("ba")), "hand");
});

clause(BURLY, "0:ability", "it needs [D]: Greed alone (plus the Volition of my face-down cards) is refused, one [D] is enough", () => {
  const greed = burlyBoard({ icons: { greed: 6 } });
  refused(burlyAttempt(greed, "fc"), "no [D]");
  assert.equal(zoneOf(greed.engine, greed.id("ba")), "hand");
  assert.equal(attachedCount(greed.engine, P1), 0, "nothing was paid");
  const one = burlyBoard({ icons: { deception: 1, greed: 2 } });
  burly(one, "fc", false);
  assert.equal(zoneOf(one.engine, one.id("ba")), "discard", "control: one [D] is enough");
});

clause(BURLY, "0:ability", "a spent [D] still meets the threshold (CR 405.6): Burly can be played with all my [D] spent", () => {
  const g = burlyBoard({ icons: { greed: 2 }, extra: spent("deception", 1) });
  burly(g, "fc", false);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
});

clause(BURLY, "0:ability", "it costs exactly 1 when the character is not played", () => {
  const g = burlyBoard({ icons: { deception: 3 } });
  burly(g, "fc", false);
  assert.equal(attachedCount(g.engine, P1), 1, "one resource was spent");
});

clause(BURLY, "0:ability", "my opponent's [D] are not my [D]", () => {
  const theirs = burlyBoard({ icons: { greed: 6 }, oppIcons: { deception: 6 } });
  refused(burlyAttempt(theirs, "fc"), "their [D]");
  assert.equal(zoneOf(theirs.engine, theirs.id("ba")), "hand");
});

clause(BURLY, "0:ability", "the tactic ends in its owner's discard pile", () => {
  const g = burlyBoard();
  burly(g, "fc", true);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("ba")), "discardOf(g.engine, P1).includes(g.id(\"ba\"))");
});

clause(BURLY, "0:ability", "if the revealed character leaves play in response (removed from the game), I cannot play it - but I still draw a card (CR 402.5a)", () => {
  const g = burlyBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  const top = deckOf(g.engine, P1)[0];
  playRaw(g.engine, P1, g.id("ba"), { selected: { rev: [g.id("fc")] } });
  respondWith(g.engine, P2, g.id("rm"), { t: [g.id("fc")] });
  if (pending(g.engine)) {
    g.engine.perform({ type: "resolvePendingChoice", playerId: pending(g.engine)!.playerId, choice: { kind: "deployForFree" } } as never);
    resolvePendingResponses(g.engine);
  }
  assert.equal(zoneOf(g.engine, g.id("fc")), "removed");
  assert.equal(zoneOf(g.engine, top), "hand", "the card is drawn");
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
});

clause(BURLY, "0:ability", "being a tactic it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = burlyBoard({ turn: 2, active: P2 });
  refused(burlyAttempt(g, "fc"), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  burly(g, "fc", true);
  assert.equal(zoneOf(g.engine, g.id("fc")), "play");
  assert.equal(isFaceDown(g.engine, g.id("fc")), false, "an effect lets me play the character even on my opponent's turn (CR 204.1)");
});

// --- 1:rule  While this card is in your discard pile, if a card that provides at least [D] enters play under your control, you may pay 2. ---

/** Burly in the discard pile, a Deception resource card in my hand to play with the Develop Rule, and the usual extras. */
function recurBoard(o: BurlyOpts & { extraHand?: CardPlacement[] } = {}) {
  return burlyBoard({
    ...o,
    ba: o.ba ?? "discard",
    extra: [
      { key: "dres", def: resourceCard({ name: "Deception Card", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "hand" },
      { key: "gres", def: resourceCard({ name: "Greed Card", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      ...(o.extra ?? []),
      ...(o.extraHand ?? [])
    ]
  });
}

/** Plays my hand card `key` as my Develop Rule resource (face-up) and returns whether a "pay 2" offer appeared. */
function developAndSee(g: BurlyGame, key: string, faceDown = false): PendingChoiceLike | undefined {
  developResource(g.engine, P1, g.id(key), faceDown);
  return pending(g.engine);
}

clause(BURLY, "1:rule", "a Deception resource enters play under my control: I may pay 2 to put Burly into play face-down as a resource", () => {
  const g = recurBoard({ icons: { deception: 4 } });
  const pc = developAndSee(g, "dres");
  assert.ok(pc, "an offer is made");
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ba")), "play", "Burly is in play");
  assert.equal(isFaceDown(g.engine, g.id("ba")), true, "as a face-down resource");
  assert.equal(controllerOf(g.engine, g.id("ba")), P1);
  assert.equal(g.engine.isResource(g.id("ba")), true);
  assert.equal(discardOf(g.engine, P1).includes(g.id("ba")), false);
});

clause(BURLY, "1:rule", "it costs exactly 2", () => {
  const g = recurBoard({ icons: { deception: 4 } });
  developAndSee(g, "dres");
  const before = attachedCount(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(attachedCount(g.engine, P1) - before, 2, "two resources were spent");
});

clause(BURLY, "1:rule", "'you may': declining leaves Burly in the discard pile and costs nothing", () => {
  const g = recurBoard({ icons: { deception: 4 } });
  developAndSee(g, "dres");
  const before = attachedCount(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
  assert.equal(attachedCount(g.engine, P1), before);
});

clause(BURLY, "1:rule", "the Deception resource stays in play: only Burly is added", () => {
  const g = recurBoard({ icons: { deception: 4 } });
  developAndSee(g, "dres");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("dres")), "play");
  assert.equal(isFaceDown(g.engine, g.id("dres")), false);
});

clause(BURLY, "1:rule", "a card that provides only [G] does not trigger it", () => {
  const g = recurBoard({ icons: { deception: 4 } });
  const pc = developAndSee(g, "gres");
  assert.equal(pc, undefined, "no offer");
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
});

clause(BURLY, "1:rule", "a face-down card provides Volition, not [D]: playing a card face-down does not trigger it", () => {
  const g = recurBoard({ icons: { deception: 4 } });
  const pc = developAndSee(g, "mh", true);
  assert.equal(pc, undefined, "no offer");
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
});

clause(BURLY, "1:rule", "a Deception resource card played FACE-DOWN provides Volition, so it does not trigger it either", () => {
  const g = recurBoard({ icons: { deception: 4 } });
  const pc = developAndSee(g, "dres", true);
  assert.equal(pc, undefined);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
});

clause(BURLY, "1:rule", "a non-resource card that provides [D] (PROVIDES) entering play also triggers it", () => {
  const provider = character({ name: "Deceptive Provider", cost: 0, resource: { provides: ["deception"] } });
  const g = recurBoard({ icons: { deception: 4 }, extraHand: [{ key: "prov", def: provider, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("prov"));
  const pc = pending(g.engine);
  assert.ok(pc, "an offer is made when the PROVIDES card enters play");
  assert.equal(pc.kind, "mayPay");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("ba")), "play");
  assert.equal(isFaceDown(g.engine, g.id("ba")), true);
});

clause(BURLY, "1:rule", "...and putting Burly into play that way costs exactly 2 as well (a PROVIDES card, not the Develop Rule)", () => {
  const provider = character({ name: "Deceptive Provider", cost: 0, resource: { provides: ["deception"] } });
  const g = recurBoard({ icons: { deception: 4 }, extraHand: [{ key: "prov", def: provider, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("prov"));
  const before = attachedCount(g.engine, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(attachedCount(g.engine, P1) - before, 2, "two resources were spent");
  const decline = recurBoard({ icons: { deception: 4 }, extraHand: [{ key: "prov", def: provider, owner: P1, zone: "hand" }] });
  play(decline.engine, P1, decline.id("prov"));
  const beforeDecline = attachedCount(decline.engine, P1);
  answerPending(decline.engine, "mayPay", { pay: false });
  assert.equal(attachedCount(decline.engine, P1), beforeDecline, "declining costs nothing");
  assert.equal(zoneOf(decline.engine, decline.id("ba")), "discard");
});

clause(BURLY, "1:rule", "a card that provides two [D] triggers it once, not twice", () => {
  const provider = character({ name: "Double Provider", cost: 0, resource: { provides: ["deception", "deception"] } });
  const g = recurBoard({ icons: { deception: 6 }, extraHand: [{ key: "prov", def: provider, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("prov"));
  let offers = 0;
  drain(g.engine, (pc) => {
    if (pc.kind === "mayPay") {
      offers++;
      return { kind: "mayPay", pay: true };
    }
    return declineAll(pc);
  });
  assert.equal(offers, 1);
  assert.equal(zoneOf(g.engine, g.id("ba")), "play");
});

clause(BURLY, "1:rule", "a Deception card that enters play under MY OPPONENT's control does not trigger it", () => {
  const g = recurBoard({
    icons: { deception: 4 },
    turn: 2,
    active: P2,
    oppIcons: { deception: 1 },
    extra: [{ key: "ores", def: resourceCard({ name: "Their Deception", resource: { provides: ["deception"], staple: true } }), owner: P2, zone: "hand" }]
  });
  developResource(g.engine, P2, g.id("ores"), false);
  assert.equal(g.engine.state.pendingChoice, undefined, "no offer to me, none to them");
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
});

clause(BURLY, "1:rule", "it only works while Burly is in my DISCARD PILE: in my hand, in play (face-down) or in my deck it does nothing", () => {
  for (const ba of ["hand", "faceDown", "deck"] as const) {
    const g = recurBoard({ ba, icons: { deception: 4 } });
    const pc = developAndSee(g, "dres");
    assert.equal(pc, undefined, `${ba}: no offer`);
  }
  const control = recurBoard({ ba: "discard", icons: { deception: 4 } });
  assert.ok(developAndSee(control, "dres"), "control: in the discard pile it is offered");
});

clause(BURLY, "1:rule", "a Burly in my OPPONENT's discard pile is theirs: my Deception card does not let me take it", () => {
  const g = recurBoard({ baOwner: P2, icons: { deception: 4 } });
  const pc = developAndSee(g, "dres");
  assert.equal(pc, undefined);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
});

clause(BURLY, "1:rule", "'pay 2': with only the new Deception card to pay with I cannot pay, and Burly stays in the discard pile", () => {
  const poor = devBoard([
    { key: "ba", def: printing(BURLY), owner: P1, zone: "discard" },
    { key: "dres", def: resourceCard({ name: "Deception Card", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "hand" }
  ]);
  developResource(poor.engine, P1, poor.id("dres"), false);
  if (pending(poor.engine)) {
    refused(() => answerPending(poor.engine, "mayPay", { pay: true }), "only 1 resource to pay 2 with");
  }
  assert.equal(zoneOf(poor.engine, poor.id("ba")), "discard");
  const richer = devBoard([
    { key: "ba", def: printing(BURLY), owner: P1, zone: "discard" },
    { key: "dres", def: resourceCard({ name: "Deception Card", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "hand" },
    ...res({ deception: 1 })
  ]);
  developResource(richer.engine, P1, richer.id("dres"), false);
  answerPending(richer.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(richer.engine, richer.id("ba")), "play", "control: two resources are enough");
});

clause(BURLY, "1:rule", "a card put into play by an effect (not the Develop Rule) triggers it too: 'enters play'", () => {
  const g = recurBoard({
    icons: { deception: 4 },
    extra: [{ key: "put", def: putterTactic(), owner: P1, zone: "hand" }, { key: "dchar", def: character({ name: "Deceptive Put", resource: { provides: ["deception"] } }), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("put"), { selected: { t: [g.id("dchar")] } });
  const pc = pending(g.engine);
  assert.ok(pc, "an offer is made");
  assert.equal(pc.kind, "mayPay");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("ba")), "play");
});

clause(BURLY, "1:rule", "Burly entering play as a face-down resource does not trigger itself again", () => {
  const g = recurBoard({ icons: { deception: 6 } });
  developAndSee(g, "dres");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ba")), "play");
});

clause(BURLY, "1:rule", "a Burly put into play this way can be played again later: as a face-down resource it can FLIP UP", () => {
  const g = recurBoard({ icons: { deception: 6 } });
  developAndSee(g, "dres");
  answerPending(g.engine, "mayPay", { pay: true });
  flipUpRaw(g.engine, P1, g.id("ba"), { rev: [g.id("fc")] });
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) {
    g.engine.perform({ type: "resolvePendingChoice", playerId: pending(g.engine)!.playerId, choice: { kind: "deployForFree" } } as never);
    resolvePendingResponses(g.engine);
  }
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard", "flipped up and resolved");
});

// --- 2:flipUp  FLIP UP: 1 [D] -----------------------------------------------------------------

const flipBurly = (g: BurlyGame, key?: string, player: PlayerId = P1) => () => flipUpRaw(g.engine, player, g.id("ba"), key ? { rev: [g.id(key)] } : {});
const burlyFaceDown = (o: BurlyOpts = {}) => burlyBoard({ ...o, ba: "faceDown" });

/** Flips Burly up revealing `key`, then answers the "may play it" question. */
function flipBurlyFully(g: BurlyGame, key: string, accept = false): void {
  flipBurly(g, key)();
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) {
    const pc = expectPending(g.engine, "deployForFree");
    g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: accept ? { kind: "deployForFree", cardId: g.id(key) } : { kind: "deployForFree" } } as never);
    resolvePendingResponses(g.engine);
  }
}

clause(BURLY, "2:flipUp", "a face-down Burly is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = burlyFaceDown({ icons: { deception: 2 } });
  assert.equal(g.engine.isResource(g.id("ba")), true);
  assert.equal(g.engine.getThresholds(P1).deception ?? 0, 2);
});

clause(BURLY, "2:flipUp", "flipping it up resolves it as the tactic: I reveal a face-down character, may play it, draw a card, and Burly ends in my discard pile", () => {
  const g = burlyFaceDown();
  const top = deckOf(g.engine, P1)[0];
  flipBurlyFully(g, "fc", false);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("ba")), false);
  assert.equal(zoneOf(g.engine, top), "hand", "a card was drawn");
  assert.deepEqual(revealedIds(g), [g.id("fc")]);
});

clause(BURLY, "2:flipUp", "flipping it up can play the revealed character too", () => {
  const g = burlyFaceDown();
  flipBurlyFully(g, "fcd", true);
  assert.equal(isFaceDown(g.engine, g.id("fcd")), false);
  assert.equal(zoneOf(g.engine, g.id("fcd")), "play");
});

clause(BURLY, "2:flipUp", "FLIP UP pays 1: the printed cost (also 1) is not paid on top of it - at most one resource is spent", () => {
  const g = burlyFaceDown({ icons: { deception: 4 } });
  const before = ready(g.engine);
  flipBurlyFully(g, "fc", false);
  const spentNow = attachedCount(g.engine, P1);
  assert.ok(spentNow <= 1, `at most one resource is spent (Burly may pay for itself), got ${spentNow}`);
  assert.ok(ready(g.engine) >= before - 2, "ready(g.engine) >= before - 2");
});

clause(BURLY, "2:flipUp", "the face-down Burly can pay for its own FLIP UP cost (CR 507.4b)", () => {
  const g = burlyBoard({ ba: "faceDown", icons: {}, extra: spent("deception", 1) });
  assert.ok(ready(g.engine) >= 1, "ready(g.engine) >= 1");
  flipBurlyFully(g, "fc", false);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard");
});

clause(BURLY, "2:flipUp", "FLIP UP needs [D]: plenty of Greed and no [D] is refused (Burly stays face-down), one [D] is accepted", () => {
  const none = burlyFaceDown({ icons: { greed: 6 } });
  refused(flipBurly(none, "fc"), "no [D]");
  assert.equal(isFaceDown(none.engine, none.id("ba")), true);
  const one = burlyFaceDown({ icons: { deception: 1, greed: 2 } });
  flipBurlyFully(one, "fc", false);
  assert.equal(zoneOf(one.engine, one.id("ba")), "discard", "control: one [D] is enough");
});

clause(BURLY, "2:flipUp", "the card's own Volition does not provide the [D], and the opponent's [D] do not count", () => {
  const onlyVolition = burlyFaceDown({ icons: {} });
  refused(flipBurly(onlyVolition, "fc"), "only Volition");
  const theirs = burlyFaceDown({ icons: { greed: 4 }, oppIcons: { deception: 6 } });
  refused(flipBurly(theirs, "fc"), "their [D]");
});

clause(BURLY, "2:flipUp", "the regular extra cost still applies: only my own face-down character can be revealed", () => {
  const g = burlyFaceDown();
  refused(flipBurly(g), "no reveal");
  refused(flipBurly(g, "ally"), "a face-up character");
  refused(flipBurly(g, "fitem"), "a face-down item");
  refused(flipBurly(g, "ofc"), "their face-down character");
  assert.equal(isFaceDown(g.engine, g.id("ba")), true, "still face-down after every refusal");
  flipBurlyFully(g, "fc", false);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard", "control");
});

clause(BURLY, "2:flipUp", "a tactic's FLIP UP can be done whenever a tactic could be played: in response on the opponent's turn it works, outside a response window it does not", () => {
  const g = burlyFaceDown({ turn: 2, active: P2 });
  refused(flipBurly(g, "fc"), "nothing to respond to yet");
  assert.equal(isFaceDown(g.engine, g.id("ba")), true);
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  flipBurlyFully(g, "fc", false);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard", "flipped up in response to the attack");
});

clause(BURLY, "2:flipUp", "a face-down Burly that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = burlyBoard({ ba: "faceDown", baSpent: true });
  assert.equal(g.engine.state.cards[g.id("ba")].attachedTo, g.engine.state.players[P1].factionId, "setup: spent on my faction");
  flipBurlyFully(g, "fc", false);
  assert.equal(zoneOf(g.engine, g.id("ba")), "discard", "flipped up and resolved");
});

clause(BURLY, "2:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it resolves", () => {
  const g = burlyFaceDown();
  flipBurly(g, "fc")();
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
});

clause(BURLY, "2:flipUp", "it can only be flipped by its controller, and only while it is face-down in play", () => {
  const theirs = burlyFaceDown({ oppIcons: { deception: 4 } });
  refused(flipBurly(theirs, "fc", P2), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("ba")), true);
  const inHand = burlyBoard({ ba: "hand" });
  refused(flipBurly(inHand, "fc"), "in my hand it is not a face-down resource");
});

// =================================================================================
// Delusive Strumpet
// You may play this card whenever you could play a tactic.
// GRACEFUL EXIT -- COST: Discard a card. -- EFFECT: Flip this card face-down under its owner's control.
// FLIP UP: 4 [D][D] and play a resource.
// Character (dancer), cost 3, [D][D], 2 strength / 3 speed / 2 life.
// =================================================================================

const STRUMPET = "a17915e2-28d9-48ba-b721-3683f2c92d22";

interface StrumpetOpts {
  st?: "hand" | "play" | "faceDown";
  stOwner?: PlayerId;
  stController?: PlayerId;
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  noHand?: boolean;
  stSpent?: boolean;
  damage?: number;
  tokens?: number;
  extra?: CardPlacement[];
}

/**
 * P1: st (the Strumpet), ally (character), hand: toss (character), toss2 (item), hres (Deception resource card), hchar2 (character), hplain (a plain cost-0 character).
 * P2: foe (character), oh (character in hand), a deck. Default P1's turn 1, [D] x6.
 */
function stBoard(o: StrumpetOpts = {}) {
  const where = o.st ?? "play";
  return devBoard(
    [
      {
        key: "st",
        def: printing(STRUMPET),
        owner: o.stOwner ?? P1,
        controller: o.stController,
        zone: where === "hand" ? "hand" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: where === "faceDown" && o.stSpent ? "__factionA" : undefined,
        damage: o.damage,
        counters: o.tokens ? { token: o.tokens } : undefined
      },
      { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P1, zone: "play" },
      ...(o.noHand
        ? []
        : [
            { key: "toss", def: character({ name: "Toss Character" }), owner: P1, zone: "hand" as const },
            { key: "toss2", def: item({ name: "Toss Item" }), owner: P1, zone: "hand" as const },
            { key: "hres", def: resourceCard({ name: "Hand Deception", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "hand" as const },
            { key: "hchar2", def: character({ name: "Hand Character Two" }), owner: P1, zone: "hand" as const },
            { key: "hplain", def: character({ name: "Plain Character", cost: 0 }), owner: P1, zone: "hand" as const }
          ]),
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "oh", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" },
      { key: "mx", def: character({ name: "My Discarded Card" }), owner: P1, zone: "discard" },
      ...fillers("dk", 3, P1, "deck"),
      ...res(o.icons ?? { deception: 6 }),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type StGame = ReturnType<typeof stBoard>;

// --- 0:rule  You may play this card whenever you could play a tactic. -----------------------

clause(STRUMPET, "0:rule", "it has the TACTICAL keyword", () => {
  const g = stBoard({ st: "hand" });
  assert.ok(g.engine.getKeywords(g.id("st")).includes("tactical"), "g.engine.getKeywords(g.id(\"st\")).includes(\"tactical\")");
  assert.equal(g.engine.getKeywords(g.id("hplain")).includes("tactical"), false, "control: an ordinary character is not tactical");
});

clause(STRUMPET, "0:rule", "on my own turn it deploys like any character: it costs exactly 3 and enters play as a character under my control", () => {
  const g = stBoard({ st: "hand", icons: { deception: 5 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("st"));
  assert.equal(zoneOf(g.engine, g.id("st")), "play");
  assert.equal(before - ready(g.engine), 3, "the printed cost");
  assert.deepEqual(g.engine.getCardTypes(g.id("st")), ["character"]);
  assert.equal(controllerOf(g.engine, g.id("st")), P1);
  assert.equal(g.engine.getStat(g.id("st"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("st"), "life"), 2);
});

clause(STRUMPET, "0:rule", "it needs [D][D]: one [D] among many resources is refused, two are accepted", () => {
  const one = stBoard({ st: "hand", icons: { deception: 1, greed: 6 } });
  refused(() => playRaw(one.engine, P1, one.id("st")), "one [D]");
  assert.equal(zoneOf(one.engine, one.id("st")), "hand");
  const two = stBoard({ st: "hand", icons: { deception: 2, greed: 1 } });
  play(two.engine, P1, two.id("st"));
  assert.equal(zoneOf(two.engine, two.id("st")), "play");
  const short = stBoard({ st: "hand", icons: { deception: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("st")), "one resource short of the cost 3");
});

clause(STRUMPET, "0:rule", "on my opponent's turn, in response to their attack, I can play it: it resolves into play (not the discard pile) under my control", () => {
  const g = stBoard({ st: "hand", turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority in their attack");
  respondWith(g.engine, P1, g.id("st"));
  assert.equal(zoneOf(g.engine, g.id("st")), "play", "a Tactical character resolves into play");
  assert.equal(controllerOf(g.engine, g.id("st")), P1);
  assert.equal(isFaceDown(g.engine, g.id("st")), false);
});

clause(STRUMPET, "0:rule", "...but not on my opponent's turn when there is nothing to respond to (no tactic could be played then either)", () => {
  const g = stBoard({ st: "hand", turn: 2, active: P2 });
  refused(() => playRaw(g.engine, P1, g.id("st")), "no response window");
  assert.equal(zoneOf(g.engine, g.id("st")), "hand");
  assert.equal(ready(g.engine), 6, "nothing was paid");
});

clause(STRUMPET, "0:rule", "an ordinary character cannot be played in that window (control for the test above)", () => {
  const g = stBoard({ st: "hand", turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => playRaw(g.engine, P1, g.id("hplain")), "an ordinary character is not tactical", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(g.engine, g.id("hplain")), "hand");
  playRaw(g.engine, P1, g.id("st"));
  assert.ok(g.engine.state.responseWindow, "control: the Strumpet is accepted");
});

clause(STRUMPET, "0:rule", "on my own turn, in my own attack's response window (where a tactic could be played), I can play it too", () => {
  const g = stBoard({ st: "hand", turn: 1, active: P1, extra: [{ key: "atk", def: character({ name: "My Attacker" }), owner: P1, zone: "play" }] });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("atk")], target: { type: "faction", playerId: P2 } });
  assert.equal(g.engine.state.priorityPlayerId, P1, "the attacker holds priority first");
  respondWith(g.engine, P1, g.id("st"));
  assert.equal(zoneOf(g.engine, g.id("st")), "play");
});

clause(STRUMPET, "0:rule", "it still obeys its own cost: in my opponent's window it must still be paid for (cost 3, [D][D])", () => {
  const g = stBoard({ st: "hand", turn: 2, active: P2, icons: { deception: 3 } });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  const before = ready(g.engine);
  respondWith(g.engine, P1, g.id("st"));
  assert.equal(before - ready(g.engine), 3);
  // [D][D] met by already-spent Deception, but only two ready resources for the cost of 3
  const poor = stBoard({ st: "hand", turn: 2, active: P2, icons: { rage: 2 }, extra: spent("deception", 2) });
  declareAttackOpenWindow(poor.engine, P2, [poor.id("foe")]);
  refused(() => playRaw(poor.engine, P1, poor.id("st")), "cannot pay in response either (threshold met by spent icons)", /Costs cannot be paid/);
});

clause(STRUMPET, "0:rule", "a Strumpet put into play in response can block (it is in play before blockers are declared) - a new arrival may block", () => {
  const g = stBoard({ st: "hand", turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  respondWith(g.engine, P1, g.id("st"));
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("st")] });
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("st")]);
});

// --- 1:ability:graceful-exit  COST: Discard a card. EFFECT: Flip this card face-down under its owner's control. ---

const graceful = (g: StGame, discard: string[], key = "st", player: PlayerId = P1) =>
  activate(g.engine, player, g.id(key), "graceful-exit", { selected: { toss: discard.map((card) => g.id(card)) } });
const gracefulAttempt = (g: StGame, discard: string[] | undefined, key = "st", player: PlayerId = P1) => () =>
  actRaw(g.engine, player, g.id(key), "graceful-exit", discard ? { toss: discard.map((card) => g.id(card)) } : {});

clause(STRUMPET, "1:ability:graceful-exit", "discarding a card flips the Strumpet face-down: it stays in play as a face-down card", () => {
  const g = stBoard();
  graceful(g, ["toss"]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("st")), "play", "flipped, not destroyed");
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
  assert.equal(discardOf(g.engine, P1).includes(g.id("st")), false);
});

clause(STRUMPET, "1:ability:graceful-exit", "the discarded card goes to my discard pile, and only that card is discarded", () => {
  const g = stBoard();
  const handBefore = handOf(g.engine, P1).length;
  graceful(g, ["toss"]);
  assert.equal(zoneOf(g.engine, g.id("toss")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("toss")), "discardOf(g.engine, P1).includes(g.id(\"toss\"))");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(g.engine, g.id("toss2")), "hand");
});

clause(STRUMPET, "1:ability:graceful-exit", "any card type can be discarded: an item, a resource card, a character", () => {
  for (const key of ["toss", "toss2", "hres"]) {
    const g = stBoard();
    graceful(g, [key]);
    assert.equal(zoneOf(g.engine, g.id(key)), "discard", key);
    assert.equal(isFaceDown(g.engine, g.id("st")), true, key);
  }
});

clause(STRUMPET, "1:ability:graceful-exit", "the flipped Strumpet is a face-down resource: only a resource (CR 411.1), one Volition, in my resource pool", () => {
  const g = stBoard({ icons: { deception: 2 } });
  const readyBefore = ready(g.engine);
  graceful(g, ["toss"]);
  assert.equal(g.engine.isResource(g.id("st")), true);
  assert.deepEqual(g.engine.getCardTypes(g.id("st")), ["resource"]);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
  assert.equal(ready(g.engine), readyBefore + 1);
});

clause(STRUMPET, "1:ability:graceful-exit", "the cost is only the discard: no resource is spent", () => {
  const g = stBoard({ icons: { deception: 3 } });
  graceful(g, ["toss"]);
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(STRUMPET, "1:ability:graceful-exit", "it can be used with no resources at all", () => {
  const g = stBoard({ icons: {} });
  graceful(g, ["toss"]);
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
});

clause(STRUMPET, "1:ability:graceful-exit", "the discard is a cost: with no card in my hand it cannot be used and the Strumpet stays face-up", () => {
  const g = stBoard({ noHand: true });
  refused(gracefulAttempt(g, undefined), "no card to discard");
  refused(gracefulAttempt(g, []), "empty pick");
  assert.equal(isFaceDown(g.engine, g.id("st")), false);
});

clause(STRUMPET, "1:ability:graceful-exit", "exactly one card is discarded: two are refused", () => {
  const g = stBoard();
  refused(gracefulAttempt(g, ["toss", "toss2"]), "two cards");
  assert.equal(zoneOf(g.engine, g.id("toss")), "hand");
  assert.equal(zoneOf(g.engine, g.id("toss2")), "hand");
  assert.equal(isFaceDown(g.engine, g.id("st")), false);
});

clause(STRUMPET, "1:ability:graceful-exit", "the discarded card must come from my hand: cards in play, my discard pile, my deck and my opponent's hand are refused", () => {
  const g = stBoard();
  refused(gracefulAttempt(g, ["ally"]), "a character in play");
  refused(gracefulAttempt(g, ["mx"]), "my discard pile");
  refused(gracefulAttempt(g, ["dk0"]), "my deck");
  refused(gracefulAttempt(g, ["oh"]), "my opponent's hand");
  assert.equal(isFaceDown(g.engine, g.id("st")), false, "nothing happened");
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
  graceful(g, ["toss"]);
  assert.equal(isFaceDown(g.engine, g.id("st")), true, "control: a hand card works");
});

clause(STRUMPET, "1:ability:graceful-exit", "the Strumpet itself cannot be the discarded card: it is in play, not in my hand", () => {
  const g = stBoard();
  refused(gracefulAttempt(g, ["st"]), "the Strumpet is not in my hand");
  assert.equal(isFaceDown(g.engine, g.id("st")), false);
});

clause(STRUMPET, "1:ability:graceful-exit", "the cost is paid when I use it: my opponent can respond, but the card is already discarded", () => {
  const g = stBoard();
  actRaw(g.engine, P1, g.id("st"), "graceful-exit", { toss: [g.id("toss")] });
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("toss")), "discard", "the cost was paid");
  assert.equal(isFaceDown(g.engine, g.id("st")), false, "the effect has not happened yet");
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
});

clause(STRUMPET, "1:ability:graceful-exit", "under its OWNER's control: a Strumpet I took from my opponent flips face-down under THEIR control", () => {
  const g = stBoard({ stOwner: P2, stController: P1 });
  graceful(g, ["toss"]);
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
  assert.equal(controllerOf(g.engine, g.id("st")), P2);
  assert.ok(playOf(g.engine, P2).includes(g.id("st")), "playOf(g.engine, P2).includes(g.id(\"st\"))");
  assert.ok(discardOf(g.engine, P1).includes(g.id("toss")), "my discard cost went to my discard pile");
});

clause(STRUMPET, "1:ability:graceful-exit", "...and my own Strumpet that my opponent controls is flipped by THEM, face-down under MY control", () => {
  const g = stBoard({ stOwner: P1, stController: P2, turn: 2, active: P2, extra: [{ key: "ph", def: character({ name: "Their Toss" }), owner: P2, zone: "hand" }] });
  activate(g.engine, P2, g.id("st"), "graceful-exit", { selected: { toss: [g.id("ph")] } });
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
  assert.equal(controllerOf(g.engine, g.id("st")), P1);
});

clause(STRUMPET, "1:ability:graceful-exit", "the flipped card is a new card: damage, tokens and attached gear are gone (the gear is flipped face-down with it when its host stops being a character)", () => {
  const gear = item({ name: "Strumpet Gear", attachTo: "character" });
  const g = stBoard({ damage: 1, tokens: 2, extra: [{ key: "gear", def: gear, owner: P1, zone: "play", attachedToKey: "st" }] });
  graceful(g, ["toss"]);
  const card = g.engine.state.cards[g.id("st")];
  assert.equal(card.damage, 0);
  assert.equal(tokensOn(g.engine, g.id("st")), 0);
  assert.equal(zoneOf(g.engine, g.id("gear")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(g.engine.state.cards[g.id("gear")].faceDown, true, "...and is flipped face-down along with its host");
});

clause(STRUMPET, "1:ability:graceful-exit", "being an ability it can be used in response on the opponent's turn", () => {
  const g = stBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("st"), "graceful-exit", { toss: [g.id("toss")] });
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
  assert.equal(zoneOf(g.engine, g.id("toss")), "discard");
});

clause(STRUMPET, "1:ability:graceful-exit", "used by an attacking Strumpet it leaves the battle (it stops being a character, CR 208.4): a lone attacker flipping away ends the battle", () => {
  const g = stBoard({ turn: 1, active: P1 });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("st")], target: { type: "faction", playerId: P2 } });
  assert.deepEqual(battleOf(g.engine)?.attackingParty, [g.id("st")]);
  actRaw(g.engine, P1, g.id("st"), "graceful-exit", { toss: [g.id("toss")] });
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
  assert.equal(battleOf(g.engine)?.attackingParty.includes(g.id("st")) ?? false, false, "no longer attacking");
  assert.equal(influenceOf(g.engine, P2), 30, "no damage reached my opponent");
});

clause(STRUMPET, "1:ability:graceful-exit", "used by a blocking Strumpet it leaves the blocking party", () => {
  const g = stBoard({ turn: 2, active: P2 });
  declareAttackBy(g.engine, P2, [g.id("foe")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("st")] });
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("st")]);
  g.engine.perform({ type: "passPriority", playerId: P2 });
  actRaw(g.engine, P1, g.id("st"), "graceful-exit", { toss: [g.id("toss")] });
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
  assert.equal(battleOf(g.engine)?.blockingParty.includes(g.id("st")) ?? false, false);
});

clause(STRUMPET, "1:ability:graceful-exit", "only its controller can use it", () => {
  const g = stBoard({ turn: 1, active: P1, extra: [{ key: "atk", def: character({ name: "My Attacker" }), owner: P1, zone: "play" }, { key: "ph", def: character({ name: "Their Toss" }), owner: P2, zone: "hand" }] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(gracefulAttempt(g, ["ph"], "st", P2), "the Strumpet is mine", /control|owner|yours|your/i);
  assert.equal(isFaceDown(g.engine, g.id("st")), false);
});

clause(STRUMPET, "1:ability:graceful-exit", "it works from play only: not from my hand, and a face-down Strumpet has no rules text", () => {
  const inHand = stBoard({ st: "hand" });
  refused(gracefulAttempt(inHand, ["toss"]), "in my hand", /Activated ability not found|not in play|play/i);
  assert.equal(zoneOf(inHand.engine, inHand.id("toss")), "hand");
  const down = stBoard({ st: "faceDown" });
  refused(gracefulAttempt(down, ["toss"]), "face-down", /Activated ability not found|face-down|rules text/i);
  assert.equal(zoneOf(down.engine, down.id("toss")), "hand");
});

clause(STRUMPET, "1:ability:graceful-exit", "it can be used again once it has been flipped up again (a cycle: exit, flip up, exit)", () => {
  const g = stBoard();
  graceful(g, ["toss"]);
  flipUpRaw(g.engine, P1, g.id("st"), {});
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hchar2")] });
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("st")), false, "flipped up again");
  graceful(g, ["toss2"]);
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
});

// --- 2:flipUp  FLIP UP: 4 [D][D] and play a resource. --------------------------------------

const flipSt = (g: StGame, player: PlayerId = P1) => () => flipUpRaw(g.engine, player, g.id("st"), {});
const stFaceDown = (o: StrumpetOpts = {}) => stBoard({ ...o, st: "faceDown" });

/** Flips the face-down Strumpet up, then plays `handCard` as the resource the FLIP UP asks for. */
function flipStFully(g: StGame, handCard: string = "hres"): void {
  flipSt(g)();
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(handCard)] });
  assert.equal(g.engine.state.pendingChoice, undefined);
}

clause(STRUMPET, "2:flipUp", "a face-down Strumpet is a resource: it provides Volition and is in my resource pool until it is flipped", () => {
  const g = stFaceDown({ icons: { deception: 2 } });
  assert.equal(g.engine.isResource(g.id("st")), true);
  assert.equal(ready(g.engine), 3);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(STRUMPET, "2:flipUp", "flipping it up puts the character into play face-up under my control, ready, as a real character with its printed stats", () => {
  const g = stFaceDown();
  flipStFully(g);
  assert.equal(zoneOf(g.engine, g.id("st")), "play");
  assert.equal(isFaceDown(g.engine, g.id("st")), false);
  assert.deepEqual(g.engine.getCardTypes(g.id("st")), ["character"]);
  assert.equal(isDepleted(g.engine, g.id("st")), false);
  assert.equal(controllerOf(g.engine, g.id("st")), P1);
  assert.equal(g.engine.getStat(g.id("st"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("st"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("st"), "life"), 2);
});

clause(STRUMPET, "2:flipUp", "it pays the FLIP UP cost of 4, not the printed cost of 3", () => {
  const g = stFaceDown({ icons: { deception: 8 } });
  const before = ready(g.engine);
  assert.equal(before, 9);
  flipStFully(g);
  const spentNow = attachedCount(g.engine, P1);
  assert.ok(spentNow <= 4, `at most four resources are spent, got ${spentNow}`);
  assert.ok(spentNow >= 3, `at least three of the other resources are spent (the Strumpet may pay one itself), got ${spentNow}`);
});

clause(STRUMPET, "2:flipUp", "the cost is exactly 4: [D][D] plus one other resource and the card itself is enough, [D][D] plus itself is one short", () => {
  const enough = stBoard({ st: "faceDown", icons: { deception: 3 } });
  flipStFully(enough);
  assert.equal(isFaceDown(enough.engine, enough.id("st")), false, "the card paid for its own FLIP UP (CR 507.4b)");
  const short = stBoard({ st: "faceDown", icons: { deception: 2 } });
  refused(flipSt(short), "three resources for a cost of 4");
  assert.equal(isFaceDown(short.engine, short.id("st")), true);
  assert.equal(ready(short.engine), 3, "nothing was paid");
});

clause(STRUMPET, "2:flipUp", "FLIP UP needs [D][D]: one [D] among many other resources is refused, so is none, two are accepted", () => {
  const one = stFaceDown({ icons: { deception: 1, greed: 6 } });
  refused(flipSt(one), "one [D]");
  assert.equal(isFaceDown(one.engine, one.id("st")), true);
  assert.equal(ready(one.engine), 8, "nothing was paid");
  const none = stFaceDown({ icons: { greed: 7 } });
  refused(flipSt(none), "no [D]");
  const two = stFaceDown({ icons: { deception: 2, greed: 2 } });
  flipStFully(two);
  assert.equal(isFaceDown(two.engine, two.id("st")), false, "control: two [D] are enough");
});

clause(STRUMPET, "2:flipUp", "the card's own Volition does not provide the [D], and the opponent's [D] do not count", () => {
  const onlyVolition = stFaceDown({ icons: { greed: 6 } });
  refused(flipSt(onlyVolition), "no [D] anywhere");
  const theirs = stFaceDown({ icons: { deception: 1, greed: 4 }, oppIcons: { deception: 6 } });
  refused(flipSt(theirs), "only one [D] of mine");
  assert.equal(isFaceDown(theirs.engine, theirs.id("st")), true);
});

clause(STRUMPET, "2:flipUp", "a spent [D] still meets the threshold while ready resources pay the 4", () => {
  const g = stBoard({ st: "faceDown", icons: { greed: 4 }, extra: spent("deception", 2) });
  flipStFully(g);
  assert.equal(isFaceDown(g.engine, g.id("st")), false, "spent [D] still meet the threshold (CR 405.6)");
});

clause(STRUMPET, "2:flipUp", "'play a resource': a resource card from my hand enters play face-up and provides its icon", () => {
  const g = stFaceDown();
  const before = g.engine.getThresholds(P1).deception ?? 0;
  flipStFully(g, "hres");
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
  assert.equal(isFaceDown(g.engine, g.id("hres")), false, "an actual resource card is played face-up");
  assert.equal(g.engine.getThresholds(P1).deception ?? 0, before + 1);
  assert.equal(zoneOf(g.engine, g.id("hchar2")), "hand", "the other hand cards stay");
});

clause(STRUMPET, "2:flipUp", "'play a resource': a card that is not a resource enters play face-down and provides Volition", () => {
  const g = stFaceDown();
  const volBefore = g.engine.getThresholds(P1).volition ?? 0;
  flipStFully(g, "hchar2");
  assert.equal(zoneOf(g.engine, g.id("hchar2")), "play");
  assert.equal(isFaceDown(g.engine, g.id("hchar2")), true, "a non-resource can only be played face-down");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, volBefore - 1 + 1, "the Strumpet's own Volition left, the new face-down card's arrived");
});

clause(STRUMPET, "2:flipUp", "'play a resource' is not a 'may': the player cannot decline to play one when they have a card in hand", () => {
  const g = stFaceDown();
  flipSt(g)();
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "declining to play a resource");
  assert.ok(pending(g.engine), "the demand to play a resource is still standing");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
});

clause(STRUMPET, "2:flipUp", "the resource to play is a Flip Up cost, so FLIP UP with no card in my hand to play is refused", () => {
  const g = stBoard({ st: "faceDown", noHand: true });
  assert.equal(handOf(g.engine, P1).length, 0, "control: my hand is empty");
  refused(flipSt(g), "no card to play as the resource");
  assert.equal(isFaceDown(g.engine, g.id("st")), true, "still face-down");
});

clause(STRUMPET, "2:flipUp", "'play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2, 605.1b)", () => holdResourceFace(() => {
  const g = stFaceDown();
  flipSt(g)();
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("hres")] });
  const asked = g.engine.state.pendingChoice !== undefined && g.engine.state.cards[g.id("hres")].zone === "hand";
  const faceDown = g.engine.state.cards[g.id("hres")].zone === "play" && g.engine.state.cards[g.id("hres")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(STRUMPET, "2:flipUp", "playing the resource this way does not use up my Develop Rule", () => {
  const g = stFaceDown();
  flipStFully(g);
  assert.ok(developOffers(g.engine, P1).length > 0, "the Develop Rule offers something");
  developResource(g.engine, P1, g.id("hchar2"), true);
  assert.equal(zoneOf(g.engine, g.id("hchar2")), "play", "I can still develop a resource afterwards");
});

clause(STRUMPET, "2:flipUp", "FLIP UP on my own turn works", () => {
  const g = stFaceDown();
  flipStFully(g);
  assert.equal(zoneOf(g.engine, g.id("st")), "play");
});

clause(STRUMPET, "2:flipUp", "the card's own rules text lets it be deployed whenever a tactic could be, so FLIP UP works in response during the opponent's attack too (CR 507.4d)", () => {
  const g = stFaceDown({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  flipStFully(g);
  resolvePendingResponses(g.engine);
  assert.equal(isFaceDown(g.engine, g.id("st")), false, "flipped up in response to the attack");
  assert.equal(zoneOf(g.engine, g.id("st")), "play");
});

clause(STRUMPET, "2:flipUp", "...but not on my opponent's turn when there is no response window (still no tactic could be played)", () => {
  const g = stFaceDown({ turn: 2, active: P2 });
  refused(flipSt(g), "nothing to respond to");
  assert.equal(isFaceDown(g.engine, g.id("st")), true);
  assert.equal(ready(g.engine), 7, "nothing was paid");
});

clause(STRUMPET, "2:flipUp", "a flipped-up Strumpet is a new arrival: it cannot attack the turn it flipped", () => {
  const g = stFaceDown();
  flipStFully(g);
  refused(
    () => g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("st")], target: { type: "faction", playerId: P2 } }),
    "a card that just flipped up is a new arrival and cannot attack (CR 411.3, 204.3)",
  /did not start the turn in play/
  );
});

clause(STRUMPET, "2:flipUp", "a face-down Strumpet that was already spent this turn (attached to my faction) is still a face-down resource in play and can be flipped up (CR 507.4a)", () => {
  const g = stBoard({ st: "faceDown", stSpent: true });
  assert.equal(g.engine.state.cards[g.id("st")].attachedTo, g.engine.state.players[P1].factionId, "setup: spent on my faction");
  flipStFully(g);
  assert.equal(isFaceDown(g.engine, g.id("st")), false);
});

clause(STRUMPET, "2:flipUp", "a flipped-up card is played as though from the hand (CR 507.4a), so the opponent gets the chance to respond before it enters play", () => {
  const g = stFaceDown();
  holdFlipUp(() => flipSt(g)());
  // the rider's pick is asked before the flip (it is part of the cost); answering it flips the card
  if (pending(g.engine)) g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("hres")] } } as never);
  assert.ok(g.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("st")), "deploying", "the character is being deployed, it has not entered play yet");
});

clause(STRUMPET, "2:flipUp", "it can only be flipped by its controller, and only while it is face-down in play (not face-up, not in hand)", () => {
  const theirs = stFaceDown({ oppIcons: { deception: 6 } });
  refused(flipSt(theirs, P2), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("st")), true);
  const faceUp = stBoard({ st: "play" });
  refused(flipSt(faceUp), "already face-up");
});

// =================================================================================
// Drygulch
// COST: Pick a character.
// EFFECT: Remove the character from the game if it has X life or less, where X is the number of [D] you control.
// Tactic, cost 2, [D].
// =================================================================================

const DRYGULCH = "052053ff-5823-4d01-9a23-e3c488c991cd";

interface DgOpts {
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  /** false: no face-down card of mine (it would add a ready Volition resource) */
  hidden?: boolean;
  extra?: CardPlacement[];
}

/**
 * P1: dg (Drygulch in hand), characters m1 / m3 / m5 (life 1 / 3 / 5), thing (item), place (location), a face-down character mfd, an item in hand.
 * P2: f2 / f4 / f6 (life 2 / 4 / 6), a face-down character ofd, an item. Default P1's turn 1, [D] x3.
 */
function dgBoard(o: DgOpts = {}) {
  const chars = (prefix: string, owner: PlayerId, lives: number[]): CardPlacement[] =>
    lives.map((life) => ({ key: `${prefix}${life}`, def: character({ name: `${prefix.toUpperCase()} Life ${life}`, strength: 2, life, speed: 2 }), owner, zone: "play" as const }));
  return devBoard(
    [
      { key: "dg", def: printing(DRYGULCH), owner: P1, zone: "hand" },
      ...chars("m", P1, [1, 3, 5]),
      ...chars("f", P2, [2, 4, 6]),
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...(o.hidden === false ? [] : [{ key: "mfd", def: character({ name: "My Hidden", life: 1 }), owner: P1, zone: "play" as const, faceDown: true }]),
      { key: "ofd", def: character({ name: "Their Hidden", life: 1 }), owner: P2, zone: "play", faceDown: true },
      { key: "mh", def: character({ name: "Hand Character", life: 1 }), owner: P1, zone: "hand" },
      { key: "mx", def: character({ name: "Discarded Character", life: 1 }), owner: P1, zone: "discard" },
      ...res(o.icons ?? { deception: 3 }),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type DgGame = ReturnType<typeof dgBoard>;
const drygulch = (g: DgGame, key: string) => play(g.engine, P1, g.id("dg"), { selected: { c: [g.id(key)] } });
const drygulchAttempt = (g: DgGame, ...keys: string[]) => () => playRaw(g.engine, P1, g.id("dg"), { selected: { c: keys.map((key) => g.id(key)) } });

clause(DRYGULCH, "0:ability", "a character with life equal to X is removed from the game: [D] x3 and a 3-life character", () => {
  const g = dgBoard();
  drygulch(g, "m3");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("m3")), "removed", "removed from the game, not destroyed");
  assert.equal(discardOf(g.engine, P1).includes(g.id("m3")), false);
  assert.ok(removedOf(g.engine, P1).includes(g.id("m3")), "removedOf(g.engine, P1).includes(g.id(\"m3\"))");
});

clause(DRYGULCH, "0:ability", "a character with LESS life than X is removed: [D] x3 and a 1-life character, a 2-life character", () => {
  const a = dgBoard();
  drygulch(a, "m1");
  assert.equal(zoneOf(a.engine, a.id("m1")), "removed");
  const b = dgBoard();
  drygulch(b, "f2");
  assert.equal(zoneOf(b.engine, b.id("f2")), "removed");
});

clause(DRYGULCH, "0:ability", "a character with MORE life than X stays: [D] x3 and a 4-life character (one more than X)", () => {
  const g = dgBoard();
  drygulch(g, "f4");
  assert.equal(zoneOf(g.engine, g.id("f4")), "play");
  assert.equal(g.engine.state.cards[g.id("f4")].damage, 0);
  assert.equal(zoneOf(g.engine, g.id("dg")), "discard", "the tactic still resolved");
});

clause(DRYGULCH, "0:ability", "a far tougher character stays too (6 life against X = 3)", () => {
  const g = dgBoard();
  drygulch(g, "f6");
  assert.equal(zoneOf(g.engine, g.id("f6")), "play");
});

clause(DRYGULCH, "0:ability", "X changes with the [D] I control: with [D] x5 a 5-life character is removed, with [D] x4 it is not", () => {
  const five = dgBoard({ icons: { deception: 5 } });
  drygulch(five, "m5");
  assert.equal(zoneOf(five.engine, five.id("m5")), "removed", "X = 5");
  const four = dgBoard({ icons: { deception: 4 } });
  drygulch(four, "m5");
  assert.equal(zoneOf(four.engine, four.id("m5")), "play", "X = 4");
  const two = dgBoard({ icons: { deception: 2 } });
  drygulch(two, "m3");
  assert.equal(zoneOf(two.engine, two.id("m3")), "play", "X = 2 and a 3-life character");
});

clause(DRYGULCH, "0:ability", "X = 1 (a single [D]) removes a 1-life character only", () => {
  const g = dgBoard({ icons: { deception: 1, greed: 2 } });
  drygulch(g, "m1");
  assert.equal(zoneOf(g.engine, g.id("m1")), "removed");
  const h = dgBoard({ icons: { deception: 1, greed: 2 } });
  drygulch(h, "f2");
  assert.equal(zoneOf(h.engine, h.id("f2")), "play", "2 life against X = 1");
});

clause(DRYGULCH, "0:ability", "it can pick my own character as well as my opponent's", () => {
  const mine = dgBoard();
  drygulch(mine, "m3");
  assert.equal(zoneOf(mine.engine, mine.id("m3")), "removed");
  const theirs = dgBoard();
  drygulch(theirs, "f2");
  assert.equal(zoneOf(theirs.engine, theirs.id("f2")), "removed");
});

clause(DRYGULCH, "0:ability", "only the picked character is removed", () => {
  const g = dgBoard();
  drygulch(g, "f2");
  for (const key of ["m1", "m3", "m5", "f4", "f6"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
});

clause(DRYGULCH, "0:ability", "a removed character goes to its owner's out-of-game area: one I stole goes to my opponent's", () => {
  const g = dgBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", life: 2 }), owner: P2, controller: P1, zone: "play" }] });
  drygulch(g, "stolen");
  assert.ok(removedOf(g.engine, P2).includes(g.id("stolen")), "its owner's removed pile");
  assert.equal(removedOf(g.engine, P1).includes(g.id("stolen")), false);
});

clause(DRYGULCH, "0:ability", "life is the character's life STAT: damage on it does not make it 'have' less life (a 5-life character with 3 damage is not removed at X = 3)", () => {
  const g = dgBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, zone: "play", damage: 3 }] });
  drygulch(g, "hurt");
  assert.equal(zoneOf(g.engine, g.id("hurt")), "play");
});

clause(DRYGULCH, "0:ability", "life includes modifiers: a 2-life character with +3 life from gear (5) stays, a 5-life one reduced to 3 by gear is removed", () => {
  const lifeGear = (amount: number) =>
    item({ name: `Life Gear ${amount}`, attachTo: "character", behavior: { abilities: [{ id: "lg", type: "continuous", modifiers: [{ target: "attachedTo", stat: "life", operation: "add", value: amount }] }] } });
  const g = dgBoard({
    extra: [
      { key: "fat", def: character({ name: "Fattened", life: 2 }), owner: P2, zone: "play" },
      { key: "fatGear", def: lifeGear(3), owner: P2, zone: "play", attachedToKey: "fat" },
      { key: "thin", def: character({ name: "Thinned", life: 5 }), owner: P2, zone: "play" },
      { key: "thinGear", def: lifeGear(-2), owner: P2, zone: "play", attachedToKey: "thin" }
    ]
  });
  assert.equal(g.engine.getStat(g.id("fat"), "life"), 5);
  assert.equal(g.engine.getStat(g.id("thin"), "life"), 3);
  drygulch(g, "fat");
  assert.equal(zoneOf(g.engine, g.id("fat")), "play", "5 life against X = 3");
  const h = dgBoard({
    extra: [
      { key: "thin", def: character({ name: "Thinned", life: 5 }), owner: P2, zone: "play" },
      { key: "thinGear", def: lifeGear(-2), owner: P2, zone: "play", attachedToKey: "thin" }
    ]
  });
  drygulch(h, "thin");
  assert.equal(zoneOf(h.engine, h.id("thin")), "removed", "3 life against X = 3");
});

clause(DRYGULCH, "0:ability", "X counts [D] only: Greed, Rage and Volition do not raise it", () => {
  const g = dgBoard({ icons: { deception: 2, greed: 4, rage: 3 }, extra: volition(3) });
  drygulch(g, "m3");
  assert.equal(zoneOf(g.engine, g.id("m3")), "play", "X = 2, not 12");
});

clause(DRYGULCH, "0:ability", "X counts my [D] only: my opponent's [D] do not raise it", () => {
  const g = dgBoard({ icons: { deception: 2 }, oppIcons: { deception: 6 } });
  drygulch(g, "m3");
  assert.equal(zoneOf(g.engine, g.id("m3")), "play");
});

clause(DRYGULCH, "0:ability", "the resources I pay with are still [D] I control: with exactly [D] x2 (both spent on the cost of 2) X is still 2", () => {
  const g = dgBoard({ icons: { deception: 2 } });
  drygulch(g, "f2");
  assert.equal(attachedCount(g.engine, P1), 2, "setup: the two resources I paid with are spent");
  assert.equal(zoneOf(g.engine, g.id("f2")), "removed", "X = 2 counts the spent [D]");
});

clause(DRYGULCH, "0:ability", "spent [D] count as well as ready ones", () => {
  const g = dgBoard({ icons: { deception: 1 }, extra: spent("deception", 2) });
  drygulch(g, "m3");
  assert.equal(zoneOf(g.engine, g.id("m3")), "removed", "X = 3");
});

clause(DRYGULCH, "0:ability", "a card that PROVIDES [D][D] counts both icons", () => {
  const provider = character({ name: "Double Provider", resource: { provides: ["deception", "deception"] } });
  const g = dgBoard({ icons: { deception: 2, greed: 1 }, extra: [{ key: "prov", def: provider, owner: P1, zone: "play" }] });
  assert.equal(g.engine.getThresholds(P1).deception ?? 0, 4, "setup");
  drygulch(g, "f4");
  assert.equal(zoneOf(g.engine, g.id("f4")), "removed", "X = 4");
});

clause(DRYGULCH, "0:ability", "X is counted when Drygulch resolves: if my opponent removes one of my [D] in response, X is smaller and the character survives", () => {
  const g = dgBoard({ icons: { deception: 4 }, extra: [{ key: "rm", def: removerTactic(), owner: P2, zone: "hand" }] });
  const myDeception = playOf(g.engine, P1).filter((cardId) => g.engine.getDefinition(cardId).name === "Deception");
  playRaw(g.engine, P1, g.id("dg"), { selected: { c: [g.id("f4")] } });
  assert.equal(zoneOf(g.engine, g.id("f4")), "play");
  respondWith(g.engine, P2, g.id("rm"), { t: [myDeception[0]] });
  assert.equal(zoneOf(g.engine, myDeception[0]), "removed", "setup: they removed a [D]");
  assert.equal(zoneOf(g.engine, g.id("f4")), "play", "X is 3 now: a 4-life character survives");
  assert.equal(zoneOf(g.engine, g.id("dg")), "discard");
});

clause(DRYGULCH, "0:ability", "the life is judged when it resolves too: a response that makes the character tougher saves it", () => {
  const lifeTactic = tactic({
    name: "Toughen",
    cost: 0,
    behavior: { abilities: [{ id: "tough", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: 5, duration: { type: "untilEndOfTurn" } }] }] }
  });
  const g = dgBoard({ extra: [{ key: "tough", def: lifeTactic, owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("dg"), { selected: { c: [g.id("f2")] } });
  respondWith(g.engine, P2, g.id("tough"), { t: [g.id("f2")] });
  assert.equal(zoneOf(g.engine, g.id("f2")), "play", "7 life against X = 3");
});

clause(DRYGULCH, "0:ability", "removal is not destruction: a Recyclable Golem with no token (which flips face-down when DESTROYED) is simply removed from the game", () => {
  const g = dgBoard({
    icons: { deception: 6 },
    extra: [{ key: "golem", def: printing(RECYCLABLE), owner: P2, zone: "play" }]
  });
  assert.equal(g.engine.getStat(g.id("golem"), "life"), 6);
  drygulch(g, "golem");
  assert.equal(zoneOf(g.engine, g.id("golem")), "removed");
  assert.equal(isFaceDown(g.engine, g.id("golem")), false);
});

clause(DRYGULCH, "0:ability", "a character removed from the game takes the item attached to it along (CR 301.4a)", () => {
  const gear = item({ name: "Attached Gear", attachTo: "character" });
  const g = dgBoard({ extra: [{ key: "gear", def: gear, owner: P2, zone: "play", attachedToKey: "f2" }] });
  drygulch(g, "f2");
  assert.equal(zoneOf(g.engine, g.id("f2")), "removed");
  assert.equal(zoneOf(g.engine, g.id("gear")), "removed", "the attached card leaves play the same way");
});

clause(DRYGULCH, "0:ability", "a removed character that was in a battle leaves it: removing an attacker in response ends the attack", () => {
  const g = dgBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("f2")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("dg"), { c: [g.id("f2")] });
  assert.equal(zoneOf(g.engine, g.id("f2")), "removed");
  assert.equal(battleOf(g.engine)?.attackingParty.includes(g.id("f2")) ?? false, false);
});

clause(DRYGULCH, "0:ability", "only CHARACTERS can be picked: an item, a location, a faction and a face-down card are refused", () => {
  const g = dgBoard();
  refused(drygulchAttempt(g, "thing"), "an item");
  refused(drygulchAttempt(g, "place"), "a location");
  refused(() => playRaw(g.engine, P1, g.id("dg"), { selected: { c: [g.engine.state.players[P2].factionId!] } }), "a faction");
  refused(drygulchAttempt(g, "mfd"), "my face-down card (only a resource)");
  refused(drygulchAttempt(g, "ofd"), "their face-down card");
  refused(drygulchAttempt(g, "mh"), "a character in my hand");
  refused(drygulchAttempt(g, "mx"), "a character in my discard pile");
  assert.equal(zoneOf(g.engine, g.id("dg")), "hand", "nothing was played");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
  drygulch(g, "m3");
  assert.equal(zoneOf(g.engine, g.id("m3")), "removed", "control: a character is accepted");
});

clause(DRYGULCH, "0:ability", "exactly one character must be picked: none and two are refused", () => {
  const g = dgBoard();
  refused(drygulchAttempt(g), "no pick");
  refused(drygulchAttempt(g, "m1", "m3"), "two characters");
  assert.equal(zoneOf(g.engine, g.id("dg")), "hand");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
});

clause(DRYGULCH, "0:ability", "it costs exactly 2", () => {
  const g = dgBoard({ icons: { deception: 3 } });
  drygulch(g, "f4");
  assert.equal(attachedCount(g.engine, P1), 2);
});

clause(DRYGULCH, "0:ability", "it needs [D]: Greed alone is refused, one [D] among others is enough, and two ready resources are needed", () => {
  const greed = dgBoard({ icons: { greed: 5 } });
  refused(drygulchAttempt(greed, "m1"), "no [D]");
  const one = dgBoard({ icons: { deception: 1, greed: 1 } });
  drygulch(one, "m1");
  assert.equal(zoneOf(one.engine, one.id("m1")), "removed", "control: one [D] and a second resource");
  const short = dgBoard({ icons: { deception: 1 }, hidden: false });
  assert.equal(ready(short.engine), 1, "setup: a single ready resource");
  refused(drygulchAttempt(short, "m1"), "cost 2 with one resource");
  assert.equal(zoneOf(short.engine, short.id("dg")), "hand");
});

clause(DRYGULCH, "0:ability", "my opponent's [D] and my Volition are not my [D]", () => {
  const theirs = dgBoard({ icons: { greed: 5 }, oppIcons: { deception: 5 } });
  refused(drygulchAttempt(theirs, "m1"), "their [D]");
  const vol = dgBoard({ icons: {}, extra: volition(5) });
  refused(drygulchAttempt(vol, "m1"), "Volition");
});

clause(DRYGULCH, "0:ability", "the pick is a cost: the character is still in play while my opponent may respond, and the tactic ends in my discard pile", () => {
  const g = dgBoard();
  playRaw(g.engine, P1, g.id("dg"), { selected: { c: [g.id("m3")] } });
  assert.equal(g.engine.state.priorityPlayerId, P2);
  assert.equal(zoneOf(g.engine, g.id("m3")), "play");
  assert.equal(zoneOf(g.engine, g.id("dg")), "deploying");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("m3")), "removed");
  assert.equal(zoneOf(g.engine, g.id("dg")), "discard");
});

clause(DRYGULCH, "0:ability", "if the picked character leaves play in response (destroyed), the effect loses track of it (CR 402.4): it stays in the discard pile and is not removed from the game", () => {
  const g = dgBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("dg"), { selected: { c: [g.id("f2")] } });
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("f2")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("f2")), "discard", "it stays where it went");
  assert.equal(zoneOf(g.engine, g.id("dg")), "discard");
});

clause(DRYGULCH, "0:ability", "if the picked character is put into its owner's hand in response, Drygulch still resolves and the character stays in the hand (CR 402.4)", () => {
  const g = dgBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("dg"), { selected: { c: [g.id("f2")] } });
  respondWith(g.engine, P2, g.id("bounce"), { t: [g.id("f2")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("f2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("dg")), "discard");
});

clause(DRYGULCH, "0:ability", "being a tactic it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = dgBoard({ turn: 2, active: P2 });
  refused(drygulchAttempt(g, "f2"), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("f2")]);
  respondWith(g.engine, P1, g.id("dg"), { c: [g.id("f2")] });
  assert.equal(zoneOf(g.engine, g.id("f2")), "removed");
});

// =================================================================================
// Epicureous Mammajamma
// SLAP IT UP -- COST: Pay 1. -- EFFECT: This turn, this card loses 1 strength and gains 1 life.
// FLIP IT -- COST: Pay 1. -- EFFECT: This turn, this card loses 1 life and gains 1 strength.
// RUB IT DOWN -- COST: Pay 1. -- EFFECT: This turn, this card loses 1 strength or 1 life and gains 1 speed.
// Character (hedonist), cost 5, [D], 3 strength / 3 speed / 3 life.
// =================================================================================

const MAMMA = "e2ae141f-1ec6-4613-9cd9-0401a36538db";

interface EmOpts {
  em?: "play" | "hand" | "faceDown";
  emOwner?: PlayerId;
  emController?: PlayerId;
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  damage?: number;
  hidden?: boolean;
  extra?: CardPlacement[];
}

/** P1: em (the Mammajamma), ally (character). P2: foe (character 3/3/3). Default P1's turn 1, [G] x8 (the abilities need no icon). */
function emBoard(o: EmOpts = {}) {
  const where = o.em ?? "play";
  return devBoard(
    [
      {
        key: "em",
        def: printing(MAMMA),
        owner: o.emOwner ?? P1,
        controller: o.emController,
        zone: where === "hand" ? "hand" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        damage: o.damage
      },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" },
      ...res(o.icons ?? { greed: 8 }),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type EmGame = ReturnType<typeof emBoard>;
const emStats = (g: EmGame) => ({
  strength: g.engine.getStat(g.id("em"), "strength"),
  speed: g.engine.getStat(g.id("em"), "speed"),
  life: g.engine.getStat(g.id("em"), "life")
});
const emUse = (g: EmGame, abilityId: string, key = "em") => activate(g.engine, P1, g.id(key), abilityId);
const emAttempt = (g: EmGame, abilityId: string, player: PlayerId = P1) => () => actRaw(g.engine, player, g.id("em"), abilityId);
/** RUB IT DOWN: answers the "strength or life" question (0 = strength, 1 = life) */
function rubItDown(g: EmGame, loses: "strength" | "life"): void {
  actRaw(g.engine, P1, g.id("em"), "rub-it-down");
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the choice is mine");
  const options = (pc.options as Array<{ label?: string }>) ?? [];
  const index = options.findIndex((option) => new RegExp(loses, "i").test(option.label ?? ""));
  answerPending(g.engine, "chooserSelectsOption", { index: index < 0 ? (loses === "strength" ? 0 : 1) : index });
}

// --- SLAP IT UP -----------------------------------------------------------------------------

clause(MAMMA, "0:ability:slap-it-up", "this turn it loses 1 strength and gains 1 life: 3/3/3 becomes 2 strength / 3 speed / 4 life", () => {
  const g = emBoard();
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 });
  emUse(g, "slap-it-up");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(emStats(g), { strength: 2, speed: 3, life: 4 });
});

clause(MAMMA, "0:ability:slap-it-up", "the cost is exactly 1 resource", () => {
  const g = emBoard();
  const before = ready(g.engine);
  emUse(g, "slap-it-up");
  assert.equal(before - ready(g.engine), 1);
});

clause(MAMMA, "0:ability:slap-it-up", "it needs no threshold: Greed pays for it", () => {
  const g = emBoard({ icons: { greed: 1 } });
  emUse(g, "slap-it-up");
  assert.equal(emStats(g).strength, 2);
});

clause(MAMMA, "0:ability:slap-it-up", "it can be used again and again: two uses make 1/3/5, three uses 0/3/6", () => {
  const g = emBoard();
  emUse(g, "slap-it-up");
  emUse(g, "slap-it-up");
  assert.deepEqual(emStats(g), { strength: 1, speed: 3, life: 5 });
  emUse(g, "slap-it-up");
  assert.deepEqual(emStats(g), { strength: 0, speed: 3, life: 6 });
  assert.equal(ready(g.engine), 5, "paid 1 each time");
});

clause(MAMMA, "0:ability:slap-it-up", "strength cannot go below 0 (CR 410.4): a fourth use leaves it at 0 strength, not -1, and it still gains the life", () => {
  const g = emBoard();
  for (let i = 0; i < 4; i++) emUse(g, "slap-it-up");
  assert.deepEqual(emStats(g), { strength: 0, speed: 3, life: 7 });
});

clause(MAMMA, "0:ability:slap-it-up", "it is only 'this turn': my next turn it is 3/3/3 again", () => {
  const g = emBoard();
  emUse(g, "slap-it-up");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 }, "gone at the next turn point");
  endTurn(g.engine, P2);
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 });
});

clause(MAMMA, "0:ability:slap-it-up", "only this card changes: other characters keep their stats", () => {
  const g = emBoard();
  emUse(g, "slap-it-up");
  assert.equal(g.engine.getStat(g.id("ally"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("ally"), "life"), 4);
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 3);
});

clause(MAMMA, "0:ability:slap-it-up", "the extra life really keeps it alive: with 2 damage, one more point of damage kills a 3-life Mammajamma but not one that used SLAP IT UP (4 life)", () => {
  const zap = () => tactic({ name: "Zap", cost: 0, behavior: { abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] } });
  const buffed = emBoard({ damage: 2, extra: [{ key: "zap", def: zap(), owner: P1, zone: "hand" }] });
  emUse(buffed, "slap-it-up");
  assert.equal(buffed.engine.getStat(buffed.id("em"), "life"), 4);
  play(buffed.engine, P1, buffed.id("zap"), { selected: { t: [buffed.id("em")] } });
  assert.equal(zoneOf(buffed.engine, buffed.id("em")), "play", "3 damage on 4 life");
  const plain = emBoard({ damage: 2, extra: [{ key: "zap", def: zap(), owner: P1, zone: "hand" }] });
  play(plain.engine, P1, plain.id("zap"), { selected: { t: [plain.id("em")] } });
  assert.equal(zoneOf(plain.engine, plain.id("em")), "discard", "control: 3 damage on 3 life");
});

clause(MAMMA, "0:ability:slap-it-up", "with no ready resource it cannot be used (nothing changes)", () => {
  const g = emBoard({ icons: {} });
  refused(emAttempt(g, "slap-it-up"), "nothing to pay with");
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 });
  const spentOnly = emBoard({ icons: {}, extra: spent("greed", 3) });
  refused(emAttempt(spentOnly, "slap-it-up"), "all resources are spent");
});

clause(MAMMA, "0:ability:slap-it-up", "the extra life is real in a battle: blocking a 3-strength attacker, using SLAP IT UP first lets it survive (4 life), without it it is destroyed (3 life)", () => {
  const board = () =>
    emBoard({
      turn: 2,
      active: P2,
      extra: [{ key: "atk", def: character({ name: "Attacker", strength: 3, life: 9, speed: 1 }), owner: P2, zone: "play" }]
    });
  const buffed = board();
  declareAttackBy(buffed.engine, P2, [buffed.id("atk")]);
  buffed.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [buffed.id("em")] });
  buffed.engine.perform({ type: "passPriority", playerId: P2 });
  actRaw(buffed.engine, P1, buffed.id("em"), "slap-it-up");
  resolvePendingResponses(buffed.engine);
  finishBattle(buffed.engine);
  assert.equal(zoneOf(buffed.engine, buffed.id("em")), "play", "4 life takes 3 damage");
  const plain = board();
  fight(plain.engine, P2, [plain.id("atk")], { type: "faction", playerId: P1 }, [plain.id("em")]);
  assert.equal(zoneOf(plain.engine, plain.id("em")), "discard", "control: 3 life takes 3 damage");
});

clause(MAMMA, "0:ability:slap-it-up", "only its controller can use it, and only from play (not from my hand, not face-down)", () => {
  const g = emBoard({ turn: 1, active: P1, extra: [{ key: "atk", def: character({ name: "My Attacker" }), owner: P1, zone: "play" }, ...res({ greed: 3 }, P2)] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(emAttempt(g, "slap-it-up", P2), "the Mammajamma is mine", /control|owner|yours|your/i);
  const inHand = emBoard({ em: "hand" });
  refused(emAttempt(inHand, "slap-it-up"), "in my hand", /Activated ability not found|not in play|play/i);
  const down = emBoard({ em: "faceDown" });
  refused(emAttempt(down, "slap-it-up"), "face-down", /Activated ability not found|face-down|rules text/i);
});

// --- FLIP IT ---------------------------------------------------------------------------------

clause(MAMMA, "1:ability:flip-it", "this turn it loses 1 life and gains 1 strength: 3/3/3 becomes 4 strength / 3 speed / 2 life", () => {
  const g = emBoard();
  emUse(g, "flip-it");
  assert.deepEqual(emStats(g), { strength: 4, speed: 3, life: 2 });
});

clause(MAMMA, "1:ability:flip-it", "the cost is exactly 1 resource, and no threshold is needed", () => {
  const g = emBoard({ icons: { greed: 3 } });
  const before = ready(g.engine);
  emUse(g, "flip-it");
  assert.equal(before - ready(g.engine), 1);
});

clause(MAMMA, "1:ability:flip-it", "two uses make 5 strength / 1 life", () => {
  const g = emBoard();
  emUse(g, "flip-it");
  emUse(g, "flip-it");
  assert.deepEqual(emStats(g), { strength: 5, speed: 3, life: 1 });
  assert.equal(zoneOf(g.engine, g.id("em")), "play");
});

clause(MAMMA, "1:ability:flip-it", "a third use takes its life to 0 and it is destroyed at once (damage 0 is not less than life 0, CR 204.5 / FAQ)", () => {
  const g = emBoard();
  emUse(g, "flip-it");
  emUse(g, "flip-it");
  emUse(g, "flip-it");
  assert.equal(zoneOf(g.engine, g.id("em")), "discard");
});

clause(MAMMA, "1:ability:flip-it", "damage it already has becomes lethal when its life drops: 2 damage on 3 life is fine, after FLIP IT (2 life) it is destroyed", () => {
  const g = emBoard({ damage: 2 });
  assert.equal(zoneOf(g.engine, g.id("em")), "play");
  emUse(g, "flip-it");
  assert.equal(zoneOf(g.engine, g.id("em")), "discard", "2 damage on 2 life");
});

clause(MAMMA, "1:ability:flip-it", "it is only 'this turn': my next turn it is 3/3/3 again", () => {
  const g = emBoard();
  emUse(g, "flip-it");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 });
});

clause(MAMMA, "1:ability:flip-it", "SLAP IT UP and FLIP IT cancel out: one of each leaves 3/3/3", () => {
  const g = emBoard();
  emUse(g, "slap-it-up");
  emUse(g, "flip-it");
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 });
});

clause(MAMMA, "1:ability:flip-it", "the extra strength is real in a battle: blocking a 4-life attacker it kills it only after FLIP IT", () => {
  const board = () =>
    emBoard({
      turn: 2,
      active: P2,
      extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" }]
    });
  const buffed = board();
  declareAttackBy(buffed.engine, P2, [buffed.id("atk")]);
  buffed.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [buffed.id("em")] });
  buffed.engine.perform({ type: "passPriority", playerId: P2 });
  actRaw(buffed.engine, P1, buffed.id("em"), "flip-it");
  resolvePendingResponses(buffed.engine);
  finishBattle(buffed.engine);
  assert.equal(zoneOf(buffed.engine, buffed.id("atk")), "discard", "4 strength kills the 4-life attacker");
  const plain = board();
  fight(plain.engine, P2, [plain.id("atk")], { type: "faction", playerId: P1 }, [plain.id("em")]);
  assert.equal(zoneOf(plain.engine, plain.id("atk")), "play", "control: 3 strength does not");
});

clause(MAMMA, "1:ability:flip-it", "with no ready resource it cannot be used", () => {
  const g = emBoard({ icons: {} });
  refused(emAttempt(g, "flip-it"), "nothing to pay with");
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 });
});

clause(MAMMA, "1:ability:flip-it", "only its controller can use it, and only from play", () => {
  const inHand = emBoard({ em: "hand" });
  refused(emAttempt(inHand, "flip-it"), "in my hand", /Activated ability not found|not in play|play/i);
  const down = emBoard({ em: "faceDown" });
  refused(emAttempt(down, "flip-it"), "face-down", /Activated ability not found|face-down|rules text/i);
});

// --- RUB IT DOWN -----------------------------------------------------------------------------

clause(MAMMA, "2:ability:rub-it-down", "choosing to lose 1 strength: 2 strength / 4 speed / 3 life", () => {
  const g = emBoard();
  rubItDown(g, "strength");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(emStats(g), { strength: 2, speed: 4, life: 3 });
});

clause(MAMMA, "2:ability:rub-it-down", "choosing to lose 1 life: 3 strength / 4 speed / 2 life", () => {
  const g = emBoard();
  rubItDown(g, "life");
  assert.deepEqual(emStats(g), { strength: 3, speed: 4, life: 2 });
});

clause(MAMMA, "2:ability:rub-it-down", "it is 'strength OR life', not both: exactly one of the two is lost", () => {
  const g = emBoard();
  rubItDown(g, "strength");
  assert.equal(g.engine.getStat(g.id("em"), "life"), 3, "life untouched when strength is chosen");
  const h = emBoard();
  rubItDown(h, "life");
  assert.equal(h.engine.getStat(h.id("em"), "strength"), 3, "strength untouched when life is chosen");
});

clause(MAMMA, "2:ability:rub-it-down", "the choice is mine (the controller's) and offers exactly the two options", () => {
  const g = emBoard();
  actRaw(g.engine, P1, g.id("em"), "rub-it-down");
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  assert.equal((pc.options as unknown[]).length, 2);
});

clause(MAMMA, "2:ability:rub-it-down", "it gains 1 speed whichever I choose, and the gain stacks: two uses make speed 5", () => {
  const g = emBoard();
  rubItDown(g, "strength");
  rubItDown(g, "life");
  assert.deepEqual(emStats(g), { strength: 2, speed: 5, life: 2 });
});

clause(MAMMA, "2:ability:rub-it-down", "the cost is exactly 1 resource, and no threshold is needed", () => {
  const g = emBoard({ icons: { greed: 3 } });
  const before = ready(g.engine);
  rubItDown(g, "strength");
  assert.equal(before - ready(g.engine), 1);
});

clause(MAMMA, "2:ability:rub-it-down", "it is only 'this turn': my next turn it is 3/3/3 again", () => {
  const g = emBoard();
  rubItDown(g, "life");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 });
});

clause(MAMMA, "2:ability:rub-it-down", "strength cannot go below 0 (CR 410.4): losing strength on a 0-strength Mammajamma leaves it at 0, and it still gains the speed", () => {
  const g = emBoard();
  for (let i = 0; i < 3; i++) emUse(g, "slap-it-up");
  assert.equal(g.engine.getStat(g.id("em"), "strength"), 0, "setup");
  rubItDown(g, "strength");
  assert.equal(g.engine.getStat(g.id("em"), "strength"), 0);
  assert.equal(g.engine.getStat(g.id("em"), "speed"), 4);
});

clause(MAMMA, "2:ability:rub-it-down", "losing life on a 1-life Mammajamma takes its life to 0 and destroys it at once (damage 0 is not less than life 0, CR 204.5 / FAQ)", () => {
  const g = emBoard();
  emUse(g, "flip-it");
  emUse(g, "flip-it");
  assert.equal(g.engine.getStat(g.id("em"), "life"), 1, "setup");
  rubItDown(g, "life");
  assert.equal(zoneOf(g.engine, g.id("em")), "discard");
});

clause(MAMMA, "2:ability:rub-it-down", "the extra speed is real in a battle: speed 4 strikes before a speed-3 attacker, killing it before it hits back", () => {
  const board = () =>
    emBoard({
      turn: 2,
      active: P2,
      extra: [{ key: "atk", def: character({ name: "Attacker", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" }]
    });
  const fast = board();
  declareAttackBy(fast.engine, P2, [fast.id("atk")]);
  fast.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [fast.id("em")] });
  fast.engine.perform({ type: "passPriority", playerId: P2 });
  actRaw(fast.engine, P1, fast.id("em"), "rub-it-down");
  resolvePendingResponses(fast.engine);
  answerPending(fast.engine, "chooserSelectsOption", { index: 1 }); // lose 1 life: 3 strength, 2 life, speed 4
  finishBattle(fast.engine);
  assert.equal(zoneOf(fast.engine, fast.id("atk")), "discard", "my speed-4 Mammajamma strikes first");
  assert.equal(zoneOf(fast.engine, fast.id("em")), "play", "...and takes no damage");
  const slow = board();
  fight(slow.engine, P2, [slow.id("atk")], { type: "faction", playerId: P1 }, [slow.id("em")]);
  assert.equal(zoneOf(slow.engine, slow.id("atk")), "discard", "control: at equal speed both die");
  assert.equal(zoneOf(slow.engine, slow.id("em")), "discard");
});

clause(MAMMA, "2:ability:rub-it-down", "with no ready resource it cannot be used, and nothing is asked", () => {
  const g = emBoard({ icons: {} });
  refused(emAttempt(g, "rub-it-down"), "nothing to pay with");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 });
});

clause(MAMMA, "2:ability:rub-it-down", "only its controller can use it, and only from play", () => {
  const inHand = emBoard({ em: "hand" });
  refused(emAttempt(inHand, "rub-it-down"), "in my hand", /Activated ability not found|not in play|play/i);
  const down = emBoard({ em: "faceDown" });
  refused(emAttempt(down, "rub-it-down"), "face-down", /Activated ability not found|face-down|rules text/i);
});

// =================================================================================
// Fired Hand
// If this card is destroyed, flip it face-down under its owner's control instead.
// PETTY VENGEANCE -- COST: Use this only while this card is a face-down resource. Reveal this card. Pay 1.
//   Discard a card. Pick a character. -- EFFECT: This turn, the character loses 1 life.
// Character (miner), cost 6, [D], 5 strength / 3 speed / 4 life.
// =================================================================================

const FIRED = "ce1bd138-b938-4d98-b69a-cc0ecf05d7d3";

/** A free tactic (id "kill-res", pick "t"): destroys one picked resource (a face-down card counts as one). */
function resourceKiller(name = "Resource Killer"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kill-res",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "resource" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

interface FhOpts {
  fh?: "play" | "faceDown" | "hand" | "discard";
  fhOwner?: PlayerId;
  fhController?: PlayerId;
  fhSpent?: boolean;
  damage?: number;
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  noHand?: boolean;
  second?: boolean;
  extra?: CardPlacement[];
}

/**
 * P1: fh (the Fired Hand), ally (2/4/2 character), hand: toss (character), toss2 (item). P2: foe (3/3/3), f2 (a 2-life character), fdc (face-down character), thing (item).
 * Default P1's turn 1, [G] x4.
 */
function fhBoard(o: FhOpts = {}) {
  const where = o.fh ?? "play";
  return devBoard(
    [
      {
        key: "fh",
        def: printing(FIRED),
        owner: o.fhOwner ?? P1,
        controller: o.fhController,
        zone: where === "faceDown" ? "play" : where,
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: where === "faceDown" && o.fhSpent ? "__factionA" : undefined,
        damage: o.damage
      },
      ...(o.second ? [{ key: "fh2", def: printing(FIRED), owner: P1, zone: "play" as const }] : []),
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...(o.noHand
        ? []
        : [
            { key: "toss", def: character({ name: "Toss Character" }), owner: P1, zone: "hand" as const },
            { key: "toss2", def: item({ name: "Toss Item" }), owner: P1, zone: "hand" as const }
          ]),
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "Foe Two", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" },
      { key: "fdc", def: character({ name: "Their Hidden", life: 2 }), owner: P2, zone: "play", faceDown: true },
      { key: "thing", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Their Place" }), owner: P2, zone: "play" },
      { key: "mx", def: character({ name: "My Discarded" }), owner: P1, zone: "discard" },
      ...res(o.icons ?? { greed: 4 }),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
}

type FhGame = ReturnType<typeof fhBoard>;
const fhWithKiller = (o: FhOpts = {}) => fhBoard({ ...o, extra: [...(o.extra ?? []), { key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
const fhKill = (g: FhGame, targetKey: string, player: PlayerId = P1) => {
  playRaw(g.engine, player, g.id("kill"), { selected: { t: [g.id(targetKey)] } });
  resolvePendingResponses(g.engine);
};

// --- 0:rule  If this card is destroyed, flip it face-down under its owner's control instead. ---

clause(FIRED, "0:rule", "destroyed: it is flipped face-down instead, still in play, not in the discard pile (no question asked)", () => {
  const g = fhWithKiller();
  fhKill(g, "fh");
  assert.equal(g.engine.state.pendingChoice, undefined, "not a 'may'");
  assert.equal(zoneOf(g.engine, g.id("fh")), "play");
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
  assert.equal(discardOf(g.engine, P1).includes(g.id("fh")), false);
});

clause(FIRED, "0:rule", "the flipped Fired Hand is a face-down resource: Volition, in my resource pool, no longer a character", () => {
  const g = fhWithKiller({ icons: { greed: 2 } });
  const readyBefore = ready(g.engine);
  fhKill(g, "fh");
  assert.equal(g.engine.isResource(g.id("fh")), true);
  assert.deepEqual(g.engine.getCardTypes(g.id("fh")), ["resource"]);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 1 + 0);
  assert.equal(ready(g.engine), readyBefore + 1);
});

clause(FIRED, "0:rule", "'under its owner's control': a Fired Hand I own that my opponent controls ends up face-down under MY control", () => {
  const g = fhWithKiller({ fhOwner: P1, fhController: P2 });
  fhKill(g, "fh");
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
  assert.equal(controllerOf(g.engine, g.id("fh")), P1);
  assert.ok(playOf(g.engine, P1).includes(g.id("fh")), "playOf(g.engine, P1).includes(g.id(\"fh\"))");
  assert.equal(playOf(g.engine, P2).includes(g.id("fh")), false);
});

clause(FIRED, "0:rule", "...and a Fired Hand my opponent owns that I control ends up face-down under THEIR control", () => {
  const g = fhWithKiller({ fhOwner: P2, fhController: P1 });
  fhKill(g, "fh");
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
  assert.equal(controllerOf(g.engine, g.id("fh")), P2);
});

clause(FIRED, "0:rule", "it applies whoever destroys it: my opponent's tactic too", () => {
  const g = fhBoard({ turn: 2, active: P2, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  fhKill(g, "fh", P2);
  assert.equal(zoneOf(g.engine, g.id("fh")), "play");
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
});

clause(FIRED, "0:rule", "the damage it had is forgotten when it flips (it is a new card)", () => {
  const g = fhWithKiller({ damage: 3 });
  fhKill(g, "fh");
  assert.equal(g.engine.state.cards[g.id("fh")].damage, 0);
});

clause(FIRED, "0:rule", "lethal battle damage also flips it instead: blocking a 4-strength attacker, it ends face-down in play and leaves the battle", () => {
  const g = fhBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  fight(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("fh")]);
  assert.equal(zoneOf(g.engine, g.id("fh")), "play", "4 damage on 4 life: destroyed, so flipped instead");
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
  assert.equal(g.engine.state.cards[g.id("fh")].damage, 0);
  assert.equal(g.engine.state.battle, undefined);
});

clause(FIRED, "0:rule", "a Fired Hand that is flipped away while blocking leaves the blocking party (it is not a character any more, CR 208.4)", () => {
  const g = fhWithKiller({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("fh")] });
  g.engine.perform({ type: "passPriority", playerId: P2 });
  respondWith(g.engine, P1, g.id("kill"), { t: [g.id("fh")] });
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
  assert.equal(battleOf(g.engine)?.blockingParty.includes(g.id("fh")) ?? false, false);
});

clause(FIRED, "0:rule", "only THIS card: a different character that is destroyed goes to the discard pile as usual", () => {
  const g = fhWithKiller();
  fhKill(g, "ally");
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("ally")), false);
  assert.equal(isFaceDown(g.engine, g.id("fh")), false, "the Fired Hand is untouched");
});

clause(FIRED, "0:rule", "with two Fired Hands destroying one flips only that one", () => {
  const g = fhWithKiller({ second: true });
  fhKill(g, "fh");
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
  assert.equal(isFaceDown(g.engine, g.id("fh2")), false);
  assert.equal(zoneOf(g.engine, g.id("fh2")), "play");
});

clause(FIRED, "0:rule", "destroying it as a COST is not replaced (CR 506.2): it goes straight to the discard pile", () => {
  const g = fhBoard({ extra: [{ key: "sacer", def: sacrificerChar(), owner: P1, zone: "play" }, ...fillers("dk", 2, P1, "deck")] });
  activate(g.engine, P1, g.id("sacer"), "sac", { selected: { v: [g.id("fh")] } });
  assert.equal(zoneOf(g.engine, g.id("fh")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("fh")), false);
});

clause(FIRED, "0:rule", "only DESTROYED is replaced: bounced to hand it goes to its owner's hand, removed from the game it is removed", () => {
  const bounced = fhBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(bounced.engine, P1, bounced.id("bounce"), { selected: { t: [bounced.id("fh")] } });
  assert.equal(zoneOf(bounced.engine, bounced.id("fh")), "hand");
  const removed = fhBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(removed.engine, P1, removed.id("rm"), { selected: { t: [removed.id("fh")] } });
  assert.equal(zoneOf(removed.engine, removed.id("fh")), "removed");
});

clause(FIRED, "0:rule", "it only works while it is a face-up character: a face-down Fired Hand has no rules text, and destroying that resource just destroys it", () => {
  const g = fhBoard({ fh: "faceDown", extra: [{ key: "kr", def: resourceKiller(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kr"), { selected: { t: [g.id("fh")] } });
  assert.equal(zoneOf(g.engine, g.id("fh")), "discard");
});

clause(FIRED, "0:rule", "a Fired Hand in my hand or discard pile is not affected by anything: it stays where it is", () => {
  for (const fh of ["hand", "discard"] as const) {
    const g = fhWithKiller({ fh });
    assert.equal(zoneOf(g.engine, g.id("fh")), fh);
  }
});

// --- 1:ability:petty-vengeance ------------------------------------------------------------------

const pettyVengeance = (g: FhGame, discard: string, pick: string, key = "fh") =>
  activate(g.engine, P1, g.id(key), "petty-vengeance", { selected: { toss: [g.id(discard)], c: [g.id(pick)] } });
const pettyAttempt = (g: FhGame, o: { discard?: string[]; pick?: string[]; player?: PlayerId; key?: string } = {}) => () =>
  actRaw(g.engine, o.player ?? P1, g.id(o.key ?? "fh"), "petty-vengeance", {
    ...(o.discard ? { toss: o.discard.map((key) => g.id(key)) } : {}),
    ...(o.pick ? { c: o.pick.map((key) => g.id(key)) } : {})
  });
const lifeOf = (g: FhGame, key: string): number => g.engine.getStat(g.id(key), "life");

clause(FIRED, "1:ability:petty-vengeance", "used from the face-down card: the picked character loses 1 life this turn", () => {
  const g = fhBoard({ fh: "faceDown" });
  assert.equal(lifeOf(g, "foe"), 3);
  pettyVengeance(g, "toss", "foe");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(lifeOf(g, "foe"), 2);
});

clause(FIRED, "1:ability:petty-vengeance", "only the picked character loses life: nobody else changes", () => {
  const g = fhBoard({ fh: "faceDown" });
  pettyVengeance(g, "toss", "foe");
  assert.equal(lifeOf(g, "f2"), 2);
  assert.equal(lifeOf(g, "ally"), 4);
  assert.equal(g.engine.getStat(g.id("foe"), "strength"), 3, "only life changes");
  assert.equal(g.engine.getStat(g.id("foe"), "speed"), 3);
});

clause(FIRED, "1:ability:petty-vengeance", "it can pick my own character too", () => {
  const g = fhBoard({ fh: "faceDown" });
  pettyVengeance(g, "toss", "ally");
  assert.equal(lifeOf(g, "ally"), 3);
});

clause(FIRED, "1:ability:petty-vengeance", "the uses stack: two uses on one character take 2 life", () => {
  const g = fhBoard({ fh: "faceDown", extra: [{ key: "toss3", def: character({ name: "Toss Three" }), owner: P1, zone: "hand" }] });
  pettyVengeance(g, "toss", "foe");
  pettyVengeance(g, "toss3", "foe");
  assert.equal(lifeOf(g, "foe"), 1);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(FIRED, "1:ability:petty-vengeance", "damage it already has becomes lethal: a 2-life character with 1 damage dies when it loses 1 life", () => {
  const g = fhBoard({ fh: "faceDown", extra: [{ key: "hurt", def: character({ name: "Hurt", life: 2 }), owner: P2, zone: "play", damage: 1 }] });
  assert.equal(zoneOf(g.engine, g.id("hurt")), "play");
  pettyVengeance(g, "toss", "hurt");
  assert.equal(zoneOf(g.engine, g.id("hurt")), "discard", "1 damage on 1 life");
});

clause(FIRED, "1:ability:petty-vengeance", "it is only 'this turn': my next turn the character has its life back", () => {
  const g = fhBoard({ fh: "faceDown" });
  pettyVengeance(g, "toss", "foe");
  endTurn(g.engine, P1);
  assert.equal(lifeOf(g, "foe"), 3, "gone at the next turn point");
});

clause(FIRED, "1:ability:petty-vengeance", "the cost: it pays exactly 1 and discards exactly the card I choose", () => {
  const g = fhBoard({ fh: "faceDown", icons: { greed: 3 } });
  pettyVengeance(g, "toss", "foe");
  assert.equal(attachedCount(g.engine, P1), 1, "one resource was spent");
  assert.equal(zoneOf(g.engine, g.id("toss")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("toss")), "discardOf(g.engine, P1).includes(g.id(\"toss\"))");
  assert.equal(zoneOf(g.engine, g.id("toss2")), "hand", "only the chosen card was discarded");
});

clause(FIRED, "1:ability:petty-vengeance", "any card can be discarded: an item as well as a character", () => {
  const g = fhBoard({ fh: "faceDown" });
  pettyVengeance(g, "toss2", "foe");
  assert.equal(zoneOf(g.engine, g.id("toss2")), "discard");
  assert.equal(lifeOf(g, "foe"), 2);
});

clause(FIRED, "1:ability:petty-vengeance", "the discard is a cost: with no card in my hand it cannot be used, and nothing is paid", () => {
  const g = fhBoard({ fh: "faceDown", noHand: true });
  refused(pettyAttempt(g, { pick: ["foe"] }), "no card to discard");
  refused(pettyAttempt(g, { discard: [], pick: ["foe"] }), "empty discard");
  assert.equal(lifeOf(g, "foe"), 3);
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(FIRED, "1:ability:petty-vengeance", "exactly one card is discarded: two are refused", () => {
  const g = fhBoard({ fh: "faceDown" });
  refused(pettyAttempt(g, { discard: ["toss", "toss2"], pick: ["foe"] }), "two cards");
  assert.equal(zoneOf(g.engine, g.id("toss")), "hand");
  assert.equal(lifeOf(g, "foe"), 3);
});

clause(FIRED, "1:ability:petty-vengeance", "the discarded card must come from my hand: cards in play, my discard pile and my opponent's hand are refused", () => {
  const g = fhBoard({ fh: "faceDown", extra: [{ key: "oh", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }] });
  refused(pettyAttempt(g, { discard: ["ally"], pick: ["foe"] }), "a character in play");
  refused(pettyAttempt(g, { discard: ["mx"], pick: ["foe"] }), "my discard pile");
  refused(pettyAttempt(g, { discard: ["oh"], pick: ["foe"] }), "my opponent's hand");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
  pettyVengeance(g, "toss", "foe");
  assert.equal(lifeOf(g, "foe"), 2, "control");
});

clause(FIRED, "1:ability:petty-vengeance", "the pick: only a character in play - an item, a location, a faction, a face-down card and a card in hand are refused", () => {
  const g = fhBoard({ fh: "faceDown" });
  refused(pettyAttempt(g, { discard: ["toss"], pick: ["thing"] }), "an item");
  refused(pettyAttempt(g, { discard: ["toss"], pick: ["place"] }), "a location");
  refused(pettyAttempt(g, { discard: ["toss"], pick: ["fdc"] }), "a face-down card");
  refused(pettyAttempt(g, { discard: ["toss"], pick: ["toss2"] }), "a card in my hand");
  refused(() => actRaw(g.engine, P1, g.id("fh"), "petty-vengeance", { toss: [g.id("toss")], c: [g.engine.state.players[P2].factionId!] }), "a faction");
  refused(pettyAttempt(g, { discard: ["toss"], pick: ["fh"] }), "the face-down Fired Hand itself is not a character");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("toss")), "hand");
});

clause(FIRED, "1:ability:petty-vengeance", "exactly one character must be picked: none and two are refused", () => {
  const g = fhBoard({ fh: "faceDown" });
  refused(pettyAttempt(g, { discard: ["toss"] }), "no pick");
  refused(pettyAttempt(g, { discard: ["toss"], pick: ["foe", "f2"] }), "two characters");
  assert.equal(attachedCount(g.engine, P1), 0);
});

clause(FIRED, "1:ability:petty-vengeance", "'Use this only while this card is a face-down resource': a face-up Fired Hand in play cannot use it", () => {
  const g = fhBoard({ fh: "play" });
  refused(pettyAttempt(g, { discard: ["toss"], pick: ["foe"] }), "face-up", /Activated ability not found|face-down|face up|resource|condition/i);
  assert.equal(lifeOf(g, "foe"), 3);
  assert.equal(zoneOf(g.engine, g.id("toss")), "hand");
});

clause(FIRED, "1:ability:petty-vengeance", "...nor one in my hand or my discard pile", () => {
  for (const fh of ["hand", "discard"] as const) {
    const g = fhBoard({ fh });
    refused(pettyAttempt(g, { discard: ["toss"], pick: ["foe"] }), `the Fired Hand is in my ${fh}`, /Activated ability not found|face-down|play|resource/i);
    assert.equal(lifeOf(g, "foe"), 3, fh);
  }
});

clause(FIRED, "1:ability:petty-vengeance", "it is usable the moment the Fired Hand has been flipped face-down by its own replacement", () => {
  const g = fhWithKiller();
  fhKill(g, "fh");
  assert.equal(isFaceDown(g.engine, g.id("fh")), true, "setup");
  pettyVengeance(g, "toss", "foe");
  assert.equal(lifeOf(g, "foe"), 2);
});

clause(FIRED, "1:ability:petty-vengeance", "'Reveal this card': the Fired Hand is revealed, and it STAYS a face-down resource afterwards (revealing is not flipping)", () => {
  const g = fhBoard({ fh: "faceDown" });
  pettyVengeance(g, "toss", "foe");
  const revealed = g.engine.getLog().flatMap((entry) => (entry.event?.type === "cardsRevealed" ? ((entry.event as { cardIds: string[] }).cardIds as string[]) : []));
  assert.deepEqual(revealed, [g.id("fh")]);
  assert.equal(zoneOf(g.engine, g.id("fh")), "play");
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
});

clause(FIRED, "1:ability:petty-vengeance", "'Reveal this card' is part of the COST: the Fired Hand is already revealed while my opponent decides how to respond", () => {
  const g = fhBoard({ fh: "faceDown" });
  actRaw(g.engine, P1, g.id("fh"), "petty-vengeance", { toss: [g.id("toss")], c: [g.id("foe")] });
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  const revealed = g.engine.getLog().flatMap((entry) => (entry.event?.type === "cardsRevealed" ? ((entry.event as { cardIds: string[] }).cardIds as string[]) : []));
  assert.deepEqual(revealed, [g.id("fh")], "revealed when I used it, before the opponent responds");
});

clause(FIRED, "1:ability:petty-vengeance", "the cost is paid when I use it: my opponent can respond, but the card is already discarded and the life is not lost yet", () => {
  const g = fhBoard({ fh: "faceDown" });
  actRaw(g.engine, P1, g.id("fh"), "petty-vengeance", { toss: [g.id("toss")], c: [g.id("foe")] });
  assert.equal(zoneOf(g.engine, g.id("toss")), "discard", "the discard was paid");
  assert.equal(lifeOf(g, "foe"), 3, "the effect has not happened yet");
  resolvePendingResponses(g.engine);
  assert.equal(lifeOf(g, "foe"), 2);
});

clause(FIRED, "1:ability:petty-vengeance", "the face-down Fired Hand can pay its own 1 (it is a ready face-down resource): with nothing else ready it still works", () => {
  const g = fhBoard({ fh: "faceDown", icons: {} });
  assert.equal(ready(g.engine), 1, "setup: only the face-down Fired Hand itself is ready");
  pettyVengeance(g, "toss", "foe");
  assert.equal(lifeOf(g, "foe"), 2);
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
});

clause(FIRED, "1:ability:petty-vengeance", "with every resource spent (the Fired Hand included) there is nothing to pay the 1 with", () => {
  const g = fhBoard({ fh: "faceDown", fhSpent: true, icons: {}, extra: spent("greed", 2) });
  assert.equal(ready(g.engine), 0, "setup");
  refused(pettyAttempt(g, { discard: ["toss"], pick: ["foe"] }), "nothing ready to pay with");
  assert.equal(lifeOf(g, "foe"), 3);
  assert.equal(zoneOf(g.engine, g.id("toss")), "hand");
});

clause(FIRED, "1:ability:petty-vengeance", "a Fired Hand that was spent earlier this turn is still a face-down resource: it can still use PETTY VENGEANCE, paying with another resource", () => {
  const g = fhBoard({ fh: "faceDown", fhSpent: true, icons: { greed: 2 } });
  pettyVengeance(g, "toss", "foe");
  assert.equal(lifeOf(g, "foe"), 2);
});

clause(FIRED, "1:ability:petty-vengeance", "being an ability it can be used in response on the opponent's turn", () => {
  const g = fhBoard({ fh: "faceDown", turn: 2, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("fh"), "petty-vengeance", { toss: [g.id("toss")], c: [g.id("foe")] });
  resolvePendingResponses(g.engine);
  assert.equal(lifeOf(g, "foe"), 2);
});

clause(FIRED, "1:ability:petty-vengeance", "if the picked character leaves play in response, the ability resolves and nothing happens (CR 402.5a)", () => {
  const g = fhBoard({ fh: "faceDown", extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  actRaw(g.engine, P1, g.id("fh"), "petty-vengeance", { toss: [g.id("toss")], c: [g.id("foe")] });
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("foe")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(isFaceDown(g.engine, g.id("fh")), true);
});

clause(FIRED, "1:ability:petty-vengeance", "only its controller can use it", () => {
  const g = fhBoard({ fh: "faceDown", turn: 1, active: P1, extra: [{ key: "atk", def: character({ name: "My Attacker" }), owner: P1, zone: "play" }, { key: "ph", def: character({ name: "Their Toss" }), owner: P2, zone: "hand" }, ...res({ greed: 2 }, P2)] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(pettyAttempt(g, { discard: ["ph"], pick: ["ally"], player: P2 }), "the Fired Hand is mine", /control|owner|yours|your/i);
  assert.equal(lifeOf(g, "ally"), 4);
});

clause(FIRED, "1:ability:petty-vengeance", "it can be used more than once a turn with enough cards and resources: no deplete", () => {
  const g = fhBoard({ fh: "faceDown", icons: { greed: 3 } });
  pettyVengeance(g, "toss", "f2");
  assert.equal(zoneOf(g.engine, g.id("f2")), "play", "2 life minus 1 is 1");
  pettyVengeance(g, "toss2", "f2");
  assert.equal(lifeOf(g, "f2"), 0);
});

// =================================================================================
// I Drink Your Milkshake!
// You may search your opponent's deck for a card. If you do, remove it from the game face-down. For the rest of
// the game, if your opponent plays a card, you may reveal the removed card if it has the same name. If you do,
// you may play it for free even if you cannot meet its threshold and terminate your opponent's card.
// (Playing a resource does not trigger this effect.)
// Tactic, cost 3, [D][D][D][D].
// =================================================================================

const MILKSHAKE = "6f1bdb80-2506-4724-bf83-950a81cc531a";

type MsType = "char" | "tac" | "item" | "loc";

/** A card of the given type named `name` that does something observable when it resolves under its controller: tactic/character/item/location all cost 0 / 1. */
function msCard(type: MsType | "res", name: string, extra: Partial<CardDefinition> = {}): CardDefinition {
  switch (type) {
    case "char":
      return character({ name, cost: 1, strength: 2, life: 2, speed: 2, ...extra });
    case "tac":
      return tactic({
        name,
        cost: 0,
        behavior: { abilities: [{ id: "ms-draw", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] },
        ...extra
      });
    case "item":
      return item({ name, cost: 1, ...extra });
    case "loc":
      return location({ name, cost: 1, ...extra });
    default:
      return resourceCard({ name, resource: { provides: ["rage"], staple: true }, ...extra });
  }
}

const MS_TYPES: MsType[] = ["char", "tac", "item", "loc"];
const MS_NAME: Record<MsType | "res", string> = { char: "Target Character", tac: "Target Tactic", item: "Target Item", loc: "Target Location", res: "Target Resource" };

interface MsOpts {
  ms?: "hand" | "discard" | "play" | "removedZone";
  icons?: Icons;
  oppIcons?: Icons;
  turn?: number;
  active?: PlayerId;
  random?: () => number;
  oppDeck?: number;
  extra?: CardPlacement[];
}

/**
 * Search phase. P1: ms (hand), a deck card md0.., [D] x4 (default). P2: a deck with one card of every type (dchar, dtac, ditem, dloc, dres)
 * plus od0.. fillers, a hand card oh, a discard card ox, a character in play opc. Default: P1's turn 1.
 */
function msSearchBoard(o: MsOpts = {}) {
  const where = o.ms ?? "hand";
  return devBoard(
    [
      { key: "ms", def: printing(MILKSHAKE), owner: P1, zone: where === "removedZone" ? "removed" : where },
      ...fillers("md", 3, P1, "deck"),
      { key: "dchar", def: msCard("char", "Deck Character"), owner: P2, zone: "deck" },
      { key: "dtac", def: msCard("tac", "Deck Tactic"), owner: P2, zone: "deck" },
      { key: "ditem", def: msCard("item", "Deck Item"), owner: P2, zone: "deck" },
      { key: "dloc", def: msCard("loc", "Deck Location"), owner: P2, zone: "deck" },
      { key: "dres", def: msCard("res", "Deck Resource"), owner: P2, zone: "deck" },
      ...fillers("od", o.oppDeck ?? 4, P2, "deck"),
      { key: "oh", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" },
      { key: "ox", def: character({ name: "Their Discarded Card" }), owner: P2, zone: "discard" },
      { key: "opc", def: character({ name: "Their Character" }), owner: P2, zone: "play" },
      ...res(o.icons ?? { deception: 4 }),
      ...res(o.oppIcons ?? {}, P2),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active, random: o.random }
  );
}

type MsGame = ReturnType<typeof msSearchBoard>;
// no pick for the "may search" = the player declines to search (Q2)
const milkshake = (g: MsGame, pick?: string) => play(g.engine, P1, g.id("ms"), { selected: pick ? { dig: [g.id(pick)] } : { dig: [], "__declined:dig": [] } });
const milkshakeAttempt = (g: MsGame, ...picks: string[]) => () => playRaw(g.engine, P1, g.id("ms"), { selected: { dig: picks.map((key) => g.id(key)) } });

// --- the search: You may search your opponent's deck for a card. If you do, remove it from the game face-down. ---

clause(MILKSHAKE, "0:rule", "I search my opponent's deck for a card and remove it from the game: it leaves their deck and sits in their out-of-game area", () => {
  const g = msSearchBoard();
  milkshake(g, "dchar");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("dchar")), "removed");
  assert.ok(removedOf(g.engine, P2).includes(g.id("dchar")), "in its owner's removed area");
  assert.equal(deckOf(g.engine, P2).includes(g.id("dchar")), false);
  assert.equal(removedOf(g.engine, P1).includes(g.id("dchar")), false);
  assert.equal(handOf(g.engine, P1).includes(g.id("dchar")), false);
});

clause(MILKSHAKE, "0:rule", "the card is removed from the game FACE-DOWN", () => {
  const g = msSearchBoard();
  milkshake(g, "dchar");
  assert.equal(zoneOf(g.engine, g.id("dchar")), "removed");
  assert.equal(isFaceDown(g.engine, g.id("dchar")), true, "removed face-down");
});

clause(MILKSHAKE, "0:rule", "any card can be picked, whatever its type: a character, a tactic, an item, a location, a resource", () => {
  for (const key of ["dchar", "dtac", "ditem", "dloc", "dres", "od0"]) {
    const g = msSearchBoard();
    milkshake(g, key);
    assert.equal(zoneOf(g.engine, g.id(key)), "removed", key);
  }
});

clause(MILKSHAKE, "0:rule", "only the card I pick is removed: the rest of their deck stays (one card fewer)", () => {
  const g = msSearchBoard();
  const before = deckOf(g.engine, P2);
  milkshake(g, "dtac");
  const after = deckOf(g.engine, P2);
  assert.equal(after.length, before.length - 1);
  assert.deepEqual([...after].sort(), before.filter((cardId) => cardId !== g.id("dtac")).sort());
  assert.equal(removedOf(g.engine, P2).length, 1);
});

clause(MILKSHAKE, "0:rule", "it is a 'may': picking nothing removes nothing, and the tactic still resolves into my discard pile", () => {
  const g = msSearchBoard();
  const before = deckOf(g.engine, P2).length;
  milkshake(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(removedOf(g.engine, P2).length, 0);
  assert.equal(deckOf(g.engine, P2).length, before);
  assert.equal(zoneOf(g.engine, g.id("ms")), "discard");
});

clause(MILKSHAKE, "0:rule", "it searches MY OPPONENT's deck only: a card in my own deck cannot be picked", () => {
  const g = msSearchBoard();
  refused(milkshakeAttempt(g, "md0"), "my own deck");
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand", "nothing was played");
  assert.equal(attachedCount(g.engine, P1), 0, "nothing was paid");
  milkshake(g, "dchar");
  assert.equal(zoneOf(g.engine, g.id("dchar")), "removed", "control");
});

clause(MILKSHAKE, "0:rule", "it searches the DECK only: a card in their hand, discard pile or in play cannot be picked", () => {
  const g = msSearchBoard();
  refused(milkshakeAttempt(g, "oh"), "their hand");
  refused(milkshakeAttempt(g, "ox"), "their discard pile");
  refused(milkshakeAttempt(g, "opc"), "their character in play");
  assert.equal(zoneOf(g.engine, g.id("oh")), "hand");
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand");
});

clause(MILKSHAKE, "0:rule", "'a card': exactly one card, never two", () => {
  const g = msSearchBoard();
  refused(milkshakeAttempt(g, "dchar", "dtac"), "two cards");
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand");
  assert.equal(zoneOf(g.engine, g.id("dchar")), "deck");
});

clause(MILKSHAKE, "0:rule", "the cost is 3 and the threshold [D][D][D][D]: exactly 3 resources are paid", () => {
  const g = msSearchBoard({ icons: { deception: 5 } });
  const before = ready(g.engine);
  milkshake(g, "dchar");
  assert.equal(before - ready(g.engine), 3);
});

clause(MILKSHAKE, "0:rule", "it needs [D][D][D][D]: three [D] among plenty of other resources is refused, four are enough", () => {
  const three = msSearchBoard({ icons: { deception: 3, greed: 6 } });
  refused(milkshakeAttempt(three, "dchar"), "three [D]");
  assert.equal(zoneOf(three.engine, three.id("ms")), "hand");
  assert.equal(ready(three.engine), 9, "nothing was paid");
  const four = msSearchBoard({ icons: { deception: 4 } });
  milkshake(four, "dchar");
  assert.equal(zoneOf(four.engine, four.id("dchar")), "removed", "control: four [D] are enough");
});

clause(MILKSHAKE, "0:rule", "the cost of 3 must be payable too: [D] x4 where the icons are spent leaves nothing to pay with", () => {
  const g = msSearchBoard({ icons: { greed: 2 }, extra: spent("deception", 4) });
  refused(milkshakeAttempt(g, "dchar"), "only 2 ready resources for a cost of 3");
  const enough = msSearchBoard({ icons: { greed: 3 }, extra: spent("deception", 4) });
  milkshake(enough, "dchar");
  assert.equal(zoneOf(enough.engine, enough.id("dchar")), "removed", "spent [D] still meet the threshold (CR 405.6)");
});

clause(MILKSHAKE, "0:rule", "my opponent's [D] and my Volition are not my [D][D][D][D]", () => {
  const theirs = msSearchBoard({ icons: { greed: 8 }, oppIcons: { deception: 6 } });
  refused(milkshakeAttempt(theirs, "dchar"), "their [D]");
  const vol = msSearchBoard({ icons: {}, extra: volition(8) });
  refused(milkshakeAttempt(vol, "dchar"), "Volition");
});

clause(MILKSHAKE, "0:rule", "the opponent's deck is shuffled after I search it (CR 312.1): with a fixed random stream the remaining cards are no longer in their old order", () => {
  const g = msSearchBoard({ random: lcg(), oppDeck: 8 });
  const before = deckOf(g.engine, P2);
  milkshake(g, "dchar");
  const after = deckOf(g.engine, P2);
  const expectedWithout = before.filter((cardId) => cardId !== g.id("dchar"));
  assert.deepEqual([...after].sort(), [...expectedWithout].sort());
  assert.notDeepEqual(after, expectedWithout, "shuffled");
});

clause(MILKSHAKE, "0:rule", "if I choose not to search, their deck is not searched and so not shuffled: the order is unchanged", () => {
  const g = msSearchBoard({ random: lcg(), oppDeck: 8 });
  const before = deckOf(g.engine, P2);
  milkshake(g);
  assert.deepEqual(deckOf(g.engine, P2), before);
});

clause(MILKSHAKE, "0:rule", "my own deck is not touched by the search", () => {
  const g = msSearchBoard({ random: lcg() });
  const before = deckOf(g.engine, P1);
  milkshake(g, "dchar");
  assert.deepEqual(deckOf(g.engine, P1), before);
});

clause(MILKSHAKE, "0:rule", "the tactic itself is not removed: it ends in my discard pile", () => {
  const g = msSearchBoard();
  milkshake(g, "dchar");
  assert.equal(zoneOf(g.engine, g.id("ms")), "discard");
  assert.ok(discardOf(g.engine, P1).includes(g.id("ms")), "discardOf(g.engine, P1).includes(g.id(\"ms\"))");
});

clause(MILKSHAKE, "0:rule", "being a tactic it can be played in response on the opponent's turn, and not outside a response window", () => {
  const g = msSearchBoard({ turn: 2, active: P2 });
  refused(milkshakeAttempt(g, "dchar"), "no window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("opc")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  respondWith(g.engine, P1, g.id("ms"), { dig: [g.id("dchar")] });
  assert.equal(zoneOf(g.engine, g.id("dchar")), "removed");
});

// --- the echo: For the rest of the game, if your opponent plays a card, you may reveal the removed card if it has the same name. ---

interface EchoOpts {
  ms?: "discard" | "hand" | "play" | "deck";
  msOwner?: PlayerId;
  /** `byOther`: the card was removed from the game by something else, not by this Milkshake (it is then no one's "removed card"). */
  removed?: Array<{ key: string; type: MsType | "res"; name?: string; faceDown?: boolean; byOther?: boolean; extra?: Partial<CardDefinition> }>;
  oppIcons?: Icons;
  icons?: Icons;
  extra?: CardPlacement[];
}

/**
 * Echo phase on P2's turn. P1: the Milkshake in my discard pile, [D] x0 by default (no icon of the removed cards' trades), a deck.
 * P2: hand cards "play<type>" named like the matching removed card (character, tactic, item, location, resource), plus "plainChar" (another name);
 * removed (face-down) cards "rem<type>" with the target names; rage resources.
 */
function msEchoBoard(o: EchoOpts = {}) {
  const removed = o.removed ?? [{ key: "remchar", type: "char" as const }];
  const g = devBoard(
    [
      { key: "ms", def: printing(MILKSHAKE), owner: o.msOwner ?? P1, zone: o.ms ?? "discard" },
      ...removed.map((r) => ({ key: r.key, def: msCard(r.type, r.name ?? MS_NAME[r.type], r.extra), owner: P2, zone: "removed" as const, faceDown: r.faceDown ?? true })),
      { key: "playchar", def: msCard("char", MS_NAME.char), owner: P2, zone: "hand" },
      { key: "playchar2", def: msCard("char", MS_NAME.char), owner: P2, zone: "hand" },
      { key: "playtac", def: msCard("tac", MS_NAME.tac), owner: P2, zone: "hand" },
      { key: "playitem", def: msCard("item", MS_NAME.item), owner: P2, zone: "hand" },
      { key: "playloc", def: msCard("loc", MS_NAME.loc), owner: P2, zone: "hand" },
      { key: "playres", def: msCard("res", MS_NAME.res), owner: P2, zone: "hand" },
      { key: "plainchar", def: character({ name: "Plain Character", cost: 1 }), owner: P2, zone: "hand" },
      { key: "mychar", def: msCard("char", MS_NAME.char), owner: P1, zone: "hand" },
      ...fillers("md", 3, P1, "deck"),
      ...fillers("od", 3, P2, "deck"),
      ...res(o.oppIcons ?? { rage: 6 }, P2),
      ...res(o.icons ?? {}),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: P2 }
  );
  // The removed cards are the ones THIS Milkshake removed (as after a real play), unless a test says another effect did.
  for (const r of removed) if (!r.byOther) g.engine.state.cards[g.id(r.key)].voidedBy = g.id("ms");
  return g;
}

type EchoGame = ReturnType<typeof msEchoBoard>;

/** My opponent plays `key` from their hand (the response window is left open: the echo, if any, is pending for me). */
const theyPlay = (g: EchoGame, key: string) => playRaw(g.engine, P2, g.id(key), {});

/** Answers my "reveal the removed card?" question with `reveal` (a key, or none) and then the "play it?" question with `play`. Returns what was asked. */
function answerEcho(g: EchoGame, reveal: string | undefined, play: boolean, selected: Record<string, CardInstanceId[]> = {}): string[] {
  const seen: string[] = [];
  let guard = 0;
  while (pending(g.engine) && guard++ < 6) {
    const pc = pending(g.engine)!;
    seen.push(pc.kind);
    if (pc.kind === "chooserSelectsTarget") {
      g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: reveal ? [g.id(reveal)] : [] } } as never);
    } else if (pc.kind === "deployForFree") {
      g.engine.perform({
        type: "resolvePendingChoice",
        playerId: pc.playerId,
        choice: play ? { kind: "deployForFree", cardId: (pc.candidates as string[])[0], selected } : { kind: "deployForFree" }
      } as never);
    } else if (pc.kind === "orderTriggers") {
      g.engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: declineAll(pc) } as never);
    } else {
      throw new Error(`unexpected pending choice ${pc.kind}`);
    }
  }
  resolvePendingResponses(g.engine);
  return seen;
}

clause(MILKSHAKE, "0:rule", "my opponent plays a card with the same name as the removed card: I am offered to reveal it", () => {
  const g = msEchoBoard();
  theyPlay(g, "playchar");
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the offer is mine");
});

clause(MILKSHAKE, "0:rule", "revealing and playing it: the removed card enters play under MY control, face-up, and my opponent's card is terminated (it goes to their discard pile)", () => {
  const g = msEchoBoard();
  theyPlay(g, "playchar");
  answerEcho(g, "remchar", true);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "play");
  assert.equal(isFaceDown(g.engine, g.id("remchar")), false);
  assert.equal(controllerOf(g.engine, g.id("remchar")), P1, "I control the card I played");
  assert.equal(g.engine.state.cards[g.id("remchar")].ownerId, P2, "ownership never changes");
  assert.equal(zoneOf(g.engine, g.id("playchar")), "discard", "terminated: it goes to its owner's discard pile (CR 314.1)");
  assert.ok(discardOf(g.engine, P2).includes(g.id("playchar")), "discardOf(g.engine, P2).includes(g.id(\"playchar\"))");
});

clause(MILKSHAKE, "0:rule", "the reveal is shown to everyone: a reveal event for exactly the removed card", () => {
  const g = msEchoBoard();
  theyPlay(g, "playchar");
  answerEcho(g, "remchar", false);
  const revealed = g.engine.getLog().flatMap((entry) => (entry.event?.type === "cardsRevealed" ? ((entry.event as { cardIds: string[] }).cardIds as string[]) : []));
  assert.ok(revealed.includes(g.id("remchar")), "revealed.includes(g.id(\"remchar\"))");
});

clause(MILKSHAKE, "0:rule", "'you may reveal': declining the reveal leaves the removed card where it is and their card resolves normally", () => {
  const g = msEchoBoard();
  theyPlay(g, "playchar");
  answerEcho(g, undefined, false);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "removed");
  assert.equal(zoneOf(g.engine, g.id("playchar")), "play", "their character entered play");
});

clause(MILKSHAKE, "0:rule", "'you may play it ... and terminate your opponent's card': if I reveal but decline to play the removed card, their card is not terminated", () => {
  const g = msEchoBoard();
  theyPlay(g, "playchar");
  answerEcho(g, "remchar", false);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "removed", "I did not play it");
  assert.equal(zoneOf(g.engine, g.id("playchar")), "play", "their card was not terminated");
});

clause(MILKSHAKE, "0:rule", "it works for every type of card they play: a character, a tactic, an item and a location are each terminated", () => {
  for (const type of MS_TYPES) {
    const g = msEchoBoard({ removed: [{ key: `rem${type}`, type }] });
    theyPlay(g, `play${type}`);
    expectPending(g.engine, "chooserSelectsTarget");
    answerEcho(g, `rem${type}`, true);
    assert.equal(zoneOf(g.engine, g.id(`play${type}`)), "discard", `${type}: their card was terminated`);
    assert.notEqual(zoneOf(g.engine, g.id(`rem${type}`)), "removed", `${type}: I played the removed card`);
  }
});

clause(MILKSHAKE, "0:rule", "a terminated tactic does nothing: their 'draw a card' tactic does not draw for them", () => {
  const g = msEchoBoard({ removed: [{ key: "remtac", type: "tac" }] });
  const handBefore = handOf(g.engine, P2).length;
  theyPlay(g, "playtac");
  answerEcho(g, "remtac", true);
  assert.equal(zoneOf(g.engine, g.id("playtac")), "discard");
  assert.equal(handOf(g.engine, P2).length, handBefore - 1, "they lost the tactic from hand and drew nothing");
  assert.equal(zoneOf(g.engine, g.id("remtac")), "discard", "the removed tactic I played resolved and went to its owner's discard pile");
  assert.ok(discardOf(g.engine, P2).includes(g.id("remtac")), "discardOf(g.engine, P2).includes(g.id(\"remtac\"))");
});

clause(MILKSHAKE, "0:rule", "the tactic I play from the removed zone resolves under my control: I draw its card", () => {
  const g = msEchoBoard({ removed: [{ key: "remtac", type: "tac" }] });
  const handBefore = handOf(g.engine, P1).length;
  theyPlay(g, "playtac");
  answerEcho(g, "remtac", true);
  assert.equal(handOf(g.engine, P1).length, handBefore + 1, "the played tactic drew a card for me");
});

clause(MILKSHAKE, "0:rule", "it terminates THEIR card only: other cards waiting to resolve in the same response chain (theirs below it, mine below it) are not terminated", () => {
  const g = msEchoBoard({
    removed: [{ key: "remtac", type: "tac" }],
    extra: [{ key: "mytac", def: msCard("tac", "My Draw Tactic"), owner: P1, zone: "hand" }]
  });
  theyPlay(g, "plainchar"); // their character waits to resolve
  playRaw(g.engine, P1, g.id("mytac"), {}); // I respond with a tactic that draws
  assert.equal(g.engine.state.priorityPlayerId, P2);
  theyPlay(g, "playtac"); // they respond to that with the card my removed card answers
  expectPending(g.engine, "chooserSelectsTarget");
  answerEcho(g, "remtac", true);
  assert.equal(zoneOf(g.engine, g.id("playtac")), "discard", "their top card was terminated");
  assert.equal(zoneOf(g.engine, g.id("mytac")), "discard", "my own tactic still resolved (it is in my discard pile)");
  assert.equal(zoneOf(g.engine, g.id("md0")), "hand", "...and drew me a card");
  assert.equal(zoneOf(g.engine, g.id("md1")), "hand", "the removed tactic I played drew another");
  assert.equal(zoneOf(g.engine, g.id("plainchar")), "play", "their first card, lower in the chain, was not terminated");
});

clause(MILKSHAKE, "0:rule", "a terminated character never enters play: it is in their discard pile and not in play", () => {
  const g = msEchoBoard();
  theyPlay(g, "playchar");
  answerEcho(g, "remchar", true);
  assert.equal(playOf(g.engine, P2).includes(g.id("playchar")), false);
});

clause(MILKSHAKE, "0:rule", "the card is played FOR FREE: no resource of mine is spent, though its cost is 1", () => {
  const g = msEchoBoard({ icons: { greed: 3 } });
  const before = ready(g.engine);
  theyPlay(g, "playchar");
  answerEcho(g, "remchar", true);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "play");
  assert.equal(ready(g.engine), before);
});

clause(MILKSHAKE, "0:rule", "...even if I cannot meet its threshold: a removed character that needs [R][R] enters play for me with no resources at all", () => {
  const g = msEchoBoard({ removed: [{ key: "remchar", type: "char", extra: { threshold: "rr", cost: 4 } }], icons: {} });
  assert.equal(ready(g.engine), 0, "setup: I have nothing");
  theyPlay(g, "playchar");
  answerEcho(g, "remchar", true);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "play");
  assert.equal(controllerOf(g.engine, g.id("remchar")), P1);
});

clause(MILKSHAKE, "0:rule", "the card I play is a new arrival under my control: it cannot attack the turn it enters play", () => {
  const g = msEchoBoard();
  theyPlay(g, "playchar");
  answerEcho(g, "remchar", true);
  assert.equal(g.engine.state.cards[g.id("remchar")].attackEligibleTurn === g.engine.state.turn, false);
});

clause(MILKSHAKE, "0:rule", "different name: if their card has another name than the removed card, I am not offered anything", () => {
  const g = msEchoBoard();
  theyPlay(g, "plainchar");
  assert.equal(g.engine.state.pendingChoice, undefined);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "removed");
  assert.equal(zoneOf(g.engine, g.id("plainchar")), "play");
});

clause(MILKSHAKE, "0:rule", "the name is what counts: a removed 'Target Character' does not answer a played 'Target Item'", () => {
  const g = msEchoBoard();
  theyPlay(g, "playitem");
  assert.equal(g.engine.state.pendingChoice, undefined);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("playitem")), "play");
});

clause(MILKSHAKE, "0:rule", "(Playing a resource does not trigger this effect): a same-named resource card played as a resource gives no offer", () => {
  const g = msEchoBoard({ removed: [{ key: "remres", type: "res" }] });
  developResource(g.engine, P2, g.id("playres"), false);
  assert.equal(g.engine.state.pendingChoice, undefined, "no offer");
  assert.equal(zoneOf(g.engine, g.id("remres")), "removed");
  assert.equal(zoneOf(g.engine, g.id("playres")), "play");
});

clause(MILKSHAKE, "0:rule", "(Playing a resource ...): a same-named card played face-down as a resource gives no offer either", () => {
  const g = msEchoBoard();
  developResource(g.engine, P2, g.id("playchar"), true);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "removed");
  assert.equal(isFaceDown(g.engine, g.id("playchar")), true);
});

clause(MILKSHAKE, "0:rule", "only my OPPONENT's plays count: when I play a card with the removed card's name myself, nothing is offered", () => {
  const g = devBoard(
    [
      { key: "ms", def: printing(MILKSHAKE), owner: P1, zone: "discard" },
      { key: "remchar", def: msCard("char", MS_NAME.char), owner: P2, zone: "removed", faceDown: true },
      { key: "mychar", def: msCard("char", MS_NAME.char), owner: P1, zone: "hand" },
      ...res({ rage: 3 })
    ],
    {}
  );
  play(g.engine, P1, g.id("mychar"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "removed");
  assert.equal(zoneOf(g.engine, g.id("mychar")), "play");
});

clause(MILKSHAKE, "0:rule", "it only answers plays, not the same card entering play another way: a same-named card PUT into play by an effect gives no offer", () => {
  const g = msEchoBoard({ extra: [{ key: "put", def: putterTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("put"), { selected: { t: [g.id("playchar")] } });
  assert.equal(zoneOf(g.engine, g.id("playchar")), "play", "setup: it was put into play");
  assert.equal(pending(g.engine)?.kind === "chooserSelectsTarget", false, "being put into play is not being played (CR 402.8)");
});

clause(MILKSHAKE, "0:rule", "the offer lists the removed card with that name only: a removed card of another name cannot be revealed for this play", () => {
  const g = msEchoBoard({ removed: [{ key: "remchar", type: "char" }, { key: "remtac", type: "tac" }] });
  theyPlay(g, "playchar");
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("remtac")] }), "the wrong name");
  assert.ok(pending(g.engine), "still waiting for a legal pick");
  answerEcho(g, "remchar", true);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "play", "control: the same-named card works");
});

clause(MILKSHAKE, "0:rule", "two removed cards: each answers its own name (a second Target Tactic play is answered by the removed tactic)", () => {
  const g = msEchoBoard({ removed: [{ key: "remchar", type: "char" }, { key: "remtac", type: "tac" }] });
  theyPlay(g, "playtac");
  answerEcho(g, "remtac", true);
  assert.equal(zoneOf(g.engine, g.id("playtac")), "discard");
  assert.equal(zoneOf(g.engine, g.id("remchar")), "removed", "the other removed card is untouched");
});

clause(MILKSHAKE, "0:rule", "once the removed card has been played it is no longer 'the removed card': a second same-named play by my opponent gives no offer", () => {
  const g = msEchoBoard();
  theyPlay(g, "playchar");
  answerEcho(g, "remchar", true);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "play");
  theyPlay(g, "playchar2");
  assert.equal(g.engine.state.pendingChoice, undefined, "nothing left to reveal");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("playchar2")), "play");
});

clause(MILKSHAKE, "0:rule", "declining once keeps the removed card for later: the next same-named play is offered again", () => {
  const g = msEchoBoard();
  theyPlay(g, "playchar");
  answerEcho(g, undefined, false);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "removed");
  theyPlay(g, "playchar2");
  expectPending(g.engine, "chooserSelectsTarget");
});

clause(MILKSHAKE, "0:rule", "only the card removed by THIS effect counts: a same-named card that was removed from the game face-up by something else gives no offer", () => {
  const g = msEchoBoard({ removed: [{ key: "remchar", type: "char", faceDown: false, byOther: true }] });
  theyPlay(g, "playchar");
  assert.equal(pending(g.engine)?.kind === "chooserSelectsTarget", false, "a card removed face-up is not 'the removed card'");
  assert.equal(zoneOf(g.engine, g.id("remchar")), "removed");
});

clause(MILKSHAKE, "0:rule", "'For the rest of the game': the effect goes on even after the Milkshake has left my discard pile (returned to my hand)", () => {
  const g = msEchoBoard({ extra: [{ key: "pull", def: tactic({ name: "Pull Back", cost: 0, behavior: { abilities: [{ id: "pull", type: "activated", targets: [{ id: "t", selector: { zone: "discard", type: "tactic", controller: "self" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] } }), owner: P1, zone: "hand" }] });
  // it is their turn: use the Pull Back as a response to something of theirs
  g.engine.perform({ type: "playCard", playerId: P2, cardId: g.id("plainchar"), selected: {}, variables: {} } as never);
  respondWith(g.engine, P1, g.id("pull"), { t: [g.id("ms")] });
  assert.equal(zoneOf(g.engine, g.id("ms")), "hand", "setup: the Milkshake is back in my hand");
  theyPlay(g, "playchar");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the effect lasts for the rest of the game");
});

clause(MILKSHAKE, "0:rule", "the effect needs the Milkshake to have resolved: with the Milkshake still in my hand nothing is offered", () => {
  // a Milkshake that never resolved has removed nothing: the same-named card in their removed zone got there some other way
  const g = msEchoBoard({ ms: "hand", removed: [{ key: "remchar", type: "char", byOther: true }] });
  theyPlay(g, "playchar");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("remchar")), "removed");
});

clause(MILKSHAKE, "0:rule", "a Milkshake in MY OPPONENT's discard pile belongs to them: it answers MY plays, not theirs", () => {
  const g = msEchoBoard({ msOwner: P2 });
  theyPlay(g, "playchar");
  assert.equal(g.engine.state.pendingChoice, undefined, "no offer to me (it is their Milkshake) and none to them (they are the one playing)");
});

// "for free" does not waive extra costs (CR 308.1a): a removed tactic that picks a character as its cost still needs the pick.
const zapDef = (name: string): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] }] }
  });

clause(MILKSHAKE, "0:rule", "'for free' does not waive extra costs (CR 308.1a): the removed tactic I play still needs its target, and with the target it deals its damage", () => {
  const board = () =>
    msEchoBoard({
      removed: [{ key: "remtac", type: "tac", extra: zapDef(MS_NAME.tac) }],
      extra: [{ key: "victim", def: character({ name: "Victim", life: 5 }), owner: P2, zone: "play" }]
    });
  const g = board();
  theyPlay(g, "playtac");
  answerEcho(g, "remtac", true, { t: [g.id("victim")] });
  assert.equal(g.engine.state.cards[g.id("victim")].damage, 2, "the zap resolved with its pick");
  assert.equal(zoneOf(g.engine, g.id("playtac")), "discard");
});

clause(MILKSHAKE, "0:rule", "...and without that target the removed tactic cannot be played: accepting with no pick is refused", () => {
  const g = msEchoBoard({
    removed: [{ key: "remtac", type: "tac", extra: zapDef(MS_NAME.tac) }],
    extra: [{ key: "victim", def: character({ name: "Victim", life: 5 }), owner: P2, zone: "play" }]
  });
  theyPlay(g, "playtac");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("remtac")] } } as never);
  const pc = expectPending(g.engine, "deployForFree");
  refused(
    () => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: (pc.candidates as string[])[0], selected: {} } } as never),
    "the zap's pick is an extra cost"
  );
  assert.equal(g.engine.state.cards[g.id("victim")].damage, 0);
});

// FLIP UP is playing a card too (CR 507.4a: "play the card as though it were in your hand").
clause(MILKSHAKE, "0:rule", "a card my opponent plays with FLIP UP is 'played' too: a same-named face-down tactic of theirs flipped up gives me the offer", () => {
  const faceDownTac = tactic({ name: MS_NAME.tac, cost: 0, flipUp: { cost: 1, threshold: "r" }, behavior: { abilities: [{ id: "ms-draw", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const g = msEchoBoard({ removed: [{ key: "remtac", type: "tac" }], extra: [{ key: "fdtac", def: faceDownTac, owner: P2, zone: "play", faceDown: true }] });
  flipUpRaw(g.engine, P2, g.id("fdtac"), {});
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the offer is made to me");
});

// --- the whole thing end to end ----------------------------------------------------------------

clause(MILKSHAKE, "0:rule", "end to end: I remove their Target Character, they later play another Target Character, I reveal and play mine for free and terminate theirs", () => {
  const g = devBoard(
    [
      { key: "ms", def: printing(MILKSHAKE), owner: P1, zone: "hand" },
      { key: "dchar", def: msCard("char", MS_NAME.char), owner: P2, zone: "deck" },
      ...fillers("od", 3, P2, "deck"),
      { key: "playchar", def: msCard("char", MS_NAME.char), owner: P2, zone: "hand" },
      ...res({ deception: 4 }),
      ...res({ rage: 4 }, P2)
    ],
    {}
  );
  play(g.engine, P1, g.id("ms"), { selected: { dig: [g.id("dchar")] } });
  assert.equal(zoneOf(g.engine, g.id("dchar")), "removed");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  playRaw(g.engine, P2, g.id("playchar"), {});
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  const before = ready(g.engine);
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id("dchar")] } } as never);
  const dc = expectPending(g.engine, "deployForFree");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: (dc.candidates as string[])[0] } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("dchar")), "play");
  assert.equal(controllerOf(g.engine, g.id("dchar")), P1);
  assert.equal(zoneOf(g.engine, g.id("playchar")), "discard");
  assert.equal(ready(g.engine), before, "free");
});

// =================================================================================
// Lucky Bastard
// When this card enters play, draw a card.
// If this card is destroyed, both players remove the top card of their deck from the game instead. If the numeric
// cost of your removed card is greater than or equal to the numeric cost of your opponent's, draw a card and reduce
// the amount of damage inflicted to this card this turn to 0. Otherwise, remove this card from the game.
// Character (gambler), cost 7, [D][D], 3 strength / 4 speed / 4 life.
// =================================================================================

const BASTARD = "85fcf752-5566-427e-a993-49531a2f38b0";

interface LbOpts {
  lb?: "hand" | "play" | "faceDown";
  lbOwner?: PlayerId;
  lbController?: PlayerId;
  myTop?: number;
  oppTop?: number;
  myTopType?: "char" | "res";
  oppTopType?: "char" | "res";
  noMyDeck?: boolean;
  noOppDeck?: boolean;
  damage?: number;
  second?: boolean;
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * P1: lb (the Lucky Bastard), ally, decks: mtop (cost `myTop`, default 5), mnext (cost 9), md2, md3. P2: otop (cost `oppTop`, default 3), onext (cost 9), od2, od3.
 * The top of each deck is the first card in `deckOf`. Default P1's turn 1, [D] x8.
 */
function lbBoard(o: LbOpts = {}) {
  const where = o.lb ?? "play";
  const myTopDef = o.myTopType === "res" ? resourceCard({ name: "My Top Resource" }) : character({ name: "My Top Card", cost: o.myTop ?? 5 });
  const oppTopDef = o.oppTopType === "res" ? resourceCard({ name: "Their Top Resource" }) : character({ name: "Their Top Card", cost: o.oppTop ?? 3 });
  const g = devBoard(
    [
      { key: "lb", def: printing(BASTARD), owner: o.lbOwner ?? P1, controller: o.lbController, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined, damage: o.damage },
      ...(o.second ? [{ key: "lb2", def: printing(BASTARD), owner: P1, zone: "play" as const }] : []),
      { key: "ally", def: character({ name: "Ally", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...(o.noMyDeck
        ? []
        : [
            { key: "mtop", def: myTopDef, owner: P1, zone: "deck" as const },
            { key: "mnext", def: character({ name: "My Next Card", cost: 9 }), owner: P1, zone: "deck" as const },
            ...fillers("md", 2, P1, "deck")
          ]),
      ...(o.noOppDeck
        ? []
        : [
            { key: "otop", def: oppTopDef, owner: P2, zone: "deck" as const },
            { key: "onext", def: character({ name: "Their Next Card", cost: 9 }), owner: P2, zone: "deck" as const },
            ...fillers("od", 2, P2, "deck")
          ]),
      ...res(o.icons ?? { deception: 8 }),
      ...(o.extra ?? [])
    ],
    { turn: o.turn, activePlayerId: o.active }
  );
  if (!o.noMyDeck) assert.equal(deckOf(g.engine, P1)[0], g.id("mtop"), "setup: mtop is the top of my deck");
  if (!o.noOppDeck) assert.equal(deckOf(g.engine, P2)[0], g.id("otop"), "setup: otop is the top of their deck");
  return g;
}

type LbGame = ReturnType<typeof lbBoard>;
const lbWithKiller = (o: LbOpts = {}) => lbBoard({ ...o, extra: [...(o.extra ?? []), { key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
const lbKill = (g: LbGame, targetKey = "lb", player: PlayerId = P1) => {
  playRaw(g.engine, player, g.id("kill"), { selected: { t: [g.id(targetKey)] } });
  resolvePendingResponses(g.engine);
};

// --- 0:rule  When this card enters play, draw a card. -------------------------------------------

clause(BASTARD, "0:rule", "deployed from my hand it draws me exactly one card when it enters play", () => {
  const g = lbBoard({ lb: "hand" });
  const handBefore = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("lb"));
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 1, "the Bastard left my hand, one card was drawn");
  assert.equal(zoneOf(g.engine, g.id("mtop")), "hand", "the top card of my deck");
  assert.equal(zoneOf(g.engine, g.id("mnext")), "deck", "only one card");
});

clause(BASTARD, "0:rule", "it costs 7 and needs [D][D]: refused one short, refused with one [D], exact is fine", () => {
  const exact = lbBoard({ lb: "hand", icons: { deception: 2, greed: 5 } });
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("lb"));
  assert.equal(before - ready(exact.engine), 7);
  const short = lbBoard({ lb: "hand", icons: { deception: 2, greed: 4 } });
  refused(() => playRaw(short.engine, P1, short.id("lb")), "six resources");
  const oneD = lbBoard({ lb: "hand", icons: { deception: 1, greed: 8 } });
  refused(() => playRaw(oneD.engine, P1, oneD.id("lb")), "one [D]");
  assert.equal(zoneOf(oneD.engine, oneD.id("lb")), "hand");
});

clause(BASTARD, "0:rule", "put into play by an effect it also 'enters play': it draws", () => {
  const g = lbBoard({ lb: "hand", extra: [{ key: "put", def: putterTactic(), owner: P1, zone: "hand" }] });
  const handBefore = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("put"), { selected: { t: [g.id("lb")] } });
  assert.equal(zoneOf(g.engine, g.id("lb")), "play", "setup");
  assert.equal(handOf(g.engine, P1).length, handBefore - 2 + 1, "the tactic and the Bastard left my hand, one card was drawn");
  assert.equal(zoneOf(g.engine, g.id("mtop")), "hand");
});

clause(BASTARD, "0:rule", "it draws for its CONTROLLER: my opponent's Bastard draws them a card, not me", () => {
  const g = lbBoard({ lb: "hand", lbOwner: P2, turn: 2, active: P2, extra: res({ deception: 8 }, P2) });
  const mine = handOf(g.engine, P1).length;
  const theirs = handOf(g.engine, P2).length;
  play(g.engine, P2, g.id("lb"));
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.equal(handOf(g.engine, P2).length, theirs - 1 + 1);
  assert.equal(handOf(g.engine, P1).length, mine);
  assert.equal(zoneOf(g.engine, g.id("otop")), "hand");
});

clause(BASTARD, "0:rule", "only when THIS card enters play: another character entering play does not draw", () => {
  const g = lbBoard({ extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  const handBefore = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("newbie"));
  assert.equal(handOf(g.engine, P1).length, handBefore - 1);
  assert.equal(zoneOf(g.engine, g.id("mtop")), "deck");
});

clause(BASTARD, "0:rule", "a Bastard already in play does not draw again: not at my turn start either", () => {
  const g = lbBoard({ turn: 2, active: P2 });
  const handBefore = handOf(g.engine, P1).length;
  endTurn(g.engine, P2);
  assert.equal(handOf(g.engine, P1).length, handBefore);
  assert.equal(zoneOf(g.engine, g.id("mtop")), "deck");
});

clause(BASTARD, "0:rule", "a Bastard that enters play face-down (as a resource) has no rules text and draws nothing", () => {
  const g = lbBoard({ lb: "hand" });
  developResource(g.engine, P1, g.id("lb"), true);
  assert.equal(isFaceDown(g.engine, g.id("lb")), true);
  assert.equal(zoneOf(g.engine, g.id("mtop")), "deck");
});

clause(BASTARD, "0:rule", "it draws every time it enters play: bounced and deployed again it draws again", () => {
  const g = lbBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("lb")] } });
  assert.equal(zoneOf(g.engine, g.id("lb")), "hand", "setup");
  const handBefore = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("lb"));
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 1);
  assert.equal(zoneOf(g.engine, g.id("mtop")), "hand");
});

clause(BASTARD, "0:rule", "with an empty deck there is nothing to draw: no card, and I do not lose", () => {
  const g = lbBoard({ lb: "hand", noMyDeck: true });
  const handBefore = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("lb"));
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1);
  assert.equal(g.engine.state.winner, undefined);
});

clause(BASTARD, "0:rule", "its printed stats are 3 strength / 4 speed / 4 life", () => {
  const g = lbBoard();
  assert.equal(g.engine.getStat(g.id("lb"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("lb"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("lb"), "life"), 4);
});

// --- 1:rule  the destroy replacement --------------------------------------------------------------------

clause(BASTARD, "1:rule", "destroyed: both players remove the top card of their deck from the game, in their own out-of-game areas", () => {
  const g = lbWithKiller();
  lbKill(g);
  assert.equal(g.engine.state.pendingChoice, undefined, "not a 'may': nothing to decide");
  assert.equal(zoneOf(g.engine, g.id("mtop")), "removed");
  assert.equal(zoneOf(g.engine, g.id("otop")), "removed");
  assert.ok(removedOf(g.engine, P1).includes(g.id("mtop")), "removedOf(g.engine, P1).includes(g.id(\"mtop\"))");
  assert.ok(removedOf(g.engine, P2).includes(g.id("otop")), "removedOf(g.engine, P2).includes(g.id(\"otop\"))");
});

clause(BASTARD, "1:rule", "only the TOP card of each deck is removed: the second card stays (my removed card costs less, so I draw nothing and the Bastard goes too)", () => {
  const g = lbWithKiller({ myTop: 3, oppTop: 5 });
  lbKill(g);
  assert.equal(zoneOf(g.engine, g.id("mnext")), "deck");
  assert.equal(zoneOf(g.engine, g.id("onext")), "deck");
  assert.equal(removedOf(g.engine, P1).filter((cardId) => cardId !== g.id("lb")).length, 1);
  assert.equal(removedOf(g.engine, P2).length, 1);
});

clause(BASTARD, "1:rule", "my removed card costs MORE than theirs (5 against 3): it is not destroyed, I draw a card, and its damage is reduced to 0", () => {
  const g = lbWithKiller({ myTop: 5, oppTop: 3 });
  const handBefore = handOf(g.engine, P1).length;
  lbKill(g);
  assert.equal(zoneOf(g.engine, g.id("lb")), "play", "it stays in play");
  assert.equal(discardOf(g.engine, P1).includes(g.id("lb")), false);
  assert.equal(g.engine.state.cards[g.id("lb")].damage, 0);
  assert.equal(handOf(g.engine, P1).length, handBefore - 1 + 1, "the kill tactic left my hand, one card was drawn");
  assert.equal(zoneOf(g.engine, g.id("mnext")), "hand", "the card after the removed one");
});

clause(BASTARD, "1:rule", "equal costs (4 and 4) count as 'greater than or equal': it survives and I draw", () => {
  const g = lbWithKiller({ myTop: 4, oppTop: 4 });
  lbKill(g);
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.equal(zoneOf(g.engine, g.id("mnext")), "hand");
});

clause(BASTARD, "1:rule", "my removed card costs LESS than theirs (3 against 5): the Bastard is removed from the game, and I draw nothing", () => {
  const g = lbWithKiller({ myTop: 3, oppTop: 5 });
  const handBefore = handOf(g.engine, P1).length;
  lbKill(g);
  assert.equal(zoneOf(g.engine, g.id("lb")), "removed", "removed from the game, not destroyed");
  assert.equal(discardOf(g.engine, P1).includes(g.id("lb")), false);
  assert.ok(removedOf(g.engine, P1).includes(g.id("lb")), "removedOf(g.engine, P1).includes(g.id(\"lb\"))");
  assert.equal(handOf(g.engine, P1).length, handBefore - 1, "no card drawn");
  assert.equal(zoneOf(g.engine, g.id("mnext")), "deck");
  assert.equal(zoneOf(g.engine, g.id("mtop")), "removed", "both top cards are removed in either case");
  assert.equal(zoneOf(g.engine, g.id("otop")), "removed");
});

clause(BASTARD, "1:rule", "one point apart is enough either way: 4 against 5 removes it, 5 against 4 keeps it", () => {
  const lose = lbWithKiller({ myTop: 4, oppTop: 5 });
  lbKill(lose);
  assert.equal(zoneOf(lose.engine, lose.id("lb")), "removed");
  const win = lbWithKiller({ myTop: 5, oppTop: 4 });
  lbKill(win);
  assert.equal(zoneOf(win.engine, win.id("lb")), "play");
});

clause(BASTARD, "1:rule", "a card with no cost number costs 0 (CR 406.2): a resource against a cost-0 character ties and keeps it; against a cost-1 character it loses", () => {
  const tie = lbWithKiller({ myTopType: "res", oppTop: 0 });
  lbKill(tie);
  assert.equal(zoneOf(tie.engine, tie.id("lb")), "play", "0 >= 0");
  const lose = lbWithKiller({ myTopType: "res", oppTop: 1 });
  lbKill(lose);
  assert.equal(zoneOf(lose.engine, lose.id("lb")), "removed", "0 < 1");
  const wins = lbWithKiller({ myTop: 1, oppTopType: "res" });
  lbKill(wins);
  assert.equal(zoneOf(wins.engine, wins.id("lb")), "play", "1 >= 0");
});

clause(BASTARD, "1:rule", "'your removed card' is the card removed from MY deck and 'your opponent's' the one from THEIRS (swapping them swaps the result)", () => {
  const mine = lbWithKiller({ myTop: 8, oppTop: 2 });
  lbKill(mine);
  assert.equal(zoneOf(mine.engine, mine.id("lb")), "play");
  const swapped = lbWithKiller({ myTop: 2, oppTop: 8 });
  lbKill(swapped);
  assert.equal(zoneOf(swapped.engine, swapped.id("lb")), "removed");
});

clause(BASTARD, "1:rule", "'your' means the Bastard's controller: a Bastard my opponent controls compares THEIR card with mine, and THEY draw", () => {
  const g = lbWithKiller({ lbOwner: P1, lbController: P2, myTop: 2, oppTop: 6 });
  lbKill(g);
  assert.equal(zoneOf(g.engine, g.id("lb")), "play", "their card (6) is at least mine (2)");
  assert.equal(zoneOf(g.engine, g.id("onext")), "hand", "its controller drew");
  assert.equal(zoneOf(g.engine, g.id("mnext")), "deck", "I did not");
  const lose = lbWithKiller({ lbOwner: P1, lbController: P2, myTop: 6, oppTop: 2 });
  lbKill(lose);
  assert.equal(zoneOf(lose.engine, lose.id("lb")), "removed", "their card (2) is below mine (6)");
});

clause(BASTARD, "1:rule", "a Bastard removed from the game goes to its OWNER's out-of-game area even while my opponent controls it", () => {
  const g = lbWithKiller({ lbOwner: P1, lbController: P2, myTop: 6, oppTop: 2 });
  lbKill(g);
  assert.ok(removedOf(g.engine, P1).includes(g.id("lb")), "removedOf(g.engine, P1).includes(g.id(\"lb\"))");
  assert.equal(removedOf(g.engine, P2).includes(g.id("lb")), false);
});

clause(BASTARD, "1:rule", "it survives with its damage reduced to 0: lethal battle damage (4 on 4 life) does not kill it when my removed card is at least as costly", () => {
  const g = lbBoard({
    myTop: 5,
    oppTop: 3,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  fight(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("lb")]);
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.equal(g.engine.state.cards[g.id("lb")].damage, 0, "the damage was reduced to 0");
  assert.equal(zoneOf(g.engine, g.id("mnext")), "hand", "and I drew a card");
  assert.equal(zoneOf(g.engine, g.id("mtop")), "removed");
  assert.equal(zoneOf(g.engine, g.id("otop")), "removed");
});

clause(BASTARD, "1:rule", "...and when it loses the gamble in a battle it is removed from the game and leaves the battle", () => {
  const g = lbBoard({
    myTop: 1,
    oppTop: 9,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Attacker", strength: 4, life: 9, speed: 1 }), owner: P2, zone: "play" }]
  });
  fight(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("lb")]);
  assert.equal(zoneOf(g.engine, g.id("lb")), "removed");
  assert.equal(g.engine.state.battle, undefined);
});

clause(BASTARD, "1:rule", "it can be destroyed again: each time it would be destroyed it gambles again (a second kill removes two more top cards)", () => {
  const g = lbWithKiller({ myTop: 5, oppTop: 3, extra: [{ key: "kill2", def: killTactic(), owner: P1, zone: "hand" }] });
  lbKill(g);
  assert.equal(zoneOf(g.engine, g.id("lb")), "play", "setup: survived once (my next card costs 9 now)");
  playRaw(g.engine, P1, g.id("kill2"), { selected: { t: [g.id("lb")] } });
  resolvePendingResponses(g.engine);
  const mineRemoved = removedOf(g.engine, P1).filter((cardId) => cardId !== g.id("lb"));
  assert.equal(mineRemoved.length, 2, "two cards removed from my deck by now (the Bastard itself may have joined them)");
  assert.equal(removedOf(g.engine, P2).length, 2);
});

clause(BASTARD, "1:rule", "only THIS card: a different character that is destroyed goes to the discard pile as usual, with no deck cards removed", () => {
  const g = lbWithKiller();
  lbKill(g, "ally");
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.equal(zoneOf(g.engine, g.id("mtop")), "deck");
  assert.equal(zoneOf(g.engine, g.id("otop")), "deck");
});

clause(BASTARD, "1:rule", "with two Bastards in play, destroying one gambles once: only one pair of cards is removed", () => {
  const g = lbWithKiller({ second: true });
  lbKill(g, "lb");
  assert.equal(removedOf(g.engine, P1).length, 1);
  assert.equal(removedOf(g.engine, P2).length, 1);
  assert.equal(zoneOf(g.engine, g.id("lb2")), "play", "the other Bastard is untouched");
});

clause(BASTARD, "1:rule", "destroying it as a COST is not replaced (CR 506.2): it goes straight to the discard pile and no deck card is removed", () => {
  const g = lbBoard({ extra: [{ key: "sacer", def: sacrificerChar(), owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("sacer"), "sac", { selected: { v: [g.id("lb")] } });
  assert.equal(zoneOf(g.engine, g.id("lb")), "discard");
  assert.equal(removedOf(g.engine, P1).length + removedOf(g.engine, P2).length, 0);
});

clause(BASTARD, "1:rule", "only DESTROYED is replaced: bounced to hand it goes to its owner's hand, removed from the game it is removed, with no deck cards removed", () => {
  const bounced = lbBoard({ extra: [{ key: "bounce", def: moverTactic("hand"), owner: P1, zone: "hand" }] });
  play(bounced.engine, P1, bounced.id("bounce"), { selected: { t: [bounced.id("lb")] } });
  assert.equal(zoneOf(bounced.engine, bounced.id("lb")), "hand");
  assert.equal(removedOf(bounced.engine, P2).length, 0);
  const removed = lbBoard({ extra: [{ key: "rm", def: removerTactic(), owner: P1, zone: "hand" }] });
  play(removed.engine, P1, removed.id("rm"), { selected: { t: [removed.id("lb")] } });
  assert.equal(zoneOf(removed.engine, removed.id("lb")), "removed");
  assert.equal(removedOf(removed.engine, P2).length, 0);
});

clause(BASTARD, "1:rule", "the Bastard in my hand or a face-down Bastard has no such replacement: a face-down one that is destroyed just goes to the discard pile", () => {
  const g = lbBoard({ lb: "faceDown", extra: [{ key: "kr", def: resourceKiller(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kr"), { selected: { t: [g.id("lb")] } });
  assert.equal(zoneOf(g.engine, g.id("lb")), "discard");
  assert.equal(removedOf(g.engine, P1).length + removedOf(g.engine, P2).length, 0);
});

clause(BASTARD, "1:rule", "the draw is for the Bastard's controller and is one card only", () => {
  const g = lbWithKiller({ myTop: 5, oppTop: 3 });
  const mine = handOf(g.engine, P1).length;
  const theirs = handOf(g.engine, P2).length;
  lbKill(g);
  assert.equal(handOf(g.engine, P1).length, mine - 1 + 1);
  assert.equal(handOf(g.engine, P2).length, theirs);
});

// =================================================================================
// Printed card data: cost, threshold, type and stats of the cards whose clauses are all abilities / rules
// (a card that deploys for something else than its printed cost is a broken card too)
// =================================================================================

/**
 * Deploy basics for a non-tactic card with no extra cost: it enters play for exactly `cost` with `icons` x `icon` among the resources; it is refused one
 * resource short, refused when the threshold's icons are missing (plenty of other resources), and refused on the opponent's turn.
 */
function deployChecks(printingId: string, o: { cost: number; icon: StapleIcon; icons: number; type: "character" | "item" | "location" }): void {
  const board = (resources: Icons, turn?: { n: number; active: PlayerId }) =>
    devBoard([{ key: "c", def: printing(printingId), owner: P1, zone: "hand" }, ...res(resources)], turn ? { turn: turn.n, activePlayerId: turn.active } : {});
  const exact = board({ [o.icon]: Math.max(o.cost, o.icons) } as Icons);
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("c"));
  assert.equal(zoneOf(exact.engine, exact.id("c")), "play", "deployed with exactly the cost");
  assert.equal(before - ready(exact.engine), o.cost, `the printed cost of ${o.cost} was paid`);
  assert.deepEqual(exact.engine.getCardTypes(exact.id("c")), [o.type]);
  const short = board({ [o.icon]: Math.max(o.cost, o.icons) - 1 } as Icons);
  refused(() => playRaw(short.engine, P1, short.id("c")), "one resource (or one icon) short");
  assert.equal(zoneOf(short.engine, short.id("c")), "hand");
  // the threshold is only the icons: exactly `icons` of the right icon, the rest of the cost paid with other resources
  const justIcons = board({ [o.icon]: o.icons, greed: Math.max(0, o.cost - o.icons) } as Icons);
  play(justIcons.engine, P1, justIcons.id("c"));
  assert.equal(zoneOf(justIcons.engine, justIcons.id("c")), "play", "exactly the threshold's icons plus other resources for the cost is enough");
  const wrongIcon = board({ greed: o.cost + o.icons + 3, rage: 2 } as Icons);
  refused(() => playRaw(wrongIcon.engine, P1, wrongIcon.id("c")), "plenty of resources but none of the right icon");
  if (o.icons >= 2) {
    const fewIcons = board({ [o.icon]: o.icons - 1, greed: o.cost + 3 } as Icons);
    refused(() => playRaw(fewIcons.engine, P1, fewIcons.id("c")), "one icon short of the threshold");
  }
  const theirTurn = board({ [o.icon]: Math.max(o.cost, o.icons) + 2 } as Icons, { n: 2, active: P2 });
  refused(() => playRaw(theirTurn.engine, P1, theirTurn.id("c")), "a " + o.type + " is deployed on its controller's own turn only");
}

/** A free tactic (id "locdmg", pick "t"): inflicts `amount` damage to one picked location. */
const locationZap = (amount: number): CardDefinition =>
  tactic({
    name: `Location Zap ${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "locdmg", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
  });

clause(GIMCRACK, "0:rule", "the Gimcrack is an item that deploys for exactly its printed cost of 3 and needs [E]", () => deployChecks(GIMCRACK, { cost: 3, icon: "elitism", icons: 1, type: "item" }));
clause(LAB, "0:ability:innovate", "the Lab is a location that deploys for exactly its printed cost of 3 and needs [E][E]", () => deployChecks(LAB, { cost: 3, icon: "elitism", icons: 2, type: "location" }));
clause(INTERN, "0:ability:research", "the Intern is a character that deploys for exactly its printed cost of 3 and needs [E]", () => deployChecks(INTERN, { cost: 3, icon: "elitism", icons: 1, type: "character" }));
clause(TRAP, "0:ability:ensnare", "the Trap is a location that deploys for exactly its printed cost of 2 and needs [E]", () => deployChecks(TRAP, { cost: 2, icon: "elitism", icons: 1, type: "location" }));
clause(ASS, "0:rule", "the Ass is an item that deploys for exactly its printed cost of 4 and needs [D][D]", () => deployChecks(ASS, { cost: 4, icon: "deception", icons: 2, type: "item" }));
clause(MAMMA, "0:ability:slap-it-up", "the Mammajamma is a character that deploys for exactly its printed cost of 5 and needs [D]", () => deployChecks(MAMMA, { cost: 5, icon: "deception", icons: 1, type: "character" }));
clause(FIRED, "0:rule", "the Fired Hand is a character that deploys for exactly its printed cost of 6 and needs [D]", () => deployChecks(FIRED, { cost: 6, icon: "deception", icons: 1, type: "character" }));

clause(INTERN, "0:ability:research", "its printed stats are 2 strength / 3 speed / 2 life", () => {
  const g = riBoard();
  assert.equal(g.engine.getStat(g.id("ri"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("ri"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("ri"), "life"), 2);
});

clause(MAMMA, "0:ability:slap-it-up", "its printed stats are 3 strength / 3 speed / 3 life", () => {
  const g = emBoard();
  assert.deepEqual(emStats(g), { strength: 3, speed: 3, life: 3 });
});

clause(FIRED, "0:rule", "its printed stats are 5 strength / 3 speed / 4 life", () => {
  const g = fhBoard();
  assert.equal(g.engine.getStat(g.id("fh"), "strength"), 5);
  assert.equal(g.engine.getStat(g.id("fh"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("fh"), "life"), 4);
});

clause(LAB, "0:ability:innovate", "the Lab has structure 4: 3 damage does not destroy it, a 4th point does", () => {
  const g = devBoard([{ key: "lab", def: printing(LAB), owner: P1, zone: "play", damage: 3 }, { key: "zap", def: locationZap(1), owner: P2, zone: "hand" }], { turn: 2, activePlayerId: P2 });
  assert.equal(zoneOf(g.engine, g.id("lab")), "play");
  play(g.engine, P2, g.id("zap"), { selected: { t: [g.id("lab")] } });
  assert.equal(zoneOf(g.engine, g.id("lab")), "discard", "4 damage on structure 4");
});

clause(TRAP, "0:ability:ensnare", "the Trap has structure 12: 11 damage does not destroy it, a 12th point does", () => {
  const g = devBoard([{ key: "trap", def: printing(TRAP), owner: P1, zone: "play", damage: 11 }, { key: "zap", def: locationZap(1), owner: P2, zone: "hand" }], { turn: 2, activePlayerId: P2 });
  assert.equal(zoneOf(g.engine, g.id("trap")), "play");
  play(g.engine, P2, g.id("zap"), { selected: { t: [g.id("trap")] } });
  assert.equal(zoneOf(g.engine, g.id("trap")), "discard", "12 damage on structure 12");
});

// --- a few more probes -------------------------------------------------------------------------------

clause(GIMCRACK, "1:rule@eee", "'meets [E][E][E]' is judged for the Gimcrack's CONTROLLER: a Gimcrack my opponent controls offers THEM the second token when THEY have three [E]", () => {
  const g = gimBoard({ controller: P2, turn: 1, active: P1, oppIcons: { elitism: 3 } });
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  const players: PlayerId[] = [];
  assert.equal(answerOffers(g.engine, ["accept", "accept"], players), 2, "two offers");
  assert.deepEqual(players, [P2, P2]);
  assert.equal(tokensOn(g.engine, g.id("gim")), 2);
});

clause(GIMCRACK, "1:rule@eee", "...and my own [E] do not open the second paragraph for a Gimcrack I do not control", () => {
  const g = gimBoard({ controller: P2, turn: 1, active: P1, icons: { elitism: 3 } });
  endTurn(g.engine, P1);
  assert.equal(answerOffers(g.engine, ["accept", "accept"]), 1, "only the base paragraph: their controller has no [E]");
});

clause(GOLEMIZER, "2:rule", "if its host changes controller the Golemizer stays attached and stays mine: I am still offered the token at the end of MY turn, and it goes on that host", () => {
  const g = gzBoard({ gz: "play", host: "mine", turn: 2, active: P2, extra: [{ key: "steal", def: stealTactic(), owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("steal"), { selected: { t: [g.id("mine")] } });
  assert.equal(controllerOf(g.engine, g.id("mine")), P2, "setup: they took my host");
  assert.equal(g.engine.state.cards[g.id("gz")].attachedTo, g.id("mine"), "the Golemizer stays attached");
  assert.equal(controllerOf(g.engine, g.id("gz")), P1, "and stays mine");
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(myTurnEnds(g, ["accept"]), 1);
  assert.equal(tokensOn(g.engine, g.id("mine")), 1);
});

function labShuffleWithoutCandidates(t: LabType): void {
  const target = LAB_NEXT[t];
  const g = labBoard({ random: lcg(), noDeck: [target] });
  const before = deckOf(g.engine, P1);
  innovate(g, `h${t}`);
  const after = deckOf(g.engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort(), "nothing was fetched");
  assert.notDeepEqual(after, before, "a searched deck is shuffled even when the search finds nothing (CR 312.1)");
}
clause(LAB, "0:ability:innovate", "a search that finds nothing (no location in the deck) still shuffles the deck, discarding a resource", () => labShuffleWithoutCandidates("res"));
clause(LAB, "0:ability:innovate", "a search that finds nothing (no character in the deck) still shuffles the deck, discarding a location", () => labShuffleWithoutCandidates("loc"));
clause(LAB, "0:ability:innovate", "a search that finds nothing (no tactic in the deck) still shuffles the deck, discarding a character", () => labShuffleWithoutCandidates("char"));
clause(LAB, "0:ability:innovate", "a search that finds nothing (no item in the deck) still shuffles the deck, discarding a tactic", () => labShuffleWithoutCandidates("tac"));
clause(LAB, "0:ability:innovate", "a search that finds nothing (no resource in the deck) still shuffles the deck, discarding an item", () => labShuffleWithoutCandidates("item"));

// @@APPEND-MARKER@@
