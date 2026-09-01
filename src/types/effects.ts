// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

import type { CardType, Duration, Keyword, ModifierOperation, Restriction, Stat, Zone } from "./ids.js";
import type { CardSelector, NumberExpression, PlayerRef, TargetDeclaration, TargetRef } from "./expressions.js";
import type { Condition } from "./conditions.js";
import type { Cost } from "./costs.js";
import type { ResourceIcon } from "./cards.js";

export type Effect =
  | {
      type: "draw";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      /**
       * Play a selected card as a resource. "auto" plays actual resource
       * cards face-up and all other cards face-down. `player` (default the
       * ability's controller) is who plays it and under whose control it
       * enters — "that opponent puts a card from their hand face-down as a
       * resource under their control" (Man Shark, Forgotten Tentacle).
       */
      type: "playResource";
      target: TargetRef;
      faceDown: boolean | "auto";
      player?: PlayerRef;
    }
  | {
      type: "dealDamage";
      target: TargetRef;
      amount: NumberExpression;
    }
  | {
      type: "modifyInfluence";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      type: "moveCard";
      target: TargetRef;
      to: Zone;
      /**
       * Where in the destination when `to` is `"deck"` — `"top"` or
       * `"bottom"` (default `"bottom"`). Ignored for every other zone.
       */
      position?: "top" | "bottom";
    }
  | {
      type: "destroy";
      target: TargetRef;
    }
  | {
      type: "deplete";
      target: TargetRef;
    }
  | {
      type: "restore";
      target: TargetRef;
    }
  | {
      type: "addCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
      type: "removeCounter";
      target: TargetRef;
      counter: string;
      amount: NumberExpression;
    }
  | {
      type: "createModifier";
      target: TargetRef;
      stat: Stat;
      operation: ModifierOperation;
      value: NumberExpression;
      duration: Duration;
    }
  | {
      /** Changes who controls an in-play card (e.g. "take control of the location"). */
      type: "takeControl";
      target: TargetRef;
      controller: PlayerRef;
      /**
       * When set, control reverts to the previous controller once the
       * duration expires (swept at the start-of-turn point like every other
       * "this turn" effect) — "This turn, take control of the character."
       * (Mutiny Grant). Omit for a permanent grab.
       */
      duration?: Duration;
    }
  | {
      /** "Remove from the game" (RULES.md §2) — permanent, unlike moveCard to any tracked zone. */
      type: "removeFromGame";
      target: TargetRef;
    }
  | {
      /**
       * Resolves `effects` once per card matching `selector` (e.g. "your
       * characters gain 1 strength", "inflict 2 damage to all characters").
       * Every `TargetRef` inside `effects` should reference the current
       * card via `{ type: "selected", id: "__candidate" }` — the same
       * binding `CardSelector.conditions` uses. The match set is snapshotted
       * once up front, not re-queried per iteration, so an earlier
       * iteration destroying/moving a card can't shrink who else is hit.
       */
      type: "forEach";
      /** Exactly one of `selector`/`selected` must be set. */
      selector?: CardSelector;
      /** Iterate the cards already selected under this TargetDeclaration id instead of re-querying a selector — e.g. "destroy the items" after "pick 2 or fewer items." */
      selected?: string;
      effects: Effect[];
    }
  | {
      /**
       * "That player separates those cards into two piles" — pauses for
       * `splitter` to partition the cards already selected under `selected`
       * into two piles (either may be empty), then runs `pile1` effects once
       * per card in the first pile and `pile2` effects once per card in the
       * second (each card bound to `{ type: "selected", id: "__candidate" }`).
       * "Put one pile into your hand and shuffle the other into your deck."
       * (Profane Proposal — `pile1` a `moveCard` to hand, `pile2` a
       * `moveCard` to deck; add a `shuffleDeck` after).
       */
      type: "separateIntoPiles";
      splitter: PlayerRef;
      selected: string;
      pile1: Effect[];
      pile2: Effect[];
    }
  | {
      /**
       * "For the rest of the game, `player` may deploy those voided cards as
       * though they were in their hand [even if they cannot meet their
       * threshold]." (Cheats, the Dirty Rotten). Registers a persistent
       * `GameState.voidPlayGrant` for each card currently selected under
       * `selected` that sits in the void. Pruned when the card leaves the
       * void (incl. once it's deployed).
       */
      type: "grantVoidPlay";
      selected: string;
      player: PlayerRef;
      ignoreThreshold?: boolean;
    }
  | {
      /**
       * Resolves `effects` once for each of `count` uniformly-random cards
       * drawn from the set already selected under the `selected`
       * TargetDeclaration id — "randomly put 2 of those [revealed] cards
       * into their discard pile" (Cheats, the Dirty Rotten). Fewer than
       * `count` in the set → all of them. Each chosen card is bound to
       * `{ type: "selected", id: "__candidate" }` inside `effects`.
       */
      type: "randomFromSelection";
      selected: string;
      count: NumberExpression;
      effects: Effect[];
    }
  | {
      /**
       * Re-attaches an already-in-play "Attach to X" card to a new target
       * (e.g. an item's "HANDOFF" ability). Playing a card for the first
       * time still attaches it via its `attachTo` field + the play-time
       * target declaration — this effect is only for moving an existing
       * attachment. `checkStateBasedActions` destroys the moved card if
       * `to` isn't a legal in-play target of the card's `attachTo` type, so
       * this effect doesn't need to validate that itself.
       */
      type: "attachTo";
      target: TargetRef;
      to: TargetRef;
    }
  | {
      /**
       * Flip an in-play card face-down under its OWNER's control. Per
       * RULES.md §2 (CR §411.3 / §411.4) the flip counts as the card
       * *leaving play* and *a brand-new card entering play* — accumulated
       * damage, counters, attachments, temporary modifiers/keywords/
       * restrictions and named values are all cleared; the result is a
       * face-down resource providing one Volition. "Leaves play" triggers
       * fire. No-op if `target` doesn't resolve to a card in play. Used
       * both directly ("flip the character face-down under its owner's
       * control") and as a "would be destroyed → flip it face-down
       * instead" replacement (bind `target` to `{ type: "selected", id:
       * "__candidate" }` there).
       */
      type: "flipFaceDown";
      target: TargetRef;
    }
  | {
      /**
       * Move a card from deck / discard / void INTO play as its real type,
       * running the normal entrance bookkeeping (`cardEnteredPlay`, the
       * attach-target requirement, attack eligibility). `faceDown: true`
       * puts it into play as an anonymous face-down resource instead. "Put
       * the card into play under your control [as a face-down resource]."
       */
      type: "putIntoPlay";
      target: TargetRef;
      controller: PlayerRef;
      faceDown?: boolean;
      /**
       * "If that card would leave play or is in play at the end of the
       * turn, remove it from the game instead." — a borrowed entrance: the
       * card is removed from the game the moment it would otherwise leave
       * play, and unconditionally at end of turn (Barracks of Precipitancy).
       */
      borrowed?: boolean;
    }
  | {
      /**
       * "You may deploy the <card>" — deploy an already-picked card that is
       * NOT in hand (a face-down permanent/tactic in play; a card in the
       * discard pile) as its real type, waiving only its numeric cost.
       * Threshold and any non-numeric EXTRA COSTs still apply (unless
       * `ignoreThreshold`) — the player supplies the sub-card's own picks
       * when the pending `deployForFree` choice pauses. Compose with
       * `mayPay` (empty `costs`) for the "you may" prompt. Manifest /
       * Hidden Ruins / Accidental Invention / Burly Assailment (a revealed
       * face-down card), Dark Awakening (a card in your discard pile).
       */
      type: "deployFromZone";
      player: PlayerRef;
      target: TargetRef;
      /** "deploy it for free even if you cannot meet its threshold" (I Drink Your Milkshake!). */
      ignoreThreshold?: boolean;
      /**
       * Whether the numeric cost is waived. `true` (default) = for free;
       * `false` = the player still pays the card's printed cost; a
       * `Condition` = waived only when it holds ("if its numeric cost is 4
       * or less, you may deploy it for free" — Gang Weapon Dealer, a
       * `numberCompare` on `cardCost` of the revealed card).
       */
      free?: boolean | Condition;
    }
  | {
      /**
       * Adds `amount` phantom `icon` resource-icons to `player`'s threshold
       * count for `duration` — "This turn, you control an additional
       * [E][E][E][E]." (31337!). Read by `getThresholds` / the
       * `resourceIcons` expression; cleaned up like `modifiers`.
       */
      type: "grantResourceIcons";
      player: PlayerRef;
      icon: ResourceIcon;
      amount: NumberExpression;
      duration: Duration;
    }
  | {
      /**
       * Adds `amount` of resource `icon` to `target`'s **own** PROVIDES for
       * `duration` — "This turn, this card gains PROVIDES: [O][O][O]".
       * Card-scoped (unlike the player-level `grantResourceIcons`): read by
       * `getResourceIcons`, so `getThresholds` / the `cardProvides`
       * condition / the `resourceIcons` expression all see it, and it stops
       * counting the moment the card leaves play. Stacks on top of the
       * card's printed icons / Volition. `icon` may be `{ fromNamed }` to use
       * a resource icon a `nameValue` (`valueKind: "resourceIcon"`) effect
       * stored on the ability's source card ("gains PROVIDES X" where the
       * player named X).
       */
      type: "grantProvides";
      target: TargetRef;
      icon: ResourceIcon | { fromNamed: string };
      amount: NumberExpression;
      duration: Duration;
    }
  | {
      /**
       * "This turn, reduce the threshold requirement of the next card you
       * deploy by `amount` of `icon`." — a per-player one-shot
       * (`GameState.thresholdReductions`), consumed by the next successful
       * deploy and cleared at end of turn. `icon` may be `{ fromNamed }`
       * (a `nameValue` `valueKind: "resourceIcon"` on the source). Clockman
       * Skydocks (BUSINESS DAY / OVERTIME).
       */
      type: "reduceThreshold";
      player: PlayerRef;
      icon: ResourceIcon | { fromNamed: string };
      amount: NumberExpression;
    }
  | {
      /**
       * Clears `target`'s attachment — a resource stops being attached to a
       * faction ("detach it from your faction"; Braggadocian Aide), or an
       * "Attach to X" item is left unattached (and cleaned up by the
       * state-based check). No-op if `target` isn't attached to anything.
       */
      type: "detach";
      target: TargetRef;
    }
  | {
      /**
       * Registers a runtime damage "shield" on `target`, consumed as
       * damage is inflicted to it this turn (expires at the next
       * start-of-turn if unused). `mode: "reduce"` absorbs up to `amount`
       * points ("Reduce the next damage inflicted to the character this
       * turn by 2" — Tiny Shiny). `mode: "redirect"` sends up to `amount`
       * of the next damage to `redirectTo` instead ("The next X damage
       * that would be inflicted to the first picked card this turn is
       * inflicted to the second picked card instead" — Delectable Boon).
       * Redirected damage lands raw (no further modifiers/shields on the
       * redirect target).
       */
      type: "preventDamage";
      target: TargetRef;
      amount: NumberExpression;
      mode: "reduce" | "redirect";
      redirectTo?: TargetRef;
      /**
       * `mode: "reduce"` only — absorb the *entire* next damage instance
       * regardless of size (then the shield is spent), rather than up to
       * `amount` points. "The next time damage would be inflicted to the
       * character this turn, reduce it to 0." (Visible Loaf). `amount` is
       * ignored when set.
       */
      wholeInstance?: boolean;
    }
  | {
      /**
       * Registers a one-shot delayed effect fired at the next `endOfTurn`
       * (the current turn's end), `startOfNextTurn` (the source controller's
       * next turn), `startOfOpponentNextTurn` (the *other* player's next
       * turn — i.e. the immediately following turn; Final Countdown), or
       * `endOfBattle`, then discarded. `condition`, if set, is checked at
       * fire time. "At the start of your next turn, if this card is in play,
       * put the voided character into play." (Gilded Yurt); "At the end of
       * the turn, ..." (Vast Mastabatorium). A chooser effect inside
       * `effects` is not supported — keep the delayed effects
       * self-resolving.
       */
      type: "scheduleEffect";
      when: "startOfNextTurn" | "startOfOpponentNextTurn" | "endOfTurn" | "endOfBattle";
      condition?: Condition;
      effects: Effect[];
    }
  | {
      /**
       * "You may use an ability" — pauses for `chooser` to pick one of
       * their in-play cards (matching `selector`, default: any card they
       * control) and then one of its activated abilities, resolved as a
       * nested sub-resolution. Generalises `useTargetAbility` (which needs
       * a fixed `target`). The Poshernacle.
       */
      type: "useAnyAbility";
      chooser: PlayerRef;
      selector?: CardSelector;
    }
  | {
      /**
       * Grants `keyword` to `target` for `duration` (e.g. "this turn, the
       * character gains COVERT"). For a keyword granted *while a condition
       * holds* (e.g. "the attached character gains COVERT" for as long as
       * it's attached), use `ContinuousAbility.keywords` instead — that's
       * recomputed live like `modifiers`, not stored with an expiry.
       */
      type: "grantKeyword";
      target: TargetRef;
      keyword: Keyword;
      duration: Duration;
    }
  | {
      /** Same shape as `grantKeyword`, for boolean combat restrictions (e.g. "this turn, the character cannot attack"). */
      type: "grantRestriction";
      target: TargetRef;
      restriction: Restriction;
      duration: Duration;
    }
  | {
      /**
       * Removes `keyword` from `target` for `duration` — "this turn, the
       * character loses COVERT" (I See You!). The duration'd mirror of
       * `ContinuousAbility.suppressKeywords` (which needs a live in-play
       * source). Beats every grant, printed or otherwise (lose beats grant).
       */
      type: "suppressKeyword";
      target: TargetRef;
      keyword: Keyword;
      duration: Duration;
    }
  | {
      /**
       * Registers a runtime transform of how `target` assigns / receives
       * *battle damage* (`GameState.battleDamageTransforms`), consulted as
       * locked assignments are inflicted. `role: "dealer"` matches
       * assignments `target` makes; `role: "receiver"` matches assignments
       * aimed at `target`. `kind`:
       * - `setAmount` — `target` assigns `amount` (evaluated now) instead of
       *   its strength (Ocular Dispersal — `amount` = host's `cardCost`).
       * - `redirectToSelf` — `target`'s damage is dealt to `target` (Don't
       *   Trip — registered on the picked attacker for the turn).
       * - `bounceOther` — `target` deals no battle damage; the card it would
       *   have hit is put into its owner's hand (Vexing Nullifier).
       * - `bounceSelf` — a character dealing battle damage to `target`
       *   inflicts none; `target` is put into its owner's hand (Vexing
       *   Nullifier, receiver side).
       */
      type: "transformBattleDamage";
      target: TargetRef;
      role: "dealer" | "receiver";
      kind: "setAmount" | "redirectToSelf" | "bounceOther" | "bounceSelf";
      amount?: NumberExpression;
      duration: Duration;
    }
  | {
      /**
       * "This turn, `target` loses all its rules text." — the duration'd
       * counterpart of `ContinuousAbility.suppressAllAbilities` (which needs
       * a live in-play source holding the condition). Every ability on
       * `target` — activated, triggered, continuous, replacement, granted —
       * goes inert until the grant expires. iDumb De-Itemizer — RESET.
       */
      type: "suppressAbilities";
      target: TargetRef;
      duration: Duration;
    }
  | {
      /**
       * Grants `keyword` to every character `player` controls — including
       * ones deployed later, while the grant is live — for `duration`. "This
       * turn, characters you control and deploy can attack even if they have
       * not been in play under your control since the start of the turn"
       * (Hasty Pursuit, Change of Tactics FLIP UP rider) is
       * `{ player: "controller", keyword: "aggro", duration: untilEndOfTurn }`.
       * Distinct from a `forEach` + `grantKeyword`, which only reaches the
       * characters in play at resolution time.
       */
      type: "grantKeywordToPlayer";
      player: PlayerRef;
      keyword: Keyword;
      duration: Duration;
    }
  | {
      /**
       * A runtime adjustment to damage *dealt by* `source` for `duration`,
       * floored at 0 — "this turn, if damage is inflicted to a character or
       * faction by this card, reduce the amount by 1" (Sockem Bot). Keyed
       * on the damage source, unlike `ContinuousAbility.damageModifiers`
       * (keyed on the target and needing a live in-play source).
       */
      type: "modifyOutgoingDamage";
      source: TargetRef;
      delta: NumberExpression;
      duration: Duration;
    }
  | {
      /**
       * "That player cannot play <X> this turn." `kind: "cardType"` blocks
       * deploying a card of `cardType` (a normal deploy or a response);
       * `kind: "flipUp"` blocks the FLIP UP action. A per-player runtime
       * entry (`GameState.playRestrictions`) swept like the other duration
       * lists. Study Disturbance ("cannot play characters"), Surreptitious
       * Larceny ("may not play cards using FLIP UP").
       */
      type: "restrictPlay";
      player: PlayerRef;
      kind: "cardType" | "flipUp";
      cardType?: CardType;
      duration: Duration;
    }
  | {
      /**
       * Resolves `effects` only if `condition` holds — the "if you do" half
       * of an optional `TargetDeclaration` ("you may pick a character. If
       * you do, ..."): gate with `{ type: "targetExists", target: {
       * type: "selected", id: "<declarationId>" } }`.
       */
      type: "if";
      condition: Condition;
      effects: Effect[];
    }
  | {
      /** "Reshuffle" (RULES.md §2) — shuffles `player`'s deck in place. */
      type: "shuffleDeck";
      player: PlayerRef;
    }
  | {
      /**
       * Pauses ability resolution for `chooser` (not necessarily this
       * ability's controller) to pick a target matching `declaration`'s
       * selector, then resolves `effects` — reference the choice via
       * `{ type: "selected", id: declaration.id }`. E.g. "an opponent
       * discards a card" is `chooser: "opponent"`, a hand-zone declaration,
       * and a `moveCard` to `"discard"`.
       */
      type: "chooserSelectsTarget";
      chooser: PlayerRef;
      declaration: TargetDeclaration;
      effects: Effect[];
    }
  | {
      /**
       * Pauses ability resolution for `chooser` to pick exactly one of
       * `options` to resolve in full (the rest are skipped entirely). E.g.
       * "an opponent chooses one of the following effects."
       */
      type: "chooserSelectsOption";
      chooser: PlayerRef;
      options: EffectOption[];
    }
  | {
      /**
       * Pauses ability resolution for `player` to reorder the top `count`
       * cards of their own deck however they like ("look at the top N
       * cards... put them back in any order"). Reorders whatever is
       * actually there if the deck is shorter than `count`. `to: "bottom"`
       * instead relocates those top `count` cards to the **bottom** of the
       * deck in the chosen order ("...put the remaining cards on the bottom
       * of their deck in any order" — Rosy Palmer); default `"top"` leaves
       * them on top.
       */
      type: "lookAndReorder";
      player: PlayerRef;
      count: NumberExpression;
      to?: "top" | "bottom" | "split";
      /**
       * Who does the looking / reordering — defaults to `player` (the deck's
       * owner). Set it for "any opponent ... looks at the top 3 cards of
       * YOUR deck and puts them back in any order" (Tedious TriAdic
       * Truculence): `player: "controller"`, `chooser: "opponent"`.
       */
      chooser?: PlayerRef;
    }
  | {
      /**
       * Reduces the numeric cost of the next card `player` deploys this
       * turn by `amount` (floored at 0), consumed by exactly one
       * subsequent `playCard` — "reduce the next numeric cost you pay this
       * turn by N." Unused reductions expire at end of turn. With
       * `cardType`, only a play of that type benefits from and consumes the
       * reduction — "the next CHARACTER you play this turn" (Imperial
       * Army's develop rule).
       */
      type: "reduceNextCost";
      player: PlayerRef;
      amount: NumberExpression;
      cardType?: CardType;
    }
  | {
      /**
       * Pauses ability resolution for `player` to pick a card from their
       * hand matching `selector` with printed cost <= `maxCost` (evaluated
       * once, at the time this effect resolves) and deploy it immediately
       * without paying its numeric cost — "you may deploy a non-resource
       * card with numeric cost X or less for free." Threshold and any
       * non-numeric extra costs (targets, deplete, etc.) still apply. The
       * deployed card resolves synchronously as part of this effect (like
       * any other nested consequence of an ability, e.g. `forEach`) rather
       * than opening its own response window.
       *
       * `free` (default `true`) — set `false` to make the player still pay
       * the card's numeric cost ("You may deploy a character card from your
       * hand. ... You still pay all the character's costs" — Late Addition).
       * For "deploy up to N cards" (0p3r4710n 1337 H4x0rz), list this effect
       * N times — each is an independent optional pick.
       */
      type: "deployForFree";
      player: PlayerRef;
      maxCost: NumberExpression;
      selector?: CardSelector;
      free?: boolean;
    }
  | {
      /**
       * Pauses ability resolution for `chooser` to divide `amount` however
       * they like among the cards already selected under `selected` (a
       * TargetDeclaration id) — "divide up to 2 damage however you want
       * among the characters." Resolves `effects` once per card that
       * received a nonzero share, with that card bound to `{ type:
       * "selected", id: "__candidate" }` and its share bound to `{ type:
       * "variable", id: "__amount" }`.
       */
      type: "distributeAmong";
      chooser: PlayerRef;
      selected: string;
      amount: NumberExpression;
      effects: Effect[];
    }
  | {
      /**
       * Moves the top `count` cards of `player`'s deck to `to` (default
       * `"discard"`; `"removed"` for "remove the top N cards of their deck
       * from the game"). Fewer than `count` in the deck: whatever's there.
       * No reshuffle.
       */
      type: "mill";
      player: PlayerRef;
      count: NumberExpression;
      to?: "discard" | "removed";
    }
  | {
      /**
       * Store `target`'s card id on `source`'s `linkedTargets[key]` — an
       * EXTRA-COST pick a later continuous ability keys off ("pick a
       * location you control; while THAT location is in play, this card
       * cannot attack or block"). Read back via the `{ type: "remembered",
       * key }` TargetRef or the `linkedCardInPlay` condition. Cleared on
       * leaving play.
       */
      type: "rememberTarget";
      key: string;
      target: TargetRef;
    }
  | {
      /**
       * "Duplicate the tactic." Resolve a copy of `target` (a tactic on the
       * response stack) under the current ability's controller, reusing the
       * original's already-made selections (RULES.md §12). No transient
       * card instance is created. Muddle.
       */
      type: "duplicate";
      target: TargetRef;
    }
  | {
      /**
       * The MUSTACHE SHOWDOWN primitive (Mustache Aficionado). `controller`
       * and their `opponent` each reveal the top `count` cards of their own
       * deck and split them into `piles` face-down piles (>= 1 card each);
       * each then picks one of the OTHER player's piles; the two chosen
       * piles are revealed and their total `compareBy` (`"cost"`) compared.
       * If one is strictly higher, that pile's OWNER may move up to
       * `winnerTakes` of its cards to hand. Every card not taken stays in
       * its owner's deck, which is then shuffled. Pauses on `partitionCards`
       * → `pickPile` → (`takeFromPile`) pending choices, one player at a
       * time. No-op if either player has fewer than `piles` cards to
       * reveal. See RULES.md §12.
       */
      type: "partitionAndPick";
      count: number;
      piles: number;
      compareBy: "cost";
      winnerTakes: number;
    }
  | {
      /**
       * "... its effect happens as though your opponent had picked the
       * other character instead." (Mistaken Identity). Rewrites the
       * responded-to stack item's stored EXTRA-COST pick: the in-play card
       * of `cardType` it selected is swapped for `to` everywhere it appears
       * under that item's `context.selected`, so the item resolves against
       * the new pick. No-op if there is no responded-to item, it holds no
       * such pick, or `to` is that same card. See RULES.md §7.
       */
      type: "retargetExtraCost";
      cardType: CardType;
      to: TargetRef;
    }
  | {
      /**
       * "This turn, the <card> is a <cardType> ..." (RULES.md §3.7 /
       * CR §208). For `duration`, `target` GAINS `cardType` — it keeps its
       * printed type too (CR §208.1: a card may hold several types at once;
       * §208.1a: gaining one keeps the rest). `hasCardType` /
       * `getCardTypes`, and everything keyed off them (typed selectors, the
       * lethal-damage / attach state-based checks, battle legality, the
       * `cardTypeIs` condition), see the added type. `grantStats`, if set,
       * apply as `set` stat modifiers with the same duration and source
       * (each value a `NumberExpression`, evaluated once now — e.g.
       * "strength and life equal to its numeric cost and 3 speed" is
       * `{ strength: {type:"cardCost",target}, life: {type:"cardCost",
       * target}, speed: 3 }`). When the grant ends and the card thereby
       * stops being a character it forgets the damage it took this turn
       * (CR §208.3, handled at start-of-turn) and is pulled from any battle
       * it is in (CR §208.4, via the state-based check). Contrabulous
       * Fabtraption — RUNE OF ANIMATION.
       */
      type: "setCardType";
      target: TargetRef;
      cardType: CardType;
      grantStats?: Partial<Record<Stat, NumberExpression>>;
      duration: Duration;
    }
  | {
      /**
       * Clears a card type previously ADDED to `target` by `setCardType`
       * (drops matching `GameState.cardTypeGrants` entries, plus the `set`
       * stat modifiers from the same source that rode along with it). No-op
       * on the card's printed type. "If this card is a character, it loses
       * the 'character' type." (Frickin' Sweet Pogo-Bunny — HIDE!).
       */
      type: "removeCardType";
      target: TargetRef;
      cardType: CardType;
    }
  | {
      /**
       * Evaluates `value` immediately and stores it in
       * `ResolutionContext.variables[id]`, so later effects in the same
       * ability can read it via `{ type: "variable", id }` even after the
       * card it was derived from has left play — "X is that character's
       * strength" captured before a `destroy` in the same effect list.
       */
      type: "bind";
      id: string;
      value: NumberExpression;
    }
  | {
      /**
       * Removes a still-unresolved card/ability from the response stack
       * ("terminate" / "counter"). A terminated card goes to its owner's
       * discard without its effects resolving; a terminated ability is
       * dropped. No-op if the target isn't on the stack.
       *
       * - `scope: "target"` (default) — terminate the stack item whose
       *   source card is `target` (e.g. `"eventCard"`, the card just played).
       * - `scope: "othersOnStack"` — terminate every remaining stack item
       *   ("all other unresolved cards are terminated"); `target` ignored.
       * - `scope: "respondedItem"` — terminate the newest unresolved
       *   non-self stack item, whatever its kind ("Terminate the ability" —
       *   Cock Block); `target` ignored.
       *
       * `disposition` (default `"discard"`) is where a terminated *card*
       * goes — `"hand"` for "Terminate the card, but put it into its owner's
       * hand instead of their discard pile" (Voidal Interference). Ignored
       * for a terminated ability (which just drops).
       */
      type: "terminate";
      scope?: "target" | "othersOnStack" | "respondedItem";
      target?: TargetRef;
      disposition?: "discard" | "hand";
    }
  | {
      /**
       * Sets (or with `value: false`, clears) `CardInstance.restoreLocked` —
       * "characters depleted by this card cannot be restored by their
       * controller's faction's restore rule". Pair with a `deplete` effect
       * on the same target. Cleared automatically when the card leaves play.
       */
      type: "setRestoreLock";
      target: TargetRef;
      value?: boolean;
    }
  | {
      /**
       * "On your next turn, skip your faction's RESTORE RULE." — adds
       * `turns` (default 1) charges to `player`'s
       * `GameState.restoreRuleSkips`; each start of that player's turn
       * consumes one and skips the whole Restore Rule (both the resource
       * detach and the non-resource un-deplete). Monstrous Lassitude.
       */
      type: "skipRestoreRule";
      player: PlayerRef;
      turns?: number;
    }
  | {
      /**
       * "That character does not restore during its controller's next
       * RESTORE RULE." — a one-shot per-card skip
       * (`CardInstance.skipNextRestore`), consumed and cleared at that next
       * restore. Numba 1 Stunna!.
       */
      type: "skipNextRestore";
      target: TargetRef;
    }
  | {
      /**
       * "This turn, the character loses / gains N numeric cost." — a
       * per-card runtime adjustment to what it costs to deploy that specific
       * in-play/hand card (`GameState.numericCostModifiers`), floored at 0,
       * read by `getCardPlayability` / the real payment. Guileful Astucion.
       */
      type: "modifyNumericCost";
      target: TargetRef;
      delta: NumberExpression;
      duration: Duration;
    }
  | {
      /**
       * Pauses for `chooser` (not necessarily the acting player) to pick an
       * integer in `[min, max]` (each an optional `NumberExpression`,
       * defaults 0..99), bound into `context.variables[storeAs]` for
       * `effects`. "That character's controller chooses a number for X."
       * Audacious Appraisal.
       */
      type: "chooserSelectsNumber";
      chooser: PlayerRef;
      storeAs: string;
      min?: NumberExpression;
      max?: NumberExpression;
      effects: Effect[];
    }
  | {
      /**
       * "You may pay `cost`. If you do, the other player may pay `cost`.
       * Repeat until someone doesn't." — alternately offers `cost` to
       * `first` then `opponent`, tallying each acceptance into
       * `context.variables["paid:" + <playerId>]`; stops at the first
       * decline (or `maxRounds`, default 20). Then runs `onEnd`, which can
       * read the tallies. Negotiation Ceremonies ("each player draws cards
       * equal to the amount they paid").
       */
      type: "alternatingPayLoop";
      first: PlayerRef;
      opponent: PlayerRef;
      cost: Cost[];
      maxRounds?: number;
      onEnd: Effect[];
    }
  | {
      /**
       * Sets `target`'s accumulated damage to `amount` (clamped >= 0) —
       * "reduce the amount of damage already inflicted to this character to
       * 0". Distinct from healing via a life modifier.
       */
      type: "setDamage";
      target: TargetRef;
      amount: NumberExpression;
    }
  | {
      /**
       * Removes up to `amount` damage markers from `target` (its accumulated
       * damage drops by `amount`, floored at 0) — "remove 2 damage markers
       * from the card" (Asbestos Drywall). Distinct from `setDamage` (which
       * is absolute) and from a `life` modifier.
       */
      type: "healDamage";
      target: TargetRef;
      amount: NumberExpression;
    }
  | {
      /**
       * Pulls `target` out of the current battle's attacking/blocking party
       * ("remove it from battle"). No-op if there's no battle or the card
       * isn't in it.
       */
      type: "removeFromBattle";
      target: TargetRef;
    }
  | {
      /**
       * Inserts an in-play character `target` into the current battle's
       * `attacking` / `blocking` party (the inverse of `removeFromBattle`) —
       * "add it to your attacking or blocking party". No-op with no active
       * battle, if `target` isn't a controlled in-play character, if the
       * controller isn't on that side of the battle, or if it's already in
       * that party. Does NOT deplete it or re-check AGGRO (it's being added
       * by an effect, not declared). Wrap in `chooserSelectsOption` for the
       * "attacking or blocking" choice. Carnival Ringmaster, Sneaker Attack!.
       */
      type: "addToBattle";
      target: TargetRef;
      side: "attacking" | "blocking";
    }
  | {
      /**
       * Resolves `effects` once per player, in turn order starting from the
       * active player (or `order: "startingWith"` + `player`), rebinding
       * `controller`/`owner` to that player. "Each player may draw a card
       * or play a resource." Nested chooser effects pause per player, the
       * same as anywhere else.
       */
      type: "forEachPlayer";
      effects: Effect[];
    }
  | {
      /**
       * Pauses for `chooser` to name a value from a closed vocabulary
       * (`kind: "subtype"` — any card subtype; `kind: "cardName"` — any
       * card name in the game). The chosen string is stored on the source
       * card instance under `counters`-adjacent `namedValues[storeAs]` and
       * read back by a `CardSelector.subtypeVar` / conditions.
       */
      type: "nameValue";
      chooser: PlayerRef;
      valueKind: "subtype" | "cardName" | "resourceIcon" | "trade";
      storeAs: string;
    }
  | {
      /**
       * "You may pay <costs>. If you do, <effects>; otherwise
       * <elseEffects>." Pauses for `player` to accept or decline; declines
       * (or can't afford) fall through to `elseEffects`.
       */
      type: "mayPay";
      player: PlayerRef;
      costs: Cost[];
      effects: Effect[];
      elseEffects?: Effect[];
    }
  | {
      /**
       * "Any player may pay <costs> to <effects>." — offers the optional
       * paid effect to each player (active player first) in turn; the first
       * to accept pays and resolves `effects`, then the offer stops. All
       * decline → nothing. Recycling Scheme Facility.
       */
      type: "anyPlayerMayPay";
      costs: Cost[];
      effects: Effect[];
    }
  | {
      /**
       * Puts `count` token permanents into play under `controller` — cards
       * with no deck backing that cease to exist on leaving play. `token`
       * is a minimal inline definition (name + type + optional stats /
       * subtype).
       */
      type: "createTokens";
      controller: PlayerRef;
      count: NumberExpression;
      token: TokenSpec;
      /**
       * Resolved once per created token, with that token bound to
       * `{ type: "selected", id: "__candidate" }` — e.g. shield it ("this
       * turn, all damage inflicted to that token is reduced to 0";
       * Micromajigmakermachinemajig).
       */
      effects?: Effect[];
    }
  | {
      /**
       * Activates one of `target`'s own activated abilities as a nested
       * sub-resolution (chosen by `chooser`), optionally resolving its
       * effects twice. "You may use one of the card's abilities. If you do,
       * the effect happens twice instead of once."
       */
      type: "useTargetAbility";
      chooser: PlayerRef;
      target: TargetRef;
      times?: number;
    }
  | {
      /**
       * "It cannot be used again this turn." — bars re-activation of an
       * activated ability for the rest of the turn (a per-turn tally entry
       * checked alongside `ActivatedAbility.usesPerTurn`). `target`:
       * `"respondedAbility"` — the ability of the responded-to stack item
       * (Subsection 5, Paragraph 12, right after `terminate`); or a
       * `TargetRef` naming the card whose ability it is (locks that card's
       * one just-used ability).
       */
      type: "lockAbilityThisTurn";
      target: "respondedAbility" | TargetRef;
    }
  | {
      /**
       * "Flip a coin. If you win, <winEffects>; otherwise <loseEffects>."
       * Resolves a fair coin off the seeded RNG for `player` (default
       * `"controller"`). A `ReplacementAbility`
       * (`replaces: { event: "coinFlip", result: "lose" }`) may intercept a
       * loss first (Two-Headed Coin); the `coinFlipped` event fires with the
       * settled result. Fwing!, Throatstabber.
       */
      type: "flipCoin";
      player?: PlayerRef;
      winEffects: Effect[];
      loseEffects: Effect[];
    }
  | {
      /**
       * "Those characters must block during this battle if they can, and
       * only those characters can block." — on a `characterAttacked`
       * trigger: pauses for `chooser` to pick per `declaration` (any number
       * of characters they control); for the rest of this battle only those
       * may be declared as blockers, and each must block if it can.
       * Wyrmfang Deathskull. No-op with no active battle.
       */
      type: "restrictBlockersToChosen";
      chooser: PlayerRef;
      declaration: TargetDeclaration;
    }
  | {
      /**
       * "This turn, only parties with at least N members / characters with
       * at least N speed can block <target>." — a duration'd restriction on
       * who may block `target` (default `"source"`) or its attacking party.
       * The lasting `ContinuousAbility.blockRestriction` is the static form;
       * this is the "this turn" effect form (LeoKaiser GO
       * MEGA-NEKO-KAISER!).
       */
      type: "restrictBlockers";
      target?: TargetRef;
      minPartySize?: NumberExpression;
      minSpeed?: NumberExpression;
      /**
       * Re-checked at `declareBlockers` time — the restriction only bites
       * while it holds ("while it is the only member of an attacking party"
       * — LeoKaiser). Omit for an unconditional "this turn" restriction.
       */
      condition?: Condition;
      duration: Duration;
    }
  | {
      /**
       * "The surviving character gains all rules text of the removed
       * character." — `target` permanently gains every ability in `from`'s
       * printed `behavior.abilities` (a snapshot, recorded on
       * `GameState.abilityGrants`; cleared when `target` leaves play). Skin
       * Suit.
       */
      type: "grantAbilitiesFrom";
      target: TargetRef;
      from: TargetRef;
    }
  | {
      /**
       * "Attack that player." — declares and fully resolves one battle right
       * now, mid-effect, bypassing normal turn/attack-eligibility timing:
       * the characters selected under the `attackerSelection` TargetDeclaration
       * id deplete and form the attacking party against `target`'s faction,
       * and the battle runs through the standard flow. The remaining effects
       * of the current list resume after the battle ends ("...resolve the
       * battle immediately and before you draw the card" — Counter Attack).
       */
      type: "initiateAttack";
      attackerSelection: string;
      target: PlayerRef;
    }
  | {
      /**
       * The Auction House primitive. Reveal cards from the top of
       * `revealFor`'s deck until a character is revealed or the deck is
       * empty. If a character was revealed, the players bid on it in turn
       * (the active player first), each capped at the number of detached
       * resources they control; the high bidder pays that many resources
       * (depleting them) and puts the character into play under their
       * control. Every other revealed card is shuffled back into
       * `revealFor`'s deck. Pauses on an `auctionBid` pending choice.
       */
      type: "auctionForCard";
      revealFor: PlayerRef;
    }
  | {
      /**
       * Opens a runtime window during which **every** damage instance — to
       * any card, from any source, battle or not — is reduced to 0. "This
       * turn ... all inflicted damage is reduced to 0." (Limited Liability).
       * Distinct from the per-source `modifyOutgoingDamage` and the per-card
       * `preventDamage` shield.
       */
      type: "preventAllDamage";
      duration: Duration;
    }
  | {
      /**
       * Opens a runtime window during which the `destroy` **effect** is a
       * no-op — "cards in play and cards deployed can only be destroyed by
       * costs" (Limited Liability). Destruction paid as a COST
       * (`Cost { type: "destroy" }`), lethal-damage state-based destruction,
       * and `removeFromGame` are unaffected.
       */
      type: "restrictDestruction";
      duration: Duration;
    };

