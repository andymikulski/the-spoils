// Clause tests, batch holy-heist-02, part p3 (groups 12-17, missing clauses only).
// Addlebrained Defense Attorney, Akashic Coin, Asbestos Drywall, Canny Bailiff, Cathedrale de Mau, Crematory Cache.
import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  bank,
  bounceTactic,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdFlipUp } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { declareAttackOpenWindow, fightThrough, playRaw } from "./_battle.js";
import { developResource, factionOf } from "./_turn.js";

const ATTORNEY = "261006b5-5d93-4b1c-8eab-1788650529bf"; // character banker cost 6 "g" 5/3/4 -- vanilla
const COIN = "21274c5d-a966-4303-a9e6-9db01061d7a0"; // item banker cost 1 "g" -- UNIQUE AKASHIC OBJECT; V enters under opp: pay 2 / lose 1 influence draw / else face-down; FLIP UP 3 [G]
const NOTES = "27d42a55-adb9-43ca-95b6-6778af1648f0"; // Akashic Notes -- UNIQUE AKASHIC OBJECT (board piece only)
const DRYWALL = "f44b8c88-1aa5-4422-ad4d-29d49c252959"; // tactic banker cost 3 "gg" -- EXTRA COST pick a location; remove or add 2 damage markers; FLIP UP 3 [G][G]
const BAILIFF = "efac6670-d61f-42ba-aee9-e897b774e395"; // character banker cost 3 "gg" 2/3/1 -- opponent's tactic numeric cost raised to at least 3
const CATH = "f5bf92d7-3153-4600-b5df-3d669ece9404"; // location banker cost 3 "ggg" structure 4 -- UNIQUE CATHEDRAL; ward locations / cost 6+ characters
const CLOSE_CALL = "9d26a50a-5978-4efd-8b94-df7bd81b226c"; // tactic cost 3 "o" -- board piece only: ends up in play as a face-down resource (selfDisposition)
const CACHE = "9c2008d3-32d2-495d-9147-203f5c33aa36"; // item banker cost 3 "gg" -- character destroyed: may gain 1 influence

const ready = (engine: SpoilsEngine, player: PlayerId): number => readyResources(engine, player);
const influence = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const handSize = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].hand.length;
const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;

const optionLabels = (pc: PendingChoiceLike): string[] =>
  ((pc.options as Array<string | { label?: string }> | undefined) ?? []).map(o => (typeof o === "string" ? o : o.label ?? ""));

const optionIndex = (pc: PendingChoiceLike, re: RegExp): number => {
  const index = optionLabels(pc).findIndex(label => re.test(label));
  assert.ok(index >= 0, `an option matching ${re} among ${JSON.stringify(optionLabels(pc))}`);
  return index;
};

/** Answers the open `chooserSelectsOption` with the option whose label matches `re`. */
function chooseOption(engine: SpoilsEngine, re: RegExp): void {
  const pc = pending(engine);
  assert.equal(pc?.kind, "chooserSelectsOption", "an option choice is open");
  answerPending(engine, "chooserSelectsOption", { index: optionIndex(pc!, re) });
}

/** A `drain` answerer: every `mayPay` is accepted (`pay`) or declined; anything else is declined. */
const mayPayAnswer = (pay: boolean) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "mayPay" ? { kind: "mayPay", pay } : declineAll(pc);

const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

// ============================================================================
// Addlebrained Defense Attorney -- vanilla, cost 6 [G], 5/3/4
// ============================================================================

function attorneyBoard(resources: CardPlacement[], active: PlayerId = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [{ key: "atty", def: printing(ATTORNEY), owner: P1, zone: "hand" }, ...resources]
  });
}

clause(ATTORNEY, "vanilla", "deploys for exactly its printed cost 6 with [G]: six Greed resources are all spent, and it enters play as a character with printed 5/3/4, no keywords and no abilities", () => {
  const { engine, id } = attorneyBoard([...bank("greed", 6, P1), ...bank("rage", 2, P1)]);
  assert.equal(engine.getCardPlayability(P1, id("atty")).numericCost, 6);
  play(engine, P1, id("atty"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("atty")), "play");
  assert.equal(ready(engine, P1), 2, "exactly 6 of the 8 resources were spent");
  assert.deepEqual(engine.getCardTypes(id("atty")), ["character"]);
  assert.equal(engine.getStat(id("atty"), "strength"), 5);
  assert.equal(engine.getStat(id("atty"), "speed"), 3);
  assert.equal(engine.getStat(id("atty"), "life"), 4);
  assert.equal(engine.getKeywords(id("atty")).length, 0, "no keywords");
  assert.deepEqual(engine.getDefinition(id("atty")).behavior?.abilities ?? [], [], "no printed rules text, so no abilities");
});

clause(ATTORNEY, "vanilla", "refused one resource short: five Greed resources cannot deploy a cost-6 character, and nothing is spent", () => {
  const short = attorneyBoard(bank("greed", 5, P1));
  refused(() => play(short.engine, P1, short.id("atty")), "five resources for a cost of six");
  assert.equal(zoneOf(short.engine, short.id("atty")), "hand");
  assert.equal(ready(short.engine, P1), 5, "nothing was paid");
  const enough = attorneyBoard(bank("greed", 6, P1));
  play(enough.engine, P1, enough.id("atty"));
  assert.equal(zoneOf(enough.engine, enough.id("atty")), "play", "control: six resources work");
});

clause(ATTORNEY, "vanilla", "needs the [G] threshold: six Rage resources are enough resources but not Greed; one Greed among them is enough", () => {
  const noGreed = attorneyBoard(bank("rage", 6, P1));
  refused(() => play(noGreed.engine, P1, noGreed.id("atty")), "six Rage resources, no [G]");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("atty")), "hand");
  assert.equal(ready(noGreed.engine, P1), 6, "nothing was paid");
  const oneGreed = attorneyBoard([...bank("greed", 1, P1), ...bank("rage", 5, P1)]);
  play(oneGreed.engine, P1, oneGreed.id("atty"));
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("atty")), "play", "a single [G] meets the threshold");
});

clause(ATTORNEY, "vanilla", "is a character: it cannot be deployed on the opponent's turn", () => {
  const theirTurn = attorneyBoard(bank("greed", 6, P1), P2);
  refused(() => play(theirTurn.engine, P1, theirTurn.id("atty")), "a character on the opponent's turn");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("atty")), "hand");
  assert.equal(ready(theirTurn.engine, P1), 6);
});

// ============================================================================
// Akashic Coin -- UNIQUE AKASHIC OBJECT; trigger; FLIP UP 3 [G]
// ============================================================================

interface CoinOpts {
  coin?: "play" | "faceDown" | "hand" | "discard";
  coinController?: PlayerId;
  /** P1's face-up staple resources. */
  greed?: number;
  rage?: number;
  /** P2's face-up Rage resources (default 3). */
  oppBanks?: number;
  influence?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function coinBoard(o: CoinOpts = {}) {
  const active = o.active ?? P2;
  const coin = o.coin ?? "play";
  return buildGame({
    playerA: { faction: developFaction(), ...(o.influence !== undefined ? { influence: o.influence } : {}) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      {
        key: "coin",
        def: printing(COIN),
        owner: P1,
        zone: coin === "faceDown" ? "play" : coin,
        ...(o.coinController ? { controller: o.coinController } : {}),
        ...(coin === "faceDown" ? { faceDown: true } : {})
      },
      { key: "p2fodder", def: character({ name: "P2 Fodder" }), owner: P2, zone: "hand" },
      { key: "p1fodder", def: character({ name: "P1 Fodder" }), owner: P1, zone: "hand" },
      ...fillers("d", 3, P1, "deck"),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("rage", o.oppBanks ?? 3, P2),
      ...(o.extra ?? [])
    ]
  });
}
type CoinGame = ReturnType<typeof coinBoard>;

/** The active opponent (P2) develops their fodder card face-down, then the engine settles to the first prompt. */
function p2DevelopsFaceDown(g: CoinGame): void {
  developResource(g.engine, P2, g.id("p2fodder"), true);
  resolvePendingResponses(g.engine);
}

const coinSnapshot = (g: CoinGame) => ({
  p1Influence: influence(g.engine, P1),
  p2Influence: influence(g.engine, P2),
  p1Hand: handSize(g.engine, P1),
  p2Hand: handSize(g.engine, P2),
  p1Deck: g.engine.state.players[P1].deck.length
});

clause(COIN, "1:rule", "an opponent's face-down card (it provides [V]) entering play asks THAT PLAYER, the opponent, whether to pay 2", () => {
  const g = coinBoard();
  p2DevelopsFaceDown(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "the player whose card entered is the one asked to pay");
});

clause(COIN, "1:rule", "if they pay 2 that is the end of it: exactly 2 resources are spent, no influence is lost, no card drawn, and the Coin stays face-up in play", () => {
  const g = coinBoard();
  const before = coinSnapshot(g);
  p2DevelopsFaceDown(g);
  const readyBeforePay = ready(g.engine, P2);
  assert.equal(readyBeforePay, 4, "3 Rage resources and the new face-down card");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined, "the sequence is over");
  assert.equal(ready(g.engine, P2), readyBeforePay - 2, "exactly 2 paid");
  assert.deepEqual(coinSnapshot(g), { ...before, p2Hand: before.p2Hand - 1 }, "nothing changed but the card the opponent developed");
  assert.equal(zoneOf(g.engine, g.id("coin")), "play");
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, false, "still face-up");
  assert.equal(g.engine.isResource(g.id("coin")), false);
});

