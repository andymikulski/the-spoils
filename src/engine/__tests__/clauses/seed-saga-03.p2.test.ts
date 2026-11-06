// Clause tests — batch seed-saga-03, part p2 (groups 9-13, missing clauses). See docs/TESTING.md and
// `npm run card-tests -- manifest seed-saga-03 --groups 9-13 --missing`. Expectations come from each card's
// PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import { buildGame, resolvePendingResponses, activate, bank, character, developFaction, item, location, play, resourceCard, tactic, P1, P2 } from "../per-card/_harness.js";
import { clause, clauseMismatch, printing, refused, flipUpNow, holdResourceFace, drain, declineAll } from "./_clause.js";
import { answerPending, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { developResource, endTurn, openDevelopPlay } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";

/** `n` resources of `icon` for `owner`, already attached to (spent on) their faction. */
const spent = (icon: Icon, n: number, owner: PlayerId): CardPlacement[] =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const influence = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const tokens = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].counters?.token ?? 0;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId as PlayerId;
const faceDownOf = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => !!engine.state.cards[cardId].faceDown;
const greedCard = (name: string) => resourceCard({ name, resource: { provides: ["greed"], staple: true } });
const pick = (engine: SpoilsEngine, ids: CardInstanceId[]) => answerPending(engine, "chooserSelectsTarget", { selected: ids });

// =====================================================================================
// Tumescent Guilt Bladder — item, arcanist, cost 3, [O][O][O][O].
// At the end of your turn, put a token on this card. Your faction loses X influence, where X is the
// number of tokens on this card. You may play a resource.
// At the start of each turn, if there are at least 3 tokens on this card, an opponent takes control of
// it. Remove all tokens from this card.
// =====================================================================================

const TGB = "a7351707-259c-4414-b734-962d4dc33634";

function tgbBoard(o: { tokens?: number; controller?: PlayerId; active?: PlayerId; hands?: boolean } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: () => 0.5,
    cards: [
      {
        key: "tgb",
        def: printing(TGB),
        owner: P1,
        zone: "play",
        ...(o.controller ? { controller: o.controller } : {}),
        ...(o.tokens ? { counters: { token: o.tokens } } : {})
      },
      ...fillers("d", 8, P1, "deck"),
      ...fillers("e", 8, P2, "deck"),
      ...(o.hands === false
        ? []
        : [
            { key: "r1", def: greedCard("My Greed"), owner: P1, zone: "hand" as const },
            { key: "c1", def: character({ name: "My Char" }), owner: P1, zone: "hand" as const },
            { key: "r2", def: greedCard("Their Greed"), owner: P2, zone: "hand" as const },
            { key: "c2", def: character({ name: "Their Char" }), owner: P2, zone: "hand" as const }
          ])
    ]
  });
}
type TgbGame = ReturnType<typeof tgbBoard>;
/** The active player ends their turn; the "may play a resource" pick is declined if it is open. */
const endAndDecline = (g: TgbGame, player: PlayerId) => {
  endTurn(g.engine, player);
  if (pending(g.engine)) pick(g.engine, []);
  assert.equal(pending(g.engine), undefined, "nothing left open");
};

clause(TGB, "0:rule", "printed as an arcanist item with no stats; deploys for 3 with [O][O][O][O] (3 ready + 1 spent [O] is exactly enough)", () => {
  const def = printing(TGB);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "arcanist");
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "oooo");
  const place = (cards: CardPlacement[]) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "tgb", def: printing(TGB), owner: P1, zone: "hand" }, ...cards] });
  const ok = place([...bank("obsession", 3, P1), ...spent("obsession", 1, P1)]);
  play(ok.engine, P1, ok.id("tgb"));
  assert.equal(zoneOf(ok.engine, ok.id("tgb")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "3 paid");
  const costShort = place([...bank("obsession", 2, P1), ...spent("obsession", 2, P1)]);
  refused(() => playRaw(costShort.engine, P1, costShort.id("tgb")), "only 2 ready resources for a cost of 3 (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(costShort.engine, costShort.id("tgb")), "hand");
  const iconShort = place([...bank("obsession", 3, P1), ...bank("rage", 1, P1)]);
  refused(() => playRaw(iconShort.engine, P1, iconShort.id("tgb")), "four resources but only three [O]");
  assert.equal(zoneOf(iconShort.engine, iconShort.id("tgb")), "hand");
});

clause(TGB, "0:rule", "at the end of your turn it gets a token and your faction loses X influence, X = tokens now on it (1, then 2)", () => {
  const g = tgbBoard();
  endAndDecline(g, P1);
  assert.equal(tokens(g.engine, g.id("tgb")), 1, "a token was put on it");
  assert.equal(influence(g.engine, P1), 19, "X = 1");
  endAndDecline(g, P2);
  assert.equal(tokens(g.engine, g.id("tgb")), 1, "the opponent's turn end changes nothing");
  assert.equal(influence(g.engine, P1), 19);
  endAndDecline(g, P1);
  assert.equal(tokens(g.engine, g.id("tgb")), 2);
  assert.equal(influence(g.engine, P1), 17, "X = 2 (19 - 2)");
});

clause(TGB, "0:rule", "X counts the token just put on it: starting with 2 tokens, the end of turn leaves 3 and costs 3 influence", () => {
  const g = tgbBoard({ tokens: 2 });
  endTurn(g.engine, P1);
  if (pending(g.engine)) pick(g.engine, []);
  assert.equal(influence(g.engine, P1), 17, "X = 3");
  assert.equal(influence(g.engine, P2), 20, "only your faction loses it");
});

clause(TGB, "0:rule", "'your turn': the opponent's turn ending does not trigger it (no token, no influence loss, no prompt)", () => {
  const g = tgbBoard({ active: P2 });
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokens(g.engine, g.id("tgb")), 0);
  assert.equal(influence(g.engine, P1), 20);
  assert.equal(influence(g.engine, P2), 20);
});

clause(TGB, "0:rule", "'your' = its controller: when the opponent controls it, THEIR turn end adds the token, THEIR faction loses the influence and they pick the resource", () => {
  const g = tgbBoard({ controller: P2, active: P2 });
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine)?.playerId, P2, "the controller chooses");
  pick(g.engine, []);
  assert.equal(tokens(g.engine, g.id("tgb")), 1);
  assert.equal(influence(g.engine, P2), 19, "the controller's faction loses it");
  assert.equal(influence(g.engine, P1), 20, "the owner's faction does not");
  const owners = tgbBoard({ controller: P2, active: P1 });
  endTurn(owners.engine, P1);
  assert.equal(pending(owners.engine), undefined, "the owner's turn end is not 'your turn' for the controller");
  assert.equal(tokens(owners.engine, owners.id("tgb")), 0);
  assert.equal(influence(owners.engine, P1), 20);
});

clause(TGB, "0:rule", "'You may play a resource': accepting plays the chosen hand card as a resource (a non-resource goes in face-down)", () => {
  const g = tgbBoard();
  endTurn(g.engine, P1);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1);
  pick(g.engine, [g.id("c1")]);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("c1")), "play", "it became a resource");
  assert.equal(faceDownOf(g.engine, g.id("c1")), true, "a non-resource card is played face-down");
  assert.equal(zoneOf(g.engine, g.id("r1")), "hand", "the other card stays in hand");
  assert.equal(influence(g.engine, P1), 19, "the influence loss still happened");
});

clause(TGB, "0:rule", "'You may play a resource': an actual resource card from hand is played face-up", () => {
  const g = tgbBoard();
  endTurn(g.engine, P1);
  pick(g.engine, [g.id("r1")]);
  assert.equal(zoneOf(g.engine, g.id("r1")), "play");
  assert.equal(faceDownOf(g.engine, g.id("r1")), false);
});

