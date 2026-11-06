// Clause tests: decade-of-deckadence-04 (Decade of Deckadence, rules groups 1-23).
// Micromajig Overlord, Micromajig Party, Mindrender, Montgomery Blatherscythe, Mr. Green Thumb, Mutineer's Hiatus,
// Mutual Mutilator, Narcissism, Neverending Mirage, Nine Rituals of the Mau, the five Obols, Opportunistic Pirate,
// Overcompensator, Paranoia, Peaceful Mau, Pepper Breath, Plunging Shriever, Pogo Bomb, Purge the Villainous.
//
// Expected behavior is the PRINTED text only (docs/TESTING.md rule 1). Where a printed sentence has a genuine
// reading ambiguity, the most literal reading is asserted.

import assert from "node:assert/strict";
import {
  activate,
  bank,
  buildGame,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../per-card/_harness.js";
import { clause, declineAll, drain, flipUpNow, printing, refused } from "./_clause.js";
import {
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  declareAttackOpenWindow,
  playRaw
} from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { developResource, endTurn, factionOf } from "./_turn.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

const OVERLORD = "ddc5f67f-0d4a-4b5a-b311-eead63fc9ac0";
const PARTY = "91d503b5-cb0a-41ee-9ea1-7282d63ce6da";
const MINDRENDER = "1fcd1fda-0d6c-45a6-8b08-918b5c15b6e9";
const MONTGOMERY = "913d13c9-2839-4c04-b2c5-7ea9b78085b1";
const THUMB = "ed2f9dd9-d085-43df-a2d6-8de7ec4957d4";
const HIATUS = "b6495592-5fa8-40bf-bab1-6659aafb46da";
const MUTILATOR = "187415fd-1e59-43bf-a45a-a29b1a3584ae";
const NARCISSISM = "90464270-d920-446c-a106-18126896801f";
const MIRAGE = "78f2647e-a55d-4d22-be77-f08522df634a";
const RITUALS = "4bdf9bf1-1248-4143-bd0f-fb9aeb16ca3d";
const OBOL_DECEPTION = "23dc17ce-9307-418a-a1c3-b8423ade26d9";
const OBOL_ELITISM = "d4cef9b7-602b-4421-ae49-d259c6ad1065";
const OBOL_GREED = "46675c3d-e1b9-4e92-94a8-f2fcf27518ba";
const OBOL_OBSESSION = "8d2d2cf3-79a3-460f-a73b-236a1e4ceb18";
const OBOL_RAGE = "f353a56b-bade-4e72-bbc8-5372b238fad3";
const PIRATE = "fa3a29ad-e316-4e66-96f1-d367b4720d1d";
const OVERCOMP = "a4b669a2-fb88-4e2a-b768-aa38dd47c4fe";
const PARANOIA = "d7aad6a5-33c4-42a7-a9a8-325a61adf65d";
const PEACEFUL = "b495e946-e83a-46ef-8b4f-2b5b6ec5f4ad";
const PEPPER = "6a59000c-df36-4801-bc0d-460028176161";
const SHRIEVER = "8ca591c5-d7d1-47d2-87a7-cf0a04edb205";
const POGO = "b322bcf5-80f2-4712-8015-6335475a860a";
const PURGE = "18c427ea-2061-4d89-a9fc-f58a3da0cd55";

// --- helpers ------------------------------------------------------------------------------------------------

interface DuoOpts {
  turn?: number;
  active?: PlayerId;
  influence?: number;
  oppInfluence?: number;
  random?: () => number;
}
function duo(cards: CardPlacement[], o: DuoOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction(), ...(o.influence !== undefined ? { influence: o.influence } : {}) },
    playerB: { faction: developFaction(), ...(o.oppInfluence !== undefined ? { influence: o.oppInfluence } : {}) },
    turn: o.turn,
    activePlayerId: o.active,
    random: o.random ?? (() => 0.5),
    cards
  });
}
type Game = ReturnType<typeof duo>;

const ready = (engine: SpoilsEngine, p: PlayerId = P1): number => engine.getAvailableResourceCount(p);
const inf = (engine: SpoilsEngine, p: PlayerId): number => engine.state.players[p].influence;
const handOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].hand];
const discardOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].discard];
const deckOf = (engine: SpoilsEngine, p: PlayerId): string[] => [...engine.state.players[p].deck];
const card = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId];
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;
const stats = (engine: SpoilsEngine, cardId: CardInstanceId): [number, number, number] => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "life"),
  engine.getStat(cardId, "speed")
];
const nameOf = (engine: SpoilsEngine, cardId: CardInstanceId): string => engine.getDefinition(cardId).name;
const reveals = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

/** A Micromajig token (CR 409.3c: Gearsmith character, 1 strength, 1 life, 3 speed, "majig"): the placement, to be marked a token by `tokens`. */
const mmCard = (key: string, owner: PlayerId, controller?: PlayerId): CardPlacement => ({
  key,
  def: character({ name: "Micromajig", strength: 1, life: 1, speed: 3, trade: "gearsmith", subtype: ["majig"] }),
  owner,
  zone: "play",
  ...(controller ? { controller } : {})
});
/** Marks the placements `keys` as tokens (they vanish when they leave play, and `isToken` selectors match them). */
function tokens(game: Game, ...keys: string[]): Game {
  for (const key of keys) game.engine.state.cards[game.id(key)].isToken = true;
  return game;
}
/** Every Micromajig token in play (any controller), or only those `controller` controls. */
const micromajigTokens = (engine: SpoilsEngine, controller?: PlayerId) =>
  Object.values(engine.state.cards).filter(
    (c) => c.zone === "play" && c.isToken && nameOf(engine, c.id) === "Micromajig" && (controller === undefined || c.controllerId === controller)
  );

const DESTROY_ANY = tactic({
  name: "Smite",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "smite",
        type: "activated",
        targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
        effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
      }
    ]
  }
});
/** A free tactic that makes the OPPONENT discard a card of their choice from hand. */
const OPP_DISCARDS = tactic({
  name: "Make Discard",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "md",
        type: "activated",
        effects: [
          {
            type: "chooserSelectsTarget",
            chooser: "opponent",
            declaration: { id: "d", selector: { controller: "opponent", zone: "hand" }, count: 1 },
            effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }]
          }
        ]
      }
    ]
  }
});
/** A free tactic that makes its controller discard one of their own hand cards. */
const SELF_DISCARDS = tactic({
  name: "Self Discard",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "sd",
        type: "activated",
        effects: [
          {
            type: "chooserSelectsTarget",
            chooser: "controller",
            declaration: { id: "d", selector: { controller: "self", zone: "hand" }, count: 1 },
            effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }]
          }
        ]
      }
    ]
  }
});
/** A free tactic that puts one picked character from the controller's hand into play. */
const PUT_FROM_HAND = tactic({
  name: "Put Into Play",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "put",
        type: "activated",
        targets: [{ id: "c", selector: { owner: "self", zone: "hand", type: "character" }, count: 1 }],
        effects: [{ type: "putIntoPlay", target: { type: "selected", id: "c" }, controller: "controller" }]
      }
    ]
  }
});
/** A free tactic that gives a picked character +N strength until end of turn. */
const pump = (amount: number) =>
  tactic({
    name: `Pump ${amount}`,
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

// =============================================================================
// Micromajig Overlord
// character, gearsmith, subtype lord, cost 4, threshold [E], 2 strength / 3 speed / 2 life
// When this card enters play put a Micromajig token into play under your control.
// Micromajig tokens you control gain 1 strength, 1 life, and 1 speed.
// =============================================================================

clause(OVERLORD, "0:rule", "deploys for exactly 4 with [E]: 4 Elitism are enough, 3 are one short, 4 Rage lack the threshold; printed stats 2/2/3", () => {
  const ok = duo([{ key: "o", def: printing(OVERLORD), owner: P1, zone: "hand" }, ...bank("elitism", 4)]);
  play(ok.engine, P1, ok.id("o"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("o")), "play");
  assert.equal(ready(ok.engine), 0, "all 4 paid");
  assert.deepEqual(stats(ok.engine, ok.id("o")), [2, 2, 3], "strength 2 / life 2 / speed 3; the lord is not itself a Micromajig token");
  assert.deepEqual(printing(OVERLORD).subtype, ["lord"]);

  const short = duo([{ key: "o", def: printing(OVERLORD), owner: P1, zone: "hand" }, ...bank("elitism", 3)]);
  refused(() => play(short.engine, P1, short.id("o")), "3 resources are one short of cost 4");
  assert.equal(zoneOf(short.engine, short.id("o")), "hand");

  const noThreshold = duo([{ key: "o", def: printing(OVERLORD), owner: P1, zone: "hand" }, ...bank("rage", 4)]);
  refused(() => play(noThreshold.engine, P1, noThreshold.id("o")), "[E] threshold missing");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("o")), "hand");
});

clause(OVERLORD, "0:rule", "when it enters play exactly one Micromajig token enters under my control (a Gearsmith majig character)", () => {
  const g = duo([{ key: "o", def: printing(OVERLORD), owner: P1, zone: "hand" }, ...bank("elitism", 4)]);
  assert.equal(micromajigTokens(g.engine).length, 0);
  play(g.engine, P1, g.id("o"));
  drain(g.engine, declineAll);
  const toks = micromajigTokens(g.engine);
  assert.equal(toks.length, 1, "exactly one token");
  assert.equal(toks[0].controllerId, P1, "under my control");
  assert.equal(toks[0].ownerId, P1);
  assert.deepEqual(g.engine.getCardTypes(toks[0].id), ["character"]);
  const def = g.engine.getDefinition(toks[0].id);
  assert.equal(def.trade, "gearsmith");
  assert.ok((def.subtype ?? []).includes("majig"), "majig subtype (CR 409.3c)");
  assert.deepEqual([def.strength, def.life, def.speed], [1, 1, 3], "a Micromajig token is 1/1/3 before the Overlord's bonus");
  assert.equal(micromajigTokens(g.engine, P2).length, 0, "the opponent gets none");
});

clause(OVERLORD, "0:rule", "it triggers on entering play by any route (not only a deploy), but other cards entering play do not make a token", () => {
  const viaEffect = duo([
    { key: "o", def: printing(OVERLORD), owner: P1, zone: "hand" },
    { key: "put", def: PUT_FROM_HAND, owner: P1, zone: "hand" }
  ]);
  play(viaEffect.engine, P1, viaEffect.id("put"), { selected: { c: [viaEffect.id("o")] } });
  drain(viaEffect.engine, declineAll);
  assert.equal(zoneOf(viaEffect.engine, viaEffect.id("o")), "play");
  assert.equal(micromajigTokens(viaEffect.engine, P1).length, 1, "put into play by an effect: it entered play");

  const other = duo([
    { key: "o", def: printing(OVERLORD), owner: P1, zone: "play" },
    { key: "c", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  play(other.engine, P1, other.id("c"));
  drain(other.engine, declineAll);
  assert.equal(zoneOf(other.engine, other.id("c")), "play");
  assert.equal(micromajigTokens(other.engine).length, 0, "another card entering play: no token");
});

clause(OVERLORD, "1:rule", "Micromajig tokens I control become 2/2/4; non-token Micromajigs, the opponent's tokens, other tokens and the Overlord are unaffected", () => {
  const g = tokens(
    duo([
      { key: "o", def: printing(OVERLORD), owner: P1, zone: "play" },
      mmCard("mine", P1),
      mmCard("theirs", P2),
      { key: "plain", def: character({ name: "Micromajig", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" },
      { key: "demon", def: character({ name: "Demon", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" }
    ]),
    "mine",
    "theirs",
    "demon"
  );
  assert.deepEqual(stats(g.engine, g.id("mine")), [2, 2, 4], "my token: +1 strength, +1 life, +1 speed");
  assert.deepEqual(stats(g.engine, g.id("theirs")), [1, 1, 3], "the opponent's token is not mine");
  assert.deepEqual(stats(g.engine, g.id("plain")), [1, 1, 3], "the non-token Micromajig card is not a token");
  assert.deepEqual(stats(g.engine, g.id("demon")), [1, 1, 3], "a token with another name is not a Micromajig token");
  assert.deepEqual(stats(g.engine, g.id("o")), [2, 2, 3], "the Overlord itself");
});

clause(OVERLORD, "1:rule", "'control' decides it: a token I own but the opponent controls gets nothing, one the opponent owns but I control gets the bonus", () => {
  const g = tokens(
    duo([
      { key: "o", def: printing(OVERLORD), owner: P1, zone: "play" },
      mmCard("lent", P1, P2),
      mmCard("stolen", P2, P1)
    ]),
    "lent",
    "stolen"
  );
  assert.deepEqual(stats(g.engine, g.id("lent")), [1, 1, 3]);
  assert.deepEqual(stats(g.engine, g.id("stolen")), [2, 2, 4]);
});

clause(OVERLORD, "1:rule", "the bonus ends when the Overlord leaves play, and two Overlords give it twice", () => {
  const g = tokens(
    duo([
      { key: "o", def: printing(OVERLORD), owner: P1, zone: "play" },
      mmCard("tok", P1),
      { key: "smite", def: DESTROY_ANY, owner: P1, zone: "hand" }
    ]),
    "tok"
  );
  assert.deepEqual(stats(g.engine, g.id("tok")), [2, 2, 4]);
  play(g.engine, P1, g.id("smite"), { selected: { t: [g.id("o")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("o")), "discard");
  assert.deepEqual(stats(g.engine, g.id("tok")), [1, 1, 3], "the Overlord is gone: back to 1/1/3");

  const two = tokens(
    duo([
      { key: "o1", def: printing(OVERLORD), owner: P1, zone: "play" },
      { key: "o2", def: printing(OVERLORD), owner: P1, zone: "play" },
      mmCard("tok", P1)
    ]),
    "tok"
  );
  assert.deepEqual(stats(two.engine, two.id("tok")), [3, 3, 5], "each Overlord gives +1/+1/+1");
});

// =============================================================================
// Micromajig Party
// tactic, gearsmith, cost 2, threshold [E][E]
// EXTRA COST: You may deplete 3 Micromajig tokens you control.
// Put a Micromajig token into play. If you depleted 3 Micromajig tokens as part of this card's cost, put this card
// into its owner's hand instead of their discard pile.
// =============================================================================

function partyBoard(extra: CardPlacement[] = [], tokenKeys: string[] = [], o: DuoOpts & { elitism?: number } = {}) {
  return tokens(
    duo([{ key: "party", def: printing(PARTY), owner: P1, zone: "hand" }, ...bank("elitism", o.elitism ?? 2), ...extra], o),
    ...tokenKeys
  );
}
const threeTokens = [mmCard("t1", P1), mmCard("t2", P1), mmCard("t3", P1)];

clause(PARTY, "0:extraCost", "deplete 3 Micromajig tokens: the three picked tokens are depleted as the cost is paid (before responses), and the numeric cost 2 is still paid", () => {
  const g = partyBoard(threeTokens, ["t1", "t2", "t3"]);
  playRaw(g.engine, P1, g.id("party"), { selected: { tok: [g.id("t1"), g.id("t2"), g.id("t3")] } });
  for (const k of ["t1", "t2", "t3"]) assert.equal(card(g.engine, g.id(k)).depleted, true, `${k} depleted at once`);
  assert.equal(ready(g.engine), 0, "cost 2 paid");
  resolvePendingResponses(g.engine);
});

clause(PARTY, "0:extraCost", "'you may': with no tokens picked nothing is depleted, even if I control three ready tokens", () => {
  const g = partyBoard(threeTokens, ["t1", "t2", "t3"]);
  play(g.engine, P1, g.id("party"));
  for (const k of ["t1", "t2", "t3"]) assert.equal(card(g.engine, g.id(k)).depleted, false, `${k} stays ready`);
  assert.equal(ready(g.engine), 0, "cost 2 paid");
  assert.equal(micromajigTokens(g.engine, P1).length, 4);
});

clause(PARTY, "0:extraCost", "it is 3 tokens or none: picking 1, 2 or 4 is refused, and nothing is depleted by the refusal", () => {
  const four = [...threeTokens, mmCard("t4", P1)];
  for (const picks of [["t1"], ["t1", "t2"], ["t1", "t2", "t3", "t4"]]) {
    const g = partyBoard(four, ["t1", "t2", "t3", "t4"]);
    refused(() => play(g.engine, P1, g.id("party"), { selected: { tok: picks.map((k) => g.id(k)) } }), `${picks.length} tokens`);
    assert.equal(zoneOf(g.engine, g.id("party")), "hand");
    assert.equal(card(g.engine, g.id("t1")).depleted, false);
  }
  const ok = partyBoard(four, ["t1", "t2", "t3", "t4"]);
  play(ok.engine, P1, ok.id("party"), { selected: { tok: [ok.id("t2"), ok.id("t3"), ok.id("t4")] } });
  assert.equal(card(ok.engine, ok.id("t1")).depleted, false, "control: exactly three");
  assert.equal(card(ok.engine, ok.id("t2")).depleted, true);
});

clause(PARTY, "0:extraCost", "only ready Micromajig tokens I control can be depleted: a depleted token, the opponent's token, a non-token Micromajig and another token are refused", () => {
  const bad: Array<[string, CardPlacement]> = [
    ["theirs", mmCard("x", P2)],
    ["plain", { key: "x", def: character({ name: "Micromajig", strength: 1, life: 1, speed: 3 }), owner: P1, zone: "play" }],
    ["other token", { key: "x", def: character({ name: "Demon" }), owner: P1, zone: "play" }],
    ["depleted", { ...mmCard("x", P1), depleted: true }]
  ];
  for (const [why, extraCard] of bad) {
    const g = partyBoard([mmCard("t1", P1), mmCard("t2", P1), extraCard], ["t1", "t2", ...(why === "plain" ? [] : ["x"])]);
    refused(() => play(g.engine, P1, g.id("party"), { selected: { tok: [g.id("t1"), g.id("t2"), g.id("x")] } }), why);
    assert.equal(zoneOf(g.engine, g.id("party")), "hand", why);
  }
  const ok = partyBoard([mmCard("t1", P1), mmCard("t2", P1), mmCard("x", P1)], ["t1", "t2", "x"]);
  play(ok.engine, P1, ok.id("party"), { selected: { tok: [ok.id("t1"), ok.id("t2"), ok.id("x")] } });
  assert.equal(zoneOf(ok.engine, ok.id("party")), "hand", "control: three of my ready tokens");
});

clause(PARTY, "0:extraCost", "a token the opponent owns but I control counts as 'you control'", () => {
  const g = partyBoard([mmCard("t1", P1), mmCard("t2", P1), mmCard("stolen", P2, P1)], ["t1", "t2", "stolen"]);
  play(g.engine, P1, g.id("party"), { selected: { tok: [g.id("t1"), g.id("t2"), g.id("stolen")] } });
  assert.equal(card(g.engine, g.id("stolen")).depleted, true);
});

clause(PARTY, "0:extraCost", "the numeric cost 2 and the [E][E] threshold are required: one resource is short, two Rage lack the threshold", () => {
  const short = partyBoard([], [], { elitism: 1 });
  refused(() => play(short.engine, P1, short.id("party")), "one resource is short");
  const noThreshold = duo([{ key: "party", def: printing(PARTY), owner: P1, zone: "hand" }, ...bank("rage", 2)]);
  refused(() => play(noThreshold.engine, P1, noThreshold.id("party")), "threshold [E][E] missing");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("party")), "hand");
  const oneElitism = duo([{ key: "party", def: printing(PARTY), owner: P1, zone: "hand" }, ...bank("elitism", 1), ...bank("rage", 1)]);
  refused(() => play(oneElitism.engine, P1, oneElitism.id("party")), "only one [E]");
});

clause(PARTY, "1:rule", "puts a Micromajig token into play under my control, and the Party goes to the discard pile when no tokens were depleted", () => {
  const g = partyBoard([]);
  play(g.engine, P1, g.id("party"));
  const toks = micromajigTokens(g.engine);
  assert.equal(toks.length, 1);
  assert.equal(toks[0].controllerId, P1);
  assert.deepEqual(stats(g.engine, toks[0].id), [1, 1, 3]);
  assert.equal(toks[0].depleted, false);
  assert.equal(zoneOf(g.engine, g.id("party")), "discard");
  assert.ok(!handOf(g.engine, P1).includes(g.id("party")), "!handOf(g.engine, P1).includes(party)");
});

clause(PARTY, "1:rule", "if I depleted 3 tokens as part of the cost, the Party returns to its owner's hand instead of the discard pile (and the new token still enters)", () => {
  const g = partyBoard(threeTokens, ["t1", "t2", "t3"]);
  play(g.engine, P1, g.id("party"), { selected: { tok: [g.id("t1"), g.id("t2"), g.id("t3")] } });
  assert.equal(zoneOf(g.engine, g.id("party")), "hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("party")), "handOf(g.engine, P1).includes(party)");
  assert.ok(!discardOf(g.engine, P1).includes(g.id("party")), "!discardOf(g.engine, P1).includes(party)");
  assert.equal(micromajigTokens(g.engine, P1).length, 4, "the new token entered");
  assert.equal(micromajigTokens(g.engine, P1).filter((t) => !t.depleted).length, 1, "the new token is ready; the three are depleted");
});

clause(PARTY, "1:rule", "the Party stays in the discard pile when I did not deplete tokens, even with three ready tokens and in someone else's turn flow", () => {
  const g = partyBoard(threeTokens, ["t1", "t2", "t3"]);
  play(g.engine, P1, g.id("party"), { selected: { tok: [] } });
  assert.equal(zoneOf(g.engine, g.id("party")), "discard");
  assert.equal(micromajigTokens(g.engine, P1).length, 4);
});

// =============================================================================
// Mindrender
// character, arcanist, subtype demon, cost 3, threshold [O], 2 strength / 3 speed / 1 life
// COVERT
// When an opponent discards a card, you may reveal this card from your hand. If you do, you may deploy it for 1.
// =============================================================================

clause(MINDRENDER, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(MINDRENDER));
clause(MINDRENDER, "0:kw:COVERT", "cannot be blocked by non-covert characters; covert ones can", () => covertCannotBeBlockedByNonCovert(MINDRENDER));
clause(MINDRENDER, "0:kw:COVERT", "a party needs every member covert to be a covert party", () => covertPartyNeedsEveryMemberCovert(MINDRENDER));
clause(MINDRENDER, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(MINDRENDER));

/** Answers a Mindrender prompt chain with "yes" to every may (pay/deploy), the opponent's discard pick with `discardKey`. */
const yes = (pc: { kind: string; [k: string]: unknown }): unknown => {
  if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
  if (pc.kind === "deployForFree") return { kind: "deployForFree", cardId: (pc.candidates as string[])[0] };
  return declineAll(pc);
};

function mindBoard(o: { obsession?: number; rage?: number; mindZone?: "hand" | "play" | "discard" | "deck"; active?: PlayerId } = {}) {
  return duo(
    [
      { key: "mind", def: printing(MINDRENDER), owner: P1, zone: o.mindZone ?? "hand" },
      { key: "mk", def: OPP_DISCARDS, owner: P1, zone: "hand" },
      { key: "sd", def: SELF_DISCARDS, owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "MyCard" }), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "TheirCard" }), owner: P2, zone: "hand" },
      ...bank("obsession", o.obsession ?? 0),
      ...bank("rage", o.rage ?? 0)
    ],
    { active: o.active }
  );
}
/** P1 plays Make Discard: P2 discards `theirs`. */
function opponentDiscards(g: Game): void {
  play(g.engine, P1, g.id("mk"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("theirs")] });
}

clause(MINDRENDER, "1:rule", "printed card: cost 3 with [O], stats 2/1/3", () => {
  const ok = duo([{ key: "m", def: printing(MINDRENDER), owner: P1, zone: "hand" }, ...bank("obsession", 3)]);
  play(ok.engine, P1, ok.id("m"));
  assert.equal(zoneOf(ok.engine, ok.id("m")), "play");
  assert.equal(ready(ok.engine), 0);
  assert.deepEqual(stats(ok.engine, ok.id("m")), [2, 1, 3]);
  assert.deepEqual(printing(MINDRENDER).subtype, ["demon"]);
  const short = duo([{ key: "m", def: printing(MINDRENDER), owner: P1, zone: "hand" }, ...bank("obsession", 2)]);
  refused(() => play(short.engine, P1, short.id("m")), "cost 3 with two resources");
  const noThreshold = duo([{ key: "m", def: printing(MINDRENDER), owner: P1, zone: "hand" }, ...bank("rage", 3)]);
  refused(() => play(noThreshold.engine, P1, noThreshold.id("m")), "[O] missing");
});

clause(MINDRENDER, "1:rule", "when the opponent discards a card I may reveal Mindrender from my hand and deploy it for 1: it enters play, exactly 1 is paid, and it is revealed", () => {
  const g = mindBoard({ obsession: 3 });
  opponentDiscards(g);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  drain(g.engine, yes);
  assert.equal(zoneOf(g.engine, g.id("mind")), "play", "deployed from hand");
  assert.equal(card(g.engine, g.id("mind")).controllerId, P1);
  assert.equal(ready(g.engine), 2, "3 - 1: it was deployed for 1 (not free, not its printed 3)");
  assert.ok(reveals(g.engine).length >= 1, "the card was revealed");
});

clause(MINDRENDER, "1:rule", "declining: Mindrender stays in my hand and nothing is paid", () => {
  const g = mindBoard({ obsession: 3 });
  opponentDiscards(g);
  const pc = pending(g.engine);
  assert.ok(pc, "the controller is offered the reveal");
  assert.equal(pc.playerId, P1);
  drain(g.engine, (c) => (c.kind === "mayPay" ? { kind: "mayPay", pay: false } : declineAll(c)));
  assert.equal(zoneOf(g.engine, g.id("mind")), "hand");
  assert.equal(ready(g.engine), 3, "nothing paid");
  assert.equal(reveals(g.engine).length, 0, "and it was not revealed");
});

clause(MINDRENDER, "1:rule", "it triggers for any discard by an opponent, including one they choose to make themselves", () => {
  const selfDiscard = tactic({
    name: "Their Self Discard",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sd",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "d", selector: { controller: "self", zone: "hand" }, count: 1 },
              effects: [{ type: "forEach", selected: "d", effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }] }]
            }
          ]
        }
      ]
    }
  });
  const g = duo(
    [
      { key: "mind", def: printing(MINDRENDER), owner: P1, zone: "hand" },
      { key: "tsd", def: selfDiscard, owner: P2, zone: "hand" },
      { key: "theirs", def: character({ name: "TheirCard" }), owner: P2, zone: "hand" },
      ...bank("obsession", 3)
    ],
    { active: P2, turn: 2 }
  );
  play(g.engine, P2, g.id("tsd"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("theirs")] });
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  drain(g.engine, yes);
  assert.equal(zoneOf(g.engine, g.id("mind")), "play", "deployed during the opponent's turn");
  assert.equal(ready(g.engine), 2);
});

