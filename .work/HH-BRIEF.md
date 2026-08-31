# Holy Heist classification brief (shared by all 3 slices)

You are classifying cards from **Holy Heist** for the data-driven engine
coverage effort. Read this whole file, then your assigned slice file
(`.work/hh-slice-<N>.md`), then produce `.work/classify-hh-<N>.json` as
described at the bottom.

## What "classify" means

For each card decide **how its printed text maps onto the engine's
data-driven vocabulary** — WITHOUT writing final `behavior` JSON. You produce
a plan + a gap list:

- `behavior.shapes`: terse english-ish sketches, one per ability/paragraph
  (e.g. `"triggered:cardEnteredPlay + sourceIsEventCard -> optional pick
  character -> deplete it"`, `"continuous self: +2 strength while depleted"`,
  `"activated: deplete self, pay 2 -> draw 2, bottom a hand card"`).
- `metadata`: `unique` (designation slug lowercased — "UNIQUE AKASHIC
  OBJECT" -> `"akashic object"`), `attachTo` (`"character"`/`"item"` if
  "ATTACH TO X"), `resourceProvides` (`["rage"]` etc. — only if the card has
  a `PROVIDES:` line), `keywords` (static keyword lines only:
  `covert`/`aggro`/`tactical`).
- `engineCapability`: capability ids this card NEEDS that are **not already
  implemented**. Check "Already implemented vocabulary" AND "Holy Heist new
  capabilities" below before adding one. If existing/known vocab covers it,
  `[]`.
- `proposedCapabilities`: for any id in `engineCapability` NOT already in the
  two lists below, add `{ id, kind, spec, why }` (`kind` = which
  `src/types` union it extends; `spec` = one buildable paragraph;
  kebab-case id; reuse an existing id if two of your cards need the same
  thing).
- `parityGaps`: only if the card needs a whole game-format refactor
  (true multiplayer, alternate win con, "outside the game"). Rare here.
  "Pick X players" in a 2-player engine is NOT a parity gap — it just
  degenerates to the one opponent; note that and move on.
- `confidence`: `high` / `medium` (a clause is fuzzy) / `low` (genuine rules
  ambiguity — explain in `notes`).
- `notes`: rules questions, `RULES.md` / CR cites, ambiguities, deviations.
  `RULES.md` is a distilled reference; for anything it doesn't settle read
  the PDFs in `docs/` (`Comprehensive-Rules-2.5.pdf` = CR §; the
  `The-Spoils-Rules-FAQ-2.0.pdf`) — the Read tool opens PDFs with `pages`.
- `status`: `classified` normally; `blocked` only if it needs a capability
  NOT in either list and NOT in your `proposedCapabilities` (shouldn't
  happen — propose it instead); `wontImplement` (+ `notes` reason) if
  genuinely unmodellable in a 2-player single-game engine; `vanilla` if the
  text needs no behavior.
- `rulesAudited`: always `true`.

Prefer **extending the closed vocab with a small new member** over per-card
logic — but do NOT invent a capability when existing primitives compose.
Note the composition in `shapes` instead.

## Already implemented vocabulary (do NOT propose these)

**Effects:** draw, playResource (optional `player`), dealDamage,
modifyInfluence, moveCard (any zone; `position` top/bottom for deck),
destroy, deplete, restore, addCounter, removeCounter, createModifier (stat
add/set/multiply; duration permanent/untilEndOfTurn/whileSourceInPlay),
takeControl, removeFromGame, forEach (selector OR prior `selected`),
attachTo (re-attach), flipFaceDown, putIntoPlay (from deck/discard/void;
`faceDown`; `borrowed`), deployFromZone (deploy a face-down/discard card;
`ignoreThreshold`; `free?: boolean | Condition`), grantResourceIcons
(phantom icons to a PLAYER, duration), grantProvides (card-level PROVIDES,
duration; `icon` may be `{fromNamed}`), reduceThreshold, detach,
preventDamage (reduce/redirect shield, fixed `amount`), scheduleEffect
(`startOfNextTurn`/`endOfTurn`/`endOfBattle`, `condition?`), useAnyAbility,
useTargetAbility (`times`), grantKeyword, grantRestriction, restrictPlay
(`cardType`/`flipUp`), modifyOutgoingDamage, if, shuffleDeck,
chooserSelectsTarget, chooserSelectsOption (EffectOption[] w/ optional
`label`), chooserSelectsNumber, lookAndReorder (top N; `to` top/bottom;
`chooser`), reduceNextCost (`cardType?`), deployForFree (from hand,
`maxCost`), distributeAmong, mill (`to` discard/removed), rememberTarget,
duplicate, partitionAndPick, retargetExtraCost, setCardType (ADDS a type
for a duration; `grantStats`), removeCardType, bind, terminate
(`target`/`othersOnStack`/`respondedItem`), setRestoreLock, setDamage,
removeFromBattle, addToBattle, forEachPlayer, nameValue
(`subtype`/`cardName`/`resourceIcon`), mayPay, anyPlayerMayPay,
alternatingPayLoop, createTokens (inline TokenSpec; `effects?` per token),
skipRestoreRule, skipNextRestore, modifyNumericCost.

