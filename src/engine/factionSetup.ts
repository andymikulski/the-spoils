// -----------------------------------------------------------------------------
// Faction-driven game setup
// -----------------------------------------------------------------------------

import type {
  CardCatalogEntry,
  CardDefinition,
  CardDefinitionId,
  CardInstanceId,
  CreatedAbilitySpec,
  FactionDefinition,
  GameState,
  PlayerId,
  ResolutionContext
} from "../types/index.js";
import {
  assert,
  isStapleResourceDefinition,
  startingStaplesMustDiffer,
  withBuiltInFactionDefaults
} from "./utilities.js";
import { createCardInstance, createGame } from "./setup.js";
import { SpoilsEngine } from "./SpoilsEngine.js";
import { drawRandom, shuffleInPlace } from "./rng.js";

export interface FactionPlayerSetup {
  id: PlayerId;
  name: string;

  /**
   * May be omitted when deckDefinitionIds contains exactly one faction card.
   * The faction is removed from the draw deck automatically.
   */
  factionDefinitionId?: CardDefinitionId;
  deckDefinitionIds: CardDefinitionId[];
}

export interface FactionGameSetupOptions {
  /** Who takes the first turn, already decided by the caller. Wins over `chooseFirstPlayer`. */
  firstPlayerId?: PlayerId;
  /**
   * CR 601.1c in the engine: once the starting resources are in play, the
   * game's RNG picks which of all the players decides who goes first, and
   * setup pauses in the `chooseFirstPlayer` phase for that player's
   * `chooseFirstPlayer` action (any player, themselves included). Ignored
   * when `firstPlayerId` is given. Off by default: the first seat (or
   * `firstPlayerId`) goes first and no random draw is made.
   */
  chooseFirstPlayer?: boolean;
  /**
   * Seeds the game's RNG stream (deck shuffles, coin flips, `{type:"random"}`
   * expressions/targets for the rest of the game). Omit for an unpredictable
   * seed; pass one to reproduce a game exactly (replay, save/share, tests).
   */
  seed?: number;
  /**
   * "Choose a number for X" for a faction whose
   * `setup.startingResources.chosenStaples` is set (The Union of
   * Unextraordinary Miners — MONEY FOR NOTHING). Clamped to `[min, max]`;
   * defaults to `min` when omitted.
   */
  startingResourceX?: Record<PlayerId, number>;
  /**
   * Let a player pick *which* staples their faction starts with in play,
   * when their deck runs more than one kind (most factions — "find 2 staple
   * resources"). Adds a `chooseStartingResources` setup phase before the
   * mulligan; each affected seat dispatches a `chooseStartingResources`
   * action. Off by default — setup then takes staples in deck order, as it
   * always has. The same flag makes a faction's optional STARTING DRAW search
   * ("You may search ...") a real prompt (the `startingDrawSearch` phase)
   * instead of fetching the first match automatically.
   */
  chooseStartingResources?: boolean;
  /**
   * The ability the two players wrote for a faction with
   * `faction.playerCreatedAbility` ("Before the game begins, both players
   * create the rules text for an ability" -- The Open R&D Faction). Not free
   * text: the one ability the two players agree on, picked from the closed
   * menu `CREATED_ABILITY_MENU`. Setup validates it (an invalid spec throws)
   * and builds the ability and its rules text; every such faction card in the
   * game gets it, usable by both players. JSON-serializable, so an online
   * match can pin it. See `SpoilsEngine.applyCreatedFactionAbility`.
   */
  createdAbility?: CreatedAbilitySpec;
  /**
   * Real cards (name + type) the engine may check a named card against:
   * "name a non-resource card" (Incriminating Photograph) then refuses names
   * that are not cards, and resource cards. Omit it and any text is accepted.
   * Not saved with the game: pass it again when resuming (`loadGame`).
   */
  cardCatalog?: readonly CardCatalogEntry[];
}

/** `createFactionGame`'s argument: the players in seat order (two or more, distinct ids) plus the setup options. */
export interface FactionGameOptions extends FactionGameSetupOptions {
  players: FactionPlayerSetup[];
}

type StartingRule = FactionDefinition["setup"]["startingResources"];

/**
 * One card a faction's STARTING RESOURCES rule takes from the deck: a resource
 * (optionally a staple, optionally a specific name) or, for "Any 1 card", any
 * card.
 */
type StartingNeed =
  | { kind: "resource"; name?: string; staple?: boolean; faceDown?: boolean }
  | { kind: "anyCard" };

/**
 * The cards a `slots` program or a `chosenStaples` rule (X staples, then the
 * named extras; `x` defaults to the smallest X the player may choose) takes,
 * in the order the rule lists them. Other rules are the flat `{ count, names?,
 * stapleOnly? }` form, which `chooseStartingResources` filters by membership.
 */
function startingNeeds(rule: StartingRule, x?: number): StartingNeed[] {
  if (rule.slots?.length) {
    return rule.slots.map(slot =>
      slot.kind === "resource"
        ? { kind: "resource", name: slot.name, staple: slot.staple, faceDown: slot.faceDown }
        : { kind: "anyCard" }
    );
  }
  if (rule.chosenStaples) {
    const { min, plus } = rule.chosenStaples;
    return [
      ...Array.from({ length: x ?? min }, (): StartingNeed => ({ kind: "resource", staple: true })),
      ...(plus ?? []).map((name): StartingNeed => ({ kind: "resource", name }))
    ];
  }
  return [];
}

/**
 * Whether setup refuses to start without a card for this need. A named resource
 * ("1 Obsession", "...and 1 Deception") and a staple slot ("1 staple resource")
 * need theirs; "Any 1 resource" and "Any 1 card" are searches that may come up
 * short (CR 312.2, CR 402.5), and setup starts with what the deck has.
 */
function isRequiredNeed(need: StartingNeed): boolean {
  return need.kind === "resource" && Boolean(need.name || need.staple);
}

