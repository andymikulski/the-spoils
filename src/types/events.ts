// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

import type {
  AbilityId,
  BattleId,
  CardDefinitionId,
  CardInstanceId,
  ModifierId,
  ModifierOperation,
  PlayerId,
  Stat,
  Zone
} from "./ids.js";
import type { GameResult, PlayerElimination } from "./format.js";
import type { ScheduledEffect } from "./state.js";

export interface GameEventMap {
  turnStarted: {
    playerId: PlayerId;
  };

  turnEnding: {
    playerId: PlayerId;
  };

  /**
   * The game reached a result — the last player (or side) standing won, or
   * the last players fell together (a draw). Emitted once, the instant
   * `GameState.result` is set. Informational; the win itself is a
   * state-based check, not keyed off this event.
   */
  gameEnded: {
    result: GameResult;
  };

  /**
   * A player left a game that goes on without them (D3): their faction
   * reached 0 influence (or their deck ran out under Trickster's Globe) while
   * other players remain. Their cards have left the game (D8).
   */
  playerEliminated: {
    playerId: PlayerId;
    reason: PlayerElimination["reason"];
  };

  /**
   * The players switched seats (`swapped: true` — control of every card in
   * play and of both factions passed to the opposing player) or switched
   * back (`swapped: false`). Fired when `ContinuousAbility.swapsSides` takes
   * or loses effect (Emergency Obfuscation). Informational; no rule keys off
   * it.
   */
  seatsSwapped: {
    swapped: boolean;
  };

  cardPlayed: {
    cardId: CardInstanceId;
    playerId: PlayerId;
    /** The card was played by paying its FLIP UP cost (a face-down card flipped up). Read-only, for clients' wording. */
    viaFlipUp?: boolean;
  };

