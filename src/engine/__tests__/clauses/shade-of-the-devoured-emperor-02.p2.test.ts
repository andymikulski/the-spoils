// Clause tests for The Spoils: batch shade-of-the-devoured-emperor-02, part p2 (groups 8-13).
// Cards: Arcane Escrow, Audacious Appraisal, Auspicious Arrival, Contractual Execution,
// Enlightened Mau, Eustace Padamose-Gristwalter.
// Expectations come from the PRINTED text (manifest markup) and RULES.md / the CR, never from behavior JSON.
import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, exempt, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fight, playRaw } from "./_battle.js";
import { pending, answerPending, declareBlockers, readyResources, zoneOf } from "./_board.js";
import { developDraw, developResource, endTurn, factionOf } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

type Board = ReturnType<typeof buildGame>;

// =====================================================================================
// ARCANE ESCROW — item, cost 2, [G][G]
// If you would discard a card, you may remove it from the game face-down instead. -- You may
// look at cards removed from the game by this card. -- If you would draw a card as part of your
// DEVELOP RULE, you may put a card removed from the game by this card into its owner's hand
// instead. -- WITHDRAW -- COST: Pay 1. -- EFFECT: Draw a card. Discard 2 cards. -- FLIP UP: 1 [G][G]
//
// Reading note: the printing says "remove it from the game", the catalog's current wording is the
// Void (card-audit finding: "catalog uses newer 'void' / 'voided' terminology"). The Out of Game
// zone is face-up and has no way back (CR 403.6a), while this card says "face-down", "look at" and
// "put into its owner's hand", so these tests read "removed from the game by this card" as the Void
// zone (CR 403.7a: a card may be sent there face-down).
// =====================================================================================

const ESC = "ae2a8991-a53d-4ac4-a5d8-707b812babae";

/** Void cards (placements) that THIS Escrow removed from the game (E10e: origin is tracked, `CardInstance.voidedBy`). */
const escVoided = new WeakSet<CardPlacement>();
const escBoard = (
  extra: CardPlacement[] = [],
  o: { turn?: number; active?: PlayerId; escZone?: "play" | "hand" | "discard"; escFaceDown?: boolean } = {}
): Board => {
  const built = escBoardRaw(extra, o);
  for (const p of extra) if (escVoided.has(p)) built.engine.state.cards[built.id(p.key)].voidedBy = built.id("esc");
  return built;
};
const escBoardRaw = (
  extra: CardPlacement[] = [],
  o: { turn?: number; active?: PlayerId; escZone?: "play" | "hand" | "discard"; escFaceDown?: boolean } = {}
): Board =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      {
        key: "esc",
        def: printing(ESC),
        owner: P1,
        zone: o.escZone ?? "play",
        faceDown: (o.escZone ?? "play") === "play" ? o.escFaceDown : undefined
      },
      ...extra
    ]
  });

/** A free tactic whose EFFECT makes `chooser` discard a card of theirs from hand (an effect, not a cost). */
const discardEffectTactic = (name: string, chooser: "controller" | "opponent"): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "de",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser,
              declaration: { id: "d", selector: { zone: "hand", controller: chooser === "controller" ? "self" : "opponent" }, count: 1 },
              effects: [{ type: "moveCard", target: { type: "selected", id: "d" }, to: "discard" }]
            }
          ]
        }
      ]
    }
  });

/** A free tactic whose COST is "Discard a card" (the discard is an extra cost, not an effect). */
const discardCostTactic = (): CardDefinition =>
  tactic({
    name: "Discard Cost",
    cost: 0,
    behavior: {
      abilities: [
        { id: "dc", type: "activated", costs: [{ type: "discard", id: "d", player: "controller", selector: { zone: "hand" }, count: 1 }], effects: [] }
      ]
    }
  });

/** P1 plays their own "discard a card" tactic `t` and picks hand card `pick`; the replacement (if any) is left pending. */
function discardFromHand(b: Board, pick: string): void {
  play(b.engine, P1, b.id("t"));
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(pick)] });
}

const standardDiscard = (extra: CardPlacement[] = [], o: Parameters<typeof escBoard>[1] = {}): Board =>
  escBoard(
    [
      { key: "t", def: discardEffectTactic("Self Discard", "controller"), owner: P1, zone: "hand" },
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" },
      ...extra
    ],
    o
  );

/** Positive control: with a face-up Escrow in play, discarding a card from my hand offers the replacement. */
function assertEscrowOffersReplacement(): void {
  const b = standardDiscard();
  discardFromHand(b, "h1");
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "replacementChoice", "control: Escrow offers its replacement for a card discarded from my hand");
  assert.equal(pc?.playerId, P1);
}

const voidOf = (b: Board, p: PlayerId): CardInstanceId[] => b.engine.state.players[p].void;
const discardOf = (b: Board, p: PlayerId): CardInstanceId[] => b.engine.state.players[p].discard;

clause(ESC, "0:rule", "a card I discard from my hand is offered the replacement; accepting puts it in the void instead of the discard pile", () => {
  const b = standardDiscard();
  const { engine, id } = b;
  discardFromHand(b, "h1");
  const pc = pending(engine);
  assert.equal(pc?.kind, "replacementChoice", "'you may' -> I am asked");
  assert.equal(pc?.playerId, P1, "the Escrow's controller decides");
  assert.equal(pc?.affectedCardId, id("h1"), "about the discarded card");
  answerPending(engine, "replacementChoice", { apply: true });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("h1")), "void", "removed (voided) instead");
  assert.ok(voidOf(b, P1).includes(id("h1")), "in its owner's void");
  assert.equal(discardOf(b, P1).includes(id("h1")), false, "the original event (going to the discard pile) did not happen");
  assert.equal(engine.state.players[P1].hand.includes(id("h1")), false, "gone from my hand");
  assert.equal(zoneOf(engine, id("h2")), "hand", "the other hand card is untouched");
  assert.equal(zoneOf(engine, id("t")), "discard", "the tactic itself resolved normally");
});

clause(ESC, "0:rule", "'you may': declining the replacement discards the card normally", () => {
  const b = standardDiscard();
  const { engine, id } = b;
  discardFromHand(b, "h1");
  assert.equal(pending(engine)?.kind, "replacementChoice", "offered");
  answerPending(engine, "replacementChoice", { apply: false });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("h1")), "discard", "declined: it is discarded");
  assert.ok(discardOf(b, P1).includes(id("h1")), "discardOf(b, P1).includes(id(\"h1\"))");
  assert.equal(voidOf(b, P1).includes(id("h1")), false);
});

clause(ESC, "0:rule", "the removed card is face-down", () => {
  const b = standardDiscard();
  const { engine, id } = b;
  discardFromHand(b, "h1");
  assert.equal(pending(engine)?.kind, "replacementChoice", "offered");
  answerPending(engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(engine, id("h1")), "void");
  assert.equal(engine.state.cards[id("h1")].faceDown, true, "removed from the game FACE-DOWN (CR 403.7a)");
});

clause(ESC, "0:rule", "an opponent's effect that makes me discard is still 'I discard': the replacement is offered to me", () => {
  const b = escBoard(
    [
      { key: "t", def: discardEffectTactic("Foe Discard", "opponent"), owner: P2, zone: "hand" },
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" }
    ],
    { turn: 2, active: P2 }
  );
  const { engine, id } = b;
  play(engine, P2, id("t"));
  const pcPick = pending(engine);
  assert.equal(pcPick?.kind, "chooserSelectsTarget");
  assert.equal(pcPick?.playerId, P1, "I choose which of my cards to discard");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h1")] });
  const pc = pending(engine);
  assert.equal(pc?.kind, "replacementChoice", "Escrow replaces my discard");
  assert.equal(pc?.playerId, P1);
  answerPending(engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(engine, id("h1")), "void");
});