clause(COIN, "1:rule", "if they don't pay, its controller is asked next (not the opponent); accepting loses 1 influence and draws a card, and the Coin stays face-up", () => {
  const g = coinBoard();
  const before = coinSnapshot(g);
  const topOfDeck = g.engine.state.players[P1].deck[0];
  p2DevelopsFaceDown(g);
  const opponentResources = ready(g.engine, P2);
  answerPending(g.engine, "mayPay", { pay: false });
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay", "the Coin's controller is offered the influence loss");
  assert.equal(pc?.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P1), before.p1Influence - 1, "your faction lost exactly 1 influence");
  assert.equal(handSize(g.engine, P1), before.p1Hand + 1, "you drew exactly one card");
  assert.equal(g.engine.state.players[P1].deck.length, before.p1Deck - 1);
  assert.ok(g.engine.state.players[P1].hand.includes(topOfDeck), "the top card of your deck was drawn");
  assert.equal(influence(g.engine, P2), before.p2Influence, "the opponent loses nothing");
  assert.equal(handSize(g.engine, P2), before.p2Hand - 1, "the opponent draws nothing (their only change is the card they developed)");
  assert.equal(ready(g.engine, P2), opponentResources, "the opponent paid nothing");
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, false, "the Coin was used, so it stays face-up");
  assert.equal(zoneOf(g.engine, g.id("coin")), "play");
});

clause(COIN, "1:rule", "otherwise (they don't pay and you decline) the Coin flips face-down under its owner's control: no influence lost, no card drawn, and it is now a resource", () => {
  const g = coinBoard();
  const before = coinSnapshot(g);
  p2DevelopsFaceDown(g);
  answerPending(g.engine, "mayPay", { pay: false });
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  const coin = g.engine.state.cards[g.id("coin")];
  assert.equal(coin.zone, "play");
  assert.equal(coin.faceDown, true, "flipped face-down");
  assert.equal(coin.controllerId, P1);
  assert.equal(g.engine.isResource(g.id("coin")), true, "a face-down card is a resource");
  assert.equal(influence(g.engine, P1), before.p1Influence);
  assert.equal(handSize(g.engine, P1), before.p1Hand);
  assert.equal(g.engine.state.players[P1].deck.length, before.p1Deck);
});

clause(COIN, "1:rule", "when the opponent pays 2 the Coin is NOT flipped face-down (the flip only follows the 'if you do' branch)", () => {
  const g = coinBoard();
  p2DevelopsFaceDown(g);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, false);
});

clause(COIN, "1:rule", "the Coin flips face-down 'under its owner's control': a Coin its owner no longer controls goes back to the owner's control", () => {
  // P1 owns the Coin, P2 controls it. P1 (the Coin's owner, an opponent of its controller) develops a face-down card.
  const g = coinBoard({ coinController: P2, active: P1, rage: 3 });
  assert.equal(g.engine.state.cards[g.id("coin")].controllerId, P2, "setup: P2 controls P1's Coin");
  developResource(g.engine, P1, g.id("p1fodder"), true);
  resolvePendingResponses(g.engine);
  let pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1, "the entering card's controller is asked to pay");
  answerPending(g.engine, "mayPay", { pay: false });
  pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "the Coin's controller P2 is the 'you'");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  const coin = g.engine.state.cards[g.id("coin")];
  assert.equal(coin.faceDown, true);
  assert.equal(coin.controllerId, P1, "back under its owner's control");
  assert.equal(coin.ownerId, P1);
});

clause(COIN, "1:rule", "'you' is the Coin's controller: a Coin P2 controls draws for P2, and loses P2's influence, when P1's face-down card enters", () => {
  const g = coinBoard({
    coinController: P2,
    active: P1,
    rage: 3,
    extra: fillers("e", 3, P2, "deck")
  });
  const p2Hand = handSize(g.engine, P2);
  const p1Hand = handSize(g.engine, P1);
  const p1Inf = influence(g.engine, P1);
  const p2Inf = influence(g.engine, P2);
  developResource(g.engine, P1, g.id("p1fodder"), true);
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine)?.playerId, P2);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P2), p2Inf - 1, "the controller's faction lost the influence");
  assert.equal(influence(g.engine, P1), p1Inf, "the owner's faction did not");
  assert.equal(handSize(g.engine, P2), p2Hand + 1, "the controller drew");
  assert.equal(handSize(g.engine, P1), p1Hand - 1, "the owner only lost the card they developed");
});

clause(COIN, "1:rule", "an opponent who cannot afford 2 is not asked: the Coin's controller is asked right away", () => {
  const g = coinBoard({ oppBanks: 0 });
  const handBefore = handSize(g.engine, P1);
  p2DevelopsFaceDown(g);
  assert.equal(ready(g.engine, P2), 1, "setup: only the newly developed card is a resource");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1, "the opponent cannot pay 2, so the influence offer comes next");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(handSize(g.engine, P1), handBefore + 1, "drew a card after losing the influence");
});

clause(COIN, "1:rule", "exactly 2 resources (the new face-down card and one more) is enough to pay 2", () => {
  const g = coinBoard({ oppBanks: 1 });
  p2DevelopsFaceDown(g);
  assert.equal(ready(g.engine, P2), 2);
  const pc = pending(g.engine);
  assert.equal(pc?.playerId, P2, "the opponent is asked");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(ready(g.engine, P2), 0, "both resources were spent");
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, false);
});

clause(COIN, "1:rule", "any card entering play by an effect face-down (not only by develop) triggers it too", () => {
  const push = tactic({
    name: "Push",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "push",
          type: "activated",
          targets: [],
          effects: [{ type: "playResource", target: { type: "random", selector: { controller: "self", zone: "hand" } }, faceDown: true, player: "controller" }]
        }
      ]
    }
  });
  const g = coinBoard({ extra: [{ key: "push", def: push, owner: P2, zone: "hand" }] });
  play(g.engine, P2, g.id("push"));
  assert.equal(zoneOf(g.engine, g.id("p2fodder")), "play", "setup: the fodder entered play");
  assert.equal(g.engine.state.cards[g.id("p2fodder")].faceDown, true, "face-down");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined, "one trigger only");
});

const reviveTactic = (faceDown: boolean) =>
  tactic({
    name: faceDown ? "Revive Face-down" : "Revive Face-up",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rev",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller", faceDown }]
        }
      ]
    }
  });

clause(COIN, "1:rule", "a tactic that ends up in play as a face-down resource (Close Call) is a [V]-providing card entering play under the opponent's control, so it triggers it", () => {
  const g = coinBoard({
    extra: [
      { key: "cc", def: printing(CLOSE_CALL), owner: P2, zone: "hand" },
      { key: "p2guy", def: character({ name: "P2 Guy" }), owner: P2, zone: "play" },
      ...bank("obsession", 3, P2)
    ]
  });
  play(g.engine, P2, g.id("cc"), { selected: { c: [g.id("p2guy")] } });
  assert.equal(zoneOf(g.engine, g.id("p2guy")), "hand", "setup: Close Call returned the character");
  assert.equal(zoneOf(g.engine, g.id("cc")), "play", "setup: Close Call entered play");
  assert.equal(g.engine.state.cards[g.id("cc")].faceDown, true, "setup: as a face-down resource");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay", "the Coin triggers");
  assert.equal(pc?.playerId, P2);
});

clause(COIN, "1:rule", "a card put into play face-down from a discard pile (not played as a resource) triggers it too", () => {
  const g = coinBoard({
    extra: [
      { key: "rev", def: reviveTactic(true), owner: P2, zone: "hand" },
      { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" }
    ]
  });
  const before = coinSnapshot(g);
  play(g.engine, P2, g.id("rev"), { selected: { t: [g.id("corpse")] } });
  assert.equal(zoneOf(g.engine, g.id("corpse")), "play", "setup: it entered play");
  assert.equal(g.engine.state.cards[g.id("corpse")].faceDown, true, "setup: face-down");
  let pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2);
  answerPending(g.engine, "mayPay", { pay: false });
  pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined, "one trigger only");
  assert.equal(handSize(g.engine, P1), before.p1Hand + 1);
  assert.equal(influence(g.engine, P1), before.p1Influence - 1);
});

clause(COIN, "1:rule", "the same character put into play face-up provides no [V], so it does not trigger it", () => {
  const g = coinBoard({
    extra: [
      { key: "rev", def: reviveTactic(false), owner: P2, zone: "hand" },
      { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" }
    ]
  });
  play(g.engine, P2, g.id("rev"), { selected: { t: [g.id("corpse")] } });
  assert.equal(zoneOf(g.engine, g.id("corpse")), "play", "setup: it entered play");
  assert.equal(g.engine.state.cards[g.id("corpse")].faceDown, false, "setup: face-up");
  assert.equal(pending(g.engine), undefined);
});

clause(COIN, "1:rule", "a face-up card providing only a non-[V] icon (a face-up Deception resource) does not trigger it", () => {
  const dec = resourceCard({ name: "Deception Staple", resource: { provides: ["deception"], staple: true } });
  const g = coinBoard({ extra: [{ key: "res", def: dec, owner: P2, zone: "hand" }] });
  developResource(g.engine, P2, g.id("res"), false);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("res")), "play");
  assert.equal(g.engine.state.cards[g.id("res")].faceDown, false);
  assert.equal(pending(g.engine), undefined, "no prompt: it provides [D], not [V]");
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, false);
});

clause(COIN, "1:rule", "a face-up character or item entering under the opponent's control does not trigger it", () => {
  const g = coinBoard({
    extra: [
      { key: "p2char", def: character({ name: "P2 Char", cost: 1 }), owner: P2, zone: "hand" },
      { key: "p2item", def: item({ name: "P2 Item", cost: 1 }), owner: P2, zone: "hand" }
    ]
  });
  play(g.engine, P2, g.id("p2char"));
  assert.equal(zoneOf(g.engine, g.id("p2char")), "play");
  assert.equal(pending(g.engine), undefined, "a face-up character provides no [V]");
  play(g.engine, P2, g.id("p2item"));
  assert.equal(zoneOf(g.engine, g.id("p2item")), "play");
  assert.equal(pending(g.engine), undefined, "a face-up item provides no [V]");
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, false);
});