clause(TGB, "0:rule", "'You may play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2, 605.1b)", () => holdResourceFace(() => {
  const g = tgbBoard();
  endTurn(g.engine, P1);
  pick(g.engine, [g.id("r1")]);
  const asked = pending(g.engine) !== undefined && zoneOf(g.engine, g.id("r1")) === "hand";
  const down = zoneOf(g.engine, g.id("r1")) === "play" && faceDownOf(g.engine, g.id("r1"));
  assert.ok(asked || down, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(TGB, "0:rule", "'You may play a resource': declining plays nothing and leaves the hand alone", () => {
  const g = tgbBoard();
  endTurn(g.engine, P1);
  pick(g.engine, []);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("r1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand");
  assert.equal(tokens(g.engine, g.id("tgb")), 1);
  assert.equal(influence(g.engine, P1), 19);
});

clause(TGB, "0:rule", "the resource must come from YOUR hand: the opponent's hand card and cards in my deck are refused", () => {
  const g = tgbBoard();
  endTurn(g.engine, P1);
  refused(() => pick(g.engine, [g.id("r2")]), "a card in the opponent's hand");
  refused(() => pick(g.engine, [g.id("d0")]), "a card in my deck");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(g.engine, [g.id("r1")]);
  assert.equal(zoneOf(g.engine, g.id("r1")), "play", "control: a card from my hand works");
  assert.equal(zoneOf(g.engine, g.id("r2")), "hand");
});

clause(TGB, "0:rule", "'You may play a resource' is ONE resource: picking two hand cards is refused, one is fine", () => {
  const g = tgbBoard();
  endTurn(g.engine, P1);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  refused(() => pick(g.engine, [g.id("r1"), g.id("c1")]), "two resources picked for a single resource play");
  assert.equal(zoneOf(g.engine, g.id("r1")), "hand", "the refused pick played nothing");
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "the refused pick played nothing");
  pick(g.engine, [g.id("r1")]);
  assert.equal(zoneOf(g.engine, g.id("r1")), "play", "control: one resource is played");
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "the other card stays in hand");
});

clause(TGB, "0:rule", "with an empty hand the token and influence loss still happen and the turn passes", () => {
  const g = tgbBoard({ hands: false });
  endTurn(g.engine, P1);
  if (pending(g.engine)) pick(g.engine, []);
  assert.equal(pending(g.engine), undefined);
  assert.equal(tokens(g.engine, g.id("tgb")), 1);
  assert.equal(influence(g.engine, P1), 19);
});

clause(TGB, "1:rule", "at the start of the opponent's turn with 3 tokens, an opponent of its controller takes control and all tokens are removed", () => {
  const g = tgbBoard({ tokens: 2 });
  endTurn(g.engine, P1); // 2 -> 3 tokens, then the opponent's turn starts
  if (pending(g.engine)) pick(g.engine, []);
  assert.equal(controllerOf(g.engine, g.id("tgb")), P2, "the opponent took control");
  assert.equal(tokens(g.engine, g.id("tgb")), 0, "tokens removed");
  assert.equal(g.engine.state.cards[g.id("tgb")].zone, "play");
  assert.equal(g.engine.state.cards[g.id("tgb")].ownerId, P1, "still P1's card");
});

clause(TGB, "1:rule", "'each turn': it also checks at the start of its own controller's turn (3 tokens, P2 ends, P1's turn starts: P2 takes it)", () => {
  const g = tgbBoard({ tokens: 3, active: P2 });
  endTurn(g.engine, P2);
  assert.equal(controllerOf(g.engine, g.id("tgb")), P2, "an opponent of its controller (P1) takes control");
  assert.equal(tokens(g.engine, g.id("tgb")), 0);
});

clause(TGB, "1:rule", "the opponent in question is the opponent of the CURRENT controller: P2 controls it with 3 tokens, so P1 takes it back", () => {
  const g = tgbBoard({ tokens: 3, controller: P2, active: P1 });
  endTurn(g.engine, P1);
  if (pending(g.engine)) pick(g.engine, []);
  assert.equal(controllerOf(g.engine, g.id("tgb")), P1);
  assert.equal(tokens(g.engine, g.id("tgb")), 0);
});

clause(TGB, "1:rule", "'at least 3': more than 3 tokens also trigger it and ALL tokens go (5 -> 0)", () => {
  const g = tgbBoard({ tokens: 5, active: P2 });
  endTurn(g.engine, P2);
  assert.equal(controllerOf(g.engine, g.id("tgb")), P2);
  assert.equal(tokens(g.engine, g.id("tgb")), 0);
});

clause(TGB, "1:rule", "with only 2 tokens at the start of a turn nothing happens: no control change, tokens stay (both players' turn starts)", () => {
  const g = tgbBoard({ tokens: 2, active: P2 });
  endTurn(g.engine, P2); // P1's turn starts
  assert.equal(controllerOf(g.engine, g.id("tgb")), P1);
  assert.equal(tokens(g.engine, g.id("tgb")), 2);
  // P1's own turn end would add a token (making 3), so the opponent-start check with 2 tokens uses a P2-controlled card:
  const k = tgbBoard({ tokens: 2, controller: P2, active: P1 });
  endTurn(k.engine, P1); // P2's turn starts; P1's turn end does not trigger it (P2 controls it)
  assert.equal(controllerOf(k.engine, k.id("tgb")), P2);
  assert.equal(tokens(k.engine, k.id("tgb")), 2);
});

clause(TGB, "1:rule", "after the opponent takes it, the new controller's turn end puts a fresh token on it (1) and costs THEIR faction 1", () => {
  const g = tgbBoard({ tokens: 2 });
  endTurn(g.engine, P1);
  if (pending(g.engine)) pick(g.engine, []);
  assert.equal(influence(g.engine, P1), 17);
  endTurn(g.engine, P2);
  assert.equal(pending(g.engine)?.playerId, P2);
  pick(g.engine, []);
  assert.equal(tokens(g.engine, g.id("tgb")), 1);
  assert.equal(influence(g.engine, P2), 19);
  assert.equal(influence(g.engine, P1), 17);
});

// =====================================================================================
// Unbearable Torture — tactic, arcanist, cost 3, [O].
// EXTRA COST: Pick a character.
// If the character's life is greater than it's strength, put it into the void. Draw a card.
// RECUR: [O] -- COST: Use this only if this card is in your discard pile. Pay 2. Remove this card from
// the game. Pick a character in the void. -- EFFECT: Put the character on top of its owner's deck.
// =====================================================================================

const TORT = "36e74211-ebde-4634-a28b-9fdfec8d9ef6";

function tortBoard(o: { o?: number; rage?: number; spentO?: number; zone?: "hand" | "discard" | "play"; extra?: CardPlacement[]; owner?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "t", def: printing(TORT), owner: o.owner ?? P1, zone: o.zone ?? "hand" },
      { key: "fat", def: character({ name: "Fat", strength: 1, life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4 }), owner: P1, zone: "play" },
      { key: "item", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...fillers("h", 2, P1, "hand"),
      ...bank("obsession", o.o ?? 1, P1),
      ...bank("rage", o.rage ?? 2, P1),
      ...spent("obsession", o.spentO ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type TortGame = ReturnType<typeof tortBoard>;
const cast = (g: TortGame, target?: CardInstanceId) => play(g.engine, P1, g.id("t"), { selected: target ? { mark: [target] } : {} });

clause(TORT, "0:extraCost", "printed as an arcanist tactic; deploys for 3 with [O] (3 resources incl. one [O]); 2 resources, or 3 without [O], are refused", () => {
  const def = printing(TORT);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "arcanist");
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "o");
  const ok = tortBoard({ o: 1, rage: 2 });
  cast(ok, ok.id("fat"));
  assert.equal(zoneOf(ok.engine, ok.id("t")), "discard");
  assert.equal(readyResources(ok.engine, P1), 0, "3 paid");
  const short = tortBoard({ o: 1, rage: 1 });
  refused(() => playRaw(short.engine, P1, short.id("t"), { selected: { mark: [short.id("fat")] } }), "only 2 resources");
  assert.equal(zoneOf(short.engine, short.id("t")), "hand");
  const noIcon = tortBoard({ o: 0, rage: 3 });
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("t"), { selected: { mark: [noIcon.id("fat")] } }), "three resources, no [O]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("t")), "hand");
});

clause(TORT, "0:extraCost", "the pick is part of deploying it: with no character picked the deploy is refused and nothing is paid", () => {
  const g = tortBoard();
  refused(() => playRaw(g.engine, P1, g.id("t")), "no character picked");
  assert.equal(zoneOf(g.engine, g.id("t")), "hand");
  assert.equal(readyResources(g.engine, P1), 3, "nothing paid");
  cast(g, g.id("fat"));
  assert.equal(zoneOf(g.engine, g.id("t")), "discard", "control: with a pick it deploys");
});

clause(TORT, "0:extraCost", "any character in play can be picked (mine or theirs); an item, a character in hand, in a discard pile or in a deck cannot", () => {
  const mine = tortBoard();
  cast(mine, mine.id("mine"));
  assert.equal(zoneOf(mine.engine, mine.id("t")), "discard", "my own character");
  const theirs = tortBoard();
  cast(theirs, theirs.id("fat"));
  assert.equal(zoneOf(theirs.engine, theirs.id("t")), "discard", "their character");
  const g = tortBoard({
    extra: [
      { key: "hc", def: character({ name: "HandChar", strength: 1, life: 5 }), owner: P2, zone: "hand" },
      { key: "dc", def: character({ name: "DiscChar", strength: 1, life: 5 }), owner: P2, zone: "discard" },
      { key: "kc", def: character({ name: "DeckChar", strength: 1, life: 5 }), owner: P2, zone: "deck" }
    ]
  });
  for (const key of ["item", "hc", "dc", "kc"]) {
    refused(() => playRaw(g.engine, P1, g.id("t"), { selected: { mark: [g.id(key)] } }), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("t")), "hand", `${key} refused, tactic still in hand`);
  }
  assert.equal(readyResources(g.engine, P1), 3, "nothing paid by the refusals");
});

clause(TORT, "0:extraCost", "exactly one character is picked: two characters are refused", () => {
  const g = tortBoard();
  refused(() => playRaw(g.engine, P1, g.id("t"), { selected: { mark: [g.id("fat"), g.id("mine")] } }), "two characters");
  assert.equal(zoneOf(g.engine, g.id("t")), "hand");
  assert.equal(zoneOf(g.engine, g.id("fat")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

clause(TORT, "1:rule", "life greater than strength: the character is put into the void (its owner's, theirs here)", () => {
  const g = tortBoard();
  cast(g, g.id("fat")); // 1 strength / 5 life
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("fat")), "void");
  assert.equal(g.engine.state.cards[g.id("fat")].ownerId, P2);
});

clause(TORT, "1:rule", "life greater than strength by just 1 still voids it; my own character too", () => {
  const g = tortBoard({ extra: [{ key: "thin", def: character({ name: "Thin", strength: 2, life: 3 }), owner: P1, zone: "play" }] });
  cast(g, g.id("thin"));
  assert.equal(zoneOf(g.engine, g.id("thin")), "void");
  const h = tortBoard();
  cast(h, h.id("mine")); // 2 strength / 4 life
  assert.equal(zoneOf(h.engine, h.id("mine")), "void");
});

clause(TORT, "1:rule", "life EQUAL to strength: the character is not voided", () => {
  const g = tortBoard({ extra: [{ key: "eq", def: character({ name: "Equal", strength: 3, life: 3 }), owner: P2, zone: "play" }] });
  cast(g, g.id("eq"));
  assert.equal(zoneOf(g.engine, g.id("eq")), "play");
  assert.equal(pending(g.engine), undefined);
});

clause(TORT, "1:rule", "life LESS than strength: the character is not voided", () => {
  const g = tortBoard({ extra: [{ key: "glass", def: character({ name: "Glass", strength: 5, life: 1 }), owner: P2, zone: "play" }] });
  cast(g, g.id("glass"));
  assert.equal(zoneOf(g.engine, g.id("glass")), "play");
  assert.equal(pending(g.engine), undefined);
});

clause(TORT, "1:rule", "it compares life with strength, not remaining life: damage on a 3/3 character does not make it voidable", () => {
  const g = tortBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", strength: 3, life: 3 }), owner: P2, zone: "play", damage: 2 }] });
  cast(g, g.id("hurt"));
  assert.equal(zoneOf(g.engine, g.id("hurt")), "play", "life stat 3 is not greater than strength 3");
});

clause(TORT, "1:rule", "'Draw a card' always happens: voided or not, its controller draws exactly one card from the top of their deck", () => {
  const voided = tortBoard();
  const top = voided.engine.state.players[P1].deck[0];
  const handBefore = voided.engine.state.players[P1].hand.length; // includes the tactic
  cast(voided, voided.id("fat"));
  assert.equal(voided.engine.state.players[P1].hand.length, handBefore - 1 + 1, "tactic left the hand, one card drawn");
  assert.ok(voided.engine.state.players[P1].hand.includes(top), "the top card of my deck");
  assert.equal(voided.engine.state.players[P1].deck.length, 5);
  const oppDeck = voided.engine.state.players[P2].deck.length;
  assert.equal(oppDeck, 6, "the opponent drew nothing");
  const kept = tortBoard({ extra: [{ key: "glass", def: character({ name: "Glass", strength: 5, life: 1 }), owner: P2, zone: "play" }] });
  const top2 = kept.engine.state.players[P1].deck[0];
  cast(kept, kept.id("glass"));
  assert.ok(kept.engine.state.players[P1].hand.includes(top2), "drew even though nothing was voided");
  assert.equal(kept.engine.state.players[P1].deck.length, 5);
});

clause(TORT, "1:rule", "the tactic itself ends up in its owner's discard pile after resolving", () => {
  const g = tortBoard();
  cast(g, g.id("fat"));
  assert.equal(zoneOf(g.engine, g.id("t")), "discard");
});

// RECUR

const recur = (g: TortGame, target?: CardInstanceId, key = "t", player: PlayerId = P1) =>
  activate(g.engine, player, g.id(key), "recur", { selected: target ? { rev: [target] } : {} });
const voidChar = (key: string, owner: PlayerId, over: Partial<{ strength: number; life: number }> = {}): CardPlacement => ({
  key,
  def: character({ name: key, ...over }),
  owner,
  zone: "void"
});

clause(TORT, "2:ability:recur", "from my discard pile: pay 2, remove it from the game, put the picked void character on top of its owner's deck", () => {
  const g = tortBoard({ zone: "discard", o: 1, rage: 1, extra: [voidChar("vp", P2)] });
  const deckBefore = [...g.engine.state.players[P2].deck];
  recur(g, g.id("vp"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("t")), "removed", "Remove this card from the game");
  assert.equal(readyResources(g.engine, P1), 0, "Pay 2");
  assert.equal(zoneOf(g.engine, g.id("vp")), "deck");
  assert.deepEqual(g.engine.state.players[P2].deck, [g.id("vp"), ...deckBefore], "on top of ITS OWNER's deck (the opponent's)");
});

clause(TORT, "2:ability:recur", "my own void character goes on top of my deck; the opponent's deck is untouched", () => {
  const g = tortBoard({ zone: "discard", extra: [voidChar("vm", P1)] });
  const mine = [...g.engine.state.players[P1].deck];
  const theirs = [...g.engine.state.players[P2].deck];
  recur(g, g.id("vm"));
  assert.deepEqual(g.engine.state.players[P1].deck, [g.id("vm"), ...mine]);
  assert.deepEqual(g.engine.state.players[P2].deck, theirs);
});

clause(TORT, "2:ability:recur", "the cost is paid when it is used: it is already out of the game and the resources spent while it waits to resolve", () => {
  const g = tortBoard({ zone: "discard", extra: [voidChar("vp", P2)] });
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("t"), abilityId: "recur", selected: { rev: [g.id("vp")] }, variables: {} } as never);
  assert.equal(zoneOf(g.engine, g.id("t")), "removed");
  assert.equal(readyResources(g.engine, P1), 1, "3 ready - 2");
  assert.equal(zoneOf(g.engine, g.id("vp")), "void", "the effect has not resolved yet");
});

clause(TORT, "2:ability:recur", "'Pick a character in the void': a character not in the void (in play, discard, hand), or a non-character in the void, is refused", () => {
  const g = tortBoard({
    zone: "discard",
    extra: [
      { key: "dch", def: character({ name: "DiscardChar" }), owner: P2, zone: "discard" },
      { key: "hch", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      { key: "vit", def: item({ name: "VoidItem" }), owner: P2, zone: "void" },
      voidChar("vp", P2)
    ]
  });
  for (const key of ["fat", "mine", "dch", "hch", "vit"]) {
    refused(() => recur(g, g.id(key)), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("t")), "discard", `${key}: not removed from the game`);
    assert.equal(readyResources(g.engine, P1), 3, `${key}: nothing paid`);
  }
  refused(() => recur(g), "no pick at all");
  recur(g, g.id("vp"));
  assert.equal(zoneOf(g.engine, g.id("vp")), "deck", "control: a void character works");
});

clause(TORT, "2:ability:recur", "any void character can be picked, whoever owns it, and a different one than the first void card too", () => {
  const g = tortBoard({ zone: "discard", extra: [voidChar("a", P1), voidChar("b", P2)] });
  recur(g, g.id("b"));
  assert.equal(zoneOf(g.engine, g.id("b")), "deck");
  assert.equal(zoneOf(g.engine, g.id("a")), "void", "only the picked one moved");
});

clause(TORT, "2:ability:recur", "use this only if it is in your discard pile: refused from my hand and from play, nothing paid", () => {
  const inHand = tortBoard({ zone: "hand", extra: [voidChar("vp", P2)] });
  refused(() => recur(inHand, inHand.id("vp")), "in hand", /not found|discard/i);
  assert.equal(readyResources(inHand.engine, P1), 3);
  assert.equal(zoneOf(inHand.engine, inHand.id("t")), "hand");
  const inPlay = tortBoard({ zone: "play", extra: [voidChar("vp", P2)] });
  refused(() => recur(inPlay, inPlay.id("vp")), "in play", /not found|discard/i);
  assert.equal(readyResources(inPlay.engine, P1), 3);
  const ok = tortBoard({ zone: "discard", extra: [voidChar("vp", P2)] });
  recur(ok, ok.id("vp"));
  assert.equal(zoneOf(ok.engine, ok.id("vp")), "deck", "control: from the discard pile it works");
});

clause(TORT, "2:ability:recur", "'your discard pile': a copy in the opponent's discard pile cannot be recurred by me", () => {
  const g = tortBoard({
    zone: "discard",
    extra: [{ key: "theirs", def: printing(TORT), owner: P2, zone: "discard" }, voidChar("vp", P2)]
  });
  refused(() => recur(g, g.id("vp"), "theirs"), "the opponent's copy", /not found|discard|own|control/i);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  assert.equal(readyResources(g.engine, P1), 3);
  assert.equal(zoneOf(g.engine, g.id("vp")), "void");
});

clause(TORT, "2:ability:recur", "needs [O]: three ready resources with no [O] anywhere are refused; a SPENT [O] counts toward the threshold", () => {
  const none = tortBoard({ zone: "discard", o: 0, rage: 3, extra: [voidChar("vp", P2)] });
  refused(() => recur(none, none.id("vp")), "no [O]");
  assert.equal(zoneOf(none.engine, none.id("t")), "discard");
  assert.equal(readyResources(none.engine, P1), 3);
  const spentIcon = tortBoard({ zone: "discard", o: 0, rage: 2, spentO: 1, extra: [voidChar("vp", P2)] });
  recur(spentIcon, spentIcon.id("vp"));
  assert.equal(zoneOf(spentIcon.engine, spentIcon.id("vp")), "deck", "[O] is on the board (spent) and 2 ready resources pay");
  assert.equal(readyResources(spentIcon.engine, P1), 0);
});

clause(TORT, "2:ability:recur", "Pay 2: with only 1 ready resource ([O] present) it is refused and nothing is removed; exactly 2 is enough", () => {
  const one = tortBoard({ zone: "discard", o: 1, rage: 0, extra: [voidChar("vp", P2)] });
  refused(() => recur(one, one.id("vp")), "one ready resource");
  assert.equal(zoneOf(one.engine, one.id("t")), "discard", "not removed from the game");
  assert.equal(readyResources(one.engine, P1), 1);
  const two = tortBoard({ zone: "discard", o: 1, rage: 1, extra: [voidChar("vp", P2)] });
  recur(two, two.id("vp"));
  assert.equal(zoneOf(two.engine, two.id("t")), "removed");
  assert.equal(readyResources(two.engine, P1), 0, "exactly 2 paid");
  const spare = tortBoard({ zone: "discard", o: 1, rage: 4, extra: [voidChar("vp", P2)] });
  recur(spare, spare.id("vp"));
  assert.equal(readyResources(spare.engine, P1), 3, "5 ready - 2");
});

clause(TORT, "2:ability:recur", "removed from the game, it cannot be used a second time", () => {
  const g = tortBoard({ zone: "discard", o: 1, rage: 3, extra: [voidChar("a", P2), voidChar("b", P2)] });
  recur(g, g.id("a"));
  const ready = readyResources(g.engine, P1);
  refused(() => recur(g, g.id("b")), "already removed from the game", /not found|discard|removed/i);
  assert.equal(readyResources(g.engine, P1), ready);
  assert.equal(zoneOf(g.engine, g.id("b")), "void");
});

// =====================================================================================
// Witty Worm — character (monstrosity), arcanist, cost 4, [O][O], 2 strength / 3 speed / 2 life.
// While this card is in your hand you may reveal this card as you are playing a resource. If you do,
// you may deploy this card for 1.
// When this card enters play, you may put a resource you control into its owner's hand. If you do,
// you may play a resource.
// =====================================================================================

const WORM = "81fc1a08-8f87-4ae8-9c5a-ce904b9e0847";

function wormBoard(
  o: { worm?: "hand" | "discard" | "play"; o?: number; rage?: number; spentO?: number; extra?: CardPlacement[]; hand?: boolean; active?: PlayerId } = {}
) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: () => 0.5,
    cards: [
      { key: "w", def: printing(WORM), owner: P1, zone: o.worm ?? "hand" },
      ...(o.hand === false
        ? []
        : [
            { key: "hres", def: greedCard("Hand Greed"), owner: P1, zone: "hand" as const },
            { key: "hchar", def: character({ name: "Hand Char" }), owner: P1, zone: "hand" as const }
          ]),
      { key: "ohres", def: greedCard("Their Hand Greed"), owner: P2, zone: "hand" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("obsession", o.o ?? 2, P1),
      ...bank("rage", o.rage ?? 2, P1),
      ...spent("obsession", o.spentO ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type WormGame = ReturnType<typeof wormBoard>;
/**
 * Plays my resource card `key` through the Develop Rule and reports whether the Worm's reveal was offered as it is played
 * (a `resourceReveal` prompt, left open when it was); otherwise the resource has simply entered play.
 */
const wormOffered = (g: WormGame, key = "hres", faceDown = false): boolean =>
  holdResourceFace(() => {
    openDevelopPlay(g.engine, P1);
    if (g.engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [g.id(key)], faceDown } } as never);
    }
    if (g.engine.state.pendingChoice?.kind === "playResource") {
      g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "playResource", faceDown } } as never);
    }
    return g.engine.state.pendingChoice?.kind === "resourceReveal";
  });
