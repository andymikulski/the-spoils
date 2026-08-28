# BEHAVIORS.md

Quick reference for authoring `behavior` data on cards in `data/cards.json`.
The full type definitions live in `src/types/{cards,costs,conditions,
effects,expressions,ids}.ts` — this file is a condensed index over them plus
authoring patterns, so a session doesn't have to re-derive the vocabulary
from scratch every time. Keep it in sync as the vocabulary grows.

## Shape

```jsonc
"behavior": {
  "keywords": ["covert"],       // optional, see Keywords below
  "abilities": [ AbilityDefinition, ... ],  // optional
  "onPlay": { "condition"?, "costs"?, "targets"?, "effects"? }  // NON-tactic EXTRA COST / inline ETB
}
```

Sibling `CardDefinition` fields the coverage effort added:
- **`flipUp: { cost, threshold, effects? }`** — the card can be played
  face-down as a resource, then the `flipUp` action pays this and resolves
  it as its real type with `deployedViaFlipUp` set.
- **`unique: "<designation>"`** — a Unique designation (RULES.md §9).

`AbilityDefinition` is one of `ActivatedAbility | TriggeredAbility |
ContinuousAbility | ReplacementAbility` (discriminated on `type`).

- **Character/item/location abilities** — listed under `behavior.abilities`
  as normal.
- **Non-tactic "EXTRA COST" / ETB** — `behavior.onPlay` (any non-tactic
  type): `targets`/`costs`/`condition` apply at play time, `effects` resolve
  as the card enters play (with those `selected` picks available).
- **`ActivatedAbility.activationZone`** — `"discard" | "hand" | "void"`
  (default `"play"`) for RECUR / RETIRE abilities used from that zone.
- **`ActivatedAbility.threshold`** — icon requirement to activate (same
  shorthand as `CardDefinition.threshold`, e.g. `"gg"`), a gate not a cost.
  For "RECUR: [G][G]" / "EXHUMATION: [O][O]"-style ability clauses.
- **`ContinuousAbility.uniqueGrant`** — `{ selector, designation:
  "cardName" | "<fixed>" }` grants a Unique designation to matching in-play
  cards ("all non-resource cards gain Unique X where X is their name").
- **`ReplacementAbility`** — `{ replaces: { event: "moveToZone" | "destroy",
  zone?, cardType?, controlledBy?, by? }, condition?, optional?,
  optionalCost?, effects }`. Runs *instead of* the matched mutation.
  `optional: true` pauses the source's controller (`replacementChoice`
  pending choice). `controlledBy` = whose card is affected (rel. to the
  source controller); `by` (`"self" | "opponent" | "any"`, default
  `"any"`) = who initiated it — "destroyed by an opposing card or effect."
- **Tactic effects** — by convention (`SpoilsEngine.getTacticEffects` /
  `getPlayTargetDeclarations` / `getTacticCosts` / `getTacticCondition`), a
  tactic's *first* `activated`-shaped ability in `behavior.abilities`
  supplies everything that applies when the tactic is played:
  - `targets` — "EXTRA COST: Pick X" resolves as part of playing the card.
  - `costs` — paid atomically together with the card's own printed
    `cost` (as one combined `Cost[]` list) — use this for an "EXTRA COST:
    Pay N" beyond the printed cost, e.g. one tied to a chosen `variable`.
  - `condition` — a play-timing restriction beyond the normal
    response-window rules, e.g. "deploy this only while you are attacking"
    (`{ "type": "battleRole", "role": "attacker" }`).
- **Faction abilities** — same `behavior.abilities` shape, activated only,
  e.g. `TOURNAMENT_FACTION_BEHAVIOR` in `src/engine/utilities.ts`.

## Ability types

```ts
ActivatedAbility:  { id, name?, type: "activated", activationZone?, threshold?, condition?, costs?, targets?, effects, variables? }
TriggeredAbility:  { id, name?, type: "triggered", event, condition?, targets?, effects }
ContinuousAbility: { id, name?, type: "continuous", condition?, modifiers, keywords?, restrictions?, costModifiers?, damageModifiers? }
ReplacementAbility:{ id, name?, type: "replacement", replaces, condition?, optional?, optionalCost?, effects }
```

