// Multiplayer clause tests for the Seed set (3 and 4 seats), part 7: battle text, "choose a card type" reveals, faction
// rules and the rest of the cards that name no opponent. Expectations come from each card's PRINTED text, the
// multiplayer atoms (data/rule-tests/source/multiplayer.txt) and data/card-tests/mp-spec/seed.json.

import assert from "node:assert/strict";
import { CARD_CATALOG } from "../../../../data.js";
import { createFactionGame, type CardDefinition } from "../../../../engine.js";
import { autoResolveBattle, bank } from "../../per-card/_harness.js";
import { item, resourceCard, tactic } from "../../support/fixtures.js";
import { mpClause, holdCostChoices, printing, refused } from "../_clause.js";
import {
  abilityAction,
  activate,
  answerFor,
  assertNoOpponentAsked,
  assertOpponentAsked,
  character,
  choosePlayer,
  countIn,
  deckOf,
  eventsOf,
  fillSeats,
  handOf,
  influences,
  mixedHands,
  open,
  opponents,
  P1,
  P2,
  P3,
  passTurn,
  passUntil,
  playAction,
  playCard,
  playersNeeded,
  playRaw,
  resolvePendingResponses,
  runPrompts,
  seatsOf,
  table,
  tableWith,
  type CardPlacement,
  type Table
} from "./_seedKit.js";
import type { PlayerId } from "../../../../engine.js";

// =================================================================================
// Gideon, the Ultimate Warrior
// If battle damage is inflicted to this card while it's attacking, reduce the amount to 0.
// If your opponent's faction loses influence, increase the amount by 1.
// =================================================================================

const GIDEON = "fefe5571-41c7-4a9b-844e-88e2232f6c28";

mpClause(GIDEON, "1:rule", 3, "3 seats: battle damage to Gideon while it attacks is reduced to 0 whichever opponent it attacks, and an ordinary attacker is hurt", () => {
  for (const defender of [P2, P3]) {
    const t = table(3, [
      { key: "gd", def: printing(GIDEON), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain attacker", life: 9 }), owner: P1, zone: "play" },
      { key: "wall", def: character({ name: "Wall", strength: 5, life: 9 }), owner: defender, zone: "play" },
      { key: "wall2", def: character({ name: "Wall 2", strength: 5, life: 9 }), owner: defender, zone: "play" },
      ...fillSeats(3, 1, 3)
    ]);
    t.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [t.id("gd")], target: { type: "faction", playerId: defender } } as never);
    resolvePendingResponses(t.engine);
    t.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [t.id("wall")] } as never);
    autoResolveBattle(t.engine);
    assert.equal(t.engine.state.cards[t.id("gd")]!.damage, 0, `Gideon takes no battle damage attacking ${defender}`);
    assert.notEqual(t.engine.state.cards[t.id("gd")]!.zone, "discard");

    const u = table(3, [
      { key: "plain", def: character({ name: "Plain attacker", life: 9 }), owner: P1, zone: "play" },
      { key: "wall", def: character({ name: "Wall", strength: 5, life: 9 }), owner: defender, zone: "play" },
      ...fillSeats(3, 1, 3)
    ]);
    u.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [u.id("plain")], target: { type: "faction", playerId: defender } } as never);
    resolvePendingResponses(u.engine);
    u.engine.perform({ type: "declareBlockers", playerId: defender, blockerIds: [u.id("wall")] } as never);
    autoResolveBattle(u.engine);
    assert.ok(u.engine.state.cards[u.id("plain")]!.damage > 0, "control: an ordinary attacker is damaged by the same blocker");
  }
});

const drainer = (name: string, scope: "opponent" | "controller") =>
  tactic({
    name,
    behavior: { abilities: [{ id: "body", type: "activated", effects: [{ type: "modifyInfluence", player: scope, amount: -3 }] }] }
  });