/** The named resources of a `slots` / `chosenStaples` rule ("1 Deception"), one need per copy. */
function namedStartingNeeds(rule: StartingRule): StartingNeed[] {
  return startingNeeds(rule).filter(need => need.kind === "resource" && need.name);
}

/**
 * What a deck must hold for `rule`: every need of a `slots` / `chosenStaples`
 * rule (those that `isRequiredNeed`), and, for the flat form, each resource
 * its `names` list names ("2 Greed"). The rest of a flat rule ("Any 2 staple
 * resources") is a search that the setup carries out as far as the deck allows.
 */
function deckStartingNeeds(rule: StartingRule): StartingNeed[] {
  if (rule.slots?.length || rule.chosenStaples) return startingNeeds(rule);
  return (rule.names ?? []).map((name): StartingNeed => ({ kind: "resource", name }));
}

function matchesNeed(need: StartingNeed, definition: CardDefinition): boolean {
  if (need.kind === "anyCard") return true;
  if (definition.type !== "resource") return false;
  if (need.name && definition.name.toLowerCase() !== need.name.toLowerCase()) return false;
  return !need.staple || isStapleResourceDefinition(definition);
}

/**
 * Gives each need its own card from `pool`. Needs are taken in order and each
 * takes the first free card that fits, in pool order; only when none is free
 * does it move an earlier need onto another card (an augmenting path), so a
 * card that fits a broad need is never what leaves a later narrow need
 * ("X staples and 1 Deception" with the Deception first in the deck) without
 * one. A need gets a card whenever any assignment can give every matched need
 * its own. The result holds each need's card, `undefined` when the pool has
 * none left for it. Setup and deck validation both place cards through this,
 * so they cannot disagree.
 */
function assignStartingNeeds<T>(
  needs: readonly StartingNeed[],
  pool: readonly T[],
  definitionOf: (item: T) => CardDefinition
): Array<T | undefined> {
  const fits = needs.map(need => pool.map(item => matchesNeed(need, definitionOf(item))));
  const holder: Array<number | undefined> = pool.map(() => undefined); // pool index -> need index
  const place = (need: number, seen: Set<number>): boolean => {
    const candidates = pool.map((_, at) => at).filter(at => fits[need]![at] && !seen.has(at));
    const free = candidates.find(at => holder[at] === undefined);
    if (free !== undefined) {
      holder[free] = need;
      return true;
    }
    for (const at of candidates) {
      seen.add(at);
      if (place(holder[at]!, seen)) {
        holder[at] = need;
        return true;
      }
    }
    return false;
  };
  needs.forEach((_, need) => place(need, new Set()));
  const picks: Array<T | undefined> = needs.map(() => undefined);
  holder.forEach((need, at) => {
    if (need !== undefined) picks[need] = pool[at];
  });
  return picks;
}

function describeNeed(need: StartingNeed): string {
  if (need.kind === "anyCard") return "card";
  return need.name ?? (need.staple ? "staple resource" : "resource");
}

/** "2 Greed" / "1 Deception": the needs counted by kind, in first-seen order. */
function listNeeds(needs: readonly StartingNeed[]): string {
  const counts = new Map<string, number>();
  for (const need of needs) counts.set(describeNeed(need), (counts.get(describeNeed(need)) ?? 0) + 1);
  return [...counts].map(([description, count]) => `${count} ${description}`).join(" and ");
}

/**
 * Deck-legality check for a faction's STARTING RESOURCES rule. Two things make
 * a deck unplayable for its faction:
 *
 * - A faction that needs N DIFFERENT staple resources ("Any 2 different staple
 *   resources" — `distinctStaples`, rules answer Q45) with fewer than N staple
 *   kinds in the deck. The engine still starts such a game with a duplicate
 *   staple as a safety fallback, but the deck should be treated as unplayable
 *   so a player can't field their faction illegally.
 * - A faction whose rule names a specific resource ("1 Obsession", "1 Deception"
 *   next to X staples, "2 Greed") or has a staple slot ("1 Obsession, 1 staple
 *   resource"; the X staples take the smallest X) with a deck that cannot give
 *   each of them its own card. Setup puts exactly those cards into play from the
 *   deck and cannot start the game without one. The rest of the rules ("Any 2
 *   staple resources", "Any 1 resource", "Any 1 card") are searches that may
 *   find fewer (CR 312.2): setup starts with what the deck has, so they need
 *   nothing.
 *
 * Returns readable issues; an empty list means the deck satisfies the rule.
 *
 * `deckCardDefs` is the deck's card definitions, one entry per copy (the
 * faction card, if listed, is ignored). Staple "kinds" are counted by resource
 * name, case-insensitively, so different printings of Rage are one kind.
 */
export function findFactionDeckIssues(
  faction: FactionDefinition,
  deckCardDefs: readonly CardDefinition[],
  factionName = "This faction"
): string[] {
  const rule = faction.setup.startingResources;
  const issues: string[] = [];

  if (startingStaplesMustDiffer(rule)) {
    const kinds = new Set<string>();
    for (const definition of deckCardDefs) {
      if (isStapleResourceDefinition(definition)) kinds.add(definition.name.toLowerCase());
    }
    if (kinds.size < rule.count) {
      issues.push(
        `${factionName} starts with ${rule.count} different staple resources, ` +
          `but the deck has only ${kinds.size} kind${kinds.size === 1 ? "" : "s"} of staple resource.`
      );
    }
  }

  // Narrowest need first, so a lone Deception is never reported as the card the
  // deck is missing when it is the staple that is short.
  const rank = (need: StartingNeed): number => (need.kind === "resource" && need.name ? 0 : 1);
  const needs = deckStartingNeeds(rule)
    .filter(isRequiredNeed)
    .sort((a, b) => rank(a) - rank(b));
  const pool = deckCardDefs.filter(definition => definition.type !== "faction");
  const picks = assignStartingNeeds(needs, pool, definition => definition);
  const missing = needs.filter((_, index) => picks[index] === undefined);
  if (missing.length > 0) {
    issues.push(
      `${factionName} starts the game with ${listNeeds(needs)} from its deck, ` +
        `but the deck is missing ${listNeeds(missing)}.`
    );
  }
  return issues;
}


