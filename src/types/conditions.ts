// -----------------------------------------------------------------------------
// Conditions
// -----------------------------------------------------------------------------

import type { CardType, ComparisonOperator, Keyword, Stat, Trade, Zone } from "./ids.js";
import type { CardSelector, NumberExpression, PlayerRef, TargetRef } from "./expressions.js";
import type { ResourceIcon } from "./cards.js";

export type Condition =
  | { type: "and"; conditions: Condition[] }
  | { type: "or"; conditions: Condition[] }
  | { type: "not"; condition: Condition }
  | { type: "sourceInZone"; zone: Zone }
  | {
      /**
       * True when the resolved player is the active player
       * (`GameState.activePlayerId`) — "use this only during your turn" /
       * "deploy this only during your turn". `player` defaults to
       * `"controller"`.
       */
      type: "isActivePlayer";
      player?: PlayerRef;
    }
  | {
      /**
       * True while `player` (default `"controller"`) has announced the end of
       * their turn and it has neither ended nor been terminated: an open
       * `endTurn` response window for that player, or a battle started inside
       * one (`BattleState.resumeEndTurn`). "Play this only on your turn, after
       * you have declared the end of your turn" (Lost on Floor 3) — since only
       * the opponent responds to the announcement (CR 607.1), the player can
       * only act then in response to a card or ability of theirs.
       */
      type: "endOfTurnDeclared";
      player?: PlayerRef;
    }
  | {
      /**
       * True while there is an in-flight battle (`GameState.battle` set and
       * not `finished`). Compose with `not` for "deploy this only NOT during
       * a battle".
       */
      type: "battleActive";
    }
  | {
      /**
       * True when `target` resolves to a card whose printed
       * `CardDefinition.subtype` list includes `subtype` — for an eventCard
       * subtype check a `CardSelector.subtype` filter can't reach ("when
       * another 'gear' card is deployed", "if the picked character is a
       * 'dragon'").
       */
      type: "cardSubtypeIs";
      target: TargetRef;
      subtype: string;
    }
  | {
      /**
       * True when `target` (default `"source"`) has been in play under its
       * controller continuously since the start of this turn
       * (`CardInstance.attackEligibleTurn === GameState.turn`) — "use this
       * only if this card has been in play since the start of the turn".
       */
      type: "inPlaySinceTurnStart";
      target?: TargetRef;
    }
  | {
      /**
       * True when `target`'s printed Unique designation
       * (`CardDefinition.unique`) is one of `designations` — "a character you
       * control with UNIQUE EUSTACE". Distinct from `hasUnique` ("has any
       * designation").
       */
      type: "uniqueIs";
      target: TargetRef;
      designations: string[];
    }
  | {
      /**
       * True when `target` (default `"source"`) has inflicted any damage
       * this turn (`GameState.damageThisTurn`) — "use this only if this card
       * has NOT assigned damage this turn" is this wrapped in `not`
       * (Backdoor Brigand).
       */
      type: "assignedDamageThisTurn";
      target?: TargetRef;
    }
  | {
      /**
       * True when `target` (default `"source"`) has inflicted damage this
       * turn to `player`'s faction — "a character that inflicted damage to
       * your faction this turn" (Drive By Boobing; `target` bound to
       * `__candidate` in a selector, `player: "controller"`).
       */
      type: "inflictedDamageToFactionThisTurn";
      player: PlayerRef;
      target?: TargetRef;
    }
  | {
      /**
       * True when `by` (default `"controller"`, the source's controller)
       * has inflicted damage to `player`'s faction this turn
       * (`GameState.factionDamageInflictedThisTurn`) — "deploy this only if
       * you inflicted damage to an opponent's faction this turn" (Dual Blade
       * Assassin; `player: "opponent"`). A per-player history, not a scan of
       * surviving cards, so damage dealt by a token or card that has since
       * left play still counts. Whoever controlled the damage source when it
       * dealt the damage is the inflicter.
       */
      type: "playerInflictedDamageToFactionThisTurn";
      player: PlayerRef;
      by?: PlayerRef;
    }
  | {
      /**
       * True when `player`'s faction has lost influence at any point so far
       * this turn (`GameState.influenceLostThisTurn`), including earlier in
       * the same resolution: "if an opponent's faction lost influence this
       * turn" (Shriever General — `player: "opponent"`). Every loss counts, whatever caused it: damage
       * inflicted to the faction (CR 408.3), a `modifyInfluence` effect, an
       * influence cost. A loss reduced to nothing by an `influenceModifiers`
       * ability, one that hit a faction already at 0, a gain and a
       * `setInfluence` effect do not count. Cleared at the start of every turn.
       */
      type: "lostInfluenceThisTurn";
      player: PlayerRef;
    }
  | {
      /**
       * True when at least one in-play card (optionally of `ofType` and/or
       * carrying `ofSubtype` in its printed subtype list) is currently
       * attached to `target` (default `{ type: "selected", id:
       * "__candidate" }`) — "a character with an item attached to it"
       * (Enlightened Mau); "while a 'gear' card is attached to this card"
       * (Damascus Sword Swinger, Rudo Mangod — `ofSubtype: "gear"`).
       */
      type: "hasAttachment";
      target?: TargetRef;
      ofType?: CardType;
      ofSubtype?: string;
    }
  | { type: "sourceIsEventCard" }
  | {
      /**
       * True when the card the current event maps to (`getEventCardId` — the
       * same card `sourceIsEventCard` tests) is `target`. `sourceIsEventCard`
       * is the `target: "source"` special case; this lets an attachment
       * scope a battle / leave-play trigger to its host —
       * `{ type: "eventCardIs", target: "attachedTo" }` (Infectious Pustulio).
       */
      type: "eventCardIs";
      target: TargetRef;
    }
  | { type: "eventCardControlledBy"; player: PlayerRef }
  | { type: "targetExists"; target: TargetRef }
  | {
      /**
       * True when `target` resolves to a card currently in `zone` — the
       * general form of `sourceInZone`. "If it is destroyed by that damage"
       * is an `if` gated by `not` of `{ type: "targetInZone", target, zone:
       * "play" }` placed right after the `dealDamage` (Suicide Smash).
       */
      type: "targetInZone";
      target: TargetRef;
      zone: Zone;
    }
  | {
      /**
       * True when `target` (default the selector `__candidate`, else
       * `"source"`) is **owned** by the resolved `player`. The ownership
       * counterpart of `cardInPlay`'s `controlledBy` — for per-candidate
       * scoping a `CardSelector.owner` can't express alongside other
       * `conditions` (e.g. "a UNIQUE character in play OR a character in an
       * *opponent's* discard pile" — A Death Fit for a King).
       */
      type: "targetOwnedBy";
      target?: TargetRef;
      player: PlayerRef;
    }
  | {
      /**
       * True when `target` (default the selector `__candidate`, else
       * `"source"`) is **controlled** by the resolved `player` — the control
       * counterpart of `targetOwnedBy` ("while this card is attached to a
       * character you control ..." — Symmetrical Scimitar).
       */
      type: "targetControlledBy";
      target?: TargetRef;
      player: PlayerRef;
    }
  | {
      /**
       * True when `target` (default `"source"`) resolves to a token
       * permanent (`CardInstance.isToken`). Compose with `not` for
       * "non-token character" (Phantasmagoric Tollbooth).
       */
      type: "isToken";
      target?: TargetRef;
    }
  | {
      /**
       * Compares how many characters have already assigned battle damage in
       * the current battle (`BattleState.assignedDamageBy`) against `value`.
       * "before any damage is assigned during this battle" is `operator:
       * "=", value: 0` (Change of Tactics). False with no active battle.
       */
      type: "battleDamageAssigned";
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      /**
       * True while a battle is in progress whose *target* is a card (not a
       * faction) matching the optional `controlledBy` (resolved player) and
       * `cardType` filters — "a location you control is being attacked"
       * (Gargoyle of Cathédrale de Mau: `controlledBy: "controller",
       * cardType: "location"`). `battleRole: "defender"` alone also fires on
       * faction-target attacks; this doesn't.
       */
      type: "battleTargetIs";
      controlledBy?: PlayerRef;
      cardType?: CardType;
    }
  | {
      type: "cardTypeIs";
      target: TargetRef;
      cardType: CardType;
      /**
       * Test the card's PRINTED type even if it is a face-down card in play
       * (which is only a resource, CR 411.1): "if the face-down resource is a
       * character or an item" (Runic Junker).
       */
      printed?: boolean;
    }
  | {
      /**
       * True when `target`'s printed `trade` equals `trade`. `CardSelector`
       * has no positive-trade filter and no exclusion list, so compose with
       * `not` for "a non-Rogue character" (bind `target` to
       * `{ type: "selected", id: "__candidate" }` inside a selector's
       * `conditions`).
       */
      type: "cardTradeIs";
      target: TargetRef;
      trade: Trade;
    }
  | {
      /**
       * True when `target`'s printed `trade` equals the printed `trade` of
       * at least one card matching `among` (the target itself excluded) —
       * "does not share a trade with any characters you control" (Legions
       * of Chaos) is `not` + this, `among` scoped to the controller's
       * in-play characters. `target` defaults to the selector candidate
       * (`{ type: "selected", id: "__candidate" }`).
       */
      type: "sharesTradeWithAny";
      target?: TargetRef;
      among: CardSelector;
    }
  | {
      /**
       * True when `target`'s definition carries a Unique designation
       * (`CardDefinition.unique` is set) — "a character with the UNIQUE
       * keyword in its rules text".
       */
      type: "hasUnique";
      target: TargetRef;
    }
  | {
      /**
       * True when `target`'s definition has at least one ability of
       * `abilityType` (any ability if omitted) in `behavior.abilities` —
       * "a card you control with an ability in its rules text" (Notion
       * Sickness, which then uses one, so it wants `abilityType:
       * "activated"`).
       */
      type: "hasAbility";
      target: TargetRef;
      abilityType?: "activated" | "triggered" | "continuous" | "replacement";
    }
  | {
      type: "statCompare";
      target: TargetRef;
      stat: Stat;
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      type: "counterCompare";
      target: TargetRef;
      counter: string;
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      /**
       * Generic `left <op> right` comparison between two NumberExpressions.
       * `statCompare`/`counterCompare` are for the common case of comparing
       * one specific card's stat/counter; use this when neither side is
       * anchored to a single target — most commonly a `count` expression,
       * e.g. "while an opponent controls at least 1 character".
       */
      type: "numberCompare";
      left: NumberExpression;
      operator: ComparisonOperator;
      right: NumberExpression;
    }
  | {
      /**
       * True while `target` is part of the current battle (e.g. "a blocking
       * character", "a character you control that is not in a battle" via
       * `not`). False whenever there is no active battle. Omit `role` to
       * match either side.
       */
      type: "inBattle";
      target: TargetRef;
      role?: "attacker" | "blocker";
    }
  | {
      /**
       * True when the triggering event is `damageDealt` and *this card* was
       * the source of that damage (e.g. "when this card deals damage to a
       * faction"). `sourceIsEventCard` isn't the right tool here — for
       * `damageDealt` it maps to the event's *target*, not its source.
       */
      type: "sourceIsDamageSource";
    }
  | {
      /**
       * True when the triggering event is `cardEnteredPlay` and the card came
       * from `zone` ("if another cicibeo card enters play from your hand").
       * Pair with `eventCardControlledBy` / `targetOwnedBy` for "your".
       */
      type: "enteredPlayFrom";
      zone: Zone;
    }
  | {
      /**
       * True when the triggering event is battle damage (`damageDealt` with
       * `battle: true`): "if a character inflicts BATTLE damage to a
       * faction" (Thabbashite Warmonger). Damage dealt by an effect is not.
       */
      type: "damageIsBattle";
    }
  | {
      /**
       * True when the triggering event is `damageDealt` and the card that
       * dealt the damage is `target` — e.g. an attachment's own trigger
       * "if the attached card inflicts damage to a faction" scopes with
       * `{ type: "damageSourceIs", target: "attachedTo" }` (Espionage
       * Loafers, Form 37-Ohhhhh).
       */
      type: "damageSourceIs";
      target: TargetRef;
    }
  | {
      /**
       * True when the triggering event is `cardMoved` and it moved out of
       * `zone` (e.g. `{ zone: "play" }` for "when this card leaves play").
       * Combine with `sourceIsEventCard` via `and` to scope to this card
       * specifically, the same way any other self-triggered ability does.
       */
      type: "cardMovedFromZone";
      zone: Zone;
    }
  | {
      /**
       * True when the triggering event is `cardMoved` and it moved *into*
       * `zone` (e.g. `{ zone: "discard" }` for "when this card is put into a
       * discard pile"). Combine with `sourceIsEventCard` via `and` to scope
       * to this card.
       */
      type: "cardMovedToZone";
      zone: Zone;
    }
  | {
      /**
       * True while the controller is the attacker/defender of the current
       * battle (e.g. a tactic's "deploy this only while you are
       * attacking"). Unlike `inBattle`, this is about the *player's* role
       * in the battle, not whether a specific card is in a party.
       */
      type: "battleRole";
      role: "attacker" | "defender";
    }
  | {
      /**
       * True when the triggering event carries a `playerId` field (e.g.
       * `turnStarted`, `turnEnding`, `cardPlayed`) equal to `player` — "at
       * the start of *your* turn." False for any event with no `playerId`
       * field at all.
       */
      type: "eventPlayerIs";
      player: PlayerRef;
    }
  | {
      /**
       * True when `target` resolves to a card id that's a member of
       * `ResolutionContext.selected[selection]` — e.g. constraining a
       * later selector to only the cards an earlier target declaration
       * already picked ("an opponent chooses X of those [previously
       * revealed] cards"). False if `selection` was never bound.
       */
      type: "targetInSelection";
      target: TargetRef;
      selection: string;
    }
  | {
      /**
       * Compares *how many times the current triggering event has already
       * occurred this turn* (`GameState.turnEventTally`, keyed by event type
       * and — when the event has one — its `playerId`) against `value`. "The
       * first resource each opponent plays each turn" is a `resourcePlayed`
       * trigger with `and(eventPlayerIs opponent, { eventOrdinal, operator:
       * "=", value: 1 })`. False when there is no triggering event.
       */
      type: "eventOrdinal";
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      /**
       * Compares the largest number of same-named cards `player` has
       * deployed *this turn* (`GameState.turnDeploys`) against `value` —
       * "an opponent deployed at least 2 cards with the same name this
       * turn" is `{ player: "opponent", operator: ">=", value: 2 }`.
       */
      type: "deploySameNameThisTurn";
      player: PlayerRef;
      operator: ComparisonOperator;
      value: NumberExpression;
    }
  | {
      /**
       * True when the card is being played *into a response window* whose
       * unresolved response stack contains a card of type `cardType` (any
       * card if omitted) other than this one — "deploy this only in
       * response to a character being deployed". Pair with the
       * `respondedToCard` TargetRef to reach that card (its `cardCost`,
       * `terminate` it, ...).
       */
      type: "respondingTo";
      cardType?: CardType;
      /** `"ability"` — true when the newest unresolved non-self stack item is an activated ability ("in response to an ability"; Cock Block); `cardType` then filters the type of the card the ability belongs to ("in response to a character's ability", Exploding Sock Puppet!). Default `"card"`. */
      respondsTo?: "card" | "ability";
      /**
       * `respondsTo: "card"` only: whether the responded-to card was deployed
       * using FLIP UP (`true`) or not (`false`). "Deploy this card only in
       * response to a card being deployed using FLIP UP" (Ritual of the
       * Sucking Skull). Omitted: either.
       */
      viaFlipUp?: boolean;
    }
  | {
      /**
       * True while responding to a card or ability whose stored selections
       * (`StackItem.context.selected`) include an in-play card of
       * `cardType` — it "picked a <cardType> as an extra cost". Gates
       * Mistaken Identity's EXTRA COST; pair with the `retargetExtraCost`
       * effect.
       */
      type: "respondedToPicked";
      cardType: CardType;
    }
  | {
      /**
       * Inside a target selector (candidate = `__candidate`): true when the
       * candidate is ANOTHER card than the `cardType` card the responded-to
       * card or ability picked as an extra cost, and is a legal pick for that
       * very declaration (its selector, "cannot be picked" restrictions, and
       * the ability's own source exclusions). "Pick another character that
       * can be picked by that card or ability" (Mistaken Identity).
       */
      type: "pickableByRespondedTo";
      cardType: CardType;
    }
  | {
      /**
       * True when the card currently resolving was played via its FLIP UP
       * cost (`ResolutionContext.deployedViaFlipUp`). "If you deployed this
       * card using FLIP UP, X is 4, otherwise X is 2" is an ability
       * `variables: { x: {...} }` plus an `if` branching on this.
       */
      type: "deployedViaFlipUp";
    }
  | {
      /**
       * True while `target` (default `"source"`) is in play having been
       * deployed into a response window as a non-tactic — it used "you may
       * play this card whenever you could play a tactic". "You may play this
       * card whenever you could play a tactic. If you do, …" (Ravenous Wolf,
       * Unexpected Boobysnake — older printings).
       */
      type: "deployedAsResponse";
      target?: TargetRef;
    }
  | {
      /**
       * True when `target` and `other` both resolve to a card and those
       * two cards share the same printed `name` — "search your deck for a
       * card with the same name" (bind `target` to `{ type: "selected",
       * id: "__candidate" }` in a selector's `conditions`, `other` to
       * `"eventCard"`). False if either side is missing.
       */
      type: "cardNameEquals";
      target: TargetRef;
      other: TargetRef;
    }
  | {
      /**
       * True when `target` resolves to a card with exactly the printed
       * `name` — "if the revealed card was named 'Obsession'" (Uhluhtc
       * Niudla). The literal-name counterpart of `cardNameEquals`.
       */
      type: "cardNameIs";
      target: TargetRef;
      name: string;
    }
  | {
      /**
       * True when `target` (default `"source"`) resolves to a card that its
       * *owner* set aside to the bottom of their deck during the opening
       * mulligan (`GameState.mulligan`). For "if you ... chose to put this
       * card on the bottom of your deck as part of your mulligan"
       * (Community Chest).
       */
      type: "bottomedInMulligan";
      target?: TargetRef;
    }
  | {
      /**
       * True when `target`'s current resource icons (`getResourceIcons` —
       * face-up printed icons / a PROVIDES line / Volition for a face-down
       * card) include at least `min` of `icon`. "A card that provides at
       * least [O]" — bind `target` to `"eventCard"` on a `resourcePlayed`
       * or `cardEnteredPlay` trigger.
       */
      type: "cardProvides";
      target: TargetRef;
      icon: ResourceIcon;
      min: NumberExpression;
    }
  | {
      /** True when `target` resolves to a staple resource (`ResourceDefinition.staple`). "...and it is a staple resource." */
      type: "isStaple";
      target: TargetRef;
    }
  | {
      /** True when `target` (default `"source"`) resolves to a depleted card. "At the end of your turn, if this card is depleted, ..." (Dying Hero). */
      type: "cardDepleted";
      target?: TargetRef;
    }
  | {
      /**
       * True when `target` (default `"source"`) is an in-play card that
       * currently has `keyword` (printed, granted, or via an aura —
       * `hasKeyword`). "while a player controls a character with COVERT"
       * (Torchlight Sarcophyle, via a `count` selector's `conditions`);
       * "pick a character with COVERT" (Predatory Lamp, I See You!).
       */
      type: "hasKeyword";
      target?: TargetRef;
      keyword: Keyword;
    }
  | {
      /**
       * True when `target`'s printed rules text (its audited
       * `CardDefinition.markup` as plain text; `text` for a definition with
       * no markup) references the given resource `icon` — e.g. a `[V]` token anywhere
       * in the text. "Characters you control with a [V] icon in their rules
       * text gain 2 strength and 2 life." (Marduun Ruins — bind `target` to
       * `{ type: "selected", id: "__candidate" }` inside an aura selector's
       * `conditions`).
       */
      type: "textMentionsIcon";
      target?: TargetRef;
      icon: ResourceIcon;
    }
  | {
      /** True when `target` and `other` resolve to cards of the same `CardType`. "A card of the same type as the discarded card." (Perturb). */
      type: "cardTypeEquals";
      target: TargetRef;
      other: TargetRef;
    }
  | {
      /**
       * True when `target` and the ability's `source` are both in the
       * current battle on the SAME side (both attacking, or both blocking)
       * — "a character in a party with this card" (Necromantic Healer,
       * used inside a `damageModifiers` selector's `conditions` with
       * `target` bound to `__candidate`).
       */
      type: "sharesBattlePartyWithSource";
      target: TargetRef;
    }
  | {
      /**
       * True when the card `source` has "remembered" as `key` (via the
       * `rememberTarget` effect) is still in play — "while the picked
       * location is in play" (Conscientious Objector).
       */
      type: "linkedCardInPlay";
      key: string;
    }
  | {
      /** True while the ability's `source` is a face-down card in play — "use this only while this card is a face-down resource" (Fired Hand, Vorpal Sword). */
      type: "sourceIsFaceDown";
    }
  | {
      /**
       * True when no card matching `among` has a strictly lower (`"min"`) /
       * higher (`"max"`) `metric` than `target` — "the character with the
       * lowest numeric cost" (Verrucose Brains; `metric: "cost"`,
       * `direction: "min"`, `among` = all characters). Ties: every extremum
       * satisfies it, so a `count: 1` declaration lets the controller pick.
       */
      type: "isExtremum";
      target: TargetRef;
      metric: "cost" | Stat;
      direction: "min" | "max";
      among: CardSelector;
    }
  | {
      /**
       * True when `target` resolves to the SAME card instance as `other`
       * (default `"source"`). Used inside a `CardSelector.conditions` /
       * `damageModifiers.selector` / `grantedAbilities.selector` to pin it to
       * one card — "the attached character" (`other: "attachedTo"`;
       * Swordchucks), "another item or character you control"
       * (`not` + `other: "source"`; Hollow Moose). `target` defaults to the
       * candidate (`{ type: "selected", id: "__candidate" }`).
       */
      type: "isCard";
      target?: TargetRef;
      other?: TargetRef;
    }
  | {
      /**
       * True when `by` (default `"source"`) has inflicted damage to `target`
       * this turn (`GameState.damageThisTurn[by].toCards`). "when a character
       * is destroyed during a turn when this card damaged it" (Gore Engine —
       * a `cardDestroyed` trigger gated by `{ damagedThisTurn, target:
       * "eventCard" }`). `by: "any"` — damaged by ANY source this turn ("if
       * the character has received damage this turn"; Snake Eyes).
       */
      type: "damagedThisTurn";
      target: TargetRef;
      by?: TargetRef | "any";
    }
  | {
      /**
       * True when `target` (default `"source"`) declared an attack this turn
       * (`GameState.attacksThisTurn`). Compose with `not` for "did not
       * attack this turn" (Reckless Challenger).
       */
      type: "attackedThisTurn";
      target?: TargetRef;
    }
  | {
      /**
       * True inside a `cardDestroyed` triggered ability when the lethal
       * instance was **battle damage** (`GameEventMap.cardDestroyed.byBattleDamage`,
       * set when the destroy is raised from `inflictLockedBattleDamage`).
       * "When this card is destroyed by battle damage, ..." (Venomous
       * Sacspider) — compose with `sourceIsEventCard`.
       */
      type: "destroyedByBattleDamage";
      target?: TargetRef;
    }
  | {
      /**
       * "If it is destroyed by that damage" inside an effect list, right after
       * a `dealDamage` to `target` (Chain Reaction): true when that damage
       * put `target` over its limit, whether the state check has already
       * destroyed it or is about to (so it also works nested inside an `if`
       * / chooser effect list, where the check hasn't run yet). False when
       * the card left play before the damage landed, so no damage was
       * inflicted (CR 402.4). Judged on the latest `dealDamage` to `target`.
       */
      type: "destroyedByDamage";
      target: TargetRef;
    }
  | {
      /**
       * True inside a `cardDestroyed` triggered ability when the destruction
       * was caused by a card (or effect) controlled by a player OTHER than the
       * destroyed card's controller ("When this card is destroyed by an
       * opposing card, ..." — Ecneret). False when its own controller's card
       * caused it, and when nothing did (`cardDestroyed.causePlayerId` unset).
       */
      type: "destroyedByOpposing";
      target?: TargetRef;
    }
  | {
      /**
       * True while `player` (default `"controller"`) MEETS `threshold` — the
       * CR §405.4 / §201.5d gate of a paragraph that begins with threshold
       * icons ("[R][R][R]: This card gains 3 life."). `threshold` uses the
       * same icon-letter shorthand as `CardDefinition.threshold` (`r` rage,
       * `g` greed, `d` deception, `e` elitism, `o` obsession, `v` volition;
       * `"oovv"` needs two of each), so a mixed-icon paragraph is ONE
       * condition.
       *
       * Met when the player controls at least that many of every icon
       * (`getThresholds`) OR their faction has `meetsAllThresholds`
       * (OMNIPOTENCE — The Evil Alliance automatically meets every
       * threshold). Unlike `numberCompare` over `resourceIcons`, which only
       * ever counts real icons, this is the form for "the paragraph is active
       * while you meet its threshold". Use `resourceIcons` for "X is the
       * number of [O] you control" and for an inline "if you control [V][V]"
       * that is not a printed threshold. Printed-threshold reductions and
       * FEALTY slack apply only to deploying a card, never to this.
       */
      type: "meetsThreshold";
      player?: PlayerRef;
      threshold: string;
    };
