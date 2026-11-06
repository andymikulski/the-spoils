// Clause tests -- batch decade-of-deckadence-03. See docs/TESTING.md and
// `npm run card-tests -- manifest decade-of-deckadence-03`. Expectations come from each card's PRINTED text
// (markup) and RULES.md / the Comprehensive Rules; engine data (ability ids, declaration ids, choice kinds) is
// only used to drive the engine. Several cards here are word-for-word reprints of older printings (H07 P3pp3r,
// Luteoderm Prototype, Micromajig Master, Inadequate Wand, Gargoyle of Cathedrale de Mau, Iohane): their checks
// were written from the same printed words in the older batches and are carried over (each block is scoped).

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
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
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused, flipUpNow, holdFlipUp, holdResourceFace } from "./_clause.js";
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
  fightThrough,
  finishBattle,
  playRaw
} from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import {
  attachedCount,
  barrenFaction,
  developDraw,
  developOffers,
  developResource,
  endTurn,
  endTurnRaw,
  factionOf,
  openDevelopPlay,
  settleStartFirst
} from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

type Pid = typeof P1 | typeof P2;
type Icon = StapleIcon;
const attackRaw = (engine: SpoilsEngine, player: PlayerId, attackerIds: CardInstanceId[]): void =>
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target: { type: "faction", playerId: player === P1 ? P2 : P1 } });

// ---- ported from seed-05.test.ts (H07 P3pp3r) ----
{

type Icons = Partial<Record<StapleIcon, number>>;
type IdOf = (key: string) => CardInstanceId;

/** Staple resources for `owner`, e.g. `res({ elitism: 2, greed: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

const handOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].discard;
const ready = (engine: SpoilsEngine, player: PlayerId = P1) => engine.getAvailableResourceCount(player);
const influenceOf = (engine: SpoilsEngine, player: PlayerId = P1) => engine.state.players[player].influence;
const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;

/** `n` vanilla characters in `owner`'s zone, keyed `<prefix>0..n-1` (a deck's first key is its top card). */
function cards(prefix: string, n: number, owner: PlayerId, zone: "deck" | "hand" | "discard" | "play"): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()}${i}` }), owner, zone }));
}

/** The default test faction restores depleted non-resource cards at the start of its controller's turn; this one does not, so a restore the card under test performs is visible. */
function holdFaction(): CardDefinition {
  const faction = developFaction();
  faction.faction!.turn.restore.restoreNonResources = false;
  return faction;
}

/** Answers the open pending choice (asserting its kind and who answers it), then drains response windows. */
function answerBy(engine: SpoilsEngine, kind: string, playerId: PlayerId, choice: Record<string, unknown>): void {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}`);
  assert.equal(pc.kind, kind, "pending choice kind");
  assert.equal(pc.playerId, playerId, `${kind} must be answered by ${playerId}`);
  answerPending(engine, kind, choice);
}

/** Resolves the open `chooserSelectsTarget` with `selected` — no draining, for use under `refused`. */
const tryPick = (engine: SpoilsEngine, playerId: PlayerId, selected: CardInstanceId[]) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);

/** Answers every `chooserSelectsTarget` with `ids`, accepts nothing else (`declineAll`). */
const picking = (ids: CardInstanceId[]) => (pc: PendingChoiceLike) =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: ids } : declineAll(pc);

/** Accepts every `mayPay`, declines everything else. */
const payYes = (pc: PendingChoiceLike): unknown => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc));

/** Answers `chooserSelectsOption` prompts by label (the "may" prompts of this set offer "Decline" and an action). */
const optionIndex = (pc: PendingChoiceLike, accept: boolean): number => {
  const labels = (pc.options as Array<{ label: string }>).map((o) => o.label);
  return accept ? labels.findIndex((l) => l !== "Decline") : labels.indexOf("Decline");
};

/** Drains pending choices with `answer`, returning everything asked as "<player>:<kind>". */
function drainRecording(engine: SpoilsEngine, answer: (pc: PendingChoiceLike) => unknown): string[] {
  const seen: string[] = [];
  drain(engine, (pc) => {
    seen.push(`${pc.playerId}:${pc.kind}`);
    return answer(pc);
  });
  return seen;
}

/** The OTHER player ends their turn, so it is `player`'s turn that starts; every prompt of that turn start is answered with `answer` and recorded. */
function startTurnOf(engine: SpoilsEngine, player: PlayerId, answer: (pc: PendingChoiceLike) => unknown = declineAll): string[] {
  endTurn(engine, other(player));
  assert.equal(engine.state.activePlayerId, player, "the turn has changed hands");
  return drainRecording(engine, answer);
}

/** The ids of every character in play `player` controls. */
function charactersOf(engine: SpoilsEngine, player: PlayerId): CardInstanceId[] {
  return engine.state.players[player].play.filter(
    (cardId) => engine.state.cards[cardId].controllerId === player && engine.getCardTypes(cardId).includes("character") && !engine.state.cards[cardId].faceDown
  );
}

/** Synthetic helper cards -------------------------------------------------------- */

/** A free tactic that destroys one chosen card in play (id `kill`, declaration `t`). */
const killAny = (type: "character" | "item" | "location" | "resource" = "character"): CardDefinition =>
  tactic({
    name: `Kill ${type}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

/** A free tactic that puts one chosen character into its owner's hand (id `b`, declaration `t`). */
const bounceChar = (): CardDefinition =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        { id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }
      ]
    }
  });

/** A free tactic that removes one chosen character from the game (id `r`, declaration `t`). */
const exileChar = (): CardDefinition =>
  tactic({
    name: "Exile",
    cost: 0,
    behavior: {
      abilities: [
        { id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

/** A free tactic that turns one chosen character face-down (id `f`, declaration `t`). */
const flipDownChar = (): CardDefinition =>
  tactic({
    name: "Flip Down",
    cost: 0,
    behavior: {
      abilities: [
        { id: "f", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }
      ]
    }
  });

/** A free tactic that takes control of one chosen card in play for its controller (id `s`, declaration `t`). */
const stealChar = (): CardDefinition =>
  tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        { id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }
      ]
    }
  });

/** A free tactic that gives one chosen character COVERT this turn (id `g`, declaration `t`). */
const grantCovert = (): CardDefinition =>
  tactic({
    name: "Grant Covert",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "g",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

/** An item with a cost-`cost` threshold-`threshold` requirement and no text (a gate for threshold checks). */
const gate = (threshold: string, cost = 0): CardDefinition => item({ name: `Gate ${threshold}`, cost, threshold });

/** All of an engine's token Micromajig characters under `player`'s control. */
function micromajigs(engine: SpoilsEngine, player: PlayerId): CardInstanceId[] {
  return engine.state.players[player].play.filter(
    (cardId) => engine.state.cards[cardId].controllerId === player && engine.getDefinition(cardId).name === "Micromajig"
  );
}

/** Asserts the card is a proper Micromajig token (CR 409.3c: a Gearsmith character, majig subtype, 1 strength / 1 life / 3 speed). */
function assertMicromajig(engine: SpoilsEngine, cardId: CardInstanceId, controller: PlayerId): void {
  const def = engine.getDefinition(cardId);
  assert.equal(def.name, "Micromajig");
  assert.equal(def.type, "character", "a Micromajig is a character");
  assert.equal(def.trade, "gearsmith", "a Micromajig is a Gearsmith card (CR 409.3c)");
  assert.ok(def.subtype.includes("majig"), "a Micromajig has the majig subtype (CR 409.3c)");
  assert.equal(engine.getStat(cardId, "strength"), 1);
  assert.equal(engine.getStat(cardId, "life"), 1);
  assert.equal(engine.getStat(cardId, "speed"), 3);
  assert.equal(engine.state.cards[cardId].controllerId, controller);
  assert.equal(engine.state.cards[cardId].zone, "play");
}

/**
 * Deploy basics for a card with no extra cost: it is refused with no resources, refused one resource short of its
 * printed cost, refused when the cost is covered but the threshold's icons are not, and with exactly the cost +
 * threshold it enters play paying exactly `cost`. Also refused on the opponent's turn (characters / items /
 * locations only deploy on their controller's own turn). Pending "may pay" prompts after entering are declined.
 */
function deployChecks(printingId: string, o: { cost: number; icon: StapleIcon; icons: number; type: "character" | "item" | "location" }): void {
  const board = (resources: Icons, turn?: { n: number; active: PlayerId }) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: turn?.n,
      activePlayerId: turn?.active,
      cards: [{ key: "subject", def: printing(printingId), owner: P1, zone: "hand" }, ...res(resources)]
    });
  const exactCount = Math.max(o.cost, o.icons);
  const exact = board({ [o.icon]: exactCount } as Icons);
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("subject"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("subject")), "play", "deployed");
  assert.equal(before - ready(exact.engine), o.cost, `the printed cost of ${o.cost} is paid`);
  assert.equal(exact.engine.getDefinition(exact.id("subject")).type, o.type);

  const none = board({});
  if (o.cost > 0 || o.icons > 0) {
    refused(() => playRaw(none.engine, P1, none.id("subject")), "no resources at all");
    assert.equal(zoneOf(none.engine, none.id("subject")), "hand");
  }
  if (o.cost > 1 && exactCount - 1 >= o.icons) {
    const short = board({ [o.icon]: exactCount - 1 } as Icons);
    refused(() => playRaw(short.engine, P1, short.id("subject")), "one resource short of the cost");
    assert.equal(zoneOf(short.engine, short.id("subject")), "hand");
    assert.equal(ready(short.engine), exactCount - 1, "nothing was paid by the refused attempt");
  }
  const wrongIcon: StapleIcon = o.icon === "rage" ? "greed" : "rage";
  const noThreshold = board({ [wrongIcon]: exactCount + 3 } as Icons);
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("subject")), "plenty of resources but none with the threshold's icon");
  if (o.icons > 1) {
    const oneIcon = board({ [o.icon]: o.icons - 1, [wrongIcon]: exactCount + 3 } as Icons);
    refused(() => playRaw(oneIcon.engine, P1, oneIcon.id("subject")), "one icon short of the threshold");
  }
  const oppTurn = board({ [o.icon]: exactCount + 2 } as Icons, { n: 2, active: P2 });
  refused(() => playRaw(oppTurn.engine, P1, oppTurn.id("subject")), "not on the opponent's turn");
  assert.equal(zoneOf(oppTurn.engine, oppTurn.id("subject")), "hand");
}

/** A character in play has the printed strength / life / speed. */
function statsAre(printingId: string, strength: number, life: number, speed: number): void {
  const { engine, id } = buildGame({ cards: [{ key: "subject", def: printing(printingId), owner: P1, zone: "play" }] });
  assert.equal(engine.getStat(id("subject"), "strength"), strength, "strength");
  assert.equal(engine.getStat(id("subject"), "life"), life, "life");
  assert.equal(engine.getStat(id("subject"), "speed"), speed, "speed");
}


// =================================================================================
// B14nd P3pp3r
// ATTACH TO CHARACTER
// The attached character gains 1 strength and 1 life.
// SPIT OUT -- COST: Destroy this card. Pick a character.
//          -- EFFECT: This turn, the character gains 1 strength and 1 life.
// Item (gear), cost 1, [E].
//
// H07 P3pp3r
// ATTACH TO CHARACTER
// The attached character gains 2 strength and 2 life.
// SPIT OUT -- COST: Destroy this card. Pick 2 or fewer characters.
//          -- EFFECT: Restore the characters.
// Item (gear), cost 4, [E].
//
// The two share one set of attach / buff / cost checks (parametrised bodies below);
// each printing still gets its own clause() calls.
// =================================================================================

const BLAND_PEPPER = "cf351c97-aab8-46a2-bbe2-450bcde65738";
const HOT_PEPPER = "3980be6d-ebab-4fc1-a907-8b455e359116";

interface Pepper {
  id: string;
  name: string;
  cost: number;
  /** Strength and life the attached character gains. */
  bonus: number;
  /** The ability's target declaration id. */
  decl: string;
}

const BLAND: Pepper = { id: BLAND_PEPPER, name: "B14nd P3pp3r", cost: 1, bonus: 1, decl: "c" };
const HOT: Pepper = { id: HOT_PEPPER, name: "H07 P3pp3r", cost: 4, bonus: 2, decl: "cs" };

interface PepperOpts {
  pepper?: "hand" | "play" | "discard";
  host?: string;
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  second?: boolean;
  extra?: CardPlacement[];
}

/**
 * P1: mine, mine2 (2 strength / 3 life / 2 speed), P2: foe, foe2 (same), thing (item), place (location),
 * fd (face-down), mh / oc (characters in hands), inDiscard (character in P1's discard pile).
 */
function pepperBoard(p: Pepper, o: PepperOpts = {}) {
  const zone = o.pepper ?? "hand";
  const inPlay = zone === "play";
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pep", def: printing(p.id), owner: P1, zone, attachedToKey: inPlay ? (o.host ?? "mine") : undefined },
      ...(o.second ? [{ key: "pep2", def: printing(p.id), owner: P1, zone: "play" as const, attachedToKey: o.host ?? "mine" }] : []),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      { key: "mh", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "OppHandChar" }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...res(o.icons ?? { elitism: p.cost + 3 }),
      ...(o.extra ?? [])
    ]
  });
}

/** A free tactic dealing `amount` damage to one chosen character (id `zap`, declaration `t`). */
const zapChar = (amount: number): CardDefinition =>
  tactic({
    name: `Zap ${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }
      ]
    }
  });

const deployPepper = (engine: SpoilsEngine, id: IdOf, host: CardInstanceId) => play(engine, P1, id("pep"), { selected: { attachTo: [host] } });
const spit = (engine: SpoilsEngine, id: IdOf, p: Pepper, picks: CardInstanceId[], player: PlayerId = P1, key = "pep") =>
  engine.perform({ type: "activateAbility", playerId: player, cardId: id(key), abilityId: "spit", selected: { [p.decl]: picks }, variables: {} } as never);
const spitDone = (engine: SpoilsEngine, id: IdOf, p: Pepper, picks: CardInstanceId[], player: PlayerId = P1, key = "pep") => {
  spit(engine, id, p, picks, player, key);
  resolvePendingResponses(engine);
};

// --- ATTACH TO CHARACTER ---------------------------------------------------------

const attachDeploys = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p);
  const before = ready(engine);
  deployPepper(engine, id, id("mine"));
  assert.equal(zoneOf(engine, id("pep")), "play", "the item enters play");
  assert.equal(engine.state.cards[id("pep")].attachedTo, id("mine"), "attached to the picked character");
  assert.equal(before - ready(engine), p.cost, `the printed cost of ${p.cost} is paid`);
  assert.equal(engine.state.cards[id("mine2")].attachedTo, undefined, "no other character gets it");
  assert.equal(engine.state.cards[id("pep")].controllerId, P1);
  assert.equal(engine.getDefinition(id("pep")).type, "item");
  assert.ok(engine.getDefinition(id("pep")).subtype.includes("gear"), "gear");
};

const attachToOpposing = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p);
  deployPepper(engine, id, id("foe"));
  assert.equal(zoneOf(engine, id("pep")), "play");
  assert.equal(engine.state.cards[id("pep")].attachedTo, id("foe"), "ATTACH TO CHARACTER names no controller: an opposing character is a legal host");
  assert.equal(engine.state.cards[id("pep")].controllerId, P1, "I still control the item");
};

const attachRefusals = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p);
  const attempt = (host: CardInstanceId) => () => playRaw(engine, P1, id("pep"), { selected: { attachTo: [host] } });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(attempt(factionOf(engine, P1)), "my faction");
  refused(attempt(id("fd")), "a face-down card (only a resource)");
  refused(attempt(id("mh")), "a character in my hand");
  refused(attempt(id("oc")), "a character in the opponent's hand");
  refused(attempt(id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(engine, id("pep")), "hand", "nothing was played");
  assert.equal(ready(engine), p.cost + 3, "nothing was paid by the refused attempts");
  attempt(id("mine"))();
  assert.ok(engine.state.responseWindow, "control: a character in play is accepted");
};

const attachNeedsOneHost = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p);
  refused(() => playRaw(engine, P1, id("pep"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(engine, P1, id("pep"), { selected: {} }), "no host declared");
  refused(() => playRaw(engine, P1, id("pep"), { selected: { attachTo: [id("mine"), id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(engine, id("pep")), "hand");
  assert.equal(ready(engine), p.cost + 3);
};

const attachNeedsACharacter = (p: Pepper) => () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "pep", def: printing(p.id), owner: P1, zone: "hand" }, ...res({ elitism: p.cost + 3 })]
  });
  refused(() => playRaw(engine, P1, id("pep"), { selected: { attachTo: [] } }), "no character in play to attach to");
  assert.equal(zoneOf(engine, id("pep")), "hand");
  assert.equal(ready(engine), p.cost + 3);
};

const attachHostGoneInResponse = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { extra: [{ key: "kill", def: killAny("character"), owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("pep"), { selected: { attachTo: [id("foe")] } });
  engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("foe")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard", "the host was destroyed in response");
  assert.equal(zoneOf(engine, id("pep")), "discard", "no host left: the item goes to its owner's discard pile (CR 507.2c)");
  assert.ok(discardOf(engine, P1).includes(id("pep")), "discardOf(engine, P1).includes(id(\"pep\"))");
  assert.equal(engine.state.cards[id("pep")].attachedTo, undefined);
};

const hostDestroyedLater = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "kill", def: killAny("character"), owner: P1, zone: "hand" }] });
  play(engine, P1, id("kill"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(zoneOf(engine, id("pep")), "discard", "attached cards leave play with their host (CR 301.4)");
  assert.ok(discardOf(engine, P1).includes(id("pep")), "in its owner's discard pile");
};

const hostBouncedPepperFollows = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "bounce", def: bounceChar(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "hand");
  assert.equal(zoneOf(engine, id("pep")), "hand", "the attached card leaves play the same way as its host: into its owner's hand (CR 301.4a)");
  assert.ok(handOf(engine, P1).includes(id("pep")), "handOf(engine, P1).includes(id(\"pep\"))");
};

const hostExiledPepperFollows = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "exile", def: exileChar(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("exile"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "removed");
  assert.equal(zoneOf(engine, id("pep")), "removed", "the attached card is removed from the game the same way as its host (CR 301.4a)");
};

const hostStopsBeingCharacter = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "flip", def: flipDownChar(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("flip"), { selected: { t: [id("mine")] } });
  assert.equal(engine.state.cards[id("mine")].faceDown, true, "the host is a face-down resource now");
  assert.equal(zoneOf(engine, id("pep")), "play", "CR 301.4: the attachment stays in play...");
  assert.equal(engine.state.cards[id("pep")].faceDown, true, "...and is flipped face-down along with its host");
};

const attachCostAndThreshold = (p: Pepper) => () => {
  const exact = pepperBoard(p, { icons: { elitism: p.cost } });
  deployPepper(exact.engine, exact.id, exact.id("mine"));
  assert.equal(zoneOf(exact.engine, exact.id("pep")), "play", "exactly the cost with [E] is enough");
  assert.equal(ready(exact.engine), 0);
  if (p.cost > 1) {
    const short = pepperBoard(p, { icons: { elitism: p.cost - 1 } });
    refused(() => playRaw(short.engine, P1, short.id("pep"), { selected: { attachTo: [short.id("mine")] } }), "one resource short");
    assert.equal(zoneOf(short.engine, short.id("pep")), "hand");
  } else {
    const none = pepperBoard(p, { icons: {} });
    refused(() => playRaw(none.engine, P1, none.id("pep"), { selected: { attachTo: [none.id("mine")] } }), "no resources");
  }
  const noThreshold = pepperBoard(p, { icons: { rage: p.cost + 5 } });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("pep"), { selected: { attachTo: [noThreshold.id("mine")] } }), "plenty of resources but no [E]");
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("pep")), "hand");
  const one = pepperBoard(p, { icons: { elitism: 1, rage: p.cost + 3 } });
  deployPepper(one.engine, one.id, one.id("mine"));
  assert.equal(zoneOf(one.engine, one.id("pep")), "play", "a single [E] among other resources is enough");
};

const attachOwnTurnOnly = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("pep"), { selected: { attachTo: [id("foe")] } }), "the opponent's turn");
  assert.equal(zoneOf(engine, id("pep")), "hand");
};














clause(HOT_PEPPER, "0:attach", "deploys for exactly 4 and enters play attached to the picked character (one of mine); it is a gear item", attachDeploys(HOT));
clause(HOT_PEPPER, "0:attach", "it can attach to an opposing character: I still control the item", attachToOpposing(HOT));
clause(HOT_PEPPER, "0:attach", "a host that is not a character in play is refused: item, location, factions, face-down card, cards in hands and discard piles", attachRefusals(HOT));
clause(HOT_PEPPER, "0:attach", "exactly one host must be picked: none or two are refused", attachNeedsOneHost(HOT));
clause(HOT_PEPPER, "0:attach", "with no character in play at all it cannot be deployed", attachNeedsACharacter(HOT));
clause(HOT_PEPPER, "0:attach", "if the picked host is destroyed in response the item never enters play: it goes to its owner's discard pile (CR 507.2c)", attachHostGoneInResponse(HOT));
clause(HOT_PEPPER, "0:attach", "when the host is destroyed later the item leaves play with it, into its owner's discard pile (CR 301.4)", hostDestroyedLater(HOT));
clause(HOT_PEPPER, "0:attach", "when the host is put into its owner's hand the item follows it to its owner's hand (CR 301.4a), not to the discard pile", hostBouncedPepperFollows(HOT));
clause(HOT_PEPPER, "0:attach", "when the host is removed from the game the item is removed from the game too (CR 301.4a)", hostExiledPepperFollows(HOT));
clause(HOT_PEPPER, "0:attach", "if the host stops being a character (turned face-down into a resource) the item is flipped face-down with it", hostStopsBeingCharacter(HOT));
clause(HOT_PEPPER, "0:attach", "needs [E] and exactly 4 resources: refused one short, refused without [E], accepted with one [E] among others", attachCostAndThreshold(HOT));
clause(HOT_PEPPER, "0:attach", "an item is deployed on its controller's own turn only", attachOwnTurnOnly(HOT));

// --- The attached character gains N strength and N life ---------------------------

const buffExact = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play" });
  assert.equal(engine.getStat(id("mine"), "strength"), 2 + p.bonus, `+${p.bonus} strength`);
  assert.equal(engine.getStat(id("mine"), "life"), 3 + p.bonus, `+${p.bonus} life`);
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "speed is untouched");
};

const buffOnlyHost = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play" });
  for (const key of ["mine2", "foe", "foe2"]) {
    assert.equal(engine.getStat(id(key), "strength"), 2, `${key} strength`);
    assert.equal(engine.getStat(id(key), "life"), 3, `${key} life`);
  }
};

const buffOnOpposingHost = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", host: "foe" });
  assert.equal(engine.getStat(id("foe"), "strength"), 2 + p.bonus, "the opposing host gets the bonus, whoever controls the item");
  assert.equal(engine.getStat(id("foe"), "life"), 3 + p.bonus);
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "my characters get nothing");
  assert.equal(engine.getStat(id("mine"), "life"), 3);
};

const buffStacks = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", second: true });
  assert.equal(engine.getStat(id("mine"), "strength"), 2 + 2 * p.bonus, "two copies stack");
  assert.equal(engine.getStat(id("mine"), "life"), 3 + 2 * p.bonus);
};

const buffEndsWhenItemLeaves = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "kill", def: killAny("item"), owner: P1, zone: "hand" }] });
  assert.equal(engine.getStat(id("mine"), "strength"), 2 + p.bonus);
  play(engine, P1, id("kill"), { selected: { t: [id("pep")] } });
  assert.equal(zoneOf(engine, id("pep")), "discard");
  assert.equal(zoneOf(engine, id("mine")), "play", "the host survives");
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "the bonus is gone with the item");
  assert.equal(engine.getStat(id("mine"), "life"), 3);
};

const buffNotFromHandOrDiscard = (p: Pepper) => () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = pepperBoard(p, { pepper: zone });
    assert.equal(engine.getStat(id("mine"), "strength"), 2, `${zone}: no bonus`);
    assert.equal(engine.getStat(id("mine"), "life"), 3, `${zone}: no bonus`);
  }
};

const buffLifeIsReal = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, {
    pepper: "play",
    extra: [
      { key: "zapMost", def: zapChar(2 + p.bonus), owner: P1, zone: "hand" },
      { key: "zapLast", def: zapChar(1), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zapMost"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "play", `${2 + p.bonus} damage does not kill a ${3 + p.bonus}-life character`);
  assert.equal(engine.state.cards[id("mine")].damage, 2 + p.bonus);
  play(engine, P1, id("zapLast"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard", `${3 + p.bonus} damage kills it`);
};

const buffLifeLostWithItem = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, {
    pepper: "play",
    extra: [
      { key: "zap3", def: zapChar(3), owner: P1, zone: "hand" },
      { key: "kill", def: killAny("item"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("zap3"), { selected: { t: [id("mine")] } });
  assert.equal(zoneOf(engine, id("mine")), "play", "survives 3 damage with the extra life");
  play(engine, P1, id("kill"), { selected: { t: [id("pep")] } });
  assert.equal(zoneOf(engine, id("mine")), "discard", "without the item its life is back to 3 and 3 damage destroys it");
};

const buffStrengthIsReal = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", turn: 2 });
  const influence = influenceOf(engine, P2);
  fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - influenceOf(engine, P2), 2 + p.bonus, "the bonus strength is dealt as battle damage");
};











clause(HOT_PEPPER, "1:rule", "the attached character gains exactly 2 strength and 2 life (speed is untouched)", buffExact(HOT));
clause(HOT_PEPPER, "1:rule", "only the attached character is affected", buffOnlyHost(HOT));
clause(HOT_PEPPER, "1:rule", "an opposing character it is attached to gets the bonus, not mine", buffOnOpposingHost(HOT));
clause(HOT_PEPPER, "1:rule", "two copies on the same character stack", buffStacks(HOT));
clause(HOT_PEPPER, "1:rule", "the bonus ends when the item leaves play; the host stays", buffEndsWhenItemLeaves(HOT));
clause(HOT_PEPPER, "1:rule", "in the hand or discard pile it gives nothing", buffNotFromHandOrDiscard(HOT));
clause(HOT_PEPPER, "1:rule", "the extra life is real: the host survives 4 damage and dies to the 5th", buffLifeIsReal(HOT));
clause(HOT_PEPPER, "1:rule", "a host holding 3 damage is destroyed the moment the item leaves play", buffLifeLostWithItem(HOT));
clause(HOT_PEPPER, "1:rule", "the extra strength is real in battle: an unblocked 2-strength attacker deals 4 to the faction", buffStrengthIsReal(HOT));

// --- SPIT OUT: cost ------------------------------------------------------------------

const spitCostDestroysItem = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play" });
  spitDone(engine, id, p, [id("mine2")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "the item is destroyed as the cost");
  assert.ok(discardOf(engine, P1).includes(id("pep")), "into its owner's discard pile");
  assert.equal(zoneOf(engine, id("mine")), "play", "its former host survives");
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "the host lost the item's bonus");
};

const spitNeedsAPick = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play" });
  refused(() => spit(engine, id, p, []), "the pick is part of the cost");
  assert.equal(zoneOf(engine, id("pep")), "play", "nothing was destroyed by the refused attempt");
  assert.equal(engine.state.cards[id("pep")].attachedTo, id("mine"));
  refused(() => spit(engine, id, p, [id("thing")]), "an item");
  refused(() => spit(engine, id, p, [id("place")]), "a location");
  refused(() => spit(engine, id, p, [factionOf(engine, P1)]), "my faction");
  refused(() => spit(engine, id, p, [factionOf(engine, P2)]), "their faction");
  refused(() => spit(engine, id, p, [id("fd")]), "a face-down card");
  refused(() => spit(engine, id, p, [id("mh")]), "a character in my hand");
  refused(() => spit(engine, id, p, [id("oc")]), "a character in the opponent's hand");
  refused(() => spit(engine, id, p, [id("inDiscard")]), "a character in a discard pile");
  assert.equal(zoneOf(engine, id("pep")), "play", "no refused attempt destroyed the item");
  spit(engine, id, p, [id("foe")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "control: a character in play is accepted and the cost is paid");
};

const spitOnlyController = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", turn: 2, active: P2 });
  refused(() => spit(engine, id, p, [id("foe")], P2), "only the item's controller may use it");
  assert.equal(zoneOf(engine, id("pep")), "play");
};

const spitNeedsToBeInPlay = (p: Pepper) => () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = pepperBoard(p, { pepper: zone });
    refused(() => spit(engine, id, p, [id("foe")]), `the item is in the ${zone}`);
  }
};

const spitByControllerOfOpposingHost = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", host: "foe" });
  spitDone(engine, id, p, [id("mine")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "I control the item attached to an opposing character, so I can use it");
};

const spitPickGoneInResponse = (p: Pepper) => () => {
  const { engine, id } = pepperBoard(p, { pepper: "play", extra: [{ key: "kill", def: killAny("character"), owner: P2, zone: "hand" }] });
  spit(engine, id, p, [id("foe")]);
  engine.perform({ type: "playCard", playerId: P2, cardId: id("kill"), selected: { t: [id("foe")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("pep")), "discard", "the cost was paid when the ability was used");
  assert.equal(engine.state.pendingChoice, undefined);
};








clause(HOT_PEPPER, "2:ability:spit", "the cost destroys the item itself (into its owner's discard pile); its former host stays in play without the bonus", spitCostDestroysItem(HOT));
clause(HOT_PEPPER, "2:ability:spit", "characters must be picked as part of the cost: an item, a location, factions, a face-down card, or cards outside play are refused and cost nothing", () => {
  const { engine, id } = pepperBoard(HOT, { pepper: "play" });
  refused(() => spit(engine, id, HOT, [id("thing")]), "an item");
  refused(() => spit(engine, id, HOT, [id("place")]), "a location");
  refused(() => spit(engine, id, HOT, [factionOf(engine, P1)]), "my faction");
  refused(() => spit(engine, id, HOT, [factionOf(engine, P2)]), "their faction");
  refused(() => spit(engine, id, HOT, [id("fd")]), "a face-down card");
  refused(() => spit(engine, id, HOT, [id("mh")]), "a character in my hand");
  refused(() => spit(engine, id, HOT, [id("oc")]), "a character in the opponent's hand");
  refused(() => spit(engine, id, HOT, [id("inDiscard")]), "a character in a discard pile");
  refused(() => spit(engine, id, HOT, [id("foe"), id("thing")]), "a legal pick next to an illegal one");
  assert.equal(zoneOf(engine, id("pep")), "play", "no refused attempt destroyed the item");
  spit(engine, id, HOT, [id("foe")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "control: a character in play is accepted and the cost is paid");
});
clause(HOT_PEPPER, "2:ability:spit", "only the item's controller may use it", spitOnlyController(HOT));
clause(HOT_PEPPER, "2:ability:spit", "it can only be used while the item is in play", spitNeedsToBeInPlay(HOT));
clause(HOT_PEPPER, "2:ability:spit", "an item I control attached to an opposing character can be spat out by me", spitByControllerOfOpposingHost(HOT));
clause(HOT_PEPPER, "2:ability:spit", "if the picked character is destroyed in response the cost stays paid and nothing breaks", spitPickGoneInResponse(HOT));

// --- SPIT OUT: B14nd P3pp3r's effect ----------------------------------------------------

function blandSpit() {
  return pepperBoard(BLAND, { pepper: "play" });
}

















// --- SPIT OUT: H07 P3pp3r's effect ---------------------------------------------------------

function hotSpit(depleted: string[] = ["mine", "mine2", "foe", "foe2"]) {
  const game = pepperBoard(HOT, { pepper: "play" });
  for (const key of depleted) game.engine.state.cards[game.id(key)].depleted = true;
  return game;
}

clause(HOT_PEPPER, "2:ability:spit", "picking two depleted characters restores both, and only those", () => {
  const { engine, id } = hotSpit();
  spitDone(engine, id, HOT, [id("mine2"), id("foe")]);
  assert.equal(isDepleted(engine, id("mine2")), false);
  assert.equal(isDepleted(engine, id("foe")), false, "an opposing character can be picked");
  assert.equal(isDepleted(engine, id("mine")), true, "unpicked");
  assert.equal(isDepleted(engine, id("foe2")), true, "unpicked");
  assert.equal(zoneOf(engine, id("pep")), "discard");
});

clause(HOT_PEPPER, "2:ability:spit", "'2 or fewer': picking just one restores just that one", () => {
  const { engine, id } = hotSpit();
  spitDone(engine, id, HOT, [id("mine2")]);
  assert.equal(isDepleted(engine, id("mine2")), false);
  for (const key of ["mine", "foe", "foe2"]) assert.equal(isDepleted(engine, id(key)), true, `${key} stays depleted`);
});

clause(HOT_PEPPER, "2:ability:spit", "'2 or fewer': picking none is legal, the item is still destroyed and nothing is restored", () => {
  const { engine, id } = hotSpit();
  spitDone(engine, id, HOT, []);
  assert.equal(zoneOf(engine, id("pep")), "discard");
  for (const key of ["mine", "mine2", "foe", "foe2"]) assert.equal(isDepleted(engine, id(key)), true, `${key} stays depleted`);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(HOT_PEPPER, "2:ability:spit", "'2 or fewer': three characters are refused and the item is not destroyed", () => {
  const { engine, id } = hotSpit();
  refused(() => spit(engine, id, HOT, [id("mine"), id("mine2"), id("foe")]), "three picks");
  assert.equal(zoneOf(engine, id("pep")), "play");
  for (const key of ["mine", "mine2", "foe"]) assert.equal(isDepleted(engine, id(key)), true, `${key} unchanged`);
  spit(engine, id, HOT, [id("mine"), id("mine2")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "control: two picks are accepted");
});

clause(HOT_PEPPER, "2:ability:spit", "the same character cannot be picked twice", () => {
  const { engine, id } = hotSpit();
  refused(() => spit(engine, id, HOT, [id("mine2"), id("mine2")]), "the same card twice");
  assert.equal(zoneOf(engine, id("pep")), "play");
  spit(engine, id, HOT, [id("mine2"), id("foe")]);
  assert.equal(zoneOf(engine, id("pep")), "discard", "control: two different characters are accepted");
});

clause(HOT_PEPPER, "2:ability:spit", "characters that are not depleted may be picked: nothing happens to them", () => {
  const { engine, id } = hotSpit(["mine2"]);
  spitDone(engine, id, HOT, [id("mine2"), id("foe")]);
  assert.equal(isDepleted(engine, id("mine2")), false);
  assert.equal(isDepleted(engine, id("foe")), false);
});

clause(HOT_PEPPER, "2:ability:spit", "the former host can be picked and restored too", () => {
  const { engine, id } = hotSpit(["mine"]);
  spitDone(engine, id, HOT, [id("mine")]);
  assert.equal(isDepleted(engine, id("mine")), false);
  assert.equal(zoneOf(engine, id("mine")), "play");
});

clause(HOT_PEPPER, "2:ability:spit", "the restore is real: a restored character can block, an unpicked depleted one cannot", () => {
  const { engine, id } = pepperBoard(HOT, {
    pepper: "play",
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Raider", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" }]
  });
  engine.state.cards[id("mine2")].depleted = true;
  engine.state.cards[id("mine")].depleted = true;
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  spit(engine, id, HOT, [id("mine2")]);
  resolvePendingResponses(engine);
  refused(() => declareBlockers(engine, P1, [id("mine")]), "still depleted");
  declareBlockers(engine, P1, [id("mine2")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("mine2")]);
});

// --- the two peppers together ----------------------------------------------------------

/** One B14nd P3pp3r and one H07 P3pp3r attached to the same character ("mine"). */
function bothPeppers() {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "bland", def: printing(BLAND_PEPPER), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "hot", def: printing(HOT_PEPPER), owner: P1, zone: "play", attachedToKey: "mine" }
    ]
  });
}



