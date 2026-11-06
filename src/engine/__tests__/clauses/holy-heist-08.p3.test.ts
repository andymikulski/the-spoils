// Clause tests, batch holy-heist-08, part p3 (groups 11-18, missing clauses only).
// Raging Ferocity, Rapacious Soldier, Rudo Mangod, Skilled Bannerman, Some Crazy Ornery Unfriendly Thug,
// Special Forces, Stern But Fair Backhand, Suicide Smash.
// Expectations come from the PRINTED text and RULES.md; engine data is only used to drive the engine.
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
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
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { declareAttackBy, declareAttackOpenWindow } from "./_battle.js";
import { declareBlockers, pending, readyResources, zoneOf } from "./_board.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { developResource, endTurn, factionOf } from "./_turn.js";
import { volition } from "../per-card/_harness.js";

const FERO = "9192b2fa-b568-4ac1-bfd9-b9cb31d8fa42"; // Raging Ferocity
const RAPA = "b1ca8db9-a359-46d8-a656-cb5ffadd68a4"; // Rapacious Soldier
const RUDO = "baa7224f-39ee-4e4b-8788-1f190dbb38f0"; // Rudo Mangod, Holder of Light
const BANNER = "8b65f186-200b-4642-bf4a-a4055a9f5372"; // Skilled Bannerman
const THUG = "49ba7019-9706-4ea4-b958-630a4400ef8c"; // Some Crazy Ornery Unfriendly Thug
const FORCES = "fa0943ab-fc48-4768-aab5-aee0b8aa3f37"; // Special Forces
const BACKHAND = "d0ebba3a-1150-497d-85cd-9299abdf9f38"; // Stern But Fair Backhand
const SMASH = "519a6b1a-f64e-4fe1-b586-39b32f7b328a"; // Suicide Smash

const START = 20;
const ready = (engine: SpoilsEngine, p: PlayerId = P1) => readyResources(engine, p);
const cardOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId];
const influence = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].influence as number;
const handOf = (engine: SpoilsEngine, p: PlayerId) => [...engine.state.players[p].hand];
const events = (engine: SpoilsEngine, type: string): Array<Record<string, unknown>> =>
  engine
    .getLog()
    .map((entry) => entry.event as unknown as Record<string, unknown> | undefined)
    .filter((event): event is Record<string, unknown> => !!event && event.type === type);
const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const fillDeck = (owner: PlayerId, n: number, prefix = "dk"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `Deck${prefix}${i}` }), owner, zone: "deck" as const }));
const sides = { playerA: { faction: developFaction(), influence: START }, playerB: { faction: developFaction(), influence: START } };

// ============================================================================
// Raging Ferocity -- resource, cost 0, provides [R]; face-down only from hand; FLIP IT [R]
// ============================================================================