clause(ESC, "0:rule", "'discard a card' covers every card of a multi-card discard: WITHDRAW's two discards are each replaceable (accept one, decline the other)", () => {
  const b = escBoard([
    { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
    { key: "h2", def: character({ name: "H2" }), owner: P1, zone: "hand" },
    { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
    ...bank("greed", 1, P1)
  ]);
  const { engine, id } = b;
  activate(engine, P1, id("esc"), "ae-withdraw");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h1"), id("h2")] });
  const first = pending(engine);
  assert.equal(first?.kind, "replacementChoice", "first discarded card offered");
  answerPending(engine, "replacementChoice", { apply: true });
  const second = pending(engine);
  assert.equal(second?.kind, "replacementChoice", "second discarded card offered too");
  answerPending(engine, "replacementChoice", { apply: false });
  assert.equal(engine.state.pendingChoice, undefined);
  const zones = [zoneOf(engine, id("h1")), zoneOf(engine, id("h2"))].sort();
  assert.deepEqual(zones, ["discard", "void"], "one voided, one discarded");
});

clause(ESC, "0:rule", "only MY discards: my opponent discarding on their own turn is not replaced (control: mine is)", () => {
  assertEscrowOffersReplacement();
  const b = escBoard(
    [
      { key: "t", def: discardEffectTactic("Foe Self Discard", "controller"), owner: P2, zone: "hand" },
      { key: "h1", def: character({ name: "H1" }), owner: P2, zone: "hand" },
      { key: "h2", def: character({ name: "H2" }), owner: P2, zone: "hand" }
    ],
    { turn: 2, active: P2 }
  );
  const { engine, id } = b;
  play(engine, P2, id("t"));
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h1")] });
  assert.equal(engine.state.pendingChoice, undefined, "no prompt for anyone");
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.equal(voidOf(b, P2).length + voidOf(b, P1).length, 0);
});

clause(ESC, "0:rule", "a discard paid as an extra COST is not replaced (CR 506.2); the same discard as an effect is (control)", () => {
  assertEscrowOffersReplacement();
  const b = escBoard([
    { key: "t", def: discardCostTactic(), owner: P1, zone: "hand" },
    { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" }
  ]);
  const { engine, id } = b;
  play(engine, P1, id("t"), { selected: { d: [id("h1")] } });
  assert.equal(engine.state.pendingChoice, undefined, "a cost isn't replaced");
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.equal(voidOf(b, P1).length, 0);
});

clause(ESC, "0:rule", "the replacement is live only while a face-up Escrow is in play: not from my hand, not face-down, not after it has left", () => {
  assertEscrowOffersReplacement();
  // In my hand.
  const inHand = standardDiscard([], { escZone: "hand" });
  discardFromHand(inHand, "h1");
  assert.equal(inHand.engine.state.pendingChoice, undefined, "Escrow in hand does nothing");
  assert.equal(zoneOf(inHand.engine, inHand.id("h1")), "discard");
  // Face-down resource (no rules text, CR 411.1).
  const down = standardDiscard([], { escFaceDown: true });
  discardFromHand(down, "h1");
  assert.equal(down.engine.state.pendingChoice, undefined, "a face-down Escrow is just a resource");
  assert.equal(zoneOf(down.engine, down.id("h1")), "discard");
  // After it has left play (it sits in my discard pile).
  const gone = standardDiscard([], { escZone: "discard" });
  discardFromHand(gone, "h1");
  assert.equal(gone.engine.state.pendingChoice, undefined, "an Escrow in the discard pile does nothing");
  assert.equal(zoneOf(gone.engine, gone.id("h1")), "discard");
});

clause(ESC, "0:rule", "a character I control that is DESTROYED is not 'discarded' (CR 304.1 vs 305.1): it goes to the discard pile with no prompt", () => {
  const b = escBoard([
    { key: "k", def: killTactic(), owner: P1, zone: "hand" },
    { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" }
  ]);
  const { engine, id } = b;
  play(engine, P1, id("k"), { selected: { t: [id("c")] } });
  assert.equal(engine.state.pendingChoice, undefined, "destroy is not discard: nothing to replace");
  assert.equal(zoneOf(engine, id("c")), "discard");
  assert.equal(voidOf(b, P1).length, 0);
});

clause(ESC, "0:rule", "a resolved tactic and the opponent's destroyed character go to the discard pile without any prompt", () => {
  const b = escBoard([
    { key: "k", def: killTactic(), owner: P1, zone: "hand" },
    { key: "c", def: character({ name: "C" }), owner: P2, zone: "play" }
  ]);
  const { engine, id } = b;
  play(engine, P1, id("k"), { selected: { t: [id("c")] } });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("c")), "discard", "the opponent's card is not mine to replace");
  assert.equal(zoneOf(engine, id("k")), "discard", "a resolved tactic is put into the discard pile, not discarded");
  assert.equal(voidOf(b, P1).length + voidOf(b, P2).length, 0);
});

exempt(ESC, "1:rule", "'You may look at cards removed from the game by this card' is an information right with no game-state effect: the engine exposes the whole state to the client and has no per-player view/redaction layer, so there is nothing to assert about who may look.");

// --- 2:rule — the DEVELOP RULE draw replacement -------------------------------------------------
// Cards are seeded straight into the void (a buildGame placement): the board can't say WHICH card put
// them there, so the "by this card" sentence has its own tests below.

const cardAt = (key: string, owner: PlayerId, zone: CardPlacement["zone"]): CardPlacement => ({ key, def: character({ name: key.toUpperCase() }), owner, zone });
const voidCard = (key: string, owner: PlayerId = P1): CardPlacement => cardAt(key, owner, "void");
/** A void card this Escrow removed from the game (E10e: the swap only takes these). */
const escVoidCard = (key: string, owner: PlayerId = P1): CardPlacement => {
  const placement: CardPlacement = { ...voidCard(key, owner), faceDown: true };
  escVoided.add(placement);
  return placement;
};
const deckCard = (key: string, owner: PlayerId = P1): CardPlacement => cardAt(key, owner, "deck");
const handOf = (b: Board, p: PlayerId): CardInstanceId[] => b.engine.state.players[p].hand;
const deckOf = (b: Board, p: PlayerId): CardInstanceId[] => b.engine.state.players[p].deck;

const developAnswers = (b: Board, picks: string[], pay: boolean) => (pc: { kind: string; [k: string]: unknown }): unknown => {
  if (pc.kind === "mayPay") return { kind: "mayPay", pay };
  if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: picks.map((k) => b.id(k)) };
  return declineAll(pc);
};

clause(ESC, "2:rule", "taking the Develop Rule's draw offers the swap to me; accepting puts the chosen voided card in my hand INSTEAD of drawing", () => {
  const b = escBoard([escVoidCard("v1"), deckCard("d1"), deckCard("d2")]);
  const { engine, id } = b;
  developDraw(engine, P1);
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay", "'you may' -> I am asked");
  assert.equal(pc?.playerId, P1, "the developing player (the Escrow's controller) decides");
  drain(engine, developAnswers(b, ["v1"], true));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("v1")), "hand");
  assert.deepEqual(handOf(b, P1), [id("v1")], "only the voided card is in my hand: no card was drawn");
  assert.deepEqual(deckOf(b, P1), [id("d1"), id("d2")], "the deck is untouched, d1 still on top");
  assert.equal(voidOf(b, P1).length, 0);
  assert.equal(engine.state.pendingChoice, undefined, "the Develop Rule was used up by the swap: nothing more is offered");
});

clause(ESC, "2:rule", "'you may': declining the swap makes the Develop Rule draw normally; the voided card stays in the void", () => {
  const b = escBoard([escVoidCard("v1"), deckCard("d1"), deckCard("d2")]);
  const { engine, id } = b;
  developDraw(engine, P1);
  assert.equal(pending(engine)?.kind, "mayPay", "offered");
  drain(engine, developAnswers(b, ["v1"], false));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b, P1), [id("d1")], "drew the top card");
  assert.deepEqual(voidOf(b, P1), [id("v1")], "the voided card stays in the void");
  assert.equal(engine.state.pendingChoice, undefined, "the Develop Rule was used up by the draw: nothing more is offered");
});

clause(ESC, "2:rule", "with several voided cards I pick which one: exactly that one goes to my hand", () => {
  const b = escBoard([escVoidCard("v1"), escVoidCard("v2"), escVoidCard("v3"), deckCard("d1")]);
  const { engine, id } = b;
  developDraw(engine, P1);
  drain(engine, developAnswers(b, ["v2"], true));
  assert.deepEqual(handOf(b, P1), [id("v2")]);
  assert.deepEqual([...voidOf(b, P1)].sort(), [id("v1"), id("v3")].sort(), "the others stay voided");
  assert.deepEqual(deckOf(b, P1), [id("d1")]);
});

clause(ESC, "2:rule", "only the Develop Rule's DRAW is swapped: playing a resource with the Develop Rule is untouched", () => {
  const b = escBoard([voidCard("v1"), cardAt("r", P1, "hand"), deckCard("d1")]);
  const { engine, id } = b;
  developResource(engine, P1, id("r"), true);
  assert.equal(engine.state.pendingChoice, undefined, "no swap offered");
  assert.equal(engine.state.cards[id("r")].faceDown, true);
  assert.equal(zoneOf(engine, id("r")), "play");
  assert.deepEqual(voidOf(b, P1), [id("v1")]);
  assert.deepEqual(deckOf(b, P1), [id("d1")]);
});

clause(ESC, "2:rule", "only MY Develop Rule: my opponent's Develop Rule draw is a plain draw", () => {
  const b = escBoard([voidCard("v1"), deckCard("d1"), deckCard("x1", P2)], { turn: 2, active: P2 });
  const { engine, id } = b;
  developDraw(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined, "no swap for anyone");
  assert.deepEqual(handOf(b, P2), [id("x1")]);
  assert.deepEqual(voidOf(b, P1), [id("v1")]);
  assert.deepEqual(handOf(b, P1), []);
});

clause(ESC, "2:rule", "only while a face-up Escrow is in play: from my hand, face-down or in the discard pile it does nothing", () => {
  // control: the swap is offered with a face-up Escrow in play
  const ctl = escBoard([escVoidCard("v1"), deckCard("d1")]);
  developDraw(ctl.engine, P1);
  assert.equal(pending(ctl.engine)?.kind, "mayPay", "control");
  for (const [label, opts] of [
    ["in hand", { escZone: "hand" as const }],
    ["face-down", { escFaceDown: true }],
    ["in the discard pile", { escZone: "discard" as const }]
  ] as const) {
    const b = escBoard([escVoidCard("v1"), deckCard("d1")], opts);
    developDraw(b.engine, P1);
    assert.equal(b.engine.state.pendingChoice, undefined, `Escrow ${label}: no swap`);
    assert.deepEqual(handOf(b, P1).filter((c) => c !== b.id("esc")), [b.id("d1")], `Escrow ${label}: a normal draw`);
    assert.deepEqual(voidOf(b, P1), [b.id("v1")]);
  }
});

clause(ESC, "2:rule", "other draws are not swapped: WITHDRAW's draw takes the top card even with a voided card available", () => {
  const b = escBoard([voidCard("v1"), deckCard("d1"), deckCard("d2"), ...bank("greed", 1, P1)]);
  const { engine, id } = b;
  activate(engine, P1, id("esc"), "ae-withdraw");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "straight to the discard step: no swap prompt");
  assert.deepEqual(handOf(b, P1), [id("d1")], "WITHDRAW drew the top card");
  assert.deepEqual(voidOf(b, P1), [id("v1")]);
});

clause(ESC, "2:rule", "only a card removed from the game BY THIS CARD can be swapped in: a card put in the void by something else is not offered", () => {
  const b = escBoard([voidCard("v1"), deckCard("d1")]);
  const { engine, id } = b;
  developDraw(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined, "nothing was removed by this Escrow, so there is nothing to swap in: the draw just happens");
  assert.deepEqual(handOf(b, P1), [id("d1")]);
  assert.deepEqual(voidOf(b, P1), [id("v1")]);
});

clause(ESC, "2:rule", "with no card removed by Escrow the Develop Rule just draws (no swap prompt that could cost the draw)", () => {
  const b = escBoard([deckCard("d1"), deckCard("d2")]);
  const { engine, id } = b;
  developDraw(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined, "there is no card to put into my hand instead");
  assert.deepEqual(handOf(b, P1), [id("d1")], "the draw happened");
});

