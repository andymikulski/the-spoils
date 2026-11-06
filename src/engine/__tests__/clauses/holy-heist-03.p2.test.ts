// Clause tests — batch holy-heist-03, part p2 (groups 7-10, missing clauses). See docs/TESTING.md and
// `npm run card-tests -- manifest holy-heist-03 --groups 7-10 --missing`. Expectations come from each card's
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
import { answerPending, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { developResource, endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

const cardOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId];
const handOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].hand;
const deckOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].deck;
const discardOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].discard;
const influenceOf = (engine: SpoilsEngine, p: PlayerId) => engine.state.players[p].influence;
const hasKw = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => (engine.getKeywords(cardId) as string[]).includes(keyword);
const sameSet = (actual: readonly string[], expected: readonly string[]) => assert.deepEqual([...actual].sort(), [...expected].sort());

/** A free tactic that destroys one chosen item (ability id `k`, declaration `t`). */
const killItemTactic = () =>
  tactic({
    name: "Kill Item",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** A character with free abilities that inflict 2 damage on the opposing faction (`zap`) or on its controller's own faction (`zapSelf`). */
const zapper = (name: string, strength = 3) =>
  character({
    name,
    strength,
    life: 3,
    speed: 1,
    behavior: {
      abilities: [
        { id: "zap", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] },
        { id: "zapSelf", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "controller" }, amount: 2 }] }
      ]
    }
  });

// =====================================================================================
// Form 37-Ohhhhh — item, banker, cost 4, [G][G]
// "ATTACH TO CHARACTER -- While you control only 1 character, the attached card gains COVERT. --
//  When the attached character inflicts damage to a faction, draw 2 cards."
// =====================================================================================

const FORM37 = "e08c5f24-ac13-407b-acc6-dce6be5e415d";

