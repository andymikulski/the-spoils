// Seeded random legal Constructed decks and complete game-setup inputs, built from the real
// catalog (the public `data` export) and checked with the engine's own deck rules.
//
// A deck is a faction card plus a list of `[definitionId, copies]` pairs. Only printings whose
// CARD_FIDELITY is "full" are used. The pool is narrowed to two (sometimes more) resource icons so
// that a random deck can actually cast its cards; the faction's own starting-resource names are
// always among them.

import { CARD_CATALOG, CARD_FIDELITY, CARD_SETS } from "../../../data.js";
import {
  CREATED_ABILITY_MENU,
  findDeckConstructionIssues,
  getMaxCopies,
  getMinimumDeckSize,
  isStapleResourceDefinition,
  withBuiltInFactionDefaults,
  type CardCatalogEntry,
  type CardDefinition,
  type CardDefinitionId,
  type CreatedAbilitySpec,
  type CreatedCostKind,
  type PlayerId
} from "../../../engine.js";
import { mulberry32 } from "./prng.js";

export type Random = () => number;

/** One player's deck: the faction card and the draw deck as `[definitionId, copies]` pairs. */
export interface DeckSpec {
  factionDefinitionId: CardDefinitionId;
  cards: Array<[CardDefinitionId, number]>;
}

/** Everything `createFactionGame` is given: with the action log it reproduces a game exactly. */
export interface GameSetupInputs {
  /** Seeds the engine's own RNG stream (shuffles, flips, random picks). */
  seed: number;
  players: Array<{ id: PlayerId; name: string; deck: DeckSpec }>;
  /** Set when the first player is decided by the caller; absent when a `chooseFirstPlayer` action decides it. */
  firstPlayerId?: PlayerId;
  chooseFirstPlayer: boolean;
  chooseStartingResources: boolean;
  startingResourceX?: Record<PlayerId, number>;
  /** The opponent each "match the opponent's starting resources" faction chooses (needed from three seats up). */
  startingResourceOpponent?: Record<PlayerId, PlayerId>;
  createdAbility?: CreatedAbilitySpec;
}

/** The catalog the engine is built over: every printing, plus the name list `nameValue` prompts check against. */
export const CATALOG: CardDefinition[] = CARD_CATALOG;
export const CARD_NAME_CATALOG: CardCatalogEntry[] = CARD_CATALOG.map(card => ({ name: card.name, cardType: card.type }));

const ICON_NAMES: Record<string, string> = {
  r: "rage",
  g: "greed",
  e: "elitism",
  d: "deception",
  o: "obsession"
};
const ICONS = Object.keys(ICON_NAMES);

const byId = new Map<CardDefinitionId, CardDefinition>(CATALOG.map(card => [card.id, card]));

export function definitionOf(id: CardDefinitionId): CardDefinition {
  const card = byId.get(id);
  if (!card) throw new Error(`Unknown card definition '${id}'.`);
  return card;
}

const isFull = (card: CardDefinition): boolean => CARD_FIDELITY.fidelity[card.id] === "full";

/** Printings the driver may put in a deck: full fidelity only. */
export const ELIGIBLE: CardDefinition[] = CATALOG.filter(isFull);
export const ELIGIBLE_FACTIONS: CardDefinition[] = ELIGIBLE.filter(card => card.type === "faction");
export const SET_NAMES: string[] = CARD_SETS.map(set => set.name);

const nonFaction = ELIGIBLE.filter(card => card.type !== "faction");
const staplesByIcon: Record<string, CardDefinition[]> = Object.fromEntries(
  ICONS.map(icon => [
    icon,
    nonFaction.filter(card => isStapleResourceDefinition(card) && card.name.toLowerCase() === ICON_NAMES[icon])
  ])
);
const nonStaples = nonFaction.filter(card => !isStapleResourceDefinition(card));

/** The resource icon letters a printed threshold asks for (`"ooo"` -> `["o"]`; none for free / numeric thresholds). */
function thresholdIcons(card: CardDefinition): string[] {
  const text = typeof card.threshold === "string" ? card.threshold : "";
  return [...new Set(text.split("").filter(char => char in ICON_NAMES || char === "v"))];
}

function iconOfName(name: string): string | undefined {
  return ICONS.find(icon => ICON_NAMES[icon] === name.toLowerCase());
}

