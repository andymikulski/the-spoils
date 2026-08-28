// -----------------------------------------------------------------------------
// Faction-driven game setup
// -----------------------------------------------------------------------------

import type {
  CardDefinition,
  CardDefinitionId,
  CardInstanceId,
  FactionDefinition,
  GameState,
  PlayerId
} from "../types/index.js";
import { assert, withBuiltInFactionDefaults } from "./utilities.js";
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
}

const STAPLE_RESOURCE_NAMES = new Set([
  "obsession",
  "greed",
  "elitism",
  "deception",
  "rage"
]);

function isStapleResourceDefinition(definition: CardDefinition): boolean {
  return (
    definition.type === "resource" &&
    (definition.resource?.staple === true ||
      STAPLE_RESOURCE_NAMES.has(definition.name.toLowerCase()))
  );
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
  cardId: CardInstanceId
): void {
  const player = state.players[playerId];
  const card = state.cards[cardId];

  player.deck = player.deck.filter(id => id !== cardId);
  card.zone = "play";
  card.faceDown = false;
  card.attachedTo = undefined;
  player.play.push(cardId);
}

function chooseStartingResourceIds(
  engine: SpoilsEngine,
  playerId: PlayerId,
  rule: FactionDefinition["setup"]["startingResources"]
): CardInstanceId[] {
  const player = engine.state.players[playerId];
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

  return candidates.slice(0, rule.count);
}

function drawSetupCards(state: GameState, playerId: PlayerId, count: number): void {
  const player = state.players[playerId];
  const drawn = player.deck.splice(0, count);

  for (const cardId of drawn) {
    state.cards[cardId].zone = "hand";
    player.hand.push(cardId);
  }
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
  state.developedThisTurn = false;
  state.started = false;
  if (options.seed !== undefined) {
    state.rngState = options.seed >>> 0;
  }

  state.players[playerA.id].factionId = factionA.id;
  state.players[playerB.id].factionId = factionB.id;
  state.players[playerA.id].influence = resolvedA.factionDefinition.faction!.startingInfluence;
  state.players[playerB.id].influence = resolvedB.factionDefinition.faction!.startingInfluence;

  const engine = new SpoilsEngine(normalizedDefinitions, state);

  for (const [playerId, factionDefinition] of [
    [playerA.id, resolvedA.factionDefinition],
    [playerB.id, resolvedB.factionDefinition]
  ] as const) {
    const resourceIds = chooseStartingResourceIds(
      engine,
      playerId,
      factionDefinition.faction!.setup.startingResources
    );

    for (const cardId of resourceIds) {
      moveSetupCardToPlay(state, playerId, cardId);
    }
  }

  const random = () => drawRandom(state);
  shuffleInPlace(state.players[playerA.id].deck, random);
  shuffleInPlace(state.players[playerB.id].deck, random);

  const factionASetup = resolvedA.factionDefinition.faction!.setup;
  const factionBSetup = resolvedB.factionDefinition.faction!.setup;

  drawSetupCards(
    state,
    playerA.id,
    playerA.id === firstPlayerId
      ? factionASetup.openingHand.goingFirst
      : factionASetup.openingHand.goingSecond
  );

  drawSetupCards(
    state,
    playerB.id,
    playerB.id === firstPlayerId
      ? factionBSetup.openingHand.goingFirst
      : factionBSetup.openingHand.goingSecond
  );

  const mulliganOrder = [firstPlayerId, secondPlayerId].filter(playerId => {
    const faction = engine.getFactionDefinition(playerId);
    return (faction?.setup.mulligan?.count ?? 0) > 0;
  });

  if (mulliganOrder.length) {
    state.setup = {
      phase: "mulligan",
      order: mulliganOrder,
      currentIndex: 0
    };
  } else {
    state.setup = { phase: "complete" };
    engine.startGameAfterSetup();
  }

  return engine;
}