function formBoard(
  o: {
    form?: "hand" | "play";
    attachTo?: string;
    greed?: number;
    rage?: number;
    ally?: boolean;
    hostDef?: CardDefinition;
    allyDef?: CardDefinition;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const active = o.active ?? P1;
  const mode = o.form ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "host", def: o.hostDef ?? character({ name: "Host", strength: 3, life: 3, speed: 1 }), owner: P1, zone: "play" },
      ...(o.ally
        ? [{ key: "ally", def: o.allyDef ?? character({ name: "Ally", strength: 4, life: 3, speed: 1 }), owner: P1, zone: "play" as const }]
        : []),
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "cfoe", def: character({ name: "Covert Foe", strength: 1, life: 3, speed: 1, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      {
        key: "form",
        def: printing(FORM37),
        owner: P1,
        zone: mode,
        attachedToKey: mode === "play" ? (o.attachTo ?? "host") : undefined
      },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type FormGame = ReturnType<typeof formBoard>;
const faction = (engine: SpoilsEngine, p: PlayerId) => ({ type: "faction" as const, playerId: p });

clause(FORM37, "0:attach", "deploys onto the character you pick, attached to it, paying cost 4 [G][G]", () => {
  const g = formBoard({ form: "hand", greed: 4, ally: true });
  assert.equal(readyResources(g.engine, P1), 4);
  play(g.engine, P1, g.id("form"), { selected: { attachTo: [g.id("host")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("form")), "play");
  assert.equal(cardOf(g.engine, g.id("form")).attachedTo, g.id("host"), "attached to the picked character");
  assert.equal(cardOf(g.engine, g.id("ally")).attachedTo, undefined, "not to the other character");
  assert.equal(cardOf(g.engine, g.id("foe")).attachedTo, undefined);
  assert.equal(readyResources(g.engine, P1), 0, "the printed cost of 4 is paid");
});

clause(FORM37, "0:attach", "the host may also be an opponent's character", () => {
  const g = formBoard({ form: "hand", greed: 4 });
  play(g.engine, P1, g.id("form"), { selected: { attachTo: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("form")), "play");
  assert.equal(cardOf(g.engine, g.id("form")).attachedTo, g.id("foe"));
  assert.equal(cardOf(g.engine, g.id("form")).controllerId, P1, "still controlled by whoever deployed it");
});

clause(FORM37, "0:attach", "only a character can be the host: not an item, location, faction, face-down card or card in hand; with no legal host it cannot be deployed", () => {
  const g = formBoard({
    form: "hand",
    greed: 4,
    extra: [
      { key: "gizmo", def: item({ name: "Gizmo", life: 3 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" }
    ]
  });
  const attempt = (picked: CardInstanceId) => () => playRaw(g.engine, P1, g.id("form"), { selected: { attachTo: [picked] } });
  refused(attempt(g.id("gizmo")), "an item is not a character");
  refused(attempt(g.id("place")), "a location is not a character");
  refused(attempt(g.engine.state.players[P2].factionId!), "their faction is not a character");
  refused(attempt(g.engine.state.players[P1].factionId!), "my faction is not a character");
  refused(attempt(g.id("fd")), "a face-down card is not a character");
  refused(attempt(g.id("hc")), "a character in hand is not in play");
  assert.equal(zoneOf(g.engine, g.id("form")), "hand");
  assert.equal(readyResources(g.engine, P1), 4, "nothing was spent by the refused attempts");
  attempt(g.id("host"))();
  assert.ok(g.engine.state.responseWindow, "control: a character in play is accepted");

  const empty = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "form", def: printing(FORM37), owner: P1, zone: "hand" }, ...bank("greed", 4, P1)]
  });
  refused(() => playRaw(empty.engine, P1, empty.id("form"), { selected: {} }), "no character in play to attach to");
  assert.equal(zoneOf(empty.engine, empty.id("form")), "hand");
});

clause(FORM37, "0:attach", "needs exactly one host: no pick and two picks are refused", () => {
  const g = formBoard({ form: "hand", greed: 4, ally: true });
  refused(() => playRaw(g.engine, P1, g.id("form"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(g.engine, P1, g.id("form"), { selected: {} }), "no host declared");
  refused(() => playRaw(g.engine, P1, g.id("form"), { selected: { attachTo: [g.id("host"), g.id("ally")] } }), "two hosts");
  assert.equal(zoneOf(g.engine, g.id("form")), "hand");
  playRaw(g.engine, P1, g.id("form"), { selected: { attachTo: [g.id("host")] } });
  assert.ok(g.engine.state.responseWindow, "control: exactly one host is accepted");
});

clause(FORM37, "0:attach", "is refused one resource short (3 of 4) and without two [G]; two [G] plus two others is enough", () => {
  const short = formBoard({ form: "hand", greed: 3 });
  refused(() => playRaw(short.engine, P1, short.id("form"), { selected: { attachTo: [short.id("host")] } }), "3 resources < cost 4");
  const oneG = formBoard({ form: "hand", greed: 1, rage: 5 });
  refused(() => playRaw(oneG.engine, P1, oneG.id("form"), { selected: { attachTo: [oneG.id("host")] } }), "one [G] is not [G][G]");
  const ok = formBoard({ form: "hand", greed: 2, rage: 2 });
  play(ok.engine, P1, ok.id("form"), { selected: { attachTo: [ok.id("host")] } });
  assert.equal(zoneOf(ok.engine, ok.id("form")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 4 were spent");
});

clause(FORM37, "0:attach", "when the host is destroyed the item is destroyed too (it goes to its owner's discard pile)", () => {
  const g = formBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "discard");
  assert.equal(zoneOf(g.engine, g.id("form")), "discard", "the attached item left play with its host");
});

clause(FORM37, "0:attach", "when the host is returned to its owner's hand the item leaves play the same way (into that hand)", () => {
  const g = formBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("host")), "hand");
  assert.equal(zoneOf(g.engine, g.id("form")), "hand", "the attached item followed its host to the hand");
});

/** Synthetic type changers: `grant` adds a type to the picked card for the turn, `strip` removes that grant again. */
const typeChangeTactic = (kind: "grant" | "strip", cardType: "character" | "item") =>
  tactic({
    name: `${kind} ${cardType}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "tc",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [
            kind === "grant"
              ? { type: "setCardType", target: { type: "selected", id: "t" }, cardType, duration: { type: "untilEndOfTurn" } }
              : { type: "removeCardType", target: { type: "selected", id: "t" }, cardType }
          ]
        }
      ]
    }
  } as Partial<CardDefinition>);

/** An item/character whose extra type comes from a live `setCardType`-style grant (the state a "this turn, X is also a Y" effect leaves), with the attachment already on it. */
const grantedHostBoard = (hostDef: CardDefinition, attDef: CardDefinition, grantType: "character" | "item", stripType: "character" | "item") => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "host", def: hostDef, owner: P1, zone: "play" },
      { key: "att", def: attDef, owner: P1, zone: "play", attachedToKey: "host" },
      { key: "strip", def: typeChangeTactic("strip", stripType), owner: P1, zone: "hand" },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 4, P2, "deck")
    ]
  });
  g.engine.state.cardTypeGrants.push({
    id: "grant-test",
    sourceId: g.id("host"),
    targetId: g.id("host"),
    cardType: grantType,
    duration: { type: "untilEndOfTurn" },
    createdTurn: g.engine.state.turn
  } as never);
  return g;
};

clause(FORM37, "0:attach", "CR 507.2e: when the host (an item that was a character) stops being a character, the Form 37 is flipped face-down with it; the host stays in play", () => {
  const g = grantedHostBoard(item({ name: "Gizmo", life: 3 }), printing(FORM37), "character", "character");
  assert.equal(g.engine.hasCardType(g.id("host"), "character" as never), true, "control: the item is also a character");
  play(g.engine, P1, g.id("strip"), { selected: { t: [g.id("host")] } });
  assert.equal(g.engine.hasCardType(g.id("host"), "character" as never), false, "the host is no longer a character");
  assert.equal(zoneOf(g.engine, g.id("host")), "play", "the host itself stays in play");
  assert.equal(zoneOf(g.engine, g.id("att")), "discard", "CR 507.2e: the Form 37 is destroyed, not left attached to a non-character");
});

clause(FORM37, "0:attach", "CR 507.2e control: removing a type the host still has (it is a printed character) leaves the Form 37 attached", () => {
  const g = grantedHostBoard(character({ name: "Real", strength: 2, life: 3, speed: 1 }), printing(FORM37), "item", "item");
  play(g.engine, P1, g.id("strip"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("att")), "play");
  assert.equal(g.engine.state.cards[g.id("att")].attachedTo, g.id("host"));
});

clause(FORM37, "1:rule", "while I control only 1 character, the attached card has COVERT; nobody else does", () => {
  const g = formBoard();
  assert.equal(hasKw(g.engine, g.id("host"), "covert"), true, "the host gains COVERT");
  assert.equal(hasKw(g.engine, g.id("foe"), "covert"), false, "an opposing character does not");
  assert.equal(hasKw(g.engine, g.id("form"), "covert"), false, "the item itself does not");
  const without = formBoard({ form: "hand" });
  assert.equal(hasKw(without.engine, without.id("host"), "covert"), false, "control: no COVERT while the item is not attached");
});

clause(FORM37, "1:rule", "the granted COVERT works in battle: a non-covert character can't block the host, a covert one can", () => {
  const g = formBoard();
  declareAttackBy(g.engine, P1, [g.id("host")]);
  refused(
    () => g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("foe")] }),
    "a non-covert character cannot block a covert party"
  );
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("cfoe")] });
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("cfoe")], "a covert character may block it");
});

clause(FORM37, "1:rule", "with 2 characters the host has no COVERT (and neither has the other one), and a plain character can block it", () => {
  const g = formBoard({ ally: true });
  assert.equal(hasKw(g.engine, g.id("host"), "covert"), false);
  assert.equal(hasKw(g.engine, g.id("ally"), "covert"), false);
  declareAttackBy(g.engine, P1, [g.id("host")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("foe")] });
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("foe")], "an ordinary character may block a host without COVERT");
});

clause(FORM37, "1:rule", "only characters I control are counted: my item, location, resource, face-down card, hand and discard characters and the opponent's characters are not", () => {
  const g = formBoard({
    greed: 1,
    extra: [
      { key: "gizmo", def: item({ name: "Gizmo", life: 3 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
      { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "DiscardChar" }), owner: P1, zone: "discard" },
      { key: "foe2", def: character({ name: "Foe 2" }), owner: P2, zone: "play" },
      { key: "foe3", def: character({ name: "Foe 3" }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(hasKw(g.engine, g.id("host"), "covert"), true, "still exactly 1 character I control");
  const withChar = formBoard({ extra: [{ key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play" }] });
  assert.equal(hasKw(withChar.engine, withChar.id("host"), "covert"), false, "control: a second character of mine turns it off");
});

clause(FORM37, "1:rule", "it follows the count live: a second character turns it off, losing that character turns it back on, a new one turns it off again", () => {
  const g = formBoard({
    ally: true,
    extra: [
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "newc", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(hasKw(g.engine, g.id("host"), "covert"), false, "2 characters");
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ally")] } });
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  assert.equal(hasKw(g.engine, g.id("host"), "covert"), true, "back to exactly 1");
  play(g.engine, P1, g.id("newc"));
  assert.equal(zoneOf(g.engine, g.id("newc")), "play");
  assert.equal(hasKw(g.engine, g.id("host"), "covert"), false, "2 again");
});

clause(FORM37, "1:rule", "the count is of MY characters, wherever the item is attached: on an opposing character it has COVERT while I control exactly 1", () => {
  const one = formBoard({ attachTo: "foe" });
  assert.equal(hasKw(one.engine, one.id("foe"), "covert"), true, "I control exactly 1 character (the Host)");
  assert.equal(hasKw(one.engine, one.id("host"), "covert"), false, "my own character is not the attached card");
  const two = formBoard({ attachTo: "foe", ally: true });
  assert.equal(hasKw(two.engine, two.id("foe"), "covert"), false, "I control 2 characters");
  const none = formBoard({ attachTo: "foe", extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  play(none.engine, P1, none.id("kill"), { selected: { t: [none.id("host")] } });
  assert.equal(hasKw(none.engine, none.id("foe"), "covert"), false, "I control 0 characters");
});

clause(FORM37, "1:rule", "once the item leaves play the host no longer has COVERT", () => {
  const g = formBoard({ extra: [{ key: "killi", def: killItemTactic(), owner: P1, zone: "hand" }] });
  assert.equal(hasKw(g.engine, g.id("host"), "covert"), true);
  play(g.engine, P1, g.id("killi"), { selected: { t: [g.id("form")] } });
  assert.equal(zoneOf(g.engine, g.id("form")), "discard");
  assert.equal(hasKw(g.engine, g.id("host"), "covert"), false);
  assert.equal(zoneOf(g.engine, g.id("host")), "play", "the host is untouched");
});

const drawsTwo = (g: FormGame, before: string[]) => {
  sameSet(handOf(g.engine, P1), before.slice(0, 2));
  assert.deepEqual(deckOf(g.engine, P1), before.slice(2), "exactly the top 2 cards left the deck");
  assert.equal(handOf(g.engine, P2).length, 0, "the opponent draws nothing");
};

clause(FORM37, "2:rule", "when the host damages a faction in battle, I draw 2 cards (exactly 2, the top of my deck)", () => {
  const g = formBoard();
  const before = [...deckOf(g.engine, P1)];
  const influenceBefore = influenceOf(g.engine, P2);
  assert.equal(handOf(g.engine, P1).length, 0);
  fightThrough(g.engine, P1, [g.id("host")], faction(g.engine, P2), []);
  assert.equal(influenceOf(g.engine, P2), influenceBefore - 3, "the host dealt its 3 damage to the faction");
  drawsTwo(g, before);
});

/** Positive control for the "no draw" tests below: an unblocked host DOES draw 2 (so they cannot pass vacuously). */
const hostControlDraws = () => {
  const c = formBoard();
  const before = [...deckOf(c.engine, P1)];
  fightThrough(c.engine, P1, [c.id("host")], faction(c.engine, P2), []);
  drawsTwo(c, before);
};

clause(FORM37, "2:rule", "no cards when the host's damage goes to a blocking character instead of a faction", () => {
  hostControlDraws();
  const g = formBoard();
  const influenceBefore = influenceOf(g.engine, P2);
  fightThrough(g.engine, P1, [g.id("host")], faction(g.engine, P2), [g.id("cfoe")]);
  assert.equal(zoneOf(g.engine, g.id("cfoe")), "discard", "the blocker took the host's damage");
  assert.equal(influenceOf(g.engine, P2), influenceBefore, "the faction took none");
  assert.equal(handOf(g.engine, P1).length, 0, "no draw");
});

clause(FORM37, "2:rule", "no cards when a different character of mine damages the faction; the host staying home draws nothing", () => {
  hostControlDraws();
  const g = formBoard({ ally: true });
  const influenceBefore = influenceOf(g.engine, P2);
  fightThrough(g.engine, P1, [g.id("ally")], faction(g.engine, P2), []);
  assert.equal(influenceOf(g.engine, P2), influenceBefore - 4, "the ally dealt its 4");
  assert.equal(handOf(g.engine, P1).length, 0, "only the attached character's damage draws");
});

clause(FORM37, "2:rule", "the host attacking in a party with another character draws 2 once (not once per character)", () => {
  const g = formBoard({ ally: true });
  const before = [...deckOf(g.engine, P1)];
  const influenceBefore = influenceOf(g.engine, P2);
  fightThrough(g.engine, P1, [g.id("host"), g.id("ally")], faction(g.engine, P2), []);
  assert.equal(influenceOf(g.engine, P2), influenceBefore - 7, "both dealt damage to the faction");
  drawsTwo(g, before);
});

clause(FORM37, "2:rule", "a host that inflicts no damage (0 strength) draws nothing", () => {
  hostControlDraws();
  const g = formBoard({ hostDef: character({ name: "Weakling", strength: 0, life: 3, speed: 1 }) });
  const influenceBefore = influenceOf(g.engine, P2);
  fightThrough(g.engine, P1, [g.id("host")], faction(g.engine, P2), []);
  assert.equal(influenceOf(g.engine, P2), influenceBefore, "no damage was inflicted");
  assert.equal(handOf(g.engine, P1).length, 0);
});

clause(FORM37, "2:rule", "it is not limited to battle: damage the host inflicts to a faction with an ability draws 2 (either faction); another source's damage does not", () => {
  const g = formBoard({ ally: true, hostDef: zapper("Zapper Host"), allyDef: zapper("Zapper Ally") });
  const before = [...deckOf(g.engine, P1)];
  const influenceBefore = influenceOf(g.engine, P2);
  activate(g.engine, P1, g.id("ally"), "zap");
  assert.equal(influenceOf(g.engine, P2), influenceBefore - 2, "the ally's zap hit the faction");
  assert.equal(handOf(g.engine, P1).length, 0, "damage from a character that isn't the host draws nothing");
  activate(g.engine, P1, g.id("host"), "zap");
  assert.equal(influenceOf(g.engine, P2), influenceBefore - 4);
  drawsTwo(g, before);

  const own = formBoard({ hostDef: zapper("Zapper Host") });
  const ownBefore = [...deckOf(own.engine, P1)];
  const ownInfluence = influenceOf(own.engine, P1);
  activate(own.engine, P1, own.id("host"), "zapSelf");
  assert.equal(influenceOf(own.engine, P1), ownInfluence - 2, "the host hit its own faction");
  drawsTwo(own, ownBefore);
});

clause(FORM37, "2:rule",
  "the item's controller draws, even when it is attached to an opposing character that damages a faction",
  () => {
    const g = formBoard({ attachTo: "foe", active: P2 });
    const mine = [...deckOf(g.engine, P1)];
    const theirs = [...deckOf(g.engine, P2)];
    const influenceBefore = influenceOf(g.engine, P1);
    fightThrough(g.engine, P2, [g.id("foe")], faction(g.engine, P1), []);
    assert.equal(influenceOf(g.engine, P1), influenceBefore - 1, "the Foe dealt its 1 damage to my faction");
    sameSet(handOf(g.engine, P1), mine.slice(0, 2));
    assert.equal(handOf(g.engine, P2).length, 0, "the character's controller draws nothing: 'draw 2 cards' is the item's text, so 'you' is its controller");
    assert.deepEqual(deckOf(g.engine, P2), theirs);
  }
);

clause(FORM37, "2:rule", "once the item leaves play the host's damage draws nothing", () => {
  hostControlDraws();
  const g = formBoard({ extra: [{ key: "killi", def: killItemTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("killi"), { selected: { t: [g.id("form")] } });
  assert.equal(zoneOf(g.engine, g.id("form")), "discard");
  const influenceBefore = influenceOf(g.engine, P2);
  fightThrough(g.engine, P1, [g.id("host")], faction(g.engine, P2), []);
  assert.equal(influenceOf(g.engine, P2), influenceBefore - 3);
  assert.equal(handOf(g.engine, P1).length, 0, "the tactic was played; no cards drawn");
});

// =====================================================================================
// Gargoyle of Cathédrale de Mau — character, banker, cost 6, [G][G], 4 strength / 0 speed / 4 life
// "EXTRA COST: Your faction loses 3 influence. Draw 3 cards. -- While this card is in your hand and a
//  location you control is being attacked, this card gains tactical. -- NO. COST: Discard 2 cards.
//  EFFECT: Your faction gains 2 influence. Put this card into its owner's hand."
// =====================================================================================

const GARG = "3613d871-43b0-4239-8dbd-3eee381d6a61";

function gargBoard(
  o: {
    zone?: "hand" | "play" | "discard";
    influence?: number;
    greed?: number;
    rage?: number;
    active?: PlayerId;
    hand?: number;
    gargOwner?: PlayerId;
    gargController?: PlayerId;
    gargDamage?: number;
    gargDepleted?: boolean;
    oppHand?: number;
    extra?: CardPlacement[];
  } = {}
) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: o.influence ?? 10 },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      {
        key: "garg",
        def: printing(GARG),
        owner: o.gargOwner ?? P1,
        controller: o.gargController,
        zone: o.zone ?? "hand",
        damage: o.gargDamage,
        depleted: o.gargDepleted
      },
      { key: "loc", def: location({ name: "My Place", structure: 5 }), owner: P1, zone: "play" },
      { key: "foeLoc", def: location({ name: "Their Place", structure: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...fillers("h", o.hand ?? 0, P1, "hand", (i) => character({ name: `Hand ${i}`, cost: 9 })),
      ...fillers("oh", o.oppHand ?? 0, P2, "hand", (i) => character({ name: `Their Hand ${i}`, cost: 9 })),
      ...bank("greed", o.greed ?? 6, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type GargGame = ReturnType<typeof gargBoard>;
const attackLoc = (g: GargGame, locKey = "loc") => declareAttackOpenWindow(g.engine, P2, [g.id("foe")], { type: "card", cardId: g.id(locKey) });

clause(GARG, "0:extraCost", "deploying it costs 6 [G][G], takes 3 influence from MY faction and draws me the top 3 cards; it enters as a 4 / 0 / 4", () => {
  const g = gargBoard();
  const deckBefore = [...deckOf(g.engine, P1)];
  const theirInfluence = influenceOf(g.engine, P2);
  const theirDeck = [...deckOf(g.engine, P2)];
  play(g.engine, P1, g.id("garg"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("garg")), "play");
  assert.equal(readyResources(g.engine, P1), 0, "the printed cost of 6 is paid");
  assert.equal(influenceOf(g.engine, P1), 7, "my faction lost 3 influence (10 -> 7)");
  assert.equal(influenceOf(g.engine, P2), theirInfluence, "the opponent's faction is untouched");
  sameSet(handOf(g.engine, P1), deckBefore.slice(0, 3));
  assert.deepEqual(deckOf(g.engine, P1), deckBefore.slice(3), "exactly the top 3 cards left my deck");
  assert.deepEqual(deckOf(g.engine, P2), theirDeck, "the opponent drew nothing");
  assert.equal(g.engine.getStat(g.id("garg"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("garg"), "speed"), 0);
  assert.equal(g.engine.getStat(g.id("garg"), "life"), 4);
});

clause(GARG, "0:extraCost", "the 3 cards are drawn as part of the cost, i.e. already when it is played (before it resolves)", () => {
  const g = gargBoard();
  const deckBefore = [...deckOf(g.engine, P1)];
  playRaw(g.engine, P1, g.id("garg"));
  assert.ok(g.engine.state.responseWindow, "the Gargoyle waits for responses");
  assert.notEqual(zoneOf(g.engine, g.id("garg")), "play", "it has not resolved yet");
  assert.equal(influenceOf(g.engine, P1), 7, "the influence is already lost");
  assert.equal(readyResources(g.engine, P1), 0, "the cost is already paid");
  sameSet(handOf(g.engine, P1), deckBefore.slice(0, 3));
});

clause(GARG, "0:extraCost", "cannot be played when my faction has too little influence to lose 3 (2 influence is refused, nothing changes)", () => {
  const ok = gargBoard({ influence: 4 });
  play(ok.engine, P1, ok.id("garg"));
  assert.equal(zoneOf(ok.engine, ok.id("garg")), "play", "control: with 4 influence it is deployed");
  assert.equal(influenceOf(ok.engine, P1), 1);

  const poor = gargBoard({ influence: 2 });
  const deckBefore = [...deckOf(poor.engine, P1)];
  refused(() => playRaw(poor.engine, P1, poor.id("garg")), "only 2 influence to lose 3 from");
  assert.equal(zoneOf(poor.engine, poor.id("garg")), "hand");
  assert.equal(influenceOf(poor.engine, P1), 2, "no influence was lost");
  assert.equal(readyResources(poor.engine, P1), 6, "no resource was spent");
  assert.deepEqual(deckOf(poor.engine, P1), deckBefore, "nothing was drawn");
});

clause(GARG, "0:extraCost", "needs the printed cost 6 (refused with 5) and two [G] (refused with one)", () => {
  const five = gargBoard({ greed: 5 });
  refused(() => playRaw(five.engine, P1, five.id("garg")), "5 resources < cost 6");
  assert.equal(influenceOf(five.engine, P1), 10, "the extra cost is not paid for a refused play");
  const oneG = gargBoard({ greed: 1, rage: 5 });
  refused(() => playRaw(oneG.engine, P1, oneG.id("garg")), "one [G] is not [G][G]");
  assert.equal(influenceOf(oneG.engine, P1), 10);
  const ok = gargBoard({ greed: 2, rage: 4 });
  play(ok.engine, P1, ok.id("garg"));
  assert.equal(zoneOf(ok.engine, ok.id("garg")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 6 were spent");
});

clause(GARG, "1:rule", "in hand while an opponent attacks a location I control: it has tactical and can be deployed in that response window, paying its costs", () => {
  const g = gargBoard({ active: P2 });
  assert.equal(hasKw(g.engine, g.id("garg"), "tactical"), false, "no battle yet");
  const deckBefore = [...deckOf(g.engine, P1)];
  attackLoc(g);
  assert.ok(g.engine.state.battle, "my location is being attacked");
  assert.equal(hasKw(g.engine, g.id("garg"), "tactical"), true, "tactical while in hand and my location is attacked");
  playRaw(g.engine, P1, g.id("garg"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("garg")), "play", "deployed on the opponent's turn");
  assert.equal(influenceOf(g.engine, P1), 7);
  assert.equal(readyResources(g.engine, P1), 0);
  sameSet(handOf(g.engine, P1), deckBefore.slice(0, 3));
});

clause(GARG, "1:rule", "tactical lasts through the whole battle on my location, and ends with it", () => {
  const g = gargBoard({ active: P2 });
  attackLoc(g);
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  assert.ok(g.engine.state.battle, "the battle is still going");
  assert.equal(hasKw(g.engine, g.id("garg"), "tactical"), true, "still tactical after blockers");
  finishBattle(g.engine);
  assert.equal(g.engine.state.battle, undefined);
  assert.equal(hasKw(g.engine, g.id("garg"), "tactical"), false, "the attack is over");
});

clause(GARG, "1:rule", "an attack on my faction (battles can only target a faction or a location) does not give tactical, and the Gargoyle cannot be deployed then", () => {
  const control = gargBoard({ active: P2 });
  attackLoc(control);
  playRaw(control.engine, P1, control.id("garg"));
  assert.ok(control.engine.state.responseWindow, "control: against my location it can be deployed");

  const faction = gargBoard({ active: P2 });
  declareAttackOpenWindow(faction.engine, P2, [faction.id("foe")]);
  assert.ok(faction.engine.state.battle, "faction.engine.state.battle");
  assert.equal(hasKw(faction.engine, faction.id("garg"), "tactical"), false, "faction attacked");
  refused(() => playRaw(faction.engine, P1, faction.id("garg")), "a character without tactical cannot be deployed on the opponent's turn");
  assert.equal(zoneOf(faction.engine, faction.id("garg")), "hand");
});

clause(GARG, "1:rule", "a location I attack (the opponent's) does not give tactical", () => {
  const g = gargBoard({ active: P1 });
  declareAttackBy(g.engine, P1, [g.id("mine")], { type: "card", cardId: g.id("foeLoc") });
  assert.ok(g.engine.state.battle, "g.engine.state.battle");
  assert.equal(hasKw(g.engine, g.id("garg"), "tactical"), false, "the attacked location is not one I control");
});

clause(GARG, "1:rule", "'a location you control' means control, not ownership", () => {
  const stolen = gargBoard({
    active: P2,
    extra: [{ key: "stolen", def: location({ name: "Stolen Place", structure: 5 }), owner: P2, controller: P1, zone: "play" }]
  });
  attackLoc(stolen, "stolen");
  assert.ok(stolen.engine.state.battle, "stolen.engine.state.battle");
  assert.equal(hasKw(stolen.engine, stolen.id("garg"), "tactical"), true, "I control the attacked location (they own it)");

  const lost = gargBoard({
    active: P1,
    extra: [{ key: "lost", def: location({ name: "Lost Place", structure: 5 }), owner: P1, controller: P2, zone: "play" }]
  });
  declareAttackBy(lost.engine, P1, [lost.id("mine")], { type: "card", cardId: lost.id("lost") });
  assert.ok(lost.engine.state.battle, "lost.engine.state.battle");
  assert.equal(hasKw(lost.engine, lost.id("garg"), "tactical"), false, "I own the attacked location but they control it");
});

clause(GARG, "1:rule", "only while it is in the hand: a copy in play or in the discard pile, and the opponent's copy in their hand, have no tactical", () => {
  const g = gargBoard({
    active: P2,
    extra: [
      { key: "gPlay", def: printing(GARG), owner: P1, zone: "play" },
      { key: "gDisc", def: printing(GARG), owner: P1, zone: "discard" },
      { key: "gTheirs", def: printing(GARG), owner: P2, zone: "hand" }
    ]
  });
  attackLoc(g);
  assert.equal(hasKw(g.engine, g.id("garg"), "tactical"), true, "control: my copy in hand has it");
  assert.equal(hasKw(g.engine, g.id("gPlay"), "tactical"), false, "in play");
  assert.equal(hasKw(g.engine, g.id("gDisc"), "tactical"), false, "in the discard pile");
  assert.equal(hasKw(g.engine, g.id("gTheirs"), "tactical"), false, "their copy: the attacked location isn't theirs");
});

const NO_COST = "no-d";
const noBoard = (o: Parameters<typeof gargBoard>[0] = {}) => gargBoard({ zone: "play", hand: 4, ...o });
const useNo = (g: GargGame, picks: string[], player: PlayerId = P1) =>
  activate(g.engine, player, g.id("garg"), "gargoyle-no", { selected: { [NO_COST]: picks.map((k) => g.id(k)) } });

clause(GARG, "2:ability:gargoyle-no", "discarding 2 cards of my choice: my faction gains 2 influence and the Gargoyle returns to my hand", () => {
  const g = noBoard();
  const theirInfluence = influenceOf(g.engine, P2);
  useNo(g, ["h0", "h2"]);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("h0")), "discard", "the two chosen cards were discarded");
  assert.equal(zoneOf(g.engine, g.id("h2")), "discard");
  assert.equal(zoneOf(g.engine, g.id("h1")), "hand", "an unchosen card stays");
  assert.equal(zoneOf(g.engine, g.id("h3")), "hand", "an unchosen card stays");
  assert.equal(influenceOf(g.engine, P1), 12, "10 + 2");
  assert.equal(influenceOf(g.engine, P2), theirInfluence, "the opponent gains nothing");
  assert.equal(zoneOf(g.engine, g.id("garg")), "hand", "the Gargoyle is back in my hand");
  sameSet(handOf(g.engine, P1), [g.id("h1"), g.id("h3"), g.id("garg")]);
  assert.equal(discardOf(g.engine, P1).length, 2, "only the two discarded cards are in the discard pile");
});

clause(GARG, "2:ability:gargoyle-no", "the cost is exactly 2 cards: 1 card, 3 cards, or only 1 card in hand are refused", () => {
  const one = noBoard();
  refused(() => useNo(one, ["h0"]), "1 card is not 2");
  const three = noBoard();
  refused(() => useNo(three, ["h0", "h1", "h2"]), "3 cards is not 2");
  const lonely = noBoard({ hand: 1 });
  refused(() => useNo(lonely, ["h0"]), "only one card in hand");
  const none = noBoard({ hand: 0 });
  refused(() => activate(none.engine, P1, none.id("garg"), "gargoyle-no", { selected: { [NO_COST]: [] } }), "empty hand");
  for (const g of [one, three, lonely, none]) {
    assert.equal(zoneOf(g.engine, g.id("garg")), "play", "a refused use changes nothing");
    assert.equal(influenceOf(g.engine, P1), 10);
  }
  const exact = noBoard({ hand: 2 });
  useNo(exact, ["h0", "h1"]);
  assert.equal(zoneOf(exact.engine, exact.id("garg")), "hand", "control: exactly 2 cards in hand is enough");
  assert.equal(influenceOf(exact.engine, P1), 12);
});

clause(GARG, "2:ability:gargoyle-no", "it goes to its OWNER's hand while its controller (who discards and gains the influence) is someone else", () => {
  const g = noBoard({ gargOwner: P2, gargController: P1 });
  assert.equal(cardOf(g.engine, g.id("garg")).controllerId, P1);
  const theirInfluence = influenceOf(g.engine, P2);
  useNo(g, ["h0", "h1"]);
  assert.equal(influenceOf(g.engine, P1), 12, "the controller's faction gains the influence");
  assert.equal(influenceOf(g.engine, P2), theirInfluence, "the owner's faction does not");
  assert.equal(zoneOf(g.engine, g.id("h0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("h1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("garg")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("garg")), "in its owner's hand");
  assert.equal(handOf(g.engine, P1).includes(g.id("garg")), false, "not in the controller's hand");
});

clause(GARG, "2:ability:gargoyle-no", "it has no other cost: usable the turn it is deployed, while depleted and while damaged", () => {
  const fresh = gargBoard({ hand: 0, extra: fillers("x", 3, P1, "hand", (i) => character({ name: `X${i}`, cost: 9 })) });
  play(fresh.engine, P1, fresh.id("garg"));
  assert.equal(zoneOf(fresh.engine, fresh.id("garg")), "play");
  const before = influenceOf(fresh.engine, P1);
  activate(fresh.engine, P1, fresh.id("garg"), "gargoyle-no", { selected: { [NO_COST]: [fresh.id("x0"), fresh.id("x1")] } });
  assert.equal(zoneOf(fresh.engine, fresh.id("garg")), "hand", "used right after being deployed");
  assert.equal(influenceOf(fresh.engine, P1), before + 2);

  const hurt = noBoard({ gargDamage: 3, gargDepleted: true });
  useNo(hurt, ["h0", "h1"]);
  assert.equal(zoneOf(hurt.engine, hurt.id("garg")), "hand", "damaged and depleted");
  assert.equal(influenceOf(hurt.engine, P1), 12);
});

clause(GARG, "2:ability:gargoyle-no", "can only be used from play, and only by its controller", () => {
  for (const zone of ["hand", "discard"] as const) {
    const g = noBoard({ zone });
    refused(() => useNo(g, ["h0", "h1"]), `from the ${zone}`);
    assert.equal(influenceOf(g.engine, P1), 10);
  }
  const g = noBoard({ oppHand: 3 });
  const theirInfluence = influenceOf(g.engine, P2);
  declareAttackOpenWindow(g.engine, P1, [g.id("mine")]);
  refused(
    () => activate(g.engine, P2, g.id("garg"), "gargoyle-no", { selected: { [NO_COST]: [g.id("oh0"), g.id("oh1")] } }),
    "the opponent holds priority but does not control the Gargoyle"
  );
  assert.equal(zoneOf(g.engine, g.id("garg")), "play");
  assert.equal(influenceOf(g.engine, P2), theirInfluence, "they gained nothing");
  const ok = noBoard();
  useNo(ok, ["h0", "h1"]);
  assert.equal(zoneOf(ok.engine, ok.id("garg")), "hand", "control: its controller can");
});

// =====================================================================================
// Greedy Profiteering — resource, banker, cost 0
// "This resource may only be played from your hand face down. -- PROVIDES: [G] -- FLIP IT: [G]
//  COST: Use this only while this card is a face-down resource. Reveal this card. Your faction loses
//  3 influence. Pay 4. EFFECT: Put this card into play face-up. Put 2 random cards from your discard
//  pile into your hand."
// =====================================================================================

const GP = "a261f7b6-de13-4e76-ad41-f34ce4c4da16";

/** A small deterministic PRNG (mulberry32) for the engine's `random`. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gpBoard(
  o: {
    gp?: "hand" | "faceDown" | "faceUp" | "discard";
    influence?: number;
    greed?: number;
    rage?: number;
    discard?: number;
    oppDiscard?: number;
    random?: () => number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const mode = o.gp ?? "faceDown";
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction(), influence: o.influence ?? 10 },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    random: o.random,
    cards: [
      {
        key: "gp",
        def: printing(GP),
        owner: P1,
        zone: mode === "hand" ? "hand" : mode === "discard" ? "discard" : "play",
        faceDown: mode === "faceDown" ? true : mode === "faceUp" ? false : undefined
      },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      ...fillers("x", o.discard ?? 0, P1, "discard"),
      ...fillers("y", o.oppDiscard ?? 0, P2, "discard"),
      ...fillers("d", 4, P1, "deck"),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ]
  });
}
type GpGame = ReturnType<typeof gpBoard>;
/** Uses FLIP IT, picking `pool` (default: the whole discard pile, which is the most a player can do) for its random-pool declaration. */
const flipIt = (g: GpGame, player: PlayerId = P1, pool: CardInstanceId[] = [...discardOf(g.engine, P1)]) =>
  activate(g.engine, player, g.id("gp"), "flip-it", { selected: { pool } });
const flipItRaw = (g: GpGame, player: PlayerId = P1) =>
  g.engine.perform({
    type: "activateAbility",
    playerId: player,
    cardId: g.id("gp"),
    abilityId: "flip-it",
    selected: { pool: [...discardOf(g.engine, P1)] },
    variables: {}
  } as never);
/** FLIP IT ready: the face-down card, one [G] and three other resources (4 to pay), 5 cards in the discard pile. */
const flipBoard = (o: Parameters<typeof gpBoard>[0] = {}) => gpBoard({ greed: 1, rage: 3, discard: 5, oppDiscard: 3, ...o });
const probe = (over: Partial<CardDefinition> = {}) => character({ name: "Probe", cost: 1, threshold: "g", strength: 1, life: 1, speed: 1, ...over } as Partial<CardDefinition>);

/** A free tactic that plays one chosen resource (from `zone`) with `faceDown`. */
const playResourceTactic = (zone: "hand" | "discard", faceDown: boolean) =>
  tactic({
    name: "Play Resource",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pr",
          type: "activated",
          targets: [{ id: "t", selector: { zone, type: "resource" }, count: 1 }],
          effects: [{ type: "playResource", target: { type: "selected", id: "t" }, faceDown, player: "controller" }]
        }
      ]
    }
  });

clause(GP, "0:rule", "it can be played from my hand face down (as my Develop Rule) and then sits in play face-down as Volition", () => {
  const g = gpBoard({ gp: "hand" });
  developResource(g.engine, P1, g.id("gp"), true);
  assert.equal(zoneOf(g.engine, g.id("gp")), "play");
  assert.equal(cardOf(g.engine, g.id("gp")).faceDown, true);
  assert.equal(g.engine.getThresholds(P1).volition, 1, "face-down it is a Volition resource");
  assert.equal(g.engine.getThresholds(P1).greed ?? 0, 0, "and provides no [G] while face-down");
});

clause(GP, "0:rule", "it cannot be played from my hand face UP", () => {
  const g = gpBoard({ gp: "hand" });
  developResource(g.engine, P1, g.id("gp"), false); // asked to play it face-up
  assert.equal(zoneOf(g.engine, g.id("gp")), "play");
  assert.equal(cardOf(g.engine, g.id("gp")).faceDown, true, "face-up is not allowed: it enters face-down");
  assert.equal(g.engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
  const control = gpBoard({ gp: "hand" });
  developResource(control.engine, P1, control.id("gp"), true);
  assert.equal(zoneOf(control.engine, control.id("gp")), "play", "control: face-down is accepted");
});

clause(GP, "0:rule", "a card effect that plays it from my hand cannot put it into play face-up; face-down it can", () => {
  const faceUp = gpBoard({ gp: "hand", extra: [{ key: "pr", def: playResourceTactic("hand", false), owner: P1, zone: "hand" }] });
  try {
    play(faceUp.engine, P1, faceUp.id("pr"), { selected: { t: [faceUp.id("gp")] } });
  } catch {
    /* refusing is a valid way to enforce it */
  }
  const c = cardOf(faceUp.engine, faceUp.id("gp"));
  assert.ok(!(c.zone === "play" && c.faceDown === false), "it never ends up in play face-up");

  const faceDown = gpBoard({ gp: "hand", extra: [{ key: "pr", def: playResourceTactic("hand", true), owner: P1, zone: "hand" }] });
  play(faceDown.engine, P1, faceDown.id("pr"), { selected: { t: [faceDown.id("gp")] } });
  assert.equal(zoneOf(faceDown.engine, faceDown.id("gp")), "play", "control: played from hand face-down");
  assert.equal(cardOf(faceDown.engine, faceDown.id("gp")).faceDown, true);
});

clause(GP, "0:rule", "it can only be played FROM THE HAND: a card effect cannot play it from the discard pile", () => {
  const g = gpBoard({ gp: "discard", extra: [{ key: "pr", def: playResourceTactic("discard", true), owner: P1, zone: "hand" }] });
  try {
    play(g.engine, P1, g.id("pr"), { selected: { t: [g.id("gp")] } });
  } catch {
    /* refusing is a valid way to enforce it */
  }
  assert.equal(zoneOf(g.engine, g.id("gp")), "discard", "it is still in the discard pile");
  // No positive control is possible: the engine's playResource only ever plays a resource FROM THE HAND (any resource, not just this one).
});

clause(GP, "1:provides", "face-up it provides [G] (one resource, one Greed icon); a card needing [G] can be deployed with it", () => {
  const g = gpBoard({ gp: "faceUp", extra: [{ key: "probe", def: probe(), owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getThresholds(P1).greed, 1);
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 0);
  assert.equal(readyResources(g.engine, P1), 1, "it is exactly one resource");
  play(g.engine, P1, g.id("probe"));
  assert.equal(zoneOf(g.engine, g.id("probe")), "play", "a cost-1 [G] card was deployed with just this resource");
  assert.equal(readyResources(g.engine, P1), 0);
});

clause(GP, "1:provides", "face-down it provides Volition, not [G]: a card needing [G] cannot use it", () => {
  const g = gpBoard({ gp: "faceDown", extra: [{ key: "probe", def: probe(), owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getThresholds(P1).greed ?? 0, 0);
  assert.equal(g.engine.getThresholds(P1).volition, 1);
  assert.equal(readyResources(g.engine, P1), 1, "it still counts as a resource to pay with");
  refused(() => playRaw(g.engine, P1, g.id("probe")), "no [G] icon while face-down");
  const plain = gpBoard({ gp: "faceDown", extra: [{ key: "plain", def: character({ name: "Plain", cost: 1 }), owner: P1, zone: "hand" }] });
  play(plain.engine, P1, plain.id("plain"));
  assert.equal(zoneOf(plain.engine, plain.id("plain")), "play", "control: a thresholdless cost-1 card can be paid with it");
});

clause(GP, "1:provides", "it provides ONE [G]: a [G][G] card needs a second Greed source, and a cost-2 card a second resource", () => {
  const two = gpBoard({ gp: "faceUp", rage: 1, extra: [{ key: "gg", def: probe({ name: "Probe GG", cost: 2, threshold: "gg" } as Partial<CardDefinition>), owner: P1, zone: "hand" }] });
  refused(() => playRaw(two.engine, P1, two.id("gg")), "[G][G] with one Greed icon");
  const ok = gpBoard({ gp: "faceUp", greed: 1, extra: [{ key: "gg", def: probe({ name: "Probe GG", cost: 2, threshold: "gg" } as Partial<CardDefinition>), owner: P1, zone: "hand" }] });
  play(ok.engine, P1, ok.id("gg"));
  assert.equal(zoneOf(ok.engine, ok.id("gg")), "play", "this card plus another [G] makes [G][G]");
  const cost2 = gpBoard({ gp: "faceUp", extra: [{ key: "c2", def: probe({ name: "Probe 2", cost: 2 }), owner: P1, zone: "hand" }] });
  refused(() => playRaw(cost2.engine, P1, cost2.id("c2")), "one resource cannot pay 2");
});

clause(GP, "2:ability:flip-it", "pays Pay 4 and 3 influence, then it is face-up in play and 2 random cards of my discard pile are in my hand", () => {
  const g = flipBoard();
  const discardBefore = [...discardOf(g.engine, P1)];
  const theirDiscard = [...discardOf(g.engine, P2)];
  const theirInfluence = influenceOf(g.engine, P2);
  assert.equal(readyResources(g.engine, P1), 5, "four others plus the face-down card");
  flipIt(g);
  assert.equal(pending(g.engine), undefined);
  assert.equal(cardOf(g.engine, g.id("gp")).faceDown, false, "it is face-up now");
  assert.equal(zoneOf(g.engine, g.id("gp")), "play", "and in play");
  assert.equal(influenceOf(g.engine, P1), 7, "my faction lost 3 influence");
  assert.equal(influenceOf(g.engine, P2), theirInfluence);
  assert.equal(readyResources(g.engine, P1), 1, "4 resources were paid");
  assert.equal(handOf(g.engine, P1).length, 2, "exactly 2 cards in hand");
  for (const c of handOf(g.engine, P1)) assert.ok(discardBefore.includes(c), "and both came from my discard pile");
  assert.equal(discardOf(g.engine, P1).length, 3, "the other 3 are still there");
  sameSet([...handOf(g.engine, P1), ...discardOf(g.engine, P1)], discardBefore);
  assert.deepEqual(discardOf(g.engine, P2), theirDiscard, "the opponent's discard pile is untouched");
  assert.equal(handOf(g.engine, P2).length, 0);
});

clause(GP, "2:ability:flip-it", "the costs (influence and Pay 4) are paid when it is used, while the effect waits for responses", () => {
  const g = flipBoard();
  flipItRaw(g);
  assert.ok(g.engine.state.responseWindow, "the ability is on the stack");
  assert.equal(influenceOf(g.engine, P1), 7, "influence already lost");
  assert.equal(readyResources(g.engine, P1), 1, "the 4 resources are already paid");
  assert.equal(handOf(g.engine, P1).length, 0, "the effect has not resolved yet");
  assert.equal(discardOf(g.engine, P1).length, 5);
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P1).length, 2);
});

clause(GP, "2:ability:flip-it", "afterwards it is a face-up resource providing [G] (and no longer Volition)", () => {
  const g = flipBoard({ extra: [{ key: "probe", def: probe(), owner: P1, zone: "hand" }] });
  assert.equal(g.engine.getThresholds(P1).greed, 1, "one [G] from the bank before");
  assert.equal(g.engine.getThresholds(P1).volition, 1);
  flipIt(g);
  assert.equal(g.engine.getThresholds(P1).greed, 2, "the bank's [G] plus this card's");
  assert.equal(g.engine.getThresholds(P1).volition ?? 0, 0, "no longer Volition");
});

clause(GP, "2:ability:flip-it", "the 2 cards are random: every card of the pile can be chosen, never fewer or more than 2, the same seed gives the same cards", () => {
  const seen = new Set<string>();
  const pairs = new Set<string>();
  const run = (seed: number) => {
    const g = flipBoard({ random: seeded(seed) });
    flipIt(g);
    const hand = [...handOf(g.engine, P1)].map((c) => cardOf(g.engine, c).definitionId + ":" + String(c)).sort();
    assert.equal(handOf(g.engine, P1).length, 2, `seed ${seed}: exactly 2`);
    return { names: handOf(g.engine, P1).map((c) => g.engine.getDefinition(c).name).sort(), hand };
  };
  for (let seed = 1; seed <= 24; seed++) {
    const r = run(seed);
    pairs.add(r.names.join("+"));
    for (const n of r.names) seen.add(n);
  }
  assert.ok(pairs.size >= 4, `different seeds give different pairs (saw ${pairs.size})`);
  assert.equal(seen.size, 5, "all 5 cards of the pile were chosen at least once");
  assert.deepEqual(run(7).names, run(7).names, "the same seed repeats");
});

clause(GP, "2:ability:flip-it", "needs no input from the player: using it with nothing picked still puts 2 random discard-pile cards into my hand", () => {
  const g = flipBoard();
  activate(g.engine, P1, g.id("gp"), "flip-it", { selected: {} });
  assert.equal(pending(g.engine), undefined, "it asked for nothing");
  assert.equal(cardOf(g.engine, g.id("gp")).faceDown, false, "it flipped up");
  assert.equal(handOf(g.engine, P1).length, 2, "and 2 cards of the discard pile are in my hand");
  assert.equal(discardOf(g.engine, P1).length, 3);
});

clause(GP, "2:ability:flip-it", "the player cannot narrow the pool: picking only 2 discard cards still draws random cards from the WHOLE pile", () => {
  const outside = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const g = flipBoard({ random: seeded(seed) });
    flipIt(g, P1, [g.id("x0"), g.id("x1")]);
    for (const c of handOf(g.engine, P1)) if (c !== g.id("x0") && c !== g.id("x1")) outside.add(g.engine.getDefinition(c).name);
  }
  assert.ok(outside.size >= 3, `cards other than the 2 picked reach my hand (saw ${outside.size})`);
});

clause(GP, "2:ability:flip-it", "with fewer than 2 cards in the discard pile it puts what is there into my hand (2, then 1, then 0 cards)", () => {
  const two = flipBoard({ discard: 2 });
  flipIt(two);
  assert.equal(handOf(two.engine, P1).length, 2);
  assert.equal(discardOf(two.engine, P1).length, 0);
  const one = flipBoard({ discard: 1 });
  flipIt(one);
  assert.equal(pending(one.engine), undefined);
  assert.equal(handOf(one.engine, P1).length, 1);
  assert.equal(discardOf(one.engine, P1).length, 0);
  const zero = flipBoard({ discard: 0 });
  flipIt(zero);
  assert.equal(pending(zero.engine), undefined, "an empty discard pile doesn't stall the ability");
  assert.equal(handOf(zero.engine, P1).length, 0);
  assert.equal(cardOf(zero.engine, zero.id("gp")).faceDown, false, "it still flips up");
  assert.equal(influenceOf(zero.engine, P1), 7, "and the costs were still paid");
});

clause(GP, "2:ability:flip-it", "usable only while it is a face-down resource: not face-up in play, in hand or in the discard pile; not by the opponent", () => {
  for (const gp of ["faceUp", "hand", "discard"] as const) {
    const g = flipBoard({ gp });
    refused(() => flipIt(g), `while ${gp}`);
    assert.equal(influenceOf(g.engine, P1), 10, `${gp}: nothing was paid`);
  }
  const g = flipBoard();
  declareAttackOpenWindow(g.engine, P1, [g.id("mine")]);
  refused(() => flipIt(g, P2), "the opponent holds priority but does not control it");
  assert.equal(cardOf(g.engine, g.id("gp")).faceDown, true);
  const ok = flipBoard();
  flipIt(ok);
  assert.equal(cardOf(ok.engine, ok.id("gp")).faceDown, false, "control: its controller can use it while it is face-down");
});

clause(GP, "2:ability:flip-it", "needs [G] among my resources: five non-[G] resources are not enough", () => {
  const none = gpBoard({ greed: 0, rage: 4, discard: 5 });
  refused(() => flipIt(none), "no Greed icon (the face-down card is Volition)");
  assert.equal(influenceOf(none.engine, P1), 10);
  assert.equal(readyResources(none.engine, P1), 5);
  const ok = flipBoard();
  flipIt(ok);
  assert.equal(cardOf(ok.engine, ok.id("gp")).faceDown, false, "control: with a [G] it works");
});

clause(GP, "2:ability:flip-it", "Pay 4 is exactly 4 resources: refused with 3 in total, and 4 are spent when there are more", () => {
  const short = gpBoard({ greed: 1, rage: 1, discard: 5 });
  assert.equal(readyResources(short.engine, P1), 3);
  refused(() => flipIt(short), "3 resources cannot pay 4");
  assert.equal(influenceOf(short.engine, P1), 10, "no influence was lost");
  assert.equal(readyResources(short.engine, P1), 3, "nothing was paid");
  const more = gpBoard({ greed: 2, rage: 4, discard: 5 });
  assert.equal(readyResources(more.engine, P1), 7);
  flipIt(more);
  assert.equal(readyResources(more.engine, P1), 3, "exactly 4 were spent");
});

clause(GP, "2:ability:flip-it", "cannot be used when my faction has less than 3 influence to lose", () => {
  const ok = flipBoard({ influence: 4 });
  flipIt(ok);
  assert.equal(cardOf(ok.engine, ok.id("gp")).faceDown, false, "control: with 4 influence it works");
  assert.equal(influenceOf(ok.engine, P1), 1);
  const poor = flipBoard({ influence: 2 });
  refused(() => flipIt(poor), "only 2 influence to lose 3 from");
  assert.equal(cardOf(poor.engine, poor.id("gp")).faceDown, true);
  assert.equal(influenceOf(poor.engine, P1), 2);
  assert.equal(readyResources(poor.engine, P1), 5, "nothing was paid");
});

// =====================================================================================
// iDumb De-Itemizer — item, banker, upgrade, cost 3, [G]
// "ATTACH TO ITEM -- The attached card has no rules text. -- RESET: COST: Only an opponent may use this
//  ability. Pay 3. EFFECT: This turn, this card loses all rules text. -- FLIP UP: 2 [G]"
// =====================================================================================

const IDUMB = "a0403283-f513-4822-9e8d-afc862ff08b3";

/** An item with a keyword (aggro), an activated ability (`ping`: draw 1), a continuous rule (`aura`: my characters +2 strength) and a trigger (`watch`: +2 influence when another card enters play). */
const gizmo = (name: string) =>
  item({
    name,
    behavior: {
      keywords: ["aggro"],
      abilities: [
        { id: "ping", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] },
        { id: "aura", type: "continuous", modifiers: [{ selector: { controller: "self", type: "character" }, stat: "strength", operation: "add", value: 2 }] },
        {
          id: "watch",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "not", condition: { type: "sourceIsEventCard" } },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }]
        }
      ]
    }
  });

function idumbBoard(
  o: {
    idumb?: "attached" | "hand" | "faceDown";
    attachTo?: string;
    second?: boolean;
    greed?: number;
    rage?: number;
    oppRage?: number;
    active?: PlayerId;
    idumbOwner?: PlayerId;
    idumbController?: PlayerId;
    control?: boolean;
    foeItem?: boolean;
    extra?: CardPlacement[];
  } = {}
) {
  const active = o.active ?? P1;
  const mode = o.idumb ?? "attached";
  const owner = o.idumbOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    cards: [
      { key: "gizmo", def: gizmo("Gizmo"), owner: P1, zone: "play" },
      ...(o.control ? [{ key: "gizmo2", def: gizmo("Gizmo Two"), owner: P1, zone: "play" as const }] : []),
      ...(o.foeItem ? [{ key: "foeItem", def: gizmo("Foe Gizmo"), owner: P2, zone: "play" as const }] : []),
      {
        key: "idumb",
        def: printing(IDUMB),
        owner,
        controller: o.idumbController,
        zone: mode === "hand" ? "hand" : "play",
        faceDown: mode === "faceDown" ? true : undefined,
        attachedToKey: mode === "attached" ? (o.attachTo ?? "gizmo") : undefined
      },
      ...(o.second
        ? [{ key: "idumb2", def: printing(IDUMB), owner: P1, zone: "play" as const, attachedToKey: "gizmo2" }]
        : []),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "newc", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" },
      { key: "kill", def: killItemTactic(), owner: P1, zone: "hand" },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("greed", o.greed ?? 0, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("rage", o.oppRage ?? 0, P2),
      ...(o.extra ?? [])
    ]
  });
}
type IGame = ReturnType<typeof idumbBoard>;
const strengthOfMine = (g: IGame) => g.engine.getStat(g.id("mine"), "strength");
const strengthOfFoe = (g: IGame) => g.engine.getStat(g.id("foe"), "strength");
const ping = (g: IGame, key = "gizmo") => activate(g.engine, P1, g.id(key), "ping");
const reset = (g: IGame, key = "idumb", player: PlayerId = P2) => activate(g.engine, player, g.id(key), "idumb-reset");

/** P1 attacks (leaving P2 with priority), P2 uses RESET in response. */
const attackThenReset = (g: IGame, key = "idumb") => {
  declareAttackOpenWindow(g.engine, P1, [g.id("mine")]);
  reset(g, key);
};
const finishAttack = (g: IGame) => {
  resolvePendingResponses(g.engine);
  if (g.engine.state.battle) {
    g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    finishBattle(g.engine);
  }
};

clause(IDUMB, "0:attach", "deploys onto the item you pick, attached to it, paying cost 3 [G]", () => {
  const g = idumbBoard({ idumb: "hand", greed: 1, rage: 2, control: true });
  play(g.engine, P1, g.id("idumb"), { selected: { attachTo: [g.id("gizmo")] } });
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("idumb")), "play");
  assert.equal(cardOf(g.engine, g.id("idumb")).attachedTo, g.id("gizmo"), "attached to the picked item");
  assert.equal(cardOf(g.engine, g.id("gizmo2")).attachedTo, undefined, "not to the other item");
  assert.equal(readyResources(g.engine, P1), 0, "the printed cost of 3 is paid");
});

clause(IDUMB, "0:attach", "the host may also be an opponent's item", () => {
  const g = idumbBoard({ idumb: "hand", greed: 1, rage: 2, foeItem: true });
  play(g.engine, P1, g.id("idumb"), { selected: { attachTo: [g.id("foeItem")] } });
  assert.equal(zoneOf(g.engine, g.id("idumb")), "play");
  assert.equal(cardOf(g.engine, g.id("idumb")).attachedTo, g.id("foeItem"));
  assert.equal(cardOf(g.engine, g.id("idumb")).controllerId, P1);
});

clause(IDUMB, "0:attach", "only an item can be the host: not a character, location, faction, face-down card or card in hand; with no item in play it cannot be deployed", () => {
  const g = idumbBoard({
    idumb: "hand",
    greed: 1,
    rage: 2,
    extra: [
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: item({ name: "FaceDownItem" }), owner: P2, zone: "play", faceDown: true },
      { key: "hi", def: item({ name: "HandItem" }), owner: P1, zone: "hand" }
    ]
  });
  const attempt = (picked: CardInstanceId) => () => playRaw(g.engine, P1, g.id("idumb"), { selected: { attachTo: [picked] } });
  refused(attempt(g.id("mine")), "a character is not an item");
  refused(attempt(g.id("foe")), "an opposing character is not an item");
  refused(attempt(g.id("place")), "a location is not an item");
  refused(attempt(g.engine.state.players[P2].factionId!), "their faction is not an item");
  refused(attempt(g.engine.state.players[P1].factionId!), "my faction is not an item");
  refused(attempt(g.id("fd")), "a face-down card is not an item");
  refused(attempt(g.id("hi")), "an item in hand is not in play");
  assert.equal(zoneOf(g.engine, g.id("idumb")), "hand");
  assert.equal(readyResources(g.engine, P1), 3, "nothing was spent by the refused attempts");
  attempt(g.id("gizmo"))();
  assert.ok(g.engine.state.responseWindow, "control: an item in play is accepted");

  const empty = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "idumb", def: printing(IDUMB), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1)
    ]
  });
  refused(() => playRaw(empty.engine, P1, empty.id("idumb"), { selected: {} }), "no item in play to attach to");
  assert.equal(zoneOf(empty.engine, empty.id("idumb")), "hand");
});

clause(IDUMB, "0:attach", "needs exactly one host: no pick and two picks are refused", () => {
  const g = idumbBoard({ idumb: "hand", greed: 1, rage: 2, control: true });
  refused(() => playRaw(g.engine, P1, g.id("idumb"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(g.engine, P1, g.id("idumb"), { selected: {} }), "no host declared");
  refused(() => playRaw(g.engine, P1, g.id("idumb"), { selected: { attachTo: [g.id("gizmo"), g.id("gizmo2")] } }), "two hosts");
  assert.equal(zoneOf(g.engine, g.id("idumb")), "hand");
  playRaw(g.engine, P1, g.id("idumb"), { selected: { attachTo: [g.id("gizmo")] } });
  assert.ok(g.engine.state.responseWindow, "control: exactly one host is accepted");
});

clause(IDUMB, "0:attach", "is refused one resource short (2 of 3) and without a [G]", () => {
  const short = idumbBoard({ idumb: "hand", greed: 1, rage: 1 });
  refused(() => playRaw(short.engine, P1, short.id("idumb"), { selected: { attachTo: [short.id("gizmo")] } }), "2 resources < cost 3");
  const noG = idumbBoard({ idumb: "hand", rage: 5 });
  refused(() => playRaw(noG.engine, P1, noG.id("idumb"), { selected: { attachTo: [noG.id("gizmo")] } }), "no [G]");
  const ok = idumbBoard({ idumb: "hand", greed: 1, rage: 2 });
  play(ok.engine, P1, ok.id("idumb"), { selected: { attachTo: [ok.id("gizmo")] } });
  assert.equal(zoneOf(ok.engine, ok.id("idumb")), "play");
  assert.equal(readyResources(ok.engine, P1), 0, "exactly 3 were spent");
});

/** A free tactic that returns one chosen item to its owner's hand (ability id `b`, declaration `t`). */
const bounceItemTactic = () =>
  tactic({
    name: "Bounce Item",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });

clause(IDUMB, "0:attach", "when the host item is destroyed the iDumb is destroyed too (it goes to its owner's discard pile)", () => {
  const g = idumbBoard();
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("gizmo")] } });
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "discard");
  assert.equal(zoneOf(g.engine, g.id("idumb")), "discard", "the attached iDumb left play with its host");
});

clause(IDUMB, "0:attach", "when the host item is returned to its owner's hand the iDumb leaves play the same way (into that hand)", () => {
  const g = idumbBoard({ extra: [{ key: "bounce", def: bounceItemTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("gizmo")] } });
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "hand");
  assert.equal(zoneOf(g.engine, g.id("idumb")), "hand", "the attached iDumb followed its host to the hand");
});

clause(IDUMB, "0:attach", "CR 507.2e: when the host (a character that was an item) stops being an item, the iDumb is destroyed; the host stays in play", () => {
  const g = grantedHostBoard(character({ name: "Chara", strength: 2, life: 3, speed: 1 }), printing(IDUMB), "item", "item");
  assert.equal(g.engine.hasCardType(g.id("host"), "item" as never), true, "control: the character is also an item");
  play(g.engine, P1, g.id("strip"), { selected: { t: [g.id("host")] } });
  assert.equal(g.engine.hasCardType(g.id("host"), "item" as never), false, "the host is no longer an item");
  assert.equal(zoneOf(g.engine, g.id("host")), "play", "the host itself stays in play");
  assert.equal(zoneOf(g.engine, g.id("att")), "discard", "CR 507.2e: the iDumb is destroyed, not left attached to a non-item");
});

clause(IDUMB, "0:attach", "CR 507.2e control: removing a type the host still has (it is a printed item) leaves the iDumb attached", () => {
  const g = grantedHostBoard(item({ name: "Real", life: 3 }), printing(IDUMB), "character", "character");
  play(g.engine, P1, g.id("strip"), { selected: { t: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("att")), "play");
  assert.equal(g.engine.state.cards[g.id("att")].attachedTo, g.id("host"));
});

/** A card with a granted type is that type too (RULES.md 3.7, CR 208.1): it must be a legal host for ATTACH TO. */
const deployOntoGranted = (hostDef: CardDefinition, attId: string, grantType: "character" | "item", greed: number) => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "host", def: hostDef, owner: P1, zone: "play" },
      { key: "att", def: printing(attId), owner: P1, zone: "hand" },
      { key: "grant", def: typeChangeTactic("grant", grantType), owner: P1, zone: "hand" },
      ...fillers("d", 6, P1, "deck"),
      ...fillers("e", 4, P2, "deck"),
      ...bank("greed", greed, P1)
    ]
  });
  play(g.engine, P1, g.id("grant"), { selected: { t: [g.id("host")] } });
  assert.equal(g.engine.hasCardType(g.id("host"), grantType as never), true, "control: the grant is live");
  play(g.engine, P1, g.id("att"), { selected: { attachTo: [g.id("host")] } });
  assert.equal(zoneOf(g.engine, g.id("att")), "play");
  assert.equal(g.engine.state.cards[g.id("att")].attachedTo, g.id("host"));
};

clause(FORM37, "0:attach", "an item that is a character this turn (granted type) is a legal host for the Form 37", () => {
  deployOntoGranted(item({ name: "Gizmo", life: 3 }), FORM37, "character", 4);
});

clause(IDUMB, "0:attach", "a character that is an item this turn (granted type) is a legal host for the iDumb", () => {
  deployOntoGranted(character({ name: "Chara", strength: 2, life: 3, speed: 1 }), IDUMB, "item", 3);
});

clause(IDUMB, "1:rule", "the attached item's activated ability, continuous rule and triggered ability are all gone", () => {
  const plain = idumbBoard({ idumb: "hand" });
  assert.equal(strengthOfMine(plain), 4, "control: unattached, the item's aura works (+2)");
  const plainHand = handOf(plain.engine, P1).length;
  ping(plain);
  assert.equal(handOf(plain.engine, P1).length, plainHand + 1, "control: its ping drew a card");
  const plainInfluence = influenceOf(plain.engine, P1);
  play(plain.engine, P1, plain.id("newc"));
  assert.equal(influenceOf(plain.engine, P1), plainInfluence + 2, "control: its trigger gave +2 influence");

  const g = idumbBoard();
  assert.equal(strengthOfMine(g), 2, "the aura no longer applies");
  const hand = handOf(g.engine, P1).length;
  refused(() => ping(g), "the ability is gone", /Activated ability not found/);
  assert.equal(handOf(g.engine, P1).length, hand, "nothing was drawn");
  const influence = influenceOf(g.engine, P1);
  play(g.engine, P1, g.id("newc"));
  assert.equal(zoneOf(g.engine, g.id("newc")), "play");
  assert.equal(influenceOf(g.engine, P1), influence, "the trigger no longer fires");
});

clause(IDUMB, "1:rule", "the attached item's keywords are gone too (keywords are rules text)", () => {
  const plain = idumbBoard({ idumb: "hand" });
  assert.equal(hasKw(plain.engine, plain.id("gizmo"), "aggro"), true, "control: unattached it has aggro");
  const g = idumbBoard();
  assert.equal(hasKw(g.engine, g.id("gizmo"), "aggro"), false);
});

clause(IDUMB, "1:rule", "only the attached card is affected: other items, the opponent's items and the iDumb itself keep their text", () => {
  const g = idumbBoard({ control: true, foeItem: true, oppRage: 3 });
  assert.equal(strengthOfMine(g), 4, "the other item's aura still works (+2 on 2)");
  assert.equal(strengthOfFoe(g), 3, "the opponent's item's aura works (+2 on 1)");
  const hand = handOf(g.engine, P1).length;
  ping(g, "gizmo2");
  assert.equal(handOf(g.engine, P1).length, hand + 1, "the other item's ping works");
  assert.equal(hasKw(g.engine, g.id("gizmo2"), "aggro"), true);
  attackThenReset(g);
  assert.equal(readyResources(g.engine, P2), 0, "the iDumb itself still has its own RESET text: the opponent paid 3 to use it");
});

clause(IDUMB, "1:rule", "it can mute an opponent's item", () => {
  const g = idumbBoard({ foeItem: true, attachTo: "foeItem" });
  assert.equal(strengthOfFoe(g), 1, "their item's aura is off");
  assert.equal(strengthOfMine(g), 4, "my unattached item's aura is on");
  const free = idumbBoard({ foeItem: true });
  assert.equal(strengthOfFoe(free), 3, "control: with the iDumb elsewhere their aura applies");
});

clause(IDUMB, "1:rule", "when the iDumb leaves play the item has its rules text again", () => {
  const g = idumbBoard();
  assert.equal(strengthOfMine(g), 2);
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("idumb")] } });
  assert.equal(zoneOf(g.engine, g.id("idumb")), "discard");
  assert.equal(zoneOf(g.engine, g.id("gizmo")), "play");
  assert.equal(strengthOfMine(g), 4, "its aura is back");
  ping(g);
  assert.equal(handOf(g.engine, P1).length, 2, "and its ability works (hand: newc + 1 drawn; the tactic was played)");
});

clause(IDUMB, "2:ability:idumb-reset", "an opponent may use it (Pay 3): the iDumb loses its text this turn, so the host has its rules text back", () => {
  const g = idumbBoard({ oppRage: 3 });
  assert.equal(strengthOfMine(g), 2, "muted before");
  attackThenReset(g);
  assert.equal(readyResources(g.engine, P2), 0, "the opponent paid 3");
  assert.equal(readyResources(g.engine, P1), 0);
  assert.equal(strengthOfMine(g), 4, "the host's aura is back");
  assert.equal(hasKw(g.engine, g.id("gizmo"), "aggro"), true, "and its keyword");
  finishAttack(g);
  assert.equal(g.engine.state.battle, undefined);
  assert.equal(strengthOfMine(g), 4, "still this turn");
  const hand = handOf(g.engine, P1).length;
  ping(g);
  assert.equal(handOf(g.engine, P1).length, hand + 1, "the host's ping works again this turn");
  const before = influenceOf(g.engine, P1);
  play(g.engine, P1, g.id("newc"));
  assert.equal(influenceOf(g.engine, P1), before + 2, "and its trigger fires");
  assert.equal(zoneOf(g.engine, g.id("idumb")), "play", "the iDumb stays attached");
  assert.equal(cardOf(g.engine, g.id("idumb")).attachedTo, g.id("gizmo"));
});

clause(IDUMB, "2:ability:idumb-reset", "it lasts only this turn: at the end of the turn the iDumb has its text again and the host is muted", () => {
  const g = idumbBoard({ oppRage: 3 });
  attackThenReset(g);
  finishAttack(g);
  assert.equal(strengthOfMine(g), 4, "the host has its text back this turn");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(strengthOfMine(g), 2, "on the next turn the host is muted again");
  endTurn(g.engine, P2);
  assert.equal(strengthOfMine(g), 2, "and stays muted on the turn after");
});

clause(IDUMB, "2:ability:idumb-reset", "'this card' is only that iDumb: another iDumb on another item stays in force", () => {
  const g = idumbBoard({ second: true, control: true, oppRage: 3 });
  assert.equal(strengthOfMine(g), 2, "both items are muted");
  attackThenReset(g);
  assert.equal(strengthOfMine(g), 4, "only the first item's aura is back (+2), the second iDumb still mutes its host");
  assert.equal(cardOf(g.engine, g.id("idumb2")).attachedTo, g.id("gizmo2"));
});

clause(IDUMB, "2:ability:idumb-reset", "an opponent may use it, paying 3 resources (response window on my turn)", () => {
  const g = idumbBoard({ oppRage: 3 });
  assert.equal(readyResources(g.engine, P2), 3);
  attackThenReset(g);
  assert.equal(readyResources(g.engine, P2), 0, "the opponent paid 3");
  assert.equal(readyResources(g.engine, P1), 0, "and I paid nothing");
  assert.equal(zoneOf(g.engine, g.id("idumb")), "play");
});

clause(IDUMB, "2:ability:idumb-reset", "only an opponent may use it: its controller is refused (and nothing is paid)", () => {
  const g = idumbBoard({ greed: 1, rage: 5, oppRage: 3 });
  refused(() => reset(g, "idumb", P1), "the controller may not use RESET");
  assert.equal(readyResources(g.engine, P1), 6, "nothing was paid");
  assert.equal(readyResources(g.engine, P2), 3);
  attackThenReset(g);
  assert.equal(readyResources(g.engine, P2), 0, "control: the opponent can");
  assert.equal(readyResources(g.engine, P1), 6, "and I still paid nothing");
});

clause(IDUMB, "2:ability:idumb-reset", "the opponent can also use it on their own turn", () => {
  const g = idumbBoard({ active: P2, oppRage: 3 });
  reset(g);
  assert.equal(readyResources(g.engine, P2), 0, "RESET was used (and paid for) on the opponent's own turn");
});

clause(IDUMB, "2:ability:idumb-reset", "'an opponent' is the controller's opponent: with the iDumb owned by the opponent but controlled by me, they may use it and I may not", () => {
  const g = idumbBoard({ idumbOwner: P2, idumbController: P1, greed: 1, rage: 5, oppRage: 3 });
  assert.equal(cardOf(g.engine, g.id("idumb")).controllerId, P1);
  refused(() => reset(g, "idumb", P1), "its controller may not");
  assert.equal(readyResources(g.engine, P1), 6);
  attackThenReset(g);
  assert.equal(readyResources(g.engine, P2), 0, "the other player (who owns it) may");
});

clause(IDUMB, "2:ability:idumb-reset", "Pay 3: refused with only 2 resources (nothing changes), 3 is enough", () => {
  const g = idumbBoard({ oppRage: 2 });
  declareAttackOpenWindow(g.engine, P1, [g.id("mine")]);
  refused(() => reset(g), "2 resources cannot pay 3");
  assert.equal(readyResources(g.engine, P2), 2, "nothing was paid");
  const ok = idumbBoard({ oppRage: 3 });
  attackThenReset(ok);
  assert.equal(readyResources(ok.engine, P2), 0, "control: with 3 it is paid");
  const more = idumbBoard({ oppRage: 5 });
  attackThenReset(more);
  assert.equal(readyResources(more.engine, P2), 2, "exactly 3 of 5 were paid");
});

clause(IDUMB, "2:ability:idumb-reset", "the iDumb loses ALL its rules text this turn, RESET included: it cannot be used a second time", () => {
  const g = idumbBoard({ oppRage: 6 });
  attackThenReset(g);
  assert.equal(readyResources(g.engine, P2), 3, "the first use cost 3");
  refused(() => reset(g), "the iDumb has no rules text left, so no RESET", /Activated ability not found/);
  assert.equal(readyResources(g.engine, P2), 3, "nothing more was paid");
});

clause(IDUMB, "3:flipUp", "FLIP UP 2 [G]: from a face-down resource it deploys onto an item for a total of 3 resources and mutes it", () => {
  const g = idumbBoard({ idumb: "faceDown", greed: 1, rage: 3 });
  assert.equal(readyResources(g.engine, P1), 5, "four others plus the face-down card");
  assert.equal(strengthOfMine(g), 4, "the item is not muted yet");
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("idumb"), selected: { attachTo: [g.id("gizmo")] }, variables: {} });
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(cardOf(g.engine, g.id("idumb")).faceDown, false, "it is face-up");
  assert.equal(zoneOf(g.engine, g.id("idumb")), "play");
  assert.equal(cardOf(g.engine, g.id("idumb")).attachedTo, g.id("gizmo"), "attached to the picked item");
  assert.equal(readyResources(g.engine, P1), 2, "the 2 Flip Up cost plus the 1 balance of its cost 3 were paid");
  assert.equal(strengthOfMine(g), 2, "the item is muted");
});

clause(IDUMB, "3:flipUp", "it can pay for its own Flip Up: it, one [G] and one other resource are exactly enough", () => {
  const tight = idumbBoard({ idumb: "faceDown", greed: 1, rage: 1 });
  assert.equal(readyResources(tight.engine, P1), 3);
  flipUpNow(tight.engine, { type: "flipUp", playerId: P1, cardId: tight.id("idumb"), selected: { attachTo: [tight.id("gizmo")] }, variables: {} });
  resolvePendingResponses(tight.engine);
  assert.equal(cardOf(tight.engine, tight.id("idumb")).faceDown, false);
  assert.equal(cardOf(tight.engine, tight.id("idumb")).attachedTo, tight.id("gizmo"));
  assert.equal(readyResources(tight.engine, P1), 0, "all 3 resources were used");
});

clause(IDUMB, "3:flipUp", "no balance of the numeric cost is paid: the running total is seeded at the Flip Up cost (CR 406.7), so the card itself plus one [G] (2 resources) is enough, and one short of the Flip Up cost is refused", () => {
  // Corrected by E9b: the old version expected a balance of 1 (total 3) to be paid on top of the Flip Up cost 2.
  // CR 406.7 seeds the running total at the Flip Up cost and you pay the total minus what was already paid: 2, no balance.
  const exact = idumbBoard({ idumb: "faceDown", greed: 1 });
  assert.equal(readyResources(exact.engine, P1), 2);
  flipUpNow(exact.engine, { type: "flipUp", playerId: P1, cardId: exact.id("idumb"), selected: { attachTo: [exact.id("gizmo")] }, variables: {} });
  resolvePendingResponses(exact.engine);
  assert.equal(cardOf(exact.engine, exact.id("idumb")).faceDown, false, "it flipped up with just the Flip Up cost of 2");
  assert.equal(cardOf(exact.engine, exact.id("idumb")).attachedTo, exact.id("gizmo"));
  assert.equal(readyResources(exact.engine, P1), 0, "both resources went (the card itself is no longer a resource): 2 paid, no balance of 1");

  // One short of the Flip Up cost: the card itself is the only ready resource ([G] is already spent, so it still meets the threshold).
  const short = idumbBoard({ idumb: "faceDown", extra: bank("greed", 1, P1).map((placement) => ({ ...placement, attachedToKey: "__factionA" })) });
  assert.equal(readyResources(short.engine, P1), 1);
  refused(
    () => flipUpNow(short.engine, { type: "flipUp", playerId: P1, cardId: short.id("idumb"), selected: { attachTo: [short.id("gizmo")] }, variables: {} }),
    "1 resource cannot pay the Flip Up cost of 2",
    /cannot be paid/
  );
  assert.equal(cardOf(short.engine, short.id("idumb")).faceDown, true, "it stayed face-down");
  assert.equal(readyResources(short.engine, P1), 1, "nothing was paid");
});

clause(IDUMB, "3:flipUp", "the Flip Up threshold [G] is required: without a Greed icon it is refused", () => {
  const noG = idumbBoard({ idumb: "faceDown", rage: 4 });
  refused(
    () => flipUpNow(noG.engine, { type: "flipUp", playerId: P1, cardId: noG.id("idumb"), selected: { attachTo: [noG.id("gizmo")] }, variables: {} }),
    "no [G]"
  );
  assert.equal(cardOf(noG.engine, noG.id("idumb")).faceDown, true);
  assert.equal(readyResources(noG.engine, P1), 5);
});

clause(IDUMB, "3:flipUp", "a flipped-up iDumb still needs a legal item host: a character, no pick or two picks are refused", () => {
  const g = idumbBoard({ idumb: "faceDown", greed: 1, rage: 3, control: true });
  const flip = (picked: CardInstanceId[]) => () =>
    flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("idumb"), selected: { attachTo: picked }, variables: {} });
  refused(flip([g.id("mine")]), "a character is not an item");
  refused(flip([]), "no host");
  refused(flip([g.id("gizmo"), g.id("gizmo2")]), "two hosts");
  assert.equal(cardOf(g.engine, g.id("idumb")).faceDown, true);
  assert.equal(readyResources(g.engine, P1), 5, "nothing was paid by the refused attempts");
  flip([g.id("gizmo2")])();
  resolvePendingResponses(g.engine);
  assert.equal(cardOf(g.engine, g.id("idumb")).attachedTo, g.id("gizmo2"), "control: one item host is accepted");
});

clause(IDUMB, "3:flipUp", "only a face-down resource I control can be flipped up: not from my hand, not when already face-up", () => {
  const inHand = idumbBoard({ idumb: "hand", greed: 1, rage: 3 });
  refused(
    () => flipUpNow(inHand.engine, { type: "flipUp", playerId: P1, cardId: inHand.id("idumb"), selected: { attachTo: [inHand.id("gizmo")] }, variables: {} }),
    "in hand"
  );
  assert.equal(zoneOf(inHand.engine, inHand.id("idumb")), "hand");
  const up = idumbBoard({ greed: 1, rage: 3 });
  refused(
    () => flipUpNow(up.engine, { type: "flipUp", playerId: P1, cardId: up.id("idumb"), selected: { attachTo: [up.id("gizmo")] }, variables: {} }),
    "already face-up"
  );
  assert.equal(readyResources(up.engine, P1), 4);
});

clause(IDUMB, "3:flipUp", "FLIP UP does not make it fast: it cannot be flipped up in the opponent's response window", () => {
  const g = idumbBoard({ idumb: "faceDown", greed: 1, rage: 3, active: P2 });
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("foe")], target: { type: "faction", playerId: P1 } });
  g.engine.perform({ type: "passPriority", playerId: P2 });
  assert.ok(g.engine.state.responseWindow, "I hold priority in the declaration window");
  refused(
    () => flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("idumb"), selected: { attachTo: [g.id("gizmo")] }, variables: {} }),
    "an item is not a tactic"
  );
  assert.equal(cardOf(g.engine, g.id("idumb")).faceDown, true);
  assert.equal(readyResources(g.engine, P1), 5);
});

// <<END>>
