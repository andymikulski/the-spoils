// Showdown fixtures for the clause suites of the two Showdown factions: a REAL setup (`createFactionGame`, format
// `showdown`) with the printed catalog definitions of The Evil Alliance (the Villain) and Slightly Less Evil Alliance
// (the shared faction), and synthetic Heroes / Hero Deck cards. Every number a test checks is a literal printed value.

import { createFactionGame } from "../../../engine.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { character, tactic } from "../per-card/_harness.js";
import { defaultFactionDefinition, factionCard, resolvePendingResponses } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";
import { printing } from "./_clause.js";

export const EVIL = "9dc309f4-d43f-4515-841e-ed982ce026e7"; // The Evil Alliance
export const SLE = "089a2d63-c9b9-4ad7-8c51-1d0d79a0dfbb"; // Slightly Less Evil Alliance
export const RAGE = printing("3be26b3f-2c78-4d0c-8849-0b4ca48951fd");
export const GREED = printing("61766da9-6482-4ecb-8306-becda47294ec");
export const DECEPTION = printing("ebcdd443-efdf-4a16-a0b9-b1307cd13d0b");
export const ELITISM = printing("b4ddcf43-e508-4a11-9953-697acdcaf116");

export const VILLAIN: PlayerId = "v";
export const H1: PlayerId = "h1";
export const H2: PlayerId = "h2";
export const H3: PlayerId = "h3";

export const FILLER = character({ id: "sd-filler", name: "Showdown Filler", life: 2 });
/** A Hero Deck character. */
export const CHAMPION = character({ id: "sd-champion", name: "Champion", strength: 4, life: 4 });
/** A Hero Deck tactic: draw a card. */
export const BOON = tactic({
  id: "sd-boon",
  name: "Boon",
  behavior: { abilities: [{ id: "boon", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
});
/** A cost-0 character with "Pick a faction you don't control. Inflict 4 damage to it." (a Hero's way to hurt another player). */
export const BRUTE = character({
  id: "sd-brute",
  name: "Brute",
  behavior: {
    abilities: [
      {
        id: "smash",
        type: "activated",
        costs: [],
        targets: [
          {
            id: "f",
            selector: {
              type: "faction",
              controller: "any",
              conditions: [{ type: "not", condition: { type: "targetControlledBy", player: "controller" } }]
            },
            count: 1
          }
        ],
        effects: [{ type: "dealDamage", target: { type: "selected", id: "f" }, amount: 4 }]
      }
    ]
  }
});

/** A Hero's faction: 20 influence, six staple resources in play, no opening hand and nothing to mulligan. */
export const HERO_FACTION = factionCard({
  id: "sd-hero-faction",
  name: "Showdown Hero",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: { startingResources: { count: 6, stapleOnly: true }, openingHand: { goingFirst: 0, goingSecond: 0 } }
  })
});

export interface ShowdownOptions {
  /** How many Heroes sit at the table (default 2). */
  heroes?: number;
  /** Who takes the first turn (default the Villain). */
  first?: PlayerId;
  /** The Hero Deck, top first (default one Champion). */
  heroDeck?: CardDefinition[];
  /** The Allegiance deck (default: every Hero is loyal to the Heroes). */
  allegiance?: Array<"heroes" | "villain">;
  /** The one card a Hero's whole deck (beyond the six starting staples) is made of (default `FILLER`). */
  heroFill?: Partial<Record<PlayerId, CardDefinition>>;
  /** Leave the first turn's start unsettled (its Restore / Develop prompts pending). */
  rawStart?: boolean;
  seed?: number;
}

const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);
const heroIds = (count: number): PlayerId[] => [H1, H2, H3, "h4", "h5"].slice(0, count);

/**
 * A real Showdown game with the printed factions: the Villain plays The Evil Alliance with the shared Slightly Less
 * Evil Alliance on the table. Both Villain mulligans are declined and the first turn's start has been settled (the
 * Develop Rule drawing), so the first player is in their main phase.
 */