**`ReplacementAbility`** — "if <X> would happen, instead <Y>". `replaces` is
`{ event: "moveToZone", zone, cardType?, controlledBy?, by? }` or
`{ event: "destroy", cardType?, controlledBy?, by? }`. `controlledBy`
(relative to the source's controller) filters on whose card is affected;
`by` (`"self" | "opponent" | "any"`, default `"any"`) filters on who
*initiated* it — "destroyed by an opposing card or effect." When it fires,
the original mutation is skipped and `effects` run with the affected card
bound to `{ "type": "selected", "id": "__candidate" }`. `optional: true`
(with optional `optionalCost`) makes it a "you may pay ... instead" gate:
the engine pauses on a `replacementChoice` for the source's controller;
declining (or an unaffordable `optionalCost`) lets the original event
happen.

**FLIP UP** — put `flipUp: { cost, threshold, effects? }` on the
`CardDefinition`. The card can be played face-down as a resource, then the
`flipUp` action pays that cost and resolves it as its real type with
`deployedViaFlipUp` set (readable via the same-named condition, or ability
`variables` + `if`). The rider `effects` then the card's own effects run
through the suspendable effect-frame path — a chooser among them pauses on
a `pendingChoice` and the flipped card only lands (tactic → discard,
permanent → play) once it resumes.

### Ability-level `variables` — settled before targeting/costs

`ActivatedAbility.variables?: Record<string, NumberExpression>` is
evaluated once, up front — before `condition`/`targets`/`costs` — and
merged into the resolution context, for a value that has to be settled
*before* targeting can even be validated: "flip a coin; X is 1 or 2. Pick X
or fewer items" is

```json
{ "id": "...", "type": "activated",
  "variables": { "x": { "type": "random", "min": 1, "max": 2 } },
  "targets": [{ "id": "picked", "selector": { "zone": "play", "type": "item" },
    "count": { "type": "variable", "id": "x" }, "optional": true }],
  "effects": [{ "type": "forEach", "selected": "picked",
    "effects": [{ "type": "destroy", "target": { "type": "selected", "id": "__candidate" } }] }] }
```

An explicit `variables[id]` on the `playCard`/`activateAbility` action
itself still takes precedence over the same id here — this is only a
default for values the *ability* determines, not ones the player chooses.

### Triggered abilities — the self-scoping gotcha

`SpoilsEngine.findTriggers` scans **every card in play** and fires **any**
triggered ability whose `event` matches the emitted event's type — it does
**not** implicitly scope to "this card." A `cardEnteredPlay` trigger with no
condition fires when *any* card enters play, not just its own source.

For "when this card enters play / attacks / blocks / is destroyed / etc."
effects, add:

```json
"condition": { "type": "sourceIsEventCard" }
```

This compares `getEventCardId(event) === context.sourceId`. `getEventCardId`
maps event → the relevant card per event type — for `damageDealt` it
resolves to `event.targetId` (the thing damaged), not the source that dealt
it — use `sourceIsDamageSource` for "when this card deals damage" instead
(see Conditions below).

For "when this card enters or leaves play," author two separate `triggered`
abilities:

```json
"condition": {
  "type": "and",
  "conditions": [
    { "type": "sourceIsEventCard" },
    { "type": "cardMovedFromZone", "zone": "play" }
  ]
}
```
alongside the `cardEnteredPlay` one.

### GameEventType (`src/types/events.ts`)

`turnStarted`, `turnEnding`, `cardPlayed`, `cardEnteredPlay`, `cardMoved`,
`cardDestroyed`, `cardDepleted`, `cardRestored`, `resourcePlayed`,
`damageDealt`, `abilityActivated`, `battleStarted`, `battleEnded`,
`characterAttacked`, `characterBlocked`.

`characterAttacked` fires once per attacker at `declareAttack` (before
`battleStarted`); `characterBlocked` fires once per blocker at
`declareBlockers`. Both map to `event.cardId` for `sourceIsEventCard`.

Battle damage to a **faction** also emits `damageDealt`, the same as
card-target battle damage. The event's `targetId` resolves to that player's
*faction card instance* (`player.factionId`), so `cardTypeIs`/`eventCard`
work on it like any other damage target.

## Costs (`src/types/costs.ts`)

| type | fields | notes |
|---|---|---|
| `payResources` | `amount: NumberExpression` | pays from unattached faction resources |
| `deplete` | `target: TargetRef` | typically `"source"` ("tap this card") |
| `discard` | `id, player, selector, count` | a *cost*, not an effect — the id is referenced via `selected[id]` same as a target |
| `destroy` | `target: TargetRef` | typically `"source"` (sacrifice) |
| `removeCounter` | `target, counter, amount` | "remove N tokens from this card" as a cost — throws if not enough are there (no partial payment), unlike the `removeCounter` *effect* which clamps to 0 |
| `depleteSelected` | `declarationId` | depletes every card already selected under a (possibly variable/plural-count) `TargetDeclaration` — "deplete X characters you control" as a cost. All-or-nothing: throws if any of them is already depleted, rather than partially paying. A no-op if the declaration was optional and 0 were selected. |
| `removeFromGame` | `target: TargetRef` | "remove `target` from the game" as a cost — typically `"source"` (a RECUR ability exiling itself from the discard pile). Throws if it doesn't resolve to a real card. |
| `sacrificeSelected` | `declarationId`, `disposition` | consumes every card selected under `declarationId` via `"removeFromGame" \| "destroy" \| "discard"` — "remove X tactics in your discard pile from the game" as a cost. |
| `dealDamage` | `target`, `amount` | "inflict N damage to `target`" as a cost — typically `"source"` for a location spending its own structure. Always payable; any resulting destruction is left to the normal state-based check. |

**Activating from another zone** — an `ActivatedAbility` may set
`activationZone: "discard" | "hand" | "void"` (default `"play"`) to be used
while the source sits there (RECUR / RETIRE / EXHUME). `condition` still
carries any finer gate; costs/targets/effects work as normal with
`context.sourceId` pointing at the out-of-play card.

All costs in an ability must be payable simultaneously (`canPayCosts`
simulates on a cloned state) — no partial payment.

## Conditions (`src/types/conditions.ts`)

`and`, `or`, `not`, `sourceInZone`, `sourceIsEventCard`,
`eventCardControlledBy`, `targetExists`, `cardTypeIs`, `cardTradeIs`,
`hasUnique`, `hasAbility`, `statCompare`, `counterCompare`, `numberCompare`,
`inBattle`, `sourceIsDamageSource`, `cardMovedFromZone`, `battleRole`,
`eventPlayerIs`, `targetInSelection`.

- **`cardTradeIs`** — `{ target, trade }`, true when `target`'s printed
  `trade` equals `trade`. `CardSelector` has no trade filter — compose with
  `not` inside a selector's `conditions` for "a non-Rogue character".
- **`hasUnique`** — `{ target }`, true when `target`'s definition carries a
  Unique designation (`CardDefinition.unique` set) — "a character with the
  UNIQUE keyword in its rules text".
- **`hasAbility`** — `{ target, abilityType? }`, true when `target`'s
  `behavior.abilities` has an entry of `abilityType` (any if omitted) —
  "a card you control with an ability in its rules text" (Notion Sickness,
  `abilityType: "activated"`).

- **`numberCompare`** — generic `left <op> right` between two
  `NumberExpression`s, for anything not anchored to one card (most commonly
  a `count` selector): `{ "type": "numberCompare", "left": { "type":
  "count", "selector": {...} }, "operator": ">=", "right": 1 }`.
- **`inBattle`** — `{ target, role? }`, true while `target` is in the
  current battle's `attackingParty`/`blockingParty`. Omit `role` to match
  either side; combine with `not` for "not currently in a battle."
- **`sourceIsDamageSource`** — true when the event is `damageDealt` and
  *this card* was `event.sourceId` (the dealer, not the target — the
  opposite of what `sourceIsEventCard` checks for that event type). Combine
  with `cardTypeIs`/`target: "eventCard"` to check *what* was damaged (see
  TargetRef below) — `sourceIsDamageSource` alone doesn't care who/what was
  hit.
- **`cardMovedFromZone`** — `{ zone }`, true when the event is `cardMoved`
  and `event.from === zone`. Combine with `sourceIsEventCard` via `and` for
  "this card specifically left `zone`."
- **`battleRole`** — `{ role: "attacker" | "defender" }`, true while the
  controller is that role in the current battle. This is about the
  *player's* role, unlike `inBattle` (a specific card's presence in a
  party) — use it for a tactic's own `condition`, e.g. "deploy this only
  while you are attacking." A dynamic "X = attacking party size" doesn't
  need its own expression type: compose `count` with `inBattle` —
  `{ "type": "count", "selector": { "zone": "play", "type": "character",
  "conditions": [{ "type": "inBattle", "target": { "type": "selected", "id": "__candidate" }, "role": "attacker" }] } }`.