/**
 * One branch of a `chooserSelectsOption` effect. `label` is an optional,
 * game-agnostic human-readable description of what picking this branch
 * does (e.g. "Put a token on this card") — a renderer has no other way to
 * turn a bare `Effect[]` into UI copy, since effects are structured data,
 * not text. Card-authored branches without a meaningful description (e.g.
 * "decline" as an empty `effects: []`) may omit it.
 */
export interface EffectOption {
  label?: string;
  effects: Effect[];
}

/**
 * A continuous ability's stat modifier. Set **either** `target` (a single
 * `TargetRef`, e.g. `"attachedTo"` or `{ type: "selected", id: "target" }`)
 * **or** `selector` (an aura: applies to *every* in-play card matching it,
 * recomputed live — "all your characters lose 1 strength", "every character
 * loses life equal to its printed life minus 2"). With `selector`, `value`
 * is evaluated per affected card with that card bound to
 * `{ type: "selected", id: "__candidate" }`, so per-target derived amounts
 * (`printedStat`/`stat` of `__candidate`) work.
 */
/** A minimal inline card definition for a token permanent (see `createTokens`). */
export interface TokenSpec {
  name: string;
  cardType: "character" | "item" | "location";
  subtype?: string[];
  strength?: number;
  life?: number;
  speed?: number;
  /** For a location token. */
  structure?: number;
}

