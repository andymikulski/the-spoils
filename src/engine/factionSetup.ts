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
import {
  assert,
  isStapleResourceDefinition,
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

  const takeResource = (opts: { staple?: boolean; name?: string }): StartingResourcePick => {
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
    return { cardId, faceDown: false };
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
        ? takeResource({ staple: slot.staple, name: slot.name })
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

  const startingResourceCounts: Record<PlayerId, number> = {};
  for (const [playerId, factionDefinition] of playerOrder) {
    const picks = chooseStartingResources(
      engine,
      playerId,
      factionDefinition.faction!.setup.startingResources,
      options.startingResourceX?.[playerId]
    );

    for (const pick of picks) {
      moveSetupCardToPlay(state, playerId, pick.cardId, pick.faceDown);
    }
    startingResourceCounts[playerId] = picks.length;
  }

  // "...enough staple resources so that both players have the same number of
  // starting resources." (The Union of Unextraordinary Miners — MONEY FOR
  // NOTHING). Done before the shuffle, like every other setup placement.
  for (const [playerId, factionDefinition] of playerOrder) {
    if (!factionDefinition.faction!.setup.startingResources.matchOpponentCount) {
      continue;
    }
    const opponentId = playerId === playerA.id ? playerB.id : playerA.id;
    const deficit =
      startingResourceCounts[playerId] - startingResourceCounts[opponentId];
    for (let i = 0; i < deficit; i++) {
      const [extra] = chooseStartingResources(engine, opponentId, {
        count: 1,
        stapleOnly: true
      });
      moveSetupCardToPlay(state, opponentId, extra.cardId, false);
      startingResourceCounts[opponentId] += 1;
    }
  }

  const random = () => drawRandom(state);
  shuffleInPlace(state.players[playerA.id].deck, random);
  shuffleInPlace(state.players[playerB.id].deck, random);

  const factionASetup = resolvedA.factionDefinition.faction!.setup;
  const factionBSetup = resolvedB.factionDefinition.faction!.setup;

  // "Your opponent ignores their faction's STARTING DRAW rule and uses this
  // card's rule instead." (The Knitting Coalition — HIDDEN INFLUENCE).
  const openingHandRuleFor = (
    ownSetup: FactionDefinition["setup"],
    opponentFaction: FactionDefinition
  ) =>
    opponentFaction.overridesOpponent?.startingDraw
      ? opponentFaction.setup.openingHand
      : ownSetup.openingHand;

  const handRuleA = openingHandRuleFor(
    factionASetup,
    resolvedB.factionDefinition.faction!
  );
  const handRuleB = openingHandRuleFor(
    factionBSetup,
    resolvedA.factionDefinition.faction!
  );

  drawSetupCards(
    state,
    playerA.id,
    playerA.id === firstPlayerId
      ? handRuleA.goingFirst
      : handRuleA.goingSecond
  );

  drawSetupCards(
    state,
    playerB.id,
    playerB.id === firstPlayerId
      ? handRuleB.goingFirst
      : handRuleB.goingSecond
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
