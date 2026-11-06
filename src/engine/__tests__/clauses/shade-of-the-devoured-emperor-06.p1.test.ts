// Clause tests — batch shade-of-the-devoured-emperor-06, part p1 (groups 1-6, missing clauses only).
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
  killTactic,
  location,
  play,
  resourceCard,
  tactic,
  P1,
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import type { CardPlacement, DamageSource } from "../support/fixtures.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { pending, readyResources, zoneOf } from "./_board.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { endTurn } from "./_turn.js";

type Ids = (key: string) => CardInstanceId;

/** Two-player board with the generic Develop/Restore-capable factions. */
function duo(cards: CardPlacement[], opts: { turn?: number; active?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    cards
  });
}

const chr = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => character({ name, strength: 2, life: 5, speed: 2, ...over });
const ready = readyResources;
const dmg = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted;
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const FACTION = (player: PlayerId) => ({ type: "faction", playerId: player }) as const;
const flipUpAs = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

/** The opponent (P2) as the active player with a lone attacker `atk`, response window open with P1 holding priority. */
const FOE_ATK: CardPlacement = { key: "atk", def: chr("Atk"), owner: P2, zone: "play" };

// =====================================================================================
// Numba 1 Stunna! — character, rogue, cost 3, [D], 1/3/4 (strength/speed/life), subtype grifter
// TACTICAL -- If this card inflicts damage to a character, that character does not restore during its
// controller's next RESTORE RULE. -- FLIP UP: 3 [D][D]
// =====================================================================================

const NUMBA = "6a78db5e-1ae4-4a93-95ed-d93fac077196";

function numbaBoard(opts: { active?: PlayerId; numba?: "hand" | "play" | "faceDown"; deception?: number; rage?: number; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      {
        key: "n1s",
        def: printing(NUMBA),
        owner: P1,
        zone: opts.numba === "hand" ? "hand" : "play",
        faceDown: opts.numba === "faceDown" ? true : undefined
      },
      ...bank("deception", opts.deception ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.cards ?? [])
    ],
    { active: opts.active }
  );
}

const foe = (key: string, over: Partial<CardPlacement> = {}): CardPlacement => ({ key, def: chr(key), owner: P2, zone: "play", ...over });

clause(NUMBA, "0:kw:TACTICAL", "has the TACTICAL keyword (an ordinary character does not)", () => {
  const { engine, id } = numbaBoard({ cards: [{ key: "plain", def: chr("Plain"), owner: P1, zone: "play" }] });
  assert.ok(engine.getKeywords(id("n1s")).includes("tactical"), "engine.getKeywords(id(\"n1s\")).includes(\"tactical\")");
  assert.equal(engine.getKeywords(id("plain")).includes("tactical"), false, "control: an ordinary character is not tactical");
});

clause(NUMBA, "0:kw:TACTICAL", "from hand it deploys in the opponent's attack window (whenever a tactic could be), paying its printed cost 3", () => {
  const b = numbaBoard({ active: P2, numba: "hand", deception: 3, cards: [FOE_ATK] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  const before = ready(b.engine, P1);
  play(b.engine, P1, b.id("n1s"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("n1s")), "play", "deployed on the opponent's turn");
  assert.equal(before - ready(b.engine, P1), 3, "cost 3 paid");
});

clause(NUMBA, "0:kw:TACTICAL", "an ordinary character cannot be deployed in that window, and Numba itself cannot on the opponent's turn with no window open", () => {
  const b = numbaBoard({
    active: P2,
    numba: "hand",
    deception: 4,
    cards: [FOE_ATK, { key: "plain", def: chr("Plain", { cost: 1 }), owner: P1, zone: "hand" }]
  });
  refused(() => play(b.engine, P1, b.id("n1s")), "no tactic window on the opponent's turn yet");
  assert.equal(zoneOf(b.engine, b.id("n1s")), "hand");
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => play(b.engine, P1, b.id("plain")), "a non-tactical character can't be deployed in the opponent's window");
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  play(b.engine, P1, b.id("n1s"));
  assert.equal(zoneOf(b.engine, b.id("n1s")), "play", "control: the TACTICAL character can");
});

clause(NUMBA, "0:kw:TACTICAL", "TACTICAL changes the timing only: cost 3 and the [D] threshold are still required", () => {
  const attack = (opts: { deception?: number; rage?: number }) => {
    const b = numbaBoard({ active: P2, numba: "hand", ...opts, cards: [FOE_ATK] });
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    return b;
  };
  const short = attack({ deception: 2 });
  refused(() => play(short.engine, P1, short.id("n1s")), "one short of cost 3");
  assert.equal(zoneOf(short.engine, short.id("n1s")), "hand");
  const noIcon = attack({ rage: 5 });
  refused(() => play(noIcon.engine, P1, noIcon.id("n1s")), "cost covered but no [D]", /threshold/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("n1s")), "hand");
  const ok = attack({ deception: 1, rage: 2 });
  play(ok.engine, P1, ok.id("n1s"));
  assert.equal(zoneOf(ok.engine, ok.id("n1s")), "play", "control: exactly 3 resources with one [D]");
});

// --- the rule: no restore after being damaged by this card ------------------------------

const toFaction = (p: PlayerId) => ({ type: "faction", playerId: p }) as { type: "faction"; playerId: PlayerId };

clause(NUMBA, "1:rule", "a character Numba damages in battle stays depleted through its controller's next restore; an undamaged depleted character restores", () => {
  const { engine, id } = numbaBoard({ cards: [foe("blk"), foe("idle", { depleted: true })] });
  fightThrough(engine, P1, [id("n1s")], toFaction(P2), [id("blk")]);
  assert.equal(dmg(engine, id("blk")), 1, "Numba (strength 1) damaged the blocker");
  assert.equal(isDepleted(engine, id("blk")), true, "the surviving blocker is depleted");
  assert.equal(isDepleted(engine, id("idle")), true);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("idle")), false, "control: an undamaged depleted character restores");
  assert.equal(isDepleted(engine, id("blk")), true, "the damaged character does not restore");
});

clause(NUMBA, "1:rule", "it is only the NEXT restore: the damaged character restores at the one after", () => {
  const { engine, id } = numbaBoard({ cards: [foe("blk")] });
  fightThrough(engine, P1, [id("n1s")], toFaction(P2), [id("blk")]);
  endTurn(engine, P1); // P2's restore: skipped
  assert.equal(isDepleted(engine, id("blk")), true);
  endTurn(engine, P2); // P1's turn
  endTurn(engine, P1); // P2's next restore
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("blk")), false, "restores normally at its controller's second restore");
});

clause(NUMBA, "1:rule", "Numba itself (and its controller's cards) restore as normal even though the blocker damaged it back", () => {
  const { engine, id } = numbaBoard({ cards: [foe("blk")] });
  fightThrough(engine, P1, [id("n1s")], toFaction(P2), [id("blk")]);
  assert.ok(dmg(engine, id("n1s")) > 0 || zoneOf(engine, id("n1s")) === "play", "Numba survived the blocker's strike");
  assert.equal(isDepleted(engine, id("n1s")), true, "Numba attacked, so it is depleted");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("n1s")), false, "Numba restores at its own controller's next restore");
});

clause(NUMBA, "1:rule", "also applies when Numba is the one blocking: the attacker it damages does not restore at its controller's next restore", () => {
  const { engine, id } = numbaBoard({
    active: P2,
    cards: [
      { key: "atk", def: chr("Atk", { strength: 1, speed: 1 }), owner: P2, zone: "play" },
      foe("idle", { depleted: true })
    ]
  });
  fightThrough(engine, P2, [id("atk")], toFaction(P1), [id("n1s")]);
  assert.equal(dmg(engine, id("atk")), 1, "Numba (strength 1) damaged the attacker");
  assert.equal(isDepleted(engine, id("atk")), true, "the attacker is depleted");
  endTurn(engine, P2); // P1's turn
  endTurn(engine, P1); // P2's restore
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("idle")), false, "control: undamaged depleted character restores");
  assert.equal(isDepleted(engine, id("atk")), true, "the attacker Numba damaged does not restore");
});

clause(NUMBA, "1:rule", "near miss: a character damaged by a DIFFERENT source restores normally", () => {
  const { engine, id } = numbaBoard({ cards: [{ key: "ally", def: chr("Ally"), owner: P1, zone: "play" }, foe("blk")] });
  fightThrough(engine, P1, [id("ally")], toFaction(P2), [id("blk")]);
  assert.equal(dmg(engine, id("blk")), 2, "damaged by the ally (strength 2)");
  assert.equal(isDepleted(engine, id("blk")), true);
  endTurn(engine, P1);
  assert.equal(isDepleted(engine, id("blk")), false, "not damaged by Numba, so it restores");
});

const aimAt = (aim: Record<string, string>) => (src: DamageSource) => {
  const want = aim[src.cardId];
  const target = want === undefined ? src.legalTargets[0] : src.legalTargets.find((t) => JSON.stringify(t).includes(want));
  assert.ok(target !== undefined, `a legal target for ${src.cardId}`);
  return src.strength > 0 ? [{ sourceId: src.cardId, target, amount: src.strength }] : [];
};