/**
 * Icons a faction's STARTING RESOURCES rule names outright (Obsession for the Lugubrian Council,
 * Deception for the Union of Unextraordinary Miners, Greed for the Knitting Coalition, ...).
 * `findDeckConstructionIssues` rejects a deck without the named resources. The staples below are
 * spread evenly over these icons first, so every named icon is present, and with more than two
 * staples per icon so are the copies a rule names ("2 Greed").
 */
function requiredIcons(faction: CardDefinition): string[] {
  const rule = withBuiltInFactionDefaults(faction).faction?.setup.startingResources;
  const names = [
    ...(rule?.names ?? []),
    ...(rule?.chosenStaples?.plus ?? []),
    ...(rule?.slots ?? []).map(slot => ("name" in slot ? slot.name : undefined))
  ];
  return [...new Set(names.flatMap(name => (name ? [iconOfName(name)] : [])).filter((icon): icon is string => !!icon))];
}

function pick<T>(items: readonly T[], rng: Random): T {
  return items[Math.floor(rng() * items.length)]!;
}

export function shuffled<T>(items: readonly T[], rng: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export interface DeckOptions {
  /** The faction printing to build around; default: a random eligible one. */
  faction?: CardDefinition;
  /** A set (by name) whose cards the deck leans on; default: a random one. */
  featuredSet?: string;
}

/** A seeded random deck that passes `findDeckConstructionIssues`. */
export function randomDeck(rng: Random, options: DeckOptions = {}): DeckSpec {
  const faction = options.faction ?? pick(ELIGIBLE_FACTIONS, rng);
  const featuredSet = options.featuredSet ?? pick(SET_NAMES, rng);
  const minimum = getMinimumDeckSize(faction);
  const big = minimum !== undefined && minimum > 100;

  const icons = new Set(requiredIcons(faction));
  const iconTarget = big ? 5 : 2;
  const featured = nonStaples.filter(card => card.set === featuredSet);
  for (let guard = 0; icons.size < iconTarget && guard < 50; guard++) {
    const fromSet = featured.length > 0 && rng() < 0.7 ? thresholdIcons(pick(featured, rng)).filter(i => i !== "v") : [];
    icons.add(fromSet.length > 0 ? pick(fromSet, rng) : pick(ICONS, rng));
  }

  const size = minimum !== undefined ? minimum + Math.floor(rng() * 12) : 40 + Math.floor(rng() * 21);
  const stapleCount = Math.round(size * (big ? 0.2 : 0.3 + rng() * 0.1));

  const counts = new Map<CardDefinitionId, number>();
  const namesUsed = new Map<string, number>();
  const add = (card: CardDefinition, copies: number): void => {
    counts.set(card.id, (counts.get(card.id) ?? 0) + copies);
    namesUsed.set(card.name, (namesUsed.get(card.name) ?? 0) + copies);
  };

  // Staple resources of the chosen icons, spread evenly with a random printing each time.
  const iconList = [...icons];
  for (let i = 0; i < stapleCount; i++) {
    const options = staplesByIcon[iconList[i % iconList.length]!]!;
    add(pick(options, rng), 1);
  }

  const allowed = (card: CardDefinition): boolean => thresholdIcons(card).every(icon => icon === "v" || icons.has(icon));
  const pool = nonStaples.filter(allowed);
  // Leans on cheap characters (they can actually be deployed and fight) and on the featured set.
  const weight = (card: CardDefinition): number => {
    const cost = typeof card.cost === "number" ? card.cost : 0;
    const curve = cost <= 3 ? 2.5 : cost <= 5 ? 1 : 0.3;
    return (card.set === featuredSet ? 6 : 1) * (card.type === "character" ? 2 : 1) * curve;
  };
  let maxCopies = 3;
  let remaining = size - stapleCount;
  while (remaining > 0) {
    const open = pool.filter(card => {
      const limit = getMaxCopies(card);
      const used = namesUsed.get(card.name) ?? 0;
      return used < Math.min(limit ?? maxCopies, maxCopies);
    });
    if (open.length === 0) {
      if (maxCopies < 4) maxCopies++;
      else throw new Error(`Cannot fill a ${size}-card deck for '${faction.name}' from icons ${iconList.join("")}.`);
      continue;
    }
    const total = open.reduce((sum, card) => sum + weight(card), 0);
    let roll = rng() * total;
    let chosen = open[open.length - 1]!;
    for (const card of open) {
      roll -= weight(card);
      if (roll < 0) {
        chosen = card;
        break;
      }
    }
    const limit = Math.min(getMaxCopies(chosen) ?? maxCopies, maxCopies);
    const room = limit - (namesUsed.get(chosen.name) ?? 0);
    const wanted = rng() < 0.4 ? 1 : rng() < 0.65 ? 2 : 3;
    const copies = Math.max(1, Math.min(room, wanted, remaining));
    add(chosen, copies);
    remaining -= copies;
  }

  const cards = [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const deck: DeckSpec = { factionDefinitionId: faction.id, cards };
  const issues = findDeckConstructionIssues(expandDeck(deck).map(definitionOf).concat([faction]));
  if (issues.length > 0) {
    throw new Error(`Generated an illegal deck for '${faction.name}': ${issues.map(i => i.message).join(" ")}`);
  }
  return deck;
}

/** The draw deck as one definition id per copy, in a fixed order (the engine shuffles it from the seed). */
export function expandDeck(deck: DeckSpec): CardDefinitionId[] {
  return deck.cards.flatMap(([id, copies]) => Array.from({ length: copies }, () => id));
}

/** A random spec for The Open R&D Faction's created ability. */
export function randomCreatedAbility(rng: Random): CreatedAbilitySpec {
  const menu = CREATED_ABILITY_MENU;
  const amountOf = (entry: { min?: number; max?: number }): number | undefined =>
    entry.min === undefined || entry.max === undefined
      ? undefined
      : entry.min + Math.floor(rng() * (entry.max - entry.min + 1));
  const costKinds = shuffled(menu.costs, rng).slice(0, menu.limits.minCosts + Math.floor(rng() * (menu.limits.maxCosts - menu.limits.minCosts + 1)));
  const effect = pick(menu.effects, rng);
  const effectAmount = amountOf(effect);
  return {
    costs: costKinds.map(entry => ({ kind: entry.kind as CreatedCostKind, amount: amountOf(entry) ?? 1 })),
    effect: effectAmount === undefined ? { kind: effect.kind } : { kind: effect.kind, amount: effectAmount }
  };
}

export interface SetupOptions {
  /** Faction printing per seat (default: random). */
  factions?: Array<CardDefinition | undefined>;
  /** Featured set per seat (default: random). */
  featuredSets?: Array<string | undefined>;
  /** Seat count (default 2). */
  seats?: number;
}

/** A complete seeded game setup: decks, who goes first (decided by a `chooseFirstPlayer` answer or up front), staple choices. */
export function randomSetup(seed: number, options: SetupOptions = {}): GameSetupInputs {
  const rng = mulberry32(seed ^ 0x5eed5eed);
  const seats = options.seats ?? 2;
  const players = Array.from({ length: seats }, (_, seat) => ({
    id: `p${seat + 1}` as PlayerId,
    name: `Player ${seat + 1}`,
    deck: randomDeck(rng, { faction: options.factions?.[seat], featuredSet: options.featuredSets?.[seat] })
  }));

  const setup: GameSetupInputs = {
    seed: Math.floor(rng() * 0xffffffff) >>> 0,
    players,
    chooseFirstPlayer: rng() < 0.5,
    chooseStartingResources: rng() < 0.5
  };
  if (!setup.chooseFirstPlayer) setup.firstPlayerId = pick(players, rng).id;

  const factionOf = (seat: number): CardDefinition => withBuiltInFactionDefaults(definitionOf(players[seat]!.deck.factionDefinitionId));
  const x: Record<PlayerId, number> = {};
  for (let seat = 0; seat < seats; seat++) {
    const chosen = factionOf(seat).faction?.setup.startingResources.chosenStaples;
    if (chosen) x[players[seat]!.id] = chosen.min + Math.floor(rng() * (Math.min(chosen.max, chosen.min + 6) - chosen.min + 1));
  }
  if (Object.keys(x).length > 0) setup.startingResourceX = x;

  // A faction that tops an opponent up to its own starting resources chooses which one when there are several.
  if (seats > 2) {
    const chosen: Record<PlayerId, PlayerId> = {};
    for (let seat = 0; seat < seats; seat++) {
      if (!factionOf(seat).faction?.setup.startingResources.matchOpponentCount) continue;
      const others = players.filter((_, other) => other !== seat);
      chosen[players[seat]!.id] = pick(others, rng).id;
    }
    if (Object.keys(chosen).length > 0) setup.startingResourceOpponent = chosen;
  }

  if (players.some((_, seat) => factionOf(seat).faction?.playerCreatedAbility)) {
    setup.createdAbility = randomCreatedAbility(rng);
  }
  return setup;
}