/** Plays a resource through the Develop Rule and reveals the Worm `key` for it; throws when the reveal is not offered. */
const revealWorm = (g: WormGame, key = "w") => {
  if (!wormOffered(g)) throw new Error("the Worm's reveal was not offered");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "resourceReveal", cardId: g.id(key) } } as never);
  resolvePendingResponses(g.engine);
};
const myResources = (g: WormGame): CardInstanceId[] =>
  g.engine.state.players[P1].play.filter((c) => g.engine.isResource(c) && !g.engine.state.cards[c].faceDown);
const deployWorm = (g: WormGame) => play(g.engine, P1, g.id("w"));

clause(WORM, "0:rule", "printed as a 2/3/2 arcanist monstrosity; deploys normally for 4 with [O][O] (4 resources, 2 of them [O])", () => {
  const def = printing(WORM);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "arcanist");
  assert.deepEqual(def.subtype, ["monstrosity"]);
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "oo");
  const ok = wormBoard({ o: 2, rage: 2, hand: false });
  deployWorm(ok);
  assert.equal(zoneOf(ok.engine, ok.id("w")), "play");
  assert.deepEqual(
    [ok.engine.getStat(ok.id("w"), "strength"), ok.engine.getStat(ok.id("w"), "speed"), ok.engine.getStat(ok.id("w"), "life")],
    [2, 3, 2]
  );
  const costShort = wormBoard({ o: 1, rage: 2, spentO: 1, hand: false });
  refused(() => playRaw(costShort.engine, P1, costShort.id("w")), "3 ready resources for a cost of 4 (threshold met by a spent [O])", /Costs cannot be paid/);
  assert.equal(zoneOf(costShort.engine, costShort.id("w")), "hand");
  const iconShort = wormBoard({ o: 1, rage: 3, hand: false });
  refused(() => playRaw(iconShort.engine, P1, iconShort.id("w")), "four resources but only one [O]");
  assert.equal(zoneOf(iconShort.engine, iconShort.id("w")), "hand");
});