- **`eventPlayerIs`** — `{ player }`, true when the triggering event carries
  a `playerId` field (e.g. `turnStarted`, `turnEnding`, `cardPlayed`) equal
  to `player` — "at the start of *your* turn" is `condition: { "type":
  "eventPlayerIs", "player": "controller" }` on a `turnStarted` trigger.
  False for any event with no `playerId` field at all.
- **`targetInSelection`** — `{ target, selection }`, true when `target`
  resolves to a card id that's a member of `ResolutionContext.
  selected[selection]` — constrains a later selector/declaration to only
  cards an earlier `TargetDeclaration` already picked (e.g. "an opponent
  chooses X of those [previously revealed] cards"). Bind `target` to `{
  "type": "selected", "id": "__candidate" }` inside a `CardSelector.
  conditions` or a `forEach`/`chooserSelectsTarget` declaration's
  `conditions`.
- **`eventOrdinal`** — `{ operator, value }`, compares how many times the
  current triggering event has already fired **this turn**
  (`GameState.turnEventTally`, keyed by event type + its `playerId` when it
  has one) against `value`. "The first resource each opponent plays each
  turn" = a `resourcePlayed` trigger with `and(eventPlayerIs opponent,
  { eventOrdinal, operator: "=", value: 1 })`. The tally resets every turn.
- **`deploySameNameThisTurn`** — `{ player, operator, value }`, compares the
  largest count of same-named cards `player` deployed this turn against
  `value` ("an opponent deployed at least 2 cards with the same name").
- **`respondingTo`** — `{ cardType? }`, true while being played into a
  response window whose stack holds a card of `cardType` (other than this
  one). Pairs with the `respondedToCard` TargetRef — which resolves during
  play-time cost evaluation too, so a play `cost` can reference it (e.g.
  Anatidaephobia's "pay X, where X is the character's numeric cost" is a
  `payResources` cost with `amount` a `cardCost` of `respondedToCard`,
  wrapped in `conditional`/`deployedViaFlipUp` to waive it on FLIP UP).
- **`deployedViaFlipUp`** — true while resolving a card played via its FLIP
  UP cost. Combine with `conditional` (a NumberExpression) for "X is 4 if
  FLIP UP else 2", or gate/scale a play-time `cost`.
- **`cardNameEquals`** — `{ target, other }`, true when both resolve to
  cards sharing a printed name ("a card with the same name" — `target`
  bound to `__candidate`, `other` to `"eventCard"`).
- **`bottomedInMulligan`** — `{ target? }` (default `"source"`), true when
  the card was one its *owner* set aside to the bottom of their deck in the
  opening mulligan (`GameState.mulligan`). "If you chose to put this card
  on the bottom of your deck as part of your mulligan" (Community Chest).

## Effects (`src/types/effects.ts`)

`draw`, `playResource`, `dealDamage`, `modifyInfluence`, `moveCard`,
`destroy`, `deplete`, `restore`, `addCounter`, `removeCounter`,
`createModifier`, `takeControl`, `removeFromGame`, `forEach`, `attachTo`,
`grantKeyword`, `grantRestriction`, `if`, `shuffleDeck`, `mill`, `bind`,
`terminate`, `setRestoreLock`, `setDamage`, `removeFromBattle`,
`forEachPlayer`, `nameValue`, `mayPay`, `createTokens`, `useTargetAbility`,
`chooserSelectsTarget`, `chooserSelectsOption`, `lookAndReorder`,
`reduceNextCost`, `deployForFree`, `distributeAmong`.

- **`setDamage`** — `{ target, amount }` — sets accumulated damage to
  `amount` (>= 0), e.g. "reduce the damage already inflicted to this
  character to 0".
- **`removeFromBattle`** — `{ target }` — pulls `target` out of the current
  battle's parties.
- **`forEachPlayer`** — `{ effects }` — runs `effects` once per player
  (turn order, active first) with `controller`/`owner` rebound; nested
  choosers pause per player.
- **`nameValue`** — `{ chooser, valueKind: "subtype" | "cardName", storeAs }`
  — pauses for `chooser` to name a string, stored on the source card's
  `namedValues[storeAs]` and read by `CardSelector.subtypeVar`.
- **`mayPay`** — `{ player, costs, effects, elseEffects? }` — "you may pay
  <costs>. If you do, <effects>; otherwise <elseEffects>." Auto-declines if
  `costs` are unaffordable. Use `costs: []` for a bare "you may" yes/no.
- **`createTokens`** — `{ controller, count, token: TokenSpec }` — puts
  `count` token permanents into play (`{ name, cardType, subtype?,
  strength?, life?, speed?, structure? }`); they vanish outright on leaving
  play.
- **`useTargetAbility`** — `{ chooser, target, times? }` — `chooser`
  activates one of `target`'s own activated abilities as a sub-resolution,
  its effects resolved `times` (default 1) times.

- **`mill`** — `{ player, count }` — moves the top `count` cards of
  `player`'s deck to their discard (fewer than `count` → whatever's there,
  no reshuffle).
- **`terminate`** — `{ scope?, target? }` — removes a still-unresolved item
  from the response stack. `scope: "target"` (default) terminates the stack
  item whose source is `target` (`"eventCard"` on a `cardPlayed` trigger =
  "terminate the card just played"); `scope: "othersOnStack"` terminates
  every other unresolved item. A terminated card → owner's discard, effects
  never run. `deployCard` batches the `cardPlayed` emit with the stack push
  so a `cardPlayed` trigger can already see the card on the stack.
- **`setRestoreLock`** — `{ target, value? }` — sets (or clears with
  `value: false`) `CardInstance.restoreLocked`, so the card's controller's
  faction turn-start restore skips it ("characters depleted by this card
  cannot be restored by their faction's restore rule"). Pair with a
  `deplete` effect on the same target; cleared automatically on leaving play.
- **`bind`** — `{ id, value }` — evaluates `value` **now** and stores it in
  `ResolutionContext.variables[id]` for later effects in the same ability to
  read via `{ type: "variable", id }`. Use it to capture a stat off a card
  (`{ type: "stat", target: { type: "selected", id: "victim" }, ... }`)
  *before* a subsequent `destroy`/`moveCard` in the same list removes it.

**Every effect except `forEach`/`if` resolves against exactly one target.**
`resolveTargetRef` returns only `selected[id]?.[0]` — the *first* selected
card, even if the target declaration's `count` is greater than 1.

For "your characters gain 1 strength" / "inflict 2 damage to all
characters" style effects, use `forEach`:

```json
{
  "type": "forEach",
  "selector": { "controller": "self", "zone": "play", "type": "character" },
  "effects": [
    { "type": "createModifier",
      "target": { "type": "selected", "id": "__candidate" },
      "stat": "strength", "operation": "add", "value": 1,
      "duration": { "type": "untilEndOfTurn" } }
  ]
}
```

`forEach` queries `selector` **once**, up front — that snapshot is fixed
for the whole loop, so an earlier iteration destroying/moving a card can't
shrink who else is hit. Every nested effect targets the current card via
`{ "type": "selected", "id": "__candidate" }` (same binding
`CardSelector.conditions` uses). The iterations are wrapped in a single
event batch, so triggered abilities reacting to per-card events raised
inside the loop are queued together and orderable, not resolved one-by-one
interleaved with later iterations — matching how simultaneous battle damage
already works.

`if` resolves `effects` only when `condition` holds — the "if you do" half
of an optional target (see TargetDeclaration below):

```json
{ "type": "if",
  "condition": { "type": "targetExists", "target": { "type": "selected", "id": "target" } },
  "effects": [ /* only runs if "target" was actually chosen */ ] }
