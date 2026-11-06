/* deckRules.ts
 *
 * Deck-construction rules, as static functions (not SpoilsEngine methods: no
 * game exists yet when a deck is being built). The engine itself builds a game
 * from whatever deck it is handed; these are the rules a deck-builder, a
 * lobby or a server gate holds a decklist to before handing it over.
 *
 * Sources (see BEHAVIORS.md "Read-only queries for clients"):
 * - exactly one faction card: RULES.md §3.6 / CR §202.2 (the faction starts the
 *   game in play; a deck supplies one);
 * - the copy limit and its exceptions: CR §103.1c (staple resources: any
 *   number; RULES.md §3.5) and the printed "You may include as many copies of
 *   this card in your deck as you want" (Party Clowns, Crow With Fists), read
 *   from `CardDefinition.deckLimit`, never from the card text;
 * - the minimum size: only a faction's printed MINIMUM DECK SIZE
 *   (`FactionDefinition.minimumDeckSize`) or a size the caller passes. RULES.md
 *   has no general minimum, so there is none here; the faction card is not
 *   part of the deck (RULES.md §3.6) and does not count toward it;
 * - a faction's own starting-resource rule: `findFactionDeckIssues`;
 * - epic cards (RULES.md "Epic cards", EP 1-4): printed rarity EPIC or E-SLE
 *   (`isEpicCard`); at most 1 copy in Constructed, none in Limited, and none in
 *   tournament play unless it is an epic tournament.
 */

import type { CardDefinition, CardDefinitionId, FactionDefinition } from "../types/index.js";
import { findFactionDeckIssues } from "./factionSetup.js";
import { isStapleResourceDefinition, withBuiltInFactionDefaults } from "./utilities.js";

/** The normal "no more than N copies of a card" limit of a constructed deck. */
export const DEFAULT_MAX_COPIES = 4;

/** The most copies of an epic card a Constructed deck may hold (EP 2). */
export const EPIC_MAX_COPIES = 1;

export type DeckConstructionIssueKind =
  | "empty"
  | "unknownCard"
  | "factionCount"
  | "copyLimit"
  | "minimumSize"
  /** More than 1 copy of an epic card in a Constructed deck (EP 2). Replaces the `copyLimit` issue for that card. */
  | "epicCopyLimit"
  /** An epic card (the faction card included) in a Limited deck (EP 3). */
  | "epicInLimited"
  /** An epic card (the faction card included) in a tournament deck that is not an epic tournament (EP 4). */
  | "epicInTournament"
  /** The deck's faction cannot start a game with this decklist (`findFactionDeckIssues`). */
  | "factionRule";

export interface DeckConstructionIssue {
  kind: DeckConstructionIssueKind;
  /** A complete, display-ready sentence. */
  message: string;
  /** The card concerned: the unknown id (`unknownCard`), the over-limit card (`copyLimit`, `epicCopyLimit`) or the epic card (`epicInLimited`, `epicInTournament`). */
  cardId?: CardDefinitionId;
  /** `copyLimit` / `epicCopyLimit` only: how many copies the decklist holds of `cardId`. */
  count?: number;
  /** `copyLimit` / `epicCopyLimit` only: the most copies allowed of `cardId` (`getMaxCopies`, or `EPIC_MAX_COPIES`; always a number: an unlimited card is never an issue). */
  max?: number;
}

export interface DeckConstructionOptions {
  /**
   * Ids in the decklist that the caller could not resolve to a definition
   * (one entry per copy). Each distinct id is reported as an `unknownCard`
   * issue, and every entry counts toward the decklist size.
   */
  unknownCardIds?: readonly CardDefinitionId[];
  /**
   * The minimum deck size (faction card excluded) to hold the deck to.
   * Default: the deck's faction's printed `getMinimumDeckSize`, if it has
   * one; with neither there is no minimum rule. `false` skips the check even
   * for a faction that prints one.
   */
  minimumSize?: number | false;
  /**
   * How the deck is played: `"constructed"` (default) or `"limited"`. Epic
   * cards are held to 1 copy in Constructed (EP 2) and are not allowed in
   * Limited (EP 3). Nothing else here is format-dependent: pass `minimumSize`
   * for the format's deck size.
   */
  play?: "constructed" | "limited";
  /**
   * Present = tournament play: epic cards are not allowed (EP 4) unless
   * `epic: true` (an epic tournament). Absent (default) = casual play.
   */
  tournament?: { epic?: boolean };
  /** Also report the deck's faction's own starting-resource rule (default `true`). */
  factionRules?: boolean;
}

