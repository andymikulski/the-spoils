// -----------------------------------------------------------------------------
// Effects
// -----------------------------------------------------------------------------

import type { CardType, Duration, Keyword, ModifierOperation, Restriction, Stat, Trade, Zone } from "./ids.js";
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
      /**
       * Omitted = "play a resource" with no card named yet: `player` picks
       * one from their own hand when this resolves (SYS-33).
       */
      target?: TargetRef;
      /**
       * "auto" (default): a non-resource card (or a face-down-only
       * resource) goes in face-down; an actual resource card is the
       * player's choice, face-up or face-down (CR 203.2, SYS-7) — a
       * `playResource` pending choice.
       */
      faceDown?: boolean | "auto";
      player?: PlayerRef;
      /**
       * "Put a resource into play" — the same placement, but it isn't
       * *playing* a resource, so no `resourcePlayed` event ("when you play a
       * resource" triggers don't fire). Makeshift Contrivance, 1st Edition.
       */
      putIntoPlay?: boolean;
      /**
       * "Play a face-down resource attached to your faction": it enters
       * already attached (spent, CR 203.7) to its player's faction (Akashic
       * Notes).
       */
      attachedToFaction?: boolean;
    }
  | {
      type: "dealDamage";
      target: TargetRef;
      amount: NumberExpression;
    }
  | {
      /**
       * Several `dealDamage` hits that land simultaneously (Skin Suit: "Inflict
       * X damage to your opponent's character and Y damage to your character
       * simultaneously"). The state check runs only after every hit, so nobody
       * is destroyed half-way. With `loneVictimRemovedFromGame`, "if only 1 of
       * the characters is destroyed by this damage, remove it from the game
       * instead": a single lethally damaged character goes straight from play
       * to the removed zone, with no `cardDestroyed` event.
       */
      type: "simultaneousDamage";
      hits: Array<{ target: TargetRef; amount: NumberExpression }>;
      loneVictimRemovedFromGame?: boolean;
    }
  | {
      type: "modifyInfluence";
      player: PlayerRef;
      amount: NumberExpression;
    }
  | {
      /**
       * "Set your influence to N": the faction's influence becomes exactly the
       * evaluated `amount` (not below 0). Unlike `modifyInfluence` it is
       * neither a gain nor a loss, so influence-modifying abilities (Tax
       * Attorney) do not apply and it never counts as lost influence this turn
       * (`lostInfluenceThisTurn`); `influenceChanged` still reports the
       * difference. "Set your influence to your faction's starting influence"
       * (Siluriformes Incarnate) is `amount: { type: "factionStartingInfluence",
       * player: "controller" }`.
       */
      type: "setInfluence";
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
      /**
       * Whose hand or deck receives the card when `to` is `"hand"` or
       * `"deck"`. Omitted: the card's owner ("put it into its owner's hand",
       * CR §301.4a). Set it for printings that say "your hand" / "your deck"
       * — the card goes to that player's hand/deck and that player controls
       * it, even when someone else owns it (`CardInstance.heldBy`). Ignored
       * for every other zone, which always belongs to the owner.
       */
      toPlayer?: PlayerRef;
      /**
       * Put the card there FACE-DOWN (`CardInstance.faceDown` stays true in
       * the void / out-of-game area): "put the top 4 cards of an opponent's
       * deck into the void face-down" (Pant Swipe). Only the void and removed
       * areas keep it; the next move clears it like any other.
       */
      faceDown?: boolean;
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
      /**
       * The controller's faction Restore Rule (CR §202.7): detach the faction's
       * resources and restore their non-resource permanents, honouring skipped
       * rules and per-card locks. Only ever the effect of the faction's
       * start-of-turn trigger (queued by the engine, never authored on a card).
       */
      type: "restoreRule";
    }
  | {
      /**
       * The controller's faction Develop Rule (CR §202.8): offers the faction's
       * choices (draw / play a resource) as a `chooserSelectsOption`.
       * `remaining` is how many uses of the rule are left, this one included
       * (`turn.develop.usesPerTurn`); omitted = all of them. `draw` carries out
       * the draw choice itself (with Arcane Escrow's substitution) instead of
       * offering. Only ever the effect of the faction's start-of-turn trigger,
       * or of an option it offers (queued by the engine).
       */
      type: "developRule";
      remaining?: number;
      draw?: number;
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
      /**
       * A standing "this turn" stat change over every card matching `selector`, judged live each time the stat is read
       * — not a snapshot of the cards that match when the effect resolves. "This turn, the speed of all characters that
       * opponent controls is reduced to 0." (Rasputin Unleashed: `selector: { controller: "opponent", zone: "play",
       * type: "character" }`, `operation: "set"`, `value: 0`, `duration: untilEndOfTurn`) also reaches a character the
       * opponent puts into play later the same turn. The selector's player words ("self" / "opponent") are fixed to
       * the effect's controller when it resolves; the cards matched are not. Applied with the card-scoped
       * `createModifier`s in order of creation. Swept at the start-of-turn point like every other duration'd modifier.
       */
      type: "createAreaModifier";
      selector: CardSelector;
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
      /**
       * Default (`false`) — every iteration resolves inside one deferred
       * event batch (triggers wait until the whole loop finishes;
       * "simultaneous" resolution — "inflict 2 damage to all characters").
       * `true` — iterations run one at a time through the suspendable
       * effect-frame path, so a per-iteration chooser (`chooserSelectsTarget`,
       * `deployForFree`, …) pauses and resumes correctly, and triggers fire
       * between iterations. "That player discards a card. You may deploy a
       * card for free. Repeat until that player has no cards in their hand."
       * (Degenerate Molestation — `forEach` over the opponent's hand
       * snapshot with `sequential: true`).
       */
      sequential?: boolean;
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
      /**
       * Who takes a pile. Omitted: `pile1` goes to the first pile as the
       * splitter wrote it. Set (Profane Proposal: the splitter only
       * separates, then "you" put one pile into your hand): once the
       * splitter has answered, `picker` chooses which of the two piles gets
       * `pile1` (the other gets `pile2`) with a `chooserSelectsOption`
       * (option 0 = the first pile, option 1 = the second).
       */
      picker?: PlayerRef;
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
      /** The declaration whose picks get the grant. Give `selector` instead for cards no pick named (Eccentric Inquisition: the tactics it just removed). */
      selected?: string;
      /** Every card matching this selector (in the void or the removed zone) gets the grant. */
      selector?: CardSelector;
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
       * Flip an in-play FACE-DOWN card face-up in place — the inverse of
       * `flipFaceDown`, and the mechanical core of the "FLIP IT"
       * staple-resource cycle (Elitist Upgrade, Obsessive Concentration,
       * Greedy Profiteering, Deceptive Domain, Raging Ferocity), whose
       * "EFFECT: Put this card into play face-up" is exactly this on
       * `{ type: "source" }`. Per RULES.md §2 (CR §411.3 / §411.4) the flip
       * is a *leaves-play + enters-play* boundary: what left was an
       * anonymous face-down resource (its printed triggers were dormant, so
       * NO "leaves play" trigger fires — the asymmetry with `flipFaceDown`);
       * what enters is the card's real self, so `cardEnteredPlay` fires and
       * the card now provides its printed icons instead of Volition. No-op
       * if `target` isn't a face-down card in play.
       */
      type: "flipFaceUp";
      target: TargetRef;
    }
  | {
      /**
       * "Turn this card over" — the double-sided-faction-card flip (Imperial
       * Army <-> Counter-Imperial Army). Unlike `flipFaceDown`/`flipFaceUp`
       * (which model a face-down RESOURCE), this is the same in-play card
       * object becoming its OTHER printed side: reassigns `target`'s
       * `CardInstance.definitionId` to `FactionDefinition.flipsTo` off its
       * CURRENT definition. Every live faction lookup (`getFactionDefinition`,
       * abilities, thresholds, restore/develop rules) reads through
       * `getDefinition`, so the new side takes over immediately with no
       * further bookkeeping. No-op if `target` isn't in play, isn't a
       * faction, its current side has no `flipsTo`, or the flip target isn't
       * a registered `CardDefinition` (the consumer didn't load it).
       */
      type: "flipFactionCard";
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
       * For an ATTACH TO card: the host the effect itself specifies ("put the
       * gear card into play attached to the character", Tri-Pole Magnet). When
       * omitted the card's new controller picks a legal host as it enters
       * play (CR 507.2b), and with no
       * legal host it goes to its owner's discard pile instead (CR 507.2c).
       */
      attachTo?: TargetRef;
      /**
       * "If that card would leave play or is in play at the end of the
       * turn, remove it from the game instead." — a borrowed entrance: the
       * card is removed from the game the moment it would otherwise leave
       * play, and unconditionally at end of turn (Barracks of Precipitancy).
       */
      borrowed?: boolean;
      /**
       * "If that card or this card would leave play this turn, remove both
       * cards from the game instead" (Spurious Anthropologist): the entering
       * card and the effect's source are paired until the end of the turn;
       * either one leaving play removes both from the game.
       */
      pairWithSource?: boolean;
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
       * Effects that happen only if the player actually deploys the card
       * (declining the "you may" skips them): "you may play it for free and
       * terminate your opponent's card" — the `may` covers both (Q22).
       */
      afterDeploy?: Effect[];
      /**
       * Whether the numeric cost is waived. `true` (default) = for free;
       * `false` = the player still pays the card's printed cost; a
       * `Condition` = waived only when it holds ("if its numeric cost is 4
       * or less, you may deploy it for free" — Gang Weapon Dealer, a
       * `numberCompare` on `cardCost` of the revealed card).
       */
      free?: boolean | Condition;
      /**
       * "Deploy it for N": a flat alternative numeric cost replacing the
       * card's printed cost (and any reductions). N is paid only if the
       * deploy actually happens (threshold and extra costs still apply);
       * declining the pending `deployForFree` choice pays nothing.
       * Overrides `free`. Mindrender.
       */
      cost?: NumberExpression;
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
      /**
       * "...each face-down resource that doesn't have PROVIDES: X, gains
       * PROVIDES: X" (Thabbashite Chemist): skip a target that already
       * provides `icon` (printed, Volition face-down, or an earlier grant).
       */
      onlyIfLacking?: boolean;
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
      /**
       * Survives turn boundaries until a play consumes it. For printings
       * with no "this turn" ("Reduce the threshold requirement of the next
       * card you play" — Clockman Skydocks). Default: lapses at the start of
       * the next turn.
       */
      persistent?: boolean;
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
      /**
       * `mode: "reduce"` only — the reduction applies to the NEXT damage
       * instance only: a hit smaller than `amount` uses it up, it does not
       * carry over ("Reduce the next damage inflicted to the character this
       * turn by 2" — Tiny Shiny). Without it `amount` is a pool of points.
       */
      oneInstance?: boolean;
      /**
       * Survives turn boundaries until spent. For printings with no "this
       * turn" ("The next 1 damage that would be inflicted to the character is
       * inflicted to this card instead" — A Series of Tubes, 1st Edition).
       * Default: lapses at the start of the next turn.
       */
      persistent?: boolean;
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
      when: "startOfNextTurn" | "startOfOpponentNextTurn" | "startOfTheNextTurn" | "endOfTurn" | "endOfBattle";
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
      /**
       * The keyword only counts while this holds, evaluated from the
       * granting card's point of view whenever the keyword is checked —
       * "This turn, while this card is the only member of an attacking party
       * it cannot be blocked." (Schproingmajig, 1st Edition Part 2).
       */
      condition?: Condition;
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
      /**
       * Only damage inflicted to this player's FACTION is adjusted ("reduce
       * all damage the character inflicts to your faction to 0" — Scintillating
       * Chamber Pot). Resolved when the effect resolves. Omitted: all damage.
       */
      toFaction?: PlayerRef;
    }
  | {
      /**
       * A runtime adjustment to EVERY damage instance inflicted TO `target`
       * for `duration`, floored at 0 — "if damage is inflicted to the
       * character this turn, reduce the amount by 1" (Fiscal Intercessor).
       * Unlike a `preventDamage` shield it is not used up by the first hit.
       */
      type: "modifyIncomingDamage";
      target: TargetRef;
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
       * "Repeat this until <condition>": runs `effects`, then re-evaluates
       * `condition` and runs them again while it still holds. The condition
       * is judged BEFORE every pass (so it is never run when it is already
       * false) against the board as it is now, not a snapshot taken at the
       * start (Degenerate Molestation: "repeat until your opponent has no
       * cards in their hand" -- a card drawn mid-loop is discarded too).
       * Nested choosers pause the loop and resume it. Each pass gets its own
       * pick scope. `maxPasses` (default 1000) is a loop guard: a loop that
       * does not make its condition false throws instead of hanging.
       */
      type: "repeatWhile";
      condition: Condition;
      effects: Effect[];
      maxPasses?: number;
    }
  | {
      /**
       * Resolves `effects` only if `condition` holds — the "if you do" half
       * of an optional `TargetDeclaration` ("you may pick a character. If
       * you do, ..."): gate with `{ type: "targetExists", target: {
       * type: "selected", id: "<declarationId>" } }`. When `condition` is
       * false and `elseEffects` is given, those resolve instead ("if the
       * card has a [V] icon ... otherwise ..." — Single Combat).
       */
      type: "if";
      condition: Condition;
      effects: Effect[];
      elseEffects?: Effect[];
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
      /**
       * When the pick is mandatory and has no more legal candidates than
       * slots there is nothing to decide: skip the prompt and use them all
       * (Subordinate Demotivation: only a tie asks "you decide").
       */
      autoWhenForced?: boolean;
      /**
       * In a card's FLIP UP line only: the pick is part of the FLIP UP COST
       * (CR 507.4c, "and you may pick up to 2 characters"), so it is asked
       * BEFORE the card flips (a refused answer leaves it face-down) and
       * `effects` still run when the flipped card resolves (Hasty Pursuit).
       */
      asCost?: boolean;
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
       * With `to: "split"`: EXACTLY this many of the looked-at cards go on
       * the bottom, the rest on top ("put 1 card on the bottom and 1 on the
       * top"). Absent = any number on the bottom.
       */
      bottomCount?: NumberExpression;
      /**
       * "You may put one of those cards into your hand. Put the remaining
       * cards on the bottom of your deck in any order" (Volatile Communion:
       * `{ min: 0, max: 1 }`) / "put 1 into your hand and 1 on the bottom"
       * (Zenobia's Tower: `{ min: 1, max: 1 }`). Replaces `to`: the cards not
       * taken go to the bottom.
       */
      intoHand?: { min: number; max: number };
      /**
       * Who does the looking / reordering — defaults to `player` (the deck's
       * owner). Set it for "any opponent ... looks at the top 3 cards of
       * YOUR deck and puts them back in any order" (Tedious TriAdic
       * Truculence): `player: "controller"`, `chooser: "opponent"`.
       */
      chooser?: PlayerRef;
      /**
       * "Look at UP TO the top N cards": the chooser may look at (and put
       * back) any number of cards from 0 to `count`. The answer is a
       * rearrangement of the top K cards for some K in 0..N; the rest stay
       * unseen where they were.
       */
      upTo?: boolean;
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
      /**
       * With `cardType`: the numeric cost of an ability of a card of that type is also "the next numeric cost"
       * ("the next item's or item's ability's numeric cost", Adjunct Artisan). Without it a card-type-specific
       * reduction never reaches an ability's "pay N" (CR 406.5b).
       */
      includeAbilities?: boolean;
      /** "Reduce the numeric cost of the next CARD you play": only a card's own numeric cost, never an ability's "pay N". */
      cardsOnly?: boolean;
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
       *
       * `budget` — "you may deploy any number of cards for free with total
       * numeric cost X or less" (Reality Shift). When set, the player is
       * re-prompted after each free deploy, with a running pool that starts
       * at `budget` and drops by each deployed card's printed cost; the
       * loop ends when they decline, nothing in hand still fits, or a
       * deployed card's own resolution needs a further choice. `maxCost`
       * still caps any single card (use a large value for "no per-card
       * cap").
       */
      type: "deployForFree";
      player: PlayerRef;
      maxCost: NumberExpression;
      selector?: CardSelector;
      free?: boolean;
      budget?: NumberExpression;
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
      /** A TargetDeclaration id whose picks are divided among. Exactly one of `selected` / `among`. */
      selected?: string;
      /**
       * Divide over every card this selector matches when the effect
       * resolves, with no pick involved ("divided among the attacking
       * characters", Trip Wire).
       */
      among?: CardSelector;
      /**
       * A cap on any single card's share, evaluated with that card bound to
       * `{ type: "selected", id: "__candidate" }` — "remove X tokens from
       * cards you control, divided however you want" can't take more tokens
       * from a card than it holds (Voidal Humour Redistribution).
       */
      maxShare?: NumberExpression;
      /**
       * "Inflict up to 2 damage divided however you want": the chooser need
       * not give out the whole `amount` (the pending choice's `upTo`).
       * Without it the whole amount must be given.
       */
      upTo?: boolean;
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
       * Turn cards over from the top of `player`'s deck one at a time until
       * one satisfies `match` (evaluated with the candidate bound to the
       * selector `__candidate`) or the deck runs out. Emits `cardsRevealed`
       * for every card turned over.
       * - On a match: the card is bound to `bindAs` in `context.selected`
       *   and `onMatch` resolves (it stays on top of the deck unless an
       *   `onMatch` effect moves it).
       * - `onEmpty` resolves if nothing matched.
       * - `rest` disposes of the OTHER revealed cards (never the match):
       *   `"shuffle"` them back (default), or move them to `"bottom"` /
       *   `"discard"` / `"void"`.
       * "Reveal cards from the top of your deck until a character with
       * numeric cost X or less is revealed ... Shuffle all other revealed
       * cards into your deck." (Surprise!).
       */
      type: "revealFromTopUntil";
      player: PlayerRef;
      match: Condition;
      bindAs: string;
      onMatch: Effect[];
      onEmpty?: Effect[];
      rest?: "shuffle" | "bottom" | "discard" | "void";
    }
  | {
      /**
       * Show `count` (default 1) cards from the top of a deck / all of a
       * hand to `viewer` — "reveal the top card of your deck", "look at an
       * opponent's hand". Pure information: emits `cardsRevealed` and
       * nothing else (the engine has perfect information; this is for a
       * renderer / log). For an ongoing "revealed at all times" use
       * `ContinuousAbility.grantsReveal`.
       */
      type: "reveal";
      of: PlayerRef;
      zone: "deckTop" | "hand";
      count?: NumberExpression;
      viewer?: PlayerRef | "all";
    }
  | {
      /**
       * Show specific cards to `viewer` — the "...and reveal it" half of
       * "search your deck for a tactic, reveal it, and put it into your
       * hand". Names the cards the way `forEach` does: `selected` is the id
       * of a `TargetDeclaration` (the cards that pick chose), or `selector`
       * matches cards directly ("reveal all copies of the named card"), and
       * `target` names one card ("reveal this card" — a hand card's own
       * trigger, Thabbashite Desert Creature).
       * Place it right after the pick and before the effect that moves the
       * card, so the card is shown from the zone it was found in. `viewer`
       * defaults to `"all"` (a printed "reveal" is public); name a player to
       * show it to that player only.
       *
       * Emits `cardsRevealed` (one event per owner + zone among the cards)
       * and nothing else. Nothing to show (a declined "you may search")
       * emits nothing. Which printings carry this effect follows each
       * printing's own printed text — a reprint that drops "reveal it" does
       * not get it.
       */
      type: "revealCards";
      selected?: string;
      selector?: CardSelector;
      target?: TargetRef;
      viewer?: PlayerRef | "all";
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
       * Engine-built (never authored): "pay these costs as part of the
       * effect; if they cannot all be paid, nothing happens". The costs are
       * ordered and rehearsed like a play's (numeric `payResources` last,
       * `pick` steps judged in written order against `declarations`), the
       * selections they read are already in `context.selected`. Only when
       * everything is paid do `effects` run. A duplicate keeps the copied
       * tactic's extra costs, which its controller pays again (CR 307.1).
       */
      type: "payCosts";
      costs: Cost[];
      declarations?: TargetDeclaration[];
      effects: Effect[];
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
       * hand instead of their discard pile" (Voidal Interference); `"hold"`
       * only takes the card off the stack and leaves it where it is (zone
       * `deploying`) for a following effect to move (Forced Recruitment: the
       * card then enters play without visiting a discard pile). Ignored
       * for a terminated ability (which just drops).
       */
      type: "terminate";
      scope?: "target" | "othersOnStack" | "respondedItem";
      target?: TargetRef;
      disposition?: "discard" | "hand" | "hold";
    }
  | {
      /**
       * "Terminate your end of turn declaration." (Lost on Floor 3). The
       * controller's announced end of turn (CR 610.1) is cancelled: the open
       * `endTurn` response window becomes a plain action window, so once the
       * responses in it finish the turn goes on instead of ending, and the
       * player may announce the end of the turn again later. A battle started
       * inside that window drops its `resumeEndTurn`. Does nothing when no
       * end of turn of the controller's is pending.
       */
      type: "terminateEndOfTurn";
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
      /** Values that may not be named ("name a non-[V] resource icon": `["volition"]`). */
      exclude?: string[];
      /**
       * `valueKind: "cardName"` only — "name a non-resource card": the name
       * must be an existing card that is not a resource. Checked against the
       * optional card catalog given to the engine (`setCardCatalog`, the
       * `cardCatalog` game-setup option); with no catalog any non-empty text is
       * accepted, as before.
       */
      nonResource?: boolean;
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
      /**
       * "You may pay 2 and pick a character": the pick is part of the elected
       * action. With nothing to pick (the first effect is a
       * `chooserSelectsTarget` with no candidates) nothing is offered or
       * paid (`elseEffects` run), and once paid the pick cannot be declined
       * (Q19). Executive Order #6370u7.
       */
      payAndPick?: boolean;
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
       * "Change the target of that attack to <card>." — while a battle is in
       * progress, repoints `GameState.battle.target` at the in-play card
       * `to` resolves to (typically a location the controller just put into
       * play from their discard pile — Architectural Restitution). The
       * battle's defending player is updated to that card's controller. No-op
       * if there is no active battle or `to` doesn't resolve to an in-play
       * card.
       */
      type: "redirectAttackTarget";
      to: TargetRef;
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
      /**
       * "This does not affect paying costs" (Open Beta / 1st Edition Limited
       * Liability): damage inflicted as a COST is not reduced. Absent, cost
       * damage is reduced like any other (2nd Edition wording).
       */
      exceptCosts?: boolean;
      /**
       * Only BATTLE damage (damage inflicted in a battle's damage steps) is
       * reduced; damage from a tactic or ability during the window still
       * lands. "Reduce all battle damage inflicted during this battle to 0"
       * (Inconvenient Roadblock; pair with an `endOfBattle` duration).
       */
      battleOnly?: boolean;
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
    }
  | {
      /**
       * Adds `subtype` to `target`'s subtype list for `duration` (a runtime
       * `GameState.subtypeGrants` entry). Every subtype consumer reads it
       * (`cardSubtypeIs`, `CardSelector.subtype` / `subtypeVar`,
       * `distinctCount by: "subtype"`, `hasAttachment.ofSubtype`). "It gains
       * the sarcophyle subtype" (Sarcophyle Matriculation, Vander Malagut).
       */
      type: "grantSubtype";
      target: TargetRef;
      subtype: string;
      duration: Duration;
    }
  | {
      /**
       * Opens a runtime window during which any card that would enter a hand
       * (`moveCard` to `"hand"`) from ANY zone is put into `to` (that
       * owner's zone) instead. "This turn, if a card would be put into a
       * player's hand, put it into their discard pile instead" (Quotidian
       * Misfire — `to: "discard"`). `who` scopes on the affected card's
       * owner. Distinct from a `moveToZone` `ReplacementAbility`, which only
       * fires on a card leaving *play*.
       */
      type: "redirectHandMoves";
      who: "self" | "opponent" | "any";
      to: Zone;
      duration: Duration;
    }
  | {
      /**
       * Installs a runtime replacement (`GameState.runtimeReplacements`)
       * consulted by the same path as a card's `ReplacementAbility`. The
       * affected card is bound to `{ type: "selected", id: "__candidate" }`
       * inside `effects`; `condition` (if set) is checked against that
       * binding at replacement time. Swept when `duration` expires
       * (`untilEndOfTurn` or an `endOfBattle` sweep). "If the character
       * would be destroyed during this battle, take control of it instead"
       * (Sarcophyle Matriculation) — the one-shot form of a continuous
       * replacement ability (Vander Malagut).
       */
      type: "installReplacement";
      replaces:
        | {
            event: "destroy";
            cardType?: CardType;
            /** Whose card — relative to the installer (`"self"` = a card the installing ability's controller controls). Default `"any"`. */
            controlledBy?: "self" | "opponent" | "any";
            /**
             * Who caused the destruction — relative to the installer, the same scope as
             * `ReplacementAbility.replaces.by`: the controller of the effect being resolved, or of the
             * character that dealt the lethal damage (battle damage included, CR 408.7 / 408.8). A
             * destruction no player caused (the game rules, e.g. a card attached to the wrong host)
             * matches neither `"self"` nor `"opponent"`. Default `"any"`. "characters you control cannot
             * be destroyed by cards or abilities your opponents control" (Escort Ally):
             * `controlledBy: "self", by: "opponent"`.
             */
            by?: "self" | "opponent" | "any";
            /**
             * Only a destruction by an effect whose source card matches this selector (candidate bound
             * to `__candidate`, relative to the installer) — never battle damage or a destruction with
             * no originating card. The narrower reading of "by cards or abilities".
             */
            bySource?: CardSelector;
          }
        | {
            event: "moveToZone";
            /** `"any"`: every destination but play and the hand (with `from: "play"`: any way to leave play, Retreat to Mount Mulrich). */
            zone: Zone | "any";
            /** Only a card moving out of this zone. */
            from?: Zone;
            cardType?: CardType;
          };
      condition?: Condition;
      duration: Duration | { type: "endOfBattle" };
      effects: Effect[];
      /**
       * "you may ... instead": the installer's controller is asked
       * (a `replacementChoice`) whether to apply it; declining lets the
       * original event happen. (E9c — Rune of Concealment.)
       */
      optional?: boolean;
      /**
       * "The NEXT time ...": the replacement is used up the first time it
       * applies (or is offered), so a second event is not replaced.
       */
      once?: boolean;
    }
  | {
      /**
       * "This turn, <blocker> must block <target> if it can" / "all
       * characters able to block <target> must do so" (E8, SYS-39). Unlike
       * the attacker-agnostic `mustBlock` restriction, the obligation exists
       * only in a battle whose attacking party includes `target` (default
       * `"source"`), and only for a character that could legally join that
       * block. `blocker` names one character (Titillating Contortionist's
       * pick); omitted, it covers EVERY character that could block `target`,
       * including ones that enter play later this turn (Carnival King).
       * Registered on `GameState.mustBlockGrants`.
       */
      type: "requireBlock";
      target?: TargetRef;
      blocker?: TargetRef;
      duration: Duration;
    }
  | {
      /**
       * "This turn, a forming attacking/blocking party that includes
       * `target` (default `"source"`) must <constraint>." — the "this turn"
       * form of `ContinuousAbility.partyRestriction` (parallel to
       * `restrictBlockers` vs `blockRestriction`). Registered on
       * `GameState.partyRestrictionGrants`, checked in `declareAttack` /
       * `declareBlockers`. Carnival King — "when an attacking party is
       * formed including the character, it must have only 1 member"
       * (`role: "attacking", minMembers: 1, maxMembers: 1`).
       */
      type: "restrictParty";
      target?: TargetRef;
      role: "any" | "attacking" | "blocking";
      minMembers?: NumberExpression;
      maxMembers?: NumberExpression;
      parity?: "even" | "odd";
      duration: Duration;
    }
  | {
      /**
       * "Remove any number of tokens from cards you control. Use the tokens
       * to generate the following effects any number of times." (Voidal
       * Poisoning). `chooser` repeatedly picks an `option` and removes its
       * `cost` markers of `counter` from cards matching `pool` (their choice
       * which) to fire that option's `effects`, in any mix, until they stop
       * or cannot afford any option. Drives a `spendCountersMenu` pending
       * choice. RULES.md §14.
       */
      type: "spendCountersMenu";
      chooser: PlayerRef;
      pool: CardSelector;
      counter: string;
      options: Array<{ cost: number; label?: string; effects: Effect[] }>;
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
  /**
   * The option can be chosen only while this holds, judged when the choice is
   * offered (from the effect's point of view). An option that fails it is
   * listed in the pending choice's `unavailableOptions` and answering with it
   * is refused. "Remove a token from this card" with no token on it (Meat of
   * the Mountain).
   */
  condition?: Condition;
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
  /** Token's trade; defaults to gearsmith for a "majig" token (CR 409.3c), else universal. */
  trade?: Trade;
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
  /**
   * `cannotBePicked` only: the restriction does not apply to a pick made by
   * a card (or an ability of a card) of this type — "cannot be picked by
   * NON-ITEM cards or abilities" is `cannotBePicked` with
   * `exceptPickerType: "item"` (Gigantitect's Giant Giant).
   */
  exceptPickerType?: CardType;
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