clause(WORM, "0:rule", "reveal while playing a resource: the Worm is deployed for 1, not 4 (it enters play and exactly 1 resource is spent)", () => {
  const g = wormBoard({ o: 2, rage: 1 });
  const before = readyResources(g.engine, P1);
  revealWorm(g);
  if (pending(g.engine)) pick(g.engine, []); // its own enters-play pick, declined
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(controllerOf(g.engine, g.id("w")), P1);
  assert.equal(faceDownOf(g.engine, g.id("w")), false);
  assert.equal(before + 1 - readyResources(g.engine, P1), 1, "pays 1 (the resource I played is a ready +1)");
});

clause(WORM, "0:rule", "'for 1' keeps the printed threshold [O][O]: one [O] among many resources is refused, a SPENT second [O] plus 1 ready resource works", () => {
  const one = wormBoard({ o: 1, rage: 5 });
  assert.equal(wormOffered(one), false, "one [O]: the reveal is not offered");
  assert.equal(zoneOf(one.engine, one.id("w")), "hand");
  assert.equal(readyResources(one.engine, P1), 7, "nothing was paid for the Worm (the 6 plus the resource I played)");
  const none = wormBoard({ o: 0, rage: 6 });
  assert.equal(wormOffered(none), false, "no [O]: the reveal is not offered");
  const two = wormBoard({ o: 0, rage: 1, spentO: 2 });
  revealWorm(two);
  if (pending(two.engine)) pick(two.engine, []);
  assert.equal(zoneOf(two.engine, two.id("w")), "play", "two spent [O] + 1 ready resource for the 1");
  assert.equal(readyResources(two.engine, P1), 1, "the 1 was paid; the resource I played is the one ready resource");
});

clause(WORM, "0:rule", "the 1 must be payable: with every resource spent the reveal is refused", () => {
  const g = wormBoard({ o: 0, rage: 0, spentO: 2 });
  assert.equal(readyResources(g.engine, P1), 0);
  assert.equal(wormOffered(g), false, "nothing to pay the 1 with: the reveal is not offered");
  assert.equal(zoneOf(g.engine, g.id("w")), "hand");
});

clause(WORM, "0:rule", "the card is REVEALED to everyone when used this way, and a plain deploy from hand reveals nothing", () => {
  const revealed = (g: WormGame) =>
    g.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").map((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);
  const g = wormBoard({ o: 2, rage: 1 });
  revealWorm(g);
  assert.deepEqual(revealed(g), [[g.id("w")]]);
  const plain = wormBoard({ o: 2, rage: 2 });
  deployWorm(plain);
  assert.deepEqual(revealed(plain), []);
});

clause(WORM, "0:rule", "the reveal does not cheapen the normal deploy: playing it from hand the usual way still costs 4", () => {
  const g = wormBoard({ o: 2, rage: 3 });
  const before = readyResources(g.engine, P1);
  deployWorm(g);
  assert.equal(before - readyResources(g.engine, P1), 4);
  const short = wormBoard({ o: 2, rage: 1 });
  refused(() => playRaw(short.engine, P1, short.id("w")), "3 resources for a cost of 4");
});

clause(WORM, "0:rule", "'While this card is in your hand': from play or from my discard pile the reveal is refused", () => {
  const inPlay = wormBoard({ worm: "play" });
  assert.equal(wormOffered(inPlay), false, "already in play: the reveal is not offered");
  assert.equal(readyResources(inPlay.engine, P1), 5, "(the resource I played is the only change)");
  const inDiscard = wormBoard({ worm: "discard" });
  assert.equal(wormOffered(inDiscard), false, "in the discard pile: the reveal is not offered");
  assert.equal(zoneOf(inDiscard.engine, inDiscard.id("w")), "discard");
  assert.equal(readyResources(inDiscard.engine, P1), 5, "(the resource I played is the only change)");
});

clause(WORM, "0:rule", "'your hand': a Worm in the opponent's hand cannot be revealed by me", () => {
  const g = wormBoard({ extra: [{ key: "theirs", def: printing(WORM), owner: P2, zone: "hand" }] });
  assert.equal(wormOffered(g), true, "my own Worm is offered");
  assert.equal((pending(g.engine)!.candidates as string[]).includes(g.id("theirs")), false, "the opponent's Worm is not a candidate");
  refused(() => g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "resourceReveal", cardId: g.id("theirs") } } as never), "the opponent's Worm");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "hand");
  assert.equal(readyResources(g.engine, P1), 4);
});

clause(WORM, "0:rule", "it happens as I play a resource: it uses my Develop Rule for the turn, so a second develop (reveal or ordinary resource play) is refused", () => {
  const g = wormBoard({ o: 2, rage: 2, extra: [{ key: "w2", def: printing(WORM), owner: P1, zone: "hand" }] });
  revealWorm(g);
  drain(g.engine, declineAll); // the second Worm's offer for the same resource play, and the first one's enters-play pick
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(pending(g.engine), undefined, "the Develop Rule is spent: neither a second reveal nor an ordinary resource play is offered");
  assert.equal(zoneOf(g.engine, g.id("w2")), "hand");
});

clause(WORM, "0:rule", "not revealing: playing a resource normally leaves the Worm in my hand (the reveal is optional)", () => {
  const g = wormBoard();
  assert.equal(wormOffered(g), true, "the reveal is offered");
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "resourceReveal" } } as never); // not revealing
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
  assert.equal(zoneOf(g.engine, g.id("w")), "hand");
});

clause(WORM, "0:rule", "'as you are playing a resource': the resource is played as well -- I reveal the Worm, deploy it for 1 AND the resource I chose enters play", () => {
  const g = wormBoard({ o: 2, rage: 1 });
  revealWorm(g);
  if (pending(g.engine)) pick(g.engine, []);
  assert.equal(zoneOf(g.engine, g.id("w")), "play", "the Worm was deployed for 1");
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "...and the resource I was playing entered play too");
});