function resolveFactionAndDeck(
  definitions: Record<CardDefinitionId, CardDefinition>,
  setup: FactionPlayerSetup
): { factionDefinition: CardDefinition; deckDefinitionIds: CardDefinitionId[] } {
  const explicit = setup.factionDefinitionId
    ? definitions[setup.factionDefinitionId]
    : undefined;

  if (setup.factionDefinitionId) {
    assert(explicit, `Faction '${setup.factionDefinitionId}' was not found.`);
    assert(explicit.type === "faction", `'${explicit.name}' is not a faction card.`);
  }

  const factionCandidates = setup.deckDefinitionIds
    .map(id => definitions[id])
    .filter((definition): definition is CardDefinition => definition?.type === "faction");

  const factionDefinition = explicit ?? factionCandidates[0];

  assert(factionDefinition, `Player '${setup.id}' has no faction card.`);
  assert(
    explicit || factionCandidates.length === 1,
    `Player '${setup.id}' must have exactly one faction card.`
  );

  const normalizedFaction = withBuiltInFactionDefaults(factionDefinition);
  assert(
    normalizedFaction.faction,
    `Faction '${normalizedFaction.name}' is missing its faction configuration.`
  );

  let removedFaction = false;
  const deckDefinitionIds = setup.deckDefinitionIds.filter(id => {
    if (!removedFaction && id === factionDefinition.id) {
      removedFaction = true;
      return false;
    }
    return true;
  });

  for (const id of deckDefinitionIds) {
    assert(definitions[id], `Deck references missing card '${id}'.`);
  }

  return {
    factionDefinition: normalizedFaction,
    deckDefinitionIds
  };
}

function moveSetupCardToPlay(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  faceDown = false
): void {
  const player = state.players[playerId];
  const card = state.cards[cardId];

  player.deck = player.deck.filter(id => id !== cardId);
  card.zone = "play";
  card.faceDown = faceDown;
  card.attachedTo = undefined;
  player.play.push(cardId);
}

interface StartingResourcePick {
  cardId: CardInstanceId;
  faceDown: boolean;
}

/**
 * The cards `playerId` puts into play at setup as starting resources.
 * Handles the flat `{ count, names?, stapleOnly? }` form and the two
 * expressive forms — `slots` (a specific-vs-any per-slot program; The
 * Society of Magical Propriety) and `chosenStaples` (a setup-chosen count
 * of staples plus fixed extras; The Union of Unextraordinary Miners). Cards
 * are drawn in deck order (the deck is still unshuffled here), matching how
 * the flat form has always picked.
 */
function chooseStartingResources(
  engine: SpoilsEngine,
  playerId: PlayerId,
  rule: FactionDefinition["setup"]["startingResources"],
  chosenX?: number
): StartingResourcePick[] {
  const player = engine.state.players[playerId];

  // Every slot of a `slots` program or `chosenStaples` rule takes its own
  // card (see `assignStartingNeeds`); the picks come back in slot order. A need
  // the deck cannot meet stops setup if `isRequiredNeed`; any other slot ("Any 1
  // resource", "Any 1 card") is a search that may find fewer (CR 312.2), carried
  // out as far as possible (CR 402.5): the slot stays empty.
  const placeNeeds = (needs: StartingNeed[]): StartingResourcePick[] => {
    const picks = assignStartingNeeds(needs, player.deck, id => engine.getDefinition(id));
    const placed: StartingResourcePick[] = [];
    needs.forEach((need, index) => {
      const cardId = picks[index];
      if (cardId === undefined) {
        assert(
          !isRequiredNeed(need),
          `Faction setup: no matching starting resource${need.kind === "resource" && need.name ? ` '${need.name}'` : ""} for '${playerId}'.`
        );
        return;
      }
      placed.push({
        cardId,
        faceDown:
          need.kind === "anyCard" ? engine.getDefinition(cardId).type !== "resource" : (need.faceDown ?? false)
      });
    });
    return placed;
  };

  if (rule.slots?.length) return placeNeeds(startingNeeds(rule));

  if (rule.chosenStaples) {
    // "Choose a number for X": the player's X, clamped to the allowed range and
    // to the staples the deck has left once the named extras have theirs (never
    // below the smallest X, which the deck must be able to supply).
    const { min, max } = rule.chosenStaples;
    const requested = Math.max(min, Math.min(max, Math.floor(chosenX ?? min)));
    return placeNeeds(
      startingNeeds(rule, Math.max(min, Math.min(requested, chosenStapleSupply(engine, playerId, rule))))
    );
  }

  // Flat form — unchanged: `names` is a membership filter, `count` the quantity.
  const names = rule.names?.map(name => name.toLowerCase());
  const candidates = player.deck.filter(cardId => {
    const definition = engine.getDefinition(cardId);
    if (definition.type !== "resource") return false;
    if (names?.length && !names.includes(definition.name.toLowerCase())) return false;
    if (rule.stapleOnly && !isStapleResourceDefinition(definition)) return false;
    return true;
  });

  // A search with specific criteria may find fewer than asked (CR 312.2), and
  // an instruction that can't be fully carried out is carried out as far as
  // possible (CR 402.5): start with the resources the deck has.

  if (startingStaplesMustDiffer(rule)) {
    // "Any N different staple resources" (Unlikely Heroes — `distinctStaples`)
    // — take distinct kinds in deck order, only repeating a kind if the deck
    // doesn't run enough of them to fill every slot.
    const picked: CardInstanceId[] = [];
    const seenDefs = new Set<CardDefinitionId>();
    for (const cardId of candidates) {
      if (picked.length === rule.count) break;
      const defId = engine.getDefinition(cardId).id;
      if (seenDefs.has(defId)) continue;
      seenDefs.add(defId);
      picked.push(cardId);
    }
    for (const cardId of candidates) {
      if (picked.length === rule.count) break;
      if (!picked.includes(cardId)) picked.push(cardId);
    }
    return picked.map(cardId => ({ cardId, faceDown: false }));
  }

  return candidates.slice(0, rule.count).map(cardId => ({ cardId, faceDown: false }));
}

