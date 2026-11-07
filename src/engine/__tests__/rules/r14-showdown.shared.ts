// Shared synthetic fixtures and drivers for the r14-showdown batch (docs/rules/showdown-rules.md). Not a test file.
//
// The rules suite uses synthetic factions only: `evilFaction` / `sharedFaction` are authored with the engine's
// Showdown vocabulary (`influencePerOpponent`, `countPerOpponent`, `develop.usesPerOpponent`, `daringGambit`,
// `meetsAllThresholds`, `usableBy: "heroes"`, `claimHeroCards`, `heroDeckToTemptationPile`, `revealAllegiances`,
// PlayerRef "villain", selector `controller: "otherHero"` / `showdownPile`) to stand in for The Evil Alliance and
// the Slightly Less Evil Alliance. Nothing here reads data/cards.json.

import assert from "node:assert/strict";
import type {
  AbilityDefinition,
  ActivatedAbility,
  CardDefinition,
  CardInstanceId,
  FactionDefinition,
  GameFormat,
  PlayerId,
  SpoilsEngine
} from "../../../engine.js";
import { createFactionGame } from "../../../engine.js";
import { character, defaultFactionDefinition, factionCard, resolvePendingResponses, resourceCard } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

export const RAGE = resourceCard({ name: "Rage", resource: { provides: ["rage"], staple: true } });
/** A resource that is not a staple: "any staple resources" never takes it. */
export const BILE = resourceCard({ name: "Bile", resource: { provides: ["deception"], staple: true } });
export const FANCY = resourceCard({ name: "Fancy", resource: { provides: ["greed"], staple: false } });
export const FILLER = character({ name: "Filler", life: 2 });

type Abilities = ActivatedAbility[];

/** The Evil Alliance's three activated abilities (SD-EA 7-9). */
export function evilAbilities(): Abilities {
  return [
    { id: "draw", name: "DRAW", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "draw", player: "controller", amount: 1 }] },
    { id: "resource", name: "RESOURCE", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "playResource" }] },
    {
      id: "enticement",
      name: "ENTICEMENT",
      type: "activated",
      condition: { type: "isActivePlayer" },
      usesPerTurn: 1,
      costs: [],
      effects: [
        { type: "draw", player: "controller", amount: { type: "add", values: [{ type: "opponentCountAtStart" }, -1] } },
        { type: "playResource" },
        { type: "heroDeckToTemptationPile" }
      ]
    }
  ];
}

/** A synthetic Evil Alliance: every Showdown rule on its faction card, overridable per test. */
export function evilFaction(overrides: Partial<FactionDefinition> = {}): CardDefinition {
  const base = defaultFactionDefinition({
    startingInfluence: 15,
    setup: {
      startingResources: { count: 1, countPerOpponent: 1, stapleOnly: true },
      openingHand: { goingFirst: 7, goingSecond: 8 }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }], usesPerOpponent: true }
    }
  });
  return factionCard({
    name: "Evil",
    faction: {
      ...base,
      showdownRole: "villain",
      influencePerOpponent: 10,
      meetsAllThresholds: true,
      daringGambit: { damage: 7 },
      abilities: evilAbilities(),
      ...overrides
    }
  });
}

/** A plain Hero faction: its own influence, no opening hand, no starting resources. */
export function heroFaction(overrides: Partial<FactionDefinition> = {}): CardDefinition {
  return factionCard({
    name: "Hero Faction",
    faction: defaultFactionDefinition({
      startingInfluence: 20,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
      ...overrides
    })
  });
}

/** "A character another Hero controls" / "a card in the Temptation Pile" / "a player other than you" pickers. */
const ANOTHER_HERO_CHARACTER = { id: "c", selector: { type: "character", controller: "otherHero" }, count: 1 } as const;
const PILE_CARD = { id: "p", selector: { zone: "table", showdownPile: "temptationPile" }, count: 1 } as const;

