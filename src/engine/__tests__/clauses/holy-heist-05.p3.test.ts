import assert from "node:assert/strict";
import {
  buildGame,
  answer,
  bank,
  character,
  developFaction,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import { declareAttackOpenWindow } from "./_battle.js";
import { pending, zoneOf } from "./_board.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { printedStats } from "./_printed.js";

const CAPER = "e91b8651-6e73-4d29-af1e-82bef2e72932"; // tactic rogue cost 3 "d" -- EXTRA COST respond to a char pick; bounce it, draw if UNIQUE PLUCK; FLIP UP 1 [D]
const CHEATS = "6d385d6a-39e5-4b8f-b68b-3519ca99268a"; // char rogue cost 4 "dddd" 1/4/3 UNIQUE PLUCK -- pick an opponent; search 4 non-resource different names -> void, 2 random to discard, deploy rest from void ignoring threshold
const CHUM = "30b358cd-6c60-4e9e-b341-7d04fd80e135"; // char rogue cost 2 "dd" str2/spd3/life2 UNIQUE CHUM TACTICAL -- pick a discard card (X = cost), remove it, search opp deck cost<=X -> discard; SERAPHIM FUSION pay 4

const OMAH = "Omahkapi'si Pi'kssii";

const ready = (engine: { getAvailableResourceCount(p: string): number }, p: string): number =>
  engine.getAvailableResourceCount(p);

// ============================================================================
// Catastrophic Caper
// ============================================================================

// A responded-to tactic that picks a character, a tactic that picks a faction, a tactic that picks nothing,
// and a character whose ability picks a character.
const grabber = (pickType: "character" | "faction" | "none") =>
  tactic({
    name: `Grab-${pickType}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grab",
          type: "activated",
          targets:
            pickType === "none"
              ? []
              : [{ id: "pick", selector: { zone: "play", type: pickType }, count: 1 }],
          effects: [{ type: "gainInfluence", player: "controller", amount: 0 }]
        }
      ]
    }
  } as never);

const poker = character({
  name: "Poker",
  cost: 0,
  behavior: {
    abilities: [
      {
        id: "poke",
        type: "activated",
        targets: [{ id: "pick", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "gainInfluence", player: "controller", amount: 0 }]
      }
    ]
  }
} as never);

type VictimKind = "plain" | "pluck" | "chumUnique" | "uniqueOther";
const victimDef = (kind: VictimKind) =>
  kind === "plain"
    ? character({ name: "Victim", cost: 1 })
    : character({ name: "Victim", cost: 1, unique: kind === "pluck" ? "pluck" : kind === "chumUnique" ? "chum" : "other" } as never);

function caperBoard(
  o: {
    pick?: "character" | "faction" | "none";
    victim?: VictimKind;
    bankD?: number;
    caper?: "hand" | "faceDown";
    viaAbility?: boolean;
    victimOwner?: string;
    victimController?: string;
  } = {}
) {
  const cards = [
    { key: "grab", def: grabber(o.pick ?? "character"), owner: P1, zone: "hand" as const },
    { key: "poker", def: poker, owner: P1, zone: "play" as const },
    {
      key: "victim",
      def: victimDef(o.victim ?? "plain"),
      owner: o.victimOwner ?? P1,
      controller: o.victimController ?? o.victimOwner ?? P1,
      zone: "play" as const
    },
    o.caper === "faceDown"
      ? { key: "caper", def: printing(CAPER), owner: P2, zone: "play" as const, faceDown: true }
      : { key: "caper", def: printing(CAPER), owner: P2, zone: "hand" as const },
    ...bank("deception", o.bankD ?? 3, P2),
    { key: "p1d", def: character({ name: "P1Deck", cost: 1 }), owner: P1, zone: "deck" as const },
    { key: "p2d", def: character({ name: "P2Deck", cost: 1 }), owner: P2, zone: "deck" as const },
    { key: "p2e", def: character({ name: "P2Deck2", cost: 1 }), owner: P2, zone: "deck" as const }
  ];
  const g = buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, cards: cards as never });
  return g;
}
type CaperGame = ReturnType<typeof caperBoard>;

/** P1 puts a card or ability on the stack; P2 (holding priority in the window) may respond. */
function p1Picks(g: CaperGame, what: "tactic" | "ability", target: string | undefined): void {
  const selected = target ? { pick: [g.id(target)] } : {};
  if (what === "tactic") {
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("grab"), selected } as never);
  } else {
    g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("poker"), abilityId: "poke", selected, variables: {} } as never);
  }
}
const p2Caper = (g: CaperGame): void => {
  g.engine.perform({ type: "playCard", playerId: P2, cardId: g.id("caper"), selected: {} } as never);
};
const p2Flip = (g: CaperGame): void => {
  flipUpNow(g.engine, { type: "flipUp", playerId: P2, cardId: g.id("caper"), selected: {}, variables: {} });
};
const hand = (g: CaperGame, p: string): string[] => [...g.engine.state.players[p].hand];

clause(CAPER, "0:extraCost", "deployable in response to a tactic that picked a character, and the response resolves", () => {
  const g = caperBoard();
  p1Picks(g, "tactic", "victim");
  p2Caper(g);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("caper")), "discard", "the tactic resolved and was used up");
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
});

clause(CAPER, "0:extraCost", "deployable in response to an ability that picked a character", () => {
  const g = caperBoard();
  p1Picks(g, "ability", "victim");
  p2Caper(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
  assert.equal(zoneOf(g.engine, g.id("caper")), "discard");
});

clause(CAPER, "0:extraCost", "refused when there is nothing on the stack to respond to", () => {
  const g = caperBoard();
  refused(() => p2Caper(g), "no card or ability to respond to");
  assert.equal(zoneOf(g.engine, g.id("caper")), "hand");
  assert.equal(ready(g.engine, P2), 3, "nothing was paid");
  // control: the same hand card works once a character-picking card is on the stack
  p1Picks(g, "tactic", "victim");
  p2Caper(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
});

clause(CAPER, "0:extraCost", "refused in response to a card that picked something other than a character, or nothing at all", () => {
  for (const pick of ["faction", "none"] as const) {
    const g = caperBoard({ pick });
    const target = pick === "faction" ? undefined : undefined;
    if (pick === "faction") {
      g.engine.perform({
        type: "playCard",
        playerId: P1,
        cardId: g.id("grab"),
        selected: { pick: [g.engine.state.players[P2].factionId!] }
      } as never);
    } else {
      p1Picks(g, "tactic", target);
    }
    refused(() => p2Caper(g), `the responded-to card picked ${pick}, not a character`);
    assert.equal(zoneOf(g.engine, g.id("caper")), "hand");
    assert.equal(zoneOf(g.engine, g.id("victim")), "play");
  }
});

clause(CAPER, "0:extraCost", "deployable in response to a card that picked an opponent's character as well as my own", () => {
  const g = caperBoard({ victimOwner: P2 });
  p1Picks(g, "tactic", "victim");
  p2Caper(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
  assert.ok(hand(g, P2).includes(g.id("victim")), "hand(g, P2).includes(g.id(\"victim\"))");
});

clause(CAPER, "0:extraCost", "costs its printed 3 [D]: refused one resource short or without a [D]", () => {
  const short = caperBoard({ bankD: 2 });
  p1Picks(short, "tactic", "victim");
  refused(() => p2Caper(short), "2 resources for cost 3");
  assert.equal(zoneOf(short.engine, short.id("caper")), "hand");
  const ok = caperBoard({ bankD: 3 });
  p1Picks(ok, "tactic", "victim");
  p2Caper(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(ready(ok.engine, P2), 0, "3 paid");
  assert.equal(zoneOf(ok.engine, ok.id("victim")), "hand");
});

clause(CAPER, "1:rule", "puts the picked character into its owner's hand", () => {
  const g = caperBoard({ victim: "plain" });
  const before = hand(g, P1).length;
  p1Picks(g, "tactic", "victim");
  p2Caper(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
  assert.deepEqual(hand(g, P1).filter(c => c === g.id("victim")), [g.id("victim")]);
  assert.equal(hand(g, P1).length, before, "the Grabber left the hand, the victim joined it");
  assert.equal(zoneOf(g.engine, g.id("poker")), "play", "other characters stay");
});

clause(CAPER, "1:rule", "goes to its OWNER's hand even when the opponent controls it", () => {
  const g = caperBoard({ victimOwner: P1, victimController: P2 });
  p1Picks(g, "tactic", "victim");
  p2Caper(g);
  resolvePendingResponses(g.engine);
  assert.ok(hand(g, P1).includes(g.id("victim")), "owner P1");
  assert.ok(!hand(g, P2).includes(g.id("victim")), "!hand(g, P2).includes(g.id(\"victim\"))");
});

clause(CAPER, "1:rule", "a UNIQUE PLUCK bounced this way draws its deployer a card (the top of their deck)", () => {
  const g = caperBoard({ victim: "pluck" });
  const handBefore = hand(g, P2).length;
  const top = g.engine.state.players[P2].deck[0];
  p1Picks(g, "tactic", "victim");
  p2Caper(g);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
  assert.equal(hand(g, P2).length, handBefore - 1 + 1, "Caper left the hand, one card drawn");
  assert.ok(hand(g, P2).includes(top), "the drawn card is the deck's top card");
  assert.equal(g.engine.state.players[P2].deck.length, 1);
});

clause(CAPER, "1:rule", "the draw goes to Caper's controller, not the bounced character's owner", () => {
  const g = caperBoard({ victim: "pluck", victimOwner: P1 });
  const p1Hand = hand(g, P1).length;
  const p1Deck = g.engine.state.players[P1].deck.length;
  p1Picks(g, "tactic", "victim");
  p2Caper(g);
  resolvePendingResponses(g.engine);
  assert.equal(hand(g, P1).length, p1Hand, "only the bounced character joins P1's hand (the Grabber left it)");
  assert.equal(g.engine.state.players[P1].deck.length, p1Deck, "P1 drew nothing");
  assert.equal(g.engine.state.players[P2].deck.length, 1, "P2, Caper's controller, drew");
});

clause(CAPER, "1:rule", "a non-pluck draws nothing: plain character, UNIQUE of another designation", () => {
  for (const victim of ["plain", "chumUnique", "uniqueOther"] as const) {
    const g = caperBoard({ victim });
    const deckBefore = g.engine.state.players[P2].deck.length;
    p1Picks(g, "tactic", "victim");
    p2Caper(g);
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("victim")), "hand", victim);
    assert.equal(g.engine.state.players[P2].deck.length, deckBefore, `${victim}: no draw`);
  }
});

clause(CAPER, "1:rule", "also works when the picking source is an ability and the character is a UNIQUE PLUCK", () => {
  const g = caperBoard({ victim: "pluck" });
  const deckBefore = g.engine.state.players[P2].deck.length;
  p1Picks(g, "ability", "victim");
  p2Caper(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
  assert.equal(g.engine.state.players[P2].deck.length, deckBefore - 1);
});

clause(CAPER, "1:rule", "'if you do': a UNIQUE PLUCK that has already left play is not bounced and no card is drawn", () => {
  const g = caperBoard({ victim: "pluck" });
  const deckBefore = g.engine.state.players[P2].deck.length;
  p1Picks(g, "tactic", "victim");
  p2Caper(g);
  // the picked character leaves play before Caper resolves
  (g.engine.state.cards[g.id("victim")] as { zone: string }).zone = "discard";
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("victim")), "discard", "not bounced");
  assert.equal(g.engine.state.players[P2].deck.length, deckBefore, "no draw because nothing was put into a hand");
});

clause(CAPER, "2:flipUp", "a face-down Caper flips up for 1 [D] in response to a character pick, bounces it and ends in the discard pile", () => {
  const g = caperBoard({ caper: "faceDown", bankD: 1 });
  assert.equal(ready(g.engine, P2), 2, "setup: face-down Caper + one Deception");
  p1Picks(g, "tactic", "victim");
  p2Flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
  assert.equal(zoneOf(g.engine, g.id("caper")), "discard");
  assert.equal(ready(g.engine, P2), 0 + 0 * 1, "1 paid by FLIP UP (and the Caper itself left the pool)");
});

clause(CAPER, "2:flipUp", "pays 1, not the normal cost of 3: a spare resource stays ready", () => {
  const g = caperBoard({ caper: "faceDown", bankD: 3 });
  p1Picks(g, "tactic", "victim");
  p2Flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand");
  assert.equal(ready(g.engine, P2), 2, "4 ready before; 1 paid, Caper left the pool");
});

clause(CAPER, "2:flipUp", "refused without a [D]", () => {
  const g = caperBoard({ caper: "faceDown", bankD: 0 });
  // two non-Deception resources
  const g2 = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "grab", def: grabber("character"), owner: P1, zone: "hand" },
      { key: "victim", def: character({ name: "V", cost: 1 }), owner: P1, zone: "play" },
      { key: "caper", def: printing(CAPER), owner: P2, zone: "play", faceDown: true },
      ...bank("rage", 3, P2)
    ] as never
  });
  g2.engine.perform({ type: "playCard", playerId: P1, cardId: g2.id("grab"), selected: { pick: [g2.id("victim")] } } as never);
  refused(() => flipUpNow(g2.engine, { type: "flipUp", playerId: P2, cardId: g2.id("caper"), selected: {}, variables: {} }), "no [D] among four resources");
  assert.equal(g2.engine.state.cards[g2.id("caper")].faceDown, true);
  assert.equal(ready(g2.engine, P2), 4);
  void g;
});

clause(CAPER, "2:flipUp", "FLIP UP keeps the extra cost: refused when nothing on the stack picked a character", () => {
  const g = caperBoard({ caper: "faceDown", bankD: 1 });
  refused(() => p2Flip(g), "nothing to respond to");
  assert.equal(g.engine.state.cards[g.id("caper")].faceDown, true);
  assert.equal(ready(g.engine, P2), 2, "nothing paid");
  const f = caperBoard({ caper: "faceDown", bankD: 1, pick: "faction" });
  f.engine.perform({
    type: "playCard",
    playerId: P1,
    cardId: f.id("grab"),
    selected: { pick: [f.engine.state.players[P2].factionId!] }
  } as never);
  refused(() => p2Flip(f), "the responded-to card picked a faction");
  assert.equal(f.engine.state.cards[f.id("caper")].faceDown, true);
});

clause(CAPER, "2:flipUp", "only its controller can flip it, and only while face-down in play", () => {
  const g = caperBoard({ caper: "faceDown", bankD: 1 });
  p1Picks(g, "tactic", "victim");
  refused(
    () => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("caper"), selected: {}, variables: {} }),
    "P1 does not control the Caper"
  );
  const h = caperBoard({ caper: "hand", bankD: 3 });
  p1Picks(h, "tactic", "victim");
  refused(() => p2Flip(h), "in the hand it is not a face-down resource");
  assert.equal(zoneOf(h.engine, h.id("caper")), "hand");
});

// ============================================================================
// Cheats, the Dirty Rotten
// ============================================================================

const named = (name: string, over: Record<string, unknown> = {}) => character({ name, cost: 1, threshold: "rr", ...over } as never);

const CHAR_DECK: Array<[string, unknown]> = [
  ["a1", named("Alpha")],
  ["a2", named("Alpha")],
  ["b", named("Bravo")],
  ["c", named("Charlie")],
  ["d", named("Delta")],
  ["e", named("Echo")],
  ["r1", resourceCard({ name: "Res1" } as never)],
  ["r2", resourceCard({ name: "Res2" } as never)]
];

type CheatsOpts = { bankD?: number; random?: () => number; oppDeck?: Array<[string, unknown]>; p1Bank?: boolean };
function cheatsBoard(o: CheatsOpts = {}) {
  const oppDeck: Array<[string, unknown]> =
    o.oppDeck ?? [
      ["a1", named("Alpha")],
      ["a2", named("Alpha")],
      ["b", named("Bravo")],
      ["c", tactic({ name: "Charlie", cost: 1, threshold: "rr" } as never)],
      ["d", named("Delta")],
      ["e", named("Echo")],
      ["r1", resourceCard({ name: "Res1" } as never)],
      ["r2", resourceCard({ name: "Res2" } as never)]
    ];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: o.random,
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" },
      ...bank("deception", o.bankD ?? 5, P1),
      { key: "mine1", def: named("MineOne"), owner: P1, zone: "deck" },
      { key: "mine2", def: named("MineTwo"), owner: P1, zone: "deck" },
      ...oppDeck.map(([key, def]) => ({ key, def, owner: P2, zone: "deck" as const }))
    ] as never
  });
}
type CheatsGame = ReturnType<typeof cheatsBoard>;
const facOf = (g: { engine: { state: { players: Record<string, { factionId?: string }> } } }, p: string): string => g.engine.state.players[p].factionId!;
const castCheats = (g: CheatsGame, opp: string | null = facOf(g, P2)): void => {
  g.engine.perform({
    type: "playCard",
    playerId: P1,
    cardId: g.id("cheats"),
    selected: opp ? { opp: [opp] } : {}
  } as never);
  resolvePendingResponses(g.engine);
};
const searchPick = (g: CheatsGame, keys: string[]): void => {
  answer(g.engine, P1, { kind: "chooserSelectsTarget", selected: keys.map(k => g.id(k)) } as never);
  resolvePendingResponses(g.engine);
};
const zones = (g: CheatsGame, keys: string[]): string[] => keys.map(k => zoneOf(g.engine, g.id(k)));

clause(CHEATS, "0:unique", "deploying Cheats while I control another UNIQUE PLUCK asks me which one to keep (candidates: both)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" },
      { key: "old", def: character({ name: "Other Pluck", cost: 1, unique: "pluck" } as never), owner: P1, zone: "play" },
      ...bank("deception", 5, P1)
    ] as never
  });
  castCheats(g);
  const seen = pending(g.engine);
  assert.equal(seen?.kind, "uniqueSurvivor");
  assert.equal(seen?.playerId, P1);
  assert.deepEqual([...(seen?.candidates as string[])].sort(), [g.id("cheats"), g.id("old")].sort());
});

clause(CHEATS, "0:unique", "controlling a second UNIQUE PLUCK makes its controller keep one; keeping the new Cheats destroys the old pluck", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" },
      { key: "old", def: character({ name: "Other Pluck", cost: 1, unique: "pluck" } as never), owner: P1, zone: "play" },
      ...bank("deception", 5, P1)
    ] as never
  });
  castCheats(g);
  const seen = pending(g.engine);
  assert.equal(seen?.kind, "uniqueSurvivor");
  assert.equal(seen?.playerId, P1, "the controller chooses");
  assert.deepEqual([...(seen?.candidates as string[])].sort(), [g.id("cheats"), g.id("old")].sort());
  drain(g.engine, p => (p.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: g.id("cheats") } : declineAll(p as never)) as never);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("cheats")), "play");
  assert.equal(zoneOf(g.engine, g.id("old")), "discard");
});

clause(CHEATS, "0:unique", "keeping the old pluck destroys Cheats", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" },
      { key: "old", def: character({ name: "Other Pluck", cost: 1, unique: "pluck" } as never), owner: P1, zone: "play" },
      ...bank("deception", 5, P1)
    ] as never
  });
  castCheats(g);
  drain(g.engine, p => (p.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: g.id("old") } : declineAll(p as never)) as never);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("old")), "play");
  assert.equal(zoneOf(g.engine, g.id("cheats")), "discard");
});

clause(CHEATS, "0:unique", "the restriction is per player and per designation: an opponent's pluck and my own CHUM are not duplicates", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Their Pluck", cost: 1, unique: "pluck" } as never), owner: P2, zone: "play" },
      { key: "chum", def: printing(CHUM), owner: P1, zone: "play" },
      ...bank("deception", 5, P1)
    ] as never
  });
  castCheats(g);
  assert.notEqual(pending(g.engine)?.kind, "uniqueSurvivor");
  assert.equal(zoneOf(g.engine, g.id("cheats")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(zoneOf(g.engine, g.id("chum")), "play");
});

clause(CHEATS, "1:extraCost", "deploys for its printed 4 [D][D][D][D] with the opponent picked; 1/4/3 stats; refused one resource short or with fewer than four [D]", () => {
  const g = cheatsBoard({ bankD: 4 });
  castCheats(g);
  searchPick(g, ["a1", "b", "c", "d"]);
  assert.equal(zoneOf(g.engine, g.id("cheats")), "play");
  assert.equal(ready(g.engine, P1), 0, "4 paid");
  assert.equal(g.engine.getStat(g.id("cheats"), "strength"), 1);
  assert.equal(g.engine.getStat(g.id("cheats"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("cheats"), "life"), 3);
  const short = cheatsBoard({ bankD: 3 });
  refused(() => castCheats(short), "3 resources for cost 4");
  assert.equal(zoneOf(short.engine, short.id("cheats")), "hand");
  const noD = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" }, ...bank("deception", 3, P1), ...bank("rage", 2, P1)] as never
  });
  refused(
    () => noD.engine.perform({ type: "playCard", playerId: P1, cardId: noD.id("cheats"), selected: { opp: [noD.engine.state.players[P2].factionId!] } } as never),
    "only three [D] of the four required"
  );
  assert.equal(zoneOf(noD.engine, noD.id("cheats")), "hand");
});

clause(CHEATS, "1:extraCost", "an opponent must be picked: refused with no pick at all", () => {
  const g = cheatsBoard();
  refused(() => castCheats(g, null), "no opponent picked", /Target 'opp' requires/);
  assert.equal(zoneOf(g.engine, g.id("cheats")), "hand");
  assert.equal(ready(g.engine, P1), 5, "nothing was paid");
});

clause(CHEATS, "1:extraCost", "the pick must be an opponent: my own faction and a non-faction card are refused, the opponent's faction works", () => {
  const g = cheatsBoard();
  refused(() => castCheats(g, facOf(g, P1)), "my own faction is not an opponent");
  assert.equal(zoneOf(g.engine, g.id("cheats")), "hand");
  refused(() => castCheats(g, g.id("a1")), "a deck card is not an opponent");
  assert.equal(zoneOf(g.engine, g.id("cheats")), "hand");
  assert.equal(ready(g.engine, P1), 5, "nothing was paid");
  castCheats(g); // control
  assert.equal(zoneOf(g.engine, g.id("cheats")), "play");
});

clause(CHEATS, "2:rule", "the deployer searches the opponent's deck: resources, duplicate names, my own deck and a wrong count are refused; any four different non-resource cards are accepted", () => {
  const g = castBoardForSearch();
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget");
  assert.equal(pc?.playerId, P1, "the deployer searches");
  refused(() => searchPick(g, ["a1", "a2", "b", "c"]), "two cards named Alpha");
  refused(() => searchPick(g, ["a1", "b", "c", "r1"]), "a resource");
  refused(() => searchPick(g, ["a1", "b", "c", "mine1"]), "my own deck");
  refused(() => searchPick(g, ["a1", "b", "c", "d", "e"]), "five picked");
  assert.deepEqual(zones(g, ["a1", "b", "c", "r1", "mine1"]), ["deck", "deck", "deck", "deck", "deck"]);
  // CR 312.2: a search with specific criteria may be failed, so finding fewer than four is legal (this used to be asserted as refused).
  const fewer = castBoardForSearch();
  searchPick(fewer, ["a1", "b", "c"]);
  assert.equal(pending(fewer.engine), undefined, "three of four found: the search is accepted");
  assert.equal(zones(fewer, ["a1", "b", "c"]).filter((z) => z === "deck").length, 0, "the three found cards left the deck");
  searchPick(g, ["a2", "c", "d", "e"]); // control: second Alpha, the tactic, Delta and Echo
  assert.equal(pending(g.engine), undefined);
  assert.equal(zones(g, ["a2", "c", "d", "e"]).filter(z => z === "deck").length, 0, "all four left the deck");
});

function castBoardForSearch(opts: CheatsOpts = {}): CheatsGame {
  const g = cheatsBoard(opts);
  castCheats(g);
  return g;
}

clause(CHEATS, "2:rule", "the four found cards are revealed and every one goes to the void; two random of them then go to the opponent's discard pile", () => {
  const g = castBoardForSearch({ random: () => 0 });
  const revealsBefore = g.engine.state.turnEventTally["cardsRevealed"] ?? 0;
  searchPick(g, ["a1", "b", "c", "d"]);
  assert.ok((g.engine.state.turnEventTally["cardsRevealed"] ?? 0) > revealsBefore, "the found cards were revealed");
  const z = zones(g, ["a1", "b", "c", "d"]);
  assert.equal(z.filter(x => x === "discard").length, 2, `two discarded: ${z}`);
  assert.equal(z.filter(x => x === "void").length, 2, `two stay in the void: ${z}`);
  assert.deepEqual(zones(g, ["a2", "e", "r1", "r2"]), ["deck", "deck", "deck", "deck"], "unfound cards stay in the deck");
  for (const k of ["a1", "b", "c", "d"]) {
    if (zoneOf(g.engine, g.id(k)) === "discard") assert.ok(g.engine.state.players[P2].discard.includes(g.id(k)), "their discard pile");
  }
  assert.equal(g.engine.state.players[P1].discard.length, 0, "nothing in my discard");
});

clause(CHEATS, "2:rule", "the two discarded are chosen at random: different random sources discard different pairs", () => {
  const outcomes = new Set<string>();
  for (const r of [() => 0, () => 0.99, () => 0.5, () => 0.3]) {
    const g = castBoardForSearch({ random: r });
    searchPick(g, ["a1", "b", "c", "d"]);
    outcomes.add(["a1", "b", "c", "d"].filter(k => zoneOf(g.engine, g.id(k)) === "discard").join("+"));
  }
  assert.ok(outcomes.size >= 2, `the discarded pair depends on the random source: ${[...outcomes]}`);
});

clause(CHEATS, "2:rule", "the opponent's discard pile receives exactly the two chosen cards, nothing from the unsearched deck", () => {
  const g = castBoardForSearch({ random: () => 0.5 });
  searchPick(g, ["a1", "b", "c", "d"]);
  assert.equal(g.engine.state.players[P2].discard.length, 2);
  assert.equal(g.engine.state.players[P2].deck.length, 8 - 4);
});

clause(CHEATS, "2:rule", "the opponent's deck is shuffled by the search (the unfound cards are no longer in their original order)", () => {
  const original = ["a2", "e", "r1", "r2"];
  let changed = false;
  for (const r of [() => 0, () => 0.99, () => 0.5, () => 0.123]) {
    const g = castBoardForSearch({ random: r });
    searchPick(g, ["a1", "b", "c", "d"]);
    const order = g.engine.state.players[P2].deck;
    if (order.join() !== original.map(k => g.id(k)).join()) changed = true;
  }
  assert.ok(changed, "at least one seed reorders the deck");
});

clause(CHEATS, "2:rule", "the voided cards can be deployed by me, even one that neither my resources nor threshold can pay: I take control", () => {
  const g = castBoardForSearch({ bankD: 5, oppDeck: CHAR_DECK, random: () => 0 });
  searchPick(g, ["a1", "b", "c", "d"]);
  const voided = ["a1", "b", "c", "d"].filter(k => zoneOf(g.engine, g.id(k)) === "void");
  assert.equal(voided.length, 2);
  const card = voided[0];
  assert.equal(ready(g.engine, P1), 1);
  play(g.engine, P1, g.id(card));
  drain(g.engine, pc => declineAll(pc as never) as never);
  assert.equal(zoneOf(g.engine, g.id(card)), "play", "deployed from the void with only [D] icons against a [R][R] threshold");
  assert.equal(g.engine.state.cards[g.id(card)].controllerId, P1, "I control it");
  assert.equal(ready(g.engine, P1), 0, "its cost of 1 was still paid");
});

clause(CHEATS, "2:rule", "the void cards still cost their numeric cost (refused when no resource is left) and the discarded ones cannot be deployed", () => {
  const g = castBoardForSearch({ bankD: 4, oppDeck: CHAR_DECK, random: () => 0 });
  searchPick(g, ["a1", "b", "c", "d"]);
  const voided = ["a1", "b", "c", "d"].filter(k => zoneOf(g.engine, g.id(k)) === "void");
  const gone = ["a1", "b", "c", "d"].filter(k => zoneOf(g.engine, g.id(k)) === "discard");
  assert.equal(ready(g.engine, P1), 0);
  refused(() => play(g.engine, P1, g.id(voided[0])), "no resources for cost 1");
  assert.equal(zoneOf(g.engine, g.id(voided[0])), "void");
  const g2 = castBoardForSearch({ bankD: 5, oppDeck: CHAR_DECK, random: () => 0 });
  searchPick(g2, ["a1", "b", "c", "d"]);
  const gone2 = ["a1", "b", "c", "d"].filter(k => zoneOf(g2.engine, g2.id(k)) === "discard");
  refused(() => play(g2.engine, P1, g2.id(gone2[0])), "it is in the discard pile");
  assert.equal(zoneOf(g2.engine, g2.id(gone2[0])), "discard");
  void gone;
});

clause(CHEATS, "2:rule", "cards not found (still in the opponent's deck) get no void permission", () => {
  const g = castBoardForSearch({ bankD: 5, oppDeck: CHAR_DECK, random: () => 0 });
  searchPick(g, ["a1", "b", "c", "d"]);
  refused(() => play(g.engine, P1, g.id("e")), "Echo is still in their deck");
  assert.equal(zoneOf(g.engine, g.id("e")), "deck");
});

clause(CHEATS, "2:rule", "only I get the permission: the opponent cannot deploy the voided cards", () => {
  const g = castBoardForSearch({ bankD: 5, oppDeck: CHAR_DECK, random: () => 0 });
  searchPick(g, ["a1", "b", "c", "d"]);
  const voided = ["a1", "b", "c", "d"].filter(k => zoneOf(g.engine, g.id(k)) === "void")[0];
  g.engine.state.activePlayerId = P2;
  refused(() => play(g.engine, P2, g.id(voided)), "the permission belongs to Cheats' controller");
  assert.equal(zoneOf(g.engine, g.id(voided)), "void");
});

clause(CHEATS, "2:rule", "for the rest of the game: still deployable on a later turn and after Cheats has left play", () => {
  const g = castBoardForSearch({ bankD: 5, oppDeck: CHAR_DECK, random: () => 0 });
  searchPick(g, ["a1", "b", "c", "d"]);
  const voided = ["a1", "b", "c", "d"].filter(k => zoneOf(g.engine, g.id(k)) === "void");
  (g.engine.state.cards[g.id("cheats")] as { zone: string }).zone = "discard";
  g.engine.state.turn += 2;
  play(g.engine, P1, g.id(voided[1]));
  drain(g.engine, pc => declineAll(pc as never) as never);
  assert.equal(zoneOf(g.engine, g.id(voided[1])), "play");
});

clause(CHEATS, "2:rule", "finding fewer than 4 (only 3 different non-resource names in their deck) still works and voids/discards what was found", () => {
  const g = castBoardForSearch({
    oppDeck: [
      ["a1", named("Alpha")],
      ["a2", named("Alpha")],
      ["b", named("Bravo")],
      ["c", named("Charlie")],
      ["r1", resourceCard({ name: "Res1" } as never)]
    ],
    random: () => 0
  });
  searchPick(g, ["a1", "b", "c"]);
  assert.equal(pending(g.engine), undefined);
  const z = zones(g, ["a1", "b", "c"]);
  assert.equal(z.filter(x => x === "discard").length, 2);
  assert.equal(z.filter(x => x === "void").length, 1);
});

clause(CHEATS, "2:rule", "the ETB fires only for Cheats itself: another card entering play does not search", () => {
  const g = cheatsBoard();
  castCheats(g);
  searchPick(g, ["a1", "b", "c", "d"]);
  const other = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "play" },
      { key: "vanilla", def: character({ name: "Vanilla", cost: 0 }), owner: P1, zone: "hand" },
      { key: "x", def: named("X"), owner: P2, zone: "deck" }
    ] as never
  });
  play(other.engine, P1, other.id("vanilla"));
  assert.equal(pending(other.engine), undefined, "no search for a different card entering");
  assert.equal(zoneOf(other.engine, other.id("x")), "deck");
});

// ============================================================================
// Chum, the Ugliest Sarume
// ============================================================================

type ChumOpts = { bankD?: number; active?: string; chumZone?: "hand" | "play" };
function chumBoard(o: ChumOpts = {}) {
  const oppDeck: Array<[string, number]> = [["o0", 0], ["o1", 1], ["o2", 2], ["o3", 3], ["o4", 4], ["o5", 5]];
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: o.active ?? P1,
    turn: (o.active ?? P1) === P1 ? 1 : 2,
    cards: [
      { key: "chum", def: printing(CHUM), owner: P1, zone: o.chumZone ?? "hand" },
      ...bank("deception", o.bankD ?? 4, P1),
      { key: "food3", def: character({ name: "Food3", cost: 3 }), owner: P1, zone: "discard" },
      { key: "food1", def: tactic({ name: "Food1", cost: 1 } as never), owner: P1, zone: "discard" },
      { key: "theirs2", def: character({ name: "Theirs2", cost: 2 }), owner: P2, zone: "discard" },
      { key: "inHand", def: character({ name: "InHand", cost: 3 }), owner: P1, zone: "hand" },
      { key: "inPlay", def: character({ name: "InPlay", cost: 3 }), owner: P1, zone: "play" },
      ...oppDeck.map(([k, cost]) => ({ key: k, def: character({ name: `Opp${cost}`, cost }), owner: P2, zone: "deck" as const })),
      { key: "mine3", def: character({ name: "Mine3", cost: 0 }), owner: P1, zone: "deck" }
    ] as never
  });
}
type ChumGame = ReturnType<typeof chumBoard>;
const castChum = (g: ChumGame, pick: string | undefined): void => {
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("chum"), selected: pick ? { pick: [g.id(pick)] } : {} } as never);
  resolvePendingResponses(g.engine);
};
const chumSearch = (g: ChumGame, key: string | undefined): void => {
  answer(g.engine, P1, { kind: "chooserSelectsTarget", selected: key ? [g.id(key)] : [] } as never);
  resolvePendingResponses(g.engine);
};

clause(CHUM, "0:unique", "deploying a second CHUM asks me which one to keep (candidates: both)", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "new", def: printing(CHUM), owner: P1, zone: "hand" },
      { key: "old", def: printing(CHUM), owner: P1, zone: "play" },
      ...bank("deception", 4, P1),
      { key: "food", def: character({ name: "Food", cost: 0 }), owner: P1, zone: "discard" }
    ] as never
  });
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("new"), selected: { pick: [g.id("food")] } } as never);
  resolvePendingResponses(g.engine);
  const seen = pending(g.engine);
  assert.equal(seen?.kind, "uniqueSurvivor");
  assert.equal(seen?.playerId, P1);
  assert.deepEqual([...(seen?.candidates as string[])].sort(), [g.id("new"), g.id("old")].sort());
});

clause(CHUM, "0:unique", "controlling a second CHUM makes its controller keep one", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "new", def: printing(CHUM), owner: P1, zone: "hand" },
      { key: "old", def: printing(CHUM), owner: P1, zone: "play" },
      ...bank("deception", 4, P1),
      { key: "food", def: character({ name: "Food", cost: 0 }), owner: P1, zone: "discard" }
    ] as never
  });
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("new"), selected: { pick: [g.id("food")] } } as never);
  resolvePendingResponses(g.engine);
  const seen = pending(g.engine);
  assert.equal(seen?.kind, "uniqueSurvivor");
  assert.equal(seen?.playerId, P1);
  assert.deepEqual([...(seen?.candidates as string[])].sort(), [g.id("new"), g.id("old")].sort());
  drain(g.engine, p => (p.kind === "uniqueSurvivor" ? { kind: "uniqueSurvivor", keep: g.id("new") } : declineAll(p as never)) as never);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("new")), "play");
  assert.equal(zoneOf(g.engine, g.id("old")), "discard");
});

clause(CHUM, "0:unique", "an opponent's Chum is not a duplicate, and a UNIQUE PLUCK is not a duplicate of CHUM", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "new", def: printing(CHUM), owner: P1, zone: "hand" },
      { key: "theirs", def: printing(CHUM), owner: P2, zone: "play" },
      { key: "pluck", def: character({ name: "P", cost: 0, unique: "pluck" } as never), owner: P1, zone: "play" },
      ...bank("deception", 4, P1),
      { key: "food", def: character({ name: "Food", cost: 0 }), owner: P1, zone: "discard" }
    ] as never
  });
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("new"), selected: { pick: [g.id("food")] } } as never);
  resolvePendingResponses(g.engine);
  assert.notEqual(pending(g.engine)?.kind, "uniqueSurvivor");
  assert.equal(zoneOf(g.engine, g.id("new")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play");
  assert.equal(zoneOf(g.engine, g.id("pluck")), "play");
});

clause(CHUM, "0:kw:TACTICAL", "has TACTICAL and may be deployed in the opponent's response window but not outside one on their turn", () => {
  const g = chumBoard({ active: P2 });
  assert.ok(g.engine.getKeywords(g.id("chum")).includes("tactical" as never), "g.engine.getKeywords(g.id(\"chum\")).includes(\"tactical\" as never)");
  g.engine.state.cards[g.id("o0")]; // keep key referenced
  refused(() => castChum(g, "food3"), "opponent's turn, nothing to respond to");
  assert.equal(zoneOf(g.engine, g.id("chum")), "hand");
  assert.equal(zoneOf(g.engine, g.id("food3")), "discard");
});

clause(CHUM, "0:kw:TACTICAL", "…and is deployable in response to the opponent's attack", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    turn: 2,
    cards: [
      { key: "chum", def: printing(CHUM), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: 1, strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...bank("deception", 4, P1),
      { key: "food", def: character({ name: "Food", cost: 0 }), owner: P1, zone: "discard" }
    ] as never
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("chum"), selected: { pick: [g.id("food")] } } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("chum")), "play");
  assert.equal(zoneOf(g.engine, g.id("food")), "removed");
});

clause(CHUM, "1:extraCost", "a discard-pile card must be picked: refused with no pick, a hand card, a card in play, or a deck card; either player's discard works", () => {
  const g = chumBoard();
  refused(() => castChum(g, undefined), "no pick");
  refused(() => castChum(g, "inHand"), "a hand card");
  refused(() => castChum(g, "inPlay"), "a card in play");
  refused(() => castChum(g, "o1"), "a deck card");
  assert.equal(zoneOf(g.engine, g.id("chum")), "hand");
  assert.equal(ready(g.engine, P1), 4, "nothing paid");
  for (const pick of ["food3", "theirs2"]) {
    const h = chumBoard();
    castChum(h, pick);
    assert.equal(zoneOf(h.engine, h.id("chum")), "play", pick);
  }
});

clause(CHUM, "1:extraCost", "deploys for its printed 2 [D][D] with printed 2/3/2 stats; refused one resource short or without [D][D]", () => {
  const ok = chumBoard({ bankD: 2 });
  castChum(ok, "food3");
  chumSearch(ok, undefined);
  assert.equal(zoneOf(ok.engine, ok.id("chum")), "play");
  assert.equal(ready(ok.engine, P1), 0, "2 paid");
  assert.equal(ok.engine.getStat(ok.id("chum"), "strength"), 2);
  assert.equal(ok.engine.getStat(ok.id("chum"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("chum"), "life"), 2);
  const short = chumBoard({ bankD: 1 });
  refused(() => castChum(short, "food3"), "one resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("chum")), "hand");
  const noD = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "chum", def: printing(CHUM), owner: P1, zone: "hand" },
      { key: "food", def: character({ name: "Food", cost: 0 }), owner: P1, zone: "discard" },
      ...bank("deception", 1, P1),
      ...bank("rage", 3, P1)
    ] as never
  });
  refused(
    () => noD.engine.perform({ type: "playCard", playerId: P1, cardId: noD.id("chum"), selected: { pick: [noD.id("food")] } } as never),
    "only one [D] of the two required"
  );
  assert.equal(zoneOf(noD.engine, noD.id("chum")), "hand");
});

clause(CHUM, "2:rule", "the picked card is removed from the game (either player's, any card type)", () => {
  for (const pick of ["food3", "food1", "theirs2"]) {
    const g = chumBoard();
    castChum(g, pick);
    assert.equal(zoneOf(g.engine, g.id(pick)), "removed", pick);
    assert.ok(!g.engine.state.players[P1].discard.includes(g.id(pick)), "!g.engine.state.players[P1].discard.includes(g.id(pick))");
    assert.ok(!g.engine.state.players[P2].discard.includes(g.id(pick)), "!g.engine.state.players[P2].discard.includes(g.id(pick))");
  }
});

clause(CHUM, "2:rule", "X is the removed card's numeric cost: only the opponent's deck cards with cost X or less can be found (X = 3 and X = 1)", () => {
  for (const [pick, x] of [["food3", 3], ["food1", 1]] as const) {
    for (let c = 0; c <= 5; c++) {
      const g = chumBoard();
      castChum(g, pick);
      const pc = pending(g.engine);
      assert.equal(pc?.kind, "chooserSelectsTarget");
      assert.equal(pc?.playerId, P1, "the deployer searches");
      let found = true;
      try {
        chumSearch(g, `o${c}`);
      } catch {
        found = false;
      }
      assert.equal(found, c <= x, `cost ${c} with X=${x}`);
      assert.equal(zoneOf(g.engine, g.id(`o${c}`)), c <= x ? "discard" : "deck", `cost ${c} with X=${x}`);
    }
  }
});

clause(CHUM, "2:rule", "my own deck is not searched, whatever its cost", () => {
  const g = chumBoard();
  castChum(g, "food3");
  refused(() => chumSearch(g, "mine3"), "my own deck card");
  assert.equal(zoneOf(g.engine, g.id("mine3")), "deck");
});

clause(CHUM, "2:rule", "a cost-0 card has X = 0: only cost-0 cards are findable", () => {
  const board = () =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "chum", def: printing(CHUM), owner: P1, zone: "hand" },
        ...bank("deception", 2, P1),
        { key: "free", def: character({ name: "Free", cost: 0 }), owner: P1, zone: "discard" },
        { key: "z0", def: character({ name: "Z0", cost: 0 }), owner: P2, zone: "deck" },
        { key: "z1", def: character({ name: "Z1", cost: 1 }), owner: P2, zone: "deck" }
      ] as never
    });
  const g = board();
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("chum"), selected: { pick: [g.id("free")] } } as never);
  resolvePendingResponses(g.engine);
  refused(() => chumSearch(g as never, "z1"), "cost 1 > X=0");
  assert.equal(zoneOf(g.engine, g.id("z1")), "deck");
  chumSearch(g as never, "z0");
  assert.equal(zoneOf(g.engine, g.id("z0")), "discard");
});

clause(CHUM, "2:rule", "the search may come up empty: finding nothing leaves their deck and discard alone", () => {
  const g = chumBoard();
  castChum(g, "food3");
  chumSearch(g, undefined);
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.players[P2].discard.length, 1, "only their original Theirs2");
  assert.equal(g.engine.state.players[P2].deck.length, 6);
  assert.equal(zoneOf(g.engine, g.id("food3")), "removed", "the removal still happened");
});

clause(CHUM, "2:rule", "does not trigger for another card entering play", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "chum", def: printing(CHUM), owner: P1, zone: "play" },
      { key: "vanilla", def: character({ name: "Vanilla", cost: 0 }), owner: P1, zone: "hand" },
      { key: "food", def: character({ name: "Food", cost: 0 }), owner: P1, zone: "discard" }
    ] as never
  });
  play(g.engine, P1, g.id("vanilla"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("food")), "discard");
});

// -- SERAPHIM FUSION --------------------------------------------------------

type FusionOpts = { bankN?: number; omahInDeck?: boolean; extra?: unknown[] };
function fusionBoard(o: FusionOpts = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "chum", def: printing(CHUM), owner: P1, zone: "play" },
      { key: "pluck", def: character({ name: "My Pluck", cost: 1, unique: "pluck" } as never), owner: P1, zone: "play" },
      { key: "plainPluck", def: character({ name: "Plain Pluck", cost: 1, subtype: ["pluck"] } as never), owner: P1, zone: "play" },
      { key: "otherUnique", def: character({ name: "Other Unique", cost: 1, unique: "gideon" } as never), owner: P1, zone: "play" },
      { key: "theirPluck", def: character({ name: "Their Pluck", cost: 1, unique: "pluck" } as never), owner: P2, zone: "play" },
      { key: "handPluck", def: character({ name: "Hand Pluck", cost: 1, unique: "pluck" } as never), owner: P1, zone: "hand" },
      ...bank("deception", o.bankN ?? 4, P1),
      ...(o.omahInDeck === false ? [] : [{ key: "omah", def: character({ name: OMAH, cost: 5 }), owner: P1, zone: "deck" as const }]),
      ...(o.omahInDeck === false ? [] : [{ key: "omah2", def: character({ name: OMAH, cost: 5 }), owner: P1, zone: "deck" as const }]),
      { key: "decoy", def: character({ name: "Decoy", cost: 1 }), owner: P1, zone: "deck" },
      { key: "theirOmah", def: character({ name: OMAH, cost: 5 }), owner: P2, zone: "deck" },
      ...((o.extra ?? []) as never[])
    ] as never
  });
}
type FusionGame = ReturnType<typeof fusionBoard>;
const fuse = (g: FusionGame, pluck: string, tut: string | undefined): void => {
  g.engine.perform({
    type: "activateAbility",
    playerId: P1,
    cardId: g.id("chum"),
    abilityId: "chum-fusion",
    selected: { pluck: [g.id(pluck)], ...(tut ? { tut2: [g.id(tut)] } : {}) },
    variables: {}
  } as never);
  resolvePendingResponses(g.engine);
};

clause(CHUM, "3:ability:chum-fusion", "pays 4, destroys Chum and puts the found Omahkapi'si Pi'kssii into play under my control; the picked pluck stays", () => {
  const g = fusionBoard();
  fuse(g, "pluck", "omah");
  assert.equal(pending(g.engine), undefined);
  assert.equal(ready(g.engine, P1), 0, "4 paid");
  assert.equal(zoneOf(g.engine, g.id("chum")), "discard", "Chum destroyed");
  assert.equal(zoneOf(g.engine, g.id("omah")), "play");
  assert.equal(g.engine.state.cards[g.id("omah")].controllerId, P1);
  assert.equal(zoneOf(g.engine, g.id("pluck")), "play", "the pluck is only picked, not destroyed");
  assert.equal(zoneOf(g.engine, g.id("omah2")), "deck", "only one is found");
});

clause(CHUM, "3:ability:chum-fusion", "the cost is 4: refused with 3 resources, nothing destroyed", () => {
  const g = fusionBoard({ bankN: 3 });
  refused(() => fuse(g, "pluck", "omah"), "3 resources for pay 4");
  assert.equal(zoneOf(g.engine, g.id("chum")), "play");
  assert.equal(zoneOf(g.engine, g.id("omah")), "deck");
  assert.equal(ready(g.engine, P1), 3);
});

clause(CHUM, "3:ability:chum-fusion", "a unique pluck I control must be picked: refused with none picked, a non-unique pluck, another designation, the opponent's pluck, a pluck in hand", () => {
  for (const bad of ["plainPluck", "otherUnique", "theirPluck", "handPluck", "chum"]) {
    const g = fusionBoard();
    refused(() => fuse(g, bad, "omah"), `${bad} is not a unique pluck I control in play`);
    assert.equal(zoneOf(g.engine, g.id("chum")), "play", bad);
    assert.equal(zoneOf(g.engine, g.id("omah")), "deck", bad);
    assert.equal(ready(g.engine, P1), 4, `${bad}: nothing paid`);
  }
  const none = fusionBoard();
  refused(
    () => none.engine.perform({ type: "activateAbility", playerId: P1, cardId: none.id("chum"), abilityId: "chum-fusion", selected: { tut2: [none.id("omah")] }, variables: {} } as never),
    "no pluck picked"
  );
  assert.equal(zoneOf(none.engine, none.id("chum")), "play");
});

clause(CHUM, "3:ability:chum-fusion", "the controller must have a unique pluck: without one in play the ability cannot be used", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "chum", def: printing(CHUM), owner: P1, zone: "play" },
      ...bank("deception", 4, P1),
      { key: "omah", def: character({ name: OMAH, cost: 5 }), owner: P1, zone: "deck" }
    ] as never
  });
  refused(
    () => g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("chum"), abilityId: "chum-fusion", selected: { tut2: [g.id("omah")] }, variables: {} } as never),
    "no pluck to pick"
  );
  assert.equal(zoneOf(g.engine, g.id("chum")), "play");
});

clause(CHUM, "3:ability:chum-fusion", "searches MY deck for a card with that exact name: other cards and the opponent's copy are refused", () => {
  for (const bad of ["decoy", "theirOmah"]) {
    const g = fusionBoard();
    refused(() => fuse(g, "pluck", bad), `${bad} is not my Omahkapi'si Pi'kssii`);
    assert.equal(zoneOf(g.engine, g.id("chum")), "play", bad);
    assert.equal(zoneOf(g.engine, g.id(bad)), "deck", bad);
  }
});

clause(CHUM, "3:ability:chum-fusion", "a search that finds nothing is allowed: no copy in my deck, yet the cost is still paid and Chum destroyed", () => {
  const g = fusionBoard({ omahInDeck: false });
  fuse(g, "pluck", undefined);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("chum")), "discard", "cost: destroyed");
  assert.equal(ready(g.engine, P1), 0, "cost: 4 paid");
  assert.equal(zoneOf(g.engine, g.id("theirOmah")), "deck", "the opponent's copy is untouched");
});

clause(CHUM, "3:ability:chum-fusion", "Chum must be in play to use it: not from the hand or the discard pile", () => {
  const g = fusionBoard();
  (g.engine.state.cards[g.id("chum")] as { zone: string }).zone = "hand";
  refused(() => fuse(g, "pluck", "omah"), "Chum is not in play", /ability|play|not found/i);
  assert.equal(zoneOf(g.engine, g.id("omah")), "deck");
});

// ============================================================================
// Mutation-pass additions (T3c3)
// ============================================================================

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

clause(CAPER, "0:extraCost", "needs only one [D] for its threshold: deploys with one Deception among three resources, refused with three non-Deception resources", () => {
  const board = (deception: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "grab", def: grabber("character"), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", cost: 1 }), owner: P1, zone: "play" },
        { key: "caper", def: printing(CAPER), owner: P2, zone: "hand" },
        ...bank("deception", deception, P2),
        ...bank("rage", rage, P2)
      ] as never
    });
  const one = board(1, 2);
  one.engine.perform({ type: "playCard", playerId: P1, cardId: one.id("grab"), selected: { pick: [one.id("victim")] } } as never);
  one.engine.perform({ type: "playCard", playerId: P2, cardId: one.id("caper"), selected: {} } as never);
  resolvePendingResponses(one.engine);
  assert.equal(zoneOf(one.engine, one.id("victim")), "hand", "Caper resolved with exactly one [D]");
  assert.equal(ready(one.engine, P2), 0, "3 resources paid");

  const none = board(0, 3);
  none.engine.perform({ type: "playCard", playerId: P1, cardId: none.id("grab"), selected: { pick: [none.id("victim")] } } as never);
  refused(
    () => none.engine.perform({ type: "playCard", playerId: P2, cardId: none.id("caper"), selected: {} } as never),
    "three resources but no [D]",
    /threshold|icon/i
  );
  assert.equal(zoneOf(none.engine, none.id("caper")), "hand");
});

clause(CAPER, "2:flipUp", "FLIP UP only bounces the picked character: it draws nothing for a character that is not a UNIQUE PLUCK", () => {
  const g = caperBoard({ caper: "faceDown", bankD: 1, victim: "plain" });
  const handBefore = hand(g, P2).length;
  const deckBefore = [...g.engine.state.players[P2].deck];
  p1Picks(g, "tactic", "victim");
  p2Flip(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("victim")), "hand", "the character was bounced");
  assert.equal(hand(g, P2).length, handBefore, "the flipper drew nothing");
  assert.deepEqual(g.engine.state.players[P2].deck, deckBefore, "their deck is untouched");
});

clause(CHEATS, "0:unique", "is a character with subtype pluck and grifter", () =>
  printedStats({ id: CHEATS, type: "character", subtype: ["pluck", "grifter"], strength: 1, speed: 4, life: 3 })
);

clause(CHEATS, "2:rule", "put into play by another effect (no opponent picked as part of its cost), it searches nothing", () => {
  const cheater = tactic({
    name: "Cheater",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "cheat",
          type: "activated",
          targets: [{ id: "who", selector: { zone: "hand", name: "Cheats, the Dirty Rotten" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "who" }, controller: "controller" }]
        }
      ]
    }
  } as never);
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cheater", def: cheater, owner: P1, zone: "hand" },
      { key: "cheats", def: printing(CHEATS), owner: P1, zone: "hand" },
      { key: "x", def: named("X"), owner: P2, zone: "deck" },
      { key: "y", def: named("Y"), owner: P2, zone: "deck" }
    ] as never
  });
  play(g.engine, P1, g.id("cheater"), { selected: { who: [g.id("cheats")] } });
  assert.equal(zoneOf(g.engine, g.id("cheats")), "play", "Cheats entered play without paying its extra cost");
  assert.equal(pending(g.engine), undefined, "no opponent was picked, so nothing is searched");
  assert.deepEqual(zones(g as never, ["x", "y"]), ["deck", "deck"]);
});

clause(CHEATS, "2:rule", "the opponent's deck is shuffled after the search, whether cards were found or not (CR 312.1)", () => {
  const found = cheatsBoard({ random: () => 0 });
  castCheats(found);
  const before = [...found.engine.state.players[P2].deck];
  const takes = ["a1", "b", "c", "d"].map((k) => found.id(k));
  searchPick(found, ["a1", "b", "c", "d"]);
  assert.deepEqual(
    found.engine.state.players[P2].deck,
    shuffledWithConstant(before.filter((c) => !takes.includes(c)), 0),
    "the four found cards left the deck and the rest was shuffled"
  );

  const none = cheatsBoard({ random: () => 0 });
  castCheats(none);
  const beforeNone = [...none.engine.state.players[P2].deck];
  searchPick(none, []);
  assert.deepEqual(none.engine.state.players[P2].deck, shuffledWithConstant(beforeNone, 0), "finding nothing still shuffles their deck");
});

clause(CHUM, "0:unique", "is a dragon with 2 strength, 3 speed and 2 life, and its only keyword is TACTICAL", () => {
  printedStats({ id: CHUM, type: "character", subtype: ["dragon"], strength: 2, speed: 3, life: 2 });
  const g = buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "chum", def: printing(CHUM), owner: P1, zone: "play" }] as never });
  assert.deepEqual(g.engine.getKeywords(g.id("chum")), ["tactical"], "TACTICAL and nothing else");
});

clause(CHUM, "0:unique", "the designation is CHUM: another UNIQUE CHUM card I control makes me keep one", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "new", def: printing(CHUM), owner: P1, zone: "hand" },
      { key: "other", def: character({ name: "Not Chum", cost: 0, unique: "chum" } as never), owner: P1, zone: "play" },
      ...bank("deception", 4, P1),
      { key: "food", def: character({ name: "Food", cost: 0 }), owner: P1, zone: "discard" }
    ] as never
  });
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("new"), selected: { pick: [g.id("food")] } } as never);
  resolvePendingResponses(g.engine);
  const seen = pending(g.engine);
  assert.equal(seen?.kind, "uniqueSurvivor", "a differently named card with the CHUM designation counts");
  assert.deepEqual([...(seen?.candidates as string[])].sort(), [g.id("new"), g.id("other")].sort());
});

clause(CHUM, "2:rule", "the search takes one card: choosing two is refused", () => {
  const g = chumBoard();
  castChum(g, "food3");
  assert.throws(() => answer(g.engine, P1, { kind: "chooserSelectsTarget", selected: [g.id("o1"), g.id("o2")] } as never), "two cards");
  assert.equal(zoneOf(g.engine, g.id("o1")), "deck");
  assert.equal(zoneOf(g.engine, g.id("o2")), "deck");
});

clause(CHUM, "2:rule", "put into play by another effect (no card picked as part of its cost), it removes nothing and searches nothing", () => {
  const cheater = tactic({
    name: "Cheater",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "cheat",
          type: "activated",
          targets: [{ id: "who", selector: { zone: "hand", name: "Chum, the Ugliest Sarume" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "who" }, controller: "controller" }]
        }
      ]
    }
  } as never);
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cheater", def: cheater, owner: P1, zone: "hand" },
      { key: "chum", def: printing(CHUM), owner: P1, zone: "hand" },
      { key: "food", def: character({ name: "Food", cost: 0 }), owner: P1, zone: "discard" },
      { key: "x", def: character({ name: "X", cost: 0 }), owner: P2, zone: "deck" }
    ] as never
  });
  play(g.engine, P1, g.id("cheater"), { selected: { who: [g.id("chum")] } });
  assert.equal(zoneOf(g.engine, g.id("chum")), "play", "Chum entered play without paying its extra cost");
  assert.equal(pending(g.engine), undefined, "nothing was picked as part of its cost, so nothing is searched");
  assert.equal(zoneOf(g.engine, g.id("food")), "discard", "no card was removed from the game");
  assert.equal(zoneOf(g.engine, g.id("x")), "deck");
});

function chumShuffleBoard() {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "chum", def: printing(CHUM), owner: P1, zone: "hand" },
      ...bank("deception", 2, P1),
      { key: "food", def: character({ name: "Food", cost: 3 }), owner: P1, zone: "discard" },
      ...[0, 1, 2, 3, 4, 5].map((n) => ({ key: `o${n}`, def: character({ name: `Opp${n}`, cost: n }), owner: P2, zone: "deck" as const }))
    ] as never
  });
}

clause(CHUM, "2:rule", "the opponent's deck is shuffled after the search, whether a card was found or not (CR 312.1)", () => {
  const found = chumShuffleBoard();
  castChum(found, "food");
  const before = [...found.engine.state.players[P2].deck];
  chumSearch(found, "o2");
  assert.equal(zoneOf(found.engine, found.id("o2")), "discard", "the found card went to their discard pile");
  assert.deepEqual(found.engine.state.players[P2].deck, shuffledWithConstant(before.filter((c) => c !== found.id("o2")), 0), "and their deck was shuffled");

  const none = chumShuffleBoard();
  castChum(none, "food");
  const beforeNone = [...none.engine.state.players[P2].deck];
  chumSearch(none, undefined);
  assert.deepEqual(none.engine.state.players[P2].deck, shuffledWithConstant(beforeNone, 0), "finding nothing still shuffles their deck");
});

function fusionShuffleBoard() {
  return buildGame({
    random: () => 0,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "chum", def: printing(CHUM), owner: P1, zone: "play" },
      { key: "pluck", def: character({ name: "My Pluck", cost: 1, unique: "pluck" } as never), owner: P1, zone: "play" },
      ...bank("deception", 4, P1),
      { key: "d1", def: character({ name: "Decoy1", cost: 1 }), owner: P1, zone: "deck" },
      { key: "omah", def: character({ name: OMAH, cost: 5 }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "Decoy2", cost: 1 }), owner: P1, zone: "deck" },
      { key: "d3", def: character({ name: "Decoy3", cost: 1 }), owner: P1, zone: "deck" },
      { key: "theirOmah", def: character({ name: OMAH, cost: 5 }), owner: P2, zone: "deck" },
      { key: "theirOther", def: character({ name: "TheirOther", cost: 1 }), owner: P2, zone: "deck" }
    ] as never
  });
}

clause(CHUM, "3:ability:chum-fusion", "my deck is shuffled after the search (not the opponent's), whether the card was found or not (CR 312.1)", () => {
  const found = fusionShuffleBoard();
  const mine = [...found.engine.state.players[P1].deck];
  const theirs = [...found.engine.state.players[P2].deck];
  fuse(found as never, "pluck", "omah");
  assert.equal(zoneOf(found.engine, found.id("omah")), "play");
  assert.deepEqual(found.engine.state.players[P1].deck, shuffledWithConstant(mine.filter((c) => c !== found.id("omah")), 0), "my deck was shuffled");
  assert.deepEqual(found.engine.state.players[P2].deck, theirs, "the opponent's deck was not");

  const none = fusionShuffleBoard();
  const mineNone = [...none.engine.state.players[P1].deck];
  fuse(none as never, "pluck", undefined);
  assert.equal(zoneOf(none.engine, none.id("omah")), "deck", "nothing was taken");
  assert.deepEqual(none.engine.state.players[P1].deck, shuffledWithConstant(mineNone, 0), "finding nothing still shuffles my deck");
});