clause(WORM, "0:rule", "the reveal is available whenever I play a resource, e.g. during its own 'you may play a resource' step, not only through the Develop Rule", () => {
  const g = wormBoard({
    o: 3,
    rage: 3,
    extra: [{ key: "w2", def: printing(WORM), owner: P1, zone: "hand" }]
  });
  deployWorm(g);
  pick(g.engine, [myResources(g)[0]]); // put a resource into hand
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "now playing a resource");
  pick(g.engine, [g.id("hres")]); // ...and choose the card to play as a resource
  // CR 605.1c: "while you play a resource" happens after the card is chosen and before it enters play
  const offer = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] } | undefined;
  assert.ok(offer, "the resource-play step must offer revealing the second Worm for 1");
  assert.equal(offer.kind, "resourceReveal");
  assert.equal(offer.playerId, P1);
  assert.deepEqual(offer.candidates, [g.id("w2")]);
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand", "the resource has not entered play yet");
  const readyBefore = readyResources(g.engine, P1);
  answerPending(g.engine, "resourceReveal", { cardId: g.id("w2") });
  if (pending(g.engine)) pick(g.engine, []); // the second Worm's own enters-play prompt: decline
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("w2")), "play", "the second Worm was deployed");
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "...and the resource I was playing enters play as well");
  assert.equal(readyResources(g.engine, P1), readyBefore, "the second Worm cost 1 and the resource is a ready 1");
});

clause(WORM, "0:rule", "the reveal during an effect's resource play is optional: declining plays the resource and keeps the second Worm in hand", () => {
  const g = wormBoard({
    o: 3,
    rage: 3,
    extra: [{ key: "w2", def: printing(WORM), owner: P1, zone: "hand" }]
  });
  deployWorm(g);
  pick(g.engine, [myResources(g)[0]]);
  pick(g.engine, [g.id("hres")]);
  assert.equal(pending(g.engine)?.kind, "resourceReveal");
  answerPending(g.engine, "resourceReveal", {});
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("w2")), "hand");
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
});

clause(WORM, "1:rule", "when it enters play I may put a resource I control into its owner's hand, then I may play a resource (here the one I just returned)", () => {
  const g = wormBoard();
  deployWorm(g);
  const first = pending(g.engine);
  assert.equal(first?.kind, "chooserSelectsTarget");
  assert.equal(first?.playerId, P1);
  const [r0] = myResources(g);
  pick(g.engine, [r0]);
  assert.equal(zoneOf(g.engine, r0), "hand", "back in its owner's hand");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "now the resource play");
  pick(g.engine, [r0]);
  assert.equal(zoneOf(g.engine, r0), "play", "played again");
  assert.equal(pending(g.engine), undefined);
});

clause(WORM, "1:rule", "'put a resource you control' is ONE resource: picking two is refused, one is fine", () => {
  const g = wormBoard();
  deployWorm(g);
  const [r0, r1] = myResources(g);
  assert.ok(r0 && r1, "setup: at least two resources I control");
  refused(() => pick(g.engine, [r0, r1]), "two resources picked for a single return");
  assert.equal(zoneOf(g.engine, r0), "play", "the refused pick returned nothing");
  assert.equal(zoneOf(g.engine, r1), "play", "the refused pick returned nothing");
  pick(g.engine, [r0]);
  assert.equal(zoneOf(g.engine, r0), "hand", "control: one resource returned");
  assert.equal(zoneOf(g.engine, r1), "play", "the other resource stays");
});

clause(WORM, "1:rule", "'you may play a resource' is mine to answer and is ONE resource: the controller is asked, and two hand cards are refused", () => {
  const g = wormBoard();
  deployWorm(g);
  pick(g.engine, [myResources(g)[0]]);
  const second = pending(g.engine);
  assert.equal(second?.kind, "chooserSelectsTarget");
  assert.equal(second?.playerId, P1, "I (the Worm's controller) choose the resource to play");
  refused(() => pick(g.engine, [g.id("hres"), g.id("hchar")]), "two cards picked for a single resource play");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand", "nothing was played by the refused pick");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "hand", "nothing was played by the refused pick");
  pick(g.engine, [g.id("hres")]);
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "control: one resource is played");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "hand", "the other hand card stays");
});

clause(WORM, "1:rule", "'you may put': declining the first pick does nothing and offers no resource play", () => {
  const g = wormBoard();
  const resources = g.engine.state.players[P1].play.filter((c) => g.engine.isResource(c));
  deployWorm(g);
  pick(g.engine, []);
  assert.equal(pending(g.engine), undefined, "no 'If you do' step");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
  assert.equal(zoneOf(g.engine, g.id("hchar")), "hand");
  for (const r of resources) assert.equal(zoneOf(g.engine, r), "play");
});

clause(WORM, "1:rule", "'If you do, you may play a resource': after returning one I may decline; the returned resource stays in hand", () => {
  const g = wormBoard();
  deployWorm(g);
  const [r0] = myResources(g);
  pick(g.engine, [r0]);
  pick(g.engine, []);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, r0), "hand");
  assert.equal(zoneOf(g.engine, g.id("hres")), "hand");
});

clause(WORM, "1:rule", "the resource played afterwards can be a different hand card: an actual resource card goes in face-up, a non-resource face-down", () => {
  const g = wormBoard();
  deployWorm(g);
  pick(g.engine, [myResources(g)[0]]);
  pick(g.engine, [g.id("hres")]);
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
  assert.equal(faceDownOf(g.engine, g.id("hres")), false);
  const h = wormBoard();
  deployWorm(h);
  pick(h.engine, [myResources(h)[0]]);
  pick(h.engine, [h.id("hchar")]);
  assert.equal(zoneOf(h.engine, h.id("hchar")), "play");
  assert.equal(faceDownOf(h.engine, h.id("hchar")), true);
});

clause(WORM, "1:rule", "'play a resource' lets me choose face-up or face-down for an actual resource card (CR 203.2, 605.1b)", () => holdResourceFace(() => {
  const g = wormBoard();
  deployWorm(g);
  pick(g.engine, [myResources(g)[0]]);
  pick(g.engine, [g.id("hres")]);
  const asked = pending(g.engine) !== undefined && zoneOf(g.engine, g.id("hres")) === "hand";
  const down = zoneOf(g.engine, g.id("hres")) === "play" && faceDownOf(g.engine, g.id("hres"));
  assert.ok(asked || down, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
}));

clause(WORM, "1:rule", "returning and replaying a SPENT resource un-spends it: the replayed card is a fresh, ready resource", () => {
  const g = wormBoard({ o: 2, rage: 2, spentO: 1 });
  deployWorm(g); // 4 ready pay the cost; the spent [O] stays attached
  const spentOne = g.engine.state.players[P1].play.find((c) => g.engine.isResource(c) && g.engine.state.cards[c].attachedTo !== undefined);
  assert.ok(spentOne, "control: some resource is attached (spent)");
  const before = readyResources(g.engine, P1);
  pick(g.engine, [spentOne!]);
  assert.equal(g.engine.state.cards[spentOne!].attachedTo, undefined);
  pick(g.engine, [spentOne!]);
  assert.equal(readyResources(g.engine, P1), before + 1, "the replayed resource is ready");
});

clause(WORM, "1:rule", "'a resource you control': my opponent's resources, my characters and cards in hand are refused", () => {
  const g = wormBoard({ extra: [{ ...bank("rage", 1, P2)[0], key: "theirRes" }] });
  deployWorm(g);
  refused(() => pick(g.engine, [g.id("theirRes")]), "the opponent's resource");
  refused(() => pick(g.engine, [g.id("ally")]), "my character");
  refused(() => pick(g.engine, [g.id("hres")]), "a card in my hand");
  refused(() => pick(g.engine, [g.id("w")]), "the Worm itself (not a resource)");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pick(g.engine, [myResources(g)[0]]);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "control: a resource I control works");
});

clause(WORM, "1:rule", "a resource I control but my opponent owns goes to ITS OWNER's hand, and I may still play a resource from mine", () => {
  const g = wormBoard({ extra: [{ ...bank("rage", 1, P2)[0], key: "stolen", controller: P1 }] });
  deployWorm(g);
  pick(g.engine, [g.id("stolen")]);
  assert.equal(zoneOf(g.engine, g.id("stolen")), "hand");
  assert.ok(g.engine.state.players[P2].hand.includes(g.id("stolen")), "in the opponent's hand");
  assert.ok(!g.engine.state.players[P1].hand.includes(g.id("stolen")), "!g.engine.state.players[P1].hand.includes(g.id(\"stolen\"))");
  pick(g.engine, [g.id("hres")]);
  assert.equal(zoneOf(g.engine, g.id("hres")), "play", "I play from MY hand");
});

clause(WORM, "1:rule", "the second step takes my hand only: the opponent's hand card is refused", () => {
  const g = wormBoard();
  deployWorm(g);
  pick(g.engine, [myResources(g)[0]]);
  refused(() => pick(g.engine, [g.id("ohres")]), "the opponent's hand card");
  assert.equal(zoneOf(g.engine, g.id("ohres")), "hand");
  pick(g.engine, [g.id("hres")]);
  assert.equal(zoneOf(g.engine, g.id("hres")), "play");
});

const putter = () =>
  tactic({
    name: "Put Into Play",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pip",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  } as never);

clause(WORM, "1:rule", "with no resource I control there is nothing to return: no prompt, no second step (Worm put into play by an effect)", () => {
  const h = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "w", def: printing(WORM), owner: P1, zone: "hand" },
      { key: "pip", def: putter(), owner: P1, zone: "hand" },
      { key: "hres", def: greedCard("Hand Greed"), owner: P1, zone: "hand" }
    ]
  });
  play(h.engine, P1, h.id("pip"), { selected: { t: [h.id("w")] } });
  assert.equal(zoneOf(h.engine, h.id("w")), "play");
  assert.equal(pending(h.engine), undefined, "nothing to return, so no prompt");
  assert.equal(zoneOf(h.engine, h.id("hres")), "hand");
});

