// -----------------------------------------------------------------------------
// Costs
// -----------------------------------------------------------------------------

import type { CardSelector, NumberExpression, PlayerRef, TargetDeclaration, TargetRef } from "./expressions.js";
import type { Effect } from "./effects.js";
import type { Zone } from "./ids.js";

/**
 * One increase or reduction of a numeric cost (CR 406.3). `minCost` is "to a minimum of N" on a reduction (it does
 * not raise a value that was already below N, CR 410.5) and "increased to a minimum of N" on a raise.
 */
export interface NumericCostAdjust {
  delta: number;
  minCost?: number;
}

/**
 * What another player (or the payer, for a division) already answered for a cost step of a paused play, keyed by the
 * step's position in the cost list. Engine-internal: it rides inside the engine's own prompts (never the client's
 * action), so a client cannot forge the opponent's answer. See `otherPlayerChooses` / `distribute` / `alternatingPay`.
 */
export interface CostAnswer {
  /** The cards picked. */
  ids?: string[];
  /** The option chosen (a `may` step: 0 = decline, 1 = yes). */
  index?: number;
  /** The division of a `distribute` step. */
  shares?: Record<string, number>;
  /** The finished `alternatingPay` loop: [first's payments, opponent's payments]. */
  tallies?: [number, number];
  /** Under the engine's `__committed` key: how many steps of the ordered cost list the paused play already paid. */
  committed?: number;
}

