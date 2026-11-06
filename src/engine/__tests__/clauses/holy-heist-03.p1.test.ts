// Clause tests — batch holy-heist-03, part p1 (groups 1-6). See docs/TESTING.md and
// `npm run card-tests -- manifest holy-heist-03 --groups 1-6`. Expectations come from each card's
// PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
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
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";

/** `n` resources of `icon` for `owner`, already attached to (spent on) their faction. */
const spent = (icon: Icon, n: number, owner: PlayerId): CardPlacement[] =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const cardOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId];

// --- Deceitful Mortgage Underwriter ------------------------------------------------
// Character, cost 4, [G][G][G], 5 strength / 3 speed / 5 life, banker, lackey + mau.
// "This card enters play with 3 tokens on it." / "This card loses 1 strength and 1 life for each
// token on it." / EXTRA INTEREST -- COST: Pay 1. Remove a token from this card. Pick a location.
// EFFECT: Put a damage marker on the location. / FLIP UP: 4 [G][G][G]

const DMU = "4f005a62-ff7c-4afa-8d65-0b5ca43259da";

function dmuBoard(
  o: {
    zone?: "play" | "hand";
    tokens?: number;
    faceDown?: boolean;
    greed?: number;
    rage?: number;
    spentRage?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      {
        key: "dmu",
        def: printing(DMU),
        owner: P1,
        zone: o.zone ?? "play",
        counters: o.tokens ? { token: o.tokens } : undefined,
        faceDown: o.faceDown
      },
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...spent("rage", o.spentRage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

const statsOf = (engine: SpoilsEngine, cardId: CardInstanceId) => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "speed"),
  engine.getStat(cardId, "life")
];

clause(DMU, "0:rule", "deployed from hand (cost 4, [G][G][G]) it enters play with exactly 3 tokens, and plays as a 2/3/2", () => {
  const { engine, id } = dmuBoard({ zone: "hand", greed: 3, rage: 1 });
  assert.equal(tokensOn(engine, id("dmu")), 0, "no tokens in hand");
  play(engine, P1, id("dmu"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("dmu")), "play");
  assert.equal(tokensOn(engine, id("dmu")), 3, "enters play with 3 tokens");
  assert.equal(readyResources(engine, P1), 0, "the 4 resources were paid");
  assert.deepEqual(statsOf(engine, id("dmu")), [2, 3, 2], "5/3/5 minus 3 tokens (strength/speed/life)");
});

clause(DMU, "0:rule", "the deploy needs cost 4 and [G][G][G]: three resources, or four with only [G][G], are refused", () => {
  const short = dmuBoard({ zone: "hand", greed: 3 });
  refused(() => play(short.engine, P1, short.id("dmu")), "only 3 resources");
  assert.equal(zoneOf(short.engine, short.id("dmu")), "hand");
  const noThreshold = dmuBoard({ zone: "hand", greed: 2, rage: 2 });
  refused(() => play(noThreshold.engine, P1, noThreshold.id("dmu")), "four resources but only [G][G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("dmu")), "hand");
  const ok = dmuBoard({ zone: "hand", greed: 3, rage: 1 });
  play(ok.engine, P1, ok.id("dmu"));
  assert.equal(zoneOf(ok.engine, ok.id("dmu")), "play", "control: the exact cost and threshold deploys it");
});

clause(DMU, "0:rule", "tokens disappear when it leaves play (CR 409.2), so each time it enters play it has exactly 3 tokens", () => {
  const { engine, id } = dmuBoard({
    zone: "play",
    tokens: 3,
    greed: 3,
    rage: 1,
    extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("dmu")] } });
  assert.equal(zoneOf(engine, id("dmu")), "hand", "bounced");
  assert.equal(tokensOn(engine, id("dmu")), 0, "its tokens disappeared when it left play");
  play(engine, P1, id("dmu"));
  assert.equal(zoneOf(engine, id("dmu")), "play");
  assert.equal(tokensOn(engine, id("dmu")), 3, "exactly 3 tokens again");
  assert.deepEqual(statsOf(engine, id("dmu")), [2, 3, 2]);
});

