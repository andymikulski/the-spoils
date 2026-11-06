// Clause tests — batch shade-of-the-devoured-emperor-07, part p2 (groups 9-13, missing clauses only).
// Expectations come from each card's PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
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
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { declareAttackOpenWindow, fight, playRaw } from "./_battle.js";
import { answerPending, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { developResource, endTurn } from "./_turn.js";

/** Two-player board with the generic Develop/Restore-capable factions. */
function duo(cards: CardPlacement[], opts: { turn?: number; active?: PlayerId; influence?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), ...(opts.influence !== undefined ? { influence: opts.influence } : {}) },
    playerB: { faction: developFaction(), ...(opts.influence !== undefined ? { influence: opts.influence } : {}) },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    cards
  });
}

const chr = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => character({ name, strength: 2, life: 5, speed: 2, ...over });
const dmg = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const ready = readyResources;

type Opt = { label?: string };
/** Answers the open `chooserSelectsOption` with the option whose label matches `re`. */
function pickOption(engine: SpoilsEngine, re: RegExp): void {
  const pc = pending(engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  const labels = (pc.options as Opt[]).map((o) => o.label ?? "");
  const index = labels.findIndex((l) => re.test(l));
  assert.ok(index >= 0, `an option matching ${re} (${labels.join(" / ")})`);
  answerPending(engine, "chooserSelectsOption", { index });
}
const optionLabels = (engine: SpoilsEngine): string[] => ((pending(engine)?.options as Opt[] | undefined) ?? []).map((o) => o.label ?? "");

// =====================================================================================
// Duelist of Surfeit — character (fighter), warlord, cost 3, [R], 1 / 3 / 1
// If a card that provides at least [R] enters play under your control, you may put a token on this card.
// This card gains 1 strength and 1 life for each token on it.
// =====================================================================================

const DUELIST = "d1e9f12e-abc7-4768-9155-2eb23f0def8c";

const rageRes = (name: string, provides: Array<"rage" | "greed"> = ["rage"]): CardDefinition =>
  resourceCard({ name, resource: { provides, staple: true } as never });
/** A non-resource item that provides `provides` while in play (cost 0). */
const providerItem = (name: string, provides: Array<"rage" | "greed">): CardDefinition => item({ name, resource: { provides } as never });

function duelistBoard(opts: { zone?: "play" | "hand"; tokens?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "du", def: printing(DUELIST), owner: P1, zone: opts.zone ?? "play", counters: opts.tokens ? { token: opts.tokens } : {} },
      { key: "by", def: chr("Bystander"), owner: P1, zone: "play" },
      { key: "r1", def: rageRes("Rage One"), owner: P1, zone: "hand" },
      { key: "r2", def: rageRes("Rage Two"), owner: P1, zone: "hand" },
      { key: "rr", def: rageRes("Double Rage", ["rage", "rage"]), owner: P1, zone: "hand" },
      { key: "g1", def: rageRes("Greed One", ["greed"]), owner: P1, zone: "hand" },
      { key: "pi", def: providerItem("Rage Totem", ["rage"]), owner: P1, zone: "hand" },
      { key: "pi2", def: providerItem("Rage Totem Two", ["rage"]), owner: P1, zone: "hand" },
      { key: "gi", def: providerItem("Greed Totem", ["greed"]), owner: P1, zone: "hand" },
      { key: "plain", def: item({ name: "Plain Item" }), owner: P1, zone: "hand" },
      { key: "or1", def: rageRes("Their Rage"), owner: P2, zone: "hand" },
      { key: "opi", def: providerItem("Their Totem", ["rage"]), owner: P2, zone: "hand" },
      ...(opts.extra ?? [])
    ],
    { active: opts.active ?? P1 }
  );
}

clause(DUELIST, "0:rule", "a face-up [R] resource entering play under your control offers you a token: accepting puts exactly one token on the Duelist and none on anything else", () => {
  const { engine, id } = duelistBoard();
  assert.equal(tokensOn(engine, id("du")), 0);
  developResource(engine, P1, id("r1"), false);
  assert.equal(zoneOf(engine, id("r1")), "play", "the resource really entered play");
  const pc = pending(engine);
  assert.ok(pc, "the Duelist asks");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "its controller decides");
  assert.equal(optionLabels(engine).length, 2, `accept / decline (${optionLabels(engine).join(" / ")})`);
  pickOption(engine, /token/i);
  assert.equal(pending(engine), undefined, "one prompt, one answer: no second token prompt");
  assert.equal(tokensOn(engine, id("du")), 1);
  assert.equal(tokensOn(engine, id("by")), 0, "the token goes on the Duelist, not another card");
});

clause(DUELIST, "0:rule", "\"you may\": declining puts no token on the Duelist", () => {
  const { engine, id } = duelistBoard();
  developResource(engine, P1, id("r1"), false);
  assert.ok(pending(engine), "control: the Duelist asks");
  pickOption(engine, /decline|no\b|skip/i);
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 0);
  assert.equal(zoneOf(engine, id("r1")), "play", "declining does not undo the resource play");
});

clause(DUELIST, "0:rule", "a card providing two [R] provides \"at least [R]\" and offers a token", () => {
  const { engine, id } = duelistBoard();
  developResource(engine, P1, id("rr"), false);
  pickOption(engine, /token/i);
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 1);
});

clause(DUELIST, "0:rule", "a face-up resource providing only [G] is not an [R] provider: no prompt, no token", () => {
  const ctl = duelistBoard();
  developResource(ctl.engine, P1, ctl.id("r1"), false);
  assert.ok(pending(ctl.engine), "control: an [R] resource does prompt");
  const { engine, id } = duelistBoard();
  developResource(engine, P1, id("g1"), false);
  assert.equal(zoneOf(engine, id("g1")), "play");
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 0);
});

clause(DUELIST, "0:rule", "a face-down card provides Volition, not [R]: a rage resource played face-down gives no token", () => {
  const { engine, id } = duelistBoard();
  developResource(engine, P1, id("r1"), true);
  assert.equal(zoneOf(engine, id("r1")), "play");
  assert.equal(engine.state.cards[id("r1")].faceDown, true);
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 0);
});

clause(DUELIST, "0:rule", "a card entering play under the opponent's control does not trigger it, even a rage resource", () => {
  const { engine, id } = duelistBoard({ active: P2 });
  developResource(engine, P2, id("or1"), false);
  assert.equal(zoneOf(engine, id("or1")), "play", "the opponent's rage resource entered play");
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 0);
});

clause(DUELIST, "0:rule", "any card that provides [R] counts, not only resource cards: a deployed [R]-providing item offers a token", () => {
  const { engine, id } = duelistBoard();
  play(engine, P1, id("pi"));
  assert.equal(zoneOf(engine, id("pi")), "play");
  pickOption(engine, /token/i);
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 1);
});

clause(DUELIST, "0:rule", "near misses: a deployed item that provides only [G], and one that provides nothing, offer no token", () => {
  const { engine, id } = duelistBoard();
  play(engine, P1, id("gi"));
  assert.equal(zoneOf(engine, id("gi")), "play");
  assert.equal(pending(engine), undefined);
  play(engine, P1, id("plain"));
  assert.equal(zoneOf(engine, id("plain")), "play");
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 0);
});

clause(DUELIST, "0:rule", "an [R]-providing item the opponent deploys does not trigger it", () => {
  const { engine, id } = duelistBoard({ active: P2 });
  play(engine, P2, id("opi"));
  assert.equal(zoneOf(engine, id("opi")), "play");
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 0);
});

clause(DUELIST, "0:rule", "each qualifying card gives its own chance: two [R] items accepted put two tokens", () => {
  const { engine, id } = duelistBoard();
  play(engine, P1, id("pi"));
  pickOption(engine, /token/i);
  play(engine, P1, id("pi2"));
  pickOption(engine, /token/i);
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 2);
});

clause(DUELIST, "0:rule", "a Duelist that is not in play does not trigger (in hand)", () => {
  const { engine, id } = duelistBoard({ zone: "hand" });
  developResource(engine, P1, id("r1"), false);
  assert.equal(zoneOf(engine, id("r1")), "play");
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("du")), 0);
});