clause(MINDRENDER, "1:rule", "near misses: my own discard, or Mindrender anywhere but my hand, offers nothing", () => {
  const mine = mindBoard({ obsession: 3 });
  play(mine.engine, P1, mine.id("sd"));
  answerPending(mine.engine, "chooserSelectsTarget", { selected: [mine.id("mine")] });
  assert.equal(zoneOf(mine.engine, mine.id("mine")), "discard");
  assert.equal(mine.engine.state.pendingChoice, undefined, "my own discard does not trigger it");
  assert.equal(zoneOf(mine.engine, mine.id("mind")), "hand");

  for (const zone of ["play", "discard", "deck"] as const) {
    const g = mindBoard({ obsession: 3, mindZone: zone });
    opponentDiscards(g);
    assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
    assert.equal(g.engine.state.pendingChoice, undefined, `Mindrender in ${zone}: nothing is offered`);
    assert.equal(zoneOf(g.engine, g.id("mind")), zone);
  }
});

/** Accepts the reveal (and, if one is asked, the separate deploy confirmation), tolerating a refused deploy. */
function acceptReveal(g: Game): void {
  const first = pending(g.engine);
  assert.ok(first, "the controller is offered Mindrender's trigger");
  g.engine.perform({ type: "resolvePendingChoice", playerId: first.playerId, choice: { kind: "mayPay", pay: true } } as never);
  resolvePendingResponses(g.engine);
  const next = pending(g.engine);
  if (next?.kind === "deployForFree") {
    try {
      g.engine.perform({ type: "resolvePendingChoice", playerId: next.playerId, choice: { kind: "deployForFree", cardId: (next.candidates as string[])[0] } } as never);
    } catch {
      /* a refused deploy (threshold) leaves the prompt open */
    }
    resolvePendingResponses(g.engine);
  }
}

clause(MINDRENDER, "1:rule", "'deploy it for 1' keeps the [O] threshold: with only Rage resources Mindrender does not enter play", () => {
  const g = mindBoard({ rage: 3 });
  opponentDiscards(g);
  acceptReveal(g);
  assert.equal(zoneOf(g.engine, g.id("mind")), "hand", "no [O]: the threshold is not met, so it is not deployed");
});

clause(
  MINDRENDER,
  "1:rule",
  "'deploy it for 1': the 1 is the deploy's cost, so a deploy that cannot happen (no [O]) costs nothing",
  () => {
    const g = mindBoard({ rage: 3 });
    opponentDiscards(g);
    acceptReveal(g);
    assert.equal(zoneOf(g.engine, g.id("mind")), "hand");
    assert.equal(ready(g.engine), 3, "nothing was deployed, so nothing is paid");
  }
);

clause(
  MINDRENDER,
  "1:rule",
  "'you may reveal this card' costs nothing: the reveal is offered even when I have no resources",
  () => {
    const none = mindBoard({});
    opponentDiscards(none);
    const pc = pending(none.engine);
    assert.ok(pc, "the reveal is offered even though I cannot pay 1");
    assert.equal(pc.playerId, P1);
  }
);

clause(
  MINDRENDER,
  "1:rule",
  "'If you do, you may deploy it for 1' is a second may: after revealing I can decline the deploy and pay nothing",
  () => {
    const g = mindBoard({ obsession: 3 });
    opponentDiscards(g);
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } } as never);
    resolvePendingResponses(g.engine);
    const next = pending(g.engine);
    if (next) g.engine.perform({ type: "resolvePendingChoice", playerId: next.playerId, choice: { kind: next.kind } } as never);
    resolvePendingResponses(g.engine);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("mind")), "hand", "declined the deploy");
    assert.equal(ready(g.engine), 3, "revealed but not deployed: nothing was paid");
    assert.ok(reveals(g.engine).length >= 1, "it was revealed");
  }
);

const revealedIds = (engine: SpoilsEngine): string[] =>
  reveals(engine).flatMap((entry) => ((entry.event as unknown as { cardIds: string[] }).cardIds ?? []) as string[]);
const resCard = (name: string, icon: "rage" | "greed" = "rage") =>
  resourceCard({ name, resource: { provides: [icon], staple: true } });

// =============================================================================
// Montgomery Blatherscythe
// character, banker, subtype mau, cost 1, threshold [G][G][G], 1 strength / 3 speed / 1 life
// UNIQUE MONTGOMERY
// RESURRECT -- COST: Pay 1. Deplete this card. Pick a character in your discard pile with numeric cost 2 or less.
//   EFFECT: Put the character into play under your control.
// =============================================================================

function montyBoard(extra: CardPlacement[] = [], o: DuoOpts & { greed?: number; depleted?: boolean; zone?: "play" | "hand" } = {}) {
  return duo(
    [
      { key: "m", def: printing(MONTGOMERY), owner: P1, zone: o.zone ?? "play", depleted: o.depleted },
      ...bank("greed", o.greed ?? 2),
      ...extra
    ],
    o
  );
}
const costed = (name: string, cost: number) => character({ name, cost, strength: 1, life: 3, speed: 1 });
const resurrect = (g: Game, pick: string[]) => activate(g.engine, P1, g.id("m"), "resurrect", { selected: { c: pick.map((k) => g.id(k)) } });

clause(MONTGOMERY, "0:unique", "printed card: deploys for 1 with [G][G][G] (two Greed are not enough), stats 1/1/3", () => {
  const ok = montyBoard([], { zone: "hand", greed: 3 });
  play(ok.engine, P1, ok.id("m"));
  assert.equal(zoneOf(ok.engine, ok.id("m")), "play");
  assert.equal(ready(ok.engine), 2, "cost 1 paid");
  assert.deepEqual(stats(ok.engine, ok.id("m")), [1, 1, 3]);
  const short = montyBoard([], { zone: "hand", greed: 2 });
  refused(() => play(short.engine, P1, short.id("m")), "[G][G][G] needs three Greed");
  const wrongIcons = duo([{ key: "m", def: printing(MONTGOMERY), owner: P1, zone: "hand" }, ...bank("greed", 1), ...bank("rage", 2)]);
  refused(() => play(wrongIcons.engine, P1, wrongIcons.id("m")), "one Greed and two Rage");
});

clause(MONTGOMERY, "0:unique", "a second Montgomery makes me keep one: the controller chooses, the other is destroyed", () => {
  const g = montyBoard([{ key: "m2", def: printing(MONTGOMERY), owner: P1, zone: "hand" }], { greed: 3 });
  play(g.engine, P1, g.id("m2"));
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [g.id("m"), g.id("m2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("m2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("m2")), "play");
  assert.equal(zoneOf(g.engine, g.id("m")), "discard", "the other one is destroyed");

  const keepOld = montyBoard([{ key: "m2", def: printing(MONTGOMERY), owner: P1, zone: "hand" }], { greed: 3 });
  play(keepOld.engine, P1, keepOld.id("m2"));
  keepOld.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: keepOld.id("m") } } as never);
  assert.equal(zoneOf(keepOld.engine, keepOld.id("m")), "play");
  assert.equal(zoneOf(keepOld.engine, keepOld.id("m2")), "discard");
});

clause(MONTGOMERY, "0:unique", "the restriction is per player and per designation: the opponent's Montgomery and a card with another designation are no duplicates", () => {
  const g = montyBoard([
    { key: "theirs", def: printing(MONTGOMERY), owner: P2, zone: "play" },
    { key: "other", def: character({ name: "Other", unique: "someone else" } as never), owner: P1, zone: "play" }
  ]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("m")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
});

clause(MONTGOMERY, "1:ability:resurrect", "the costs are paid when activated: 1 resource, Montgomery depleted; the effect then puts the character into play under my control", () => {
  const g = montyBoard([{ key: "dead", def: costed("Dead", 1), owner: P1, zone: "discard" }]);
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("m"), abilityId: "resurrect", selected: { c: [g.id("dead")] }, variables: {} } as never);
  assert.equal(card(g.engine, g.id("m")).depleted, true, "deplete paid at once");
  assert.equal(ready(g.engine), 1, "pay 1 paid at once");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("dead")), "play");
  assert.equal(card(g.engine, g.id("dead")).controllerId, P1);
  assert.ok(!discardOf(g.engine, P1).includes(g.id("dead")), "!discardOf(g.engine, P1).includes(dead)");
});

clause(MONTGOMERY, "1:ability:resurrect", "numeric cost 2 or less: cost 0, 1 and 2 characters can be picked, a cost 3 character cannot", () => {
  for (const cost of [0, 1, 2]) {
    const g = montyBoard([{ key: "dead", def: costed(`Dead ${cost}`, cost), owner: P1, zone: "discard" }]);
    resurrect(g, ["dead"]);
    assert.equal(zoneOf(g.engine, g.id("dead")), "play", `cost ${cost}`);
  }
  const g = montyBoard([
    { key: "big", def: costed("Big", 3), owner: P1, zone: "discard" },
    { key: "ok", def: costed("Ok", 2), owner: P1, zone: "discard" }
  ]);
  refused(() => resurrect(g, ["big"]), "numeric cost 3");
  assert.equal(zoneOf(g.engine, g.id("big")), "discard");
  assert.equal(card(g.engine, g.id("m")).depleted, false, "nothing was paid");
  assert.equal(ready(g.engine), 2);
  resurrect(g, ["ok"]);
  assert.equal(zoneOf(g.engine, g.id("ok")), "play", "control: the cost 2 character");
});

clause(MONTGOMERY, "1:ability:resurrect", "only characters in MY discard pile: the opponent's discard, an item, and characters in hand, deck or play are refused", () => {
  const g = montyBoard([
    { key: "theirs", def: costed("Theirs", 1), owner: P2, zone: "discard" },
    { key: "gizmo", def: item({ name: "Gizmo", cost: 1 }), owner: P1, zone: "discard" },
    { key: "inHand", def: costed("InHand", 1), owner: P1, zone: "hand" },
    { key: "inDeck", def: costed("InDeck", 1), owner: P1, zone: "deck" },
    { key: "inPlay", def: costed("InPlay", 1), owner: P1, zone: "play" },
    { key: "ok", def: costed("Ok", 1), owner: P1, zone: "discard" }
  ]);
  for (const bad of ["theirs", "gizmo", "inHand", "inDeck", "inPlay"]) {
    refused(() => resurrect(g, [bad]), bad);
    assert.equal(card(g.engine, g.id("m")).depleted, false, `${bad}: nothing paid`);
  }
  assert.equal(zoneOf(g.engine, g.id("theirs")), "discard");
  resurrect(g, ["ok"]);
  assert.equal(zoneOf(g.engine, g.id("ok")), "play", "control");
});

clause(MONTGOMERY, "1:ability:resurrect", "needs 1 resource and an untapped Montgomery, and can be used once until it is restored", () => {
  const none = montyBoard([{ key: "dead", def: costed("Dead", 1), owner: P1, zone: "discard" }], { greed: 0 });
  refused(() => resurrect(none, ["dead"]), "no resource to pay 1");
  assert.equal(zoneOf(none.engine, none.id("dead")), "discard");

  const tapped = montyBoard([{ key: "dead", def: costed("Dead", 1), owner: P1, zone: "discard" }], { depleted: true });
  refused(() => resurrect(tapped, ["dead"]), "Montgomery is depleted");
  assert.equal(ready(tapped.engine), 2);

  const twice = montyBoard([
    { key: "d1", def: costed("D1", 1), owner: P1, zone: "discard" },
    { key: "d2", def: costed("D2", 1), owner: P1, zone: "discard" }
  ]);
  resurrect(twice, ["d1"]);
  refused(() => resurrect(twice, ["d2"]), "depleted by the first use");
  assert.equal(zoneOf(twice.engine, twice.id("d2")), "discard");
});