**Costs:** payResources (NumberExpression), deplete, discard, destroy,
removeCounter, depleteSelected, sacrificeSelected, removeFromGame,
dealDamage (spend own structure), loseInfluence, oneOf (auto-pays first
payable branch — "Pay 3 or shuffle your deck", "Pay 4 or discard a
non-resource Rogue card").

**Conditions:** and/or/not, sourceInZone, sourceIsEventCard,
eventCardControlledBy, targetExists, cardTypeIs, cardTradeIs, hasUnique,
hasAbility, hasAttachment (`ofType?`), statCompare, counterCompare,
numberCompare, inBattle (`role?`), sourceIsDamageSource, cardMovedFromZone,
cardMovedToZone, battleRole, eventPlayerIs, targetInSelection, eventOrdinal,
deploySameNameThisTurn, respondingTo (`cardType?`, `respondsTo`
card|ability), respondedToPicked, deployedViaFlipUp, cardNameEquals,
bottomedInMulligan, cardProvides, isStaple, cardDepleted, cardTypeEquals,
sharesBattlePartyWithSource, linkedCardInPlay, sourceIsFaceDown, isExtremum,
isActivePlayer, battleActive, cardSubtypeIs, inPlaySinceTurnStart, uniqueIs,
assignedDamageThisTurn, inflictedDamageToFactionThisTurn.

**NumberExpressions:** number, stat (live), counter, count (of a
CardSelector), add, multiply, variable (player X), random (min/max),
cardCost (printed numeric cost), printedStat (printed base stat),
resourceIcons, divide (up/down), modulo, selectionCount, conditional
(if/then/else), sumStat (`selector`, `stat`), thresholdIconCount,
eventDamageAmount.

**TargetRef:** source, attachedTo, eventCard, {selected id}, {card id},
{random selector}, {deckPosition player/from/index}, {respondedToCard},
{damageSource}, {factionOf player}, {remembered key}.

**PlayerRef:** controller, owner, activePlayer, opponent, {player id},
{ownerOf target}, {controllerOf target}.

**CardSelector:** controller/owner (self/opponent/any), zone (DEFAULT =
in-play only; may be a single Zone, a `Zone[]`, or `"any"` — so "in your
void or discard pile" is `zone: ["void","discard"]`), type, name (exact),
uniqueDesignation (string|string[]), subtype, subtypeVar, depleted, fromTop,
staple, faceDown (true = match face-down in-play by real type), conditions
(Condition[] w/ candidate bound to `{selected id:"__candidate"}`).

**Card-def siblings:** `flipUp:{cost,threshold,effects?}`, `unique`,
`attachTo`, `revealFromHand:{cost,threshold?,effects?}`,
`selfDisposition:{to:"faceDownResource"|"hand",condition?}`,
`behavior.keywords`, `behavior.onPlay:{condition?,costs?,targets?,effects?,
costAdjust?}` (non-tactic EXTRA COST / ETB), `behavior.noResponse`,
`behavior.modes:[{label?,condition?,costs?,targets?,variables?,
variableBounds?,effects?}]` (modal tactic, `mode:N` on playCard),
`behavior.developDrawReplacement`.

**Ability knobs:** ActivatedAbility.{activationZone (discard/hand/void),
usableBy ("controller"|"anyPlayer"), threshold (icon gate), condition,
costs, targets, effects, variables, variableBounds, usesPerTurn ("use this
only N times each turn" / "only once each turn"), fromFaceDown}.
TriggeredAbility.{event, triggerZone, condition, targets, effects}.
ContinuousAbility.{activeZone (e.g. "hand"), condition, modifiers, keywords,
suppressKeywords, suppressAllAbilities ({target?|selector?} — "has no rules
text" / "loses all other rules text"), restrictions, costModifiers
(delta + `minCost`), damageModifiers ({selector, sourceSelector?,
battleOnly?, delta}), redirects ([{from,to}] — all damage AND all
leave-play of `from` -> `to`), ignoresRulesTextFrom, uniqueGrant,
grantedAbilities (triggered bodies fire; **activated granted bodies wired**
too now), grantFlipUp}. ReplacementAbility.{replaces ({event:"moveToZone",
zone, cardType?, controlledBy?, by?} | {event:"destroy", cardType?,
controlledBy?, by?}), condition, optional, optionalCost, effects}.

**Events (triggered `event`):** turnStarted, turnEnding, cardPlayed,
cardEnteredPlay, cardMoved, cardDestroyed, cardDepleted, cardRestored,
resourcePlayed, cardsDrawn, deckSearched, damageDealt, abilityActivated,
battleStarted, battleEnded, characterAttacked, characterBlocked,
attackerBlocked, counterChanged.

## Holy Heist — new capabilities (these are BEING BUILT this pass; reference
them freely by id; do NOT re-propose under a different id)

The engine team has pre-identified these gaps. If a card in your slice needs
one, put its id in `engineCapability`. You do NOT need a
`proposedCapabilities` entry for these — they're already speced. Only add a
`proposedCapabilities` entry for something NOT on this list.

- **`battle-damage-assignment-replacement`** (ability/battle/effect) — a way
  to intercept how a character assigns/receives *battle damage*: "if the
  picked character would inflict battle damage, inflict that damage to
  itself instead" (Don't Trip), "if the attached character would assign
  battle damage it assigns damage equal to its numeric cost instead of its
  strength" (Ocular Dispersal), "if this would inflict battle damage to a
  character, put that character into its owner's hand instead" + reverse
  (Vexing Nullifier). NOTE: "battle damage to this while attacking reduced
  to 0" (Lingamite Descendant) is already covered by `damageModifiers` +
  an `inBattle` condition — do NOT flag it.
- **`damage-reduction-optional-cost`** (ability/effect/state) — "when
  damage would be inflicted to <selector card I control>, you may pay
  <cost> to reduce the amount by N" (Cathédrale de Mau — locations; +
  expensive characters). A `DamageModifierDefinition` gains an optional
  `optionalCost` that pauses for a yes/no before the reduction applies.
- **`heal-damage`** (effect) — `{ type:"healDamage", target, amount }`
  removes up to `amount` damage markers (floor 0). "Remove 2 damage markers
  from the card" (Asbestos Drywall). `setDamage` is absolute-only.
- **`cards-discarded-event`** (event/expression) — `GameEvent
  cardsDiscarded { playerId, count }` per discard batch + a way to read the
  count (`eventDiscardCount` expression or reuse). "When an opponent
  discards any number of cards, +X/+X where X = number discarded"
  (Bewilderbeast). Parallel to `cardsDrawn`.
- **`grant-keyword-to-player`** (effect/state) — `{ type:
  "grantKeywordToPlayer", player, keyword, duration }` — every character
  `player` controls (now AND deployed later this turn) has `keyword` for
  the duration. "This turn, characters you control and deploy can attack
  even if they have not been in play under your control since the start of
  the turn" (Hasty Pursuit, Change of Tactics FLIP UP rider) = grant
  `aggro`. NOTE: a card whose whole first line is just "This card can
  attack even if it has not been in play ... since the start of the turn"
  (Guardforce Aggromajig) is exactly the `aggro` keyword in this engine
  (RULES.md §9 — aggro here is *only* the haste exemption, no "must
  attack"); author it as `behavior.keywords:["aggro"]`, NOT a capability.
- **`usable-by-opponent`** (ability) — `ActivatedAbility.usableBy` gains
  `"opponent"` (only the opponent may activate). "Only an opponent may use
  this ability" (iDumb De-Itemizer RESET).
- **`suppress-abilities-effect`** (effect/state) — `{ type:
  "suppressAbilities", target, duration }` — a *duration'd* version of
  `suppressAllAbilities` (today continuous-only). "This turn, this card
  loses all rules text" (iDumb De-Itemizer RESET).
- **`must-be-picked`** (ids/state) — `Restriction "mustBePicked"` — inverse
  of `cannotBePicked`: any target declaration that *could* legally pick it
  MUST. "Anything that can pick the attached character must pick it"
  (Ferret Oil Coating).
- **`persistent-attachment`** (cards/state) — a flag so an "Attach to X"
  item is NOT destroyed by the state-based check when its host leaves play
  (it stays in play, unattached). "This card does not leave play if the
  attached card leaves play" (Everlasting Blade of Light).
- **`duration-until-next-turn`** (ids) — `Duration { type:
  "untilStartOfNextTurn" }` — expires at the start of the source
  controller's next turn. "until the start of your next turn" (Unstable
  Modification's per-turn modal choice — compose: `triggered` turnStarted +
  `chooserSelectsOption` 3 branches, each a `createModifier`/`grantKeyword`
  with this duration).
- **`schedule-opponent-turn`** (effect) — `scheduleEffect.when` gains
  `"startOfOpponentNextTurn"`. "At the start of your opponent's next turn
  ..." (Final Countdown).
- **`distinct-names-target`** (expression/choice) — `TargetDeclaration {
  distinctNames?: boolean }` — a multi-count declaration whose selections
  must all have distinct printed names. "N cards with different names"
  (Cheats, Profane Proposal).
- **`random-from-selection`** (effect/choice) — `{ type:
  "randomFromSelection", selected, count, effects }` — resolve `effects`
  for `count` uniformly-random members of an existing `selected` set.
  "randomly put 2 of those [4 revealed] cards into their discard pile"
  (Cheats).
- **`separate-into-piles`** (choice/effect) — a chooser splits an existing
  `selected` set into 2 piles, each pile gets a different disposition.
  "That player separates those cards into two piles. Put one pile into your
  hand and shuffle the other into your deck" (Profane Proposal).
- **`deploy-from-void-permission`** (cards/state/engine) — a persistent
  per-player grant that makes specific voided cards playable as though in
  hand (optionally ignoring threshold), for the rest of the game. "For the
  rest of the game, you may deploy the voided cards as though they were in
  your hand even if you cannot meet their threshold" (Cheats).
- **`has-keyword-condition`** (condition) — `{ type:"hasKeyword", target,
  keyword }`. "while a player controls a character with COVERT" (Torchlight
  Sarcophyle); target filters "pick a character with COVERT" (Predatory
  Lamp, I See You!).
- **`replacement-affected-chooses`** (ability/choice) —
  `ReplacementAbility` gains `chooser?: "sourceController" |
  "affectedController"` so the optional choice + `optionalCost` are made by
  the affected card's controller, not the source's. "If a non-token
  character would enter play under an opponent's control, THEY may pay 1"
  (Phantasmagoric Tollbooth); "If this would be destroyed, any opponent may
  pay 2 -> they take control instead" (Unloyal Necromorph).
- **`prevent-next-damage-instance`** (effect) — `preventDamage` gains a way
  to negate the *whole* next damage instance regardless of size
  (`wholeInstance?: boolean` or `amount:"all"`). "the next time damage
  would be inflicted to the character, reduce it to 0" (Visible Loaf).
- **`name-trade`** (choice/selector) — `nameValue.valueKind` gains
  `"trade"` + `CardSelector.tradeVar` (string | string[]) matching a
  stored trade. "names 2 non-Universal trades ... search for a character
  that is one of the named trades" (Gathering of Unlikely Heroes).
- **`text-mentions-icon`** (condition/selector) — `{ type:
  "textMentionsIcon", target, icon }` — true when `target`'s printed
  `text` references that resource icon (`[V]` etc.). "Characters you
  control with a [V] icon in their rules text" (Marduun Ruins).
- **`exile-if-leaves-play-this-turn`** (effect/state) — a lighter
  `putIntoPlay` rider: remove the card from the game if it would leave play
  THIS TURN only (no unconditional end-of-turn removal, unlike `borrowed`),
  and applied to a linked pair. "If that card or this card would leave play
  this turn, remove both cards from the game instead" (Spurious
  Anthropologist).

If you hit a mechanic on NONE of the three lists, add a
`proposedCapabilities` entry with a clear spec. If two of your cards need
the same new thing, use one id.

## Recurring Holy Heist patterns (compose from existing vocab — for
consistency, classify these the same way every time)

- **"When a card that provides at least [V] enters play under your/an
  opponent's control, ..."** — a huge cycle (all the "Thabbashite ..."
  characters, Akashic Coin/Notes, Craniata Nester, Personal God Shrine).
  `triggered: event cardEnteredPlay, condition and(cardProvides(eventCard,
  volition, 1), eventCardControlledBy self|opponent)`. No capability.
