// Shared helpers for the Seed 3 faction multiplayer clause tests: a game built by the real setup path
// (`createFactionGame`) at 3 or 4 seats, each seat a real catalog faction with a deck of staple resources.

import assert from "node:assert/strict";
import { CARD_CATALOG } from "../../../../data.js";
import { createFactionGame } from "../../../../engine.js";
import type { CardDefinition, FactionGameSetupOptions, PlayerId, SpoilsEngine } from "../../../../engine.js";
import { P1, P2, P3, P4 } from "../../support/fixtures.js";

export { P1, P2, P3, P4 };

export const named = (name: string, type: string): CardDefinition => {
  const found = CARD_CATALOG.find((card) => card.name === name && card.type === type);
  assert.ok(found, `catalog has ${name}`);
  return found;
};

export const TOURNAMENT = named("The Tournament Faction", "faction"); // 2 staples, draws 8 first / 9 second
export const ALLIANCE_OF_TWO = named("The Evil Alliance", "faction");
export const IMPERIAL = named("Imperial Army", "faction"); // 2 Rage, draws 3 / 3
export const STAPLES = ["Rage", "Greed", "Deception", "Elitism", "Obsession"].map((name) => named(name, "resource"));

export const SEAT_IDS: PlayerId[] = [P1, P2, P3, P4];

/** Seats a game of `factions` in the order given (P1, P2, ...), every deck its faction plus 8 of each staple. */
export function factionGame(factions: CardDefinition[], options: FactionGameSetupOptions = {}): SpoilsEngine {
  const definitions = [...new Set([...factions, ...STAPLES])];
  return createFactionGame(definitions, {
    players: factions.map((faction, seat) => ({
      id: SEAT_IDS[seat]!,
      name: `Player ${seat + 1}`,
      deckDefinitionIds: [faction.id, ...STAPLES.flatMap((staple) => Array<string>(8).fill(staple.id))]
    })),
    ...options
  });
}

export const handSize = (engine: SpoilsEngine, playerId: PlayerId): number => engine.state.players[playerId]!.hand.length;
export const resourcesOf = (engine: SpoilsEngine, playerId: PlayerId): string[] =>
  engine.state.players[playerId]!.play.filter((id) => engine.getDefinition(id).type === "resource").map((id) => engine.getDefinition(id).name);
