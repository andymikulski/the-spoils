# Ungodly Mess — classification brief (shared by all 3 slices)

You are classifying cards from **Ungodly Mess** for the data-driven engine
coverage effort. Read this whole file, then your assigned slice file
(`.work/um-slice-<N>.md`), then produce `.work/classify-um-<N>.json` as
described at the bottom.

Ungodly Mess is a **Seed-era** set (post–1st Edition, contemporaneous with
Shade of the Devoured Emperor / Holy Heist). It leans on: FLIP UP, RECUR
(activate-from-discard), token accrual, staple-resource counting, "blade of
questionable morality" Uniques (the FEALTY cycle), the "Gosche's ___"
location cycle, the "God's Blessing of ___" attach-mutation cycle, and
Thabbashite `[X][X][V][V]` icon-gated characters. ~85% of cards map straight
onto existing vocabulary.

## What "classify" means

For each card decide **how its printed text maps onto the engine's
data-driven vocabulary** — WITHOUT writing final `behavior` JSON. You produce
a plan + a gap list per card:

- `behavior.shapes`: terse english-ish sketches, one per ability/paragraph
  (e.g. `"triggered:cardEnteredPlay + sourceIsEventCard -> addCounter(source,
  token, 2)"`, `"continuous self: +1str/+1life per token (modifier value =
  {counter source token})"`, `"activated RECUR: activationZone discard,
  threshold 'g', costs [payResources 1, removeFromGame source], targets
  [character in discard], effects [putIntoPlay -> play under controller]"`).
  Name the effect/condition/expression types you'd use.
- `metadata`: `unique` (designation slug lowercased — "UNIQUE MCLARGEHUGE"
  -> `"mclargehuge"`; "UNIQUE GOR-BLACH" -> `"gor-blach"`; note the printed
  designation, which sometimes differs from the card name — Rudo Mangod is
  "UNIQUE RUDOLPHUS"), `attachTo` (`"character"` if "ATTACH TO CHARACTER",
  `"item"` etc.), `resourceProvides` (only if a `PROVIDES:` line — e.g.
  Drainbow Crash `["elitism","elitism"]`; use full icon names
  rage/greed/elitism/deception/obsession/volition), `keywords` (static
  keyword lines only: `covert`/`aggro`/`tactical`; a bare "COVERT" / "TACTICAL"
  line -> that keyword. "can attack even if it has not been in play under
  your control since the start of the turn" IS `aggro` — RULES.md §9).
- `engineCapability`: capability ids this card NEEDS that are **not already
  implemented**. Check "Already implemented vocabulary" AND "Ungodly Mess new
  capabilities" below first. If existing vocab covers it (even by
  composition), `[]` and note the composition in `shapes`.
- `proposedCapabilities`: for any id in `engineCapability` NOT already in the
  two lists below, add `{ id, kind, spec, why }` (`kind` = which
  `src/types` union it extends; `spec` = one buildable paragraph;
  kebab-case id; reuse an id if two cards need the same thing). This should
  be rare — the list below is meant to be complete.
- `parityGaps`: only for a whole game-format refactor (true multiplayer,
  alternate win con that the engine's influence-based win check can't host,
  "outside the game"). "Pick X players" / "pick an opponent" / "each
  opponent" in a 2-player engine just degenerates to the one opponent — NOT
  a parity gap.
- `confidence`: `high` / `medium` (a clause is fuzzy) / `low` (genuine rules
  ambiguity — explain in `notes`).
- `notes`: rules questions, `RULES.md` / CR cites, ambiguities, deviations,
  and any **concession** (an approximation the vocab forces). `RULES.md` is
  the distilled reference; for anything it doesn't settle read the PDFs in
  `docs/` (`Comprehensive-Rules-2.5.pdf` = CR §; `The-Spoils-Rules-FAQ-2.0.pdf`).
  The Read tool opens PDFs with `pages`.