clause(WORM, "1:rule", "it triggers however the Worm enters play: put into play by an effect (not deployed) also asks its controller", () => {
  const g = wormBoard({ extra: [{ key: "pip", def: putter(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("pip"), { selected: { t: [g.id("w")] } });
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(g.engine)?.playerId, P1);
  pick(g.engine, []);
});

clause(WORM, "1:rule", "it triggers when it enters via the reveal route too, and only for the Worm itself: another character entering does not", () => {
  const g = wormBoard({ o: 2, rage: 1 });
  revealWorm(g);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "entering via the reveal route also asks");
  assert.equal(pending(g.engine)?.playerId, P1);
  pick(g.engine, []);
  const other = wormBoard({ worm: "play", extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  play(other.engine, P1, other.id("newbie"));
  assert.equal(zoneOf(other.engine, other.id("newbie")), "play");
  assert.equal(pending(other.engine), undefined, "the Worm already in play does not trigger on another card");
});

clause(WORM, "1:rule", "a Worm that is not in play does nothing: another character entering while it sits in my hand or discard pile asks nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = wormBoard({ worm: zone, extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
    play(g.engine, P1, g.id("newbie"));
    assert.equal(zoneOf(g.engine, g.id("newbie")), "play");
    assert.equal(pending(g.engine), undefined, `Worm in ${zone}`);
  }
});

// =====================================================================================
// Alluring Quicksand — tactic, banker, cost 4, [G][G].
// EXTRA COST: Pick a character.
// Flip the character face-down under its owner's control.
// RECUR: [G][G][G][G] -- COST: Use this only if this card is in your discard pile. Pay 2. Remove this
// card from the game. Pick a character. -- EFFECT: Flip the character face-down under its owner's control.
// =====================================================================================

const SAND = "febc8b98-76fb-4bcf-a0d5-6ea2053e63d1";

function sandBoard(o: { g?: number; rage?: number; spentG?: number; zone?: "hand" | "discard" | "play"; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "q", def: printing(SAND), owner: P1, zone: o.zone ?? "hand" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "gadget", def: item({ name: "Gadget" }), owner: P2, zone: "play" },
      ...fillers("d", 4, P1, "deck"),
      ...bank("greed", o.g ?? 2, P1),
      ...bank("rage", o.rage ?? 2, P1),
      ...spent("greed", o.spentG ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type SandGame = ReturnType<typeof sandBoard>;
const castQ = (g: SandGame, target?: CardInstanceId) => play(g.engine, P1, g.id("q"), { selected: target ? { t: [target] } : {} });

clause(SAND, "0:extraCost", "printed as a banker tactic; deploys for 4 with [G][G] (4 ready + 2 spent icons isolates the cost); 3 ready, or no [G][G], is refused", () => {
  const def = printing(SAND);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "banker");
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "gg");
  const ok = sandBoard({ g: 2, rage: 2 });
  castQ(ok, ok.id("theirs"));
  assert.equal(zoneOf(ok.engine, ok.id("q")), "discard");
  assert.equal(readyResources(ok.engine, P1), 0, "4 paid");
  const costShort = sandBoard({ g: 0, rage: 3, spentG: 2 });
  refused(() => playRaw(costShort.engine, P1, costShort.id("q"), { selected: { t: [costShort.id("theirs")] } }), "3 ready for a cost of 4 (threshold met by spent [G][G])");
  assert.equal(zoneOf(costShort.engine, costShort.id("q")), "hand");
  const costOk = sandBoard({ g: 0, rage: 4, spentG: 2 });
  castQ(costOk, costOk.id("theirs"));
  assert.equal(zoneOf(costOk.engine, costOk.id("q")), "discard", "control: 4 ready + spent [G][G]");
  const iconShort = sandBoard({ g: 1, rage: 3 });
  refused(() => playRaw(iconShort.engine, P1, iconShort.id("q"), { selected: { t: [iconShort.id("theirs")] } }), "four resources but one [G]");
  assert.equal(zoneOf(iconShort.engine, iconShort.id("q")), "hand");
});

clause(SAND, "0:extraCost", "the pick is part of deploying it: no character picked is refused with nothing paid", () => {
  const g = sandBoard();
  refused(() => playRaw(g.engine, P1, g.id("q")), "no pick");
  assert.equal(zoneOf(g.engine, g.id("q")), "hand");
  assert.equal(readyResources(g.engine, P1), 4);
  castQ(g, g.id("theirs"));
  assert.equal(zoneOf(g.engine, g.id("q")), "discard", "control");
});

clause(SAND, "0:extraCost", "any character in play can be picked (mine or theirs); an item, a hand/discard/deck character, or two characters are refused", () => {
  const mine = sandBoard();
  castQ(mine, mine.id("mine"));
  assert.equal(zoneOf(mine.engine, mine.id("q")), "discard", "my own character");
  const g = sandBoard({
    extra: [
      { key: "hc", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      { key: "dc", def: character({ name: "DiscChar" }), owner: P2, zone: "discard" },
      { key: "kc", def: character({ name: "DeckChar" }), owner: P2, zone: "deck" }
    ]
  });
  for (const key of ["gadget", "hc", "dc", "kc"]) {
    refused(() => playRaw(g.engine, P1, g.id("q"), { selected: { t: [g.id(key)] } }), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("q")), "hand");
  }
  refused(() => playRaw(g.engine, P1, g.id("q"), { selected: { t: [g.id("theirs"), g.id("mine")] } }), "two characters");
  assert.equal(readyResources(g.engine, P1), 4, "nothing paid by refusals");
});

clause(SAND, "1:rule", "the picked character is flipped face-down (their character stays under their control)", () => {
  const g = sandBoard();
  castQ(g, g.id("theirs"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play", "still in play, as a face-down card");
  assert.equal(faceDownOf(g.engine, g.id("theirs")), true);
  assert.equal(controllerOf(g.engine, g.id("theirs")), P2);
  assert.equal(faceDownOf(g.engine, g.id("mine")), false, "the other character is untouched");
});

clause(SAND, "1:rule", "my own character flipped face-down stays under my control", () => {
  const g = sandBoard();
  castQ(g, g.id("mine"));
  assert.equal(faceDownOf(g.engine, g.id("mine")), true);
  assert.equal(controllerOf(g.engine, g.id("mine")), P1);
  assert.equal(faceDownOf(g.engine, g.id("theirs")), false);
});

clause(SAND, "1:rule", "'under its OWNER's control': a character I control but the opponent owns goes back to the opponent, face-down", () => {
  const g = sandBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  assert.equal(controllerOf(g.engine, g.id("stolen")), P1);
  castQ(g, g.id("stolen"));
  assert.equal(faceDownOf(g.engine, g.id("stolen")), true);
  assert.equal(controllerOf(g.engine, g.id("stolen")), P2, "returned to its owner");
});

clause(SAND, "1:rule", "'under its owner's control' works the other way too: my character the opponent controls comes back to me, face-down", () => {
  const g = sandBoard({ extra: [{ key: "lost", def: character({ name: "Lost" }), owner: P1, zone: "play", controller: P2 }] });
  castQ(g, g.id("lost"));
  assert.equal(faceDownOf(g.engine, g.id("lost")), true);
  assert.equal(controllerOf(g.engine, g.id("lost")), P1);
});

clause(SAND, "1:rule", "a face-down character is no longer a character: it can't be picked as a character again", () => {
  const g = sandBoard({ extra: [{ key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }] });
  refused(() => playRaw(g.engine, P1, g.id("q"), { selected: { t: [g.id("fd")] } }), "an already face-down character");
  assert.equal(zoneOf(g.engine, g.id("q")), "hand");
  castQ(g, g.id("theirs"));
  assert.equal(faceDownOf(g.engine, g.id("theirs")), true, "control");
});

clause(SAND, "1:rule", "a damaged / depleted character is flipped too, and loses its damage and depletion (it left the character state)", () => {
  const g = sandBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 5 }), owner: P2, zone: "play", damage: 2 }] });
  castQ(g, g.id("hurt"));
  assert.equal(faceDownOf(g.engine, g.id("hurt")), true);
  assert.equal(zoneOf(g.engine, g.id("hurt")), "play", "flipping is not destroying");
});

clause(SAND, "2:ability:quicksand-recur", "from my discard pile: pay 2, remove it from the game, flip the picked character face-down under its owner's control", () => {
  const g = sandBoard({ zone: "discard", g: 4, rage: 0, extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }] });
  // 4 [G] ready: pay 2 leaves 2
  activate(g.engine, P1, g.id("q"), "quicksand-recur", { selected: { rt: [g.id("stolen")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("q")), "removed", "Remove this card from the game");
  assert.equal(readyResources(g.engine, P1), 2, "Pay 2");
  assert.equal(faceDownOf(g.engine, g.id("stolen")), true);
  assert.equal(controllerOf(g.engine, g.id("stolen")), P2, "under its owner's control");
});

clause(SAND, "2:ability:quicksand-recur", "it can pick my own character (stays mine) and my character they control (back to me), and nothing else is flipped", () => {
  const g = sandBoard({ zone: "discard", g: 4, rage: 0 });
  activate(g.engine, P1, g.id("q"), "quicksand-recur", { selected: { rt: [g.id("mine")] } });
  assert.equal(faceDownOf(g.engine, g.id("mine")), true);
  assert.equal(controllerOf(g.engine, g.id("mine")), P1);
  assert.equal(faceDownOf(g.engine, g.id("theirs")), false);
  const h = sandBoard({ zone: "discard", g: 4, rage: 0, extra: [{ key: "lost", def: character({ name: "Lost" }), owner: P1, zone: "play", controller: P2 }] });
  activate(h.engine, P1, h.id("q"), "quicksand-recur", { selected: { rt: [h.id("lost")] } });
  assert.equal(controllerOf(h.engine, h.id("lost")), P1);
  assert.equal(faceDownOf(h.engine, h.id("lost")), true);
});