export interface ModifierDefinition {
  target?: TargetRef;
  selector?: CardSelector;
  stat: Stat;
  operation: ModifierOperation;
  value: NumberExpression;
}

export interface KeywordGrantDefinition {
  target?: TargetRef;
  /** Aura form — grant to every in-play card matching this (see ModifierDefinition). */
  selector?: CardSelector;
  keyword: Keyword;
}

export interface RestrictionGrantDefinition {
  target?: TargetRef;
  /** Aura form — grant to every in-play card matching this (see ModifierDefinition). */
  selector?: CardSelector;
  restriction: Restriction;
}

/**
 * A continuous ability's effect on how much it costs to deploy a card —
 * "your opponents must pay 1 more to deploy a tactic", "reduce the numeric
 * cost of characters you play by 2, to a minimum of 1". Recomputed live
 * while the source is in play; feeds both `getCardPlayability` and the
 * actual payment in `playCard`.
 */
export interface CostModifierDefinition {
  /** Whose deploys this affects (`controller` = the source's controller). */
  affects: PlayerRef;
  /** Added to the printed numeric cost — negative discounts, positive taxes. */
  delta: NumberExpression;
  /** The modified cost can't drop below this (default 0). */
  minCost?: number;
  /**
   * Which cards this applies to, matched against the card being deployed.
   * Omit for "any card". Don't constrain `zone` (the card is in hand) —
   * use `type` / `subtype` / `conditions` (`cardTradeIs`, etc.).
   */
  selector?: CardSelector;
}