clause(HOT_PEPPER, "1:rule", "alongside a B14nd P3pp3r on the same character the bonuses add up: +3 strength and +3 life", () => {
  const { engine, id } = bothPeppers();
  assert.equal(engine.getStat(id("mine"), "strength"), 5);
  assert.equal(engine.getStat(id("mine"), "life"), 6);
  assert.equal(engine.getStat(id("mine"), "speed"), 2);
});



clause(HOT_PEPPER, "2:ability:spit", "spitting out one of two peppers on a character leaves the other one's bonus in place", () => {
  const { engine, id } = bothPeppers();
  engine.state.cards[id("mine")].depleted = true;
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("hot"), abilityId: "spit", selected: { cs: [id("mine")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("hot")), "discard");
  assert.equal(zoneOf(engine, id("bland")), "play");
  assert.equal(isDepleted(engine, id("mine")), false, "the host was restored");
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "only B14nd's +1 is left");
});

}

// ---- ported from 2nd-edition-04.test.ts (Luteoderm Prototype, Micromajig Master) ----
{
// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
type IdOf = (key: string) => CardInstanceId;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources `player` can still spend (not attached to the faction). */
const ready = (engine: SpoilsEngine, player: Pid = P1): number => engine.getAvailableResourceCount(player);
const handOf = (engine: SpoilsEngine, player: Pid = P1): CardInstanceId[] => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid = P1): CardInstanceId[] => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid = P1): CardInstanceId[] => engine.state.players[player].discard;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string): boolean => (engine.getKeywords(cardId) as string[]).includes(keyword);

/** Resources spent while `fn` runs (before - after). */
function spentBy(engine: SpoilsEngine, player: Pid, fn: () => void): number {
  const before = ready(engine, player);
  fn();
  return before - ready(engine, player);
}

/** Raw `activateAbility` without draining the response window (the harness `activate` drains it). */
function activateRaw(
  engine: SpoilsEngine,
  player: Pid,
  cardId: CardInstanceId,
  abilityId: string,
  opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** A small seeded LCG: reproducible shuffles / random picks. */
function seeded(seed = 12345): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const sameCards = (a: readonly string[], b: readonly string[], message = "same cards") => assert.deepEqual([...a].sort(), [...b].sort(), message);

/** All `cardsRevealed` events in the log. */
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
const revealedIds = (engine: SpoilsEngine): string[] => revealEvents(engine).flatMap((entry) => (entry.event as unknown as { cardIds?: string[] }).cardIds ?? []);
const loggedEvents = (engine: SpoilsEngine, type: string) => engine.getLog().filter((entry) => entry.event?.type === type);

/** Answers the open `chooserSelectsTarget` with `selected` and lets the game continue. */
const pickCards = (engine: SpoilsEngine, selected: CardInstanceId[]): void => answerPending(engine, "chooserSelectsTarget", { selected });
/** The same answer as a thunk for `refused(...)` (it keeps the choice open when the pick is illegal). */
const tryPick = (engine: SpoilsEngine, player: Pid, selected: CardInstanceId[]) => () => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
};

/** Passes priority for whoever holds it until `player` holds it (or the window closes). */
function passUntil(engine: SpoilsEngine, player: Pid): void {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player && !engine.state.pendingChoice) {
    if (++guard > 50) throw new Error("passUntil did not converge");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

const declareBlock = (engine: SpoilsEngine, player: Pid, blockerIds: CardInstanceId[]) => engine.perform({ type: "declareBlockers", playerId: player, blockerIds });

/** Resolves the battle sending each listed source's whole strength at the mapped target card; other sources take the default first legal target. */
function resolveSending(engine: SpoilsEngine, plan: Record<CardInstanceId, CardInstanceId> = {}): void {
  autoResolveBattle(engine, (source) => {
    const wanted = plan[source.cardId];
    const target = (wanted && source.legalTargets.find((t) => t.type === "card" && t.cardId === wanted)) || source.legalTargets[0];
    if (!target || source.strength <= 0) return [];
    return [{ sourceId: source.cardId, target, amount: source.strength }];
  });
}

/** A tactic that deals `amount` damage to one picked character (decl `t`). */
function damageTactic(amount: number, name = `Smite${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dmg",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic that does nothing (used to open a response window). */
const noopTactic = (name = "Noop", cost = 0): CardDefinition => tactic({ name, cost, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });

/** A battle board: `p1` and `p2` extra cards; the active player attacks (turn 2). */
function warBoard(p1: CardPlacement[], p2: CardPlacement[], opts: { active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [...p1, ...p2]
  });
}

const fighter = (key: string, owner: Pid, strength: number, life: number, speed = 2): CardPlacement => ({
  key,
  def: character({ name: key, strength, life, speed }),
  owner,
  zone: "play"
});

/**
 * Two games with a "first" and a "last" random source: the deck order of `player` differs between them iff the engine shuffled that deck.
 * `make` builds a board from a random source; `run` drives it.
 */
function deckWasShuffled(
  make: (random: () => number) => { engine: SpoilsEngine; id: IdOf },
  run: (game: { engine: SpoilsEngine; id: IdOf }) => void,
  player: Pid = P1
): boolean {
  const a = make(() => 0);
  const b = make(() => 0.9999999);
  run(a);
  run(b);
  const names = (g: { engine: SpoilsEngine }) => deckOf(g.engine, player).map((c) => g.engine.getDefinition(c).name);
  sameCards(names(a), names(b), "both runs ended with the same cards in the deck");
  return JSON.stringify(names(a)) !== JSON.stringify(names(b));
}


const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): Pid => engine.state.cards[cardId].controllerId as Pid;

const smashItemTactic = (): CardDefinition =>
  tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });

const MSC = "0d11a1d5-315e-49ad-ba92-6469206e8c64";

/** A free tactic that sends one chosen character in play to `to` (id `s`, declaration `t`). */
function sendTactic(to: "hand" | "deck" | "void" | "remove" | "destroy"): CardDefinition {
  const effect =
    to === "destroy"
      ? { type: "destroy" as const, target: { type: "selected" as const, id: "t" } }
      : to === "remove"
        ? { type: "removeFromGame" as const, target: { type: "selected" as const, id: "t" } }
        : { type: "moveCard" as const, target: { type: "selected" as const, id: "t" }, to };
  return tactic({ name: `Send-${to}`, cost: 0, behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [effect] }] } });
}

/** A free tactic that destroys any one card in play, face-down cards included (id `d`, declaration `t`). */
const destroyAnyTactic = (): CardDefinition =>
  tactic({ name: "DestroyAny", cost: 0, behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });

/** The Micromajig tokens `player` controls in play. */
function micromajigs(engine: SpoilsEngine, player: Pid = P1): CardInstanceId[] {
  return Object.values(engine.state.cards)
    .filter((c) => c.zone === "play" && c.controllerId === player && engine.getDefinition(c.id).name === "Micromajig")
    .map((c) => c.id);
}

/** A token that left play is out of the game: in no hand, deck, discard pile or play area. */
function assertTokenGone(engine: SpoilsEngine, cardId: CardInstanceId, label: string): void {
  const card = engine.state.cards[cardId];
  assert.ok(card === undefined || card.zone === "removed", `${label}: the token is out of the game (zone ${card?.zone})`);
  for (const player of [P1, P2] as const) {
    assert.equal(discardOf(engine, player).includes(cardId), false, `${label}: not in ${player}'s discard pile`);
    assert.equal(handOf(engine, player).includes(cardId), false, `${label}: not in ${player}'s hand`);
    assert.equal(deckOf(engine, player).includes(cardId), false, `${label}: not in ${player}'s deck`);
    assert.equal(engine.state.players[player].play.includes(cardId), false, `${label}: not in ${player}'s play area`);
  }
}

function mscBoard(opts: { owner?: Pid; controller?: Pid; faceDown?: boolean; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "msc", def: printing(MSC), owner: opts.owner ?? P1, controller: opts.controller, zone: "play", faceDown: opts.faceDown },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic({ name: "Kill2" }), owner: P1, zone: "hand" },
      { key: "destroyAny", def: destroyAnyTactic(), owner: P1, zone: "hand" },
      { key: "zap1", def: damageTactic(1, "Zap1"), owner: P1, zone: "hand" },
      { key: "zap4", def: damageTactic(4, "Zap4"), owner: P1, zone: "hand" },
      { key: "zap5", def: damageTactic(5, "Zap5"), owner: P1, zone: "hand" },
      { key: "sendHand", def: sendTactic("hand"), owner: P1, zone: "hand" },
      { key: "sendDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
      { key: "sendVoid", def: sendTactic("void"), owner: P1, zone: "hand" },
      { key: "sendRemove", def: sendTactic("remove"), owner: P1, zone: "hand" },
      { key: "sendDestroy", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 6, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("fill", 4, P1, "deck"),
      ...fillers("ofill", 3, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}
type MscBoard = ReturnType<typeof mscBoard>;

/** Destroys the Shipping Container with the free Kill tactic. */
const killMsc = (b: MscBoard, key = "msc", tacticKey = "kill"): void => {
  play(b.engine, P1, b.id(tacticKey), { selected: { t: [b.id(key)] } });
  drain(b.engine, declineAll);
};
const mscTokens = (b: MscBoard): CardInstanceId[] => {
  killMsc(b);
  return micromajigs(b.engine, P1);
};







































// =============================================================================
// Luteoderm Prototype
// ATTACH TO CHARACTER. The attached character gains 1 strength and 1 life. If
// the attached character leaves play, you may search your deck for a card. If
// you do, put it into your hand.
// Item (gear), gearsmith, cost 2, threshold [E].
// =============================================================================

const LUTEODERM = "eaf842ee-7b62-444e-a17b-68954eec9e2b";

function luteodermBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; hostOwner?: Pid; protoOwner?: Pid; protoDeck?: number; extraCards?: CardPlacement[]; random?: () => number } = {}) {
  const zone = opts.zone ?? "hand";
  const protoOwner = opts.protoOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random ?? seeded(),
    cards: [
      { key: "lp", def: printing(LUTEODERM), owner: protoOwner, zone, attachedToKey: zone === "play" ? "host" : undefined },
      { key: "host", def: character({ name: "Host", strength: 2, life: 2, speed: 2 }), owner: opts.hostOwner ?? P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      // The prototype controller's deck: a mix of types, so "a card" really means any card.
      { key: "dChar", def: character({ name: "DChar" }), owner: protoOwner, zone: "deck" },
      { key: "dItem", def: item({ name: "DItem" }), owner: protoOwner, zone: "deck" },
      { key: "dTac", def: tactic({ name: "DTac" }), owner: protoOwner, zone: "deck" },
      { key: "dLoc", def: location({ name: "DLoc" }), owner: protoOwner, zone: "deck" },
      { key: "dRes", def: resourceCard({ name: "DRes" }), owner: protoOwner, zone: "deck" },
      ...Array.from({ length: opts.protoDeck ?? 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: protoOwner, zone: "deck" as const })),
      // The other player's deck, hand and discard pile must never be searched.
      ...["oChar", "oItem"].map((key) => ({ key, def: (key === "oItem" ? item : character)({ name: key }), owner: protoOwner === P1 ? P2 : P1, zone: "deck" as const })),
      { key: "inHand", def: character({ name: "InHand" }), owner: protoOwner, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: protoOwner, zone: "discard" },
      { key: "sendDiscard", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "sendHand", def: sendTactic("hand"), owner: P1, zone: "hand" },
      { key: "sendDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
      { key: "sendVoid", def: sendTactic("void"), owner: P1, zone: "hand" },
      { key: "sendRemove", def: sendTactic("remove"), owner: P1, zone: "hand" },
      { key: "smashItem", def: smashItemTactic(), owner: P1, zone: "hand" },
      ...(opts.extraCards ?? []),
      ...bank("elitism", opts.elitism ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}
type LuteBoard = ReturnType<typeof luteodermBoard>;

// --- 0:attach

clause(LUTEODERM, "0:attach", "attaches to the character it is played on (yours or the opponent's); pays its cost of 2 and stays under its player's control", () => {
  for (const hostKey of ["host", "foe"] as const) {
    const { engine, id } = luteodermBoard();
    const before = ready(engine);
    play(engine, P1, id("lp"), { selected: { attachTo: [id(hostKey)] } });
    assert.equal(zoneOf(engine, id("lp")), "play");
    assert.equal(engine.state.cards[id("lp")].attachedTo, id(hostKey), `attached to ${hostKey}`);
    assert.equal(engine.state.cards[id("lp")].controllerId, P1, "its controller is the player who played it, whoever owns the host");
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  }
});

clause(LUTEODERM, "0:attach", "is refused for a host that is not a character (item, location, faction, face-down card) or for no host at all", () => {
  const { engine, id } = luteodermBoard();
  const attempt = (hostId: CardInstanceId) => () => playRaw(engine, P1, id("lp"), { selected: { attachTo: [hostId] } });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(id("faceDown")), "a face-down card is only a resource");
  refused(attempt(factionOf(engine, P2)), "a faction");
  refused(attempt(id("dChar")), "a character in the deck is not in play");
  refused(attempt(id("inHand")), "a character in hand is not in play");
  refused(() => playRaw(engine, P1, id("lp"), { selected: {} }), "no host chosen");
  assert.equal(zoneOf(engine, id("lp")), "hand");
  assert.equal(ready(engine), 4, "nothing was spent by the refused attempts");
  attempt(id("mate"))();
  assert.ok(engine.state.responseWindow, "control: a character host is accepted");
});

clause(LUTEODERM, "0:attach", "is refused one resource short of 2, and without [E] even with plenty of other resources", () => {
  const short = luteodermBoard({ elitism: 1 });
  refused(() => playRaw(short.engine, P1, short.id("lp"), { selected: { attachTo: [short.id("host")] } }), "one resource");
  assert.equal(zoneOf(short.engine, short.id("lp")), "hand");
  const noThreshold = luteodermBoard({ elitism: 0, greed: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("lp"), { selected: { attachTo: [noThreshold.id("host")] } }), "no [E]");
  const exact = luteodermBoard({ elitism: 2 });
  play(exact.engine, P1, exact.id("lp"), { selected: { attachTo: [exact.id("host")] } });
  assert.equal(zoneOf(exact.engine, exact.id("lp")), "play", "[E] and exactly 2 resources is enough");
  const oneE = luteodermBoard({ elitism: 1, greed: 1 });
  play(oneE.engine, P1, oneE.id("lp"), { selected: { attachTo: [oneE.id("host")] } });
  assert.equal(zoneOf(oneE.engine, oneE.id("lp")), "play", "one [E] plus one other resource is enough");
});

clause(LUTEODERM, "0:attach", "when its host is destroyed the Prototype is destroyed with it, into its owner's discard pile (CR 301.4)", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("sendDiscard"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("lp")), "discard", "the attached card went with it");
  assert.ok(discardOf(engine, P1).includes(id("lp")), "discardOf(engine, P1).includes(id(\"lp\"))");
  assert.equal(engine.state.cards[id("lp")].attachedTo, undefined);
});

clause(LUTEODERM, "0:attach", "when the host leaves play by other means than destruction, the Prototype leaves play the same way (CR 301.4a): a host returned to hand takes it to its owner's hand", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("sendHand"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("lp")), "hand", "leaves play the same way (CR 301.4a)");
});

clause(LUTEODERM, "0:attach", "...and a host removed from the game takes the Prototype out of the game with it", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("sendRemove"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("host")), "removed");
  assert.equal(zoneOf(engine, id("lp")), "removed", "leaves play the same way (CR 301.4a)");
});

clause(LUTEODERM, "0:attach", "if the host is gone before the Prototype resolves it goes to its owner's discard pile instead of entering play", () => {
  const opKill = tactic({ name: "OpKill", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });
  const { engine, id } = luteodermBoard({ extraCards: [{ key: "opKill", def: opKill, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("lp"), { selected: { attachTo: [id("host")] } });
  assert.ok(engine.state.responseWindow, "the Prototype is being deployed; P2 may respond");
  engine.perform({ type: "playCard", playerId: P2, cardId: id("opKill"), selected: { t: [id("host")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("host")), "discard", "the host was destroyed in response");
  assert.equal(zoneOf(engine, id("lp")), "discard", "the Prototype could not attach, so it went to the discard pile");
  assert.ok(discardOf(engine, P1).includes(id("lp")), "discardOf(engine, P1).includes(id(\"lp\"))");
});

// --- 1:rule  The attached character gains 1 strength and 1 life

clause(LUTEODERM, "1:rule", "the attached character gains exactly 1 strength and 1 life (and no speed) — on your own character and on an opponent's", () => {
  for (const hostOwner of [P1, P2] as const) {
    const { engine, id } = luteodermBoard({ zone: "play", hostOwner });
    assert.deepEqual(stats(engine, id("host")), [3, 3, 2], `host owned by ${hostOwner}`);
  }
});

clause(LUTEODERM, "1:rule", "no other character is affected, and the Prototype gives its host nothing before it is attached", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  assert.deepEqual(stats(engine, id("mate")), [2, 2, 2], "another of my characters");
  assert.deepEqual(stats(engine, id("foe")), [2, 2, 2], "an opponent's character");
  const bare = luteodermBoard({ zone: "hand" });
  assert.deepEqual(stats(bare.engine, bare.id("host")), [2, 2, 2], "control: unattached host has its printed stats");
  play(bare.engine, P1, bare.id("lp"), { selected: { attachTo: [bare.id("host")] } });
  assert.deepEqual(stats(bare.engine, bare.id("host")), [3, 3, 2], "attaching it gives +1/+1");
  assert.deepEqual(stats(bare.engine, bare.id("mate")), [2, 2, 2]);
});

clause(LUTEODERM, "1:rule", "the extra life is real: a 2-life host survives 2 damage with the Prototype and dies on the 3rd, and dies on the 2nd without it", () => {
  const withProto = luteodermBoard({ zone: "play", extraCards: [{ key: "z2", def: damageTactic(2), owner: P1, zone: "hand" }, { key: "z1", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(withProto.engine, P1, withProto.id("z2"), { selected: { t: [withProto.id("host")] } });
  assert.equal(zoneOf(withProto.engine, withProto.id("host")), "play", "2 damage < 3 life");
  play(withProto.engine, P1, withProto.id("z1"), { selected: { t: [withProto.id("host")] } });
  assert.equal(zoneOf(withProto.engine, withProto.id("host")), "discard", "3 damage >= 3 life");
  const without = luteodermBoard({ zone: "hand", extraCards: [{ key: "z2", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("z2"), { selected: { t: [without.id("host")] } });
  assert.equal(zoneOf(without.engine, without.id("host")), "discard", "control: 2 damage kills the bare 2-life host");
});

clause(LUTEODERM, "1:rule", "the extra strength is real in battle: the host deals 3 battle damage to the faction", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  engine.state.turn = 2;
  engine.state.cards[id("host")].attackEligibleTurn = 2;
  const before = engine.state.players[P2].influence;
  declareAttackBy(engine, P1, [id("host")]);
  declareBlock(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(engine.state.players[P2].influence, before - 3, "2 printed + 1 = 3 strength");
});

clause(LUTEODERM, "1:rule", "two Prototypes on one host stack (+2 strength, +2 life)", () => {
  const { engine, id } = luteodermBoard({ zone: "play", extraCards: [{ key: "lp2", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.deepEqual(stats(engine, id("host")), [4, 4, 2]);
});

clause(LUTEODERM, "1:rule", "the bonus ends when the Prototype leaves play", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  assert.deepEqual(stats(engine, id("host")), [3, 3, 2]);
  play(engine, P1, id("smashItem"), { selected: { t: [id("lp")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("lp")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play", "the host itself is not harmed");
  assert.deepEqual(stats(engine, id("host")), [2, 2, 2]);
});

// --- 2:rule  If the attached character leaves play, you may search your deck for a card. If you do, put it into your hand.

/** Opens the search by sending the host away, then returns the pending choice. */
function leaveAndSearch(board: LuteBoard, how: "sendDiscard" | "sendHand" | "sendDeck" | "sendVoid" | "sendRemove" = "sendDiscard") {
  play(board.engine, P1, board.id(how), { selected: { t: [board.id("host")] } });
  return pending(board.engine);
}

clause(LUTEODERM, "2:rule", "when the host is destroyed its controller is offered a deck search; the chosen card goes to hand and nothing else moves", () => {
  const board = luteodermBoard({ zone: "play" });
  const { engine, id } = board;
  const handBefore = [...handOf(engine)];
  const deckBefore = [...deckOf(engine)];
  const oppDeck = [...deckOf(engine, P2)];
  const pc = leaveAndSearch(board)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Prototype's controller searches");
  pickCards(engine, [id("dItem")]);
  assert.equal(zoneOf(engine, id("dItem")), "hand");
  assert.deepEqual(handOf(engine).filter((c) => !handBefore.includes(c) && c !== id("dItem")), [], "exactly one card was added to the hand");
  assert.equal(handOf(engine).length, handBefore.length - 1 + 1, "(the Send tactic left the hand, the found card joined it)");
  sameCards(deckOf(engine), deckBefore.filter((c) => c !== id("dItem")));
  assert.deepEqual(deckOf(engine, P2), oppDeck, "the opponent's deck is untouched");
  assert.equal(pending(engine), undefined);
});

clause(LUTEODERM, "2:rule", "any card can be found: character, item, tactic, location or resource", () => {
  for (const key of ["dChar", "dItem", "dTac", "dLoc", "dRes"]) {
    const board = luteodermBoard({ zone: "play" });
    leaveAndSearch(board);
    pickCards(board.engine, [board.id(key)]);
    assert.equal(zoneOf(board.engine, board.id(key)), "hand", key);
  }
});

clause(LUTEODERM, "2:rule", "only a card from YOUR deck can be found: the opponent's deck, your hand and your discard pile are refused, and only one card", () => {
  const board = luteodermBoard({ zone: "play" });
  const { engine, id } = board;
  leaveAndSearch(board);
  for (const key of ["oChar", "oItem", "inHand", "inDiscard", "mate", "foe", "thing"]) refused(tryPick(engine, P1, [id(key)]), key);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("oChar")), "deck");
  assert.equal(zoneOf(engine, id("inDiscard")), "discard");
  refused(tryPick(engine, P1, [id("dChar"), id("dItem")]), "it finds ONE card");
  pickCards(engine, [id("dChar")]);
  assert.equal(zoneOf(engine, id("dChar")), "hand");
});

clause(LUTEODERM, "2:rule", "it is a 'may': I can decline to search — then my hand is unchanged and the deck keeps all its cards", () => {
  const board = luteodermBoard({ zone: "play" });
  const { engine } = board;
  const handBefore = [...handOf(engine)];
  const deckBefore = [...deckOf(engine)];
  leaveAndSearch(board);
  pickCards(engine, []);
  assert.deepEqual(handOf(engine), handBefore.filter((c) => c !== board.id("sendDiscard")), "no card was added");
  sameCards(deckOf(engine), deckBefore);
  assert.equal(pending(engine), undefined);
});

clause(LUTEODERM, "2:rule", "if I do search, the searched deck is shuffled afterwards (CR 312.1)", () => {
  assert.equal(
    deckWasShuffled(
      (random) => luteodermBoard({ zone: "play", protoDeck: 8, random }),
      (g) => {
        play(g.engine, P1, g.id("sendDiscard"), { selected: { t: [g.id("host")] } });
        pickCards(g.engine, [g.id("dChar")]);
      }
    ),
    true
  );
});

clause(LUTEODERM, "2:rule", "declining the 'may' means the deck is not searched, so it is not shuffled (CR 312.1 shuffles a deck that is searched)", () => {
  assert.equal(
    deckWasShuffled(
      (random) => luteodermBoard({ zone: "play", protoDeck: 8, random }),
      (g) => {
        play(g.engine, P1, g.id("sendDiscard"), { selected: { t: [g.id("host")] } });
        pickCards(g.engine, []);
      }
    ),
    false,
    "declined: the deck keeps its order"
  );
});

clause(LUTEODERM, "2:rule", "no card is revealed: the printed text says search and put into hand, not reveal", () => {
  const board = luteodermBoard({ zone: "play" });
  leaveAndSearch(board);
  pickCards(board.engine, [board.id("dTac")]);
  assert.equal(revealEvents(board.engine).length, 0);
});

for (const [how, label] of [
  ["sendDiscard", "destroyed"],
  ["sendHand", "returned to its owner's hand"],
  ["sendDeck", "put into its owner's deck"],
  ["sendVoid", "put into the void"],
  ["sendRemove", "removed from the game"]
] as const) {
  clause(LUTEODERM, "2:rule", `fires however the host leaves play: ${label}`, () => {
    const board = luteodermBoard({ zone: "play" });
    const pc = leaveAndSearch(board, how);
    assert.ok(pc, `a search is offered when the host is ${label}`);
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    pickCards(board.engine, [board.id("dItem")]);
    assert.equal(zoneOf(board.engine, board.id("dItem")), "hand");
    assert.notEqual(zoneOf(board.engine, board.id("host")), "play");
  });
}

clause(LUTEODERM, "2:rule", "fires when the host dies of damage", () => {
  const board = luteodermBoard({ zone: "play", extraCards: [{ key: "z3", def: damageTactic(3), owner: P1, zone: "hand" }] });
  play(board.engine, P1, board.id("z3"), { selected: { t: [board.id("host")] } });
  assert.equal(zoneOf(board.engine, board.id("host")), "discard");
  assert.equal(pending(board.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(board.engine)?.playerId, P1);
});

clause(LUTEODERM, "2:rule", "does not fire when some other character leaves play", () => {
  for (const victim of ["mate", "foe"]) {
    const { engine, id } = luteodermBoard({ zone: "play" });
    play(engine, P1, id("sendDiscard"), { selected: { t: [id(victim)] } });
    assert.equal(zoneOf(engine, id(victim)), "discard");
    assert.equal(pending(engine), undefined, `no search when ${victim} leaves`);
    assert.equal(zoneOf(engine, id("lp")), "play");
    assert.equal(zoneOf(engine, id("dItem")), "deck");
  }
});

clause(LUTEODERM, "2:rule", "does not fire when only the Prototype itself leaves play (the host stays)", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("smashItem"), { selected: { t: [id("lp")] } });
  assert.equal(zoneOf(engine, id("lp")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play");
  assert.equal(pending(engine), undefined, "the attached character did not leave play");
});

clause(LUTEODERM, "2:rule", "'you' is the Prototype's controller: one I attached to an opponent's character searches MY deck when that character leaves", () => {
  const board = luteodermBoard({ zone: "play", hostOwner: P2 });
  const { engine, id } = board;
  const pc = leaveAndSearch(board);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P1, "the controller of the Prototype, not the host's owner");
  refused(tryPick(engine, P1, [id("oChar")]), "the host's owner's deck is not searched");
  pickCards(engine, [id("dChar")]);
  assert.equal(zoneOf(engine, id("dChar")), "hand");
  assert.ok(handOf(engine, P1).includes(id("dChar")), "handOf(engine, P1).includes(id(\"dChar\"))");
});

clause(LUTEODERM, "2:rule", "an opponent's Prototype on my character searches THEIR deck, not mine", () => {
  const board = luteodermBoard({ zone: "play", protoOwner: P2, hostOwner: P1 });
  const { engine, id } = board;
  const myDeck = [...deckOf(engine, P1)];
  const pc = leaveAndSearch(board);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2, "the Prototype's controller searches");
  refused(tryPick(engine, P2, [id("oChar")]), "my deck (the host owner's) is not theirs to search");
  pickCards(engine, [id("dChar")]);
  assert.ok(handOf(engine, P2).includes(id("dChar")), "handOf(engine, P2).includes(id(\"dChar\"))");
  sameCards(deckOf(engine, P1), myDeck);
});

clause(LUTEODERM, "2:rule", "a Prototype that is not attached to the leaving character stays quiet: another host's Prototype does not search", () => {
  const { engine, id } = luteodermBoard({ zone: "play", extraCards: [{ key: "lp2", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "mate" }] });
  play(engine, P1, id("sendDiscard"), { selected: { t: [id("host")] } });
  assert.ok(pending(engine), "the host's own Prototype fires");
  pickCards(engine, [id("dChar")]);
  assert.equal(pending(engine), undefined, "the other Prototype (on Mate) did not fire");
  assert.equal(zoneOf(engine, id("lp2")), "play");
});

clause(LUTEODERM, "2:rule", "two Prototypes on the same host each search when it leaves play", () => {
  const { engine, id } = luteodermBoard({ zone: "play", extraCards: [{ key: "lp2", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "host" }] });
  play(engine, P1, id("sendDiscard"), { selected: { t: [id("host")] } });
  let searches = 0;
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") {
      searches++;
      return { kind: "chooserSelectsTarget", selected: [id(searches === 1 ? "dChar" : "dItem")] };
    }
    return declineAll(pc);
  });
  assert.equal(searches, 2, "one search per Prototype");
  assert.equal(zoneOf(engine, id("dChar")), "hand");
  assert.equal(zoneOf(engine, id("dItem")), "hand");
});

clause(LUTEODERM, "2:rule", "with an empty deck nothing is found and nothing breaks", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "lp", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(pending(engine), undefined);
  assert.equal(handOf(engine).length, 0);
});

// =============================================================================
// Micromajig tokens (shared by Avalanche, Maker, Master)
// "(Treat Micromajig tokens as Gearsmith character cards with 1 strength, 1 life,
// 3 speed, and the "majig" subtype. If a Micromajig token leaves play, it
// disappears.)"
// =============================================================================

const allMicromajigs = (engine: SpoilsEngine): CardInstanceId[] => [...micromajigs(engine, P1), ...micromajigs(engine, P2)];

/** Free tactics (and a damage dealer) the Micromajig boards use to make tokens leave play, plus some deck cards for searches. */
function microExtras(): CardPlacement[] {
  return [
    { key: "sendDestroy", def: sendTactic("destroy"), owner: P1, zone: "hand" },
    { key: "sendHand", def: sendTactic("hand"), owner: P1, zone: "hand" },
    { key: "sendDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
    { key: "sendVoid", def: sendTactic("void"), owner: P1, zone: "hand" },
    { key: "sendRemove", def: sendTactic("remove"), owner: P1, zone: "hand" },
    { key: "zap1", def: damageTactic(1, "Zap1"), owner: P1, zone: "hand" },
    { key: "zap2", def: damageTactic(2, "Zap2"), owner: P1, zone: "hand" },
    { key: "fillA", def: character({ name: "FillA" }), owner: P1, zone: "deck" },
    { key: "fillB", def: character({ name: "FillB" }), owner: P1, zone: "deck" },
    { key: "fillC", def: character({ name: "FillC" }), owner: P1, zone: "deck" },
    { key: "fillD", def: item({ name: "FillD" }), owner: P1, zone: "deck" },
    { key: "fillE", def: tactic({ name: "FillE" }), owner: P1, zone: "deck" },
    { key: "fillF", def: character({ name: "FillF" }), owner: P1, zone: "deck" },
    { key: "oppFill", def: character({ name: "OppFill" }), owner: P2, zone: "deck" }
  ];
}

/** Every token is a character card named Micromajig with exactly 1 strength, 1 life and 3 speed. */
function assertMicromajigBody(engine: SpoilsEngine, tokens: CardInstanceId[]): void {
  assert.ok(tokens.length > 0, "there is at least one token to look at");
  for (const token of tokens) {
    const def = engine.getDefinition(token);
    assert.equal(def.name, "Micromajig");
    assert.equal(def.type, "character", "a character card");
    assert.deepEqual(engine.getCardTypes(token), ["character"]);
    assert.deepEqual(stats(engine, token), [1, 1, 3], "1 strength, 1 life, 3 speed");
    assert.equal(engine.state.cards[token].damage, 0);
    assert.equal(engine.state.cards[token].depleted, false);
    assert.equal(engine.state.cards[token].faceDown, false);
  }
}

/** "Gearsmith character cards": the tokens' trade is Gearsmith. */
function assertTokensAreGearsmith(engine: SpoilsEngine, tokens: CardInstanceId[]): void {
  assert.ok(tokens.length > 0, "tokens.length > 0");
  for (const token of tokens) assert.equal(engine.getDefinition(token).trade, "gearsmith");
}

/** The tokens carry the "majig" subtype. */
function assertTokensAreMajigs(engine: SpoilsEngine, tokens: CardInstanceId[]): void {
  assert.ok(tokens.length > 0, "tokens.length > 0");
  for (const token of tokens) assert.deepEqual(engine.getSubtypes(token), ["majig"]);
}

type MicroBoard = { engine: SpoilsEngine; id: IdOf };

/** "If a Micromajig token leaves play, it disappears": however a token leaves play, it never reaches a hand, deck or discard pile. */
function assertTokenLeavesTheGame(board: MicroBoard, tokens: CardInstanceId[]): void {
  const { engine, id } = board;
  const sends: Array<[string, string]> = [
    ["sendDestroy", "destroyed"],
    ["sendHand", "returned to hand"],
    ["sendDeck", "put into the deck"],
    ["sendVoid", "put into the void"],
    ["sendRemove", "removed from the game"]
  ];
  const handBefore = [...handOf(engine)];
  const deckBefore = [...deckOf(engine)];
  const discardBefore = [...discardOf(engine)];
  assert.ok(tokens.length >= sends.length, "one token for each way of leaving play");
  for (const [i, [key, label]] of sends.entries()) {
    const victim = tokens[i];
    play(engine, P1, id(key), { selected: { t: [victim] } });
    drain(engine, declineAll);
    assertTokenGone(engine, victim, label);
  }
  assert.deepEqual(discardOf(engine).filter((c) => !discardBefore.includes(c) && !sends.some(([k]) => id(k) === c)), [], "no token card entered a discard pile");
  assert.deepEqual(handOf(engine).filter((c) => !handBefore.includes(c)), [], "no token card entered the hand");
  assert.deepEqual(deckOf(engine).filter((c) => !deckBefore.includes(c)), [], "no token card entered the deck");
}

/** A token destroyed by damage: 1 life, so 1 damage kills it, and it disappears (not in the discard pile). */
function assertTokenDiesOfDamage(board: MicroBoard, token: CardInstanceId): void {
  const { engine, id } = board;
  const discardBefore = [...discardOf(engine)];
  play(engine, P1, id("zap1"), { selected: { t: [token] } });
  assertTokenGone(engine, token, "killed by 1 damage");
  assert.deepEqual(discardOf(engine).filter((c) => !discardBefore.includes(c)), [id("zap1")], "only the tactic itself went to the discard pile");
}

/** A freshly made token can block but cannot attack on the turn it entered play (it is a character). */
function assertTokenCanBlockButNotAttack(board: MicroBoard, token: CardInstanceId): void {
  const { engine, id } = board;
  refused(() => attackRaw(engine, P1, [token]), "a token put into play this turn cannot attack");
  assert.equal(battleOf(engine), undefined);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  declareAttackBy(engine, P2, [id("foe")]);
  declareBlock(engine, P1, [token]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [token], "the token blocks");
}

// =============================================================================

/** Answers a "you may ..." prompt: accept or decline, whatever shape the engine gives it. */
function answerMay(engine: SpoilsEngine, player: Pid, accept: boolean): void {
  const pc = pending(engine);
  assert.ok(pc, "a 'you may' prompt is open");
  assert.equal(pc.playerId, player, "the prompt goes to the right player");
  if (pc.kind === "mayPay") {
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "mayPay", pay: accept } } as never);
  } else if (pc.kind === "chooserSelectsOption") {
    const options = pc.options as Array<{ label?: string }>;
    const isDecline = (o: { label?: string }) => /decline|no\b|nothing/i.test(o.label ?? "");
    const index = options.findIndex((o) => (accept ? !isDecline(o) : isDecline(o)));
    assert.ok(index >= 0, "the prompt has an accept and a decline option");
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsOption", index } } as never);
  } else {
    assert.fail(`unexpected prompt kind ${pc.kind}`);
  }
  resolvePendingResponses(engine);
}

// =============================================================================
// Micromajig Master
// When this card enters play, you may put 2 Micromajig tokens into play. --
// TINY SACRIFICES -- COST: Destroy 3 Micromajig tokens you control. -- EFFECT:
// Search your deck for a card. Put it into your hand.
// Character (manager), gearsmith, cost 3, threshold [E][E], 1 / 3 / 1.
// =============================================================================

const MASTER = "a5129316-927d-44c8-98a8-88b13340457d";

/** A free tactic that puts `count` Micromajig tokens into play under `who`'s control (id `m`). */
function makeTokensTactic(count: number, who: "controller" | "opponent", name: string): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "m", type: "activated", effects: [{ type: "createTokens", controller: who, count, token: { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } }] }] }
  });
}

function masterBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; owner?: Pid; mine?: number; theirs?: number; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    cards: [
      { key: "mm", def: printing(MASTER), owner, zone: opts.zone ?? "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: owner === P1 ? P2 : P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner, zone: "play" },
      { key: "mkMine", def: makeTokensTactic(1, "controller", "MakeMine"), owner, zone: "hand" },
      ...Array.from({ length: opts.mine ?? 0 }, (_, i) => ({ key: `mkM${i}`, def: makeTokensTactic(1, "controller", `MakeMine${i}`), owner, zone: "hand" as const })),
      ...Array.from({ length: opts.theirs ?? 0 }, (_, i) => ({ key: `mkT${i}`, def: makeTokensTactic(1, "opponent", `MakeTheirs${i}`), owner, zone: "hand" as const })),
      ...microExtras(),
      ...(opts.extra ?? []),
      { key: "myHandCard", def: character({ name: "MyHandCard" }), owner, zone: "hand" },
      { key: "myDiscardCard", def: character({ name: "MyDiscardCard" }), owner, zone: "discard" },
      ...bank("elitism", opts.elitism ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
  for (let i = 0; i < (opts.mine ?? 0); i++) play(board.engine, owner, board.id(`mkM${i}`));
  for (let i = 0; i < (opts.theirs ?? 0); i++) play(board.engine, owner, board.id(`mkT${i}`));
  return board;
}

clause(MASTER, "0:rule", "when it enters play I am offered 2 tokens: accepting puts exactly two Micromajig tokens into play under my control", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  const pc = pending(engine);
  assert.ok(pc, "a prompt is offered");
  assert.equal(pc.playerId, P1, "to the Master's controller");
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 2, "exactly two tokens");
  assert.equal(micromajigs(engine, P2).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(pending(engine), undefined);
});

clause(MASTER, "0:rule", "it is a 'may': declining puts no token into play and the Master still enters play", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  answerMay(engine, P1, false);
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(pending(engine), undefined);
});

clause(MASTER, "0:rule", "nothing is offered until the Master has entered play", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  playRaw(engine, P1, id("mm"));
  assert.equal(pending(engine), undefined, "still being deployed");
  assert.equal(allMicromajigs(engine).length, 0);
  resolvePendingResponses(engine);
  assert.ok(pending(engine), "now it is in play: the offer appears");
});

clause(MASTER, "0:rule", "a Master controlled by the opponent offers THEM the tokens, and they enter under their control", () => {
  const { engine, id } = masterBoard({ zone: "hand", owner: P2 });
  play(engine, P2, id("mm"));
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2);
  answerMay(engine, P2, true);
  assert.equal(micromajigs(engine, P2).length, 2);
  assert.equal(micromajigs(engine, P1).length, 0);
});

clause(MASTER, "0:rule", "it triggers when the Master is put into play by an effect, but not when another card enters play or when the Master leaves play", () => {
  const near = masterBoard({ zone: "play" });
  play(near.engine, P1, near.id("mkMine"));
  assert.equal(pending(near.engine), undefined, "another card entering play (a token) does not trigger the Master");
  assert.equal(micromajigs(near.engine, P1).length, 1, "only the token the tactic made");
  play(near.engine, P1, near.id("sendDestroy"), { selected: { t: [near.id("mm")] } });
  assert.equal(zoneOf(near.engine, near.id("mm")), "discard");
  assert.equal(pending(near.engine), undefined, "leaving play does not trigger it");
  assert.equal(micromajigs(near.engine, P1).length, 1);
});

clause(MASTER, "0:rule", "deploys for its printed cost of 3 with [E][E] (one resource short or one [E] short is refused) and has its printed 1 / 3 / 1 stats", () => {
  const { engine, id } = masterBoard({ zone: "hand", elitism: 3 });
  const before = ready(engine);
  play(engine, P1, id("mm"));
  answerMay(engine, P1, false);
  assert.equal(before - ready(engine), 3, "cost 3");
  assert.deepEqual(stats(engine, id("mm")), [1, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("mm")), ["manager"]);
  const short = masterBoard({ zone: "hand", elitism: 2 });
  refused(() => playRaw(short.engine, P1, short.id("mm")), "one resource short");
  const oneE = masterBoard({ zone: "hand", elitism: 1, greed: 5 });
  refused(() => playRaw(oneE.engine, P1, oneE.id("mm")), "one [E] is not [E][E]", /Threshold requirements are not met/);
});

// --- TINY SACRIFICES

/** Uses TINY SACRIFICES, destroying the given tokens (leaves the search prompt open). */
function tinySacrifices(engine: SpoilsEngine, id: IdOf, tokens: CardInstanceId[], player: Pid = P1): void {
  activateRaw(engine, player, id("mm"), "tiny", { selected: { toks: tokens } });
  resolvePendingResponses(engine);
}

clause(MASTER, "1:ability:tiny", "destroys exactly 3 of my Micromajig tokens as its cost, then I search my deck and put the chosen card into my hand", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 3);
  const before = ready(engine);
  const handBefore = [...handOf(engine)];
  tinySacrifices(engine, id, tokens);
  for (const t of tokens) assertTokenGone(engine, t, "TINY SACRIFICES cost");
  const pc = pending(engine);
  assert.ok(pc, "the search is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search");
  pickCards(engine, [id("fillD")]);
  assert.equal(zoneOf(engine, id("fillD")), "hand");
  assert.deepEqual(handOf(engine).filter((c) => !handBefore.includes(c)), [id("fillD")], "exactly one card joined my hand");
  assert.equal(ready(engine), before, "no resources are spent");
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(engine.state.cards[id("mm")].depleted, false, "the Master is not depleted by its own ability");
});