function feroBoard(k: number, m: number, extra: CardPlacement[] = [], opts: { fero?: "hand" | "play"; faceDown?: boolean } = {}) {
  return buildGame({
    ...sides,
    cards: [
      { key: "fe", def: printing(FERO), owner: P1, zone: opts.fero ?? "play", faceDown: opts.faceDown ?? true },
      ...bank("rage", k, P1),
      ...bank("greed", m - 1, P2),
      { key: "ofd", def: character({ name: "OppHiddenRes" }), owner: P2, zone: "play", faceDown: true },
      { key: "oChar", def: character({ name: "OppChar" }), owner: P2, zone: "play" },
      { key: "oItem", def: item({ name: "OppItem" }), owner: P2, zone: "play" },
      { key: "oLoc", def: location({ name: "OppLoc" }), owner: P2, zone: "play" },
      { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      ...extra
    ]
  });
}
type FB = ReturnType<typeof feroBoard>;
const feroFlip = (b: FB, target: PlayerId = P2) =>
  activate(b.engine, P1, b.id("fe"), "flip-it", { selected: { fac: [factionOf(b.engine, target)] } });

clause(FERO, "0:rule", "can be played from hand face-down as a resource", () => {
  const { engine, id } = feroBoard(0, 1, [], { fero: "hand", faceDown: false });
  developResource(engine, P1, id("fe"), true);
  assert.equal(zoneOf(engine, id("fe")), "play");
  assert.equal(cardOf(engine, id("fe")).faceDown, true);
});

clause(FERO, "0:rule", "may NOT be played from hand face-up (an ordinary resource can be)", () => {
  const { engine, id } = feroBoard(0, 1, [{ key: "plain", def: item({ name: "unused" }), owner: P1, zone: "hand" }], { fero: "hand", faceDown: false });
  developResource(engine, P1, id("fe"), false); // asked to play it face-up: it only plays face-down
  assert.equal(zoneOf(engine, id("fe")), "play");
  assert.equal(cardOf(engine, id("fe")).faceDown, true, "Ferocity can only be played face-down");
});

const rageChar = (cost: number) => character({ name: `RageChar${cost}`, cost, threshold: "r" as never });
const feroProvidesBoard = (cost: number, faceDown: boolean, zone: "play" | "hand" = "play") =>
  buildGame({
    ...sides,
    cards: [
      { key: "fe", def: printing(FERO), owner: P1, zone, faceDown },
      { key: "c", def: rageChar(cost), owner: P1, zone: "hand" }
    ]
  });

clause(FERO, "1:provides", "face-up in play it provides exactly one [R]: it alone pays a cost-1 [R] character, but not a cost-2 one", () => {
  const one = feroProvidesBoard(1, false);
  assert.equal(ready(one.engine), 1);
  play(one.engine, P1, one.id("c"));
  assert.equal(zoneOf(one.engine, one.id("c")), "play");
  assert.equal(ready(one.engine), 0, "it was spent");
  const two = feroProvidesBoard(2, false);
  refused(() => play(two.engine, P1, two.id("c")), "one resource for a cost of 2", /Costs cannot be paid/);
  assert.equal(zoneOf(two.engine, two.id("c")), "hand");
});

clause(FERO, "1:provides", "provides [R] and nothing else: it does not satisfy a [G] threshold", () => {
  const greedChar = character({ name: "GreedChar", cost: 1, threshold: "g" as never });
  const b = buildGame({ ...sides, cards: [{ key: "fe", def: printing(FERO), owner: P1, zone: "play", faceDown: false }, { key: "c", def: greedChar, owner: P1, zone: "hand" }] });
  refused(() => play(b.engine, P1, b.id("c")), "no [G]", /Threshold requirements are not met/);
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
});

clause(FERO, "1:provides", "exactly ONE [R] icon: a cost-1 [R][R] character is refused with the Ferocity alone, and accepted with one more Rage resource", () => {
  const rr = (extra: CardPlacement[]) =>
    buildGame({
      ...sides,
      cards: [
        { key: "fe", def: printing(FERO), owner: P1, zone: "play", faceDown: false },
        { key: "c", def: character({ name: "RR", cost: 1, threshold: "rr" as never }), owner: P1, zone: "hand" },
        ...extra
      ]
    });
  const alone = rr([]);
  refused(() => play(alone.engine, P1, alone.id("c")), "one [R] icon is not [R][R]", /Threshold requirements are not met/);
  const withBank = rr(bank("rage", 1, P1));
  play(withBank.engine, P1, withBank.id("c"));
  assert.equal(zoneOf(withBank.engine, withBank.id("c")), "play");
});

clause(FERO, "1:provides", "face-down it is only a Volition resource: it cannot satisfy an [R] threshold, but does pay a [V] one; in hand it provides nothing", () => {
  const down = feroProvidesBoard(1, true);
  refused(() => play(down.engine, P1, down.id("c")), "a face-down Ferocity gives no [R]", /Threshold requirements are not met/);
  assert.equal(zoneOf(down.engine, down.id("c")), "hand");
  const vChar = character({ name: "VChar", cost: 1, threshold: "v" as never });
  const v = buildGame({ ...sides, cards: [{ key: "fe", def: printing(FERO), owner: P1, zone: "play", faceDown: true }, { key: "c", def: vChar, owner: P1, zone: "hand" }] });
  play(v.engine, P1, v.id("c"));
  assert.equal(zoneOf(v.engine, v.id("c")), "play", "control: the face-down Ferocity is a Volition resource");
  const inHand = feroProvidesBoard(1, false, "hand");
  assert.equal(ready(inHand.engine), 0);
  refused(() => play(inHand.engine, P1, inHand.id("c")), "in hand it provides nothing", /Threshold requirements are not met/);
});

clause(FERO, "2:ability:flip-it", "X is the picked player's resources, Y is mine: 9 vs 5 resources inflicts 4 damage; opponent faction only", () => {
  const b = feroBoard(4, 9); // opp: 8 greed + 1 face-down = 9; me: 4 banks + Ferocity = 5
  feroFlip(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(influence(b.engine, P2), START - 4);
  assert.equal(influence(b.engine, P1), START, "my faction takes nothing");
});

clause(FERO, "2:ability:flip-it", "other numbers: 9 vs 7 inflicts 2; 8 vs 5 inflicts 3 (X and Y both move the damage)", () => {
  const b = feroBoard(6, 9);
  feroFlip(b);
  assert.equal(influence(b.engine, P2), START - 2);
  const c = feroBoard(4, 8);
  feroFlip(c);
  assert.equal(influence(c.engine, P2), START - 3);
});

clause(FERO, "2:ability:flip-it", "X - Y of zero or less inflicts no damage (it never heals)", () => {
  const zero = feroBoard(4, 5); // X = 5, Y = 5
  feroFlip(zero);
  assert.equal(influence(zero.engine, P2), START, "X = Y: no damage");
  const neg = feroBoard(5, 3); // X = 3, Y = 6
  feroFlip(neg);
  assert.equal(influence(neg.engine, P2), START, "X < Y: not healed");
  assert.equal(influence(neg.engine, P1), START);
});

clause(FERO, "2:ability:flip-it", "only resources count for X and Y: characters, items, locations (mine and theirs) are ignored, face-down cards count", () => {
  // opp: 5 resources (4 greed + 1 face-down char) + char/item/loc; me: 4 banks + Ferocity = 5 + char/item
  const b = feroBoard(4, 6);
  feroFlip(b);
  assert.equal(influence(b.engine, P2), START - 1, "6 vs 5; the extra non-resource cards on both sides were ignored");
});

clause(FERO, "2:ability:flip-it", "'controls' counts control, not ownership: a resource the opponent owns but I control counts for Y only; one I own but they control for X only", () => {
  const b = feroBoard(4, 9, [
    { key: "stolen", def: printing(SMASH), owner: P2, zone: "play", faceDown: true, controller: P1 },
    { key: "lent", def: printing(SMASH), owner: P1, zone: "play", faceDown: true, controller: P2 }
  ]);
  feroFlip(b);
  // X = 9 + lent = 10; Y = 4 + Ferocity + stolen = 6
  assert.equal(influence(b.engine, P2), START - 4);
});

clause(FERO, "2:ability:flip-it", "Pay 4: exactly four resources are spent, then the Ferocity is face-up and ready", () => {
  const b = feroBoard(6, 9);
  assert.equal(ready(b.engine), 7);
  feroFlip(b);
  assert.equal(ready(b.engine), 3, "7 resources, 4 paid; the flipped Ferocity is one of the 3 left");
});

clause(FERO, "2:ability:flip-it", "is refused when 4 resources can't be paid even counting every other resource (2 banks), with nothing changed", () => {
  const b = feroBoard(2, 9);
  refused(() => feroFlip(b), "2 banks + itself is 3 < 4 under either reading", /costs cannot be paid/i);
  assert.equal(cardOf(b.engine, b.id("fe")).faceDown, true);
  assert.equal(influence(b.engine, P2), START);
  assert.equal(ready(b.engine), 3);
});

clause(FERO, "2:ability:flip-it", "rules question: the face-down Ferocity can help pay its own Pay 4 (3 banks + itself = 4)", () => {
  const b = feroBoard(3, 9);
  feroFlip(b);
  assert.equal(cardOf(b.engine, b.id("fe")).faceDown, false);
});

clause(FERO, "2:ability:flip-it", "4 other resources pay for it whichever way the self-pay question goes", () => {
  const b = feroBoard(4, 9);
  feroFlip(b);
  assert.equal(cardOf(b.engine, b.id("fe")).faceDown, false);
  assert.equal(ready(b.engine), 1, "5 resources, 4 paid, only the flipped Ferocity is left");
});

clause(FERO, "2:ability:flip-it", "needs [R]: nine non-Rage resources can't flip it, a single [R] among them can", () => {
  const b = buildGame({
    ...sides,
    cards: [{ key: "fe", def: printing(FERO), owner: P1, zone: "play", faceDown: true }, ...volition(6, P1), ...bank("greed", 3, P1), ...bank("greed", 6, P2)]
  });
  refused(() => feroFlip(b), "no [R] anywhere", /Ability threshold requirements are not met/);
  assert.equal(cardOf(b.engine, b.id("fe")).faceDown, true);
  assert.equal(influence(b.engine, P2), START);
  const ok = buildGame({
    ...sides,
    cards: [{ key: "fe", def: printing(FERO), owner: P1, zone: "play", faceDown: true }, ...volition(6, P1), ...bank("rage", 1, P1), ...bank("greed", 6, P2)]
  });
  feroFlip(ok);
  assert.equal(cardOf(ok.engine, ok.id("fe")).faceDown, false);
});

clause(FERO, "2:ability:flip-it", "usable only while it is a face-down resource: refused face-up in play and in hand", () => {
  const up = feroBoard(6, 9, [], { faceDown: false });
  refused(() => feroFlip(up), "face-up in play", /./);
  assert.equal(influence(up.engine, P2), START);
  assert.equal(ready(up.engine), 7);
  const hand = feroBoard(6, 9, [], { fero: "hand", faceDown: false });
  refused(() => feroFlip(hand), "in hand", /./);
  assert.equal(influence(hand.engine, P2), START);
  assert.equal(ready(hand.engine), 6);
});

clause(FERO, "2:ability:flip-it", "Reveal this card: the flip reveals the Ferocity", () => {
  const b = feroBoard(6, 9);
  feroFlip(b);
  const revealed = events(b.engine, "cardsRevealed").flatMap((e) => (e.cardIds as string[]) ?? []);
  assert.ok(revealed.includes(b.id("fe")), "the Ferocity was revealed as part of the cost");
});

clause(FERO, "2:ability:flip-it", "Put this card into play face-up: afterwards it is in play, face-up, under my control, and provides [R]", () => {
  const b = feroBoard(4, 9, [{ key: "c", def: rageChar(1), owner: P1, zone: "hand" }]);
  feroFlip(b);
  const fe = cardOf(b.engine, b.id("fe"));
  assert.deepEqual([fe.zone, fe.faceDown, fe.controllerId], ["play", false, P1]);
  play(b.engine, P1, b.id("c"));
  assert.equal(zoneOf(b.engine, b.id("c")), "play", "the flipped Ferocity's [R] pays the cost-1 [R] character");
});

clause(FERO, "2:ability:flip-it", "Pick a player: I may pick myself too (X = Y, so nothing is inflicted, but the Ferocity still flips and is paid for)", () => {
  const b = feroBoard(4, 9);
  feroFlip(b, P1);
  assert.equal(cardOf(b.engine, b.id("fe")).faceDown, false);
  assert.equal(influence(b.engine, P1), START);
  assert.equal(influence(b.engine, P2), START);
});

clause(FERO, "2:ability:flip-it", "exactly one player is picked: no pick, two picks, or a non-faction card are refused", () => {
  const b = feroBoard(6, 9);
  const f1 = factionOf(b.engine, P1);
  const f2 = factionOf(b.engine, P2);
  refused(() => activate(b.engine, P1, b.id("fe"), "flip-it"), "no pick", /requires 1 selection/);
  refused(() => activate(b.engine, P1, b.id("fe"), "flip-it", { selected: { fac: [f1, f2] } }), "two picks", /requires 1 selection/);
  refused(() => activate(b.engine, P1, b.id("fe"), "flip-it", { selected: { fac: [b.id("oChar")] } }), "a character", /Illegal target/);
  assert.equal(cardOf(b.engine, b.id("fe")).faceDown, true);
  assert.equal(ready(b.engine), 7, "nothing was paid by the refusals");
  feroFlip(b);
  assert.equal(cardOf(b.engine, b.id("fe")).faceDown, false, "control: a single faction pick works");
});

// ============================================================================
// Rapacious Soldier -- cannot block
// ============================================================================

function soldierBoard(extra: CardPlacement[] = []) {
  return buildGame({
    ...sides,
    cards: [
      { key: "sol", def: printing(RAPA), owner: P1, zone: "play" },
      { key: "def", def: character({ name: "Defender", life: 5 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 5 }), owner: P2, zone: "play" },
      ...extra
    ],
    turn: 2,
    activePlayerId: P2
  });
}

clause(RAPA, "0:rule", "this character cannot block: declaring it as a blocker is refused, alone or with others", () => {
  const b = soldierBoard();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  refused(() => declareBlockers(b.engine, P1, [b.id("sol")]), "the Soldier alone", /block/i);
  refused(() => declareBlockers(b.engine, P1, [b.id("def"), b.id("sol")]), "the Soldier together with a legal blocker", /block/i);
  declareBlockers(b.engine, P1, [b.id("def")]);
  assert.equal(pending(b.engine), undefined, "control: another character can block");
});

clause(RAPA, "0:rule", "the restriction is on the Soldier alone: another character blocks and takes the damage, the Soldier is untouched", () => {
  const b = soldierBoard();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("def")]);
  assert.ok(b.engine.getRestrictions(b.id("sol")).includes("cannotBlock"), "b.engine.getRestrictions(b.id(\"sol\")).includes(\"cannotBlock\")");
  assert.equal(b.engine.getRestrictions(b.id("def")).includes("cannotBlock"), false);
  assert.equal(b.engine.getRestrictions(b.id("atk")).includes("cannotBlock"), false);
});

