// Clause tests — batch seed-08. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-08`. Expectations come from each
// card's PRINTED text and RULES.md; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
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
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdCostChoices } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import {
  battleOf,
  covertBlocksOnlyCovertParties,
  covertCannotBeBlockedByNonCovert,
  covertHasKeyword,
  covertPartyNeedsEveryMemberCovert,
  declareAttackBy,
  declareAttackOpenWindow,
  fight,
  playRaw
} from "./_battle.js";
import { answerPending, declareBlockers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { endTurn, factionOf, developPlay } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ deception: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const playOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].play];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId;
const ownerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].ownerId;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted;

/** Raw `activateAbility` WITHOUT draining the response window. */
function actRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

/** The open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** A battle-capable board: both factions can develop. */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** `n` vanilla characters in `owner`'s deck, keyed `<prefix>0..n-1`, top of the deck first (names `<PREFIX>i`). */
function deckCards(prefix: string, n: number, owner: PlayerId): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "deck" as const }));
}

/** `n` vanilla characters in `owner`'s hand, keyed `<prefix>0..n-1`. */
function handCards(prefix: string, n: number, owner: PlayerId): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone: "hand" as const }));
}

/** Picks `selected` for the open `chooserSelectsTarget` (a search / "pick N" prompt), asserting who answers. */
function pickCards(engine: SpoilsEngine, playerId: PlayerId, selected: CardInstanceId[]): void {
  const pc = pending(engine);
  assert.ok(pc, "expected an open chooserSelectsTarget");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, playerId, `chooserSelectsTarget must be answered by ${playerId}`);
  answerPending(engine, "chooserSelectsTarget", { selected });
}

/** The same pick, WITHOUT draining and without asserting — for `refused`. */
const tryPick = (engine: SpoilsEngine, playerId: PlayerId, selected: CardInstanceId[]) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);

/** A free tactic (id "zap", pick "t"): deals `amount` damage to one picked card in play (any type). */
const zapTactic = (name: string, amount: number): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A free tactic (id "kill", pick "t"): destroys one picked card of `type` in play. */
const killAnyTactic = (type: "character" | "item" | "location" | "resource", name = `Kill ${type}`): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kill",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** A staple icon that is not `icon` (for "plenty of other resources" boards). `greed` is always used besides it, so never return greed. */
const filler = (icon: StapleIcon): StapleIcon => (icon === "rage" ? "elitism" : "rage");

/** Raw `playCard` (no response draining) with an optional mode for a "choose one" card. */
function playModeRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number>; mode?: number } = {}
): void {
  engine.perform({
    type: "playCard",
    playerId: player,
    cardId,
    selected: opts.selected ?? {},
    variables: opts.variables ?? {},
    ...(opts.mode !== undefined ? { mode: opts.mode } : {})
  } as never);
}

/**
 * The card header: deploys for exactly `cost` resources when `threshold` icons of `icon` are
 * controlled (paying exactly `cost`, leaving the rest ready), is refused without the threshold
 * even with plenty of other resources, and refused one resource short of its cost (when that
 * shortfall can be told apart from the threshold). `mk` builds a fresh board with the given
 * resources; `key` is the card in hand; `lands` is where it ends up.
 */
function headerChecks(
  mk: (icons: Icons) => ReturnType<typeof buildGame>,
  key: string,
  spec: {
    icon: StapleIcon;
    threshold: number;
    cost: number;
    lands: Zone;
    selected?: (id: (k: string) => CardInstanceId) => Record<string, CardInstanceId[]>;
    /** The mode of a "choose one" card. */
    mode?: number;
  }
): void {
  const { icon, threshold, cost, lands } = spec;
  const enough = Math.max(cost, threshold);
  const selectedFor = (id: (k: string) => CardInstanceId) => spec.selected?.(id) ?? {};

  // exactly enough: plays, pays the printed cost, nothing more
  {
    const { engine, id } = mk({ [icon]: enough + 2 });
    const before = ready(engine);
    play(engine, P1, id(key), { selected: selectedFor(id), mode: spec.mode });
    drain(engine, declineAll);
    assert.equal(before - ready(engine), cost, `deploying pays exactly the printed cost of ${cost}`);
    assert.equal(zoneOf(engine, id(key)), lands, `it ends in ${lands}`);
  }
  // threshold is a gate, not a cost
  if (threshold > 0) {
    const { engine, id } = mk({ [icon]: threshold - 1, [filler(icon)]: cost + 4, greed: 2 } as Icons);
    refused(() => playModeRaw(engine, P1, id(key), { selected: selectedFor(id), mode: spec.mode }), `threshold of ${threshold} [${icon}] not met`);
    assert.equal(zoneOf(engine, id(key)), "hand", "a refused deploy leaves the card in hand");
  }
  // one short of the numeric cost (only when the threshold itself is still met)
  if (cost >= 1 && cost - 1 >= threshold) {
    const { engine, id } = mk({ [icon]: cost - 1 });
    refused(() => playModeRaw(engine, P1, id(key), { selected: selectedFor(id), mode: spec.mode }), `one resource short of the cost of ${cost}`);
    assert.equal(zoneOf(engine, id(key)), "hand");
  }
}

// --- Narrow Passage ----------------------------------------------------------
// Players can attack only once each turn. Location, cost 1, [D][D], structure 3.

const NARROW = "a29a0fb1-c505-410f-8a78-55380f603326";

