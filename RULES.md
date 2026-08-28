# The Spoils — Rules Reference

This document is the reference against which `src/engine` is tested for
correctness. It describes **the game's rules**, independent of how the
engine happens to implement them today. When a test fails, the question to
ask is "does the engine match this document?" — not "does the engine match
itself?"

## Sources

- *The Spoils CCG Rulebook* (Basic Rules, v2.2), Tenacious Games — covers
  core mechanics: turn actions, resources/threshold, card types, zones,
  priority/responses, battle, abilities, victory. Archived at
  [archive.org/details/TheSpoilsCCGRulebook](https://archive.org/details/TheSpoilsCCGRulebook).
- `data/cards.json` — the real card database (2101 cards). Used to verify
  and fill in mechanics the v2.2 basic rulebook doesn't cover (it predates
  later card pools). Where the two disagree, the card text wins, since it's
  what actually shipped. Every claim below marked **(card-verified)** was
  cross-checked against real printed card text, not just the rulebook.
- `src/engine` itself, where a rule's current *implementation* clarifies an
  ambiguity in the source material (e.g. exactly what "provides a resource
  icon" means for a face-down card). Marked **(engine-derived)**.

Anything not covered by these sources should be treated as undecided —
flag it rather than guessing.

## 1. Objective

A player wins when their opponent's faction reaches 0 influence. If both
factions hit 0 influence from the same event, the game is a draw. Influence
loss is tracked separately from character/location damage — effects that
key off "damage" do not fire from influence loss, and vice versa.

**(engine-derived)** This is surfaced as `GameState.winner` /
`GameFlowView.winner` (`PlayerId | "draw"`), set by the same state-based
check as everything else in §11, and `GameFlowView.mode` becomes
`"gameOver"`. Once set, `perform()` rejects anything that would start a new
action; it still allows whatever was already in flight (an open response
window, an in-progress battle) to drain to a clean stop, since a lethal blow
is often struck mid-battle-resolution.

## 2. Zones

| Zone | Meaning |
|---|---|
| `deck` | The player's draw pile. Hidden, ordered. Searched only when a card explicitly allows it, and reshuffled after a search. |
| `hand` | Cards drawn but not yet played. Hidden from the opponent. |
| `deploying` | Transient zone a card occupies while it is being played — cost paid, but not yet resolved / not yet in play. Exists so responses can be raised against it before it lands. |
| `play` | Characters, items, locations, and the faction card live here while active. Resources (face-up or face-down) also live here, attached to the controller's faction. |
| `discard` | Destroyed permanents and resolved tactics land here. Recoverable by effects that say so. |
| `void` **(card-verified)** | A zone for cards set aside by specific effects, distinct from both `discard` and being "removed from the game." Cards in the void can be returned to play/hand only by effects that explicitly reference the void (e.g. *Eldridge Gosche, Godstealer*'s "pick a tactic you own in the void", *Deity Delimitation Device*'s "release"). Default trajectory (destruction) does **not** send cards to the void — only effects that say "put into the void" do. |
| `removed` **(card-verified)** | "Removed from the game" (seen on cards like *Master Scavenger*, *Swashbuckler*, *Resurrection Emporium*) — permanent and unretrievable, unlike `void`. Reached via the `removeFromGame` effect. Nothing in the effect vocabulary can move a card back out of `removed`, by design. |

Conceptually a card removed from the game is just *gone* — it doesn't need
to be a place a card can be found. It's still tracked as a real `Zone`
value (`PlayerState.removed`) rather than deleted from `GameState.cards`
outright, purely so ordinary bookkeeping (search-the-deck exclusions,
"cards in your discard pile" counts, etc.) doesn't have to special-case a
card that stopped existing. Nothing in the effect vocabulary can move a
card back out of `removed`. A `CardSelector` with no explicit `zone` filter
still matches every zone including `removed`, same as it would `deck` or
`hand` — that's an existing, general property of selectors (scope them
explicitly), not something specific to this zone.

## 3. Card types

