/* deckRules.ts
 *
 * Deck-construction rules, as static functions (not SpoilsEngine methods: no
 * game exists yet when a deck is being built). The engine itself builds a game
 * from whatever deck it is handed; these are the rules a deck-builder, a
 * lobby or a server gate holds a decklist to before handing it over.
 *
 * A deck is checked against `DeckRules`: a format (CR 103.1 Constructed, CR
 * 103.2 Limited) and where it is played (casual, a tournament, or an epic
 * tournament: docs/rules/epic-rules.md). Sources (see BEHAVIORS.md "Read-only
 * queries for clients"):
 * - exactly one faction card: CR 103.1a / 103.2a (the faction starts the game
 *   in play; a deck supplies one);
 * - the minimum size: CR 103.1b (Constructed 75) / 103.2b (Limited 40), or the
 *   faction's printed MINIMUM DECK SIZE (`FactionDefinition.minimumDeckSize`),
 *   which wins over the rule (CR 101.1). The faction card is not part of the
 *   deck (RULES.md §3.6) and does not count toward it;
 * - the copy limit: CR 103.1c in Constructed (4; staple resources and the
 *   printed "You may include as many copies of this card in your deck as you
 *   want", `CardDefinition.deckLimit`, are exempt), none in Limited (CR
 *   103.2c), 1 for an epic card in Constructed (EP 2);
 * - cards a deck may not hold at all: epic cards in Limited (EP 3) and at a
 *   tournament that is not an epic tournament (EP 4), and a card printing
 *   "cannot be used in tournament play" at any tournament
 *   (`CardDefinition.notForTournamentPlay`; the card beats EP 4, CR 101.1);
 * - a faction's own starting-resource rule: `findFactionDeckIssues`.
 *
 * Not checked: the official banned lists (CR 103.1d / 103.2d), which the
 * Tournament Rules publish and the catalog does not carry.
 */

import type { CardDefinition, CardDefinitionId, FactionDefinition } from "../types/index.js";
import { findFactionDeckIssues } from "./factionSetup.js";
import { isStapleResourceDefinition, withBuiltInFactionDefaults } from "./utilities.js";

/** The normal "no more than N copies of a card" limit of a Constructed deck (CR 103.1c). */
export const DEFAULT_MAX_COPIES = 4;

/** The copy limit of an epic card in a Constructed deck (EP 2). */
export const EPIC_MAX_COPIES = 1;

/** The two deck formats: Constructed (CR 103.1) and Limited (CR 103.2). */
export type DeckFormat = "constructed" | "limited";

/**
 * Where the deck is played: casual play, a tournament (no epic cards, EP 4),
 * or an epic tournament (epic cards allowed, EP 4). At either kind of
 * tournament a card printing "cannot be used in tournament play" is out.
 */
export type DeckPlay = "casual" | "tournament" | "epicTournament";

/** The rules a deck is held to. Defaults: Constructed, casual play. */
export interface DeckRules {
  format?: DeckFormat;
  play?: DeckPlay;
}

/** The minimum deck size (faction card excluded) of each format: CR 103.1b / 103.2b. */
export const FORMAT_MINIMUM_DECK_SIZE: Readonly<Record<DeckFormat, number>> = { constructed: 75, limited: 40 };

/**
 * Why a deck may not hold a card at all under some `DeckRules`:
 * - `epicInLimited`: an epic card in a Limited deck (EP 3);
 * - `epicInTournament`: an epic card at a tournament that is not an epic tournament (EP 4);
 * - `notForTournamentPlay`: the card prints "cannot be used in tournament play" and the deck is for a tournament.
 */
export type CardExclusion = "epicInLimited" | "epicInTournament" | "notForTournamentPlay";

export type DeckConstructionIssueKind =
  | "empty"
  | "unknownCard"
  | "factionCount"
  /** The deck holds a card these rules do not allow at all (`exclusion` says why). */
  | "notAllowed"
  | "copyLimit"
  | "minimumSize"
  /** The deck's faction cannot start a game with this decklist (`findFactionDeckIssues`). */
  | "factionRule";

export interface DeckConstructionIssue {
  kind: DeckConstructionIssueKind;
  /** A complete, display-ready sentence. */
  message: string;
  /** The card concerned: the unknown id (`unknownCard`), the excluded card (`notAllowed`) or the over-limit card (`copyLimit`). */
  cardId?: CardDefinitionId;
  /** `notAllowed` only: why the card is not allowed. */
  exclusion?: CardExclusion;
  /** `copyLimit` only: how many copies the decklist holds of `cardId`. */
  count?: number;
  /** `copyLimit` only: the most copies `getMaxCopies` allows of `cardId` (always a number: an unlimited card is never an issue). */
  max?: number;
}