clause(RAPA, "0:rule", "it can still attack", () => {
  const b = buildGame({
    ...sides,
    cards: [
      { key: "sol", def: printing(RAPA), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("sol")]);
  assert.ok(b.engine.state.battle, "the Soldier's attack started a battle");
});

clause(RAPA, "0:rule", "the opponent's own Rapacious Soldier is restricted the same, and a Soldier in hand has no restriction to speak of", () => {
  const b = buildGame({
    ...sides,
    cards: [
      { key: "sol", def: printing(RAPA), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 5 }), owner: P1, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("sol")]), "an opposing Soldier cannot block either", /block/i);
});

// ============================================================================
// Rudo Mangod, Holder of Light
// ============================================================================

const gear = () => item({ name: "Gear", subtype: ["gear"] });

function rudoBoard(extra: CardPlacement[] = [], over: Partial<CardPlacement> = {}) {
  return buildGame({
    ...sides,
    cards: [
      { key: "rudo", def: printing(RUDO), owner: P1, zone: "play", ...over },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
      ...extra
    ]
  });
}

clause(RUDO, "0:unique", "deploying a second Rudo while controlling one makes me choose: keeping the new one destroys the old one", () => {
  const b = buildGame({ ...sides, cards: [{ key: "r1", def: printing(RUDO), owner: P1, zone: "play" }, { key: "r2", def: printing(RUDO), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)] });
  play(b.engine, P1, b.id("r2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("r1"), b.id("r2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("r2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("r2")), "play");
  assert.equal(zoneOf(b.engine, b.id("r1")), "discard");
  assert.equal(pending(b.engine), undefined);
});

clause(RUDO, "0:unique", "keeping the old one destroys the new one", () => {
  const b = buildGame({ ...sides, cards: [{ key: "r1", def: printing(RUDO), owner: P1, zone: "play" }, { key: "r2", def: printing(RUDO), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)] });
  play(b.engine, P1, b.id("r2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("r1") } } as never);
  assert.equal(zoneOf(b.engine, b.id("r1")), "play");
  assert.equal(zoneOf(b.engine, b.id("r2")), "discard");
  assert.equal(pending(b.engine), undefined);
});

clause(RUDO, "0:unique", "the designation is RUDOLPHUS: another card carrying it conflicts; a different designation or no designation does not", () => {
  const other = (unique: string | undefined) =>
    buildGame({
      ...sides,
      cards: [
        { key: "r1", def: printing(RUDO), owner: P1, zone: "play" },
        { key: "o", def: character({ name: "Other", cost: 0, ...(unique ? { unique } : {}) }), owner: P1, zone: "hand" }
      ]
    });
  const same = other("rudolphus");
  play(same.engine, P1, same.id("o"));
  assert.equal(pending(same.engine)?.kind, "uniqueSurvivor");
  const diff = other("dacian");
  play(diff.engine, P1, diff.id("o"));
  assert.equal(pending(diff.engine), undefined);
  assert.equal(zoneOf(diff.engine, diff.id("o")), "play");
  const none = other(undefined);
  play(none.engine, P1, none.id("o"));
  assert.equal(pending(none.engine), undefined);
  assert.equal(zoneOf(none.engine, none.id("o")), "play");
});

clause(RUDO, "0:unique", "UNIQUE is per player: the opponent controlling their own Rudo causes no choice", () => {
  const b = buildGame({ ...sides, cards: [{ key: "r1", def: printing(RUDO), owner: P2, zone: "play" }, { key: "r2", def: printing(RUDO), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)] });
  play(b.engine, P1, b.id("r2"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("r1")), "play");
  assert.equal(zoneOf(b.engine, b.id("r2")), "play");
});

clause(RUDO, "1:rule", "while restored, all characters I control (Rudo included) gain exactly +1 strength and +1 life, not speed", () => {
  const b = rudoBoard();
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("ally"), "speed"), 2);
  assert.equal(b.engine.getStat(b.id("rudo"), "strength"), 2, "printed 1 + 1");
  assert.equal(b.engine.getStat(b.id("rudo"), "life"), 4, "printed 3 + 1");
  assert.equal(b.engine.getStat(b.id("rudo"), "speed"), 3);
});

clause(RUDO, "1:rule", "opponent's characters are not affected, but an opponent-owned character I control is", () => {
  const b = rudoBoard([{ key: "turncoat", def: character({ name: "Turncoat", strength: 2, life: 2 }), owner: P2, zone: "play", controller: P1 }]);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 2);
  assert.equal(b.engine.getStat(b.id("turncoat"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("turncoat"), "life"), 3);
});

clause(RUDO, "1:rule", "only while restored: when depleted the bonus is off (for everyone including Rudo), and it comes back when restored", () => {
  const b = rudoBoard();
  b.engine.state.cards[b.id("rudo")].depleted = true;
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 2);
  assert.equal(b.engine.getStat(b.id("rudo"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("rudo"), "life"), 3);
  b.engine.state.cards[b.id("rudo")].depleted = false;
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("rudo"), "life"), 4);
});

clause(RUDO, "1:rule", "a depleted Rudo from the start (e.g. he just fought) gives nothing; a character entering later is covered while he is restored", () => {
  const b = rudoBoard([{ key: "late", def: character({ name: "Late", cost: 0, strength: 1, life: 1 }), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("late"));
  assert.equal(zoneOf(b.engine, b.id("late")), "play");
  assert.equal(b.engine.getStat(b.id("late"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("late"), "life"), 2);
  const d = rudoBoard([], { depleted: true });
  assert.equal(d.engine.getStat(d.id("ally"), "strength"), 2);
});

clause(RUDO, "1:rule", "off again once Rudo leaves play", () => {
  const b = rudoBoard([{ key: "k", def: killTactic(), owner: P1, zone: "hand" }]);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 3);
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("k"), selected: { t: [b.id("rudo")] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("rudo")), "discard");
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("ally"), "life"), 2);
});

clause(RUDO, "2:rule", "at the start of the opponent's turn, a depleted Rudo with a 'gear' card attached is restored", () => {
  const b = rudoBoard([{ key: "g", def: gear(), owner: P1, zone: "play", attachedToKey: "rudo" }], { depleted: true });
  assert.equal(b.engine.state.cards[b.id("rudo")].depleted, true);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.cards[b.id("rudo")].depleted, false, "restored on the opponent's turn start");
});