clause(DMU, "0:rule", "only the card itself entering play adds tokens: another character entering does not", () => {
  const { engine, id } = dmuBoard({
    zone: "play",
    tokens: 1,
    extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("other"));
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(tokensOn(engine, id("dmu")), 1, "the Underwriter in play gained nothing");
  assert.equal(tokensOn(engine, id("other")), 0, "the other character gained nothing");
  assert.equal(pending(engine), undefined);
});

clause(DMU, "1:rule", "loses 1 strength and 1 life per token: 0 tokens 5/5, 1 tokens 4/4, 2 tokens 3/3, 3 tokens 2/2, speed stays 3", () => {
  const expected: Array<[number, number[]]> = [
    [0, [5, 3, 5]],
    [1, [4, 3, 4]],
    [2, [3, 3, 3]],
    [3, [2, 3, 2]]
  ];
  for (const [tokens, stats] of expected) {
    const { engine, id } = dmuBoard({ tokens });
    assert.deepEqual(statsOf(engine, id("dmu")), stats, `${tokens} tokens`);
  }
});

clause(DMU, "1:rule", "only tokens on this card count, and only tokens: other counters and other cards' tokens change nothing", () => {
  const { engine, id } = dmuBoard({
    tokens: 0,
    extra: [
      { key: "twin", def: printing(DMU), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play", counters: { token: 4 } }
    ]
  });
  assert.deepEqual(statsOf(engine, id("dmu")), [5, 3, 5], "the twin's 3 tokens do not shrink this one");
  assert.deepEqual(statsOf(engine, id("twin")), [2, 3, 2], "the twin shrinks by its own tokens");
  assert.deepEqual(statsOf(engine, id("plain")), [2, 1, 3], "a character with tokens that is not an Underwriter is unchanged");
  assert.deepEqual(statsOf(engine, id("foe")), [2, 1, 3], "an opposing character is unchanged");
  const stamped = dmuBoard({ extra: [] });
  stamped.engine.state.cards[stamped.id("dmu")].counters = { stamp: 2 };
  assert.deepEqual(statsOf(stamped.engine, stamped.id("dmu")), [5, 3, 5], "a different counter kind does not shrink it");
});

clause(DMU, "1:rule", "with 5 tokens its life is 0 and it is destroyed immediately (damage 0 >= life 0, CR 408.4)", () => {
  const { engine, id } = dmuBoard({
    tokens: 4,
    extra: [
      {
        key: "tokenizer",
        def: tactic({
          name: "Tokenizer",
          cost: 0,
          behavior: {
            abilities: [
              {
                id: "tk",
                type: "activated",
                targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
                effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
              }
            ]
          }
        }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  assert.deepEqual(statsOf(engine, id("dmu")), [1, 3, 1], "4 tokens: 1/3/1, alive");
  assert.equal(zoneOf(engine, id("dmu")), "play");
  play(engine, P1, id("tokenizer"), { selected: { t: [id("dmu")] } });
  assert.equal(zoneOf(engine, id("dmu")), "discard", "5 tokens: 0 life, destroyed");
});

// EXTRA INTEREST

const EI = "dmu-extra-interest";

function eiBoard(o: { tokens?: number; rage?: number; spentRage?: number; locStructure?: number } = {}) {
  return dmuBoard({
    tokens: o.tokens ?? 3,
    rage: o.rage ?? 2,
    spentRage: o.spentRage,
    extra: [
      { key: "loc", def: location({ name: "Their Loc", structure: o.locStructure ?? 3 }), owner: P2, zone: "play" },
      { key: "myLoc", def: location({ name: "My Loc", structure: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "play" },
      { key: "handLoc", def: location({ name: "Hand Loc" }), owner: P2, zone: "hand" },
      { key: "discLoc", def: location({ name: "Disc Loc" }), owner: P2, zone: "discard" }
    ]
  });
}
type EiGame = ReturnType<typeof eiBoard>;
const useEi = (g: EiGame, target: CardInstanceId) =>
  activate(g.engine, P1, g.id("dmu"), EI, { selected: { loc: [target] } });

clause(DMU, "2:ability:dmu-extra-interest", "pays 1 resource, removes 1 token, and puts 1 damage marker on the picked location", () => {
  const g = eiBoard();
  assert.equal(readyResources(g.engine, P1), 2);
  useEi(g, g.id("loc"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(readyResources(g.engine, P1), 1, "Pay 1");
  assert.equal(tokensOn(g.engine, g.id("dmu")), 2, "Remove a token from this card");
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 1, "a damage marker on the location");
  assert.equal(zoneOf(g.engine, g.id("loc")), "play", "structure 3 survives one marker");
  assert.deepEqual(statsOf(g.engine, g.id("dmu")), [3, 3, 3], "one fewer token: 4... 3/3/3 (5-2)");
});

clause(DMU, "2:ability:dmu-extra-interest", "the location may be your own (any location in play can be picked)", () => {
  const g = eiBoard();
  useEi(g, g.id("myLoc"));
  assert.equal(cardOf(g.engine, g.id("myLoc")).damage, 1);
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 0, "the other location is untouched");
  assert.equal(tokensOn(g.engine, g.id("dmu")), 2);
});

clause(DMU, "2:ability:dmu-extra-interest", "only a location in play can be picked: not a character, item, faction, or a location in hand or discard", () => {
  const g = eiBoard();
  const factionId = g.engine.state.players[P2].factionId!;
  for (const [what, target] of [
    ["an opposing character", g.id("foe")],
    ["an item", g.id("gizmo")],
    ["the opposing faction", factionId],
    ["the Underwriter itself", g.id("dmu")],
    ["a location in hand", g.id("handLoc")],
    ["a location in the discard pile", g.id("discLoc")]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => useEi(g, target), what);
  }
  assert.equal(tokensOn(g.engine, g.id("dmu")), 3, "nothing was paid by the refused attempts");
  assert.equal(readyResources(g.engine, P1), 2);
  useEi(g, g.id("loc"));
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 1, "control: a location in play works");
});

clause(DMU, "2:ability:dmu-extra-interest", "with no location in play to pick it cannot be used, and nothing is paid", () => {
  const g = dmuBoard({ tokens: 3, rage: 2 });
  refused(() => activate(g.engine, P1, g.id("dmu"), EI, { selected: {} }), "no location to pick");
  assert.equal(tokensOn(g.engine, g.id("dmu")), 3);
  assert.equal(readyResources(g.engine, P1), 2);
});

clause(DMU, "2:ability:dmu-extra-interest", "needs a token to remove: with none it cannot be used (and nothing is paid)", () => {
  const g = eiBoard({ tokens: 0 });
  refused(() => useEi(g, g.id("loc")), "no token on the card");
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 0);
  assert.equal(readyResources(g.engine, P1), 2, "no resource was spent");
  const one = eiBoard({ tokens: 1 });
  useEi(one, one.id("loc"));
  assert.equal(tokensOn(one.engine, one.id("dmu")), 0, "control: the last token can be removed");
  assert.equal(cardOf(one.engine, one.id("loc")).damage, 1);
});

clause(DMU, "2:ability:dmu-extra-interest", "needs 1 ready resource to pay: spent resources do not count, and nothing else is paid", () => {
  const g = eiBoard({ rage: 0, spentRage: 2 });
  assert.equal(readyResources(g.engine, P1), 0);
  refused(() => useEi(g, g.id("loc")), "no resource to pay");
  assert.equal(tokensOn(g.engine, g.id("dmu")), 3, "the token was not removed");
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 0);
  const one = eiBoard({ rage: 1 });
  useEi(one, one.id("loc"));
  assert.equal(readyResources(one.engine, P1), 0, "control: exactly one resource is enough");
  assert.equal(cardOf(one.engine, one.id("loc")).damage, 1);
});

clause(DMU, "2:ability:dmu-extra-interest", "the cost is paid when it is used (before the damage marker resolves)", () => {
  const g = eiBoard();
  g.engine.perform({
    type: "activateAbility",
    playerId: P1,
    cardId: g.id("dmu"),
    abilityId: EI,
    selected: { loc: [g.id("loc")] },
    variables: {}
  });
  assert.equal(tokensOn(g.engine, g.id("dmu")), 2, "token already removed");
  assert.equal(readyResources(g.engine, P1), 1, "resource already paid");
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 1);
});

clause(DMU, "2:ability:dmu-extra-interest", "can be used once per token: three uses mark the location 3 times and take the Underwriter back to 5/5, a fourth is refused", () => {
  const g = dmuBoard({
    tokens: 3,
    rage: 4,
    extra: [{ key: "loc", def: location({ name: "Big Loc", structure: 5 }), owner: P2, zone: "play" }]
  });
  for (let used = 1; used <= 3; used++) {
    activate(g.engine, P1, g.id("dmu"), EI, { selected: { loc: [g.id("loc")] } });
    assert.equal(cardOf(g.engine, g.id("loc")).damage, used, `${used} markers`);
    assert.equal(tokensOn(g.engine, g.id("dmu")), 3 - used);
    assert.equal(readyResources(g.engine, P1), 4 - used);
  }
  assert.deepEqual(statsOf(g.engine, g.id("dmu")), [5, 3, 5], "no tokens left: printed stats");
  refused(() => activate(g.engine, P1, g.id("dmu"), EI, { selected: { loc: [g.id("loc")] } }), "no tokens left");
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 3);
  assert.equal(readyResources(g.engine, P1), 1);
});

clause(DMU, "2:ability:dmu-extra-interest", "damage markers destroy a location once they reach its structure", () => {
  const one = dmuBoard({ tokens: 3, rage: 2, extra: [{ key: "loc", def: location({ name: "Thin", structure: 1 }), owner: P2, zone: "play" }] });
  activate(one.engine, P1, one.id("dmu"), EI, { selected: { loc: [one.id("loc")] } });
  assert.equal(zoneOf(one.engine, one.id("loc")), "discard", "structure 1 with 1 marker is destroyed");
  const two = dmuBoard({
    tokens: 3,
    rage: 2,
    extra: [{ key: "loc", def: location({ name: "Worn", structure: 2 }), owner: P2, zone: "play", damage: 1 }]
  });
  activate(two.engine, P1, two.id("dmu"), EI, { selected: { loc: [two.id("loc")] } });
  assert.equal(zoneOf(two.engine, two.id("loc")), "discard", "the second marker reaches structure 2");
  const three = dmuBoard({ tokens: 3, rage: 2, extra: [{ key: "loc", def: location({ name: "Sturdy", structure: 3 }), owner: P2, zone: "play", damage: 1 }] });
  activate(three.engine, P1, three.id("dmu"), EI, { selected: { loc: [three.id("loc")] } });
  assert.equal(zoneOf(three.engine, three.id("loc")), "play", "2 markers on structure 3 survives");
  assert.equal(cardOf(three.engine, three.id("loc")).damage, 2);
});

clause(DMU, "2:ability:dmu-extra-interest", "any ready resource pays (a face-down resource too), and only its controller can use it", () => {
  const vol = dmuBoard({
    tokens: 3,
    extra: [
      { key: "loc", def: location({ name: "Loc" }), owner: P2, zone: "play" },
      ...volition(1, P1)
    ]
  });
  activate(vol.engine, P1, vol.id("dmu"), EI, { selected: { loc: [vol.id("loc")] } });
  assert.equal(cardOf(vol.engine, vol.id("loc")).damage, 1, "paid with a face-down resource");
  assert.equal(readyResources(vol.engine, P1), 0);

  // The opponent holds priority inside a response window: they may use THEIR Underwriter, never mine.
  const g = dmuBoard({
    tokens: 3,
    rage: 2,
    extra: [
      { key: "loc", def: location({ name: "Loc", structure: 5 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk" }), owner: P1, zone: "play" },
      { key: "dmu2", def: printing(DMU), owner: P2, zone: "play", counters: { token: 3 } },
      ...bank("rage", 2, P2)
    ]
  });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  refused(
    () =>
      g.engine.perform({ type: "activateAbility", playerId: P2, cardId: g.id("dmu"), abilityId: EI, selected: { loc: [g.id("loc")] }, variables: {} }),
    "P2 using P1's Underwriter"
  );
  assert.equal(tokensOn(g.engine, g.id("dmu")), 3);
  g.engine.perform({ type: "activateAbility", playerId: P2, cardId: g.id("dmu2"), abilityId: EI, selected: { loc: [g.id("loc")] }, variables: {} });
  resolvePendingResponses(g.engine);
  assert.equal(tokensOn(g.engine, g.id("dmu2")), 2, "control: P2's own Underwriter works for P2");
  assert.equal(cardOf(g.engine, g.id("loc")).damage, 1);
});

// FLIP UP: 4 [G][G][G]

type FlipOpts = { greed?: number; rage?: number; active?: PlayerId; zone?: "play" | "hand"; faceDown?: boolean };
function flipBoard(o: FlipOpts = {}) {
  return dmuBoard({ zone: o.zone ?? "play", faceDown: o.zone === "hand" ? undefined : o.faceDown ?? true, greed: o.greed, rage: o.rage, active: o.active });
}
const flipUp = (g: { engine: SpoilsEngine; id: (key: string) => CardInstanceId }, player: PlayerId = P1, key = "dmu") =>
  flipUpNow(g.engine, { type: "flipUp", playerId: player, cardId: g.id(key), selected: {}, variables: {} });

clause(DMU, "3:flipUp", "flips up as a character: pays 4 (itself plus three [G] banks), enters play with 3 tokens, and is a 2/3/2", () => {
  const g = flipBoard({ greed: 3 });
  assert.equal(readyResources(g.engine, P1), 4, "3 banks and the face-down Underwriter");
  flipUp(g);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  const dmu = cardOf(g.engine, g.id("dmu"));
  assert.equal(dmu.zone, "play");
  assert.equal(dmu.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("dmu")), ["character"]);
  assert.equal(g.engine.isResource(g.id("dmu")), false, "no longer a resource");
  assert.equal(readyResources(g.engine, P1), 0, "all 4 resources were paid");
  assert.equal(tokensOn(g.engine, g.id("dmu")), 3, "it enters play (deployed by FLIP UP) with 3 tokens");
  assert.deepEqual(statsOf(g.engine, g.id("dmu")), [2, 3, 2]);
});

clause(DMU, "3:flipUp", "pays exactly 4: with three [G] and three other banks plus itself, two resources are left", () => {
  const g = flipBoard({ greed: 3, rage: 3 });
  assert.equal(readyResources(g.engine, P1), 7);
  flipUp(g);
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("dmu")).faceDown, false);
  assert.equal(readyResources(g.engine, P1), 2, "7 - 4 paid - 1 (it stopped being a resource)");
});

clause(DMU, "3:flipUp", "is refused when short of 4 resources or of the [G][G][G] threshold, and pays nothing", () => {
  // threshold met by a spent [G] (spent icons count toward it but cannot pay), so only the cost can refuse
  const short = dmuBoard({ zone: "play", faceDown: true, greed: 2, extra: bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(readyResources(short.engine, P1), 3);
  refused(() => flipUp(short), "3 ready resources is one short of the cost 4 (threshold met by a spent [G])", /FLIP UP costs cannot be paid/);
  assert.equal(cardOf(short.engine, short.id("dmu")).faceDown, true, "still face-down");
  assert.equal(readyResources(short.engine, P1), 3, "nothing was paid");
  const noThreshold = flipBoard({ greed: 2, rage: 1 });
  assert.equal(readyResources(noThreshold.engine, P1), 4, "4 resources, but only [G][G]");
  refused(() => flipUp(noThreshold), "threshold [G][G][G] not met", /FLIP UP threshold requirements are not met/);
  assert.equal(cardOf(noThreshold.engine, noThreshold.id("dmu")).faceDown, true);
  assert.equal(readyResources(noThreshold.engine, P1), 4);
  const ok = flipBoard({ greed: 3 });
  flipUp(ok);
  assert.equal(cardOf(ok.engine, ok.id("dmu")).faceDown, false, "control: exactly cost 4 and [G][G][G] flips it");
});

clause(DMU, "3:flipUp", "only a face-down resource can be flipped up: not a card in hand or one already face-up", () => {
  const g = dmuBoard({
    zone: "play",
    faceDown: true,
    greed: 6,
    extra: [
      { key: "inHand", def: printing(DMU), owner: P1, zone: "hand" },
      { key: "faceUp", def: printing(DMU), owner: P1, zone: "play", counters: { token: 3 } }
    ]
  });
  refused(() => flipUp(g, P1, "inHand"), "in hand");
  refused(() => flipUp(g, P1, "faceUp"), "already face-up");
  assert.equal(zoneOf(g.engine, g.id("inHand")), "hand");
  flipUp(g, P1, "dmu");
  assert.equal(cardOf(g.engine, g.id("dmu")).faceDown, false, "control: the face-down one flips");
});

clause(DMU, "3:flipUp", "a character: refused on the opponent's turn (FLIP UP does not change when a character can be deployed)", () => {
  const g = flipBoard({ greed: 3, active: P2 });
  refused(() => flipUp(g), "not your turn");
  assert.equal(cardOf(g.engine, g.id("dmu")).faceDown, true);
  const own = flipBoard({ greed: 3, active: P1 });
  flipUp(own);
  assert.equal(cardOf(own.engine, own.id("dmu")).faceDown, false, "control: on your own turn");
});

clause(DMU, "3:flipUp", "a non-tactic FLIP UP is refused inside the opponent's response window", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "dmu", def: printing(DMU), owner: P1, zone: "play", faceDown: true },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => flipUp(g), "a character cannot be flipped up while responding to the opponent");
  assert.equal(cardOf(g.engine, g.id("dmu")).faceDown, true);
});

// --- Defalcating Accountant --------------------------------------------------------
// Character, cost 4, [G][G], 2 strength / 2 speed / 4 life, banker, employee + mau.
// "When this card restores, you may draw a card."

const ACCOUNTANT = "62983c63-97cf-43ce-b6c2-ef4f3c708977";

/** A free tactic that restores one chosen character (id `rs`, decl `t`). */
const restoreTactic = () =>
  tactic({
    name: "Refresh",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rs",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "restore", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

function accountantBoard(o: { depleted?: boolean; extra?: CardPlacement[]; greed?: number; rage?: number; zone?: "play" | "hand" } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "acc", def: printing(ACCOUNTANT), owner: P1, zone: o.zone ?? "play", depleted: o.depleted ?? true },
      { key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 6, P2, "deck"),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}

/** The index of the option whose label matches `pattern` in the open chooserSelectsOption. */
function optionIndex(pc: PendingChoiceLike | undefined, pattern: RegExp): number {
  assert.equal(pc?.kind, "chooserSelectsOption", "the controller is offered a choice");
  const options = pc!.options as Array<{ label?: string }>;
  const index = options.findIndex((option) => pattern.test(option.label ?? ""));
  assert.ok(index >= 0, `an option matching ${pattern}`);
  return index;
}

clause(ACCOUNTANT, "0:rule", "when restored by an effect its controller may draw: accepting draws exactly 1 card (the top card)", () => {
  const { engine, id } = accountantBoard();
  const top = engine.state.players[P1].deck[0];
  const deckBefore = engine.state.players[P1].deck.length;
  assert.equal(cardOf(engine, id("acc")).depleted, true);
  play(engine, P1, id("refresh"), { selected: { t: [id("acc")] } });
  assert.equal(cardOf(engine, id("acc")).depleted, false, "restored");
  const pc = pending(engine);
  assert.equal(pc?.playerId, P1, "its controller decides");
  assert.equal(engine.state.players[P1].hand.length, 0, "nothing is drawn before the choice is made");
  answerPending(engine, "chooserSelectsOption", { index: optionIndex(pc, /draw/i) });
  assert.equal(pending(engine), undefined);
  assert.deepEqual(engine.state.players[P1].hand, [top], "drew the top card");
  assert.equal(engine.state.players[P1].deck.length, deckBefore - 1, "exactly one card");
  assert.equal(engine.state.players[P2].hand.length, 0, "the opponent drew nothing");
});

clause(ACCOUNTANT, "0:rule", "it is a 'may': declining draws nothing (and it is still restored)", () => {
  const { engine, id } = accountantBoard();
  const deckBefore = [...engine.state.players[P1].deck];
  play(engine, P1, id("refresh"), { selected: { t: [id("acc")] } });
  const pc = pending(engine);
  answerPending(engine, "chooserSelectsOption", { index: optionIndex(pc, /decline|no/i) });
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.players[P1].hand.length, 0, "no card drawn");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "deck untouched");
  assert.equal(cardOf(engine, id("acc")).depleted, false, "restored regardless");
});

clause(ACCOUNTANT, "0:rule", "the turn-start Restore Rule restores it, so its controller is offered the draw at the start of their turn", () => {
  const { engine, id } = accountantBoard();
  const top = engine.state.players[P1].deck[0];
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "P1's next turn has started");
  assert.equal(cardOf(engine, id("acc")).depleted, false, "restored by the turn-start restore rule");
  const pc = pending(engine);
  answerPending(engine, "chooserSelectsOption", { index: optionIndex(pc, /draw/i) });
  assert.ok(engine.state.players[P1].hand.includes(top), "drew a card for restoring");
});

clause(ACCOUNTANT, "0:rule", "does not trigger when a different character restores, or when it is not depleted (nothing to restore)", () => {
  const { engine, id } = accountantBoard({
    depleted: true,
    extra: [
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", depleted: true },
      { key: "ready", def: printing(ACCOUNTANT), owner: P1, zone: "play", depleted: false }
    ]
  });
  play(engine, P1, id("refresh"), { selected: { t: [id("other")] } });
  assert.equal(cardOf(engine, id("other")).depleted, false, "the other character restored");
  assert.equal(pending(engine), undefined, "no offer: it is not the Accountant that restored");
  assert.equal(cardOf(engine, id("acc")).depleted, true, "the depleted Accountant was not restored");
  assert.equal(engine.state.players[P1].hand.length, 0);

  const second = accountantBoard({ extra: [{ key: "ready", def: printing(ACCOUNTANT), owner: P1, zone: "play", depleted: false }] });
  play(second.engine, P1, second.id("refresh"), { selected: { t: [second.id("ready")] } });
  assert.equal(pending(second.engine), undefined, "an Accountant that was already restored does not restore again");
  assert.equal(second.engine.state.players[P1].hand.filter((c) => c !== second.id("refresh")).length, 0, "nothing drawn");
});

clause(ACCOUNTANT, "0:rule", "'you' is its controller: the opponent's Accountant offers the draw to the opponent, who draws from their own deck", () => {
  const { engine, id } = accountantBoard({
    extra: [{ key: "theirs", def: printing(ACCOUNTANT), owner: P2, zone: "play", depleted: true }]
  });
  const theirTop = engine.state.players[P2].deck[0];
  const myDeck = [...engine.state.players[P1].deck];
  play(engine, P1, id("refresh"), { selected: { t: [id("theirs")] } });
  const pc = pending(engine);
  assert.equal(pc?.playerId, P2, "the Accountant's controller is asked");
  answerPending(engine, "chooserSelectsOption", { index: optionIndex(pc, /draw/i) });
  assert.deepEqual(engine.state.players[P2].hand, [theirTop], "P2 drew");
  assert.equal(engine.state.players[P1].hand.filter((c) => c !== id("refresh")).length, 0, "P1 drew nothing");
  assert.deepEqual(engine.state.players[P1].deck, myDeck, "P1's deck is untouched");
});

clause(ACCOUNTANT, "0:rule", "deploys for cost 4 with [G][G] (refused one short or without both [G]) as a 2/2/4", () => {
  const short = accountantBoard({ zone: "hand", greed: 2, rage: 1 });
  refused(() => play(short.engine, P1, short.id("acc")), "3 resources is one short");
  const noThreshold = accountantBoard({ zone: "hand", greed: 1, rage: 3 });
  refused(() => play(noThreshold.engine, P1, noThreshold.id("acc")), "four resources but only one [G]");
  const ok = accountantBoard({ zone: "hand", greed: 2, rage: 2 });
  play(ok.engine, P1, ok.id("acc"));
  assert.equal(zoneOf(ok.engine, ok.id("acc")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "4 paid");
  assert.deepEqual(statsOf(ok.engine, ok.id("acc")), [2, 2, 4]);
  assert.equal(pending(ok.engine), undefined, "entering play is not restoring");
});

// --- Early Investment --------------------------------------------------------------
// Tactic, cost 4, [G]. "Search your deck for a resource and reveal it. Put it into your hand. Put
// this card into play under its owner's control as a face-down resource instead of into their
// discard pile."

const EARLY = "0178a457-888f-4e19-93c8-6475173566b4";

function earlyBoard(o: { greed?: number; rage?: number; active?: PlayerId; random?: () => number } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    random: o.random,
    cards: [
      { key: "ei", def: printing(EARLY), owner: P1, zone: "hand" },
      { key: "keep", def: character({ name: "Kept In Hand" }), owner: P1, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      { key: "r1", def: resourceCard({ name: "Res One" }), owner: P1, zone: "deck" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "r2", def: resourceCard({ name: "Res Two", resource: { provides: ["greed"], staple: false } }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
      { key: "d3", def: item({ name: "D3" }), owner: P1, zone: "deck" },
      { key: "oppRes", def: resourceCard({ name: "Their Res" }), owner: P2, zone: "deck" },
      { key: "oppD", def: character({ name: "Their D" }), owner: P2, zone: "deck" },
      { key: "oppD2", def: character({ name: "Their D2" }), owner: P2, zone: "deck" },
      { key: "handRes", def: resourceCard({ name: "Hand Res" }), owner: P1, zone: "hand" },
      { key: "discRes", def: resourceCard({ name: "Disc Res" }), owner: P1, zone: "discard" },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...bank("greed", o.greed ?? 1, P1),
      ...bank("rage", o.rage ?? 3, P1)
    ]
  });
}
type EarlyGame = ReturnType<typeof earlyBoard>;
const cast = (g: EarlyGame, pick?: string) =>
  play(g.engine, P1, g.id("ei"), { selected: pick ? { r: [g.id(pick)] } : {} });

clause(EARLY, "0:rule", "searches the deck for a resource: the chosen resource goes to the hand and leaves the deck, other cards stay put", () => {
  const g = earlyBoard();
  const handBefore = [...g.engine.state.players[P1].hand];
  cast(g, "r1");
  drain(g.engine, (pc) => ({ kind: pc.kind, selected: [] }));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("r1")), "hand", "the found resource is in hand");
  assert.equal(g.engine.state.players[P1].deck.includes(g.id("r1")), false);
  assert.equal(g.engine.state.players[P1].hand.length, handBefore.length, "Early Investment left the hand, the resource joined it");
  assert.ok(g.engine.state.players[P1].hand.includes(g.id("keep")), "the rest of the hand is untouched");
  assert.equal(g.engine.state.players[P1].deck.length, 5, "6 - 1 cards left in the deck");
  assert.ok(g.engine.state.players[P1].deck.includes(g.id("r2")), "the other resource was not taken");
  assert.equal(zoneOf(g.engine, g.id("r1")) === "hand" && cardOf(g.engine, g.id("r1")).faceDown !== true, true);
});

clause(EARLY, "0:rule", "a non-staple resource can be found too (any resource)", () => {
  const g = earlyBoard();
  cast(g, "r2");
  assert.equal(zoneOf(g.engine, g.id("r2")), "hand");
});

clause(EARLY, "0:rule", "finds one resource, not two", () => {
  const g = earlyBoard();
  refused(() => play(g.engine, P1, g.id("ei"), { selected: { r: [g.id("r1"), g.id("r2")] } }), "two resources");
  assert.equal(zoneOf(g.engine, g.id("ei")), "hand", "the tactic was never cast");
  assert.equal(zoneOf(g.engine, g.id("r1")), "deck");
  assert.equal(zoneOf(g.engine, g.id("r2")), "deck");
  cast(g, "r1");
  assert.equal(zoneOf(g.engine, g.id("r1")), "hand", "control: one resource works");
  assert.equal(zoneOf(g.engine, g.id("r2")), "deck");
});

clause(EARLY, "0:rule", "only a resource in your own deck can be found: not a character, an item, the opponent's resource, or one in hand or discard", () => {
  const g = earlyBoard();
  for (const [what, key] of [
    ["a character in the deck", "d0"],
    ["an item in the deck", "d3"],
    ["a resource in the opponent's deck", "oppRes"],
    ["a resource in hand", "handRes"],
    ["a resource in the discard pile", "discRes"]
  ] as Array<[string, string]>) {
    refused(() => cast(g, key), what);
  }
  assert.equal(zoneOf(g.engine, g.id("ei")), "hand", "the tactic was never cast");
  assert.equal(readyResources(g.engine, P1), 4, "nothing was paid");
  cast(g, "r1");
  assert.equal(zoneOf(g.engine, g.id("r1")), "hand", "control: a resource in your deck works");
});

clause(EARLY, "0:rule", "reveals the found resource (and only it)", () => {
  const g = earlyBoard();
  cast(g, "r1");
  const revealed = g.engine
    .getLog()
    .filter((e) => e.event?.type === "cardsRevealed")
    .flatMap((e) => (e.event as { cardIds: string[] }).cardIds);
  assert.ok(revealed.includes(g.id("r1")), "the found resource was revealed");
  for (const key of ["d0", "d1", "r2", "d2", "d3", "oppRes"]) assert.ok(!revealed.includes(g.id(key)), `${key} was not revealed`);
});

clause(EARLY, "0:rule", "the searched deck is shuffled afterwards (CR 312.1), the opponent's is not", () => {
  const g = earlyBoard({ random: () => 0 });
  const before = [...g.engine.state.players[P1].deck].filter((c) => c !== g.id("r1"));
  const oppBefore = [...g.engine.state.players[P2].deck];
  cast(g, "r1");
  const after = [...g.engine.state.players[P1].deck];
  assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(after, before, "the order changed: the deck was shuffled");
  assert.deepEqual(g.engine.state.players[P2].deck, oppBefore, "the opponent's deck was not shuffled");
});

clause(EARLY, "0:rule", "the search may fail (CR 312.2): finding nothing still leaves the deck shuffled and the tactic a face-down resource", () => {
  const g = earlyBoard({ random: () => 0 });
  const before = [...g.engine.state.players[P1].deck];
  const handBefore = [...g.engine.state.players[P1].hand];
  cast(g);
  drain(g.engine, (pc) => ({ kind: pc.kind, selected: [], ...(pc.declarations ? { selected: Object.fromEntries((pc.declarations as { id: string }[]).map((d) => [d.id, []])) } : {}) }));
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.players[P1].deck.length, before.length, "no card left the deck");
  assert.deepEqual([...g.engine.state.players[P1].deck].sort(), [...before].sort());
  assert.notDeepEqual(g.engine.state.players[P1].deck, before, "a searched deck is shuffled even when the search finds nothing");
  assert.deepEqual(g.engine.state.players[P1].hand, handBefore.filter((c) => c !== g.id("ei")), "nothing came into the hand");
  assert.equal(zoneOf(g.engine, g.id("ei")), "play", "it still enters play");
  assert.equal(cardOf(g.engine, g.id("ei")).faceDown, true);
});