clause(DUELIST, "0:rule", "a Duelist in play deployed at its printed cost 3 with [R]: refused one short and without [R]", () => {
  const ok = duo([{ key: "du", def: printing(DUELIST), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)]);
  const short = duo([{ key: "du", def: printing(DUELIST), owner: P1, zone: "hand" }, ...bank("rage", 2, P1)]);
  const noRage = duo([{ key: "du", def: printing(DUELIST), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]);
  play(ok.engine, P1, ok.id("du"));
  assert.equal(zoneOf(ok.engine, ok.id("du")), "play");
  assert.equal(ready(ok.engine, P1), 0, "3 paid");
  refused(() => play(short.engine, P1, short.id("du")), "cost 3 with 2 resources");
  assert.equal(zoneOf(short.engine, short.id("du")), "hand");
  refused(() => play(noRage.engine, P1, noRage.id("du")), "threshold [R] missing", /threshold/i);
  assert.equal(zoneOf(noRage.engine, noRage.id("du")), "hand");
});

/** The printed type line of a card in a board: card type, trade and subtypes. */
const identity = (b: ReturnType<typeof duo>, key: string, type: string, trade: string, subtype: string[]): void => {
  const def = b.engine.getDefinition(b.id(key));
  assert.equal(def.type, type, `${key}: printed type`);
  assert.equal(def.trade, trade, `${key}: printed trade`);
  assert.deepEqual([...(def.subtype ?? [])], subtype, `${key}: printed subtypes`);
};

clause(DUELIST, "0:rule", "printed type line: a warlord fighter character 1 / 3 / 1; one [R] among three resources is enough for the [R] threshold", () => {
  const b = duo([{ key: "du", def: printing(DUELIST), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 2, P1)]);
  identity(b, "du", "character", "warlord", ["fighter"]);
  play(b.engine, P1, b.id("du"));
  assert.equal(zoneOf(b.engine, b.id("du")), "play", "deployed with a single [R]");
  assert.equal(ready(b.engine, P1), 0, "printed cost 3 paid");
  assert.deepEqual(["strength", "speed", "life"].map((s) => b.engine.getStat(b.id("du"), s as "strength")), [1, 3, 1], "printed 1 / 3 / 1");
});

// --- 1:rule: +1 strength and +1 life per token ---------------------------------------

for (const n of [0, 1, 3, 5]) {
  clause(DUELIST, "1:rule", `with ${n} token(s) it is ${1 + n} strength / ${1 + n} life (printed 1/1), speed untouched at 3`, () => {
    const { engine, id } = duelistBoard({ tokens: n });
    assert.equal(engine.getStat(id("du"), "strength"), 1 + n);
    assert.equal(engine.getStat(id("du"), "life"), 1 + n);
    assert.equal(engine.getStat(id("du"), "speed"), 3);
  });
}

clause(DUELIST, "1:rule", "the bonus follows the token count live: removing tokens lowers it again", () => {
  const { engine, id } = duelistBoard({ tokens: 3 });
  assert.equal(engine.getStat(id("du"), "strength"), 4);
  engine.state.cards[id("du")].counters.token = 1;
  assert.equal(engine.getStat(id("du"), "strength"), 2);
  assert.equal(engine.getStat(id("du"), "life"), 2);
  engine.state.cards[id("du")].counters.token = 0;
  assert.equal(engine.getStat(id("du"), "strength"), 1);
  assert.equal(engine.getStat(id("du"), "life"), 1);
});

clause(DUELIST, "1:rule", "only its own tokens count: tokens on other cards (even another Duelist) and non-token counters do not", () => {
  const { engine, id } = duelistBoard({
    extra: [
      { key: "du2", def: printing(DUELIST), owner: P1, zone: "play", counters: { token: 4 } },
      { key: "du3", def: printing(DUELIST), owner: P1, zone: "play", counters: { other: 2 } }
    ]
  });
  engine.state.cards[id("by")].counters.token = 3;
  assert.equal(engine.getStat(id("du"), "strength"), 1);
  assert.equal(engine.getStat(id("du"), "life"), 1);
  assert.equal(engine.getStat(id("du2"), "strength"), 5, "control: its own 4 tokens count");
  assert.equal(engine.getStat(id("du3"), "strength"), 1, "a non-token counter is not a token");
  assert.equal(engine.getStat(id("du3"), "life"), 1);
});

clause(DUELIST, "1:rule", "in a battle the life bonus keeps it alive and the strength bonus kills: 2 tokens (3/3) blocks a 2/3 attacker and wins; with no tokens (1/1) it dies and barely scratches", () => {
  const fed = duo(
    [
      { key: "du", def: printing(DUELIST), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "atk", def: chr("Attacker", { strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" }
    ],
    { active: P2 }
  );
  fight(fed.engine, P2, [fed.id("atk")], { type: "faction", playerId: P1 }, [fed.id("du")]);
  assert.equal(zoneOf(fed.engine, fed.id("du")), "play", "3 life takes 2 damage");
  assert.equal(dmg(fed.engine, fed.id("du")), 2);
  assert.equal(zoneOf(fed.engine, fed.id("atk")), "discard", "3 strength kills the 3-life attacker");
  const bare = duo(
    [
      { key: "du", def: printing(DUELIST), owner: P1, zone: "play" },
      { key: "atk", def: chr("Attacker", { strength: 2, life: 3, speed: 3 }), owner: P2, zone: "play" }
    ],
    { active: P2 }
  );
  fight(bare.engine, P2, [bare.id("atk")], { type: "faction", playerId: P1 }, [bare.id("du")]);
  assert.equal(zoneOf(bare.engine, bare.id("du")), "discard", "1 life takes 2 damage");
  assert.equal(zoneOf(bare.engine, bare.id("atk")), "play");
  assert.equal(dmg(bare.engine, bare.id("atk")), 1, "1 strength deals 1");
});

// =====================================================================================
// Juice Closet — item, warlord, cost 2, [R]
// At the start of your turn you may pick a character. If you do, that character gains 1 strength this turn.
// =====================================================================================

const CLOSET = "f3e623c0-c080-4744-9599-eb4134c83662";

function closetBoard(opts: { zone?: "play" | "hand"; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "jc", def: printing(CLOSET), owner: P1, zone: opts.zone ?? "play" },
      { key: "c1", def: chr("Mine", { strength: 2 }), owner: P1, zone: "play" },
      { key: "o1", def: chr("Theirs", { strength: 2 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "Some Item" }), owner: P1, zone: "play" },
      { key: "lo", def: location({ name: "Some Place" }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ],
    { active: opts.active ?? P2 }
  );
}
const pickCh = (engine: SpoilsEngine, ids: CardInstanceId[]): void => answerPending(engine, "selectTargets", { selected: { ch: ids } });

clause(CLOSET, "0:rule", "printed type line: a warlord item with no subtype; one [R] among two resources is enough for the [R] threshold", () => {
  const b = duo([{ key: "jc", def: printing(CLOSET), owner: P1, zone: "hand" }, ...bank("rage", 1, P1), ...bank("greed", 1, P1)]);
  identity(b, "jc", "item", "warlord", []);
  play(b.engine, P1, b.id("jc"));
  assert.equal(zoneOf(b.engine, b.id("jc")), "play", "deployed with a single [R]");
  assert.equal(ready(b.engine, P1), 0, "printed cost 2 paid");
});

clause(CLOSET, "0:rule", "at the start of YOUR turn you may pick a character: it gains exactly 1 strength this turn (yours), nothing else changes", () => {
  const { engine, id } = closetBoard();
  assert.equal(pending(engine), undefined);
  endTurn(engine, P2);
  const pc = pending(engine);
  assert.ok(pc, "the Closet asks at the start of P1's turn");
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P1);
  pickCh(engine, [id("c1")]);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.getStat(id("c1"), "strength"), 3, "2 + 1");
  assert.equal(engine.getStat(id("o1"), "strength"), 2, "the other character is untouched");
  assert.equal(engine.getStat(id("c1"), "life"), 5);
  assert.equal(engine.getStat(id("c1"), "speed"), 2);
});

clause(CLOSET, "0:rule", "the pick may be any character, including the opponent's", () => {
  const { engine, id } = closetBoard();
  endTurn(engine, P2);
  pickCh(engine, [id("o1")]);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.getStat(id("o1"), "strength"), 3);
  assert.equal(engine.getStat(id("c1"), "strength"), 2);
});

clause(CLOSET, "0:rule", "\"you may\": picking nobody gives nobody strength", () => {
  const { engine, id } = closetBoard();
  endTurn(engine, P2);
  assert.ok(pending(engine), "control: it asks");
  pickCh(engine, []);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.getStat(id("c1"), "strength"), 2);
  assert.equal(engine.getStat(id("o1"), "strength"), 2);
});