  cardEnteredPlay: {
    cardId: CardInstanceId;
    playerId: PlayerId;
    /**
     * The zone the card entered play from (hand, discard, deck, void, or
     * `play` for a card flipped face-up / face-down). Omitted for tokens.
     * Read by the `enteredPlayFrom` condition ("enters play from your hand").
     */
    from?: Zone;
    /**
     * The card was deployed by paying its FLIP UP cost. Read by the
     * `deployedViaFlipUp` condition when a `cardEnteredPlay` trigger runs in a
     * fresh context (Securitymajig Mark II).
     */
    viaFlipUp?: boolean;
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
    /**
     * Who controlled the card in play when this move happened, when that
     * differs from who controls it afterwards (a stolen card flipped
     * face-down goes back under its owner's control). Triggers on the move
     * use it as "you" (last known information).
     */
    controllerId?: PlayerId;
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
     * The player whose card or effect caused the destruction (the engine's
     * `currentCause` when it happened): the controller of the effect's source,
     * or of the dealer of the lethal damage. Undefined when nothing caused it
     * (a bare state-based check). Read by the `destroyedByOpposing` condition.
     */
    causePlayerId?: PlayerId;
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
   * renderer / event log to surface what was seen. `ownerId` is the player
   * whose `zone` the cards are shown from: their hand or deck holder, which
   * differs from the cards' owner only for a card held in another player's
   * hand or deck (`CardInstance.heldBy`); `viewerId` is who is entitled to
   * look (`"all"` when a card is revealed to everyone). `byCardId` is the
   * card whose text caused it.
   *
   * `knownToRevealer` is set when the player who caused the reveal (the
   * controller of `byCardId`) already knew every one of `cardIds` before it
   * happened: they picked the cards in a search or from their own hand, or
   * turned over a face-down resource of theirs. Absent means the revealer
   * learns the cards from this reveal — the top of a deck (their own or an
   * opponent's), an opponent's hand, an opponent's unseen pile. A renderer
   * uses it to skip the "show the revealer" moment only when it would tell
   * them nothing.
   */
  cardsRevealed: {
    cardIds: CardInstanceId[];
    zone: Zone;
    ownerId: PlayerId;
    viewerId: PlayerId | "all";
    byCardId?: CardInstanceId;
    knownToRevealer?: boolean;
  };

  /**
   * A `scheduleEffect` rider was registered (Gilded Yurt, Imperial Palace, Drill Instructor, Final Countdown ...): a
   * delayed effect now waits for `when`. Log-only — it is recorded in the game log but never emitted through the
   * trigger system, so nothing can trigger on it. `SpoilsEngine.getPendingDelayedEffects` lists what is waiting.
   */
  effectScheduled: {
    scheduledId: ModifierId;
    sourceId: CardInstanceId;
    controllerId: PlayerId;
    when: ScheduledEffect["when"];
  };

  /**
   * A player's deck was shuffled in play (a `shuffleDeck` effect or cost, a search that shuffles the rest back, a
   * "shuffle into your deck" cost / pile split, Auction House's reveal-and-reshuffle). Log-only, like `effectScheduled`:
   * recorded in the game log but never emitted through the trigger system, so nothing can trigger on it and no RNG
   * draw or existing event changes. A UI uses it to void any knowledge of that deck's order. The opening shuffles
   * during game setup are NOT reported. `playerId` is the owner of the deck.
   */
  deckShuffled: {
    playerId: PlayerId;
  };

  /**
   * A player set cards aside to the bottom of their deck in the opening
   * mulligan, before the replacements are drawn. `GameState.mulligan`
   * already lists them. Community Chest's "put this card on the bottom of
   * your deck as part of your mulligan ... you may reveal it" triggers off
   * this while the card sits in the deck.
   */
  cardsMulliganed: {
    playerId: PlayerId;
    cardIds: CardInstanceId[];
  };

  damageDealt: {
    sourceId?: CardInstanceId;
    targetId: CardInstanceId;
    amount: number;
    /** True when this is battle damage (inflicted in a battle's damage step), not an effect's damage. */
    battle?: boolean;
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

  /**
   * A member was pulled out of its attacking / blocking party mid-battle
   * because it stopped being a character (CR §208.4 / §302.15) — a
   * `setCardType` grant lapsing, or the card being turned face-down by an
   * effect such as Backdoor Brigand's EXIT STAGE RIGHT. Any battle damage
   * already assigned to or by it is not inflicted. Emitted by the
   * state-based check the instant it happens so a log / renderer can show
   * why an attacker or blocker vanished; the removal itself is the
   * state-based action, not keyed off this event. Removal by destruction or
   * a control change is already visible through `cardDestroyed` / the
   * control-change line, so it is not re-reported here.
   */
  characterLeftBattle: {
    cardId: CardInstanceId;
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
   * Setup, CR 601.1c: the random draw picked `playerId` to decide who takes
   * the first turn. Not a card's coin flip: nothing that reacts to
   * `coinFlipped` sees it.
   */
  firstPlayerDecider: {
    playerId: PlayerId;
  };

  /** Setup, CR 601.1c: the deciding player (`playerId`) chose `firstPlayerId` to go first. */
  firstPlayerChosen: {
    playerId: PlayerId;
    firstPlayerId: PlayerId;
  };

  /**
   * A `flipFactionCard` effect actually turned a double-sided faction card
   * over (Imperial Army / Counter-Imperial Army's "INTERNAL CONFLICT" —
   * RULES.md §3.6). Distinct from `coinFlipped`: the toss can happen without
   * a flip (a loss, or a card with no `flipsTo`), but this only fires on the
   * actual identity swap, which is the part worth calling out on its own —
   * it changes which `FactionDefinition` governs the controller for the rest
   * of the game.
   */
  factionCardFlipped: {
    playerId: PlayerId;
    cardId: CardInstanceId;
    fromDefinitionId: CardDefinitionId;
    toDefinitionId: CardDefinitionId;
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

  /**
   * A player chose a value for a `variableBounds` variable — the "EXTRA COST:
   * Pick a number for X, where X is <= the number of [O] you control" idiom
   * (Desolate). Fires once per bounded id at play/activation time, right after
   * the choice is validated against its bounds and before the card's response
   * window, so the pick lands with the card that used it. The chosen-value
   * mirror of `variableRolled`; informational only — no rule keys off it.
   */
  variableChosen: {
    sourceId: CardInstanceId;
    /** Who made the choice (the tactic's / ability's controller). */
    playerId: PlayerId;
    /** The variable's id in the `variableBounds` map, e.g. `"x"`. */
    name: string;
    value: number;
    /** Inclusive bounds the choice was constrained to. */
    min: number;
    max: number;
  };
}

export type GameEventType = keyof GameEventMap;

export type GameEvent = {
  [K in GameEventType]: { type: K } & GameEventMap[K];
}[GameEventType];
