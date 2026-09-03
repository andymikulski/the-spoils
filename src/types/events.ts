// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

import type { AbilityId, BattleId, CardInstanceId, PlayerId, Zone } from "./ids.js";

export interface GameEventMap {
  turnStarted: {
    playerId: PlayerId;
  };

  turnEnding: {
    playerId: PlayerId;
  };

  cardPlayed: {
    cardId: CardInstanceId;
    playerId: PlayerId;
  };

  cardEnteredPlay: {
    cardId: CardInstanceId;
    playerId: PlayerId;
  };

  cardMoved: {
    cardId: CardInstanceId;
    from: Zone;
    to: Zone;
  };

  /**
   * A card in play was attached to another card by an `attachTo` effect
   * (§301 — e.g. Kettinger's HANDOFF re-homing itself to a new character).
   * `hostId` is the card it is now attached to. The attach that happens as
   * a card *enters* play (an "Attach to X" item/tactic) is not reported
   * here — that is already carried by `cardEnteredPlay`.
   */
  cardAttached: {
    cardId: CardInstanceId;
    hostId: CardInstanceId;
  };

  /**
   * An in-play card was chosen as a target of a player-or-chooser TARGET
   * declaration (effect-/trigger-driven picks — `chooserSelectsTarget`,
   * `selectTargets`, `autoSelectTargets`). `playerId` is the picking
   * player. "When this card is picked, put a token on it" (Ferrous Ferret);
   * pairs with the `mustBePicked` restriction.
   */
  cardPicked: {
    cardId: CardInstanceId;
    playerId: PlayerId;
  };

  cardDestroyed: {
    cardId: CardInstanceId;
    controllerId: PlayerId;
    /**
     * True when the lethal damage instance was battle damage (set by
     * `inflictLockedBattleDamage`). Read by the `destroyedByBattleDamage`
     * condition — "When this card is destroyed by battle damage, ..."
     * (Venomous Sacspider).
     */
    byBattleDamage?: boolean;
  };

  cardDepleted: {
    cardId: CardInstanceId;
  };

  cardRestored: {
    cardId: CardInstanceId;
  };

  resourcePlayed: {
    cardId: CardInstanceId;
    playerId: PlayerId;
    faceDown: boolean;
  };

  /** "When a player draws any number of cards" — one event per completed draw batch. */
  cardsDrawn: {
    playerId: PlayerId;
    count: number;
  };

  /**
   * "When a player discards any number of cards" (Bewilderbeast) — a
   * hand→discard move. Emitted once per card (`count` is always 1); a
   * "gains X for each card discarded" trigger applies its effect per event
   * and the total sums. `playerId` is the discarding player (the card's
   * owner). Gate with `eventPlayerIs`.
   */
  cardsDiscarded: {
    playerId: PlayerId;
    count: number;
  };

  /**
   * "If a player would search their deck ..." — emitted when a player is
   * asked to pick a card from their own deck (a `chooserSelectsTarget`
   * effect whose declaration selector names the `deck` zone). `playerId` is
   * the owner of the deck being searched. The pick has already been set up
   * as the outstanding choice, so a trigger on this event resolves right
   * after the search completes. Golden Charm — "you may pay 1 ... draw a
   * card ...".
   */
  deckSearched: {
    playerId: PlayerId;
  };

  /**
   * "Reveal the top card of your deck", "look at an opponent's hand" — a
   * card was shown to a player. Informational: the engine already has
   * perfect information, so this carries no state change; it exists for a
   * renderer / event log to surface what was seen. `ownerId` owns the
   * cards; `viewerId` is who is entitled to look (`"all"` when a card is
   * revealed to everyone). `byCardId` is the card whose text caused it.
   */
  cardsRevealed: {
    cardIds: CardInstanceId[];
    zone: Zone;
    ownerId: PlayerId;
    viewerId: PlayerId | "all";
    byCardId?: CardInstanceId;
  };

  damageDealt: {
    sourceId?: CardInstanceId;
    targetId: CardInstanceId;
    amount: number;
  };

  abilityActivated: {
    cardId: CardInstanceId;
    abilityId: AbilityId;
    playerId: PlayerId;
  };

  battleStarted: {
    battleId: BattleId;
  };

  battleEnded: {
    battleId: BattleId;
  };

  /** "When this card attacks" — once per attacker, at declareAttack. */
  characterAttacked: {
    cardId: CardInstanceId;
    battleId: BattleId;
  };

  /** "When this card blocks" — once per blocker, at declareBlockers. */
  characterBlocked: {
    cardId: CardInstanceId;
    battleId: BattleId;
  };

  /**
   * "When you form a blocking party with at least 1 character" — one event
   * for the whole party (not per blocker), at declareBlockers. `playerId`
   * is the defending player. Microdefense Autosystem.
   */
  blockingPartyFormed: {
    playerId: PlayerId;
    blockerCount: number;
  };

  /**
   * "When this card is blocked" — once per still-in-battle attacker, at
   * declareBlockers, when the defender declares a non-empty blocking party.
   * Maps to the attacker for `sourceIsEventCard`. `blockerCount` is the
   * size of the declared blocking party. Timid Mau.
   */
  attackerBlocked: {
    cardId: CardInstanceId;
    battleId: BattleId;
    blockerCount: number;
  };

  /**
   * A card's counter of a given name changed (an `addCounter` /
   * `removeCounter` effect, or a `removeCounter` cost). Lets "when there are
   * at least N / no tokens on this card, ..." fire the instant it crosses —
   * gate the triggered ability with a `counterCompare` on `source` +
   * `sourceIsEventCard`.
   */
  counterChanged: {
    cardId: CardInstanceId;
    counter: string;
  };

  /**
   * A coin was flipped by a `flipCoin` effect (or a `flipUp`-style reflip),
   * after the result is settled. `won` is from the flipping player's point
   * of view. "Flip a coin. If you win, ..." (Fwing!, Throatstabber); a card
   * can also intercept the *loss* via a `ReplacementAbility`
   * (`replaces: { event: "coinFlip", result: "lose" }`) before this fires
   * (Two-Headed Coin).
   */
  coinFlipped: {
    playerId: PlayerId;
    won: boolean;
  };
}

export type GameEventType = keyof GameEventMap;

export type GameEvent = {
  [K in GameEventType]: { type: K } & GameEventMap[K];
}[GameEventType];