/**
 * Whether a card is an epic card (EP 1): its printed rarity reads EPIC or
 * E-SLE (the two Showdown factions). Case-insensitive.
 */
export function isEpicCard(definition: CardDefinition): boolean {
  const rarity = definition.rarity.trim().toLowerCase();
  return rarity === "epic" || rarity === "e-sle";
}

/**
 * How many copies of a card a deck may hold: `DEFAULT_MAX_COPIES` normally,
 * `null` (unlimited) for a staple resource (CR §103.1c) and for a printing
 * flagged `deckLimit: "unlimited"`. A faction card is not copy-limited here
 * (the deck holds exactly one, see `factionCount`); it reports the default.
 */
export function getMaxCopies(definition: CardDefinition): number | null {
  if (definition.deckLimit === "unlimited") return null;
  if (isStapleResourceDefinition(definition)) return null;
  return DEFAULT_MAX_COPIES;
}

/**
 * The smallest deck (not counting the faction card) a deck with this faction
 * may be: the faction's printed MINIMUM DECK SIZE
 * (`FactionDefinition.minimumDeckSize`), or `undefined` when it prints none,
 * which means there is no minimum rule (RULES.md has no general minimum; a UI
 * "recommended size" is not a rule). Accepts the faction card or its
 * `faction` data.
 */
export function getMinimumDeckSize(faction?: CardDefinition | FactionDefinition): number | undefined {
  const data = faction && "startingInfluence" in faction ? faction : faction?.faction;
  return data?.minimumDeckSize;
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
 * Everything wrong with a decklist as a deck, in a fixed order: empty,
 * unknown cards, faction count, copy limits, minimum size, then the faction's
 * own starting-resource rule. Epic restrictions (EP 2-4) come with the copy
 * limits: per distinct epic card, one `epicCopyLimit` (instead of
 * `copyLimit`) when over 1 copy in Constructed, or one `epicInLimited` in
 * Limited, and one `epicInTournament` in a non-epic tournament. An empty result is a constructible deck.
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

  // Cards with the same name are the same card across printings (CR §201.1b),
  // so the limit counts every printing of a name together. The issue names the
  // first printing of the name in the decklist; a name is unlimited when any of
  // its printings is (the "as many copies" sentence is the card's, not the printing's).
  // Epic is the same: a name is epic when any printing is (EP 1), and the faction card is checked too.
  const play = options.play ?? "constructed";
  const counts = new Map<string, { card: CardDefinition; count: number; unlimited: boolean; epic: boolean }>();
  const epicCards = new Map<string, CardDefinition>();
  for (const card of cards) {
    const epic = isEpicCard(card);
    if (epic && !epicCards.has(card.name)) epicCards.set(card.name, card);
    if (card.type === "faction") continue;
    const unlimited = getMaxCopies(card) === null;
    const entry = counts.get(card.name);
    if (entry) {
      entry.count++;
      entry.unlimited ||= unlimited;
      entry.epic ||= epic;
    } else counts.set(card.name, { card, count: 1, unlimited, epic });
  }
  for (const { card, count, unlimited, epic } of counts.values()) {
    const cardId = card.id;
    if (epic) {
      // An epic card has its own limit instead of the normal one (EP 2); in Limited it is not allowed at all (reported below).
      if (play === "constructed" && count > EPIC_MAX_COPIES) {
        issues.push({
          kind: "epicCopyLimit",
          cardId,
          count,
          max: EPIC_MAX_COPIES,
          message: `${count} copies of ${card.name} is over the ${EPIC_MAX_COPIES}-copy limit for epic cards.`
        });
      }
      continue;
    }
    const max = unlimited ? null : getMaxCopies(card);
    if (max !== null && count > max) {
      issues.push({
        kind: "copyLimit",
        cardId,
        count,
        max,
        message: `${count} copies of ${card.name} is over the ${max}-copy limit.`
      });
    }
  }

  for (const card of epicCards.values()) {
    if (play === "limited") {
      issues.push({
        kind: "epicInLimited",
        cardId: card.id,
        message: `${card.name} is an epic card, and epic cards are not allowed in Limited.`
      });
    }
    if (options.tournament && !options.tournament.epic) {
      issues.push({
        kind: "epicInTournament",
        cardId: card.id,
        message: `${card.name} is an epic card, and epic cards are not allowed in tournament play unless it is an epic tournament.`
      });
    }
  }

  if (options.minimumSize !== false) {
    const minimum = options.minimumSize ?? getMinimumDeckSize(factionCards.length === 1 ? factionCards[0] : undefined);
    if (minimum !== undefined && deckSize < minimum) {
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