/**
 * A continuous ability's adjustment to damage amounts as they're inflicted —
 * "when battle damage is inflicted to a character you control, reduce the
 * amount by 2". Applied in `dealDamage`; not a replacement effect (it tunes
 * an amount, it can't cancel).
 */
export interface DamageModifierDefinition {
  /** Match the card being damaged. Omit `zone` (it's in play by definition). */
  selector: CardSelector;
  /**
   * When set, also require the *dealer* of the damage to match this — "all
   * damage assigned to this card **by characters with items attached to
   * them** is reduced to 0" (Enlightened Mau). Omit for "by anything".
   */
  sourceSelector?: CardSelector;
  /** Only battle damage, or all damage. Default: all. */
  battleOnly?: boolean;
  /** Added to each incoming damage amount — negative reduces. Floors the amount at 0. */
  delta: NumberExpression;
  /**
   * A passive amount-thresholded clamp applied AFTER `delta` in the same
   * pre-inflict pass: if the incoming amount to a matching card is `>=
   * minAmount`, it is set to `setTo` (default 0). "When any amount of damage
   * greater than 4 is inflicted to this card, reduce it to 0" (Class Action
   * Defender — `minAmount: 5, setTo: 0`, with `delta: 0`).
   */
  minAmount?: NumberExpression;
  setTo?: NumberExpression;
}