```

`attachTo` re-attaches an already-in-play "Attach to X" card to a new
target (an item's "HANDOFF"-style ability) — `{ target, to }` sets
`target`'s `attachedTo` to `to`. Initial attachment (when a card is first
played) still goes through `attachTo` on the *definition* + the play-time
target declaration, not this effect.

`grantKeyword` / `grantRestriction` — `{ target, keyword|restriction,
duration }` — see Keywords/Restrictions below.

`moveCard` to `hand`/`discard`/`deck`/`void`/`removed` files the card under
its **owner's** zone array (not controller) — "put it into its owner's
hand" works with a plain `moveCard` effect, no extra logic needed.

`shuffleDeck` — `{ player }` — shuffles that player's deck in place
(RULES.md §2's "reshuffled after a search"). "Search your deck for a
tactic... put it into your hand" is a `targets` declaration with a
`zone: "deck"` selector (searching doesn't need its own effect — target
declarations can already reach into the deck) plus a `shuffleDeck` effect
alongside the `moveCard`.

### "Chooser" effects — pause resolution for a player's input

`chooserSelectsTarget`, `chooserSelectsOption`, `lookAndReorder`,
`reduceNextCost`, `deployForFree`, and `distributeAmong` all pause the
current ability's effect list the moment they're reached, set
`state.pendingChoice`, and resume the remaining effects only once that
choice is answered (`resolvePendingChoice`) — this is transparent to
ability authoring; just write the effect and its nested `effects: Effect[]`
like any other, and don't assume the ability finishes resolving
synchronously within one `perform()` call when one of these appears. (The
underlying mechanism is a `PendingEffectFrame` stack — see
`SpoilsEngine.runEffectFrame`/`resumeEffectFrames` — not something you need
to touch when just authoring card data.)

- **`chooserSelectsTarget`** — `{ chooser, declaration, effects }` — pauses
  for `chooser` (not necessarily the ability's controller) to pick a target
  matching `declaration`'s selector, then resolves `effects` with the
  choice bound to `{ "type": "selected", "id": declaration.id }`. "An
  opponent discards a card" is `chooser: "opponent"`, a hand-zone
  declaration, and a `moveCard` to `"discard"`. RULES.md §12: a 0-candidate
  declaration is skipped as a no-op rather than left as an unanswerable
  choice.
- **`chooserSelectsOption`** — `{ chooser, options: EffectOption[] }`, where
  `EffectOption` is `{ label?, effects: Effect[] }` — pauses for `chooser`
  to pick exactly one of `options` to resolve in full (the rest are
  skipped). "An opponent chooses one of the following effects" — or a "you
  may" trigger modeled as a two-branch choice with an empty first branch
  (see recipes below). `label` is optional data-authoring sugar: a bare
  `Effect[]` has no inherent human-readable meaning, so a renderer has
  nothing else to show for each branch in a choice UI — set it whenever a
  branch isn't self-evident (an empty "decline" branch usually is).
- **`lookAndReorder`** — `{ player, count }` — pauses for `player` to
  reorder the top `count` cards of their own deck ("look at the top N
  cards... put them back in any order"). A no-op if the deck has fewer than
  `count` cards.
- **`reduceNextCost`** — `{ player, amount }` — reduces the numeric cost of
  the next card `player` deploys this turn by `amount` (floored at 0),
  consumed by exactly one subsequent `playCard`; unused reductions expire
  at end of turn. Not itself a pause point (doesn't set a pendingChoice).
- **`deployForFree`** — `{ player, maxCost, selector? }` — pauses for
  `player` to pick a hand card (matching `selector`, printed cost <=
  `maxCost`) and deploy it immediately without paying its numeric cost.
  Threshold and non-numeric extra costs (targets, deplete, etc.) still
  apply; the deploy resolves synchronously as a nested consequence, not its
  own response window.
- **`distributeAmong`** — `{ chooser, selected, amount, effects }` — pauses
  for `chooser` to divide `amount` however they like among the cards
  already selected under `selected` (a `TargetDeclaration` id) — "divide up
  to 2 damage however you want among the characters." Resolves `effects`
  once per card with a nonzero share, that card bound to `{ "type":
  "selected", "id": "__candidate" }` and its share to `{ "type":
  "variable", "id": "__amount" }`.

## NumberExpression (`src/types/expressions.ts`)

`number` (literal) | `stat` | `counter` | `count` (cardinality of a
`CardSelector`) | `add` | `multiply` | `variable` | `random` | `cardCost` |
`printedStat` | `resourceIcons` | `divide` | `modulo` | `selectionCount`.

- **`printedStat`** — `{ target, stat }`, a card's printed BASE stat from its
  `CardDefinition` (before runtime modifiers) — parallel to `cardCost`, and
  distinct from `stat` (the live value). 0 if the definition lacks that
  stat. "Loses life equal to its printed life minus 2."
- **`resourceIcons`** — `{ player, icon }`, how many of a given resource
  `icon` (`rage`/`greed`/`deception`/`elitism`/`obsession`/`volition`)
  `player` controls in play (`getThresholds`). Also the idiom for "while you
  control at least [X][X]" — `numberCompare` it against a literal.

- **`variable`** — `{ id }`, a player-chosen number ("choose a number for
  X"), read from `ResolutionContext.variables[id]`. The player supplies
  `variables: { x: 3 }` alongside `selected` on the `playCard`/
  `activateAbility` action; reads as 0 if never assigned (RULES.md §12).
  Reference the same `id` from both a cost (e.g. "pay X+X") and an effect
  (e.g. "inflict X damage") in the same ability. An `ActivatedAbility` can
  also supply `variables` itself (see "Ability-level `variables`" under
  Ability types above) for a value that must be settled *before*
  targeting/costs, like a coin flip — an explicit `variables[id]` on the
  action still wins over the ability-level one for the same id.
- **`random`** — `{ min, max }`, a uniformly random integer in `[min,
  max]` inclusive (both `NumberExpression`s themselves). A coin flip is
  `{ "min": 1, "max": 2 }`.
- **`cardCost`** — `{ target }`, a card's printed numeric `cost` — not a
  runtime `Stat`, so `stat` can't reach it (e.g. "deal damage equal to this
  item's cost").
- **`divide`** — `{ value, by, rounding: "up" | "down" }` — `value / by`,
  rounded per `rounding` ("half its cost, rounded up" is `{ "value": {
  "type": "cardCost", "target": "source" }, "by": 2, "rounding": "up" }`).
  Division by 0 reads as 0.
- **`modulo`** — `{ value, by }` — `value % by` (always >= 0). Division by
  0 reads as 0. Useful for parity: "an even number of cards in hand" is
  `{ "type": "numberCompare", "left": { "type": "modulo", "value": {
  "type": "count", "selector": { "controller": "self", "zone": "hand" } },
  "by": 2 }, "operator": "=", "right": 0 }`.
- **`selectionCount`** — `{ id }`, the number of cards currently bound
  under `ResolutionContext.selected[id]` — "X is the number of characters
  you depleted this way" reads `{ "type": "selectionCount", "id":
  "depleted" }` after a `depleteSelected` cost bound to that declaration.
  Reads as 0 if `id` was never bound.

## PlayerRef (`src/types/expressions.ts`)

```ts
PlayerRef = "controller" | "owner" | "activePlayer" | "opponent"
          | { type: "player"; id: PlayerId }
          | { type: "ownerOf"; target: TargetRef }
