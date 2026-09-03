// -----------------------------------------------------------------------------
// References / expressions / selectors
// -----------------------------------------------------------------------------

import type { CardInstanceId, CardType, PlayerId, Stat, Zone } from "./ids.js";
import type { Condition } from "./conditions.js";
import type { ResourceIcon } from "./cards.js";

export type PlayerRef =
  | "controller"
  | "owner"
  | "activePlayer"
  | "opponent"
  | { type: "player"; id: PlayerId }
  /** The owner of a targeted card (e.g. "any one deck" — the caster picks a faction card, this resolves to that player). */
  | { type: "ownerOf"; target: TargetRef }
  /** The *current controller* of a targeted card ("that character's controller ..."), which can differ from its owner after a take-control effect. */
  | { type: "controllerOf"; target: TargetRef };

export type TargetRef =
  | "source"
  /** The card `source` is currently attached to ("Attach to X"), if any. */
  | "attachedTo"
  /**
   * The card most relevant to the current triggering event (same mapping
   * `sourceIsEventCard` compares against — e.g. the *target* for
   * `damageDealt`). Lets a condition inspect that card's own properties
   * (e.g. `cardTypeIs` to check "damage to a faction"), not just test
   * equality with `source`.
   */
  | "eventCard"
  /** Bare-string aliases accepted for `{ type: "respondedToCard" }` and `{ type: "respondedAbilitySource" }`. */
  | "respondedToCard"
  | "respondedAbilitySource"
  | { type: "selected"; id: string }
  | { type: "card"; id: CardInstanceId }
  /** A uniformly random card matching `selector` (e.g. "discard a card at random"), or nothing if none match. */
  | { type: "random"; selector: CardSelector }
  /**
   * A card at a fixed position in a deck — `index` from the `top` or
   * `bottom` (default `index` 0, i.e. "the top card of your deck").
   * Resolves to nothing if the deck is too short. Pair with `cardCost` for
   * "gains strength equal to the numeric cost of the top card of your
   * deck", or use it as a `moveCard`/`destroy` target.
   */
  | { type: "deckPosition"; player: PlayerRef; from: "top" | "bottom"; index?: number }
  /**
   * The card being responded to — the newest `kind: "card"` item on the
   * response stack that isn't the source of the current ability. `undefined`
   * outside a response window. Pairs with the `respondingTo` condition.
   */
  | { type: "respondedToCard" }
  /**
   * The source card of the current `damageDealt` triggering event
   * (`event.sourceId`) — the thing that dealt the damage, as opposed to
   * `"eventCard"` which resolves to what was damaged. `undefined` outside a
   * `damageDealt` event.
   */
  | { type: "damageSource" }
  /** A player's faction card instance — "attach it to that player's faction". */
  | { type: "factionOf"; player: PlayerRef }
  /** A card `source` earlier "remembered" under `key` (see the `rememberTarget` effect); `undefined` if none / it left play. */
  | { type: "remembered"; key: string }
  /**
   * The in-play card of `cardType` that the responded-to stack item picked
   * as an EXTRA COST — the read side of the `respondedToPicked` *condition*
   * (and of what `retargetExtraCost` rewrites). "Put the character [that the
   * responded-to card/ability picked] into its owner's hand." (Catastrophic
   * Caper). `undefined` outside a response window / if no such pick.
   */
  | { type: "respondedToPicked"; cardType: CardType }
  /**
   * The card `target` is currently attached to ("Attach to X") — the general
   * form of `"attachedTo"`, which only resolves for `"source"`. "Inflict X
   * damage to the character the gear card is attached to." (Scorching
   * Runicution — `target` a picked gear item). `undefined` if `target` isn't
   * attached to anything.
   */
  | { type: "attachmentHost"; target: TargetRef }
  /**
   * The most recently RESOLVED tactic card this turn
   * (`GameState.lastDeployedTacticId`; cleared each turn). "Duplicate the
   * last tactic deployed this turn" (Voidal Replication) — pass it as
   * `duplicate`'s `target`, which re-resolves that tactic's effects from
   * its definition (it is no longer on the stack). `undefined` if no tactic
   * has resolved this turn.
   */
  | { type: "lastDeployedTactic" }
  /**
   * The source card of the responded-to *ability* on the response stack —
   * the newest `kind: "ability"` item that isn't the current ability's own.
   * Parallel to `respondedToCard` (which only sees `kind: "card"` items).
   * "Terminate the ability. Destroy the character [whose ability it was]"
   * (Exploding Sock Puppet!); "an ability that's source was not a faction"
   * (Subsection 5, Paragraph 12). `undefined` outside a response window / if
   * the newest non-self item is a card.
   */
  | { type: "respondedAbilitySource" };