/** The Slightly Less Evil Alliance (SD-SLE 1-5) as a shared faction card. */
export function sharedFaction(): CardDefinition {
  const abilities: Abilities = [
    {
      id: "give-in",
      name: "GIVE IN TO TEMPTATION",
      type: "activated",
      usableBy: "heroes",
      condition: { type: "isActivePlayer" },
      usesPerTurn: 1,
      costs: [{ type: "payResources", amount: 2 }],
      targets: [ANOTHER_HERO_CHARACTER, PILE_CARD],
      effects: [
        { type: "takeControl", target: { type: "selected", id: "c" }, controller: "villain" },
        { type: "claimHeroCards", claimer: "controller", from: "selected", selected: "p" }
      ]
    },
    {
      id: "spring",
      name: "SPRING FORTH MY BURLY PROTECTOR!",
      type: "activated",
      usableBy: "heroes",
      costs: [{ type: "payResources", amount: 6 }],
      effects: [{ type: "claimHeroCards", claimer: "controller", from: "heroDeckTop" }]
    },
    {
      id: "teamwork",
      name: "TEAMWORK",
      type: "activated",
      usableBy: "heroes",
      costs: [{ type: "payResources", amount: 2 }],
      targets: [
        { id: "mine", selector: { controller: "self" }, count: 1 },
        {
          id: "who",
          selector: {
            type: "faction",
            controller: "any",
            conditions: [{ type: "not", condition: { type: "targetControlledBy", player: "controller" } }]
          },
          count: 1
        }
      ],
      effects: [
        { type: "takeControl", target: { type: "selected", id: "mine" }, controller: { type: "ownerOf", target: { type: "selected", id: "who" } } }
      ]
    }
  ];
  const trueColors: AbilityDefinition = {
    id: "true-colors",
    name: "YOUR TRUE COLORS ARE REVEALED",
    type: "triggered",
    event: "turnStarted",
    condition: { type: "eventPlayerIs", player: "villain" },
    effects: [
      { type: "addCounter", target: "source", counter: "token", amount: 1 },
      {
        type: "if",
        condition: { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 7 },
        effects: [{ type: "revealAllegiances" }]
      }
    ]
  };
  return factionCard({
    name: "Shared Justice",
    faction: { ...defaultFactionDefinition(), showdownRole: "heroes", abilities },
    behavior: { abilities: [trueColors] }
  });
}

/**
 * Empties the Hero Deck the way play would — its cards gone from the table (claimed, or otherwise used up): a
 * Showdown game starts with one (SD 3), so "the Hero Deck is empty" is a state reached in play.
 */
export function exhaustHeroDeck(engine: SpoilsEngine): void {
  const showdown = engine.state.showdown!;
  const move = (engine as unknown as { moveCard(id: string, zone: "removed"): void }).moveCard.bind(engine);
  for (const id of showdown.heroDeck) move(id, "removed");
  showdown.heroDeck = [];
}

/** A keyed bag of the synthetic definitions a test table is built from. */
export interface TableOptions {
  /** Hero seats h1..hN (default 2). */
  heroes?: number;
  /** Cards of the shared Hero Deck (default one champion). */
  heroDeck?: CardDefinition[];
  /** Allegiance cards to deal (default: all loyal to the Heroes, one spare). */
  allegiance?: Array<"heroes" | "villain">;
  villainFaction?: CardDefinition;
  /** Each Hero's own faction (default: one plain Hero faction for all). */
  heroFactions?: CardDefinition[];
  /** Extra definitions every deck draws from. */
  extra?: CardDefinition[];
  /** Cards (beyond the filler) added to every player's deck, top first. */
  deckExtras?: CardDefinition[];
  /** Per-seat deck extras (override `deckExtras`), top first: "v", "h1", ... */
  seatExtras?: Record<PlayerId, CardDefinition[]>;
  shared?: CardDefinition | null;
  first?: PlayerId;
  seed?: number;
  /** Number of Rage in each deck (default 12). */
  rage?: number;
  /** Leave the turn start unsettled (no Develop Rule answered). */
  unsettled?: boolean;
  /** Let each player choose their staple starting resources (the `chooseStartingResources` setup phase). */
  chooseStartingResources?: boolean;
}