```

`"controller"`/`"owner"` resolve relative to `ResolutionContext.
controllerId` (almost always the same player; they diverge only for a
taken-control card). `{ type: "ownerOf", target }` resolves to whoever owns
a *targeted* card — e.g. "look at the top 5 cards of any one deck" is a
character/faction-style target declaration for which deck, then
`lookAndReorder`'s `player` is `{ "type": "ownerOf", "target": { "type":
"selected", "id": "<declarationId>" } }`.

## TargetRef / CardSelector / TargetDeclaration

```ts
TargetRef = "source" | "attachedTo" | "eventCard"
          | { type: "selected"; id: string } | { type: "card"; id }
          | { type: "random"; selector: CardSelector }
```

- **`"attachedTo"`** — the card `source` is currently attached to
  ("Attach to X"). Resolves to `undefined` while unattached, which makes
  any effect/modifier targeting it a safe no-op — no extra condition
  needed for "while attached."
- **`"eventCard"`** — the card `getEventCardId(context.event)` maps to for
  the current event (same mapping `sourceIsEventCard` compares against).
  Lets a condition inspect *that* card's own properties instead of just
  testing equality with `source` — e.g. `{ "type": "cardTypeIs", "target":
  "eventCard", "cardType": "faction" }` to check a `damageDealt` event's
  target was a faction.
- **`{ type: "random", selector }`** — a uniformly random card matching
  `selector` (e.g. "discard a card at random"), or `undefined` if nothing
  matches.
- **`{ type: "deckPosition", player, from, index? }`** — the card at a fixed
  slot in a deck (`from: "top" | "bottom"`, `index` default 0). `undefined`
  if the deck is too short. "Numeric cost of the top card of your deck" is
  `{ "type": "cardCost", "target": { "type": "deckPosition", "player":
  "controller", "from": "top" } }`. To put a card *on top* of a deck use
  the `moveCard` effect's `"position": "top"` (default is bottom).
- **`{ type: "respondedToCard" }`** — the card on the stack this one is
  being played in response to (pairs with the `respondingTo` condition).
- **`{ type: "factionOf", player }`** — that player's faction card instance
  ("attach it to that player's faction").

`NumberExpression` also has **`{ type: "conditional", if, then, else }`** —
`then` when the `Condition` holds, else `else`.

```ts
CardSelector = { controller?, owner?, zone?, type?, subtype?, depleted?, conditions? }
```

**No implicit zone.** A selector with no `zone` matches *every* zone,
including `deck`/`hand`/`removed` (RULES.md §2, deliberate). Always set
`zone: "play"` explicitly for "pick a character/item/location" — omitting it
is a silent correctness bug, not a convenience default.

`selector.conditions` lets you filter by an arbitrary `Condition[]`,
evaluated with the *candidate* card bound to `{ type: "selected", id:
"__candidate" }` in the resolution context. Useful for negation ("a
non-resource card" = `{ type: "not", condition: { type: "cardTypeIs",
target: { type: "selected", id: "__candidate" }, cardType: "resource" } }`)
since `CardSelector.type` only supports a single positive match, no
exclusion list. The same binding works for `inBattle` to express "a
blocking character" (`role: "blocker"`) or "not currently in a battle"
(`not` + `inBattle`, no `role`).

```ts
TargetDeclaration = { id, selector, count, optional? }
```

`optional: true` — "you may pick..." — lets the declaration be satisfied
with **0** selections instead of exactly `count`. This is always a *real
decision*, not auto-decided just because there's only one legal candidate
the way mandatory targeting is:
- **playCard/activateAbility**: the player declines by submitting
  `selected: { id: [] }` explicitly (an empty array, not an omitted key).
- **triggered abilities**: `findUnresolvedTargetDeclarations` routes an
  optional declaration to a `selectTargets` pendingChoice whenever *any*
  legal candidate exists, even exactly one — the controller might still
  decline. It only auto-resolves (to an empty selection) when there are
  literally zero legal candidates.

Gate the "if you do" half with the `if` effect + `targetExists` (see
Effects above). `count` is itself a `NumberExpression` (not a plain
number), so "pick X or fewer" ranges (a coin flip, a variable, a
`selectionCount`) work directly: set `optional: true` and `count` to that
expression — `min` becomes 0, `max` becomes the evaluated `count`, and
`optional` is the *only* thing that makes 0 a legal selection (a
non-optional `count` is still an exact requirement, even a variable one).

## Keywords / Restrictions (`src/types/ids.ts`)

```ts
Keyword = "tactical" | "aggro" | "covert" | "redirectDamage"
Restriction = "cannotAttack" | "cannotBlock" | "mustAttack" | "mustBlock"
```

`mustAttack` / `mustBlock` — "must attack/block if it can". Enforced at
`declareAttack` / `declareBlockers`: if the controller declares a battle
action at all, an eligible, un-depleted character with the restriction (and
a legal target / a legal party to join) must be included. A turn with **no**
declared attack isn't policed (no "end of turn" forcing yet — flag if a card
needs it). Public accessors: `getKeywords(cardId)` / `getRestrictions(cardId)`.

`redirectDamage` — while attacking and blocked, the attacker's controller
may assign its battle damage to the attack's original target instead of
the blocking party (`getLegalBattleDamageTargets` appends that target as an
*extra* legal option, not a replacement — it's "may... instead of," not a
forced redirect).

Static grant via `behavior.keywords: Keyword[]` — no ability entry needed
for a bare keyword line (e.g. a card whose entire text is `"COVERT"`).
`Restriction` has no static form — it's always granted dynamically (see
below), since nothing is ever printed as inherently "cannot attack."

Two ways to grant either dynamically, both checked by `hasKeyword`/
`hasRestriction` (which battle legality — COVERT blocking, attack/block
eligibility — already calls):

1. **Temporary, via effect** — `grantKeyword`/`grantRestriction` effects
   push a `RuntimeKeywordGrant`/`RuntimeRestriction` onto `state.
   keywordGrants`/`state.restrictions`, cleaned up at end of turn the same
   way `state.modifiers` is (`durationStillActive`). For "this turn, the
   character gains COVERT":
   ```json
   { "type": "grantKeyword", "target": {...}, "keyword": "covert",
     "duration": { "type": "untilEndOfTurn" } }
   ```
2. **Continuous, while a condition holds** — `ContinuousAbility.keywords` /
   `.restrictions` (parallel to `.modifiers`, recomputed live, never
   stored). For "the attached character gains COVERT" / "...cannot attack
   or block":
   ```json
   { "id": "...", "type": "continuous", "modifiers": [],
     "keywords": [{ "target": "attachedTo", "keyword": "covert" }] }
   ```
   `ContinuousAbility.modifiers` is still required even when empty (only
   granting a keyword/restriction, no stat change).

### Continuous abilities: aura / cost / damage forms

- **Aura** — a `modifiers`/`keywords`/`restrictions` entry may set
  `selector` **instead of** `target` to apply to *every* in-play card the
  selector matches, recomputed live ("all your characters lose 1 strength",
  "every character loses life equal to its printed life minus 2"). With
  `selector`, a modifier's `value` is evaluated per affected card with that
  card bound to `{ "type": "selected", "id": "__candidate" }`, so
  `printedStat`/`stat` of `__candidate` give per-target amounts.
- **`costModifiers`** — `[{ affects, delta, minCost?, selector? }]` — adjusts
  what it costs `affects` to deploy a matching card ("opponents pay 1 more
  to deploy a tactic", "characters you play cost 2 less, min 1"). `selector`
  matches the card being deployed (don't constrain `zone`). Feeds both
  `getCardPlayability` and the real payment.
- **`damageModifiers`** — `[{ selector, battleOnly?, delta }]` — tunes each
  instance of damage inflicted to a matching card, floored at 0 ("reduce
  battle damage to your characters by 2"). Not a replacement effect — it
  can't cancel, only adjust. (engine-derived) applied per assignment.

Caveat: `declareAttack`'s AGGRO check and `declareBlockers`'s COVERT check
both use the full `hasKeyword` (dynamic grants included). The TACTICAL
check in `assertCanDeployAtCurrentTiming` still uses the static-only
`definitionHasKeyword` (that call site only has a `CardDefinition`, not a
`CardInstanceId`, in scope) — a dynamically-granted TACTICAL wouldn't be
honored there. Not currently blocking any card; flag if one needs it.

## Duration / ModifierOperation (`src/types/ids.ts`)

`Duration`: `permanent | untilEndOfTurn | whileSourceInPlay`.
`ModifierOperation`: `add | set | multiply`.

## Common recipes

**ETB effect on self:**
```json
{ "id": "...", "type": "triggered", "event": "cardEnteredPlay",
  "condition": { "type": "sourceIsEventCard" },
  "effects": [ /* ... */ ] }