export type NumberExpression =
  | number
  | {
      type: "stat";
      target: TargetRef;
      stat: Stat;
    }
  | {
      type: "counter";
      target: TargetRef;
      counter: string;
    }
  | {
      type: "count";
      selector: CardSelector;
    }
  | {
      type: "add";
      values: NumberExpression[];
    }
  | {
      type: "multiply";
      values: NumberExpression[];
    }
  | {
      /**
       * A player-chosen numeric variable ("choose a number for X"), read
       * from `ResolutionContext.variables[id]`. Reads as 0 if never
       * assigned (RULES.md §12).
       */
      type: "variable";
      id: string;
    }
  | {
      /** A uniformly random integer in [min, max] (inclusive), e.g. a coin flip is `{ min: 1, max: 2 }`. */
      type: "random";
      min: NumberExpression;
      max: NumberExpression;
    }
  | {
      /** A card's printed numeric cost (`CardDefinition.cost`) — not a runtime `Stat`, so `stat` can't reach it. */
      type: "cardCost";
      target: TargetRef;
    }
  | {
      /**
       * A card's printed BASE stat (`CardDefinition.strength/life/speed/
       * influence/structure`), before any runtime modifier — parallel to
       * `cardCost`, and distinct from `stat` (which is the live value). Reads
       * as 0 if the definition doesn't carry that stat. E.g. "loses life
       * equal to its printed life minus 2".
       */
      type: "printedStat";
      target: TargetRef;
      stat: Stat;
    }
  | {
      /**
       * How many of a given resource `icon` `player` controls in play — the
       * sum of `getResourceIcons` over their in-play resources (face-up
       * printed icons, plus Volition for each face-down resource). Also the
       * idiom for "while you control at least [X][X]" gates, via
       * `numberCompare` against a literal.
       */
      type: "resourceIcons";
      player: PlayerRef;
      icon: ResourceIcon;
    }
  | {
      /** `value / by`, rounded per `rounding` (e.g. "half its numeric cost, rounded up" is `{ value: ..., by: 2, rounding: "up" }`). Division by 0 reads as 0. */
      type: "divide";
      value: NumberExpression;
      by: NumberExpression;
      rounding: "up" | "down";
    }
  | {
      /** `value % by` (always >= 0). Division by 0 reads as 0. Useful for parity, e.g. "an even number of cards" is `{ type: "numberCompare", left: { type: "modulo", value: ..., by: 2 }, operator: "=", right: 0 }`. */
      type: "modulo";
      value: NumberExpression;
      by: NumberExpression;
    }
  | {
      /** The number of cards currently bound under `ResolutionContext.selected[id]` — e.g. "X is the number of characters you depleted this way." Reads as 0 if `id` was never bound. */
      type: "selectionCount";
      id: string;
    }
  | {
      /** Sum of `stat` (the live value) over every in-play card matching `selector` — "X is the total strength of all characters your opponents control." */
      type: "sumStat";
      selector: CardSelector;
      stat: Stat;
    }
  | {
      /**
       * Sum of printed numeric `cost` over every in-play card matching
       * `selector` — "X is the total numeric cost of all non-resource cards
       * you control." (Reality Shift). Parallel to `sumStat`, but `cost`
       * is a card-definition field, not a live stat.
       */
      type: "sumCost";
      selector: CardSelector;
    }
  | {
      /**
       * Total number of `counter` markers across every in-play card matching
       * `selector` — parallel to `sumStat`. Bounds a player-chosen X to the
       * tokens actually available ("Remove X tokens from cards you control";
       * Voidal Humour Redistribution — `variableBounds.max`).
       */
      type: "sumCounters";
      selector: CardSelector;
      counter: string;
    }
  | {
      /**
       * The number of threshold icons in `target`'s printed threshold — the
       * length of the icon string (`"rrr"` → 3), or the value of a numeric
       * threshold. "X is the number of threshold icons of the character."
       */
      type: "thresholdIconCount";
      target: TargetRef;
    }
  | {
      /**
       * The damage amount of the current `damageDealt` triggering event — 0
       * outside one. "put the top X cards of that deck into the discard pile,
       * where X is the amount of damage inflicted by this character."
       */
      type: "eventDamageAmount";
    }
  | {
      /**
       * The `count` of the current `cardsDrawn` triggering event — 0 outside
       * one. Parallel to `eventDamageAmount`. "your faction gains X
       * influence, where X is the number of cards drawn." (Gold Summit).
       */
      type: "eventDrawAmount";
    }
  | {
      /**
       * How many cards `player` (omitted = any player) deployed via
       * `playCard` this turn, optionally filtered to / away from a card
       * type. "2 other non-resource cards this turn" (633fy 31f —
       * `notCardType: "resource"`), "an opponent deployed a character this
       * turn" (Slingerang — `player: "opponent", cardType: "character"`), "a
       * tactic has been deployed this turn" (Voidal Replication —
       * `cardType: "tactic"`, no `player`).
       */
      type: "deploysThisTurn";
      player?: PlayerRef;
      cardType?: CardType;
      notCardType?: CardType;
    }
  | {
      /**
       * `then` when `if` holds, otherwise `else` — "X is 4 if you deployed
       * this card using FLIP UP, otherwise 2".
       */
      type: "conditional";
      if: Condition;
      then: NumberExpression;
      else: NumberExpression;
    }
  | {
      /**
       * The member count of a battle party in the current battle (0 with no
       * battle). `side`:
       * - `"attacking"` / `"blocking"` — that party outright.
       * - `"ownParty"` — the party `of` (default `"source"`) is in.
       * - `"opposingParty"` — the other party from the one `of` is in.
       * "in a party with more than 1 member" (Callow Liegeman), "for each
       * member in the opposing party" (Fleshripping Scenepuller), "the number
       * of members in the attacking party" (Top-Secret Subterranean
       * Goofarium, Trip Wire).
       */
      type: "battlePartySize";
      side: "attacking" | "blocking" | "ownParty" | "opposingParty";
      of?: TargetRef;
    }
  | {
      /**
       * The highest (`"max"`) / lowest (`"min"`) live `stat` over every
       * in-play card matching `selector` — parallel to `sumStat`. `0` if
       * nothing matches. "the highest speed among characters in the opposing
       * party" (Martial Arts Master).
       */
      type: "extremumStat";
      selector: CardSelector;
      stat: Stat;
      direction: "min" | "max";
    }
  | {
      /**
       * The number of DISTINCT values of `by` among cards matching
       * `selector` (in-play by default; respects `selector.zone`). "X is the
       * number of different staple resources you control" (`by: "name"`,
       * `selector: { controller: "self", staple: true, type: "resource" }`);
       * "the number of different trades among cards you control"
       * (`by: "trade"`). `by: "subtype"` counts every distinct entry across
       * the matched cards' subtype lists.
       */
      type: "distinctCount";
      selector: CardSelector;
      by: "name" | "trade" | "subtype" | "type";
    };

