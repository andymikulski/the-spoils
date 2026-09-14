// -----------------------------------------------------------------------------
// Faction-driven game setup
// -----------------------------------------------------------------------------

import type {
  CardDefinition,
  CardDefinitionId,
  CardInstanceId,
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
import { createCardInstance, createTwoPlayerGame } from "./setup.js";
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
  firstPlayerId?: PlayerId;
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
   * always has.
   */
  chooseStartingResources?: boolean;
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

  assert(
    candidates.length >= rule.count,
    `Faction setup requires ${rule.count} starting resource(s), but only ${candidates.length} were found.`
  );

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
  if (rule.chosenStaples) {
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
 * Creates a complete two-player game using faction-defined setup rules.
 *
 * Resulting flow for The Tournament Faction:
 *   faction enters play
 *   -> find 2 staple resources and put them in play
 *   -> shuffle
 *   -> first player draws 8, second draws 9
 *   -> mulligan decisions in turn order
 *   -> start turn 1
 */
export function createTwoPlayerFactionGame(
  definitionsInput: CardDefinition[],
  playerA: FactionPlayerSetup,
  playerB: FactionPlayerSetup,
  options: FactionGameSetupOptions = {}
): SpoilsEngine {
  const normalizedDefinitions = definitionsInput.map(withBuiltInFactionDefaults);
  const definitions = Object.fromEntries(
    normalizedDefinitions.map(definition => [definition.id, definition])
  ) as Record<CardDefinitionId, CardDefinition>;

  const firstPlayerId = options.firstPlayerId ?? playerA.id;
  assert(
    firstPlayerId === playerA.id || firstPlayerId === playerB.id,
    "firstPlayerId must identify one of the two players."
  );

  const secondPlayerId = firstPlayerId === playerA.id ? playerB.id : playerA.id;
  const resolvedA = resolveFactionAndDeck(definitions, playerA);
  const resolvedB = resolveFactionAndDeck(definitions, playerB);

  const factionA = createCardInstance(resolvedA.factionDefinition.id, playerA.id, "play");
  const factionB = createCardInstance(resolvedB.factionDefinition.id, playerB.id, "play");

  const cardsA = resolvedA.deckDefinitionIds.map(id => createCardInstance(id, playerA.id, "deck"));
  const cardsB = resolvedB.deckDefinitionIds.map(id => createCardInstance(id, playerB.id, "deck"));

  const state = createTwoPlayerGame(
    { id: playerA.id, name: playerA.name, influence: 0 },
    { id: playerB.id, name: playerB.name, influence: 0 },
    [factionA, ...cardsA, factionB, ...cardsB]
  );

  state.turn = 1;
  state.activePlayerId = firstPlayerId;
  state.priorityPlayerId = firstPlayerId;
  state.developsUsedThisTurn = 0;
  state.started = false;
  if (options.seed !== undefined) {
    state.rngState = options.seed >>> 0;
  }

  state.players[playerA.id].factionId = factionA.id;
  state.players[playerB.id].factionId = factionB.id;
  state.players[playerA.id].influence = resolvedA.factionDefinition.faction!.startingInfluence;
  state.players[playerB.id].influence = resolvedB.factionDefinition.faction!.startingInfluence;

  const engine = new SpoilsEngine(normalizedDefinitions, state);

  const playerOrder = [
    [playerA.id, resolvedA.factionDefinition],
    [playerB.id, resolvedB.factionDefinition]
  ] as const;

  const choosers: Array<{ playerId: PlayerId; count: number }> = [];
  for (const [playerId, factionDefinition] of playerOrder) {
    const rule = factionDefinition.faction!.setup.startingResources;
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
    finishFactionSetup(engine);
    return engine;
  }

  // Hand off to the interactive phase: each `order` seat dispatches a
  // `chooseStartingResources` action, and the engine calls
  // `finishFactionSetup` once the last one is in (matchOpponentCount top-up,
  // shuffle, opening hands, mulligan / turn 1). Nothing is shuffled or drawn
  // until then.
  const order = [firstPlayerId, secondPlayerId].filter(id =>
    choosers.some(chooser => chooser.playerId === id)
  );
  const counts: Record<PlayerId, number> = {};
  for (const chooser of choosers) counts[chooser.playerId] = chooser.count;

  state.setup = { phase: "chooseStartingResources", order, currentIndex: 0, counts };

  return engine;
}

/**
 * `FactionDefinition.setup.startingDrawSearch` — the first card in deck
 * order matching `selector` whose `CardDefinitionId` differs from every
 * starting resource `playerId` just placed goes to hand. No-op if the
 * faction carries no such rule, or nothing in the deck matches.
 */
function applyStartingDrawSearch(engine: SpoilsEngine, playerId: PlayerId): void {
  const search = engine.getFactionDefinition(playerId)?.setup.startingDrawSearch;
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
 * Called by {@link createTwoPlayerFactionGame} directly when no player has a
 * starting-resource choice, or by the engine once the last
 * `chooseStartingResources` action has been answered.
 */
export function finishFactionSetup(engine: SpoilsEngine): void {
  const state = engine.state;
  // Insertion order is [playerA, playerB] (see `createTwoPlayerGame`); keep to
  // it so the RNG stream is consumed exactly as in a game with no
  // starting-resource choice.
  const playerIds = Object.keys(state.players) as PlayerId[];
  const firstPlayerId = state.activePlayerId;
  const otherThan = (playerId: PlayerId) => playerIds.find(id => id !== playerId)!;

  const startingResourceCounts: Record<PlayerId, number> = {};
  for (const playerId of playerIds) {
    startingResourceCounts[playerId] = state.players[playerId].play.filter(
      cardId => engine.getDefinition(cardId).type === "resource"
    ).length;
  }

  // "...enough staple resources so that both players have the same number of
  // starting resources." (The Union of Unextraordinary Miners — MONEY FOR
  // NOTHING). Done before the shuffle, like every other setup placement.
  for (const playerId of playerIds) {
    if (!engine.getFactionDefinition(playerId)?.setup.startingResources.matchOpponentCount) {
      continue;
    }
    const opponentId = otherThan(playerId);
    const deficit = startingResourceCounts[playerId] - startingResourceCounts[opponentId];
    for (let i = 0; i < deficit; i++) {
      const [extra] = chooseStartingResources(engine, opponentId, {
        count: 1,
        stapleOnly: true
      });
      moveSetupCardToPlay(state, opponentId, extra.cardId, false);
      startingResourceCounts[opponentId] += 1;
    }
  }

  // "You may search your deck for [a resource] that is not any of your
  // starting resources, reveal it and put it into your hand." (Unlikely
  // Heroes) — before the shuffle, like every other setup placement.
  for (const playerId of playerIds) {
    applyStartingDrawSearch(engine, playerId);
  }

  const random = () => drawRandom(state);
  for (const playerId of playerIds) {
    shuffleInPlace(state.players[playerId].deck, random);
  }

  // "Your opponent ignores their faction's STARTING DRAW rule and uses this
  // card's rule instead." (The Knitting Coalition — HIDDEN INFLUENCE).
  for (const playerId of playerIds) {
    const ownFaction = engine.getFactionDefinition(playerId)!;
    const opponentFaction = engine.getFactionDefinition(otherThan(playerId))!;
    const handRule = opponentFaction.overridesOpponent?.startingDraw
      ? opponentFaction.setup.openingHand
      : ownFaction.setup.openingHand;
    drawSetupCards(
      state,
      playerId,
      playerId === firstPlayerId ? handRule.goingFirst : handRule.goingSecond
    );
  }

  const mulliganOrder = [firstPlayerId, otherThan(firstPlayerId)].filter(playerId => {
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