clause(MONTGOMERY, "1:ability:resurrect", "the character really enters play: its enters-play trigger fires (Peaceful Mau gains 3 influence)", () => {
  const g = montyBoard([{ key: "pm", def: printing(PEACEFUL), owner: P1, zone: "discard" }]);
  const before = inf(g.engine, P1);
  resurrect(g, ["pm"]);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("pm")), "play");
  assert.equal(inf(g.engine, P1), before + 3);
});

// =============================================================================
// Mr. Green Thumb
// character, banker, subtype mau + environmentalist, cost 2, threshold [G], 1 strength / 3 speed / 1 life
// When this card enters play, reveal the top 4 cards of your deck. Put up to two resources revealed this way into
// your hand. Put the remaining cards into your discard pile.
// =============================================================================

/** Deck (top to bottom): r0 (resource), n0, r1 (resource), r2 (resource) | r3 (resource, the fifth card: NOT revealed), n1, n2, n3. */
function thumbBoard(o: { deck?: "full" | "short"; zone?: "hand" | "play" } = {}) {
  const deck: CardPlacement[] =
    o.deck === "short"
      ? [
          { key: "r0", def: resCard("Res 0"), owner: P1, zone: "deck" },
          { key: "n0", def: character({ name: "Non 0" }), owner: P1, zone: "deck" }
        ]
      : [
          { key: "r0", def: resCard("Res 0"), owner: P1, zone: "deck" },
          { key: "n0", def: character({ name: "Non 0" }), owner: P1, zone: "deck" },
          { key: "r1", def: resCard("Res 1"), owner: P1, zone: "deck" },
          { key: "r2", def: resCard("Res 2"), owner: P1, zone: "deck" },
          { key: "r3", def: resCard("Res 3"), owner: P1, zone: "deck" },
          { key: "n1", def: character({ name: "Non 1" }), owner: P1, zone: "deck" },
          { key: "n2", def: character({ name: "Non 2" }), owner: P1, zone: "deck" },
          { key: "n3", def: character({ name: "Non 3" }), owner: P1, zone: "deck" }
        ];
  const g = duo([{ key: "t", def: printing(THUMB), owner: P1, zone: o.zone ?? "hand" }, ...bank("greed", 2), ...deck]);
  return g;
}
const topOf = (g: Game, keys: string[]) => keys.map((k) => g.id(k));

clause(THUMB, "0:rule", "printed card: deploys for 2 with [G], stats 1/1/3, subtypes mau and environmentalist", () => {
  const g = thumbBoard();
  play(g.engine, P1, g.id("t"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("t")), "play");
  assert.equal(ready(g.engine), 0, "cost 2");
  assert.deepEqual(stats(g.engine, g.id("t")), [1, 1, 3]);
  assert.deepEqual(printing(THUMB).subtype, ["mau", "environmentalist"]);
  const noGreed = duo([{ key: "t", def: printing(THUMB), owner: P1, zone: "hand" }, ...bank("rage", 2)]);
  refused(() => play(noGreed.engine, P1, noGreed.id("t")), "[G] missing");
  const short = duo([{ key: "t", def: printing(THUMB), owner: P1, zone: "hand" }, ...bank("greed", 1)]);
  refused(() => play(short.engine, P1, short.id("t")), "cost 2 with one resource");
});

clause(THUMB, "0:rule", "reveals the top 4 cards of my deck, puts up to two revealed resources into my hand and the rest of the revealed cards into my discard pile", () => {
  const g = thumbBoard();
  assert.deepEqual(deckOf(g.engine, P1).slice(0, 4), topOf(g, ["r0", "n0", "r1", "r2"]), "board check: the first four placed are the top four");
  const before = deckOf(g.engine, P1).length;
  play(g.engine, P1, g.id("t"));
  const pc = pending(g.engine);
  assert.ok(pc, "I am asked which revealed resources to take");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...revealedIds(g.engine)].sort(), topOf(g, ["r0", "n0", "r1", "r2"]).sort(), "exactly the top four were revealed");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("r0"), g.id("r2")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual([...handOf(g.engine, P1)].sort(), [g.id("r0"), g.id("r2")].sort(), "the two picked resources are in my hand");
  assert.deepEqual([...discardOf(g.engine, P1)].sort(), [g.id("n0"), g.id("r1")].sort(), "the other two revealed cards are discarded");
  assert.equal(deckOf(g.engine, P1).length, before - 4, "four cards left the deck");
  assert.equal(deckOf(g.engine, P1)[0], g.id("r3"), "the fifth card is still on top");
});

clause(THUMB, "0:rule", "'up to two': taking one resource, or none, discards every other revealed card", () => {
  const one = thumbBoard();
  play(one.engine, P1, one.id("t"));
  answerPending(one.engine, "chooserSelectsTarget", { selected: [one.id("r1")] });
  assert.deepEqual(handOf(one.engine, P1), [one.id("r1")]);
  assert.deepEqual([...discardOf(one.engine, P1)].sort(), [one.id("r0"), one.id("n0"), one.id("r2")].sort());
  assert.equal(deckOf(one.engine, P1).length, 4);

  const none = thumbBoard();
  play(none.engine, P1, none.id("t"));
  answerPending(none.engine, "chooserSelectsTarget", { selected: [] });
  assert.deepEqual(handOf(none.engine, P1), [], "I took nothing");
  assert.deepEqual([...discardOf(none.engine, P1)].sort(), topOf(none, ["r0", "n0", "r1", "r2"]).sort(), "all four revealed cards are discarded");
  assert.equal(deckOf(none.engine, P1).length, 4);
});

clause(THUMB, "0:rule", "only revealed resources can be taken, at most two: a non-resource, a third resource, or a resource below the top 4 is refused", () => {
  const attempts: Array<[string, string[]]> = [
    ["a revealed non-resource", ["n0"]],
    ["a resource with a non-resource", ["r0", "n0"]],
    ["three resources", ["r0", "r1", "r2"]],
    ["the fifth card down (a resource that was not revealed)", ["r3"]]
  ];
  for (const [why, picks] of attempts) {
    const g = thumbBoard();
    play(g.engine, P1, g.id("t"));
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: picks.map((k) => g.id(k)) }), why);
  }
  const ok = thumbBoard();
  play(ok.engine, P1, ok.id("t"));
  answerPending(ok.engine, "chooserSelectsTarget", { selected: [ok.id("r0"), ok.id("r1")] });
  assert.deepEqual([...handOf(ok.engine, P1)].sort(), [ok.id("r0"), ok.id("r1")].sort(), "control");
  assert.equal(zoneOf(ok.engine, ok.id("r3")), "deck", "the unrevealed resource stays in the deck");
});

clause(THUMB, "0:rule", "with fewer than four cards in the deck it reveals what is there", () => {
  const g = thumbBoard({ deck: "short" });
  play(g.engine, P1, g.id("t"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("r0")] });
  assert.deepEqual(handOf(g.engine, P1), [g.id("r0")]);
  assert.deepEqual(discardOf(g.engine, P1), [g.id("n0")]);
  assert.deepEqual(deckOf(g.engine, P1), []);
});

clause(THUMB, "0:rule", "it is an enters-play trigger: it fires when put into play by an effect, and not when another card enters play", () => {
  const viaEffect = duo([
    { key: "t", def: printing(THUMB), owner: P1, zone: "hand" },
    { key: "put", def: PUT_FROM_HAND, owner: P1, zone: "hand" },
    { key: "r0", def: resCard("Res 0"), owner: P1, zone: "deck" },
    { key: "n0", def: character({ name: "Non 0" }), owner: P1, zone: "deck" }
  ]);
  play(viaEffect.engine, P1, viaEffect.id("put"), { selected: { c: [viaEffect.id("t")] } });
  assert.equal(pending(viaEffect.engine)?.kind, "chooserSelectsTarget", "put into play: it entered play, so the reveal happens");

  const other = duo([
    { key: "t", def: printing(THUMB), owner: P1, zone: "play" },
    { key: "c", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
    { key: "r0", def: resCard("Res 0"), owner: P1, zone: "deck" }
  ]);
  play(other.engine, P1, other.id("c"));
  assert.equal(other.engine.state.pendingChoice, undefined, "another card entering play does nothing");
  assert.equal(zoneOf(other.engine, other.id("r0")), "deck");
});

// =============================================================================
// Mutineer's Hiatus
// tactic, banker, cost 1, threshold [G]
// EXTRA COST: Destroy a character you own.
// Draw 2 cards.
// RECUR: [G] -- COST: Pay 2. Void this card from your discard pile. Pick a character you own.
//   EFFECT: Destroy the character. Draw a card.
// =============================================================================

function hiatusBoard(o: { zone?: "hand" | "discard" | "void"; greed?: number; rage?: number; chars?: boolean } = {}) {
  return duo([
    { key: "h", def: printing(HIATUS), owner: P1, zone: o.zone ?? "hand" },
    ...bank("greed", o.greed ?? 1),
    ...bank("rage", o.rage ?? 0),
    ...(o.chars === false
      ? []
      : ([
          { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
          { key: "other", def: character({ name: "Other", life: 3 }), owner: P1, zone: "play" },
          { key: "theirs", def: character({ name: "Theirs", life: 3 }), owner: P2, zone: "play" },
          { key: "lent", def: character({ name: "Lent", life: 3 }), owner: P1, zone: "play", controller: P2 },
          { key: "stolen", def: character({ name: "Stolen", life: 3 }), owner: P2, zone: "play", controller: P1 }
        ] as CardPlacement[])),
    { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "play" },
    ...fillers("dk", 5, P1, "deck")
  ]);
}

clause(HIATUS, "0:extraCost", "the character is destroyed as part of the cost, before responses, along with the numeric cost 1", () => {
  const g = hiatusBoard();
  playRaw(g.engine, P1, g.id("h"), { selected: { c: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "destroyed at once");
  assert.equal(ready(g.engine), 0, "cost 1 paid");
  assert.equal(handOf(g.engine, P1).length, 0, "nothing drawn yet: the card is still waiting for responses");
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P1).length, 2);
});

clause(HIATUS, "0:extraCost", "'a character you own': my own characters qualify (even one the opponent controls), the opponent's do not (even one I control)", () => {
  for (const ownKey of ["mine", "lent"]) {
    const g = hiatusBoard();
    play(g.engine, P1, g.id("h"), { selected: { c: [g.id(ownKey)] } });
    assert.equal(zoneOf(g.engine, g.id(ownKey)), "discard", ownKey);
    assert.equal(handOf(g.engine, P1).length, 2, `${ownKey}: the card resolved`);
  }
  for (const foreign of ["theirs", "stolen"]) {
    const g = hiatusBoard();
    refused(() => play(g.engine, P1, g.id("h"), { selected: { c: [g.id(foreign)] } }), foreign);
    assert.equal(zoneOf(g.engine, g.id("h")), "hand");
    assert.equal(zoneOf(g.engine, g.id(foreign)), "play");
    assert.equal(ready(g.engine), 1, `${foreign}: nothing paid`);
  }
});

clause(HIATUS, "0:extraCost", "a character is required, and only in play: an item, no pick at all, or no character of mine in play is refused", () => {
  const gizmo = hiatusBoard();
  refused(() => play(gizmo.engine, P1, gizmo.id("h"), { selected: { c: [gizmo.id("gizmo")] } }), "an item is not a character");
  const nothing = hiatusBoard();
  refused(() => play(nothing.engine, P1, nothing.id("h")), "no pick");
  assert.equal(zoneOf(nothing.engine, nothing.id("h")), "hand");
  const none = hiatusBoard({ chars: false });
  refused(() => play(none.engine, P1, none.id("h")), "I own no character in play");
  assert.equal(zoneOf(none.engine, none.id("h")), "hand");
  const inDiscard = duo([
    { key: "h", def: printing(HIATUS), owner: P1, zone: "hand" },
    { key: "dead", def: character({ name: "Dead" }), owner: P1, zone: "discard" },
    ...bank("greed", 1),
    ...fillers("dk", 3, P1, "deck")
  ]);
  refused(() => play(inDiscard.engine, P1, inDiscard.id("h"), { selected: { c: [inDiscard.id("dead")] } }), "a character in my discard pile");
});

clause(HIATUS, "0:extraCost", "costs 1 with [G]: no resources or only Rage cannot play it", () => {
  const none = hiatusBoard({ greed: 0 });
  refused(() => play(none.engine, P1, none.id("h"), { selected: { c: [none.id("mine")] } }), "no resource");
  assert.equal(zoneOf(none.engine, none.id("mine")), "play");
  const rage = hiatusBoard({ greed: 0, rage: 1 });
  refused(() => play(rage.engine, P1, rage.id("h"), { selected: { c: [rage.id("mine")] } }), "[G] missing");
  assert.equal(zoneOf(rage.engine, rage.id("mine")), "play");
});

clause(HIATUS, "1:rule", "draws exactly 2 cards (the top two of my deck), and the tactic goes to the discard pile", () => {
  const g = hiatusBoard();
  const top = deckOf(g.engine, P1).slice(0, 2);
  const oppHand = handOf(g.engine, P2).length;
  play(g.engine, P1, g.id("h"), { selected: { c: [g.id("mine")] } });
  assert.deepEqual(handOf(g.engine, P1), top, "the top two cards");
  assert.equal(deckOf(g.engine, P1).length, 3);
  assert.equal(zoneOf(g.engine, g.id("h")), "discard");
  assert.equal(handOf(g.engine, P2).length, oppHand, "the opponent draws nothing");
});

function recurOnce(g: Game, pick: string) {
  activate(g.engine, P1, g.id("h"), "recur", { selected: { rc: [g.id(pick)] } });
}

clause(HIATUS, "2:ability:recur", "from the discard pile: pay 2, void the card as a cost; the character is destroyed and I draw 1", () => {
  const g = hiatusBoard({ zone: "discard", greed: 2 });
  const top = deckOf(g.engine, P1)[0];
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("h"), abilityId: "recur", selected: { rc: [g.id("mine")] }, variables: {} } as never);
  assert.equal(zoneOf(g.engine, g.id("h")), "void", "voided from the discard pile as a cost");
  assert.equal(ready(g.engine), 0, "pay 2");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "the destroy is the effect, not the cost");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.deepEqual(handOf(g.engine, P1), [top], "drew exactly one card");
  assert.equal(deckOf(g.engine, P1).length, 4);
});

clause(HIATUS, "2:ability:recur", "the picked character must be one I own (a lent one qualifies, the opponent's and a stolen one do not) and a character", () => {
  const lent = hiatusBoard({ zone: "discard", greed: 2 });
  recurOnce(lent, "lent");
  assert.equal(zoneOf(lent.engine, lent.id("lent")), "discard");
  for (const bad of ["theirs", "stolen", "gizmo"]) {
    const g = hiatusBoard({ zone: "discard", greed: 2 });
    refused(() => recurOnce(g, bad), bad);
    assert.equal(zoneOf(g.engine, g.id("h")), "discard", `${bad}: not voided`);
    assert.equal(ready(g.engine), 2, `${bad}: nothing paid`);
  }
  const none = hiatusBoard({ zone: "discard", greed: 2, chars: false });
  refused(() => none.engine.perform({ type: "activateAbility", playerId: P1, cardId: none.id("h"), abilityId: "recur", selected: {}, variables: {} } as never), "no character to pick");
  assert.equal(zoneOf(none.engine, none.id("h")), "discard");
});

clause(HIATUS, "2:ability:recur", "only from the discard pile: not from hand, and not again from the void", () => {
  const hand = hiatusBoard({ zone: "hand", greed: 2 });
  refused(() => recurOnce(hand, "mine"), "in hand", /zone .discard./);
  assert.equal(zoneOf(hand.engine, hand.id("mine")), "play");
  const voided = hiatusBoard({ zone: "void", greed: 2 });
  refused(() => recurOnce(voided, "mine"), "in the void", /zone .discard./);
  assert.equal(zoneOf(voided.engine, voided.id("mine")), "play");
  const ok = hiatusBoard({ zone: "discard", greed: 2 });
  recurOnce(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("mine")), "discard", "control");
});

clause(HIATUS, "2:ability:recur", "pay 2 with the [G] threshold: one resource, or two Rage, is not enough; one Greed plus one Rage is", () => {
  const one = hiatusBoard({ zone: "discard", greed: 1 });
  refused(() => recurOnce(one, "mine"), "pay 2 with one resource");
  assert.equal(zoneOf(one.engine, one.id("h")), "discard");
  const rage = hiatusBoard({ zone: "discard", greed: 0, rage: 2 });
  refused(() => recurOnce(rage, "mine"), "[G] threshold missing");
  assert.equal(zoneOf(rage.engine, rage.id("h")), "discard");
  const mixed = hiatusBoard({ zone: "discard", greed: 1, rage: 1 });
  recurOnce(mixed, "mine");
  assert.equal(zoneOf(mixed.engine, mixed.id("mine")), "discard", "one [G] meets the threshold");
  assert.equal(ready(mixed.engine), 0);
});

// =============================================================================
// Mutual Mutilator
// character, warlord, subtype soldier, cost 3, threshold [R], 2 strength / 3 speed / 2 life
// At the start of your turn, inflict 1 damage to all other characters.
// =============================================================================