clause(COIN, "1:rule", "a card entering under its OWN controller's control (the Coin's controller develops face-down) does not trigger it", () => {
  const g = coinBoard({ active: P1 });
  developResource(g.engine, P1, g.id("p1fodder"), true);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("p1fodder")), "play", "setup: it entered");
  assert.equal(pending(g.engine), undefined, "my own [V] source is not an opponent's");
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, false);
});

clause(COIN, "1:rule", "a face-down Coin is just a resource: it has no trigger", () => {
  const g = coinBoard({ coin: "faceDown" });
  p2DevelopsFaceDown(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, true);
});

clause(COIN, "1:rule", "a Coin in the hand or discard pile has no trigger", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = coinBoard({ coin: zone });
    p2DevelopsFaceDown(g);
    assert.equal(pending(g.engine), undefined, `Coin in ${zone}`);
    assert.equal(zoneOf(g.engine, g.id("coin")), zone);
  }
});

// -- UNIQUE AKASHIC OBJECT ---------------------------------------------------

function uniqueBoard(otherZone: "play" | "hand", extra: CardPlacement[], dupe: string = COIN) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "coin1", def: printing(dupe), owner: P1, zone: otherZone },
      { key: "coin2", def: printing(COIN), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1),
      ...extra
    ]
  });
}

const keepOnly = (keep: CardInstanceId) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep } : declineAll(pc);

clause(COIN, "0:unique", "controlling a second Akashic Coin makes its controller keep one: keeping the new one destroys the old one", () => {
  const g = uniqueBoard("play", []);
  play(g.engine, P1, g.id("coin2"));
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [g.id("coin1"), g.id("coin2")].sort());
  drain(g.engine, keepOnly(g.id("coin2")));
  assert.equal(zoneOf(g.engine, g.id("coin2")), "play");
  assert.equal(zoneOf(g.engine, g.id("coin1")), "discard", "the old one is destroyed");
});

clause(COIN, "0:unique", "keeping the old Coin destroys the new one", () => {
  const g = uniqueBoard("play", []);
  play(g.engine, P1, g.id("coin2"));
  drain(g.engine, keepOnly(g.id("coin1")));
  assert.equal(zoneOf(g.engine, g.id("coin1")), "play");
  assert.equal(zoneOf(g.engine, g.id("coin2")), "discard");
});

clause(COIN, "0:unique", "another card with the AKASHIC OBJECT designation (Akashic Notes) counts as a duplicate whatever its name", () => {
  const g = uniqueBoard("play", [], NOTES);
  play(g.engine, P1, g.id("coin2"));
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  drain(g.engine, keepOnly(g.id("coin2")));
  assert.equal(zoneOf(g.engine, g.id("coin1")), "discard", "the Notes is destroyed");
  assert.equal(zoneOf(g.engine, g.id("coin2")), "play");
});

clause(COIN, "0:unique", "the restriction is per player: the opponent may control their own Akashic Coin", () => {
  const g = uniqueBoard("hand", [{ key: "oppCoin", def: printing(COIN), owner: P2, zone: "play" }]);
  play(g.engine, P1, g.id("coin2"));
  assert.equal(pending(g.engine), undefined, "no survivor prompt");
  assert.equal(zoneOf(g.engine, g.id("coin2")), "play");
  assert.equal(zoneOf(g.engine, g.id("oppCoin")), "play");
});

clause(COIN, "0:unique", "a card with a different UNIQUE designation (Cathedrale de Mau, CATHEDRAL) is not a duplicate", () => {
  const g = uniqueBoard("hand", [{ key: "cath", def: printing(CATH), owner: P1, zone: "play" }]);
  play(g.engine, P1, g.id("coin2"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("coin2")), "play");
  assert.equal(zoneOf(g.engine, g.id("cath")), "play");
});

clause(COIN, "0:unique", "a face-down Coin is only a resource, so a face-up Coin next to it is not a duplicate", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "coin1", def: printing(COIN), owner: P1, zone: "play", faceDown: true },
      { key: "coin2", def: printing(COIN), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  play(g.engine, P1, g.id("coin2"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("coin1")), "play");
  assert.equal(zoneOf(g.engine, g.id("coin2")), "play");
});

// -- FLIP UP: 3 [G] ----------------------------------------------------------

const flipCoin = (g: CoinGame, player: PlayerId = P1): void => rawFlipUp(g.engine, player, g.id("coin"));

clause(COIN, "2:flipUp", "a face-down Coin flips up for 3 with [G] into a face-up item in play, not a resource any more", () => {
  const g = coinBoard({ coin: "faceDown", active: P1, greed: 1, rage: 1 });
  assert.equal(ready(g.engine, P1), 3, "setup: the face-down Coin, a Greed and a Rage resource");
  flipCoin(g);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  const coin = g.engine.state.cards[g.id("coin")];
  assert.equal(coin.zone, "play");
  assert.equal(coin.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("coin")), ["item"]);
  assert.equal(g.engine.isResource(g.id("coin")), false);
  assert.equal(coin.controllerId, P1);
});

clause(COIN, "2:flipUp", "pays exactly 3 (not the normal cost of 1): of 5 other resources, 3 are spent and 2 stay ready (the Coin itself stops being a resource)", () => {
  const g = coinBoard({ coin: "faceDown", active: P1, greed: 1, rage: 4 });
  assert.equal(ready(g.engine, P1), 6);
  flipCoin(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, false);
  assert.equal(ready(g.engine, P1), 2, "6 - 3 paid - the Coin that left the pool");
});

clause(COIN, "2:flipUp", "the Coin may help pay its own FLIP UP: itself plus 2 other resources (one [G]) is exactly enough, and all are spent", () => {
  const g = coinBoard({ coin: "faceDown", active: P1, greed: 1, rage: 1 });
  flipCoin(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, false);
  assert.equal(ready(g.engine, P1), 0);
});

clause(COIN, "2:flipUp", "is refused when short: the Coin plus one Greed is only 2 resources, and nothing is paid", () => {
  const g = coinBoard({ coin: "faceDown", active: P1, greed: 1 });
  refused(() => flipCoin(g), "2 resources for a FLIP UP cost of 3");
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, true, "still face-down");
  assert.equal(ready(g.engine, P1), 2, "nothing was paid");
});

clause(COIN, "2:flipUp", "needs [G]: plenty of Rage resources is not the threshold, and the Coin's own Volition is not [G]", () => {
  const noGreed = coinBoard({ coin: "faceDown", active: P1, rage: 6 });
  refused(() => flipCoin(noGreed), "no [G] among the resources");
  assert.equal(noGreed.engine.state.cards[noGreed.id("coin")].faceDown, true);
  assert.equal(ready(noGreed.engine, P1), 7, "nothing was paid");
  const opponentGreed = coinBoard({
    coin: "faceDown",
    active: P1,
    rage: 6,
    extra: bank("greed", 4, P2)
  });
  refused(() => flipCoin(opponentGreed), "the opponent's [G] do not count");
  const oneGreed = coinBoard({ coin: "faceDown", active: P1, rage: 5, greed: 1 });
  flipCoin(oneGreed);
  resolvePendingResponses(oneGreed.engine);
  assert.equal(oneGreed.engine.state.cards[oneGreed.id("coin")].faceDown, false, "control: a single [G] among the resources is enough");
});

clause(COIN, "2:flipUp", "FLIP UP does not change when an item can be deployed: refused on the opponent's turn", () => {
  const g = coinBoard({ coin: "faceDown", active: P2, greed: 3 });
  refused(() => flipCoin(g), "an item on the opponent's turn");
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, true);
  assert.equal(ready(g.engine, P1), 4, "nothing was paid");
});

clause(COIN, "2:flipUp", "a non-tactic cannot be flipped up inside the opponent's response window", () => {
  const g = coinBoard({
    coin: "faceDown",
    active: P2,
    greed: 3,
    extra: [{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => flipCoin(g), "an item cannot be played in a response window");
  assert.equal(g.engine.state.cards[g.id("coin")].faceDown, true);
  assert.equal(ready(g.engine, P1), 4, "nothing was paid");
});

clause(COIN, "2:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const theirs = coinBoard({ coin: "faceDown", active: P1, greed: 3, extra: bank("greed", 3, P2) });
  refused(() => flipCoin(theirs, P2), "the opponent cannot flip my Coin");
  assert.equal(theirs.engine.state.cards[theirs.id("coin")].faceDown, true);
  const faceUp = coinBoard({ coin: "play", active: P1, greed: 3 });
  refused(() => flipCoin(faceUp), "already face-up");
  const inHand = coinBoard({ coin: "hand", active: P1, greed: 3 });
  refused(() => flipCoin(inHand), "in the hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("coin")), "hand");
});

clause(COIN, "2:flipUp", "FLIP UP is an alternative: from the hand the Coin deploys for its normal cost of 1 with [G] (one Greed)", () => {
  const g = coinBoard({ coin: "hand", active: P1, greed: 1, rage: 2 });
  assert.equal(g.engine.getCardPlayability(P1, g.id("coin")).numericCost, 1);
  playRaw(g.engine, P1, g.id("coin"));
  assert.equal(ready(g.engine, P1), 2, "exactly 1 paid");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("coin")), "play");
  const noGreed = coinBoard({ coin: "hand", active: P1, rage: 3 });
  refused(() => play(noGreed.engine, P1, noGreed.id("coin")), "no [G]");
});

clause(COIN, "2:flipUp", "a flipped-up Coin is a real item: it triggers on the opponent's next face-down card", () => {
  const g = coinBoard({ coin: "faceDown", active: P1, greed: 1, rage: 1 });
  flipCoin(g);
  resolvePendingResponses(g.engine);
  g.engine.state.activePlayerId = P2;
  p2DevelopsFaceDown(g);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2);
});

clause(COIN, "2:flipUp", "a flipped-up Coin is played as though from the hand (CR 507.4a), so the opponent may respond before it enters play", () => {
  const g = coinBoard({ coin: "faceDown", active: P1, greed: 1, rage: 1 });
  holdFlipUp(() => flipCoin(g));
  assert.ok(g.engine.state.responseWindow, "a response window is open once the cost is paid");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(g.engine, g.id("coin")), "deploying", "the item is being deployed, it has not entered play yet");
});