clause(MASTER, "1:ability:tiny", "the cost is paid when the ability is used, before the opponent can respond; the search happens when it resolves", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  activateRaw(engine, P1, id("mm"), "tiny", { selected: { toks: tokens } });
  for (const t of tokens) assertTokenGone(engine, t, "paid up front");
  assert.equal(pending(engine), undefined, "no search yet");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "now I search");
  pickCards(engine, [id("fillA")]);
});

clause(MASTER, "1:ability:tiny", "with more than 3 tokens only the 3 chosen are destroyed; the others stay in play", () => {
  const { engine, id } = masterBoard({ mine: 5 });
  const tokens = micromajigs(engine, P1);
  const chosen = [tokens[1], tokens[3], tokens[4]];
  tinySacrifices(engine, id, chosen);
  for (const t of chosen) assertTokenGone(engine, t, "chosen");
  for (const t of [tokens[0], tokens[2]]) assert.equal(zoneOf(engine, t), "play", "an unchosen token stays");
  assert.equal(micromajigs(engine, P1).length, 2);
  pickCards(engine, [id("fillA")]);
});

clause(MASTER, "1:ability:tiny", "any search result is possible: a character, an item or a tactic", () => {
  for (const key of ["fillA", "fillD", "fillE"]) {
    const { engine, id } = masterBoard({ mine: 3 });
    tinySacrifices(engine, id, micromajigs(engine, P1));
    pickCards(engine, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "hand", key);
  }
});

clause(MASTER, "1:ability:tiny", "only a card from MY deck can be found: the opponent's deck, my hand and my discard pile are refused, and only one card", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  tinySacrifices(engine, id, micromajigs(engine, P1));
  for (const key of ["oppFill", "myHandCard", "myDiscardCard", "ally", "foe"]) refused(tryPick(engine, P1, [id(key)]), key);
  refused(tryPick(engine, P1, [id("fillA"), id("fillB")]), "one card");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(engine, [id("fillB")]);
  assert.equal(zoneOf(engine, id("fillB")), "hand");
  assert.equal(zoneOf(engine, id("oppFill")), "deck");
});

clause(MASTER, "1:ability:tiny", "'Search your deck for a card' is not optional (CR 312.2): with cards in the deck I must find one, so taking nothing is refused", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const handBefore = [...handOf(engine)];
  tinySacrifices(engine, id, micromajigs(engine, P1));
  refused(tryPick(engine, P1, []), "an unconditional search for a card must find one when the deck has any");
  assert.deepEqual(handOf(engine), handBefore);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search is still open");
});

clause(MASTER, "1:ability:tiny", "the searched deck is shuffled afterwards (CR 312.1); the opponent's deck is not touched", () => {
  const mk = (random: () => number) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      random,
      cards: [
        { key: "mm", def: printing(MASTER), owner: P1, zone: "play" },
        // D5: test corrected because the cost now accepts only real Micromajig TOKENS (isToken); the old fake "tokens" were plain characters named Micromajig.
        ...Array.from({ length: 3 }, (_, i) => ({ key: `mkM${i}`, def: makeTokensTactic(1, "controller", `MakeMine${i}`), owner: P1, zone: "hand" as const })),
        ...microExtras(),
        ...fillers("x", 6, P1, "deck")
      ]
    });
  const withTokens = (g: { engine: SpoilsEngine; id: IdOf }) => {
    for (let i = 0; i < 3; i++) play(g.engine, P1, g.id(`mkM${i}`));
    return micromajigs(g.engine, P1);
  };
  assert.equal(
    deckWasShuffled(mk, (g) => {
      tinySacrifices(g.engine, g.id, withTokens(g));
      pickCards(g.engine, [g.id("fillC")]);
    }),
    true,
    "shuffled after the search"
  );
  const theirs = deckWasShuffled(mk, (g) => {
    tinySacrifices(g.engine, g.id, withTokens(g));
    pickCards(g.engine, [g.id("fillC")]);
  }, P2);
  assert.equal(theirs, false, "the opponent's deck is not shuffled");
});

clause(MASTER, "1:ability:tiny", "no card is revealed: the printed text says search and put into hand, not reveal", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  tinySacrifices(engine, id, micromajigs(engine, P1));
  pickCards(engine, [id("fillA")]);
  assert.equal(revealEvents(engine).length, 0);
});

clause(MASTER, "1:ability:tiny", "is refused with only 2 tokens (one short), and nothing is destroyed or searched", () => {
  const { engine, id } = masterBoard({ mine: 2 });
  const tokens = micromajigs(engine, P1);
  refused(() => tinySacrifices(engine, id, tokens), "2 tokens < 3");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(pending(engine), undefined);
  refused(() => tinySacrifices(engine, id, []), "no tokens chosen");
  const none = masterBoard({ mine: 0 });
  refused(() => tinySacrifices(none.engine, none.id, []), "no tokens at all");
});

clause(MASTER, "1:ability:tiny", "needs exactly 3 chosen: 2 or 4 chosen tokens are refused even with 4 on the board", () => {
  const { engine, id } = masterBoard({ mine: 4 });
  const tokens = micromajigs(engine, P1);
  refused(() => tinySacrifices(engine, id, tokens.slice(0, 2)), "two chosen");
  refused(() => tinySacrifices(engine, id, tokens), "four chosen");
  assert.equal(micromajigs(engine, P1).length, 4, "nothing was destroyed by the refused attempts");
  tinySacrifices(engine, id, tokens.slice(0, 3));
  assert.equal(micromajigs(engine, P1).length, 1);
  pickCards(engine, [id("fillA")]);
});

clause(MASTER, "1:ability:tiny", "the same token cannot be chosen three times", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const [t] = micromajigs(engine, P1);
  refused(() => tinySacrifices(engine, id, [t, t, t]), "one token three times");
  assert.equal(micromajigs(engine, P1).length, 3);
});

clause(MASTER, "1:ability:tiny", "only tokens I CONTROL can be destroyed: the opponent's Micromajig tokens are refused", () => {
  const { engine, id } = masterBoard({ mine: 2, theirs: 2 });
  const mine = micromajigs(engine, P1);
  const theirs = micromajigs(engine, P2);
  assert.equal(mine.length, 2);
  assert.equal(theirs.length, 2);
  refused(() => tinySacrifices(engine, id, [...mine, theirs[0]]), "two of mine and one of theirs");
  refused(() => tinySacrifices(engine, id, [mine[0], theirs[0], theirs[1]]), "one of mine and two of theirs");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(micromajigs(engine, P2).length, 2);
});

clause(MASTER, "1:ability:tiny", "only Micromajig tokens count: other characters (mine or theirs), the Master itself and non-characters are refused", () => {
  const { engine, id } = masterBoard({ mine: 2 });
  const tokens = micromajigs(engine, P1);
  refused(() => tinySacrifices(engine, id, [...tokens, id("ally")]), "my other character");
  refused(() => tinySacrifices(engine, id, [...tokens, id("foe")]), "their character");
  refused(() => tinySacrifices(engine, id, [...tokens, id("mm")]), "the Master itself");
  assert.equal(zoneOf(engine, id("ally")), "play");
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(MASTER, "1:ability:tiny", "a depleted token can still be destroyed for the cost", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  engine.state.cards[tokens[0]].depleted = true;
  tinySacrifices(engine, id, tokens);
  for (const t of tokens) assertTokenGone(engine, t, "cost");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
});

clause(MASTER, "1:ability:tiny", "can be used again: 6 tokens pay for it twice", () => {
  const { engine, id } = masterBoard({ mine: 6 });
  const tokens = micromajigs(engine, P1);
  tinySacrifices(engine, id, tokens.slice(0, 3));
  pickCards(engine, [id("fillA")]);
  tinySacrifices(engine, id, tokens.slice(3, 6));
  pickCards(engine, [id("fillB")]);
  assert.equal(micromajigs(engine, P1).length, 0);
  assert.equal(zoneOf(engine, id("fillA")), "hand");
  assert.equal(zoneOf(engine, id("fillB")), "hand");
});

clause(MASTER, "1:ability:tiny", "only the Master's controller can use it, and only while it is in play", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  refused(() => tinySacrifices(engine, id, tokens, P2), "the opponent", /control|own|activate|yours?/i);
  assert.equal(micromajigs(engine, P1).length, 3);
  const inHand = masterBoard({ zone: "hand", mine: 3 });
  refused(() => tinySacrifices(inHand.engine, inHand.id, micromajigs(inHand.engine, P1)), "the Master is in hand");
  assert.equal(micromajigs(inHand.engine, P1).length, 3);
});

clause(MASTER, "1:ability:tiny", "a token that is destroyed as the cost disappears (it is not put into my discard pile)", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const discardBefore = [...discardOf(engine)];
  tinySacrifices(engine, id, micromajigs(engine, P1));
  pickCards(engine, [id("fillA")]);
  assert.deepEqual(discardOf(engine), discardBefore, "no token entered my discard pile");
});

clause(MASTER, "0:rule", "the tokens are character cards named Micromajig with 1 strength, 1 life and 3 speed", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  assertMicromajigBody(engine, micromajigs(engine, P1));
});

clause(MASTER, "0:rule", "the tokens are GEARSMITH character cards", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  assertTokensAreGearsmith(engine, micromajigs(engine, P1));
});

clause(MASTER, "0:rule", "the tokens carry the majig subtype", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  assertTokensAreMajigs(engine, micromajigs(engine, P1));
});

clause(MASTER, "0:rule", "when they leave play (destroyed, bounced, decked, voided, removed) they disappear: never in a hand, deck or discard pile", () => {
  const board = masterBoard({ zone: "hand", mine: 3 });
  play(board.engine, P1, board.id("mm"));
  answerMay(board.engine, P1, true);
  assertTokenLeavesTheGame(board, micromajigs(board.engine, P1));
});

clause(MASTER, "0:rule", "a token dies to 1 damage and disappears, not put into the discard pile", () => {
  const board = masterBoard({ zone: "hand" });
  play(board.engine, P1, board.id("mm"));
  answerMay(board.engine, P1, true);
  const [token, second] = micromajigs(board.engine, P1);
  assertTokenDiesOfDamage(board, token);
  assert.equal(zoneOf(board.engine, second), "play");
});

clause(MASTER, "0:rule", "a token is a character: it can block, but it cannot attack the turn it enters play", () => {
  const board = masterBoard({ zone: "hand" });
  play(board.engine, P1, board.id("mm"));
  answerMay(board.engine, P1, true);
  assertTokenCanBlockButNotAttack(board, micromajigs(board.engine, P1)[0]);
});

// --- added after the mutation check ------------------------------------------



clause(MASTER, "1:ability:tiny", "the tokens are DESTROYED (not merely removed): a 'when a card is destroyed' watcher sees all 3", () => {
  const watcher = item({
    name: "Destruction Watcher",
    behavior: { abilities: [{ id: "watch", type: "triggered", event: "cardDestroyed", effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }] }
  });
  const { engine, id } = masterBoard({ mine: 3, extra: [{ key: "watcher", def: watcher, owner: P1, zone: "play" }] });
  const before = engine.state.players[P1].influence;
  tinySacrifices(engine, id, micromajigs(engine, P1));
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("fillA")] } : declineAll(pc)));
  assert.equal(engine.state.players[P1].influence, before - 3, "one 'destroyed' event per token");
  assert.equal(zoneOf(engine, id("fillA")), "hand");
});

// @@END@@
}

// ---- ported from seed-2-01.test.ts (Inadequate Wand) ----
{

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ obsession: 2, greed: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const playOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].play];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;

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

/** Raw `flipUp` WITHOUT draining the response window. */
function flipUpRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables });
}

/** The sole open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
function pickTargets(selected: CardInstanceId[]) {
  return (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc));
}

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** A player responds to the open window by playing a tactic from hand; the chain is then drained. */
function respondWith(
  engine: SpoilsEngine,
  responder: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "playCard", playerId: responder, cardId, selected, variables } as never);
  resolvePendingResponses(engine);
}

/** A free tactic (id "pump", pick "t"): the picked character gets `amount` strength this turn. */
function pumpTactic(amount: number, name = `Pump ${amount}`): CardDefinition {
  return tactic({
    name,
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
}

/** A free tactic (id "mv", pick "t"): moves one picked card in play to `to` (top of the deck when `to` is "deck"). */
function moverTactic(to: Zone, name = `Mover to ${to}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mv",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to, position: "top" }]
        }
      ]
    }
  });
}

/** A free tactic (id "rm", pick "t"): removes one picked card in play from the game. */
function removerTactic(name = "Remover"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "rm",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play" }, count: 1 }],
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** An item that attaches to a character and adds `amount` strength to it. */
function strengthGear(amount: number, name = `Gear ${amount}`): CardDefinition {
  return item({
    name,
    attachTo: "character",
    behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: amount }] }] }
  });
}


// =================================================================================
// Inadequate Wand
// PRESENT THE STAFF -- COST: Pay 2. Deplete this card. Pick a character you control. --
// EFFECT: Put the character into its owner's hand if you can. If you do, X is its numeric
// cost. You may search your deck for a tactic with numeric cost X or less and reveal it.
// If you do, put it into your hand.
// Item, cost 2, [O][O].
// =================================================================================

const WAND = "5d8f9fae-ba4c-4673-87ff-fe4db6493ab0";
const STAFF = "present-the-staff";

/** A deterministic random source (mulberry32) so every shuffle / random pick in a test is reproducible. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wandBoard(
  opts: {
    icons?: Icons;
    depleted?: boolean;
    wand?: "play" | "hand" | "discard";
    random?: () => number;
    extra?: CardPlacement[];
    deckTactics?: number[];
    turn?: number;
    active?: PlayerId;
  } = {}
) {
  const costs = opts.deckTactics ?? [0, 1, 2, 3, 4, 5];
  return devBoard(
    [
      { key: "wand", def: printing(WAND), owner: P1, zone: opts.wand ?? "play", depleted: opts.depleted },
      { key: "c0", def: character({ name: "Cost Zero", cost: 0 }), owner: P1, zone: "play" },
      { key: "c3", def: character({ name: "Cost Three", cost: 3 }), owner: P1, zone: "play" },
      { key: "c5", def: character({ name: "Cost Five", cost: 5, life: 4 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 2 }), owner: P2, zone: "play" },
      { key: "captured", def: character({ name: "Captured", cost: 4 }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent Out", cost: 4 }), owner: P1, controller: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing", cost: 1 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", cost: 1 }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand", cost: 1 }), owner: P1, zone: "hand" },
      { key: "inDisc", def: character({ name: "In Discard", cost: 1 }), owner: P1, zone: "discard" },
      // my deck: tactics of every cost, plus things that are not tactics
      ...costs.map((cost) => ({ key: `t${cost}`, def: tactic({ name: `Tactic ${cost}`, cost }), owner: P1, zone: "deck" as const })),
      { key: "dchar", def: character({ name: "Deck Character", cost: 0 }), owner: P1, zone: "deck" },
      { key: "ditem", def: item({ name: "Deck Item", cost: 0 }), owner: P1, zone: "deck" },
      { key: "oppTac", def: tactic({ name: "Their Tactic", cost: 0 }), owner: P2, zone: "deck" },
      { key: "handTac", def: tactic({ name: "Hand Tactic", cost: 0 }), owner: P1, zone: "hand" },
      { key: "discTac", def: tactic({ name: "Discard Tactic", cost: 0 }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active, random: opts.random ?? mulberry(2024) }
  );
}

type WandGame = ReturnType<typeof wandBoard>;
const staff = (g: WandGame, pick: CardInstanceId) => activate(g.engine, P1, g.id("wand"), STAFF, { selected: { char: [pick] } });
const staffAttempt = (g: WandGame, pick?: CardInstanceId, player: PlayerId = P1) => () =>
  actRaw(g.engine, player, g.id("wand"), STAFF, pick ? { char: [pick] } : {});
/** Uses the staff on `pick`, and answers the search prompt with `found` (undefined = find nothing). */
function staffFinding(g: WandGame, pick: CardInstanceId, found?: CardInstanceId): void {
  staff(g, pick);
  const pc = expectPending(g.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search my own deck");
  answerPending(g.engine, "chooserSelectsTarget", { selected: found ? [found] : [] });
  assert.equal(g.engine.state.pendingChoice, undefined);
}

const revealsIn = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

clause(WAND, "0:ability:present-the-staff", "puts the picked character into its owner's hand, then I search for a tactic of cost X or less (X = 3) and put it into my hand", () => {
  const g = wandBoard();
  staffFinding(g, g.id("c3"), g.id("t3"));
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand", "the character is back in hand");
  assert.ok(handOf(g.engine, P1).includes(g.id("c3")), "handOf(g.engine, P1).includes(g.id(\"c3\"))");
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand", "the found tactic is in my hand (not played)");
  assert.equal(g.engine.state.cards[g.id("c3")].damage, 0);
});

clause(WAND, "0:ability:present-the-staff", "COST: Pay 2 and Deplete this card -- exactly two resources are paid and the Wand is depleted", () => {
  const g = wandBoard();
  const before = ready(g.engine);
  staff(g, g.id("c3"));
  assert.equal(before - ready(g.engine), 2);
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, true);
  assert.equal(zoneOf(g.engine, g.id("wand")), "play", "the Wand stays in play");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
});

clause(WAND, "0:ability:present-the-staff", "X is the character's numeric cost: with cost 3, tactics of cost 0, 1, 2 and 3 can be found", () => {
  for (const cost of [0, 1, 2, 3]) {
    const g = wandBoard();
    staffFinding(g, g.id("c3"), g.id(`t${cost}`));
    assert.equal(zoneOf(g.engine, g.id(`t${cost}`)), "hand", `a cost-${cost} tactic is found with X = 3`);
  }
});

clause(WAND, "0:ability:present-the-staff", "a tactic with a numeric cost above X cannot be found: with X = 3 the cost-4 and cost-5 tactics are refused", () => {
  const g = wandBoard();
  staff(g, g.id("c3"));
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t4")] }), "a cost-4 tactic");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t5")] }), "a cost-5 tactic");
  assert.equal(zoneOf(g.engine, g.id("t4")), "deck");
  assert.ok(pending(g.engine), "the search is still open");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t3")] });
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand", "control: a cost-3 tactic is found");
});

clause(WAND, "0:ability:present-the-staff", "X changes with the character: a cost-5 character lets me find the cost-5 tactic", () => {
  const g = wandBoard();
  staffFinding(g, g.id("c5"), g.id("t5"));
  assert.equal(zoneOf(g.engine, g.id("t5")), "hand");
  assert.equal(zoneOf(g.engine, g.id("c5")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "X = 0 (a cost-0 character): only a cost-0 tactic can be found, the cost-1 tactic is refused", () => {
  const g = wandBoard();
  staff(g, g.id("c0"));
  expectPending(g.engine, "chooserSelectsTarget");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t1")] }), "a cost-1 tactic with X = 0");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t0")] });
  assert.equal(zoneOf(g.engine, g.id("t0")), "hand", "control: the cost-0 tactic is found");
  assert.equal(zoneOf(g.engine, g.id("c0")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "only TACTICS can be found: a character or an item in my deck is refused even at cost 0", () => {
  const g = wandBoard();
  staff(g, g.id("c3"));
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("dchar")] }), "a character card");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("ditem")] }), "an item card");
  assert.equal(zoneOf(g.engine, g.id("dchar")), "deck");
  assert.ok(pending(g.engine), "pending(g.engine)");
});

clause(WAND, "0:ability:present-the-staff", "the search is of MY deck only: a tactic in my hand, my discard pile or my opponent's deck is refused", () => {
  const g = wandBoard();
  staff(g, g.id("c3"));
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("handTac")] }), "a tactic in my hand");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("discTac")] }), "a tactic in my discard pile");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oppTac")] }), "a tactic in my opponent's deck");
  assert.equal(zoneOf(g.engine, g.id("oppTac")), "deck");
  assert.ok(pending(g.engine), "pending(g.engine)");
});

clause(WAND, "0:ability:present-the-staff", "'a tactic': at most one card is found; two tactics are refused", () => {
  const g = wandBoard();
  staff(g, g.id("c3"));
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t1"), g.id("t2")] }), "two tactics");
  assert.equal(zoneOf(g.engine, g.id("t1")), "deck");
  assert.equal(zoneOf(g.engine, g.id("t2")), "deck");
});

clause(WAND, "0:ability:present-the-staff", "'You may search': I can decline to find anything; the character still goes to my hand and no tactic is added", () => {
  const g = wandBoard();
  const handBefore = handOf(g.engine, P1).length;
  staffFinding(g, g.id("c3"));
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(handOf(g.engine, P1).length, handBefore + 1, "only the character was added to my hand");
  for (const key of ["t0", "t1", "t2", "t3", "t4", "t5"]) assert.equal(zoneOf(g.engine, g.id(key)), "deck", `${key} stays in the deck`);
});

clause(WAND, "0:ability:present-the-staff", "a deck with no tactic of cost X or less: the character still goes to my hand and nothing is found", () => {
  const g = wandBoard({ deckTactics: [4, 5] });
  staff(g, g.id("c3"));
  if (pending(g.engine)) answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(zoneOf(g.engine, g.id("t4")), "deck");
  assert.equal(zoneOf(g.engine, g.id("t5")), "deck");
});

clause(WAND, "0:ability:present-the-staff", "the found tactic is revealed (the reveal is recorded for my opponent to see)", () => {
  const g = wandBoard();
  staffFinding(g, g.id("c3"), g.id("t2"));
  const reveals = revealsIn(g.engine);
  assert.ok(reveals.some((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds.includes(g.id("t2"))), "a reveal of the found tactic was recorded");
});

clause(WAND, "0:ability:present-the-staff", "the deck is shuffled after the search (CR 312.1): the resulting order depends on the random source", () => {
  const rotating = wandBoard({ random: () => 0 });
  const identity = wandBoard({ random: () => 0.9999999 });
  staffFinding(rotating, rotating.id("c3"), rotating.id("t3"));
  staffFinding(identity, identity.id("c3"), identity.id("t3"));
  const names = (g: WandGame) => deckOf(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  assert.deepEqual([...names(rotating)].sort(), [...names(identity)].sort(), "same cards left in the deck");
  assert.notDeepEqual(names(rotating), names(identity), "...but in an order that depends on the random source: the deck was shuffled");
});

clause(WAND, "0:ability:present-the-staff", "the deck is also shuffled when the search finds nothing (CR 312.1: a searched deck is shuffled)", () => {
  const rotating = wandBoard({ random: () => 0 });
  const identity = wandBoard({ random: () => 0.9999999 });
  staffFinding(rotating, rotating.id("c3"));
  staffFinding(identity, identity.id("c3"));
  const names = (g: WandGame) => deckOf(g.engine, P1).map((c) => g.engine.getDefinition(c).name);
  assert.notDeepEqual(names(rotating), names(identity), "the deck order depends on the random source: it was shuffled");
});

clause(WAND, "0:ability:present-the-staff", "'its owner's hand': a character I control but my opponent owns goes to ITS OWNER's hand, and X is its cost (4)", () => {
  const g = wandBoard();
  staff(g, g.id("captured"));
  expectPending(g.engine, "chooserSelectsTarget");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t4")] });
  assert.equal(zoneOf(g.engine, g.id("captured")), "hand");
  assert.ok(handOf(g.engine, P2).includes(g.id("captured")), "in its owner's (my opponent's) hand");
  assert.equal(handOf(g.engine, P1).includes(g.id("captured")), false);
  assert.equal(zoneOf(g.engine, g.id("t4")), "hand", "a cost-4 tactic is findable with X = 4");
  assert.ok(handOf(g.engine, P1).includes(g.id("t4")), "the found tactic goes into MY hand");
});

clause(WAND, "0:ability:present-the-staff", "the returned character leaves play undamaged and undepleted", () => {
  const g = wandBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", cost: 1, life: 9 }), owner: P1, zone: "play", damage: 4, depleted: true }] });
  staffFinding(g, g.id("hurt"));
  assert.equal(zoneOf(g.engine, g.id("hurt")), "hand");
  assert.equal(g.engine.state.cards[g.id("hurt")].damage, 0);
  assert.equal(g.engine.state.cards[g.id("hurt")].depleted, false);
});

clause(WAND, "0:ability:present-the-staff", "an item attached to the picked character follows it to its owner's hand (CR 301.4a), it is not sent to the discard pile", () => {
  const gear = item({ name: "Gear", attachTo: "character", behavior: { abilities: [{ id: "g", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 1 }] }] } });
  const g = wandBoard({ extra: [{ key: "gear", def: gear, owner: P1, zone: "play", attachedToKey: "c3" }] });
  staffFinding(g, g.id("c3"));
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(zoneOf(g.engine, g.id("gear")), "hand", "attached cards leave play the same way the host does: into its owner's hand");
});

clause(WAND, "0:ability:present-the-staff", "only the picked character moves: every other card in play stays", () => {
  const g = wandBoard();
  staffFinding(g, g.id("c3"), g.id("t1"));
  for (const key of ["c0", "c5", "foe", "captured", "lent", "thing", "place", "wand"]) assert.equal(zoneOf(g.engine, g.id(key)), "play", `${key} stays`);
});

// picks

clause(WAND, "0:ability:present-the-staff", "cannot pick my opponent's character, nor one I own but my opponent controls; nothing is paid", () => {
  const g = wandBoard();
  refused(staffAttempt(g, g.id("foe")), "an opponent's character");
  refused(staffAttempt(g, g.id("lent")), "my character under their control");
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
  assert.equal(ready(g.engine), 4, "nothing was paid");
  staffFinding(g, g.id("c3"));
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand", "control: my own character works");
});

clause(WAND, "0:ability:present-the-staff", "only characters: an item, a location, a faction and a face-down card are refused", () => {
  const g = wandBoard({ extra: [{ key: "fd", def: character({ name: "Hidden", cost: 2 }), owner: P1, zone: "play", faceDown: true }] });
  refused(staffAttempt(g, g.id("thing")), "an item");
  refused(staffAttempt(g, g.id("place")), "a location");
  refused(staffAttempt(g, g.id("wand")), "the Wand itself");
  refused(staffAttempt(g, g.engine.state.players[P1].factionId!), "my faction");
  refused(staffAttempt(g, g.id("fd")), "a face-down card");
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
  assert.equal(ready(g.engine), 5, "nothing was paid (4 resources and the face-down card)");
});

clause(WAND, "0:ability:present-the-staff", "only characters in play: a character in my hand or my discard pile is refused", () => {
  const g = wandBoard();
  refused(staffAttempt(g, g.id("inHand")), "a character in my hand");
  refused(staffAttempt(g, g.id("inDisc")), "a character in my discard pile");
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
});

clause(WAND, "0:ability:present-the-staff", "needs exactly one pick: none or two are refused", () => {
  const g = wandBoard();
  refused(staffAttempt(g), "no pick");
  refused(() => actRaw(g.engine, P1, g.id("wand"), STAFF, { char: [g.id("c3"), g.id("c5")] }), "two picks");
  assert.equal(zoneOf(g.engine, g.id("c3")), "play");
  assert.equal(zoneOf(g.engine, g.id("c5")), "play");
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
});

// costs

clause(WAND, "0:ability:present-the-staff", "COST: Pay 2 -- one ready resource is refused (nothing depleted), exactly two work", () => {
  const short = wandBoard({ icons: { greed: 1 } });
  refused(staffAttempt(short, short.id("c3")), "1 resource for Pay 2");
  assert.equal(short.engine.state.cards[short.id("wand")].depleted, false);
  assert.equal(zoneOf(short.engine, short.id("c3")), "play");
  assert.equal(ready(short.engine), 1);
  const exact = wandBoard({ icons: { greed: 2 } });
  staffFinding(exact, exact.id("c3"));
  assert.equal(zoneOf(exact.engine, exact.id("c3")), "hand");
  assert.equal(ready(exact.engine), 0);
});

clause(WAND, "0:ability:present-the-staff", "COST: Pay 2 -- resources already spent do not count (3 resources, 2 attached: refused)", () => {
  const bad = wandBoard({ icons: { greed: 1 }, extra: res({ greed: 2 }).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  refused(staffAttempt(bad, bad.id("c3")), "only 1 ready");
  assert.equal(bad.engine.state.cards[bad.id("wand")].depleted, false);
});

clause(WAND, "0:ability:present-the-staff", "the ability has no threshold of its own: two resources of any icon pay for it", () => {
  const g = wandBoard({ icons: { rage: 2 } });
  staffFinding(g, g.id("c3"), g.id("t3"));
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "COST: Deplete this card -- a depleted Wand cannot use it (nothing is paid), and one use depletes it", () => {
  const bad = wandBoard({ depleted: true });
  refused(staffAttempt(bad, bad.id("c3")), "the Wand is depleted");
  assert.equal(ready(bad.engine), 4);
  assert.equal(zoneOf(bad.engine, bad.id("c3")), "play");
  const good = wandBoard();
  staffFinding(good, good.id("c3"));
  refused(staffAttempt(good, good.id("c5")), "depleted after one use");
});

clause(WAND, "0:ability:present-the-staff", "the Wand untaps at the start of my next turn and can be used again", () => {
  const g = wandBoard({ icons: { greed: 2 } });
  staffFinding(g, g.id("c3"));
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, false);
  staffFinding(g, g.id("c5"));
  assert.equal(zoneOf(g.engine, g.id("c5")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "can only be used from play: refused while the Wand is in my hand or discard pile", () => {
  for (const zone of ["hand", "discard"] as const) {
    const bad = wandBoard({ wand: zone });
    refused(staffAttempt(bad, bad.id("c3")), `from ${zone}`);
    assert.equal(zoneOf(bad.engine, bad.id("c3")), "play");
    assert.equal(ready(bad.engine), 4);
  }
});

clause(WAND, "0:ability:present-the-staff", "only its controller can use it: my opponent cannot activate my Wand", () => {
  const g = wandBoard({ turn: 1, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }, ...res({ greed: 2 }, P2)] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P2);
  refused(staffAttempt(g, g.id("foe"), P2), "the opponent using my Wand", /control|own|cannot|illegal|only|not.*yours/i);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
});

clause(WAND, "0:ability:present-the-staff", "can be used in response on the opponent's turn (it is an ability, CR 502.3)", () => {
  const g = wandBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(staffAttempt(g, g.id("c3")), "no response window yet");
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  assert.equal(g.engine.state.priorityPlayerId, P1);
  actRaw(g.engine, P1, g.id("wand"), STAFF, { char: [g.id("c3")] });
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t3")] });
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "the costs (pay, deplete, pick) are paid when the ability is used, before the opponent can respond; the character moves only when it resolves", () => {
  const g = wandBoard();
  staffAttempt(g, g.id("c3"))();
  assert.equal(g.engine.state.priorityPlayerId, P2, "my opponent may respond");
  assert.equal(ready(g.engine), 2);
  assert.equal(g.engine.state.cards[g.id("wand")].depleted, true);
  assert.equal(zoneOf(g.engine, g.id("c3")), "play", "the effect has not happened yet");
  resolvePendingResponses(g.engine);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
});

clause(WAND, "0:ability:present-the-staff", "'Put the character into its owner's hand IF YOU CAN. If you do, ...': a picked character destroyed in response stays in the discard pile and X is not set, so no search is offered", () => {
  const g = wandBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  staffAttempt(g, g.id("c3"))();
  respondWith(g.engine, P2, g.id("kill"), { t: [g.id("c3")] });
  assert.equal(zoneOf(g.engine, g.id("c3")), "discard", "destroyed in response: it cannot be put into a hand from the discard pile (CR 402.4)");
  assert.equal(g.engine.state.pendingChoice, undefined, "the character was not put into a hand, so 'if you do' fails and there is no search");
  assert.equal(zoneOf(g.engine, g.id("t3")), "deck");
});

clause(WAND, "0:ability:present-the-staff", "the ability resolves as written even if the Wand is destroyed or leaves play in response (CR 502.4)", () => {
  const g = wandBoard({ extra: [{ key: "mover", def: moverTactic("hand"), owner: P2, zone: "hand" }] });
  staffAttempt(g, g.id("c3"))();
  respondWith(g.engine, P2, g.id("mover"), { t: [g.id("wand")] });
  assert.equal(zoneOf(g.engine, g.id("wand")), "hand", "control: the Wand left play in response");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t3")] });
  assert.equal(zoneOf(g.engine, g.id("c3")), "hand");
  assert.equal(zoneOf(g.engine, g.id("t3")), "hand");
});

}

// ---- ported from holy-heist-03.p2.test.ts (Gargoyle of Cathedrale de Mau) ----
{
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
// Gargoyle of Cathédrale de Mau — character, banker, cost 6, [G][G], 4 strength / 0 speed / 4 life
// "EXTRA COST: Your faction loses 3 influence. Draw 3 cards. -- While this card is in your hand and a
//  location you control is being attacked, this card gains tactical. -- NO. COST: Discard 2 cards.
//  EFFECT: Your faction gains 2 influence. Put this card into its owner's hand."
// =====================================================================================

const GARG = "0631179c-238a-4a99-ac85-9e7bd9ee0003";

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

}

// ---- ported from seed-3-02.p2.test.ts (Iohane (and Ipsighast UNIQUE)) ----
{
type Game = ReturnType<typeof buildGame>;
const handOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].hand];
const deckOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].deck];
const discardOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] => [...engine.state.players[p].discard];
const damageOf = (engine: SpoilsEngine, c: CardInstanceId): number => engine.state.cards[c].damage;
const controllerOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].controllerId;
const eventsOf = (engine: SpoilsEngine, type: string): Array<Record<string, unknown>> =>
  engine
    .getLog()
    .map((entry) => entry.event as unknown as Record<string, unknown> | undefined)
    .filter((event): event is Record<string, unknown> => !!event && event.type === type);

/** A tactic that does nothing: playing it opens a response window for the opponent. */
const nothingTactic = () => tactic({ name: "Nothing", cost: 0 });
/** "Destroy target <type> in play" (cost 0). */
const destroyTactic = (type: "character" | "item" | "location" = "character") =>
  tactic({
    name: `Destroy ${type}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }
      ]
    }
  });