clause(RUDO, "2:rule", "no gear attached: Rudo stays depleted through the opponent's turn start", () => {
  const b = rudoBoard([], { depleted: true });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.cards[b.id("rudo")].depleted, true);
});

clause(RUDO, "2:rule", "a non-gear card attached does not count, and gear attached to another character does not count", () => {
  const nonGear = rudoBoard([{ key: "g", def: item({ name: "Hat", subtype: ["hat"] }), owner: P1, zone: "play", attachedToKey: "rudo" }], { depleted: true });
  endTurn(nonGear.engine, P1);
  assert.equal(nonGear.engine.state.cards[nonGear.id("rudo")].depleted, true, "attached card is not gear");
  const elsewhere = rudoBoard([{ key: "g", def: gear(), owner: P1, zone: "play", attachedToKey: "ally" }], { depleted: true });
  endTurn(elsewhere.engine, P1);
  assert.equal(elsewhere.engine.state.cards[elsewhere.id("rudo")].depleted, true, "gear is attached to Ally, not Rudo");
  const unattached = rudoBoard([{ key: "g", def: gear(), owner: P1, zone: "play" }], { depleted: true });
  endTurn(unattached.engine, P1);
  assert.equal(unattached.engine.state.cards[unattached.id("rudo")].depleted, true, "gear in play but not attached");
});

clause(RUDO, "2:rule", "gear attached to an opponent-controlled Rudo restores it at the start of my turn too (any turn)", () => {
  const b = buildGame({
    ...sides,
    cards: [
      { key: "rudo", def: printing(RUDO), owner: P2, zone: "play", depleted: true },
      { key: "g", def: gear(), owner: P2, zone: "play", attachedToKey: "rudo" },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" }
    ]
  });
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.cards[b.id("rudo")].depleted, false);
});

// ============================================================================
// Skilled Bannerman -- character cost 4 [R], PROVIDES [R]
// ============================================================================

const bannerBoard = (zone: "play" | "hand", charThreshold: string, others: CardPlacement[] = []) =>
  buildGame({
    ...sides,
    cards: [
      { key: "sb", def: printing(BANNER), owner: P1, zone },
      { key: "c", def: character({ name: `C-${charThreshold}`, cost: 1, threshold: charThreshold as never }), owner: P1, zone: "hand" },
      ...others
    ]
  });

// CR 311.1: a card that "provides" icons only helps meet thresholds; it is not itself a resource that pays costs.
clause(BANNER, "0:provides", "in play it provides an [R] icon: a cost-1 [R] character is playable when the other resource is not Rage (the Bannerman meets the threshold)", () => {
  const b = bannerBoard("play", "r", bank("greed", 1, P1));
  play(b.engine, P1, b.id("c"));
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(ready(b.engine), 0, "the Greed bank paid");
});

clause(BANNER, "0:provides", "control: with the Bannerman in hand the same board is refused (no [R] icon)", () => {
  const b = bannerBoard("hand", "r", bank("greed", 1, P1));
  refused(() => play(b.engine, P1, b.id("c")), "no [R] icon anywhere", /Threshold requirements are not met/);
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
});

clause(BANNER, "0:provides", "it provides [R] and nothing else: a [E] threshold is still refused", () => {
  const b = bannerBoard("play", "e", bank("greed", 1, P1));
  refused(() => play(b.engine, P1, b.id("c")), "no [E] icon", /Threshold requirements are not met/);
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
});

clause(BANNER, "0:provides", "it provides exactly ONE [R]: [R][R] needs one more Rage icon (Greed bank refused, Rage bank accepted)", () => {
  const no = bannerBoard("play", "rr", bank("greed", 1, P1));
  refused(() => play(no.engine, P1, no.id("c")), "only one [R] icon", /Threshold requirements are not met/);
  const yes = bannerBoard("play", "rr", bank("rage", 1, P1));
  play(yes.engine, P1, yes.id("c"));
  assert.equal(zoneOf(yes.engine, yes.id("c")), "play");
});

clause(BANNER, "0:provides", "the icon helps meet thresholds only: the Bannerman alone cannot pay a cost (no resources to spend)", () => {
  const b = bannerBoard("play", "r");
  assert.equal(ready(b.engine), 0);
  refused(() => play(b.engine, P1, b.id("c")), "nothing to pay with", /Costs cannot be paid/);
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
  assert.equal(cardOf(b.engine, b.id("sb")).depleted, false);
});

// ============================================================================
// Some Crazy Ornery Unfriendly Thug -- vanilla, cost 5 [RRRR], 5/4/5
// ============================================================================

const thugBoard = (cards: CardPlacement[]) => buildGame({ ...sides, cards: [{ key: "t", def: printing(THUG), owner: P1, zone: "hand" }, ...cards] });

clause(THUG, "vanilla", "deploys for its printed cost 5 with [RRRR]: six Rage banks pay exactly 5, one is left", () => {
  const b = thugBoard(bank("rage", 6, P1));
  play(b.engine, P1, b.id("t"));
  assert.equal(zoneOf(b.engine, b.id("t")), "play");
  assert.equal(ready(b.engine), 1);
  const exact = thugBoard(bank("rage", 5, P1));
  play(exact.engine, P1, exact.id("t"));
  assert.equal(zoneOf(exact.engine, exact.id("t")), "play");
  assert.equal(ready(exact.engine), 0);
});

clause(THUG, "vanilla", "refused one resource short of the cost (4 Rage banks)", () => {
  const b = thugBoard(bank("rage", 4, P1));
  refused(() => play(b.engine, P1, b.id("t")), "4 resources for a cost of 5", /Costs cannot be paid/);
  assert.equal(zoneOf(b.engine, b.id("t")), "hand");
  assert.equal(ready(b.engine), 4);
});

clause(THUG, "vanilla", "refused with enough resources but only three [R]", () => {
  const b = thugBoard([...bank("rage", 3, P1), ...bank("greed", 3, P1)]);
  refused(() => play(b.engine, P1, b.id("t")), "[RRRR] needs four Rage", /Threshold requirements are not met/);
  assert.equal(zoneOf(b.engine, b.id("t")), "hand");
  assert.equal(ready(b.engine), 6);
});