export const CHAMPION = character({ name: "Champion", strength: 4, life: 4 });

export interface Table {
  engine: SpoilsEngine;
  villain: PlayerId;
  heroes: PlayerId[];
  shared: CardInstanceId;
  defs: { villain: CardDefinition; heroes: CardDefinition[]; shared: CardDefinition | undefined };
}

/** A Showdown game (Villain "v", Heroes "h1".."hN") built through the real setup path. */
export function table(options: TableOptions = {}): Table {
  const heroCount = options.heroes ?? 2;
  const heroIds = Array.from({ length: heroCount }, (_, i) => `h${i + 1}`);
  const villainFaction = options.villainFaction ?? evilFaction();
  const heroFactions = options.heroFactions ?? [heroFaction()];
  const sharedDef = options.shared === null ? undefined : (options.shared ?? sharedFaction());
  const heroDeck = options.heroDeck ?? [CHAMPION];
  const extras = options.deckExtras ?? [];
  const deckFor = (seat: PlayerId): string[] => [
    ...(options.seatExtras?.[seat] ?? extras).map(card => card.id),
    ...Array.from({ length: options.rage ?? 12 }, () => RAGE.id),
    ...Array.from({ length: 30 }, () => FILLER.id)
  ];
  const defs: CardDefinition[] = [
    RAGE,
    BILE,
    FANCY,
    FILLER,
    villainFaction,
    ...heroFactions,
    ...(sharedDef ? [sharedDef] : []),
    ...heroDeck,
    ...extras,
    ...Object.values(options.seatExtras ?? {}).flat(),
    ...(options.extra ?? [])
  ];
  const format: GameFormat = {
    kind: "showdown",
    villainId: "v",
    ...(options.allegiance ? { allegiance: { cards: options.allegiance } } : {})
  };
  const engine = createFactionGame(
    defs,
    [
      { id: "v", name: "Villain", factionDefinitionId: villainFaction.id, deckDefinitionIds: deckFor("v") },
      ...heroIds.map((id, i) => ({
        id,
        name: id,
        factionDefinitionId: heroFactions[i % heroFactions.length].id,
        deckDefinitionIds: deckFor(id)
      }))
    ],
    {
      firstPlayerId: options.first ?? "h1",
      seed: options.seed ?? 5,
      format,
      ...(options.chooseStartingResources ? { chooseStartingResources: true } : {}),
      showdown: { heroDeck: heroDeck.map(card => card.id), ...(sharedDef ? { sharedFactionDefinitionId: sharedDef.id } : {}) }
    }
  );
  if (!options.unsettled) settleTurnStart(engine);
  return {
    engine,
    villain: "v",
    heroes: heroIds,
    shared: engine.state.showdown!.sharedFactionId ?? "",
    defs: { villain: villainFaction, heroes: heroFactions, shared: sharedDef }
  };
}

type Internals = {
  putCardIntoPlay(id: string, controller: string, faceDown: boolean, ctx: unknown): void;
};

/** Puts the first card of `def` still in `playerId`'s deck into play under them, ready to attack. */
export function place(engine: SpoilsEngine, playerId: PlayerId, def: CardDefinition): CardInstanceId {
  const card = Object.values(engine.state.cards).find(c => c.ownerId === playerId && c.definitionId === def.id && c.zone === "deck");
  assert.ok(card, `${playerId} has a ${def.name} in their deck`);
  (engine as unknown as Internals).putCardIntoPlay(card.id, playerId, false, { sourceId: card.id, controllerId: playerId, selected: {} });
  resolvePendingResponses(engine);
  engine.state.cards[card.id].attackEligibleTurn = engine.state.turn;
  return card.id;
}