function mutilatorBoard(extra: CardPlacement[] = [], o: { count?: number } = {}) {
  const mutilators: CardPlacement[] = Array.from({ length: o.count ?? 1 }, (_, i) => ({ key: i === 0 ? "mut" : `mut${i + 1}`, def: printing(MUTILATOR), owner: P1, zone: "play" as const }));
  return duo([
    ...mutilators,
    { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
    { key: "theirs", def: character({ name: "Theirs", life: 3 }), owner: P2, zone: "play" },
    { key: "weak", def: character({ name: "Weak", life: 1 }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place", structure: 3 }), owner: P1, zone: "play" },
    { key: "gizmo", def: item({ name: "Gizmo" }), owner: P2, zone: "play" },
    ...extra
  ]);
}

clause(MUTILATOR, "0:rule", "printed card: deploys for 3 with [R], stats 2/2/3", () => {
  const g = duo([{ key: "m", def: printing(MUTILATOR), owner: P1, zone: "hand" }, ...bank("rage", 3)]);
  play(g.engine, P1, g.id("m"));
  assert.equal(zoneOf(g.engine, g.id("m")), "play");
  assert.equal(ready(g.engine), 0);
  assert.deepEqual(stats(g.engine, g.id("m")), [2, 2, 3]);
  const short = duo([{ key: "m", def: printing(MUTILATOR), owner: P1, zone: "hand" }, ...bank("rage", 2)]);
  refused(() => play(short.engine, P1, short.id("m")), "cost 3 with two resources");
  const wrong = duo([{ key: "m", def: printing(MUTILATOR), owner: P1, zone: "hand" }, ...bank("greed", 3)]);
  refused(() => play(wrong.engine, P1, wrong.id("m")), "[R] missing");
});

clause(MUTILATOR, "0:rule", "at the start of MY turn every other character takes 1 damage (mine and the opponent's), and a 1-life character dies", () => {
  const g = mutilatorBoard();
  endTurn(g.engine, P1);
  assert.equal(damageOn(g.engine, g.id("theirs")), 0, "the opponent's turn start: nothing happens");
  assert.equal(damageOn(g.engine, g.id("mine")), 0);
  assert.equal(zoneOf(g.engine, g.id("weak")), "play");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(damageOn(g.engine, g.id("mine")), 1, "my other character");
  assert.equal(damageOn(g.engine, g.id("theirs")), 1, "the opponent's character");
  assert.equal(zoneOf(g.engine, g.id("weak")), "discard", "1 life, 1 damage: destroyed");
});

clause(MUTILATOR, "0:rule", "'other' characters only: the Mutilator takes no damage, and locations, items and factions are unaffected", () => {
  const g = mutilatorBoard();
  const influences = [inf(g.engine, P1), inf(g.engine, P2)];
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(damageOn(g.engine, g.id("mut")), 0, "the Mutilator itself");
  assert.equal(damageOn(g.engine, g.id("place")), 0, "a location");
  assert.equal(damageOn(g.engine, g.id("gizmo")), 0, "an item");
  assert.deepEqual([inf(g.engine, P1), inf(g.engine, P2)], influences, "factions lose nothing");
});

clause(MUTILATOR, "0:rule", "two Mutilators: each is an 'other' character to the other, and everything else takes 1 damage from each", () => {
  const g = mutilatorBoard([], { count: 2 });
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(damageOn(g.engine, g.id("mut")), 1, "damaged by the other Mutilator only");
  assert.equal(damageOn(g.engine, g.id("mut2")), 1);
  assert.equal(damageOn(g.engine, g.id("mine")), 2);
  assert.equal(damageOn(g.engine, g.id("theirs")), 2);
});

clause(MUTILATOR, "0:rule", "it only works while in play: once the Mutilator is destroyed, my next turn start does no damage", () => {
  const g = mutilatorBoard([{ key: "smite", def: DESTROY_ANY, owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("smite"), { selected: { t: [g.id("mut")] } });
  assert.equal(zoneOf(g.engine, g.id("mut")), "discard");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(damageOn(g.engine, g.id("mine")), 0);
  assert.equal(damageOn(g.engine, g.id("theirs")), 0);
  assert.equal(zoneOf(g.engine, g.id("weak")), "play");
});

// =============================================================================
// Narcissism / Paranoia
// resource, arcanist, cost 0
// When a resource enters play under your control, name [O] icon or [E] icon (Paranoia: [O] icon or [D] icon).
// X is the named icon. This turn, this card gains "PROVIDES: X".
// =============================================================================

type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";
/** The resource a test plays to trigger the name prompt: it provides Greed, so it can't be confused with the named icon. */
const plainGreed = () => resourceCard({ name: "Plain Greed", resource: { provides: ["greed"], staple: true } });
const iconCount = (engine: SpoilsEngine, icon: Icon, p: PlayerId = P1): number => (engine.getThresholds(p) as Record<string, number | undefined>)[icon] ?? 0;

/** The naming card in play, a plain resource in hand, and (optionally) a free tactic that puts a second resource into play. */
function nameBoard(cardId: string, o: { zone?: "play" | "hand"; active?: PlayerId } = {}) {
  return duo(
    [
      { key: "n", def: printing(cardId), owner: P1, zone: o.zone ?? "play" },
      { key: "r", def: plainGreed(), owner: P1, zone: "hand" },
      { key: "r2", def: plainGreed(), owner: P1, zone: "hand" },
      { key: "theirs", def: plainGreed(), owner: P2, zone: "hand" },
      { key: "putRes", def: PUT_RESOURCE, owner: P1, zone: "hand" },
      { key: "putRes2", def: PUT_RESOURCE, owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }
    ],
    { active: o.active, turn: o.active === P2 ? 2 : undefined }
  );
}
/** A free tactic that puts one resource card from its controller's hand into play. */
const PUT_RESOURCE = tactic({
  name: "Put Resource",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "pr",
        type: "activated",
        targets: [{ id: "c", selector: { owner: "self", zone: "hand", type: "resource" }, count: 1 }],
        effects: [{ type: "putIntoPlay", target: { type: "selected", id: "c" }, controller: "controller" }]
      }
    ]
  }
});

const nameOptions = (g: Game): string[] => [...((pending(g.engine) as unknown as { options?: string[] }).options ?? [])].sort();

/** The naming card names one of its two icons when my resource enters; the named icon is provided this turn, once. */
const naming = (cardId: string, a: Icon, b: Icon, excluded: Icon[]) => () => {
  const g = nameBoard(cardId);
  assert.equal(iconCount(g.engine, a), 0);
  developResource(g.engine, P1, g.id("r"), false);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "nameValue", "a resource entered under my control: I am asked to name an icon");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(nameOptions(g), [a, b].sort(), "only the two printed icons can be named");
  for (const wrong of excluded) {
    const bad = duo([{ key: "n", def: printing(cardId), owner: P1, zone: "play" }, { key: "r", def: plainGreed(), owner: P1, zone: "hand" }]);
    developResource(bad.engine, P1, bad.id("r"), false);
    refused(() => answerPending(bad.engine, "nameValue", { value: wrong }), `${wrong} is not one of the two icons`);
  }
  answerPending(g.engine, "nameValue", { value: a });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(iconCount(g.engine, a), 1, `the card provides exactly one ${a}`);
  assert.equal(iconCount(g.engine, b), 0, `and not ${b}`);
  assert.equal(iconCount(g.engine, "greed"), 1, "the entering resource is unchanged");
  assert.equal(iconCount(g.engine, a, P2), 0, "the opponent gets nothing");
};
const namingOther = (cardId: string, a: Icon, b: Icon) => () => {
  const g = nameBoard(cardId);
  developResource(g.engine, P1, g.id("r"), false);
  answerPending(g.engine, "nameValue", { value: b });
  assert.equal(iconCount(g.engine, b), 1, `naming ${b}`);
  assert.equal(iconCount(g.engine, a), 0);
};
const namingEndsWithTurn = (cardId: string, a: Icon) => () => {
  const g = nameBoard(cardId);
  developResource(g.engine, P1, g.id("r"), false);
  answerPending(g.engine, "nameValue", { value: a });
  assert.equal(iconCount(g.engine, a), 1, "during my turn");
  endTurn(g.engine, P1);
  assert.equal(iconCount(g.engine, a), 0, "'this turn': gone once the turn is over");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(iconCount(g.engine, a), 0, "and it does not come back on my next turn");
  assert.equal(iconCount(g.engine, "greed"), 1);
};
const namingTriggers = (cardId: string, a: Icon) => () => {
  // A face-down resource entering is a resource too (CR 411.1).
  const down = nameBoard(cardId);
  developResource(down.engine, P1, down.id("r"), true);
  assert.equal(pending(down.engine)?.kind, "nameValue", "a face-down resource entering under my control counts");
  // A resource put into play by an effect counts.
  const viaEffect = nameBoard(cardId);
  play(viaEffect.engine, P1, viaEffect.id("putRes"), { selected: { c: [viaEffect.id("r")] } });
  assert.equal(pending(viaEffect.engine)?.kind, "nameValue", "a resource put into play by an effect");
  answerPending(viaEffect.engine, "nameValue", { value: a });
  assert.equal(iconCount(viaEffect.engine, a), 1);
  // Two resources entering in one turn: two namings, two icons.
  play(viaEffect.engine, P1, viaEffect.id("putRes2"), { selected: { c: [viaEffect.id("r2")] } });
  assert.equal(pending(viaEffect.engine)?.kind, "nameValue", "the second resource asks again");
  answerPending(viaEffect.engine, "nameValue", { value: a });
  assert.equal(iconCount(viaEffect.engine, a), 2, "the card gained PROVIDES twice");
};
const namingNearMisses = (cardId: string) => () => {
  const own = duo([{ key: "n", def: printing(cardId), owner: P1, zone: "hand" }]);
  developResource(own.engine, P1, own.id("n"), false);
  assert.equal(zoneOf(own.engine, own.id("n")), "play");
  assert.equal(own.engine.state.pendingChoice, undefined, "its own entry does not trigger it (an enters-play trigger never sees its own entry)");

  const char = nameBoard(cardId);
  play(char.engine, P1, char.id("plain"));
  assert.equal(char.engine.state.pendingChoice, undefined, "a character entering is not a resource");

  const hand = nameBoard(cardId, { zone: "hand" });
  developResource(hand.engine, P1, hand.id("r"), false);
  assert.equal(hand.engine.state.pendingChoice, undefined, "the naming card is in my hand, not in play");

  const opp = nameBoard(cardId, { active: P2 });
  developResource(opp.engine, P2, opp.id("theirs"), false);
  assert.equal(opp.engine.state.pendingChoice, undefined, "the opponent's resource does not enter under MY control");
};
const namingSecondCopy = (cardId: string, a: Icon) => () => {
  const g = duo([
    { key: "n1", def: printing(cardId), owner: P1, zone: "play" },
    { key: "n2", def: printing(cardId), owner: P1, zone: "hand" }
  ]);
  developResource(g.engine, P1, g.id("n2"), false);
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "nameValue", "a second copy is another resource entering: the first one reacts");
  answerPending(g.engine, "nameValue", { value: a });
  assert.equal(iconCount(g.engine, a), 1);
};

clause(NARCISSISM, "0:rule", "when my resource enters, I name [O] or [E] (nothing else); the named icon is provided once", naming(NARCISSISM, "obsession", "elitism", ["rage", "greed", "deception"]));
clause(NARCISSISM, "0:rule", "naming [E] instead gives [E] and not [O]", namingOther(NARCISSISM, "obsession", "elitism"));
clause(NARCISSISM, "0:rule", "'this turn': the provided icon is gone when the turn ends", namingEndsWithTurn(NARCISSISM, "obsession"));
clause(NARCISSISM, "0:rule", "face-down and effect-played resources trigger it, and each entering resource adds another icon", namingTriggers(NARCISSISM, "elitism"));
clause(NARCISSISM, "0:rule", "near misses: its own entry, a non-resource, being in hand, or an opponent's resource do not trigger it", namingNearMisses(NARCISSISM));
clause(NARCISSISM, "0:rule", "a second copy entering is a resource entering under my control for the first copy", namingSecondCopy(NARCISSISM, "obsession"));
clause(NARCISSISM, "0:rule", "the named icon pays for a threshold: an [E] character can be deployed after naming [E]", () => {
  const eChar = character({ name: "Elite", cost: 0, threshold: "e" } as never);
  const g = duo([
    { key: "n", def: printing(NARCISSISM), owner: P1, zone: "play" },
    { key: "r", def: plainGreed(), owner: P1, zone: "hand" },
    { key: "e", def: eChar, owner: P1, zone: "hand" }
  ]);
  refused(() => play(g.engine, P1, g.id("e")), "no [E] yet");
  developResource(g.engine, P1, g.id("r"), false);
  answerPending(g.engine, "nameValue", { value: "elitism" });
  play(g.engine, P1, g.id("e"));
  assert.equal(zoneOf(g.engine, g.id("e")), "play", "the named [E] meets the threshold");
});

clause(PARANOIA, "0:rule", "when my resource enters, I name [O] or [D] (nothing else); the named icon is provided once", naming(PARANOIA, "obsession", "deception", ["rage", "greed", "elitism"]));
clause(PARANOIA, "0:rule", "naming [D] instead gives [D] and not [O]", namingOther(PARANOIA, "obsession", "deception"));
clause(PARANOIA, "0:rule", "'this turn': the provided icon is gone when the turn ends", namingEndsWithTurn(PARANOIA, "deception"));
clause(PARANOIA, "0:rule", "face-down and effect-played resources trigger it, and each entering resource adds another icon", namingTriggers(PARANOIA, "deception"));
clause(PARANOIA, "0:rule", "near misses: its own entry, a non-resource, being in hand, or an opponent's resource do not trigger it", namingNearMisses(PARANOIA));
clause(PARANOIA, "0:rule", "a second copy entering is a resource entering under my control for the first copy", namingSecondCopy(PARANOIA, "deception"));
clause(PARANOIA, "0:rule", "the named icon pays for a threshold: a [D] character can be deployed after naming [D]", () => {
  const dChar = character({ name: "Deceptive", cost: 0, threshold: "d" } as never);
  const g = duo([
    { key: "n", def: printing(PARANOIA), owner: P1, zone: "play" },
    { key: "r", def: plainGreed(), owner: P1, zone: "hand" },
    { key: "d", def: dChar, owner: P1, zone: "hand" }
  ]);
  refused(() => play(g.engine, P1, g.id("d")), "no [D] yet");
  developResource(g.engine, P1, g.id("r"), false);
  answerPending(g.engine, "nameValue", { value: "deception" });
  play(g.engine, P1, g.id("d"));
  assert.equal(zoneOf(g.engine, g.id("d")), "play", "the named [D] meets the threshold");
});

// =============================================================================
// Neverending Mirage
// location, banker, cost 3, threshold [G], structure 5
// When this card enters play, you may pick a non-resource card and void it. If you do, when this card leaves play,
// put the voided card into play under its owner's control.
// =============================================================================

function mirageBoard(extra: CardPlacement[] = [], o: DuoOpts & { zone?: "hand" | "play" } = {}) {
  return duo(
    [
      { key: "m", def: printing(MIRAGE), owner: P1, zone: o.zone ?? "hand" },
      ...bank("greed", 3),
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "gizmo", def: item({ name: "Gizmo" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "TheirPlace", structure: 4 }), owner: P2, zone: "play" },
      { key: "smite", def: DESTROY_ANY, owner: P1, zone: "hand" },
      ...extra
    ],
    o
  );
}
const mirageEnter = (g: Game, pick: string[]): void => {
  play(g.engine, P1, g.id("m"));
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "I am offered the pick");
  answerPending(g.engine, "chooserSelectsTarget", { selected: pick.map((k) => g.id(k)) });
};
const destroyMirage = (g: Game): void => {
  play(g.engine, P1, g.id("smite"), { selected: { t: [g.id("m")] } });
  drain(g.engine, declineAll);
};

clause(MIRAGE, "0:rule", "printed card: deploys for 3 with [G], structure 5", () => {
  const g = mirageBoard();
  play(g.engine, P1, g.id("m"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("m")), "play");
  assert.equal(ready(g.engine), 0, "cost 3");
  assert.equal(g.engine.getDefinition(g.id("m")).structure, 5);
  assert.deepEqual(g.engine.getCardTypes(g.id("m")), ["location"]);
  const short = duo([{ key: "m", def: printing(MIRAGE), owner: P1, zone: "hand" }, ...bank("greed", 2)]);
  refused(() => play(short.engine, P1, short.id("m")), "cost 3 with two resources");
  const wrong = duo([{ key: "m", def: printing(MIRAGE), owner: P1, zone: "hand" }, ...bank("rage", 3)]);
  refused(() => play(wrong.engine, P1, wrong.id("m")), "[G] missing");
});

clause(MIRAGE, "0:rule", "when it enters play I may pick any non-resource card in play (a character, item or location, mine or theirs) and void it", () => {
  for (const key of ["foe", "mine", "gizmo", "loc"]) {
    const g = mirageBoard();
    mirageEnter(g, [key]);
    assert.equal(zoneOf(g.engine, g.id(key)), "void", `${key} is voided`);
    assert.equal(zoneOf(g.engine, g.id("m")), "play", "the Mirage stays in play");
    for (const other of ["foe", "mine", "gizmo", "loc"].filter((k) => k !== key)) assert.equal(zoneOf(g.engine, g.id(other)), "play", `${other} untouched`);
  }
});

clause(MIRAGE, "0:rule", "'you may': I can decline, and then nothing is voided", () => {
  const g = mirageBoard();
  mirageEnter(g, []);
  for (const key of ["foe", "mine", "gizmo", "loc"]) assert.equal(zoneOf(g.engine, g.id(key)), "play");
  destroyMirage(g);
  assert.equal(zoneOf(g.engine, g.id("m")), "discard");
  for (const key of ["foe", "mine", "gizmo", "loc"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", "and nothing returns later either");
});

clause(MIRAGE, "0:rule", "'non-resource': a face-up resource, a face-down card (a resource in play), my faction and cards outside play cannot be picked", () => {
  const extra: CardPlacement[] = [
    { key: "res", def: resCard("Field Resource", "greed"), owner: P2, zone: "play" },
    { key: "down", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
    { key: "inDiscard", def: character({ name: "Dead" }), owner: P2, zone: "discard" },
    { key: "inHand", def: character({ name: "Held" }), owner: P2, zone: "hand" }
  ];
  const attempts: Array<[string, (g: Game) => string]> = [
    ["a face-up resource", (g) => g.id("res")],
    ["a face-down resource", (g) => g.id("down")],
    ["a faction (CR 202.9a)", (g) => factionOf(g.engine, P2)],
    ["a card in a discard pile (CR 402.3: only cards in play)", (g) => g.id("inDiscard")],
    ["a card in a hand", (g) => g.id("inHand")]
  ];
  for (const [why, pick] of attempts) {
    const g = mirageBoard(extra);
    play(g.engine, P1, g.id("m"));
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [pick(g)] }), why);
  }
  const ok = mirageBoard(extra);
  mirageEnter(ok, ["foe"]);
  assert.equal(zoneOf(ok.engine, ok.id("foe")), "void", "control");
});

clause(MIRAGE, "0:rule", "the voided card stays in the void while the Mirage is in play, across turns", () => {
  const g = mirageBoard();
  mirageEnter(g, ["foe"]);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("foe")), "void");
  assert.equal(zoneOf(g.engine, g.id("m")), "play");
});

clause(MIRAGE, "0:rule", "when the Mirage leaves play the voided card is put into play under its OWNER's control", () => {
  const g = mirageBoard();
  mirageEnter(g, ["foe"]);
  destroyMirage(g);
  assert.equal(zoneOf(g.engine, g.id("m")), "discard");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "back in play");
  assert.equal(card(g.engine, g.id("foe")).controllerId, P2);

  const mine = mirageBoard();
  mirageEnter(mine, ["gizmo"]);
  destroyMirage(mine);
  assert.equal(zoneOf(mine.engine, mine.id("gizmo")), "play", "an item returns too");
  assert.equal(card(mine.engine, mine.id("gizmo")).controllerId, P1);
});

clause(MIRAGE, "0:rule", "'under its owner's control': a card I stole and voided comes back under its owner's control, not mine", () => {
  const g = mirageBoard([{ key: "stolen", def: character({ name: "Stolen", life: 3 }), owner: P2, zone: "play", controller: P1 }]);
  mirageEnter(g, ["stolen"]);
  assert.equal(zoneOf(g.engine, g.id("stolen")), "void");
  destroyMirage(g);
  assert.equal(zoneOf(g.engine, g.id("stolen")), "play");
  assert.equal(card(g.engine, g.id("stolen")).controllerId, P2, "its owner controls it");
});

clause(MIRAGE, "0:rule", "only the card it voided returns: another card already in the void stays there", () => {
  const g = mirageBoard([{ key: "old", def: character({ name: "Old Void" }), owner: P2, zone: "void" }]);
  mirageEnter(g, ["foe"]);
  destroyMirage(g);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(zoneOf(g.engine, g.id("old")), "void");
});

clause(MIRAGE, "0:rule", "the returning card is put into play: its enters-play trigger fires (Peaceful Mau gains its owner 3 influence)", () => {
  const g = mirageBoard([{ key: "pm", def: printing(PEACEFUL), owner: P2, zone: "play" }]);
  mirageEnter(g, ["pm"]);
  const before = inf(g.engine, P2);
  destroyMirage(g);
  assert.equal(zoneOf(g.engine, g.id("pm")), "play");
  assert.equal(inf(g.engine, P2), before + 3);
});