export interface DeckConstructionOptions extends DeckRules {
  /**
   * Ids in the decklist that the caller could not resolve to a definition
   * (one entry per copy). Each distinct id is reported as an `unknownCard`
   * issue, and every entry counts toward the decklist size.
   */
  unknownCardIds?: readonly CardDefinitionId[];
  /**
   * The minimum deck size (faction card excluded) to hold the deck to.
   * Default: `getMinimumDeckSize` for the deck's faction and format. `false`
   * skips the check.
   */
  minimumSize?: number | false;
  /** Also report the deck's faction's own starting-resource rule (default `true`). */
  factionRules?: boolean;
}

/** Whether a card is an epic card: its printed rarity mark reads "EPIC", or "E-SLE" on the Showdown factions (EP 1). */
export function isEpicCard(definition: CardDefinition): boolean {
  return definition.rarity === "epic" || definition.rarity === "e-sle";
}

/**
 * Why a deck held to `rules` may not include this card at all, or `undefined`
 * when it may. Applies to faction cards too: an epic faction cannot lead a
 * Limited deck or a non-epic tournament deck.
 */
export function getCardExclusion(definition: CardDefinition, rules: DeckRules = {}): CardExclusion | undefined {
  const play = rules.play ?? "casual";
  if (play !== "casual" && definition.notForTournamentPlay) return "notForTournamentPlay";
  if (isEpicCard(definition)) {
    if ((rules.format ?? "constructed") === "limited") return "epicInLimited";
    if (play === "tournament") return "epicInTournament";
  }
  return undefined;
}

/**
 * How many copies of a card a deck held to `rules` may include: 0 when the
 * card is not allowed at all (`getCardExclusion`); `null` (unlimited) in
 * Limited (CR 103.2c), and in Constructed for a staple resource (CR 103.1c)
 * and a printing flagged `deckLimit: "unlimited"`; `EPIC_MAX_COPIES` for an
 * epic card in Constructed (EP 2); `DEFAULT_MAX_COPIES` otherwise. A faction
 * card is not copy-limited here (the deck holds exactly one, see
 * `factionCount`); unless excluded it reports the format's normal limit.
 */
export function getMaxCopies(definition: CardDefinition, rules: DeckRules = {}): number | null {
  if (getCardExclusion(definition, rules)) return 0;
  if ((rules.format ?? "constructed") === "limited") return null;
  if (definition.deckLimit === "unlimited") return null;
  if (isStapleResourceDefinition(definition)) return null;
  if (isEpicCard(definition)) return EPIC_MAX_COPIES;
  return DEFAULT_MAX_COPIES;
}

/**
 * The smallest deck (not counting the faction card) a deck with this faction
 * may be in `format`: the faction's printed MINIMUM DECK SIZE
 * (`FactionDefinition.minimumDeckSize`), which wins over the rule (CR 101.1),
 * else the format's (`FORMAT_MINIMUM_DECK_SIZE`: 75 Constructed, 40
 * Limited). Accepts the faction card or its `faction` data.
 */
export function getMinimumDeckSize(faction?: CardDefinition | FactionDefinition, format: DeckFormat = "constructed"): number {
  const data = faction && "startingInfluence" in faction ? faction : faction?.faction;
  return data?.minimumDeckSize ?? FORMAT_MINIMUM_DECK_SIZE[format];
}

/**
 * The face of a double-sided faction card that a deck is built around. A
 * faction whose data says it `startsFlipped` (Counter-Imperial Army) is the
 * other side of a card that is printed starting as `flipsTo` (Imperial Army):
 * choosing either side as a deck's faction means the `flipsTo` face. Any other
 * card is returned as it is. `catalog` is a lookup function or a card list.
 */
export function deckFactionFace(
  definition: CardDefinition,
  catalog: ((id: CardDefinitionId) => CardDefinition | undefined) | readonly CardDefinition[]
): CardDefinition {
  const faction = definition.faction;
  if (definition.type !== "faction" || !faction?.setup.startsFlipped || !faction.flipsTo) return definition;
  const find = typeof catalog === "function" ? catalog : (id: CardDefinitionId) => catalog.find(c => c.id === id);
  return find(faction.flipsTo) ?? definition;
}

/** Splits a list of ids into the resolved definitions (with repeats) and the ids the catalog does not know. */
export function resolveDeckCards(
  cardIds: readonly CardDefinitionId[],
  catalog: ((id: CardDefinitionId) => CardDefinition | undefined) | readonly CardDefinition[]
): { cards: CardDefinition[]; unknownCardIds: CardDefinitionId[] } {
  let find: (id: CardDefinitionId) => CardDefinition | undefined;
  if (typeof catalog === "function") {
    find = catalog;
  } else {
    const byId = new Map(catalog.map(card => [card.id, card] as const));
    find = id => byId.get(id);
  }
  const cards: CardDefinition[] = [];
  const unknownCardIds: CardDefinitionId[] = [];
  for (const id of cardIds) {
    const card = find(id);
    if (card) cards.push(card);
    else unknownCardIds.push(id);
  }
  return { cards, unknownCardIds };
}