- **"SERAPHIM FUSION — COST: ... Destroy this card. Pick a UNIQUE <X> you
  control. -- EFFECT: Search your deck for a card named "<Y>" and put it
  into play"** (Chum, Everlasting Blade of Light, Seriously Weird
  Crystalline Artefact) — `activated`: costs [destroy source, ...], targets
  [uniqueDesignation pick], effects [putIntoPlay from a `zone:"deck"
  name:"<Y>"` target declaration]. No capability.
- **"This card enters play with N tokens on it"** — `triggered
  cardEnteredPlay + sourceIsEventCard -> addCounter(source, token, N)`.
- **"This card gains 1 strength and 1 life for each token on it"** /
  **"loses 1/1 for each token"** — `continuous` self `modifiers` with
  `value: { type:"counter", target:"source", counter:"token" }` (add or
  multiply by -1).
- **"[R][R][R][R][R][R]: <effect>" / "[V][V][V]: <effect>"** (a bare
  icon-cost paragraph) — icon-gated `continuous` (`condition` a
  `numberCompare` of `resourceIcons` vs a literal) for a static buff, or an
  `activated` ability with a `payResources`-free icon `threshold` gate for
  a one-shot. Match the printed wording.
- **"This card enters play depleted"** — `triggered cardEnteredPlay +
  sourceIsEventCard -> deplete source`. No capability.