```

**Activated ability, deplete + target + temporary stat change:**
```json
{ "id": "...", "type": "activated",
  "costs": [{ "type": "deplete", "target": "source" }],
  "targets": [{ "id": "target", "selector": { "zone": "play", "type": "character" }, "count": 1 }],
  "effects": [{ "type": "createModifier",
    "target": { "type": "selected", "id": "target" },
    "stat": "strength", "operation": "add", "value": -2,
    "duration": { "type": "untilEndOfTurn" } }] }
```

**Tactic, no targeting, multiple effects:**
```json
{ "id": "...", "type": "activated",
  "effects": [
    { "type": "modifyInfluence", "player": "controller", "amount": 2 },
    { "type": "draw", "player": "controller", "amount": 1 }
  ] }
```

**Bare keyword:**
```json
"behavior": { "keywords": ["covert"] }
```

**Effect applied to every matching card (not just one target):**
```json
{ "type": "forEach",
  "selector": { "controller": "self", "zone": "play", "type": "character" },
  "effects": [{ "type": "dealDamage",
    "target": { "type": "selected", "id": "__candidate" }, "amount": 2 }] }
```

**"Attach to X" item that buffs/restricts the attached character:**
```json
{ "id": "...", "type": "continuous",
  "modifiers": [{ "target": "attachedTo", "stat": "strength", "operation": "add", "value": 2 }] }