clause(ESC, "2:rule", "full cycle: a card Escrow removed from my hand can be put back into my hand by the Develop Rule instead of drawing", () => {
  const b = standardDiscard([deckCard("d1")]);
  const { engine, id } = b;
  discardFromHand(b, "h1");
  assert.equal(pending(engine)?.kind, "replacementChoice", "offered");
  answerPending(engine, "replacementChoice", { apply: true });
  assert.equal(zoneOf(engine, id("h1")), "void");
  developDraw(engine, P1);
  assert.equal(pending(engine)?.kind, "mayPay");
  drain(engine, developAnswers(b, ["h1"], true));
  assert.equal(zoneOf(engine, id("h1")), "hand", "back in its owner's hand");
  assert.deepEqual(deckOf(b, P1), [id("d1")], "instead of drawing");
});

// --- 3:ability:ae-withdraw — WITHDRAW: Pay 1. Draw a card. Discard 2 cards. ---------------------------------

/** Answers a WITHDRAW run: the discard pick is `picks`; any Escrow replacement prompt is declined. */
const withdrawAnswers = (b: Board, picks: string[]) => (pc: { kind: string; [k: string]: unknown }): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: picks.map((k) => b.id(k)) } : declineAll(pc);

const withdrawBoard = (extra: CardPlacement[] = [], greed = 3): Board =>
  escBoard([cardAt("h1", P1, "hand"), cardAt("h2", P1, "hand"), deckCard("d1"), deckCard("d2"), ...bank("greed", greed, P1), ...extra]);

clause(ESC, "3:ability:ae-withdraw", "COST: pays exactly 1 resource (not depleted: WITHDRAW can be used again)", () => {
  const b = withdrawBoard();
  const { engine, id } = b;
  assert.equal(readyResources(engine, P1), 3);
  activate(engine, P1, id("esc"), "ae-withdraw");
  assert.equal(readyResources(engine, P1), 2, "1 resource paid before anything resolved");
  drain(engine, withdrawAnswers(b, ["h1", "h2"]));
  assert.equal(readyResources(engine, P1), 2);
  assert.equal(engine.state.cards[id("esc")].depleted ?? false, false, "no 'deplete this card' cost");
});

clause(ESC, "3:ability:ae-withdraw", "refused with nothing to pay with; allowed with exactly 1 resource", () => {
  const none = withdrawBoard([], 0);
  refused(() => activate(none.engine, P1, none.id("esc"), "ae-withdraw"), "0 resources: cannot pay 1");
  assert.deepEqual(handOf(none, P1).length, 2, "nothing happened");
  assert.deepEqual(deckOf(none, P1).length, 2);
  const one = withdrawBoard([], 1);
  activate(one.engine, P1, one.id("esc"), "ae-withdraw");
  assert.equal(readyResources(one.engine, P1), 0);
  assert.equal(pending(one.engine)?.kind, "chooserSelectsTarget", "resolving");
});

clause(ESC, "3:ability:ae-withdraw", "EFFECT: draws the TOP card first, then I discard 2 cards of my choice (the drawn card included)", () => {
  const b = withdrawBoard();
  const { engine, id } = b;
  activate(engine, P1, id("esc"), "ae-withdraw");
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I choose the discards");
  assert.deepEqual([...handOf(b, P1)].sort(), [id("h1"), id("h2"), id("d1")].sort(), "the draw (d1, the top card) already happened");
  assert.deepEqual(deckOf(b, P1), [id("d2")]);
  drain(engine, withdrawAnswers(b, ["h1", "d1"]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.equal(zoneOf(engine, id("d1")), "discard", "the card I just drew is a legal discard");
  assert.equal(zoneOf(engine, id("h2")), "hand", "the card I did not pick stays");
  assert.deepEqual(handOf(b, P1), [id("h2")], "net hand size -1");
  assert.deepEqual(deckOf(b, P1), [id("d2")], "only one card drawn");
});

clause(ESC, "3:ability:ae-withdraw", "'Discard 2 cards' means exactly two, from my hand: one, three, or someone else's card are refused", () => {
  const b = withdrawBoard([cardAt("h3", P1, "hand"), cardAt("foe", P2, "hand"), cardAt("inplay", P1, "play")]);
  const { engine, id } = b;
  activate(engine, P1, id("esc"), "ae-withdraw");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  const answer = (...keys: string[]) => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: keys.map((k) => id(k)) } } as never);
  refused(() => answer("h1"), "only one card");
  refused(() => answer("h1", "h2", "h3"), "three cards");
  refused(() => answer("h1", "foe"), "the opponent's hand card");
  refused(() => answer("h1", "inplay"), "a card in play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  answer("h1", "h2");
  drain(engine, withdrawAnswers(b, ["h1", "h2"]));
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.equal(zoneOf(engine, id("h2")), "discard");
  assert.equal(zoneOf(engine, id("h3")), "hand");
  assert.equal(zoneOf(engine, id("foe")), "hand");
});

clause(ESC, "3:ability:ae-withdraw", "with only 1 card in hand after the draw I discard that one card (no soft-lock)", () => {
  const b = escBoard([deckCard("d1"), deckCard("d2"), ...bank("greed", 1, P1)]);
  const { engine, id } = b;
  activate(engine, P1, id("esc"), "ae-withdraw");
  drain(engine, withdrawAnswers(b, ["d1"]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("d1")), "discard", "drew d1 and discarded it: as many as possible");
  assert.deepEqual(handOf(b, P1), []);
  assert.deepEqual(deckOf(b, P1), [id("d2")]);
});

clause(ESC, "3:ability:ae-withdraw", "can be used again the same turn, paying 1 each time", () => {
  const b = withdrawBoard([cardAt("h3", P1, "hand"), deckCard("d3")], 2);
  const { engine, id } = b;
  activate(engine, P1, id("esc"), "ae-withdraw");
  drain(engine, withdrawAnswers(b, ["h1", "h2"]));
  activate(engine, P1, id("esc"), "ae-withdraw");
  drain(engine, withdrawAnswers(b, ["h3", "d1"]));
  assert.equal(readyResources(engine, P1), 0, "2 paid in total");
  assert.deepEqual([...handOf(b, P1)].sort(), [id("d2")].sort(), "h3,h2,h1 + d1,d2: 5 cards seen, 4 discarded");
  for (const k of ["h1", "h2", "h3", "d1"]) assert.equal(zoneOf(engine, id(k)), "discard");
});

clause(ESC, "3:ability:ae-withdraw", "only its controller: my opponent cannot activate my Escrow, even in a response window", () => {
  const b = escBoard([
    ...bank("greed", 2, P1),
    ...bank("greed", 2, P2),
    cardAt("h1", P1, "hand"),
    cardAt("d1", P1, "deck"),
    { key: "atk", def: character({ name: "Atk" }), owner: P1, zone: "play" },
    cardAt("fh1", P2, "hand"),
    cardAt("fd1", P2, "deck")
  ]);
  const { engine, id } = b;
  declareAttackOpenWindow(engine, P1, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P2, "the defender holds priority");
  refused(() => activate(engine, P2, id("esc"), "ae-withdraw"), "not their card", /control|owner|Activated ability|activate/i);
  assert.deepEqual(handOf(b, P2), [id("fh1")], "the opponent drew nothing");
});

// --- 4:flipUp — FLIP UP: 1 [G][G] -------------------------------------------------------------------

const flipBoard = (o: { greed?: number; rage?: number; oppGreed?: number; turn?: number; active?: PlayerId; zone?: "play" | "hand"; faceDown?: boolean } = {}): Board =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "esc", def: printing(ESC), owner: P1, zone: o.zone ?? "play", faceDown: (o.zone ?? "play") === "play" ? o.faceDown ?? true : undefined },
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.oppGreed ?? 0, P2)
    ]
  });
const flipUp = (b: Board, player: PlayerId = P1): void => {
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("esc"), selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
};

clause(ESC, "4:flipUp", "flipping up a face-down Escrow pays exactly 1 and, with [G][G], turns it into a face-up item in play", () => {
  const b = flipBoard({ greed: 3 });
  const { engine, id } = b;
  assert.equal(readyResources(engine, P1), 4, "3 greed + the face-down Escrow itself");
  flipUp(b);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("esc")), "play");
  assert.equal(engine.state.cards[id("esc")].faceDown, false, "face-up");
  assert.equal(readyResources(engine, P1), 2, "4 resources: 1 paid, and the flipped card is no longer a resource (4 - 1 - 1)");
});

clause(ESC, "4:flipUp", "exactly [G][G] is enough (the face-down Escrow's own Volition pays the 1: CR 507.4b)", () => {
  const b = flipBoard({ greed: 2 });
  assert.equal(readyResources(b.engine, P1), 3);
  flipUp(b);
  assert.equal(b.engine.state.cards[b.id("esc")].faceDown, false);
  assert.equal(readyResources(b.engine, P1), 1, "3 - 1 paid - the card itself");
});

clause(ESC, "4:flipUp", "refused without both [G]: one Greed (however many other icons), none, or only the opponent's Greed", () => {
  const ok = flipBoard({ greed: 2, rage: 3 });
  flipUp(ok);
  assert.equal(ok.engine.state.cards[ok.id("esc")].faceDown, false, "control: [G][G] plus other icons works");
  for (const [label, opts] of [
    ["one [G] and plenty of Rage", { greed: 1, rage: 4 }],
    ["no [G], only Rage", { greed: 0, rage: 5 }],
    ["only the face-down card's own Volition", { greed: 0, rage: 0 }],
    ["my opponent's [G][G][G]", { greed: 1, rage: 2, oppGreed: 3 }]
  ] as const) {
    const b = flipBoard(opts);
    refused(() => flipUp(b), label);
    assert.equal(b.engine.state.cards[b.id("esc")].faceDown, true, `${label}: still face-down`);
  }
});