// ============================================================================
// Asbestos Drywall -- EXTRA COST pick a location; remove 2 or add 2 damage markers; FLIP UP 3 [G][G]
// ============================================================================

interface DwOpts {
  dw?: "hand" | "faceDown";
  greed?: number;
  rage?: number;
  mineDamage?: number;
  theirsDamage?: number;
  mineStructure?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function dwBoard(o: DwOpts = {}) {
  const active = o.active ?? P1;
  const dw = o.dw ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "dw", def: printing(DRYWALL), owner: P1, zone: dw === "hand" ? "hand" : "play", ...(dw === "faceDown" ? { faceDown: true } : {}) },
      { key: "mine", def: location({ name: "My Hall", structure: o.mineStructure ?? 8 }), owner: P1, zone: "play", damage: o.mineDamage ?? 5 },
      { key: "theirs", def: location({ name: "Their Hall", structure: 6 }), owner: P2, zone: "play", damage: o.theirsDamage ?? 3 },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      ...bank("greed", o.greed ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type DwGame = ReturnType<typeof dwBoard>;

const playDw = (g: DwGame, pick: string, option: RegExp): void => {
  play(g.engine, P1, g.id("dw"), { selected: { loc: [g.id(pick)] } });
  chooseOption(g.engine, option);
  assert.equal(pending(g.engine), undefined, "the tactic finished");
};

clause(DRYWALL, "0:extraCost", "picking a location is part of playing it: the pick is made up front, the 3 resources are already paid while the tactic waits, and the location is untouched until it resolves", () => {
  const g = dwBoard();
  playRaw(g.engine, P1, g.id("dw"), { selected: { loc: [g.id("mine")] } });
  assert.equal(ready(g.engine, P1), 0, "all 3 resources paid at play time");
  assert.ok(g.engine.state.responseWindow, "the tactic is waiting for responses");
  assert.equal(damageOf(g.engine, g.id("mine")), 5, "nothing has happened to the location yet");
  resolvePendingResponses(g.engine);
  chooseOption(g.engine, /remove/i);
  assert.equal(damageOf(g.engine, g.id("mine")), 3);
});

clause(DRYWALL, "0:extraCost", "either player's location can be picked: the opponent's location is pickable", () => {
  const g = dwBoard();
  playDw(g, "theirs", /add/i);
  assert.equal(damageOf(g.engine, g.id("theirs")), 5, "3 + 2");
  assert.equal(damageOf(g.engine, g.id("mine")), 5, "my own location is untouched");
});

clause(DRYWALL, "0:extraCost", "only a location in play can be picked: a character, an item, a faction, a face-down card, and a location in the hand or discard pile are refused (nothing is paid)", () => {
  const g = dwBoard({
    extra: [
      { key: "handLoc", def: location({ name: "Hand Loc" }), owner: P1, zone: "hand" },
      { key: "discLoc", def: location({ name: "Disc Loc" }), owner: P1, zone: "discard" },
      { key: "fdLoc", def: location({ name: "Face-down Loc" }), owner: P1, zone: "play", faceDown: true }
    ]
  });
  const start = ready(g.engine, P1);
  assert.equal(start, 4, "setup: 3 Greed and the face-down location (a face-down card is a resource)");
  const attempt = (pick: CardInstanceId | undefined, why: string) => {
    refused(() => play(g.engine, P1, g.id("dw"), { selected: { loc: pick ? [pick] : [] } }), why);
    assert.equal(zoneOf(g.engine, g.id("dw")), "hand", `${why}: still in hand`);
    assert.equal(ready(g.engine, P1), start, `${why}: nothing paid`);
  };
  attempt(g.id("foe"), "a character");
  attempt(g.id("myItem"), "an item");
  attempt(factionOf(g.engine, P2), "a faction");
  attempt(g.id("fdLoc"), "a face-down card");
  attempt(g.id("handLoc"), "a location in the hand");
  attempt(g.id("discLoc"), "a location in the discard pile");
  attempt(undefined, "no pick at all");
  play(g.engine, P1, g.id("dw"), { selected: { loc: [g.id("mine")] } });
  assert.equal(pending(g.engine)?.kind, "chooserSelectsOption", "control: a real location is accepted");
});

clause(DRYWALL, "0:extraCost", "exactly one location is picked: two picks are refused", () => {
  const g = dwBoard();
  refused(() => play(g.engine, P1, g.id("dw"), { selected: { loc: [g.id("mine"), g.id("theirs")] } }), "two locations");
  assert.equal(zoneOf(g.engine, g.id("dw")), "hand");
  assert.equal(ready(g.engine, P1), 3);
});

clause(DRYWALL, "0:extraCost", "with no location in play it cannot be played at all", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "dw", def: printing(DRYWALL), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  refused(() => play(g.engine, P1, g.id("dw"), { selected: {} }), "no location to pick");
  assert.equal(zoneOf(g.engine, g.id("dw")), "hand");
  assert.equal(ready(g.engine, P1), 3);
});

clause(DRYWALL, "0:extraCost", "costs 3 with [G][G]: refused with only 2 resources, with 3 resources holding a single [G], and with 3 non-Greed; two Greed plus one other is exactly enough", () => {
  const two = dwBoard({ greed: 2 });
  refused(() => play(two.engine, P1, two.id("dw"), { selected: { loc: [two.id("mine")] } }), "2 resources");
  assert.equal(ready(two.engine, P1), 2);
  const oneG = dwBoard({ greed: 1, rage: 2 });
  refused(() => play(oneG.engine, P1, oneG.id("dw"), { selected: { loc: [oneG.id("mine")] } }), "one [G] is not [G][G]");
  assert.equal(ready(oneG.engine, P1), 3);
  const noG = dwBoard({ greed: 0, rage: 5 });
  refused(() => play(noG.engine, P1, noG.id("dw"), { selected: { loc: [noG.id("mine")] } }), "no [G]");
  const exact = dwBoard({ greed: 2, rage: 1 });
  play(exact.engine, P1, exact.id("dw"), { selected: { loc: [exact.id("mine")] } });
  assert.equal(ready(exact.engine, P1), 0, "exactly 3 paid");
  assert.equal(pending(exact.engine)?.kind, "chooserSelectsOption");
  const spare = dwBoard({ greed: 2, rage: 3 });
  play(spare.engine, P1, spare.id("dw"), { selected: { loc: [spare.id("mine")] } });
  assert.equal(ready(spare.engine, P1), 2, "5 - 3");
});

clause(DRYWALL, "1:rule", "offers exactly two options, one removing 2 damage markers and one adding 2, and the tactic's controller (not the location's) chooses", () => {
  const g = dwBoard();
  play(g.engine, P1, g.id("dw"), { selected: { loc: [g.id("theirs")] } });
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1, "I chose, although the location is the opponent's");
  const labels = optionLabels(pc!);
  assert.equal(labels.length, 2);
  assert.ok(labels.some(l => /remove/i.test(l)), "labels.some(l => /remove/i.test(l))");
  assert.ok(labels.some(l => /add/i.test(l)), "labels.some(l => /add/i.test(l))");
});

clause(DRYWALL, "1:rule", "remove 2 damage markers: a location with 5 damage ends with 3, the other location is untouched, and the tactic goes to the discard pile", () => {
  const g = dwBoard();
  playDw(g, "mine", /remove/i);
  assert.equal(damageOf(g.engine, g.id("mine")), 3);
  assert.equal(damageOf(g.engine, g.id("theirs")), 3, "the other location is untouched");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(zoneOf(g.engine, g.id("dw")), "discard");
});

clause(DRYWALL, "1:rule", "remove 2 from the opponent's location works too (3 damage -> 1)", () => {
  const g = dwBoard();
  playDw(g, "theirs", /remove/i);
  assert.equal(damageOf(g.engine, g.id("theirs")), 1);
  assert.equal(damageOf(g.engine, g.id("mine")), 5);
});

clause(DRYWALL, "1:rule", "removing 2 from a location with exactly 2 leaves 0; with only 1 it leaves 0 (never negative); with none it stays 0", () => {
  for (const [start, expected] of [[2, 0], [1, 0], [0, 0]] as const) {
    const g = dwBoard({ mineDamage: start });
    playDw(g, "mine", /remove/i);
    assert.equal(damageOf(g.engine, g.id("mine")), expected, `${start} damage -> ${expected}`);
    assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  }
});

clause(DRYWALL, "1:rule", "add 2 damage markers: a location with 0 damage ends with 2, with 5 ends with 7 (structure 8, so it survives); the other location is untouched", () => {
  for (const [start, expected] of [[0, 2], [5, 7]] as const) {
    const g = dwBoard({ mineDamage: start });
    playDw(g, "mine", /add/i);
    assert.equal(damageOf(g.engine, g.id("mine")), expected, `${start} damage -> ${expected}`);
    assert.equal(zoneOf(g.engine, g.id("mine")), "play");
    assert.equal(damageOf(g.engine, g.id("theirs")), 3, "the other location is untouched");
    assert.equal(zoneOf(g.engine, g.id("dw")), "discard");
  }
});

clause(DRYWALL, "1:rule", "adding 2 damage markers that reach the location's structure destroys it (6 -> 8 of 8, and 7 -> 9 of 8)", () => {
  for (const start of [6, 7]) {
    const g = dwBoard({ mineDamage: start });
    playDw(g, "mine", /add/i);
    assert.equal(zoneOf(g.engine, g.id("mine")), "discard", `${start} + 2 >= structure 8`);
  }
  const justShort = dwBoard({ mineDamage: 5 });
  playDw(justShort, "mine", /add/i);
  assert.equal(zoneOf(justShort.engine, justShort.id("mine")), "play", "control: 7 of 8 survives");
});