/** Moves `count` cards of `def` from `playerId`'s deck to their hand. */
export function toHand(engine: SpoilsEngine, playerId: PlayerId, def: CardDefinition, count = 1): CardInstanceId[] {
  const picked = Object.values(engine.state.cards)
    .filter(c => c.ownerId === playerId && c.definitionId === def.id && c.zone === "deck")
    .slice(0, count);
  assert.equal(picked.length, count, `${playerId} has ${count} ${def.name} in their deck`);
  const player = engine.state.players[playerId];
  for (const card of picked) {
    player.deck = player.deck.filter(id => id !== card.id);
    player.hand.push(card.id);
    card.zone = "hand";
  }
  return picked.map(c => c.id);
}

/** The cards of `def` that `playerId` currently has in play (face-up, any controller). */
export function inPlay(engine: SpoilsEngine, def: CardDefinition): CardInstanceId[] {
  return Object.values(engine.state.cards)
    .filter(c => c.definitionId === def.id && c.zone === "play")
    .map(c => c.id);
}

/** Uses `abilityId` of `cardId` as `playerId` and lets the responses close. */
export function use(
  engine: SpoilsEngine,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  selected?: Record<string, CardInstanceId[]>,
  opponentId?: PlayerId
): void {
  engine.perform({
    type: "activateAbility",
    playerId,
    cardId,
    abilityId,
    ...(selected ? { selected } : {}),
    ...(opponentId ? { opponentId } : {})
  });
  resolvePendingResponses(engine);
}

/** Ends the active player's turn (everyone passes) and settles the next turn's start. */
export function passTurn(engine: SpoilsEngine): void {
  engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
  while (engine.state.responseWindow && !engine.state.pendingChoice) {
    const window = engine.state.responseWindow;
    if (window.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
  if (!engine.state.result) settleTurnStart(engine);
}

/** Ends the active player's turn (everyone passes) and stops at the new turn's start-of-turn prompts, unanswered. */
export function passTurnUnsettled(engine: SpoilsEngine): void {
  engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
  while (engine.state.responseWindow && !engine.state.pendingChoice) {
    const window = engine.state.responseWindow;
    if (window.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
}

/** Answers the prompts of a resource play (which card, face-up or face-down) until none is pending: the first resource card in hand, face-up. */
export function finishResourcePlay(engine: SpoilsEngine): void {
  for (let guard = 0; engine.state.pendingChoice && guard < 6; guard++) {
    const pending = engine.state.pendingChoice;
    if (pending.kind === "chooserSelectsTarget") {
      const resource = engine.state.players[pending.playerId].hand.find(id => engine.getDefinition(id).type === "resource");
      assert.ok(resource, "a resource card in hand to play");
      engine.perform({
        type: "resolvePendingChoice",
        playerId: pending.playerId,
        choice: { kind: "chooserSelectsTarget", selected: [resource], faceDown: false }
      });
    } else if (pending.kind === "playResource") {
      engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "playResource", faceDown: false } });
    } else {
      throw new Error(`finishResourcePlay: unexpected ${pending.kind} prompt`);
    }
    resolvePendingResponses(engine);
  }
}

/** Passes turns until it is `playerId`'s turn. */
export function passTurnsTo(engine: SpoilsEngine, playerId: PlayerId): void {
  for (let guard = 0; engine.state.activePlayerId !== playerId; guard++) {
    assert.ok(guard < 12, `it becomes ${playerId}'s turn`);
    passTurn(engine);
  }
}

/** Gives `playerId` `count` unattached Rage in play (resources to pay with). */
export function giveResources(engine: SpoilsEngine, playerId: PlayerId, count: number): void {
  const have = engine.state.players[playerId].play.filter(id => engine.getDefinition(id).type === "resource").length;
  for (let i = have; i < count; i++) place(engine, playerId, RAGE);
}

/** The ids of `playerId`'s in-play resources. */
export function resourcesOf(engine: SpoilsEngine, playerId: PlayerId): CardInstanceId[] {
  return engine.state.players[playerId].play.filter(id => engine.getDefinition(id).type === "resource");
}

export const influenceOf = (engine: SpoilsEngine, id: PlayerId): number => engine.state.players[id].influence;
export const zoneOf = (engine: SpoilsEngine, id: CardInstanceId) => engine.state.cards[id].zone;
