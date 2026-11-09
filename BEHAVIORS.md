# BEHAVIORS.md

Quick reference for authoring `behavior` data on cards in `data/cards/<set id>.json`.
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
  cost modifiers / reductions). Offered as the `resourceReveal` prompt of
  the Develop Rule's `playResource` effect. See RULES.md §6.

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
  `cannotBeTakenControlByOpponent` is the singular "your opponent cannot take
  control of this card": only the opponent the card's controller selected is
  barred. Mountainous Golem (Seed).

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
`inflictedDamageToFactionThisTurn { player, target? }`, `playerInflictedDamageToFactionThisTurn { player, by? }` ("you inflicted damage to an opponent's faction this turn" — Dual Blade Assassin, `player: "opponent"`; `by` defaults to the source's controller. Reads the per-player `GameState.factionDamageInflictedThisTurn` (inflicter -> victims, recorded from `damageDealt` by the source's controller at that moment, cleared each turn), so damage dealt by a token or card that has since left play still counts; use it instead of counting cards with the per-source `inflictedDamageToFactionThisTurn`), `lostInfluenceThisTurn { player }` (the faction has LOST influence so far this turn: damage to it, a negative `modifyInfluence`, an influence cost; counted after `influenceModifiers` and the floor at 0, so a loss reduced to nothing, a gain and `setInfluence` do not count; `GameState.influenceLostThisTurn`, per player, cleared each turn. Shriever General: `{ lostInfluenceThisTurn, player: "opponent" }`).

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
{ source, delta, duration }` (reduces/increases every damage instance whose
dealer is `source`, battle damage included — folded per-contributor into the
locked battle-damage sum), `chooserSelectsNumber { chooser, storeAs,
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
- **`TriggeredAbility.usesPerTurn`** — the triggered parallel: "Once per turn,
  when the attached character attacks, restore it at the end of battle"
  (Fiery Doom Device — `usesPerTurn: 1` with the `characterAttacked` trigger
  and its condition). The trigger fires at most that many times each turn,
  per card and per ability. A use is spent when the trigger is queued, and
  only if the event matched and `condition` held (an event that fails the
  condition costs nothing); it is not given back if the trigger's effects do
  nothing. The count lives in `GameState.abilityUsesThisTurn` under
  `trigger:<cardId>:<abilityId>` (kept apart from an activated ability's
  `<cardId>:<abilityId>`), is cleared every turn, and is cleared when the card
  enters play (a new object). A granted triggered ability counts on the card
  that has it. There is no read-only listing of triggered abilities, so
  `getActivatedAbilityStatuses` / `getAvailableActivatedAbilities` are
  unchanged (their `usesSpent` reason is still `ActivatedAbility.usesPerTurn`
  or a `lockAbilityThisTurn` lock). Tests:
  `src/engine/__tests__/destroyed-this-turn-and-trigger-uses.test.ts`.
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

## Ungodly Mess additions

Condensed index of vocabulary added for the Ungodly Mess set (a Seed-era
set: FLIP UP, RECUR, staple-counting, the FEALTY / God's Blessing / Gosche's
/ Thabbashite cycles). Full detail in `src/types/*` + `COVERAGE.md`.

**Expressions / selectors**
- **`{ type: "distinctCount", selector, by }`** — the number of DISTINCT
  values of `by` (`"name"` / `"trade"` / `"subtype"` / `"type"`) among cards
  matching `selector`. "for each different staple resource you control"
  (`by: "name"`, `selector: { controller: "self", staple: true, type:
  "resource" }`); "different trades among cards you control" (`by: "trade"`).
- **`CardSelector.attachedToFaction?: boolean`** — for `type: "resource"`:
  `true` matches resources attached to a faction (spent to pay a cost this
  turn — "attached", RULES.md §5); `false` matches *detached* / available
  resources. "the number of detached resources that player controls" (Flesh
  Deliquesce — `false`); the pool for "detach up to 2 resources from their
  faction" (`true`).

**CardDefinition**
- **`thresholdSlack: { condition, amount }`** (FEALTY) — while `condition`
  holds (evaluated with the card in hand, controller = its holder),
  `meetsThreshold` for this card is satisfied whenever the holder is at most
  `amount` icons short **summed across every icon type** ("reduce this
  card's threshold requirement by any N resource icons"). Abram Ka-darbo
  Alakazin, Eustace Sensible Glutton, Ignatious, Jo Ciendeilio, Rudo Mangod.

**ContinuousAbility**
- **`grantedAbilities` now also grants CONTINUOUS members** — the continuous
  / restriction / keyword / modifier members of a `grantedAbilities` block
  are honored in the recompute, **sourced on the recipient** (so "All your
  characters gain 1 strength" inside the granted text scopes to the
  recipient's controller, and the aura dies with the recipient or the
  grantor). Model the "God's Blessing of ___" quoted rules text as one
  member per paragraph; the block selector is usually
  `{ conditions: [{ type: "isCard", other: "attachedTo" }] }` ("the attached
  character").
- **`blockRestriction.blockerMustNotMatch?: CardSelector`** — a character
  matching this selector is not a legal blocker against the source. "cannot
  be blocked by characters with a [V] icon in its rules text" (Feckless
  Chronicler — `conditions: [{ type: "textMentionsIcon", icon: "volition"
  }]`); "Characters with a token on them cannot block this card" (Silencer).
- **`voidPlay: { selector, ignoreThreshold? }`** — while the source is in
  play and `condition` holds, its controller may deploy void-zone cards
  matching `selector` as though from hand. The conditional/continuous form
  of the one-shot `grantVoidPlay`. "While this card is depleted, you may
  deploy tactics in the void ..." (Voidal Tactician — `condition:
  { type: "cardDepleted", target: "source" }`).
- **`playRestrictions: [{ player, kind, timing? }]`** — a standing "you may
  not play X" while the source is in play. `kind: "flipUp"` or
  `kind: { cardType }`; `timing: "notActivePlayer"` narrows it to "only
  while `player` is not the active player". "Your opponents cannot use FLIP
  UP" (Lockbox of the Aeons); "opponents may only play tactics during their
  own turn" (Geldale, City-Fortress).
- **`restrictReturnToHand: { player, fromZones }`** — while the source is in
  play, a card owned by `player` cannot be moved to a hand from any zone in
  `fromZones` (the move fizzles). "cards cannot be put into your opponents'
  hands from the void, discard pile or play" (Lockbox of the Aeons).
- **`destroysSource: true`** — while `condition` holds, the source card is
  destroyed by the state-based check (also on entering play with it already
  true). The "[R][R][R]: Destroy this card." threshold paragraph (Boorish
  Boar — `condition` is `meetsThreshold`). A threshold paragraph (CR
  §201.5d / §405.4) is always a gated continuous / triggered ability (or a
  `modes[]` entry), never a cost-free activated one.

**Effects**
- **`{ type: "preventAllDamage", duration }`** — opens a window during which
  every damage instance (any card, any source, battle or not) is reduced to
  0. "all inflicted damage is reduced to 0" (Limited Liability).
- **`{ type: "restrictDestruction", duration }`** — opens a window during
  which the `destroy` **effect** is inert (a `destroy` COST, lethal-damage
  SBA and `removeFromGame` still work). "cards ... can only be destroyed by
  costs" (Limited Liability).

**End of turn / decking**
- **`{ type: "endOfTurnDeclared", player? }`** (condition) — the player's
  announced end of turn is pending (an open `endTurn` window, or a battle
  started inside one). "Play only on your turn, after you have declared the
  end of your turn" (Lost on Floor 3).
- **`{ type: "terminateEndOfTurn" }`** (effect) — cancels the controller's
  pending end-of-turn announcement; the turn goes on once the chain
  resolves. "Terminate your end of turn declaration" (Lost on Floor 3).
- **`ContinuousAbility.millInsteadOfFactionDamage: true`** — damage the
  controller would inflict to an opponent's faction pauses on a
  `millInsteadOfDamage` choice: any part of it (up to the cards in that
  deck) becomes cards put from the top of the faction owner's deck into
  their discard pile (Trickster's Globe).
- **`ContinuousAbility.emptyDeckLoses: true`** — a player with an empty deck
  loses in the state-based victory check (Trickster's Globe).

## Open Beta additions

Condensed index of vocabulary added for the Open Beta set (the oldest set —
mechanically simple but full of quirky one-offs). 19 capabilities; full
detail in `src/types/*` + `COVERAGE.md`'s capability table.

**Expressions / selectors**
- **`{ type: "eventDrawAmount" }`** — the `count` of the current `cardsDrawn`
  event (0 outside one). Parallel to `eventDamageAmount`. Gold Summit.
- **`{ type: "deploysThisTurn", player?, cardType?, notCardType? }`** — how
  many cards matching the filters `player` (omitted = anyone) deployed this
  turn. "2 other non-resource cards this turn" (633fy 31f), "an opponent
  deployed a character this turn" (Slingerang), "a tactic has been deployed
  this turn" (Voidal Replication).
- **`{ type: "destroyedThisTurn", player?, cardType? }`** — how many
  face-up cards were destroyed so far this turn (`GameState.turnDestroyed`,
  cleared at each turn start), by any cause, filtered to a card type
  (`cardType`, matched against every type the card had when it died) and/or
  to the cards `player` controlled when they were destroyed (omitted = both
  sides). It reads history, so cards that died before the reader entered
  play or was flipped up count. A destroy a replacement redirected does not
  count, nor does a face-down card (CR 411.1), nor an attachment that only
  followed its host out of play (CR 301.4a); a destroyed token does. "X is the
  number of characters that were destroyed this turn. Each faction loses X
  influence" (Tempered Rage): `flipFaceUp`, then `forEachPlayer` ->
  `modifyInfluence` by `multiply [ {destroyedThisTurn, cardType: character},
  -1 ]` (X is the same for both factions: no destroy happens in between).
- **`{ type: "factionStartingInfluence", player }`** and the effect **`{ type: "setInfluence", player, amount }`** — "set your influence to your faction's starting influence" (Siluriformes Incarnate): `setInfluence` of `factionStartingInfluence`. The expression reads the starting influence printed on the faction side currently face up (CR 202.3a; a flipped double-sided faction reads its other side). `setInfluence` makes the influence exactly `amount` (floor 0, CR 410.4); it is neither a gain nor a loss, so `influenceModifiers` do not touch it and it never feeds `lostInfluenceThisTurn`; `influenceChanged` reports the difference.
- **`CardSelector.fromTop` may be a `NumberExpression`** — "reveal up to the
  top X cards of an opponent's deck" with a chosen X (Jackmove).
- **`TargetRef { type: "lastDeployedTactic" }`** — the most recently
  RESOLVED tactic this turn (`GameState.lastDeployedTacticId`). Pass to
  `duplicate`, which re-resolves it from its definition (it is off the
  stack, so it chooses targets anew). Voidal Replication.

**Conditions**
- **`{ type: "attackedThisTurn", target? }`** — `target` (default `source`)
  declared an attack this turn. `not` → "did not attack this turn" (Reckless
  Challenger).
- **`damagedThisTurn` gains `by: "any"`** — damaged by ANY source this turn
  ("if the character has received damage this turn"; Snake Eyes).

**Effects**
- **`{ type: "grantSubtype", target, subtype, duration }`** — adds a subtype
  (`GameState.subtypeGrants`, read by `getSubtypes` → every subtype
  consumer). Sarcophyle Matriculation, Vander Malagut.
- **`{ type: "redirectHandMoves", who, to, duration }`** — a runtime window:
  a card that would enter a hand from ANY zone goes to `to` (the owner's
  zone) instead. "if a card would be put into a player's hand, put it into
  their discard pile instead" (Quotidian Misfire). Distinct from a
  `moveToZone` `ReplacementAbility` (fires only on leaving *play*).
- **`{ type: "installReplacement", replaces, condition?, duration, effects }`**
  — the one-shot form of a `ReplacementAbility`: registers a runtime
  replacement (`GameState.runtimeReplacements`) consulted by
  `applyReplacement`. The affected card binds to `__candidate`; the
  installing ability's `context.selected` is snapshotted so
  `condition`/`effects` referencing its picks still resolve. `duration`
  accepts `{ type: "endOfBattle" }`. "if the character would be destroyed
  during this battle, take control of it instead" (Sarcophyle Matriculation).
  A `destroy` form is scoped like a card's own `ReplacementAbility`:
  `controlledBy` (whose card, relative to the installer), `by` (who caused
  it: the controller of the resolving effect or of the character that dealt
  the lethal damage, so battle damage counts; the game rules, a cause no
  player has, match neither `"self"` nor `"opponent"`) and `bySource` (a
  `CardSelector` for the originating card; never battle damage). An empty
  `effects` list means the destruction simply does not happen. "This turn,
  characters you control cannot be destroyed by cards or abilities your
  opponents control" (Escort Ally): `replaces: { event: "destroy", cardType:
  "character", controlledBy: "self", by: "opponent" }, duration:
  untilEndOfTurn, effects: []`. Use this, not `restrictDestruction`, when
  the protection must not stop the controller's own destroys. A destroy paid
  as a cost is never replaced (CR 506.2). Tests:
  `__tests__/destroy-cause-scope.test.ts`.
- **`forEach` gains `sequential?: boolean`** — `true` runs iterations one at
  a time through the suspendable effect-frame path (per-iteration chooser
  pauses / resumes; triggers fire between iterations). "That player discards
  a card. You may deploy a card for free. Repeat until ... no cards in
  hand" (Degenerate Molestation — `forEach` over the opponent's hand
  snapshot). Default (`false`) keeps the batched "simultaneous" loop.
- **`{ type: "spendCountersMenu", chooser, pool, counter, options }`** —
  `chooser` repeatedly removes `cost` markers of `counter` from `pool`
  cards (their choice which) to fire an option's `effects`, any mix, until
  they stop (`optionIndex: null`) or can't afford any option. Drives a
  `spendCountersMenu` PendingChoice. Voidal Poisoning (RULES.md §14).

**ContinuousAbility**
- **`preventsDefeat: { player }`** — suppresses the "faction at ≤0 influence
  loses" state-based check for the matching faction. "You do not lose the
  game because your faction has 0 influence" (Armored Keep).
- **`drawModifiers: [{ player, delta?, prevent? }]`** — consulted in
  `drawCards` (only for a real draw, amount > 0): `delta` adjusts the count,
  `prevent` forces it to 0. Beatrix Winterbottom ("+1 to every draw" +
  "while ≥10 cards in hand, cannot draw").
- **`influenceModifiers: [{ player, direction, delta, minAmount? }]`** —
  tunes influence-change magnitude, floored so a loss can't flip to a gain.
  Routed through `applyInfluenceDelta` (covers the `modifyInfluence` effect
  and CR §408.3 damage→influence; NOT the `loseInfluence` cost — a cost is a
  cost). Tax Attorney.
- **`attackTax: { player, amount }`** — the matching player pays `amount`
  resources when they declare an attack (charged in `declareAttack`; an
  unpayable tax makes the attack illegal). The Ministry of Other Smaller
  Ministries.
- **`canUseOpponentAbilities: boolean | "asOpponent"`** — the source's
  controller may activate activated abilities on cards the opponent
  controls; everything resolves with the opponent as the ability's controller
  (`ResolutionContext.controllerId`). `true`: the numeric (`payResources`)
  cost is charged to the activator (The Billionaire, 2nd Edition).
  `"asOpponent"`: every cost, numeric included, is paid by the opponent
  (The Billionaire, 1st Edition and Open Beta).
- **`partyRestriction` gains `maxMembers?` and `scope: "selfParty" |
  "allParties"`** — `"allParties"` bites every forming party regardless of
  whether the source is a member (a location dictating party composition —
  Arcana Department, Hangdog Alley).
- **`playRestrictions[].kind` gains `{ named: string }`** — no player may
  deploy a card whose name equals the `nameValue` (`valueKind: "cardName"`)
  stored on the source under that key. Incriminating Photograph.

**Events**
- **`cardPicked { cardId, playerId }`** — an in-play card was chosen as the
  target of a `chooserSelectsTarget` effect (NOT a triggered ability's own
  `targets` — re-entrant `emit` there would double-resolve the trigger).
  "When this card is picked, put a token on it" (Ferrous Ferret); pairs
  with the `mustBePicked` restriction.

**ContinuousAbility (seat swap)**
- **`swapsSides: true`** — while an odd number of live sources are in play,
  the players switch seats: control of every card in play (both factions
  included) passes to the other player and they exchange `factionId` /
  `influence`. Hands, decks and discard piles stay with their owners; the
  faction's owner loses at 0 influence. `GameState.seatSwap` holds the
  exchanged cards so lifting it can undo exactly that; `seatsSwapped` event;
  `GameFlowView.seatsSwapped`. Emergency Obfuscation (RULES.md §12 "Seat
  swap").

## 1st Edition additions

1st Edition is 144/162 exact reprints of already-`verified` Open Beta cards
(same name + text — the authored `behavior` is copied verbatim). Only 18
cards are novel; they need 2 capabilities.

- **`{ type: "restrictParty", target?, role, minMembers?, maxMembers?,
  parity?, duration }`** — the "this turn" form of
  `ContinuousAbility.partyRestriction` (parallel to `restrictBlockers` vs
  `blockRestriction`). A `GameState.partyRestrictionGrants` entry checked in
  `assertPartyComposition` against any forming party that includes the
  grant's `target`. Carnival King — CONGA LINE ("when an attacking party is
  formed including the character, it must have only 1 member").
- **`partyRestriction.scope` gains `"attachedParty"`** — the constraint
  bites a forming party that includes the card the source is *attached to*
  (a gear item constraining its host's party). Spiky Atlasphere.

Everything else composes from existing vocab — notable ones: Land Shark
(`count { faceDown: true }`), Samuel Gristwalter (an unconditional all-damage
faction `damageModifiers` ward), A Series of Tubes (`preventDamage`
`mode: "redirect"` + the Basic/Hub-Node cycle), Topplemajig (a live
conditional aura gated on `{ inBattle, target: "source" }` with an
opposing-party selector), Recapitulating Apparition (`cardMoved`
play→discard + `mayPay` + `putIntoPlay` self-recur), Resurrection Emporium
(a `moveToZone` `zone: "discard"` `ReplacementAbility` → `removeFromGame` —
CONCESSION: only fires for a character leaving *play*, not one milled from
the deck), Bask Bomb (two `distributeAmong` steps with different
`chooser`s), Bladefist Doomwing (`FIREBREATHING` X+X).

## Seed additions

Seed is the oldest set — mechanically the simplest, ~95% straight authoring
onto existing vocab. 9 capabilities:

- **`ContinuousAbility.preventsAttackOnFaction: { player }`** — `declareAttack`
  against the matching faction is illegal. High Court of Demands, Theocratic
  Senate of Marduun.
- **`ContinuousAbility.attackLimitPerTurn: NumberExpression`** — per-player
  cap on attack declarations per turn (`GameState.attackDeclarationsThisTurn`).
  Narrow Passage.
- **`ContinuousAbility.mustReceiveBattleDamage: boolean`** — battle-damage
  magnet; `getLegalBattleDamageTargets` narrows to the magnets in the party.
  Courageous Paladin.
- **`ContinuousAbility.searchTax: { player, amount? }`** — pay to search your
  own deck; unaffordable = the search does nothing. Department of Rejections.
- **`abilityCostModifiers` scope `"opponentCharacters"`** — +delta to
  activated-ability `payResources` on the opponent's characters (any zone).
  Department of Rejections.
- **`attackTax` — `player: "activePlayer"`, `requiresAttackerMatch?: CardSelector`**
  — charge whoever attacks, only when the party contains a matching card.
  Auspicious Tax (attached-character attack tax).
- **`{ type: "redirectAttackTarget", to: TargetRef }`** — repoint the
  in-flight `battle.target` at an in-play card + update `defenderPlayerId`.
  Architectural Restitution.
- **`deployForFree.budget: NumberExpression`** — total-cost pool: re-prompt
  after each free deploy until the pool is spent / nothing fits / declined.
  Reality Shift.
- **`{ type: "sumCost", selector }` NumberExpression** — sum of printed
  numeric `cost` over an in-play selector (parallel to `sumStat`). Reality
  Shift ("total numeric cost of all non-resource cards you control").

Concessions: Lucky Charm's pick-tax (unmodelled; ETB draw authored),
Titillating Contortionist's "must block *this*" (generic `mustBlock`), Runic
Battery's "detach up to X resources" (`detach` effect). Icon-gated triggered
abilities ("[R][R][R]: At the start of your turn, ...") are just a
`condition: meetsThreshold("rrr")` — the established Seed 2 idiom (Dwarvish
Grimalkin; it was a `numberCompare(resourceIcons ...)` until OMNIPOTENCE
needed a threshold-aware gate, see `meetsThreshold`). Global covert-block
exception (53cur17y 5y573m) = grant the `canBlockCovert` keyword to a broad
`{ type: "character", controller: "any" }` selector. Tests:
`seed-{caps,smoke,exercise}.test.ts`.

## Fidelity pass (hidden information / reveal)

Closing the "verified ≠ faithful" gap for the reveal / look-at / hidden-info
family. Most such text was already faithful — a "reveal" verb has no
mechanical content in a perfect-information engine (see RULES.md §12
"Fidelity pass"). Six additions + one bug fix, then ~15 cards re-authored:

- **`ContinuousAbility.grantsReveal: { zone: "deckTop" | "hand"; of:
  PlayerRef }`** — populates `GameFlowView.revealed` (`{ deckTop:
  [{playerId, cardId}]; hands: [playerId] }`); renderer-facing only.
  Cheats McGuillicutty, Odious Diva, Axeclaw Grandchest, Bottlebeard.
  (Continuous abilities still carry `modifiers: []` even when empty.)
- **`{ type: "reveal", of, zone: "deckTop" | "hand", count?, viewer? }`** —
  one-shot; emits `cardsRevealed` and nothing else.
- **`{ type: "revealCards", selected?: <declaration id>, selector?:
  CardSelector, target?: TargetRef, viewer? }`** — the "...and reveal it" of a
  search; emits `cardsRevealed` (viewer defaults to everyone) for the picked
  cards, one event per owner + zone. Insert it right before the effect that
  consumes the pick, and only on printings whose printed text says "reveal"
  (non-search reveals are applied by `data/card-audit/other-reveals.patch.cjs`).
  `target` names one card ("reveal this card" from the hand).
- **`moveSelected.reveal: true`** (cost) — the chosen cards are revealed from
  the zone they leave as the cost is paid (Uhluhtc Niudla AVAIL ANEW).
- Engine-emitted reveals needing no card data: a `fromFaceDown` ability
  being used (the face-down source), a `revealFromHand` deploy, Auction
  House's turned-over cards, Mustache Showdown's chosen piles.
- **`{ type: "revealFromTopUntil", player, match: Condition, bindAs,
  onMatch: Effect[], onEmpty?, rest?: "shuffle" | "bottom" | "discard" |
  "void" }`** — dig from the top of a deck until `match` (candidate bound to
  the selector `__candidate`); bind the hit to `bindAs`, run `onMatch`;
  dispose of the other revealed cards per `rest` (default `"shuffle"`).
  Surprise!.
- **`GameEvent cardsRevealed { cardIds, zone, ownerId, viewerId, byCardId?,
  knownToRevealer? }`** — informational. `knownToRevealer: true` means the
  player who caused the reveal already knew every card in it (a search or
  cost pick, their own hand or face-down resource); absent means they learn
  the cards from it (the top of a deck, an opponent's hand).
- **`GameEvent cardsMulliganed { playerId, cardIds }`** — a player's opening
  mulligan put `cardIds` on the bottom of their deck, before the replacements
  are drawn. Community Chest's `triggerZone: "deck"` reveal keys off it.
- **`{ type: "targetOwnedBy", target?, player }` condition** — candidate
  (or `target`, default `__candidate`) is owned by the resolved player.
  A Death Fit for a King ("a UNIQUE character in play OR a character in an
  *opponent's* discard").
- **`GameFlowView.revealed`** — new required field on the flow view.
- **Bug fix — `moveCard` same-zone deck reposition.** "Put the top card of
  your deck on the bottom" no-op'd (`from === to` early return); now
  repositions within `owner.deck` when both zones are the deck. Fixes
  Cheats McGuillicutty BOTTOM DEAL, Bottlebeard CHUG!, Flimflam Man,
  Opportune Slotpuller, Dauntless Gambler, Rigged Tables RIG.

Re-authored onto existing vocab (no engine change): Intellectual Reliquary
(`fromTop` target + conditional `lookAndReorder` count), Gilda `peek`,
Warmachine Smelder LIFE'S WORK (`chooserSelectsOption` deploy/hand),
Ecto-Distillation (opponent moves exactly its picks), Eccentric Inquisition
(`count: { type: "count" }` forces all revealed tactics), Confessions
(already `to: "split"` — un-flagged).

`fidelity: full | partial | stub` per coverage entry → generated
`data/card-fidelity.json` → `CARD_FIDELITY` on the `"./data"` export.
`partial` (3): Gilda SUMMONS scope; Study Disturbance / Tedious TriAdic
Truculence pre-stack buyout timing. `stub`: none (Lost on Floor 3 and
Trickster's Globe were implemented 2026-10-26).
Tests: `fidelity-fixes.test.ts`.

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

**`TriggeredAbility.triggerFromAnyZone`** — the trigger is live wherever its
source card is, for a lasting effect the card creates when it resolves ("For
the rest of the game, if your opponent plays a card, you may reveal the removed
card ..." — I Drink Your Milkshake!, Seed 2). Tie it to what the card did with
`CardSelector.voidedBySource` (`zone: "void"` or `"removed"`; `moveCard` records
`CardInstance.voidedBy`), not to the card's current zone.

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
condition fires when *any* card enters play, other than its own source.
A `cardEnteredPlay` trigger fires for its own source's entry **only** when
its condition contains `sourceIsEventCard` (RULES.md, user ruling
2026-10-27: "when a card ... enters play" needs its source already in play).

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
| `oneOf` | `options: Cost[][]`, `labels?: string[]` | "Pay 1 **or** destroy a Micromajig token" — when 2+ branches are payable the payer is asked which (a `chooserSelectsOption` with `resumeAction`; `labels` names the branches, e.g. "Choose a card type" is six branches that each `bindVariable` the choice). With nobody to ask, the first payable branch. Time Traveler Tourist Trap. |
| `pick` | `declarationId` | positions a `targets` pick in the written cost order: judged after the cost steps before it (Q15). See "E3 cost model" below. |
| `bindVariable` | `id`, `value` | "X is the picked character's strength" — evaluated when the cost is paid and locked into `variables[id]` (Q8). |
| `effects` | `effects` | ordinary effects run as a cost step (coin, reveal, token, draw, move to the void, flip face-down …); they must not ask a question. |
| `nameValue` | `valueKind`, `storeAs` | "Name a card" as a cost; the answer arrives as `action.named[storeAs]` or through a `nameValue` prompt that re-runs the action. |

**Activating from another zone** — an `ActivatedAbility` may set
`activationZone: "discard" | "hand" | "void"` (default `"play"`) to be used
while the source sits there (RECUR / RETIRE / EXHUME). `condition` still
carries any finer gate; costs/targets/effects work as normal with
`context.sourceId` pointing at the out-of-play card.

All costs in an ability must be payable in written order (`costProblem`
rehearses them on a cloned state) — no partial payment; the numeric
`payResources` is always paid last. See "E3 cost model" at the end of this file.

## Conditions (`src/types/conditions.ts`)

`and`, `or`, `not`, `sourceInZone`, `sourceIsEventCard`,
`eventCardControlledBy`, `targetExists`, `cardTypeIs`, `cardTradeIs`,
`hasUnique`, `hasAbility`, `statCompare`, `counterCompare`, `numberCompare`,
`inBattle`, `sourceIsDamageSource`, `cardMovedFromZone`, `cardMovedToZone`,
`battleRole`, `eventPlayerIs`, `targetInSelection`, `eventOrdinal`,
`deploySameNameThisTurn`, `respondingTo`, `respondedToPicked`,
`deployedViaFlipUp`, `cardNameEquals`, `bottomedInMulligan`, `cardProvides`,
`isStaple`, `cardDepleted`, `cardTypeEquals`, `meetsThreshold`.

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
- **`meetsThreshold`** — `{ threshold, player? }` (`player` defaults to
  `"controller"`), true while that player MEETS `threshold` (icon-letter
  shorthand, `"rrr"`, `"oovv"`): the gate of a paragraph that begins with
  threshold icons ("[R][R][R]: This card gains 3 life.", CR §405.4). Met by
  holding at least that many of every icon (`getThresholds`) OR by the
  player's faction having `meetsAllThresholds` (OMNIPOTENCE). Never use a
  `numberCompare(resourceIcons ...)` for a printed threshold paragraph: that
  reads real icons only and stays off for OMNIPOTENCE. `reduceThreshold` and
  FEALTY slack are deploy-only and do not apply. The catalog guard in
  `omnipotence-thresholds.test.ts` ties each printing's `meetsThreshold`
  gates to its printed leading-icon paragraphs.
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
  the choice itself is already declinable. `cost: <NumberExpression>` =
  "deploy it for N": a flat alternative numeric cost replacing the printed
  one (reductions bypassed), paid only if the deploy happens — declining the
  pending choice or an unmet threshold costs nothing (Mindrender: `mayPay`
  with empty `costs` for the free reveal, then `deployFromZone { cost: 1 }`).
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
- **`repeatWhile`** — `{ condition, effects, maxPasses? }` — "repeat this
  until <not condition>" (Degenerate Molestation: repeat until the
  opponent's hand is empty). The condition is judged before every pass, on
  the board as it is now (a `forEach` over a selector is a snapshot and
  cannot see a card that enters the hand mid-loop). Nested choosers pause
  the loop and it resumes after the answer; each pass has its own pick scope
  (`selected` entries made inside a pass are gone for the next). `maxPasses`
  (default 1000) is a loop guard that throws instead of hanging.
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
  `EffectOption.condition` makes a branch unavailable while it fails (Meat of
  the Mountain's "remove a token" with no token): the pending choice lists it
  in `unavailableOptions` and answering with it is refused.
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
  `player` controls in play (`getThresholds`). The REAL count: OMNIPOTENCE
  does not inflate it. Right for "X is the number of [O] you control" and
  an inline "if you control at least [X][X]" (`numberCompare` it against a
  literal); a printed threshold paragraph uses the `meetsThreshold`
  condition instead.

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

**`minCount?: NumberExpression` (EU1) — "none, or at least N".** `TargetDeclaration`
may carry a lower bound for a non-empty pick. With `optional: true` the legal
sizes are *none, or `minCount`..`count`*: `{ count: 3, optional: true, minCount: 3 }`
is "You may deplete 3 Micromajig tokens" (0 or exactly 3; 1 or 2 are refused,
nothing is paid). Without `optional`, `minCount` is just the floor in place of
`count` ("pick 2 to 4"). It is floored at 0 and capped at `count`; an
expression is evaluated like `count`. It is enforced wherever picks are
judged: `playCard` / `activateAbility` (`pickRange`), a triggered ability's
`selectTargets`, a deploy's `selectDeployTargets`, and `chooserSelectsTarget`.
Fewer candidates than `minCount` on an optional pick leaves only "none", so
the query lists no step and nobody is asked. A `mustBePicked` card on offer
(Q19) still makes the pick mandatory (`min` at least 1, no `orNone`).
The client queries report it: `PickStep.min` / `max` are the non-empty bounds
and **`PickStep.orNone: true`** says an empty answer is also legal although
`min` is above 0 (`forced` is then false). `checkSelection` /
`checkPlaySelection` follow the same rule. Pair it with `selfDisposition` /
`if` conditions on `selectionCount` for "if you did, ..." riders (Micromajig Party).

## Keywords / Restrictions (`src/types/ids.ts`)

```ts
Keyword = "tactical" | "aggro" | "covert" | "redirectDamage"
        | "cannotBeBlocked" | "canBlockCovert" | "canBlockAnyParty"
Restriction = "cannotAttack" | "cannotBlock" | "mustAttack" | "mustBlock"
            | "cannotBeRestored" | "cannotBeRestoredByRule" | "cannotBePicked"
            | "attackOncePerTurn" | "cannotBeTakenControl" | "cannotBeTakenControlByOpponent"
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
needs it). When requirements on the attack (several `mustAttack` characters, `partyRestriction`s) cannot all be met, the declared party has to meet at least one and as many as any other attack could (CR §505.2, 505.2c); a lone unmet requirement still refuses the attack (CR §505.1). Public accessors: `getKeywords(cardId)` / `getRestrictions(cardId)`.

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
  (The Evil Alliance — OMNIPOTENCE): card / ability / FLIP UP thresholds and
  the `meetsThreshold` condition that gates threshold paragraphs.
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
  PULLING STRINGS). Both apply to every opponent of the holder.
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
  - `matchOpponentCount: true` — after every player is set up, top the
    **opponent** up with staples until the counts match. With two or more
    opponents the faction's player selects it first, before any starting
    resource is placed (a `choosePlayer` prompt, `bind: { type:
    "matchOpponent" }`, in the `chooseMatchOpponent` setup phase).
  As with the flat form the engine picks in deck order — the player does
  not choose which staple / card.
- **`behavior.developDrawReplacement`** (on a non-faction card) —
  `{ cost?, effects }` — while the developing player controls this card in
  play, the `draw` develop option runs a `mayPay` (payer = developer,
  `costs` = `cost`, `effects`, `elseEffects` = the draw) instead of
  drawing. Arcane Escrow — "If you would draw a card as part of your
  Develop Rule, you may put a voided card into hand instead."

### The Open R&D Faction: the ability both players create (Q51B)

`faction.playerCreatedAbility: true` marks a faction card that takes ONE ability the two players make before the game ("both players work together to make the ability, but only one is produced"). It is never free text and never a raw engine ability: the players agree on a `CreatedAbilitySpec` picked from the closed menu `CREATED_ABILITY_MENU` (`src/engine/createdAbility.ts`, exported from `engine.ts`; types in `src/types/createdAbility.ts`).

```ts
CreatedAbilitySpec = { costs: CreatedCostPart[]; effect: CreatedEffectPart }   // plain JSON
CreatedCostPart    = { kind: CreatedCostKind; amount: number }
CreatedEffectPart  = { kind: CreatedEffectKind; amount?: number }               // amount only where the menu gives a range
```

1 to 3 cost lines (each kind at most once) and exactly one effect. Every other field, kind or out-of-range number is refused. "You" in the text is whoever uses the ability.

| Costs | Range | Engine cost |
|---|---|---|
| `pay` "Pay N" | 1-6 | `payResources` |
| `loseInfluence` "Lose N influence" | 1-5 | `loseInfluence` |
| `discardCard` "Discard N cards from your hand" | 1-3 | `discard` (id `created-discard`, from the user's own hand) |

| Effects | Range | Engine effect | Pick (`created-pick`) |
|---|---|---|---|
| `draw` "Draw N cards" | 1-3 | `draw` | |
| `gainInfluence` "Your faction gains N influence" | 1-3 | `modifyInfluence` | |
| `opponentLosesInfluence` "Your opponent's faction loses N influence" | 1-3 | `modifyInfluence` (opponent, -N) | |
| `damageCharacter` "Inflict N damage to a picked character" | 1-5 | `dealDamage` | any character |
| `restoreCharacter` "Restore a picked depleted character" | none | `restore` | depleted character |
| `depleteCharacter` "Deplete a picked character" | none | `deplete` | character that is not depleted |
| `tokenOnCharacter` "Put N tokens on a picked character" | 1-3 | `addCounter` ("token") | any character |
| `lookAtTop` "Look at the top N cards of your deck and put them back in any order" | 2-5 | `lookAndReorder` | |
| `millOpponent` "Put the top N cards of your opponent's deck into their discard pile" | 1-5 | `mill` (opponent, discard) | |

- `validateCreatedAbilitySpec(spec: unknown): string[]` lists every problem (empty = valid); it accepts any value, so run it on what comes off the wire.
- `buildCreatedAbility(spec) -> { ability: ActivatedAbility; text: string }` throws on an invalid spec. The ability has id `CREATED_ABILITY_ID` (`"created-ability"`), `usableBy: "anyPlayer"`, the costs in the written order and, for the picking effects, a `targets` entry `created-pick` (an `activateAbility` supplies `selected["created-pick"]`, and `selected["created-discard"]` for a discard cost). The text is generated from the parts in the printed layout: `COST: Pay 2. Discard a card. Pick a character. EFFECT: Inflict 3 damage to the picked character.`
- `CREATED_ABILITY_MENU` is the same table as data (`{ costs, effects, limits }`; each entry has `kind`, `label` with `N` for the stepper, `min`/`max`/`defaultAmount`, `picksCharacter`), for a UI to render dropdowns and steppers from.
- Setup: `FactionGameSetupOptions.createdAbility?: CreatedAbilitySpec` and `SpoilsEngine.applyCreatedFactionAbility(spec)` validate and build it (an invalid spec throws `Invalid player-created ability: ...`) and store it on each marked faction card as `CardInstance.createdAbility = { text, ability, spec }`, all plain JSON, so a save or a replay from the pinned setup keeps it.
- To add a part: add one row to `COST_PARTS` / `EFFECT_PARTS` in `createdAbility.ts` (label, range, text, build); the menu, validator, builder and text follow. Add its case to `created-ability.test.ts`.

## Continuous ability: ignore a card type

- **`ignoresRulesTextFrom: CardType`** on a `ContinuousAbility` (still needs
  `modifiers: []`) — while the source is in play (and `condition` holds) it
  cannot be **picked** by a card of that type, and single-target effects /
  auras whose origin is a card of that type do not affect it (aggregate
  "all X" effects still do). Parkour Hoodlum — "ignores all rules text on
  locations." See RULES.md §3.8.

## Continuous ability: grant PROVIDES / ignore "this card" triggers (EU3)

- **`providesGrants: [{ selector, icon, amount?, onlyIfLacking? }]`** on a
  `ContinuousAbility` (still needs `modifiers: []`) — while the source is in play
  face-up (and `condition` holds, not suppressed) every in-play card `selector`
  matches provides `amount` (default 1) more `icon`. The continuous form of the
  `grantProvides` effect, read live in `getResourceIcons`, so `getThresholds`
  (deploy / FLIP UP / ability gates), `cardProvides` and `resourceIcons` all see
  it. `selector.controller` is relative to the source's controller; `type:
  "resource"` includes face-down cards (CR §411.1). `onlyIfLacking`: skip a card
  whose icons so far already include `icon` (printed, face-down [V], a lasting
  `grantProvides`, an earlier grant of this kind). Black Market Broker:
  `{ selector: { type: "resource", controller: "self" }, icon: "deception",
  onlyIfLacking: true }`. See RULES.md §3.9.
- **`ignoresTriggers: ("thisCardEntersPlay" | "thisCardLeavesPlay")[]`** on a
  `ContinuousAbility` (still needs `modifiers: []`) — while the source is in play
  face-up, `findTriggers` creates no trigger of those kinds for any card of either
  player. `thisCardEntersPlay` = `event: "cardEnteredPlay"` whose condition
  requires `sourceIsEventCard` (top-level or inside `and`); `thisCardLeavesPlay` =
  `event: "cardMoved"` requiring `sourceIsEventCard` + `cardMovedFromZone: play`
  with no `cardMovedToZone`. `cardDestroyed` triggers and "put into a discard pile
  from play" (`cardMovedToZone`) are not matched. Judged at the event (no recall
  of triggers already created). Unwelcome Hero. See RULES.md §3.10.

## Effect: standing this-turn stat change (`createAreaModifier`)

- **`{ type: "createAreaModifier", selector, stat, operation, value, duration }`** — the standing form of `createModifier`: instead of a target card it takes a `CardSelector` that is **re-matched on every stat read** (`statModifiersFor`), so it also reaches a card that enters play (or changes controller) later while the duration lasts. "This turn, the speed of all characters that opponent controls is reduced to 0." (Rasputin Unleashed): `{ type: "createAreaModifier", selector: { controller: "opponent", zone: "play", type: "character" }, stat: "speed", operation: "set", value: 0, duration: { type: "untilEndOfTurn" } }`. The selector's `self` / `opponent` are relative to the effect's controller when it resolved; `value` is evaluated once, then. Stored in `GameState.areaModifiers`, swept like `modifiers`, interleaved with card-scoped `createModifier`s in creation order (so a later `+1` lands on top of an earlier `set 0`). Use `forEach` + `createModifier` only when the printed text really means "the characters in play right now". Test: `continuous-area-modifier.test.ts`. See RULES.md §3.11.

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

Working the ~1900 not-yet-implemented cards in `data/cards/` is tracked
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
its set file in `data/cards/`, `npm run sync-cards`) → `authored` → **verify** (tests +
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

## E3 cost model (play-time costs, written order)

Everything printed in a card's COST / EXTRA COST (or the cost part of an ability: `COST: Pay 3. Destroy this card. Pick a character.`) is paid **when the card is played or the ability is used**, before the opponent gets a response window, in the order it is written, with the numeric "pay N" paid **last** (CR 406.3a, 604.1d). A play that cannot pay all of it is refused and **changes nothing** (CR 604.1e).

### Where the steps live

One ordered list per play source: `ActivatedAbility.costs`, a tactic's `costs` (the first activated ability or the chosen `modes[i]`), a non-tactic's `onPlay.costs`, a FLIP UP card's regular costs. Write the steps in the order the card prints them. The engine pays them top to bottom, except that every top-level `payResources` step is moved to the end (so `Pay 2. Destroy a resource` and `Destroy a resource. Pay 2` are the same card, and a resource destroyed by the cost can never also pay N: SYS-23).

Picks stay in `targets` (the action supplies them in `selected`, as always). `targets` and `costs` are tied together by id, and one extra step says WHEN a pick is judged.

| step | fields | meaning |
|---|---|---|
| `pick` | `declarationId` | "Pick a character." written AFTER a cost step: the declaration is validated against the board as it is at that point of the cost (Q15, SYS-16). `Destroy this card. Pick a character` cannot pick the destroyed card; `Deplete this card. Pick a depleted character` can pick this card; `Remove this card from the game. Pick a tactic in your discard pile` cannot pick this card; a FLIP UP card's `and play a resource` comes first, so `Pick a resource you control` can pick the resource just played. A declaration with NO `pick` step is validated before any cost is paid (right for "Pick a character. Destroy this card": the pick is first). |
| `bindVariable` | `id`, `value: NumberExpression` | "X is the picked character's strength." Evaluates `value` NOW and locks it in `variables[id]`; the effect reads the locked number at resolution whatever the opponent does in response (Q8). Always overwrites. Write it after the pick it reads and before the step that changes what it reads (`X is its strength. Destroy it` = `bindVariable`, then `destroy`). |
| `effects` | `effects: Effect[]` | Any ordinary effects run as a cost step: flip a coin (the `flipCoin` effect with `bind` effects in `winEffects` / `loseEffects`), reveal (`revealCards` / `reveal`), put a token on this card (`addCounter`), draw, flip this card face-down, remove the top card of a deck from the game (`removeFromGame` of a `deckPosition`), put cards into the void or onto a deck (`moveCard`), "this card loses 2 life this turn" (`createModifier`), restrict play (`restrictPlay`). They see the play's context (`selected`, `variables`). They must not ask anybody a question: a step that leaves a pending choice makes the play illegal. |
| `nameValue` | `valueKind`, `storeAs`, `exclude?`, `nonResource?` | "Name a card." / "Choose a resource icon." as a cost. The payer names it while playing; stored on the source card exactly like the `nameValue` effect (`nameVar`, `{ "fromNamed" }`, `named` all read it). The name arrives as `action.named[storeAs]`; when it is missing the engine opens a `nameValue` prompt carrying `resumeAction` and re-runs the action with the answer merged in. |
| existing steps | `payResources`, `deplete`, `depleteSelected`, `discard`, `destroy`, `sacrificeSelected`, `moveSelected`, `removeFromGame`, `removeCounter`, `dealDamage`, `loseInfluence`, `shuffleDeck`, `revealSelf`, `oneOf` | unchanged. `discard.count` / `moveSelected.count` accept a `NumberExpression` ("Discard X cards"). |

### How a play runs

1. Timing, threshold, `condition`, chosen `variables` (X), modal `mode` are checked first, as before.
2. The card being played is *Being Deployed* (CR 604.1): from here until the costs are paid no cost or pick can use it (it cannot discard itself, pick itself in hand, etc.).
3. Every declaration without a `pick` step is validated against the board.
4. The ordered steps are **rehearsed on a copy of the game** (including `pick`, `bindVariable`, `effects`, `nameValue`). A refusal here is the play's refusal: nothing has changed. A `pick` / `nameValue` step refuses with its own message; anything else with "Costs cannot be paid."
5. Choices inside the cost are asked (a `nameValue`, "destroy a card you control", a `oneOf` with 2+ payable branches): each is a pending choice with `resumeAction`; answering re-runs the whole play with the answer merged in (`named`, `selected["__costDestroy…"]`, `variables["__oneOf…"]`). Still nothing is paid. (A play made from inside an effect has no action to re-run; it cannot ask, and refuses a card whose cost needs a name.)
6. The steps are paid for real, in order, numeric cost last. Locked values are now in the stack item's context.
7. The card goes on the stack (tactic) or waits to enter play (permanent); the opponent may respond.

FLIP UP (CR 507.4c): the FLIP UP line's own steps (`and play a resource`, `and discard a card`) run first as one `effects` step, then the card's regular costs in written order, then the FLIP UP numeric cost.

Triggered abilities' "you may pay …" costs and every other `payCosts` caller get the same ordering (numeric last) but have no action to pause, so they cannot use `nameValue`.

### Offering the right cards to the player

A client cannot read the legal cards of a `pick` step off the board it sees (the card a cost destroys is still there; the card a cost makes legal is not yet). `engine.getPickCandidates(action, declarationId)` rehearses the cost steps written before the pick (using the action so far: `selected`, `variables`, `named`) and returns exactly what the play would accept. A pick with no `pick` step is judged against the current board, as `targetCandidates` always did.

### Converting a card

For a card whose printed COST step is authored as an effect (or whose pick the cost invalidates). Spec: "E3 cost model" above. Data only; no engine change. Work from the card’s `markup` (the COST / EXTRA COST text, in written order), never from the current behavior.

1. Find the play source: the tactic's activated ability (`behavior.abilities[0]` or `behavior.modes[i]`), a permanent's `behavior.onPlay`, an ability's own `costs`. Read the printed COST sentence by sentence. Each sentence is one cost step, in that order. Everything after the cost (the EFFECT) stays in `effects`.
2. Move every sentence that is in the COST but currently sits in `effects` (or `onPlay.effects`) into `costs`, at its written position. The `payResources` step may stay wherever it is (the engine pays it last).
3. Use the step kind that fits (before / after below). Picks stay in `targets`; only their *timing* is a cost step.
4. Delete the effect you moved (it must not run twice). A later effect that read the moved thing keeps working: it reads the locked variable (`{ "type": "variable", "id": "x" }`) or the same `selected` id.
5. A pick written AFTER a cost step that changes what can be picked gets a `{ "type": "pick", "declarationId": "<id>" }` step right after that cost step. A pick written BEFORE the cost step, or with no cost step before it, gets none.
6. Convert **every printing** of the card: the other editions are separate rules groups when their markup differs (`data/card-tests/clauses.json`); check the cost sentence order of each (Tri-Pole Magnet prints "Pick … Destroy this card" in 1st/2nd Edition and "Destroy this card, pick …" in Open Beta: only the second needs a `pick` step).
7. Edit card data (`data/cards/<set id>.json`) through a patch module keyed by printing id (`node scripts/patch-cards.cjs <patch.cjs>`; see `data/card-audit/other-reveals.patch.cjs` for the shape), which re-runs `npm run sync-cards`. Never hand-edit `src/data/`.
8. Run the card's test file. A test that used to answer the cost's question at resolution (a name, a card type) must now answer it at play: `play`/`activateRaw` stops at the `nameValue` prompt, `answerPending(engine, "nameValue", { value })` re-runs the play, then drain the responses. Changing how a test drives the engine is fine; changing what it asserts is not.

#### Before / after, one per step kind

**Pick after a cost (`pick`)**: "COST: Pay 2. Destroy this card. Pick a character."
```jsonc
// before: the destroyed card could still be picked
"costs": [ { "type": "payResources", "amount": 2 }, { "type": "destroy", "target": "source" } ],
"targets": [ { "id": "t", "selector": { "type": "character" }, "count": 1 } ]
// after
"costs": [ { "type": "payResources", "amount": 2 }, { "type": "destroy", "target": "source" },
           { "type": "pick", "declarationId": "t" } ]
```
Same for `removeFromGame` source then "Pick a tactic in your discard pile" (RECUR), `deplete` source then "Pick a depleted character", `sacrificeSelected` then "Pick a character", a FLIP UP card's regular "Pick a resource you control" (the FLIP UP line's "and play a resource" happens first).

**X from a pick (`bindVariable`)**: "COST: Pick a character. X is its strength." EFFECT: "Destroy it. Its owner gains X influence."
```jsonc
// before: X is read when the tactic resolves
"effects": [ { "type": "bind", "id": "x", "value": { "type": "stat", "target": { "type": "selected", "id": "c" }, "stat": "strength" } },
             { "type": "destroy", "target": { "type": "selected", "id": "c" } }, { "type": "modifyInfluence", … "amount": { "type": "variable", "id": "x" } } ]
// after: X is locked when the cost is paid
"costs": [ { "type": "bindVariable", "id": "x", "value": { "type": "stat", "target": { "type": "selected", "id": "c" }, "stat": "strength" } } ],
"effects": [ { "type": "destroy", … }, { "type": "modifyInfluence", … "amount": { "type": "variable", "id": "x" } } ]
```
"X is the number of members of the attacking party" is `{ "type": "battlePartySize", "side": "attacking" }`. A card with an ability-level `variables: { "x": <expression> }` that is printed in the cost: delete it and use `bindVariable` (a client can overwrite `variables`).

**Read, then destroy ("X is its strength. Destroy it.")**: bind first, then the `destroy` step, then the `pick` for the next sentence.
```jsonc
"costs": [ { "type": "bindVariable", "id": "x", "value": { "type": "stat", "target": { "type": "selected", "id": "a" }, "stat": "strength" } },
           { "type": "destroy", "target": { "type": "selected", "id": "a" } },
           { "type": "pick", "declarationId": "b" } ]
```

**Reveal (`effects` with `revealCards`)**: "COST: Reveal a face-down tactic you control."
```jsonc
// before: effects: [ { "type": "revealCards", "selected": "rev" }, … ]
// after
"costs": [ { "type": "effects", "effects": [ { "type": "revealCards", "selected": "rev" } ] } ]
```
"Reveal the top card of your deck" whose effect later reads that card: add `"captures": [ { "id": "revealed", "target": { "type": "deckPosition", "player": "controller", "from": "top" } } ]` on the ability (recorded before the cost) and read `{ "type": "selected", "id": "revealed" }` in the effects.

**Coin (`effects` with `flipCoin`)**: "COST: Flip a coin. If you win X is 2, otherwise X is 1."
```jsonc
"costs": [ { "type": "effects", "effects": [ { "type": "flipCoin", "player": "controller",
    "winEffects":  [ { "type": "bind", "id": "x", "value": 2 } ],
    "loseEffects": [ { "type": "bind", "id": "x", "value": 1 } ] } ] } ]
// the effect then uses { "type": "variable", "id": "x" } (e.g. an `if x >= 2` for the second repetition)
```

**Token on this card (`effects` with `addCounter`)**: "COST: Pay 1. Put a token on this card."
```jsonc
"costs": [ { "type": "payResources", "amount": 1 },
           { "type": "effects", "effects": [ { "type": "addCounter", "target": "source", "counter": "token", "amount": 1 } ] } ]
```

**Name a card / icon (`nameValue`)**: "COST: Pay 2. Name a card."
```jsonc
// before: effects: [ { "type": "nameValue", "chooser": "controller", "valueKind": "cardName", "storeAs": "named" }, … ]
// after (the effects keep reading "named" through `nameVar`, `fromNamed`, …)
"costs": [ { "type": "payResources", "amount": 2 }, { "type": "nameValue", "valueKind": "cardName", "storeAs": "named" } ]
```
`valueKind` is `cardName`, `resourceIcon`, `trade` or `subtype`; `exclude` / `nonResource` as for the effect.

**Discard / destroy / sacrifice / shuffle / move (existing steps, `count` may be an expression)**
```jsonc
{ "type": "sacrificeSelected", "declarationId": "d", "disposition": "discard" }   // pick in targets, "Discard it"
{ "type": "destroy", "target": { "type": "selected", "id": "a" } }
{ "type": "moveSelected", "id": "self", "player": "controller", "selector": { "controller": "self", "name": "__self", "zone": "play" },
  "count": 1, "to": "deck", "shuffle": true }                                      // "Shuffle this card into its owner's deck"
{ "type": "discard", "id": "d", "player": "controller", "selector": { "zone": "hand" }, "count": { "type": "variable", "id": "x" } }  // "Discard X cards"
```

**Move cards to the void / the removed zone / a deck (`effects` with `forEach` / `moveCard` / `removeFromGame`)**: "Put X characters you control into the void. Pick X+1 characters."
```jsonc
"costs": [ { "type": "effects", "effects": [ { "type": "forEach", "selected": "tovoid", "effects": [ { "type": "moveCard", "target": { "type": "selected", "id": "__candidate" }, "to": "void" } ] } ] },
           { "type": "pick", "declarationId": "bounce" } ]
```
"Remove the top card of each deck from the game. X is the difference": `bindVariable` each cost first, then one `effects` step of two `removeFromGame` effects (target `{ "type": "deckPosition", "player": …, "from": "top" }`), then `bindVariable` for X.

**Other self-affecting costs**: `{ "type": "effects", "effects": [ { "type": "flipFaceDown", "target": "source" } ] }` (flip this card face-down), `draw`, `createModifier` ("that character loses 2 life this turn"), `restrictPlay`, … any effect that asks nobody anything.

**Numeric cost last**: no data change. `Pay X` as a cost step is `{ "type": "payResources", "amount": { "type": "variable", "id": "x" } }` after a `bindVariable`.

**A choice among N values, one of which the cost fixes ("Choose a card type")**: `oneOf` with `labels`, one branch per value, each branch a `bindVariable`; the effect compares the variable.

Related vocabulary: `oneOf.labels`, `grantVoidPlay.selector` (cards no pick named: Eccentric Inquisition's removed tactics; `removeFromGame` records `voidedBy` so `voidedBySource` finds them), `ActivatedAbility.captures` for "reveal the top card" costs whose effect reads that card.

### Costs another player decides, a divided cost, the pay loop (E3c)

Three more cost steps need a question put to somebody while the card is played. They share one mechanism: **the play pauses where the step stands.**

| step | fields | meaning |
|---|---|---|
| `otherPlayerChooses` | `chooser: PlayerRef`, `declaration?`, `may?`, `effects` | "Your opponent may detach up to 3 resources." (`chooser: "opponent"`), "That character's controller picks a resource they control. Put the resource into its owner's hand." (`chooser: { controllerOf: selected ch }`; the declaration's selector may name the same player in `controller`), "That player may put a Micromajig token into play" (`may: true`, no pick). The chooser answers a `chooserSelectsTarget` (the declaration) or a `chooserSelectsOption` (a `may`: option 0 = decline, 1 = yes). `effects` run as the cost is paid, with their pick in `selected[declaration.id]`; a declined `may` runs nothing. A mandatory pick with no legal card makes the play illegal; an optional pick with nothing to pick, or a pick of 0, asks nobody. |
| `distribute` | `selected`, `amount`, `maxShare?`, `effects` | "Remove X tokens from cards you control" as an extra cost the payer divides. The cards are an ordinary `targets` pick (`selected`); the payer is asked for the division (a `distributeAmong` prompt) while playing; `effects` run once per card with a share (`__candidate`, the share in `variable __amount`). The division must total `amount` and respect `maxShare`; cards that cannot give that much make the play illegal. |
| `alternatingPay` | `first`, `opponent`, `cost`, `maxRounds?` | "You may pay 1. If you do, that opponent may pay 1. Repeat this cost until you or your opponent does not pay." Each player is asked in turn (an `alternatingPay` prompt) and a yes spends `cost` AT ONCE. A player who cannot pay is not asked (the loop ends); the caster also keeps back the card's own numeric cost, which is paid last. When the loop ends, `__paidByFirst`, `__paidByOpponent` and `paid:<playerId>` are locked into the play's variables for the effect. |

How the pause works (`payCosts(costs, context, resume)`):

1. The play is checked and its whole cost is rehearsed on a clone first, as always. A mandatory single pick another player will make is tried with each legal card: the play is legal only if some answer leaves the rest payable (so the chooser can never be left without a legal answer).
2. Payment runs in written order. At a step that needs an answer, the steps before it are **paid for real** (a depleted Trinket is already depleted when its opponent chooses), the question is put to its chooser as a pending choice carrying `resumeAction` (the paused action) and the engine's private `costAnswers` / `__committed` (how many steps are paid), and the play stops. The card is still in hand / the ability not yet on the stack.
3. The answer is validated like any pick (`chooserSelectsTarget` rules), stored by the engine, and the action is **re-run**: the re-run skips the steps already paid (and the checks that only make sense before anything is paid: threshold, up-front picks, influence), rehearses the rest with the answer, and continues. Several such steps simply pause again.
4. A refused re-run (the answer made the rest unpayable, which step 1 makes impossible except by other players' replies) leaves the question open.

The answer lives only inside the engine's prompt: a pick or division riding in the player's own action is ignored, so a client cannot answer for the opponent. The prompts reuse existing kinds (`chooserSelectsTarget`, `chooserSelectsOption`, `distributeAmong`, `alternatingPay`): a client answers them as before; what is new is that the chooser may be the non-acting player and that they arrive while a card is being played.

`coinFlip` (a `NumberExpression`, `{ type: "coinFlip", win, lose, player? }`) is a coin flipped as a *number* in an ability's / tactic's `variables` (Hammer Smash: "If you win X is 2, otherwise X is 1. Pick X or fewer items"). It is a real flip (`coinFlipped` is logged, by the controller) rolled before the pick it sizes, and a lost flip offers the Two-Headed Coin reflip first (`coinFlipReplace`), then the pick prompt (`selectDeployTargets`) is opened with the settled X.

### Known limits

- A coin flipped as a cost step (`effects` / `flipCoin`: Pyramid Scheme) does not offer the coin-flip *loss replacement* (Two-Headed Coin): that replacement is a prompt, and an `effects` cost step cannot ask a question. (A `coinFlip` variable roll, Hammer Smash, does.)
- A card whose cost has an `otherPlayerChooses` / `distribute` / `alternatingPay` step cannot be played by an effect that has no action to pause (`deployForFree`, `deployFromZone`, a duplicated tactic's costs) and cannot be a FLIP UP card: those plays are refused with a message. (A duplicate does not pay the copied tactic's extra costs yet: E3b.)
- The affordability check of the numeric cost is made before the other player answers, so "that player may detach their resources" cannot be counted on to free resources that would pay the numeric cost.
- The mandatory-pick feasibility check (step 1 above) only branches for a pick of exactly one card.
- A play made from inside an effect (`deployForFree`, `deployFromZone`) has no action to pause, so a card whose cost needs a name (`nameValue`) cannot be played that way; its other cost steps work.
- A coin that sizes a pick ("flip a coin; X is 1 or 2; pick X or fewer", Hammer Smash) is a `coinFlip` variable roll (see above) and uses the deferred-pick prompt (`selectDeployTargets`); the `flipCoin` cost step is for coins whose result is read only by the effect.

## E7b numeric cost: one running total (CR 406.3)

Every numeric cost a play or an ability use asks for is **one running total**, folded into a single `payResources` step that is paid last. The step carries engine-internal fields (never authored in card data): `plus` (the other top-level "pay N" steps, each floored at 0 on its own) and `adjust` (the list of increases then reductions, each `{ delta, minCost? }`). The amount is fixed only when it is paid, so a cost step that binds X first (`bindVariable`) is read correctly.

- **Order (CR 406.3):** cost number (0 for a free play) + every extra "pay N", then every increase (continuous `costModifiers` / `abilityCostModifiers` with a positive delta, "increased to a minimum of N" with `delta: 0`, `pickTax`), then every reduction (negative modifiers, a selection-based EXTRA COST adjust, then the pending "reduce the next numeric cost"). Never below 0.
- **Minimums (CR 410.5):** a reduction with `minCost` stops at N but does not raise a value already below N (a cost-0 item under Rudimentary Lathe stays 0). An increase with `minCost` raises (Canny Bailiff "increased to a minimum of 3").
- **`reduceNextCost`:** every pending reduction of the player stacks on the one next numeric cost (Q1) and is used up by it. It reaches a card's own cost (the extra "pay N" included), an ability's "pay N" (`activateAbility`, FLIP UP, a trigger's "you may pay N", `mayPay` / `anyPlayerMayPay` / `alternatingPay`, a replacement's cost) and the other player's payments of their own pending reductions. A play or ability with no numeric cost uses nothing up. Fields: `cardType` (only that type's own cost), `includeAbilities` (with `cardType`: also an ability of such a card: Adjunct Artisan "item's ability's numeric cost"; without it a card-type reduction never reaches an ability, CR 406.5b), `cardsOnly` ("the next CARD you play": never an ability, 1337! and Thabbashite Organist).
- **Taxes:** an `abilityCostModifiers` increase **creates** a cost when the ability printed none (Department of Rejections); `opponentCharacters` is judged against the player USING the ability, also for an ability borrowed from the other player's character. `getAvailableActivatedAbilities` lists an ability only if its taxed / reduced cost is payable.
- **`ContinuousAbility.pickTax`:** `[{ affects, amount, selector? }]`, "your opponents must pay 1 to pick a character you control" (Lucky Charm). Charged per picked card per source, as a "pay N" extra cost of the play / ability whose declared `targets` pick it (not for a pick made while an effect resolves).
- **Numeric cost of a card (Q9):** `cardCost` of a card **being played** (zone `deploying`) is the running total as it was paid (`CardInstance.numericCostPaid`; a FLIP UP deploy starts at its FLIP UP cost, CR 406.7); of a character in play it is the printed number plus what `modifyNumericCost` gave it this turn (Guileful Astucion); anywhere else the printed number.
- **"Up to N less" (E7c):** a printed "costs up to N less" / "by up to N" is a player choice, not a fixed amount: wrap the reduction in `chooserSelectsNumber { chooser: "controller", storeAs: "n", min: 0, max: N, effects: [reduceNextCost { amount: { variable n } }] }` (1st Edition and Open Beta 1337! with `cardsOnly`, Jo Ciendeilio, Research Assistant, Runic Circuitry, Towering Researchmajig; 1st Edition and Open Beta printings). A printing that says "by N" without "up to" (2nd Edition 1337!, Senior Research Assistant, 2nd Edition Jo / Circuitry) keeps the fixed `amount`. These prompt the controller with a `chooseNumber` (UI and bots must answer it).

## E3b additions (free plays, duplicates, running total)

- **A free play waives only the numeric cost (CR 308.1).** `deployCard` keeps every extra cost the card prints, including `payResources` ("Pay 2", "Pay X+X"); a play (and a play by an effect: `deployForFree`, `deployFromZone`) whose extra costs cannot be paid is refused atomically and the choice stays open (the player may decline).
- **`deployFromZone { free: false }` / "play" without "for free" (Q11).** The card is offered; accepting a play whose numeric cost, threshold or extra costs cannot be met is refused (the card stays where it is, face-down cards are put back) and the player may decline ("you may").
- **A tactic played by an effect uses the stack.** `deployCardForFree` no longer resolves a tactic inline: it waits on the response stack and `resumeEffectFrames` opens the response window once the playing effect has finished (the opponent may respond, CR 604.1g). Only "your opponent cannot respond to this card" tactics resolve at once. Characters, items and locations played by an effect still enter inline.
- **Duplicates pay the copied tactic's extra costs (CR 307.1).** `duplicate` builds, for the chosen option, a chain: new picks for the tactic's `targets` and for the costs that carry their own pick (`discard`, `moveSelected`, a random `destroy`), a `nameValue` effect for a `nameValue` cost, then the engine-built `payCosts` effect (`{ costs, declarations, effects }`): it orders and rehearses the costs on a clone, pays them, then runs the copy's effects; if they cannot be paid nothing happens. The copy's X is the original's (`state.tacticPlayVariables`, recorded when a tactic is played, so a duplicate made after it resolved still has it). Costs of `oneOf` shape are not re-asked (the copy is invalid unless the payment is complete).
- **Running total (CR 406.3)** *(merged with E7b: `cardCost` reads E7b's `CardInstance.numericCostPaid`; the stack item's `playCost` mirrors the same amount)*. The response-stack item of a played card carries `playCost` = the numeric total it was played for (cost number after reductions and cost modifiers, plus every `pay N` extra cost, FLIP UP cost first for a FLIP UP play). `cardCost` of a card still on the stack reads it (Muddle, Patent Enforcement, Headhunting, Ritual of the Sucking Skull); outside the stack it is the printed number (CR 406.1).

## TD1: the engine no longer reads printed text for behavior

The engine used to decide five behaviors from `CardDefinition.text` (regexes), which can be stale. Each is now an explicit data field, set on every printing whose old text read matched (no behavior change). `markup` is the audited printed text; the one remaining text read, `textMentionsIcon`, now uses it.

- **`distributeAmong.upTo`** (`"up to 2 damage divided however you want"`): the chooser need not give out the whole `amount` (the pending choice's `upTo`). Without the flag the whole amount must be given. Set on: Voidal Perversion, Cannon Squadron, Flaming Barduse, Really Big Barduse, Trip Wire, Eldridge Gosche (both abilities of the Holy Heist printing).
- **`TargetDeclaration.distinctPicks`** ("Pick 2 characters" written as two single-pick declarations, Q20): every flagged declaration of one list must select a different card. Set on Delectable Boon, Miraculous Regeneration, Mr. Fetch.
- **`TargetDeclaration.impliedPick`** (Q13; the card never says "pick": "destroy the character ... with the lowest numeric cost"): a required declaration whose selector uses `isExtremum` asks for no input when it has no more candidates than `count`. Set on Verrucose Brains.
- **`mayPay.payAndPick`** (Q19; "you may pay 2 and pick a character"): with no candidate for the first effect's pick nothing is offered or paid; once paid the pick cannot be declined. Copied onto `PendingMayPayChoice.payAndPick`. Set on Executive Order #6370u7.
- **`ReplacementAbility.replaces.from`** (moveToZone only): `"play"` for "from play" (Geiseric, Dethmürderblüdgeon); `"hand"` for "if you would discard" (CR 305.1: a card leaving a hand, never a destroyed permanent; Phalludrix, Arcane Escrow). Unset reaches the card from wherever it comes (The Stone of Shame, Resurrection Emporium, Goutflame Talonclaw, Marauding Madster, Purifier of the Fallen), a tactic that finishes resolving (`deploying` -> discard, CR 205.2) and a permanent whose attach target vanished (CR 507.2c) included; only the move of a deploying card INTO play is seen by runtime replacements alone.
- **`textMentionsIcon`** reads `cardTextToPlain(markup)` (cached per markup string), falling back to `text` only for a synthetic definition with no `markup`.
- **`CardSelector.removedBySource` is gone**: `voidedBySource` covers the void and the removed zone alike (Arcane Escrow now uses it). `PendingEffectFrame.finishFlipUp` (never set) and the private `finishFlipUp` / `numericTotal` helpers were removed.


## Read-only queries for clients

Queries a client calls instead of keeping its own copy of a rule. Each one changes nothing and calls the same private check `perform` uses, so the answer cannot disagree with what `perform` does. They answer "can this go through right now?", not "is this exact combination legal": a pick, a party size or a particular target is still the last word of `perform`.

### Deck construction (`src/engine/deckRules.ts`, exported from `engine.ts`)
Static functions, not engine methods: no game exists while a deck is being built. The engine still builds a game from whatever deck it is handed; these are the rules a deck builder, lobby or server gate holds a decklist to first.

- **`findDeckConstructionIssues(cards, options?)`** returns `[{ kind, message, cardId? }]`, in a fixed order, empty = constructible. `cards` is the decklist's definitions, one entry per copy, faction card included.
  - `empty`: no cards at all.
  - `unknownCard`: an id the caller could not resolve (`options.unknownCardIds`, one entry per copy; one issue per distinct id; they still count toward the size). `resolveDeckCards(ids, catalog)` does the split.
  - `factionCount`: not exactly one `type: "faction"` card (RULES.md §3.6, CR §202.2: the deck supplies the one faction that starts in play). Two copies of the same faction card are two.
  - `copyLimit`: a non-faction card over `getMaxCopies` (CR §103.1c). Cards with the same name are the same card across printings (CR §201.1b), so the copies of every printing of a name are counted together. One issue per name, `cardId` set to its first printing in the decklist.
  - `minimumSize`: fewer deck cards than `options.minimumSize`, or (default) than the printed MINIMUM DECK SIZE of the deck's faction when it has exactly one and prints one. **There is no general minimum**: RULES.md has none, and a UI "recommended size" is a hint, not a rule, so with neither a faction minimum nor an explicit number this issue never fires. The faction card is not part of the deck (RULES.md §3.6) and is not counted; unknown ids are. `minimumSize: false` skips the check even for a faction that prints one.
  - `factionRule`: the deck's faction cannot start a game with this decklist (`findFactionDeckIssues`: "any 2 different staple resources", rules answer Q45). This folds `findFactionDeckIssues` in, so a client needs no second call; `factionRules: false` leaves it out. The Tournament Faction gets its built-in defaults first (`withBuiltInFactionDefaults`).
  - Not checked (policy of the host, not rules): engine fidelity (`CARD_FIDELITY`) and admin-disabled cards.
- **`getMaxCopies(definition)`** is `4` (`DEFAULT_MAX_COPIES`), or `null` (unlimited) for a staple resource (`isStapleResourceDefinition`, CR §103.1c / RULES.md §3.5) and for a printing with `CardDefinition.deckLimit: "unlimited"`. A faction card reports 4 but is never copy-checked (`factionCount` covers it).
- **`CardDefinition.deckLimit?: "unlimited"`** is a deck-construction fact, not game behavior. It is set on exactly the printings whose markup prints "You may include as many copies of this card in your deck as you want": Party Clowns (Seed 2), Party Clowns (Seed Saga), Crow With Fists (Ungodly Mess). `getMaxCopies` never reads card text; a test pins the flag to the markup sentence over the whole catalog.
- **`getMinimumDeckSize(faction?)`** returns `FactionDefinition.minimumDeckSize` (a card or its `faction` data), or `undefined` = no minimum rule. Only The Society of Magical Propriety (Seed 3) prints one: "MINIMUM DECK SIZE: 300 cards", set as `minimumDeckSize: 300` on that printing. The count excludes the faction card. The clause test for that line stays `exempt`.
- **`deckFactionFace(definition, catalog)`** maps a double-sided faction card to the face a deck is built around. A faction whose data has `setup.startsFlipped` and `flipsTo` is the back side (Counter-Imperial Army, the only one): the deck's faction is the `flipsTo` face (Imperial Army). Any other card is returned unchanged. `catalog` is a lookup function or a card array. No new data was needed.

### Turn queries: FLIP UP, attack, block, end turn

- **`getFlipUpPlayability(playerId, cardId, optionIndex?) -> FlipUpPlayability`**
  - `{ playable, legalTiming, thresholdMet, numericCost, availableResources, blockedBy?, reason?, optionIndex? }`, in the style of `getCardPlayability`.
  - `blockedBy` is the first gate `flipUp` would refuse at, in its order: `"notFaceDown"` (not a face-down card you control in play), `"noFlipUp"` (no FLIP UP option, or the named `optionIndex` does not exist), `"restriction"` (a ban on FLIP UP, or on playing this type or name), `"timing"` (wrong phase or priority, a response window that wants a tactic, a failing play condition, a pending choice), `"threshold"`, `"riderCard"` (the FLIP UP line plays or discards a card from hand and the hand is empty), `"cost"`. `reason` is the engine's own refusal text for that gate.
  - The threshold is counted after the flip (CR 507.4b, R3): the flipped card's own icons are left out. `availableResources` counts the flipped card when it is an unattached resource, because it may help pay for itself.
  - `numericCost` is the FLIP UP cost plus a faction surcharge (The Primitive Tribes of Thabbash), run through the deploy cost modifiers (Foreclosure Overseer, Canny Bailiff), the card's extra "pay N" steps and the pending "reduce the next cost" effects. It does not cover the card's targets or other extra costs, same as `getCardPlayability`.
  - `optionIndex` omitted: the first affordable option, as `flipUp` picks. The index judged is returned.
- **`getAttackOptions(playerId, attackerIds?) -> AttackOptions`**
  - `{ attackers, mustAttack, targets, tax, blockedReason? }`.
  - `attackers`: every character that passes `declareAttack`'s per-attacker checks (in play, a character, not depleted, not `cannotAttack`, started the turn in play or AGGRO, not past `attackOncePerTurn`). `mustAttack` ("All characters must attack if they can": Silent Sentinels) is a subset: any declaration has to name all of them.
  - `targets`: the opposing factions (minus any that `preventsAttackOnFaction` bars for this party) and the opposing locations in play.
  - `tax`: the attack tax for the party. `attackerIds` names the party; omitted, it is every attacker (so `targets` is what some party could name, and `tax` the tax if all of them go).
  - `blockedReason`: why nothing can be declared (game-wide gates, a battle or response window, not the active player, the attack limit of Narrow Passage, an unpayable tax for even the cheapest legal declaration, no attacker, no target). The first four use the exact `declareAttack` text; the last two are the query's own words.
- **`getBlockOptions() -> BlockOptions | undefined`**
  - `undefined` unless a battle is waiting for blockers (its phase is `"blocking"`). Otherwise `{ playerId, blockers, mustBlock, canBlock, reason? }` for the defending player.
  - `blockers`: each character that could be declared on its own: it passes the per-blocker checks (controlled, in play, face-up, a character, not depleted, not `cannotBlock`), COVERT legality and the block restrictions. Empty while the whole attacking party cannot be blocked (CR 412.1; `reason` says so).
  - `mustBlock`: the characters a declaration cannot leave out: `mustBlock` restriction, a `requireBlock` grant for an attacker in this battle (only when the character could legally join some block, SYS-39), and a blocker chosen by the attacker's ability. Declining to block (an empty declaration) is legal when it is empty.
  - Whole-party rules (a minimum blocking party, party composition) are not in `blockers`; `perform` checks them.
- **`getEndTurnBlock(playerId) -> string | undefined`**
  - The refusal `endTurn` would give, or `undefined` when it would go through: the game-wide gates, not the active player, a battle, an open response window, a character that still must attack (`'X' must attack if it can; the turn cannot end yet.`), unresolved responses.

How they share code with `perform`: `endTurn` / `getEndTurnBlock` share `endTurnProblem`; `declareAttack` / `getAttackOptions` share `attackTimingProblem`, `attackerProblem`, `resolveAttackTarget`, `factionAttackPrevented`, `attackLimitProblem`, `attackTaxProblem` and `attackTaxFor`; `declareBlockers` / `getBlockOptions` share `blockerProblem`, `attackingPartyUnblockable`, `mustBlockObliged`, `chosenBlockerObliged` and `couldJoinBlock`; `flipUp` / `getFlipUpPlayability` share `chooseFlipUpOption`, `flipUpBanProblem`, `deployRestrictionProblem` / `deployTimingProblem` (the two halves of `assertCanDeployAtCurrentTiming`), `meetsThresholdAfterFlip`, `isFlipUpHandRider` / `flipUpRiderCandidates`, `flipUpNumericPay` and `playConditionHolds`. The game-wide gates (`actionGateProblem`) are shared by every query and `performAction`. Agreement tests: `src/engine/__tests__/turn-queries.test.ts`.

### Abilities, develop, mulligan, costs and view hints
- **`getCardActivatedAbilities(cardId)`** (now public): printed + faction + granted + player-created activated abilities, minus suppressed ones.
- **`getActivatedAbilityStatuses(playerId)`** returns `[{ cardId, ability, available, unavailableBecause? }]` for every ability the player may use on a card in play (own, "both players", "an opponent", or borrowed). `unavailableBecause` is the first failing gate, in this order: `timing` (not a moment to use abilities), `restricted` (`cannotUseAbilities`), `suppressed`, `faceDown` (a face-down resource whose ability is not `fromFaceDown`; opponents' face-down cards are not listed), `threshold` (the ability's printed `threshold` is not met, judged for the player it resolves as: `activateAbility`'s own check, shared as `abilityThresholdMet`), `usesSpent` (`usesPerTurn` used up, or locked for the turn), then the board checks `cost` (numeric cost with taxes, reductions and pending reductions; a discard without cards; any other unpayable cost), `condition`, `targets` (a mandatory declaration with too few candidates), `depleted` (a deplete cost on a card that is already depleted). `getAvailableActivatedAbilities(playerId)` is exactly the statuses with `available: true`, same order and results as before. The listing does not check an ability's zone or its `pick` cost steps: `activateAbility` still has the last word on those.
- **`getDevelopOptions`** (removed 2026-10-27 with the `chooseDevelop` action and `canDevelopNow`): the Develop Rule is now the `developRule` effect of the faction's start-of-turn trigger, so there is no 'what can I develop with now' query; ask the pending choice it raises instead (`chooserSelectsOption`, then the `playResource` prompts, `getResourcePlayFaces` for a hand card's sides).
- **`previewMulligan(playerId, cardIds)`** returns `{ incoming, maxCards, pausesForPrompt }`, found by making the mulligan on a probe copy. `incoming` are the cards that would come into the hand (when a bottomed card raises a prompt, the top of the deck that will be drawn once it is answered); `maxCards` is the hand size; `pausesForPrompt` is true when a card set aside asks a question first (Community Chest with [D]). It throws what `mulligan` throws.
- **`getCostAffordability(playerId, costs, context?)`** returns `{ payable, need?, have?, reason? }`. `need` is the numeric cost as it would be paid, `have` the ready resources. Default (`as: "mayPay"`): judged like a `mayPay` offer, with the payer's pending "reduce the next numeric cost" counted. `as: "ability"` with a `sourceId`: judged like using that card's ability, in-play taxes and reductions (`abilityCostModifiers`, Department of Rejections) folded in, discards probed, `pick` steps left to the use. `context` may also carry `abilityId`, `controllerId`, `selected`, `variables`, `named`.
- **`getLifeRemaining(cardId)`**: effective `life` (character) or `structure` (location) minus damage, floored at 0; 0 for other cards.
- **`checkNameValue({ valueKind, exclude?, nonResource? }, value)`** returns `{ ok: true }` or `{ ok: false, error }`, by the check `resolvePendingChoice` and the `nameValue` cost step make (non-empty; a real icon or trade; not excluded; a non-resource card name against the card catalog when one was given). A `PendingNameValueChoice` can be passed as is.
- **View additions** (all optional fields, additive):
  - `GameFlowView.actingPlayerId`: whose decision it is in every mode: the setup seat (mulligan, starting resources, starting draw search) in `setup`, the active player in `main`, the priority holder in `response`, `BattleView.actingPlayerId` in `battleChoice`, the chooser in `pendingChoice`; `undefined` in `resolvingResponses`, `battleFinished` (only the seat-less `advanceFlow` is legal) and `gameOver`.
  - `BattleView.forcedAssignments`: in a damage step, the assignment ready to submit as `assignBattleDamage` when every source that deals damage has exactly one legal target (`[]` when nothing deals damage); `null` when someone has a real choice and outside a damage step. `BattleView.upcomingSpeeds`: the speeds of battle characters that have not assigned yet and are slower than the current level, highest first (display only; effects can change speeds before a level comes up, CR 609.1b).
  - `PendingChooserOptionChoice.style`: `"yesNo"` (the yes / decline of an `otherPlayerChooses` `may` cost step), `"costBranch"` (the branches of a `oneOf` cost), `"oneOf"` (an authored list of effects, or a pile to take).
  - `PendingNameValueChoice.options`: the closed list for `resourceIcon` (staples plus volition) and `trade`, `exclude` removed; absent for `subtype` and `cardName`.
  - `PendingResourceFaceChoice.canFaceUp`: whether the card may go face-up (a resource card that is not `faceDownOnly`).
- **Exports from `src/engine.ts`**: `withBuiltInFactionDefaults`, `isStapleResourceDefinition`, `ATTACH_TARGET_ID`.
- **Refactors behind them** (behavior-preserving; no change to what `perform` accepts): `getAvailableActivatedAbilities` and the new status listing share one walk (`abilityStatuses`), and `activateAbility` and that walk share the threshold check (`abilityThresholdMet`); `resourceRevealCandidates` uses `revealGateProblem` and `revealPlayProblem` (which calls the same `deployThresholdProblem` and `deployNumericCostProblem` that `deployCardInner` uses, with the flat reveal cost as the numeric cost); `playResourceCard` and the `playResource` effect share `forcedFaceDownReason`; `assertNameable` and the `options` lists share `NAMEABLE_ICONS` / `NAMEABLE_TRADES`.

### Play requirements (`getPlayRequirements`, `getSelectionRequirements`, `answerPlayRequirement`, `declinedKey`)

`engine.getPlayRequirements(action)` takes the action built so far (`playCard`, `activateAbility` or `flipUp`, with whatever is already answered in `mode`, `flipUpOption`, `variables`, `selected`, `named`) and returns only what is still missing, in the order the engine asks for it. `[]` means dispatch it as it stands. It lists one gate at a time:

1. `{ kind: "mode", options }`: a modal card (`behavior.modes` with 2+ entries) and no `mode` yet. Nothing else is listed until it is answered.
2. `{ kind: "flipUpOption", options }`: a FLIP UP card with 2+ options (a printed one plus a granted one, Q35) of which 2+ can be used right now. Each option says `available` and, if not, a `reason`: both are `getFlipUpPlayability(playerId, cardId, index)` (`playable` / `reason`), so the gate and the playability query cannot disagree.
3. `{ kind: "variables", variables: [{ id, min, max }] }`: the numbers the PLAYER chooses ("choose a number for X"), by the engine's own rule (`playerChosenVariableIds`) and with the bounds `assertVariableBounds` holds them to. Rolled variables (`random`, `coinFlip`) are the engine's and are never asked. Send only the chosen numbers in `variables`.
4. `PickStep` per pick, in cost order: `{ kind: "pick", requirement, candidates, blocked, min, max, declinable, forced, distinctNames, distinctTrades, distinctTypes }`.
   - Order: declarations with no `pick` cost step first (they are judged before anything is paid), then the cost steps in written order. A `pick` step places its declaration, and its `candidates` come from `getPickCandidates` (the board after the earlier steps). `discard` and `moveSelected` cost steps are picks too (`requirement.source`, `requirement.costLabel`); a "this card" move (`selector.name === "__self"`) is not.
   - `candidates` are exactly the cards `perform` would accept (`targetCandidates`: "cannot be picked", "must be picked", the picker, the pick size); the card being played is never offered. `blocked` are the cards the selector matches that may not be picked. Cards another `distinctPicks` declaration already took move from `candidates` to `blocked`.
   - `min` / `max` (and `orNone`, set when an empty answer is also legal: `minCount` on an optional pick, EU1) come from the engine's own pick range (the one `validateTargetDeclarations` uses): an optional pick may take none, except while a `mustBePicked` card is on offer (Q19: `min` becomes 1), and an optional pick that feeds a cost (`depleteSelected` / `sacrificeSelected`) with an expression for its count stays mandatory. A mandatory pick with fewer candidates than its count reports `min` = the candidates there are (`perform` still refuses it).
   - `forced`: every candidate must be taken (`min` equals the number of candidates) and no distinct rule could refuse them, so a client may take `candidates` without asking. Whether to still show the greyed-out `blocked` cards first is the client's choice.
   - `distinctNames` / `distinctTrades` / `distinctTypes`: the pick may not hold two cards that share a printed name / trade / type. Enforce it while choosing.
   - Never listed: a count of 0; an implied pick (Q13: the card never says "pick") with no more candidates than its count; an optional pick with nothing to pick; a random-sized pick (Hammer Smash: the engine rolls, then opens `selectDeployTargets`); and anything the engine asks itself after the dispatch (`nameValue`, `oneOf`, `otherPlayerChooses`, `distribute`, `alternatingPay`, a FLIP UP rider pick).
   - `declinable`: an optional deck search can be declined outright (`declined: true`, which writes `selected["__declined:<id>"] = []`, `declinedKey(id)`): no search, no shuffle. `cardIds: []` without it means "searched and found nothing" (which shuffles).

`engine.getSelectionRequirements({ sourceId, controllerId, pickerId?, abilityId?, declarations, costs, selected, variables, named?, variableSource?, context? })` is the same list of picks for a pending-choice sub-selection that has no play to read them from (`selectTargets`, `selectDeployTargets`, `chooserSelectsTarget`, `useTargetAbility`). `pickerId` is who chooses. With no action, a `pick` cost step is judged against the board as it stands. Pass `variableSource` (the ability's `variables`, `variableBounds`, `condition`) to get the "choose X" gate as well. **For a prompt, pass `context: pending.context`**: the picks are then judged in the prompt's own resolution context, exactly as `resolvePendingChoice` judges the answer (the triggering `event` for "less strength than THAT character had" on Gosche's Restoration Fortress, The Stone of Triumph, Voidal Tactician, I Drink Your Milkshake!; the effect's earlier picks). The explicit fields take precedence, and a `selected` entry in the context for a declaration being asked is ignored. Without it, an event-reading selector has no event and lists nothing (`selection-context.test.ts`). A trigger's `selectTargets` prompt carries the same thing as `pending.context` (Totally Random Kid: "an item with X or less numeric cost", X = the damage dealt; `selection-context-battle.test.ts`); `chooserSelectsTarget` always had it.

`answerPlayRequirement(action, answer)` is a pure helper that folds one answer (`{kind:"mode"|"flipUpOption"|"variables"|"pick", ...}`) into a copy of the action. `declinedKey(declarationId)` is exported from the package root.

### Dry runs (`checkAction`, `previewNumber`)

`engine.checkAction(action)` performs the action on a copy and returns `{ ok: true }` or `{ ok: false, error }` with the engine's own refusal. A prompt the action raises (a name still to give) counts as accepted. The live game, its `rngState` and its log are untouched, whatever the action rolls or shuffles.

`engine.previewNumber(expression, context)` evaluates a `NumberExpression` without side effects, on a copy. It returns `undefined` for anything that would roll (`random`, `coinFlip`, a `random` target, however deeply nested) and for an expression that cannot be read yet. Use it in place of `evaluateNumber` anywhere outside a `perform`: `evaluateNumber` on the live engine consumes the live random stream and emits events for a `random` / `coinFlip`.

### Known differences (queries versus the answer checks of a pending choice)

`getSelectionRequirements` describes a pick the way a play's own check (`validateTargetDeclarations`, via `pickRange` and `targetCandidates(selector, context, pickerId, max)`) judges it. The answer checks of two pending choices are older, simpler copies and differ in two places. A client that follows `getSelectionRequirements` can offer a pick that `resolvePendingChoice` then answers differently:

- **`selectTargets` (a trigger's targets) and `selectDeployTargets` (a deploy's deferred picks)** compute the minimum as `optional ? 0 : max`: they never raise it to 1 for a card that must be picked (`mustBePicked`, Q19). `getSelectionRequirements` (like a play and `chooserSelectsTarget`) does raise it: an optional pick of up to 2 characters, while the opponent's Ferrous Ferret is a legal pick, reports `min: 1`, yet `selectTargets` accepts an empty answer.
- The same two checks build the legal pool with `targetCandidates(selector, context)`, whose `pickCount` defaults to 1, and they never call `assertMustBePicked`. For a pick of several cards the pool therefore collapses onto the `mustBePicked` cards alone (here, just the Ferret), where `getSelectionRequirements` keeps the whole pool and only requires the forced card to be among the picks. In the example, `[ferret, otherCharacter]` is a good answer by `getSelectionRequirements` and a refused one (`Illegal target`) in `selectTargets`.

Only a `mustBePicked` card in the pool shows either difference. The answer to follow is the play's: `chooserSelectsTarget` already matches it.

### More client queries
- **`cardPlayed.viaFlipUp`** (event field, read-only data): set when the card was played by paying its FLIP UP cost, absent on any other play. Clients use it for wording ("flips up" in a recent-events line, tactics included); nothing in the engine reads it (the `deployedViaFlipUp` condition reads `cardEnteredPlay.viaFlipUp` or the stack context, as before).

Six more read-only queries. None changes what `perform` accepts or says: the picks and costs they judge are checked by the same private functions as before, and the agreement tests (`src/engine/__tests__/more-client-queries.test.ts`) compare each with `perform` on a probe, including a sweep over the whole card catalog.

- **`checkSelection(input, declarationId, cardIds) -> { ok: true } | { ok: false; error }`** (Q1): the engine's own validation of one pick of a `SelectionRequirementsInput`. A declaration is judged by `validateDeclarationPick` (the loop body `validateTargetDeclarations` runs for every declaration of a play): count range (`pickRange`, so a card that `mustBePicked` raises the minimum), no card twice, every card a legal candidate (`targetCandidates` for `input.pickerId`), the card that must be picked, distinct names / trades / types. A `discard` / `moveSelected` cost step that takes cards (the `PickStep`s with `source: "discardCost" | "moveCost"`) is judged by `assertCostPickSelection`, the check `payCost` makes. The declaration's entry in `input.selected` is replaced by `cardIds`; the other entries, `variables`, `named` and `input.context` are what the pick is judged in (a prompt: pass `context: pending.context`). `error` is the engine's own sentence.
  - A pick with a `pick` cost step is judged alone (as `payCost` does), every other declaration with the up-front ones (the "Pick 2" `distinctPicks` check and implied picks, as the play does). A pick after a cost step is judged on the board AFTER the earlier steps only when `input.play` is set (they are rehearsed on the probe, like `getPickCandidates`); without it, on the board as it stands (the same limit `getSelectionRequirements` has).
  - It judges ONE pick: an open "choose a number" or another missing pick is not its concern. It answers `{ ok: false }` (not a throw) for a declaration id the input does not have.
  - The agreement is with a play's own checks and with `chooserSelectsTarget`; for `selectTargets` / `selectDeployTargets` the "Known differences" above still apply (their answer checks are older copies; nothing was changed).
- **`checkPlaySelection(action, declarationId, cardIds)`**: `checkSelection` for a play, ability use or FLIP UP that has not been dispatched. The picks, costs and "choose a number" source come from the card (`playBlockOf`, the same block `getPlayRequirements` reads), the other answers from `action`. `{ ok: false }` for a modal card with no `mode` yet and for an ability the card does not have.
- **`getPlaySelectionInput(playerId, cardId, mode?) -> SelectionRequirementsInput`** (Q2): the engine builds the input for a card's own play block: its declarations (including the ATTACH TO host pick, with `attachToController`), costs, and the `variableSource` (variables, bounds, play condition), nothing answered yet. For plays with no action to read: a reveal-from-hand deploy (Witty Worm), a free deploy, a play built from a prompt. The `play` field it carries (a new optional field of `SelectionRequirementsInput`) makes the card Being Deployed (CR 604.1) and lets a pick after a cost step be judged after the earlier steps, so `getSelectionRequirements(getPlaySelectionInput(p, c, mode))` equals `getPlayRequirements({ type: "playCard", playerId: p, cardId: c, mode })` for every card of the catalog and every mode (a test sweeps it). `mode` omitted on a modal card is its first mode (the play itself would ask); a random-sized pick (Hammer Smash) is left out, as `getPlayRequirements` leaves it. Throws for a card not in the game or a mode the card does not have.
- **`SelectionRequirementsInput.play?: PlayAction`** (additive): see above. `getSelectionRequirements` with it set is `getPlayRequirements`; without it nothing changed. The exported type `SelectionCheck` is the answer of `checkSelection`.
- **`getResourcePlayFaces(playerId, cardId) -> { canFaceUp, canFaceDown, forcedFaceDown?, reason? }`**, **`canPlayResourceFaceUp(playerId, cardId)`**, **`canPlayResourceFaceDown(playerId, cardId)`** (Q3): the `playResourceCard` face rules for any card, not only inside the Develop Rule: the card is in that player's hand; face-up needs a resource card that is not `faceDownOnly`; face-down takes any card (CR 203.2). `forcedFaceDown` is `"notAResource"` / `"faceDownOnly"`, `reason` the engine's refusal for face-up. A card not in that player's hand allows neither side. Shared with `playResourceCard` through `resourceFaceProblem`, so it agrees with the `playResource` effect's prompts for every card in the catalog.
- **`getMulliganLimit(playerId) -> number`** (Q4): the most cards the seat may send back: its hand size when the setup is in the mulligan step, its faction offers a replace-any mulligan (`hasReplaceAnyMulligan`, the check `mulligan` makes) and its decision has not been made; 0 otherwise. It answers for a seat whose turn has not come yet, which `previewMulligan` still refuses (kept as it was); `previewMulligan(...).maxCards` is this number. A client needs no hand-size fallback.
- **`previewBlockOptions(attackerPlayerId, attackerIds, target) -> BlockOptions | undefined`** (Q5): `getBlockOptions()` for an attack that has not been declared. It declares the attack on a probe with `declareAttack` itself (all its checks, the attack tax, anything the declaration triggers), lets both sides pass on the response windows, and reads `getBlockOptions` at the blocking step. `undefined` when `declareAttack` would refuse the declaration, or when the probe does not reach the blocking step (the battle ends first, or a prompt has to be answered). It is the board as it stands: it is not asking "if it were their turn", so a non-active player gets `undefined`. The live game, its `rngState` and its log are untouched.
- **`DeckConstructionIssue.count` / `.max`** (Q6): a `copyLimit` issue carries how many copies the decklist holds and the `getMaxCopies` limit (always a number there). Other kinds carry neither.
- **Refactors behind them** (behavior-preserving; every existing suite is the proof): `validateTargetDeclarations` is `assertPicksDifferent` + `resolveImpliedPicks` + `validateDeclarationPick` per declaration; the `discard` and `moveSelected` cases of `payCost` share `assertCostPickSelection` (same messages); `getPickCandidates` and `checkSelection` share `rehearseCostsBefore`; `collectPlayRequirements` takes its block from `playBlockOf`; `getSelectionRequirements` and `checkSelection` share `selectionBasis`; `playResourceCard` and `getResourcePlayFaces` share `resourceFaceProblem`; `mulligan` and `getMulliganLimit` share `hasReplaceAnyMulligan`.