for (const count of [3, 4] as const) {
  mpClause(GIDEON, "2:rule", count, `${count} seats: only a loss of influence by the opponent P1 chose (when Gideon entered play) is increased by 1; another opponent's loss and P1's own are not`, () => {
    for (const pick of seatsOf(count).slice(1)) {
      const t = table(count, [
        { key: "gd", def: printing(GIDEON), owner: P1, zone: "hand" },
        ...seatsOf(count).slice(1).map((seat) => ({ key: `drain-${seat}`, def: drainer(`Drain ${seat}`, "opponent"), owner: P1, zone: "hand" as const })),
        { key: "self", def: drainer("Self drain", "controller"), owner: P1, zone: "hand" },
        ...fillSeats(count, 1, 3),
        ...bank("rage", 4, P1)
      ]);
      playCard(t, P1, "gd");
      choosePlayer(t, P1, opponents(t), pick);
      const losses: Record<string, number> = {};
      for (const seat of seatsOf(count).slice(1)) {
        const before = influences(t)[seat]!;
        playCard(t, P1, `drain-${seat}`, { players: { opponent: seat } });
        losses[seat] = before - influences(t)[seat]!;
      }
      const own = influences(t)[P1]!;
      playCard(t, P1, "self");
      losses[P1] = own - influences(t)[P1]!;
      for (const seat of t.seats) assert.equal(losses[seat], seat === pick ? 4 : 3, `${seat}'s loss`);
    }
  });
}

// =================================================================================
// Surprise!
// Pick an attacking character your opponent controls. X is that character's numeric cost.
// Reveal cards from the top of your deck until a character with numeric cost X or less is revealed or no cards are left. If
// an appropriate character is revealed, put it into play under your control as a member of the blocking party.
// =================================================================================

const SURPRISE = "95ad5456-4279-4481-848b-933036e72684";

function surpriseTable(attacker: PlayerId, defender: PlayerId): Table {
  return table(
    3,
    [
      { key: "su", def: printing(SURPRISE), owner: P1, zone: "hand" },
      { key: "lure", def: tactic({ name: "Lure" }), owner: P1, zone: "deck" },
      { key: "blocker", def: character({ name: "Surprise blocker", cost: 1 }), owner: P1, zone: "deck" },
      { key: "atk-a", def: character({ name: "Attacker A", cost: 2 }), owner: attacker, zone: "play" },
      { key: "atk-b", def: character({ name: "Attacker B", cost: 3 }), owner: attacker, zone: "play" },
      { key: "idle", def: character({ name: "Idle", cost: 2 }), owner: attacker, zone: "play" },
      ...seatsOf(3).filter((seat) => seat !== attacker).map((seat) => ({ key: `own-${seat}`, def: character({ name: `Bystander ${seat}`, cost: 2 }), owner: seat, zone: "play" as const })),
      ...fillSeats(3, 1, 3).filter((placement) => !placement.key.startsWith("d-p1-")),
      ...bank("deception", 5, P1)
    ],
    attacker
  );
}

mpClause(SURPRISE, "0:ability", 3, "3 seats: when P2 attacks P1 no opponent is asked (the attacker is the opponent); only P2's attacking characters can be picked; the revealed character joins the blocking party", () => {
  const t = surpriseTable(P2, P1);
  t.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [t.id("atk-a"), t.id("atk-b")], target: { type: "faction", playerId: P1 } } as never);
  passUntil(t, P1);
  assertNoOpponentAsked(t, playAction(t, P1, "su"));
  const requirements = t.engine.getPlayRequirements(playAction(t, P1, "su") as never);
  const pick = requirements.find((requirement) => requirement.kind === "pick");
  assert.ok(pick && pick.kind === "pick", "pick && pick.kind === 'pick'");
  assert.deepEqual([...pick.candidates].sort(), [t.id("atk-a"), t.id("atk-b")].sort(), "P2's attacking characters only, not its idle one, P3's or P1's own");
  playRaw(t, P1, "su", { selected: { k: [t.id("atk-a")] } });
  resolvePendingResponses(t.engine);
  assert.equal(t.engine.state.cards[t.id("blocker")]!.zone, "play", "the character with numeric cost 2 or less entered play");
  assert.equal(t.engine.state.cards[t.id("blocker")]!.controllerId, P1);
  assert.ok(t.engine.state.battle?.blockingParty.includes(t.id("blocker")), "as a member of the blocking party");
  assert.equal(t.engine.state.cards[t.id("lure")]!.zone, "deck", "the other revealed card was shuffled back into the deck");
});