clause(DRYWALL, "1:rule", "add 2 to the opponent's location (3 -> 5 of 6) and destroying it works on their side too (4 -> 6 of 6)", () => {
  const g = dwBoard({ theirsDamage: 4 });
  playDw(g, "theirs", /add/i);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

// -- FLIP UP: 3 [G][G] --------------------------------------------------------

const flipDw = (g: DwGame, pick: string | undefined, player: PlayerId = P1): void =>
  rawFlipUp(g.engine, player, g.id("dw"), pick ? { loc: [g.id(pick)] } : {});

clause(DRYWALL, "2:flipUp", "a face-down Drywall flips up for 3 with [G][G], being played like a tactic: it takes its pick, resolves, and ends in the discard pile", () => {
  const g = dwBoard({ dw: "faceDown", greed: 2, rage: 0 });
  assert.equal(ready(g.engine, P1), 3, "setup: the face-down Drywall and two Greed");
  flipDw(g, "mine");
  resolvePendingResponses(g.engine);
  chooseOption(g.engine, /remove/i);
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("mine")), 3, "removed 2 damage markers");
  assert.equal(zoneOf(g.engine, g.id("dw")), "discard");
  assert.equal(ready(g.engine, P1), 0, "all 3 were spent, the Drywall itself among them");
});

clause(DRYWALL, "2:flipUp", "the flipped-up tactic still has its extra cost and both options: the opponent's location can be picked and 2 markers added", () => {
  const g = dwBoard({ dw: "faceDown", greed: 2 });
  refused(() => flipDw(g, undefined), "FLIP UP still needs the location pick");
  refused(() => flipDw(g, "foe"), "a character is not a location");
  assert.equal(g.engine.state.cards[g.id("dw")].faceDown, true);
  assert.equal(ready(g.engine, P1), 3, "nothing was paid by the refusals");
  flipDw(g, "theirs");
  resolvePendingResponses(g.engine);
  chooseOption(g.engine, /add/i);
  assert.equal(damageOf(g.engine, g.id("theirs")), 5);
});

clause(DRYWALL, "2:flipUp", "pays exactly 3 and no more: with 2 Greed, 3 Rage and the face-down card itself, 2 resources stay ready (3 paid, and the Drywall left the pool)", () => {
  const g = dwBoard({ dw: "faceDown", greed: 2, rage: 3 });
  assert.equal(ready(g.engine, P1), 6);
  flipDw(g, "mine");
  resolvePendingResponses(g.engine);
  chooseOption(g.engine, /remove/i);
  assert.equal(ready(g.engine, P1), 2);
});

clause(DRYWALL, "2:flipUp", "is refused when short or without [G][G]: itself plus one Greed (2), itself plus two Rage and one Greed (one [G]), and no Greed at all", () => {
  const short = dwBoard({ dw: "faceDown", greed: 1 });
  refused(() => flipDw(short, "mine"), "2 resources for 3");
  assert.equal(short.engine.state.cards[short.id("dw")].faceDown, true);
  assert.equal(ready(short.engine, P1), 2);
  const oneG = dwBoard({ dw: "faceDown", greed: 1, rage: 4 });
  refused(() => flipDw(oneG, "mine"), "one [G] among six resources is not [G][G]");
  assert.equal(oneG.engine.state.cards[oneG.id("dw")].faceDown, true);
  assert.equal(ready(oneG.engine, P1), 6);
  const none = dwBoard({ dw: "faceDown", greed: 0, rage: 6 });
  refused(() => flipDw(none, "mine"), "no [G]");
  assert.equal(none.engine.state.cards[none.id("dw")].faceDown, true);
  assert.equal(damageOf(none.engine, none.id("mine")), 5, "nothing happened to the location");
});

clause(DRYWALL, "2:flipUp", "FLIP UP does not change when a tactic can be played: refused on the opponent's turn outside a response window, allowed in response to their attack", () => {
  const g = dwBoard({
    dw: "faceDown",
    greed: 2,
    active: P2,
    extra: []
  });
  refused(() => flipDw(g, "mine"), "nothing to respond to yet");
  assert.equal(g.engine.state.cards[g.id("dw")].faceDown, true);
  assert.equal(ready(g.engine, P1), 3, "nothing was paid");
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("foe")], target: { type: "faction", playerId: P1 } });
  g.engine.perform({ type: "passPriority", playerId: P2 });
  flipDw(g, "mine");
  resolvePendingResponses(g.engine);
  chooseOption(g.engine, /remove/i);
  assert.equal(damageOf(g.engine, g.id("mine")), 3, "flipped up in response to the attack");
});

clause(DRYWALL, "2:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const theirs = dwBoard({ dw: "faceDown", greed: 2, extra: bank("greed", 3, P2) });
  refused(() => flipDw(theirs, "mine", P2), "the opponent cannot flip my Drywall");
  assert.equal(theirs.engine.state.cards[theirs.id("dw")].faceDown, true);
  const inHand = dwBoard({ dw: "hand", greed: 3 });
  refused(() => flipDw(inHand, "mine"), "in the hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("dw")), "hand");
});

clause(DRYWALL, "2:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a), so the opponent may respond before it resolves", () => {
  const g = dwBoard({ dw: "faceDown", greed: 2 });
  holdFlipUp(() => flipDw(g, "mine"));
  assert.ok(g.engine.state.responseWindow, "a response window is open once the cost and pick are paid");
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(damageOf(g.engine, g.id("mine")), 5, "the effect has not happened yet");
});

// ============================================================================
// Canny Bailiff -- an opponent's tactic being deployed has numeric cost at least 3
// ============================================================================

interface BailiffOpts {
  bailiff?: "play" | "faceDown" | "hand" | "discard";
  bailiffController?: PlayerId;
  second?: boolean;
  oppBanks?: number;
  myBanks?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

function bailiffBoard(o: BailiffOpts = {}) {
  const active = o.active ?? P2;
  const where = o.bailiff ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      {
        key: "bailiff",
        def: printing(BAILIFF),
        owner: P1,
        zone: where === "faceDown" ? "play" : where,
        ...(o.bailiffController ? { controller: o.bailiffController } : {}),
        ...(where === "faceDown" ? { faceDown: true } : {})
      },
      ...(o.second ? [{ key: "bailiff2", def: printing(BAILIFF), owner: P1, zone: "play" as const }] : []),
      ...[0, 1, 2, 3, 5].map(n => ({ key: `opp${n}`, def: tactic({ name: `Opp Tactic ${n}`, cost: n }), owner: P2, zone: "hand" as const })),
      ...[0, 1, 2, 3, 5].map(n => ({ key: `my${n}`, def: tactic({ name: `My Tactic ${n}`, cost: n }), owner: P1, zone: "hand" as const })),
      { key: "oppChar", def: character({ name: "Opp Char", cost: 1 }), owner: P2, zone: "hand" },
      { key: "oppItem", def: item({ name: "Opp Item", cost: 1 }), owner: P2, zone: "hand" },
      { key: "victim", def: character({ name: "Victim" }), owner: P1, zone: "play" },
      { key: "myVictim", def: character({ name: "My Victim" }), owner: P2, zone: "play" },
      ...bank("rage", o.oppBanks ?? 6, P2),
      ...bank("rage", o.myBanks ?? 6, P1),
      ...(o.extra ?? [])
    ]
  });
}
type BailiffGame = ReturnType<typeof bailiffBoard>;

const costOf = (g: BailiffGame, player: PlayerId, key: string): number | undefined => g.engine.getCardPlayability(player, g.id(key)).numericCost;

clause(BAILIFF, "0:rule", "an opponent's tactic with a numeric cost below 3 is raised to 3 (costs 0, 1 and 2), and one costing exactly 3 or more is left alone (3 and 5)", () => {
  const g = bailiffBoard();
  assert.equal(costOf(g, P2, "opp0"), 3);
  assert.equal(costOf(g, P2, "opp1"), 3);
  assert.equal(costOf(g, P2, "opp2"), 3);
  assert.equal(costOf(g, P2, "opp3"), 3);
  assert.equal(costOf(g, P2, "opp5"), 5, "increased TO a minimum of 3, never reduced");
});

clause(BAILIFF, "0:rule", "the raised cost is really paid: a cost-1 opposing tactic spends 3 resources, and cannot be played with only 2", () => {
  const mk = () => killTactic({ name: "Kill1", cost: 1 });
  const two = bailiffBoard({ oppBanks: 2, extra: [{ key: "k", def: mk(), owner: P2, zone: "hand" }] });
  refused(() => play(two.engine, P2, two.id("k"), { selected: { t: [two.id("victim")] } }), "2 resources for a minimum cost of 3");
  assert.equal(zoneOf(two.engine, two.id("k")), "hand");
  assert.equal(ready(two.engine, P2), 2, "nothing was paid");
  assert.equal(zoneOf(two.engine, two.id("victim")), "play");
  const three = bailiffBoard({ oppBanks: 5, extra: [{ key: "k", def: mk(), owner: P2, zone: "hand" }] });
  play(three.engine, P2, three.id("k"), { selected: { t: [three.id("victim")] } });
  assert.equal(zoneOf(three.engine, three.id("victim")), "discard", "the tactic resolved");
  assert.equal(ready(three.engine, P2), 2, "exactly 3 of 5 were paid");
  const control = bailiffBoard({ bailiff: "discard", oppBanks: 5, extra: [{ key: "k", def: mk(), owner: P2, zone: "hand" }] });
  play(control.engine, P2, control.id("k"), { selected: { t: [control.id("victim")] } });
  assert.equal(ready(control.engine, P2), 4, "control: without the Bailiff it costs 1");
});