clause(NUMBA, "1:rule", "only the character Numba itself damaged is affected: a party-mate's victim in the same battle restores", () => {
  const { engine, id } = numbaBoard({ cards: [{ key: "ally", def: chr("Ally"), owner: P1, zone: "play" }, foe("b1"), foe("b2")] });
  fightThrough(
    engine,
    P1,
    [id("n1s"), id("ally")],
    toFaction(P2),
    [id("b1"), id("b2")],
    aimAt({ [id("n1s")]: id("b1"), [id("ally")]: id("b2") })
  );
  assert.equal(dmg(engine, id("b1")), 1, "Numba's damage went to b1");
  assert.equal(dmg(engine, id("b2")), 2, "the ally's damage went to b2");
  assert.equal(isDepleted(engine, id("b1")), true);
  assert.equal(isDepleted(engine, id("b2")), true);
  endTurn(engine, P1);
  assert.equal(isDepleted(engine, id("b1")), true, "damaged by Numba: no restore");
  assert.equal(isDepleted(engine, id("b2")), false, "damaged by the ally: restores");
});

clause(NUMBA, "1:rule", "near miss: damage to a faction is not damage to a character, so the defender's depleted characters restore", () => {
  const { engine, id } = numbaBoard({ cards: [foe("idle", { depleted: true })] });
  fightThrough(engine, P1, [id("n1s")], toFaction(P2), []);
  assert.equal(engine.state.players[P2].influence, 29, "Numba hit the unblocked faction for 1");
  endTurn(engine, P1);
  assert.equal(isDepleted(engine, id("idle")), false, "the opponent's characters restore as normal");
});

clause(NUMBA, "1:rule", "near miss: damage to a location (not a character) does not stop it restoring", () => {
  const { engine, id } = numbaBoard({ cards: [{ key: "place", def: location({ name: "Place", structure: 3 }), owner: P2, zone: "play", depleted: true }] });
  fightThrough(engine, P1, [id("n1s")], { type: "card", cardId: id("place") }, []);
  assert.equal(dmg(engine, id("place")), 1, "Numba damaged the location");
  assert.equal(isDepleted(engine, id("place")), true);
  endTurn(engine, P1);
  assert.equal(isDepleted(engine, id("place")), false, "only a damaged CHARACTER skips its restore");
});

// --- FLIP UP: 3 [D][D] ---------------------------------------------------------------

clause(NUMBA, "2:flipUp", "a face-down Numba flips up into a face-up character in play with its printed stats (str 1 / spd 3 / life 4)", () => {
  const { engine, id } = numbaBoard({ numba: "faceDown", deception: 2 });
  assert.equal(engine.isResource(id("n1s")), true, "face-down it is a resource");
  flipUpAs(engine, P1, id("n1s"));
  resolvePendingResponses(engine);
  const card = engine.state.cards[id("n1s")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, false);
  assert.deepEqual(engine.getCardTypes(id("n1s")), ["character"]);
  assert.equal(engine.getStat(id("n1s"), "strength"), 1);
  assert.equal(engine.getStat(id("n1s"), "speed"), 3);
  assert.equal(engine.getStat(id("n1s"), "life"), 4);
  assert.equal(engine.isResource(id("n1s")), false, "no longer a resource");
});

clause(NUMBA, "2:flipUp", "pays exactly 3: two [D] banks and the card itself are enough (CR 507.4b), and extra resources are not spent", () => {
  const exact = numbaBoard({ numba: "faceDown", deception: 2 });
  assert.equal(ready(exact.engine, P1), 3, "two [D] banks plus the face-down Numba");
  flipUpAs(exact.engine, P1, exact.id("n1s"));
  assert.equal(exact.engine.state.cards[exact.id("n1s")].faceDown, false);
  assert.equal(ready(exact.engine, P1), 0, "all 3 spent; Numba stopped being a resource");
  const more = numbaBoard({ numba: "faceDown", deception: 2, rage: 4 });
  assert.equal(ready(more.engine, P1), 7);
  flipUpAs(more.engine, P1, more.id("n1s"));
  assert.equal(ready(more.engine, P1), 3, "7 - 3 paid - 1 (Numba stopped being a resource)");
});

clause(NUMBA, "2:flipUp", "is refused one resource short: a single [D] bank plus itself is only 2", () => {
  const { engine, id } = numbaBoard({ numba: "faceDown", deception: 1 });
  assert.equal(ready(engine, P1), 2);
  refused(() => flipUpAs(engine, P1, id("n1s")), "cost 3 but only 2 resources");
  assert.equal(engine.state.cards[id("n1s")].faceDown, true, "still face-down");
  assert.equal(ready(engine, P1), 2, "nothing was paid");
});

clause(NUMBA, "2:flipUp", "needs [D][D]: one [D] among plenty of resources, or none, is refused (the card's own deploy threshold is only [D])", () => {
  const one = numbaBoard({ numba: "faceDown", deception: 1, rage: 4 });
  refused(() => flipUpAs(one.engine, P1, one.id("n1s")), "enough resources but only one [D]", /threshold/i);
  assert.equal(one.engine.state.cards[one.id("n1s")].faceDown, true);
  assert.equal(ready(one.engine, P1), 6, "nothing was paid");
  const none = numbaBoard({ numba: "faceDown", rage: 6 });
  refused(() => flipUpAs(none.engine, P1, none.id("n1s")), "no [D] at all", /threshold/i);
  assert.equal(none.engine.state.cards[none.id("n1s")].faceDown, true);
  // control: the same single [D] does deploy Numba from hand (printed threshold [D])
  const hand = numbaBoard({ numba: "hand", deception: 1, rage: 2 });
  play(hand.engine, P1, hand.id("n1s"));
  assert.equal(zoneOf(hand.engine, hand.id("n1s")), "play");
});

clause(NUMBA, "2:flipUp", "Numba is TACTICAL, so a face-down one can be flipped up inside the opponent's attack window", () => {
  const b = numbaBoard({ active: P2, numba: "faceDown", deception: 2, cards: [FOE_ATK] });
  refused(() => flipUpAs(b.engine, P1, b.id("n1s")), "no tactic window open on the opponent's turn yet");
  assert.equal(b.engine.state.cards[b.id("n1s")].faceDown, true);
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  flipUpAs(b.engine, P1, b.id("n1s"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("n1s")].faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("n1s")), "play");
});

// =====================================================================================
// Opportunistic Pirate — character, rogue, cost 7, [D][D], 4/5/1 (strength/speed/life), subtype pirate
// TACTICAL -- COST: You may remove up to 4 cards in an opponent's discard pile from the game. If you do,
// reduce this card's numeric cost by the number of cards removed.
// =====================================================================================

const PIRATE = "81f3e9be-87fd-4626-9206-c54b6d7be32e";

function pirateBoard(opts: { active?: PlayerId; deception?: number; rage?: number; oppDiscard?: number; cards?: CardPlacement[] } = {}) {
  const foes = Array.from({ length: opts.oppDiscard ?? 5 }, (_, i): CardPlacement => ({ key: `g${i + 1}`, def: chr(`G${i + 1}`), owner: P2, zone: "discard" }));
  return duo(
    [
      { key: "op", def: printing(PIRATE), owner: P1, zone: "hand" },
      ...foes,
      { key: "mine", def: chr("MineDiscarded"), owner: P1, zone: "discard" },
      { key: "foeHand", def: chr("FoeHand"), owner: P2, zone: "hand" },
      { key: "foeDeck", def: chr("FoeDeck"), owner: P2, zone: "deck" },
      { key: "foePlay", def: chr("FoePlay"), owner: P2, zone: "play" },
      ...bank("deception", opts.deception ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.cards ?? [])
    ],
    { active: opts.active }
  );
}
type PirateGame = ReturnType<typeof pirateBoard>;
const playPirate = (b: PirateGame, keys: string[]): void => play(b.engine, P1, b.id("op"), { selected: { rem: keys.map((k) => b.id(k)) } });
const playPirateRaw = (b: PirateGame, keys: string[]): void => {
  playRaw(b.engine, P1, b.id("op"), { selected: { rem: keys.map((k) => b.id(k)) } });
};

clause(PIRATE, "0:kw:TACTICAL", "has the TACTICAL keyword (an ordinary character does not)", () => {
  const b = pirateBoard({ cards: [{ key: "plain", def: chr("Plain"), owner: P1, zone: "play" }] });
  assert.ok(b.engine.getKeywords(b.id("op")).includes("tactical"), "b.engine.getKeywords(b.id(\"op\")).includes(\"tactical\")");
  assert.equal(b.engine.getKeywords(b.id("plain")).includes("tactical"), false, "control: an ordinary character is not tactical");
});

clause(PIRATE, "0:kw:TACTICAL", "from hand it deploys in the opponent's attack window for its printed cost 7; an ordinary character cannot", () => {
  const b = pirateBoard({ active: P2, deception: 7, cards: [FOE_ATK, { key: "plain", def: chr("Plain", { cost: 1 }), owner: P1, zone: "hand" }] });
  refused(() => play(b.engine, P1, b.id("op")), "no tactic window yet");
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => play(b.engine, P1, b.id("plain")), "a non-tactical character can't be deployed in the opponent's window");
  const before = ready(b.engine, P1);
  play(b.engine, P1, b.id("op"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("op")), "play");
  assert.equal(before - ready(b.engine, P1), 7, "full cost 7 with nothing removed");
});

clause(PIRATE, "0:kw:TACTICAL", "TACTICAL changes the timing only: in the window cost 7 and [D][D] are still required (6 resources / no [D] refused)", () => {
  const attack = (opts: { deception?: number; rage?: number }) => {
    const b = pirateBoard({ active: P2, ...opts, cards: [FOE_ATK] });
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    return b;
  };
  const short = attack({ deception: 6 });
  refused(() => play(short.engine, P1, short.id("op")), "one short of cost 7");
  assert.equal(zoneOf(short.engine, short.id("op")), "hand");
  const noIcons = attack({ rage: 9 });
  refused(() => play(noIcons.engine, P1, noIcons.id("op")), "cost covered but no [D][D]", /threshold/i);
  assert.equal(zoneOf(noIcons.engine, noIcons.id("op")), "hand");
  const oneIcon = attack({ deception: 1, rage: 8 });
  refused(() => play(oneIcon.engine, P1, oneIcon.id("op")), "only one [D]", /threshold/i);
  const ok = attack({ deception: 2, rage: 5 });
  play(ok.engine, P1, ok.id("op"));
  assert.equal(zoneOf(ok.engine, ok.id("op")), "play", "control: exactly 7 with [D][D]");
});