function drawSetupCards(state: GameState, playerId: PlayerId, count: number): void {
  const player = state.players[playerId];
  const drawn = player.deck.splice(0, count);

  for (const cardId of drawn) {
    state.cards[cardId].zone = "hand";
    player.hand.push(cardId);
  }
}

/** Distinct staple-resource card definitions among the cards still in `playerId`'s deck. */
function distinctStapleDefsInDeck(engine: SpoilsEngine, playerId: PlayerId): Set<CardDefinitionId> {
  const seen = new Set<CardDefinitionId>();
  for (const cardId of engine.state.players[playerId].deck) {
    const definition = engine.getDefinition(cardId);
    if (isStapleResourceDefinition(definition)) seen.add(definition.id);
  }
  return seen;
}

type StartingSlotRule = NonNullable<FactionDefinition["setup"]["startingResources"]["slots"]>;

const isRequiredSlot = (slot: StartingSlotRule[number]): boolean =>
  slot.kind === "resource" && Boolean(slot.name || slot.staple);

/** One slot of a `slots` starting-resource program, resolved against a player's deck. */
export interface StartingSlotPlan {
  /** Index into the faction's `slots` array. */
  slotIndex: number;
  kind: "staple" | "resource" | "anyCard";
  /** Fixed slots only: the card the named slot takes (the first match in deck order). */
  cardId?: CardInstanceId;
  /** Free slots only: the deck cards the player may pick for this slot. */
  candidates: CardInstanceId[];
  faceDown?: boolean;
}

/**
 * Splits a `slots` starting-resource program for `playerId` into FIXED slots
 * (a named resource: "1 Obsession" — the first match in deck order is taken)
 * and FREE slots the player picks themselves ("1 staple resource", "Any 1
 * resource", "Any 1 card"). Named slots reserve their card first, so the free
 * slots' candidates never include it. Returns `fixedMissing: true` when a
 * named slot has no card in the deck (the deck-order path then reports it).
 */
export function startingSlotPlan(
  engine: SpoilsEngine,
  playerId: PlayerId,
  slots: StartingSlotRule
): { slots: StartingSlotPlan[]; fixedMissing: boolean } {
  const deck = engine.state.players[playerId].deck;
  const reserved = new Set<CardInstanceId>();
  let fixedMissing = false;
  const plan: StartingSlotPlan[] = [];

  slots.forEach((slot, slotIndex) => {
    if (slot.kind === "resource" && slot.name) {
      const name = slot.name.toLowerCase();
      const cardId = deck.find(id => {
        if (reserved.has(id)) return false;
        const definition = engine.getDefinition(id);
        if (definition.type !== "resource" || definition.name.toLowerCase() !== name) return false;
        return !slot.staple || isStapleResourceDefinition(definition);
      });
      if (!cardId) fixedMissing = true;
      else reserved.add(cardId);
      plan.push({ slotIndex, kind: "resource", cardId, candidates: [], faceDown: slot.faceDown });
    }
  });

  slots.forEach((slot, slotIndex) => {
    if (slot.kind === "resource" && slot.name) return;
    const candidates = deck.filter(id => {
      if (reserved.has(id)) return false;
      const definition = engine.getDefinition(id);
      if (slot.kind === "anyCard") return true;
      if (definition.type !== "resource") return false;
      return !slot.staple || isStapleResourceDefinition(definition);
    });
    plan.push({
      slotIndex,
      kind: slot.kind === "anyCard" ? "anyCard" : slot.staple ? "staple" : "resource",
      candidates,
      faceDown: slot.kind === "resource" ? slot.faceDown : undefined
    });
  });

  // An "Any 1 resource" / "Any 1 card" slot the deck has no card left for
  // (CR 312.2: a search may find nothing) is not offered: the player picks only
  // slots they can fill.
  const fillable = assignStartingNeeds(
    startingNeeds({ count: slots.length, slots }),
    deck,
    id => engine.getDefinition(id)
  );
  const offered = plan.filter(
    entry => entry.cardId !== undefined || fillable[entry.slotIndex] !== undefined || isRequiredSlot(slots[entry.slotIndex]!)
  );
  offered.sort((a, b) => a.slotIndex - b.slotIndex);
  return { slots: offered, fixedMissing };
}

/**
 * The cards of `playerId`'s deck a `chosenStaples` rule's named extras ("...and 1
 * Deception") cannot do without: the only card that can be that extra. The
 * player's X staples must not take one, so they are not offered as a choice.
 */
export function requiredStartingCards(
  engine: SpoilsEngine,
  playerId: PlayerId,
  rule: StartingRule
): CardInstanceId[] {
  const deck = engine.state.players[playerId].deck;
  const named = namedStartingNeeds(rule);
  const definitionOf = (id: CardInstanceId) => engine.getDefinition(id);
  const taken = assignStartingNeeds(named, deck, definitionOf).filter((id): id is CardInstanceId => id !== undefined);
  return taken.filter(id => {
    const without = assignStartingNeeds(named, deck.filter(other => other !== id), definitionOf);
    return without.filter(pick => pick !== undefined).length < taken.length;
  });
}

/**
 * How many staples of `playerId`'s deck a `chosenStaples` rule can take for X:
 * the staples in the deck, less those the named extras ("...and 1 Deception")
 * use, since a named extra and an X staple are different cards. Taking more
 * would leave a named extra without its card.
 */
function chosenStapleSupply(engine: SpoilsEngine, playerId: PlayerId, rule: StartingRule): number {
  const deck = engine.state.players[playerId].deck;
  const named = namedStartingNeeds(rule);
  const taken = new Set(assignStartingNeeds(named, deck, id => engine.getDefinition(id)));
  return deck.filter(id => !taken.has(id) && isStapleResourceDefinition(engine.getDefinition(id))).length;
}