export type Cost =
  | {
      type: "payResources";
      amount: NumberExpression;
      /** Engine-internal, never authored. The other "pay N" extra costs folded into this one running total (CR 406.3); each is floored at 0 on its own. */
      plus?: NumberExpression[];
      /**
       * Engine-internal, never authored. The increases and reductions that apply to this numeric cost (CR 406.3),
       * in the order they are applied (every increase, then every reduction), folded into the payment so the
       * amount is only fixed when it is paid (after the earlier cost steps have bound their variables).
       */
      adjust?: NumericCostAdjust[];
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
      /** A number or an expression ("Discard X cards": `{ "type": "variable", "id": "x" }`). */
      count: NumberExpression;
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
       * `reveal: true` shows the chosen cards to everyone (a
       * `cardsRevealed` event from the zone they leave) as the cost is paid
       * — "Reveal a resource from your hand and shuffle it into your deck".
       */
      type: "moveSelected";
      id: string;
      player: PlayerRef;
      selector: CardSelector;
      count: NumberExpression;
      to: Zone;
      position?: "top" | "bottom";
      reveal?: boolean;
      /**
       * Whose hand or deck receives the cards when `to` is `"hand"` or
       * `"deck"`. Omitted: each card's owner. "Shuffle this card into YOUR
       * deck" (Two-Headed Coin) sets it, so a coin you control but don't own
       * goes into your deck (`CardInstance.heldBy`). Ignored for every other
       * zone.
       */
      toPlayer?: PlayerRef;
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
       * "Reveal this card from your hand." Information only: emits
       * `cardsRevealed` for the ability's source card; it stays in the zone
       * it is in. Always payable. Unexpected Codicil (FINE PRINT).
       */
      type: "revealSelf";
    }
  | {
      /**
       * "Pay 1 or destroy a Micromajig token you control." — the engine
       * auto-pays the first fully-payable branch (a player-choice variant
       * is future work). Time Traveler Tourist Trap.
       */
      type: "oneOf";
      options: Cost[][];
      /** One label per branch, shown by the prompt that asks the payer which branch ("Choose a card type": `["character", "item", …]`). Without it the label is built from the branch's steps. */
      labels?: string[];
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
    }
  | {
      /**
       * Marks WHERE in the written cost order a pick is made. The pick is a
       * normal `targets` declaration (`declarationId` names it, and the action
       * supplies it in `selected` as always); this step validates it against
       * the board AS IT IS after the cost steps written before it have been
       * paid (Q15, SYS-16): "Destroy this card. Pick a character" cannot pick
       * the card just destroyed; "Deplete this card. Pick a depleted
       * character" can pick this card; "Remove this card from the game. Pick a
       * tactic in your discard pile" cannot pick this card. A declaration with
       * NO `pick` step is validated before any cost is paid, as before.
       * (`declaration` / `costBound` are filled in by the engine at play time;
       * never author them.)
       */
      type: "pick";
      declarationId: string;
      declaration?: TargetDeclaration;
      costBound?: boolean;
    }
  | {
      /**
       * "X is the picked character's strength." / "Y is twice this card's
       * strength." Evaluates `value` NOW, as this cost step is paid, and
       * locks it into the play's `variables[id]` (Q8): the effect reads the
       * locked number at resolution, whatever the opponent does in response.
       * Always overwrites (a client can't supply it). Write it AFTER the pick
       * it reads and BEFORE a step that changes the thing it reads ("X is its
       * strength. Destroy it" = bind, then destroy).
       */
      type: "bindVariable";
      id: string;
      value: NumberExpression;
    }
  | {
      /**
       * Runs ordinary effects as a cost step, in written order: "flip a
       * coin", "reveal a face-down item", "put a token on this card", "draw 3
       * cards", "this card loses 2 life this turn", "flip this card
       * face-down", "remove the top card of your deck from the game", "put it
       * on the bottom of its owner's deck", "put X characters into the void".
       * The effects see the play's context (`selected`, `variables`), run when
       * the cost is paid (before any response) and must not ask anybody a
       * question: a step that would leave a pending choice makes the play
       * illegal. Use the typed steps for anything the player decides
       * (`nameValue`, `pick`, `oneOf`, `destroy` of "a card you control").
       */
      type: "effects";
      effects: Effect[];
      /** Engine-internal (the FLIP UP line's "and play a resource"): a prompt the effects raise stays open. Never author it. */
      allowPending?: boolean;
      /** Engine-internal: the answer to the face-up / face-down question of a resource these effects play. Never author it. */
      resourceFaceDown?: boolean;
    }
  | {
      /**
       * "Name a card." / "Choose a resource icon." / "Choose a threshold
       * type." as a cost: the payer names the value while playing the card or
       * using the ability, before any response window. The name arrives on the
       * action (`named: { [storeAs]: value }`); when it is missing the engine
       * opens a `nameValue` prompt (with `resumeAction`) and re-runs the action
       * with the answer merged in. Stored on the source card under `storeAs`
       * exactly like the `nameValue` effect (`nameVar` selectors,
       * `{ "fromNamed": storeAs }` icons, `named` conditions all read it).
       */
      type: "nameValue";
      valueKind: "subtype" | "cardName" | "resourceIcon" | "trade";
      storeAs: string;
      exclude?: string[];
      nonResource?: boolean;
    }
  | {
      /**
       * A cost step ANOTHER player decides (E3c): "Your opponent may detach up
       * to 3 resources.", "That character's controller may detach up to 2
       * resources.", "That character's controller picks a resource they
       * control. Put the resource into its owner's hand.", "That player may put
       * a Micromajig token into play under their control." While the card is
       * played (or the ability used), BEFORE anything is paid, the engine asks
       * `chooser` (a `chooserSelectsTarget` for `declaration`, or a
       * yes/no `chooserSelectsOption` for a `may` step without a pick) with
       * the paused action as `resumeAction`; answering re-runs the play with the
       * answer. Then `effects` run as the cost is paid, with the chooser's pick
       * in `selected[declaration.id]` (and nothing at all when a `may` is
       * declined). The answer cannot be forged through the action: it only
       * travels inside the engine's own prompt.
       *
       * A mandatory pick with no legal candidate cannot be paid: the play is
       * refused ("unplayable if that controller has no resource to pick"). An
       * optional pick with nothing to pick, or a `may` whose effects could
       * not be carried out, needs no answer. The step's effects must not ask
       * anybody a question.
       */
      type: "otherPlayerChooses";
      /** Who decides, resolved in the play's context: "opponent", `{ controllerOf: selected c }`, ... */
      chooser: PlayerRef;
      /** The chooser's pick. Selectors read like any pick's (`owner: "opponent"` is the CASTER's opponent). */
      declaration?: TargetDeclaration;
      /** No pick: the chooser answers yes / no ("That player may put a token into play"); `effects` run on yes. */
      may?: boolean;
      effects: Effect[];
      /** Engine-internal: this step's slot in the paused play's answers (`withPickDeclarations` fills it). Never author it. */
      answerKey?: string;
    }
  | {
      /**
       * "Remove X tokens from cards you control" as a cost, the payer dividing
       * the X among the cards however they like (Voidal Humour Redistribution).
       * The cards come from the `selected` pick (a `targets` declaration); the
       * payer is asked for the division while playing (a `distributeAmong`
       * prompt with `resumeAction`), nothing is paid until it is answered, and
       * `effects` then run once per card with a share (`__candidate`, share in
       * `variable __amount`) as the cost is paid. `maxShare` caps one card's
       * share. All `amount` must be divided: a play whose cards cannot give
       * that much is refused.
       */
      type: "distribute";
      selected: string;
      amount: NumberExpression;
      maxShare?: NumberExpression;
      effects: Effect[];
      /** Engine-internal: see `otherPlayerChooses`. Never author it. */
      answerKey?: string;
    }
  | {
      /**
       * "You may pay 1. If you do, that opponent may pay 1. Repeat this cost
       * until you or your opponent does not pay." as a COST (Negotiation
       * Ceremonies). The loop is run while the card is played: each player in
       * turn is asked (an `alternatingPay` prompt with `resumeAction`) and a yes
       * spends `cost` at once; a player who cannot pay (or could not still pay
       * the card's own numeric cost, for the player) is not asked and ends the
       * loop. When it ends the tallies are locked into the play's variables
       * (`__paidByFirst`, `__paidByOpponent`, `paid:<playerId>`) for the effect
       * ("each player draws cards equal to the amount they paid").
       */
      type: "alternatingPay";
      first: PlayerRef;
      opponent: PlayerRef;
      cost: Cost[];
      maxRounds?: number;
      /** Engine-internal: see `otherPlayerChooses`. Never author it. */
      answerKey?: string;
    };