clause(PIRATE, "0:kw:TACTICAL", "the removal extra cost works inside the window too: removing 3 cards deploys it for 4", () => {
  const b = pirateBoard({ active: P2, deception: 4, cards: [FOE_ATK] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  playPirate(b, ["g1", "g2", "g3"]);
  assert.equal(zoneOf(b.engine, b.id("op")), "play");
  assert.equal(ready(b.engine, P1), 0, "7 - 3 = 4 paid");
});

clause(PIRATE, "1:ability", "declining the removal (picking no cards) deploys it for the full 7 and removes nothing", () => {
  const b = pirateBoard({ deception: 8 });
  const oppBefore = discardOf(b.engine, P2);
  playPirate(b, []);
  assert.equal(zoneOf(b.engine, b.id("op")), "play");
  assert.equal(8 - ready(b.engine, P1), 7, "7 paid");
  assert.deepEqual(discardOf(b.engine, P2), oppBefore, "the opponent's discard pile is untouched");
  assert.equal(pending(b.engine), undefined);
});

clause(PIRATE, "1:ability", "declining is refused when only 6 resources are available (the full cost 7 applies)", () => {
  const b = pirateBoard({ deception: 6 });
  refused(() => playPirate(b, []), "cost 7 with 6 resources");
  assert.equal(zoneOf(b.engine, b.id("op")), "hand");
  assert.equal(ready(b.engine, P1), 6);
  playPirate(b, ["g1"]);
  assert.equal(zoneOf(b.engine, b.id("op")), "play", "control: removing one card reduces it to 6");
});

clause(PIRATE, "1:ability", "removing N cards (1 to 4) removes exactly those from the game and reduces the cost by N", () => {
  for (const n of [1, 2, 3, 4]) {
    const b = pirateBoard({ deception: 7 });
    const picked = Array.from({ length: n }, (_, i) => `g${i + 1}`);
    playPirate(b, picked);
    assert.equal(zoneOf(b.engine, b.id("op")), "play", `deployed after removing ${n}`);
    assert.equal(7 - ready(b.engine, P1), 7 - n, `cost ${7 - n} paid after removing ${n}`);
    for (const key of picked) {
      assert.equal(zoneOf(b.engine, b.id(key)), "removed", `${key} was removed from the game`);
      assert.equal(discardOf(b.engine, P2).includes(b.id(key)), false, `${key} left the discard pile`);
    }
    for (const key of ["g1", "g2", "g3", "g4", "g5"].filter((k) => !picked.includes(k))) {
      assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} stays in the discard pile`);
    }
    assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "my own discard pile is untouched");
  }
});

clause(PIRATE, "1:ability", "removing fewer cards leaves the cost higher: removing 2 with only 4 resources is refused, removing 3 is exactly affordable", () => {
  const b = pirateBoard({ deception: 4 });
  refused(() => playPirate(b, ["g1", "g2"]), "removing 2 leaves a cost of 5");
  assert.equal(zoneOf(b.engine, b.id("op")), "hand");
  assert.equal(zoneOf(b.engine, b.id("g1")), "discard", "nothing was removed when the deploy failed");
  assert.equal(zoneOf(b.engine, b.id("g2")), "discard");
  assert.equal(ready(b.engine, P1), 4, "nothing was paid");
  playPirate(b, ["g1", "g2", "g3"]);
  assert.equal(zoneOf(b.engine, b.id("op")), "play", "removing 3 leaves a cost of 4");
});

clause(PIRATE, "1:ability", "up to 4: removing 5 cards is refused", () => {
  const b = pirateBoard({ deception: 7 });
  refused(() => playPirate(b, ["g1", "g2", "g3", "g4", "g5"]), "five cards");
  assert.equal(zoneOf(b.engine, b.id("op")), "hand");
  for (const key of ["g1", "g2", "g3", "g4", "g5"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard");
  playPirate(b, ["g1", "g2", "g3", "g4"]);
  assert.equal(zoneOf(b.engine, b.id("op")), "play", "control: four is allowed");
  assert.equal(ready(b.engine, P1), 4, "cost 3 after removing four");
});

clause(PIRATE, "1:ability", "only cards in an OPPONENT's discard pile: my own discard pile and the opponent's hand, deck and play are refused", () => {
  const b = pirateBoard({ deception: 7 });
  for (const key of ["mine", "foeHand", "foeDeck", "foePlay"]) {
    refused(() => playPirateRaw(b, [key]), `${key} is not in an opponent's discard pile`);
    assert.equal(zoneOf(b.engine, b.id("op")), "hand", `${key}: nothing played`);
  }
  refused(() => playPirateRaw(b, ["g1", "mine"]), "a legal pick plus my own discarded card");
  assert.equal(zoneOf(b.engine, b.id("g1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  playPirate(b, ["g1"]);
  assert.equal(zoneOf(b.engine, b.id("op")), "play", "control: an opponent's discarded card is accepted");
  assert.equal(zoneOf(b.engine, b.id("g1")), "removed");
});

clause(PIRATE, "1:ability", "the cost reduction does not waive the threshold: removing 4 for a cost of 3 still needs [D][D]", () => {
  const none = pirateBoard({ rage: 4 });
  refused(() => playPirate(none, ["g1", "g2", "g3", "g4"]), "cost 3 covered by Rage but no [D][D]", /threshold/i);
  assert.equal(zoneOf(none.engine, none.id("op")), "hand");
  assert.equal(zoneOf(none.engine, none.id("g1")), "discard", "nothing removed");
  const ok = pirateBoard({ deception: 2, rage: 1 });
  playPirate(ok, ["g1", "g2", "g3", "g4"]);
  assert.equal(zoneOf(ok.engine, ok.id("op")), "play", "control: [D][D] plus one more resource pays 3");
});

clause(PIRATE, "1:ability", "up to 4 of however many exist: an opponent with only 2 discarded cards lets me remove those 2 for a cost of 5", () => {
  const b = pirateBoard({ deception: 5, oppDiscard: 2 });
  playPirate(b, ["g1", "g2"]);
  assert.equal(zoneOf(b.engine, b.id("op")), "play");
  assert.equal(ready(b.engine, P1), 0, "5 paid");
  assert.equal(zoneOf(b.engine, b.id("g1")), "removed");
  assert.equal(zoneOf(b.engine, b.id("g2")), "removed");
});

// =====================================================================================
// Parkour Hoodlum — character, rogue, cost 3, [D][D], 3/4/1 (strength/speed/life), subtype daredevil
// While this card is in your hand and there is a location in play, this card gains tactical.
// This card ignores all rules text on locations. (this card cannot be picked by locations and any effects
// from locations do not affect this card.)
// =====================================================================================

const HOODLUM = "f6404aff-0a09-46f8-b146-97f746546ff4";

function hoodBoard(opts: { active?: PlayerId; zone?: "hand" | "play" | "deck" | "discard"; faceDown?: boolean; deception?: number; rage?: number; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "ph", def: printing(HOODLUM), owner: P1, zone: opts.zone ?? "hand", faceDown: opts.faceDown ? true : undefined },
      ...bank("deception", opts.deception ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.cards ?? [])
    ],
    { active: opts.active }
  );
}
const LOC_FOE: CardPlacement = { key: "loc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" };
const LOC_MINE: CardPlacement = { key: "loc", def: location({ name: "MyLoc" }), owner: P1, zone: "play" };
const hasTactical = (b: { engine: SpoilsEngine; id: Ids }, key = "ph"): boolean => b.engine.getKeywords(b.id(key)).includes("tactical");

clause(HOODLUM, "0:rule", "in hand with a location in play (the opponent's) it has TACTICAL; an ordinary character in hand does not", () => {
  const b = hoodBoard({ cards: [LOC_FOE, { key: "plain", def: chr("Plain"), owner: P1, zone: "hand" }] });
  assert.equal(hasTactical(b), true);
  assert.equal(hasTactical(b, "plain"), false, "control: an ordinary character in hand is not tactical");
});

clause(HOODLUM, "0:rule", "any location in play counts, including my own", () => {
  const b = hoodBoard({ cards: [LOC_MINE] });
  assert.equal(hasTactical(b), true);
});

clause(HOODLUM, "0:rule", "without a location in play it does not have TACTICAL (no location, or a location only in hand / discard / deck)", () => {
  const none = hoodBoard();
  assert.equal(hasTactical(none), false, "no location anywhere");
  const elsewhere = hoodBoard({
    cards: [
      { key: "lh", def: location({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "ld", def: location({ name: "InDiscard" }), owner: P2, zone: "discard" },
      { key: "lk", def: location({ name: "InDeck" }), owner: P2, zone: "deck" }
    ]
  });
  assert.equal(hasTactical(elsewhere), false, "locations that are not in play do not count");
  const withLoc = hoodBoard({ cards: [LOC_FOE] });
  assert.equal(hasTactical(withLoc), true, "control");
});

clause(HOODLUM, "0:rule", "only while the Hoodlum is in hand: in play, in my discard pile or in my deck it has no TACTICAL even with a location in play", () => {
  for (const zone of ["play", "discard", "deck"] as const) {
    const b = hoodBoard({ zone, cards: [LOC_FOE] });
    assert.equal(hasTactical(b), false, `in ${zone}`);
  }
  const faceDown = hoodBoard({ zone: "play", faceDown: true, cards: [LOC_FOE] });
  assert.equal(hasTactical(faceDown), false, "face-down in play (a resource) is not in hand");
});

clause(HOODLUM, "0:rule", "the TACTICAL ends when the last location leaves play", () => {
  const b = hoodBoard({
    rage: 6,
    cards: [
      LOC_FOE,
      {
        key: "kill",
        def: killTactic({
          behavior: {
            abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
          }
        }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
  assert.equal(hasTactical(b), true, "while the location is in play");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("loc")] } });
  assert.notEqual(zoneOf(b.engine, b.id("loc")), "play", "the location was destroyed");
  assert.equal(hasTactical(b), false, "no location left, no TACTICAL");
  assert.equal(zoneOf(b.engine, b.id("ph")), "hand");
});

clause(HOODLUM, "0:rule", "TACTICAL means it can be deployed in the opponent's attack window with a location in play (cost 3 paid), not without one", () => {
  const withLoc = hoodBoard({ active: P2, deception: 3, cards: [LOC_FOE, FOE_ATK] });
  declareAttackOpenWindow(withLoc.engine, P2, [withLoc.id("atk")]);
  const before = ready(withLoc.engine, P1);
  play(withLoc.engine, P1, withLoc.id("ph"));
  assert.equal(pending(withLoc.engine), undefined);
  assert.equal(zoneOf(withLoc.engine, withLoc.id("ph")), "play", "deployed on the opponent's turn");
  assert.equal(before - ready(withLoc.engine, P1), 3);
  const without = hoodBoard({ active: P2, deception: 3, cards: [FOE_ATK] });
  declareAttackOpenWindow(without.engine, P2, [without.id("atk")]);
  refused(() => play(without.engine, P1, without.id("ph")), "no location in play, so no TACTICAL (with a location it deploys above)", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(without.engine, without.id("ph")), "hand");
});

clause(HOODLUM, "0:rule", "the granted TACTICAL changes timing only: in the window cost 3 and [D][D] are still required", () => {
  const attack = (opts: { deception?: number; rage?: number }) => {
    const b = hoodBoard({ active: P2, ...opts, cards: [LOC_FOE, FOE_ATK] });
    declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
    return b;
  };
  const short = attack({ deception: 2 });
  refused(() => play(short.engine, P1, short.id("ph")), "one short of cost 3");
  const noIcons = attack({ rage: 5 });
  refused(() => play(noIcons.engine, P1, noIcons.id("ph")), "cost covered but no [D][D]", /threshold/i);
  const oneIcon = attack({ deception: 1, rage: 4 });
  refused(() => play(oneIcon.engine, P1, oneIcon.id("ph")), "only one [D]", /threshold/i);
  const ok = attack({ deception: 2, rage: 1 });
  play(ok.engine, P1, ok.id("ph"));
  assert.equal(zoneOf(ok.engine, ok.id("ph")), "play", "control: 3 resources with [D][D]");
});

// --- ignores all rules text on locations ------------------------------------------------

/** A location whose rules text is aimed at characters in four different ways. */
const rulesLocation = (name: string): CardDefinition =>
  location({
    name,
    behavior: {
      abilities: [
        { id: "aura-str", type: "continuous", modifiers: [{ selector: { zone: "play", type: "character" }, stat: "strength", operation: "add", value: 2 }] },
        { id: "aura-kw", type: "continuous", modifiers: [], keywords: [{ selector: { zone: "play", type: "character" }, keyword: "covert" }] },
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        },
        {
          id: "smite",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        },
        {
          id: "sweep",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        },
        {
          id: "scald",
          type: "activated",
          effects: [{ type: "forEach", selector: { zone: "play", type: "character" }, effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 1 }] }]
        }
      ]
    }
  } as Partial<CardDefinition>);

function ignoreBoard(locOwner: PlayerId = P1, active: PlayerId = P1) {
  return duo([
    { key: "ph", def: printing(HOODLUM), owner: P1, zone: "play" },
    { key: "mate", def: chr("Mate", { life: 4 }), owner: P1, zone: "play" },
    { key: "foe", def: chr("Foe", { life: 4 }), owner: P2, zone: "play" },
    { key: "loc", def: rulesLocation("RulesLoc"), owner: locOwner, zone: "play" }
  ], { active });
}

clause(HOODLUM, "1:rule", "a location's continuous stat aura (+2 strength to every character) does not affect the Hoodlum (str 3); everyone else gets it", () => {
  const { engine, id } = ignoreBoard();
  assert.equal(engine.getStat(id("mate"), "strength"), 4, "control: my other character gets +2");
  assert.equal(engine.getStat(id("foe"), "strength"), 4, "control: the opponent's character gets +2");
  assert.equal(engine.getStat(id("ph"), "strength"), 3, "the Hoodlum keeps its printed strength 3");
});

clause(HOODLUM, "1:rule", "a location's keyword aura (every character gains COVERT) does not give the Hoodlum the keyword", () => {
  const { engine, id } = ignoreBoard();
  assert.ok(engine.getKeywords(id("mate")).includes("covert"), "control: another character gains COVERT from the location");
  assert.equal(engine.getKeywords(id("ph")).includes("covert"), false, "the Hoodlum does not");
});

clause(HOODLUM, "1:rule", "a location cannot pick the Hoodlum as a target: damage, destroy; other characters can be picked", () => {
  const { engine, id } = ignoreBoard();
  for (const abilityId of ["zap", "smite"]) {
    refused(() => activate(engine, P1, id("loc"), abilityId, { selected: { t: [id("ph")] } }), `${abilityId} can't pick the Hoodlum`);
    assert.equal(zoneOf(engine, id("ph")), "play");
    assert.equal(dmg(engine, id("ph")), 0);
  }
  activate(engine, P1, id("loc"), "zap", { selected: { t: [id("mate")] } });
  assert.equal(dmg(engine, id("mate")), 1, "control: zap can pick another character");
  activate(engine, P1, id("loc"), "smite", { selected: { t: [id("foe")] } });
  assert.notEqual(zoneOf(engine, id("foe")), "play", "control: smite can pick another character");
});

clause(HOODLUM, "1:rule", "a location's sweeping 'each character' effects (damage, destroy) do not affect the Hoodlum (life 1)", () => {
  const scald = ignoreBoard();
  activate(scald.engine, P1, scald.id("loc"), "scald");
  assert.equal(dmg(scald.engine, scald.id("mate")), 1, "control: another character is damaged");
  assert.equal(dmg(scald.engine, scald.id("foe")), 1, "control: the opponent's character is damaged");
  assert.equal(zoneOf(scald.engine, scald.id("ph")), "play", "the Hoodlum (life 1) survives");
  assert.equal(dmg(scald.engine, scald.id("ph")), 0, "and takes no damage");
  const sweep = ignoreBoard();
  activate(sweep.engine, P1, sweep.id("loc"), "sweep");
  assert.notEqual(zoneOf(sweep.engine, sweep.id("mate")), "play", "control: another character is destroyed");
  assert.notEqual(zoneOf(sweep.engine, sweep.id("foe")), "play", "control: the opponent's character is destroyed");
  assert.equal(zoneOf(sweep.engine, sweep.id("ph")), "play", "the Hoodlum is not destroyed");
});

clause(HOODLUM, "1:rule", "the same holds for the opponent's location", () => {
  const { engine, id } = ignoreBoard(P2, P2);
  assert.equal(engine.getStat(id("ph"), "strength"), 3);
  assert.equal(engine.getStat(id("mate"), "strength"), 4);
  refused(() => activate(engine, P2, id("loc"), "zap", { selected: { t: [id("ph")] } }), "an opponent's location can't pick it either");
  activate(engine, P2, id("loc"), "zap", { selected: { t: [id("mate")] } });
  assert.equal(dmg(engine, id("mate")), 1, "control: the opponent's location can pick my other character");
});

clause(HOODLUM, "1:rule", "only LOCATIONS are ignored: an item's identical effects still pick and modify the Hoodlum", () => {
  const { engine, id } = duo([
    { key: "ph", def: printing(HOODLUM), owner: P1, zone: "play" },
    { key: "loc", def: location({ name: "Plain" }), owner: P1, zone: "play" },
    {
      key: "gadget",
      def: item({
        name: "Gadget",
        behavior: {
          abilities: [
            { id: "aura-str", type: "continuous", modifiers: [{ selector: { zone: "play", type: "character" }, stat: "strength", operation: "add", value: 2 }] },
            {
              id: "zap",
              type: "activated",
              targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
              effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
            }
          ]
        }
      } as Partial<CardDefinition>),
      owner: P2,
      zone: "play"
    }
  ], { active: P2 });
  assert.equal(engine.getStat(id("ph"), "strength"), 5, "an item's aura does affect the Hoodlum (3 + 2)");
  activate(engine, P2, id("gadget"), "zap", { selected: { t: [id("ph")] } });
  assert.notEqual(zoneOf(engine, id("ph")), "play", "and an item's ability can pick and damage it: 1 damage kills the life-1 Hoodlum");
});

// =====================================================================================
// Sickened Sarcophyle — character, rogue, cost 4, [D][D], 3/4/1 (strength/speed/life), subtype sarcophyle. No rules text.
// =====================================================================================

const SARCO = "d96ae660-1e24-4f75-9b4f-75d359459322";

function sarcoBoard(opts: { deception?: number; rage?: number; active?: PlayerId; cards?: CardPlacement[] } = {}) {
  return duo(
    [
      { key: "ss", def: printing(SARCO), owner: P1, zone: "hand" },
      ...bank("deception", opts.deception ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.cards ?? [])
    ],
    { active: opts.active }
  );
}

clause(SARCO, "vanilla", "deploys for exactly its printed cost 4 (four resources spent) with its printed stats 3 / 4 / 1 and no keywords", () => {
  const b = sarcoBoard({ deception: 5 });
  const before = ready(b.engine, P1);
  play(b.engine, P1, b.id("ss"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("ss")), "play");
  assert.equal(before - ready(b.engine, P1), 4, "four resources spent, no more");
  assert.deepEqual(b.engine.getCardTypes(b.id("ss")), ["character"]);
  assert.equal(b.engine.getStat(b.id("ss"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("ss"), "speed"), 4);
  assert.equal(b.engine.getStat(b.id("ss"), "life"), 1);
  assert.deepEqual(b.engine.getKeywords(b.id("ss")), [], "no keywords");
});

clause(SARCO, "vanilla", "is refused one resource short (3 of 4) and stays in hand", () => {
  const b = sarcoBoard({ deception: 3 });
  refused(() => play(b.engine, P1, b.id("ss")), "3 resources for cost 4");
  assert.equal(zoneOf(b.engine, b.id("ss")), "hand");
  assert.equal(ready(b.engine, P1), 3, "nothing was paid");
});

clause(SARCO, "vanilla", "needs [D][D]: plenty of other resources, or a single [D], is refused", () => {
  const none = sarcoBoard({ rage: 8 });
  refused(() => play(none.engine, P1, none.id("ss")), "no [D] at all", /threshold/i);
  assert.equal(zoneOf(none.engine, none.id("ss")), "hand");
  const one = sarcoBoard({ deception: 1, rage: 6 });
  refused(() => play(one.engine, P1, one.id("ss")), "only one [D]", /threshold/i);
  assert.equal(zoneOf(one.engine, one.id("ss")), "hand");
  const ok = sarcoBoard({ deception: 2, rage: 2 });
  play(ok.engine, P1, ok.id("ss"));
  assert.equal(zoneOf(ok.engine, ok.id("ss")), "play", "control: [D][D] and four resources");
});

clause(SARCO, "vanilla", "is not TACTICAL: it cannot be deployed in the opponent's attack window", () => {
  const b = sarcoBoard({ active: P2, deception: 6, cards: [FOE_ATK] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => play(b.engine, P1, b.id("ss")), "a vanilla character isn't a tactic", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(b.engine, b.id("ss")), "hand");
});

// =====================================================================================
// Sharpey Pointy Lethal Army Tool — item, rogue, cost 2, [D], subtype gear
// ATTACH TO CHARACTER YOU CONTROL -- The attached character gains 2 strength. -- UNFOLD -- COST: Pay 2.
// Deplete the attached character. Reveal the top card of your deck. -- EFFECT: If the revealed card has a
// numeric cost of 5 or higher, all characters your opponents control lose 1 life. If the revealed card has a
// numeric cost of 0-4, destroy the attached character. If the revealed card is a resource, destroy the
// attached character and destroy all characters your opponents control.
// =====================================================================================

const SHARPEY = "c6e93f75-e05d-4dfb-a77d-c74b662a7c02";
const UNFOLD = "sharpey-unfold";

function attachBoard(opts: { deception?: number; rage?: number; active?: PlayerId } = {}) {
  return duo(
    [
      { key: "sp", def: printing(SHARPEY), owner: P1, zone: "hand" },
      { key: "mine", def: chr("Mine", { strength: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: chr("Mine2"), owner: P1, zone: "play" },
      { key: "foe", def: chr("Foe"), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: chr("Hidden"), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: chr("InHand"), owner: P1, zone: "hand" },
      { key: "inDiscard", def: chr("InDiscard"), owner: P1, zone: "discard" },
      ...bank("deception", opts.deception ?? 3, P1),
      ...bank("rage", opts.rage ?? 0, P1)
    ],
    { active: opts.active }
  );
}
type AttachGame = ReturnType<typeof attachBoard>;
const attachTo = (b: AttachGame, hostId: CardInstanceId): void => play(b.engine, P1, b.id("sp"), { selected: { attachTo: [hostId] } });
const attachAttempt = (b: AttachGame, hostId: CardInstanceId) => () => {
  playRaw(b.engine, P1, b.id("sp"), { selected: { attachTo: [hostId] } });
};

clause(SHARPEY, "0:attach", "attaches to a character I control: it enters play attached to that character and the printed cost 2 is paid", () => {
  const b = attachBoard();
  const before = ready(b.engine, P1);
  attachTo(b, b.id("mine"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("sp")), "play");
  assert.equal(b.engine.state.cards[b.id("sp")].attachedTo, b.id("mine"), "attached to the picked character");
  assert.equal(before - ready(b.engine, P1), 2, "the printed cost of 2 is paid");
  assert.equal(b.engine.state.cards[b.id("mine2")].attachedTo, undefined);
});

clause(SHARPEY, "0:attach", "is refused for a character I do not control (an opponent's)", () => {
  const b = attachBoard();
  refused(attachAttempt(b, b.id("foe")), "ATTACH TO CHARACTER YOU CONTROL: the opponent's character is not a legal host");
  assert.equal(zoneOf(b.engine, b.id("sp")), "hand", "nothing was played");
  assert.equal(b.engine.state.cards[b.id("sp")].attachedTo, undefined);
  attachAttempt(b, b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "control: my own character is accepted");
});

clause(SHARPEY, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card, a card in hand or in a discard pile", () => {
  const b = attachBoard();
  const refusedHosts: Array<[string, CardInstanceId]> = [
    ["an item", b.id("thing")],
    ["a location", b.id("place")],
    ["my faction", b.engine.state.players[P1].factionId!],
    ["the opponent's faction", b.engine.state.players[P2].factionId!],
    ["a face-down card (only a resource)", b.id("hidden")],
    ["a character in hand", b.id("inHand")],
    ["a character in a discard pile", b.id("inDiscard")]
  ];
  for (const [why, hostId] of refusedHosts) refused(attachAttempt(b, hostId), why);
  assert.equal(zoneOf(b.engine, b.id("sp")), "hand", "nothing was played");
  attachAttempt(b, b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "control: a character I control is accepted");
});

clause(SHARPEY, "0:attach", "needs exactly one host: no pick, no selection at all, and two picks are refused", () => {
  const b = attachBoard();
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { attachTo: [] } }), "no host picked");
  refused(() => playRaw(b.engine, P1, b.id("sp"), {}), "no selection at all");
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { attachTo: [b.id("mine"), b.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("sp")), "hand");
});

clause(SHARPEY, "0:attach", "its own cost and threshold still apply: one resource short of 2 and no [D] are refused", () => {
  const short = attachBoard({ deception: 1 });
  refused(() => attachTo(short, short.id("mine")), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("sp")), "hand");
  const noIcon = attachBoard({ deception: 0, rage: 5 });
  refused(() => attachTo(noIcon, noIcon.id("mine")), "cost covered but no [D]", /threshold/i);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("sp")), "hand");
  const ok = attachBoard({ deception: 1, rage: 1 });
  attachTo(ok, ok.id("mine"));
  assert.equal(zoneOf(ok.engine, ok.id("sp")), "play", "control: exactly 2 resources with one [D]");
});