clause(MIRAGE, "0:rule", "the return happens however the Mirage leaves play (here: back to its owner's hand)", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });
  const g = mirageBoard([{ key: "bounce", def: bounce, owner: P1, zone: "hand" }]);
  mirageEnter(g, ["foe"]);
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("m")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("m")), "hand");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(MIRAGE, "0:rule", "the Mirage is itself a non-resource card, so it may pick itself and void itself", () => {
  const g = mirageBoard();
  mirageEnter(g, ["m"]);
  assert.equal(zoneOf(g.engine, g.id("m")), "void");
  for (const key of ["foe", "mine", "gizmo", "loc"]) assert.equal(zoneOf(g.engine, g.id(key)), "play");
});

// =============================================================================
// Nine Rituals of the Mau
// tactic, banker, cost 5, threshold [G][G][G]
// EXTRA COST: Pick up to 2 characters with numeric cost 2 or less in your discard pile.
// Put the characters into play under your control.
// =============================================================================

function ritualBoard(extra: CardPlacement[] = [], o: DuoOpts & { greed?: number; rage?: number } = {}) {
  return duo(
    [
      { key: "nr", def: printing(RITUALS), owner: P1, zone: "hand" },
      ...bank("greed", o.greed ?? 5),
      ...bank("rage", o.rage ?? 0),
      { key: "c0", def: costed("Cost 0", 0), owner: P1, zone: "discard" },
      { key: "c1", def: costed("Cost 1", 1), owner: P1, zone: "discard" },
      { key: "c2", def: costed("Cost 2", 2), owner: P1, zone: "discard" },
      { key: "c3", def: costed("Cost 3", 3), owner: P1, zone: "discard" },
      { key: "theirs", def: costed("Theirs", 1), owner: P2, zone: "discard" },
      { key: "gizmo", def: item({ name: "Gizmo", cost: 1 }), owner: P1, zone: "discard" },
      { key: "inHand", def: costed("InHand", 1), owner: P1, zone: "hand" },
      { key: "inPlay", def: costed("InPlay", 1), owner: P1, zone: "play" },
      ...extra
    ],
    o
  );
}
const ritual = (g: Game, picks: string[]): void => play(g.engine, P1, g.id("nr"), { selected: { picks: picks.map((k) => g.id(k)) } });

clause(RITUALS, "0:extraCost", "costs 5 with [G][G][G]: 5 Greed pay in full; 4 resources are short, 5 Rage lack the threshold", () => {
  const g = ritualBoard();
  playRaw(g.engine, P1, g.id("nr"), { selected: { picks: [g.id("c1")] } });
  assert.equal(ready(g.engine), 0, "all 5 paid");
  resolvePendingResponses(g.engine);
  const short = ritualBoard([], { greed: 4 });
  refused(() => ritual(short, ["c1"]), "cost 5 with four resources");
  assert.equal(zoneOf(short.engine, short.id("c1")), "discard");
  const wrong = ritualBoard([], { greed: 0, rage: 5 });
  refused(() => ritual(wrong, ["c1"]), "[G][G][G] missing");
  const twoGreed = ritualBoard([], { greed: 2, rage: 3 });
  refused(() => ritual(twoGreed, ["c1"]), "only two [G]");
  const exact = ritualBoard([], { greed: 3, rage: 2 });
  ritual(exact, ["c1"]);
  assert.equal(zoneOf(exact.engine, exact.id("c1")), "play", "control: three [G] and two other resources");
});


clause(RITUALS, "0:extraCost", "up to 2 characters: 0, 1 or 2 picks are accepted and the picks are made as a cost (the cards are still in the discard pile while the tactic waits)", () => {
  const two = ritualBoard();
  playRaw(two.engine, P1, two.id("nr"), { selected: { picks: [two.id("c1"), two.id("c2")] } });
  assert.equal(zoneOf(two.engine, two.id("c1")), "discard", "picked, not yet moved");
  assert.equal(zoneOf(two.engine, two.id("c2")), "discard");
  resolvePendingResponses(two.engine);
  assert.equal(zoneOf(two.engine, two.id("c1")), "play");
  assert.equal(zoneOf(two.engine, two.id("c2")), "play");
  const one = ritualBoard();
  ritual(one, ["c0"]);
  assert.equal(zoneOf(one.engine, one.id("c0")), "play", "one pick, and a cost 0 character qualifies");
  const none = ritualBoard();
  ritual(none, []);
  assert.equal(zoneOf(none.engine, none.id("nr")), "discard", "no picks: still played");
  assert.equal(ready(none.engine), 0, "and still paid for");
});

clause(RITUALS, "0:extraCost", "a third pick is refused", () => {
  const g = ritualBoard();
  refused(() => ritual(g, ["c0", "c1", "c2"]), "three picks");
  assert.equal(zoneOf(g.engine, g.id("nr")), "hand");
  assert.equal(ready(g.engine), 5, "nothing paid");
});

clause(RITUALS, "0:extraCost", "numeric cost 2 or less, characters, in MY discard pile: cost 3, the opponent's discard, an item, a card in hand and a card in play are refused", () => {
  for (const bad of ["c3", "theirs", "gizmo", "inHand", "inPlay"]) {
    const g = ritualBoard();
    refused(() => ritual(g, ["c1", bad]), bad);
    assert.equal(zoneOf(g.engine, g.id("nr")), "hand", bad);
    assert.equal(zoneOf(g.engine, g.id("c1")), "discard", `${bad}: nothing happened`);
  }
  const ok = ritualBoard();
  ritual(ok, ["c1", "c2"]);
  assert.equal(zoneOf(ok.engine, ok.id("c2")), "play", "control: cost 2 is allowed");
});

clause(RITUALS, "1:rule", "puts the picked characters into play under my control (and only them), and the tactic goes to the discard pile", () => {
  const g = ritualBoard();
  ritual(g, ["c1", "c2"]);
  for (const key of ["c1", "c2"]) {
    assert.equal(zoneOf(g.engine, g.id(key)), "play", key);
    assert.equal(card(g.engine, g.id(key)).controllerId, P1, `${key} is under my control`);
  }
  for (const key of ["c0", "c3", "theirs"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} is not put into play`);
  assert.equal(zoneOf(g.engine, g.id("nr")), "discard");
  assert.deepEqual(stats(g.engine, g.id("c1")), [1, 3, 1], "they come in as ordinary characters");
});

clause(RITUALS, "1:rule", "the characters really enter play: their enters-play triggers fire (two Peaceful Maus gain 6 influence)", () => {
  const g = ritualBoard([
    { key: "pm1", def: printing(PEACEFUL), owner: P1, zone: "discard" },
    { key: "pm2", def: printing(PEACEFUL), owner: P1, zone: "discard" }
  ]);
  const before = inf(g.engine, P1);
  ritual(g, ["pm1", "pm2"]);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("pm1")), "play");
  assert.equal(zoneOf(g.engine, g.id("pm2")), "play");
  assert.equal(inf(g.engine, P1), before + 6);
});

clause(RITUALS, "1:rule", "a picked character that left the discard pile in response is not put into play, the other one is", () => {
  const snatch = tactic({
    name: "Snatch",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sn",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "opponent", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const g = ritualBoard([{ key: "snatch", def: snatch, owner: P2, zone: "hand" }]);
  playRaw(g.engine, P1, g.id("nr"), { selected: { picks: [g.id("c1"), g.id("c2")] } });
  g.engine.perform({ type: "playCard", playerId: P2, cardId: g.id("snatch"), selected: { t: [g.id("c1")] }, variables: {} } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("c1")), "hand", "it was pulled out of the discard pile in response");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play", "the other pick still enters play");
});

// =============================================================================
// The five Obols (resource, universal, cost 0)
// PROVIDES: [V]
// IMBUE -- COST: Use this ability only once each turn. Lose 2 influence.
//   EFFECT: This turn, this card gains "PROVIDES: [X][X]".   (X = D, E, G, O, R for Deception, Elitism, Greed, Obsession, Rage)
// =============================================================================

const ICON_CHAR: Record<Icon, string> = { deception: "d", elitism: "e", greed: "g", obsession: "o", rage: "r" };
const threshold = (e: SpoilsEngine, p: PlayerId = P1): Record<string, number> => ({ ...(e.getThresholds(p) as Record<string, number>) });

function obolBoard(cardId: string, icon: Icon, o: { zone?: "play" | "hand"; faceDown?: boolean; copies?: number; influence?: number; active?: PlayerId } = {}) {
  const copies = o.copies ?? 1;
  const ch = ICON_CHAR[icon];
  return duo(
    [
      ...Array.from({ length: copies }, (_, i) => ({
        key: i === 0 ? "o" : `o${i + 1}`,
        def: printing(cardId),
        owner: P1,
        zone: o.zone ?? ("play" as const),
        faceDown: o.faceDown
      })),
      { key: "needs", def: character({ name: "Needs Two", cost: 1, threshold: ch + ch } as never), owner: P1, zone: "hand" }
    ],
    { influence: o.influence, active: o.active }
  );
}

const obolProvides = (cardId: string) => () => {
  const g = duo([{ key: "o", def: printing(cardId), owner: P1, zone: "play" }]);
  assert.deepEqual(threshold(g.engine), { volition: 1 }, "exactly one [V] and nothing else");
  assert.equal(ready(g.engine), 1, "one resource");
  assert.deepEqual(threshold(g.engine, P2), {}, "the icon goes to its controller only");
  const two = duo([
    { key: "o", def: printing(cardId), owner: P1, zone: "play" },
    { key: "o2", def: printing(cardId), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(threshold(two.engine), { volition: 2 }, "two Obols provide two [V]");
  const hand = duo([{ key: "o", def: printing(cardId), owner: P1, zone: "hand" }]);
  assert.deepEqual(threshold(hand.engine), {}, "in my hand it provides nothing");
  assert.equal(printing(cardId).cost, 0);
};

const obolImbue = (cardId: string, icon: Icon) => () => {
  const g = obolBoard(cardId, icon);
  const before = inf(g.engine, P1);
  const oppBefore = inf(g.engine, P2);
  refused(() => play(g.engine, P1, g.id("needs")), `before imbuing there is no [${ICON_CHAR[icon]}][${ICON_CHAR[icon]}]`);
  activate(g.engine, P1, g.id("o"), "imbue");
  assert.equal(inf(g.engine, P1), before - 2, "I lost 2 influence");
  assert.equal(inf(g.engine, P2), oppBefore, "the opponent did not");
  assert.deepEqual(threshold(g.engine), { volition: 1, [icon]: 2 }, `the Obol now provides [V] and exactly two ${icon}`);
  assert.equal(g.engine.state.pendingChoice, undefined);
  play(g.engine, P1, g.id("needs"));
  assert.equal(zoneOf(g.engine, g.id("needs")), "play", `a card needing two ${icon} can be deployed with just this Obol`);
  assert.deepEqual(threshold(g.engine, P2), {}, "the opponent gets none of it");
};

const obolOncePerTurn = (cardId: string, icon: Icon) => () => {
  const g = obolBoard(cardId, icon);
  const start = inf(g.engine, P1);
  activate(g.engine, P1, g.id("o"), "imbue");
  refused(() => activate(g.engine, P1, g.id("o"), "imbue"), "only once each turn", /only 1 time|once|each turn/i);
  assert.equal(inf(g.engine, P1), start - 2, "the refused second use cost nothing");
  assert.equal(threshold(g.engine)[icon], 2, "and the grant did not stack");
  endTurn(g.engine, P1);
  assert.deepEqual(threshold(g.engine), { volition: 1 }, "'this turn': the grant is over");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.deepEqual(threshold(g.engine), { volition: 1 }, "still over on my next turn");
  activate(g.engine, P1, g.id("o"), "imbue");
  assert.equal(inf(g.engine, P1), start - 4, "a new turn: it can be used again");
  assert.equal(threshold(g.engine)[icon], 2);
};

const obolTwoCopies = (cardId: string, icon: Icon) => () => {
  const g = obolBoard(cardId, icon, { copies: 2 });
  const start = inf(g.engine, P1);
  activate(g.engine, P1, g.id("o"), "imbue");
  activate(g.engine, P1, g.id("o2"), "imbue");
  assert.equal(inf(g.engine, P1), start - 4, "'only once each turn' is per Obol: both can be used");
  assert.deepEqual(threshold(g.engine), { volition: 2, [icon]: 4 });
};

const obolInfluenceCost = (cardId: string, icon: Icon) => () => {
  const poor = obolBoard(cardId, icon, { influence: 1 });
  refused(() => activate(poor.engine, P1, poor.id("o"), "imbue"), "lose 2 influence with only 1");
  assert.equal(inf(poor.engine, P1), 1, "influence is untouched");
  assert.deepEqual(threshold(poor.engine), { volition: 1 }, "and nothing was granted");
  const ok = obolBoard(cardId, icon, { influence: 3 });
  activate(ok.engine, P1, ok.id("o"), "imbue");
  assert.equal(inf(ok.engine, P1), 1, "control: 3 - 2");
  assert.equal(threshold(ok.engine)[icon], 2);
};

const obolOnlyInPlayFaceUp = (cardId: string, icon: Icon) => () => {
  const hand = obolBoard(cardId, icon, { zone: "hand" });
  refused(() => activate(hand.engine, P1, hand.id("o"), "imbue"), "in my hand", /zone|play/i);
  assert.equal(inf(hand.engine, P1), 30);
  const down = obolBoard(cardId, icon, { faceDown: true });
  assert.equal(threshold(down.engine).volition, 1, "face-down it is just a resource with [V]");
  refused(() => activate(down.engine, P1, down.id("o"), "imbue"), "face-down cards have no abilities");
  assert.equal(inf(down.engine, P1), 30);
  assert.equal(threshold(down.engine)[icon] ?? 0, 0);
};

clause(OBOL_DECEPTION, "0:provides", "provides exactly one [V] while in play", obolProvides(OBOL_DECEPTION));
clause(OBOL_DECEPTION, "1:ability:imbue", "lose 2 influence: this turn the Obol also provides [D][D]", obolImbue(OBOL_DECEPTION, "deception"));
clause(OBOL_DECEPTION, "1:ability:imbue", "only once each turn per Obol; the grant ends with the turn", obolOncePerTurn(OBOL_DECEPTION, "deception"));
clause(OBOL_DECEPTION, "1:ability:imbue", "two Obols can each be used once in the same turn", obolTwoCopies(OBOL_DECEPTION, "deception"));
clause(OBOL_DECEPTION, "1:ability:imbue", "the 2 influence must be payable in full", obolInfluenceCost(OBOL_DECEPTION, "deception"));
clause(OBOL_DECEPTION, "1:ability:imbue", "only usable face-up in play", obolOnlyInPlayFaceUp(OBOL_DECEPTION, "deception"));

clause(OBOL_ELITISM, "0:provides", "provides exactly one [V] while in play", obolProvides(OBOL_ELITISM));
clause(OBOL_ELITISM, "1:ability:imbue", "lose 2 influence: this turn the Obol also provides [E][E]", obolImbue(OBOL_ELITISM, "elitism"));
clause(OBOL_ELITISM, "1:ability:imbue", "only once each turn per Obol; the grant ends with the turn", obolOncePerTurn(OBOL_ELITISM, "elitism"));
clause(OBOL_ELITISM, "1:ability:imbue", "two Obols can each be used once in the same turn", obolTwoCopies(OBOL_ELITISM, "elitism"));
clause(OBOL_ELITISM, "1:ability:imbue", "the 2 influence must be payable in full", obolInfluenceCost(OBOL_ELITISM, "elitism"));
clause(OBOL_ELITISM, "1:ability:imbue", "only usable face-up in play", obolOnlyInPlayFaceUp(OBOL_ELITISM, "elitism"));

clause(OBOL_GREED, "0:provides", "provides exactly one [V] while in play", obolProvides(OBOL_GREED));
clause(OBOL_GREED, "1:ability:imbue", "lose 2 influence: this turn the Obol also provides [G][G]", obolImbue(OBOL_GREED, "greed"));
clause(OBOL_GREED, "1:ability:imbue", "only once each turn per Obol; the grant ends with the turn", obolOncePerTurn(OBOL_GREED, "greed"));
clause(OBOL_GREED, "1:ability:imbue", "two Obols can each be used once in the same turn", obolTwoCopies(OBOL_GREED, "greed"));
clause(OBOL_GREED, "1:ability:imbue", "the 2 influence must be payable in full", obolInfluenceCost(OBOL_GREED, "greed"));
clause(OBOL_GREED, "1:ability:imbue", "only usable face-up in play", obolOnlyInPlayFaceUp(OBOL_GREED, "greed"));

clause(OBOL_OBSESSION, "0:provides", "provides exactly one [V] while in play", obolProvides(OBOL_OBSESSION));
clause(OBOL_OBSESSION, "1:ability:imbue", "lose 2 influence: this turn the Obol also provides [O][O]", obolImbue(OBOL_OBSESSION, "obsession"));
clause(OBOL_OBSESSION, "1:ability:imbue", "only once each turn per Obol; the grant ends with the turn", obolOncePerTurn(OBOL_OBSESSION, "obsession"));
clause(OBOL_OBSESSION, "1:ability:imbue", "two Obols can each be used once in the same turn", obolTwoCopies(OBOL_OBSESSION, "obsession"));
clause(OBOL_OBSESSION, "1:ability:imbue", "the 2 influence must be payable in full", obolInfluenceCost(OBOL_OBSESSION, "obsession"));
clause(OBOL_OBSESSION, "1:ability:imbue", "only usable face-up in play", obolOnlyInPlayFaceUp(OBOL_OBSESSION, "obsession"));

clause(OBOL_RAGE, "0:provides", "provides exactly one [V] while in play", obolProvides(OBOL_RAGE));
clause(OBOL_RAGE, "1:ability:imbue", "lose 2 influence: this turn the Obol also provides [R][R]", obolImbue(OBOL_RAGE, "rage"));
clause(OBOL_RAGE, "1:ability:imbue", "only once each turn per Obol; the grant ends with the turn", obolOncePerTurn(OBOL_RAGE, "rage"));
clause(OBOL_RAGE, "1:ability:imbue", "two Obols can each be used once in the same turn", obolTwoCopies(OBOL_RAGE, "rage"));
clause(OBOL_RAGE, "1:ability:imbue", "the 2 influence must be payable in full", obolInfluenceCost(OBOL_RAGE, "rage"));
clause(OBOL_RAGE, "1:ability:imbue", "only usable face-up in play", obolOnlyInPlayFaceUp(OBOL_RAGE, "rage"));

// =============================================================================
// Opportunistic Pirate
// character, rogue, subtype pirate, cost 7, threshold [D][D], 4 strength / 5 speed / 1 life
// TACTICAL
// EXTRA COST: You may void up to 4 cards in an opponent's discard pile. If you do, reduce this card's numeric cost
// by the number of cards voided.
// =============================================================================

function pirateBoard(o: { deception?: number; rage?: number; zone?: "hand" | "play"; active?: PlayerId } = {}) {
  return duo(
    [
      { key: "p", def: printing(PIRATE), owner: P1, zone: o.zone ?? "hand" },
      ...bank("deception", o.deception ?? 7),
      ...bank("rage", o.rage ?? 0),
      { key: "g1", def: character({ name: "G1" }), owner: P2, zone: "discard" },
      { key: "g2", def: item({ name: "G2" }), owner: P2, zone: "discard" },
      { key: "g3", def: tactic({ name: "G3" }), owner: P2, zone: "discard" },
      { key: "g4", def: character({ name: "G4" }), owner: P2, zone: "discard" },
      { key: "g5", def: character({ name: "G5" }), owner: P2, zone: "discard" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "discard" },
      { key: "oh", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" },
      { key: "op", def: character({ name: "Their Board" }), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }
    ],
    { active: o.active, turn: o.active === P2 ? 2 : undefined }
  );
}
const pirate = (g: Game, voids: string[]): void => play(g.engine, P1, g.id("p"), { selected: { rem: voids.map((k) => g.id(k)) } });

clause(PIRATE, "0:kw:TACTICAL", "has the TACTICAL keyword (a plain character does not)", () => {
  const g = pirateBoard({ zone: "play" });
  assert.ok(g.engine.getKeywords(g.id("p")).includes("tactical"), "g.engine.getKeywords(p).includes(tactical)");
  assert.equal(g.engine.getKeywords(g.id("atk")).includes("tactical"), false);
});

clause(PIRATE, "0:kw:TACTICAL", "it can be deployed from hand whenever a tactic could be (the opponent's attack window), for its full cost 7; an ordinary character cannot", () => {
  const g = pirateBoard({ active: P2 });
  refused(() => play(g.engine, P1, g.id("p")), "the opponent's turn with no response window open");
  assert.equal(zoneOf(g.engine, g.id("p")), "hand");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  refused(() => play(g.engine, P1, g.id("plain")), "an ordinary character cannot be deployed in that window");
  assert.equal(zoneOf(g.engine, g.id("plain")), "hand");
  play(g.engine, P1, g.id("p"));
  assert.equal(zoneOf(g.engine, g.id("p")), "play", "control: the TACTICAL character can");
  assert.equal(ready(g.engine), 0, "7 paid");
});

clause(PIRATE, "0:kw:TACTICAL", "TACTICAL changes the timing only: the [D][D] threshold and the cost are still required", () => {
  const wrong = pirateBoard({ active: P2, deception: 0, rage: 7 });
  declareAttackOpenWindow(wrong.engine, P2, [wrong.id("atk")]);
  refused(() => play(wrong.engine, P1, wrong.id("p")), "no [D]");
  assert.equal(zoneOf(wrong.engine, wrong.id("p")), "hand");
  const short = pirateBoard({ active: P2, deception: 6 });
  declareAttackOpenWindow(short.engine, P2, [short.id("atk")]);
  refused(() => play(short.engine, P1, short.id("p")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("p")), "hand");
});

clause(PIRATE, "1:extraCost", "printed card: cost 7 with [D][D] (no voiding), stats 4/1/5, subtype pirate", () => {
  const g = pirateBoard();
  play(g.engine, P1, g.id("p"));
  assert.equal(zoneOf(g.engine, g.id("p")), "play");
  assert.equal(ready(g.engine), 0, "all 7 paid");
  assert.deepEqual(stats(g.engine, g.id("p")), [4, 1, 5]);
  assert.deepEqual(printing(PIRATE).subtype, ["pirate"]);
  const short = pirateBoard({ deception: 6 });
  refused(() => play(short.engine, P1, short.id("p")), "6 resources are one short of 7");
  assert.equal(zoneOf(short.engine, short.id("p")), "hand");
  for (const key of ["g1", "g2", "g3", "g4", "g5"]) assert.equal(zoneOf(short.engine, short.id(key)), "discard");
});

clause(PIRATE, "1:extraCost", "each card voided from an opponent's discard pile reduces the numeric cost by 1 (0 to 4 cards: 7, 6, 5, 4, 3 paid)", () => {
  const sets: string[][] = [[], ["g1"], ["g1", "g2"], ["g1", "g2", "g3"], ["g1", "g2", "g3", "g4"]];
  sets.forEach((voids, n) => {
    const g = pirateBoard();
    pirate(g, voids);
    assert.equal(zoneOf(g.engine, g.id("p")), "play", `${n} voided`);
    assert.equal(ready(g.engine), n, `${n} voided: ${7 - n} paid, ${n} left of 7`);
    for (const key of voids) assert.equal(zoneOf(g.engine, g.id(key)), "void", `${key} voided`);
    for (const key of ["g1", "g2", "g3", "g4", "g5"].filter((k) => !voids.includes(k))) assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} untouched`);
  });
});