/** "Inflict <amount> damage to target character" (cost 0). */
const zapTactic = (amount: number) =>
  tactic({
    name: `Zap ${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        { id: "z", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }
      ]
    }
  });
/** "Put a token on target character" (cost 0). */
const addTokenTactic = () =>
  tactic({
    name: "Add Token",
    cost: 0,
    behavior: {
      abilities: [
        { id: "a", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }] }
      ]
    }
  });
/** "Return target character to its owner's hand" (cost 0). */
const bounceTactic = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        { id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }
      ]
    }
  });

/** `n` resources of `icon` for `owner`, the first `spent` of them already spent (attached to the owner's faction). */
function bankSpent(icon: Icon, n: number, spent: number, owner: Pid = P1): CardPlacement[] {
  return bank(icon, n, owner).map((placement, index) => (index < spent ? { ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" } : placement));
}

// --- UNIQUE (RULES.md §9, CR 507.5): shared board and bodies --------------------

function uniqueBoard(pid: string, icon: Icon, n: number, over: { oldCounters?: Record<string, number>; noOld?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      ...(over.noOld ? [] : [{ key: "old", def: printing(pid), owner: P1, zone: "play" as const, counters: over.oldCounters ?? {} }]),
      { key: "new", def: printing(pid), owner: P1, zone: "hand" },
      ...bank(icon, n, P1),
      ...(over.extra ?? [])
    ]
  });
}
const keepSurvivor = (engine: SpoilsEngine, keep: CardInstanceId): void =>
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep } } as never);

function uniqueKeepNew(pid: string, icon: Icon, n: number, oldCounters: Record<string, number> = {}): void {
  const g = uniqueBoard(pid, icon, n, { oldCounters });
  play(g.engine, P1, g.id("new"));
  const pc = pending(g.engine);
  assert.ok(pc, "a choice is pending");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [g.id("old"), g.id("new")].sort());
  keepSurvivor(g.engine, g.id("new"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("new")), "play");
  assert.equal(zoneOf(g.engine, g.id("old")), "discard", "the extra copy is destroyed");
}
function uniqueKeepOld(pid: string, icon: Icon, n: number, oldCounters: Record<string, number> = {}): void {
  const g = uniqueBoard(pid, icon, n, { oldCounters });
  play(g.engine, P1, g.id("new"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
  keepSurvivor(g.engine, g.id("old"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("old")), "play");
  assert.equal(zoneOf(g.engine, g.id("new")), "discard");
  for (const [counter, count] of Object.entries(oldCounters)) assert.equal(g.engine.state.cards[g.id("old")].counters[counter], count, "the survivor keeps its counters");
}
function uniqueBystanderRefused(pid: string, icon: Icon, n: number): void {
  const g = uniqueBoard(pid, icon, n, { extra: [{ key: "by", def: character({ name: "Bystander" }), owner: P1, zone: "play" }] });
  play(g.engine, P1, g.id("new"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
  refused(() => keepSurvivor(g.engine, g.id("by")), "a bystander cannot be the survivor", /unique|survivor|candidate|keep|choice/i);
  assert.equal(zoneOf(g.engine, g.id("by")), "play");
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor", "still waiting for a legal choice");
  keepSurvivor(g.engine, g.id("new"));
  assert.equal(g.engine.state.pendingChoice, undefined, "control: a real candidate is accepted");
}
/** UNIQUE is per player and per identifier: the opponent's own copy and a different identifier are no problem. */
function uniqueScope(pid: string, icon: Icon, n: number): void {
  const theirs = uniqueBoard(pid, icon, n, { noOld: true, extra: [{ key: "theirs", def: printing(pid), owner: P2, zone: "play" }] });
  play(theirs.engine, P1, theirs.id("new"));
  assert.equal(theirs.engine.state.pendingChoice, undefined, "the opponent's copy does not count against me");
  assert.equal(zoneOf(theirs.engine, theirs.id("new")), "play");
  assert.equal(zoneOf(theirs.engine, theirs.id("theirs")), "play");
  const diff = uniqueBoard(pid, icon, n, { noOld: true, extra: [{ key: "other", def: character({ name: "Other Unique", unique: "somethingelse" }), owner: P1, zone: "play" }] });
  play(diff.engine, P1, diff.id("new"));
  assert.equal(diff.engine.state.pendingChoice, undefined, "a different identifier is not a second copy");
  assert.equal(zoneOf(diff.engine, diff.id("other")), "play");
  const two = uniqueBoard(pid, icon, n);
  play(two.engine, P1, two.id("new"));
  assert.equal(pending(two.engine)?.kind, "uniqueSurvivor", "control: my own second copy does prompt");
}
/** Once the survivor is chosen the deployment finishes: no stuck response window. */
function uniqueFinishes(pid: string, icon: Icon, n: number): void {
  const g = uniqueBoard(pid, icon, n);
  play(g.engine, P1, g.id("new"));
  assert.equal(pending(g.engine)?.kind, "uniqueSurvivor");
  keepSurvivor(g.engine, g.id("new"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.responseWindow, undefined, "no stuck response window");
  assert.equal(g.engine.state.pendingChoice, undefined);
}

/** Attacks with `atk` (P1) and tries to block it with `blk` (P2): true when the block is legal. */
function canBlock(game: Game, atkKey: string, blkKey: string): boolean {
  declareAttackBy(game.engine, P1, [game.id(atkKey)]);
  try {
    declareBlockers(game.engine, P2, [game.id(blkKey)]);
  } catch {
    return false;
  }
  return (battleOf(game.engine)?.blockingParty ?? []).includes(game.id(blkKey));
}

// =================================================================================
// Iohane, the Convex
// UNIQUE IOHANE. You may play this card whenever you could play a tactic. At the start of your turn, flip a coin. If you win, draw a card.
// SNEAK -- COST: Pay 1. -- EFFECT: This card gains COVERT this turn.
// Character, rogue, subtype iohane / sword of great justice, cost 1, threshold [D][D][D], 2/4/2 (str/spd/life).
// =================================================================================

const IOHANE = "026e82f8-c90c-4646-a87b-0c53020f2272";
const WIN = () => 0; // the coin is won when random() < 0.5
const LOSE = () => 0.99;

function ioBoard(opts: { deception?: number; rage?: number; spent?: number; active?: Pid; ioZone?: "hand" | "play"; random?: () => number; tactics?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random,
    cards: [
      { key: "io", def: printing(IOHANE), owner: P1, zone: opts.ioZone ?? "hand" },
      ...bankSpent("deception", opts.deception ?? 3, opts.spent ?? 0, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.tactics === false
        ? []
        : [
            { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" as const },
            { key: "plain", def: character({ name: "PlainChar", cost: 0 }), owner: P1, zone: "hand" as const },
            { key: "oppAtk", def: character({ name: "OppAttacker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" as const }
          ]),
      ...(opts.extra ?? [])
    ]
  });
}

clause(IOHANE, "0:unique", "has UNIQUE IOHANE: a second Iohane under my control makes me choose one to keep; keeping the new one destroys the old one", () => uniqueKeepNew(IOHANE, "deception", 3));
clause(IOHANE, "0:unique", "I can keep the older Iohane instead; the new one is destroyed", () => uniqueKeepOld(IOHANE, "deception", 3));
clause(IOHANE, "0:unique", "only a candidate can be kept: an unrelated card is refused and the choice stays open", () => uniqueBystanderRefused(IOHANE, "deception", 3));
clause(IOHANE, "0:unique", "UNIQUE is per player and per identifier: the opponent's own Iohane and a different identifier are no problem", () => uniqueScope(IOHANE, "deception", 3));
clause(IOHANE, "0:unique", "after I choose which Iohane to keep, the deployment finishes: the response window closes", () => uniqueFinishes(IOHANE, "deception", 3));

clause(IOHANE, "0:kw:TACTICAL", "she has TACTICAL (an ordinary character does not), in hand", () => {
  const { engine, id } = ioBoard();
  assert.ok(engine.getKeywords(id("io")).includes("tactical"), "engine.getKeywords(id(\"io\")).includes(\"tactical\")");
  assert.equal(engine.getKeywords(id("plain")).includes("tactical"), false, "control: an ordinary character has no TACTICAL");
});

clause(IOHANE, "0:kw:TACTICAL", "whenever a tactic could be played (in response on the opponent's turn) I can play her from my hand: she enters play under my control as a 2/4/2 and the cost of 1 is paid", () => {
  const g = ioBoard({ active: P2 });
  playRaw(g.engine, P2, g.id("nothing"));
  playRaw(g.engine, P1, g.id("io"));
  resolvePendingResponses(g.engine);
  const { engine, id } = g;
  assert.equal(zoneOf(engine, id("io")), "play");
  assert.equal(controllerOf(engine, id("io")), P1);
  assert.equal(engine.getStat(id("io"), "strength"), 2);
  assert.equal(engine.getStat(id("io"), "speed"), 4);
  assert.equal(engine.getStat(id("io"), "life"), 2);
  assert.equal(engine.getAvailableResourceCount(P1), 2, "one of my three resources was spent");
});

clause(IOHANE, "0:kw:TACTICAL", "when no tactic could be played (the opponent's turn, nothing to respond to) she cannot be played; an ordinary character cannot be played in a response window", () => {
  const { engine, id } = ioBoard({ active: P2 });
  refused(() => playRaw(engine, P1, id("io")), "no window is open for me, and it is not my turn");
  assert.equal(zoneOf(engine, id("io")), "hand");
  playRaw(engine, P2, id("nothing"));
  refused(() => playRaw(engine, P1, id("plain")), "an ordinary character is not a tactic: not deployable in a response window");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  playRaw(engine, P1, id("io"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("io")), "play", "control: she herself is deployable in the same window");
});

clause(IOHANE, "0:kw:TACTICAL", "'may': on my own turn I can still play her at normal timing", () => {
  const { engine, id } = ioBoard({ active: P1 });
  play(engine, P1, id("io"));
  assert.equal(zoneOf(engine, id("io")), "play");
  assert.equal(engine.getAvailableResourceCount(P1), 2);
});

clause(IOHANE, "0:kw:TACTICAL", "when the opponent declares an attack (response window) I can play her in response", () => {
  const g = ioBoard({ active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("oppAtk")]);
  playRaw(g.engine, P1, g.id("io"));
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("io")), "play", "deployed in the attack-declaration window");
  assert.equal(controllerOf(g.engine, g.id("io")), P1);
  declareBlockers(g.engine, P1, [g.id("io")]);
  assert.deepEqual(battleOf(g.engine)?.blockingParty, [g.id("io")], "and she can block the attack she was played against");
});

clause(IOHANE, "0:kw:TACTICAL", "her cost of 1 is paid: with all three [D] resources already spent (threshold still met) she is refused, with one ready resource she is played", () => {
  const spent = ioBoard({ active: P2, spent: 3 });
  playRaw(spent.engine, P2, spent.id("nothing"));
  refused(() => playRaw(spent.engine, P1, spent.id("io")), "nothing left to pay the cost of 1 with", /cost|resource|afford|pay/i);
  assert.equal(zoneOf(spent.engine, spent.id("io")), "hand");
  const one = ioBoard({ active: P2, spent: 2 });
  playRaw(one.engine, P2, one.id("nothing"));
  playRaw(one.engine, P1, one.id("io"));
  resolvePendingResponses(one.engine);
  assert.equal(zoneOf(one.engine, one.id("io")), "play", "control: one ready resource is enough");
  assert.equal(one.engine.getAvailableResourceCount(P1), 0);
});

clause(IOHANE, "0:kw:TACTICAL", "her threshold [D][D][D] is required at tactic timing: two [D] plus a rage, or three rage, are refused; three [D] are enough", () => {
  for (const [deception, rage] of [[2, 1], [0, 3], [1, 5]] as const) {
    const g = ioBoard({ active: P2, deception, rage });
    playRaw(g.engine, P2, g.id("nothing"));
    refused(() => playRaw(g.engine, P1, g.id("io")), `${deception} deception + ${rage} rage does not meet [D][D][D]`, /threshold|icon/i);
    assert.equal(zoneOf(g.engine, g.id("io")), "hand");
  }
  const ok = ioBoard({ active: P2, deception: 3, rage: 2 });
  playRaw(ok.engine, P2, ok.id("nothing"));
  playRaw(ok.engine, P1, ok.id("io"));
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("io")), "play", "control: three deception icons meet the threshold");
});

// --- At the start of your turn, flip a coin. If you win, draw a card. ------------

function ioCoinBoard(random: () => number, opts: { active?: Pid; ioZone?: "hand" | "play"; ioController?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    random,
    cards: [
      { key: "io", def: printing(IOHANE), owner: P1, controller: opts.ioController ?? P1, zone: opts.ioZone ?? "play" },
      ...fillers("md", 5, P1, "deck"),
      ...fillers("mh", 2, P1, "hand"),
      ...fillers("od", 5, P2, "deck"),
      ...fillers("oh", 2, P2, "hand")
    ]
  });
}

clause(IOHANE, "1:rule", "coin WON at the start of my turn: I draw exactly one card, the top card of my deck", () => {
  const { engine } = ioCoinBoard(WIN);
  const hand = handOf(engine, P1);
  const deck = deckOf(engine, P1);
  const oppHand = handOf(engine, P2);
  endTurn(engine, P2); // my turn starts
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), [...hand, deck[0]], "the top card of my deck joined my hand");
  assert.deepEqual(deckOf(engine, P1), deck.slice(1));
  assert.equal(handOf(engine, P2).length, oppHand.length + 0, "the opponent drew nothing");
});

clause(IOHANE, "1:rule", "coin LOST at the start of my turn: I draw nothing", () => {
  const { engine } = ioCoinBoard(LOSE);
  const hand = handOf(engine, P1);
  const deck = deckOf(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), hand);
  assert.deepEqual(deckOf(engine, P1), deck);
});

clause(IOHANE, "1:rule", "only at the start of MY turn: at the opponent's turn start no coin is flipped and I draw nothing, even with a winning coin", () => {
  const { engine } = ioCoinBoard(WIN, { active: P1 });
  const hand = handOf(engine, P1);
  const oppHand = handOf(engine, P2);
  endTurn(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(engine, P1), hand, "I drew nothing at the opponent's turn start");
  assert.deepEqual(handOf(engine, P2), oppHand, "and neither did the opponent");
  assert.equal(eventsOf(engine, "coinFlipped").length + eventsOf(engine, "variableRolled").length, 0, "no coin was flipped at all");
});

clause(IOHANE, "1:rule", "it triggers every one of my turns while she is in play", () => {
  const { engine } = ioCoinBoard(WIN);
  const hand = handOf(engine, P1).length;
  endTurn(engine, P2); // my turn 1
  endTurn(engine, P1);
  endTurn(engine, P2); // my turn 2
  assert.equal(handOf(engine, P1).length, hand + 2, "one card at each of my two turn starts");
});

clause(IOHANE, "1:rule", "she must be in play: from my hand no coin is flipped and nothing is drawn, even with a winning coin", () => {
  const { engine } = ioCoinBoard(WIN, { ioZone: "hand" });
  const hand = handOf(engine, P1).length;
  endTurn(engine, P2);
  assert.equal(handOf(engine, P1).length, hand, "the hand is unchanged");
  assert.equal(deckOf(engine, P1).length, 5);
});

clause(IOHANE, "1:rule", "'your turn' is her controller's turn: a stolen Iohane draws for the player who controls her, not for her owner", () => {
  const { engine } = ioCoinBoard(WIN, { active: P1, ioController: P2 });
  const mine = handOf(engine, P1);
  const theirs = handOf(engine, P2);
  const theirDeck = deckOf(engine, P2);
  endTurn(engine, P1); // P2 (her controller) starts a turn
  assert.deepEqual(handOf(engine, P2), [...theirs, theirDeck[0]], "the controller draws");
  assert.deepEqual(handOf(engine, P1), mine, "the owner does not");
});

clause(IOHANE, "1:rule", "'flip a coin' is a real coin flip: the game records a coin flip by me, won or lost", () => {
  const won = ioCoinBoard(WIN);
  endTurn(won.engine, P2);
  const wonFlips = eventsOf(won.engine, "coinFlipped");
  assert.equal(wonFlips.length, 1, "exactly one coin was flipped");
  assert.equal(wonFlips[0].playerId, P1, "by me");
  assert.equal(wonFlips[0].won, true);
  const lost = ioCoinBoard(LOSE);
  endTurn(lost.engine, P2);
  const lostFlips = eventsOf(lost.engine, "coinFlipped");
  assert.equal(lostFlips.length, 1);
  assert.equal(lostFlips[0].won, false);
});

// --- SNEAK ----------------------------------------------------------------------

clause(IOHANE, "2:ability:iohane-sneak", "COST: Pay 1 — one resource is spent. EFFECT: she gains COVERT (before: not covert; another character is not affected)", () => {
  const { engine, id } = ioBoard({ ioZone: "play", extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  assert.equal(engine.getKeywords(id("io")).includes("covert"), false, "no COVERT before");
  assert.equal(engine.getAvailableResourceCount(P1), 3);
  activate(engine, P1, id("io"), "iohane-sneak");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.getAvailableResourceCount(P1), 2, "exactly one resource was paid");
  assert.ok(engine.getKeywords(id("io")).includes("covert"), "she gains COVERT");
  assert.equal(engine.getKeywords(id("other")).includes("covert"), false, "only 'this card' gains it");
  assert.equal(engine.state.cards[id("io")].depleted, false, "the cost is Pay 1 only: she is not depleted");
});

clause(IOHANE, "2:ability:iohane-sneak", "the cost must be payable: with every resource spent it is refused and she stays non-covert; with exactly one ready resource it works and leaves none", () => {
  const spent = ioBoard({ ioZone: "play", spent: 3 });
  refused(() => activate(spent.engine, P1, spent.id("io"), "iohane-sneak"), "no ready resource to Pay 1 with", /resource|pay|afford|cost/i);
  assert.equal(spent.engine.getKeywords(spent.id("io")).includes("covert"), false);
  const one = ioBoard({ ioZone: "play", spent: 2 });
  activate(one.engine, P1, one.id("io"), "iohane-sneak");
  assert.ok(one.engine.getKeywords(one.id("io")).includes("covert"), "control: one ready resource is enough");
  assert.equal(one.engine.getAvailableResourceCount(P1), 0);
});

clause(IOHANE, "2:ability:iohane-sneak", "no hidden cost: it can be used while she is depleted", () => {
  const { engine, id } = ioBoard({ ioZone: "play" });
  engine.state.cards[id("io")].depleted = true;
  activate(engine, P1, id("io"), "iohane-sneak");
  assert.ok(engine.getKeywords(id("io")).includes("covert"), "engine.getKeywords(id(\"io\")).includes(\"covert\")");
  assert.equal(engine.getAvailableResourceCount(P1), 2);
});

clause(IOHANE, "2:ability:iohane-sneak", "COVERT lasts this turn only: gone when the turn ends and still gone on my next turn", () => {
  const { engine, id } = ioBoard({ ioZone: "play", tactics: false });
  activate(engine, P1, id("io"), "iohane-sneak");
  assert.ok(engine.getKeywords(id("io")).includes("covert"), "engine.getKeywords(id(\"io\")).includes(\"covert\")");
  endTurn(engine, P1); // the opponent's turn
  assert.equal(engine.getKeywords(id("io")).includes("covert"), false, "the opponent's turn: no longer covert");
  endTurn(engine, P2); // my next turn
  assert.equal(engine.getKeywords(id("io")).includes("covert"), false, "my next turn: still not covert");
});

clause(IOHANE, "2:ability:iohane-sneak", "the COVERT is real in battle: after SNEAK a non-covert character cannot block her; without SNEAK it can", () => {
  const control = ioBoard({ ioZone: "play", extra: [{ key: "blk", def: character({ name: "Blocker" }), owner: P2, zone: "play" }] });
  assert.equal(canBlock(control, "io", "blk"), true, "control: an ordinary attacker can be blocked");
  const sneaky = ioBoard({ ioZone: "play", extra: [{ key: "blk", def: character({ name: "Blocker" }), owner: P2, zone: "play" }] });
  activate(sneaky.engine, P1, sneaky.id("io"), "iohane-sneak");
  assert.equal(canBlock(sneaky, "io", "blk"), false, "a COVERT attacker cannot be blocked by a non-covert character");
});

// =================================================================================
// Ipsighast, the Lustful
// UNIQUE IPSIGHAST. EXHUMATION -- COST: Pay 3. Pick a character in an opponent's discard pile. -- EFFECT: Remove that character from the game. This turn, this
// card gains COVERT. You may put the top 3 cards of that opponent's deck into their discard pile.
// Character, rogue, subtype ipsighast / demon knight, cost 3, threshold [D][D][D], 3/4/3.
// =================================================================================

const IPSI = "2a7f9474-5265-4804-865f-f4c3b63b6651";

function ipsiBoard(opts: { deception?: number; oppDeck?: number; noCorpses?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ip", def: printing(IPSI), owner: P1, zone: "play" },
      ...(opts.noCorpses
        ? []
        : [
            { key: "corpse", def: character({ name: "Corpse" }), owner: P2, zone: "discard" as const },
            { key: "corpse2", def: character({ name: "Corpse Two" }), owner: P2, zone: "discard" as const }
          ]),
      ...fillers("od", opts.oppDeck ?? 5, P2, "deck"),
      ...fillers("md", 3, P1, "deck"),
      ...bank("deception", opts.deception ?? 3, P1),
      ...(opts.extra ?? [])
    ]
  });
}
const exhume = (g: Game, pick = "corpse") => activate(g.engine, P1, g.id("ip"), "ipsighast-exhume", { selected: { c: [g.id(pick)] } });

clause(IPSI, "0:unique", "has UNIQUE IPSIGHAST: a second Ipsighast under my control makes me choose one to keep; keeping the new one destroys the old one", () => uniqueKeepNew(IPSI, "deception", 3));
clause(IPSI, "0:unique", "I can keep the older Ipsighast instead; the new one is destroyed", () => uniqueKeepOld(IPSI, "deception", 3));
clause(IPSI, "0:unique", "only a candidate can be kept: an unrelated card is refused and the choice stays open", () => uniqueBystanderRefused(IPSI, "deception", 3));
clause(IPSI, "0:unique", "UNIQUE is per player and per identifier: the opponent's own Ipsighast and a different identifier are no problem", () => uniqueScope(IPSI, "deception", 3));
clause(IPSI, "0:unique", "after I choose which Ipsighast to keep, the deployment finishes: the response window closes", () => uniqueFinishes(IPSI, "deception", 3));

clause(IPSI, "1:ability:ipsighast-exhume", "COST: Pay 3 — three resources are spent (of five, two stay ready) and the ability resolves", () => {
  const g = ipsiBoard({ deception: 5 });
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
  exhume(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(g.engine.getAvailableResourceCount(P1), 2, "exactly three were paid");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "void");
});

clause(IPSI, "1:ability:ipsighast-exhume", "the cost must be payable: with two resources it is refused and nothing happens; with exactly three it works", () => {
  const short = ipsiBoard({ deception: 2 });
  refused(() => exhume(short), "two resources are one short of Pay 3", /resource|pay|afford|cost/i);
  assert.equal(zoneOf(short.engine, short.id("corpse")), "discard");
  assert.equal(short.engine.getKeywords(short.id("ip")).includes("covert"), false);
  assert.equal(short.engine.getAvailableResourceCount(P1), 2);
  const exact = ipsiBoard({ deception: 3 });
  exhume(exact);
  answerPending(exact.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(zoneOf(exact.engine, exact.id("corpse")), "void");
  assert.equal(exact.engine.getAvailableResourceCount(P1), 0);
});

clause(IPSI, "1:ability:ipsighast-exhume", "Pick a character in an opponent's discard pile: any such character is pickable; own discard, other zones and non-characters are refused", () => {
  const extra: CardPlacement[] = [
    { key: "mine", def: character({ name: "MyCorpse" }), owner: P1, zone: "discard" },
    { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
    { key: "oppPlay", def: character({ name: "OppPlay" }), owner: P2, zone: "play" },
    { key: "oppDeckChar", def: character({ name: "OppDeckChar" }), owner: P2, zone: "deck" },
    { key: "oppItem", def: item({ name: "OppItem" }), owner: P2, zone: "discard" },
    { key: "oppTactic", def: tactic({ name: "OppTactic" }), owner: P2, zone: "discard" }
  ];
  for (const bad of ["mine", "oppHand", "oppPlay", "oppDeckChar", "oppItem", "oppTactic"]) {
    const g = ipsiBoard({ extra });
    refused(() => exhume(g, bad), `${bad} is not a character in an opponent's discard pile`);
    assert.equal(g.engine.getAvailableResourceCount(P1), 3, "a refused activation spends nothing");
    assert.equal(g.engine.state.cards[g.id(bad)].zone === "void", false, `${bad} was not removed`);
  }
  for (const good of ["corpse", "corpse2"]) {
    const g = ipsiBoard({ extra });
    exhume(g, good);
    answerPending(g.engine, "chooserSelectsOption", { index: 0 });
    assert.equal(zoneOf(g.engine, g.id(good)), "void", `${good} is pickable`);
  }
  const none = ipsiBoard({ noCorpses: true, extra });
  refused(() => activate(none.engine, P1, none.id("ip"), "ipsighast-exhume", { selected: {} }), "no character in an opponent's discard pile to pick");
  refused(() => activate(none.engine, P1, none.id("ip"), "ipsighast-exhume", { selected: { c: [] } }), "the pick is required");
});

clause(IPSI, "1:ability:ipsighast-exhume", "EFFECT: the picked character is voided (it goes to the Void) — not left in, or moved to, a discard pile or hand — and the other discards stay", () => {
  const g = ipsiBoard();
  exhume(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  const { engine, id } = g;
  assert.equal(zoneOf(engine, id("corpse")), "void");
  assert.equal(discardOf(engine, P2).includes(id("corpse")), false);
  assert.equal(handOf(engine, P2).includes(id("corpse")), false);
  assert.equal(deckOf(engine, P2).includes(id("corpse")), false);
  assert.equal(zoneOf(engine, id("corpse2")), "discard", "the other character in the pile is untouched");
  assert.deepEqual(discardOf(engine, P2), [id("corpse2")]);
});

clause(IPSI, "1:ability:ipsighast-exhume", "EFFECT: this turn, she gains COVERT (not before)", () => {
  const g = ipsiBoard({ extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }] });
  assert.equal(g.engine.getKeywords(g.id("ip")).includes("covert"), false);
  exhume(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.ok(g.engine.getKeywords(g.id("ip")).includes("covert"), "g.engine.getKeywords(g.id(\"ip\")).includes(\"covert\")");
  assert.equal(g.engine.getKeywords(g.id("other")).includes("covert"), false, "only 'this card'");
});

clause(IPSI, "1:ability:ipsighast-exhume", "COVERT lasts this turn only: gone at the end of the turn and on my next turn", () => {
  const g = ipsiBoard();
  exhume(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.ok(g.engine.getKeywords(g.id("ip")).includes("covert"), "g.engine.getKeywords(g.id(\"ip\")).includes(\"covert\")");
  endTurn(g.engine, P1);
  assert.equal(g.engine.getKeywords(g.id("ip")).includes("covert"), false, "the opponent's turn");
  endTurn(g.engine, P2);
  assert.equal(g.engine.getKeywords(g.id("ip")).includes("covert"), false, "my next turn");
});

clause(IPSI, "1:ability:ipsighast-exhume", "the COVERT is real in battle: after EXHUMATION a non-covert character cannot block her; without it, it can", () => {
  const blocker: CardPlacement = { key: "blk", def: character({ name: "Blocker" }), owner: P2, zone: "play" };
  const control = ipsiBoard({ extra: [blocker] });
  assert.equal(canBlock(control, "ip", "blk"), true, "control: an ordinary attacker can be blocked");
  const covert = ipsiBoard({ extra: [blocker] });
  exhume(covert);
  answerPending(covert.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(canBlock(covert, "ip", "blk"), false, "a COVERT attacker cannot be blocked by a non-covert character");
});

clause(IPSI, "1:ability:ipsighast-exhume", "'You may put the top 3 cards...': I (the controller) am asked; accepting puts exactly the opponent's top 3 into their discard pile", () => {
  const g = ipsiBoard({ oppDeck: 5 });
  const top = deckOf(g.engine, P2);
  const mine = deckOf(g.engine, P1);
  exhume(g);
  const pc = pending(g.engine);
  assert.ok(pc, "a choice is pending");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal((pc.options as unknown[]).length, 2, "a decline option and the mill option");
  assert.equal(pc.playerId, P1, "I decide, not the opponent");
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(g.engine, P2), top.slice(3), "the opponent's deck lost exactly its top 3 cards");
  const discard = discardOf(g.engine, P2);
  assert.deepEqual(top.slice(0, 3).filter((c) => !discard.includes(c)), [], "all three were put into their discard pile");
  assert.equal(discard.length, 4, "the three milled cards plus the character that was already there");
  assert.deepEqual(deckOf(g.engine, P1), mine, "my own deck is untouched");
  assert.equal(zoneOf(g.engine, g.id("corpse")), "void", "the exhumed character is still voided, not milled");
});

clause(IPSI, "1:ability:ipsighast-exhume", "'You may': declining mills nothing, but the character is still voided and she still gains COVERT", () => {
  const g = ipsiBoard({ oppDeck: 5 });
  const top = deckOf(g.engine, P2);
  exhume(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(g.engine, P2), top, "the opponent's deck is untouched");
  assert.deepEqual(discardOf(g.engine, P2), [g.id("corpse2")]);
  assert.equal(zoneOf(g.engine, g.id("corpse")), "void");
  assert.ok(g.engine.getKeywords(g.id("ip")).includes("covert"), "g.engine.getKeywords(g.id(\"ip\")).includes(\"covert\")");
});

clause(IPSI, "1:ability:ipsighast-exhume", "with fewer than 3 cards in their deck, accepting puts all of them into their discard pile (no error)", () => {
  const g = ipsiBoard({ oppDeck: 2 });
  const top = deckOf(g.engine, P2);
  exhume(g);
  answerPending(g.engine, "chooserSelectsOption", { index: 1 });
  assert.deepEqual(deckOf(g.engine, P2), []);
  const discard = discardOf(g.engine, P2);
  assert.deepEqual(top.filter((c) => !discard.includes(c)), []);
});

}

// =====================================================================================
// Shared helpers for the hand-written blocks below (the ported blocks above bring their own).
// =====================================================================================

const handIds = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckIds = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardIds = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const infl = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const readyOf = (engine: SpoilsEngine, player: PlayerId = P1): number => engine.getAvailableResourceCount(player);
const sameIds = (actual: readonly string[], expected: readonly string[], message?: string): void =>
  assert.deepEqual([...actual].sort(), [...expected].sort(), message ?? "same ids");