// --- The attached character gains 2 strength ---------------------------------------------

const withSharpey = (extra: CardPlacement[] = [], opts: { active?: PlayerId } = {}) =>
  duo(
    [
      { key: "host", def: chr("Host", { strength: 2, life: 4 }), owner: P1, zone: "play" },
      { key: "mate", def: chr("Mate", { strength: 2 }), owner: P1, zone: "play" },
      { key: "sp", def: printing(SHARPEY), owner: P1, zone: "play", attachedToKey: "host" },
      ...extra
    ],
    opts
  );

clause(SHARPEY, "1:rule", "the attached character gains 2 strength (2 -> 4); other characters are unchanged", () => {
  const { engine, id } = withSharpey([{ key: "foe", def: chr("Foe", { strength: 2 }), owner: P2, zone: "play" }]);
  assert.equal(engine.getStat(id("host"), "strength"), 4);
  assert.equal(engine.getStat(id("mate"), "strength"), 2, "my other character is unchanged");
  assert.equal(engine.getStat(id("foe"), "strength"), 2, "the opponent's character is unchanged");
  assert.equal(engine.getStat(id("host"), "life"), 4, "only strength changes");
  assert.equal(engine.getStat(id("host"), "speed"), 2, "only strength changes");
});

clause(SHARPEY, "1:rule", "the bonus is real battle damage: the attached host hits an unblocked faction for 4", () => {
  const { engine, id } = withSharpey();
  const before = engine.state.players[P2].influence;
  fightThrough(engine, P1, [id("host")], toFaction(P2), []);
  assert.equal(before - engine.state.players[P2].influence, 4);
});