clause(ESC, "4:flipUp", "FLIP UP does not change when an item can be deployed: refused on my opponent's turn", () => {
  const ok = flipBoard({ greed: 2 });
  flipUp(ok);
  assert.equal(zoneOf(ok.engine, ok.id("esc")), "play", "control: my own turn works");
  const b = flipBoard({ greed: 2, turn: 2, active: P2 });
  refused(() => flipUp(b), "opponent's turn");
  assert.equal(b.engine.state.cards[b.id("esc")].faceDown, true);
});

clause(ESC, "4:flipUp", "a non-tactic FLIP UP is refused inside my opponent's response window (their declared attack)", () => {
  // Their attack declaration opens a response window in which I hold priority.
  const b2 = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "esc", def: printing(ESC), owner: P1, zone: "play", faceDown: true },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...bank("greed", 2, P1)
    ]
  });
  declareAttackOpenWindow(b2.engine, P2, [b2.id("atk")]);
  assert.equal(b2.engine.state.priorityPlayerId, P1, "I hold priority in their window");
  refused(() => flipUpNow(b2.engine, { type: "flipUp", playerId: P1, cardId: b2.id("esc"), selected: {}, variables: {} }), "item FLIP UP in a response window");
  assert.equal(b2.engine.state.cards[b2.id("esc")].faceDown, true);
});

clause(ESC, "4:flipUp", "only a face-down card in play can be flipped up: Escrow in hand is refused (it is simply deployed for 2)", () => {
  const b = flipBoard({ greed: 3, zone: "hand" });
  refused(() => flipUp(b), "not face-down in play");
  assert.equal(zoneOf(b.engine, b.id("esc")), "hand");
});

clause(ESC, "4:flipUp", "a face-down Escrow has no WITHDRAW; once flipped up it does", () => {
  const b = flipBoard({ greed: 3 });
  const { engine, id } = b;
  refused(() => activate(engine, P1, id("esc"), "ae-withdraw"), "face-down: no abilities", /ability|face-down/i);
  flipUp(b);
  assert.equal(engine.state.cards[id("esc")].faceDown, false);
  const before = readyResources(engine, P1);
  activate(engine, P1, id("esc"), "ae-withdraw");
  assert.equal(readyResources(engine, P1), before - 1, "WITHDRAW is available (pays 1)");
});

// =====================================================================================
// AUDACIOUS APPRAISAL — tactic, cost 2, [G]
// COST: Pick a character. EFFECT: That character's controller chooses a number for X. Choose one:
// That player's faction loses X influence, or destroy the picked character and your faction loses
// X+X influence.
// =====================================================================================

const AA = "0a308026-4ef1-4c86-ad13-64df84f0f6cd";
type PC = { kind: string; [k: string]: unknown };

const infl = (b: Board, p: PlayerId): number => b.engine.state.players[p].influence;

function aaBoard(o: { greed?: number; rage?: number; p1?: number; p2?: number; extra?: CardPlacement[] } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction(), influence: o.p1 ?? 20 },
    playerB: { faction: developFaction(), influence: o.p2 ?? 20 },
    cards: [
      { key: "aa", def: printing(AA), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 2, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

/** Answers the number prompt with `x` and the "choose one" prompt with option `mode` (0 = influence loss, 1 = destroy). */
const aaAnswers = (x: number, mode: 0 | 1) => (pc: PC): unknown =>
  pc.kind === "chooseNumber" ? { kind: "chooseNumber", value: x } : pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: mode } : declineAll(pc);

function cast(b: Board, target: string, x: number, mode: 0 | 1): void {
  play(b.engine, P1, b.id("aa"), { selected: { ch: [b.id(target)] } });
  drain(b.engine, aaAnswers(x, mode));
}

clause(AA, "0:ability", "costs 2 with [G]: 2 resources are spent, and the tactic then goes to my discard pile", () => {
  const b = aaBoard({ greed: 1, rage: 1 });
  assert.equal(readyResources(b.engine, P1), 2);
  cast(b, "foe", 0, 0);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(readyResources(b.engine, P1), 0, "exactly 2 paid");
  assert.equal(zoneOf(b.engine, b.id("aa")), "discard");
});

clause(AA, "0:ability", "is refused one resource short, and refused without [G] even with enough resources", () => {
  const short = aaBoard({ greed: 1, rage: 0 });
  refused(() => play(short.engine, P1, short.id("aa"), { selected: { ch: [short.id("foe")] } }), "cost 2 with 1 resource");
  assert.equal(zoneOf(short.engine, short.id("aa")), "hand");
  const noGreed = aaBoard({ greed: 0, rage: 3 });
  refused(() => play(noGreed.engine, P1, noGreed.id("aa"), { selected: { ch: [noGreed.id("foe")] } }), "no [G]");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("aa")), "hand");
  const ok = aaBoard({ greed: 1, rage: 1 });
  cast(ok, "foe", 0, 0);
  assert.equal(zoneOf(ok.engine, ok.id("aa")), "discard", "control: [G] plus another resource works");
});

clause(AA, "0:ability", "COST: pick exactly one character, mine or theirs; nothing else (none, two, item, face-down card, faction, card in hand) is a legal pick", () => {
  const extras = (): CardPlacement[] => [
    { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" },
    { key: "fd", def: character({ name: "Fd" }), owner: P2, zone: "play", faceDown: true }
  ];
  for (const target of ["foe", "mine"]) {
    const ok = aaBoard({ extra: extras() });
    cast(ok, target, 0, 0);
    assert.equal(zoneOf(ok.engine, ok.id("aa")), "discard", `control: ${target} is a legal pick`);
  }
  const attempt = (label: string, pick: (b: Board) => CardInstanceId[]): void => {
    const b = aaBoard({ extra: extras() });
    refused(() => play(b.engine, P1, b.id("aa"), { selected: { ch: pick(b) } }), label);
    assert.equal(zoneOf(b.engine, b.id("aa")), "hand", `${label}: not played`);
  };
  attempt("no pick", () => []);
  attempt("two characters", (b) => [b.id("foe"), b.id("foe2")]);
  attempt("an item", (b) => [b.id("itm")]);
  attempt("a face-down card (it is a resource, CR 411.1)", (b) => [b.id("fd")]);
  attempt("a faction", (b) => [factionOf(b.engine, P2)]);
  attempt("a card in hand", (b) => [b.id("aa")]);
});

clause(AA, "0:ability", "the picked character's controller chooses X (whole number >= 0), BEFORE I choose the option", () => {
  const b = aaBoard();
  play(b.engine, P1, b.id("aa"), { selected: { ch: [b.id("foe")] } });
  const first = pending(b.engine);
  assert.equal(first?.kind, "chooseNumber");
  assert.equal(first?.playerId, P2, "the opponent controls the picked character: THEY choose X");
  const answer = (value: number) => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooseNumber", value } } as never);
  refused(() => answer(-1), "negative X (CR 410.2)");
  refused(() => answer(1.5), "fractional X (CR 410.2)");
  assert.equal(pending(b.engine)?.kind, "chooseNumber", "still waiting for a legal number");
  answer(2);
  const second = pending(b.engine);
  assert.equal(second?.kind, "chooserSelectsOption", "then 'Choose one'");
  assert.equal(second?.playerId, P1, "I (the tactic's controller) choose the option");
  const options = second?.options as unknown[] | undefined;
  assert.equal(options?.length, 2, "exactly two options");
});

clause(AA, "0:ability", "my own character: I choose X myself, then the option", () => {
  const b = aaBoard();
  play(b.engine, P1, b.id("aa"), { selected: { ch: [b.id("mine")] } });
  const first = pending(b.engine);
  assert.equal(first?.kind, "chooseNumber");
  assert.equal(first?.playerId, P1, "I control the picked character");
  answerPending(b.engine, "chooseNumber", { value: 1 });
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  assert.equal(pending(b.engine)?.playerId, P1);
});

clause(AA, "0:ability", "option 1 on their character: THAT player's faction loses X influence and the character stays", () => {
  for (const x of [0, 1, 3]) {
    const b = aaBoard();
    cast(b, "foe", x, 0);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(infl(b, P2), 20 - x, `X=${x}: their faction loses exactly X`);
    assert.equal(infl(b, P1), 20, `X=${x}: mine is unchanged`);
    assert.equal(zoneOf(b.engine, b.id("foe")), "play", "the picked character is not destroyed");
    assert.equal(zoneOf(b.engine, b.id("foe2")), "play");
    assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  }
});

clause(AA, "0:ability", "option 2 on their character: destroy it and MY faction loses X+X influence (theirs is untouched)", () => {
  for (const x of [0, 1, 3]) {
    const b = aaBoard();
    cast(b, "foe", x, 1);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id("foe")), "discard", `X=${x}: destroyed`);
    assert.equal(infl(b, P1), 20 - 2 * x, `X=${x}: my faction loses X+X`);
    assert.equal(infl(b, P2), 20, `X=${x}: their faction is untouched`);
    assert.equal(zoneOf(b.engine, b.id("foe2")), "play", "other characters survive");
    assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  }
});