clause(PIRATE, "1:extraCost", "the voiding is part of the cost: it happens when the card is played, before responses", () => {
  const g = pirateBoard();
  playRaw(g.engine, P1, g.id("p"), { selected: { rem: [g.id("g1"), g.id("g2")] } });
  assert.equal(zoneOf(g.engine, g.id("g1")), "void", "voided at once");
  assert.equal(zoneOf(g.engine, g.id("g2")), "void");
  assert.equal(ready(g.engine), 2, "5 already paid");
  assert.notEqual(zoneOf(g.engine, g.id("p")), "play", "still waiting for responses");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("p")), "play");
});

clause(PIRATE, "1:extraCost", "the reduction pays for the missing resources: 6 resources + voiding 1 card is enough, 6 resources alone is not", () => {
  const g = pirateBoard({ deception: 6 });
  pirate(g, ["g1"]);
  assert.equal(zoneOf(g.engine, g.id("p")), "play");
  assert.equal(ready(g.engine), 0, "cost 6, all 6 paid");
});

clause(PIRATE, "1:extraCost", "the [D][D] threshold still applies when the cost is reduced", () => {
  const g = pirateBoard({ deception: 0, rage: 3 });
  refused(() => pirate(g, ["g1", "g2", "g3", "g4"]), "cost 3 but no [D][D]");
  assert.equal(zoneOf(g.engine, g.id("p")), "hand");
  assert.equal(zoneOf(g.engine, g.id("g1")), "discard", "nothing was voided by the refused play");
  const one = pirateBoard({ deception: 1, rage: 2 });
  refused(() => pirate(one, ["g1", "g2", "g3", "g4"]), "only one [D]");
  const ok = pirateBoard({ deception: 2, rage: 1 });
  pirate(ok, ["g1", "g2", "g3", "g4"]);
  assert.equal(zoneOf(ok.engine, ok.id("p")), "play", "control: two [D] and cost 3");
});

clause(PIRATE, "1:extraCost", "up to 4: a fifth card is refused, and only cards in an OPPONENT's discard pile qualify", () => {
  const five = pirateBoard();
  refused(() => pirate(five, ["g1", "g2", "g3", "g4", "g5"]), "five cards");
  assert.equal(zoneOf(five.engine, five.id("p")), "hand");
  assert.equal(zoneOf(five.engine, five.id("g1")), "discard");
  for (const bad of ["mine", "oh", "op"]) {
    const g = pirateBoard();
    refused(() => pirate(g, ["g1", bad]), bad);
    assert.equal(zoneOf(g.engine, g.id("p")), "hand", bad);
    assert.equal(zoneOf(g.engine, g.id("g1")), "discard", `${bad}: nothing voided`);
  }
});

// =============================================================================
// Overcompensator
// character, warlord, subtype soldier, cost 1, threshold [R][R], 2 strength / 3 speed / 1 life
// Only characters with at least X strength can block this card, where X is this card's strength.
// =============================================================================