export interface CardSelector {
  controller?: "self" | "opponent" | "any";
  owner?: "self" | "opponent" | "any";

  /**
   * The game area(s) this selector looks in. **When omitted, it matches
   * only the In-Play area** (CR §402.3 / §402.3a — "pick a character" means
   * a character *in play*). Set it explicitly to reach `hand` / `deck` /
   * `discard` / `void`. A few internal contexts pass a selector whose zone
   * is intentionally the card's current location rather than "in play" —
   * `deployForFree` (a hand card), `CostModifierDefinition` (a card being
   * deployed), the target of a `chooserSelectsTarget` over a prior
   * search/selection — those carry `zone: "any"` (or an explicit zone) so
   * this default doesn't over-narrow them.
   */
  zone?: Zone | Zone[] | "any";
  type?: CardType;
  /**
   * Exact printed-name match ("search your deck for a card named Elitism",
   * "a card named Micromajig") — compared against `CardDefinition.name`.
   * For "a card with the same name as this one" use a `cardNameEquals`
   * condition instead (that compares two cards, not a literal).
   */
  name?: string;
  /**
   * Match by Unique designation (`CardDefinition.unique`) — a single
   * designation or any of a list. "search your deck for a UNIQUE JO /
   * UNIQUE EUSTACE / …", "all UNIQUE EUSTACE gain +3/+3". Distinct from the
   * `hasUnique` condition (which only asks "has *any* designation").
   */
  uniqueDesignation?: string | string[];
  subtype?: string;
  /**
   * Match cards whose subtype list contains the string a `nameValue` effect
   * stored on the source card under this key ("cards with the named
   * subtype"). Takes precedence over `subtype` when both are set.
   */
  subtypeVar?: string;
  /**
   * Match cards whose printed `trade` equals a value a `nameValue`
   * (`valueKind: "trade"`) stored on the source card — one key, or any of a
   * list ("a character that is one of the [2] named trades"; Gathering of
   * Unlikely Heroes). Case-insensitive.
   */
  tradeVar?: string | string[];
  /**
   * Match cards whose printed `name` equals a `nameValue`
   * (`valueKind: "cardName"`) stored on the source card under this key —
   * "that player puts a card with the chosen name on the bottom of their
   * deck" (Odious Diva). The `nameVar` counterpart of the literal `name`.
   */
  nameVar?: string;