clause(SHARPEY, "1:rule", "two Sharpeys on one host stack (+4)", () => {
  const { engine, id } = withSharpey([{ key: "sp2", def: printing(SHARPEY), owner: P1, zone: "play", attachedToKey: "host" }]);
  assert.equal(engine.getStat(id("host"), "strength"), 6);
});

clause(SHARPEY, "1:rule", "the bonus ends when Sharpey leaves play", () => {
  const { engine, id } = withSharpey([
    {
      key: "kill",
      def: killTactic({
        behavior: {
          abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
        }
      }),
      owner: P1,
      zone: "hand"
    },
    ...bank("rage", 2, P1)
  ]);
  assert.equal(engine.getStat(id("host"), "strength"), 4);
  play(engine, P1, id("kill"), { selected: { t: [id("sp")] } });
  assert.equal(zoneOf(engine, id("sp")), "discard", "Sharpey was destroyed");
  assert.equal(engine.getStat(id("host"), "strength"), 2, "the bonus is gone");
});

clause(SHARPEY, "1:rule", "when the host leaves play Sharpey goes to my discard pile and stops giving anything", () => {
  const { engine, id } = withSharpey([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, ...bank("rage", 2, P1)]);
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard", "the host was destroyed");
  assert.equal(zoneOf(engine, id("sp")), "discard", "an attached card whose host left play goes to its owner's discard pile");
  assert.equal(engine.getStat(id("mate"), "strength"), 2, "no other character got the bonus");
});