clause(CLOSET, "0:rule", "only a character can be picked: an item, a location and a faction are refused; it is exactly one", () => {
  const { engine, id } = closetBoard();
  endTurn(engine, P2);
  refused(() => pickCh(engine, [id("it")]), "an item is not a character");
  refused(() => pickCh(engine, [id("lo")]), "a location is not a character");
  refused(() => pickCh(engine, [engine.state.players[P2].factionId!]), "a faction is not a character");
  refused(() => pickCh(engine, [id("c1"), id("o1")]), "pick a character: only one");
  assert.ok(pending(engine), "still waiting for a legal pick");
  pickCh(engine, [id("c1")]);
  assert.equal(engine.getStat(id("c1"), "strength"), 3, "control: a character works");
  assert.equal(engine.getStat(id("o1"), "strength"), 2);
});

clause(CLOSET, "0:rule", "\"this turn\": the strength is gone once the turn ends, and the opponent's turn start does not trigger the Closet", () => {
  const { engine, id } = closetBoard();
  endTurn(engine, P2);
  pickCh(engine, [id("c1")]);
  assert.equal(engine.getStat(id("c1"), "strength"), 3);
  endTurn(engine, P1);
  assert.equal(pending(engine), undefined, "the start of the opponent's turn: no prompt");
  assert.equal(engine.getStat(id("c1"), "strength"), 2, "back to the printed 2");
  assert.equal(engine.getStat(id("o1"), "strength"), 2);
});

clause(CLOSET, "0:rule", "it does not trigger at the start of the opponent's turn", () => {
  const { engine, id } = closetBoard({ active: P1 });
  endTurn(engine, P1);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.getStat(id("c1"), "strength"), 2);
  assert.equal(engine.getStat(id("o1"), "strength"), 2);
});

clause(CLOSET, "0:rule", "a Closet that is not in play (in hand) does not trigger", () => {
  const { engine, id } = closetBoard({ zone: "hand" });
  endTurn(engine, P2);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.getStat(id("c1"), "strength"), 2);
});

clause(CLOSET, "0:rule", "two Closets each give +1: the same character picked twice gains 2 strength", () => {
  const { engine, id } = closetBoard({ extra: [{ key: "jc2", def: printing(CLOSET), owner: P1, zone: "play" }] });
  endTurn(engine, P2);
  drain(engine, (pc) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { ch: [id("c1")] } } : declineAll(pc)));
  assert.equal(pending(engine), undefined);
  assert.equal(engine.getStat(id("c1"), "strength"), 4, "2 + 1 + 1");
  assert.equal(engine.getStat(id("o1"), "strength"), 2);
});

clause(CLOSET, "0:rule", "with no character in play the turn start does not lock up", () => {
  const { engine } = duo([{ key: "jc", def: printing(CLOSET), owner: P1, zone: "play" }], { active: P2 });
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
});

clause(CLOSET, "0:rule", "deploys at its printed cost 2 with [R]: refused one short and with no [R]", () => {
  const ok = duo([{ key: "jc", def: printing(CLOSET), owner: P1, zone: "hand" }, ...bank("rage", 2, P1)]);
  const short = duo([{ key: "jc", def: printing(CLOSET), owner: P1, zone: "hand" }, ...bank("rage", 1, P1)]);
  const noRage = duo([{ key: "jc", def: printing(CLOSET), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]);
  play(ok.engine, P1, ok.id("jc"));
  assert.equal(zoneOf(ok.engine, ok.id("jc")), "play");
  assert.equal(ready(ok.engine, P1), 0, "2 paid");
  refused(() => play(short.engine, P1, short.id("jc")), "cost 2 with 1 resource");
  assert.equal(zoneOf(short.engine, short.id("jc")), "hand");
  refused(() => play(noRage.engine, P1, noRage.id("jc")), "threshold [R] missing", /threshold/i);
  assert.equal(zoneOf(noRage.engine, noRage.id("jc")), "hand");
});

// =====================================================================================
// Flaming Cube — item, warlord, cost 6, [R][R][R]
// This card enters play with 3 tokens on it.
// At the start of your turn put a token on this card.
// If there are at least 6 tokens on this card, destroy it and each opponents' faction loses 6 influence.
// If there are no tokens on this card destroy it.
// CONTROL THE FLAME! -- COST: Any player may use this ability. Destroy a character or item you control. -- EFFECT: Add or remove a token from this card.
// =====================================================================================

const CUBE = "de91eacd-1b08-4595-a238-f4654e554ab8";

function cubeBoard(opts: { tokens?: number; zone?: "play" | "hand"; active?: PlayerId; controller?: PlayerId; extra?: CardPlacement[]; theirs?: boolean } = {}) {
  return duo(
    [
      {
        key: "cube",
        def: printing(CUBE),
        owner: P1,
        zone: opts.zone ?? "play",
        ...(opts.controller ? { controller: opts.controller } : {}),
        counters: opts.tokens !== undefined ? { token: opts.tokens } : {}
      },
      { key: "c1", def: chr("Mine"), owner: P1, zone: "play" },
      { key: "c2", def: chr("Mine Two"), owner: P1, zone: "play" },
      { key: "i1", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "l1", def: location({ name: "My Place" }), owner: P1, zone: "play" },
      ...(opts.theirs === false
        ? []
        : ([
            { key: "o1", def: chr("Theirs"), owner: P2, zone: "play" },
            { key: "o2", def: chr("Theirs Two"), owner: P2, zone: "play" },
            { key: "oi", def: item({ name: "Their Item" }), owner: P2, zone: "play" }
          ] as CardPlacement[])),
      ...(opts.extra ?? [])
    ],
    { active: opts.active ?? P1, influence: 20 }
  );
}
type CubeBoard = ReturnType<typeof cubeBoard>;

/** `player` uses CONTROL THE FLAME!, destroying `pay`, and picks the add / remove option. */
function control(b: CubeBoard, player: PlayerId, pay: string, which: "add" | "remove"): void {
  activate(b.engine, player, b.id("cube"), "fc-control", { selected: { x: [b.id(pay)] } });
  pickOption(b.engine, which === "add" ? /add/i : /remove/i);
}
/** A one-ability item that puts `amount` tokens on / takes `amount` tokens off the item picked. */
const tokenTool = (name: string, type: "addCounter" | "removeCounter", amount: number): CardDefinition =>
  item({
    name,
    behavior: {
      abilities: [
        {
          id: "tool",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type, target: { type: "selected", id: "t" }, counter: "token", amount }]
        }
      ]
    } as never
  });

// --- 0:rule: enters play with 3 tokens -------------------------------------------------

clause(CUBE, "0:rule", "deployed from hand it enters play with exactly 3 tokens and is not destroyed by them (no influence lost)", () => {
  const { engine, id } = cubeBoard({ zone: "hand", extra: [...bank("rage", 6, P1)] });
  assert.equal(tokensOn(engine, id("cube")), 0);
  play(engine, P1, id("cube"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("cube")), "play");
  assert.equal(tokensOn(engine, id("cube")), 3);
  assert.equal(ready(engine, P1), 0, "its cost 6 was paid");
  assert.equal(influenceOf(engine, P2), 20);
  assert.equal(influenceOf(engine, P1), 20);
});

clause(CUBE, "0:rule", "deploys at its printed cost 6 with [R][R][R]: refused one short, with no [R], and with only two [R]", () => {
  const short = cubeBoard({ zone: "hand", extra: [...bank("rage", 5, P1)] });
  const noRage = cubeBoard({ zone: "hand", extra: [...bank("greed", 6, P1)] });
  const twoRage = cubeBoard({ zone: "hand", extra: [...bank("rage", 2, P1), ...bank("greed", 4, P1)] });
  const mixed = cubeBoard({ zone: "hand", extra: [...bank("rage", 3, P1), ...bank("greed", 3, P1)] });
  refused(() => play(short.engine, P1, short.id("cube")), "cost 6 with 5 resources");
  assert.equal(zoneOf(short.engine, short.id("cube")), "hand");
  refused(() => play(noRage.engine, P1, noRage.id("cube")), "no [R] at all", /threshold/i);
  assert.equal(zoneOf(noRage.engine, noRage.id("cube")), "hand");
  refused(() => play(twoRage.engine, P1, twoRage.id("cube")), "only two of three [R]", /threshold/i);
  assert.equal(zoneOf(twoRage.engine, twoRage.id("cube")), "hand");
  play(mixed.engine, P1, mixed.id("cube"));
  assert.equal(zoneOf(mixed.engine, mixed.id("cube")), "play", "control: three [R] and six resources is enough");
  assert.equal(tokensOn(mixed.engine, mixed.id("cube")), 3);
});

