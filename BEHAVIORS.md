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
- **`selfDisposition: { to: "faceDownResource" | "hand", condition? }`** —
  where a resolving **tactic** goes after its effects *instead of* the
  discard pile. `"faceDownResource"` = it re-enters play as an anonymous
  face-down resource under its owner ("Put this card into play under its
  owner's control as a face-down resource instead of into their discard
  pile"); `"hand"` = its owner's hand (Clam Hash). `condition` is evaluated
  in the tactic's own resolution context — use `{ "type":
  "deployedViaFlipUp" }` for "if you deployed this card using FLIP UP,
  ... instead". Tactic-only; a permanent that flips itself uses the
  `flipFaceDown` effect.
- **`revealFromHand: { cost }`** — "While this card is in your hand you may
  reveal this card as you are playing a resource. If you do, you may deploy
  this card for N." (Witty Worm). A hand-sourced alt deploy taken *instead
  of* the faction Develop Rule's resource play for the turn: threshold + any
  EXTRA COSTs still apply, only the numeric cost is replaced by `cost` (no
  cost modifiers / reductions). Driven by a `revealFromHand: { cardId,
  selected?, variables? }` payload on the `chooseDevelop` action's
  `playResource` choice (`cards` must be empty). See RULES.md §6.

`AbilityDefinition` is one of `ActivatedAbility | TriggeredAbility |
ContinuousAbility | ReplacementAbility` (discriminated on `type`).

## Holy Heist additions

Condensed index of vocabulary added for Holy Heist (full detail in
`src/types/*` and `COVERAGE.md`'s capability table).

**Effects**
- `healDamage { target, amount }` — remove up to N damage markers (floor 0).
- `suppressAbilities { target, duration }` — duration'd "loses all rules
  text" (the effect form of `ContinuousAbility.suppressAllAbilities`).
- `suppressKeyword { target, keyword, duration }` — duration'd "loses
  <keyword>" (lose beats grant).
- `grantKeywordToPlayer { player, keyword, duration }` — every character
  `player` controls (now + later this turn) gains `keyword`. "characters you
  control and deploy" = grant `aggro`.
- `transformBattleDamage { target, role: "dealer" | "receiver", kind:
  "setAmount" | "redirectToSelf" | "bounceOther" | "bounceSelf", amount?,
  duration }` — rewrites locked battle-damage assignments. Don't Trip
  (`redirectToSelf`), Ocular Dispersal (`setAmount`, `amount` = host
  `cardCost`), Vexing Nullifier (`bounceOther` + `bounceSelf`).
- `randomFromSelection { selected, count, effects }` — run `effects` for
  `count` random members of an existing selection (`__candidate` bound).
- `separateIntoPiles { splitter, selected, pile1: Effect[], pile2: Effect[] }`
  — `splitter` partitions `selected` into two piles (either may be empty);
  `pile1`/`pile2` effects run per card in each. Profane Proposal.
- `grantVoidPlay { selected, player, ignoreThreshold? }` — persistent grant
  letting `player` deploy those (still-voided) cards as though from hand.
  Cheats. Pruned when the card leaves the void.
- `scheduleEffect.when` gains `"startOfOpponentNextTurn"` (Final Countdown).
- `lookAndReorder.to` gains `"split"` — the chooser sends any number of the
  looked-at cards to the deck bottom and keeps the rest on top, each pile in
  a chosen order (`reorderDeck` choice carries `order` = top pile, `bottom`
  = bottom pile). Ignatius Gloamspike, Confessions of Countless Souls.

**Costs** — `moveSelected { id, player, selector, count, to, position?,
shuffle? }` (paid like `discard` but to any zone; `shuffle` reshuffles a
deck destination). Uhluhtc Niudla.

**Conditions** — `hasKeyword { target?, keyword }`, `textMentionsIcon
{ target?, icon }`, `hasAttachment` gains `ofSubtype?`, `isToken
{ target? }`, `eventCardIs { target }` (general `sourceIsEventCard` — scope
an attachment trigger to `attachedTo`), `targetInZone { target, zone }`
("if it is destroyed by that damage" = `if` on `not(targetInZone play)`
after the `dealDamage`), `battleTargetIs { controlledBy?, cardType? }`,
`battleDamageAssigned { operator, value }` ("before any damage is assigned"
= `=` 0).

**Expressions** — `sumCounters { selector, counter }` (parallel to
`sumStat`).

**TargetRef** — `{ type: "respondedToPicked", cardType }` (the card the
responded-to item picked as an extra cost — read side of the same-named
condition).

**Restrictions** (`grantRestriction` / continuous `restrictions`)
- `mustBePicked` — a target declaration whose legal pool contains any
  `mustBePicked` card collapses to just those (Ferret Oil Coating).
- `cannotUseAbilities` — no player may activate that card's activated
  abilities (triggered/continuous/replacement unaffected). Aura form —
  "Abilities on locations cannot be used" (0v3rw0rk3d 31f).

**Keywords** — `canBlockAnyParty` (Guardbeast of Thabbash): like
`canBlockCovert`, plus exempt from "a COVERT character may block only a
COVERT party".

**Ability knobs**
- `ActivatedAbility.usableBy` gains `"opponent"` (iDumb De-Itemizer RESET —
  only the opponent may use it).
- `ReplacementAbility.chooser?: PlayerRef` — resolved relative to the
  *affected card's* controller; that player makes the optional choice and
  pays `optionalCost` (Unloyal Necromorph — `chooser: "opponent"`).

**TargetDeclaration** — `distinctNames: true` ("N cards with different
names"; Cheats, Profane Proposal).

**`nameValue.valueKind`** gains `"trade"`; **`CardSelector.tradeVar:
string | string[]`** matches a card's `trade` against stored named
value(s). Gathering of Unlikely Heroes.

**Card-def siblings** — `behavior.keepOnHostLeave: true` (an "Attach to X"
card whose host leaves play stays in play unattached; Everlasting Blade of
Light). A **tactic** with `attachTo` set (and no `selfDisposition`) resolves
into play attached to its picked host — its abilities are then live
(Infectious Pustulio, Ocular Dispersal, Unstable Modification, Will of a
Living God).

**Events** — `cardsDiscarded { playerId, count }` (once per discarded card),
`blockingPartyFormed { playerId, blockerCount }` (once for the whole
declared blocking party; `playerId` = defender).

**`Duration`** gains `{ type: "untilStartOfNextTurn" }` — survives the
opponent's turn, expires at the start of your next.

## Shade of the Devoured Emperor (Volition era) additions

A condensed index of vocabulary added for that set — full detail is in the
per-category sections below and in `src/types/*`.

**Card-def / behavior siblings**
- **`behavior.modes: [{ label?, condition?, costs?, targets?, variables?,
  variableBounds?, effects? }]`** — a modal **tactic** ("Choose one of the
  following as this card's rules text"). The `playCard` action carries
  `mode: N`; only `modes[N]`'s block applies (in place of the first
  activated ability's). Distinct from `chooserSelectsOption` (shared
  cost/targets, chosen *after* they resolve).
- **`behavior.onPlay.costAdjust: NumberExpression`** — added (usually
  negative) to the numeric cost paid, floored at 0, evaluated in the play
  context (so it can read EXTRA-COST `selectionCount`s). Opportunistic
  Pirate.
- **`behavior.noResponse: true`** — the tactic resolves with no opponent
  response window. Swindle.
- **`revealFromHand` gains `threshold?` + `effects?`** — an icon gate + rider
  effects for a FINE PRINT reveal deploy (Unexpected Codicil).

**ContinuousAbility fields**
- **`suppressAllAbilities: { target?, selector? }`** — the matched cards lose
  every *other* ability (activated/triggered/continuous/replacement/granted),
  keeping only this one. "loses all other rules text" (Monstrous Lassitude,
  Rushing Crushing Blockhead — its own `modifiers` still apply); "the
  attached character has no rules text" (Mittens, `target: "attachedTo"`).
- **`redirects: [{ from, to }]`** — while `condition` holds, *all* damage and
  *any* leave-play of `from` happens to `to` instead. 6r4wny 60dy9u4rd5
  (`from` a `{ remembered }` EXTRA-COST pick, `to: "source"`). Unbounded —
  unlike `preventDamage` (bounded/self) and the `redirectDamage` keyword
  (battle-only).
- **`activeZone: Zone`** (default `"play"`) — the ability's `keywords` grants
  are live while the source sits in that zone. `"hand"` for "while this card
  is in your hand it gains TACTICAL" (Parkour Hoodlum) and the
  `zone: "hand"` aura "all characters in your hand gain TACTICAL"
  (Gloamspike-Gosche Bridge). `hasKeyword` now sees hand-zone auras, and the
  response-window deploy-timing TACTICAL check consults `hasKeyword` (not
  just the static list).
- **`damageModifiers[].sourceSelector: CardSelector`** — also require the
  damage *dealer* to match. "all damage assigned to this card by characters
  with items attached to them is reduced to 0" (Enlightened Mau).
- **`grantedAbilities`** now wires **activated** bodies too — "each character
  you control gains 'RESEARCH — ...'" (Jo Ciendeilio). They activate with the
  recipient as `source`.

**Restrictions** (via `grantRestriction` / continuous `restrictions`)
- **`cannotBePicked`** — removed from every player-or-chooser *target
  declaration*'s candidate pool (not from `forEach` / `count` / auras).
  Gloamspike-Gosche Bridge, Martial Arts Wannabe (conditional).
- **`attackOncePerTurn`** — `declareAttack` rejects a 2nd attack by that
  character this turn (`GameState.attacksThisTurn`). Static or aura.
- **`cannotBeTakenControl`** — a `takeControl` to a different controller
  fizzles. Gigantitect's Giant Giant.

**Triggered `event`s**
- **`counterChanged`** (`{ cardId, counter }`) — fires from an `addCounter` /
  `removeCounter` effect or `removeCounter` cost. "When there are no tokens
  on this card, destroy it" = a `counterChanged` trigger gated by
  `sourceIsEventCard` + `counterCompare(source, token, "=", 0)`. Flaming
  Cube, Runic Map.
- **`attackerBlocked`** (`{ cardId, battleId, blockerCount }`) — once per
  still-in-battle attacker when the defender declares a non-empty block.
  Maps to the attacker for `sourceIsEventCard`. Timid Mau ("blocked by a
  party of 2+ characters" — count blockers via `inBattle role: "blocker"`).

**Conditions** — `isActivePlayer { player? }` ("during your turn"),
`battleActive` (wrap in `not` for "not during a battle"), `cardSubtypeIs
{ target, subtype }`, `inPlaySinceTurnStart { target? }`, `uniqueIs
{ target, designations[] }`, `assignedDamageThisTurn { target? }`,
`inflictedDamageToFactionThisTurn { player, target? }`.

**Expressions** — `sumStat { selector, stat }`, `thresholdIconCount
{ target }`, `eventDamageAmount`. **PlayerRef** `{ type: "controllerOf",
target }`. **TargetRef** `{ type: "damageSource" }` (the `damageDealt`
event's source, vs. `"eventCard"` = its target). **CardSelector**
`uniqueDesignation: string | string[]`.

**Effects** — `grantProvides { target, icon, amount, duration }` (card-level
PROVIDES this turn; `icon` may be `{ fromNamed }`), `reduceThreshold
{ player, icon, amount }` (cut the next deploy's threshold requirement),
`removeCardType { target, cardType }`, `restrictPlay { player, kind:
"cardType" | "flipUp", cardType?, duration }`, `addToBattle { target, side }`,
`skipRestoreRule { player, turns? }`, `skipNextRestore { target }`,
`modifyNumericCost { target, delta, duration }`, `modifyOutgoingDamage
{ source, delta, duration }`, `chooserSelectsNumber { chooser, storeAs,
min?, max?, effects }`, `alternatingPayLoop { first, opponent, cost,
maxRounds?, onEnd }` (tallies into `context.variables["paid:"+playerId]`),
`anyPlayerMayPay { costs, effects }`, `createTokens.effects?` (per-token
follow-up), `putIntoPlay.borrowed?`, `deployFromZone.free?: boolean |
Condition`. `nameValue.valueKind` gains `"resourceIcon"`.

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
- **`ActivatedAbility.usesPerTurn`** — a per-turn activation cap ("Use
  this only 5 times each turn"; Vast Mastabatorium). Tracked in
  `GameState.abilityUsesThisTurn`, reset each turn.
- **`ActivatedAbility.usableBy`** — `"controller"` (default) or
  `"anyPlayer"`. An `"anyPlayer"` faction ability (The Knitting Coalition —
  "Both players may use this ability") is offered to the opponent and
  resolves under whoever activated it.
- **`ActivatedAbility.variableBounds`** — `{ [id]: { min?, max? } }`
  (each an optional `NumberExpression`) — the action's `variables[id]`
  must satisfy `min <= v <= max`, beyond plain affordability. "Pick a
  number for X, where X ≤ the number of [O] you control." (Desolate). For
  a tactic, put it on the first activated ability (same convention as
  `costs`/`targets`/`variables`).
- **`ContinuousAbility.uniqueGrant`** — `{ selector, designation:
  "cardName" | "<fixed>" }` grants a Unique designation to matching in-play
  cards ("all non-resource cards gain Unique X where X is their name").
- **`ContinuousAbility.grantedAbilities`** — `[{ selector, abilities:
  AbilityDefinition[] }]` grants whole ability bodies to every in-play,
  face-up card matching `selector` while the source is in play ("all
  characters gain the rules text «At the start of your turn, ...»"; Lodge
  Dock Florist). Granted **triggered** abilities fire for the recipient
  card (`"source"` inside them is that card). Granted `activated` /
  `continuous` / `replacement` bodies aren't wired yet — flag if a card
  needs them.
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

## 1st Edition Part 2 additions

Condensed index of vocabulary added for 1st Edition Part 2 (a
combat-heavy early set). Full detail in `src/types/*` + `COVERAGE.md`.

**Expressions**
- **`{ type: "battlePartySize", side, of? }`** — member count of a battle
  party (0 with no battle). `side`: `"attacking"` / `"blocking"` outright;
  `"ownParty"` / `"opposingParty"` relative to `of` (default `"source"`).
  "in a party with more than 1 member" (Callow Liegeman); "for each member
  in the opposing party" (Fleshripping Scenepuller).
- **`{ type: "extremumStat", selector, stat, direction }`** — highest
  (`"max"`) / lowest (`"min"`) live `stat` over a selector (0 if none).
  "the highest speed among characters in the opposing party" (Martial Arts
  Master; opposing party = `conditions: [inBattle, not sharesBattlePartyWithSource]`).

**Conditions**
- **`{ type: "isCard", target?, other? }`** — `target` (default
  `__candidate`) is the SAME instance as `other` (default `"source"`). Pins
  a `damageModifiers.selector` / aura / `grantedAbilities.selector` to one
  card — `other: "attachedTo"` for "the attached character" (Swordchucks);
  `{ not: { isCard } }` for "another … you control" (Hollow Moose).
- **`{ type: "damagedThisTurn", target, by? }`** — `by` (default `"source"`)
  has dealt damage to `target` this turn. "a turn when this card damaged
  it" (Gore Engine — a `cardDestroyed` trigger with `target: "eventCard"`).
- **`{ type: "destroyedByBattleDamage", target? }`** — inside a
  `cardDestroyed` trigger, the lethal instance was battle damage. Compose
  with `sourceIsEventCard` (Venomous Sacspider).

**TargetRef**
- **`{ type: "attachmentHost", target }`** — the card `target` is attached
  to (general form of `"attachedTo"`, which only works for `"source"`).
  Scorching Runicution ("the character the gear card is attached to").
- **`{ type: "respondedAbilitySource" }`** — the source card of the
  responded-to *ability* on the stack (parallel to `respondedToCard` for
  cards). Still resolves right after `terminate` pulled that ability off
  (engine stashes it for the action). Exploding Sock Puppet!, Subsection 5.

**CardSelector**
- **`nameVar: "<key>"`** — match `CardDefinition.name` against a `nameValue`
  (`valueKind: "cardName"`) stored on the source. Odious Diva.

**Effects**
- **`terminate` gains `disposition?: "discard" | "hand"`** (default
  `"discard"`) — where a terminated *card* goes. "put it into its owner's
  hand instead" (Voidal Interference).
- **`takeControl` gains `duration?: Duration`** — control reverts to the
  previous controller when it lapses (start-of-turn sweep). "This turn,
  take control of the character." (Mutiny Grant).
- **`deployForFree` gains `free?: boolean`** (default `true`) — `false` =
  the player still pays the deployed card's numeric cost (Late Addition).
  For "deploy up to N cards", list the effect N times.
- **`{ type: "lockAbilityThisTurn", target }`** — `"respondedAbility"`, or a
  `TargetRef` (locks every activated ability on that card). Bars
  re-activation this turn. Subsection 5, Paragraph 12.
- **`{ type: "flipCoin", player?, winEffects, loseEffects }`** — fair coin
  (seeded RNG); emits `coinFlipped { playerId, won }`; runs the matching
  branch. A `ReplacementAbility` `replaces: { event: "coinFlip", result:
  "lose" }` (with `optional` + `optionalCost`) may intercept a loss and
  offer a reflip — the engine re-rolls once and then runs the replacement's
  `effects` as a rider (source = the replacement card). Fwing!,
  Throatstabber, Two-Headed Coin.
- **`{ type: "restrictBlockers", target?, minPartySize?, minSpeed?,
  condition?, duration }`** — the "this turn" form of
  `ContinuousAbility.blockRestriction`; `condition` re-checked at
  `declareBlockers`. LeoKaiser GO MEGA-NEKO-KAISER!.
- **`{ type: "restrictBlockersToChosen", chooser, declaration }`** — on a
  `characterAttacked` trigger: `chooser` picks any number of characters
  (a `chooseChosenBlockers` pending choice); for this battle only those may
  block, and each that can, must. Wyrmfang Deathskull.
- **`{ type: "grantAbilitiesFrom", target, from }`** — `target` permanently
  gains every activated/triggered ability in `from`'s printed
  `behavior.abilities` (a snapshot; cleared when `target` leaves play).
  Skin Suit. (Continuous/replacement text isn't copied — concession.)
- **`{ type: "initiateAttack", attackerSelection, target }`** — declare +
  fully resolve one battle immediately, bypassing turn/eligibility timing;
  `attackerSelection` is a prior `TargetDeclaration` id, `target` a
  `PlayerRef`. The rest of the effect list resumes after `battleEnded` (as
  an `endOfBattle` rider). Counter Attack.
- **`{ type: "auctionForCard", revealFor }`** — reveal from the top of
  `revealFor`'s deck until a character; players bid (active player first),
  capped at their detached-resource count (`getAvailableResourceIds`); the
  high bidder pays that many (attach to faction) and puts the character into
  play; the rest shuffle back. `auctionBid` pending choice
  (`{ bid: 0 }` = pass). Auction House.

**ContinuousAbility fields**
- **`abilityCostModifiers: [{ scope, delta, minCost? }]`** — discount/tax on
  the `payResources` portion of matching activated abilities. `scope`:
  `"factionAbilities"` (the controller's faction card's), `"self"`,
  `"controlledCharacters"`. First Unified Market of Abstract Secure
  Theoreticals ("reduce your faction's abilities' cost by 1, min 1").
- **`partyRestriction: { role, minMembers?, parity? }`** — a *forming*
  attacking/blocking party that includes the source must satisfy it or
  `declareAttack`/`declareBlockers` is rejected. `role`: `"any"` /
  `"attacking"` / `"blocking"`. Insect Appreciator (`parity: "even"`),
  Anxious Oaf (`minMembers: 2`).
- **`blockRestriction: { minBlockingPartySize?, minBlockerSpeed? }`** — only
  a blocking party of ≥ N / all blockers of speed ≥ N may block this card
  (or its attacking party), while `ability.condition` holds. LeoKaiser,
  Wild Boars. Whole-party "cannot be blocked" stays the `cannotBeBlocked`
  keyword.

**DamageModifierDefinition**
- **`minAmount?` / `setTo?`** — a passive amount clamp applied after
  `delta`: if the incoming amount to a matching card is `>= minAmount`, set
  it to `setTo` (default 0). "When any amount of damage greater than 4 is
  inflicted to this card, reduce it to 0" (Class Action Defender —
  `minAmount: 5, setTo: 0`).

**Events**
- **`coinFlipped { playerId, won }`** — after a `flipCoin` settles.
- **`cardDestroyed` gains `byBattleDamage?`** — true when the lethal
  instance was battle damage (read by `destroyedByBattleDamage`).

## Ability types

```ts
ActivatedAbility:  { id, name?, type: "activated", activationZone?, threshold?, condition?, costs?, targets?, effects, variables? }
TriggeredAbility:  { id, name?, type: "triggered", event, triggerZone?, condition?, targets?, effects }
ContinuousAbility: { id, name?, type: "continuous", condition?, modifiers, keywords?, restrictions?, costModifiers?, damageModifiers? }
ReplacementAbility:{ id, name?, type: "replacement", replaces, condition?, optional?, optionalCost?, effects }
```

**`TriggeredAbility.triggerZone`** — any `Zone` (default `"play"`) makes the
trigger live while its source sits in that zone — "While this card is in
your discard pile, when <event> ..." (`"discard"`: Manifest, Hidden Ruins,
Accidental Invention, Burly Assailment; `"void"`: I Drink Your Milkshake!;
`"deck"`: Community Chest's "draw a card at the start of your turn" after a
mulligan bottom). The parallel of `ActivatedAbility.activationZone`. Keep
the "... under your control" half in `condition` (`eventCardControlledBy` /
`cardProvides` etc.).

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
`cardsDrawn`, `cardsDiscarded`, `damageDealt`, `abilityActivated`,
`battleStarted`, `battleEnded`, `characterAttacked`, `characterBlocked`,
`blockingPartyFormed`, `counterChanged`, `attackerBlocked`, `deckSearched`.

`cardsDiscarded` (`{ playerId, count }`) fires once per hand→discard card
(`count` always 1) — a "+X for each card discarded" trigger applies per
event and the total sums (Bewilderbeast). `blockingPartyFormed`
(`{ playerId, blockerCount }`) fires once for the whole declared blocking
party, `playerId` = the defender (Microdefense Autosystem).

`cardsDrawn` (`{ playerId, count }`) fires once per completed draw batch
(the whole `draw N` at once, not per card) — "When a player draws any
number of cards" (Meat of the Mountain). Gate with `eventPlayerIs`.

`deckSearched` (`{ playerId }`) fires when a `chooserSelectsTarget` effect
raises a pick whose declaration selector names the `deck` zone — `playerId`
is the deck's owner. The pick is already the outstanding choice, so a
trigger on this event resolves right after the search completes ("If a
player would search their deck ..." — Golden Charm). Only
`chooserSelectsTarget`-based deck picks emit it.

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
| `oneOf` | `options: Cost[][]` | "Pay 1 **or** destroy a Micromajig token" — the engine auto-pays the first fully-payable branch (no player choice yet). Time Traveler Tourist Trap. |

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
`inBattle`, `sourceIsDamageSource`, `cardMovedFromZone`, `cardMovedToZone`,
`battleRole`, `eventPlayerIs`, `targetInSelection`, `eventOrdinal`,
`deploySameNameThisTurn`, `respondingTo`, `respondedToPicked`,
`deployedViaFlipUp`, `cardNameEquals`, `bottomedInMulligan`, `cardProvides`,
`isStaple`, `cardDepleted`, `cardTypeEquals`.

- **`cardProvides`** — `{ target, icon, min }` — true when `target`'s
  current resource icons (`getResourceIcons` — face-up printed icons, a
  `PROVIDES:` line, or Volition for a face-down card) include ≥ `min` of
  `icon`. "A card that provides at least [O]" — bind `target` to
  `"eventCard"` on a `resourcePlayed` or `cardEnteredPlay` trigger. Note a
  face-down obsession resource provides *Volition*, not [O], so it doesn't
  match `icon: "obsession"` (RULES.md §3).
- **`isStaple`** — `{ target }` — `target` is a staple resource. Pairs
  with `CardSelector.staple: true` ("...and it is a staple resource").
- **`cardDepleted`** — `{ target? }` (default `"source"`) — `target` is
  depleted. "At the end of your turn, if this card is depleted, ..."
- **`cardTypeEquals`** — `{ target, other }` — both resolve to cards of
  the same `CardType`. "A card of the same type as the discarded card."
- **`sourceIsFaceDown`** — the ability's `source` is a face-down card in
  play. Pair with `ActivatedAbility.fromFaceDown: true` ("use this only
  while this card is a face-down resource"; Fired Hand, Vorpal Sword).
- **`isExtremum`** — `{ target, metric: "cost" | Stat, direction: "min" |
  "max", among }` — no card in `among` has a strictly lower/higher
  `metric` than `target`. "The character with the lowest numeric cost"
  (`count: 1` declaration + this in `selector.conditions`, `target` bound
  to `__candidate`). Ties: every extremum qualifies, so the controller
  picks. Verrucose Brains.
- **`linkedCardInPlay`** — `{ key }` — the card `source` remembered under
  `key` (`rememberTarget`) is still in play. Conscientious Objector.
- **`sharesBattlePartyWithSource`** — `{ target }` — `target` and the
  ability's `source` are both in the current battle on the same side.
  Used inside a `damageModifiers` selector's `conditions` with `target`
  bound to `__candidate`. "a character in a party with this card"
  (Necromantic Healer).
- **`cardProvides` / `respondingTo`** — `respondingTo` gains
  `respondsTo: "ability"` for "in response to an ability" (Cock Block).
- **`respondedToPicked`** — `{ cardType }` — true while responding to a
  card/ability whose stored selections (`StackItem.context.selected`)
  include an in-play card of `cardType`; it "picked a `<cardType>` as an
  extra cost." Gates Mistaken Identity's EXTRA COST; pairs with the
  `retargetExtraCost` effect. See RULES.md §7.

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
`reduceNextCost`, `deployForFree`, `distributeAmong`, `flipFaceDown`,
`putIntoPlay`.

- **`flipFaceDown`** — `{ target }` — "flip `target` face-down under its
  owner's control." Per RULES.md §2 the flip is a *leaves-play +
  enters-play* boundary: damage, counters, attachments, temporary
  modifiers/keywords/restrictions and named values are all wiped, control
  reverts to the owner, and it becomes an anonymous face-down resource
  (Volition). "Leaves play" triggers fire. No-op if `target` isn't in
  play. Also the "if this would be destroyed, flip it face-down instead"
  replacement — a `ReplacementAbility` with `replaces: { event:
  "destroy" }` and `effects: [{ "type": "flipFaceDown", "target": {
  "type": "selected", "id": "__candidate" } }]` (`optional: true` for
  "you may").
- **`putIntoPlay`** — `{ target, controller, faceDown? }` — move a card
  from deck / discard / void **into play** under `controller`, as its real
  type with the normal entrance bookkeeping (`cardEnteredPlay`, the
  `attachTo` requirement drawn from the same `context.selected`, attack
  eligibility). `faceDown: true` → it enters as an anonymous face-down
  resource instead (no ETB). "Put the card into play under your control
  [as a face-down resource]."
- **`deployFromZone`** — `{ player, target, ignoreThreshold? }` — "you may
  deploy the &lt;card&gt;": deploy `target` (a card *not* in hand — a
  face-down permanent/tactic in play, or a card in the discard pile) as its
  real type, waiving only its numeric cost. Pauses on a `deployForFree`
  pending choice so `player` can supply the sub-card's own EXTRA COST picks
  (or decline). Threshold + non-numeric extra costs still apply — unless
  `ignoreThreshold: true` ("deploy it for free even if you cannot meet its
  threshold"; I Drink Your Milkshake!). Flipping a face-down source face-up
  fires its leaves-play triggers (RULES.md §2). Wrap in `mayPay` (empty
  `costs`) if the "you may" needs an explicit yes/no before the pick, but
  the choice itself is already declinable.
- **`grantResourceIcons`** — `{ player, icon, amount, duration }` — adds
  `amount` phantom `icon` resource-icons to `player`'s threshold count for
  `duration`. "This turn, you control an additional [E][E][E][E]." (31337!).
- **`detach`** — `{ target }` — clears `target`'s `attachedTo` (a resource
  stops being attached to a faction; an "Attach to X" item is left
  unattached and cleaned up by the state-based check).
- **`scheduleEffect`** — `{ when: "startOfNextTurn" | "endOfTurn",
  condition?, effects }` — registers a one-shot delayed effect, fired at
  that moment (with the source/controller captured) then discarded.
  `endOfTurn` fires as the current turn ends; `startOfNextTurn` at the
  start of the source controller's *next* turn. `condition` is re-checked
  at fire time ("if this card is in play"). Keep `effects` self-resolving
  — a chooser pause inside a scheduled effect is not supported.
- **`useAnyAbility`** — `{ chooser, selector? }` — "you may use an
  ability": pauses for `chooser` to pick one of their in-play cards
  (matching `selector`, default any card they control with an activated
  ability), then a follow-up `useTargetAbility` choice for that card's
  abilities. The Poshernacle.
- **`preventDamage`** — `{ target, amount, mode: "reduce" | "redirect",
  redirectTo? }` — a runtime damage shield on `target`, consumed as damage
  is inflicted this turn (expires next start-of-turn). `reduce` absorbs up
  to `amount` (Tiny Shiny). `redirect` sends up to `amount` of the next
  damage to `redirectTo` instead, raw (Delectable Boon).
- **`rememberTarget`** — `{ key, target }` — store `target`'s id on
  `source`'s `linkedTargets[key]` (cleared on leaving play). Read back via
  the `{ type: "remembered", key }` TargetRef or `linkedCardInPlay`
  condition. Conscientious Objector's "while the picked location is in
  play."
- **`duplicate`** — `{ target }` — "Duplicate the tactic": resolve a copy
  of `target` (a tactic on the response stack) under the current
  controller, reusing the original's selections. Muddle.
- **`setCardType`** — `{ target, cardType, grantStats?, duration }` — "this
  turn, the item is a golem character ..." (Contrabulous Fabtraption, RUNE
  OF ANIMATION). For `duration`, ADDS `cardType` to `target` — it keeps its
  printed type too (CR §208.1). `hasCardType` / `getCardTypes` and
  everything keyed off them (typed selectors match either type, the
  lethal-damage / attach-to state-based checks, battle legality, mid-battle
  §208.4 removal, `cardTypeIs`, start-of-turn damage-clear + attack
  eligibility). `grantStats` (a partial `Stat → NumberExpression`
  map) become `set` modifiers with the same duration. Losing the character
  type forgets this-turn damage (CR §208.3). See RULES.md §3.7.
- **`retargetExtraCost`** — `{ cardType, to }` — "its effect happens as
  though your opponent had picked the other character instead" (Mistaken
  Identity). Rewrites the responded-to stack item's stored EXTRA-COST pick:
  the in-play card of `cardType` it selected is swapped for `to` everywhere
  it appears under that item's `context.selected`. No-op if there's no
  responded-to item, it holds no such pick, or `to` is that same card.
  Gate the response with the `respondedToPicked` condition. See RULES.md §7.
- **`partitionAndPick`** — `{ count, piles, compareBy: "cost", winnerTakes }`
  — the MUSTACHE SHOWDOWN primitive (Mustache Aficionado); see the "Chooser"
  effects section below and RULES.md §12.
- **`mill`** now takes `to?: "discard" | "removed"` (default `"discard"`).
- **`terminate`** gains `scope: "respondedItem"` — terminate the newest
  unresolved non-self stack item, card **or** ability ("Terminate the
  ability"; Cock Block).

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
  `player` need not be the ability's controller — "that player may pay 2"
  (`player: { "type": "controllerOf", ... }`), "any opponent may pay 3"
  (`player: "opponent"`) — and the payment comes from *their* resources,
  while `effects` / `elseEffects` still resolve under the ability's
  controller. "EXTRA COST: that player may pay N ... then terminate this
  card" is a `mayPay` whose `elseEffects` are the card's real body and whose
  `effects` are the peek (Study Disturbance, Tedious TriAdic Truculence).
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
`reduceNextCost`, `deployForFree`, `distributeAmong`, and `partitionAndPick`
all pause the current ability's effect list the moment they're reached, set
`state.pendingChoice`, and resume the remaining effects only once that
choice (or, for `partitionAndPick`, the whole `partitionCards` → `pickPile`
→ `takeFromPile` sequence) is answered (`resolvePendingChoice`) — this is transparent to
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
- **`lookAndReorder`** — `{ player, count, to?, chooser? }` — pauses for
  `chooser` (default = `player`) to reorder the top `count` cards of
  `player`'s deck ("look at the top N cards... put them back in any order");
  reorders whatever's there if the deck is shorter. `to: "bottom"` instead
  relocates those top `count` cards to the **bottom** of the deck in the
  chosen order ("...put the remaining cards on the bottom of their deck in
  any order" — Rosy Palmer); default `"top"` leaves them on top. Set
  `chooser` for "any opponent looks at the top 3 cards of *your* deck and
  puts them back in any order" (Tedious TriAdic Truculence).
- **`reduceNextCost`** — `{ player, amount, cardType? }` — reduces the
  numeric cost of the next card `player` deploys this turn by `amount`
  (floored at 0), consumed by exactly one subsequent `playCard`; unused
  reductions expire at end of turn. With `cardType`, only a play of that
  type benefits from and consumes it ("the next CHARACTER you play" —
  Imperial Army's develop rule, via `FactionDefinition.turn.startOfTurnEffects`).
  Not itself a pause point.
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
- **`partitionAndPick`** — `{ count, piles, compareBy: "cost", winnerTakes }`
  — the MUSTACHE SHOWDOWN primitive (Mustache Aficionado). Drives a
  three-stage per-player pause: `partitionCards` (split your revealed
  top-`count` into `piles` non-empty groups) → `pickPile` (choose one of
  the *other* player's piles) → `takeFromPile` (higher total-`cost` pile's
  owner may move up to `winnerTakes` of its cards to hand; a tie skips
  this). Un-taken cards stay on top of their owner's deck; both decks are
  reshuffled at the end. In-flight state lives on `GameState.pendingPartition`.
  See RULES.md §12.

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
- **`{ type: "remembered", key }`** — a card `source` earlier remembered
  under `key` (`rememberTarget`); `undefined` if none / it left play.

`NumberExpression` also has **`{ type: "conditional", if, then, else }`** —
`then` when the `Condition` holds, else `else`.

```ts
CardSelector = { controller?, owner?, zone?, type?, name?, subtype?, depleted?, fromTop?, conditions? }
```

**`name`** — exact printed-name match (`CardDefinition.name`). "Search your
deck for a card named Elitism" (`{ "zone": "deck", "name": "Elitism" }`),
"a card named Micromajig". Distinct from the `cardNameEquals` *condition*,
which compares two cards rather than a literal.

**`fromTop`** — a number: restrict to cards currently within the top N of
their owner's deck. "Reveal the top 5 cards of an opponent's deck. You may
choose a revealed character." is `{ "owner": "opponent", "zone": "deck",
"type": "character", "fromTop": 5 }`. Pair with a `lookAndReorder`
(`to: "bottom"`, `count` = N minus whatever was taken) to bottom the
leftovers (Rosy Palmer).

**No implicit zone.** A selector with no `zone` matches *every* zone,
including `deck`/`hand`/`removed` (RULES.md §2, deliberate). Always set
`zone: "play"` explicitly for "pick a character/item/location" — omitting it
is a silent correctness bug, not a convenience default.

**`staple`** — `true` matches only staple resources
(`ResourceDefinition.staple`), `false` only non-staples. "Search your deck
for a staple resource" (`{ "zone": "deck", "type": "resource", "staple":
true }`). A `type: "resource"` selector matches real resource *cards* in any
named zone (not just face-down cards in play), so a deck/discard resource
search works directly.

**`faceDown`** — `true` matches only face-down in-play cards, and a `type`
filter is then matched against the card's **real (hidden)** `definition.type`
— "reveal a face-down tactic/item/location/character you control"
(`{ "controller": "self", "zone": "play", "type": "tactic", "faceDown": true }`).
`false` excludes face-down cards. Omitted — the default: `type: "resource"`
still matches a face-down card as an anonymous resource; any other `type`
filter skips face-down cards.

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
        | "cannotBeBlocked" | "canBlockCovert" | "canBlockAnyParty"
Restriction = "cannotAttack" | "cannotBlock" | "mustAttack" | "mustBlock"
            | "cannotBeRestored" | "cannotBeRestoredByRule" | "cannotBePicked"
            | "attackOncePerTurn" | "cannotBeTakenControl"
            | "mustBePicked" | "cannotUseAbilities"
```

`canBlockCovert` — "can block COVERT parties" (Recyclable Golem): counts as
Covert for *blocking* an all-Covert attacking party only. `canBlockAnyParty`
— that, plus exempt from "a COVERT character may block only a COVERT party"
(Guardbeast of Thabbash). `cannotBeBlocked` — "unblockable" (Uncontrollable
Jalopy). `cannotBeRestored` — the faction Restore Rule skips it (aura form
of `restoreLocked`; Framptle). `mustBePicked` — a target declaration whose
legal pool contains any `mustBePicked` card narrows to just those (Ferret
Oil Coating). `cannotUseAbilities` — that card's *activated* abilities can't
be used (0v3rw0rk3d 31f, aura over locations).

**`ContinuousAbility.suppressKeywords`** — `KeywordGrantDefinition[]`,
parallel to `.keywords` but *removes* the keyword while `condition` holds
("it loses COVERT while there is a token on this card"; Nattering
Stoopswaggler). Beats every grant, printed or otherwise.

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

## Faction cards (`FactionDefinition`)

A faction card's mechanical text lives in `CardDefinition.faction`, not
`behavior`. Beyond `startingInfluence` / `setup` / `turn.{restore,develop}`:

- **`abilities`** — `ActivatedAbility[]` printed on the faction card,
  activated via `activateAbility` with the faction card's id (RULES.md
  §3.6). Same shape as any activated ability; `usableBy: "anyPlayer"` opens
  it to the opponent too.
- **`meetsAllThresholds`** — the controller auto-satisfies every threshold
  (The Evil Alliance — OMNIPOTENCE).
- **`turn.startOfTurnEffects`** — `Effect[]` run automatically at the start
  of the faction's controller's turn (source = the faction card). Imperial
  Army's develop rule is `[{ "type": "reduceNextCost", "player":
  "controller", "amount": 2, "cardType": "character" }]`.
- **`turn.develop.usesPerTurn`** — Develop Rule uses per turn (default 1;
  "OVERTIME" = 2).
- **`overridesOpponent`** — `{ startingDraw?, suppressDevelop? }` — while
  this faction card is in play it rewrites the **opponent's** faction:
  `startingDraw` makes the opponent's opening hand use *this* faction's
  `setup.openingHand`; `suppressDevelop` gives the opponent no Develop Rule
  (`getDevelopChoices` → `[]`). The Knitting Coalition (HIDDEN INFLUENCE /
  PULLING STRINGS). 2-player only.
- **`setup.startingResources`** — beyond `{ count, names?, stapleOnly? }`:
  - `slots: [{ kind: "resource", staple?, name? } | { kind: "anyCard" }]`
    — a per-slot program. `"resource"` places a face-up resource;
    `"anyCard"` places any card and flips it face-down if it is not a
    resource ("Any 1 resource, Any 1 card" — The Society of Magical
    Propriety).
  - `chosenStaples: { min, max, plus? }` — X staples (X from
    `FactionGameSetupOptions.startingResourceX`, clamped to `[min, max]`,
    default `min`) plus the named `plus` resources ("...and 1 Deception" —
    The Union of Unextraordinary Miners' MONEY FOR NOTHING).
  - `matchOpponentCount: true` — after both players are set up, top the
    **opponent** up with staples until the counts match.
  As with the flat form the engine picks in deck order — the player does
  not choose which staple / card.
- **`behavior.developDrawReplacement`** (on a non-faction card) —
  `{ cost?, effects }` — while the developing player controls this card in
  play, the `draw` develop option runs a `mayPay` (payer = developer,
  `costs` = `cost`, `effects`, `elseEffects` = the draw) instead of
  drawing. Arcane Escrow — "If you would draw a card as part of your
  Develop Rule, you may put a voided card into hand instead."

## Continuous ability: ignore a card type

- **`ignoresRulesTextFrom: CardType`** on a `ContinuousAbility` (still needs
  `modifiers: []`) — while the source is in play (and `condition` holds) it
  cannot be **picked** by a card of that type, and single-target effects /
  auras whose origin is a card of that type do not affect it (aggregate
  "all X" effects still do). Parkour Hoodlum — "ignores all rules text on
  locations." See RULES.md §3.8.

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
  "parityGaps": ["double-sided-faction"], // (optional) top-level parityGaps ids this card hits
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

Top-level `parityGaps` tracks **printed clauses we deliberately don't
model** because closing them needs a large engine or game-format refactor —
distinct from `capabilities` (small, buildable additions) and
`wontImplement` (the *whole card* is unmodellable). An affected card stays
`verified`/`authored` for its in-scope parts and lists the gap id in its
`parityGaps`. `build-coverage.cjs` renders a "Parity gaps" section in
`COVERAGE.md`; `card-data-integrity.test.ts` checks every entry is
well-formed, every per-card id resolves, and no gap is orphaned.

```jsonc
"parityGaps": {
  "double-sided-faction": {
    "summary": "one line — what the mechanic is",
    "clause": "the exact printed text this covers",
    "needs": "what the refactor would take",
    "scope": "medium" | "large" | "xlarge"
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