export function showdownGame(options: ShowdownOptions = {}): SpoilsEngine {
  const heroes = heroIds(options.heroes ?? 2);
  const heroDeck = options.heroDeck ?? [CHAMPION];
  // The Villain's six staples: 1 + X of them (X <= 5) start in play, the rest are shuffled in with the filler.
  const decks: Record<PlayerId, CardDefinition[]> = {
    [VILLAIN]: [RAGE, GREED, DECEPTION, ELITISM, RAGE, GREED, ...repeat(FILLER, 40)]
  };
  // A Hero's six starting staples leave a deck of nothing but `heroFill`, so every draw is known.
  for (const id of heroes) decks[id] = [...repeat(RAGE, 6), ...repeat(options.heroFill?.[id] ?? FILLER, 34)];
  const all = [printing(EVIL), printing(SLE), HERO_FACTION, RAGE, GREED, FILLER, ...heroDeck, ...Object.values(decks).flat()];
  const defs = [...new Map(all.map(def => [def.id, def])).values()];
  const engine = createFactionGame(
    defs,
    [
      { id: VILLAIN, name: "Villain", factionDefinitionId: EVIL, deckDefinitionIds: decks[VILLAIN].map(d => d.id) },
      ...heroes.map(id => ({ id, name: id, factionDefinitionId: HERO_FACTION.id, deckDefinitionIds: decks[id].map(d => d.id) }))
    ],
    {
      firstPlayerId: options.first ?? VILLAIN,
      seed: options.seed ?? 5,
      format: {
        kind: "showdown",
        villainId: VILLAIN,
        ...(options.allegiance ? { allegiance: { cards: options.allegiance } } : {})
      },
      showdown: { heroDeck: heroDeck.map(d => d.id), sharedFactionDefinitionId: SLE }
    }
  );
  for (let guard = 0; guard < 10 && engine.state.setup?.phase === "mulligan"; guard++) {
    const { order, currentIndex } = engine.state.setup;
    engine.perform({ type: "mulligan", playerId: order[currentIndex], cardIds: [] });
    resolvePendingResponses(engine);
  }
  if (!options.rawStart) settleTurnStart(engine);
  return engine;
}

/** The active player ends their turn and the next turn's start is settled (every Develop prompt answered "draw"). */
export function endTurnAndSettle(engine: SpoilsEngine): void {
  engine.perform({ type: "endTurn", playerId: engine.state.activePlayerId });
  resolvePendingResponses(engine);
  settleTurnStart(engine);
}

/** Ends at least one turn, then as many more as it takes for it to be `playerId`'s turn (their start settled). */
export function advanceTo(engine: SpoilsEngine, playerId: PlayerId): void {
  endTurnAndSettle(engine);
  for (let guard = 0; guard < 12 && engine.state.activePlayerId !== playerId; guard++) endTurnAndSettle(engine);
}

export const sharedFaction = (engine: SpoilsEngine): CardInstanceId => engine.state.showdown!.sharedFactionId!;
export const heroDeckOf = (engine: SpoilsEngine): CardInstanceId[] => engine.state.showdown!.heroDeck;

/**
 * Empties the Hero Deck the way play would — its cards gone from the table: a Showdown game starts with one (SD 3),
 * so "the Hero Deck is empty" is a state reached in play.
 */
export function exhaustHeroDeck(engine: SpoilsEngine): void {
  const showdown = engine.state.showdown!;
  const move = (engine as unknown as { moveCard(id: CardInstanceId, zone: "removed"): void }).moveCard.bind(engine);
  for (const id of showdown.heroDeck) move(id, "removed");
  showdown.heroDeck = [];
}
export const pileOf = (engine: SpoilsEngine): CardInstanceId[] => engine.state.showdown!.temptationPile;
export const nameOf = (engine: SpoilsEngine, id: CardInstanceId): string => engine.getDefinition(id).name;

/** Ready (unspent) resources in play under `playerId`. */
export function readyResources(engine: SpoilsEngine, playerId: PlayerId): number {
  return engine.state.players[playerId].play.filter(id => {
    const card = engine.state.cards[id];
    return engine.getDefinition(id).type === "resource" && !card.attachedTo && !card.depleted;
  }).length;
}

/** The faction card of `playerId`. */
export const factionOfPlayer = (engine: SpoilsEngine, playerId: PlayerId): CardInstanceId =>
  engine.state.players[playerId].factionId!;

/** `playerId` activates `abilityId` on `cardId` (default the shared Alliance), then the response window drains. */
export function useAbility(
  engine: SpoilsEngine,
  playerId: PlayerId,
  abilityId: string,
  selected?: Record<string, string[]>,
  cardId: CardInstanceId = sharedFaction(engine)
): void {
  engine.perform({ type: "activateAbility", playerId, cardId, abilityId, ...(selected ? { selected } : {}) });
  resolvePendingResponses(engine);
}

/** The Villain uses ENTICEMENT (on their own turn), playing the first card of their hand as the resource. */
export function entice(engine: SpoilsEngine): void {
  const card = engine.state.players[VILLAIN].hand[0];
  useAbility(engine, VILLAIN, "evil-enticement", undefined, factionOfPlayer(engine, VILLAIN));
  engine.perform({ type: "resolvePendingChoice", playerId: VILLAIN, choice: { kind: "chooserSelectsTarget", selected: [card] } });
  resolvePendingResponses(engine);
}

/** Answers the pending "claim one card" pick (a `chooserSelectsTarget`) of `playerId` with `cardId`. */
export function pickPending(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId): void {
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected: [cardId] } });
  resolvePendingResponses(engine);
}