const controllerOf2 = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId as PlayerId;
const isTokenCard = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => !!(engine.state.cards[cardId] as unknown as { isToken?: boolean }).isToken;

/** A two-player board with drawing factions. */
function duo(cards: CardPlacement[], o: { turn?: number; active?: PlayerId; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    random: o.random,
    cards
  });
}
/** The same with factions whose Develop Rule offers nothing (real turn starts neither draw nor prompt for it). */
function quietDuo(cards: CardPlacement[], o: { turn?: number; active?: PlayerId; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: barrenFaction() },
    playerB: { faction: barrenFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    random: o.random,
    cards
  });
}

/** `n` staple resources of `icon` for `owner`, the first `spent` of them already spent (attached to the owner's faction). */
function bankWithSpent(icon: StapleIcon, n: number, spent: number, owner: PlayerId = P1): CardPlacement[] {
  return bank(icon, n, owner).map((placement, index) =>
    index < spent ? { ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" } : placement
  );
}

/** A free tactic that does nothing (playing it opens a response window for the opponent). */
const noopTactic = (name = "Noop", cost = 0): CardDefinition =>
  tactic({ name, cost, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });

/** A free tactic that destroys one chosen card in play (ability `kill`, declaration `t`). */
const killAnyTactic = (name = "KillAny", type?: "character" | "item" | "location" | "resource"): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kill",
          type: "activated",
          targets: [{ id: "t", selector: type ? { zone: "play", type } : { zone: "play" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** A free tactic that deals `amount` damage to one chosen character in play (ability `zap`, declaration `t`). */
const zapTactic = (amount: number, name = `Zap${amount}`): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A character with a free activated ability `die` that destroys it (so a token can leave play without a tactic being deployed). */
const suicideChar = (name = "Suicidal"): CardDefinition =>
  character({
    name,
    behavior: { abilities: [{ id: "die", type: "activated", effects: [{ type: "destroy", target: "source" }] }] }
  } as Partial<CardDefinition>);

/** The player not given. */
const otherPlayer = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);

/** `player` plays `cardId` WITHOUT draining the response window (as a response, or as the first play). */
function castRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}, mode?: number): void {
  engine.perform({ type: "playCard", playerId: player, cardId, selected, variables: {}, ...(mode !== undefined ? { mode } : {}) } as never);
}

/** Deploy basics for a card with no extra cost: exact cost + threshold deploys (paying exactly `cost`), one short / wrong icon is refused. */
function basicDeploy(
  printingId: string,
  o: { cost: number; icon: StapleIcon; icons: number; type: "character" | "item" | "location"; stats?: [number, number, number]; structure?: number; subtypes?: string[] }
): void {
  const build = (resources: Array<[StapleIcon, number]>) =>
    duo([{ key: "subject", def: printing(printingId), owner: P1, zone: "hand" }, ...resources.flatMap(([icon, n]) => bank(icon, n, P1))]);
  const wrong: StapleIcon = o.icon === "rage" ? "greed" : "rage";
  const exactCount = Math.max(o.cost, o.icons);
  const exact = build([[o.icon, exactCount]]);
  const before = readyOf(exact.engine);
  play(exact.engine, P1, exact.id("subject"));
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("subject")), "play", "deployed");
  assert.equal(before - readyOf(exact.engine), o.cost, `the printed cost of ${o.cost} is paid`);
  const def = exact.engine.getDefinition(exact.id("subject"));
  assert.equal(def.type, o.type);
  if (o.stats) {
    assert.equal(exact.engine.getStat(exact.id("subject"), "strength"), o.stats[0], "strength");
    assert.equal(exact.engine.getStat(exact.id("subject"), "speed"), o.stats[1], "speed");
    assert.equal(exact.engine.getStat(exact.id("subject"), "life"), o.stats[2], "life");
  }
  if (o.structure !== undefined) assert.equal(exact.engine.getStat(exact.id("subject"), "structure"), o.structure, "structure");
  for (const subtype of o.subtypes ?? []) assert.ok(def.subtype.includes(subtype), `subtype ${subtype}`);

  if (o.cost > 0) {
    const short = build([[o.icon, exactCount - 1]]);
    refused(() => playRaw(short.engine, P1, short.id("subject")), "one resource short of the cost");
    assert.equal(zoneOf(short.engine, short.id("subject")), "hand");
    assert.equal(readyOf(short.engine), exactCount - 1, "nothing was paid by the refused attempt");
  }
  const noIcon = build([[wrong, exactCount + 3]]);
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("subject")), "plenty of resources but none with the threshold's icon");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("subject")), "hand");
  if (o.icons > 1) {
    const oneIcon = build([[o.icon, o.icons - 1], [wrong, exactCount + 3]]);
    refused(() => playRaw(oneIcon.engine, P1, oneIcon.id("subject")), "one icon short of the threshold");
  }
  const oppTurn = duo([{ key: "subject", def: printing(printingId), owner: P1, zone: "hand" }, ...bank(o.icon, exactCount + 2, P1)], { turn: 2, active: P2 });
  refused(() => playRaw(oppTurn.engine, P1, oppTurn.id("subject")), "not on the opponent's turn");
}

{
// =====================================================================================
// Forbidden Ritual -- tactic, arcanist, cost 3, threshold [O][O]
// EXTRA COST: Pick up to 3 characters in your discard pile. Destroy a character you control.
// If you picked any characters as part of this card's extra cost, put those characters into your hand.
// =====================================================================================

const RITUAL = "2581a0e8-ef90-4d00-b191-7d75ae780300";

function ritualBoard(o: { obsession?: number; rage?: number; active?: PlayerId; extra?: CardPlacement[]; noChars?: boolean } = {}) {
  const active = o.active ?? P1;
  return duo(
    [
      { key: "fr", def: printing(RITUAL), owner: P1, zone: "hand" },
      ...(o.noChars
        ? []
        : ([
            { key: "sac", def: character({ name: "Sac" }), owner: P1, zone: "play" },
            { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "play" }
          ] as CardPlacement[])),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "d0", def: character({ name: "Dead0" }), owner: P1, zone: "discard" },
      { key: "d1", def: character({ name: "Dead1" }), owner: P1, zone: "discard" },
      { key: "d2", def: character({ name: "Dead2" }), owner: P1, zone: "discard" },
      { key: "d3", def: character({ name: "Dead3" }), owner: P1, zone: "discard" },
      { key: "dItem", def: item({ name: "DeadItem" }), owner: P1, zone: "discard" },
      { key: "dTac", def: tactic({ name: "DeadTactic" }), owner: P1, zone: "discard" },
      { key: "oppDead", def: character({ name: "OppDead" }), owner: P2, zone: "discard" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDeck", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
      ...bank("obsession", o.obsession ?? 3, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, active }
  );
}
type RitualBoard = ReturnType<typeof ritualBoard>;
const ritualCast = (b: RitualBoard, back: string[], sac: string[] = ["sac"]) =>
  play(b.engine, P1, b.id("fr"), { selected: { back: back.map((k) => b.id(k)), sac: sac.map((k) => b.id(k)) } });
const ritualRaw = (b: RitualBoard, back: string[], sac: string[] = ["sac"]) =>
  playRaw(b.engine, P1, b.id("fr"), { selected: { back: back.map((k) => b.id(k)), sac: sac.map((k) => b.id(k)) } });

clause(RITUAL, "0:extraCost", "the card costs exactly 3 with [O][O]: exact payment works and spends 3, two resources or one [O] are refused", () => {
  const exact = ritualBoard({ obsession: 2, rage: 1 });
  const before = readyOf(exact.engine);
  ritualCast(exact, []);
  assert.equal(zoneOf(exact.engine, exact.id("fr")), "discard", "the tactic resolved and went to the discard pile");
  assert.equal(before - readyOf(exact.engine), 3, "exactly the printed cost of 3 was paid");
  const short = ritualBoard({ obsession: 2 });
  refused(() => ritualRaw(short, []), "two resources are one short of cost 3");
  assert.equal(zoneOf(short.engine, short.id("fr")), "hand");
  assert.equal(zoneOf(short.engine, short.id("sac")), "play", "the extra cost was not paid for a refused play");
  assert.equal(readyOf(short.engine), 2);
  const noIcons = ritualBoard({ obsession: 1, rage: 4 });
  refused(() => ritualRaw(noIcons, []), "only one [O]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("sac")), "play");
  const plenty = ritualBoard({ obsession: 0, rage: 6 });
  refused(() => ritualRaw(plenty, []), "no [O] at all");
});

clause(RITUAL, "0:extraCost", "it is a tactic: playable in a response window on the opponent's turn", () => {
  const b = ritualBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(() => ritualRaw(b, ["d0"]), "no window is open: a tactic cannot be played on the opponent's turn");
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  ritualCast(b, ["d0"]);
  assert.equal(zoneOf(b.engine, b.id("fr")), "discard", "resolved as a tactic");
  assert.equal(zoneOf(b.engine, b.id("d0")), "hand");
});

clause(RITUAL, "0:extraCost", "Destroy a character you control: the cost destroys it as the card is played, before anyone can respond", () => {
  const b = ritualBoard();
  ritualRaw(b, ["d0"]);
  assert.ok(b.engine.state.responseWindow, "the Ritual waits on the stack");
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "the sacrificed character is already destroyed");
  assert.ok(discardIds(b.engine, P1).includes(b.id("sac")), "in its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("keep")), "play", "only the chosen character is destroyed");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("d0")), "discard", "the picked character has not come back yet (the card has not resolved)");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("d0")), "hand");
});

clause(RITUAL, "0:extraCost", "the character to destroy is required: with no character of mine in play, or none picked, the play is refused and nothing is paid", () => {
  const none = ritualBoard({ noChars: true });
  refused(() => ritualRaw(none, ["d0"], []), "I control no character to destroy");
  assert.equal(zoneOf(none.engine, none.id("fr")), "hand");
  assert.equal(readyOf(none.engine), 3);
  const nopick = ritualBoard();
  refused(() => ritualRaw(nopick, ["d0"], []), "no character picked to destroy");
  refused(() => playRaw(nopick.engine, P1, nopick.id("fr"), { selected: { back: [nopick.id("d0")] } }), "no destroy pick declared at all");
  assert.equal(zoneOf(nopick.engine, nopick.id("fr")), "hand");
  assert.equal(readyOf(nopick.engine), 3, "no resources were spent");
  assert.equal(zoneOf(nopick.engine, nopick.id("d0")), "discard");
});

clause(RITUAL, "0:extraCost", "only a character I control can be destroyed: an opponent's character, an item, a location, a faction and a card in hand are refused; two picks are refused", () => {
  const b = ritualBoard();
  for (const bad of ["foe", "thing", "place", "inHand", "d1"]) {
    refused(() => ritualRaw(b, [], [bad]), `${bad} is not a character I control in play`);
  }
  refused(() => playRaw(b.engine, P1, b.id("fr"), { selected: { back: [], sac: [factionOf(b.engine, P1)] } }), "my own faction");
  refused(() => playRaw(b.engine, P1, b.id("fr"), { selected: { back: [], sac: [factionOf(b.engine, P2)] } }), "the opponent's faction");
  refused(() => ritualRaw(b, [], ["sac", "keep"]), "two characters to destroy");
  assert.equal(zoneOf(b.engine, b.id("fr")), "hand");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play");
  assert.equal(zoneOf(b.engine, b.id("keep")), "play");
  assert.equal(readyOf(b.engine), 3);
  ritualCast(b, [], ["keep"]);
  assert.equal(zoneOf(b.engine, b.id("keep")), "discard", "control: a character I control can be the sacrifice");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play");
});

clause(RITUAL, "0:extraCost", "a face-down card (a resource, not a character) cannot be the sacrifice", () => {
  const b = ritualBoard({ extra: [{ key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true }] });
  refused(() => ritualRaw(b, [], ["fd"]), "a face-down card is only a resource (CR 411.1)");
  assert.equal(zoneOf(b.engine, b.id("fr")), "hand");
});

clause(RITUAL, "0:extraCost", "pick up to 3 characters in my discard pile: 0, 1, 2 and 3 picks are all accepted and exactly those come to hand", () => {
  const all = ["d0", "d1", "d2"];
  for (let n = 0; n <= 3; n++) {
    const b = ritualBoard();
    const picks = all.slice(0, n);
    const handBefore = handIds(b.engine, P1).filter((id) => id !== b.id("fr"));
    ritualCast(b, picks);
    assert.equal(b.engine.state.pendingChoice, undefined);
    sameIds(handIds(b.engine, P1), [...handBefore, ...picks.map((k) => b.id(k))], `${n} picked: those characters are in my hand`);
    for (const key of ["d0", "d1", "d2", "d3"].filter((k) => !picks.includes(k))) {
      assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was not picked and stays in the discard pile`);
    }
  }
});

clause(RITUAL, "0:extraCost", "a fourth pick is refused and nothing is paid or destroyed", () => {
  const b = ritualBoard();
  refused(() => ritualRaw(b, ["d0", "d1", "d2", "d3"]), "up to 3 means at most 3");
  assert.equal(zoneOf(b.engine, b.id("fr")), "hand");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play");
  assert.equal(readyOf(b.engine), 3);
  ritualCast(b, ["d0", "d1", "d2"]);
  assert.equal(zoneOf(b.engine, b.id("fr")), "discard", "control: three picks work");
});

clause(RITUAL, "0:extraCost", "the picks must be characters in MY discard pile: the opponent's discard pile, my item / tactic in the discard pile, and characters in hand, deck or play are refused", () => {
  for (const bad of ["oppDead", "dItem", "dTac", "inHand", "inDeck", "keep", "foe"]) {
    const b = ritualBoard();
    refused(() => ritualRaw(b, [bad]), `${bad} is not a character in my discard pile`);
    assert.equal(zoneOf(b.engine, b.id("fr")), "hand");
    assert.equal(zoneOf(b.engine, b.id("sac")), "play", "nothing was destroyed by the refused play");
  }
  const mixed = ritualBoard();
  refused(() => ritualRaw(mixed, ["d0", "oppDead"]), "a legal pick next to an illegal one");
  assert.equal(zoneOf(mixed.engine, mixed.id("d0")), "discard");
});

clause(RITUAL, "0:extraCost", "the character I destroy can never be one of the picks: it is not in the discard pile when the picks are made", () => {
  const b = ritualBoard();
  refused(() => ritualRaw(b, ["sac"]), "the sacrifice is still in play at pick time");
  assert.equal(zoneOf(b.engine, b.id("sac")), "play");
  ritualCast(b, ["d0"]);
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard", "the sacrifice stays in the discard pile");
  assert.equal(handIds(b.engine, P1).includes(b.id("sac")), false);
});

clause(RITUAL, "1:rule", "the picked characters are put into my hand (not into play), and the sacrifice and unpicked characters stay in the discard pile", () => {
  const b = ritualBoard();
  ritualCast(b, ["d1", "d3"]);
  assert.equal(zoneOf(b.engine, b.id("d1")), "hand");
  assert.equal(zoneOf(b.engine, b.id("d3")), "hand");
  assert.equal(zoneOf(b.engine, b.id("d0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("d2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard");
  assert.equal(zoneOf(b.engine, b.id("oppDead")), "discard", "the opponent's discard pile is untouched");
  assert.equal(controllerOf2(b.engine, b.id("d1")), P1);
  assert.equal(handIds(b.engine, P2).length, 0, "the opponent's hand is untouched");
});

clause(RITUAL, "1:rule", "if I picked no characters nothing is put into my hand (the destroyed character does not come back)", () => {
  const b = ritualBoard();
  const handBefore = handIds(b.engine, P1).filter((id) => id !== b.id("fr"));
  ritualCast(b, []);
  assert.deepEqual(handIds(b.engine, P1), handBefore, "my hand is unchanged apart from the Ritual leaving it");
  assert.equal(zoneOf(b.engine, b.id("sac")), "discard");
  for (const key of ["d0", "d1", "d2", "d3"]) assert.equal(zoneOf(b.engine, b.id(key)), "discard");
});

clause(RITUAL, "1:rule", "only the picks come back: a picked character that left the discard pile in response is not pulled back out of wherever it went", () => {
  const away = tactic({
    name: "Away",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "away",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "deck" }]
        }
      ]
    }
  });
  const b = ritualBoard({ extra: [{ key: "away", def: away, owner: P2, zone: "hand" }] });
  ritualRaw(b, ["d0", "d1"]);
  castRaw(b.engine, P2, b.id("away"), { t: [b.id("d0")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("d0")), "deck", "it was moved away in response");
  assert.equal(zoneOf(b.engine, b.id("d1")), "hand", "the other pick still comes to my hand");
  assert.equal(handIds(b.engine, P1).includes(b.id("d0")), false);
});

// =====================================================================================
// Foundation Ravager -- character, warlord, soldier, cost 5, threshold [R][R], 3 strength / 3 speed / 1 life
// EXTRA COST: You may pick a location.
// When this card enters play, if you picked a location as part of its extra cost, X is its structure. Destroy it and
// deal X damage to its controller's faction.
// =====================================================================================

const RAVAGER = "831e7701-34b7-4d4c-a730-d10be3308c14";

function ravBoard(o: { rage?: number; extra?: CardPlacement[] } = {}) {
  return duo([
    { key: "rav", def: printing(RAVAGER), owner: P1, zone: "hand" },
    { key: "myLoc", def: location({ name: "MyPlace", structure: 3 }), owner: P1, zone: "play" },
    { key: "theirLoc", def: location({ name: "TheirPlace", structure: 4 }), owner: P2, zone: "play" },
    { key: "bigLoc", def: location({ name: "BigPlace", structure: 6 }), owner: P2, zone: "play" },
    { key: "stolenLoc", def: location({ name: "StolenPlace", structure: 5 }), owner: P2, controller: P1, zone: "play" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
    { key: "res", def: resourceCard({ name: "TheirRes" }), owner: P2, zone: "play" },
    { key: "hid", def: location({ name: "Hidden", structure: 2 }), owner: P2, zone: "play", faceDown: true },
    { key: "handLoc", def: location({ name: "HandPlace", structure: 2 }), owner: P1, zone: "hand" },
    { key: "discLoc", def: location({ name: "DiscardPlace", structure: 2 }), owner: P2, zone: "discard" },
    ...bank("rage", o.rage ?? 5, P1),
    ...(o.extra ?? [])
  ]);
}
const ravDeploy = (b: ReturnType<typeof ravBoard>, loc?: string[]) =>
  play(b.engine, P1, b.id("rav"), { selected: loc === undefined ? {} : { loc: loc.map((k) => b.id(k)) } });
const ravRaw = (b: ReturnType<typeof ravBoard>, loc: string[]) => playRaw(b.engine, P1, b.id("rav"), { selected: { loc: loc.map((k) => b.id(k)) } });

clause(RAVAGER, "0:extraCost", "the card is a 5-cost [R][R] warlord soldier with 3 strength, 3 speed and 1 life: exact payment works, one short or one [R] short is refused", () => {
  basicDeploy(RAVAGER, { cost: 5, icon: "rage", icons: 2, type: "character", stats: [3, 3, 1], subtypes: ["soldier"] });
  const b = ravBoard();
  assert.equal(b.engine.getDefinition(b.id("rav")).trade, "warlord");
});

clause(RAVAGER, "0:extraCost", "the pick is optional ('you may'): with no pick, or an empty pick, the Ravager enters play and no location is touched", () => {
  for (const loc of [undefined, [] as string[]]) {
    const b = ravBoard();
    const before = [infl(b.engine, P1), infl(b.engine, P2)];
    ravDeploy(b, loc);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id("rav")), "play");
    for (const key of ["myLoc", "theirLoc", "bigLoc", "stolenLoc"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} untouched`);
    assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], before, "no damage to either faction");
  }
});

clause(RAVAGER, "0:extraCost", "any location in play can be picked: mine, the opponent's, or one I control but they own", () => {
  for (const key of ["myLoc", "theirLoc", "stolenLoc"]) {
    const b = ravBoard();
    ravDeploy(b, [key]);
    assert.equal(zoneOf(b.engine, b.id("rav")), "play", `deployed picking ${key}`);
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was destroyed`);
  }
});

clause(RAVAGER, "0:extraCost", "only a location in play can be picked: a character, item, resource, faction, face-down card, or a location in hand or in a discard pile is refused; two locations are refused", () => {
  const b = ravBoard();
  for (const bad of ["mine", "foe", "thing", "res", "hid", "handLoc", "discLoc"]) {
    refused(() => ravRaw(b, [bad]), `${bad} is not a location in play`);
  }
  refused(() => playRaw(b.engine, P1, b.id("rav"), { selected: { loc: [factionOf(b.engine, P2)] } }), "the opponent's faction");
  refused(() => playRaw(b.engine, P1, b.id("rav"), { selected: { loc: [factionOf(b.engine, P1)] } }), "my own faction");
  refused(() => ravRaw(b, ["myLoc", "theirLoc"]), "only one location may be picked");
  assert.equal(zoneOf(b.engine, b.id("rav")), "hand", "nothing was played");
  assert.equal(readyOf(b.engine), 5, "nothing was paid by the refused attempts");
  assert.equal(zoneOf(b.engine, b.id("myLoc")), "play");
  ravRaw(b, ["theirLoc"]);
  assert.ok(b.engine.state.responseWindow, "control: a location in play is accepted");
});

clause(RAVAGER, "0:extraCost", "the pick is part of playing the card (made before responses); the location is destroyed only when the Ravager enters play", () => {
  const b = ravBoard();
  const oppBefore = infl(b.engine, P2);
  ravRaw(b, ["theirLoc"]);
  assert.ok(b.engine.state.responseWindow, "waiting for responses");
  assert.equal(zoneOf(b.engine, b.id("theirLoc")), "play", "not destroyed yet");
  assert.equal(infl(b.engine, P2), oppBefore, "no damage yet");
  assert.equal(readyOf(b.engine), 0, "the cost is already paid");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("theirLoc")), "discard");
  assert.equal(infl(b.engine, P2), oppBefore - 4);
});

clause(RAVAGER, "1:rule", "X is the picked location's structure: an opponent's structure-4 location is destroyed and their faction takes 4; my faction is untouched", () => {
  const b = ravBoard();
  const [mine, theirs] = [infl(b.engine, P1), infl(b.engine, P2)];
  ravDeploy(b, ["theirLoc"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("theirLoc")), "discard", "destroyed into its owner's discard pile");
  assert.ok(discardIds(b.engine, P2).includes(b.id("theirLoc")), "discardIds(b.engine, P2).includes(b.id(theirLoc))");
  assert.equal(infl(b.engine, P2), theirs - 4, "X = 4 damage to the location's controller's faction");
  assert.equal(infl(b.engine, P1), mine);
  assert.equal(zoneOf(b.engine, b.id("bigLoc")), "play", "other locations are untouched");
});

clause(RAVAGER, "1:rule", "X follows the structure: a structure-6 location deals 6, a structure-3 location deals 3", () => {
  const big = ravBoard();
  const theirs = infl(big.engine, P2);
  ravDeploy(big, ["bigLoc"]);
  assert.equal(infl(big.engine, P2), theirs - 6);
  assert.equal(zoneOf(big.engine, big.id("bigLoc")), "discard");
  const small = ravBoard();
  const mine = infl(small.engine, P1);
  ravDeploy(small, ["myLoc"]);
  assert.equal(infl(small.engine, P1), mine - 3);
});

clause(RAVAGER, "1:rule", "X is its structure, not what is left of it: a structure-4 location holding 3 damage still deals 4", () => {
  const b = ravBoard({ extra: [{ key: "hurtLoc", def: location({ name: "HurtPlace", structure: 4 }), owner: P2, zone: "play", damage: 3 }] });
  const theirs = infl(b.engine, P2);
  ravDeploy(b, ["hurtLoc"]);
  assert.equal(zoneOf(b.engine, b.id("hurtLoc")), "discard");
  assert.equal(infl(b.engine, P2), theirs - 4);
});

clause(RAVAGER, "1:rule", "the damage goes to the location's CONTROLLER's faction: my own location hurts my faction, not the opponent's", () => {
  const b = ravBoard();
  const [mine, theirs] = [infl(b.engine, P1), infl(b.engine, P2)];
  ravDeploy(b, ["myLoc"]);
  assert.equal(zoneOf(b.engine, b.id("myLoc")), "discard");
  assert.equal(infl(b.engine, P1), mine - 3, "I take X");
  assert.equal(infl(b.engine, P2), theirs, "the opponent takes nothing");
});

clause(RAVAGER, "1:rule", "a location I control but the opponent owns: its controller (me) takes the damage and its owner gets the card in their discard pile", () => {
  const b = ravBoard();
  const [mine, theirs] = [infl(b.engine, P1), infl(b.engine, P2)];
  ravDeploy(b, ["stolenLoc"]);
  assert.equal(infl(b.engine, P1), mine - 5, "damage to the controller's faction");
  assert.equal(infl(b.engine, P2), theirs, "not to the owner's");
  assert.ok(discardIds(b.engine, P2).includes(b.id("stolenLoc")), "destroyed into its owner's discard pile");
});

clause(RAVAGER, "1:rule", "it applies only to the pick made as part of the extra cost: with no pick nothing is destroyed even though locations are in play", () => {
  const b = ravBoard();
  const before = [infl(b.engine, P1), infl(b.engine, P2)];
  ravDeploy(b);
  for (const key of ["myLoc", "theirLoc", "bigLoc", "stolenLoc"]) assert.equal(zoneOf(b.engine, b.id(key)), "play");
  assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], before);
});

clause(RAVAGER, "1:rule", "entering play without having been deployed (no pick was made) does nothing, and a later character entering does not trigger it again", () => {
  const put = tactic({
    name: "PutRavager",
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
  const b = ravBoard({ extra: [{ key: "put", def: put, owner: P1, zone: "hand" }, { key: "second", def: character({ name: "Second", cost: 0 }), owner: P1, zone: "hand" }] });
  const before = [infl(b.engine, P1), infl(b.engine, P2)];
  play(b.engine, P1, b.id("put"), { selected: { c: [b.id("rav")] } });
  assert.equal(zoneOf(b.engine, b.id("rav")), "play", "put into play by an effect");
  for (const key of ["myLoc", "theirLoc", "bigLoc", "stolenLoc"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} untouched`);
  assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], before);
  play(b.engine, P1, b.id("second"));
  assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], before, "another character entering play does not trigger it");
});

clause(RAVAGER, "1:rule", "a picked location that was destroyed in response is already gone: the Ravager still enters play and nothing else is destroyed", () => {
  const b = ravBoard({ extra: [{ key: "kill", def: killAnyTactic("KillLoc", "location"), owner: P2, zone: "hand" }] });
  const oppBefore = infl(b.engine, P2);
  ravRaw(b, ["theirLoc"]);
  castRaw(b.engine, P2, b.id("kill"), { t: [b.id("theirLoc")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("theirLoc")), "discard", "destroyed by the response");
  assert.equal(zoneOf(b.engine, b.id("rav")), "play", "the Ravager still enters play");
  assert.equal(zoneOf(b.engine, b.id("bigLoc")), "play");
  assert.equal(zoneOf(b.engine, b.id("myLoc")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(infl(b.engine, P2), oppBefore - 4, "most literal reading: 'if you picked a location' is still true, X was its structure (4), so its controller's faction still takes 4");
});

// =====================================================================================
// Gardyloo! -- tactic, rogue, cost 2, threshold [D][D]
// If you deployed this card in response to a card being deployed, terminate that card. Put that card into its
// owner's hand instead of into their discard pile.
// Draw a card.
// =====================================================================================

const GARDYLOO = "c533ea32-eb11-46c6-9f2c-357e745c2c76";

function gardyBoard(o: { deception?: number; extra?: CardPlacement[]; gardyOwner?: PlayerId } = {}) {
  // P2 is active and deploys things; P1 holds Gardyloo (or P1 deploys and P2 holds it with gardyOwner = P2)
  const gardy = o.gardyOwner ?? P1;
  return duo(
    [
      { key: "g", def: printing(GARDYLOO), owner: gardy, zone: "hand" },
      ...bank("deception", o.deception ?? 2, gardy),
      { key: "theirChar", def: character({ name: "TheirChar", cost: 2 }), owner: otherPlayer(gardy), zone: "hand" },
      { key: "theirItem", def: item({ name: "TheirItem", cost: 2 }), owner: otherPlayer(gardy), zone: "hand" },
      { key: "theirLoc", def: location({ name: "TheirLoc", cost: 2 }), owner: otherPlayer(gardy), zone: "hand" },
      {
        key: "theirTac",
        def: tactic({
          name: "TheirTactic",
          cost: 2,
          behavior: { abilities: [{ id: "tac", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "controller" }, amount: 4 }] }] }
        }),
        owner: otherPlayer(gardy),
        zone: "hand"
      },
      {
        key: "theirEtb",
        def: character({
          name: "TheirEtb",
          cost: 2,
          behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] }] }
        } as Partial<CardDefinition>),
        owner: otherPlayer(gardy),
        zone: "hand"
      },
      ...bank("greed", 6, otherPlayer(gardy)),
      ...fillers("mk", 4, gardy, "deck"),
      ...fillers("ok", 4, otherPlayer(gardy), "deck"),
      ...(o.extra ?? [])
    ],
    { turn: gardy === P1 ? 2 : 1, active: otherPlayer(gardy) }
  );
}
type GardyBoard = ReturnType<typeof gardyBoard>;
/** The active player deploys `what`; `gardy` answers with Gardyloo in the response window. */
function gardyResponse(b: GardyBoard, what: string, gardy: PlayerId = P1, selected: Record<string, CardInstanceId[]> = {}): void {
  castRaw(b.engine, otherPlayer(gardy), b.id(what), selected);
  castRaw(b.engine, gardy, b.id("g"));
  resolvePendingResponses(b.engine);
}

clause(GARDYLOO, "0:rule", "in response to a character being deployed: it is terminated and goes to its owner's hand, not into play or the discard pile; its cost stays paid", () => {
  const b = gardyBoard();
  const oppReady = readyOf(b.engine, P2);
  gardyResponse(b, "theirChar");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("theirChar")), "hand", "back in its owner's hand");
  assert.ok(handIds(b.engine, P2).includes(b.id("theirChar")), "handIds(b.engine, P2).includes(b.id(theirChar))");
  assert.equal(discardIds(b.engine, P2).includes(b.id("theirChar")), false, "not in the discard pile");
  assert.equal(readyOf(b.engine, P2), oppReady - 2, "the cost they paid to deploy it is not refunded");
  assert.equal(zoneOf(b.engine, b.id("g")), "discard", "Gardyloo itself goes to the discard pile");
});

clause(GARDYLOO, "0:rule", "the terminated card never enters play: its 'enters play' trigger does not happen", () => {
  const b = gardyBoard();
  const mine = infl(b.engine, P1);
  gardyResponse(b, "theirEtb");
  assert.equal(zoneOf(b.engine, b.id("theirEtb")), "hand");
  assert.equal(infl(b.engine, P1), mine, "the card's 'opponent loses 3 influence' never happened");
  const control = gardyBoard();
  const controlMine = infl(control.engine, P1);
  castRaw(control.engine, P2, control.id("theirEtb"));
  resolvePendingResponses(control.engine);
  assert.equal(zoneOf(control.engine, control.id("theirEtb")), "play", "control: undisturbed, the card does enter play");
  assert.equal(infl(control.engine, P1), controlMine - 3, "control: and its trigger does happen");
});

clause(GARDYLOO, "0:rule", "it works on any type of card being deployed: an item, a location and a tactic all go to their owner's hand", () => {
  for (const what of ["theirItem", "theirLoc", "theirTac"]) {
    const b = gardyBoard();
    const mine = infl(b.engine, P1);
    const theirs = infl(b.engine, P2);
    gardyResponse(b, what);
    assert.equal(zoneOf(b.engine, b.id(what)), "hand", `${what} was terminated into its owner's hand`);
    assert.equal(discardIds(b.engine, P2).includes(b.id(what)), false, `${what} is not in the discard pile`);
    assert.equal(infl(b.engine, P2), theirs, `${what}: nothing else happened`);
    assert.equal(infl(b.engine, P1), mine);
  }
});

clause(GARDYLOO, "0:rule", "a terminated TACTIC does not resolve (its effect never happens) and goes to its owner's hand instead of the discard pile", () => {
  const b = gardyBoard();
  const theirs = infl(b.engine, P2);
  gardyResponse(b, "theirTac");
  assert.equal(infl(b.engine, P2), theirs, "its 4 damage to its controller's own faction did not happen");
  assert.equal(zoneOf(b.engine, b.id("theirTac")), "hand");
  const control = gardyBoard();
  castRaw(control.engine, P2, control.id("theirTac"));
  resolvePendingResponses(control.engine);
  assert.equal(infl(control.engine, P2), theirs - 4, "control: left alone it does its damage");
  assert.equal(zoneOf(control.engine, control.id("theirTac")), "discard");
});

clause(GARDYLOO, "0:rule", "'its owner's hand': a card I own that the opponent controls... and the opponent's Gardyloo on MY deployed card sends it to MY hand", () => {
  const b = gardyBoard({ gardyOwner: P2, extra: [] });
  // P1 is active here and deploys; P2 answers with Gardyloo
  const myChar = b.id("theirChar");
  const myHandBefore = handIds(b.engine, P1);
  gardyResponse(b, "theirChar", P2);
  assert.equal(zoneOf(b.engine, myChar), "hand");
  assert.ok(handIds(b.engine, P1).includes(myChar), "it is in the hand of the player who owns it (the deployer)");
  assert.equal(handIds(b.engine, P2).includes(myChar), false, "not in Gardyloo's controller's hand");
  assert.equal(handIds(b.engine, P1).length, myHandBefore.length, "same hand size as before the deploy");
});

clause(GARDYLOO, "0:rule", "not in response to a card being deployed (on my own turn, nothing on the stack): nothing is terminated", () => {
  const b = duo([
    { key: "g", def: printing(GARDYLOO), owner: P1, zone: "hand" },
    ...bank("deception", 2, P1),
    { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    ...fillers("mk", 3, P1, "deck")
  ]);
  play(b.engine, P1, b.id("g"));
  assert.equal(zoneOf(b.engine, b.id("myChar")), "play");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("g")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(GARDYLOO, "0:rule", "in response to an ability (not a card being deployed): nothing is terminated", () => {
  const abil = character({
    name: "Abil",
    behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "controller" }, amount: 2 }] }] }
  } as Partial<CardDefinition>);
  const b = gardyBoard({ extra: [{ key: "ab", def: abil, owner: P2, zone: "play" }] });
  const theirs = infl(b.engine, P2);
  b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("ab"), abilityId: "a", selected: {}, variables: {} } as never);
  castRaw(b.engine, P1, b.id("g"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("ab")), "play", "the ability's source is not terminated");
  assert.equal(infl(b.engine, P2), theirs - 2, "the ability resolved normally");
  assert.equal(zoneOf(b.engine, b.id("g")), "discard");
});

clause(GARDYLOO, "0:rule", "in response to an attack declaration (not a card being deployed): nothing is terminated, and I still draw", () => {
  const b = gardyBoard({ extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  const deck = deckIds(b.engine, P1);
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  castRaw(b.engine, P1, b.id("g"));
  assert.ok(b.engine.state.battle, "the attack is still declared");
  assert.equal(zoneOf(b.engine, b.id("atk")), "play", "the attacker is not terminated");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("atk")), "play");
  assert.ok(b.engine.state.battle, "and the battle goes on");
  assert.deepEqual(handIds(b.engine, P1), [deck[0]], "I drew a card");
});