- **Character** — has strength (battle damage dealt), life (damage it can
  absorb before dying), speed (battle damage ordering), and may have
  abilities/keywords. Can attack and block. Only playable on the
  controller's own turn (unless it has the **Tactical** keyword).
- **Item** — persistent, may modify stats/effects of itself or another card
  (including via "Attach to X"). Never depletes on its own. Only playable
  on the controller's own turn (unless **Tactical**).
- **Location** — persistent, has a damage capacity ("structure") and
  ongoing effects. Can be attacked directly instead of the controller's
  faction. Damage persists turn to turn (does not clear at end of turn the
  way character damage does) and destroys the location once accumulated
  damage ≥ structure. Only playable on the controller's own turn (unless
  **Tactical**).

  **(engine-derived)** A location's capacity is its own
  `CardDefinition.structure` field (not `life`). `checkStateBasedActions`
  destroys characters and locations the same way — accumulated damage ≥
  capacity — reading `life` for a character and `structure` for a location.

  > **(resolved)** All 140 real location cards in `data/cards.json` now
  > carry a numeric `structure`; `card-data-integrity.test.ts` enforces it
  > (a location with no structure could never be destroyed by damage). The
  > last gap, *Zenobia's Tower*, was filled from the card art after the
  > source dump mislabelled its STRUCTURE shield as `speed` — see its
  > coverage-manifest note. Engine-rules tests still use synthetic location
  > fixtures with an explicit `structure`, on purpose (they must fail for
  > engine reasons, not data ones).
- **Tactic** — one-shot effect; resolves then goes to `discard`. Can always
  be played as a response (that's the entire point of the type), during
  battle response windows, or as a normal turn action.
- **Resource** — provides one resource icon while in play, attached to the
  controller's faction. Never depletes; only becomes usable again via a
  faction's restore rule detaching it.
- **Faction** — the player's avatar. Not included in a deck; one is chosen
  (or supplied) at setup. Defines: starting influence, starting resources,
  opening hand size (first vs. second player), whether/how a mulligan is
  offered, the turn-start restore rule, and the develop-step choices
  available each turn. May also carry its own activated abilities.

## 4. Resources, thresholds, and costs

- **Trades**: Arcanist (Obsession), Banker (Greed), Gearsmith (Elitism),
  Rogue (Deception), Warlord (Rage) — five trades, five matching resource
  icons. `Universal` is not a trade with its own resource; it marks cards
  playable by any faction (staples, and — per the real card pool — a body
  of "Story"/crossover cards keyed off the Volition icon, see below).
- **Threshold** is the *icon* requirement printed on a card (shorthand: a
  string of letters, e.g. `"rr"` = two Rage icons required). It is a gate,
  not a cost: once satisfied by resources in play, it isn't consumed and
  doesn't limit how many threshold-gated cards can be played.
- **Numeric cost** is paid by attaching that many of your in-play,
  unattached resources to your faction. Attached resources can't be reused
  until detached (typically by the controlling faction's turn-start restore
  rule). Playing something "for free" skips the numeric cost but not the
  threshold or any other listed cost.
- **Non-numeric ability costs** (deplete a card, destroy a card, discard N
  cards) that name a specific card require the player to have already
  chosen it — there's no auto-pick. A "discard N" cost carries its own `id`
  (`Cost` with `type: "discard"`) and is satisfied the same way a target
  declaration is: via `selected[cost.id]`, supplied up front in the
  `activateAbility` action alongside any target selections, and checked for
  legality (right zone/controller, no duplicates, exactly N) before the
  ability can be paid for at all.
- **Playing a resource**: either (a) put an actual resource card from hand
  into play face-up, providing its printed icon, or (b) put *any* card from
  hand into play face-down as a resource.
- **Volition (card-verified, engine-derived)** — the icon a face-down
  resource provides, regardless of what the card actually is. This is why
  `"v"` threshold requirements appear only on `Universal`-trade cards in the
  real data (e.g. *Zigalburgonglgr, the Stolen God* at `"vvvvvv"`) — those
  cards are designed to be paid for by face-down resources from any deck,
  not by a dedicated Volition resource card. `Threshold`/`ResourceIcon` in
  the type system therefore has six members (`rage, greed, deception,
  elitism, obsession, volition`), not five — this is intentional, not a
  typo, and the engine's `getResourceIcons` already implements it correctly
  (`card.faceDown → ["volition"]`).

## 5. Setup

1. Each player's faction enters play; its printed starting influence
   becomes that player's influence total.
2. Each player finds their faction's required starting resources in their
   deck and puts them into play (per the Tournament Faction: 2 staple
   resources), then shuffles.
3. Determine turn order (first/second player).
4. Each player draws their faction's starting-draw count — first player and
   second player amounts usually differ (Tournament Faction: 8 / 9) to
   offset the advantage of going first.
5. If the faction offers a mulligan, each player in turn order may set aside
   any number of hand cards to the bottom of the deck (in an order of their
   choosing) and draw that many replacements. This can only happen once per
   player — no rummaging through it again. **(engine-derived)** which cards
   each player set aside is recorded on `GameState.mulligan` and read by
   the `bottomedInMulligan` condition (*Community Chest*).
6. Turn 1 begins in the develop step for the first player.

## 6. Turn structure

A turn has two steps:

1. **Develop** — the active player must resolve exactly one of the choices
   their faction's develop rule offers (Tournament Faction: draw 1 card, or
   play 1 resource). This is a required, one-time decision at the start of
   the turn, not an optional action repeated later.