clause(SAND, "2:ability:quicksand-recur", "'Pick a character': an item, a hand/discard character, an already face-down character, no pick, or two picks are refused with nothing paid or removed", () => {
  const g = sandBoard({
    zone: "discard",
    g: 4,
    rage: 0,
    extra: [
      { key: "hc", def: character({ name: "HandChar" }), owner: P2, zone: "hand" },
      { key: "dc", def: character({ name: "DiscChar" }), owner: P2, zone: "discard" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }
    ]
  });
  for (const key of ["gadget", "hc", "dc", "fd"]) {
    refused(() => activate(g.engine, P1, g.id("q"), "quicksand-recur", { selected: { rt: [g.id(key)] } }), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("q")), "discard", `${key}: not removed`);
    assert.equal(readyResources(g.engine, P1), 4, `${key}: nothing paid`);
  }
  refused(() => activate(g.engine, P1, g.id("q"), "quicksand-recur", { selected: {} }), "no pick");
  refused(() => activate(g.engine, P1, g.id("q"), "quicksand-recur", { selected: { rt: [g.id("theirs"), g.id("mine")] } }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("q")), "discard");
  assert.equal(readyResources(g.engine, P1), 4);
});

clause(SAND, "2:ability:quicksand-recur", "use this only if it is in your discard pile: refused from hand and play, nothing paid", () => {
  for (const zone of ["hand", "play"] as const) {
    const g = sandBoard({ zone, g: 4, rage: 0 });
    refused(() => activate(g.engine, P1, g.id("q"), "quicksand-recur", { selected: { rt: [g.id("theirs")] } }), `in ${zone}`, /not found|discard/i);
    assert.equal(readyResources(g.engine, P1), 4);
    assert.equal(faceDownOf(g.engine, g.id("theirs")), false);
  }
  const ok = sandBoard({ zone: "discard", g: 4, rage: 0 });
  activate(ok.engine, P1, ok.id("q"), "quicksand-recur", { selected: { rt: [ok.id("theirs")] } });
  assert.equal(faceDownOf(ok.engine, ok.id("theirs")), true, "control");
});

clause(SAND, "2:ability:quicksand-recur", "'your discard pile': a copy in the opponent's discard pile cannot be recurred by me", () => {
  const g = sandBoard({ zone: "discard", g: 4, rage: 0, extra: [{ key: "oq", def: printing(SAND), owner: P2, zone: "discard" }] });
  refused(() => activate(g.engine, P1, g.id("oq"), "quicksand-recur", { selected: { rt: [g.id("mine")] } }), "the opponent's copy", /not found|discard|own|control/i);
  assert.equal(zoneOf(g.engine, g.id("oq")), "discard");
  assert.equal(readyResources(g.engine, P1), 4);
});

clause(SAND, "2:ability:quicksand-recur", "needs [G][G][G][G]: three [G] and a rage is refused; four [G] works; SPENT [G] count toward the threshold", () => {
  const three = sandBoard({ zone: "discard", g: 3, rage: 1 });
  refused(() => activate(three.engine, P1, three.id("q"), "quicksand-recur", { selected: { rt: [three.id("theirs")] } }), "only three [G]");
  assert.equal(zoneOf(three.engine, three.id("q")), "discard");
  assert.equal(readyResources(three.engine, P1), 4);
  const spentOk = sandBoard({ zone: "discard", g: 0, rage: 2, spentG: 4 });
  activate(spentOk.engine, P1, spentOk.id("q"), "quicksand-recur", { selected: { rt: [spentOk.id("theirs")] } });
  assert.equal(faceDownOf(spentOk.engine, spentOk.id("theirs")), true, "4 spent [G] + 2 ready resources pay");
  assert.equal(readyResources(spentOk.engine, P1), 0);
});

clause(SAND, "2:ability:quicksand-recur", "Pay 2: with [G][G][G][G] on the board but 1 ready resource it is refused; the removal does not happen", () => {
  const g = sandBoard({ zone: "discard", g: 1, rage: 0, spentG: 3 });
  assert.equal(readyResources(g.engine, P1), 1);
  refused(() => activate(g.engine, P1, g.id("q"), "quicksand-recur", { selected: { rt: [g.id("theirs")] } }), "one ready resource");
  assert.equal(zoneOf(g.engine, g.id("q")), "discard");
  assert.equal(readyResources(g.engine, P1), 1);
  assert.equal(faceDownOf(g.engine, g.id("theirs")), false);
  const two = sandBoard({ zone: "discard", g: 2, rage: 0, spentG: 2 });
  activate(two.engine, P1, two.id("q"), "quicksand-recur", { selected: { rt: [two.id("theirs")] } });
  assert.equal(readyResources(two.engine, P1), 0, "exactly 2 paid");
});

clause(SAND, "2:ability:quicksand-recur", "removed from the game, it cannot be used a second time", () => {
  const g = sandBoard({ zone: "discard", g: 4, rage: 2 });
  activate(g.engine, P1, g.id("q"), "quicksand-recur", { selected: { rt: [g.id("theirs")] } });
  const ready = readyResources(g.engine, P1);
  refused(() => activate(g.engine, P1, g.id("q"), "quicksand-recur", { selected: { rt: [g.id("mine")] } }), "already removed", /not found|discard|removed/i);
  assert.equal(readyResources(g.engine, P1), ready);
  assert.equal(faceDownOf(g.engine, g.id("mine")), false);
});

// =====================================================================================
// Architectural Restitution — tactic, banker, cost 4, [G][G].
// EXTRA COST: Deploy this only while an opponent is attacking you. Pick a location in your discard pile.
// Put the location into play under your control. Change the target of that opponent's attack to the
// location.
// FLIP UP: 2 [G][G]
// =====================================================================================

const AR = "6b38d626-997f-4869-8ee8-8188785a02f4";

function arBoard(
  o: { g?: number; rage?: number; spentG?: number; zone?: "hand" | "facedown"; attack?: boolean | "location"; extra?: CardPlacement[]; active?: PlayerId } = {}
) {
  const active = o.active ?? P2;
  const g = buildGame({
    playerA: { faction: developFaction(), influence: 20 },
    playerB: { faction: developFaction(), influence: 20 },
    turn: active === P1 ? 1 : 2,
    activePlayerId: active,
    random: () => 0.5,
    cards: [
      { key: "ar", def: printing(AR), owner: P1, zone: o.zone === "facedown" ? "play" : "hand", ...(o.zone === "facedown" ? { faceDown: true } : {}) },
      { key: "loc", def: location({ name: "Fallen Hall", structure: 5 }), owner: P1, zone: "discard" },
      { key: "loc2", def: location({ name: "Other Hall", structure: 4 }), owner: P1, zone: "discard" },
      { key: "ploc", def: location({ name: "Their Hall", structure: 5 }), owner: P2, zone: "discard" },
      { key: "dchar", def: character({ name: "Dead Char" }), owner: P1, zone: "discard" },
      { key: "playloc", def: location({ name: "Standing Hall", structure: 5 }), owner: P1, zone: "play" },
      { key: "handloc", def: location({ name: "Hand Hall", structure: 5 }), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5 }), owner: P1, zone: "play", attackEligible: true },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("greed", o.g ?? 2, P1),
      ...bank("rage", o.rage ?? 2, P1),
      ...spent("greed", o.spentG ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
  if (o.attack === true) declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  if (o.attack === "location") declareAttackOpenWindow(g.engine, P2, [g.id("atk")], { type: "card", cardId: g.id("playloc") });
  return g;
}
type ArGame = ReturnType<typeof arBoard>;
const castArRaw = (g: ArGame, loc = "loc") => playRaw(g.engine, P1, g.id("ar"), { selected: { l: [g.id(loc)] } });
const castAr = (g: ArGame, loc = "loc") => {
  castArRaw(g, loc);
  resolvePendingResponses(g.engine);
};
const flipAr = (g: ArGame, loc = "loc") =>
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("ar"), selected: { l: [g.id(loc)] }, variables: {} });

clause(AR, "0:extraCost", "printed as a banker tactic; deploys for 4 with [G][G] (4 ready + 2 spent [G] isolates the cost); 3 ready, or one [G], is refused", () => {
  const def = printing(AR);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "banker");
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "gg");
  const ok = arBoard({ g: 2, rage: 2, attack: true });
  castAr(ok);
  assert.equal(readyResources(ok.engine, P1), 0, "4 paid");
  const costShort = arBoard({ g: 0, rage: 3, spentG: 2, attack: true });
  refused(() => castAr(costShort), "3 ready for a cost of 4 (threshold met by spent [G][G])", /Costs cannot be paid/);
  assert.equal(zoneOf(costShort.engine, costShort.id("ar")), "hand");
  assert.equal(readyResources(costShort.engine, P1), 3);
  const costOk = arBoard({ g: 0, rage: 4, spentG: 2, attack: true });
  castAr(costOk);
  assert.equal(readyResources(costOk.engine, P1), 0, "control: 4 ready + spent [G][G]");
  const iconShort = arBoard({ g: 1, rage: 3, attack: true });
  refused(() => castAr(iconShort), "four resources but one [G]");
  assert.equal(zoneOf(iconShort.engine, iconShort.id("ar")), "hand");
});

clause(AR, "0:extraCost", "'Deploy this only while an opponent is attacking you': with no battle at all it is refused and nothing is paid", () => {
  const none = arBoard({ attack: false, active: P1 });
  refused(() => castAr(none), "no attack", /attack|battle|condition|defend|cannot be (deployed|flipped)/i);
  assert.equal(zoneOf(none.engine, none.id("ar")), "hand");
  assert.equal(readyResources(none.engine, P1), 4);
  assert.equal(zoneOf(none.engine, none.id("loc")), "discard");
  const yes = arBoard({ attack: true });
  castAr(yes);
  assert.equal(readyResources(yes.engine, P1), 0, "control: with an opponent attacking me it works");
});