mpClause(SURPRISE, "0:ability", 3, "3 seats: P3 defending against P2's attack plays it the same way: no opponent is asked and only P2's attackers can be picked", () => {
  const t = table(
    3,
    [
      { key: "su3", def: printing(SURPRISE), owner: P3, zone: "hand" },
      { key: "blocker", def: character({ name: "Surprise blocker", cost: 1 }), owner: P3, zone: "deck" },
      { key: "atk-a", def: character({ name: "Attacker A", cost: 2 }), owner: P2, zone: "play" },
      { key: "own-p1", def: character({ name: "Bystander", cost: 2 }), owner: P1, zone: "play" },
      ...bank("deception", 5, P3)
    ],
    P2
  );
  t.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [t.id("atk-a")], target: { type: "faction", playerId: P3 } } as never);
  passUntil(t, P3);
  assertNoOpponentAsked(t, playAction(t, P3, "su3"));
  const pick = t.engine.getPlayRequirements(playAction(t, P3, "su3") as never).find((requirement) => requirement.kind === "pick");
  assert.ok(pick && pick.kind === "pick", "pick && pick.kind === 'pick'");
  assert.deepEqual(pick.candidates, [t.id("atk-a")]);
});

mpClause(SURPRISE, "0:ability", 3, "3 seats: P1, not a party to P2's attack on P3, must choose an opponent (MP 2): choosing P2 lets it pick P2's attacking characters, choosing P3 leaves nothing to pick", () => {
  const t = surpriseTable(P2, P3);
  t.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [t.id("atk-a"), t.id("atk-b")], target: { type: "faction", playerId: P3 } } as never);
  passUntil(t, P1);
  const choices = playersNeeded(t, playAction(t, P1, "su"));
  assert.ok(choices, "P1 is asked for an opponent");
  assert.equal(choices[0]!.id, "opponent");
  assert.ok(choices[0]!.candidates.includes(P2), "choices[0]!.candidates.includes(P2)");
  const forP2 = t.engine.getPlayRequirements(playAction(t, P1, "su", { players: { opponent: P2 } }) as never).find((requirement) => requirement.kind === "pick");
  assert.ok(forP2 && forP2.kind === "pick", "forP2 && forP2.kind === 'pick'");
  assert.deepEqual([...forP2.candidates].sort(), [t.id("atk-a"), t.id("atk-b")].sort());
  const forP3 = t.engine.getPlayRequirements(playAction(t, P1, "su", { players: { opponent: P3 } }) as never).find((requirement) => requirement.kind === "pick");
  assert.deepEqual(forP3?.kind === "pick" ? forP3.candidates : [], [], "P3 has no attacking character: nothing to pick");
  refused(() => playRaw(t, P1, "su", { players: { opponent: P3 }, selected: { k: [] } }), "the cost cannot be paid: P3 has no attacking character to pick");
});

// =================================================================================
// Dauntless Gambler / Flailing Knife / Flimflam Man / Opportune Slotpuller / Roulette Wheel of DOOM!
// Reveal the top card of your deck: shown to every player, and only P1's deck is touched.
// =================================================================================

const GAMBLER = "1a6323e1-ea9a-4ea0-acee-0eaa9b61a9c1";
const KNIFE = "e7405d47-49f3-4b3a-adb5-1444fc726135";
const FLIMFLAM = "24de2269-2902-4800-a2f9-2ad2de1f1ee5";
const SLOTPULLER = "b176a78f-7145-4635-943c-4b41e21279bd";
const ROULETTE = "88812b6d-a80c-4271-88e0-d3bf47a8aeaf";