clause(EARLY, "0:rule", "instead of the discard pile it enters play under its owner's control as a face-down resource", () => {
  const g = earlyBoard();
  assert.equal(readyResources(g.engine, P1), 4);
  cast(g, "r1");
  const ei = cardOf(g.engine, g.id("ei"));
  assert.equal(ei.zone, "play", "in play");
  assert.equal(ei.faceDown, true, "face-down");
  assert.equal(ei.controllerId, P1, "under its owner's control");
  assert.equal(ei.depleted === true, false);
  assert.equal(g.engine.isResource(g.id("ei")), true, "it is a resource");
  assert.equal(g.engine.state.players[P1].discard.includes(g.id("ei")), false, "not in the discard pile");
  assert.equal(g.engine.state.players[P1].discard.length, 1, "the discard pile is unchanged (only the pre-placed card)");
  assert.equal(readyResources(g.engine, P1), 1, "4 paid; the new face-down resource is ready");
});

clause(EARLY, "0:rule", "costs 4 with [G]: refused with 3 resources or with 4 non-[G] resources; paid in full", () => {
  const short = earlyBoard({ greed: 1, rage: 2 });
  refused(() => cast(short, "r1"), "3 resources");
  const noGreed = earlyBoard({ greed: 0, rage: 4 });
  refused(() => cast(noGreed, "r1"), "no [G]");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("ei")), "hand");
  const ok = earlyBoard({ greed: 1, rage: 3 });
  cast(ok, "r1");
  assert.equal(zoneOf(ok.engine, ok.id("ei")), "play", "control");
  assert.equal(readyResources(ok.engine, P1), 1, "4 spent, 1 new resource");
});