clause(AA, "0:ability", "my own character, option 1: 'that player' is me, so MY faction loses X and nobody else does", () => {
  const b = aaBoard();
  cast(b, "mine", 3, 0);
  assert.equal(infl(b, P1), 17);
  assert.equal(infl(b, P2), 20);
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(AA, "0:ability", "my own character, option 2: it is destroyed and my faction loses X+X (not 3X)", () => {
  const b = aaBoard();
  cast(b, "mine", 3, 1);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(infl(b, P1), 14, "20 - (3+3)");
  assert.equal(infl(b, P2), 20);
});

clause(AA, "0:ability", "a lethal X ends the game: their faction at 0 influence loses", () => {
  const b = aaBoard({ p2: 5 });
  cast(b, "foe", 5, 0);
  assert.equal(infl(b, P2), 0);
  assert.equal(b.engine.state.winner, P1, "the owner of a 0-influence faction immediately loses (CR 102.1)");
});

// =====================================================================================
// AUSPICIOUS ARRIVAL — tactic, cost 2, [G][G][G]
// Look at the top 8 cards of your deck. You may choose a character among them with 1 strength or
// less and reveal it. If you do, put it into your hand. Shuffle your deck. -- FLIP UP: 3 [G]
// =====================================================================================

const AU = "353e341b-7e8a-4a9b-8b5e-caa53eaf3042";

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** My deck is c0 (top) .. c(n-1): characters with strength 3 unless `strengths`/`itemAt` override. */
function auBoard(
  o: {
    greed?: number;
    rage?: number;
    deckSize?: number;
    strengths?: Record<number, number>;
    itemAt?: number[];
    zone?: "hand" | "play";
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
): Board {
  const deck: CardPlacement[] = Array.from({ length: o.deckSize ?? 12 }, (_, i) => ({
    key: `c${i}`,
    def: o.itemAt?.includes(i) ? item({ name: `Item${i}` }) : character({ name: `C${i}`, strength: o.strengths?.[i] ?? 3 }),
    owner: P1,
    zone: "deck" as const
  }));
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0,
    turn: o.turn,
    activePlayerId: o.active,
    cards: [
      { key: "au", def: printing(AU), owner: P1, zone: o.zone ?? "hand", faceDown: o.zone === "play" ? true : undefined },
      ...deck,
      { key: "o0", def: character({ name: "O0", strength: 0 }), owner: P2, zone: "deck" },
      { key: "o1", def: character({ name: "O1", strength: 3 }), owner: P2, zone: "deck" },
      ...bank("greed", o.greed ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
const reveals = (b: Board) => b.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
const castAU = (b: Board, picks: string[]): void => {
  play(b.engine, P1, b.id("au"), { selected: { pick: picks.map((k) => b.id(k)) } });
  drain(b.engine, declineAll);
};

clause(AU, "0:rule", "pays 2 and needs [G][G][G]: two Greed plus Rage is refused, three Greed is fine", () => {
  const ok = auBoard({ greed: 3 });
  assert.equal(readyResources(ok.engine, P1), 3);
  castAU(ok, []);
  assert.equal(readyResources(ok.engine, P1), 1, "exactly 2 paid");
  assert.equal(zoneOf(ok.engine, ok.id("au")), "discard");
  const short = auBoard({ greed: 2, rage: 2 });
  refused(() => castAU(short, []), "only [G][G]");
  assert.equal(zoneOf(short.engine, short.id("au")), "hand");
});

clause(AU, "0:rule", "I choose a character with 1 strength or less from the top 8 and it goes to my hand, revealed to everyone", () => {
  const b = auBoard({ strengths: { 3: 1 } });
  const { engine, id } = b;
  assert.equal(deckOf(b, P1)[0], id("c0"), "c0 is the top card");
  castAU(b, ["c3"]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("c3")), "hand");
  assert.deepEqual(handOf(b, P1), [id("c3")], "only the chosen card");
  const r = reveals(b);
  assert.equal(r.length, 1, "revealed once");
  const ev = r[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("c3")], "exactly the chosen card");
  assert.equal(ev.viewerId, "all", "to everyone");
  assert.equal(zoneOf(engine, id("au")), "discard");
});

clause(AU, "0:rule", "legal picks: strength 0 and 1, the very top card and the 8th card", () => {
  for (const [key, strengths] of [
    ["c0", { 0: 0 }],
    ["c0", { 0: 1 }],
    ["c7", { 7: 1 }],
    ["c4", { 4: 0 }]
  ] as const) {
    const b = auBoard({ strengths });
    castAU(b, [key]);
    assert.equal(zoneOf(b.engine, b.id(key)), "hand", `${key} with strength ${Object.values(strengths)[0]}`);
  }
});

clause(AU, "0:rule", "illegal picks are refused: strength 2, the 9th card, an item in the top 8, the opponent's deck, two cards", () => {
  const attempt = (label: string, b: Board, picks: string[]): void => {
    refused(() => castAU(b, picks), label);
    assert.equal(zoneOf(b.engine, b.id("au")), "hand", `${label}: not played`);
    assert.deepEqual(handOf(b, P1).filter((c) => c !== b.id("au")), [], `${label}: nothing taken`);
  };
  attempt("strength 2", auBoard({ strengths: { 2: 2 } }), ["c2"]);
  attempt("strength 3 (default)", auBoard(), ["c5"]);
  attempt("the 9th card, though strength 1", auBoard({ strengths: { 8: 1 } }), ["c8"]);
  attempt("the 12th card", auBoard({ strengths: { 11: 0 } }), ["c11"]);
  attempt("an item among the top 8", auBoard({ itemAt: [2] }), ["c2"]);
  attempt("my opponent's strength-0 deck card", auBoard(), ["o0"]);
  attempt("two weak characters", auBoard({ strengths: { 1: 1, 2: 1 } }), ["c1", "c2"]);
});

clause(AU, "0:rule", "a short deck: with only 3 cards the weak one is found among them", () => {
  const b = auBoard({ deckSize: 3, strengths: { 2: 1 } });
  castAU(b, ["c2"]);
  assert.equal(zoneOf(b.engine, b.id("c2")), "hand");
  assert.equal(deckOf(b, P1).length, 2);
});

clause(AU, "0:rule", "the deck is shuffled afterwards (the picked card is not in it), and my opponent's deck is not touched", () => {
  const b = auBoard({ strengths: { 3: 1 } });
  const before = [...deckOf(b, P1)];
  const oppBefore = [...deckOf(b, P2)];
  castAU(b, ["c3"]);
  const remaining = before.filter((c) => c !== b.id("c3"));
  assert.deepEqual(deckOf(b, P1), shuffledWithConstant(remaining, 0), "11 cards left, in shuffled order");
  assert.notDeepEqual(deckOf(b, P1), remaining, "the order really changed");
  assert.deepEqual(deckOf(b, P2), oppBefore, "their deck is unchanged");
});

clause(AU, "0:rule", "'You may': choosing no card changes nothing but the shuffle (no reveal, nothing to hand)", () => {
  const b = auBoard({ strengths: { 3: 1 } });
  const before = [...deckOf(b, P1)];
  castAU(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(b, P1), [], "'if you do' did not happen: nothing to hand");
  assert.equal(reveals(b).length, 0, "nothing was revealed");
  assert.deepEqual(deckOf(b, P1), shuffledWithConstant(before, 0), "the deck is shuffled even so");
  assert.equal(zoneOf(b.engine, b.id("au")), "discard");
});

clause(AU, "0:rule", "with no character of strength 1 or less in the top 8 there is nothing to take, and the deck is still shuffled", () => {
  const b = auBoard({ strengths: { 9: 0 } });
  const before = [...deckOf(b, P1)];
  castAU(b, []);
  assert.deepEqual(handOf(b, P1), []);
  assert.deepEqual(deckOf(b, P1), shuffledWithConstant(before, 0));
});

/** Flips the face-down Auspicious Arrival up with my pick. */
const flipAU = (b: Board, picks: string[], player: PlayerId = P1): void => {
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("au"), selected: { pick: picks.map((k) => b.id(k)) }, variables: {} });
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
};

clause(AU, "1:flipUp", "FLIP UP pays exactly 3 and needs only one [G]: it then does the same thing (take the weak character, reveal, shuffle) and the tactic is discarded", () => {
  const b = auBoard({ zone: "play", greed: 1, rage: 4, strengths: { 5: 1 } });
  const { engine, id } = b;
  const before = [...deckOf(b, P1)];
  assert.equal(readyResources(engine, P1), 6, "5 banks + the face-down card");
  flipAU(b, ["c5"]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("au")), "discard", "a resolved tactic goes to the discard pile");
  assert.equal(zoneOf(engine, id("c5")), "hand");
  assert.equal(reveals(b).length, 1);
  assert.deepEqual(deckOf(b, P1), shuffledWithConstant(before.filter((c) => c !== id("c5")), 0));
  assert.equal(readyResources(engine, P1), 2, "6 resources: 3 paid and the card itself is gone");
});

clause(AU, "1:flipUp", "FLIP UP can be paid with the card itself: two other resources (one [G]) plus the face-down card is exactly enough", () => {
  const b = auBoard({ zone: "play", greed: 1, rage: 1 });
  flipAU(b, []);
  assert.equal(zoneOf(b.engine, b.id("au")), "discard");
  assert.equal(readyResources(b.engine, P1), 0);
});

clause(AU, "1:flipUp", "FLIP UP is refused one resource short and refused without [G]", () => {
  const short = auBoard({ zone: "play", greed: 1, rage: 0 });
  assert.equal(readyResources(short.engine, P1), 2);
  refused(() => flipAU(short, []), "2 resources for a cost of 3");
  assert.equal(short.engine.state.cards[short.id("au")].faceDown, true);
  const noGreed = auBoard({ zone: "play", greed: 0, rage: 5 });
  refused(() => flipAU(noGreed, []), "no [G]");
  assert.equal(noGreed.engine.state.cards[noGreed.id("au")].faceDown, true);
  const oppGreed = auBoard({ zone: "play", greed: 0, rage: 4, extra: bank("greed", 3, P2) });
  refused(() => flipAU(oppGreed, []), "only my opponent has [G]");
});

clause(AU, "1:flipUp", "a tactic's FLIP UP is allowed in my opponent's response window (unlike an item's)", () => {
  const b = auBoard({
    zone: "play",
    greed: 1,
    rage: 4,
    strengths: { 5: 1 },
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.priorityPlayerId, P1, "I hold priority in their window");
  flipUpNow(b.engine, { type: "flipUp", playerId: P1, cardId: b.id("au"), selected: { pick: [b.id("c5")] }, variables: {} });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("au")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c5")), "hand");
});

// =====================================================================================
// CONTRACTUAL EXECUTION — tactic, cost 3, [G][G]
// COST: Pick a character. That character's controller picks a resource they control. Put the
// resource into its owner's hand. EFFECT: Flip the character face down under its owner's control.
// =====================================================================================

const CE = "fd6b9183-805b-44d0-a3c0-dbb0758bd4b8";

function ceBoard(o: { greed?: number; rage?: number; oppRes?: number; extra?: CardPlacement[] } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ce", def: printing(CE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("rage", o.oppRes ?? 3, P2),
      ...(o.extra ?? [])
    ]
  });
}
const resourcesOf = (b: Board, p: PlayerId): CardInstanceId[] => b.engine.state.players[p].play.filter((c) => b.engine.isResource(c));