/**
 * How many staples `playerId` gets to *pick* at setup — a number when their
 * faction chooses staples freely (the flat `{ count, stapleOnly }` form, or
 * `chosenStaples`) AND their deck runs more than one kind of staple, so the
 * choice is real. `null` otherwise: the deck-order pick in
 * {@link chooseStartingResources} is the only sensible outcome and no
 * interactive phase is needed.
 */
function stapleChoiceCountFor(
  engine: SpoilsEngine,
  playerId: PlayerId,
  rule: FactionDefinition["setup"]["startingResources"],
  chosenX: number | undefined
): number | null {
  let count: number;
  let available: number | undefined;
  if (rule.slots?.length) {
    // A `slots` program: the player picks the free slots ("1 staple resource",
    // "Any 1 resource", "Any 1 card"); named slots ("1 Obsession") stay fixed.
    const plan = startingSlotPlan(engine, playerId, rule.slots);
    if (plan.fixedMissing) return null;
    const free = plan.slots.filter(slot => slot.cardId === undefined);
    const real = free.some(
      slot => new Set(slot.candidates.map(id => engine.getDefinition(id).id)).size >= 2
    );
    return free.length > 0 && real ? free.length : null;
  } else if (rule.chosenStaples) {
    const { min, max } = rule.chosenStaples;
    count = Math.max(min, Math.min(max, Math.floor(chosenX ?? min)));
    available = chosenStapleSupply(engine, playerId, rule);
  } else if (rule.stapleOnly && !rule.names?.length && !rule.slots?.length) {
    count = rule.count;
  } else {
    return null;
  }

  if (count < 1) return null;
  if (distinctStapleDefsInDeck(engine, playerId).size < 2) return null;

  available ??= engine.state.players[playerId].deck.filter(cardId =>
    isStapleResourceDefinition(engine.getDefinition(cardId))
  ).length;
  return available >= count ? count : null;
}

/**
 * Creates a complete game for two or more players using faction-defined setup
 * rules (MPX-setup). `players` is the seat order, clockwise; every player's
 * faction is in play and every player's starting resources are placed.
 *
 * Resulting flow for The Tournament Faction:
 *   faction enters play
 *   -> find 2 staple resources and put them in play
 *   -> (option `chooseFirstPlayer`) a random player chosen from all of them decides who goes first
 *   -> shuffle
 *   -> the first player draws 8, every other player 9
 *   -> mulligan decisions clockwise from the first player
 *   -> start turn 1
 */
export function createFactionGame(
  definitionsInput: CardDefinition[],
  gameOptions: FactionGameOptions
): SpoilsEngine {
  const { players, ...options } = gameOptions;
  assert(players.length >= 2, "A game needs at least two players.");
  assert(new Set(players.map(player => player.id)).size === players.length, "Every player needs a distinct id.");

  const normalizedDefinitions = definitionsInput.map(withBuiltInFactionDefaults);
  const definitions = Object.fromEntries(
    normalizedDefinitions.map(definition => [definition.id, definition])
  ) as Record<CardDefinitionId, CardDefinition>;

  const firstPlayerId = options.firstPlayerId ?? players[0].id;
  assert(
    players.some(player => player.id === firstPlayerId),
    "firstPlayerId must identify one of the players."
  );

  const resolved = players.map(player => resolveFactionAndDeck(definitions, player));

  // "(Other side starts face-up.)" — start on the flipped side when its
  // definition is registered (`faction.setup.startsFlipped`).
  for (const entry of resolved) {
    const faction = entry.factionDefinition.faction;
    const flipped = faction?.setup.startsFlipped && faction.flipsTo ? definitions[faction.flipsTo] : undefined;
    if (flipped?.faction) entry.factionDefinition = flipped;
  }

  // Instance ids are numbered per game (`card_1`, `card_2`, ...), never from
  // the process-global counter: the same decks + seed must always yield the
  // same ids, or a recorded action log ("mulligan card_37") stops matching
  // the moment the game is rebuilt anywhere else — a page reload, the other
  // peer of a networked match, the server's authoritative copy, a replay.
  let instanceSeq = 0;
  const mintCardId = (): CardInstanceId => `card_${++instanceSeq}`;

  const factionCards = players.map((player, seat) =>
    createCardInstance(resolved[seat]!.factionDefinition.id, player.id, "play", mintCardId())
  );
  const deckCards = players.map((player, seat) =>
    resolved[seat]!.deckDefinitionIds.map(id => createCardInstance(id, player.id, "deck", mintCardId()))
  );

  const state = createGame(
    players.map(player => ({ id: player.id, name: player.name, influence: 0 })),
    players.flatMap((_, seat) => [factionCards[seat]!, ...deckCards[seat]!])
  );

  state.turn = 1;
  state.activePlayerId = firstPlayerId;
  state.priorityPlayerId = firstPlayerId;
  state.started = false;
  if (options.seed !== undefined) {
    state.rngState = options.seed >>> 0;
  }
  if (options.chooseFirstPlayer && options.firstPlayerId === undefined) {
    state.decideFirstPlayer = true;
  }

  players.forEach((player, seat) => {
    state.players[player.id].factionId = factionCards[seat]!.id;
    state.players[player.id].influence = resolved[seat]!.factionDefinition.faction!.startingInfluence;
  });

  const engine = new SpoilsEngine(normalizedDefinitions, state, undefined, options.cardCatalog);
  if (options.createdAbility) engine.applyCreatedFactionAbility(options.createdAbility);

  // MONEY FOR NOTHING's "your opponent" is selected by its controller as the starting resources step begins
  // (MP 2, MPX-select (2)): each such player with two or more opponents is asked before any starting resource is
  // placed, clockwise from the first player; with a single opponent it is that player and nobody is asked.
  const startingOptions: StartingResourceOptions = {
    chooseStartingResources: options.chooseStartingResources === true,
    ...(options.startingResourceX ? { startingResourceX: options.startingResourceX } : {})
  };
  const askers = engine
    .getPlayersInSeatOrder(firstPlayerId)
    .filter(playerId => needsMatchOpponent(engine, playerId));
  if (askers.length > 0) {
    state.setup = {
      phase: "chooseMatchOpponent",
      order: askers,
      currentIndex: 0,
      matchOpponents: {},
      ...(startingOptions.chooseStartingResources ? { chooseStartingResources: true } : {}),
      ...(startingOptions.startingResourceX ? { startingResourceX: startingOptions.startingResourceX } : {})
    };
    promptMatchOpponent(engine, askers[0]!);
    return engine;
  }

  placeStartingResources(engine, startingOptions, {});
  return engine;
}