clause(EARLY, "0:rule", "as a tactic it can be cast in the opponent's response window and still ends up as the caster's face-down resource", () => {
  const g = earlyBoard({ active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("ei"), selected: { r: [g.id("r1")] }, variables: {} } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("r1")), "hand");
  assert.equal(cardOf(g.engine, g.id("ei")).zone, "play");
  assert.equal(cardOf(g.engine, g.id("ei")).faceDown, true);
  assert.equal(cardOf(g.engine, g.id("ei")).controllerId, P1);
});

// --- Espionage Loafers -------------------------------------------------------------
// Item (gear), cost 2, [G][G]. ATTACH TO CHARACTER.
// "The attached character gains COVERT. If the attached card inflicts damage to a faction, inflict
// that much damage to your faction."
// "[G][G][G][G][G]: The attached character gains COVERT and this card loses all other rules text."

const LOAFERS = "473c8d59-8f53-4454-8d9a-5186b0bc697a";

/** A character with a free activated ability that inflicts 2 damage on the opposing faction (id `zap`). */
const zapper = (name: string, over: Partial<CardDefinition> = {}) =>
  character({
    name,
    strength: 3,
    life: 3,
    speed: 1,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          costs: [],
          effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }]
        }
      ]
    },
    ...over
  });

/** A free tactic that destroys one chosen item (id `sm`, decl `t`). */
const smashTactic = () =>
  tactic({
    name: "Smash",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

const influence = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].influence;

function loafersBoard(
  o: {
    loafers?: "hand" | "attached" | "discard";
    hostDef?: CardDefinition;
    hostOwner?: PlayerId;
    greed?: number;
    rage?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const active = o.active ?? P1;
  const hostOwner = o.hostOwner ?? P1;
  const mode = o.loafers ?? "attached";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "host", def: o.hostDef ?? character({ name: "Host", strength: 3, life: 3, speed: 1 }), owner: hostOwner, zone: "play" },
      {
        key: "lo",
        def: printing(LOAFERS),
        owner: P1,
        zone: mode === "attached" ? "play" : mode,
        attachedToKey: mode === "attached" ? "host" : undefined
      },
      { key: "ally", def: character({ name: "Ally", strength: 4, life: 3, speed: 1 }), owner: hostOwner, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: hostOwner === P1 ? P2 : P1, zone: "play" },
      { key: "cfoe", def: character({ name: "Covert Foe", strength: 1, life: 3, speed: 1, behavior: { keywords: ["covert"] } }), owner: hostOwner === P1 ? P2 : P1, zone: "play" },
      { key: "smash", def: smashTactic(), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type LoafersGame = ReturnType<typeof loafersBoard>;
const hasCovert = (g: LoafersGame, key: string) => g.engine.getKeywords(g.id(key)).includes("covert");
const zap = (g: LoafersGame, player: PlayerId = P1, key = "host") => activate(g.engine, player, g.id(key), "zap");
const deployLoafers = (g: LoafersGame, hostKey = "host") => play(g.engine, P1, g.id("lo"), { selected: { attachTo: [g.id(hostKey)] } });
const noBlock = (g: LoafersGame, defender: PlayerId = P2) => g.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [] });

clause(LOAFERS, "0:attach", "deploys onto a character you pick, attached to it, paying cost 2 [G][G]", () => {
  const g = loafersBoard({ loafers: "hand", greed: 2 });
  deployLoafers(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("lo")), "play");
  assert.equal(cardOf(g.engine, g.id("lo")).attachedTo, g.id("host"), "attached to the picked character");
  assert.equal(cardOf(g.engine, g.id("ally")).attachedTo, undefined);
  assert.equal(readyResources(g.engine, P1), 0, "2 paid");
});