- `status`: `classified` normally; `wontImplement` (+ `notes` reason) only if
  genuinely unmodellable in a 2-player single-game engine; `vanilla` if the
  text needs no behavior (plain keyword-only / french-vanilla stat line /
  a pure deckbuilding rule with no in-game effect — e.g. "you may include as
  many copies of this card in your deck as you want" is `vanilla`, note it).
  Do NOT use `blocked` — if something needs a capability not in either list,
  propose it.
- `rulesAudited`: always `true`.

Prefer **extending the closed vocab with a small new member** over per-card
logic — but do NOT invent a capability when existing primitives compose.
Note the composition in `shapes` instead.

## Already implemented vocabulary (do NOT propose these)

**Effects:** draw (`amount` a NumberExpression — "draw a card for each
character in play" = `draw {amount:{count selector}}`), playResource
(optional `player`), dealDamage (single TargetRef — "inflict 1 damage to all
characters" = `forEach {selector, effects:[dealDamage __candidate]}`),
modifyInfluence, moveCard (any zone; `position` top/bottom for deck),
destroy, deplete, restore, addCounter, removeCounter, createModifier (stat
add/set/multiply; duration permanent/untilEndOfTurn/untilStartOfNextTurn/
whileSourceInPlay), takeControl (`duration?`), removeFromGame, forEach
(selector OR prior `selected`), forEachPlayer, separateIntoPiles,
randomFromSelection, grantVoidPlay (persistent per-card "deploy this voided
card as though from hand"; `ignoreThreshold?`), attachTo (re-attach),
flipFaceDown, putIntoPlay (from deck/discard/void; `faceDown?`; `borrowed?`;
`controller`), deployFromZone (deploy a face-down/discard/deck card; `free?:
boolean | Condition`; `ignoreThreshold?`), deployForFree (from hand;
`maxCost`; `free?: boolean` — false = still pay numeric cost; `count?`),
grantResourceIcons (phantom icons to a PLAYER, duration), grantProvides
(card-level PROVIDES, duration; `icon` may be `{fromNamed}`), reduceThreshold
(runtime reduction consumed by next deploy), reduceNextCost (`cardType?`),
detach, preventDamage (reduce/redirect shield; `wholeInstance?`),
scheduleEffect (`startOfNextTurn`/`startOfOpponentNextTurn`/`endOfTurn`/
`endOfBattle`, `condition?`), useAnyAbility, useTargetAbility (`times`),
grantKeyword, grantRestriction, grantKeywordToPlayer, suppressKeyword,
suppressAbilities (duration'd loss-of-all-rules-text), transformBattleDamage
(`setAmount`/`redirectToSelf`/`bounceOther`/`bounceSelf`), modifyOutgoingDamage,
modifyNumericCost, if, shuffleDeck, chooserSelectsTarget, chooserSelectsOption
(EffectOption[] w/ optional `label`), chooserSelectsNumber, lookAndReorder
(top N; `to` top/bottom/split; `chooser`), distributeAmong, mill (`to`
discard/removed), rememberTarget, duplicate, partitionAndPick,
retargetExtraCost, setCardType (ADDS a type for a duration; `grantStats`),
removeCardType, bind (capture a NumberExpression into a variable NOW so it
survives the source card leaving play), terminate (`target`/`othersOnStack`/
`respondedItem`; `disposition?: "discard"|"hand"`), setRestoreLock, setDamage,
healDamage, removeFromBattle, addToBattle, nameValue
(`subtype`/`cardName`/`resourceIcon`/`trade`), mayPay, anyPlayerMayPay,
alternatingPayLoop, createTokens (inline TokenSpec; `effects?` per token —
this is how "put N Micromajig tokens into play" is authored), skipRestoreRule,
skipNextRestore, grantAbilitiesFrom (snapshot-copy another card's ability
bodies onto a target — Skin Suit), flipCoin (`winEffects`/`loseEffects`;
emits `coinFlipped`), lockAbilityThisTurn, initiateAttack, auctionForCard,
restrictBlockers / restrictBlockersToChosen.

**Costs:** payResources (NumberExpression), deplete, discard, destroy,
removeCounter, depleteSelected, sacrificeSelected, removeFromGame, dealDamage
(spend own structure), loseInfluence, moveSelected (to any zone; `shuffle?`),
shuffleDeck, oneOf (auto-pays first payable branch — "Pay 3 or destroy a
resource you control").

**Conditions:** and/or/not, sourceInZone, isActivePlayer, battleActive,
battleRole (`attacker`/`defender`), inBattle (`target`, `role?`),
sourceIsEventCard, eventCardIs, eventCardControlledBy, eventPlayerIs,
targetExists, targetInZone, targetInSelection, cardTypeIs, cardTypeEquals,
cardTradeIs, cardSubtypeIs, cardNameEquals, cardNameIs, hasUnique, uniqueIs,
hasAbility, hasKeyword, hasAttachment (`ofType?`, `ofSubtype?`), statCompare,
counterCompare, numberCompare (the general "compare two NumberExpressions"),
cardDepleted, cardProvides, isStaple, isToken, isExtremum, textMentionsIcon
(true when a card's printed text contains a `[V]`-style icon token),
sourceIsDamageSource, cardMovedFromZone, cardMovedToZone, eventOrdinal,
deploySameNameThisTurn, respondingTo (`cardType?`, `respondsTo:"card"|
"ability"`), respondedToPicked, deployedViaFlipUp, bottomedInMulligan,
sharesBattlePartyWithSource, linkedCardInPlay, sourceIsFaceDown,
inPlaySinceTurnStart, assignedDamageThisTurn, inflictedDamageToFactionThisTurn,
damagedThisTurn (`by?`), destroyedByBattleDamage.

**NumberExpressions:** number, stat (live), printedStat, counter, count (of a
CardSelector), add, multiply, divide (up/down), modulo, variable (player X),
random (min/max), cardCost, resourceIcons (`{player, icon}` — icons of one
type a player controls), selectionCount, sumStat, sumCounters,
thresholdIconCount, eventDamageAmount, battlePartySize
(`attacking`/`blocking`/`ownParty`/`opposingParty`), extremumStat
(`min`/`max` of a live stat over a selector), conditional (if/then/else).

**TargetRef:** source, attachedTo (the card SOURCE is attached to),
attachmentHost (the card any `target` is attached to), eventCard, {selected
id}, {card id}, {random selector}, {deckPosition player/from/index},
respondedToCard, respondedAbilitySource, damageSource, {factionOf player},
{remembered key}, {respondedToPicked cardType}.

**PlayerRef:** controller, owner, activePlayer, opponent, {player id},
{ownerOf target}, {controllerOf target}.

**CardSelector:** controller/owner (self/opponent/any), zone (DEFAULT =
in-play only; may be `Zone[]` or `"any"` — "in your void or discard pile" =
`zone:["void","discard"]`), type, name (exact), uniqueDesignation
(string|string[]), subtype, subtypeVar, tradeVar, nameVar, depleted, fromTop
(top N of owner deck), staple (true = staple resources only), faceDown,
conditions (Condition[] w/ candidate bound to `{selected id:"__candidate"}`
— put `inBattle`, `hasKeyword`, `cardTradeIs`+`not`, `statCompare`,
`counterCompare`, `textMentionsIcon`, `sharesBattlePartyWithSource` here for
"an attacking character", "a non-Rogue character", "a character with a token
on it", "a character with a [V] icon in its rules text", etc.).

**Card-def siblings:** `flipUp:{cost,threshold,effects?}` (the `effects?` is
"FLIP UP: 5 [E] and you may pick an item; if you do destroy it" / "FLIP UP: 4
[G] and your faction gains 4 influence" — the rider after "and"), `unique`,
`attachTo`, `revealFromHand:{cost,threshold?,effects?}`,
`selfDisposition:{to:"faceDownResource"|"hand",condition?}`,
`behavior.keywords`, `behavior.onPlay:{condition?,costs?,targets?,effects?,
costAdjust?}` (non-tactic EXTRA COST / ETB; `costAdjust` = "reduce this
card's numeric cost by the number of [E] you control"),
`behavior.noResponse` ("your opponents cannot respond to this card"),
`behavior.modes:[{label?,condition?,costs?,targets?,variables?,
variableBounds?,effects?}]` (modal tactic — "Choose one of the following as
this card's rules text": Overindulge), `behavior.developDrawReplacement`,
`behavior.keepOnHostLeave`.

**Ability knobs:** ActivatedAbility.{activationZone
("discard"/"hand"/"void"), usableBy ("controller"|"anyPlayer"|"opponent"),
threshold (icon gate — this is how a bare "[D][D][D][D]: ..." / "RECUR:
[G][G]" clause is gated, NOT a payResources cost), condition, costs, targets,
effects, variables (**evaluated BEFORE costs** — "X is the number of tokens
on this card" when the same activation removes them; also "Choose a number
for X" via a `variable` the action supplies, bounded by `variableBounds`),
variableBounds, usesPerTurn ("use this only once/N times each turn"),
fromFaceDown}. TriggeredAbility.{event, triggerZone
("discard"/"void"/"deck"), condition, targets, effects}.
ContinuousAbility.{activeZone ("hand"/"play"), condition, modifiers,
keywords, suppressKeywords, suppressAllAbilities ({target?|selector?}),
restrictions, costModifiers (delta + `minCost`), abilityCostModifiers,
damageModifiers ({selector, sourceSelector?, battleOnly?, delta, minAmount?,
setTo?}), redirects ([{from,to}]), partyRestriction, blockRestriction
({minBlockingPartySize?, minBlockerSpeed?}), ignoresRulesTextFrom,
uniqueGrant, grantedAbilities ([{selector, abilities}] — **triggered AND
activated** granted bodies both fire/activate for the recipient;
**continuous** granted bodies do NOT yet — see new caps), grantFlipUp}.
ReplacementAbility.{replaces ({event:"moveToZone",zone,cardType?,
controlledBy?,by?} | {event:"destroy",...} | {event:"coinFlip",result:"lose"}),
condition, optional, optionalCost, chooser, effects}.

**Events (triggered `event`):** turnStarted, turnEnding, cardPlayed,
cardEnteredPlay, cardMoved, cardDestroyed, cardDepleted, cardRestored,
resourcePlayed, cardsDrawn, cardsDiscarded, deckSearched, damageDealt,
abilityActivated, battleStarted, battleEnded, characterAttacked,
characterBlocked, attackerBlocked (carries `blockerCount`),
blockingPartyFormed, counterChanged, coinFlipped.

## Ungodly Mess — new capabilities this pass (reference these freely by id;
do NOT re-propose under a different id)

The engine team has pre-identified these gaps from a first read of the set.
If a card in your slice needs one, put its id in `engineCapability`. You do
NOT need a `proposedCapabilities` entry for these.

- **`distinct-count-expression`** (expression) — `NumberExpression
  { type:"distinctCount", selector:CardSelector, by:"name"|"trade"|"type"|
  "subtype" }` = the number of DISTINCT values of `by` among cards matching
  `selector` (in-play by default; respects `selector.zone`). "for each
  different staple resource you control" (Elite Acrolos Engineer, Zenobia's
  Intervention, Whistleblower Policy — `by:"name"`, `staple:true,
  type:"resource", controller:"self"`), "the number of different staple
  resources that player controls" (Flesh Deliquesce, Thabbashite Penumbra,
  Wasted Wickedness, Thabbashite Convert? no — opponent-scoped, use
  `controller:"opponent"`), "the number of different trades among cards you
  control" (Wary Reunion — `by:"trade"`), "up to 2 different types of staple
  resources" (Strategic Vision — a target-declaration count, use
  `distinctCount` for the cap). Also composes the FEALTY gate below.

- **`conditional-threshold-slack`** (cards) — `CardDefinition.thresholdSlack?:
  { condition:Condition; amount:number }`. FEALTY: "While this card is in
  your hand and you control at least 4 staple resources of different trades,
  reduce this card's threshold requirement by any 3 resource icons." While
  `condition` holds (evaluated with the card in hand, controller = its
  holder), `meetsThreshold` for THIS card is satisfied if the holder is at
  most `amount` icons short **summed across all icon types** (CR: "reduce ...
  by any N resource icons" — pure count slack, no per-icon choice needed).
  `condition` = `{numberCompare left:{distinctCount selector:{controller:
  "self", staple:true, type:"resource"}, by:"trade"} operator:">=" right:4}`.
  Cards: Abram Ka-darbo Alkazin (×2 printings), Eustace Sensible Glutton,
  Ignatious Tactician Crafter, Jo Ciendeilio Iron Born, Rudo Mangod
  Fightful Adonis. (Arcane Ambush only *reads* whether you control these
  Uniques — that's `count` of `uniqueDesignation` selectors, no capability.)

- **`granted-continuous-ability`** (ability) — gather the **continuous**
  (and restriction / modifier / keyword) members of a
  `ContinuousAbility.grantedAbilities` block in the continuous recompute,
  sourced on the RECIPIENT card (so "All your characters gain 1 strength"
  inside the granted text scopes to the recipient's controller, and the
  aura dies with the recipient / the grantor). Parallel to the existing
  granted-triggered and granted-activated paths. The **"God's Blessing of
  ___"** cycle (Boost, Foresight, Moola, Readiness, Transfiguration) — each
  is a `tactic/mutation` with `ATTACH TO CHARACTER` that resolves into play
  attached (the `attach-tactic-resolves-into-play` path, already
  implemented) and then a `ContinuousAbility {grantedAbilities:[{selector:
  attachedTo-ish, abilities:[<the quoted rules text as triggered +
  continuous members>]}]}` grants the quoted block to the attached
  character. NOTE the God's Blessing quoted text mixes a `turnStarted`
  triggered ability with a continuous aura / restriction — model each
  paragraph as its own member. Yenessa Shipping LLP's "All items gain the
  rules text «At the start of your turn, you may pay 1. If you don't,
  destroy this card.»" is triggered-only and already works via
  `grantedAbilities` over a `{type:"item"}` selector — no capability.

- **`blocker-selector-restriction`** (ability, battle) — extend
  `ContinuousAbility.blockRestriction` with `blockerMustNotMatch?:
  CardSelector` — a character matching that selector is NOT a legal blocker
  against the source (enforced in declareBlockers, alongside the existing
  minPartySize / minSpeed). "This character cannot be blocked by characters
  with a [V] icon in its rules text" (Feckless Chronicler — selector
  conditions `textMentionsIcon volition`), "Characters with a token on them
  cannot block this card" (Silencer — selector conditions `counterCompare
  token >= 1`). Whole-party "cannot be blocked" stays the `cannotBeBlocked`
  keyword (Fleet Majig, P0p TEAMWORK rider).

- **`continuous-void-play`** (ability, state) — `ContinuousAbility` gains
  `voidPlay?: { selector:CardSelector; ignoreThreshold?:boolean }` — while
  the source is in play and `condition` holds, the controller may deploy
  cards matching `selector` (typically `{zone:"void", type:"tactic",
  owner:"self"}`) as though from hand. The continuous / conditional form of
  the one-shot `grantVoidPlay` effect (which grants for specific cards
  permanently). "While this card is depleted, you may deploy tactics in the
  void as though they were in your hand without meeting their threshold"
  (Voidal Tactician — `condition: cardDepleted source`).

- **`remove-instead-of-discard-rider`** (effect / state) — a scoped rider on
  a `deployFromZone`/`deployForFree` of a card such that if THAT card would
  next go to a discard pile it is removed from the game instead (one-shot,
  scoped to the deployed instance). "You may deploy the [discard-pile]
  tactic. If that card would go to its owner's discard pile, remove it from
  the game instead." (Ignatius CIPHER). Compose target: a
  `deployFromZone {..., thenExileOnDiscard:true}` flag, or a scoped
  replacement registered on the instance. (Interpret the Void's void-search
  and Ecto-Conduit's HARNESS are plain `moveCard -> void` + `grantVoidPlay`,
  NOT this.)

- **`prevent-all-damage-window`** (effect, state) — `Effect
  { type:"preventAllDamage", duration:Duration }` + a `GameState` runtime
  window list consulted in every damage-inflict path (reduce the amount to
  0). "This turn ... all inflicted damage is reduced to 0." (Limited
  Liability). Distinct from per-source `modifyOutgoingDamage` and per-card
  `preventDamage`.

- **`restrict-destruction-window`** (effect, state) — `Effect
  { type:"restrictDestruction", scope:"all", duration:Duration }` + a
  `GameState` runtime window — while active, the `destroy` effect is a
  no-op (destruction as a paid COST still goes through). "This turn, cards
  in play and cards deployed can only be destroyed by costs." (Limited
  Liability).

- **`continuous-play-restriction`** (ability, state) — `ContinuousAbility`
  gains `playRestrictions?: Array<{ player:"self"|"opponent"|"any";
  kind:"flipUp" | { cardType:CardType }; timing?:"notYourTurn" }>` — the
  standing / conditional form of the one-shot `restrictPlay` effect,
  consulted by `assertCanDeployAtCurrentTiming` / the flipUp action while
  the source is in play. "Your opponents cannot use FLIP UP" (Lockbox of the
  Aeons — `{player:"opponent", kind:"flipUp"}`), "Your opponents may only
  play tactics during their own turn" (Geldale, City-Fortress —
  `{player:"opponent", kind:{cardType:"tactic"}, timing:"notYourTurn"}`).

- **`restrict-return-to-hand`** (ability, state) — `ContinuousAbility` gains
  `restrictReturnToHand?: { player:"self"|"opponent"|"any"; fromZones:Zone[] }`
  — while the source is in play, a card owned/controlled by `player` cannot
  be moved to a hand from any zone in `fromZones` (the `moveCard`/`terminate`
  `to:"hand"` path checks it; falls back per CR — the effect just fails to
  move). "cards cannot be put into your opponents' hands from the void,
  discard pile or play" (Lockbox of the Aeons).

- **`deck-empty-loss`** (state, engine) — while an in-play card grants it,
  `checkStateBasedActions` adds "a player with 0 cards in their deck loses
  the game" (the influence-0 win check already exists; this is a second
  registered loss check, active only while the granting card is in play).
  Modelled as `ContinuousAbility { loseConditions?: ["deckEmpty"] }` or a
  dedicated marker. "When a player has no cards in their deck, they lose the
  game." (Trickster's Globe — its OTHER clause, the faction-damage-to-mill
  replacement, is `faction-damage-mill-replacement` below).

- **`faction-damage-mill-replacement`** (ability-kind, effect) — a
  `ReplacementAbility.replaces` variant `{ event:"damageToFaction",
  controlledBy?:"self"|"opponent"|"any" }` firing before faction damage
  commits, `optional`, with the replacement `effects` able to read the
  would-be amount via a new `{ type:"replacedDamageAmount" }` NumberExpression.
  "If you would inflict damage to an opponent's faction, for each damage you
  would inflict, you may put up to that many cards from the top of its
  owner's deck into their discard pile instead." (Trickster's Globe). If
  this proves too deep, Trickster's Globe -> `wontImplement` with a note —
  flag it but keep confidence low.

## Recurring Ungodly Mess patterns (compose from existing vocab — classify
these the same way every time)

- **"RECUR: [X] — COST: Use this only if this card is in your discard pile.
  Pay N. Remove this card from the game. [Pick ...] — EFFECT: ..."** —
  `activated` `activationZone:"discard"`, `threshold:"<icons>"`, costs
  `[payResources N, removeFromGame source]`, then targets/effects. Pervasive
  (Arrakis Eternity, Death Investor, Expert Debater, Brainbath, Deicidal
  Detonation, Haunting Execution, ...). No capability.
- **"This card enters play with N tokens on it."** — `triggered
  cardEnteredPlay + sourceIsEventCard -> addCounter(source,"token",N)`.
  "If you deployed this card using FLIP UP, it enters play with 3 tokens" =
  same trigger, `condition: deployedViaFlipUp` (Securitymajig Mark II).
- **"This card gains/loses K strength and K life for each token on it."** —
  `continuous` self `modifiers` with `value:{multiply:[{counter source
  token}, ±K]}`. Proven shape — `reusesProvenShape:true`.
- **"EXPAND / INVEST / BOLSTER — COST: Pay N. — EFFECT: Put a token on this
  card / remove a token."** — plain `activated`. "Pay X where X is the
  number of tokens" = ability `variables:{x:{counter source token}}` +
  cost `payResources {variable x}`.
- **"[X][X][X][X][X][X]: This card gains N strength/life/speed."** — a bare
  6-icon paragraph = an icon-gated `continuous` self buff (`condition` a
  `numberCompare` of `{resourceIcons self <icon>}` vs 6). "and loses all
  other rules text" (Crimson Pandiatus) = same continuous also carries
  `suppressAllAbilities:{target:"source"}`.
- **"[E][E][V][V]: This card gains 1 strength and 1 life. When this card
  attacks, ..."** (the Thabbashite `[X][X][V][V]` cycle) — an icon-gated
  pair: a `continuous` self buff + a `triggered` ability, BOTH gated on
  `and(numberCompare{resourceIcons self <X>} >= 2, numberCompare{resourceIcons
  self volition} >= 2)`. Author as two abilities sharing that condition.
- **"FLIP UP: N [icons]"** and **"FLIP UP: N [icons] and <rider>"** —
  `CardDefinition.flipUp:{cost:N, threshold:"<icons>", effects?:[<rider>]}`.
- **"When a character you control with a token on it leaves play, <benefit>.
  -- <NAME> — COST: Deplete this card. Pay 2. Pick a character you control.
  — EFFECT: Put a token on that character."** — the **Gosche's ___ location
  cycle** (God Amplification Chamber, Restoration Fortress, Retained
  Earnings Vault, Solar Citadel, Spynarium): `triggered event:"cardMoved",
  condition and(cardMovedFromZone "play", controller self, counterCompare
  __eventCard token >= 1)` -> benefit; plus a plain `activated`. Classify
  all five the same way.
- **"FEALTY: ..."** — `CardDefinition.thresholdSlack` (see cap above). The
  rest of the FEALTY card is normal.
- **"MAKE VANISH / MAKE REAPPEAR" (Abram)** — MAKE VANISH: `activated`
  costs [deplete source, payResources 5], target [character], effect
  [moveCard -> void]. MAKE REAPPEAR: `activated` costs [deplete source,
  payResources 1], effect [putIntoPlay from a `{zone:"void", type:
  "character", owner:"self"}` random-or-picked target -> under controller].
  CONCESSION: "a character voided by THIS card" is modelled as "a character
  in your void" (the void-origin link isn't tracked) — note it.
- **"you may include as many copies of this card in your deck as you want."**
  (Crow With Fists) — pure deckbuilding rule, no in-game effect ->
  `status:"vanilla"`, note it.
- **Micromajig / Fade of the Devoured Emperor / Unfortunate Fortune Hunter**
  — no rules text -> `status:"vanilla"`.
- **"put N Micromajig tokens/tokens into play under your control"** — a
  `createTokens` with a Micromajig `TokenSpec` (name "Micromajig", 0/0 or
  the printed line, `type:"character"`, `subtype:["majig"]`). "put up to
  five Micromajigs into play" (Ex Machina Majig) = `createTokens {count:5,
  optional}`.
- **"Your faction loses/gains N influence"** in a cost or effect —
  `loseInfluence` cost / `modifyInfluence` effect. "you may have your
  faction lose 3 influence" = `mayPay {costs:[loseInfluence 3], effects:...}`.
- **"detach up to N resources from your/their faction"** — `chooserSelectsTarget
  {declaration:{selector:{type:"resource", conditions:[attached-to-faction]},
  count:N, optional}} -> forEach selected -> detach`. Existing `detach` effect.
- **"remove up to N non-character cards in an opponent's discard pile from
  the game; reduce this card's numeric cost by the number removed"** (Moment
  of Annihilation) — `behavior.onPlay` with a `removeFromGame`/`removeSelected`
  cost-ish declaration + `costAdjust:{multiply:[{selectionCount removed},
  -1]}`.
- **"Terminate the card / the ability" in a response window** — `respondingTo
  {respondsTo:"card"|"ability", cardType?}` on the tactic's first ability /
  `behavior.onPlay.condition`, then `terminate {target:"respondedToCard"}`
  (or `respondedItem`). "Its controller puts a micromajig token into play"
  is a rider effect. Undesirable Intrusion also = `behavior.noResponse`.
- **modal "Choose one of the following as this card's rules text"**
  (Overindulge) — `behavior.modes` (NOT `chooserSelectsOption`).
- **Soulsearcher / Zenobia's Succor** ("[O]: gains COVERT. [G]: gains 2
  life. [E]: gains AGGRO. [D]: +1 speed. [R]: +2 strength.") — five separate
  icon-`threshold`-gated `activated` abilities (Soulsearcher: on self, no
  cost beyond the icon gate; Zenobia's Succor: a tactic whose first ability
  picks the character then five modes, or five `behavior.modes`).

## Output

`.work/classify-um-<N>.json` — a JSON array, one object per card in your
slice, EXACTLY this shape:

```json
[
  {
    "id": "<card id>",
    "name": "<card name>",
    "status": "classified",
    "rulesAudited": true,
    "behavior": { "needed": true, "shapes": ["...", "..."],
      "reusesProvenShape": true, "newTestNeeded": false },
    "metadata": { "unique": null, "attachTo": null,
      "resourceProvides": null, "keywords": [] },
    "engineCapability": [],
    "proposedCapabilities": [],
    "parityGaps": [],
    "confidence": "high",
    "notes": ""
  }
]
```

`reusesProvenShape: false` (=> also `newTestNeeded: true`) ONLY when the
card needs a brand-new ability SHAPE that warrants its own
`card-behaviors.test.ts` case (a genuinely novel composition, not just a new
capability used in a conventional way).

For a `vanilla` card use `"status":"vanilla"`, `"behavior":{"needed":false,
"shapes":[],"reusesProvenShape":null,"newTestNeeded":false}`.

Be precise and terse — this is a planning artifact. Report at the end: card
count, any card you could not classify confidently (+ why), and any
capability you proposed that wasn't on the list above.
