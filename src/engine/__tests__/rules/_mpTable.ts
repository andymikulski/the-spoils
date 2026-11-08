// Shared boards for the multiplayer "your opponent" rules tests (mp-ffa.p7, mp-ffa.p8): a table of 2 to 4 seats with
// one fixture card ("spell") in P1's hand, one character per seat and a few resources.

import type { CardDefinition, GameAction, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, character, noDevelopFaction, P1, P2, P3, P4, resolvePendingResponses, resourceCard, type CardPlacement } from "../support/fixtures.js";

export const SEATS = [P1, P2, P3, P4];
export const seatsFor = (count: number): PlayerId[] => SEATS.slice(0, count);
export const TABLES = [3, 4] as const;

/** Seats whose factions have no develop rule, so turns can pass without start-of-turn prompts. */
export const plainSeats = (count: number) => ({
  playerA: { faction: noDevelopFaction() },
  playerB: { faction: noDevelopFaction() },
  extraPlayers: Array.from({ length: count - 2 }, () => ({ faction: noDevelopFaction() }))
});

export const ACTIVATED = (ability: Record<string, unknown>) =>
  ({ abilities: [{ id: "go", type: "activated", ...ability }] }) as CardDefinition["behavior"];

/** "Destroy a character your opponent controls." */
export const DESTROY_THEIRS = ACTIVATED({
  targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }],
  effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
});

/** "Your opponent's faction loses 3 influence." */
export const DRAIN_THEIRS = ACTIVATED({ effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] });

export interface Table {
  engine: SpoilsEngine;
  id: (key: string) => string;
  seats: PlayerId[];
}

/** A board with one card (key "spell") in P1's hand, one character per seat ("c-<player>") and four resources for P1. */
export function board(count: number, spell: CardDefinition, extra: CardPlacement[] = []): Table {
  const seats = seatsFor(count);
  const built = buildGame({
    ...plainSeats(count),
    cards: [
      { key: "spell", def: spell, owner: P1, zone: "hand" },
      ...seats.map(owner => ({ key: `c-${owner}`, def: character({ name: `Char ${owner}` }), owner })),
      ...Array.from({ length: 4 }, (_, i) => ({ key: `res-${i}`, def: resourceCard({ name: `Res ${i}` }), owner: P1 })),
      ...extra
    ]
  });
  return { engine: built.engine, id: built.id, seats };
}

export const play = (t: Table, extra: Partial<Extract<GameAction, { type: "playCard" }>> = {}): GameAction => ({
  type: "playCard",
  playerId: P1,
  cardId: t.id("spell"),
  ...extra
});

export const influence = (t: Table, who: PlayerId): number => t.engine.state.players[who]!.influence;
export const baseline = (t: Table): Record<PlayerId, number> => Object.fromEntries(t.seats.map(seat => [seat, influence(t, seat)]));
export const lost = (t: Table, before: Record<PlayerId, number>, who: PlayerId): number => before[who]! - influence(t, who);

/** Plays the spell as P1 with `players`, then lets every response pass so it resolves. */
export function cast(t: Table, players?: Record<string, PlayerId>, extra: Partial<Extract<GameAction, { type: "playCard" }>> = {}): void {
  t.engine.perform(play(t, { ...(players ? { players } : {}), ...extra }));
  resolvePendingResponses(t.engine);
}

export const pending = (t: Table) => t.engine.state.pendingChoice;

export const answerPlayer = (t: Table, who: PlayerId, playerId: PlayerId): void =>
  t.engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "choosePlayer", playerId } });

/** Moves the board's "spell" card into play under P1 (an ability or continuous-text permanent already on the board). */
export function intoPlay(t: Table): string {
  const id = t.id("spell");
  const card = t.engine.state.cards[id]!;
  const owner = t.engine.state.players[P1]!;
  owner.hand = owner.hand.filter(entry => entry !== id);
  owner.play.push(id);
  card.zone = "play";
  return id;
}