clause(LOAFERS, "0:attach", "the host may also be an opponent's character", () => {
  const g = loafersBoard({ loafers: "hand", greed: 2 });
  deployLoafers(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("lo")), "play");
  assert.equal(cardOf(g.engine, g.id("lo")).attachedTo, g.id("foe"));
  assert.equal(cardOf(g.engine, g.id("lo")).controllerId, P1, "still controlled by its deployer");
});

clause(LOAFERS, "0:attach", "only a character can be the host: not an item, a location or a faction; with no legal host it cannot be deployed", () => {
  const g = loafersBoard({
    loafers: "hand",
    greed: 2,
    extra: [
      { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" }
    ]
  });
  refused(() => deployLoafers(g, "gizmo"), "an item host");
  refused(() => deployLoafers(g, "place"), "a location host");
  refused(() => play(g.engine, P1, g.id("lo"), { selected: { attachTo: [g.engine.state.players[P2].factionId!] } }), "a faction host");
  assert.equal(zoneOf(g.engine, g.id("lo")), "hand");
  assert.equal(readyResources(g.engine, P1), 2, "nothing was paid");
  deployLoafers(g);
  assert.equal(zoneOf(g.engine, g.id("lo")), "play", "control: a character works");

  const bare = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "lo", def: printing(LOAFERS), owner: P1, zone: "hand" }, { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "play" }, ...bank("greed", 2, P1)]
  });
  refused(() => play(bare.engine, P1, bare.id("lo"), { selected: { attachTo: [bare.id("gizmo")] } }), "no character in play");
  assert.equal(zoneOf(bare.engine, bare.id("lo")), "hand");
});

clause(LOAFERS, "0:attach", "costs 2 with [G][G]: one resource, or two non-[G] resources, are refused", () => {
  const short = loafersBoard({ loafers: "hand", greed: 1 });
  refused(() => deployLoafers(short), "one resource");
  const noThreshold = loafersBoard({ loafers: "hand", greed: 1, rage: 1 });
  refused(() => deployLoafers(noThreshold), "two resources but only one [G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("lo")), "hand");
  const ok = loafersBoard({ loafers: "hand", greed: 2 });
  deployLoafers(ok);
  assert.equal(zoneOf(ok.engine, ok.id("lo")), "play", "control");
});

clause(LOAFERS, "0:attach", "when the host is destroyed the attached Loafers is discarded with it (CR 301.4)", () => {
  const g = loafersBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "discard");
  assert.equal(zoneOf(g.engine, g.id("lo")), "discard", "the attached card leaves play the same way");
});

clause(LOAFERS, "0:attach", "when the host returns to its owner's hand the attached Loafers leaves play the same way: back to its owner's hand (CR 301.4a)", () => {
  const g = loafersBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "hand");
  assert.equal(zoneOf(g.engine, g.id("lo")), "hand", "the attached card leaves play the same way (to hand)");
});

clause(LOAFERS, "1:rule", "the attached character (and only it) gains COVERT, only while Loafers is in play attached", () => {
  const g = loafersBoard({ loafers: "hand", greed: 2 });
  assert.equal(hasCovert(g, "host"), false, "not before Loafers is deployed");
  deployLoafers(g);
  assert.equal(hasCovert(g, "host"), true, "covert once attached");
  assert.equal(hasCovert(g, "ally"), false, "another of my characters is not covert");
  assert.equal(hasCovert(g, "foe"), false, "an opposing character is not covert");
  play(g.engine, P1, g.id("smash"), { selected: { t: [g.id("lo")] } });
  assert.equal(zoneOf(g.engine, g.id("lo")), "discard");
  assert.equal(hasCovert(g, "host"), false, "off again after Loafers leaves play");
});

clause(LOAFERS, "1:rule", "COVERT works on the host: a non-covert character cannot block it, a covert one can", () => {
  const g = loafersBoard();
  declareAttackBy(g.engine, P1, [g.id("host")]);
  refused(() => g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("foe")] }), "a non-covert blocker");
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("cfoe")] });
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("cfoe")], "a covert character may block it");
});

clause(LOAFERS, "1:rule", "COVERT works on the host as a blocker: it can block only covert parties", () => {
  const g = loafersBoard({
    active: P2,
    extra: [{ key: "plainAtk", def: character({ name: "Plain Atk" }), owner: P2, zone: "play" }]
  });
  declareAttackBy(g.engine, P2, [g.id("plainAtk")]);
  refused(() => g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("host")] }), "a covert host blocking a plain party");
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("ally")] });
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("ally")], "control: a plain character may block it");
});

