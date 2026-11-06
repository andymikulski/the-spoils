// -----------------------------------------------------------------------------
// Showdown (docs/rules/showdown-rules.md)
// -----------------------------------------------------------------------------
//
// The only module that knows how Allegiance cards are represented. Everything
// else asks `getLoyalty` / `isAllegianceRevealed`, so a model of the real
// printed Allegiance cards can replace `AllegianceDeckConfig` here alone.

import type {
  AllegianceCard,
  AllegianceDeckConfig,
  GameState,
  Loyalty,
  PlayerId
} from "../types/index.js";
import { assert } from "./utilities.js";
import { shuffleInPlace } from "./rng.js";

/** The Villain's id, or `undefined` outside Showdown. */
export function villainOf(state: GameState): PlayerId | undefined {
  return state.format.kind === "showdown" ? state.format.villainId : undefined;
}

/** Whether `playerId` is the Villain of a Showdown game. */
export function isVillain(state: GameState, playerId: PlayerId): boolean {
  return villainOf(state) === playerId;
}

/** Whether `playerId` is a Hero of a Showdown game. */
export function isHero(state: GameState, playerId: PlayerId): boolean {
  return state.format.kind === "showdown" && playerId in state.players && !isVillain(state, playerId);
}

/** Every Hero, in turn order. Empty outside Showdown. */
export function heroesOf(state: GameState): PlayerId[] {
  return state.turnOrder.filter(id => isHero(state, id));
}

/** The side `playerId` is truly loyal to. The Villain is loyal to the Villain; outside Showdown, `undefined`. */
export function getLoyalty(state: GameState, playerId: PlayerId): Loyalty | undefined {
  if (state.format.kind !== "showdown") return undefined;
  if (isVillain(state, playerId)) return "villain";
  const loyalty = allegianceOf(state, playerId)?.loyalty ?? "heroes";
  return loyalty === "hidden" ? undefined : loyalty;
}

/** Whether `playerId`'s Allegiance card is face-up. */
export function isAllegianceRevealed(state: GameState, playerId: PlayerId): boolean {
  return allegianceOf(state, playerId)?.faceUp === true;
}

/** Whether `viewerId` may see `playerId`'s Allegiance card: its holder, the Villain (SD 7), or anyone once face-up. */
export function canSeeAllegiance(state: GameState, viewerId: PlayerId | "spectator", playerId: PlayerId): boolean {
  if (isAllegianceRevealed(state, playerId)) return true;
  if (viewerId === "spectator") return false;
  return viewerId === playerId || isVillain(state, viewerId);
}

/** Turn every Allegiance card face-up (SD-SLE 5). */
export function revealAllAllegiances(state: GameState): PlayerId[] {
  const turned: PlayerId[] = [];
  for (const [playerId, card] of Object.entries(state.showdown?.allegiance ?? {})) {
    if (!card.faceUp) {
      card.faceUp = true;
      turned.push(playerId);
    }
  }
  return turned;
}

/**
 * The players `playerId` may choose as "your opponent" in Showdown, before
 * eliminated players are removed: the Villain opposes every Hero (SD 13); a
 * Hero opposes the Villain (SD 14) unless their face-up Allegiance card shows
 * loyalty to the Villain, in which case they oppose the other Heroes (SD 15).
 */
export function showdownOpponents(state: GameState, playerId: PlayerId): PlayerId[] {
  const villainId = villainOf(state);
  assert(villainId !== undefined, "showdownOpponents is only meaningful in a Showdown game.");
  if (playerId === villainId) return heroesOf(state);
  const revealedTraitor = isAllegianceRevealed(state, playerId) && getLoyalty(state, playerId) === "villain";
  return revealedTraitor ? heroesOf(state).filter(id => id !== playerId) : [villainId];
}

/**
 * A default Allegiance deck for `heroCount` Heroes: one card per Hero plus
 * one spare, with a single Villain-loyal card once there are three or more
 * Heroes. A placeholder until the printed Allegiance card set is modelled
 * (docs/MULTIPLAYER-PLAN.md, D2).
 */
export function defaultAllegianceDeck(heroCount: number): AllegianceDeckConfig {
  const cards: Loyalty[] = Array.from({ length: heroCount + 1 }, () => "heroes" as Loyalty);
  if (heroCount >= 3) cards[0] = "villain";
  return { cards };
}

/**
 * Deal one Allegiance card to each Hero (SD 6), shuffling `config.cards` with
 * `random`. Undealt cards are set aside unseen.
 */
export function dealAllegiance(
  heroes: readonly PlayerId[],
  config: AllegianceDeckConfig,
  random: () => number
): Record<PlayerId, AllegianceCard> {
  assert(
    config.cards.length >= heroes.length,
    `The Allegiance deck has ${config.cards.length} cards for ${heroes.length} Heroes.`
  );
  const deck = [...config.cards];
  shuffleInPlace(deck, random);
  const dealt: Record<PlayerId, AllegianceCard> = {};
  heroes.forEach((heroId, i) => {
    dealt[heroId] = { loyalty: deck[i], faceUp: false };
  });
  return dealt;
}

function allegianceOf(state: GameState, playerId: PlayerId): AllegianceCard | undefined {
  return state.showdown?.allegiance[playerId];
}