```

**"HANDOFF" — re-attach an in-play item to a new (untargeted-by-battle) character:**
```json
{ "id": "...", "type": "activated", "name": "Handoff",
  "costs": [
    { "type": "payResources", "amount": 3 },
    { "type": "deplete", "target": { "type": "selected", "id": "newWearer" } }
  ],
  "targets": [{
    "id": "newWearer",
    "selector": { "controller": "self", "zone": "play", "type": "character",
      "conditions": [{ "type": "not", "condition": { "type": "inBattle", "target": { "type": "selected", "id": "__candidate" } } }] },
    "count": 1
  }],
  "effects": [{ "type": "attachTo", "target": "source", "to": { "type": "selected", "id": "newWearer" } }] }
```

**"You may pick X. If you do, Y." (optional target + conditional effect):**
```json
{ "id": "...", "type": "triggered", "event": "characterAttacked",
  "condition": { "type": "sourceIsEventCard" },
  "targets": [{ "id": "target", "selector": { "zone": "play", "type": "character" }, "count": 1, "optional": true }],
  "effects": [{
    "type": "if",
    "condition": { "type": "targetExists", "target": { "type": "selected", "id": "target" } },
    "effects": [{ "type": "deplete", "target": { "type": "selected", "id": "target" } }]
  }] }
```

**"When this card deals damage to a faction" (not just damage to anything):**
```json
"condition": {
  "type": "and",
  "conditions": [
    { "type": "sourceIsDamageSource" },
    { "type": "cardTypeIs", "target": "eventCard", "cardType": "faction" }
  ]
}
```

**Player-chosen X variable, referenced by both a cost and an effect (a tactic's "EXTRA COST: Choose a number for X. Pay X+X. ... Inflict X damage."):**
```json
{ "id": "...", "type": "activated",
  "costs": [{ "type": "payResources",
    "amount": { "type": "add", "values": [{ "type": "variable", "id": "x" }, { "type": "variable", "id": "x" }] } }],
  "targets": [{ "id": "target", "selector": { "zone": "play", "type": "character" }, "count": 1 }],
  "effects": [{ "type": "dealDamage", "target": { "type": "selected", "id": "target" }, "amount": { "type": "variable", "id": "x" } }] }
```
(the caller supplies `variables: { x: 2 }` alongside `selected` on the action)

**Search the deck for a card and take it (with the required reshuffle):**
```json
{ "id": "...", "type": "triggered", "event": "cardEnteredPlay",
  "condition": { "type": "sourceIsEventCard" },
  "targets": [{ "id": "target", "selector": { "controller": "self", "zone": "deck", "type": "tactic" }, "count": 1, "optional": true }],
  "effects": [
    { "type": "if",
      "condition": { "type": "targetExists", "target": { "type": "selected", "id": "target" } },
      "effects": [{ "type": "moveCard", "target": { "type": "selected", "id": "target" }, "to": "hand" }] },
    { "type": "shuffleDeck", "player": "controller" }
  ] }
```

**Coin flip / random discard:**
```json
{ "type": "modifyInfluence", "player": "controller", "amount": { "type": "random", "min": 1, "max": 2 } }
```
```json
{ "type": "moveCard", "target": { "type": "random", "selector": { "controller": "opponent", "zone": "hand" } }, "to": "discard" }
```

**"An opponent discards a card" (chooser, not controller, picks):**
```json
{ "type": "chooserSelectsTarget", "chooser": "opponent",
  "declaration": { "id": "discarded", "selector": { "controller": "opponent", "zone": "hand" }, "count": 1 },
  "effects": [{ "type": "moveCard", "target": { "type": "selected", "id": "discarded" }, "to": "discard" }] }