/** The setup options the starting-resources step needs once any opponent selections are in. */
interface StartingResourceOptions {
  chooseStartingResources: boolean;
  startingResourceX?: Record<PlayerId, number>;
}

/** Whether `playerId`'s faction names "your opponent" in its starting resources and has two or more opponents to choose from. */
function needsMatchOpponent(engine: SpoilsEngine, playerId: PlayerId): boolean {
  return (
    !!engine.getFactionDefinition(playerId)?.setup.startingResources.matchOpponentCount &&
    engine.getOpponents(playerId).length >= 2
  );
}

function promptMatchOpponent(engine: SpoilsEngine, playerId: PlayerId): void {
  engine.state.pendingChoice = {
    kind: "choosePlayer",
    id: `matchOpponent_${playerId}`,
    playerId,
    candidates: engine.getOpponents(playerId),
    sourceId: engine.state.players[playerId].factionId!,
    bind: { type: "matchOpponent" }
  };
}

/**
 * A `matchOpponent` answer: `chosen` is `playerId`'s opponent for MONEY FOR NOTHING. Asks the next player who has a
 * selection to make, or goes on to place the starting resources once the last one is in.
 */
export function answerMatchOpponent(engine: SpoilsEngine, playerId: PlayerId, chosen: PlayerId): void {
  const setup = engine.state.setup;
  assert(setup.phase === "chooseMatchOpponent", "No opponent selection is being made.");
  assert(setup.order[setup.currentIndex] === playerId, "It is not this player's opponent selection.");
  setup.matchOpponents[playerId] = chosen;
  setup.currentIndex++;
  if (setup.currentIndex < setup.order.length) {
    promptMatchOpponent(engine, setup.order[setup.currentIndex]!);
    return;
  }
  placeStartingResources(
    engine,
    {
      chooseStartingResources: setup.chooseStartingResources === true,
      ...(setup.startingResourceX ? { startingResourceX: setup.startingResourceX } : {})
    },
    setup.matchOpponents
  );
}

/**
 * The starting resources step (CR 601.1b): every player's starting resources go in play, clockwise from the first
 * player, then the rest of setup runs (`finishFactionSetup`) — directly when no player has a staple choice, or once the
 * last `chooseStartingResources` action is answered.
 */
function placeStartingResources(
  engine: SpoilsEngine,
  options: StartingResourceOptions,
  matchOpponents: Record<PlayerId, PlayerId>
): void {
  const state = engine.state;
  const matchOpponentsField = Object.keys(matchOpponents).length > 0 ? { matchOpponents } : {};

  // Prompts and placements run clockwise from the first player.
  const clockwise = engine.getPlayersInSeatOrder(state.activePlayerId);

  const choosers: Array<{ playerId: PlayerId; count: number }> = [];
  for (const playerId of state.seats) {
    const rule = engine.getFactionDefinition(playerId)!.setup.startingResources;
    const chosenX = options.startingResourceX?.[playerId];
    const choiceCount = options.chooseStartingResources
      ? stapleChoiceCountFor(engine, playerId, rule, chosenX)
      : null;

    if (choiceCount !== null) {
      // This player picks which staples they start with — deferred to the
      // `chooseStartingResources` phase below.
      choosers.push({ playerId, count: choiceCount });
      continue;
    }

    // No real choice (one staple kind, or a name-pinned faction) — place the
    // starting resources now, in deck order, exactly as setup always has.
    for (const pick of chooseStartingResources(engine, playerId, rule, chosenX)) {
      moveSetupCardToPlay(state, playerId, pick.cardId, pick.faceDown);
    }
  }

  if (choosers.length === 0) {
    finishFactionSetup(engine, options.chooseStartingResources, matchOpponents);
    return;
  }

  // Hand off to the interactive phase: each `order` seat dispatches a
  // `chooseStartingResources` action, and the engine calls
  // `finishFactionSetup` once the last one is in (matchOpponentCount top-up,
  // shuffle, opening hands, mulligan / turn 1). Nothing is shuffled or drawn
  // until then.
  const order = clockwise.filter(id => choosers.some(chooser => chooser.playerId === id));
  const counts: Record<PlayerId, number> = {};
  for (const chooser of choosers) counts[chooser.playerId] = chooser.count;

  state.setup = {
    phase: "chooseStartingResources",
    order,
    currentIndex: 0,
    counts,
    ...(options.chooseStartingResources ? { askStartingDrawSearch: true } : {}),
    ...matchOpponentsField
  };
}

/** A two-seat game: `createFactionGame` with `playerA` in the first seat and `playerB` in the second. */
export function createTwoPlayerFactionGame(
  definitionsInput: CardDefinition[],
  playerA: FactionPlayerSetup,
  playerB: FactionPlayerSetup,
  options: FactionGameSetupOptions = {}
): SpoilsEngine {
  return createFactionGame(definitionsInput, { ...options, players: [playerA, playerB] });
}

/**
 * The faction whose STARTING DRAW rule governs `playerId`: its own, unless an
 * opponent's faction makes every opponent "ignore their faction's STARTING DRAW
 * rule and use this card's rule instead" (The Knitting Coalition — HIDDEN
 * INFLUENCE; "your opponent" there means every opponent, RQ-mp-6). With several
 * such opponents the first clockwise from `playerId` governs.
 */