  depleted?: boolean;

  /**
   * Match resources by whether they are attached to a faction card:
   * `true` — only resources whose `CardInstance.attachedTo` points at a
   * faction (a normal face-up "attached to your faction" resource);
   * `false` — only *detached* resources (`attachedTo` unset), e.g. "the
   * number of detached resources that player controls" (Flesh Deliquesce)
   * or the pool for "detach up to 2 resources from their faction". Only
   * meaningful for `type: "resource"`.
   */
  attachedToFaction?: boolean;

  /**
   * Restrict to cards currently among the **top `fromTop`** of their
   * owner's deck — "reveal the top 5 cards of an opponent's deck. You may
   * choose a revealed character." (Rosy Palmer). May be a `NumberExpression`
   * for a player-chosen depth — "reveal up to the top X cards of an
   * opponent's deck" (Jackmove). Only meaningful with `zone: "deck"`; a card
   * not in a deck never matches. Pairs with a `lookAndReorder`
   * (`to: "bottom"`) over the leftovers.
   */
  fromTop?: number | NumberExpression;

  /** Match only staple resources (`ResourceDefinition.staple`) when `true`, only non-staples when `false`. "Search your deck for a staple resource." */
  staple?: boolean;

  /**
   * Match on face-down state. `true` — only face-down in-play cards, and a
   * `type` filter is matched against the card's REAL (hidden)
   * `definition.type` ("a face-down tactic you control"); face-down cards
   * are otherwise excluded from any typed selector. `false` — only face-up
   * cards. Omitted — the historical default (`type: "resource"` still
   * matches a face-down card as an anonymous resource; any other `type`
   * filter skips face-down cards).
   */
  faceDown?: boolean;

  conditions?: Condition[];
}

export interface TargetDeclaration {
  id: string;
  selector: CardSelector;
  /**
   * The maximum number of selections (may be a variable, e.g. a
   * `NumberExpression` tied to a coin flip — "pick X or fewer"). Without
   * `optional`, this is also the exact required count.
   */
  count: NumberExpression;
  /**
   * "You may pick..." / "N or fewer" — relaxes the requirement to
   * *between 0 and `count`* selections (inclusive) instead of exactly
   * `count`. Whenever at least one legal candidate exists, this always
   * requires a real decision (a `selectTargets` pending choice for
   * triggered abilities; an explicit `selected[id]: []`/fewer-than-count
   * array in the action for playCard/activateAbility) — it is never
   * auto-decided just because it happens to be unambiguous, the way a
   * mandatory declaration is. Gate effects that only happen "if you
   * picked at least one" with `{ type: "if", condition: { type:
   * "targetExists", target: ... } }` (checks the first selection, if any).
   */
  optional?: boolean;
  /**
   * "N cards with different names" (Cheats, Profane Proposal) — every
   * selection must have a distinct printed `CardDefinition.name`. Enforced
   * wherever selections are validated (`playCard`/`activateAbility`,
   * `selectTargets`, `chooserSelectsTarget`).
   */
  distinctNames?: boolean;
}