// --- UNFOLD ------------------------------------------------------------------------------

type Top = CardDefinition | undefined;
const topCost = (cost: number): CardDefinition => chr("TopChar", { cost });
const topResource = (): CardDefinition => resourceCard({ name: "TopRes" });

function unfoldBoard(opts: { top?: Top; rage?: number; hostDepleted?: boolean; foeLife?: number; active?: PlayerId } = {}) {
  const deck: CardPlacement[] = opts.top
    ? [
        { key: "top", def: opts.top, owner: P1, zone: "deck" },
        { key: "d2", def: chr("D2"), owner: P1, zone: "deck" },
        { key: "d3", def: chr("D3"), owner: P1, zone: "deck" }
      ]
    : [];
  const b = duo(
    [
      { key: "host", def: chr("Host", { strength: 2, life: 4 }), owner: P1, zone: "play", depleted: opts.hostDepleted ? true : undefined },
      { key: "sp", def: printing(SHARPEY), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "mine2", def: chr("Mine2", { life: 3 }), owner: P1, zone: "play" },
      { key: "o1", def: chr("Foe1", { life: opts.foeLife ?? 3 }), owner: P2, zone: "play" },
      { key: "o2", def: chr("Foe2", { life: opts.foeLife ?? 3 }), owner: P2, zone: "play" },
      { key: "stolen", def: chr("Stolen", { life: 3 }), owner: P2, controller: P1, zone: "play" },
      { key: "lost", def: chr("Lost", { life: 3 }), owner: P1, controller: P2, zone: "play" },
      { key: "oItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "oLoc", def: location({ name: "FoeLoc" }), owner: P2, zone: "play" },
      ...deck,
      ...bank("rage", opts.rage ?? 2, P1),
      ...bank("greed", 1, P2)
    ],
    { active: opts.active }
  );
  if (opts.top) assert.equal(b.engine.state.players[P1].deck[0], b.id("top"), "the placed 'top' card is the top of the deck");
  return b;
}
type UnfoldGame = ReturnType<typeof unfoldBoard>;
const unfold = (b: UnfoldGame): void => activate(b.engine, P1, b.id("sp"), UNFOLD);
const life = (b: UnfoldGame, key: string): number => b.engine.getStat(b.id(key), "life");
const alive = (b: UnfoldGame, key: string): boolean => zoneOf(b.engine, b.id(key)) === "play";
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];

type RevealEvent = { type: "cardsRevealed"; cardIds: CardInstanceId[]; zone: string; ownerId: PlayerId; viewerId: string };
const revealsOf = (engine: SpoilsEngine): RevealEvent[] =>
  engine
    .getLog()
    .map((entry) => entry.event as unknown as RevealEvent | undefined)
    .filter((event): event is RevealEvent => event?.type === "cardsRevealed");

clause(SHARPEY, "2:ability:sharpey-unfold", "COST: pays 2 resources and depletes the attached character (not Sharpey)", () => {
  const b = unfoldBoard({ top: topCost(7), rage: 3 });
  const before = ready(b.engine, P1);
  assert.equal(isDepleted(b.engine, b.id("host")), false);
  unfold(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(before - ready(b.engine, P1), 2, "Pay 2");
  assert.equal(isDepleted(b.engine, b.id("host")), true, "the attached character is depleted");
  assert.equal(isDepleted(b.engine, b.id("sp")), false, "Sharpey itself is not depleted");
  assert.equal(isDepleted(b.engine, b.id("mine2")), false, "no other character is depleted");
});

clause(SHARPEY, "2:ability:sharpey-unfold", "COST: refused with only 1 resource, and refused when the attached character is already depleted; nothing is paid or revealed", () => {
  const poor = unfoldBoard({ top: topCost(7), rage: 1 });
  refused(() => unfold(poor), "Pay 2 with 1 resource");
  assert.equal(isDepleted(poor.engine, poor.id("host")), false, "not depleted: the ability was not used");
  assert.equal(ready(poor.engine, P1), 1, "nothing was paid");
  assert.equal(revealsOf(poor.engine).length, 0, "nothing was revealed");
  assert.equal(life(poor, "o1"), 3);
  const tapped = unfoldBoard({ top: topCost(7), rage: 2, hostDepleted: true });
  refused(() => unfold(tapped), "the attached character is already depleted and can't be depleted again");
  assert.equal(ready(tapped.engine, P1), 2, "nothing was paid");
  assert.equal(revealsOf(tapped.engine).length, 0);
  assert.equal(life(tapped, "o1"), 3, "no effect happened");
  const ok = unfoldBoard({ top: topCost(7), rage: 2 });
  unfold(ok);
  assert.equal(life(ok, "o1"), 2, "control: with 2 resources and a ready host it works");
});

clause(SHARPEY, "2:ability:sharpey-unfold", "only its controller can use it: the opponent cannot", () => {
  const b = unfoldBoard({ top: topCost(7), rage: 2 });
  refused(() => activate(b.engine, P2, b.id("sp"), UNFOLD), "an opponent can't use my gear's ability");
  assert.equal(isDepleted(b.engine, b.id("host")), false);
  assert.equal(life(b, "o1"), 3);
});

clause(SHARPEY, "2:ability:sharpey-unfold", "COST: reveals the top card of my deck to everyone, and leaves it on top of the deck", () => {
  const b = unfoldBoard({ top: topCost(2) });
  const deckBefore = deckOf(b.engine, P1);
  unfold(b);
  const reveals = revealsOf(b.engine);
  assert.equal(reveals.length, 1, "exactly one reveal");
  assert.deepEqual(reveals[0].cardIds, [b.id("top")], "the top card (only) was revealed");
  assert.equal(reveals[0].ownerId, P1);
  assert.equal(reveals[0].zone, "deck");
  assert.equal(reveals[0].viewerId, "all", "revealed to everyone");
  assert.deepEqual(deckOf(b.engine, P1), deckBefore, "revealing moves nothing: the deck is unchanged");
});

clause(SHARPEY, "2:ability:sharpey-unfold", "the reveal is part of the COST: the pay, the deplete and the reveal all happen on activation, before the opponent can respond", () => {
  const b = unfoldBoard({ top: topCost(7), rage: 2 });
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("sp"), abilityId: UNFOLD, selected: {}, variables: {} });
  assert.ok(b.engine.state.responseWindow, "the activation is waiting for responses");
  assert.equal(ready(b.engine, P1), 0, "Pay 2 was paid on activation");
  assert.equal(isDepleted(b.engine, b.id("host")), true, "the deplete was paid on activation");
  assert.equal(revealsOf(b.engine).length, 1, "the reveal (a COST) already happened");
  assert.equal(life(b, "o1"), 3, "the EFFECT has not resolved yet");
});

clause(SHARPEY, "2:ability:sharpey-unfold", "revealed cost 5 or higher (5, 7; a non-character with cost 6): every character my opponents control loses 1 life; nothing is destroyed", () => {
  const tops: Array<[string, CardDefinition]> = [
    ["a cost-5 character", topCost(5)],
    ["a cost-7 character", topCost(7)],
    ["a cost-6 item", item({ name: "TopItem", cost: 6 })]
  ];
  for (const [what, top] of tops) {
    const b = unfoldBoard({ top });
    unfold(b);
    assert.equal(pending(b.engine), undefined, what);
    assert.equal(life(b, "o1"), 2, `${what}: opponent's character 1 lost 1 life`);
    assert.equal(life(b, "o2"), 2, `${what}: opponent's character 2 lost 1 life`);
    assert.equal(life(b, "lost"), 2, `${what}: a character of mine that an opponent controls loses 1 life too`);
    assert.equal(life(b, "stolen"), 3, `${what}: an opponent's card that I control is not affected`);
    assert.equal(life(b, "mine2"), 3, `${what}: my other character is not affected`);
    assert.equal(life(b, "host"), 4, `${what}: the attached character is not affected`);
    for (const key of ["host", "mine2", "o1", "o2", "stolen", "lost", "oItem", "oLoc"]) assert.equal(alive(b, key), true, `${what}: ${key} stays in play`);
    assert.equal(zoneOf(b.engine, b.id("sp")), "play", `${what}: Sharpey stays attached`);
    assert.equal(dmg(b.engine, b.id("o1")), 0, `${what}: life loss is not damage`);
  }
});

