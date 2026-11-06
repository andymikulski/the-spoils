// -----------------------------------------------------------------------------
// Faction-driven game setup
// -----------------------------------------------------------------------------

import type {
  CardCatalogEntry,
  CardDefinition,
  CardDefinitionId,
  CardInstance,
  CardInstanceId,
  CreatedAbilitySpec,
  FactionDefinition,
  GameFormat,
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
import { createCardInstance, createGame, resolveGameFormat } from "./setup.js";
import { opponentsOf, seatsFrom } from "./seating.js";
import { dealAllegiance, defaultAllegianceDeck } from "./showdown.js";
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
  /**
   * The table format. Defaults to `classic` for two seats and `freeForAll`
   * for more (see `GameFormat`).
   */
  format?: GameFormat;
  /**
   * The shared Showdown table (format `showdown` only): the Hero Deck every
   * Hero reaches through effects (SD 3), shuffled at setup, and the shared
   * faction every Hero may use — Slightly Less Evil Alliance (SD 5).
   */
  showdown?: {
    heroDeck: CardDefinitionId[];
    sharedFactionDefinitionId?: CardDefinitionId;
  };
  /** Who takes the first turn, already decided by the caller. Wins over `chooseFirstPlayer`. */
  firstPlayerId?: PlayerId;
  /**
   * CR 601.1c in the engine: once the starting resources are in play, the
   * game's RNG picks which player decides who goes first, and setup pauses
   * in the `chooseFirstPlayer` phase for that player's `chooseFirstPlayer`
   * action. Ignored when `firstPlayerId` is given. Off by default: player A
   * (or `firstPlayerId`) goes first and no random draw is made.
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

/**
 * Deck-legality check for a faction's STARTING RESOURCES rule (rules answer
 * Q45). A faction that needs N DIFFERENT staple resources ("Any 2 different
 * staple resources" — `distinctStaples`) cannot be satisfied by a deck that
 * holds fewer than N staple kinds. The engine still starts such a game with a
 * duplicate staple as a safety fallback, but the deck should be treated as
 * unplayable so a player can't field their faction illegally. Returns
 * readable issues; an empty list means the deck satisfies the rule.
 *
 * `deckCardDefs` is the deck's card definitions (one entry per copy or one per
 * distinct card, either works). Staple "kinds" are counted by resource name,
 * case-insensitively, so different printings of Rage are one kind.
 */
export function findFactionDeckIssues(
  faction: FactionDefinition,
  deckCardDefs: readonly CardDefinition[],
  factionName = "This faction"
): string[] {
  const rule = faction.setup.startingResources;
  const issues: string[] = [];
  if (!startingStaplesMustDiffer(rule)) return issues;

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
  const used = new Set<CardInstanceId>();

  const takeResource = (opts: { staple?: boolean; name?: string; faceDown?: boolean }): StartingResourcePick => {
    const name = opts.name?.toLowerCase();
    const cardId = player.deck.find(id => {
      if (used.has(id)) return false;
      const definition = engine.getDefinition(id);
      if (definition.type !== "resource") return false;
      if (name && definition.name.toLowerCase() !== name) return false;
      if (opts.staple && !isStapleResourceDefinition(definition)) return false;
      return true;
    });
    assert(
      cardId,
      `Faction setup: no matching starting resource${opts.name ? ` '${opts.name}'` : ""} for '${playerId}'.`
    );
    used.add(cardId);
    return { cardId, faceDown: opts.faceDown ?? false };
  };

  const takeAnyCard = (): StartingResourcePick => {
    const cardId = player.deck.find(id => !used.has(id));
    assert(cardId, `Faction setup: '${playerId}' has no card left for an 'any card' starting slot.`);
    used.add(cardId);
    return { cardId, faceDown: engine.getDefinition(cardId).type !== "resource" };
  };

  if (rule.slots?.length) {
    return rule.slots.map(slot =>
      slot.kind === "resource"
        ? takeResource({ staple: slot.staple, name: slot.name, faceDown: slot.faceDown })
        : takeAnyCard()
    );
  }

  if (rule.chosenStaples) {
    const { min, max, plus } = rule.chosenStaples;
    const x = Math.max(min, Math.min(max, Math.floor(chosenX ?? min)));
    const picks: StartingResourcePick[] = [];
    for (let i = 0; i < x; i++) picks.push(takeResource({ staple: true }));
    for (const name of plus ?? []) picks.push(takeResource({ name }));
    return picks;
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

  plan.sort((a, b) => a.slotIndex - b.slotIndex);
  return { slots: plan, fixedMissing };
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
  } else if (rule.stapleOnly && !rule.names?.length && !rule.slots?.length) {
    count = rule.count;
  } else {
    return null;
  }

  if (count < 1) return null;
  if (distinctStapleDefsInDeck(engine, playerId).size < 2) return null;

  const available = engine.state.players[playerId].deck.filter(cardId =>
    isStapleResourceDefinition(engine.getDefinition(cardId))
  ).length;
  return available >= count ? count : null;
}

/**
 * Creates a complete game using faction-defined setup rules. `players` are
 * the seats in turn order (play passes from each seat to the next); the
 * first player may be any seat (`firstPlayerId`, default the first seat).
 *
 * Resulting flow for The Tournament Faction:
 *   faction enters play
 *   -> find 2 staple resources and put them in play
 *   -> (option `chooseFirstPlayer`) random decider chooses who goes first
 *   -> shuffle
 *   -> first player draws 8, every other seat draws 9
 *   -> mulligan decisions in turn order
 *   -> start turn 1
 */
export function createFactionGame(
  definitionsInput: CardDefinition[],
  players: readonly FactionPlayerSetup[],
  options: FactionGameSetupOptions = {}
): SpoilsEngine {
  const normalizedDefinitions = definitionsInput.map(withBuiltInFactionDefaults);
  const definitions = Object.fromEntries(
    normalizedDefinitions.map(definition => [definition.id, definition])
  ) as Record<CardDefinitionId, CardDefinition>;

  const seatIds = players.map(player => player.id);
  const format = resolveGameFormat(seatIds, options.format);

  const firstPlayerId = options.firstPlayerId ?? seatIds[0];
  assert(seatIds.includes(firstPlayerId), "firstPlayerId must identify one of the seated players.");

  const resolved = players.map(player => resolveFactionAndDeck(definitions, player));

  // "(Other side starts face-up.)" — start on the flipped side when its
  // definition is registered (`faction.setup.startsFlipped`).
  for (const seat of resolved) {
    const faction = seat.factionDefinition.faction;
    const flipped = faction?.setup.startsFlipped && faction.flipsTo ? definitions[faction.flipsTo] : undefined;
    if (flipped?.faction) seat.factionDefinition = flipped;
  }

  // Instance ids are numbered per game (`card_1`, `card_2`, ...), never from
  // the process-global counter: the same decks + seed must always yield the
  // same ids, or a recorded action log ("mulligan card_37") stops matching
  // the moment the game is rebuilt anywhere else — a page reload, the other
  // peer of a networked match, the server's authoritative copy, a replay.
  // Every faction is minted first, then every deck, in seat order.
  let instanceSeq = 0;
  const mintCardId = (): CardInstanceId => `card_${++instanceSeq}`;

  const factions = players.map((player, i) =>
    createCardInstance(resolved[i].factionDefinition.id, player.id, "play", mintCardId())
  );
  const decks = players.map((player, i) =>
    resolved[i].deckDefinitionIds.map(id => createCardInstance(id, player.id, "deck", mintCardId()))
  );

  // Showdown's shared table (SD 3, SD 5): the Hero Deck's cards wait on the
  // table, nominally the Villain's until a Hero claims one; the shared faction
  // sits in play under the Villain, its abilities open to every Hero.
  const showdownTable =
    format.kind === "showdown" ? buildShowdownTable(definitions, format.villainId, options.showdown, mintCardId) : undefined;

  const state = createGame(
    players.map(player => ({ id: player.id, name: player.name, influence: 0 })),
    [
      ...players.flatMap((_, i) => [factions[i], ...decks[i]]),
      ...(showdownTable ? [...showdownTable.heroDeck, ...(showdownTable.sharedFaction ? [showdownTable.sharedFaction] : [])] : [])
    ],
    { format }
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
  if (showdownTable && format.kind === "showdown") {
    // SD 6: each Hero is dealt an Allegiance card at random; the Hero Deck is shuffled.
    const random = () => drawRandom(state);
    const heroDeck = showdownTable.heroDeck.map(card => card.id);
    shuffleInPlace(heroDeck, random);
    state.showdown = {
      allegiance: dealAllegiance(
        seatIds.filter(id => id !== format.villainId),
        format.allegiance ?? defaultAllegianceDeck(seatIds.length - 1),
        random
      ),
      heroDeck,
      temptationPile: [],
      ...(showdownTable.sharedFaction ? { sharedFactionId: showdownTable.sharedFaction.id } : {})
    };
  }

  players.forEach((player, i) => {
    const faction = resolved[i].factionDefinition.faction!;
    state.players[player.id].factionId = factions[i].id;
    // "INFLUENCE = 15+(10*X)", X the opponents at the start (SD-EA 2).
    state.players[player.id].influence =
      faction.startingInfluence + (faction.influencePerOpponent ?? 0) * (state.startingOpponentCounts[player.id] ?? 0);
  });

  const engine = new SpoilsEngine(normalizedDefinitions, state, undefined, options.cardCatalog);
  if (options.createdAbility) engine.applyCreatedFactionAbility(options.createdAbility);

  const choosers: Array<{ playerId: PlayerId; count: number }> = [];
  players.forEach((player, i) => {
    const playerId = player.id;
    const rule = scaledStartingResources(
      resolved[i].factionDefinition.faction!.setup.startingResources,
      state.startingOpponentCounts[playerId] ?? 0
    );
    const chosenX = options.startingResourceX?.[playerId];
    const choiceCount = options.chooseStartingResources
      ? stapleChoiceCountFor(engine, playerId, rule, chosenX)
      : null;

    if (choiceCount !== null) {
      // This player picks which staples they start with — deferred to the
      // `chooseStartingResources` phase below.
      choosers.push({ playerId, count: choiceCount });
      return;
    }

    // No real choice (one staple kind, or a name-pinned faction) — place the
    // starting resources now, in deck order, exactly as setup always has.
    for (const pick of chooseStartingResources(engine, playerId, rule, chosenX)) {
      moveSetupCardToPlay(state, playerId, pick.cardId, pick.faceDown);
    }
  });

  if (choosers.length === 0) {
    finishFactionSetup(engine, options.chooseStartingResources === true);
    return engine;
  }

  // Hand off to the interactive phase: each `order` seat dispatches a
  // `chooseStartingResources` action, and the engine calls
  // `finishFactionSetup` once the last one is in (matchOpponentCount top-up,
  // shuffle, opening hands, mulligan / turn 1). Nothing is shuffled or drawn
  // until then.
  const order = seatsFrom(state, firstPlayerId).filter(id =>
    choosers.some(chooser => chooser.playerId === id)
  );
  const counts: Record<PlayerId, number> = {};
  for (const chooser of choosers) counts[chooser.playerId] = chooser.count;

  state.setup = {
    phase: "chooseStartingResources",
    order,
    currentIndex: 0,
    counts,
    ...(options.chooseStartingResources ? { askStartingDrawSearch: true } : {})
  };

  return engine;
}

/** A STARTING RESOURCES rule with its per-opponent extra folded in ("Any 1+X staple resources", SD-EA 3). */
function scaledStartingResources(
  rule: FactionDefinition["setup"]["startingResources"],
  opponents: number
): FactionDefinition["setup"]["startingResources"] {
  if (!rule.countPerOpponent) return rule;
  return { ...rule, count: rule.count + rule.countPerOpponent * opponents };
}

/** The Showdown table's card instances: the Hero Deck (in the `table` zone) and the shared faction (in play). */
function buildShowdownTable(
  definitions: Record<CardDefinitionId, CardDefinition>,
  villainId: PlayerId,
  table: FactionGameSetupOptions["showdown"],
  mintCardId: () => CardInstanceId
): { heroDeck: CardInstance[]; sharedFaction?: CardInstance } {
  const heroDeck = (table?.heroDeck ?? []).map(id => {
    assert(definitions[id], `Hero Deck references missing card '${id}'.`);
    const card = createCardInstance(id, villainId, "table", mintCardId());
    card.heroCard = true;
    return card;
  });
  const sharedId = table?.sharedFactionDefinitionId;
  if (sharedId !== undefined) {
    assert(definitions[sharedId]?.type === "faction", `The shared faction '${sharedId}' is not a faction card.`);
  }
  return {
    heroDeck,
    ...(sharedId !== undefined ? { sharedFaction: createCardInstance(sharedId, villainId, "play", mintCardId()) } : {})
  };
}

/**
 * The faction whose STARTING DRAW rule governs `playerId`: its own, unless an
 * opponent's faction makes it "ignore their faction's STARTING DRAW rule and
 * use this card's rule instead" (The Knitting Coalition — a standing rule, so
 * it reaches every opponent; the first such opponent in turn order wins).
 */
function governingStartingDrawFaction(engine: SpoilsEngine, playerId: PlayerId): FactionDefinition {
  const overriding = opponentsOf(engine.state, playerId)
    .map(id => engine.getFactionDefinition(id))
    .find(faction => faction?.overridesOpponent?.startingDraw);
  return overriding ?? engine.getFactionDefinition(playerId)!;
}

/** The STARTING DRAW search that governs `playerId` (see {@link governingStartingDrawFaction}). */
function governingStartingDrawSearch(engine: SpoilsEngine, playerId: PlayerId) {
  return governingStartingDrawFaction(engine, playerId).setup.startingDrawSearch;
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
export function finishFactionSetup(engine: SpoilsEngine, askSearch = false): void {
  const state = engine.state;
  // Seat order (`turnOrder`), whoever goes first, so the RNG stream is
  // consumed exactly as in a game with no starting-resource choice.
  const playerIds = state.turnOrder;

  const startingResourceCounts: Record<PlayerId, number> = {};
  for (const playerId of playerIds) {
    startingResourceCounts[playerId] = state.players[playerId].play.filter(
      cardId => engine.getDefinition(cardId).type === "resource"
    ).length;
  }

  // "...enough staple resources so that both players have the same number of
  // starting resources." (The Union of Unextraordinary Miners — MONEY FOR
  // NOTHING; a standing rule, so every opponent is topped up). Done before the
  // shuffle, like every other setup placement.
  for (const playerId of playerIds) {
    if (!engine.getFactionDefinition(playerId)?.setup.startingResources.matchOpponentCount) {
      continue;
    }
    // The extra staples are an ordinary "N staple resources" pick: when the
    // setup phase is interactive and an opponent's deck runs several kinds,
    // its owner chooses them (another `chooseStartingResources` round).
    const choosers: PlayerId[] = [];
    const counts: Record<PlayerId, number> = {};
    for (const opponentId of opponentsOf(state, playerId)) {
      const deficit = startingResourceCounts[playerId] - startingResourceCounts[opponentId];
      if (deficit <= 0) continue;
      if (
        askSearch &&
        distinctStapleDefsInDeck(engine, opponentId).size >= 2 &&
        state.players[opponentId].deck.filter(id => isStapleResourceDefinition(engine.getDefinition(id))).length >= deficit
      ) {
        choosers.push(opponentId);
        counts[opponentId] = deficit;
        continue;
      }
      for (let i = 0; i < deficit; i++) {
        const [extra] = chooseStartingResources(engine, opponentId, {
          count: 1,
          stapleOnly: true
        });
        moveSetupCardToPlay(state, opponentId, extra.cardId, false);
        startingResourceCounts[opponentId] += 1;
      }
    }
    if (choosers.length > 0) {
      state.setup = {
        phase: "chooseStartingResources",
        order: choosers,
        currentIndex: 0,
        counts,
        topUp: true,
        askStartingDrawSearch: true
      };
      return;
    }
  }

  // CR 601.1c: "Randomly determine which player will decide who takes the
  // first turn of the game. That player chooses who goes first." Every
  // starting resource is in play by now; the rest of setup waits for the
  // `chooseFirstPlayer` answer (`continueSetupAfterFirstPlayer`).
  if (state.decideFirstPlayer) {
    delete state.decideFirstPlayer;
    const deciderId = playerIds[Math.min(playerIds.length - 1, Math.floor(drawRandom(state) * playerIds.length))];
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
  const playerIds = state.turnOrder;
  const firstPlayerId = state.activePlayerId;

  // "You may search your deck for [a resource] that is not any of your
  // starting resources, reveal it and put it into your hand." (Unlikely
  // Heroes) — before the shuffle, like every other setup placement.
  if (askSearch) {
    // Interactive setup: each searching seat is asked (and may decline); the
    // rest of setup runs once the last answer is in (`continueStartingDrawSearch`).
    const order = seatsFrom(state, firstPlayerId).filter(
      playerId => startingDrawSearchCandidates(engine, playerId).length > 0
    );
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
 * How many cards `playerId` draws for their opening hand going first or
 * not: their faction's STARTING DRAW, or an opponent faction's when it says
 * "Your opponent ignores their faction's STARTING DRAW rule and uses this
 * card's rule instead." (The Knitting Coalition — HIDDEN INFLUENCE). Every
 * seat but the first draws the "going second" number.
 */
export function openingDrawFor(engine: SpoilsEngine, playerId: PlayerId, goingFirst: boolean): number {
  const handRule = governingStartingDrawFaction(engine, playerId).setup.openingHand;
  return goingFirst ? handRule.goingFirst : handRule.goingSecond;
}

/** Everything after the STARTING DRAW search: shuffles, opening hands, then the mulligan step or turn 1. */
function finishFactionSetupAfterSearch(engine: SpoilsEngine): void {
  const state = engine.state;
  const playerIds = state.turnOrder;
  const firstPlayerId = state.activePlayerId;

  const random = () => drawRandom(state);
  for (const playerId of playerIds) {
    shuffleInPlace(state.players[playerId].deck, random);
  }

  for (const playerId of playerIds) {
    drawSetupCards(state, playerId, openingDrawFor(engine, playerId, playerId === firstPlayerId));
  }

  const mulliganOrder = seatsFrom(state, firstPlayerId).filter(playerId => {
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