- **"Put this card into play under its owner's control as a face-down
  resource instead of into their discard pile"** — tactic
  `selfDisposition: { to: "faceDownResource" }`.
- **"RECUR: [D][D][D] — COST: Use this only if this card is in your discard
  pile. Pay 1. Remove this card from the game. ..."** — `activated`
  `activationZone:"discard"`, `threshold:"ddd"`, costs [payResources 1,
  removeFromGame source].
- **"Pick a player that controls more resources than you"** — a faction-card
  target (`type:"faction"`) with `selector.conditions` a `numberCompare` of
  two `count` selectors (`zone:"play", type:"resource"` owned by
  `__candidate`'s controller vs. by self). No capability.

## Output

`.work/classify-hh-<N>.json` — an array, one object per card in your slice:

```json
[
  {
    "id": "<card id>",
    "name": "<card name>",
    "status": "classified",
    "rulesAudited": true,
    "behavior": { "needed": true, "shapes": ["...","..."],
      "reusesProvenShape": true, "newTestNeeded": false },
    "metadata": { "unique": null, "attachTo": null,
      "resourceProvides": null, "keywords": [] },
    "engineCapability": [],
    "proposedCapabilities": [],
    "parityGaps": [],
    "confidence": "high",
    "notes": "..."
  }
]
```

`reusesProvenShape: false` (=> also `newTestNeeded: true`) ONLY when the
card needs a brand-new ability SHAPE that will want its own
`card-behaviors.test.ts` case. A card that only needs a new *capability* but
a conventional shape stays `reusesProvenShape: true`.

Be precise and terse — this is a planning artifact, not prose. Report at the
end: card count, any card you could not classify confidently (+ why), and
any capability you proposed that wasn't on the list.