clause(CUBE, "0:rule", "printed type line: a warlord item with no subtype", () => {
  identity(cubeBoard({ zone: "hand" }), "cube", "item", "warlord", []);
});

clause(CUBE, "0:rule", "only when THIS card enters play: another card entering play (a character, an item) puts no tokens on it", () => {
  const { engine, id } = cubeBoard({
    tokens: 2,
    extra: [
      { key: "nc", def: chr("Newcomer", { cost: 0 }), owner: P1, zone: "hand" },
      { key: "ni", def: item({ name: "New Item", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("nc"));
  assert.equal(zoneOf(engine, id("nc")), "play", "the character entered play");
  assert.equal(tokensOn(engine, id("cube")), 2, "no tokens from a character entering");
  play(engine, P1, id("ni"));
  assert.equal(zoneOf(engine, id("ni")), "play", "the item entered play");
  assert.equal(tokensOn(engine, id("cube")), 2, "no tokens from an item entering");
  assert.equal(zoneOf(engine, id("cube")), "play", "the Cube is still in play");
  assert.equal(influenceOf(engine, P2), 20, "no influence lost");
});

// --- 1:rule: a token at the start of your turn -------------------------------------------

clause(CUBE, "1:rule", "at the start of its controller's turn it gets one token, and not at the start of the opponent's turn", () => {
  const { engine, id } = cubeBoard({ tokens: 3, active: P2 });
  endTurn(engine, P2);
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("cube")), 4, "P1's turn started: +1");
  endTurn(engine, P1);
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("cube")), 4, "P2's turn started: no token");
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("cube")), 5, "P1's next turn: +1 again");
  assert.equal(zoneOf(engine, id("cube")), "play");
});

clause(CUBE, "1:rule", "\"your\" is the controller: a Cube owned by P1 but controlled by P2 ticks at P2's turn start, not P1's", () => {
  const { engine, id } = cubeBoard({ tokens: 3, controller: P2, active: P1 });
  endTurn(engine, P1);
  assert.equal(tokensOn(engine, id("cube")), 4, "P2 (controller) turn started");
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("cube")), 4, "P1 (owner, not controller) turn started: no token");
});

// --- 2:rule: at least 6 tokens -----------------------------------------------------------

clause(CUBE, "2:rule", "the sixth token (a turn-start tick) destroys it and ONLY the opponent's faction loses 6 influence", () => {
  const { engine, id } = cubeBoard({ tokens: 5, active: P2 });
  endTurn(engine, P2);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("cube")), "discard");
  assert.equal(influenceOf(engine, P2), 14, "the opponent lost 6");
  assert.equal(influenceOf(engine, P1), 20, "its controller lost nothing");
});

clause(CUBE, "2:rule", "near miss: going from 4 to 5 tokens leaves it in play and costs no influence", () => {
  const { engine, id } = cubeBoard({ tokens: 4, active: P2 });
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("cube")), 5);
  assert.equal(zoneOf(engine, id("cube")), "play");
  assert.equal(influenceOf(engine, P2), 20);
  assert.equal(influenceOf(engine, P1), 20);
});