clause(CE, "0:ability", "costs 3 with [G][G]: refused one short, refused with only one [G], allowed with exactly enough", () => {
  const short = ceBoard({ greed: 2 });
  refused(() => play(short.engine, P1, short.id("ce"), { selected: { ch: [short.id("foe")] } }), "2 resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("ce")), "hand");
  const oneG = ceBoard({ greed: 1, rage: 3 });
  refused(() => play(oneG.engine, P1, oneG.id("ce"), { selected: { ch: [oneG.id("foe")] } }), "one [G] is not [G][G]");
  const ok = ceBoard({ greed: 2, rage: 1 });
  const theirFirst = resourcesOf(ok, P2)[0];
  play(ok.engine, P1, ok.id("ce"), { selected: { ch: [ok.id("foe")] } });
  drain(ok.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [theirFirst] } : declineAll(pc)));
  assert.equal(zoneOf(ok.engine, ok.id("ce")), "discard", "control: [G][G] and 3 resources works");
  assert.equal(ok.engine.state.cards[ok.id("foe")].faceDown, true);
});

clause(CE, "0:ability", "their character: THEY pick one of THEIR resources, it goes to their hand, and the character is flipped face-down", () => {
  const b = ceBoard();
  const { engine, id } = b;
  const theirs = resourcesOf(b, P2);
  const mineBefore = resourcesOf(b, P1);
  play(engine, P1, id("ce"), { selected: { ch: [id("foe")] } });
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P2, "the character's controller picks");
  answerPending(engine, "chooserSelectsTarget", { selected: [theirs[1]] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, theirs[1]), "hand", "the resource is put into its owner's hand");
  assert.ok(engine.state.players[P2].hand.includes(theirs[1]), "engine.state.players[P2].hand.includes(theirs[1])");
  assert.equal(zoneOf(engine, theirs[0]), "play", "their other resources stay");
  assert.equal(zoneOf(engine, theirs[2]), "play");
  assert.equal(mineBefore.every((c) => zoneOf(engine, c) === "play"), true, "none of MY resources went anywhere");
  assert.equal(engine.state.cards[id("foe")].faceDown, true, "flipped face-down");
  assert.equal(zoneOf(engine, id("foe")), "play", "it stays in play, now as a resource");
  assert.equal(engine.state.cards[id("foe")].controllerId, P2, "under its owner's control");
  assert.equal(engine.state.cards[id("foe2")].faceDown ?? false, false, "their other character is untouched");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(engine.state.cards[id("mine")].faceDown ?? false, false);
  assert.equal(zoneOf(engine, id("ce")), "discard");
});

clause(CE, "0:ability", "my character: I pick one of my resources, it goes to MY hand, and my character is flipped face-down; their resources stay", () => {
  // E3c: the pick is a COST paid before the numeric cost of 3 (paid last), so the resource put into my hand is one fewer to pay with: 4 resources.
  const b = ceBoard({ greed: 4 });
  const { engine, id } = b;
  const mine = resourcesOf(b, P1);
  const theirs = resourcesOf(b, P2);
  play(engine, P1, id("ce"), { selected: { ch: [id("mine")] } });
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "I control the character, so I pick");
  answerPending(engine, "chooserSelectsTarget", { selected: [mine[0]] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, mine[0]), "hand");
  assert.ok(engine.state.players[P1].hand.includes(mine[0]), "engine.state.players[P1].hand.includes(mine[0])");
  assert.equal(engine.state.cards[id("mine")].faceDown, true);
  for (const r of theirs) assert.equal(zoneOf(engine, r), "play", "their resources are untouched");
  assert.equal(engine.state.cards[id("foe")].faceDown ?? false, false);
});

clause(CE, "0:ability", "the picker may only choose a resource THEY control: my resource for their character, or a non-resource, is refused", () => {
  const b = ceBoard();
  const { engine, id } = b;
  play(engine, P1, id("ce"), { selected: { ch: [id("foe")] } });
  const answer = (...ids: CardInstanceId[]) => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: ids } } as never);
  refused(() => answer(resourcesOf(b, P1)[0]), "my resource");
  refused(() => answer(id("foe2")), "a character");
  refused(() => answer(resourcesOf(b, P2)[0], resourcesOf(b, P2)[1]), "two resources");
  refused(() => answer(), "no resource although they have some");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  answer(resourcesOf(b, P2)[0]);
  resolvePendingResponses(engine); // E3c: the pick is a cost; the tactic resolves after the response window
  assert.equal(engine.state.cards[id("foe")].faceDown, true, "control: a legal pick finishes it");
});

clause(CE, "0:ability", "a face-down card is a resource and can be the one picked", () => {
  const b = ceBoard({ oppRes: 0, extra: [{ key: "fdr", def: character({ name: "Fd Res" }), owner: P2, zone: "play", faceDown: true }] });
  const { engine, id } = b;
  play(engine, P1, id("ce"), { selected: { ch: [id("foe")] } });
  assert.equal(pending(engine)?.playerId, P2);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("fdr")] });
  assert.equal(zoneOf(engine, id("fdr")), "hand", "back to its owner's hand");
  assert.equal(engine.state.cards[id("foe")].faceDown, true);
});

clause(CE, "0:ability", "the resource goes to its OWNER's hand: a resource I control but my opponent owns goes to their hand", () => {
  const b = ceBoard({ extra: [{ key: "borrowed", def: character({ name: "Borrowed" }), owner: P2, controller: P1, zone: "play", faceDown: true }] });
  const { engine, id } = b;
  play(engine, P1, id("ce"), { selected: { ch: [id("mine")] } });
  assert.equal(pending(engine)?.playerId, P1);
  answerPending(engine, "chooserSelectsTarget", { selected: [id("borrowed")] });
  assert.ok(engine.state.players[P2].hand.includes(id("borrowed")), "in its owner's hand");
  assert.equal(engine.state.players[P1].hand.includes(id("borrowed")), false);
});

clause(CE, "0:ability", "the resource pick and 'put into its owner's hand' are part of the COST: already done (and asked) before opponents can respond", () => {
  const b = ceBoard();
  const { engine, id } = b;
  const theirs = resourcesOf(b, P2);
  playRaw(engine, P1, id("ce"), { selected: { ch: [id("foe")] } });
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the cost's pick is asked while casting, before any response");
  assert.equal(pc?.playerId, P2);
  engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [theirs[0]] } } as never);
  assert.equal(zoneOf(engine, theirs[0]), "hand", "cost paid: the resource is already in their hand while the tactic waits");
  assert.equal(engine.state.cards[id("foe")].faceDown ?? false, false, "the EFFECT has not happened yet");
});

clause(CE, "0:ability", "if the character's controller has no resource to pick, the cost can't be paid: the tactic can't be played", () => {
  const ctl = ceBoard({ oppRes: 1 });
  play(ctl.engine, P1, ctl.id("ce"), { selected: { ch: [ctl.id("foe")] } });
  drain(ctl.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [resourcesOf(ctl, P2)[0]] } : declineAll(pc)));
  assert.equal(ctl.engine.state.cards[ctl.id("foe")].faceDown, true, "control: with a resource to pick it works");
  const b = ceBoard({ oppRes: 0 });
  refused(() => play(b.engine, P1, b.id("ce"), { selected: { ch: [b.id("foe")] } }), "the opponent controls no resource to pick");
  assert.equal(zoneOf(b.engine, b.id("ce")), "hand");
  assert.equal(b.engine.state.cards[b.id("foe")].faceDown ?? false, false);
});

clause(CE, "0:ability", "COST: pick exactly one character: none, two, an item, a face-down card or a faction are refused", () => {
  const extras = (): CardPlacement[] => [
    { key: "itm", def: item({ name: "Itm" }), owner: P2, zone: "play" },
    { key: "fd", def: character({ name: "Fd" }), owner: P2, zone: "play", faceDown: true }
  ];
  const attempt = (label: string, pick: (b: Board) => CardInstanceId[]): void => {
    const b = ceBoard({ extra: extras() });
    refused(() => play(b.engine, P1, b.id("ce"), { selected: { ch: pick(b) } }), label);
    assert.equal(zoneOf(b.engine, b.id("ce")), "hand", `${label}: not played`);
  };
  attempt("no pick", () => []);
  attempt("two characters", (b) => [b.id("foe"), b.id("foe2")]);
  attempt("an item", (b) => [b.id("itm")]);
  attempt("a face-down card", (b) => [b.id("fd")]);
  attempt("a faction", (b) => [factionOf(b.engine, P2)]);
});

clause(CE, "0:ability", "a character I control but my opponent owns is flipped face-down under its OWNER's control", () => {
  // E3c: 4 resources: the one I pick goes to my hand BEFORE the numeric cost of 3 is paid (paid last).
  const b = ceBoard({ greed: 4, extra: [{ key: "stolen", def: character({ name: "Stolen", strength: 1, life: 3, speed: 1 }), owner: P2, controller: P1, zone: "play" }] });
  const { engine, id } = b;
  const mine = resourcesOf(b, P1);
  play(engine, P1, id("ce"), { selected: { ch: [id("stolen")] } });
  assert.equal(pending(engine)?.playerId, P1, "I control it, so I pick the resource");
  answerPending(engine, "chooserSelectsTarget", { selected: [mine[0]] });
  assert.equal(engine.state.cards[id("stolen")].faceDown, true);
  assert.equal(engine.state.cards[id("stolen")].ownerId, P2);
  assert.equal(engine.state.cards[id("stolen")].controllerId, P2, "now under its owner's control");
});