clause(GARDYLOO, "0:rule", "a Gardyloo is a card being deployed too: the opponent's Gardyloo in response to mine terminates it into MY hand, so mine does nothing and I do not draw", () => {
  const b = gardyBoard({ extra: [{ key: "g2", def: printing(GARDYLOO), owner: P2, zone: "hand" }, ...bank("deception", 2, P2)] });
  const myDeck = deckIds(b.engine, P1);
  const theirDeck = deckIds(b.engine, P2);
  castRaw(b.engine, P2, b.id("theirChar"));
  castRaw(b.engine, P1, b.id("g"));
  castRaw(b.engine, P2, b.id("g2"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("g")), "hand", "my Gardyloo was terminated into its owner's hand instead of the discard pile");
  assert.equal(zoneOf(b.engine, b.id("g2")), "discard", "theirs resolved and went to the discard pile");
  assert.equal(zoneOf(b.engine, b.id("theirChar")), "play", "my Gardyloo never resolved, so their character was not terminated");
  assert.deepEqual(handIds(b.engine, P1), [b.id("g")], "I drew nothing");
  assert.deepEqual(deckIds(b.engine, P1), myDeck);
  assert.ok(handIds(b.engine, P2).includes(theirDeck[0]), "they drew a card");
});

clause(GARDYLOO, "0:rule", "it costs exactly 2 with [D][D]: one resource short, or one [D] short, is refused", () => {
  const exact = gardyBoard();
  castRaw(exact.engine, P2, exact.id("theirChar"));
  const before = readyOf(exact.engine, P1);
  castRaw(exact.engine, P1, exact.id("g"));
  assert.equal(before - readyOf(exact.engine, P1), 2, "the printed cost of 2 is paid");
  const short = gardyBoard({ deception: 1 });
  castRaw(short.engine, P2, short.id("theirChar"));
  refused(() => castRaw(short.engine, P1, short.id("g")), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("g")), "hand");
  const wrongIcon = gardyBoard({ deception: 1, extra: bank("rage", 4, P1) });
  castRaw(wrongIcon.engine, P2, wrongIcon.id("theirChar"));
  refused(() => castRaw(wrongIcon.engine, P1, wrongIcon.id("g")), "only one [D]");
});

clause(GARDYLOO, "1:rule", "Draw a card: I draw exactly one (the top of my deck) when I terminate a card, and the opponent draws nothing", () => {
  const b = gardyBoard();
  const deck = deckIds(b.engine, P1);
  const oppHand = handIds(b.engine, P2).length;
  gardyResponse(b, "theirChar");
  assert.deepEqual(handIds(b.engine, P1), [deck[0]], "I drew the top card of my deck");
  assert.deepEqual(deckIds(b.engine, P1), deck.slice(1));
  assert.equal(handIds(b.engine, P2).length, oppHand, "the card they deployed went back to their hand: same size as before the deploy");
});

clause(GARDYLOO, "1:rule", "Draw a card: I draw even when nothing is terminated (not in response to a deploy, or in response to an ability)", () => {
  const b = duo([
    { key: "g", def: printing(GARDYLOO), owner: P1, zone: "hand" },
    ...bank("deception", 2, P1),
    ...fillers("mk", 3, P1, "deck")
  ]);
  const deck = deckIds(b.engine, P1);
  play(b.engine, P1, b.id("g"));
  assert.deepEqual(handIds(b.engine, P1), [deck[0]], "drew one card");
  assert.equal(deckIds(b.engine, P1).length, 2);
  const abil = character({ name: "Abil", behavior: { abilities: [{ id: "a", type: "activated", effects: [] }] } } as Partial<CardDefinition>);
  const c = gardyBoard({ extra: [{ key: "ab", def: abil, owner: P2, zone: "play" }] });
  const cdeck = deckIds(c.engine, P1);
  c.engine.perform({ type: "activateAbility", playerId: P2, cardId: c.id("ab"), abilityId: "a", selected: {}, variables: {} } as never);
  castRaw(c.engine, P1, c.id("g"));
  resolvePendingResponses(c.engine);
  assert.deepEqual(handIds(c.engine, P1), [cdeck[0]], "drew one card in response to an ability too");
});

// =====================================================================================
// Gatekeeper of the Void -- character, arcanist, demon, cost 4, threshold [O][O], 2 strength / 3 speed / 2 life
// When you deploy a tactic, put a Demon token into play. Treat the token as an Arcanist character card with
// 2 strength, 1 life, and 2 speed, and the "demon" subtype.
// =====================================================================================

const GATEKEEPER = "8f305b73-460f-4149-8f55-f6a26965f8e2";

function gateBoard(o: { gate?: "play" | "hand"; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return duo(
    [
      { key: "gate", def: printing(GATEKEEPER), owner: P1, zone: o.gate ?? "play" },
      { key: "myTac", def: noopTactic("MyTactic"), owner: P1, zone: "hand" },
      { key: "myTac2", def: noopTactic("MyTactic2"), owner: P1, zone: "hand" },
      { key: "oppTac", def: noopTactic("OppTactic"), owner: P2, zone: "hand" },
      { key: "myChar", def: character({ name: "MyChar", cost: 0 }), owner: P1, zone: "hand" },
      { key: "myItem", def: item({ name: "MyItem", cost: 0 }), owner: P1, zone: "hand" },
      { key: "myLoc", def: location({ name: "MyLoc", cost: 0 }), owner: P1, zone: "hand" },
      { key: "myRes", def: resourceCard({ name: "MyRes" }), owner: P1, zone: "hand" },
      { key: "suicide", def: suicideChar("Suicide"), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, active }
  );
}
const demonsOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] =>
  engine.state.players[player].play.filter((cardId) => engine.getDefinition(cardId).name === "Demon");

clause(GATEKEEPER, "0:rule", "the card is a 4-cost [O][O] arcanist demon with 2 strength, 3 speed and 2 life", () => {
  basicDeploy(GATEKEEPER, { cost: 4, icon: "obsession", icons: 2, type: "character", stats: [2, 3, 2], subtypes: ["demon"] });
  const b = gateBoard();
  assert.equal(b.engine.getDefinition(b.id("gate")).trade, "arcanist");
});

clause(GATEKEEPER, "0:rule", "when I deploy a tactic a Demon token enters play under my control: an Arcanist character with 2 strength, 1 life, 2 speed and the demon subtype", () => {
  const b = gateBoard();
  assert.equal(demonsOf(b.engine, P1).length, 0);
  play(b.engine, P1, b.id("myTac"));
  const demons = demonsOf(b.engine, P1);
  assert.equal(demons.length, 1, "exactly one Demon token");
  const demon = demons[0];
  const def = b.engine.getDefinition(demon);
  assert.equal(def.type, "character");
  assert.equal(def.trade, "arcanist", "an Arcanist character card");
  assert.ok(def.subtype.includes("demon"), "the demon subtype");
  assert.equal(b.engine.getStat(demon, "strength"), 2);
  assert.equal(b.engine.getStat(demon, "life"), 1);
  assert.equal(b.engine.getStat(demon, "speed"), 2);
  assert.equal(controllerOf2(b.engine, demon), P1, "under my control");
  assert.equal(isTokenCard(b.engine, demon), true, "it is a token");
  assert.equal(demonsOf(b.engine, P2).length, 0);
});

clause(GATEKEEPER, "0:rule", "every tactic I deploy gives a token: two tactics make two Demons", () => {
  const b = gateBoard();
  play(b.engine, P1, b.id("myTac"));
  play(b.engine, P1, b.id("myTac2"));
  assert.equal(demonsOf(b.engine, P1).length, 2);
});

clause(GATEKEEPER, "0:rule", "the token is put into play when the tactic is deployed, before the tactic resolves", () => {
  const b = gateBoard();
  castRaw(b.engine, P1, b.id("myTac"));
  assert.ok(b.engine.state.responseWindow, "the tactic is waiting on the stack");
  resolvePendingResponses(b.engine);
  assert.equal(demonsOf(b.engine, P1).length, 1);
});

clause(GATEKEEPER, "0:rule", "two Gatekeepers both trigger: one tactic gives two Demons", () => {
  const b = gateBoard({ extra: [{ key: "gate2", def: printing(GATEKEEPER), owner: P1, zone: "play" }] });
  castRaw(b.engine, P1, b.id("myTac"));
  drain(b.engine, declineAll);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(demonsOf(b.engine, P1).length, 2, "each Gatekeeper puts a token into play");
});

clause(GATEKEEPER, "0:rule", "a tactic the OPPONENT deploys does not give me a token", () => {
  const b = gateBoard({ active: P2 });
  play(b.engine, P2, b.id("oppTac"));
  assert.equal(demonsOf(b.engine, P1).length, 0);
  assert.equal(demonsOf(b.engine, P2).length, 0);
  const mine = gateBoard();
  castRaw(mine.engine, P1, mine.id("myTac"));
  castRaw(mine.engine, P2, mine.id("oppTac"));
  resolvePendingResponses(mine.engine);
  assert.equal(demonsOf(mine.engine, P1).length, 1, "only my own tactic counted, not their response");
  assert.equal(demonsOf(mine.engine, P2).length, 0);
});

clause(GATEKEEPER, "0:rule", "a tactic I deploy as a response on the opponent's turn also gives a token", () => {
  const b = gateBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  play(b.engine, P1, b.id("myTac"));
  assert.equal(demonsOf(b.engine, P1).length, 1);
});

clause(GATEKEEPER, "0:rule", "only tactics: deploying a character, an item or a location, or playing a resource, gives no token", () => {
  for (const what of ["myChar", "myItem", "myLoc"]) {
    const b = gateBoard();
    play(b.engine, P1, b.id(what));
    assert.equal(zoneOf(b.engine, b.id(what)), "play", `${what} was deployed`);
    assert.equal(demonsOf(b.engine, P1).length, 0, `${what}: no Demon`);
  }
  const res = gateBoard();
  developResource(res.engine, P1, res.id("myRes"), false);
  assert.equal(zoneOf(res.engine, res.id("myRes")), "play");
  assert.equal(demonsOf(res.engine, P1).length, 0, "a resource play is not a tactic");
});

clause(GATEKEEPER, "0:rule", "the Gatekeeper must be in play: with it in my hand, deploying a tactic gives no token", () => {
  const b = gateBoard({ gate: "hand" });
  play(b.engine, P1, b.id("myTac"));
  assert.equal(demonsOf(b.engine, P1).length, 0);
});

clause(GATEKEEPER, "0:rule", "the Demon is a token: when it leaves play it disappears and is never put into a discard pile", () => {
  const b = gateBoard();
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("suicide"), abilityId: "die", selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("suicide")), "discard", "control: an ordinary card goes to the discard pile");
  // destroy the token with a character-destroying ability that is not a deployed tactic
  const killer = character({
    name: "Killer",
    behavior: {
      abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  } as Partial<CardDefinition>);
  const c = gateBoard({ extra: [{ key: "killer", def: killer, owner: P1, zone: "play" }] });
  play(c.engine, P1, c.id("myTac"));
  const token = demonsOf(c.engine, P1)[0];
  c.engine.perform({ type: "activateAbility", playerId: P1, cardId: c.id("killer"), abilityId: "k", selected: { t: [token] }, variables: {} } as never);
  resolvePendingResponses(c.engine);
  const gone = c.engine.state.cards[token];
  assert.ok(gone === undefined || gone.zone === "removed", `the token is out of the game (zone ${gone?.zone})`);
  assert.equal(discardIds(c.engine, P1).includes(token), false, "not in the discard pile");
});

}

{
// =====================================================================================
// Gilded Yurt -- location, banker, cost 1, threshold [G][G], 3 structure
// CHILLAX -- COST: Deplete this card. Pick a character you control.
// EFFECT: Void the character. At the start of your next turn, if this card is in play, put the voided character
// into play under your control.
// =====================================================================================

const YURT = "c3cddf9a-886e-44a9-b811-d27b6192e3f7";

function yurtBoard(o: { yurt?: "play" | "hand"; depleted?: boolean; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return quietDuo(
    [
      { key: "y", def: printing(YURT), owner: P1, zone: o.yurt ?? "play", depleted: o.depleted },
      { key: "c", def: character({ name: "Voidee", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDisc", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      { key: "killLoc", def: killAnyTactic("KillLoc", "location"), owner: P1, zone: "hand" },
      ...fillers("d1", 6, P1, "deck"),
      ...fillers("d2", 6, P2, "deck"),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, active }
  );
}
type YurtBoard = ReturnType<typeof yurtBoard>;
const chillax = (b: YurtBoard, pick = "c") => activate(b.engine, P1, b.id("y"), "yurt-chillax", { selected: { v: [b.id(pick)] } });
const chillaxRaw = (b: YurtBoard, pick = "c") =>
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("y"), abilityId: "yurt-chillax", selected: { v: [b.id(pick)] }, variables: {} } as never);

clause(YURT, "0:ability:yurt-chillax", "the printed card: a banker location with cost 1, threshold [G][G] and 3 structure; deploys for exactly that", () => {
  basicDeploy(YURT, { cost: 1, icon: "greed", icons: 2, type: "location", structure: 3 });
  const b = yurtBoard();
  assert.equal(b.engine.getDefinition(b.id("y")).trade, "banker");
});

clause(YURT, "0:ability:yurt-chillax", "COST: Deplete this card -- it is depleted as the ability is used, before anyone can respond", () => {
  const b = yurtBoard();
  assert.equal(b.engine.state.cards[b.id("y")].depleted, false);
  chillaxRaw(b);
  assert.equal(b.engine.state.cards[b.id("y")].depleted, true, "the Yurt is depleted as the cost");
  assert.equal(zoneOf(b.engine, b.id("c")), "play", "the character has not been voided yet (the ability has not resolved)");
  assert.ok(b.engine.state.responseWindow, "the ability waits for responses");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("c")), "void");
});

clause(YURT, "0:ability:yurt-chillax", "the cost must be payable: a depleted Yurt cannot be used, and once restored it can", () => {
  const b = yurtBoard({ depleted: true });
  refused(() => chillax(b), "the Yurt is already depleted");
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  b.engine.state.cards[b.id("y")].depleted = false;
  chillax(b);
  assert.equal(zoneOf(b.engine, b.id("c")), "void", "control: restored, it works");
});

clause(YURT, "0:ability:yurt-chillax", "it can only be used while the Yurt is in play", () => {
  const b = yurtBoard({ yurt: "hand" });
  refused(() => chillax(b), "the Yurt is in my hand");
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
});

clause(YURT, "0:ability:yurt-chillax", "Pick a character you control: any of my characters can be picked; an opponent's character, an item, a location, a face-down card, or a character in hand or discard is refused", () => {
  for (const bad of ["foe", "thing", "place", "fd", "inHand", "inDisc", "y"]) {
    const b = yurtBoard();
    refused(() => chillax(b, bad), `${bad} is not a character I control in play`);
    assert.equal(b.engine.state.cards[b.id("y")].depleted, false, "nothing was paid by the refused use");
    assert.equal(zoneOf(b.engine, b.id("c")), "play");
  }
  const noPick = yurtBoard();
  refused(() => activate(noPick.engine, P1, noPick.id("y"), "yurt-chillax", { selected: { v: [] } }), "the pick is required");
  refused(() => activate(noPick.engine, P1, noPick.id("y"), "yurt-chillax", { selected: {} }), "no pick declared");
  const two = yurtBoard();
  refused(() => activate(two.engine, P1, two.id("y"), "yurt-chillax", { selected: { v: [two.id("c"), two.id("c2")] } }), "exactly one character");
  for (const ok of ["c", "c2"]) {
    const b = yurtBoard();
    chillax(b, ok);
    assert.equal(zoneOf(b.engine, b.id(ok)), "void", `${ok} was voided`);
  }
});

clause(YURT, "0:ability:yurt-chillax", "EFFECT: the picked character is voided -- it goes to the Void, not the discard pile or my hand -- and nothing else is", () => {
  const b = yurtBoard();
  chillax(b);
  assert.equal(zoneOf(b.engine, b.id("c")), "void");
  assert.equal(discardIds(b.engine, P1).includes(b.id("c")), false, "not in the discard pile");
  assert.equal(handIds(b.engine, P1).includes(b.id("c")), false, "not in my hand");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play", "other characters stay");
  assert.equal(zoneOf(b.engine, b.id("y")), "play", "the Yurt stays");
});

clause(YURT, "0:ability:yurt-chillax", "the character comes back at the start of MY next turn: it is still voided through the opponent's turn start, and in play under my control at mine", () => {
  const b = yurtBoard();
  chillax(b);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(zoneOf(b.engine, b.id("c")), "void", "the opponent's turn started: it has not come back");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(zoneOf(b.engine, b.id("c")), "play", "my next turn started: it is back in play");
  assert.equal(controllerOf2(b.engine, b.id("c")), P1, "under my control");
});

clause(YURT, "0:ability:yurt-chillax", "the returned character is a fresh card: damage is gone, and it is a new arrival that cannot attack the turn it returns", () => {
  const b = yurtBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 6 }), owner: P1, zone: "play", damage: 3 }] });
  chillax(b, "hurt");
  assert.equal(zoneOf(b.engine, b.id("hurt")), "void");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(zoneOf(b.engine, b.id("hurt")), "play");
  assert.equal(b.engine.state.cards[b.id("hurt")].damage, 0, "its damage did not come back with it");
  assert.equal(b.engine.state.cards[b.id("hurt")].depleted, false);
});

clause(YURT, "0:ability:yurt-chillax", "'if this card is in play': when the Yurt has left play by my next turn the character stays voided", () => {
  const b = yurtBoard();
  chillax(b);
  play(b.engine, P1, b.id("killLoc"), { selected: { t: [b.id("y")] } });
  assert.equal(zoneOf(b.engine, b.id("y")), "discard", "the Yurt is destroyed");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(zoneOf(b.engine, b.id("c")), "void", "it does not come back");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(zoneOf(b.engine, b.id("c")), "void", "and not at any later turn either");
});

clause(YURT, "0:ability:yurt-chillax", "a character I control but the opponent owns comes back under MY control", () => {
  const b = yurtBoard();
  chillax(b, "stolen");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "void");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(zoneOf(b.engine, b.id("stolen")), "play");
  assert.equal(controllerOf2(b.engine, b.id("stolen")), P1, "the player who used the Yurt controls it");
});

clause(YURT, "0:ability:yurt-chillax", "used in response during the opponent's turn, 'my next turn' is the one right after theirs", () => {
  const b = yurtBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  chillax(b);
  assert.equal(zoneOf(b.engine, b.id("c")), "void");
  assert.equal(b.engine.state.activePlayerId, P2, "still the opponent's turn");
  assert.ok(b.engine.state.battle, "the attack goes on");
  declareBlockers(b.engine, P1, []);
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("c")), "void", "still voided for the rest of their turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(zoneOf(b.engine, b.id("c")), "play", "back at the start of my next turn");
});

// =====================================================================================
// Grasp of Rantzigore -- tactic, arcanist, cost 2, threshold [O][O]
// EXTRA COST: Pick a character.
// This turn, that character loses 2 life and if it would be destroyed its controller discards a card.
// (Most literal reading, as the card is printed: the discard happens as the destruction would, and nothing says the
// character is saved: "instead" is not printed.)
// =====================================================================================

const GRASP = "fa348715-0409-4c8e-8776-ff4e8220ec4a";

function graspBoard(o: { obsession?: number; rage?: number; foeLife?: number; foeHand?: number; myHand?: number; inHand?: boolean; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return quietDuo(
    [
      { key: "gr", def: printing(GRASP), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: o.foeLife ?? 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", life: 4 }), owner: P2, controller: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      ...(o.inHand === false ? [] : ([{ key: "inHand", def: character({ name: "InHandChar" }), owner: P2, zone: "hand" }] as CardPlacement[])),
      { key: "z1", def: zapTactic(1, "ZapOne"), owner: P1, zone: "hand" },
      { key: "z2", def: zapTactic(1, "ZapTwo"), owner: P1, zone: "hand" },
      { key: "z3", def: zapTactic(1, "ZapThree"), owner: P1, zone: "hand" },
      { key: "z4", def: zapTactic(1, "ZapFour"), owner: P1, zone: "hand" },
      { key: "kill", def: killAnyTactic("KillChar", "character"), owner: P1, zone: "hand" },
      ...Array.from({ length: o.foeHand ?? 2 }, (_, i) => ({ key: `fh${i}`, def: character({ name: `FoeHand${i}` }), owner: P2, zone: "hand" as const })),
      ...Array.from({ length: o.myHand ?? 2 }, (_, i) => ({ key: `mh${i}`, def: character({ name: `MyHand${i}` }), owner: P1, zone: "hand" as const })),
      ...bank("obsession", o.obsession ?? 2, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, active }
  );
}
type GraspBoard = ReturnType<typeof graspBoard>;
const graspOn = (b: GraspBoard, key: string) => play(b.engine, P1, b.id("gr"), { selected: { c: [b.id(key)] } });
const zapOn = (b: GraspBoard, zap: string, key: string) => play(b.engine, P1, b.id(zap), { selected: { t: [b.id(key)] } });
const lifeOf = (b: GraspBoard, key: string) => b.engine.getStat(b.id(key), "life");

clause(GRASP, "0:extraCost", "the card costs exactly 2 with [O][O]: exact payment spends 2, one resource short or one [O] is refused", () => {
  const exact = graspBoard({ obsession: 2 });
  const before = readyOf(exact.engine);
  graspOn(exact, "foe");
  assert.equal(before - readyOf(exact.engine), 2, "the printed cost of 2 is paid");
  assert.equal(zoneOf(exact.engine, exact.id("gr")), "discard", "a resolved tactic goes to the discard pile");
  const short = graspBoard({ obsession: 1 });
  refused(() => playRaw(short.engine, P1, short.id("gr"), { selected: { c: [short.id("foe")] } }), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("gr")), "hand");
  const wrongIcon = graspBoard({ obsession: 1, rage: 4 });
  refused(() => playRaw(wrongIcon.engine, P1, wrongIcon.id("gr"), { selected: { c: [wrongIcon.id("foe")] } }), "only one [O]");
  const none = graspBoard({ obsession: 0, rage: 4 });
  refused(() => playRaw(none.engine, P1, none.id("gr"), { selected: { c: [none.id("foe")] } }), "no [O]");
});

clause(GRASP, "0:extraCost", "Pick a character: any character in play can be picked, mine or the opponent's; the pick is declared as the card is played, before responses", () => {
  for (const key of ["foe", "mine", "stolen"]) {
    const b = graspBoard();
    playRaw(b.engine, P1, b.id("gr"), { selected: { c: [b.id(key)] } });
    assert.ok(b.engine.state.responseWindow, `${key} was picked, the Grasp waits for responses`);
    assert.equal(lifeOf(b, key), 4, "the effect has not happened yet");
    assert.equal(readyOf(b.engine), 0, "the cost is already paid");
    resolvePendingResponses(b.engine);
    assert.equal(lifeOf(b, key), 2, `${key} lost 2 life`);
  }
});

clause(GRASP, "0:extraCost", "only a character in play: no pick, an item, a location, a face-down card, a faction, a character in hand, or two characters are refused", () => {
  const b = graspBoard();
  for (const bad of ["thing", "place", "fd", "inHand", "gr"]) {
    refused(() => playRaw(b.engine, P1, b.id("gr"), { selected: { c: [b.id(bad)] } }), `${bad} is not a character in play`);
  }
  refused(() => playRaw(b.engine, P1, b.id("gr"), { selected: { c: [factionOf(b.engine, P2)] } }), "a faction");
  refused(() => playRaw(b.engine, P1, b.id("gr"), { selected: { c: [] } }), "the pick is required");
  refused(() => playRaw(b.engine, P1, b.id("gr"), { selected: {} }), "no pick declared");
  refused(() => playRaw(b.engine, P1, b.id("gr"), { selected: { c: [b.id("foe"), b.id("foe2")] } }), "one character only");
  assert.equal(zoneOf(b.engine, b.id("gr")), "hand");
  assert.equal(readyOf(b.engine), 2, "nothing was paid by the refused attempts");
});

clause(GRASP, "1:rule", "that character loses 2 life (4 becomes 2), and only that character", () => {
  const b = graspBoard();
  graspOn(b, "foe");
  assert.equal(lifeOf(b, "foe"), 2);
  assert.equal(lifeOf(b, "foe2"), 4, "the opponent's other character is unaffected");
  assert.equal(lifeOf(b, "mine"), 4);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 1, "only life changes");
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 1);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "it survives with 2 life left");
});

clause(GRASP, "1:rule", "'This turn': the life loss ends with the turn", () => {
  const b = graspBoard();
  graspOn(b, "foe");
  assert.equal(lifeOf(b, "foe"), 2);
  endTurn(b.engine, P1);
  assert.equal(lifeOf(b, "foe"), 4, "the opponent's turn: the life is back");
  endTurn(b.engine, P2);
  assert.equal(lifeOf(b, "foe"), 4, "my next turn: still back");
});

clause(GRASP, "1:rule", "the life loss is real: a character with 2 damage on 4 life dies the moment it drops to 2 life", () => {
  const b = graspBoard({ extra: [{ key: "dmg", def: character({ name: "Damaged", life: 4 }), owner: P2, zone: "play", damage: 2 }] });
  graspOn(b, "dmg");
  if (pending(b.engine)?.kind === "chooserSelectsTarget") answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("fh0")] });
  assert.equal(zoneOf(b.engine, b.id("dmg")), "discard", "2 damage on 2 life");
});

clause(GRASP, "1:rule", "if it would be destroyed this turn, its controller (the opponent) discards a card of their choice -- and I discard nothing", () => {
  const b = graspBoard();
  graspOn(b, "foe");
  zapOn(b, "z1", "foe");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "1 damage on 2 life: still alive, nothing yet");
  assert.equal(pending(b.engine), undefined);
  zapOn(b, "z2", "foe");
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is pending");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the character's controller chooses what to discard");
  const myHand = handIds(b.engine, P1);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("fh1")] });
  assert.equal(zoneOf(b.engine, b.id("fh1")), "discard", "the chosen card was discarded");
  assert.equal(zoneOf(b.engine, b.id("fh0")), "hand", "the other card stays");
  assert.equal(handIds(b.engine, P2).length, 2, "they had 2 + the 'inHand' character: exactly one was discarded");
  assert.deepEqual(handIds(b.engine, P1), myHand, "my hand is unchanged");
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "and it is destroyed (the card does not print 'instead')");
});

clause(GRASP, "1:rule", "it discards only the controller's cards of their choice from their hand: a card not in their hand cannot be chosen", () => {
  const b = graspBoard();
  graspOn(b, "foe");
  zapOn(b, "z1", "foe");
  zapOn(b, "z2", "foe");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [b.id("mh0")] } } as never),
    "a card from MY hand is not theirs to discard",
    /target|select|candidate|choose|hand/i
  );
  assert.equal(zoneOf(b.engine, b.id("mh0")), "hand");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("fh0")] });
  assert.equal(zoneOf(b.engine, b.id("fh0")), "discard", "control: one of their own cards works");
});

clause(GRASP, "1:rule", "a character destroyed by an ordinary destroy effect also makes its controller discard exactly one card", () => {
  const b = graspBoard();
  graspOn(b, "foe");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(pending(b.engine)?.playerId, P2);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("fh0")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(zoneOf(b.engine, b.id("fh0")), "discard");
  assert.equal(handIds(b.engine, P2).length, 2, "exactly one card was discarded");
  assert.equal(pending(b.engine), undefined);
});

clause(GRASP, "1:rule", "when it drops to 0 life at once (2 life minus 2), it is destroyed and its controller discards a card", () => {
  const b = graspBoard({ foeLife: 2 });
  graspOn(b, "foe");
  if (pending(b.engine)) {
    assert.equal(pending(b.engine)?.playerId, P2);
    answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("fh0")] });
  }
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "0 life: destroyed");
  assert.equal(zoneOf(b.engine, b.id("fh0")), "discard", "and its controller discarded a card");
  assert.equal(handIds(b.engine, P2).length, 2);
});

clause(GRASP, "1:rule", "it is only about being DESTROYED: a character put into its owner's hand this turn makes nobody discard", () => {
  const b = graspBoard({ extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  graspOn(b, "foe");
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(pending(b.engine), undefined, "it was not destroyed: no discard");
  assert.equal(handIds(b.engine, P2).length, 4, "their hand only gained the bounced character");
});

clause(GRASP, "1:rule", "a character killed in battle counts as destroyed too: its controller discards a card", () => {
  const b = graspBoard({ extra: [{ key: "hit", def: character({ name: "Hitter", strength: 3, life: 6, speed: 1 }), owner: P1, zone: "play" }] });
  graspOn(b, "foe");
  fightThrough(b.engine, P1, [b.id("hit")], { type: "faction", playerId: P2 }, [b.id("foe")], undefined, (pc) =>
    pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("fh0")] } : declineAll(pc)
  );
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "the 2-life blocker died to 3 damage");
  assert.equal(zoneOf(b.engine, b.id("fh0")), "discard", "and its controller discarded a card");
  assert.equal(handIds(b.engine, P2).length, 2);
});

clause(GRASP, "1:rule", "my own picked character: I (its controller) discard a card from MY hand, the opponent discards nothing", () => {
  const b = graspBoard();
  graspOn(b, "mine");
  zapOn(b, "z1", "mine");
  zapOn(b, "z2", "mine");
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is pending");
  assert.equal(pc.playerId, P1, "I choose");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mh0")] });
  assert.equal(zoneOf(b.engine, b.id("mh0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(handIds(b.engine, P2).length, 3, "the opponent's hand is untouched");
});

clause(GRASP, "1:rule", "it is the CONTROLLER who discards: a character I control but the opponent owns makes me discard", () => {
  const b = graspBoard();
  graspOn(b, "stolen");
  zapOn(b, "z1", "stolen");
  zapOn(b, "z2", "stolen");
  assert.equal(pending(b.engine)?.playerId, P1, "its controller (me)");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("mh1")] });
  assert.equal(zoneOf(b.engine, b.id("mh1")), "discard");
  assert.equal(handIds(b.engine, P2).length, 3, "its owner discards nothing");
});

clause(GRASP, "1:rule", "only the picked character: another character of theirs, or of mine, being destroyed this turn makes nobody discard", () => {
  const b = graspBoard();
  graspOn(b, "foe");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe2")] } });
  assert.equal(zoneOf(b.engine, b.id("foe2")), "discard");
  assert.equal(pending(b.engine), undefined, "no discard prompt");
  assert.equal(handIds(b.engine, P2).length, 3, "their hand is untouched");
  assert.equal(discardIds(b.engine, P1).filter((id) => id !== b.id("kill") && id !== b.id("gr")).length, 0, "and I discarded nothing either");
});

clause(GRASP, "1:rule", "with an empty hand there is nothing to discard, and the character is still destroyed", () => {
  const b = graspBoard({ foeHand: 0, inHand: false });
  assert.equal(handIds(b.engine, P2).length, 0, "their hand is empty");
  graspOn(b, "foe");
  zapOn(b, "z1", "foe");
  zapOn(b, "z2", "foe");
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(pending(b.engine), undefined);
});

clause(GRASP, "1:rule", "'This turn': once the turn is over, destroying the character makes its controller discard nothing", () => {
  const b = graspBoard();
  graspOn(b, "foe");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(pending(b.engine), undefined, "the Grasp's effect has worn off: no discard");
  assert.equal(handIds(b.engine, P2).length, 3, "their hand is untouched");
});

// =====================================================================================
// Illusionist's Trick -- tactic, rogue, cost 1, threshold [D]
// EXTRA COST: Pick an opponent.
// That opponent puts cards equal to the highest speed amongst characters you control from the top of their deck into
// their discard pile. Draw a card.
// =====================================================================================

const TRICK = "ab4f55ff-fe17-4dde-b44d-a16b5f7540f6";

function trickBoard(o: { deception?: number; rage?: number; oppDeck?: number; speeds?: number[]; stolenSpeed?: number; extra?: CardPlacement[] } = {}) {
  const speeds = o.speeds ?? [1, 3];
  return duo([
    { key: "it", def: printing(TRICK), owner: P1, zone: "hand" },
    ...speeds.map((speed, i) => ({ key: `m${i}`, def: character({ name: `Mine${i}`, speed }), owner: P1, zone: "play" as const })),
    ...(o.stolenSpeed !== undefined
      ? [{ key: "stolen", def: character({ name: "Stolen", speed: o.stolenSpeed }), owner: P2, controller: P1, zone: "play" as const }]
      : []),
    { key: "fast", def: character({ name: "FastFoe", speed: 9 }), owner: P2, zone: "play" },
    { key: "loaned", def: character({ name: "LoanedOut", speed: 8 }), owner: P1, controller: P2, zone: "play" },
    { key: "killer", def: killAnyTactic("KillChar", "character"), owner: P2, zone: "hand" },
    ...fillers("od", o.oppDeck ?? 7, P2, "deck"),
    ...fillers("md", 4, P1, "deck"),
    ...bank("deception", o.deception ?? 1, P1),
    ...bank("rage", o.rage ?? 0, P1),
    ...(o.extra ?? [])
  ]);
}
type TrickBoard = ReturnType<typeof trickBoard>;
const trickOn = (b: TrickBoard, player: PlayerId = P2) => play(b.engine, P1, b.id("it"), { selected: { p: [factionOf(b.engine, player)] } });

clause(TRICK, "0:extraCost", "the card costs exactly 1 with [D]: it spends 1; with no [D] (plenty of other resources) or no resources it is refused", () => {
  const b = trickBoard({ deception: 2 });
  const before = readyOf(b.engine);
  trickOn(b);
  assert.equal(before - readyOf(b.engine), 1, "the printed cost of 1 is paid");
  assert.equal(zoneOf(b.engine, b.id("it")), "discard");
  const noIcon = trickBoard({ deception: 0, rage: 5 });
  refused(() => playRaw(noIcon.engine, P1, noIcon.id("it"), { selected: { p: [factionOf(noIcon.engine, P2)] } }), "no [D]");
  const none = trickBoard({ deception: 0 });
  refused(() => playRaw(none.engine, P1, none.id("it"), { selected: { p: [factionOf(none.engine, P2)] } }), "no resources");
  assert.equal(zoneOf(none.engine, none.id("it")), "hand");
});

clause(TRICK, "0:extraCost", "Pick an opponent: the opponent can be picked; I cannot pick myself, and no character, item, or nothing at all can stand in for an opponent", () => {
  const b = trickBoard();
  refused(() => playRaw(b.engine, P1, b.id("it"), { selected: { p: [factionOf(b.engine, P1)] } }), "myself is not an opponent");
  refused(() => playRaw(b.engine, P1, b.id("it"), { selected: { p: [b.id("fast")] } }), "a character is not a player");
  refused(() => playRaw(b.engine, P1, b.id("it"), { selected: { p: [] } }), "the pick is required");
  refused(() => playRaw(b.engine, P1, b.id("it"), { selected: {} }), "no pick declared");
  assert.equal(zoneOf(b.engine, b.id("it")), "hand");
  assert.equal(readyOf(b.engine), 1, "nothing was paid by the refused attempts");
  playRaw(b.engine, P1, b.id("it"), { selected: { p: [factionOf(b.engine, P2)] } });
  assert.ok(b.engine.state.responseWindow, "control: the opponent can be picked");
  assert.equal(readyOf(b.engine), 0, "the cost is paid as the card is played");
});