/**
 * Everything wrong with a decklist as a deck held to `options` (a `DeckRules`
 * format and play; default Constructed, casual), in a fixed order: empty,
 * unknown cards, faction count, cards not allowed at all, copy limits,
 * minimum size, then the faction's own starting-resource rule. An empty
 * result is a legal deck for those rules.
 * `cards` is the decklist's definitions, one entry per copy, faction card
 * included (as clients store a decklist); the faction card is not counted
 * toward the minimum size. This is the complete list: a client
 * needs no separate call to `findFactionDeckIssues`.
 *
 * What it does not check: engine fidelity (`CARD_FIDELITY`) and admin-disabled
 * cards, which are policy of the host application, not rules.
 */
export function findDeckConstructionIssues(
  cards: readonly CardDefinition[],
  options: DeckConstructionOptions = {}
): DeckConstructionIssue[] {
  const unknownCardIds = options.unknownCardIds ?? [];
  const issues: DeckConstructionIssue[] = [];
  const total = cards.length + unknownCardIds.length;
  const factionCards = cards.filter(card => card.type === "faction");
  // The faction card is not part of the deck (RULES.md §3.6): it never counts toward the size.
  const deckSize = total - factionCards.length;

  if (total === 0) issues.push({ kind: "empty", message: "The decklist is empty." });

  const distinctUnknown = [...new Set(unknownCardIds)];
  for (const cardId of distinctUnknown) {
    issues.push({ kind: "unknownCard", cardId, message: `The decklist has an unknown card id: ${cardId}.` });
  }

  if (factionCards.length !== 1) {
    issues.push({
      kind: "factionCount",
      message: `A deck must contain exactly one faction card, found ${factionCards.length}.`
    });
  }

  const rules: DeckRules = { format: options.format ?? "constructed", play: options.play ?? "casual" };
  const excluded = new Set<CardDefinitionId>();
  for (const card of cards) {
    const exclusion = getCardExclusion(card, rules);
    if (!exclusion || excluded.has(card.id)) continue;
    excluded.add(card.id);
    issues.push({ kind: "notAllowed", cardId: card.id, exclusion, message: exclusionMessage(card, exclusion) });
  }

  // Cards with the same name are the same card across printings (CR §201.1b),
  // so the limit counts every printing of a name together. The issue names the
  // first printing of the name in the decklist; a name is unlimited when any of
  // its printings is (the "as many copies" sentence is the card's, not the
  // printing's), otherwise its limit is the lowest of its printings'.
  // A printing reported as `notAllowed` is not counted again here.
  const counts = new Map<string, { card: CardDefinition; count: number; max: number | null }>();
  for (const card of cards) {
    if (card.type === "faction" || excluded.has(card.id)) continue;
    const max = getMaxCopies(card, rules);
    const entry = counts.get(card.name);
    if (entry) {
      entry.count++;
      entry.max = entry.max === null || max === null ? null : Math.min(entry.max, max);
    } else counts.set(card.name, { card, count: 1, max });
  }
  for (const { card, count, max } of counts.values()) {
    if (max !== null && count > max) {
      issues.push({
        kind: "copyLimit",
        cardId: card.id,
        count,
        max,
        message: `${count} copies of ${card.name} is over the ${max}-copy limit.`
      });
    }
  }

  if (options.minimumSize !== false) {
    const minimum = options.minimumSize ?? getMinimumDeckSize(factionCards.length === 1 ? factionCards[0] : undefined, rules.format);
    if (deckSize < minimum) {
      issues.push({
        kind: "minimumSize",
        message: `A deck needs at least ${minimum} cards besides its faction card, found ${deckSize}.`
      });
    }
  }

  if (options.factionRules !== false && factionCards.length === 1) {
    const factionCard = withBuiltInFactionDefaults(factionCards[0]!);
    if (factionCard.faction) {
      for (const message of findFactionDeckIssues(factionCard.faction, cards, factionCard.name)) {
        issues.push({ kind: "factionRule", message });
      }
    }
  }

  return issues;
}

function exclusionMessage(card: CardDefinition, exclusion: CardExclusion): string {
  switch (exclusion) {
    case "epicInLimited":
      return `${card.name} is an epic card: epic cards are not available in Limited play.`;
    case "epicInTournament":
      return `${card.name} is an epic card: epic cards can only be used at an epic tournament.`;
    case "notForTournamentPlay":
      return `${card.name} cannot be used in tournament play.`;
  }
}