2. **Main** — the active player may, in any order and any number of times:
   play a card, use an ability, declare an attack, and finally end the
   turn. Ending the turn is the one action that can happen at most once.
   "Play a card" here excludes resource cards: playing a resource only
   happens through the develop step's choice (or a card effect that
   explicitly plays a card as a resource, e.g. the `playResource` effect) —
   never as a normal main-step card play. **(engine-derived)** — this is
   enforced by the same timing check (`assertCanDeployAtCurrentTiming`) used
   by both `playCard` and the `getCardPlayability`/`getPlayableHandCards`
   query surface, so a card of type `resource` never reports as playable and
   is rejected if attempted, regardless of turn phase.

At the start of a player's turn, before develop:
- Every character that both (a) is not face-down and (b) has been
  continuously under that player's control in `play` becomes attack-eligible
  for the turn. A character that enters play mid-turn is **not**
  attack-eligible that turn unless it has **Aggro**.
- The faction's restore rule then applies (Tournament Faction: clear all
  character damage, detach resources from the faction, restore/untap all
  non-resource permanents).

## 7. Priority and the response window ("stack")

Whenever a player:
- finishes paying the cost for a card (before it resolves/enters play),
- finishes paying the cost for an ability (before its effects execute), or
- declares they are ending their turn,

...the opponent gets a chance to respond. A response window stays open as
long as either player keeps adding responses; it closes only once both
players have had a chance to respond and neither adds one (two consecutive
passes). Once closed, everything added during the window resolves — most
recently added first (LIFO) — and then the original action/effect that
opened the window proceeds.

Only two kinds of things can be played *into* a response window: **Tactics**,
and any other card type that has the **Tactical** keyword. Activated
abilities can also be used in a response window, following the same
priority rules.

**Terminate (card-verified).** Some effects remove a still-unresolved card
or ability from the stack ("terminate", equivalent to "counter") — it never
resolves, and a terminated card goes to its owner's discard. A card can be
terminated in the same instant it is played, by a `cardPlayed`-triggered
ability (e.g. *The Great Wall of Keeping Stuff Out*). **(engine-derived)**
the `cardPlayed` event and the stack push happen as one batched step so
such a trigger sees the card already on the stack.

**Triggered abilities are not responses.** They fire automatically the
instant their condition becomes true, cannot be responded to as a discrete
action, and use the game state at the moment they fired even if something
about the source changes afterward. Multiple triggers firing at once from
one player's cards are ordered by that player; across both players (or
game-rule triggers), the active player chooses the order.