clause(LOAFERS, "1:rule", "damage the host inflicts on a faction in battle is inflicted on your faction too (the same amount)", () => {
  const g = loafersBoard();
  assert.equal(influence(g.engine, P1), 30);
  assert.equal(influence(g.engine, P2), 30);
  fightThrough(g.engine, P1, [g.id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(g.engine, P2), 27, "the host hit the opposing faction for its 3 strength");
  assert.equal(influence(g.engine, P1), 27, "and your faction took 3 as well");
});

clause(LOAFERS, "1:rule", "damage the host inflicts outside battle counts too (an ability that damages a faction)", () => {
  const g = loafersBoard({ hostDef: zapper("Zapper"), extra: [{ key: "zapAlly", def: zapper("Zap Ally"), owner: P1, zone: "play" }] });
  zap(g);
  assert.equal(influence(g.engine, P2), 28, "2 to the opposing faction");
  assert.equal(influence(g.engine, P1), 28, "2 to my faction");
  zap(g, P1, "zapAlly");
  assert.equal(influence(g.engine, P2), 26, "a character without Loafers: only the opposing faction is hurt");
  assert.equal(influence(g.engine, P1), 28, "no backfire for it");
});

clause(LOAFERS, "1:rule", "no faction damage, no backfire: when the host's damage goes to a character instead, your faction is unharmed", () => {
  const g = loafersBoard();
  fightThrough(g.engine, P1, [g.id("host")], { type: "faction", playerId: P2 }, [g.id("cfoe")]);
  assert.equal(influence(g.engine, P2), 30, "blocked: the opposing faction took nothing");
  assert.equal(influence(g.engine, P1), 30, "so my faction took nothing either");
});

clause(LOAFERS, "1:rule", "only the attached card's damage is copied: in a party with an ally, the faction takes 7 but mine takes only the host's 3", () => {
  const g = loafersBoard();
  fightThrough(g.engine, P1, [g.id("host"), g.id("ally")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(g.engine, P2), 23, "3 + 4 damage to the opposing faction");
  assert.equal(influence(g.engine, P1), 27, "only the host's 3 comes back to me");
});

clause(LOAFERS, "1:rule", "not attached, no covert and no backfire: before it is deployed and after it is destroyed", () => {
  const g = loafersBoard({ loafers: "hand", greed: 2, hostDef: zapper("Zapper") });
  zap(g);
  assert.equal(influence(g.engine, P2), 28);
  assert.equal(influence(g.engine, P1), 30, "no backfire before Loafers is attached");
  deployLoafers(g);
  zap(g);
  assert.equal(influence(g.engine, P2), 26);
  assert.equal(influence(g.engine, P1), 28, "backfire while attached");
  play(g.engine, P1, g.id("smash"), { selected: { t: [g.id("lo")] } });
  zap(g);
  assert.equal(influence(g.engine, P2), 24);
  assert.equal(influence(g.engine, P1), 28, "no more backfire after Loafers leaves play");
});

clause(LOAFERS, "1:rule", "'your faction' is the Loafers' controller's: when an opposing host damages my faction, the backfire also hits MY faction (not the host controller's)", () => {
  const g = loafersBoard({
    active: P2,
    hostOwner: P2,
    hostDef: zapper("Their Zapper"),
    extra: []
  });
  assert.equal(cardOf(g.engine, g.id("lo")).controllerId, P1, "I control the Loafers");
  zap(g, P2);
  assert.equal(influence(g.engine, P1), 26, "2 from the zap and 2 more 'to your faction' (the Loafers' controller)");
  assert.equal(influence(g.engine, P2), 30, "the host's controller takes nothing");
});

// "[G][G][G][G][G]: gains COVERT and this card loses all other rules text"

clause(LOAFERS, "2:rule@ggggg", "with five [G] the host still has COVERT (so a non-covert character cannot block it) and Loafers is still attached", () => {
  const g = loafersBoard({ greed: 5 });
  assert.equal(hasCovert(g, "host"), true, "covert");
  assert.equal(hasCovert(g, "ally"), false);
  assert.equal(zoneOf(g.engine, g.id("lo")), "play", "it does not leave play");
  assert.equal(cardOf(g.engine, g.id("lo")).attachedTo, g.id("host"), "it stays attached");
  declareAttackBy(g.engine, P1, [g.id("host")]);
  refused(() => g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("foe")] }), "a non-covert blocker");
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("cfoe")] });
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("cfoe")], "a covert character may block it");
});

clause(LOAFERS, "2:rule@ggggg", "with five [G] the damage backfire is gone (the card loses its other rules text), while with four [G] it is live", () => {
  const four = loafersBoard({ greed: 4, rage: 1, hostDef: zapper("Zapper") });
  zap(four);
  assert.equal(influence(four.engine, P2), 28);
  assert.equal(influence(four.engine, P1), 28, "four [G]: the backfire remains");
  const five = loafersBoard({ greed: 5, hostDef: zapper("Zapper") });
  zap(five);
  assert.equal(influence(five.engine, P2), 28, "the zap still lands");
  assert.equal(influence(five.engine, P1), 30, "five [G]: no damage to my faction");
});

clause(LOAFERS, "2:rule@ggggg", "five non-[G] resources do not count: the backfire still happens (battle damage too)", () => {
  const rage = loafersBoard({ rage: 5, hostDef: zapper("Zapper") });
  zap(rage);
  assert.equal(influence(rage.engine, P1), 28, "five rage is not five [G]");
  const battle = loafersBoard({ greed: 5 });
  fightThrough(battle.engine, P1, [battle.id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(battle.engine, P2), 27, "the host's 3 damage to the faction");
  assert.equal(influence(battle.engine, P1), 30, "five [G]: nothing comes back from battle damage either");
});

clause(LOAFERS, "2:rule@ggggg", "the five [G] must be the Loafers' controller's: the host controller's icons do not turn the loss on", () => {
  const g = loafersBoard({
    active: P2,
    hostOwner: P2,
    hostDef: zapper("Their Zapper"),
    extra: bank("greed", 5, P2)
  });
  zap(g, P2);
  assert.equal(influence(g.engine, P1), 26, "2 from the zap and 2 backfire to the Loafers' controller: P2's icons are not the Loafers' controller's");
});

// --- Expedition Advisor ------------------------------------------------------------
// Character, cost 5, [G], 3 strength / 3 speed / 3 life, banker, advisor.
// "When this card enters play, you may draw 2 cards then discard 2 cards."
// RECUR: [G][G][G] -- COST: Use this only if this card is in your discard pile. Pay 1. Remove this
// card from the game. EFFECT: Draw 2 cards then discard 2 cards.

const ADVISOR = "b2676ad4-73d9-4c30-abed-d197a93c03f3";
const RECUR = "expedition-recur";

function advisorBoard(
  o: {
    zone?: "play" | "hand" | "discard";
    owner?: PlayerId;
    greed?: number;
    rage?: number;
    spentGreed?: number;
    hand?: number;
    extra?: CardPlacement[];
  } = {}
) {
  const owner = o.owner ?? P1;
  const other = owner === P1 ? P2 : P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: owner,
    turn: owner === P1 ? 1 : 2,
    cards: [
      { key: "adv", def: printing(ADVISOR), owner, zone: o.zone ?? "hand" },
      ...fillers("h", o.hand ?? 2, owner, "hand"),
      ...fillers("d", 6, owner, "deck"),
      ...fillers("e", 6, other, "deck"),
      ...fillers("oh", 1, other, "hand"),
      ...bank("greed", o.greed ?? 0, owner),
      ...bank("rage", o.rage ?? 0, owner),
      ...spent("greed", o.spentGreed ?? 0, owner),
      ...(o.extra ?? [])
    ]
  });
}
type AdvisorGame = ReturnType<typeof advisorBoard>;
const deployAdvisor = (g: AdvisorGame, player: PlayerId = P1) => play(g.engine, player, g.id("adv"));
const drawIndex = (g: AdvisorGame) => optionIndex(pending(g.engine), /draw/i);
const declineIndex = (g: AdvisorGame) => optionIndex(pending(g.engine), /decline|no/i);

clause(ADVISOR, "0:rule", "entering play offers its controller the choice; accepting draws 2 then discards 2 chosen cards from the whole hand", () => {
  const g = advisorBoard({ greed: 1, rage: 4 });
  const [t0, t1] = g.engine.state.players[P1].deck;
  deployAdvisor(g);
  assert.equal(zoneOf(g.engine, g.id("adv")), "play");
  assert.equal(pending(g.engine)?.playerId, P1);
  assert.equal(g.engine.state.players[P1].hand.length, 2, "nothing drawn until the choice is made");
  answerPending(g.engine, "chooserSelectsOption", { index: drawIndex(g) });
  assert.equal(g.engine.state.players[P1].hand.length, 4, "drew 2 (hand h0 h1 + 2)");
  assert.ok(g.engine.state.players[P1].hand.includes(t0) && g.engine.state.players[P1].hand.includes(t1), "the top 2 cards of the deck");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "now the discard is chosen");
  assert.equal(pending(g.engine)?.playerId, P1);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0")] }), "discarding only 1 card");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), g.id("h1"), t0] }), "discarding 3 cards");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), g.id("e0")] }), "a card from the opponent's deck");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), g.id("d5")] }), "a card still in the deck");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), g.id("oh0")] }), "a card in the opponent's hand");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal choice");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), t1] });
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual([...g.engine.state.players[P1].hand].sort(), [g.id("h1"), t0].sort(), "kept the other old card and the other drawn card");
  assert.deepEqual([...g.engine.state.players[P1].discard].sort(), [g.id("h0"), t1].sort(), "discarded exactly the two chosen cards");
  assert.equal(g.engine.state.players[P1].deck.length, 4, "6 - 2 drawn");
  assert.deepEqual(statsOf(g.engine, g.id("adv")), [3, 3, 3]);
});

clause(ADVISOR, "0:rule", "it is a 'may': declining draws and discards nothing", () => {
  const g = advisorBoard({ greed: 1, rage: 4 });
  const deck = [...g.engine.state.players[P1].deck];
  const hand = g.engine.state.players[P1].hand.filter((c) => c !== g.id("adv"));
  deployAdvisor(g);
  answerPending(g.engine, "chooserSelectsOption", { index: declineIndex(g) });
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(g.engine.state.players[P1].deck, deck);
  assert.deepEqual([...g.engine.state.players[P1].hand].sort(), [...hand].sort());
  assert.equal(g.engine.state.players[P1].discard.length, 0);
  assert.equal(zoneOf(g.engine, g.id("adv")), "play");
});

