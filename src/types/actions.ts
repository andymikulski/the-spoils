// -----------------------------------------------------------------------------
// Player actions
// -----------------------------------------------------------------------------

import type { AbilityId, CardInstanceId, PlayerId } from "./ids.js";
import type { BattleDamageAssignment } from "./state.js";
import type { TriggerRef } from "./choices.js";

/**
 * The players an action names, keyed by what they answer: `opponent` is the block's opponent ("your opponent",
 * "both players", MP 2 / MP 3), asked before any target is chosen and required whenever the block says so and the
 * controller has two or more opponents (left out, or naming nobody that is an opponent in the game, it is refused;
 * with one opponent left it is not needed and must not name anybody else). Every other key is the id of a
 * `playerChoices` entry (`{ type: "chosenPlayer", id }` reads it back). `SpoilsEngine.getPlayRequirements` lists
 * what is still missing.
 */
export type PlayerAnswers = Record<string, PlayerId>;

export type GameAction =
  | {
      type: "playCard";
      playerId: PlayerId;
      cardId: CardInstanceId;
      selected?: Record<string, CardInstanceId[]>;
      /** Player-chosen numeric variables ("choose a number for X"), see NumberExpression's "variable" case. */
      variables?: Record<string, number>;
      /**
       * Values named for `nameValue` COST steps ("Name a card."), keyed by the step's `storeAs`. Omitted for a
       * step that needs one: the engine opens a `nameValue` prompt (with `resumeAction`) and re-runs this action
       * with the answer merged in.
       */
      named?: Record<string, string>;
      /**
       * For a modal tactic (`CardDefinition.behavior.modes`) — the chosen
       * mode index ("Choose one of the following as this card's rules
       * text"). Defaults to 0.
       */
      mode?: number;
      /**
       * Which unattached resources pay this action's numeric cost ("Pay N"), instead of the engine's default
       * pick. The listed cards are spent first; if fewer than the amount are listed the engine fills the rest
       * itself, and listing more than the amount (or a card that is not an available resource) is refused.
       * A FLIP UP may list the card being flipped (CR 507.4b: it can help pay its own cost).
       * `SpoilsEngine.getPaymentOptions` says how many and from which cards.
       */
      payWith?: CardInstanceId[];
      /** Players named with the action: see `PlayerAnswers`. */
      players?: PlayerAnswers;
    }
  | {
      type: "activateAbility";
      playerId: PlayerId;
      cardId: CardInstanceId;
      abilityId: AbilityId;
      selected?: Record<string, CardInstanceId[]>;
      variables?: Record<string, number>;
      /**
       * Values named for `nameValue` COST steps ("Name a card."), keyed by the step's `storeAs`. Omitted for a
       * step that needs one: the engine opens a `nameValue` prompt (with `resumeAction`) and re-runs this action
       * with the answer merged in.
       */
      named?: Record<string, string>;
      /**
       * Which unattached resources pay this action's numeric cost ("Pay N"), instead of the engine's default
       * pick. The listed cards are spent first; if fewer than the amount are listed the engine fills the rest
       * itself, and listing more than the amount (or a card that is not an available resource) is refused.
       * A FLIP UP may list the card being flipped (CR 507.4b: it can help pay its own cost).
       * `SpoilsEngine.getPaymentOptions` says how many and from which cards.
       */
      payWith?: CardInstanceId[];
      /** Players named with the action: see `PlayerAnswers`. */
      players?: PlayerAnswers;
    }
  | {
      /**
       * Flip up a face-down resource this player controls, paying its
       * `CardDefinition.flipUp` cost, and resolve it as its real card type
       * with `deployedViaFlipUp` set. `selected`/`variables` supply any
       * EXTRA COST picks / chosen numbers the flipped card needs.
       */
      type: "flipUp";
      playerId: PlayerId;
      cardId: CardInstanceId;
      selected?: Record<string, CardInstanceId[]>;
      variables?: Record<string, number>;
      /**
       * Which FLIP UP option to pay when the card has more than one (a
       * printed one plus a granted one, e.g. Woadenworm Gloamspike's): an
       * index into `getFlipUpOptions(cardId)` (printed first, then the
       * granted one). Omitted: the first option whose threshold is met and
       * whose cost the player can cover (the printed one wins ties). An
       * index outside the list is refused.
       */
      flipUpOption?: number;
      /**
       * Values named for `nameValue` COST steps ("Name a card."), keyed by the step's `storeAs`. Omitted for a
       * step that needs one: the engine opens a `nameValue` prompt (with `resumeAction`) and re-runs this action
       * with the answer merged in.
       */
      named?: Record<string, string>;
      /** For a modal tactic: the chosen mode index (required when the card has 2+ modes), as for `playCard`. */
      mode?: number;
      /**
       * Which unattached resources pay this action's numeric cost ("Pay N"), instead of the engine's default
       * pick. The listed cards are spent first; if fewer than the amount are listed the engine fills the rest
       * itself, and listing more than the amount (or a card that is not an available resource) is refused.
       * A FLIP UP may list the card being flipped (CR 507.4b: it can help pay its own cost).
       * `SpoilsEngine.getPaymentOptions` says how many and from which cards.
       */
      payWith?: CardInstanceId[];
      /** Players named with the action: see `PlayerAnswers`. */
      players?: PlayerAnswers;
    }
  | {
      type: "passPriority";
      playerId: PlayerId;
    }
  | {
      type: "mulligan";
      playerId: PlayerId;
      cardIds: CardInstanceId[];
    }
  | {
      /**
       * Answers the `chooseStartingResources` setup phase: the staple
       * resource instances (from this player's deck) their faction starts
       * with in play. `cardIds.length` must equal the phase's `counts` for
       * this seat; each must be a staple resource still in the deck.
       */
      type: "chooseStartingResources";
      playerId: PlayerId;
      cardIds: CardInstanceId[];
    }
  | {
      /**
       * Answers the `chooseFirstPlayer` setup phase (CR 601.1c): the deciding
       * player names who takes the first turn: any player, themselves included.
       */
      type: "chooseFirstPlayer";
      playerId: PlayerId;
      firstPlayerId: PlayerId;
    }
  | {
      type: "endTurn";
      playerId: PlayerId;
    }
  | {
      type: "declareAttack";
      playerId: PlayerId;
      attackerIds: CardInstanceId[];
      /**
       * Omitted: the attack defaults to "your opponent's faction" (CR 608.1a): the one opponent, or with two or more
       * opponents the faction of the opponent selected in `players.opponent` (MPX-attack-default (2)). With two or more
       * opponents and neither a target nor a selection the announcement is refused (MPX-attack-default (3)).
       */
      target?:
        | { type: "faction"; playerId: PlayerId }
        | { type: "card"; cardId: CardInstanceId };
      /** `opponent`: the attacker's selected opponent for this attack (MP 2), whose faction an untargeted attack defaults to. */
      players?: PlayerAnswers;
    }
  | {
      type: "declareBlockers";
      playerId: PlayerId;
      blockerIds: CardInstanceId[];
    }
  | {
      /** Resolve one automatic game-flow step. */
      type: "advanceFlow";
    }
  | {
      /** Backward-compatible alias for advanceFlow while a battle exists. */
      type: "advanceBattle";
      playerId: PlayerId;
    }
  | {
      type: "assignBattleDamage";
      playerId: PlayerId;
      assignments: BattleDamageAssignment[];
    }
  | {
      /** Answers the currently open GameState.pendingChoice. */
      type: "resolvePendingChoice";
      playerId: PlayerId;
      choice:
        | { kind: "uniqueSurvivor"; keep: CardInstanceId }
        | { kind: "selectTargets"; selected: Record<string, CardInstanceId[]> }
        /** Answers a `PendingDeployTargetChoice` (Hammer Smash's "pick X or fewer" once the roll is known). */
        | { kind: "selectDeployTargets"; selected: Record<string, CardInstanceId[]> }
        /**
         * Pick the *next* trigger to resolve out of the batch still waiting
         * (CR §503.4a — the order is decided one at a time, resolving one
         * before choosing the next, not as a full permutation up front).
         */
        | { kind: "orderTriggers"; next: TriggerRef }
        | {
            kind: "chooserSelectsTarget";
            selected: CardInstanceId[];
            /**
             * An OPTIONAL deck search ("you may search ...") answered with
             * `declined: true` is no search at all: nothing is searched and
             * the deck is NOT shuffled (Q2). `selected: []` without it means
             * the player searched and found nothing, which does shuffle
             * (CR 312.1 / 312.2). Declaring a search's target in a play /
             * activate action or a `selectTargets` answer: add an empty
             * `selected["__declined:<declarationId>"]` entry.
             */
            declined?: boolean;
            /**
             * When the picked card is about to be played as a resource ("play a resource"), say right away whether an actual
             * resource card goes in face-down (Volition, CR 203.2) instead of being asked afterwards (`playResource`).
             */
            faceDown?: boolean;
          }
        | { kind: "chooserSelectsOption"; index: number }
        | {
            kind: "reorderDeck";
            /**
             * For `to: "top"` / `"bottom"` — the full set of looked-at cards
             * in the chosen order. For `to: "split"` — the cards to LEAVE ON
             * TOP, in order; `bottom` names the rest, in order (the two must
             * partition the looked-at set).
             */
            order: CardInstanceId[];
            /** `to: "split"` only — the looked-at cards to send to the deck bottom, in order. */
            bottom?: CardInstanceId[];
            /**
             * Only when the pending choice has `intoHand`: the looked-at cards
             * taken into the hand (between `intoHand.min` and `.max`). `order`
             * then lists ALL the remaining cards, in the order they go on the
             * bottom of the deck.
             */
            hand?: CardInstanceId[];
          }
        | {
            kind: "deployForFree";
            /** Omit to decline. */
            cardId?: CardInstanceId;
            /** The chosen card's own extra-cost target declarations, same shape as playCard's `selected`. */
            selected?: Record<string, CardInstanceId[]>;
            variables?: Record<string, number>;
            /** The chosen card's players, same shape as playCard's `players`. */
            players?: PlayerAnswers;
          }
        | {
            kind: "distributeAmong";
            /** Per-card shares; omitted/zero cards receive nothing. Must sum to the pending amount. */
            shares: Record<CardInstanceId, number>;
          }
        | {
            kind: "pileAssignment";
            /** The two piles — together they must be exactly the pending cards, disjoint. Either may be empty. */
            pile1: CardInstanceId[];
            pile2: CardInstanceId[];
          }
        | { kind: "replacementChoice"; apply: boolean }
        /** Which of several replacements applies (CR 506.4): an index into the pending choice's `options`. */
        | { kind: "chooseReplacement"; index: number }
        | { kind: "nameValue"; value: string }
        /** "Play a resource" with a real resource card: face-down (Volition) or face-up. */
        | { kind: "playResource"; faceDown: boolean }
        /** "You may reveal this card as you are playing a resource" (Witty Worm): reveal-deploy `cardId`, or omit it to decline. */
        | {
            kind: "resourceReveal";
            cardId?: CardInstanceId;
            /** The revealed card's own extra-cost target declarations, same shape as playCard's `selected`. */
            selected?: Record<string, CardInstanceId[]>;
            variables?: Record<string, number>;
            /** The revealed card's players, same shape as playCard's `players`. */
            players?: PlayerAnswers;
          }
        | { kind: "chooseNumber"; value: number }
        /** Answers a `choosePlayer` prompt: one of its `candidates`. */
        | { kind: "choosePlayer"; playerId: PlayerId }
        | { kind: "mayPay"; pay: boolean }
        | { kind: "alternatingPay"; pay: boolean }
        | { kind: "anyPlayerMayPay"; pay: boolean }
        | {
            kind: "useTargetAbility";
            /** Omit to decline. */
            abilityId?: AbilityId;
            selected?: Record<string, CardInstanceId[]>;
            variables?: Record<string, number>;
            /** The ability's players, same shape as activateAbility's `players`. */
            players?: PlayerAnswers;
          }
        | {
            kind: "useAnyAbility";
            /** Which controlled card's ability to use; omit to decline. Leads to a follow-up `useTargetAbility` choice. */
            cardId?: CardInstanceId;
          }
        /** MUSTACHE SHOWDOWN — `piles` must partition the revealed cards into the pending choice's `piles` non-empty groups. */
        | { kind: "partitionCards"; piles: CardInstanceId[][] }
        /** MUSTACHE SHOWDOWN — index into the opponent's piles. */
        | { kind: "pickPile"; index: number }
        /** MUSTACHE SHOWDOWN — 0..`max` of the winning pile's cards to move to hand. */
        | { kind: "takeFromPile"; cardIds: CardInstanceId[] }
        /** Auction House — `bid` is 0 (pass) or an integer in (`highBid`, `maxBid`]. */
        | { kind: "auctionBid"; bid: number }
        /** Trickster's Globe — how many points of the damage become milled cards, in [0, `max`]. */
        | { kind: "millInsteadOfDamage"; count: number }
        /** Two-Headed Coin — pay to reflip a lost coin flip, or accept the loss. */
        | { kind: "coinFlipReplace"; reflip: boolean }
        /** Wyrmfang Deathskull — the subset of candidates that may block this battle. */
        | { kind: "chooseChosenBlockers"; cardIds: CardInstanceId[] }
        /**
         * Voidal Poisoning — fire menu option `optionIndex`, pulling its
         * `cost` markers from the pool cards named in `sources` (one id per
         * marker; repeats allowed). `optionIndex: null` stops the loop.
         */
        | {
            kind: "spendCountersMenu";
            optionIndex: number | null;
            sources?: CardInstanceId[];
          };
    };