```

**"At the start of your turn, you may put a token on this card." (a "you may" trigger modeled as a two-branch choice):**
```json
{ "id": "...", "type": "triggered", "event": "turnStarted",
  "condition": { "type": "eventPlayerIs", "player": "controller" },
  "effects": [{
    "type": "chooserSelectsOption", "chooser": "controller",
    "options": [
      { "label": "Decline", "effects": [] },
      { "label": "Put a token on this card",
        "effects": [{ "type": "addCounter", "target": "source", "counter": "token", "amount": 1 }] }
    ]
  }] }
```

**"Divide up to N damage/tokens however you want among the selected cards":**
```json
{ "type": "distributeAmong", "chooser": "controller", "selected": "picked", "amount": 2,
  "effects": [{ "type": "dealDamage", "target": { "type": "selected", "id": "__candidate" }, "amount": { "type": "variable", "id": "__amount" } }] }
```

**"Pick 2 or fewer characters" (a true range, not just 0-or-N):**
```json
{ "id": "picked", "selector": { "zone": "play", "type": "character" }, "count": 2, "optional": true }
```

**"An opponent chooses X of [a set of already-selected cards]" (constrain a selector to an earlier selection):**
```json
{ "type": "chooserSelectsTarget", "chooser": "opponent",
  "declaration": {
    "id": "chosen",
    "selector": { "conditions": [{ "type": "targetInSelection", "target": { "type": "selected", "id": "__candidate" }, "selection": "found" }] },
    "count": { "type": "selectionCount", "id": "depleted" }
  },
  "effects": [{ "type": "forEach", "selected": "chosen",
    "effects": [{ "type": "moveCard", "target": { "type": "selected", "id": "__candidate" }, "to": "hand" }] }] }
```

## Testing convention

Don't write a test per card. `src/engine/__tests__/card-behaviors.test.ts`
covers each *ability shape* once via `support/fixtures.ts` builders — new
tests belong there when a new mechanism (or vocabulary extension) needs
proving, not for every additional card that reuses an existing shape.

## Coverage workflow

Working the ~1900 not-yet-implemented cards in `data/cards.json` is tracked
in `data/card-coverage.json` (source of truth) + the generated `COVERAGE.md`
(status roll-up — never hand-edit). `scripts/build-coverage.cjs` maintains
the manifest: it adds a skeleton entry per new catalog id, prunes dead ids,
and rebuilds `COVERAGE.md`. It **never** advances an entry's `status` or
edits its classification — humans/agents do that by hand-editing
`data/card-coverage.json`. `src/engine/__tests__/card-data-integrity.test.ts`
enforces everything below.

### Per-card entry

```jsonc
{
  "id": "…", "name": "…", "set": "Seed 3", "type": "character",
  "status": "unclassified" | "vanilla" | "classified" | "authored" | "verified" | "blocked" | "wontImplement",
  "textHash": "<sha1 of normalized printed text>",   // stale => test fails => re-review
  "rulesAudited": false,                 // true once `text` has been read against RULES.md + behavior confirmed
  "behavior": {
    "needed": true,                       // false once classification confirms no ability
    "shapes": ["triggered:cardEnteredPlay", "continuous:modifier"],
    "reusesProvenShape": true,            // false => a new card-behaviors.test.ts describe() naming this card is required
    "newTestNeeded": false
  },
  "metadata": {                           // must match the CardDefinition once status is authored/verified
    "unique": "thunderhoof" | null,
    "attachTo": "character" | null,
    "resourceProvides": ["obsession"] | null,
    "keywords": ["covert"]
  },
  "engineCapability": ["flip-up"],        // capability ids required; [] = expressible with today's vocab
  "display": { "notes": "…" },            // renderer hints (labels, captions) — no engine meaning
  "confidence": "high" | "medium" | "low",
  "notes": "rules question / RULES.md cite / ambiguity"
}
```

Top-level `capabilities` is the deduplicated engine-gap backlog:

```jsonc
"capabilities": {
  "flip-up": {
    "status": "unimplemented" | "designed" | "implemented",
    "kind": ["cost", "effect"],          // which src/types union(s) it extends
    "spec": "one-paragraph description",
    "cards": ["<id>", "…"],
    "rulesRef": "RULES.md §…"
  }
}
```

### Status lifecycle

`unclassified` → **classify** (fill `behavior.shapes`, `metadata`,
`engineCapability` from the *existing* vocabulary in
`src/types/{costs,conditions,effects,expressions}.ts`; cite `RULES.md`;
record ambiguities as `notes` + `confidence: "low"` rather than guessing) →
`classified` → **author** (`behavior` + metadata onto the card in
`data/cards.json`, `npm run sync-cards`) → `authored` → **verify** (tests +
a smoke game exercise it) → `verified`. `vanilla` = no `behavior` needed
(text-free / keyword-only / plain resource). `blocked` = classified but
cannot be authored until a capability lands. `wontImplement` = references a
mechanic a 2-player, single-game engine can't model (alternate win
conditions, "outside the game", multiplayer/politics, draft/format text) —
carries a `notes` saying which, and counts as *resolved* (not blocked) in
the roll-up.

`rulesAudited` is orthogonal to `status`: it records that a card's printed
`text` has actually been read against `RULES.md` and its `behavior` (if
any) confirmed — as opposed to just carrying a `behavior` block from an
earlier, unreviewed pass. Flip it to `true` during classification.

### One-pass invariant (enforced)

- An entry may only reach `authored`/`verified` when `engineCapability` is
  `[]` **or** every listed capability is `status: "implemented"`.
- A set's classification is "complete" only when every entry is
  `classified`/`vanilla` **and** every capability it references has a
  written `spec`. **Authoring a set does not begin until then** — that is
  what makes the pass single.
- New engine capability is always a new member of a closed `src/types/`
  union (or a new `PendingChoice` variant + `resolvePendingChoice` case for
  a new input moment, with a structured serializable payload and optional
  `label` — never engine-side text/layout). Never per-card code, never a
  branch keyed on card name/id. Update `RULES.md` in the same change.

### Commands

```
node scripts/build-coverage.cjs                 # refresh manifest + COVERAGE.md
node scripts/build-coverage.cjs --check          # CI: fail if stale
node scripts/build-coverage.cjs --accept-text ID # after re-reviewing a text change
```