function startingDrawFaction(engine: SpoilsEngine, playerId: PlayerId): FactionDefinition | undefined {
  for (const opponentId of engine.getOpponents(playerId)) {
    const opponentFaction = engine.getFactionDefinition(opponentId);
    if (opponentFaction?.overridesOpponent?.startingDraw) return opponentFaction;
  }
  return engine.getFactionDefinition(playerId);
}

/** The STARTING DRAW search that governs `playerId` (see {@link startingDrawFaction}; an overriding faction has none). */
function governingStartingDrawSearch(engine: SpoilsEngine, playerId: PlayerId) {
  return startingDrawFaction(engine, playerId)?.setup.startingDrawSearch;
}

/**
 * `FactionDefinition.setup.startingDrawSearch` — the first card in deck
 * order matching `selector` whose `CardDefinitionId` differs from every
 * starting resource `playerId` just placed goes to hand. No-op if the
 * faction carries no such rule, or nothing in the deck matches.
 */
function applyStartingDrawSearch(engine: SpoilsEngine, playerId: PlayerId): void {
  const search = governingStartingDrawSearch(engine, playerId);
  if (!search) return;

  const state = engine.state;
  const player = state.players[playerId];
  const placedDefinitionIds = new Set(
    player.play
      .filter(cardId => engine.getDefinition(cardId).type === "resource")
      .map(cardId => engine.getDefinition(cardId).id)
  );

  const context: ResolutionContext = {
    sourceId: player.factionId!,
    controllerId: playerId,
    selected: {}
  };

  const candidateId = engine
    .queryCards(search.selector, context)
    .map(card => card.id)
    .find(cardId => !placedDefinitionIds.has(engine.getDefinition(cardId).id));

  if (!candidateId) return;

  if (search.reveal) {
    engine.emit({
      type: "cardsRevealed",
      cardIds: [candidateId],
      zone: "deck",
      ownerId: playerId,
      viewerId: "all",
      byCardId: player.factionId,
      knownToRevealer: true
    });
  }

  player.deck = player.deck.filter(id => id !== candidateId);
  state.cards[candidateId].zone = "hand";
  player.hand.push(candidateId);
}

/**
 * The rest of faction setup once every player's starting resources are in
 * play — MONEY FOR NOTHING's staple top-up, the deck shuffles, opening-hand
 * draws (honouring The Knitting Coalition's STARTING DRAW override), then
 * either the mulligan step or straight into turn 1.
 *
 * Called by {@link createFactionGame} directly when no player has a
 * starting-resource choice, or by the engine once the last
 * `chooseStartingResources` action has been answered.
 */
export function finishFactionSetup(
  engine: SpoilsEngine,
  askSearch = false,
  matchOpponents: Readonly<Record<PlayerId, PlayerId>> = {}
): void {
  const state = engine.state;
  // Seat order, so the RNG stream is consumed exactly as in a game with no
  // starting-resource choice.
  const playerIds = [...state.seats];

  const startingResourceCounts: Record<PlayerId, number> = {};
  for (const playerId of playerIds) {
    startingResourceCounts[playerId] = state.players[playerId].play.filter(
      cardId => engine.getDefinition(cardId).type === "resource"
    ).length;
  }

  // "...enough staple resources so that both players have the same number of
  // starting resources." (The Union of Unextraordinary Miners — MONEY FOR
  // NOTHING): the player and their one chosen opponent (`matchOpponents`, or
  // the only opponent). Done before the shuffle, like every other setup placement.
  for (const playerId of playerIds) {
    if (!engine.getFactionDefinition(playerId)?.setup.startingResources.matchOpponentCount) {
      continue;
    }
    const opponentId = matchOpponents[playerId] ?? engine.getOpponents(playerId)[0]!;
    const deficit = startingResourceCounts[playerId] - startingResourceCounts[opponentId];
    // The extra staples are an ordinary "N staple resources" pick: when the
    // setup phase is interactive and the opponent's deck runs several kinds,
    // their owner chooses them (a second `chooseStartingResources` round).
    if (
      askSearch &&
      deficit > 0 &&
      distinctStapleDefsInDeck(engine, opponentId).size >= 2 &&
      state.players[opponentId].deck.filter(id => isStapleResourceDefinition(engine.getDefinition(id))).length >= deficit
    ) {
      state.setup = {
        phase: "chooseStartingResources",
        order: [opponentId],
        currentIndex: 0,
        counts: { [opponentId]: deficit },
        topUp: true,
        askStartingDrawSearch: true,
        ...(Object.keys(matchOpponents).length > 0 ? { matchOpponents: { ...matchOpponents } } : {})
      };
      return;
    }
    for (let i = 0; i < deficit; i++) {
      const [extra] = chooseStartingResources(engine, opponentId, {
        count: 1,
        stapleOnly: true
      });
      // An opponent deck with no staple left can't be topped up further
      // (carried out as far as possible, CR 402.5).
      if (!extra) break;
      moveSetupCardToPlay(state, opponentId, extra.cardId, false);
      startingResourceCounts[opponentId] += 1;
    }
  }

  // CR 601.1c: "Randomly determine which player will decide who takes the
  // first turn of the game. That player chooses who goes first." Every
  // starting resource is in play by now; the rest of setup waits for the
  // `chooseFirstPlayer` answer (`continueSetupAfterFirstPlayer`).
  if (state.decideFirstPlayer) {
    delete state.decideFirstPlayer;
    const deciderId = playerIds[Math.floor(drawRandom(state) * playerIds.length)]!;
    state.setup = {
      phase: "chooseFirstPlayer",
      order: [deciderId],
      currentIndex: 0,
      ...(askSearch ? { askStartingDrawSearch: true } : {})
    };
    engine.emit({ type: "firstPlayerDecider", playerId: deciderId });
    return;
  }
  continueSetupAfterFirstPlayer(engine, askSearch);
}