clause(CUBE, "2:rule", "adding the sixth token with CONTROL THE FLAME! also destroys it and costs the opponent 6 influence", () => {
  const b = cubeBoard({ tokens: 5 });
  control(b, P1, "c1", "add");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("cube")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard", "the cost was paid");
  assert.equal(influenceOf(b.engine, P2), 14);
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(CUBE, "2:rule", "\"at least 6\": jumping from 5 to 8 tokens destroys it and still costs exactly 6 influence", () => {
  const b = cubeBoard({ tokens: 5, extra: [{ key: "tool", def: tokenTool("Token Pump", "addCounter", 3), owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("tool"), "tool", { selected: { t: [b.id("cube")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("cube")), "discard");
  assert.equal(influenceOf(b.engine, P2), 14, "exactly 6, not 8");
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(CUBE, "2:rule", "\"each opponents' faction\" is relative to the Cube's controller: P2 controlling P1's Cube at 5 tokens ticks to 6 and P1 loses the 6", () => {
  const { engine, id } = cubeBoard({ tokens: 5, controller: P2, active: P1 });
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("cube")), "discard");
  assert.equal(influenceOf(engine, P1), 14, "the controller's opponent (P1) lost 6");
  assert.equal(influenceOf(engine, P2), 20, "the controller (P2) did not");
});

clause(CUBE, "2:rule", "an opponent who adds the sixth token via CONTROL THE FLAME! hurts only themselves (the loss is the controller's opponent)", () => {
  const b = cubeBoard({ tokens: 5, active: P2 });
  control(b, P2, "o1", "add");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("cube")), "discard");
  assert.equal(influenceOf(b.engine, P2), 14);
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(CUBE, "2:rule", "a destroyed Cube is a card that left play: its tokens disappear (CR 409.2)", () => {
  const { engine, id } = cubeBoard({ tokens: 5, active: P2 });
  endTurn(engine, P2);
  assert.equal(zoneOf(engine, id("cube")), "discard");
  assert.equal(tokensOn(engine, id("cube")), 0);
});

// --- 3:rule: no tokens -------------------------------------------------------------------

clause(CUBE, "3:rule", "removing its last token with CONTROL THE FLAME! destroys it, with no influence loss", () => {
  const b = cubeBoard({ tokens: 1 });
  control(b, P1, "c1", "remove");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("cube")), "discard");
  assert.equal(influenceOf(b.engine, P2), 20);
  assert.equal(influenceOf(b.engine, P1), 20);
});

clause(CUBE, "3:rule", "near miss: removing a token from 2 leaves it in play with 1", () => {
  const b = cubeBoard({ tokens: 2 });
  control(b, P1, "c1", "remove");
  assert.equal(tokensOn(b.engine, b.id("cube")), 1);
  assert.equal(zoneOf(b.engine, b.id("cube")), "play");
});

clause(CUBE, "3:rule", "taking several tokens off at once down to none (3 -> 0) also destroys it", () => {
  const b = cubeBoard({ tokens: 3, extra: [{ key: "tool", def: tokenTool("Token Scourer", "removeCounter", 5), owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("tool"), "tool", { selected: { t: [b.id("cube")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("cube")), "discard");
  assert.equal(influenceOf(b.engine, P2), 20, "no influence loss");
});

// --- 4:ability fc-control ----------------------------------------------------------------

clause(CUBE, "4:ability:fc-control", "its controller destroys one of their characters as the cost and chooses ADD: +1 token; both options are offered to the user", () => {
  const b = cubeBoard({ tokens: 3 });
  activate(b.engine, P1, b.id("cube"), "fc-control", { selected: { x: [b.id("c1")] } });
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard", "the cost was paid");
  const pc = pending(b.engine);
  assert.ok(pc, "add / remove is offered");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  const labels = optionLabels(b.engine);
  assert.equal(labels.length, 2, labels.join(" / "));
  assert.ok(labels.some((l) => /add/i.test(l)) && labels.some((l) => /remove/i.test(l)), labels.join(" / "));
  pickOption(b.engine, /add/i);
  assert.equal(pending(b.engine), undefined);
  assert.equal(tokensOn(b.engine, b.id("cube")), 4);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play", "only the picked character was destroyed");
});

clause(CUBE, "4:ability:fc-control", "choosing REMOVE takes a token off (3 -> 2)", () => {
  const b = cubeBoard({ tokens: 3 });
  control(b, P1, "c1", "remove");
  assert.equal(tokensOn(b.engine, b.id("cube")), 2);
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("cube")), "play");
});

clause(CUBE, "4:ability:fc-control", "the cost can destroy an item you control instead of a character", () => {
  const b = cubeBoard({ tokens: 3 });
  control(b, P1, "i1", "add");
  assert.equal(zoneOf(b.engine, b.id("i1")), "discard");
  assert.equal(tokensOn(b.engine, b.id("cube")), 4);
  assert.equal(zoneOf(b.engine, b.id("c1")), "play");
});

clause(CUBE, "4:ability:fc-control", "the destroyed card must be a character or item YOU control: the opponent's character and item, your location and a faction are refused", () => {
  const b = cubeBoard({ tokens: 3 });
  const tryPay = (key: string) => activate(b.engine, P1, b.id("cube"), "fc-control", { selected: { x: [b.id(key)] } });
  refused(() => tryPay("o1"), "the opponent's character");
  refused(() => tryPay("oi"), "the opponent's item");
  refused(() => tryPay("l1"), "my own location is neither a character nor an item");
  refused(() => activate(b.engine, P1, b.id("cube"), "fc-control", { selected: { x: [b.engine.state.players[P1].factionId!] } }), "my faction");
  for (const key of ["o1", "oi", "l1", "c1"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} untouched`);
  assert.equal(tokensOn(b.engine, b.id("cube")), 3);
  assert.equal(pending(b.engine), undefined);
  control(b, P1, "c1", "add");
  assert.equal(tokensOn(b.engine, b.id("cube")), 4, "control: my own character works");
});

clause(CUBE, "4:ability:fc-control", "with nothing of yours to destroy the cost cannot be paid: refused, and nothing changes", () => {
  const empty = cubeBoard({ tokens: 3, active: P2, extra: [], theirs: false });
  refused(() => activate(empty.engine, P2, empty.id("cube"), "fc-control", { selected: { x: [empty.id("c1")] } }), "P2 controls no character or item");
  assert.equal(zoneOf(empty.engine, empty.id("c1")), "play");
  assert.equal(tokensOn(empty.engine, empty.id("cube")), 3);
  const funded = cubeBoard({ tokens: 3, active: P2 });
  control(funded, P2, "o2", "add");
  assert.equal(tokensOn(funded.engine, funded.id("cube")), 4, "control: with a character it works");
});

clause(CUBE, "4:ability:fc-control", "any player may use it: the opponent, on their own turn, destroys THEIR character and makes the add / remove choice", () => {
  const b = cubeBoard({ tokens: 3, active: P2 });
  activate(b.engine, P2, b.id("cube"), "fc-control", { selected: { x: [b.id("o1")] } });
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard", "their own character paid");
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "the player who used the ability chooses");
  pickOption(b.engine, /remove/i);
  assert.equal(tokensOn(b.engine, b.id("cube")), 2);
  assert.equal(zoneOf(b.engine, b.id("c1")), "play", "the Cube's controller lost nothing");
  assert.equal(zoneOf(b.engine, b.id("cube")), "play");
});

clause(CUBE, "4:ability:fc-control", "the opponent may also use it in a response window on the controller's turn", () => {
  const noop = tactic({ name: "Noop Tactic" });
  const b = cubeBoard({ tokens: 3, extra: [{ key: "tac", def: noop, owner: P1, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("tac"));
  assert.ok(b.engine.state.responseWindow, "control: the opponent holds a response window");
  control(b, P2, "o1", "add");
  assert.equal(tokensOn(b.engine, b.id("cube")), 4);
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
});

clause(CUBE, "4:ability:fc-control", "it can be used again and again: two uses in one turn move the tokens twice", () => {
  const b = cubeBoard({ tokens: 3 });
  control(b, P1, "c1", "add");
  control(b, P1, "c2", "add");
  assert.equal(tokensOn(b.engine, b.id("cube")), 5);
  control(b, P1, "i1", "remove");
  assert.equal(tokensOn(b.engine, b.id("cube")), 4);
  for (const key of ["c1", "c2", "i1"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard");
});

clause(CUBE, "4:ability:fc-control", "the Cube is itself an item you control: it may be the thing destroyed for the cost", () => {
  const b = cubeBoard({ tokens: 3 });
  activate(b.engine, P1, b.id("cube"), "fc-control", { selected: { x: [b.id("cube")] } });
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("cube")), "discard");
});

// =====================================================================================
// Fanatical Shriever — character (dragon), warlord, cost 5, [R][R], 3 / 3 / 3
// TACTICAL
// COST: Play this only not during a battle. You may pick an item.
// When this card enters play, if you picked an item as part of its cost, destroy that item.
// [R][R][R][R][R][R]: When this card enters play you may pick a location. If you do, inflict 2 damage to that card.
// =====================================================================================

const SHRIEVER = "9eddb4f8-2055-48b8-8942-664e6c9a0f50";

function shrieverBoard(opts: { rage?: number; greed?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "sh", def: printing(SHRIEVER), owner: P1, zone: "hand" },
      { key: "i1", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "oi", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
      { key: "c1", def: chr("My Char"), owner: P1, zone: "play" },
      { key: "o1", def: chr("Their Char"), owner: P2, zone: "play" },
      { key: "l1", def: location({ name: "My Place", structure: 5 }), owner: P1, zone: "play" },
      { key: "ol", def: location({ name: "Their Place", structure: 5 }), owner: P2, zone: "play" },
      ...bank("rage", opts.rage ?? 5, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    { active: opts.active ?? P1 }
  );
}
type ShrieverBoard = ReturnType<typeof shrieverBoard>;
/** Plays the Shriever with `item` as the optional item pick (none = decline the pick). */
const castShriever = (b: ShrieverBoard, itemKey?: string): void => play(b.engine, P1, b.id("sh"), { selected: { it: itemKey ? [b.id(itemKey)] : [] } });
const pickLoc = (b: ShrieverBoard, locKeys: string[]): void => answerPending(b.engine, "selectTargets", { selected: { loc: locKeys.map((k) => b.id(k)) } });

clause(SHRIEVER, "0:kw:TACTICAL", "it has the TACTICAL keyword", () => {
  const { engine, id } = shrieverBoard();
  assert.ok(engine.getKeywords(id("sh")).includes("tactical"), "engine.getKeywords(id(\"sh\")).includes(\"tactical\")");
});

clause(SHRIEVER, "0:kw:TACTICAL", "TACTICAL: it can be deployed in response to the opponent's non-battle action (a non-TACTICAL character cannot)", () => {
  const noop = tactic({ name: "Noop Tactic" });
  const plain = character({ name: "Plain Soldier", strength: 1, life: 1, speed: 1 });
  const b = shrieverBoard({
    active: P2,
    extra: [
      { key: "ptac", def: noop, owner: P2, zone: "hand" },
      { key: "plain", def: plain, owner: P1, zone: "hand" }
    ]
  });
  playRaw(b.engine, P2, b.id("ptac"));
  assert.ok(b.engine.state.responseWindow, "the opponent's tactic is on the stack and I hold priority");
  refused(() => play(b.engine, P1, b.id("plain")), "a non-TACTICAL character cannot be deployed in a response");
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  castShriever(b);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "the TACTICAL Shriever is deployed in response");
});

// --- 1:ability COST: only not during a battle; may pick an item ----------------------------

clause(SHRIEVER, "1:ability", "printed type line: a warlord dragon character 3 / 3 / 3", () => {
  const b = duo([{ key: "sh", def: printing(SHRIEVER), owner: P1, zone: "play" }]);
  identity(b, "sh", "character", "warlord", ["dragon"]);
  assert.deepEqual(["strength", "speed", "life"].map((s) => b.engine.getStat(b.id("sh"), s as "strength")), [3, 3, 3], "printed 3 / 3 / 3");
});

clause(SHRIEVER, "1:ability", "\"play this only not during a battle\": refused while a battle is in progress (a plain tactic in the same spot is fine); nothing is paid", () => {
  const noop = tactic({ name: "Noop Tactic" });
  const b = shrieverBoard({
    active: P2,
    extra: [
      { key: "atk", def: chr("Raider", { speed: 2 }), owner: P2, zone: "play" },
      { key: "tac", def: noop, owner: P1, zone: "hand" }
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.ok(b.engine.state.battle, "a battle is in progress");
  const before = ready(b.engine, P1);
  refused(() => castShriever(b), "Shriever during a battle");
  assert.equal(zoneOf(b.engine, b.id("sh")), "hand");
  assert.equal(ready(b.engine, P1), before, "nothing paid");
  play(b.engine, P1, b.id("tac"));
  assert.equal(zoneOf(b.engine, b.id("tac")), "discard", "control: a tactic can be played at this point");
});

clause(SHRIEVER, "1:ability", "outside a battle it deploys on my own turn without picking anything, and no item is lost", () => {
  const b = shrieverBoard();
  castShriever(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(b.engine.getStat(b.id("sh"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("sh"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("sh"), "speed"), 3);
  assert.equal(zoneOf(b.engine, b.id("i1")), "play");
  assert.equal(zoneOf(b.engine, b.id("oi")), "play");
});

clause(SHRIEVER, "1:ability", "\"you may pick an item\": the pick is optional — playing it with no pick supplied at all deploys it and destroys nothing", () => {
  const b = shrieverBoard();
  play(b.engine, P1, b.id("sh"));
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(zoneOf(b.engine, b.id("i1")), "play");
  assert.equal(zoneOf(b.engine, b.id("oi")), "play");
});

clause(SHRIEVER, "1:ability", "the pick is an item only: a character, a location, a faction and two items are refused (nothing paid), an item works", () => {
  const b = shrieverBoard();
  const before = ready(b.engine, P1);
  refused(() => castShriever(b, "c1"), "my character is not an item");
  refused(() => castShriever(b, "o1"), "their character is not an item");
  refused(() => castShriever(b, "l1"), "a location is not an item");
  refused(() => play(b.engine, P1, b.id("sh"), { selected: { it: [b.engine.state.players[P2].factionId!] } }), "a faction is not an item");
  refused(() => play(b.engine, P1, b.id("sh"), { selected: { it: [b.id("i1"), b.id("oi")] } }), "you may pick an item: one");
  assert.equal(zoneOf(b.engine, b.id("sh")), "hand");
  assert.equal(ready(b.engine, P1), before, "nothing paid");
  for (const key of ["c1", "o1", "l1", "i1", "oi"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} untouched`);
  castShriever(b, "i1");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "control: one item is fine");
});

clause(SHRIEVER, "1:ability", "deploy cost: 5 resources with [R][R] — refused with 4, with no [R], with one [R]; exactly 2 [R] + 3 other pays all 5", () => {
  const short = shrieverBoard({ rage: 4, greed: 0 });
  const noRage = shrieverBoard({ rage: 0, greed: 5 });
  const oneRage = shrieverBoard({ rage: 1, greed: 4 });
  const exact = shrieverBoard({ rage: 2, greed: 3 });
  refused(() => castShriever(short), "cost 5 with 4 resources");
  assert.equal(zoneOf(short.engine, short.id("sh")), "hand");
  refused(() => castShriever(noRage), "no [R]", /threshold/i);
  assert.equal(zoneOf(noRage.engine, noRage.id("sh")), "hand");
  refused(() => castShriever(oneRage), "one of two [R]", /threshold/i);
  assert.equal(zoneOf(oneRage.engine, oneRage.id("sh")), "hand");
  castShriever(exact);
  assert.equal(zoneOf(exact.engine, exact.id("sh")), "play");
  assert.equal(ready(exact.engine, P1), 0, "all 5 paid");
  const rich = shrieverBoard({ rage: 5, greed: 3 });
  castShriever(rich);
  assert.equal(ready(rich.engine, P1), 3, "pays 5 of 8, not more");
});

// --- 2:rule: destroy the picked item ---------------------------------------------------------

clause(SHRIEVER, "2:rule", "the picked item of mine is destroyed when it enters play; the other item is untouched", () => {
  const b = shrieverBoard();
  castShriever(b, "i1");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(zoneOf(b.engine, b.id("i1")), "discard");
  assert.ok(b.engine.state.players[P1].discard.includes(b.id("i1")), "in its owner's discard");
  assert.equal(zoneOf(b.engine, b.id("oi")), "play", "the unpicked item survives");
});

clause(SHRIEVER, "2:rule", "the picked item may be the opponent's: it is destroyed into their discard", () => {
  const b = shrieverBoard();
  castShriever(b, "oi");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(zoneOf(b.engine, b.id("oi")), "discard");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("oi")), "b.engine.state.players[P2].discard.includes(b.id(\"oi\"))");
  assert.equal(zoneOf(b.engine, b.id("i1")), "play");
});

clause(SHRIEVER, "2:rule", "no item picked, no item destroyed — and nothing else is destroyed either", () => {
  const b = shrieverBoard();
  castShriever(b);
  for (const key of ["i1", "oi", "c1", "o1", "l1", "ol"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} survives`);
});

clause(SHRIEVER, "2:rule", "the item is destroyed WHEN the Shriever enters play, not when it is cast: while it waits for a response the item is still there", () => {
  const b = shrieverBoard();
  playRaw(b.engine, P1, b.id("sh"), { selected: { it: [b.id("oi")] } });
  assert.notEqual(zoneOf(b.engine, b.id("sh")), "play", "still on the stack");
  assert.equal(zoneOf(b.engine, b.id("oi")), "play", "the item has not been destroyed yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(zoneOf(b.engine, b.id("oi")), "discard");
});

// --- 3:rule@rrrrrr: six [R] -> pick a location, 2 damage ----------------------------------------

clause(SHRIEVER, "3:rule@rrrrrr", "with six [R] it offers a location pick on entering: the picked opponent's location takes exactly 2 damage", () => {
  const b = shrieverBoard({ rage: 6, greed: 0 });
  castShriever(b);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  const pc = pending(b.engine);
  assert.ok(pc, "the location pick is offered");
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P1);
  pickLoc(b, ["ol"]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(dmg(b.engine, b.id("ol")), 2);
  assert.equal(zoneOf(b.engine, b.id("ol")), "play");
  assert.equal(dmg(b.engine, b.id("l1")), 0, "the other location is untouched");
});

clause(SHRIEVER, "3:rule@rrrrrr", "the location may be my own", () => {
  const b = shrieverBoard({ rage: 6, greed: 0 });
  castShriever(b);
  pickLoc(b, ["l1"]);
  assert.equal(dmg(b.engine, b.id("l1")), 2);
  assert.equal(dmg(b.engine, b.id("ol")), 0);
});

clause(SHRIEVER, "3:rule@rrrrrr", "\"you may\" / \"if you do\": picking no location inflicts no damage anywhere", () => {
  const b = shrieverBoard({ rage: 6, greed: 0 });
  castShriever(b);
  assert.ok(pending(b.engine), "control: the pick is offered");
  pickLoc(b, []);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  for (const key of ["l1", "ol", "c1", "o1", "i1", "oi"]) assert.equal(dmg(b.engine, b.id(key)), 0, `${key} undamaged`);
});

clause(SHRIEVER, "3:rule@rrrrrr", "only a location, and only one: characters, items, a faction and two locations are refused", () => {
  const b = shrieverBoard({ rage: 6, greed: 0 });
  castShriever(b);
  refused(() => pickLoc(b, ["c1"]), "a character is not a location");
  refused(() => pickLoc(b, ["o1"]), "their character is not a location");
  refused(() => pickLoc(b, ["i1"]), "an item is not a location");
  refused(() => answerPending(b.engine, "selectTargets", { selected: { loc: [b.engine.state.players[P2].factionId!] } }), "a faction is not a location");
  refused(() => pickLoc(b, ["l1", "ol"]), "a location: one");
  assert.ok(pending(b.engine), "still waiting for a legal pick");
  pickLoc(b, ["ol"]);
  assert.equal(dmg(b.engine, b.id("ol")), 2, "control");
  for (const key of ["c1", "o1", "i1", "oi", "l1"]) assert.equal(dmg(b.engine, b.id(key)), 0);
});

clause(SHRIEVER, "3:rule@rrrrrr", "threshold-gated: with five [R] (and plenty of other resources) there is no location pick and no damage", () => {
  const five = shrieverBoard({ rage: 5, greed: 5 });
  castShriever(five);
  assert.equal(zoneOf(five.engine, five.id("sh")), "play");
  assert.equal(pending(five.engine), undefined, "only five [R]: no pick offered");
  assert.equal(dmg(five.engine, five.id("ol")), 0);
  assert.equal(dmg(five.engine, five.id("l1")), 0);
  const six = shrieverBoard({ rage: 6, greed: 5 });
  castShriever(six);
  assert.ok(pending(six.engine), "control: six [R] among eleven resources offers the pick");
});

clause(SHRIEVER, "3:rule@rrrrrr", "2 damage destroys a location with structure 2", () => {
  const b = shrieverBoard({ rage: 6, extra: [{ key: "weak", def: location({ name: "Weak Place", structure: 2 }), owner: P2, zone: "play" }] });
  castShriever(b);
  pickLoc(b, ["weak"]);
  assert.equal(zoneOf(b.engine, b.id("weak")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ol")), "play");
});

clause(SHRIEVER, "3:rule@rrrrrr", "it only happens when the Shriever itself enters: a later card entering play offers no pick", () => {
  const b = shrieverBoard({ rage: 6, extra: [{ key: "later", def: item({ name: "Later Item" }), owner: P1, zone: "hand" }] });
  castShriever(b);
  pickLoc(b, []);
  play(b.engine, P1, b.id("later"));
  assert.equal(zoneOf(b.engine, b.id("later")), "play");
  assert.equal(pending(b.engine), undefined);
});

clause(SHRIEVER, "3:rule@rrrrrr", "both clauses together: the picked item is destroyed AND the picked location takes 2 damage", () => {
  const b = shrieverBoard({ rage: 6, greed: 0 });
  castShriever(b, "oi");
  pickLoc(b, ["l1"]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("oi")), "discard");
  assert.equal(dmg(b.engine, b.id("l1")), 2);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
});

clause(SHRIEVER, "3:rule@rrrrrr", "with no location in play it still enters and does not lock up", () => {
  const b = duo([{ key: "sh", def: printing(SHRIEVER), owner: P1, zone: "hand" }, ...bank("rage", 6, P1)]);
  castShriever(b);
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
});

// =====================================================================================
// Fistfight — tactic, warlord, cost 1, [R][R][R]
// COST: Play this only not during a battle. Pick a character you control. X is that character's strength. Destroy the
// character. Pick another character. -- EFFECT: Inflict X+1 damage to the character. -- FLIP UP: 3 [R]
// =====================================================================================

const FISTFIGHT = "5820f3c6-9768-4180-ba59-1afc35ea9bd7";

function fistBoard(opts: { rage?: number; greed?: number; aStr?: number; active?: PlayerId; zone?: "hand" | "play"; faceDown?: boolean; extra?: CardPlacement[]; theirLife?: number } = {}) {
  return duo(
    [
      { key: "ff", def: printing(FISTFIGHT), owner: P1, zone: opts.zone ?? "hand", ...(opts.faceDown ? { faceDown: true } : {}) },
      { key: "a", def: chr("Fighter", { strength: opts.aStr ?? 3, life: 4 }), owner: P1, zone: "play" },
      { key: "a2", def: chr("Second Mine", { strength: 1, life: 6 }), owner: P1, zone: "play" },
      { key: "b", def: chr("Victim", { strength: 1, life: opts.theirLife ?? 10 }), owner: P2, zone: "play" },
      { key: "by", def: chr("Bystander", { life: 10 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "My Item" }), owner: P1, zone: "play" },
      { key: "lo", def: location({ name: "My Place" }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 3, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ],
    { active: opts.active ?? P1 }
  );
}
type FistBoard = ReturnType<typeof fistBoard>;
const castFist = (b: FistBoard, a: string[], bb: string[]): void =>
  play(b.engine, P1, b.id("ff"), { selected: { a: a.map((k) => b.id(k)), b: bb.map((k) => b.id(k)) } });

clause(FISTFIGHT, "0:ability", "printed type line: a warlord tactic with no subtype", () => {
  const b = duo([{ key: "ff", def: printing(FISTFIGHT), owner: P1, zone: "hand" }]);
  identity(b, "ff", "tactic", "warlord", []);
});

clause(FISTFIGHT, "0:ability", "sacrifice a character you control, then inflict X+1 damage (X = its strength 3 -> 4) to another character; the tactic ends in the discard", () => {
  const b = fistBoard();
  castFist(b, ["a"], ["b"]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("a")), "discard", "the picked character is destroyed");
  assert.equal(dmg(b.engine, b.id("b")), 4, "X + 1 = 3 + 1");
  assert.equal(zoneOf(b.engine, b.id("b")), "play");
  assert.equal(zoneOf(b.engine, b.id("ff")), "discard");
  assert.equal(ready(b.engine, P1), 2, "cost 1 paid out of three [R]");
});

for (const [str, expected] of [
  [1, 2],
  [5, 6]
] as const) {
  clause(FISTFIGHT, "0:ability", `X is the sacrificed character's strength: strength ${str} deals ${expected}`, () => {
    const b = fistBoard({ aStr: str });
    castFist(b, ["a"], ["b"]);
    assert.equal(dmg(b.engine, b.id("b")), expected);
    assert.equal(zoneOf(b.engine, b.id("a")), "discard");
  });
}

clause(FISTFIGHT, "0:ability", "X reads the character's CURRENT strength: a Duelist of Surfeit with 2 tokens (1+2) deals 4, with none deals 2", () => {
  const fed = fistBoard({ extra: [{ key: "du", def: printing(DUELIST), owner: P1, zone: "play", counters: { token: 2 } }] });
  castFist(fed, ["du"], ["b"]);
  assert.equal(zoneOf(fed.engine, fed.id("du")), "discard");
  assert.equal(dmg(fed.engine, fed.id("b")), 4);
  const bare = fistBoard({ extra: [{ key: "du", def: printing(DUELIST), owner: P1, zone: "play" }] });
  castFist(bare, ["du"], ["b"]);
  assert.equal(dmg(bare.engine, bare.id("b")), 2);
});

clause(FISTFIGHT, "0:ability", "only the second pick takes damage; the sacrificed character's neighbours and the bystander are untouched", () => {
  const b = fistBoard();
  castFist(b, ["a"], ["b"]);
  for (const key of ["a2", "by", "it", "lo"]) assert.equal(dmg(b.engine, b.id(key)), 0, `${key} undamaged`);
  assert.equal(zoneOf(b.engine, b.id("a2")), "play");
});

clause(FISTFIGHT, "0:ability", "lethal exactly at X+1: a 4-life target dies to 3+1, a 5-life target survives with 4 damage", () => {
  const dies = fistBoard({ theirLife: 4 });
  castFist(dies, ["a"], ["b"]);
  assert.equal(zoneOf(dies.engine, dies.id("b")), "discard");
  const lives = fistBoard({ theirLife: 5 });
  castFist(lives, ["a"], ["b"]);
  assert.equal(zoneOf(lives.engine, lives.id("b")), "play");
  assert.equal(dmg(lives.engine, lives.id("b")), 4);
});

clause(FISTFIGHT, "0:ability", "\"another character\" may be one of my own: my second character takes the damage", () => {
  const b = fistBoard();
  castFist(b, ["a"], ["a2"]);
  assert.equal(zoneOf(b.engine, b.id("a")), "discard");
  assert.equal(dmg(b.engine, b.id("a2")), 4);
  assert.equal(dmg(b.engine, b.id("b")), 0);
});

clause(FISTFIGHT, "0:ability", "first pick must be a character I control: the opponent's character, my item, my location and my faction are refused", () => {
  const b = fistBoard();
  const before = ready(b.engine, P1);
  refused(() => castFist(b, ["b"], ["by"]), "the opponent's character cannot be sacrificed");
  refused(() => castFist(b, ["it"], ["b"]), "my item is not a character");
  refused(() => castFist(b, ["lo"], ["b"]), "my location is not a character");
  refused(() => play(b.engine, P1, b.id("ff"), { selected: { a: [b.engine.state.players[P1].factionId!], b: [b.id("b")] } }), "my faction is not a character");
  assert.equal(zoneOf(b.engine, b.id("ff")), "hand");
  assert.equal(ready(b.engine, P1), before, "nothing paid");
  for (const key of ["b", "by", "it", "lo", "a"]) assert.equal(zoneOf(b.engine, b.id(key)), "play");
  castFist(b, ["a"], ["b"]);
  assert.equal(zoneOf(b.engine, b.id("ff")), "discard", "control: a character I control works");
});

clause(FISTFIGHT, "0:ability", "second pick must be ANOTHER character: the same character, an item, a location, a faction, and no pick at all are refused", () => {
  const b = fistBoard();
  const before = ready(b.engine, P1);
  refused(() => castFist(b, ["a"], ["a"]), "the sacrificed character cannot also be the target");
  refused(() => castFist(b, ["a"], ["it"]), "an item is not a character");
  refused(() => castFist(b, ["a"], ["lo"]), "a location is not a character");
  refused(() => play(b.engine, P1, b.id("ff"), { selected: { a: [b.id("a")], b: [b.engine.state.players[P2].factionId!] } }), "a faction is not a character");
  refused(() => castFist(b, ["a"], []), "the second pick is not optional");
  refused(() => castFist(b, [], ["b"]), "the first pick is not optional");
  assert.equal(zoneOf(b.engine, b.id("ff")), "hand");
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
  assert.equal(ready(b.engine, P1), before, "nothing paid, nothing destroyed");
  castFist(b, ["a"], ["b"]);
  assert.equal(dmg(b.engine, b.id("b")), 4, "control");
});

clause(FISTFIGHT, "0:ability", "with no other character to pick it cannot be played", () => {
  const solo = duo([{ key: "ff", def: printing(FISTFIGHT), owner: P1, zone: "hand" }, { key: "a", def: chr("Lone", { strength: 3 }), owner: P1, zone: "play" }, ...bank("rage", 3, P1)]);
  refused(() => play(solo.engine, P1, solo.id("ff"), { selected: { a: [solo.id("a")], b: [solo.id("a")] } }), "no other character exists");
  refused(() => play(solo.engine, P1, solo.id("ff"), { selected: { a: [solo.id("a")], b: [] } }), "no second pick");
  assert.equal(zoneOf(solo.engine, solo.id("a")), "play");
  assert.equal(zoneOf(solo.engine, solo.id("ff")), "hand");
});

clause(FISTFIGHT, "0:ability", "cost 1 with [R][R][R]: refused with no resources, with two [R], with three non-[R]; three [R] pays exactly one", () => {
  const none = fistBoard({ rage: 0 });
  const two = fistBoard({ rage: 2 });
  const greed = fistBoard({ rage: 0, greed: 3 });
  const three = fistBoard({ rage: 3 });
  refused(() => castFist(none, ["a"], ["b"]), "no resources");
  refused(() => castFist(two, ["a"], ["b"]), "two [R] of three", /threshold/i);
  refused(() => castFist(greed, ["a"], ["b"]), "no [R]", /threshold/i);
  for (const b of [none, two, greed]) {
    assert.equal(zoneOf(b.engine, b.id("ff")), "hand");
    assert.equal(zoneOf(b.engine, b.id("a")), "play", "nothing sacrificed");
  }
  castFist(three, ["a"], ["b"]);
  assert.equal(zoneOf(three.engine, three.id("ff")), "discard");
  assert.equal(ready(three.engine, P1), 2);
});

clause(FISTFIGHT, "0:ability", "\"play this only not during a battle\": refused in a battle (a plain tactic there is fine); allowed in response to a non-battle action", () => {
  const noop = tactic({ name: "Noop Tactic" });
  const b = fistBoard({
    active: P2,
    extra: [
      { key: "atk", def: chr("Raider", { speed: 2 }), owner: P2, zone: "play" },
      { key: "tac", def: noop, owner: P1, zone: "hand" }
    ]
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.ok(b.engine.state.battle, "a battle is in progress");
  const before = ready(b.engine, P1);
  refused(() => castFist(b, ["a"], ["b"]), "Fistfight during a battle");
  assert.equal(zoneOf(b.engine, b.id("ff")), "hand");
  assert.equal(zoneOf(b.engine, b.id("a")), "play", "nothing sacrificed");
  assert.equal(ready(b.engine, P1), before);
  play(b.engine, P1, b.id("tac"));
  assert.equal(zoneOf(b.engine, b.id("tac")), "discard", "control: a tactic can be played at this point");
  const outside = fistBoard({ active: P2, extra: [{ key: "ptac", def: noop, owner: P2, zone: "hand" }] });
  playRaw(outside.engine, P2, outside.id("ptac"));
  castFist(outside, ["a"], ["b"]);
  assert.equal(zoneOf(outside.engine, outside.id("ff")), "discard", "control: as a response outside a battle it works");
  assert.equal(dmg(outside.engine, outside.id("b")), 4);
});

clause(FISTFIGHT, "0:ability", "the character is destroyed as a COST: while the tactic waits for a response it is already gone and no damage has been dealt yet", () => {
  const b = fistBoard();
  playRaw(b.engine, P1, b.id("ff"), { selected: { a: [b.id("a")], b: [b.id("b")] } });
  assert.equal(zoneOf(b.engine, b.id("a")), "discard", "destroyed as part of paying the cost");
  assert.equal(dmg(b.engine, b.id("b")), 0, "the effect has not resolved yet");
  resolvePendingResponses(b.engine);
  assert.equal(dmg(b.engine, b.id("b")), 4);
});

// --- 1:flipUp: 3 [R] -------------------------------------------------------------------------

const flipFist = (b: FistBoard, a = "a", target = "b"): void => {
  flipUpAs(b.engine, P1, b.id("ff"), { a: [b.id(a)], b: [b.id(target)] });
  resolvePendingResponses(b.engine);
};
const flipUpAs = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

clause(FISTFIGHT, "1:flipUp", "a face-down Fistfight flips up as a play: pays 3 (two [R] banks and itself), sacrifices X, deals X+1, ends in the discard", () => {
  const b = fistBoard({ zone: "play", faceDown: true, rage: 2 });
  assert.equal(b.engine.isResource(b.id("ff")), true, "face-down it is a resource");
  assert.equal(ready(b.engine, P1), 3, "two [R] banks plus the face-down card");
  flipFist(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b.engine, P1), 0, "all three resources spent");
  assert.equal(zoneOf(b.engine, b.id("a")), "discard");
  assert.equal(dmg(b.engine, b.id("b")), 4);
  assert.equal(zoneOf(b.engine, b.id("ff")), "discard");
});

clause(FISTFIGHT, "1:flipUp", "does not overpay: with plenty of resources it spends only 3", () => {
  const b = fistBoard({ zone: "play", faceDown: true, rage: 5 });
  assert.equal(ready(b.engine, P1), 6);
  flipFist(b);
  assert.equal(dmg(b.engine, b.id("b")), 4);
  const left = ready(b.engine, P1);
  assert.ok(left === 2 || left === 3, `6 ready - 3 paid (- the card itself if a bank paid): ${left}`);
});

clause(FISTFIGHT, "1:flipUp", "is refused one resource short (one [R] bank plus the card is only 2) and nothing is paid or sacrificed", () => {
  const b = fistBoard({ zone: "play", faceDown: true, rage: 1 });
  assert.equal(ready(b.engine, P1), 2);
  refused(() => flipFist(b), "cost 3 but only 2 resources");
  assert.equal(b.engine.state.cards[b.id("ff")].faceDown, true, "still face-down");
  assert.equal(zoneOf(b.engine, b.id("ff")), "play");
  assert.equal(ready(b.engine, P1), 2);
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
});

clause(FISTFIGHT, "1:flipUp", "needs [R]: three or more resources with no [R] among them is refused", () => {
  const b = fistBoard({ zone: "play", faceDown: true, rage: 0, greed: 4 });
  assert.equal(ready(b.engine, P1), 5);
  refused(() => flipFist(b), "no [R] icon", /threshold/i);
  assert.equal(b.engine.state.cards[b.id("ff")].faceDown, true);
  assert.equal(ready(b.engine, P1), 5, "nothing paid");
  assert.equal(zoneOf(b.engine, b.id("a")), "play");
});

clause(FISTFIGHT, "1:flipUp", "one [R] is enough for the FLIP UP threshold (the card's own [R][R][R] threshold does not apply)", () => {
  const b = fistBoard({ zone: "play", faceDown: true, rage: 1, greed: 2 });
  assert.equal(ready(b.engine, P1), 4);
  flipFist(b);
  assert.equal(zoneOf(b.engine, b.id("ff")), "discard");
  assert.equal(dmg(b.engine, b.id("b")), 4);
});

clause(FISTFIGHT, "1:flipUp", "a flipped-up Fistfight still obeys its picks and its battle restriction", () => {
  const noop = tactic({ name: "Noop Tactic" });
  const same = fistBoard({ zone: "play", faceDown: true, rage: 2 });
  refused(() => flipFist(same, "a", "a"), "another character, not the same one");
  assert.equal(same.engine.state.cards[same.id("ff")].faceDown, true);
  assert.equal(zoneOf(same.engine, same.id("a")), "play");
  const inBattle = fistBoard({
    zone: "play",
    faceDown: true,
    rage: 2,
    active: P2,
    extra: [{ key: "atk", def: chr("Raider", { speed: 2 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(inBattle.engine, P2, [inBattle.id("atk")]);
  refused(() => flipFist(inBattle), "flipping up Fistfight during a battle");
  assert.equal(inBattle.engine.state.cards[inBattle.id("ff")].faceDown, true);
  assert.equal(zoneOf(inBattle.engine, inBattle.id("a")), "play");
  const response = fistBoard({ zone: "play", faceDown: true, rage: 2, active: P2, extra: [{ key: "ptac", def: noop, owner: P2, zone: "hand" }] });
  playRaw(response.engine, P2, response.id("ptac"));
  flipFist(response);
  assert.equal(zoneOf(response.engine, response.id("ff")), "discard", "control: outside a battle, in response, it works");
  assert.equal(dmg(response.engine, response.id("b")), 4);
});