clause(ADVISOR, "0:rule", "the discard comes after the draw: with an empty hand it discards 2 cards just drawn", () => {
  const g = advisorBoard({ greed: 1, rage: 4, hand: 0 });
  const [t0, t1] = g.engine.state.players[P1].deck;
  deployAdvisor(g);
  assert.equal(g.engine.state.players[P1].hand.length, 0);
  answerPending(g.engine, "chooserSelectsOption", { index: drawIndex(g) });
  if (pending(g.engine)) answerPending(g.engine, "chooserSelectsTarget", { selected: [t0, t1] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.players[P1].hand.length, 0, "drew 2, discarded those 2");
  assert.deepEqual([...g.engine.state.players[P1].discard].sort(), [t0, t1].sort());
  assert.equal(g.engine.state.players[P1].deck.length, 4);
});

clause(ADVISOR, "0:rule", "only the Advisor itself entering play triggers it: another character entering does not", () => {
  const g = advisorBoard({
    zone: "play",
    extra: [{ key: "other", def: character({ name: "Other", cost: 0 }), owner: P1, zone: "hand" }]
  });
  const deck = [...g.engine.state.players[P1].deck];
  play(g.engine, P1, g.id("other"));
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(pending(g.engine), undefined, "no offer");
  assert.deepEqual(g.engine.state.players[P1].deck, deck);
});

clause(ADVISOR, "0:rule", "'you' is its controller: P2's Advisor offers P2 the draw, from P2's own deck", () => {
  const g = advisorBoard({ owner: P2, greed: 1, rage: 4 });
  const p1Deck = [...g.engine.state.players[P1].deck];
  const [t0, t1] = g.engine.state.players[P2].deck;
  deployAdvisor(g, P2);
  assert.equal(pending(g.engine)?.playerId, P2);
  answerPending(g.engine, "chooserSelectsOption", { index: drawIndex(g) });
  assert.equal(pending(g.engine)?.playerId, P2, "P2 also picks the discards");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [t0, t1] });
  assert.deepEqual([...g.engine.state.players[P2].discard].sort(), [t0, t1].sort());
  assert.deepEqual(g.engine.state.players[P1].deck, p1Deck, "P1's deck untouched");
});

clause(ADVISOR, "0:rule", "deploys for cost 5 with [G]: four resources, or five without a [G], are refused", () => {
  const short = advisorBoard({ greed: 1, rage: 3 });
  refused(() => deployAdvisor(short), "four resources");
  const noGreed = advisorBoard({ rage: 5 });
  refused(() => deployAdvisor(noGreed), "five resources, no [G]");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("adv")), "hand");
  const ok = advisorBoard({ greed: 1, rage: 4 });
  deployAdvisor(ok);
  assert.equal(zoneOf(ok.engine, ok.id("adv")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "5 paid");
});

// RECUR

clause(ADVISOR, "1:ability:expedition-recur", "from your discard pile: pay 1, remove it from the game, then draw 2 and discard 2 chosen cards (no 'may')", () => {
  const g = advisorBoard({ zone: "discard", greed: 3, hand: 1 });
  const [t0, t1] = g.engine.state.players[P1].deck;
  activate(g.engine, P1, g.id("adv"), RECUR);
  assert.equal(zoneOf(g.engine, g.id("adv")), "removed", "Remove this card from the game");
  assert.equal(readyResources(g.engine, P1), 2, "Pay 1");
  assert.equal(g.engine.state.players[P1].hand.length, 3, "drew 2 (h0 + 2)");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "the discard is mandatory: no decline option");
  assert.equal(pending(g.engine)?.playerId, P1);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [t0] }), "only 1 card");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), g.id("oh0")] }), "a card in the opponent's hand");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), t0, t1] }), "3 cards");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h0"), t0] });
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(g.engine.state.players[P1].hand, [t1]);
  assert.deepEqual([...g.engine.state.players[P1].discard].sort(), [g.id("h0"), t0].sort(), "the Advisor is not in the discard pile");
  assert.equal(g.engine.state.players[P1].deck.length, 4);
});

clause(ADVISOR, "1:ability:expedition-recur", "the cost is paid when it is used: the Advisor is already out of the game and the resource spent while it waits", () => {
  const g = advisorBoard({ zone: "discard", greed: 3, hand: 1 });
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("adv"), abilityId: RECUR, selected: {}, variables: {} });
  assert.equal(zoneOf(g.engine, g.id("adv")), "removed");
  assert.equal(readyResources(g.engine, P1), 2);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.players[P1].hand.length, 3, "then the draw resolved");
});

clause(ADVISOR, "1:ability:expedition-recur", "draw first, then discard: with an empty hand the 2 cards drawn are the ones discarded", () => {
  const g = advisorBoard({ zone: "discard", greed: 3, hand: 0 });
  const [t0, t1] = g.engine.state.players[P1].deck;
  activate(g.engine, P1, g.id("adv"), RECUR);
  if (pending(g.engine)) answerPending(g.engine, "chooserSelectsTarget", { selected: [t0, t1] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.players[P1].hand.length, 0);
  assert.deepEqual([...g.engine.state.players[P1].discard].sort(), [t0, t1].sort());
});

clause(ADVISOR, "1:ability:expedition-recur", "use this only if it is in your discard pile: refused from play and from hand, nothing paid", () => {
  const inPlay = advisorBoard({ zone: "play", greed: 3 });
  refused(() => activate(inPlay.engine, P1, inPlay.id("adv"), RECUR), "in play", /not found|discard/i);
  assert.equal(readyResources(inPlay.engine, P1), 3);
  assert.equal(zoneOf(inPlay.engine, inPlay.id("adv")), "play");
  const inHand = advisorBoard({ zone: "hand", greed: 3 });
  refused(() => activate(inHand.engine, P1, inHand.id("adv"), RECUR), "in hand", /not found|discard/i);
  assert.equal(readyResources(inHand.engine, P1), 3);
  assert.equal(zoneOf(inHand.engine, inHand.id("adv")), "hand");
  const ok = advisorBoard({ zone: "discard", greed: 3 });
  activate(ok.engine, P1, ok.id("adv"), RECUR);
  assert.equal(zoneOf(ok.engine, ok.id("adv")), "removed", "control: from the discard pile it works");
});

clause(ADVISOR, "1:ability:expedition-recur", "your discard pile: an Advisor in the opponent's discard pile cannot be recurred by me", () => {
  const g = advisorBoard({
    zone: "discard",
    greed: 3,
    extra: [{ key: "theirs", def: printing(ADVISOR), owner: P2, zone: "discard" }]
  });
  refused(() => activate(g.engine, P1, g.id("theirs"), RECUR), "the opponent's Advisor", /not found|discard|own|control/i);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  assert.equal(readyResources(g.engine, P1), 3);
});

clause(ADVISOR, "1:ability:expedition-recur", "needs [G][G][G]: two [G] plus two other resources is refused; and Pay 1 needs a ready resource", () => {
  const noThreshold = advisorBoard({ zone: "discard", greed: 2, rage: 2 });
  refused(() => activate(noThreshold.engine, P1, noThreshold.id("adv"), RECUR), "only [G][G]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("adv")), "discard");
  assert.equal(readyResources(noThreshold.engine, P1), 4, "nothing paid");
  const nothingToPay = advisorBoard({ zone: "discard", spentGreed: 3 });
  assert.equal(readyResources(nothingToPay.engine, P1), 0);
  refused(() => activate(nothingToPay.engine, P1, nothingToPay.id("adv"), RECUR), "[G][G][G] present but every resource is spent");
  assert.equal(zoneOf(nothingToPay.engine, nothingToPay.id("adv")), "discard", "not removed from the game");
  const exact = advisorBoard({ zone: "discard", greed: 3 });
  activate(exact.engine, P1, exact.id("adv"), RECUR);
  assert.equal(zoneOf(exact.engine, exact.id("adv")), "removed", "control: exactly three [G] is enough");
});

clause(ADVISOR, "1:ability:expedition-recur", "removed from the game, it cannot be used a second time", () => {
  const g = advisorBoard({ zone: "discard", greed: 3 });
  activate(g.engine, P1, g.id("adv"), RECUR);
  drain(g.engine, (pc) => ({ kind: pc.kind, selected: [g.engine.state.players[P1].hand[0], g.engine.state.players[P1].hand[1]] }));
  assert.equal(zoneOf(g.engine, g.id("adv")), "removed");
  const ready = readyResources(g.engine, P1);
  refused(() => activate(g.engine, P1, g.id("adv"), RECUR), "already removed from the game", /not found|discard|removed/i);
  assert.equal(readyResources(g.engine, P1), ready);
});

// --- Final Countdown ---------------------------------------------------------------
// Tactic, cost 6, [G][G][G][G][G]. EXTRA COST: Deploy this card only during your turn.
// "Draw 4 cards. At the start of your opponent's next turn detach up to 3 staple resources you
// control, a character you control gains 2 life that turn, and restore a character you control."

const FC = "66238cd1-a654-4900-8cb0-775bb6df6c17";

/** A staple (or relic) resource placement with a fixed key; `isSpent` attaches it to its owner's faction. */
const res = (key: string, icon: Icon, owner: PlayerId, isSpent = false, staple = true): CardPlacement => ({
  key,
  def: resourceCard({ name: `${icon} ${key}`, resource: { provides: [icon], staple } }),
  owner,
  zone: "play",
  attachedToKey: isSpent ? (owner === P1 ? "__factionA" : "__factionB") : undefined
});

function fcBoard(o: { active?: PlayerId; relics?: boolean; noCharacters?: boolean; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  const payment: CardPlacement[] = o.relics
    ? [1, 2, 3, 4, 5, 6].map((n) => res(`s${n}`, "greed", P1, false, false))
    : [res("s1", "greed", P1), res("s2", "greed", P1), res("s3", "greed", P1), res("s4", "greed", P1), res("s5", "greed", P1), res("s6", "rage", P1)];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "fc", def: printing(FC), owner: P1, zone: "hand" },
      ...payment,
      res("relic", "greed", P1, true, false),
      res("os1", "rage", P2, true),
      ...(o.noCharacters
        ? []
        : [
            { key: "c1", def: character({ name: "C1", life: 3 }), owner: P1, zone: "play" as const, depleted: true },
            { key: "c2", def: character({ name: "C2", life: 3 }), owner: P1, zone: "play" as const },
            { key: "c3", def: character({ name: "C3", life: 3 }), owner: P1, zone: "play" as const, depleted: true }
          ]),
      { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play", depleted: true },
      ...fillers("d", 8, P1, "deck"),
      ...fillers("e", 8, P2, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
type FcGame = ReturnType<typeof fcBoard>;
const castFc = (g: FcGame) => play(g.engine, P1, g.id("fc"));
const attached = (g: FcGame, key: string) => cardOf(g.engine, g.id(key)).attachedTo !== undefined;
const lifeOf = (g: FcGame, key: string) => g.engine.getStat(g.id(key), "life");

/** Answers the three start-of-turn picks (declaration ids det / buff / res) with `picks`. */
function resolveStart(g: FcGame, picks: { det?: string[]; buff?: string; res?: string } = {}): void {
  drain(g.engine, (pc) => {
    const declId = (pc as unknown as { declaration: { id: string } }).declaration.id;
    if (declId === "det") return { kind: pc.kind, selected: (picks.det ?? []).map((k) => g.id(k)) };
    if (declId === "buff") return { kind: pc.kind, selected: [g.id(picks.buff ?? "c2")] };
    if (declId === "res") return { kind: pc.kind, selected: [g.id(picks.res ?? "c1")] };
    throw new Error(`unexpected pick ${declId}`);
  });
}
const declOf = (g: FcGame) => (pending(g.engine) as unknown as { declaration: { id: string } } | undefined)?.declaration.id;

clause(FC, "1:rule", "costs 6 with [G][G][G][G][G]: five resources, or six with only four [G], are refused; the cost is paid in full", () => {
  const ok = fcBoard();
  castFc(ok);
  assert.equal(zoneOf(ok.engine, ok.id("fc")), "discard", "a resolved tactic goes to the discard pile");
  assert.equal(readyResources(ok.engine, P1), 0, "all 6 paid");
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "fc", def: printing(FC), owner: P1, zone: "hand" }, ...fillers("d", 6, P1, "deck"), ...bank("greed", 5, P1)]
  });
  refused(() => play(short.engine, P1, short.id("fc")), "five resources");
  assert.equal(zoneOf(short.engine, short.id("fc")), "hand");
  const fourGreed = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "fc", def: printing(FC), owner: P1, zone: "hand" },
      ...fillers("d", 6, P1, "deck"),
      ...bank("greed", 4, P1),
      ...bank("rage", 2, P1)
    ]
  });
  refused(() => play(fourGreed.engine, P1, fourGreed.id("fc")), "six resources but only four [G]");
  assert.equal(zoneOf(fourGreed.engine, fourGreed.id("fc")), "hand");
});