clause(THUG, "vanilla", "printed stats 5 strength / 4 speed / 5 life, no keywords, restrictions or abilities", () => {
  const b = thugBoard(bank("rage", 5, P1));
  play(b.engine, P1, b.id("t"));
  assert.equal(b.engine.getStat(b.id("t"), "strength"), 5);
  assert.equal(b.engine.getStat(b.id("t"), "speed"), 4);
  assert.equal(b.engine.getStat(b.id("t"), "life"), 5);
  assert.deepEqual(b.engine.getKeywords(b.id("t")), []);
  assert.equal(b.engine.getRestrictions(b.id("t")).length, 0);
  assert.equal(b.engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === b.id("t")).length, 0);
  assert.equal(pending(b.engine), undefined);
});

// ============================================================================
// Special Forces -- UNDERCOVERT OPERATIONS: Pay 3. This turn, gains COVERT and loses 1 life.
// ============================================================================

function forcesBoard(banks: number, over: Partial<CardPlacement> = {}, extra: CardPlacement[] = []) {
  return buildGame({
    ...sides,
    cards: [
      { key: "sf", def: printing(FORCES), owner: P1, zone: "play", ...over },
      ...bank("rage", banks, P1),
      { key: "blk", def: character({ name: "Plain Blocker", life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...extra
    ]
  });
}
const undercover = (b: ReturnType<typeof forcesBoard>) => activate(b.engine, P1, b.id("sf"), "undercovert-operations");

clause(FORCES, "0:ability:undercovert-operations", "Pay 3: exactly three resources are spent", () => {
  const b = forcesBoard(6);
  undercover(b);
  assert.equal(ready(b.engine), 3);
});

clause(FORCES, "0:ability:undercovert-operations", "refused with only two resources; works with exactly three", () => {
  const short = forcesBoard(2);
  refused(() => undercover(short), "cost 3 with 2 resources", /costs cannot be paid/i);
  assert.equal(short.engine.getKeywords(short.id("sf")).includes("covert"), false);
  assert.equal(short.engine.getStat(short.id("sf"), "life"), 3);
  assert.equal(ready(short.engine), 2);
  const exact = forcesBoard(3);
  undercover(exact);
  assert.equal(ready(exact.engine), 0);
  assert.ok(exact.engine.getKeywords(exact.id("sf")).includes("covert"), "exact.engine.getKeywords(exact.id(\"sf\")).includes(\"covert\")");
});

clause(FORCES, "0:ability:undercovert-operations", "effect: it gains COVERT and its life drops by exactly 1; strength and speed are unchanged", () => {
  const b = forcesBoard(3);
  assert.equal(b.engine.getKeywords(b.id("sf")).includes("covert"), false);
  undercover(b);
  assert.ok(b.engine.getKeywords(b.id("sf")).includes("covert"), "b.engine.getKeywords(b.id(\"sf\")).includes(\"covert\")");
  assert.equal(b.engine.getStat(b.id("sf"), "life"), 2);
  assert.equal(b.engine.getStat(b.id("sf"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("sf"), "speed"), 2);
});

clause(FORCES, "0:ability:undercovert-operations", "it is the Special Forces itself that is affected, not another character", () => {
  const b = forcesBoard(3, {}, [{ key: "mate", def: character({ name: "Mate", life: 3 }), owner: P1, zone: "play" }]);
  undercover(b);
  assert.equal(b.engine.getKeywords(b.id("mate")).includes("covert"), false);
  assert.equal(b.engine.getStat(b.id("mate"), "life"), 3);
});

clause(FORCES, "0:ability:undercovert-operations", "COVERT works: the attack cannot be blocked by a non-COVERT character (and can without the ability)", () => {
  const plain = forcesBoard(0);
  declareAttackBy(plain.engine, P1, [plain.id("sf")]);
  declareBlockers(plain.engine, P2, [plain.id("blk")]);
  assert.equal(pending(plain.engine), undefined, "control: without the ability a plain character may block");
  const b = forcesBoard(3);
  undercover(b);
  declareAttackBy(b.engine, P1, [b.id("sf")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("blk")]), "a non-COVERT blocker against a COVERT attacker", /covert/i);
});

clause(FORCES, "0:ability:undercovert-operations", "COVERT works the other way too: a COVERT character can block it", () => {
  const b = forcesBoard(3, {}, [{ key: "cb", def: character({ name: "CovertBlocker", life: 9, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }]);
  undercover(b);
  declareAttackBy(b.engine, P1, [b.id("sf")]);
  declareBlockers(b.engine, P2, [b.id("cb")]);
  assert.equal(pending(b.engine), undefined);
});

clause(FORCES, "0:ability:undercovert-operations", "'this turn': COVERT and the life loss are gone once the turn ends, and stay gone", () => {
  const b = forcesBoard(3);
  undercover(b);
  assert.equal(b.engine.getStat(b.id("sf"), "life"), 2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.getKeywords(b.id("sf")).includes("covert"), false);
  assert.equal(b.engine.getStat(b.id("sf"), "life"), 3);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.getKeywords(b.id("sf")).includes("covert"), false);
  assert.equal(b.engine.getStat(b.id("sf"), "life"), 3);
});

clause(FORCES, "0:ability:undercovert-operations", "using it twice costs 3 each time and loses 2 life in total (COVERT just once)", () => {
  const b = forcesBoard(6);
  undercover(b);
  undercover(b);
  assert.equal(ready(b.engine), 0);
  assert.equal(b.engine.getStat(b.id("sf"), "life"), 1);
  assert.equal(b.engine.getKeywords(b.id("sf")).filter((k) => k === "covert").length <= 1, true);
});

clause(FORCES, "0:ability:undercovert-operations", "usable while depleted (the cost is only Pay 3)", () => {
  const b = forcesBoard(3, { depleted: true });
  undercover(b);
  assert.ok(b.engine.getKeywords(b.id("sf")).includes("covert"), "b.engine.getKeywords(b.id(\"sf\")).includes(\"covert\")");
  assert.equal(ready(b.engine), 0);
});

clause(FORCES, "0:ability:undercovert-operations", "losing 1 life can finish it off: with 2 damage on a 3-life character, life 2 means it is destroyed", () => {
  const b = forcesBoard(3, { damage: 2 });
  undercover(b);
  assert.equal(zoneOf(b.engine, b.id("sf")), "discard");
});

clause(FORCES, "0:ability:undercovert-operations", "with 1 damage it survives at life 2", () => {
  const b = forcesBoard(3, { damage: 1 });
  undercover(b);
  assert.equal(zoneOf(b.engine, b.id("sf")), "play");
  assert.equal(b.engine.getStat(b.id("sf"), "life"), 2);
});

// ============================================================================
// Stern But Fair Backhand -- tactic, cost 4 [RR]
// ============================================================================

function backhandBoard(opts: { rage?: number; greed?: number } = {}, extra: CardPlacement[] = []) {
  return buildGame({
    ...sides,
    cards: [
      { key: "sbfb", def: printing(BACKHAND), owner: P1, zone: "hand" },
      { key: "opp", def: killTactic({ name: "OppTactic" }), owner: P2, zone: "hand" },
      { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P1, zone: "play" },
      ...bank("rage", opts.rage ?? 6, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...extra
    ],
    activePlayerId: P2,
    turn: 2
  });
}
const castOpp = (b: ReturnType<typeof backhandBoard>) =>
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("opp"), selected: { t: [b.id("victim")] } } as never);
const castBackhand = (b: ReturnType<typeof backhandBoard>, p: PlayerId = P1, key = "sbfb") =>
  b.engine.perform({ type: "playCard", playerId: p, cardId: b.id(key), selected: {} } as never);

clause(BACKHAND, "0:rule", "deployed in response to a tactic, it terminates that tactic: the tactic's effect never happens", () => {
  const b = backhandBoard();
  castOpp(b);
  castBackhand(b);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("victim")), "play", "the Kill tactic was terminated");
  assert.equal(zoneOf(b.engine, b.id("opp")), "discard");
});

clause(BACKHAND, "0:rule", "control: without Backhand the same tactic does kill (so the termination above is Backhand's doing)", () => {
  const b = backhandBoard();
  castOpp(b);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("victim")), "discard");
});