clause(CE, "0:ability", "the flipped character is a fresh face-down resource: damage and depletion are gone, and an attached item is flipped face-down with it (CR 301.4)", () => {
  const b = ceBoard({
    extra: [{ key: "gear", def: item({ name: "Gear", attachTo: "character" }), owner: P2, zone: "play", attachedToKey: "foe" }]
  });
  const { engine, id } = b;
  engine.state.cards[id("foe")].damage = 2;
  engine.state.cards[id("foe")].depleted = true;
  const theirs = resourcesOf(b, P2);
  play(engine, P1, id("ce"), { selected: { ch: [id("foe")] } });
  answerPending(engine, "chooserSelectsTarget", { selected: [theirs[0]] });
  const foe = engine.state.cards[id("foe")];
  assert.equal(foe.faceDown, true);
  assert.equal(foe.damage ?? 0, 0, "it left play: damage reset (CR 408.9)");
  assert.equal(foe.depleted ?? false, false, "and it is not depleted");
  // User ruling (2026-10-27): cards attached to a flipped character leave play the same way it does (CR 301.4), so the item is flipped face-down too.
  const gear = engine.state.cards[id("gear")];
  assert.equal(gear.zone, "play", "the attached item stays in play");
  assert.equal(gear.faceDown, true, "as a face-down resource");
  assert.equal(gear.attachedTo, undefined);
});

// =====================================================================================
// ENLIGHTENED MAU — character, cost 3, [G][G], 3/3/2 (str/spd/life), subtypes mau + pacifist
// All damage assigned to this card by characters with items attached to them is reduced to 0.
// -- TRANSCEND -- COST: Pay 5. -- EFFECT: This turn, this card gains COVERT.
// =====================================================================================

const MAU = "3e70504b-36ea-4600-afc5-70254e5dc13c";

function mauBoard(extra: CardPlacement[] = [], o: { turn?: number; active?: PlayerId; zone?: "play" | "hand"; greed?: number; rage?: number } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [{ key: "mau", def: printing(MAU), owner: P1, zone: o.zone ?? "play" }, ...bank("greed", o.greed ?? 0, P1), ...bank("rage", o.rage ?? 0, P1), ...extra]
  });
}
const fighter = (key: string, strength: number, owner: PlayerId = P2, life = 4): CardPlacement => ({ key, def: character({ name: key, strength, life, speed: 3 }), owner, zone: "play" });
const gearOn = (key: string, onKey: string, owner: PlayerId = P2): CardPlacement => ({ key, def: item({ name: `Gear ${key}` }), owner, zone: "play", attachedToKey: onKey });
const dmg = (b: Board, key: string): number => b.engine.state.cards[b.id(key)].damage ?? 0;
const theirFaction = (b: Board, who: PlayerId) => ({ type: "faction" as const, playerId: who });

/** P2 (active, turn 2) attacks my faction with `attackers`; `blockers` of mine block; the battle is fought out. */
function mauDefends(b: Board, attackers: string[], blockers: string[]): void {
  fight(b.engine, P2, attackers.map((k) => b.id(k)), theirFaction(b, P1), blockers.map((k) => b.id(k)));
  resolvePendingResponses(b.engine);
}
const DEF = { turn: 2, active: P2 } as const;

clause(MAU, "0:rule", "damage from a character with an item attached to it is reduced to 0: Mau survives, while the attacker still takes Mau's 3", () => {
  const b = mauBoard([fighter("atk", 2), gearOn("gear", "atk")], DEF);
  mauDefends(b, ["atk"], ["mau"]);
  assert.equal(zoneOf(b.engine, b.id("mau")), "play", "Mau (life 2) survives a strength-2 hit");
  assert.equal(dmg(b, "mau"), 0, "all of it reduced to 0");
  assert.equal(dmg(b, "atk"), 3, "the battle really happened: Mau struck back for 3");
});

clause(MAU, "0:rule", "control: the same attacker WITHOUT an item destroys Mau (strength 2 vs life 2)", () => {
  const b = mauBoard([fighter("atk", 2)], DEF);
  mauDefends(b, ["atk"], ["mau"]);
  assert.equal(zoneOf(b.engine, b.id("mau")), "discard");
  assert.equal(dmg(b, "atk"), 3);
});

clause(MAU, "0:rule", "it works when Mau attacks too: a blocker with an item attached deals Mau no damage", () => {
  const b = mauBoard([fighter("blk", 2), gearOn("gear", "blk")]);
  fight(b.engine, P1, [b.id("mau")], theirFaction(b, P2), [b.id("blk")]);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mau")), "play");
  assert.equal(dmg(b, "mau"), 0);
  assert.equal(dmg(b, "blk"), 3);
});

clause(MAU, "0:rule", "only an item ATTACHED to the damage-dealing character counts: an unattached item in play, or an item on Mau itself, doesn't help", () => {
  const free = mauBoard([fighter("atk", 2), { key: "freegear", def: item({ name: "Free Gear" }), owner: P2, zone: "play" }], DEF);
  mauDefends(free, ["atk"], ["mau"]);
  assert.equal(zoneOf(free.engine, free.id("mau")), "discard", "an item that isn't attached to the attacker changes nothing");
  const own = mauBoard([fighter("atk", 2), gearOn("mygear", "mau", P1)], DEF);
  mauDefends(own, ["atk"], ["mau"]);
  assert.equal(zoneOf(own.engine, own.id("mau")), "discard", "an item attached to Mau itself changes nothing");
  const other = mauBoard([fighter("atk", 2), fighter("bystander", 1), gearOn("gear", "bystander")], DEF);
  mauDefends(other, ["atk"], ["mau"]);
  assert.equal(zoneOf(other.engine, other.id("mau")), "discard", "an item on a character that isn't dealing the damage changes nothing");
});

clause(MAU, "0:rule", "only damage assigned TO MAU is reduced: an ally blocking the same item-carrying attacker takes the damage", () => {
  const b = mauBoard([fighter("atk", 2), gearOn("gear", "atk"), fighter("ally", 1, P1, 3)], DEF);
  mauDefends(b, ["atk"], ["ally"]);
  assert.equal(dmg(b, "ally"), 2, "the ally takes the full 2");
  assert.equal(dmg(b, "mau"), 0);
  assert.equal(zoneOf(b.engine, b.id("mau")), "play");
});

clause(MAU, "0:rule", "per attacker: of two attackers striking Mau together, only the item-carrying one's damage is reduced", () => {
  const b = mauBoard([fighter("a1", 2), gearOn("gear", "a1"), fighter("a2", 1)], DEF);
  mauDefends(b, ["a1", "a2"], ["mau"]);
  assert.equal(zoneOf(b.engine, b.id("mau")), "play", "1 damage < life 2");
  assert.equal(dmg(b, "mau"), 1, "a1's 2 is reduced to 0, a2's 1 is not");
});

clause(MAU, "0:rule", "Mau is a vanilla-cost 3 [G][G] character with printed 3 strength / 3 speed / 2 life", () => {
  const ok = mauBoard([], { zone: "hand", greed: 3 });
  play(ok.engine, P1, ok.id("mau"));
  assert.equal(zoneOf(ok.engine, ok.id("mau")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 3 paid");
  assert.equal(ok.engine.getStat(ok.id("mau"), "strength"), 3);
  assert.equal(ok.engine.getStat(ok.id("mau"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("mau"), "life"), 2);
  const short = mauBoard([], { zone: "hand", greed: 2 });
  refused(() => play(short.engine, P1, short.id("mau")), "one resource short");
  const noG = mauBoard([], { zone: "hand", greed: 1, rage: 2 });
  refused(() => play(noG.engine, P1, noG.id("mau")), "only one [G]");
  assert.equal(zoneOf(noG.engine, noG.id("mau")), "hand");
});

clause(MAU, "1:ability:mau-transcend", "COST: pay 5 (refused with 4); EFFECT: this card gains COVERT, and nobody else does", () => {
  const short = mauBoard([], { rage: 4 });
  refused(() => activate(short.engine, P1, short.id("mau"), "mau-transcend"), "pay 5 with 4 resources");
  assert.equal(short.engine.getKeywords(short.id("mau")).includes("covert"), false);
  const b = mauBoard([fighter("ally", 1, P1)], { rage: 5 });
  assert.equal(b.engine.getKeywords(b.id("mau")).includes("covert"), false, "no COVERT before");
  activate(b.engine, P1, b.id("mau"), "mau-transcend");
  assert.equal(readyResources(b.engine, P1), 0, "exactly 5 paid");
  assert.equal(b.engine.getKeywords(b.id("mau")).includes("covert"), true, "Mau gains COVERT");
  assert.equal(b.engine.getKeywords(b.id("ally")).includes("covert"), false, "an ally does not");
});

clause(MAU, "1:ability:mau-transcend", "COVERT lasts this turn only: gone once the turn ends", () => {
  const b = mauBoard([], { rage: 5 });
  activate(b.engine, P1, b.id("mau"), "mau-transcend");
  assert.equal(b.engine.getKeywords(b.id("mau")).includes("covert"), true);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getKeywords(b.id("mau")).includes("covert"), false, "no longer COVERT on my opponent's turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getKeywords(b.id("mau")).includes("covert"), false, "nor on my next turn");
});

clause(MAU, "1:ability:mau-transcend", "the COVERT is real: a non-COVERT character can't block Mau after TRANSCEND (control: it can before)", () => {
  const before = mauBoard([fighter("blk", 1)], { rage: 5 });
  declareAttackBy(before.engine, P1, [before.id("mau")]);
  declareBlockers(before.engine, P2, [before.id("blk")]);
  assert.equal(battleOfBlockers(before), 1, "control: without COVERT the blocker blocks");
  const b = mauBoard([fighter("blk", 1)], { rage: 5 });
  activate(b.engine, P1, b.id("mau"), "mau-transcend");
  declareAttackBy(b.engine, P1, [b.id("mau")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("blk")]), "a non-COVERT character can't block a COVERT party");
});
const battleOfBlockers = (b: Board): number => (b.engine.state.battle?.blockingParty ?? []).length;

// =====================================================================================
// EUSTACE PADAMOSE-GRISTWALTER — character, cost 4, [G][G][G], 1/3/3 (str/spd/life)
// UNIQUE EUSTACE -- FUTURE IMPLICATIONS -- COST: Pay 2. Your faction loses 1 influence. EFFECT:
// Draw a card. -- PAST TREPIDATIONS -- COST: Discard a card. EFFECT: This turn, this card gains
// 1 life. If the discarded card was a resource, this card also gains 1 strength this turn.
// =====================================================================================

const EUS = "3f574bdd-e7b7-4757-a955-2a33d19a250d";

function eusBoard(extra: CardPlacement[] = [], o: { zone?: "play" | "hand"; greed?: number; rage?: number; p1?: number; turn?: number; active?: PlayerId } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction(), influence: o.p1 ?? 20 },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [{ key: "eu", def: printing(EUS), owner: P1, zone: o.zone ?? "play" }, ...bank("greed", o.greed ?? 0, P1), ...bank("rage", o.rage ?? 0, P1), ...extra]
  });
}
const keyOf = (b: Board, key: string) => b.id(key);