**(engine-derived)** Every trigger found for one emitted event shares a
batch. Before resolving the first trigger in a batch of 2+, the engine
pauses on `GameState.pendingChoice` (kind `"orderTriggers"`, listing each
as `{sourceId, abilityId}`) rather than resolving in whatever order
`Object.values(GameState.cards)` happened to iterate. `playerId` is that
batch's sole controller if they're all the same player's cards, otherwise
the active player, matching the rule above. Answered via
`perform({ type: "resolvePendingChoice", choice: { kind: "orderTriggers", order: [...] } })`
with a full permutation of the batch.

**(engine-derived)** A batch is *everything found for one emitted event* —
not everything that happened in one simultaneous game action. Two
characters destroyed together by the same round of battle damage (§8 step
5) each get their own separate "this card left play" event (one per card),
so a "when this leaves play" trigger on each does **not** join an
`orderTriggers` batch with the other — there's nothing to jointly order.
Instead each event's trigger (including any chooser sub-decision it itself
raises, e.g. `chooserSelectsTarget`) resolves fully, in turn, queued behind
the others emitted in the same instant, before the next one begins; none of
them are skipped or overwritten by one that pauses first.

**(engine-derived)** When a triggered ability's target declaration has more
legal candidates than it needs, the engine can't guess which one the
controller means — it pauses on `GameState.pendingChoice` (kind
`"selectTargets"`, same mechanism as Unique below) instead of picking one
for them or throwing. Answered via
`perform({ type: "resolvePendingChoice", choice: { kind: "selectTargets", selected: {...} } })`.
A declaration with *too few* candidates (a genuinely unplayable trigger,
not a choice) is unaffected — that's still a hard failure.