/** The top card of P1's deck is a `type` card named "Top"; everyone else's decks are the usual four characters. */
function topCard(type: "character" | "item" | "tactic", cost = 1): CardPlacement {
  const def = type === "character" ? character({ name: "Top", cost }) : type === "item" ? item({ name: "Top", cost }) : tactic({ name: "Top", cost });
  return { key: "top", def, owner: P1, zone: "deck" };
}

const decksOf = (t: Table) => Object.fromEntries(t.seats.map((seat) => [seat, [...deckOf(t, seat)]]));

/** P1's top card was revealed to everyone, and no other seat's deck changed. */
function revealedByP1Only(t: Table, before: Record<string, string[]>): void {
  const shown = eventsOf(t, "cardsRevealed").filter((event) => event.ownerId === P1 && event.zone === "deck");
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.viewerId, "all", "the reveal is visible to every player");
  assert.deepEqual(shown[0]!.cardIds, [before[P1]![0]]);
  for (const seat of t.seats.filter((s) => s !== P1)) assert.deepEqual(deckOf(t, seat), before[seat], `${seat}'s deck is untouched`);
}

for (const count of [3, 4] as const) {
  mpClause(GAMBLER, "0:rule", count, `${count} seats: P1 chooses a type and reveals the top card of P1's deck to everyone; on a match it gets a token; the top card goes to the bottom; no opponent is chosen and no other deck changes`, () => {
    for (const [index, match] of [
      [0, true],
      [1, false]
    ] as const) {
      const t = table(count, [{ key: "dg", def: printing(GAMBLER), owner: P1, zone: "hand" }, topCard("character"), ...fillSeats(count, 1, 3).filter((p) => !p.key.startsWith("d-p1-")), ...bank("deception", 5, P1)]);
      const before = decksOf(t);
      playCard(t, P1, "dg");
      answerFor(t, P1, "chooserSelectsOption", { index });
      assert.equal(open(t), undefined, "no opponent is chosen");
      assert.equal(t.engine.state.cards[t.id("dg")]!.counters?.token ?? 0, match ? 1 : 0, match ? "a token on a match" : "no token without a match");
      revealedByP1Only(t, before);
      assert.equal(deckOf(t, P1).slice(-1)[0], before[P1]![0], "the top card went to the bottom of P1's deck");
    }
  });

  mpClause(GAMBLER, "1:rule", count, `${count} seats: with a token it gets +1 strength and +1 life, whatever the other players control`, () => {
    const base = printing(GAMBLER);
    const t = table(count, [{ key: "dg", def: printing(GAMBLER), owner: P1, zone: "play", counters: { token: 1 } }, ...mixedHands(count)]);
    assert.equal(t.engine.getStat(t.id("dg"), "strength"), base.strength! + 1);
    assert.equal(t.engine.getStat(t.id("dg"), "life"), base.life! + 1);
    const u = table(count, [{ key: "dg", def: printing(GAMBLER), owner: P1, zone: "play" }, ...mixedHands(count)]);
    assert.equal(u.engine.getStat(u.id("dg"), "strength"), base.strength!);
  });

  mpClause(FLIMFLAM, "0:rule", count, `${count} seats: P1 chooses a type and reveals the top card of P1's deck to everyone; on a match it goes to P1's hand, otherwise to the bottom; no other deck changes`, () => {
    for (const [index, match] of [
      [0, true],
      [1, false]
    ] as const) {
      const t = table(count, [{ key: "ff", def: printing(FLIMFLAM), owner: P1, zone: "hand" }, topCard("character"), ...fillSeats(count, 1, 3).filter((p) => !p.key.startsWith("d-p1-")), ...bank("deception", 5, P1)]);
      const before = decksOf(t);
      playCard(t, P1, "ff");
      answerFor(t, P1, "chooserSelectsOption", { index });
      assert.equal(open(t), undefined);
      revealedByP1Only(t, before);
      if (match) assert.ok(handOf(t, P1).includes(t.id("top")), "the matching card went to P1's hand");
      else assert.equal(deckOf(t, P1).slice(-1)[0], before[P1]![0], "no match: the card went to the bottom of P1's deck");
    }
  });
}