clause(TRICK, "1:rule", "the opponent puts cards equal to the HIGHEST speed amongst my characters (speeds 1 and 3: 3, not 4 or 2) from the top of their deck into their discard pile", () => {
  const b = trickBoard({ speeds: [1, 3] });
  const deck = deckIds(b.engine, P2);
  const discardBefore = discardIds(b.engine, P2).length;
  trickOn(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckIds(b.engine, P2), deck.slice(3), "the top 3 cards left their deck");
  const discard = discardIds(b.engine, P2);
  assert.equal(discard.length, discardBefore + 3, "exactly 3 cards went to their discard pile");
  sameIds(discard, deck.slice(0, 3), "and they are the top 3 cards");
});

clause(TRICK, "1:rule", "a different highest speed gives a different count (speeds 2, 5 and 4: 5)", () => {
  const b = trickBoard({ speeds: [2, 5, 4], oppDeck: 8 });
  const deck = deckIds(b.engine, P2);
  trickOn(b);
  assert.deepEqual(deckIds(b.engine, P2), deck.slice(5));
});

clause(TRICK, "1:rule", "only characters I control count: the opponent's faster characters (speed 9) are ignored, and a character I control but they own counts", () => {
  const b = trickBoard({ speeds: [2], stolenSpeed: 6 });
  const deck = deckIds(b.engine, P2);
  trickOn(b);
  assert.deepEqual(deckIds(b.engine, P2), deck.slice(6), "the stolen speed-6 character counts, the opponent's speed-9 and the loaned-out speed-8 character do not");
});

clause(TRICK, "1:rule", "the count is taken when it resolves: if my fastest character is destroyed in response, the next fastest sets it", () => {
  const b = trickBoard({ speeds: [1, 4] });
  const deck = deckIds(b.engine, P2);
  playRaw(b.engine, P1, b.id("it"), { selected: { p: [factionOf(b.engine, P2)] } });
  castRaw(b.engine, P2, b.id("killer"), { t: [b.id("m1")] });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("m1")), "discard", "the speed-4 character was destroyed in response");
  assert.deepEqual(deckIds(b.engine, P2), deck.slice(1), "only 1 card (the highest speed left is 1)");
});

clause(TRICK, "1:rule", "with no character I control, the highest speed is 0: nothing is put into their discard pile (and I still draw)", () => {
  const b = trickBoard({ speeds: [] });
  const deck = deckIds(b.engine, P2);
  const myDeck = deckIds(b.engine, P1);
  trickOn(b);
  assert.deepEqual(deckIds(b.engine, P2), deck, "their deck is untouched");
  assert.deepEqual(handIds(b.engine, P1), [myDeck[0]], "but I drew a card");
});

clause(TRICK, "1:rule", "a deck shorter than the count: they put all the cards they have", () => {
  const b = trickBoard({ speeds: [5], oppDeck: 2 });
  const deck = deckIds(b.engine, P2);
  trickOn(b);
  assert.deepEqual(deckIds(b.engine, P2), []);
  sameIds(discardIds(b.engine, P2), deck);
});

clause(TRICK, "1:rule", "only the opponent's deck is milled; mine is not (except for the card I draw)", () => {
  const b = trickBoard({ speeds: [3] });
  const myDeck = deckIds(b.engine, P1);
  trickOn(b);
  assert.deepEqual(deckIds(b.engine, P1), myDeck.slice(1), "I lost only the card I drew");
  assert.equal(discardIds(b.engine, P1).filter((id) => myDeck.includes(id)).length, 0, "nothing of my deck went to my discard pile");
});

clause(TRICK, "1:rule", "Draw a card: I draw exactly one card, the top of my deck, and the opponent draws nothing", () => {
  const b = trickBoard({ speeds: [2] });
  const myDeck = deckIds(b.engine, P1);
  const oppHand = handIds(b.engine, P2).length;
  trickOn(b);
  assert.deepEqual(handIds(b.engine, P1), [myDeck[0]], "the top card of my deck");
  assert.equal(handIds(b.engine, P2).length, oppHand, "the opponent drew nothing");
});

// =====================================================================================
// Insidious Brainworm -- character, arcanist, lurker, cost 5, threshold [O][O], 3 strength / 3 speed / 4 life
// When this card enters play, each opponent loses 3 influence.
// =====================================================================================

const BRAINWORM = "0fca82df-12d4-4a50-abe5-1ed3c79d3fc1";

function wormBoard(o: { worm?: "hand" | "play"; extra?: CardPlacement[] } = {}) {
  return duo([
    { key: "w", def: printing(BRAINWORM), owner: P1, zone: o.worm ?? "hand" },
    { key: "w2", def: printing(BRAINWORM), owner: P1, zone: "hand" },
    { key: "ally", def: character({ name: "Ally", cost: 0 }), owner: P1, zone: "hand" },
    {
      key: "put",
      def: tactic({
        name: "PutIn",
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
      }),
      owner: P1,
      zone: "hand"
    },
    ...bank("obsession", 10, P1),
    ...(o.extra ?? [])
  ]);
}

clause(BRAINWORM, "0:rule", "the printed card: a 5-cost [O][O] arcanist lurker with 3 strength, 3 speed and 4 life", () => {
  basicDeploy(BRAINWORM, { cost: 5, icon: "obsession", icons: 2, type: "character", stats: [3, 3, 4], subtypes: ["lurker"] });
  const b = wormBoard();
  assert.equal(b.engine.getDefinition(b.id("w")).trade, "arcanist");
});

clause(BRAINWORM, "0:rule", "when it enters play the opponent loses 3 influence and my influence is unchanged", () => {
  const b = wormBoard();
  const [mine, theirs] = [infl(b.engine, P1), infl(b.engine, P2)];
  play(b.engine, P1, b.id("w"));
  assert.equal(zoneOf(b.engine, b.id("w")), "play");
  assert.equal(infl(b.engine, P2), theirs - 3, "each opponent loses 3");
  assert.equal(infl(b.engine, P1), mine, "I lose nothing");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(BRAINWORM, "0:rule", "'each opponent' is the opponent of the Worm's CONTROLLER: a Worm I own that the opponent puts into play under their control costs ME 3, not them", () => {
  const steal = tactic({
    name: "PutTheirs",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "c", selector: { owner: "opponent", zone: "hand", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "c" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = duo([{ key: "w", def: printing(BRAINWORM), owner: P1, zone: "hand" }, { key: "steal", def: steal, owner: P2, zone: "hand" }], { turn: 2, active: P2 });
  const [mine, theirs] = [infl(b.engine, P1), infl(b.engine, P2)];
  play(b.engine, P2, b.id("steal"), { selected: { c: [b.id("w")] } });
  assert.equal(zoneOf(b.engine, b.id("w")), "play");
  assert.equal(controllerOf2(b.engine, b.id("w")), P2, "the opponent controls my Worm");
  assert.equal(infl(b.engine, P1), mine - 3, "its controller's opponent (me) loses 3");
  assert.equal(infl(b.engine, P2), theirs);
});

clause(BRAINWORM, "0:rule", "losing influence stops at 0: an opponent with 2 influence is left at 0, not below", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: 2 },
    cards: [{ key: "w", def: printing(BRAINWORM), owner: P1, zone: "hand" }, ...bank("obsession", 5, P1)]
  });
  play(b.engine, P1, b.id("w"));
  assert.equal(infl(b.engine, P2), 0, "influence cannot go below 0 (CR 410.4)");
});

clause(BRAINWORM, "0:rule", "it happens when the Worm enters play, not before: waiting for responses, the opponent still has their influence", () => {
  const b = wormBoard();
  const theirs = infl(b.engine, P2);
  playRaw(b.engine, P1, b.id("w"));
  assert.ok(b.engine.state.responseWindow, "b.engine.state.responseWindow");
  assert.equal(infl(b.engine, P2), theirs, "not yet");
  resolvePendingResponses(b.engine);
  assert.equal(infl(b.engine, P2), theirs - 3);
});

clause(BRAINWORM, "0:rule", "'enters play' covers every way in: put into play by an effect it triggers too", () => {
  const b = wormBoard();
  const theirs = infl(b.engine, P2);
  play(b.engine, P1, b.id("put"), { selected: { c: [b.id("w")] } });
  assert.equal(zoneOf(b.engine, b.id("w")), "play");
  assert.equal(infl(b.engine, P2), theirs - 3);
});

clause(BRAINWORM, "0:rule", "only when THIS card enters play: with a Worm already in play, another character entering does nothing; a second Worm costs them 3, not 6", () => {
  const b = wormBoard({ worm: "play" });
  const theirs = infl(b.engine, P2);
  play(b.engine, P1, b.id("ally"));
  assert.equal(infl(b.engine, P2), theirs, "a plain character entering: nothing");
  play(b.engine, P1, b.id("w2"));
  assert.equal(zoneOf(b.engine, b.id("w2")), "play");
  assert.equal(infl(b.engine, P2), theirs - 3, "only the new Worm's own trigger");
});

clause(BRAINWORM, "0:rule", "while the Worm sits in my hand or an opponent's character enters play, the opponent loses nothing", () => {
  const b = wormBoard({ extra: [{ key: "oppAlly", def: character({ name: "OppAlly", cost: 0 }), owner: P2, zone: "hand" }] });
  const theirs = infl(b.engine, P2);
  const eb = duo([
    { key: "w", def: printing(BRAINWORM), owner: P1, zone: "play" },
    { key: "oppAlly", def: character({ name: "OppAlly", cost: 0 }), owner: P2, zone: "hand" }
  ], { turn: 2, active: P2 });
  const ebTheirs = infl(eb.engine, P2);
  const ebMine = infl(eb.engine, P1);
  play(eb.engine, P2, eb.id("oppAlly"));
  assert.equal(zoneOf(eb.engine, eb.id("oppAlly")), "play");
  assert.equal(infl(eb.engine, P2), ebTheirs);
  assert.equal(infl(eb.engine, P1), ebMine);
  assert.equal(infl(b.engine, P2), theirs);
});

// =====================================================================================
// Insanity / Lust / Materialism -- resources (cost 0)
// When a resource enters play under your control, name <icon A> icon or <icon B> icon. X is the named icon. This turn,
// this card gains "PROVIDES: X".
//   Insanity [O] or [R] (arcanist) -- Lust [G] or [D] (banker) -- Materialism [G] or [E] (banker)
// =====================================================================================

const INSANITY = "9e2b11d9-0be3-4309-8889-a650999b836e";
const LUST = "cd8a853b-d96d-4a55-94a3-eedd8a2e5e50";
const MATERIALISM = "a8ce4587-60fb-4a52-8e7d-d7706d9f5059";

const ICON_LETTER: Record<string, string> = { rage: "r", greed: "g", deception: "d", elitism: "e", obsession: "o" };
const ALL_ICONS = ["rage", "greed", "deception", "elitism", "obsession", "volition"];
const thresholdOf = (engine: SpoilsEngine, icon: string, player: PlayerId = P1): number => (engine.getThresholds(player) as Record<string, number>)[icon] ?? 0;
const incomingRes = (name = "Incoming", icon: StapleIcon = "elitism"): CardDefinition =>
  resourceCard({ name, resource: { provides: [icon], staple: true } });

interface NamerSpec {
  id: string;
  a: StapleIcon;
  b: StapleIcon;
  /** a staple icon the namer cannot name and the incoming resource provides */
  third: StapleIcon;
}
const INSANITY_SPEC: NamerSpec = { id: INSANITY, a: "obsession", b: "rage", third: "elitism" };
const LUST_SPEC: NamerSpec = { id: LUST, a: "greed", b: "deception", third: "rage" };
const MATERIALISM_SPEC: NamerSpec = { id: MATERIALISM, a: "greed", b: "elitism", third: "rage" };

function namerBoard(s: NamerSpec, o: { namer?: "play" | "hand" | "discard"; extra?: CardPlacement[]; faction?: CardDefinition } = {}) {
  return buildGame({
    playerA: { faction: o.faction ?? developFaction() },
    playerB: { faction: o.faction ?? developFaction() },
    cards: [
      { key: "n", def: printing(s.id), owner: P1, zone: o.namer ?? "play" },
      { key: "r1", def: incomingRes("Incoming1", s.third), owner: P1, zone: "hand" },
      { key: "r2", def: incomingRes("Incoming2", s.third), owner: P1, zone: "hand" },
      { key: "r3", def: incomingRes("Incoming3", s.third), owner: P1, zone: "hand" },
      { key: "oppR", def: incomingRes("OppIncoming", s.third), owner: P2, zone: "hand" },
      { key: "ch", def: character({ name: "Walker", cost: 0 }), owner: P1, zone: "hand" },
      {
        key: "putRes",
        def: tactic({
          name: "PutResource",
          cost: 0,
          behavior: {
            abilities: [
              {
                id: "put",
                type: "activated",
                targets: [{ id: "c", selector: { owner: "self", zone: "hand", type: "resource" }, count: 1 }],
                effects: [{ type: "putIntoPlay", target: { type: "selected", id: "c" }, controller: "controller" }]
              }
            ]
          }
        }),
        owner: P1,
        zone: "hand"
      },
      ...(o.extra ?? [])
    ]
  });
}
type NamerBoard = ReturnType<typeof namerBoard>;
const namePrompt = (b: NamerBoard) => pending(b.engine);
const nameIt = (b: NamerBoard, value: string) =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value } } as never);

const namerIsAResource = (s: NamerSpec) => () => {
  const b = namerBoard(s);
  const def = b.engine.getDefinition(b.id("n"));
  assert.equal(def.type, "resource");
  assert.equal(def.cost, 0, "cost 0");
  assert.equal(b.engine.isResource(b.id("n")), true);
};
const namerAsksOnResourceEntering = (s: NamerSpec) => () => {
  const b = namerBoard(s);
  developResource(b.engine, P1, b.id("r1"), false);
  const pc = namePrompt(b);
  assert.ok(pc, "a prompt is open");
  assert.equal(pc.kind, "nameValue");
  assert.equal(pc.playerId, P1, "I name the icon");
  assert.deepEqual([...(pc.options as string[])].sort(), [s.a, s.b].sort(), "exactly the two printed icons are offered");
};
const namerRefusesOtherIcons = (s: NamerSpec) => () => {
  const b = namerBoard(s);
  developResource(b.engine, P1, b.id("r1"), false);
  for (const other of ALL_ICONS.filter((i) => i !== s.a && i !== s.b)) {
    refused(() => nameIt(b, other), `${other} is not one of the two printed icons`, /name|icon|option|value|choice|choose/i);
    assert.equal(namePrompt(b)?.kind, "nameValue", `still waiting after naming ${other}`);
  }
  refused(() => nameIt(b, ""), "the naming cannot be skipped", /name|icon|option|value|choice|choose/i);
  assert.equal(namePrompt(b)?.kind, "nameValue");
  nameIt(b, s.a);
  assert.equal(b.engine.state.pendingChoice, undefined, "control: a printed icon is accepted");
};
const namerGrantsNamedIcon = (s: NamerSpec) => () => {
  for (const [named, other] of [[s.a, s.b], [s.b, s.a]] as const) {
    const b = namerBoard(s);
    developResource(b.engine, P1, b.id("r1"), false);
    const before = { named: thresholdOf(b.engine, named), other: thresholdOf(b.engine, other) };
    nameIt(b, named);
    resolvePendingResponses(b.engine);
    assert.equal(thresholdOf(b.engine, named), before.named + 1, `naming ${named}: the card now provides one ${named}`);
    assert.equal(thresholdOf(b.engine, other), before.other, `and none of the other icon (${other})`);
  }
};
const namerNothingByItself = (s: NamerSpec) => () => {
  const b = namerBoard(s, { namer: "hand" });
  const before = { a: thresholdOf(b.engine, s.a), b: thresholdOf(b.engine, s.b) };
  developResource(b.engine, P1, b.id("n"), false);
  assert.equal(zoneOf(b.engine, b.id("n")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no prompt for its own entry");
  assert.equal(thresholdOf(b.engine, s.a), before.a, "it provides nothing on its own");
  assert.equal(thresholdOf(b.engine, s.b), before.b);
};
const namerGrantMeetsThresholds = (s: NamerSpec) => () => {
  const gateFor = (icon: StapleIcon) => item({ name: `Gate ${icon}`, cost: 0, threshold: ICON_LETTER[icon] });
  const mk = () => namerBoard(s, { extra: [{ key: "gateA", def: gateFor(s.a), owner: P1, zone: "hand" }, { key: "gateB", def: gateFor(s.b), owner: P1, zone: "hand" }] });
  const before = mk();
  refused(() => playRaw(before.engine, P1, before.id("gateA")), `before naming nothing provides ${s.a}`);
  const b = mk();
  developResource(b.engine, P1, b.id("r1"), false);
  nameIt(b, s.a);
  resolvePendingResponses(b.engine);
  play(b.engine, P1, b.id("gateA"));
  assert.equal(zoneOf(b.engine, b.id("gateA")), "play", `the granted ${s.a} meets a [${ICON_LETTER[s.a]}] threshold`);
  refused(() => playRaw(b.engine, P1, b.id("gateB")), `but naming ${s.a} does not provide ${s.b}`);
  assert.equal(zoneOf(b.engine, b.id("gateB")), "hand");
};
const namerLastsThisTurn = (s: NamerSpec) => () => {
  const b = namerBoard(s, { faction: barrenFaction() });
  castRaw(b.engine, P1, b.id("putRes"), { c: [b.id("r1")] });
  resolvePendingResponses(b.engine);
  const base = thresholdOf(b.engine, s.a);
  nameIt(b, s.a);
  resolvePendingResponses(b.engine);
  assert.equal(thresholdOf(b.engine, s.a), base + 1, "this turn it provides the icon");
  endTurn(b.engine, P1);
  assert.equal(thresholdOf(b.engine, s.a), base, "the opponent's turn: the grant is gone");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(thresholdOf(b.engine, s.a), base, "my next turn: still gone");
};
const namerOnlyMyResources = (s: NamerSpec) => () => {
  // an opponent's resource entering, a non-resource entering, and the namer in the hand or discard pile: no prompt
  const opp = namerBoard(s);
  opp.engine.state.activePlayerId = P2;
  developResource(opp.engine, P2, opp.id("oppR"), false);
  assert.equal(zoneOf(opp.engine, opp.id("oppR")), "play");
  assert.equal(opp.engine.state.pendingChoice, undefined, "an opponent's resource entering does not prompt me");
  const nonRes = namerBoard(s);
  play(nonRes.engine, P1, nonRes.id("ch"));
  assert.equal(zoneOf(nonRes.engine, nonRes.id("ch")), "play");
  assert.equal(nonRes.engine.state.pendingChoice, undefined, "a character entering is not a resource");
  for (const zone of ["hand", "discard"] as const) {
    const away = namerBoard(s, { namer: zone });
    developResource(away.engine, P1, away.id("r1"), false);
    assert.equal(zoneOf(away.engine, away.id("r1")), "play");
    assert.equal(away.engine.state.pendingChoice, undefined, `with the card in my ${zone} it does nothing`);
  }
  // control: my own resource entering does prompt
  const mine = namerBoard(s);
  developResource(mine.engine, P1, mine.id("r1"), false);
  assert.equal(namePrompt(mine)?.kind, "nameValue", "control: my own resource entering prompts");
};
const namerFaceDownAndEffects = (s: NamerSpec) => () => {
  const down = namerBoard(s);
  developResource(down.engine, P1, down.id("r1"), true);
  assert.equal(namePrompt(down)?.kind, "nameValue", "a face-down resource is a resource too (CR 411.1)");
  const viaEffect = namerBoard(s);
  castRaw(viaEffect.engine, P1, viaEffect.id("putRes"), { c: [viaEffect.id("r1")] });
  resolvePendingResponses(viaEffect.engine);
  assert.equal(zoneOf(viaEffect.engine, viaEffect.id("r1")), "play");
  assert.equal(namePrompt(viaEffect)?.kind, "nameValue", "a resource put into play by an effect also enters play");
};
const namerStacks = (s: NamerSpec) => () => {
  const b = namerBoard(s);
  const base = thresholdOf(b.engine, s.a);
  developResource(b.engine, P1, b.id("r1"), false);
  nameIt(b, s.a);
  resolvePendingResponses(b.engine);
  castRaw(b.engine, P1, b.id("putRes"), { c: [b.id("r2")] });
  resolvePendingResponses(b.engine);
  assert.equal(namePrompt(b)?.kind, "nameValue", "a second resource entering asks again");
  nameIt(b, s.a);
  resolvePendingResponses(b.engine);
  assert.equal(thresholdOf(b.engine, s.a), base + 2, "two namings of the same icon: provides it twice");
};

clause(INSANITY, "0:rule", "it is a resource with cost 0", namerIsAResource(INSANITY_SPEC));
clause(INSANITY, "0:rule", "when a resource enters play under my control I am asked to name [O] or [R] (exactly those two)", namerAsksOnResourceEntering(INSANITY_SPEC));
clause(INSANITY, "0:rule", "any other icon (or nothing) is refused: the naming is mandatory and limited to the two icons", namerRefusesOtherIcons(INSANITY_SPEC));
clause(INSANITY, "0:rule", "naming an icon makes it provide exactly one of that icon, and none of the other", namerGrantsNamedIcon(INSANITY_SPEC));
clause(INSANITY, "0:rule", "on its own (no other resource entering) it provides nothing and does not ask when it enters play itself", namerNothingByItself(INSANITY_SPEC));
clause(INSANITY, "0:rule", "the granted icon really meets a threshold of that icon, and not of the other one", namerGrantMeetsThresholds(INSANITY_SPEC));
clause(INSANITY, "0:rule", "'This turn': the granted icon is gone when the turn ends", namerLastsThisTurn(INSANITY_SPEC));
clause(INSANITY, "0:rule", "only a resource entering under MY control, while the card is in play: an opponent's resource, a character, or the card in hand / discard do nothing", namerOnlyMyResources(INSANITY_SPEC));
clause(INSANITY, "0:rule", "a face-down resource and a resource put into play by an effect both count as 'a resource enters play'", namerFaceDownAndEffects(INSANITY_SPEC));
clause(INSANITY, "0:rule", "it triggers for each resource that enters: two resources, two namings, two icons provided", namerStacks(INSANITY_SPEC));

clause(LUST, "0:rule", "it is a resource with cost 0", namerIsAResource(LUST_SPEC));
clause(LUST, "0:rule", "when a resource enters play under my control I am asked to name [G] or [D] (exactly those two)", namerAsksOnResourceEntering(LUST_SPEC));
clause(LUST, "0:rule", "any other icon (or nothing) is refused: the naming is mandatory and limited to the two icons", namerRefusesOtherIcons(LUST_SPEC));
clause(LUST, "0:rule", "naming an icon makes it provide exactly one of that icon, and none of the other", namerGrantsNamedIcon(LUST_SPEC));
clause(LUST, "0:rule", "on its own (no other resource entering) it provides nothing and does not ask when it enters play itself", namerNothingByItself(LUST_SPEC));
clause(LUST, "0:rule", "the granted icon really meets a threshold of that icon, and not of the other one", namerGrantMeetsThresholds(LUST_SPEC));
clause(LUST, "0:rule", "'This turn': the granted icon is gone when the turn ends", namerLastsThisTurn(LUST_SPEC));
clause(LUST, "0:rule", "only a resource entering under MY control, while the card is in play: an opponent's resource, a character, or the card in hand / discard do nothing", namerOnlyMyResources(LUST_SPEC));
clause(LUST, "0:rule", "a face-down resource and a resource put into play by an effect both count as 'a resource enters play'", namerFaceDownAndEffects(LUST_SPEC));
clause(LUST, "0:rule", "it triggers for each resource that enters: two resources, two namings, two icons provided", namerStacks(LUST_SPEC));

clause(MATERIALISM, "0:rule", "it is a resource with cost 0", namerIsAResource(MATERIALISM_SPEC));
clause(MATERIALISM, "0:rule", "when a resource enters play under my control I am asked to name [G] or [E] (exactly those two)", namerAsksOnResourceEntering(MATERIALISM_SPEC));
clause(MATERIALISM, "0:rule", "any other icon (or nothing) is refused: the naming is mandatory and limited to the two icons", namerRefusesOtherIcons(MATERIALISM_SPEC));
clause(MATERIALISM, "0:rule", "naming an icon makes it provide exactly one of that icon, and none of the other", namerGrantsNamedIcon(MATERIALISM_SPEC));
clause(MATERIALISM, "0:rule", "on its own (no other resource entering) it provides nothing and does not ask when it enters play itself", namerNothingByItself(MATERIALISM_SPEC));
clause(MATERIALISM, "0:rule", "the granted icon really meets a threshold of that icon, and not of the other one", namerGrantMeetsThresholds(MATERIALISM_SPEC));
clause(MATERIALISM, "0:rule", "'This turn': the granted icon is gone when the turn ends", namerLastsThisTurn(MATERIALISM_SPEC));
clause(MATERIALISM, "0:rule", "only a resource entering under MY control, while the card is in play: an opponent's resource, a character, or the card in hand / discard do nothing", namerOnlyMyResources(MATERIALISM_SPEC));
clause(MATERIALISM, "0:rule", "a face-down resource and a resource put into play by an effect both count as 'a resource enters play'", namerFaceDownAndEffects(MATERIALISM_SPEC));
clause(MATERIALISM, "0:rule", "it triggers for each resource that enters: two resources, two namings, two icons provided", namerStacks(MATERIALISM_SPEC));

}

{
// =====================================================================================
// Lightning Barrage -- tactic, warlord, cost 3, threshold [R][R]
// EXTRA COST: Pick a faction.
// Inflict 3 damage to it. If you deployed another non-resource card this turn, put this card into its owner's hand
// instead of their discard pile.
// =====================================================================================

const BARRAGE = "357b9c44-4f06-442c-8a2f-70fa72cb745a";

function lbBoard(o: { rage?: number; greed?: number; active?: PlayerId; develop?: boolean; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return (o.develop ? duo : quietDuo)(
    [
      { key: "lb", def: printing(BARRAGE), owner: P1, zone: "hand" },
      { key: "lb2", def: printing(BARRAGE), owner: P1, zone: "hand" },
      { key: "guy", def: character({ name: "Guy", cost: 1 }), owner: P1, zone: "hand" },
      { key: "gear", def: item({ name: "Gear", cost: 1 }), owner: P1, zone: "hand" },
      { key: "spot", def: location({ name: "Spot", cost: 1 }), owner: P1, zone: "hand" },
      { key: "noop", def: noopTactic("Noop"), owner: P1, zone: "hand" },
      { key: "oppNoop", def: noopTactic("OppNoop"), owner: P2, zone: "hand" },
      { key: "oppGuy", def: character({ name: "OppGuy", cost: 0 }), owner: P2, zone: "hand" },
      { key: "res", def: resourceCard({ name: "HandRes" }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      ...fillers("md", 4, P1, "deck"),
      ...bank("rage", o.rage ?? 6, P1),
      ...bank("greed", o.greed ?? 3, P1),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, active }
  );
}
type LbBoard = ReturnType<typeof lbBoard>;
const lbOn = (b: LbBoard, who: PlayerId = P2, key = "lb") => play(b.engine, P1, b.id(key), { selected: { f: [factionOf(b.engine, who)] } });
const lbRaw = (b: LbBoard, who: PlayerId = P2, key = "lb") => playRaw(b.engine, P1, b.id(key), { selected: { f: [factionOf(b.engine, who)] } });

clause(BARRAGE, "0:extraCost", "the card costs exactly 3 with [R][R]: exact payment spends 3, two resources or one [R] are refused", () => {
  const exact = lbBoard({ rage: 2, greed: 1 });
  const before = readyOf(exact.engine);
  lbOn(exact);
  assert.equal(before - readyOf(exact.engine), 3, "the printed cost of 3 is paid");
  const short = lbBoard({ rage: 2, greed: 0 });
  refused(() => lbRaw(short), "two resources are one short");
  assert.equal(zoneOf(short.engine, short.id("lb")), "hand");
  assert.equal(readyOf(short.engine), 2);
  const oneRage = lbBoard({ rage: 1, greed: 4 });
  refused(() => lbRaw(oneRage), "only one [R]");
  const noRage = lbBoard({ rage: 0, greed: 5 });
  refused(() => lbRaw(noRage), "no [R]");
  assert.equal(infl(noRage.engine, P2), infl(exact.engine, P2) + 3, "nothing happened to the opponent");
});

clause(BARRAGE, "0:extraCost", "it is a tactic: playable as a response on the opponent's turn", () => {
  const b = lbBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  refused(() => lbRaw(b), "no window is open");
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  const before = infl(b.engine, P2);
  lbOn(b);
  assert.equal(infl(b.engine, P2), before - 3);
});

clause(BARRAGE, "0:extraCost", "Pick a faction: either faction can be picked (the opponent's or my own); the pick is made as the card is played, before the damage", () => {
  const theirs = lbBoard();
  const oppBefore = infl(theirs.engine, P2);
  lbRaw(theirs, P2);
  assert.ok(theirs.engine.state.responseWindow, "waiting for responses");
  assert.equal(infl(theirs.engine, P2), oppBefore, "no damage yet");
  assert.equal(readyOf(theirs.engine), 6, "the cost of 3 is already paid");
  resolvePendingResponses(theirs.engine);
  assert.equal(infl(theirs.engine, P2), oppBefore - 3);
  const mine = lbBoard();
  const myBefore = infl(mine.engine, P1);
  lbOn(mine, P1);
  assert.equal(infl(mine.engine, P1), myBefore - 3, "I can pick my own faction");
  assert.equal(infl(mine.engine, P2), infl(theirs.engine, P2) + 3, "and then the opponent takes nothing");
});

clause(BARRAGE, "0:extraCost", "only a faction can be picked: a character, a location, an item, a resource or nothing is refused; two factions are refused", () => {
  const b = lbBoard();
  refused(() => playRaw(b.engine, P1, b.id("lb"), { selected: { f: [b.id("foe")] } }), "a character");
  refused(() => playRaw(b.engine, P1, b.id("lb"), { selected: { f: [b.id("place")] } }), "a location");
  refused(() => playRaw(b.engine, P1, b.id("lb"), { selected: { f: [b.id("mine")] } }), "my own character");
  refused(() => playRaw(b.engine, P1, b.id("lb"), { selected: { f: [] } }), "the pick is required");
  refused(() => playRaw(b.engine, P1, b.id("lb"), { selected: {} }), "no pick declared");
  refused(() => playRaw(b.engine, P1, b.id("lb"), { selected: { f: [factionOf(b.engine, P1), factionOf(b.engine, P2)] } }), "only one faction");
  assert.equal(zoneOf(b.engine, b.id("lb")), "hand");
  assert.equal(readyOf(b.engine), 9, "nothing was paid by the refused attempts");
  lbRaw(b);
  assert.ok(b.engine.state.responseWindow, "control: a faction is accepted");
});

clause(BARRAGE, "1:rule", "Inflict 3 damage to it: the picked faction loses exactly 3 influence and the other faction is untouched", () => {
  const b = lbBoard();
  const [mine, theirs] = [infl(b.engine, P1), infl(b.engine, P2)];
  lbOn(b, P2);
  assert.equal(infl(b.engine, P2), theirs - 3);
  assert.equal(infl(b.engine, P1), mine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "no character is hurt");
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 0);
});

clause(BARRAGE, "1:rule", "damage stops at 0: a faction with 2 influence is left at 0, not below", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction(), influence: 2 },
    cards: [{ key: "lb", def: printing(BARRAGE), owner: P1, zone: "hand" }, ...bank("rage", 3, P1)]
  });
  play(b.engine, P1, b.id("lb"), { selected: { f: [factionOf(b.engine, P2)] } });
  assert.equal(infl(b.engine, P2), 0, "influence cannot go below 0 (CR 410.4)");
});

clause(BARRAGE, "1:rule", "with no other non-resource card deployed this turn, it goes to the discard pile", () => {
  const b = lbBoard();
  lbOn(b);
  assert.equal(zoneOf(b.engine, b.id("lb")), "discard");
  assert.ok(discardIds(b.engine, P1).includes(b.id("lb")), "discardIds(b.engine, P1).includes(b.id(lb))");
  assert.equal(handIds(b.engine, P1).includes(b.id("lb")), false);
});

clause(BARRAGE, "1:rule", "if I deployed another non-resource card this turn -- a character, an item, a location or a tactic -- it returns to my hand instead of the discard pile", () => {
  for (const first of ["guy", "gear", "spot", "noop"]) {
    const b = lbBoard();
    play(b.engine, P1, b.id(first));
    const oppBefore = infl(b.engine, P2);
    lbOn(b);
    assert.equal(infl(b.engine, P2), oppBefore - 3, `${first}: the damage is still inflicted`);
    assert.equal(zoneOf(b.engine, b.id("lb")), "hand", `after deploying ${first} the Barrage returns to my hand`);
    assert.equal(discardIds(b.engine, P1).includes(b.id("lb")), false, "and not into the discard pile");
  }
});

clause(BARRAGE, "1:rule", "a resource played this turn is not a deployed non-resource card: the Barrage goes to the discard pile", () => {
  const b = lbBoard({ develop: true });
  developResource(b.engine, P1, b.id("res"), false);
  assert.equal(zoneOf(b.engine, b.id("res")), "play");
  lbOn(b);
  assert.equal(zoneOf(b.engine, b.id("lb")), "discard");
  const down = lbBoard({ develop: true });
  developResource(down.engine, P1, down.id("res"), true);
  lbOn(down);
  assert.equal(zoneOf(down.engine, down.id("lb")), "discard", "a face-down resource play neither");
});

clause(BARRAGE, "1:rule", "'another': the Barrage itself does not count, and neither does a card the OPPONENT deployed", () => {
  const b = lbBoard();
  lbRaw(b);
  castRaw(b.engine, P2, b.id("oppNoop"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("oppNoop")), "discard");
  assert.equal(zoneOf(b.engine, b.id("lb")), "discard", "the opponent's response tactic is not 'you deployed'");
  const earlier = lbBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" }] });
  play(earlier.engine, P2, earlier.id("oppGuy"));
  declareAttackOpenWindow(earlier.engine, P2, [earlier.id("atk")]);
  lbOn(earlier);
  assert.equal(zoneOf(earlier.engine, earlier.id("lb")), "discard", "a card the opponent deployed earlier this turn does not count either");
});

clause(BARRAGE, "1:rule", "'this turn': a card deployed on an earlier turn does not count", () => {
  const b = lbBoard();
  play(b.engine, P1, b.id("guy"));
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  lbOn(b);
  assert.equal(zoneOf(b.engine, b.id("lb")), "discard", "the Guy was deployed last turn");
});

clause(BARRAGE, "1:rule", "a card I deploy in response, after the Barrage was played but before it resolves, counts: it has been deployed this turn", () => {
  const b = lbBoard();
  lbRaw(b);
  castRaw(b.engine, P2, b.id("oppNoop"));
  castRaw(b.engine, P1, b.id("noop"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("noop")), "discard");
  assert.equal(zoneOf(b.engine, b.id("lb")), "hand", "another non-resource card of mine was deployed this turn");
});

clause(BARRAGE, "1:rule", "a second Barrage after another deploy also returns, and each returns to ITS owner's hand", () => {
  const b = lbBoard();
  const start = infl(b.engine, P2);
  play(b.engine, P1, b.id("guy"));
  lbOn(b, P2, "lb");
  assert.equal(zoneOf(b.engine, b.id("lb")), "hand");
  lbOn(b, P2, "lb2");
  assert.equal(zoneOf(b.engine, b.id("lb2")), "hand");
  assert.equal(infl(b.engine, P2), start - 6, "both inflicted 3");
});

// =====================================================================================
// Luteorunic Behemoth -- character, gearsmith, behemoth, cost 10, threshold [E][E][E], 12 strength / 3 speed / 12 life
// When this card is deployed, all opponents must destroy 4 non-staple cards they control.
// TRY AGAIN TOMORROW NIGHT -- COST: Pay 2. Destroy a resource you control. EFFECT: Put this card into its owner's hand.
// =====================================================================================