clause(BAILIFF, "0:rule", "it applies in response windows too: an opposing cost-1 tactic played in response to my attack costs 3", () => {
  const k = killTactic({ name: "Kill1", cost: 1 });
  const g = bailiffBoard({
    active: P1,
    oppBanks: 3,
    extra: [
      { key: "k", def: k, owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk" }), owner: P1, zone: "play" }
    ]
  });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  play(g.engine, P2, g.id("k"), { selected: { t: [g.id("victim")] } });
  assert.equal(zoneOf(g.engine, g.id("victim")), "discard", "setup: the response resolved");
  assert.equal(ready(g.engine, P2), 0, "it cost 3");
});

clause(BAILIFF, "0:rule", "only tactics are affected: an opponent's cost-1 character and cost-1 item still cost 1", () => {
  const g = bailiffBoard();
  assert.equal(costOf(g, P2, "oppChar"), 1);
  assert.equal(costOf(g, P2, "oppItem"), 1);
  play(g.engine, P2, g.id("oppChar"));
  assert.equal(ready(g.engine, P2), 5, "the character cost 1");
});

clause(BAILIFF, "0:rule", "only an OPPONENT's tactics: the Bailiff's controller's own tactics keep their cost (0, 1, 2)", () => {
  const g = bailiffBoard({ active: P1 });
  assert.equal(costOf(g, P1, "my0"), 0);
  assert.equal(costOf(g, P1, "my1"), 1);
  assert.equal(costOf(g, P1, "my2"), 2);
  assert.equal(costOf(g, P1, "my5"), 5);
  const own = bailiffBoard({ active: P1, extra: [{ key: "k", def: killTactic({ name: "MyKill1", cost: 1 }), owner: P1, zone: "hand" }] });
  play(own.engine, P1, own.id("k"), { selected: { t: [own.id("myVictim")] } });
  assert.equal(ready(own.engine, P1), 5, "my own cost-1 tactic cost 1");
});

clause(BAILIFF, "0:rule", "'an opponent' is relative to the Bailiff's controller: a Bailiff P2 controls taxes P1's tactics and not P2's", () => {
  const g = bailiffBoard({ bailiffController: P2, active: P1 });
  assert.equal(costOf(g, P1, "my1"), 3, "P1 is the opponent of the Bailiff's controller");
  assert.equal(costOf(g, P1, "my5"), 5);
  assert.equal(costOf(g, P2, "opp1"), 1, "the Bailiff's own controller is not taxed");
});

clause(BAILIFF, "0:rule", "two Bailiffs do not stack: the minimum is still 3", () => {
  const g = bailiffBoard({ second: true });
  assert.equal(costOf(g, P2, "opp0"), 3);
  assert.equal(costOf(g, P2, "opp1"), 3);
  assert.equal(costOf(g, P2, "opp5"), 5);
});

clause(BAILIFF, "0:rule", "it only works while in play face-up: a face-down Bailiff, one in the hand, and one in the discard pile do nothing", () => {
  for (const where of ["faceDown", "hand", "discard"] as const) {
    const g = bailiffBoard({ bailiff: where });
    assert.equal(costOf(g, P2, "opp1"), 1, `Bailiff ${where}`);
    assert.equal(costOf(g, P2, "opp0"), 0, `Bailiff ${where}`);
  }
  const on = bailiffBoard();
  assert.equal(costOf(on, P2, "opp1"), 3, "control: face-up in play");
});

clause(BAILIFF, "0:rule", "the tax ends when the Bailiff leaves play, and stays off", () => {
  const g = bailiffBoard({
    active: P1,
    extra: [{ key: "k", def: killTactic({ name: "MyKill", cost: 0 }), owner: P1, zone: "hand" }]
  });
  assert.equal(costOf(g, P2, "opp1"), 3, "on");
  play(g.engine, P1, g.id("k"), { selected: { t: [g.id("bailiff")] } });
  assert.equal(zoneOf(g.engine, g.id("bailiff")), "discard", "setup: the Bailiff was destroyed");
  assert.equal(costOf(g, P2, "opp1"), 1, "off");
  assert.equal(costOf(g, P2, "opp0"), 0, "still off");
});

/** P2 flips up a face-down cost-1 tactic (FLIP UP 1 [R]) and returns the resources P2 has left. */
function readyAfterFlippingCheapTactic(bailiff: "play" | "discard"): number {
  const flipper = killTactic({ name: "Flipper", cost: 1, flipUp: { cost: 1, threshold: "r" } } as never);
  const g = bailiffBoard({ bailiff, oppBanks: 6, extra: [{ key: "fl", def: flipper, owner: P2, zone: "play", faceDown: true }] });
  assert.equal(ready(g.engine, P2), 7, "setup: 6 Rage and the face-down tactic");
  rawFlipUp(g.engine, P2, g.id("fl"), { t: [g.id("victim")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("victim")), "discard", "setup: the flipped tactic resolved");
  return ready(g.engine, P2);
}

clause(BAILIFF, "0:rule", "a tactic deployed by FLIP UP is still a tactic being deployed: an opposing cost-1 tactic flipped up for 1 is raised to 3 in total (2 more resources than without the Bailiff)", () => {
  const without = readyAfterFlippingCheapTactic("discard");
  const withBailiff = readyAfterFlippingCheapTactic("play");
  assert.equal(without - withBailiff, 2, "paid 3 in total instead of 1: the Bailiff costs the flipper 2 more resources");
});

// ============================================================================
// Cathedrale de Mau -- UNIQUE CATHEDRAL; damage ward on your locations and your cost-6+ characters
// ============================================================================

const zapTactic = (amount: number, type: "location" | "character", name = "Zap") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

const destroyLocation = () =>
  tactic({
    name: "Raze",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

interface CathOpts {
  cath?: "play" | "faceDown" | "hand" | "discard";
  cathController?: PlayerId;
  active?: PlayerId;
  extra?: CardPlacement[];
  bigLife?: number;
}

function cathBoard(o: CathOpts = {}) {
  const active = o.active ?? P1;
  const where = o.cath ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      {
        key: "cath",
        def: printing(CATH),
        owner: P1,
        zone: where === "faceDown" ? "play" : where,
        ...(o.cathController ? { controller: o.cathController } : {}),
        ...(where === "faceDown" ? { faceDown: true } : {})
      },
      { key: "myLoc", def: location({ name: "My Loc", structure: 6 }), owner: P1, zone: "play" },
      { key: "oppLoc", def: location({ name: "Opp Loc", structure: 6 }), owner: P2, zone: "play" },
      { key: "c5", def: character({ name: "Cost Five", cost: 5, life: o.bigLife ?? 6, strength: 1 }), owner: P1, zone: "play" },
      { key: "c6", def: character({ name: "Cost Six", cost: 6, life: o.bigLife ?? 6, strength: 1 }), owner: P1, zone: "play" },
      { key: "c7", def: character({ name: "Cost Seven", cost: 7, life: o.bigLife ?? 6, strength: 1 }), owner: P1, zone: "play" },
      { key: "oppC6", def: character({ name: "Opp Cost Six", cost: 6, life: o.bigLife ?? 6, strength: 1 }), owner: P2, zone: "play" },
      { key: "oppC1", def: character({ name: "Opp Cost One", cost: 1, life: 6, strength: 1 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}

const withZap = (amount: number, type: "location" | "character", owner: PlayerId = P1): CardPlacement => ({
  key: "zap",
  def: zapTactic(amount, type),
  owner,
  zone: "hand"
});

clause(CATH, "1:rule", "damage to a location you control prompts you: accepting reduces it by 1 (3 damage -> 2 markers) and your faction loses exactly 1 influence", () => {
  const g = cathBoard({ extra: [withZap(3, "location")] });
  const inf = influence(g.engine, P1);
  const oppInf = influence(g.engine, P2);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("myLoc")), 2, "3 reduced by 1");
  assert.equal(influence(g.engine, P1), inf - 1);
  assert.equal(influence(g.engine, P2), oppInf, "the opponent's faction is untouched");
});

clause(CATH, "1:rule", "declining leaves the full damage and costs no influence", () => {
  const g = cathBoard({ extra: [withZap(3, "location")] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("myLoc")), 3);
  assert.equal(influence(g.engine, P1), inf);
});

clause(CATH, "1:rule", "the amount is reduced before the damage is inflicted: a location that would be destroyed by exactly its structure survives with one marker less", () => {
  const g = cathBoard({ extra: [withZap(3, "location"), { key: "frail", def: location({ name: "Frail", structure: 3 }), owner: P1, zone: "play" }] });
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("frail")] } });
  assert.equal(pending(g.engine)?.kind, "mayPay", "the ward prompts before the location is destroyed");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("frail")), "play", "3 damage reduced by 1 is 2 markers on a structure of 3");
  assert.equal(damageOf(g.engine, g.id("frail")), 2);
});

clause(CATH, "1:rule", "1 damage reduced by 1 is nothing: no marker is left, and accepting still costs 1 influence", () => {
  const g = cathBoard({ extra: [withZap(1, "location")] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(damageOf(g.engine, g.id("myLoc")), 0);
  assert.equal(influence(g.engine, P1), inf - 1);
});

clause(CATH, "1:rule", "the Cathedrale is itself a location you control: damage to it is warded too", () => {
  const g = cathBoard({ extra: [withZap(2, "location")] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("cath")] } });
  assert.equal(pending(g.engine)?.kind, "mayPay");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(damageOf(g.engine, g.id("cath")), 1);
  assert.equal(influence(g.engine, P1), inf - 1);
});

clause(CATH, "1:rule", "damage the OPPONENT inflicts to my location is warded too (the damage source does not matter)", () => {
  const g = cathBoard({ active: P2, extra: [withZap(3, "location", P2)] });
  const inf = influence(g.engine, P1);
  play(g.engine, P2, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1, "I am the one asked, not the attacker");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(damageOf(g.engine, g.id("myLoc")), 2);
  assert.equal(influence(g.engine, P1), inf - 1);
});

clause(CATH, "1:rule", "only locations YOU control: damage to the opponent's location does not prompt and is not reduced", () => {
  const g = cathBoard({ extra: [withZap(3, "location")] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("oppLoc")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("oppLoc")), 3);
  assert.equal(influence(g.engine, P1), inf);
});