clause(BACKHAND, "0:rule", "it enters play under its owner's control as a face-down resource instead of the discard pile", () => {
  const b = backhandBoard();
  castOpp(b);
  castBackhand(b);
  resolvePendingResponses(b.engine);
  const c = cardOf(b.engine, b.id("sbfb"));
  assert.deepEqual([c.zone, c.faceDown, c.controllerId, c.ownerId], ["play", true, P1, P1]);
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("sbfb")), false);
  assert.equal(ready(b.engine), 3, "6 banks, 4 paid, plus the new face-down resource");
});

clause(BACKHAND, "0:rule", "the resource really is a Volition resource: it alone pays for a cost-1 [V] character afterwards", () => {
  const vChar = character({ name: "VChar", cost: 1, threshold: "v" as never });
  const b = buildGame({
    ...sides,
    cards: [
      { key: "sbfb", def: printing(BACKHAND), owner: P1, zone: "hand" },
      { key: "vc", def: vChar, owner: P1, zone: "hand" },
      ...bank("rage", 4, P1)
    ]
  });
  play(b.engine, P1, b.id("sbfb"));
  assert.equal(ready(b.engine), 1);
  play(b.engine, P1, b.id("vc"));
  assert.equal(zoneOf(b.engine, b.id("vc")), "play");
});

clause(BACKHAND, "0:rule", "not in response to a tactic: nothing is terminated, but it still becomes a face-down resource instead of going to the discard pile", () => {
  const b = buildGame({
    ...sides,
    cards: [
      { key: "sbfb", def: printing(BACKHAND), owner: P1, zone: "hand" },
      { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P1, zone: "play" },
      ...bank("rage", 6, P1)
    ]
  });
  play(b.engine, P1, b.id("sbfb"));
  const c = cardOf(b.engine, b.id("sbfb"));
  assert.deepEqual([c.zone, c.faceDown, c.controllerId], ["play", true, P1]);
  assert.equal(b.engine.state.players[P1].discard.includes(b.id("sbfb")), false);
  assert.equal(zoneOf(b.engine, b.id("victim")), "play");
  assert.equal(ready(b.engine), 3);
});

clause(BACKHAND, "0:rule", "in response to something that is not a tactic (a character being deployed) nothing is terminated: the character enters play", () => {
  const b = buildGame({
    ...sides,
    cards: [
      { key: "sbfb", def: printing(BACKHAND), owner: P1, zone: "hand" },
      { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P2, zone: "hand" },
      ...bank("rage", 6, P1)
    ],
    activePlayerId: P2,
    turn: 2
  });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("newbie"), selected: {} } as never);
  castBackhand(b);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("newbie")), "play", "the deployed character was not terminated");
  const c = cardOf(b.engine, b.id("sbfb"));
  assert.deepEqual([c.zone, c.faceDown], ["play", true]);
});

clause(BACKHAND, "0:rule", "in response to an ability (not a tactic) nothing is terminated: the ability still resolves", () => {
  const zapper = character({
    name: "Zapper",
    behavior: { abilities: [{ id: "zap", type: "activated", targets: [{ id: "t", selector: { controller: "opponent", zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const b = buildGame({
    ...sides,
    cards: [
      { key: "sbfb", def: printing(BACKHAND), owner: P1, zone: "hand" },
      { key: "zap", def: zapper, owner: P2, zone: "play" },
      { key: "victim", def: character({ name: "Victim", life: 5 }), owner: P1, zone: "play" },
      ...bank("rage", 6, P1)
    ],
    activePlayerId: P2,
    turn: 2
  });
  b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("zap"), abilityId: "zap", selected: { t: [b.id("victim")] } } as never);
  castBackhand(b);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("victim")), "discard", "the ability still resolved");
  assert.equal(cardOf(b.engine, b.id("sbfb")).faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("sbfb")), "play");
});

clause(BACKHAND, "0:rule", "it terminates the tactic it responds to and no other: a Backhand answering the top of a two-tactic stack leaves the lower one to resolve", () => {
  const b = buildGame({
    ...sides,
    cards: [
      { key: "bh", def: printing(BACKHAND), owner: P2, zone: "hand" },
      { key: "a", def: killTactic({ name: "TacticA" }), owner: P2, zone: "hand" },
      { key: "bt", def: killTactic({ name: "TacticB" }), owner: P1, zone: "hand" },
      { key: "v1", def: character({ name: "V1", life: 5 }), owner: P1, zone: "play" },
      { key: "w", def: character({ name: "W", life: 5 }), owner: P2, zone: "play" },
      ...bank("rage", 6, P2)
    ],
    activePlayerId: P2,
    turn: 2
  });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("a"), selected: { t: [b.id("v1")] } } as never);
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("bt"), selected: { t: [b.id("w")] } } as never);
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("bh"), selected: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("w")), "play", "tactic B was terminated");
  assert.equal(zoneOf(b.engine, b.id("v1")), "discard", "tactic A was not");
  const c = cardOf(b.engine, b.id("bh"));
  assert.deepEqual([c.zone, c.faceDown, c.controllerId], ["play", true, P2]);
});

clause(BACKHAND, "0:rule", "refused one resource short of cost 4, and without [RR]", () => {
  const short = backhandBoard({ rage: 3 });
  castOpp(short);
  refused(() => castBackhand(short), "3 resources for a cost of 4", /Costs cannot be paid/);
  const noRage = backhandBoard({ rage: 1, greed: 5 });
  castOpp(noRage);
  refused(() => castBackhand(noRage), "only one [R]", /Threshold requirements are not met/);
  const exact = backhandBoard({ rage: 2, greed: 2 });
  castOpp(exact);
  castBackhand(exact);
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("victim")), "play", "control: [RR] and four resources works");
});

// ============================================================================
// Suicide Smash -- tactic, cost 1 [RR]; extra cost pick/destroy a character, pick a location; FLIP UP 3 [R]
// ============================================================================

type SmashOpts = { bombStr?: number; vol?: number; rage?: number; locStruct?: number; locDamage?: number; deck?: number; oppVol?: number };
function smashBoard(o: SmashOpts = {}, extra: CardPlacement[] = []) {
  return buildGame({
    ...sides,
    cards: [
      { key: "ss", def: printing(SMASH), owner: P1, zone: "hand" },
      { key: "bomb", def: character({ name: "Bomb", strength: o.bombStr ?? 4, life: 2 }), owner: P1, zone: "play" },
      { key: "foeChar", def: character({ name: "FoeChar", strength: 4, life: 2 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: o.locStruct ?? 5 }), owner: P2, zone: "play", ...(o.locDamage ? { damage: o.locDamage } : {}) },
      { key: "myLoc", def: location({ name: "MyLoc", structure: 5 }), owner: P1, zone: "play" },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "goneLoc", def: location({ name: "GoneLoc", structure: 5 }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 3, P1),
      ...volition(o.vol ?? 0, P1),
      ...volition(o.oppVol ?? 0, P2),
      ...fillDeck(P1, o.deck ?? 5),
      ...extra
    ]
  });
}
type SB = ReturnType<typeof smashBoard>;
const smash = (b: SB, sac = "bomb", loc = "loc") => play(b.engine, P1, b.id("ss"), { selected: { sac: [b.id(sac)], loc: [b.id(loc)] } });
const smashed = (b: SB, sac = "bomb", loc = "loc") => {
  smash(b, sac, loc);
  assert.equal(pending(b.engine), undefined);
};