clause(AR, "0:extraCost", "it must be an OPPONENT attacking ME: when I am the one attacking, it is refused", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    activePlayerId: P1,
    random: () => 0.5,
    cards: [
      { key: "ar", def: printing(AR), owner: P1, zone: "hand" },
      { key: "loc", def: location({ name: "Fallen Hall", structure: 5 }), owner: P1, zone: "discard" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 5 }), owner: P1, zone: "play" },
      ...bank("greed", 4, P1)
    ]
  });
  declareAttackBy(g.engine, P1, [g.id("mine")]);
  assert.ok(battleOf(g.engine), "control: I am attacking");
  refused(() => castAr(g as unknown as ArGame), "I am the attacker, not the one attacked", /attack|battle|condition|defend|cannot be (deployed|flipped)/i);
  assert.equal(zoneOf(g.engine, g.id("ar")), "hand");
  assert.equal(zoneOf(g.engine, g.id("loc")), "discard");
});

clause(AR, "0:extraCost", "'attacking you': an opponent's attack on one of my locations counts as attacking me", () => {
  const g = arBoard({ attack: "location" });
  castAr(g);
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
  assert.equal(zoneOf(g.engine, g.id("ar")), "discard");
});

clause(AR, "0:extraCost", "'Pick a location in your discard pile': no pick, an opponent's discarded location, a non-location in my discard, or a location in play / hand are refused; the tactic stays in hand", () => {
  const g = arBoard({ attack: true });
  refused(() => playRaw(g.engine, P1, g.id("ar")), "no pick");
  for (const key of ["ploc", "dchar", "playloc", "handloc"]) {
    refused(() => castAr(g, key), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("ar")), "hand", `${key}: still in hand`);
  }
  refused(() => playRaw(g.engine, P1, g.id("ar"), { selected: { l: [g.id("loc"), g.id("loc2")] } }), "two locations");
  assert.equal(readyResources(g.engine, P1), 4, "nothing paid by the refusals");
  assert.equal(zoneOf(g.engine, g.id("ploc")), "discard");
  castAr(g, "loc2");
  assert.equal(zoneOf(g.engine, g.id("loc2")), "play", "control: either of my discarded locations can be picked");
  assert.equal(zoneOf(g.engine, g.id("loc")), "discard", "only the picked one");
});

clause(AR, "1:rule", "the picked location is put into play under my control and the attack's target becomes that location", () => {
  const g = arBoard({ attack: true });
  assert.deepEqual(battleOf(g.engine)?.target, { type: "faction", playerId: P1 }, "control: the attack was on my faction");
  castAr(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
  assert.equal(controllerOf(g.engine, g.id("loc")), P1);
  assert.equal(g.engine.state.cards[g.id("loc")].ownerId, P1);
  assert.equal(zoneOf(g.engine, g.id("ar")), "discard", "the tactic is spent");
  assert.deepEqual(battleOf(g.engine)?.target, { type: "card", cardId: g.id("loc") }, "the attack now targets the location");
  assert.equal(zoneOf(g.engine, g.id("loc2")), "discard", "the other discarded location stays");
});

clause(AR, "1:rule", "the redirected attack hits the location, not my faction: the unblocked attacker's damage lands on it and my influence is untouched", () => {
  const redirected = arBoard({ attack: true });
  castAr(redirected);
  redirected.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  finishBattle(redirected.engine);
  assert.equal(redirected.engine.state.cards[redirected.id("loc")].damage, 2, "the attacker's 2 strength on the location");
  assert.equal(influence(redirected.engine, P1), 20, "my faction took nothing");
  const baseline = arBoard({ attack: true });
  resolvePendingResponses(baseline.engine);
  baseline.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  finishBattle(baseline.engine);
  assert.equal(influence(baseline.engine, P1), 18, "control: without it the faction loses 2");
});

clause(AR, "1:rule", "only that opponent's attack is redirected: the location comes under my control (not theirs) and the attacker is unchanged", () => {
  const g = arBoard({ attack: true });
  castAr(g);
  assert.equal(battleOf(g.engine)?.attackerPlayerId, P2);
  assert.deepEqual(battleOf(g.engine)?.attackingParty, [g.id("atk")]);
  assert.equal(battleOf(g.engine)?.defenderPlayerId, P1);
});

clause(AR, "1:rule", "an attack on a location of mine is redirected to the new location too", () => {
  const g = arBoard({ attack: "location" });
  assert.deepEqual(battleOf(g.engine)?.target, { type: "card", cardId: g.id("playloc") }, "control");
  castAr(g);
  assert.deepEqual(battleOf(g.engine)?.target, { type: "card", cardId: g.id("loc") });
});

clause(AR, "2:flipUp", "FLIP UP: face-down in play, it flips up during an opponent's attack and does the same thing (location back, attack redirected)", () => {
  const g = arBoard({ zone: "facedown", g: 3, rage: 1, attack: true });
  flipAr(g);
  resolvePendingResponses(g.engine);
  if (pending(g.engine)) throw new Error(`unexpected pending ${JSON.stringify(pending(g.engine))}`);
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
  assert.equal(controllerOf(g.engine, g.id("loc")), P1);
  assert.deepEqual(battleOf(g.engine)?.target, { type: "card", cardId: g.id("loc") });
  assert.equal(zoneOf(g.engine, g.id("ar")), "discard", "the tactic resolved and went to the discard pile");
});

clause(AR, "2:flipUp", "FLIP UP pays 2 (CR 406.7: the numeric cost starts at the FLIP UP cost, not the printed 4): with spares, no more than 2 resources are spent", () => {
  const g = arBoard({ zone: "facedown", g: 2, rage: 2, attack: true });
  assert.equal(readyResources(g.engine, P1), 5, "AR itself counts as a ready resource face-down");
  flipAr(g);
  assert.equal(zoneOf(g.engine, g.id("loc")), "play");
  const left = readyResources(g.engine, P1);
  assert.ok(left === 2 || left === 3, `2 paid (AR may pay for itself, so 2 or 3 of the others remain), got ${left}`);
});

clause(AR, "2:flipUp", "exact FLIP UP board: the card (paying for itself) + [G] + [G] is enough; the card + one resource, or the card alone (with spent [G][G]), is refused as short of the 2", () => {
  const ok = arBoard({ zone: "facedown", g: 2, rage: 0, attack: true });
  flipAr(ok);
  assert.equal(zoneOf(ok.engine, ok.id("loc")), "play");
  const solo = arBoard({ zone: "facedown", g: 0, rage: 0, spentG: 2, attack: true });
  assert.equal(readyResources(solo.engine, P1), 1);
  refused(() => flipAr(solo), "only one ready resource (the card itself) for a FLIP UP cost of 2");
  assert.equal(faceDownOf(solo.engine, solo.id("ar")), true);
  assert.equal(zoneOf(solo.engine, solo.id("loc")), "discard");
  assert.equal(readyResources(solo.engine, P1), 1, "nothing paid");
  const two = arBoard({ zone: "facedown", g: 0, rage: 1, spentG: 2, attack: true });
  flipAr(two);
  assert.equal(zoneOf(two.engine, two.id("loc")), "play", "control: spent [G][G] + the card + 1 ready resource");
});

clause(AR, "2:flipUp", "the FLIP UP threshold [G][G] is needed after flipping: the card + one [G] + rage is refused (its own icon does not count)", () => {
  const g = arBoard({ zone: "facedown", g: 1, rage: 2, attack: true });
  refused(() => flipAr(g), "one [G] among the others");
  assert.equal(zoneOf(g.engine, g.id("loc")), "discard");
  assert.equal(faceDownOf(g.engine, g.id("ar")), true);
  assert.equal(readyResources(g.engine, P1), 4, "nothing paid");
  const none = arBoard({ zone: "facedown", g: 0, rage: 3, attack: true });
  refused(() => flipAr(none), "no [G]");
  const ok = arBoard({ zone: "facedown", g: 2, rage: 1, attack: true });
  flipAr(ok);
  assert.equal(zoneOf(ok.engine, ok.id("loc")), "play", "control: [G][G] among the others");
});

clause(AR, "2:flipUp", "FLIP UP threshold counts spent [G]: spent [G][G] + the card + 1 ready resource works, with no ready [G] at all", () => {
  const ok = arBoard({ zone: "facedown", g: 0, rage: 2, spentG: 2, attack: true });
  flipAr(ok);
  assert.equal(zoneOf(ok.engine, ok.id("loc")), "play");
  assert.equal(faceDownOf(ok.engine, ok.id("ar")), false);
});

clause(AR, "2:flipUp", "FLIP UP keeps the extra cost: with no attack on me the flip up is refused (CR 507.4d) and nothing is paid", () => {
  const g = arBoard({ zone: "facedown", g: 3, rage: 1, attack: false, active: P1 });
  const before = readyResources(g.engine, P1);
  refused(() => flipAr(g), "no opponent attack", /attack|battle|condition|defend|cannot be (deployed|flipped)/i);
  assert.equal(faceDownOf(g.engine, g.id("ar")), true);
  assert.equal(zoneOf(g.engine, g.id("loc")), "discard");
  assert.equal(readyResources(g.engine, P1), before);
});

clause(AR, "2:flipUp", "FLIP UP keeps the 'pick a location in your discard pile' extra cost: no pick, or an opponent's discarded location, is refused", () => {
  const g = arBoard({ zone: "facedown", g: 3, rage: 1, attack: true });
  refused(() => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("ar"), selected: {}, variables: {} }), "no pick");
  refused(() => flipAr(g, "ploc"), "the opponent's location");
  refused(() => flipAr(g, "playloc"), "a location in play");
  assert.equal(faceDownOf(g.engine, g.id("ar")), true);
  assert.equal(readyResources(g.engine, P1), 5, "nothing paid");
});