clause(CATH, "1:rule", "a Cathedrale the opponent controls wards the opponent's locations, not mine", () => {
  const g = cathBoard({ cathController: P2, extra: [withZap(3, "location")] });
  const mine = influence(g.engine, P1);
  const theirs = influence(g.engine, P2);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
  assert.equal(pending(g.engine), undefined, "my location is not warded by their Cathedrale");
  assert.equal(damageOf(g.engine, g.id("myLoc")), 3);
  const g2 = cathBoard({ cathController: P2, extra: [withZap(3, "location")] });
  play(g2.engine, P1, g2.id("zap"), { selected: { t: [g2.id("oppLoc")] } });
  const pc = pending(g2.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P2, "the Cathedrale's controller is asked about their own location");
  answerPending(g2.engine, "mayPay", { pay: true });
  assert.equal(damageOf(g2.engine, g2.id("oppLoc")), 2);
  assert.equal(influence(g2.engine, P2), theirs - 1);
  assert.equal(influence(g2.engine, P1), mine, "the damage dealer's faction is untouched");
});

clause(CATH, "1:rule", "it is a separate reduction per damage event: two instances of damage to my locations each prompt, and each costs 1 influence", () => {
  const g = cathBoard({ extra: [withZap(2, "location"), { key: "zap2", def: zapTactic(2, "location", "Zap Two"), owner: P1, zone: "hand" }] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
  answerPending(g.engine, "mayPay", { pay: true });
  play(g.engine, P1, g.id("zap2"), { selected: { t: [g.id("myLoc")] } });
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("myLoc")), 2, "(2-1) + (2-1)");
  assert.equal(influence(g.engine, P1), inf - 2);
});

clause(CATH, "1:rule", "damage that is not inflicted (0 damage) triggers nothing", () => {
  const g = cathBoard({ extra: [withZap(0, "location")] });
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("myLoc")), 0);
});

clause(CATH, "1:rule", "the location ward does not apply to a character you control (cost 5): no prompt and the damage is dealt in full", () => {
  const g = cathBoard({ extra: [withZap(2, "character")] });
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("c5")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("c5")), 2);
});

clause(CATH, "1:rule", "a face-down Cathedrale, one in the hand and one in the discard pile do nothing", () => {
  for (const where of ["faceDown", "hand", "discard"] as const) {
    const g = cathBoard({ cath: where, extra: [withZap(3, "location")] });
    play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
    assert.equal(pending(g.engine), undefined, `Cathedrale ${where}`);
    assert.equal(damageOf(g.engine, g.id("myLoc")), 3, `Cathedrale ${where}`);
  }
});

clause(CATH, "1:rule", "battle damage to a location you control is reduced too: a location that would be destroyed by the attack survives when the ward is used", () => {
  const atk = character({ name: "Raider", strength: 3, life: 9, speed: 1 });
  const g = cathBoard({
    active: P2,
    extra: [
      { key: "atk", def: atk, owner: P2, zone: "play" },
      { key: "frail", def: location({ name: "Frail", structure: 3 }), owner: P1, zone: "play" }
    ]
  });
  const inf = influence(g.engine, P1);
  const seen: string[] = [];
  fightThrough(g.engine, P2, [g.id("atk")], { type: "card", cardId: g.id("frail") }, [], undefined, pc => {
    seen.push(pc.kind);
    return mayPayAnswer(true)(pc);
  });
  assert.ok(seen.includes("mayPay"), `the ward prompted its controller (prompts seen: ${JSON.stringify(seen)})`);
  assert.equal(zoneOf(g.engine, g.id("frail")), "play", "3 battle damage reduced by 1 leaves 2 markers on a structure of 3");
  assert.equal(damageOf(g.engine, g.id("frail")), 2);
  assert.equal(influence(g.engine, P1), inf - 1);
});

clause(CATH, "2:rule", "damage to a character you control with numeric cost 6 prompts you: accepting reduces it by 1 and your faction loses exactly 1 influence", () => {
  const g = cathBoard({ extra: [withZap(3, "character")] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("c6")] } });
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("c6")), 2, "3 reduced by 1");
  assert.equal(influence(g.engine, P1), inf - 1);
});

clause(CATH, "2:rule", "declining leaves the full damage and costs no influence", () => {
  const g = cathBoard({ extra: [withZap(3, "character")] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("c6")] } });
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("c6")), 3);
  assert.equal(influence(g.engine, P1), inf);
});

clause(CATH, "2:rule", "numeric cost 6 OR GREATER: cost 7 is warded, cost 5 is not (the boundary)", () => {
  const seven = cathBoard({ extra: [withZap(3, "character")] });
  play(seven.engine, P1, seven.id("zap"), { selected: { t: [seven.id("c7")] } });
  assert.equal(pending(seven.engine)?.kind, "mayPay", "cost 7");
  answerPending(seven.engine, "mayPay", { pay: true });
  assert.equal(damageOf(seven.engine, seven.id("c7")), 2);
  const five = cathBoard({ extra: [withZap(3, "character")] });
  const inf = influence(five.engine, P1);
  play(five.engine, P1, five.id("zap"), { selected: { t: [five.id("c5")] } });
  assert.equal(pending(five.engine), undefined, "cost 5 is not warded");
  assert.equal(damageOf(five.engine, five.id("c5")), 3);
  assert.equal(influence(five.engine, P1), inf);
});

clause(CATH, "2:rule", "the amount is reduced before the damage is inflicted: a cost-6 character that would die to exactly its life survives with one damage less", () => {
  const g = cathBoard({ bigLife: 3, extra: [withZap(3, "character")] });
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("c6")] } });
  assert.equal(pending(g.engine)?.kind, "mayPay", "the ward prompts before the character is destroyed");
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(g.engine, g.id("c6")), "play", "3 damage reduced by 1 is 2 on a life of 3");
  assert.equal(damageOf(g.engine, g.id("c6")), 2);
});

clause(CATH, "2:rule", "only characters YOU control: the opponent's cost-6 character is not warded (and neither is a cost-1 one)", () => {
  const g = cathBoard({ extra: [withZap(3, "character")] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("oppC6")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(damageOf(g.engine, g.id("oppC6")), 3);
  assert.equal(influence(g.engine, P1), inf);
});

clause(CATH, "2:rule", "damage the opponent inflicts to my cost-6 character is warded as well", () => {
  const g = cathBoard({ active: P2, extra: [withZap(3, "character", P2)] });
  play(g.engine, P2, g.id("zap"), { selected: { t: [g.id("c6")] } });
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
  answerPending(g.engine, "mayPay", { pay: true });
  assert.equal(damageOf(g.engine, g.id("c6")), 2);
});

clause(CATH, "2:rule", "the two rules do not double up: damage to one of my locations prompts exactly once (the character rule does not also fire)", () => {
  const g = cathBoard({ extra: [withZap(2, "location")] });
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "mayPay");
  answerPending(g.engine, "mayPay", { pay: false });
  assert.equal(pending(g.engine), undefined, "exactly one prompt, not one per rule");
});

clause(CATH, "2:rule", "a face-down Cathedrale, one in the hand and one in the discard pile do nothing for characters either", () => {
  for (const where of ["faceDown", "hand", "discard"] as const) {
    const g = cathBoard({ cath: where, extra: [withZap(3, "character")] });
    play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("c6")] } });
    assert.equal(pending(g.engine), undefined, `Cathedrale ${where}`);
    assert.equal(damageOf(g.engine, g.id("c6")), 3);
  }
});

clause(CATH, "2:rule", "battle damage to a cost-6 character you control is reduced too: a blocker that would die to exactly its life survives when the ward is used", () => {
  const atk = character({ name: "Raider", strength: 3, life: 9, speed: 1 });
  const g = cathBoard({
    active: P2,
    bigLife: 3,
    extra: [{ key: "atk", def: atk, owner: P2, zone: "play" }]
  });
  const inf = influence(g.engine, P1);
  const seen: string[] = [];
  fightThrough(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("c6")], undefined, pc => {
    seen.push(pc.kind);
    return mayPayAnswer(true)(pc);
  });
  assert.ok(seen.includes("mayPay"), `the ward prompted its controller (prompts seen: ${JSON.stringify(seen)})`);
  assert.equal(zoneOf(g.engine, g.id("c6")), "play", "3 battle damage reduced by 1 is 2 on a life of 3");
  assert.equal(influence(g.engine, P1), inf - 1);
});

clause(CATH, "2:rule", "battle damage to a cost-6 character you control that the ward declines is dealt in full", () => {
  const atk = character({ name: "Raider", strength: 2, life: 9, speed: 1 });
  const g = cathBoard({ active: P2, extra: [{ key: "atk", def: atk, owner: P2, zone: "play" }] });
  const inf = influence(g.engine, P1);
  fightThrough(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, [g.id("c6")], undefined, mayPayAnswer(false));
  assert.equal(damageOf(g.engine, g.id("c6")), 2);
  assert.equal(influence(g.engine, P1), inf);
});

clause(CATH, "1:rule", "the wards end when the Cathedrale leaves play, and stay off", () => {
  const g = cathBoard({
    extra: [withZap(3, "location"), { key: "zap2", def: zapTactic(3, "character", "Zap Two"), owner: P1, zone: "hand" }, { key: "razeLoc", def: destroyLocation(), owner: P1, zone: "hand" }]
  });
  play(g.engine, P1, g.id("razeLoc"), { selected: { t: [g.id("cath")] } });
  assert.equal(zoneOf(g.engine, g.id("cath")), "discard", "setup: the Cathedrale was destroyed");
  assert.equal(pending(g.engine), undefined);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("myLoc")] } });
  assert.equal(pending(g.engine), undefined, "location ward is off");
  assert.equal(damageOf(g.engine, g.id("myLoc")), 3);
  play(g.engine, P1, g.id("zap2"), { selected: { t: [g.id("c6")] } });
  assert.equal(pending(g.engine), undefined, "character ward is off");
  assert.equal(damageOf(g.engine, g.id("c6")), 3);
});