clause(SMASH, "0:extraCost", "Pick a character you control, X is its strength, destroy it: the character goes to the discard pile and X damage is inflicted to the location (strength 4 -> 4 damage)", () => {
  const b = smashBoard();
  smashed(b);
  assert.equal(zoneOf(b.engine, b.id("bomb")), "discard");
  assert.equal(cardOf(b.engine, b.id("loc")).damage, 4);
  assert.equal(zoneOf(b.engine, b.id("loc")), "play");
});

clause(SMASH, "0:extraCost", "X follows the character's strength: strength 2 inflicts 2, strength 3 inflicts 3", () => {
  const two = smashBoard({ bombStr: 2 });
  smashed(two);
  assert.equal(cardOf(two.engine, two.id("loc")).damage, 2);
  const three = smashBoard({ bombStr: 3 });
  smashed(three);
  assert.equal(cardOf(three.engine, three.id("loc")).damage, 3);
});

clause(SMASH, "0:extraCost", "X is its current strength, boosted strength included", () => {
  const b = smashBoard({ bombStr: 2 }, [{ key: "rudo", def: printing(RUDO), owner: P1, zone: "play" }]);
  assert.equal(b.engine.getStat(b.id("bomb"), "strength"), 3);
  smashed(b);
  assert.equal(cardOf(b.engine, b.id("loc")).damage, 3);
});

clause(SMASH, "0:extraCost", "the sacrifice is paid up front: the character is already destroyed while Smash waits on the stack", () => {
  const b = smashBoard();
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("ss"), selected: { sac: [b.id("bomb")], loc: [b.id("loc")] } } as never);
  assert.equal(zoneOf(b.engine, b.id("bomb")), "discard", "extra cost already paid");
  assert.equal(cardOf(b.engine, b.id("loc")).damage ?? 0, 0, "the effect has not resolved yet");
});