/**
 * Setup from the STARTING DRAW on (CR 601.1e): the STARTING DRAW search, then
 * the shuffles, opening hands and the mulligan step or turn 1. Run by
 * {@link finishFactionSetup}, or by the engine once the `chooseFirstPlayer`
 * answer is in (`state.activePlayerId` is the first player by then).
 */
export function continueSetupAfterFirstPlayer(engine: SpoilsEngine, askSearch: boolean): void {
  const state = engine.state;
  const playerIds = [...state.seats];
  const firstPlayerId = state.activePlayerId;

  // "You may search your deck for [a resource] that is not any of your
  // starting resources, reveal it and put it into your hand." (Unlikely
  // Heroes) — before the shuffle, like every other setup placement.
  if (askSearch) {
    // Interactive setup: each searching seat is asked (and may decline); the
    // rest of setup runs once the last answer is in (`continueStartingDrawSearch`).
    const order = engine
      .getPlayersInSeatOrder(firstPlayerId)
      .filter(playerId => startingDrawSearchCandidates(engine, playerId).length > 0);
    if (order.length > 0) {
      state.setup = { phase: "startingDrawSearch", order, currentIndex: 0 };
      promptStartingDrawSearch(engine, order[0]);
      return;
    }
  } else {
    for (const playerId of playerIds) {
      applyStartingDrawSearch(engine, playerId);
    }
  }
  finishFactionSetupAfterSearch(engine);
}

/** After a `startingDrawSearch` answer: ask the next seat, or finish setup. */
export function continueStartingDrawSearch(engine: SpoilsEngine): void {
  const setup = engine.state.setup;
  if (setup.phase !== "startingDrawSearch") return;
  setup.currentIndex++;
  if (setup.currentIndex < setup.order.length) {
    promptStartingDrawSearch(engine, setup.order[setup.currentIndex]);
    return;
  }
  finishFactionSetupAfterSearch(engine);
}

/** The deck cards a faction's STARTING DRAW search may take: its selector, minus any card like a starting resource. */
function startingDrawSearchCandidates(engine: SpoilsEngine, playerId: PlayerId): CardInstanceId[] {
  const search = governingStartingDrawSearch(engine, playerId);
  if (!search) return [];
  const player = engine.state.players[playerId];
  const placedDefinitionIds = new Set(
    player.play
      .filter(cardId => engine.getDefinition(cardId).type === "resource")
      .map(cardId => engine.getDefinition(cardId).id)
  );
  return engine
    .queryCards(search.selector, { sourceId: player.factionId!, controllerId: playerId, selected: {} })
    .map(card => card.id)
    .filter(cardId => !placedDefinitionIds.has(engine.getDefinition(cardId).id));
}

function promptStartingDrawSearch(engine: SpoilsEngine, playerId: PlayerId): void {
  const search = governingStartingDrawSearch(engine, playerId)!;
  const player = engine.state.players[playerId];
  const startingNames = [
    ...new Set(
      player.play
        .filter(cardId => engine.getDefinition(cardId).type === "resource")
        .map(cardId => engine.getDefinition(cardId).name)
    )
  ];
  const pick = { type: "selected" as const, id: "startingDrawSearch" };
  engine.state.pendingChoice = {
    kind: "chooserSelectsTarget",
    id: `startingDrawSearch_${playerId}`,
    playerId,
    declaration: {
      id: "startingDrawSearch",
      selector: {
        ...search.selector,
        conditions: [
          ...(search.selector.conditions ?? []),
          ...startingNames.map(name => ({
            type: "not" as const,
            condition: { type: "cardNameIs" as const, target: { type: "selected" as const, id: "__candidate" }, name }
          }))
        ]
      },
      count: 1,
      optional: true
    },
    effects: [
      ...(search.reveal ? [{ type: "revealCards" as const, selected: "startingDrawSearch", viewer: "all" as const }] : []),
      { type: "moveCard" as const, target: pick, to: "hand" as const }
    ],
    context: { sourceId: player.factionId!, controllerId: playerId, selected: {} }
  };
}

/**
 * How many cards `playerId` draws for their opening hand (MPX-draw): the
 * "going first" number for the first player, the "going second" number for every
 * other player, whatever their seat. The rule is their faction's STARTING DRAW,
 * or the one an opponent faction imposes: "Your opponent ignores their faction's
 * STARTING DRAW rule and uses this card's rule instead." (The Knitting Coalition
 * — HIDDEN INFLUENCE, which applies to every opponent).
 */
export function openingDrawFor(engine: SpoilsEngine, playerId: PlayerId, goingFirst: boolean): number {
  const handRule = startingDrawFaction(engine, playerId)!.setup.openingHand;
  return goingFirst ? handRule.goingFirst : handRule.goingSecond;
}

/** Everything after the STARTING DRAW search: shuffles, opening hands, then the mulligan step or turn 1. */
function finishFactionSetupAfterSearch(engine: SpoilsEngine): void {
  const state = engine.state;
  const playerIds = [...state.seats];
  const firstPlayerId = state.activePlayerId;

  const random = () => drawRandom(state);
  for (const playerId of playerIds) {
    shuffleInPlace(state.players[playerId].deck, random);
  }

  for (const playerId of playerIds) {
    drawSetupCards(state, playerId, openingDrawFor(engine, playerId, playerId === firstPlayerId));
  }

  // Each player in turn, clockwise from the first player (CR 601.1g).
  const mulliganOrder = engine.getPlayersInSeatOrder(firstPlayerId).filter(playerId => {
    const faction = engine.getFactionDefinition(playerId);
    return (faction?.setup.mulligan?.count ?? 0) > 0;
  });

  if (mulliganOrder.length) {
    state.setup = { phase: "mulligan", order: mulliganOrder, currentIndex: 0 };
  } else {
    state.setup = { phase: "complete" };
    engine.startGameAfterSetup();
  }
}