clause(SHARPEY, "2:ability:sharpey-unfold", "the life loss is permanent: it is still there after the turn passes", () => {
  const b = unfoldBoard({ top: topCost(5) });
  unfold(b);
  assert.equal(life(b, "o1"), 2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(life(b, "o1"), 2, "still 2 two turns later");
  assert.equal(life(b, "o2"), 2);
});

clause(SHARPEY, "2:ability:sharpey-unfold", "a character with 1 life that loses 1 life (revealed cost 5+) is destroyed", () => {
  const b = unfoldBoard({ top: topCost(5), foeLife: 1 });
  unfold(b);
  assert.equal(alive(b, "o1"), false, "life 0 destroys it");
  assert.equal(alive(b, "o2"), false);
  assert.equal(alive(b, "stolen"), true, "control: stolen has life 3 and isn't affected");
  assert.equal(alive(b, "host"), true);
});

clause(SHARPEY, "2:ability:sharpey-unfold", "revealed cost 0-4 (0, 4; a non-character with cost 3): destroys the attached character (and with it Sharpey) and nothing else", () => {
  const tops: Array<[string, CardDefinition]> = [
    ["a cost-0 character", topCost(0)],
    ["a cost-4 character", topCost(4)],
    ["a cost-3 tactic", tactic({ name: "TopTactic", cost: 3 })]
  ];
  for (const [what, top] of tops) {
    const b = unfoldBoard({ top });
    unfold(b);
    assert.equal(pending(b.engine), undefined, what);
    assert.equal(zoneOf(b.engine, b.id("host")), "discard", `${what}: the attached character is destroyed`);
    assert.equal(zoneOf(b.engine, b.id("sp")), "discard", `${what}: Sharpey follows its host out of play`);
    for (const key of ["mine2", "o1", "o2", "stolen", "lost", "oItem", "oLoc"]) assert.equal(alive(b, key), true, `${what}: ${key} is untouched`);
    assert.equal(life(b, "o1"), 3, `${what}: no life lost`);
    assert.equal(life(b, "mine2"), 3);
  }
});

clause(SHARPEY, "2:ability:sharpey-unfold", "revealed resource: destroys the attached character and every character my opponents control; my other characters, their items, locations and resources stay", () => {
  const b = unfoldBoard({ top: topResource() });
  unfold(b);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("host")), "discard", "the attached character is destroyed");
  assert.equal(zoneOf(b.engine, b.id("sp")), "discard", "and Sharpey with it");
  for (const key of ["o1", "o2", "lost"]) assert.equal(alive(b, key), false, `${key} (a character an opponent controls) is destroyed`);
  assert.equal(zoneOf(b.engine, b.id("o1")), "discard");
  for (const key of ["mine2", "stolen", "oItem", "oLoc"]) assert.equal(alive(b, key), true, `${key} stays`);
  assert.equal(b.engine.state.players[P2].play.filter((cardId) => b.engine.isResource(cardId)).length, 1, "the opponent's resource stays");
  assert.ok(b.engine.state.players[P2].factionId, "and their faction");
});

clause(SHARPEY, "2:ability:sharpey-unfold", "the branches are exclusive: a cost-4 card does not wipe the opponent's characters, a resource does not also cut life", () => {
  const four = unfoldBoard({ top: topCost(4) });
  unfold(four);
  for (const key of ["o1", "o2", "lost"]) assert.equal(alive(four, key), true, `${key} survives a cost-4 reveal`);
  const res = unfoldBoard({ top: topResource() });
  unfold(res);
  assert.equal(life(res, "stolen"), 3, "the resource branch changes nobody's life");
  assert.equal(life(res, "mine2"), 3);
});

clause(SHARPEY, "2:ability:sharpey-unfold", "the revealed card stays on top of the deck whatever the branch", () => {
  for (const top of [topCost(7), topCost(2), topResource()]) {
    const b = unfoldBoard({ top });
    const deckBefore = deckOf(b.engine, P1);
    unfold(b);
    assert.deepEqual(deckOf(b.engine, P1), deckBefore, "no card left the deck");
  }
});

clause(SHARPEY, "2:ability:sharpey-unfold", "with no card in my deck nothing is revealed and none of the three outcomes happens, but the cost is still paid", () => {
  const b = unfoldBoard({ rage: 2 });
  assert.equal(deckOf(b.engine, P1).length, 0, "empty deck");
  unfold(b);
  assert.equal(ready(b.engine, P1), 0, "Pay 2 was still paid");
  assert.equal(isDepleted(b.engine, b.id("host")), true);
  assert.equal(revealsOf(b.engine).length, 0, "nothing to reveal");
  assert.equal(alive(b, "host"), true, "the attached character is not destroyed (no revealed card has cost 0-4)");
  assert.equal(life(b, "o1"), 3);
  assert.equal(alive(b, "o1"), true);
});

// =====================================================================================
// Sneaker Attack! — tactic, rogue, cost 2, [D][D]
// COST: Play this only during a battle. Deplete a character you control that is not in a battle party.
// EFFECT: Add the character you depleted to an attacking or blocking party you control. It gains 1 speed this
// turn. -- FLIP UP: 2 [D][D]
// =====================================================================================

const SNEAKER = "b324c5df-afe7-4ed3-8f10-7f0a7488bdfb";

/** P1 (active) owns the Sneaker; P1: atk (will attack), bench, bench2, depBench (depleted), thing (item); P2: blk, foeBench. */
function sneakerBoard(opts: { sneaker?: "hand" | "faceDown"; deception?: number; rage?: number; cards?: CardPlacement[] } = {}) {
  return duo([
    { key: "sa", def: printing(SNEAKER), owner: P1, zone: opts.sneaker === "faceDown" ? "play" : "hand", faceDown: opts.sneaker === "faceDown" ? true : undefined },
    { key: "atk", def: chr("Atk"), owner: P1, zone: "play" },
    { key: "bench", def: chr("Bench", { speed: 3 }), owner: P1, zone: "play" },
    { key: "bench2", def: chr("Bench2", { speed: 3 }), owner: P1, zone: "play" },
    { key: "depBench", def: chr("DepBench"), owner: P1, zone: "play", depleted: true },
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "inHand", def: chr("InHand"), owner: P1, zone: "hand" },
    { key: "blk", def: chr("Blk", { life: 9 }), owner: P2, zone: "play" },
    { key: "foeBench", def: chr("FoeBench"), owner: P2, zone: "play" },
    ...bank("deception", opts.deception ?? 2, P1),
    ...bank("rage", opts.rage ?? 0, P1),
    ...(opts.cards ?? [])
  ]);
}
type SneakerGame = ReturnType<typeof sneakerBoard>;
const declareAttack = (b: SneakerGame, keys: string[]): void =>
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: keys.map((k) => b.id(k)), target: FACTION(P2) } as never);
const chooseOption = (engine: SpoilsEngine, player: PlayerId, index: number): void =>
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsOption", index } } as never);
const pendingKind = (engine: SpoilsEngine): string | undefined => (pending(engine) as { kind?: string } | undefined)?.kind;
const sneak = (b: SneakerGame, key: string): void => play(b.engine, P1, b.id("sa"), { selected: { ch: [b.id(key)] } });
const sneakRaw = (b: SneakerGame, key: string): void => {
  playRaw(b.engine, P1, b.id("sa"), { selected: { ch: [b.id(key)] } });
};

clause(SNEAKER, "0:ability", "during my attack: the depleted bench character is added to my attacking party, the cost of 2 is paid and the tactic ends in my discard pile", () => {
  const b = sneakerBoard({ deception: 3 });
  declareAttack(b, ["atk"]);
  const before = ready(b.engine, P1);
  sneak(b, "bench");
  assert.equal(pendingKind(b.engine), "chooserSelectsOption", "I choose between my attacking and blocking party");
  chooseOption(b.engine, P1, 0);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("atk"), b.id("bench")], "the bench character joined the attacking party");
  assert.equal(isDepleted(b.engine, b.id("bench")), true, "the picked character was depleted (COST)");
  assert.equal(before - ready(b.engine, P1), 2, "cost 2 paid");
  assert.equal(zoneOf(b.engine, b.id("sa")), "discard", "the tactic goes to my discard pile");
  assert.equal(isDepleted(b.engine, b.id("bench2")), false, "another bench character is untouched");
  assert.equal(battleOf(b.engine)?.attackingParty.includes(b.id("bench2")), false);
});

clause(SNEAKER, "0:ability", "the added character fights: with the attacker it deals its damage to the blocker", () => {
  const b = sneakerBoard();
  declareAttack(b, ["atk"]);
  sneak(b, "bench");
  chooseOption(b.engine, P1, 0);
  resolvePendingResponses(b.engine);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
  finishBattle(b.engine);
  assert.equal(dmg(b.engine, b.id("blk")), 4, "atk (strength 2) plus the added bench character (strength 2)");
});

clause(SNEAKER, "0:ability", "the added character gains exactly 1 speed (3 -> 4) this turn, and nobody else does; it is gone next turn", () => {
  const b = sneakerBoard();
  assert.equal(b.engine.getStat(b.id("bench"), "speed"), 3);
  declareAttack(b, ["atk"]);
  sneak(b, "bench");
  chooseOption(b.engine, P1, 0);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("bench"), "speed"), 4, "+1 speed");
  assert.equal(b.engine.getStat(b.id("bench2"), "speed"), 3, "another bench character is unchanged");
  assert.equal(b.engine.getStat(b.id("atk"), "speed"), 2, "the attacker is unchanged");
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  finishBattle(b.engine);
  assert.equal(b.engine.getStat(b.id("bench"), "speed"), 4, "still +1 for the rest of the turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("bench"), "speed"), 3, "it was only this turn");
});

clause(SNEAKER, "0:ability", "COST: refused outside a battle (affordable and with a valid bench character); works once a battle is on", () => {
  const b = sneakerBoard();
  refused(() => sneakRaw(b, "bench"), "Play this only during a battle");
  assert.equal(zoneOf(b.engine, b.id("sa")), "hand");
  assert.equal(isDepleted(b.engine, b.id("bench")), false, "nothing was depleted");
  assert.equal(ready(b.engine, P1), 2, "nothing was paid");
  declareAttack(b, ["atk"]);
  sneak(b, "bench");
  assert.equal(pendingKind(b.engine), "chooserSelectsOption", "control: during a battle it works");
});