clause(EUS, "0:unique", "the cost and printed stats: deploys for 4 with [G][G][G] as a 1 strength / 3 speed / 3 life character", () => {
  const ok = eusBoard([], { zone: "hand", greed: 3, rage: 1 });
  play(ok.engine, P1, ok.id("eu"));
  assert.equal(zoneOf(ok.engine, ok.id("eu")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 4 paid");
  assert.deepEqual([ok.engine.getStat(ok.id("eu"), "strength"), ok.engine.getStat(ok.id("eu"), "speed"), ok.engine.getStat(ok.id("eu"), "life")], [1, 3, 3]);
  const short = eusBoard([], { zone: "hand", greed: 3 });
  refused(() => play(short.engine, P1, short.id("eu")), "one resource short");
  const noGGG = eusBoard([], { zone: "hand", greed: 2, rage: 2 });
  refused(() => play(noGGG.engine, P1, noGGG.id("eu")), "only [G][G]");
  assert.equal(zoneOf(noGGG.engine, noGGG.id("eu")), "hand");
});

clause(EUS, "0:unique", "UNIQUE EUSTACE: deploying a second Eustace makes me keep one (my choice) and destroys the other", () => {
  for (const keep of ["eu", "eu2"]) {
    const b = eusBoard([{ key: "eu2", def: printing(EUS), owner: P1, zone: "hand" }], { greed: 4 });
    play(b.engine, P1, b.id("eu2"));
    const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
    assert.equal(pc?.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1, "the controller chooses");
    assert.deepEqual([...pc.candidates].sort(), [b.id("eu"), b.id("eu2")].sort());
    b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id(keep) } } as never);
    const gone = keep === "eu" ? "eu2" : "eu";
    assert.equal(zoneOf(b.engine, b.id(keep)), "play", `kept ${keep}`);
    assert.equal(zoneOf(b.engine, b.id(gone)), "discard", `${gone} destroyed`);
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(EUS, "0:unique", "the designation is EUSTACE: another card with UNIQUE EUSTACE conflicts, a different designation or none doesn't", () => {
  const sameDesignation = eusBoard([{ key: "other", def: character({ name: "Another Eustace", cost: 0, unique: "eustace" } as Partial<CardDefinition>), owner: P1, zone: "hand" }]);
  play(sameDesignation.engine, P1, sameDesignation.id("other"));
  assert.equal(pending(sameDesignation.engine)?.kind, "uniqueSurvivor", "same designation, different card");
  const different = eusBoard([{ key: "other", def: character({ name: "Not Eustace", cost: 0, unique: "someone else" } as Partial<CardDefinition>), owner: P1, zone: "hand" }]);
  play(different.engine, P1, different.id("other"));
  assert.equal(different.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(different.engine, different.id("eu")), "play");
  assert.equal(zoneOf(different.engine, different.id("other")), "play");
  const plain = eusBoard([{ key: "other", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }]);
  play(plain.engine, P1, plain.id("other"));
  assert.equal(plain.engine.state.pendingChoice, undefined);
});

clause(EUS, "0:unique", "UNIQUE is per player: my opponent may control their own Eustace with no prompt and nothing destroyed", () => {
  const b = eusBoard([{ key: "eu2", def: printing(EUS), owner: P2, zone: "hand" }, ...bank("greed", 3, P2), ...bank("rage", 1, P2)], { turn: 2, active: P2 });
  play(b.engine, P2, b.id("eu2"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("eu")), "play");
  assert.equal(zoneOf(b.engine, b.id("eu2")), "play");
});

const deckOfMine = (n: number): CardPlacement[] => Array.from({ length: n }, (_, i) => deckCard(`d${i + 1}`));

clause(EUS, "1:ability:eu-future", "pays exactly 2 resources, my faction loses exactly 1 influence, and I draw the top card", () => {
  const b = eusBoard(deckOfMine(3), { greed: 4 });
  const { engine, id } = b;
  const oppInfluence = infl(b, P2);
  activate(engine, P1, id("eu"), "eu-future");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(readyResources(engine, P1), 2, "2 of 4 paid");
  assert.equal(infl(b, P1), 19, "my faction lost 1");
  assert.equal(infl(b, P2), oppInfluence, "theirs did not");
  assert.deepEqual(handOf(b, P1), [id("d1")], "drew the top card");
  assert.deepEqual(deckOf(b, P1), [id("d2"), id("d3")]);
});

clause(EUS, "1:ability:eu-future", "both costs are paid when it is activated, before the draw resolves", () => {
  const b = eusBoard(deckOfMine(2), { greed: 4 });
  const { engine, id } = b;
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("eu"), abilityId: "eu-future", selected: {}, variables: {} } as never);
  assert.equal(readyResources(engine, P1), 2, "2 resources already spent while the ability waits");
  assert.equal(infl(b, P1), 19, "influence already lost");
  assert.deepEqual(handOf(b, P1), [], "the draw is the EFFECT: not yet");
  resolvePendingResponses(engine);
  assert.deepEqual(handOf(b, P1), [id("d1")]);
});

clause(EUS, "1:ability:eu-future", "refused with only 1 resource (nothing is paid, no influence lost, no card drawn)", () => {
  const b = eusBoard(deckOfMine(2), { greed: 1 });
  refused(() => activate(b.engine, P1, b.id("eu"), "eu-future"), "pay 2 with 1 resource");
  assert.equal(infl(b, P1), 20);
  assert.deepEqual(handOf(b, P1), []);
  assert.equal(readyResources(b.engine, P1), 1);
});

clause(EUS, "1:ability:eu-future", "can be used repeatedly: each use pays 2, loses 1 influence and draws one more card", () => {
  const b = eusBoard(deckOfMine(3), { greed: 4 });
  activate(b.engine, P1, b.id("eu"), "eu-future");
  activate(b.engine, P1, b.id("eu"), "eu-future");
  assert.equal(readyResources(b.engine, P1), 0);
  assert.equal(infl(b, P1), 18);
  assert.deepEqual(handOf(b, P1), [b.id("d1"), b.id("d2")]);
});

const resCard = (key: string): CardPlacement => ({ key, def: resourceCard({ name: key.toUpperCase() }), owner: P1, zone: "hand" });
const pastBoard = (): Board =>
  eusBoard([cardAt("hc", P1, "hand"), resCard("hr"), cardAt("hc2", P1, "hand"), { key: "foe", def: character({ name: "FoeHand" }), owner: P2, zone: "hand" }, cardAt("inplay", P1, "play")]);
const past = (b: Board, pick: string): void => activate(b.engine, P1, b.id("eu"), "eu-past", { selected: { disc: [b.id(pick)] } });

clause(EUS, "2:ability:eu-past", "discarding a non-resource card: it goes to the discard pile and Eustace gains 1 life (not strength) this turn", () => {
  const b = pastBoard();
  assert.deepEqual([b.engine.getStat(keyOf(b, "eu"), "life"), b.engine.getStat(keyOf(b, "eu"), "strength")], [3, 1]);
  past(b, "hc");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("hc")), "discard", "the card is discarded");
  assert.equal(b.engine.getStat(b.id("eu"), "life"), 4, "+1 life");
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 1, "no strength: it wasn't a resource");
  assert.equal(zoneOf(b.engine, b.id("hr")), "hand", "other hand cards stay");
});

clause(EUS, "2:ability:eu-past", "discarding a RESOURCE card: Eustace gains 1 life AND 1 strength this turn", () => {
  const b = pastBoard();
  past(b, "hr");
  assert.equal(zoneOf(b.engine, b.id("hr")), "discard");
  assert.equal(b.engine.getStat(b.id("eu"), "life"), 4);
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 2);
});

clause(EUS, "2:ability:eu-past", "the bonuses are 'this turn' only and stack across uses", () => {
  const b = pastBoard();
  past(b, "hr");
  past(b, "hc");
  assert.equal(b.engine.getStat(b.id("eu"), "life"), 5, "two uses: +2 life");
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 2, "only the resource discard gave strength");
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("eu"), "life"), 3, "gone when the turn ends");
  assert.equal(b.engine.getStat(b.id("eu"), "strength"), 1);
});

clause(EUS, "2:ability:eu-past", "COST: discard exactly one card FROM MY HAND: none, two, a card in play, or my opponent's hand are refused; nothing is gained", () => {
  const attempt = (label: string, picks: (b: Board) => CardInstanceId[]): void => {
    const b = pastBoard();
    refused(() => activate(b.engine, P1, b.id("eu"), "eu-past", { selected: { disc: picks(b) } }), label);
    assert.equal(b.engine.getStat(b.id("eu"), "life"), 3, `${label}: no life gained`);
    assert.equal(zoneOf(b.engine, b.id("inplay")), "play");
  };
  attempt("no card", () => []);
  attempt("two cards", (b) => [b.id("hc"), b.id("hc2")]);
  attempt("a card in play", (b) => [b.id("inplay")]);
  attempt("my opponent's hand card", (b) => [b.id("foe")]);
  const empty = eusBoard([]);
  refused(() => activate(empty.engine, P1, empty.id("eu"), "eu-past", { selected: { disc: [] } }), "nothing to discard");
});
