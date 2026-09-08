// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

import type {
  AbilityId,
  BattleId,
  CardInstanceId,
  ModifierOperation,
  PlayerId,
  Stat,
  Zone
} from "./ids.js";

export interface GameEventMap {
  turnStarted: {
    playerId: PlayerId;
  };

  turnEnding: {
    playerId: PlayerId;
  };

  /**
   * The game reached a result — a faction hit 0 influence (or both did, a
   * draw). `winnerId` is the surviving player, or `"draw"`. Emitted once,
   * the instant `GameState.winner` is set. Informational; the win itself is
   * a state-based check, not keyed off this event.
   */
  gameEnded: {
    winnerId: PlayerId | "draw";
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
    /**
     * Whether the card was a face-down resource at the instant it moved —
     * captured here because `moveCard` clears `CardInstance.faceDown` before
     * this event is emitted. A card that left play *while face-down* was an
     * anonymous Volition resource with no rules text (CR §411.1), so its
     * printed "when this card leaves play" trigger must not fire; a face-up
     * card flipped face-down (CR §411.4) reports `false` here and *does*
     * fire those triggers. `findTriggers` reads this instead of the card's
     * now-updated `faceDown`. Omitted (treated as `false`) for moves that
     * did not originate in play.
     */
    faceDown?: boolean;
  };

  /**
   * A player's faction influence changed *outside* of battle damage — a
   * `modifyInfluence` effect, or influence paid / lost as a cost. Battle
   * damage to a faction is reported through `damageDealt` (§408.3), not
   * here. `delta` is signed (negative = loss); `total` is the influence
   * after the change. Informational — the win check reads `influence`
   * directly, not this event.
   */
  influenceChanged: {
    playerId: PlayerId;
    delta: number;
    total: number;
  };

  /**
   * A one-shot stat modifier was applied to a card by a `createModifier`
   * effect ("+2 strength until end of turn", "set speed to 0 this battle").
   * Continuous-ability modifiers (auras, buffs from an attached item) are
   * recomputed live and are *not* reported here. Informational.
   */
  statModified: {
    cardId: CardInstanceId;
    stat: Stat;
    operation: ModifierOperation;
    value: number;
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
    /**
     * Whether the destroyed card was a face-down resource (CR §411.1) —
     * captured before the discard move clears `CardInstance.faceDown`. A
     * face-down card has no rules text, so its printed "when this card is
     * destroyed / leaves play" trigger must not fire. See `cardMoved.faceDown`.
     */
    faceDown?: boolean;
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

  /**
   * A card resolved one of its own rolled `variables` entries (an activated
   * ability's / tactic's `variables: { x: { type: "random", ... } }`) to a
   * concrete number — the "Flip a coin. If you win, X is 2. Otherwise, X is
   * 1." idiom (Hammer Smash), and any other "X is a random N–M". Fires once
   * per `random`-typed id, whether the value was rolled here or pre-rolled by
   * the client and supplied on the action (a renderer that sequences a
   * "pick X" picker must settle the roll before dispatching). Informational
   * only — no rule keys off it.
   */
  variableRolled: {
    sourceId: CardInstanceId;
    /** The variable's id in the ability/tactic `variables` map, e.g. `"x"`. */
    name: string;
    value: number;
    /** Inclusive bounds of the `random` expression that produced `value`. */
    min: number;
    max: number;
  };
}

export type GameEventType = keyof GameEventMap;

export type GameEvent = {
  [K in GameEventType]: { type: K } & GameEventMap[K];
}[GameEventType];