clause(SNEAKER, "0:ability", "COST: the depleted character must be mine, in play, a character, ready and not in a battle party", () => {
  const b = sneakerBoard();
  declareAttack(b, ["atk"]);
  const bad: Array<[string, string]> = [
    ["a member of my attacking party", "atk"],
    ["the opponent's character", "foeBench"],
    ["the opponent's blocker-to-be", "blk"],
    ["an item", "thing"],
    ["a character in my hand", "inHand"],
    ["an already-depleted character (can't be depleted again)", "depBench"]
  ];
  for (const [why, key] of bad) {
    refused(() => sneakRaw(b, key), why);
    assert.equal(zoneOf(b.engine, b.id("sa")), "hand", `${key}: nothing played`);
  }
  refused(() => playRaw(b.engine, P1, b.id("sa"), { selected: { ch: [] } }), "no character picked");
  refused(() => playRaw(b.engine, P1, b.id("sa"), {}), "no selection");
  assert.equal(isDepleted(b.engine, b.id("foeBench")), false, "the opponent's character was not depleted");
  assert.equal(isDepleted(b.engine, b.id("bench")), false);
  sneak(b, "bench");
  assert.equal(pendingKind(b.engine), "chooserSelectsOption", "control: a ready bench character is accepted");
});

clause(SNEAKER, "0:ability", "cost 2 and [D][D] are required: one resource short and no [D][D] are refused", () => {
  const short = sneakerBoard({ deception: 1 });
  declareAttack(short, ["atk"]);
  refused(() => sneakRaw(short, "bench"), "1 resource for cost 2");
  assert.equal(zoneOf(short.engine, short.id("sa")), "hand");
  assert.equal(isDepleted(short.engine, short.id("bench")), false, "nothing depleted");
  const noIcon = sneakerBoard({ deception: 0, rage: 5 });
  declareAttack(noIcon, ["atk"]);
  refused(() => sneakRaw(noIcon, "bench"), "cost covered but no [D][D]", /threshold/i);
  const oneIcon = sneakerBoard({ deception: 1, rage: 4 });
  declareAttack(oneIcon, ["atk"]);
  refused(() => sneakRaw(oneIcon, "bench"), "only one [D]", /threshold/i);
  const ok = sneakerBoard({ deception: 2, rage: 0 });
  declareAttack(ok, ["atk"]);
  sneak(ok, "bench");
  assert.equal(pendingKind(ok.engine), "chooserSelectsOption", "control: exactly 2 resources with [D][D]");
});

clause(SNEAKER, "0:ability", "as the defender it adds the depleted character to my BLOCKING party after blockers are declared", () => {
  const b = duo(
    [
      { key: "sa", def: printing(SNEAKER), owner: P2, zone: "hand" },
      { key: "atk", def: chr("Atk"), owner: P1, zone: "play" },
      { key: "blk", def: chr("Blk"), owner: P2, zone: "play" },
      { key: "dbench", def: chr("DBench", { speed: 3 }), owner: P2, zone: "play" },
      ...bank("deception", 2, P2)
    ],
    { active: P1 }
  );
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("blk")]);
  const before = ready(b.engine, P2);
  b.engine.perform({ type: "passPriority", playerId: P1 });
  assert.equal(isDepleted(b.engine, b.id("blk")), false, "the blocker is ready, yet it is in a battle party");
  refused(
    () => b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("sa"), selected: { ch: [b.id("blk")] } } as never),
    "a member of my blocking party can't be the depleted character"
  );
  assert.equal(zoneOf(b.engine, b.id("sa")), "hand", "nothing was played");
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("sa"), selected: { ch: [b.id("dbench")] } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(pendingKind(b.engine), "chooserSelectsOption");
  chooseOption(b.engine, P2, 1);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("blk"), b.id("dbench")], "joined the blocking party");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("atk")], "the attacking party is unchanged");
  assert.equal(isDepleted(b.engine, b.id("dbench")), true);
  assert.equal(before - ready(b.engine, P2), 2);
  assert.equal(b.engine.getStat(b.id("dbench"), "speed"), 4);
  assert.equal(zoneOf(b.engine, b.id("sa")), "discard");
});

clause(SNEAKER, "0:ability", "only a party I control can receive it: as the attacker the blocking option, as the defender the attacking option, cannot strand the character outside both parties", () => {
  // Attacker: no blocking party of mine exists. Choosing "blocking" must not be a legal way to skip the add.
  const a = sneakerBoard();
  declareAttack(a, ["atk"]);
  sneak(a, "bench");
  let attackerWrongSideRefused = false;
  try {
    chooseOption(a.engine, P1, 1);
  } catch {
    attackerWrongSideRefused = true;
  }
  if (attackerWrongSideRefused) chooseOption(a.engine, P1, 0);
  resolvePendingResponses(a.engine);
  const attackerOk = battleOf(a.engine)?.attackingParty.includes(a.id("bench")) === true;
  // Defender: no attacking party of mine exists.
  const d = duo(
    [
      { key: "sa", def: printing(SNEAKER), owner: P2, zone: "hand" },
      { key: "atk", def: chr("Atk"), owner: P1, zone: "play" },
      { key: "blk", def: chr("Blk"), owner: P2, zone: "play" },
      { key: "dbench", def: chr("DBench"), owner: P2, zone: "play" },
      ...bank("deception", 2, P2)
    ],
    { active: P1 }
  );
  declareAttackBy(d.engine, P1, [d.id("atk")]);
  d.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [d.id("blk")] });
  d.engine.perform({ type: "passPriority", playerId: P1 });
  d.engine.perform({ type: "playCard", playerId: P2, cardId: d.id("sa"), selected: { ch: [d.id("dbench")] } } as never);
  resolvePendingResponses(d.engine);
  let defenderWrongSideRefused = false;
  try {
    chooseOption(d.engine, P2, 0);
  } catch {
    defenderWrongSideRefused = true;
  }
  if (defenderWrongSideRefused) chooseOption(d.engine, P2, 1);
  resolvePendingResponses(d.engine);
  assert.equal(battleOf(d.engine)?.attackingParty.includes(d.id("dbench")), false, "never in the opponent's attacking party");
  const defenderOk = battleOf(d.engine)?.blockingParty.includes(d.id("dbench")) === true;
  assert.deepEqual({ attackerOk, defenderOk }, { attackerOk: true, defenderOk: true }, "the depleted character ended up in a party I control (attacking as attacker, blocking as defender)");
});

// --- FLIP UP: 2 [D][D] ---------------------------------------------------------------------

clause(SNEAKER, "1:flipUp", "a face-down Sneaker Attack! is a resource; flipped up during a battle it plays as the tactic: the picked character is depleted and added, and it ends in my discard pile", () => {
  const b = sneakerBoard({ sneaker: "faceDown", deception: 2, rage: 3 });
  assert.equal(b.engine.isResource(b.id("sa")), true);
  assert.equal(ready(b.engine, P1), 6, "two [D] banks, three Rage banks plus the face-down card");
  declareAttack(b, ["atk"]);
  flipUpAs(b.engine, P1, b.id("sa"), { ch: [b.id("bench")] });
  resolvePendingResponses(b.engine);
  assert.equal(pendingKind(b.engine), "chooserSelectsOption");
  chooseOption(b.engine, P1, 0);
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("atk"), b.id("bench")]);
  assert.equal(isDepleted(b.engine, b.id("bench")), true);
  assert.equal(b.engine.getStat(b.id("bench"), "speed"), 4);
  assert.equal(zoneOf(b.engine, b.id("sa")), "discard", "the flipped-up tactic ends in the discard pile");
  assert.equal(ready(b.engine, P1), 3, "6 - 2 paid for FLIP UP (not the cost of 2 plus anything more) - 1 (the card stopped being a resource)");
});

clause(SNEAKER, "1:flipUp", "FLIP UP does not change when it can be played: still only during a battle", () => {
  const b = sneakerBoard({ sneaker: "faceDown", deception: 2 });
  refused(() => flipUpAs(b.engine, P1, b.id("sa"), { ch: [b.id("bench")] }), "no battle");
  assert.equal(b.engine.state.cards[b.id("sa")].faceDown, true, "still face-down");
  assert.equal(isDepleted(b.engine, b.id("bench")), false);
  assert.equal(ready(b.engine, P1), 3, "nothing was paid");
  declareAttack(b, ["atk"]);
  flipUpAs(b.engine, P1, b.id("sa"), { ch: [b.id("bench")] });
  assert.equal(b.engine.state.cards[b.id("sa")].faceDown, false, "control: during a battle it flips up");
});

clause(SNEAKER, "1:flipUp", "needs [D][D]: a single [D] (cost covered) or none is refused; with only one resource it is too poor", () => {
  const one = sneakerBoard({ sneaker: "faceDown", deception: 1, rage: 3 });
  declareAttack(one, ["atk"]);
  refused(() => flipUpAs(one.engine, P1, one.id("sa"), { ch: [one.id("bench")] }), "enough resources but only one [D]", /threshold/i);
  assert.equal(one.engine.state.cards[one.id("sa")].faceDown, true);
  assert.equal(ready(one.engine, P1), 5, "nothing was paid");
  const none = sneakerBoard({ sneaker: "faceDown", deception: 0, rage: 5 });
  declareAttack(none, ["atk"]);
  refused(() => flipUpAs(none.engine, P1, none.id("sa"), { ch: [none.id("bench")] }), "no [D] at all", /threshold/i);
  const poor = sneakerBoard({ sneaker: "faceDown", deception: 0, rage: 0 });
  declareAttack(poor, ["atk"]);
  refused(() => flipUpAs(poor.engine, P1, poor.id("sa"), { ch: [poor.id("bench")] }), "only the card itself");
  assert.equal(poor.engine.state.cards[poor.id("sa")].faceDown, true);
});