function narrowBoard(opts: { active?: PlayerId; passage?: PlayerId | "none"; faceDown?: boolean; extra?: CardPlacement[] } = {}) {
  const active = opts.active ?? P1;
  const passage: CardPlacement[] =
    opts.passage === "none"
      ? []
      : [{ key: "np", def: printing(NARROW), owner: opts.passage ?? P1, zone: "play", faceDown: opts.faceDown }];
  return devBoard(
    [
      ...passage,
      { key: "a1", def: character({ name: "A1", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "a3", def: character({ name: "A3", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "Foe Place", structure: 9 }), owner: P2, zone: "play" },
      { key: "myLoc", def: location({ name: "My Place", structure: 9 }), owner: P1, zone: "play" },
      ...(opts.extra ?? [])
    ],
    { turn: 2, activePlayerId: active }
  );
}

const FACTION_P2 = { type: "faction", playerId: P2 } as const;
const FACTION_P1 = { type: "faction", playerId: P1 } as const;

clause(NARROW, "0:rule", "deploys for its printed cost of 1 with [D][D], is refused without the threshold, and a location has 3 structure", () => {
  const mk = (icons: Icons) =>
    devBoard([{ key: "np", def: printing(NARROW), owner: P1, zone: "hand" }, ...res(icons)]);
  headerChecks(mk, "np", { icon: "deception", threshold: 2, cost: 1, lands: "play" });

  const { engine, id } = devBoard([
    { key: "np", def: printing(NARROW), owner: P1, zone: "play" },
    { key: "z2", def: zapTactic("Zap2", 2), owner: P1, zone: "hand" },
    { key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("z2"), { selected: { t: [id("np")] } });
  assert.equal(zoneOf(engine, id("np")), "play", "2 damage does not destroy a structure-3 location");
  play(engine, P1, id("z1"), { selected: { t: [id("np")] } });
  assert.equal(zoneOf(engine, id("np")), "discard", "the 3rd damage destroys it");
});

clause(NARROW, "0:rule", "a player who has attacked once this turn cannot attack again, even with a different character", () => {
  const { engine, id } = narrowBoard();
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  assert.equal(battleOf(engine), undefined, "the first battle is over");
  assert.equal(influenceOf(engine, P2), 30 - 1, "the first attack was legal and landed (1 damage to the faction)");
  refused(() => declareAttackBy(engine, P1, [id("a2")]), "a second attack in the same turn");
  assert.equal(battleOf(engine), undefined, "no second battle began");
  assert.equal(isDepleted(engine, id("a2")), false, "the refused attacker was not depleted");
});

clause(NARROW, "0:rule", "control: without Narrow Passage a second attack in the same turn is legal", () => {
  const { engine, id } = narrowBoard({ passage: "none" });
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  declareAttackBy(engine, P1, [id("a2")]);
  assert.ok(battleOf(engine), "the second battle began");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("a2")]);
});

clause(NARROW, "0:rule", "it limits the opponent of its controller too: on their own turn, they get one attack", () => {
  const { engine, id } = narrowBoard({ active: P2 });
  fight(engine, P2, [id("b1")], FACTION_P1, []);
  assert.equal(battleOf(engine), undefined);
  assert.equal(influenceOf(engine, P1), 30 - 1, "their first attack was legal and landed");
  refused(() => declareAttackBy(engine, P2, [id("b2")]), "the opponent's second attack");
  assert.equal(battleOf(engine), undefined);
});

clause(NARROW, "0:rule", "it limits its own controller too (the printed words are 'players', not 'opponents')", () => {
  const { engine, id } = narrowBoard({ active: P1, passage: P1 });
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  refused(() => declareAttackBy(engine, P1, [id("a2")]), "the controller's second attack");
});

clause(NARROW, "0:rule", "it applies when it is controlled by the opponent: the active player is still limited to one attack", () => {
  const { engine, id } = narrowBoard({ active: P1, passage: P2 });
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  assert.equal(influenceOf(engine, P2), 29, "the first attack was legal");
  refused(() => declareAttackBy(engine, P1, [id("a2")]), "a second attack while the opponent controls the Passage");
});

clause(NARROW, "0:rule", "one attack may be made by several characters at once: a party of three is a single attack", () => {
  const { engine, id } = narrowBoard();
  fight(engine, P1, [id("a1"), id("a2"), id("a3")], FACTION_P2, []);
  assert.equal(influenceOf(engine, P2), 30 - 3, "all three attacked together, in one declaration");
  assert.equal(battleOf(engine), undefined);
});

clause(NARROW, "0:rule", "an attack on a location counts as the turn's one attack, so a later attack on a faction is refused", () => {
  const { engine, id } = narrowBoard();
  fight(engine, P1, [id("a1")], { type: "card", cardId: id("foeLoc") }, []);
  assert.equal(damageOf(engine, id("foeLoc")), 1, "the first attack (on the location) was legal");
  refused(() => declareAttackBy(engine, P1, [id("a2")]), "an attack on the faction after an attack on a location");
  refused(() => declareAttackBy(engine, P1, [id("a2")], { type: "card", cardId: id("foeLoc") }), "an attack on the location again");
});

clause(NARROW, "0:rule", "an attack on a faction counts as the turn's one attack, so a later attack on a location is refused", () => {
  const { engine, id } = narrowBoard();
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  refused(() => declareAttackBy(engine, P1, [id("a2")], { type: "card", cardId: id("foeLoc") }), "an attack on a location after an attack on the faction");
});

clause(NARROW, "0:rule", "'each turn': the allowance returns on the next turn, for each player separately", () => {
  const { engine, id } = narrowBoard();
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  refused(() => declareAttackBy(engine, P1, [id("a2")]), "no second attack on turn 2");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  fight(engine, P2, [id("b1")], FACTION_P1, []);
  assert.equal(influenceOf(engine, P1), 29, "the opponent's first attack on their turn is legal even though I attacked on mine");
  refused(() => declareAttackBy(engine, P2, [id("b2")]), "their second attack the same turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  fight(engine, P1, [id("a2")], FACTION_P2, []);
  assert.equal(influenceOf(engine, P2), 28, "my one attack on my next turn is legal again");
  refused(() => declareAttackBy(engine, P1, [id("a3")]), "...and only one");
});

clause(NARROW, "0:rule", "when Narrow Passage leaves play the limit is gone: a second attack becomes legal", () => {
  const { engine, id } = narrowBoard({ extra: [{ key: "kill", def: killAnyTactic("location"), owner: P1, zone: "hand" }] });
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  refused(() => declareAttackBy(engine, P1, [id("a2")]), "refused while Narrow Passage is in play");
  play(engine, P1, id("kill"), { selected: { t: [id("np")] } });
  assert.equal(zoneOf(engine, id("np")), "discard", "Narrow Passage was destroyed");
  declareAttackBy(engine, P1, [id("a2")]);
  assert.ok(battleOf(engine), "the second attack is legal once the Passage is gone");
});

clause(NARROW, "0:rule", "it limits attacks declared after it enters play: an attack already made this turn counts", () => {
  const { engine, id } = narrowBoard({ passage: "none", extra: [{ key: "np", def: printing(NARROW), owner: P1, zone: "hand" }, ...res({ deception: 2 })] });
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  play(engine, P1, id("np"), {});
  assert.equal(zoneOf(engine, id("np")), "play");
  refused(() => declareAttackBy(engine, P1, [id("a2")]), "the turn's one attack was already used before the Passage came into play");
});

clause(NARROW, "0:rule", "a face-down Narrow Passage is only a resource and limits nothing", () => {
  const { engine, id } = narrowBoard({ faceDown: true });
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  declareAttackBy(engine, P1, [id("a2")]);
  assert.ok(battleOf(engine), "a second attack is legal");
});

clause(NARROW, "0:rule", "two Narrow Passages do not add up: the limit is still one attack", () => {
  const { engine, id } = narrowBoard({ extra: [{ key: "np2", def: printing(NARROW), owner: P2, zone: "play" }] });
  fight(engine, P1, [id("a1")], FACTION_P2, []);
  refused(() => declareAttackBy(engine, P1, [id("a2")]), "still one attack with two Passages");
});

// --- Obtuse Pipesmoker -------------------------------------------------------
// [D][D][D][D][D]: This card gains 1 strength, 1 life, and 1 speed.
// Character (hedonist), cost 6, [D], 4 strength / 3 speed / 3 life.

const PIPE = "6201f5e4-9b41-497c-9634-dc2ac6847ea2";

/** `n` face-up staple resources of `icon` for `owner` with stable keys `<prefix>0..n-1`. */
function keyedRes(prefix: string, icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] {
  return bank(icon, n, owner).map((placement, i) => ({ ...placement, key: `${prefix}${i}` }));
}

/** Staple resources already spent (attached to `owner`'s faction). */
function spentRes(prefix: string, icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] {
  return keyedRes(prefix, icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
}

function pipeBoard(icons: Icons, extra: CardPlacement[] = []) {
  return devBoard([
    { key: "pipe", def: printing(PIPE), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
    ...res(icons),
    ...extra
  ]);
}

const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => ({
  strength: engine.getStat(cardId, "strength"),
  life: engine.getStat(cardId, "life"),
  speed: engine.getStat(cardId, "speed")
});

clause(PIPE, "0:rule@ddddd", "deploys for its printed cost of 6 with [D], is refused without it, and has 4 strength / 3 life / 3 speed", () => {
  const mk = (icons: Icons) => devBoard([{ key: "pipe", def: printing(PIPE), owner: P1, zone: "hand" }, ...res(icons)]);
  headerChecks(mk, "pipe", { icon: "deception", threshold: 1, cost: 6, lands: "play" });

  const plain = pipeBoard({ deception: 1 });
  assert.deepEqual(stats(plain.engine, plain.id("pipe")), { strength: 4, life: 3, speed: 3 }, "printed stats without the five-[D] bonus");
});

clause(PIPE, "0:rule@ddddd", "with five [D] it gains exactly 1 strength, 1 life and 1 speed", () => {
  const { engine, id } = pipeBoard({ deception: 5 });
  assert.deepEqual(stats(engine, id("pipe")), { strength: 5, life: 4, speed: 4 });
});

clause(PIPE, "0:rule@ddddd", "with only four [D] (and plenty of other resources) there is no bonus at all", () => {
  const { engine, id } = pipeBoard({ deception: 4, rage: 4, greed: 3, elitism: 3, obsession: 3 });
  assert.deepEqual(stats(engine, id("pipe")), { strength: 4, life: 3, speed: 3 });
});

clause(PIPE, "0:rule@ddddd", "with no [D] there is no bonus", () => {
  const { engine, id } = pipeBoard({ rage: 6 });
  assert.deepEqual(stats(engine, id("pipe")), { strength: 4, life: 3, speed: 3 });
});

clause(PIPE, "0:rule@ddddd", "the bonus is not repeated for extra [D]: seven [D] still give +1/+1/+1", () => {
  const { engine, id } = pipeBoard({ deception: 7 });
  assert.deepEqual(stats(engine, id("pipe")), { strength: 5, life: 4, speed: 4 });
  const ten = pipeBoard({ deception: 10 });
  assert.deepEqual(stats(ten.engine, ten.id("pipe")), { strength: 5, life: 4, speed: 4 });
});

clause(PIPE, "0:rule@ddddd", "only this card gets the bonus: my other characters and the opponent's are unchanged", () => {
  const { engine, id } = pipeBoard({ deception: 5 }, [{ key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" }]);
  assert.deepEqual(stats(engine, id("other")), { strength: 2, life: 3, speed: 2 });
  assert.deepEqual(stats(engine, id("foe")), { strength: 2, life: 3, speed: 2 });
});

clause(PIPE, "0:rule@ddddd", "it is a standing bonus that switches on when the fifth [D] arrives (a resource played with the Develop Rule)", () => {
  const { engine, id } = pipeBoard({ deception: 4 }, [
    { key: "handRes", def: resourceCard({ name: "Deception Resource", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "hand" }
  ]);
  assert.deepEqual(stats(engine, id("pipe")), { strength: 4, life: 3, speed: 3 });
  developPlay(engine, P1, id("handRes"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.deepEqual(stats(engine, id("pipe")), { strength: 5, life: 4, speed: 4 }, "the fifth [D] turns the bonus on");
});

clause(PIPE, "0:rule@ddddd", "it switches off again the instant a [D] leaves play", () => {
  const { engine, id } = pipeBoard({}, [...keyedRes("d", "deception", 5), { key: "kill", def: killAnyTactic("resource"), owner: P1, zone: "hand" }]);
  assert.deepEqual(stats(engine, id("pipe")), { strength: 5, life: 4, speed: 4 });
  play(engine, P1, id("kill"), { selected: { t: [id("d0")] } });
  assert.equal(zoneOf(engine, id("d0")), "discard", "a [D] resource was destroyed");
  assert.deepEqual(stats(engine, id("pipe")), { strength: 4, life: 3, speed: 3 }, "four [D] is not enough");
});

clause(PIPE, "0:rule@ddddd", "[D] resources already spent (attached to the faction) are still controlled and still count", () => {
  const { engine, id } = pipeBoard({}, spentRes("s", "deception", 5));
  assert.deepEqual(stats(engine, id("pipe")), { strength: 5, life: 4, speed: 4 });
  const mixed = pipeBoard({ deception: 2 }, spentRes("s", "deception", 3));
  assert.deepEqual(stats(mixed.engine, mixed.id("pipe")), { strength: 5, life: 4, speed: 4 }, "2 ready + 3 spent = 5");
});

clause(PIPE, "0:rule@ddddd", "face-down resources provide Volition, not [D]: four [D] plus face-down cards is no bonus", () => {
  const { engine, id } = pipeBoard({ deception: 4 }, volition(4, P1));
  assert.deepEqual(stats(engine, id("pipe")), { strength: 4, life: 3, speed: 3 });
  const five = pipeBoard({ deception: 5 }, volition(2, P1));
  assert.deepEqual(stats(five.engine, five.id("pipe")), { strength: 5, life: 4, speed: 4 }, "control: five real [D] still count alongside face-down cards");
});

clause(PIPE, "0:rule@ddddd", "[D] controlled by the opponent do not count for my Pipesmoker", () => {
  const { engine, id } = pipeBoard({ deception: 4 }, res({ deception: 5 }, P2));
  assert.deepEqual(stats(engine, id("pipe")), { strength: 4, life: 3, speed: 3 });
});

clause(PIPE, "0:rule@ddddd", "an opponent's Pipesmoker is judged by its own controller's [D]", () => {
  const { engine, id } = devBoard([
    { key: "pipeFoe", def: printing(PIPE), owner: P2, zone: "play" },
    ...res({ deception: 5 }, P1),
    ...res({ deception: 1 }, P2)
  ]);
  assert.deepEqual(stats(engine, id("pipeFoe")), { strength: 4, life: 3, speed: 3 }, "my five [D] do not power the opponent's card");
  const powered = devBoard([{ key: "pipeFoe", def: printing(PIPE), owner: P2, zone: "play" }, ...res({ deception: 5 }, P2)]);
  assert.deepEqual(stats(powered.engine, powered.id("pipeFoe")), { strength: 5, life: 4, speed: 4 }, "their own five [D] do");
});

clause(PIPE, "0:rule@ddddd", "a Pipesmoker I take control of is judged by my [D], not its owner's", () => {
  const takeTactic = tactic({
    name: "Grab",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grab",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = devBoard([
    { key: "pipeFoe", def: printing(PIPE), owner: P2, zone: "play" },
    { key: "grab", def: takeTactic, owner: P1, zone: "hand" },
    ...res({ deception: 5 }, P2),
    ...res({ deception: 1 }, P1)
  ]);
  assert.deepEqual(stats(engine, id("pipeFoe")), { strength: 5, life: 4, speed: 4 }, "powered by its current controller's (the owner's) five [D]");
  play(engine, P1, id("grab"), { selected: { t: [id("pipeFoe")] } });
  assert.equal(controllerOf(engine, id("pipeFoe")), P1);
  assert.deepEqual(stats(engine, id("pipeFoe")), { strength: 4, life: 3, speed: 3 }, "I control it now and I have only one [D]");
});

clause(PIPE, "0:rule@ddddd", "the +1 life is real: with five [D] it survives 3 damage and dies to the 4th", () => {
  const { engine, id } = pipeBoard({ deception: 5 }, [
    { key: "z3", def: zapTactic("Zap3", 3), owner: P1, zone: "hand" },
    { key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("z3"), { selected: { t: [id("pipe")] } });
  assert.equal(zoneOf(engine, id("pipe")), "play", "3 damage does not kill a 4-life Pipesmoker");
  play(engine, P1, id("z1"), { selected: { t: [id("pipe")] } });
  assert.equal(zoneOf(engine, id("pipe")), "discard", "4 damage does");
  const weak = pipeBoard({ deception: 4 }, [{ key: "z3", def: zapTactic("Zap3", 3), owner: P1, zone: "hand" }]);
  play(weak.engine, P1, weak.id("z3"), { selected: { t: [weak.id("pipe")] } });
  assert.equal(zoneOf(weak.engine, weak.id("pipe")), "discard", "control: without the bonus, 3 damage kills it");
});

clause(PIPE, "0:rule@ddddd", "the +1 strength is real: with five [D] an unblocked attack deals 5 battle damage to the faction, with four [D] only 4", () => {
  const five = devBoard([{ key: "pipe", def: printing(PIPE), owner: P1, zone: "play" }, ...res({ deception: 5 })], { turn: 2 });
  fight(five.engine, P1, [five.id("pipe")], FACTION_P2, []);
  assert.equal(influenceOf(five.engine, P2), 30 - 5);
  const four = devBoard([{ key: "pipe", def: printing(PIPE), owner: P1, zone: "play" }, ...res({ deception: 4 })], { turn: 2 });
  fight(four.engine, P1, [four.id("pipe")], FACTION_P2, []);
  assert.equal(influenceOf(four.engine, P2), 30 - 4, "control: without the bonus it deals its printed 4");
});

clause(PIPE, "0:rule@ddddd", "the +1 speed is real: with five [D] it assigns battle damage in the speed-4 group, ahead of a speed-3 blocker", () => {
  const { engine, id } = devBoard(
    [
      { key: "pipe", def: printing(PIPE), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 4, life: 5, speed: 3 }), owner: P2, zone: "play" },
      ...res({ deception: 5 })
    ],
    { turn: 2 }
  );
  declareAttackBy(engine, P1, [id("pipe")]);
  declareBlockers(engine, P2, [id("blk")]);
  resolvePendingResponses(engine);
  const view = engine.getBattleView();
  assert.ok(view, "a battle is under way");
  const sources = view.damageSources.map((s) => ({ cardId: s.cardId, strength: s.strength }));
  assert.equal(view.speed, 4, "the first speed group is 4: only the Pipesmoker's bonus speed makes it so (the blocker is speed 3)");
  assert.deepEqual(sources, [{ cardId: id("pipe"), strength: 5 }], "only the speed-4 Pipesmoker assigns first, with 5 strength");
});

clause(PIPE, "0:rule@ddddd", "a faction that automatically meets every threshold gets the bonus with no [D] at all (OMNIPOTENCE, RULES.md section 4)", () => {
  const omni = developFaction({ faction: { ...developFaction().faction!, meetsAllThresholds: true } });
  const { engine, id } = buildGame({
    playerA: { faction: omni },
    playerB: { faction: developFaction() },
    cards: [{ key: "pipe", def: printing(PIPE), owner: P1, zone: "play" }]
  });
  assert.deepEqual(stats(engine, id("pipe")), { strength: 5, life: 4, speed: 4 });
});

// --- Opportune Slotpuller ----------------------------------------------------
// GAMBLE -- COST: Pay 1. Choose a card type. -- EFFECT: Reveal the top card of
// your deck. If it is the chosen type, this card gains 2 strength and loses 1
// life this turn. Put the top card of your deck on the bottom.
// Character (gambler), cost 2, [D], 1 strength / 4 speed / 2 life.

const SLOT = "b176a78f-7145-4635-943c-4b41e21279bd";

const DECK_TYPES = ["character", "item", "location", "tactic", "resource"] as const;
type DeckType = (typeof DECK_TYPES)[number];

/** A card of `type` named `name` (for decks that must hold a known type on top). */
function defOfType(type: DeckType, name: string): CardDefinition {
  switch (type) {
    case "character":
      return character({ name });
    case "item":
      return item({ name });
    case "location":
      return location({ name });
    case "tactic":
      return tactic({ name });
    case "resource":
      return resourceCard({ name });
  }
}

/** Index of the option labelled `label` in an open chooserSelectsOption. */
function optionIndex(pc: PendingChoiceLike, label: string): number {
  const options = pc.options as Array<{ label: string }>;
  const index = options.findIndex((option) => option.label.toLowerCase() === label.toLowerCase());
  assert.ok(index >= 0, `no option labelled ${label} among ${options.map((o) => o.label).join(", ")}`);
  return index;
}

/** `cardsRevealed` events in the log. */
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

function slotBoard(deck: DeckType[], icons: Icons = { deception: 3 }, extra: CardPlacement[] = []) {
  return devBoard([
    { key: "slot", def: printing(SLOT), owner: P1, zone: "play" },
    { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
    ...deck.map((type, i): CardPlacement => ({ key: `d${i}`, def: defOfType(type, `Deck${i}`), owner: P1, zone: "deck" })),
    ...deckCards("o", 3, P2),
    ...res(icons),
    ...extra
  ], { turn: 2 });
}

/** Uses GAMBLE choosing `chosen`: "Choose a card type" is part of the COST, so the prompt comes as the ability is used (E3a). */
function gamble(engine: SpoilsEngine, slotId: CardInstanceId, chosen: DeckType): void {
  holdCostChoices(() => {
    actRaw(engine, P1, slotId, "gamble");
    const pc = pending(engine);
    assert.ok(pc, "a card-type choice is open");
    assert.equal(pc.kind, "chooserSelectsOption");
    assert.equal(pc.playerId, P1, "the controller chooses the type");
    answerPending(engine, "chooserSelectsOption", { index: optionIndex(pc, chosen) });
  });
  resolvePendingResponses(engine);
  assert.equal(pending(engine), undefined, "nothing is left to decide");
}

clause(SLOT, "0:ability:gamble", "deploys for its printed cost of 2 with [D], is refused without it, and has 1 strength / 4 speed / 2 life", () => {
  const mk = (icons: Icons) => devBoard([{ key: "slot", def: printing(SLOT), owner: P1, zone: "hand" }, ...res(icons)]);
  headerChecks(mk, "slot", { icon: "deception", threshold: 1, cost: 2, lands: "play" });
  const { engine, id } = slotBoard(["character"]);
  assert.deepEqual(stats(engine, id("slot")), { strength: 1, life: 2, speed: 4 });
});

clause(SLOT, "0:ability:gamble", "pays exactly 1 resource", () => {
  const { engine, id } = slotBoard(["character", "item"], { deception: 3 });
  const before = ready(engine);
  gamble(engine, id("slot"), "item");
  assert.equal(before - ready(engine), 1, "GAMBLE costs 1");
});

clause(SLOT, "0:ability:gamble", "is refused with no resource to pay, and works with exactly one", () => {
  const none = slotBoard(["character"], {});
  refused(() => actRaw(none.engine, P1, none.id("slot"), "gamble"), "no resource to pay with");
  assert.deepEqual(deckOf(none.engine, P1), [none.id("d0")], "nothing happened to the deck");
  const one = slotBoard(["character"], { rage: 1 });
  gamble(one.engine, one.id("slot"), "character");
  assert.equal(ready(one.engine), 0, "any one resource pays for it (no threshold on the ability)");
});

clause(SLOT, "0:ability:gamble", "the card type is chosen as a cost: the choice is open when GAMBLE is used, before the opponent can respond", () => {
  const { engine, id } = slotBoard(["character", "item"]);
  holdCostChoices(() => actRaw(engine, P1, id("slot"), "gamble"));
  const pc = pending(engine);
  assert.ok(pc, "a card-type choice is open while the cost is being paid");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  assert.equal(engine.state.responseWindow, undefined, "the opponent has no response window yet: the cost is not fully paid");
});

clause(SLOT, "0:ability:gamble", "the type choice offers every card type a deck can hold: character, item, location, tactic and resource", () => {
  const { engine, id } = slotBoard(["character", "item"]);
  holdCostChoices(() => actRaw(engine, P1, id("slot"), "gamble"));
  const pc = expectPending(engine, "chooserSelectsOption");
  const labels = (pc.options as Array<{ label: string }>).map((o) => o.label.toLowerCase()).sort();
  for (const type of DECK_TYPES) assert.ok(labels.includes(type), `${type} can be chosen`);
});

clause(SLOT, "0:ability:gamble", "'Choose a card type' offers all six card types of CR 201.4e, faction included", () => {
  const { engine, id } = slotBoard(["character", "item"]);
  holdCostChoices(() => actRaw(engine, P1, id("slot"), "gamble"));
  const pc = expectPending(engine, "chooserSelectsOption");
  const labels = (pc.options as Array<{ label: string }>).map((o) => o.label.toLowerCase()).sort();
  assert.deepEqual(labels, ["character", "faction", "item", "location", "resource", "tactic"]);
});

clause(SLOT, "0:ability:gamble", "when the top card is the chosen type: +2 strength and -1 life, for every type (matrix of top card x chosen type)", () => {
  for (const top of DECK_TYPES) {
    for (const chosen of DECK_TYPES) {
      const { engine, id } = slotBoard([top, "character", "character"]);
      gamble(engine, id("slot"), chosen);
      const expected = top === chosen ? { strength: 3, life: 1, speed: 4 } : { strength: 1, life: 2, speed: 4 };
      assert.deepEqual(stats(engine, id("slot")), expected, `top card ${top}, chosen ${chosen}`);
    }
  }
});

clause(SLOT, "0:ability:gamble", "the revealed top card is put on the bottom whether or not it matched", () => {
  for (const [top, chosen] of [["item", "item"], ["item", "tactic"]] as const) {
    const { engine, id } = slotBoard([top, "character", "location", "resource"]);
    const before = deckOf(engine, P1);
    gamble(engine, id("slot"), chosen);
    assert.deepEqual(deckOf(engine, P1), [...before.slice(1), before[0]], `the ${top} on top moved to the bottom (chosen ${chosen}); the rest keep their order`);
    assert.equal(zoneOf(engine, before[0]), "deck", "it is still in the deck");
  }
});

clause(SLOT, "0:ability:gamble", "it reveals the top card of MY deck: a reveal event names exactly that card, and the opponent's deck is untouched", () => {
  const { engine, id } = slotBoard(["item", "character"]);
  const top = deckOf(engine, P1)[0];
  const oppDeck = deckOf(engine, P2);
  const before = revealEvents(engine).length;
  gamble(engine, id("slot"), "item");
  const events = revealEvents(engine).slice(before);
  assert.ok(events.length >= 1, "a reveal happened");
  const event = events[events.length - 1].event as unknown as { cardIds: string[]; ownerId?: string };
  assert.deepEqual(event.cardIds, [top], "exactly the top card is revealed");
  assert.equal(event.ownerId, P1, "from my deck");
  assert.deepEqual(deckOf(engine, P2), oppDeck, "the opponent's deck is unchanged");
});

clause(SLOT, "0:ability:gamble", "it looks only at the TOP card: a matching second card does not count", () => {
  const { engine, id } = slotBoard(["character", "item", "item"]);
  gamble(engine, id("slot"), "item");
  assert.deepEqual(stats(engine, id("slot")), { strength: 1, life: 2, speed: 4 }, "the top card is a character, not an item");
});

clause(SLOT, "0:ability:gamble", "the boost and the life loss are 'this turn' only: both are gone next turn", () => {
  const { engine, id } = slotBoard(["item", "character"]);
  gamble(engine, id("slot"), "item");
  assert.deepEqual(stats(engine, id("slot")), { strength: 3, life: 1, speed: 4 });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.deepEqual(stats(engine, id("slot")), { strength: 1, life: 2, speed: 4 }, "back to printed stats when the turn ends");
  endTurn(engine, P2);
  assert.deepEqual(stats(engine, id("slot")), { strength: 1, life: 2, speed: 4 }, "and it does not come back");
});

clause(SLOT, "0:ability:gamble", "only this card is affected: my other characters and the opponent's are unchanged by a hit", () => {
  const { engine, id } = slotBoard(["item"], { deception: 3 }, [{ key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }]);
  gamble(engine, id("slot"), "item");
  assert.deepEqual(stats(engine, id("slot")), { strength: 3, life: 1, speed: 4 });
  assert.deepEqual(stats(engine, id("ally")), { strength: 1, life: 3, speed: 1 });
  assert.deepEqual(stats(engine, id("foe")), { strength: 1, life: 3, speed: 1 });
});

clause(SLOT, "0:ability:gamble", "the life loss is real: after a hit, 1 damage destroys the Slotpuller; after a miss it survives 1 damage", () => {
  const hit = slotBoard(["item"], { deception: 3 }, [{ key: "z", def: zapTactic("Zap", 1), owner: P1, zone: "hand" }]);
  gamble(hit.engine, hit.id("slot"), "item");
  play(hit.engine, P1, hit.id("z"), { selected: { t: [hit.id("slot")] } });
  assert.equal(zoneOf(hit.engine, hit.id("slot")), "discard", "life 1 with 1 damage is destroyed");
  const miss = slotBoard(["item"], { deception: 3 }, [{ key: "z", def: zapTactic("Zap", 1), owner: P1, zone: "hand" }]);
  gamble(miss.engine, miss.id("slot"), "tactic");
  play(miss.engine, P1, miss.id("z"), { selected: { t: [miss.id("slot")] } });
  assert.equal(zoneOf(miss.engine, miss.id("slot")), "play", "control: with 2 life it survives 1 damage");
});

clause(SLOT, "0:ability:gamble", "the strength gain is real: a hit makes the Slotpuller deal 3 battle damage to the faction", () => {
  const { engine, id } = slotBoard(["item"], { deception: 3 });
  gamble(engine, id("slot"), "item");
  fight(engine, P1, [id("slot")], FACTION_P2, []);
  assert.equal(influenceOf(engine, P2), 30 - 3, "3 strength, 3 influence");
});

clause(SLOT, "0:ability:gamble", "it can be used again: the next top card is revealed, the effects stack, and each use costs 1", () => {
  const { engine, id } = slotBoard(["item", "item", "character"], { deception: 4 });
  const before = ready(engine);
  gamble(engine, id("slot"), "item");
  gamble(engine, id("slot"), "item");
  assert.equal(before - ready(engine), 2);
  assert.equal(engine.getStat(id("slot"), "strength"), 1 + 2 + 2, "two hits give +4 strength");
  assert.equal(engine.getStat(id("slot"), "life"), 2 - 1 - 1, "...and -2 life");
  assert.deepEqual(
    deckOf(engine, P1).map((cardId) => engine.getDefinition(cardId).name),
    ["Deck2", "Deck0", "Deck1"],
    "each used card went to the bottom in turn"
  );
});

clause(SLOT, "0:ability:gamble", "a Slotpuller reduced to 0 life by two hits is destroyed (a character with life 0 is destroyed, FAQ)", () => {
  const { engine, id } = slotBoard(["item", "item", "character"], { deception: 4 });
  gamble(engine, id("slot"), "item");
  gamble(engine, id("slot"), "item");
  assert.equal(zoneOf(engine, id("slot")), "discard", "0 life, 0 damage: destroyed immediately");
});

clause(SLOT, "0:ability:gamble", "with a one-card deck the card is revealed, matched, and stays (top and bottom are the same card)", () => {
  const { engine, id } = slotBoard(["tactic"]);
  gamble(engine, id("slot"), "tactic");
  assert.deepEqual(stats(engine, id("slot")), { strength: 3, life: 1, speed: 4 });
  assert.deepEqual(deckOf(engine, P1), [id("d0")]);
});

clause(SLOT, "0:ability:gamble", "with an empty deck there is nothing to reveal: it can still be used, pays 1, and gives no bonus", () => {
  const { engine, id } = slotBoard([]);
  const before = ready(engine);
  gamble(engine, id("slot"), "character");
  assert.equal(before - ready(engine), 1, "the cost is paid");
  assert.deepEqual(stats(engine, id("slot")), { strength: 1, life: 2, speed: 4 }, "no card, so no match");
  assert.equal(influenceOf(engine, P1), 30, "running out of cards is not a loss");
  assert.equal(engine.state.winner, undefined);
});

clause(SLOT, "0:ability:gamble", "only its controller can use it: the opponent cannot use my Slotpuller's GAMBLE", () => {
  const { engine, id } = slotBoard(["item"], {}, [...res({ deception: 3 }, P2)]);
  declareAttackOpenWindow(engine, P1, [id("ally")]);
  refused(() => actRaw(engine, P2, id("slot"), "gamble"), "the opponent using my ability", /control|own|cannot|illegal|only|usable|available/i);
  assert.equal(pending(engine), undefined);
});

// --- FLIP UP battery (shared bodies) -------------------------------------------
// Used by Pant Swipe, Rumply Ruse, Strangulate and Swollen Ostrich: each card gives its own
// board builder and a literal-printing `clause(...)` call per check.

interface FlipBoardOpts {
  /** Staple resources I control (besides the face-down card itself). */
  icons?: Icons;
  /** Staple resources the opponent controls. */
  oppIcons?: Icons;
  /** Face-down cards (each provides Volition) I control besides the card itself. */
  volition?: number;
  /** Where the card under test is ("play" face-down by default). */
  zone?: "hand" | "play";
  faceDown?: boolean;
}

interface FlipSpec {
  /** Builds a board with the card under test as key "card". */
  mk: (o: FlipBoardOpts) => ReturnType<typeof buildGame>;
  icon: StapleIcon;
  threshold: number;
  /** The printed FLIP UP cost. */
  cost: number;
  /** Selected targets for the flipUp action. */
  selected?: (id: (k: string) => CardInstanceId) => Record<string, CardInstanceId[]>;
}

function flipRaw(g: ReturnType<typeof buildGame>, spec: FlipSpec, player: PlayerId = P1): void {
  flipUpNow(g.engine, { type: "flipUp", playerId: player, cardId: g.id("card"), selected: spec.selected?.(g.id) ?? {}, variables: {} });
}

function flipAndSettle(g: ReturnType<typeof buildGame>, spec: FlipSpec, player: PlayerId = P1): void {
  flipRaw(g, spec, player);
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
}

/** Flipping up pays exactly the printed FLIP UP cost (the face-down card itself stops being a resource). */
function flipPaysExactly(spec: FlipSpec): void {
  const g = spec.mk({ icons: { [spec.icon]: spec.threshold + 4 } });
  const before = ready(g.engine);
  flipAndSettle(g, spec);
  assert.equal(g.engine.state.cards[g.id("card")].faceDown, false, "it is face-up now");
  assert.equal(before - ready(g.engine), spec.cost + 1, `${spec.cost} paid, plus the face-down card itself stops being a resource`);
}

/** The card may pay for its own FLIP UP (CR 507.4b): cost - 1 other resources plus the face-down card are exactly enough. */
function flipSelfPays(spec: FlipSpec): void {
  const g = spec.mk({ icons: { [spec.icon]: spec.cost - 1 } });
  assert.equal(ready(g.engine), spec.cost, "the others plus the face-down card");
  flipAndSettle(g, spec);
  assert.equal(g.engine.state.cards[g.id("card")].faceDown, false);
  assert.equal(ready(g.engine), 0, "everything was used");
}

/** One resource short of the cost (counting the face-down card itself) is refused and nothing is paid. */
function flipOneShort(spec: FlipSpec): void {
  const g = spec.mk({ icons: { [spec.icon]: spec.cost - 2 } });
  assert.equal(ready(g.engine), spec.cost - 1, "one short, counting the face-down card");
  refused(() => flipRaw(g, spec), "one resource short");
  assert.equal(g.engine.state.cards[g.id("card")].faceDown, true, "still face-down");
  assert.equal(ready(g.engine), spec.cost - 1, "nothing was paid");
}

/** Without the threshold, even a huge pile of other resources is refused. */
function flipNeedsThreshold(spec: FlipSpec): void {
  const g = spec.mk({ icons: { [spec.icon]: spec.threshold - 1, [filler(spec.icon)]: 6, greed: 3 } as Icons });
  refused(() => flipRaw(g, spec), `threshold of ${spec.threshold} [${spec.icon}] not met`);
  assert.equal(g.engine.state.cards[g.id("card")].faceDown, true);
  const ok = spec.mk({ icons: { [spec.icon]: spec.threshold, [filler(spec.icon)]: 6, greed: 3 } as Icons });
  flipAndSettle(ok, spec);
  assert.equal(ok.engine.state.cards[ok.id("card")].faceDown, false, "control: with the threshold it works");
}

/** The opponent's icons and my face-down cards' Volition do not meet the threshold. */
function flipIconsMustBeMineAndReal(spec: FlipSpec): void {
  const theirs = spec.mk({ icons: { [filler(spec.icon)]: 6 }, oppIcons: { [spec.icon]: spec.threshold + 3 } });
  refused(() => flipRaw(theirs, spec), "the opponent's icons do not count");
  assert.equal(theirs.engine.state.cards[theirs.id("card")].faceDown, true);
  const vol = spec.mk({ icons: { [filler(spec.icon)]: 2 }, volition: spec.cost + spec.threshold + 2 });
  refused(() => flipRaw(vol, spec), "Volition is not the printed icon");
  assert.equal(vol.engine.state.cards[vol.id("card")].faceDown, true);
}

/** FLIP UP works only on a face-down card I control in play. */
function flipOnlyFaceDownInPlay(spec: FlipSpec): void {
  const icons = { [spec.icon]: spec.threshold + spec.cost + 2 };
  const faceUp = spec.mk({ icons, faceDown: false });
  refused(() => flipRaw(faceUp, spec), "already face-up");
  const inHand = spec.mk({ icons, zone: "hand" });
  refused(() => flipRaw(inHand, spec), "in hand");
  const theirs = spec.mk({ icons });
  refused(() => flipRaw(theirs, spec, P2), "only its controller can flip it up");
  assert.equal(theirs.engine.state.cards[theirs.id("card")].faceDown, true);
  const ok = spec.mk({ icons });
  flipAndSettle(ok, spec);
  assert.equal(ok.engine.state.cards[ok.id("card")].faceDown, false, "control: the face-down card I control flips up");
}

// --- Overindulge -------------------------------------------------------------
// Choose one of the following as this card's rules text:
// OPTION 1 -- COST: Pick a character. -- EFFECT: This turn, the character loses 2 life.
// OPTION 2 -- COST: Pick a character. -- EFFECT: This turn, the character loses 1 life. Draw a card.
// Tactic, cost 2, [D][D].

const OVERINDULGE = "30dd0075-1c8a-449d-9e73-b8a4d0f87f24";

function overBoard(icons: Icons = { deception: 4 }, extra: CardPlacement[] = []) {
  return devBoard([
    { key: "ov", def: printing(OVERINDULGE), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
    { key: "other", def: character({ name: "Other", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
    ...deckCards("a", 3, P1),
    ...deckCards("b", 3, P2),
    ...res(icons),
    ...extra
  ]);
}

const overPlay = (b: ReturnType<typeof overBoard>, mode: number, picked: string, key = "ov") =>
  play(b.engine, P1, b.id(key), { mode, selected: { c: [b.id(picked)] } });

/** Everything that is not "a character in play": the picks both options must refuse. */
const NOT_A_CHARACTER_IN_PLAY: CardPlacement[] = [
  { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
  { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
  { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
  { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
  { key: "inDeck", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
  ...volition(1, P1).map((placement) => ({ ...placement, key: "downCard" }))
];

function assertOnlyCharactersInPlayCanBePicked(mode: number): void {
  for (const bad of ["thing", "place", "inHand", "inDiscard", "inDeck", "downCard"]) {
    const b = overBoard({ deception: 4 }, NOT_A_CHARACTER_IN_PLAY);
    refused(() => playModeRaw(b.engine, P1, b.id("ov"), { mode, selected: { c: [b.id(bad)] } }), `picking ${bad}`);
    assert.equal(zoneOf(b.engine, b.id("ov")), "hand");
  }
  const b = overBoard({ deception: 4 }, NOT_A_CHARACTER_IN_PLAY);
  refused(() => playModeRaw(b.engine, P1, b.id("ov"), { mode, selected: { c: [factionOf(b.engine, P1)] } }), "my faction (CR 202.9)");
  refused(() => playModeRaw(b.engine, P1, b.id("ov"), { mode, selected: { c: [factionOf(b.engine, P2)] } }), "their faction (CR 202.9)");
  playModeRaw(b.engine, P1, b.id("ov"), { mode, selected: { c: [b.id("mine")] } });
  assert.ok(b.engine.state.responseWindow, "control: a character in play is accepted");
}

clause(OVERINDULGE, "0:rule", "deploys for its printed cost of 2 with [D][D] (either option), and is refused without the threshold", () => {
  for (const mode of [0, 1]) {
    headerChecks((icons) => overBoard(icons), "ov", { icon: "deception", threshold: 2, cost: 2, lands: "discard", mode, selected: (id) => ({ c: [id("mine")] }) });
  }
});

clause(OVERINDULGE, "0:rule", "choosing OPTION 1 applies only OPTION 1: the character loses 2 life and no card is drawn", () => {
  const b = overBoard();
  const hand = handOf(b.engine, P1).length;
  overPlay(b, 0, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 1, "2 life lost, not 1");
  assert.equal(handOf(b.engine, P1).length, hand - 1, "the tactic left the hand and nothing was drawn");
  assert.equal(deckOf(b.engine, P1).length, 3);
  assert.equal(zoneOf(b.engine, b.id("ov")), "discard");
});

clause(OVERINDULGE, "0:rule", "choosing OPTION 2 applies only OPTION 2: the character loses 1 life (not 2) and a card is drawn", () => {
  const b = overBoard();
  const hand = handOf(b.engine, P1).length;
  overPlay(b, 1, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 2, "1 life lost, not 2");
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1, "the tactic left the hand and one card was drawn");
  assert.equal(deckOf(b.engine, P1).length, 2);
  assert.equal(zoneOf(b.engine, b.id("ov")), "discard");
});

clause(OVERINDULGE, "0:rule", "one of the options must be chosen: playing it with no option chosen is refused", () => {
  const b = overBoard();
  refused(() => playModeRaw(b.engine, P1, b.id("ov"), { selected: { c: [b.id("mine")] } }), "no option chosen");
  assert.equal(zoneOf(b.engine, b.id("ov")), "hand");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3, "nothing happened to the character");
});

clause(OVERINDULGE, "0:rule", "only the two printed options exist: a third or a negative option is refused, and choosing OPTION 1 works as a control", () => {
  const b = overBoard();
  refused(() => playModeRaw(b.engine, P1, b.id("ov"), { selected: { c: [b.id("mine")] }, mode: 2 }), "a third option");
  refused(() => playModeRaw(b.engine, P1, b.id("ov"), { selected: { c: [b.id("mine")] }, mode: -1 }), "a negative option");
  assert.equal(zoneOf(b.engine, b.id("ov")), "hand", "nothing was played");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3);
  overPlay(b, 0, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 1, "control: choosing OPTION 1 works");
});

clause(OVERINDULGE, "0:rule", "each option has its own extra cost: both OPTION 1 and OPTION 2 refuse to be played without a character pick", () => {
  for (const mode of [0, 1]) {
    const b = overBoard();
    refused(() => playModeRaw(b.engine, P1, b.id("ov"), { selected: {}, mode }), `option ${mode + 1} without a pick`);
    assert.equal(zoneOf(b.engine, b.id("ov")), "hand");
  }
});

// OPTION 1 -------------------------------------------------------------------

clause(OVERINDULGE, "1:option:OPTION 1", "pays 2 and the picked character loses exactly 2 life; no other character is affected", () => {
  const b = overBoard();
  const before = ready(b.engine);
  overPlay(b, 0, "mine");
  assert.equal(before - ready(b.engine), 2, "the printed cost of 2");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 1);
  assert.equal(b.engine.getStat(b.id("other"), "life"), 3, "my other character is unaffected");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3, "the opponent's character is unaffected");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "only life changes");
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "only life changes");
});

clause(OVERINDULGE, "1:option:OPTION 1", "any character can be picked, including the opponent's", () => {
  const b = overBoard();
  overPlay(b, 0, "foe");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 1);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3);
  assert.equal(handOf(b.engine, P2).length, 0);
});

clause(OVERINDULGE, "1:option:OPTION 1", "only a character in play can be picked: not an item, location, faction, face-down card, or a character in hand, deck or discard pile", () => {
  assertOnlyCharactersInPlayCanBePicked(0);
});

clause(OVERINDULGE, "1:option:OPTION 1", "exactly one character is picked: none or two are refused", () => {
  const b = overBoard();
  refused(() => playModeRaw(b.engine, P1, b.id("ov"), { mode: 0, selected: { c: [] } }), "no pick");
  refused(() => playModeRaw(b.engine, P1, b.id("ov"), { mode: 0, selected: { c: [b.id("mine"), b.id("other")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("ov")), "hand");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3);
});

clause(OVERINDULGE, "1:option:OPTION 1", "the loss lasts this turn only: gone when the turn ends", () => {
  const b = overBoard();
  overPlay(b, 0, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 1);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3, "restored when the turn ends");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3, "and it does not come back");
});

clause(OVERINDULGE, "1:option:OPTION 1", "it is a life loss, not damage: no damage is put on the character, and 1 real damage then destroys a character left at 1 life", () => {
  const b = overBoard({ deception: 4 }, [{ key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }]);
  overPlay(b, 0, "mine");
  assert.equal(damageOf(b.engine, b.id("mine")), 0, "no damage markers");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  play(b.engine, P1, b.id("z1"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "1 life, 1 damage: destroyed");
  const control = overBoard({ deception: 4 }, [{ key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }]);
  play(control.engine, P1, control.id("z1"), { selected: { t: [control.id("mine")] } });
  assert.equal(zoneOf(control.engine, control.id("mine")), "play", "control: 3 life survives 1 damage");
});

clause(OVERINDULGE, "1:option:OPTION 1", "a character with 2 life that loses 2 life has 0 life and is destroyed (FAQ: 0 life is destroyed)", () => {
  const b = overBoard({ deception: 4 }, [{ key: "two", def: character({ name: "Two", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }]);
  overPlay(b, 0, "two");
  assert.equal(zoneOf(b.engine, b.id("two")), "discard");
});

clause(OVERINDULGE, "1:option:OPTION 1", "a character with 1 life that loses 2 life stops at 0 life (CR 410.4) and is destroyed", () => {
  const b = overBoard({ deception: 4 }, [{ key: "one", def: character({ name: "One", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" }]);
  overPlay(b, 0, "one");
  assert.equal(zoneOf(b.engine, b.id("one")), "discard", "destroyed");
});

clause(OVERINDULGE, "1:option:OPTION 1", "a life loss larger than the character's life never reports negative life (CR 410.4)", () => {
  const b = overBoard({ deception: 4 }, [{ key: "one", def: character({ name: "One", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" }]);
  overPlay(b, 0, "one");
  assert.ok(b.engine.getStat(b.id("one"), "life") >= 0, "a number is never pushed below 0");
});

clause(OVERINDULGE, "1:option:OPTION 1", "two plays stack: -4 life in total on the same character", () => {
  const b = overBoard({ deception: 6 }, [
    { key: "tall", def: character({ name: "Tall", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
    { key: "ov2", def: printing(OVERINDULGE), owner: P1, zone: "hand" }
  ]);
  overPlay(b, 0, "tall");
  overPlay(b, 0, "tall", "ov2");
  assert.equal(b.engine.getStat(b.id("tall"), "life"), 2);
});

clause(OVERINDULGE, "1:option:OPTION 1", "if the picked character is destroyed in response, the tactic still resolves and ends in the discard pile", () => {
  const b = overBoard({ deception: 4 }, [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }]);
  playModeRaw(b.engine, P1, b.id("ov"), { mode: 0, selected: { c: [b.id("mine")] } });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("mine")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ov")), "discard");
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.getStat(b.id("other"), "life"), 3, "nobody else was affected");
});

// OPTION 2 -------------------------------------------------------------------

clause(OVERINDULGE, "2:option:OPTION 2", "pays 2, the picked character loses exactly 1 life, and no other character is affected", () => {
  const b = overBoard();
  const before = ready(b.engine);
  overPlay(b, 1, "mine");
  assert.equal(before - ready(b.engine), 2, "the printed cost of 2");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 2);
  assert.equal(b.engine.getStat(b.id("other"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "only life changes");
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "only life changes");
});

clause(OVERINDULGE, "2:option:OPTION 2", "I draw exactly one card, from the top of my own deck, and the opponent draws nothing", () => {
  const b = overBoard();
  const top = deckOf(b.engine, P1)[0];
  const oppDeck = deckOf(b.engine, P2);
  overPlay(b, 1, "mine");
  assert.equal(zoneOf(b.engine, top), "hand", "the top card of my deck is in my hand");
  assert.equal(deckOf(b.engine, P1).length, 2, "exactly one card left my deck");
  assert.equal(handOf(b.engine, P2).length, 0);
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "the opponent's deck is untouched");
});

clause(OVERINDULGE, "2:option:OPTION 2", "picking an opponent's character: it loses 1 life, and I (the controller) draw, not its controller", () => {
  const b = overBoard();
  const hand = handOf(b.engine, P1).length;
  overPlay(b, 1, "foe");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 2);
  assert.equal(handOf(b.engine, P1).length, hand - 1 + 1);
  assert.equal(handOf(b.engine, P2).length, 0);
  assert.equal(deckOf(b.engine, P2).length, 3);
});

clause(OVERINDULGE, "2:option:OPTION 2", "only a character in play can be picked: not an item, location, faction, face-down card, or a character in hand, deck or discard pile", () => {
  assertOnlyCharactersInPlayCanBePicked(1);
});

clause(OVERINDULGE, "2:option:OPTION 2", "exactly one character is picked: none or two are refused", () => {
  const b = overBoard();
  refused(() => playModeRaw(b.engine, P1, b.id("ov"), { mode: 1, selected: { c: [] } }), "no pick");
  refused(() => playModeRaw(b.engine, P1, b.id("ov"), { mode: 1, selected: { c: [b.id("mine"), b.id("other")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("ov")), "hand");
  assert.equal(handOf(b.engine, P1).length, 1, "nothing was drawn");
});

clause(OVERINDULGE, "2:option:OPTION 2", "the loss lasts this turn only; the drawn card stays drawn", () => {
  const b = overBoard();
  const top = deckOf(b.engine, P1)[0];
  overPlay(b, 1, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3, "restored when the turn ends");
  assert.equal(zoneOf(b.engine, top), "hand", "the card is kept");
});

clause(OVERINDULGE, "2:option:OPTION 2", "the loss is real life, not damage: no damage markers, and 2 damage then destroys the 2-life character", () => {
  const b = overBoard({ deception: 4 }, [{ key: "z2", def: zapTactic("Zap2", 2), owner: P1, zone: "hand" }]);
  overPlay(b, 1, "mine");
  assert.equal(damageOf(b.engine, b.id("mine")), 0);
  play(b.engine, P1, b.id("z2"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "2 life, 2 damage: destroyed");
  const control = overBoard({ deception: 4 }, [{ key: "z2", def: zapTactic("Zap2", 2), owner: P1, zone: "hand" }]);
  play(control.engine, P1, control.id("z2"), { selected: { t: [control.id("mine")] } });
  assert.equal(zoneOf(control.engine, control.id("mine")), "play", "control: 3 life survives 2 damage");
});

clause(OVERINDULGE, "2:option:OPTION 2", "a character with 1 life that loses 1 life has 0 life and is destroyed (FAQ: 0 life is destroyed)", () => {
  const b = overBoard({ deception: 4 }, [{ key: "one", def: character({ name: "One", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" }]);
  overPlay(b, 1, "one");
  assert.equal(zoneOf(b.engine, b.id("one")), "discard", "0 life: destroyed (FAQ)");
});

clause(OVERINDULGE, "2:option:OPTION 2", "the draw is a separate instruction: it still happens when the character that lost the life is a 1-life character", () => {
  const b = overBoard({ deception: 4 }, [{ key: "one", def: character({ name: "One", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" }]);
  const top = deckOf(b.engine, P1)[0];
  overPlay(b, 1, "one");
  assert.equal(zoneOf(b.engine, top), "hand", "the card was drawn");
  assert.equal(deckOf(b.engine, P1).length, 2);
});

clause(OVERINDULGE, "2:option:OPTION 2", "with an empty deck the life is still lost and nothing is drawn (not a loss of the game)", () => {
  const b = devBoard([
    { key: "ov", def: printing(OVERINDULGE), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
    ...res({ deception: 3 })
  ]);
  overPlay(b, 1, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 2);
  assert.equal(handOf(b.engine, P1).length, 0, "nothing to draw");
  assert.equal(b.engine.state.winner, undefined);
});

clause(OVERINDULGE, "2:option:OPTION 2", "if the picked character is destroyed in response, the tactic still resolves as far as it can: I still draw", () => {
  const b = overBoard({ deception: 4 }, [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }]);
  const top = deckOf(b.engine, P1)[0];
  playModeRaw(b.engine, P1, b.id("ov"), { mode: 1, selected: { c: [b.id("mine")] } });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("mine")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, top), "hand", "the draw still happens (CR 402.5)");
  assert.equal(zoneOf(b.engine, b.id("ov")), "discard");
});

// --- Palm Glom ---------------------------------------------------------------
// COST: Pick a character or item. -- EFFECT: Take control of the character or item. Draw a card.
// Tactic, cost 6, [D][D][D][D][D][D].

const GLOM = "45336428-4e91-431e-900b-86b57002da3f";

function glomBoard(icons: Icons = { deception: 8 }, extra: CardPlacement[] = [], opts: { turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "glom", def: printing(GLOM), owner: P1, zone: "hand" },
      { key: "foeC", def: character({ name: "FoeChar", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeI", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "mineC", def: character({ name: "MineChar", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mineI", def: item({ name: "MineItem" }), owner: P1, zone: "play" },
      ...deckCards("a", 3, P1),
      ...deckCards("b", 3, P2),
      ...res(icons),
      ...extra
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

const glomPlay = (b: ReturnType<typeof glomBoard>, picked: string) => play(b.engine, P1, b.id("glom"), { selected: { t: [b.id(picked)] } });

clause(GLOM, "0:ability", "deploys for its printed cost of 6 with six [D], and is refused without the threshold", () => {
  headerChecks((icons) => glomBoard(icons), "glom", { icon: "deception", threshold: 6, cost: 6, lands: "discard", selected: (id) => ({ t: [id("foeC")] }) });
});

clause(GLOM, "0:ability", "pays exactly 6 resources", () => {
  const b = glomBoard({ deception: 9 });
  const before = ready(b.engine);
  glomPlay(b, "foeC");
  assert.equal(before - ready(b.engine), 6);
});

clause(GLOM, "0:ability", "takes control of an opponent's character: it is mine, in my play area and no longer in theirs", () => {
  const b = glomBoard();
  glomPlay(b, "foeC");
  assert.equal(controllerOf(b.engine, b.id("foeC")), P1);
  assert.ok(playOf(b.engine, P1).includes(b.id("foeC")), "it is in my in-play list");
  assert.equal(playOf(b.engine, P2).includes(b.id("foeC")), false, "and not in theirs");
  assert.equal(ownerOf(b.engine, b.id("foeC")), P2, "the owner never changes (CR 407.8)");
  assert.equal(zoneOf(b.engine, b.id("foeC")), "play");
});

clause(GLOM, "0:ability", "takes control of an opponent's item", () => {
  const b = glomBoard();
  glomPlay(b, "foeI");
  assert.equal(controllerOf(b.engine, b.id("foeI")), P1);
  assert.ok(playOf(b.engine, P1).includes(b.id("foeI")), "playOf(b.engine, P1).includes(b.id(\"foeI\"))");
  assert.equal(controllerOf(b.engine, b.id("foeC")), P2, "the opponent's character was not taken");
});

clause(GLOM, "0:ability", "only the picked card changes hands: the opponent's other cards stay theirs", () => {
  const b = glomBoard({ deception: 8 }, [{ key: "foeC2", def: character({ name: "FoeChar2" }), owner: P2, zone: "play" }]);
  glomPlay(b, "foeC");
  assert.equal(controllerOf(b.engine, b.id("foeC2")), P2);
  assert.equal(controllerOf(b.engine, b.id("foeI")), P2);
  assert.equal(controllerOf(b.engine, b.id("mineC")), P1);
});

clause(GLOM, "0:ability", "my own character or item may be picked too ('a character or item', no controller restriction): it stays mine and I still draw", () => {
  const top = (b: ReturnType<typeof glomBoard>) => deckOf(b.engine, P1)[0];
  const c = glomBoard();
  const topC = top(c);
  glomPlay(c, "mineC");
  assert.equal(controllerOf(c.engine, c.id("mineC")), P1);
  assert.equal(zoneOf(c.engine, topC), "hand", "I drew");
  const i = glomBoard();
  const topI = top(i);
  glomPlay(i, "mineI");
  assert.equal(controllerOf(i.engine, i.id("mineI")), P1);
  assert.equal(zoneOf(i.engine, topI), "hand", "I drew");
});

clause(GLOM, "0:ability", "I draw exactly one card from my own deck; the opponent draws nothing", () => {
  const b = glomBoard();
  const top = deckOf(b.engine, P1)[0];
  const oppDeck = deckOf(b.engine, P2);
  glomPlay(b, "foeC");
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(deckOf(b.engine, P1).length, 2, "exactly one card drawn");
  assert.equal(handOf(b.engine, P1).length, 1, "the tactic left the hand, the drawn card arrived");
  assert.equal(handOf(b.engine, P2).length, 0);
  assert.deepEqual(deckOf(b.engine, P2), oppDeck);
});

clause(GLOM, "0:ability", "the tactic ends in my discard pile", () => {
  const b = glomBoard();
  glomPlay(b, "foeC");
  assert.equal(zoneOf(b.engine, b.id("glom")), "discard");
  assert.ok(discardOf(b.engine, P1).includes(b.id("glom")), "discardOf(b.engine, P1).includes(b.id(\"glom\"))");
});

clause(GLOM, "0:ability", "the control change is permanent: I still control the character after both players' turns have passed", () => {
  const b = glomBoard();
  glomPlay(b, "foeC");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(controllerOf(b.engine, b.id("foeC")), P1, "no 'this turn' on the card");
  assert.ok(playOf(b.engine, P1).includes(b.id("foeC")), "playOf(b.engine, P1).includes(b.id(\"foeC\"))");
});

clause(GLOM, "0:ability", "the taken character really is mine: it can block for me on the opponent's turn", () => {
  const b = glomBoard({ deception: 8 }, [{ key: "atk", def: character({ name: "Attacker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }], { turn: 2 });
  glomPlay(b, "foeC");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("foeC")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foeC")], "the character I took blocks for me");
});

clause(GLOM, "0:ability", "taking control of an attacking character removes it from the battle (CR 407.4)", () => {
  const b = devBoard(
    [
      { key: "glom", def: printing(GLOM), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...deckCards("a", 2, P1),
      ...res({ deception: 8 })
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(b.engine, P2, [b.id("atk"), b.id("other")]);
  assert.equal(b.engine.state.priorityPlayerId, P1, "I hold priority in the response window");
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("glom"), selected: { t: [b.id("atk")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(controllerOf(b.engine, b.id("atk")), P1);
  assert.ok(battleOf(b.engine), "the battle goes on: one attacker is left");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("other")], "the taken attacker left the attacking party and the other attacker is still attacking");
});

clause(GLOM, "0:ability", "only a character or item in play can be picked: not a location, faction, face-down card, or a card in hand, deck or discard pile", () => {
  const extra: CardPlacement[] = [
    { key: "foeL", def: location({ name: "FoeLocation" }), owner: P2, zone: "play" },
    { key: "foeHand", def: character({ name: "FoeHand" }), owner: P2, zone: "hand" },
    { key: "foeDiscard", def: character({ name: "FoeDiscard" }), owner: P2, zone: "discard" },
    { key: "foeDeck", def: character({ name: "FoeDeckCard" }), owner: P2, zone: "deck" },
    ...volition(1, P2).map((placement) => ({ ...placement, key: "foeDown" }))
  ];
  for (const bad of ["foeL", "foeHand", "foeDiscard", "foeDeck", "foeDown"]) {
    const b = glomBoard({ deception: 8 }, extra);
    refused(() => playRaw(b.engine, P1, b.id("glom"), { selected: { t: [b.id(bad)] } }), `picking ${bad}`);
    assert.equal(zoneOf(b.engine, b.id("glom")), "hand");
  }
  const b = glomBoard({ deception: 8 }, extra);
  refused(() => playRaw(b.engine, P1, b.id("glom"), { selected: { t: [factionOf(b.engine, P2)] } }), "their faction (CR 202.9)");
  refused(() => playRaw(b.engine, P1, b.id("glom"), { selected: { t: [factionOf(b.engine, P1)] } }), "my faction (CR 202.9)");
  playRaw(b.engine, P1, b.id("glom"), { selected: { t: [b.id("foeC")] } });
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(GLOM, "0:ability", "exactly one card is picked: none or two are refused", () => {
  const b = glomBoard();
  refused(() => playRaw(b.engine, P1, b.id("glom"), { selected: {} }), "no declaration");
  refused(() => playRaw(b.engine, P1, b.id("glom"), { selected: { t: [] } }), "an empty pick");
  refused(() => playRaw(b.engine, P1, b.id("glom"), { selected: { t: [b.id("foeC"), b.id("foeI")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("glom")), "hand");
  assert.equal(controllerOf(b.engine, b.id("foeC")), P2);
});

clause(GLOM, "0:ability", "if the picked character is destroyed in response, I take control of nothing but still draw (CR 402.5a)", () => {
  const b = glomBoard({ deception: 8 }, [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }]);
  const top = deckOf(b.engine, P1)[0];
  playRaw(b.engine, P1, b.id("glom"), { selected: { t: [b.id("foeC")] } });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("foeC")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foeC")), "discard", "it was destroyed in response");
  assert.ok(discardOf(b.engine, P2).includes(b.id("foeC")), "into its owner's discard pile");
  assert.equal(zoneOf(b.engine, top), "hand", "the draw still happens");
  assert.equal(zoneOf(b.engine, b.id("glom")), "discard");
});

clause(GLOM, "0:ability", "with an empty deck the control is still taken and nothing is drawn", () => {
  const b = devBoard([
    { key: "glom", def: printing(GLOM), owner: P1, zone: "hand" },
    { key: "foeC", def: character({ name: "FoeChar" }), owner: P2, zone: "play" },
    ...res({ deception: 6 })
  ]);
  glomPlay(b, "foeC");
  assert.equal(controllerOf(b.engine, b.id("foeC")), P1);
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.equal(b.engine.state.winner, undefined);
});

// --- Pant Swipe --------------------------------------------------------------
// Remove the top 4 cards of your opponent's deck from the game face-down. (You
// are still allowed to look at them.) -- For the rest of the game, you may play
// the removed cards as though they were in your hand even if you cannot meet
// their threshold. -- FLIP UP: 5 [D][D][D]. Tactic, cost 7, [D][D][D].

const PANT = "0fae8376-e4e6-4f0c-ae33-8be60ca717a9";

/** The opponent's deck, top first, keys `e1..eN`. */
function oppDeck(defs: CardDefinition[]): CardPlacement[] {
  return defs.map((def, i): CardPlacement => ({ key: `e${i + 1}`, def, owner: P2, zone: "deck" }));
}
const plainOpp = (n: number): CardDefinition[] => Array.from({ length: n }, (_, i) => character({ name: `Opp${i + 1}`, cost: 1 }));

function pantBoard(opts: { deck?: CardDefinition[]; icons?: Icons; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "ps", def: printing(PANT), owner: P1, zone: "hand" },
      ...oppDeck(opts.deck ?? plainOpp(6)),
      ...deckCards("a", 4, P1),
      ...res(opts.icons ?? { deception: 9 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

/** Plays Pant Swipe picking the opponent's top `n` cards (what the declaration asks for). */
const pantPlay = (b: ReturnType<typeof pantBoard>, n = 4, key = "ps") =>
  play(b.engine, P1, b.id(key), { selected: { voided: Array.from({ length: n }, (_, i) => b.id(`e${i + 1}`)) } });

clause(PANT, "0:rule", "deploys for its printed cost of 7 with [D][D][D], and is refused without the threshold", () => {
  headerChecks((icons) => pantBoard({ icons }), "ps", { icon: "deception", threshold: 3, cost: 7, lands: "discard", selected: (id) => ({ voided: [id("e1"), id("e2"), id("e3"), id("e4")] }) });
});

clause(PANT, "0:rule", "the top 4 cards of the opponent's deck are removed automatically: no picking is needed", () => {
  const b = pantBoard();
  play(b.engine, P1, b.id("ps"), {});
  drain(b.engine, declineAll);
  for (const key of ["e1", "e2", "e3", "e4"]) assert.notEqual(zoneOf(b.engine, b.id(key)), "deck", `${key} left the opponent's deck`);
  assert.equal(zoneOf(b.engine, b.id("e5")), "deck");
  assert.equal(zoneOf(b.engine, b.id("e6")), "deck");
});

clause(PANT, "0:rule", "it cannot be played so that fewer than the top 4 cards are removed: a partial pick either removes all four or is refused", () => {
  const b = pantBoard();
  let refusedPlay = false;
  try {
    play(b.engine, P1, b.id("ps"), { selected: { voided: [b.id("e1"), b.id("e2")] } });
    drain(b.engine, declineAll);
  } catch {
    refusedPlay = true;
  }
  if (!refusedPlay) {
    for (const key of ["e1", "e2", "e3", "e4"]) assert.notEqual(zoneOf(b.engine, b.id(key)), "deck", `${key} must have been removed`);
  }
});

clause(PANT, "0:rule", "with fewer than 4 cards in the opponent's deck, all of them are removed automatically", () => {
  const b = pantBoard({ deck: plainOpp(2) });
  play(b.engine, P1, b.id("ps"), {});
  drain(b.engine, declineAll);
  assert.equal(deckOf(b.engine, P2).length, 0, "the whole short deck was removed");
});

clause(PANT, "0:rule", "removes exactly the top 4 cards of the opponent's deck, in the order they were; the rest of the deck is untouched", () => {
  const b = pantBoard();
  const before = deckOf(b.engine, P2);
  pantPlay(b);
  assert.deepEqual(deckOf(b.engine, P2), before.slice(4), "only the 5th and 6th cards remain, in order");
  for (const cardId of before.slice(0, 4)) assert.notEqual(zoneOf(b.engine, cardId), "deck");
  for (const cardId of before.slice(0, 4)) assert.equal(discardOf(b.engine, P2).includes(cardId), false, "they were not discarded");
  for (const cardId of before.slice(0, 4)) assert.equal(handOf(b.engine, P2).includes(cardId), false, "they were not drawn");
});

clause(PANT, "0:rule", "the cards are removed from the game (the Out of Game area, CR 403.6)", () => {
  const b = pantBoard();
  const top4 = deckOf(b.engine, P2).slice(0, 4);
  pantPlay(b);
  for (const cardId of top4) assert.equal(zoneOf(b.engine, cardId), "removed", "removed from the game");
  assert.deepEqual(removedOf(b.engine, P2).sort(), [...top4].sort());
});

clause(PANT, "0:rule", "only the opponent's deck is touched: my own deck, hand and discard pile are unchanged, and the opponent's hand and discard pile too", () => {
  const b = pantBoard({ extra: [...handCards("oh", 2, P2), { key: "od", def: character({ name: "OppDiscard" }), owner: P2, zone: "discard" }] });
  const myDeck = deckOf(b.engine, P1);
  const oppHand = handOf(b.engine, P2);
  const oppDiscard = discardOf(b.engine, P2);
  pantPlay(b);
  assert.deepEqual(deckOf(b.engine, P1), myDeck);
  assert.deepEqual(handOf(b.engine, P2), oppHand);
  assert.deepEqual(discardOf(b.engine, P2), oppDiscard);
});

// (The card never asks for a pick: the old test here asserted that a pick of a card from my own deck or from below
// the top 4 was refused. With the removal authored as a forEach over the opponent's top 4 there is nothing to pick.)
clause(PANT, "0:rule", "it is the OPPONENT's deck: only its top 4 cards are removed, never a card of my own deck or one from below the top 4", () => {
  const b = pantBoard();
  play(b.engine, P1, b.id("ps"), {});
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("a0")), "deck", "my own deck is untouched");
  assert.equal(zoneOf(b.engine, b.id("e5")), "deck", "the 5th card of their deck stays");
  for (const key of ["e1", "e2", "e3", "e4"]) assert.notEqual(zoneOf(b.engine, b.id(key)), "deck", `${key} left their deck`);
});

clause(PANT, "0:rule", "the tactic itself ends in my discard pile", () => {
  const b = pantBoard();
  pantPlay(b);
  assert.equal(zoneOf(b.engine, b.id("ps")), "discard");
  assert.ok(discardOf(b.engine, P1).includes(b.id("ps")), "discardOf(b.engine, P1).includes(b.id(\"ps\"))");
});

clause(PANT, "0:rule", "with fewer than 4 cards in the opponent's deck, whatever is there is removed (CR 402.5) and nothing breaks", () => {
  const two = pantBoard({ deck: plainOpp(2) });
  pantPlay(two, 2);
  assert.equal(deckOf(two.engine, P2).length, 0);
  assert.equal(two.engine.state.winner, undefined, "an empty deck is not a loss");
  assert.equal(zoneOf(two.engine, two.id("ps")), "discard");
});

clause(PANT, "0:rule", "with an empty opponent deck it resolves and removes nothing", () => {
  const b = pantBoard({ deck: [] });
  play(b.engine, P1, b.id("ps"), {});
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ps")), "discard");
  assert.equal(b.engine.state.winner, undefined);
});

// "play the removed cards as though they were in your hand"

const RAGER = (cost: number) => character({ name: `Rager${cost}`, cost, threshold: "rr" as never, strength: 2, life: 2, speed: 1 });

clause(PANT, "1:rule", "a removed card can be played even if I cannot meet its threshold: a [R][R] character with only [D] in play", () => {
  const b = pantBoard({ deck: [RAGER(2), ...plainOpp(5)], icons: { deception: 12 } });
  pantPlay(b);
  const before = ready(b.engine);
  play(b.engine, P1, b.id("e1"), {});
  assert.equal(zoneOf(b.engine, b.id("e1")), "play", "it was deployed");
  assert.equal(before - ready(b.engine), 2, "its numeric cost of 2 was paid");
  assert.equal(controllerOf(b.engine, b.id("e1")), P1, "under my control");
  assert.equal(ownerOf(b.engine, b.id("e1")), P2, "still owned by the opponent");
});

clause(PANT, "1:rule", "the threshold is waived but the numeric cost is not: a cost-3 removed card is refused with 2 resources and plays with 3", () => {
  const tight = pantBoard({ deck: [RAGER(3), ...plainOpp(5)], icons: { deception: 9 } });
  pantPlay(tight);
  assert.equal(ready(tight.engine), 2, "9 - 7");
  refused(() => playRaw(tight.engine, P1, tight.id("e1"), {}), "cost 3 with 2 resources");
  assert.notEqual(zoneOf(tight.engine, tight.id("e1")), "play");
  const enough = pantBoard({ deck: [RAGER(3), ...plainOpp(5)], icons: { deception: 10 } });
  pantPlay(enough);
  play(enough.engine, P1, enough.id("e1"), {});
  assert.equal(zoneOf(enough.engine, enough.id("e1")), "play", "control: with 3 resources it plays");
  assert.equal(ready(enough.engine), 0);
});

clause(PANT, "1:rule", "it can be played the turn after as well, and the turn after that: 'for the rest of the game'", () => {
  const b = pantBoard({ deck: [RAGER(1), ...plainOpp(5)], icons: { deception: 9 } });
  pantPlay(b);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  play(b.engine, P1, b.id("e1"), {});
  assert.equal(zoneOf(b.engine, b.id("e1")), "play", "playable two turns later");
});

clause(PANT, "1:rule", "only the removed cards: a card in the void that Pant Swipe did not remove cannot be played", () => {
  const b = pantBoard({ deck: [RAGER(1), ...plainOpp(5)], icons: { deception: 9 }, extra: [{ key: "other", def: RAGER(1), owner: P2, zone: "void" }] });
  pantPlay(b);
  refused(() => playRaw(b.engine, P1, b.id("other"), {}), "a void card Pant Swipe did not remove");
  assert.equal(zoneOf(b.engine, b.id("other")), "void");
  play(b.engine, P1, b.id("e1"), {});
  assert.equal(zoneOf(b.engine, b.id("e1")), "play", "control: a removed card can be played");
});

clause(PANT, "1:rule", "only a card the 4-card removal took: the 5th card of their deck cannot be played", () => {
  const b = pantBoard({ deck: [RAGER(1), RAGER(1), RAGER(1), RAGER(1), RAGER(1), RAGER(1)], icons: { deception: 9 } });
  pantPlay(b);
  refused(() => playRaw(b.engine, P1, b.id("e5"), {}), "a card still in their deck");
  assert.equal(zoneOf(b.engine, b.id("e5")), "deck");
});

clause(PANT, "1:rule", "the permission is mine: the opponent, who owns the removed cards, cannot play them from there on their own turn", () => {
  const b = pantBoard({ deck: [RAGER(0), ...plainOpp(5)], icons: { deception: 9 }, extra: [...res({ rage: 5, deception: 5 }, P2)] });
  pantPlay(b);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  refused(() => playRaw(b.engine, P2, b.id("e1"), {}), "the owner playing a card removed by my Pant Swipe");
  assert.notEqual(zoneOf(b.engine, b.id("e1")), "play");
});

clause(PANT, "1:rule", "'as though in your hand' includes timing: a removed character cannot be played on the opponent's turn", () => {
  const b = pantBoard({ deck: [RAGER(1), ...plainOpp(5)], icons: { deception: 9 }, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  pantPlay(b);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.priorityPlayerId, P1);
  refused(() => playRaw(b.engine, P1, b.id("e1"), {}), "a character deployed on the opponent's turn");
  assert.notEqual(zoneOf(b.engine, b.id("e1")), "play");
});

clause(PANT, "1:rule", "a removed tactic can be played whenever I could play a tactic, and it goes to its owner's (the opponent's) discard pile", () => {
  const zap = zapTactic("OppZap", 2);
  const b = pantBoard({
    deck: [{ ...zap, threshold: "rr" as never, cost: 1 }, ...plainOpp(5)],
    icons: { deception: 9 },
    extra: [{ key: "target", def: character({ name: "Target", life: 4 }), owner: P2, zone: "play" }]
  });
  pantPlay(b);
  play(b.engine, P1, b.id("e1"), { selected: { t: [b.id("target")] } });
  assert.equal(damageOf(b.engine, b.id("target")), 2, "the tactic did its job");
  assert.equal(zoneOf(b.engine, b.id("e1")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("e1")), "into its owner's discard pile (CR 205.2)");
  assert.equal(discardOf(b.engine, P1).includes(b.id("e1")), false);
});

clause(PANT, "1:rule", "a removed character that later dies goes to its owner's (the opponent's) discard pile", () => {
  const b = pantBoard({ deck: [RAGER(1), ...plainOpp(5)], icons: { deception: 9 }, extra: [{ key: "kill", def: killTactic({ name: "MyKill" }), owner: P1, zone: "hand" }] });
  pantPlay(b);
  play(b.engine, P1, b.id("e1"), {});
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("e1")] } });
  assert.ok(discardOf(b.engine, P2).includes(b.id("e1")), "its owner's discard pile");
});

clause(PANT, "1:rule", "a card removed from the game can't be played if Pant Swipe never resolved: with no Pant Swipe, a card the opponent has in the void is not mine to play", () => {
  const b = devBoard([
    { key: "v", def: RAGER(0), owner: P2, zone: "void" },
    ...res({ deception: 5, rage: 5 })
  ]);
  refused(() => playRaw(b.engine, P1, b.id("v"), {}), "no permission");
  assert.equal(zoneOf(b.engine, b.id("v")), "void");
});

// FLIP UP: 5 [D][D][D]

function pantFlipBoard(o: FlipBoardOpts) {
  return devBoard([
    { key: "card", def: printing(PANT), owner: P1, zone: o.zone ?? "play", faceDown: (o.zone ?? "play") === "play" ? o.faceDown ?? true : undefined },
    ...oppDeck(plainOpp(6)),
    ...res(o.icons ?? {}),
    ...res(o.oppIcons ?? {}, P2),
    ...volition(o.volition ?? 0, P1)
  ]);
}

const PANT_FLIP: FlipSpec = {
  mk: pantFlipBoard,
  icon: "deception",
  threshold: 3,
  cost: 5,
  selected: (id) => ({ voided: [id("e1"), id("e2"), id("e3"), id("e4")] })
};

clause(PANT, "2:flipUp", "flipping up pays exactly 5 (not its cost of 7), then does its text: the top 4 cards are removed and the tactic goes to my discard pile", () => {
  flipPaysExactly(PANT_FLIP);
  const g = pantFlipBoard({ icons: { deception: 7 } });
  const top4 = deckOf(g.engine, P2).slice(0, 4);
  flipAndSettle(g, PANT_FLIP);
  for (const cardId of top4) assert.notEqual(zoneOf(g.engine, cardId), "deck", "the top 4 left the opponent's deck");
  assert.equal(deckOf(g.engine, P2).length, 2);
  assert.equal(zoneOf(g.engine, g.id("card")), "discard", "a resolved tactic goes to its owner's discard pile");
});

clause(PANT, "2:flipUp", "after a flip-up, the 'play the removed cards' permission is live too", () => {
  const g = devBoard([
    { key: "card", def: printing(PANT), owner: P1, zone: "play", faceDown: true },
    ...oppDeck([RAGER(1), ...plainOpp(5)]),
    ...res({ deception: 9 })
  ]);
  flipAndSettle(g, PANT_FLIP);
  play(g.engine, P1, g.id("e1"), {});
  assert.equal(zoneOf(g.engine, g.id("e1")), "play", "a [R][R] character played with only [D]");
});

clause(PANT, "2:flipUp", "the face-down Pant Swipe may pay for its own FLIP UP: four [D] plus itself are exactly enough", () => {
  flipSelfPays(PANT_FLIP);
});

clause(PANT, "2:flipUp", "is refused one resource short of 5", () => {
  flipOneShort(PANT_FLIP);
});

clause(PANT, "2:flipUp", "needs [D][D][D]: two [D] and plenty of other resources is refused", () => {
  flipNeedsThreshold(PANT_FLIP);
});

clause(PANT, "2:flipUp", "the opponent's [D] and Volition from face-down cards do not meet the threshold", () => {
  flipIconsMustBeMineAndReal(PANT_FLIP);
});

clause(PANT, "2:flipUp", "FLIP UP works only on a face-down Pant Swipe I control in play (not face-up, not in hand, not the opponent's)", () => {
  flipOnlyFaceDownInPlay(PANT_FLIP);
});

clause(PANT, "2:flipUp", "FLIP UP does not change when a tactic can be played: I can flip it up in response to the opponent's attack", () => {
  const g = devBoard(
    [
      { key: "card", def: printing(PANT), owner: P1, zone: "play", faceDown: true },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" },
      ...oppDeck(plainOpp(6)),
      ...res({ deception: 6 })
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  flipRaw(g, PANT_FLIP);
  resolvePendingResponses(g.engine);
  assert.equal(deckOf(g.engine, P2).length, 2, "the removal resolved on the opponent's turn");
});

// --- Pit Boss ----------------------------------------------------------------
// This card gains 1 speed for each [D] you control.
// Character (crimelord), cost 2, [D], 2 strength / 0 speed / 2 life.

const PITBOSS = "2a855fa9-5c88-419f-b0ec-ba0451340de8";

function bossBoard(icons: Icons, extra: CardPlacement[] = [], opts: { turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "boss", def: printing(PITBOSS), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...res(icons),
      ...extra
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

clause(PITBOSS, "0:rule", "deploys for its printed cost of 2 with [D], is refused without it, and has 2 strength / 0 speed / 2 life", () => {
  headerChecks((icons) => devBoard([{ key: "boss", def: printing(PITBOSS), owner: P1, zone: "hand" }, ...res(icons)]), "boss", { icon: "deception", threshold: 1, cost: 2, lands: "play" });
  const b = bossBoard({ rage: 3 });
  assert.deepEqual(stats(b.engine, b.id("boss")), { strength: 2, life: 2, speed: 0 }, "printed stats with no [D]");
});

clause(PITBOSS, "0:rule", "gains exactly 1 speed per [D]: 0, 1, 2, 3, 5 and 8 [D] give speed 0, 1, 2, 3, 5 and 8", () => {
  for (const n of [0, 1, 2, 3, 5, 8]) {
    const b = bossBoard(n ? { deception: n } : {});
    assert.equal(b.engine.getStat(b.id("boss"), "speed"), n, `${n} [D]`);
  }
});

clause(PITBOSS, "0:rule", "only speed changes: strength and life stay at the printed 2 and 2", () => {
  const b = bossBoard({ deception: 4 });
  assert.deepEqual(stats(b.engine, b.id("boss")), { strength: 2, life: 2, speed: 4 });
});

clause(PITBOSS, "0:rule", "only [D] counts: other staple icons add nothing", () => {
  const b = bossBoard({ rage: 3, greed: 2, elitism: 4, obsession: 2 });
  assert.equal(b.engine.getStat(b.id("boss"), "speed"), 0);
  const mixed = bossBoard({ deception: 2, rage: 3, greed: 2, elitism: 4, obsession: 2 });
  assert.equal(mixed.engine.getStat(mixed.id("boss"), "speed"), 2);
});

clause(PITBOSS, "0:rule", "a resource that provides two [D] counts as two [D]", () => {
  const twin = resourceCard({ name: "Twin Deception", resource: { provides: ["deception", "deception"], staple: false } });
  const b = bossBoard({ deception: 1 }, [{ key: "twin", def: twin, owner: P1, zone: "play" }]);
  assert.equal(b.engine.getStat(b.id("boss"), "speed"), 3, "1 + 2");
});

clause(PITBOSS, "0:rule", "[D] already spent (attached to the faction) are still controlled and still count", () => {
  const b = bossBoard({ deception: 1 }, spentRes("s", "deception", 3));
  assert.equal(b.engine.getStat(b.id("boss"), "speed"), 4, "1 ready + 3 spent");
});

clause(PITBOSS, "0:rule", "face-down cards provide Volition, not [D], so they add no speed", () => {
  const b = bossBoard({ deception: 2 }, volition(4, P1));
  assert.equal(b.engine.getStat(b.id("boss"), "speed"), 2);
});

clause(PITBOSS, "0:rule", "the opponent's [D] are not mine: they add no speed", () => {
  const b = bossBoard({ deception: 2 }, res({ deception: 5 }, P2));
  assert.equal(b.engine.getStat(b.id("boss"), "speed"), 2);
});

clause(PITBOSS, "0:rule", "an opponent's Pit Boss counts its own controller's [D], not mine", () => {
  const b = devBoard([{ key: "bossFoe", def: printing(PITBOSS), owner: P2, zone: "play" }, ...res({ deception: 5 }, P1), ...res({ deception: 1 }, P2)]);
  assert.equal(b.engine.getStat(b.id("bossFoe"), "speed"), 1, "the opponent controls one [D]");
});

clause(PITBOSS, "0:rule", "it updates as resources come and go: playing a [D] resource raises the speed, destroying one lowers it", () => {
  const b = bossBoard({}, [
    ...keyedRes("d", "deception", 2),
    { key: "handRes", def: resourceCard({ name: "Deception Resource", resource: { provides: ["deception"], staple: true } }), owner: P1, zone: "hand" },
    { key: "kill", def: killAnyTactic("resource"), owner: P1, zone: "hand" }
  ]);
  assert.equal(b.engine.getStat(b.id("boss"), "speed"), 2);
  developPlay(b.engine, P1, b.id("handRes"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("boss"), "speed"), 3, "a third [D]");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("d0")] } });
  assert.equal(b.engine.getStat(b.id("boss"), "speed"), 2, "one [D] destroyed");
});

clause(PITBOSS, "0:rule", "a Pit Boss I take control of counts MY [D]", () => {
  const grab = tactic({
    name: "Grab",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grab",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = devBoard([
    { key: "bossFoe", def: printing(PITBOSS), owner: P2, zone: "play" },
    { key: "grab", def: grab, owner: P1, zone: "hand" },
    ...res({ deception: 4 }, P1),
    ...res({ deception: 1 }, P2)
  ]);
  assert.equal(b.engine.getStat(b.id("bossFoe"), "speed"), 1);
  play(b.engine, P1, b.id("grab"), { selected: { t: [b.id("bossFoe")] } });
  assert.equal(controllerOf(b.engine, b.id("bossFoe")), P1);
  assert.equal(b.engine.getStat(b.id("bossFoe"), "speed"), 4, "I control four [D]");
});

clause(PITBOSS, "0:rule", "only this card gains the speed: my other characters and the opponent's keep theirs", () => {
  const b = bossBoard({ deception: 4 }, [{ key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" }]);
  assert.equal(b.engine.getStat(b.id("other"), "speed"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2);
});

clause(PITBOSS, "0:rule", "two Pit Bosses each gain the full amount (they do not share or split it)", () => {
  const b = bossBoard({ deception: 3 }, [{ key: "boss2", def: printing(PITBOSS), owner: P1, zone: "play" }]);
  assert.equal(b.engine.getStat(b.id("boss"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("boss2"), "speed"), 3);
});

clause(PITBOSS, "0:rule", "the speed is real in battle: with 3 [D] it assigns damage in the speed-3 group, before a speed-2 blocker", () => {
  const b = bossBoard({ deception: 3 }, [{ key: "blk", def: character({ name: "Blocker", strength: 4, life: 5, speed: 2 }), owner: P2, zone: "play" }], { turn: 2 });
  declareAttackBy(b.engine, P1, [b.id("boss")]);
  declareBlockers(b.engine, P2, [b.id("blk")]);
  resolvePendingResponses(b.engine);
  const view = b.engine.getBattleView();
  assert.ok(view, "view");
  assert.equal(view.speed, 3, "the first speed group is 3: only the Pit Boss's bonus speed makes it so (the blocker is speed 2)");
  assert.deepEqual(view.damageSources.map((s) => ({ cardId: s.cardId, strength: s.strength })), [{ cardId: b.id("boss"), strength: 2 }], "only the speed-3 Pit Boss assigns first");
});

clause(PITBOSS, "0:rule", "with no [D] it has speed 0, the lowest speed, and still deals its damage (FAQ)", () => {
  const b = bossBoard({}, [], { turn: 2 });
  fight(b.engine, P1, [b.id("boss")], FACTION_P2, []);
  assert.equal(influenceOf(b.engine, P2), 30 - 2, "a 0-speed attacker still assigns its 2 damage");
});

// --- Rigged Tables -----------------------------------------------------------
// SIZE UP -- COST: Deplete this card. -- EFFECT: Look at the top card of either deck.
// RIG -- COST: Pay 1. -- EFFECT: Put the top card of either deck on the bottom.
// WALK AWAY -- COST: Pay 1. Destroy this card. -- EFFECT: Draw a card.
// Item, cost 0, [D][D].

const TABLES = "48f100ed-f3bb-4dcd-b4b7-78ac791fe579";

function tablesBoard(opts: { icons?: Icons; myDeck?: number; oppDeck?: number; depleted?: boolean; extra?: CardPlacement[]; active?: PlayerId; turn?: number } = {}) {
  return devBoard(
    [
      { key: "rt", def: printing(TABLES), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...deckCards("a", opts.myDeck ?? 3, P1),
      ...deckCards("b", opts.oppDeck ?? 3, P2),
      ...res(opts.icons ?? { deception: 3 }),
      ...(opts.extra ?? [])
    ],
    { activePlayerId: opts.active, turn: opts.turn }
  );
}

/** Activates `abilityId` and drains responses; returns with the first pending choice (the deck prompt) open. */
function useTables(b: ReturnType<typeof tablesBoard>, abilityId: string): void {
  actRaw(b.engine, P1, b.id("rt"), abilityId);
  resolvePendingResponses(b.engine);
}

/** Answers the "your deck / opponent deck" prompt. */
function chooseDeck(b: ReturnType<typeof tablesBoard>, which: "mine" | "theirs"): void {
  const pc = expectPending(b.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "I choose which deck");
  assert.equal((pc.options as unknown[]).length, 2, "exactly two decks to choose from: either deck");
  answerPending(b.engine, "chooserSelectsOption", { index: which === "mine" ? 0 : 1 });
}

/** Answers the look prompt for a one-card reorder with the cards unchanged. */
function acknowledgeLook(b: ReturnType<typeof tablesBoard>): PendingChoiceLike {
  const pc = expectPending(b.engine, "reorderDeck");
  const seen = { ...pc };
  answerPending(b.engine, "reorderDeck", { order: [...(pc.cardIds as string[])] });
  return seen;
}

clause(TABLES, "0:ability:size-up", "deploys for its printed cost of 0 with [D][D], and is refused without the threshold", () => {
  headerChecks((icons) => devBoard([{ key: "rt", def: printing(TABLES), owner: P1, zone: "hand" }, ...res(icons)]), "rt", { icon: "deception", threshold: 2, cost: 0, lands: "play" });
});

clause(TABLES, "0:ability:size-up", "the cost is to deplete this card (and nothing else): it is depleted once used, and no resource is paid", () => {
  const b = tablesBoard();
  const before = ready(b.engine);
  actRaw(b.engine, P1, b.id("rt"), "size-up");
  assert.equal(isDepleted(b.engine, b.id("rt")), true, "depleted as a cost, before anyone can respond");
  assert.equal(before - ready(b.engine), 0, "no resources paid");
  resolvePendingResponses(b.engine);
  chooseDeck(b, "mine");
  acknowledgeLook(b);
  assert.equal(isDepleted(b.engine, b.id("rt")), true, "and it stays depleted");
});

clause(TABLES, "0:ability:size-up", "I look at the top card of MY deck: the prompt shows exactly that one card, to me", () => {
  const b = tablesBoard();
  const top = deckOf(b.engine, P1)[0];
  useTables(b, "size-up");
  chooseDeck(b, "mine");
  const pc = expectPending(b.engine, "reorderDeck");
  assert.equal(pc.playerId, P1, "I am the one looking");
  assert.deepEqual(pc.cardIds, [top], "the top card of my deck, and only it");
  acknowledgeLook(b);
  assert.equal(pending(b.engine), undefined);
});

clause(TABLES, "0:ability:size-up", "I look at the top card of the OPPONENT's deck: the prompt shows their top card, to me (not to the deck's owner)", () => {
  const b = tablesBoard();
  const top = deckOf(b.engine, P2)[0];
  useTables(b, "size-up");
  chooseDeck(b, "theirs");
  const pc = expectPending(b.engine, "reorderDeck");
  assert.equal(pc.playerId, P1, "I am the one looking, not the deck's owner");
  assert.deepEqual(pc.cardIds, [top], "the top card of their deck, and only it");
  acknowledgeLook(b);
  assert.equal(pending(b.engine), undefined);
});

clause(TABLES, "0:ability:size-up", "looking changes nothing: both decks keep their exact order, and no card moves", () => {
  for (const which of ["mine", "theirs"] as const) {
    const b = tablesBoard();
    const mine = deckOf(b.engine, P1);
    const theirs = deckOf(b.engine, P2);
    useTables(b, "size-up");
    chooseDeck(b, which);
    acknowledgeLook(b);
    assert.deepEqual(deckOf(b.engine, P1), mine, `my deck after looking at ${which}`);
    assert.deepEqual(deckOf(b.engine, P2), theirs, `their deck after looking at ${which}`);
    assert.equal(handOf(b.engine, P1).length, 0);
    assert.equal(handOf(b.engine, P2).length, 0);
  }
});

clause(TABLES, "0:ability:size-up", "it is only the top card: looking at a one-card deck or an empty deck works and nothing breaks", () => {
  const one = tablesBoard({ myDeck: 1 });
  useTables(one, "size-up");
  chooseDeck(one, "mine");
  const pc = expectPending(one.engine, "reorderDeck");
  assert.equal((pc.cardIds as string[]).length, 1);
  acknowledgeLook(one);
  const none = tablesBoard({ oppDeck: 0 });
  useTables(none, "size-up");
  chooseDeck(none, "theirs");
  drain(none.engine, declineAll);
  assert.equal(pending(none.engine), undefined, "nothing left to decide");
  assert.equal(none.engine.state.winner, undefined);
});

clause(TABLES, "0:ability:size-up", "it cannot be used while depleted, and a depleted card can be used again once restored on my next turn", () => {
  const dep = tablesBoard({ depleted: true });
  refused(() => actRaw(dep.engine, P1, dep.id("rt"), "size-up"), "already depleted");
  assert.equal(pending(dep.engine), undefined);
  const b = tablesBoard();
  useTables(b, "size-up");
  chooseDeck(b, "mine");
  acknowledgeLook(b);
  refused(() => actRaw(b.engine, P1, b.id("rt"), "size-up"), "used twice in one turn");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("rt")), false, "restored at the start of my turn");
  useTables(b, "size-up");
  chooseDeck(b, "theirs");
  acknowledgeLook(b);
});

clause(TABLES, "0:ability:size-up", "only its controller can use it", () => {
  const b = tablesBoard({ extra: [...res({ deception: 3 }, P2)] });
  declareAttackOpenWindow(b.engine, P1, [b.id("ally")]);
  refused(() => actRaw(b.engine, P2, b.id("rt"), "size-up"), "the opponent using my Rigged Tables", /control|own|cannot|illegal|only|usable|available/i);
  assert.equal(isDepleted(b.engine, b.id("rt")), false);
});

clause(TABLES, "1:ability:rig", "pays exactly 1 resource and does not deplete the card", () => {
  const b = tablesBoard();
  const before = ready(b.engine);
  useTables(b, "rig");
  chooseDeck(b, "mine");
  assert.equal(before - ready(b.engine), 1);
  assert.equal(isDepleted(b.engine, b.id("rt")), false, "RIG has no deplete cost");
});

clause(TABLES, "1:ability:rig", "puts the top card of MY deck on the bottom; the rest keep their order and the opponent's deck is untouched", () => {
  const b = tablesBoard();
  const mine = deckOf(b.engine, P1);
  const theirs = deckOf(b.engine, P2);
  useTables(b, "rig");
  chooseDeck(b, "mine");
  assert.deepEqual(deckOf(b.engine, P1), [mine[1], mine[2], mine[0]]);
  assert.deepEqual(deckOf(b.engine, P2), theirs);
  assert.equal(zoneOf(b.engine, mine[0]), "deck", "still in the deck");
});

clause(TABLES, "1:ability:rig", "puts the top card of the OPPONENT's deck on the bottom; my deck is untouched", () => {
  const b = tablesBoard();
  const mine = deckOf(b.engine, P1);
  const theirs = deckOf(b.engine, P2);
  useTables(b, "rig");
  chooseDeck(b, "theirs");
  assert.deepEqual(deckOf(b.engine, P2), [theirs[1], theirs[2], theirs[0]]);
  assert.deepEqual(deckOf(b.engine, P1), mine);
  assert.equal(zoneOf(b.engine, theirs[0]), "deck");
  assert.equal(handOf(b.engine, P2).length, 0);
});

clause(TABLES, "1:ability:rig", "I choose the deck (the prompt is mine even for their deck), and the choice has exactly two options", () => {
  const b = tablesBoard();
  useTables(b, "rig");
  const pc = expectPending(b.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  assert.equal((pc.options as unknown[]).length, 2);
});

clause(TABLES, "1:ability:rig", "it is refused with no resource to pay, and works with exactly one", () => {
  const none = tablesBoard({ icons: {} });
  refused(() => actRaw(none.engine, P1, none.id("rt"), "rig"), "no resource to pay with");
  const one = tablesBoard({ icons: { rage: 1 } });
  useTables(one, "rig");
  chooseDeck(one, "mine");
  assert.equal(ready(one.engine), 0, "any resource pays (no threshold on the ability)");
});

clause(TABLES, "1:ability:rig", "it can be used repeatedly, each use costing 1: two RIGs on my deck rotate two cards", () => {
  const b = tablesBoard();
  const mine = deckOf(b.engine, P1);
  useTables(b, "rig");
  chooseDeck(b, "mine");
  useTables(b, "rig");
  chooseDeck(b, "mine");
  assert.deepEqual(deckOf(b.engine, P1), [mine[2], mine[0], mine[1]]);
  assert.equal(ready(b.engine), 1, "3 - 2");
});

clause(TABLES, "1:ability:rig", "it still works while the card is depleted (RIG has no deplete cost)", () => {
  const b = tablesBoard({ depleted: true });
  const theirs = deckOf(b.engine, P2);
  useTables(b, "rig");
  chooseDeck(b, "theirs");
  assert.deepEqual(deckOf(b.engine, P2), [theirs[1], theirs[2], theirs[0]]);
});

clause(TABLES, "1:ability:rig", "with a one-card deck the card stays, and with an empty deck nothing happens and nothing breaks", () => {
  const one = tablesBoard({ myDeck: 1 });
  const only = deckOf(one.engine, P1);
  useTables(one, "rig");
  chooseDeck(one, "mine");
  assert.deepEqual(deckOf(one.engine, P1), only);
  const none = tablesBoard({ oppDeck: 0 });
  useTables(none, "rig");
  chooseDeck(none, "theirs");
  drain(none.engine, declineAll);
  assert.equal(pending(none.engine), undefined);
  assert.equal(none.engine.state.winner, undefined);
});

clause(TABLES, "1:ability:rig", "only its controller can use it", () => {
  const b = tablesBoard({ extra: [...res({ deception: 3 }, P2)] });
  declareAttackOpenWindow(b.engine, P1, [b.id("ally")]);
  refused(() => actRaw(b.engine, P2, b.id("rt"), "rig"), "the opponent using my Rigged Tables", /control|own|cannot|illegal|only|usable|available/i);
});

clause(TABLES, "2:ability:walk-away", "pays 1 and destroys this card as costs, before the opponent can respond; the draw waits for resolution", () => {
  const b = tablesBoard();
  const top = deckOf(b.engine, P1)[0];
  const before = ready(b.engine);
  actRaw(b.engine, P1, b.id("rt"), "walk-away");
  assert.equal(before - ready(b.engine), 1, "1 paid");
  assert.equal(zoneOf(b.engine, b.id("rt")), "discard", "destroyed as a cost");
  assert.equal(zoneOf(b.engine, top), "deck", "nothing drawn yet: the effect has not resolved");
  assert.ok(b.engine.state.responseWindow, "the opponent can respond");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, top), "hand", "I draw when it resolves, although the card is already gone");
});

clause(TABLES, "2:ability:walk-away", "draws exactly one card, from my deck; the opponent draws nothing", () => {
  const b = tablesBoard();
  const top = deckOf(b.engine, P1)[0];
  const oppDeck = deckOf(b.engine, P2);
  activate(b.engine, P1, b.id("rt"), "walk-away");
  assert.equal(zoneOf(b.engine, top), "hand");
  assert.equal(deckOf(b.engine, P1).length, 2);
  assert.equal(handOf(b.engine, P1).length, 1);
  assert.equal(handOf(b.engine, P2).length, 0);
  assert.deepEqual(deckOf(b.engine, P2), oppDeck);
  assert.equal(pending(b.engine), undefined, "no deck prompt: it does not touch the opponent's deck");
});

clause(TABLES, "2:ability:walk-away", "the destroyed Rigged Tables goes to its owner's discard pile", () => {
  const b = tablesBoard();
  activate(b.engine, P1, b.id("rt"), "walk-away");
  assert.ok(discardOf(b.engine, P1).includes(b.id("rt")), "discardOf(b.engine, P1).includes(b.id(\"rt\"))");
});

clause(TABLES, "2:ability:walk-away", "it is refused with no resource to pay, and then the card is NOT destroyed", () => {
  const b = tablesBoard({ icons: {} });
  refused(() => actRaw(b.engine, P1, b.id("rt"), "walk-away"), "no resource to pay with");
  assert.equal(zoneOf(b.engine, b.id("rt")), "play", "not destroyed");
  assert.equal(deckOf(b.engine, P1).length, 3);
});

clause(TABLES, "2:ability:walk-away", "it works while the card is depleted (no deplete cost)", () => {
  const b = tablesBoard({ depleted: true });
  const top = deckOf(b.engine, P1)[0];
  activate(b.engine, P1, b.id("rt"), "walk-away");
  assert.equal(zoneOf(b.engine, b.id("rt")), "discard");
  assert.equal(zoneOf(b.engine, top), "hand");
});

clause(TABLES, "2:ability:walk-away", "with an empty deck the card is still destroyed and nothing is drawn (not a loss)", () => {
  const b = tablesBoard({ myDeck: 0 });
  activate(b.engine, P1, b.id("rt"), "walk-away");
  assert.equal(zoneOf(b.engine, b.id("rt")), "discard");
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.equal(b.engine.state.winner, undefined);
});

clause(TABLES, "2:ability:walk-away", "only its controller can use it", () => {
  const b = tablesBoard({ extra: [...res({ deception: 3 }, P2)] });
  declareAttackOpenWindow(b.engine, P1, [b.id("ally")]);
  refused(() => actRaw(b.engine, P2, b.id("rt"), "walk-away"), "the opponent using my Rigged Tables", /control|own|cannot|illegal|only|usable|available/i);
  assert.equal(zoneOf(b.engine, b.id("rt")), "play");
});

// --- Roulette Wheel of DOOM! ---------------------------------------------------
// Reveal the top card of your deck. You may pick a character with X life or less,
// where X is the numeric cost of the revealed card. If you do, destroy that
// character. Otherwise, draw 2 cards. Tactic, cost 3, [D].

const ROULETTE = "88812b6d-a80c-4271-88e0-d3bf47a8aeaf";

/** My deck: the revealed card first (type and numeric cost as given), then `rest` plain cards. */
function rouletteBoard(opts: { topCost?: number; topType?: DeckType; rest?: number; icons?: Icons; extra?: CardPlacement[]; noTop?: boolean } = {}) {
  const topType = opts.topType ?? "character";
  return devBoard([
    { key: "rw", def: printing(ROULETTE), owner: P1, zone: "hand" },
    ...(opts.noTop ? [] : [{ key: "top", def: { ...defOfType(topType, "Top"), cost: opts.topCost ?? 3 }, owner: P1, zone: "deck" as const }]),
    ...deckCards("a", opts.rest ?? 4, P1),
    { key: "life2", def: character({ name: "Life2", strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" },
    { key: "life3", def: character({ name: "Life3", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
    { key: "life4", def: character({ name: "Life4", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
    { key: "life6", def: character({ name: "Life6", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
    ...deckCards("b", 3, P2),
    ...res(opts.icons ?? { deception: 4 }),
    ...(opts.extra ?? [])
  ]);
}

/** Plays Roulette Wheel and drains responses, leaving the "may pick" prompt (if any) open. */
function rouletteStart(b: ReturnType<typeof rouletteBoard>): void {
  play(b.engine, P1, b.id("rw"), {});
}

clause(ROULETTE, "0:rule", "deploys for its printed cost of 3 with [D], and is refused without the threshold", () => {
  headerChecks((icons) => rouletteBoard({ icons }), "rw", { icon: "deception", threshold: 1, cost: 3, lands: "discard" });
});

clause(ROULETTE, "0:rule", "it reveals the top card of MY deck (a reveal event names exactly that card) and leaves it on top while I decide", () => {
  const b = rouletteBoard();
  const top = deckOf(b.engine, P1)[0];
  const oppDeck = deckOf(b.engine, P2);
  const before = revealEvents(b.engine).length;
  rouletteStart(b);
  const events = revealEvents(b.engine).slice(before);
  assert.ok(events.length >= 1, "a reveal happened");
  const event = events[0].event as unknown as { cardIds: string[]; ownerId?: string };
  assert.deepEqual(event.cardIds, [top]);
  assert.equal(event.ownerId, P1, "from my deck");
  assert.equal(zoneOf(b.engine, top), "deck", "revealing does not move the card");
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "the opponent's deck is untouched");
  const pc = expectPending(b.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I decide whether to pick a character");
});

clause(ROULETTE, "0:rule", "pays exactly 3 resources", () => {
  const b = rouletteBoard({ icons: { deception: 6 } });
  const before = ready(b.engine);
  rouletteStart(b);
  pickCards(b.engine, P1, [b.id("life2")]);
  assert.equal(before - ready(b.engine), 3);
});

clause(ROULETTE, "0:rule", "X is the numeric cost of the revealed card: with a cost-3 card, characters with life 2 and 3 can be picked, but not life 4 or 6", () => {
  const ok = (key: string) => {
    const b = rouletteBoard({ topCost: 3 });
    rouletteStart(b);
    pickCards(b.engine, P1, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was destroyed`);
  };
  ok("life2");
  ok("life3");
  for (const key of ["life4", "life6"]) {
    const b = rouletteBoard({ topCost: 3 });
    rouletteStart(b);
    refused(tryPick(b.engine, P1, [b.id(key)]), `${key} has more than 3 life`);
    assert.equal(zoneOf(b.engine, b.id(key)), "play");
    assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
    pickCards(b.engine, P1, [b.id("life3")]);
    assert.equal(zoneOf(b.engine, b.id("life3")), "discard", "control: a legal pick works");
  }
});

clause(ROULETTE, "0:rule", "X follows the revealed card: cost 4 admits life 4 (and 2, 3) but not life 6; cost 6 admits all four", () => {
  const four = rouletteBoard({ topCost: 4 });
  rouletteStart(four);
  refused(tryPick(four.engine, P1, [four.id("life6")]), "life 6 with X = 4");
  pickCards(four.engine, P1, [four.id("life4")]);
  assert.equal(zoneOf(four.engine, four.id("life4")), "discard", "life 4 with X = 4: 'or less' includes equal");
  const six = rouletteBoard({ topCost: 6 });
  rouletteStart(six);
  pickCards(six.engine, P1, [six.id("life6")]);
  assert.equal(zoneOf(six.engine, six.id("life6")), "discard");
});

clause(ROULETTE, "0:rule", "the numeric cost counts for a card of any type: a tactic, an item, a location and a resource on top each set X to their cost", () => {
  for (const [type, cost] of [["tactic", 2], ["item", 3], ["location", 4], ["resource", 2]] as const) {
    const b = rouletteBoard({ topType: type, topCost: cost });
    rouletteStart(b);
    refused(tryPick(b.engine, P1, [b.id("life6")]), `life 6 with X = ${cost} (${type})`);
    const pick = cost >= 4 ? "life4" : "life3";
    if (cost >= 3) {
      pickCards(b.engine, P1, [b.id(pick)]);
      assert.equal(zoneOf(b.engine, b.id(pick)), "discard", `${type} of cost ${cost}: life ${pick.slice(-1)} is legal`);
    } else {
      refused(tryPick(b.engine, P1, [b.id("life3")]), `life 3 with X = ${cost} (${type})`);
      pickCards(b.engine, P1, [b.id("life2")]);
      assert.equal(zoneOf(b.engine, b.id("life2")), "discard", `${type} of cost ${cost}: life 2 is legal`);
    }
  }
});

clause(ROULETTE, "0:rule", "if I pick a character, it is destroyed (into its owner's discard pile) and I do NOT draw", () => {
  const b = rouletteBoard({ topCost: 3 });
  const handBefore = handOf(b.engine, P1).length;
  const deckBefore = deckOf(b.engine, P1).length;
  rouletteStart(b);
  pickCards(b.engine, P1, [b.id("life3")]);
  assert.equal(zoneOf(b.engine, b.id("life3")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("life3")), "the opponent's character goes to the opponent's discard pile");
  assert.equal(handOf(b.engine, P1).length, handBefore - 1, "only the tactic left my hand: no cards drawn");
  assert.equal(deckOf(b.engine, P1).length, deckBefore, "my deck is untouched");
  assert.equal(zoneOf(b.engine, b.id("rw")), "discard");
  assert.equal(zoneOf(b.engine, b.id("life2")), "play", "only the picked character is destroyed");
});

clause(ROULETTE, "0:rule", "my own character may be picked too", () => {
  const b = rouletteBoard({ topCost: 3 });
  rouletteStart(b);
  pickCards(b.engine, P1, [b.id("life2")]);
  assert.ok(discardOf(b.engine, P1).includes(b.id("life2")), "discardOf(b.engine, P1).includes(b.id(\"life2\"))");
  assert.equal(handOf(b.engine, P1).length, 0, "no draw");
});

clause(ROULETTE, "0:rule", "'you MAY pick': declining the pick destroys nothing and draws exactly 2 cards, the first being the revealed card", () => {
  const b = rouletteBoard({ topCost: 3 });
  const [first, second, third] = deckOf(b.engine, P1);
  rouletteStart(b);
  pickCards(b.engine, P1, []);
  assert.equal(pending(b.engine), undefined);
  for (const key of ["life2", "life3", "life4", "life6"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} survives`);
  assert.equal(zoneOf(b.engine, first), "hand", "the revealed card is the first card drawn");
  assert.equal(zoneOf(b.engine, second), "hand");
  assert.equal(zoneOf(b.engine, third), "deck", "exactly 2 cards, not 3");
  assert.equal(handOf(b.engine, P1).length, 2);
  assert.equal(zoneOf(b.engine, b.id("rw")), "discard");
});

clause(ROULETTE, "0:rule", "'Otherwise': when no character has X life or less there is nothing to pick, so I draw 2 cards", () => {
  const b = devBoard([
    { key: "rw", def: printing(ROULETTE), owner: P1, zone: "hand" },
    { key: "top", def: { ...character({ name: "Top" }), cost: 1 }, owner: P1, zone: "deck" },
    ...deckCards("a", 4, P1),
    { key: "big", def: character({ name: "Big", life: 5 }), owner: P2, zone: "play" },
    ...res({ deception: 4 })
  ]);
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("rw"), {});
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("big")), "play");
  assert.equal(zoneOf(b.engine, top), "hand", "the revealed card is drawn");
  assert.equal(handOf(b.engine, P1).length, 2, "two cards drawn");
  assert.equal(pending(b.engine), undefined);
});

clause(ROULETTE, "0:rule", "'Otherwise' also applies with no characters in play at all: I draw 2 cards", () => {
  const b = devBoard([
    { key: "rw", def: printing(ROULETTE), owner: P1, zone: "hand" },
    ...deckCards("a", 4, P1),
    ...res({ deception: 4 })
  ]);
  play(b.engine, P1, b.id("rw"), {});
  drain(b.engine, declineAll);
  assert.equal(handOf(b.engine, P1).length, 2);
  assert.equal(deckOf(b.engine, P1).length, 2);
});

clause(ROULETTE, "0:rule", "a revealed card of cost 0: only a 0-life character could be picked, so otherwise I draw 2 cards", () => {
  const b = rouletteBoard({ topCost: 0 });
  rouletteStart(b);
  drain(b.engine, declineAll);
  for (const key of ["life2", "life3", "life4", "life6"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} (life above 0) survives`);
  assert.equal(handOf(b.engine, P1).length, 2, "two cards drawn");
});

clause(ROULETTE, "0:rule", "the life compared is the character's CURRENT life: a life-bonus makes it unpickable, a life-loss makes it pickable", () => {
  const boost = tactic({
    name: "Boost",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "boost",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: 3, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const sap = tactic({
    name: "Sap",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: -3, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const up = rouletteBoard({ topCost: 3, extra: [{ key: "boost", def: boost, owner: P1, zone: "hand" }] });
  play(up.engine, P1, up.id("boost"), { selected: { t: [up.id("life3")] } });
  assert.equal(up.engine.getStat(up.id("life3"), "life"), 6);
  rouletteStart(up);
  refused(tryPick(up.engine, P1, [up.id("life3")]), "life 3 + 3 = 6 is more than X = 3");
  pickCards(up.engine, P1, [up.id("life2")]);
  const down = rouletteBoard({ topCost: 3, extra: [{ key: "sap", def: sap, owner: P1, zone: "hand" }] });
  play(down.engine, P1, down.id("sap"), { selected: { t: [down.id("life6")] } });
  assert.equal(down.engine.getStat(down.id("life6"), "life"), 3);
  rouletteStart(down);
  pickCards(down.engine, P1, [down.id("life6")]);
  assert.equal(zoneOf(down.engine, down.id("life6")), "discard", "life 6 - 3 = 3 is X or less");
});

clause(ROULETTE, "0:rule", "life, not remaining life: damage on a character does not make it pickable", () => {
  const b = rouletteBoard({ topCost: 3, extra: [{ key: "hurt", def: character({ name: "Hurt", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play", damage: 4 }] });
  rouletteStart(b);
  refused(tryPick(b.engine, P1, [b.id("hurt")]), "6 life with 4 damage still has 6 life (FAQ)");
  assert.equal(zoneOf(b.engine, b.id("hurt")), "play");
  pickCards(b.engine, P1, []);
});

clause(ROULETTE, "0:rule", "only a character in play can be picked: not an item, location, faction, face-down card, or a card in hand, deck or discard pile", () => {
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place", structure: 1 }), owner: P1, zone: "play" },
    { key: "inHand", def: character({ name: "InHand", life: 1 }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard", life: 1 }), owner: P1, zone: "discard" },
    ...volition(1, P1).map((placement) => ({ ...placement, key: "downCard" }))
  ];
  const b = rouletteBoard({ topCost: 6, extra });
  rouletteStart(b);
  for (const bad of ["thing", "place", "inHand", "inDiscard", "downCard"]) refused(tryPick(b.engine, P1, [b.id(bad)]), `picking ${bad}`);
  refused(tryPick(b.engine, P1, [factionOf(b.engine, P1)]), "my faction (CR 202.9)");
  refused(tryPick(b.engine, P1, [factionOf(b.engine, P2)]), "their faction (CR 202.9)");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(b.engine, P1, [b.id("life2")]);
  assert.equal(zoneOf(b.engine, b.id("life2")), "discard", "control: a character is accepted");
});

clause(ROULETTE, "0:rule", "at most one character is picked: two are refused", () => {
  const b = rouletteBoard({ topCost: 6 });
  rouletteStart(b);
  refused(tryPick(b.engine, P1, [b.id("life2"), b.id("life3")]), "two picks");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(zoneOf(b.engine, b.id("life2")), "play");
  assert.equal(zoneOf(b.engine, b.id("life3")), "play");
});

clause(ROULETTE, "0:rule", "when I decline and the deck has only one card, I draw that one card (and the game goes on)", () => {
  const b = rouletteBoard({ topCost: 3, rest: 0 });
  rouletteStart(b);
  pickCards(b.engine, P1, []);
  assert.equal(handOf(b.engine, P1).length, 1);
  assert.equal(deckOf(b.engine, P1).length, 0);
  assert.equal(b.engine.state.winner, undefined);
});

clause(ROULETTE, "0:rule", "with an empty deck nothing can be revealed: the tactic still resolves without error", () => {
  const b = rouletteBoard({ noTop: true, rest: 0 });
  rouletteStart(b);
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("rw")), "discard");
  assert.equal(b.engine.state.winner, undefined);
});

// --- Rumply Ruse -------------------------------------------------------------
// COST: Play this only during a battle. -- EFFECT: This turn, all characters in
// your party gain 1 speed. -- FLIP UP: 4 [D][D]. Tactic, cost 3, [D][D].

const RUSE = "84772c38-fc39-4659-95ed-956ad8e7d7d7";

interface RuseOpts {
  icons?: Icons;
  zone?: "hand" | "play";
  faceDown?: boolean;
  /** Declare my attack (a1, a2) and stay in the declaration response window. */
  attack?: boolean;
  oppIcons?: Icons;
  volition?: number;
  extra?: CardPlacement[];
}

/** P1 (active, turn 2) has a1/a2/idle and the Ruse; P2 has b1/b2. */
function ruseBoard(o: RuseOpts = {}) {
  const zone = o.zone ?? "hand";
  const g = devBoard(
    [
      { key: "card", def: printing(RUSE), owner: P1, zone, faceDown: zone === "play" ? o.faceDown ?? true : undefined },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...deckCards("dk", 3, P1),
      ...res(o.icons ?? { deception: 6 }),
      ...res(o.oppIcons ?? {}, P2),
      ...volition(o.volition ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
  if (o.attack) g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("a1"), g.id("a2")], target: { type: "faction", playerId: P2 } });
  return g;
}

/** P2 (active, turn 2) attacks with atk1/atk2; I (P1) have the Ruse and the blockers k1/k2 plus an idle character. */
function ruseDefBoard(icons: Icons = { deception: 6 }) {
  return devBoard(
    [
      { key: "card", def: printing(RUSE), owner: P1, zone: "hand" },
      { key: "k1", def: character({ name: "K1", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "k2", def: character({ name: "K2", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk1", def: character({ name: "Atk1", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...res(icons)
    ],
    { turn: 2, activePlayerId: P2 }
  );
}

const speedsOf = (engine: SpoilsEngine, ids: CardInstanceId[]) => ids.map((cardId) => engine.getStat(cardId, "speed"));

/** I (P1) play the Ruse as the defender once blockers are declared, in the battle-resolution window. */
function playRuseAsBlocker(g: ReturnType<typeof ruseDefBoard>): void {
  declareAttackBy(g.engine, P2, [g.id("atk1"), g.id("atk2")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("k1"), g.id("k2")] });
  assert.ok(g.engine.state.responseWindow, "the battle-resolution window is open");
  if (g.engine.state.priorityPlayerId !== P1) g.engine.perform({ type: "passPriority", playerId: g.engine.state.priorityPlayerId });
  assert.equal(g.engine.state.priorityPlayerId, P1, "I hold priority");
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("card"), selected: {}, variables: {} } as never);
  resolvePendingResponses(g.engine);
}

clause(RUSE, "0:ability", "deploys for its printed cost of 3 with [D][D] during a battle, and is refused without the threshold", () => {
  headerChecks((icons) => ruseBoard({ icons, attack: true }), "card", { icon: "deception", threshold: 2, cost: 3, lands: "discard" });
});

clause(RUSE, "0:ability", "'Play this only during a battle': refused when there is no battle, accepted once an attack has been declared", () => {
  const none = ruseBoard();
  refused(() => playRaw(none.engine, P1, none.id("card"), {}), "no battle on my turn");
  assert.equal(zoneOf(none.engine, none.id("card")), "hand");
  assert.deepEqual(speedsOf(none.engine, [none.id("a1")]), [2], "nothing happened");
  const battle = ruseBoard({ attack: true });
  play(battle.engine, P1, battle.id("card"), {});
  assert.equal(zoneOf(battle.engine, battle.id("card")), "discard", "control: during a battle it is played");
});

clause(RUSE, "0:ability", "it is refused again after the battle is over", () => {
  const g = ruseBoard();
  fight(g.engine, P1, [g.id("a1")], FACTION_P2, []);
  assert.equal(battleOf(g.engine), undefined, "the battle has ended");
  refused(() => playRaw(g.engine, P1, g.id("card"), {}), "the battle is over");
  assert.equal(zoneOf(g.engine, g.id("card")), "hand");
});

clause(RUSE, "0:ability", "pays exactly 3 resources", () => {
  const g = ruseBoard({ attack: true, icons: { deception: 8 } });
  const before = ready(g.engine);
  play(g.engine, P1, g.id("card"), {});
  assert.equal(before - ready(g.engine), 3);
});

clause(RUSE, "0:ability", "as the attacker: every character in my attacking party gains 1 speed; my idle character and the opponent's do not", () => {
  const g = ruseBoard({ attack: true });
  play(g.engine, P1, g.id("card"), {});
  assert.deepEqual(speedsOf(g.engine, [g.id("a1"), g.id("a2")]), [3, 2], "both attackers gain +1");
  assert.equal(g.engine.getStat(g.id("idle"), "speed"), 1, "a character that is not in the party is unaffected");
  assert.deepEqual(speedsOf(g.engine, [g.id("b1"), g.id("b2")]), [3, 1], "the opponent's characters are unaffected");
});

clause(RUSE, "0:ability", "only speed changes: strength and life of the party are untouched", () => {
  const g = ruseBoard({ attack: true });
  play(g.engine, P1, g.id("card"), {});
  assert.deepEqual(stats(g.engine, g.id("a1")), { strength: 2, life: 5, speed: 3 });
  assert.deepEqual(stats(g.engine, g.id("a2")), { strength: 1, life: 5, speed: 2 });
});

clause(RUSE, "0:ability", "as the defender, once blockers are declared: my blocking party gains 1 speed; the attackers and my non-blockers do not", () => {
  const g = ruseDefBoard();
  playRuseAsBlocker(g);
  assert.deepEqual(speedsOf(g.engine, [g.id("k1"), g.id("k2")]), [3, 2], "both blockers gain +1");
  assert.equal(g.engine.getStat(g.id("idle"), "speed"), 1, "an idle character is not in the party");
  assert.deepEqual(speedsOf(g.engine, [g.id("atk1"), g.id("atk2")]), [2, 1], "the opponent's attackers are unaffected");
  assert.equal(zoneOf(g.engine, g.id("card")), "discard");
});

clause(RUSE, "0:ability", "as the defender before blockers are declared there is no blocking party yet, so nobody gains speed (and later blockers don't either)", () => {
  const g = ruseDefBoard();
  declareAttackOpenWindow(g.engine, P2, [g.id("atk1")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("card"), selected: {}, variables: {} } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("card")), "discard", "it was played and resolved");
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("k1")] });
  assert.equal(g.engine.getStat(g.id("k1"), "speed"), 2, "a blocker declared after the Ruse resolved is not in a party that existed then");
  assert.equal(g.engine.getStat(g.id("k2"), "speed"), 1);
});

clause(RUSE, "0:ability", "with no characters in my party (no blockers declared) it is still playable and gives nobody speed", () => {
  const g = ruseDefBoard();
  declareAttackBy(g.engine, P2, [g.id("atk1")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  if (g.engine.state.priorityPlayerId !== P1 && g.engine.state.responseWindow) g.engine.perform({ type: "passPriority", playerId: g.engine.state.priorityPlayerId });
  assert.ok(g.engine.state.responseWindow && g.engine.state.priorityPlayerId === P1, "I can respond in the battle");
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("card"), selected: {}, variables: {} } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("card")), "discard");
  assert.deepEqual(speedsOf(g.engine, [g.id("k1"), g.id("k2"), g.id("idle")]), [2, 1, 1], "nobody gained speed");
});

clause(RUSE, "0:ability", "'This turn': the speed gain is gone when the turn ends", () => {
  const g = ruseBoard({ attack: true });
  play(g.engine, P1, g.id("card"), {});
  assert.deepEqual(speedsOf(g.engine, [g.id("a1"), g.id("a2")]), [3, 2]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(g.engine);
  assert.equal(g.engine.getStat(g.id("a1"), "speed"), 3, "still boosted later in the same turn");
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.deepEqual(speedsOf(g.engine, [g.id("a1"), g.id("a2")]), [2, 1], "back to printed speed");
  endTurn(g.engine, P2);
  assert.deepEqual(speedsOf(g.engine, [g.id("a1"), g.id("a2")]), [2, 1], "and not boosted again next turn");
});

clause(RUSE, "0:ability", "the speed gain also ends at the end of the opponent's turn when I played it as the defender", () => {
  const g = ruseDefBoard();
  playRuseAsBlocker(g);
  autoResolveBattle(g.engine);
  assert.equal(g.engine.getStat(g.id("k1"), "speed"), 3);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.deepEqual(speedsOf(g.engine, [g.id("k1"), g.id("k2")]), [2, 1]);
});

clause(RUSE, "0:ability", "two Ruses stack: +2 speed", () => {
  const g = ruseBoard({ attack: true, icons: { deception: 8 }, extra: [{ key: "ruse2", def: printing(RUSE), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("card"), {});
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  assert.equal(g.engine.state.priorityPlayerId, P1, "the attacker acts first in the battle-resolution window");
  play(g.engine, P1, g.id("ruse2"), {});
  assert.deepEqual(speedsOf(g.engine, [g.id("a1"), g.id("a2")]), [4, 3]);
});

clause(RUSE, "0:ability", "the speed is real: a speed-2 attacker with the Ruse (speed 3) assigns damage in the same group as a speed-3 blocker", () => {
  const withRuse = ruseBoard({ attack: true });
  play(withRuse.engine, P1, withRuse.id("card"), {});
  withRuse.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [withRuse.id("b1")] });
  resolvePendingResponses(withRuse.engine);
  const view = withRuse.engine.getBattleView();
  assert.ok(view, "view");
  assert.equal(view.speed, 3, "the first speed group is 3");
  assert.equal(view.phase, "attackerDamageAssignment", "attackers assign before defenders inside a speed group");
  assert.deepEqual(
    view.damageSources.map((s) => s.cardId),
    [withRuse.id("a1")],
    "the attacker (speed 2 + 1 = 3) is in the speed-3 group together with the speed-3 blocker"
  );
  const without = ruseBoard({ attack: true });
  resolvePendingResponses(without.engine);
  without.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [without.id("b1")] });
  resolvePendingResponses(without.engine);
  const plain = without.engine.getBattleView();
  assert.ok(plain, "plain");
  assert.equal(plain.speed, 3);
  assert.deepEqual(plain.damageSources.map((s) => s.cardId), [without.id("b1")], "control: without the Ruse only the speed-3 blocker assigns in the first group");
});

clause(RUSE, "0:ability", "only its controller's party: the opponent's attacking party gains nothing when I play it as the defender", () => {
  const g = ruseDefBoard();
  playRuseAsBlocker(g);
  assert.deepEqual(speedsOf(g.engine, [g.id("atk1"), g.id("atk2")]), [2, 1]);
});

// FLIP UP: 4 [D][D]

const RUSE_FLIP: FlipSpec = {
  mk: (o) => ruseBoard({ icons: o.icons, oppIcons: o.oppIcons, volition: o.volition, zone: o.zone ?? "play", faceDown: o.faceDown, attack: true }),
  icon: "deception",
  threshold: 2,
  cost: 4
};

clause(RUSE, "1:flipUp", "flipping up pays exactly 4 (not its cost of 3), then does its text: my party gains 1 speed and the tactic goes to my discard pile", () => {
  flipPaysExactly(RUSE_FLIP);
  const g = ruseBoard({ icons: { deception: 6 }, zone: "play", attack: true });
  flipAndSettle(g, RUSE_FLIP);
  assert.deepEqual(speedsOf(g.engine, [g.id("a1"), g.id("a2")]), [3, 2], "the party gained speed");
  assert.equal(g.engine.getStat(g.id("idle"), "speed"), 1);
  assert.equal(zoneOf(g.engine, g.id("card")), "discard", "a resolved tactic goes to its owner's discard pile");
});

clause(RUSE, "1:flipUp", "the face-down Ruse may pay for its own FLIP UP: three [D] plus itself are exactly enough", () => {
  flipSelfPays(RUSE_FLIP);
});

clause(RUSE, "1:flipUp", "is refused one resource short of 4", () => {
  flipOneShort(RUSE_FLIP);
});

clause(RUSE, "1:flipUp", "needs [D][D]: one [D] and plenty of other resources is refused", () => {
  flipNeedsThreshold(RUSE_FLIP);
});

clause(RUSE, "1:flipUp", "the opponent's [D] and Volition from face-down cards do not meet the threshold", () => {
  flipIconsMustBeMineAndReal(RUSE_FLIP);
});

clause(RUSE, "1:flipUp", "FLIP UP works only on a face-down Rumply Ruse I control in play (not face-up, not in hand, not the opponent's)", () => {
  flipOnlyFaceDownInPlay(RUSE_FLIP);
});

clause(RUSE, "1:flipUp", "flipping up keeps the 'only during a battle' cost: outside a battle it is refused", () => {
  const g = ruseBoard({ icons: { deception: 6 }, zone: "play" });
  refused(() => flipRaw(g, RUSE_FLIP), "no battle");
  assert.equal(g.engine.state.cards[g.id("card")].faceDown, true, "still face-down");
  assert.equal(ready(g.engine), 7, "nothing was paid");
  const battle = ruseBoard({ icons: { deception: 6 }, zone: "play", attack: true });
  flipAndSettle(battle, RUSE_FLIP);
  assert.equal(battle.engine.state.cards[battle.id("card")].faceDown, false, "control: during a battle it flips up");
});

clause(RUSE, "1:flipUp", "FLIP UP works as the defender too: I flip it up on the opponent's attack and my blockers gain speed", () => {
  const g = devBoard(
    [
      { key: "card", def: printing(RUSE), owner: P1, zone: "play", faceDown: true },
      { key: "k1", def: character({ name: "K1", strength: 1, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk1", def: character({ name: "Atk1", strength: 1, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...res({ deception: 5 })
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(g.engine, P2, [g.id("atk1")]);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("k1")] });
  if (g.engine.state.priorityPlayerId !== P1) g.engine.perform({ type: "passPriority", playerId: g.engine.state.priorityPlayerId });
  flipRaw(g, RUSE_FLIP);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.getStat(g.id("k1"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("atk1"), "speed"), 2);
});

// --- Shadowy Mugger ----------------------------------------------------------
// COVERT -- When this card enters play, you may search your opponent's deck for a
// card. If you do, put it into their discard pile.
// Character (thief), cost 4, [D], 2 strength / 3 speed / 1 life.

const MUGGER = "8c9857e6-ba59-4e6d-9459-148426e2bb4a";

/** A small seeded random source (for shuffles). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A varied opponent deck: one card of each deck type plus fillers, keys `o0..`. */
function variedOppDeck(extraFillers = 14): CardPlacement[] {
  const types: DeckType[] = ["character", "item", "location", "tactic", "resource"];
  return [
    ...types.map((type, i): CardPlacement => ({ key: `o${i}`, def: defOfType(type, `Opp ${type}`), owner: P2, zone: "deck" })),
    ...Array.from({ length: extraFillers }, (_, i): CardPlacement => ({ key: `o${i + 5}`, def: character({ name: `OppFiller ${i}` }), owner: P2, zone: "deck" }))
  ];
}

function muggerBoard(opts: { icons?: Icons; deck?: CardPlacement[]; extra?: CardPlacement[]; random?: () => number; turn?: number; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "mug", def: printing(MUGGER), owner: P1, zone: "hand" },
      ...(opts.deck ?? variedOppDeck()),
      ...deckCards("a", 4, P1),
      ...handCards("oh", 2, P2),
      { key: "od", def: character({ name: "OppDiscard" }), owner: P2, zone: "discard" },
      ...res(opts.icons ?? { deception: 4 }),
      ...(opts.extra ?? [])
    ],
    { random: opts.random ?? lcg(11), turn: opts.turn, activePlayerId: opts.active }
  );
}

clause(MUGGER, "0:kw:COVERT", "has COVERT; an ordinary character doesn't", () => covertHasKeyword(MUGGER));
clause(MUGGER, "0:kw:COVERT", "cannot be blocked by non-covert characters (alone or beside a covert one); a covert character can block it", () => covertCannotBeBlockedByNonCovert(MUGGER));
clause(MUGGER, "0:kw:COVERT", "a party with a non-covert member is not a covert party, so anyone may block it", () => covertPartyNeedsEveryMemberCovert(MUGGER));
clause(MUGGER, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(MUGGER));

clause(MUGGER, "1:rule", "deploys for its printed cost of 4 with [D], is refused without it, and has 2 strength / 3 speed / 1 life", () => {
  headerChecks((icons) => muggerBoard({ icons }), "mug", { icon: "deception", threshold: 1, cost: 4, lands: "play" });
  const b = muggerBoard();
  play(b.engine, P1, b.id("mug"), {});
  drain(b.engine, declineAll);
  assert.deepEqual(stats(b.engine, b.id("mug")), { strength: 2, life: 1, speed: 3 });
});

clause(MUGGER, "1:rule", "when it enters play I am offered a search of my OPPONENT's deck (a 'may': nothing has happened to any card yet)", () => {
  const b = muggerBoard();
  const oppDeck = deckOf(b.engine, P2);
  play(b.engine, P1, b.id("mug"), {});
  assert.equal(zoneOf(b.engine, b.id("mug")), "play", "it is in play");
  const pc = expectPending(b.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I do the searching");
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "nothing moved yet");
});

clause(MUGGER, "1:rule", "if I search, the card I pick goes from their deck into THEIR discard pile", () => {
  const b = muggerBoard();
  const target = b.id("o3");
  play(b.engine, P1, b.id("mug"), {});
  pickCards(b.engine, P1, [target]);
  assert.equal(zoneOf(b.engine, target), "discard");
  assert.ok(discardOf(b.engine, P2).includes(target), "into the opponent's discard pile");
  assert.equal(discardOf(b.engine, P1).includes(target), false, "not mine");
  assert.equal(deckOf(b.engine, P2).includes(target), false, "no longer in their deck");
  assert.equal(deckOf(b.engine, P2).length, 18, "exactly one card left their deck");
  assert.equal(pending(b.engine), undefined);
});

clause(MUGGER, "1:rule", "I can find a card of any type: a character, item, location, tactic and resource each can be picked from the deck", () => {
  for (const key of ["o0", "o1", "o2", "o3", "o4"]) {
    const b = muggerBoard();
    play(b.engine, P1, b.id("mug"), {});
    pickCards(b.engine, P1, [b.id(key)]);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was found and discarded`);
  }
});

clause(MUGGER, "1:rule", "I can pick a card from deep in the deck, not just the top", () => {
  const b = muggerBoard();
  const bottom = deckOf(b.engine, P2).slice(-1)[0];
  play(b.engine, P1, b.id("mug"), {});
  pickCards(b.engine, P1, [bottom]);
  assert.ok(discardOf(b.engine, P2).includes(bottom), "discardOf(b.engine, P2).includes(bottom)");
});

clause(MUGGER, "1:rule", "'you may': declining the search leaves the opponent's deck, hand and discard pile exactly as they were (no shuffle)", () => {
  const b = muggerBoard();
  const deck = deckOf(b.engine, P2);
  const hand = handOf(b.engine, P2);
  const discard = discardOf(b.engine, P2);
  play(b.engine, P1, b.id("mug"), {});
  answerPending(b.engine, "chooserSelectsTarget", { selected: [], declined: true }); // "you may search": declined (Q2)
  assert.deepEqual(deckOf(b.engine, P2), deck, "same cards in the same order: nothing was searched, so nothing was shuffled");
  assert.deepEqual(handOf(b.engine, P2), hand);
  assert.deepEqual(discardOf(b.engine, P2), discard);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mug")), "play", "the Mugger stays regardless");
});

clause(MUGGER, "1:rule", "exactly one card is found: picking two is refused", () => {
  const b = muggerBoard();
  play(b.engine, P1, b.id("mug"), {});
  refused(tryPick(b.engine, P1, [b.id("o0"), b.id("o1")]), "two cards");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting");
  assert.equal(deckOf(b.engine, P2).length, 19);
  pickCards(b.engine, P1, [b.id("o0")]);
  assert.equal(deckOf(b.engine, P2).length, 18);
});

clause(MUGGER, "1:rule", "only the OPPONENT's deck is searched: cards in my own deck, either hand, or either discard pile cannot be picked", () => {
  const b = muggerBoard();
  play(b.engine, P1, b.id("mug"), {});
  refused(tryPick(b.engine, P1, [b.id("a0")]), "a card in my own deck");
  refused(tryPick(b.engine, P1, [b.id("oh0")]), "a card in their hand");
  refused(tryPick(b.engine, P1, [b.id("od")]), "a card in their discard pile");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pickCards(b.engine, P1, [b.id("o2")]);
  assert.equal(zoneOf(b.engine, b.id("o2")), "discard", "control: a card in their deck is accepted");
  assert.equal(deckOf(b.engine, P1).length, 4, "my deck is unchanged");
});

clause(MUGGER, "1:rule", "my own deck, my hand and my discard pile are not touched", () => {
  const b = muggerBoard();
  const myDeck = deckOf(b.engine, P1);
  const myDiscard = discardOf(b.engine, P1);
  play(b.engine, P1, b.id("mug"), {});
  pickCards(b.engine, P1, [b.id("o1")]);
  assert.deepEqual(deckOf(b.engine, P1), myDeck);
  assert.deepEqual(discardOf(b.engine, P1), myDiscard);
  assert.equal(handOf(b.engine, P2).length, 2);
});

clause(MUGGER, "1:rule", "a search shuffles the searched deck afterwards (CR 312.1): the remaining 18 cards are no longer in their old order", () => {
  const b = muggerBoard({ random: lcg(3) });
  const original = deckOf(b.engine, P2);
  const target = original[7];
  play(b.engine, P1, b.id("mug"), {});
  pickCards(b.engine, P1, [target]);
  const expectedIfNotShuffled = original.filter((cardId) => cardId !== target);
  const after = deckOf(b.engine, P2);
  assert.equal(after.length, 18);
  assert.deepEqual([...after].sort(), [...expectedIfNotShuffled].sort(), "the same 18 cards");
  assert.notDeepEqual(after, expectedIfNotShuffled, "reordered by a shuffle");
});

clause(MUGGER, "1:rule", "with an empty opponent deck there is nothing to find: it resolves without error", () => {
  const b = muggerBoard({ deck: [] });
  play(b.engine, P1, b.id("mug"), {});
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mug")), "play");
  assert.equal(b.engine.state.winner, undefined);
});

clause(MUGGER, "1:rule", "with a one-card opponent deck I can find that card and the deck is left empty", () => {
  const b = muggerBoard({ deck: variedOppDeck(0).slice(0, 1) });
  play(b.engine, P1, b.id("mug"), {});
  pickCards(b.engine, P1, [b.id("o0")]);
  assert.equal(deckOf(b.engine, P2).length, 0);
  assert.ok(discardOf(b.engine, P2).includes(b.id("o0")), "discardOf(b.engine, P2).includes(b.id(\"o0\"))");
  assert.equal(b.engine.state.winner, undefined);
});

clause(MUGGER, "1:rule", "it triggers when it enters play by an effect, not only when deployed (put into play from my hand by another card)", () => {
  const cheat = tactic({
    name: "Cheat It In",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "cheat",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", type: "character", name: "Shadowy Mugger" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = muggerBoard({ extra: [{ key: "cheat", def: cheat, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("cheat"), { selected: { t: [b.id("mug")] } });
  assert.equal(zoneOf(b.engine, b.id("mug")), "play");
  const pc = expectPending(b.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  pickCards(b.engine, P1, [b.id("o4")]);
  assert.ok(discardOf(b.engine, P2).includes(b.id("o4")), "discardOf(b.engine, P2).includes(b.id(\"o4\"))");
});

clause(MUGGER, "1:rule", "it triggers only for itself: another character entering play while the Mugger is in play offers no search", () => {
  const b = devBoard([
    { key: "mug", def: printing(MUGGER), owner: P1, zone: "play" },
    { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
    ...variedOppDeck(3),
    ...res({ deception: 2 })
  ]);
  play(b.engine, P1, b.id("newbie"), {});
  assert.equal(zoneOf(b.engine, b.id("newbie")), "play");
  assert.equal(pending(b.engine), undefined, "no search for another card entering");
  assert.equal(deckOf(b.engine, P2).length, 8);
});

clause(MUGGER, "1:rule", "an opponent's Mugger searches MY deck (their opponent's), and the card goes to MY discard pile", () => {
  const b = devBoard(
    [
      { key: "mugFoe", def: printing(MUGGER), owner: P2, zone: "hand" },
      ...variedOppDeck(3).map((placement) => ({ ...placement, owner: P1, key: `m${placement.key}` })),
      ...deckCards("b", 3, P2),
      ...res({ deception: 4 }, P2)
    ],
    { turn: 2, activePlayerId: P2, random: lcg(9) }
  );
  play(b.engine, P2, b.id("mugFoe"), {});
  const pc = expectPending(b.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the Mugger's controller searches");
  const mine = b.id("mo2");
  pickCards(b.engine, P2, [mine]);
  assert.ok(discardOf(b.engine, P1).includes(mine), "into my discard pile (it is the searched deck's owner's)");
  assert.equal(deckOf(b.engine, P2).length, 3, "their own deck is untouched");
});

clause(MUGGER, "1:rule", "a Mugger played face-down as a resource has no rules text: no search", () => {
  const b = devBoard([
    { key: "mug", def: printing(MUGGER), owner: P1, zone: "hand" },
    ...variedOppDeck(3)
  ]);
  developPlay(b.engine, P1, b.id("mug"), true);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("mug")].faceDown, true);
  assert.equal(pending(b.engine), undefined, "a face-down card is only a resource");
  assert.equal(deckOf(b.engine, P2).length, 8);
});

// --- Slinking Bandido --------------------------------------------------------
// COVERT -- If this card inflicts damage to a faction, put a token on this card.
// -- This card gains 1 strength for each token on it.
// Character (outlaw), cost 2, [D], 1 strength / 1 speed / 1 life.

const BANDIDO = "09e397f5-747d-48ad-9c40-e1b0b8095fe3";

const COVERT_WALL = character({ name: "Covert Wall", strength: 0, life: 9, speed: 1, behavior: { keywords: ["covert"] } });

function bandidoBoard(opts: { tokens?: number; extra?: CardPlacement[]; icons?: Icons } = {}) {
  return devBoard(
    [
      { key: "bandido", def: printing(BANDIDO), owner: P1, zone: "play", counters: opts.tokens ? { token: opts.tokens } : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "wall", def: COVERT_WALL, owner: P2, zone: "play" },
      { key: "foeLoc", def: location({ name: "Foe Place", structure: 20 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: 2 }
  );
}

clause(BANDIDO, "0:kw:COVERT", "has COVERT; an ordinary character doesn't", () => covertHasKeyword(BANDIDO));
clause(BANDIDO, "0:kw:COVERT", "cannot be blocked by non-covert characters (alone or beside a covert one); a covert character can block it", () => covertCannotBeBlockedByNonCovert(BANDIDO));
clause(BANDIDO, "0:kw:COVERT", "a party with a non-covert member is not a covert party, so anyone may block it", () => covertPartyNeedsEveryMemberCovert(BANDIDO));
clause(BANDIDO, "0:kw:COVERT", "as a blocker it can block only covert parties", () => covertBlocksOnlyCovertParties(BANDIDO));

clause(BANDIDO, "1:rule", "deploys for its printed cost of 2 with [D], is refused without it, and has 1 strength / 1 speed / 1 life", () => {
  headerChecks((icons) => devBoard([{ key: "bandido", def: printing(BANDIDO), owner: P1, zone: "hand" }, ...res(icons)]), "bandido", { icon: "deception", threshold: 1, cost: 2, lands: "play" });
  const b = bandidoBoard();
  assert.deepEqual(stats(b.engine, b.id("bandido")), { strength: 1, life: 1, speed: 1 });
});

clause(BANDIDO, "1:rule", "unblocked, its battle damage to the opponent's faction puts exactly one token on it", () => {
  const b = bandidoBoard();
  fight(b.engine, P1, [b.id("bandido")], FACTION_P2, []);
  assert.equal(influenceOf(b.engine, P2), 29, "1 damage to the faction");
  assert.equal(tokensOn(b.engine, b.id("bandido")), 1);
});

clause(BANDIDO, "1:rule", "one token per time it inflicts damage, not one per point: a 3-damage hit still adds a single token", () => {
  const b = bandidoBoard({ tokens: 2 });
  assert.equal(b.engine.getStat(b.id("bandido"), "strength"), 3);
  fight(b.engine, P1, [b.id("bandido")], FACTION_P2, []);
  assert.equal(influenceOf(b.engine, P2), 27, "3 damage to the faction");
  assert.equal(tokensOn(b.engine, b.id("bandido")), 3, "2 + 1, not 2 + 3");
});

clause(BANDIDO, "1:rule", "it feeds on every hit: two separate attacks on two turns put two tokens", () => {
  const b = bandidoBoard();
  fight(b.engine, P1, [b.id("bandido")], FACTION_P2, []);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  fight(b.engine, P1, [b.id("bandido")], FACTION_P2, []);
  assert.equal(tokensOn(b.engine, b.id("bandido")), 2);
  assert.equal(influenceOf(b.engine, P2), 30 - 1 - 2, "1 damage, then 2 damage (strength grew)");
});

clause(BANDIDO, "1:rule", "damage to a character does not count: blocked by a covert character, no token", () => {
  const b = bandidoBoard();
  declareAttackBy(b.engine, P1, [b.id("bandido")]);
  declareBlockers(b.engine, P2, [b.id("wall")]);
  autoResolveBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("wall")), 1, "the Bandido did damage the blocker");
  assert.equal(tokensOn(b.engine, b.id("bandido")), 0, "but not a faction");
  assert.equal(influenceOf(b.engine, P2), 30);
});

clause(BANDIDO, "1:rule", "damage to a location does not count: attacking a location puts no token", () => {
  const b = bandidoBoard();
  fight(b.engine, P1, [b.id("bandido")], { type: "card", cardId: b.id("foeLoc") }, []);
  assert.equal(damageOf(b.engine, b.id("foeLoc")), 1, "the location took the damage");
  assert.equal(tokensOn(b.engine, b.id("bandido")), 0);
});

clause(BANDIDO, "1:rule", "only damage THIS card inflicts counts: another attacker hitting the faction while the Bandido stays home gives it no token", () => {
  const b = bandidoBoard();
  fight(b.engine, P1, [b.id("ally")], FACTION_P2, []);
  assert.equal(influenceOf(b.engine, P2), 28, "the ally hit the faction");
  assert.equal(tokensOn(b.engine, b.id("bandido")), 0);
});

clause(BANDIDO, "1:rule", "in a party with another attacker, the Bandido still gets its token for its own damage to the faction", () => {
  const b = bandidoBoard();
  fight(b.engine, P1, [b.id("bandido"), b.id("ally")], FACTION_P2, []);
  assert.equal(influenceOf(b.engine, P2), 30 - 3, "1 + 2 damage");
  assert.equal(tokensOn(b.engine, b.id("bandido")), 1);
  assert.equal(tokensOn(b.engine, b.id("ally")), 0, "only the Bandido gets a token");
});

clause(BANDIDO, "1:rule", "if the damage it would inflict is reduced to 0, it inflicts none and gets no token (CR 408.1)", () => {
  const shield = item({
    name: "Faction Shield",
    behavior: { abilities: [{ id: "shield", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "faction" }, battleOnly: true, delta: -9 }] }] }
  });
  const b = bandidoBoard({ extra: [{ key: "shield", def: shield, owner: P2, zone: "play" }] });
  fight(b.engine, P1, [b.id("bandido")], FACTION_P2, []);
  assert.equal(influenceOf(b.engine, P2), 30, "the shield stopped the damage");
  assert.equal(tokensOn(b.engine, b.id("bandido")), 0, "no damage inflicted, no token");
});

clause(BANDIDO, "1:rule", "a face-down Bandido is only a resource: it has no rules text", () => {
  const b = devBoard([{ key: "bandido", def: printing(BANDIDO), owner: P1, zone: "play", faceDown: true }, ...res({ deception: 1 })], { turn: 2 });
  assert.equal(b.engine.state.cards[b.id("bandido")].faceDown, true);
  assert.equal(tokensOn(b.engine, b.id("bandido")), 0);
});

clause(BANDIDO, "2:rule", "gains exactly 1 strength per token: 0, 1, 2, 3 and 5 tokens give strength 1, 2, 3, 4 and 6", () => {
  for (const [tokens, strength] of [[0, 1], [1, 2], [2, 3], [3, 4], [5, 6]] as const) {
    const b = bandidoBoard({ tokens });
    assert.equal(b.engine.getStat(b.id("bandido"), "strength"), strength, `${tokens} tokens`);
  }
});

clause(BANDIDO, "2:rule", "only strength changes: life and speed stay 1 and 1", () => {
  const b = bandidoBoard({ tokens: 4 });
  assert.deepEqual(stats(b.engine, b.id("bandido")), { strength: 5, life: 1, speed: 1 });
});

clause(BANDIDO, "2:rule", "only its OWN tokens count: tokens on another card add nothing", () => {
  const b = bandidoBoard({ extra: [{ key: "tokenHolder", def: character({ name: "Holder" }), owner: P1, zone: "play", counters: { token: 4 } }] });
  assert.equal(b.engine.getStat(b.id("bandido"), "strength"), 1);
});

clause(BANDIDO, "2:rule", "the extra strength is real: with 2 tokens it deals 3 battle damage", () => {
  const b = bandidoBoard({ tokens: 2 });
  fight(b.engine, P1, [b.id("bandido")], FACTION_P2, []);
  assert.equal(influenceOf(b.engine, P2), 27);
});

clause(BANDIDO, "2:rule", "tokens do not expire at the end of the turn: the strength bonus is still there on later turns", () => {
  const b = bandidoBoard({ tokens: 2 });
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("bandido"), "strength"), 3);
  assert.equal(tokensOn(b.engine, b.id("bandido")), 2);
});

clause(BANDIDO, "2:rule", "a Bandido that leaves play and comes back has no tokens, so it is back to 1 strength (CR 409.2)", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const b = bandidoBoard({ tokens: 3, icons: { deception: 4 }, extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }] });
  assert.equal(b.engine.getStat(b.id("bandido"), "strength"), 4);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("bandido")] } });
  assert.equal(zoneOf(b.engine, b.id("bandido")), "hand");
  play(b.engine, P1, b.id("bandido"), {});
  assert.equal(zoneOf(b.engine, b.id("bandido")), "play");
  assert.equal(tokensOn(b.engine, b.id("bandido")), 0, "its tokens disappeared when it left play");
  assert.equal(b.engine.getStat(b.id("bandido"), "strength"), 1);
});

// --- Sly Bilker --------------------------------------------------------------
// SIZE UP -- COST: Pay 1. -- EFFECT: Look at the top card of either deck.
// Character (gambler), cost 5, [D][D], 3 strength / 4 speed / 3 life.

const BILKER = "36815079-5262-4a87-b922-cd06177f6ba5";

function bilkerBoard(opts: { icons?: Icons; myDeck?: number; oppDeck?: number; depleted?: boolean; extra?: CardPlacement[] } = {}) {
  return devBoard(
    [
      { key: "bilker", def: printing(BILKER), owner: P1, zone: "play", depleted: opts.depleted },
      { key: "ally", def: character({ name: "Ally" }), owner: P1, zone: "play" },
      ...deckCards("a", opts.myDeck ?? 3, P1),
      ...deckCards("b", opts.oppDeck ?? 3, P2),
      ...res(opts.icons ?? { deception: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: 2 }
  );
}

const sizeUp = (b: ReturnType<typeof bilkerBoard>): void => {
  actRaw(b.engine, P1, b.id("bilker"), "size-up");
  resolvePendingResponses(b.engine);
};

clause(BILKER, "0:ability:size-up", "deploys for its printed cost of 5 with [D][D], is refused without the threshold, and has 3 strength / 4 speed / 3 life", () => {
  headerChecks((icons) => devBoard([{ key: "bilker", def: printing(BILKER), owner: P1, zone: "hand" }, ...res(icons)]), "bilker", { icon: "deception", threshold: 2, cost: 5, lands: "play" });
  const b = bilkerBoard();
  assert.deepEqual(stats(b.engine, b.id("bilker")), { strength: 3, life: 3, speed: 4 });
});

clause(BILKER, "0:ability:size-up", "pays exactly 1 resource and does not deplete the Bilker", () => {
  const b = bilkerBoard();
  const before = ready(b.engine);
  actRaw(b.engine, P1, b.id("bilker"), "size-up");
  assert.equal(before - ready(b.engine), 1, "1 paid as a cost");
  assert.equal(isDepleted(b.engine, b.id("bilker")), false, "SIZE UP has no deplete cost");
  resolvePendingResponses(b.engine);
  chooseDeck(b, "mine");
  acknowledgeLook(b);
  assert.equal(before - ready(b.engine), 1, "and nothing more");
});

clause(BILKER, "0:ability:size-up", "I look at the top card of MY deck: the prompt shows exactly that card, to me", () => {
  const b = bilkerBoard();
  const top = deckOf(b.engine, P1)[0];
  sizeUp(b);
  chooseDeck(b, "mine");
  const pc = expectPending(b.engine, "reorderDeck");
  assert.equal(pc.playerId, P1);
  assert.deepEqual(pc.cardIds, [top]);
  acknowledgeLook(b);
  assert.equal(pending(b.engine), undefined);
});

clause(BILKER, "0:ability:size-up", "I look at the top card of the OPPONENT's deck: the prompt shows their top card, to me (not to the deck's owner)", () => {
  const b = bilkerBoard();
  const top = deckOf(b.engine, P2)[0];
  sizeUp(b);
  chooseDeck(b, "theirs");
  const pc = expectPending(b.engine, "reorderDeck");
  assert.equal(pc.playerId, P1, "I look, not the deck's owner");
  assert.deepEqual(pc.cardIds, [top]);
  acknowledgeLook(b);
  assert.equal(pending(b.engine), undefined);
});

clause(BILKER, "0:ability:size-up", "looking changes nothing: both decks keep their exact order and nothing moves", () => {
  for (const which of ["mine", "theirs"] as const) {
    const b = bilkerBoard();
    const mine = deckOf(b.engine, P1);
    const theirs = deckOf(b.engine, P2);
    sizeUp(b);
    chooseDeck(b, which);
    acknowledgeLook(b);
    assert.deepEqual(deckOf(b.engine, P1), mine, `my deck after looking at ${which}`);
    assert.deepEqual(deckOf(b.engine, P2), theirs, `their deck after looking at ${which}`);
    assert.equal(handOf(b.engine, P1).length, 0);
    assert.equal(handOf(b.engine, P2).length, 0);
  }
});

clause(BILKER, "0:ability:size-up", "it can be used repeatedly (no deplete): two uses cost 2 in total", () => {
  const b = bilkerBoard();
  const before = ready(b.engine);
  sizeUp(b);
  chooseDeck(b, "mine");
  acknowledgeLook(b);
  sizeUp(b);
  chooseDeck(b, "theirs");
  acknowledgeLook(b);
  assert.equal(before - ready(b.engine), 2);
});

clause(BILKER, "0:ability:size-up", "it still works when the Bilker is depleted (it has just attacked)", () => {
  const b = bilkerBoard({ depleted: true });
  const top = deckOf(b.engine, P2)[0];
  sizeUp(b);
  chooseDeck(b, "theirs");
  const pc = expectPending(b.engine, "reorderDeck");
  assert.deepEqual(pc.cardIds, [top]);
  acknowledgeLook(b);
});

clause(BILKER, "0:ability:size-up", "it is refused with no resource to pay, and works with exactly one", () => {
  const none = bilkerBoard({ icons: {} });
  refused(() => actRaw(none.engine, P1, none.id("bilker"), "size-up"), "no resource to pay with");
  const one = bilkerBoard({ icons: { rage: 1 } });
  sizeUp(one);
  chooseDeck(one, "mine");
  acknowledgeLook(one);
  assert.equal(ready(one.engine), 0, "any resource pays (no threshold on the ability)");
});

clause(BILKER, "0:ability:size-up", "with a one-card deck or an empty deck it works and nothing breaks", () => {
  const one = bilkerBoard({ oppDeck: 1 });
  sizeUp(one);
  chooseDeck(one, "theirs");
  const pc = expectPending(one.engine, "reorderDeck");
  assert.equal((pc.cardIds as string[]).length, 1);
  acknowledgeLook(one);
  const none = bilkerBoard({ myDeck: 0 });
  sizeUp(none);
  chooseDeck(none, "mine");
  drain(none.engine, declineAll);
  assert.equal(pending(none.engine), undefined);
  assert.equal(none.engine.state.winner, undefined);
});

clause(BILKER, "0:ability:size-up", "only its controller can use it", () => {
  const b = bilkerBoard({ extra: [...res({ deception: 3 }, P2)] });
  declareAttackOpenWindow(b.engine, P1, [b.id("ally")]);
  refused(() => actRaw(b.engine, P2, b.id("bilker"), "size-up"), "the opponent using my Bilker", /control|own|cannot|illegal|only|usable|available/i);
});

// --- Strangulate -------------------------------------------------------------
// COST: Pick a character. -- EFFECT: If the character has 4 life or less, destroy
// it. -- FLIP UP: 2 [D]. Tactic, cost 4, [D].

const STRANGULATE = "d59bdac3-b649-40ac-9c65-6e325c431211";

/** Characters with life 1..7 keyed `l1..l7`: odd ones the opponent's, even ones mine (so both controllers are covered). */
function strangBoard(opts: { icons?: Icons; extra?: CardPlacement[] } = {}) {
  return devBoard([
    { key: "st", def: printing(STRANGULATE), owner: P1, zone: "hand" },
    ...[1, 2, 3, 4, 5, 6, 7].map(
      (life): CardPlacement => ({ key: `l${life}`, def: character({ name: `Life${life}`, strength: 1, life, speed: 1 }), owner: life % 2 ? P2 : P1, zone: "play" })
    ),
    ...deckCards("a", 2, P1),
    ...res(opts.icons ?? { deception: 5 }),
    ...(opts.extra ?? [])
  ]);
}

const strangle = (b: ReturnType<typeof strangBoard>, picked: string) => play(b.engine, P1, b.id("st"), { selected: { c: [b.id(picked)] } });

clause(STRANGULATE, "0:ability", "deploys for its printed cost of 4 with [D], and is refused without the threshold", () => {
  headerChecks((icons) => strangBoard({ icons }), "st", { icon: "deception", threshold: 1, cost: 4, lands: "discard", selected: (id) => ({ c: [id("l3")] }) });
});

clause(STRANGULATE, "0:ability", "pays exactly 4 resources", () => {
  const b = strangBoard({ icons: { deception: 7 } });
  const before = ready(b.engine);
  strangle(b, "l3");
  assert.equal(before - ready(b.engine), 4);
});

clause(STRANGULATE, "0:ability", "a character with 4 life or less is destroyed: life 1, 2, 3 and 4 each die (mine and the opponent's), into their owner's discard pile", () => {
  for (const life of [1, 2, 3, 4]) {
    const b = strangBoard();
    strangle(b, `l${life}`);
    assert.equal(zoneOf(b.engine, b.id(`l${life}`)), "discard", `life ${life} is destroyed`);
    const owner = life % 2 ? P2 : P1;
    assert.ok(discardOf(b.engine, owner).includes(b.id(`l${life}`)), `into ${owner}'s discard pile`);
  }
});

clause(STRANGULATE, "0:ability", "a character with MORE than 4 life is not destroyed: life 5, 6 and 7 can be picked but survive undamaged", () => {
  for (const life of [5, 6, 7]) {
    const b = strangBoard();
    strangle(b, `l${life}`);
    assert.equal(zoneOf(b.engine, b.id(`l${life}`)), "play", `life ${life} survives`);
    assert.equal(damageOf(b.engine, b.id(`l${life}`)), 0, "and takes no damage");
    assert.equal(zoneOf(b.engine, b.id("st")), "discard", "the tactic was still played and spent");
  }
});

clause(STRANGULATE, "0:ability", "only the picked character is affected: the other low-life characters survive", () => {
  const b = strangBoard();
  strangle(b, "l3");
  for (const life of [1, 2, 4, 5, 6, 7]) assert.equal(zoneOf(b.engine, b.id(`l${life}`)), "play", `life ${life} is untouched`);
});

clause(STRANGULATE, "0:ability", "the life checked is CURRENT life: +2 life makes a life-3 character safe; -2 life makes a life-6 character die", () => {
  const shift = (name: string, value: number) =>
    tactic({
      name,
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "shift",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value, duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
  const up = strangBoard({ extra: [{ key: "up", def: shift("Up", 2), owner: P1, zone: "hand" }] });
  play(up.engine, P1, up.id("up"), { selected: { t: [up.id("l3")] } });
  assert.equal(up.engine.getStat(up.id("l3"), "life"), 5);
  strangle(up, "l3");
  assert.equal(zoneOf(up.engine, up.id("l3")), "play", "life 3 + 2 = 5 survives");
  const down = strangBoard({ extra: [{ key: "down", def: shift("Down", -2), owner: P1, zone: "hand" }] });
  play(down.engine, P1, down.id("down"), { selected: { t: [down.id("l6")] } });
  assert.equal(down.engine.getStat(down.id("l6"), "life"), 4);
  strangle(down, "l6");
  assert.equal(zoneOf(down.engine, down.id("l6")), "discard", "life 6 - 2 = 4 is destroyed");
});

clause(STRANGULATE, "0:ability", "damage on the character does not lower its life (FAQ): a life-6 character with 3 damage survives", () => {
  const b = strangBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play", damage: 3 }] });
  strangle(b, "hurt");
  assert.equal(zoneOf(b.engine, b.id("hurt")), "play", "6 life, not 3");
});

clause(STRANGULATE, "0:ability", "'If the character has 4 life or less' is judged when the effect resolves: a response that raises its life above 4 saves it", () => {
  const boost = tactic({
    name: "Boost",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "boost",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: 3, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const b = strangBoard({ extra: [{ key: "boost", def: boost, owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("st"), { selected: { c: [b.id("l3")] } });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("boost"), selected: { t: [b.id("l3")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("l3"), "life"), 6);
  assert.equal(zoneOf(b.engine, b.id("l3")), "play", "6 life at resolution: not destroyed");
  assert.equal(zoneOf(b.engine, b.id("st")), "discard");
});

clause(STRANGULATE, "0:ability", "the picked character is destroyed in response: Strangulate resolves harmlessly and goes to the discard pile", () => {
  const b = strangBoard({ extra: [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("st"), { selected: { c: [b.id("l5")] } });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("l5")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("l5")), "discard");
  assert.equal(zoneOf(b.engine, b.id("st")), "discard");
  assert.equal(pending(b.engine), undefined);
});

clause(STRANGULATE, "0:ability", "only a character in play can be picked: not an item, location, faction, face-down card, or a card in hand, deck or discard pile", () => {
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "inHand", def: character({ name: "InHand", life: 1 }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard", life: 1 }), owner: P2, zone: "discard" },
    { key: "inDeck", def: character({ name: "InDeck", life: 1 }), owner: P2, zone: "deck" },
    ...volition(1, P2).map((placement) => ({ ...placement, key: "downCard" }))
  ];
  for (const bad of ["thing", "place", "inHand", "inDiscard", "inDeck", "downCard"]) {
    const b = strangBoard({ extra });
    refused(() => playRaw(b.engine, P1, b.id("st"), { selected: { c: [b.id(bad)] } }), `picking ${bad}`);
    assert.equal(zoneOf(b.engine, b.id("st")), "hand");
  }
  const b = strangBoard({ extra });
  refused(() => playRaw(b.engine, P1, b.id("st"), { selected: { c: [factionOf(b.engine, P2)] } }), "their faction (CR 202.9)");
  refused(() => playRaw(b.engine, P1, b.id("st"), { selected: { c: [factionOf(b.engine, P1)] } }), "my faction (CR 202.9)");
  playRaw(b.engine, P1, b.id("st"), { selected: { c: [b.id("l1")] } });
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(STRANGULATE, "0:ability", "exactly one character is picked: none or two are refused", () => {
  const b = strangBoard();
  refused(() => playRaw(b.engine, P1, b.id("st"), { selected: {} }), "no declaration");
  refused(() => playRaw(b.engine, P1, b.id("st"), { selected: { c: [] } }), "an empty pick");
  refused(() => playRaw(b.engine, P1, b.id("st"), { selected: { c: [b.id("l1"), b.id("l2")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("st")), "hand");
  assert.equal(zoneOf(b.engine, b.id("l1")), "play");
});

// FLIP UP: 2 [D]

const strangFlipBoard = (o: FlipBoardOpts) =>
  devBoard([
    { key: "card", def: printing(STRANGULATE), owner: P1, zone: o.zone ?? "play", faceDown: (o.zone ?? "play") === "play" ? o.faceDown ?? true : undefined },
    { key: "tgt", def: character({ name: "Target", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
    { key: "big", def: character({ name: "Big", strength: 1, life: 7, speed: 1 }), owner: P2, zone: "play" },
    ...res(o.icons ?? {}),
    ...res(o.oppIcons ?? {}, P2),
    ...volition(o.volition ?? 0, P1)
  ]);

const STRANGULATE_FLIP: FlipSpec = {
  mk: strangFlipBoard,
  icon: "deception",
  threshold: 1,
  cost: 2,
  selected: (id) => ({ c: [id("tgt")] })
};

clause(STRANGULATE, "1:flipUp", "flipping up pays exactly 2 (not its cost of 4), then does its text: the picked 3-life character is destroyed and the tactic goes to my discard pile", () => {
  flipPaysExactly(STRANGULATE_FLIP);
  const g = strangFlipBoard({ icons: { deception: 4 } });
  flipAndSettle(g, STRANGULATE_FLIP);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "discard", "destroyed");
  assert.equal(zoneOf(g.engine, g.id("big")), "play");
  assert.equal(zoneOf(g.engine, g.id("card")), "discard", "a resolved tactic goes to its owner's discard pile");
});

clause(STRANGULATE, "1:flipUp", "after a flip-up the 'more than 4 life' condition still applies: a life-7 pick survives", () => {
  const g = strangFlipBoard({ icons: { deception: 4 } });
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("card"), selected: { c: [g.id("big")] }, variables: {} });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("big")), "play");
  assert.equal(zoneOf(g.engine, g.id("card")), "discard");
});

clause(STRANGULATE, "1:flipUp", "the face-down Strangulate may pay for its own FLIP UP: one [D] plus itself are exactly enough", () => {
  flipSelfPays(STRANGULATE_FLIP);
});

clause(STRANGULATE, "1:flipUp", "FLIP UP needs [D] and 2 resources: with only the face-down card (1 resource) it is refused", () => {
  const g = strangFlipBoard({ icons: {} });
  assert.equal(ready(g.engine), 1);
  refused(() => flipRaw(g, STRANGULATE_FLIP), "one resource, and no [D]");
  assert.equal(g.engine.state.cards[g.id("card")].faceDown, true);
});

clause(STRANGULATE, "1:flipUp", "needs [D]: plenty of other resources and no [D] is refused", () => {
  flipNeedsThreshold(STRANGULATE_FLIP);
});

clause(STRANGULATE, "1:flipUp", "the opponent's [D] and Volition from face-down cards do not meet the threshold", () => {
  flipIconsMustBeMineAndReal(STRANGULATE_FLIP);
});

clause(STRANGULATE, "1:flipUp", "FLIP UP works only on a face-down Strangulate I control in play (not face-up, not in hand, not the opponent's)", () => {
  flipOnlyFaceDownInPlay(STRANGULATE_FLIP);
});

clause(STRANGULATE, "1:flipUp", "the flip-up still needs its pick ('Pick a character'): none, two or a faction is refused", () => {
  const none = strangFlipBoard({ icons: { deception: 3 } });
  refused(() => flipUpNow(none.engine, { type: "flipUp", playerId: P1, cardId: none.id("card"), selected: { c: [] }, variables: {} }), "no pick");
  assert.equal(none.engine.state.cards[none.id("card")].faceDown, true);
  assert.equal(ready(none.engine), 4, "nothing was paid");
  const two = strangFlipBoard({ icons: { deception: 3 } });
  refused(() => flipUpNow(two.engine, { type: "flipUp", playerId: P1, cardId: two.id("card"), selected: { c: [two.id("tgt"), two.id("big")] }, variables: {} }), "two picks");
  const faction = strangFlipBoard({ icons: { deception: 3 } });
  refused(() => flipUpNow(faction.engine, { type: "flipUp", playerId: P1, cardId: faction.id("card"), selected: { c: [factionOf(faction.engine, P2)] }, variables: {} }), "a faction");
});

clause(STRANGULATE, "1:flipUp", "FLIP UP does not change when a tactic can be played: I can flip it up in response to the opponent's attack", () => {
  const g = devBoard(
    [
      { key: "card", def: printing(STRANGULATE), owner: P1, zone: "play", faceDown: true },
      { key: "tgt", def: character({ name: "Attacker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...res({ deception: 3 })
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(g.engine, P2, [g.id("tgt")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  flipRaw(g, STRANGULATE_FLIP);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("tgt")), "discard", "the attacker was destroyed");
});

// --- Surprise! ---------------------------------------------------------------
// COST: Pick an attacking character your opponent controls. X is that character's
// numeric cost. -- EFFECT: Reveal cards from the top of your deck until a character
// with numeric cost X or less is revealed or no cards are left. If an appropriate
// character is revealed, put it into play under your control as a member of the
// blocking party. Shuffle all other revealed cards into your deck.
// Tactic, cost 2, [D][D][D].

const SURPRISE = "95ad5456-4279-4481-848b-933036e72684";

interface DeckSpec {
  type: DeckType;
  cost: number;
}

/** My deck, top first, keys `d0..`; names `Deck<i>`. Characters get a recognisable 2/2/2 body. */
function specDeck(specs: DeckSpec[]): CardPlacement[] {
  return specs.map(
    (spec, i): CardPlacement => ({
      key: `d${i}`,
      def: spec.type === "character" ? character({ name: `Deck${i}`, cost: spec.cost, strength: 2, life: 2, speed: 2 }) : { ...defOfType(spec.type, `Deck${i}`), cost: spec.cost },
      owner: P1,
      zone: "deck"
    })
  );
}

/** P2 (active, turn 2) will attack with atk1 (cost 3) and atk2 (cost 5); `foeIdle` stays home. I (P1) hold Surprise! and have blockers k1 / k2. */
function surpriseBoard(o: { deck?: DeckSpec[]; icons?: Icons; extra?: CardPlacement[]; random?: () => number } = {}) {
  return devBoard(
    [
      { key: "sp", def: printing(SURPRISE), owner: P1, zone: "hand" },
      { key: "k1", def: character({ name: "K1", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "k2", def: character({ name: "K2", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk1", def: character({ name: "Atk1", cost: 3, strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", cost: 5, strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "foeIdle", def: character({ name: "FoeIdle", cost: 2, strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...specDeck(o.deck ?? [{ type: "character", cost: 2 }, { type: "character", cost: 4 }, { type: "character", cost: 1 }]),
      ...deckCards("b", 3, P2),
      ...res(o.icons ?? { deception: 5 }),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: P2, random: o.random ?? lcg(21) }
  );
}

/** The opponent attacks with atk1 and atk2; the declaration window stays open with me holding priority. */
function surpriseWindow(b: ReturnType<typeof surpriseBoard>): void {
  declareAttackOpenWindow(b.engine, P2, [b.id("atk1"), b.id("atk2")]);
  assert.equal(b.engine.state.priorityPlayerId, P1, "I hold priority in the declaration window");
}

const surprisePlay = (b: ReturnType<typeof surpriseBoard>, picked = "atk1") =>
  play(b.engine, P1, b.id("sp"), { selected: { k: [b.id(picked)] } });

const nameOf = (engine: SpoilsEngine, cardId: CardInstanceId): string => engine.getDefinition(cardId).name;

clause(SURPRISE, "0:ability", "deploys for its printed cost of 2 with [D][D][D], and is refused without the threshold", () => {
  headerChecks(
    (icons) => {
      const b = surpriseBoard({ icons });
      surpriseWindow(b);
      return b;
    },
    "sp",
    { icon: "deception", threshold: 3, cost: 2, lands: "discard", selected: (id) => ({ k: [id("atk1")] }) }
  );
});

clause(SURPRISE, "0:ability", "pays exactly 2 resources", () => {
  const b = surpriseBoard({ icons: { deception: 6 } });
  surpriseWindow(b);
  const before = ready(b.engine);
  surprisePlay(b);
  assert.equal(before - ready(b.engine), 2);
});

clause(SURPRISE, "0:ability", "X is the picked attacker's numeric cost: picking the cost-3 attacker finds the first character with cost 3 or less, skipping a cost-4 character", () => {
  const b = surpriseBoard({ deck: [{ type: "character", cost: 4 }, { type: "character", cost: 3 }, { type: "character", cost: 1 }] });
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  assert.equal(zoneOf(b.engine, b.id("d0")), "deck", "the cost-4 character is not appropriate for X = 3");
  assert.equal(zoneOf(b.engine, b.id("d1")), "play", "the cost-3 character is: 'X or less' includes X");
  assert.equal(zoneOf(b.engine, b.id("d2")), "deck", "the search stopped at the first appropriate character");
});

clause(SURPRISE, "0:ability", "with the cost-5 attacker picked, X = 5 and the cost-4 character on top is the first appropriate one", () => {
  const b = surpriseBoard({ deck: [{ type: "character", cost: 4 }, { type: "character", cost: 3 }] });
  surpriseWindow(b);
  surprisePlay(b, "atk2");
  assert.equal(zoneOf(b.engine, b.id("d0")), "play");
  assert.equal(zoneOf(b.engine, b.id("d1")), "deck");
});

clause(SURPRISE, "0:ability", "a character costing more than X is not appropriate: with X = 3 and only cost-4 and cost-6 characters, nothing is put into play", () => {
  const b = surpriseBoard({ deck: [{ type: "character", cost: 4 }, { type: "character", cost: 6 }] });
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  for (const key of ["d0", "d1"]) assert.equal(zoneOf(b.engine, b.id(key)), "deck", `${key} goes back into the deck`);
  assert.equal(playOf(b.engine, P1).filter((cardId) => nameOf(b.engine, cardId).startsWith("Deck")).length, 0);
});

clause(SURPRISE, "0:ability", "only a CHARACTER qualifies: tactics, items, locations and resources of cost 0 on top are revealed and passed over", () => {
  const b = surpriseBoard({
    deck: [
      { type: "tactic", cost: 0 },
      { type: "item", cost: 0 },
      { type: "location", cost: 0 },
      { type: "resource", cost: 0 },
      { type: "character", cost: 3 }
    ]
  });
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  assert.equal(zoneOf(b.engine, b.id("d4")), "play", "the character below them is the one that is put into play");
  for (const key of ["d0", "d1", "d2", "d3"]) assert.equal(zoneOf(b.engine, b.id(key)), "deck", `${key} was revealed and went back into the deck`);
});

clause(SURPRISE, "0:ability", "the character is put into play under MY control, in my play area, and stays owned by me", () => {
  const b = surpriseBoard();
  surpriseWindow(b);
  surprisePlay(b);
  const found = b.id("d0");
  assert.equal(zoneOf(b.engine, found), "play");
  assert.equal(controllerOf(b.engine, found), P1);
  assert.ok(playOf(b.engine, P1).includes(found), "playOf(b.engine, P1).includes(found)");
  assert.equal(b.engine.state.cards[found].faceDown, false);
});

clause(SURPRISE, "0:ability", "it is a member of the blocking party: played before blockers are declared, it joins the blocking party when it forms (with a declared blocker beside it)", () => {
  const b = surpriseBoard();
  surpriseWindow(b);
  surprisePlay(b);
  const found = b.id("d0");
  declareBlockers(b.engine, P1, [b.id("k1")]);
  const party = battleOf(b.engine)?.blockingParty ?? [];
  assert.ok(party.includes(b.id("k1")), "the declared blocker");
  assert.ok(party.includes(found), "the put-into-play character is in the blocking party too");
  assert.equal(party.length, 2);
});

clause(SURPRISE, "0:ability", "played before blockers are declared with no blockers declared, the character alone becomes the blocking party", () => {
  const b = surpriseBoard();
  surpriseWindow(b);
  surprisePlay(b);
  declareBlockers(b.engine, P1, []);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("d0")]);
});

clause(SURPRISE, "0:ability", "played after blockers are declared, it joins the blocking party at once", () => {
  const b = surpriseBoard();
  declareAttackBy(b.engine, P2, [b.id("atk1"), b.id("atk2")]);
  declareBlockers(b.engine, P1, [b.id("k1")]);
  if (b.engine.state.priorityPlayerId !== P1) b.engine.perform({ type: "passPriority", playerId: b.engine.state.priorityPlayerId });
  assert.equal(b.engine.state.priorityPlayerId, P1);
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("sp"), selected: { k: [b.id("atk1")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  const party = battleOf(b.engine)?.blockingParty ?? [];
  assert.ok(party.includes(b.id("k1")), "party.includes(b.id(\"k1\"))");
  assert.ok(party.includes(b.id("d0")), "the new character is in the blocking party");
});

clause(SURPRISE, "0:ability", "the new blocker really fights: it takes part in the battle and deals its damage to the attackers", () => {
  const b = surpriseBoard();
  declareAttackBy(b.engine, P2, [b.id("atk1"), b.id("atk2")]);
  declareBlockers(b.engine, P1, []);
  if (b.engine.state.priorityPlayerId !== P1) b.engine.perform({ type: "passPriority", playerId: b.engine.state.priorityPlayerId });
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("sp"), selected: { k: [b.id("atk1")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("d0")], "the surprise blocker is the whole blocking party");
  autoResolveBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("atk1")) + damageOf(b.engine, b.id("atk2")), 2, "the 2-strength surprise blocker dealt its damage to the attackers");
  assert.equal(influenceOf(b.engine, P1), 30, "the attackers had to assign their damage to the blocker, not my faction");
  assert.equal(zoneOf(b.engine, b.id("d0")), "discard", "2 damage kills the 2-life surprise blocker");
});

clause(SURPRISE, "0:ability", "the character is put into play, so its enters-play ability fires: a Shadowy Mugger found this way offers its search", () => {
  const b = surpriseBoard({ deck: [], extra: [{ key: "mug", def: printing(MUGGER), owner: P1, zone: "deck" }] });
  surpriseWindow(b);
  play(b.engine, P1, b.id("sp"), { selected: { k: [b.id("atk2")] } });
  assert.equal(zoneOf(b.engine, b.id("mug")), "play", "the Mugger (cost 4) is appropriate for X = 5");
  const pc = expectPending(b.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search the opponent's deck");
  pickCards(b.engine, P1, [b.id("b1")]);
  assert.ok(discardOf(b.engine, P2).includes(b.id("b1")), "discardOf(b.engine, P2).includes(b.id(\"b1\"))");
});

clause(SURPRISE, "0:ability", "the cards revealed before the match are shuffled back into my deck (and the match, now in play, is not)", () => {
  const b = surpriseBoard({
    deck: [{ type: "tactic", cost: 0 }, { type: "character", cost: 9 }, { type: "item", cost: 1 }, { type: "character", cost: 2 }, { type: "character", cost: 1 }, { type: "character", cost: 7 }, { type: "location", cost: 2 }]
  });
  const before = deckOf(b.engine, P1);
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  assert.equal(zoneOf(b.engine, b.id("d3")), "play", "the first character with cost 3 or less");
  const after = deckOf(b.engine, P1);
  assert.equal(after.length, before.length - 1);
  assert.deepEqual([...after].sort(), before.filter((cardId) => cardId !== b.id("d3")).sort(), "everything else is still in the deck");
  for (const key of ["d0", "d1", "d2"]) assert.ok(after.includes(b.id(key)), `${key} (revealed, passed over) is back in the deck`);
});

clause(SURPRISE, "0:ability", "the revealed cards are actually shuffled: the deck is no longer in its old order", () => {
  const deck: DeckSpec[] = [
    { type: "tactic", cost: 0 },
    { type: "character", cost: 9 },
    { type: "item", cost: 1 },
    { type: "character", cost: 2 },
    ...Array.from({ length: 12 }, () => ({ type: "character" as const, cost: 8 }))
  ];
  const b = surpriseBoard({ deck, random: lcg(5) });
  const original = deckOf(b.engine, P1);
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  const expectedIfUnshuffled = [original[0], original[1], original[2], ...original.slice(4)];
  const after = deckOf(b.engine, P1);
  assert.deepEqual([...after].sort(), [...expectedIfUnshuffled].sort());
  assert.notDeepEqual(after, expectedIfUnshuffled, "the deck was shuffled");
});

clause(SURPRISE, "0:ability", "CR 313.2: nothing was revealed besides the match, so there is nothing to shuffle and the deck keeps its order", () => {
  const deck: DeckSpec[] = [{ type: "character", cost: 1 }, ...Array.from({ length: 14 }, (_, i) => ({ type: "character" as const, cost: 8 + i }))];
  const b = surpriseBoard({ deck, random: lcg(5) });
  const original = deckOf(b.engine, P1);
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  assert.equal(zoneOf(b.engine, b.id("d0")), "play");
  assert.deepEqual(deckOf(b.engine, P1), original.slice(1), "the rest is in the same order: no card was added, so no shuffle");
});

clause(SURPRISE, "0:ability", "when no appropriate character is found, every revealed card (the whole deck) is shuffled back and nothing enters play", () => {
  const deck: DeckSpec[] = Array.from({ length: 10 }, (_, i) => ({ type: i % 2 ? ("tactic" as const) : ("character" as const), cost: 8 }));
  const b = surpriseBoard({ deck, random: lcg(8) });
  const original = deckOf(b.engine, P1);
  const playBefore = playOf(b.engine, P1).length;
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  const after = deckOf(b.engine, P1);
  assert.deepEqual([...after].sort(), [...original].sort(), "all ten cards are back in the deck");
  assert.notDeepEqual(after, original, "...shuffled");
  assert.equal(playOf(b.engine, P1).length, playBefore, "nothing entered play");
  assert.equal(zoneOf(b.engine, b.id("sp")), "discard");
});

clause(SURPRISE, "0:ability", "with an empty deck ('or no cards are left') it resolves harmlessly", () => {
  const b = surpriseBoard({ deck: [] });
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  assert.equal(zoneOf(b.engine, b.id("sp")), "discard");
  assert.equal(pending(b.engine), undefined);
  assert.equal(b.engine.state.winner, undefined);
});

clause(SURPRISE, "0:ability", "the cards it reveals are revealed: a reveal event names the cards turned over, in order", () => {
  const b = surpriseBoard({ deck: [{ type: "tactic", cost: 0 }, { type: "character", cost: 9 }, { type: "character", cost: 2 }, { type: "character", cost: 1 }] });
  const before = revealEvents(b.engine).length;
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  const events = revealEvents(b.engine).slice(before);
  assert.ok(events.length >= 1, "something was revealed");
  const revealed = events.flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);
  assert.ok(revealed.includes(b.id("d0")) && revealed.includes(b.id("d1")) && revealed.includes(b.id("d2")), "the tactic, the expensive character and the matching character were all turned over");
  assert.equal(revealed.includes(b.id("d3")), false, "the card below the match was not revealed");
});

clause(SURPRISE, "0:ability", "the unrevealed cards below stay in my deck, and the opponent's deck is not touched", () => {
  const b = surpriseBoard();
  const oppDeck = deckOf(b.engine, P2);
  surpriseWindow(b);
  surprisePlay(b);
  assert.deepEqual(deckOf(b.engine, P2), oppDeck);
  assert.equal(deckOf(b.engine, P1).length, 2);
});

clause(SURPRISE, "0:ability", "the attacker I picked is not destroyed, depleted or removed: Surprise! only adds a blocker", () => {
  const b = surpriseBoard();
  surpriseWindow(b);
  surprisePlay(b, "atk1");
  assert.equal(zoneOf(b.engine, b.id("atk1")), "play");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("atk1"), b.id("atk2")], "both attackers are still attacking");
  assert.equal(controllerOf(b.engine, b.id("atk1")), P2);
});

clause(SURPRISE, "0:ability", "only an ATTACKING character the opponent controls can be picked: not an idle opponent character, my own character, an item, a faction, or a card in hand", () => {
  const extra: CardPlacement[] = [
    { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
    { key: "foeHand", def: character({ name: "FoeHand" }), owner: P2, zone: "hand" },
    ...volition(1, P2).map((placement) => ({ ...placement, key: "foeDown" }))
  ];
  const attempt = (picked: string | CardInstanceId, byId = false) => {
    const b = surpriseBoard({ extra });
    surpriseWindow(b);
    refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { k: [byId ? (picked as string) : b.id(picked)] } }), `picking ${picked}`);
    assert.equal(zoneOf(b.engine, b.id("sp")), "hand");
  };
  for (const bad of ["foeIdle", "k1", "foeItem", "foeHand", "foeDown"]) attempt(bad);
  const b = surpriseBoard({ extra });
  surpriseWindow(b);
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { k: [factionOf(b.engine, P2)] } }), "their faction (CR 202.9)");
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { k: [factionOf(b.engine, P1)] } }), "my faction (CR 202.9)");
  playRaw(b.engine, P1, b.id("sp"), { selected: { k: [b.id("atk2")] } });
  assert.ok(b.engine.state.responseWindow, "control: an attacking opposing character is accepted");
});

clause(SURPRISE, "0:ability", "exactly one attacker is picked: none or two are refused", () => {
  const b = surpriseBoard();
  surpriseWindow(b);
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: {} }), "no declaration");
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { k: [] } }), "an empty pick");
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { k: [b.id("atk1"), b.id("atk2")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("sp")), "hand");
});

clause(SURPRISE, "0:ability", "it needs an attacking opposing character: with no battle it cannot be played", () => {
  const b = surpriseBoard();
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { k: [b.id("atk1")] } }), "no battle");
  assert.equal(zoneOf(b.engine, b.id("sp")), "hand");
});

clause(SURPRISE, "0:ability", "it cannot be played while I am the attacker: the opponent has no attacking character to pick", () => {
  const b = devBoard(
    [
      { key: "sp", def: printing(SURPRISE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 3, strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...specDeck([{ type: "character", cost: 1 }]),
      ...res({ deception: 5 })
    ],
    { turn: 2 }
  );
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("mine")], target: { type: "faction", playerId: P2 } });
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { k: [b.id("foe")] } }), "the opponent's character is not attacking");
  refused(() => playRaw(b.engine, P1, b.id("sp"), { selected: { k: [b.id("mine")] } }), "my own attacker", /cannot be deployed right now/);
  assert.equal(zoneOf(b.engine, b.id("sp")), "hand");
});

clause(SURPRISE, "0:ability", "with the cost-0 attacker picked (X = 0) only a cost-0 character qualifies", () => {
  const b = devBoard(
    [
      { key: "sp", def: printing(SURPRISE), owner: P1, zone: "hand" },
      { key: "atk0", def: character({ name: "Atk0", cost: 0, strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...specDeck([{ type: "character", cost: 1 }, { type: "character", cost: 0 }, { type: "character", cost: 0 }]),
      ...res({ deception: 5 })
    ],
    { turn: 2, activePlayerId: P2, random: lcg(2) }
  );
  declareAttackOpenWindow(b.engine, P2, [b.id("atk0")]);
  play(b.engine, P1, b.id("sp"), { selected: { k: [b.id("atk0")] } });
  assert.equal(zoneOf(b.engine, b.id("d0")), "deck", "cost 1 is more than X = 0");
  assert.equal(zoneOf(b.engine, b.id("d1")), "play", "the first cost-0 character");
  assert.equal(zoneOf(b.engine, b.id("d2")), "deck");
});

// --- Swollen Ostrich ---------------------------------------------------------
// You may play this card whenever you could play a tactic. -- When this card enters
// play, you may pick a character. If you do, it gains 1 strength and 1 life this
// turn. -- FLIP UP: 1 [D][D].
// Character (beast), cost 3, [D][D], 2 strength / 3 speed / 2 life.

const OSTRICH = "bc2f780b-859d-475b-80d2-00e8c8fd2920";

interface OstrichOpts {
  icons?: Icons;
  extra?: CardPlacement[];
  active?: PlayerId;
  turn?: number;
}

function ostrichBoard(o: OstrichOpts = {}) {
  return devBoard(
    [
      { key: "ost", def: printing(OSTRICH), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain Character", cost: 0, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "hand" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...deckCards("a", 2, P1),
      ...res(o.icons ?? { deception: 6 }),
      ...(o.extra ?? [])
    ],
    { turn: o.turn ?? 2, activePlayerId: o.active }
  );
}

/** The opponent (active) has a zap tactic and an attacker; the Ostrich is in my hand. */
function ostrichOppTurn(extra: CardPlacement[] = []) {
  return ostrichBoard({
    active: P2,
    extra: [
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "oppZap", def: zapTactic("OppZap", 1), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}

clause(OSTRICH, "0:rule", "deploys for its printed cost of 3 with [D][D] on my turn, is refused without the threshold, and has 2 strength / 3 speed / 2 life", () => {
  headerChecks((icons) => ostrichBoard({ icons }), "ost", { icon: "deception", threshold: 2, cost: 3, lands: "play" });
  const b = ostrichBoard();
  play(b.engine, P1, b.id("ost"), {});
  drain(b.engine, declineAll);
  assert.deepEqual(stats(b.engine, b.id("ost")), { strength: 2, life: 2, speed: 3 });
});

clause(OSTRICH, "0:rule", "in response to the opponent's attack I can play it from my hand; it enters play and stays in play (it is not a tactic)", () => {
  const b = ostrichOppTurn();
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.priorityPlayerId, P1);
  const before = ready(b.engine);
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("ost"), selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ost")), "play", "the Ostrich entered play");
  assert.equal(controllerOf(b.engine, b.id("ost")), P1);
  assert.equal(before - ready(b.engine), 3, "its cost of 3 was paid");
});

clause(OSTRICH, "0:rule", "in response to the opponent playing a card or using an ability I can play it", () => {
  const b = ostrichOppTurn();
  playRaw(b.engine, P2, b.id("oppZap"), { selected: { t: [b.id("ally")] } });
  assert.equal(b.engine.state.priorityPlayerId, P1, "I may respond");
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("ost"), selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ost")), "play");
  assert.equal(damageOf(b.engine, b.id("ally")), 1, "the opponent's zap still resolved afterwards");
});

clause(OSTRICH, "0:rule", "in response to the opponent announcing the end of their turn I can play it", () => {
  const b = ostrichOppTurn();
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.priorityPlayerId, P1, "I may respond to the end of the turn");
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("ost"), selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ost")), "play");
});

clause(OSTRICH, "0:rule", "in a battle's resolution response windows (after blockers) I can play it too", () => {
  const b = ostrichOppTurn();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("ally")] });
  if (b.engine.state.priorityPlayerId !== P1) b.engine.perform({ type: "passPriority", playerId: b.engine.state.priorityPlayerId });
  assert.equal(b.engine.state.priorityPlayerId, P1);
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("ost"), selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("ost")), "play");
});

clause(OSTRICH, "0:rule", "control: an ordinary character cannot be played in those windows, only the Ostrich can", () => {
  const atk = ostrichOppTurn();
  declareAttackOpenWindow(atk.engine, P2, [atk.id("atk")]);
  refused(() => playRaw(atk.engine, P1, atk.id("plain"), {}), "a plain character during the opponent's attack", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(atk.engine, atk.id("plain")), "hand");
  const eot = ostrichOppTurn();
  eot.engine.perform({ type: "endTurn", playerId: P2 });
  refused(() => playRaw(eot.engine, P1, eot.id("plain"), {}), "a plain character in response to the end of turn");
  assert.equal(zoneOf(eot.engine, eot.id("plain")), "hand");
});

clause(OSTRICH, "0:rule", "it is only 'whenever you could play a tactic': on the opponent's turn with no window open it cannot be played", () => {
  const b = ostrichOppTurn();
  refused(() => playRaw(b.engine, P1, b.id("ost"), {}), "the opponent's turn, nothing to respond to");
  assert.equal(zoneOf(b.engine, b.id("ost")), "hand");
});

clause(OSTRICH, "0:rule", "it can be played on my own turn like any character, and in a response window on my own turn", () => {
  const main = ostrichBoard();
  play(main.engine, P1, main.id("ost"), {});
  drain(main.engine, declineAll);
  assert.equal(zoneOf(main.engine, main.id("ost")), "play");
  const mine = ostrichBoard({ extra: [{ key: "atk", def: character({ name: "MyAttacker", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }] });
  mine.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [mine.id("atk")], target: { type: "faction", playerId: P2 } });
  play(mine.engine, P1, mine.id("ost"), {});
  drain(mine.engine, declineAll);
  assert.equal(zoneOf(mine.engine, mine.id("ost")), "play", "in my own attack's response window");
});

clause(OSTRICH, "0:rule", "its cost and threshold still apply in a response window: one resource short or without [D][D] is refused", () => {
  const short = ostrichOppTurn();
  const shortBoard = ostrichBoard({ active: P2, icons: { deception: 2 }, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(shortBoard.engine, P2, [shortBoard.id("atk")]);
  refused(() => playRaw(shortBoard.engine, P1, shortBoard.id("ost"), {}), "2 resources for a cost of 3");
  assert.equal(zoneOf(shortBoard.engine, shortBoard.id("ost")), "hand");
  const noThreshold = ostrichBoard({ active: P2, icons: { deception: 1, rage: 6 }, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(noThreshold.engine, P2, [noThreshold.id("atk")]);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("ost"), {}), "only one [D]");
  declareAttackOpenWindow(short.engine, P2, [short.id("atk")]);
  short.engine.perform({ type: "playCard", playerId: P1, cardId: short.id("ost"), selected: {}, variables: {} } as never);
  resolvePendingResponses(short.engine);
  drain(short.engine, declineAll);
  assert.equal(zoneOf(short.engine, short.id("ost")), "play", "control: with 6 [D] it is played");
});

// ETB: pick a character, it gains 1 strength and 1 life this turn

const ostrichEntered = (b: ReturnType<typeof ostrichBoard>): void => {
  play(b.engine, P1, b.id("ost"), {});
};

clause(OSTRICH, "1:rule", "when it enters play I am asked whether to pick a character (a 'may'): nothing has changed yet", () => {
  const b = ostrichBoard();
  ostrichEntered(b);
  assert.equal(zoneOf(b.engine, b.id("ost")), "play");
  const pc = expectPending(b.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  assert.deepEqual(stats(b.engine, b.id("ally")), { strength: 2, life: 3, speed: 1 });
});

clause(OSTRICH, "1:rule", "picking my other character gives it exactly +1 strength and +1 life (speed unchanged)", () => {
  const b = ostrichBoard();
  ostrichEntered(b);
  pickCards(b.engine, P1, [b.id("ally")]);
  assert.deepEqual(stats(b.engine, b.id("ally")), { strength: 3, life: 4, speed: 1 });
  assert.deepEqual(stats(b.engine, b.id("ost")), { strength: 2, life: 2, speed: 3 }, "the Ostrich itself is unchanged");
  assert.deepEqual(stats(b.engine, b.id("foe")), { strength: 2, life: 3, speed: 1 }, "the opponent's character is unchanged");
});

clause(OSTRICH, "1:rule", "the Ostrich may pick itself", () => {
  const b = ostrichBoard();
  ostrichEntered(b);
  pickCards(b.engine, P1, [b.id("ost")]);
  assert.deepEqual(stats(b.engine, b.id("ost")), { strength: 3, life: 3, speed: 3 });
  assert.deepEqual(stats(b.engine, b.id("ally")), { strength: 2, life: 3, speed: 1 });
});

clause(OSTRICH, "1:rule", "an opponent's character may be picked: it gets the +1/+1", () => {
  const b = ostrichBoard();
  ostrichEntered(b);
  pickCards(b.engine, P1, [b.id("foe")]);
  assert.deepEqual(stats(b.engine, b.id("foe")), { strength: 3, life: 4, speed: 1 });
  assert.deepEqual(stats(b.engine, b.id("ally")), { strength: 2, life: 3, speed: 1 });
});

clause(OSTRICH, "1:rule", "'you may': declining picks nobody and changes nothing", () => {
  const b = ostrichBoard();
  ostrichEntered(b);
  pickCards(b.engine, P1, []);
  assert.equal(pending(b.engine), undefined);
  assert.deepEqual(stats(b.engine, b.id("ally")), { strength: 2, life: 3, speed: 1 });
  assert.deepEqual(stats(b.engine, b.id("foe")), { strength: 2, life: 3, speed: 1 });
  assert.deepEqual(stats(b.engine, b.id("ost")), { strength: 2, life: 2, speed: 3 });
  assert.equal(zoneOf(b.engine, b.id("ost")), "play");
});

clause(OSTRICH, "1:rule", "only a character in play can be picked: not an item, location, faction, face-down card, or a card in hand or discard pile", () => {
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
    ...volition(1, P1).map((placement) => ({ ...placement, key: "downCard" }))
  ];
  const b = ostrichBoard({ extra });
  ostrichEntered(b);
  for (const bad of ["thing", "place", "inHand", "inDiscard", "downCard"]) refused(tryPick(b.engine, P1, [b.id(bad)]), `picking ${bad}`);
  refused(tryPick(b.engine, P1, [factionOf(b.engine, P1)]), "my faction (CR 202.9)");
  refused(tryPick(b.engine, P1, [factionOf(b.engine, P2)]), "their faction (CR 202.9)");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(b.engine, P1, [b.id("ally")]);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 3, "control: a character is accepted");
});

clause(OSTRICH, "1:rule", "at most one character is picked: two are refused", () => {
  const b = ostrichBoard();
  ostrichEntered(b);
  refused(tryPick(b.engine, P1, [b.id("ally"), b.id("foe")]), "two picks");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
});

clause(OSTRICH, "1:rule", "'This turn': the bonus is gone when the turn ends", () => {
  const b = ostrichBoard();
  ostrichEntered(b);
  pickCards(b.engine, P1, [b.id("ally")]);
  assert.deepEqual(stats(b.engine, b.id("ally")), { strength: 3, life: 4, speed: 1 });
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.deepEqual(stats(b.engine, b.id("ally")), { strength: 2, life: 3, speed: 1 }, "back to printed stats");
  endTurn(b.engine, P2);
  assert.deepEqual(stats(b.engine, b.id("ally")), { strength: 2, life: 3, speed: 1 }, "and it doesn't come back");
});

clause(OSTRICH, "1:rule", "when played on the opponent's turn the bonus lasts through that turn and ends with it", () => {
  const b = ostrichOppTurn();
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("ost"), selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  pickCards(b.engine, P1, [b.id("ally")]);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 3);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  autoResolveBattle(b.engine);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 3, "still boosted later in the opponent's turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.getStat(b.id("ally"), "strength"), 2, "gone once that turn ended");
});

clause(OSTRICH, "1:rule", "the bonus is real: +1 life lets a 3-life character survive 3 damage and +1 strength makes it deal 3 battle damage", () => {
  const zap = (n: number) => zapTactic(`Zap${n}`, n);
  const b = ostrichBoard({ extra: [{ key: "z3", def: zap(3), owner: P1, zone: "hand" }, { key: "z1", def: zap(1), owner: P1, zone: "hand" }] });
  ostrichEntered(b);
  pickCards(b.engine, P1, [b.id("ally")]);
  play(b.engine, P1, b.id("z3"), { selected: { t: [b.id("ally")] } });
  assert.equal(zoneOf(b.engine, b.id("ally")), "play", "3 damage does not kill a 4-life character");
  play(b.engine, P1, b.id("z1"), { selected: { t: [b.id("ally")] } });
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard", "the 4th damage does");
  const control = ostrichBoard({ extra: [{ key: "z3", def: zap(3), owner: P1, zone: "hand" }] });
  play(control.engine, P1, control.id("z3"), { selected: { t: [control.id("ally")] } });
  assert.equal(zoneOf(control.engine, control.id("ally")), "discard", "control: without the Ostrich, 3 damage kills it");
  const strong = ostrichBoard();
  ostrichEntered(strong);
  pickCards(strong.engine, P1, [strong.id("ally")]);
  fight(strong.engine, P1, [strong.id("ally")], FACTION_P2, []);
  assert.equal(influenceOf(strong.engine, P2), 30 - 3, "3 strength, 3 influence");
});

clause(OSTRICH, "1:rule", "it triggers only for the Ostrich itself: another character entering play while it is in play offers no pick", () => {
  const b = devBoard(
    [
      { key: "ost", def: printing(OSTRICH), owner: P1, zone: "play" },
      { key: "newbie", def: character({ name: "Newbie", cost: 1 }), owner: P1, zone: "hand" },
      ...res({ deception: 2 })
    ],
    { turn: 2 }
  );
  play(b.engine, P1, b.id("newbie"), {});
  assert.equal(zoneOf(b.engine, b.id("newbie")), "play");
  assert.equal(pending(b.engine), undefined);
});

clause(OSTRICH, "1:rule", "played face-down as a resource it has no rules text: no pick is offered", () => {
  const b = ostrichBoard();
  developPlay(b.engine, P1, b.id("ost"), true);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("ost")].faceDown, true);
  assert.equal(pending(b.engine), undefined);
});

// FLIP UP: 1 [D][D]

const ostrichFlipBoard = (o: FlipBoardOpts) =>
  devBoard(
    [
      { key: "card", def: printing(OSTRICH), owner: P1, zone: o.zone ?? "play", faceDown: (o.zone ?? "play") === "play" ? o.faceDown ?? true : undefined },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...res(o.icons ?? {}),
      ...res(o.oppIcons ?? {}, P2),
      ...volition(o.volition ?? 0, P1)
    ],
    { turn: 2 }
  );

const OSTRICH_FLIP: FlipSpec = { mk: ostrichFlipBoard, icon: "deception", threshold: 2, cost: 1 };

clause(OSTRICH, "2:flipUp", "flipping up pays exactly 1 (not its cost of 3) and puts the Ostrich into play face-up with its printed stats", () => {
  flipPaysExactly(OSTRICH_FLIP);
  const g = ostrichFlipBoard({ icons: { deception: 3 } });
  flipAndSettle(g, OSTRICH_FLIP);
  assert.equal(zoneOf(g.engine, g.id("card")), "play", "a character stays in play");
  assert.equal(g.engine.state.cards[g.id("card")].faceDown, false);
  assert.deepEqual(stats(g.engine, g.id("card")), { strength: 2, life: 2, speed: 3 });
  assert.equal(controllerOf(g.engine, g.id("card")), P1);
});

clause(OSTRICH, "2:flipUp", "a flipped-up Ostrich enters play, so its ETB fires: I may pick a character for +1/+1", () => {
  const g = ostrichFlipBoard({ icons: { deception: 3 } });
  flipRaw(g, OSTRICH_FLIP);
  resolvePendingResponses(g.engine);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  pickCards(g.engine, P1, [g.id("ally")]);
  assert.deepEqual(stats(g.engine, g.id("ally")), { strength: 3, life: 4, speed: 1 });
});

clause(OSTRICH, "2:flipUp", "needs [D][D]: one [D] and plenty of other resources is refused, two [D] is enough", () => {
  flipNeedsThreshold(OSTRICH_FLIP);
});

clause(OSTRICH, "2:flipUp", "the opponent's [D] and Volition from face-down cards do not meet the threshold", () => {
  flipIconsMustBeMineAndReal(OSTRICH_FLIP);
});

clause(OSTRICH, "2:flipUp", "FLIP UP works only on a face-down Ostrich I control in play (not face-up, not in hand, not the opponent's)", () => {
  flipOnlyFaceDownInPlay(OSTRICH_FLIP);
});

clause(OSTRICH, "2:flipUp", "with the threshold met but no resource beyond the face-down card, it is the face-down card itself that pays the 1", () => {
  const g = ostrichFlipBoard({ icons: { deception: 2 } });
  assert.equal(ready(g.engine), 3, "two [D] and the face-down card itself");
  flipAndSettle(g, OSTRICH_FLIP);
  assert.equal(g.engine.state.cards[g.id("card")].faceDown, false);
  assert.equal(ready(g.engine), 1, "3 - 1 paid - 1 (the face-down card is no longer a resource)");
});

clause(OSTRICH, "2:flipUp", "FLIP UP does not stop the 'whenever you could play a tactic' rule: I can flip it up in response to the opponent's attack", () => {
  const g = devBoard(
    [
      { key: "card", def: printing(OSTRICH), owner: P1, zone: "play", faceDown: true },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" },
      ...res({ deception: 3 })
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  flipRaw(g, OSTRICH_FLIP);
  resolvePendingResponses(g.engine);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.cards[g.id("card")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("card")), "play");
});

// --- Titillating Contortionist -----------------------------------------------
// If this card attacks, you may pick a character. If you do, it must block this
// card if it can this turn.
// Character (performer), cost 4, [D][D], 2 strength / 4 speed / 3 life.

const CONTORT = "770af571-0046-4a84-8f14-02c9da41c25d";

function contBoard(opts: { extra?: CardPlacement[]; icons?: Icons } = {}) {
  return devBoard(
    [
      { key: "cont", def: printing(CONTORT), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe1", strength: 1, life: 8, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 8, speed: 1 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: 2 }
  );
}

/** I attack with `attackers` (default just the Contortionist); the triggered "may pick" prompt is left open if one appears. */
function contAttack(b: ReturnType<typeof contBoard>, attackers: string[] = ["cont"]): void {
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: attackers.map((key) => b.id(key)), target: { type: "faction", playerId: P2 } });
}

/** Attack and pick `picked` (or decline with null), then finish the declaration window. */
function contAttackPicking(b: ReturnType<typeof contBoard>, picked: string | null, attackers: string[] = ["cont"]): void {
  contAttack(b, attackers);
  pickCards(b.engine, P1, picked ? [b.id(picked)] : []);
  resolvePendingResponses(b.engine);
}

const blockWith = (b: ReturnType<typeof contBoard>, keys: string[]) => () => declareBlockers(b.engine, P2, keys.map((key) => b.id(key)));

clause(CONTORT, "0:rule", "deploys for its printed cost of 4 with [D][D], is refused without the threshold, and has 2 strength / 4 speed / 3 life", () => {
  headerChecks((icons) => devBoard([{ key: "cont", def: printing(CONTORT), owner: P1, zone: "hand" }, ...res(icons)]), "cont", { icon: "deception", threshold: 2, cost: 4, lands: "play" });
  const b = contBoard();
  assert.deepEqual(stats(b.engine, b.id("cont")), { strength: 2, life: 3, speed: 4 });
});

clause(CONTORT, "0:rule", "when it attacks I am asked whether to pick a character (a 'may'), before anything else happens", () => {
  const b = contBoard();
  contAttack(b);
  const pc = expectPending(b.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("cont")]);
});

clause(CONTORT, "0:rule", "the picked character must block: declaring no blockers is refused, and declaring it alone is accepted", () => {
  const refusedCase = contBoard();
  contAttackPicking(refusedCase, "foe1");
  refused(blockWith(refusedCase, []), "no blockers declared although foe1 can block");
  assert.equal(battleOf(refusedCase.engine)?.phase, "blocking", "still waiting for a legal declaration");
  const ok = contBoard();
  contAttackPicking(ok, "foe1");
  blockWith(ok, ["foe1"])();
  assert.deepEqual(battleOf(ok.engine)?.blockingParty, [ok.id("foe1")]);
});

clause(CONTORT, "0:rule", "the picked character must be in the blocking party: blocking with only another character is refused, with both is accepted", () => {
  const only = contBoard();
  contAttackPicking(only, "foe1");
  refused(blockWith(only, ["foe2"]), "foe2 alone while foe1 was picked");
  assert.equal(battleOf(only.engine)?.phase, "blocking");
  const both = contBoard();
  contAttackPicking(both, "foe1");
  blockWith(both, ["foe1", "foe2"])();
  assert.deepEqual([...(battleOf(both.engine)?.blockingParty ?? [])].sort(), [both.id("foe1"), both.id("foe2")].sort());
});

clause(CONTORT, "0:rule", "only the picked character is obliged: the other opposing character may stay out of the block", () => {
  const b = contBoard();
  contAttackPicking(b, "foe1");
  blockWith(b, ["foe1"])();
  assert.equal(battleOf(b.engine)?.blockingParty.includes(b.id("foe2")), false);
});

clause(CONTORT, "0:rule", "control: without a pick, the defender may declare no blockers (the pick is a 'may')", () => {
  const b = contBoard();
  contAttackPicking(b, null);
  blockWith(b, [])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, []);
  assert.equal(pending(b.engine), undefined);
});

clause(CONTORT, "0:rule", "'if it can': a picked character that is depleted cannot block, so it is not required to", () => {
  const b = contBoard({ extra: [{ key: "tired", def: character({ name: "Tired", strength: 1, life: 8, speed: 1 }), owner: P2, zone: "play", depleted: true }] });
  contAttackPicking(b, "tired");
  blockWith(b, [])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [], "declaring no blockers is legal");
});

clause(CONTORT, "0:rule", "'if it can': a picked COVERT character cannot block a non-covert party, so it is not required to", () => {
  const sneak = character({ name: "Sneak", strength: 1, life: 8, speed: 1, behavior: { keywords: ["covert"] } });
  const b = contBoard({ extra: [{ key: "sneak", def: sneak, owner: P2, zone: "play" }] });
  contAttackPicking(b, "sneak");
  blockWith(b, [])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, []);
});

clause(CONTORT, "0:rule", "a character I control can be picked too; it changes nothing about the opponent's blocks", () => {
  const b = contBoard();
  contAttackPicking(b, "ally");
  blockWith(b, [])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, []);
});

clause(CONTORT, "0:rule", "only a character in play can be picked: not an item, location, faction, face-down card, or a card in hand or discard pile", () => {
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
    ...volition(1, P2).map((placement) => ({ ...placement, key: "downCard" }))
  ];
  const b = contBoard({ extra });
  contAttack(b);
  for (const bad of ["thing", "place", "inHand", "inDiscard", "downCard"]) refused(tryPick(b.engine, P1, [b.id(bad)]), `picking ${bad}`);
  refused(tryPick(b.engine, P1, [factionOf(b.engine, P2)]), "their faction (CR 202.9)");
  refused(tryPick(b.engine, P1, [factionOf(b.engine, P1)]), "my faction (CR 202.9)");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(b.engine, P1, [b.id("foe1")]);
  assert.equal(pending(b.engine), undefined, "control: a character is accepted");
});

clause(CONTORT, "0:rule", "at most one character is picked: two are refused", () => {
  const b = contBoard();
  contAttack(b);
  refused(tryPick(b.engine, P1, [b.id("foe1"), b.id("foe2")]), "two picks");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
});

clause(CONTORT, "0:rule", "it triggers only when THIS card attacks: another character attacking while the Contortionist stays home offers no pick", () => {
  const b = contBoard();
  contAttack(b, ["ally"]);
  assert.equal(pending(b.engine), undefined, "no prompt");
  resolvePendingResponses(b.engine);
  blockWith(b, [])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [], "nobody is forced to block");
});

clause(CONTORT, "0:rule", "attacking together with another character: the Contortionist's pick is still offered, once, and forces the block", () => {
  const b = contBoard();
  contAttack(b, ["cont", "ally"]);
  pickCards(b.engine, P1, [b.id("foe2")]);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine), undefined, "exactly one prompt");
  refused(blockWith(b, []), "foe2 must block the party the Contortionist is in");
  blockWith(b, ["foe2"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe2")]);
});

clause(CONTORT, "0:rule", "as a blocker the Contortionist does nothing: defending against an attack offers me no pick", () => {
  const b = devBoard(
    [
      { key: "cont", def: printing(CONTORT), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("cont")]);
  assert.equal(pending(b.engine), undefined);
});

clause(CONTORT, "0:rule", "'this turn': the obligation ends with the turn: on my next turn the same opposing character may stay out of a block", () => {
  const b = contBoard();
  contAttackPicking(b, "foe1");
  blockWith(b, ["foe1"])();
  autoResolveBattle(b.engine);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  contAttack(b, ["ally"]);
  resolvePendingResponses(b.engine);
  blockWith(b, [])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [], "foe1 is no longer obliged");
});

clause(CONTORT, "0:rule", "the obligation is to block THIS card: in a later battle the same turn that does not include the Contortionist, the picked character is free not to block", () => {
  const b = contBoard();
  contAttackPicking(b, "foe1");
  blockWith(b, ["foe1"])();
  autoResolveBattle(b.engine);
  assert.equal(battleOf(b.engine), undefined, "the first battle is over");
  // A battle survivor is depleted (it blocked), so restore it: the question is only whether the
  // obligation outlives the battle against the Contortionist.
  assert.equal(isDepleted(b.engine, b.id("foe1")), true, "foe1 survived the battle depleted");
  b.engine.state.cards[b.id("foe1")].depleted = false;
  declareAttackBy(b.engine, P1, [b.id("ally")]);
  blockWith(b, [])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [], "foe1 only had to block the Contortionist");
});

clause(CONTORT, "0:rule", "if the Contortionist is no longer in the battle when blockers are declared, there is no card to block and the picked character is free", () => {
  const b = contBoard({ extra: [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  contAttack(b, ["cont", "ally"]);
  tryPick(b.engine, P1, [b.id("foe1")])(); // answer WITHOUT draining, so the declaration window stays open
  b.engine.perform({ type: "passPriority", playerId: P1 });
  assert.equal(b.engine.state.priorityPlayerId, P2, "the defender can respond");
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("cont")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("cont")), "discard", "the Contortionist was destroyed");
  assert.deepEqual(battleOf(b.engine)?.attackingParty, [b.id("ally")]);
  blockWith(b, [])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [], "foe1 had to block the Contortionist, which is gone");
});

// --- Transient Smuggler ------------------------------------------------------
// SMUGGLE -- COST: Deplete this card. Pick a character with 2 strength or less.
// -- EFFECT: This turn, the character gains COVERT.
// Character (smuggler), cost 5, [D], 2 strength / 3 speed / 3 life.

const SMUGGLER = "f4d4810e-5fd1-48b8-8b6c-4bab1f5b287d";

/** Characters with strength 0, 1, 2, 3 and 5 keyed `s0..s5`: mine for even keys, the opponent's for odd. */
function smuggleBoard(opts: { depleted?: boolean; extra?: CardPlacement[]; icons?: Icons } = {}) {
  return devBoard(
    [
      { key: "smug", def: printing(SMUGGLER), owner: P1, zone: "play", depleted: opts.depleted },
      ...[0, 1, 2, 3, 5].map(
        (strength): CardPlacement => ({ key: `s${strength}`, def: character({ name: `Str${strength}`, strength, life: 6, speed: 1 }), owner: strength % 2 ? P2 : P1, zone: "play" })
      ),
      ...res(opts.icons ?? { deception: 2 }),
      ...(opts.extra ?? [])
    ],
    { turn: 2 }
  );
}

const isCovert = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.getKeywords(cardId).includes("covert");
const smuggle = (b: ReturnType<typeof smuggleBoard>, picked: string) => activate(b.engine, P1, b.id("smug"), "smuggle", { selected: { c: [b.id(picked)] } });

clause(SMUGGLER, "0:ability:smuggle", "deploys for its printed cost of 5 with [D], is refused without it, and has 2 strength / 3 speed / 3 life", () => {
  headerChecks((icons) => devBoard([{ key: "smug", def: printing(SMUGGLER), owner: P1, zone: "hand" }, ...res(icons)]), "smug", { icon: "deception", threshold: 1, cost: 5, lands: "play" });
  const b = smuggleBoard();
  assert.deepEqual(stats(b.engine, b.id("smug")), { strength: 2, life: 3, speed: 3 });
});

clause(SMUGGLER, "0:ability:smuggle", "the cost is to deplete this card, paid when it is used (before the opponent can respond); no resource is paid", () => {
  const b = smuggleBoard();
  const before = ready(b.engine);
  actRaw(b.engine, P1, b.id("smug"), "smuggle", { c: [b.id("s1")] });
  assert.equal(isDepleted(b.engine, b.id("smug")), true, "depleted as a cost");
  assert.equal(before - ready(b.engine), 0, "no resources were paid");
  assert.equal(isCovert(b.engine, b.id("s1")), false, "the effect has not resolved yet");
  resolvePendingResponses(b.engine);
  assert.equal(isCovert(b.engine, b.id("s1")), true);
});

clause(SMUGGLER, "0:ability:smuggle", "it cannot be used while the Smuggler is depleted, and works again once it is restored on my next turn", () => {
  const dep = smuggleBoard({ depleted: true });
  refused(() => actRaw(dep.engine, P1, dep.id("smug"), "smuggle", { c: [dep.id("s1")] }), "already depleted");
  assert.equal(isCovert(dep.engine, dep.id("s1")), false);
  const b = smuggleBoard();
  smuggle(b, "s1");
  refused(() => actRaw(b.engine, P1, b.id("smug"), "smuggle", { c: [b.id("s2")] }), "used twice in one turn");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("smug")), false, "restored at the start of my turn");
  smuggle(b, "s2");
  assert.equal(isCovert(b.engine, b.id("s2")), true);
});

clause(SMUGGLER, "0:ability:smuggle", "a character with 2 strength or less can be picked: strength 0, 1 and 2 each gain COVERT (mine and the opponent's)", () => {
  for (const key of ["s0", "s1", "s2"]) {
    const b = smuggleBoard();
    smuggle(b, key);
    assert.equal(isCovert(b.engine, b.id(key)), true, `${key} gained COVERT`);
  }
});

clause(SMUGGLER, "0:ability:smuggle", "a character with more than 2 strength cannot be picked: strength 3 and 5 are refused (and the Smuggler stays undepleted)", () => {
  for (const key of ["s3", "s5"]) {
    const b = smuggleBoard();
    refused(() => actRaw(b.engine, P1, b.id("smug"), "smuggle", { c: [b.id(key)] }), `picking ${key}`);
    assert.equal(isDepleted(b.engine, b.id("smug")), false, "a refused use pays nothing");
    assert.equal(isCovert(b.engine, b.id(key)), false);
  }
});

clause(SMUGGLER, "0:ability:smuggle", "the strength compared is CURRENT strength: +2 makes a strength-1 character ineligible; -3 makes a strength-5 character eligible", () => {
  const shift = (name: string, value: number) =>
    tactic({
      name,
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "shift",
            type: "activated",
            targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
            effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value, duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
  const up = smuggleBoard({ extra: [{ key: "up", def: shift("Up", 2), owner: P1, zone: "hand" }] });
  play(up.engine, P1, up.id("up"), { selected: { t: [up.id("s1")] } });
  assert.equal(up.engine.getStat(up.id("s1"), "strength"), 3);
  refused(() => actRaw(up.engine, P1, up.id("smug"), "smuggle", { c: [up.id("s1")] }), "strength 1 + 2 = 3");
  const down = smuggleBoard({ extra: [{ key: "down", def: shift("Down", -3), owner: P1, zone: "hand" }] });
  play(down.engine, P1, down.id("down"), { selected: { t: [down.id("s5")] } });
  assert.equal(down.engine.getStat(down.id("s5"), "strength"), 2);
  smuggle(down, "s5");
  assert.equal(isCovert(down.engine, down.id("s5")), true, "strength 5 - 3 = 2 is eligible");
});

clause(SMUGGLER, "0:ability:smuggle", "the Smuggler (2 strength, depleted by its own cost) can pick itself", () => {
  const b = smuggleBoard();
  smuggle(b, "smug");
  assert.equal(isCovert(b.engine, b.id("smug")), true);
  assert.equal(isDepleted(b.engine, b.id("smug")), true);
});

clause(SMUGGLER, "0:ability:smuggle", "only the picked character gains COVERT; the other eligible characters, the Smuggler and the opponent's do not", () => {
  const b = smuggleBoard();
  smuggle(b, "s1");
  for (const key of ["s0", "s2", "s3", "s5", "smug"]) assert.equal(isCovert(b.engine, b.id(key)), false, `${key} is not covert`);
});

clause(SMUGGLER, "0:ability:smuggle", "'This turn': COVERT is gone when the turn ends", () => {
  const b = smuggleBoard();
  smuggle(b, "s0");
  assert.equal(isCovert(b.engine, b.id("s0")), true);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(isCovert(b.engine, b.id("s0")), false, "only this turn");
  endTurn(b.engine, P2);
  assert.equal(isCovert(b.engine, b.id("s0")), false);
});

clause(SMUGGLER, "0:ability:smuggle", "the COVERT is real: a character that attacks with it cannot be blocked by a non-covert character, but a covert one can block it", () => {
  const blockers: CardPlacement[] = [
    { key: "plainBlk", def: character({ name: "PlainBlk", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
    { key: "covertBlk", def: character({ name: "CovertBlk", strength: 1, life: 6, speed: 1, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
  ];
  const b = smuggleBoard({ extra: blockers });
  smuggle(b, "s0");
  declareAttackBy(b.engine, P1, [b.id("s0")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("plainBlk")]), "a non-covert blocker");
  declareBlockers(b.engine, P2, [b.id("covertBlk")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("covertBlk")]);
  const control = smuggleBoard({ extra: blockers });
  declareAttackBy(control.engine, P1, [control.id("s0")]);
  declareBlockers(control.engine, P2, [control.id("plainBlk")]);
  assert.deepEqual(battleOf(control.engine)?.blockingParty, [control.id("plainBlk")], "control: without SMUGGLE anyone may block");
});

clause(SMUGGLER, "0:ability:smuggle", "a character that already has COVERT is unharmed by a second COVERT (CR 507.3e: still just covert)", () => {
  const sneak = character({ name: "Sneak", strength: 1, life: 6, speed: 1, behavior: { keywords: ["covert"] } });
  const b = smuggleBoard({ extra: [{ key: "sneak", def: sneak, owner: P1, zone: "play" }] });
  smuggle(b, "sneak");
  assert.equal(b.engine.getKeywords(b.id("sneak")).filter((keyword) => keyword === "covert").length, 1, "one instance of covert");
});

clause(SMUGGLER, "0:ability:smuggle", "only a character in play can be picked: not an item, location, faction, face-down card, or a card in hand or discard pile", () => {
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "inHand", def: character({ name: "InHand", strength: 0 }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard", strength: 0 }), owner: P1, zone: "discard" },
    ...volition(1, P1).map((placement) => ({ ...placement, key: "downCard" }))
  ];
  for (const bad of ["thing", "place", "inHand", "inDiscard", "downCard"]) {
    const b = smuggleBoard({ extra });
    refused(() => actRaw(b.engine, P1, b.id("smug"), "smuggle", { c: [b.id(bad)] }), `picking ${bad}`);
    assert.equal(isDepleted(b.engine, b.id("smug")), false);
  }
  const b = smuggleBoard({ extra });
  refused(() => actRaw(b.engine, P1, b.id("smug"), "smuggle", { c: [factionOf(b.engine, P1)] }), "my faction (CR 202.9)");
  refused(() => actRaw(b.engine, P1, b.id("smug"), "smuggle", { c: [factionOf(b.engine, P2)] }), "their faction (CR 202.9)");
});

clause(SMUGGLER, "0:ability:smuggle", "exactly one character is picked: none or two are refused", () => {
  const b = smuggleBoard();
  refused(() => actRaw(b.engine, P1, b.id("smug"), "smuggle", {}), "no declaration");
  refused(() => actRaw(b.engine, P1, b.id("smug"), "smuggle", { c: [] }), "an empty pick");
  refused(() => actRaw(b.engine, P1, b.id("smug"), "smuggle", { c: [b.id("s0"), b.id("s1")] }), "two picks");
  assert.equal(isDepleted(b.engine, b.id("smug")), false);
});

clause(SMUGGLER, "0:ability:smuggle", "if the picked character is destroyed in response, SMUGGLE resolves harmlessly (the cost stays paid)", () => {
  const b = smuggleBoard({ extra: [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  actRaw(b.engine, P1, b.id("smug"), "smuggle", { c: [b.id("s0")] });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("s0")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("s0")), "discard");
  assert.equal(isDepleted(b.engine, b.id("smug")), true);
  assert.equal(pending(b.engine), undefined);
});

clause(SMUGGLER, "0:ability:smuggle", "only its controller can use it", () => {
  const b = smuggleBoard();
  declareAttackOpenWindow(b.engine, P1, [b.id("s0")]);
  refused(() => actRaw(b.engine, P2, b.id("smug"), "smuggle", { c: [b.id("s1")] }), "the opponent using my Smuggler", /control|own|cannot|illegal|only|usable|available/i);
  assert.equal(isDepleted(b.engine, b.id("smug")), false);
});

// --- Treachery ---------------------------------------------------------------
// This card provides - [D][D] -- When this card enters play, your faction loses 1
// influence. Resource, cost 0.

const TREACHERY = "c5cea326-3431-46dd-b5fb-7ada354f98eb";

function treacheryBoard(opts: { influence?: number; extra?: CardPlacement[]; zone?: Zone } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction() },
    cards: [{ key: "tre", def: printing(TREACHERY), owner: P1, zone: opts.zone ?? "hand" }, ...(opts.extra ?? [])]
  });
}

const developTreachery = (b: ReturnType<typeof treacheryBoard>, faceDown = false): void => {
  developPlay(b.engine, P1, b.id("tre"), faceDown);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
};

clause(TREACHERY, "0:rule", "provides exactly two [D]: a face-up Treachery alone gives two Deception icons and no other", () => {
  const b = treacheryBoard();
  developTreachery(b);
  assert.equal(zoneOf(b.engine, b.id("tre")), "play");
  const icons = b.engine.getThresholds(P1) as unknown as Record<string, number>;
  assert.equal(icons.deception, 2, "two [D]");
  for (const other of ["rage", "greed", "elitism", "obsession", "volition"]) assert.equal(icons[other] ?? 0, 0, `no ${other}`);
});

clause(TREACHERY, "0:rule", "its two [D] meet a [D][D] threshold, but not a [D][D][D] threshold", () => {
  const needs = (threshold: string) => character({ name: `Needs ${threshold}`, cost: 0, threshold: threshold as never });
  const dd = treacheryBoard({ extra: [{ key: "dd", def: needs("dd"), owner: P1, zone: "hand" }] });
  developTreachery(dd);
  play(dd.engine, P1, dd.id("dd"), {});
  assert.equal(zoneOf(dd.engine, dd.id("dd")), "play", "a [D][D] character can be deployed");
  const ddd = treacheryBoard({ extra: [{ key: "ddd", def: needs("ddd"), owner: P1, zone: "hand" }] });
  developTreachery(ddd);
  refused(() => playRaw(ddd.engine, P1, ddd.id("ddd"), {}), "a [D][D][D] threshold with two [D]");
  assert.equal(zoneOf(ddd.engine, ddd.id("ddd")), "hand");
});

clause(TREACHERY, "0:rule", "it adds to other [D]: one staple [D] plus Treachery meets [D][D][D]", () => {
  const needs = character({ name: "Needs ddd", cost: 0, threshold: "ddd" as never });
  const b = treacheryBoard({ extra: [{ key: "ddd", def: needs, owner: P1, zone: "hand" }, ...bank("deception", 1, P1)] });
  developTreachery(b);
  play(b.engine, P1, b.id("ddd"), {});
  assert.equal(zoneOf(b.engine, b.id("ddd")), "play");
});

clause(TREACHERY, "0:rule", "it is still ONE resource card: it counts as a single resource when paying a numeric cost, even though it provides two icons", () => {
  const b = treacheryBoard({ extra: [{ key: "pricey", def: character({ name: "Pricey", cost: 2, threshold: "dd" as never }), owner: P1, zone: "hand" }] });
  developTreachery(b);
  assert.equal(ready(b.engine), 1, "one resource card");
  refused(() => playRaw(b.engine, P1, b.id("pricey"), {}), "a cost of 2 with a single resource card");
  assert.equal(zoneOf(b.engine, b.id("pricey")), "hand");
});

clause(TREACHERY, "0:rule", "played face-down it is only a Volition resource: one Volition, no [D]", () => {
  const b = treacheryBoard();
  developTreachery(b, true);
  assert.equal(b.engine.state.cards[b.id("tre")].faceDown, true);
  const icons = b.engine.getThresholds(P1) as unknown as Record<string, number>;
  assert.equal(icons.deception ?? 0, 0, "a face-down card provides no [D]");
  assert.equal(icons.volition, 1);
});

clause(TREACHERY, "1:rule", "when it enters play as a resource (the Develop Rule), my faction loses exactly 1 influence", () => {
  const b = treacheryBoard();
  assert.equal(influenceOf(b.engine, P1), 30);
  developTreachery(b);
  assert.equal(zoneOf(b.engine, b.id("tre")), "play");
  assert.equal(influenceOf(b.engine, P1), 29, "exactly 1 influence lost, not 2");
});

clause(TREACHERY, "1:rule", "only MY faction loses it: the opponent's influence is unchanged", () => {
  const b = treacheryBoard();
  developTreachery(b);
  assert.equal(influenceOf(b.engine, P2), 30);
});

clause(TREACHERY, "1:rule", "it is an influence loss, not damage: a damage-prevention effect does not stop it", () => {
  const shield = item({
    name: "Faction Shield",
    behavior: { abilities: [{ id: "shield", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "faction" }, delta: -9 }] }] }
  });
  const b = treacheryBoard({ extra: [{ key: "shield", def: shield, owner: P1, zone: "play" }] });
  developTreachery(b);
  assert.equal(influenceOf(b.engine, P1), 29, "CR 408.3b: a direct 'loses influence' ignores damage modification");
});

clause(TREACHERY, "1:rule", "it triggers when it enters play by an effect too, not only through the Develop Rule: put into play from my hand, I lose 1 influence", () => {
  const cheat = tactic({
    name: "Put It In",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "cheat",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", name: "Treachery" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = treacheryBoard({ extra: [{ key: "cheat", def: cheat, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("cheat"), { selected: { t: [b.id("tre")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("tre")), "play");
  assert.equal(influenceOf(b.engine, P1), 29);
});

clause(TREACHERY, "1:rule", "face-down it has no rules text: playing it face-down loses no influence", () => {
  const b = treacheryBoard();
  developTreachery(b, true);
  assert.equal(influenceOf(b.engine, P1), 30);
});

clause(TREACHERY, "1:rule", "it triggers only for itself: another resource entering play loses no influence", () => {
  const b = treacheryBoard({
    zone: "play",
    extra: [{ key: "other", def: resourceCard({ name: "Plain Resource", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" }]
  });
  developPlay(b.engine, P1, b.id("other"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(influenceOf(b.engine, P1), 30);
});

clause(TREACHERY, "1:rule", "a faction at 1 influence that plays Treachery goes to 0 and loses the game", () => {
  const b = treacheryBoard({ influence: 1 });
  developTreachery(b);
  assert.equal(influenceOf(b.engine, P1), 0);
  assert.equal(b.engine.state.winner, P2);
});

clause(TREACHERY, "1:rule", "two Treacheries lose 2 influence in total, 1 each", () => {
  const b = treacheryBoard({ extra: [{ key: "tre2", def: printing(TREACHERY), owner: P1, zone: "hand" }] });
  developTreachery(b);
  assert.equal(influenceOf(b.engine, P1), 29);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my next turn: the Develop Rule is available again");
  developPlay(b.engine, P1, b.id("tre2"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("tre2")), "play");
  assert.equal(influenceOf(b.engine, P1), 28);
});

// --- Underhanded Gamer -------------------------------------------------------
// OUTSMART -- COST: Use this only if your opponent controls more characters than
// you. Pay 3. -- EFFECT: This turn, this card cannot be blocked.
// Character (gambler), cost 5, [D], 3 strength / 3 speed / 3 life.

const GAMER = "8c111617-ef44-42a4-a79e-b895dd8005c3";

/** I have the Gamer plus `mine` other characters; the opponent has `theirs` characters. */
function gamerBoard(opts: { mine?: number; theirs?: number; icons?: Icons; extra?: CardPlacement[] } = {}) {
  return devBoard(
    [
      { key: "gamer", def: printing(GAMER), owner: P1, zone: "play" },
      ...Array.from({ length: opts.mine ?? 0 }, (_, i): CardPlacement => ({ key: `my${i}`, def: character({ name: `Mine${i}`, strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" })),
      ...Array.from({ length: opts.theirs ?? 0 }, (_, i): CardPlacement => ({ key: `foe${i}`, def: character({ name: `Foe${i}`, strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" })),
      ...res(opts.icons ?? { deception: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: 2 }
  );
}

clause(GAMER, "0:ability:outsmart", "deploys for its printed cost of 5 with [D], is refused without it, and has 3 strength / 3 speed / 3 life", () => {
  headerChecks((icons) => devBoard([{ key: "gamer", def: printing(GAMER), owner: P1, zone: "hand" }, ...res(icons)]), "gamer", { icon: "deception", threshold: 1, cost: 5, lands: "play" });
  const b = gamerBoard();
  assert.deepEqual(stats(b.engine, b.id("gamer")), { strength: 3, life: 3, speed: 3 });
});

clause(GAMER, "0:ability:outsmart", "'Use this only if your opponent controls more characters than you': allowed when they have strictly more", () => {
  const behind = gamerBoard({ mine: 1, theirs: 3 });
  actRaw(behind.engine, P1, behind.id("gamer"), "outsmart");
  assert.ok(behind.engine.state.responseWindow, "2 characters vs 3: used");
  const way = gamerBoard({ mine: 0, theirs: 2 });
  actRaw(way.engine, P1, way.id("gamer"), "outsmart");
  assert.ok(way.engine.state.responseWindow, "1 character (just the Gamer) vs 2: used");
});

clause(GAMER, "0:ability:outsmart", "it is refused when the character counts are equal", () => {
  const b = gamerBoard({ mine: 1, theirs: 2 });
  refused(() => actRaw(b.engine, P1, b.id("gamer"), "outsmart"), "2 characters vs 2");
  const lone = gamerBoard({ mine: 0, theirs: 1 });
  refused(() => actRaw(lone.engine, P1, lone.id("gamer"), "outsmart"), "1 character (the Gamer) vs 1");
  assert.equal(ready(lone.engine), 4, "nothing was paid");
});

clause(GAMER, "0:ability:outsmart", "it is refused when I control more characters than the opponent, or they have none", () => {
  const ahead = gamerBoard({ mine: 3, theirs: 1 });
  refused(() => actRaw(ahead.engine, P1, ahead.id("gamer"), "outsmart"), "4 characters vs 1");
  const none = gamerBoard({ mine: 0, theirs: 0 });
  refused(() => actRaw(none.engine, P1, none.id("gamer"), "outsmart"), "1 character vs 0");
});

clause(GAMER, "0:ability:outsmart", "my count includes the Gamer itself: with the Gamer and one other against 2, the counts are equal and it is refused; against 3 it is allowed", () => {
  const equal = gamerBoard({ mine: 1, theirs: 2 });
  refused(() => actRaw(equal.engine, P1, equal.id("gamer"), "outsmart"), "2 vs 2");
  const more = gamerBoard({ mine: 1, theirs: 3 });
  actRaw(more.engine, P1, more.id("gamer"), "outsmart");
  assert.ok(more.engine.state.responseWindow, "more.engine.state.responseWindow");
});

clause(GAMER, "0:ability:outsmart", "only CHARACTERS are counted: the opponent's items, locations and face-down cards do not make them 'more'", () => {
  const extra: CardPlacement[] = [
    { key: "i1", def: item({ name: "I1" }), owner: P2, zone: "play" },
    { key: "i2", def: item({ name: "I2" }), owner: P2, zone: "play" },
    { key: "l1", def: location({ name: "L1" }), owner: P2, zone: "play" },
    ...volition(3, P2)
  ];
  const b = gamerBoard({ mine: 1, theirs: 1, extra });
  refused(() => actRaw(b.engine, P1, b.id("gamer"), "outsmart"), "2 characters vs 1 character plus non-characters");
  const mineItems = gamerBoard({ mine: 0, theirs: 2, extra: [{ key: "mi", def: item({ name: "MyItem" }), owner: P1, zone: "play" }, { key: "ml", def: location({ name: "MyPlace" }), owner: P1, zone: "play" }] });
  actRaw(mineItems.engine, P1, mineItems.id("gamer"), "outsmart");
  assert.ok(mineItems.engine.state.responseWindow, "my items and locations are not characters either: 1 vs 2 allows it");
});

clause(GAMER, "0:ability:outsmart", "my face-down cards are not characters either, so they don't help me reach equal counts", () => {
  const b = gamerBoard({ mine: 0, theirs: 2, extra: [...volition(3, P1)] });
  actRaw(b.engine, P1, b.id("gamer"), "outsmart");
  assert.ok(b.engine.state.responseWindow, "1 character (face-down cards are resources) vs 2");
});

clause(GAMER, "0:ability:outsmart", "pays exactly 3 resources, and is refused with only 2", () => {
  const b = gamerBoard({ mine: 0, theirs: 2, icons: { rage: 5 } });
  const before = ready(b.engine);
  actRaw(b.engine, P1, b.id("gamer"), "outsmart");
  assert.equal(before - ready(b.engine), 3, "any three resources (no threshold on the ability)");
  const short = gamerBoard({ mine: 0, theirs: 2, icons: { rage: 2 } });
  refused(() => actRaw(short.engine, P1, short.id("gamer"), "outsmart"), "only 2 resources");
  assert.equal(ready(short.engine), 2);
});

clause(GAMER, "0:ability:outsmart", "this turn it cannot be blocked: the defender may not declare any blocker against it", () => {
  const b = gamerBoard({ mine: 0, theirs: 2 });
  activate(b.engine, P1, b.id("gamer"), "outsmart");
  declareAttackBy(b.engine, P1, [b.id("gamer")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("foe0")]), "one blocker");
  refused(() => declareBlockers(b.engine, P2, [b.id("foe0"), b.id("foe1")]), "two blockers");
  declareBlockers(b.engine, P2, []);
  autoResolveBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), 30 - 3, "its 3 damage reached the faction");
});

clause(GAMER, "0:ability:outsmart", "control: without OUTSMART the Gamer can be blocked", () => {
  const b = gamerBoard({ mine: 0, theirs: 2 });
  declareAttackBy(b.engine, P1, [b.id("gamer")]);
  declareBlockers(b.engine, P2, [b.id("foe0")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe0")]);
});

clause(GAMER, "0:ability:outsmart", "it makes only the Gamer unblockable: in a party with another attacker, the party can still be blocked (CR 412)", () => {
  const b = gamerBoard({ mine: 1, theirs: 3 });
  activate(b.engine, P1, b.id("gamer"), "outsmart");
  declareAttackBy(b.engine, P1, [b.id("gamer"), b.id("my0")]);
  declareBlockers(b.engine, P2, [b.id("foe0")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe0")], "a party with a blockable member can be blocked");
});

clause(GAMER, "0:ability:outsmart", "'This turn': on my next turn the Gamer can be blocked again", () => {
  const b = gamerBoard({ mine: 0, theirs: 2 });
  activate(b.engine, P1, b.id("gamer"), "outsmart");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  declareAttackBy(b.engine, P1, [b.id("gamer")]);
  declareBlockers(b.engine, P2, [b.id("foe0")]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe0")]);
});

clause(GAMER, "0:ability:outsmart", "the effect applies once the cost was met: the counts changing afterwards (the opponent loses a character in response) doesn't undo it", () => {
  const b = gamerBoard({ mine: 0, theirs: 2, extra: [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  actRaw(b.engine, P1, b.id("gamer"), "outsmart");
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("foe0")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  declareAttackBy(b.engine, P1, [b.id("gamer")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("foe1")]), "still unblockable");
});

clause(GAMER, "0:ability:outsmart", "only its controller can use it", () => {
  const b = gamerBoard({ mine: 0, theirs: 2, extra: [...res({ deception: 4 }, P2)] });
  declareAttackOpenWindow(b.engine, P1, [b.id("gamer")]);
  refused(() => actRaw(b.engine, P2, b.id("gamer"), "outsmart"), "the opponent using my Gamer", /control|own|cannot|illegal|only|usable|available/i);
});

// --- Adriel, Defender of Marduun ---------------------------------------------
// UNIQUE ADRIEL -- If battle damage is inflicted to this card while it's blocking,
// reduce the amount to 0.
// Character (adriel, sword of great justice), cost 2, [R][R][R], 3 strength / 3 speed / 3 life.

const ADRIEL = "29b9fbb7-6123-40f4-b0ae-4dd814dbb2a2";

/** P2 (active, turn 2) attacks with the 5-strength `atk`; I (P1) have Adriel and an `ally` that can block. */
function adrielDefBoard(extra: CardPlacement[] = []) {
  return devBoard(
    [
      { key: "adriel", def: printing(ADRIEL), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 5, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Attacker2", strength: 4, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...extra
    ],
    { turn: 2, activePlayerId: P2 }
  );
}

/** The attackers assign all their damage to `targetKey`'s card when it is a legal target, otherwise to the first legal target. */
const assignTo = (b: ReturnType<typeof adrielDefBoard>, targetKey: string) => (source: { cardId: string; strength: number; legalTargets: Array<{ type: string; cardId?: string; playerId?: string }> }) => {
  const wanted = source.legalTargets.find((t) => t.type === "card" && t.cardId === b.id(targetKey)) ?? source.legalTargets[0];
  return source.strength > 0 ? [{ sourceId: source.cardId, target: wanted as never, amount: source.strength }] : [];
};

clause(ADRIEL, "0:unique", "deploys for its printed cost of 2 with [R][R][R], is refused without the threshold, and has 3 strength / 3 speed / 3 life", () => {
  headerChecks((icons) => devBoard([{ key: "adriel", def: printing(ADRIEL), owner: P1, zone: "hand" }, ...res(icons)]), "adriel", { icon: "rage", threshold: 3, cost: 2, lands: "play" });
  const b = adrielDefBoard();
  assert.deepEqual(stats(b.engine, b.id("adriel")), { strength: 3, life: 3, speed: 3 });
});

/** Two Adriels for me: the first in play, the second in hand; plays the second. */
function secondAdriel() {
  const b = devBoard([
    { key: "adriel", def: printing(ADRIEL), owner: P1, zone: "play" },
    { key: "adriel2", def: printing(ADRIEL), owner: P1, zone: "hand" },
    { key: "bystander", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
    ...res({ rage: 4 })
  ]);
  play(b.engine, P1, b.id("adriel2"), {});
  return b;
}

clause(ADRIEL, "0:unique", "a second copy under my control forces me to choose which to keep: both are offered, and I choose", () => {
  const b = secondAdriel();
  const pc = expectPending(b.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [b.id("adriel"), b.id("adriel2")].sort());
});

clause(ADRIEL, "0:unique", "keeping the new copy destroys the old one, and the game goes on", () => {
  const b = secondAdriel();
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("adriel2") } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("adriel2")), "play");
  assert.equal(zoneOf(b.engine, b.id("adriel")), "discard", "the other copy is destroyed");
  assert.equal(pending(b.engine), undefined);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "the game is not stuck");
});

clause(ADRIEL, "0:unique", "keeping the old copy destroys the new one, and the game goes on", () => {
  const b = secondAdriel();
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("adriel") } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("adriel")), "play");
  assert.equal(zoneOf(b.engine, b.id("adriel2")), "discard");
  assert.equal(pending(b.engine), undefined);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
});

clause(ADRIEL, "0:unique", "the choice must name one of the copies: naming a bystander is refused and the choice stays open", () => {
  const b = secondAdriel();
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("bystander") } } as never),
    "a card that is not an Adriel"
  );
  assert.equal(zoneOf(b.engine, b.id("bystander")), "play");
  assert.equal(pending(b.engine)?.kind, "uniqueSurvivor");
});

clause(ADRIEL, "0:unique", "UNIQUE is per player: the opponent may control their own Adriel with no choice and no destruction", () => {
  const b = devBoard(
    [
      { key: "adriel", def: printing(ADRIEL), owner: P1, zone: "play" },
      { key: "adrielFoe", def: printing(ADRIEL), owner: P2, zone: "hand" },
      ...res({ rage: 4 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(b.engine, P2, b.id("adrielFoe"), {});
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("adriel")), "play");
  assert.equal(zoneOf(b.engine, b.id("adrielFoe")), "play");
});

clause(ADRIEL, "0:unique", "taking control of the opponent's Adriel while I control mine forces me to keep one (FAQ)", () => {
  const grab = tactic({
    name: "Grab",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "grab",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = devBoard([
    { key: "adriel", def: printing(ADRIEL), owner: P1, zone: "play" },
    { key: "adrielFoe", def: printing(ADRIEL), owner: P2, zone: "play" },
    { key: "grab", def: grab, owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("grab"), { selected: { t: [b.id("adrielFoe")] } });
  const pc = expectPending(b.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("adriel") } } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("adriel")), "play");
  assert.equal(zoneOf(b.engine, b.id("adrielFoe")), "discard", "the stolen copy is destroyed into its owner's discard pile");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "the game is not stuck");
});

clause(ADRIEL, "0:unique", "a second Adriel played face-down as a resource is not a second Adriel: no choice", () => {
  const b = devBoard([
    { key: "adriel", def: printing(ADRIEL), owner: P1, zone: "play" },
    { key: "adriel2", def: printing(ADRIEL), owner: P1, zone: "hand" }
  ]);
  developPlay(b.engine, P1, b.id("adriel2"), true);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("adriel2")].faceDown, true);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("adriel")), "play");
});

clause(ADRIEL, "0:unique", "after the other copy has been destroyed, a new Adriel can be deployed with no conflict", () => {
  const b = devBoard([
    { key: "adriel", def: printing(ADRIEL), owner: P1, zone: "play" },
    { key: "adriel2", def: printing(ADRIEL), owner: P1, zone: "hand" },
    { key: "kill", def: killTactic({ name: "MyKill" }), owner: P1, zone: "hand" },
    ...res({ rage: 4 })
  ]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("adriel")] } });
  assert.equal(zoneOf(b.engine, b.id("adriel")), "discard");
  play(b.engine, P1, b.id("adriel2"), {});
  assert.equal(pending(b.engine), undefined, "no conflict: the first copy is gone");
  assert.equal(zoneOf(b.engine, b.id("adriel2")), "play");
});

clause(ADRIEL, "1:rule", "blocking: battle damage inflicted to Adriel is reduced to 0 - a 5-strength attacker leaves no damage and Adriel survives", () => {
  const b = adrielDefBoard();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("adriel")]);
  autoResolveBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("adriel")), 0, "no damage markers");
  assert.equal(zoneOf(b.engine, b.id("adriel")), "play", "Adriel (3 life) survives 5 battle damage");
  assert.equal(damageOf(b.engine, b.id("atk")), 3, "Adriel still deals its own 3 damage to the attacker");
});

clause(ADRIEL, "1:rule", "blocking: damage from several attackers adds up and the total is still reduced to 0", () => {
  const b = adrielDefBoard();
  declareAttackBy(b.engine, P2, [b.id("atk"), b.id("atk2")]);
  declareBlockers(b.engine, P1, [b.id("adriel")]);
  autoResolveBattle(b.engine);
  assert.equal(damageOf(b.engine, b.id("adriel")), 0, "5 + 4 damage, all reduced to 0");
  assert.equal(zoneOf(b.engine, b.id("adriel")), "play");
});

clause(ADRIEL, "1:rule", "only while it is BLOCKING: when Adriel attacks and is blocked, it takes full battle damage and dies to a 5-strength blocker", () => {
  const b = devBoard(
    [
      { key: "adriel", def: printing(ADRIEL), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 5, life: 9, speed: 2 }), owner: P2, zone: "play" }
    ],
    { turn: 2 }
  );
  fight(b.engine, P1, [b.id("adriel")], FACTION_P2, [b.id("blk")]);
  assert.equal(zoneOf(b.engine, b.id("adriel")), "discard", "3 life, 5 damage while attacking");
});

clause(ADRIEL, "1:rule", "only BATTLE damage: damage from a tactic during the battle (not battle damage, CR 408.6) is inflicted in full while Adriel is blocking", () => {
  const b = adrielDefBoard([{ key: "zap", def: zapTactic("Zap3", 3), owner: P2, zone: "hand" }]);
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("adriel")]);
  assert.equal(b.engine.state.priorityPlayerId, P2, "the attacker acts first in the battle window");
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("zap"), selected: { t: [b.id("adriel")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("adriel")), "discard", "3 tactic damage kills the 3-life Adriel even though it is blocking");
});

clause(ADRIEL, "1:rule", "outside a battle, damage to Adriel is not reduced", () => {
  const b = devBoard([
    { key: "adriel", def: printing(ADRIEL), owner: P1, zone: "play" },
    { key: "zap", def: zapTactic("Zap2", 2), owner: P2, zone: "hand" }
  ], { activePlayerId: P2, turn: 2 });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("zap"), selected: { t: [b.id("adriel")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(damageOf(b.engine, b.id("adriel")), 2);
});

clause(ADRIEL, "1:rule", "it protects only Adriel: an ally blocking beside it takes the battle damage in full and dies", () => {
  const b = adrielDefBoard();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("adriel"), b.id("ally")]);
  autoResolveBattle(b.engine, assignTo(b, "ally") as never);
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard", "5 damage kills the 3-life ally");
  assert.equal(damageOf(b.engine, b.id("adriel")), 0);
});

clause(ADRIEL, "1:rule", "an attacker may split its damage: the share assigned to Adriel is reduced to 0 while the share to the ally lands in full", () => {
  const b = adrielDefBoard();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("adriel"), b.id("ally")]);
  autoResolveBattle(b.engine, (source) => {
    if (source.legalTargets.length < 2 || source.strength !== 5) return source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : [];
    const toAdriel = source.legalTargets.find((t) => t.type === "card" && t.cardId === b.id("adriel"))!;
    const toAlly = source.legalTargets.find((t) => t.type === "card" && t.cardId === b.id("ally"))!;
    return [
      { sourceId: source.cardId, target: toAdriel, amount: 2 },
      { sourceId: source.cardId, target: toAlly, amount: 3 }
    ];
  });
  assert.equal(damageOf(b.engine, b.id("adriel")), 0);
  assert.equal(zoneOf(b.engine, b.id("ally")), "discard", "3 damage on a 3-life ally");
});

clause(ADRIEL, "1:rule", "the opponent's Adriel is protected by its own text when it blocks my attacker", () => {
  const b = devBoard(
    [
      { key: "adrielFoe", def: printing(ADRIEL), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "MyAttacker", strength: 6, life: 9, speed: 2 }), owner: P1, zone: "play" }
    ],
    { turn: 2 }
  );
  fight(b.engine, P1, [b.id("atk")], FACTION_P2, [b.id("adrielFoe")]);
  assert.equal(damageOf(b.engine, b.id("adrielFoe")), 0);
  assert.equal(zoneOf(b.engine, b.id("adrielFoe")), "play");
});

clause(ADRIEL, "1:rule", "a face-down Adriel has no rules text and no battle role", () => {
  const b = devBoard([{ key: "adriel", def: printing(ADRIEL), owner: P1, zone: "play", faceDown: true }, ...res({ rage: 1 })]);
  assert.equal(b.engine.state.cards[b.id("adriel")].faceDown, true);
  assert.equal(damageOf(b.engine, b.id("adriel")), 0);
});

// --- Aweless Charger ---------------------------------------------------------
// BORE -- COST: Pay 3. Deplete this card. Pick a blocking character. -- EFFECT:
// Remove the character from the battle. Deplete it.
// Character (soldier), cost 2, [R][R], 1 strength / 3 speed / 1 life.

const CHARGER = "67038135-53e7-41ae-9fec-f9c71090a8c1";

/** I (P1, turn 2) attack with `atk`; the Charger stays home. P2 has blockers blk1 (strong) and blk2 and an idle character. */
function chargerBoard(opts: { icons?: Icons; chargerDepleted?: boolean; extra?: CardPlacement[] } = {}) {
  return devBoard(
    [
      { key: "charger", def: printing(CHARGER), owner: P1, zone: "play", depleted: opts.chargerDepleted },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "idle", def: character({ name: "MyIdle", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "blk1", def: character({ name: "Blocker1", strength: 4, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "blk2", def: character({ name: "Blocker2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "foeIdle", def: character({ name: "FoeIdle", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { rage: 5 }),
      ...(opts.extra ?? [])
    ],
    { turn: 2 }
  );
}

/** I attack with `atk`; the opponent blocks with `blockers`; the battle-resolution window is open with me holding priority. */
function chargerBlocked(b: ReturnType<typeof chargerBoard>, blockers = ["blk1", "blk2"]): void {
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  declareBlockers(b.engine, P2, blockers.map((key) => b.id(key)));
  assert.equal(b.engine.state.priorityPlayerId, P1, "I act first in the battle window");
}

const bore = (b: ReturnType<typeof chargerBoard>, picked: string) => activate(b.engine, P1, b.id("charger"), "bore", { selected: { b: [b.id(picked)] } });

clause(CHARGER, "0:ability:bore", "deploys for its printed cost of 2 with [R][R], is refused without the threshold, and has 1 strength / 3 speed / 1 life", () => {
  headerChecks((icons) => devBoard([{ key: "charger", def: printing(CHARGER), owner: P1, zone: "hand" }, ...res(icons)]), "charger", { icon: "rage", threshold: 2, cost: 2, lands: "play" });
  const b = chargerBoard();
  assert.deepEqual(stats(b.engine, b.id("charger")), { strength: 1, life: 1, speed: 3 });
});

clause(CHARGER, "0:ability:bore", "the costs are paid when it is used: 3 resources and the Charger depleted, before the opponent can respond", () => {
  const b = chargerBoard();
  chargerBlocked(b);
  const before = ready(b.engine);
  actRaw(b.engine, P1, b.id("charger"), "bore", { b: [b.id("blk1")] });
  assert.equal(before - ready(b.engine), 3, "3 resources paid");
  assert.equal(isDepleted(b.engine, b.id("charger")), true, "depleted as a cost");
  assert.equal(battleOf(b.engine)?.blockingParty.includes(b.id("blk1")), true, "the effect has not resolved yet");
  resolvePendingResponses(b.engine);
  assert.equal(battleOf(b.engine)?.blockingParty.includes(b.id("blk1")), false);
});

clause(CHARGER, "0:ability:bore", "the picked blocker is removed from the battle (the other blocker stays) and is depleted but still in play", () => {
  const b = chargerBoard();
  chargerBlocked(b);
  assert.equal(isDepleted(b.engine, b.id("blk1")), false);
  bore(b, "blk1");
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("blk2")], "only the other blocker remains in the blocking party");
  assert.equal(isDepleted(b.engine, b.id("blk1")), true, "'Deplete it'");
  assert.equal(zoneOf(b.engine, b.id("blk1")), "play", "not destroyed: it stays in play");
  assert.equal(controllerOf(b.engine, b.id("blk1")), P2);
  assert.equal(isDepleted(b.engine, b.id("blk2")), false, "the other blocker is untouched");
});

clause(CHARGER, "0:ability:bore", "a removed blocker takes no part in the rest of the battle: it deals no damage and takes none", () => {
  const b = chargerBoard();
  chargerBlocked(b, ["blk1"]);
  bore(b, "blk1");
  autoResolveBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("atk")), "play", "the 4-strength blocker was removed before it could kill my 2-life attacker");
  assert.equal(damageOf(b.engine, b.id("atk")), 0);
  assert.equal(damageOf(b.engine, b.id("blk1")), 0, "and my attacker did not hurt it");
});

clause(CHARGER, "0:ability:bore", "removing the only blocker leaves the attacker with no blocker: its damage goes to the defending faction", () => {
  const b = chargerBoard();
  chargerBlocked(b, ["blk1"]);
  bore(b, "blk1");
  autoResolveBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), 30 - 3, "my 3-strength attacker hit the faction");
});

clause(CHARGER, "0:ability:bore", "when two blockers remain after the removal of one, the attacker's damage still goes to the remaining blocker, not the faction", () => {
  const b = chargerBoard();
  chargerBlocked(b);
  bore(b, "blk1");
  autoResolveBattle(b.engine);
  assert.equal(influenceOf(b.engine, P2), 30);
  assert.equal(damageOf(b.engine, b.id("blk2")), 3, "the attacker's 3 damage went to the remaining blocker");
});

clause(CHARGER, "0:ability:bore", "only a BLOCKING character can be picked: not my attacker, an idle character, an item, a location, a faction, a face-down card or a card in hand", () => {
  const extra: CardPlacement[] = [
    { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    ...volition(1, P2).map((placement) => ({ ...placement, key: "downCard" }))
  ];
  for (const bad of ["atk", "idle", "foeIdle", "thing", "place", "inHand", "downCard", "charger"]) {
    const b = chargerBoard({ extra });
    chargerBlocked(b, ["blk1"]);
    refused(() => actRaw(b.engine, P1, b.id("charger"), "bore", { b: [b.id(bad)] }), `picking ${bad}`);
    assert.equal(isDepleted(b.engine, b.id("charger")), false, "a refused use pays nothing");
  }
  const b = chargerBoard({ extra });
  chargerBlocked(b, ["blk1"]);
  refused(() => actRaw(b.engine, P1, b.id("charger"), "bore", { b: [factionOf(b.engine, P2)] }), "their faction (CR 202.9)");
  refused(() => actRaw(b.engine, P1, b.id("charger"), "bore", { b: [factionOf(b.engine, P1)] }), "my faction (CR 202.9)");
  bore(b, "blk1");
  assert.equal(isDepleted(b.engine, b.id("blk1")), true, "control: a blocking character is accepted");
});

clause(CHARGER, "0:ability:bore", "a blocker that was not declared as a blocker (blk2 stays out) cannot be picked", () => {
  const b = chargerBoard();
  chargerBlocked(b, ["blk1"]);
  refused(() => actRaw(b.engine, P1, b.id("charger"), "bore", { b: [b.id("blk2")] }), "blk2 is not blocking");
  assert.equal(isDepleted(b.engine, b.id("blk2")), false);
});

clause(CHARGER, "0:ability:bore", "exactly one blocker is picked: none or two are refused", () => {
  const b = chargerBoard();
  chargerBlocked(b);
  refused(() => actRaw(b.engine, P1, b.id("charger"), "bore", {}), "no declaration");
  refused(() => actRaw(b.engine, P1, b.id("charger"), "bore", { b: [] }), "an empty pick");
  refused(() => actRaw(b.engine, P1, b.id("charger"), "bore", { b: [b.id("blk1"), b.id("blk2")] }), "two picks");
  assert.equal(isDepleted(b.engine, b.id("charger")), false);
});

clause(CHARGER, "0:ability:bore", "with no battle, or before blockers are declared, there is no blocking character, so it cannot be used", () => {
  const none = chargerBoard();
  refused(() => actRaw(none.engine, P1, none.id("charger"), "bore", { b: [none.id("blk1")] }), "no battle");
  const early = chargerBoard();
  early.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [early.id("atk")], target: { type: "faction", playerId: P2 } });
  refused(() => actRaw(early.engine, P1, early.id("charger"), "bore", { b: [early.id("blk1")] }), "blockers not yet declared");
  assert.equal(isDepleted(early.engine, early.id("charger")), false);
});

clause(CHARGER, "0:ability:bore", "it is refused when the Charger is already depleted, and when I have fewer than 3 resources", () => {
  const tired = chargerBoard({ chargerDepleted: true });
  chargerBlocked(tired);
  refused(() => actRaw(tired.engine, P1, tired.id("charger"), "bore", { b: [tired.id("blk1")] }), "Charger depleted");
  assert.deepEqual(battleOf(tired.engine)?.blockingParty, [tired.id("blk1"), tired.id("blk2")]);
  const poor = chargerBoard({ icons: { rage: 2 } });
  chargerBlocked(poor);
  refused(() => actRaw(poor.engine, P1, poor.id("charger"), "bore", { b: [poor.id("blk1")] }), "only 2 resources");
  assert.equal(isDepleted(poor.engine, poor.id("charger")), false, "nothing was paid or depleted");
  assert.equal(ready(poor.engine), 2);
});

clause(CHARGER, "0:ability:bore", "an attacker that has attacked is depleted, so a Charger that itself attacked cannot BORE", () => {
  const b = devBoard(
    [
      { key: "charger", def: printing(CHARGER), owner: P1, zone: "play" },
      { key: "blk1", def: character({ name: "Blocker1", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...res({ rage: 5 })
    ],
    { turn: 2 }
  );
  declareAttackBy(b.engine, P1, [b.id("charger")]);
  declareBlockers(b.engine, P2, [b.id("blk1")]);
  refused(() => actRaw(b.engine, P1, b.id("charger"), "bore", { b: [b.id("blk1")] }), "the attacking Charger is depleted");
});

clause(CHARGER, "0:ability:bore", "'a blocking character' includes my own: as the defender I may pick one of my own blockers", () => {
  const b = devBoard(
    [
      { key: "charger", def: printing(CHARGER), owner: P1, zone: "play" },
      { key: "k1", def: character({ name: "K1", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      ...res({ rage: 5 })
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("k1")]);
  if (b.engine.state.priorityPlayerId !== P1) b.engine.perform({ type: "passPriority", playerId: b.engine.state.priorityPlayerId });
  activate(b.engine, P1, b.id("charger"), "bore", { selected: { b: [b.id("k1")] } });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, []);
  assert.equal(isDepleted(b.engine, b.id("k1")), true);
});

clause(CHARGER, "0:ability:bore", "if the picked blocker is destroyed in response, BORE resolves harmlessly and the costs stay paid", () => {
  const b = chargerBoard({ extra: [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  chargerBlocked(b);
  actRaw(b.engine, P1, b.id("charger"), "bore", { b: [b.id("blk2")] });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("blk2")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("blk2")), "discard");
  assert.equal(isDepleted(b.engine, b.id("charger")), true);
  assert.equal(pending(b.engine), undefined);
});

clause(CHARGER, "0:ability:bore", "only its controller can use it", () => {
  const b = chargerBoard({ extra: [...res({ rage: 5 }, P2)] });
  chargerBlocked(b);
  b.engine.perform({ type: "passPriority", playerId: P1 });
  assert.equal(b.engine.state.priorityPlayerId, P2);
  refused(() => actRaw(b.engine, P2, b.id("charger"), "bore", { b: [b.id("blk1")] }), "the opponent using my Charger", /control|own|cannot|illegal|only|usable|available/i);
});

// --- Balking Foecrusher ------------------------------------------------------
// If this card leaves play, inflict 1 damage to all characters and draw a card. --
// CRUSH WAVE -- COST: Pay 2. Destroy this card. -- EFFECT: Inflict 1 damage to all
// characters. Character (soldier), cost 4, [R][R], 2 strength / 3 speed / 2 life.

const FOECRUSHER = "0e93d480-f1ed-4752-8f2c-b5b169a229ca";

interface CrushOpts {
  icons?: Icons;
  extra?: CardPlacement[];
  deck?: number;
  active?: PlayerId;
  fcZone?: Zone;
  fcFaceDown?: boolean;
  fcController?: PlayerId;
  fcOwner?: PlayerId;
  fcDepleted?: boolean;
}

/** Characters: mine my1 (life 1) / my3 (life 3); theirs foe1 (life 1) / foe2 (life 2) / foe4 (life 4). Also an item, a location and decks. */
function crushBoard(o: CrushOpts = {}) {
  return devBoard(
    [
      { key: "fc", def: printing(FOECRUSHER), owner: o.fcOwner ?? P1, controller: o.fcController, zone: o.fcZone ?? "play", faceDown: o.fcFaceDown, depleted: o.fcDepleted },
      { key: "my1", def: character({ name: "My1", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "my3", def: character({ name: "My3", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe1", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe4", def: character({ name: "Foe4", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 4 }), owner: P2, zone: "play" },
      ...deckCards("a", o.deck ?? 3, P1),
      ...deckCards("b", 3, P2),
      ...res(o.icons ?? { rage: 4 }),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active }
  );
}

/** Asserts the whole "1 damage to all characters" outcome of ONE trigger or ONE wave, with the Foecrusher gone. */
function assertOneDamageToAll(b: ReturnType<typeof crushBoard>, why: string): void {
  for (const key of ["my1", "foe1"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${why}: a 1-life character is destroyed`);
  assert.equal(damageOf(b.engine, b.id("my3")), 1, `${why}: my 3-life character has 1 damage`);
  assert.equal(damageOf(b.engine, b.id("foe2")), 1, `${why}: their 2-life character has 1 damage`);
  assert.equal(damageOf(b.engine, b.id("foe4")), 1, `${why}: their 4-life character has 1 damage`);
  assert.equal(damageOf(b.engine, b.id("thing")), 0, `${why}: an item takes no damage`);
  assert.equal(damageOf(b.engine, b.id("place")), 0, `${why}: a location takes no damage`);
  assert.equal(influenceOf(b.engine, P1), 30, `${why}: my faction is not damaged`);
  assert.equal(influenceOf(b.engine, P2), 30, `${why}: their faction is not damaged`);
}

const bounceAny = (): CardDefinition =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });

const removeAny = (): CardDefinition =>
  tactic({
    name: "Remover",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** Plays tactic `key` (mine) on the Foecrusher. */
const hitFoecrusher = (b: ReturnType<typeof crushBoard>, key = "tac", player: PlayerId = P1): void =>
  play(b.engine, player, b.id(key), { selected: { t: [b.id("fc")] } });

clause(FOECRUSHER, "0:rule", "deploys for its printed cost of 4 with [R][R], is refused without the threshold, and has 2 strength / 3 speed / 2 life", () => {
  headerChecks((icons) => devBoard([{ key: "fc", def: printing(FOECRUSHER), owner: P1, zone: "hand" }, ...res(icons)]), "fc", { icon: "rage", threshold: 2, cost: 4, lands: "play" });
  const b = crushBoard();
  assert.deepEqual(stats(b.engine, b.id("fc")), { strength: 2, life: 2, speed: 3 });
});

clause(FOECRUSHER, "0:rule", "destroyed: 1 damage to all characters (mine and theirs, not items, locations or factions) and its controller draws a card", () => {
  const b = crushBoard({ extra: [{ key: "tac", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  const top = deckOf(b.engine, P1)[0];
  hitFoecrusher(b);
  assert.equal(zoneOf(b.engine, b.id("fc")), "discard");
  assertOneDamageToAll(b, "destroyed");
  assert.equal(zoneOf(b.engine, top), "hand", "the top card of my deck was drawn");
  assert.equal(handOf(b.engine, P1).length, 1, "the tactic left my hand, one card arrived");
  assert.equal(deckOf(b.engine, P1).length, 2, "exactly one card was drawn");
  assert.equal(handOf(b.engine, P2).length, 0, "the opponent draws nothing");
});

clause(FOECRUSHER, "0:rule", "lethal damage: dying to damage also triggers it (a 2-damage zap destroys the 2-life Foecrusher)", () => {
  const b = crushBoard({ extra: [{ key: "tac", def: zapTactic("Zap2", 2), owner: P1, zone: "hand" }] });
  hitFoecrusher(b);
  assert.equal(zoneOf(b.engine, b.id("fc")), "discard");
  assertOneDamageToAll(b, "killed by damage");
  assert.equal(handOf(b.engine, P1).length, 1);
});

clause(FOECRUSHER, "0:rule", "'leaves play' is any way: returned to its owner's hand also triggers the damage and the draw", () => {
  const b = crushBoard({ extra: [{ key: "tac", def: bounceAny(), owner: P1, zone: "hand" }] });
  const top = deckOf(b.engine, P1)[0];
  hitFoecrusher(b);
  assert.equal(zoneOf(b.engine, b.id("fc")), "hand", "bounced to hand");
  assertOneDamageToAll(b, "bounced");
  assert.equal(zoneOf(b.engine, top), "hand", "I drew the top card");
  assert.equal(handOf(b.engine, P1).length, 2, "the Foecrusher and the drawn card (the tactic is spent)");
});

clause(FOECRUSHER, "0:rule", "'leaves play' is any way: removed from the game also triggers the damage and the draw", () => {
  const b = crushBoard({ extra: [{ key: "tac", def: removeAny(), owner: P1, zone: "hand" }] });
  const top = deckOf(b.engine, P1)[0];
  hitFoecrusher(b);
  assert.equal(zoneOf(b.engine, b.id("fc")), "removed");
  assertOneDamageToAll(b, "removed from the game");
  assert.equal(zoneOf(b.engine, top), "hand");
});

clause(FOECRUSHER, "0:rule", "the Foecrusher is already gone when the damage is inflicted, so it takes none (it is not a character in play)", () => {
  const b = crushBoard({ extra: [{ key: "tac", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  hitFoecrusher(b);
  assert.equal(damageOf(b.engine, b.id("fc")), 0);
});

clause(FOECRUSHER, "0:rule", "when the OPPONENT destroys my Foecrusher, I (its controller) draw and the damage still hits everyone", () => {
  const b = crushBoard({ active: P2, extra: [{ key: "tac", def: killAnyTactic("character"), owner: P2, zone: "hand" }] });
  const top = deckOf(b.engine, P1)[0];
  hitFoecrusher(b, "tac", P2);
  assert.equal(zoneOf(b.engine, top), "hand", "I drew");
  assert.equal(handOf(b.engine, P2).length, 0, "they did not");
  assertOneDamageToAll(b, "destroyed by the opponent");
});

clause(FOECRUSHER, "0:rule", "a Foecrusher the opponent owns but I control draws a card for me, its controller, when it leaves play", () => {
  const b = crushBoard({ fcOwner: P2, fcController: P1, extra: [{ key: "tac", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  const top = deckOf(b.engine, P1)[0];
  const oppTop = deckOf(b.engine, P2)[0];
  hitFoecrusher(b);
  assert.equal(zoneOf(b.engine, b.id("fc")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("fc")), "it goes to its owner's discard pile");
  assert.equal(zoneOf(b.engine, top), "hand", "I (its controller) drew");
  assert.equal(zoneOf(b.engine, oppTop), "deck", "its owner did not");
});

clause(FOECRUSHER, "0:rule", "it triggers only when THIS card leaves play: another character dying causes no damage and no draw", () => {
  const b = crushBoard({ extra: [{ key: "tac", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("tac"), { selected: { t: [b.id("my3")] } });
  assert.equal(zoneOf(b.engine, b.id("my3")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fc")), "play");
  assert.equal(damageOf(b.engine, b.id("fc")), 0);
  assert.equal(damageOf(b.engine, b.id("foe4")), 0);
  assert.equal(handOf(b.engine, P1).length, 0, "no card drawn");
});

clause(FOECRUSHER, "0:rule", "a face-down Foecrusher is a resource with no rules text: when it leaves play there is no damage and no draw", () => {
  const b = crushBoard({ fcFaceDown: true, extra: [{ key: "tac", def: killAnyTactic("resource"), owner: P1, zone: "hand" }] });
  hitFoecrusher(b);
  assert.equal(zoneOf(b.engine, b.id("fc")), "discard");
  assert.equal(damageOf(b.engine, b.id("foe4")), 0);
  assert.equal(zoneOf(b.engine, b.id("my1")), "play");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(FOECRUSHER, "0:rule", "with an empty deck the damage is still inflicted and nothing is drawn (not a loss)", () => {
  const b = crushBoard({ deck: 0, extra: [{ key: "tac", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  hitFoecrusher(b);
  assertOneDamageToAll(b, "empty deck");
  assert.equal(handOf(b.engine, P1).length, 0);
  assert.equal(b.engine.state.winner, undefined);
});

clause(FOECRUSHER, "0:rule", "'all characters' includes another Foecrusher: a second one takes 1 damage when the first leaves play", () => {
  const b = crushBoard({ extra: [{ key: "fc2", def: printing(FOECRUSHER), owner: P1, zone: "play" }, { key: "tac", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  hitFoecrusher(b);
  assert.equal(damageOf(b.engine, b.id("fc2")), 1, "the other Foecrusher (2 life) took 1 damage");
  assert.equal(zoneOf(b.engine, b.id("fc2")), "play");
});

clause(FOECRUSHER, "0:rule", "two Foecrushers dying together: each triggers its own damage and draw", () => {
  const sweep = tactic({
    name: "Sweep Foecrushers",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sw",
          type: "activated",
          effects: [{ type: "forEach", selector: { type: "character", name: "Balking Foecrusher" }, effects: [{ type: "destroy", target: { type: "selected", id: "__candidate" } }] }]
        }
      ]
    }
  });
  const b = crushBoard({ icons: { rage: 4 }, extra: [{ key: "fc2", def: printing(FOECRUSHER), owner: P1, zone: "play" }, { key: "sweep", def: sweep, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("sweep"), {});
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("fc")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fc2")), "discard");
  assert.equal(handOf(b.engine, P1).length, 2, "two cards drawn, one for each Foecrusher");
  assert.equal(damageOf(b.engine, b.id("foe4")), 2, "two instances of 1 damage");
});

// CRUSH WAVE

clause(FOECRUSHER, "1:ability:crush-wave", "pays exactly 2 resources and destroys this card as costs, when it is used", () => {
  const b = crushBoard();
  const before = ready(b.engine);
  actRaw(b.engine, P1, b.id("fc"), "crush-wave");
  assert.equal(before - ready(b.engine), 2, "2 paid");
  assert.equal(zoneOf(b.engine, b.id("fc")), "discard", "destroyed as a cost");
});

clause(FOECRUSHER, "1:ability:crush-wave", "the leave-play trigger from the cost resolves before the opponent can respond (CR 606.1e): 1 damage and the draw are already done, the wave's own damage is not", () => {
  const b = crushBoard();
  const top = deckOf(b.engine, P1)[0];
  actRaw(b.engine, P1, b.id("fc"), "crush-wave");
  assert.ok(b.engine.state.responseWindow, "the opponent may respond");
  assert.equal(damageOf(b.engine, b.id("foe4")), 1, "only the trigger's 1 damage so far");
  assert.equal(zoneOf(b.engine, top), "hand", "the trigger's draw happened");
});

clause(FOECRUSHER, "1:ability:crush-wave", "in total each character takes 2 damage (the trigger's 1 and the wave's 1): 2-life characters die, 3- and 4-life ones survive with 2 damage", () => {
  const b = crushBoard();
  activate(b.engine, P1, b.id("fc"), "crush-wave");
  for (const key of ["my1", "foe1", "foe2"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} (life 1 or 2) is destroyed by 2 damage`);
  assert.equal(damageOf(b.engine, b.id("my3")), 2);
  assert.equal(damageOf(b.engine, b.id("foe4")), 2);
  assert.equal(damageOf(b.engine, b.id("thing")), 0);
  assert.equal(damageOf(b.engine, b.id("place")), 0);
  assert.equal(influenceOf(b.engine, P1), 30);
  assert.equal(influenceOf(b.engine, P2), 30);
});

clause(FOECRUSHER, "1:ability:crush-wave", "exactly one card is drawn in total: the leave-play trigger draws, the wave itself does not", () => {
  const b = crushBoard();
  activate(b.engine, P1, b.id("fc"), "crush-wave");
  assert.equal(handOf(b.engine, P1).length, 1);
  assert.equal(deckOf(b.engine, P1).length, 2);
  assert.equal(handOf(b.engine, P2).length, 0);
});

clause(FOECRUSHER, "1:ability:crush-wave", "the wave's damage hits a character that enters play in response, once (the trigger had already resolved)", () => {
  const tactical = character({ name: "Tactical Newcomer", cost: 0, strength: 1, life: 4, speed: 1, behavior: { keywords: ["tactical"] } });
  const b = crushBoard({ active: P1, extra: [{ key: "newcomer", def: tactical, owner: P2, zone: "hand" }] });
  actRaw(b.engine, P1, b.id("fc"), "crush-wave");
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("newcomer"), selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("newcomer")), "play");
  assert.equal(damageOf(b.engine, b.id("newcomer")), 1, "only the wave's 1 damage: the trigger's damage was inflicted before it existed");
});

clause(FOECRUSHER, "1:ability:crush-wave", "it is refused with fewer than 2 resources, and then the Foecrusher is NOT destroyed", () => {
  const b = crushBoard({ icons: { rage: 1 } });
  refused(() => actRaw(b.engine, P1, b.id("fc"), "crush-wave"), "only 1 resource");
  assert.equal(zoneOf(b.engine, b.id("fc")), "play");
  assert.equal(ready(b.engine), 1);
  assert.equal(damageOf(b.engine, b.id("foe4")), 0);
  const exact = crushBoard({ icons: { rage: 2 } });
  activate(exact.engine, P1, exact.id("fc"), "crush-wave");
  assert.equal(zoneOf(exact.engine, exact.id("fc")), "discard", "control: exactly 2 resources is enough");
});

clause(FOECRUSHER, "1:ability:crush-wave", "any 2 resources pay for it: no threshold on the ability", () => {
  const b = crushBoard({ icons: { greed: 2 } });
  activate(b.engine, P1, b.id("fc"), "crush-wave");
  assert.equal(zoneOf(b.engine, b.id("fc")), "discard");
});

clause(FOECRUSHER, "1:ability:crush-wave", "it works while the Foecrusher is depleted (no deplete cost)", () => {
  const b = crushBoard({ fcDepleted: true });
  activate(b.engine, P1, b.id("fc"), "crush-wave");
  assert.equal(zoneOf(b.engine, b.id("fc")), "discard");
  assert.equal(damageOf(b.engine, b.id("foe4")), 2);
});

clause(FOECRUSHER, "1:ability:crush-wave", "only its controller can use it", () => {
  const b = crushBoard({ extra: [...res({ rage: 4 }, P2)] });
  declareAttackOpenWindow(b.engine, P1, [b.id("my3")]);
  refused(() => actRaw(b.engine, P2, b.id("fc"), "crush-wave"), "the opponent using my Foecrusher", /control|own|cannot|illegal|only|usable|available/i);
  assert.equal(zoneOf(b.engine, b.id("fc")), "play");
});

// --- Blazing Shriever --------------------------------------------------------
// INFLAME -- COST: Pay 2. Destroy this card. Pick a character or location. --
// EFFECT: Inflict X damage to the character or location, where X is the number of
// [R] you control. Character (dragon), cost 3, [R], 2 strength / 3 speed / 1 life.

const SHRIEVER = "8c45da38-c37a-41cc-8205-ac2b50fa8fd4";

function shrieverBoard(o: { icons?: Icons; extra?: CardPlacement[]; depleted?: boolean } = {}) {
  return devBoard([
    { key: "sh", def: printing(SHRIEVER), owner: P1, zone: "play", depleted: o.depleted },
    { key: "mine", def: character({ name: "Mine", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
    { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 2, speed: 1 }), owner: P2, zone: "play" },
    { key: "foe5", def: character({ name: "Foe5", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place", structure: 3 }), owner: P2, zone: "play" },
    { key: "myPlace", def: location({ name: "MyPlace", structure: 6 }), owner: P1, zone: "play" },
    { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
    ...res(o.icons ?? { rage: 5 }),
    ...(o.extra ?? [])
  ]);
}

const inflame = (b: ReturnType<typeof shrieverBoard>, picked: string) => activate(b.engine, P1, b.id("sh"), "inflame", { selected: { t: [b.id(picked)] } });

clause(SHRIEVER, "0:ability:inflame", "deploys for its printed cost of 3 with [R], is refused without it, and has 2 strength / 3 speed / 1 life", () => {
  headerChecks((icons) => devBoard([{ key: "sh", def: printing(SHRIEVER), owner: P1, zone: "hand" }, ...res(icons)]), "sh", { icon: "rage", threshold: 1, cost: 3, lands: "play" });
  const b = shrieverBoard();
  assert.deepEqual(stats(b.engine, b.id("sh")), { strength: 2, life: 1, speed: 3 });
});

clause(SHRIEVER, "0:ability:inflame", "the costs are paid when it is used: 2 resources and this card destroyed, before the opponent can respond; the damage waits for resolution", () => {
  const b = shrieverBoard();
  const before = ready(b.engine);
  actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [b.id("foe5")] });
  assert.equal(before - ready(b.engine), 2, "2 paid");
  assert.equal(zoneOf(b.engine, b.id("sh")), "discard", "destroyed as a cost");
  assert.equal(damageOf(b.engine, b.id("foe5")), 0, "no damage yet");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe5")), "discard", "5 [R] deal 5 damage, which destroys the 5-life character");
});

clause(SHRIEVER, "0:ability:inflame", "X is the number of [R] I control: 2, 3, 4 and 5 [R] deal 2, 3, 4 and 5 damage to the picked character", () => {
  for (const rage of [2, 3, 4, 5]) {
    const b = shrieverBoard({ icons: { rage } });
    inflame(b, "foe5");
    const expected = rage;
    if (expected >= 5) assert.equal(zoneOf(b.engine, b.id("foe5")), "discard", "5 damage kills the 5-life character");
    else assert.equal(damageOf(b.engine, b.id("foe5")), expected, `${rage} [R] deal ${expected}`);
  }
});

clause(SHRIEVER, "0:ability:inflame", "only [R] count: other icons add nothing (three [R] beside plenty of other resources deal exactly 3)", () => {
  const b = shrieverBoard({ icons: { rage: 3, greed: 3, elitism: 2, deception: 2, obsession: 2 } });
  inflame(b, "foe5");
  assert.equal(damageOf(b.engine, b.id("foe5")), 3);
});

clause(SHRIEVER, "0:ability:inflame", "the [R] spent on the cost are still controlled and still counted", () => {
  const b = shrieverBoard({ icons: { rage: 2 } });
  inflame(b, "foe5");
  assert.equal(damageOf(b.engine, b.id("foe5")), 2, "both [R] were paid and both still count");
});

clause(SHRIEVER, "0:ability:inflame", "[R] already spent before (attached to the faction) count too", () => {
  const b = shrieverBoard({ icons: { rage: 2 }, extra: spentRes("s", "rage", 2) });
  inflame(b, "foe5");
  assert.equal(damageOf(b.engine, b.id("foe5")), 4, "2 ready + 2 spent");
});

clause(SHRIEVER, "0:ability:inflame", "the opponent's [R] and my face-down cards (Volition) do not count", () => {
  const b = shrieverBoard({ icons: { rage: 2 }, extra: [...res({ rage: 4 }, P2), ...volition(3, P1)] });
  inflame(b, "foe5");
  assert.equal(damageOf(b.engine, b.id("foe5")), 2);
});

clause(SHRIEVER, "0:ability:inflame", "X is judged when the ability resolves: an [R] destroyed in response lowers the damage", () => {
  const b = shrieverBoard({ icons: { rage: 4 }, extra: [{ key: "kill", def: killAnyTactic("resource"), owner: P2, zone: "hand" }] });
  const rageId = playOf(b.engine, P1).find((cardId) => b.engine.isResource(cardId))!;
  actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [b.id("foe5")] });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [rageId] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, rageId), "discard", "one [R] was destroyed in response");
  assert.equal(damageOf(b.engine, b.id("foe5")), 3, "X is 3 when it resolves");
});

clause(SHRIEVER, "0:ability:inflame", "with no [R] at all (two Greed pay for it) X is 0 and nothing is damaged, though the cost is still paid", () => {
  const b = shrieverBoard({ icons: { greed: 2 } });
  inflame(b, "foe2");
  assert.equal(damageOf(b.engine, b.id("foe2")), 0);
  assert.equal(zoneOf(b.engine, b.id("foe2")), "play");
  assert.equal(zoneOf(b.engine, b.id("sh")), "discard", "the Shriever was destroyed anyway");
});

clause(SHRIEVER, "0:ability:inflame", "a character takes the damage and is destroyed when it is at least its life: X = 5 kills a 2-life and a 5-life character, X = 3 kills only the 2-life one", () => {
  const five = shrieverBoard({ icons: { rage: 5 } });
  inflame(five, "foe2");
  assert.equal(zoneOf(five.engine, five.id("foe2")), "discard");
  const three = shrieverBoard({ icons: { rage: 3 } });
  inflame(three, "foe2");
  assert.equal(zoneOf(three.engine, three.id("foe2")), "discard");
  const spare = shrieverBoard({ icons: { rage: 3 } });
  inflame(spare, "foe5");
  assert.equal(zoneOf(spare.engine, spare.id("foe5")), "play");
});

clause(SHRIEVER, "0:ability:inflame", "a location takes X damage markers and is destroyed at its structure: X = 3 destroys a structure-3 location, X = 2 only damages it", () => {
  const three = shrieverBoard({ icons: { rage: 3 } });
  inflame(three, "place");
  assert.equal(zoneOf(three.engine, three.id("place")), "discard");
  const two = shrieverBoard({ icons: { rage: 2 } });
  inflame(two, "place");
  assert.equal(zoneOf(two.engine, two.id("place")), "play");
  assert.equal(damageOf(two.engine, two.id("place")), 2);
});

clause(SHRIEVER, "0:ability:inflame", "my own character or location may be picked too", () => {
  const c = shrieverBoard({ icons: { rage: 3 } });
  inflame(c, "mine");
  assert.equal(damageOf(c.engine, c.id("mine")), 3);
  const l = shrieverBoard({ icons: { rage: 3 } });
  inflame(l, "myPlace");
  assert.equal(damageOf(l.engine, l.id("myPlace")), 3);
});

clause(SHRIEVER, "0:ability:inflame", "only the picked card is damaged: the others (including the other characters and locations) are untouched", () => {
  const b = shrieverBoard({ icons: { rage: 3 } });
  inflame(b, "foe5");
  for (const key of ["mine", "foe2", "place", "myPlace", "thing"]) assert.equal(damageOf(b.engine, b.id(key)), 0, `${key} is untouched`);
});

clause(SHRIEVER, "0:ability:inflame", "only a character or location in play can be picked: not an item, faction, face-down card, or a card in hand, deck or discard pile", () => {
  const extra: CardPlacement[] = [
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
    { key: "inDeck", def: character({ name: "InDeck" }), owner: P2, zone: "deck" },
    ...volition(1, P2).map((placement) => ({ ...placement, key: "downCard" }))
  ];
  for (const bad of ["thing", "inHand", "inDiscard", "inDeck", "downCard"]) {
    const b = shrieverBoard({ extra });
    refused(() => actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [b.id(bad)] }), `picking ${bad}`);
    assert.equal(zoneOf(b.engine, b.id("sh")), "play", "a refused use pays nothing and destroys nothing");
  }
  const b = shrieverBoard({ extra });
  refused(() => actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [factionOf(b.engine, P2)] }), "their faction (CR 202.9)");
  refused(() => actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [factionOf(b.engine, P1)] }), "my faction (CR 202.9)");
  inflame(b, "foe5");
  assert.equal(zoneOf(b.engine, b.id("foe5")), "discard", "control: a character is accepted (5 [R] deal 5 damage to the 5-life character)");
});

clause(SHRIEVER, "0:ability:inflame", "exactly one card is picked: none or two are refused", () => {
  const b = shrieverBoard();
  refused(() => actRaw(b.engine, P1, b.id("sh"), "inflame", {}), "no declaration");
  refused(() => actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [] }), "an empty pick");
  refused(() => actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [b.id("foe2"), b.id("place")] }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
});

clause(SHRIEVER, "0:ability:inflame", "'Destroy this card' comes before 'Pick a character': the Shriever, already destroyed by the cost, cannot be the pick", () => {
  const b = shrieverBoard();
  refused(() => actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [b.id("sh")] }), "picking the Shriever itself");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play", "a refused use destroys nothing");
  assert.equal(ready(b.engine), 5, "and pays nothing");
});

clause(SHRIEVER, "0:ability:inflame", "if the picked character is destroyed in response, INFLAME resolves harmlessly (the costs stay paid)", () => {
  const b = shrieverBoard({ extra: [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [b.id("foe5")] });
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("foe5")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe5")), "discard");
  assert.equal(zoneOf(b.engine, b.id("sh")), "discard");
  assert.equal(pending(b.engine), undefined);
});

clause(SHRIEVER, "0:ability:inflame", "it is refused with fewer than 2 resources, and then the Shriever is NOT destroyed", () => {
  const b = shrieverBoard({ icons: { rage: 1 } });
  refused(() => actRaw(b.engine, P1, b.id("sh"), "inflame", { t: [b.id("foe5")] }), "only 1 resource");
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
  assert.equal(ready(b.engine), 1);
  const exact = shrieverBoard({ icons: { rage: 2 } });
  inflame(exact, "foe5");
  assert.equal(zoneOf(exact.engine, exact.id("sh")), "discard", "control: exactly 2 resources is enough");
});

clause(SHRIEVER, "0:ability:inflame", "it works while the Shriever is depleted (no deplete cost)", () => {
  const b = shrieverBoard({ depleted: true });
  inflame(b, "foe5");
  assert.equal(zoneOf(b.engine, b.id("sh")), "discard");
  assert.equal(zoneOf(b.engine, b.id("foe5")), "discard", "5 [R] deal 5 damage to the 5-life character");
});

clause(SHRIEVER, "0:ability:inflame", "only its controller can use it", () => {
  const b = shrieverBoard({ extra: [...res({ rage: 4 }, P2)] });
  declareAttackOpenWindow(b.engine, P1, [b.id("mine")]);
  refused(() => actRaw(b.engine, P2, b.id("sh"), "inflame", { t: [b.id("mine")] }), "the opponent using my Shriever", /control|own|cannot|illegal|only|usable|available/i);
  assert.equal(zoneOf(b.engine, b.id("sh")), "play");
});