clause(SMASH, "0:extraCost", "the character must be one I control: the opponent's character, my item, my location, no pick and two picks are refused", () => {
  const b = smashBoard({}, [{ key: "bomb2", def: character({ name: "Bomb2", strength: 3 }), owner: P1, zone: "play" }]);
  const tryIt = (sacs: string[]) => () => play(b.engine, P1, b.id("ss"), { selected: { sac: sacs.map((k) => b.id(k)), loc: [b.id("loc")] } });
  refused(tryIt(["foeChar"]), "opponent's character", /Illegal target/);
  refused(tryIt(["myItem"]), "my item", /Illegal target/);
  refused(tryIt(["myLoc"]), "my location", /Illegal target/);
  refused(tryIt([]), "no pick", /requires 1 selection/);
  refused(tryIt(["bomb", "bomb2"]), "two picks", /requires 1 selection/);
  assert.equal(zoneOf(b.engine, b.id("foeChar")), "play");
  assert.equal(zoneOf(b.engine, b.id("bomb")), "play");
  assert.equal(zoneOf(b.engine, b.id("ss")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was paid by the refusals");
  tryIt(["bomb"])();
  assert.equal(zoneOf(b.engine, b.id("bomb")), "discard", "control: my own character works");
});

clause(SMASH, "0:extraCost", "a character I control but the opponent owns can be the sacrifice", () => {
  const b = smashBoard({}, [{ key: "borrowed", def: character({ name: "Borrowed", strength: 3 }), owner: P2, zone: "play", controller: P1 }]);
  smashed(b, "borrowed");
  assert.equal(zoneOf(b.engine, b.id("borrowed")), "discard");
  assert.equal(cardOf(b.engine, b.id("loc")).damage, 3);
});

clause(SMASH, "0:extraCost", "Pick a location: any location in play works (mine or theirs); a character, an item, a location in a discard pile, no pick or two picks are refused", () => {
  const b = smashBoard();
  const tryLoc = (locs: string[]) => () => play(b.engine, P1, b.id("ss"), { selected: { sac: [b.id("bomb")], loc: locs.map((k) => b.id(k)) } });
  refused(tryLoc(["foeChar"]), "a character", /Illegal target/);
  refused(tryLoc(["myItem"]), "an item", /Illegal target/);
  refused(tryLoc(["goneLoc"]), "a location in the discard pile", /Illegal target/);
  refused(tryLoc([]), "no location", /requires 1 selection/);
  refused(tryLoc(["loc", "myLoc"]), "two locations", /requires 1 selection/);
  assert.equal(zoneOf(b.engine, b.id("bomb")), "play", "nothing was paid");
  tryLoc(["myLoc"])();
  drainAll(b);
  assert.equal(cardOf(b.engine, b.id("myLoc")).damage, 4, "control: my own location works too");
  assert.equal(cardOf(b.engine, b.id("loc")).damage ?? 0, 0);
});

function drainAll(b: SB): void {
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
}

clause(SMASH, "1:rule", "with [V][V][V] it inflicts 3 damage to the opponent's faction (not mine)", () => {
  const b = smashBoard({ vol: 3 });
  smashed(b);
  assert.equal(influence(b.engine, P2), START - 3);
  assert.equal(influence(b.engine, P1), START);
});

clause(SMASH, "1:rule", "with only [V][V] there is no faction damage", () => {
  const b = smashBoard({ vol: 2 });
  smashed(b);
  assert.equal(influence(b.engine, P2), START);
  assert.equal(influence(b.engine, P1), START);
  assert.equal(cardOf(b.engine, b.id("loc")).damage, 4, "the location damage still happens");
});

clause(SMASH, "1:rule", "other resources are not Volition: three Rage banks plus two Volition is still not [V][V][V]", () => {
  const b = smashBoard({ vol: 2, rage: 6 });
  smashed(b);
  assert.equal(influence(b.engine, P2), START);
});

clause(SMASH, "1:rule", "the opponent's Volition does not count for me", () => {
  const b = smashBoard({ vol: 2, oppVol: 4 });
  smashed(b);
  assert.equal(influence(b.engine, P2), START);
});

clause(SMASH, "1:rule", "more than three [V] still inflicts exactly 3", () => {
  const b = smashBoard({ vol: 5 });
  smashed(b);
  assert.equal(influence(b.engine, P2), START - 3);
});

clause(SMASH, "1:rule", "the faction damage is independent of the location: it is dealt when the location survives and when it dies", () => {
  const survives = smashBoard({ vol: 3, bombStr: 2 });
  smashed(survives);
  assert.equal(influence(survives.engine, P2), START - 3);
  assert.equal(zoneOf(survives.engine, survives.id("loc")), "play");
  const dies = smashBoard({ vol: 3, bombStr: 5 });
  smashed(dies);
  assert.equal(influence(dies.engine, P2), START - 3);
  assert.equal(zoneOf(dies.engine, dies.id("loc")), "discard");
});

clause(SMASH, "1:rule", "X damage to the location without destroying it: no card is drawn", () => {
  const b = smashBoard({ bombStr: 4, locStruct: 5 });
  smashed(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "play");
  assert.equal(handOf(b.engine, P1).length, 0, "Smash left the hand, nothing drawn");
});

clause(SMASH, "1:rule", "damage equal to the structure destroys the location and draws exactly one card (the top of my deck)", () => {
  const b = smashBoard({ bombStr: 5, locStruct: 5 });
  const top = b.engine.state.players[P1].deck[0];
  smashed(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
  assert.deepEqual(handOf(b.engine, P1), [top]);
  assert.equal(b.engine.state.players[P1].deck.length, 4);
});

clause(SMASH, "1:rule", "damage above the structure also destroys it and still draws just one card", () => {
  const b = smashBoard({ bombStr: 7, locStruct: 5 });
  smashed(b);
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
  assert.equal(handOf(b.engine, P1).length, 1);
});

clause(SMASH, "1:rule", "earlier damage counts: structure 5 with 3 damage, X = 2 destroys it and draws a card; X = 1 does not", () => {
  const kills = smashBoard({ bombStr: 2, locDamage: 3 });
  smashed(kills);
  assert.equal(zoneOf(kills.engine, kills.id("loc")), "discard");
  assert.equal(handOf(kills.engine, P1).length, 1);
  const short = smashBoard({ bombStr: 1, locDamage: 3 });
  smashed(short);
  assert.equal(zoneOf(short.engine, short.id("loc")), "play");
  assert.equal(handOf(short.engine, P1).length, 0);
});

clause(SMASH, "1:rule", "my own location destroyed by the damage also draws me a card", () => {
  const b = smashBoard({ bombStr: 5 });
  smashed(b, "bomb", "myLoc");
  assert.equal(zoneOf(b.engine, b.id("myLoc")), "discard");
  assert.equal(handOf(b.engine, P1).length, 1);
});

clause(SMASH, "1:rule", "the Smash itself goes to the discard pile after resolving, and costs 1 resource", () => {
  const b = smashBoard();
  smashed(b);
  assert.equal(zoneOf(b.engine, b.id("ss")), "discard");
  assert.equal(ready(b.engine), 2, "3 banks, 1 paid");
});

clause(SMASH, "1:rule", "cost 1 needs [RR]: refused with no resources, and with one Rage plus other resources; works with exactly [RR]", () => {
  const none = smashBoard({ rage: 0 });
  refused(() => smash(none), "no resources", /Threshold requirements are not met/);
  const oneR = smashBoard({ rage: 1, vol: 4 });
  refused(() => smash(oneR), "one [R] only", /Threshold requirements are not met/);
  assert.equal(zoneOf(oneR.engine, oneR.id("bomb")), "play", "nothing was destroyed");
  const exact = smashBoard({ rage: 2 });
  smashed(exact);
  assert.equal(ready(exact.engine), 1);
});

// FLIP UP: 3 [R]
const downSmash = (o: { rage?: number; greed?: number; oppAttack?: boolean } = {}) =>
  buildGame({
    ...sides,
    cards: [
      { key: "ss", def: printing(SMASH), owner: P1, zone: "play", faceDown: true },
      { key: "bomb", def: character({ name: "Bomb", strength: 5, life: 2 }), owner: P1, zone: "play" },
      { key: "foeChar", def: character({ name: "FoeChar", strength: 1, life: 4 }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 5 }), owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...fillDeck(P1, 3)
    ],
    ...(o.oppAttack ? { activePlayerId: P2, turn: 2 } : {})
  });
const picks = (b: ReturnType<typeof downSmash>) => ({ sac: [b.id("bomb")], loc: [b.id("loc")] });

clause(SMASH, "2:flipUp", "a face-down Smash in play flips up for 3 [R]: exactly 3 resources are spent and the full effect happens (sacrifice, location destroyed, draw)", () => {
  const b = downSmash({ rage: 4 });
  assert.equal(ready(b.engine), 5, "4 banks + the face-down Smash");
  rawFlipUp(b.engine, P1, b.id("ss"), picks(b));
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(ready(b.engine), 1, "5 resources: the Smash stops being a resource (-1) and 3 were paid");
  assert.equal(zoneOf(b.engine, b.id("bomb")), "discard");
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard", "5 damage destroys the structure-5 location");
  assert.equal(handOf(b.engine, P1).length, 1);
  assert.equal(zoneOf(b.engine, b.id("ss")), "discard");
});

clause(SMASH, "2:flipUp", "the flipped-up Smash applies the [V][V][V] rule too", () => {
  const b = buildGame({
    ...sides,
    cards: [
      { key: "ss", def: printing(SMASH), owner: P1, zone: "play", faceDown: true },
      { key: "bomb", def: character({ name: "Bomb", strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 5 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1),
      ...volition(3, P1)
    ]
  });
  rawFlipUp(b.engine, P1, b.id("ss"), { sac: [b.id("bomb")], loc: [b.id("loc")] });
  resolvePendingResponses(b.engine);
  assert.equal(influence(b.engine, P2), START - 3);
  assert.equal(cardOf(b.engine, b.id("loc")).damage, 2);
});

clause(SMASH, "2:flipUp", "refused one resource short: 1 Rage bank and the Smash itself is not 3", () => {
  const b = downSmash({ rage: 1 });
  refused(() => rawFlipUp(b.engine, P1, b.id("ss"), picks(b)), "too few resources", /costs cannot be paid/i);
  assert.equal(cardOf(b.engine, b.id("ss")).faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("bomb")), "play");
  assert.equal(ready(b.engine), 2);
});

clause(SMASH, "2:flipUp", "refused with 3 resources but no [R]", () => {
  const b = downSmash({ rage: 0, greed: 4 });
  refused(() => rawFlipUp(b.engine, P1, b.id("ss"), picks(b)), "no [R]", /threshold requirements are not met/i);
  assert.equal(cardOf(b.engine, b.id("ss")).faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("bomb")), "play");
});

clause(SMASH, "2:flipUp", "one [R] among the three resources is enough", () => {
  const b = downSmash({ rage: 1, greed: 2 });
  rawFlipUp(b.engine, P1, b.id("ss"), picks(b));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("bomb")), "discard");
  assert.equal(ready(b.engine), 0);
});

clause(SMASH, "2:flipUp", "the flip still needs its extra-cost picks: no character and an opponent's character are refused", () => {
  const b = downSmash({ rage: 4 });
  refused(() => rawFlipUp(b.engine, P1, b.id("ss"), { loc: [b.id("loc")] }), "no sacrifice", /requires 1 selection/);
  refused(() => rawFlipUp(b.engine, P1, b.id("ss"), { sac: [b.id("foeChar")], loc: [b.id("loc")] }), "opponent's character", /Illegal target/);
  assert.equal(cardOf(b.engine, b.id("ss")).faceDown, true);
  assert.equal(ready(b.engine), 5);
});

clause(SMASH, "2:flipUp", "as a tactic it can be flipped up inside the opponent's response window (during their attack)", () => {
  const b = buildGame({
    ...sides,
    cards: [
      { key: "ss", def: printing(SMASH), owner: P1, zone: "play", faceDown: true },
      { key: "bomb", def: character({ name: "Bomb", strength: 5, life: 2 }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc", structure: 5 }), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 5 }), owner: P2, zone: "play" },
      ...bank("rage", 3, P1)
    ],
    activePlayerId: P2,
    turn: 2
  });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  rawFlipUp(b.engine, P1, b.id("ss"), { sac: [b.id("bomb")], loc: [b.id("loc")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("bomb")), "discard");
  assert.equal(zoneOf(b.engine, b.id("loc")), "discard");
});

clause(SMASH, "2:flipUp", "a Smash that is face-up in play (or in hand) cannot be flipped up", () => {
  const b = downSmash({ rage: 4 });
  b.engine.state.cards[b.id("ss")].faceDown = false;
  refused(() => rawFlipUp(b.engine, P1, b.id("ss"), picks(b)), "not face-down", /./);
  assert.equal(zoneOf(b.engine, b.id("bomb")), "play");
});

void ({} as CardDefinition);