const BEHEMOTH = "40841abf-5c44-4a67-8597-2675a2cad9bb";

const nonStaple = (name: string, icon: StapleIcon = "rage"): CardDefinition => resourceCard({ name, resource: { provides: [icon], staple: false } });

function behBoard(o: { zone?: "hand" | "play"; elitism?: number; extra?: CardPlacement[]; oppStuff?: boolean; behController?: PlayerId } = {}) {
  return duo([
    { key: "beh", def: printing(BEHEMOTH), owner: P1, controller: o.behController, zone: o.zone ?? "hand" },
    ...bank("elitism", o.elitism ?? 10, P1),
    ...(o.oppStuff === false
      ? []
      : ([
          { key: "oc0", def: character({ name: "OppChar0" }), owner: P2, zone: "play" },
          { key: "oc1", def: character({ name: "OppChar1" }), owner: P2, zone: "play" },
          { key: "oi", def: item({ name: "OppItem" }), owner: P2, zone: "play" },
          { key: "ol", def: location({ name: "OppPlace" }), owner: P2, zone: "play" },
          { key: "ons", def: nonStaple("OppOddRes"), owner: P2, zone: "play" },
          { key: "fd", def: character({ name: "OppHidden" }), owner: P2, zone: "play", faceDown: true },
          ...bank("greed", 2, P2).map((p, i) => ({ ...p, key: `staple${i}` }))
        ] as CardPlacement[])),
    { key: "mc", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
    { key: "mi", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
    ...(o.extra ?? [])
  ]);
}
type BehBoard = ReturnType<typeof behBoard>;
const OPP_NONSTAPLE = ["oc0", "oc1", "oi", "ol", "ons", "fd"];
const pickDestroy = (b: BehBoard, keys: string[]) => answerPending(b.engine, "chooserSelectsTarget", { selected: keys.map((k) => b.id(k)) });
const tryDestroy = (b: BehBoard, keys: string[]) => () =>
  b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: keys.map((k) => b.id(k)) } } as never);

clause(BEHEMOTH, "0:rule", "the card costs exactly 10 with [E][E][E] and is a 12 / 3 / 12 gearsmith behemoth", () => {
  const ok = behBoard({ oppStuff: false });
  const before = readyOf(ok.engine);
  play(ok.engine, P1, ok.id("beh"));
  assert.equal(zoneOf(ok.engine, ok.id("beh")), "play");
  assert.equal(before - readyOf(ok.engine), 10, "the printed cost of 10 is paid");
  assert.equal(ok.engine.getStat(ok.id("beh"), "strength"), 12);
  assert.equal(ok.engine.getStat(ok.id("beh"), "speed"), 3);
  assert.equal(ok.engine.getStat(ok.id("beh"), "life"), 12);
  assert.equal(ok.engine.getDefinition(ok.id("beh")).trade, "gearsmith");
  assert.ok(ok.engine.getDefinition(ok.id("beh")).subtype.includes("behemoth"), "ok.engine.getDefinition(ok.id(beh)).subtype.includes(behemoth)");
  const nine = behBoard({ elitism: 9, oppStuff: false });
  refused(() => playRaw(nine.engine, P1, nine.id("beh")), "9 resources are one short");
  const wrong = behBoard({ elitism: 2, oppStuff: false, extra: bank("rage", 9, P1) });
  refused(() => playRaw(wrong.engine, P1, wrong.id("beh")), "only two [E]");
  assert.equal(zoneOf(wrong.engine, wrong.id("beh")), "hand");
});

clause(BEHEMOTH, "0:rule", "when it is deployed my opponent is asked to choose 4 non-staple cards they control (they choose, not me)", () => {
  const b = behBoard();
  play(b.engine, P1, b.id("beh"));
  const pc = pending(b.engine);
  assert.ok(pc, "a choice is pending");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses what to destroy");
});

clause(BEHEMOTH, "0:rule", "the four chosen cards are destroyed (into their owner's discard pile) and nothing else is", () => {
  const b = behBoard();
  play(b.engine, P1, b.id("beh"));
  pickDestroy(b, ["oc0", "oi", "ons", "fd"]);
  for (const key of ["oc0", "oi", "ons", "fd"]) {
    assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was destroyed`);
    assert.ok(discardIds(b.engine, P2).includes(b.id(key)), "discardIds(b.engine, P2).includes(b.id(key))");
  }
  for (const key of ["oc1", "ol", "staple0", "staple1"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} stays`);
  for (const key of ["mc", "mi", "beh"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `my ${key} stays`);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(BEHEMOTH, "0:rule", "any kind of non-staple card can be chosen: characters, items, locations, non-staple resources and face-down cards (which have no characteristics, so are not staples)", () => {
  for (const group of [["oc0", "oc1", "oi", "ol"], ["ons", "fd", "ol", "oi"]]) {
    const b = behBoard();
    play(b.engine, P1, b.id("beh"));
    pickDestroy(b, group);
    for (const key of group) assert.equal(zoneOf(b.engine, b.id(key)), "discard", `${key} was destroyed`);
  }
});

clause(BEHEMOTH, "0:rule", "exactly 4 must be chosen: 3 or 5 are refused (and the choice stays open), 4 is accepted", () => {
  const b = behBoard();
  play(b.engine, P1, b.id("beh"));
  refused(tryDestroy(b, ["oc0", "oc1", "oi"]), "only three chosen", /select|target|choose|requires|count/i);
  refused(tryDestroy(b, ["oc0", "oc1", "oi", "ol", "ons"]), "five chosen", /select|target|choose|requires|count/i);
  refused(tryDestroy(b, []), "none chosen", /select|target|choose|requires|count/i);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal choice");
  for (const key of OPP_NONSTAPLE) assert.equal(zoneOf(b.engine, b.id(key)), "play", "nothing was destroyed yet");
  pickDestroy(b, ["oc0", "oc1", "oi", "ol"]);
  assert.equal(b.engine.state.pendingChoice, undefined, "control: four are accepted");
});

clause(BEHEMOTH, "0:rule", "staple resources, my cards and the factions cannot be chosen", () => {
  const b = behBoard();
  play(b.engine, P1, b.id("beh"));
  refused(tryDestroy(b, ["oc0", "oc1", "oi", "staple0"]), "a staple resource", /select|target|choose|candidate|legal|valid/i);
  refused(tryDestroy(b, ["oc0", "oc1", "oi", "mc"]), "my character", /select|target|choose|candidate|legal|valid/i);
  refused(tryDestroy(b, ["oc0", "oc1", "oi", "mi"]), "my item", /select|target|choose|candidate|legal|valid/i);
  refused(
    () =>
      b.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsTarget", selected: [b.id("oc0"), b.id("oc1"), b.id("oi"), factionOf(b.engine, P2)] } } as never),
    "their own faction card is not a candidate",
    /select|target|choose|candidate|legal|valid/i
  );
  refused(tryDestroy(b, ["oc0", "oc0", "oi", "ol"]), "the same card twice", /select|target|choose|candidate|legal|valid|unique|duplicate/i);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  pickDestroy(b, ["oc0", "oc1", "oi", "ol"]);
  assert.equal(zoneOf(b.engine, b.id("staple0")), "play");
});

clause(BEHEMOTH, "0:rule", "with fewer than 4 non-staple cards they destroy all of them", () => {
  const b = behBoard({
    oppStuff: false,
    extra: [
      { key: "oc0", def: character({ name: "OppChar0" }), owner: P2, zone: "play" },
      { key: "oi", def: item({ name: "OppItem" }), owner: P2, zone: "play" },
      ...bank("greed", 2, P2).map((p, i) => ({ ...p, key: `staple${i}` }))
    ]
  });
  play(b.engine, P1, b.id("beh"));
  if (pending(b.engine)) pickDestroy(b, ["oc0", "oi"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("oc0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("oi")), "discard");
  assert.equal(zoneOf(b.engine, b.id("staple0")), "play", "staples are never destroyed");
  assert.equal(zoneOf(b.engine, b.id("staple1")), "play");
});

clause(BEHEMOTH, "0:rule", "with no non-staple card they destroy nothing and the game is not stuck", () => {
  const b = behBoard({ oppStuff: false, extra: bank("greed", 2, P2).map((p, i) => ({ ...p, key: `staple${i}` })) });
  play(b.engine, P1, b.id("beh"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("staple0")), "play");
  assert.equal(zoneOf(b.engine, b.id("beh")), "play");
});

clause(BEHEMOTH, "0:rule", "more than 4 candidates: only the 4 chosen die and the rest stay", () => {
  const b = behBoard();
  play(b.engine, P1, b.id("beh"));
  pickDestroy(b, ["oc1", "oi", "ol", "ons"]);
  assert.equal(zoneOf(b.engine, b.id("oc0")), "play");
  assert.equal(zoneOf(b.engine, b.id("fd")), "play");
});

clause(BEHEMOTH, "0:rule", "the trigger is on being DEPLOYED: put into play by an effect it destroys nothing", () => {
  const put = tactic({
    name: "PutBehemoth",
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
  const b = behBoard({ extra: [{ key: "put", def: put, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("put"), { selected: { c: [b.id("beh")] } });
  assert.equal(zoneOf(b.engine, b.id("beh")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined, "no choice for the opponent");
  for (const key of OPP_NONSTAPLE) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} untouched`);
});

clause(BEHEMOTH, "0:rule", "it is deployed, not 'enters play': the destruction happens as the Behemoth is deployed, before the opponent's responses to it resolve", () => {
  const b = behBoard();
  playRaw(b.engine, P1, b.id("beh"));
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.playerId, P2, "the opponent has to choose");
  pickDestroy(b, ["oc0", "oc1", "oi", "ol"]);
  assert.equal(zoneOf(b.engine, b.id("beh")), "play");
  assert.equal(zoneOf(b.engine, b.id("oc0")), "discard");
});

function behTry(o: { elitism?: number; zone?: "hand" | "play"; extra?: CardPlacement[]; behController?: PlayerId; spent?: number; faceDown?: boolean } = {}) {
  return behBoard({
    zone: o.zone ?? "play",
    elitism: 0,
    oppStuff: false,
    behController: o.behController,
    extra: [
      ...bankWithSpent("rage", (o.elitism ?? 3) + (o.spent ?? 0), o.spent ?? 0, P1).map((p, i) => ({ ...p, key: `rs${i}` })),
      { key: "oppRes", def: resourceCard({ name: "TheirRes" }), owner: P2, zone: "play" },
      ...(o.faceDown ? ([{ key: "fdRes", def: character({ name: "MyHidden" }), owner: P1, zone: "play", faceDown: true }] as CardPlacement[]) : []),
      ...(o.extra ?? [])
    ]
  });
}
const tryAgain = (b: BehBoard, pick: string, player: PlayerId = P1) =>
  activate(b.engine, player, b.id("beh"), "try-again", { selected: { r: [b.id(pick)] } });
const tryAgainRaw = (b: BehBoard, pick: string) =>
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("beh"), abilityId: "try-again", selected: { r: [b.id(pick)] }, variables: {} } as never);

clause(BEHEMOTH, "1:ability:try-again", "COST: Pay 2 and destroy a resource I control: with 3 resources, 2 are spent and 1 is destroyed (into my discard pile), leaving none", () => {
  const b = behTry({ elitism: 3 });
  assert.equal(readyOf(b.engine), 3);
  tryAgain(b, "rs0");
  assert.equal(zoneOf(b.engine, b.id("rs0")), "discard", "the chosen resource was destroyed");
  assert.ok(discardIds(b.engine, P1).includes(b.id("rs0")), "discardIds(b.engine, P1).includes(b.id(rs0))");
  assert.equal(readyOf(b.engine), 0, "2 were paid and 1 destroyed");
  assert.equal(attachedCount(b.engine, P1), 2, "the two payments are spent resources attached to my faction");
  assert.equal(zoneOf(b.engine, b.id("beh")), "hand");
});

clause(BEHEMOTH, "1:ability:try-again", "the cost is paid as the ability is used, before the opponent can respond; the Behemoth only leaves when it resolves", () => {
  const b = behTry({ elitism: 3 });
  tryAgainRaw(b, "rs0");
  assert.ok(b.engine.state.responseWindow, "b.engine.state.responseWindow");
  assert.equal(zoneOf(b.engine, b.id("rs0")), "discard", "the resource is already destroyed");
  assert.equal(readyOf(b.engine), 0, "the 2 are already paid");
  assert.equal(zoneOf(b.engine, b.id("beh")), "play", "the Behemoth is still in play");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("beh")), "hand");
});

clause(BEHEMOTH, "1:ability:try-again", "Pay 2 means two more resources: with only 2 resources (one would be destroyed) it is refused, nothing changes", () => {
  const b = behTry({ elitism: 2 });
  refused(() => tryAgain(b, "rs0"), "2 resources cannot both pay 2 and be destroyed");
  assert.equal(zoneOf(b.engine, b.id("beh")), "play");
  assert.equal(zoneOf(b.engine, b.id("rs0")), "play");
  assert.equal(readyOf(b.engine), 2);
  const one = behTry({ elitism: 1 });
  refused(() => tryAgain(one, "rs0"), "1 resource");
  assert.equal(zoneOf(one.engine, one.id("beh")), "play");
});

clause(BEHEMOTH, "1:ability:try-again", "the destroyed resource may be one that is already spent: then only the 2 payments come from ready resources", () => {
  const b = behTry({ elitism: 2, spent: 1 });
  assert.equal(readyOf(b.engine), 2, "2 ready and 1 spent");
  tryAgain(b, "rs0");
  assert.equal(zoneOf(b.engine, b.id("rs0")), "discard", "the spent resource was destroyed");
  assert.equal(readyOf(b.engine), 0, "the two ready resources paid");
  assert.equal(zoneOf(b.engine, b.id("beh")), "hand");
});

clause(BEHEMOTH, "1:ability:try-again", "a face-down card is a resource I control and can be the one destroyed", () => {
  const b = behTry({ elitism: 2, faceDown: true });
  tryAgain(b, "fdRes");
  assert.equal(zoneOf(b.engine, b.id("fdRes")), "discard");
  assert.equal(zoneOf(b.engine, b.id("beh")), "hand");
});

clause(BEHEMOTH, "1:ability:try-again", "the destroyed card must be a resource I control: an opponent's resource, a character, an item, or no pick are refused", () => {
  const b = behTry({ elitism: 4 });
  refused(() => tryAgain(b, "oppRes"), "the opponent's resource");
  refused(() => tryAgain(b, "mc"), "a character");
  refused(() => tryAgain(b, "mi"), "an item");
  refused(() => activate(b.engine, P1, b.id("beh"), "try-again", { selected: { r: [] } }), "no pick");
  refused(() => activate(b.engine, P1, b.id("beh"), "try-again", { selected: { r: [b.id("rs0"), b.id("rs1")] } }), "two resources");
  assert.equal(zoneOf(b.engine, b.id("beh")), "play");
  assert.equal(readyOf(b.engine), 4, "nothing was paid by the refused attempts");
  tryAgain(b, "rs0");
  assert.equal(zoneOf(b.engine, b.id("beh")), "hand", "control: my own resource works");
});

clause(BEHEMOTH, "1:ability:try-again", "EFFECT: the Behemoth goes to its OWNER's hand: used by the player who controls it but does not own it, it goes to the other player's hand", () => {
  const b = duo(
    [
      { key: "theirBeh", def: printing(BEHEMOTH), owner: P1, controller: P2, zone: "play" },
      ...bank("rage", 3, P2).map((p, i) => ({ ...p, key: `p2r${i}` })),
      ...fillers("d1", 3, P1, "deck"),
      ...fillers("d2", 3, P2, "deck")
    ],
    { turn: 2, active: P2 }
  );
  const ownerHand = handIds(b.engine, P1).length;
  const controllerHand = handIds(b.engine, P2).length;
  activate(b.engine, P2, b.id("theirBeh"), "try-again", { selected: { r: [b.id("p2r0")] } });
  assert.equal(zoneOf(b.engine, b.id("theirBeh")), "hand");
  assert.ok(handIds(b.engine, P1).includes(b.id("theirBeh")), "in its owner's hand");
  assert.equal(handIds(b.engine, P1).length, ownerHand + 1);
  assert.equal(handIds(b.engine, P2).includes(b.id("theirBeh")), false, "not in its controller's hand");
  assert.equal(handIds(b.engine, P2).length, controllerHand);
  assert.equal(zoneOf(b.engine, b.id("p2r0")), "discard", "its controller paid: their resource was destroyed");
});

clause(BEHEMOTH, "1:ability:try-again", "no hidden cost: usable the turn it is deployed and while depleted", () => {
  const b = behTry({ elitism: 3 });
  b.engine.state.cards[b.id("beh")].depleted = true;
  tryAgain(b, "rs0");
  assert.equal(zoneOf(b.engine, b.id("beh")), "hand");
});

clause(BEHEMOTH, "1:ability:try-again", "only from play and only by its controller", () => {
  const hand = behTry({ elitism: 3, zone: "hand" });
  refused(() => tryAgain(hand, "rs0"), "from my hand");
  assert.equal(readyOf(hand.engine), 3);
  const b = behTry({ elitism: 3, extra: [...bank("rage", 3, P2).map((p, i): CardPlacement => ({ ...p, key: `os${i}` })), { key: "atk", def: character({ name: "Attacker" }), owner: P1, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P1, [b.id("atk")]);
  refused(
    () => b.engine.perform({ type: "activateAbility", playerId: P2, cardId: b.id("beh"), abilityId: "try-again", selected: { r: [b.id("os0")] }, variables: {} } as never),
    "the opponent does not control the Behemoth"
  );
  assert.equal(zoneOf(b.engine, b.id("beh")), "play");
});

// =====================================================================================
// Master General -- character, warlord, soldier, cost 2, threshold [R][R], 2 strength / 3 speed / 2 life
// When a player deploys a tactic, inflict 3 damage to that player's faction.
// =====================================================================================

const GENERAL = "ffee58bd-4f4b-4742-b601-0d6e84566a2c";

function genBoard(o: { general?: "play" | "hand"; generalController?: PlayerId; active?: PlayerId; develop?: boolean; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return (o.develop ? duo : quietDuo)(
    [
      { key: "gen", def: printing(GENERAL), owner: P1, controller: o.generalController, zone: o.general ?? "play" },
      { key: "t1", def: noopTactic("MyTactic1"), owner: P1, zone: "hand" },
      { key: "t2", def: noopTactic("MyTactic2"), owner: P1, zone: "hand" },
      { key: "ot1", def: noopTactic("OppTactic1"), owner: P2, zone: "hand" },
      { key: "ot2", def: noopTactic("OppTactic2"), owner: P2, zone: "hand" },
      { key: "ch", def: character({ name: "Walker", cost: 0 }), owner: P1, zone: "hand" },
      { key: "gear", def: item({ name: "Gear", cost: 0 }), owner: P1, zone: "hand" },
      { key: "spot", def: location({ name: "Spot", cost: 0 }), owner: P1, zone: "hand" },
      { key: "res", def: resourceCard({ name: "HandRes" }), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker" }), owner: P2, zone: "play" },
      { key: "och", def: character({ name: "OppWalker", cost: 0 }), owner: P2, zone: "hand" },
      { key: "ogear", def: item({ name: "OppGear", cost: 0 }), owner: P2, zone: "hand" },
      { key: "ospot", def: location({ name: "OppSpot", cost: 0 }), owner: P2, zone: "hand" },
      ...fillers("md", 4, P1, "deck"),
      ...(o.extra ?? [])
    ],
    { turn: active === P1 ? 1 : 2, active }
  );
}

clause(GENERAL, "0:rule", "the printed card: a 2-cost [R][R] warlord soldier with 2 strength, 3 speed and 2 life", () => {
  basicDeploy(GENERAL, { cost: 2, icon: "rage", icons: 2, type: "character", stats: [2, 3, 2], subtypes: ["soldier"] });
  const b = genBoard();
  assert.equal(b.engine.getDefinition(b.id("gen")).trade, "warlord");
});

clause(GENERAL, "0:rule", "when I deploy a tactic, 3 damage is inflicted to MY faction (and not to the opponent's)", () => {
  const b = genBoard();
  const [mine, theirs] = [infl(b.engine, P1), infl(b.engine, P2)];
  play(b.engine, P1, b.id("t1"));
  assert.equal(infl(b.engine, P1), mine - 3);
  assert.equal(infl(b.engine, P2), theirs);
});

clause(GENERAL, "0:rule", "when the opponent deploys a tactic, 3 damage is inflicted to THEIR faction (and not to mine)", () => {
  const b = genBoard({ active: P2 });
  const [mine, theirs] = [infl(b.engine, P1), infl(b.engine, P2)];
  play(b.engine, P2, b.id("ot1"));
  assert.equal(infl(b.engine, P2), theirs - 3);
  assert.equal(infl(b.engine, P1), mine);
  const response = genBoard();
  const [m2, t2] = [infl(response.engine, P1), infl(response.engine, P2)];
  castRaw(response.engine, P1, response.id("t1"));
  castRaw(response.engine, P2, response.id("ot1"));
  resolvePendingResponses(response.engine);
  assert.equal(infl(response.engine, P1), m2 - 3, "my tactic hurt me");
  assert.equal(infl(response.engine, P2), t2 - 3, "their response tactic hurt them");
});

clause(GENERAL, "0:rule", "every tactic deployed hurts its player: two tactics are 6 damage", () => {
  const b = genBoard();
  const mine = infl(b.engine, P1);
  play(b.engine, P1, b.id("t1"));
  play(b.engine, P1, b.id("t2"));
  assert.equal(infl(b.engine, P1), mine - 6);
});

clause(GENERAL, "0:rule", "only tactics: deploying a character, an item or a location, or playing a resource, hurts nobody", () => {
  for (const what of ["ch", "gear", "spot"]) {
    const b = genBoard();
    const before = [infl(b.engine, P1), infl(b.engine, P2)];
    play(b.engine, P1, b.id(what));
    assert.equal(zoneOf(b.engine, b.id(what)), "play", `${what} was deployed`);
    assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], before, `${what}: no damage`);
  }
  const res = genBoard({ develop: true });
  const before = [infl(res.engine, P1), infl(res.engine, P2)];
  developResource(res.engine, P1, res.id("res"), false);
  assert.deepEqual([infl(res.engine, P1), infl(res.engine, P2)], before, "a resource play: no damage");
});

clause(GENERAL, "0:rule", "the opponent deploying a character, an item or a location is not a tactic: they take no damage", () => {
  for (const what of ["och", "ogear", "ospot"]) {
    const b = genBoard({ active: P2 });
    const before = [infl(b.engine, P1), infl(b.engine, P2)];
    play(b.engine, P2, b.id(what));
    assert.equal(zoneOf(b.engine, b.id(what)), "play", `${what} was deployed`);
    assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], before, `${what}: no damage to either faction`);
  }
});

clause(GENERAL, "0:rule", "the General must be in play: from my hand it does nothing", () => {
  const b = genBoard({ general: "hand" });
  const mine = infl(b.engine, P1);
  play(b.engine, P1, b.id("t1"));
  assert.equal(infl(b.engine, P1), mine);
});

clause(GENERAL, "0:rule", "'a player': a General the opponent controls hurts me when I deploy a tactic, and hurts them when they do", () => {
  const b = genBoard({ generalController: P2 });
  const [mine, theirs] = [infl(b.engine, P1), infl(b.engine, P2)];
  play(b.engine, P1, b.id("t1"));
  assert.equal(infl(b.engine, P1), mine - 3);
  assert.equal(infl(b.engine, P2), theirs);
});

clause(GENERAL, "0:rule", "two Master Generals both trigger: one tactic is 6 damage to its player", () => {
  const b = genBoard({ extra: [{ key: "gen2", def: printing(GENERAL), owner: P1, zone: "play" }] });
  const mine = infl(b.engine, P1);
  castRaw(b.engine, P1, b.id("t1"));
  drain(b.engine, declineAll);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(infl(b.engine, P1), mine - 6, "3 damage for each General");
});

clause(GENERAL, "0:rule", "the damage is dealt on deploy, not on resolution: a terminated or answered tactic still costs its player 3", () => {
  const b = genBoard();
  const mine = infl(b.engine, P1);
  playRaw(b.engine, P1, b.id("t1"));
  castRaw(b.engine, P2, b.id("ot1"));
  resolvePendingResponses(b.engine);
  assert.equal(infl(b.engine, P1), mine - 3);
});

// =====================================================================================
// Mauville -- location, banker, cost 2, threshold [G], 4 structure
// At the start of your turn, you may pick a non-resource card you control. If you do, void that card. At the end of
// your turn, put the voided card into play under your control.
// =====================================================================================

const MAUVILLE = "25e42486-e49e-4acc-a4a9-d16a1652492f";

const etbChar = (name: string): CardDefinition =>
  character({
    name,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -2 }] }] }
  } as Partial<CardDefinition>);

function mauBoard(o: { mau?: "play" | "hand" | "discard"; extra?: CardPlacement[] } = {}) {
  return quietDuo(
    [
      { key: "m", def: printing(MAUVILLE), owner: P1, zone: o.mau ?? "play" },
      { key: "c", def: character({ name: "Walker", life: 5 }), owner: P1, zone: "play", damage: 2, depleted: true },
      { key: "c2", def: character({ name: "Bystander" }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "spot", def: location({ name: "Spot" }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" },
      { key: "res", def: resourceCard({ name: "StapleRes" }), owner: P1, zone: "play" },
      { key: "fd", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      { key: "foeGear", def: item({ name: "FoeGear" }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDisc", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...fillers("d1", 6, P1, "deck"),
      ...fillers("d2", 6, P2, "deck"),
      ...(o.extra ?? [])
    ],
    { turn: 2, active: P2 }
  );
}
type MauBoard = ReturnType<typeof mauBoard>;
/** The opponent ends their turn: my turn starts, and Mauville's prompt (if any) is left pending. */
const startMyTurn = (b: MauBoard) => endTurn(b.engine, P2);
const mauPick = (b: MauBoard, key: string) => answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id(key)] });
const mauCandidates = (b: MauBoard): string[] => {
  const pc = pending(b.engine) as unknown as { declaration: { selector: unknown }; context: unknown };
  return (b.engine as unknown as { targetCandidates(selector: unknown, context: unknown, player: string): Array<{ id: string }> })
    .targetCandidates(pc.declaration.selector, pc.context, P1)
    .map((card) => card.id);
};

clause(MAUVILLE, "0:rule", "the printed card: a banker location with cost 2, threshold [G] and 4 structure; deploys for exactly that", () => {
  basicDeploy(MAUVILLE, { cost: 2, icon: "greed", icons: 1, type: "location", structure: 4 });
  const b = mauBoard();
  assert.equal(b.engine.getDefinition(b.id("m")).trade, "banker");
});

clause(MAUVILLE, "0:rule", "at the start of my turn I am offered an optional pick (I choose)", () => {
  const b = mauBoard();
  startMyTurn(b);
  assert.equal(b.engine.state.activePlayerId, P1);
  const pc = pending(b.engine);
  assert.ok(pc, "a prompt is open at the start of my turn");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
});

clause(MAUVILLE, "0:rule", "the candidates are exactly my non-resource cards in play: characters, items, locations (Mauville included) -- not resources, face-down cards, the factions, the opponent's cards, or cards in other zones", () => {
  const b = mauBoard();
  startMyTurn(b);
  sameIds(mauCandidates(b), [b.id("m"), b.id("c"), b.id("c2"), b.id("gear"), b.id("spot"), b.id("stolen")]);
});

clause(MAUVILLE, "0:rule", "'you may': I can pick nothing, and then nothing is voided and nothing returns", () => {
  const b = mauBoard();
  startMyTurn(b);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const key of ["c", "c2", "gear", "spot", "stolen", "m"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} stays`);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  for (const key of ["c", "c2", "gear", "spot", "stolen", "m"]) assert.equal(zoneOf(b.engine, b.id(key)), "play");
});

clause(MAUVILLE, "0:rule", "a pick that is not a legal candidate (a resource, a face-down card, the opponent's card, a card in hand or in a discard pile) is refused", () => {
  const b = mauBoard();
  startMyTurn(b);
  for (const bad of ["res", "fd", "foe", "foeGear", "inHand", "inDisc"]) {
    refused(
      () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id(bad)] } } as never),
      `${bad} is not a non-resource card I control in play`,
      /select|target|choose|candidate|legal|valid/i
    );
  }
  refused(
    () => b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [b.id("c"), b.id("c2")] } } as never),
    "only one card",
    /select|target|choose|candidate|legal|valid|count/i
  );
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the prompt stays open");
  mauPick(b, "c");
  assert.equal(zoneOf(b.engine, b.id("c")), "void", "control: a legal pick works");
});

clause(MAUVILLE, "0:rule", "If I do, the picked card is voided at once: it is in the Void (not the discard pile or my hand) for the rest of my turn", () => {
  const b = mauBoard();
  startMyTurn(b);
  mauPick(b, "c");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c")), "void");
  assert.equal(discardIds(b.engine, P1).includes(b.id("c")), false);
  assert.equal(handIds(b.engine, P1).includes(b.id("c")), false);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play", "nothing else is voided");
  play(b.engine, P1, b.id("inHand")); // the turn goes on; the voided card is still away
  assert.equal(zoneOf(b.engine, b.id("c")), "void", "still voided later in my turn");
});

clause(MAUVILLE, "0:rule", "At the end of my turn the voided card is put into play under my control: for a character, an item and a location alike", () => {
  for (const key of ["c", "gear", "spot"]) {
    const b = mauBoard();
    startMyTurn(b);
    mauPick(b, key);
    assert.equal(zoneOf(b.engine, b.id(key)), "void");
    endTurn(b.engine, P1);
    assert.equal(b.engine.state.activePlayerId, P2);
    assert.equal(zoneOf(b.engine, b.id(key)), "play", `${key} is back in play at the end of my turn`);
    assert.equal(controllerOf2(b.engine, b.id(key)), P1, "under my control");
  }
});

clause(MAUVILLE, "0:rule", "the returned card is a fresh arrival: its damage is gone and it is no longer depleted", () => {
  const b = mauBoard();
  assert.equal(b.engine.state.cards[b.id("c")].damage, 2);
  startMyTurn(b);
  mauPick(b, "c");
  endTurn(b.engine, P1);
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(b.engine.state.cards[b.id("c")].damage, 0, "damage did not come back");
  assert.equal(b.engine.state.cards[b.id("c")].depleted, false, "and it is not depleted");
});

clause(MAUVILLE, "0:rule", "the card really enters play again at the end of my turn: its 'enters play' trigger happens", () => {
  const b = mauBoard({ extra: [{ key: "etb", def: etbChar("Arriver"), owner: P1, zone: "play" }] });
  startMyTurn(b);
  const theirs = infl(b.engine, P2);
  mauPick(b, "etb");
  assert.equal(infl(b.engine, P2), theirs, "voiding it triggers nothing");
  endTurn(b.engine, P1);
  assert.equal(zoneOf(b.engine, b.id("etb")), "play");
  assert.equal(infl(b.engine, P2), theirs - 2, "its enters-play trigger fired when it came back");
});

clause(MAUVILLE, "0:rule", "a card I control but the opponent owns is voided and comes back under MY control", () => {
  const b = mauBoard();
  startMyTurn(b);
  mauPick(b, "stolen");
  assert.equal(zoneOf(b.engine, b.id("stolen")), "void");
  endTurn(b.engine, P1);
  assert.equal(zoneOf(b.engine, b.id("stolen")), "play");
  assert.equal(controllerOf2(b.engine, b.id("stolen")), P1);
});

clause(MAUVILLE, "0:rule", "Mauville may pick itself: it is voided and put back into play at the end of my turn", () => {
  const b = mauBoard();
  startMyTurn(b);
  mauPick(b, "m");
  assert.equal(zoneOf(b.engine, b.id("m")), "void");
  endTurn(b.engine, P1);
  assert.equal(zoneOf(b.engine, b.id("m")), "play", "back at the end of my turn");
  assert.equal(controllerOf2(b.engine, b.id("m")), P1);
});

clause(MAUVILLE, "0:rule", "only at the start of MY turn: no prompt at the start of the opponent's turn", () => {
  const b = mauBoard();
  startMyTurn(b);
  mauPick(b, "c");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.pendingChoice, undefined, "no prompt at their turn start");
});

clause(MAUVILLE, "0:rule", "'your turn' is its controller's turn: a Mauville I own but the opponent controls offers the pick to THEM at their turn start, and not to me at mine", () => {
  const b = quietDuo(
    [
      { key: "m", def: printing(MAUVILLE), owner: P1, controller: P2, zone: "play" },
      { key: "theirs", def: character({ name: "TheirChar" }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      ...fillers("d1", 4, P1, "deck"),
      ...fillers("d2", 4, P2, "deck")
    ],
    { turn: 1, active: P1 }
  );
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine);
  assert.ok(pc, "the controller's turn started: a prompt");
  assert.equal(pc.playerId, P2, "the controller chooses");
  answerPending(b.engine, "chooserSelectsTarget", { selected: [b.id("theirs")] });
  assert.equal(zoneOf(b.engine, b.id("theirs")), "void");
  endTurn(b.engine, P2);
  assert.equal(zoneOf(b.engine, b.id("theirs")), "play");
  assert.equal(controllerOf2(b.engine, b.id("theirs")), P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.pendingChoice, undefined, "no prompt for me at my turn start: I do not control it");
});

clause(MAUVILLE, "0:rule", "it triggers at the start of every one of my turns", () => {
  const b = mauBoard();
  startMyTurn(b);
  mauPick(b, "c");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "offered again on my next turn");
  mauPick(b, "c2");
  assert.equal(zoneOf(b.engine, b.id("c2")), "void");
  endTurn(b.engine, P1);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
});

clause(MAUVILLE, "0:rule", "Mauville must be in play: from my hand or discard pile nothing is offered", () => {
  for (const zone of ["hand", "discard"] as const) {
    const b = mauBoard({ mau: zone });
    startMyTurn(b);
    assert.equal(b.engine.state.activePlayerId, P1);
    assert.equal(b.engine.state.pendingChoice, undefined, `with Mauville in my ${zone} there is no prompt`);
  }
});

}

{
// =====================================================================================
// Printed stats of the two UNIQUE rogues (the carried-over blocks above check their abilities)
//   Iohane, the Convex: rogue, cost 1, [D][D][D], 2 strength / 4 speed / 2 life, subtypes iohane + sword of great justice
//   Ipsighast, the Lustful: rogue, cost 3, [D][D][D], 3 strength / 4 speed / 3 life, subtypes ipsighast + demon knight
// =====================================================================================

const IOHANE_CARD = "026e82f8-c90c-4646-a87b-0c53020f2272";
const IPSIGHAST_CARD = "2a7f9474-5265-4804-865f-f4c3b63b6651";

clause(IOHANE_CARD, "0:unique", "the printed card: a rogue with cost 1, threshold [D][D][D], 2 strength, 4 speed and 2 life: exact payment spends 1, a missing [D] is refused", () => {
  basicDeploy(IOHANE_CARD, { cost: 1, icon: "deception", icons: 3, type: "character", stats: [2, 4, 2], subtypes: ["iohane", "sword of great justice"] });
});

clause(IPSIGHAST_CARD, "0:unique", "the printed card: a rogue with cost 3, threshold [D][D][D], 3 strength, 4 speed and 3 life: exact payment spends 3, a missing [D] is refused", () => {
  basicDeploy(IPSIGHAST_CARD, { cost: 3, icon: "deception", icons: 3, type: "character", stats: [3, 4, 3], subtypes: ["ipsighast", "demon knight"] });
});

}