clause(FC, "1:rule", "draws exactly 4 cards immediately: the top 4, in order", () => {
  const g = fcBoard();
  const deck = [...g.engine.state.players[P1].deck];
  assert.deepEqual(g.engine.state.players[P1].hand, [g.id("fc")]);
  castFc(g);
  assert.deepEqual(g.engine.state.players[P1].hand, deck.slice(0, 4), "drew the top 4");
  assert.deepEqual(g.engine.state.players[P1].deck, deck.slice(4), "the rest of the deck is untouched");
  assert.equal(g.engine.state.players[P2].hand.length, 0, "the opponent drew nothing");
});

clause(FC, "1:rule", "nothing else happens now: the rest waits for the start of the opponent's next turn", () => {
  const g = fcBoard();
  castFc(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(cardOf(g.engine, g.id("c1")).depleted, true, "not restored yet");
  assert.equal(lifeOf(g, "c2"), 3, "no life gained yet");
  assert.equal(attached(g, "s1"), true, "staples not detached yet");
  assert.equal(g.engine.state.activePlayerId, P1);
});

clause(FC, "1:rule", "at the start of the opponent's next turn: detach up to 3 staples, one character gains 2 life, one character is restored", () => {
  const g = fcBoard();
  castFc(g);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2, "the opponent's turn began");
  assert.equal(pending(g.engine)?.playerId, P1, "its caster makes the choices, on the opponent's turn");
  assert.equal(declOf(g), "det");
  resolveStart(g, { det: ["s1", "s2", "s3"], buff: "c2", res: "c1" });
  assert.equal(pending(g.engine), undefined);
  for (const key of ["s1", "s2", "s3"]) assert.equal(attached(g, key), false, `${key} detached`);
  for (const key of ["s4", "s5", "s6", "relic"]) assert.equal(attached(g, key), true, `${key} still attached`);
  assert.equal(lifeOf(g, "c2"), 5, "the picked character has 2 more life");
  assert.equal(lifeOf(g, "c1"), 3, "the others do not");
  assert.equal(lifeOf(g, "c3"), 3);
  assert.equal(cardOf(g.engine, g.id("c1")).depleted, false, "the picked character is restored");
  assert.equal(cardOf(g.engine, g.id("c3")).depleted, true, "only one character is restored");
});

clause(FC, "1:rule", "'up to 3': fewer (1 or 0) staples may be detached, but not 4", () => {
  const one = fcBoard();
  castFc(one);
  endTurn(one.engine, P1);
  refused(() => answerPending(one.engine, "chooserSelectsTarget", { selected: ["s1", "s2", "s3", "s4"].map((k) => one.id(k)) }), "four staples");
  assert.equal(declOf(one), "det", "still waiting for a legal pick");
  resolveStart(one, { det: ["s2"] });
  assert.equal(attached(one, "s2"), false);
  for (const key of ["s1", "s3", "s4", "s5", "s6"]) assert.equal(attached(one, key), true, `${key} stays attached`);
  const none = fcBoard();
  castFc(none);
  endTurn(none.engine, P1);
  resolveStart(none, { det: [] });
  for (const key of ["s1", "s2", "s3", "s4", "s5", "s6"]) assert.equal(attached(none, key), true, `${key} stays attached when none are picked`);
  assert.equal(lifeOf(none, "c2"), 5, "the other two effects still happen");
  assert.equal(cardOf(none.engine, none.id("c1")).depleted, false);
});

clause(FC, "1:rule", "only staple resources you control can be detached: not a non-staple resource, an item, or the opponent's staple", () => {
  const g = fcBoard();
  castFc(g);
  endTurn(g.engine, P1);
  for (const [what, key] of [
    ["a non-staple resource", "relic"],
    ["the opponent's staple", "os1"],
    ["an item", "gizmo"],
    ["a character", "c2"]
  ] as Array<[string, string]>) {
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] }), what);
  }
  assert.equal(declOf(g), "det");
  resolveStart(g, { det: ["s6"] });
  assert.equal(attached(g, "s6"), false, "control: your own staple");
  assert.equal(attached(g, "relic"), true);
});

clause(FC, "1:rule", "the life gain and the restore each pick a character you control (not an opponent's character or an item)", () => {
  const g = fcBoard();
  castFc(g);
  endTurn(g.engine, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(declOf(g), "buff");
  for (const key of ["foe", "gizmo", "s1"]) {
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] }), `${key} for the life gain`);
  }
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("c1")] });
  assert.equal(declOf(g), "res");
  for (const key of ["foe", "gizmo", "s1"]) {
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] }), `${key} for the restore`);
  }
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("c3")] });
  assert.equal(pending(g.engine), undefined);
  assert.equal(lifeOf(g, "c1"), 5, "c1 gained the life");
  assert.equal(lifeOf(g, "c3"), 3);
  assert.equal(cardOf(g.engine, g.id("c3")).depleted, false, "c3 restored");
  assert.equal(cardOf(g.engine, g.id("c1")).depleted, true, "c1 (depleted) was not restored: different picks");
});

clause(FC, "1:rule", "the 2 life lasts that turn only, and the effect happens only once (not again on the opponent's following turn)", () => {
  const g = fcBoard();
  castFc(g);
  endTurn(g.engine, P1);
  resolveStart(g, { det: [], buff: "c2", res: "c1" });
  assert.equal(lifeOf(g, "c2"), 5, "during the opponent's turn");
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(lifeOf(g, "c2"), 3, "gone at the end of that turn");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(pending(g.engine), undefined, "it does not trigger on the following opponent turn");
  assert.equal(lifeOf(g, "c2"), 3);
});

clause(FC, "1:rule", "with no staples to detach and no characters to pick, nothing stalls: the turn simply begins", () => {
  const g = fcBoard({ relics: true, noCharacters: true });
  castFc(g);
  endTurn(g.engine, P1);
  while (pending(g.engine)) {
    resolveStart(g, { det: [] });
  }
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.activePlayerId, P2, "the opponent's turn is under way");
  for (const key of ["s1", "s2", "s3", "s4", "s5", "s6"]) assert.equal(attached(g, key), true, `${key}: a non-staple is never detached`);
});

clause(FC, "0:extraCost", "deploy this card only during your turn: refused in the opponent's turn (even with priority in their response window), allowed in yours", () => {
  const g = fcBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "P1 can respond");
  refused(() => playRaw(g.engine, P1, g.id("fc")), "Final Countdown during the opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("fc")), "hand");
  assert.equal(readyResources(g.engine, P1), 6, "nothing was paid");
  const own = fcBoard();
  castFc(own);
  assert.equal(zoneOf(own.engine, own.id("fc")), "discard", "control: on your own turn it is cast");
});

// @@END@@
