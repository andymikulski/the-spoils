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
  "abilities": [ AbilityDefinition, ... ]  // optional
}
```

`AbilityDefinition` is one of `ActivatedAbility | TriggeredAbility |
ContinuousAbility` (discriminated on `type`).

- **Character/item/location abilities** — listed under `behavior.abilities`
  as normal.
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
ActivatedAbility:  { id, name?, type: "activated", condition?, costs?, targets?, effects, variables? }
TriggeredAbility:  { id, name?, type: "triggered", event, condition?, targets?, effects }
ContinuousAbility: { id, name?, type: "continuous", condition?, modifiers, keywords?, restrictions? }
```

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

All costs in an ability must be payable simultaneously (`canPayCosts`
simulates on a cloned state) — no partial payment.

## Conditions (`src/types/conditions.ts`)

`and`, `or`, `not`, `sourceInZone`, `sourceIsEventCard`,
`eventCardControlledBy`, `targetExists`, `cardTypeIs`, `statCompare`,
`counterCompare`, `numberCompare`, `inBattle`, `sourceIsDamageSource`,
`cardMovedFromZone`, `battleRole`, `eventPlayerIs`, `targetInSelection`.

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

## Effects (`src/types/effects.ts`)

`draw`, `playResource`, `dealDamage`, `modifyInfluence`, `moveCard`,
`destroy`, `deplete`, `restore`, `addCounter`, `removeCounter`,
`createModifier`, `takeControl`, `removeFromGame`, `forEach`, `attachTo`,
`grantKeyword`, `grantRestriction`, `if`, `shuffleDeck`,
`chooserSelectsTarget`, `chooserSelectsOption`, `lookAndReorder`,
`reduceNextCost`, `deployForFree`, `distributeAmong`.

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
`divide` | `modulo` | `selectionCount`.

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
Restriction = "cannotAttack" | "cannotBlock"
```

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