**A note on pending choices generally.** Response windows and battle phases
already interrupt synchronous resolution and wait for a specific follow-up
action (`passPriority`/`advanceFlow`, `declareBlockers`, ...) — that's the
engine's normal idiom for "pause here until told to continue," and it's
what makes the engine steppable by a UI instead of needing to run a whole
turn in one call. `GameState.pendingChoice` extends the same idiom to
moments that aren't tied to one specific player action: a state-based check
or a batch of triggers can, on its own, decide a *real* decision is needed
and pause there. While it's set, `perform()` rejects everything except a
matching `resolvePendingChoice`, the same way an open response window
rejects everything but a response. The kinds today are `uniqueSurvivor`
(§9), `selectTargets` / `orderTriggers` (this section), the chooser-effect
pauses (`chooserSelectsTarget`, `chooserSelectsOption`, `reorderDeck`,
`deployForFree`, `distributeAmong`), and — added for the card-coverage
effort — `replacementChoice` (an optional "you may ... instead", §10),
`mayPay` ("you may pay N. If you do, ..."), `nameValue` ("name a card
subtype"), and `useTargetAbility` ("use one of the card's abilities").
`GameFlowView.mode` becomes `"pendingChoice"` so a
renderer can detect one without inspecting `GameState.pendingChoice.kind`
itself.

## 8. Battle Rules

**Declaring the attack**
1. Active player picks characters to attack with — each must be
   attack-eligible (see §6) and not depleted. Declaring depletes them.
2. Active player names a target: an opponent's faction, or an opponent's
   location in play. (If unspecified, default to the opponent's faction.)
3. If every attacking character has **Covert**, the attacking party is
   Covert — it can be blocked only by Covert characters.

A response window opens after attackers are declared (both players may play
tactics/abilities).

**Declaring blockers**
1. Defending player may pick any number of non-depleted characters they
   control to block. Declaring does **not** deplete blockers.
2. A Covert character may only block a Covert attacking party; conversely
   only Covert characters may block a Covert party. Whether a party "is"
   Covert is locked in at the moment blocking is declared — later keyword
   changes don't retroactively legalize/void the block.
3. Face-down cards (resources) cannot block.

A response window opens after blockers are declared.

**Resolving damage — speed groups**

Battle damage resolves in repeating rounds, highest speed first, attacker
before defender within a round:

1. Response window (attacker, then defender).
2. Let X = the highest speed among attacking characters that haven't yet
   assigned damage this battle. All attackers at speed X simultaneously
   assign damage equal to their strength, split however the attacker
   chooses among the blocking party (if any) or the target (faction/
   location) if unblocked.
3. Let X = the highest speed among blocking characters that haven't yet
   assigned damage this battle. All blockers at speed X simultaneously
   assign damage equal to their strength, split however the defender
   chooses among the attacking party.
4. Response window (attacker, then defender).
5. All damage assigned in this round is inflicted simultaneously; multiple
   instances hitting the same target sum into one application.
6. Repeat from step 1 until every character in the battle has either
   assigned damage once or been removed from the battle.
7. Surviving characters that took part in the battle become depleted.

**Damage resolution:**
- Character: destroyed once its accumulated damage this turn ≥ its life
  (checked continuously as a state-based action, not just at end of
  battle).
- Location: destroyed once its accumulated damage (persists across turns)
  ≥ its structure.
- Faction: damage directly reduces influence by the same amount — this is
  the *only* normal way influence changes from combat, and it is not
  "damage" for the purposes of damage-prevention/redirection effects.
- A character removed from the battle (destroyed, or its control changes)
  is immediately pulled from the attacking/blocking party.
- **(engine-derived)** A continuous ability can *tune* an amount of damage
  as it is inflicted ("reduce battle damage to your characters by 2",
  "increase ... by 2") via `ContinuousAbility.damageModifiers`. This is an
  amount adjustment, floored at 0 — it can't cancel an instance the way a
  replacement effect would. **Ruling:** each source's contribution is a
  distinct instance of damage (the standard CCG reading), so the modifier
  is applied *per damage assignment*, not once per summed speed-group
  application: a two-attacker speed group each assigning 2 to one character
  warded by "reduce battle damage by 2" deals 0, not 2. This matches the
  engine's per-assignment `damageDealt` model and is locked by a
  `card-behaviors.test.ts` case.

  **(engine-derived)** "Control changes" is the `takeControl` effect
  (`{ type: "takeControl", target, controller }`) — the only way
  `CardInstance.controllerId` ever changes. It also moves the card between
  the old and new controller's `play` array bookkeeping (see §2), since
  in-play zone membership is filed by controller, not owner.
  `isCardStillInBattle` already checks `controllerId` against the
  attacker/defender for party membership, so this falls out for free the
  next time the party gets pruned (battle damage assignment, or the next
  `declareBlockers` call).

## 9. Keywords

- **Covert** — see battle rules (§8) for the blocking restriction. A card
  can gain Covert temporarily via an effect, same rules apply while it has
  the keyword.
- **Tactical (card-verified)** — the card can be played during a response
  window (as if it were a Tactic) regardless of its actual card type. It's
  still subject to the type's normal rules once in play (a Tactical
  character still needs a legal target/etc., and still resolves into
  `play` rather than `discard` the way a Tactic does).
- **Aggro (card-verified)** — the character is exempt from the "must have
  started this turn under your control" attack-eligibility rule (§6). A
  character with Aggro that enters play this turn may still attack this
  turn.
- **Unique X** — a player may not control more than one card carrying a
  given Unique designation; if they somehow do, they immediately choose one
  to keep and destroy the rest. The opponent controlling a copy of the same
  Unique card at the same time is fine — the restriction is per-player.

  **(engine-derived)** The designation is `CardDefinition.unique?: string`
  (e.g. `"eldridge"`); real card text has no structured field for this today
  so it must be assigned when authoring/importing card data. "Choose one to
  keep" *is* a real player decision: the state-based check pauses on
  `GameState.pendingChoice` (kind `"uniqueSurvivor"`, listing every
  candidate) rather than picking one, and everything else stays blocked
  until the affected player answers with
  `perform({ type: "resolvePendingChoice", choice: { kind: "uniqueSurvivor", keep: cardId } })`.
- **Attach to X** — the card must have a legal target of type X chosen as
  part of playing it, and enters play attached to that target. If the
  target is missing, or later leaves play / stops qualifying as type X, the
  attached card is destroyed (items/tactics attached this way go to
  discard). If the target itself leaves play for any reason, everything
  attached to it leaves the same way.

  **(engine-derived)** Declared via `CardDefinition.attachTo?: CardType`.
  Playing such a card adds a synthetic target declaration (reserved id
  `"attachTo"`) requiring a card of that type, same as any other target —
  `selected: { attachTo: [cardId] }`. `CardInstance.attachedTo` is reused
  from the numeric-cost resource-attachment mechanic (a resource attached to
  its controller's faction to pay a cost uses the same field) — the two
  never conflict since a resource being attached-for-cost is never itself an
  Attach-to-X card. The generic "detach on target destruction" behavior
  (§2/zones) still fires first; the Attach-to-X state-based check is what
  turns that detachment into an actual destruction when `attachTo` is set.

## 10. Abilities

- **Activated** — has a cost and effects; only its controller may use it;
  requires priority (see §7) the same as any other stack action. All listed
  costs must be payable simultaneously or the ability cannot be activated
  at all (no partial payment). **(engine-derived)** an ability may also
  carry its own icon `threshold` (`ActivatedAbility.threshold`, same
  shorthand as a card's) — the "RECUR: [G][G]" / "EXHUMATION: [O][O]"
  clause — checked as a gate before condition/targets/costs.
- **EXTRA COST (card-verified)** — a printed "EXTRA COST: ..." on a card
  being *played* is a real, hard cost on the deploy, not a "you may": if it
  can't be paid the card can't be played (mirroring §4/§12). It may be
  derived/conditional — *Anatidaephobia*'s "if you did not deploy this
  using FLIP UP, pay X where X is the character's numeric cost" is one
  `payResources` cost whose amount reads the responded-to card's cost and
  collapses to 0 when `deployedViaFlipUp`. **(engine-derived)** carried by
  the tactic-first-ability / `behavior.onPlay` cost convention, evaluated
  with the same context (`respondedToCard`, `deployedViaFlipUp`) the play
  itself resolves under.
- **Triggered** — keyed to "if/when/at" wording; fires automatically per §7,
  cannot be responded to directly.
- **Continuous** — always-on while the source is in play; a "while X"
  conditional continuous ability turns on/off immediately as the condition
  becomes true/false, with no lingering state.
- **Replacement (card-verified)** — "if <X> would happen, instead <Y>"
  (*The Stone of Shame*: "If a character would be put into a player's hand,
  destroy it instead"; *Giada, the Elegant*: "If this card would be
  destroyed by an opposing card or effect, you may put a token on it
  instead"). Checked *before* the event it replaces actually happens; when
  it applies, the original event does not occur and the replacement effects
  run in its place. **(engine-derived)** `ReplacementAbility` — consulted
  from inside `moveCard` (a card leaving `play` for a matched `zone`) and
  `destroyCard`, recursion-guarded. Both forms are wired: the **mandatory**
  form runs its `effects` inline, and the **optional** "you may pay/choose
  ... instead" gate (`optional` / `optionalCost`) pauses the engine on a
  `replacementChoice` pending choice for the source's controller. Scoping:
  `replaces.controlledBy` filters on *whose card* is affected;
  `replaces.by` (`"self" | "opponent" | "any"`) filters on *who initiated*
  the event ("by an opposing card or effect") — the controller of the
  effect currently resolving, or, for lethal battle damage, the player who
  dealt it. An unknown initiator (a bare state-based check with no
  preceding effect) satisfies neither `"self"` nor `"opponent"`.
- **FLIP UP (card-verified)** — a card printed with a "FLIP UP: <cost>"
  clause can be played face-down as a resource and later flipped up by
  paying that cost (numeric + threshold, plus any "...and <rider>"), at
  which point it resolves as its real card type. Its own text can branch on
  "if you deployed this card using FLIP UP." **(engine-derived)** the
  `flipUp` action + `deployedViaFlipUp` on the resolution context. Flipping
  up opens no response window, but its effects (the "...and <rider>" first,
  then the card's own) run through the same suspendable effect-frame path
  as everything else: one that pauses on a chooser suspends on a
  `pendingChoice`, and the wrap-up (a flipped tactic to discard, a flipped
  permanent into play) waits until it resumes and finishes.
- **Depleting** ("tapping") — a card used to pay a deplete cost, or that
  attacks, becomes depleted and can't be depleted again until restored.
  Resources are never depleted (they're attached instead).
- **Restoring** ("untapping") — reverses depletion; normally happens via
  the controlling faction's turn-start restore rule, or an explicit effect.

**(engine-derived)** Damage and depletion are play-zone concepts — a card
has neither while sitting in hand, deck, discard, void, or removed. Any
card leaving `play`, for any reason (bounced to hand, discarded, put in the
void, removed from the game), clears both `damage` and `depleted`
immediately, the same way it already sheds `faceDown`/`attachedTo` (RULES.md
§2). This matters even for a location, whose damage otherwise persists
turn to turn while it stays in play (§3): that persistence stops the
instant it leaves play, so a bounced or returned location doesn't carry
old damage back into a fresh stint in play (destroying it on re-entry, or
returning to a hand as a "damaged"/"depleted" card in the first place).

## 11. State-based actions

Checked continuously (after every effect/stack resolution, not just once
per turn):

- Any character with accumulated damage this turn ≥ life is destroyed.
- Any location with accumulated damage ≥ structure (its `life` stat) is
  destroyed.
- Any player controlling more than one card sharing a Unique designation
  reduces to one — via that player's choice (see §9), not automatically.
- A card requiring "Attach to X" whose attachment target isn't a legal,
  in-play card of the right type is destroyed.
- Any faction at 0 influence ends the game for that player, immediately (a
  draw if both hit 0 from the same event). Checked last, after every
  destruction above has settled.

**(engine-derived)** The whole check is skipped while a `pendingChoice` is
outstanding — the engine is frozen awaiting input, and in particular an
*optional replacement* awaiting accept/decline leaves its would-be-destroyed
card sitting with lethal damage; re-running the check would just re-offer
the replacement forever. Every `resolvePendingChoice` branch re-runs the
check once it has settled.

## 12. Miscellaneous rulings

- `"cannot"` always overrides `"can"`. (No engine mechanism needed — this is
  guidance for whoever authors a card's structured `Condition`/`Effect`
  data, not a runtime primitive.)
- An instruction that's impossible to fully carry out (destroy a card no
  longer in play, discard from an empty hand, etc.) is carried out as far
  as possible and the rest is ignored — it does not invalidate the whole
  effect.

  **(engine-derived)** Every *effect* (post-cost, already-committed
  resolution) that resolves a `TargetRef`/destination silently no-ops
  instead of throwing when that reference doesn't resolve to a card — most
  commonly a `{type:"random", selector}` ref whose selector matches nothing
  (e.g. "discard a card at random from your opponent's hand" when their
  hand is empty), but also e.g. `destroy`/`removeFromGame` targeting
  something a second effect in the same ability, or a batched trigger,
  already took care of. This is deliberately *not* extended to cost
  payment: a `destroy` **cost** still throws if its target isn't a legal
  in-play card, since an unpayable cost should block the whole activation
  (§4/§10), and `validateTargetDeclarations` guarantees the target was
  legal at the moment of activation anyway — reaching an unresolved cost
  target can only happen if something external mutated the state between
  target validation and cost payment, which is a real bug to surface, not
  something to paper over.
- A cost variable (`X`, etc.) that's never assigned because the card was
  played for free defaults to 0. (Not yet applicable: `NumberExpression`
  has no "unassigned variable" form today — every current card behavior
  supplies a literal or a derived value.)
