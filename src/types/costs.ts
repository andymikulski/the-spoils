// -----------------------------------------------------------------------------
// Costs
// -----------------------------------------------------------------------------

import type { CardSelector, NumberExpression, PlayerRef, TargetRef } from "./expressions.js";
import type { Zone } from "./ids.js";

export type Cost =
  | {
      type: "payResources";
      amount: NumberExpression;
    }
  | {
      type: "deplete";
      target: TargetRef;
    }
  | {
      type: "discard";
      /** Referenced via ResolutionContext.selected[id], same as a target declaration. */
      id: string;
      player: PlayerRef;
      selector: CardSelector;
      count: number;
    }
  | {
      type: "destroy";
      target: TargetRef;
    }
  | {
      /**
       * Move `count` chosen cards (matching `selector`, controlled by
       * `player`, default zone `play`) to `to` as a cost — paid like
       * `discard`, but to any zone: `position` for a deck destination,
       * `shuffle: true` to reshuffle that deck afterward ("reveal a resource
       * from your hand and shuffle it into your deck"; "put a resource you
       * control into its owner's hand" — Uhluhtc Niudla). Chosen via
       * `context.selected[id]`, legality-checked up front, all-or-nothing.
       */
      type: "moveSelected";
      id: string;
      player: PlayerRef;
      selector: CardSelector;
      count: number;
      to: Zone;
      position?: "top" | "bottom";
      shuffle?: boolean;
    }
  | {
      /**
       * "Remove N tokens from this card" as a cost (e.g. an EJECT-style
       * ability). Unlike the `removeCounter` *effect* (RULES.md §12:
       * post-commitment resolution clamps to what's actually there), a cost
       * must be fully payable or the whole activation fails — this throws
       * if the card doesn't have `amount` counters to remove.
       */
      type: "removeCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
      /**
       * Depletes every card already selected under `declarationId` (a
       * TargetDeclaration whose `count` may be variable/plural) — "deplete
       * X characters you control" as a cost. All-or-nothing like any other
       * cost: throws (nothing depleted) if any of them is already
       * depleted, rather than partially paying.
       */
      type: "depleteSelected";
      declarationId: string;
    }
  | {
      /**
       * "Remove <target> from the game" as a cost — typically `"source"`
       * (e.g. a RECUR ability that exiles itself from the discard pile).
       * Throws if `target` doesn't resolve to a real card, like the other
       * card-consuming costs.
       */
      type: "removeFromGame";
      target: TargetRef;
    }
  | {
      /**
       * Consumes every card already selected under `declarationId` by the
       * given `disposition` — "remove X tactics in your discard pile from
       * the game" as a cost. All-or-nothing.
       */
      type: "sacrificeSelected";
      declarationId: string;
      disposition: "removeFromGame" | "destroy" | "discard";
    }
  | {
      /**
       * "Inflict N damage to <target>" as a cost — typically `"source"`, for
       * a location that spends its own structure to activate an ability
       * (e.g. "Inflict 1 damage to this location. If you do, ..."). Always
       * payable (a card can always take damage); the resulting destruction,
       * if any, is handled by the normal state-based check after the
       * ability resolves.
       */
      type: "dealDamage";
      target: TargetRef;
      amount: NumberExpression;
    }
  | {
      /**
       * "Shuffle your deck" as a cost (typically one branch of a `oneOf` —
       * "Pay 3 or shuffle your deck", Dweedle Tee). Always payable; shuffles
       * `player`'s (default `"controller"`) deck in place.
       */
      type: "shuffleDeck";
      player?: PlayerRef;
    }
  | {
      /**
       * "Pay 1 or destroy a Micromajig token you control." — the engine
       * auto-pays the first fully-payable branch (a player-choice variant
       * is future work). Time Traveler Tourist Trap.
       */
      type: "oneOf";
      options: Cost[][];
    }
  | {
      /**
       * "Your faction loses N influence." as an ability / EXTRA cost —
       * distinct from the `modifyInfluence` effect (which is an *effect*, so
       * a replacement could theoretically touch it, and it isn't tied to
       * paying for something). Always payable (influence can always drop);
       * any resulting loss is left to the win-condition state-based check.
       * Discordant Cadencer, Eustace Padamose-Gristwalter, Thabbashite
       * Armorer, Thabbashite Financier.
       */
      type: "loseInfluence";
      amount: NumberExpression;
      player?: PlayerRef;
    };