function overcompBoard(extra: CardPlacement[] = []) {
  return duo([
    { key: "oc", def: printing(OVERCOMP), owner: P1, zone: "play" },
    { key: "b1", def: character({ name: "Weak", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
    { key: "b2", def: character({ name: "Even", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
    { key: "b5", def: character({ name: "Strong", strength: 5, life: 5, speed: 2 }), owner: P2, zone: "play" },
    { key: "mate", def: character({ name: "Mate", strength: 3, life: 5, speed: 2 }), owner: P1, zone: "play" },
    ...extra
  ]);
}
const attackWith = (g: Game, keys: string[]): void => declareAttackBy(g.engine, P1, keys.map((k) => g.id(k)));
const blockWith = (g: Game, keys: string[]): void => declareBlockers(g.engine, P2, keys.map((k) => g.id(k)));
const blockers = (g: Game): string[] => [...(g.engine.state.battle?.blockingParty ?? [])];

clause(OVERCOMP, "0:rule", "printed card: deploys for 1 with [R][R], stats 2/1/3", () => {
  const g = duo([{ key: "oc", def: printing(OVERCOMP), owner: P1, zone: "hand" }, ...bank("rage", 2)]);
  play(g.engine, P1, g.id("oc"));
  assert.equal(zoneOf(g.engine, g.id("oc")), "play");
  assert.equal(ready(g.engine), 1, "cost 1");
  assert.deepEqual(stats(g.engine, g.id("oc")), [2, 1, 3]);
  const one = duo([{ key: "oc", def: printing(OVERCOMP), owner: P1, zone: "hand" }, ...bank("rage", 1)]);
  refused(() => play(one.engine, P1, one.id("oc")), "[R][R] needs two Rage");
  const wrong = duo([{ key: "oc", def: printing(OVERCOMP), owner: P1, zone: "hand" }, ...bank("greed", 2)]);
  refused(() => play(wrong.engine, P1, wrong.id("oc")), "no Rage");
});

clause(OVERCOMP, "0:rule", "a blocker needs at least as much strength as the Overcompensator (2): strength 1 is refused, 2 and 5 may block", () => {
  const weak = overcompBoard();
  attackWith(weak, ["oc"]);
  refused(() => blockWith(weak, ["b1"]), "strength 1 < 2");
  assert.deepEqual(blockers(weak), [], "no block was declared");

  const even = overcompBoard();
  attackWith(even, ["oc"]);
  blockWith(even, ["b2"]);
  assert.deepEqual(blockers(even), [even.id("b2")], "'at least X': equal strength is enough");

  const strong = overcompBoard();
  attackWith(strong, ["oc"]);
  blockWith(strong, ["b5"]);
  assert.deepEqual(blockers(strong), [strong.id("b5")]);
});

clause(OVERCOMP, "0:rule", "every character in the blocking party must qualify: a weak blocker cannot join a strong one", () => {
  const mixed = overcompBoard();
  attackWith(mixed, ["oc"]);
  refused(() => blockWith(mixed, ["b2", "b1"]), "the strength 1 member");
  assert.deepEqual(blockers(mixed), []);
  const ok = overcompBoard();
  attackWith(ok, ["oc"]);
  blockWith(ok, ["b2", "b5"]);
  assert.deepEqual([...blockers(ok)].sort(), [ok.id("b2"), ok.id("b5")].sort());
});

clause(OVERCOMP, "0:rule", "X is the card's CURRENT strength: with +1 strength a strength-2 blocker is refused, and a buffed weak blocker may block", () => {
  const bigger = overcompBoard([{ key: "pump", def: pump(1), owner: P1, zone: "hand" }]);
  play(bigger.engine, P1, bigger.id("pump"), { selected: { t: [bigger.id("oc")] } });
  assert.equal(bigger.engine.getStat(bigger.id("oc"), "strength"), 3);
  attackWith(bigger, ["oc"]);
  refused(() => blockWith(bigger, ["b2"]), "strength 2 < 3");
  blockWith(bigger, ["b5"]);
  assert.deepEqual(blockers(bigger), [bigger.id("b5")]);

  const buffed = overcompBoard([{ key: "pump", def: pump(1), owner: P1, zone: "hand" }]);
  play(buffed.engine, P1, buffed.id("pump"), { selected: { t: [buffed.id("b1")] } });
  assert.equal(buffed.engine.getStat(buffed.id("b1"), "strength"), 2);
  attackWith(buffed, ["oc"]);
  blockWith(buffed, ["b1"]);
  assert.deepEqual(blockers(buffed), [buffed.id("b1")], "the weak blocker is now strength 2");
});

clause(OVERCOMP, "0:rule", "it restricts blockers of THIS card only: a different attacker can be blocked by a strength-1 character", () => {
  const g = overcompBoard();
  attackWith(g, ["mate"]);
  blockWith(g, ["b1"]);
  assert.deepEqual(blockers(g), [g.id("b1")]);
});

clause(OVERCOMP, "0:rule", "attacking in a party with another character, a strength-1 character still cannot block the party that contains it", () => {
  const weak = overcompBoard();
  attackWith(weak, ["oc", "mate"]);
  refused(() => blockWith(weak, ["b1"]), "it would block the Overcompensator");
  const strong = overcompBoard();
  attackWith(strong, ["oc", "mate"]);
  blockWith(strong, ["b5"]);
  assert.deepEqual(blockers(strong), [strong.id("b5")]);
});

// =============================================================================
// Peaceful Mau
// character, banker, subtype mau + opportunist, cost 2, threshold [G], 2 strength / 3 speed / 1 life
// When this card enters play, gain 3 influence.
// =============================================================================

clause(PEACEFUL, "0:rule", "printed card: deploys for 2 with [G], stats 2/1/3", () => {
  const g = duo([{ key: "pm", def: printing(PEACEFUL), owner: P1, zone: "hand" }, ...bank("greed", 2)]);
  play(g.engine, P1, g.id("pm"));
  assert.equal(zoneOf(g.engine, g.id("pm")), "play");
  assert.equal(ready(g.engine), 0);
  assert.deepEqual(stats(g.engine, g.id("pm")), [2, 1, 3]);
  assert.deepEqual(printing(PEACEFUL).subtype, ["mau", "opportunist"]);
  const short = duo([{ key: "pm", def: printing(PEACEFUL), owner: P1, zone: "hand" }, ...bank("greed", 1)]);
  refused(() => play(short.engine, P1, short.id("pm")), "cost 2 with one resource");
  const wrong = duo([{ key: "pm", def: printing(PEACEFUL), owner: P1, zone: "hand" }, ...bank("rage", 2)]);
  refused(() => play(wrong.engine, P1, wrong.id("pm")), "[G] missing");
});

clause(PEACEFUL, "0:rule", "entering play gains its controller exactly 3 influence, and the opponent gains nothing", () => {
  const g = duo([{ key: "pm", def: printing(PEACEFUL), owner: P1, zone: "hand" }, ...bank("greed", 2)]);
  const mine = inf(g.engine, P1);
  const theirs = inf(g.engine, P2);
  play(g.engine, P1, g.id("pm"));
  assert.equal(inf(g.engine, P1), mine + 3);
  assert.equal(inf(g.engine, P2), theirs);
});

clause(PEACEFUL, "0:rule", "it triggers on any entering play (put into play by an effect), once per entry, and not for other cards entering play", () => {
  const viaEffect = duo([
    { key: "pm", def: printing(PEACEFUL), owner: P1, zone: "hand" },
    { key: "put", def: PUT_FROM_HAND, owner: P1, zone: "hand" }
  ]);
  const start = inf(viaEffect.engine, P1);
  play(viaEffect.engine, P1, viaEffect.id("put"), { selected: { c: [viaEffect.id("pm")] } });
  assert.equal(inf(viaEffect.engine, P1), start + 3);

  const other = duo([
    { key: "pm", def: printing(PEACEFUL), owner: P1, zone: "play" },
    { key: "c", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  const before = inf(other.engine, P1);
  play(other.engine, P1, other.id("c"));
  assert.equal(inf(other.engine, P1), before, "another card entering play does not trigger it");

  const twice = duo([
    { key: "pm1", def: printing(PEACEFUL), owner: P1, zone: "hand" },
    { key: "pm2", def: printing(PEACEFUL), owner: P1, zone: "hand" },
    ...bank("greed", 4)
  ]);
  const t0 = inf(twice.engine, P1);
  play(twice.engine, P1, twice.id("pm1"));
  play(twice.engine, P1, twice.id("pm2"));
  assert.equal(inf(twice.engine, P1), t0 + 6, "each copy gains 3 when it enters");
});

// =============================================================================
// Pepper Breath
// tactic, warlord, cost 2, threshold [R][R]
// EXTRA COST: Pick a character or faction.
// Inflict 3 damage to the character or faction.
// =============================================================================

function pepperBoard(extra: CardPlacement[] = [], o: { rage?: number } = {}) {
  return duo([
    { key: "pb", def: printing(PEPPER), owner: P1, zone: "hand" },
    ...bank("rage", o.rage ?? 2),
    { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
    { key: "foe3", def: character({ name: "Foe3", life: 3 }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
    ...extra
  ]);
}
const pepper = (g: Game, pick: CardInstanceId[]): void => play(g.engine, P1, g.id("pb"), { selected: { tgt: pick } });

clause(PEPPER, "0:extraCost", "the target is picked as part of the cost: any character, mine or theirs, or either faction", () => {
  const foe = pepperBoard();
  playRaw(foe.engine, P1, foe.id("pb"), { selected: { tgt: [foe.id("foe")] } });
  assert.equal(ready(foe.engine), 0, "cost 2 paid");
  resolvePendingResponses(foe.engine);
  assert.equal(damageOn(foe.engine, foe.id("foe")), 3);
  const mine = pepperBoard();
  pepper(mine, [mine.id("mine")]);
  assert.equal(damageOn(mine.engine, mine.id("mine")), 3, "my own character is a legal pick");
  const theirFaction = pepperBoard();
  const oppBefore = inf(theirFaction.engine, P2);
  pepper(theirFaction, [factionOf(theirFaction.engine, P2)]);
  assert.equal(inf(theirFaction.engine, P2), oppBefore - 3, "the opponent's faction");
  const myFaction = pepperBoard();
  const myBefore = inf(myFaction.engine, P1);
  pepper(myFaction, [factionOf(myFaction.engine, P1)]);
  assert.equal(inf(myFaction.engine, P1), myBefore - 3, "my own faction is legal too");
});

clause(PEPPER, "0:extraCost", "only a character or a faction: an item, location, resource (face-up or face-down) and a character in a discard pile are refused; a pick is required", () => {
  const extra: CardPlacement[] = [
    { key: "gizmo", def: item({ name: "Gizmo" }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "res", def: resCard("Field Resource"), owner: P2, zone: "play" },
    { key: "down", def: character({ name: "Hidden", life: 5 }), owner: P2, zone: "play", faceDown: true },
    { key: "dead", def: character({ name: "Dead" }), owner: P2, zone: "discard" }
  ];
  for (const bad of ["gizmo", "loc", "res", "down", "dead"]) {
    const g = pepperBoard(extra);
    refused(() => pepper(g, [g.id(bad)]), bad);
    assert.equal(zoneOf(g.engine, g.id("pb")), "hand", bad);
    assert.equal(ready(g.engine), 2, `${bad}: nothing paid`);
  }
  const none = pepperBoard(extra);
  refused(() => play(none.engine, P1, none.id("pb")), "no pick");
  assert.equal(zoneOf(none.engine, none.id("pb")), "hand");
});

clause(PEPPER, "1:rule", "inflicts exactly 3 damage to the picked character: life 5 survives with 3 damage, life 3 is destroyed, nothing else is touched", () => {
  const g = pepperBoard();
  pepper(g, [g.id("foe")]);
  assert.equal(damageOn(g.engine, g.id("foe")), 3);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  assert.equal(damageOn(g.engine, g.id("foe3")), 0);
  assert.equal(damageOn(g.engine, g.id("mine")), 0);
  assert.equal(zoneOf(g.engine, g.id("pb")), "discard");
  const dies = pepperBoard();
  pepper(dies, [dies.id("foe3")]);
  assert.equal(zoneOf(dies.engine, dies.id("foe3")), "discard", "3 damage on 3 life destroys it");
  assert.equal(zoneOf(dies.engine, dies.id("foe")), "play");
});

clause(PEPPER, "1:rule", "inflicts exactly 3 damage to the picked faction (it loses 3 influence, no more) and the other faction is untouched", () => {
  const g = pepperBoard();
  const mine = inf(g.engine, P1);
  const theirs = inf(g.engine, P2);
  pepper(g, [factionOf(g.engine, P2)]);
  assert.equal(inf(g.engine, P2), theirs - 3);
  assert.equal(inf(g.engine, P1), mine);
  assert.equal(damageOn(g.engine, g.id("foe")), 0);
});

clause(PEPPER, "1:rule", "costs 2 with [R][R]: one resource, or two Greed, cannot play it", () => {
  const short = pepperBoard([], { rage: 1 });
  refused(() => pepper(short, [short.id("foe")]), "one resource");
  const wrong = duo([
    { key: "pb", def: printing(PEPPER), owner: P1, zone: "hand" },
    ...bank("greed", 2),
    { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" }
  ]);
  refused(() => pepper(wrong, [wrong.id("foe")]), "[R][R] missing");
  assert.equal(damageOn(wrong.engine, wrong.id("foe")), 0);
  const oneRage = duo([
    { key: "pb", def: printing(PEPPER), owner: P1, zone: "hand" },
    ...bank("greed", 1),
    ...bank("rage", 1),
    { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" }
  ]);
  refused(() => pepper(oneRage, [oneRage.id("foe")]), "only one [R]");
});

// =============================================================================
// Plunging Shriever
// character, warlord, subtype dragon, cost 4, threshold [R][R], 3 strength / 4 speed / 1 life
// When this card enters play, you may pick an item. If you do, destroy that item and lose 2 influence.
// FLY AWAY -- COST: Void an item in an opponent's discard pile. EFFECT: Flip this card face-down under its owner's control.
// FLIP UP: 3 [R][R]
// =============================================================================

function shrieverBoard(extra: CardPlacement[] = [], o: DuoOpts & { zone?: "hand" | "play"; rage?: number; faceDown?: boolean; spent?: boolean } = {}) {
  return duo(
    [
      {
        key: "s",
        def: printing(SHRIEVER),
        owner: P1,
        zone: o.zone ?? "hand",
        faceDown: o.faceDown,
        ...(o.spent ? { attachedToKey: "__factionA" } : {})
      },
      ...bank("rage", o.rage ?? 4),
      ...extra
    ],
    o
  );
}
const shrieverItems: CardPlacement[] = [
  { key: "theirItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
  { key: "myItem", def: item({ name: "My Item" }), owner: P1, zone: "play" },
  { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
  { key: "loc", def: location({ name: "Place" }), owner: P2, zone: "play" },
  { key: "deadItem", def: item({ name: "Dead Item" }), owner: P2, zone: "discard" }
];

clause(SHRIEVER, "0:rule", "printed card: deploys for 4 with [R][R], stats 3/1/4, subtype dragon", () => {
  const g = shrieverBoard([], { rage: 4 });
  play(g.engine, P1, g.id("s"));
  drain(g.engine, (pc) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { itm: [] } } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("s")), "play");
  assert.equal(ready(g.engine), 0, "cost 4");
  assert.deepEqual(stats(g.engine, g.id("s")), [3, 1, 4]);
  assert.deepEqual(printing(SHRIEVER).subtype, ["dragon"]);
  const short = shrieverBoard([], { rage: 3 });
  refused(() => play(short.engine, P1, short.id("s")), "cost 4 with three resources");
  const wrong = duo([{ key: "s", def: printing(SHRIEVER), owner: P1, zone: "hand" }, ...bank("greed", 4)]);
  refused(() => play(wrong.engine, P1, wrong.id("s")), "[R][R] missing");
});

clause(SHRIEVER, "0:rule", "when it enters play I may pick an item (theirs or mine): it is destroyed and I lose 2 influence", () => {
  for (const key of ["theirItem", "myItem"]) {
    const g = shrieverBoard(shrieverItems);
    const before = inf(g.engine, P1);
    const oppBefore = inf(g.engine, P2);
    play(g.engine, P1, g.id("s"));
    assert.equal(pending(g.engine)?.kind, "selectTargets", "I am offered the item pick");
    answerPending(g.engine, "selectTargets", { selected: { itm: [g.id(key)] } });
    assert.equal(zoneOf(g.engine, g.id(key)), "discard", `${key} destroyed`);
    assert.equal(inf(g.engine, P1), before - 2, "I lost 2 influence");
    assert.equal(inf(g.engine, P2), oppBefore, "the opponent did not");
    assert.equal(zoneOf(g.engine, g.id("s")), "play");
  }
});

clause(SHRIEVER, "0:rule", "'you may': declining destroys nothing and costs no influence", () => {
  const g = shrieverBoard(shrieverItems);
  const before = inf(g.engine, P1);
  play(g.engine, P1, g.id("s"));
  answerPending(g.engine, "selectTargets", { selected: { itm: [] } });
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "play");
  assert.equal(zoneOf(g.engine, g.id("myItem")), "play");
  assert.equal(inf(g.engine, P1), before, "'if you do': no pick, no loss");
});

clause(SHRIEVER, "0:rule", "only an item in play can be picked: a character, a location, an item in a discard pile and a resource are refused", () => {
  const extra: CardPlacement[] = [...shrieverItems, { key: "res", def: resCard("Field Resource"), owner: P2, zone: "play" }];
  for (const bad of ["foe", "loc", "deadItem", "res"]) {
    const g = shrieverBoard(extra);
    play(g.engine, P1, g.id("s"));
    refused(() => answerPending(g.engine, "selectTargets", { selected: { itm: [g.id(bad)] } }), bad);
  }
});

clause(SHRIEVER, "0:rule", "it triggers when put into play by an effect too, and no loss happens with no item in play", () => {
  const viaEffect = shrieverBoard([...shrieverItems, { key: "put", def: PUT_FROM_HAND, owner: P1, zone: "hand" }]);
  play(viaEffect.engine, P1, viaEffect.id("put"), { selected: { c: [viaEffect.id("s")] } });
  assert.equal(pending(viaEffect.engine)?.kind, "selectTargets", "entering play by an effect still offers the pick");
  const none = shrieverBoard([{ key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }]);
  const before = inf(none.engine, P1);
  play(none.engine, P1, none.id("s"));
  drain(none.engine, (pc) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { itm: [] } } : declineAll(pc)));
  assert.equal(inf(none.engine, P1), before);
  assert.equal(zoneOf(none.engine, none.id("s")), "play");
});

const flyAway = (g: Game, pick: string[]): void => activate(g.engine, P1, g.id("s"), "fly-away", { selected: { gone: pick.map((k) => g.id(k)) } });

clause(SHRIEVER, "1:ability:fly-away", "voids an item from an opponent's discard pile as the cost, then flips the Shriever face-down in play under my control; no resources are needed", () => {
  const g = shrieverBoard(shrieverItems, { zone: "play", rage: 0 });
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("s"), abilityId: "fly-away", selected: { gone: [g.id("deadItem")] }, variables: {} } as never);
  assert.equal(zoneOf(g.engine, g.id("deadItem")), "void", "voided as a cost");
  assert.equal(card(g.engine, g.id("s")).faceDown, false, "not flipped until it resolves");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("s")), "play");
  assert.equal(card(g.engine, g.id("s")).faceDown, true, "flipped face-down");
  assert.equal(card(g.engine, g.id("s")).controllerId, P1);
  assert.deepEqual(threshold(g.engine), { volition: 1 }, "a face-down card is a Volition resource");
});

clause(SHRIEVER, "1:ability:fly-away", "only an ITEM in an OPPONENT's DISCARD PILE: a character there, my own discarded item, and items in play are refused", () => {
  const extra: CardPlacement[] = [
    ...shrieverItems,
    { key: "deadChar", def: character({ name: "Dead Char" }), owner: P2, zone: "discard" },
    { key: "myDeadItem", def: item({ name: "My Dead Item" }), owner: P1, zone: "discard" }
  ];
  for (const bad of ["deadChar", "myDeadItem", "theirItem", "myItem"]) {
    const g = shrieverBoard(extra, { zone: "play" });
    refused(() => flyAway(g, [bad]), bad);
    assert.equal(card(g.engine, g.id("s")).faceDown, false, `${bad}: not flipped`);
  }
  const noItem = shrieverBoard([{ key: "deadChar", def: character({ name: "Dead Char" }), owner: P2, zone: "discard" }], { zone: "play" });
  refused(() => noItem.engine.perform({ type: "activateAbility", playerId: P1, cardId: noItem.id("s"), abilityId: "fly-away", selected: {}, variables: {} } as never), "no item in an opponent's discard pile");
  assert.equal(card(noItem.engine, noItem.id("s")).faceDown, false);
});

clause(SHRIEVER, "1:ability:fly-away", "'under its owner's control': a Shriever I control but the opponent owns comes back face-down under its owner", () => {
  const g = duo([
    { key: "s", def: printing(SHRIEVER), owner: P2, zone: "play", controller: P1 },
    { key: "deadItem", def: item({ name: "Dead Item" }), owner: P2, zone: "discard" }
  ]);
  flyAway(g, ["deadItem"]);
  assert.equal(card(g.engine, g.id("s")).faceDown, true);
  assert.equal(card(g.engine, g.id("s")).controllerId, P2, "its owner controls it");
});

const shrieverFlipUp = (g: Game, player: PlayerId = P1): void => flipUpNow(g.engine, { type: "flipUp", playerId: player, cardId: g.id("s"), selected: {}, variables: {} });

clause(SHRIEVER, "2:flipUp", "a face-down Shriever flips up for exactly 3 with [R][R] into a face-up character with its printed stats", () => {
  const g = shrieverBoard([], { zone: "play", faceDown: true, spent: true, rage: 3 });
  assert.equal(ready(g.engine), 3);
  shrieverFlipUp(g);
  drain(g.engine, (pc) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { itm: [] } } : declineAll(pc)));
  const s = card(g.engine, g.id("s"));
  assert.equal(s.zone, "play");
  assert.equal(s.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("s")), ["character"]);
  assert.deepEqual(stats(g.engine, g.id("s")), [3, 1, 4]);
  assert.equal(ready(g.engine), 0, "exactly 3 paid (not its normal cost of 4)");
});

clause(SHRIEVER, "2:flipUp", "refused when short or without the threshold: two resources, three Greed, or one Rage plus two Greed cannot flip it up", () => {
  const cases: Array<[string, CardPlacement[]]> = [
    ["two Rage", bank("rage", 2)],
    ["three Greed", bank("greed", 3)],
    ["one Rage and two Greed", [...bank("rage", 1), ...bank("greed", 2)]]
  ];
  for (const [why, banks] of cases) {
    const g = duo([{ key: "s", def: printing(SHRIEVER), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" }, ...banks]);
    refused(() => shrieverFlipUp(g), why);
    assert.equal(card(g.engine, g.id("s")).faceDown, true, why);
    assert.equal(ready(g.engine), banks.length, `${why}: nothing paid`);
  }
  const ok = duo([{ key: "s", def: printing(SHRIEVER), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" }, ...bank("rage", 2), ...bank("greed", 1)]);
  shrieverFlipUp(ok);
  drain(ok.engine, (pc) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { itm: [] } } : declineAll(pc)));
  assert.equal(card(ok.engine, ok.id("s")).faceDown, false, "control: two Rage and one other resource");
});

clause(SHRIEVER, "2:flipUp", "a flipped-up card is a new card that has entered play: its enters-play trigger offers the item pick", () => {
  const g = shrieverBoard([{ key: "theirItem", def: item({ name: "Their Item" }), owner: P2, zone: "play" }], { zone: "play", faceDown: true, spent: true, rage: 3 });
  const before = inf(g.engine, P1);
  shrieverFlipUp(g);
  assert.equal(pending(g.engine)?.kind, "selectTargets", "CR 411.3: the face-up version entered play as a new card");
  answerPending(g.engine, "selectTargets", { selected: { itm: [g.id("theirItem")] } });
  assert.equal(zoneOf(g.engine, g.id("theirItem")), "discard");
  assert.equal(inf(g.engine, P1), before - 2);
});

clause(SHRIEVER, "2:flipUp", "FLIP UP does not change when a character can be deployed: refused on the opponent's turn, with or without a response window", () => {
  const closed = shrieverBoard([{ key: "atk", def: character({ name: "Attacker", life: 6 }), owner: P2, zone: "play" }], { zone: "play", faceDown: true, spent: true, rage: 3, active: P2, turn: 2 });
  refused(() => shrieverFlipUp(closed), "the opponent's turn, no window");
  assert.equal(card(closed.engine, closed.id("s")).faceDown, true);
  const open = shrieverBoard([{ key: "atk", def: character({ name: "Attacker", life: 6 }), owner: P2, zone: "play" }], { zone: "play", faceDown: true, spent: true, rage: 3, active: P2, turn: 2 });
  declareAttackOpenWindow(open.engine, P2, [open.id("atk")]);
  refused(() => shrieverFlipUp(open), "inside the opponent's response window (CR 507.4d)");
  assert.equal(card(open.engine, open.id("s")).faceDown, true);
  assert.equal(ready(open.engine), 3, "nothing was paid");
});

clause(SHRIEVER, "2:flipUp", "only its controller can flip it up, and not a face-up one or one in hand", () => {
  const g = shrieverBoard([], { zone: "play", faceDown: true, spent: true, rage: 3 });
  refused(() => shrieverFlipUp(g, P2), "the opponent");
  assert.equal(card(g.engine, g.id("s")).faceDown, true);
  const up = shrieverBoard([], { zone: "play", spent: true, rage: 3 });
  refused(() => shrieverFlipUp(up), "already face-up");
  const hand = shrieverBoard([], { zone: "hand", rage: 3 });
  refused(() => shrieverFlipUp(hand), "in hand");
  assert.equal(zoneOf(hand.engine, hand.id("s")), "hand");
});

// =============================================================================
// Pogo Bomb
// item, gearsmith, cost 5, threshold [E][E][E]
// 'SPLODE -- COST: Pay 4. Destroy this card. EFFECT: Destroy all characters.
// =============================================================================

function pogoBoard(extra: CardPlacement[] = [], o: { resources?: number; zone?: "play" | "hand" } = {}) {
  return duo([
    { key: "pb", def: printing(POGO), owner: P1, zone: o.zone ?? "play" },
    ...bank("rage", o.resources ?? 4),
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
    { key: "tough", def: character({ name: "Tough", life: 9 }), owner: P2, zone: "play" },
    { key: "gizmo", def: item({ name: "Gizmo" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "down", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
    ...extra
  ]);
}
const splode = (g: Game): void => activate(g.engine, P1, g.id("pb"), "pogo-bomb-splode");

clause(POGO, "0:ability:pogo-bomb-splode", "printed card: deploys for 5 with [E][E][E]", () => {
  const g = duo([{ key: "pb", def: printing(POGO), owner: P1, zone: "hand" }, ...bank("elitism", 5)]);
  play(g.engine, P1, g.id("pb"));
  assert.equal(zoneOf(g.engine, g.id("pb")), "play");
  assert.equal(ready(g.engine), 0);
  assert.deepEqual(g.engine.getCardTypes(g.id("pb")), ["item"]);
  const short = duo([{ key: "pb", def: printing(POGO), owner: P1, zone: "hand" }, ...bank("elitism", 4)]);
  refused(() => play(short.engine, P1, short.id("pb")), "cost 5 with four resources");
  const wrong = duo([{ key: "pb", def: printing(POGO), owner: P1, zone: "hand" }, ...bank("rage", 5)]);
  refused(() => play(wrong.engine, P1, wrong.id("pb")), "[E][E][E] missing");
});

clause(POGO, "0:ability:pogo-bomb-splode", "the cost is paid at activation: 4 resources are spent and the bomb is destroyed before anything resolves", () => {
  const g = pogoBoard([], { resources: 5 });
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("pb"), abilityId: "pogo-bomb-splode", selected: {}, variables: {} } as never);
  assert.equal(ready(g.engine), 1, "pay 4 of 5");
  assert.equal(zoneOf(g.engine, g.id("pb")), "discard", "destroyed as a cost");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "the characters are destroyed by the effect, not the cost");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
});

clause(POGO, "0:ability:pogo-bomb-splode", "destroys ALL characters, mine and the opponent's, whatever their life; items, locations, resources and factions survive", () => {
  const g = pogoBoard();
  const influences = [inf(g.engine, P1), inf(g.engine, P2)];
  splode(g);
  for (const key of ["mine", "theirs", "tough"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", key);
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "play", "an item survives");
  assert.equal(zoneOf(g.engine, g.id("place")), "play", "a location survives");
  assert.equal(zoneOf(g.engine, g.id("down")), "play", "a face-down card is a resource, not a character");
  assert.equal(zoneOf(g.engine, g.id("pb")), "discard");
  assert.deepEqual([inf(g.engine, P1), inf(g.engine, P2)], influences, "factions are untouched");
});

clause(POGO, "0:ability:pogo-bomb-splode", "needs 4 resources: with 3 it is refused and nothing is destroyed; with no characters in play it still works", () => {
  const g = pogoBoard([], { resources: 3 });
  refused(() => splode(g), "pay 4 with three resources");
  assert.equal(zoneOf(g.engine, g.id("pb")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(ready(g.engine), 3);
  const empty = duo([{ key: "pb", def: printing(POGO), owner: P1, zone: "play" }, ...bank("rage", 4)]);
  splode(empty);
  assert.equal(zoneOf(empty.engine, empty.id("pb")), "discard");
  assert.equal(ready(empty.engine), 0);
});

clause(POGO, "0:ability:pogo-bomb-splode", "any 4 resources will do (no threshold) and it works from play only, not from hand", () => {
  const mixed = duo([{ key: "pb", def: printing(POGO), owner: P1, zone: "play" }, ...bank("greed", 2), ...bank("rage", 2), { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }]);
  splode(mixed);
  assert.equal(zoneOf(mixed.engine, mixed.id("mine")), "discard");
  const hand = pogoBoard([], { zone: "hand" });
  refused(() => splode(hand), "in hand", /zone|play/i);
  assert.equal(zoneOf(hand.engine, hand.id("mine")), "play");
});

// =============================================================================
// Purge the Villainous
// tactic, universal, cost 5, no threshold
// EXTRA COST: Pick a character.
// Void that character.
// =============================================================================

function purgeBoard(extra: CardPlacement[] = [], o: { resources?: number } = {}) {
  return duo([
    { key: "pv", def: printing(PURGE), owner: P1, zone: "hand" },
    ...bank("rage", o.resources ?? 5),
    { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other" }), owner: P2, zone: "play" },
    ...extra
  ]);
}
const purge = (g: Game, pick: CardInstanceId[]): void => play(g.engine, P1, g.id("pv"), { selected: { c: pick } });

clause(PURGE, "0:extraCost", "the character is picked as a cost, together with the numeric cost 5 (any resources: no threshold)", () => {
  const g = purgeBoard();
  playRaw(g.engine, P1, g.id("pv"), { selected: { c: [g.id("foe")] } });
  assert.equal(ready(g.engine), 0, "5 paid");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "picked, not yet voided");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("foe")), "void");
  const short = purgeBoard([], { resources: 4 });
  refused(() => purge(short, [short.id("foe")]), "cost 5 with four resources");
  assert.equal(zoneOf(short.engine, short.id("foe")), "play");
  const mixed = duo([
    { key: "pv", def: printing(PURGE), owner: P1, zone: "hand" },
    ...bank("greed", 2),
    ...bank("elitism", 2),
    ...bank("obsession", 1),
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
  ]);
  purge(mixed, [mixed.id("foe")]);
  assert.equal(zoneOf(mixed.engine, mixed.id("foe")), "void", "control: five mixed resources");
});

clause(PURGE, "0:extraCost", "any character in play can be picked, mine or theirs; an item, a location, a resource, a faction, a discarded character and no pick are refused", () => {
  for (const key of ["foe", "mine"]) {
    const g = purgeBoard();
    purge(g, [g.id(key)]);
    assert.equal(zoneOf(g.engine, g.id(key)), "void", key);
  }
  const extra: CardPlacement[] = [
    { key: "gizmo", def: item({ name: "Gizmo" }), owner: P2, zone: "play" },
    { key: "loc", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "res", def: resCard("Field Resource"), owner: P2, zone: "play" },
    { key: "down", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
    { key: "dead", def: character({ name: "Dead" }), owner: P2, zone: "discard" }
  ];
  for (const bad of ["gizmo", "loc", "res", "down", "dead"]) {
    const g = purgeBoard(extra);
    refused(() => purge(g, [g.id(bad)]), bad);
    assert.equal(zoneOf(g.engine, g.id("pv")), "hand", bad);
    assert.equal(ready(g.engine), 5, `${bad}: nothing paid`);
  }
  const faction = purgeBoard();
  refused(() => purge(faction, [factionOf(faction.engine, P2)]), "a faction (CR 202.9a)");
  const none = purgeBoard();
  refused(() => play(none.engine, P1, none.id("pv")), "no pick");
  assert.equal(zoneOf(none.engine, none.id("pv")), "hand");
});

clause(PURGE, "1:rule", "voids that character (the void zone, not the discard pile), leaves every other card alone, and the tactic goes to the discard pile", () => {
  const g = purgeBoard();
  purge(g, [g.id("foe")]);
  assert.equal(zoneOf(g.engine, g.id("foe")), "void");
  assert.ok(!discardOf(g.engine, P2).includes(g.id("foe")), "not in the discard pile");
  assert.equal(zoneOf(g.engine, g.id("other")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(zoneOf(g.engine, g.id("pv")), "discard");
});

clause(PURGE, "1:rule", "a Micromajig token can be picked and voided: it is no longer in play", () => {
  const g = tokens(purgeBoard([mmCard("tok", P2)]), "tok");
  purge(g, [g.id("tok")]);
  assert.notEqual(g.engine.state.cards[g.id("tok")]?.zone, "play");
  assert.equal(micromajigTokens(g.engine).length, 0);
});

// =============================================================================
// Extra checks: the printed identity of every card (literal values from the manifest), and edge cases of the
// grant / link / turn-structure clauses above.
// =============================================================================

interface Printed {
  type: string;
  trade: string;
  cost: number;
  threshold?: string;
  strength?: number;
  life?: number;
  speed?: number;
  structure?: number;
  subtype?: string[];
  unique?: string;
}
function identity(id: string, e: Printed): void {
  const p = printing(id);
  assert.equal(p.type, e.type, "type");
  assert.equal(p.trade, e.trade, "trade");
  assert.equal(p.cost, e.cost, "cost");
  if (e.threshold) assert.equal(p.threshold, e.threshold, "threshold");
  else assert.ok(!p.threshold, `no threshold (found ${String(p.threshold)})`);
  assert.equal(p.strength, e.strength, "strength");
  assert.equal(p.life, e.life, "life");
  assert.equal(p.speed, e.speed, "speed");
  assert.equal(p.structure, e.structure, "structure");
  assert.deepEqual(p.subtype ?? [], e.subtype ?? [], "subtype");
  assert.equal(p.unique, e.unique, "unique");
}

clause(OVERLORD, "0:rule", "printed identity: Gearsmith lord character, cost 4, [E], 2 strength / 2 life / 3 speed", () =>
  identity(OVERLORD, { type: "character", trade: "gearsmith", cost: 4, threshold: "e", strength: 2, life: 2, speed: 3, subtype: ["lord"] }));
clause(PARTY, "1:rule", "printed identity: Gearsmith tactic, cost 2, [E][E]", () => identity(PARTY, { type: "tactic", trade: "gearsmith", cost: 2, threshold: "ee" }));
clause(MINDRENDER, "1:rule", "printed identity: Arcanist demon character, cost 3, [O], 2 strength / 1 life / 3 speed", () =>
  identity(MINDRENDER, { type: "character", trade: "arcanist", cost: 3, threshold: "o", strength: 2, life: 1, speed: 3, subtype: ["demon"] }));
clause(MONTGOMERY, "0:unique", "printed identity: Banker mau character, cost 1, [G][G][G], 1 strength / 1 life / 3 speed, UNIQUE MONTGOMERY", () =>
  identity(MONTGOMERY, { type: "character", trade: "banker", cost: 1, threshold: "ggg", strength: 1, life: 1, speed: 3, subtype: ["mau"], unique: "montgomery" }));
clause(THUMB, "0:rule", "printed identity: Banker mau environmentalist character, cost 2, [G], 1 strength / 1 life / 3 speed", () =>
  identity(THUMB, { type: "character", trade: "banker", cost: 2, threshold: "g", strength: 1, life: 1, speed: 3, subtype: ["mau", "environmentalist"] }));
clause(HIATUS, "1:rule", "printed identity: Banker tactic, cost 1, [G]", () => identity(HIATUS, { type: "tactic", trade: "banker", cost: 1, threshold: "g" }));
clause(MUTILATOR, "0:rule", "printed identity: Warlord soldier character, cost 3, [R], 2 strength / 2 life / 3 speed", () =>
  identity(MUTILATOR, { type: "character", trade: "warlord", cost: 3, threshold: "r", strength: 2, life: 2, speed: 3, subtype: ["soldier"] }));
clause(NARCISSISM, "0:rule", "printed identity: Arcanist resource, cost 0, and on its own it provides nothing", () => {
  identity(NARCISSISM, { type: "resource", trade: "arcanist", cost: 0 });
  const g = duo([{ key: "n", def: printing(NARCISSISM), owner: P1, zone: "play" }]);
  assert.deepEqual(threshold(g.engine), {}, "no printed PROVIDES");
});
clause(MIRAGE, "0:rule", "printed identity: Banker location, cost 3, [G], structure 5", () => identity(MIRAGE, { type: "location", trade: "banker", cost: 3, threshold: "g", structure: 5 }));
clause(RITUALS, "1:rule", "printed identity: Banker tactic, cost 5, [G][G][G]", () => identity(RITUALS, { type: "tactic", trade: "banker", cost: 5, threshold: "ggg" }));
clause(OBOL_DECEPTION, "0:provides", "printed identity: Universal resource, cost 0", () => identity(OBOL_DECEPTION, { type: "resource", trade: "universal", cost: 0 }));
clause(OBOL_ELITISM, "0:provides", "printed identity: Universal resource, cost 0", () => identity(OBOL_ELITISM, { type: "resource", trade: "universal", cost: 0 }));
clause(OBOL_GREED, "0:provides", "printed identity: Universal resource, cost 0", () => identity(OBOL_GREED, { type: "resource", trade: "universal", cost: 0 }));
clause(OBOL_OBSESSION, "0:provides", "printed identity: Universal resource, cost 0", () => identity(OBOL_OBSESSION, { type: "resource", trade: "universal", cost: 0 }));
clause(OBOL_RAGE, "0:provides", "printed identity: Universal resource, cost 0", () => identity(OBOL_RAGE, { type: "resource", trade: "universal", cost: 0 }));
clause(PIRATE, "1:extraCost", "printed identity: Rogue pirate character, cost 7, [D][D], 4 strength / 1 life / 5 speed", () =>
  identity(PIRATE, { type: "character", trade: "rogue", cost: 7, threshold: "dd", strength: 4, life: 1, speed: 5, subtype: ["pirate"] }));
clause(OVERCOMP, "0:rule", "printed identity: Warlord soldier character, cost 1, [R][R], 2 strength / 1 life / 3 speed", () =>
  identity(OVERCOMP, { type: "character", trade: "warlord", cost: 1, threshold: "rr", strength: 2, life: 1, speed: 3, subtype: ["soldier"] }));
clause(PARANOIA, "0:rule", "printed identity: Arcanist resource, cost 0, and on its own it provides nothing", () => {
  identity(PARANOIA, { type: "resource", trade: "arcanist", cost: 0 });
  const g = duo([{ key: "n", def: printing(PARANOIA), owner: P1, zone: "play" }]);
  assert.deepEqual(threshold(g.engine), {}, "no printed PROVIDES");
});
clause(PEACEFUL, "0:rule", "printed identity: Banker mau opportunist character, cost 2, [G], 2 strength / 1 life / 3 speed", () =>
  identity(PEACEFUL, { type: "character", trade: "banker", cost: 2, threshold: "g", strength: 2, life: 1, speed: 3, subtype: ["mau", "opportunist"] }));
clause(PEPPER, "1:rule", "printed identity: Warlord tactic, cost 2, [R][R]", () => identity(PEPPER, { type: "tactic", trade: "warlord", cost: 2, threshold: "rr" }));
clause(SHRIEVER, "0:rule", "printed identity: Warlord dragon character, cost 4, [R][R], 3 strength / 1 life / 4 speed", () =>
  identity(SHRIEVER, { type: "character", trade: "warlord", cost: 4, threshold: "rr", strength: 3, life: 1, speed: 4, subtype: ["dragon"] }));
clause(POGO, "0:ability:pogo-bomb-splode", "printed identity: Gearsmith item, cost 5, [E][E][E]", () => identity(POGO, { type: "item", trade: "gearsmith", cost: 5, threshold: "eee" }));
clause(PURGE, "1:rule", "printed identity: Universal tactic, cost 5, no threshold", () => identity(PURGE, { type: "tactic", trade: "universal", cost: 5 }));

clause(OVERLORD, "1:rule", "the token the Overlord itself makes when it enters play is already a 2/2/4 Micromajig token", () => {
  const g = duo([{ key: "o", def: printing(OVERLORD), owner: P1, zone: "hand" }, ...bank("elitism", 4)]);
  play(g.engine, P1, g.id("o"));
  drain(g.engine, declineAll);
  const toks = micromajigTokens(g.engine, P1);
  assert.equal(toks.length, 1);
  assert.deepEqual(stats(g.engine, toks[0].id), [2, 2, 4]);
});

clause(PARTY, "1:rule", "with a Micromajig Overlord in play the token the Party makes is a 2/2/4 Micromajig token", () => {
  const g = partyBoard([{ key: "o", def: printing(OVERLORD), owner: P1, zone: "play" }]);
  play(g.engine, P1, g.id("party"));
  const toks = micromajigTokens(g.engine, P1);
  assert.equal(toks.length, 1);
  assert.deepEqual(stats(g.engine, toks[0].id), [2, 2, 4]);
});

clause(MINDRENDER, "1:rule", "the reveal shows the card to everyone, not only to me", () => {
  const g = mindBoard({ obsession: 3 });
  opponentDiscards(g);
  drain(g.engine, yes);
  const events = reveals(g.engine).map((entry) => entry.event as unknown as { cardIds: string[]; viewerId: string });
  const mine = events.find((event) => event.cardIds.includes(g.id("mind")));
  assert.ok(mine, "Mindrender was revealed");
  assert.equal(mine.viewerId, "all");
});

clause(NARCISSISM, "0:rule", "each naming is its own: naming [O] and then [E] in one turn gives one of each, not two of the last", () => {
  const g = nameBoard(NARCISSISM);
  play(g.engine, P1, g.id("putRes"), { selected: { c: [g.id("r")] } });
  answerPending(g.engine, "nameValue", { value: "obsession" });
  play(g.engine, P1, g.id("putRes2"), { selected: { c: [g.id("r2")] } });
  answerPending(g.engine, "nameValue", { value: "elitism" });
  assert.equal(iconCount(g.engine, "obsession"), 1);
  assert.equal(iconCount(g.engine, "elitism"), 1);
});

clause(PARANOIA, "0:rule", "each naming is its own: naming [O] and then [D] in one turn gives one of each, not two of the last", () => {
  const g = nameBoard(PARANOIA);
  play(g.engine, P1, g.id("putRes"), { selected: { c: [g.id("r")] } });
  answerPending(g.engine, "nameValue", { value: "obsession" });
  play(g.engine, P1, g.id("putRes2"), { selected: { c: [g.id("r2")] } });
  answerPending(g.engine, "nameValue", { value: "deception" });
  assert.equal(iconCount(g.engine, "obsession"), 1);
  assert.equal(iconCount(g.engine, "deception"), 1);
});

const namingCardGoneTakesIconAway = (cardId: string, icon: Icon) => () => {
  const g = duo([
    { key: "n", def: printing(cardId), owner: P1, zone: "play" },
    { key: "r", def: plainGreed(), owner: P1, zone: "hand" },
    { key: "smite", def: DESTROY_ANY, owner: P1, zone: "hand" }
  ]);
  developResource(g.engine, P1, g.id("r"), false);
  answerPending(g.engine, "nameValue", { value: icon });
  assert.equal(iconCount(g.engine, icon), 1);
  play(g.engine, P1, g.id("smite"), { selected: { t: [g.id("n")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("n")), "discard");
  assert.equal(iconCount(g.engine, icon), 0, "'this card gains' the icon: once the card is gone so is the icon");
};
const namingFaceDownDoesNothing = (cardId: string) => () => {
  const g = duo([
    { key: "n", def: printing(cardId), owner: P1, zone: "play", faceDown: true },
    { key: "r", def: plainGreed(), owner: P1, zone: "hand" }
  ]);
  developResource(g.engine, P1, g.id("r"), false);
  assert.equal(g.engine.state.pendingChoice, undefined, "a face-down card has no rules text");
};
clause(NARCISSISM, "0:rule", "if the card leaves play the named icon goes with it", namingCardGoneTakesIconAway(NARCISSISM, "obsession"));
clause(NARCISSISM, "0:rule", "face-down it is just a resource: it names nothing", namingFaceDownDoesNothing(NARCISSISM));
clause(PARANOIA, "0:rule", "if the card leaves play the named icon goes with it", namingCardGoneTakesIconAway(PARANOIA, "deception"));
clause(PARANOIA, "0:rule", "face-down it is just a resource: it names nothing", namingFaceDownDoesNothing(PARANOIA));

const obolGoneTakesIconAway = (cardId: string, icon: Icon) => () => {
  const smite = duo([
    { key: "o", def: printing(cardId), owner: P1, zone: "play" },
    { key: "smite", def: DESTROY_ANY, owner: P1, zone: "hand" }
  ]);
  activate(smite.engine, P1, smite.id("o"), "imbue");
  assert.equal(threshold(smite.engine)[icon], 2);
  play(smite.engine, P1, smite.id("smite"), { selected: { t: [smite.id("o")] } });
  assert.equal(zoneOf(smite.engine, smite.id("o")), "discard");
  assert.equal(threshold(smite.engine)[icon] ?? 0, 0, "'this card gains' the icons: no phantom icons stay behind");
  assert.deepEqual(threshold(smite.engine), {});
};
clause(OBOL_DECEPTION, "1:ability:imbue", "the gained icons belong to the Obol: destroyed, nothing is left", obolGoneTakesIconAway(OBOL_DECEPTION, "deception"));
clause(OBOL_ELITISM, "1:ability:imbue", "the gained icons belong to the Obol: destroyed, nothing is left", obolGoneTakesIconAway(OBOL_ELITISM, "elitism"));
clause(OBOL_GREED, "1:ability:imbue", "the gained icons belong to the Obol: destroyed, nothing is left", obolGoneTakesIconAway(OBOL_GREED, "greed"));
clause(OBOL_OBSESSION, "1:ability:imbue", "the gained icons belong to the Obol: destroyed, nothing is left", obolGoneTakesIconAway(OBOL_OBSESSION, "obsession"));
clause(OBOL_RAGE, "1:ability:imbue", "the gained icons belong to the Obol: destroyed, nothing is left", obolGoneTakesIconAway(OBOL_RAGE, "rage"));

clause(MIRAGE, "0:rule", "each Mirage keeps its own voided card: destroying one returns only its card", () => {
  const second = tactic({ name: "Dummy", cost: 0 });
  const g = mirageBoard([
    { key: "m2", def: printing(MIRAGE), owner: P1, zone: "hand" },
    { key: "d", def: second, owner: P1, zone: "hand" },
    ...bank("greed", 3)
  ]);
  mirageEnter(g, ["foe"]);
  play(g.engine, P1, g.id("m2"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("gizmo")] });
  assert.equal(zoneOf(g.engine, g.id("foe")), "void");
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "void");
  destroyMirage(g);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "the first Mirage's card returns");
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "void", "the second Mirage's card stays voided");
});

clause(MIRAGE, "0:rule", "a Mirage that leaves play and comes back voids a new card, and only that one returns the second time", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });
  const g = mirageBoard([{ key: "bounce", def: bounce, owner: P1, zone: "hand" }, ...bank("greed", 3)]);
  mirageEnter(g, ["foe"]);
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("m")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "returned the first time");
  mirageEnter(g, ["gizmo"]);
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "void");
  destroyMirage(g);
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "play", "the second card returns");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play", "and the first card is not disturbed");
});

clause(MUTILATOR, "0:rule", "damage is per turn: two Mutilators kill a 2-life character in one turn start, and the Mutilators (2 life) survive their 1 damage", () => {
  const g = mutilatorBoard([{ key: "two", def: character({ name: "Two Life", life: 2 }), owner: P2, zone: "play" }], { count: 2 });
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("two")), "discard", "2 damage on 2 life");
  assert.equal(zoneOf(g.engine, g.id("mut")), "play");
  assert.equal(zoneOf(g.engine, g.id("mut2")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play", "3 life survives 2 damage");
});

clause(MUTILATOR, "0:rule", "it triggers at the start of every one of my turns, not only the first", () => {
  const g = mutilatorBoard([{ key: "weak2", def: character({ name: "Weak Two", life: 1 }), owner: P2, zone: "hand" }]);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("weak")), "discard");
  // the opponent deploys another 1-life character during their next turn; my next turn start kills it too
  endTurn(g.engine, P1);
  play(g.engine, P2, g.id("weak2"));
  assert.equal(zoneOf(g.engine, g.id("weak2")), "play");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("weak2")), "discard", "my second turn start");
});

clause(OVERCOMP, "0:rule", "X can drop to 0: with the Overcompensator at 0 strength any character may block it", () => {
  const g = overcompBoard([{ key: "shrink", def: pump(-2), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("shrink"), { selected: { t: [g.id("oc")] } });
  assert.equal(g.engine.getStat(g.id("oc"), "strength"), 0);
  attackWith(g, ["oc"]);
  blockWith(g, ["b1"]);
  assert.deepEqual(blockers(g), [g.id("b1")]);
});

clause(OVERCOMP, "0:rule", "it works for either player's Overcompensator: the opponent's one attacking me cannot be blocked by my strength-1 character", () => {
  const board = () =>
    duo(
      [
        { key: "oc", def: printing(OVERCOMP), owner: P2, zone: "play" },
        { key: "weak", def: character({ name: "Weak", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
        { key: "even", def: character({ name: "Even", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" }
      ],
      { active: P2, turn: 2 }
    );
  const weak = board();
  declareAttackBy(weak.engine, P2, [weak.id("oc")]);
  refused(() => declareBlockers(weak.engine, P1, [weak.id("weak")]), "strength 1 < 2");
  const even = board();
  declareAttackBy(even.engine, P2, [even.id("oc")]);
  declareBlockers(even.engine, P1, [even.id("even")]);
  assert.deepEqual(even.engine.state.battle?.blockingParty, [even.id("even")]);
});