// -- UNIQUE CATHEDRAL --------------------------------------------------------

function cathUniqueBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cath1", def: printing(CATH), owner: P1, zone: "play" },
      { key: "cath2", def: printing(CATH), owner: P1, zone: "hand" },
      ...bank("greed", 4, P1),
      ...extra
    ]
  });
}

clause(CATH, "0:unique", "controlling a second Cathedrale makes its controller keep one: keeping the new one destroys the old one", () => {
  const g = cathUniqueBoard();
  play(g.engine, P1, g.id("cath2"));
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [g.id("cath1"), g.id("cath2")].sort());
  drain(g.engine, keepOnly(g.id("cath2")));
  assert.equal(zoneOf(g.engine, g.id("cath2")), "play");
  assert.equal(zoneOf(g.engine, g.id("cath1")), "discard");
});

clause(CATH, "0:unique", "keeping the old Cathedrale destroys the new one", () => {
  const g = cathUniqueBoard();
  play(g.engine, P1, g.id("cath2"));
  drain(g.engine, keepOnly(g.id("cath1")));
  assert.equal(zoneOf(g.engine, g.id("cath1")), "play");
  assert.equal(zoneOf(g.engine, g.id("cath2")), "discard");
});

clause(CATH, "0:unique", "the restriction is per player: the opponent may control their own Cathedrale", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "oppCath", def: printing(CATH), owner: P2, zone: "play" },
      { key: "cath2", def: printing(CATH), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  play(g.engine, P1, g.id("cath2"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("cath2")), "play");
  assert.equal(zoneOf(g.engine, g.id("oppCath")), "play");
});

clause(CATH, "0:unique", "a card with a different UNIQUE designation (Akashic Coin) is not a duplicate", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "coin", def: printing(COIN), owner: P1, zone: "play" },
      { key: "cath2", def: printing(CATH), owner: P1, zone: "hand" },
      ...bank("greed", 3, P1)
    ]
  });
  play(g.engine, P1, g.id("cath2"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("coin")), "play");
  assert.equal(zoneOf(g.engine, g.id("cath2")), "play");
});

// ============================================================================
// Crematory Cache -- when a character is destroyed, you may gain 1 influence
// ============================================================================

interface CacheOpts {
  cache?: "play" | "faceDown" | "hand" | "discard";
  second?: boolean;
  active?: PlayerId;
  extra?: CardPlacement[];
}

const destroyTactic = (type: "character" | "item" | "location", name = "Destroyer") =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "d",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

function cacheBoard(o: CacheOpts = {}) {
  const active = o.active ?? P1;
  const where = o.cache ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "cache", def: printing(CACHE), owner: P1, zone: where === "faceDown" ? "play" : where, ...(where === "faceDown" ? { faceDown: true } : {}) },
      ...(o.second ? [{ key: "cache2", def: printing(CACHE), owner: P1, zone: "play" as const }] : []),
      { key: "kill", def: killTactic({ name: "Kill" }), owner: P1, zone: "hand" },
      { key: "oppKill", def: killTactic({ name: "Opp Kill" }), owner: P2, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", life: 3 }), owner: P1, zone: "play" },
      { key: "wall", def: item({ name: "Wall" }), owner: P2, zone: "play" },
      { key: "hall", def: location({ name: "Hall", structure: 3 }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ]
  });
}
type CacheGame = ReturnType<typeof cacheBoard>;

const gainAnswer = (gain: boolean) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: optionIndex(pc, gain ? /gain/i : /decline/i) } : declineAll(pc);

clause(CACHE, "0:rule", "when an opponent's character is destroyed you may gain 1 influence: accepting gains exactly 1", () => {
  const g = cacheBoard();
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "setup: destroyed");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1);
  assert.equal(optionLabels(pc!).length, 2, "gain or decline");
  drain(g.engine, gainAnswer(true));
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P1), inf + 1);
});

clause(CACHE, "0:rule", "declining gains nothing", () => {
  const g = cacheBoard();
  const inf = influence(g.engine, P1);
  const oppInf = influence(g.engine, P2);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
  drain(g.engine, gainAnswer(false));
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P1), inf);
  assert.equal(influence(g.engine, P2), oppInf);
});

clause(CACHE, "0:rule", "any character counts: one of my own that is destroyed also lets me gain 1", () => {
  const g = cacheBoard();
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ally")] } });
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  drain(g.engine, gainAnswer(true));
  assert.equal(influence(g.engine, P1), inf + 1);
});

clause(CACHE, "0:rule", "'you' is the Cache's controller whoever destroyed the character: when the opponent destroys their own character, I am asked and they gain nothing", () => {
  const g = cacheBoard({ active: P2 });
  const mine = influence(g.engine, P1);
  const theirs = influence(g.engine, P2);
  play(g.engine, P2, g.id("oppKill"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1, "the Cache's controller decides");
  drain(g.engine, gainAnswer(true));
  assert.equal(influence(g.engine, P1), mine + 1);
  assert.equal(influence(g.engine, P2), theirs, "the destroyer gains nothing");
});

clause(CACHE, "0:rule", "a character destroyed by damage (state-based) triggers it as well", () => {
  const g = cacheBoard({ extra: [{ key: "zap", def: zapTactic(3, "character"), owner: P1, zone: "hand" }] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "setup: 3 damage on a life of 3");
  drain(g.engine, gainAnswer(true));
  assert.equal(influence(g.engine, P1), inf + 1);
});

clause(CACHE, "0:rule", "characters destroyed in battle trigger it once each: two characters dying in one fight offer two gains", () => {
  const a = character({ name: "Duelist A", strength: 5, life: 2, speed: 1 });
  const b = character({ name: "Duelist B", strength: 5, life: 2, speed: 1 });
  const g = cacheBoard({
    extra: [
      { key: "duelA", def: a, owner: P1, zone: "play" },
      { key: "duelB", def: b, owner: P2, zone: "play" }
    ]
  });
  const inf = influence(g.engine, P1);
  fightThrough(g.engine, P1, [g.id("duelA")], { type: "faction", playerId: P2 }, [g.id("duelB")], undefined, pc =>
    pc.kind === "orderTriggers" ? declineAll(pc) : gainAnswer(true)(pc)
  );
  assert.equal(zoneOf(g.engine, g.id("duelA")), "discard");
  assert.equal(zoneOf(g.engine, g.id("duelB")), "discard");
  assert.equal(influence(g.engine, P1), inf + 2, "one gain per destroyed character");
});

clause(CACHE, "0:rule", "two Crematory Caches both trigger: each offers its controller 1 influence", () => {
  const g = cacheBoard({ second: true });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
  drain(g.engine, pc => (pc.kind === "chooserSelectsOption" ? gainAnswer(true)(pc) : declineAll(pc)));
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P1), inf + 2);
});

clause(CACHE, "0:rule", "only characters: destroying an item or a location does not trigger it", () => {
  const g = cacheBoard({
    extra: [
      { key: "killItem", def: destroyTactic("item", "Destroy Item"), owner: P1, zone: "hand" },
      { key: "killLoc", def: destroyTactic("location", "Destroy Location"), owner: P1, zone: "hand" }
    ]
  });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("killItem"), { selected: { t: [g.id("wall")] } });
  assert.equal(zoneOf(g.engine, g.id("wall")), "discard", "setup: the item was destroyed");
  assert.equal(pending(g.engine), undefined, "no prompt for an item");
  play(g.engine, P1, g.id("killLoc"), { selected: { t: [g.id("hall")] } });
  assert.equal(zoneOf(g.engine, g.id("hall")), "discard", "setup: the location was destroyed");
  assert.equal(pending(g.engine), undefined, "no prompt for a location");
  assert.equal(influence(g.engine, P1), inf);
});

clause(CACHE, "0:rule", "a character that leaves play without being destroyed (returned to its owner's hand) does not trigger it", () => {
  const g = cacheBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "hand", "setup: bounced, not destroyed");
  assert.equal(pending(g.engine), undefined);
  assert.equal(influence(g.engine, P1), inf);
});

clause(CACHE, "0:rule", "a face-down Cache, one in the hand and one in the discard pile do nothing", () => {
  for (const where of ["faceDown", "hand", "discard"] as const) {
    const g = cacheBoard({ cache: where });
    const inf = influence(g.engine, P1);
    play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
    assert.equal(zoneOf(g.engine, g.id("foe")), "discard", `Cache ${where}: setup`);
    assert.equal(pending(g.engine), undefined, `Cache ${where}`);
    assert.equal(influence(g.engine, P1), inf);
  }
});

clause(CACHE, "0:rule", "it fires again for the next destroyed character: two kills in a row offer a gain each", () => {
  const g = cacheBoard({ extra: [{ key: "kill2", def: killTactic({ name: "Kill Two" }), owner: P1, zone: "hand" }] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
  drain(g.engine, gainAnswer(true));
  play(g.engine, P1, g.id("kill2"), { selected: { t: [g.id("ally")] } });
  drain(g.engine, gainAnswer(true));
  assert.equal(influence(g.engine, P1), inf + 2);
});

clause(CACHE, "0:rule", "it stops when the Cache leaves play, and stays off", () => {
  const g = cacheBoard({ extra: [{ key: "razeItem", def: destroyTactic("item", "Raze Item"), owner: P1, zone: "hand" }, { key: "kill2", def: killTactic({ name: "Kill Two" }), owner: P1, zone: "hand" }] });
  const inf = influence(g.engine, P1);
  play(g.engine, P1, g.id("razeItem"), { selected: { t: [g.id("cache")] } });
  assert.equal(zoneOf(g.engine, g.id("cache")), "discard", "setup: the Cache was destroyed");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "setup: a character died");
  assert.equal(pending(g.engine), undefined);
  play(g.engine, P1, g.id("kill2"), { selected: { t: [g.id("ally")] } });
  assert.equal(pending(g.engine), undefined, "still off");
  assert.equal(influence(g.engine, P1), inf);
});