mpClause(KNIFE, "1:rule", 3, "3 seats: the attached character gets +2 strength whoever controls it", () => {
  for (const host of seatsOf(3)) {
    const t = table(3, [
      ...seatsOf(3).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}`, strength: 2 }), owner: seat, zone: "play" as const })),
      { key: "fk", def: printing(KNIFE), owner: P1, zone: "play", attachedToKey: `c-${host}` },
      ...fillSeats(3, 1, 3)
    ]);
    for (const seat of t.seats) assert.equal(t.engine.getStat(t.id(`c-${seat}`), "strength"), seat === host ? 4 : 2, `${seat}'s character`);
  }
});

mpClause(KNIFE, "2:rule", 3, "3 seats: when it goes from play to P1's discard pile P1 may choose a type and reveals the top card of P1's deck to everyone; on a match it enters play again; the top card goes to the bottom; other decks are untouched", () => {
  const smash = tactic({ name: "Smash", behavior: { abilities: [{ id: "body", type: "activated", targets: [{ id: "t", selector: { type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });
  const t = table(3, [
    ...seatsOf(3).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const })),
    { key: "fk", def: printing(KNIFE), owner: P1, zone: "play", attachedToKey: "c-p1" },
    { key: "smash", def: smash, owner: P1, zone: "hand" },
    topCard("character"),
    ...fillSeats(3, 1, 3).filter((p) => !p.key.startsWith("d-p1-"))
  ]);
  const before = decksOf(t);
  playCard(t, P1, "smash", { selected: { t: [t.id("fk")] } });
  assert.equal(t.engine.state.cards[t.id("fk")]!.zone, "discard", "the Knife went from play to P1's discard pile");
  answerFor(t, P1, "chooserSelectsOption", { index: 0 });
  answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id("c-p3")] });
  assert.equal(open(t), undefined);
  revealedByP1Only(t, before);
  assert.equal(t.engine.state.cards[t.id("fk")]!.zone, "play", "a match: it entered play");
  assert.equal(t.engine.state.cards[t.id("fk")]!.attachedTo, t.id("c-p3"));
  assert.equal(deckOf(t, P1).slice(-1)[0], before[P1]![0], "the top card went to the bottom");
});

mpClause(SLOTPULLER, "0:ability:gamble", 3, "3 seats: GAMBLE reveals the top card of P1's deck to everyone; on a match it gains 2 strength and loses 1 life this turn; the top card goes to the bottom; other decks are untouched", () => {
  for (const [type, match] of [
    ["character", true],
    ["item", false]
  ] as const) {
    const t = table(3, [{ key: "os", def: printing(SLOTPULLER), owner: P1, zone: "play" }, topCard(type), ...fillSeats(3, 1, 3).filter((p) => !p.key.startsWith("d-p1-")), ...bank("deception", 3, P1)]);
    const before = decksOf(t);
    const base = printing(SLOTPULLER);
    holdCostChoices(() => {
      activate(t, P1, "os", "gamble");
      answerFor(t, P1, "chooserSelectsOption", { index: 0 });
    });
    assert.equal(open(t), undefined);
    revealedByP1Only(t, before);
    assert.equal(t.engine.getStat(t.id("os"), "strength"), base.strength! + (match ? 2 : 0));
    assert.equal(t.engine.getStat(t.id("os"), "life"), base.life! - (match ? 1 : 0));
    assert.equal(deckOf(t, P1).slice(-1)[0], before[P1]![0], "the top card went to the bottom");
  }
});

mpClause(ROULETTE, "0:rule", 3, "3 seats: the top card of P1's deck is revealed to everyone; P1 may pick any player's character with life X or less (X its cost) and destroy it, otherwise draws 2; other decks are untouched", () => {
  for (const target of seatsOf(3)) {
    const t = table(3, [
      { key: "rw", def: printing(ROULETTE), owner: P1, zone: "hand" },
      topCard("character", 3),
      ...seatsOf(3).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}`, life: 3 }), owner: seat, zone: "play" as const })),
      ...fillSeats(3, 1, 3),
      ...bank("deception", 4, P1)
    ]);
    const before = decksOf(t);
    playCard(t, P1, "rw");
    answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id(`c-${target}`)] });
    assert.equal(open(t), undefined);
    const shown = eventsOf(t, "cardsRevealed").filter((event) => event.ownerId === P1 && event.zone === "deck");
    assert.equal(shown[0]?.viewerId, "all");
    assert.equal(t.engine.state.cards[t.id(`c-${target}`)]!.zone, "discard", `${target}'s character was destroyed`);
    for (const seat of t.seats.filter((s) => s !== target)) assert.equal(t.engine.state.cards[t.id(`c-${seat}`)]!.zone, "play");
    for (const seat of t.seats.filter((s) => s !== P1)) assert.deepEqual(deckOf(t, seat), before[seat]);
    assert.equal(deckOf(t, P1).length, before[P1]!.length, "P1 drew nothing");
  }
  const u = table(3, [
    { key: "rw", def: printing(ROULETTE), owner: P1, zone: "hand" },
    topCard("character", 3),
    ...seatsOf(3).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}`, life: 3 }), owner: seat, zone: "play" as const })),
    ...fillSeats(3, 1, 3),
    ...bank("deception", 4, P1)
  ]);
  const before = decksOf(u);
  playCard(u, P1, "rw");
  answerFor(u, P1, "chooserSelectsTarget", { selected: [] });
  assert.equal(deckOf(u, P1).length, before[P1]!.length - 2, "no pick: P1 draws 2 cards");
  for (const seat of u.seats.filter((s) => s !== P1)) assert.deepEqual(deckOf(u, seat), before[seat]);
});

// =================================================================================
// Drowned Catacombs (faction)
// =================================================================================

const CATACOMBS = "9d0ed925-fc2d-4745-82c0-68f90bf5d576";

const named = (name: string, type: string): CardDefinition => {
  const found = CARD_CATALOG.find((card) => card.name === name && card.type === type);
  assert.ok(found, `catalog has ${name}`);
  return found;
};
const IMPERIAL = named("Imperial Army", "faction"); // 2 Rage
const STAPLES = ["Rage", "Greed", "Deception", "Elitism", "Obsession"].map((name) => named(name, "resource"));

/** A game set up through the real faction setup, `factions[0]` at seat P1. */
function setUp(factions: CardDefinition[]) {
  const definitions = [...new Set([...factions, ...STAPLES])];
  return createFactionGame(definitions, {
    players: factions.map((faction, seat) => ({
      id: [P1, P2, P3][seat]!,
      name: `Player ${seat + 1}`,
      deckDefinitionIds: [faction.id, ...STAPLES.flatMap((staple) => Array<string>(8).fill(staple.id))]
    }))
  });
}

const resourceNames = (engine: ReturnType<typeof setUp>, who: PlayerId) =>
  engine.state.players[who]!.play.filter((id) => engine.getDefinition(id).type === "resource").map((id) => engine.getDefinition(id).name).sort();

mpClause(CATACOMBS, "0:rule:STARTING RESOURCES", 3, "3 seats: the player with Drowned Catacombs begins with 1 Deception and 1 staple resource; the other seats' factions give them nothing from this rule", () => {
  const engine = setUp([printing(CATACOMBS), IMPERIAL, IMPERIAL]);
  const mine = resourceNames(engine, P1);
  assert.equal(mine.length, 2);
  assert.ok(mine.includes("Deception"), "1 Deception");
  assert.deepEqual(resourceNames(engine, P2), ["Rage", "Rage"], "P2 gets only its own faction's Rage");
  assert.deepEqual(resourceNames(engine, P3), ["Rage", "Rage"], "P3 gets only its own faction's Rage");
});

mpClause(CATACOMBS, "1:rule:STARTING DRAW", 3, "3 seats: with Drowned Catacombs at seat 1 (going first) the player draws 8; at seat 2 or 3 it draws 9 (every seat after the first draws as going second)", () => {
  assert.equal(handOf({ engine: setUp([printing(CATACOMBS), IMPERIAL, IMPERIAL]) } as unknown as Table, P1).length, 8);
  assert.equal(setUp([IMPERIAL, printing(CATACOMBS), IMPERIAL]).state.players[P2]!.hand.length, 9);
  assert.equal(setUp([IMPERIAL, IMPERIAL, printing(CATACOMBS)]).state.players[P3]!.hand.length, 9);
});

function catacombsTable(cards: CardPlacement[], active: PlayerId = P3): Table {
  return tableWith(3, cards, { [P1]: printing(CATACOMBS) }, active, true);
}

mpClause(CATACOMBS, "2:rule:RESTORE RULE", 3, "3 seats: at the start of P1's turn all of P1's depleted cards are restored and resources detached from P1's faction; the other seats' cards stay as they are, and it does not fire at P2's or P3's turn", () => {
  const factionKeys = { [P1]: "__factionA", [P2]: "__factionB", [P3]: "__faction_p3" };
  const t = catacombsTable([
    ...tiredFightersFor(),
    ...seatsOf(3).map((seat) => ({ key: `att-${seat}`, def: resourceCard({ name: `Attached ${seat}` }), owner: seat, zone: "play" as const, attachedToKey: factionKeys[seat]! })),
    ...fillSeats(3, 1, 3)
  ]);
  assert.equal(passTurn(t), P1);
  runPrompts(t, () => ({ index: 0 }));
  assert.equal(t.engine.state.cards[t.id("c-p1")]!.depleted, false, "P1's depleted card was restored");
  assert.equal(t.engine.state.cards[t.id("att-p1")]!.attachedTo, undefined, "P1's resource was detached from its faction");
  for (const seat of [P2, P3]) {
    assert.equal(t.engine.state.cards[t.id(`c-${seat}`)]!.depleted, true, `${seat}'s depleted card is untouched`);
    assert.equal(t.engine.state.cards[t.id(`att-${seat}`)]!.attachedTo !== undefined, true, `${seat}'s attached resource is untouched`);
  }
  t.engine.state.cards[t.id("c-p1")]!.depleted = true;
  assert.equal(passTurn(t), P2);
  assert.equal(passTurn(t), P3);
  assert.equal(t.engine.state.cards[t.id("c-p1")]!.depleted, true, "P1's rule does not fire at the start of P2's or P3's turn");
});

function tiredFightersFor(): CardPlacement[] {
  return seatsOf(3).map((seat) => ({ key: `c-${seat}`, def: character({ name: `Fighter ${seat}` }), owner: seat, zone: "play" as const, depleted: true }));
}

mpClause(CATACOMBS, "3:rule:DEVELOP RULE", 3, "3 seats: at the start of P1's turn P1 draws a card or plays a resource; P2 and P3 get nothing from P1's faction", () => {
  const t = catacombsTable([...mixedHands(3)]);
  const before = deckOf(t, P1).length;
  assert.equal(passTurn(t), P1);
  const asked = runPrompts(t, (pc) => {
    const options = pc.options as Array<{ label?: string }>;
    return { index: options.findIndex((option) => /^Draw/.test(option.label ?? "")) };
  });
  assert.deepEqual(asked.map((entry) => entry.playerId), [P1], "only P1 is offered the Develop Rule");
  assert.equal(before - deckOf(t, P1).length, 1, "P1 drew a card");
  const decks = [deckOf(t, P2).length, deckOf(t, P3).length];
  assert.equal(passTurn(t), P2);
  assert.equal(open(t), undefined, "nothing is offered at P2's turn");
  assert.equal(passTurn(t), P3);
  assert.equal(open(t), undefined, "nothing is offered at P3's turn");
  assert.deepEqual([deckOf(t, P2).length, deckOf(t, P3).length], decks);
});

mpClause(CATACOMBS, "4:ability", 3, "3 seats: P1 pays 3 and draws a card with the faction's DRAW ability; P2 and P3 cannot use P1's faction ability", () => {
  const t = catacombsTable([...mixedHands(3), ...bank("rage", 5, P1)], P1);
  const handBefore = countIn(t, P1, "hand");
  const spent = t.engine.getAvailableResourceCount(P1);
  activate(t, P1, "__factionA", "catacombs-draw");
  assert.equal(countIn(t, P1, "hand") - handBefore, 1);
  assert.equal(spent - t.engine.getAvailableResourceCount(P1), 3);
  for (const seat of [P2, P3]) {
    while (t.engine.state.activePlayerId !== seat) passTurn(t);
    refused(() => activate(t, seat, "__factionA", "catacombs-draw"), `${seat} using P1's faction ability`);
  }
});

mpClause(CATACOMBS, "5:ability", 3, "3 seats: P1 pays 4 and plays a resource with the faction's RESOURCE ability; P2 and P3 cannot use P1's faction ability", () => {
  const t = catacombsTable([...mixedHands(3), ...bank("rage", 5, P1)], P1);
  const spent = t.engine.getAvailableResourceCount(P1);
  activate(t, P1, "__factionA", "catacombs-resource");
  assert.equal(open(t)?.kind, "chooserSelectsTarget");
  answerFor(t, P1, "chooserSelectsTarget", { selected: [t.id("rs-p1")] });
  assert.equal(t.engine.state.cards[t.id("rs-p1")]!.zone, "play", "P1 played a resource");
  assert.equal(spent - t.engine.getAvailableResourceCount(P1), 3, "it cost 4 and the resource just played is ready");
  for (const seat of [P2, P3]) {
    while (t.engine.state.activePlayerId !== seat) passTurn(t);
    refused(() => activate(t, seat, "__factionA", "catacombs-resource"), `${seat} using P1's faction ability`);
  }
});

mpClause(CATACOMBS, "6:ability", 3, "3 seats: SNEAK names the opponent first; X is the number of characters only that opponent controls (P2 three, P3 one); P1 pays X and picks a character with X strength or less, which gains COVERT", () => {
  const crowd = (seat: PlayerId, n: number): CardPlacement[] => Array.from({ length: n }, (_, i) => ({ key: `x-${seat}-${i}`, def: character({ name: `Crowd ${seat} ${i}`, strength: 1 }), owner: seat, zone: "play" as const }));
  for (const [pick, x] of [
    [P2, 3],
    [P3, 1]
  ] as const) {
    const t = catacombsTable([...crowd(P2, 3), ...crowd(P3, 1), { key: "strong", def: character({ name: "Strong", strength: 2 }), owner: P1, zone: "play" }, ...fillSeats(3, 1, 3), ...bank("rage", 5, P1)], P1);
    assertOpponentAsked(t, abilityAction(t, P1, "__factionA", "catacombs-sneak"));
    const spent = t.engine.getAvailableResourceCount(P1);
    const requirements = t.engine.getPlayRequirements(abilityAction(t, P1, "__factionA", "catacombs-sneak", { players: { opponent: pick } }) as never);
    const picks = requirements.find((requirement) => requirement.kind === "pick");
    assert.ok(picks && picks.kind === "pick", "picks && picks.kind === 'pick'");
    assert.equal(picks.candidates.includes(t.id("strong")), x >= 2, `a character with strength 2 ${x >= 2 ? "is" : "is not"} pickable when X is ${x}`);
    activate(t, P1, "__factionA", "catacombs-sneak", { players: { opponent: pick }, selected: { c: [t.id(`x-${P2}-0`)] } });
    assert.equal(spent - t.engine.getAvailableResourceCount(P1), x, `X is ${x}: only ${pick}'s characters are counted`);
    assert.equal(t.engine.getKeywords(t.id(`x-${P2}-0`)).includes("covert"), true, "the picked character gained COVERT");
  }
});
